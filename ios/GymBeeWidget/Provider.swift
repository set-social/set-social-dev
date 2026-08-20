import WidgetKit

/// Never fetches or computes anything — `currentEntry()` just reads whatever
/// the app last wrote to the shared App Group store (see WidgetStore in
/// Shared/WidgetPayload.swift). All the actual coaching/schedule logic lives
/// in TS, where the coaching engine and the day-plan resolver already exist.
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> CoachEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (CoachEntry) -> Void) {
        completion(context.isPreview ? .placeholder : currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CoachEntry>) -> Void) {
        let entry = currentEntry()
        let timeline = Timeline(entries: [entry], policy: .after(Self.nextSixAM(after: Date())))
        completion(timeline)
    }

    private func currentEntry() -> CoachEntry {
        CoachEntry(date: Date(), payload: WidgetStore.load())
    }

    /// The daily refresh boundary: "starting at 6 AM." This policy only
    /// covers the case where the app is never opened between two 6 AMs —
    /// WidgetKit also reloads immediately any time the app calls
    /// `WidgetCenter.reloadAllTimelines()` after writing fresh data (a Whoop
    /// sync, a logged workout), which is the "or whenever the app is
    /// refreshed" half of the requirement and needs no timeline policy at
    /// all, just that reload call.
    static func nextSixAM(after date: Date) -> Date {
        var calendar = Calendar.current
        calendar.timeZone = .current
        var components = calendar.dateComponents([.year, .month, .day], from: date)
        components.hour = 6
        components.minute = 0
        components.second = 0
        let todaySixAM = calendar.date(from: components) ?? date
        if todaySixAM > date {
            return todaySixAM
        }
        return calendar.date(byAdding: .day, value: 1, to: todaySixAM) ?? date.addingTimeInterval(86_400)
    }
}
