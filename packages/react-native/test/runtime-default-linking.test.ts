import assert from "node:assert/strict";
import { beforeEach, mock, test } from "bun:test";

import { defineIntent } from "../src/core/index.js";

type UrlListener = (event: { url: string }) => void;

const rn = {
  appStateListeners: [] as ((state: string) => void)[],
  linkingListeners: [] as UrlListener[],
  nativeListeners: [] as UrlListener[],
  linkingInitialUrl: null as string | null,
  os: "android",
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
  Platform: {
    get OS() {
      return rn.os;
    },
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
  rn.os = "android";
});

test("default linking: listener is attached before the native read, so a run enqueued during it is not lost", async () => {
  const native = createNative([withId(base, "a")]);
  // A run enqueued while the read is in flight is only seen if the listener already exists.
  const read = native.getPendingIntentURLs.bind(native);
  native.getPendingIntentURLs = async () => {
    rn.nativeListeners.forEach((listener) => listener({ url: withId(base, "b") }));
    return read();
  };
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const ids: string[] = [];
  runtime.onAnyIntent((event) => {
    ids.push(event.url);
  });
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

test("default linking: on iOS an app-intents link opened by URL still arrives through Linking", async () => {
  rn.os = "ios";
  rn.native = createNative();
  rn.linkingInitialUrl = base;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const urls: string[] = [];
  runtime.onAnyIntent((event) => {
    urls.push(event.url);
  });

  assert.equal((await runtime.getInitialIntent())?.url, base);
  rn.linkingListeners.forEach((listener) => listener({ url: `${base}&warm=1` }));
  await settle();

  assert.deepEqual(urls, [`${base}&warm=1`]);
});

test("default linking: Android relies on native recording the run; a Linking-only copy is not delivered", async () => {
  rn.native = createNative();
  rn.linkingInitialUrl = withId(base, "only-linking");
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  rn.linkingListeners.forEach((listener) => listener({ url: withId(base, "only-linking") }));
  await settle();

  assert.equal(calls, 0);
});

test("default linking: Android delivers a run once when native records the launch intent", async () => {
  const native = createNative([withId(base, "launch")]);
  rn.native = native;
  rn.linkingInitialUrl = withId(base, "launch");
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  rn.linkingListeners.forEach((listener) => listener({ url: withId(base, "launch") }));
  await settle();

  assert.equal(calls, 1);
  assert.deepEqual(native.acked, ["launch"]);
});

test("default linking: on iOS a native run and its in-process event deliver once", async () => {
  rn.os = "ios";
  const native = createNative([withId(base, "i1")]);
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  rn.nativeListeners.forEach((listener) => listener({ url: withId(base, "i1") }));
  rn.appStateListeners.forEach((listener) => listener("active"));
  await settle();

  assert.equal(calls, 1);
  assert.deepEqual(native.acked, ["i1"]);
});

test("default linking: an iOS cold-start Linking url is delivered even when getInitialIntent returns a native run", async () => {
  rn.os = "ios";
  rn.native = createNative([withId(`${base}?from=native`, "n1")]);
  rn.linkingInitialUrl = base;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const urls: string[] = [];
  runtime.onAnyIntent((event) => {
    urls.push(event.url);
  });
  const first = await runtime.getInitialIntent();
  await settle();

  assert.equal(first?.url, withId(`${base}?from=native`, "n1"));
  assert.ok(urls.includes(base));
});

test("default linking: on iOS a url recorded natively and also forwarded to Linking delivers once", async () => {
  rn.os = "ios";
  const native = createNative([withId(base, "rec1")]);
  rn.native = native;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const urls: string[] = [];
  runtime.onAnyIntent((event) => {
    urls.push(event.url);
  });
  await settle();
  rn.linkingListeners.forEach((listener) => listener({ url: base }));
  await settle();

  assert.deepEqual(urls, [withId(base, "rec1")]);
});

test("default linking: on iOS a cold-start url recorded natively and also in Linking delivers once", async () => {
  rn.os = "ios";
  rn.native = createNative([withId(base, "rec2")]);
  rn.linkingInitialUrl = base;
  const runtime = createAppIntentsRuntime({ scheme: "example", intents: [pingIntent] as const });
  const urls: string[] = [];
  runtime.onAnyIntent((event) => {
    urls.push(event.url);
  });
  const first = await runtime.getInitialIntent();
  await settle();

  assert.equal(first?.url, withId(base, "rec2"));
  assert.deepEqual(urls, []);
});
