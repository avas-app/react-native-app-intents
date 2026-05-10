import { defineIntent, p } from "@react-native-app-intents/core";

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  description: "Open a specific order by number.",
  phrases: ["Open order ${orderNumber} in ${.applicationName}", "Show my order ${orderNumber}"],
  params: {
    orderNumber: p.string({
      title: "Order number",
      prompt: "Which order?",
      requestValueDialog: "What's the order number?",
    }),
  },
  surfaces: {
    siri: true,
    spotlight: true,
    appShortcut: true,
    assistant: true,
  },
  androidBii: "actions.intent.GET_ORDER",
  behavior: { opensAppToForeground: true },
});
