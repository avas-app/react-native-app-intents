#import "ReactNativeAppIntents.h"

#import <Intents/Intents.h>
#import <UIKit/UIKit.h>

static __weak ReactNativeAppIntents *ReactNativeAppIntentsCurrentModule = nil;
static NSString *const ReactNativeAppIntentsAppGroupInfoKey = @"ReactNativeAppIntentsAppGroupIdentifier";
static NSString *const ReactNativeAppIntentsPendingURLsDefaultsKey = @"ReactNativeAppIntentsPendingURLs";

static NSUserDefaults *ReactNativeAppIntentsUserDefaults(void)
{
  id suiteName = [[NSBundle mainBundle] objectForInfoDictionaryKey:ReactNativeAppIntentsAppGroupInfoKey];

  if ([suiteName isKindOfClass:[NSString class]] && [(NSString *)suiteName length] > 0) {
    NSUserDefaults *sharedDefaults = [[NSUserDefaults alloc] initWithSuiteName:(NSString *)suiteName];

    if (sharedDefaults != nil) {
      return sharedDefaults;
    }
  }

  return [NSUserDefaults standardUserDefaults];
}

static const NSUInteger ReactNativeAppIntentsMaxPendingURLs = 100;

static NSString *ReactNativeAppIntentsInvocationID(NSString *url)
{
  NSURLComponents *components = [NSURLComponents componentsWithString:url];

  for (NSURLQueryItem *item in components.queryItems) {
    if ([item.name isEqualToString:@"invocationId"]) {
      return item.value;
    }
  }

  return nil;
}

static NSString *ReactNativeAppIntentsEnsureInvocationID(NSString *url)
{
  if (ReactNativeAppIntentsInvocationID(url) != nil) {
    return url;
  }

  NSURLComponents *components = [NSURLComponents componentsWithString:url];

  if (components == nil) {
    return url;
  }

  NSMutableArray<NSURLQueryItem *> *items = [(components.queryItems ?: @[]) mutableCopy];
  [items addObject:[NSURLQueryItem queryItemWithName:@"invocationId" value:[[NSUUID UUID] UUIDString]]];
  components.queryItems = items;

  return components.string ?: url;
}

// UserDefaults is the only store: runs stay there until JS acknowledges them.
static NSArray<NSString *> *ReactNativeAppIntentsPendingURLsSnapshot(void)
{
  NSArray<NSString *> *urls =
    [ReactNativeAppIntentsUserDefaults() stringArrayForKey:ReactNativeAppIntentsPendingURLsDefaultsKey] ?: @[];
  NSMutableArray<NSString *> *normalized = [NSMutableArray arrayWithCapacity:urls.count];
  BOOL changed = NO;

  for (NSString *url in urls) {
    NSString *withId = ReactNativeAppIntentsEnsureInvocationID(url);
    changed = changed || ![withId isEqualToString:url];
    [normalized addObject:withId];
  }

  if (changed) {
    [ReactNativeAppIntentsUserDefaults() setObject:normalized forKey:ReactNativeAppIntentsPendingURLsDefaultsKey];
  }

  return normalized;
}

@implementation ReactNativeAppIntents

RCT_EXPORT_MODULE(ReactNativeAppIntents)

- (instancetype)init
{
  self = [super init];

  if (self) {
    ReactNativeAppIntentsCurrentModule = self;
  }

  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)dealloc
{
  if (ReactNativeAppIntentsCurrentModule == self) {
    ReactNativeAppIntentsCurrentModule = nil;
  }
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"appIntentUrl" ];
}

- (void)startObserving
{
  [self emitPendingIntentURLs];
}

RCT_REMAP_METHOD(
  donate,
  donate:(NSString *)intentId
  title:(NSString *)title
  url:(NSString *)url
  payload:(NSString *)payload
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *activityType = [NSString stringWithFormat:@"com.reactnativeappintents.intent.%@", intentId];
    NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:activityType];
    activity.title = title;
    activity.eligibleForSearch = YES;
    activity.userInfo = @{ @"payload": payload, @"url": url };
    activity.requiredUserInfoKeys = [NSSet setWithArray:@[ @"payload", @"url" ]];

    if (@available(iOS 12.0, *)) {
      activity.eligibleForPrediction = YES;
      activity.persistentIdentifier = url;
    }

    [activity becomeCurrent];
    resolve(nil);
  });
}

RCT_REMAP_METHOD(
  clearDonations,
  clearDonationsWithResolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  void (^deleteSavedUserActivities)(void) = ^{
    if (@available(iOS 12.0, *)) {
      [NSUserActivity deleteAllSavedUserActivitiesWithCompletionHandler:^{
        resolve(nil);
      }];
      return;
    }

    resolve(nil);
  };

  if (@available(iOS 10.0, *)) {
    [INInteraction deleteAllInteractionsWithCompletion:^(NSError *_Nullable error) {
      if (error != nil) {
        reject(@"clear_donations_failed", error.localizedDescription, error);
        return;
      }

      deleteSavedUserActivities();
    }];
    return;
  }

  deleteSavedUserActivities();
}

RCT_REMAP_METHOD(
  getInitialIntentURL,
  getInitialIntentURLWithResolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  resolve(ReactNativeAppIntentsPendingURLsSnapshot().firstObject);
}

RCT_REMAP_METHOD(
  getPendingIntentURLs,
  getPendingIntentURLsWithResolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  resolve(ReactNativeAppIntentsPendingURLsSnapshot());
}

RCT_REMAP_METHOD(
  acknowledgeIntent,
  acknowledgeIntent:(NSString *)invocationId
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  @synchronized([ReactNativeAppIntents class]) {
    NSMutableArray<NSString *> *urls = [ReactNativeAppIntentsPendingURLsSnapshot() mutableCopy];

    for (NSInteger index = (NSInteger)urls.count - 1; index >= 0; index--) {
      if ([ReactNativeAppIntentsInvocationID(urls[index]) isEqualToString:invocationId]) {
        [urls removeObjectAtIndex:index];
      }
    }

    [ReactNativeAppIntentsUserDefaults() setObject:urls forKey:ReactNativeAppIntentsPendingURLsDefaultsKey];
  }

  resolve(nil);
}

RCT_REMAP_METHOD(
  updateDynamicShortcuts,
  updateDynamicShortcuts:(NSArray<NSDictionary *> *)shortcuts
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableArray<UIApplicationShortcutItem *> *items = [NSMutableArray new];

    for (NSDictionary *shortcut in shortcuts) {
      NSString *shortcutId = shortcut[@"id"];
      NSString *title = shortcut[@"title"];
      NSString *subtitle = shortcut[@"subtitle"];
      NSString *url = shortcut[@"url"];
      NSDictionary *iconPayload =
        [shortcut[@"icon"] isKindOfClass:[NSDictionary class]] ? shortcut[@"icon"] : nil;
      NSString *systemImageName = iconPayload[@"systemName"];
      NSString *templateImageName = iconPayload[@"iosTemplateImageName"];
      NSDictionary *userInfo = url == nil ? @{} : @{ @"url": url };
      UIApplicationShortcutIcon *icon = nil;

      if (templateImageName != nil) {
        icon = [UIApplicationShortcutIcon iconWithTemplateImageName:templateImageName];
      } else if (systemImageName != nil) {
        if (@available(iOS 13.0, *)) {
          icon = [UIApplicationShortcutIcon iconWithSystemImageName:systemImageName];
        }
      }

      UIApplicationShortcutItem *item = [[UIApplicationShortcutItem alloc]
        initWithType:shortcutId
        localizedTitle:title
        localizedSubtitle:subtitle
        icon:icon
        userInfo:userInfo];
      [items addObject:item];
    }

    [UIApplication sharedApplication].shortcutItems = items;
    resolve(nil);
  });
}

+ (void)recordIncomingURLString:(NSString *)url
{
  if (url == nil) {
    return;
  }

  NSString *stored = ReactNativeAppIntentsEnsureInvocationID(url);

  @synchronized([ReactNativeAppIntents class]) {
    NSMutableArray<NSString *> *urls = [ReactNativeAppIntentsPendingURLsSnapshot() mutableCopy];
    [urls addObject:stored];

    if (urls.count > ReactNativeAppIntentsMaxPendingURLs) {
      [urls removeObjectsInRange:NSMakeRange(0, urls.count - ReactNativeAppIntentsMaxPendingURLs)];
    }

    [ReactNativeAppIntentsUserDefaults() setObject:urls forKey:ReactNativeAppIntentsPendingURLsDefaultsKey];
  }

  [ReactNativeAppIntentsCurrentModule sendEventWithName:@"appIntentUrl" body:@{ @"url": stored }];
}

- (void)emitPendingIntentURLs
{
  for (NSString *url in ReactNativeAppIntentsPendingURLsSnapshot()) {
    [self sendEventWithName:@"appIntentUrl" body:@{ @"url": url }];
  }
}

@end
