import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defineAppIntentsConfig, generateAppIntents } from "../src/index.js";

test("generateAppIntents writes placeholder artifacts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "app-intents-codegen-"));
  const config = defineAppIntentsConfig({
    intents: ["src/**/*.intents.ts"],
    scheme: "example",
    ios: { output: "ios/AppIntents/GeneratedAppIntents.swift" },
    android: {
      shortcutsOutput: "android/app/src/main/res/xml/app_intents_shortcuts.xml",
    },
    types: { output: "src/generated/app-intents.d.ts" },
  });

  const result = await generateAppIntents(config, { cwd });
  const generatedTypes = await readFile(join(cwd, "src/generated/app-intents.d.ts"), "utf8");

  assert.equal(result.artifacts.length, 3);
  assert.match(generatedTypes, /scaffold placeholder/);
});
