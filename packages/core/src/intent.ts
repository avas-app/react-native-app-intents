import type { AnyParameterDefinition, InferParams, LocalizedText } from "./schema.js";

export interface IntentSurfaces {
  siri?: boolean;
  spotlight?: boolean;
  appShortcut?: boolean;
  assistant?: boolean;
}

export interface IntentBehavior {
  opensAppToForeground?: boolean;
}

export interface IntentDefinition<
  TParams extends Record<string, AnyParameterDefinition> = Record<string, AnyParameterDefinition>,
> {
  kind: "intent";
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  phrases?: readonly string[] | Partial<Record<string, readonly string[]>>;
  params: TParams;
  surfaces?: IntentSurfaces;
  androidBii?: string;
  behavior?: IntentBehavior;
}

export type ParamsOf<TIntent extends IntentDefinition<any>> = InferParams<TIntent["params"]>;

export function defineIntent<const TParams extends Record<string, AnyParameterDefinition>>(
  config: Omit<IntentDefinition<TParams>, "kind">,
): IntentDefinition<TParams> {
  return { kind: "intent", ...config };
}
