import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MEMORY_BROKER_PACKAGE_NAME = "pipiui-memory-broker";

export type MemoryBrokerPackageIdentity = {
  root: string;
  entrypoint: string;
  version: string;
};

type Environment = Record<string, string | undefined>;

function text(env: Environment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function identityAt(rootPath: string): MemoryBrokerPackageIdentity | undefined {
  try {
    const root = realpathSync(rootPath);
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    if (manifest.name !== MEMORY_BROKER_PACKAGE_NAME || typeof manifest.version !== "string" || !manifest.version.trim()) {
      return undefined;
    }
    const entrypoint = realpathSync(resolve(root, "extensions/memory-broker.ts"));
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (!entrypoint.startsWith(prefix) || !isFile(entrypoint)) return undefined;
    return { root, entrypoint, version: manifest.version.trim() };
  } catch {
    return undefined;
  }
}

/** Identity of the exact package that loaded this main extension. */
export function currentMemoryBrokerPackageIdentity(): MemoryBrokerPackageIdentity | undefined {
  return identityAt(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}

/**
 * Fail-closed validation for a main-issued child identity. It never discovers a
 * nearby development bundle: root, extension file, and manifest version must
 * all be the exact values issued by the already-running main package.
 */
export function issuedMemoryBrokerPackageIdentity(
  env: Environment,
  expectedIdentity: MemoryBrokerPackageIdentity,
): MemoryBrokerPackageIdentity | undefined {
  const root = text(env, "PIPIUI_MEMORY_BROKER_PACKAGE_ROOT");
  const entrypoint = text(env, "PIPIUI_MEMORY_BROKER_EXTENSION");
  const version = text(env, "PIPIUI_MEMORY_BROKER_PACKAGE_VERSION");
  if (!root || !entrypoint || !version || !isAbsolute(root) || !isAbsolute(entrypoint)) return undefined;
  const identity = identityAt(root);
  if (
    !identity
    || root !== identity.root
    || entrypoint !== identity.entrypoint
    || identity.version !== version
    || identity.root !== expectedIdentity.root
    || identity.entrypoint !== expectedIdentity.entrypoint
    || identity.version !== expectedIdentity.version
  ) return undefined;
  try {
    return realpathSync(entrypoint) === identity.entrypoint ? identity : undefined;
  } catch {
    return undefined;
  }
}
