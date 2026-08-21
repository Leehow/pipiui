import type {
  ExtensionOrigin,
  ExtensionSettingsManifest,
  ExtensionSettingsMigration,
  ExtensionSettingsSchema,
} from "./extension-registry.js";
import { parseExtensionMigrations } from "./extension-migrations.js";

/** Spec D2. */
export const EXTENSION_MANIFEST_FILENAME = "pipiui-extension.json";
export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]*$/;

/** Spec D8 first-version capability enum (L0/L1). */
export const EXTENSION_CAPABILITIES = [
  "settings.read",
  "settings.write",
  "bridge.emit",
  "invoke.agent",
  "stream.render",
  "terminal.read",
  "notifications",
] as const;
/** Spec D11 L2 host privileges — recognized so they can be refused, never granted. */
export const EXTENSION_L2_CAPABILITIES = ["host.main", "host.decorator", "host.api", "native.driver"] as const;
export type ExtensionCapability =
  | (typeof EXTENSION_CAPABILITIES)[number]
  | (typeof EXTENSION_L2_CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>([...EXTENSION_CAPABILITIES, ...EXTENSION_L2_CAPABILITIES]);

/** Spec D2 / D7: first version only `toolPanel`. Unknown slots are errors, never silent skips. */
export const EXTENSION_PANEL_SLOTS = ["toolPanel"] as const;
export type ExtensionPanelSlot = (typeof EXTENSION_PANEL_SLOTS)[number];

export type ExtensionUiPanel = { slot: ExtensionPanelSlot; id: string; title: string; entry?: string };
export type ExtensionUiToolRenderer = { tool: string; entry?: string };
export type ExtensionUiSettingsSection = { id: string; title: string; entry?: string };
export type ExtensionUiSlashCommand = { name: string; description?: string };

export type ExtensionUiSummary = {
  panels?: ExtensionUiPanel[];
  toolRenderers?: ExtensionUiToolRenderer[];
  settingsSections?: ExtensionUiSettingsSection[];
  slashCommands?: ExtensionUiSlashCommand[];
};

export type ValidatedExtensionManifest = {
  id: string;
  name: string;
  version: string;
  capabilities: ExtensionCapability[];
  settings?: ExtensionSettingsManifest;
  ui?: ExtensionUiSummary;
  agentExtension?: string;
  agentSkills?: string[];
};

export type ManifestValidationOk = { ok: true; manifest: ValidatedExtensionManifest };
export type ManifestValidationErr = { ok: false; errors: string[]; fallbackId?: string };
export type ManifestValidation = ManifestValidationOk | ManifestValidationErr;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function settingsPrefix(id: string): string {
  return `ext.${id}.`;
}

function isNamespacedSettingsKey(id: string, key: string): boolean {
  const prefix = settingsPrefix(id);
  return key.startsWith(prefix) && key.length > prefix.length;
}

function collectSchema(value: unknown): ExtensionSettingsSchema | undefined {
  if (!isRecord(value)) return undefined;
  const schema: ExtensionSettingsSchema = {};
  if (typeof value.type === "string") schema.type = value.type;
  if (isRecord(value.properties)) schema.properties = value.properties;
  if (Array.isArray(value.required) && value.required.every((item) => typeof item === "string")) {
    schema.required = value.required;
  }
  if (typeof value.additionalProperties === "boolean") schema.additionalProperties = value.additionalProperties;
  return schema;
}

/**
 * Validate a parsed `pipiui-extension.json` (spec D2).
 * Failures are user-readable; callers put the package in `error` with these reasons.
 */
export function validateExtensionManifest(value: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  const rawId = value.id;
  const id = asNonEmptyString(rawId);
  if (rawId === undefined || rawId === null || (typeof rawId === "string" && !rawId.trim())) {
    errors.push("missing required field id");
  } else if (typeof rawId !== "string" || !EXTENSION_ID_RE.test(rawId)) {
    errors.push(`invalid extension id '${String(rawId)}': must match [a-z][a-z0-9-]*`);
  }

  const name = asNonEmptyString(value.name);
  if (!name) errors.push("missing required field name");

  const version = asNonEmptyString(value.version);
  if (!version) errors.push("missing required field version");

  let capabilities: ExtensionCapability[] = [];
  if (!Object.prototype.hasOwnProperty.call(value, "capabilities")) {
    errors.push("missing required field capabilities");
  } else if (!Array.isArray(value.capabilities)) {
    errors.push("capabilities must be an array of strings");
  } else {
    for (const item of value.capabilities) {
      if (typeof item !== "string") {
        errors.push("capabilities must be an array of strings");
        break;
      }
      if (!CAPABILITY_SET.has(item)) {
        errors.push(`unknown capability '${item}': not in the first-version enum`);
      }
    }
    if (!errors.some((error) => error.includes("capabilities") || error.startsWith("unknown capability"))) {
      capabilities = value.capabilities as ExtensionCapability[];
    }
  }

  let settings: ExtensionSettingsManifest | undefined;
  const app = value.app;
  if (app !== undefined && app !== null && !isRecord(app)) {
    errors.push("app must be an object");
  }
  const appRecord = isRecord(app) ? app : undefined;
  const appSettings = appRecord?.settings;
  if (appSettings !== undefined && appSettings !== null) {
    if (!isRecord(appSettings)) {
      errors.push("app.settings must be an object");
    } else {
      const scope = appSettings.scope;
      if (scope !== "app" && scope !== "project") {
        errors.push("app.settings.scope must be 'app' or 'project'");
      }
      const schema = collectSchema(appSettings.schema);
      if (!isRecord(appSettings.schema)) {
        errors.push("app.settings.schema is required when settings are declared");
      } else if (id && isRecord(schema?.properties)) {
        for (const key of Object.keys(schema!.properties!)) {
          if (!isNamespacedSettingsKey(id, key)) {
            errors.push(`settings key '${key}' must be namespaced ${settingsPrefix(id)}*`);
          }
        }
      }
      const topVersion = value.settingsVersion;
      const nestedVersion = appSettings.settingsVersion;
      const settingsVersion = typeof topVersion === "number" ? topVersion : nestedVersion;
      if (typeof settingsVersion !== "number" || !Number.isFinite(settingsVersion) || settingsVersion < 1) {
        errors.push("settingsVersion is required (number ≥ 1) when settings are declared");
      }
      const rawMigrations = value.migrations ?? appSettings.migrations;
      const parsedMigrations = parseExtensionMigrations(rawMigrations);
      let migrations: ExtensionSettingsMigration[] | undefined;
      if (!parsedMigrations.ok) {
        errors.push(parsedMigrations.error);
      } else if (parsedMigrations.migrations.length) {
        migrations = parsedMigrations.migrations;
      }
      if (scope === "app" || scope === "project") {
        settings = {
          scope,
          schema: schema ?? {},
          settingsVersion: typeof settingsVersion === "number" ? settingsVersion : undefined,
        };
        if (migrations) settings.migrations = migrations;
      }
    }
  }

  let ui: ExtensionUiSummary | undefined;
  const appUi = appRecord?.ui;
  if (appUi !== undefined && appUi !== null) {
    if (!isRecord(appUi)) {
      errors.push("app.ui must be an object");
    } else {
      const summary: ExtensionUiSummary = {};
      if (appUi.panels !== undefined) {
        if (!Array.isArray(appUi.panels)) {
          errors.push("app.ui.panels must be an array");
        } else {
          const panels: ExtensionUiPanel[] = [];
          for (const [index, panel] of appUi.panels.entries()) {
            if (!isRecord(panel)) {
              errors.push(`app.ui.panels[${index}] must be an object`);
              continue;
            }
            const slot = panel.slot;
            if (slot !== "toolPanel") {
              errors.push(
                `unknown panel slot '${String(slot ?? "")}': first version only allows toolPanel`,
              );
              continue;
            }
            const panelId = asNonEmptyString(panel.id);
            const title = asNonEmptyString(panel.title);
            if (!panelId) errors.push(`app.ui.panels[${index}] missing id`);
            if (!title) errors.push(`app.ui.panels[${index}] missing title`);
            if (panelId && title) {
              const entry = asNonEmptyString(panel.entry);
              panels.push(entry ? { slot, id: panelId, title, entry } : { slot, id: panelId, title });
            }
          }
          if (panels.length) summary.panels = panels;
        }
      }
      if (appUi.toolRenderers !== undefined) {
        if (!Array.isArray(appUi.toolRenderers)) {
          errors.push("app.ui.toolRenderers must be an array");
        } else {
          const toolRenderers: ExtensionUiToolRenderer[] = [];
          for (const [index, renderer] of appUi.toolRenderers.entries()) {
            if (!isRecord(renderer) || !asNonEmptyString(renderer.tool)) {
              errors.push(`app.ui.toolRenderers[${index}] must declare tool`);
              continue;
            }
            const entry = asNonEmptyString(renderer.entry);
            toolRenderers.push(entry ? { tool: renderer.tool as string, entry } : { tool: renderer.tool as string });
          }
          if (toolRenderers.length) summary.toolRenderers = toolRenderers;
        }
      }
      if (appUi.settingsSections !== undefined) {
        if (!Array.isArray(appUi.settingsSections)) {
          errors.push("app.ui.settingsSections must be an array");
        } else {
          const settingsSections: ExtensionUiSettingsSection[] = [];
          for (const [index, section] of appUi.settingsSections.entries()) {
            if (!isRecord(section)) {
              errors.push(`app.ui.settingsSections[${index}] must be an object`);
              continue;
            }
            const sectionId = asNonEmptyString(section.id);
            const title = asNonEmptyString(section.title);
            if (!sectionId || !title) {
              errors.push(`app.ui.settingsSections[${index}] must declare id and title`);
              continue;
            }
            const entry = asNonEmptyString(section.entry);
            settingsSections.push(entry ? { id: sectionId, title, entry } : { id: sectionId, title });
          }
          if (settingsSections.length) summary.settingsSections = settingsSections;
        }
      }
      if (appUi.slashCommands !== undefined) {
        if (!Array.isArray(appUi.slashCommands)) {
          errors.push("app.ui.slashCommands must be an array");
        } else {
          const slashCommands: ExtensionUiSlashCommand[] = [];
          for (const [index, command] of appUi.slashCommands.entries()) {
            if (!isRecord(command) || !asNonEmptyString(command.name)) {
              errors.push(`app.ui.slashCommands[${index}] must declare name`);
              continue;
            }
            const description = asNonEmptyString(command.description);
            slashCommands.push(description ? { name: command.name as string, description } : { name: command.name as string });
          }
          if (slashCommands.length) summary.slashCommands = slashCommands;
        }
      }
      if (appUi.themes !== undefined && !Array.isArray(appUi.themes)) errors.push("app.ui.themes must be an array");
      if (appUi.statusBar !== undefined && !Array.isArray(appUi.statusBar)) errors.push("app.ui.statusBar must be an array");
      if (Object.keys(summary).length) ui = summary;
    }
  }

  let agentExtension: string | undefined;
  let agentSkills: string[] | undefined;
  if (value.agent !== undefined && value.agent !== null) {
    if (!isRecord(value.agent)) {
      errors.push("agent must be an object");
    } else {
      if (value.agent.extension !== undefined) {
        const path = asNonEmptyString(value.agent.extension);
        if (!path) errors.push("agent.extension must be a path string");
        else agentExtension = path;
      }
      if (value.agent.skills !== undefined) {
        if (!Array.isArray(value.agent.skills) || !value.agent.skills.every((item) => typeof item === "string" && item.trim())) {
          errors.push("agent.skills must be an array of paths");
        } else {
          agentSkills = value.agent.skills.map((item) => String(item));
        }
      }
    }
  }

  const fallbackId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : undefined;
  if (errors.length) return { ok: false, errors, fallbackId };

  const manifest: ValidatedExtensionManifest = {
    id: id!,
    name: name!,
    version: version!,
    capabilities,
  };
  if (settings) manifest.settings = settings;
  if (ui) manifest.ui = ui;
  if (agentExtension) manifest.agentExtension = agentExtension;
  if (agentSkills) manifest.agentSkills = agentSkills;
  return { ok: true, manifest };
}

export function parseExtensionManifestJson(text: string): ManifestValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  return validateExtensionManifest(parsed);
}

export function originPrecedence(origin: ExtensionOrigin): number {
  if (origin === "project") return 3;
  if (origin === "app") return 2;
  return 1;
}
