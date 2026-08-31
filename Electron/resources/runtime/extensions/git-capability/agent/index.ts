import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import gitTools from "./git-tools.ts";
import { registerGitWorktreeServiceProviderV1 } from "../host/worktree/provider.ts";

/** Git capability provider entrypoint; future Git-owned services share this mount. */
export default function gitCapability(pi: ExtensionAPI): void {
  registerGitWorktreeServiceProviderV1();
  gitTools(pi);
}
