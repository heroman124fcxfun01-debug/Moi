package com.bookhad.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.bookhad.app.ai.BookReaderAiTtsEngine
import com.bookhad.app.ai.OnnxAssetExtractor
import com.bookhad.app.ai.UnifiedBookTtsRouter
import com.bookhad.app.ai.VoiceCloner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * BOOKHAD MainActivity:
 *  1. Full Edge-to-Edge display: transparent status bar & navigation bar so App / Reader paper
 *     background fills 100% up behind the system clock, battery, and camera cutout (zero black strip).
 *  2. Automatic clock/icon color inversion via WindowInsetsControllerCompat.isAppearanceLightStatusBars:
 *       - Light background (White, Warm, Sepia) -> Black status bar icons.
 *       - Dark background (Night, AMOLED) -> White status bar icons.
 *  3. Safe-area inset synchronization (--native-safe-top, --native-safe-bottom) so book text and
 *     top/bottom floating bars never overlap system bars or camera notches.
 *  4. Native On-Device Voice Cloning & Helio G99 Streaming AI TTS Bridge (window.BookhadNative).
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQ_RECORD_AUDIO = 2041
        private const val DEFAULT_PAPER_BG_HEX = "#F7F4EE"
    }

    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private lateinit var webView: WebView
    private lateinit var voiceCloner: VoiceCloner
    private lateinit var aiTtsEngine: BookReaderAiTtsEngine
    private lateinit var ttsRouter: UnifiedBookTtsRouter

    private var pendingVoiceNameAfterPermission: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // 1. Enable Android Edge-to-Edge with completely transparent status & navigation bars
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }

        // 2. Initialize On-Device AI Voice Cloner & Streaming TTS Router (Helio G99 safe)
        voiceCloner = VoiceCloner(applicationContext)
        aiTtsEngine = BookReaderAiTtsEngine(applicationContext, voiceCloner)
        ttsRouter = UnifiedBookTtsRouter(applicationContext, aiTtsEngine)

        // Pre-extract ONNX assets & espeak-ng-data on background IO thread so first tap is instant
        activityScope.launch(Dispatchers.IO) {
            try {
                OnnxAssetExtractor.ensureExtracted(applicationContext)
            } catch (_: Throwable) {
                // Handled gracefully with user-facing error if assets are missing
            }
        }

        // 3. Configure WebView host filling 100% Edge-to-Edge viewport
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            setBackgroundColor(Color.parseColor(DEFAULT_PAPER_BG_HEX))
            addJavascriptInterface(BookhadNativeBridge(), "BookhadNative")
        }
        setContentView(webView)

        // 4. Sync initial light status bar icons & window safe-area insets
        applyEdgeToEdgeAppearance(DEFAULT_PAPER_BG_HEX, isLightBar = true)
        installEdgeToEdgeInsetListener(webView)

        // Load bundled web app (Capacitor / local assets)
        webView.loadUrl("file:///android_asset/public/index.html")
    }

    /**
     * Dynamically fills 100% edge-to-edge background behind status bar and flips clock/icon color
     * between dark icons (light backgrounds) and white icons (dark backgrounds).
     */
    fun applyEdgeToEdgeAppearance(backgroundHex: String, isLightBar: Boolean) {
        runOnUiThread {
            val parsedColor = try {
                Color.parseColor(backgroundHex)
            } catch (_: IllegalArgumentException) {
                Color.parseColor(DEFAULT_PAPER_BG_HEX)
            }

            window.decorView.setBackgroundColor(parsedColor)
            if (::webView.isInitialized) {
                webView.setBackgroundColor(parsedColor)
            }
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT

            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = isLightBar
            controller.isAppearanceLightNavigationBars = isLightBar
        }
    }

    /**
     * Forwards real Android status bar & navigation bar safe-area heights into CSS variables
     * so Reader content and floating headers never collide with clock, notch, or gesture pill.
     */
    private fun installEdgeToEdgeInsetListener(targetView: View) {
        ViewCompat.setOnApplyWindowInsetsListener(targetView) { view, windowInsets ->
            val systemBars = windowInsets.getInsets(
                WindowInsetsCompat.Type.statusBars() or
                    WindowInsetsCompat.Type.navigationBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val topDp = (systemBars.top / density)
            val bottomDp = (systemBars.bottom / density)

            val js = """
                (function() {
                  var r = document.documentElement.style;
                  r.setProperty('--native-safe-top', '${topDp}px');
                  r.setProperty('--native-safe-bottom', '${bottomDp}px');
                })();
            """.trimIndent()
            if (::webView.isInitialized) {
                webView.post { webView.evaluateJavascript(js, null) }
            }

            // Return CONSUMED=false (original insets) so background remains edge-to-edge behind bars
            view.setPadding(0, 0, 0, 0)
            windowInsets
        }
    }

    private fun dispatchJsEvent(eventName: String, payload: JSONObject) {
        val safeJson = JSONObject.quote(payload.toString())
        val script = "window.dispatchEvent(new CustomEvent('$eventName', { detail: JSON.parse($safeJson) }));"
        runOnUiThread {
            if (::webView.isInitialized) {
                webView.evaluateJavascript(script, null)
            }
        }
    }

    private fun startNativeVoiceCloningFlow(voiceName: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingVoiceNameAfterPermission = voiceName
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQ_RECORD_AUDIO,
            )
            return
        }

        voiceCloner.startRecording(
            voiceName = voiceName,
            listener = object : VoiceCloner.Listener {
                override fun onRecordingProgress(elapsedMs: Long, rmsLevel: Float) {
                    dispatchJsEvent(
                        "bookhad-voice-clone-progress",
                        JSONObject().apply {
                            put("elapsedMs", elapsedMs)
                            put("rmsLevel", rmsLevel.toDouble())
                        },
                    )
                }

                override fun onEncodingStarted() {
                    dispatchJsEvent(
                        "bookhad-voice-clone-encoding",
                        JSONObject().apply { put("status", "encoding") },
                    )
                }

                override fun onVoiceCloned(profile: VoiceCloner.ClonedVoiceProfile) {
                    dispatchJsEvent("bookhad-voice-cloned", profile.toJson())
                }

                override fun onError(message: String) {
                    dispatchJsEvent(
                        "bookhad-voice-clone-error",
                        JSONObject().apply { put("message", message) },
                    )
                }
            },
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_RECORD_AUDIO) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            val pendingName = pendingVoiceNameAfterPermission
            pendingVoiceNameAfterPermission = null
            if (granted && pendingName != null) {
                startNativeVoiceCloningFlow(pendingName)
            } else {
                dispatchJsEvent(
                    "bookhad-voice-clone-error",
                    JSONObject().apply {
                        put("message", "Bạn cần cấp quyền micro để ghi âm mẫu giọng nói 6–10 giây.")
                    },
                )
            }
        }
    }

    override fun onDestroy() {
        ttsRouter.destroy()
        voiceCloner.release()
        activityScope.cancel()
        super.onDestroy()
    }

    /**
     * JavaScript <-> Android Native Bridge exposed as window.BookhadNative
     */
    inner class BookhadNativeBridge {

        @JavascriptInterface
        fun setSystemBarAppearance(backgroundHex: String, isLightBar: Boolean) {
            applyEdgeToEdgeAppearance(backgroundHex, isLightBar)
        }

        @JavascriptInterface
        fun startVoiceCloneRecording(voiceName: String) {
            runOnUiThread { startNativeVoiceCloningFlow(voiceName) }
        }

        @JavascriptInterface
        fun stopAndCloneVoice() {
            voiceCloner.stopRecordingAndClone()
        }

        @JavascriptInterface
        fun cancelVoiceCloneRecording() {
            voiceCloner.cancelRecording()
        }

        @JavascriptInterface
        fun listClonedVoicesJson(): String {
            return voiceCloner.listClonedVoicesJson()
        }

        @JavascriptInterface
        fun deleteClonedVoice(voiceId: String): Boolean {
            return voiceCloner.deleteClonedVoice(voiceId)
        }

        @JavascriptInterface
        fun speakBookChapter(
            paragraphsJson: String,
            voiceId: String,
            startParagraphIndex: Int,
            speechRate: Float,
        ) {
            val arr = JSONArray(paragraphsJson)
            val paragraphs = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) {
                paragraphs.add(arr.optString(i, ""))
            }

            ttsRouter.speakChapter(
                paragraphs = paragraphs,
                voiceId = voiceId,
                startParagraphIndex = startParagraphIndex,
                speechRate = speechRate,
                listener = object : BookReaderAiTtsEngine.PlaybackListener {
                    override fun onPlaybackStateChanged(isPlaying: Boolean) {
                        dispatchJsEvent(
                            "bookhad-tts-state",
                            JSONObject().apply { put("isPlaying", isPlaying) },
                        )
                    }

                    override fun onHighlightChunk(
                        paragraphIndex: Int,
                        charOffset: Int,
                        text: String,
                    ) {
                        dispatchJsEvent(
                            "bookhad-tts-highlight",
                            JSONObject().apply {
                                put("paragraphIndex", paragraphIndex)
                                put("charOffset", charOffset)
                                put("text", text)
                            },
                        )
                    }

                    override fun onChapterCompleted() {
                        dispatchJsEvent(
                            "bookhad-tts-chapter-end",
                            JSONObject().apply { put("completed", true) },
                        )
                    }

                    override fun onError(message: String) {
                        dispatchJsEvent(
                            "bookhad-tts-error",
                            JSONObject().apply { put("message", message) },
                        )
                    }
                },
            )
        }

        @JavascriptInterface
        fun pauseBookAudio() {
            ttsRouter.pause()
        }

        @JavascriptInterface
        fun resumeBookAudio() {
            ttsRouter.resume()
        }

        @JavascriptInterface
        fun stopBookAudio() {
            ttsRouter.stopAll()
        }
    }
}
