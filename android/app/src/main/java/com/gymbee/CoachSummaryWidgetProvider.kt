package com.gymbee

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Same SharedPreferences file WidgetBridgeModule writes to — this provider
 * never fetches or computes anything itself, only reads whatever the RN app
 * last wrote (same "the extension is a pure read/decode target" contract as
 * ios/GymBeeWidget's WidgetStore). */
private const val PREFS_NAME = "widget_data"
private const val PAYLOAD_KEY = "coachSummaryWidgetPayload"

private const val LOG_FOOD_FALLBACK_URL = "soset://chat?openFoodLog=1"

/**
 * Android counterpart of the iOS CoachSummaryWidget extension. Android has
 * no WidgetKit-style declarative timeline — this AppWidgetProvider redraws
 * on the system's own onUpdate calls (the manifest's updatePeriodMillis="0"
 * means none of those happen automatically) and whenever
 * WidgetBridgeModule.reloadWidgets() broadcasts an update after the RN app
 * writes a fresh payload. There's no server-driven "daily 6 AM rollover"
 * timer to match WidgetKit's — instead, staleness is detected passively the
 * same way as iOS (payload.dateKey != today falls back to the empty state),
 * so a widget that hasn't been told about a new day yet just prompts
 * "Open SetSocial to sync" rather than showing yesterday's plan.
 */
class CoachSummaryWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        /** Called by WidgetBridgeModule.reloadWidgets() after a fresh
         * payload is written — refreshes every placed instance of this
         * widget, mirroring WidgetCenter.shared.reloadAllTimelines() on
         * iOS. */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, CoachSummaryWidgetProvider::class.java))
            for (id in ids) {
                updateWidget(context, manager, id)
            }
        }

        private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_coach_summary)
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val rawJson = prefs.getString(PAYLOAD_KEY, null)
            val payload = rawJson?.let { runCatching { JSONObject(it) }.getOrNull() }
            val isValid = payload != null && payload.optString("dateKey", "") == todayDateKey()

            // Whole-widget tap always opens the app, valid payload or not —
            // same fallback the empty state's own copy points to.
            val openAppIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val openAppPending = PendingIntent.getActivity(
                context,
                0,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widgetRoot, openAppPending)

            if (!isValid) {
                views.setViewVisibility(R.id.dataContainer, View.GONE)
                views.setViewVisibility(R.id.emptyStateContainer, View.VISIBLE)
                appWidgetManager.updateAppWidget(appWidgetId, views)
                return
            }
            val data = payload!!

            views.setViewVisibility(R.id.dataContainer, View.VISIBLE)
            views.setViewVisibility(R.id.emptyStateContainer, View.GONE)

            populateHeadlineAndBadge(context, views, data)
            populatePlan(context, views, data)
            populateMetricsLine(views, data)
            populateSessionsLine(views, data)
            wireLogFoodButton(context, views, data)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private fun populateHeadlineAndBadge(context: Context, views: RemoteViews, data: JSONObject) {
            views.setTextViewText(R.id.headline, data.optString("headline", ""))

            val isRestDay = data.optBoolean("isRestDay", false)
            val band = data.optStringOrNull("band")
            val planKind = data.optJSONObject("plan")?.optString("kind") ?: "none"
            // Mirrors badgeColor(for:) in CoachSummaryWidgetView.swift exactly.
            val colorRes = when {
                planKind == "completed" -> R.color.widgetGood
                isRestDay -> R.color.widgetTextTertiary
                band == "high" || band == "moderate" -> R.color.widgetGood
                band == "low" || band == "very_low" -> R.color.widgetWarn
                else -> R.color.widgetTextTertiary
            }
            views.setInt(R.id.badgeDot, "setColorFilter", ContextCompat.getColor(context, colorRes))
        }

        private fun populatePlan(context: Context, views: RemoteViews, data: JSONObject) {
            val plan = data.optJSONObject("plan")
            val title = plan?.optStringOrNull("title")
            val meta = plan?.optStringOrNull("meta")

            views.setTextViewText(R.id.planTitle, title ?: "Nothing planned")
            views.setTextColor(
                R.id.planTitle,
                ContextCompat.getColor(context, if (title == null) R.color.widgetTextTertiary else R.color.widgetTextPrimary),
            )
            if (meta != null) {
                views.setViewVisibility(R.id.planMeta, View.VISIBLE)
                views.setTextViewText(R.id.planMeta, meta)
            } else {
                views.setViewVisibility(R.id.planMeta, View.GONE)
            }
        }

        /** One combined line ("Readiness 82% · 6 day streak · 1450/2200
         * cal") rather than separate stat views — RemoteViews' per-view API
         * is verbose enough that this is the simplest robust approach for a
         * handful of optional numbers, versus iOS's SwiftUI stack of
         * MetricStatViews. */
        private fun populateMetricsLine(views: RemoteViews, data: JSONObject) {
            val bits = mutableListOf<String>()
            data.optIntOrNull("readinessScore")?.let { bits.add("Readiness $it%") }
            val streak = data.optInt("streak", 0)
            if (streak > 0) bits.add("$streak day streak")
            val logged = data.optIntOrNull("caloriesLogged")
            val target = data.optIntOrNull("calorieTarget")
            if (logged != null && target != null && target > 0) bits.add("$logged/$target cal")

            if (bits.isEmpty()) {
                views.setViewVisibility(R.id.metricsLine, View.GONE)
            } else {
                views.setViewVisibility(R.id.metricsLine, View.VISIBLE)
                views.setTextViewText(R.id.metricsLine, bits.joinToString(" · "))
            }
        }

        private fun populateSessionsLine(views: RemoteViews, data: JSONObject) {
            val sessions = data.optIntOrNull("sessionsThisWeek")
            val target = data.optIntOrNull("weeklyTarget")
            if (sessions != null && target != null && target > 0) {
                views.setViewVisibility(R.id.sessionsLine, View.VISIBLE)
                views.setTextViewText(R.id.sessionsLine, "$sessions of $target sessions this week")
            } else {
                views.setViewVisibility(R.id.sessionsLine, View.GONE)
            }
        }

        private fun wireLogFoodButton(context: Context, views: RemoteViews, data: JSONObject) {
            val url = data.optStringOrNull("logFoodDeepLink") ?: LOG_FOOD_FALLBACK_URL
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                // Constrains resolution to this app's own soset:// intent-filter
                // (AndroidManifest.xml) rather than leaving it fully implicit —
                // a widget PendingIntent has no UI to fall back on if resolution
                // were ever ambiguous.
                setPackage(context.packageName)
            }
            val pending = PendingIntent.getActivity(
                context,
                1,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.logFoodButton, pending)
        }

        private fun todayDateKey(): String {
            val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            formatter.timeZone = TimeZone.getDefault()
            return formatter.format(Date())
        }
    }
}

/** org.json.JSONObject has no built-in "get this key, or null for either
 * JSON null or a missing key" — optString returns the literal string "null"
 * for a JSON null value unless you check isNull first, which every payload
 * field read above needs (every optional WidgetPayload field can be
 * either). Centralized here rather than repeating the isNull dance at each
 * call site. */
private fun JSONObject.optStringOrNull(name: String): String? =
    if (isNull(name)) null else optString(name, null)

private fun JSONObject.optIntOrNull(name: String): Int? =
    if (isNull(name)) null else if (has(name)) optInt(name) else null
