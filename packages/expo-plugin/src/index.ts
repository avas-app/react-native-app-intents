import {
  defineAppIntentsConfig,
  type AppIntentsConfig,
  type AppIntentsConfigInput,
} from "@react-native-app-intents/codegen";

export type ExpoAppIntentsPluginOptions = AppIntentsConfigInput;

export interface ExpoConfig {
  plugins?: unknown[];
  [key: string]: unknown;
}

export type AppIntentsPluginEntry = readonly ["react-native-app-intents", AppIntentsConfig];

export function withAppIntents<TConfig extends ExpoConfig>(
  config: TConfig,
  options: ExpoAppIntentsPluginOptions,
): TConfig & { plugins: unknown[] } {
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];

  plugins.push(["react-native-app-intents", defineAppIntentsConfig(options)]);

  return { ...config, plugins };
}
