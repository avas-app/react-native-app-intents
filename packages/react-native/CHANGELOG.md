# Changelog

All notable changes to this package are documented here.

Entries before 0.2.5 were reconstructed from git history after the fact and may be incomplete.

## Unreleased

### Added

- Localization now reaches the generated native artifacts. Locale maps were already accepted on
  intent `title` / `description`, parameter `title` / `prompt` / `requestValueDialog`, entity
  `title`, `ios.appIntent.response.dialog`, and `phrases`, but every locale other than the default
  was silently discarded during codegen. Codegen now emits `<locale>.lproj/AppIntents.strings` and
  `<locale>.lproj/AppShortcuts.strings` for iOS, and `res/values-<qualifier>/..._strings.xml` for
  Android. Android qualifiers follow the platform's own rules, so `pt-BR` becomes `values-pt-rBR`
  and script subtags use the `values-b+zh+Hans` form.
- `localization.defaultLocale` (default `"en"`) selects the locale that generated native files are
  authored in, and `localization.iosResourcesDirectory` overrides where `.lproj` tables are written.
  Both are also honored by the Expo config plugin.
- `createAppIntentsRuntime` accepts `locale` and `defaultLocale`. Donations and dynamic shortcuts
  now resolve locale maps against the device locale rather than always using English, and
  `DynamicShortcut.shortTitle` / `longTitle` accept locale maps.
- Codegen diagnostics now carry the file and line of the declaration that failed, for example
  `src/orders.intents.ts:12:1 [openOrder] Phrase "..." references unknown placeholder "orderId".`
  `AppIntentsValidationError` exposes the parts separately through a new `details` array; the
  existing `issues` array keeps working and now includes the location prefix.
- Failures loading an intent module now name the file and explain that intent modules are evaluated
  during codegen, and the "no intents found" error lists the patterns and directory it searched.

### Changed

- When a project declares more than one locale, generated Swift routes user-facing text through
  keyed `LocalizedStringResource` lookups against an `AppIntents` table, keeping the default-locale
  text inline as the fallback. Projects that use a single locale generate byte-identical output to
  before.
- Translated App Shortcut phrases must now include `${.applicationName}` themselves. The default
  locale still gets the app name appended with an English connector when it is missing, but doing
  that to a translation produced broken phrases such as `Ouvrir la commande in MyApp`, so codegen
  rejects it instead. Phrase lists are matched by position, so all locales must declare the same
  number of phrases.

### Fixed

- Regenerated the bare example app's checked-in `AppShortcuts.swift`, which was stale relative to
  the parameter-summary and JSON-payload changes that shipped in earlier releases.

## 0.2.6

### Fixed

- `parseIntentUrl` no longer throws when an intent URL carries a malformed `payload` query
  parameter. A URL such as `myapp://app-intents/openOrder?payload=not-json` previously raised a
  `SyntaxError` out of the internal dispatch path, surfacing as an unhandled promise rejection, and
  rejected the promise returned by `getInitialIntent()`. Any app or web page can open a custom
  scheme URL, so this was reachable from outside the app. Malformed payloads are now treated as
  non-intent URLs and ignored.
- JSON payloads that parse to an array are now rejected. Previously `?payload=[1,2]` passed the
  object check and produced an intent event with empty params, invoking handlers with `undefined`
  values for parameters typed as required.
- Corrected the documentation link in the README, which pointed at a non-existent GitHub Pages host.

### Changed

- Consolidated the duplicated `@react-native-app-intents/{core,codegen,cli,expo-plugin}` workspace
  packages into `packages/react-native`. Those packages were private and never published, so there
  is no change to the public API, the `exports` map, or the contents of the npm tarball. Their test
  suites now run against the source that ships.

## 0.2.5

### Breaking

- Renamed the package from `@crockalet/react-native-app-intents` to
  `@avasapp/react-native-app-intents`. This is a new package name on npm; installs of the old name
  will not receive further updates. Application identifiers were renamed from `crockalet` to
  `avasapp` at the same time.

  This change shipped in a patch release by mistake — it warranted a minor bump — and was not
  recorded in the changelog at the time.

### Added

- Claim the reserved `app-intents` deep-link host and preserve existing Android intent filters when
  patching `AndroidManifest.xml`.

### Fixed

- Deliver foreground intent URLs without requiring the app to call `getInitialIntent()`.
- Silence Android `NativeEventEmitter` `addListener`/`removeListeners` warnings.
- Corrected the repository URL in package metadata.

## 0.2.4

- Clarified the platform surface documentation.

## 0.2.3

- Added JSDoc to the exposed intent surfaces.

## 0.2.2

- Fixed the format check that gated releases.

## 0.2.1

- Fixed Expo Android foreground App Actions.

## 0.2.0

- Version bump; no functional changes over 0.1.5.

## 0.1.5

- Patch the Expo `AppDelegate` to forward quick actions.

## 0.1.3

- Fixed npm package metadata.

## 0.1.1

- Initial public release: consolidated the codegen, CLI, runtime, and Expo prebuild plugin into a
  single package, with documentation.
