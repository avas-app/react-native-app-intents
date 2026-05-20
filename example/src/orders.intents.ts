import { defineEntity, defineIntent, p } from "@avasapp/react-native-app-intents";

export const Order = defineEntity({
  id: "Order",
  inventory: [{ customer: "Taylor", id: 1, number: "1234" }],
  schema: p.object({
    id: p.int(),
    number: p.string(),
    customer: p.string(),
  }),
  title: "Order",
  identifier: (order) => String(order.id),
  displayRepresentation: (order) => ({
    title: `Order #${order.number}`,
    subtitle: order.customer,
    image: { systemName: "bag" },
  }),
  query: ({ ids, search }) => {
    const inventory = [{ customer: "Taylor", id: 1, number: "1234" }] as const;

    if (ids && ids.length > 0) {
      return inventory.filter((order) => ids.includes(String(order.id)));
    }

    if (search) {
      return inventory.filter((order) =>
        `${order.number} ${order.customer}`.toLowerCase().includes(search.toLowerCase()),
      );
    }

    return inventory;
  },
});

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  description: "Open a specific order by number.",
  phrases: ["Open order ${orderNumber} in ${.applicationName}", "Show my order ${orderNumber}"],
  params: {
    orderNumber: p.string({
      androidBiiParam: "order",
      default: "1234",
      title: "Order number",
      prompt: "Which order?",
      requestValueDialog: "What's the order number?",
    }),
  },
  surfaces: {
    spotlight: true,
    appShortcut: {
      icon: {
        androidResourceName: "@mipmap/ic_launcher_round",
        systemName: "shippingbox",
      },
    },
  },
  android: {
    appAction: {
      capability: "actions.intent.GET_ORDER",
    },
  },
  ios: {
    appIntent: {},
  },
  behavior: { opensAppToForeground: true },
});

export const openSavedOrder = defineIntent({
  id: "openSavedOrder",
  title: "Open Saved Order",
  description: "Open a saved order from inventory.",
  phrases: ["Open ${order} in ${.applicationName}", "Show ${order}"],
  params: {
    order: p.entity(Order, {
      androidBiiParam: "order",
      default: { customer: "Taylor", id: 1, number: "1234" },
      title: "Order",
      requestValueDialog: "Which order?",
    }),
  },
  surfaces: {
    spotlight: true,
    appShortcut: true,
  },
  android: {
    appAction: {
      capability: "actions.intent.GET_ORDER",
    },
  },
  ios: {
    appIntent: {},
  },
  behavior: { opensAppToForeground: true },
});
