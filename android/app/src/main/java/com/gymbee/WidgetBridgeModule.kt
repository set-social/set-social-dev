package com.gymbee

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONException

/** Same SharedPreferences file CoachSummaryWidgetProvider reads from. */
private const val PREFS_NAME = "widget_data"
private const val PAYLOAD_KEY = "coachSummaryWidgetPayload"

/**
 * JS-facing counterpart of ios/GymBee/WidgetBridge.swift — same module name
 * ("WidgetBridge", see nativeWidgetBridge.ts) and the same two-call contract
 * (write the payload, then ask the OS to redraw). Android has no App Group
 * shared container; a plain SharedPreferences file works because
 * AppWidgetProvider always runs in-process with the host app here (no
 * widget extension process split the way iOS's WidgetKit requires).
 */
class WidgetBridgeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "WidgetBridge"

  @ReactMethod
  fun setPayload(json: String, promise: Promise) {
    try {
      // Parse-validate before persisting — a malformed payload should reject
      // here rather than get written and silently break the next render.
      org.json.JSONObject(json)
      reactApplicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PAYLOAD_KEY, json)
        .apply()
      promise.resolve(null)
    } catch (e: JSONException) {
      promise.reject("invalid_payload", "WidgetBridge.setPayload received malformed JSON", e)
    }
  }

  @ReactMethod
  fun reloadWidgets() {
    CoachSummaryWidgetProvider.updateAll(reactApplicationContext)
  }
}
