import { withAppIntents } from "@avasapp/react-native-app-intents/expo-plugin";

export const exampleExpoConfig = withAppIntents(
  { name: "react-native-app-intents-example" },
  {
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
  },
);
