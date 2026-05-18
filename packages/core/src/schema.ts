import type { EntityDefinition, EntityShape } from "./entity.js";

/** Localized user-facing text as a single string or locale-to-string map. */
export type LocalizedText = string | Record<string, string>;

/**
 * Shared options supported by all parameter definitions.
 *
 * Surface guide:
 * - iOS App Intents / Siri: `title`, `prompt`, and `requestValueDialog` drive native prompting UI.
 * - Android App Actions / Assistant: `androidBiiParam` is the important field; define it only when
 *   the parent intent uses `android.appAction`.
 * - Static shortcuts / Spotlight / dynamic shortcuts: these options are mostly metadata; only
 *   define what improves native UX.
 */
export interface BaseParameterOptions<TValue> {
  /** Android built-in intent parameter name used for App Action bindings. Define this only when the parent intent configures `android.appAction`, and omit it for iOS-only or shortcut-only params. */
  androidBiiParam?: string;
  /** User-facing parameter title shown by native surfaces. Recommended for iOS App Intents and entity-backed params; safe to omit for Android-only scalar params that do not need extra labeling. */
  title?: LocalizedText;
  /** User-facing prompt shown when the system suggests this parameter. Mainly useful for iOS App Intent / Siri experiences; usually omit it for Android-only definitions. */
  prompt?: LocalizedText;
  /** Dialog shown when the system needs the user to provide a value. Mainly useful for iOS App Intent / Siri resolution; usually omit it for static shortcut-only or Android-only definitions. */
  requestValueDialog?: LocalizedText;
  /** Marks the parameter as optional. */
  optional?: boolean;
  /** Default value used when the system omits the parameter. Optional for all surfaces; define it only when a missing value should resolve automatically. */
  default?: TValue;
}

interface BaseParameterDefinition<
  Kind extends string,
  TValue,
  TOptional extends boolean = false,
> extends BaseParameterOptions<TValue> {
  kind: Kind;
  optional?: TOptional;
}

/** Parameter definition for a string value. */
export type StringParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "string",
  string,
  TOptional
>;

/** Parameter definition for an integer value. */
export type IntParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "int",
  number,
  TOptional
>;

/** Parameter definition for a numeric value. */
export type NumberParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "number",
  number,
  TOptional
>;

/** Parameter definition for a boolean value. */
export type BoolParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "bool",
  boolean,
  TOptional
>;

/** Parameter definition for a `Date` value. */
export type DateParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "date",
  Date,
  TOptional
>;

/** Parameter definition for a nested object payload. */
export interface ObjectParameterDefinition<
  TFields extends Record<string, AnyParameterDefinition>,
  TOptional extends boolean = false,
> extends BaseParameterDefinition<"object", InferParams<TFields>, TOptional> {
  /** Nested fields that make up the object payload. */
  fields: TFields;
}

/** Parameter definition backed by an App Entity. Use this when native surfaces need to show or resolve a structured record instead of a scalar value. */
export interface EntityParameterDefinition<
  TEntity extends EntityDefinition<any>,
  TOptional extends boolean = false,
> extends BaseParameterDefinition<"entity", EntityShape<TEntity>, TOptional> {
  /** Entity definition used to resolve display and inventory metadata. */
  entity: TEntity;
}

/** Any supported parameter definition that can appear in an intent schema. */
export type AnyParameterDefinition =
  | StringParameterDefinition<boolean>
  | IntParameterDefinition<boolean>
  | NumberParameterDefinition<boolean>
  | BoolParameterDefinition<boolean>
  | DateParameterDefinition<boolean>
  | ObjectParameterDefinition<Record<string, AnyParameterDefinition>, boolean>
  | EntityParameterDefinition<EntityDefinition<any>, boolean>;

/** Resolves the runtime value type produced by a parameter definition. */
export type InferParameterValue<TParameter extends AnyParameterDefinition> =
  TParameter extends BaseParameterDefinition<any, infer TValue, infer TOptional>
    ? TOptional extends true
      ? TValue | undefined
      : TValue
    : never;

type RequiredKeys<TFields extends Record<string, AnyParameterDefinition>> = {
  [K in keyof TFields]: undefined extends InferParameterValue<TFields[K]> ? never : K;
}[keyof TFields];

type OptionalKeys<TFields extends Record<string, AnyParameterDefinition>> = Exclude<
  keyof TFields,
  RequiredKeys<TFields>
>;

/** Resolves the runtime params object for a parameter-definition map. */
export type InferParams<TFields extends Record<string, AnyParameterDefinition>> = {
  [K in RequiredKeys<TFields>]: InferParameterValue<TFields[K]>;
} & {
  [K in OptionalKeys<TFields>]?: Exclude<InferParameterValue<TFields[K]>, undefined>;
};

type PrimitiveOptions<TValue, TOptional extends boolean> = BaseParameterOptions<TValue> & {
  optional?: TOptional;
};

type RequiredOptions<TValue> = PrimitiveOptions<TValue, false>;
type OptionalOptions<TValue> = PrimitiveOptions<TValue, true>;

/** Creates a string parameter definition. Use `androidBiiParam` only if this slot participates in Android App Actions, and use `title` / `requestValueDialog` when you want better iOS App Intent prompting. */
function string(options?: RequiredOptions<string>): StringParameterDefinition<false>;
function string(options: OptionalOptions<string>): StringParameterDefinition<true>;
function string(
  options: PrimitiveOptions<string, boolean> = {},
): StringParameterDefinition<boolean> {
  return { kind: "string", ...options };
}

/** Creates an integer parameter definition. Use `androidBiiParam` only if this slot participates in Android App Actions, and use `title` / `requestValueDialog` when you want better iOS App Intent prompting. */
function int(options?: RequiredOptions<number>): IntParameterDefinition<false>;
function int(options: OptionalOptions<number>): IntParameterDefinition<true>;
function int(options: PrimitiveOptions<number, boolean> = {}): IntParameterDefinition<boolean> {
  return { kind: "int", ...options };
}

/** Creates a floating-point number parameter definition. Use `androidBiiParam` only if this slot participates in Android App Actions, and use `title` / `requestValueDialog` when you want better iOS App Intent prompting. */
function number(options?: RequiredOptions<number>): NumberParameterDefinition<false>;
function number(options: OptionalOptions<number>): NumberParameterDefinition<true>;
function number(
  options: PrimitiveOptions<number, boolean> = {},
): NumberParameterDefinition<boolean> {
  return { kind: "number", ...options };
}

/** Creates a boolean parameter definition. Use `title` / `requestValueDialog` for iOS App Intent UX; Android App Actions only care about `androidBiiParam` when the param is capability-bound. */
function bool(options?: RequiredOptions<boolean>): BoolParameterDefinition<false>;
function bool(options: OptionalOptions<boolean>): BoolParameterDefinition<true>;
function bool(options: PrimitiveOptions<boolean, boolean> = {}): BoolParameterDefinition<boolean> {
  return { kind: "bool", ...options };
}

/** Creates a date parameter definition. Use `title` / `requestValueDialog` for iOS App Intent UX; Android App Actions only care about `androidBiiParam` when the param is capability-bound. */
function date(options?: RequiredOptions<Date>): DateParameterDefinition<false>;
function date(options: OptionalOptions<Date>): DateParameterDefinition<true>;
function date(options: PrimitiveOptions<Date, boolean> = {}): DateParameterDefinition<boolean> {
  return { kind: "date", ...options };
}

/** Creates a nested object parameter definition. Good for App Intent payload shape, but object params themselves cannot be interpolated directly in shortcut `phrases`. */
function object<const TFields extends Record<string, AnyParameterDefinition>>(
  fields: TFields,
  options?: RequiredOptions<InferParams<TFields>>,
): ObjectParameterDefinition<TFields, false>;
function object<const TFields extends Record<string, AnyParameterDefinition>>(
  fields: TFields,
  options: OptionalOptions<InferParams<TFields>>,
): ObjectParameterDefinition<TFields, true>;
function object<const TFields extends Record<string, AnyParameterDefinition>>(
  fields: TFields,
  options: PrimitiveOptions<InferParams<TFields>, boolean> = {},
): ObjectParameterDefinition<TFields, boolean> {
  return { kind: "object", fields, ...options };
}

/** Creates an entity parameter definition backed by a `defineEntity` schema. Use this for App Intents, static shortcuts, dynamic shortcuts, and Android App Actions when the parameter should resolve against an entity catalog. */
function entity<TEntity extends EntityDefinition<any>>(
  entityDefinition: TEntity,
  options?: RequiredOptions<EntityShape<TEntity>>,
): EntityParameterDefinition<TEntity, false>;
function entity<TEntity extends EntityDefinition<any>>(
  entityDefinition: TEntity,
  options: OptionalOptions<EntityShape<TEntity>>,
): EntityParameterDefinition<TEntity, true>;
function entity<TEntity extends EntityDefinition<any>>(
  entityDefinition: TEntity,
  options: PrimitiveOptions<EntityShape<TEntity>, boolean> = {},
): EntityParameterDefinition<TEntity, boolean> {
  return { kind: "entity", entity: entityDefinition, ...options };
}

/** Parameter builder namespace used inside intent and entity schema definitions. Combine `androidBiiParam` with `android.appAction`, and use the other metadata primarily to improve iOS App Intent / Siri UX. */
export const p = {
  /** Creates a string parameter definition. */
  string,
  /** Creates an integer parameter definition. */
  int,
  /** Creates a floating-point number parameter definition. */
  number,
  /** Creates a boolean parameter definition. */
  bool,
  /** Creates a date parameter definition. */
  date,
  /** Creates a nested object parameter definition. */
  object,
  /** Creates an entity parameter definition backed by a `defineEntity` schema. */
  entity,
};
