#import "ReactNativeAppIntents.h"

#import <Intents/Intents.h>
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

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

static NSString *const ReactNativeAppIntentsCatalogKeyPrefix = @"ReactNativeAppIntentsEntityCatalog.";
static NSString *const ReactNativeAppIntentsSyncedCatalogKeyPrefix = @"ReactNativeAppIntentsEntityCatalogSynced.";

// Generated code defines the bridge class; a missing class means codegen was not rerun.
static Class ReactNativeAppIntentsBridgeClass(void)
{
  return NSClassFromString(@"ReactNativeAppIntentsGeneratedBridge");
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
    Class bridge = ReactNativeAppIntentsBridgeClass();
    SEL startSelector = NSSelectorFromString(@"start");

    if (bridge != nil && [bridge respondsToSelector:startSelector]) {
      ((void (*)(id, SEL))objc_msgSend)(bridge, startSelector);
    }

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

RCT_REMAP_METHOD(
  setEntityCatalog,
  setEntityCatalog:(NSString *)entityId
  json:(NSString *)json
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  if (entityId.length == 0 || json == nil) {
    reject(@"invalid_catalog", @"entityId and json are required", nil);
    return;
  }

  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = data != nil ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;

  if (![parsed isKindOfClass:[NSArray class]]) {
    reject(@"invalid_catalog", @"The catalog must be a JSON array", nil);
    return;
  }

  @synchronized(ReactNativeAppIntentsLock()) {
    [ReactNativeAppIntentsUserDefaults()
      setObject:json
         forKey:[ReactNativeAppIntentsCatalogKeyPrefix stringByAppendingString:entityId]];
  }

  NSString *syncedKey = [ReactNativeAppIntentsSyncedCatalogKeyPrefix stringByAppendingString:entityId];
  void (^markSynced)(void) = ^{
    @synchronized(ReactNativeAppIntentsLock()) {
      [ReactNativeAppIntentsUserDefaults() setObject:json forKey:syncedKey];
    }
  };

  Class bridge = ReactNativeAppIntentsBridgeClass();
  SEL selector = NSSelectorFromString(@"catalogDidChange:completion:");

  if (bridge == nil || ![bridge respondsToSelector:selector]) {
    markSynced();
    resolve(nil);
    return;
  }

  void (^completion)(NSError *) = ^(NSError *_Nullable error) {
    if (error != nil) {
      reject(@"catalog_update_failed", error.localizedDescription, error);
      return;
    }

    markSynced();
    resolve(nil);
  };

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    ((void (*)(id, SEL, NSString *, void (^)(NSError *)))objc_msgSend)(bridge, selector, entityId, completion);
  });
}

RCT_REMAP_METHOD(
  getEntityCatalog,
  getEntityCatalog:(NSString *)entityId
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  NSString *json = nil;

  @synchronized(ReactNativeAppIntentsLock()) {
    id value = [ReactNativeAppIntentsUserDefaults()
      objectForKey:[ReactNativeAppIntentsCatalogKeyPrefix stringByAppendingString:entityId ?: @""]];
    json = [value isKindOfClass:[NSString class]] ? value : nil;
  }

  resolve(json);
}

RCT_REMAP_METHOD(
  getSyncedEntityCatalog,
  getSyncedEntityCatalog:(NSString *)entityId
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  NSString *json = nil;

  @synchronized(ReactNativeAppIntentsLock()) {
    id value = [ReactNativeAppIntentsUserDefaults()
      objectForKey:[ReactNativeAppIntentsSyncedCatalogKeyPrefix stringByAppendingString:entityId ?: @""]];
    json = [value isKindOfClass:[NSString class]] ? value : nil;
  }

  resolve(json);
}

RCT_REMAP_METHOD(
  reindexEntities,
  reindexEntities:(NSString *)entityId
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  Class bridge = ReactNativeAppIntentsBridgeClass();
  SEL selector = NSSelectorFromString(@"reindex:completion:");

  if (bridge == nil || ![bridge respondsToSelector:selector]) {
    resolve(nil);
    return;
  }

  void (^completion)(NSError *) = ^(NSError *_Nullable error) {
    if (error != nil) {
      reject(@"reindex_failed", error.localizedDescription, error);
      return;
    }

    resolve(nil);
  };

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    ((void (*)(id, SEL, NSString *, void (^)(NSError *)))objc_msgSend)(bridge, selector, entityId, completion);
  });
}

RCT_REMAP_METHOD(
  setOnscreenEntity,
  setOnscreenEntity:(NSString *)token
  entityId:(NSString *)entityId
  id:(NSString *)itemId
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  Class bridge = ReactNativeAppIntentsBridgeClass();
  SEL selector = NSSelectorFromString(@"setOnscreenEntity:entityId:id:");

  if (bridge == nil || ![bridge respondsToSelector:selector]) {
    resolve(nil);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    ((void (*)(id, SEL, NSString *, NSString *, NSString *))objc_msgSend)(bridge, selector, token, entityId, itemId);
    resolve(nil);
  });
}

static const void *ReactNativeAppIntentsTagValueKey = &ReactNativeAppIntentsTagValueKey;
static NSMapTable<NSNumber *, UIView *> *ReactNativeAppIntentsTaggedViews;
static NSMutableDictionary<NSNumber *, NSString *> *ReactNativeAppIntentsTaggedValues;

- (UIView *)viewForReactTag:(NSNumber *)reactTag
{
  id registry = self.viewRegistry_DEPRECATED;
  SEL selector = NSSelectorFromString(@"viewForReactTag:");

  if ([registry respondsToSelector:selector]) {
    return ((UIView * (*)(id, SEL, NSNumber *)) objc_msgSend)(registry, selector, reactTag);
  }

  // Old architecture: the bridge's UIManager owns the registry.
  SEL uiManagerSelector = NSSelectorFromString(@"uiManager");
  id uiManager = [self.bridge respondsToSelector:uiManagerSelector]
    ? ((id (*)(id, SEL))objc_msgSend)(self.bridge, uiManagerSelector)
    : nil;

  return [uiManager respondsToSelector:selector]
    ? ((UIView * (*)(id, SEL, NSNumber *))objc_msgSend)(uiManager, selector, reactTag)
    : nil;
}

RCT_REMAP_METHOD(
  setEntityTag,
  setEntityTag:(nonnull NSNumber *)reactTag
  entityId:(NSString *)entityId
  id:(NSString *)itemId
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)
{
  Class bridge = ReactNativeAppIntentsBridgeClass();
  SEL selector = NSSelectorFromString(@"setEntityIdentifierOn:entityId:id:");

  if (bridge == nil || ![bridge respondsToSelector:selector]) {
    resolve(nil);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    if (ReactNativeAppIntentsTaggedViews == nil) {
      ReactNativeAppIntentsTaggedViews = [NSMapTable strongToWeakObjectsMapTable];
      ReactNativeAppIntentsTaggedValues = [NSMutableDictionary new];
    }

    BOOL clear = entityId == nil || itemId == nil;
    UIView *view = [self viewForReactTag:reactTag];
    UIView *known = [ReactNativeAppIntentsTaggedViews objectForKey:reactTag];

    if (clear) {
      // Unmount: the registry may already have dropped the view, so fall back to the one we tagged.
      view = view ?: known;
      NSString *ours = ReactNativeAppIntentsTaggedValues[reactTag];
      NSString *current = view ? objc_getAssociatedObject(view, ReactNativeAppIntentsTagValueKey) : nil;

      // A recycled view may already carry another row's tag; leave it alone.
      if (view != nil && ours != nil && [ours isEqualToString:current]) {
        objc_setAssociatedObject(view, ReactNativeAppIntentsTagValueKey, nil, OBJC_ASSOCIATION_COPY_NONATOMIC);
        ((void (*)(id, SEL, UIView *, NSString *, NSString *))objc_msgSend)(bridge, selector, view, nil, nil);
      }

      [ReactNativeAppIntentsTaggedViews removeObjectForKey:reactTag];
      [ReactNativeAppIntentsTaggedValues removeObjectForKey:reactTag];
      resolve(nil);
      return;
    }

    // The value is unique per tag, so a recycled view carrying another tag's value is not ours.
    NSString *value = [NSString stringWithFormat:@"%@|%@|%@", reactTag, entityId, itemId];

    ReactNativeAppIntentsTaggedValues[reactTag] = value;
    [self applyEntityTag:reactTag value:value entityId:entityId itemId:itemId bridge:bridge selector:selector attemptsLeft:20];
    resolve(nil);
  });
}

// The effect runs before Fabric has mounted the native view, so retry until it exists or the tag is cleared.
- (void)applyEntityTag:(NSNumber *)reactTag
                 value:(NSString *)value
              entityId:(NSString *)entityId
                itemId:(NSString *)itemId
                bridge:(Class)bridge
              selector:(SEL)selector
          attemptsLeft:(NSInteger)attemptsLeft
{
  if (![ReactNativeAppIntentsTaggedValues[reactTag] isEqualToString:value]) {
    return;
  }

  UIView *view = [self viewForReactTag:reactTag];

  if (view == nil) {
    if (attemptsLeft > 0) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
        [self applyEntityTag:reactTag value:value entityId:entityId itemId:itemId bridge:bridge selector:selector attemptsLeft:attemptsLeft - 1];
      });
    }
    return;
  }

  objc_setAssociatedObject(view, ReactNativeAppIntentsTagValueKey, value, OBJC_ASSOCIATION_COPY_NONATOMIC);
  [ReactNativeAppIntentsTaggedViews setObject:view forKey:reactTag];
  ((void (*)(id, SEL, UIView *, NSString *, NSString *))objc_msgSend)(bridge, selector, view, entityId, itemId);
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
