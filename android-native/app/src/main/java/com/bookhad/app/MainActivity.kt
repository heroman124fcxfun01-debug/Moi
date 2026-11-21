package com.bookhad.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.bookhad.app.ai.NeuralZeroShotTtsEngine
import com.bookhad.app.ai.OnnxRuntimeConfig
import com.bookhad.app.ai.SpeakerEncoderEngine
import com.bookhad.app.ai.ZeroShotVoiceCloningManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQ_RECORD_AUDIO = 2041
        private const val DEFAULT_PAPER_BG_HEX = "#F7F4EE"
    }

    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private var embeddedBrowserWebView: WebView? = null
    private lateinit var zeroShotManager: ZeroShotVoiceCloningManager
    private var pendingVoiceNameAfterPermission: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
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

        zeroShotManager = ZeroShotVoiceCloningManager(applicationContext)

        activityScope.launch(Dispatchers.IO) {
            try {
                OnnxRuntimeConfig.ensureModelsExtracted(applicationContext)
            } catch (_: Throwable) {
            }
        }

        rootContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.parseColor(DEFAULT_PAPER_BG_HEX))
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            setBackgroundColor(Color.parseColor(DEFAULT_PAPER_BG_HEX))
            addJavascriptInterface(BookhadNativeBridge(), "BookhadNative")
        }
        rootContainer.addView(webView)
        setContentView(rootContainer)

        applyEdgeToEdgeAppearance(DEFAULT_PAPER_BG_HEX, isLightBar = true)
        installEdgeToEdgeInsetListener(rootContainer)
        webView.loadUrl("file:///android_asset/public/index.html")
    }

    fun applyEdgeToEdgeAppearance(backgroundHex: String, isLightBar: Boolean) {
        runOnUiThread {
            val parsedColor = try {
                Color.parseColor(backgroundHex)
            } catch (_: IllegalArgumentException) {
                Color.parseColor(DEFAULT_PAPER_BG_HEX)
            }
            window.decorView.setBackgroundColor(parsedColor)
            if (::webView.isInitialized) webView.setBackgroundColor(parsedColor)
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT

            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = isLightBar
            controller.isAppearanceLightNavigationBars = isLightBar
        }
    }

    private fun installEdgeToEdgeInsetListener(targetView: View) {
        ViewCompat.setOnApplyWindowInsetsListener(targetView) { view, windowInsets ->
            val insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.statusBars() or
                    WindowInsetsCompat.Type.navigationBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val topDp = insets.top / density
            val bottomDp = insets.bottom / density
            val js = """
                (function() {
                  var r = document.documentElement.style;
                  r.setProperty('--native-safe-top', '${topDp}px');
                  r.setProperty('--native-safe-bottom', '${bottomDp}px');
                })();
            """.trimIndent()
            if (::webView.isInitialized) webView.post { webView.evaluateJavascript(js, null) }
            view.setPadding(0, 0, 0, 0)
            windowInsets
        }
    }

    private fun dispatchJsEvent(eventName: String, payload: JSONObject) {
        val safeJson = JSONObject.quote(payload.toString())
        val script = "window.dispatchEvent(new CustomEvent('$eventName', { detail: JSON.parse($safeJson) }));"
        runOnUiThread {
            if (::webView.isInitialized) webView.evaluateJavascript(script, null)
        }
    }

    private fun startZeroShotEnrollment(voiceName: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingVoiceNameAfterPermission = voiceName
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQ_RECORD_AUDIO)
            return
        }

        zeroShotManager.startEnrollmentRecording(
            displayName = voiceName,
            listener = object : ZeroShotVoiceCloningManager.EnrollmentListener {
                override fun onRecordingTick(elapsedMs: Long, rmsLevel: Float) {
                    dispatchJsEvent(
                        "bookhad-voice-clone-progress",
                        JSONObject().apply {
                            put("elapsedMs", elapsedMs)
                            put("rmsLevel", rmsLevel.toDouble())
                        },
                    )
                }

                override fun onEncodingEmbedding() {
                    dispatchJsEvent(
                        "bookhad-voice-clone-encoding",
                        JSONObject().apply { put("status", "encoding") },
                    )
                }

                override fun onEnrolled(profile: SpeakerEncoderEngine.CachedVoiceEmbedding) {
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
            val pending = pendingVoiceNameAfterPermission
            pendingVoiceNameAfterPermission = null
            if (granted && pending != null) {
                startZeroShotEnrollment(pending)
            } else {
                dispatchJsEvent(
                    "bookhad-voice-clone-error",
                    JSONObject().apply { put("message", "Cần quyền micro để thu mẫu giọng 5–10 giây.") },
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openNativeEmbeddedWebView(url: String, topDp: Int, bottomDp: Int) {
        runOnUiThread {
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val topPx = (topDp * density).toInt().coerceAtLeast(0)
            val bottomPx = (bottomDp * density).toInt().coerceAtLeast(0)
            val sidePx = (8 * density).toInt()

            val browser = embeddedBrowserWebView ?: WebView(this).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): Boolean = false

                    override fun onPageFinished(view: WebView?, loadedUrl: String?) {
                        super.onPageFinished(view, loadedUrl)
                        if (!loadedUrl.isNullOrBlank()) {
                            dispatchJsEvent(
                                "bookhad-browser-url",
                                JSONObject().apply {
                                    put("url", loadedUrl)
                                    put("title", view?.title ?: loadedUrl)
                                },
                            )
                        }
                    }
                }
                embeddedBrowserWebView = this
                rootContainer.addView(this)
            }

            val lp = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.TOP,
            ).apply {
                topMargin = topPx
                bottomMargin = bottomPx
                leftMargin = sidePx
                rightMargin = sidePx
            }
            browser.layoutParams = lp
            browser.visibility = View.VISIBLE
            browser.bringToFront()
            if (url.isNotBlank() && browser.url != url) {
                browser.loadUrl(url)
            }
        }
    }

    private fun closeNativeEmbeddedWebView() {
        runOnUiThread {
            embeddedBrowserWebView?.let { browser ->
                browser.stopLoading()
                browser.visibility = View.GONE
            }
        }
    }

    override fun onDestroy() {
        embeddedBrowserWebView?.let {
            rootContainer.removeView(it)
            it.destroy()
        }
        embeddedBrowserWebView = null
        zeroShotManager.destroy()
        activityScope.cancel()
        super.onDestroy()
    }

    inner class BookhadNativeBridge {
        @JavascriptInterface
        fun setSystemBarAppearance(backgroundHex: String, isLightBar: Boolean) {
            applyEdgeToEdgeAppearance(backgroundHex, isLightBar)
        }

        @JavascriptInterface
        fun startVoiceCloneRecording(voiceName: String) {
            runOnUiThread { startZeroShotEnrollment(voiceName) }
        }

        @JavascriptInterface
        fun stopAndCloneVoice() {
            zeroShotManager.stopEnrollmentRecording()
        }

        @JavascriptInterface
        fun listClonedVoicesJson(): String = zeroShotManager.speakerEncoder.listCachedVoicesJson()

        @JavascriptInterface
        fun deleteClonedVoice(voiceId: String): Boolean =
            zeroShotManager.speakerEncoder.deleteCachedVoice(voiceId)

        @JavascriptInterface
        fun speakBookChapter(
            paragraphsJson: String,
            voiceId: String,
            startParagraphIndex: Int,
            speechRate: Float,
        ) {
            val arr = JSONArray(paragraphsJson)
            val paragraphs = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) paragraphs.add(arr.optString(i, ""))

            zeroShotManager.speakChapter(
                paragraphs = paragraphs,
                voiceId = voiceId,
                startParagraphIndex = startParagraphIndex,
                speechRate = speechRate,
                listener = object : NeuralZeroShotTtsEngine.StreamListener {
                    override fun onPlaybackStateChanged(isPlaying: Boolean) {
                        dispatchJsEvent("bookhad-tts-state", JSONObject().apply { put("isPlaying", isPlaying) })
                    }

                    override fun onHighlightSentence(paragraphIndex: Int, charOffset: Int, sentenceText: String) {
                        dispatchJsEvent(
                            "bookhad-tts-highlight",
                            JSONObject().apply {
                                put("paragraphIndex", paragraphIndex)
                                put("charOffset", charOffset)
                                put("text", sentenceText)
                            },
                        )
                    }

                    override fun onCompleted() {
                        dispatchJsEvent("bookhad-tts-chapter-end", JSONObject().apply { put("completed", true) })
                    }

                    override fun onError(message: String) {
                        dispatchJsEvent("bookhad-tts-error", JSONObject().apply { put("message", message) })
                    }
                },
            )
        }

        @JavascriptInterface
        fun pauseBookAudio() = zeroShotManager.pause()

        @JavascriptInterface
        fun resumeBookAudio() = zeroShotManager.resume()

        @JavascriptInterface
        fun stopBookAudio() = zeroShotManager.stopAll()

        @JavascriptInterface
        fun openEmbeddedWebView(url: String, topDp: Int, bottomDp: Int) {
            openNativeEmbeddedWebView(url, topDp, bottomDp)
        }

        @JavascriptInterface
        fun navigateEmbeddedWebView(url: String) {
            runOnUiThread { embeddedBrowserWebView?.loadUrl(url) }
        }

        @JavascriptInterface
        fun embeddedWebViewGoBack() {
            runOnUiThread {
                if (embeddedBrowserWebView?.canGoBack() == true) {
                    embeddedBrowserWebView?.goBack()
                }
            }
        }

        @JavascriptInterface
        fun embeddedWebViewGoForward() {
            runOnUiThread {
                if (embeddedBrowserWebView?.canGoForward() == true) {
                    embeddedBrowserWebView?.goForward()
                }
            }
        }

        @JavascriptInterface
        fun embeddedWebViewReload() {
            runOnUiThread { embeddedBrowserWebView?.reload() }
        }

        @JavascriptInterface
        fun closeEmbeddedWebView() {
            closeNativeEmbeddedWebView()
        }
    }
}
