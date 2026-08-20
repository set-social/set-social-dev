import SwiftUI
import WidgetKit

// MARK: - Colors
//
// Same palette as src/theme/tokens.ts, with a light counterpart added since
// (unlike the app, which is dark-only) a Home Screen widget sits on whatever
// theme the user's actual home screen is in. `good`'s light value matches
// tokens.ts's lightColors.accent.primary exactly (both independently
// deepened from the same dark-mode base for contrast on white) — see that
// file's own comment for the reasoning.

private extension Color {
    init(light: UIColor, dark: UIColor) {
        self.init(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

enum WidgetColors {
    static let bg = Color(
        light: .white,
        dark: UIColor(red: 0x1D / 255, green: 0x22 / 255, blue: 0x2C / 255, alpha: 1)
    )
    static let textPrimary = Color(
        light: UIColor(red: 0x14 / 255, green: 0x16 / 255, blue: 0x1A / 255, alpha: 1),
        dark: UIColor(red: 0xF2 / 255, green: 0xF4 / 255, blue: 0xF7 / 255, alpha: 1)
    )
    static let textSecondary = Color(
        light: UIColor(red: 0x62 / 255, green: 0x66 / 255, blue: 0x6F / 255, alpha: 1),
        dark: UIColor(red: 0xA7 / 255, green: 0xAF / 255, blue: 0xBD / 255, alpha: 1)
    )
    static let textTertiary = Color(
        light: UIColor(red: 0x94 / 255, green: 0x98 / 255, blue: 0xA0 / 255, alpha: 1),
        dark: UIColor(red: 0x73 / 255, green: 0x7C / 255, blue: 0x8C / 255, alpha: 1)
    )
    static let divider = Color(light: UIColor(white: 0, alpha: 0.09), dark: UIColor(white: 1, alpha: 0.08))
    /// "Ready" — high/moderate readiness, or a completed workout. Was
    /// #00A870/#00E38E (green) — kept in sync by hand with
    /// android/app/src/main/res/values{,-night}/colors.xml's widgetGood and
    /// src/theme/tokens.ts's accent.primary, all three updated together.
    static let good = Color(
        light: UIColor(red: 0x00 / 255, green: 0xA3 / 255, blue: 0x8D / 255, alpha: 1),
        dark: UIColor(red: 0x00 / 255, green: 0xF5 / 255, blue: 0xD4 / 255, alpha: 1)
    )
    /// "Ease in" — low/very-low readiness.
    static let warn = Color(
        light: UIColor(red: 0xA5 / 255, green: 0x67 / 255, blue: 0x0C / 255, alpha: 1),
        dark: UIColor(red: 0xFF / 255, green: 0xB4 / 255, blue: 0x54 / 255, alpha: 1)
    )
    /// Rest day, or no readiness data yet — deliberately colorless so it
    /// never competes with "good"/"warn" for attention at a glance.
    static let neutral = textTertiary
}

// MARK: - Badge

private enum BadgeGlyph {
    case bolt, moon, check, info

    var systemName: String {
        switch self {
        case .bolt: return "bolt.fill"
        case .moon: return "moon.fill"
        case .check: return "checkmark"
        case .info: return "info"
        }
    }
}

/// Mirrors AiSummaryCard's `iconFor(band, isRestDay)` on the Home tab, with
/// one deliberate difference: the in-app card always tints its icon accent
/// green regardless of band, since it's a card you're already reading. A
/// widget is competing with two dozen other icons on a home screen, so this
/// colors the badge by band too — glanceability matters more here.
private func badgeGlyph(for payload: WidgetPayload) -> BadgeGlyph {
    if payload.plan.kind == "completed" { return .check }
    if payload.isRestDay { return .moon }
    switch payload.band {
    case "high", "moderate": return .bolt
    case "low", "very_low": return .moon
    default: return .info
    }
}

// MARK: - Brand mark

/// The real SetSocial mark (src/assets/branding/setsocial-mark.png, copied
/// into this target's own asset catalog — see
/// Assets.xcassets/SetSocialMark.imageset) rather than a redrawn
/// approximation, same asset the app itself renders via SetSocialIcon.
struct BrandMarkView: View {
    var size: CGFloat = 16

    var body: some View {
        // The source PNG is the app's "light-on-dark" mark (see
        // SetSocialLogo.tsx) — a light glyph on transparent, meant for a
        // dark surface. Rendered as-is it all but disappears on this
        // widget's light-mode white background. .template mode discards the
        // baked-in color and uses only the alpha channel, so tinting it with
        // the same theme-adaptive color as the widget's own text keeps it
        // visible (and on-brand-neutral) in both appearances.
        Image("SetSocialMark")
            .renderingMode(.template)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
            .foregroundColor(WidgetColors.textPrimary)
    }
}

/// Full mark + wordmark lockup — composed from the tintable mark above plus
/// code-rendered "Set"/"Social" text, the same two-tone split
/// SetSocialLogo.tsx uses for its own light-background fallback, rather than
/// importing the app's real wordmark PNG. That asset is baked "light-on-dark"
/// the same way the mark was (see BrandMarkView above) — reusing it here
/// would just reintroduce the light-mode-invisible bug for the whole
/// lockup instead of only the icon, and it's not template-tintable as a
/// single color without losing the "Social" accent entirely.
struct BrandLockupView: View {
    var markSize: CGFloat = 14
    var fontSize: CGFloat = 13

    var body: some View {
        HStack(spacing: markSize * 0.4) {
            BrandMarkView(size: markSize)
            (Text("Set").foregroundColor(WidgetColors.textPrimary)
                + Text("Social").foregroundColor(WidgetColors.good))
                .font(.system(size: fontSize, weight: .heavy))
        }
    }
}

// MARK: - Log Food link

/// Same fixed URL buildWidgetPayload.ts always sets — the literal fallback
/// here only matters for a payload saved before this field existed (an old
/// build's payload, still sitting in the shared store until the next sync).
private func logFoodURL(_ payload: WidgetPayload) -> URL {
    URL(string: payload.logFoodDeepLink ?? "soset://chat?openFoodLog=1")!
}

private struct LogFoodLinkView: View {
    let payload: WidgetPayload
    var compact: Bool = false

    var body: some View {
        Link(destination: logFoodURL(payload)) {
            HStack(spacing: 5) {
                Image(systemName: "fork.knife")
                    .font(.system(size: compact ? 10 : 11, weight: .semibold))
                Text("Log Food")
                    .font(.system(size: compact ? 11 : 12, weight: .semibold))
            }
            .foregroundColor(WidgetColors.textPrimary)
            .padding(.horizontal, compact ? 8 : 10)
            .padding(.vertical, compact ? 5 : 7)
            .background(WidgetColors.divider)
            .clipShape(Capsule())
        }
    }
}

/// A glyph tied to what today's plan actually IS, not a readiness state —
/// this is what replaces the readiness badge in Small/Medium (Large already
/// dropped it): a dumbbell/heart/moon for the plan itself is information
/// you'd otherwise have to read the title for, where a bolt/moon/check tied
/// to readiness was just status noise repeating what the stats line already
/// says. Sticking to symbols that predate iOS 14 — safe against this
/// project's 15.1 deployment target, unlike e.g. "dumbbell.fill" (iOS 16).
private func planKindGlyph(for payload: WidgetPayload) -> String {
    switch payload.plan.kind {
    case "cardio": return "heart.fill"
    case "completed": return "checkmark.circle.fill"
    case "rest": return "moon.fill"
    case "training": return "flame.fill"
    default: return "calendar"
    }
}

/// "68% Ready · 4d streak" — value-first and single-letter units, terser
/// than Large/Medium-chip wording since this is one inline line at 11pt in
/// a 155pt-wide tile, not a labeled chip or a wide canvas.
private func compactStatsText(_ payload: WidgetPayload) -> String? {
    var bits: [String] = []
    if let readiness = payload.readinessScore { bits.append("\(readiness)% Ready") }
    if let streak = payload.streak, streak > 0 { bits.append("\(streak)d streak") }
    return bits.isEmpty ? nil : bits.joined(separator: " · ")
}

private struct StatChip: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 8, weight: .bold))
                .tracking(0.3)
                .foregroundColor(WidgetColors.textTertiary)
            Text(value)
                .font(.system(size: 13, weight: .heavy))
                .foregroundColor(WidgetColors.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(WidgetColors.divider)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - Small

/// Numbers and a title, not sentences — Small has no room to show any part
/// of the AI-generated summary without either shrinking it illegibly or
/// gambling on where it wraps, so it shows none of it: a plan-kind glyph,
/// the plan title (which is already short by construction — it's a workout
/// name, never a full sentence), and one compact stats line.
struct SmallWidgetView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandLockupView(markSize: 15, fontSize: 13)

            Spacer(minLength: 10)

            Image(systemName: planKindGlyph(for: payload))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(WidgetColors.good)

            Text(payload.plan.title ?? "Nothing planned")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(payload.plan.title == nil ? WidgetColors.textTertiary : WidgetColors.textPrimary)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .padding(.top, 6)

            Spacer(minLength: 8)

            if let stats = compactStatsText(payload) {
                Text(stats)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(WidgetColors.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }
}

// MARK: - Medium

/// Same "data, not prose" idea as Small, with the extra width spent on
/// stat chips instead of a stats sentence — "68%"/"4d" in their own small
/// pills reads faster at this width than a joined "Readiness 68% · 4 day
/// streak" line would anyway.
struct MediumWidgetView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                BrandLockupView(markSize: 13, fontSize: 12)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(WidgetColors.textTertiary)
            }

            HStack(spacing: 8) {
                Image(systemName: planKindGlyph(for: payload))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(WidgetColors.good)
                Text(payload.plan.title ?? "Nothing planned")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundColor(payload.plan.title == nil ? WidgetColors.textTertiary : WidgetColors.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .padding(.top, 10)

            Spacer(minLength: 8)

            HStack(spacing: 8) {
                if let readiness = payload.readinessScore {
                    StatChip(label: "READY", value: "\(readiness)%")
                }
                if let streak = payload.streak, streak > 0 {
                    StatChip(label: "STREAK", value: "\(streak)d")
                }
                Spacer(minLength: 6)
                LogFoodLinkView(payload: payload, compact: true)
            }
        }
    }
}

// MARK: - Large

struct LargeWidgetView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                BrandLockupView(markSize: 14, fontSize: 13)
                Text("COACH SUMMARY")
                    .font(.system(size: 10.5, weight: .bold))
                    .tracking(0.3)
                    .foregroundColor(WidgetColors.textTertiary)
                Spacer()
                HStack(spacing: 3) {
                    Image(systemName: "clock")
                        .font(.system(size: 10))
                    Text(updatedTimeText)
                        .font(.system(size: 10, weight: .medium))
                }
                .foregroundColor(WidgetColors.textTertiary)
            }

            Text(payload.headline)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(WidgetColors.textPrimary)
                .padding(.top, 12)
                .padding(.bottom, 6)
                .lineLimit(2)

            // No lineLimit — the whole point is this never truncates.
            // Wrapping is unbounded, .fixedSize forces the view to actually
            // claim the height all of it needs rather than being compressed
            // by the VStack, and everything below it is normal-priority so
            // it yields room to this before its own padding.
            Text(payload.summary)
                .font(.system(size: 13))
                .foregroundColor(WidgetColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Rectangle().fill(WidgetColors.divider).frame(height: 1).padding(.vertical, 10)

            // Plan row and the stats/action row below replace what used to
            // be five stacked blocks (a "TODAY'S PLAN" label, this row, a
            // 3-column labeled stat grid, a separate sessions line, and a
            // full-width Log Food row) — collapsed to two, on the same
            // "one combined line" reasoning as Android's populateMetricsLine.
            // That's the room the summary above needed to stop truncating.
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(payload.plan.title ?? "Nothing planned")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(payload.plan.title == nil ? WidgetColors.textTertiary : WidgetColors.textPrimary)
                        .lineLimit(1)
                    if let meta = payload.plan.meta {
                        Text(meta)
                            .font(.system(size: 12))
                            .foregroundColor(WidgetColors.textTertiary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(WidgetColors.textTertiary)
            }

            HStack(spacing: 8) {
                if let metrics = metricsLineText {
                    Text(metrics)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(WidgetColors.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                LogFoodLinkView(payload: payload, compact: true)
            }
            .padding(.top, 10)
        }
    }

    /// "Readiness 82% · 6 day streak · 1450/2200 cal" — same wording and
    /// " · " join as Android's populateMetricsLine, so the two platforms
    /// don't read as two different products for the same data.
    private var metricsLineText: String? {
        var bits: [String] = []
        if let readiness = payload.readinessScore { bits.append("Readiness \(readiness)%") }
        if let streak = payload.streak, streak > 0 { bits.append("\(streak) day streak") }
        if let logged = payload.caloriesLogged, let target = payload.calorieTarget, target > 0 {
            bits.append("\(logged)/\(target) cal")
        }
        return bits.isEmpty ? nil : bits.joined(separator: " · ")
    }

    private var updatedTimeText: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: payload.updatedAt)
    }
}

// MARK: - Lock Screen (accessoryRectangular)

/// No background, no color — the Lock Screen renders this family in its own
/// vibrant monochrome material regardless of what's set here, so this only
/// ever specifies text, an SF Symbol, and layout.
struct AccessoryRectangularWidgetView: View {
    let payload: WidgetPayload

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: badgeGlyph(for: payload).systemName)
                .font(.system(size: 18))
            VStack(alignment: .leading, spacing: 1) {
                Text(payload.plan.title ?? payload.headline)
                    .font(.system(size: 12.5, weight: .semibold))
                    .lineLimit(1)
                Text(payload.plan.meta ?? payload.headline)
                    .font(.system(size: 11))
                    .lineLimit(1)
                    .opacity(0.8)
            }
        }
    }
}

// MARK: - Empty state (payload missing, or stale from before local midnight)

struct WidgetEmptyStateView: View {
    let family: WidgetFamily

    var body: some View {
        if family == .accessoryRectangular {
            HStack(spacing: 6) {
                Image(systemName: "arrow.clockwise")
                Text("Open SetSocial to sync")
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "arrow.clockwise.circle")
                    .font(.system(size: 22))
                    .foregroundColor(WidgetColors.textTertiary)
                Text("Open SetSocial")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(WidgetColors.textPrimary)
                Text("to sync today's summary")
                    .font(.system(size: 12))
                    .foregroundColor(WidgetColors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - Root

private struct WidgetBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(WidgetColors.bg, for: .widget)
        } else {
            content.background(WidgetColors.bg)
        }
    }
}

struct CoachSummaryWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CoachEntry

    /// nil when there's no payload yet, or the stored one predates today —
    /// both render as the same "open the app" empty state rather than
    /// showing stale numbers under the wrong date.
    private var validPayload: WidgetPayload? {
        guard let payload = entry.payload, payload.dateKey == entry.todayKey else { return nil }
        return payload
    }

    var body: some View {
        if family == .accessoryRectangular {
            Group {
                if let payload = validPayload {
                    AccessoryRectangularWidgetView(payload: payload)
                } else {
                    WidgetEmptyStateView(family: family)
                }
            }
        } else {
            Group {
                if let payload = validPayload {
                    switch family {
                    case .systemSmall:
                        SmallWidgetView(payload: payload)
                    case .systemLarge:
                        LargeWidgetView(payload: payload)
                    default:
                        MediumWidgetView(payload: payload)
                    }
                } else {
                    WidgetEmptyStateView(family: family)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(family == .systemSmall ? 14 : 16)
            .modifier(WidgetBackgroundModifier())
        }
    }
}
