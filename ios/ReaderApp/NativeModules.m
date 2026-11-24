// The app's own Swift native modules, made known to React Native (a Swift class cannot export itself).
#import <React/RCTBridgeModule.h>

// the pinned tabs widget's rows (PinnedTabsWidgetModule.swift)
@interface RCT_EXTERN_MODULE(PinnedTabsWidget, NSObject)
RCT_EXTERN_METHOD(setSnapshot:(NSString *)json)
@end

// the app icon's long-press shortcuts (yo.swift): never exported before, so iOS had none
@interface RCT_EXTERN_MODULE(AppIconShortcuts, NSObject)
RCT_EXTERN_METHOD(setShortcuts:(NSArray *)items)
@end
