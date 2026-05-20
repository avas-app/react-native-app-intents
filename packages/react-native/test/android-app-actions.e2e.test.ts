import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import { defineIntent, p } from "../src/core/index.js";
import { buildIntentUrl } from "../src/index.js";

const execFile = promisify(execFileCallback);
const runAndroidE2E = process.env.RN_APP_INTENTS_ANDROID_E2E === "1";

const adbTest = runAndroidE2E ? test : test.skip;

adbTest("adb launches the example Android App Action deep link", async () => {
  const openOrder = defineIntent({
    id: "openOrder",
    title: "Open Order",
    params: {
      orderNumber: p.string({
        androidBiiParam: "order",
      }),
    },
    android: {
      appAction: {
        capability: "actions.intent.GET_ORDER",
      },
    },
  });
  const url = buildIntentUrl("example", openOrder, { orderNumber: "1234" });
  const packageName =
    process.env.RN_APP_INTENTS_ANDROID_PACKAGE ?? "com.avasapp.appintents.example";
  const adbArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
  const { stdout } = await execFile("adb", [
    ...adbArgs,
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    url,
    packageName,
  ]);

  assert.match(stdout, /(Status:\s*ok|Activity:)/);
});
