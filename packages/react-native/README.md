# react-native-app-intents

Type-safe App Intents, App Shortcuts, dynamic shortcut helpers, codegen, CLI, and Expo prebuild automation for React Native.

```bash
npm install @avasapp/react-native-app-intents
```

Full usage docs are included in this package under `docs/` and published at:
`https://avas-app.github.io/react-native-app-intents/`

## Basic setup

Create `app-intents.config.ts` at your app root:

```ts
import { defineAppIntentsConfig } from "@avasapp/react-native-app-intents/codegen";

export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "myapp",
  ios: {
    output: "ios/MyApp/AppShortcuts.swift",
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

Define intents:

```ts
import { defineIntent, p } from "@avasapp/react-native-app-intents";

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  phrases: ["Open order ${orderNumber} in ${.applicationName}"],
  params: {
    orderNumber: p.string({
      androidBiiParam: "order",
      title: "Order number",
      default: "1234",
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
});
```

Generate native files:

```bash
npx app-intents generate
```

## Expo setup

Use the package root as an Expo config plugin. The plugin auto-loads the same
`app-intents.config.ts` file used by the CLI:

```json
{
  "expo": {
    "plugins": ["@avasapp/react-native-app-intents"]
  }
}
```

To use a different config file, pass `configPath`:

```json
{
  "expo": {
    "plugins": [["@avasapp/react-native-app-intents", { "configPath": "./config/app-intents.ts" }]]
  }
}
```

In Expo prebuilds, configured `ios.output`, `android.manifest`,
`android.shortcutsOutput`, and `android.shortcutsStringsOutput` paths are honored
relative to the app root. If `ios.output` does not start with `ios/`, it is
written under the generated iOS project folder. The generated Android manifest
also ensures `MainActivity` uses a foreground-intent-compatible launch mode for
Assistant/App Action deep links.

### Custom shortcut icons with `expo-asset`

For custom **Android** shortcut icons in Expo apps, add the image files to native
resources with the `expo-asset` config plugin, then reference the generated
resource name from `androidResourceName`:

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

```ts
surfaces: {
  appShortcut: {
    icon: {
      androidResourceName: "@drawable/open_order",
      systemName: "shippingbox",
    },
  },
}
```

For iOS **dynamic shortcuts**, you can also point at a bundled template image
name from the same asset file:

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

`expo-asset` uses the file name as the native resource name, so keep shortcut
asset files lowercase with underscores (for example, `open_order.png`). Run
`npx expo prebuild` again after adding or renaming assets.

On iOS, `iosTemplateImageName` only applies to **dynamic shortcuts** and renders
as a template/tinted silhouette. Generated App Shortcuts still use `systemName`
only; Expo-bundled PNG assets are not used there.

## Runtime usage

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

Each run is kept by the native side until your handlers finish (or throw), then
acknowledged. If the app is killed first, the run is delivered again on the next
launch, so handlers should be safe to run twice.

## Auth-gated apps

For apps where shortcuts should only exist for signed-in users or enabled
features, donate after a successful action, then clear donations and remove
dynamic shortcuts when auth or feature flags change:

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
(`androidResourceName`, such as `@mipmap/ic_launcher_round`).

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

## Android App Actions contract

- Use `android.appAction` to opt an intent into Android App Actions.
- Android App Actions are the primary Android target; Google Assistant voice support is best-effort.
- `surfaces.assistant` and top-level `androidBii` are legacy shims and should be avoided in new intent definitions.

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
