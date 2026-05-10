# react-native-app-intents

Initial M0 scaffold for a Bun workspaces monorepo that will house the core authoring API, codegen, CLI, React Native runtime, Expo plugin, and an example app package.

## Workspace layout

```text
packages/
  core/
  codegen/
  cli/
  react-native/
  expo-plugin/
example/
```

## Commands

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
```

The current code establishes the package boundaries and shared tooling so the implementation milestones in `plan.md` can land incrementally.
