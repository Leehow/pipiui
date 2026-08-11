import type { SpawnFeatures } from "./spawn-assembly.js";

/**
 * What this host mounts when the embedder does not choose:
 *
 * - `browser` is mounted because its canonical bridge adapter drives Electron's existing
 *   BrowserTabsHost; it does not create a second browser surface.
 * - `computerUse` is exported only when Electron supplies a usable desktop harness.
 * - `plan`: philosophy remains available, but the Plan runtime stays off until Electron owns a
 *   revisioned store and bridge acknowledgement.
 * - `searchScope`: it is a *gate* — searches outside the project need a host-granted path. Electron
 *   has no grant UI, so mounting it could only ever block the agent, never approve it.
 *
 * Everything else is verified to load: pi boots with all 13 mounts and a clean stderr.
 */
export const DEFAULT_FEATURES:SpawnFeatures=Object.freeze({philosophy:true,plan:false,subagent:true,memoryBroker:true,git:true,generateImage:true,reload:true,webSearch:true,arxivFetch:true,mcp:true,skillLoader:true,searchScope:false,codexServerTools:true,claudeServerTools:true,browser:true,terminal:true,computerUse:true});
