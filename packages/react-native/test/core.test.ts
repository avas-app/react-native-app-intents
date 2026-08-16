import assert from "node:assert/strict";
import test from "node:test";

import {
  defineEntity,
  defineIntent,
  normalizeEntityDefinition,
  normalizeIntentDefinitions,
  normalizeReferencedEntities,
  p,
  type ParamsOf,
} from "../src/core/index.js";

test("defineIntent preserves typed params", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    description: "Open a specific order.",
    params: {
      orderNumber: p.string({ title: "Order number" }),
    },
  });

  const params: ParamsOf<typeof openOrder> = { orderNumber: "1234" };

  assert.equal(params.orderNumber, "1234");
});

test("optional params stay optional", () => {
  const focusOrder = defineIntent({
    id: "focusOrder",
    title: "Focus Order",
    params: {
      orderNumber: p.string({ optional: true }),
    },
  });

  const params: ParamsOf<typeof focusOrder> = {};

  assert.deepEqual(params, {});
});

test("defineEntity captures object shapes", async () => {
  const Order = defineEntity({
    id: "Order",
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
    query: async () => [{ id: 1, number: "1234", customer: "Taylor" }],
  });

  const results = await Order.query?.({});

  assert.equal(results?.[0]?.number, "1234");
});

test("normalizeEntityDefinition captures static inventory metadata", () => {
  const Order = defineEntity({
    id: "Order",
    inventory: [{ id: 1, number: "1234", customer: "Taylor" }],
    schema: p.object({
      id: p.int(),
      number: p.string(),
      customer: p.string(),
    }),
    identifier: (order) => String(order.id),
    displayRepresentation: (order) => ({
      title: `Order #${order.number}`,
      subtitle: order.customer,
      image: { systemName: "bag" },
    }),
  });

  const normalized = normalizeEntityDefinition(Order);

  assert.equal(normalized.title, "Order");
  assert.equal(normalized.inventory[0]?.identifier, "1");
  assert.equal(normalized.inventory[0]?.displayRepresentation.imageSystemName, "bag");
  assert.equal(normalized.inventory[0]?.jsonValue, '{"id":1,"number":"1234","customer":"Taylor"}');
});

test("normalizeIntentDefinitions derives app shortcut phrases", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    phrases: ["Show my order ${orderNumber}"],
    params: {
      orderNumber: p.string(),
    },
    surfaces: {
      appShortcut: true,
    },
  });

  const [normalized] = normalizeIntentDefinitions([openOrder]);

  assert.equal(normalized?.phrases[0]?.appShortcutPhrase, "Show my order in ${.applicationName}");
});

test("normalizeIntentDefinitions captures app shortcut icon metadata", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    phrases: ["Show my order ${orderNumber}"],
    params: {
      orderNumber: p.string(),
    },
    surfaces: {
      appShortcut: {
        icon: {
          androidResourceName: "@mipmap/ic_launcher_round",
          systemName: "shippingbox",
        },
      },
    },
  });

  const [normalized] = normalizeIntentDefinitions([openOrder]);

  assert.equal(normalized?.surfaces.appShortcut, true);
  assert.equal(normalized?.appShortcut.iconAndroidResourceName, "@mipmap/ic_launcher_round");
  assert.equal(normalized?.appShortcut.iconSystemName, "shippingbox");
});

test("normalizeIntentDefinitions captures android app action metadata", () => {
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
        fulfillment: "deeplink",
        inventory: {
          strategy: "dynamic",
        },
      },
    },
  });

  const [normalized] = normalizeIntentDefinitions([openOrder]);

  assert.equal(normalized?.surfaces.assistant, true);
  assert.equal(normalized?.android?.appAction?.capabilityName, "actions.intent.GET_ORDER");
  assert.equal(normalized?.android?.appAction?.fulfillment, "deeplink");
  assert.equal(normalized?.android?.appAction?.inventoryStrategy, "dynamic");
});

test("normalizeIntentDefinitions rejects assistant surface without android app action config", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {},
    surfaces: {
      assistant: true,
    },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /surfaces\.assistant no longer enables Android App Actions by itself/,
  );
});

test("normalizeIntentDefinitions captures ios app intent metadata", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
    ios: {
      appIntent: {
        response: {
          dialog: "Order opened.",
        },
      },
    },
  });

  const [normalized] = normalizeIntentDefinitions([openOrder]);

  assert.equal(normalized?.surfaces.siri, true);
  assert.equal(normalized?.ios?.appIntent?.response?.dialog, "Order opened.");
});

test("normalizeIntentDefinitions rejects siri surface without ios app intent config", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {},
    surfaces: {
      siri: true,
    },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /surfaces\.siri no longer enables iOS App Intents by itself/,
  );
});

test("normalizeIntentDefinitions rejects dialog responses that open the app", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {},
    behavior: {
      opensAppToForeground: true,
    },
    ios: {
      appIntent: {
        response: {
          dialog: "Order opened.",
        },
      },
    },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /ios\.appIntent\.response\.dialog cannot be combined with behavior\.opensAppToForeground/,
  );
});

test("normalizeIntentDefinitions rejects object params in phrases", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    phrases: ["Open ${shippingAddress} in ${.applicationName}"],
    params: {
      shippingAddress: p.object({
        street: p.string(),
      }),
    },
    surfaces: {
      appShortcut: true,
    },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /cannot interpolate object parameter "shippingAddress"/,
  );
});

test("normalizeIntentDefinitions validates required android app action parameters", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
    android: {
      appAction: {
        capability: "actions.intent.GET_ORDER",
      },
    },
  });

  assert.throws(() => normalizeIntentDefinitions([openOrder]), /requires parameter "order"/);
});

test("normalizeIntentDefinitions rejects unsupported android app action parameters", () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string({
        androidBiiParam: "orderNumber",
      }),
    },
    android: {
      appAction: {
        capability: "actions.intent.GET_ORDER",
      },
    },
  });

  assert.throws(
    () => normalizeIntentDefinitions([openOrder]),
    /does not support parameter "orderNumber"/,
  );
});

test("normalizeReferencedEntities discovers entity dependencies from intent params", () => {
  const Order = defineEntity({
    id: "Order",
    inventory: [{ id: 1, number: "1234", customer: "Taylor" }],
    schema: p.object({
      id: p.int(),
      number: p.string(),
      customer: p.string(),
    }),
    identifier: (order) => String(order.id),
    displayRepresentation: (order) => ({
      title: `Order #${order.number}`,
    }),
  });
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    phrases: ["Open ${order}"],
    params: {
      order: p.entity(Order, {
        androidBiiParam: "order",
        default: { id: 1, number: "1234", customer: "Taylor" },
      }),
    },
    surfaces: {
      appShortcut: true,
    },
  });

  const entities = normalizeReferencedEntities([openOrder]);

  assert.equal(entities[0]?.id, "Order");
  assert.equal(entities[0]?.inventory[0]?.displayRepresentation.title, "Order #1234");
});
