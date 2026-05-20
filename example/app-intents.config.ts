import { defineAppIntentsConfig } from "@avasapp/react-native-app-intents/codegen";

export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "example",
  ios: {
    output: "../apps/example-bare/ios/AppIntentsBareExample/AppShortcuts.swift",
    appGroupIdentifier: "group.com.avasapp.appintents.example",
    appShortcutsProviderName: "ExampleAppShortcuts",
    bundleIdentifier: "com.avasapp.appintents.example",
    siriUsageDescription: "Used to let Siri run example app actions.",
  },
  android: {
    manifest: "../apps/example-bare/android/app/src/main/AndroidManifest.xml",
    shortcutsOutput: "../apps/example-bare/android/app/src/main/res/xml/app_shortcuts.xml",
    packageName: "com.avasapp.appintents.example",
  },
  types: { output: "src/generated/app-intents.d.ts" },
});
