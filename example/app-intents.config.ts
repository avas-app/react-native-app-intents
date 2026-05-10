import { defineAppIntentsConfig } from "@react-native-app-intents/codegen";

export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "example",
  ios: {
    output: "ios/AppIntents/GeneratedAppIntents.swift",
    appShortcutsProviderName: "ExampleShortcuts",
    bundleIdentifier: "com.example.appintents",
    siriUsageDescription: "Used to let Siri run example app actions.",
  },
  android: {
    manifest: "android/app/src/main/AndroidManifest.xml",
    shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    packageName: "com.example.appintents",
  },
  types: { output: "src/generated/app-intents.d.ts" },
});
