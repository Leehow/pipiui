/**
 * Settings → skill 开关 enforcement at prompt level.
 *
 * Pi has no "exclude skills" CLI flag (only `--skill <path>` to load one explicitly and
 * `--no-skills` to kill them all), so a per-skill toggle can only be honored by editing the
 * system prompt: pi's `formatSkillsForPrompt()` emits one `<available_skills>` block whose
 * `<skill>` entries are the sole thing that makes a skill model-visible.
 *
 * Emitted shape (verified against pi-coding-agent `dist/core/skills.js`, Agent Skills XML
 * standard — https://agentskills.io/integrate-skills):
 *
 *   <available_skills>
 *     <skill>
 *       <name>tdd</name>
 *       <description>...</description>
 *       <location>/abs/path/SKILL.md</location>
 *     </skill>
 *   </available_skills>
 *
 * Names/descriptions/locations are XML-escaped by pi, so entry names are unescaped before
 * they are compared with the disabled set.
 *
 * DESIGN DECISION — a disabled skill stays invocable via `/skill:name`.
 * The toggle governs *auto-visibility* (whether the model may pick the skill up on its own),
 * not whether the user may still ask for it by name. That matches pi's own built-in
 * `disableModelInvocation` frontmatter flag, which drops a skill from this same block while
 * `/skill:name` keeps working: pi expands that command from its resource loader
 * (`AgentSession._expandSkillCommand`), never from the system prompt, so removing the entry
 * here cannot break explicit invocation.
 */

import * as fs from "node:fs";

export interface SkillFilterResult {
	/** Prompt with disabled `<skill>` entries removed (block preserved, even if now empty). */
	systemPrompt: string;
	/** Names actually dropped, in prompt order. */
	removed: string[];
	/** `<skill>` entries still in the block. 0 → caller should drop the whole skills section. */
	remaining: number;
	/** False when the prompt carries no `<available_skills>` block at all. */
	hadBlock: boolean;
}

const AVAILABLE_SKILLS_BLOCK = /<available_skills>\n([\s\S]*?)\n<\/available_skills>/;
// Each match carries its own trailing newline, so dropping one leaves no blank line behind.
const SKILL_ENTRY = /^[ \t]*<skill>[\s\S]*?<\/skill>[ \t]*\n?/gm;
const SKILL_ENTRY_NAME = /<name>([\s\S]*?)<\/name>/;

function unescapeXml(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/**
 * Settings stores pi's slash-command name (`skill:tdd`); the prompt carries the bare skill
 * name (`tdd`). Strip one leading `skill:` so both spellings resolve to the same key —
 * namespaced skills (`superpowers:brainstorming`) keep their remaining colons.
 */
export function normalizeSkillName(raw: string): string {
	const trimmed = raw.trim();
	return trimmed.startsWith("skill:") ? trimmed.slice("skill:".length) : trimmed;
}

/** Hot-read Settings → skill 开关 denylist from the Swift-owned JSON mirror. */
export function loadDisabledSkills(settingsFile: string): Set<string> {
	try {
		const raw = fs.readFileSync(settingsFile, "utf-8");
		const parsed = JSON.parse(raw) as { disabledSkills?: unknown };
		const list = Array.isArray(parsed.disabledSkills)
			? parsed.disabledSkills.filter((x): x is string => typeof x === "string")
			: [];
		const out = new Set<string>();
		for (const name of list) {
			const normalized = normalizeSkillName(name);
			if (normalized) out.add(normalized);
		}
		return out;
	} catch {
		return new Set();
	}
}

/**
 * Drop the disabled skills' entries from `<available_skills>`, leaving every other entry —
 * and the rest of the prompt — byte-identical.
 */
export function filterDisabledSkills(
	systemPrompt: string,
	disabled: ReadonlySet<string>,
): SkillFilterResult {
	const removed: string[] = [];
	let hadBlock = false;
	let remaining = 0;

	const next = systemPrompt.replace(AVAILABLE_SKILLS_BLOCK, (_block, inner: string) => {
		hadBlock = true;
		const filtered = inner
			.replace(SKILL_ENTRY, (entry) => {
				const match = SKILL_ENTRY_NAME.exec(entry);
				const name = match ? unescapeXml(match[1]).trim() : "";
				if (name && disabled.has(name)) {
					removed.push(name);
					return "";
				}
				remaining += 1;
				return entry;
			})
			.replace(/^\n+|\n+$/g, "");
		return `<available_skills>\n${filtered}\n</available_skills>`;
	});

	if (!hadBlock) {
		return { systemPrompt, removed, remaining: 0, hadBlock: false };
	}
	return { systemPrompt: removed.length > 0 ? next : systemPrompt, removed, remaining, hadBlock };
}
