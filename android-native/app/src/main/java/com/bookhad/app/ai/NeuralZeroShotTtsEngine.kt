package com.bookhad.app.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.tanh

/**
 * Pipeline Step 3: Zero-Shot Neural Acoustic Model + Neural Vocoder (100% Offline, ZERO DSP Pitch Shift).
 *
 * Neural Inference Chain per short sentence (<= 20–30 words):
 *   1. VietnameseG2P converts text -> IPA phoneme token IDs (preserving all 6 Vietnamese tones).
 *   2. Acoustic Model (acoustic_zeroshot_int8.onnx) fuses (phoneme_ids + cached ~1KB speaker_embedding)
 *      -> outputs target speaker's Mel-Spectrogram [1, 80, T_mel] (reproducing exact vocal identity!).
 *   3. Neural Vocoder (vocoder_hifigan_int8.onnx) decodes Mel-Spectrogram [1, 80, T_mel]
 *      -> outputs authentic raw 24,000 Hz PCM waveform FloatArray [-1.0f, 1.0f].
 *   4. EVERY OnnxTensor & OrtSession.Result is closed inside `finally` immediately after each sentence
 *      so RAM stays strictly below 600MB on 4GB Helio G99 phones.
 *   5. Streams synthesized PCM16 through bounded Channel(capacity = 2) -> AudioTrack(MODE_STREAM).
 */
class NeuralZeroShotTtsEngine(
    private val context: Context,
    private val speakerEncoder: SpeakerEncoderEngine,
    private val cpuThreads: Int = OnnxRuntimeConfig.DEFAULT_INTRA_OP_THREADS,
) {

    companion object {
        private const val TAG = "NeuralZeroShotTtsEngine"
        const val OUTPUT_SAMPLE_RATE = AudioPreprocessor.VOCODER_SAMPLE_RATE // 24,000 Hz
        private const val AUDIO_SLICE_SAMPLES = 2_400 // 100ms slice for instant pause/stop
        private const val EDGE_FADE_SAMPLES = 120     // 5ms cosine edge ramp
    }

    private data class NeuralAudioChunk(
        val paragraphIndex: Int,
        val charOffset: Int,
        val text: String,
        val pcm16: ShortArray,
    )

    interface StreamListener {
        fun onPlaybackStateChanged(isPlaying: Boolean)
        fun onHighlightSentence(paragraphIndex: Int, charOffset: Int, sentenceText: String)
        fun onCompleted()
        fun onError(message: String)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val sessionLock = Any()

    private var sessionOptions: OrtSession.SessionOptions? = null
    private var acousticSession: OrtSession? = null
    private var vocoderSession: OrtSession? = null
    private var vietnameseG2P: VietnameseG2P? = null

    private var activeJob: Job? = null
    private var activeTrack: AudioTrack? = null
    private val isPaused = AtomicBoolean(false)
    private val isPlaying = AtomicBoolean(false)

    /**
     * Streams an entire book chapter sentence-by-sentence using the user's cached .emb Speaker Embedding.
     */
    fun speakChapter(
        paragraphs: List<String>,
        clonedVoiceId: String,
        startParagraphIndex: Int = 0,
        speechRate: Float = 1.0f,
        listener: StreamListener,
    ) {
        stop()

        val clampedRate = speechRate.coerceIn(0.65f, 1.85f)
        val sentenceChunks = VietnameseG2P.chunkParagraphs(
            paragraphs = paragraphs,
            startParagraphIndex = startParagraphIndex,
            maxWordsPerChunk = VietnameseG2P.MAX_WORDS_PER_CHUNK,
        )
        if (sentenceChunks.isEmpty()) {
            listener.onCompleted()
            return
        }

        isPaused.set(false)
        isPlaying.set(true)

        activeJob = scope.launch(Dispatchers.Default) {
            val queue = Channel<NeuralAudioChunk>(capacity = 2)
            var producerJob: Job? = null
            var track: AudioTrack? = null

            try {
                withContext(Dispatchers.Main) { listener.onPlaybackStateChanged(true) }

                // Load ONLY the ~1 KB cached speaker embedding (never re-runs Speaker Encoder)
                val speakerEmbedding = speakerEncoder.loadCachedEmbedding(clonedVoiceId)
                ensureNeuralSessionsLoaded()

                // Producer: Synthesizes at most 2 short sentences ahead on Dispatchers.Default (4-6 CPU threads)
                producerJob = launch(Dispatchers.Default) {
                    try {
                        for (chunk in sentenceChunks) {
                            if (!isActive) break
                            val pcm = synthesizeSentencePcm16(
                                sentence = chunk.text,
                                speakerEmbedding = speakerEmbedding,
                                speechRate = clampedRate,
                            )
                            if (pcm.isNotEmpty() && isActive) {
                                queue.send(
                                    NeuralAudioChunk(
                                        paragraphIndex = chunk.paragraphIndex,
                                        charOffset = chunk.charOffset,
                                        text = chunk.text,
                                        pcm16 = pcm,
                                    )
                                )
                            }
                        }
                    } finally {
                        queue.close()
                    }
                }

                // Consumer: Real-time 24kHz PCM16 AudioTrack streaming + UI highlight callback
                track = createAudioTrack24k()
                activeTrack = track
                track.play()

                for (audioChunk in queue) {
                    if (!isActive) break
                    while (isPaused.get() && isActive) delay(40L)
                    if (!isActive) break

                    withContext(Dispatchers.Main) {
                        listener.onHighlightSentence(
                            paragraphIndex = audioChunk.paragraphIndex,
                            charOffset = audioChunk.charOffset,
                            sentenceText = audioChunk.text,
                        )
                    }
                    writePcmChunk(track, audioChunk.pcm16)
                }

                if (isActive) {
                    withContext(Dispatchers.Main) {
                        isPlaying.set(false)
                        listener.onPlaybackStateChanged(false)
                        listener.onCompleted()
                    }
                }
            } catch (_: CancellationException) {
            } catch (err: Throwable) {
                Log.e(TAG, "Zero-shot neural synthesis failed", err)
                isPlaying.set(false)
                withContext(Dispatchers.Main) {
                    listener.onPlaybackStateChanged(false)
                    listener.onError(err.message ?: "Lỗi tổng hợp giọng nhân bản ONNX trên thiết bị.")
                }
            } finally {
                producerJob?.cancel()
                queue.close()
                releaseTrackSafely(track)
                if (activeTrack === track) activeTrack = null
                isPlaying.set(false)
            }
        }
    }

    /**
     * Synthesizes a preview sentence into a standalone 24kHz Mono 16-bit WAV file on disk.
     */
    suspend fun synthesizePreviewWav(
        text: String,
        clonedVoiceId: String,
        outputWavFile: File,
        speechRate: Float = 1.0f,
    ): File = withContext(Dispatchers.Default) {
        val speakerEmbedding = speakerEncoder.loadCachedEmbedding(clonedVoiceId)
        ensureNeuralSessionsLoaded()

        val chunks = VietnameseG2P.chunkParagraphs(listOf(text), 0)
        val combined = ArrayList<ShortArray>(chunks.size)
        var totalSamples = 0
        for (chunk in chunks) {
            val pcm = synthesizeSentencePcm16(chunk.text, speakerEmbedding, speechRate)
            if (pcm.isNotEmpty()) {
                combined.add(pcm)
                totalSamples += pcm.size
            }
        }
        val merged = ShortArray(totalSamples)
        var offset = 0
        for (part in combined) {
            System.arraycopy(part, 0, merged, offset, part.size)
            offset += part.size
        }
        writePcm16Wav(outputWavFile, merged, OUTPUT_SAMPLE_RATE)
        outputWavFile
    }

    fun pause() {
        if (!isPlaying.get()) return
        isPaused.set(true)
        try { activeTrack?.pause() } catch (_: IllegalStateException) {}
    }

    fun resume() {
        if (!isPlaying.get()) return
        isPaused.set(false)
        try { activeTrack?.play() } catch (_: IllegalStateException) {}
    }

    fun stop() {
        isPaused.set(false)
        isPlaying.set(false)
        activeJob?.cancel()
        activeJob = null
        releaseTrackSafely(activeTrack)
        activeTrack = null
    }

    fun unloadModels() {
        synchronized(sessionLock) {
            try { acousticSession?.close() } catch (_: Throwable) {}
            try { vocoderSession?.close() } catch (_: Throwable) {}
            try { sessionOptions?.close() } catch (_: Throwable) {}
            acousticSession = null
            vocoderSession = null
            sessionOptions = null
        }
    }

    fun destroy() {
        stop()
        unloadModels()
        scope.cancel()
    }

    private fun ensureNeuralSessionsLoaded() {
        synchronized(sessionLock) {
            if (acousticSession != null && vocoderSession != null && vietnameseG2P != null) return

            val paths = OnnxRuntimeConfig.ensureModelsExtracted(context)
            val env = OrtEnvironment.getEnvironment()

            if (vietnameseG2P == null) {
                vietnameseG2P = VietnameseG2P.fromTokensFile(paths.tokensFile)
            }
            if (sessionOptions == null) {
                sessionOptions = OnnxRuntimeConfig.createHelioG99CpuOptions(cpuThreads)
            }
            val opts = sessionOptions!!

            if (acousticSession == null) {
                acousticSession = OnnxRuntimeConfig.openMmapSession(env, paths.acousticModelFile, opts)
            }
            if (vocoderSession == null) {
                vocoderSession = OnnxRuntimeConfig.openMmapSession(env, paths.vocoderModelFile, opts)
            }
        }
    }

    /**
     * Step 3 Core Inference (per sentence <= 20-30 words):
     *   [Phoneme IDs + Speaker Embedding] -> Acoustic Model -> Mel-Spectrogram -> Neural Vocoder -> PCM16
     * Closes EVERY OnnxTensor and Result inside finally to keep RAM strictly bounded.
     */
    private fun synthesizeSentencePcm16(
        sentence: String,
        speakerEmbedding: FloatArray,
        speechRate: Float,
    ): ShortArray {
        val env = OrtEnvironment.getEnvironment()
        val g2p = vietnameseG2P ?: throw IllegalStateException("VietnameseG2P chưa khởi tạo.")
        val acoustic = acousticSession ?: throw IllegalStateException("Acoustic Model chưa nạp.")
        val vocoder = vocoderSession ?: throw IllegalStateException("Neural Vocoder chưa nạp.")

        val tokenIds = g2p.textToTokenIds(sentence)
        if (tokenIds.isEmpty()) return ShortArray(0)

        // Stage 3A: Acoustic Model generates speaker-conditioned Mel-Spectrogram [1, 80, T_mel]
        val mel = runAcousticModel(env, acoustic, tokenIds, speakerEmbedding, speechRate)
        if (mel.data.isEmpty()) return ShortArray(0)

        // Stage 3B: Neural Vocoder decodes Mel-Spectrogram -> authentic raw 24kHz audio waveform
        val waveform = runNeuralVocoder(env, vocoder, mel)
        return floatToPcm16(waveform)
    }

    private data class MelOutput(val data: FloatArray, val shape: LongArray)

    private fun runAcousticModel(
        env: OrtEnvironment,
        session: OrtSession,
        tokenIds: LongArray,
        speakerEmbedding: FloatArray,
        speechRate: Float,
    ): MelOutput {
        val inputs = LinkedHashMap<String, OnnxTensor>()
        var result: OrtSession.Result? = null
        try {
            val lengthScale = 1.0f / speechRate.coerceIn(0.65f, 1.85f)

            for (name in session.inputNames) {
                val lower = name.lowercase(Locale.ROOT)
                val tensor = when {
                    lower.contains("emb") || lower.contains("spk") || lower.contains("style") || lower.contains("se") -> {
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(speakerEmbedding),
                            longArrayOf(1L, speakerEmbedding.size.toLong()),
                        )
                    }
                    lower.contains("length") && !lower.contains("scale") -> {
                        OnnxTensor.createTensor(
                            env,
                            LongBuffer.wrap(longArrayOf(tokenIds.size.toLong())),
                            longArrayOf(1L),
                        )
                    }
                    lower.contains("scale") -> {
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(floatArrayOf(0.667f, lengthScale, 0.8f)),
                            longArrayOf(3L),
                        )
                    }
                    else -> {
                        OnnxTensor.createTensor(
                            env,
                            LongBuffer.wrap(tokenIds),
                            longArrayOf(1L, tokenIds.size.toLong()),
                        )
                    }
                }
                inputs[name] = tensor
            }

            result = session.run(inputs)
            val melTensor = result[0] as OnnxTensor
            val shape = melTensor.info.shape
            val fb = melTensor.floatBuffer
            val data = FloatArray(fb.remaining())
            fb.get(data)
            return MelOutput(data, shape)
        } finally {
            try { result?.close() } catch (_: Throwable) {}
            for (t in inputs.values) {
                try { t.close() } catch (_: Throwable) {}
            }
            inputs.clear()
        }
    }

    private fun runNeuralVocoder(
        env: OrtEnvironment,
        session: OrtSession,
        mel: MelOutput,
    ): FloatArray {
        var melInput: OnnxTensor? = null
        var result: OrtSession.Result? = null
        try {
            val inputName = session.inputNames.first()
            melInput = OnnxTensor.createTensor(env, FloatBuffer.wrap(mel.data), mel.shape)
            result = session.run(mapOf(inputName to melInput))
            val audioTensor = result[0] as OnnxTensor
            val fb = audioTensor.floatBuffer
            val samples = FloatArray(fb.remaining())
            fb.get(samples)
            return samples
        } finally {
            try { result?.close() } catch (_: Throwable) {}
            try { melInput?.close() } catch (_: Throwable) {}
        }
    }

    private fun floatToPcm16(waveform: FloatArray): ShortArray {
        if (waveform.isEmpty()) return ShortArray(0)
        val out = ShortArray(waveform.size)
        val ramp = min(EDGE_FADE_SAMPLES, waveform.size / 4)
        for (i in waveform.indices) {
            var s = waveform[i]
            if (!s.isFinite()) s = 0f
            if (s > 0.94f || s < -0.94f) s = tanh(s.toDouble()).toFloat()
            if (ramp > 0) {
                if (i < ramp) {
                    s *= (0.5 - 0.5 * cos(PI * i / ramp)).toFloat()
                } else if (i >= waveform.size - ramp) {
                    s *= (0.5 - 0.5 * cos(PI * (waveform.size - 1 - i) / ramp)).toFloat()
                }
            }
            out[i] = (s.coerceIn(-1f, 1f) * 32767f).roundToInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return out
    }

    private fun createAudioTrack24k(): AudioTrack {
        val minBuf = AudioTrack.getMinBufferSize(
            OUTPUT_SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bufferBytes = max(minBuf * 2, OUTPUT_SAMPLE_RATE / 4 * 2)
        return AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(OUTPUT_SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(bufferBytes)
            .build()
    }

    private suspend fun writePcmChunk(track: AudioTrack, pcm: ShortArray) {
        var offset = 0
        while (offset < pcm.size) {
            if (!isPlaying.get()) return
            while (isPaused.get() && isPlaying.get()) delay(40L)
            if (!isPlaying.get()) return
            val count = min(AUDIO_SLICE_SAMPLES, pcm.size - offset)
            val written = track.write(pcm, offset, count, AudioTrack.WRITE_BLOCKING)
            if (written < 0) throw IllegalStateException("AudioTrack write error: $written")
            offset += written
        }
    }

    private fun releaseTrackSafely(track: AudioTrack?) {
        if (track == null) return
        try {
            if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                track.pause()
                track.flush()
            }
            track.stop()
        } catch (_: Throwable) {
        } finally {
            try { track.release() } catch (_: Throwable) {}
        }
    }

    private fun writePcm16Wav(outFile: File, pcm: ShortArray, sampleRate: Int) {
        val dataSize = pcm.size * 2
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray(Charsets.US_ASCII))
            putInt(36 + dataSize)
            put("WAVE".toByteArray(Charsets.US_ASCII))
            put("fmt ".toByteArray(Charsets.US_ASCII))
            putInt(16)
            putShort(1) // PCM
            putShort(1) // Mono
            putInt(sampleRate)
            putInt(sampleRate * 2)
            putShort(2)
            putShort(16)
            put("data".toByteArray(Charsets.US_ASCII))
            putInt(dataSize)
        }
        BufferedOutputStream(FileOutputStream(outFile)).use { bos ->
            bos.write(header.array())
            val dataBuf = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN)
            for (s in pcm) dataBuf.putShort(s)
            bos.write(dataBuf.array())
            bos.flush()
        }
    }
}
