# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- This app's own native modules ---
# Small package, all of it — PushNotificationsModule, WidgetBridgeModule,
# CoachSummaryWidgetProvider, etc. are invoked by name from JS via
# @ReactMethod reflection and from the OS (Intent target, AppWidgetProvider)
# by class name — obfuscating or stripping any of them breaks that lookup at
# runtime with no build-time warning. Cheap to exempt entirely; this isn't a
# third-party library where shrinking actually saves meaningful size.
-keep class com.gymbee.** { *; }

# React Native invokes every @ReactMethod-annotated native method by name
# via reflection, regardless of new/old architecture — keep the annotation
# and anything it's applied to across every module, not just this app's own.
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}

# Firebase Cloud Messaging (push) — modern Firebase AARs bundle their own
# consumer ProGuard rules, so this is redundant more often than not, but
# there's no runtime signal if that assumption is ever wrong for a future
# BoM version, and the size cost of keeping one small SDK is negligible next
# to the risk of a silently broken push pipeline.
-keep class com.google.firebase.messaging.** { *; }
-dontwarn com.google.firebase.**

# RevenueCat (react-native-purchases / -ui) — same reasoning as Firebase
# above; also currently gated off entirely behind REVENUECAT_ENABLED, but
# keeping it correct now avoids a surprise the day that flag flips on.
-keep class com.revenuecat.purchases.** { *; }
-dontwarn com.revenuecat.purchases.**

# Reanimated/Worklets — worklets are compiled and invoked by class/method
# name from native (JNI) and from the JS runtime directly, not through
# normal Java call sites R8 can trace; renaming or stripping any of this
# breaks worklets silently at runtime rather than at build time. Per
# Reanimated's own ProGuard guidance.
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-dontwarn com.swmansion.reanimated.**
