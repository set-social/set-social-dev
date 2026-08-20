#import <React/RCTBridgeModule.h>

// Exposes the Swift WidgetBridge class to JS. React Native's Swift/ObjC
// interop needs this ObjC-side declaration even though the implementation
// lives entirely in WidgetBridge.swift — the macros below just describe the
// method signatures the JS bridge should generate.
@interface RCT_EXTERN_MODULE(WidgetBridge, NSObject)

RCT_EXTERN_METHOD(setPayload:(NSString *)json
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(reloadWidgets)

@end
