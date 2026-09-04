import { describe, expect, it } from "vitest";
import {
  OrphanNoticeStore,
  formatOrphanNotice,
  type OrphanedWorkerNotice,
} from "../src/orphan-notice.js";
import { hotRestartBusy } from "../src/extension-hotreload.js";

const swept: OrphanedWorkerNotice[] = [
  {
    agentId: "market-package",
    runId: "mtma0xjb-82c8b7609a189f01",
    title: "Marketplace 协议+CLI+站点",
    state: "interrupted",
    closeout: "运行宿主不可用且超过 10 分钟无状态观察；按中断成果保留",
  },
  {
    agentId: "client-overlay",
    runId: "mtma0xly-e439afa07d89ba70",
    state: "interrupted",
    closeout: "运行宿主不可用且超过 10 分钟无状态观察；按中断成果保留",
  },
];

describe("orphan closeout notice", () => {
  it("tells the Boss the signal it is waiting for will never come", () => {
    const text = formatOrphanNotice(swept);
    expect(text).toContain("[subagent-orphaned]");
    expect(text).toContain("2 background worker(s)");
    expect(text).toContain("will never send a completion signal");
    expect(text).toContain("do not keep waiting");
  });

  it("passes the host's own verdict through verbatim, with identities to act on", () => {
    const text = formatOrphanNotice(swept);
    expect(text).toContain("market-package");
    expect(text).toContain('"Marketplace 协议+CLI+站点"');
    expect(text).toContain("mtma0xly-e439afa07d89ba70");
    expect(text).toContain("运行宿主不可用且超过 10 分钟无状态观察；按中断成果保留");
    // A next step, not just bad news.
    expect(text).toContain("subagent_status({agentId, full:true})");
    expect(text).toContain("re-dispatch");
    // Host status is data, never an instruction channel.
    expect(text).toContain("not a new user request");
  });

  it("renders nothing for an empty sweep", () => {
    expect(formatOrphanNotice([])).toBe("");
  });

  it("delivers once, to the session that dispatched the worker", () => {
    const store = new OrphanNoticeStore();
    store.record("session-a", swept[0]);
    store.record("session-b", swept[1]);

    expect(store.hasPending("session-a")).toBe(true);
    const first = store.takePending("session-a");
    expect(first).toContain("market-package");
    expect(first).not.toContain("client-overlay");
    // Taken means delivered: a later prompt must not repeat it.
    expect(store.takePending("session-a")).toBeUndefined();
    expect(store.hasPending("session-a")).toBe(false);
    expect(store.takePending("session-b")).toContain("client-overlay");
  });

  it("keeps the first verdict when a later sweep revisits the same run", () => {
    const store = new OrphanNoticeStore();
    store.record("s", swept[0]);
    store.record("s", { ...swept[0], closeout: "第二次扫场的说法" });
    const text = store.takePending("s") ?? "";
    expect(text).toContain("运行宿主不可用");
    expect(text).not.toContain("第二次扫场");
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(1);
  });

  it("a re-dispatch of the same agentId is a separate closeout", () => {
    const store = new OrphanNoticeStore();
    store.record("s", swept[0]);
    store.record("s", { ...swept[0], runId: "mtma9zzz-secondrun" });
    const text = store.takePending("s") ?? "";
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
  });

  it("ignores rows with no session or no identity", () => {
    const store = new OrphanNoticeStore();
    store.record(undefined, swept[0]);
    store.record("", swept[0]);
    store.record("s", { ...swept[0], runId: "  " });
    expect(store.hasPending("s")).toBe(false);
  });

  it("drops what a torn-down session was owed", () => {
    const store = new OrphanNoticeStore();
    store.record("s", swept[0]);
    store.clearSession("s");
    expect(store.takePending("s")).toBeUndefined();
    store.record("s", swept[0]);
    store.clearAll();
    expect(store.takePending("s")).toBeUndefined();
  });
});

describe("hot restart busy predicate", () => {
  const idle = {
    turnActive: false,
    spawnInitializing: false,
    compactionHoldsQueue: false,
    liveBackgroundAgents: false,
  };

  it("an idle session with nothing running restarts now", () => {
    expect(hotRestartBusy(idle)).toBe(false);
  });

  it("keeps deferring for the reasons it always did", () => {
    expect(hotRestartBusy({ ...idle, turnActive: true })).toBe(true);
    expect(hotRestartBusy({ ...idle, spawnInitializing: true })).toBe(true);
    expect(hotRestartBusy({ ...idle, compactionHoldsQueue: true })).toBe(true);
  });

  it("an idle session whose background wave is still running is busy", () => {
    // The regression this exists for: the workers are children of the Pi child,
    // so a restart between turns killed a live wave with no completion signal.
    expect(hotRestartBusy({ ...idle, liveBackgroundAgents: true })).toBe(true);
  });
});
