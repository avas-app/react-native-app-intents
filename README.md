# react-native-app-intents

Type-safe App Intents, App Shortcuts, and dynamic shortcut helpers for React Native.

```bash
npm install @avasapp/react-native-app-intents
```

Full usage docs are set up for GitHub Pages at:
`https://avasapp.github.io/react-native-app-intents/`

## Basic setup

Create `app-intents.config.ts`:

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

Handle intents in JS:

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

App-intents URLs use the reserved `app-intents` host, such as
`myapp://app-intents/openOrder?...`. You can share `myapp` with normal app deep
links, but route only the `app-intents` host through this library and let React
Native `Linking` handle the rest.

For auth-gated apps, donate only after a real user action, and clear donations
plus dynamic shortcuts on logout or when the feature is disabled:

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

## Expo setup

Use the package root as an Expo config plugin. The plugin reads the same
`app-intents.config.ts` file used by the CLI, so `app.config.ts` does not need to
duplicate your intent configuration:

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
Assistant/App Action deep links and adds the `scheme://app-intents` filter
without replacing existing app or Expo dev-client deep-link filters.

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

## Current features

- Single scoped npm package: runtime, authoring API, codegen, CLI, and Expo plugin.
- Type-safe `defineIntent`, `defineEntity`, and `p.*` parameter builders.
- First-class `android.appAction` authoring plus Android shortcuts XML, strings XML, and manifest patching.
- First-class `ios.appIntent` authoring plus Swift App Intents/App Shortcuts generation.
- Nested object-parameter support in generated iOS App Intents, including generated parameter summaries.
- Static iOS App Intent dialog responses via `ios.appIntent.response.dialog`.
- Generated TypeScript event types.
- Runtime helpers for initial intents, warm intent events, intent URL parsing/building, donations,
  donation clearing, and dynamic shortcuts.
- Expo prebuild plugin for iOS codegen, URL scheme setup, app group entitlements, quick-action forwarding, and Android foreground deep-link manifest setup.
- Bare React Native iOS and Android native modules.

## Planned features

- Expanded Android App Actions coverage.
- Dynamic Siri/App Intent dialog flows beyond the current static-response slice.
- Richer icons and metadata for generated shortcuts.
- More Expo and bare-app setup automation.
- Expanded examples and end-to-end app templates.
- More generated type helpers for navigation integrations.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
```

The repository is a Bun workspace. `packages/react-native` is the public
`@avasapp/react-native-app-intents` package; the other workspace packages are private internal boundaries.
