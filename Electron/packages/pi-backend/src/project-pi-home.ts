import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
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

const SHARED_CREDENTIAL_FILES = [".env", "auth.json"] as const;
const COPIED_CREDENTIAL_FILES = ["models.json", "models-store.json", "trust.json"] as const;

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
 * Login identity lives in the host profile. Every opened project points at the
 * same regular file so an OAuth refresh in one session is visible in all of them.
 * A seed that is itself a symlink is left untouched — that is how a planted
 * `~/.pi` or another home must not leak into the project.
 */
function linkSharedCredential(sourceDir: string | undefined, destDir: string, name: string): void {
  if (!sourceDir) return;
  const source = resolve(sourceDir, name);
  const dest = resolve(destDir, name);
  try {
    if (!existsSync(source) || lstatSync(source).isSymbolicLink()) return;
  } catch {
    return;
  }
  try {
    const destStat = lstatSync(dest);
    if (destStat.isSymbolicLink() && readlinkSync(dest) === source) return;
    unlinkSync(dest);
  } catch {
    /* dest missing */
  }
  symlinkSync(source, dest);
}

/**
 * Create `{project}/.pi/agent` for PipiUI coding sessions.
 *
 * Login files (`auth.json`, `.env`) are linked to the host profile so every
 * opened project shares one identity. Model catalog files may still be copied
 * once. Packages and other ambient locators are never copied. The function
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

  for (const name of SHARED_CREDENTIAL_FILES) {
    linkSharedCredential(options.credentialSeedDir, agentDir, name);
  }
  for (const name of COPIED_CREDENTIAL_FILES) {
    await copyRegularFileIfMissing(options.credentialSeedDir, agentDir, name);
  }
  return { agentDir, sessionsDir };
}
