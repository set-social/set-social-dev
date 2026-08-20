import Foundation

/// Mirrors `src/services/widget/types.ts` exactly — the RN side is the only
/// place this shape is composed (it reuses `coachingEngine` and
/// `resolveDayPlan`, both of which only exist in TS), so this struct is a
/// pure read/decode target, never something the widget itself derives.
/// Keep the two definitions in sync by hand; there's no shared codegen
/// between a WidgetKit extension and a React Native bundle.
///
/// Added to BOTH the app target and the widget extension target (Xcode's
/// File Inspector → Target Membership) — it's the one file both sides need.
struct WidgetPayload: Codable {
    let updatedAt: Date
    /// yyyy-MM-dd, local — the calendar day this payload was computed for.
    /// The provider compares this against "today" at render time so a stale
    /// payload (app not opened since before local midnight) reads as
    /// "not yet updated" rather than silently showing yesterday's plan as
    /// if it were today's.
    let dateKey: String
    let headline: String
    let summary: String
    /// "high" | "moderate" | "low" | "very_low" | nil — see ReadinessBand in
    /// src/services/coaching/types.ts. Kept as a raw string rather than a
    /// Swift enum so an unrecognized future value decodes as nil (falls back
    /// to the neutral badge) instead of failing the whole payload decode.
    let band: String?
    let isRestDay: Bool
    let plan: WidgetPlanPayload
    let sessionsThisWeek: Int?
    let weeklyTarget: Int?
    /// 0-100, same score AiSummaryCard's readiness ring shows. Deliberately
    /// no `= nil` default here (or on the three fields below) — Swift's
    /// synthesized Decodable treats a `let` property with an initial value
    /// as never-decoded (always exactly that default, JSON key ignored
    /// entirely), which is the opposite of what's needed: a plain `Int?`
    /// with no default already correctly decodes to nil when the key is
    /// absent (an old payload saved before this field existed) and to the
    /// real value when it's present — that's what actually makes this
    /// backward-compatible, not a default value.
    let readinessScore: Int?
    let streak: Int?
    let caloriesLogged: Int?
    let calorieTarget: Int?
    /// soset:// deep link that opens Arnold with the chat input focused —
    /// see buildWidgetPayload.ts's WIDGET_LOG_FOOD_DEEP_LINK. Optional only
    /// so a payload written before this field existed still decodes; the
    /// view falls back to a hardcoded copy of the same constant when nil.
    let logFoodDeepLink: String?
}

struct WidgetPlanPayload: Codable {
    /// "training" | "cardio" | "completed" | "rest" | "none"
    let kind: String
    /// "Today" | "Today · Done" | "Next"
    let label: String
    let title: String?
    let meta: String?
}

/// Reads/writes the payload through the App Group container shared between
/// the app and the widget extension. The app is the only writer; the
/// extension is the only reader — never both at once, so no locking beyond
/// what UserDefaults itself already guarantees for a single key.
enum WidgetStore {
    /// Must match the App Group ID created under both targets'
    /// Signing & Capabilities → App Groups (see the Xcode setup notes).
    static let appGroupID = "group.com.soset.app.widget"
    private static let payloadKey = "coachSummaryWidgetPayload"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    /// JS's `Date.prototype.toISOString()` — what builds the payload on the
    /// RN side — always includes exactly 3 digits of fractional seconds
    /// ("2024-01-01T12:00:00.000Z"). The plain `.iso8601` strategy's default
    /// `ISO8601DateFormatter` does NOT parse fractional seconds and would
    /// fail to decode every payload, so both directions use this formatter
    /// explicitly instead.
    private static var isoFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    private static var decoder: JSONDecoder {
        let formatter = isoFormatter
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { dec in
            let container = try dec.singleValueContainer()
            let string = try container.decode(String.self)
            guard let date = formatter.date(from: string) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO8601 date: \(string)")
            }
            return date
        }
        return decoder
    }

    private static var encoder: JSONEncoder {
        let formatter = isoFormatter
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, enc in
            var container = enc.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }

    /// `json` is the raw string handed across the bridge from JS
    /// (`JSON.stringify(payload)`) — decoded and re-encoded here rather than
    /// stored verbatim so a malformed payload from a bad app build fails
    /// loudly at write time instead of corrupting what the widget reads.
    static func save(json: String) throws {
        guard let data = json.data(using: .utf8) else {
            throw NSError(domain: "WidgetStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "Payload was not valid UTF-8"])
        }
        let payload = try decoder.decode(WidgetPayload.self, from: data)
        let reencoded = try encoder.encode(payload)
        defaults?.set(reencoded, forKey: payloadKey)
    }

    static func load() -> WidgetPayload? {
        guard let data = defaults?.data(forKey: payloadKey) else { return nil }
        return try? decoder.decode(WidgetPayload.self, from: data)
    }
}
