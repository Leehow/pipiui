import {
	createEditToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import { Type } from "typebox";

import {
	capCompositeOutput,
	editMismatchHint,
	filterGrepLines,
	grepCountSummary,
	grepFilesSummary,
	parseGrepOutput,
	readPathIfDirectory,
	readToolDescription,
	resolveReadTarget,
	rewriteReadToolText,
} from "./coding-tools.ts";

interface ToolCtxLike {
	cwd?: string;
}

function ctxCwd(ctx: ToolCtxLike | undefined): string {
	return ctx?.cwd ?? process.cwd();
}

function resultText(result: unknown): string {
	const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n");
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function registerEditRecovery(pi: ExtensionAPI) {
	const prototype = createEditToolDefinition(".");
	const recovery = "Do not resend an unchanged failed edit. Copy oldText verbatim from the current file, including quotes and whitespace. " +
		"Rebuild the complete intended code block; do not shorten a replacement into a syntactically incomplete fragment just to make it match.";
	pi.registerTool({
		...prototype,
		promptGuidelines: [...(prototype.promptGuidelines ?? []), recovery],
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctxCwd(ctx);
			try {
				return await createEditToolDefinition(cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const mismatch = /^Could not find (?:edits\[(\d+)\]|the exact text) in /.exec(message);
				if (!mismatch || signal?.aborted) throw error;
				let hint: string | undefined;
				try {
					const oldText = params.edits?.[Number(mismatch[1] ?? 0)]?.oldText;
					const path = resolveReadTarget(params.path, cwd);
					const info = await stat(path);
					if (typeof oldText === "string" && info.isFile() && info.size <= 2 * 1024 * 1024) {
						hint = editMismatchHint(await readFile(path, "utf8"), oldText);
					}
				} catch { /* Preserve the original failure if the current file cannot be inspected. */ }
				throw new Error([message, "No changes were written by this edit call.",
					hint ?? "Read the target range again to obtain its exact current text.", recovery].join("\n\n"), { cause: error });
			}
		},
	});
}

/* ------------------------------------------------------------------ */
/* Composite grep: patterns[], paths[], mode=count|files, exclude[].   */
/* Absorbs the `cd X && grep … | head` chains seen in session logs.    */
/* ------------------------------------------------------------------ */

function registerCompositeGrep(pi: ExtensionAPI) {
	const prototype = createGrepToolDefinition(".");
	const baseParams = (prototype.parameters ?? {}) as Record<string, unknown>;

	pi.registerTool({
		...prototype,
		description:
			`${prototype.description} ` +
			"Use code_search when available for locating code by description; grep is for known text or regex patterns. " +
			"Also supports composite search in one call: `patterns` (several patterns at once, one section each), " +
			"`paths` (several directories/files; absolute paths work, so never cd in bash first), " +
			"`mode`=\"count\" (per-file match counts, like grep -c) or \"files\" (matching file paths, like grep -l), " +
			"and `exclude` (glob patterns to skip, like 'node_modules' or '*.jsonl').",
		promptGuidelines: [
			...(prototype.promptGuidelines ?? []),
			"Use grep for known exact identifiers, strings, error messages, or deliberate regex patterns; an unknown location is not an exact-match task.",
			"For locating code from a description, use code_search when available rather than trying a sequence of guessed grep patterns. If retrieval tools are unavailable, retain the grep/read fallback.",
			"For symbol relationships, prefer code_nav when available. For returned refs, use read_spans when available; for a known file, use read rather than searching again.",
			"Search any directory with grep's path/paths parameter (absolute paths allowed) — never run `cd` + grep in bash.",
			"Batch related searches into one grep call with patterns[] or paths[] instead of chaining greps in bash.",
			"Use grep with mode=count or mode=files instead of `grep -c` / `grep -rl` in bash.",
			"Use grep's exclude parameter instead of piping through `grep -v` in bash.",
		],
		parameters: {
			...baseParams,
			properties: {
				...((baseParams as { properties?: Record<string, unknown> }).properties ?? {}),
				patterns: Type.Optional(
					Type.Array(Type.String(), { description: "Multiple patterns to search in one call (OR semantics across sections). Overrides pattern." }),
				),
				paths: Type.Optional(
					Type.Array(Type.String(), { description: "Multiple directories/files to search in one call (absolute paths allowed). Overrides path." }),
				),
				mode: Type.Optional(
					Type.String({ description: "\"matches\" (default), \"count\" for per-file match counts, \"files\" for matching file paths only" }),
				),
				exclude: Type.Optional(
					Type.Array(Type.String(), { description: "Glob patterns to skip, e.g. [\"node_modules\", \"*.jsonl\"]" }),
				),
			},
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctxCwd(ctx as ToolCtxLike);
			const patterns = asStringArray(params?.patterns);
			const paths = asStringArray(params?.paths);
			const excludes = asStringArray(params?.exclude);
			const mode = params?.mode === "count" || params?.mode === "files" ? params.mode : "matches";
			const patternList = patterns.length > 0 ? patterns : [typeof params?.pattern === "string" ? params.pattern : ""];
			const pathList = paths.length > 0 ? paths : [typeof params?.path === "string" && params.path ? params.path : undefined];
			const simple =
				patternList.length === 1 && pathList.length === 1 && mode === "matches" && excludes.length === 0;
			if (simple) {
				return createGrepToolDefinition(cwd).execute(
					toolCallId,
					{ ...params, pattern: patternList[0], path: pathList[0] },
					signal,
					onUpdate,
					ctx,
				);
			}

			const base = createGrepToolDefinition(cwd);
			const baseLimit = typeof params?.limit === "number" ? params.limit : 100;
			// Over-scan when we post-filter, so excluded noise does not starve the cap.
			const scanLimit = excludes.length > 0 ? Math.min(1000, baseLimit * 4) : baseLimit;
			const sections: string[] = [];
			for (const pattern of patternList) {
				if (!pattern) continue;
				const perPathSections: string[] = [];
				for (const searchPath of pathList) {
					let text: string;
					try {
						const result = await base.execute(
							toolCallId,
							{
								pattern,
								path: searchPath,
								glob: params?.glob,
								ignoreCase: params?.ignoreCase,
								literal: params?.literal,
								context: mode === "matches" ? params?.context : undefined,
								limit: scanLimit,
							},
							signal,
							onUpdate,
							ctx,
						);
						text = resultText(result);
					} catch (error) {
						text = `(search failed: ${error instanceof Error ? error.message : String(error)})`;
					}
					const lines = parseGrepOutput(text);
					let body: string;
					if (mode === "count") body = grepCountSummary(lines);
					else if (mode === "files") body = grepFilesSummary(lines);
					else {
						const filtered = filterGrepLines(lines, excludes);
						body = filtered.length > 0 ? filtered.join("\n") : "No matches found";
					}
					if (pathList.length > 1) perPathSections.push(`--- in ${searchPath ?? "."} ---\n${body}`);
					else perPathSections.push(body);
				}
				if (patternList.length > 1) sections.push(`=== pattern: ${pattern} ===\n${perPathSections.join("\n")}`);
				else sections.push(perPathSections.join("\n"));
			}
			const output = capCompositeOutput(sections.length > 0 ? sections.join("\n\n") : "No matches found");
			return { content: [{ type: "text", text: output }] };
		},
		renderCall(args, theme, context) {
			const normalized = { ...(args as Record<string, unknown>) };
			if (normalized.pattern === undefined && Array.isArray(normalized.patterns)) {
				normalized.pattern = (normalized.patterns as string[]).join(" | ");
			}
			if (normalized.path === undefined && Array.isArray(normalized.paths)) {
				normalized.path = (normalized.paths as string[]).join(", ");
			}
			return prototype.renderCall?.(normalized, theme, context);
		},
	});
}

/* ------------------------------------------------------------------ */
/* Composite ls: paths[] lists several directories in one call.        */
/* ------------------------------------------------------------------ */

function registerCompositeLs(pi: ExtensionAPI) {
	const prototype = createLsToolDefinition(".");
	const baseParams = (prototype.parameters ?? {}) as Record<string, unknown>;

	pi.registerTool({
		...prototype,
		description:
			`${prototype.description} Also accepts \`paths\`: several directories in one call (absolute paths allowed).`,
		promptGuidelines: [
			...(prototype.promptGuidelines ?? []),
			"List several directories with ls's paths[] parameter instead of `ls a b c` or cd-chains in bash.",
		],
		parameters: {
			...baseParams,
			properties: {
				...((baseParams as { properties?: Record<string, unknown> }).properties ?? {}),
				paths: Type.Optional(
					Type.Array(Type.String(), { description: "Several directories to list in one call (absolute paths allowed). Overrides path." }),
				),
			},
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctxCwd(ctx as ToolCtxLike);
			const paths = asStringArray(params?.paths);
			if (paths.length === 0) {
				return createLsToolDefinition(cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			}
			const base = createLsToolDefinition(cwd);
			const sections: string[] = [];
			for (const dir of paths) {
				let text: string;
				try {
					const result = await base.execute(toolCallId, { ...params, path: dir, paths: undefined }, signal, onUpdate, ctx);
					text = resultText(result);
				} catch (error) {
					text = `(listing failed: ${error instanceof Error ? error.message : String(error)})`;
				}
				sections.push(`--- ${dir} ---\n${text}`);
			}
			return { content: [{ type: "text", text: capCompositeOutput(sections.join("\n\n")) }] };
		},
		renderCall(args, theme, context) {
			const normalized = { ...(args as Record<string, unknown>) };
			if (normalized.path === undefined && Array.isArray(normalized.paths)) {
				normalized.path = (normalized.paths as string[]).join(", ");
			}
			return prototype.renderCall?.(normalized, theme, context);
		},
	});
}

export default function (pi: ExtensionAPI) {
	const base = createReadToolDefinition(".");
	const baseParams = (base.parameters ?? {}) as Record<string, unknown>;
	pi.registerTool({
		...base,
		description:
			`${readToolDescription(base.description)} ` +
			"Also accepts `paths`: read several files in one call (one section per file) instead of cat-chaining them in bash.",
		parameters: {
			...baseParams,
			properties: {
				...((baseParams as { properties?: Record<string, unknown> }).properties ?? {}),
				paths: Type.Optional(
					Type.Array(Type.String(), { description: "Several files to read in one call, one section each. Ignores offset. Overrides path." }),
				),
			},
		},
		promptGuidelines: [
			...(base.promptGuidelines ?? []),
			"If a path is a directory, read lists it; prefer ls for directories and read for files.",
			"Do not page a file you already windowed. Use grep to locate a region; offset/limit only for a short window.",
			"Read several small files with read's paths[] parameter instead of `cat a b c` in bash.",
		],
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctxCwd(ctx);
			const paths = asStringArray(params?.paths);
			if (paths.length > 0) {
				const reader = createReadToolDefinition(cwd);
				const sections: string[] = [];
				for (const file of paths) {
					let text: string;
					try {
						const result = await reader.execute(toolCallId, { path: file, limit: params?.limit }, signal, onUpdate, ctx);
						text = rewriteReadToolText(resultText(result), params);
					} catch (error) {
						text = `(read failed: ${error instanceof Error ? error.message : String(error)})`;
					}
					sections.push(`=== ${file} ===\n${text}`);
				}
				return { content: [{ type: "text", text: capCompositeOutput(sections.join("\n\n")) }] };
			}
			const path = typeof params?.path === "string" ? params.path : "";
			const listing = path ? await readPathIfDirectory(path, cwd) : undefined;
			if (listing !== undefined) {
				return { content: [{ type: "text", text: listing }] };
			}
			const result = await createReadToolDefinition(cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			const content = Array.isArray(result?.content)
				? result.content.map((part: { type?: string; text?: string }) => (
					part?.type === "text" && typeof part.text === "string"
						? { ...part, text: rewriteReadToolText(part.text, params) }
						: part
				))
				: result?.content;
			return { ...result, content };
		},
	});
	registerCompositeGrep(pi);
	registerCompositeLs(pi);
	registerEditRecovery(pi);
}
