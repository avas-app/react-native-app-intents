import assert from "node:assert/strict";
import test from "node:test";

import { defineIntent, p } from "@react-native-app-intents/core";

import {
  __unsafeTestUtils,
  getInitialIntent,
  onIntent,
  updateDynamicShortcuts,
} from "../src/index.js";

test("runtime handlers receive typed params", async () => {
  __unsafeTestUtils.reset();

  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string(),
    },
  });

  let receivedOrderNumber = "";
  const unsubscribe = onIntent(openOrder, ({ orderNumber }) => {
    receivedOrderNumber = orderNumber;
  });

  await __unsafeTestUtils.dispatchIntent(openOrder, { orderNumber: "1234" });
  const initialIntent = await getInitialIntent(openOrder);

  await updateDynamicShortcuts([
    {
      intent: openOrder,
      params: { orderNumber: "1234" },
      shortTitle: "Open Order 1234",
    },
  ]);

  unsubscribe();

  assert.equal(receivedOrderNumber, "1234");
  assert.deepEqual(initialIntent, {
    id: "openOrder",
    params: { orderNumber: "1234" },
  });
  assert.equal(__unsafeTestUtils.getDynamicShortcuts()[0]?.shortTitle, "Open Order 1234");
});
