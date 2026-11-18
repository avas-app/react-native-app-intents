import assert from "node:assert/strict";
import { beforeEach, mock, test } from "bun:test";

import { defineIntent } from "../src/core/index.js";

type UrlListener = (event: { url: string }) => void;

const rn = {
  appStateListeners: [] as ((state: string) => void)[],
  linkingListeners: [] as UrlListener[],
  nativeListeners: [] as UrlListener[],
  linkingInitialUrl: null as string | null,
  native: null as unknown,
};

mock.module("react-native", () => ({
  AppState: {
    addEventListener(_event: string, listener: (state: string) => void) {
      rn.appStateListeners.push(listener);
      return { remove() {} };
    },
  },
  Linking: {
    addEventListener(_event: string, listener: UrlListener) {
      rn.linkingListeners.push(listener);
      return { remove() {} };
    },
    async getInitialURL() {
      return rn.linkingInitialUrl;
    },
  },
  NativeEventEmitter: class {
    addListener(_name: string, listener: UrlListener) {
      rn.nativeListeners.push(listener);
      return { remove() {} };
    }
  },
  NativeModules: {
    get ReactNativeAppIntents() {
      return rn.native;
    },
  },
}));

const { buildIntentUrl, createAppIntentsRuntime } = await import("../src/index.js");

const pingIntent = defineIntent({ id: "ping", title: "Ping", params: {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const withId = (url: string, id: string) =>
  `${url}${url.includes("?") ? "&" : "?"}invocationId=${id}`;

function createNative(initial: string[] = []) {
  const stored = [...initial];
  const acked: string[] = [];
  const idOf = (url: string) =>
    new URL(url.replace(/^example:/, "http:")).searchParams.get("invocationId");

  return {
    acked,
    stored,
    reads: 0,
    async clearDonations() {},
    async donate() {},
    async updateDynamicShortcuts() {},
    async getPendingIntentURLs() {
      this.reads += 1;
      return [...stored];
    },
    async acknowledgeIntent(id: string) {
      acked.push(id);
      const index = stored.findIndex((url) => idOf(url) === id);

      if (index >= 0) {
        stored.splice(index, 1);
      }
    },
  };
}

const base = buildIntentUrl("example", pingIntent, {});

beforeEach(() => {
  rn.appStateListeners.length = 0;
  rn.linkingListeners.length = 0;
  rn.nativeListeners.length = 0;
  rn.linkingInitialUrl = null;
});

test("default linking: listener is attached before the native read, so a run enqueued during it is not lost", async () => {
  const native = createNative([withId(base, "a")]);
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const ids: string[] = [];
  runtime.onAnyIntent((event) => {
    ids.push(event.url);
  });

  assert.equal(rn.nativeListeners.length, 1);
  rn.nativeListeners[0]?.({ url: withId(base, "b") });
  await settle();

  assert.deepEqual(ids.sort(), [withId(base, "a"), withId(base, "b")]);
  assert.deepEqual(native.acked.sort(), ["a", "b"]);
});

test("default linking: AppState active re-reads the native list", async () => {
  const native = createNative();
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  await settle();
  const readsBefore = native.reads;

  native.stored.push(withId(base, "late"));
  rn.appStateListeners.forEach((listener) => listener("background"));
  await settle();
  assert.equal(calls, 0);
  rn.appStateListeners.forEach((listener) => listener("active"));
  await settle();

  assert.equal(native.reads, readsBefore + 1);
  assert.equal(calls, 1);
});

test("default linking: a Linking copy and a native copy of one run deliver once", async () => {
  const native = createNative([withId(base, "run1")]);
  rn.native = native;
  rn.linkingInitialUrl = base;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  rn.linkingListeners.forEach((listener) => listener({ url: base }));
  await settle();

  assert.equal(calls, 1);
  assert.deepEqual(native.acked, ["run1"]);
});

test("default linking: non-intent Linking urls still pass through when native owns intents", async () => {
  rn.native = createNative();
  const other = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  other.onIntent(pingIntent, () => {
    calls += 1;
  });
  rn.linkingListeners.forEach((listener) =>
    listener({ url: "example://app-intents-lookalike/ping" }),
  );
  await settle();

  assert.equal(calls, 0);
});

test("default linking: a cold-start run reaches an app that only uses onIntent", async () => {
  const native = createNative([withId(base, "cold")]);
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  await settle();
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  await settle();

  assert.equal(calls, 1);
  assert.deepEqual(native.acked, ["cold"]);
});

test("default linking: getInitialIntent takes the cold-start run from the native list", async () => {
  const native = createNative([withId(base, "cold2")]);
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const event = await runtime.getInitialIntent();
  await settle();

  assert.equal(event?.id, "ping");
  assert.deepEqual(native.acked, ["cold2"]);
});

test("old native module: every queued run is read, not just the first", async () => {
  const queue = [withId(base, "o1"), withId(base, "o2"), withId(base, "o3")];
  rn.native = {
    async clearDonations() {},
    async donate() {},
    async updateDynamicShortcuts() {},
    async getInitialIntentURL() {
      return queue.shift() ?? null;
    },
  };
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  await settle();
  await settle();

  assert.equal(calls, 3);
});
