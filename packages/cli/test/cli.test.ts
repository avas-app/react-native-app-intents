import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../src/index.js";

test("runCli loads config and writes placeholder outputs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "app-intents-cli-"));
  const configPath = join(cwd, "app-intents.config.mjs");
  const messages: string[] = [];

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

  assert.equal(exitCode, 0);
  assert.equal(messages[0], "Wrote 1 scaffold artifact.");
});
