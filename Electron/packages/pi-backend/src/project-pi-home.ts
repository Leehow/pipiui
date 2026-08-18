import { existsSync, lstatSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const AMBIENT_RESOURCE_SETTINGS = [
  "packages",
  "extensions",
  "skills",
  "prompts",
  "promptTemplates",
  "themes",
] as const;

const CREDENTIAL_FILES = [".env", "auth.json", "models.json", "models-store.json", "trust.json"] as const;

/** Coding Pi home for one opened project. Never `~/.pi/agent`. */
export function projectPiAgentDir(projectRoot: string): string {
  return join(resolve(projectRoot), ".pi", "agent");
}

export function projectPiSessionsDir(projectRoot: string): string {
  return join(projectPiAgentDir(projectRoot), "sessions");
}

export function sanitizePiSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { theme: "light" };
  const settings = { ...(raw as Record<string, unknown>) };
  for (const key of AMBIENT_RESOURCE_SETTINGS) delete settings[key];
  return settings;
}

export async function sanitizePiSettingsFile(path: string): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const dirty = AMBIENT_RESOURCE_SETTINGS.some((key) => key in parsed);
  if (!dirty) return false;
  await writeFile(path, `${JSON.stringify(sanitizePiSettings(parsed), null, 2)}\n`);
  return true;
}

async function copyRegularFileIfMissing(sourceDir: string | undefined, destDir: string, name: string): Promise<void> {
  if (!sourceDir) return;
  const dest = join(destDir, name);
  if (existsSync(dest)) return;
  const source = join(sourceDir, name);
  if (!existsSync(source)) return;
  try {
    if (lstatSync(source).isSymbolicLink()) return;
  } catch {
    return;
  }
  await copyFile(source, dest);
}

/**
 * Create `{project}/.pi/agent` for PipiUI coding sessions.
 *
 * Credentials may be copied once from the host profile so the user does not
 * re-login. Packages and other ambient locators are never copied. The function
 * never reads or writes `~/.pi`.
 */
export async function ensureProjectPiHome(options: {
  projectRoot: string;
  credentialSeedDir?: string;
}): Promise<{ agentDir: string; sessionsDir: string }> {
  const agentDir = projectPiAgentDir(options.projectRoot);
  const sessionsDir = projectPiSessionsDir(options.projectRoot);
  await mkdir(sessionsDir, { recursive: true });

  const settingsPath = join(agentDir, "settings.json");
  if (existsSync(settingsPath)) {
    await sanitizePiSettingsFile(settingsPath);
  } else {
    let source: unknown = { theme: "light" };
    if (options.credentialSeedDir) {
      try {
        source = JSON.parse(await readFile(join(options.credentialSeedDir, "settings.json"), "utf8"));
      } catch {
        /* seed settings are optional */
      }
    }
    await writeFile(settingsPath, `${JSON.stringify(sanitizePiSettings(source), null, 2)}\n`);
  }

  for (const name of CREDENTIAL_FILES) {
    await copyRegularFileIfMissing(options.credentialSeedDir, agentDir, name);
  }
  return { agentDir, sessionsDir };
}
