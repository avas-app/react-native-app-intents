import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { defineAppIntentsConfig, generateAppIntents } from "../src/codegen/index.js";
import {
  collectProjectLocales,
  defineIntent,
  normalizeIntentDefinitions,
  normalizeLocaleTag,
  p,
  resolveLocalizedText,
  toAndroidValuesQualifier,
  toAppleLprojDirectoryName,
} from "../src/core/index.js";

const execFile = promisify(execFileCallback);

test("normalizeLocaleTag canonicalizes separators and casing", () => {
  assert.equal(normalizeLocaleTag("EN"), "en");
  assert.equal(normalizeLocaleTag("pt_br"), "pt-BR");
  assert.equal(normalizeLocaleTag("PT-br"), "pt-BR");
  assert.equal(normalizeLocaleTag("zh-hans"), "zh-Hans");
  assert.equal(normalizeLocaleTag("zh-hant-tw"), "zh-Hant-TW");
});

test("toAndroidValuesQualifier maps locales onto resource directories", () => {
  assert.equal(toAndroidValuesQualifier("en", "en"), "values");
  assert.equal(toAndroidValuesQualifier("fr", "en"), "values-fr");
  assert.equal(toAndroidValuesQualifier("pt-BR", "en"), "values-pt-rBR");
  assert.equal(toAndroidValuesQualifier("zh-Hans", "en"), "values-b+zh+Hans");
  assert.equal(toAndroidValuesQualifier("en", "fr"), "values-en");
});

test("toAppleLprojDirectoryName uses canonical BCP 47 tags", () => {
  assert.equal(toAppleLprojDirectoryName("fr"), "fr.lproj");
  assert.equal(toAppleLprojDirectoryName("pt_br"), "pt-BR.lproj");
});

test("resolveLocalizedText walks the locale fallback chain", () => {
  const value = { en: "Open Order", fr: "Ouvrir la commande" };

  assert.equal(resolveLocalizedText(value, "fallback", { locale: "fr" }), "Ouvrir la commande");
  assert.equal(resolveLocalizedText(value, "fallback", { locale: "fr-CA" }), "Ouvrir la commande");
  assert.equal(resolveLocalizedText(value, "fallback", { locale: "de" }), "Open Order");
  assert.equal(
    resolveLocalizedText({ de: "Bestellung" }, "fallback", { locale: "fr", defaultLocale: "de" }),
    "Bestellung",
  );
  assert.equal(resolveLocalizedText(undefined, "fallback"), "fallback");
  assert.equal(resolveLocalizedText("plain", "fallback", { locale: "fr" }), "plain");
});

test("collectProjectLocales gathers every declared locale with the default first", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: { en: "Open Order", fr: "Ouvrir la commande" },
    phrases: { en: ["Open ${.applicationName}"], de: ["Öffne ${.applicationName}"] },
    params: {
      orderNumber: p.string({ title: { en: "Order number", "pt-BR": "Número do pedido" } }),
    },
  });

  assert.deepEqual(collectProjectLocales([openOrder]), ["en", "de", "fr", "pt-BR"]);
  assert.deepEqual(collectProjectLocales([openOrder], { defaultLocale: "fr" }), [
    "fr",
    "de",
    "en",
    "pt-BR",
  ]);
});

test("normalizeIntentDefinitions requires the app name token in translated phrases", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: { en: "Open Order", fr: "Ouvrir la commande" },
    phrases: { en: ["Open order in ${.applicationName}"], fr: ["Ouvrir la commande"] },
    params: {},
    surfaces: { appShortcut: true },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /Phrase "Ouvrir la commande" \(locale "fr"\) must include \$\{\.applicationName\}/,
  );
});

test("normalizeIntentDefinitions rejects phrase lists that differ in length", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    phrases: {
      en: ["Open order in ${.applicationName}", "Show order in ${.applicationName}"],
      fr: ["Ouvrir la commande dans ${.applicationName}"],
    },
    params: {},
    surfaces: { appShortcut: true },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /Locale "fr" declares 1 phrase but the default locale "en" declares 2/,
  );
});

test("normalizeIntentDefinitions resolves metadata for the configured default locale", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: { en: "Open Order", fr: "Ouvrir la commande" },
    description: { en: "Open an order.", fr: "Ouvrir une commande." },
    params: {
      orderNumber: p.string({ title: { en: "Order number", fr: "Numéro de commande" } }),
    },
  });

  const [normalized] = normalizeIntentDefinitions([openOrder], { defaultLocale: "fr" });

  assert.equal(normalized?.title, "Ouvrir la commande");
  assert.equal(normalized?.description, "Ouvrir une commande.");
  assert.equal(normalized?.params[0]?.title, "Numéro de commande");
});

const LOCALIZED_INTENTS_SOURCE = [
  'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
  "",
  "const Order = defineEntity({",
  '  id: "Order",',
  '  title: { en: "Order", fr: "Commande" },',
  '  inventory: [{ id: 1, number: "1234" }],',
  "  schema: p.object({ id: p.int(), number: p.string() }),",
  "  identifier: (order) => String(order.id),",
  "  displayRepresentation: (order) => ({ title: `Order #${order.number}` }),",
  "});",
  "",
  "export const openOrder = defineIntent({",
  '  id: "openOrder",',
  '  title: { en: "Open Order", fr: "Ouvrir la commande" },',
  '  description: { en: "Open a specific order.", fr: "Ouvrir une commande." },',
  "  phrases: {",
  '    en: ["Open order ${orderNumber} in ${.applicationName}"],',
  '    fr: ["Ouvrir la commande ${orderNumber} dans ${.applicationName}"],',
  "  },",
  "  params: {",
  "    orderNumber: p.string({",
  '      androidBiiParam: "order",',
  '      default: "1234",',
  '      title: { en: "Order number", fr: "Numéro de commande" },',
  '      requestValueDialog: { en: "Which order?", fr: "Quelle commande ?" },',
  "    }),",
  "  },",
  "  surfaces: { appShortcut: true },",
  '  android: { appAction: { capability: "actions.intent.GET_ORDER" } },',
  "});",
  "",
  "export const openSavedOrder = defineIntent({",
  '  id: "openSavedOrder",',
  '  title: { en: "Open Saved Order", fr: "Ouvrir la commande enregistrée" },',
  "  phrases: {",
  '    en: ["Open ${order} in ${.applicationName}"],',
  '    fr: ["Ouvrir ${order} dans ${.applicationName}"],',
  "  },",
  "  params: {",
  '    order: p.entity(Order, { androidBiiParam: "order", default: { id: 1, number: "1234" } }),',
  "  },",
  "  surfaces: { appShortcut: true },",
  '  android: { appAction: { capability: "actions.intent.GET_ORDER" } },',
  "});",
  "",
  "export const checkDelivery = defineIntent({",
  '  id: "checkDelivery",',
  '  title: { en: "Check Delivery", fr: "Vérifier la livraison" },',
  "  params: {},",
  "  ios: {",
  "    appIntent: {",
  '      response: { dialog: { en: "Checking delivery.", fr: "Vérification de la livraison." } },',
  "    },",
  "  },",
  "});",
  "",
].join("\n");

const ANDROID_MANIFEST_SOURCE = [
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
  "  <application>",
  '    <activity android:name=".MainActivity">',
  "    </activity>",
  "  </application>",
  "</manifest>",
  "",
].join("\n");

async function createLocalizedProject(prefix: string): Promise<string> {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, prefix));

  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "android/app/src/main"), { recursive: true });
  await writeFile(join(cwd, "src/orders.intents.ts"), LOCALIZED_INTENTS_SOURCE, "utf8");
  await writeFile(
    join(cwd, "android/app/src/main/AndroidManifest.xml"),
    ANDROID_MANIFEST_SOURCE,
    "utf8",
  );

  return cwd;
}

test("generateAppIntents emits per-locale string tables for iOS and Android", async () => {
  const cwd = await createLocalizedProject(".tmp-l10n-");
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    ios: { output: "ios/AppIntents/GeneratedAppIntents.swift" },
    android: {
      manifest: "android/app/src/main/AndroidManifest.xml",
      packageName: "com.example.app",
      shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    },
  });

  try {
    const result = await generateAppIntents(config, { cwd });

    assert.ok(
      result.diagnostics?.some((diagnostic) =>
        diagnostic.includes('Localization enabled: default locale "en", translations for fr'),
      ),
    );

    const generatedSwift = await readFile(
      join(cwd, "ios/AppIntents/GeneratedAppIntents.swift"),
      "utf8",
    );
    const frenchStrings = await readFile(
      join(cwd, "ios/AppIntents/fr.lproj/AppIntents.strings"),
      "utf8",
    );
    const englishStrings = await readFile(
      join(cwd, "ios/AppIntents/en.lproj/AppIntents.strings"),
      "utf8",
    );
    const frenchPhrases = await readFile(
      join(cwd, "ios/AppIntents/fr.lproj/AppShortcuts.strings"),
      "utf8",
    );
    const frenchAndroidStrings = await readFile(
      join(cwd, "android/app/src/main/res/values-fr/app_intents_shortcuts_strings.xml"),
      "utf8",
    );
    const defaultAndroidStrings = await readFile(
      join(cwd, "android/app/src/main/res/values/app_intents_shortcuts_strings.xml"),
      "utf8",
    );

    // Swift routes localizable text through keys in a dedicated table, keeping the default-locale
    // value inline so the generated source still works with no bundled translations.
    assert.match(
      generatedSwift,
      /static let title: LocalizedStringResource = LocalizedStringResource\("intent\.openOrder\.title", defaultValue: "Open Order", table: "AppIntents"\)/,
    );
    assert.match(
      generatedSwift,
      /IntentDescription\(LocalizedStringResource\("intent\.openOrder\.description", defaultValue: "Open a specific order\.", table: "AppIntents"\)\)/,
    );
    assert.match(
      generatedSwift,
      /requestValueDialog: IntentDialog\(LocalizedStringResource\("intent\.openOrder\.parameter\.orderNumber\.requestValueDialog", defaultValue: "Which order\?", table: "AppIntents"\)\)/,
    );
    assert.match(
      generatedSwift,
      /TypeDisplayRepresentation\(name: LocalizedStringResource\("entity\.Order\.title", defaultValue: "Order", table: "AppIntents"\)\)/,
    );
    assert.match(
      generatedSwift,
      /return \.result\(dialog: IntentDialog\(LocalizedStringResource\("intent\.checkDelivery\.dialog", defaultValue: "Checking delivery\.", table: "AppIntents"\)\)\)/,
    );

    assert.match(frenchStrings, /"intent\.openOrder\.title" = "Ouvrir la commande";/);
    assert.match(frenchStrings, /"intent\.openOrder\.description" = "Ouvrir une commande\.";/);
    assert.match(
      frenchStrings,
      /"intent\.openOrder\.parameter\.orderNumber\.title" = "Numéro de commande";/,
    );
    assert.match(frenchStrings, /"entity\.Order\.title" = "Commande";/);
    assert.match(
      frenchStrings,
      /"intent\.checkDelivery\.dialog" = "Vérification de la livraison\.";/,
    );
    assert.match(englishStrings, /"intent\.openOrder\.title" = "Open Order";/);

    // Phrase keys mirror the Swift literal exactly: non-entity placeholders are dropped and the
    // app name token is spelled the way Apple's AppShortcuts.strings expects.
    assert.match(
      frenchPhrases,
      /"Open order in \$\{applicationName\}" = "Ouvrir la commande dans \$\{applicationName\}";/,
    );
    assert.match(
      frenchPhrases,
      /"Open \$\{order\} in \$\{applicationName\}" = "Ouvrir \$\{order\} dans \$\{applicationName\}";/,
    );

    assert.match(
      frenchAndroidStrings,
      /<string name="react_native_app_intents_open_order_short_label">Ouvrir la commande<\/string>/,
    );
    assert.match(
      frenchAndroidStrings,
      /<string name="react_native_app_intents_open_order_long_label">Ouvrir une commande\.<\/string>/,
    );
    assert.match(
      defaultAndroidStrings,
      /<string name="react_native_app_intents_open_order_short_label">Open Order<\/string>/,
    );

    const checkResult = await generateAppIntents(config, { check: true, cwd });

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

test("generateAppIntents honors a non-English default locale", async () => {
  const cwd = await createLocalizedProject(".tmp-l10n-default-");
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    localization: { defaultLocale: "fr" },
    android: {
      manifest: "android/app/src/main/AndroidManifest.xml",
      packageName: "com.example.app",
      shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    },
  });

  try {
    await generateAppIntents(config, { cwd });

    const defaultAndroidStrings = await readFile(
      join(cwd, "android/app/src/main/res/values/app_intents_shortcuts_strings.xml"),
      "utf8",
    );
    const englishAndroidStrings = await readFile(
      join(cwd, "android/app/src/main/res/values-en/app_intents_shortcuts_strings.xml"),
      "utf8",
    );

    assert.match(
      defaultAndroidStrings,
      /<string name="react_native_app_intents_open_order_short_label">Ouvrir la commande<\/string>/,
    );
    assert.match(
      englishAndroidStrings,
      /<string name="react_native_app_intents_open_order_short_label">Open Order<\/string>/,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("generateAppIntents writes .lproj tables to a configured resources directory", async () => {
  const cwd = await createLocalizedProject(".tmp-l10n-resources-");
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    ios: { output: "ios/Generated/AppIntents.swift" },
    localization: { iosResourcesDirectory: "ios/Example/Resources" },
  });

  try {
    await generateAppIntents(config, { cwd });

    const frenchStrings = await readFile(
      join(cwd, "ios/Example/Resources/fr.lproj/AppIntents.strings"),
      "utf8",
    );

    assert.match(frenchStrings, /"intent\.openOrder\.title" = "Ouvrir la commande";/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("codegen diagnostics point at the file and line of the failing declaration", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-l10n-errors-"));
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    types: { output: "src/generated/app-intents.d.ts" },
  });

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/orders.intents.ts"),
      [
        'import { defineIntent, p } from "@avasapp/react-native-app-intents";',
        "",
        "export const openOrder = defineIntent({",
        '  id: "openOrder",',
        '  title: "Open Order",',
        '  phrases: ["Open order ${missingParam} in ${.applicationName}"],',
        "  params: {",
        "    orderNumber: p.string(),",
        "  },",
        "  surfaces: { appShortcut: true },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    await assert.rejects(
      () => generateAppIntents(config, { cwd }),
      (error: Error) =>
        /src\/orders\.intents\.ts:3:1 \[openOrder\] Phrase ".+" references unknown placeholder "missingParam"\./.test(
          error.message,
        ),
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("codegen reports the file that failed to load", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-l10n-load-"));
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
  });

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/broken.intents.ts"),
      'throw new Error("module side effect exploded");\n',
      "utf8",
    );

    await assert.rejects(
      () => generateAppIntents(config, { cwd }),
      /Failed to load intent module src\/broken\.intents\.ts: module side effect exploded/,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("codegen explains why no intents were discovered", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-l10n-empty-"));
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
  });

  try {
    await mkdir(join(cwd, "src"), { recursive: true });

    await assert.rejects(
      () => generateAppIntents(config, { cwd }),
      /No intent definitions were found for the configured patterns \(src\/\*\*\/\*\.intents\.ts\)/,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
