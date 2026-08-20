import Foundation
import UserNotifications
import React

/// Bridges APNs registration and incoming remote notifications to JS. Kept
/// deliberately minimal (permission + token + receive/open events) rather
/// than reaching for a community push library — this is the entire native
/// surface area push notifications need, and it's stable, rarely-changing
/// UIKit/UserNotifications API, not worth a dependency for.
///
/// AppDelegate owns the actual UIApplicationDelegate /
/// UNUserNotificationCenterDelegate callbacks and forwards into `shared`
/// here, since RCTEventEmitter instances are created by the RN bridge on
/// its own schedule and AppDelegate needs a stable place to hand events to
/// regardless of whether JS has started listening yet.
@objc(PushNotificationsModule)
class PushNotificationsModule: RCTEventEmitter {
  /// Set from `init()`, i.e. always the actual bridge-owned instance —
  /// `sendEvent` only works on that one, since it relies on `self.bridge`
  /// being wired up by the RN module registry. A separately-constructed
  /// `PushNotificationsModule()` would silently never deliver events.
  @objc static var shared: PushNotificationsModule?

  /// The remote-notification payload the app was cold-launched from, if
  /// any. A plain static (not an instance property) because AppDelegate
  /// captures this in `didFinishLaunchingWithOptions`, before React Native
  /// — and therefore before this module — exists yet.
  static var launchNotification: [String: Any]?

  private var hasListeners = false

  override init() {
    super.init()
    PushNotificationsModule.shared = self
  }

  override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String] {
    ["pushTokenReceived", "pushTokenRegistrationFailed", "pushNotificationReceived", "pushNotificationOpened"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let options: UNAuthorizationOptions = [.alert, .badge, .sound, .timeSensitive]
    UNUserNotificationCenter.current().requestAuthorization(options: options) { granted, error in
      if let error {
        reject("permission_error", error.localizedDescription, error)
        return
      }
      if granted {
        DispatchQueue.main.async {
          UIApplication.shared.registerForRemoteNotifications()
        }
      }
      resolve(granted)
    }
  }

  @objc func getAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let status: String
      switch settings.authorizationStatus {
      case .authorized: status = "authorized"
      case .denied: status = "denied"
      case .provisional: status = "provisional"
      case .ephemeral: status = "ephemeral"
      default: status = "notDetermined"
      }
      resolve(status)
    }
  }

  @objc func getInitialNotification(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(PushNotificationsModule.launchNotification)
    PushNotificationsModule.launchNotification = nil
  }

  func didReceiveToken(_ deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    if hasListeners {
      sendEvent(withName: "pushTokenReceived", body: hex)
    }
  }

  func didFailToRegister(_ error: Error) {
    if hasListeners {
      sendEvent(withName: "pushTokenRegistrationFailed", body: error.localizedDescription)
    }
  }

  func didReceiveNotification(userInfo: [AnyHashable: Any]) {
    if hasListeners {
      sendEvent(withName: "pushNotificationReceived", body: userInfo)
    }
  }

  func didOpenNotification(userInfo: [AnyHashable: Any]) {
    if hasListeners {
      sendEvent(withName: "pushNotificationOpened", body: userInfo)
    }
  }
}
