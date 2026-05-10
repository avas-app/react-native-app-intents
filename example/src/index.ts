import { withAppIntents } from "@react-native-app-intents/expo-plugin";
import { onIntent } from "@react-native-app-intents/react-native";

import { openOrder } from "./orders.intents.js";

export { openOrder };

export const exampleExpoConfig = withAppIntents(
  { name: "react-native-app-intents-example" },
  {
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
  },
);

export function registerExampleRuntime(onOrderOpen: (orderNumber: string) => void): () => void {
  return onIntent(openOrder, ({ orderNumber }) => {
    onOrderOpen(orderNumber);
  });
}
