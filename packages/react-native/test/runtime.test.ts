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
