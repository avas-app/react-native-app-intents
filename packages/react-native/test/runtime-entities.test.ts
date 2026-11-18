import assert from "node:assert/strict";
import test from "node:test";

import { defineEntity, p } from "../src/core/index.js";
import type { AppIntentsNativeModule } from "../src/native.js";
import { bindEntityTag, createAppIntentsRuntime, setOnscreenEntity } from "../src/index.js";

const order = defineEntity({
  id: "order",
  title: "Order",
  schema: p.object({ orderNumber: p.string() }),
  identifier: (value) => value.orderNumber,
  displayRepresentation: (value) => ({ title: `Order ${value.orderNumber}` }),
  inventory: [{ orderNumber: "1" }],
});

function createNative(stored: string | null = null) {
  const calls: unknown[][] = [];
  let store = stored;
  let failNext = false;
  const native: AppIntentsNativeModule = {
    async clearDonations() {},
    async donate() {},
    async updateDynamicShortcuts() {},
    async getEntityCatalog() {
      return store;
    },
    async setEntityCatalog(entityId: string, json: string) {
      calls.push(["set", entityId, json]);
      if (failNext) {
        failNext = false;
        throw new Error("bridge failed");
      }
      store = json;
    },
    async reindexEntities(entityId: string | null) {
      calls.push(["reindex", entityId]);
    },
    async setEntityTag(tag: number, entityId: string | null, id: string | null) {
      calls.push(["tag", tag, entityId, id]);
    },
    async setOnscreenEntity(token: string, entityId: string | null, id: string | null) {
      calls.push(["onscreen", token, entityId, id]);
    },
  };
  return { calls, native, failNext: () => (failNext = true), store: () => store };
}

function runtimeFor(native: AppIntentsNativeModule) {
  return createAppIntentsRuntime({
    scheme: "t",
    intents: [],
    nativeModule: native,
    linking: {
      addEventListener: () => ({ remove() {} }),
      getInitialURL: async () => null,
    },
  });
}

test("getEntities returns the static values until the first setEntities", async () => {
  const { native } = createNative();
  const runtime = runtimeFor(native);

  assert.deepEqual(await runtime.getEntities(order), [
    { id: "1", title: "Order 1", value: { orderNumber: "1" } },
  ]);
});

test("setEntities stores the catalog and getEntities returns it", async () => {
  const { native, calls } = createNative();
  const runtime = runtimeFor(native);
  const entries = [
    {
      id: "4521",
      title: "Order 4521",
      subtitle: "Tue",
      synonyms: ["last"],
      value: { orderNumber: "4521" },
    },
  ];

  await runtime.setEntities(order, entries);

  assert.equal(calls.length, 1);
  assert.deepEqual(await runtime.getEntities(order), entries);
});

test("an unchanged catalog is a no-op, also after a restart", async () => {
  const first = createNative();
  const entries = [{ id: "1", title: "One", value: { orderNumber: "1" } }];

  await runtimeFor(first.native).setEntities(order, entries);
  await runtimeFor(first.native).setEntities(order, entries);
  const same = runtimeFor(first.native);
  await same.setEntities(order, entries);
  await same.setEntities(order, entries);

  assert.equal(first.calls.length, 1);
});

test("setEntities rejects bad entries and keeps the old catalog", async () => {
  const { native, calls } = createNative();
  const runtime = runtimeFor(native);
  const good = [{ id: "1", title: "One", value: { orderNumber: "1" } }];

  await runtime.setEntities(order, good);

  for (const bad of [
    [{ id: "", title: "x", value: { orderNumber: "1" } }],
    [{ id: "2", title: "  ", value: { orderNumber: "1" } }],
    [good[0]!, good[0]!],
  ]) {
    await assert.rejects(runtime.setEntities(order, bad));
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(await runtime.getEntities(order), good);
});

test("a failed native write rejects and a retry publishes again", async () => {
  const { native, calls, failNext } = createNative();
  const runtime = runtimeFor(native);
  const entries = [{ id: "1", title: "One", value: { orderNumber: "1" } }];

  failNext();
  await assert.rejects(runtime.setEntities(order, entries));
  await runtime.setEntities(order, entries);

  assert.equal(calls.length, 2);
});

test("an empty catalog clears it and reindexEntities forwards the entity id", async () => {
  const { native, calls } = createNative();
  const runtime = runtimeFor(native);

  await runtime.setEntities(order, []);
  assert.deepEqual(await runtime.getEntities(order), []);
  await runtime.reindexEntities(order);
  await runtime.reindexEntities();

  assert.deepEqual(calls.slice(1), [
    ["reindex", "order"],
    ["reindex", null],
  ]);
});

test("without the native methods everything still resolves", async () => {
  const runtime = runtimeFor({
    async clearDonations() {},
    async donate() {},
    async updateDynamicShortcuts() {},
  });
  const entries = [{ id: "1", title: "One", value: { orderNumber: "1" } }];

  await runtime.setEntities(order, entries);
  await runtime.reindexEntities(order);

  assert.deepEqual(await runtime.getEntities(order), entries);
});

test("setOnscreenEntity sends the entity and id, and null clears", async () => {
  const { native, calls } = createNative();

  await setOnscreenEntity(native, order, "4521", "a");
  await setOnscreenEntity(native, order, null, "a");

  assert.deepEqual(calls, [
    ["onscreen", "a", "order", "4521"],
    ["onscreen", "a", null, null],
  ]);
});

test("setEntities retries when the synced copy differs from the stored catalog", async () => {
  const calls: unknown[][] = [];
  const native: AppIntentsNativeModule = {
    async clearDonations() {},
    async donate() {},
    async updateDynamicShortcuts() {},
    async getEntityCatalog() {
      return JSON.stringify([{ id: "1", title: "One", value: { orderNumber: "1" } }]);
    },
    async getSyncedEntityCatalog() {
      return null;
    },
    async setEntityCatalog(entityId: string, json: string) {
      calls.push(["set", entityId, json]);
    },
  };

  await runtimeFor(native).setEntities(order, [
    { id: "1", title: "One", value: { orderNumber: "1" } },
  ]);

  assert.equal(calls.length, 1);
});

test("setEntities skips when the synced copy matches", async () => {
  const json = JSON.stringify([{ id: "1", title: "One", value: { orderNumber: "1" } }]);
  const calls: unknown[][] = [];
  const native: AppIntentsNativeModule = {
    async clearDonations() {},
    async donate() {},
    async updateDynamicShortcuts() {},
    async getEntityCatalog() {
      return json;
    },
    async getSyncedEntityCatalog() {
      return json;
    },
    async setEntityCatalog(entityId: string, next: string) {
      calls.push(["set", entityId, next]);
    },
  };

  await runtimeFor(native).setEntities(order, [
    { id: "1", title: "One", value: { orderNumber: "1" } },
  ]);

  assert.equal(calls.length, 0);
});

test("bindEntityTag sets the tag, and cleanup clears it with the saved tag", () => {
  const { calls, native } = createNative();
  const clear = bindEntityTag(native, 42, order, "4521");
  assert.deepEqual(calls, [["tag", 42, "order", "4521"]]);
  clear();
  assert.deepEqual(calls[1], ["tag", 42, null, null]);
});

test("changing the id clears the old binding before the new one is set", () => {
  const { calls, native } = createNative();
  const clearFirst = bindEntityTag(native, 42, order, "1");
  clearFirst();
  const clearSecond = bindEntityTag(native, 42, order, "2");
  clearSecond();
  assert.deepEqual(calls, [
    ["tag", 42, "order", "1"],
    ["tag", 42, null, null],
    ["tag", 42, "order", "2"],
    ["tag", 42, null, null],
  ]);
});

test("bindEntityTag is a no-op when native lacks setEntityTag", () => {
  const { native } = createNative();
  delete native.setEntityTag;
  assert.doesNotThrow(() => bindEntityTag(native, 1, order, "1")());
});
