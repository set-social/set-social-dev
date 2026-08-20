package com.gymbee

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

private const val CHANNEL_ID = "default"
private const val NOTIFICATION_ID = 1

/**
 * Registered in AndroidManifest.xml. Two independent jobs, same split as
 * AppDelegate.swift's didRegisterForRemoteNotifications/willPresent:
 * forward a refreshed token to JS (onNewToken), and — while the app process
 * is alive, foreground or background — build and show the notification
 * ourselves plus forward it to JS (onMessageReceived). A killed app never
 * reaches onMessageReceived at all; FCM's `notification` block (see
 * send-push's sendFcm) is what the OS auto-displays from the system tray in
 * that case, with our `data` payload attached to the launch Intent it fires
 * on tap — same MainActivity.onCreate capture path a warm/background tap
 * uses (see SetSocialFirebaseMessagingService's showNotification below and
 * MainActivity.kt's onNewIntent).
 */
class SetSocialFirebaseMessagingService : FirebaseMessagingService() {

  override fun onNewToken(token: String) {
    super.onNewToken(token)
    // The module may not exist yet — a token refresh can fire before RN has
    // started (e.g. right after install/update) — same nullable guard
    // PushNotificationsModule itself uses before emitting anything.
    PushNotificationsModule.shared?.didReceiveToken(token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    PushNotificationsModule.shared?.didReceiveNotification(dataToWritableMap(message.data))
    showNotification(message)
  }

  private fun showNotification(message: RemoteMessage) {
    val title = message.notification?.title ?: message.data["title"] ?: return
    val body = message.notification?.body ?: message.data["body"]

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "General", NotificationManager.IMPORTANCE_HIGH),
      )
    }

    // FCM attaches its `data` payload as plain string extras on this launch
    // Intent automatically for the OS-auto-displayed (killed-app) case; this
    // PendingIntent reproduces that same extras shape by hand for the
    // app-alive case this function actually runs in, so MainActivity reads
    // `screen`/`params` identically either way.
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      message.data["screen"]?.let { putExtra("screen", it) }
      message.data["params"]?.let { putExtra("params", it) }
    } ?: return
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    // ic_setsocial_mark has a real alpha channel (transparent outside the
    // glyph — see its comment in widget_coach_summary.xml), so Android's
    // status-bar silhouette mask actually traces the mark instead of
    // flattening to a solid blob, which is what applicationInfo.icon (the
    // fully-opaque launcher icon) produced. setColor is the tint applied to
    // that silhouette in the notification shade/lock screen — same asset and
    // color the manifest's default_notification_icon/_color meta-data use
    // for the killed-app auto-display path, so both look identical.
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_setsocial_mark)
      .setColor(ContextCompat.getColor(this, R.color.notificationAccent))
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    manager.notify(NOTIFICATION_ID, notification)
  }
}

private fun dataToWritableMap(data: Map<String, String>): WritableMap {
  val map = Arguments.createMap()
  for ((key, value) in data) map.putString(key, value)
  return map
}
