import { ANDROID_APP_ACTION_CATALOG } from "./android-app-actions.js";
import type {
  EntityDefinition,
  EntityDisplayRepresentation,
  EntityShape,
  EntitySpotlightOptions,
} from "./entity.js";
import type { AnyParameterDefinition, LocalizedText, ObjectParameterDefinition } from "./schema.js";
import type {
  AndroidAppActionFulfillment,
  AndroidAppActionInventoryStrategy,
  AppShortcutSurfaceOptions,
  IOSAppIntentResponseOptions,
  IntentBehavior,
  IntentDefinition,
  IntentSurfaces,
} from "./intent.js";

const APP_NAME_PLACEHOLDER = "${.applicationName}";
const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g;

export class AppIntentsValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "AppIntentsValidationError";
    this.issues = issues;
  }
}

export interface NormalizedPhraseMetadata {
  appShortcutPhrase: string;
  placeholders: readonly string[];
  raw: string;
  swiftAppShortcutPhrase: string;
}

export interface NormalizedParameterMetadata {
  androidBiiParam?: string;
  defaultValue?: unknown;
  entityId?: string;
  fields?: readonly NormalizedParameterMetadata[];
  hasDefault: boolean;
  kind: AnyParameterDefinition["kind"];
  name: string;
  optional: boolean;
  prompt?: string;
  requestValueDialog?: string;
  title: string;
}

export interface NormalizedEntityInventoryItem<
  TEntity extends EntityDefinition<any> = EntityDefinition<any>,
> {
  displayRepresentation: {
    imageSystemName?: string;
    subtitle?: string;
    title: string;
  };
  identifier: string;
  jsonValue: string;
  value: EntityShape<TEntity>;
}

export interface NormalizedEntityMetadata<
  TEntity extends EntityDefinition<any> = EntityDefinition<any>,
> {
  appFunctionQuery: boolean;
  catalog: "static" | "runtime";
  entity: TEntity;
  id: string;
  inventory: readonly NormalizedEntityInventoryItem<TEntity>[];
  schema: TEntity["schema"];
  spotlight?: { openIntentId: string };
  title: string;
}

export interface NormalizedIntentMetadata<
  TIntent extends IntentDefinition<any> = IntentDefinition<any>,
> {
  appShortcut: NormalizedAppShortcutMetadata;
  android?: NormalizedAndroidIntentMetadata;
  behavior: Required<IntentBehavior>;
  description?: string;
  id: string;
  ios?: NormalizedIOSIntentMetadata;
  intent: TIntent;
  params: readonly NormalizedParameterMetadata[];
  phrases: readonly NormalizedPhraseMetadata[];
  surfaces: Required<IntentSurfaces>;
  title: string;
}

export interface NormalizedIntentSurfaces {
  appShortcut: boolean;
  assistant: boolean;
  siri: boolean;
  spotlight: boolean;
}

export interface NormalizedAppShortcutMetadata {
  iconAndroidResourceName?: string;
  iconSystemName?: string;
}

export interface NormalizedAndroidAppActionMetadata {
  capabilityName: string;
  fulfillment: AndroidAppActionFulfillment;
  inventoryStrategy: AndroidAppActionInventoryStrategy;
}

export interface NormalizedAndroidAppFunctionMetadata {
  enabledByDefault: boolean;
  result: "delivered";
}

export interface NormalizedAndroidIntentMetadata {
  appAction?: NormalizedAndroidAppActionMetadata;
  appFunction?: NormalizedAndroidAppFunctionMetadata;
}

export interface NormalizedIOSAppIntentResponseMetadata {
  dialog?: string;
}

export interface NormalizedIOSAppIntentMetadata {
  response?: NormalizedIOSAppIntentResponseMetadata;
}

export interface NormalizedIOSIntentMetadata {
  appIntent?: NormalizedIOSAppIntentMetadata;
}

const ANDROID_SHORTCUT_ICON_RESOURCE_PATTERN = /^@(drawable|mipmap)\/[A-Za-z0-9_]+$/;

function appendIssue(issues: string[], scopeId: string, message: string): void {
  issues.push(`[${scopeId}] ${message}`);
}

function collectPhrasePlaceholders(phrase: string): string[] {
  const placeholders: string[] = [];

  for (const match of phrase.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[1];

    if (placeholder) {
      placeholders.push(placeholder);
    }
  }

  return placeholders;
}

function normalizeAppShortcutPhrase(
  rawPhrase: string,
  paramNames: ReadonlySet<string>,
): NormalizedPhraseMetadata {
  const placeholders = collectPhrasePlaceholders(rawPhrase);
  let appShortcutPhrase = rawPhrase;
  let swiftAppShortcutPhrase = rawPhrase;
  let includesApplicationName = false;

  for (const placeholder of placeholders) {
    if (placeholder === ".applicationName") {
      includesApplicationName = true;
      continue;
    }

    if (!paramNames.has(placeholder)) {
      continue;
    }

    appShortcutPhrase = appShortcutPhrase.replace(new RegExp(`\\$\\{${placeholder}\\}`, "g"), "");
  }

  appShortcutPhrase = appShortcutPhrase.replace(/\s+/g, " ").trim();
  swiftAppShortcutPhrase = swiftAppShortcutPhrase.replace(/\s+/g, " ").trim();

  if (!includesApplicationName) {
    appShortcutPhrase =
      appShortcutPhrase.length === 0
        ? APP_NAME_PLACEHOLDER
        : `${appShortcutPhrase} in ${APP_NAME_PLACEHOLDER}`;
    swiftAppShortcutPhrase =
      swiftAppShortcutPhrase.length === 0
        ? APP_NAME_PLACEHOLDER
        : `${swiftAppShortcutPhrase} in ${APP_NAME_PLACEHOLDER}`;
  }

  return {
    appShortcutPhrase,
    placeholders,
    raw: rawPhrase,
    swiftAppShortcutPhrase,
  };
}

function serializeParameterValue(definition: AnyParameterDefinition, value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  switch (definition.kind) {
    case "date":
      return value instanceof Date ? value.toISOString() : value;
    case "entity":
      return serializeObjectParameterValue(definition.entity.schema, value);
    case "object":
      return serializeObjectParameterValue(definition, value);
    default:
      return value;
  }
}

function serializeObjectParameterValue(
  definition: ObjectParameterDefinition<Record<string, AnyParameterDefinition>, boolean>,
  value: unknown,
): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const serialized: Record<string, unknown> = {};

  for (const [fieldName, fieldDefinition] of Object.entries(definition.fields) as [
    string,
    AnyParameterDefinition,
  ][]) {
    serialized[fieldName] = serializeParameterValue(
      fieldDefinition,
      (value as Record<string, unknown>)[fieldName],
    );
  }

  return serialized;
}

/**
 * Checks a value against a parameter definition and returns the first problem, or `null` when it
 * matches. Used for runtime entity catalog entries before they are stored.
 */
export function validateParameterValue(
  definition: AnyParameterDefinition,
  value: unknown,
  path: string,
): string | null {
  if (value === undefined || value === null) {
    return definition.optional === true ? null : `field "${path}" is required`;
  }

  switch (definition.kind) {
    case "string":
      return typeof value === "string" ? null : `field "${path}" must be a string`;
    case "int":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `field "${path}" must be an integer`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `field "${path}" must be a number`;
    case "bool":
      return typeof value === "boolean" ? null : `field "${path}" must be a boolean`;
    case "date":
      return value instanceof Date && !Number.isNaN(value.getTime())
        ? null
        : `field "${path}" must be a Date`;
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `field "${path}" must be an object`;
      }

      for (const [key, field] of Object.entries(definition.fields) as [
        string,
        AnyParameterDefinition,
      ][]) {
        const issue = validateParameterValue(
          field,
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
        );

        if (issue) {
          return issue;
        }
      }

      return null;
    }
    case "entity": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `field "${path}" must be an object`;
      }

      for (const [key, field] of Object.entries(definition.entity.schema.fields) as [
        string,
        AnyParameterDefinition,
      ][]) {
        const issue = validateParameterValue(
          field,
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
        );

        if (issue) {
          return issue;
        }
      }

      return null;
    }
  }
}

function normalizeParameterMetadata(
  name: string,
  definition: AnyParameterDefinition,
): NormalizedParameterMetadata {
  const metadata: NormalizedParameterMetadata = {
    hasDefault: "default" in definition && definition.default !== undefined,
    kind: definition.kind,
    name,
    optional: definition.optional === true,
    title: resolveLocalizedText(definition.title, name) ?? name,
  };

  const prompt = resolveLocalizedText(definition.prompt);
  const requestValueDialog = resolveLocalizedText(definition.requestValueDialog);

  if (prompt) {
    metadata.prompt = prompt;
  }

  if (requestValueDialog) {
    metadata.requestValueDialog = requestValueDialog;
  }

  if (definition.androidBiiParam) {
    metadata.androidBiiParam = definition.androidBiiParam;
  }

  if ("default" in definition && definition.default !== undefined) {
    metadata.defaultValue = serializeParameterValue(definition, definition.default);
  }

  if (definition.kind === "object") {
    metadata.fields = Object.entries(definition.fields).map(([fieldName, field]) =>
      normalizeParameterMetadata(fieldName, field),
    );
  }

  if (definition.kind === "entity") {
    metadata.entityId = definition.entity.id;
  }

  return metadata;
}

function normalizePhrases(
  intent: IntentDefinition<any>,
  issues: string[],
): readonly NormalizedPhraseMetadata[] {
  const localizedPhrases = intent.phrases;

  if (!localizedPhrases) {
    return [];
  }

  const phrases = Array.isArray(localizedPhrases)
    ? localizedPhrases
    : ((localizedPhrases as Partial<Record<string, readonly string[]>>).en ??
      Object.values(localizedPhrases as Partial<Record<string, readonly string[]>>)[0] ??
      []);
  const paramNames = new Set(Object.keys(intent.params));

  return (phrases as readonly string[]).map((phrase) => {
    const metadata = normalizeAppShortcutPhrase(phrase, paramNames);

    for (const placeholder of metadata.placeholders) {
      if (placeholder === ".applicationName") {
        continue;
      }

      if (!paramNames.has(placeholder)) {
        appendIssue(
          issues,
          intent.id,
          `Phrase "${phrase}" references unknown placeholder "${placeholder}".`,
        );
        continue;
      }

      const parameter = intent.params[placeholder];

      if (parameter?.kind === "object") {
        appendIssue(
          issues,
          intent.id,
          `Phrase "${phrase}" cannot interpolate object parameter "${placeholder}".`,
        );
      }
    }

    return metadata;
  });
}

function normalizeAppShortcutMetadata(
  appShortcut: IntentSurfaces["appShortcut"] | undefined,
  intentId: string,
  issues: string[],
): NormalizedAppShortcutMetadata {
  const options =
    typeof appShortcut === "object" && appShortcut !== null
      ? (appShortcut as AppShortcutSurfaceOptions)
      : undefined;
  const androidResourceName = options?.icon?.androidResourceName;
  const iconSystemName = options?.icon?.systemName;
  const normalized: NormalizedAppShortcutMetadata = {};

  if (androidResourceName) {
    if (!ANDROID_SHORTCUT_ICON_RESOURCE_PATTERN.test(androidResourceName)) {
      appendIssue(
        issues,
        intentId,
        'App Shortcut androidResourceName must use an "@drawable/..." or "@mipmap/..." resource reference.',
      );
    } else {
      normalized.iconAndroidResourceName = androidResourceName;
    }
  }

  if (iconSystemName) {
    normalized.iconSystemName = iconSystemName;
  }

  if (!normalized.iconAndroidResourceName && !normalized.iconSystemName && options?.icon) {
    appendIssue(
      issues,
      intentId,
      "App Shortcut icon must include systemName and/or androidResourceName.",
    );
  }

  return normalized;
}

function normalizeSurfaces(surfaces: IntentSurfaces | undefined): NormalizedIntentSurfaces {
  const appShortcut = surfaces?.appShortcut;

  return {
    appShortcut: appShortcut !== undefined && appShortcut !== false,
    assistant: surfaces?.assistant === true,
    siri: surfaces?.siri === true,
    spotlight: surfaces?.spotlight === true,
  };
}

const KOTLIN_HARD_KEYWORDS = new Set([
  "as",
  "break",
  "class",
  "continue",
  "do",
  "else",
  "false",
  "for",
  "fun",
  "if",
  "in",
  "interface",
  "is",
  "null",
  "object",
  "package",
  "return",
  "super",
  "this",
  "throw",
  "true",
  "try",
  "typealias",
  "typeof",
  "val",
  "var",
  "when",
  "while",
]);

const KOTLIN_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isKotlinSafeName(name: string): boolean {
  return KOTLIN_IDENTIFIER_PATTERN.test(name) && !KOTLIN_HARD_KEYWORDS.has(name);
}

function validateAndroidAppFunctionParameter(
  definition: AnyParameterDefinition,
  scopeId: string,
  path: string,
  issues: string[],
): void {
  switch (definition.kind) {
    case "string":
    case "int":
    case "number":
    case "bool":
    case "date":
      return;
    case "object":
      for (const [fieldName, field] of Object.entries(definition.fields) as [
        string,
        AnyParameterDefinition,
      ][]) {
        if (!isKotlinSafeName(fieldName)) {
          appendIssue(
            issues,
            scopeId,
            `Field "${path}.${fieldName}" is not a Kotlin-safe name for AppFunction codegen (reserved keyword or invalid identifier).`,
          );
        }

        validateAndroidAppFunctionParameter(field, scopeId, `${path}.${fieldName}`, issues);
      }

      return;
    case "entity":
      for (const [fieldName, field] of Object.entries(definition.entity.schema.fields) as [
        string,
        AnyParameterDefinition,
      ][]) {
        if (!isKotlinSafeName(fieldName)) {
          appendIssue(
            issues,
            definition.entity.id,
            `Entity field "${fieldName}" is not a Kotlin-safe name for AppFunction codegen (reserved keyword or invalid identifier).`,
          );
        }

        validateAndroidAppFunctionParameter(field, definition.entity.id, fieldName, issues);
      }

      return;
    default:
      appendIssue(
        issues,
        scopeId,
        `Parameter "${path}" has a type AppFunction codegen does not support.`,
      );
  }
}

function validateAndroidAppFunctionDefaults(
  scopeId: string,
  intent: IntentDefinition<any>,
  issues: string[],
): void {
  for (const [name, definition] of Object.entries(intent.params) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (!("default" in definition) || definition.default === undefined) {
      continue;
    }

    const issue = validateParameterValue(definition, definition.default, name);

    if (issue) {
      appendIssue(issues, scopeId, `Default for parameter "${name}" is invalid: ${issue}.`);
    }
  }
}

function validateAndroidAppFunctionNames(
  scopeId: string,
  intent: IntentDefinition<any>,
  issues: string[],
): void {
  if (!isKotlinSafeName(intent.id)) {
    appendIssue(
      issues,
      scopeId,
      `Intent id "${intent.id}" is not a Kotlin-safe function name for AppFunction codegen.`,
    );
  }

  for (const [name, definition] of Object.entries(intent.params) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (!isKotlinSafeName(name)) {
      appendIssue(
        issues,
        scopeId,
        `Parameter "${name}" is not a Kotlin-safe name for AppFunction codegen (reserved keyword or invalid identifier).`,
      );
    }

    validateAndroidAppFunctionParameter(definition, scopeId, name, issues);
  }

  validateAndroidAppFunctionDefaults(scopeId, intent, issues);
}

function normalizeAndroidMetadata(
  intent: IntentDefinition<any>,
  issues: string[],
): NormalizedAndroidIntentMetadata | undefined {
  const appAction = intent.android?.appAction;
  const appFunctionOption = intent.android?.appFunction;
  const capabilityName = appAction?.capability ?? intent.androidBii;
  const metadata: NormalizedAndroidIntentMetadata = {};

  if (capabilityName) {
    metadata.appAction = {
      capabilityName,
      fulfillment: appAction?.fulfillment ?? "deeplink",
      inventoryStrategy: appAction?.inventory?.strategy ?? "static",
    };
  } else if (intent.surfaces?.assistant) {
    appendIssue(
      issues,
      intent.id,
      "surfaces.assistant no longer enables Android App Actions by itself. Configure android.appAction.",
    );
  }

  if (appFunctionOption !== undefined && appFunctionOption !== false) {
    const options = typeof appFunctionOption === "object" ? appFunctionOption : {};

    if (options.enabledByDefault !== undefined && typeof options.enabledByDefault !== "boolean") {
      appendIssue(issues, intent.id, "android.appFunction.enabledByDefault must be a boolean.");
    }

    if (options.result !== undefined && options.result !== "delivered") {
      appendIssue(
        issues,
        intent.id,
        `android.appFunction.result must be "delivered", got "${String(options.result)}".`,
      );
    }

    metadata.appFunction = {
      enabledByDefault: options.enabledByDefault !== false,
      result: "delivered",
    };
    validateAndroidAppFunctionNames(intent.id, intent, issues);
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeIOSResponseMetadata(
  response: IOSAppIntentResponseOptions | undefined,
): NormalizedIOSAppIntentResponseMetadata | undefined {
  const dialog = resolveLocalizedText(response?.dialog);

  if (!dialog) {
    return undefined;
  }

  return {
    dialog,
  };
}

function normalizeIOSMetadata(
  intent: IntentDefinition<any>,
  issues: string[],
): NormalizedIOSIntentMetadata | undefined {
  const appIntent = intent.ios?.appIntent;

  if (!appIntent) {
    if (intent.surfaces?.siri) {
      appendIssue(
        issues,
        intent.id,
        "surfaces.siri no longer enables iOS App Intents by itself. Configure ios.appIntent.",
      );
    }

    return undefined;
  }

  const response = normalizeIOSResponseMetadata(appIntent.response);

  if (response?.dialog && intent.behavior?.opensAppToForeground === true) {
    appendIssue(
      issues,
      intent.id,
      "ios.appIntent.response.dialog cannot be combined with behavior.opensAppToForeground.",
    );
  }

  return {
    appIntent: response ? { response } : {},
  };
}

function validateAndroidAppAction(
  intent: IntentDefinition<any>,
  params: readonly AnyParameterDefinition[],
  android: NormalizedAndroidIntentMetadata["appAction"],
  issues: string[],
): void {
  if (!android) {
    return;
  }

  if (!android.capabilityName.startsWith("actions.intent.")) {
    appendIssue(
      issues,
      intent.id,
      `Android App Actions capability "${android.capabilityName}" must start with "actions.intent.".`,
    );
    return;
  }

  const catalogEntry = ANDROID_APP_ACTION_CATALOG[android.capabilityName];

  if (!catalogEntry) {
    return;
  }

  const configuredParameterNames = new Set(
    params.flatMap((parameter) => (parameter.androidBiiParam ? [parameter.androidBiiParam] : [])),
  );
  const supportedParameterNames = new Set([
    ...(catalogEntry.requiredParameterNames ?? []),
    ...(catalogEntry.optionalParameterNames ?? []),
  ]);

  for (const parameterName of configuredParameterNames) {
    if (!supportedParameterNames.has(parameterName)) {
      appendIssue(
        issues,
        intent.id,
        `Android App Actions capability "${android.capabilityName}" does not support parameter "${parameterName}".`,
      );
    }
  }

  for (const parameterName of catalogEntry.requiredParameterNames ?? []) {
    if (!configuredParameterNames.has(parameterName)) {
      appendIssue(
        issues,
        intent.id,
        `Android App Actions capability "${android.capabilityName}" requires parameter "${parameterName}".`,
      );
    }
  }
}

function normalizeBehavior(behavior: IntentBehavior | undefined): Required<IntentBehavior> {
  return {
    opensAppToForeground: behavior?.opensAppToForeground === true,
  };
}

function normalizeEntityDisplayRepresentation(
  entity: EntityDefinition<any>,
  item: EntityShape<EntityDefinition<any>>,
  index: number,
  issues: string[],
): EntityDisplayRepresentation | null {
  try {
    const displayRepresentation = entity.displayRepresentation(item);

    if (displayRepresentation.image?.uri) {
      appendIssue(
        issues,
        entity.id,
        `Inventory item ${index} uses image.uri, which codegen does not support yet.`,
      );
    }

    if (!displayRepresentation.title) {
      appendIssue(issues, entity.id, `Inventory item ${index} must provide a display title.`);
      return null;
    }

    return displayRepresentation;
  } catch (error) {
    appendIssue(
      issues,
      entity.id,
      `displayRepresentation() threw for inventory item ${index}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function normalizeEntityIdentifier(
  entity: EntityDefinition<any>,
  item: EntityShape<EntityDefinition<any>>,
  index: number,
  issues: string[],
): string | null {
  try {
    const identifier = entity.identifier(item);

    if (typeof identifier !== "string" || identifier.length === 0) {
      appendIssue(issues, entity.id, `Inventory item ${index} produced an invalid identifier.`);
      return null;
    }

    return identifier;
  } catch (error) {
    appendIssue(
      issues,
      entity.id,
      `identifier() threw for inventory item ${index}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export function resolveLocalizedText(
  value: LocalizedText | undefined,
  fallback?: string,
): string | undefined {
  if (value === undefined) {
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

function resolveSpotlightOpenIntentId(spotlight: EntitySpotlightOptions): string | undefined {
  try {
    const target =
      typeof spotlight.openIntent === "function" ? spotlight.openIntent() : spotlight.openIntent;
    const id = typeof target === "string" ? target : target?.id;

    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeEntityDefinition<TEntity extends EntityDefinition<any>>(
  entity: TEntity,
): NormalizedEntityMetadata<TEntity> {
  const issues: string[] = [];
  const seenIdentifiers = new Set<string>();
  const inventory = ((entity.inventory ?? []) as readonly EntityShape<TEntity>[]).flatMap(
    (item, index): NormalizedEntityInventoryItem<TEntity>[] => {
      const identifier = normalizeEntityIdentifier(entity, item, index, issues);
      const displayRepresentation = normalizeEntityDisplayRepresentation(
        entity,
        item,
        index,
        issues,
      );

      if (!identifier || !displayRepresentation) {
        return [];
      }

      if (seenIdentifiers.has(identifier)) {
        appendIssue(issues, entity.id, `Duplicate inventory identifier "${identifier}".`);
        return [];
      }

      seenIdentifiers.add(identifier);

      return [
        {
          displayRepresentation: {
            ...(displayRepresentation.image?.systemName
              ? { imageSystemName: displayRepresentation.image.systemName }
              : {}),
            ...(displayRepresentation.subtitle ? { subtitle: displayRepresentation.subtitle } : {}),
            title: displayRepresentation.title,
          },
          identifier,
          jsonValue: JSON.stringify(
            serializeObjectParameterValue(
              entity.schema as ObjectParameterDefinition<
                Record<string, AnyParameterDefinition>,
                boolean
              >,
              item,
            ) as Record<string, unknown>,
          ),
          value: item,
        } satisfies NormalizedEntityInventoryItem<TEntity>,
      ];
    },
  );

  const catalog = entity.catalog ?? "static";

  if (catalog !== "static" && catalog !== "runtime") {
    appendIssue(
      issues,
      entity.id,
      `catalog must be "static" or "runtime", got "${String(catalog)}".`,
    );
  }

  const openIntentId = entity.spotlight
    ? resolveSpotlightOpenIntentId(entity.spotlight)
    : undefined;

  if (entity.spotlight) {
    if (!openIntentId) {
      appendIssue(
        issues,
        entity.id,
        "spotlight.openIntent must be an intent id, an intent from defineIntent(), or a function returning one.",
      );
    }

    if (catalog !== "runtime") {
      appendIssue(issues, entity.id, 'spotlight requires catalog: "runtime".');
    }
  }

  const appFunctionQuery = entity.android?.appFunctionQuery === true;

  if (appFunctionQuery) {
    if (catalog !== "runtime" && (!entity.inventory || entity.inventory.length === 0)) {
      appendIssue(
        issues,
        entity.id,
        'android.appFunctionQuery requires catalog: "runtime" or a static inventory.',
      );
    }

    for (const [fieldName, field] of Object.entries(entity.schema.fields) as [
      string,
      AnyParameterDefinition,
    ][]) {
      if (!isKotlinSafeName(fieldName)) {
        appendIssue(
          issues,
          entity.id,
          `Entity field "${fieldName}" is not a Kotlin-safe name for AppFunction codegen (reserved keyword or invalid identifier).`,
        );
      }

      validateAndroidAppFunctionParameter(field, entity.id, fieldName, issues);
    }
  }

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  return {
    appFunctionQuery,
    catalog,
    entity,
    id: entity.id,
    inventory,
    schema: entity.schema,
    ...(openIntentId ? { spotlight: { openIntentId } } : {}),
    title: resolveLocalizedText(entity.title, entity.id) ?? entity.id,
  };
}

function collectReferencedEntitiesFromParameter(
  definition: AnyParameterDefinition,
  entitiesById: Map<string, EntityDefinition<any>>,
  issues: string[],
  stack: readonly string[] = [],
): void {
  if (definition.kind === "object") {
    for (const field of Object.values(definition.fields)) {
      collectReferencedEntitiesFromParameter(field, entitiesById, issues, stack);
    }

    return;
  }

  if (definition.kind !== "entity") {
    return;
  }

  const entity = definition.entity;
  const existing = entitiesById.get(entity.id);

  if (existing && existing !== entity) {
    appendIssue(issues, entity.id, "Duplicate entity id detected across referenced definitions.");
    return;
  }

  if (stack.includes(entity.id)) {
    appendIssue(
      issues,
      entity.id,
      `Entity schema references itself recursively through ${[...stack, entity.id].join(" -> ")}.`,
    );
    return;
  }

  if (!existing) {
    entitiesById.set(entity.id, entity);
  }

  const nextStack = [...stack, entity.id];

  for (const field of Object.values(entity.schema.fields) as AnyParameterDefinition[]) {
    collectReferencedEntitiesFromParameter(field, entitiesById, issues, nextStack);
  }
}

function validateIntentEntities(
  intent: IntentDefinition<any>,
  surfaces: Required<IntentSurfaces>,
  android: NormalizedAndroidIntentMetadata | undefined,
  issues: string[],
): void {
  const params = Object.values(intent.params) as AnyParameterDefinition[];
  const entityParams = params.filter(
    (definition): definition is Extract<AnyParameterDefinition, { kind: "entity" }> =>
      definition.kind === "entity",
  );

  if (surfaces.appShortcut) {
    for (const definition of entityParams) {
      if (!definition.entity.inventory || definition.entity.inventory.length === 0) {
        appendIssue(
          issues,
          intent.id,
          `Entity parameter "${definition.entity.id}" needs static inventory for App Shortcut codegen.`,
        );
      }
    }
  }

  if (!android?.appAction) {
    return;
  }

  validateAndroidAppAction(intent, params, android.appAction, issues);

  if (entityParams.length > 1) {
    appendIssue(
      issues,
      intent.id,
      "Android BII codegen currently supports at most one entity parameter per intent.",
    );
  }

  for (const [paramName, definition] of Object.entries(intent.params) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (!definition.androidBiiParam) {
      appendIssue(
        issues,
        intent.id,
        `Parameter "${paramName}" must declare androidBiiParam when android.appAction is configured.`,
      );
    }

    if (definition.kind === "entity") {
      if (!definition.entity.inventory || definition.entity.inventory.length === 0) {
        appendIssue(
          issues,
          intent.id,
          `Entity parameter "${paramName}" needs static inventory for Android capability generation.`,
        );
      }
    }
  }
}

export function normalizeIntentDefinition<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
): NormalizedIntentMetadata<TIntent> {
  const issues: string[] = [];
  const params = (Object.entries(intent.params) as [string, AnyParameterDefinition][]).map(
    ([name, definition]) => normalizeParameterMetadata(name, definition),
  );
  const phrases = normalizePhrases(intent, issues);
  const android = normalizeAndroidMetadata(intent, issues);
  const ios = normalizeIOSMetadata(intent, issues);
  const surfaces = normalizeSurfaces(intent.surfaces);

  if (android?.appAction) {
    surfaces.assistant = true;
  }

  if (ios?.appIntent) {
    surfaces.siri = true;
  }

  if (surfaces.appShortcut && phrases.length === 0) {
    appendIssue(issues, intent.id, "App Shortcut intents must declare at least one phrase.");
  }

  validateIntentEntities(intent, surfaces, android, issues);

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  const normalized: Omit<NormalizedIntentMetadata<TIntent>, "description"> & {
    description?: string;
  } = {
    appShortcut: normalizeAppShortcutMetadata(intent.surfaces?.appShortcut, intent.id, issues),
    ...(android ? { android } : {}),
    behavior: normalizeBehavior(intent.behavior),
    id: intent.id,
    ...(ios ? { ios } : {}),
    intent,
    params,
    phrases,
    surfaces,
    title: resolveLocalizedText(intent.title, intent.id) ?? intent.id,
  };
  const description = resolveLocalizedText(intent.description);

  if (description) {
    normalized.description = description;
  }

  return normalized as NormalizedIntentMetadata<TIntent>;
}

export function normalizeIntentDefinitions<TIntents extends readonly IntentDefinition<any>[]>(
  intents: TIntents,
): readonly NormalizedIntentMetadata<TIntents[number]>[] {
  const normalized = intents.map((intent) => normalizeIntentDefinition(intent));
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];

  for (const intent of normalized) {
    if (seenIds.has(intent.id)) {
      duplicateIds.push(intent.id);
      continue;
    }

    seenIds.add(intent.id);
  }

  if (duplicateIds.length > 0) {
    throw new AppIntentsValidationError(
      duplicateIds.map((intentId) => `Duplicate intent id "${intentId}".`),
    );
  }

  return normalized;
}

export function normalizeReferencedEntities<TIntents extends readonly IntentDefinition<any>[]>(
  intents: TIntents,
): readonly NormalizedEntityMetadata[] {
  const entitiesById = new Map<string, EntityDefinition<any>>();
  const issues: string[] = [];

  for (const intent of intents) {
    for (const definition of Object.values(intent.params) as AnyParameterDefinition[]) {
      collectReferencedEntitiesFromParameter(definition, entitiesById, issues);
    }
  }

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  const normalized = [...entitiesById.values()].map((entity) => normalizeEntityDefinition(entity));
  const spotlightIssues: string[] = [];

  for (const entity of normalized) {
    if (!entity.spotlight) {
      continue;
    }

    const openIntent = intents.find((intent) => intent.id === entity.spotlight?.openIntentId);

    if (!openIntent) {
      appendIssue(
        spotlightIssues,
        entity.id,
        `spotlight.openIntent "${entity.spotlight.openIntentId}" is not one of the configured intents.`,
      );
      continue;
    }

    const entityParams = Object.values(
      openIntent.params as Record<string, AnyParameterDefinition>,
    ).filter((definition) => definition.kind === "entity" && definition.entity.id === entity.id);

    if (entityParams.length !== 1 || entityParams[0]?.optional === true) {
      appendIssue(
        spotlightIssues,
        entity.id,
        `spotlight.openIntent "${openIntent.id}" must take exactly one required parameter of this entity.`,
      );
    }
  }

  if (spotlightIssues.length > 0) {
    throw new AppIntentsValidationError(spotlightIssues);
  }

  return normalized;
}
