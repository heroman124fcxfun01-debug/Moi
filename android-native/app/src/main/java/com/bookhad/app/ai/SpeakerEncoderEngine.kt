package com.bookhad.app.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
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
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Pipeline Step 2: Neural Speaker Encoder (Run ONCE & Cache).
 *
 * Extracts a compact neural Speaker Embedding vector (256–512 float32 values, ~1–2 KB)
 * using quantized INT8 speaker_encoder_int8.onnx (ECAPA-TDNN / OpenVoice V2 Tone Color Extractor).
 *
 * Memory Safety on 4GB RAM Helio G99:
 *  - Opens speaker_encoder_int8.onnx temporarily via native mmap.
 *  - Saves the ~1 KB .emb cache file to context.filesDir/voice_embeddings/<voiceId>.emb.
 *  - IMMEDIATELY closes OnnxTensor, Result, OrtSession, and SessionOptions in `finally`
 *    so the Speaker Encoder occupies 0 MB RAM during TTS playback.
 *  - Subsequent TTS generations ONLY load the ~1 KB .emb file — never re-analyzing the original audio.
 */
class SpeakerEncoderEngine(private val context: Context) {

    companion object {
        private const val TAG = "SpeakerEncoderEngine"
        private const val MEL_BINS = 80
        private const val FFT_SIZE = 512
        private const val HOP_LENGTH = 160 // 10ms hop at 16kHz
    }

    data class CachedVoiceEmbedding(
        val voiceId: String,
        val displayName: String,
        val embeddingPath: String,
        val embeddingDim: Int,
        val embeddingBytes: Long,
        val referenceDurationSec: Float,
        val createdAtMs: Long,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("id", voiceId)
            put("name", displayName)
            put("embeddingPath", embeddingPath)
            put("embeddingDim", embeddingDim)
            put("embeddingBytes", embeddingBytes)
            put("durationSec", referenceDurationSec.toDouble())
            put("createdAtMs", createdAtMs)
        }
    }

    /**
     * Runs Step 1 + Step 2 from a 5–10s WAV file and caches the ~1 KB Speaker Embedding.
     */
    suspend fun enrollFromWavFile(
        wavFile: File,
        displayName: String,
    ): CachedVoiceEmbedding = withContext(Dispatchers.Default) {
        val cleanAudio = AudioPreprocessor.preprocessWavFile(
            wavFile = wavFile,
            targetSampleRate = AudioPreprocessor.ENCODER_SAMPLE_RATE,
        )
        extractAndCacheEmbedding(cleanAudio, displayName)
    }

    /**
     * Runs Step 1 + Step 2 from recorded Mono/Stereo PCM16 samples and caches the ~1 KB Speaker Embedding.
     */
    suspend fun enrollFromPcm16(
        rawPcm16: ShortArray,
        sourceSampleRate: Int,
        channels: Int,
        displayName: String,
    ): CachedVoiceEmbedding = withContext(Dispatchers.Default) {
        val cleanAudio = AudioPreprocessor.preprocessPcm16(
            rawPcm16 = rawPcm16,
            sourceSampleRate = sourceSampleRate,
            channels = channels,
            targetSampleRate = AudioPreprocessor.ENCODER_SAMPLE_RATE,
        )
        extractAndCacheEmbedding(cleanAudio, displayName)
    }

    /**
     * Loads the cached ~1 KB float32 Speaker Embedding vector directly from disk.
     * Takes < 1ms and requires ZERO re-encoding of the original voice audio.
     */
    fun loadCachedEmbedding(voiceId: String): FloatArray {
        val embFile = File(OnnxRuntimeConfig.getEmbeddingCacheDir(context), "$voiceId.emb")
        if (!embFile.exists() || embFile.length() < 8L) {
            throw IllegalArgumentException("Không tìm thấy cache Speaker Embedding (.emb) cho giọng $voiceId.")
        }
        DataInputStream(BufferedInputStream(FileInputStream(embFile))).use { dis ->
            val dim = dis.readInt()
            if (dim <= 0 || dim > 4096) {
                throw IllegalStateException("File embedding bị hỏng (dim=$dim).")
            }
            val bytes = ByteArray(dim * 4)
            dis.readFully(bytes)
            val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            return FloatArray(dim) { bb.float }
        }
    }

    fun listCachedVoices(): List<CachedVoiceEmbedding> {
        val dir = OnnxRuntimeConfig.getEmbeddingCacheDir(context)
        val metas = dir.listFiles { f -> f.isFile && f.name.endsWith(".meta.json") } ?: return emptyList()
        val list = mutableListOf<CachedVoiceEmbedding>()
        for (meta in metas) {
            try {
                val obj = JSONObject(meta.readText(Charsets.UTF_8))
                val embPath = obj.getString("embeddingPath")
                val embFile = File(embPath)
                if (!embFile.exists() || embFile.length() <= 0L) continue
                list.add(
                    CachedVoiceEmbedding(
                        voiceId = obj.getString("id"),
                        displayName = obj.getString("name"),
                        embeddingPath = embPath,
                        embeddingDim = obj.getInt("embeddingDim"),
                        embeddingBytes = embFile.length(),
                        referenceDurationSec = obj.getDouble("durationSec").toFloat(),
                        createdAtMs = obj.getLong("createdAtMs"),
                    )
                )
            } catch (err: Throwable) {
                Log.w(TAG, "Skipping invalid voice cache ${meta.name}: ${err.message}")
            }
        }
        return list.sortedByDescending { it.createdAtMs }
    }

    fun listCachedVoicesJson(): String {
        val arr = JSONArray()
        for (item in listCachedVoices()) arr.put(item.toJson())
        return arr.toString()
    }

    fun deleteCachedVoice(voiceId: String): Boolean {
        val dir = OnnxRuntimeConfig.getEmbeddingCacheDir(context)
        val a = File(dir, "$voiceId.emb").delete()
        val b = File(dir, "$voiceId.meta.json").delete()
        return a || b
    }

    private fun extractAndCacheEmbedding(
        cleanAudio: AudioPreprocessor.PreprocessedAudio,
        displayName: String,
    ): CachedVoiceEmbedding {
        val paths = OnnxRuntimeConfig.ensureModelsExtracted(context)
        val env = OrtEnvironment.getEnvironment()

        var options: OrtSession.SessionOptions? = null
        var session: OrtSession? = null
        var inputTensor: OnnxTensor? = null
        var result: OrtSession.Result? = null

        val embeddingVector: FloatArray = try {
            options = OnnxRuntimeConfig.createHelioG99CpuOptions(
                requestedThreads = OnnxRuntimeConfig.DEFAULT_INTRA_OP_THREADS
            )
            session = OnnxRuntimeConfig.openMmapSession(env, paths.speakerEncoderFile, options)

            val inputName = session.inputNames.first()
            val tensorInfo = session.inputInfo[inputName]?.info as? TensorInfo
            val rank = tensorInfo?.shape?.size ?: 3

            inputTensor = if (rank == 3) {
                // Most ECAPA-TDNN / OpenVoice V2 encoders accept 80-bin Log-Mel [1, 80, T] or [1, T, 80]
                val mel = computeLogMel80(cleanAudio.samples, cleanAudio.sampleRate)
                val shape = tensorInfo?.shape
                val isChannelFirst = shape != null && shape.size == 3 && shape[1] == MEL_BINS.toLong()
                if (isChannelFirst) {
                    val cf = transposeToChannelFirst(mel.data, mel.frames, MEL_BINS)
                    OnnxTensor.createTensor(
                        env,
                        FloatBuffer.wrap(cf),
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
                // End-to-end waveform speaker encoders accept [1, num_samples]
                OnnxTensor.createTensor(
                    env,
                    FloatBuffer.wrap(cleanAudio.samples),
                    longArrayOf(1L, cleanAudio.samples.size.toLong()),
                )
            }

            result = session.run(mapOf(inputName to inputTensor))
            val outTensor = result[0] as OnnxTensor
            val fb = outTensor.floatBuffer
            val raw = FloatArray(fb.remaining())
            fb.get(raw)
            l2Normalize(raw)
        } finally {
            // Mandatory immediate release: Speaker Encoder takes 0 MB RAM once .emb is cached
            try { result?.close() } catch (_: Throwable) {}
            try { inputTensor?.close() } catch (_: Throwable) {}
            try { session?.close() } catch (_: Throwable) {}
            try { options?.close() } catch (_: Throwable) {}
            Log.i(TAG, "speaker_encoder_int8.onnx closed immediately after embedding extraction.")
        }

        val voiceId = "clone_${UUID.randomUUID().toString().replace("-", "").take(12)}"
        val cacheDir = OnnxRuntimeConfig.getEmbeddingCacheDir(context)
        val embFile = File(cacheDir, "$voiceId.emb")
        val metaFile = File(cacheDir, "$voiceId.meta.json")

        writeEmbeddingBinary(embFile, embeddingVector)

        val profile = CachedVoiceEmbedding(
            voiceId = voiceId,
            displayName = displayName.trim().ifEmpty { "Giọng nhân bản" },
            embeddingPath = embFile.absolutePath,
            embeddingDim = embeddingVector.size,
            embeddingBytes = embFile.length(),
            referenceDurationSec = cleanAudio.voicedDurationSec,
            createdAtMs = System.currentTimeMillis(),
        )
        metaFile.writeText(profile.toJson().toString(), Charsets.UTF_8)
        return profile
    }

    private fun writeEmbeddingBinary(file: File, vec: FloatArray) {
        DataOutputStream(BufferedOutputStream(FileOutputStream(file))).use { dos ->
            dos.writeInt(vec.size)
            val bb = ByteBuffer.allocate(vec.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            for (v in vec) bb.putFloat(v)
            dos.write(bb.array())
            dos.flush()
        }
    }

    private fun l2Normalize(vec: FloatArray): FloatArray {
        var sumSq = 0.0
        for (v in vec) sumSq += v.toDouble() * v.toDouble()
        val norm = sqrt(sumSq).toFloat()
        if (norm < 1e-8f) return vec
        return FloatArray(vec.size) { i -> vec[i] / norm }
    }

    private data class MelSpectrogram(val data: FloatArray, val frames: Int)

    private fun computeLogMel80(audio: FloatArray, sampleRate: Int): MelSpectrogram {
        val frames = max(1, (audio.size - FFT_SIZE) / HOP_LENGTH + 1)
        val window = FloatArray(FFT_SIZE) { n ->
            (0.5 - 0.5 * cos(2.0 * PI * n / (FFT_SIZE - 1))).toFloat()
        }
        val numBins = FFT_SIZE / 2 + 1
        val filters = buildMelFilterbank(sampleRate, FFT_SIZE, MEL_BINS)
        val out = FloatArray(frames * MEL_BINS)
        val re = DoubleArray(FFT_SIZE)
        val im = DoubleArray(FFT_SIZE)
        val power = FloatArray(numBins)

        for (f in 0 until frames) {
            val base = f * HOP_LENGTH
            for (n in 0 until FFT_SIZE) {
                val s = if (base + n < audio.size) audio[base + n] else 0f
                re[n] = (s * window[n]).toDouble()
                im[n] = 0.0
            }
            fftRadix2(re, im)
            for (k in 0 until numBins) {
                power[k] = (re[k] * re[k] + im[k] * im[k]).toFloat()
            }
            val row = f * MEL_BINS
            for (m in 0 until MEL_BINS) {
                var e = 1e-6f
                val wRow = filters[m]
                for (k in 0 until numBins) {
                    val w = wRow[k]
                    if (w > 0f) e += power[k] * w
                }
                out[row + m] = ln(e.toDouble()).toFloat()
            }
        }
        return MelSpectrogram(out, frames)
    }

    private fun transposeToChannelFirst(data: FloatArray, frames: Int, melBins: Int): FloatArray {
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
        val lowMel = 2595.0 * log10(1.0 + 80.0 / 700.0)
        val highMel = 2595.0 * log10(1.0 + min(7600.0, sampleRate / 2.0) / 700.0)
        val bins = IntArray(melBins + 2) { i ->
            val mel = lowMel + (highMel - lowMel) * i / (melBins + 1)
            val hz = 700.0 * (10.0.pow(mel / 2595.0) - 1.0)
            ((fftSize + 1) * hz / sampleRate).toInt().coerceIn(0, numSpecBins - 1)
        }
        return Array(melBins) { m ->
            val filter = FloatArray(numSpecBins)
            val l = bins[m]; val c = bins[m + 1]; val r = bins[m + 2]
            for (k in l until c) if (c > l) filter[k] = (k - l).toFloat() / (c - l).toFloat()
            for (k in c..r) if (r > c) filter[k] = (r - k).toFloat() / (r - c).toFloat()
            filter
        }
    }

    private fun fftRadix2(re: DoubleArray, im: DoubleArray) {
        val n = re.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                val tr = re[i]; re[i] = re[j]; re[j] = tr
                val ti = im[i]; im[i] = im[j]; im[j] = ti
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
                    val uRe = re[i + k]; val uIm = im[i + k]
                    val vRe = re[i + k + len / 2] * wRe - im[i + k + len / 2] * wIm
                    val vIm = re[i + k + len / 2] * wIm + im[i + k + len / 2] * wRe
                    re[i + k] = uRe + vRe; im[i + k] = uIm + vIm
                    re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm
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
