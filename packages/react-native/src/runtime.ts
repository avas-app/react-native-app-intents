import type {
  AnyParameterDefinition,
  DynamicShortcutIcon,
  IntentDefinition,
  ParamsOf,
} from "./core/index.js";
import type {
  AppIntentsNativeModule,
  NativeShortcutCapabilityBinding,
  NativeShortcutPayload,
} from "./native.js";

type MaybePromise = void | Promise<void>;

type IntentTuple = readonly IntentDefinition<any>[];

export type IntentEvent<TIntent extends IntentDefinition<any> = IntentDefinition<any>> = {
  id: TIntent["id"];
  intent: TIntent;
  params: ParamsOf<TIntent>;
  url: string;
};

export type IntentEventUnion<TIntents extends IntentTuple> = {
  [Index in keyof TIntents]: TIntents[Index] extends IntentDefinition<any>
    ? IntentEvent<TIntents[Index]>
    : never;
}[number];

export interface DynamicShortcut<TIntent extends IntentDefinition<any> = IntentDefinition<any>> {
  id?: string;
  icon?: DynamicShortcutIcon;
  intent: TIntent;
  params: ParamsOf<TIntent>;
  shortTitle?: string;
  longTitle?: string;
}

export interface LinkingAdapter {
  addEventListener(event: "url", listener: (event: { url: string }) => void): { remove(): void };
  getInitialURL(): Promise<string | null>;
}

export interface CreateAppIntentsRuntimeOptions<TIntents extends IntentTuple> {
  scheme: string;
  intents: TIntents;
  linking?: LinkingAdapter;
  nativeModule?: AppIntentsNativeModule;
}

const SEEN_INVOCATION_LIMIT = 100;

function getInvocationId(url: string): string | null {
  const queryStart = url.indexOf("?");

  return queryStart < 0 ? null : new URLSearchParams(url.slice(queryStart + 1)).get("invocationId");
}

interface QueuedEvent<TIntents extends IntentTuple> {
  event: IntentEventUnion<TIntents>;
  invocationId: string | null;
}

interface RuntimeContext<TIntents extends IntentTuple> {
  scheme: string;
  intentsById: Map<string, TIntents[number]>;
}

interface TurboModuleRegistryLike {
  get<TModule>(name: string): TModule | null;
}

declare const require: undefined | ((specifier: string) => unknown);

function getReactNativeAppIntentsModule(reactNative: {
  NativeModules?: {
    ReactNativeAppIntents?: AppIntentsNativeModule;
  };
  TurboModuleRegistry?: TurboModuleRegistryLike;
}): AppIntentsNativeModule | undefined {
  const nativeModule = reactNative.NativeModules?.ReactNativeAppIntents;

  if (nativeModule) {
    return nativeModule;
  }

  return (
    reactNative.TurboModuleRegistry?.get<AppIntentsNativeModule>("ReactNativeAppIntents") ??
    undefined
  );
}

function getDefaultLinking(providedNativeModule?: AppIntentsNativeModule): LinkingAdapter {
  if (typeof require !== "function") {
    return {
      addEventListener(): { remove(): void } {
        return {
          remove(): void {},
        };
      },
      async getInitialURL(): Promise<string | null> {
        return null;
      },
    };
  }

  const reactNative = require("react-native") as {
    AppState: {
      addEventListener(event: "change", listener: (state: string) => void): { remove(): void };
    };
    NativeEventEmitter: new (module: unknown) => {
      addListener(
        eventName: string,
        listener: (event: { url: string }) => void,
      ): { remove(): void };
    };
    Linking: LinkingAdapter;
    Platform?: { OS?: string };
    NativeModules: {
      ReactNativeAppIntents?: AppIntentsNativeModule;
    };
    TurboModuleRegistry?: TurboModuleRegistryLike;
  };
  const nativeModule = providedNativeModule ?? getReactNativeAppIntentsModule(reactNative);
  const nativeEmitter = nativeModule ? new reactNative.NativeEventEmitter(nativeModule) : null;
  // With a pending list, native is the single source for app-intents runs; Linking carries a copy without the id.
  const nativeOwnsIntents = Boolean(nativeModule?.getPendingIntentURLs);
  // iOS openURL links never reach the native queue, so there Linking is their only copy.
  const dropLinkingIntentUrls = nativeOwnsIntents && reactNative.Platform?.OS === "android";
  const isIntentHostUrl = (url: string | null | undefined): boolean =>
    typeof url === "string" && /^[^:/?#]+:\/\/app-intents(?:[/?#]|$)/.test(url);

  // An old module pops one run per read; keep the first so getInitialURL and the listener both see it.
  let oldModuleInitialUrl: Promise<string | null> | null = null;
  const readOldModuleInitialUrl = (): Promise<string | null> => {
    oldModuleInitialUrl ??= Promise.resolve(nativeModule?.getInitialIntentURL?.() ?? null);

    return oldModuleInitialUrl;
  };
  let oldModuleInitialEmitted = false;

  return {
    addEventListener(_event, listener) {
      const subscriptions: { remove(): void }[] = [];
      const emitPendingNativeUrls = async (): Promise<void> => {
        try {
          if (nativeModule?.getPendingIntentURLs) {
            for (const url of await nativeModule.getPendingIntentURLs()) {
              listener({ url });
            }
          } else if (nativeModule?.getInitialIntentURL) {
            const first = oldModuleInitialEmitted ? null : await readOldModuleInitialUrl();
            oldModuleInitialEmitted = true;

            if (first) {
              listener({ url: first });
            }

            for (let url = await nativeModule.getInitialIntentURL(); url; ) {
              listener({ url });
              url = await nativeModule.getInitialIntentURL();
            }
          }
        } catch {
          // A failed read is retried on the next AppState "active".
        }
      };

      if (nativeEmitter) {
        subscriptions.push(nativeEmitter.addListener("appIntentUrl", listener));
      }

      subscriptions.push(
        reactNative.AppState.addEventListener("change", (state) => {
          if (state === "active") {
            void emitPendingNativeUrls();
          }
        }),
      );
      subscriptions.push(
        reactNative.Linking.addEventListener("url", (event) => {
          if (dropLinkingIntentUrls && isIntentHostUrl(event.url)) {
            return;
          }

          listener(event);
        }),
      );
      void emitPendingNativeUrls();

      return {
        remove(): void {
          subscriptions.forEach((subscription) => subscription.remove());
        },
      };
    },
    async getInitialURL(): Promise<string | null> {
      if (nativeOwnsIntents) {
        const linkingUrl = await reactNative.Linking.getInitialURL();

        return dropLinkingIntentUrls && isIntentHostUrl(linkingUrl) ? null : linkingUrl;
      }

      if (nativeModule?.getInitialIntentURL) {
        const url = await readOldModuleInitialUrl();

        if (url) {
          return url;
        }
      }

      return reactNative.Linking.getInitialURL();
    },
  };
}

function getNativeModule(): AppIntentsNativeModule {
  if (typeof require !== "function") {
    return {
      async clearDonations(): Promise<void> {},
      async donate(): Promise<void> {},
      async updateDynamicShortcuts(): Promise<void> {},
    };
  }

  const reactNative = require("react-native") as {
    NativeModules: {
      ReactNativeAppIntents?: AppIntentsNativeModule;
    };
    TurboModuleRegistry?: TurboModuleRegistryLike;
  };

  return (
    getReactNativeAppIntentsModule(reactNative) ?? {
      async clearDonations(): Promise<void> {},
      async donate(): Promise<void> {},
      async updateDynamicShortcuts(): Promise<void> {},
    }
  );
}

function resolveLocalizedText(
  value: string | Record<string, string> | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  if ("en" in value && typeof value.en === "string") {
    return value.en;
  }

  const firstEntry = Object.values(value)[0];

  return typeof firstEntry === "string" ? firstEntry : fallback;
}

function serializeParameterValue(definition: AnyParameterDefinition, value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  switch (definition.kind) {
    case "date":
      return value instanceof Date ? value.toISOString() : value;
    case "entity":
      return serializeEntityValue(definition, value);
    case "object": {
      if (typeof value !== "object" || value === null) {
        return value;
      }

      const serialized: Record<string, unknown> = {};

      for (const [key, field] of Object.entries(definition.fields)) {
        serialized[key] = serializeParameterValue(field, (value as Record<string, unknown>)[key]);
      }

      return serialized;
    }
    default:
      return value;
  }
}

function serializeEntityValue(
  definition: Extract<AnyParameterDefinition, { kind: "entity" }>,
  value: unknown,
): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const serialized: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(definition.entity.schema.fields) as [
    string,
    AnyParameterDefinition,
  ][]) {
    serialized[key] = serializeParameterValue(field, (value as Record<string, unknown>)[key]);
  }

  return serialized;
}

function deserializeParameterValue(definition: AnyParameterDefinition, value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  switch (definition.kind) {
    case "string":
      return String(value);
    case "int": {
      const parsed = Number.parseInt(String(value), 10);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case "number": {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case "bool":
      if (typeof value === "boolean") {
        return value;
      }

      return String(value).toLowerCase() === "true";
    case "date":
      return value instanceof Date ? value : new Date(String(value));
    case "entity": {
      if (typeof value !== "object" || value === null) {
        return value;
      }

      const parsed: Record<string, unknown> = {};

      for (const [key, field] of Object.entries(definition.entity.schema.fields) as [
        string,
        AnyParameterDefinition,
      ][]) {
        parsed[key] = deserializeParameterValue(field, (value as Record<string, unknown>)[key]);
      }

      return parsed;
    }
    case "object": {
      if (typeof value !== "object" || value === null) {
        return value;
      }

      const parsed: Record<string, unknown> = {};

      for (const [key, field] of Object.entries(definition.fields)) {
        parsed[key] = deserializeParameterValue(field, (value as Record<string, unknown>)[key]);
      }

      return parsed;
    }
  }
}

export function serializeIntentParams<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
  params: ParamsOf<TIntent>,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  for (const [key, definition] of Object.entries(intent.params) as [
    string,
    TIntent["params"][string],
  ][]) {
    const value = params[key as keyof ParamsOf<TIntent>];

    if (value !== undefined) {
      serialized[key] = serializeParameterValue(definition, value);
    }
  }

  return serialized;
}

function resolveAndroidCapabilityBindingValue(
  definition: AnyParameterDefinition,
  value: unknown,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  switch (definition.kind) {
    case "date":
      return value instanceof Date ? value.toISOString() : String(value);
    case "entity": {
      try {
        const displayRepresentation = definition.entity.displayRepresentation(value as never);

        if (displayRepresentation.title) {
          return displayRepresentation.title;
        }
      } catch {}

      try {
        return definition.entity.identifier(value as never);
      } catch {}

      return typeof value === "string"
        ? value
        : JSON.stringify(serializeEntityValue(definition, value));
    }
    case "object":
      return JSON.stringify(serializeParameterValue(definition, value));
    default:
      return String(value);
  }
}

function getAndroidCapabilityBindings<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
  params: ParamsOf<TIntent>,
): readonly NativeShortcutCapabilityBinding[] {
  const capabilityName = intent.android?.appAction?.capability ?? intent.androidBii;

  if (!capabilityName) {
    return [];
  }

  const parameterBindings = (
    Object.entries(intent.params) as [string, AnyParameterDefinition][]
  ).flatMap(([paramName, definition]) => {
    if (!definition.androidBiiParam) {
      return [];
    }

    const value = resolveAndroidCapabilityBindingValue(
      definition,
      params[paramName as keyof ParamsOf<TIntent>],
    );

    if (value === null) {
      return [];
    }

    return [{ key: definition.androidBiiParam, value }];
  });

  return [{ capabilityName, parameterBindings }];
}

export function deserializeIntentParams<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
  params: Record<string, unknown>,
): ParamsOf<TIntent> {
  const parsed: Record<string, unknown> = {};

  for (const [key, definition] of Object.entries(intent.params) as [
    string,
    TIntent["params"][string],
  ][]) {
    const value = params[key];

    if (value !== undefined) {
      parsed[key] = deserializeParameterValue(definition, value);
    }
  }

  return parsed as ParamsOf<TIntent>;
}

interface ParsedIntentUrl {
  host: string;
  pathSegments: string[];
  payload: string | null;
  scheme: string;
}

function parseCustomSchemeUrl(url: string): ParsedIntentUrl | null {
  const schemeSeparator = url.indexOf(":");

  if (schemeSeparator <= 0) {
    return null;
  }

  const scheme = url.slice(0, schemeSeparator);
  let remainder = url.slice(schemeSeparator + 1);

  if (remainder.startsWith("//")) {
    remainder = remainder.slice(2);
  }

  const [pathAndHost = "", query = ""] = remainder.split("?", 2);
  const slashIndex = pathAndHost.indexOf("/");
  const host = slashIndex >= 0 ? pathAndHost.slice(0, slashIndex) : pathAndHost;
  const rawPath = slashIndex >= 0 ? pathAndHost.slice(slashIndex) : "/";
  const payload = new URLSearchParams(query).get("payload");

  return {
    host,
    pathSegments: rawPath
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment)),
    payload,
    scheme,
  };
}

export function buildIntentUrl<TIntent extends IntentDefinition<any>>(
  scheme: string,
  intent: TIntent,
  params: ParamsOf<TIntent>,
): string {
  const payload = encodeURIComponent(JSON.stringify(serializeIntentParams(intent, params)));

  return `${scheme}://app-intents/${encodeURIComponent(intent.id)}?payload=${payload}`;
}

export function parseIntentUrl<TIntents extends IntentTuple>(
  context: RuntimeContext<TIntents>,
  url: string,
): IntentEventUnion<TIntents> | null {
  const parsedUrl = parseCustomSchemeUrl(url);

  if (!parsedUrl || parsedUrl.scheme !== context.scheme) {
    return null;
  }

  const pathSegments =
    parsedUrl.host === "app-intents"
      ? parsedUrl.pathSegments
      : parsedUrl.pathSegments[0] === "app-intents"
        ? parsedUrl.pathSegments.slice(1)
        : [];
  const [intentId] = pathSegments;

  if (!intentId) {
    return null;
  }

  const intent = context.intentsById.get(intentId);

  if (!intent) {
    return null;
  }

  let payload: unknown = {};

  if (parsedUrl.payload) {
    try {
      payload = JSON.parse(parsedUrl.payload);
    } catch {
      return null;
    }
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  return {
    id: intent.id,
    intent,
    params: deserializeIntentParams(intent, payload as Record<string, unknown>),
    url,
  } as IntentEventUnion<TIntents>;
}

export interface AppIntentsRuntime<TIntents extends IntentTuple> {
  buildUrl<TIntent extends TIntents[number]>(intent: TIntent, params: ParamsOf<TIntent>): string;
  clearDonations(): Promise<void>;
  dispose(): void;
  donate<TIntent extends TIntents[number]>(
    intent: TIntent,
    params: ParamsOf<TIntent>,
  ): Promise<void>;
  getInitialIntent(): Promise<IntentEventUnion<TIntents> | null>;
  onAnyIntent(handler: (event: IntentEventUnion<TIntents>) => MaybePromise): () => void;
  onIntent<TIntent extends TIntents[number]>(
    intent: TIntent,
    handler: (params: ParamsOf<TIntent>, event: IntentEvent<TIntent>) => MaybePromise,
  ): () => void;
  updateDynamicShortcuts(shortcuts: readonly DynamicShortcut<TIntents[number]>[]): Promise<void>;
}

export function createAppIntentsRuntime<const TIntents extends IntentTuple>(
  options: CreateAppIntentsRuntimeOptions<TIntents>,
): AppIntentsRuntime<TIntents> {
  const nativeModule = options.nativeModule ?? getNativeModule();
  const linking = options.linking ?? getDefaultLinking(nativeModule);
  const context: RuntimeContext<TIntents> = {
    scheme: options.scheme,
    intentsById: new Map(options.intents.map((intent) => [intent.id, intent])),
  };

  const anyIntentHandlers = new Set<(event: IntentEventUnion<TIntents>) => MaybePromise>();
  const intentHandlers = new Map<
    string,
    Set<(event: IntentEventUnion<TIntents>) => MaybePromise>
  >();
  const initialUrlPromise = linking.getInitialURL();
  const pendingEvents: QueuedEvent<TIntents>[] = [];
  let flushingPendingEvents = false;
  let lastHandledUrl: string | null = null;
  const seenInvocationIds = new Set<string>();
  // Queued or running ids stay here unbounded until acked, so the bounded set can't evict them.
  const liveInvocationIds = new Set<string>();

  function isKnown(invocationId: string): boolean {
    return seenInvocationIds.has(invocationId) || liveInvocationIds.has(invocationId);
  }

  function markSeen(invocationId: string | null): void {
    if (!invocationId) {
      return;
    }

    seenInvocationIds.add(invocationId);
    liveInvocationIds.add(invocationId);

    if (seenInvocationIds.size > SEEN_INVOCATION_LIMIT) {
      const oldest = seenInvocationIds.values().next().value;

      if (oldest !== undefined) {
        seenInvocationIds.delete(oldest);
      }
    }
  }

  function acknowledge(invocationId: string | null): void {
    if (!invocationId) {
      return;
    }

    if (!nativeModule.acknowledgeIntent) {
      liveInvocationIds.delete(invocationId);
      return;
    }

    try {
      void Promise.resolve(nativeModule.acknowledgeIntent(invocationId))
        .catch(() => {})
        .then(() => {
          liveInvocationIds.delete(invocationId);
        });
    } catch {
      // The run stays stored and is delivered again on the next launch.
      liveInvocationIds.delete(invocationId);
    }
  }

  function hasMatchingHandlers(event: IntentEventUnion<TIntents>): boolean {
    return anyIntentHandlers.size > 0 || (intentHandlers.get(event.id)?.size ?? 0) > 0;
  }

  async function deliverQueuedEvent(queued: QueuedEvent<TIntents>): Promise<void> {
    try {
      for (const handler of anyIntentHandlers) {
        await handler(queued.event);
      }

      for (const handler of intentHandlers.get(queued.event.id) ?? []) {
        await handler(queued.event);
      }
    } finally {
      acknowledge(queued.invocationId);
    }
  }

  async function flushPendingEvents(): Promise<void> {
    if (flushingPendingEvents || pendingEvents.length === 0) {
      return;
    }

    flushingPendingEvents = true;

    try {
      const remainingEvents: QueuedEvent<TIntents>[] = [];

      for (const queued of pendingEvents.splice(0)) {
        if (!hasMatchingHandlers(queued.event)) {
          remainingEvents.push(queued);
          continue;
        }

        lastHandledUrl = queued.event.url;

        try {
          await deliverQueuedEvent(queued);
        } catch (error) {
          console.error(error);
        }
      }

      pendingEvents.unshift(...remainingEvents);
    } finally {
      flushingPendingEvents = false;
    }
  }

  async function dispatch(url: string): Promise<void> {
    await initialUrlPromise;
    const event = parseIntentUrl(context, url);
    const invocationId = getInvocationId(url);

    if (!event) {
      return;
    }

    if (invocationId) {
      if (isKnown(invocationId)) {
        return;
      }
    } else if (lastHandledUrl === url || pendingEvents.some((queued) => queued.event.url === url)) {
      return;
    }

    markSeen(invocationId);
    const queued = { event, invocationId };

    if (!hasMatchingHandlers(event)) {
      pendingEvents.push(queued);
      return;
    }

    lastHandledUrl = url;
    await deliverQueuedEvent(queued);
  }

  const subscription = linking.addEventListener("url", (event) => {
    dispatch(event.url).catch((error) => console.error(error));
  });

  function addIntentHandler(
    id: string,
    handler: (event: IntentEventUnion<TIntents>) => MaybePromise,
  ): () => void {
    const handlers = intentHandlers.get(id) ?? new Set();
    handlers.add(handler);
    intentHandlers.set(id, handlers);

    return () => {
      handlers.delete(handler);

      if (handlers.size === 0) {
        intentHandlers.delete(id);
      }
    };
  }

  return {
    buildUrl(intent, params) {
      return buildIntentUrl(options.scheme, intent, params);
    },

    async clearDonations() {
      await nativeModule.clearDonations();
    },

    dispose() {
      subscription.remove();
      anyIntentHandlers.clear();
      intentHandlers.clear();
      pendingEvents.length = 0;
    },

    async donate(intent, params) {
      const serializedParams = serializeIntentParams(intent, params);
      const capabilityBindings = getAndroidCapabilityBindings(intent, params);

      await nativeModule.donate(
        intent.id,
        resolveLocalizedText(intent.title, intent.id),
        buildIntentUrl(options.scheme, intent, params),
        JSON.stringify(serializedParams),
        capabilityBindings,
      );
    },

    async getInitialIntent() {
      const pending = pendingEvents.shift();

      if (pending) {
        lastHandledUrl = pending.event.url;
        acknowledge(pending.invocationId);
        void flushPendingEvents();
        return pending.event;
      }

      if (nativeModule.getPendingIntentURLs) {
        try {
          for (const nativeUrl of await nativeModule.getPendingIntentURLs()) {
            const nativeId = getInvocationId(nativeUrl);
            const nativeEvent = parseIntentUrl(context, nativeUrl);

            if (nativeEvent && !(nativeId && isKnown(nativeId))) {
              lastHandledUrl = nativeUrl;
              markSeen(nativeId);
              acknowledge(nativeId);
              void flushPendingEvents();
              return nativeEvent;
            }
          }
        } catch {
          // Fall through to the linking URL.
        }
      }

      const url = await initialUrlPromise;
      const invocationId = url ? getInvocationId(url) : null;

      if (!url || lastHandledUrl === url || (invocationId && isKnown(invocationId))) {
        void flushPendingEvents();
        return null;
      }

      const event = parseIntentUrl(context, url);

      if (event) {
        lastHandledUrl = url;
        markSeen(invocationId);
        acknowledge(invocationId);
      }

      void flushPendingEvents();
      return event;
    },

    onAnyIntent(handler) {
      anyIntentHandlers.add(handler);

      void flushPendingEvents();

      return () => {
        anyIntentHandlers.delete(handler);
      };
    },

    onIntent(intent, handler) {
      const unsubscribe = addIntentHandler(intent.id, (event) =>
        handler(
          event.params as unknown as ParamsOf<typeof intent>,
          event as unknown as IntentEvent<typeof intent>,
        ),
      );

      void flushPendingEvents();

      return unsubscribe;
    },

    async updateDynamicShortcuts(shortcuts) {
      const payloads: NativeShortcutPayload[] = shortcuts.map((shortcut) => {
        const payload: NativeShortcutPayload = {
          capabilityBindings: getAndroidCapabilityBindings(shortcut.intent, shortcut.params),
          id: shortcut.id ?? shortcut.intent.id,
          title:
            shortcut.shortTitle ?? resolveLocalizedText(shortcut.intent.title, shortcut.intent.id),
          url: buildIntentUrl(options.scheme, shortcut.intent, shortcut.params),
        };

        if (shortcut.longTitle) {
          payload.subtitle = shortcut.longTitle;
        }

        if (shortcut.icon?.systemName) {
          payload.icon = {
            ...payload.icon,
            systemName: shortcut.icon.systemName,
          };
        }

        if (shortcut.icon?.androidResourceName) {
          payload.icon = {
            ...payload.icon,
            androidResourceName: shortcut.icon.androidResourceName,
          };
        }

        if (shortcut.icon?.iosTemplateImageName) {
          payload.icon = {
            ...payload.icon,
            iosTemplateImageName: shortcut.icon.iosTemplateImageName,
          };
        }

        return payload;
      });

      await nativeModule.updateDynamicShortcuts(payloads);
    },
  };
}
