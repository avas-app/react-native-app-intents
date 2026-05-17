import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  defineAppIntentsConfig,
  generateAppIntents,
} from "@crockalet/react-native-app-intents/codegen";

import {
  applyEntitlementsAppIntentsConfig,
  applyInfoPlistAppIntentsConfig,
  patchSwiftAppDelegate,
  resolveExpoAppIntentsPluginOptions,
  resolveExpoCodegenConfig,
  withAppIntents,
} from "../src/index.js";

test("withAppIntents appends a plugin tuple", () => {
  const config = withAppIntents(
    { name: "example-app" },
    { intents: ["src/**/*.intents.ts"], scheme: "example" },
  );

  assert.deepEqual(config.plugins, [
    [
      "@crockalet/react-native-app-intents",
      { intents: ["src/**/*.intents.ts"], scheme: "example" },
    ],
  ]);
});

test("patchSwiftAppDelegate injects quick action forwarding idempotently", () => {
  const source = [
    "import Expo",
    "import UIKit",
    "",
    "@UIApplicationMain",
    "class AppDelegate: ExpoAppDelegate {",
    "  func application(",
    "    _ application: UIApplication,",
    "    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil",
    "  ) -> Bool {",
    "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
    "  }",
    "}",
    "",
  ].join("\n");

  const patched = patchSwiftAppDelegate(source);

  assert.match(patched, /import ReactNativeAppIntents/);
  assert.match(patched, /launchOptions\?\[\.shortcutItem\] as\? UIApplicationShortcutItem/);
  assert.match(patched, /performActionFor shortcutItem: UIApplicationShortcutItem/);
  assert.equal(patchSwiftAppDelegate(patched), patched);
});

test("patchSwiftAppDelegate keeps Expo quick action handlers in AppDelegate", () => {
  const source = [
    "internal import Expo",
    "import React",
    "import ReactAppDependencyProvider",
    "",
    "@main",
    "class AppDelegate: ExpoAppDelegate {",
    "  var window: UIWindow?",
    "",
    "  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?",
    "  var reactNativeFactory: RCTReactNativeFactory?",
    "",
    "  public override func application(",
    "    _ application: UIApplication,",
    "    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil",
    "  ) -> Bool {",
    "    let delegate = ReactNativeDelegate()",
    "    let factory = ExpoReactNativeFactory(delegate: delegate)",
    "    delegate.dependencyProvider = RCTAppDependencyProvider()",
    "",
    "    reactNativeDelegate = delegate",
    "    reactNativeFactory = factory",
    "",
    "    window = UIWindow(frame: UIScreen.main.bounds)",
    "    factory.startReactNative(",
    '      withModuleName: "main",',
    "      in: window,",
    "      launchOptions: launchOptions)",
    "",
    "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
    "  }",
    "}",
    "",
    "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {",
    "  override func sourceURL(for bridge: RCTBridge) -> URL? {",
    "    bridge.bundleURL ?? bundleURL()",
    "  }",
    "",
    "  override func bundleURL() -> URL? {",
    "    #if DEBUG",
    '    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")',
    "    #else",
    '    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")',
    "    #endif",
    "  }",
    "}",
    "",
  ].join("\n");

  const output = patchSwiftAppDelegate(source);

  assert.equal(output.match(/import ReactNativeAppIntents/g)?.length, 1);
  assert.match(
    output,
    /if let shortcutItem = launchOptions\?\[\.shortcutItem\] as\? UIApplicationShortcutItem/,
  );
  assert.match(
    output,
    /class AppDelegate[\s\S]*performActionFor shortcutItem: UIApplicationShortcutItem/,
  );
  assert.match(output, /class AppDelegate[\s\S]*private func handleShortcutItem\(/);
  assert.doesNotMatch(output, /class ReactNativeDelegate[\s\S]*private func handleShortcutItem\(/);
  assert.match(
    output,
    /class AppDelegate[\s\S]*private func handleShortcutItem\([\s\S]*class ReactNativeDelegate:/,
  );
});

test("Expo config helpers patch Info.plist and entitlements", () => {
  const options = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "expoexample",
    ios: {
      output: "ios/AppIntents/GeneratedAppIntents.swift",
      appGroupIdentifier: "group.dev.expo.example",
      siriUsageDescription: "Used to let Siri run app actions.",
    },
  });

  const infoPlist = applyInfoPlistAppIntentsConfig({}, options);
  const entitlements = applyEntitlementsAppIntentsConfig({}, options);

  assert.deepEqual(infoPlist.CFBundleURLTypes, [
    {
      CFBundleURLSchemes: ["expoexample"],
    },
  ]);
  assert.equal(infoPlist.ReactNativeAppIntentsAppGroupIdentifier, "group.dev.expo.example");
  assert.equal(infoPlist.NSSiriUsageDescription, "Used to let Siri run app actions.");
  assert.deepEqual(entitlements["com.apple.security.application-groups"], [
    "group.dev.expo.example",
  ]);
});

test("expo plugin auto-loads app-intents.config.ts by default", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-expo-config-"));

  try {
    await writeFile(
      join(cwd, "app-intents.config.ts"),
      [
        'const intents: string[] = ["src/**/*.intents.ts"];',
        "",
        "export default {",
        "  intents,",
        '  scheme: "expoexample",',
        "  ios: {",
        '    output: "ios/ExpoExample/AppIntents.swift",',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const options = await resolveExpoAppIntentsPluginOptions(undefined, cwd);

    assert.deepEqual(options.intents, ["src/**/*.intents.ts"]);
    assert.equal(options.scheme, "expoexample");
    assert.equal(options.ios?.output, "ios/ExpoExample/AppIntents.swift");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("expo plugin supports configPath with inline overrides", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-expo-config-path-"));

  try {
    await mkdir(join(cwd, "config"), { recursive: true });
    await writeFile(
      join(cwd, "config/app-intents.config.ts"),
      [
        "export default {",
        '  intents: "src/**/*.intents.ts",',
        '  scheme: "fromfile",',
        "  ios: {",
        '    output: "ios/FromFile.swift",',
        '    siriUsageDescription: "From file.",',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const options = await resolveExpoAppIntentsPluginOptions(
      {
        configPath: "config/app-intents.config.ts",
        scheme: "fromplugin",
        ios: { output: "ios/FromPlugin.swift" },
      },
      cwd,
    );

    assert.deepEqual(options.intents, ["src/**/*.intents.ts"]);
    assert.equal(options.scheme, "fromplugin");
    assert.equal(options.ios?.output, "ios/FromPlugin.swift");
    assert.equal(options.ios?.siriUsageDescription, "From file.");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("expo plugin preserves configured native output paths", () => {
  const options = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "expoexample",
    ios: {
      output: "ios/Generated/ExpoAppIntents.swift",
      appGroupIdentifier: "group.dev.expo.example",
    },
    android: {
      manifest: "android/custom/AndroidManifest.xml",
      packageName: "dev.expo.example.config",
      shortcutsOutput: "android/custom/res/xml/expo_shortcuts.xml",
      shortcutsStringsOutput: "android/custom/res/values/expo_shortcuts_strings.xml",
    },
  });

  const iosConfig = resolveExpoCodegenConfig(
    { name: "expo-app", slug: "expo-app", ios: { bundleIdentifier: "dev.expo.example" } },
    options,
    "/tmp/expo-app",
    "ios",
    "ExpoApp",
  );
  const androidConfig = resolveExpoCodegenConfig(
    { name: "expo-app", slug: "expo-app", android: { package: "dev.expo.example" } },
    options,
    "/tmp/expo-app",
    "android",
  );

  assert.equal(iosConfig.ios?.output, "ios/Generated/ExpoAppIntents.swift");
  assert.equal(iosConfig.ios?.bundleIdentifier, "dev.expo.example");
  assert.equal(androidConfig.android?.manifest, "android/custom/AndroidManifest.xml");
  assert.equal(androidConfig.android?.shortcutsOutput, "android/custom/res/xml/expo_shortcuts.xml");
  assert.equal(
    androidConfig.android?.shortcutsStringsOutput,
    "android/custom/res/values/expo_shortcuts_strings.xml",
  );
  assert.equal(androidConfig.android?.packageName, "dev.expo.example.config");
});

test("expo plugin config drives codegen on expo-style paths", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-expo-"));

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "android/app/src/main"), { recursive: true });
    await writeFile(
      join(cwd, "src/orders.intents.ts"),
      [
        'import { defineIntent, p } from "@crockalet/react-native-app-intents";',
        "",
        "export const openOrder = defineIntent({",
        '  id: "openOrder",',
        '  title: "Open Order",',
        '  phrases: ["Open order ${orderNumber} in ${.applicationName}"],',
        "  params: {",
        '    orderNumber: p.string({ default: "1234" }),',
        "  },",
        "  surfaces: {",
        "    appShortcut: true,",
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(cwd, "android/app/src/main/AndroidManifest.xml"),
      [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        "  <application>",
        '    <activity android:name=".MainActivity">',
        "    </activity>",
        "  </application>",
        "</manifest>",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = withAppIntents(
      { name: "expo-app" },
      {
        intents: ["src/**/*.intents.ts"],
        scheme: "expoexample",
        ios: { output: "ios/Generated/ExpoAppIntents.swift" },
        android: {
          manifest: "android/app/src/main/AndroidManifest.xml",
          packageName: "dev.expo.example",
          shortcutsOutput: "android/app/src/main/res/xml/expo_shortcuts.xml",
        },
        types: { output: "src/generated/app-intents.d.ts" },
      },
    );
    const pluginEntry = config.plugins?.[0];

    assert.ok(Array.isArray(pluginEntry));

    const result = await generateAppIntents(
      defineAppIntentsConfig(pluginEntry?.[1] as Parameters<typeof defineAppIntentsConfig>[0]),
      { cwd },
    );

    await access(join(cwd, "ios/Generated/ExpoAppIntents.swift"));
    await access(join(cwd, "android/app/src/main/res/values/expo_shortcuts_strings.xml"));
    const generatedTypes = await readFile(join(cwd, "src/generated/app-intents.d.ts"), "utf8");
    const generatedManifest = await readFile(
      join(cwd, "android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );

    assert.equal(result.artifacts.length, 4);
    assert.match(generatedTypes, /GeneratedAppIntentEvent/);
    assert.match(generatedManifest, /android:launchMode="singleTask"/);
    assert.match(generatedManifest, /android:scheme="expoexample"/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
