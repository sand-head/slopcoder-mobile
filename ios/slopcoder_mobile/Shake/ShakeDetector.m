#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// The Swift class above, exposed to JavaScript — the same shape as
// PushRegistrar and AppInfo, and for the same reason: RCT_EXTERN_MODULE needs
// no generated Swift header.
@interface RCT_EXTERN_MODULE (ShakeDetector, RCTEventEmitter)

RCT_EXTERN_METHOD(start)
RCT_EXTERN_METHOD(stop)

@end
