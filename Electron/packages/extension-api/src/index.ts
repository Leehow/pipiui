/** Author-facing extension API (spec D8). Do not re-export `@pipi/host-api`. */

export const EXTENSION_CAPABILITIES = [
  "settings.read",
  "settings.write",
  "bridge.emit",
  "invoke.agent",
  "stream.render",
  "terminal.read",
  "notifications",
] as const;

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];

export type ExtEvent = { type: string; payload?: unknown };

export type ExtInvokeErrorCode =
  | "not_found"
  | "disabled"
  | "no_session"
  | "capability_denied"
  | "agent_error"
  | "timeout";

export type ExtInvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ExtInvokeErrorCode; message: string } };

export type ExtensionJsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: readonly unknown[];
  format?: string;
  properties?: Record<string, ExtensionJsonSchema>;
  required?: readonly string[];
};

export type ExtensionUiPanel = {
  slot: "toolPanel";
  id: string;
  title: string;
  entry?: string;
};

export type ExtensionUiToolRenderer = { tool: string; entry?: string };
export type ExtensionUiSettingsSection = { id: string; title: string; entry?: string };
export type ExtensionUiSlashCommand = { name: string; description?: string };
export type ExtensionUiStatusBar = {
  id: string;
  text?: string;
  tooltip?: string;
  alignment?: "left" | "right";
};

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  capabilities: ExtensionCapability[];
  agent?: { extension?: string; skills?: string[] };
  app?: {
    settings?: {
      scope: "app" | "project";
      schema: ExtensionJsonSchema;
    };
    ui?: {
      panels?: ExtensionUiPanel[];
      toolRenderers?: ExtensionUiToolRenderer[];
      settingsSections?: ExtensionUiSettingsSection[];
      slashCommands?: ExtensionUiSlashCommand[];
      themes?: unknown[];
      statusBar?: ExtensionUiStatusBar[];
    };
  };
  settingsVersion?: number;
  migrations?: unknown[];
};

/** Tool card props delivered to a controlled `toolRenderer` (spec D5/D8). */
export type ToolRenderProps = {
  content: string;
  details?: unknown;
};

/** Injected into a controlled panel `entry`. */
export type PanelProps = {
  api: ExtensionHostAPI;
  id: string;
  title?: string;
};

/** Injected into a controlled settings section `entry`. */
export type SettingsSectionProps = {
  api: ExtensionHostAPI;
  id: string;
  title?: string;
};

export type ExtensionSettingsAPI = {
  get?: () => Promise<Record<string, unknown>>;
  update?: (patch: Record<string, unknown>) => Promise<ExtInvokeResult<Record<string, unknown>>>;
};

/**
 * Narrow host surface injected into controlled components.
 * Undeclared capability services are omitted from the object (spec D8).
 */
export type ExtensionHostAPI = {
  subscribeExt: (listener: (event: ExtEvent) => void) => () => void;
  settings?: ExtensionSettingsAPI;
  invoke?: (method: string, params: unknown) => Promise<ExtInvokeResult>;
  notify?: (title: string, body: string) => void | Promise<void>;
};

/** Structural backing host. Intentionally not `PipiHostAPI`. */
export type ExtensionHostBacking = {
  getExtensionSettings?(id: string): Promise<Record<string, unknown>>;
  updateExtensionSettings?(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ExtInvokeResult<Record<string, unknown>>>;
  subscribeExt?(id: string, listener: (event: ExtEvent) => void): (() => void) | void;
  invokeExtension?(id: string, method: string, params: unknown): Promise<ExtInvokeResult>;
  notify?(title: string, body: string): void | Promise<void>;
};

export type CreateExtensionHostAPIOptions = {
  extensionId: string;
  capabilities?: readonly string[];
  host: ExtensionHostBacking;
};

function denied(capability: string): ExtInvokeResult<never> {
  return {
    ok: false,
    error: {
      code: "capability_denied",
      message: `capability '${capability}' is not available`,
    },
  };
}

function fallbackNotify(title: string, body: string): void {
  const ctor = (globalThis as { Notification?: new (title: string, init?: { body?: string }) => unknown }).Notification;
  if (typeof ctor === "function") new ctor(title, { body });
}

/**
 * Build the injected host object, keeping only services granted by `capabilities`.
 * Empty capabilities → L0: `subscribeExt` only (no settings / invoke / notify).
 */
export function createExtensionHostAPI(options: CreateExtensionHostAPIOptions): ExtensionHostAPI {
  const id = options.extensionId;
  const host = options.host;
  const caps = new Set(options.capabilities ?? []);
  const api: ExtensionHostAPI = {
    subscribeExt: listener => {
      const unsubscribe = host.subscribeExt?.(id, listener);
      return () => {
        unsubscribe?.();
      };
    },
  };

  if (caps.has("settings.read") || caps.has("settings.write")) {
    const settings: ExtensionSettingsAPI = {};
    if (caps.has("settings.read")) {
      settings.get = () => {
        if (!host.getExtensionSettings) {
          return Promise.reject(new Error("capability 'settings.read' is not available"));
        }
        return host.getExtensionSettings(id);
      };
    }
    if (caps.has("settings.write")) {
      settings.update = patch => {
        if (!host.updateExtensionSettings) return Promise.resolve(denied("settings.write"));
        return host.updateExtensionSettings(id, patch);
      };
    }
    api.settings = settings;
  }

  if (caps.has("invoke.agent")) {
    api.invoke = (method, params) => {
      if (!host.invokeExtension) return Promise.resolve(denied("invoke.agent"));
      return host.invokeExtension(id, method, params);
    };
  }

  if (caps.has("notifications")) {
    api.notify = (title, body) => {
      if (host.notify) return host.notify(title, body);
      fallbackNotify(title, body);
    };
  }

  return api;
}
