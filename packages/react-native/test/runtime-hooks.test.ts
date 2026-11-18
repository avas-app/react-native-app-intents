import assert from "node:assert/strict";
import { mock, test } from "bun:test";

import { defineEntity, p } from "../src/core/index.js";

type Cleanup = (() => void) | void;
interface Slot {
  deps?: readonly unknown[] | undefined;
  cleanup?: Cleanup;
}

const harness = {
  hooks: [] as unknown[],
  index: 0,
  pending: [] as (() => void)[],
  native: null as unknown,
  tags: new Map<object, number>(),
};

mock.module("react", () => ({
  useRef(initial: unknown) {
    const i = harness.index++;
    harness.hooks[i] ??= { current: initial };
    return harness.hooks[i];
  },
  useEffect(effect: () => Cleanup, deps?: readonly unknown[]) {
    const i = harness.index++;
    const slot = (harness.hooks[i] ??= {}) as Slot;
    const changed = !slot.deps || !deps || deps.some((d, n) => !Object.is(d, slot.deps![n]));

    if (changed) {
      harness.pending.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect();
        slot.deps = deps;
      });
    }
  },
}));

mock.module("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    get ReactNativeAppIntents() {
      return harness.native;
    },
  },
  NativeEventEmitter: class {
    addListener() {
      return { remove() {} };
    }
  },
  Linking: { addEventListener: () => ({ remove() {} }), getInitialURL: async () => null },
  AppState: { addEventListener: () => ({ remove() {} }) },
  findNodeHandle: () => null,
}));

const { useAppEntityTag, useOnscreenEntity } = await import("../src/index.js");

const order = defineEntity({
  id: "order",
  title: "Order",
  schema: p.object({ orderNumber: p.string() }),
  identifier: (value) => value.orderNumber,
  displayRepresentation: (value) => ({ title: value.orderNumber }),
  inventory: [{ orderNumber: "1" }],
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function render(hook: () => void): void {
  harness.index = 0;
  hook();
  const run = harness.pending.splice(0);
  for (const effect of run) {
    effect();
  }
}

function setup() {
  const calls: unknown[][] = [];
  harness.hooks = [];
  harness.pending = [];
  harness.native = {
    async setEntityTag(tag: number, entityId: string | null, id: string | null) {
      calls.push(["tag", tag, entityId, id]);
    },
    async setOnscreenEntity(token: string, entityId: string | null, id: string | null) {
      calls.push(["onscreen", token === "" ? "empty" : "token", entityId, id]);
    },
  };
  return calls;
}

test("useAppEntityTag re-tags when ref.current changes with the same id", () => {
  const calls = setup();
  const ref = { current: { __nativeTag: 1 } as unknown };
  const hook = () => useAppEntityTag(ref, order, "1");

  render(hook);
  ref.current = { __nativeTag: 2 };
  render(hook);

  assert.deepEqual(calls, [
    ["tag", 1, "order", "1"],
    ["tag", 1, null, null],
    ["tag", 2, "order", "1"],
  ]);
});

test("useAppEntityTag tags once ref.current appears after the first commit", () => {
  const calls = setup();
  const ref = { current: null as unknown };
  const hook = () => useAppEntityTag(ref, order, "1");

  render(hook);
  assert.deepEqual(calls, []);
  ref.current = { __nativeTag: 7 };
  render(hook);

  assert.deepEqual(calls, [["tag", 7, "order", "1"]]);
});

test("useAppEntityTag does not re-tag when nothing changed", () => {
  const calls = setup();
  const ref = { current: { __nativeTag: 1 } as unknown };
  const hook = () => useAppEntityTag(ref, order, "1");

  render(hook);
  render(hook);

  assert.deepEqual(calls, [["tag", 1, "order", "1"]]);
});

test("useOnscreenEntity clears with its own token, not a blanket clear", async () => {
  const calls = setup();
  const tokens: string[] = [];
  (harness.native as { setOnscreenEntity: unknown }).setOnscreenEntity = async (
    token: string,
    entityId: string | null,
    id: string | null,
  ) => {
    tokens.push(token);
    calls.push(["onscreen", entityId, id]);
  };

  render(() => useOnscreenEntity(order, "1"));
  render(() => useOnscreenEntity(order, "2"));
  await settle();

  assert.equal(calls.length, 3);
  assert.equal(tokens[0], tokens[1]);
  assert.equal(tokens[1], tokens[2]);
  assert.notEqual(tokens[0], "");
});
