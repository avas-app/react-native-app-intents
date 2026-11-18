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

// One UserDefaults key per run (<prefix><invocationId>) so the Swift enqueue and this file never
// overwrite each other's writes. Everything that changes or lists runs holds one lock.
static NSString *const ReactNativeAppIntentsRunKeyPrefix = @"ReactNativeAppIntentsPendingURLs.";
static NSString *const ReactNativeAppIntentsEnqueuedNotification = @"ReactNativeAppIntentsDidEnqueue";

static NSObject *ReactNativeAppIntentsLock(void)
{
  static NSObject *lock;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ lock = [NSObject new]; });
  return lock;
}

static void ReactNativeAppIntentsStoreRun(NSUserDefaults *defaults, NSString *url, NSTimeInterval createdAt)
{
  NSString *invocationId = ReactNativeAppIntentsInvocationID(url);

  if (invocationId.length == 0) {
    return;
  }

  [defaults setObject:@{ @"url": url, @"createdAt": @(createdAt) }
               forKey:[ReactNativeAppIntentsRunKeyPrefix stringByAppendingString:invocationId]];
}

// Caller holds the lock. Moves the old single-array key into per-run keys, once.
static void ReactNativeAppIntentsMigrateLegacy(NSUserDefaults *defaults)
{
  NSArray<NSString *> *legacy = [defaults stringArrayForKey:ReactNativeAppIntentsPendingURLsDefaultsKey];

  if (legacy == nil) {
    return;
  }

  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  NSUInteger migrated = 0;

  // Old generated Swift appends without our lock, so re-read before removing and migrate what arrived meanwhile.
  for (int attempt = 0; attempt < 5; attempt++) {
    for (; migrated < legacy.count; migrated++) {
      ReactNativeAppIntentsStoreRun(
        defaults, ReactNativeAppIntentsEnsureInvocationID(legacy[migrated]), now - 1000.0 + migrated * 0.001);
    }

    NSArray<NSString *> *latest = [defaults stringArrayForKey:ReactNativeAppIntentsPendingURLsDefaultsKey];

    if (latest == nil || latest.count <= migrated) {
      break;
    }

    legacy = latest;
  }

  [defaults removeObjectForKey:ReactNativeAppIntentsPendingURLsDefaultsKey];
}

// Caller holds the lock. Oldest first, as {key, url}.
static NSArray<NSDictionary *> *ReactNativeAppIntentsListRuns(NSUserDefaults *defaults)
{
  NSMutableArray<NSDictionary *> *runs = [NSMutableArray new];

  for (NSString *key in [defaults dictionaryRepresentation]) {
    if (![key hasPrefix:ReactNativeAppIntentsRunKeyPrefix]) {
      continue;
    }

    id value = [defaults objectForKey:key];
    NSString *url = [value isKindOfClass:[NSDictionary class]] ? value[@"url"] : nil;

    if (![url isKindOfClass:[NSString class]]) {
      continue;
    }

    [runs addObject:@{ @"key": key, @"url": url, @"createdAt": value[@"createdAt"] ?: @0 }];
  }

  [runs sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    NSComparisonResult order = [left[@"createdAt"] compare:right[@"createdAt"]];
    return order != NSOrderedSame ? order : [left[@"key"] compare:right[@"key"]];
  }];

  return runs;
}

// Caller holds the lock.
static void ReactNativeAppIntentsTrim(NSUserDefaults *defaults)
{
  NSArray<NSDictionary *> *runs = ReactNativeAppIntentsListRuns(defaults);

  for (NSUInteger index = 0; index + ReactNativeAppIntentsMaxPendingURLs < runs.count; index++) {
    [defaults removeObjectForKey:runs[index][@"key"]];
  }
}

// Read-only: lists the newest runs, oldest first.
static NSArray<NSString *> *ReactNativeAppIntentsPendingURLsSnapshot(void)
{
  @synchronized(ReactNativeAppIntentsLock()) {
    NSUserDefaults *defaults = ReactNativeAppIntentsUserDefaults();
    ReactNativeAppIntentsMigrateLegacy(defaults);
    NSArray<NSDictionary *> *runs = ReactNativeAppIntentsListRuns(defaults);
    NSUInteger skip = runs.count > ReactNativeAppIntentsMaxPendingURLs
      ? runs.count - ReactNativeAppIntentsMaxPendingURLs
      : 0;
    NSMutableArray<NSString *> *urls = [NSMutableArray arrayWithCapacity:runs.count - skip];

    for (NSUInteger index = skip; index < runs.count; index++) {
      [urls addObject:runs[index][@"url"]];
    }

    return urls;
  }
}

@interface ReactNativeAppIntents ()
@property (nonatomic, assign) BOOL observing;
@property (nonatomic, strong) id enqueueObserver;
@end

@implementation ReactNativeAppIntents

RCT_EXPORT_MODULE(ReactNativeAppIntents)

@synthesize viewRegistry_DEPRECATED = _viewRegistry_DEPRECATED;

- (instancetype)init
{
  self = [super init];

  if (self) {
    ReactNativeAppIntentsCurrentModule = self;
    __weak ReactNativeAppIntents *weakSelf = self;
    // Swift posts this after writing a run, so a foreground run reaches JS without an AppState change.
    self.enqueueObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:ReactNativeAppIntentsEnqueuedNotification
      object:nil
      queue:nil
      usingBlock:^(NSNotification *_Nonnull note) {
        if (weakSelf.observing) {
          [weakSelf emitPendingIntentURLs];
        }
      }];
  }

  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)dealloc
{
  if (self.enqueueObserver != nil) {
    [[NSNotificationCenter defaultCenter] removeObserver:self.enqueueObserver];
  }

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
  self.observing = YES;
}

- (void)stopObserving
{
  self.observing = NO;
}

// SPIKE (throwaway): look up the UIView behind a React tag and set/read a harmless property.
RCT_REMAP_METHOD(
  spikeTagView,
  spikeTagView:(double)reactTag
  value:(NSString *)value
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    id registry = self.viewRegistry_DEPRECATED;
    UIView *view = [registry respondsToSelector:@selector(viewForReactTag:)]
      ? [registry performSelector:@selector(viewForReactTag:) withObject:@((NSInteger)reactTag)]
      : nil;
    if (view == nil) {
      resolve(@{ @"found": @NO });
      return;
    }
    if ([value isEqualToString:@"__CLEAR__"]) {
      view.accessibilityIdentifier = nil;
    } else if (value.length > 0) {
      view.accessibilityIdentifier = value;
    }
    resolve(@{
      @"found": @YES,
      @"class": NSStringFromClass([view class]),
      @"ptr": [NSString stringWithFormat:@"%p", view],
      @"accessibilityIdentifier": view.accessibilityIdentifier ?: [NSNull null],
      @"nativeID": [view respondsToSelector:@selector(nativeId)] ? ([view valueForKey:@"nativeId"] ?: [NSNull null]) : [NSNull null],
      @"hasAppEntityIdentifier": @([view respondsToSelector:NSSelectorFromString(@"setAppEntityIdentifier:")]),
      @"inWindow": @(view.window != nil),
    });
  });
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
  @synchronized(ReactNativeAppIntentsLock()) {
    NSUserDefaults *defaults = ReactNativeAppIntentsUserDefaults();
    ReactNativeAppIntentsMigrateLegacy(defaults);

    if (invocationId.length > 0) {
      [defaults removeObjectForKey:[ReactNativeAppIntentsRunKeyPrefix stringByAppendingString:invocationId]];
    }

    ReactNativeAppIntentsTrim(defaults);
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

  @synchronized(ReactNativeAppIntentsLock()) {
    NSUserDefaults *defaults = ReactNativeAppIntentsUserDefaults();
    ReactNativeAppIntentsMigrateLegacy(defaults);
    ReactNativeAppIntentsStoreRun(defaults, stored, [[NSDate date] timeIntervalSince1970]);
    ReactNativeAppIntentsTrim(defaults);
  }

  ReactNativeAppIntents *module = ReactNativeAppIntentsCurrentModule;

  if (module.observing) {
    [module sendEventWithName:@"appIntentUrl" body:@{ @"url": stored }];
  }
}

- (void)emitPendingIntentURLs
{
  for (NSString *url in ReactNativeAppIntentsPendingURLsSnapshot()) {
    [self sendEventWithName:@"appIntentUrl" body:@{ @"url": url }];
  }
}

@end
