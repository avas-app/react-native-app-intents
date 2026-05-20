import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type { ConfigContext } from "@expo/config";
import { evalConfig } from "@expo/config/build/evalConfig.js";
import * as ExpoConfigPlugins from "@expo/config-plugins";
import type { ConfigPlugin } from "@expo/config-plugins";
import type { InfoPlist } from "@expo/config-plugins/build/ios/IosConfig.types";
import {
  defineAppIntentsConfig,
  generateAppIntents,
  type AppIntentsConfig,
  type AppIntentsConfigInput,
} from "../codegen/index.js";

const {
  IOSConfig,
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} =
  (ExpoConfigPlugins as typeof ExpoConfigPlugins & { default?: typeof ExpoConfigPlugins })
    .default ?? ExpoConfigPlugins;
const EXPO_PLUGIN_PACKAGE_NAME = "@avasapp/react-native-app-intents";
const DEFAULT_CONFIG_FILE_NAMES = [
  "app-intents.config.ts",
  "app-intents.config.mts",
  "app-intents.config.cts",
  "app-intents.config.mjs",
  "app-intents.config.cjs",
  "app-intents.config.js",
] as const;
const GENERATED_IOS_SOURCE_FILE_NAME = "GeneratedAppIntents.swift";
const DEFAULT_ANDROID_MANIFEST_PATH = "android/app/src/main/AndroidManifest.xml";
const DEFAULT_ANDROID_SHORTCUTS_PATH = "android/app/src/main/res/xml/app_intents_shortcuts.xml";

export type ExpoAppIntentsPluginOptions =
  | (Partial<AppIntentsConfigInput> & { configPath?: string })
  | undefined;
type NativeExpoConfig = Parameters<ConfigPlugin<unknown>>[0];
type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue | undefined };
type JSONObject = { [key: string]: JSONValue | undefined };
type ExpoAppConfig = NativeExpoConfig & { plugins?: unknown[] };
type ExpoPluginUserConfig = { plugins?: unknown[]; [key: string]: unknown };
type ResolveExpoPluginOptions = (projectRoot: string) => Promise<AppIntentsConfig>;
type AndroidActivityMatch = {
  index: number;
  openingTag: string;
  source: string;
  selfClosing: boolean;
};

export type AppIntentsPluginEntry = readonly [typeof EXPO_PLUGIN_PACKAGE_NAME, AppIntentsConfig];

export function withAppIntents<TConfig extends ExpoPluginUserConfig>(
  config: TConfig,
  options: Exclude<ExpoAppIntentsPluginOptions, undefined> = {},
): TConfig & { plugins: unknown[] } {
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];

  plugins.push([EXPO_PLUGIN_PACKAGE_NAME, normalizePluginEntryOptions(options)]);

  return { ...config, plugins };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigInput(value: unknown): value is AppIntentsConfigInput {
  if (!isRecord(value)) {
    return false;
  }

  if (!("scheme" in value) || typeof value.scheme !== "string") {
    return false;
  }

  if (!("intents" in value)) {
    return false;
  }

  return typeof value.intents === "string" || Array.isArray(value.intents);
}

function getConfigPath(options: ExpoAppIntentsPluginOptions): string | undefined {
  if (!isRecord(options) || !("configPath" in options) || options.configPath === undefined) {
    return undefined;
  }

  if (typeof options.configPath !== "string" || options.configPath.length === 0) {
    throw new Error("react-native-app-intents Expo plugin option configPath must be a string.");
  }

  return options.configPath;
}

function getInlineConfig(options: ExpoAppIntentsPluginOptions): Partial<AppIntentsConfigInput> {
  if (!isRecord(options)) {
    return {};
  }

  const { configPath: _configPath, ...inlineConfig } = options;
  return inlineConfig as Partial<AppIntentsConfigInput>;
}

function normalizePluginEntryOptions(
  options: Exclude<ExpoAppIntentsPluginOptions, undefined>,
): Exclude<ExpoAppIntentsPluginOptions, undefined> {
  const configPath = getConfigPath(options);
  const inlineConfig = getInlineConfig(options);

  if (isConfigInput(inlineConfig)) {
    return {
      ...defineAppIntentsConfig(inlineConfig),
      ...(configPath ? { configPath } : {}),
    };
  }

  return options;
}

function mergeConfigObjects(
  fileConfig: AppIntentsConfigInput,
  inlineConfig: Partial<AppIntentsConfigInput>,
): unknown {
  const merged: Record<string, unknown> = { ...fileConfig, ...inlineConfig };

  if (fileConfig.ios || inlineConfig.ios) {
    merged.ios = { ...fileConfig.ios, ...inlineConfig.ios };
  }

  if (fileConfig.android || inlineConfig.android) {
    merged.android = { ...fileConfig.android, ...inlineConfig.android };
  }

  if (fileConfig.types || inlineConfig.types) {
    merged.types = { ...fileConfig.types, ...inlineConfig.types };
  }

  return merged;
}

async function resolveConfigFilePath(projectRoot: string, configPath?: string): Promise<string> {
  const candidates = configPath ? [configPath] : DEFAULT_CONFIG_FILE_NAMES;

  for (const candidate of candidates) {
    const absolutePath = isAbsolute(candidate) ? candidate : resolve(projectRoot, candidate);

    try {
      await access(absolutePath);
      return absolutePath;
    } catch {
      // Try the next supported config filename.
    }
  }

  if (configPath) {
    throw new Error(`Could not find react-native-app-intents config at ${configPath}.`);
  }

  throw new Error(
    `Could not find react-native-app-intents config. Create ${DEFAULT_CONFIG_FILE_NAMES[0]} or pass { configPath } to the Expo plugin.`,
  );
}

function loadConfigInput(projectRoot: string, configFilePath: string): AppIntentsConfigInput {
  const context: ConfigContext = {
    projectRoot,
    staticConfigPath: null,
    packageJsonPath: null,
    config: {},
  };
  const { config } = evalConfig(configFilePath, context);

  if (!isConfigInput(config)) {
    throw new Error(`Invalid react-native-app-intents config at ${configFilePath}.`);
  }

  return config;
}

export async function resolveExpoAppIntentsPluginOptions(
  rawOptions: ExpoAppIntentsPluginOptions,
  projectRoot: string,
): Promise<AppIntentsConfig> {
  const configPath = getConfigPath(rawOptions);
  const inlineConfig = getInlineConfig(rawOptions);

  if (!configPath && isConfigInput(inlineConfig)) {
    return defineAppIntentsConfig(inlineConfig);
  }

  const configFilePath = await resolveConfigFilePath(projectRoot, configPath);
  const loadedConfig = loadConfigInput(projectRoot, configFilePath);
  const mergedConfig = mergeConfigObjects(loadedConfig, inlineConfig);

  if (!isConfigInput(mergedConfig)) {
    throw new Error(`Invalid react-native-app-intents config at ${configFilePath}.`);
  }

  return defineAppIntentsConfig(mergedConfig);
}

function createOptionsResolver(rawOptions: ExpoAppIntentsPluginOptions): ResolveExpoPluginOptions {
  const cache = new Map<string, Promise<AppIntentsConfig>>();

  return (projectRoot) => {
    let promise = cache.get(projectRoot);

    if (!promise) {
      promise = resolveExpoAppIntentsPluginOptions(rawOptions, projectRoot);
      cache.set(projectRoot, promise);
    }

    return promise;
  };
}

export function applyInfoPlistAppIntentsConfig(
  infoPlist: InfoPlist,
  options: AppIntentsConfig,
): InfoPlist {
  const urlTypes = Array.isArray(infoPlist.CFBundleURLTypes) ? [...infoPlist.CFBundleURLTypes] : [];
  const schemeConfigured = urlTypes.some(
    (entry) =>
      Array.isArray(entry.CFBundleURLSchemes) && entry.CFBundleURLSchemes.includes(options.scheme),
  );

  if (!schemeConfigured) {
    urlTypes.push({
      CFBundleURLSchemes: [options.scheme],
    });
  }

  infoPlist.CFBundleURLTypes = urlTypes;

  if (options.ios?.siriUsageDescription) {
    infoPlist.NSSiriUsageDescription = options.ios.siriUsageDescription;
  }

  if (options.ios?.appGroupIdentifier) {
    infoPlist.ReactNativeAppIntentsAppGroupIdentifier = options.ios.appGroupIdentifier;
  }

  return infoPlist;
}

export function applyEntitlementsAppIntentsConfig(
  entitlements: JSONObject,
  options: AppIntentsConfig,
): JSONObject {
  if (!options.ios?.appGroupIdentifier) {
    return entitlements;
  }

  const groups = Array.isArray(entitlements["com.apple.security.application-groups"])
    ? [...(entitlements["com.apple.security.application-groups"] as string[])]
    : [];

  if (!groups.includes(options.ios.appGroupIdentifier)) {
    groups.push(options.ios.appGroupIdentifier);
  }

  entitlements["com.apple.security.application-groups"] = groups;
  return entitlements;
}

function toNativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");

  if (isAbsolute(normalized)) {
    throw new Error(`react-native-app-intents paths must be relative to the project root: ${path}`);
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function joinNativePath(...segments: string[]): string {
  return toNativePath(join(...segments));
}

function getExpoSchemes(config: ExpoAppConfig): string[] {
  const scheme = (config as { scheme?: string | string[] }).scheme;
  const schemes = Array.isArray(scheme) ? scheme : scheme ? [scheme] : [];
  return [...new Set(schemes.filter((value) => value.length > 0))];
}

function findMainActivity(manifest: string): AndroidActivityMatch | null {
  for (const match of manifest.matchAll(/<activity\b[^>]*(?:\/>|>)/g)) {
    const openingTag = match[0];
    const index = match.index;

    if (index === undefined || !openingTag.includes('android:name=".MainActivity"')) {
      continue;
    }

    const selfClosing = /\/>\s*$/.test(openingTag);

    if (selfClosing) {
      return { index, openingTag, source: openingTag, selfClosing };
    }

    const closeIndex = manifest.indexOf("</activity>", index + openingTag.length);

    if (closeIndex === -1) {
      return null;
    }

    return {
      index,
      openingTag,
      source: manifest.slice(index, closeIndex + "</activity>".length),
      selfClosing,
    };
  }

  return null;
}

function androidTagHasAttribute(tag: string, name: string, value: string): boolean {
  return new RegExp(`\\bandroid:${name}\\s*=\\s*"${escapeRegExp(value)}"`).test(tag);
}

function hasGenericSchemeFilter(activitySource: string, scheme: string): boolean {
  const intentFilters = activitySource.match(/<intent-filter\b[\s\S]*?<\/intent-filter>/g) ?? [];

  return intentFilters.some((intentFilter) => {
    const dataTags = intentFilter.match(/<data\b[\s\S]*?(?:\/>|><\/data>)/g) ?? [];

    return dataTags.some(
      (dataTag) =>
        androidTagHasAttribute(dataTag, "scheme", scheme) && !/\bandroid:host\s*=/.test(dataTag),
    );
  });
}

function renderGenericSchemeFilter(scheme: string): string {
  return [
    "        <intent-filter>",
    '            <action android:name="android.intent.action.VIEW" />',
    '            <category android:name="android.intent.category.DEFAULT" />',
    '            <category android:name="android.intent.category.BROWSABLE" />',
    `            <data android:scheme="${escapeXml(scheme)}" />`,
    "        </intent-filter>",
  ].join("\n");
}

export function applyAndroidExpoSchemeFilters(
  manifest: string,
  schemes: readonly string[],
): string {
  let updatedManifest = manifest;

  for (const scheme of schemes) {
    const mainActivity = findMainActivity(updatedManifest);

    if (!mainActivity || hasGenericSchemeFilter(mainActivity.source, scheme)) {
      continue;
    }

    const schemeFilter = renderGenericSchemeFilter(scheme);
    const replacement = mainActivity.selfClosing
      ? `${mainActivity.openingTag.replace(/\/>\s*$/, ">")}\n${schemeFilter}\n      </activity>`
      : mainActivity.source.replace("</activity>", `${schemeFilter}\n      </activity>`);

    updatedManifest = `${updatedManifest.slice(0, mainActivity.index)}${replacement}${updatedManifest.slice(
      mainActivity.index + mainActivity.source.length,
    )}`;
  }

  return updatedManifest;
}

function resolveExpoIOSOutput(options: AppIntentsConfig, iosProjectName: string): string {
  const output = toNativePath(options.ios?.output ?? GENERATED_IOS_SOURCE_FILE_NAME);

  if (output.startsWith("ios/")) {
    return output;
  }

  return joinNativePath("ios", iosProjectName, output);
}

function toIOSProjectRelativePath(iosOutput: string): string {
  const output = toNativePath(iosOutput);
  return output.startsWith("ios/") ? output.slice("ios/".length) : output;
}

function resolveExpoAndroidManifest(options: AppIntentsConfig): string {
  return toNativePath(options.android?.manifest ?? DEFAULT_ANDROID_MANIFEST_PATH);
}

function resolveExpoAndroidShortcutsOutput(options: AppIntentsConfig): string {
  return toNativePath(options.android?.shortcutsOutput ?? DEFAULT_ANDROID_SHORTCUTS_PATH);
}

export function patchSwiftAppDelegate(source: string): string {
  let patched = source;

  if (!patched.includes("import ReactNativeAppIntents")) {
    const importMatches = [...patched.matchAll(/^import .+$/gm)];
    const insertIndex =
      importMatches.length > 0
        ? (importMatches.at(-1)?.index ?? 0) + (importMatches.at(-1)?.[0].length ?? 0)
        : 0;
    patched = `${patched.slice(0, insertIndex)}\nimport ReactNativeAppIntents${patched.slice(insertIndex)}`;
  }

  patched = injectColdLaunchShortcutHandling(patched);
  patched = injectQuickActionHandlerMethods(patched);

  return patched;
}

export function resolveExpoCodegenConfig(
  config: ExpoAppConfig,
  options: AppIntentsConfig,
  projectRoot: string,
  platform: "ios" | "android",
  iosProjectName?: string,
): AppIntentsConfig {
  const iosBundleIdentifier = options.ios?.bundleIdentifier ?? config.ios?.bundleIdentifier;
  const androidPackageName = options.android?.packageName ?? config.android?.package;

  return defineAppIntentsConfig({
    intents: options.intents,
    scheme: options.scheme,
    ...(platform === "ios" && iosProjectName
      ? {
          ios: {
            output: resolveExpoIOSOutput(options, iosProjectName),
            ...(options.ios?.appGroupIdentifier
              ? { appGroupIdentifier: options.ios.appGroupIdentifier }
              : {}),
            ...(options.ios?.appShortcutsProviderName
              ? { appShortcutsProviderName: options.ios.appShortcutsProviderName }
              : {}),
            ...(iosBundleIdentifier ? { bundleIdentifier: iosBundleIdentifier } : {}),
            ...(options.ios?.siriUsageDescription
              ? { siriUsageDescription: options.ios.siriUsageDescription }
              : {}),
          },
        }
      : {}),
    ...(platform === "android" && androidPackageName
      ? {
          android: {
            manifest: resolveExpoAndroidManifest(options),
            packageName: androidPackageName,
            shortcutsOutput: resolveExpoAndroidShortcutsOutput(options),
            ...(options.android?.shortcutsStringsOutput
              ? { shortcutsStringsOutput: toNativePath(options.android.shortcutsStringsOutput) }
              : {}),
          },
        }
      : {}),
    ...(options.types ? { types: options.types } : {}),
  });
}

async function resolveIOSProjectName(projectRoot: string): Promise<string> {
  const iosRoot = join(projectRoot, "ios");
  const entries = await readdir(iosRoot, { withFileTypes: true });
  const project = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"));

  if (!project) {
    throw new Error("Could not locate an iOS .xcodeproj to configure react-native-app-intents.");
  }

  return basename(project.name, ".xcodeproj");
}

async function patchExpoAppDelegate(projectRoot: string, projectName: string): Promise<void> {
  const appDelegatePath = join(projectRoot, "ios", projectName, "AppDelegate.swift");
  const source = await readFile(appDelegatePath, "utf8");
  const patched = patchSwiftAppDelegate(source);

  if (patched !== source) {
    await writeFile(appDelegatePath, patched, "utf8");
  }
}

async function patchExpoAndroidSchemeFilters(
  projectRoot: string,
  manifestPath: string,
  schemes: readonly string[],
): Promise<void> {
  if (schemes.length === 0) {
    return;
  }

  const absoluteManifestPath = join(projectRoot, manifestPath);
  const source = await readFile(absoluteManifestPath, "utf8");
  const patched = applyAndroidExpoSchemeFilters(source, schemes);

  if (patched !== source) {
    await writeFile(absoluteManifestPath, patched, "utf8");
  }
}

async function runPlatformCodegen(
  config: ExpoAppConfig,
  options: AppIntentsConfig,
  projectRoot: string,
  platform: "ios" | "android",
): Promise<void> {
  if (platform === "ios") {
    const iosProjectName = await resolveIOSProjectName(projectRoot);
    await generateAppIntents(
      resolveExpoCodegenConfig(config, options, projectRoot, "ios", iosProjectName),
      {
        cwd: projectRoot,
      },
    );
    await patchExpoAppDelegate(projectRoot, iosProjectName);
    return;
  }

  const androidCodegenConfig = resolveExpoCodegenConfig(config, options, projectRoot, "android");
  await generateAppIntents(androidCodegenConfig, {
    cwd: projectRoot,
  });
  await patchExpoAndroidSchemeFilters(
    projectRoot,
    resolveExpoAndroidManifest(options),
    getExpoSchemes(config),
  );
}

function withGeneratedIOSSource(
  config: ExpoAppConfig,
  resolveOptions: ResolveExpoPluginOptions,
): ExpoAppConfig {
  return withXcodeProject(config, async (currentConfig) => {
    const project = currentConfig.modResults as any;
    const modRequest = currentConfig.modRequest as { projectName?: string; projectRoot: string };
    const projectName =
      modRequest.projectName ??
      ((
        IOSConfig.XcodeUtils as unknown as { getProjectName(projectRoot: string): string }
      ).getProjectName(modRequest.projectRoot) as string);
    const options = await resolveOptions(modRequest.projectRoot);
    const filePath = toIOSProjectRelativePath(resolveExpoIOSOutput(options, projectName));
    if (typeof project.hasFile !== "function" || !project.hasFile(filePath)) {
      const xcodeUtils = IOSConfig.XcodeUtils as unknown as {
        addBuildSourceFileToGroup(options: {
          filepath: string;
          groupName: string;
          project: any;
        }): any;
        ensureGroupRecursively(project: any, filepath: string): unknown;
      };
      const groupName = dirname(filePath);

      xcodeUtils.ensureGroupRecursively(project, groupName);
      xcodeUtils.addBuildSourceFileToGroup({ filepath: filePath, groupName, project });
    }

    return currentConfig;
  });
}

const withReactNativeAppIntentsBase: ConfigPlugin<ExpoAppIntentsPluginOptions> = (
  config: NativeExpoConfig,
  rawOptions: ExpoAppIntentsPluginOptions,
): NativeExpoConfig => {
  let currentConfig = config as ExpoAppConfig;
  const resolveOptions = createOptionsResolver(rawOptions);

  currentConfig = withInfoPlist(currentConfig, async (modConfig) => {
    const options = await resolveOptions(modConfig.modRequest.projectRoot);
    modConfig.modResults = applyInfoPlistAppIntentsConfig(modConfig.modResults, options);
    return modConfig;
  });

  currentConfig = withEntitlementsPlist(currentConfig, async (modConfig) => {
    const options = await resolveOptions(modConfig.modRequest.projectRoot);
    modConfig.modResults = applyEntitlementsAppIntentsConfig(modConfig.modResults, options);
    return modConfig;
  });

  currentConfig = withGeneratedIOSSource(currentConfig, resolveOptions);

  currentConfig = withDangerousMod(currentConfig, [
    "ios",
    async (modConfig) => {
      const options = await resolveOptions(modConfig.modRequest.projectRoot);
      await runPlatformCodegen(currentConfig, options, modConfig.modRequest.projectRoot, "ios");
      return modConfig;
    },
  ]);

  currentConfig = withDangerousMod(currentConfig, [
    "android",
    async (modConfig) => {
      const options = await resolveOptions(modConfig.modRequest.projectRoot);

      try {
        await access(join(modConfig.modRequest.projectRoot, resolveExpoAndroidManifest(options)));
      } catch {
        return modConfig;
      }

      await runPlatformCodegen(currentConfig, options, modConfig.modRequest.projectRoot, "android");
      return modConfig;
    },
  ]);

  return currentConfig;
};

function injectColdLaunchShortcutHandling(source: string): string {
  const snippet = "launchOptions?[.shortcutItem] as? UIApplicationShortcutItem";

  if (source.includes(snippet)) {
    return source;
  }

  const signatureIndex = source.indexOf("didFinishLaunchingWithOptions");

  if (signatureIndex === -1) {
    throw new Error("Could not find didFinishLaunchingWithOptions in AppDelegate.swift.");
  }

  const functionStart = source.lastIndexOf("func application(", signatureIndex);
  const braceStart = source.indexOf("{", signatureIndex);
  const braceEnd = findMatchingBrace(source, braceStart);
  const functionSource = source.slice(functionStart, braceEnd + 1);
  const returnMatch = [...functionSource.matchAll(/\n(\s*)return [^\n]+/g)].at(-1);

  if (!returnMatch || returnMatch.index === undefined) {
    throw new Error("Could not find the final return statement in didFinishLaunchingWithOptions.");
  }

  const indent = returnMatch[1];
  const injection =
    `\n${indent}if let shortcutItem = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem,\n` +
    `${indent}   handleShortcutItem(shortcutItem) {\n` +
    `${indent}  return false\n` +
    `${indent}}\n`;
  const insertIndex = functionStart + returnMatch.index;

  return `${source.slice(0, insertIndex)}${injection}${source.slice(insertIndex)}`;
}

function injectQuickActionHandlerMethods(source: string): string {
  const appDelegateClassIndex = source.search(/\bclass\s+AppDelegate\s*:/);

  if (appDelegateClassIndex === -1) {
    throw new Error("Could not locate the AppDelegate class declaration.");
  }

  const appDelegateBraceStart = source.indexOf("{", appDelegateClassIndex);

  if (appDelegateBraceStart === -1) {
    throw new Error("Could not locate the AppDelegate class opening brace.");
  }

  const appDelegateBraceEnd = findMatchingBrace(source, appDelegateBraceStart);
  const appDelegateSource = source.slice(appDelegateClassIndex, appDelegateBraceEnd + 1);

  if (appDelegateSource.includes("performActionFor shortcutItem: UIApplicationShortcutItem")) {
    return source;
  }

  const methods = [
    "",
    "  public override func application(",
    "    _ application: UIApplication,",
    "    performActionFor shortcutItem: UIApplicationShortcutItem,",
    "    completionHandler: @escaping (Bool) -> Void",
    "  ) {",
    "    completionHandler(handleShortcutItem(shortcutItem))",
    "  }",
    "",
    "  private func handleShortcutItem(_ shortcutItem: UIApplicationShortcutItem) -> Bool {",
    '    guard let url = shortcutItem.userInfo?["url"] as? String else {',
    "      return false",
    "    }",
    "",
    "    ReactNativeAppIntents.recordIncomingURLString(url)",
    "    return true",
    "  }",
  ].join("\n");

  return `${source.slice(0, appDelegateBraceEnd)}${methods}${source.slice(appDelegateBraceEnd)}`;
}

function findMatchingBrace(source: string, braceStart: number): number {
  let depth = 0;

  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error("Could not find the matching closing brace in AppDelegate.swift.");
}

const withReactNativeAppIntents = createRunOncePlugin(
  withReactNativeAppIntentsBase,
  EXPO_PLUGIN_PACKAGE_NAME,
  "0.0.0",
);

export default withReactNativeAppIntents;
