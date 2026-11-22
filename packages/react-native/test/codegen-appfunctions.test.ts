import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { defineAppIntentsConfig, generateAppIntents } from "../src/codegen/index.js";
import { resolveExpoCodegenConfig } from "../src/expo-plugin/index.js";

const appFunctionsSource: string[] = [
  'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
  "",
  "const Order = defineEntity({",
  '  id: "Order",',
  '  title: "Order",',
  '  catalog: "runtime",',
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
  "  }),",
  "  android: { appFunctionQuery: true },",
  "});",
  "",
  "export const shipOrder = defineIntent({",
  '  id: "shipOrder",',
  '  title: "Ship Order",',
  '  description: "Ship a saved order.",',
  "  params: {",
  '    order: p.entity(Order, { title: "Order", prompt: "Which order?" }),',
  '    note: p.string({ optional: true, title: "Note", prompt: "Add a note." }),',
  '    count: p.int({ title: "Count" }),',
  '    weight: p.number({ title: "Weight" }),',
  '    rush: p.bool({ title: "Rush" }),',
  '    shipDate: p.date({ optional: true, title: "Ship Date" }),',
  "    address: p.object(",
  "      {",
  '        street: p.string({ title: "Street" }),',
  '        city: p.object({ name: p.string({ title: "City" }) }, { title: "City" }),',
  "      },",
  '      { title: "Address" },',
  "    ),",
  '    coupon: p.string({ default: "SAVE10", title: "Coupon" }),',
  "  },",
  "  android: { appFunction: { enabledByDefault: false } },",
  "  behavior: { opensAppToForeground: true },",
  "});",
  "",
  "export const notExposed = defineIntent({",
  '  id: "notExposed",',
  '  title: "Not Exposed",',
  "  params: { value: p.string() },",
  "});",
  "",
];

const appFunctionsOutput =
  "android/app/src/main/java/com/avasapp/appintents/example/appfunctions/AppFunctions.kt";

async function readFixture(name: string, actual: string): Promise<string> {
  const path = join(import.meta.dirname, "fixtures", name);

  if (process.env.UPDATE_FIXTURES === "1") {
    await writeFile(path, actual, "utf8");
    return actual;
  }

  return readFile(path, "utf8");
}

function appFunctionsConfig(options: { appMetadataInstructions?: string; serviceName?: string }) {
  return defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    android: {
      manifest: "android/app/src/main/AndroidManifest.xml",
      packageName: "com.avasapp.appintents.example",
      shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
      appFunctions: {
        output: appFunctionsOutput,
        ...(options.serviceName ? { serviceName: options.serviceName } : {}),
        ...(options.appMetadataInstructions
          ? { appMetadata: { instructions: options.appMetadataInstructions } }
          : {}),
      },
    },
  });
}

async function createProject(
  reactNativeRange = "0.88.1",
  source = appFunctionsSource.join("\n"),
): Promise<string> {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-codegen-appfunctions-"));

  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "android/app/src/main"), { recursive: true });
  await writeFile(join(cwd, "src/orders.intents.ts"), source, "utf8");
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
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      { name: "example", dependencies: { "react-native": reactNativeRange } },
      null,
      2,
    ),
    "utf8",
  );

  return cwd;
}

test("android.appFunctions generates the Kotlin service, app_metadata and manifest entries", async () => {
  const cwd = await createProject();

  try {
    const result = await generateAppIntents(
      appFunctionsConfig({ appMetadataInstructions: "Order tracking." }),
      { cwd },
    );
    const kotlin = await readFile(join(cwd, appFunctionsOutput), "utf8");
    const expected = await readFixture("appfunctions.kt", kotlin);
    const manifest = await readFile(join(cwd, "android/app/src/main/AndroidManifest.xml"), "utf8");
    const appMetadata = await readFile(
      join(cwd, "android/app/src/main/res/xml/app_metadata.xml"),
      "utf8",
    );

    assert.equal(kotlin, expected);
    assert.match(kotlin, /@AppFunctionServiceEntryPoint\(/);
    assert.match(
      kotlin,
      /abstract class BaseAppIntentsAppFunctionService : AppFunctionService\(\)/,
    );
    assert.match(kotlin, /@AppFunctionDeclaration\(isDescribedByKDoc = true, isEnabled = false\)/);
    assert.match(kotlin, /suspend fun shipOrder\(/);
    assert.match(kotlin, /suspend fun findOrders\(query: String\?\): List<OrderEntity>/);
    assert.match(kotlin, /ReactNativeAppIntentsAppFunctions\.deliver\(/);
    assert.match(kotlin, /"example",/);
    assert.match(kotlin, /object ReactNativeAppIntentsAppFunctionsBridge \{/);
    assert.match(kotlin, /fun setEnabled\(context: Context, intentId: String, enabled: Boolean\)/);
    assert.match(kotlin, /AppFunctionManager\.APP_FUNCTION_STATE_ENABLED/);
    assert.doesNotMatch(kotlin, /fun notExposed\(/);

    assert.match(manifest, /android:name="\.appfunctions\.AppIntentsAppFunctionService"/);
    assert.match(manifest, /android\.app\.appfunctions\.app_metadata/);
    assert.match(manifest, /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
    assert.match(manifest, /tools:targetApi="36"/);

    assert.match(appMetadata, /app:instructions="Order tracking\."/);

    const appFunctionArtifacts = result.artifacts.filter(
      (artifact) =>
        artifact.path.endsWith("AppFunctions.kt") || artifact.path.endsWith("app_metadata.xml"),
    );

    assert.equal(appFunctionArtifacts.length, 2);
    assert.ok(
      result.diagnostics?.some((diagnostic) =>
        diagnostic.includes('implementation("androidx.appfunctions:appfunctions:1.0.0")'),
      ),
    );

    const second = await generateAppIntents(
      appFunctionsConfig({ appMetadataInstructions: "Order tracking." }),
      { cwd, check: true },
    );

    assert.equal(second.changed, false);
    assert.match(
      second.diagnostics?.join("\n") ?? "",
      /AppFunctionManager|AppFunctions configured/,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("regenerating is idempotent for the manifest service and property", async () => {
  const cwd = await createProject();

  try {
    await generateAppIntents(appFunctionsConfig({}), { cwd });
    const first = await readFile(join(cwd, "android/app/src/main/AndroidManifest.xml"), "utf8");

    await generateAppIntents(appFunctionsConfig({}), { cwd });
    const second = await readFile(join(cwd, "android/app/src/main/AndroidManifest.xml"), "utf8");

    assert.equal(second, first);
    assert.equal(first.match(/BIND_APP_FUNCTION_SERVICE/g)?.length, 1);
    assert.equal(first.match(/android\.app\.appfunctions\.app_metadata/g)?.length, 1);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("a project without android.appFunctions generates no AppFunction artifacts", async () => {
  const cwd = await createProject();

  try {
    const manifestPath = join(cwd, "android/app/src/main/AndroidManifest.xml");

    await writeFile(
      manifestPath,
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n',
      "utf8",
    );

    const result = await generateAppIntents(
      defineAppIntentsConfig({
        intents: ["src/**/*.intents.ts"],
        scheme: "example",
        android: {
          manifest: "android/app/src/main/AndroidManifest.xml",
          packageName: "com.avasapp.appintents.example",
          shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
        },
      }),
      { cwd },
    );
    const manifest = await readFile(manifestPath, "utf8");

    assert.equal(
      result.artifacts.filter((artifact) => artifact.path.endsWith("AppFunctions.kt")).length,
      0,
    );
    assert.doesNotMatch(manifest, /appfunctions/);
    assert.ok(
      !(result.diagnostics ?? []).some((diagnostic) => diagnostic.includes("AppFunctions")),
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("codegen warns when the app's react-native is below 0.88", async () => {
  const cwd = await createProject("0.85.3");

  try {
    const result = await generateAppIntents(appFunctionsConfig({}), { cwd });

    assert.ok(
      result.diagnostics?.some((diagnostic) =>
        diagnostic.includes("require React Native 0.88 or newer"),
      ),
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

async function generateKotlinFromSource(source: readonly string[]): Promise<string> {
  const cwd = await createProject("0.88.1", source.join("\n"));

  try {
    await generateAppIntents(appFunctionsConfig({}), { cwd });
    return await readFile(join(cwd, appFunctionsOutput), "utf8");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
}

async function generateErrorMessage(source: readonly string[]): Promise<string> {
  const cwd = await createProject("0.88.1", source.join("\n"));

  try {
    await generateAppIntents(appFunctionsConfig({}), { cwd });
    throw new Error("expected generateAppIntents to throw");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
}

const shadowSource: string[] = [
  'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
  "",
  "const Order = defineEntity({",
  '  id: "Order",',
  '  title: "Order",',
  '  catalog: "runtime",',
  "  schema: p.object({ id: p.int(), json: p.string() }),",
  "  identifier: (order) => String(order.id),",
  "  displayRepresentation: (order) => ({ title: order.json }),",
  "  android: { appFunctionQuery: true },",
  "});",
  "",
  "export const shadow = defineIntent({",
  '  id: "shadow",',
  '  title: "Shadow",',
  "  params: {",
  "    payload: p.string(),",
  "    json: p.string(),",
  "    payloadJson: p.string(),",
  "    invocationId: p.string(),",
  "    order: p.entity(Order),",
  "  },",
  "  android: { appFunction: true },",
  "});",
  "",
];

test("generated Kotlin prefixes its locals so params and fields cannot shadow them", async () => {
  const kotlin = await generateKotlinFromSource(shadowSource);

  assert.match(kotlin, /val rnaiPayload = JSONObject\(\)/);
  assert.match(kotlin, /rnaiPayload\.put\("payload", payload\)/);
  assert.match(kotlin, /rnaiPayload\.put\("json", json\)/);
  assert.match(kotlin, /rnaiPayload\.put\("payloadJson", payloadJson\)/);
  assert.match(kotlin, /rnaiPayload\.put\("invocationId", invocationId\)/);
  assert.match(kotlin, /val rnaiPayloadJson = rnaiPayload\.toString\(\)/);
  assert.match(kotlin, /val rnaiInvocationId = ReactNativeAppIntentsAppFunctions\.deliver\(/);
  assert.match(kotlin, /val rnaiJson = JSONObject\(\)/);
  assert.match(kotlin, /rnaiJson\.put\("json", json\)/);

  assert.doesNotMatch(kotlin, /val payload = JSONObject\(\)/);
  assert.doesNotMatch(kotlin, /val json = JSONObject\(\)/);
  assert.doesNotMatch(kotlin, /val payloadJson = payload\.toString\(\)/);
  assert.doesNotMatch(kotlin, /val invocationId = ReactNativeAppIntentsAppFunctions/);
  assert.doesNotMatch(kotlin, /payload\.put\("payload"/);
});

const optionalParseSource: string[] = [
  'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
  "",
  "const Item = defineEntity({",
  '  id: "Item",',
  '  title: "Item",',
  '  catalog: "runtime",',
  "  schema: p.object({",
  "    id: p.int(),",
  "    note: p.string({ optional: true }),",
  "    count: p.int({ optional: true }),",
  "    meta: p.object({ tag: p.string() }, { optional: true }),",
  "  }),",
  "  identifier: (item) => String(item.id),",
  "  displayRepresentation: (item) => ({ title: `Item ${item.id}` }),",
  "  android: { appFunctionQuery: true },",
  "});",
  "",
  "export const useItem = defineIntent({",
  '  id: "useItem",',
  '  title: "Use Item",',
  "  params: { item: p.entity(Item) },",
  "  android: { appFunction: true },",
  "});",
  "",
];

test("parsers treat JSON null like missing for optional fields and drop bad rows", async () => {
  const kotlin = await generateKotlinFromSource(optionalParseSource);

  assert.match(kotlin, /private fun reactNativeAppIntentsParseItemEntity\(rnaiJson: JSONObject\)/);
  assert.match(kotlin, /id = rnaiJson\.getInt\("id"\)/);
  assert.match(
    kotlin,
    /note = if \(!rnaiJson\.isNull\("note"\)\) rnaiJson\.getString\("note"\) else null/,
  );
  assert.match(
    kotlin,
    /count = if \(!rnaiJson\.isNull\("count"\)\) rnaiJson\.getInt\("count"\) else null/,
  );
  assert.match(
    kotlin,
    /meta = if \(!rnaiJson\.isNull\("meta"\)\) reactNativeAppIntentsParseItemEntityMeta\(rnaiJson\.getJSONObject\("meta"\)\) else null/,
  );
  assert.match(
    kotlin,
    /\.mapNotNull \{ entry ->\n\s*runCatching \{ reactNativeAppIntentsParseItemEntity\(entry\.value\) \}\.getOrNull\(\)\n\s*\}/,
  );
  assert.doesNotMatch(kotlin, /\.has\(/);
});

const defaultOptionalSource: string[] = [
  'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
  "",
  "const Order = defineEntity({",
  '  id: "Order",',
  '  title: "Order",',
  "  schema: p.object({ id: p.int(), number: p.string() }),",
  "  identifier: (order) => String(order.id),",
  "  displayRepresentation: (order) => ({ title: order.number }),",
  "});",
  "",
  "export const shipOrder = defineIntent({",
  '  id: "shipOrder",',
  '  title: "Ship Order",',
  "  params: {",
  "    address: p.object(",
  "      {",
  "        street: p.string(),",
  "        note: p.string({ optional: true }),",
  "        city: p.object(",
  "          { name: p.string(), zip: p.string({ optional: true }) },",
  "          { optional: true },",
  "        ),",
  "      },",
  '      { default: { street: "1", city: { name: "Paris" } } },',
  "    ),",
  "  },",
  "  android: { appFunction: true },",
  "});",
  "",
];

test("defaults emit null for optional fields missing from the default", async () => {
  const kotlin = await generateKotlinFromSource(defaultOptionalSource);

  assert.match(
    kotlin,
    /address \?: ShipOrderAddress\(street = "1", note = null, city = ShipOrderAddressCity\(name = "Paris", zip = null\)\)/,
  );
  assert.doesNotMatch(kotlin, /undefined/);
});

test("defaults that miss a required field are rejected with a clear error", async () => {
  const message = await generateErrorMessage([
    'import { defineIntent, p } from "@avasapp/react-native-app-intents";',
    "",
    "export const shipOrder = defineIntent({",
    '  id: "shipOrder",',
    '  title: "Ship Order",',
    "  params: {",
    "    address: p.object({ street: p.string() }, { default: {} }),",
    "  },",
    "  android: { appFunction: true },",
    "});",
    "",
  ]);

  assert.match(message, /Default for parameter "address"/);
  assert.match(message, /street/);
  assert.match(message, /required/);
});

test("defaults with the wrong field type are rejected with a clear error", async () => {
  const message = await generateErrorMessage([
    'import { defineIntent, p } from "@avasapp/react-native-app-intents";',
    "",
    "export const shipOrder = defineIntent({",
    '  id: "shipOrder",',
    '  title: "Ship Order",',
    "  params: {",
    "    address: p.object({ street: p.string() }, { default: { street: 123 } }),",
    "  },",
    "  android: { appFunction: true },",
    "});",
    "",
  ]);

  assert.match(message, /Default for parameter "address"/);
  assert.match(message, /must be a string/);
});

test("resolveExpoCodegenConfig keeps android.appFunctions for the Expo plugin", () => {
  const resolved = resolveExpoCodegenConfig(
    { name: "expo-app", slug: "expo-app", android: { package: "dev.expo.example" } },
    appFunctionsConfig({ appMetadataInstructions: "Order tracking." }),
    "/tmp/expo-app",
    "android",
  );

  assert.equal(resolved.android?.appFunctions?.output, appFunctionsOutput);
  assert.equal(resolved.android?.appFunctions?.appMetadata?.instructions, "Order tracking.");
});
