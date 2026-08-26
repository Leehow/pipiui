// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseOfficeCommand, isQualifyingScreenshot } from "../agent/command.js";
import { parseOfficecliCommand } from "../../../resources/runtime/extensions/office-doc-shot-gate.ts";

const cases: Array<{ command: string | string[]; qualify: boolean; note: string }> = [
  { command: "view report.docx screenshot --grid auto", qualify: true, note: "canonical whole-document" },
  { command: ["view", "report.docx", "screenshot", "--grid", "auto"], qualify: true, note: "argv canonical" },
  { command: "officecli view report.docx screenshot --grid auto", qualify: true, note: "prefixed" },
  { command: 'view "My Doc.docx" screenshot --grid auto', qualify: true, note: "quoted" },
  { command: "view report.docx screenshot --grid auto --page 1", qualify: false, note: "page-specific" },
  { command: ["view", "report.docx", "screenshot", "--grid", "auto", "--page"], qualify: false, note: "bare --page" },
  { command: "view report.docx screenshot", qualify: false, note: "missing grid" },
  { command: "view report.docx screenshot --grid 3", qualify: false, note: "non-auto grid" },
  { command: "view report.docx text --grid auto", qualify: false, note: "not screenshot" },
  { command: "view report.docx screenshot --grid auto --range Sheet1!A1", qualify: false, note: "range clip" },
];

describe("qualifying screenshot parity with office-doc-shot-gate", () => {
  for (const row of cases) {
    it(`${row.note}: ${JSON.stringify(row.command)}`, () => {
      const gate = parseOfficecliCommand(row.command);
      const ours = parseOfficeCommand(row.command);
      expect(ours.isQualifyingScreenshot).toBe(row.qualify);
      expect(gate?.isQualifyingScreenshot ?? false).toBe(row.qualify);
      expect(ours.isQualifyingScreenshot).toBe(gate?.isQualifyingScreenshot ?? false);
    });
  }

  it("exports the same predicate used by the adapter", () => {
    expect(isQualifyingScreenshot("view", ["view", "a.docx", "screenshot"], new Map([["grid", "auto"]]))).toBe(true);
    expect(isQualifyingScreenshot("view", ["view", "a.docx", "screenshot"], new Map([["grid", "auto"], ["page", true]]))).toBe(false);
  });
});

describe("strict command lexer", () => {
  it("rejects unterminated quotes and never invokes a shell", () => {
    expect(() => parseOfficeCommand('view "a.docx')).toThrow(/unterminated quote/);
    expect(() => parseOfficeCommand("view 'a.docx")).toThrow(/unterminated quote/);
  });

  it("preserves argv tokens exactly without trim", () => {
    const parsed = parseOfficeCommand(["view", " a.docx"]);
    expect(parsed.argv).toEqual(["view", " a.docx"]);
    expect(parsed.pathSpecs[0]?.raw).toBe(" a.docx");
  });

  it("accepts validate grammar", () => {
    const parsed = parseOfficeCommand(["validate", "report.docx"]);
    expect(parsed.verb).toBe("validate");
    expect(parsed.isWrite).toBe(false);
    expect(parsed.pathSpecs).toEqual([{ raw: "report.docx", mustExist: true, requireOfficeExtension: true }]);
  });
});
