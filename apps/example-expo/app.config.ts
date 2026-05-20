export default {
  name: "App Intents Expo Example",
  slug: "app-intents-expo-example",
  scheme: "appintentsexpo",
  version: "1.0.0",
  orientation: "portrait",
  ios: {
    bundleIdentifier: "com.avasapp.appintents.expo",
  },
  android: {
    package: "com.avasapp.appintents.expo",
  },
  plugins: [
    ["expo-asset", { assets: ["./src/assets/burger.png"] }],
    "@avasapp/react-native-app-intents",
  ],
};
