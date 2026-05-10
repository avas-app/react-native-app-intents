import type { IntentDefinition, ParamsOf } from "@react-native-app-intents/core";

type MaybePromise = void | Promise<void>;

export interface IntentEvent<TIntent extends IntentDefinition<any> = IntentDefinition<any>> {
  id: TIntent["id"];
  params: ParamsOf<TIntent>;
}

export interface DynamicShortcut<TIntent extends IntentDefinition<any> = IntentDefinition<any>> {
  intent: TIntent;
  params: ParamsOf<TIntent>;
  shortTitle: string;
  longTitle?: string;
}

type AnyIntentHandler = (event: IntentEvent) => MaybePromise;

const anyIntentHandlers = new Set<AnyIntentHandler>();
const intentHandlers = new Map<string, Set<AnyIntentHandler>>();

let initialIntent: IntentEvent | null = null;
let dynamicShortcuts: DynamicShortcut[] = [];

function addIntentHandler(id: string, handler: AnyIntentHandler): () => void {
  const handlers = intentHandlers.get(id) ?? new Set<AnyIntentHandler>();

  handlers.add(handler);
  intentHandlers.set(id, handlers);

  return () => {
    handlers.delete(handler);

    if (handlers.size === 0) {
      intentHandlers.delete(id);
    }
  };
}

export function onIntent<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
  handler: (params: ParamsOf<TIntent>) => MaybePromise,
): () => void {
  return addIntentHandler(intent.id, (event) => handler(event.params as ParamsOf<TIntent>));
}

export function onAnyIntent(handler: AnyIntentHandler): () => void {
  anyIntentHandlers.add(handler);

  return () => {
    anyIntentHandlers.delete(handler);
  };
}

export async function getInitialIntent(): Promise<IntentEvent | null>;
export async function getInitialIntent<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
): Promise<IntentEvent<TIntent> | null>;
export async function getInitialIntent<TIntent extends IntentDefinition<any>>(
  intent?: TIntent,
): Promise<IntentEvent | IntentEvent<TIntent> | null> {
  if (!intent) {
    return initialIntent;
  }

  if (initialIntent?.id !== intent.id) {
    return null;
  }

  return initialIntent as IntentEvent<TIntent>;
}

export async function donate<TIntent extends IntentDefinition<any>>(
  _intent: TIntent,
  _params: ParamsOf<TIntent>,
): Promise<void> {}

export async function updateDynamicShortcuts(shortcuts: readonly DynamicShortcut[]): Promise<void> {
  dynamicShortcuts = [...shortcuts];
}

async function dispatchIntent<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
  params: ParamsOf<TIntent>,
): Promise<void> {
  const event: IntentEvent<TIntent> = { id: intent.id, params };

  initialIntent = event;

  for (const handler of anyIntentHandlers) {
    await handler(event);
  }

  for (const handler of intentHandlers.get(intent.id) ?? []) {
    await handler(event);
  }
}

export const __unsafeTestUtils = {
  dispatchIntent,
  getDynamicShortcuts(): readonly DynamicShortcut[] {
    return dynamicShortcuts;
  },
  reset(): void {
    anyIntentHandlers.clear();
    intentHandlers.clear();
    initialIntent = null;
    dynamicShortcuts = [];
  },
  setInitialIntent<TIntent extends IntentDefinition<any>>(
    intent: TIntent,
    params: ParamsOf<TIntent>,
  ): void {
    initialIntent = { id: intent.id, params };
  },
};
