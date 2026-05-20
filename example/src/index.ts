import {
  createAppIntentsRuntime,
  type AppIntentsNativeModule,
  type LinkingAdapter,
} from "@avasapp/react-native-app-intents";

import { openOrder, openSavedOrder } from "./orders.intents.js";

export { openOrder, openSavedOrder };

export const exampleIntents = [openOrder, openSavedOrder] as const;
const INITIAL_NATIVE_URL_POLL_ATTEMPTS = 240;
const INITIAL_NATIVE_URL_POLL_INTERVAL_MS = 250;
const nativeModule = getNativeModule();
const linking = getLinking(nativeModule);

declare const require: undefined | ((specifier: string) => unknown);

function getNativeModule(): AppIntentsNativeModule | undefined {
  if (typeof require !== "function") {
    return undefined;
  }

  const reactNative = require("react-native") as {
    TurboModuleRegistry?: {
      get<TModule>(name: string): TModule | null;
    };
  };

  return (
    reactNative.TurboModuleRegistry?.get<AppIntentsNativeModule>("ReactNativeAppIntents") ??
    undefined
  );
}

function getLinking(nativeModule: AppIntentsNativeModule | undefined): LinkingAdapter | undefined {
  if (typeof require !== "function") {
    return undefined;
  }

  const reactNative = require("react-native") as {
    AppState: {
      addEventListener(event: "change", listener: (state: string) => void): { remove(): void };
    };
    Linking: LinkingAdapter;
    NativeEventEmitter: new (module: unknown) => {
      addListener(
        eventName: string,
        listener: (event: { url: string }) => void,
      ): { remove(): void };
    };
  };
  const nativeEmitter = nativeModule ? new reactNative.NativeEventEmitter(nativeModule) : null;

  return {
    addEventListener(_event, listener) {
      const subscriptions: { remove(): void }[] = [];
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let remainingPollAttempts = INITIAL_NATIVE_URL_POLL_ATTEMPTS;
      const emitPendingNativeUrl = async (): Promise<void> => {
        if (!nativeModule?.getInitialIntentURL) {
          return;
        }

        const url = await nativeModule.getInitialIntentURL();

        if (url) {
          listener({ url });
        }
      };
      const schedulePendingNativeUrlPoll = (): void => {
        if (remainingPollAttempts <= 0) {
          return;
        }

        pollTimeout = setTimeout(() => {
          remainingPollAttempts -= 1;
          void emitPendingNativeUrl().finally(schedulePendingNativeUrlPoll);
        }, INITIAL_NATIVE_URL_POLL_INTERVAL_MS);
      };

      if (nativeEmitter) {
        subscriptions.push(nativeEmitter.addListener("appIntentUrl", listener));
      }

      subscriptions.push(
        reactNative.AppState.addEventListener("change", (state) => {
          if (state === "active") {
            void emitPendingNativeUrl();
          }
        }),
      );
      subscriptions.push(reactNative.Linking.addEventListener("url", listener));
      void emitPendingNativeUrl();
      schedulePendingNativeUrlPoll();

      return {
        remove(): void {
          if (pollTimeout) {
            clearTimeout(pollTimeout);
            pollTimeout = null;
          }

          subscriptions.forEach((subscription) => subscription.remove());
        },
      };
    },
    async getInitialURL(): Promise<string | null> {
      if (nativeModule?.getInitialIntentURL) {
        const url = await nativeModule.getInitialIntentURL();

        if (url) {
          return url;
        }
      }

      return reactNative.Linking.getInitialURL();
    },
  };
}

export const exampleRuntime = createAppIntentsRuntime({
  scheme: "example",
  intents: exampleIntents,
  ...(linking ? { linking } : {}),
  ...(nativeModule ? { nativeModule } : {}),
});

export function registerExampleRuntime(
  onOrderOpen: (orderNumber: string) => void,
  onSavedOrderOpen?: (order: { customer: string; id: number; number: string }) => void,
): () => void {
  const unsubscribeOrder = exampleRuntime.onIntent(openOrder, ({ orderNumber }) => {
    onOrderOpen(orderNumber);
  });
  const unsubscribeSavedOrder = onSavedOrderOpen
    ? exampleRuntime.onIntent(openSavedOrder, ({ order }) => {
        onSavedOrderOpen(order);
      })
    : () => {};

  return () => {
    unsubscribeOrder();
    unsubscribeSavedOrder();
  };
}
