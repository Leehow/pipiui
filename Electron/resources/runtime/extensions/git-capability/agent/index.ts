import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import gitTools from "./git-tools.ts";
import { registerSessionMergeCommand } from "./session-merge-command.ts";
import { registerSessionWorktreeHooks } from "./session-worktree.ts";
import { registerGitWorktreePlacementProviderV1 } from "./worktree-service.ts";
import { registerGitWorktreeServiceProviderV1 } from "../host/worktree/provider.ts";

/** Git capability provider entrypoint; future Git-owned services share this mount. */
export default function gitCapability(pi: ExtensionAPI): void {
  registerGitWorktreePlacementProviderV1();
  registerGitWorktreeServiceProviderV1();
  registerSessionWorktreeHooks(pi);
  registerSessionMergeCommand(pi);
  gitTools(pi);
}
