import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENT_KIND_BY_EXTENSION, documentKindForName, type DocumentKind } from "@pipi/host-api";
import {
  OFFICE_DOCUMENT_EXTENSIONS,
  isOfficeDocumentPath,
} from "../../../resources/runtime/extensions/office-doc-shot-gate.ts";

/**
 * T1 freeze for plan office-extension-refactor-v1: the machine-readable Office
 * format matrix (docs/office/format-matrix.json) is the contract that T4/T6 use
 * as a compatibility corpus input. These tests fail whenever the shipped
 * classification map, the screenshot-gate extension list, or the promised tiers
 * drift away from the frozen matrix.
 */

type MatrixRow = {
  extension: string;
  tier: string;
  documentKind: DocumentKind | null;
  previewContract: string;
  editContract: string;
  fallbackContract: string;
  macroExecutionPolicy: string;
  macroContainer: boolean;
  externalOpen: boolean;
  shotGateCovered: boolean;
};

const matrix = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../docs/office/format-matrix.json"), "utf8"),
) as { version: number; formats: MatrixRow[] };

const rows = matrix.formats;
const byExtension = new Map(rows.map((row) => [row.extension, row]));

const OFFICE_KINDS = new Set<DocumentKind>(["word", "spreadsheet", "presentation"]);
const ALLOWED_TIERS = new Set([
  "tier1-guaranteed-edit",
  "macro-preview-preserve",
  "tier2-best-effort-preview",
  "gate-only-template",
]);
const ALLOWED_PREVIEW = new Set(["native-office-viewer", "best-effort-office-viewer", "unsupported-deterministic-error"]);
const ALLOWED_EDIT = new Set(["guaranteed", "preserve-only", "not-promised"]);
const ALLOWED_FALLBACK = new Set(["anydoc-markdown", "none"]);

function classifiedOfficeExtensions(): Set<string> {
  const extensions = new Set<string>();
  for (const [extension, kind] of Object.entries(DOCUMENT_KIND_BY_EXTENSION)) {
    if (OFFICE_KINDS.has(kind)) extensions.add(extension);
  }
  return extensions;
}

describe("office format matrix (frozen baseline)", () => {
  it("is structurally valid: unique dotted extensions and only promised enum values", () => {
    expect(matrix.version).toBe(1);
    expect(rows.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const row of rows) {
      expect(row.extension, "extension must be unique and dot-prefixed").toMatch(/^\.[a-z]+$/);
      expect(seen.has(row.extension)).toBe(false);
      seen.add(row.extension);
      expect(ALLOWED_TIERS.has(row.tier)).toBe(true);
      expect(ALLOWED_PREVIEW.has(row.previewContract)).toBe(true);
      expect(ALLOWED_EDIT.has(row.editContract)).toBe(true);
      expect(ALLOWED_FALLBACK.has(row.fallbackContract)).toBe(true);
      expect(row.macroExecutionPolicy).toBe("never-execute");
      expect(typeof row.macroContainer).toBe("boolean");
      expect(typeof row.externalOpen).toBe("boolean");
      expect(typeof row.shotGateCovered).toBe("boolean");
    }
  });

  it("matches the shipped document classification for every matrix extension", () => {
    for (const row of rows) {
      expect(documentKindForName(`probe${row.extension}`)).toBe(row.documentKind);
    }
  });

  it("covers exactly the office-classified extensions of DOCUMENT_KIND_BY_EXTENSION", () => {
    const classified = classifiedOfficeExtensions();
    const matrixClassified = new Set(rows.filter((row) => row.documentKind !== null).map((row) => row.extension));
    expect([...matrixClassified].sort()).toEqual([...classified].sort());
  });

  it("matches the screenshot-gate extension list in both directions", () => {
    const gateList = new Set(OFFICE_DOCUMENT_EXTENSIONS);
    for (const extension of gateList) {
      const row = byExtension.get(extension);
      expect(row, `gate extension ${extension} must appear in the matrix`).toBeTruthy();
      expect(row?.shotGateCovered, `gate extension ${extension} must be marked shotGateCovered`).toBe(true);
      expect(isOfficeDocumentPath(`probe${extension}`)).toBe(true);
    }
    for (const row of rows) {
      if (row.shotGateCovered) {
        expect(gateList.has(row.extension), `${row.extension} claims gate coverage but is not in OFFICE_DOCUMENT_EXTENSIONS`).toBe(true);
      }
    }
  });

  it("promises tier-1 edit guarantees only for .docx/.xlsx/.pptx", () => {
    const tier1 = rows.filter((row) => row.tier === "tier1-guaranteed-edit");
    expect(tier1.map((row) => row.extension)).toEqual([".docx", ".xlsx", ".pptx"]);
    for (const row of tier1) {
      expect(row.editContract).toBe("guaranteed");
      expect(row.previewContract).toBe("native-office-viewer");
      expect(row.fallbackContract).toBe("anydoc-markdown");
      expect(row.externalOpen).toBe(true);
    }
  });

  it("keeps macro containers preview/preserve-only with VBA never executed", () => {
    const macro = rows.filter((row) => row.tier === "macro-preview-preserve");
    expect(macro.map((row) => row.extension)).toEqual([".docm", ".xlsm", ".pptm"]);
    for (const row of macro) {
      expect(row.editContract).toBe("preserve-only");
      expect(row.macroContainer).toBe(true);
      expect(row.macroExecutionPolicy).toBe("never-execute");
    }
  });

  it("keeps legacy/open formats best-effort: no edit promise, fallback + external open stay available", () => {
    for (const row of rows.filter((row) => row.tier === "tier2-best-effort-preview")) {
      expect(row.editContract, `${row.extension} must not promise editing`).toBe("not-promised");
      expect(row.previewContract).toBe("best-effort-office-viewer");
      expect(row.fallbackContract).toBe("anydoc-markdown");
      expect(row.externalOpen).toBe(true);
      expect(row.documentKind).not.toBeNull();
    }
  });

  it("documents gate-only templates as deterministically unsupported in the panel", () => {
    const templates = rows.filter((row) => row.tier === "gate-only-template");
    expect(templates.length).toBeGreaterThan(0);
    for (const row of templates) {
      expect(row.documentKind).toBeNull();
      expect(documentKindForName(`probe${row.extension}`)).toBeNull();
      expect(row.previewContract).toBe("unsupported-deterministic-error");
      expect(row.fallbackContract).toBe("none");
      expect(row.externalOpen).toBe(false);
      expect(row.shotGateCovered).toBe(true);
    }
  });

  it("exposes external open exactly for extensions the host would classify", () => {
    // safeLocalDocumentPath (apps/electron/src/main/external-document.ts) allows the
    // OS-default open only when documentKindForName returns a kind.
    for (const row of rows) {
      expect(row.externalOpen).toBe(row.documentKind !== null);
    }
  });
});
