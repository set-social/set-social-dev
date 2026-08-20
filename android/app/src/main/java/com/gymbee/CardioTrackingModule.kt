package com.gymbee

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** JS-facing start/stop for CardioTrackingService — see that class's own
 * doc comment for why it exists (keeping the process alive for background
 * GPS tracking, not doing location work itself). Module name
 * ("CardioTrackingService") matches what routeTracking.ts looks up via
 * NativeModules — deliberately not "CardioTrackingModule", so the JS side
 * names it after what it controls, not the bridge class. */
class CardioTrackingModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "CardioTrackingService"

  @ReactMethod
  fun start() {
    val intent = Intent(reactApplicationContext, CardioTrackingService::class.java)
    ContextCompat.startForegroundService(reactApplicationContext, intent)
  }

  @ReactMethod
  fun stop() {
    reactApplicationContext.stopService(Intent(reactApplicationContext, CardioTrackingService::class.java))
  }
}
