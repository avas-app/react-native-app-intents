import assert from "node:assert/strict";
import test from "node:test";

import { withAppIntents } from "../src/index.js";

test("withAppIntents appends a plugin tuple", () => {
  const config = withAppIntents(
    { name: "example-app" },
    { intents: ["src/**/*.intents.ts"], scheme: "example" },
  );

  assert.deepEqual(config.plugins, [
    ["react-native-app-intents", { intents: ["src/**/*.intents.ts"], scheme: "example" }],
  ]);
});
