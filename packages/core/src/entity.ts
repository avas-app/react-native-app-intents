import type { InferParameterValue, LocalizedText, ObjectParameterDefinition } from "./schema.js";

/**
 * Optional image metadata for an entity's display representation.
 *
 * Surface guide:
 * - `systemName` is the most useful option for iOS App Intents / App Shortcuts.
 * - `uri` is optional metadata for surfaces that can render an external image.
 */
export interface EntityImageRepresentation {
  /** iOS SF Symbol name used when native surfaces render the entity. */
  systemName?: string;
  /** Remote or local URI for an entity image, when supported by the surface. */
  uri?: string;
}

/** User-facing title, subtitle, and image metadata for an entity result. */
export interface EntityDisplayRepresentation {
  /** Primary entity label shown in native surfaces. */
  title: string;
  /** Secondary entity label shown in native surfaces when available. */
  subtitle?: string;
  /** Optional image metadata shown alongside the entity. */
  image?: EntityImageRepresentation;
}

/** Input passed to an entity query callback. */
export interface EntityQueryInput {
  /** Free-text search text provided by the native resolver. */
  search?: string;
  /** Explicit entity identifiers the native resolver wants loaded. */
  ids?: readonly string[];
}

/**
 * Declares an App Entity that can be referenced by intent parameters.
 *
 * Surface guide:
 * - iOS App Intents / Siri: define `title`, `displayRepresentation`, and either `inventory` or
 *   `query` so entities can be presented and resolved.
 * - Android App Actions / Assistant: define `inventory` when entity choices are known at build
 *   time, or pair the intent's `android.appAction.inventory.strategy: "dynamic"` with runtime
 *   donations / dynamic shortcuts when they are not.
 * - Static shortcuts: entity-backed shortcuts work best when `inventory` is defined.
 * - Dynamic shortcuts: reuse the same entity shape; no extra entity-only fields are needed beyond
 *   what helps the target surface resolve and display the entity.
 */
export interface EntityDefinition<
  TSchema extends ObjectParameterDefinition<any> = ObjectParameterDefinition<Record<string, never>>,
> {
  /** Internal marker used to identify entity definitions during codegen. */
  kind: "entity";
  /** Stable identifier used by generated native entity declarations. */
  id: string;
  /** Optional static inventory used for generated native entity catalogs. Define this for fixed entity lists that should power iOS App Intents, static shortcuts, or Android static capability inventory. Omit it when the data is only available at runtime. */
  inventory?: readonly InferParameterValue<TSchema>[];
  /** User-facing entity type title. Recommended for iOS App Intent / Siri UIs; omit only if the surrounding intent names already make the entity type obvious. */
  title?: LocalizedText;
  /** Schema describing the shape of each entity record. */
  schema: TSchema;
  /** Returns a stable string identifier for each entity record. */
  identifier: (entity: InferParameterValue<TSchema>) => string;
  /** Returns the display metadata shown for a resolved entity record. This is important anywhere a native surface needs to show the entity to the user. */
  displayRepresentation: (entity: InferParameterValue<TSchema>) => EntityDisplayRepresentation;
  /** Optional runtime query used to resolve entities by search text or identifier. Define this when iOS App Intents / Siri should be able to search live data instead of relying purely on `inventory`; omit it for fully static catalogs. */
  query?: (
    input: EntityQueryInput,
  ) => Promise<readonly InferParameterValue<TSchema>[]> | readonly InferParameterValue<TSchema>[];
}

/** Resolves the runtime object shape produced by an entity definition. */
export type EntityShape<TEntity extends EntityDefinition<any>> = InferParameterValue<
  TEntity["schema"]
>;

/** Defines an App Entity that intent parameters can reference. Use this with `p.entity(...)` whenever Android or iOS surfaces should treat the parameter as a resolved catalog item instead of a plain scalar. */
export function defineEntity<TSchema extends ObjectParameterDefinition<any>>(
  config: Omit<EntityDefinition<TSchema>, "kind">,
): EntityDefinition<TSchema> {
  return { kind: "entity", ...config };
}
