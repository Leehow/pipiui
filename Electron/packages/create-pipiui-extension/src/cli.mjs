#!/usr/bin/env node
/**
 * Local-template scaffolder. Copies `template/` from this package; never hits the network.
 * Usage: create-pipiui-extension <name> [dir]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]*$/;

const PLACEHOLDER_ID = "__ID__";
const PLACEHOLDER_NAME = "__NAME__";

export function legalizeExtensionId(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) {
    throw new Error("missing <name>: create-pipiui-extension <name> [dir]");
  }
  let id = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  if (!id) {
    throw new Error(`cannot legalize '${trimmed}' to an extension id ([a-z][a-z0-9-]*)`);
  }
  if (!/^[a-z]/.test(id)) id = `ext-${id}`;
  if (!EXTENSION_ID_RE.test(id)) {
    throw new Error(`cannot legalize '${trimmed}' to an extension id ([a-z][a-z0-9-]*)`);
  }
  return id;
}

export function displayNameFrom(name, id) {
  const trimmed = String(name ?? "").trim();
  return trimmed || id;
}

/** Strip // and /* * / comments outside of strings so the generated manifest is JSON.parse-able. */
export function stripJsonc(input) {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      i++;
      while (i + 1 < input.length && input[i + 1] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function escapeForText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function replacePlaceholders(text, id, name) {
  return text.split(PLACEHOLDER_ID).join(id).split(PLACEHOLDER_NAME).join(escapeForText(name));
}

function isProbablyText(buffer) {
  const slice = buffer.subarray(0, Math.min(buffer.length, 8000));
  return !slice.includes(0);
}

function walkFiles(root, visit) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(path, visit);
    else if (entry.isFile()) visit(path);
  }
}

export function templateRoot(from = import.meta.url) {
  return join(dirname(fileURLToPath(from)), "..", "template");
}

export function profileTemplateRoot(from = import.meta.url) {
  return join(dirname(fileURLToPath(from)), "..", "profile-template");
}

export function createPipiuiExtension(input) {
  const nameArg = input.name;
  const id = legalizeExtensionId(nameArg);
  const name = displayNameFrom(nameArg, id);
  const cwd = input.cwd ?? process.cwd();
  const dest = resolve(cwd, input.dir ?? id);
  const source = input.templateDir ?? templateRoot();

  if (!existsSync(source)) {
    throw new Error(`template directory missing: ${source}`);
  }
  if (existsSync(dest)) {
    const stat = statSync(dest);
    if (!stat.isDirectory()) {
      throw new Error(`destination exists and is not a directory: ${dest}`);
    }
    if (readdirSync(dest).length > 0) {
      throw new Error(`destination is not empty: ${dest}`);
    }
  } else {
    mkdirSync(dest, { recursive: true });
  }

  cpSync(source, dest, { recursive: true });

  walkFiles(dest, (path) => {
    const buffer = readFileSync(path);
    if (!isProbablyText(buffer)) return;
    let text = replacePlaceholders(buffer.toString("utf8"), id, name);
    if (path.endsWith("pipiui-extension.json")) {
      text = stripJsonc(text);
      JSON.parse(text);
      if (!text.endsWith("\n")) text += "\n";
    }
    writeFileSync(path, text);
  });

  return { id, name, dir: dest };
}

export function createPipiuiProfile(input) {
  const id = legalizeExtensionId(input.name);
  const name = displayNameFrom(input.name, id);
  const cwd = input.cwd ?? process.cwd();
  const dest = resolve(cwd, input.dir ?? id);
  const source = input.templateDir ?? profileTemplateRoot();
  if (!existsSync(source)) throw new Error(`profile template directory missing: ${source}`);
  if (existsSync(dest)) {
    const stat = statSync(dest);
    if (!stat.isDirectory()) throw new Error(`destination exists and is not a directory: ${dest}`);
    if (readdirSync(dest).length > 0) throw new Error(`destination is not empty: ${dest}`);
  } else mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  walkFiles(dest, (path) => {
    const buffer = readFileSync(path);
    if (!isProbablyText(buffer)) return;
    let text = replacePlaceholders(buffer.toString("utf8"), id, name);
    if (path.endsWith("pipiui-profile.json")) {
      JSON.parse(text);
      if (!text.endsWith("\n")) text += "\n";
    }
    writeFileSync(path, text);
  });
  return { id, name, dir: dest };
}

/** Nearest ancestor (inclusive) containing .git; undefined when not inside a project checkout. */
export function findProjectRoot(from) {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function printHelp() {
  process.stdout.write(`Usage: create-pipiui-extension [--profile] [--install] <name> [dir]

Copy the local dual-half template (no network) and fill id/name.
  --profile  Create a pure Product Profile instead of an extension package.
  --install  Scaffold straight into {projectRoot}/.pi/agent/extensions/<id>: the
             extension is discovered and enabled for the current project (an
             explicit [dir] still wins). Requires cwd to be inside a project
             (a .git ancestor); errors out otherwise. Never writes outside the
             project or to a global ~/.pi.
  name  Display name; legalized to id [a-z][a-z0-9-]*
  dir   Package root (default: ./<id>, or the project extensions dir with --install)

Install the generated folder in one of:
  {project}/.pi/agent/extensions/<id>
  App profile pi-agent/extensions/<id>
  Bundled runtime extensions/<id>  (maintainers / builtin)
`);
}

export function runCli(argv, io = { log: console.log, error: console.error }) {
  const args = argv.filter((item) => item !== "--");
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return 0;
  }
  const positional = args.filter((item) => !item.startsWith("-"));
  if (positional.length === 0) {
    printHelp();
    io.error("missing <name>");
    return 1;
  }
  if (positional.length > 2) {
    io.error("too many arguments: create-pipiui-extension <name> [dir]");
    return 1;
  }
  const profile = args.includes("--profile");
  const install = args.includes("--install");
  if (profile && install) {
    io.error("--install applies to extension packages, not --profile");
    return 1;
  }
  let installTarget = false;
  let dir = positional[1];
  if (install && dir === undefined) {
    const projectRoot = findProjectRoot(process.cwd());
    if (!projectRoot) {
      io.error("--install requires the current directory to be inside a project (no .git ancestor found)");
      return 1;
    }
    dir = join(projectRoot, ".pi", "agent", "extensions", legalizeExtensionId(positional[0]));
    installTarget = true;
  }
  const result = profile
    ? createPipiuiProfile({ name: positional[0], dir: positional[1] })
    : createPipiuiExtension({ name: positional[0], dir });
  io.log(installTarget
    ? `installed ${result.id} at ${result.dir} (discovered and enabled for this project; new sessions pick it up)`
    : `created ${profile ? "profile " : ""}${result.id} at ${result.dir}`);
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
