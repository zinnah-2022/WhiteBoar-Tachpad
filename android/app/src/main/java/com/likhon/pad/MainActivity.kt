package com.likhon.pad

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONArray
import org.json.JSONObject

/**
 * লিখন প্যাড — কম্পিউটারের লিখন বোর্ডের সাথে যুক্ত হয়ে মোবাইলকে লেখার প্যাড বানায়।
 * লেখার পর্দাটি কম্পিউটার থেকেই আসে (http://<IP>:<পোর্ট>/pad/), তাই বোর্ড আপডেট হলে প্যাডও আপডেট হয়।
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("likhon", MODE_PRIVATE) }
    private val bg = Color.parseColor("#121729")

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        val url = normalize(text)
        if (url == null) toast("এটা লিখন বোর্ডের QR কোড নয়") else connect(url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.statusBarColor = bg
        @Suppress("DEPRECATION")
        window.navigationBarColor = bg

        web = WebView(this)
        web.setBackgroundColor(bg)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            allowFileAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        web.addJavascriptInterface(Bridge(), "LikhonApp")
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame && request.url.scheme == "http") showHome("unreachable")
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = false

            override fun onPageFinished(view: WebView, url: String) {
                setImmersive(url.startsWith("http"))
            }
        }
        setContentView(web)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.url?.startsWith("http") == true) showHome(null) else finish()
            }
        })

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) showHome(null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    private fun showHome(error: String?) {
        web.loadUrl("file:///android_asset/home.html" + (if (error != null) "?err=$error" else ""))
    }

    private fun setImmersive(on: Boolean) {
        val c = WindowInsetsControllerCompat(window, web)
        if (on) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.navigationBars())
        } else {
            c.show(WindowInsetsCompat.Type.systemBars())
        }
        WindowCompat.setDecorFitsSystemWindows(window, true)
    }

    private fun startScan() {
        val o = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("কম্পিউটারের লিখন বোর্ডে দেখানো QR কোডটি স্ক্যান করুন")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
        scanLauncher.launch(o)
    }

    /** QR বা হাতে লেখা ঠিকানা থেকে প্যাডের পরিষ্কার URL বানায়; ভুল হলে null */
    private fun normalize(raw: String): String? {
        val t = raw.trim()
        val u = Uri.parse(if (t.startsWith("http")) t else "http://$t")
        if (u.scheme != "http" || u.host.isNullOrEmpty()) return null
        val k = u.getQueryParameter("k") ?: return null
        if (!(u.path ?: "").startsWith("/pad")) return null
        val port = if (u.port > 0) u.port else 8765
        return "http://${u.host}:$port/pad/?k=${Uri.encode(k)}"
    }

    private fun connect(url: String) {
        val full = Uri.parse(url).buildUpon().appendQueryParameter("name", deviceName()).build().toString()
        web.loadUrl(full)
    }

    private fun deviceName(): String {
        val n = try {
            Settings.Global.getString(contentResolver, "device_name")
        } catch (_: Exception) {
            null
        }
        return if (!n.isNullOrBlank()) n else Build.MODEL ?: "Android"
    }

    private fun saveHistory(url: String) {
        val clean = normalize(url) ?: return
        val host = Uri.parse(clean).host ?: return
        val old = JSONArray(prefs.getString("history", "[]"))
        val out = JSONArray()
        out.put(JSONObject().put("url", clean).put("host", host).put("t", System.currentTimeMillis()))
        for (i in 0 until old.length()) {
            val o = old.optJSONObject(i) ?: continue
            if (o.optString("host") == host) continue
            if (out.length() >= 5) break
            out.put(o)
        }
        prefs.edit().putString("history", out.toString()).apply()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    /** ওয়েব পেজ থেকে ডাকা যায়: window.LikhonApp.xxx() */
    inner class Bridge {
        @JavascriptInterface fun scan() = runOnUiThread { startScan() }
        @JavascriptInterface fun rescan() = runOnUiThread { startScan() }
        @JavascriptInterface fun home() = runOnUiThread { showHome(null) }

        @JavascriptInterface
        fun connect(address: String) = runOnUiThread {
            val url = normalize(address)
            if (url == null) toast("ঠিকানা বা পিন ঠিক নেই") else this@MainActivity.connect(url)
        }

        @JavascriptInterface fun onConnected(url: String) = saveHistory(url)
        @JavascriptInterface fun history(): String = prefs.getString("history", "[]") ?: "[]"

        @JavascriptInterface
        fun forget(host: String) {
            val old = JSONArray(prefs.getString("history", "[]"))
            val out = JSONArray()
            for (i in 0 until old.length()) old.optJSONObject(i)?.let { if (it.optString("host") != host) out.put(it) }
            prefs.edit().putString("history", out.toString()).apply()
        }

        @JavascriptInterface fun deviceName(): String = this@MainActivity.deviceName()

        @JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (_: Exception) {
            ""
        }
    }
}
