import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { loadModule } from "@expo/require-utils";
import {
  normalizeIntentDefinitions,
  normalizeReferencedEntities,
  resolveLocalizedText,
  type AnyParameterDefinition,
  type IntentDefinition,
  type NormalizedEntityMetadata,
  type NormalizedIntentMetadata,
  type ObjectParameterDefinition,
} from "../core/index.js";

import type { AppIntentsConfig } from "./config.js";

export interface GeneratedArtifact {
  platform: "ios" | "android" | "types";
  path: string;
}

export interface GenerateAppIntentsOptions {
  cwd?: string;
  check?: boolean;
}

export interface GenerateAppIntentsResult {
  artifacts: GeneratedArtifact[];
  changed: boolean;
  diagnostics?: readonly string[];
  message: string;
}

interface LoadedIntentSource {
  absolutePath: string;
  exportName: string;
  importKind: "default" | "named";
  intent: IntentDefinition<any>;
}

interface RenderedArtifacts {
  androidManifest?: string;
  artifacts: Array<GeneratedArtifact & { content: string }>;
  diagnostics: string[];
}

interface AndroidShortcutArtifact {
  capabilityBindings?: readonly AndroidShortcutCapabilityBinding[];
  id: string;
  iconResourceName?: string;
  longLabel: string;
  shortLabel: string;
  shortLabelResourceName: string;
  longLabelResourceName: string;
  url: string;
}

interface AndroidShortcutCapabilityBinding {
  capabilityName: string;
  parameterBindings: readonly AndroidShortcutParameterBinding[];
}

interface AndroidShortcutParameterBinding {
  key: string;
  value: string;
}

interface AndroidCapabilityArtifact {
  name: string;
  parameterNames: readonly string[];
}

type SwiftLeafParameterDefinition = Exclude<AnyParameterDefinition, { kind: "object" }>;

interface SwiftRenderableParameter {
  declarationName: string;
  definition: SwiftLeafParameterDefinition;
  optional: boolean;
  path: readonly string[];
}

const IOS_PENDING_URLS_DEFAULTS_KEY = "ReactNativeAppIntentsPendingURLs";

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    const nextCharacter = pattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      const slashAfterGlobstar = pattern[index + 2] === "/";

      expression += slashAfterGlobstar ? "(?:.*/)?" : ".*";
      index += slashAfterGlobstar ? 2 : 1;
      continue;
    }

    if (character === "*") {
      expression += "[^/]*";
      continue;
    }

    if (character === "?") {
      expression += "[^/]";
      continue;
    }

    expression += escapeRegExp(character);
  }

  expression += "$";

  return new RegExp(expression);
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }

    const absolutePath = resolve(current, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function resolveIntentModulePaths(
  patterns: readonly string[],
  cwd: string,
): Promise<string[]> {
  const allFiles = await walkFiles(cwd);
  const matches = new Set<string>();

  for (const pattern of patterns) {
    const matcher = globToRegExp(pattern.replaceAll("\\", "/"));

    for (const file of allFiles) {
      const relativePath = relative(cwd, file).replaceAll("\\", "/");

      if (matcher.test(relativePath)) {
        matches.add(file);
      }
    }
  }

  return [...matches].sort();
}

function isIntentDefinition(value: unknown): value is IntentDefinition<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "intent" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

async function loadIntentSources(
  patterns: readonly string[],
  cwd: string,
): Promise<LoadedIntentSource[]> {
  const modulePaths = await resolveIntentModulePaths(patterns, cwd);
  const loaded: LoadedIntentSource[] = [];

  for (const modulePath of modulePaths) {
    const moduleExports = await loadModule(modulePath);

    for (const [exportName, value] of Object.entries(moduleExports)) {
      if (!isIntentDefinition(value)) {
        continue;
      }

      loaded.push({
        absolutePath: modulePath,
        exportName,
        importKind: exportName === "default" ? "default" : "named",
        intent: value,
      });
    }
  }

  if (loaded.length === 0) {
    throw new Error("No intent definitions were found for the configured patterns.");
  }

  return loaded;
}

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

function escapeSwiftString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serializeParameterDefault(definition: AnyParameterDefinition, value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  switch (definition.kind) {
    case "date":
      return value instanceof Date ? value.toISOString() : value;
    case "entity":
      return serializeObjectParameterDefault(definition.entity.schema, value);
    case "object": {
      return serializeObjectParameterDefault(definition, value);
    }
    default:
      return value;
  }
}

function serializeObjectParameterDefault(
  definition:
    | Extract<AnyParameterDefinition, { kind: "object" }>
    | ObjectParameterDefinition<Record<string, AnyParameterDefinition>, boolean>,
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
    serialized[fieldName] = serializeParameterDefault(
      fieldDefinition,
      (value as Record<string, unknown>)[fieldName],
    );
  }

  return serialized;
}

function buildDefaultParams(intent: NormalizedIntentMetadata): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};

  for (const [paramName, definition] of Object.entries(intent.intent.params) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (!("default" in definition) || definition.default === undefined) {
      return null;
    }

    params[paramName] = serializeParameterDefault(definition, definition.default);
  }

  return params;
}

function buildIntentUrl(scheme: string, intentId: string, params: Record<string, unknown>): string {
  return `${scheme}://app-intents/${encodeURIComponent(intentId)}?payload=${encodeURIComponent(
    JSON.stringify(params),
  )}`;
}

function toSwiftAppShortcutPhrase(
  phrase: string,
  parametersByName: ReadonlyMap<string, NormalizedIntentMetadata["params"][number]>,
): string {
  const appNameSentinel = "__APP_NAME_PLACEHOLDER__";
  const parameterSentinelPattern = /__PARAMETER_PLACEHOLDER_([A-Za-z0-9_]+)__/g;
  let rendered = phrase.replaceAll("${.applicationName}", appNameSentinel);

  rendered = rendered.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match, parameterName: string) => {
    return parametersByName.get(parameterName)?.kind === "entity"
      ? `__PARAMETER_PLACEHOLDER_${parameterName}__`
      : "";
  });
  rendered = rendered.replace(/\s+/g, " ").trim();
  rendered = escapeSwiftString(rendered).replaceAll(appNameSentinel, "\\(.applicationName)");

  return rendered.replace(
    parameterSentinelPattern,
    (_match, parameterName: string) => `\\(\\.$${parameterName})`,
  );
}

function toAndroidResourceName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function getAndroidAppActionCapabilityName(intent: NormalizedIntentMetadata): string | null {
  return intent.android?.appAction?.capabilityName ?? null;
}

function getAndroidShortcutArtifact(
  intent: NormalizedIntentMetadata,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
  scheme: string,
): AndroidShortcutArtifact | null {
  const defaultParams = buildDefaultParams(intent);

  if (!defaultParams) {
    return null;
  }

  const resourceBaseName = toAndroidResourceName(intent.id);

  return {
    id: intent.id,
    longLabel: intent.description ?? intent.title,
    longLabelResourceName: `react_native_app_intents_${resourceBaseName}_long_label`,
    shortLabel: intent.title,
    shortLabelResourceName: `react_native_app_intents_${resourceBaseName}_short_label`,
    ...(intent.appShortcut.iconAndroidResourceName
      ? { iconResourceName: intent.appShortcut.iconAndroidResourceName }
      : {}),
    ...(getAndroidAppActionCapabilityName(intent)
      ? {
          capabilityBindings: getAndroidCapabilityBindings(intent, defaultParams, entitiesById),
        }
      : {}),
    url: buildIntentUrl(scheme, intent.id, defaultParams),
  };
}

function getAndroidShortcutArtifacts(
  intentMetadata: readonly NormalizedIntentMetadata[],
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
  scheme: string,
): AndroidShortcutArtifact[] {
  const artifacts: AndroidShortcutArtifact[] = [];

  for (const intent of intentMetadata) {
    if (!intent.surfaces.appShortcut) {
      continue;
    }

    const artifact = getAndroidShortcutArtifact(intent, entitiesById, scheme);

    if (artifact) {
      artifacts.push(artifact);
    }
  }

  return artifacts;
}

function buildDefaultParamsExcept(
  intent: NormalizedIntentMetadata,
  omittedParameterName: string,
): Record<string, unknown> | null {
  const params: Record<string, unknown> = {};

  for (const [paramName, definition] of Object.entries(intent.intent.params) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (paramName === omittedParameterName) {
      continue;
    }

    if (!("default" in definition) || definition.default === undefined) {
      return null;
    }

    params[paramName] = serializeParameterDefault(definition, definition.default);
  }

  return params;
}

function getAndroidCapabilityBindingValue(
  parameter: NormalizedIntentMetadata["params"][number],
  value: unknown,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): string | null {
  if (value === undefined) {
    return null;
  }

  if (parameter.kind === "entity" && parameter.entityId) {
    const entity = entitiesById.get(parameter.entityId);

    if (!entity) {
      return null;
    }

    const serializedValue = JSON.stringify(value);
    const inventoryItem = entity.inventory.find((item) => item.jsonValue === serializedValue);

    return inventoryItem?.displayRepresentation.title ?? null;
  }

  return String(value);
}

function getAndroidCapabilityBindings(
  intent: NormalizedIntentMetadata,
  params: Record<string, unknown>,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): readonly AndroidShortcutCapabilityBinding[] {
  const capabilityName = getAndroidAppActionCapabilityName(intent);

  if (!capabilityName) {
    return [];
  }

  const parameterBindings = intent.params.flatMap((parameter) => {
    if (!parameter.androidBiiParam) {
      return [];
    }

    const value = getAndroidCapabilityBindingValue(parameter, params[parameter.name], entitiesById);

    if (value === null) {
      return [];
    }

    return [{ key: parameter.androidBiiParam, value }];
  });

  if (parameterBindings.length === 0) {
    return [];
  }

  return [{ capabilityName, parameterBindings }];
}

function getAndroidCapabilityArtifacts(
  intentMetadata: readonly NormalizedIntentMetadata[],
): AndroidCapabilityArtifact[] {
  const parameterNamesByCapability = new Map<string, Set<string>>();

  for (const intent of intentMetadata) {
    const capabilityName = getAndroidAppActionCapabilityName(intent);

    if (!capabilityName) {
      continue;
    }

    const parameterNames = parameterNamesByCapability.get(capabilityName) ?? new Set<string>();

    for (const parameter of intent.params) {
      if (parameter.androidBiiParam) {
        parameterNames.add(parameter.androidBiiParam);
      }
    }

    parameterNamesByCapability.set(capabilityName, parameterNames);
  }

  return [...parameterNamesByCapability.entries()].map(([name, parameterNames]) => ({
    name,
    parameterNames: [...parameterNames],
  }));
}

function getAndroidCapabilityInventoryShortcuts(
  intentMetadata: readonly NormalizedIntentMetadata[],
  entityMetadata: readonly NormalizedEntityMetadata[],
  scheme: string,
): AndroidShortcutArtifact[] {
  const entitiesById = new Map(entityMetadata.map((entity) => [entity.id, entity]));

  return intentMetadata.flatMap((intent) => {
    if (!getAndroidAppActionCapabilityName(intent)) {
      return [];
    }

    const entityParameters = intent.params.filter(
      (
        parameter,
      ): parameter is NormalizedIntentMetadata["params"][number] & {
        entityId: string;
        kind: "entity";
      } => parameter.kind === "entity" && parameter.entityId !== undefined,
    );

    if (entityParameters.length !== 1) {
      return [];
    }

    const entityParameter = entityParameters[0];

    if (!entityParameter) {
      return [];
    }

    const entity = entitiesById.get(entityParameter.entityId);

    if (!entity) {
      return [];
    }

    const baseParams = buildDefaultParamsExcept(intent, entityParameter.name);

    if (baseParams === null) {
      return [];
    }

    return entity.inventory.map((inventoryItem) => {
      const shortcutId = `${intent.id}_${entity.id}_${inventoryItem.identifier}`;
      const params = {
        ...baseParams,
        [entityParameter.name]: inventoryItem.value,
      };

      return {
        capabilityBindings: getAndroidCapabilityBindings(intent, params, entitiesById),
        id: shortcutId,
        longLabel: `${intent.title} ${inventoryItem.displayRepresentation.title}`.trim(),
        longLabelResourceName: `react_native_app_intents_${toAndroidResourceName(shortcutId)}_long_label`,
        shortLabel: inventoryItem.displayRepresentation.title,
        shortLabelResourceName: `react_native_app_intents_${toAndroidResourceName(shortcutId)}_short_label`,
        ...(intent.appShortcut.iconAndroidResourceName
          ? { iconResourceName: intent.appShortcut.iconAndroidResourceName }
          : {}),
        url: buildIntentUrl(scheme, intent.id, params),
      } satisfies AndroidShortcutArtifact;
    });
  });
}

function renderAndroidShortcutXml(shortcut: AndroidShortcutArtifact, packageName: string): string {
  const iconResourceName = shortcut.iconResourceName ?? "@mipmap/ic_launcher";

  return [
    "    <shortcut",
    `        android:shortcutId="${escapeXml(shortcut.id)}"`,
    '        android:enabled="true"',
    `        android:icon="${escapeXml(iconResourceName)}"`,
    `        android:shortcutShortLabel="@string/${shortcut.shortLabelResourceName}"`,
    `        android:shortcutLongLabel="@string/${shortcut.longLabelResourceName}">`,
    "        <intent",
    '            android:action="android.intent.action.VIEW"',
    `            android:targetPackage="${escapeXml(packageName)}"`,
    `            android:targetClass="${escapeXml(`${packageName}.MainActivity`)}"`,
    `            android:data="${escapeXml(shortcut.url)}" />`,
    ...(shortcut.capabilityBindings ?? []).flatMap((binding) => [
      `        <capability-binding android:key="${escapeXml(binding.capabilityName)}">`,
      ...binding.parameterBindings.map(
        (parameterBinding) =>
          `            <parameter-binding android:key="${escapeXml(parameterBinding.key)}" android:value="${escapeXml(parameterBinding.value)}" />`,
      ),
      "        </capability-binding>",
    ]),
    "    </shortcut>",
  ].join("\n");
}

function getNormalizedEntityMetadata(
  entityId: string,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): NormalizedEntityMetadata {
  const entity = entitiesById.get(entityId);

  if (!entity) {
    throw new Error(`Referenced entity "${entityId}" was not normalized.`);
  }

  return entity;
}

function getSwiftEntityTypeName(entityId: string): string {
  return `${toPascalCase(entityId)}AppEntity`;
}

function getSwiftEntityQueryTypeName(entityId: string): string {
  return `${toPascalCase(entityId)}EntityQuery`;
}

function getSwiftEntityCatalogTypeName(entityId: string): string {
  return `${toPascalCase(entityId)}EntityCatalog`;
}

function getSwiftEntityRecordTypeName(entityId: string): string {
  return `${toPascalCase(entityId)}EntityRecord`;
}

function getSwiftType(
  definition: AnyParameterDefinition,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): string {
  switch (definition.kind) {
    case "string":
      return "String";
    case "int":
      return "Int";
    case "number":
      return "Double";
    case "bool":
      return "Bool";
    case "date":
      return "Date";
    case "entity":
      return getSwiftEntityTypeName(
        getNormalizedEntityMetadata(definition.entity.id, entitiesById).id,
      );
    case "object":
      throw new Error(
        `iOS codegen does not yet support "${definition.kind}" App Intent parameters.`,
      );
  }
}

function getSwiftParameterDeclarationName(path: readonly string[]): string {
  return path.join("__");
}

function collectSwiftRenderableParameters(
  definitions: readonly [string, AnyParameterDefinition][],
  usedNames: Set<string>,
  pathPrefix: readonly string[] = [],
  parentOptional = false,
): SwiftRenderableParameter[] {
  return definitions.flatMap(([name, definition]) => {
    const path = [...pathPrefix, name];
    const optional = parentOptional || definition.optional === true;

    if (definition.kind === "object") {
      return collectSwiftRenderableParameters(
        Object.entries(definition.fields) as [string, AnyParameterDefinition][],
        usedNames,
        path,
        optional,
      );
    }

    const declarationName = getSwiftParameterDeclarationName(path);

    if (usedNames.has(declarationName)) {
      throw new Error(
        `iOS App Intent parameter flattening produced duplicate Swift parameter name "${declarationName}".`,
      );
    }

    usedNames.add(declarationName);

    return [
      {
        declarationName,
        definition,
        optional,
        path,
      },
    ];
  });
}

function getSwiftParameterType(
  parameter: SwiftRenderableParameter,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): string {
  const type = getSwiftType(parameter.definition, entitiesById);
  return parameter.optional ? `${type}?` : type;
}

function renderSwiftParameter(
  parameter: SwiftRenderableParameter,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): string {
  const name = parameter.path.at(-1) ?? parameter.declarationName;
  const definition = parameter.definition;
  const lines = [
    `  @Parameter(`,
    `    title: "${escapeSwiftString(resolveLocalizedText(definition.title, name) ?? name)}",`,
  ];
  const requestValueDialog = resolveLocalizedText(definition.requestValueDialog);

  if (requestValueDialog) {
    lines.push(`    requestValueDialog: IntentDialog("${escapeSwiftString(requestValueDialog)}")`);
  }

  lines.push("  )");
  lines.push(
    `  var ${parameter.declarationName}: ${getSwiftParameterType(parameter, entitiesById)}`,
  );

  return lines.join("\n");
}

function renderSwiftDisplayRepresentationLiteral(
  displayRepresentation: NormalizedEntityMetadata["inventory"][number]["displayRepresentation"],
): string {
  const argumentsList = [`title: "${escapeSwiftString(displayRepresentation.title)}"`];

  if (displayRepresentation.subtitle) {
    argumentsList.push(`subtitle: "${escapeSwiftString(displayRepresentation.subtitle)}"`);
  }

  if (displayRepresentation.imageSystemName) {
    argumentsList.push(
      `image: DisplayRepresentation.Image(systemName: "${escapeSwiftString(displayRepresentation.imageSystemName)}")`,
    );
  }

  return `DisplayRepresentation(${argumentsList.join(", ")})`;
}

function renderSwiftEntity(entity: NormalizedEntityMetadata): string {
  const entityTypeName = getSwiftEntityTypeName(entity.id);
  const entityQueryTypeName = getSwiftEntityQueryTypeName(entity.id);
  const entityCatalogTypeName = getSwiftEntityCatalogTypeName(entity.id);
  const entityRecordTypeName = getSwiftEntityRecordTypeName(entity.id);
  const records = entity.inventory.map((item) =>
    [
      `    ${entityRecordTypeName}(`,
      `      id: "${escapeSwiftString(item.identifier)}",`,
      `      displayRepresentation: ${renderSwiftDisplayRepresentationLiteral(item.displayRepresentation)},`,
      `      jsonValue: "${escapeSwiftString(item.jsonValue)}",`,
      `      searchText: "${escapeSwiftString(
        [item.identifier, item.displayRepresentation.title, item.displayRepresentation.subtitle]
          .filter(Boolean)
          .join(" "),
      )}"`,
      "    ),",
    ].join("\n"),
  );

  return [
    "@available(iOS 16.0, *)",
    `struct ${entityTypeName}: AppEntity {`,
    `  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "${escapeSwiftString(entity.title)}")`,
    `  static let defaultQuery = ${entityQueryTypeName}()`,
    "",
    "  let id: String",
    "",
    "  var displayRepresentation: DisplayRepresentation {",
    `    ${entityCatalogTypeName}.displayRepresentation(for: id)`,
    "  }",
    "}",
    "",
    "@available(iOS 16.0, *)",
    `private struct ${entityRecordTypeName} {`,
    "  let id: String",
    "  let displayRepresentation: DisplayRepresentation",
    "  let jsonValue: String",
    "  let searchText: String",
    "}",
    "",
    "@available(iOS 16.0, *)",
    `private enum ${entityCatalogTypeName} {`,
    `  static let records: [${entityRecordTypeName}] = [`,
    ...records,
    "  ]",
    `  static let recordsById: [String: ${entityRecordTypeName}] = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })`,
    `  static let allEntities: [${entityTypeName}] = records.map { ${entityTypeName}(id: $0.id) }`,
    "",
    "  static func displayRepresentation(for id: String) -> DisplayRepresentation {",
    '    recordsById[id]?.displayRepresentation ?? DisplayRepresentation(title: "Unknown")',
    "  }",
    "",
    "  static func jsonValue(for id: String) throws -> String {",
    "    guard let record = recordsById[id] else {",
    "      throw NSError(",
    '        domain: "ReactNativeAppIntents",',
    "        code: 2,",
    '        userInfo: [NSLocalizedDescriptionKey: "Could not resolve App Entity payload."]',
    "      )",
    "    }",
    "",
    "    return record.jsonValue",
    "  }",
    "",
    `  static func entities(for identifiers: [String]) -> [${entityTypeName}] {`,
    `    identifiers.compactMap { recordsById[$0].map { ${entityTypeName}(id: $0.id) } }`,
    "  }",
    "",
    `  static func search(matching query: String) -> [${entityTypeName}] {`,
    "    if query.isEmpty {",
    "      return allEntities",
    "    }",
    "",
    "    let normalizedQuery = query.lowercased()",
    "",
    "    return records",
    "      .filter { $0.searchText.lowercased().contains(normalizedQuery) }",
    `      .map { ${entityTypeName}(id: $0.id) }`,
    "  }",
    "}",
    "",
    "@available(iOS 16.0, *)",
    `struct ${entityQueryTypeName}: EntityQuery, EntityStringQuery {`,
    `  func entities(for identifiers: [String]) async throws -> [${entityTypeName}] {`,
    `    ${entityCatalogTypeName}.entities(for: identifiers)`,
    "  }",
    "",
    `  func suggestedEntities() async throws -> [${entityTypeName}] {`,
    `    ${entityCatalogTypeName}.allEntities`,
    "  }",
    "",
    `  func entities(matching string: String) async throws -> [${entityTypeName}] {`,
    `    ${entityCatalogTypeName}.search(matching: string)`,
    "  }",
    "}",
    "",
  ].join("\n");
}

function renderSwiftJSONValueExpression(
  valueExpression: string,
  definition: SwiftLeafParameterDefinition,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
): string {
  switch (definition.kind) {
    case "entity": {
      const entity = getNormalizedEntityMetadata(definition.entity.id, entitiesById);
      return `try reactNativeAppIntentsJSONObject(fromJSONString: try ${getSwiftEntityCatalogTypeName(entity.id)}.jsonValue(for: ${valueExpression}.id))`;
    }
    default:
      return `try reactNativeAppIntentsJSONObject(${valueExpression})`;
  }
}

function getSwiftParameterPathKey(path: readonly string[]): string {
  return path.join(".");
}

function renderSwiftPayloadAssignmentLines(
  containerName: string,
  key: string,
  definition: AnyParameterDefinition,
  flattenedParametersByPath: ReadonlyMap<string, SwiftRenderableParameter>,
  entitiesById: ReadonlyMap<string, NormalizedEntityMetadata>,
  indent = "    ",
  pathPrefix: readonly string[] = [],
  parentOptional = false,
): string[] {
  const path = [...pathPrefix, key];
  const optional = parentOptional || definition.optional === true;

  if (definition.kind === "object") {
    const objectVariableName = `${getSwiftParameterDeclarationName(path)}Payload`;
    const lines = [`${indent}var ${objectVariableName}: [String: Any] = [:]`];

    for (const [fieldName, fieldDefinition] of Object.entries(definition.fields) as [
      string,
      AnyParameterDefinition,
    ][]) {
      lines.push(
        ...renderSwiftPayloadAssignmentLines(
          objectVariableName,
          fieldName,
          fieldDefinition,
          flattenedParametersByPath,
          entitiesById,
          indent,
          path,
          optional,
        ),
      );
    }

    if (optional) {
      lines.push(
        `${indent}if !${objectVariableName}.isEmpty {`,
        `${indent}  ${containerName}["${escapeSwiftString(key)}"] = ${objectVariableName}`,
        `${indent}}`,
      );
    } else {
      lines.push(`${indent}${containerName}["${escapeSwiftString(key)}"] = ${objectVariableName}`);
    }

    return lines;
  }

  const parameter = flattenedParametersByPath.get(getSwiftParameterPathKey(path));

  if (!parameter) {
    throw new Error(`Missing flattened Swift parameter for "${path.join(".")}".`);
  }

  const valueExpression = parameter.optional
    ? `${parameter.declarationName}Value`
    : parameter.declarationName;
  const assignmentExpression = `${containerName}["${escapeSwiftString(key)}"] = ${renderSwiftJSONValueExpression(
    valueExpression,
    parameter.definition,
    entitiesById,
  )}`;

  if (!parameter.optional) {
    return [`${indent}${assignmentExpression}`];
  }

  return [
    `${indent}if let ${parameter.declarationName}Value = ${parameter.declarationName} {`,
    `${indent}  ${assignmentExpression}`,
    `${indent}}`,
  ];
}

function renderSwiftParameterSummary(
  intent: NormalizedIntentMetadata,
  parameters: readonly SwiftRenderableParameter[],
): string[] {
  if (parameters.length === 0) {
    return [];
  }

  const placeholders = parameters.map((parameter) => `\\(\\.$${parameter.declarationName})`);
  const summaryText = escapeSwiftString(intent.title);

  return [
    "  static var parameterSummary: some ParameterSummary {",
    `    Summary("${summaryText}${placeholders.length > 0 ? ` ${placeholders.join(" ")}` : ""}")`,
    "  }",
    "",
  ];
}

function renderSwift(
  intentMetadata: readonly NormalizedIntentMetadata[],
  entityMetadata: readonly NormalizedEntityMetadata[],
  scheme: string,
  providerName: string,
  appGroupIdentifier?: string,
): string {
  const entitiesById = new Map(entityMetadata.map((entity) => [entity.id, entity]));
  const declarations: string[] = [
    "import AppIntents",
    "import Foundation",
    "",
    'private let reactNativeAppIntentsAppGroupInfoKey = "ReactNativeAppIntentsAppGroupIdentifier"',
    `private let reactNativeAppIntentsAppGroupIdentifier: String? = ${
      appGroupIdentifier ? `"${escapeSwiftString(appGroupIdentifier)}"` : "nil"
    }`,
    `private let reactNativeAppIntentsPendingURLsKey = "${IOS_PENDING_URLS_DEFAULTS_KEY}"`,
    "private func reactNativeAppIntentsUserDefaults() -> UserDefaults {",
    "  if let suiteName = reactNativeAppIntentsAppGroupIdentifier,",
    "     let sharedDefaults = UserDefaults(suiteName: suiteName) {",
    "    return sharedDefaults",
    "  }",
    "",
    "  if let suiteName = Bundle.main.object(forInfoDictionaryKey: reactNativeAppIntentsAppGroupInfoKey) as? String,",
    "     let sharedDefaults = UserDefaults(suiteName: suiteName) {",
    "    return sharedDefaults",
    "  }",
    "",
    "  return UserDefaults.standard",
    "}",
    "private func enqueueReactNativeAppIntentURL(_ url: URL) {",
    "  let defaults = reactNativeAppIntentsUserDefaults()",
    "  var pendingUrls = defaults.stringArray(forKey: reactNativeAppIntentsPendingURLsKey) ?? []",
    "  pendingUrls.append(url.absoluteString)",
    "  defaults.set(pendingUrls, forKey: reactNativeAppIntentsPendingURLsKey)",
    "  defaults.synchronize()",
    "}",
    "",
    "private func reactNativeAppIntentsJSONObject<T: Encodable>(_ value: T) throws -> Any {",
    "  let encoder = JSONEncoder()",
    "  encoder.dateEncodingStrategy = .iso8601",
    "  let data = try encoder.encode(value)",
    "  return try JSONSerialization.jsonObject(with: data)",
    "}",
    "",
    "private func reactNativeAppIntentsJSONObject(fromJSONString json: String) throws -> Any {",
    "  let data = Data(json.utf8)",
    "  return try JSONSerialization.jsonObject(with: data)",
    "}",
    "",
    "private func reactNativeAppIntentsJSONString(_ payload: [String: Any]) throws -> String {",
    "  let data = try JSONSerialization.data(withJSONObject: payload)",
    "  return String(decoding: data, as: UTF8.self)",
    "}",
    "",
  ];

  for (const entity of entityMetadata) {
    declarations.push(renderSwiftEntity(entity));
  }

  for (const intent of intentMetadata) {
    const typeName = `${toPascalCase(intent.id)}Intent`;
    const renderableParameters = collectSwiftRenderableParameters(
      Object.entries(intent.intent.params) as [string, AnyParameterDefinition][],
      new Set<string>(),
    );
    const parameters = renderableParameters.map((parameter) =>
      renderSwiftParameter(parameter, entitiesById),
    );
    const flattenedParametersByPath = new Map(
      renderableParameters.map((parameter) => [
        getSwiftParameterPathKey(parameter.path),
        parameter,
      ]),
    );
    const payloadBuilderLines =
      Object.keys(intent.intent.params).length === 0
        ? ['    let payloadString = "{}"']
        : [
            "    var payload: [String: Any] = [:]",
            ...(Object.entries(intent.intent.params) as [string, AnyParameterDefinition][]).flatMap(
              ([name, definition]) =>
                renderSwiftPayloadAssignmentLines(
                  "payload",
                  name,
                  definition,
                  flattenedParametersByPath,
                  entitiesById,
                ),
            ),
            "    let payloadString = try reactNativeAppIntentsJSONString(payload)",
          ];
    const dialog = intent.ios?.appIntent?.response?.dialog;

    declarations.push(
      "@available(iOS 16.0, *)",
      `struct ${typeName}: AppIntent {`,
      `  static let title: LocalizedStringResource = "${escapeSwiftString(intent.title)}"`,
      intent.description
        ? `  static let description = IntentDescription("${escapeSwiftString(intent.description)}")`
        : '  static let description = IntentDescription("")',
      `  static let openAppWhenRun = ${intent.behavior.opensAppToForeground ? "true" : "false"}`,
      "",
      ...renderSwiftParameterSummary(intent, renderableParameters),
      ...(parameters.length === 0 ? [] : parameters.flatMap((parameter) => [parameter, ""])),
      `  func perform() async throws -> some ${dialog ? "IntentResult & ProvidesDialog" : "IntentResult"} {`,
      ...payloadBuilderLines,
      "    var components = URLComponents()",
      `    components.scheme = "${escapeSwiftString(scheme)}"`,
      '    components.host = "app-intents"',
      `    components.path = "/${escapeSwiftString(intent.id)}"`,
      '    components.queryItems = [URLQueryItem(name: "payload", value: payloadString)]',
      "",
      "    guard let url = components.url else {",
      "      throw NSError(",
      '        domain: "ReactNativeAppIntents",',
      "        code: 1,",
      '        userInfo: [NSLocalizedDescriptionKey: "Could not create app-intents URL."]',
      "      )",
      "    }",
      "",
      "    enqueueReactNativeAppIntentURL(url)",
      dialog
        ? `    return .result(dialog: IntentDialog("${escapeSwiftString(dialog)}"))`
        : "    return .result()",
      "  }",
      "}",
      "",
    );
  }

  const shortcuts = intentMetadata
    .filter((intent) => intent.surfaces.appShortcut)
    .map((intent) => {
      const typeName = `${toPascalCase(intent.id)}Intent`;
      const parametersByName = new Map(
        intent.params.map((parameter) => [parameter.name, parameter]),
      );
      const phrases = [
        ...new Set(intent.phrases.map((phrase) => phrase.swiftAppShortcutPhrase)),
      ].map((phrase) => `          "${toSwiftAppShortcutPhrase(phrase, parametersByName)}",`);
      const shortcutIconSystemName = intent.appShortcut.iconSystemName ?? "square.grid.2x2";

      return [
        "      AppShortcut(",
        `        intent: ${typeName}(),`,
        "        phrases: [",
        ...phrases,
        "        ],",
        `        shortTitle: "${escapeSwiftString(intent.title)}",`,
        `        systemImageName: "${escapeSwiftString(shortcutIconSystemName)}"`,
        "      ),",
      ].join("\n");
    });

  declarations.push(
    "@available(iOS 16.0, *)",
    `struct ${providerName}: AppShortcutsProvider {`,
    "  static var appShortcuts: [AppShortcut] {",
    "    return [",
    ...shortcuts,
    "    ]",
    "  }",
    "}",
    "",
  );

  return declarations.join("\n");
}

function renderAndroidShortcuts(
  intentMetadata: readonly NormalizedIntentMetadata[],
  entityMetadata: readonly NormalizedEntityMetadata[],
  scheme: string,
  packageName: string,
): string {
  const entitiesById = new Map(entityMetadata.map((entity) => [entity.id, entity]));
  const shortcuts = getAndroidShortcutArtifacts(intentMetadata, entitiesById, scheme);
  const capabilityInventoryShortcuts = getAndroidCapabilityInventoryShortcuts(
    intentMetadata,
    entityMetadata,
    scheme,
  );
  const capabilities = getAndroidCapabilityArtifacts(intentMetadata).map((capability) =>
    [
      `    <capability android:name="${escapeXml(capability.name)}">`,
      "        <shortcut-fulfillment>",
      ...capability.parameterNames.map(
        (parameterName) => `            <parameter android:name="${escapeXml(parameterName)}" />`,
      ),
      "        </shortcut-fulfillment>",
      "    </capability>",
    ].join("\n"),
  );
  const allShortcuts = [...shortcuts, ...capabilityInventoryShortcuts].map((shortcut) =>
    renderAndroidShortcutXml(shortcut, packageName),
  );

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">',
    ...capabilities,
    ...allShortcuts,
    "</shortcuts>",
    "",
  ].join("\n");
}

function renderAndroidShortcutStrings(
  intentMetadata: readonly NormalizedIntentMetadata[],
  entityMetadata: readonly NormalizedEntityMetadata[],
  scheme: string,
): string {
  const entitiesById = new Map(entityMetadata.map((entity) => [entity.id, entity]));
  const strings = [
    ...getAndroidShortcutArtifacts(intentMetadata, entitiesById, scheme),
    ...getAndroidCapabilityInventoryShortcuts(intentMetadata, entityMetadata, scheme),
  ].flatMap((shortcut) => [
    `    <string name="${shortcut.shortLabelResourceName}">${escapeXml(shortcut.shortLabel)}</string>`,
    `    <string name="${shortcut.longLabelResourceName}">${escapeXml(shortcut.longLabel)}</string>`,
  ]);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    ...strings,
    "</resources>",
    "",
  ].join("\n");
}

function getAndroidDiagnostics(
  intentMetadata: readonly NormalizedIntentMetadata[],
  config: AppIntentsConfig,
): string[] {
  const appActionIntents = intentMetadata.flatMap((intent) => {
    const appAction = intent.android?.appAction;

    if (!appAction) {
      return [];
    }

    return [
      `${intent.id}: ${appAction.capabilityName} (${appAction.fulfillment}, ${appAction.inventoryStrategy} inventory)`,
    ];
  });
  const iosAppIntentIds = intentMetadata.flatMap((intent) =>
    intent.ios?.appIntent ? [intent.id] : [],
  );
  const diagnostics: string[] = [];

  if (appActionIntents.length > 0) {
    diagnostics.push(`Android App Actions configured: ${appActionIntents.join("; ")}`);

    if (!config.android?.manifest || !config.android?.shortcutsOutput) {
      diagnostics.push(
        "Android App Actions still need android.manifest and android.shortcutsOutput configured for Android artifact generation.",
      );
    } else {
      diagnostics.push(
        "Verified App Links, Play Console setup, and any Assistant review steps remain manual Android setup tasks.",
      );
    }
  }

  if (iosAppIntentIds.length > 0) {
    diagnostics.push(`iOS App Intents configured: ${iosAppIntentIds.join("; ")}`);

    if (!config.ios?.output) {
      diagnostics.push(
        "iOS App Intents still need ios.output configured for Swift artifact generation.",
      );
    } else {
      diagnostics.push(
        "Generated Siri/App Intent dialogs are static only in the current iOS slice; dynamic native dialog flows remain manual work.",
      );
    }
  }

  return diagnostics;
}

function resolveAndroidShortcutStringsOutput(
  config: NonNullable<AppIntentsConfig["android"]> & { shortcutsOutput: string },
): string {
  if (config.shortcutsStringsOutput) {
    return config.shortcutsStringsOutput;
  }

  const shortcutsOutputFileName = basename(config.shortcutsOutput, ".xml");
  const resDirectory = dirname(dirname(config.shortcutsOutput));

  return join(resDirectory, "values", `${shortcutsOutputFileName}_strings.xml`);
}

function formatTypeScriptPropertyKey(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function escapeJSDoc(value: string): string {
  return value.replaceAll("*/", "*\\/");
}

function renderJSDoc(lines: readonly string[], indent = ""): string[] {
  const normalizedLines = lines
    .flatMap((line) => line.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return [
    `${indent}/**`,
    ...normalizedLines.map((line) => `${indent} * ${escapeJSDoc(line)}`),
    `${indent} */`,
  ];
}

function renderTypes(
  intentSources: readonly LoadedIntentSource[],
  typesOutputPath: string,
): string {
  const imports: string[] = [
    'import type { IntentEventUnion, ParamsOf } from "@avasapp/react-native-app-intents";',
  ];
  const tupleEntries: string[] = [];
  const mapEntries: string[] = [];

  intentSources.forEach((source, index) => {
    const symbolName = `Intent${index}`;
    const importPath = relative(dirname(typesOutputPath), source.absolutePath)
      .replaceAll("\\", "/")
      .replace(/\.ts$/, ".js");
    const normalizedImportPath = importPath.startsWith(".") ? importPath : `./${importPath}`;

    if (source.importKind === "default") {
      imports.push(`import ${symbolName} from "${normalizedImportPath}";`);
    } else {
      imports.push(
        `import { ${source.exportName} as ${symbolName} } from "${normalizedImportPath}";`,
      );
    }

    tupleEntries.push(`typeof ${symbolName}`);
    mapEntries.push(
      ...renderJSDoc(
        [
          resolveLocalizedText(source.intent.title, source.intent.id) ?? source.intent.id,
          resolveLocalizedText(source.intent.description) ?? "",
        ],
        "  ",
      ),
      `  ${formatTypeScriptPropertyKey(source.intent.id)}: ParamsOf<typeof ${symbolName}>;`,
    );
  });

  const generatedTupleDeclaration =
    tupleEntries.length <= 2
      ? `export declare const generatedAppIntents: readonly [${tupleEntries.join(", ")}];`
      : [
          "export declare const generatedAppIntents: readonly [",
          ...tupleEntries.map((entry) => `  ${entry},`),
          "];",
        ].join("\n");

  return [
    "// Generated by react-native-app-intents. Do not edit manually.",
    ...imports,
    "",
    ...renderJSDoc(["Generated intent definitions in codegen discovery order."]),
    generatedTupleDeclaration,
    "",
    ...renderJSDoc(["Maps each generated intent id to its typed params object."]),
    "export interface GeneratedAppIntentMap {",
    ...mapEntries,
    "}",
    "",
    ...renderJSDoc(["Union of generated intent ids."]),
    "export type GeneratedAppIntentId = keyof GeneratedAppIntentMap;",
    ...renderJSDoc(["Discriminated union of generated intent events."]),
    "export type GeneratedAppIntentEvent = IntentEventUnion<typeof generatedAppIntents>;",
    "",
  ].join("\n");
}

type AndroidActivityMatch = {
  index: number;
  openingTag: string;
  source: string;
  selfClosing: boolean;
};

function findMainActivity(manifest: string): AndroidActivityMatch | null {
  for (const match of manifest.matchAll(/<activity\b[^>]*(?:\/>|>)/g)) {
    const openingTag = match[0];
    const index = match.index;

    if (index === undefined || !openingTag.includes('android:name=".MainActivity"')) {
      continue;
    }

    const selfClosing = /\/>\s*$/.test(openingTag);

    if (selfClosing) {
      return { index, openingTag, source: openingTag, selfClosing };
    }

    const closeIndex = manifest.indexOf("</activity>", index + openingTag.length);

    if (closeIndex === -1) {
      return null;
    }

    return {
      index,
      openingTag,
      source: manifest.slice(index, closeIndex + "</activity>".length),
      selfClosing,
    };
  }

  return null;
}

function androidTagHasAttribute(tag: string, name: string, value: string): boolean {
  return new RegExp(`\\bandroid:${name}\\s*=\\s*"${escapeRegExp(value)}"`).test(tag);
}

function hasAppIntentsFilter(activitySource: string, scheme: string): boolean {
  const intentFilters = activitySource.match(/<intent-filter\b[\s\S]*?<\/intent-filter>/g) ?? [];

  return intentFilters.some((intentFilter) => {
    const dataTags = intentFilter.match(/<data\b[\s\S]*?(?:\/>|><\/data>)/g) ?? [];

    return dataTags.some(
      (dataTag) =>
        androidTagHasAttribute(dataTag, "scheme", scheme) &&
        androidTagHasAttribute(dataTag, "host", "app-intents"),
    );
  });
}

function renderAppIntentsFilter(scheme: string): string {
  return [
    "        <intent-filter>",
    '            <action android:name="android.intent.action.VIEW" />',
    '            <category android:name="android.intent.category.DEFAULT" />',
    '            <category android:name="android.intent.category.BROWSABLE" />',
    "            <data",
    `              android:scheme="${escapeXml(scheme)}"`,
    '              android:host="app-intents" />',
    "        </intent-filter>",
  ].join("\n");
}

function ensureAndroidManifest(manifest: string, config: AppIntentsConfig): string {
  if (!config.android?.manifest || !config.android.shortcutsOutput) {
    return manifest;
  }

  let updatedManifest = manifest;
  const shortcutsResourceName = basename(config.android.shortcutsOutput, ".xml");
  const mainActivity = findMainActivity(updatedManifest);

  if (!updatedManifest.includes('android:name="android.app.shortcuts"')) {
    updatedManifest = updatedManifest.replace(
      /<application([^>]*)>/,
      `<application$1>\n      <meta-data\n        android:name="android.app.shortcuts"\n        android:resource="@xml/${shortcutsResourceName}" />`,
    );
  }

  if (
    mainActivity &&
    !mainActivity.openingTag.includes('android:launchMode="singleTask"') &&
    !mainActivity.openingTag.includes('android:launchMode="singleTop"') &&
    !mainActivity.openingTag.includes("android:launchMode=")
  ) {
    const tagEnding = mainActivity.selfClosing ? "/>" : ">";
    const updatedOpeningTag = `${mainActivity.openingTag.slice(0, -tagEnding.length)}\n        android:launchMode="singleTask"${tagEnding}`;
    updatedManifest = updatedManifest.replace(mainActivity.openingTag, updatedOpeningTag);
  }

  const updatedMainActivity = findMainActivity(updatedManifest);

  if (updatedMainActivity && !hasAppIntentsFilter(updatedMainActivity.source, config.scheme)) {
    const appIntentsFilter = renderAppIntentsFilter(config.scheme);
    const replacement = updatedMainActivity.selfClosing
      ? `${updatedMainActivity.openingTag.replace(/\/>\s*$/, ">")}\n${appIntentsFilter}\n      </activity>`
      : updatedMainActivity.source.replace("</activity>", `${appIntentsFilter}\n      </activity>`);

    updatedManifest = `${updatedManifest.slice(0, updatedMainActivity.index)}${replacement}${updatedManifest.slice(
      updatedMainActivity.index + updatedMainActivity.source.length,
    )}`;
  }

  return updatedManifest;
}

async function readExistingFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function writeArtifact(
  artifact: GeneratedArtifact & { content: string },
  check: boolean,
): Promise<boolean> {
  const existing = await readExistingFile(artifact.path);

  if (check) {
    if (existing !== artifact.content) {
      throw new Error(`Generated artifact is out of date: ${artifact.path}`);
    }

    return false;
  }

  if (existing === artifact.content) {
    return false;
  }

  await mkdir(dirname(artifact.path), { recursive: true });
  await writeFile(artifact.path, artifact.content, "utf8");
  return true;
}

async function renderArtifacts(config: AppIntentsConfig, cwd: string): Promise<RenderedArtifacts> {
  const intentSources = await loadIntentSources(config.intents, cwd);
  const intents = intentSources.map((source) => source.intent);
  const normalizedIntents = normalizeIntentDefinitions(intents);
  const normalizedEntities = normalizeReferencedEntities(intents);
  const artifacts: Array<GeneratedArtifact & { content: string }> = [];
  const diagnostics = getAndroidDiagnostics(normalizedIntents, config);

  if (config.ios?.output) {
    artifacts.push({
      content: renderSwift(
        normalizedIntents,
        normalizedEntities,
        config.scheme,
        config.ios.appShortcutsProviderName ?? "GeneratedAppShortcuts",
        config.ios.appGroupIdentifier,
      ),
      path: resolve(cwd, config.ios.output),
      platform: "ios",
    });
  }

  if (config.android?.shortcutsOutput) {
    const androidConfig = { ...config.android, shortcutsOutput: config.android.shortcutsOutput };

    if (!config.android.packageName) {
      throw new Error("android.packageName is required when generating Android shortcuts.");
    }

    artifacts.push({
      content: renderAndroidShortcuts(
        normalizedIntents,
        normalizedEntities,
        config.scheme,
        config.android.packageName,
      ),
      path: resolve(cwd, androidConfig.shortcutsOutput),
      platform: "android",
    });
    artifacts.push({
      content: renderAndroidShortcutStrings(normalizedIntents, normalizedEntities, config.scheme),
      path: resolve(cwd, resolveAndroidShortcutStringsOutput(androidConfig)),
      platform: "android",
    });
  }

  if (config.types?.output) {
    artifacts.push({
      content: renderTypes(intentSources, resolve(cwd, config.types.output)),
      path: resolve(cwd, config.types.output),
      platform: "types",
    });
  }

  const androidManifest = config.android?.manifest
    ? ensureAndroidManifest(
        (await readExistingFile(resolve(cwd, config.android.manifest))) ?? "<manifest />",
        config,
      )
    : undefined;

  return {
    artifacts,
    diagnostics,
    ...(androidManifest ? { androidManifest } : {}),
  };
}

export async function generateAppIntents(
  config: AppIntentsConfig,
  options: GenerateAppIntentsOptions = {},
): Promise<GenerateAppIntentsResult> {
  const cwd = options.cwd ?? process.cwd();
  const rendered = await renderArtifacts(config, cwd);
  let changed = false;

  for (const artifact of rendered.artifacts) {
    changed = (await writeArtifact(artifact, options.check === true)) || changed;
  }

  if (config.android?.manifest && rendered.androidManifest !== undefined) {
    changed =
      (await writeArtifact(
        {
          content: rendered.androidManifest,
          path: resolve(cwd, config.android.manifest),
          platform: "android",
        },
        options.check === true,
      )) || changed;
  }

  return {
    artifacts: rendered.artifacts.map(({ content: _content, ...artifact }) => artifact),
    changed,
    ...(rendered.diagnostics.length > 0 ? { diagnostics: rendered.diagnostics } : {}),
    message:
      options.check === true
        ? "Generated artifacts are up to date."
        : rendered.artifacts.length === 0
          ? "No outputs configured."
          : `Wrote ${rendered.artifacts.length} generated artifact${rendered.artifacts.length === 1 ? "" : "s"}.`,
  };
}
