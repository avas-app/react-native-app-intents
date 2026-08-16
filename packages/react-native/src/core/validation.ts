import { ANDROID_APP_ACTION_CATALOG } from "./android-app-actions.js";
import type { EntityDefinition, EntityDisplayRepresentation, EntityShape } from "./entity.js";
import {
  DEFAULT_LOCALE,
  collectLocalizedTextLocales,
  collectPhraseLocales,
  normalizeLocaleTag,
  resolveDefaultPhrases,
  resolveLocalizedText,
  resolvePhrasesForLocale,
} from "./localization.js";
import type { AnyParameterDefinition, ObjectParameterDefinition } from "./schema.js";
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

/** Points at the declaration a codegen diagnostic came from. */
export interface AppIntentsSourceLocation {
  /** Path to the file that declares the intent or entity. */
  filePath: string;
  /** 1-based line of the declaration, when it could be located. */
  line?: number;
  /** 1-based column of the declaration, when it could be located. */
  column?: number;
}

/** A single validation problem, with the declaration it originated from. */
export interface AppIntentsIssue {
  /** Human-readable description of the problem. */
  message: string;
  /** Intent or entity id the problem belongs to. */
  scopeId: string;
  /** Source declaration the problem points at, when known. */
  location?: AppIntentsSourceLocation;
}

/** Options shared by the normalization entry points. */
export interface NormalizeOptions {
  /** Locale that generated native artifacts are authored in. Defaults to `"en"`. */
  defaultLocale?: string;
  /** Source declaration for each intent or entity definition, keyed by object identity. */
  sourceLocations?: ReadonlyMap<object, AppIntentsSourceLocation>;
}

/** Formats a source location as the `path:line:column` prefix used in diagnostics. */
export function formatSourceLocation(location: AppIntentsSourceLocation): string {
  if (location.line === undefined) {
    return location.filePath;
  }

  if (location.column === undefined) {
    return `${location.filePath}:${location.line}`;
  }

  return `${location.filePath}:${location.line}:${location.column}`;
}

/** Formats a single issue as a one-line diagnostic. */
export function formatIssue(issue: AppIntentsIssue): string {
  const scope = `[${issue.scopeId}] ${issue.message}`;

  return issue.location ? `${formatSourceLocation(issue.location)} ${scope}` : scope;
}

export class AppIntentsValidationError extends Error {
  /** Formatted one-line diagnostics, including source locations when known. */
  readonly issues: readonly string[];
  /** Structured diagnostics, for tooling that wants the parts separately. */
  readonly details: readonly AppIntentsIssue[];

  constructor(details: readonly AppIntentsIssue[] | readonly string[]) {
    const normalizedDetails: readonly AppIntentsIssue[] = details.map((detail) =>
      typeof detail === "string" ? { message: detail, scopeId: "app-intents" } : detail,
    );
    const issues = normalizedDetails.map((issue) => formatIssue(issue));

    super(issues.join("\n"));
    this.name = "AppIntentsValidationError";
    this.details = normalizedDetails;
    this.issues = issues;
  }
}

export interface NormalizedPhraseMetadata {
  appShortcutPhrase: string;
  placeholders: readonly string[];
  raw: string;
  swiftAppShortcutPhrase: string;
  /**
   * Translated forms of this phrase keyed by locale, in the same normalized shape as
   * `swiftAppShortcutPhrase`. Excludes the default locale.
   */
  translations: Readonly<Record<string, string>>;
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
  entity: TEntity;
  id: string;
  inventory: readonly NormalizedEntityInventoryItem<TEntity>[];
  schema: TEntity["schema"];
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

export interface NormalizedAndroidIntentMetadata {
  appAction?: NormalizedAndroidAppActionMetadata;
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

interface IssueScope {
  scopeId: string;
  location?: AppIntentsSourceLocation;
}

function appendIssue(issues: AppIntentsIssue[], scope: IssueScope, message: string): void {
  issues.push({
    message,
    scopeId: scope.scopeId,
    ...(scope.location ? { location: scope.location } : {}),
  });
}

function getIssueScope(
  scopeId: string,
  definition: object,
  options: NormalizeOptions | undefined,
): IssueScope {
  const location = options?.sourceLocations?.get(definition);

  return { scopeId, ...(location ? { location } : {}) };
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
): Omit<NormalizedPhraseMetadata, "translations"> {
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

function normalizeParameterMetadata(
  name: string,
  definition: AnyParameterDefinition,
  defaultLocale: string,
): NormalizedParameterMetadata {
  const localeOptions = { defaultLocale };
  const metadata: NormalizedParameterMetadata = {
    hasDefault: "default" in definition && definition.default !== undefined,
    kind: definition.kind,
    name,
    optional: definition.optional === true,
    title: resolveLocalizedText(definition.title, name, localeOptions) ?? name,
  };

  const prompt = resolveLocalizedText(definition.prompt, undefined, localeOptions);
  const requestValueDialog = resolveLocalizedText(
    definition.requestValueDialog,
    undefined,
    localeOptions,
  );

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
      normalizeParameterMetadata(fieldName, field, defaultLocale),
    );
  }

  if (definition.kind === "entity") {
    metadata.entityId = definition.entity.id;
  }

  return metadata;
}

function validatePhrasePlaceholders(
  intent: IntentDefinition<any>,
  phrase: string,
  placeholders: readonly string[],
  paramNames: ReadonlySet<string>,
  scope: IssueScope,
  issues: AppIntentsIssue[],
  locale?: string,
): void {
  const localeSuffix = locale ? ` (locale "${locale}")` : "";

  for (const placeholder of placeholders) {
    if (placeholder === ".applicationName") {
      continue;
    }

    if (!paramNames.has(placeholder)) {
      appendIssue(
        issues,
        scope,
        `Phrase "${phrase}"${localeSuffix} references unknown placeholder "${placeholder}".`,
      );
      continue;
    }

    const parameter = intent.params[placeholder];

    if (parameter?.kind === "object") {
      appendIssue(
        issues,
        scope,
        `Phrase "${phrase}"${localeSuffix} cannot interpolate object parameter "${placeholder}".`,
      );
    }
  }
}

function normalizePhrases(
  intent: IntentDefinition<any>,
  scope: IssueScope,
  issues: AppIntentsIssue[],
  defaultLocale: string,
): readonly NormalizedPhraseMetadata[] {
  const localizedPhrases = intent.phrases;

  if (!localizedPhrases) {
    return [];
  }

  const phrases = resolveDefaultPhrases(localizedPhrases, defaultLocale);
  const paramNames = new Set(Object.keys(intent.params));
  const translationLocales = new Set<string>();

  collectPhraseLocales(localizedPhrases, translationLocales);
  translationLocales.delete(normalizeLocaleTag(defaultLocale));

  const translationsByLocale = new Map<string, readonly string[]>();

  for (const locale of translationLocales) {
    const translated = resolvePhrasesForLocale(localizedPhrases, locale);

    if (!translated) {
      continue;
    }

    if (translated.length !== phrases.length) {
      appendIssue(
        issues,
        scope,
        `Locale "${locale}" declares ${translated.length} phrase${
          translated.length === 1 ? "" : "s"
        } but the default locale "${normalizeLocaleTag(defaultLocale)}" declares ${phrases.length}. Phrase translations are matched by position, so both lists must be the same length.`,
      );
      continue;
    }

    translationsByLocale.set(locale, translated);
  }

  return phrases.map((phrase, index) => {
    const metadata = normalizeAppShortcutPhrase(phrase, paramNames);

    validatePhrasePlaceholders(intent, phrase, metadata.placeholders, paramNames, scope, issues);

    const translations: Record<string, string> = {};

    for (const [locale, translated] of translationsByLocale) {
      const translatedPhrase = translated[index];

      if (translatedPhrase === undefined) {
        continue;
      }

      const translatedMetadata = normalizeAppShortcutPhrase(translatedPhrase, paramNames);

      validatePhrasePlaceholders(
        intent,
        translatedPhrase,
        translatedMetadata.placeholders,
        paramNames,
        scope,
        issues,
        locale,
      );

      // The default locale gets the app name appended with an English connector when the author
      // leaves it out. There is no language-agnostic equivalent, so translations have to place the
      // token themselves rather than inherit an English preposition.
      if (!translatedMetadata.placeholders.includes(".applicationName")) {
        appendIssue(
          issues,
          scope,
          `Phrase "${translatedPhrase}" (locale "${locale}") must include ${APP_NAME_PLACEHOLDER}. Apple requires the app name in every App Shortcut phrase, and it cannot be appended automatically in a locale other than the default one.`,
        );
        continue;
      }

      translations[locale] = translatedMetadata.swiftAppShortcutPhrase;
    }

    return { ...metadata, translations };
  });
}

function normalizeAppShortcutMetadata(
  appShortcut: IntentSurfaces["appShortcut"] | undefined,
  scope: IssueScope,
  issues: AppIntentsIssue[],
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
        scope,
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
      scope,
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

function normalizeAndroidMetadata(
  intent: IntentDefinition<any>,
  scope: IssueScope,
  issues: AppIntentsIssue[],
): NormalizedAndroidIntentMetadata | undefined {
  const appAction = intent.android?.appAction;
  const capabilityName = appAction?.capability ?? intent.androidBii;

  if (!capabilityName) {
    if (intent.surfaces?.assistant) {
      appendIssue(
        issues,
        scope,
        "surfaces.assistant no longer enables Android App Actions by itself. Configure android.appAction.",
      );
    }

    return undefined;
  }

  return {
    appAction: {
      capabilityName,
      fulfillment: appAction?.fulfillment ?? "deeplink",
      inventoryStrategy: appAction?.inventory?.strategy ?? "static",
    },
  };
}

function normalizeIOSResponseMetadata(
  response: IOSAppIntentResponseOptions | undefined,
  defaultLocale: string,
): NormalizedIOSAppIntentResponseMetadata | undefined {
  const dialog = resolveLocalizedText(response?.dialog, undefined, { defaultLocale });

  if (!dialog) {
    return undefined;
  }

  return {
    dialog,
  };
}

function normalizeIOSMetadata(
  intent: IntentDefinition<any>,
  scope: IssueScope,
  issues: AppIntentsIssue[],
  defaultLocale: string,
): NormalizedIOSIntentMetadata | undefined {
  const appIntent = intent.ios?.appIntent;

  if (!appIntent) {
    if (intent.surfaces?.siri) {
      appendIssue(
        issues,
        scope,
        "surfaces.siri no longer enables iOS App Intents by itself. Configure ios.appIntent.",
      );
    }

    return undefined;
  }

  const response = normalizeIOSResponseMetadata(appIntent.response, defaultLocale);

  if (response?.dialog && intent.behavior?.opensAppToForeground === true) {
    appendIssue(
      issues,
      scope,
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
  scope: IssueScope,
  issues: AppIntentsIssue[],
): void {
  if (!android) {
    return;
  }

  if (!android.capabilityName.startsWith("actions.intent.")) {
    appendIssue(
      issues,
      scope,
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
        scope,
        `Android App Actions capability "${android.capabilityName}" does not support parameter "${parameterName}".`,
      );
    }
  }

  for (const parameterName of catalogEntry.requiredParameterNames ?? []) {
    if (!configuredParameterNames.has(parameterName)) {
      appendIssue(
        issues,
        scope,
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
  scope: IssueScope,
  issues: AppIntentsIssue[],
): EntityDisplayRepresentation | null {
  try {
    const displayRepresentation = entity.displayRepresentation(item);

    if (displayRepresentation.image?.uri) {
      appendIssue(
        issues,
        scope,
        `Inventory item ${index} uses image.uri, which codegen does not support yet.`,
      );
    }

    if (!displayRepresentation.title) {
      appendIssue(issues, scope, `Inventory item ${index} must provide a display title.`);
      return null;
    }

    return displayRepresentation;
  } catch (error) {
    appendIssue(
      issues,
      scope,
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
  scope: IssueScope,
  issues: AppIntentsIssue[],
): string | null {
  try {
    const identifier = entity.identifier(item);

    if (typeof identifier !== "string" || identifier.length === 0) {
      appendIssue(issues, scope, `Inventory item ${index} produced an invalid identifier.`);
      return null;
    }

    return identifier;
  } catch (error) {
    appendIssue(
      issues,
      scope,
      `identifier() threw for inventory item ${index}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export function normalizeEntityDefinition<TEntity extends EntityDefinition<any>>(
  entity: TEntity,
  options: NormalizeOptions = {},
): NormalizedEntityMetadata<TEntity> {
  const issues: AppIntentsIssue[] = [];
  const scope = getIssueScope(entity.id, entity, options);
  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE;
  const seenIdentifiers = new Set<string>();
  const inventory = ((entity.inventory ?? []) as readonly EntityShape<TEntity>[]).flatMap(
    (item, index): NormalizedEntityInventoryItem<TEntity>[] => {
      const identifier = normalizeEntityIdentifier(entity, item, index, scope, issues);
      const displayRepresentation = normalizeEntityDisplayRepresentation(
        entity,
        item,
        index,
        scope,
        issues,
      );

      if (!identifier || !displayRepresentation) {
        return [];
      }

      if (seenIdentifiers.has(identifier)) {
        appendIssue(issues, scope, `Duplicate inventory identifier "${identifier}".`);
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

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  return {
    entity,
    id: entity.id,
    inventory,
    schema: entity.schema,
    title: resolveLocalizedText(entity.title, entity.id, { defaultLocale }) ?? entity.id,
  };
}

function collectReferencedEntitiesFromParameter(
  definition: AnyParameterDefinition,
  entitiesById: Map<string, EntityDefinition<any>>,
  scope: IssueScope,
  issues: AppIntentsIssue[],
  stack: readonly string[] = [],
): void {
  if (definition.kind === "object") {
    for (const field of Object.values(definition.fields)) {
      collectReferencedEntitiesFromParameter(field, entitiesById, scope, issues, stack);
    }

    return;
  }

  if (definition.kind !== "entity") {
    return;
  }

  const entity = definition.entity;
  const entityScope: IssueScope = { ...scope, scopeId: entity.id };
  const existing = entitiesById.get(entity.id);

  if (existing && existing !== entity) {
    appendIssue(issues, entityScope, "Duplicate entity id detected across referenced definitions.");
    return;
  }

  if (stack.includes(entity.id)) {
    appendIssue(
      issues,
      entityScope,
      `Entity schema references itself recursively through ${[...stack, entity.id].join(" -> ")}.`,
    );
    return;
  }

  if (!existing) {
    entitiesById.set(entity.id, entity);
  }

  const nextStack = [...stack, entity.id];

  for (const field of Object.values(entity.schema.fields) as AnyParameterDefinition[]) {
    collectReferencedEntitiesFromParameter(field, entitiesById, scope, issues, nextStack);
  }
}

function validateIntentEntities(
  intent: IntentDefinition<any>,
  surfaces: Required<IntentSurfaces>,
  android: NormalizedAndroidIntentMetadata | undefined,
  scope: IssueScope,
  issues: AppIntentsIssue[],
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
          scope,
          `Entity parameter "${definition.entity.id}" needs static inventory for App Shortcut codegen.`,
        );
      }
    }
  }

  if (!android?.appAction) {
    return;
  }

  validateAndroidAppAction(intent, params, android.appAction, scope, issues);

  if (entityParams.length > 1) {
    appendIssue(
      issues,
      scope,
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
        scope,
        `Parameter "${paramName}" must declare androidBiiParam when android.appAction is configured.`,
      );
    }

    if (definition.kind === "entity") {
      if (!definition.entity.inventory || definition.entity.inventory.length === 0) {
        appendIssue(
          issues,
          scope,
          `Entity parameter "${paramName}" needs static inventory for Android capability generation.`,
        );
      }
    }
  }
}

export function normalizeIntentDefinition<TIntent extends IntentDefinition<any>>(
  intent: TIntent,
  options: NormalizeOptions = {},
): NormalizedIntentMetadata<TIntent> {
  const issues: AppIntentsIssue[] = [];
  const scope = getIssueScope(intent.id, intent, options);
  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE;
  const params = (Object.entries(intent.params) as [string, AnyParameterDefinition][]).map(
    ([name, definition]) => normalizeParameterMetadata(name, definition, defaultLocale),
  );
  const phrases = normalizePhrases(intent, scope, issues, defaultLocale);
  const android = normalizeAndroidMetadata(intent, scope, issues);
  const ios = normalizeIOSMetadata(intent, scope, issues, defaultLocale);
  const surfaces = normalizeSurfaces(intent.surfaces);

  if (android?.appAction) {
    surfaces.assistant = true;
  }

  if (ios?.appIntent) {
    surfaces.siri = true;
  }

  if (surfaces.appShortcut && phrases.length === 0) {
    appendIssue(issues, scope, "App Shortcut intents must declare at least one phrase.");
  }

  validateIntentEntities(intent, surfaces, android, scope, issues);

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  const normalized: Omit<NormalizedIntentMetadata<TIntent>, "description"> & {
    description?: string;
  } = {
    appShortcut: normalizeAppShortcutMetadata(intent.surfaces?.appShortcut, scope, issues),
    ...(android ? { android } : {}),
    behavior: normalizeBehavior(intent.behavior),
    id: intent.id,
    ...(ios ? { ios } : {}),
    intent,
    params,
    phrases,
    surfaces,
    title: resolveLocalizedText(intent.title, intent.id, { defaultLocale }) ?? intent.id,
  };
  const description = resolveLocalizedText(intent.description, undefined, { defaultLocale });

  if (description) {
    normalized.description = description;
  }

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  return normalized as NormalizedIntentMetadata<TIntent>;
}

export function normalizeIntentDefinitions<TIntents extends readonly IntentDefinition<any>[]>(
  intents: TIntents,
  options: NormalizeOptions = {},
): readonly NormalizedIntentMetadata<TIntents[number]>[] {
  const normalized = intents.map((intent) => normalizeIntentDefinition(intent, options));
  const seenIds = new Set<string>();
  const duplicateIssues: AppIntentsIssue[] = [];

  for (const intent of normalized) {
    if (seenIds.has(intent.id)) {
      appendIssue(
        duplicateIssues,
        getIssueScope(intent.id, intent.intent, options),
        `Duplicate intent id "${intent.id}".`,
      );
      continue;
    }

    seenIds.add(intent.id);
  }

  if (duplicateIssues.length > 0) {
    throw new AppIntentsValidationError(duplicateIssues);
  }

  return normalized;
}

export function normalizeReferencedEntities<TIntents extends readonly IntentDefinition<any>[]>(
  intents: TIntents,
  options: NormalizeOptions = {},
): readonly NormalizedEntityMetadata[] {
  const entitiesById = new Map<string, EntityDefinition<any>>();
  const entityScopes = new Map<string, IssueScope>();
  const issues: AppIntentsIssue[] = [];

  for (const intent of intents) {
    const scope = getIssueScope(intent.id, intent, options);

    for (const definition of Object.values(intent.params) as AnyParameterDefinition[]) {
      const before = new Set(entitiesById.keys());

      collectReferencedEntitiesFromParameter(definition, entitiesById, scope, issues);

      for (const entityId of entitiesById.keys()) {
        if (!before.has(entityId)) {
          entityScopes.set(entityId, { ...scope, scopeId: entityId });
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new AppIntentsValidationError(issues);
  }

  return [...entitiesById.values()].map((entity) => {
    const scope = entityScopes.get(entity.id);
    const sourceLocations = new Map(options.sourceLocations ?? []);

    if (scope?.location && !sourceLocations.has(entity)) {
      sourceLocations.set(entity, scope.location);
    }

    return normalizeEntityDefinition(entity, { ...options, sourceLocations });
  });
}

/**
 * Collects every locale referenced by the localized fields of the given intents.
 *
 * The result always includes `defaultLocale`, and is sorted with the default locale first so
 * generated artifacts have a stable order.
 */
export function collectProjectLocales(
  intents: readonly IntentDefinition<any>[],
  options: NormalizeOptions = {},
): readonly string[] {
  const defaultLocale = normalizeLocaleTag(options.defaultLocale ?? DEFAULT_LOCALE);
  const locales = new Set<string>();
  const visitedEntities = new Set<EntityDefinition<any>>();

  function visitParameter(definition: AnyParameterDefinition): void {
    collectLocalizedTextLocales(definition.title, locales);
    collectLocalizedTextLocales(definition.prompt, locales);
    collectLocalizedTextLocales(definition.requestValueDialog, locales);

    if (definition.kind === "object") {
      for (const field of Object.values(definition.fields) as AnyParameterDefinition[]) {
        visitParameter(field);
      }

      return;
    }

    if (definition.kind !== "entity" || visitedEntities.has(definition.entity)) {
      return;
    }

    visitedEntities.add(definition.entity);
    collectLocalizedTextLocales(definition.entity.title, locales);

    for (const field of Object.values(
      definition.entity.schema.fields,
    ) as AnyParameterDefinition[]) {
      visitParameter(field);
    }
  }

  for (const intent of intents) {
    collectLocalizedTextLocales(intent.title, locales);
    collectLocalizedTextLocales(intent.description, locales);
    collectLocalizedTextLocales(intent.ios?.appIntent?.response?.dialog, locales);
    collectPhraseLocales(intent.phrases, locales);

    for (const definition of Object.values(intent.params) as AnyParameterDefinition[]) {
      visitParameter(definition);
    }
  }

  locales.delete(defaultLocale);

  return [defaultLocale, ...[...locales].sort()];
}
