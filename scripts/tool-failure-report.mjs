#!/usr/bin/env node
/**
 * Offline scan of pi session jsonl for tool validation / exclusive-mode failures.
 *
 *   node scripts/tool-failure-report.mjs
 *   node scripts/tool-failure-report.mjs --root "$HOME/Library/Application Support/@pipiui/electron/pi-agent/sessions"
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ROOTS = [
  join(homedir(), "Library/Application Support/@pipiui/electron/pi-agent/sessions"),
  join(homedir(), ".pi/agent/sessions"),
];

const fieldRe = /^\s*-\s*([^:]+):\s*(.+)$/gm;
const toolRe = /Validation failed for tool "([^"]+)"/;

function walkJsonl(root, found = []) {
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkJsonl(path, found);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
  }
  return found;
}

function textsFrom(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (typeof value.text === "string") out.push(value.text);
  if (typeof value.content === "string") out.push(value.content);
  if (Array.isArray(value.content)) for (const part of value.content) textsFrom(part, out);
  for (const [key, entry] of Object.entries(value)) {
    if (key === "text" || key === "content") continue;
    if (entry && typeof entry === "object") textsFrom(entry, out);
  }
  return out;
}

function classify(blob) {
  if (blob.includes("Invalid parameters. Provide exactly one mode")) return ["exclusive_mode"];
  if (!blob.includes("Validation failed for tool")) return [];
  const cats = new Set();
  for (const match of blob.matchAll(fieldRe)) {
    const msg = match[2];
    if (msg.includes("must have required properties")) cats.add("strict_required_missing");
    else if (msg.includes("must be equal to one of the allowed values")) cats.add("illegal_enum");
    else if (msg.includes("must not have fewer than")) cats.add("min_constraint");
    else if (msg.includes("must match a schema in anyOf")) cats.add("anyof_union");
    else if (msg.includes("must not have additional properties")) cats.add("additional_properties");
    else cats.add("other_schema");
  }
  if (cats.size === 0) cats.add("other_schema");
  return [...cats];
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const roots = process.argv.includes("--root")
  ? [process.argv[process.argv.indexOf("--root") + 1]]
  : DEFAULT_ROOTS;

const byTool = new Map();
const byCategory = new Map();
const byField = new Map();
let files = 0;
let validation = 0;
let exclusive = 0;

for (const root of roots) {
  try {
    statSync(root);
  } catch {
    continue;
  }
  for (const file of walkJsonl(root)) {
    files += 1;
    const seen = new Set();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const blob = textsFrom(event).join("\n");
      if (!blob) continue;
      const hash = `${file}:${blob.slice(0, 240)}`;
      if (seen.has(hash)) continue;
      seen.add(hash);
      if (blob.includes("Validation failed for tool")) {
        validation += 1;
        const tool = toolRe.exec(blob)?.[1] ?? "?";
        increment(byTool, tool);
        for (const cat of classify(blob)) increment(byCategory, `${tool}\t${cat}`);
        fieldRe.lastIndex = 0;
        for (const match of blob.matchAll(fieldRe)) {
          increment(byField, `${tool}\t${match[1].trim()}: ${match[2].trim()}`);
        }
      } else if (blob.includes("Invalid parameters. Provide exactly one mode")) {
        exclusive += 1;
        increment(byTool, "subagent");
        increment(byCategory, "subagent\texclusive_mode");
      }
    }
  }
}

const rank = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

console.log(`files=${files} validation=${validation} exclusive_mode=${exclusive}`);
console.log("\nBy tool");
for (const [key, count] of rank(byTool)) console.log(`  ${String(count).padStart(5)} ${key}`);
console.log("\nBy category");
for (const [key, count] of rank(byCategory)) console.log(`  ${String(count).padStart(5)} ${key}`);
console.log("\nTop field messages");
for (const [key, count] of rank(byField).slice(0, 25)) console.log(`  ${String(count).padStart(5)} ${key}`);
