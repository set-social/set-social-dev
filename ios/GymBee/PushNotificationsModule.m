#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Swift implementation lives in PushNotificationsModule.swift — this file
// only exists to declare that class (and its promise-returning methods) to
// the Objective-C module registry, which is how RN discovers Swift-authored
// native modules without a bridging header. See React Native's docs on
// "Native Modules with Swift" for this exact two-file pattern.
@interface RCT_EXTERN_MODULE(PushNotificationsModule, RCTEventEmitter)

RCT_EXTERN_METHOD(requestPermission
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getAuthorizationStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getInitialNotification
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
