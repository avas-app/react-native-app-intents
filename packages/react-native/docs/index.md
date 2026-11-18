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
The catalog is stored natively in `UserDefaults`, so keep it to the rows Siri
needs. Clear it on logout with `setEntities(order, [])`.

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

`setEntities`, `getEntities`, `reindexEntities`, `useOnscreenEntity`, `useAppEntityTag` and Spotlight
are iOS-only. On Android they resolve and do nothing.
