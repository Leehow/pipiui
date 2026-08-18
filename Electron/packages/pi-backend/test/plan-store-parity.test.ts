import { describe, expect, it } from "vitest";
import { planStoreFileName, planStorePath } from "../src/plan-store.js";

/**
 * The plan store has two halves that cannot share a module: the extension runs
 * inside pi and writes the file, this host package reads it. If their filename
 * rules ever drift, the panel silently shows an empty plan for a session that
 * has one — so pin them to each other here.
 *
 * The import specifier is written as a literal on purpose: a variable specifier
 * is not statically analyzable and fails to resolve under this vite/vitest.
 */
const extension = await import("../../../resources/runtime/extensions/pipiui-plan.ts");

describe("plan store filename parity", () => {
  it("agrees with the extension for a normal session id", () => {
    const sessionId = "2026-08-18T02-31-44-abc123";
    expect(planStoreFileName(sessionId)).toBe(extension.storeFileName(sessionId));
    expect(planStoreFileName(sessionId)).toBe(`${sessionId}.json`);
  });

  it("agrees on the legacy name when no session id is supplied", () => {
    expect(planStoreFileName(undefined)).toBe(extension.storeFileName(""));
    expect(planStoreFileName(undefined)).toBe("current.json");
  });

  it("agrees on stripping path separators out of a hostile session id", () => {
    for (const hostile of ["../../etc/passwd", "a/b", "..", "with space", "sess:1"]) {
      expect(planStoreFileName(hostile)).toBe(extension.storeFileName(hostile));
    }
    // Whatever it mangles to, a traversal attempt must stay inside the plans directory.
    const escaped = planStorePath("/work/project", "../../etc/passwd");
    expect(escaped.startsWith("/work/project/.pi/plans/")).toBe(true);
    expect(planStoreFileName("../../etc/passwd")).not.toContain("/");
  });

  it("puts two sessions of one work tree in separate files", () => {
    expect(planStorePath("/work/project", "session-a")).not.toBe(planStorePath("/work/project", "session-b"));
    expect(planStorePath("/work/project", "session-a")).toBe("/work/project/.pi/plans/session-a.json");
  });
});
