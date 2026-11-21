package com.bookhad.app.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.tanh

/**
 * Low-RAM Streaming On-Device AI TTS Engine with Voice Cloning (Helio G99, 4GB RAM, NO NPU).
 *
 * Architecture:
 *  - Splits chapter text into natural 12–18 word chunks preserving paragraphIndex & charOffset.
 *  - Bounded Channel<SynthesizedAudioChunk>(capacity = 2) on Dispatchers.Default:
 *      * Producer: Text -> Token/Phoneme IDs -> INT8 tts_base_int8.onnx -> INT8 tone_converter_int8.onnx
 *        conditioned on the user's .emb speaker embedding -> Float[-1,1] -> PCM16 ShortArray.
 *        EVERY OnnxTensor and OrtSession.Result is closed inside a finally block on every chunk.
 *      * Consumer: Streams PCM16 chunks into AudioTrack(MODE_STREAM) at exact TTS_SAMPLE_RATE (22050Hz)
 *        while firing real-time text highlight callbacks on Dispatchers.Main.
 *  - Memory budget stays strictly below 350MB RAM:
 *      * Models loaded strictly via mmap (String file path, never ByteArray).
 *      * speaker_encoder.onnx is NEVER held in RAM during playback.
 *      * NNAPI is DISABLED; XNNPACK is ENABLED with intraOp=2, interOp=1.
 */
class BookReaderAiTtsEngine(
    private val context: Context,
    private val voiceCloner: VoiceCloner,
) {

    companion object {
        private const val TAG = "BookReaderAiTtsEngine"

        // Exact sample rate synchronized across ONNX tts_base/tone_converter and AudioTrack
        const val TTS_SAMPLE_RATE = 22_050
        private const val MIN_WORDS_PER_CHUNK = 12
        private const val MAX_WORDS_PER_CHUNK = 18
        private const val AUDIO_WRITE_SLICE_SAMPLES = 2_048 // ~92ms latency for instant pause/stop
        private const val FADE_RAMP_SAMPLES = 110 // 5ms cosine edge ramp to eliminate clicks
    }

    data class TextChunk(
        val paragraphIndex: Int,
        val charOffset: Int,
        val text: String,
    )

    private data class SynthesizedAudioChunk(
        val paragraphIndex: Int,
        val charOffset: Int,
        val text: String,
        val pcm16: ShortArray,
    )

    interface PlaybackListener {
        fun onPlaybackStateChanged(isPlaying: Boolean)
        fun onHighlightChunk(paragraphIndex: Int, charOffset: Int, text: String)
        fun onChapterCompleted()
        fun onError(message: String)
    }

    private val engineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val modelLock = Any()

    private var sessionOptions: OrtSession.SessionOptions? = null
    private var ttsBaseSession: OrtSession? = null
    private var toneConverterSession: OrtSession? = null
    private var tokenToIdMap: Map<String, Long> = emptyMap()

    private var playbackJob: Job? = null
    private var activeAudioTrack: AudioTrack? = null
    private val isPausedFlag = AtomicBoolean(false)
    private val isPlayingFlag = AtomicBoolean(false)

    fun isPlaying(): Boolean = isPlayingFlag.get() && !isPausedFlag.get()

    /**
     * Starts streaming chapter synthesis and playback using a cloned voice ID (.emb in filesDir/voices/).
     */
    fun speakChapterWithClonedVoice(
        paragraphs: List<String>,
        clonedVoiceId: String,
        startParagraphIndex: Int = 0,
        speechRate: Float = 1.0f,
        listener: PlaybackListener,
    ) {
        stop()

        val clampedRate = speechRate.coerceIn(0.6f, 2.0f)
        val chunks = chunkBookParagraphs(paragraphs, startParagraphIndex)
        if (chunks.isEmpty()) {
            listener.onChapterCompleted()
            return
        }

        isPausedFlag.set(false)
        isPlayingFlag.set(true)

        playbackJob = engineScope.launch(Dispatchers.Default) {
            val audioChannel = Channel<SynthesizedAudioChunk>(capacity = 2)
            var producerJob: Job? = null
            var track: AudioTrack? = null

            try {
                withContext(Dispatchers.Main) {
                    listener.onPlaybackStateChanged(true)
                }

                // 1. Load user's saved .emb speaker embedding from filesDir/voices/
                val speakerEmbedding = voiceCloner.loadEmbeddingVector(clonedVoiceId)

                // 2. Lazily initialize mmap INT8 TTS Base & Tone Converter on Helio G99 CPU/XNNPACK
                ensureTtsModelsLoaded()

                // 3. Producer Coroutine: synthesizes at most 2 chunks ahead on Dispatchers.Default
                producerJob = launch(Dispatchers.Default) {
                    try {
                        for (chunk in chunks) {
                            if (!isActive) break
                            val pcm = synthesizeChunkToPcm16(
                                text = chunk.text,
                                speakerEmbedding = speakerEmbedding,
                                speechRate = clampedRate,
                            )
                            if (pcm.isNotEmpty() && isActive) {
                                audioChannel.send(
                                    SynthesizedAudioChunk(
                                        paragraphIndex = chunk.paragraphIndex,
                                        charOffset = chunk.charOffset,
                                        text = chunk.text,
                                        pcm16 = pcm,
                                    )
                                )
                            }
                        }
                    } finally {
                        audioChannel.close()
                    }
                }

                // 4. Consumer: AudioTrack MODE_STREAM locked to exact TTS_SAMPLE_RATE (22050Hz)
                track = createStreamingAudioTrack(TTS_SAMPLE_RATE)
                activeAudioTrack = track
                track.play()

                for (audioChunk in audioChannel) {
                    if (!isActive) break

                    while (isPausedFlag.get() && isActive) {
                        delay(40L)
                    }
                    if (!isActive) break

                    withContext(Dispatchers.Main) {
                        listener.onHighlightChunk(
                            paragraphIndex = audioChunk.paragraphIndex,
                            charOffset = audioChunk.charOffset,
                            text = audioChunk.text,
                        )
                    }

                    writePcmWithPauseSupport(track, audioChunk.pcm16)
                }

                if (isActive) {
                    withContext(Dispatchers.Main) {
                        isPlayingFlag.set(false)
                        listener.onPlaybackStateChanged(false)
                        listener.onChapterCompleted()
                    }
                }
            } catch (_: CancellationException) {
                // Normal stop() cancellation
            } catch (err: Throwable) {
                Log.e(TAG, "AI TTS playback error", err)
                isPlayingFlag.set(false)
                withContext(Dispatchers.Main) {
                    listener.onPlaybackStateChanged(false)
                    listener.onError(err.message ?: "Lỗi phát giọng đọc AI nhân bản.")
                }
            } finally {
                producerJob?.cancel()
                audioChannel.close()
                releaseAudioTrackSafely(track)
                if (activeAudioTrack === track) {
                    activeAudioTrack = null
                }
                isPlayingFlag.set(false)
            }
        }
    }

    fun pause() {
        if (!isPlayingFlag.get()) return
        isPausedFlag.set(true)
        try {
            activeAudioTrack?.pause()
        } catch (_: IllegalStateException) {
        }
    }

    fun resume() {
        if (!isPlayingFlag.get()) return
        isPausedFlag.set(false)
        try {
            activeAudioTrack?.play()
        } catch (_: IllegalStateException) {
        }
    }

    fun stop() {
        isPausedFlag.set(false)
        isPlayingFlag.set(false)
        playbackJob?.cancel()
        playbackJob = null
        releaseAudioTrackSafely(activeAudioTrack)
        activeAudioTrack = null
    }

    /**
     * Releases mmap ONNX sessions when user leaves the reader or app goes to background.
     */
    fun unloadModelsFromMemory() {
        synchronized(modelLock) {
            try { ttsBaseSession?.close() } catch (_: Throwable) {}
            try { toneConverterSession?.close() } catch (_: Throwable) {}
            try { sessionOptions?.close() } catch (_: Throwable) {}
            ttsBaseSession = null
            toneConverterSession = null
            sessionOptions = null
        }
    }

    fun destroy() {
        stop()
        unloadModelsFromMemory()
        engineScope.cancel()
    }

    /**
     * Splits book paragraphs into natural 12–18 word chunks respecting punctuation so
     * time-to-first-audio is fast and peak tensor RAM stays tiny on 4GB Helio G99 phones.
     */
    fun chunkBookParagraphs(
        paragraphs: List<String>,
        startParagraphIndex: Int = 0,
    ): List<TextChunk> {
        val result = mutableListOf<TextChunk>()
        val safeStart = startParagraphIndex.coerceIn(0, max(0, paragraphs.size - 1))

        for (pIdx in safeStart until paragraphs.size) {
            val rawPara = paragraphs[pIdx]
            if (rawPara.isBlank()) continue

            val wordMatches = Regex("\\S+").findAll(rawPara).toList()
            if (wordMatches.isEmpty()) continue

            var cursor = 0
            while (cursor < wordMatches.size) {
                val maxEnd = min(cursor + MAX_WORDS_PER_CHUNK, wordMatches.size)
                var splitEnd = maxEnd

                // Prefer natural punctuation boundary between MIN_WORDS_PER_CHUNK and MAX_WORDS_PER_CHUNK
                if (maxEnd < wordMatches.size) {
                    val searchStart = min(cursor + MIN_WORDS_PER_CHUNK - 1, maxEnd - 1)
                    var bestBreak = -1
                    for (i in maxEnd - 1 downTo searchStart) {
                        val token = wordMatches[i].value
                        val lastChar = token.lastOrNull()
                        if (lastChar == '.' || lastChar == '!' || lastChar == '?' ||
                            lastChar == ';' || lastChar == ':' || lastChar == '…' || lastChar == ','
                        ) {
                            bestBreak = i + 1
                            break
                        }
                    }
                    if (bestBreak > cursor) {
                        splitEnd = bestBreak
                    }
                }

                val startChar = wordMatches[cursor].range.first
                val endChar = wordMatches[splitEnd - 1].range.last + 1
                val chunkText = rawPara.substring(startChar, endChar).trim()
                if (chunkText.isNotEmpty()) {
                    result.add(
                        TextChunk(
                            paragraphIndex = pIdx,
                            charOffset = startChar,
                            text = chunkText,
                        )
                    )
                }
                cursor = splitEnd
            }
        }
        return result
    }

    private fun ensureTtsModelsLoaded() {
        synchronized(modelLock) {
            if (ttsBaseSession != null && toneConverterSession != null && tokenToIdMap.isNotEmpty()) {
                return
            }

            val paths = OnnxAssetExtractor.ensureExtracted(context)
            val env = OrtEnvironment.getEnvironment()

            if (tokenToIdMap.isEmpty()) {
                tokenToIdMap = loadTokensVocabulary(paths.tokensFile)
            }

            if (sessionOptions == null) {
                sessionOptions = OnnxAssetExtractor.createHelioG99SessionOptions()
            }
            val opts = sessionOptions!!

            if (ttsBaseSession == null) {
                ttsBaseSession = OnnxAssetExtractor.openMmapSession(
                    env = env,
                    modelFile = paths.ttsBaseModel,
                    options = opts,
                )
            }

            if (toneConverterSession == null) {
                toneConverterSession = OnnxAssetExtractor.openMmapSession(
                    env = env,
                    modelFile = paths.toneConverterModel,
                    options = opts,
                )
            }
        }
    }

    /**
     * Runs 2-stage ONNX synthesis for a single 12–18 word chunk:
     *   Stage 1: INT8 tts_base_int8.onnx -> base waveform FloatArray [-1f, 1f]
     *   Stage 2: INT8 tone_converter_int8.onnx + user's .emb -> cloned waveform FloatArray [-1f, 1f]
     * Strictly closes every OnnxTensor and OrtSession.Result in finally blocks.
     */
    private fun synthesizeChunkToPcm16(
        text: String,
        speakerEmbedding: FloatArray,
        speechRate: Float,
    ): ShortArray {
        val env = OrtEnvironment.getEnvironment()
        val baseSession = ttsBaseSession ?: throw IllegalStateException("tts_base_int8 chưa được tải.")
        val converterSession = toneConverterSession ?: throw IllegalStateException("tone_converter_int8 chưa được tải.")

        val tokenIds = textToPhonemeTokenIds(text)
        if (tokenIds.isEmpty()) return ShortArray(0)

        // --- Stage 1: Base TTS synthesis (INT8) ---
        val baseWaveform = runBaseTtsInference(env, baseSession, tokenIds, speechRate)
        if (baseWaveform.isEmpty()) return ShortArray(0)

        // --- Stage 2: Voice Tone Conversion with Cloned Speaker Embedding (INT8) ---
        val clonedWaveform = runToneConverterInference(env, converterSession, baseWaveform, speakerEmbedding)

        // --- Stage 3: Soft limiter, 5ms cosine edge ramp, Float[-1,1] -> Short PCM16 ---
        return floatWaveformToPcm16(clonedWaveform)
    }

    private fun runBaseTtsInference(
        env: OrtEnvironment,
        session: OrtSession,
        tokenIds: LongArray,
        speechRate: Float,
    ): FloatArray {
        val inputs = LinkedHashMap<String, OnnxTensor>()
        var result: OrtSession.Result? = null
        try {
            val lengthScale = (1.0f / speechRate.coerceIn(0.6f, 2.0f))
            val inputNames = session.inputNames

            for (name in inputNames) {
                val lower = name.lowercase(Locale.ROOT)
                val tensor = when {
                    lower.contains("length") && !lower.contains("scale") -> {
                        OnnxTensor.createTensor(
                            env,
                            LongBuffer.wrap(longArrayOf(tokenIds.size.toLong())),
                            longArrayOf(1L),
                        )
                    }
                    lower.contains("scale") -> {
                        // Standard VITS/Piper scales tensor: [noise_scale, length_scale, noise_w]
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(floatArrayOf(0.667f, lengthScale, 0.8f)),
                            longArrayOf(3L),
                        )
                    }
                    lower.contains("sid") || lower.contains("speaker") -> {
                        OnnxTensor.createTensor(
                            env,
                            LongBuffer.wrap(longArrayOf(0L)),
                            longArrayOf(1L),
                        )
                    }
                    else -> {
                        // Primary phoneme / token ID input: [1, seq_len]
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
            val audioTensor = result[0] as OnnxTensor
            val fb = audioTensor.floatBuffer
            val samples = FloatArray(fb.remaining())
            fb.get(samples)
            return samples
        } finally {
            try { result?.close() } catch (_: Throwable) {}
            for (tensor in inputs.values) {
                try { tensor.close() } catch (_: Throwable) {}
            }
            inputs.clear()
        }
    }

    private fun runToneConverterInference(
        env: OrtEnvironment,
        session: OrtSession,
        baseWaveform: FloatArray,
        speakerEmbedding: FloatArray,
    ): FloatArray {
        val inputs = LinkedHashMap<String, OnnxTensor>()
        var result: OrtSession.Result? = null
        try {
            val inputNames = session.inputNames.toList()
            for ((index, name) in inputNames.withIndex()) {
                val lower = name.lowercase(Locale.ROOT)
                val isTargetEmbedding = lower.contains("tgt") ||
                    lower.contains("target") ||
                    lower.contains("spk") ||
                    lower.contains("emb") ||
                    index == 1

                val isSourceEmbedding = lower.contains("src_se") || lower.contains("source_emb")

                val tensor = when {
                    isSourceEmbedding -> {
                        val neutral = FloatArray(speakerEmbedding.size) { 0.0f }
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(neutral),
                            longArrayOf(1L, neutral.size.toLong()),
                        )
                    }
                    isTargetEmbedding -> {
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(speakerEmbedding),
                            longArrayOf(1L, speakerEmbedding.size.toLong()),
                        )
                    }
                    lower.contains("tau") -> {
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(floatArrayOf(0.3f)),
                            longArrayOf(1L),
                        )
                    }
                    else -> {
                        // Base TTS audio waveform [1, samples]
                        OnnxTensor.createTensor(
                            env,
                            FloatBuffer.wrap(baseWaveform),
                            longArrayOf(1L, baseWaveform.size.toLong()),
                        )
                    }
                }
                inputs[name] = tensor
            }

            result = session.run(inputs)
            val outTensor = result[0] as OnnxTensor
            val fb = outTensor.floatBuffer
            val converted = FloatArray(fb.remaining())
            fb.get(converted)
            return converted
        } finally {
            try { result?.close() } catch (_: Throwable) {}
            for (tensor in inputs.values) {
                try { tensor.close() } catch (_: Throwable) {}
            }
            inputs.clear()
        }
    }

    private fun floatWaveformToPcm16(waveform: FloatArray): ShortArray {
        if (waveform.isEmpty()) return ShortArray(0)
        val out = ShortArray(waveform.size)
        val rampLen = min(FADE_RAMP_SAMPLES, waveform.size / 4)

        for (i in waveform.indices) {
            var sample = waveform[i]
            if (!sample.isFinite()) sample = 0f

            // Soft limiter prevents digital clipping distortion while keeping loudness warm
            if (sample > 0.92f || sample < -0.92f) {
                sample = tanh(sample.toDouble()).toFloat()
            }

            // Smooth 5ms fade-in and fade-out at chunk boundaries to eliminate clicks/pops
            if (rampLen > 0) {
                if (i < rampLen) {
                    val gain = (0.5 - 0.5 * cos(PI * i / rampLen)).toFloat()
                    sample *= gain
                } else if (i >= waveform.size - rampLen) {
                    val tailPos = waveform.size - 1 - i
                    val gain = (0.5 - 0.5 * cos(PI * tailPos / rampLen)).toFloat()
                    sample *= gain
                }
            }

            val pcm = (sample.coerceIn(-1.0f, 1.0f) * 32767.0f).roundToInt()
            out[i] = pcm.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return out
    }

    private fun createStreamingAudioTrack(sampleRate: Int): AudioTrack {
        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bufferSizeBytes = max(minBuf * 2, sampleRate / 4 * 2) // >= 250ms ring buffer
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
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(bufferSizeBytes)
            .build()
    }

    private suspend fun writePcmWithPauseSupport(track: AudioTrack, pcm: ShortArray) {
        var offset = 0
        while (offset < pcm.size) {
            if (!isPlayingFlag.get()) return
            while (isPausedFlag.get() && isPlayingFlag.get()) {
                delay(40L)
            }
            if (!isPlayingFlag.get()) return

            val count = min(AUDIO_WRITE_SLICE_SAMPLES, pcm.size - offset)
            val written = track.write(pcm, offset, count, AudioTrack.WRITE_BLOCKING)
            if (written < 0) {
                throw IllegalStateException("AudioTrack write failed with error code $written")
            }
            offset += written
        }
    }

    private fun releaseAudioTrackSafely(track: AudioTrack?) {
        if (track == null) return
        try {
            if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                track.pause()
                track.flush()
            }
            track.stop()
        } catch (_: Throwable) {
        } finally {
            try {
                track.release()
            } catch (_: Throwable) {
            }
        }
    }

    /**
     * Parses tokens.txt supporting standard Sherpa-ONNX / Piper / VITS formats:
     *   - "<symbol> <id>"
     *   - "<symbol>\t<id>"
     *   - single symbol per line (0-indexed)
     */
    private fun loadTokensVocabulary(tokensFile: File): Map<String, Long> {
        val map = LinkedHashMap<String, Long>(256)
        if (!tokensFile.exists()) return map

        var lineIdx = 0L
        tokensFile.forEachLine(Charsets.UTF_8) { rawLine ->
            val line = rawLine.trimEnd('\r', '\n')
            if (line.isNotEmpty()) {
                val lastSpace = line.lastIndexOf(' ')
                val lastTab = line.lastIndexOf('\t')
                val sep = max(lastSpace, lastTab)
                if (sep > 0 && sep < line.length - 1) {
                    val parsedId = line.substring(sep + 1).trim().toLongOrNull()
                    if (parsedId != null) {
                        map[line.substring(0, sep)] = parsedId
                    } else {
                        map[line] = lineIdx
                    }
                } else {
                    map[line] = lineIdx
                }
            }
            lineIdx++
        }
        return map
    }

    /**
     * Converts cleaned book text into VITS/Piper phoneme/token IDs interleaved with blank ID (0).
     * Maps Vietnamese diacritics and punctuation cleanly against the extracted tokens.txt table.
     */
    private fun textToPhonemeTokenIds(text: String): LongArray {
        val normalized = Normalizer.normalize(text.lowercase(Locale("vi", "VN")), Normalizer.Form.NFC)
        val blankId = tokenToIdMap["_"] ?: tokenToIdMap["<pad>"] ?: 0L
        val spaceId = tokenToIdMap[" "] ?: tokenToIdMap["<space>"] ?: 3L
        val bosId = tokenToIdMap["^"] ?: tokenToIdMap["<bos>"]
        val eosId = tokenToIdMap["$"] ?: tokenToIdMap["<eos>"]

        val ids = ArrayList<Long>(normalized.length * 2 + 4)
        if (bosId != null) {
            ids.add(bosId)
            ids.add(blankId)
        }

        var idx = 0
        while (idx < normalized.length) {
            // Try 2-character Vietnamese digraph first (ch, gh, kh, ng, nh, ph, th, tr, qu, gi)
            if (idx + 1 < normalized.length) {
                val pair = normalized.substring(idx, idx + 2)
                val pairId = tokenToIdMap[pair]
                if (pairId != null) {
                    ids.add(pairId)
                    ids.add(blankId)
                    idx += 2
                    continue
                }
            }

            val ch = normalized[idx].toString()
            val directId = tokenToIdMap[ch]
            if (directId != null) {
                ids.add(directId)
                ids.add(blankId)
            } else if (ch == " " || ch == "\t" || ch == "\n") {
                ids.add(spaceId)
                ids.add(blankId)
            } else {
                // Fallback: decompose diacritic base letter if full glyph wasn't in vocab
                val base = Normalizer.normalize(ch, Normalizer.Form.NFD)
                    .replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
                val fallbackId = tokenToIdMap[base]
                if (fallbackId != null) {
                    ids.add(fallbackId)
                    ids.add(blankId)
                }
            }
            idx++
        }

        if (eosId != null) {
            ids.add(eosId)
        }

        return ids.toLongArray()
    }
}

/**
 * Strict TTS Engine Router preventing Bug #2 (Android System TextToSpeech overriding Cloned AI Voices).
 *
 * Whenever a cloned voice (voiceId starting with "clone_") is selected:
 *  - Android's built-in TextToSpeech is IMMEDIATELY stopped and detached.
 *  - Audio routes 100% through BookReaderAiTtsEngine (ONNX + AudioTrack).
 *  - Never silently falls back to Google/Samsung system TTS.
 */
class UnifiedBookTtsRouter(
    private val context: Context,
    private val aiTtsEngine: BookReaderAiTtsEngine,
) {

    enum class ActiveEngine { NONE, SYSTEM_ANDROID_TTS, ON_DEVICE_AI_CLONE }

    private var activeEngine: ActiveEngine = ActiveEngine.NONE
    private var systemTts: TextToSpeech? = null
    private var isSystemTtsReady: Boolean = false
    private var systemParagraphs: List<String> = emptyList()
    private var systemCurrentIndex: Int = 0
    private var systemListener: BookReaderAiTtsEngine.PlaybackListener? = null

    fun speakChapter(
        paragraphs: List<String>,
        voiceId: String,
        startParagraphIndex: Int,
        speechRate: Float,
        listener: BookReaderAiTtsEngine.PlaybackListener,
    ) {
        val isClonedVoice = voiceId.startsWith("clone_")

        if (isClonedVoice) {
            // CRITICAL: Completely stop and detach Android System TextToSpeech first!
            stopAndDetachSystemTts()
            activeEngine = ActiveEngine.ON_DEVICE_AI_CLONE

            aiTtsEngine.speakChapterWithClonedVoice(
                paragraphs = paragraphs,
                clonedVoiceId = voiceId,
                startParagraphIndex = startParagraphIndex,
                speechRate = speechRate,
                listener = listener,
            )
            return
        }

        // Standard System TTS path: stop AI ONNX engine first so both never speak simultaneously.
        aiTtsEngine.stop()
        activeEngine = ActiveEngine.SYSTEM_ANDROID_TTS
        startSystemTtsChapter(paragraphs, startParagraphIndex, speechRate, listener)
    }

    fun pause() {
        when (activeEngine) {
            ActiveEngine.ON_DEVICE_AI_CLONE -> aiTtsEngine.pause()
            ActiveEngine.SYSTEM_ANDROID_TTS -> systemTts?.stop()
            ActiveEngine.NONE -> Unit
        }
    }

    fun resume() {
        when (activeEngine) {
            ActiveEngine.ON_DEVICE_AI_CLONE -> aiTtsEngine.resume()
            ActiveEngine.SYSTEM_ANDROID_TTS -> {
                val listener = systemListener
                if (listener != null && systemCurrentIndex < systemParagraphs.size) {
                    speakNextSystemParagraph(1.0f)
                }
            }
            ActiveEngine.NONE -> Unit
        }
    }

    fun stopAll() {
        aiTtsEngine.stop()
        stopAndDetachSystemTts()
        activeEngine = ActiveEngine.NONE
    }

    fun destroy() {
        stopAll()
        try {
            systemTts?.shutdown()
        } catch (_: Throwable) {
        }
        systemTts = null
        isSystemTtsReady = false
        aiTtsEngine.destroy()
    }

    private fun stopAndDetachSystemTts() {
        systemListener = null
        systemParagraphs = emptyList()
        try {
            systemTts?.setOnUtteranceProgressListener(null)
            systemTts?.stop()
        } catch (_: Throwable) {
        }
    }

    private fun startSystemTtsChapter(
        paragraphs: List<String>,
        startIndex: Int,
        speechRate: Float,
        listener: BookReaderAiTtsEngine.PlaybackListener,
    ) {
        systemParagraphs = paragraphs
        systemCurrentIndex = startIndex.coerceIn(0, max(0, paragraphs.size - 1))
        systemListener = listener

        val beginPlayback = {
            val tts = systemTts
            if (tts != null && isSystemTtsReady) {
                tts.language = Locale("vi", "VN")
                tts.setSpeechRate(speechRate.coerceIn(0.5f, 2.0f))
                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        val idx = utteranceId?.toIntOrNull() ?: return
                        val text = systemParagraphs.getOrNull(idx) ?: return
                        listener.onHighlightChunk(idx, 0, text)
                    }

                    override fun onDone(utteranceId: String?) {
                        if (activeEngine != ActiveEngine.SYSTEM_ANDROID_TTS) return
                        systemCurrentIndex++
                        if (systemCurrentIndex < systemParagraphs.size) {
                            speakNextSystemParagraph(speechRate)
                        } else {
                            listener.onPlaybackStateChanged(false)
                            listener.onChapterCompleted()
                        }
                    }

                    @Deprecated("Deprecated in Android API")
                    override fun onError(utteranceId: String?) {
                        listener.onPlaybackStateChanged(false)
                        listener.onError("Lỗi bộ đọc TTS hệ thống Android.")
                    }
                })
                listener.onPlaybackStateChanged(true)
                speakNextSystemParagraph(speechRate)
            }
        }

        if (systemTts == null) {
            systemTts = TextToSpeech(context.applicationContext) { status ->
                isSystemTtsReady = (status == TextToSpeech.SUCCESS)
                if (isSystemTtsReady && activeEngine == ActiveEngine.SYSTEM_ANDROID_TTS) {
                    beginPlayback()
                } else if (!isSystemTtsReady) {
                    listener.onError("Không thể khởi tạo TextToSpeech hệ thống.")
                }
            }
        } else if (isSystemTtsReady) {
            beginPlayback()
        }
    }

    private fun speakNextSystemParagraph(speechRate: Float) {
        val tts = systemTts ?: return
        while (systemCurrentIndex < systemParagraphs.size && systemParagraphs[systemCurrentIndex].isBlank()) {
            systemCurrentIndex++
        }
        if (systemCurrentIndex >= systemParagraphs.size) {
            systemListener?.onPlaybackStateChanged(false)
            systemListener?.onChapterCompleted()
            return
        }
        tts.setSpeechRate(speechRate.coerceIn(0.5f, 2.0f))
        tts.speak(
            systemParagraphs[systemCurrentIndex],
            TextToSpeech.QUEUE_FLUSH,
            null,
            systemCurrentIndex.toString(),
        )
    }
}
