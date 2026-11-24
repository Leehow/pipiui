/** Author-facing extension API (spec D8). Do not re-export `@pipi/host-api`. */

export const EXTENSION_CAPABILITIES = [
  "settings.read",
  "settings.write",
  "bridge.emit",
  "invoke.agent",
  "stream.render",
  "terminal.read",
  "notifications",
  "data.read",
  "data.write",
] as const;

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];
export type ExtensionCategory = "foundation" | "workflow" | "coding" | "knowledge" | "automation" | "integration" | "developer";

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
  /**
   * Package-relative SVG for the tool rail. The rail masks the shape, so the artwork
   * must be a single-colour silhouette — the mask takes its geometry, never its colours.
   * Absent, the panel gets the generic extension icon and is indistinguishable from
   * every other extension panel in the rail.
   */
  icon?: string;
};

export type ExtensionUiToolRenderer = { tool: string; entry?: string };
/** Controlled chat-header action. `id` is a semantic contribution slug. */
export type ExtensionUiHeaderAction = { id: string; entry: string; order?: number };

/**
 * Manifest `app.ui.documentRenderers[]` item: a controlled renderer for the
 * document surface. Declaring (and enabling) the contribution is the whole
 * authorization — there is no `document.preview` capability.
 */
export type ExtensionUiDocumentRenderer = {
  id: string;
  /** App-half entry module exporting the renderer component. */
  entry: string;
  /** Host document kinds claimed by this renderer (opaque strings, e.g. "diagram"). */
  kinds?: string[];
  /** File extensions with a leading dot, normalized lowercase (e.g. ".svg"). */
  extensions?: string[];
  mimeTypes?: string[];
  /** Higher wins; ties break on id, then extension id. */
  priority?: number;
};
export type ExtensionUiSettingsSection = { id: string; title: string; entry?: string };
export type ExtensionUiSlashCommand = { name: string; description?: string };

/** The 17 color tokens every shell theme must define (see app.css `.pipiui-shell`). */
export const THEME_TOKEN_KEYS = [
  "--bg", "--surface", "--surface-raised", "--surface-hover", "--surface-input",
  "--border", "--border-strong", "--text", "--text-strong", "--muted", "--subtle",
  "--selection", "--accent", "--accent-soft", "--danger", "--warning", "--success",
] as const;
export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
/** Declarative theme contribution (`app.ui.themes`). The manifest validator only
 *  checks the array shape and passes entries through verbatim; per-theme content
 *  validation is fail-closed in the renderer theme registry. */
export type ThemeContribution = {
  id: string;
  name: string;
  description: string;
  scheme: "dark" | "light";
  tokens: Record<ThemeTokenKey, string>;
};
export type ExtensionWorkbenchLocation = "primarySidebar" | "center" | "auxiliarySidebar" | "statusBar" | "overlay";
export type ExtensionUiViewContainer = {
  id: string;
  location: ExtensionWorkbenchLocation;
  title: string;
  icon?: string;
  order?: number;
};
export type ExtensionUiView = {
  id: string;
  container: string;
  entry: string;
  activation?: "visible";
};
export type ExtensionUiStatusBar = {
  id: string;
  text?: string;
  tooltip?: string;
  alignment?: "left" | "right";
};

/** Pi provider `models[]` shape. Host-visible conversation models use this contract. */
export type ExtensionProviderModelContribution = {
  id: string;
  name: string;
  api?: string;
  input?: string[];
  reasoning?: boolean;
  capabilities?: Record<string, unknown>;
};

export type ExtensionProviderContribution = {
  id: string;
  name: string;
  api?: string;
  oauth?: boolean;
  models?: ExtensionProviderModelContribution[];
};

export type ExtensionAuthContribution = {
  provider: ExtensionProviderContribution;
};

/** Host-owned, secret-free login state. Never includes tokens or keys. */
export type ExtensionAuthStatus = {
  extensionId: string;
  providerId: string;
  loggedIn: boolean;
  usable: boolean;
  expiresAtMs?: number;
  error?: string;
};

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  category?: ExtensionCategory;
  capabilities: ExtensionCapability[];
  /** Declarative auth/provider contribution. The host owns login and credentials. */
  auth?: ExtensionAuthContribution;
  agent?: { extension?: string; skills?: string[] };
  app?: {
    settings?: {
      scope: "app" | "project";
      schema: ExtensionJsonSchema;
    };
    ui?: {
      panels?: ExtensionUiPanel[];
      toolRenderers?: ExtensionUiToolRenderer[];
      headerActions?: ExtensionUiHeaderAction[];
      composerActions?: ExtensionUiHeaderAction[];
      documentRenderers?: ExtensionUiDocumentRenderer[];
      settingsSections?: ExtensionUiSettingsSection[];
      slashCommands?: ExtensionUiSlashCommand[];
      viewContainers?: ExtensionUiViewContainer[];
      views?: ExtensionUiView[];
      themes?: ThemeContribution[];
      statusBar?: ExtensionUiStatusBar[];
    };
  };
  settingsVersion?: number;
  migrations?: unknown[];
};

/** Tool card props delivered to a controlled `toolRenderer` (spec D5/D8). */
/** Git state exposed to the Git header-action surface; no host API leaks through it. */
export type ExtensionGitStatus = {
  isRepo: boolean;
  currentBranch?: string;
  localBranches: string[];
  isDetached: boolean;
  shortSHA?: string;
  isDirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  upstream?: string;
  ahead: number;
  behind: number;
  githubURL?: string;
};

/** Restricted props injected into an `app.ui.headerActions` entry. */
/** Restricted composer contribution. No complete host API reaches the extension. */
export type ComposerActionProps = {
  api: ExtensionHostAPI;
  sessionId: string;
  model?: {provider: string; id: string; api?: string};
  disabled: boolean;
};

export type HeaderActionProps = {
  workspaceId?: string;
  git?: {
    status: () => Promise<ExtensionGitStatus>;
    checkout: (branch: string) => Promise<ExtensionGitStatus>;
  };
  openExternal?: (url: string) => void | Promise<void>;
};

export type ToolRenderProps = {
  content: string;
  details?: unknown;
  /** Typed image blocks delivered with the tool result (b64 + mime), if any. */
  images?: { data: string; mimeType: string }[];
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

/**
 * Document renderer contract version. Entries receive `DocumentRendererProps`
 * of this version; incompatible changes bump the constant and add a v2 shape.
 */
export const DOCUMENT_RENDERER_CONTRACT_VERSION = 1 as const;

/**
 * Host-prepared, path-free summary of the document being rendered.
 * The renderer never reads the disk; the host owns path validation and reads.
 */
export type DocumentRendererDescriptor = {
  /** Stable opaque document id (session-scoped); never a filesystem path. */
  documentId: string;
  name: string;
  /** File extension with a leading dot, lowercase (e.g. ".svg"). */
  extension: string;
  /** Host document classification; an opaque string to this contract. */
  documentKind: string;
  mimeType?: string;
  /** Byte size of the host-loaded document. */
  size: number;
  /** Monotonic content revision; the host bumps it on every reload. */
  revision: number;
};

/** Restricted, host-mediated actions. No paths, no host API, no IPC surface. */
export type DocumentRendererActions = {
  reload: () => Promise<void>;
  openExternally: () => Promise<void>;
  /** Ask the host shell to swap this document to the generic fallback view. */
  useGenericFallback: () => Promise<void>;
};

/** Props injected into a controlled `documentRenderers` entry (v1). */
export type DocumentRendererProps = {
  document: DocumentRendererDescriptor;
  /** Raw bytes as loaded by the host, when the kind is binary. */
  bytes?: Uint8Array;
  /** Host-derived text preview (e.g. converted markdown), when available. */
  text?: string;
  actions: DocumentRendererActions;
};

export type ExtensionSettingsAPI = {
  get?: () => Promise<Record<string, unknown>>;
  update?: (patch: Record<string, unknown>) => Promise<ExtInvokeResult<Record<string, unknown>>>;
};

/**
 * Narrow host surface injected into controlled components.
 * Undeclared capability services are omitted from the object (spec D8).
 */
export type ExtensionAuthAPI = {
  /** Secret-free status. Login/logout stay on the host, not this object. */
  status: () => Promise<ExtensionAuthStatus>;
};

export type ExtensionDataFile = { name: string; bytes: number; mtime: number };
export type ExtensionDataRead = { content: string; bytes: number; truncated: boolean };

/**
 * Read-only access to the project-relative paths this package declares in `app.data.read`.
 *
 * This is the one channel that does not go through a session: `subscribeExt` and `invoke`
 * both need a live agent, so a panel that only has those shows nothing until a
 * conversation happens to be running. A dashboard needs to be readable the moment the app
 * opens, so it reads its own data instead of waiting to be told.
 */
export type ExtensionDataAPI = {
  list: (dir: string) => Promise<ExtensionDataFile[]>;
  read: (path: string, options?: { tailBytes?: number; allowMissing?: boolean }) => Promise<ExtensionDataRead>;
  /**
   * Replace one declared writable file. Present only with the `data.write` capability.
   *
   * This is how a panel asks for something to happen without a live session: it leaves a
   * request where a process that already had the power to act will find it. The panel does
   * not gain that power -- it gains a way to be heard while nobody is having a conversation
   * with the agent.
   */
  write?: (path: string, content: string) => Promise<{ bytes: number }>;
};

export type ExtensionHostAPI = {
  subscribeExt: (listener: (event: ExtEvent) => void) => () => void;
  settings?: ExtensionSettingsAPI;
  invoke?: (method: string, params: unknown, opts?: { sessionId?: string }) => Promise<ExtInvokeResult>;
  notify?: (title: string, body: string) => void | Promise<void>;
  auth?: ExtensionAuthAPI;
  /** Present only with the `data.read` capability and a declared `app.data.read`. */
  data?: ExtensionDataAPI;
};

/** Structural backing host. Intentionally not `PipiHostAPI`. */
export type ExtensionHostBacking = {
  getExtensionSettings?(id: string): Promise<Record<string, unknown>>;
  updateExtensionSettings?(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ExtInvokeResult<Record<string, unknown>>>;
  subscribeExt?(id: string, listener: (event: ExtEvent) => void): (() => void) | void;
  invokeExtension?(id: string, method: string, params: unknown, opts?: { sessionId?: string; projectId?: string }): Promise<ExtInvokeResult>;
  notify?(title: string, body: string): void | Promise<void>;
  getExtensionAuthStatus?(id: string): Promise<ExtensionAuthStatus>;
  listExtensionData?(id: string, dir: string, projectId?: string): Promise<ExtensionDataFile[]>;
  readExtensionData?(
    id: string,
    path: string,
    options?: { tailBytes?: number; allowMissing?: boolean },
    projectId?: string,
  ): Promise<ExtensionDataRead>;
  writeExtensionData?(
    id: string,
    path: string,
    content: string,
    projectId?: string,
  ): Promise<{ bytes: number }>;
};

export type CreateExtensionHostAPIOptions = {
  extensionId: string;
  capabilities?: readonly string[];
  host: ExtensionHostBacking;
  /** Project scope for data and agent invocation; the host resolves its root. */
  projectId?: string;
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

  if (caps.has("data.read") || caps.has("data.write")) {
    const projectId = options.projectId;
    api.data = {
      list: dir => {
        if (!host.listExtensionData) return Promise.reject(new Error("capability 'data.read' is not available"));
        return host.listExtensionData(id, dir, projectId);
      },
      read: (path, readOptions) => {
        if (!host.readExtensionData) return Promise.reject(new Error("capability 'data.read' is not available"));
        return host.readExtensionData(id, path, readOptions, projectId);
      },
    };
    if (caps.has("data.write")) {
      api.data.write = (path, content) => {
        if (!host.writeExtensionData) return Promise.reject(new Error("capability 'data.write' is not available"));
        return host.writeExtensionData(id, path, content, projectId);
      };
    }
  }

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
    api.invoke = (method, params, opts) => {
      if (!host.invokeExtension) return Promise.resolve(denied("invoke.agent"));
      const invokeOptions: { sessionId?: string; projectId?: string } = {};
      if (opts?.sessionId !== undefined) invokeOptions.sessionId = opts.sessionId;
      if (options.projectId !== undefined) invokeOptions.projectId = options.projectId;
      return invokeOptions.sessionId === undefined && invokeOptions.projectId === undefined
        ? host.invokeExtension(id, method, params)
        : host.invokeExtension(id, method, params, invokeOptions);
    };
  }

  if (caps.has("notifications")) {
    api.notify = (title, body) => {
      if (host.notify) return host.notify(title, body);
      fallbackNotify(title, body);
    };
  }

  if (host.getExtensionAuthStatus) {
    api.auth = {
      status: () => host.getExtensionAuthStatus!(id),
    };
  }

  if (caps.has("data.read") || caps.has("data.write")) {
    api.data = {
      list: dir => host.listExtensionData
        ? host.listExtensionData(id, dir, options.projectId) : Promise.reject(new Error("data.read unavailable")),
      read: (path, readOptions) => host.readExtensionData
        ? host.readExtensionData(id, path, readOptions, options.projectId) : Promise.reject(new Error("data.read unavailable")),
      ...(caps.has("data.write") ? {write: (path: string, content: string) => host.writeExtensionData
        ? host.writeExtensionData(id, path, content, options.projectId) : Promise.reject(new Error("data.write unavailable"))} : {}),
    };
  }

  return api;
}
