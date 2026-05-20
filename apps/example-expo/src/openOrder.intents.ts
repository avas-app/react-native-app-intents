import { defineIntent, p } from "@avasapp/react-native-app-intents";

export const openOrder = defineIntent({
  id: "openOrder",
  title: "Open Order",
  phrases: ["Open order ${orderNumber} in ${.applicationName}"],
  params: {
    orderNumber: p.string({
      androidBiiParam: "order",
      title: "Order number",
      default: "1234",
    }),
  },
  surfaces: {
    spotlight: true,
    appShortcut: {
      icon: {
        androidResourceName: "@drawable/burger",
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
});
