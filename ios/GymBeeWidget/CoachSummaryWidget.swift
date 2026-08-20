import WidgetKit
import SwiftUI

struct CoachSummaryWidget: Widget {
    let kind: String = "CoachSummaryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            CoachSummaryWidgetView(entry: entry)
        }
        .configurationDisplayName("Coach Summary")
        .description("Today's readiness, streak, calories, and what's next on your training calendar — tap Log Food to send Arnold a meal.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}
