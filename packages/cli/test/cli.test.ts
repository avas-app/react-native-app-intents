import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { runCli } from "../src/index.js";

test("runCli loads config and writes generated outputs", async () => {
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const cwd = await mkdtemp(join(repoRoot, ".tmp-cli-"));
  const configPath = join(cwd, "app-intents.config.mjs");
  const messages: string[] = [];

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/orders.intents.ts"),
      [
        'import { defineIntent, p } from "@avasapp/react-native-app-intents";',
        "",
        "export const openOrder = defineIntent({",
        '  id: "openOrder",',
        '  title: "Open Order",',
        "  params: {",
        '    orderNumber: p.string({ default: "1234" }),',
        "  },",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      configPath,
      [
        "export default {",
        '  intents: ["src/**/*.intents.ts"],',
        '  scheme: "example",',
        '  types: { output: "./generated/app-intents.d.ts" },',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const exitCode = await runCli(["generate", "--config", "./app-intents.config.mjs"], {
      stdout: (message) => messages.push(message),
      stderr: (message) => messages.push(message),
      cwd: () => cwd,
    });

    await access(join(cwd, "generated/app-intents.d.ts"));

    const generatedTypes = await readFile(join(cwd, "generated/app-intents.d.ts"), "utf8");

    assert.equal(exitCode, 0);
    assert.equal(messages[0], "Wrote 1 generated artifact.");
    assert.match(generatedTypes, /GeneratedAppIntentMap/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
