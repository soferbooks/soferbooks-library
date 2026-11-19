package org.sefaria.sefaria.shortcuts

import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import org.sefaria.sefaria.R
import org.sefaria.sefaria.SplashActivity

/**
 * Home-screen (pinned) shortcuts for reader tabs: ShortcutManagerCompat.requestPinShortcut.
 * No maintained React Native library offers pinned shortcuts (they add dynamic/long-press ones
 * only), so this small module does just that. JS side: tabs/tabShortcuts.js.
 *
 * The shortcut opens SplashActivity with ACTION_VIEW and the link soferbooks://tab/<id>?title=...;
 * SplashActivity passes it to MainActivity like a sefaria.org link, and React Native's Linking
 * delivers it to DeepLinkRouter (cold start: getInitialURL; app running: the 'url' event).
 */
class PinnedShortcutsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun isSupported(promise: Promise) {
        promise.resolve(ShortcutManagerCompat.isRequestPinShortcutSupported(reactContext))
    }

    /** Resolves true when the launcher was asked to add the shortcut (it asks the user itself). */
    @ReactMethod
    fun requestPin(id: String, label: String, uri: String, promise: Promise) {
        try {
            if (!ShortcutManagerCompat.isRequestPinShortcutSupported(reactContext)) {
                promise.resolve(false)
                return
            }
            val intent = Intent(reactContext, SplashActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse(uri)
            }
            val info = ShortcutInfoCompat.Builder(reactContext, id)
                .setShortLabel(label)
                .setLongLabel(label)
                .setIcon(IconCompat.createWithResource(reactContext, R.mipmap.ic_launcher))
                .setIntent(intent)
                .build()
            val context = reactContext.currentActivity ?: reactContext
            promise.resolve(ShortcutManagerCompat.requestPinShortcut(context, info, null))
        } catch (e: Exception) {
            promise.reject("E_PIN_SHORTCUT", e.message, e)
        }
    }

    /**
     * Replace the app icon's long-press (dynamic) shortcuts with up to 4 tabs
     * (shortcut-pinned tabs first, then most recent tabs).
     */
    @ReactMethod
    fun setDynamicShortcuts(items: ReadableArray, promise: Promise) {
        try {
            val max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(reactContext).coerceAtMost(4)
            val count = items.size().coerceAtMost(max)
            val shortcuts = ArrayList<ShortcutInfoCompat>(count)
            for (i in 0 until count) {
                val item = items.getMap(i) ?: continue
                val id = item.getString("id") ?: continue
                val label = item.getString("label") ?: "SoferBooks"
                val sublabel = item.getString("sublabel") ?: ""
                val url = item.getString("url") ?: continue
                val longLabel = if (sublabel.isNotEmpty() && sublabel != label) "$label — $sublabel" else label
                val intent = Intent(reactContext, SplashActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                    data = Uri.parse(url)
                }
                val info = ShortcutInfoCompat.Builder(reactContext, id)
                    .setShortLabel(label)
                    .setLongLabel(longLabel)
                    .setIcon(IconCompat.createWithResource(reactContext, R.mipmap.ic_launcher))
                    .setIntent(intent)
                    .setRank(i)
                    .build()
                shortcuts.add(info)
            }
            ShortcutManagerCompat.setDynamicShortcuts(reactContext, shortcuts)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_DYNAMIC_SHORTCUTS", e.message, e)
        }
    }

    companion object {
        const val NAME = "PinnedShortcuts"
    }
}
