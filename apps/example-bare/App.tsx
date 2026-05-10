import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { exampleRuntime, openOrder, openSavedOrder } from "@react-native-app-intents/example";

interface EventLogEntry {
  id: string;
  params: Record<string, unknown>;
}

const INITIAL_INTENT_ATTEMPTS = 12;
const INITIAL_INTENT_RETRY_DELAY_MS = 250;
const INITIAL_INTENT_STARTUP_WINDOW_MS = 60000;

function App(): ReactElement {
  const isDarkMode = useColorScheme() === "dark";

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <SafeAreaView style={styles.safeArea}>
        <AppContent />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AppContent(): ReactElement {
  const [initialIntentId, setInitialIntentId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const savedOrder = useMemo(() => ({ customer: "Taylor", id: 1, number: "1234" }), []);
  const simulateIntentUrl = useMemo(
    () => exampleRuntime.buildUrl(openOrder, { orderNumber: "1234" }),
    [],
  );
  const simulateSavedIntentUrl = useMemo(
    () => exampleRuntime.buildUrl(openSavedOrder, { order: savedOrder }),
    [savedOrder],
  );

  useEffect(() => {
    let mounted = true;
    let unsubscribe = () => {};
    let initialIntentCaptured = false;
    const startupStartedAt = Date.now();

    void (async () => {
      for (let attempt = 0; attempt < INITIAL_INTENT_ATTEMPTS; attempt += 1) {
        const event = await exampleRuntime.getInitialIntent();

        if (!mounted) {
          return;
        }

        if (event) {
          initialIntentCaptured = true;
          setInitialIntentId(event.id);
          setEvents((current) => [
            { id: event.id, params: event.params as Record<string, unknown> },
            ...current,
          ]);
          break;
        }

        if (attempt < INITIAL_INTENT_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, INITIAL_INTENT_RETRY_DELAY_MS));
        }
      }

      if (!mounted) {
        return;
      }

      unsubscribe = exampleRuntime.onAnyIntent((event) => {
        if (
          !initialIntentCaptured &&
          Date.now() - startupStartedAt <= INITIAL_INTENT_STARTUP_WINDOW_MS
        ) {
          initialIntentCaptured = true;
          setInitialIntentId(event.id);
        }

        setEvents((current) => [
          { id: event.id, params: event.params as Record<string, unknown> },
          ...current,
        ]);
      });
    })();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>react-native-app-intents</Text>
      <Text style={styles.heading}>Bare React Native reference app</Text>
      <Text style={styles.body}>
        This screen logs app-intent callbacks delivered through the shared JS runtime.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Current test URL</Text>
        <Text selectable style={styles.code}>
          {simulateIntentUrl}
        </Text>
        <Text selectable style={styles.code}>
          {simulateSavedIntentUrl}
        </Text>
        <View style={styles.actions}>
          <Button
            onPress={() => {
              void Linking.openURL(simulateIntentUrl);
            }}
            title="Simulate intent URL"
          />
          <Button
            onPress={() => {
              void Linking.openURL(simulateSavedIntentUrl);
            }}
            title="Simulate saved order URL"
          />
          <Button
            onPress={() => {
              void exampleRuntime.donate(openOrder, { orderNumber: "1234" });
            }}
            title="Donate intent"
          />
          <Button
            onPress={() => {
              void exampleRuntime.updateDynamicShortcuts([
                {
                  intent: openOrder,
                  params: { orderNumber: "1234" },
                  shortTitle: "Open Order 1234",
                  longTitle: "Open order 1234 in the example app",
                },
                {
                  intent: openSavedOrder,
                  params: { order: savedOrder },
                  shortTitle: "Open Saved Order",
                  longTitle: "Open saved order 1234 in the example app",
                },
              ]);
            }}
            title="Update shortcuts"
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Initial intent</Text>
        <Text style={styles.body}>
          {initialIntentId ?? "No initial app-intent URL was consumed."}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Event log</Text>
        {events.length === 0 ? (
          <Text style={styles.body}>No callbacks received yet.</Text>
        ) : (
          events.map((event, index) => (
            <View key={`${event.id}-${index}`} style={styles.eventEntry}>
              <Text style={styles.eventTitle}>{event.id}</Text>
              <Text selectable style={styles.code}>
                {JSON.stringify(event.params, null, 2)}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
  },
  body: {
    color: "#d1d5db",
    fontSize: 16,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#111827",
    borderColor: "#1f2937",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  cardTitle: {
    color: "#f9fafb",
    fontSize: 18,
    fontWeight: "600",
  },
  code: {
    color: "#93c5fd",
    fontFamily: "Menlo",
    fontSize: 14,
  },
  content: {
    backgroundColor: "#030712",
    gap: 16,
    padding: 24,
  },
  eyebrow: {
    color: "#60a5fa",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  eventEntry: {
    borderTopColor: "#1f2937",
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingTop: 12,
  },
  eventTitle: {
    color: "#f9fafb",
    fontSize: 16,
    fontWeight: "600",
  },
  heading: {
    color: "#f9fafb",
    fontSize: 28,
    fontWeight: "700",
  },
  safeArea: {
    backgroundColor: "#030712",
    flex: 1,
  },
});

export default App;
