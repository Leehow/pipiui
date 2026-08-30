import type { SpawnFeatures } from "./spawn-assembly.js";

/**
 * What this host mounts when the embedder does not choose:
 *
 * - `browser` is mounted because its canonical bridge adapter drives Electron's existing
 *   BrowserTabsHost; it does not create a second browser surface.
 * - `browserSearch` adds browser_search/browser_fetch on the same bridge: web research routed
 *   through the app's own browser panel instead of direct HTTP (JS rendering, session login
 *   state). It complements pi-web-access's `web_search`, never replaces it. It also intercepts
 *   that plugin's curator `open`/Glimpse so the review page lands in the same panel.
 * - `browserMemory` adds browser_flow (save/list/show/delete/run of taught flows, replayed
 *   step-by-step over the same bridge; values are parameterized, never stored).
 * - Isolated `webSearch` defaults to Exa MCP keyless with `workflow: "none"` (search and
 *   return). A 429/`quota` error falls through `searchRouting` to SearXNG → OpenAI →
 *   Firecrawl → the rest of the auto chain. TUN/fake-IP proxies get
 *   `ssrf.allowRanges: ["198.18.0.0/15"]` so `mcp.exa.ai` is reachable.
 * - `computerUse` is exported only when Electron supplies a usable desktop harness.
 * - `plan`: mounts `plan_publish` / `plan_task_update` / `plan_approve` / `plan_cancel`.
 *   State lives under `.pi/plans/`; the host may still drop the bridge event until a Plans panel exists.
 * - `goal`: mounts vendored `@narumitw/pi-goal` (`/goal` slash command + goal_* tools).
 * - `searchScope`: it is a *gate* — searches outside the project need a host-granted path. Electron
 *   has no grant UI, so mounting it could only ever block the agent, never approve it.
 *
 * - `bossReadOnly` is gone. It withheld `bash`/`edit`/`write` from the main session to enforce
 *   "you do not work the floor" in the runtime. The Boss now owns and implements the mainline,
 *   so that withholding would prevent the thing it is supposed to protect. Drift — the reason
 *   the rule existed — is bought by the mainline philosophy layer instead; see
 *   `main-tool-policy.ts` for the full argument.
 *
 * Everything else is verified to load: pi boots with all 13 mounts and a clean stderr.
 */
export const DEFAULT_FEATURES:SpawnFeatures=Object.freeze({philosophy:true,plan:true,goal:true,subagent:true,memoryBroker:true,contextFold:true,git:true,generateImage:true,reload:true,webSearch:true,browserSearch:true,browserMemory:true,arxivFetch:true,mcp:true,skillLoader:true,searchScope:false,codexServerTools:true,claudeServerTools:true,openaiServerTools:true,geminiServerTools:true,xaiServerTools:true,deepseekServerTools:true,glmSearchMcp:true,glmVisionMcp:true,browser:true,terminal:true,computerUse:true});
