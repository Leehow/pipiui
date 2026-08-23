import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The agent definitions are the prompt a worker reads closest to its own decisions, so a tool
 * world enumerated here outranks the philosophy prefix in practice.
 *
 * Measured, not assumed: across seven workers in one session the split was 136 `grep` calls to
 * 11 `code_search`, with 31 of those greps (22%) returning nothing while `code_search` and
 * `find` returned nothing 0% of the time — and `repo_map` / `code_nav` / `read_spans` were
 * never called at all. The philosophy layer was being delivered the whole time. What these
 * prompts still said was that searching means `rg`, and that "three materially different
 * strategies" is satisfied by three keywords.
 */
const AGENTS = join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/pi-ext/agents");
const body = (name: string) => {
  const text = readFileSync(join(AGENTS, name, "AGENT.md"), "utf8");
  const parsed = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!parsed) throw new Error(`${name}/AGENT.md: frontmatter is unreadable`);
  return parsed[1];
};

const CODE_READERS = ["explore", "reviewer", "general-purpose"] as const;

describe("agent prompts do not steer around the retrieval tools", () => {
  it("never nominates a search tool inside a rule about what bash may do", () => {
    // Both bash rules named `rg` while listing read-only shell verbs. A worker reads that as
    // "searching is rg", which is the one sentence the retrieval discipline has to outrank.
    for (const name of CODE_READERS) {
      expect(body(name), `${name} nominates rg`).not.toMatch(/\brg\b/);
    }
  });

  it("spells out that a different strategy means a different kind of search", () => {
    for (const name of CODE_READERS) {
      expect(body(name), `${name} lacks the kind-vs-keyword rule`).toMatch(
        /different kind of search, not another keyword/,
      );
    }
  });

  it("tells the worker that finds its own code which tool answers which question", () => {
    // Only general-purpose reaches code it was not handed a file list for, and its prompt had
    // no sentence about locating code at all — the gap `grep` filled by default.
    const gp = body("general-purpose");
    expect(gp).toMatch(/`code_search` is right for an intent you\s*\n?cannot spell/);
    expect(gp).toMatch(/read_spans/);
    // The rule itself stays in the philosophy layer; these prompts point, they do not restate.
    expect(gp).not.toMatch(/second keyword is the tell/);
  });
});
