import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { symbolLayer } from "./hooks.js";
import { SeenRangeLedger } from "./ledger.js";
import { executeRepoMap } from "./map-tool.js";
import { RefRegistry } from "./protocol.js";
import { executeReadSpans } from "./read-spans.js";

const DEMO_FILE = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of demo`).join("\n") + "\n";

async function withFixture<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cr-map-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "demo.ts"), DEMO_FILE, "utf8");
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Installs a fake repo_map hook and restores any prior one afterwards. */
async function withFakeRepoMap<T>(
  fn: NonNullable<typeof symbolLayer.repoMap>,
  body: () => Promise<T>,
): Promise<T> {
  const prev = symbolLayer.repoMap;
  symbolLayer.repoMap = fn;
  try {
    return await body();
  } finally {
    if (prev) symbolLayer.repoMap = prev;
    else delete symbolLayer.repoMap;
  }
}

test("repo_map tool path returns bounded previews under stable refs", async () => {
  await withFixture(async (root) =>
    withFakeRepoMap(
      async ({ projectRoot }) => {
        assert.equal(projectRoot, root);
        return [
          { path: "src/demo.ts", startLine: 10, endLine: 30, symbol: "demoTop", score: 5 },
          { path: "src/demo.ts", startLine: 31, endLine: 34, score: 2 },
        ];
      },
      async () => {
        const result = await executeRepoMap({
          projectRoot: root,
          registry: new RefRegistry(),
          tokenBudget: 4000,
        });
        assert.equal(result.details.degraded, false);
        assert.equal(result.details.kind, "code-retrieval.map");
        const refs = result.details.hits.map((hit) => hit.ref);
        assert.deepEqual(refs, ["R1", "R2"], "refs stay stable");
        const lines = result.content[0]!.text.split("\n");
        const r1 = lines.findIndex((line) => line.startsWith("R1 "));
        const previewLine = lines.findIndex((line) => line.includes("line 10 of demo"));
        const r2 = lines.findIndex((line) => line.startsWith("R2 "));
        assert.ok(r1 >= 0 && r2 > r1);
        assert.ok(previewLine > r1 && previewLine < r2, "preview belongs under R1");
        // Bounded: at most ~6 numbered lines before the next ref.
        const block = lines.slice(r1, r2).filter((line) => /\| /.test(line));
        assert.ok(block.length <= 6, `expected ≤6 preview lines, got ${block.length}`);
        assert.match(lines.join("\n"), /lines \d+–\d+ not shown; read_spans R1/);
        assert.match(lines.join("\n"), /inline preview\(s\)/);
      },
    ),
  );
});

test("evaluator can import and run the SAME implementation the registered tool delegates to", async () => {
  // index.ts wires repo_map.execute straight through to executeRepoMap; importing
  // dist/map-tool.js therefore exercises the registered behavior, not a copy.
  await withFixture(async (root) =>
    withFakeRepoMap(
      async () => [{ path: "src/demo.ts", startLine: 1, endLine: 12, symbol: "demoFn", score: 3 }],
      async () => {
        const result = await executeRepoMap({
          projectRoot: root,
          registry: new RefRegistry(),
          tokenBudget: 4000,
        });
        assert.ok(result.content[0]!.text.includes("line 1 of demo"));
        assert.equal(result.details.resultsPath.includes(".pi/agent/code-retrieval/results/"), true);
      },
    ),
  );
});

test("map previews mark their exact window; wider spans stay obtainable via read_spans", async () => {
  await withFixture(async (root) =>
    withFakeRepoMap(
      async () => [{ path: "src/demo.ts", startLine: 10, endLine: 30, symbol: "demoTop", score: 5 }],
      async () => {
        const registry = new RefRegistry();
        const ledger = new SeenRangeLedger();
        const mapped = await executeRepoMap({
          projectRoot: root,
          registry,
          ledger,
          tokenBudget: 4000,
        });
        const topRef = mapped.details.hits[0]!.ref!;
        // Exact shown window (first ≤6 lines of the span): cited, not re-injected.
        const againExact = await executeReadSpans({
          refs: ["src/demo.ts:10-15"],
          projectRoot: root,
          registry,
          ledger,
          tokenBudget: 4000,
        });
        assert.match(againExact.content[0]!.text, /already read/);
        // Full symbol body behind the same ref hashes differently -> comes in full.
        const full = await executeReadSpans({
          refs: [topRef],
          projectRoot: root,
          registry,
          ledger,
          tokenBudget: 4000,
        });
        const fullText = full.content[0]!.text;
        assert.doesNotMatch(fullText, /already read/);
        assert.match(fullText, /line 16 of demo/, "wider range must be injected in full");
      },
    ),
  );
});

test("a lower per-call tokenBudget overrides preview budgeting, including below the settings default", async () => {
  await withFixture(async (root) =>
    withFakeRepoMap(
      async () => [
        { path: "src/demo.ts", startLine: 10, endLine: 30, symbol: "demoTop", score: 5 },
        { path: "src/demo.ts", startLine: 31, endLine: 34, score: 2 },
      ],
      async () => {
        // 5 tokens cannot fit even a single preview line; the caller's lower
        // override must bound rendering, not the settings default (4000).
        const low = await executeRepoMap({
          projectRoot: root,
          registry: new RefRegistry(),
          tokenBudget: 5,
        });
        assert.deepEqual(
          low.details.hits.map((hit) => hit.ref),
          ["R1", "R2"],
          "refs stay stable regardless of budget",
        );
        const lowLines = low.content[0]!.text.split("\n");
        const lowBody = lowLines.filter((line) => /\| /.test(line));
        assert.equal(lowBody.length, 0, "nothing fits a 5-token preview budget");
        assert.match(lowLines.join("\n"), /~\d+\/5 preview tokens/, "footer shows the override, not settings default");

        // Control: the same map at default-scale budget renders previews.
        const full = await executeRepoMap({
          projectRoot: root,
          registry: new RefRegistry(),
          tokenBudget: 4000,
        });
        assert.match(full.content[0]!.text, /inline preview\(s\)/);
        assert.ok(full.content[0]!.text.split("\n").some((line) => /\| /.test(line)));
      },
    ),
  );
});

test("vacant repo_map hook degrades honestly", async () => {
  await withFixture(async (root) =>
    withFakeRepoMap(undefined as never, async () => {
      const result = await executeRepoMap({
        projectRoot: root,
        registry: new RefRegistry(),
      });
      assert.equal(result.details.degraded, true);
      assert.equal(result.details.hits.length, 0);
      assert.match(result.content[0]!.text, /not wired yet/);
    }),
  );
});
