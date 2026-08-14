import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLedgerNote,
  bossLedgerNoteTool,
  BOSS_LEDGER_SECTIONS,
  insertUnderHeading,
  isBossLedgerSection,
} from "../../../resources/runtime/pi-ext/subagent/boss-note.ts";

const dirs: string[] = [];
async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boss-ledger-"));
  dirs.push(dir);
  return dir;
}
const ledgerOf = (cwd: string, key: string) => join(cwd, ".pi", "boss", `ledger-${key}.md`);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ledger_note section vocabulary", () => {
  it("exposes only the three sections whose content is the Boss's judgement", () => {
    expect(Object.keys(BOSS_LEDGER_SECTIONS)).toEqual(["decisions", "done", "risks"]);
  });

  it("refuses the runtime-owned tables, which are written from real events", () => {
    for (const name of ["tasks", "Tasks", "closeout", "## Decisions", "__proto__", "toString"]) {
      expect(isBossLedgerSection(name)).toBe(false);
    }
  });
});

describe("insertUnderHeading", () => {
  const doc = ["## Decisions", "- first", "", "## Tasks", "| a |", ""].join("\n");

  it("appends at the end of the section, keeping entries chronological", () => {
    expect(insertUnderHeading(doc, "## Decisions", "- second")?.split("\n").slice(0, 3))
      .toEqual(["## Decisions", "- first", "- second"]);
  });

  it("does not drift into the next section across the blank gap", () => {
    const updated = insertUnderHeading(doc, "## Decisions", "- second") ?? "";
    expect(updated.indexOf("- second")).toBeLessThan(updated.indexOf("## Tasks"));
  });

  it("leaves a ledger without that heading alone rather than repairing it by guesswork", () => {
    expect(insertUnderHeading("# Ledger\n", "## Decisions", "- x")).toBeUndefined();
  });
});

describe("appendLedgerNote", () => {
  it("seeds a well-formed ledger when the Boss records before it dispatches", async () => {
    const cwd = await project();
    const result = await appendLedgerNote({ mainCwd: cwd, sessionKey: "s1", section: "decisions", note: "chose the delegated route" });
    expect(result.ok).toBe(true);
    const content = await readFile(ledgerOf(cwd, "s1"), "utf-8");
    expect(content).toContain("- chose the delegated route");
    // The runtime's own row upserts must still find their headings in a Boss-seeded file.
    expect(content).toContain("| ID | title | role | wave | status | notes |");
    expect(content).toContain("## Closeout dispositions");
  });

  it("writes one line per call so the ledger stays scannable", async () => {
    const cwd = await project();
    await appendLedgerNote({ mainCwd: cwd, sessionKey: "s1", section: "risks", note: "auth  path\nis  unverified\n" });
    expect(await readFile(ledgerOf(cwd, "s1"), "utf-8")).toContain("- auth path is unverified");
  });

  it("cannot reach any file other than this session's ledger", async () => {
    const cwd = await project();
    await appendLedgerNote({ mainCwd: cwd, sessionKey: "mine", section: "done", note: "shipped" });
    expect(await readFile(ledgerOf(cwd, "mine"), "utf-8")).toContain("- shipped");
    // A different session key addresses a different file; there is no path parameter at all.
    await expect(readFile(ledgerOf(cwd, "theirs"), "utf-8")).rejects.toThrow();
  });

  it("reports a hand-mangled ledger instead of silently dropping the decision", async () => {
    const cwd = await project();
    await mkdir(join(cwd, ".pi", "boss"), { recursive: true });
    await writeFile(ledgerOf(cwd, "s1"), "# Ledger\nno headings here\n", "utf-8");
    const result = await appendLedgerNote({ mainCwd: cwd, sessionKey: "s1", section: "decisions", note: "important" });
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/## Decisions/);
  });

  it("reports a missing project root rather than guessing one", async () => {
    const result = await appendLedgerNote({ mainCwd: undefined, sessionKey: "s1", section: "done", note: "x" });
    expect(result.ok).toBe(false);
    expect(result.problem).toMatch(/PIPIUI_MAIN_CWD/);
  });

  it("rejects a note that is empty once normalized", async () => {
    const cwd = await project();
    const result = await appendLedgerNote({ mainCwd: cwd, sessionKey: "s1", section: "done", note: "   \n  " });
    expect(result.ok).toBe(false);
  });
});

describe("ledger_note tool definition", () => {
  it("declares the schema pi registers it with", () => {
    const tool = bossLedgerNoteTool({ mainCwd: "/tmp/x", sessionKey: "s1" });
    expect(tool.name).toBe("ledger_note");
    // A tool with no promptSnippet is invisible in pi's rendered tool list.
    expect(tool.promptSnippet).toBeTruthy();
    expect(Object.keys(tool.parameters.properties)).toEqual(["section", "note"]);
    expect(tool.parameters.additionalProperties).toBe(false);
    // There is deliberately no path parameter: the tool can address nothing but this ledger.
    expect(JSON.stringify(tool.parameters)).not.toMatch(/path|file|cwd/);
  });

  it("writes through and reports the file it touched", async () => {
    const cwd = await project();
    const tool = bossLedgerNoteTool({ mainCwd: cwd, sessionKey: "s1" });
    const ok = await tool.execute("call-1", { section: "decisions", note: "delegated the refactor" });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0].text).toContain(ledgerOf(cwd, "s1"));
    expect(await readFile(ledgerOf(cwd, "s1"), "utf-8")).toContain("- delegated the refactor");
  });

  it("returns a tool error for the runtime-owned tables rather than writing them", async () => {
    const cwd = await project();
    const tool = bossLedgerNoteTool({ mainCwd: cwd, sessionKey: "s1" });
    const bad = await tool.execute("call-1", { section: "tasks", note: "| hand-written row |" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("Valid sections");
    await expect(readFile(ledgerOf(cwd, "s1"), "utf-8")).rejects.toThrow();
  });

  it("surfaces a write failure as a tool error instead of a silent success", async () => {
    const tool = bossLedgerNoteTool({ mainCwd: undefined, sessionKey: "s1" });
    const failed = await tool.execute("call-1", { section: "done", note: "shipped" });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain("not written");
  });
});
