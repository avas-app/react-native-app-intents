# react-native-app-intents — Plan

A React Native library for declaring iOS App Intents and Android App Shortcuts from a single, type-safe TypeScript source of truth. Works with both bare React Native and Expo, with a framework-agnostic codegen at the core.

## Goals

- **One declaration, two platforms.** A single `defineIntent({...})` call generates iOS Swift `AppIntent` structs and Android `shortcuts.xml` / Capabilities entries.
- **End-to-end type safety.** Handler params are inferred from the same schema used to generate native artifacts.
- **Framework-agnostic.** Works with bare RN. Expo support is a thin convenience wrapper over the same codegen.
- **Config-driven, build-time.** Intents are compiled into the native binary (App Intents requires this on iOS). No runtime registration.
- **Tiny runtime surface.** A small TurboModule to receive intent events and donate usage.

## Architecture

```
@your-scope/app-intents
├── core/                 # defineIntent, defineEntity, schema (p.*)
├── codegen/              # TS declarations -> IR -> Swift / XML / Kotlin / .d.ts
├── react-native/         # bare RN TurboModule + runtime JS API
├── expo-plugin/          # optional Expo config plugin (wraps codegen)
└── cli/                  # `app-intents generate`
```

Pipeline:

```
*.intents.ts (defineIntent calls)
       │
       ▼
codegen parser/loader
       │
       ▼
IntentIR[] (normalized intermediate representation)
       │
       ├─► iOS:     GeneratedAppIntents.swift (AppIntent / AppEntity / AppShortcutsProvider)
       ├─► Android: shortcuts.xml + capabilities + manifest patches
       └─► Types:   generated app-intents.d.ts (discriminated union of events)
```

## Authoring API

### `defineIntent`

```ts
import { defineIntent, p } from "@your-scope/app-intents";

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  description: "Open a specific order by number.",
  phrases: ["Open order ${orderNumber} in ${.applicationName}", "Show my order ${orderNumber}"],
  params: {
    orderNumber: p.string({
      title: "Order number",
      prompt: "Which order?",
      requestValueDialog: "What's the order number?",
    }),
  },
  surfaces: { siri: true, spotlight: true, appShortcut: true, assistant: true },
  androidBii: "actions.intent.GET_ORDER",
  behavior: { opensAppToForeground: true },
});
```

### Schema builder `p`

- `p.string`, `p.int`, `p.number`, `p.bool`, `p.date`
- `p.entity({ entity: SomeEntity, ... })`
- `p.object({ ... })`
- All accept `{ title, prompt, requestValueDialog, optional, default }`.
- Strict phrase validation: every `${name}` must exist in `params` or be a built-in (e.g. `${.applicationName}`).

### `defineEntity` (optional)

```ts
const Order = defineEntity({
  id: "Order",
  schema: p.object({ id: p.int(), number: p.string(), customer: p.string() }),
  identifier: (o) => String(o.id),
  displayRepresentation: (o) => ({
    title: `Order #${o.number}`,
    subtitle: o.customer,
    image: { systemName: "bag" },
  }),
  query: async ({ search, ids }) => {
    if (ids) return db.ordersByIds(ids);
    return db.searchOrders(search ?? "");
  },
});
```

- iOS: emits `AppEntity` + `EntityQuery`. Surfaces in Siri disambiguation, Shortcuts, Spotlight, Apple Intelligence.
- Android: emits dynamic shortcuts via `ShortcutManagerCompat` and Capability inventory in `shortcuts.xml` for BII parameter matching.

## Runtime API

```ts
import {
  onIntent,
  onAnyIntent,
  getInitialIntent,
  donate,
  updateDynamicShortcuts,
} from "@your-scope/app-intents/react-native";
```

- `onIntent(intentDef, handler)` — typed handler, params inferred from def.
- `onAnyIntent(handler)` — discriminated-union router; type comes from generated `.d.ts`.
- `getInitialIntent()` — handles cold-start launch by intent.
- `donate(intentDef, params)` — hint to OS that the user just performed this action.
- `updateDynamicShortcuts([...])` — short-list of pinned/dynamic shortcuts.

## Code-splitting & file layout

Feature-colocated `*.intents.ts` files, single aggregator (or glob) for the codegen entry point.

```
src/
├── features/
│   ├── orders/orders.intents.ts
│   ├── timer/timer.intents.ts
│   └── settings/settings.intents.ts
└── intents.ts            # re-exports everything
```

```ts name=app-intents.config.ts
import { defineAppIntentsConfig } from "@your-scope/app-intents/codegen";

export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "myapp",
  ios: {
    output: "ios/AppIntents/GeneratedAppIntents.swift",
    appShortcutsProviderName: "MyAppShortcuts",
    bundleIdentifier: "com.example.myapp",
    siriUsageDescription: "Used to let Siri run app actions.",
  },
  android: {
    manifest: "android/app/src/main/AndroidManifest.xml",
    shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    packageName: "com.example.myapp",
  },
  types: { output: "src/generated/app-intents.d.ts" },
});
```

`defineIntent` returns a phantom-typed value (id + schema, no runtime side-effects), so importing intent defs into app code costs effectively nothing at runtime.

## Codegen

CLI:

```bash
bunx app-intents generate
bunx app-intents generate --check    # CI: fail if generated files are stale
```

Two execution strategies for parsing intent files:

- **v1 (sandboxed import):** use `tsx` / `esbuild-register` (or Bun's native TS loader). Document that `*.intents.ts` files must be pure (no RN imports, no side effects, only `defineIntent` / `defineEntity` / schema helpers).
- **v2 (static extraction):** parse with `ts-morph` / TS compiler API; safer, no code execution.

Generated files are checked in. This is the simplest, most debuggable model and works in any RN setup. Optional Gradle/Xcode build phases can be documented for users who want auto-regen.

## Bare RN integration

- Run `app-intents generate` (manually or via `prebuild` script).
- Generated Swift drops into an `ios/AppIntents/` group; manifest XML drops into `res/xml/`.
- App developer adds the TurboModule via autolinking.
- Permissions/Info.plist keys patched manually with documented snippets (or via the CLI's `--patch` mode).

## Expo integration

A config plugin wraps the same codegen + applies native patches:

```ts
export default {
  expo: {
    plugins: [
      ["@your-scope/app-intents/expo", { intents: "src/**/*.intents.ts", scheme: "myapp" }],
    ],
  },
};
```

The plugin runs codegen during prebuild and patches `Info.plist` / `AndroidManifest.xml`.

## Localization

```ts
title: { en: "Open Order", fr: "Ouvrir la commande" },
phrases: {
  en: ["Open order ${orderNumber}"],
  fr: ["Ouvrir la commande ${orderNumber}"],
},
```

Plugin emits per-locale `.strings` (iOS) and `values-<lang>/strings.xml` (Android).

## Testing

```ts
import { __test } from "@your-scope/app-intents/testing";

it("routes openOrder to Order screen", async () => {
  const nav = renderApp();
  await __test.fireIntent(openOrder, { orderNumber: "1234" });
  expect(nav.currentRoute()).toEqual({ name: "Order", params: { id: "1234" } });
});
```

## Tooling

- **Package manager / workspaces:** [Bun](https://bun.sh) workspaces.
- **Linter:** [oxlint](https://oxc.rs/docs/guide/usage/linter.html).
- **Formatter:** [oxfmt](https://oxc.rs).
- **Type checker:** `tsc --noEmit` in CI.
- **Test runner:** `bun test` for unit tests; example apps tested via Detox / Maestro (TBD).

## Milestones

### M0 — Scaffolding

- Bun workspaces monorepo with `core`, `codegen`, `cli`, `react-native`, `expo-plugin`, `example` packages.
- TS build, oxlint, oxfmt, CI.

### M1 — Core authoring API

- `defineIntent`, `defineEntity`, schema builder `p`.
- Type inference end-to-end (`ParamsOf<I>`, generated event union shape).
- Unit tests on schema validation and phrase placeholder checking.

### M2 — Codegen IR + iOS generator

- IR types and normalizer.
- Swift generator: `AppIntent`, `AppShortcutsProvider`, `AppEntity`, `EntityQuery`.
- Generated `.d.ts` discriminated union.
- CLI `generate` + `--check`.

### M3 — Android generator

- `shortcuts.xml`, capabilities + inline inventory entries.
- Manifest patcher: deep-link intent filters, `<meta-data>` for shortcuts.
- Dynamic shortcuts mapping for entities.

### M4 — RN runtime TurboModule

- iOS: handle `NSUserActivity` / App Intent continuation / URL scheme; emit JS event.
- Android: handle deep-link / shortcut `Intent`; emit JS event.
- `getInitialIntent`, `donate`, `updateDynamicShortcuts`.
- Example app demonstrating end-to-end flow on both platforms.

### M5 — Expo config plugin

- Wraps codegen, patches Info.plist + AndroidManifest, wires URL scheme.
- Example with Expo prebuild.

### M6 — Localization + polish

- Multi-locale phrases/titles, `.strings` / `values-*/strings.xml` emission.
- Better error messages from codegen (file/line for invalid declarations).
- Docs site with recipes (push-to-talk, deep-link routing, entity disambiguation).

### M7 — v1.0

- Stable IR.
- Documented public API.
- Migration guide.
- CI-tested example apps for bare RN + Expo.

## Open questions

- Static extraction vs sandboxed import for codegen — when do we cut over?
- How aggressively to support Android Capabilities / BIIs given Google's shifting Assistant strategy? (Likely: support but de-emphasize in docs; lean on App Shortcuts.)
- Background App Intents with snippet results — punt to v1.x?
