# @avasapp/react-native-app-intents

This package includes the React Native runtime, authoring API, codegen, CLI, native modules, and Expo config plugin for App Intents.

## Install

```bash
npm install @avasapp/react-native-app-intents
```

For bare iOS apps, install pods after adding the package:

```bash
npx pod-install
```

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
  types: { output: "src/generated/app-intents.d.ts" },
});
```

Run codegen:

```bash
npx app-intents generate
```

Use `--check` in CI:

```bash
npx app-intents generate --check
```

## Expo plugin

Use the package root as the Expo config plugin:

```json
{
  "expo": {
    "plugins": ["@avasapp/react-native-app-intents"]
  }
}
```

The plugin auto-loads `app-intents.config.ts`. To use another path:

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

## Runtime

```ts
import { createAppIntentsRuntime } from "@avasapp/react-native-app-intents";
import { openOrder } from "./orders.intents";

const appIntents = createAppIntentsRuntime({
  scheme: "myapp",
  intents: [openOrder] as const,
});

appIntents.onIntent(openOrder, (params) => {
  // Navigate to the requested order.
});
```

## Auth-gated apps

For auth-gated or feature-flagged flows, donate when the user completes a real
action, and clear donations plus dynamic shortcuts on logout or when the
feature is disabled:

```ts
import { useEffect } from "react";

async function handleOpenedOrder(orderNumber: string) {
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
      icon: {
        androidResourceName: "@mipmap/ic_launcher_round",
        iosTemplateImageName: "burger",
        systemName: "shippingbox",
      },
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

`surfaces.appShortcut` still accepts `true`, but you can also pass an object to set
an iOS SF Symbol (`systemName`) and/or an Android shortcut resource reference
(`androidResourceName`, such as `@mipmap/ic_launcher_round`). For dynamic
shortcuts, `icon` can additionally include `iosTemplateImageName`.

## Runtime entity catalogs

An entity with `catalog: "runtime"` takes its values from JavaScript at run time
instead of the values baked in at codegen.

```ts
export const order = defineEntity({
  id: "order",
  title: "Order",
  catalog: "runtime",
  schema: p.object({ orderNumber: p.string() }),
  identifier: (order) => order.orderNumber,
  displayRepresentation: (order) => ({ title: `Order ${order.orderNumber}` }),
});

await appIntents.setEntities(order, [
  {
    id: "4521",
    title: "Order 4521",
    subtitle: "Arrives Tue",
    synonyms: ["last order"],
    value: { orderNumber: "4521" },
  },
]);

const orders = await appIntents.getEntities(order);
```

`setEntities` checks that every entry has a non-empty `id` and `title` and a unique
`id`; a bad entry rejects and leaves the stored catalog unchanged. Publishing a
catalog equal to the current one is a no-op, so calling `setEntities` on every
launch is safe. Static `inventory` seeds Siri and Shortcuts, but a Spotlight entity
is not indexed until the first `setEntities` or `reindexEntities`.
The catalog is stored natively on the device (`UserDefaults` on iOS, shared
preferences on Android), so keep it to the rows Siri and agents need. Clear it
on logout with `setEntities(order, [])`.

## Spotlight

Index an entity in Spotlight (iOS 18+) so it appears in search and Apple
Intelligence. Tapping a result runs its open intent.

```ts
export const order = defineEntity({
  id: "order",
  title: "Order",
  catalog: "runtime",
  schema: p.object({ orderNumber: p.string() }),
  identifier: (order) => order.orderNumber,
  displayRepresentation: (order) => ({ title: `Order ${order.orderNumber}` }),
  spotlight: { openIntent: "openOrder" },
});
```

`spotlight.openIntent` is the id of an intent that takes exactly one required
parameter of this entity. Spotlight requires `catalog: "runtime"`. An entry with
`hideInSpotlight: true` stays resolvable but is not indexed. Indexing follows the
published catalog: added and changed entries are indexed, removed entries are
deleted. `reindexEntities(entity)` forces a full rebuild of the index for one entity,
or for every spotlight entity when called with no argument, for example after a
failed sync. A system-evicted index is rebuilt automatically.

## Onscreen entity

Tell Siri and Apple Intelligence which entity the screen is showing (iOS 18.2+),
so requests like "send this" or "summarize this" resolve.

```ts
useOnscreenEntity(order, selectedOrder?.id);
```

Pass the entity and the id on screen; pass `null` or `undefined` to clear it.

### Tag a view

Tag a single view, such as a list row, with the entity it shows (iOS 18.4+).

```tsx
const ref = useRef<View>(null);
useAppEntityTag(ref, order, row.id);

<View ref={ref} collapsable={false}>
  …
</View>;
```

The view needs `collapsable={false}` so it exists as a native view. The tag is cleared on unmount or when the id changes. It does nothing on Android and older iOS.

`reindexEntities`, `useOnscreenEntity`, `useAppEntityTag` and Spotlight are
iOS-only. On Android they resolve and do nothing. `setEntities` and `getEntities`
work on both platforms.

## Android AppFunctions

Android AppFunctions (Android 16+) let Gemini and other on-device agents call an intent directly. It is opt-in at two levels: `android.appFunctions` in the codegen config turns generation on for the project, and `android.appFunction` on an intent exposes that intent. Turning on the project setting on its own exposes nothing.

AppFunctions need React Native 0.88+ (AGP 9.1+), `compileSdk 37` and KSP. Add the KSP plugin to `android/build.gradle`:

```gradle
buildscript {
  dependencies {
    classpath("com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin:2.2.0-2.0.2")
  }
}
```

Apply it and add the dependencies in `android/app/build.gradle`, then set the SDK in `android/gradle.properties`:

```gradle
apply plugin: "com.google.devtools.ksp"

dependencies {
  implementation("androidx.appfunctions:appfunctions:1.0.0")
  ksp("androidx.appfunctions:appfunctions-compiler:1.0.0")
}
```

```properties
android.compileSdkVersion=37
```

The KSP plugin version follows the app's Kotlin version; `2.2.0-2.0.2` matches Kotlin 2.2.0 on React Native 0.88. The Expo plugin adds the plugin, both dependencies and `compileSdk 37` during prebuild when `android.appFunctions` is set, so none of these lines are needed there.

Enable it in the config:

```ts
export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "myapp",
  android: {
    manifest: "android/app/src/main/AndroidManifest.xml",
    shortcutsOutput: "android/app/src/main/res/xml/app_shortcuts.xml",
    packageName: "com.example.myapp",
    appFunctions: {
      output: "android/app/src/main/java/com/example/myapp/appfunctions/AppFunctions.kt",
      appMetadata: { instructions: "Order tracking for the shop." },
    },
  },
});
```

Then opt an intent in, and optionally an entity query:

```ts
export const order = defineEntity({
  id: "order",
  title: "Order",
  catalog: "runtime",
  schema: p.object({ orderNumber: p.string() }),
  identifier: (order) => order.orderNumber,
  displayRepresentation: (order) => ({ title: `Order ${order.orderNumber}` }),
  android: { appFunctionQuery: true },
});

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  description: "Open a saved order.",
  params: {
    order: p.entity(order, { title: "Order", prompt: "Which order?" }),
    note: p.string({ optional: true, title: "Note", prompt: "Add a note." }),
  },
  android: { appFunction: true },
  behavior: { opensAppToForeground: true },
});
```

`android.appFunctionQuery` generates a `find<Entity>s(query: String?)` function so the agent can resolve an entity before calling the intent.

Parameters map to Kotlin types:

| Definition          | AppFunction type                           |
| ------------------- | ------------------------------------------ |
| `p.string()`        | `String`                                   |
| `p.int()`           | `Int`                                      |
| `p.number()`        | `Double`                                   |
| `p.bool()`          | `Boolean`                                  |
| `p.date()`          | `String` (ISO-8601)                        |
| `p.object({ ... })` | generated `@AppFunctionSerializable` class |
| `p.entity(Order)`   | generated `OrderEntity` class              |

Optional parameters are nullable. A `default` is applied in the function body, because agents send null or a zero value for omitted parameters, so Kotlin parameter defaults do not apply. The function KDoc is built from `title`, `description` and each parameter's `title`/`prompt`, which the agent reads; only the base locale is emitted.

Calls arrive in `onIntent` like any other intent, with the same payload and invocation id. The function returns `status: "delivered"` and the invocation id as soon as the call is queued, and does not wait for JS. If the intent has `behavior.opensAppToForeground`, the app is opened as a best effort: Android 16 blocks background activity launches, so a blocked call stays queued until the app is opened.

`setEntities` also works on Android now, storing the catalog on the device. The generated `find<Entity>s` functions read that catalog and use the codegen `inventory` when nothing is stored.

Set `android.appFunction: { enabledByDefault: false }` to gate a function, then enable or disable it at runtime:

```ts
await appIntents.setAppFunctionEnabled(openOrder, true);
```

`setAppFunctionEnabled(intent, enabled)` is a no-op on iOS, on web and below Android 16.

To check generated functions, use an Android 16 QPR2 or newer image:

```bash
adb shell cmd app_function list-app-functions --package com.example.myapp
adb shell cmd app_function execute-app-function --package com.example.myapp ...
```

Calls from Gemini also require the app to be in Google's Connected Apps Platform developer preview.
