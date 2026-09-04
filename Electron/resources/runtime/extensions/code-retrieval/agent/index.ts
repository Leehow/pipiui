/**
 * pipiui-code-retrieval agent half (spec D2 / D4 / D5 / D8).
 *
 * Registers four read-only tools. code_search + read_spans implement the
 * result protocol, seen-range ledger, rg exact layer, and sidecar lifecycle.
 *
 * repo_map / code_nav stay on the hook table in hooks.ts so the symbol-layer
 * worker can `setSymbolLayer({ repoMap, codeNav, searchSymbols })` without
 * editing protocol / code_search / read_spans. Do not import agent/sidecar
 * symbol extractors from this file.
 */

import { executeCodeSearch } from "./code-search.js";
import { GrepTellBudget } from "./grep-tell.js";
import { getSymbolLayer, normalizeCodeNavResult, setSymbolLayer } from "./hooks.js";
import { SeenRangeLedger } from "./ledger.js";
import { executeRepoMap } from "./map-tool.js";
import { EXTENSION_ID } from "./paths.js";
import { buildInlinePreviews } from "./previews.js";
import { buildToolResult, emptyDegraded, formatCompressedContent, RefRegistry } from "./protocol.js";
import { executeReadSpans } from "./read-spans.js";
import { loadRetrievalSettings, type ExactProvider } from "./settings.js";
import {
  attachSidecar,
  detachSidecar,
  pingSidecar,
  readSidecarSnapshot,
  startSidecarHeartbeat,
  type HeartbeatHandle,
} from "./sidecar-lifecycle.js";
import type { SidecarConnection, ToolResult } from "./types.js";
import { ensureTreeSitter, startSymbolWarmup } from "./warmup.js";
import { installSymbolLayer } from "./symbol/hooks-adapter.js";
import { rebuildZvecIndex } from "./zvec-semantic.js";

export { symbolLayer, setSymbolLayer, getSymbolLayer } from "./hooks.js";
export { GrepTellBudget, alternationArms } from "./grep-tell.js";
export { RefRegistry, formatRefLine, buildToolResult } from "./protocol.js";
export { SeenRangeLedger } from "./ledger.js";
export { ensureTreeSitter, startSymbolWarmup } from "./warmup.js";
export { executeRepoMap } from "./map-tool.js";

type ExtensionAPI = {
  registerTool(tool: {
    name: string;
    label?: string;
    description: string;
    /** One line under Pi's `Available tools:`. Absent means the model meets the tool only as
     *  a schema in an array, with no steering about when it is the right call. */
    promptSnippet?: string;
    /** Bullets appended to the system prompt's `Guidelines:` section while the tool is active.
     *  The snippet says what the tool is; these say when it is the call. */
    promptGuidelines?: string[];
    parameters: Record<string, unknown>;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: { cwd?: string },
    ) => Promise<ToolResult>;
  }): void;
  registerCommand(
    name: string,
    spec: {
      description: string;
      handler: (args: unknown) => Promise<unknown> | unknown;
    },
  ): void;
  on?(
    event: string,
    handler: (event: unknown, ctx: { cwd: string }) => unknown,
  ): void;
};

export class SessionRuntime {
  projectRoot = "";
  sessionId = `sess-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  readonly registry = new RefRegistry();
  readonly ledger = new SeenRangeLedger();
  sidecar: SidecarConnection | undefined;
  started = false;
  /** Provider selection in force for the current attach; reported honestly by sidecarStatus(). */
  requestedProvider: ExactProvider = "auto";
  /** Bumped first in `shutdown` so an in-flight `ensure` cannot start a zombie heartbeat. */
  generation = 0;
  /** Test seam: delay or wrap attach to reproduce ensure/shutdown interleaving. */
  attachSidecarFn: typeof attachSidecar = attachSidecar;
  /** Test seam: delay only the root-switch detach inside ensure (shutdown uses real detach). */
  detachSidecarFn: typeof detachSidecar = detachSidecar;
  private heartbeat: HeartbeatHandle | undefined;

  get heartbeatRunning(): boolean {
    return this.heartbeat !== undefined;
  }

  private stillCurrent(epoch: number): boolean {
    return this.generation === epoch;
  }

  private noteLeaseMissing(epoch: number): void {
    if (!this.stillCurrent(epoch)) return;
    this.heartbeat?.stop();
    this.heartbeat = undefined;
    this.sidecar = undefined;
    this.started = false;
  }

  async ensure(cwd?: string): Promise<void> {
    const root = cwd || this.projectRoot || process.cwd();
    if (this.started && this.projectRoot === root) return;
    const epoch = this.generation;
    if (this.started && this.projectRoot && this.projectRoot !== root) {
      const previous = this.projectRoot;
      this.heartbeat?.stop();
      this.heartbeat = undefined;
      try {
        await this.detachSidecarFn(previous, this.sessionId);
      } catch {
        // old root lease expires on TTL if detach fails
      }
      if (!this.stillCurrent(epoch)) return;
    }
    if (!this.stillCurrent(epoch)) return;
    this.projectRoot = root;
    this.started = true;
    let sidecar: SidecarConnection | undefined;
    try {
      const settings = await loadRetrievalSettings(root);
      this.requestedProvider = settings.exactProvider;
      sidecar = await this.attachSidecarFn({
        projectRoot: root,
        sessionId: this.sessionId,
        provider: settings.exactProvider,
      });
    } catch {
      sidecar = undefined;
    }
    if (!this.stillCurrent(epoch)) {
      if (sidecar) {
        try {
          await detachSidecar(root, this.sessionId);
        } catch {
          // abandoned attach must not pin the sidecar
        }
      }
      return;
    }
    this.sidecar = sidecar;
    this.heartbeat?.stop();
    this.heartbeat = this.sidecar
      ? startSidecarHeartbeat({
          projectRoot: root,
          sessionId: this.sessionId,
          onMissing: () => this.noteLeaseMissing(epoch),
        })
      : undefined;
    if (!this.sidecar) this.started = false;
  }

  async shutdown(): Promise<void> {
    this.generation += 1;
    this.heartbeat?.stop();
    this.heartbeat = undefined;
    const root = this.projectRoot;
    const hadSession = this.started || this.sidecar !== undefined;
    this.sidecar = undefined;
    this.started = false;
    if (hadSession && root) {
      try {
        await detachSidecar(root, this.sessionId);
      } catch {
        // D2: shutdown only drops our ref; never throw into the session.
      }
    }
    this.registry.clear();
    this.ledger.clear();
  }

  async sidecarStatus(): Promise<Record<string, unknown>> {
    const snap = this.projectRoot ? await readSidecarSnapshot(this.projectRoot) : undefined;
    const live = snap ? await pingSidecar(snap) : undefined;
    const actualProvider = live?.provider ?? snap?.provider;
    const requested = this.requestedProvider;
    const attached = this.sidecar !== undefined;
    const knownActual = actualProvider !== undefined;
    // Refused foreign-provider slot: selection is rg/tantivy, the running
    // sidecar reports something else, and this session therefore did not attach.
    const refusedForeign =
      !attached && knownActual && requested !== "auto" && actualProvider !== requested;
    // Unknown identity (legacy provider-less sidecar) is degraded under any
    // explicit selection: never silently trusted as the requested provider.
    const providerDegraded =
      (requested === "tantivy" && knownActual && actualProvider !== "tantivy") ||
      (attached && !knownActual) ||
      refusedForeign;
    const fallbackReasons = new Set<string>();
    if (live?.providerFallback) fallbackReasons.add(live.providerFallback.reason);
    if (this.sidecar?.providerFallback) fallbackReasons.add(this.sidecar.providerFallback.reason);
    const providerNotes = [
      ...fallbackReasons,
      ...(requested === "tantivy" && knownActual && actualProvider !== "tantivy"
        ? [`Selection requested tantivy but exact search is served by ${actualProvider}.`]
        : []),
      ...(attached && knownActual && requested !== "auto" && actualProvider !== requested
        ? [`Running sidecar reports ${actualProvider}; the ${requested} selection applies after it exits.`]
        : []),
      // Provider-correct refusal: the rg/tantivy selection neither borrows nor
      // stops a foreign-provider sidecar another session owns.
      ...(refusedForeign
        ? [
            `A ${actualProvider} sidecar from another session is running; the ${requested} selection does not borrow or stop it, so exact search stays on local rg.`,
          ]
        : []),
    ];
    return {
      state: live ? "ready" : "degraded",
      ready: Boolean(live),
      degraded: !live,
      pid: live?.pid ?? snap?.pid,
      port: live?.port ?? snap?.port,
      refcount: live?.refcount,
      provider: actualProvider,
      requestedProvider: requested,
      providerDegraded,
      // Bearer token deliberately never surfaced here.
      reason: [
        live
          ? "sidecar reachable"
          : "sidecar not reachable; tools fall back to grep",
        ...providerNotes,
      ].join("; "),
    };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Using any of these is the session electing indexed retrieval; the grep tell goes quiet after. */
const INDEXED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "code_search",
  "code_nav",
  "repo_map",
  "read_spans",
]);

export default function (pi: ExtensionAPI): void {
  // Wire the tree-sitter symbol layer into the hook table (spec D4/D6).
  // Hooks install is cheap; WASM + full extract run in the background after
  // session_start so the first repo_map / code_nav can join the in-flight cache.
  installSymbolLayer(setSymbolLayer);

  const runtime = new SessionRuntime();
  const grepTell = new GrepTellBudget();

  pi.on?.("session_start", async (_event, ctx) => {
    grepTell.reset();
    await runtime.ensure(ctx.cwd);
    // Fire-and-forget: never block session_start on tree-sitter / extract.
    void startSymbolWarmup(runtime.projectRoot);
  });

  pi.on?.("session_shutdown", async () => {
    await runtime.shutdown();
  });

  /**
   * The packed-guess tell (grep-tell.ts).
   *
   * The philosophy layer states the tell sequentially — *your own second keyword* —
   * but models pack the guesses into one alternation, so the tell is invisible at
   * the moment it holds. This puts one line where the model can act on it: on the
   * grep result itself. Budgeted, deduped, and silent for the rest of a session
   * that reaches for indexed retrieval on its own.
   *
   * Best-effort throughout: any failure here must leave the grep result untouched
   * rather than break a search.
   */
  pi.on?.("tool_result", event => {
    try {
      const result = event as {
        toolName?: unknown;
        isError?: unknown;
        input?: Record<string, unknown>;
        content?: unknown;
      };
      if (result.isError === true) return undefined;
      const toolName = typeof result.toolName === "string" ? result.toolName : "";
      if (INDEXED_TOOL_NAMES.has(toolName)) {
        grepTell.silence();
        return undefined;
      }
      if (toolName !== "grep") return undefined;
      const input = result.input ?? {};
      const tell = grepTell.consider({
        pattern: typeof input.pattern === "string" ? input.pattern : undefined,
        path: typeof input.path === "string" ? input.path : undefined,
        literal: typeof input.literal === "boolean" ? input.literal : undefined,
        at: Date.now(),
      });
      if (!tell) return undefined;
      const content = Array.isArray(result.content) ? result.content : [];
      return { content: [...content, { type: "text", text: tell.line }] };
    } catch {
      return undefined;
    }
  });

  pi.registerTool({
    name: "code_search",
    label: "Code search",
    promptSnippet: "Search code from a description when grep would need a keyword guess",
    promptGuidelines: [
      "When a grep pattern would carry several alternative keywords, that alternation is the weighing code_search does properly — send the description instead of the arms.",
    ],
    description:
      "Find code from a description when you cannot name the one token it contains — \"where the session token gets refreshed\", \"what handles retry on a 429\". Open/semantic queries go through a local zvec BM25+vector index under the project .pi/agent home, then fall back to weighted term match if that index is down. Returns ranked compressed R# refs (top 12 inline) with a bounded source preview under the top refs (~6 lines each, strict aggregate cap); never full file bodies — pull those with read_spans. Exact identifiers still belong to grep. An empty result means those words are not in the tree: change vocabulary, not tool.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        mode: {
          type: "string",
          enum: ["auto", "exact", "symbol", "semantic"],
          description: "Retrieval mode; default auto",
        },
        path: { type: "string", description: "Optional path prefix" },
        glob: { type: "string", description: "Optional glob filter" },
        topK: { type: "number", description: "Optional hit cap" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        await runtime.ensure(ctx?.cwd);
        const settings = await loadRetrievalSettings(runtime.projectRoot);
        return await executeCodeSearch({
          query: asString(params.query) ?? "",
          mode: asString(params.mode) as "auto" | "exact" | "symbol" | "semantic" | undefined,
          path: asString(params.path),
          glob: asString(params.glob),
          topK: asNumber(params.topK),
          projectRoot: runtime.projectRoot,
          registry: runtime.registry,
          excludeGlobs: settings.excludeGlobs,
          sidecar: runtime.sidecar,
          signal,
          providerInfo: {
            requested: settings.exactProvider,
            actual: runtime.sidecar?.provider,
          },
          tokenBudget: settings.tokenBudget,
          ledger: runtime.ledger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyDegraded(
          "code-retrieval.search",
          `code_search failed: ${message}. Use the existing grep / read tools.`,
        );
      }
    },
  });

  pi.registerTool({
    name: "code_nav",
    label: "Code nav",
    promptSnippet: "Symbol graph: definition, callers, implementations",
    promptGuidelines: [
      "Use code_nav, not grep, for where a symbol is defined / who calls it / what implements it: grep flattens the definition, the call sites and passing mentions into one list.",
    ],
    description:
      "Answer the symbol-graph questions text search flattens: where a symbol is defined, who calls it, what implements it. Prefer it over grepping a symbol name, which returns the definition, every call site and every passing mention as one undifferentiated list. Ranked hits carry a bounded source preview under the top refs (a few lines each) so most choices need no follow-up read. Degrades to a stub when the symbol layer is unavailable.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "definition",
            "references",
            "implementations",
            "workspace_symbols",
            "callers",
            "callees",
          ],
        },
        symbol: { type: "string" },
        path: { type: "string" },
        line: { type: "number" },
        column: { type: "number" },
      },
      required: ["operation"],
      additionalProperties: false,
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        await runtime.ensure(ctx?.cwd);
        await ensureTreeSitter();
        const impl = getSymbolLayer().codeNav;
        if (!impl) {
          return emptyDegraded(
            "code-retrieval.nav",
            "code_nav symbol graph is not wired yet (hook vacant). Use grep / code_search.",
          );
        }
        const operation = asString(params.operation) as
          | "definition"
          | "references"
          | "implementations"
          | "workspace_symbols"
          | "callers"
          | "callees"
          | undefined;
        if (!operation) {
          return emptyDegraded("code-retrieval.nav", "code_nav requires operation.");
        }
        const nav = normalizeCodeNavResult(
          await impl({
            operation,
            symbol: asString(params.symbol),
            path: asString(params.path),
            line: asNumber(params.line),
            column: asNumber(params.column),
            projectRoot: runtime.projectRoot,
          }),
        );
        if (nav.unsupported) {
          return emptyDegraded(
            "code-retrieval.nav",
            nav.reason ?? `code_nav ${operation} is not supported. Use grep / code_search.`,
          );
        }
        if (nav.degraded && nav.hits.length === 0) {
          return emptyDegraded(
            "code-retrieval.nav",
            nav.reason ?? `code_nav ${operation} found no symbol hits. Use grep / code_search.`,
          );
        }
        const assigned = runtime.registry.assignAll(nav.hits);
        const note = [nav.incomplete ? nav.reason : undefined].filter(Boolean).join(" ");
        const settings = await loadRetrievalSettings(runtime.projectRoot);        const previews = await buildInlinePreviews(assigned, {
          projectRoot: runtime.projectRoot,
          ledger: runtime.ledger,
          budgetTokens: settings.tokenBudget,
        });
        return buildToolResult({
          projectRoot: runtime.projectRoot,
          kind: "code-retrieval.nav",
          hits: assigned,
          degraded: Boolean(nav.degraded),
          content: formatCompressedContent(
            assigned,
            [note, previews.note].filter(Boolean).join(" ") || undefined,
            previews.previews,
          ),
          degradeReason: nav.degraded ? nav.reason : undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyDegraded("code-retrieval.nav", `code_nav failed: ${message}. Use grep.`);
      }
    },
  });

  pi.registerTool({
    name: "repo_map",
    label: "Repo map",
    promptSnippet: "Map an unfamiliar tree before opening files",
    promptGuidelines: [
      "In a tree whose layout you cannot yet name, call repo_map before walking directories or opening files to find out what is in them.",
    ],
    description:
      "First move in a tree whose layout you cannot yet name: a token-budgeted map of signatures, imports and call edges across the project. Cheaper than walking directories and opening files to find out what is in them. Ranked map hits carry stable R# refs with a bounded source preview under the top refs (~6 lines each), so one call is usually enough to choose; pull full bodies with read_spans. Uses the symbol-layer hook when present.",
    parameters: {
      type: "object",
      properties: {
        tokenBudget: { type: "number", description: "Override default token budget" },
      },
      additionalProperties: false,
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        await runtime.ensure(ctx?.cwd);
        // Shared implementation (also importable as executeRepoMap from
        // dist/map-tool.js) so the evaluator exercises the same path the tool does:
        // stable refs + bounded inline previews under the top hits.
        return await executeRepoMap({
          projectRoot: runtime.projectRoot,
          registry: runtime.registry,
          ledger: runtime.ledger,
          tokenBudget: asNumber(params.tokenBudget),
        });
      } catch {
        return emptyDegraded("code-retrieval.map", "repo_map failed. Use grep / ls.");
      }
    },
  });

  pi.registerTool({
    name: "read_spans",
    label: "Read spans",
    promptSnippet: "Fetch the span bodies a prior code_search ranked",
    promptGuidelines: [
      "After a code_search or repo_map, pull bodies with read_spans by ref rather than re-opening whole files — the ranked list already named the lines.",
    ],
    description:
      "Second half of a search: fetch the full bodies of spans a prior code_search / repo_map ranked, by stable R# ref. Read the ranked list first (its inline previews cover only the top hits), decide which spans deserve context, then pull only those — that ordering is what keeps a search cheap. A range already returned this session, including an exact range shown as an inline preview, is cited rather than re-inlined; wider reads such as full symbol bodies always come through in full. Honors ext.code-retrieval.tokenBudget (default 4000).",
    parameters: {
      type: "object",
      properties: {
        refs: {
          type: "array",
          items: { type: "string" },
          description: "Stable span ids from a prior search / map result",
        },
      },
      required: ["refs"],
      additionalProperties: false,
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      try {
        await runtime.ensure(ctx?.cwd);
        const settings = await loadRetrievalSettings(runtime.projectRoot);
        return await executeReadSpans({
          refs: asStringArray(params.refs),
          projectRoot: runtime.projectRoot,
          registry: runtime.registry,
          ledger: runtime.ledger,
          tokenBudget: settings.tokenBudget,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emptyDegraded("code-retrieval.spans", `read_spans failed: ${message}. Use read.`);
      }
    },
  });

  pi.registerCommand(EXTENSION_ID, {
    description: "Code retrieval invoke bridge (status / reindex)",
    handler: async (args) => {
      const record = (args ?? {}) as Record<string, unknown>;
      const method =
        typeof record.method === "string"
          ? record.method
          : typeof record.name === "string"
            ? record.name
            : "status";
      if (method === "reindex") {
        const settings = await loadRetrievalSettings(runtime.projectRoot);
        const rebuilt = await rebuildZvecIndex(runtime.projectRoot, {
          excludeGlobs: settings.excludeGlobs,
        });
        return {
          ok: rebuilt.ok,
          data: {
            ...(await runtime.sidecarStatus()),
            accepted: rebuilt.ok,
            message: rebuilt.ok
              ? "zvec semantic index rebuilt under .pi/agent/code-retrieval/zvec/"
              : `zvec reindex skipped: ${rebuilt.reason ?? "unavailable"}; exact search still uses grep/sidecar`,
          },
        };
      }
      if (method === "status") {
        return { ok: true, data: await runtime.sidecarStatus() };
      }
      return {
        ok: false,
        error: {
          code: "invalid_params",
          message: `未知 invoke method：${method}（仅支持 status / reindex）`,
        },
      };
    },
  });

}
