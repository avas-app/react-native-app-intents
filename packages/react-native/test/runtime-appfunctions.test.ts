import assert from "node:assert/strict";
import test from "node:test";

import { defineIntent, p } from "../src/core/index.js";
import type { AppIntentsNativeModule } from "../src/native.js";
import { createAppIntentsRuntime } from "../src/index.js";

const openOrder = defineIntent({
  id: "openOrder",
  title: "Open order",
  description: "Opens an order",
  params: { orderNumber: p.string() },
});

function runtimeFor(native: AppIntentsNativeModule) {
  return createAppIntentsRuntime({
    scheme: "t",
    intents: [openOrder],
    nativeModule: native,
    linking: {
      addEventListener: () => ({ remove() {} }),
      getInitialURL: async () => null,
    },
  });
}

const base: AppIntentsNativeModule = {
  async clearDonations() {},
  async donate() {},
  async updateDynamicShortcuts() {},
};

test("setAppFunctionEnabled passes the intent id to the native module", async () => {
  const calls: unknown[][] = [];
  const runtime = runtimeFor({
    ...base,
    async setAppFunctionEnabled(id, enabled) {
      calls.push([id, enabled]);
    },
  });

  await runtime.setAppFunctionEnabled(openOrder, false);
  assert.deepEqual(calls, [["openOrder", false]]);
});

test("setAppFunctionEnabled is a no-op without the native method (iOS, web)", async () => {
  await runtimeFor(base).setAppFunctionEnabled(openOrder, true);
});

test("an AppFunction url from native reaches onIntent", async () => {
  const url = `t://app-intents/openOrder?payload=${encodeURIComponent(
    JSON.stringify({ orderNumber: "4521" }),
  )}&invocationId=abc`;
  const runtime = createAppIntentsRuntime({
    scheme: "t",
    intents: [openOrder],
    nativeModule: {
      ...base,
      async getPendingIntentURLs() {
        return [url];
      },
    },
    linking: {
      addEventListener: () => ({ remove() {} }),
      getInitialURL: async () => null,
    },
  });
  const seen: unknown[] = [];
  runtime.onIntent(openOrder, (params) => {
    seen.push(params);
  });
  const initial = await runtime.getInitialIntent();
  if (initial) seen.push(initial.params);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [{ orderNumber: "4521" }]);
});

test("Android catalog round-trips through the native store", async () => {
  let store: string | null = null;
  const native: AppIntentsNativeModule = {
    ...base,
    async getEntityCatalog() {
      return store;
    },
    async setEntityCatalog(_id, json) {
      store = json;
    },
  };
  const { defineEntity } = await import("../src/core/index.js");
  const order = defineEntity({
    id: "order",
    title: "Order",
    schema: p.object({ orderNumber: p.string() }),
    identifier: (v) => v.orderNumber,
    displayRepresentation: (v) => ({ title: `Order ${v.orderNumber}` }),
    inventory: [],
  });
  const runtime = runtimeFor(native);
  await runtime.setEntities(order, [{ id: "1", title: "One", value: { orderNumber: "1" } }]);
  assert.ok(store);
  assert.equal(JSON.parse(store as string)[0].id, "1");
  const fresh = runtimeFor(native);
  assert.equal((await fresh.getEntities(order))[0]?.id, "1");
});
