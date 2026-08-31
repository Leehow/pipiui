import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirname } from "node:path";
import {
  ExtensionHotReloader,
  extensionIdForChangedPath,
  extensionRootForChangedPath,
  isUnderRoot,
  selectHotRestartTargets,
  stringSetEquals,
  type HotReloadRoot,
  type HotRestartCandidate,
} from "../src/extension-hotreload.js";

/** Manifest-presence stub: the test declares which DIRECTORIES hold `pipiui-extension.json`. */
function fakeManifest(manifestDirs: readonly string[]) {
  const set = new Set(manifestDirs);
  return (manifestPath: string) => set.has(dirname(manifestPath));
}

function fakeIds(ids: Record<string, string>) {
  return (manifestPath: string) => ids[manifestPath] ?? null;
}

describe("isUnderRoot", () => {
  it("matches the root itself and path-component boundaries, not prefixes", () => {
    expect(isUnderRoot("/store", "/store")).toBe(true);
    expect(isUnderRoot("/store/objects/abc", "/store")).toBe(true);
    expect(isUnderRoot("/storehouse", "/store")).toBe(false);
    expect(isUnderRoot("/other/x", "/store")).toBe(false);
  });
});

describe("extensionIdForChangedPath (path → extension id per root kind)", () => {
  const roots = [
    "/proj/.pi/agent/extensions", // project
    "/appdata/pi-agent/extensions", // app
    "/appdata/pi-agent/extension-store/objects", // shared store
    "/resources/pipiui-runtime/extensions", // builtin
  ];
  const manifestDirs = [
    "/proj/.pi/agent/extensions/my-ext",
    "/appdata/pi-agent/extensions/app-ext",
    "/appdata/pi-agent/extension-store/objects/deadbeef/store-ext",
    "/resources/pipiui-runtime/extensions/builtin-ext",
  ];
  const ids: Record<string, string> = {
    "/proj/.pi/agent/extensions/my-ext/pipiui-extension.json": "my-ext",
    "/appdata/pi-agent/extensions/app-ext/pipiui-extension.json": "app-ext",
    "/appdata/pi-agent/extension-store/objects/deadbeef/store-ext/pipiui-extension.json": "store-ext",
    "/resources/pipiui-runtime/extensions/builtin-ext/pipiui-extension.json": "builtin-ext",
  };

  const map = (changedPath: string): string | null =>
    extensionIdForChangedPath(changedPath, roots, fakeIds(ids), fakeManifest(manifestDirs));

  it("project root: nearest manifest ancestor wins", () => {
    expect(map("/proj/.pi/agent/extensions/my-ext/agent/tools.ts")).toBe("my-ext");
    expect(map("/proj/.pi/agent/extensions/my-ext/pipiui-extension.json")).toBe("my-ext");
  });

  it("app root", () => {
    expect(map("/appdata/pi-agent/extensions/app-ext/app/panel.js")).toBe("app-ext");
  });

  it("shared store: content-addressed object dir containing the package", () => {
    expect(map("/appdata/pi-agent/extension-store/objects/deadbeef/store-ext/agent/run.ts")).toBe("store-ext");
  });

  it("builtin runtime checkout", () => {
    expect(map("/resources/pipiui-runtime/extensions/builtin-ext/agent/x.ts")).toBe("builtin-ext");
  });

  it("nested manifest dirs: inner one wins over outer", () => {
    const innerManifests = [...manifestDirs, "/proj/.pi/agent/extensions/my-ext/nested"];
    const innerIds = { ...ids, "/proj/.pi/agent/extensions/my-ext/nested/pipiui-extension.json": "nested-ext" };
    expect(
      extensionIdForChangedPath(
        "/proj/.pi/agent/extensions/my-ext/nested/agent/y.ts",
        roots,
        fakeIds(innerIds),
        fakeManifest(innerManifests),
      ),
    ).toBe("nested-ext");
  });

  it("changes outside every root and root-level files map to null", () => {
    expect(map("/somewhere/else/my-ext/agent/x.ts")).toBeNull();
    // inside a root but above any manifest dir
    expect(map("/proj/.pi/agent/extensions/loose-file.tmp")).toBeNull();
    expect(map("/appdata/pi-agent/extension-store/objects/deadbeef/store-ext.bak")).toBeNull();
  });

  it("unreadable manifest id → null (delete/rename mid-write)", () => {
    expect(
      extensionIdForChangedPath(
        "/proj/.pi/agent/extensions/my-ext/agent/x.ts",
        roots,
        () => null,
        fakeManifest(manifestDirs),
      ),
    ).toBeNull();
  });

  it("extensionRootForChangedPath returns the package dir", () => {
    expect(
      extensionRootForChangedPath(
        "/proj/.pi/agent/extensions/my-ext/agent/tools.ts",
        roots,
        fakeManifest(manifestDirs),
      ),
    ).toBe("/proj/.pi/agent/extensions/my-ext");
  });
});

describe("ExtensionHotReloader (burst → single emission)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const root = (path: string): HotReloadRoot[] => [{ kind: "project", path }];
  /** Test resolver: `/…/extensions/<id>/…` → `<id>` (no real fs in unit tests). */
  const testResolve = (changedPath: string): string | null =>
    changedPath.match(/\/extensions\/([^/]+)\//)?.[1] ?? null;

  it("a burst of events for one extension emits changed exactly once", () => {
    const roots = root("/proj/.pi/agent/extensions");
    const changed: string[] = [];
    const reloader = new ExtensionHotReloader({
      roots,
      debounceMs: 300,
      onChanged: (id) => changed.push(id),
      watchRoot: () => () => undefined,
      resolveExtensionId: testResolve,
    });
    reloader.start();
    for (let i = 0; i < 50; i += 1) {
      reloader.handleFileChange(`/proj/.pi/agent/extensions/my-ext/agent/file${i}.ts`);
    }
    expect(changed).toEqual([]);
    vi.advanceTimersByTime(299);
    expect(changed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changed).toEqual(["my-ext"]);
    reloader.stop();
  });

  it("continuing bursts coalesce: flush is pushed out, then capped by max-wait", () => {
    const changed: string[] = [];
    const reloader = new ExtensionHotReloader({
      roots: root("/proj/.pi/agent/extensions"),
      debounceMs: 300,
      onChanged: (id) => changed.push(id),
      watchRoot: () => () => undefined,
      resolveExtensionId: testResolve,
    });
    reloader.start();
    for (let burst = 0; burst < 20; burst += 1) {
      vi.advanceTimersByTime(200);
      reloader.handleFileChange(`/proj/.pi/agent/extensions/my-ext/agent/file${burst}.ts`);
    }
    // 20 × 200ms of continuous events: debounce kept sliding, max-wait (3s) flushed once.
    expect(changed).toEqual(["my-ext"]);
    reloader.stop();
  });

  it("different extensions in one burst each emit once", () => {
    const changed: string[] = [];
    const reloader = new ExtensionHotReloader({
      roots: root("/proj/.pi/agent/extensions"),
      debounceMs: 300,
      onChanged: (id) => changed.push(id),
      watchRoot: () => () => undefined,
      resolveExtensionId: testResolve,
    });
    reloader.start();
    reloader.handleFileChange("/proj/.pi/agent/extensions/a/agent/x.ts");
    reloader.handleFileChange("/proj/.pi/agent/extensions/b/agent/x.ts");
    reloader.handleFileChange("/proj/.pi/agent/extensions/a/app/y.js");
    vi.advanceTimersByTime(300);
    expect(changed).toEqual(["a", "b"]);
    reloader.stop();
  });

  it("injected watcher events flow through handleFileChange", () => {
    const changed: string[] = [];
    let notify: ((path: string) => void) | undefined;
    const reloader = new ExtensionHotReloader({
      roots: root("/proj/.pi/agent/extensions"),
      debounceMs: 300,
      onChanged: (id) => changed.push(id),
      watchRoot: (_root, onChange) => {
        notify = onChange;
        return () => undefined;
      },
      resolveExtensionId: testResolve,
    });
    reloader.start();
    notify?.("/proj/.pi/agent/extensions/my-ext/agent/x.ts");
    vi.advanceTimersByTime(300);
    expect(changed).toEqual(["my-ext"]);
    reloader.stop();
  });

  it("setRoots reconciles watchers and stopped instances emit nothing", () => {
    const changed: string[] = [];
    const watched: string[] = [];
    const reloader = new ExtensionHotReloader({
      roots: [],
      debounceMs: 300,
      onChanged: (id) => changed.push(id),
      watchRoot: (r) => {
        watched.push(r.path);
        return () => undefined;
      },
      resolveExtensionId: testResolve,
    });
    reloader.start();
    reloader.setRoots(root("/a"));
    expect(watched).toEqual(["/a"]);
    reloader.setRoots(root("/b"));
    expect(watched).toEqual(["/a", "/b"]);
    reloader.stop();
    reloader.handleFileChange("/b/ext/agent/x.ts");
    vi.advanceTimersByTime(1000);
    expect(changed).toEqual([]);
  });
});

describe("selectHotRestartTargets (busy deferral / burst dedup / untouched sessions)", () => {
  const candidate = (overrides: Partial<HotRestartCandidate>): HotRestartCandidate => ({
    sessionId: "s1",
    affected: true,
    busy: false,
    restartInFlight: false,
    ...overrides,
  });

  it("idle affected sessions restart now", () => {
    expect(selectHotRestartTargets([candidate({})])).toEqual({ restart: ["s1"], defer: [] });
  });

  it("busy sessions are deferred, not restarted", () => {
    expect(selectHotRestartTargets([candidate({ busy: true })])).toEqual({ restart: [], defer: ["s1"] });
  });

  it("an in-flight restart is never stacked (burst during install)", () => {
    expect(
      selectHotRestartTargets([candidate({ restartInFlight: true }), candidate({ sessionId: "s2" })]),
    ).toEqual({ restart: ["s2"], defer: [] });
  });

  it("unaffected sessions (unmounted / archived / availability unchanged) are untouched", () => {
    expect(selectHotRestartTargets([candidate({ affected: false })])).toEqual({ restart: [], defer: [] });
  });

  it("mixed batch sorts into the three buckets", () => {
    const batch: HotRestartCandidate[] = [
      candidate({ sessionId: "busy", busy: true }),
      candidate({ sessionId: "flying", restartInFlight: true }),
      candidate({ sessionId: "cold", affected: false }),
      candidate({ sessionId: "go" }),
    ];
    expect(selectHotRestartTargets(batch)).toEqual({ restart: ["go"], defer: ["busy"] });
  });
});

describe("stringSetEquals", () => {
  it("compares mount snapshots", () => {
    expect(stringSetEquals(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(stringSetEquals(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(stringSetEquals(new Set(), new Set())).toBe(true);
  });
});
