package com.gymbee

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "GymBee"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // Cold launch from a notification tap (app was killed) — JS isn't up yet,
  // so this is stashed for PushNotificationsModule.getInitialNotification to
  // hand back once it is. Mirrors AppDelegate.swift's
  // launchOptions?[.remoteNotification] capture. See
  // SetSocialFirebaseMessagingService.kt for why `screen`/`params` land as
  // plain Intent extras either way (OS-auto-displayed or our own
  // showNotification PendingIntent).
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    PushNotificationsModule.launchNotification = notificationPayloadFrom(intent)
  }

  // Warm tap — app already running (foreground or background).
  // android:launchMode="singleTask" (see AndroidManifest.xml, also what the
  // soset:// OAuth-callback deep link relies on) routes the tap here instead
  // of a fresh onCreate. Mirrors AppDelegate's
  // userNotificationCenter(_:didReceive:) handler.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val payload = notificationPayloadFrom(intent) ?: return
    PushNotificationsModule.shared?.didOpenNotification(payload)
  }
}

private fun notificationPayloadFrom(intent: Intent?): WritableMap? {
  val screen = intent?.getStringExtra("screen") ?: return null
  val map = Arguments.createMap()
  map.putString("screen", screen)
  intent.getStringExtra("params")?.let { map.putString("params", it) }
  return map
}
