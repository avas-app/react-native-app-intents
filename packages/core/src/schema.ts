import type { EntityDefinition, EntityShape } from "./entity.js";

export type LocalizedText = string | Record<string, string>;

export interface BaseParameterOptions<TValue> {
  title?: LocalizedText;
  prompt?: LocalizedText;
  requestValueDialog?: LocalizedText;
  optional?: boolean;
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

export type StringParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "string",
  string,
  TOptional
>;

export type IntParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "int",
  number,
  TOptional
>;

export type NumberParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "number",
  number,
  TOptional
>;

export type BoolParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "bool",
  boolean,
  TOptional
>;

export type DateParameterDefinition<TOptional extends boolean = false> = BaseParameterDefinition<
  "date",
  Date,
  TOptional
>;

export interface ObjectParameterDefinition<
  TFields extends Record<string, AnyParameterDefinition>,
  TOptional extends boolean = false,
> extends BaseParameterDefinition<"object", InferParams<TFields>, TOptional> {
  fields: TFields;
}

export interface EntityParameterDefinition<
  TEntity extends EntityDefinition<any>,
  TOptional extends boolean = false,
> extends BaseParameterDefinition<"entity", EntityShape<TEntity>, TOptional> {
  entity: TEntity;
}

export type AnyParameterDefinition =
  | StringParameterDefinition<boolean>
  | IntParameterDefinition<boolean>
  | NumberParameterDefinition<boolean>
  | BoolParameterDefinition<boolean>
  | DateParameterDefinition<boolean>
  | ObjectParameterDefinition<Record<string, AnyParameterDefinition>, boolean>
  | EntityParameterDefinition<EntityDefinition<any>, boolean>;

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

function string(options?: RequiredOptions<string>): StringParameterDefinition<false>;
function string(options: OptionalOptions<string>): StringParameterDefinition<true>;
function string(
  options: PrimitiveOptions<string, boolean> = {},
): StringParameterDefinition<boolean> {
  return { kind: "string", ...options };
}

function int(options?: RequiredOptions<number>): IntParameterDefinition<false>;
function int(options: OptionalOptions<number>): IntParameterDefinition<true>;
function int(options: PrimitiveOptions<number, boolean> = {}): IntParameterDefinition<boolean> {
  return { kind: "int", ...options };
}

function number(options?: RequiredOptions<number>): NumberParameterDefinition<false>;
function number(options: OptionalOptions<number>): NumberParameterDefinition<true>;
function number(
  options: PrimitiveOptions<number, boolean> = {},
): NumberParameterDefinition<boolean> {
  return { kind: "number", ...options };
}

function bool(options?: RequiredOptions<boolean>): BoolParameterDefinition<false>;
function bool(options: OptionalOptions<boolean>): BoolParameterDefinition<true>;
function bool(options: PrimitiveOptions<boolean, boolean> = {}): BoolParameterDefinition<boolean> {
  return { kind: "bool", ...options };
}

function date(options?: RequiredOptions<Date>): DateParameterDefinition<false>;
function date(options: OptionalOptions<Date>): DateParameterDefinition<true>;
function date(options: PrimitiveOptions<Date, boolean> = {}): DateParameterDefinition<boolean> {
  return { kind: "date", ...options };
}

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

export const p = {
  string,
  int,
  number,
  bool,
  date,
  object,
  entity,
};
