import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { defineEntity, defineIntent, normalizeReferencedEntities, p } from "../src/core/index.js";
import { generateAppIntents } from "../src/codegen/index.js";

async function generateSwift(sourceLines: string[]): Promise<string> {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-codegen-runtime-"));

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src/orders.intents.ts"), sourceLines.join("\n"), "utf8");
    await generateAppIntents(
      {
        intents: ["src/**/*.intents.ts"],
        scheme: "example",
        ios: {
          output: "ios/G.swift",
          appGroupIdentifier: "group.com.avasapp.appintents.example",
        },
      },
      { cwd },
    );
    return await readFile(join(cwd, "ios/G.swift"), "utf8");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function readFixture(name: string, actual: string): Promise<string> {
  const path = join(import.meta.dirname, "fixtures", name);

  if (process.env.UPDATE_FIXTURES === "1") {
    await writeFile(path, actual, "utf8");
  }

  return readFile(path, "utf8");
}

const staticSource: string[] = [
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
];

const runtimeSource: string[] = [
  'import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";',
  "",
  "export const order = defineEntity({",
  '  id: "order",',
  '  title: "Order \\"Quoted\\"",',
  '  catalog: "runtime",',
  '  inventory: [{ orderNumber: "1" }],',
  "  schema: p.object({ orderNumber: p.string() }),",
  "  identifier: (o) => o.orderNumber,",
  "  displayRepresentation: (o) => ({ title: `Order ${o.orderNumber}` }),",
  '  spotlight: { openIntent: "openOrder" },',
  "});",
  "",
  "export const openOrder = defineIntent({",
  '  id: "openOrder",',
  '  title: "Open Order",',
  '  phrases: ["Open ${order} in ${.applicationName}"],',
  '  params: { order: p.entity(order, { default: { orderNumber: "1" } }) },',
  "  surfaces: { appShortcut: true },",
  "});",
  "",
  "export const plain = defineEntity({",
  '  id: "plain",',
  '  catalog: "runtime",',
  "  schema: p.object({ key: p.string() }),",
  "  identifier: (o) => o.key,",
  "  displayRepresentation: (o) => ({ title: o.key }),",
  "});",
  "",
  "export const usePlain = defineIntent({",
  '  id: "usePlain",',
  '  title: "Use Plain",',
  "  params: { plain: p.entity(plain) },",
  "});",
  "",
];

test("static-only projects generate the same Swift as before runtime catalogs", async () => {
  const swift = await generateSwift(staticSource);
  const expected = await readFile(
    join(import.meta.dirname, "fixtures/static-entities.swift"),
    "utf8",
  );

  assert.equal(swift, expected);
  assert.doesNotMatch(swift, /ReactNativeAppIntentsGeneratedBridge/);
});

test("runtime + spotlight entities generate store-backed queries, IndexedEntity and the bridge", async () => {
  const swift = await generateSwift(runtimeSource);
  const expected = await readFixture("runtime-entities.swift", swift);

  assert.equal(swift, expected);
  assert.match(swift, /ReactNativeAppIntentsEntityCatalog\.order/);
  assert.match(swift, /extension OrderAppEntity: IndexedEntity/);
  assert.match(swift, /struct OpenOrderIntent: AppIntent, OpenIntent/);
  assert.match(swift, /var target: OrderAppEntity/);
  assert.match(
    swift,
    /@objc static func catalogDidChange\(_ entityId: String, completion: @escaping \(NSError\?\) -> Void\)/,
  );
  assert.match(
    swift,
    /@objc static func reindex\(_ entityId: String\?, completion: @escaping \(NSError\?\) -> Void\)/,
  );
  assert.match(swift, /@objc static func setOnscreenEntity\(_ entityId: String\?, id: String\?\)/);
  assert.match(
    swift,
    /@objc static func setEntityIdentifier\(on view: UIView, entityId: String\?, id: String\?\)/,
  );
  assert.match(swift, /name: "Order \\"Quoted\\""/);
  assert.doesNotMatch(swift, /extension PlainAppEntity: IndexedEntity/);
});

const orderSchema = p.object({ orderNumber: p.string() });

function entityWith(options: Record<string, unknown>) {
  return defineEntity({
    id: "order",
    schema: orderSchema,
    identifier: (o) => o.orderNumber,
    displayRepresentation: (o) => ({ title: o.orderNumber }),
    ...options,
  });
}

test("spotlight validation requires a runtime catalog and a configured open intent", () => {
  const dummy = entityWith({ id: "dummy" });
  const other = defineIntent({ id: "other", title: "Other", params: {} });
  const openOther = defineIntent({
    id: "openOther",
    title: "Open",
    params: { order: p.entity(dummy) },
  });
  const bad = entityWith({ id: "bad", catalog: "runtime", spotlight: { openIntent: "other" } });
  const useBad = defineIntent({ id: "useBad", title: "Use", params: { order: p.entity(bad) } });

  assert.throws(
    () => normalizeReferencedEntities([useBad, other]),
    /exactly one required parameter of this entity/,
  );
  assert.throws(() => normalizeReferencedEntities([useBad]), /not one of the configured intents/);

  const staticSpotlight = entityWith({ id: "staticOrder", spotlight: { openIntent: "openOther" } });
  const useStatic = defineIntent({
    id: "useStatic",
    title: "Use",
    params: { order: p.entity(staticSpotlight) },
  });

  assert.throws(
    () => normalizeReferencedEntities([useStatic, openOther]),
    /requires catalog: "runtime"/,
  );

  const badCatalog = entityWith({ id: "badCatalog", catalog: "weird" });
  const useCatalog = defineIntent({
    id: "useCatalog",
    title: "Use",
    params: { order: p.entity(badCatalog) },
  });

  assert.throws(() => normalizeReferencedEntities([useCatalog]), /catalog must be/);

  const noIntent = entityWith({ id: "noIntent", catalog: "runtime", spotlight: { openIntent: 5 } });
  const useNone = defineIntent({
    id: "useNone",
    title: "Use",
    params: { order: p.entity(noIntent) },
  });

  assert.throws(() => normalizeReferencedEntities([useNone]), /spotlight.openIntent must be/);
});

test("a valid spotlight entity normalizes with its open intent id, by id or by function", () => {
  for (const reference of ["openOrder", () => openOrder] as const) {
    const order = entityWith({ catalog: "runtime", spotlight: { openIntent: reference } });
    var openOrder: ReturnType<typeof defineIntent<any>> = defineIntent({
      id: "openOrder",
      title: "Open",
      params: { order: p.entity(order) },
    });

    const [normalized] = normalizeReferencedEntities([openOrder]);

    assert.equal(normalized?.catalog, "runtime");
    assert.deepEqual(normalized?.spotlight, { openIntentId: "openOrder" });
  }
});
