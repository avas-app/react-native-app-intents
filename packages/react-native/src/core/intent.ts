import type { AnyParameterDefinition, InferParams, LocalizedText } from "./schema.js";

export interface ShortcutIcon {
  /** Android drawable or mipmap resource used by static or dynamic Android shortcuts. Omit for iOS-only shortcuts. */
  androidResourceName?: string;
  /** iOS SF Symbol name used by static App Shortcuts and runtime dynamic shortcuts. Omit for Android-only shortcuts. */
  systemName?: string;
}

/** Runtime-only icon metadata for `updateDynamicShortcuts(...)`. */
export interface DynamicShortcutIcon extends ShortcutIcon {
  /** iOS asset catalog template image name used only for dynamic shortcuts. Omit this on `surfaces.appShortcut` because generated static shortcuts do not read it. */
  iosTemplateImageName?: string;
}

/** Static shortcut metadata generated at build time from `defineIntent(...)`. */
export interface AppShortcutSurfaceOptions {
  /** Icon metadata for generated iOS App Shortcuts and Android static shortcuts. Omit to use platform defaults. */
  icon?: ShortcutIcon;
}

/**
 * Controls which static native surfaces are generated for an intent.
 *
 * Quick guide:
 * - iOS Siri / App Intent support: define `ios.appIntent`; omit `surfaces.siri`.
 * - Android Assistant / App Actions: define `android.appAction`; omit `surfaces.assistant`.
 * - Static shortcuts on iOS and Android: define `surfaces.appShortcut` and `phrases`.
 * - iOS Spotlight: define `surfaces.spotlight`.
 * - Dynamic shortcuts: do not configure them here; use `runtime.updateDynamicShortcuts(...)`.
 */
export interface IntentSurfaces {
  /**
   * Legacy Siri surface marker.
   *
   * Do not set this directly; configure `ios.appIntent` instead. Validation derives this
   * surface automatically when native App Intent options are present.
   */
  siri?: boolean;
  /** Exposes the intent to iOS Spotlight indexing. Define this only for Spotlight support; omit it for Android-only or shortcut-only intents. */
  spotlight?: boolean;
  /**
   * Exposes the intent as an iOS App Shortcut and Android static shortcut.
   *
   * Define this when you want static shortcuts generated at build time. Also define `phrases`,
   * because shortcut generation requires invocation phrases. Omit this for App-Intent-only,
   * App-Action-only, or dynamic-shortcut-only intents.
   *
   * Set to `true` for default shortcut metadata, or pass an object to customize the icon.
   */
  appShortcut?: boolean | AppShortcutSurfaceOptions;
  /** @deprecated Omit this in new definitions and use `android.appAction` instead. */
  assistant?: boolean;
}

export interface IntentBehavior {
  /** Whether the native intent should open the app foreground before completion. For iOS App Intents, omit this when using `ios.appIntent.response.dialog`, because static dialogs are background-only. */
  opensAppToForeground?: boolean;
}

export interface IOSAppIntentResponseOptions {
  /** Static dialog returned by the generated iOS App Intent. Define this only for background iOS App Intents; omit it when `behavior.opensAppToForeground` is `true` or when targeting Android-only flows. */
  dialog?: LocalizedText;
}

export interface IOSAppIntentOptions {
  /** Response metadata returned by the generated iOS App Intent. Omit when you do not need static iOS response dialog content. */
  response?: IOSAppIntentResponseOptions;
}

export interface IntentIOSOptions {
  /** Enables generation of a native iOS App Intent for this intent. Define this for Siri/App Intent support, and omit it for Android-only or shortcut-only intents that should not participate in iOS App Intent flows. */
  appIntent?: IOSAppIntentOptions;
}

export type AndroidAppActionFulfillment = "deeplink";
export type AndroidAppActionInventoryStrategy = "static" | "dynamic";

export interface AndroidAppActionOptions {
  /** Built-in Intent capability name, such as `actions.intent.GET_ORDER`. Define this to enable Android App Actions / Assistant support, and omit the whole `android.appAction` block when Android Assistant is not a target surface. */
  capability: string;
  /** Fulfillment mode for the generated Android capability. */
  fulfillment?: AndroidAppActionFulfillment;
  /** Inventory strategy used when entity parameters back Android shortcuts. */
  inventory?: {
    /** Whether entity inventory is emitted statically from `defineEntity(...).inventory` or supplied dynamically at runtime. Use `"static"` for fixed catalogs checked into the app, or `"dynamic"` when runtime donations / dynamic shortcuts should drive availability. */
    strategy?: AndroidAppActionInventoryStrategy;
  };
}

export interface IntentAndroidOptions {
  /** Enables generation of an Android App Action capability for this intent. Define this for Android Assistant / App Actions, and omit it for iOS-only, Spotlight-only, or shortcut-only intents. */
  appAction?: AndroidAppActionOptions;
}

/**
 * Declares an intent that can be exposed across iOS and Android surfaces.
 *
 * Surface checklist:
 * - iOS Siri / App Intents: define `ios.appIntent`; usually also define parameter `title` values,
 *   and optionally `requestValueDialog` / `prompt`.
 * - Android Assistant / App Actions: define `android.appAction.capability`; for every parameter
 *   used by that capability, define `params.<name>.androidBiiParam`.
 * - Static shortcuts: define `surfaces.appShortcut` and `phrases`; optionally customize the icon.
 * - Dynamic shortcuts and donations: reuse the same intent definition, but configure those at
 *   runtime instead of under `surfaces`.
 * - Omit platform-specific sections you do not target.
 */
export interface IntentDefinition<
  TParams extends Record<string, AnyParameterDefinition> = Record<string, AnyParameterDefinition>,
> {
  /** Internal marker used to identify intent definitions during codegen. */
  kind: "intent";
  /** Stable identifier used in generated URLs, event ids, shortcuts, and native declarations. */
  id: string;
  /** User-facing intent title. */
  title: LocalizedText;
  /** Longer user-facing description shown by native surfaces when supported. */
  description?: LocalizedText;
  /** Invocation phrases for generated static shortcuts. Define these when `surfaces.appShortcut` is enabled; otherwise omit them unless you want the phrases documented alongside the intent. */
  phrases?: readonly string[] | Partial<Record<string, readonly string[]>>;
  /** Typed parameters accepted by this intent. Use parameter `title` / `prompt` / `requestValueDialog` for iOS App Intent UX, and `androidBiiParam` only for parameters that participate in `android.appAction` bindings. */
  params: TParams;
  /** Native surfaces where this intent should be exposed. Prefer `ios.appIntent` / `android.appAction` for Siri and Assistant support, and use `surfaces` mainly for static shortcuts and Spotlight. */
  surfaces?: IntentSurfaces;
  /** Android-specific generation options. Define this only when Android App Actions / Assistant support is needed. */
  android?: IntentAndroidOptions;
  /** iOS-specific generation options. Define this only when iOS App Intent / Siri support is needed. */
  ios?: IntentIOSOptions;
  /** @deprecated Omit this in new definitions and use `android.appAction.capability` instead. */
  androidBii?: string;
  /** Runtime behavior options for generated native integrations. */
  behavior?: IntentBehavior;
}

/** Infers the runtime params object for an intent definition. */
export type ParamsOf<TIntent extends IntentDefinition<any>> = InferParams<TIntent["params"]>;

/**
 * Defines an app intent that codegen can expose through native integrations.
 *
 * Use the returned object as the single source of truth for:
 * - iOS App Intent / Siri configuration via `ios.appIntent`
 * - Android App Actions / Assistant configuration via `android.appAction`
 * - Static shortcut / Spotlight generation via `surfaces`
 *
 * Dynamic shortcuts and donations reuse this definition at runtime, but are configured through
 * the runtime APIs instead of additional `defineIntent(...)` fields.
 */
export function defineIntent<const TParams extends Record<string, AnyParameterDefinition>>(
  config: Omit<IntentDefinition<TParams>, "kind">,
): IntentDefinition<TParams> {
  return { kind: "intent", ...config };
}
