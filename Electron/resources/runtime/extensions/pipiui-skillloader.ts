// Electron-owned on-demand skill loader: names-only index in the prompt, bodies behind two tools.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Pi's own rendered catalog: a preamble telling the model to `read` skill files, then the
// XML block. Both are replaced by the index below.
const PI_SKILLS_PREAMBLE_HEAD = "The following skills provide specialized instructions for specific tasks.";
const AVAILABLE_SKILLS_BLOCK = /\n*<available_skills>[\s\S]*?<\/available_skills>/g;
const MAX_BODY_CHARS = 60_000;
const SEARCH_RESULT_CAP = 8;
const WALK_MAX_DEPTH = 4;

interface SkillEntry {
  name: string;
  description: string;
  /** `disable-model-invocation: true` — Pi keeps these out of its catalog entirely. */
  userInvoked: boolean;
  file: string;
  dir: string;
}

function homePath(raw: string): string {
  return raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

// The host injects the installed Electron-owned root. Missing means no bundled catalog; user
// roots below remain available and no platform-specific support directory is guessed.
const PIPIUI_BUILT_IN_SKILL_ROOT = process.env.PIPIUI_BUILT_IN_SKILL_ROOT;

/**
 * PipiUI's own skills are first so a same-named user skill cannot replace a bundled workflow.
 * The user's explicit PIPIUI_SKILL_ROOTS override and this project's `.pi/agent`
 * skills/settings remain discoverable afterwards. Never `~/.pi`. First root wins.
 */
function projectAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(process.cwd(), ".pi", "agent");
}

function skillRoots(): string[] {
  const roots: string[] = PIPIUI_BUILT_IN_SKILL_ROOT ? [PIPIUI_BUILT_IN_SKILL_ROOT] : [];
  const override = process.env.PIPIUI_SKILL_ROOTS;
  if (override) roots.push(...override.split(path.delimiter).filter(Boolean).map(homePath));
  const agentDir = projectAgentDir();
  roots.push(path.join(agentDir, "skills"));
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"),
    ) as { skills?: unknown };
    if (Array.isArray(settings.skills)) {
      for (const entry of settings.skills) {
        if (typeof entry === "string" && entry.trim()) roots.push(homePath(entry.trim()));
      }
    }
  } catch {
    // No project settings file / unreadable: bundled and override roots still apply.
  }
  return roots.filter((root, index) => root && roots.indexOf(root) === index);
}

/** Pi's rule: a directory holding SKILL.md is a skill root and is not recursed into. */
function walkForSkills(dir: string, out: string[], depth = 0): void {
  if (depth > WALK_MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.name === "SKILL.md" && !e.isDirectory())) {
    out.push(path.join(dir, "SKILL.md"));
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDir) walkForSkills(full, out, depth + 1);
  }
}

function frontmatterOf(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

function stripFrontmatter(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (match ? match[1] : text).trim();
}

/** Hot-read Settings → 技能开关 denylist, so a toggle applies without a session restart. */
function disabledSkills(): Set<string> {
  const settingsFile = process.env.PIPIUI_TOOL_SKILL_SETTINGS_FILE;
  if (!settingsFile) return new Set();
  try {
    const parsed = JSON.parse(
      fs.readFileSync(settingsFile, "utf-8"),
    ) as { disabledSkills?: unknown };
    const list = Array.isArray(parsed.disabledSkills)
      ? parsed.disabledSkills.filter((x): x is string => typeof x === "string")
      : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

/** Hot-read on every use: an edited or newly installed skill needs no session restart. */
function loadCatalog(): SkillEntry[] {
  const files: string[] = [];
  for (const root of skillRoots()) walkForSkills(root, files);
  const disabled = disabledSkills();
  const byName = new Map<string, SkillEntry>();
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const fm = frontmatterOf(text);
    const name = fm.name || path.basename(path.dirname(file));
    const description = fm.description || "";
    // Pi rejects a skill with no description; mirror that instead of listing a blank entry.
    if (!description || disabled.has(name)) continue;
    // First root wins, matching the order Pi resolves its own skill paths in.
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        description,
        userInvoked: fm["disable-model-invocation"] === "true",
        file,
        dir: path.dirname(file),
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Names only. The description — the expensive part — is what `skill_search` is for. */
function indexBlock(entries: SkillEntry[]): string {
  if (entries.length === 0) return "";
  const auto = entries.filter((e) => !e.userInvoked).map((e) => e.name);
  const manual = entries.filter((e) => e.userInvoked).map((e) => e.name);
  const lines = [
    "<available_skills>",
    "Skills are loaded on demand: only their names are listed here. Call `skill_search` to",
    "read the descriptions of candidates, then `skill_load` to load the one you want. Never",
    "guess what a skill does from its name, and never `read` a SKILL.md directly — the tools",
    "resolve names to files and report the skill's own directory for its relative paths.",
    "",
    `Available on your own judgement: ${auto.join(", ") || "(none)"}`,
  ];
  if (manual.length > 0) {
    lines.push(
      "",
      `Also yours to load, heavier: ${manual.join(", ")}`,
      "These carry multi-step processes and document or ticket deliverables, so they cost more",
      "than an ordinary turn — load one when you judge the work is actually that size. The user",
      "can also invoke them directly as /skill:<name>. Some expect an issue tracker, which this",
      "project has none configured; keep that state in the ledger instead.",
    );
  }
  lines.push("</available_skills>");
  return `\n\n${lines.join("\n")}`;
}

function formatSearchHit(entry: SkillEntry): string {
  const kind = entry.userInvoked ? "heavier: multi-step, produces documents or tickets" : "available";
  return [`## ${entry.name}`, `Kind: ${kind}`, entry.description].join("\n");
}

function scoreEntry(entry: SkillEntry, terms: string[]): number {
  const name = entry.name.toLowerCase();
  const description = entry.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) score += 10;
    if (description.includes(term)) score += 3;
  }
  return score;
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const entries = loadCatalog();
    let systemPrompt = event.systemPrompt.replace(AVAILABLE_SKILLS_BLOCK, "");
    const preambleAt = systemPrompt.indexOf(PI_SKILLS_PREAMBLE_HEAD);
    if (preambleAt >= 0) {
      // Pi's preamble tells the model to `read` skill files itself, which would bypass both
      // tools and reintroduce the cost this extension exists to remove.
      const after = systemPrompt.indexOf("\n\n", preambleAt);
      systemPrompt =
        systemPrompt.slice(0, preambleAt) + (after >= 0 ? systemPrompt.slice(after + 2) : "");
    }
    const rebuilt = `${systemPrompt.trimEnd()}${indexBlock(entries)}`;
    if (rebuilt === event.systemPrompt) return;
    return { systemPrompt: rebuilt };
  });

  pi.registerTool({
    name: "skill_search",
    label: "Skill Search",
    description: [
      "Search installed skills by keyword and return each match's full description.",
      "Use before skill_load to confirm a skill actually covers the task; omit query to list every skill.",
      "Returns descriptions only — call skill_load for the instructions themselves.",
    ].join(" "),
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({ description: "Keywords, e.g. \"spec document\" or \"merge conflict\"." }),
      ),
    }),
    async execute(_id, params) {
      const entries = loadCatalog();
      const terms = (params.query ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
      const ranked =
        terms.length === 0
          ? entries
          : entries
              .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)
              .map((x) => x.entry);
      if (ranked.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No skill matches ${JSON.stringify(params.query ?? "")}. Installed: ${entries
                .map((e) => e.name)
                .join(", ")}. Proceed without a skill.`,
            },
          ],
        };
      }
      const shown = ranked.slice(0, SEARCH_RESULT_CAP);
      const more =
        ranked.length > shown.length ? `\n\n(${ranked.length - shown.length} more; narrow the query.)` : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `${shown.map(formatSearchHit).join("\n\n")}${more}\n\nLoad one with skill_load({name}).`,
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "skill_load",
    label: "Skill Load",
    description: [
      "Load one installed skill's instructions by name and follow them for the current task.",
      "Names come from the available_skills index or skill_search; a path is not accepted.",
      "A skill is advice for this session, never a mandate to add gates or documents the user did not ask for.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Exact skill name, e.g. \"tdd\" or \"to-spec\"." }),
    }),
    async execute(_id, params) {
      const entries = loadCatalog();
      const wanted = (params.name ?? "").trim().replace(/^skill:/, "");
      const entry = entries.find((e) => e.name === wanted);
      if (!entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown skill ${JSON.stringify(params.name)}. Installed: ${entries
                .map((e) => e.name)
                .join(", ")}.`,
            },
          ],
          isError: true,
        };
      }
      let body: string;
      try {
        body = stripFrontmatter(fs.readFileSync(entry.file, "utf-8"));
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not read ${entry.file}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
      if (body.length > MAX_BODY_CHARS) {
        body = `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated at ${MAX_BODY_CHARS} chars]`;
      }
      const header = [
        `# Skill: ${entry.name}`,
        `Skill directory (resolve its relative paths against this): ${entry.dir}`,
        entry.userInvoked
          ? "This is a heavier workflow. Follow it as far as the work actually needs and drop the steps this goal does not; it does not outrank your own protocol."
          : "Follow this as advice for the current task; it does not outrank your own protocol.",
      ].join("\n");
      return {
        content: [{ type: "text" as const, text: `${header}\n\n---\n\n${body}` }],
        details: { name: entry.name, file: entry.file, userInvoked: entry.userInvoked },
      };
    },
  });
}
