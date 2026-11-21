package com.bookhad.app.ai

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Facade coordinating the complete 3-Step Zero-Shot Neural Voice Cloning Pipeline on Android:
 *   Step 1: AudioPreprocessor (5–10s Mono 16kHz + C++ JNI Noise Gate + VAD Trim, ZERO pitch shift)
 *   Step 2: SpeakerEncoderEngine (1-time ONNX INT8 extraction -> ~1 KB .emb cache -> session closed)
 *   Step 3: NeuralZeroShotTtsEngine (Vietnamese G2P + Acoustic Model -> Mel -> Neural Vocoder -> 24kHz PCM)
 *
 * Strictly detaches Android System TextToSpeech whenever a cloned voice (`clone_*`) is active.
 */
class ZeroShotVoiceCloningManager(private val context: Context) {

    interface EnrollmentListener {
        fun onRecordingTick(elapsedMs: Long, rmsLevel: Float)
        fun onEncodingEmbedding()
        fun onEnrolled(profile: SpeakerEncoderEngine.CachedVoiceEmbedding)
        fun onError(message: String)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val speakerEncoder = SpeakerEncoderEngine(context)
    val neuralTts = NeuralZeroShotTtsEngine(
        context = context,
        speakerEncoder = speakerEncoder,
        cpuThreads = OnnxRuntimeConfig.DEFAULT_INTRA_OP_THREADS, // 4 threads on Helio G99 (4..6 max)
    )

    private val isRecording = AtomicBoolean(false)
    private var recordJob: Job? = null
    private var systemTts: TextToSpeech? = null
    private var systemTtsReady = false
    private var activeUsingClone = false

    fun startEnrollmentRecording(
        displayName: String,
        listener: EnrollmentListener,
    ) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            listener.onError("Chưa cấp quyền ghi âm (RECORD_AUDIO).")
            return
        }
        if (!isRecording.compareAndSet(false, true)) {
            listener.onError("Đang ghi âm mẫu giọng nói.")
            return
        }

        val sampleRate = AudioPreprocessor.ENCODER_SAMPLE_RATE
        val maxSamples = (AudioPreprocessor.MAX_REFERENCE_SECONDS * sampleRate).toInt()
        val captured = ShortArray(maxSamples)
        var capturedLen = 0

        recordJob = scope.launch(Dispatchers.IO) {
            var recorder: AudioRecord? = null
            try {
                val minBuf = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                )
                val bufBytes = max(minBuf * 2, sampleRate / 5 * 2)
                recorder = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufBytes,
                )
                if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                    recorder.release()
                    recorder = AudioRecord(
                        MediaRecorder.AudioSource.MIC,
                        sampleRate,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        bufBytes,
                    )
                }
                if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                    throw IllegalStateException("Không thể mở micro 16kHz Mono PCM16.")
                }

                val chunk = ShortArray(sampleRate / 20)
                recorder.startRecording()
                val startMs = System.currentTimeMillis()

                while (isActive && isRecording.get() && capturedLen < maxSamples) {
                    val n = recorder.read(chunk, 0, chunk.size)
                    if (n > 0) {
                        var sumSq = 0.0
                        for (i in 0 until n) {
                            val v = chunk[i] / 32768.0
                            sumSq += v * v
                        }
                        val rms = sqrt(sumSq / n).toFloat().coerceIn(0f, 1f)
                        val copy = min(n, maxSamples - capturedLen)
                        System.arraycopy(chunk, 0, captured, capturedLen, copy)
                        capturedLen += copy

                        val elapsed = System.currentTimeMillis() - startMs
                        withContext(Dispatchers.Main) { listener.onRecordingTick(elapsed, rms) }
                        if (elapsed >= 10_000L || capturedLen >= maxSamples) {
                            isRecording.set(false)
                            break
                        }
                    }
                }

                try { recorder.stop() } catch (_: IllegalStateException) {}
                recorder.release()
                recorder = null

                // Ensure neural TTS models are unloaded before running Speaker Encoder to keep RAM minimal
                neuralTts.stop()
                neuralTts.unloadModels()

                withContext(Dispatchers.Main) { listener.onEncodingEmbedding() }

                val profile = speakerEncoder.enrollFromPcm16(
                    rawPcm16 = captured.copyOf(capturedLen),
                    sourceSampleRate = sampleRate,
                    channels = 1,
                    displayName = displayName,
                )
                withContext(Dispatchers.Main) { listener.onEnrolled(profile) }
            } catch (err: Throwable) {
                isRecording.set(false)
                withContext(Dispatchers.Main) {
                    listener.onError(err.message ?: "Lỗi nhân bản giọng nói Zero-Shot.")
                }
            } finally {
                try { recorder?.release() } catch (_: Throwable) {}
            }
        }
    }

    fun stopEnrollmentRecording() {
        isRecording.set(false)
    }

    suspend fun enrollFromImportedWav(
        wavFile: File,
        displayName: String,
    ): SpeakerEncoderEngine.CachedVoiceEmbedding {
        neuralTts.stop()
        neuralTts.unloadModels()
        return speakerEncoder.enrollFromWavFile(wavFile, displayName)
    }

    /**
     * Speaks a book chapter:
     *  - Cloned voice (`clone_*`): strictly detaches Android System TTS & runs 100% Neural Zero-Shot ONNX.
     *  - Built-in voice: stops Neural ONNX engine and delegates cleanly to System Android TTS.
     */
    fun speakChapter(
        paragraphs: List<String>,
        voiceId: String,
        startParagraphIndex: Int,
        speechRate: Float,
        listener: NeuralZeroShotTtsEngine.StreamListener,
    ) {
        if (voiceId.startsWith("clone_")) {
            detachSystemTts()
            activeUsingClone = true
            neuralTts.speakChapter(paragraphs, voiceId, startParagraphIndex, speechRate, listener)
            return
        }

        neuralTts.stop()
        activeUsingClone = false
        speakWithSystemTts(paragraphs, startParagraphIndex, speechRate, listener)
    }

    fun pause() {
        if (activeUsingClone) neuralTts.pause() else systemTts?.stop()
    }

    fun resume() {
        if (activeUsingClone) neuralTts.resume()
    }

    fun stopAll() {
        neuralTts.stop()
        detachSystemTts()
    }

    fun destroy() {
        isRecording.set(false)
        recordJob?.cancel()
        stopAll()
        try { systemTts?.shutdown() } catch (_: Throwable) {}
        systemTts = null
        neuralTts.destroy()
        scope.cancel()
    }

    private fun detachSystemTts() {
        try {
            systemTts?.setOnUtteranceProgressListener(null)
            systemTts?.stop()
        } catch (_: Throwable) {}
    }

    private fun speakWithSystemTts(
        paragraphs: List<String>,
        startIndex: Int,
        speechRate: Float,
        listener: NeuralZeroShotTtsEngine.StreamListener,
    ) {
        var idx = startIndex.coerceIn(0, max(0, paragraphs.size - 1))
        val runNext = object {
            fun speak() {
                val tts = systemTts ?: return
                while (idx < paragraphs.size && paragraphs[idx].isBlank()) idx++
                if (idx >= paragraphs.size) {
                    listener.onPlaybackStateChanged(false)
                    listener.onCompleted()
                    return
                }
                tts.language = Locale("vi", "VN")
                tts.setSpeechRate(speechRate.coerceIn(0.6f, 1.85f))
                tts.speak(paragraphs[idx], TextToSpeech.QUEUE_FLUSH, null, idx.toString())
            }
        }
        val attach = {
            val tts = systemTts
            if (tts != null && systemTtsReady) {
                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        val p = utteranceId?.toIntOrNull() ?: return
                        listener.onHighlightSentence(p, 0, paragraphs.getOrElse(p) { "" })
                    }
                    override fun onDone(utteranceId: String?) {
                        if (activeUsingClone) return
                        idx++
                        runNext.speak()
                    }
                    @Deprecated("Deprecated in Android API")
                    override fun onError(utteranceId: String?) {
                        listener.onPlaybackStateChanged(false)
                        listener.onError("Lỗi TextToSpeech hệ thống.")
                    }
                })
                listener.onPlaybackStateChanged(true)
                runNext.speak()
            }
        }
        if (systemTts == null) {
            systemTts = TextToSpeech(context.applicationContext) { status ->
                systemTtsReady = status == TextToSpeech.SUCCESS
                if (systemTtsReady && !activeUsingClone) attach()
            }
        } else if (systemTtsReady) {
            attach()
        }
    }
}
