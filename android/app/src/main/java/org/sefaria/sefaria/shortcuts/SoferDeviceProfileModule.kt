package org.sefaria.sefaria.shortcuts

import android.app.ActivityManager
import android.content.Context
import android.os.Process
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/** Exposes the Android memory profile used to keep optional reader prewarming modest. */
class SoferDeviceProfileModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @Suppress("DEPRECATION")
    override fun getConstants(): MutableMap<String, Any> {
        val activityManager =
            reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val lowMemory = !Process.is64Bit() || activityManager.isLowRamDevice || activityManager.memoryClass <= 128
        return mutableMapOf("isLowMemoryAndroid" to lowMemory)
    }

    companion object {
        const val NAME = "SoferDeviceProfile"
    }
}
