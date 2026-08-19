import { accessSync, closeSync, constants, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { mainSessionExcludeToolArgs } from "./main-tool-policy.js";

export type Feature = "philosophy"|"plan"|"generateImage"|"git"|"reload"|"webSearch"|"browserSearch"|"arxivFetch"|"mcp"|"skillLoader"|"searchScope"|"memoryBroker"|"codexServerTools"|"claudeServerTools"|"openaiServerTools"|"geminiServerTools"|"xaiServerTools"|"glmSearchMcp"|"glmVisionMcp"|"computerUse"|"browser"|"terminal"|"subagent"|"bossReadOnly";
export type SpawnFeatures = Partial<Record<Feature, boolean>>;
export type SpawnPaths = Partial<Record<"philosophy"|"media"|"git"|"reload"|"webSearch"|"browserSearch"|"arxivFetchPackage"|"mcp"|"skillLoader"|"builtInSkills"|"planRuntime"|"searchScope"|"memoryBroker"|"hermesMemory"|"codexServerTools"|"claudeServerTools"|"openaiServerTools"|"geminiServerTools"|"xaiServerTools"|"glmSearchMcp"|"computerUse"|"webview"|"terminal"|"updateCenter"|"runtimeInfo"|"secretVault"|"codingTools"|"officeDocShotGate"|"firecrawlPdf"|"pdfInspector"|"subagentDir"|"agentsDir", string>>;
export type ComputerDescriptor = { displayID: number; width: number; height: number };
export type SpawnInput = { sessionPath?: string; /** Host session id. Scopes per-session runtime state (plan store) to one conversation. */ sessionId?: string; cwd: string; runtimeRoot?: string; agentDir?: string; sessionsRoot?: string; resourceMode?: "default"|"explicit"; features?: SpawnFeatures; paths: SpawnPaths; bridgePort?: number; bridgeRoutingKey?: string; /** Canonical v1 bridge credential. Its presence is what selects PIPIUI_HOST_PROTOCOL=1. */ sessionCapability?: string; computerCapability?: string; computerDescriptor?: ComputerDescriptor; grantSessionKey?: string; mainModelId?: string; /** Optional full provider/model reference for Hermes background review. */ memoryReviewModelId?: string; subagentModelsFile?: string; /** The user's Settings → 工具开关 denylist. Merged with the Boss read-only policy; never passed to workers. */ disabledToolNames?: readonly string[]; /** App-profile canonical vault dir. Never inferred from a project agentDir. */ vaultDir?: string; /** In-memory DEK for the Pi child; never written next to ciphertext. */ vaultDek?: string };
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
export function sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string,string> { const exact=new Set(["PIPIUI_AGENTS_DIR","PIPIUI_BOSS_READ_ONLY","PIPIUI_BRIDGE_PORT","PIPIUI_BUILT_IN_SKILL_ROOT","PIPIUI_CODING_TOOLS_EXT","PIPIUI_OFFICE_DOC_SHOT_GATE_EXT","PIPIUI_MAIN_CWD","PIPIUI_MAIN_MODEL","PIPIUI_MAIN_MODEL_FILE","PIPIUI_NODE_PATH","PIPIUI_PI_PATH","PIPIUI_RUNTIME_SOURCE_ROOT","PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE","PIPIUI_SESSION_KEY","PIPIUI_SESSION_CAPABILITY","PIPIUI_SESSION_ID","PIPIUI_HOST_PROTOCOL","PIPIUI_SKILL_READ_BLOCK","PIPIUI_TOOL_SKILL_SETTINGS_FILE","PIPIUI_WEB_ACCESS_EXT","PIPIUI_ARXIV_EXT","PIPIUI_WORKTREE","PIPIUI_PDF_INSPECTOR_ROOT","PIPIUI_SECRET_VAULT_DIR","PIPIUI_VAULT_DEK"]); return Object.fromEntries(Object.entries(env).filter(([key,value])=>value!==undefined&&!exact.has(key)&&!["PIPIUI_AGENT_","PIPIUI_MEMORY_","PIPIUI_COMPUTER_","PIPIUI_CUA_","PIPIUI_TERMINAL_","PIPIUI_SEARCH_","PIPIUI_SUBAGENT_","PIPIUI_WORKTREE_","PIPIUI_HERMES_"].some(prefix=>key.startsWith(prefix))) as [string,string][]); }
/**
 * Layered spawn environment, mirroring Swift `ChatSession.mergedSpawnEnv` + `PiProcess`
 * (T17): every configured `<agentDir>/.env` key is injected into the spawned pi process so
 * env-key providers (DeepSeek, Kimi, …) resolve in the RPC session exactly as they do
 * for `listModels`. Precedence, highest first: internal assembly env (the host's own
 * PIPIUI_* contract) → `.env` → host process env. Managed PIPIUI_* keys are stripped
 * from both base layers, so a stale `.env`/parent value can never resurrect a disabled
 * feature or clobber the host's bridge/computer contract.
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
    ...sanitizeEnvironment(parent),
    ...sanitizeEnvironment(dotEnv),
    ...internal,
  });
}
/** Assemble the Electron host's Pi process contract. */
export function assemblePiSpawn(input:SpawnInput):SpawnOutput { const args:string[]=[];const env:Record<string,string>={};const f=input.features??{};const p=input.paths;if(input.resourceMode==="explicit")args.push("--no-extensions","--no-skills","--no-prompt-templates","--no-themes");if(input.agentDir)env.PI_CODING_AGENT_DIR=input.agentDir;if(input.vaultDir)env.PIPIUI_SECRET_VAULT_DIR=input.vaultDir;if(input.vaultDek)env.PIPIUI_VAULT_DEK=input.vaultDek;if(p.secretVault)ext(args,p.secretVault);if(input.sessionsRoot)env.PI_CODING_AGENT_SESSION_DIR=input.sessionsRoot;if(input.sessionPath)args.push("--session",input.sessionPath);if(p.codingTools){ext(args,p.codingTools);env.PIPIUI_CODING_TOOLS_EXT=p.codingTools}if(p.officeDocShotGate){ext(args,p.officeDocShotGate);env.PIPIUI_OFFICE_DOC_SHOT_GATE_EXT=p.officeDocShotGate}if(p.firecrawlPdf)ext(args,p.firecrawlPdf);if(p.pdfInspector){env.PIPIUI_PDF_INSPECTOR_ROOT=p.pdfInspector;const inspectorModules=join(p.pdfInspector,"node_modules");env.NODE_PATH=env.NODE_PATH?inspectorModules+delimiter+env.NODE_PATH:inspectorModules}if(enabled(f,"philosophy"))ext(args,p.philosophy);if(enabled(f,"generateImage"))ext(args,p.media);if(enabled(f,"git"))ext(args,p.git);if(enabled(f,"reload"))ext(args,p.reload);if(enabled(f,"webSearch")){ext(args,p.webSearch);if(p.webSearch)env.PIPIUI_WEB_ACCESS_EXT=p.webSearch}if(enabled(f,"arxivFetch")){ext(args,p.arxivFetchPackage);if(p.arxivFetchPackage)env.PIPIUI_ARXIV_EXT=p.arxivFetchPackage}if(enabled(f,"mcp"))ext(args,p.mcp);if(enabled(f,"skillLoader")){ext(args,p.skillLoader);if(p.skillLoader&&p.builtInSkills)env.PIPIUI_BUILT_IN_SKILL_ROOT=p.builtInSkills}if(enabled(f,"searchScope")){ext(args,p.searchScope);if(p.searchScope){env.PIPIUI_SEARCH_SCOPE_EXT=p.searchScope;if(input.runtimeRoot)env.PIPIUI_SEARCH_GRANT_FILE=join(input.runtimeRoot,"search-grants",`${input.grantSessionKey??"default"}.json`)}}if(enabled(f,"codexServerTools"))ext(args,p.codexServerTools);if(enabled(f,"claudeServerTools"))ext(args,p.claudeServerTools);if(enabled(f,"openaiServerTools"))ext(args,p.openaiServerTools);if(enabled(f,"geminiServerTools"))ext(args,p.geminiServerTools);if(enabled(f,"xaiServerTools"))ext(args,p.xaiServerTools);if(enabled(f,"glmSearchMcp"))ext(args,p.glmSearchMcp);args.push(...mainSessionExcludeToolArgs({bossReadOnly:enabled(f,"bossReadOnly"),disabledToolNames:input.disabledToolNames}));
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
if(p.agentsDir)env.PIPIUI_AGENTS_DIR=p.agentsDir;if(input.mainModelId)env.PIPIUI_MAIN_MODEL=input.mainModelId;if(input.subagentModelsFile)env.PIPIUI_SUBAGENT_MODELS_FILE=input.subagentModelsFile;env.PIPIUI_COMPUTER_PROCEDURE_STORE=join(homedir(),"Library","Application Support","PipiUI","computer-agent","procedures.json")}
// The plan store is per conversation, not per project: without this id every session in
// one work tree would read and overwrite the same `.pi/plans` file.
if(input.sessionId)env.PIPIUI_SESSION_ID=input.sessionId;if(enabled(f,"plan")){ext(args,p.planRuntime)}
if(!input.bridgePort){appendUserExtensions(args,input.agentDir);ext(args,p.updateCenter);ext(args,p.runtimeInfo);return{args,env};}
// Genuinely bridge-dependent: the memory broker issues host-scoped capabilities, the webview
// extension drives the host's browser surface, and an explicitly enabled plan runtime posts events.
if(enabled(f,"memoryBroker")){ext(args,p.memoryBroker);if(p.memoryBroker){env.PIPIUI_MEMORY_BROKER_MODE="main";env.PIPIUI_MEMORY_PROJECT_ROOT=input.cwd;if(input.memoryReviewModelId)env.PIPIUI_MEMORY_REVIEW_MODEL=input.memoryReviewModelId;if(p.hermesMemory){env.PIPIUI_HERMES_PACKAGE_ROOT=p.hermesMemory;env.PIPIUI_HERMES_NODE_MODULES_ROOT=dirname(p.hermesMemory)}}}if(enabled(f,"browser"))ext(args,p.webview);
// Built-in-browser search/fetch share the webview's bridge; mounted beside it, independently
// gated so the Settings browser toggle and this search route stay separate switches.
if(enabled(f,"browserSearch"))ext(args,p.browserSearch);
if(enabled(f,"terminal"))ext(args,p.terminal);env.PIPIUI_BRIDGE_PORT=String(input.bridgePort);env.PIPIUI_SESSION_KEY=input.bridgeRoutingKey??"";
// pi-web-access resolves optional `glimpseui` from this NODE_PATH before falling
// back to `open`. The shim lives beside the other host extensions.
{
  const extensionsDir=p.browserSearch?dirname(p.browserSearch):p.webview?dirname(p.webview):undefined;
  if(extensionsDir)env.NODE_PATH=env.NODE_PATH?extensionsDir+delimiter+env.NODE_PATH:extensionsDir;
}
// Canonical v1: the extension encodes `sessionCapability` envelopes and fails closed when the
// capability is missing, so the protocol marker is only ever set together with a real credential.
if(input.sessionCapability){env.PIPIUI_HOST_PROTOCOL="1";env.PIPIUI_SESSION_CAPABILITY=input.sessionCapability}
if(enabled(f,"computerUse")&&enabled(f,"subagent")&&p.subagentDir&&p.computerUse&&input.computerCapability&&input.computerDescriptor){
// The main Pi session owns only computer_task orchestration through the subagent
// extension mounted above. Export the reviewed strategy for explicitly granted
// GUI Operator children; never register mutating computer/open_application tools
// directly in the main session.
env.PIPIUI_COMPUTER_EXT=p.computerUse;env.PIPIUI_COMPUTER_CAPABILITY=input.computerCapability;env.PIPIUI_COMPUTER_RUNTIME_PROTOCOL="1";env.PIPIUI_CUA_DRIVER_VERSION="0.20.0";env.PIPIUI_COMPUTER_DISPLAY_ID=String(input.computerDescriptor.displayID);env.PIPIUI_COMPUTER_WIDTH=String(input.computerDescriptor.width);env.PIPIUI_COMPUTER_HEIGHT=String(input.computerDescriptor.height)}
// The update-center input transformer is a main-session policy seam, independent of the bridge.
// runtimeInfo stays last so its read-only request observer sees the final provider payload after all
// PipiUI rewriters. The isolated title helper passes no runtimeInfo path and remains tool-free.
appendUserExtensions(args,input.agentDir);ext(args,p.updateCenter);ext(args,p.runtimeInfo);return{args,env}; }
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
        isShim = head.startsWith("#!") && head.includes("ELECTRON_RUN_AS_NODE");
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
  const hasShim=candidates.some(dir=>isElectronNodeShim(nodeBinaryIn(dir)));
  if(!hasShim)return {...env,PATH:candidates.join(delimiter)};
  const realNodeDirs=candidates.filter(isRealNodeDir);
  if(realNodeDirs.length===0)return {...env,PATH:candidates.join(delimiter)};
  const withoutShim=candidates.filter(dir=>!isElectronNodeShim(nodeBinaryIn(dir)));
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
    git:fileIfPresent(extensions,"pipiui-git.ts"),
    reload:fileIfPresent(extensions,"pipiui-reload.ts"),
    skillLoader:fileIfPresent(extensions,"pipiui-skillloader.ts"),
    builtInSkills:existsSync(join(runtimeRoot,"built-in-skills"))?join(runtimeRoot,"built-in-skills"):undefined,
    planRuntime:fileIfPresent(extensions,"pipiui-plan-runtime.ts"),
    searchScope:fileIfPresent(extensions,"pipiui-search-scope.ts"),
    codexServerTools:fileIfPresent(extensions,"pipiui-codex-server-tools.ts"),
    claudeServerTools:fileIfPresent(extensions,"pipiui-claude-server-tools.ts"),
    openaiServerTools:fileIfPresent(extensions,"pipiui-openai-server-tools.ts"),
    geminiServerTools:fileIfPresent(extensions,"pipiui-gemini-server-tools.ts"),
    xaiServerTools:fileIfPresent(extensions,"pipiui-xai-server-tools.ts"),
    glmSearchMcp:fileIfPresent(extensions,"pipiui-glm-search-mcp.ts"),
    computerUse:fileIfPresent(extensions,"pipiui-computer-use.ts"),
    webview:fileIfPresent(extensions,"pipiui-electron-webview.ts"),
    browserSearch:fileIfPresent(extensions,"pipiui-browser-search.ts"),
    terminal:fileIfPresent(extensions,"pipiui-electron-terminal.ts"),
    updateCenter:fileIfPresent(extensions,"pipiui-update-center.ts"),
    runtimeInfo:fileIfPresent(extensions,"pipiui-runtime-info.ts"),
    secretVault:fileIfPresent(extensions,"pipiui-secret-vault.ts"),
    codingTools:fileIfPresent(extensions,"pipiui-coding-tools.ts"),
    officeDocShotGate:fileIfPresent(extensions,"pipiui-office-doc-shot-gate.ts"),
    firecrawlPdf:fileIfPresent(extensions,"pipiui-firecrawl-pdf.ts"),
    pdfInspector:packageIfPresent(runtimeRoot,"pdf-inspector"),
    subagentDir:fileIfPresent(ext,"subagent"),
    agentsDir:fileIfPresent(ext,"agents"),
    memoryBroker:packageIfPresent(ext,"packages","memory-broker"),
    hermesMemory:managedRoot(HERMES_MEMORY_PACKAGE),
    arxivFetchPackage:packageIfPresent(ext,"packages","arxiv-fetch"),
    webSearch:managed(MANAGED_PACKAGES[0]),
    mcp:managed(MANAGED_PACKAGES[1]),
  };
}
