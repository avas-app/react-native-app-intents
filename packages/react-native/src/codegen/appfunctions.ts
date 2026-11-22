import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  resolveLocalizedText,
  type AnyParameterDefinition,
  type NormalizedEntityMetadata,
  type NormalizedIntentMetadata,
} from "../core/index.js";

import type { AppIntentsConfig } from "./config.js";

const DEFAULT_SERVICE_NAME = "AppIntentsAppFunctionService";
const APP_METADATA_RESOURCE_NAME = "app_metadata";
const CATALOG_STORE_NAME = "ReactNativeAppIntents";
const CATALOG_KEY_PREFIX = "ReactNativeAppIntentsEntityCatalog.";

export interface AndroidAppFunctionsArtifact {
  content: string;
  path: string;
}

export interface AndroidAppFunctionsResult {
  artifacts: AndroidAppFunctionsArtifact[];
  diagnostics: string[];
}

interface KotlinSerializableField {
  definition: AnyParameterDefinition;
  name: string;
  optional: boolean;
}

interface KotlinSerializableClass {
  fields: readonly KotlinSerializableField[];
  kind: "entity" | "object";
  kdoc: string;
  name: string;
}

interface KotlinRegistry {
  classes: Map<string, KotlinSerializableClass>;
  entityClassNames: Map<string, string>;
  entitiesById: Map<string, NormalizedEntityMetadata>;
  objectClassNames: Map<AnyParameterDefinition, string>;
}

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function toUpperSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
}

function escapeKotlinString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}

function escapeKotlinDoc(value: string): string {
  return value.replaceAll("*/", "* /");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderKotlinDoc(body: readonly string[], indent = ""): string[] {
  return [
    `${indent}/**`,
    ...body.map((line) =>
      line.length === 0 ? `${indent} *` : `${indent} * ${escapeKotlinDoc(line)}`,
    ),
    `${indent} */`,
  ];
}

function isContainer(definition: AnyParameterDefinition): boolean {
  return definition.kind === "object" || definition.kind === "entity";
}

function hasDefault(definition: AnyParameterDefinition): boolean {
  return "default" in definition && definition.default !== undefined;
}

function createRegistry(entities: readonly NormalizedEntityMetadata[]): KotlinRegistry {
  return {
    classes: new Map(),
    entitiesById: new Map(entities.map((entity) => [entity.id, entity])),
    entityClassNames: new Map(),
    objectClassNames: new Map(),
  };
}

function getEntityClassName(entityId: string): string {
  return `${toPascalCase(entityId)}Entity`;
}

function registerKotlinEntityClass(registry: KotlinRegistry, entityId: string): string {
  const existing = registry.entityClassNames.get(entityId);

  if (existing) {
    return existing;
  }

  const name = getEntityClassName(entityId);
  const entity = registry.entitiesById.get(entityId);

  if (!entity) {
    throw new Error(`Referenced entity "${entityId}" was not normalized.`);
  }

  registry.entityClassNames.set(entityId, name);
  const fields = (
    Object.entries(entity.entity.schema.fields) as [string, AnyParameterDefinition][]
  ).map(([fieldName, field]) => ({
    definition: field,
    name: fieldName,
    optional: field.optional === true,
  }));

  registry.classes.set(name, { fields, kind: "entity", kdoc: entity.title, name });

  for (const [fieldName, field] of Object.entries(entity.entity.schema.fields) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (field.kind === "object") {
      registerKotlinObjectClass(registry, name, [fieldName], field);
    } else if (field.kind === "entity") {
      registerKotlinEntityClass(registry, field.entity.id);
    }
  }

  return name;
}

function registerKotlinObjectClass(
  registry: KotlinRegistry,
  intentId: string,
  path: readonly string[],
  definition: Extract<AnyParameterDefinition, { kind: "object" }>,
): string {
  const existing = registry.objectClassNames.get(definition);

  if (existing) {
    return existing;
  }

  const name = toPascalCase([intentId, ...path].join(" "));

  registry.objectClassNames.set(definition, name);
  const fields = (Object.entries(definition.fields) as [string, AnyParameterDefinition][]).map(
    ([fieldName, field]) => ({
      definition: field,
      name: fieldName,
      optional: field.optional === true,
    }),
  );

  registry.classes.set(name, {
    fields,
    kind: "object",
    kdoc: resolveLocalizedText(definition.title) ?? "",
    name,
  });

  for (const [fieldName, field] of Object.entries(definition.fields) as [
    string,
    AnyParameterDefinition,
  ][]) {
    if (field.kind === "object") {
      registerKotlinObjectClass(registry, intentId, [...path, fieldName], field);
    } else if (field.kind === "entity") {
      registerKotlinEntityClass(registry, field.entity.id);
    }
  }

  return name;
}

function registerKotlinClasses(
  intents: readonly NormalizedIntentMetadata[],
  entities: readonly NormalizedEntityMetadata[],
): KotlinRegistry {
  const registry = createRegistry(entities);

  for (const intent of intents) {
    if (!intent.android?.appFunction) {
      continue;
    }

    for (const [name, definition] of Object.entries(intent.intent.params) as [
      string,
      AnyParameterDefinition,
    ][]) {
      if (definition.kind === "object") {
        registerKotlinObjectClass(registry, intent.id, [name], definition);
      } else if (definition.kind === "entity") {
        registerKotlinEntityClass(registry, definition.entity.id);
      }
    }
  }

  for (const entity of entities) {
    if (entity.appFunctionQuery) {
      registerKotlinEntityClass(registry, entity.id);
    }
  }

  return registry;
}

function getKotlinFieldType(definition: AnyParameterDefinition, registry: KotlinRegistry): string {
  switch (definition.kind) {
    case "string":
    case "date":
      return "String";
    case "int":
      return "Int";
    case "number":
      return "Double";
    case "bool":
      return "Boolean";
    case "object": {
      const name = registry.objectClassNames.get(definition);

      if (!name) {
        throw new Error("Object parameter was not registered for AppFunction codegen.");
      }

      return name;
    }
    case "entity":
      return getEntityClassName(definition.entity.id);
  }
}

function renderKotlinSerializableClass(
  cls: KotlinSerializableClass,
  registry: KotlinRegistry,
): string {
  const lines: string[] = [];

  if (cls.kdoc) {
    lines.push(...renderKotlinDoc([cls.kdoc]));
  }

  lines.push("@AppFunctionSerializable(isDescribedByKDoc = true)");
  lines.push(`data class ${cls.name}(`);

  for (const field of cls.fields) {
    const title = resolveLocalizedText(field.definition.title);

    if (title) {
      lines.push(`  /** ${escapeKotlinDoc(title)} */`);
    }

    const type = `${getKotlinFieldType(field.definition, registry)}${field.optional ? "?" : ""}`;
    lines.push(`  val ${field.name}: ${type},`);
  }

  lines.push(")");
  return lines.join("\n");
}

function renderKotlinJsonHelper(cls: KotlinSerializableClass): string {
  const lines: string[] = [
    `private fun ${cls.name}.reactNativeAppIntentsJson(): JSONObject {`,
    "  val json = JSONObject()",
  ];

  for (const field of cls.fields) {
    const key = escapeKotlinString(field.name);
    const expression = isContainer(field.definition)
      ? `${field.name}.reactNativeAppIntentsJson()`
      : field.name;

    if (field.optional) {
      lines.push(`  if (${field.name} != null) {`);
      lines.push(`    json.put("${key}", ${expression})`);
      lines.push("  }");
    } else {
      lines.push(`  json.put("${key}", ${expression})`);
    }
  }

  lines.push("  return json");
  lines.push("}");
  return lines.join("\n");
}

function getKotlinParseExpression(
  field: KotlinSerializableField,
  registry: KotlinRegistry,
): string {
  const key = escapeKotlinString(field.name);

  switch (field.definition.kind) {
    case "string":
    case "date":
      return field.optional
        ? `if (json.has("${key}")) json.getString("${key}") else null`
        : `json.getString("${key}")`;
    case "int":
      return field.optional
        ? `if (json.has("${key}")) json.getInt("${key}") else null`
        : `json.getInt("${key}")`;
    case "number":
      return field.optional
        ? `if (json.has("${key}")) json.getDouble("${key}") else null`
        : `json.getDouble("${key}")`;
    case "bool":
      return field.optional
        ? `if (json.has("${key}")) json.getBoolean("${key}") else null`
        : `json.getBoolean("${key}")`;
    case "object": {
      const name = registry.objectClassNames.get(field.definition);

      if (!name) {
        throw new Error("Object parameter was not registered for AppFunction codegen.");
      }

      const parse = `reactNativeAppIntentsParse${name}(json.getJSONObject("${key}"))`;
      return field.optional ? `if (json.has("${key}")) ${parse} else null` : parse;
    }
    case "entity": {
      const name = getEntityClassName(field.definition.entity.id);
      const parse = `reactNativeAppIntentsParse${name}(json.getJSONObject("${key}"))`;
      return field.optional ? `if (json.has("${key}")) ${parse} else null` : parse;
    }
  }
}

function renderKotlinParseHelper(cls: KotlinSerializableClass, registry: KotlinRegistry): string {
  const lines: string[] = [
    `private fun reactNativeAppIntentsParse${cls.name}(json: JSONObject): ${cls.name} {`,
    `  return ${cls.name}(`,
  ];

  for (const field of cls.fields) {
    lines.push(`    ${field.name} = ${getKotlinParseExpression(field, registry)},`);
  }

  lines.push("  )");
  lines.push("}");
  return lines.join("\n");
}

function collectParseClassNames(
  queryEntities: readonly NormalizedEntityMetadata[],
  registry: KotlinRegistry,
): Set<string> {
  const names = new Set<string>();

  const visit = (name: string): void => {
    if (names.has(name)) {
      return;
    }

    const cls = registry.classes.get(name);

    if (!cls) {
      return;
    }

    names.add(name);

    for (const field of cls.fields) {
      if (field.definition.kind === "object") {
        const nested = registry.objectClassNames.get(field.definition);

        if (nested) {
          visit(nested);
        }
      } else if (field.definition.kind === "entity") {
        visit(getEntityClassName(field.definition.entity.id));
      }
    }
  };

  for (const entity of queryEntities) {
    const name = registry.entityClassNames.get(entity.id);

    if (name) {
      visit(name);
    }
  }

  return names;
}

function renderKotlinSeedEntries(entity: NormalizedEntityMetadata): string[] {
  const propertyName = `reactNativeAppIntentsSeed${toPascalCase(entity.id)}s`;

  if (entity.inventory.length === 0) {
    return [`private val ${propertyName}: List<ReactNativeAppIntentsCatalogEntry> = emptyList()`];
  }

  const entries = entity.inventory.map((item) =>
    [
      "  ReactNativeAppIntentsCatalogEntry(",
      `    id = "${escapeKotlinString(item.identifier)}",`,
      `    title = "${escapeKotlinString(item.displayRepresentation.title)}",`,
      "    synonyms = emptyList(),",
      `    value = JSONObject("${escapeKotlinString(item.jsonValue)}"),`,
      "  ),",
    ].join("\n"),
  );

  return [
    `private val ${propertyName}: List<ReactNativeAppIntentsCatalogEntry> = listOf(`,
    ...entries,
    ")",
  ];
}

function renderKotlinCatalogHelpers(queryEntities: readonly NormalizedEntityMetadata[]): string[] {
  const seedProperties = new Map(
    queryEntities.map((entity) => [
      entity.id,
      `reactNativeAppIntentsSeed${toPascalCase(entity.id)}s`,
    ]),
  );
  const whenCases = queryEntities.map(
    (entity) => `    "${escapeKotlinString(entity.id)}" -> ${seedProperties.get(entity.id)}`,
  );

  return [
    "private class ReactNativeAppIntentsCatalogEntry(",
    "  val id: String,",
    "  val title: String,",
    "  val synonyms: List<String>,",
    "  val value: JSONObject,",
    ")",
    "",
    "private fun reactNativeAppIntentsParseCatalog(json: String?): List<ReactNativeAppIntentsCatalogEntry>? {",
    "  if (json == null) {",
    "    return null",
    "  }",
    "",
    "  return try {",
    "    val array = JSONArray(json)",
    "    (0 until array.length()).map { index ->",
    "      val item = array.getJSONObject(index)",
    "      ReactNativeAppIntentsCatalogEntry(",
    '        id = item.getString("id"),',
    '        title = item.getString("title"),',
    '        synonyms = item.optJSONArray("synonyms")?.let { synonyms ->',
    "          (0 until synonyms.length()).map { synonyms.getString(it) }",
    "        } ?: emptyList(),",
    '        value = item.getJSONObject("value"),',
    "      )",
    "    }",
    "  } catch (error: Exception) {",
    "    null",
    "  }",
    "}",
    "",
    "private fun reactNativeAppIntentsCatalogEntries(",
    "  context: Context,",
    "  entityId: String,",
    "): List<ReactNativeAppIntentsCatalogEntry> {",
    "  val stored = reactNativeAppIntentsParseCatalog(",
    `    context.getSharedPreferences("${CATALOG_STORE_NAME}", Context.MODE_PRIVATE)`,
    `      .getString("${CATALOG_KEY_PREFIX}" + entityId, null),`,
    "  )",
    "",
    "  if (stored != null) {",
    "    return stored",
    "  }",
    "",
    "  return when (entityId) {",
    ...whenCases,
    "    else -> emptyList()",
    "  }",
    "}",
    "",
  ];
}

function getKotlinValueLiteral(
  definition: AnyParameterDefinition,
  value: unknown,
  registry: KotlinRegistry,
): string {
  switch (definition.kind) {
    case "string":
    case "date":
      return `"${escapeKotlinString(String(value))}"`;
    case "int":
      return String(value);
    case "number":
      return typeof value === "number" && Number.isInteger(value) ? `${value}.0` : String(value);
    case "bool":
      return value === true ? "true" : "false";
    case "object": {
      const name = registry.objectClassNames.get(definition);

      if (!name) {
        throw new Error("Object parameter was not registered for AppFunction codegen.");
      }

      const args = (Object.entries(definition.fields) as [string, AnyParameterDefinition][]).map(
        ([fieldName, field]) =>
          `${fieldName} = ${getKotlinValueLiteral(field, (value as Record<string, unknown>)?.[fieldName], registry)}`,
      );
      return `${name}(${args.join(", ")})`;
    }
    case "entity": {
      const name = getEntityClassName(definition.entity.id);
      const args = (
        Object.entries(definition.entity.schema.fields) as [string, AnyParameterDefinition][]
      ).map(
        ([fieldName, field]) =>
          `${fieldName} = ${getKotlinValueLiteral(field, (value as Record<string, unknown>)?.[fieldName], registry)}`,
      );
      return `${name}(${args.join(", ")})`;
    }
  }
}

function renderKotlinPayloadLines(
  intent: NormalizedIntentMetadata,
  registry: KotlinRegistry,
): string[] {
  const definitions = Object.entries(intent.intent.params) as [string, AnyParameterDefinition][];

  if (definitions.length === 0) {
    return ['val payloadJson = "{}"'];
  }

  const lines: string[] = ["val payload = JSONObject()"];

  for (const [name, definition] of definitions) {
    const optional = definition.optional === true && !hasDefault(definition);
    const key = escapeKotlinString(name);
    const valueExpression = hasDefault(definition)
      ? `${name} ?: ${getKotlinValueLiteral(definition, definition.default, registry)}`
      : name;
    const putValue = isContainer(definition)
      ? hasDefault(definition)
        ? `(${valueExpression}).reactNativeAppIntentsJson()`
        : `${valueExpression}.reactNativeAppIntentsJson()`
      : valueExpression;

    if (optional) {
      const optionalPut = isContainer(definition) ? "it.reactNativeAppIntentsJson()" : "it";
      lines.push(`${name}?.let { payload.put("${key}", ${optionalPut}) }`);
    } else {
      lines.push(`payload.put("${key}", ${putValue})`);
    }
  }

  lines.push("val payloadJson = payload.toString()");
  return lines;
}

function renderKotlinIntentFunction(
  intent: NormalizedIntentMetadata,
  registry: KotlinRegistry,
  scheme: string,
): string[] {
  const appFunction = intent.android?.appFunction;

  if (!appFunction) {
    throw new Error(`Intent "${intent.id}" is not opted into AppFunctions.`);
  }

  const body: string[] = [intent.title];

  if (intent.description) {
    body.push("", intent.description);
  }

  if (intent.params.length > 0) {
    body.push("");

    for (const parameter of intent.params) {
      const prompt = parameter.prompt ? `. ${parameter.prompt}` : "";
      body.push(`@param ${parameter.name} ${parameter.title}${prompt}`);
    }
  }

  body.push("@return A confirmation that the call was handed to the app.");

  const lines = renderKotlinDoc(body, "  ");
  lines.push(
    `  @AppFunctionDeclaration(isDescribedByKDoc = true, isEnabled = ${appFunction.enabledByDefault})`,
  );

  const signature = intent.params.map((parameter) => {
    const definition = intent.intent.params[parameter.name] as AnyParameterDefinition;
    const nullable = parameter.optional || hasDefault(definition);
    const type = `${getKotlinFieldType(definition, registry)}${nullable ? "?" : ""}`;
    return `${parameter.name}: ${type}`;
  });

  lines.push(`  suspend fun ${intent.id}(${signature.join(", ")}): AppIntentResult {`);
  lines.push(...renderKotlinPayloadLines(intent, registry).map((line) => `    ${line}`));
  lines.push("    val invocationId = ReactNativeAppIntentsAppFunctions.deliver(");
  lines.push("      applicationContext,");
  lines.push(`      "${escapeKotlinString(scheme)}",`);
  lines.push(`      "${escapeKotlinString(intent.id)}",`);
  lines.push("      payloadJson,");
  lines.push(`      ${intent.behavior.opensAppToForeground},`);
  lines.push("    )");
  lines.push('    return AppIntentResult(status = "delivered", invocationId = invocationId)');
  lines.push("  }");
  lines.push("");
  return lines;
}

function renderKotlinFindFunction(
  entity: NormalizedEntityMetadata,
  registry: KotlinRegistry,
): string[] {
  const className = registry.entityClassNames.get(entity.id) ?? getEntityClassName(entity.id);
  const lines = renderKotlinDoc(
    [
      `Finds ${entity.title} records.`,
      "",
      `@param query Optional text to filter ${entity.title}.`,
      `@return Matching ${entity.title} records.`,
    ],
    "  ",
  );

  lines.push("  @AppFunctionDeclaration(isDescribedByKDoc = true)");
  lines.push(`  suspend fun find${toPascalCase(entity.id)}s(query: String?): List<${className}> {`);
  lines.push("    val normalizedQuery = query?.trim()?.takeIf { it.isNotEmpty() }?.lowercase()");
  lines.push("    return reactNativeAppIntentsCatalogEntries(");
  lines.push("      applicationContext,");
  lines.push(`      "${escapeKotlinString(entity.id)}",`);
  lines.push("    )");
  lines.push("      .filter { entry ->");
  lines.push("        normalizedQuery == null ||");
  lines.push("          entry.title.lowercase().contains(normalizedQuery) ||");
  lines.push(
    "          entry.synonyms.any { synonym -> synonym.lowercase().contains(normalizedQuery) }",
  );
  lines.push("      }");
  lines.push("      .mapNotNull { entry ->");
  lines.push(`        reactNativeAppIntentsParse${className}(entry.value)`);
  lines.push("      }");
  lines.push("  }");
  lines.push("");
  return lines;
}

function renderKotlinService(
  intents: readonly NormalizedIntentMetadata[],
  queryEntities: readonly NormalizedEntityMetadata[],
  registry: KotlinRegistry,
  scheme: string,
  serviceName: string,
): string[] {
  const lines: string[] = [
    "@RequiresApi(36)",
    "@AppFunctionServiceEntryPoint(",
    `  serviceName = "${escapeKotlinString(serviceName)}",`,
    `  appFunctionXmlFileName = "${escapeKotlinString(toSnakeCase(serviceName))}",`,
    ")",
    `abstract class Base${serviceName} : AppFunctionService() {`,
  ];

  for (const intent of intents) {
    lines.push(...renderKotlinIntentFunction(intent, registry, scheme));
  }

  for (const entity of queryEntities) {
    lines.push(...renderKotlinFindFunction(entity, registry));
  }

  while (lines.at(-1) === "") {
    lines.pop();
  }

  lines.push("}");
  return lines;
}

function renderKotlinBridge(
  intents: readonly NormalizedIntentMetadata[],
  serviceName: string,
): string[] {
  const cases = intents.map(
    (intent) =>
      // KSP puts FUNCTION_ID_<NAME> constants in the generated service's companion (verified by a build).
      `      "${escapeKotlinString(intent.id)}" -> ${serviceName}.FUNCTION_ID_${toUpperSnakeCase(
        intent.id,
      )}`,
  );

  return [
    "private val reactNativeAppIntentsAppFunctionScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)",
    "",
    "object ReactNativeAppIntentsAppFunctionsBridge {",
    "  @JvmStatic",
    "  fun setEnabled(context: Context, intentId: String, enabled: Boolean) {",
    "    val functionId = when (intentId) {",
    ...cases,
    "      else -> return",
    "    }",
    "    val applicationContext = context.applicationContext",
    "    reactNativeAppIntentsAppFunctionScope.launch {",
    "      try {",
    "        AppFunctionManager.getInstance(applicationContext)?.setAppFunctionEnabled(",
    "          functionId,",
    "          if (enabled) {",
    "            AppFunctionManager.APP_FUNCTION_STATE_ENABLED",
    "          } else {",
    "            AppFunctionManager.APP_FUNCTION_STATE_DISABLED",
    "          },",
    "        )",
    "      } catch (error: Exception) {",
    '        Log.w("ReactNativeAppIntents", "Could not update the AppFunction state.", error)',
    "      }",
    "    }",
    "  }",
    "}",
  ];
}

function renderKotlinAppIntentResult(): string[] {
  return [
    "@AppFunctionSerializable(isDescribedByKDoc = true)",
    "data class AppIntentResult(",
    "  /** The delivery status of the AppFunction call. */",
    "  val status: String,",
    "  /** The id of the delivered invocation, shared with the App Actions delivery path. */",
    "  val invocationId: String,",
    ")",
  ];
}

function renderKotlinFileContent(
  intents: readonly NormalizedIntentMetadata[],
  queryEntities: readonly NormalizedEntityMetadata[],
  registry: KotlinRegistry,
  scheme: string,
  serviceName: string,
  packageName: string,
): string {
  const parseClassNames = collectParseClassNames(queryEntities, registry);
  const classes = [...registry.classes.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "entity" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
  const imports = [
    "import android.content.Context",
    "import android.util.Log",
    "import androidx.annotation.RequiresApi",
    "import androidx.appfunctions.AppFunctionDeclaration",
    "import androidx.appfunctions.AppFunctionManager",
    "import androidx.appfunctions.AppFunctionSerializable",
    "import androidx.appfunctions.AppFunctionService",
    "import androidx.appfunctions.AppFunctionServiceEntryPoint",
    "import com.reactnativeappintents.ReactNativeAppIntentsAppFunctions",
    "import kotlinx.coroutines.CoroutineScope",
    "import kotlinx.coroutines.Dispatchers",
    "import kotlinx.coroutines.SupervisorJob",
    "import kotlinx.coroutines.launch",
    ...(queryEntities.length > 0 ? ["import org.json.JSONArray"] : []),
    "import org.json.JSONObject",
  ];
  const lines: string[] = [
    `package ${packageName}.appfunctions`,
    "",
    ...imports,
    "",
    ...renderKotlinAppIntentResult(),
    "",
  ];

  for (const cls of classes) {
    lines.push(renderKotlinSerializableClass(cls, registry), "");
    lines.push(renderKotlinJsonHelper(cls), "");
  }

  for (const cls of classes) {
    if (parseClassNames.has(cls.name)) {
      lines.push(renderKotlinParseHelper(cls, registry), "");
    }
  }

  if (queryEntities.length > 0) {
    lines.push(...renderKotlinCatalogHelpers(queryEntities));

    for (const entity of queryEntities) {
      lines.push(...renderKotlinSeedEntries(entity), "");
    }
  }

  lines.push(...renderKotlinService(intents, queryEntities, registry, scheme, serviceName));
  lines.push("");
  lines.push(...renderKotlinBridge(intents, serviceName));
  lines.push("");

  return lines.join("\n");
}

export function getAndroidAppFunctionsServiceName(config: AppIntentsConfig): string {
  return config.android?.appFunctions?.serviceName ?? DEFAULT_SERVICE_NAME;
}

const BRIDGE_META_DATA_NAME = "com.reactnativeappintents.appfunctions.bridge";

function getQualifiedServiceName(config: AppIntentsConfig, serviceName: string): string {
  const packageName = config.android?.packageName;

  return packageName
    ? `${packageName}.appfunctions.${serviceName}`
    : `.appfunctions.${serviceName}`;
}

export function renderAndroidAppFunctionsServiceXml(config: AppIntentsConfig): string {
  const serviceName = getAndroidAppFunctionsServiceName(config);
  const xmlFileName = toSnakeCase(serviceName);

  return [
    "      <service",
    `        android:name="${escapeXml(getQualifiedServiceName(config, serviceName))}"`,
    '        android:permission="android.permission.BIND_APP_FUNCTION_SERVICE"',
    '        android:exported="true"',
    '        tools:targetApi="36">',
    '        <property android:name="android.app.appfunctions.schema" android:value="app_functions_schema.xsd" />',
    `        <property android:name="android.app.appfunctions.v2" android:value="${escapeXml(xmlFileName)}.xml" />`,
    "        <intent-filter>",
    '          <action android:name="android.app.appfunctions.AppFunctionService" />',
    "        </intent-filter>",
    "      </service>",
  ].join("\n");
}

export function renderAndroidAppFunctionsAppMetadata(config: AppIntentsConfig): string {
  const instructions = config.android?.appFunctions?.appMetadata?.instructions;

  if (!instructions) {
    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<AppFunctionAppMetadata xmlns:app="http://schemas.android.com/apk/res-auto" />',
      "",
    ].join("\n");
  }

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<AppFunctionAppMetadata xmlns:app="http://schemas.android.com/apk/res-auto"',
    `    app:instructions="${escapeXml(instructions)}"`,
    `    app:displayDescription="${escapeXml(instructions)}" />`,
    "",
  ].join("\n");
}

// Same-length mask, so indexes found in it apply to the original text.
function maskXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
}

export function ensureAndroidAppFunctionsManifest(
  manifest: string,
  config: AppIntentsConfig,
): string {
  if (!config.android?.appFunctions) {
    return manifest;
  }

  let updated = manifest;
  const masked = (): string => maskXmlComments(updated);

  if (!/<manifest\b[^>]*xmlns:tools=/.test(masked())) {
    const match = /<manifest\b([^>]*)>/.exec(masked());

    if (match) {
      const end = match.index + match[0].length - 1;
      updated = `${updated.slice(0, end)}\n    xmlns:tools="http://schemas.android.com/tools"${updated.slice(end)}`;
    }
  }

  const selfClosing = /<application\b([^>]*?)\s*\/>/.exec(masked());

  if (selfClosing) {
    const lineStart = updated.lastIndexOf("\n", selfClosing.index) + 1;
    const indent = /^[ \t]*/.exec(updated.slice(lineStart))?.[0] ?? "";
    const attributes = updated.slice(selfClosing.index, selfClosing.index + selfClosing[0].length);

    updated = `${updated.slice(0, selfClosing.index)}${attributes.replace(/\s*\/>$/, ">")}\n${indent}</application>${updated.slice(selfClosing.index + selfClosing[0].length)}`;
  }

  const open = /<application\b[^>]*>/.exec(masked());
  const close = masked().indexOf("</application>");

  if (!open || close < 0) {
    return updated;
  }

  const openLineStart = updated.lastIndexOf("\n", open.index) + 1;
  const appIndent = /^[ \t]*/.exec(updated.slice(openLineStart))?.[0] ?? "";
  const childIndent = `${appIndent}  `;
  const indentXml = (xml: string): string =>
    xml
      .split("\n")
      .map((line) => `${childIndent}${line.slice(6)}`)
      .join("\n");
  const insertions: string[] = [];

  if (!masked().includes("android.app.appfunctions.app_metadata")) {
    insertions.push(
      `${childIndent}<property android:name="android.app.appfunctions.app_metadata" android:resource="@xml/${APP_METADATA_RESOURCE_NAME}" />`,
    );
  }

  const packageName = config.android.packageName;

  if (packageName && !masked().includes(BRIDGE_META_DATA_NAME)) {
    insertions.push(
      `${childIndent}<meta-data android:name="${BRIDGE_META_DATA_NAME}" android:value="${escapeXml(packageName)}.appfunctions.ReactNativeAppIntentsAppFunctionsBridge" />`,
    );
  }

  if (insertions.length > 0) {
    const at = open.index + open[0].length;
    updated = `${updated.slice(0, at)}\n${insertions.join("\n")}${updated.slice(at)}`;
  }

  if (!masked().includes("android.app.appfunctions.AppFunctionService")) {
    const closeAt = masked().indexOf("</application>");
    const lineStart = updated.lastIndexOf("\n", closeAt) + 1;
    const service = indentXml(renderAndroidAppFunctionsServiceXml(config));

    updated = /^[ \t]*$/.test(updated.slice(lineStart, closeAt))
      ? `${updated.slice(0, lineStart)}${service}\n${updated.slice(lineStart)}`
      : `${updated.slice(0, closeAt)}\n${service}\n${appIndent}${updated.slice(closeAt)}`;
  } else if (packageName) {
    const relative = `android:name=".appfunctions.${escapeXml(getAndroidAppFunctionsServiceName(config))}"`;

    updated = updated.replace(
      relative,
      `android:name="${escapeXml(getQualifiedServiceName(config, getAndroidAppFunctionsServiceName(config)))}"`,
    );
  }

  return updated;
}

function resolveAppMetadataPath(config: AppIntentsConfig, cwd: string): string | null {
  const shortcutsOutput = config.android?.shortcutsOutput;

  if (!shortcutsOutput) {
    return null;
  }

  return join(
    dirname(dirname(resolve(cwd, shortcutsOutput))),
    "xml",
    `${APP_METADATA_RESOURCE_NAME}.xml`,
  );
}

async function getReactNativeVersionRange(cwd: string): Promise<string | undefined> {
  try {
    const contents = await readFile(resolve(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(contents) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return parsed.dependencies?.["react-native"] ?? parsed.devDependencies?.["react-native"];
  } catch {
    return undefined;
  }
}

function isBelowReactNative088(range: string): boolean {
  const match = range.match(/(\d+)\.(\d+)/);

  if (!match) {
    return false;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);

  return major === 0 && minor < 88;
}

export async function renderAndroidAppFunctions(
  intents: readonly NormalizedIntentMetadata[],
  entities: readonly NormalizedEntityMetadata[],
  config: AppIntentsConfig,
  cwd: string,
): Promise<AndroidAppFunctionsResult> {
  const appFunctions = config.android?.appFunctions;

  if (!appFunctions) {
    return { artifacts: [], diagnostics: [] };
  }

  if (!config.android?.packageName) {
    throw new Error("android.packageName is required when android.appFunctions is configured.");
  }

  if (!config.android.shortcutsOutput) {
    throw new Error(
      "android.shortcutsOutput is required when android.appFunctions is configured, so res/xml/app_metadata.xml can be written next to it.",
    );
  }

  const appFunctionIntents = intents.filter((intent) => intent.android?.appFunction);
  const queryEntities = entities.filter((entity) => entity.appFunctionQuery);
  const serviceName = getAndroidAppFunctionsServiceName(config);
  const registry = registerKotlinClasses(appFunctionIntents, entities);
  const artifacts: AndroidAppFunctionsArtifact[] = [
    {
      content: renderKotlinFileContent(
        appFunctionIntents,
        queryEntities,
        registry,
        config.scheme,
        serviceName,
        config.android.packageName,
      ),
      path: resolve(cwd, appFunctions.output),
    },
  ];
  const appMetadataPath = resolveAppMetadataPath(config, cwd);

  if (appMetadataPath) {
    artifacts.push({
      content: renderAndroidAppFunctionsAppMetadata(config),
      path: appMetadataPath,
    });
  }

  const diagnostics: string[] = [];
  const configuredIds = appFunctionIntents.map((intent) => intent.id);

  diagnostics.push(
    `Android AppFunctions configured: ${
      configuredIds.length > 0 ? configuredIds.join("; ") : "no intents opted in"
    }`,
  );
  diagnostics.push(
    'Android AppFunctions need the KSP Gradle plugin, implementation("androidx.appfunctions:appfunctions:1.0.0"), ksp("androidx.appfunctions:appfunctions-compiler:1.0.0") and compileSdk 37 in the app module.',
  );

  const reactNativeRange = await getReactNativeVersionRange(cwd);

  if (reactNativeRange && isBelowReactNative088(reactNativeRange)) {
    diagnostics.push(
      `Android AppFunctions require React Native 0.88 or newer (AGP 9.1+), but this app uses react-native ${reactNativeRange}.`,
    );
  }

  return { artifacts, diagnostics };
}
