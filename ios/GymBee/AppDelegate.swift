import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    UNUserNotificationCenter.current().delegate = self

    // Cold launch from a notification tap — JS isn't up yet, so this is
    // stashed for PushNotificationsModule.getInitialNotification to hand
    // back once it is. A warm/background launch instead goes through
    // userNotificationCenter(_:didReceive:withCompletionHandler:) below.
    if let remoteNotification = launchOptions?[.remoteNotification] as? [String: Any] {
      PushNotificationsModule.launchNotification = remoteNotification
    }

    factory.startReactNative(
      withModuleName: "GymBee",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    PushNotificationsModule.shared?.didReceiveToken(deviceToken)
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    PushNotificationsModule.shared?.didFailToRegister(error)
  }

  // Notification arrives while the app is in the foreground — still shown
  // as a banner (SetSocial has no in-app notification surface of its own
  // to route this to instead) and forwarded to JS in case a screen wants
  // to react (e.g. refresh a badge) without waiting for a tap.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    PushNotificationsModule.shared?.didReceiveNotification(userInfo: notification.request.content.userInfo)
    completionHandler([.banner, .sound, .badge])
  }

  // The athlete tapped the notification (app was backgrounded or launched
  // fresh by the tap) — this is the deep-link trigger.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    PushNotificationsModule.shared?.didOpenNotification(userInfo: response.notification.request.content.userInfo)
    completionHandler()
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
