export interface IOSAppIntentsConfig {
  output: string;
  appShortcutsProviderName?: string;
  bundleIdentifier?: string;
  siriUsageDescription?: string;
}

export interface AndroidAppIntentsConfig {
  manifest?: string;
  shortcutsOutput: string;
  packageName?: string;
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
