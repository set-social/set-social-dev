import Foundation
import WidgetKit
import React

/// The only bridge between the RN app and the widget extension — writes the
/// latest coach summary + plan into the shared App Group store, then tells
/// WidgetKit to redraw. The widget extension never fetches or computes
/// anything itself; every string it shows came from a `setPayload` call.
///
/// Registered as a classic (non-Turbo) native module via WidgetBridge.m's
/// RCT_EXTERN_MODULE — React Native's New Architecture interop layer
/// supports this without codegen, which keeps a two-method module like this
/// simple to hand-write and verify by reading.
@objc(WidgetBridge)
class WidgetBridge: NSObject {

    @objc
    static func requiresMainQueueSetup() -> Bool {
        // Neither method below touches UIKit or anything main-thread-only —
        // WidgetStore is plain UserDefaults I/O, and WidgetCenter's reload
        // calls are explicitly documented as safe from a background queue.
        return false
    }

    @objc(setPayload:resolver:rejecter:)
    func setPayload(
        _ json: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        do {
            try WidgetStore.save(json: json as String)
            resolve(nil)
        } catch {
            // Rejecting (rather than silently dropping) surfaces a bad
            // payload shape immediately during development — the JS side
            // still wraps every call in its own try/catch so a rejection
            // here never crashes the app, just skips this widget refresh.
            reject("widget_payload_invalid", error.localizedDescription, error)
        }
    }

    @objc(reloadWidgets)
    func reloadWidgets() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
