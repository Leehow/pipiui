import Foundation

/// App-owned Pi extension that keeps local discovery inside the active process cwd.
///
/// The App records explicit path mentions from actual composer submissions in a
/// session-scoped file. Nested Pi processes inherit that file but never write it,
/// so a subagent task prompt cannot grant itself broader filesystem access.
enum SearchScopeExtension {
    struct TurnGrant: Codable, Equatable {
        let version: Int
        let paths: [String]
    }

    private static let fileName = "pipiui-search-scope.ts"

    static func install(into dir: URL) -> String? {
        let file = dir.appendingPathComponent(fileName)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try source.write(to: file, atomically: true, encoding: .utf8)
            return file.path
        } catch {
            return nil
        }
    }

    static func grantFileURL(
        sessionKey: String,
        baseDirectory: URL? = nil
    ) -> URL {
        let base = baseDirectory ?? FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
            .appendingPathComponent("PipiUI", isDirectory: true)
            .appendingPathComponent("search-grants", isDirectory: true)
        return base.appendingPathComponent("\(stableKey(sessionKey)).json")
    }

    /// Replace (never merge) the current turn's grants. Calling this for a prompt
    /// without a path is what makes a previous turn's permission expire.
    static func recordUserTurn(
        _ prompt: String,
        sessionKey: String,
        projectRoot: URL,
        baseDirectory: URL? = nil
    ) throws {
        let resolved = explicitPathCandidates(in: prompt).compactMap {
            absoluteGrantPath($0, relativeTo: projectRoot)
        }
        var seen: Set<String> = []
        let paths = resolved.filter { seen.insert($0).inserted }
        let grant = TurnGrant(version: 1, paths: paths)
        let url = grantFileURL(sessionKey: sessionKey, baseDirectory: baseDirectory)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONEncoder().encode(grant)
        try data.write(to: url, options: .atomic)
    }

    static func resetTurnGrant(
        sessionKey: String,
        projectRoot: URL,
        baseDirectory: URL? = nil
    ) {
        try? recordUserTurn(
            "",
            sessionKey: sessionKey,
            projectRoot: projectRoot,
            baseDirectory: baseDirectory
        )
    }

    static func readGrantFile(at url: URL) throws -> TurnGrant {
        try JSONDecoder().decode(TurnGrant.self, from: Data(contentsOf: url))
    }

    /// Accept path-shaped text only: absolute paths, home-prefixed paths, and
    /// explicit parent-relative paths. Generic nouns and URLs are deliberately ignored.
    static func explicitPathCandidates(in prompt: String) -> [String] {
        let fullRange = NSRange(prompt.startIndex..<prompt.endIndex, in: prompt)
        let quotedPattern = #"(["'`])((?:\.\./|~/|\$HOME/|\$\{HOME\}/|/)[^"'`\r\n]+)\1"#
        let barePattern = #"(?:^|[\s(（\[{<])((?:\.\./|~/|\$HOME/|\$\{HOME\}/|/)[^\s"'`)\]}>）。，,;；!?！？]+)"#
        var candidates: [String] = []
        var quotedRanges: [NSRange] = []

        if let regex = try? NSRegularExpression(pattern: quotedPattern) {
            for match in regex.matches(in: prompt, range: fullRange) {
                quotedRanges.append(match.range)
                guard let range = Range(match.range(at: 2), in: prompt) else { continue }
                appendCandidate(String(prompt[range]), to: &candidates)
            }
        }

        if let regex = try? NSRegularExpression(pattern: barePattern) {
            for match in regex.matches(in: prompt, range: fullRange) {
                guard !quotedRanges.contains(where: { NSIntersectionRange($0, match.range).length > 0 }),
                      let range = Range(match.range(at: 1), in: prompt) else {
                    continue
                }
                appendCandidate(String(prompt[range]), to: &candidates)
            }
        }
        return candidates
    }

    private static func appendCandidate(_ raw: String, to candidates: inout [String]) {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let trailingPunctuation = CharacterSet(charactersIn: ".,;:!?，。；：！？、")
        while let scalar = trimmed.unicodeScalars.last,
              trailingPunctuation.contains(scalar) {
            trimmed.removeLast()
        }
        guard !trimmed.isEmpty,
              trimmed != "/",
              trimmed != "~",
              trimmed != "$HOME",
              trimmed != "${HOME}",
              !candidates.contains(trimmed) else {
            return
        }
        candidates.append(trimmed)
    }

    private static func absoluteGrantPath(_ raw: String, relativeTo projectRoot: URL) -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let expanded: String
        if raw == "~" || raw.hasPrefix("~/") {
            expanded = home + raw.dropFirst()
        } else if raw == "$HOME" || raw.hasPrefix("$HOME/") {
            expanded = home + raw.dropFirst("$HOME".count)
        } else if raw == "${HOME}" || raw.hasPrefix("${HOME}/") {
            expanded = home + raw.dropFirst("${HOME}".count)
        } else {
            expanded = raw
        }

        let url: URL
        if expanded.hasPrefix("/") {
            url = URL(fileURLWithPath: expanded)
        } else if expanded.hasPrefix("../") {
            url = projectRoot.appendingPathComponent(expanded)
        } else {
            return nil
        }
        return url.standardizedFileURL.path
    }

    private static func stableKey(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }

    private static let source = #"""
// Auto-generated by Pipi UI — do not edit (overwritten on every app launch).
// Project-scoped discovery guard. The human-composer grant file is written by
// ChatSession; nested processes inherit and read it but cannot widen it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PIPIUI_AGENT_DEPTH = Number.parseInt(process.env.PIPIUI_AGENT_DEPTH || "0", 10);
const GRANT_FILE = process.env.PIPIUI_SEARCH_GRANT_FILE;

const SEARCH_DISCIPLINE = `

## Local search scope
Search the current project first. Prefer targeted directories and globs over broad
discovery. The find, grep, and ls tools are restricted to this process's project or
worktree root. Do not automatically widen searches to the home directory, Music,
Pictures, or photo libraries. If project evidence is insufficient, explain the
evidence gap and ask the user to name the exact external path in the current turn.`;

export interface SearchPathDecision {
  allowed: boolean;
  target?: string;
  reason?: string;
}

function expandHome(raw: string): string {
  const home = os.homedir();
  if (raw === "~" || raw.startsWith("~/")) return home + raw.slice(1);
  if (raw === "$HOME" || raw.startsWith("$HOME/")) return home + raw.slice("$HOME".length);
  if (raw === "${HOME}" || raw.startsWith("${HOME}/")) {
    return home + raw.slice("${HOME}".length);
  }
  return raw;
}

/** Resolve every existing ancestor through realpath, preserving a missing suffix. */
function canonicalize(raw: string, base: string): string | null {
  try {
    const absolute = path.resolve(base, expandHome(raw));
    let cursor = absolute;
    const missing: string[] = [];
    while (!fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
    const real = fs.realpathSync.native(cursor);
    return path.resolve(real, ...missing);
  } catch {
    return null;
  }
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function canonicalRoot(cwd: string): string | null {
  return canonicalize(".", cwd);
}

export function evaluateSearchPath(
  rawPath: string,
  cwd: string = process.cwd(),
  grants: string[] = readTurnGrants(),
  targetBase: string = cwd,
): SearchPathDecision {
  const root = canonicalRoot(cwd);
  const target = canonicalize(rawPath || ".", targetBase);
  if (!root || !target) {
    return {
      allowed: false,
      reason: "Search target could not be resolved safely.",
    };
  }
  if (isContained(root, target)) return { allowed: true, target };

  for (const rawGrant of grants) {
    const grant = canonicalize(rawGrant, cwd);
    if (grant && isContained(grant, target)) return { allowed: true, target };
  }
  return {
    allowed: false,
    target,
    reason: "Search target is outside the current project.",
  };
}

function readTurnGrants(): string[] {
  if (!GRANT_FILE) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(GRANT_FILE, "utf-8")) as {
      version?: unknown;
      paths?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.paths)) return [];
    return parsed.paths.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function shellTokens(segment: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(segment)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function commandAndArgs(segment: string): { command: string; args: string[] } | null {
  const tokens = shellTokens(segment);
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  while (index < tokens.length && ["command", "sudo", "env"].includes(tokens[index])) {
    index += 1;
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  }
  if (index >= tokens.length) return null;
  return {
    command: path.basename(tokens[index]),
    args: tokens.slice(index + 1),
  };
}

function positionalArgs(args: string[]): string[] {
  return args.filter(
    (arg) =>
      arg !== "--" &&
      !arg.startsWith("-") &&
      !/^[<>]/.test(arg) &&
      !["2>&1", "1>&2"].includes(arg),
  );
}

function discoveryTargets(command: string, args: string[]): string[] | null {
  if (command === "find") {
    let index = 0;
    while (index < args.length) {
      const arg = args[index];
      if (arg === "--") {
        index += 1;
        break;
      }
      if (arg === "-H" || arg === "-L" || arg === "-P" || /^-O\d+$/.test(arg)) {
        index += 1;
        continue;
      }
      if (arg === "-D" || arg === "-O") {
        index += 2;
        continue;
      }
      break;
    }
    const targets: string[] = [];
    for (const arg of args.slice(index)) {
      if (arg === "!" || arg === "(" || arg.startsWith("-")) break;
      targets.push(arg);
    }
    return targets.length > 0 ? targets : ["."];
  }
  if (command === "fd") {
    const positional = positionalArgs(args);
    return positional.length >= 2 ? positional.slice(1) : ["."];
  }
  if (command === "rg") {
    const positional = positionalArgs(args);
    if (args.includes("--files")) return positional.length > 0 ? positional : ["."];
    return positional.length >= 2 ? positional.slice(1) : ["."];
  }
  if (command === "grep") {
    if (!args.some((arg) => /^-[^-]*[rR]/.test(arg) || arg === "--recursive")) return null;
    const positional = positionalArgs(args);
    return positional.length >= 2 ? positional.slice(1) : [];
  }
  if (command === "ls") {
    if (!args.some((arg) => /^-[^-]*R/.test(arg) || arg === "--recursive")) return null;
    const positional = positionalArgs(args);
    return positional.length > 0 ? positional : ["."];
  }
  return null;
}

function broadTargetReason(
  rawTarget: string,
  rootCwd: string,
  targetBase: string,
  grants: string[],
): string | null {
  const decision = evaluateSearchPath(rawTarget, rootCwd, grants, targetBase);
  if (decision.allowed || !decision.target) return null;
  const target = decision.target;
  const home = canonicalize(os.homedir(), rootCwd);
  const components = target
    .split(path.sep)
    .filter(Boolean)
    .map((component) => component.toLowerCase());
  const isMedia = components.some(
    (component) =>
      component === "music" ||
      component === "pictures" ||
      component.includes("photos library") ||
      component.endsWith(".photoslibrary"),
  );
  if (target === path.parse(target).root) return "filesystem root";
  if (home && target === home) return "home directory";
  if (isMedia) return "media library";
  return null;
}

export function bashBlockReason(
  commandText: string,
  cwd: string = process.cwd(),
  grants: string[] = readTurnGrants(),
): string | null {
  let effectiveCwd = canonicalRoot(cwd) ?? path.resolve(cwd);
  for (const segment of commandText.split(/\n|&&|\|\||[;|]/)) {
    const parsed = commandAndArgs(segment.trim());
    if (!parsed) continue;
    if (parsed.command === "cd") {
      const requested = positionalArgs(parsed.args)[0];
      if (requested) {
        const resolved = canonicalize(requested, effectiveCwd);
        if (resolved) effectiveCwd = resolved;
      }
      continue;
    }
    const targets = discoveryTargets(parsed.command, parsed.args);
    if (targets === null) continue;
    for (const target of targets) {
      const reason = broadTargetReason(target, cwd, effectiveCwd, grants);
      if (reason) return reason;
    }
  }
  return null;
}

function blockReason(detail: string): string {
  return (
    `Blocked by PipiUI search scope (${detail}). Search is limited to the current ` +
    "project/worktree. If external evidence is required, explicitly name the exact " +
    "external path in your current user turn, then retry."
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    // Stable, depth-independent policy text keeps prompt caching deterministic.
    // PIPIUI_AGENT_DEPTH is intentionally not used to create grants: only the App's
    // depth-0 human composer writes GRANT_FILE; children are read-only consumers.
    void PIPIUI_AGENT_DEPTH;
    if (event.systemPrompt.endsWith(SEARCH_DISCIPLINE)) return;
    return { systemPrompt: `${event.systemPrompt}${SEARCH_DISCIPLINE}` };
  });

  pi.on("tool_call", (event) => {
    if (event.toolName === "find" || event.toolName === "grep" || event.toolName === "ls") {
      const rawPath = (event.input as { path?: unknown }).path;
      if (rawPath !== undefined && typeof rawPath !== "string") {
        return { block: true, reason: blockReason("invalid path argument") };
      }
      const decision = evaluateSearchPath(rawPath ?? ".");
      if (!decision.allowed) {
        return { block: true, reason: blockReason(decision.reason ?? "outside target") };
      }
      return;
    }

    if (event.toolName === "bash") {
      const command = (event.input as { command?: unknown }).command;
      if (typeof command !== "string") return;
      const reason = bashBlockReason(command);
      if (reason) return { block: true, reason: blockReason(reason) };
    }
  });
}
"""#
}
