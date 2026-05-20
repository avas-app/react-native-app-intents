import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { defineAppIntentsConfig, generateAppIntents } from "../src/index.js";

const execFile = promisify(execFileCallback);

test("generateAppIntents writes bare RN artifacts from intent definitions", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-codegen-"));
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    ios: {
      output: "ios/AppIntents/GeneratedAppIntents.swift",
      appGroupIdentifier: "group.com.avasapp.appintents.example",
    },
    android: {
      manifest: "android/app/src/main/AndroidManifest.xml",
      packageName: "com.avasapp.appintents.example",
      shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    },
    types: { output: "src/generated/app-intents.d.ts" },
  });

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "android/app/src/main"), { recursive: true });
    await writeFile(
      join(cwd, "src/orders.intents.ts"),
      [
        'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
        "",
        "const Order = defineEntity({",
        '  id: "Order",',
        '  title: "Order",',
        '  inventory: [{ id: 1, number: "1234", customer: "Taylor" }],',
        "  schema: p.object({",
        "    id: p.int(),",
        "    number: p.string(),",
        "    customer: p.string(),",
        "  }),",
        "  identifier: (order) => String(order.id),",
        "  displayRepresentation: (order) => ({",
        "    title: `Order #${order.number}`,",
        "    subtitle: order.customer,",
        '    image: { systemName: "bag" },',
        "  }),",
        "});",
        "",
        "export const openOrder = defineIntent({",
        '  id: "openOrder",',
        '  title: "Open Order",',
        '  description: "Open a specific order.",',
        '  phrases: ["Open order ${orderNumber} in ${.applicationName}", "Show my order ${orderNumber}"],',
        "  params: {",
        '    orderNumber: p.string({ androidBiiParam: "order", default: "1234", title: "Order Number" }),',
        "  },",
        "  surfaces: {",
        '    appShortcut: { icon: { androidResourceName: "@mipmap/ic_launcher_round", systemName: "shippingbox" } },',
        "  },",
        '  android: { appAction: { capability: "actions.intent.GET_ORDER" } },',
        "});",
        "",
        "export const openSavedOrder = defineIntent({",
        '  id: "openSavedOrder",',
        '  title: "Open Saved Order",',
        '  description: "Open a saved order.",',
        '  phrases: ["Open ${order} in ${.applicationName}"],',
        "  params: {",
        '    order: p.entity(Order, { androidBiiParam: "order", default: { id: 1, number: "1234", customer: "Taylor" }, title: "Order" }),',
        "  },",
        "  surfaces: {",
        "    appShortcut: true,",
        "  },",
        '  android: { appAction: { capability: "actions.intent.GET_ORDER" } },',
        "});",
        "",
        "export const checkDelivery = defineIntent({",
        '  id: "checkDelivery",',
        '  title: "Check Delivery",',
        "  params: {",
        "    deliveryWindow: p.object({",
        '      startDate: p.date({ title: "Start Date" }),',
        "      destination: p.object({",
        '        city: p.string({ optional: true, title: "City" }),',
        "      }),",
        "    }),",
        "  },",
        "  ios: {",
        '    appIntent: { response: { dialog: "Checking delivery window." } },',
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

    const result = await generateAppIntents(config, { cwd });
    const generatedSwift = await readFile(
      join(cwd, "ios/AppIntents/GeneratedAppIntents.swift"),
      "utf8",
    );
    const generatedShortcuts = await readFile(
      join(cwd, "android/app/src/main/res/xml/app_intents_shortcuts.xml"),
      "utf8",
    );
    const generatedShortcutStrings = await readFile(
      join(cwd, "android/app/src/main/res/values/app_intents_shortcuts_strings.xml"),
      "utf8",
    );
    const generatedTypes = await readFile(join(cwd, "src/generated/app-intents.d.ts"), "utf8");
    const generatedManifest = await readFile(
      join(cwd, "android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );

    assert.equal(result.artifacts.length, 4);
    assert.deepEqual(result.diagnostics, [
      "Android App Actions configured: openOrder: actions.intent.GET_ORDER (deeplink, static inventory); openSavedOrder: actions.intent.GET_ORDER (deeplink, static inventory)",
      "Verified App Links, Play Console setup, and any Assistant review steps remain manual Android setup tasks.",
      "iOS App Intents configured: checkDelivery",
      "Generated Siri/App Intent dialogs are static only in the current iOS slice; dynamic native dialog flows remain manual work.",
    ]);
    assert.match(generatedSwift, /struct OrderAppEntity: AppEntity/);
    assert.match(generatedSwift, /struct OrderEntityQuery: EntityQuery, EntityStringQuery/);
    assert.match(generatedSwift, /struct OpenOrderIntent: AppIntent/);
    assert.match(generatedSwift, /struct OpenSavedOrderIntent: AppIntent/);
    assert.match(generatedSwift, /struct CheckDeliveryIntent: AppIntent/);
    assert.match(generatedSwift, /struct GeneratedAppShortcuts: AppShortcutsProvider/);
    assert.match(generatedSwift, /enqueueReactNativeAppIntentURL/);
    assert.match(generatedSwift, /static var parameterSummary: some ParameterSummary/);
    assert.match(
      generatedSwift,
      /private let reactNativeAppIntentsAppGroupIdentifier: String\? = "group\.com\.avasapp\.appintents\.example"/,
    );
    assert.match(generatedSwift, /defaults\.synchronize\(\)/);
    assert.match(
      generatedSwift,
      /private func reactNativeAppIntentsJSONString\(_ payload: \[String: Any\]\) throws -> String/,
    );
    assert.match(generatedSwift, /Open \\\(\\\.\$order\) in \\\(.applicationName\)/);
    assert.match(generatedSwift, /var deliveryWindow__startDate: Date/);
    assert.match(generatedSwift, /var deliveryWindow__destination__city: String\?/);
    assert.match(generatedSwift, /var deliveryWindowPayload: \[String: Any\] = \[:\]/);
    assert.match(
      generatedSwift,
      /return \.result\(dialog: IntentDialog\("Checking delivery window\."\)\)/,
    );
    assert.match(generatedSwift, /systemImageName: "shippingbox"/);
    assert.match(generatedSwift, /systemImageName: "square\.grid\.2x2"/);
    assert.match(generatedShortcuts, /android:shortcutId="openOrder"/);
    assert.match(generatedShortcuts, /android:icon="@mipmap\/ic_launcher_round"/);
    assert.match(generatedShortcuts, /<capability android:name="actions.intent.GET_ORDER">/);
    assert.match(generatedShortcuts, /<parameter android:name="order" \/>/);
    assert.match(generatedShortcuts, /android:shortcutId="openSavedOrder_Order_1"/);
    assert.match(generatedShortcuts, /<capability-binding android:key="actions.intent.GET_ORDER">/);
    assert.match(
      generatedShortcuts,
      /android:shortcutShortLabel="@string\/react_native_app_intents_open_order_short_label"/,
    );
    assert.match(generatedShortcuts, /example:\/\/app-intents\/openSavedOrder\?payload=/);
    assert.match(generatedShortcuts, /android:icon="@mipmap\/ic_launcher"/);
    assert.match(
      generatedShortcutStrings,
      /<string name="react_native_app_intents_open_order_short_label">Open Order<\/string>/,
    );
    assert.match(
      generatedShortcutStrings,
      /<string name="react_native_app_intents_open_saved_order_order_1_short_label">Order #1234<\/string>/,
    );
    assert.match(generatedTypes, /GeneratedAppIntentEvent/);
    assert.match(
      generatedTypes,
      /\/\*\*\n \* Generated intent definitions in codegen discovery order\.\n \*\//,
    );
    assert.match(
      generatedTypes,
      /\/\*\*\n   \* Check Delivery\n   \*\/\n  checkDelivery: ParamsOf<typeof Intent0>/,
    );
    assert.match(
      generatedTypes,
      /\/\*\*\n   \* Open Saved Order\n   \* Open a saved order\.\n   \*\/\n  openSavedOrder: ParamsOf<typeof Intent2>/,
    );
    assert.match(generatedTypes, /checkDelivery: ParamsOf<typeof Intent0>/);
    assert.match(generatedTypes, /openSavedOrder: ParamsOf<typeof Intent2>/);
    assert.match(generatedManifest, /android\.app\.shortcuts/);
    assert.match(generatedManifest, /android:launchMode="singleTask"/);
    assert.match(generatedManifest, /android:scheme="example"/);

    const checkResult = await generateAppIntents(config, { check: true, cwd });

    assert.ok(
      checkResult.diagnostics?.some((diagnostic) =>
        diagnostic.includes("Android App Actions configured: openOrder"),
      ),
    );
    assert.ok(
      checkResult.diagnostics?.some((diagnostic) =>
        diagnostic.includes("iOS App Intents configured: checkDelivery"),
      ),
    );
    assert.equal(checkResult.message, "Generated artifacts are up to date.");

    if (process.platform === "darwin") {
      await execFile("xcrun", [
        "--sdk",
        "iphonesimulator",
        "swiftc",
        "-typecheck",
        "-target",
        "arm64-apple-ios16.0-simulator",
        join(cwd, "ios/AppIntents/GeneratedAppIntents.swift"),
      ]);
    }
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("generateAppIntents preserves existing Android deep link filters", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-codegen-links-"));
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "avas-app",
    android: {
      manifest: "android/app/src/main/AndroidManifest.xml",
      packageName: "com.example.avas",
      shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    },
  });

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "android/app/src/main"), { recursive: true });
    await writeFile(
      join(cwd, "src/orders.intents.ts"),
      [
        'import { defineIntent, p } from "@avasapp/react-native-app-intents";',
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
        '    <activity android:name=".MainActivity" android:launchMode="singleTask">',
        "      <intent-filter>",
        '        <action android:name="android.intent.action.MAIN" />',
        '        <category android:name="android.intent.category.LAUNCHER" />',
        "      </intent-filter>",
        "      <intent-filter>",
        '        <action android:name="android.intent.action.VIEW" />',
        '        <category android:name="android.intent.category.DEFAULT" />',
        '        <category android:name="android.intent.category.BROWSABLE" />',
        '        <data android:scheme="avas-app" android:host="web" />',
        "      </intent-filter>",
        "      <intent-filter>",
        '        <action android:name="android.intent.action.VIEW" />',
        '        <category android:name="android.intent.category.DEFAULT" />',
        '        <category android:name="android.intent.category.BROWSABLE" />',
        '        <data android:scheme="exp+avas-app" android:host="expo-development-client" />',
        "      </intent-filter>",
        "    </activity>",
        '    <activity android:name=".OtherActivity">',
        "      <intent-filter>",
        '        <action android:name="android.intent.action.VIEW" />',
        '        <category android:name="android.intent.category.DEFAULT" />',
        '        <category android:name="android.intent.category.BROWSABLE" />',
        '        <data android:scheme="other" android:host="app-intents" />',
        "      </intent-filter>",
        "    </activity>",
        "  </application>",
        "</manifest>",
        "",
      ].join("\n"),
      "utf8",
    );

    await generateAppIntents(config, { cwd });
    const generatedManifest = await readFile(
      join(cwd, "android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );

    assert.match(generatedManifest, /android:scheme="avas-app" android:host="web"/);
    assert.match(
      generatedManifest,
      /android:scheme="exp\+avas-app" android:host="expo-development-client"/,
    );
    assert.match(generatedManifest, /android:scheme="other" android:host="app-intents"/);
    assert.match(generatedManifest, /android:scheme="avas-app"[\s\S]*android:host="app-intents"/);
    assert.equal(generatedManifest.match(/android:host="app-intents"/g)?.length, 2);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
