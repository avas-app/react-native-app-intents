import type { InferParameterValue, LocalizedText, ObjectParameterDefinition } from "./schema.js";

export interface EntityImageRepresentation {
  systemName?: string;
  uri?: string;
}

export interface EntityDisplayRepresentation {
  title: string;
  subtitle?: string;
  image?: EntityImageRepresentation;
}

export interface EntityQueryInput {
  search?: string;
  ids?: readonly string[];
}

export interface EntityDefinition<
  TSchema extends ObjectParameterDefinition<any> = ObjectParameterDefinition<Record<string, never>>,
> {
  kind: "entity";
  id: string;
  title?: LocalizedText;
  schema: TSchema;
  identifier: (entity: InferParameterValue<TSchema>) => string;
  displayRepresentation: (entity: InferParameterValue<TSchema>) => EntityDisplayRepresentation;
  query?: (
    input: EntityQueryInput,
  ) => Promise<readonly InferParameterValue<TSchema>[]> | readonly InferParameterValue<TSchema>[];
}

export type EntityShape<TEntity extends EntityDefinition<any>> = InferParameterValue<
  TEntity["schema"]
>;

export function defineEntity<TSchema extends ObjectParameterDefinition<any>>(
  config: Omit<EntityDefinition<TSchema>, "kind">,
): EntityDefinition<TSchema> {
  return { kind: "entity", ...config };
}
