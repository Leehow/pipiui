import { accessSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, readSync, statSync, unlinkSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { mainSessionExcludeToolArgs } from "./main-tool-policy.js";

export type Feature = "philosophy"|"plan"|"goal"|"generateImage"|"git"|"reload"|"webSearch"|"browserSearch"|"browserMemory"|"arxivFetch"|"mcp"|"skillLoader"|"searchScope"|"memoryBroker"|"contextFold"|"codexServerTools"|"claudeServerTools"|"openaiServerTools"|"geminiServerTools"|"xaiServerTools"|"deepseekServerTools"|"glmSearchMcp"|"glmVisionMcp"|"computerUse"|"browser"|"terminal"|"subagent";
export type SpawnFeatures = Partial<Record<Feature, boolean>>;
export type SpawnPaths = Partial<Record<"philosophy"|"media"|"reload"|"webSearch"|"browserSearch"|"browserMemory"|"arxivFetchPackage"|"mcp"|"skillLoader"|"builtInSkills"|"planRuntime"|"goalRuntime"|"searchScope"|"memoryBroker"|"contextFold"|"hermesMemory"|"codexServerTools"|"claudeServerTools"|"openaiServerTools"|"geminiServerTools"|"xaiServerTools"|"deepseekServerTools"|"glmSearchMcp"|"webview"|"terminal"|"updateCenter"|"runtimeInfo"|"secretVault"|"codingTools"|"officeDocShotGate"|"firecrawlAnydoc"|"openDocuments"|"anydoc"|"subagentDir"|"agentsDir"|"corePrompt"|"promptObserver", string>>;
export type ComputerDescriptor = { displayID: number; width: number; height: number };
/** Origin of the resolved extension instance that produced a contribution snapshot. */
export type SpawnExtensionOrigin = "builtin" | "app" | "project";
/** Incremental patch metadata in the spawn snapshot. Prompt fields are canonical absolute paths, never bodies. */
export type SpawnAgentContributionPatch = {
  target: string;
  appendPrompt?: string;
  replacePrompt?: string;
  addTools?: readonly string[];
  removeTools?: readonly string[];
};
/** Bounded agent-contribution snapshot item shared by main session and workers. */
export type SpawnAgentContribution = {
  id: string;
  origin: SpawnExtensionOrigin;
  root: string;
  agents: readonly string[];
  patches: readonly SpawnAgentContributionPatch[];
};
/** Loader-side contribution validation issues. Never prompt bodies or absolute paths. Not part of the spawn snapshot JSON. */
export type SpawnContributionDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  extensionId?: string;
  agentName?: string;
};
/** Registry-owned agent-half mounts (spec D3). Disabled/error packages must set enabled=false. */
export type SpawnRegisteredExtension = {
  id: string;
  version?: string;
  enabled: boolean;
  extensionPath?: string;
  skillRoots?: readonly string[];
  settings?: unknown;
  /** Vault-backed secret values for this package's settings schema, keyed by env var
   * name (`secretEnvName(settingsKey)`). Applied to the child environment only when the
   * agent half is actually mounted, and never serialized into settings snapshots,
   * IPC payloads or transcript redaction sources. */
  secretEnv?: Record<string, string>;
  /** Validated, path-confined contribution metadata. Omitted when disabled/invalid/refused/empty. */
  agentContribution?: SpawnAgentContribution;
  /** Contribution path/size issues for an otherwise usable extension. Omitted when disabled/refused. */
  contributionDiagnostics?: readonly SpawnContributionDiagnostic[];
};
export type SpawnInput = { sessionPath?: string; /** Host session id. Scopes per-session runtime state (plan store) to one conversation. */ sessionId?: string; /** Set for sessions the user manually stopped or archived: pi-goal must not auto-resume goals/continuations in that child. */ goalAutoResume?: "blocked"; cwd: string; /** Canonical project root (identity anchor). When the session is bound to a workspace/worktree, `cwd` is the workspace and this stays the project root; defaults to `cwd`. */ projectRoot?: string; runtimeRoot?: string; agentDir?: string; sessionsRoot?: string; resourceMode?: "default"|"explicit"; features?: SpawnFeatures; paths: SpawnPaths; /** Exact host-owned node_modules that satisfies pinned dependencies imported by registered extension packages. */ managedNodeModulesRoot?: string; bridgePort?: number; bridgeRoutingKey?: string; /** Canonical v1 bridge credential. Its presence is what selects PIPIUI_HOST_PROTOCOL=1. */ sessionCapability?: string; computerCapability?: string; computerDescriptor?: ComputerDescriptor; grantSessionKey?: string; mainModelId?: string; /** Optional full provider/model reference for Hermes background review. */ memoryReviewModelId?: string; subagentModelsFile?: string; /** Read-only available-model catalog snapshot (exact `provider/modelId` refs + display names only, hidden ids already excluded) for Boss dispatch pins and prompt injection; hot-read per dispatch. */ subagentModelCatalogFile?: string; /** Compact provider/id → nativeSearch map for worker tool-list filtering. */ subagentNativeSearchFile?: string; /** Selected session model; used to hide generic web_search when native web_search is effective. */ model?: { provider?: string; id?: string; capabilities?: import("@pipi/host-api").ModelCapabilities }; /** The user's Settings → 工具开关 denylist. Merged with the Boss read-only policy; never passed to workers. */ disabledToolNames?: readonly string[]; /** Unused disk path kept only so callers do not infer a project vault. */ vaultDir?: string; /** Enabled PipiUI extension agent halves; assembled into `-e` like user-extensions. */ registeredExtensions?: readonly SpawnRegisteredExtension[]; /** Extra internal env merged last (never sanitized): host→legacy-extension contracts such as the media compat fallback flag. */ internalEnv?: Record<string,string> };
export type SpawnOutput = { args: string[]; env: Record<string,string> };
/**
 * An explicit process invocation for Pi.
 *
 * Packaged Electron uses the bundled Node executable with the real, unpacked Pi CLI as the first
 * prefix argument. Development callers can keep using a directly executable external `pi`.
 * `piPath` is the launcher-shaped path used by the auth helper to locate Pi's module root.
 */
export type PiCommand = {
  executable: string;
  prefixArgs?: readonly string[];
  env?: Readonly<Record<string, string>>;
  piPath?: string;
};
const enabled=(f:SpawnFeatures|undefined,key:Feature)=>Boolean(f?.[key]);
const ext=(args:string[], path?:string)=>{if(path)args.push("-e",path)};
const WEB_ACCESS_EXTENSION_ID="web-access-extension";
const WEBVIEW_BROWSER_EXTENSION_ID="webview-browser-extension";
const CODING_RUNTIME_EXTENSION_ID="coding-runtime";
const TERMINAL_EXTENSION_ID="terminal-extension";
const PLAN_EXTENSION_ID="plan-extension";
const GOAL_EXTENSION_ID="goal-extension";
const AGENT_ORCHESTRATION_EXTENSION_ID="agent-orchestration";
const DOCUMENT_WORKBENCH_EXTENSION_ID="document-workbench";
const CODING_METHOD_EXTENSION_ID="coding-method";
const SKILL_LOADER_EXTENSION_ID="skill-loader-extension";
/** A known migrated package is authoritative even when disabled/error; legacy mounts are absent-only fallbacks. */
function legacyCoreFallbackAllowed(packages:readonly SpawnRegisteredExtension[]|undefined,id:string):boolean{
  return !(packages??[]).some(pkg=>pkg.id===id);
}
/**
 * PIPIUI_SESSION_CAPABILITY and PIPIUI_HOST_PROTOCOL are stripped for the same reason as the
 * finalizer: a bridge credential inherited from an outer shell would let another process address
 * this session's agent tree. Only the value this host mints for this spawn survives.
 */
export function sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string,string> { const exact=new Set(["PIPIUI_ACTIVE_PROJECT_PI_HOME","PIPIUI_AGENTS_DIR","PIPIUI_BOSS_READ_ONLY","PIPIUI_BRIDGE_PORT","PIPIUI_BUILT_IN_SKILL_ROOT","PIPIUI_CODING_TOOLS_EXT","PIPIUI_CORE_PROMPT","PIPIUI_PROMPT_OBSERVER_EXT","PIPIUI_SKILLLOADER_EXT","PIPIUI_OFFICE_DOC_SHOT_GATE_EXT","PIPIUI_MAIN_CWD","PIPIUI_MAIN_MODEL","PIPIUI_MAIN_MODEL_FILE","PIPIUI_MEDIA_COMPAT_FALLBACK","PIPIUI_PROJECT_ROOT","PIPIUI_MOUNTED_EXTENSIONS","PIPIUI_NODE_PATH","PIPIUI_PI_PATH","PIPIUI_RUNTIME_SOURCE_ROOT","PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE","PIPIUI_SESSION_KEY","PIPIUI_SESSION_CAPABILITY","PIPIUI_SESSION_ID","PIPIUI_HOST_PROTOCOL",GOAL_AUTO_RESUME_ENV,"PIPIUI_SKILL_READ_BLOCK","PIPIUI_SKILL_ROOTS","PIPIUI_TOOL_SKILL_SETTINGS_FILE","PIPIUI_WEB_ACCESS_EXT","PIPIUI_WEBVIEW_EXT","PIPIUI_ARXIV_EXT","PIPIUI_WORKTREE","PIPIUI_PDF_INSPECTOR_ROOT","PIPIUI_ANYDOC_ROOT","PIPIUI_SECRET_VAULT_DIR","PIPIUI_VAULT_DEK"]); return Object.fromEntries(Object.entries(env).filter(([key,value])=>value!==undefined&&!exact.has(key)&&!["PIPIUI_AGENT_","PIPIUI_MEMORY_","PIPIUI_COMPUTER_","PIPIUI_CUA_","PIPIUI_TERMINAL_","PIPIUI_SEARCH_","PIPIUI_SUBAGENT_","PIPIUI_WORKTREE_","PIPIUI_HERMES_","PIPIUI_EXT_"].some(prefix=>key.startsWith(prefix))) as [string,string][]); }
/**
 * Layered spawn environment, mirroring Swift `ChatSession.mergedSpawnEnv` + `PiProcess`
 * (T17): every configured `<agentDir>/.env` key is injected into the spawned pi process so
 * env-key providers (DeepSeek, Kimi, …) resolve in the RPC session exactly as they do
 * for `listModels`. Precedence, highest first: internal assembly env (the host's own
 * PIPIUI_* contract) → `.env` → host process env → host defaults. Managed PIPIUI_*
 * keys are stripped from both base layers, so a stale `.env`/parent value can never resurrect
 * a disabled feature or clobber the host's bridge/computer contract.
 */
/**
 * Packaged Pi/auth children run as Electron Helper. A reconstructed spawn env
 * that drops this flag makes Helper start as Chromium and busy-loop.
 * Harmless on a real Node binary.
 */
export function withElectronRunAsNode<T extends Record<string, string | undefined>>(
  env: T,
): T & { ELECTRON_RUN_AS_NODE: string } {
  return { ...env, ELECTRON_RUN_AS_NODE: "1" };
}

export function mergedSpawnEnvironment(
  parent: NodeJS.ProcessEnv,
  dotEnv: Record<string, string>,
  internal: Record<string, string>,
): Record<string, string> {
  return withElectronRunAsNode({
    PI_CACHE_RETENTION: "long",
    CONTEXTFOLD_BUDGET_CAP: "150000",
    CONTEXTFOLD_TAIL: "30000",
    CONTEXTFOLD_COMPACT: "native",
    CONTEXTFOLD_SPOOL_RETAIN_DAYS: "30",
    CONTEXTFOLD_TOOL_USE_TRIGGER: "40",
    CONTEXTFOLD_TOOL_USE_KEEP: "12",
    CONTEXTFOLD_TOOL_USE_MIN_SAVINGS: "10000",
    ...sanitizeEnvironment(parent),
    ...sanitizeEnvironment(dotEnv),
    ...internal,
  });
}
/** Assemble the Electron host's Pi process contract. */
/**
 * The locked base system prompt (`pi-core-prompt/SYSTEM_BASE.md`), pushed before any other
 * append source so it is the first thing after Pi's own frame. Unconditional on purpose: it
 * carries the identity, the extension architecture, and the handful of invariants that must
 * still hold in a session where every extension is disabled, so no feature flag gates it.
 *
 * Passing `--append-system-prompt` explicitly switches Pi's resource loader out of discovery,
 * so the user's own append file is re-added here rather than silently dropped. Only the
 * agent-dir copy is: Pi trust-gates `{cwd}/.pi/APPEND_SYSTEM.md` and leaves
 * `{agentDir}/APPEND_SYSTEM.md` ungated, and replicating a trust decision host-side would put
 * a second, drifting copy of it in this file. In PipiUI `agentDir` is `{project}/.pi/agent`,
 * so the ungated path is already project-scoped.
 */
function appendCorePrompt(args:string[],env:Record<string,string>,input:SpawnInput):void {
  const base=input.paths.corePrompt;
  if(!base)return;
  args.push("--append-system-prompt",base);
  // Workers assemble their own arguments in the subagent extension rather than through this
  // function, so the path travels to them as env. Without it the base applies to the main
  // session only — a split that is invisible until a worker acts on a rule it never received.
  env.PIPIUI_CORE_PROMPT=base;
  // Worker-side prompt observability travels the same way. The main session gets this from
  // runtime-info, which registers a tool and therefore cannot be mounted in a worker.
  if(input.paths.promptObserver)env.PIPIUI_PROMPT_OBSERVER_EXT=input.paths.promptObserver;
  if(!input.agentDir)return;
  const userAppend=join(input.agentDir,"APPEND_SYSTEM.md");
  if(existsSync(userAppend))args.push("--append-system-prompt",userAppend);
}
export function assemblePiSpawn(input:SpawnInput):SpawnOutput { const args:string[]=[];const env:Record<string,string>={};const f=input.features??{};const p=input.paths;appendCorePrompt(args,env,input);if(input.managedNodeModulesRoot)env.NODE_PATH=input.managedNodeModulesRoot;if(input.resourceMode==="explicit")args.push("--no-extensions","--no-skills","--no-prompt-templates","--no-themes");if(input.agentDir){env.PI_CODING_AGENT_DIR=input.agentDir;env.PIPIUI_ACTIVE_PROJECT_PI_HOME=input.agentDir}if(p.secretVault)ext(args,p.secretVault);if(input.sessionsRoot)env.PI_CODING_AGENT_SESSION_DIR=input.sessionsRoot;if(input.sessionPath)args.push("--session",input.sessionPath);if(p.codingTools&&legacyCoreFallbackAllowed(input.registeredExtensions,CODING_RUNTIME_EXTENSION_ID)){ext(args,p.codingTools);env.PIPIUI_CODING_TOOLS_EXT=p.codingTools}if(p.officeDocShotGate&&legacyCoreFallbackAllowed(input.registeredExtensions,DOCUMENT_WORKBENCH_EXTENSION_ID)){ext(args,p.officeDocShotGate);env.PIPIUI_OFFICE_DOC_SHOT_GATE_EXT=p.officeDocShotGate}if(p.firecrawlAnydoc&&legacyCoreFallbackAllowed(input.registeredExtensions,DOCUMENT_WORKBENCH_EXTENSION_ID))ext(args,p.firecrawlAnydoc);if(p.openDocuments&&legacyCoreFallbackAllowed(input.registeredExtensions,DOCUMENT_WORKBENCH_EXTENSION_ID))ext(args,p.openDocuments);if(p.anydoc){env.PIPIUI_ANYDOC_ROOT=p.anydoc;const anydocModules=join(p.anydoc,"node_modules");env.NODE_PATH=env.NODE_PATH?anydocModules+delimiter+env.NODE_PATH:anydocModules}if(enabled(f,"philosophy")&&legacyCoreFallbackAllowed(input.registeredExtensions,CODING_METHOD_EXTENSION_ID)){ext(args,p.philosophy);if(p.philosophy)env.PIPIUI_PHILOSOPHY_EXT=p.philosophy}if(enabled(f,"generateImage"))ext(args,p.media);if(enabled(f,"reload")&&legacyCoreFallbackAllowed(input.registeredExtensions,CODING_RUNTIME_EXTENSION_ID))ext(args,p.reload);if(enabled(f,"webSearch")&&legacyCoreFallbackAllowed(input.registeredExtensions,WEB_ACCESS_EXTENSION_ID)){ext(args,p.webSearch);if(p.webSearch)env.PIPIUI_WEB_ACCESS_EXT=p.webSearch}// arxiv_fetch is owned by web-access-extension; the bare package only mounts as the legacy
// fallback, while the routing env (worker role allowlists, debug projection) always points at it.
if(enabled(f,"arxivFetch")){if(p.arxivFetchPackage)env.PIPIUI_ARXIV_EXT=p.arxivFetchPackage;if(legacyCoreFallbackAllowed(input.registeredExtensions,WEB_ACCESS_EXTENSION_ID))ext(args,p.arxivFetchPackage)}if(enabled(f,"mcp"))ext(args,p.mcp);if(enabled(f,"skillLoader")){const registered=(input.registeredExtensions??[]).find(pkg=>pkg.id===SKILL_LOADER_EXTENSION_ID);const skillLoaderMount=registered?(registered.enabled?registered.extensionPath:undefined):p.skillLoader;if(!registered)ext(args,p.skillLoader);if(skillLoaderMount){env.PIPIUI_SKILLLOADER_EXT=skillLoaderMount;if(p.builtInSkills)env.PIPIUI_BUILT_IN_SKILL_ROOT=p.builtInSkills}}if(enabled(f,"searchScope")){ext(args,p.searchScope);if(p.searchScope){env.PIPIUI_SEARCH_SCOPE_EXT=p.searchScope;if(input.runtimeRoot)env.PIPIUI_SEARCH_GRANT_FILE=join(input.runtimeRoot,"search-grants",`${input.grantSessionKey??"default"}.json`)}}if(enabled(f,"codexServerTools"))ext(args,p.codexServerTools);if(enabled(f,"claudeServerTools"))ext(args,p.claudeServerTools);if(enabled(f,"openaiServerTools"))ext(args,p.openaiServerTools);if(enabled(f,"geminiServerTools"))ext(args,p.geminiServerTools);if(enabled(f,"xaiServerTools"))ext(args,p.xaiServerTools);if(enabled(f,"deepseekServerTools"))ext(args,p.deepseekServerTools);if(enabled(f,"glmSearchMcp"))ext(args,p.glmSearchMcp);args.push(...mainSessionExcludeToolArgs({disabledToolNames:input.disabledToolNames,model:input.model}));
/*
 * Subagent orchestration, deliberately mounted before the bridge gate.
 *
 * The lifecycle POSTs feed the Subagent panel, but the extension itself does not need a bridge:
 * `postPipiuiReport` returns immediately when PIPIUI_BRIDGE_PORT is unset ("observability, never
 * a reason to crash the worker"). Dispatch, worktree creation and finalization are all decided by
 * env, not by the bridge — so a bridge-less host still gets real workers, just no live panel.
 */
if(enabled(f,"subagent")&&p.subagentDir){const registered=(input.registeredExtensions??[]).find(pkg=>pkg.id===AGENT_ORCHESTRATION_EXTENSION_ID);const subagentMount=registered?(registered.enabled?registered.extensionPath:undefined):p.subagentDir;if(!registered)ext(args,p.subagentDir);if(subagentMount)env.PIPIUI_SUBAGENT_EXT=subagentMount;env.PIPI_PHILOSOPHY_LAYER_DIRS=join(p.subagentDir,"layers");env.PIPIUI_MAIN_CWD=input.cwd;
// This host does not directly finalize Git worktrees. Electron hands merge/cleanup/disposition
// to the audited service in pi so
// exactly one finalizer ever runs against a repository.
env.PIPIUI_WORKTREE_FINALIZER="pi";
if(p.agentsDir)env.PIPIUI_AGENTS_DIR=p.agentsDir;if(input.mainModelId)env.PIPIUI_MAIN_MODEL=input.mainModelId;if(input.subagentModelsFile)env.PIPIUI_SUBAGENT_MODELS_FILE=input.subagentModelsFile;if(input.subagentModelCatalogFile)env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE=input.subagentModelCatalogFile;if(input.subagentNativeSearchFile)env.PIPIUI_SUBAGENT_NATIVE_SEARCH_FILE=input.subagentNativeSearchFile}
// The canonical project root travels separately from `cwd`: identity-level state (memory, plan
// files, worker session dirs, session-worktree merge target) anchors there even when `cwd` is
// a session-bound workspace/worktree. Unconditional: plan/memory mounts outlive the subagent gate.
env.PIPIUI_PROJECT_ROOT=input.projectRoot??input.cwd;
// The plan store is per conversation, not per project: without this id every session in
// one work tree would read and overwrite the same `.pi/plans` file.
if(input.sessionId)env.PIPIUI_SESSION_ID=input.sessionId;if(input.goalAutoResume==="blocked")env[GOAL_AUTO_RESUME_ENV]="blocked";if(enabled(f,"plan")&&legacyCoreFallbackAllowed(input.registeredExtensions,PLAN_EXTENSION_ID)){ext(args,p.planRuntime)}if(enabled(f,"goal")&&legacyCoreFallbackAllowed(input.registeredExtensions,GOAL_EXTENSION_ID)){ext(args,p.goalRuntime)}if(enabled(f,"contextFold")){ext(args,p.contextFold)}
if(!input.bridgePort){appendUserExtensions(args,input.agentDir);appendRegisteredExtensions(args,env,input.registeredExtensions,input);ext(args,p.updateCenter);ext(args,p.runtimeInfo);if(input.internalEnv)for(const[key,value]of Object.entries(input.internalEnv))env[key]=value;return{args,env};}
// Genuinely bridge-dependent: the memory broker issues host-scoped capabilities, the webview
// extension drives the host's browser surface, and an explicitly enabled plan runtime posts events.
if(enabled(f,"memoryBroker")&&memoryExtensionMountable(input.registeredExtensions)){ext(args,p.memoryBroker);if(p.memoryBroker){env.PIPIUI_MEMORY_BROKER_MODE="main";env.PIPIUI_MEMORY_PROJECT_ROOT=input.projectRoot??input.cwd;if(input.memoryReviewModelId)env.PIPIUI_MEMORY_REVIEW_MODEL=input.memoryReviewModelId;if(p.hermesMemory){env.PIPIUI_HERMES_PACKAGE_ROOT=p.hermesMemory;env.PIPIUI_HERMES_NODE_MODULES_ROOT=dirname(p.hermesMemory)}}}if(enabled(f,"browser")&&legacyCoreFallbackAllowed(input.registeredExtensions,WEBVIEW_BROWSER_EXTENSION_ID)){ext(args,p.webview);if(p.webview)env.PIPIUI_WEBVIEW_EXT=p.webview}
// Built-in-browser search/fetch share the webview's bridge; mounted beside it, independently
// gated so the Settings browser toggle and this search route stay separate switches.
if(enabled(f,"browserSearch")&&legacyCoreFallbackAllowed(input.registeredExtensions,WEBVIEW_BROWSER_EXTENSION_ID))ext(args,p.browserSearch);
// Browser flow memory replays over the same bridge; owned by webview-browser-extension,
// so the bare file only mounts as the legacy fallback for hosts without that extension.
if(enabled(f,"browserMemory")&&legacyCoreFallbackAllowed(input.registeredExtensions,WEBVIEW_BROWSER_EXTENSION_ID))ext(args,p.browserMemory);
if(enabled(f,"terminal")&&legacyCoreFallbackAllowed(input.registeredExtensions,TERMINAL_EXTENSION_ID))ext(args,p.terminal);env.PIPIUI_BRIDGE_PORT=String(input.bridgePort);env.PIPIUI_SESSION_KEY=input.bridgeRoutingKey??"";
// pi-web-access resolves optional `glimpseui` from this NODE_PATH before falling
// back to `open`. The shim lives beside the other host extensions.
{
  const extensionsDir=p.browserSearch?dirname(p.browserSearch):p.webview?dirname(p.webview):undefined;
  if(extensionsDir)env.NODE_PATH=env.NODE_PATH?extensionsDir+delimiter+env.NODE_PATH:extensionsDir;
}
// Canonical v1: the extension encodes `sessionCapability` envelopes and fails closed when the
// capability is missing, so the protocol marker is only ever set together with a real credential.
if(input.sessionCapability){env.PIPIUI_HOST_PROTOCOL="1";env.PIPIUI_SESSION_CAPABILITY=input.sessionCapability}
if(enabled(f,"computerUse")&&input.computerCapability&&input.computerDescriptor){
// The main Pi session owns the computer-use tools through the cua-extension,
// which reaches the CuaDriverHost only via the host-capability broker. Export
// the per-session capability and display geometry the broker's desktop-grant
// check verifies against.
env.PIPIUI_COMPUTER_CAPABILITY=input.computerCapability;env.PIPIUI_COMPUTER_RUNTIME_PROTOCOL="1";env.PIPIUI_CUA_DRIVER_VERSION="0.22.0";env.PIPIUI_COMPUTER_DISPLAY_ID=String(input.computerDescriptor.displayID);env.PIPIUI_COMPUTER_WIDTH=String(input.computerDescriptor.width);env.PIPIUI_COMPUTER_HEIGHT=String(input.computerDescriptor.height)}
// The update-center input transformer is a main-session policy seam, independent of the bridge.
// runtimeInfo stays last so its read-only request observer sees the final provider payload after all
// PipiUI rewriters. The isolated title helper passes no runtimeInfo path and remains tool-free.
appendUserExtensions(args,input.agentDir);appendRegisteredExtensions(args,env,input.registeredExtensions,input);ext(args,p.updateCenter);ext(args,p.runtimeInfo);if(input.internalEnv)for(const[key,value]of Object.entries(input.internalEnv))env[key]=value;return{args,env}; }
export const USER_EXTENSIONS_DIR="user-extensions";
const USER_EXTENSION_FILE=/\.(?:[cm]?js|ts)$/;
/**
 * Extra `-e` mounts from the isolated profile. Electron starts Pi with
 * `--no-extensions`, so `settings.json` packages never load; user-added Pi
 * packages live in `{agentDir}/user-extensions` instead.
 */
export function userExtensionMounts(agentDir?:string):string[] {
  if(!agentDir)return[];
  const root=resolve(agentDir,USER_EXTENSIONS_DIR);
  let entries:import("node:fs").Dirent[];
  try{entries=readdirSync(root,{withFileTypes:true,encoding:"utf8"})}catch{return[]}
  const mounts:string[]=[];
  for(const entry of entries){
    if(entry.name.startsWith(".")||entry.name==="node_modules")continue;
    const full=resolve(root,entry.name);
    const rel=relative(root,full);
    if(!rel||rel.startsWith("..")||isAbsolute(rel))continue;
    if(entry.isFile()&&USER_EXTENSION_FILE.test(entry.name)){mounts.push(full);continue}
    if(entry.isDirectory()){
      const entrypoint=declaredEntrypoint(full);
      if(entrypoint)mounts.push(entrypoint);
    }
  }
  return mounts.sort();
}
function appendUserExtensions(args:string[],agentDir?:string){for(const path of userExtensionMounts(agentDir))ext(args,path)}
export const GOAL_AUTO_RESUME_ENV = "PIPIUI_GOAL_AUTO_RESUME";
/** Spec §5.5: `PIPIUI_EXT_SETTINGS_<ID>` with the extension id uppercased. */
export function extensionSettingsEnvName(id: string): string {
  const token = id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `PIPIUI_EXT_SETTINGS_${token || "EXT"}`;
}
/**
 * Comma-joined ids of the registered extensions actually mounted (`-e`) in this spawn.
 * Legacy bundled extensions (pipiui-media) read it to yield tool ownership to a mounted
 * manifest package instead of registering duplicate `image_gen`/`image_edit`.
 */
export const MOUNTED_EXTENSIONS_ENV = "PIPIUI_MOUNTED_EXTENSIONS";
/**
 * PATH-delimited agent-half paths of registry-enabled extensions mounted in this spawn.
 * Workers remount the same snapshot (`-e`); mid-session enable cannot rewrite a live session.
 * Name uses the `PIPIUI_EXT_` prefix so sanitizeEnvironment strips inherited/stale values.
 */
export const REGISTERED_EXTENSION_PATHS_ENV = "PIPIUI_EXT_REGISTERED_PATHS";
/**
 * Bounded JSON snapshot of enabled extension agent contributions.
 * Value is metadata only (ids, origins, canonical roots, absolute AGENT.md / prompt-file paths, tool names).
 * Never contains prompt bodies. Name uses `PIPIUI_EXT_` so sanitizeEnvironment strips inherited/stale values.
 * Main session and workers share this exact string; omit it when there are no active contributions.
 */
export const AGENT_CONTRIBUTIONS_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS";
export const AGENT_CONTRIBUTIONS_FILE_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS_FILE";
/**
 * Canonical session-owned jail directory for the sidecar named by
 * AGENT_CONTRIBUTIONS_FILE_ENV. Set by the host beside the file env so the
 * runtime can verify the sidecar never left the session directory (realpath
 * confinement, not a lexical prefix). `PIPIUI_EXT_` prefix so stale inherited
 * values are stripped like the file env.
 */
export const AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT";
/** Runtime parser rejects snapshots above this. Host stays strictly below. */
export const AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES = 256 * 1024;
/** Host refuses to emit at or above this, leaving margin under the runtime cap. */
export const AGENT_CONTRIBUTIONS_HOST_MAX_BYTES = 192 * 1024;
/** Inline env budget so a legal snapshot cannot blow ARG_MAX. Larger snapshots use a session-owned file. */
export const AGENT_CONTRIBUTIONS_ENV_MAX_BYTES = 32 * 1024;
export const AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION = 1;
export type ContributionSnapshotDiagnostic = {
  severity: "error";
  code: "contribution-snapshot-oversize" | "contribution-snapshot-file";
  message: string;
};
export type VersionedAgentContributionSnapshot = {
  version: typeof AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION;
  extensions: Record<string, unknown>[];
  json?: string;
  byteLength: number;
  diagnostics: ContributionSnapshotDiagnostic[];
};
const CONTRIBUTION_ORIGIN_RANK: Record<SpawnExtensionOrigin, number> = { builtin: 0, app: 1, project: 2 };
function isSpawnExtensionOrigin(value: unknown): value is SpawnExtensionOrigin {
  return value === "builtin" || value === "app" || value === "project";
}
function snapshotAgentContributionPatch(patch: SpawnAgentContributionPatch): Record<string, unknown> {
  const item: Record<string, unknown> = { target: patch.target };
  if (patch.appendPrompt) item.appendPrompt = patch.appendPrompt;
  if (patch.replacePrompt) item.replacePrompt = patch.replacePrompt;
  if (patch.addTools?.length) item.addTools = [...patch.addTools];
  if (patch.removeTools?.length) item.removeTools = [...patch.removeTools];
  return item;
}
function snapshotAgentContribution(pkgId: string, contribution: SpawnAgentContribution): Record<string, unknown> | undefined {
  if (!isSpawnExtensionOrigin(contribution.origin) || typeof contribution.root !== "string" || !contribution.root) return undefined;
  return {
    id: contribution.id || pkgId,
    origin: contribution.origin,
    root: contribution.root,
    agents: [...(contribution.agents ?? [])],
    patches: (contribution.patches ?? []).map(snapshotAgentContributionPatch),
  };
}
function compareAgentContributions(a: { origin: string; id: string }, b: { origin: string; id: string }): number {
  const origin = (CONTRIBUTION_ORIGIN_RANK[a.origin as SpawnExtensionOrigin] ?? 99) - (CONTRIBUTION_ORIGIN_RANK[b.origin as SpawnExtensionOrigin] ?? 99);
  if (origin !== 0) return origin;
  return a.id.localeCompare(b.id);
}
/** Build the versioned `{version:1, extensions}` snapshot shared with the runtime parser. */
export function buildVersionedAgentContributionSnapshot(
  packages?: readonly SpawnRegisteredExtension[],
): VersionedAgentContributionSnapshot {
  const items: Record<string, unknown>[] = [];
  for (const pkg of packages ?? []) {
    if (!pkg.enabled || !pkg.agentContribution) continue;
    const item = snapshotAgentContribution(pkg.id, pkg.agentContribution);
    if (item) items.push(item);
  }
  items.sort((a, b) => compareAgentContributions(
    { origin: String(a.origin), id: String(a.id) },
    { origin: String(b.origin), id: String(b.id) },
  ));
  if (!items.length) {
    return { version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION, extensions: [], byteLength: 0, diagnostics: [] };
  }
  const json = JSON.stringify({ version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION, extensions: items });
  const byteLength = Buffer.byteLength(json, "utf8");
  if (byteLength > AGENT_CONTRIBUTIONS_HOST_MAX_BYTES) {
    return {
      version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION,
      extensions: [],
      byteLength,
      diagnostics: [{
        severity: "error",
        code: "contribution-snapshot-oversize",
        message: `Extension agent contributions snapshot is ${byteLength} bytes; host limit is ${AGENT_CONTRIBUTIONS_HOST_MAX_BYTES} (runtime accepts ${AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES}). Contributions were disabled; extension/skills mounts are unchanged.`,
      }],
    };
  }
  return { version: AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION, extensions: items, json, byteLength, diagnostics: [] };
}
/** Serialize enabled contributions as versioned JSON. Undefined when empty or over the host byte cap. */
export function serializeAgentContributions(packages?: readonly SpawnRegisteredExtension[]): string | undefined {
  return buildVersionedAgentContributionSnapshot(packages).json;
}
/** Canonical sidecar suffix shared with the runtime parser's basename check. */
export const CONTRIBUTION_SIDECAR_SUFFIX = ".ext-agent-contributions.json";
const CONTRIBUTION_SIDECAR_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Sidecar name for one session file: `chat.jsonl` → `chat.ext-agent-contributions.json`. */
export function contributionSidecarName(sessionFile: string): string {
  return basename(sessionFile).replace(/(\.jsonl|\.json)?$/i, "") + CONTRIBUTION_SIDECAR_SUFFIX;
}
/** Temp-file pattern for one sidecar name; crash leftovers are matched for session cleanup. */
export function contributionSidecarTempPattern(sidecarName: string): RegExp {
  return new RegExp(`^\\.${sidecarName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d+\\.[0-9A-Fa-f-]+\\.tmp$`);
}
/**
 * Session-owned sidecar path, verified with realpath — never a lexical prefix guess.
 *
 * The jail is the session file's own (realpath-resolved) directory; the sidecar name is
 * the canonical derivation of the session file name. A directory that does not exist, a
 * jail outside every realpath-resolved agentDir/sessionsRoot root, or a session id that
 * is not a flat slug all refuse (undefined), so a prepositioned symlink on any path
 * component can only make the resolution fail, never relocate the sidecar.
 */
export function resolveContributionSnapshotFile(input: {
  sessionPath?: string;
  sessionId?: string;
  agentDir?: string;
  sessionsRoot?: string;
}): string | undefined {
  let jail: string | undefined;
  let name: string;
  if (input.sessionPath) {
    jail = dirname(input.sessionPath);
    name = contributionSidecarName(input.sessionPath);
  } else if (input.agentDir && input.sessionId) {
    if (!CONTRIBUTION_SIDECAR_SESSION_ID.test(input.sessionId)) return undefined;
    jail = join(resolve(input.agentDir), "sessions", input.sessionId);
    name = "ext-agent-contributions" + CONTRIBUTION_SIDECAR_SUFFIX;
  } else {
    return undefined;
  }
  if (name === CONTRIBUTION_SIDECAR_SUFFIX) return undefined; // empty session stem
  let realJail: string;
  try {
    realJail = realpathSync(jail);
    if (!lstatSync(realJail).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const roots = [input.agentDir, input.sessionsRoot]
    .filter((root): root is string => Boolean(root))
    .map((root) => {
      try {
        return realpathSync(resolve(root));
      } catch {
        return undefined;
      }
    })
    .filter((root): root is string => Boolean(root));
  if (!roots.length) return undefined;
  const confined = roots.some((root) => {
    const rel = relative(root, realJail);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!confined) return undefined;
  return join(realJail, name);
}
/**
 * Atomic, no-follow sidecar replacement. The temp file is created with O_EXCL
 * (0600), written+fsynced, then renamed over the target; a pre-existing symlink,
 * non-regular file, or multi-link inode at the canonical path is refused instead
 * of replaced. Any failure returns false — the caller drops contributions only.
 */
function isPublishedSidecarStat(stat: { isFile(): boolean; mode: number; nlink: number }): boolean {
  return stat.isFile() && (stat.mode & 0o777) === 0o600 && stat.nlink === 1;
}
function writeContributionSnapshotFile(file: string, json: string): boolean {
  const dir = dirname(file);
  try {
    if (!lstatSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    const existing = lstatSync(file);
    if (!existing.isFile() || existing.nlink !== 1) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let published = false;
  try {
    fd = openSync(tmp, "wx", 0o600);
    const buffer = Buffer.from(json, "utf8");
    let offset = 0;
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, file);
    published = true;
    const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
    const verifyFd = openSync(file, constants.O_RDONLY | (noFollow ?? 0));
    try {
      if (!isPublishedSidecarStat(fstatSync(verifyFd))) throw new Error("sidecar verify");
    } finally {
      closeSync(verifyFd);
    }
    return true;
  } catch {
    if (published) {
      try { unlinkSync(file); } catch { /* best-effort rollback of a failed publish */ }
    }
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
    try { unlinkSync(tmp); } catch { /* renamed away or never created */ }
  }
}
/**
 * Delete the session's sidecar plus this system's orphaned temp files.
 * Only files at the exact canonical path (realpath-resolved, plus the pre-realpath
 * lexical location older versions wrote) are considered, and only when they look
 * like ours: regular file, within the byte cap, and parsing as a versioned
 * snapshot. Anything else is left untouched — never delete a file this system
 * does not own.
 */
export function removeContributionSnapshotSidecar(input: {
  sessionPath: string;
  agentDir?: string;
  sessionsRoot?: string;
}): void {
  const candidates = new Set<string>();
  const resolved = resolveContributionSnapshotFile(input);
  if (resolved) candidates.add(resolved);
  if (input.sessionPath) {
    candidates.add(resolve(input.sessionPath.replace(/(\.jsonl|\.json)?$/i, "") + CONTRIBUTION_SIDECAR_SUFFIX));
  }
  if (!candidates.size) return;
  const names = new Set([...candidates].map((candidate) => basename(candidate)));
  const noFollow = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
  for (const candidate of candidates) {
    let fd: number | undefined;
    try {
      const pre = lstatSync(candidate);
      if (!pre.isFile() || pre.size > AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES) continue;
      fd = openSync(candidate, constants.O_RDONLY | (noFollow ?? 0));
      const opened = fstatSync(fd);
      if (
        !opened.isFile()
        || opened.size > AGENT_CONTRIBUTIONS_RUNTIME_MAX_BYTES
        || opened.dev !== pre.dev
        || opened.ino !== pre.ino
      ) continue;
      const buffer = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < buffer.length) {
        const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (read <= 0) break;
        offset += read;
      }
      closeSync(fd);
      fd = undefined;
      const parsed: unknown = JSON.parse(buffer.toString("utf8", 0, offset));
      if (
        !parsed || typeof parsed !== "object"
        || (parsed as { version?: unknown }).version !== AGENT_CONTRIBUTIONS_SNAPSHOT_VERSION
        || !Array.isArray((parsed as { extensions?: unknown }).extensions)
      ) continue;
      unlinkSync(candidate);
    } catch {
      /* not ours, unreadable, or already gone — leave it alone */
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* already closed */ }
      }
    }
  }
  try {
    const dir = dirname([...candidates][0]!);
    const patterns = [...names].map(contributionSidecarTempPattern);
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      if (!entry.isFile() || !patterns.some((pattern) => pattern.test(entry.name))) continue;
      try { unlinkSync(join(dir, entry.name)); } catch { /* raced away */ }
    }
  } catch {
    /* directory already gone */
  }
}
/** Worker remount: exact inline JSON, or the same session-owned file contents. Never a rescan. */
export function workerAgentContributionsSnapshot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[AGENT_CONTRIBUTIONS_ENV];
  if (typeof value === "string" && value) return value;
  const file = env[AGENT_CONTRIBUTIONS_FILE_ENV];
  if (typeof file !== "string" || !file) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
/**
 * Deprecated compat fallback gate for the legacy `pipiui-media` Grok transport
 * (loopback relay / raw xAI API key). Set to "1" only when the user explicitly
 * enables `ext.grok-build-oauth.compatFallback`; default off (spec D6 / US-27).
 */
export const MEDIA_COMPAT_FALLBACK_ENV = "PIPIUI_MEDIA_COMPAT_FALLBACK";
function applyAgentContributionEnv(
  env: Record<string, string>,
  packages: readonly SpawnRegisteredExtension[] | undefined,
  input?: SpawnInput,
): void {
  const built = buildVersionedAgentContributionSnapshot(packages);
  if (!built.json) return;
  if (built.byteLength <= AGENT_CONTRIBUTIONS_ENV_MAX_BYTES) {
    env[AGENT_CONTRIBUTIONS_ENV] = built.json;
    return;
  }
  const file = input ? resolveContributionSnapshotFile(input) : undefined;
  if (!file || !writeContributionSnapshotFile(file, built.json)) return;
  env[AGENT_CONTRIBUTIONS_FILE_ENV] = file;
  env[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV] = dirname(file);
}
function isHostBundledSubagentPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const marker = "/pi-ext/subagent/";
  const index = normalized.indexOf(marker);
  if (index < 0) return normalized.endsWith("/pi-ext/subagent");
  const rest = normalized.slice(index + marker.length);
  if (!rest) return true;
  const top = rest.split("/")[0] ?? "";
  return top !== "test" && top !== "tests";
}

/** Refuse symlink/host/aliased mounts. Missing test fixtures stay keyed by resolved path. */
function classifyExtensionMount(filePath: string): { key: string } | undefined {
  if (isHostBundledSubagentPath(filePath)) return undefined;
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    try {
      if (isHostBundledSubagentPath(realpathSync(filePath))) return undefined;
    } catch {
      /* inode identity is enough */
    }
    return { key: `${stat.dev}:${stat.ino}` };
  } catch {
    return { key: `path:${resolve(filePath)}` };
  }
}

function appendRegisteredExtensions(args:string[], env:Record<string,string>, packages?:readonly SpawnRegisteredExtension[], input?:SpawnInput) {
  const skillRoots:string[]=[];
  const mountedIds:string[]=[];
  const mountedPaths:string[]=[];
  const classified:{ pkg:SpawnRegisteredExtension; key:string }[]=[];
  const keyCount=new Map<string, number>();
  for (const pkg of packages ?? []) {
    if (!pkg.enabled) continue;
    if (pkg.skillRoots) for (const root of pkg.skillRoots) if (root) skillRoots.push(root);
    if (pkg.settings !== undefined) env[extensionSettingsEnvName(pkg.id)] = JSON.stringify(pkg.settings);
    if (!pkg.extensionPath) continue;
    const mount = classifyExtensionMount(pkg.extensionPath);
    if (!mount) continue;
    classified.push({ pkg, key: mount.key });
    keyCount.set(mount.key, (keyCount.get(mount.key) ?? 0) + 1);
  }
  const mounted:{id:string;path:string}[]=[];
  for (const { pkg, key } of classified) {
    if ((keyCount.get(key) ?? 0) > 1 || !pkg.extensionPath) continue;
    ext(args, pkg.extensionPath);
    if (pkg.secretEnv) Object.assign(env, pkg.secretEnv);
    mountedIds.push(pkg.id);
    mountedPaths.push(pkg.extensionPath);
    mounted.push({ id: pkg.id, path: pkg.extensionPath });
  }
  if (mountedIds.length) env[MOUNTED_EXTENSIONS_ENV] = mountedIds.join(",");
  // Workers must never remount the memory agent half: worker memory mounts come
  // exclusively from the broker's issued package identity (role-gated), or a
  // non-memory role would gain failing memory tools merely because the
  // extension is enabled in the main session.
  const workerRemountPaths=mounted.filter(m=>m.id!==MEMORY_EXTENSION_ID&&m.id!==AGENT_ORCHESTRATION_EXTENSION_ID&&m.id!==SKILL_LOADER_EXTENSION_ID).map(m=>m.path);
  if (workerRemountPaths.length) env[REGISTERED_EXTENSION_PATHS_ENV] = workerRemountPaths.join(delimiter);
  if (skillRoots.length) env.PIPIUI_SKILL_ROOTS = skillRoots.join(delimiter);
  applyAgentContributionEnv(env, packages, input);
}
/**
 * Worker `-e` remount of the main-session registered-extension snapshot.
 * Same registry channel as assemblePiSpawn; does not scan bare files.
 */
export function workerRegisteredExtensionArgs(env:NodeJS.ProcessEnv=process.env):string[] {
  const raw=env[REGISTERED_EXTENSION_PATHS_ENV];
  if(!raw)return[];
  const args:string[]=[];
  for(const mount of raw.split(delimiter)) if(mount){args.push("-e",mount)}
  return args;
}
function declaredEntrypoint(root:string):string|undefined {
  try {
    const manifest=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
    const entry=manifest?.pi?.extensions?.[0];
    const candidate=typeof entry==="string"?resolve(root,entry):undefined;
    if(!candidate)return undefined;
    const rel=relative(resolve(root),candidate);
    return rel&&!rel.startsWith("..")&&!isAbsolute(rel)&&existsSync(candidate)?candidate:undefined;
  } catch{return undefined}
}
/**
 * A `pi` that a transitive dependency dragged in is never the one this host wants.
 *
 * `pi-mcp-extension` depends on the pre-rename `@mariozechner/pi-coding-agent` at `*`, which
 * installs an old Pi into this repo's node_modules and claims the `pi` name in
 * `node_modules/.bin`. npm puts that directory first on PATH for every `npm run` script, so
 * the external-Pi fallback used in development would resolve a build several minor versions
 * behind the one this host is written against — and that build rejects flags the host now
 * passes, turning a stale-but-working session into one that will not start at all.
 */
const isPackageLocalBin=(dir:string):boolean=>dir.split(/[\\/]/).includes("node_modules");
/**
 * Resolve the `pi` executable without a shell.
 *
 * An Electron app launched from Finder inherits a minimal PATH (`/usr/bin:/bin:…`), so a bare
 * "pi" spawns ENOENT even though the user's terminal finds it. Search PATH first, then the usual
 * install prefixes; the bare name is the
 * last resort so an unusual install still gets a real ENOENT instead of a silent wrong binary.
 */
export function resolvePiExecutable(env:NodeJS.ProcessEnv=process.env):string{
  const executable=process.platform==="win32"?"pi.cmd":"pi";
  const fromPath=(env.PATH??"").split(delimiter).filter(Boolean).filter(dir=>!isPackageLocalBin(dir)).map(dir=>join(dir,executable));
  const candidates=[...fromPath,join(homedir(),".npm-global","bin","pi"),"/opt/homebrew/bin/pi","/usr/local/bin/pi",join(homedir(),".bun","bin","pi"),join(homedir(),".local","bin","pi")];
  return candidates.find(candidate=>{try{accessSync(candidate,constants.X_OK);return true}catch{return false}})??"pi";
}
const NODE_BIN = process.platform === "win32" ? "node.exe" : "node";
/** The Electron-backed shim is a `.cmd` on Windows and an extensionless script elsewhere. */
const NODE_SHIM_BIN = process.platform === "win32" ? "node.cmd" : "node";

/**
 * Process-wide memoization for the shim scan. A real Node binary is 100+ MB, and reading
 * even a slice of it on every spawn blocks the host event loop long enough to stall the pi
 * child's streaming stdout. Entries are validated against the file's size+mtime, so a
 * replaced executable is re-inspected instead of reused. `withToolPath` itself stays
 * uncached: its remaining cost is a handful of statSync calls, and caching the first PATH
 * decision would freeze it for the App's lifetime even after the toolchain changes.
 */
type ShimCacheEntry={size:number;mtimeMs:number;isShim:boolean};
const shimCache=new Map<string,ShimCacheEntry>();

/**
 * Packaged Electron ships `node` as a shim that execs Helper under
 * ELECTRON_RUN_AS_NODE. Detect that script so user commands can prefer a real
 * Node binary instead of turning every `npm test` into a Helper swarm.
 *
 * Only the first 400 bytes are read: the marker lives in the shebang header, and a full
 * `readFileSync` of a real binary blocked the host event loop for several seconds per call
 * on 100-200MB binaries, batching the pi child's streamed stdout into one burst.
 */
export function isElectronNodeShim(executable: string): boolean {
  try {
    const stat = statSync(executable);
    const cached = shimCache.get(executable);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.isShim;
    let isShim: boolean;
    try {
      const fd = openSync(executable, "r");
      try {
        const buffer = Buffer.alloc(400);
        const bytesRead = readSync(fd, buffer, 0, 400, 0);
        const head = buffer.toString("utf8", 0, bytesRead);
        // POSIX writes a `#!/bin/sh` script, Windows an `@echo off` batch file.
        isShim = (head.startsWith("#!") || head.startsWith("@echo")) && head.includes("ELECTRON_RUN_AS_NODE");
      } finally {
        closeSync(fd);
      }
    } catch {
      // A transient read failure (EMFILE, …) must not be frozen into a permanent verdict:
      // answer "not a shim" for this call only and leave the cache untouched.
      return false;
    }
    shimCache.set(executable, { size: stat.size, mtimeMs: stat.mtimeMs, isShim });
    return isShim;
  } catch {
    return false;
  }
}

function nodeBinaryIn(dir: string): string {
  return join(dir, NODE_BIN);
}

/** Where the shim would live in `dir`; on Windows that is never the `node.exe` a real install ships. */
function nodeShimIn(dir: string): string {
  return join(dir, NODE_SHIM_BIN);
}

function isRealNodeDir(dir: string): boolean {
  const binary = nodeBinaryIn(dir);
  try {
    accessSync(binary, constants.X_OK);
    return !isElectronNodeShim(binary);
  } catch {
    return false;
  }
}

/**
 * Finder/Dock-launched apps inherit a minimal PATH, so pi's `#!/usr/bin/env node` shebang and any
 * `node`/`npm` child exit 127 unless the
 * well-known tool dirs (pi's own bin, Homebrew, /usr/local) are prepended.
 *
 * When the packaged Electron node shim is on PATH and a real Node exists, drop
 * the shim directory: Pi itself is launched by absolute path / PIPIUI_NODE_PATH,
 * but bash/`npx`/`#!/usr/bin/env node` must not inherit Helper as `node`.
 */
export function withToolPath(env:Record<string,string>, piExecutable:string):Record<string,string>{
  const fallbackDirs=["/opt/homebrew/bin","/usr/local/bin",join(homedir(),".local","bin"),join(homedir(),".npm-global","bin"),"/usr/bin","/bin"];
  const existing=(env.PATH??"").split(delimiter).filter(Boolean);
  const candidates=[...new Set([dirname(piExecutable),...existing,...fallbackDirs].filter(Boolean))];
  const hasShim=candidates.some(dir=>isElectronNodeShim(nodeShimIn(dir)));
  if(!hasShim)return {...env,PATH:candidates.join(delimiter)};
  const realNodeDirs=candidates.filter(isRealNodeDir);
  if(realNodeDirs.length===0)return {...env,PATH:candidates.join(delimiter)};
  const withoutShim=candidates.filter(dir=>!isElectronNodeShim(nodeShimIn(dir)));
  return {...env,PATH:[...new Set([...realNodeDirs,...withoutShim])].join(delimiter)};
}
/** Host-independent fallback for tests/embedders. The Electron app injects app.getPath('userData'). */
export function defaultRuntimeRoot():string { return join(homedir(),".pipiui-electron","runtime") }
export type ManagedPackage={name:string;version:string};
/**
 * The two extensions pi does not ship in this repository. Pinned exactly — a range or tag would
 * let the mounted extension change between launches — and declared once so the installer and the
 * mount lookup can never drift onto different versions.
 */
export const MANAGED_PACKAGES:readonly ManagedPackage[]=[{name:"pi-web-access",version:"0.23.0"},{name:"pi-mcp-extension",version:"1.5.0"}];
export const HERMES_MEMORY_PACKAGE:ManagedPackage={name:"pi-hermes-memory",version:"0.9.6"};
/**
 * The memory system ships as the standalone `memory-extension` manifest package
 * (frozen tools: memory_query / memory_status; frozen id in the shared core
 * capability contract). Its agent half wraps the loopback memory broker package
 * in place, so the broker stays the worker identity root and the Hermes adapter
 * (pi-hermes-memory 0.9.6) remains an internal compatibility layer.
 */
export const MEMORY_EXTENSION_ID="memory-extension";
/**
 * The manifest package is authoritative for memory enablement once discovered:
 * a disabled `memory-extension` record must not be resurrected by the legacy
 * bridge-gated mount. An unknown record (older runtime tree) keeps legacy behavior.
 */
function memoryExtensionMountable(packages?:readonly SpawnRegisteredExtension[]):boolean{
  const known=(packages??[]).find(pkg=>pkg.id===MEMORY_EXTENSION_ID);
  return !known||known.enabled;
}
const fileIfPresent=(...segments:string[]):string|undefined=>{const path=join(...segments);return existsSync(path)?path:undefined};
const packageIfPresent=(...segments:string[]):string|undefined=>{const dir=join(...segments);return existsSync(join(dir,"package.json"))?dir:undefined};
export type SpawnPathOptions={managedNodeModulesRoot?:string};
/**
 * Resolve every extension from the installed runtime tree.
 *
 * All shipped files come from the Electron-owned runtime snapshot. An unresolved path is always
 * undefined, never a guess: `-e /does/not/exist` would take the whole session down.
 */
export function resolveSpawnPaths(runtimeRoot:string=defaultRuntimeRoot(),options:SpawnPathOptions={}):SpawnPaths {
  const ext=join(runtimeRoot,"pi-ext");
  const extensions=join(runtimeRoot,"extensions");
  const managed=({name,version}:ManagedPackage)=>{
    const root=options.managedNodeModulesRoot
      ? join(options.managedNodeModulesRoot,name)
      : join(runtimeRoot,"managed-npm",`${name}-${version}`,"node_modules",name);
    try {
      if(JSON.parse(readFileSync(join(root,"package.json"),"utf8"))?.version!==version)return undefined;
    } catch{return undefined}
    return declaredEntrypoint(root);
  };
  const managedRoot=({name,version}:ManagedPackage)=>{
    const root=options.managedNodeModulesRoot
      ? join(options.managedNodeModulesRoot,name)
      : join(runtimeRoot,"managed-npm",`${name}-${version}`,"node_modules",name);
    try{return JSON.parse(readFileSync(join(root,"package.json"),"utf8"))?.version===version?root:undefined}catch{return undefined}
  };
  return {
    philosophy:declaredEntrypoint(join(runtimeRoot,"pi-philosophy")),
    media:fileIfPresent(extensions,"pipiui-media.ts"),
    reload:fileIfPresent(extensions,"pipiui-reload.ts"),
    skillLoader:fileIfPresent(extensions,"pipiui-skillloader.ts"),
    builtInSkills:existsSync(join(runtimeRoot,"built-in-skills"))?join(runtimeRoot,"built-in-skills"):undefined,
    planRuntime:fileIfPresent(extensions,"pipiui-plan-runtime.ts"),
    goalRuntime:declaredEntrypoint(join(runtimeRoot,"pi-goal")),
    searchScope:fileIfPresent(extensions,"pipiui-search-scope.ts"),
    codexServerTools:fileIfPresent(extensions,"pipiui-codex-server-tools.ts"),
    claudeServerTools:fileIfPresent(extensions,"pipiui-claude-server-tools.ts"),
    openaiServerTools:fileIfPresent(extensions,"pipiui-openai-server-tools.ts"),
    geminiServerTools:fileIfPresent(extensions,"pipiui-gemini-server-tools.ts"),
    xaiServerTools:fileIfPresent(extensions,"pipiui-xai-server-tools.ts"),
    deepseekServerTools:fileIfPresent(extensions,"pipiui-deepseek-server-tools.ts"),
    glmSearchMcp:fileIfPresent(extensions,"pipiui-glm-search-mcp.ts"),
    webview:fileIfPresent(extensions,"pipiui-electron-webview.ts"),
    browserSearch:fileIfPresent(extensions,"pipiui-browser-search.ts"),
    browserMemory:fileIfPresent(extensions,"pipiui-browser-memory.ts"),
    terminal:fileIfPresent(extensions,"pipiui-electron-terminal.ts"),
    updateCenter:fileIfPresent(extensions,"pipiui-update-center.ts"),
    runtimeInfo:fileIfPresent(extensions,"pipiui-runtime-info.ts"),
    secretVault:fileIfPresent(extensions,"pipiui-secret-vault.ts"),
    codingTools:fileIfPresent(extensions,"pipiui-coding-tools.ts"),
    officeDocShotGate:fileIfPresent(extensions,"pipiui-office-doc-shot-gate.ts"),
    firecrawlAnydoc:fileIfPresent(extensions,"pipiui-firecrawl-anydoc.ts"),
    openDocuments:fileIfPresent(extensions,"pipiui-open-documents.ts"),
    anydoc:packageIfPresent(runtimeRoot,"anydoc"),
    corePrompt:fileIfPresent(runtimeRoot,"pi-core-prompt","SYSTEM_BASE.md"),
    promptObserver:fileIfPresent(extensions,"pipiui-prompt-observer.ts"),
    subagentDir:fileIfPresent(ext,"subagent"),
    agentsDir:fileIfPresent(ext,"agents"),
    memoryBroker:fileIfPresent(extensions,"memory-extension","agent","memory-broker-extension.ts"),
    contextFold:fileIfPresent(ext,"packages","context-fold","index.ts"),
    hermesMemory:managedRoot(HERMES_MEMORY_PACKAGE),
    arxivFetchPackage:packageIfPresent(ext,"packages","arxiv-fetch"),
    webSearch:managed(MANAGED_PACKAGES[0]),
    mcp:managed(MANAGED_PACKAGES[1]),
  };
}
