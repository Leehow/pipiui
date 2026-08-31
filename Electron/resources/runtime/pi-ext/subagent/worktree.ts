/** @deprecated Compatibility types and provider request; Git placement lives in git-capability. */
export type {
	WorktreePlacement,
	WorktreePlacementOptions,
} from "../../extensions/git-capability/agent/worktree-placement.ts";
export {
	requestGitWorktreePlacementProviderV1,
	requestGitWorktreePlacementV1,
} from "../../extensions/git-capability/agent/worktree-service.ts";
