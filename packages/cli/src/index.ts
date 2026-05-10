import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  defineAppIntentsConfig,
  generateAppIntents,
  type AppIntentsConfigInput,
} from "@react-native-app-intents/codegen";

export interface CliIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  cwd?: () => string;
}

function defaultStdout(message: string): void {
  console.log(message);
}

function defaultStderr(message: string): void {
  console.error(message);
}

function isConfigInput(value: unknown): value is AppIntentsConfigInput {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("scheme" in value) || typeof value.scheme !== "string") {
    return false;
  }

  if (!("intents" in value)) {
    return false;
  }

  return typeof value.intents === "string" || Array.isArray(value.intents);
}

function printUsage(io: CliIO): void {
  io.stdout("Usage: app-intents generate [--config path] [--check]");
}

async function loadConfig(cwd: string, configPath: string): Promise<AppIntentsConfigInput> {
  const moduleUrl = pathToFileURL(resolve(cwd, configPath)).href;
  const loaded = await import(moduleUrl);
  const candidate = "default" in loaded ? loaded.default : loaded;

  if (!isConfigInput(candidate)) {
    throw new Error(`Invalid app intents config at ${configPath}.`);
  }

  return candidate;
}

function resolveConfigPath(args: readonly string[]): string {
  const index = args.indexOf("--config");

  if (index === -1) {
    return "app-intents.config.ts";
  }

  const configPath = args[index + 1];

  if (!configPath) {
    throw new Error("--config requires a path.");
  }

  return configPath;
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  io: CliIO = {
    stdout: defaultStdout,
    stderr: defaultStderr,
    cwd: () => process.cwd(),
  },
): Promise<number> {
  const [command, ...args] = argv;

  if (!command || command === "--help" || command === "-h") {
    printUsage(io);
    return 0;
  }

  if (command !== "generate") {
    io.stderr(`Unknown command: ${command}`);
    printUsage(io);
    return 1;
  }

  try {
    const cwd = io.cwd ? io.cwd() : process.cwd();
    const configPath = resolveConfigPath(args);
    const config = defineAppIntentsConfig(await loadConfig(cwd, configPath));
    const result = await generateAppIntents(config, {
      cwd,
      check: args.includes("--check"),
    });

    io.stdout(result.message);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
