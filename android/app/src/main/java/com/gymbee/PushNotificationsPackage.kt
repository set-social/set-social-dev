package com.gymbee

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Registers PushNotificationsModule — a local module can't be autolinked
 * the way an npm dependency's native code is, so it's added by hand in
 * MainApplication.kt, same as that file's own "Packages that cannot be
 * autolinked yet" comment describes. */
class PushNotificationsPackage : ReactPackage {
  // createNativeModules is deprecated in favor of BaseReactPackage/getModule
  // (a TurboModule-oriented registration path), but still fully supported —
  // not worth the extra ReactModuleInfoProvider boilerplate for one module.
  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PushNotificationsModule(reactContext))

  @Suppress("DEPRECATION")
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
