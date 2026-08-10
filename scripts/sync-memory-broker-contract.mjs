#!/usr/bin/env node

import { cp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const canonicalContractRoot = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/packages/memory-broker-contract/contract",
);
export const vendoredContractRoot = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/packages/memory-broker/vendor/pipiui-memory-broker-contract/contract",
);

async function relativeFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await relativeFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push(relative(root, absolute));
    } else {
      throw new Error(`Unsupported contract tree entry: ${absolute}`);
    }
  }
  return files.sort();
}

/** Compare every relative file path and its exact bytes. */
export async function compareMemoryBrokerContractTrees(
  canonicalRoot = canonicalContractRoot,
  vendoredRoot = vendoredContractRoot,
) {
  const [canonicalPaths, vendoredPaths] = await Promise.all([
    relativeFiles(canonicalRoot),
    relativeFiles(vendoredRoot),
  ]);
  const canonicalSet = new Set(canonicalPaths);
  const vendoredSet = new Set(vendoredPaths);
  const missing = canonicalPaths.filter((file) => !vendoredSet.has(file));
  const extra = vendoredPaths.filter((file) => !canonicalSet.has(file));
  const changed = [];
  for (const file of canonicalPaths) {
    if (!vendoredSet.has(file)) continue;
    const [canonicalBytes, vendoredBytes] = await Promise.all([
      readFile(join(canonicalRoot, file)),
      readFile(join(vendoredRoot, file)),
    ]);
    if (!canonicalBytes.equals(vendoredBytes)) changed.push(file);
  }
  return { canonicalPaths, vendoredPaths, missing, extra, changed };
}

function driftError({ missing, extra, changed }) {
  const details = [
    missing.length ? `missing: ${missing.join(", ")}` : "",
    extra.length ? `extra: ${extra.join(", ")}` : "",
    changed.length ? `changed: ${changed.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  return new Error(
    `Memory Broker vendored contract drift (${details || "unknown"}). Run node scripts/sync-memory-broker-contract.mjs.`,
  );
}

/** Throw unless the two contract trees have the same files and bytes. */
export async function assertMemoryBrokerContractParity(canonicalRoot, vendoredRoot) {
  const comparison = await compareMemoryBrokerContractTrees(canonicalRoot, vendoredRoot);
  if (comparison.missing.length || comparison.extra.length || comparison.changed.length) {
    throw driftError(comparison);
  }
  return comparison;
}

/** Replace the vendored contract tree from the sole editable source, then verify it. */
export async function syncMemoryBrokerContract(
  canonicalRoot = canonicalContractRoot,
  vendoredRoot = vendoredContractRoot,
) {
  await rm(vendoredRoot, { recursive: true, force: true });
  await cp(canonicalRoot, vendoredRoot, { recursive: true });
  return assertMemoryBrokerContractParity(canonicalRoot, vendoredRoot);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await syncMemoryBrokerContract();
    process.stdout.write("Synchronized Memory Broker vendored contract.\n");
    return;
  }
  if (args.length === 1 && args[0] === "--check") {
    await assertMemoryBrokerContractParity();
    process.stdout.write("Memory Broker vendored contract is in sync.\n");
    return;
  }
  throw new Error("Usage: node scripts/sync-memory-broker-contract.mjs [--check]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
