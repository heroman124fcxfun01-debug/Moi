package com.bookhad.app.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * On-Device Speaker Voice Cloner optimized for 4GB RAM Android phones (Helio G99, NO NPU).
 *
 * Lifecycle guarantee:
 *  1. Records 6–10 seconds of mono 16-bit PCM audio at 16,000 Hz (exact encoder sample rate).
 *  2. Trims leading/trailing silence and normalizes ShortArray -> FloatArray in [-1.0f, 1.0f].
 *  3. Loads speaker_encoder.onnx TEMPORARILY via C++ mmap (String path, never ByteArray).
 *  4. Extracts L2-normalized speaker embedding vector and writes binary .emb + .meta.json to filesDir/voices/.
 *  5. IMMEDIATELY closes OnnxTensor, Result, OrtSession, and SessionOptions in a finally block so
 *     RAM is completely freed before the TTS engine ever starts.
 */
class VoiceCloner(private val context: Context) {

    companion object {
        private const val TAG = "VoiceCloner"

        const val ENCODER_SAMPLE_RATE = 16_000
        const val MIN_RECORD_MS = 6_000L
        const val MAX_RECORD_MS = 10_000L
        private const val MIN_VOICED_SECONDS = 2.5f
        private const val SILENCE_FRAME_MS = 20
        private const val SILENCE_RMS_THRESHOLD = 0.012f
        private const val GUARD_MS = 100
        private const val MEL_BINS = 80
        private const val FFT_SIZE = 512
        private const val HOP_LENGTH = 160 // 10ms at 16kHz
    }

    data class ClonedVoiceProfile(
        val id: String,
        val name: String,
        val embeddingFilePath: String,
        val embeddingDim: Int,
        val durationSec: Float,
        val createdAtEpochMs: Long,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id)
            put("name", name)
            put("embeddingFilePath", embeddingFilePath)
            put("embeddingDim", embeddingDim)
            put("durationSec", durationSec.toDouble())
            put("createdAtEpochMs", createdAtEpochMs)
        }
    }

    interface Listener {
        fun onRecordingProgress(elapsedMs: Long, rmsLevel: Float)
        fun onEncodingStarted()
        fun onVoiceCloned(profile: ClonedVoiceProfile)
        fun onError(message: String)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val isRecordingFlag = AtomicBoolean(false)
    private var recordingJob: Job? = null
    private val capturedSamplesLock = Any()
    private var capturedPcmShorts: ShortArray = ShortArray(0)
    private var capturedLength: Int = 0
    private var activeListener: Listener? = null
    private var activeVoiceName: String = "Giọng cá nhân"

    fun isRecording(): Boolean = isRecordingFlag.get()

    /**
     * Begins capturing 6–10 seconds of mono 16kHz PCM audio on Dispatchers.IO.
     * Auto-stops at MAX_RECORD_MS (10s) and triggers embedding extraction automatically.
     */
    fun startRecording(voiceName: String, listener: Listener) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            listener.onError("Chưa cấp quyền micro (RECORD_AUDIO). Vui lòng cấp quyền để nhân bản giọng.")
            return
        }

        if (!isRecordingFlag.compareAndSet(false, true)) {
            listener.onError("Đang ghi âm mẫu giọng nói.")
            return
        }

        activeVoiceName = voiceName.trim().ifEmpty { "Giọng của tôi" }
        activeListener = listener

        val maxSamples = ((MAX_RECORD_MS / 1000L) * ENCODER_SAMPLE_RATE).toInt()
        synchronized(capturedSamplesLock) {
            capturedPcmShorts = ShortArray(maxSamples)
            capturedLength = 0
        }

        recordingJob = scope.launch(Dispatchers.IO) {
            var recorder: AudioRecord? = null
            try {
                val minBufBytes = AudioRecord.getMinBufferSize(
                    ENCODER_SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                )
                val bufferBytes = max(minBufBytes * 2, ENCODER_SAMPLE_RATE / 5 * 2) // >= 200ms

                recorder = createAudioRecordWithFallback(bufferBytes)
                if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                    throw IllegalStateException("Không thể khởi tạo AudioRecord (16kHz Mono PCM16).")
                }

                val readChunk = ShortArray(ENCODER_SAMPLE_RATE / 20) // 50ms = 800 samples
                recorder.startRecording()
                val startTimeMs = System.currentTimeMillis()

                while (isActive && isRecordingFlag.get()) {
                    val readCount = recorder.read(readChunk, 0, readChunk.size)
                    if (readCount > 0) {
                        var sumSquares = 0.0
                        for (i in 0 until readCount) {
                            val norm = readChunk[i] / 32768.0
                            sumSquares += norm * norm
                        }
                        val rms = sqrt(sumSquares / readCount).toFloat().coerceIn(0f, 1f)

                        var reachedMax = false
                        synchronized(capturedSamplesLock) {
                            val remaining = capturedPcmShorts.size - capturedLength
                            val copyCount = min(readCount, remaining)
                            if (copyCount > 0) {
                                System.arraycopy(readChunk, 0, capturedPcmShorts, capturedLength, copyCount)
                                capturedLength += copyCount
                            }
                            if (capturedLength >= capturedPcmShorts.size) {
                                reachedMax = true
                            }
                        }

                        val elapsedMs = System.currentTimeMillis() - startTimeMs
                        withContext(Dispatchers.Main) {
                            listener.onRecordingProgress(elapsedMs.coerceAtMost(MAX_RECORD_MS), rms)
                        }

                        if (reachedMax || elapsedMs >= MAX_RECORD_MS) {
                            isRecordingFlag.set(false)
                            break
                        }
                    } else if (readCount < 0) {
                        throw IllegalStateException("Lỗi đọc dữ liệu micro (mã $readCount).")
                    }
                }

                try {
                    recorder.stop()
                } catch (_: IllegalStateException) {
                    // Already stopped
                }
                recorder.release()
                recorder = null

                val snapshot = snapshotCapturedPcm()
                val durationMs = (snapshot.size * 1000L) / ENCODER_SAMPLE_RATE
                if (durationMs < MIN_RECORD_MS - 500L) {
                    withContext(Dispatchers.Main) {
                        listener.onError("Mẫu giọng quá ngắn (${durationMs / 1000}s). Vui lòng đọc liên tục 6–10 giây.")
                    }
                    return@launch
                }

                withContext(Dispatchers.Main) {
                    listener.onEncodingStarted()
                }

                val profile = extractAndSaveEmbeddingInternal(
                    rawPcm16 = snapshot,
                    inputSampleRate = ENCODER_SAMPLE_RATE,
                    voiceName = activeVoiceName,
                )

                withContext(Dispatchers.Main) {
                    listener.onVoiceCloned(profile)
                }
            } catch (err: Throwable) {
                Log.e(TAG, "Voice cloning failed", err)
                isRecordingFlag.set(false)
                withContext(Dispatchers.Main) {
                    listener.onError(err.message ?: "Lỗi nhân bản giọng nói trên thiết bị.")
                }
            } finally {
                try {
                    recorder?.release()
                } catch (_: Throwable) {
                }
            }
        }
    }

    /**
     * Stops an active recording early (must have at least ~6 seconds captured to succeed)
     * and lets the coroutine proceed directly into speaker_encoder.onnx extraction.
     */
    fun stopRecordingAndClone() {
        isRecordingFlag.set(false)
    }

    /**
     * Cancels recording without encoding or saving.
     */
    fun cancelRecording() {
        isRecordingFlag.set(false)
        recordingJob?.cancel()
        recordingJob = null
    }

    /**
     * Clones a voice directly from an external PCM16 buffer (e.g. imported WAV file).
     * Automatically resamples to 16,000 Hz if source sample rate differs.
     */
    suspend fun cloneFromPcm16(
        rawPcm16: ShortArray,
        inputSampleRate: Int,
        voiceName: String,
    ): ClonedVoiceProfile = withContext(Dispatchers.Default) {
        extractAndSaveEmbeddingInternal(rawPcm16, inputSampleRate, voiceName)
    }

    /**
     * Lists all saved cloned voice profiles from context.filesDir/voices/.
     */
    fun listClonedVoices(): List<ClonedVoiceProfile> {
        val dir = OnnxAssetExtractor.getVoicesDirectory(context)
        val metaFiles = dir.listFiles { f -> f.isFile && f.name.endsWith(".meta.json") }
            ?: return emptyList()

        val profiles = mutableListOf<ClonedVoiceProfile>()
        for (metaFile in metaFiles) {
            try {
                val json = JSONObject(metaFile.readText(Charsets.UTF_8))
                val embPath = json.getString("embeddingFilePath")
                val embFile = File(embPath)
                if (!embFile.exists() || embFile.length() <= 0L) continue
                profiles.add(
                    ClonedVoiceProfile(
                        id = json.getString("id"),
                        name = json.getString("name"),
                        embeddingFilePath = embPath,
                        embeddingDim = json.getInt("embeddingDim"),
                        durationSec = json.getDouble("durationSec").toFloat(),
                        createdAtEpochMs = json.getLong("createdAtEpochMs"),
                    )
                )
            } catch (err: Throwable) {
                Log.w(TAG, "Skipping malformed voice metadata ${metaFile.name}: ${err.message}")
            }
        }
        return profiles.sortedByDescending { it.createdAtEpochMs }
    }

    fun listClonedVoicesJson(): String {
        val arr = JSONArray()
        for (profile in listClonedVoices()) {
            arr.put(profile.toJson())
        }
        return arr.toString()
    }

    fun deleteClonedVoice(voiceId: String): Boolean {
        val dir = OnnxAssetExtractor.getVoicesDirectory(context)
        val embDeleted = File(dir, "$voiceId.emb").delete()
        val metaDeleted = File(dir, "$voiceId.meta.json").delete()
        return embDeleted || metaDeleted
    }

    /**
     * Loads a persisted binary Float32 speaker embedding (.emb) from filesDir/voices/.
     */
    fun loadEmbeddingVector(voiceId: String): FloatArray {
        val embFile = File(OnnxAssetExtractor.getVoicesDirectory(context), "$voiceId.emb")
        if (!embFile.exists() || embFile.length() < 8L) {
            throw IllegalArgumentException("Không tìm thấy file vector giọng (.emb) cho ID: $voiceId")
        }
        DataInputStream(BufferedInputStream(FileInputStream(embFile))).use { dis ->
            val dim = dis.readInt()
            if (dim <= 0 || dim > 4096) {
                throw IllegalStateException("Kích thước vector giọng không hợp lệ: $dim")
            }
            val bytes = ByteArray(dim * 4)
            dis.readFully(bytes)
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            val result = FloatArray(dim)
            for (i in 0 until dim) {
                result[i] = buffer.float
            }
            return result
        }
    }

    fun release() {
        cancelRecording()
        scope.cancel()
    }

    private fun createAudioRecordWithFallback(bufferBytes: Int): AudioRecord {
        val primary = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            ENCODER_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferBytes,
        )
        if (primary.state == AudioRecord.STATE_INITIALIZED) {
            return primary
        }
        primary.release()
        return AudioRecord(
            MediaRecorder.AudioSource.MIC,
            ENCODER_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferBytes,
        )
    }

    private fun snapshotCapturedPcm(): ShortArray {
        synchronized(capturedSamplesLock) {
            return capturedPcmShorts.copyOf(capturedLength)
        }
    }

    private suspend fun extractAndSaveEmbeddingInternal(
        rawPcm16: ShortArray,
        inputSampleRate: Int,
        voiceName: String,
    ): ClonedVoiceProfile = withContext(Dispatchers.Default) {
        // 1. Convert ShortArray PCM16 -> normalized FloatArray [-1.0f, 1.0f]
        var floatAudio = normalizePcm16ToFloat(rawPcm16)

        // 2. Resample to 16,000 Hz if source rate differs
        if (inputSampleRate != ENCODER_SAMPLE_RATE) {
            floatAudio = resampleLinear(floatAudio, inputSampleRate, ENCODER_SAMPLE_RATE)
        }

        // 3. Trim leading and trailing silence
        val trimmed = trimLeadingTrailingSilence(floatAudio, ENCODER_SAMPLE_RATE)
        val voicedSec = trimmed.size.toFloat() / ENCODER_SAMPLE_RATE.toFloat()
        if (voicedSec < MIN_VOICED_SECONDS) {
            throw IllegalArgumentException(
                "Âm lượng giọng nói quá nhỏ hoặc ít hơn 3 giây tiếng nói rõ. Hãy thử lại ở nơi yên tĩnh."
            )
        }

        // 4. Peak-normalize waveform to 0.92f for consistent speaker encoder SNR
        val cleanAudio = peakNormalize(trimmed, targetPeak = 0.92f)

        // 5. Ensure APK assets are extracted to context.filesDir
        val paths = OnnxAssetExtractor.ensureExtracted(context)
        val env = OrtEnvironment.getEnvironment()

        // 6. Temporarily load speaker_encoder.onnx via mmap, run inference, and ALWAYS close in finally
        var sessionOptions: OrtSession.SessionOptions? = null
        var encoderSession: OrtSession? = null
        var inputTensor: OnnxTensor? = null
        var outputResult: OrtSession.Result? = null

        val rawEmbedding: FloatArray = try {
            sessionOptions = OnnxAssetExtractor.createHelioG99SessionOptions()
            encoderSession = OnnxAssetExtractor.openMmapSession(
                env = env,
                modelFile = paths.speakerEncoderModel,
                options = sessionOptions,
            )

            val inputName = encoderSession.inputNames.first()
            val inputNodeInfo = encoderSession.inputInfo[inputName]?.info as? TensorInfo
            val expectedRank = inputNodeInfo?.shape?.size ?: 2

            inputTensor = if (expectedRank == 3) {
                // Model expects [1, frames, 80] or [1, 80, frames] log-Mel spectrogram
                val mel = computeLogMelSpectrogram80(cleanAudio, ENCODER_SAMPLE_RATE)
                val shape = inputNodeInfo?.shape
                val channelFirst = shape != null && shape.size == 3 && shape[1] == MEL_BINS.toLong()
                if (channelFirst) {
                    val transposed = transposeMelToChannelFirst(mel.data, mel.frames, MEL_BINS)
                    OnnxTensor.createTensor(
                        env,
                        FloatBuffer.wrap(transposed),
                        longArrayOf(1L, MEL_BINS.toLong(), mel.frames.toLong()),
                    )
                } else {
                    OnnxTensor.createTensor(
                        env,
                        FloatBuffer.wrap(mel.data),
                        longArrayOf(1L, mel.frames.toLong(), MEL_BINS.toLong()),
                    )
                }
            } else {
                // Model expects raw waveform [1, num_samples] in [-1.0f, 1.0f]
                OnnxTensor.createTensor(
                    env,
                    FloatBuffer.wrap(cleanAudio),
                    longArrayOf(1L, cleanAudio.size.toLong()),
                )
            }

            outputResult = encoderSession.run(mapOf(inputName to inputTensor))
            val outTensor = outputResult[0] as OnnxTensor
            val floatBuf = outTensor.floatBuffer
            val extracted = FloatArray(floatBuf.remaining())
            floatBuf.get(extracted)
            l2Normalize(extracted)
        } finally {
            // Mandatory memory release on 4GB RAM device
            try { outputResult?.close() } catch (_: Throwable) {}
            try { inputTensor?.close() } catch (_: Throwable) {}
            try { encoderSession?.close() } catch (_: Throwable) {}
            try { sessionOptions?.close() } catch (_: Throwable) {}
            Log.i(TAG, "speaker_encoder.onnx session and tensors closed and freed from RAM.")
        }

        // 7. Persist binary .emb + .meta.json into context.filesDir/voices/
        val voiceId = "clone_${UUID.randomUUID().toString().replace("-", "").take(12)}"
        val voicesDir = OnnxAssetExtractor.getVoicesDirectory(context)
        val embFile = File(voicesDir, "$voiceId.emb")
        val metaFile = File(voicesDir, "$voiceId.meta.json")

        writeEmbeddingFile(embFile, rawEmbedding)

        val profile = ClonedVoiceProfile(
            id = voiceId,
            name = voiceName.trim().ifEmpty { "Giọng của tôi" },
            embeddingFilePath = embFile.absolutePath,
            embeddingDim = rawEmbedding.size,
            durationSec = voicedSec,
            createdAtEpochMs = System.currentTimeMillis(),
        )
        metaFile.writeText(profile.toJson().toString(), Charsets.UTF_8)
        profile
    }

    private fun writeEmbeddingFile(file: File, embedding: FloatArray) {
        DataOutputStream(BufferedOutputStream(FileOutputStream(file))).use { dos ->
            dos.writeInt(embedding.size)
            val byteBuf = ByteBuffer.allocate(embedding.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            for (v in embedding) {
                byteBuf.putFloat(v)
            }
            dos.write(byteBuf.array())
            dos.flush()
        }
    }

    private fun normalizePcm16ToFloat(pcm: ShortArray): FloatArray {
        val out = FloatArray(pcm.size)
        var mean = 0.0
        for (i in pcm.indices) {
            val v = pcm[i] / 32768.0f
            out[i] = v
            mean += v
        }
        if (pcm.isNotEmpty()) {
            val dcOffset = (mean / pcm.size).toFloat()
            for (i in out.indices) {
                out[i] = (out[i] - dcOffset).coerceIn(-1.0f, 1.0f)
            }
        }
        return out
    }

    private fun trimLeadingTrailingSilence(audio: FloatArray, sampleRate: Int): FloatArray {
        val frameSize = max(1, (sampleRate * SILENCE_FRAME_MS) / 1000)
        val guardSamples = (sampleRate * GUARD_MS) / 1000
        val totalFrames = audio.size / frameSize
        if (totalFrames <= 2) return audio

        var firstVoicedFrame = -1
        var lastVoicedFrame = -1

        for (f in 0 until totalFrames) {
            val start = f * frameSize
            val end = min(audio.size, start + frameSize)
            var sumSq = 0.0
            for (i in start until end) {
                val s = audio[i].toDouble()
                sumSq += s * s
            }
            val rms = sqrt(sumSq / max(1, end - start)).toFloat()
            if (rms >= SILENCE_RMS_THRESHOLD) {
                if (firstVoicedFrame == -1) firstVoicedFrame = f
                lastVoicedFrame = f
            }
        }

        if (firstVoicedFrame == -1 || lastVoicedFrame < firstVoicedFrame) {
            return FloatArray(0)
        }

        val startSample = max(0, firstVoicedFrame * frameSize - guardSamples)
        val endSample = min(audio.size, (lastVoicedFrame + 1) * frameSize + guardSamples)
        return audio.copyOfRange(startSample, endSample)
    }

    private fun peakNormalize(audio: FloatArray, targetPeak: Float): FloatArray {
        var peak = 0f
        for (s in audio) {
            val a = abs(s)
            if (a > peak) peak = a
        }
        if (peak < 1e-5f) return audio
        val gain = (targetPeak / peak).coerceAtMost(8.0f)
        val out = FloatArray(audio.size)
        for (i in audio.indices) {
            out[i] = (audio[i] * gain).coerceIn(-1.0f, 1.0f)
        }
        return out
    }

    private fun l2Normalize(vec: FloatArray): FloatArray {
        var sumSq = 0.0
        for (v in vec) sumSq += v.toDouble() * v.toDouble()
        val norm = sqrt(sumSq).toFloat()
        if (norm < 1e-8f) return vec
        return FloatArray(vec.size) { i -> vec[i] / norm }
    }

    /**
     * Fast linear resampler to guarantee exact sample-rate synchronization across
     * AudioRecord, ONNX inference, and AudioTrack.
     */
    fun resampleLinear(input: FloatArray, srcRate: Int, dstRate: Int): FloatArray {
        if (srcRate == dstRate || input.isEmpty()) return input
        val ratio = srcRate.toDouble() / dstRate.toDouble()
        val outSize = max(1, (input.size / ratio).toInt())
        val output = FloatArray(outSize)
        val lastIdx = input.size - 1
        for (i in 0 until outSize) {
            val srcPos = i * ratio
            val idx0 = srcPos.toInt().coerceIn(0, lastIdx)
            val idx1 = min(idx0 + 1, lastIdx)
            val frac = (srcPos - idx0).toFloat()
            output[i] = input[idx0] * (1.0f - frac) + input[idx1] * frac
        }
        return output
    }

    private data class MelResult(val data: FloatArray, val frames: Int)

    private fun computeLogMelSpectrogram80(audio: FloatArray, sampleRate: Int): MelResult {
        val frames = max(1, (audio.size - FFT_SIZE) / HOP_LENGTH + 1)
        val window = FloatArray(FFT_SIZE) { n ->
            (0.5 - 0.5 * cos(2.0 * PI * n / (FFT_SIZE - 1))).toFloat()
        }
        val numBins = FFT_SIZE / 2 + 1
        val melFilters = buildMelFilterbank(sampleRate, FFT_SIZE, MEL_BINS)
        val out = FloatArray(frames * MEL_BINS)
        val real = DoubleArray(FFT_SIZE)
        val imag = DoubleArray(FFT_SIZE)
        val power = FloatArray(numBins)

        for (f in 0 until frames) {
            val offset = f * HOP_LENGTH
            for (n in 0 until FFT_SIZE) {
                val sample = if (offset + n < audio.size) audio[offset + n] else 0f
                real[n] = (sample * window[n]).toDouble()
                imag[n] = 0.0
            }
            fftRadix2(real, imag)
            for (k in 0 until numBins) {
                power[k] = (real[k] * real[k] + imag[k] * imag[k]).toFloat()
            }
            val rowOffset = f * MEL_BINS
            for (m in 0 until MEL_BINS) {
                var energy = 1e-6f
                val filterRow = melFilters[m]
                for (k in 0 until numBins) {
                    val w = filterRow[k]
                    if (w > 0f) energy += power[k] * w
                }
                out[rowOffset + m] = ln(energy.toDouble()).toFloat()
            }
        }
        return MelResult(out, frames)
    }

    private fun transposeMelToChannelFirst(data: FloatArray, frames: Int, melBins: Int): FloatArray {
        val out = FloatArray(frames * melBins)
        for (f in 0 until frames) {
            for (m in 0 until melBins) {
                out[m * frames + f] = data[f * melBins + m]
            }
        }
        return out
    }

    private fun buildMelFilterbank(sampleRate: Int, fftSize: Int, melBins: Int): Array<FloatArray> {
        val numSpecBins = fftSize / 2 + 1
        val lowMel = hzToMel(80.0)
        val highMel = hzToMel(min(7600.0, sampleRate / 2.0))
        val melPoints = DoubleArray(melBins + 2) { i ->
            lowMel + (highMel - lowMel) * i / (melBins + 1)
        }
        val binIndices = IntArray(melBins + 2) { i ->
            val hz = melToHz(melPoints[i])
            ((fftSize + 1) * hz / sampleRate).toInt().coerceIn(0, numSpecBins - 1)
        }
        return Array(melBins) { m ->
            val filter = FloatArray(numSpecBins)
            val left = binIndices[m]
            val center = binIndices[m + 1]
            val right = binIndices[m + 2]
            for (k in left until center) {
                if (center > left) filter[k] = (k - left).toFloat() / (center - left).toFloat()
            }
            for (k in center..right) {
                if (right > center) filter[k] = (right - k).toFloat() / (right - center).toFloat()
            }
            filter
        }
    }

    private fun hzToMel(hz: Double): Double = 2595.0 * kotlin.math.log10(1.0 + hz / 700.0)
    private fun melToHz(mel: Double): Double = 700.0 * (10.0.pow(mel / 2595.0) - 1.0)

    private fun fftRadix2(real: DoubleArray, imag: DoubleArray) {
        val n = real.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                val tr = real[i]; real[i] = real[j]; real[j] = tr
                val ti = imag[i]; imag[i] = imag[j]; imag[j] = ti
            }
        }
        var len = 2
        while (len <= n) {
            val ang = -2.0 * PI / len
            val wLenRe = cos(ang)
            val wLenIm = sin(ang)
            var i = 0
            while (i < n) {
                var wRe = 1.0
                var wIm = 0.0
                for (k in 0 until len / 2) {
                    val uRe = real[i + k]
                    val uIm = imag[i + k]
                    val vRe = real[i + k + len / 2] * wRe - imag[i + k + len / 2] * wIm
                    val vIm = real[i + k + len / 2] * wIm + imag[i + k + len / 2] * wRe
                    real[i + k] = uRe + vRe
                    imag[i + k] = uIm + vIm
                    real[i + k + len / 2] = uRe - vRe
                    imag[i + k + len / 2] = uIm - vIm
                    val nextRe = wRe * wLenRe - wIm * wLenIm
                    wIm = wRe * wLenIm + wIm * wLenRe
                    wRe = nextRe
                }
                i += len
            }
            len = len shl 1
        }
    }
}
