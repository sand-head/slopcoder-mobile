#import <React/RCTBridgeModule.h>

// The Swift class above, exposed to JavaScript. RCT_EXTERN_MODULE needs no
// generated Swift header, which keeps this file from dragging the whole
// bridging apparatus into a target that is otherwise pure Swift.
@interface RCT_EXTERN_MODULE (PushRegistrar, NSObject)

RCT_EXTERN_METHOD(enablePush)
RCT_EXTERN_METHOD(refreshIfAlreadyAllowed)

@end
