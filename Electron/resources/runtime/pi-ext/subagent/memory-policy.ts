export const SUBAGENT_MEMORY_AGENT_NAMES = [
	"explore", "general-purpose", "reviewer", "computer-use-leader",
	"operator", "computer-verifier", "computer-terminal", "secretary",
] as const;

export type SubagentMemoryAgentName = typeof SUBAGENT_MEMORY_AGENT_NAMES[number];
export type TerminalMemoryEvidenceClass = "source-backed" | "verification-passed";

type RecallPolicy = {
	maximumItems: number;
	maximumCharacters: number;
	allowedKinds: readonly string[];
	allowedScopes: readonly string[];
};

export type SubagentMemoryPolicy = {
	recall: RecallPolicy;
	write: "never" | "source-backed" | "verification-passed";
};

const PROJECT = ["project"] as const;
const SEMANTIC_PROCEDURAL = ["semantic", "procedural"] as const;
const POLICIES: Record<SubagentMemoryAgentName, SubagentMemoryPolicy> = {
	explore: { recall: { maximumItems: 3, maximumCharacters: 1_000, allowedKinds: ["semantic", "episodic", "procedural"], allowedScopes: PROJECT }, write: "source-backed" },
	"general-purpose": { recall: { maximumItems: 2, maximumCharacters: 800, allowedKinds: SEMANTIC_PROCEDURAL, allowedScopes: PROJECT }, write: "verification-passed" },
	reviewer: { recall: { maximumItems: 1, maximumCharacters: 600, allowedKinds: SEMANTIC_PROCEDURAL, allowedScopes: PROJECT }, write: "source-backed" },
	"computer-use-leader": { recall: { maximumItems: 2, maximumCharacters: 700, allowedKinds: SEMANTIC_PROCEDURAL, allowedScopes: PROJECT }, write: "never" },
	operator: { recall: { maximumItems: 1, maximumCharacters: 500, allowedKinds: ["procedural", "semantic"], allowedScopes: PROJECT }, write: "never" },
	"computer-verifier": { recall: { maximumItems: 2, maximumCharacters: 700, allowedKinds: SEMANTIC_PROCEDURAL, allowedScopes: PROJECT }, write: "never" },
	"computer-terminal": { recall: { maximumItems: 1, maximumCharacters: 450, allowedKinds: ["procedural", "semantic"], allowedScopes: PROJECT }, write: "never" },
	secretary: { recall: { maximumItems: 1, maximumCharacters: 400, allowedKinds: ["procedural", "semantic"], allowedScopes: PROJECT }, write: "never" },
};

const SOURCE_EVIDENCE_RE = /(?:https?:\/\/[^\s]+|(?:^|\s)(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]+:\d+(?::\d+)?)/u;

function knownAgentName(value: string): value is SubagentMemoryAgentName {
	return (SUBAGENT_MEMORY_AGENT_NAMES as readonly string[]).includes(value);
}

export function subagentMemoryPolicy(agentName: string): SubagentMemoryPolicy | undefined {
	return knownAgentName(agentName) ? POLICIES[agentName] : undefined;
}

/** Applies a second, role-specific bound at the child ingress seam. */
export function filterSubagentMemoryContext(agentName: string, context: unknown): Record<string, unknown> | undefined {
	const policy = subagentMemoryPolicy(agentName)?.recall;
	if (!policy || !context || typeof context !== "object" || Array.isArray(context)) return undefined;
	const source = context as Record<string, unknown>;
	if (!Array.isArray(source.items)) return undefined;
	const items: Record<string, unknown>[] = [];
	for (const value of source.items) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const item = value as Record<string, unknown>;
		if (typeof item.kind !== "string" || !policy.allowedKinds.includes(item.kind)) continue;
		if (typeof item.scope !== "string" || !policy.allowedScopes.includes(item.scope)) continue;
		const prospective = { ...source, items: [...items, item] };
		if (items.length >= policy.maximumItems || JSON.stringify(prospective).length > policy.maximumCharacters) continue;
		items.push(item);
	}
	return items.length ? { ...source, items } : undefined;
}

export function terminalMemoryEvidence(input: {
	agentName: string;
	terminalText: string;
	outcome: "success" | "failure";
	verificationPassed: boolean;
}): TerminalMemoryEvidenceClass | undefined {
	const write = subagentMemoryPolicy(input.agentName)?.write;
	if (!write || write === "never" || input.outcome !== "success" || !input.terminalText.trim()) return undefined;
	if (write === "verification-passed") return input.verificationPassed ? "verification-passed" : undefined;
	return SOURCE_EVIDENCE_RE.test(input.terminalText) ? "source-backed" : undefined;
}
