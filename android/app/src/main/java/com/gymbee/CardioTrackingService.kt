package com.gymbee

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

private const val CHANNEL_ID = "cardio_tracking"
private const val NOTIFICATION_ID = 7301

/**
 * Exists purely to keep this app process alive and exempt from Doze/App
 * Standby background execution limits while a GPS-tracked run/ride is in
 * progress — see docs/gps-cardio.md's background-tracking notes. It does
 * no location work itself: `Geolocation.watchPosition`
 * (src/services/location/routeTracking.ts) keeps running in the JS engine
 * exactly as it does in the foreground; this service's only job is to hold
 * `startForeground` with an ongoing notification so the OS doesn't suspend
 * that JS engine once there's no visible Activity. Started/stopped from JS
 * via CardioTrackingModule, exactly bracketing a live session.
 */
class CardioTrackingService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannelIfNeeded()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // Not START_STICKY — if the OS kills this process outright, the
    // in-progress route is only as good as whatever AsyncStorage already
    // has (activeCardioStore persists incrementally); there's no session
    // worth resuming into from a bare service restart with no JS around it.
    return START_NOT_STICKY
  }

  private fun buildNotification(): Notification =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Tracking your run")
      .setContentText("SetSocial is recording your route in the background.")
      .setSmallIcon(R.drawable.ic_setsocial_mark)
      .setColor(ContextCompat.getColor(this, R.color.notificationAccent))
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

  private fun createChannelIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Live Run Tracking", NotificationManager.IMPORTANCE_LOW),
    )
  }
}
