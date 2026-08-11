import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type Feature = "philosophy"|"plan"|"generateImage"|"git"|"reload"|"webSearch"|"arxivFetch"|"mcp"|"skillLoader"|"searchScope"|"memoryBroker"|"codexServerTools"|"claudeServerTools"|"computerUse"|"browser"|"terminal"|"subagent";
export type SpawnFeatures = Partial<Record<Feature, boolean>>;
export type SpawnPaths = Partial<Record<"philosophy"|"media"|"git"|"reload"|"webSearch"|"arxivFetchPackage"|"mcp"|"skillLoader"|"builtInSkills"|"planRuntime"|"searchScope"|"memoryBroker"|"codexServerTools"|"claudeServerTools"|"computerUse"|"webview"|"terminal"|"subagentDir"|"agentsDir", string>>;
export type ComputerDescriptor = { displayID: number; width: number; height: number };
export type SpawnInput = { sessionPath?: string; cwd: string; runtimeRoot?: string; features?: SpawnFeatures; paths: SpawnPaths; bridgePort?: number; bridgeRoutingKey?: string; /** Canonical v1 bridge credential. Its presence is what selects PIPIUI_HOST_PROTOCOL=1. */ sessionCapability?: string; computerCapability?: string; computerDescriptor?: ComputerDescriptor; grantSessionKey?: string; mainModelId?: string; excludeToolsArgs?: string[] };
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
/**
 * PIPIUI_SESSION_CAPABILITY and PIPIUI_HOST_PROTOCOL are stripped for the same reason as the
 * finalizer: a bridge credential inherited from an outer shell would let another process address
 * this session's agent tree. Only the value this host mints for this spawn survives.
 */
export function sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string,string> { const exact=new Set(["PIPIUI_AGENTS_DIR","PIPIUI_BRIDGE_PORT","PIPIUI_BUILT_IN_SKILL_ROOT","PIPIUI_MAIN_CWD","PIPIUI_MAIN_MODEL","PIPIUI_MAIN_MODEL_FILE","PIPIUI_NODE_PATH","PIPIUI_PI_PATH","PIPIUI_RUNTIME_SOURCE_ROOT","PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE","PIPIUI_SESSION_KEY","PIPIUI_SESSION_CAPABILITY","PIPIUI_HOST_PROTOCOL","PIPIUI_SKILL_READ_BLOCK","PIPIUI_TOOL_SKILL_SETTINGS_FILE","PIPIUI_WEB_ACCESS_EXT","PIPIUI_ARXIV_EXT","PIPIUI_WORKTREE"]); return Object.fromEntries(Object.entries(env).filter(([key,value])=>value!==undefined&&!exact.has(key)&&!["PIPIUI_AGENT_","PIPIUI_MEMORY_","PIPIUI_COMPUTER_","PIPIUI_CUA_","PIPIUI_TERMINAL_","PIPIUI_SEARCH_","PIPIUI_SUBAGENT_","PIPIUI_WORKTREE_","PIPIUI_HERMES_"].some(prefix=>key.startsWith(prefix))) as [string,string][]); }
/**
 * Layered spawn environment, mirroring Swift `ChatSession.mergedSpawnEnv` + `PiProcess`
 * (T17): every `~/.pi/agent/.env` key is injected into the spawned pi process so
 * env-key providers (DeepSeek, Kimi, …) resolve in the RPC session exactly as they do
 * for `listModels`. Precedence, highest first: internal assembly env (the host's own
 * PIPIUI_* contract) → `.env` → host process env. Managed PIPIUI_* keys are stripped
 * from both base layers, so a stale `.env`/parent value can never resurrect a disabled
 * feature or clobber the host's bridge/computer contract.
 */
export function mergedSpawnEnvironment(
  parent: NodeJS.ProcessEnv,
  dotEnv: Record<string, string>,
  internal: Record<string, string>,
): Record<string, string> {
  return {
    ...sanitizeEnvironment(parent),
    ...sanitizeEnvironment(dotEnv),
    ...internal,
  };
}
/** Assemble the Electron host's Pi process contract. */
export function assemblePiSpawn(input:SpawnInput):SpawnOutput { const args:string[]=[];const env:Record<string,string>={};const f=input.features??{};const p=input.paths;if(input.sessionPath)args.push("--session",input.sessionPath);if(enabled(f,"philosophy"))ext(args,p.philosophy);if(enabled(f,"generateImage"))ext(args,p.media);if(enabled(f,"git"))ext(args,p.git);if(enabled(f,"reload"))ext(args,p.reload);if(enabled(f,"webSearch")){ext(args,p.webSearch);if(p.webSearch)env.PIPIUI_WEB_ACCESS_EXT=p.webSearch}if(enabled(f,"arxivFetch")){ext(args,p.arxivFetchPackage);if(p.arxivFetchPackage)env.PIPIUI_ARXIV_EXT=p.arxivFetchPackage}if(enabled(f,"mcp"))ext(args,p.mcp);if(enabled(f,"skillLoader")){ext(args,p.skillLoader);if(p.skillLoader&&p.builtInSkills)env.PIPIUI_BUILT_IN_SKILL_ROOT=p.builtInSkills}if(enabled(f,"searchScope")){ext(args,p.searchScope);if(p.searchScope){env.PIPIUI_SEARCH_SCOPE_EXT=p.searchScope;if(input.runtimeRoot)env.PIPIUI_SEARCH_GRANT_FILE=join(input.runtimeRoot,"search-grants",`${input.grantSessionKey??"default"}.json`)}}if(enabled(f,"codexServerTools"))ext(args,p.codexServerTools);if(enabled(f,"claudeServerTools"))ext(args,p.claudeServerTools);args.push(...(input.excludeToolsArgs??[]));
/*
 * Subagent orchestration, deliberately mounted before the bridge gate.
 *
 * The lifecycle POSTs feed the Subagent panel, but the extension itself does not need a bridge:
 * `postPipiuiReport` returns immediately when PIPIUI_BRIDGE_PORT is unset ("observability, never
 * a reason to crash the worker"). Dispatch, worktree creation and finalization are all decided by
 * env, not by the bridge — so a bridge-less host still gets real workers, just no live panel.
 */
if(enabled(f,"subagent")&&p.subagentDir){ext(args,p.subagentDir);env.PIPIUI_SUBAGENT_EXT=p.subagentDir;env.PIPIUI_MAIN_CWD=input.cwd;
// This host does not directly finalize Git worktrees. Electron hands merge/cleanup/disposition
// to the audited service in pi so
// exactly one finalizer ever runs against a repository.
env.PIPIUI_WORKTREE_FINALIZER="pi";
if(p.agentsDir)env.PIPIUI_AGENTS_DIR=p.agentsDir;if(input.mainModelId)env.PIPIUI_MAIN_MODEL=input.mainModelId;env.PIPIUI_COMPUTER_PROCEDURE_STORE=join(homedir(),"Library","Application Support","PipiUI","computer-agent","procedures.json")}
if(!input.bridgePort)return{args,env};
// Genuinely bridge-dependent: the memory broker issues host-scoped capabilities, the webview
// extension drives the host's browser surface, and an explicitly enabled plan runtime posts events.
if(enabled(f,"memoryBroker")){ext(args,p.memoryBroker);if(p.memoryBroker){env.PIPIUI_MEMORY_BROKER_MODE="main";env.PIPIUI_MEMORY_PROJECT_ROOT=input.cwd}}if(enabled(f,"browser"))ext(args,p.webview);if(enabled(f,"terminal"))ext(args,p.terminal);if(enabled(f,"plan"))ext(args,p.planRuntime);env.PIPIUI_BRIDGE_PORT=String(input.bridgePort);env.PIPIUI_SESSION_KEY=input.bridgeRoutingKey??"";
// Canonical v1: the extension encodes `sessionCapability` envelopes and fails closed when the
// capability is missing, so the protocol marker is only ever set together with a real credential.
if(input.sessionCapability){env.PIPIUI_HOST_PROTOCOL="1";env.PIPIUI_SESSION_CAPABILITY=input.sessionCapability}
if(enabled(f,"computerUse")&&p.computerUse&&input.computerCapability&&input.computerDescriptor){
// Electron exposes Computer Use in the fresh main Pi session. PIPIUI_COMPUTER_EXT
// remains exported so desktop-authorized nested operators can mount the same
// reviewed strategy; the capability still gates both processes.
ext(args,p.computerUse);env.PIPIUI_COMPUTER_EXT=p.computerUse;env.PIPIUI_COMPUTER_CAPABILITY=input.computerCapability;env.PIPIUI_COMPUTER_RUNTIME_PROTOCOL="1";env.PIPIUI_CUA_DRIVER_VERSION="0.19.2";env.PIPIUI_COMPUTER_DISPLAY_ID=String(input.computerDescriptor.displayID);env.PIPIUI_COMPUTER_WIDTH=String(input.computerDescriptor.width);env.PIPIUI_COMPUTER_HEIGHT=String(input.computerDescriptor.height)}
return{args,env}; }
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
 * Resolve the `pi` executable without a shell.
 *
 * An Electron app launched from Finder inherits a minimal PATH (`/usr/bin:/bin:…`), so a bare
 * "pi" spawns ENOENT even though the user's terminal finds it. Search PATH first, then the usual
 * install prefixes; the bare name is the
 * last resort so an unusual install still gets a real ENOENT instead of a silent wrong binary.
 */
export function resolvePiExecutable(env:NodeJS.ProcessEnv=process.env):string{
  const executable=process.platform==="win32"?"pi.cmd":"pi";
  const fromPath=(env.PATH??"").split(delimiter).filter(Boolean).map(dir=>join(dir,executable));
  const candidates=[...fromPath,join(homedir(),".npm-global","bin","pi"),"/opt/homebrew/bin/pi","/usr/local/bin/pi",join(homedir(),".bun","bin","pi"),join(homedir(),".local","bin","pi")];
  return candidates.find(candidate=>{try{accessSync(candidate,constants.X_OK);return true}catch{return false}})??"pi";
}
/**
 * Finder/Dock-launched apps inherit a minimal PATH, so pi's `#!/usr/bin/env node` shebang and any
 * `node`/`npm` child exit 127 unless the
 * well-known tool dirs (pi's own bin, Homebrew, /usr/local) are prepended.
 */
export function withToolPath(env:Record<string,string>, piExecutable:string):Record<string,string>{
  const fallbackDirs=["/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin"];
  const existing=env.PATH??"";
  return {...env,PATH:[...new Set([dirname(piExecutable),...existing.split(delimiter).filter(Boolean),...fallbackDirs])].join(delimiter)};
}
/** Host-independent fallback for tests/embedders. The Electron app injects app.getPath('userData'). */
export function defaultRuntimeRoot():string { return join(homedir(),".pipiui-electron","runtime") }
export type ManagedPackage={name:string;version:string};
/**
 * The two extensions pi does not ship in this repository. Pinned exactly — a range or tag would
 * let the mounted extension change between launches — and declared once so the installer and the
 * mount lookup can never drift onto different versions.
 */
export const MANAGED_PACKAGES:readonly ManagedPackage[]=[{name:"pi-web-access",version:"0.20.0"},{name:"pi-mcp-extension",version:"1.5.0"}];
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
  return {
    philosophy:declaredEntrypoint(join(runtimeRoot,"pi-philosophy")),
    media:fileIfPresent(extensions,"pipiui-media.ts"),
    git:fileIfPresent(extensions,"pipiui-git.ts"),
    reload:fileIfPresent(extensions,"pipiui-reload.ts"),
    skillLoader:fileIfPresent(extensions,"pipiui-skillloader.ts"),
    builtInSkills:existsSync(join(runtimeRoot,"built-in-skills"))?join(runtimeRoot,"built-in-skills"):undefined,
    planRuntime:fileIfPresent(extensions,"pipiui-plan-runtime.ts"),
    searchScope:fileIfPresent(extensions,"pipiui-search-scope.ts"),
    codexServerTools:fileIfPresent(extensions,"pipiui-codex-server-tools.ts"),
    claudeServerTools:fileIfPresent(extensions,"pipiui-claude-server-tools.ts"),
    computerUse:fileIfPresent(extensions,"pipiui-computer-use.ts"),
    webview:fileIfPresent(extensions,"pipiui-electron-webview.ts"),
    terminal:fileIfPresent(extensions,"pipiui-electron-terminal.ts"),
    subagentDir:fileIfPresent(ext,"subagent"),
    agentsDir:fileIfPresent(ext,"agents"),
    memoryBroker:packageIfPresent(ext,"packages","memory-broker"),
    arxivFetchPackage:packageIfPresent(ext,"packages","arxiv-fetch"),
    webSearch:managed(MANAGED_PACKAGES[0]),
    mcp:managed(MANAGED_PACKAGES[1]),
  };
}
