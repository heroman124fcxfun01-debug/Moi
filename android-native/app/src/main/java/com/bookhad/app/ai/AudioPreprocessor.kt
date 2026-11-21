package com.bookhad.app.ai

import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Pipeline Step 1: Reference Audio Preprocessor (5–10 seconds).
 *
 * Strictly prepares clean Mono 16kHz (Speaker Encoder) or 24kHz (Acoustic/Vocoder) float32 audio:
 *  - Stereo/Multi-channel downmix to Mono
 *  - Linear resampling to target sample rate (16,000 Hz or 24,000 Hz)
 *  - DC offset removal + 80Hz High-Pass Filter + Adaptive Noise-Floor Gate (via C++ JNI with Kotlin fallback)
 *  - VAD silence trimming + Peak normalization to 0.92f
 *
 * ZERO pitch-shifting or formant distortion — preserves 100% of the speaker's authentic vocal identity.
 */
object AudioPreprocessor {

    private const val TAG = "AudioPreprocessor"
    const val ENCODER_SAMPLE_RATE = 16_000
    const val VOCODER_SAMPLE_RATE = 24_000
    const val MIN_REFERENCE_SECONDS = 3.0f
    const val MAX_REFERENCE_SECONDS = 10.0f

    private var nativeLibLoaded = false

    init {
        try {
            System.loadLibrary("bookhad_zeroshot_dsp")
            nativeLibLoaded = true
        } catch (err: UnsatisfiedLinkError) {
            nativeLibLoaded = false
            Log.w(TAG, "Native C++ denoiser unavailable, using pure-Kotlin denoiser fallback: ${err.message}")
        }
    }

    private external fun nativeDenoisePcmInPlace(pcm: FloatArray, sampleRate: Int)

    data class PreprocessedAudio(
        val samples: FloatArray,
        val sampleRate: Int,
        val voicedDurationSec: Float,
    )

    /**
     * Parses an imported WAV (16-bit PCM, Mono or Stereo) file and runs the Step 1 cleanup pipeline.
     */
    fun preprocessWavFile(
        wavFile: File,
        targetSampleRate: Int = ENCODER_SAMPLE_RATE,
    ): PreprocessedAudio {
        val bytes = FileInputStream(wavFile).use { it.readBytes() }
        if (bytes.size < 44) {
            throw IllegalArgumentException("File WAV không hợp lệ hoặc quá nhỏ.")
        }
        val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val channels = header.getShort(22).toInt().coerceAtLeast(1)
        val srcRate = header.getInt(24)
        val bitsPerSample = header.getShort(34).toInt()
        if (bitsPerSample != 16) {
            throw IllegalArgumentException("Chỉ hỗ trợ WAV 16-bit PCM (hiện tại: ${bitsPerSample}-bit).")
        }

        // Locate "data" subchunk safely (handles WAV files with extra metadata/LIST chunks)
        var offset = 12
        var dataOffset = 44
        var dataSize = bytes.size - 44
        while (offset + 8 <= bytes.size) {
            val chunkId = String(bytes, offset, 4, Charsets.US_ASCII)
            val chunkLen = header.getInt(offset + 4)
            if (chunkId == "data") {
                dataOffset = offset + 8
                dataSize = min(chunkLen, bytes.size - dataOffset)
                break
            }
            offset += 8 + max(0, chunkLen)
        }

        val totalShorts = dataSize / 2
        val pcm16 = ShortArray(totalShorts)
        val dataBuf = ByteBuffer.wrap(bytes, dataOffset, totalShorts * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until totalShorts) {
            pcm16[i] = dataBuf.short
        }

        return preprocessPcm16(
            rawPcm16 = pcm16,
            sourceSampleRate = srcRate,
            channels = channels,
            targetSampleRate = targetSampleRate,
        )
    }

    /**
     * Step 1 Core: Downmix -> Normalize [-1, 1] -> Resample -> Denoise -> Trim Silence -> Peak Normalize.
     */
    fun preprocessPcm16(
        rawPcm16: ShortArray,
        sourceSampleRate: Int,
        channels: Int = 1,
        targetSampleRate: Int = ENCODER_SAMPLE_RATE,
    ): PreprocessedAudio {
        if (rawPcm16.isEmpty()) {
            throw IllegalArgumentException("Dữ liệu âm thanh mẫu trống.")
        }

        // 1. Convert PCM16 & downmix to Mono float32 [-1.0f, 1.0f]
        val mono = if (channels <= 1) {
            FloatArray(rawPcm16.size) { i -> rawPcm16[i] / 32768.0f }
        } else {
            val frames = rawPcm16.size / channels
            FloatArray(frames) { f ->
                var acc = 0f
                for (c in 0 until channels) {
                    acc += rawPcm16[f * channels + c] / 32768.0f
                }
                acc / channels.toFloat()
            }
        }

        // 2. Remove DC offset
        removeDcOffsetInPlace(mono)

        // 3. Resample to target rate (16kHz for Speaker Encoder or 24kHz for Vocoder)
        val resampled = if (sourceSampleRate != targetSampleRate) {
            resampleLinear(mono, sourceSampleRate, targetSampleRate)
        } else {
            mono
        }

        // 4. Denoise (80Hz HPF + adaptive noise-floor gate — NO pitch shift)
        if (nativeLibLoaded) {
            nativeDenoisePcmInPlace(resampled, targetSampleRate)
        } else {
            denoiseKotlinFallbackInPlace(resampled, targetSampleRate)
        }

        // 5. Trim leading & trailing silence and cap to 10 seconds max
        val trimmed = trimLeadingTrailingSilence(resampled, targetSampleRate)
        val maxSamples = (MAX_REFERENCE_SECONDS * targetSampleRate).toInt()
        val bounded = if (trimmed.size > maxSamples) trimmed.copyOf(maxSamples) else trimmed

        val voicedSec = bounded.size.toFloat() / targetSampleRate.toFloat()
        if (voicedSec < MIN_REFERENCE_SECONDS) {
            throw IllegalArgumentException(
                "Giọng nói rõ quá ngắn (${"%.1f".format(voicedSec)}s). Cần tối thiểu 5–10 giây giọng nói rõ ràng."
            )
        }

        // 6. Peak normalize to 0.92f for consistent neural encoder dynamic range
        val normalized = peakNormalize(bounded, targetPeak = 0.92f)
        return PreprocessedAudio(
            samples = normalized,
            sampleRate = targetSampleRate,
            voicedDurationSec = voicedSec,
        )
    }

    fun resampleLinear(input: FloatArray, srcRate: Int, dstRate: Int): FloatArray {
        if (srcRate == dstRate || input.isEmpty()) return input
        val ratio = srcRate.toDouble() / dstRate.toDouble()
        val outLen = max(1, (input.size / ratio).toInt())
        val out = FloatArray(outLen)
        val last = input.size - 1
        for (i in 0 until outLen) {
            val pos = i * ratio
            val i0 = pos.toInt().coerceIn(0, last)
            val i1 = min(i0 + 1, last)
            val frac = (pos - i0).toFloat()
            out[i] = input[i0] * (1.0f - frac) + input[i1] * frac
        }
        return out
    }

    private fun removeDcOffsetInPlace(samples: FloatArray) {
        var mean = 0.0
        for (s in samples) mean += s
        val dc = (mean / max(1, samples.size)).toFloat()
        for (i in samples.indices) {
            samples[i] = (samples[i] - dc).coerceIn(-1.0f, 1.0f)
        }
    }

    private fun denoiseKotlinFallbackInPlace(samples: FloatArray, sampleRate: Int) {
        if (samples.size <= 2) return
        // 2nd-order 80Hz Butterworth High-Pass Filter
        val omega = 2.0 * PI * 80.0 / sampleRate
        val cosW = cos(omega)
        val sinW = kotlin.math.sin(omega)
        val alpha = sinW / (2.0 * 0.70710678)
        val a0 = 1.0 + alpha
        val b0 = ((1.0 + cosW) * 0.5 / a0).toFloat()
        val b1 = (-(1.0 + cosW) / a0).toFloat()
        val b2 = b0
        val a1 = (-2.0 * cosW / a0).toFloat()
        val a2 = ((1.0 - alpha) / a0).toFloat()

        var x1 = 0f; var x2 = 0f; var y1 = 0f; var y2 = 0f
        for (i in samples.indices) {
            val x0 = samples[i]
            val y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x0; y2 = y1; y1 = y0
            samples[i] = y0
        }

        // Soft adaptive noise-floor gate
        val frameSize = max(160, sampleRate / 100)
        val numFrames = samples.size / frameSize
        if (numFrames <= 4) return
        val rmsList = FloatArray(numFrames)
        for (f in 0 until numFrames) {
            var sumSq = 0.0
            val base = f * frameSize
            for (i in 0 until frameSize) {
                val s = samples[base + i].toDouble()
                sumSq += s * s
            }
            rmsList[f] = sqrt(sumSq / frameSize).toFloat()
        }
        val sorted = rmsList.sortedArray()
        val noiseFloor = sorted[max(0, (numFrames * 0.15f).toInt())]
        val threshold = max(0.005f, noiseFloor * 2.1f)
        var gain = 1.0f
        for (f in 0 until numFrames) {
            val target = if (rmsList[f] < threshold) {
                val r = rmsList[f] / max(1e-6f, threshold)
                max(0.12f, r * r)
            } else 1.0f
            val base = f * frameSize
            for (i in 0 until frameSize) {
                gain = 0.96f * gain + 0.04f * target
                samples[base + i] *= gain
            }
        }
    }

    private fun trimLeadingTrailingSilence(samples: FloatArray, sampleRate: Int): FloatArray {
        val frameSize = max(1, sampleRate / 50) // 20ms
        val guardSamples = sampleRate / 10      // 100ms
        val frames = samples.size / frameSize
        if (frames <= 2) return samples

        var first = -1
        var last = -1
        for (f in 0 until frames) {
            var sumSq = 0.0
            val start = f * frameSize
            val end = min(samples.size, start + frameSize)
            for (i in start until end) {
                val v = samples[i].toDouble()
                sumSq += v * v
            }
            val rms = sqrt(sumSq / max(1, end - start)).toFloat()
            if (rms >= 0.012f) {
                if (first == -1) first = f
                last = f
            }
        }
        if (first == -1 || last < first) return FloatArray(0)
        val sIdx = max(0, first * frameSize - guardSamples)
        val eIdx = min(samples.size, (last + 1) * frameSize + guardSamples)
        return samples.copyOfRange(sIdx, eIdx)
    }

    private fun peakNormalize(samples: FloatArray, targetPeak: Float): FloatArray {
        var peak = 0f
        for (s in samples) {
            val a = abs(s)
            if (a > peak) peak = a
        }
        if (peak < 1e-5f) return samples
        val gain = (targetPeak / peak).coerceAtMost(8.0f)
        return FloatArray(samples.size) { i -> (samples[i] * gain).coerceIn(-1.0f, 1.0f) }
    }
}
