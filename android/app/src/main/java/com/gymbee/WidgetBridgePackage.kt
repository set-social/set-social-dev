package com.gymbee

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Registers WidgetBridgeModule — same manual-registration reasoning as
 * PushNotificationsPackage.kt (a local module isn't autolinked). */
class WidgetBridgePackage : ReactPackage {
  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(WidgetBridgeModule(reactContext))

  @Suppress("DEPRECATION")
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
