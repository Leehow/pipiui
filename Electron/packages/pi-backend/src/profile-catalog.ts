import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ProductProfileDescriptor } from "@pipi/host-api";

import {
  PRODUCT_PROFILE_ID_RE,
  PRODUCT_PROFILE_MANIFEST_FILENAME,
  parseProductProfileManifestJson,
  type ProductProfileManifest,
} from "./profile-manifest.js";

export type ProductProfileCatalogEntry = {
  descriptor: ProductProfileDescriptor;
  profile?: ProductProfileManifest;
};

async function readCatalogRoot(
  root: string,
  source: "builtin" | "project",
): Promise<ProductProfileCatalogEntry[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: ProductProfileCatalogEntry[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !PRODUCT_PROFILE_ID_RE.test(entry.name)) continue;
    try {
      const parsed = parseProductProfileManifestJson(
        await readFile(join(root, entry.name, PRODUCT_PROFILE_MANIFEST_FILENAME), "utf8"),
      );
      if (!parsed.ok) {
        out.push({
          descriptor: { id: entry.name, name: entry.name, source, state: "error", error: parsed.errors.join("; ") },
        });
        continue;
      }
      if (parsed.profile.id !== entry.name) {
        out.push({
          descriptor: {
            id: entry.name,
            name: parsed.profile.name,
            source,
            state: "error",
            error: `profile id '${parsed.profile.id}' does not match directory '${entry.name}'`,
          },
        });
        continue;
      }
      out.push({
        profile: parsed.profile,
        descriptor: {
          id: parsed.profile.id,
          name: parsed.profile.name,
          source,
          ...(parsed.profile.description ? { description: parsed.profile.description } : {}),
          ...(parsed.profile.customizable !== undefined ? { customizable: parsed.profile.customizable } : {}),
          layout: parsed.profile.layout,
          requiredExtensionIds: parsed.profile.extensions.required.map(item => item.id),
          recommendedExtensionIds: parsed.profile.extensions.recommended.map(item => item.id),
          state: "available",
        },
      });
    } catch (error) {
      out.push({
        descriptor: {
          id: entry.name,
          name: entry.name,
          source,
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return out;
}

export async function readProductProfileCatalog(
  runtimeRoot: string,
  projectAgentDir?: string,
): Promise<ProductProfileCatalogEntry[]> {
  const bundled = await readCatalogRoot(join(runtimeRoot, "profiles"), "builtin");
  if (!projectAgentDir) return bundled;
  const project = await readCatalogRoot(join(projectAgentDir, "profiles"), "project");
  const merged = new Map(bundled.map(item => [item.descriptor.id, item]));
  for (const item of project) merged.set(item.descriptor.id, item);
  return [...merged.values()].sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
}
