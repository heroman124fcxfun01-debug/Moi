package com.bookhad.app.ai

import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Extracts ONNX models, tokenizer vocabularies, and espeak-ng-data from APK assets/
 * into internal storage (context.filesDir) so native C++ ONNX Runtime (mmap) and
 * espeak-ng can read real filesystem paths without loading multi-MB ByteArrays into Java Heap.
 *
 * Tuned specifically for low-end 4GB RAM Android devices with MediaTek Helio G99
 * (2x Cortex-A76 performance cores + 6x Cortex-A55 efficiency cores, NO dedicated NPU):
 *  - NNAPI is strictly DISABLED.
 *  - XNNPACK is ENABLED.
 *  - Intra-op threads locked to 2 (matching the 2x Cortex-A76 big cores).
 *  - Inter-op threads locked to 1 (sequential graph execution for minimal RAM overhead).
 */
object OnnxAssetExtractor {

    private const val TAG = "OnnxAssetExtractor"
    private const val ASSETS_ROOT = "onnx"
    private const val RUNTIME_DIR_NAME = "onnx_runtime"
    private const val VOICES_DIR_NAME = "voices"
    private const val VERSION_STAMP_FILE = ".asset_version"
    private const val CURRENT_ASSET_VERSION = "bookhad_onnx_v2_g99"
    private const val COPY_BUFFER_BYTES = 64 * 1024

    const val FILE_SPEAKER_ENCODER = "speaker_encoder.onnx"
    const val FILE_TTS_BASE_INT8 = "tts_base_int8.onnx"
    const val FILE_TONE_CONVERTER_INT8 = "tone_converter_int8.onnx"
    const val FILE_TOKENS_TXT = "tokens.txt"
    const val DIR_ESPEAK_NG_DATA = "espeak-ng-data"

    data class ExtractedPaths(
        val rootDir: File,
        val speakerEncoderModel: File,
        val ttsBaseModel: File,
        val toneConverterModel: File,
        val tokensFile: File,
        val espeakDataDir: File,
    )

    @Volatile
    private var cachedPaths: ExtractedPaths? = null

    private val extractLock = Any()

    /**
     * Returns internal directory where cloned speaker embeddings (.emb) and metadata (.json) live.
     */
    fun getVoicesDirectory(context: Context): File {
        val dir = File(context.filesDir, VOICES_DIR_NAME)
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    /**
     * Ensures all required ONNX models, tokens.txt, and espeak-ng-data exist in context.filesDir.
     * Safe to call from Dispatchers.IO / Dispatchers.Default; idempotent and thread-safe.
     */
    @Throws(IOException::class)
    fun ensureExtracted(context: Context): ExtractedPaths {
        cachedPaths?.let { existing ->
            if (isExtractionValid(existing)) {
                return existing
            }
        }

        synchronized(extractLock) {
            cachedPaths?.let { existing ->
                if (isExtractionValid(existing)) {
                    return existing
                }
            }

            val targetRoot = File(context.filesDir, RUNTIME_DIR_NAME)
            val stampFile = File(targetRoot, VERSION_STAMP_FILE)
            val currentStamp = if (stampFile.exists()) stampFile.readText().trim() else ""

            val expectedPaths = buildPaths(targetRoot)
            val needsCopy = currentStamp != CURRENT_ASSET_VERSION || !isExtractionValid(expectedPaths)

            if (needsCopy) {
                Log.i(TAG, "Extracting ONNX assets from APK assets/$ASSETS_ROOT -> ${targetRoot.absolutePath}")
                if (!targetRoot.exists() && !targetRoot.mkdirs()) {
                    throw IOException("Failed to create runtime directory: ${targetRoot.absolutePath}")
                }
                copyAssetTree(context, ASSETS_ROOT, targetRoot)
                stampFile.writeText(CURRENT_ASSET_VERSION)
                Log.i(TAG, "ONNX asset extraction complete.")
            }

            cachedPaths = expectedPaths
            return expectedPaths
        }
    }

    /**
     * Creates ONNX Runtime SessionOptions optimized for MediaTek Helio G99 (4GB RAM, NO NPU).
     * - Explicitly avoids NNAPI (which fails or stalls on Helio G99 without NPU).
     * - Enables XNNPACK CPU kernel acceleration.
     * - Locks intra-op threads to 2 (2x Cortex-A76) and inter-op threads to 1.
     */
    fun createHelioG99SessionOptions(): OrtSession.SessionOptions {
        val options = OrtSession.SessionOptions()
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL)
        options.setIntraOpNumThreads(2)
        options.setInterOpNumThreads(1)
        options.setMemoryPatternOptimization(true)
        options.setCPUArenaAllocator(true)

        // Prevent spin-waiting across little Cortex-A55 cores to save battery and prevent thermal throttling.
        options.addConfigEntry("session.intra_op.allow_spinning", "0")
        options.addConfigEntry("session.inter_op.allow_spinning", "0")

        // Enable XNNPACK Execution Provider (pure ARM NEON optimized). NEVER call addNnapi().
        try {
            options.addXnnpack(mapOf("intra_op_num_threads" to "2"))
        } catch (err: Throwable) {
            // Fallback gracefully to standard ARM CPU EP if XNNPACK provider is absent in AAR build.
            Log.w(TAG, "XNNPACK EP unavailable in current ORT binary, using ARM CPU EP: ${err.message}")
        }

        return options
    }

    /**
     * Opens an ONNX model strictly by filesystem path (String) so ONNX Runtime uses native C++ mmap
     * instead of allocating a giant ByteArray on the Dalvik/ART Java Heap.
     */
    @Throws(IOException::class)
    fun openMmapSession(
        env: OrtEnvironment,
        modelFile: File,
        options: OrtSession.SessionOptions,
    ): OrtSession {
        if (!modelFile.exists() || modelFile.length() <= 0L) {
            throw IOException(
                "Missing ONNX model file at ${modelFile.absolutePath}. " +
                    "Place ${modelFile.name} inside app/src/main/assets/$ASSETS_ROOT/."
            )
        }
        return env.createSession(modelFile.absolutePath, options)
    }

    private fun buildPaths(root: File): ExtractedPaths {
        return ExtractedPaths(
            rootDir = root,
            speakerEncoderModel = File(root, FILE_SPEAKER_ENCODER),
            ttsBaseModel = File(root, FILE_TTS_BASE_INT8),
            toneConverterModel = File(root, FILE_TONE_CONVERTER_INT8),
            tokensFile = File(root, FILE_TOKENS_TXT),
            espeakDataDir = File(root, DIR_ESPEAK_NG_DATA),
        )
    }

    private fun isExtractionValid(paths: ExtractedPaths): Boolean {
        return paths.speakerEncoderModel.exists() &&
            paths.speakerEncoderModel.length() > 0L &&
            paths.ttsBaseModel.exists() &&
            paths.ttsBaseModel.length() > 0L &&
            paths.toneConverterModel.exists() &&
            paths.toneConverterModel.length() > 0L &&
            paths.tokensFile.exists() &&
            paths.tokensFile.length() > 0L
    }

    @Throws(IOException::class)
    private fun copyAssetTree(context: Context, assetPath: String, destination: File) {
        val assetManager = context.assets
        val children = assetManager.list(assetPath)

        if (children.isNullOrEmpty()) {
            // Leaf asset file
            copySingleAssetFile(context, assetPath, destination)
            return
        }

        if (!destination.exists() && !destination.mkdirs()) {
            throw IOException("Failed to create directory: ${destination.absolutePath}")
        }

        for (child in children) {
            val childAssetPath = if (assetPath.isEmpty()) child else "$assetPath/$child"
            val childDest = File(destination, child)
            copyAssetTree(context, childAssetPath, childDest)
        }
    }

    @Throws(IOException::class)
    private fun copySingleAssetFile(context: Context, assetPath: String, destFile: File) {
        destFile.parentFile?.let { parent ->
            if (!parent.exists()) parent.mkdirs()
        }

        // Write to temporary file first, then atomically rename to avoid corrupted half-copies.
        val tempFile = File(destFile.parentFile, "${destFile.name}.tmp")
        try {
            context.assets.open(assetPath).use { rawInput ->
                BufferedInputStream(rawInput, COPY_BUFFER_BYTES).use { input ->
                    BufferedOutputStream(FileOutputStream(tempFile), COPY_BUFFER_BYTES).use { output ->
                        val buffer = ByteArray(COPY_BUFFER_BYTES)
                        while (true) {
                            val bytesRead = input.read(buffer)
                            if (bytesRead <= 0) break
                            output.write(buffer, 0, bytesRead)
                        }
                        output.flush()
                    }
                }
            }
            if (destFile.exists()) {
                destFile.delete()
            }
            if (!tempFile.renameTo(destFile)) {
                throw IOException("Failed to finalize extracted file: ${destFile.absolutePath}")
            }
        } catch (err: IOException) {
            if (tempFile.exists()) tempFile.delete()
            throw err
        }
    }
}
