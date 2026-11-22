export interface IOSAppIntentsConfig {
  output?: string;
  appShortcutsProviderName?: string;
  appGroupIdentifier?: string;
  bundleIdentifier?: string;
  siriUsageDescription?: string;
}

export interface AndroidAppFunctionsAppMetadataConfig {
  /** Agent-facing instructions written to `res/xml/app_metadata.xml`. */
  instructions?: string;
}

export interface AndroidAppFunctionsConfig {
  /** Path of the generated Kotlin file holding the AppFunction service and bridge. */
  output: string;
  /** Generated `AppFunctionService` class name. Defaults to `AppIntentsAppFunctionService`. */
  serviceName?: string;
  /** App-level metadata written to `res/xml/app_metadata.xml` and referenced from the manifest. */
  appMetadata?: AndroidAppFunctionsAppMetadataConfig;
}

export interface AndroidAppIntentsConfig {
  manifest?: string;
  shortcutsOutput?: string;
  shortcutsStringsOutput?: string;
  packageName?: string;
  /** Opts the project into Android AppFunctions codegen. When omitted nothing AppFunctions-specific is generated. */
  appFunctions?: AndroidAppFunctionsConfig;
}

export interface TypesOutputConfig {
  output: string;
}

export interface AppIntentsConfigInput {
  intents: string | readonly string[];
  scheme: string;
  ios?: IOSAppIntentsConfig;
  android?: AndroidAppIntentsConfig;
  types?: TypesOutputConfig;
}

export interface AppIntentsConfig extends Omit<AppIntentsConfigInput, "intents"> {
  intents: readonly string[];
}

export function defineAppIntentsConfig(config: AppIntentsConfigInput): AppIntentsConfig {
  return {
    ...config,
    intents: Array.isArray(config.intents) ? [...config.intents] : [config.intents],
  };
}
