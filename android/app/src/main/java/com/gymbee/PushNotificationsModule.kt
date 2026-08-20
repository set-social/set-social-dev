package com.gymbee

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.google.firebase.messaging.FirebaseMessaging

private const val POST_NOTIFICATIONS_REQUEST_CODE = 6321

/**
 * Bridges FCM registration and incoming remote notifications to JS. Same
 * deliberately-minimal shape as PushNotificationsModule.swift (permission +
 * token + receive/open events) — the JS side (pushNotifications.ts) treats
 * both native modules as one interchangeable contract.
 *
 * `shared` mirrors the iOS module's static instance: SetSocialFirebaseMessagingService
 * (token refresh, message receipt) and MainActivity (notification-tap
 * intents) both run outside of any NativeModule call and need a stable place
 * to hand events to, regardless of whether JS has attached listeners yet.
 *
 * Requires a real Firebase project (android/app/google-services.json, see
 * android/app/build.gradle) — every FirebaseMessaging call below is
 * try/catch-guarded so a checkout without it yet degrades to "push doesn't
 * work" rather than a crash, same "fail closed" contract send-push's own
 * header comment documents for APNs.
 */
class PushNotificationsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    @Volatile
    var shared: PushNotificationsModule? = null

    /** The remote-notification payload the app was cold-launched from, if
     * any — set by MainActivity.onCreate from the launching Intent's
     * extras, before React Native (and this module) exist yet. Mirrors
     * PushNotificationsModule.swift's static launchNotification. */
    @Volatile
    var launchNotification: WritableMap? = null
  }

  init {
    shared = this
  }

  override fun getName() = "PushNotificationsModule"

  // NativeEventEmitter expects these on the native module it's constructed
  // with — Android's own event emitter is global (not gated on a listener
  // count the way iOS's RCTEventEmitter is), so these are just no-ops that
  // satisfy the JS-side contract rather than doing real bookkeeping.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  private fun sendEvent(eventName: String, params: Any?) {
    val ctx = reactApplicationContext
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, params)
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    // No runtime permission exists below API 33 — notifications are
    // implicitly allowed at install, same "just grant it" shape iOS had
    // before UNUserNotificationCenter required an explicit prompt.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      fetchAndEmitToken()
      promise.resolve(true)
      return
    }

    if (isNotificationPermissionGranted()) {
      fetchAndEmitToken()
      promise.resolve(true)
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      // No foreground activity to request through right now — resolve
      // false rather than hang; the primer only ever calls this from a
      // visible screen, so this is a defensive fallback, not the common path.
      promise.resolve(false)
      return
    }

    activity.requestPermissions(
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      POST_NOTIFICATIONS_REQUEST_CODE,
      PermissionListener { requestCode, _, grantResults ->
        if (requestCode != POST_NOTIFICATIONS_REQUEST_CODE) return@PermissionListener false
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted) fetchAndEmitToken()
        promise.resolve(granted)
        true
      },
    )
  }

  @ReactMethod
  fun getAuthorizationStatus(promise: Promise) {
    val status = when {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> "authorized"
      isNotificationPermissionGranted() -> "authorized"
      // Android can't cleanly distinguish "denied" from "never asked" from
      // here (that needs shouldShowRequestPermissionRationale against a live
      // Activity) — notDetermined is the safer default since it's what lets
      // the in-app primer offer to ask again rather than assuming a hard no.
      else -> "notDetermined"
    }
    promise.resolve(status)
  }

  @ReactMethod
  fun getInitialNotification(promise: Promise) {
    promise.resolve(launchNotification)
    launchNotification = null
  }

  private fun isNotificationPermissionGranted(): Boolean =
    ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED

  private fun fetchAndEmitToken() {
    try {
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        val token = task.result
        if (task.isSuccessful && token != null) {
          didReceiveToken(token)
        } else {
          didFailToRegister(task.exception?.message ?: "Unknown FCM registration error")
        }
      }
    } catch (e: Exception) {
      didFailToRegister(e.message ?: "Firebase not configured")
    }
  }

  fun didReceiveToken(token: String) {
    sendEvent("pushTokenReceived", token)
  }

  fun didFailToRegister(message: String) {
    sendEvent("pushTokenRegistrationFailed", message)
  }

  fun didReceiveNotification(data: WritableMap) {
    sendEvent("pushNotificationReceived", data)
  }

  fun didOpenNotification(data: WritableMap) {
    sendEvent("pushNotificationOpened", data)
  }
}
