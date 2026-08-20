import WidgetKit

/// yyyy-MM-dd for `date`, in the device's local calendar.
func widgetDateKey(for date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = .current
    return formatter.string(from: date)
}

struct CoachEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload?

    /// Compared against `payload.dateKey` at render time — a payload whose
    /// dateKey doesn't match today means the app hasn't refreshed it since
    /// before local midnight, so the view falls back to the empty state
    /// rather than showing yesterday's plan under today's date.
    var todayKey: String { widgetDateKey(for: date) }

    /// Shown in the widget gallery preview and while WidgetKit is still
    /// waiting on the real payload the very first time.
    static var placeholder: CoachEntry {
        let now = Date()
        return CoachEntry(
            date: now,
            payload: WidgetPayload(
                updatedAt: now,
                dateKey: widgetDateKey(for: now),
                headline: "Ready to train",
                summary: "Today's plan is Push Day (5 exercises). Recovery is strong — aim for RPE 7–8.",
                band: "high",
                isRestDay: false,
                plan: WidgetPlanPayload(kind: "training", label: "Today", title: "Push Day", meta: "5 exercises · ~42 min"),
                sessionsThisWeek: 3,
                weeklyTarget: 4,
                readinessScore: 82,
                streak: 6,
                caloriesLogged: 1450,
                calorieTarget: 2200,
                logFoodDeepLink: "soset://chat?openFoodLog=1"
            )
        )
    }
}
