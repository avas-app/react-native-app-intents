---
layout: default
title: "@avasapp/react-native-app-intents"
---

# react-native-app-intents

`@avasapp/react-native-app-intents` helps React Native apps define type-safe intents once, generate native
App Intents/App Shortcuts files, and route launched intents back into JavaScript.

## Install

```bash
npm install @avasapp/react-native-app-intents
```

For iOS bare React Native apps, install pods after adding the package:

```bash
npx pod-install
```

## Define intents

Create intent files anywhere matched by your config, for example `src/orders.intents.ts`:

```ts
import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";

export const Order = defineEntity({
  id: "Order",
  title: "Order",
  inventory: [{ id: 1, number: "1234", customer: "Taylor" }],
  schema: p.object({
    id: p.int(),
    number: p.string(),
    customer: p.string(),
  }),
  identifier: (order) => String(order.id),
  displayRepresentation: (order) => ({
    title: `Order #${order.number}`,
    subtitle: order.customer,
    image: { systemName: "bag" },
  }),
});

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  description: "Open a specific order.",
  phrases: ["Open order ${orderNumber} in ${.applicationName}"],
  params: {
    orderNumber: p.string({
      title: "Order number",
      default: "1234",
      requestValueDialog: "What's the order number?",
    }),
  },
  surfaces: {
    spotlight: true,
    appShortcut: {
      icon: {
        androidResourceName: "@mipmap/ic_launcher_round",
        systemName: "shippingbox",
      },
    },
  },
  android: {
    appAction: {
      capability: "actions.intent.GET_ORDER",
    },
  },
  ios: {
    appIntent: {},
  },
  behavior: { opensAppToForeground: true },
});

export const openSavedOrder = defineIntent({
  id: "openSavedOrder",
  title: "Open Saved Order",
  phrases: ["Open ${order} in ${.applicationName}"],
  params: {
    order: p.entity(Order, {
      androidBiiParam: "order",
      title: "Order",
      default: { id: 1, number: "1234", customer: "Taylor" },
    }),
  },
  surfaces: {
    spotlight: true,
    appShortcut: true,
  },
  android: {
    appAction: {
      capability: "actions.intent.GET_ORDER",
    },
  },
  ios: {
    appIntent: {},
  },
});
```

Generated app-intents URLs use the configured scheme with the reserved
`app-intents` host, for example `myapp://app-intents/openOrder?...`. If your
app also uses `myapp://` for normal deep links, keep routing those links by host
or path in React Native `Linking`; this library should only claim the
`app-intents` host.

## Configure codegen

Create `app-intents.config.ts` at your app root:

```ts
import { defineAppIntentsConfig } from "@avasapp/react-native-app-intents/codegen";

export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "myapp",
  ios: {
    output: "ios/MyApp/AppShortcuts.swift",
    appGroupIdentifier: "group.com.example.myapp",
    appShortcutsProviderName: "MyAppShortcuts",
    bundleIdentifier: "com.example.myapp",
    siriUsageDescription: "Used to let Siri run app actions.",
  },
  android: {
    manifest: "android/app/src/main/AndroidManifest.xml",
    shortcutsOutput: "android/app/src/main/res/xml/app_shortcuts.xml",
    packageName: "com.example.myapp",
  },
  localization: {
    defaultLocale: "en",
  },
  types: { output: "src/generated/app-intents.d.ts" },
});
```

The `localization` block is optional; see [Localization](#localization) for what it controls.

Run codegen:

```bash
npx app-intents generate
```

Use `--check` in CI to fail when generated files are stale:

```bash
npx app-intents generate --check
```

## Expo plugin

Use the package root as the Expo config plugin. The plugin auto-loads
`app-intents.config.ts` from your app root, so Expo prebuild and the CLI share
one source of truth:

```json
{
  "expo": {
    "plugins": ["@avasapp/react-native-app-intents"]
  }
}
```

If your config lives elsewhere, pass `configPath`:

```json
{
  "expo": {
    "plugins": [["@avasapp/react-native-app-intents", { "configPath": "./config/app-intents.ts" }]]
  }
}
```

Expo mode honors configured `ios.output`, `android.manifest`,
`android.shortcutsOutput`, and `android.shortcutsStringsOutput` paths relative to
the app root. An `ios.output` without an `ios/` prefix is written under the
generated iOS project folder.

## Expo custom shortcut icons

Use Expo's `expo-asset` config plugin when you want a custom **Android** shortcut
icon from an image file instead of a built-in launcher resource. The plugin links
the file into the native project during prebuild, and the file name becomes the
Android resource name.

```json
{
  "expo": {
    "plugins": [
      ["expo-asset", { "assets": ["./assets/shortcuts/open_order.png"] }],
      "@avasapp/react-native-app-intents"
    ]
  }
}
```

Then reference that asset from your intent definition or dynamic shortcut:

```ts
export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  phrases: ["Open order ${orderNumber} in ${.applicationName}"],
  params: {
    orderNumber: p.string({ default: "1234" }),
  },
  surfaces: {
    appShortcut: {
      icon: {
        androidResourceName: "@drawable/open_order",
        systemName: "shippingbox",
      },
    },
  },
});
```

```ts
await appIntents.updateDynamicShortcuts([
  {
    icon: {
      androidResourceName: "@drawable/open_order",
      iosTemplateImageName: "open_order",
      systemName: "shippingbox",
    },
    intent: openOrder,
    params: { orderNumber: "1234" },
    shortTitle: "Open order #1234",
  },
]);
```

Notes:

1. `expo-asset` uses the file name as the native resource name, so
   `assets/shortcuts/open_order.png` becomes `@drawable/open_order`.
2. Keep file names lowercase with underscores so they remain valid Android
   resource names.
3. Re-run `npx expo prebuild` after adding, removing, or renaming shortcut icon
   files.
4. On iOS dynamic shortcuts, use `iosTemplateImageName: "open_order"` (no file
   extension) to point at the bundled asset by name.
5. iOS template shortcut icons render as a single-color silhouette. Generated
   App Shortcuts still use `systemName`; Expo-bundled PNG assets are not used
   there.

## Expo setup

Add the package as an Expo config plugin:

```json
{
  "expo": {
    "plugins": [
      [
        "@avasapp/react-native-app-intents",
        {
          "intents": ["src/**/*.intents.ts"],
          "scheme": "myapp",
          "ios": {
            "appGroupIdentifier": "group.com.example.myapp",
            "siriUsageDescription": "Used to let Siri run app actions."
          }
        }
      ]
    ]
  }
}
```

Then run prebuild:

```bash
npx expo prebuild
```

The plugin currently:

- runs codegen with Expo-derived native paths
- patches `Info.plist` for the URL scheme and optional Siri/app-group settings
- patches entitlements when `ios.appGroupIdentifier` is configured
- patches the Android manifest so `MainActivity` can receive `scheme://app-intents`
  links without replacing existing app or Expo dev-client deep-link filters
- injects iOS home-screen quick-action forwarding into `AppDelegate.swift`
- adds the generated Swift source file to the Xcode project

## Bare React Native setup

Codegen handles the generated Swift and Android XML files, but bare iOS apps still need to forward
home-screen quick actions from `AppDelegate.swift`:

```swift
func application(
  _ application: UIApplication,
  didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
) -> Bool {
  // ... existing startup ...

  if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,
     handleShortcutItem(shortcutItem) {
    return false
  }

  return true
}

func application(
  _ application: UIApplication,
  performActionFor shortcutItem: UIApplicationShortcutItem,
  completionHandler: @escaping (Bool) -> Void
) {
  completionHandler(handleShortcutItem(shortcutItem))
}

private func handleShortcutItem(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
  guard let url = shortcutItem.userInfo?["url"] as? String else {
    return false
  }

  ReactNativeAppIntents.recordIncomingURLString(url)
  return true
}
```

Android app-intents links are routed through the generated manifest intent filter
for `scheme://app-intents`. Normal app deep links should keep flowing through
React Native `Linking`; if you manually call `ReactNativeAppIntentsModule.handleIntent`
from `MainActivity`, the native helper only queues URLs whose host is
`app-intents`. Keep calling `super.onNewIntent(intent)` and `setIntent(intent)`
so React Native can handle the rest of the app's links.

## Handle intents at runtime

```ts
import { createAppIntentsRuntime } from "@avasapp/react-native-app-intents";
import { openOrder, openSavedOrder } from "./orders.intents";

const appIntents = createAppIntentsRuntime({
  scheme: "myapp",
  intents: [openOrder, openSavedOrder] as const,
});

const initialIntent = await appIntents.getInitialIntent();

if (initialIntent?.id === "openOrder") {
  // Navigate from a cold launch.
}

const unsubscribe = appIntents.onIntent(openOrder, (params) => {
  // Navigate from a warm/background launch.
});
```

## Dynamic shortcuts

```ts
await appIntents.updateDynamicShortcuts([
  {
    icon: {
      androidResourceName: "@mipmap/ic_launcher_round",
      iosTemplateImageName: "burger",
      systemName: "shippingbox",
    },
    intent: openOrder,
    params: { orderNumber: "1234" },
    shortTitle: "Open order #1234",
    longTitle: "Taylor",
  },
]);
```

`surfaces.appShortcut` can be either `true` or an object with an iOS SF Symbol
(`systemName`) and/or an Android shortcut resource reference (`androidResourceName`).
For dynamic shortcuts, `icon` can additionally include `iosTemplateImageName`.

## Donations

```ts
await appIntents.donate(openOrder, { orderNumber: "1234" });
await appIntents.clearDonations();
```

On iOS this creates an `NSUserActivity` eligible for system predictions and clears donated
interactions/user activities. On Android this publishes a removable long-lived shortcut donation and
clears the shortcut donations created by `donate`.

## Localization

Every user-facing field accepts either a plain string or a locale map. Codegen resolves the default
locale into the generated native files and emits the other locales as platform string tables.

```ts
export const openOrder = defineIntent({
  id: "openOrder",
  title: { en: "Open Order", fr: "Ouvrir la commande" },
  description: { en: "Open a specific order.", fr: "Ouvrir une commande." },
  phrases: {
    en: ["Open order ${orderNumber} in ${.applicationName}"],
    fr: ["Ouvrir la commande ${orderNumber} dans ${.applicationName}"],
  },
  params: {
    orderNumber: p.string({
      title: { en: "Order number", fr: "Numéro de commande" },
      requestValueDialog: { en: "Which order?", fr: "Quelle commande ?" },
    }),
  },
  surfaces: { appShortcut: true },
});
```

Locale maps are accepted on intent `title` and `description`, parameter `title`, `prompt`, and
`requestValueDialog`, entity `title`, `ios.appIntent.response.dialog`, and `phrases`.

Configure the authoring locale in your config. Everything else is inferred from the definitions:

```ts
export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "myapp",
  localization: {
    // Locale the definitions are written in. Defaults to "en".
    defaultLocale: "en",
    // Where .lproj tables are written. Defaults to the directory holding ios.output.
    iosResourcesDirectory: "ios/MyApp/Resources",
  },
  // ...
});
```

### What gets generated

A project that only uses its default locale generates exactly what it did before — plain string
literals in Swift, one `values/` strings file on Android, and no extra files. As soon as a second
locale appears anywhere, codegen additionally writes:

| File                                     | Contents                                             |
| ---------------------------------------- | ---------------------------------------------------- |
| `<locale>.lproj/AppIntents.strings`      | Intent titles, descriptions, dialogs, parameter text |
| `<locale>.lproj/AppShortcuts.strings`    | App Shortcut invocation phrases                      |
| `res/values-<qualifier>/..._strings.xml` | Android shortcut short and long labels               |

Generated Swift switches to keyed `LocalizedStringResource` lookups against the `AppIntents` table,
keeping the default-locale text inline as the fallback, so the generated source still behaves
correctly even before the tables are bundled.

Android qualifiers follow the platform's own rules: `fr` becomes `values-fr`, `pt-BR` becomes
`values-pt-rBR`, and anything with a script subtag uses the BCP 47 form such as `values-b+zh+Hans`.

### Wiring the iOS tables up

Codegen writes the `.lproj` directories but cannot edit your Xcode target. After the first localized
generate you need to:

1. Add the generated `.lproj` directories to the app target's **Copy Bundle Resources** build phase.
2. List the locales under `CFBundleLocalizations` in `Info.plist`.

Codegen prints both reminders as diagnostics whenever translations are emitted.

### Rules worth knowing

- **Translated phrases must include `${.applicationName}` themselves.** The default locale gets the
  app name appended with an English connector when it is missing; there is no language-agnostic
  equivalent, so codegen rejects a translation that leaves the token out rather than silently
  producing `Ouvrir la commande in MyApp`.
- **Phrase lists are matched by position**, so every locale must declare the same number of phrases.
- **`displayRepresentation` is not localized.** It returns plain strings computed from your data, so
  entity labels in shortcut inventories use whatever that function returns. Localize inside the
  function if you need it.
- A locale that omits a field falls back to the default locale, so partial translations are fine.

### Runtime locale

Donations and dynamic shortcuts create user-facing labels at runtime, so the runtime resolves locale
maps against the device locale, falling back to the default locale:

```ts
const appIntents = createAppIntentsRuntime({
  scheme: "myapp",
  intents: [openOrder] as const,
  // Optional. Defaults to the device locale reported by Intl.
  locale: userSelectedLanguage,
  defaultLocale: "en",
});

await appIntents.updateDynamicShortcuts([
  {
    intent: openOrder,
    params: { orderNumber: "1234" },
    shortTitle: { en: "Open order #1234", fr: "Ouvrir la commande n° 1234" },
  },
]);
```

Pass `locale` explicitly when the app has its own language picker that can differ from the system
language.

## Auth-gated apps

For auth-gated or feature-flagged flows, treat donations and dynamic shortcuts as
derived session state. Donate when the user completes a real action, and clear
everything on logout or when the feature is disabled:

```ts
import { useEffect } from "react";

import { createAppIntentsRuntime } from "@avasapp/react-native-app-intents";
import { openOrder } from "./orders.intents";

const appIntents = createAppIntentsRuntime({
  scheme: "myapp",
  intents: [openOrder] as const,
});

async function handleOpenedOrder(orderNumber: string) {
  // Only donate actions the user actually performed.
  await appIntents.donate(openOrder, { orderNumber });
}

useEffect(() => {
  if (!session || !flags.orderShortcuts) {
    void appIntents.clearDonations();
    void appIntents.updateDynamicShortcuts([]);
    return;
  }

  void appIntents.updateDynamicShortcuts([
    {
      intent: openOrder,
      params: { orderNumber: session.lastViewedOrderNumber },
      shortTitle: "Open last order",
      longTitle: `Open order ${session.lastViewedOrderNumber}`,
    },
  ]);
}, [session, flags.orderShortcuts]);

async function logout() {
  await auth.signOut();
  await appIntents.clearDonations();
  await appIntents.updateDynamicShortcuts([]);
}
```

This keeps Siri/App Shortcuts suggestions aligned with the current account state
instead of exposing stale shortcuts after logout.

## Recipes

### Voice-first actions and dialogs

An intent can either bring the app forward to do the work, or stay in the background and answer with
a spoken dialog. The two modes behave very differently, and the choice is `behavior.opensAppToForeground`.

**Foreground** is what you want whenever JavaScript has to react to the request:

```ts
export const startWorkout = defineIntent({
  id: "startWorkout",
  title: "Start Workout",
  phrases: ["Start a workout in ${.applicationName}"],
  params: {
    activity: p.string({ optional: true, title: "Activity" }),
  },
  surfaces: { appShortcut: true },
  behavior: { opensAppToForeground: true },
  ios: { appIntent: {} },
});
```

Siri opens the app, the runtime receives the event, and your handler runs immediately.

**Background with a dialog** is for acknowledgements that do not need the UI:

```ts
export const logWater = defineIntent({
  id: "logWater",
  title: "Log Water",
  phrases: ["Log a glass of water in ${.applicationName}"],
  params: {},
  ios: {
    appIntent: { response: { dialog: "Logged a glass of water." } },
  },
});
```

Be aware of what this actually does: the generated App Intent speaks the dialog and queues the
request, but it does **not** start your JavaScript. The event is delivered the next time the app
runs, through `getInitialIntent()` or your `onIntent` handlers. Use this for actions you can replay
later, and reach for `opensAppToForeground: true` when the work has to happen now. A static dialog
cannot be combined with `opensAppToForeground`; codegen rejects that combination.

Once a user performs the action in-app, donate it so the system learns to suggest it:

```ts
await appIntents.donate(logWater, {});
```

### Deep-link routing

Intents arrive as URLs on the reserved `app-intents` host, which lets them share a scheme with your
ordinary deep links. The runtime only consumes `myapp://app-intents/...`; everything else flows on to
React Native `Linking` untouched.

```ts
import { createAppIntentsRuntime } from "@avasapp/react-native-app-intents";
import { openOrder, startWorkout } from "./intents";

const appIntents = createAppIntentsRuntime({
  scheme: "myapp",
  intents: [openOrder, startWorkout] as const,
});

export function useAppIntentRouting(navigation: NavigationProp) {
  useEffect(() => {
    // Cold launch: the intent that started the app, if any.
    void appIntents.getInitialIntent().then((event) => {
      if (event) {
        route(navigation, event);
      }
    });

    // Warm launches and foreground delivery.
    return appIntents.onAnyIntent((event) => {
      route(navigation, event);
    });
  }, [navigation]);
}

function route(navigation: NavigationProp, event: GeneratedAppIntentEvent) {
  switch (event.id) {
    case "openOrder":
      // event.params is narrowed to { orderNumber: string }.
      navigation.navigate("Order", { id: event.params.orderNumber });
      return;
    case "startWorkout":
      navigation.navigate("Workout", { activity: event.params.activity });
      return;
  }
}
```

`onAnyIntent` gives you a discriminated union, so switching on `event.id` narrows `event.params` to
that intent's parameter type. `GeneratedAppIntentEvent` comes from the generated `.d.ts` when
`types.output` is configured.

Two things to keep in mind:

- Register handlers early. Events that arrive before any handler exists are buffered and flushed
  once one is added, so a late `onIntent` still receives them, but the buffer is per runtime
  instance — create the runtime once at module scope rather than inside a component.
- Call `appIntents.buildUrl(intent, params)` when you need the URL yourself, for example to test a
  flow with `xcrun simctl openurl` or `adb shell am start`.

### Entity disambiguation

When a parameter refers to one of a known set of records, model it as an entity instead of a string.
Siri can then present a picker rather than asking the user to spell a value out, and Android gets a
capability inventory it can match against.

```ts
import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";

const Order = defineEntity({
  id: "Order",
  title: "Order",
  inventory: [
    { id: 1, number: "1234", customer: "Taylor" },
    { id: 2, number: "5678", customer: "Sam" },
  ],
  schema: p.object({
    id: p.int(),
    number: p.string(),
    customer: p.string(),
  }),
  identifier: (order) => String(order.id),
  displayRepresentation: (order) => ({
    title: `Order #${order.number}`,
    subtitle: order.customer,
    image: { systemName: "bag" },
  }),
});

export const openSavedOrder = defineIntent({
  id: "openSavedOrder",
  title: "Open Saved Order",
  phrases: ["Open ${order} in ${.applicationName}"],
  params: {
    order: p.entity(Order, {
      androidBiiParam: "order",
      title: "Order",
      requestValueDialog: "Which order?",
      default: { id: 1, number: "1234", customer: "Taylor" },
    }),
  },
  surfaces: { appShortcut: true },
  android: { appAction: { capability: "actions.intent.GET_ORDER" } },
});
```

What this generates:

- **iOS** — an `AppEntity` plus an `EntityQuery` backed by the static inventory, supporting lookup by
  identifier, suggested entities, and string search. Saying "Open order" without naming one makes
  Siri offer the inventory as choices, using `displayRepresentation` for each row.
- **Android** — one static shortcut per inventory item, each with a `capability-binding` so the
  capability can resolve a spoken value to a specific record.

Entity placeholders are the one kind that survives into the generated phrase. A `${order}` token
stays in the Swift phrase as an interpolated parameter, whereas a scalar placeholder like
`${orderNumber}` is dropped from the phrase text.

Constraints to design around:

- Inventory is **static**, resolved at build time from the `inventory` array. The `query` callback on
  `defineEntity` is not currently used by codegen or the runtime, so live catalogs are not yet
  supported. Model dynamic data with `updateDynamicShortcuts` and
  `android.appAction.inventory.strategy: "dynamic"` instead.
- An intent that opts into `android.appAction` supports at most one entity parameter, and every
  parameter must declare `androidBiiParam`.
- Entity-backed App Shortcuts require a non-empty inventory; codegen fails otherwise.

## Android App Actions contract

- Use `android.appAction` to opt an intent into Android App Actions.
- Android App Actions are the primary Android target; Google Assistant voice support is best-effort.
- `surfaces.assistant` and top-level `androidBii` are legacy shims and should be avoided in new intent definitions.

## Android App Actions support matrix

| Scenario                                                    | Status                | Coverage                                        |
| ----------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| `actions.intent.GET_ORDER` scalar slot binding              | Supported             | Core validation, codegen snapshot, runtime test |
| `actions.intent.GET_ORDER` entity-backed shortcut inventory | Supported             | Core validation, codegen snapshot, example app  |
| Capability-bound Android donations and dynamic shortcuts    | Supported             | Runtime test, Android native module wiring      |
| Legacy `surfaces.assistant` / top-level `androidBii` usage  | Compatibility only    | Core validation                                 |
| Google Assistant voice triggering                           | Best effort           | Manual verification only                        |
| Verified App Links / Play Console review steps              | Manual setup required | Codegen diagnostics                             |

For an opt-in `adb` smoke test against the bare Android example app, run:

```bash
RN_APP_INTENTS_ANDROID_E2E=1 bun test packages/react-native/test/android-app-actions.e2e.test.ts
```

## iOS Siri / App Intents contract

- Use `ios.appIntent` to opt an intent into native Siri/App Intents generation.
- `surfaces.siri` no longer enables App Intents by itself; keep using `surfaces.appShortcut` and `surfaces.spotlight` for those separate surfaces.
- Static `ios.appIntent.response.dialog` is supported only for background intents; it cannot be combined with `behavior.opensAppToForeground`.
- `object` params are flattened into Swift leaf parameters for App Intents, but phrases cannot interpolate the object parameter itself.

## iOS Siri / App Intents support matrix

| Scenario                                                 | Status            | Coverage                                     |
| -------------------------------------------------------- | ----------------- | -------------------------------------------- |
| `ios.appIntent` foreground URL handoff                   | Supported         | Codegen snapshot, runtime tests, example app |
| Static `ios.appIntent.response.dialog`                   | Supported         | Core validation, Swift typecheck, snapshot   |
| Nested `object` params in generated App Intents          | Supported         | Core validation, Swift typecheck, snapshot   |
| `surfaces.siri` without `ios.appIntent`                  | Unsupported       | Core validation                              |
| Object-param placeholders inside `phrases`               | Unsupported       | Core validation                              |
| Custom bundled image assets in generated App Shortcuts   | Unsupported       | Documentation only                           |
| Dynamic Siri dialog sourced from JS/native perform logic | Not yet supported | Explicit non-goal for current slice          |

## Current features

- Single scoped npm package containing the runtime, authoring API, codegen, CLI, and Expo plugin.
- Type-safe authoring with `defineIntent`, `defineEntity`, and `p.*` parameter builders.
- First-class `android.appAction` authoring plus Android shortcuts XML, strings XML, and manifest patching.
- First-class `ios.appIntent` authoring plus Swift App Intents/App Shortcuts generation.
- Nested object-parameter support in generated iOS App Intents, including generated parameter summaries.
- Static iOS App Intent dialog responses via `ios.appIntent.response.dialog`.
- Generated TypeScript event types.
- Multi-locale titles, descriptions, dialogs, and phrases, emitted as Apple `.strings` tables and
  Android `values-*/strings.xml` resources.
- Codegen diagnostics that point at the file and line of the failing declaration.
- Initial intent and warm intent event handling in JavaScript.
- Dynamic home-screen shortcuts on iOS and Android.
- Intent donation and donation-clearing helpers.
- Expo prebuild plugin with iOS/native manifest automation and bare React Native native modules.

## Planned features

- Expanded Android App Actions coverage.
- Dynamic Siri/App Intent dialog flows beyond the current static-response slice.
- Richer shortcut icons and metadata.
- More setup automation for bare apps.
- Navigation integration examples.
- Expanded example apps and end-to-end templates.

## Publishing these docs with GitHub Pages

This repository includes a GitHub Actions workflow that builds this `docs/` directory with GitHub
Pages. In the GitHub repository settings, set **Pages -> Build and deployment -> Source** to
**GitHub Actions**. Push to `main`, then open:

```text
https://avas-app.github.io/react-native-app-intents/
```
