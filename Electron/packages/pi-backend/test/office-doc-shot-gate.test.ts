import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OFFICECLI_MCP_TOOL,
  OFFICE_DOC_SHOT_GATE_FAILED_MESSAGE,
  OFFICE_DOC_SHOT_GATE_FOLLOW_UP_LIMIT,
  OfficeDocShotLedger,
  bashInvokesOfficecli,
  formatViewScreenshotCommand,
  normalizeOfficeDocumentPath,
  parseOfficecliCommand,
  workerOfficeDocShotGateArgs,
} from "../../../resources/runtime/extensions/office-doc-shot-gate.ts";
import officeDocShotGateExtension from "../../../resources/runtime/extensions/pipiui-office-doc-shot-gate.ts";

const TOOL = OFFICECLI_MCP_TOOL;
const CWD = "/workspace/docs";

function existing(files: string[]) {
  const set = new Set(files.map((file) => normalizeOfficeDocumentPath(file, CWD)));
  return (absolute: string) => set.has(absolute);
}

function ledger(files: string[] = [`${CWD}/report.docx`]) {
  return new OfficeDocShotLedger(existing(files));
}

function view(file = "report.docx") {
  return `view ${file} screenshot --grid auto`;
}

function set(file = "report.docx") {
  return `set ${file} /body/p[1] --prop text=hi`;
}

describe("parseOfficecliCommand", () => {
  it("accepts string and argv, with or without a leading officecli token", () => {
    const stringForm = parseOfficecliCommand("officecli view report.docx screenshot --grid auto");
    const argvForm = parseOfficecliCommand(["view", "report.docx", "screenshot", "--grid", "auto"]);
    const quoted = parseOfficecliCommand('view "My Doc.docx" screenshot --grid auto');
    expect(stringForm).toMatchObject({ verb: "view", rawTarget: "report.docx", isQualifyingScreenshot: true });
    expect(argvForm).toMatchObject({ verb: "view", rawTarget: "report.docx", isQualifyingScreenshot: true });
    expect(quoted).toMatchObject({ rawTarget: "My Doc.docx", isQualifyingScreenshot: true });
  });

  it("rejects --page, missing grid, and non-auto grid as qualifying screenshots", () => {
    expect(parseOfficecliCommand("view report.docx screenshot --grid auto --page 1")?.isQualifyingScreenshot).toBe(false);
    expect(parseOfficecliCommand("view report.docx screenshot")?.isQualifyingScreenshot).toBe(false);
    expect(parseOfficecliCommand("view report.docx screenshot --grid 3")?.isQualifyingScreenshot).toBe(false);
    expect(parseOfficecliCommand("view report.docx text --grid auto")?.isQualifyingScreenshot).toBe(false);
  });

  it("classifies write verbs and treats merge output as the write target", () => {
    expect(parseOfficecliCommand("set report.docx /body/p[1]")?.isWrite).toBe(true);
    expect(parseOfficecliCommand(["add", "report.docx", "/body"])?.isWrite).toBe(true);
    expect(parseOfficecliCommand("create blank.docx")?.isCreate).toBe(true);
    expect(parseOfficecliCommand("merge template.docx out.docx")).toMatchObject({
      isWrite: true,
      rawTarget: "out.docx",
    });
    expect(parseOfficecliCommand("open report.docx")?.isWrite).toBe(false);
    expect(parseOfficecliCommand("save report.docx")?.isWrite).toBe(false);
    expect(parseOfficecliCommand("get report.docx /body")?.isWrite).toBe(false);
    expect(parseOfficecliCommand("help docx")?.isWrite).toBeFalsy();
  });
});

describe("OfficeDocShotLedger", () => {
  it("blocks a write to an existing file before a successful baseline", () => {
    const gate = ledger();
    const blocked = gate.beginCall({
      toolCallId: "w1",
      toolName: TOOL,
      input: { command: set() },
      cwd: CWD,
    });
    expect(blocked).toMatchObject({ action: "block", kind: "write" });
    if (blocked.action === "block") {
      expect(blocked.reason).toContain(formatViewScreenshotCommand("report.docx"));
    }
  });

  it("does not count a failed baseline screenshot", () => {
    const gate = ledger();
    expect(gate.beginCall({
      toolCallId: "s1",
      toolName: TOOL,
      input: { command: view() },
      cwd: CWD,
    }).action).toBe("allow");
    gate.finishCall({ toolCallId: "s1", isError: true });
    expect(gate.beginCall({
      toolCallId: "w1",
      toolName: TOOL,
      input: { command: set() },
      cwd: CWD,
    }).action).toBe("block");
  });

  it("allows a write after a successful baseline", () => {
    const gate = ledger();
    expect(gate.beginCall({
      toolCallId: "s1",
      toolName: TOOL,
      input: { command: ["view", "report.docx", "screenshot", "--grid", "auto"] },
      cwd: CWD,
    }).action).toBe("allow");
    gate.finishCall({ toolCallId: "s1", isError: false });
    expect(gate.beginCall({
      toolCallId: "w1",
      toolName: TOOL,
      input: { command: set() },
      cwd: CWD,
    }).action).toBe("allow");
  });

  it("blocks mixed inflight screenshot/write in both directions", () => {
    const gate = ledger();
    expect(gate.beginCall({
      toolCallId: "s1",
      toolName: TOOL,
      input: { command: view() },
      cwd: CWD,
    }).action).toBe("allow");
    const writeDuringShot = gate.beginCall({
      toolCallId: "w1",
      toolName: TOOL,
      input: { command: set() },
      cwd: CWD,
    });
    expect(writeDuringShot.action).toBe("block");
    if (writeDuringShot.action === "block") {
      expect(writeDuringShot.reason).toMatch(/screenshot .* in progress/i);
    }
    gate.finishCall({ toolCallId: "s1", isError: false });

    expect(gate.beginCall({
      toolCallId: "w2",
      toolName: TOOL,
      input: { command: set() },
      cwd: CWD,
    }).action).toBe("allow");
    const shotDuringWrite = gate.beginCall({
      toolCallId: "s2",
      toolName: TOOL,
      input: { command: view() },
      cwd: CWD,
    });
    expect(shotDuringWrite.action).toBe("block");
    if (shotDuringWrite.action === "block") {
      expect(shotDuringWrite.reason).toMatch(/write .* in progress/i);
    }
  });

  it("invalidates a final screenshot after a later successful write", () => {
    const gate = ledger();
    gate.beginCall({ toolCallId: "s1", toolName: TOOL, input: { command: view() }, cwd: CWD });
    gate.finishCall({ toolCallId: "s1", isError: false });
    gate.beginCall({ toolCallId: "w1", toolName: TOOL, input: { command: set() }, cwd: CWD });
    gate.finishCall({ toolCallId: "w1", isError: false });
    gate.beginCall({ toolCallId: "s2", toolName: TOOL, input: { command: view() }, cwd: CWD });
    gate.finishCall({ toolCallId: "s2", isError: false });
    expect(gate.pendingFinalPaths()).toEqual([]);
    gate.beginCall({ toolCallId: "w2", toolName: TOOL, input: { command: set() }, cwd: CWD });
    gate.finishCall({ toolCallId: "w2", isError: false });
    expect(gate.pendingFinalPaths()).toEqual(["report.docx"]);
  });

  it("keeps documents isolated from each other", () => {
    const gate = ledger([`${CWD}/a.docx`, `${CWD}/b.docx`]);
    gate.beginCall({ toolCallId: "sa", toolName: TOOL, input: { command: view("a.docx") }, cwd: CWD });
    gate.finishCall({ toolCallId: "sa", isError: false });
    expect(gate.beginCall({
      toolCallId: "wa",
      toolName: TOOL,
      input: { command: set("a.docx") },
      cwd: CWD,
    }).action).toBe("allow");
    expect(gate.beginCall({
      toolCallId: "wb",
      toolName: TOOL,
      input: { command: set("b.docx") },
      cwd: CWD,
    }).action).toBe("block");
  });

  it("lets create skip baseline for a new file, but still requires a final screenshot", () => {
    const created = new Set<string>();
    const gate = new OfficeDocShotLedger((absolute) => created.has(absolute));
    expect(gate.beginCall({
      toolCallId: "c1",
      toolName: TOOL,
      input: { command: "create blank.docx" },
      cwd: CWD,
    }).action).toBe("allow");
    created.add(normalizeOfficeDocumentPath("blank.docx", CWD)!);
    gate.finishCall({ toolCallId: "c1", isError: false });
    expect(gate.pendingFinalPaths()).toEqual(["blank.docx"]);
    expect(gate.beginCall({
      toolCallId: "w1",
      toolName: TOOL,
      input: { command: set("blank.docx") },
      cwd: CWD,
    }).action).toBe("allow");
  });

  it("treats create of an existing target or --force as an existing-file write", () => {
    const gate = ledger([`${CWD}/report.docx`]);
    expect(gate.beginCall({
      toolCallId: "c1",
      toolName: TOOL,
      input: { command: "create report.docx" },
      cwd: CWD,
    }).action).toBe("block");
    expect(gate.beginCall({
      toolCallId: "c2",
      toolName: TOOL,
      input: { command: "create report.docx --force" },
      cwd: CWD,
    }).action).toBe("block");
  });

  it("resets on a new human task and ignores extension follow-up", () => {
    const gate = ledger();
    gate.beginCall({ toolCallId: "s1", toolName: TOOL, input: { command: view() }, cwd: CWD });
    gate.finishCall({ toolCallId: "s1", isError: false });
    gate.resetHumanTask();
    expect(gate.beginCall({
      toolCallId: "w1",
      toolName: TOOL,
      input: { command: set() },
      cwd: CWD,
    }).action).toBe("block");
  });

  it("blocks bash officecli bypasses", () => {
    const gate = ledger();
    const blocked = gate.beginCall({
      toolCallId: "b1",
      toolName: "bash",
      input: { command: "officecli set report.docx /body/p[1] --prop text=x" },
      cwd: CWD,
    });
    expect(blocked.action).toBe("block");
    expect(bashInvokesOfficecli("echo officecli")).toBe(false);
    expect(bashInvokesOfficecli("/usr/local/bin/officecli view report.docx screenshot --grid auto")).toBe(true);
  });
});

describe("pipiui-office-doc-shot-gate extension", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  type Handler = (event: any, ctx?: any) => unknown;
  async function load() {
    const handlers = new Map<string, Handler>();
    const sendMessage = vi.fn();
    const pi = {
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
      }),
      sendMessage,
    };
    officeDocShotGateExtension(pi as never);
    return { handlers, sendMessage, pi };
  }

  function ctx(cwd: string) {
    return { cwd };
  }

  it("wires the hard gate through tool_call / tool_result / input / agent_end", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-office-shot-"));
    await writeFile(join(root, "report.docx"), "doc");
    const { handlers, sendMessage } = await load();
    const cwd = root;

    await handlers.get("input")?.({ source: "interactive", text: "edit the report" }, ctx(cwd));

    const blocked = await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "w0",
      input: { command: set() },
    }, ctx(cwd));
    expect(blocked).toMatchObject({ block: true });
    expect(String((blocked as { reason: string }).reason)).toContain("screenshot --grid auto");

    await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "s1",
      input: { command: view() },
    }, ctx(cwd));
    await handlers.get("tool_result")?.({
      toolName: TOOL,
      toolCallId: "s1",
      input: { command: view() },
      isError: false,
    }, ctx(cwd));

    const allowed = await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "w1",
      input: { command: set() },
    }, ctx(cwd));
    expect(allowed).toBeUndefined();
    await handlers.get("tool_result")?.({
      toolName: TOOL,
      toolCallId: "w1",
      input: { command: set() },
      isError: false,
    }, ctx(cwd));

    await handlers.get("agent_end")?.({ messages: [] }, ctx(cwd));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "pipiui-office-doc-shot-gate",
        content: expect.stringContaining("screenshot --grid auto"),
        display: true,
      }),
      { triggerTurn: true, deliverAs: "followUp" },
    );

    await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "s2",
      input: { command: view() },
    }, ctx(cwd));
    await handlers.get("tool_result")?.({
      toolName: TOOL,
      toolCallId: "s2",
      input: { command: view() },
      isError: false,
    }, ctx(cwd));
    sendMessage.mockClear();
    await handlers.get("agent_end")?.({ messages: [] }, ctx(cwd));
    expect(sendMessage).not.toHaveBeenCalled();

    const afterFinal = await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "w2",
      input: { command: set() },
    }, ctx(cwd));
    expect(afterFinal).toBeUndefined();
    await handlers.get("tool_result")?.({
      toolName: TOOL,
      toolCallId: "w2",
      input: { command: set() },
      isError: false,
    }, ctx(cwd));
    await handlers.get("agent_end")?.({ messages: [] }, ctx(cwd));
    expect(sendMessage).toHaveBeenCalled();

    await handlers.get("input")?.({ source: "extension", text: "follow-up" }, ctx(cwd));
    const stillOpen = await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "w3",
      input: { command: set() },
    }, ctx(cwd));
    expect(stillOpen).toBeUndefined();

    await handlers.get("input")?.({ source: "rpc", text: "new human task" }, ctx(cwd));
    const resetBlock = await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "w4",
      input: { command: set() },
    }, ctx(cwd));
    expect(resetBlock).toMatchObject({ block: true });
  });

  it("announces a visible gate failure after bounded follow-up retries", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-office-shot-fail-"));
    await writeFile(join(root, "report.docx"), "doc");
    const { handlers, sendMessage } = await load();
    await handlers.get("input")?.({ source: "interactive", text: "edit" }, ctx(root));
    await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "s1",
      input: { command: view() },
    }, ctx(root));
    await handlers.get("tool_result")?.({ toolCallId: "s1", isError: false }, ctx(root));
    await handlers.get("tool_call")?.({
      toolName: TOOL,
      toolCallId: "w1",
      input: { command: set() },
    }, ctx(root));
    await handlers.get("tool_result")?.({ toolCallId: "w1", isError: false }, ctx(root));

    for (let i = 0; i < OFFICE_DOC_SHOT_GATE_FOLLOW_UP_LIMIT; i++) {
      await handlers.get("agent_end")?.({}, ctx(root));
    }
    expect(sendMessage).toHaveBeenCalledTimes(OFFICE_DOC_SHOT_GATE_FOLLOW_UP_LIMIT);
    sendMessage.mockClear();
    await handlers.get("agent_end")?.({}, ctx(root));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(OFFICE_DOC_SHOT_GATE_FAILED_MESSAGE),
        display: true,
      }),
      { deliverAs: "followUp" },
    );
    sendMessage.mockClear();
    await handlers.get("agent_end")?.({}, ctx(root));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("is the same worker -e gate the subagent spawn uses", async () => {
    const source = await readFile(new URL("../../../resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
    expect(source).toContain('if (PIPIUI_OFFICE_DOC_SHOT_GATE_EXT && !options?.computerWorker) args.push("-e", PIPIUI_OFFICE_DOC_SHOT_GATE_EXT)');
    expect(workerOfficeDocShotGateArgs("/runtime/extensions/pipiui-office-doc-shot-gate.ts")).toEqual([
      "-e",
      "/runtime/extensions/pipiui-office-doc-shot-gate.ts",
    ]);
    expect(workerOfficeDocShotGateArgs("/runtime/extensions/pipiui-office-doc-shot-gate.ts", { computerWorker: true })).toEqual([]);
  });
});
