import { defineAppIntentsConfig } from "@avasapp/react-native-app-intents/codegen";

export default defineAppIntentsConfig({
  intents: ["src/**/*.intents.ts"],
  scheme: "appintentsexpo",
  ios: {
    output: "AppIntents/ExpoAppIntents.swift",
    bundleIdentifier: "com.avasapp.appintents.expo",
    siriUsageDescription: "Used to let Siri run app actions.",
  },
  android: {
    manifest: "android/app/src/main/AndroidManifest.xml",
    shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    packageName: "com.avasapp.appintents.expo",
  },
  types: { output: "src/generated/app-intents.d.ts" },
});
