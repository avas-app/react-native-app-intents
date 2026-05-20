import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { createAppIntentsRuntime } from "@avasapp/react-native-app-intents";

import { openOrder } from "./src/openOrder.intents";

export default function App() {
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const appIntents = useMemo(
    () =>
      createAppIntentsRuntime({
        scheme: "appintentsexpo",
        intents: [openOrder] as const,
      }),
    [],
  );

  useEffect(() => {
    return appIntents.onIntent(openOrder, (params) => {
      setLastOrderNumber(params.orderNumber);
    });
  }, [appIntents]);

  useEffect(() => {
    void appIntents.updateDynamicShortcuts([
      {
        icon: {
          androidResourceName: "@drawable/burger",
          iosTemplateImageName: "burger",
          systemName: "shippingbox",
        },
        intent: openOrder,
        params: { orderNumber: "1234" },
        shortTitle: "Open burger order",
        longTitle: "Open order 1234",
      },
    ]);
  }, [appIntents]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>React Native App Intents</Text>
      <Text>Expo config plugin fixture</Text>
      <Text>Shortcut icon: burger asset</Text>
      <Text>Last order: {lastOrderNumber ?? "none"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
});
