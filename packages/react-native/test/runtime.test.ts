import assert from "node:assert/strict";
import test from "node:test";

import { defineEntity, defineIntent, p } from "../src/core/index.js";

import { buildIntentUrl, createAppIntentsRuntime, parseIntentUrl } from "../src/index.js";

function createLinkingAdapter(initialUrl: string | null = null) {
  let currentInitialUrl = initialUrl;
  let listener: ((event: { url: string }) => void) | null = null;

  return {
    adapter: {
      addEventListener(_event: "url", nextListener: (event: { url: string }) => void) {
        listener = nextListener;
        return {
          remove() {
            listener = null;
          },
        };
      },
      async getInitialURL() {
        return currentInitialUrl;
      },
    },
    emit(url: string) {
      listener?.({ url });
    },
    setInitialUrl(url: string | null) {
      currentInitialUrl = url;
    },
  };
}

function createEagerInitialLinkingAdapter(initialUrl: string | null = null) {
  let currentInitialUrl = initialUrl;
  let listener: ((event: { url: string }) => void) | null = null;

  return {
    adapter: {
      addEventListener(_event: "url", nextListener: (event: { url: string }) => void) {
        listener = nextListener;

        if (currentInitialUrl) {
          const url = currentInitialUrl;
          currentInitialUrl = null;
          queueMicrotask(() => {
            listener?.({ url });
          });
        }

        return {
          remove() {
            listener = null;
          },
        };
      },
      async getInitialURL() {
        return currentInitialUrl;
      },
    },
    emit(url: string) {
      listener?.({ url });
    },
  };
}

test("runtime parses initial urls and emits typed handlers", async () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string({
        androidBiiParam: "order",
      }),
    },
    android: {
      appAction: {
        capability: "actions.intent.GET_ORDER",
      },
    },
  });
  const linking = createLinkingAdapter(
    buildIntentUrl("example", openOrder, { orderNumber: "1234" }),
  );
  const donated: string[] = [];
  const clearedDonations: string[] = [];
  const shortcutUpdates: unknown[] = [];
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [openOrder] as const,
    linking: linking.adapter,
    nativeModule: {
      async clearDonations() {
        clearedDonations.push("clear");
      },
      async donate(intentId, title, url, payload, capabilityBindings) {
        donated.push(
          `${intentId}:${title}:${url}:${payload}:${JSON.stringify(capabilityBindings ?? [])}`,
        );
      },
      async updateDynamicShortcuts(shortcuts) {
        shortcutUpdates.push(shortcuts);
      },
    },
  });

  let receivedOrderNumber = "";
  const unsubscribe = runtime.onIntent(openOrder, ({ orderNumber }) => {
    receivedOrderNumber = orderNumber;
  });

  const initialIntent = await runtime.getInitialIntent();
  linking.emit(buildIntentUrl("example", openOrder, { orderNumber: "5678" }));

  await runtime.donate(openOrder, { orderNumber: "5678" });
  await runtime.clearDonations();
  await runtime.updateDynamicShortcuts([
    {
      icon: {
        androidResourceName: "@mipmap/ic_launcher_round",
        iosTemplateImageName: "burger",
        systemName: "shippingbox",
      },
      intent: openOrder,
      params: { orderNumber: "5678" },
      shortTitle: "Open Order 1234",
    },
  ]);

  unsubscribe();
  runtime.dispose();

  assert.equal(receivedOrderNumber, "5678");
  assert.deepEqual(initialIntent, {
    id: "openOrder",
    intent: openOrder,
    params: { orderNumber: "1234" },
    url: "example://app-intents/openOrder?payload=%7B%22orderNumber%22%3A%221234%22%7D",
  });
  assert.equal(
    donated[0],
    'openOrder:Open Order:example://app-intents/openOrder?payload=%7B%22orderNumber%22%3A%225678%22%7D:{"orderNumber":"5678"}:[{"capabilityName":"actions.intent.GET_ORDER","parameterBindings":[{"key":"order","value":"5678"}]}]',
  );
  assert.deepEqual(clearedDonations, ["clear"]);
  assert.deepEqual(shortcutUpdates[0], [
    {
      id: "openOrder",
      icon: {
        androidResourceName: "@mipmap/ic_launcher_round",
        iosTemplateImageName: "burger",
        systemName: "shippingbox",
      },
      capabilityBindings: [
        {
          capabilityName: "actions.intent.GET_ORDER",
          parameterBindings: [
            {
              key: "order",
              value: "5678",
            },
          ],
        },
      ],
      title: "Open Order 1234",
      url: "example://app-intents/openOrder?payload=%7B%22orderNumber%22%3A%225678%22%7D",
    },
  ]);
});

test("runtime preserves the initial intent when linking emits it during startup", async () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });
  const linking = createEagerInitialLinkingAdapter(
    buildIntentUrl("example", openOrder, { orderNumber: "1234" }),
  );
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [openOrder] as const,
    linking: linking.adapter,
    nativeModule: {
      async clearDonations() {},
      async donate() {},
      async updateDynamicShortcuts() {},
    },
  });

  const received: string[] = [];
  const unsubscribe = runtime.onIntent(openOrder, ({ orderNumber }) => {
    received.push(orderNumber);
  });
  const initialIntent = await runtime.getInitialIntent();
  linking.emit(buildIntentUrl("example", openOrder, { orderNumber: "5678" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  unsubscribe();
  runtime.dispose();

  assert.deepEqual(initialIntent, {
    id: "openOrder",
    intent: openOrder,
    params: { orderNumber: "1234" },
    url: "example://app-intents/openOrder?payload=%7B%22orderNumber%22%3A%221234%22%7D",
  });
  assert.deepEqual(received, ["5678"]);
});

test("runtime delivers foreground urls without requiring getInitialIntent", async () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });
  const linking = createLinkingAdapter(null);
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [openOrder] as const,
    linking: linking.adapter,
    nativeModule: {
      async clearDonations() {},
      async donate() {},
      async updateDynamicShortcuts() {},
    },
  });
  const received: string[] = [];

  runtime.onIntent(openOrder, ({ orderNumber }) => {
    received.push(orderNumber);
  });
  linking.emit(buildIntentUrl("example", openOrder, { orderNumber: "9876" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.dispose();

  assert.deepEqual(received, ["9876"]);
});

test("runtime returns a startup event that arrives before any handlers subscribe", async () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });
  const linking = createLinkingAdapter(null);
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [openOrder] as const,
    linking: linking.adapter,
    nativeModule: {
      async clearDonations() {},
      async donate() {},
      async updateDynamicShortcuts() {},
    },
  });

  assert.equal(await runtime.getInitialIntent(), null);

  linking.emit(buildIntentUrl("example", openOrder, { orderNumber: "1234" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const initialIntent = await runtime.getInitialIntent();

  runtime.dispose();

  assert.deepEqual(initialIntent, {
    id: "openOrder",
    intent: openOrder,
    params: { orderNumber: "1234" },
    url: "example://app-intents/openOrder?payload=%7B%22orderNumber%22%3A%221234%22%7D",
  });
});

test("parseIntentUrl ignores unrelated urls", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });

  const parsed = parseIntentUrl(
    {
      scheme: "example",
      intentsById: new Map([[openOrder.id, openOrder]]),
    },
    "https://example.com/orders/1234",
  );

  assert.equal(parsed, null);
});

test("parseIntentUrl ignores urls carrying a malformed payload", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });
  const context = {
    scheme: "example",
    intentsById: new Map([[openOrder.id, openOrder]]),
  };

  assert.equal(parseIntentUrl(context, "example://app-intents/openOrder?payload=not-json"), null);
  assert.equal(
    parseIntentUrl(context, "example://app-intents/openOrder?payload=%5B1%2C2%5D"),
    null,
  );
});

test("runtime ignores foreground urls carrying a malformed payload", async () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });
  const linking = createLinkingAdapter(null);
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [openOrder] as const,
    linking: linking.adapter,
    nativeModule: {
      async clearDonations() {},
      async donate() {},
      async updateDynamicShortcuts() {},
    },
  });
  const received: string[] = [];
  const rejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    rejections.push(reason);
  };

  process.on("unhandledRejection", onUnhandledRejection);
  runtime.onIntent(openOrder, ({ orderNumber }) => {
    received.push(orderNumber);
  });
  linking.emit("example://app-intents/openOrder?payload=not-json");
  await new Promise((resolve) => setTimeout(resolve, 0));
  linking.emit(buildIntentUrl("example", openOrder, { orderNumber: "9876" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.dispose();
  process.off("unhandledRejection", onUnhandledRejection);

  assert.deepEqual(rejections, []);
  assert.deepEqual(received, ["9876"]);
});

test("runtime serializes and parses entity params", async () => {
  const Order = defineEntity({
    id: "Order",
    title: "Order",
    inventory: [{ customer: "Taylor", id: 1, number: "1234" }],
    schema: p.object({
      id: p.int(),
      number: p.string(),
      customer: p.string(),
    }),
    identifier: (order) => String(order.id),
    displayRepresentation: (order) => ({
      title: `Order #${order.number}`,
      subtitle: order.customer,
    }),
  });
  const openSavedOrder = defineIntent({
    id: "openSavedOrder",
    title: "Open Saved Order",
    params: {
      order: p.entity(Order),
    },
  });
  const params = { order: { customer: "Taylor", id: 1, number: "1234" } };
  const url = buildIntentUrl("example", openSavedOrder, params);
  const linking = createLinkingAdapter(url);
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [openSavedOrder] as const,
    linking: linking.adapter,
    nativeModule: {
      async clearDonations() {},
      async donate() {},
      async updateDynamicShortcuts() {},
    },
  });

  const initialIntent = await runtime.getInitialIntent();
  const parsed = parseIntentUrl(
    {
      scheme: "example",
      intentsById: new Map([[openSavedOrder.id, openSavedOrder]]),
    },
    url,
  );
  runtime.dispose();

  assert.equal(
    url,
    "example://app-intents/openSavedOrder?payload=%7B%22order%22%3A%7B%22id%22%3A1%2C%22number%22%3A%221234%22%2C%22customer%22%3A%22Taylor%22%7D%7D",
  );
  assert.deepEqual(initialIntent, {
    id: "openSavedOrder",
    intent: openSavedOrder,
    params,
    url,
  });
  assert.deepEqual(parsed, {
    id: "openSavedOrder",
    intent: openSavedOrder,
    params,
    url,
  });
});

test("runtime serializes and parses nested object params", () => {
  const checkDelivery = defineIntent({
    id: "checkDelivery",
    title: "Check Delivery",
    params: {
      deliveryWindow: p.object({
        startDate: p.date(),
        destination: p.object({
          city: p.string({ optional: true }),
        }),
      }),
    },
  });
  const params = {
    deliveryWindow: {
      startDate: new Date("2024-01-02T03:04:05.000Z"),
      destination: {
        city: "Berlin",
      },
    },
  };
  const url = buildIntentUrl("example", checkDelivery, params);
  const parsed = parseIntentUrl(
    {
      scheme: "example",
      intentsById: new Map([[checkDelivery.id, checkDelivery]]),
    },
    url,
  );

  assert.equal(
    url,
    "example://app-intents/checkDelivery?payload=%7B%22deliveryWindow%22%3A%7B%22startDate%22%3A%222024-01-02T03%3A04%3A05.000Z%22%2C%22destination%22%3A%7B%22city%22%3A%22Berlin%22%7D%7D%7D",
  );
  assert.deepEqual(parsed, {
    id: "checkDelivery",
    intent: checkDelivery,
    params,
    url,
  });
});

const pingIntent = defineIntent({ id: "ping", title: "Ping", params: {} });

function withInvocation(url: string, invocationId: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}invocationId=${invocationId}`;
}

function createFakeNative() {
  const stored: string[] = [];
  const acked: string[] = [];
  const idOf = (url: string) =>
    new URL(url.replace(/^example:/, "http:")).searchParams.get("invocationId");

  return {
    acked,
    stored,
    module: {
      async clearDonations() {},
      async donate() {},
      async updateDynamicShortcuts() {},
      async getPendingIntentURLs() {
        return [...stored];
      },
      async acknowledgeIntent(invocationId: string) {
        acked.push(invocationId);
        const index = stored.findIndex((url) => idOf(url) === invocationId);

        if (index >= 0) {
          stored.splice(index, 1);
        }
      },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("runtime delivers the same intent twice when each run has its own invocationId", async () => {
  const linking = createLinkingAdapter();
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: linking.adapter,
    nativeModule: createFakeNative().module as never,
  });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  const base = buildIntentUrl("example", pingIntent, {});

  linking.emit(withInvocation(base, "a"));
  await settle();
  linking.emit(withInvocation(base, "b"));
  await settle();
  linking.emit(withInvocation(base, "b"));
  await settle();

  assert.equal(calls, 2);
});

test("runtime still dedupes urls without an invocationId", async () => {
  const linking = createLinkingAdapter();
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: linking.adapter,
    nativeModule: createFakeNative().module as never,
  });
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  const base = buildIntentUrl("example", pingIntent, {});

  linking.emit(base);
  await settle();
  linking.emit(base);
  await settle();

  assert.equal(calls, 1);
});

test("runtime acknowledges a run only after its handlers settle", async () => {
  const linking = createLinkingAdapter();
  const native = createFakeNative();
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: linking.adapter,
    nativeModule: native.module,
  });
  let finish: () => void = () => {};
  runtime.onIntent(
    pingIntent,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );

  linking.emit(withInvocation(buildIntentUrl("example", pingIntent, {}), "slow"));
  await settle();
  assert.deepEqual(native.acked, []);

  finish();
  await settle();
  assert.deepEqual(native.acked, ["slow"]);
});

test("runtime acknowledges a run when its handler throws", async () => {
  const linking = createLinkingAdapter();
  const native = createFakeNative();
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: linking.adapter,
    nativeModule: native.module,
  });
  const originalError = console.error;
  console.error = () => {};
  runtime.onIntent(pingIntent, () => {
    throw new Error("boom");
  });

  linking.emit(withInvocation(buildIntentUrl("example", pingIntent, {}), "bad"));
  await settle();
  console.error = originalError;

  assert.deepEqual(native.acked, ["bad"]);
});

test("an unacknowledged run is delivered again to a fresh runtime", async () => {
  const native = createFakeNative();
  native.stored.push(withInvocation(buildIntentUrl("example", pingIntent, {}), "lost"));
  const makeLinking = () => {
    let listener: ((event: { url: string }) => void) | null = null;

    return {
      addEventListener(_event: "url", next: (event: { url: string }) => void) {
        listener = next;
        void native.module.getPendingIntentURLs().then((urls) => {
          urls.forEach((url) => listener?.({ url }));
        });
        return { remove() {} };
      },
      async getInitialURL() {
        return null;
      },
    };
  };

  const first = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: makeLinking(),
    nativeModule: native.module,
  });
  first.onIntent(pingIntent, () => new Promise<void>(() => {}));
  await settle();
  assert.deepEqual(native.acked, []);
  first.dispose();

  const second = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: makeLinking(),
    nativeModule: native.module,
  });
  let calls = 0;
  second.onIntent(pingIntent, () => {
    calls += 1;
  });
  await settle();

  assert.equal(calls, 1);
  assert.deepEqual(native.acked, ["lost"]);
  assert.deepEqual(native.stored, []);
});

test("runtime keeps an in-flight run known after more than 100 other runs", async () => {
  const native = createFakeNative();
  const linking = createLinkingAdapter();
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: linking.adapter,
    nativeModule: native.module as never,
  });
  const base = buildIntentUrl("example", pingIntent, {});
  let calls = 0;
  let release: () => void = () => {};
  runtime.onIntent(pingIntent, (_params, event) => {
    calls += 1;

    if (event.url.endsWith("slow")) {
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    }
  });

  linking.emit(withInvocation(base, "slow"));
  await settle();

  for (let index = 0; index < 150; index++) {
    linking.emit(withInvocation(base, `n${index}`));
  }

  await settle();
  const before = calls;
  linking.emit(withInvocation(base, "slow"));
  await settle();

  assert.equal(calls, before);
  release();
});

test("runtime keeps a cold-start run for onIntent when the linking adapter reports it as initial", async () => {
  const url = withInvocation(buildIntentUrl("example", pingIntent, {}), "cold");
  const linking = createLinkingAdapter(url);
  const runtime = createAppIntentsRuntime({
    scheme: "example",
    intents: [pingIntent] as const,
    linking: linking.adapter,
    nativeModule: createFakeNative().module as never,
  });
  linking.emit(url);
  await settle();
  let calls = 0;
  runtime.onIntent(pingIntent, () => {
    calls += 1;
  });
  await settle();

  assert.equal(calls, 1);
});
