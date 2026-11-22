import type { DynamicShortcutIcon } from "./core/index.js";

export interface NativeShortcutCapabilityParameterBinding {
  key: string;
  value: string;
}

export interface NativeShortcutCapabilityBinding {
  capabilityName: string;
  parameterBindings: readonly NativeShortcutCapabilityParameterBinding[];
}

export interface NativeShortcutPayload {
  capabilityBindings?: readonly NativeShortcutCapabilityBinding[];
  id: string;
  icon?: DynamicShortcutIcon;
  title: string;
  subtitle?: string;
  url: string;
}

export interface AppIntentsNativeModule {
  clearDonations(): Promise<void>;
  donate(
    intentId: string,
    title: string,
    url: string,
    payload: string,
    capabilityBindings?: readonly NativeShortcutCapabilityBinding[],
  ): Promise<void>;
  acknowledgeIntent?(invocationId: string): Promise<void>;
  getInitialIntentURL?(): Promise<string | null>;
  getPendingIntentURLs?(): Promise<string[]>;
  getEntityCatalog?(entityId: string): Promise<string | null>;
  getSyncedEntityCatalog?(entityId: string): Promise<string | null>;
  reindexEntities?(entityId: string | null): Promise<void>;
  setAppFunctionEnabled?(intentId: string, enabled: boolean): Promise<void>;
  setEntityCatalog?(entityId: string, json: string): Promise<void>;
  setEntityTag?(reactTag: number, entityId: string | null, id: string | null): Promise<void>;
  setOnscreenEntity?(token: string, entityId: string | null, id: string | null): Promise<void>;
  updateDynamicShortcuts(shortcuts: readonly NativeShortcutPayload[]): Promise<void>;
}
