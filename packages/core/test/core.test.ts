import assert from "node:assert/strict";
import test from "node:test";

import { defineEntity, defineIntent, p, type ParamsOf } from "../src/index.js";

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
