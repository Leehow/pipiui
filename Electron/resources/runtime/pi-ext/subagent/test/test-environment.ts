const HOST_EXACT_KEYS = new Set([
	"PIPIUI_BRIDGE_PORT",
	"PIPIUI_SESSION_KEY",
	"PIPIUI_SESSION_CAPABILITY",
	"PIPIUI_SESSION_ID",
	"PIPIUI_HOST_PROTOCOL",
	"PIPIUI_FANOUT_ACTIVE",
	// Inherited canonical root would pin worker JSONL into the live project.
	"PIPIUI_PROJECT_ROOT",
]);

const HOST_CAPABILITY_PREFIXES = [
	"PIPIUI_COMPUTER_",
	"PIPIUI_CUA_",
	"PIPIUI_MEMORY_",
	"PIPIUI_TERMINAL_",
] as const;

/**
 * Real-seam tests import the production subagent extension in-process. When a
 * test is launched from the App's Bash tool it otherwise inherits the live
 * loopback capability and reports synthetic workers into the user's session.
 */
export function scrubSubagentRuntimeTestHostEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
): void {
	for (const key of Object.keys(environment)) {
		if (HOST_EXACT_KEYS.has(key) || HOST_CAPABILITY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
			delete environment[key];
		}
	}
}
