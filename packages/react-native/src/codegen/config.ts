export interface IOSAppIntentsConfig {
  output?: string;
  appShortcutsProviderName?: string;
  appGroupIdentifier?: string;
  bundleIdentifier?: string;
  siriUsageDescription?: string;
}

export interface AndroidAppIntentsConfig {
  manifest?: string;
  shortcutsOutput?: string;
  shortcutsStringsOutput?: string;
  packageName?: string;
}

export interface TypesOutputConfig {
  output: string;
}

export interface LocalizationConfig {
  /**
   * Locale the intent definitions are authored in.
   *
   * Generated native artifacts use this locale, and every other locale found in the definitions is
   * emitted as a translation table alongside them. Defaults to `"en"`.
   */
  defaultLocale?: string;
  /**
   * Directory that per-locale Apple `.lproj` string tables are written to.
   *
   * Defaults to the directory holding `ios.output`. Ignored when `ios.output` is not configured.
   */
  iosResourcesDirectory?: string;
}

export interface AppIntentsConfigInput {
  intents: string | readonly string[];
  scheme: string;
  ios?: IOSAppIntentsConfig;
  android?: AndroidAppIntentsConfig;
  localization?: LocalizationConfig;
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
