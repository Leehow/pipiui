import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	OFFICE_DOC_SHOT_GATE_CUSTOM_TYPE,
	OfficeDocShotLedger,
	followUpContent,
	gateFailedContent,
} from "./office-doc-shot-gate.ts";

const SYSTEM_HINT = [
	"OfficeCLI document edits are gated: for an existing Office file, take a whole-document baseline screenshot before the first write in this human task, then take another after the last write.",
	"Qualifying command only: officecli view <file> screenshot --grid auto",
	"--page, missing --grid auto, or a failed view do not count. create of a new file may skip the baseline but still needs the final screenshot.",
	"Use the OfficeCLI MCP tool. Do not call officecli from bash.",
].join(" ");

export default function (pi: ExtensionAPI) {
	const ledger = new OfficeDocShotLedger();

	pi.on("input", (event) => {
		if (event.source === "interactive" || event.source === "rpc") ledger.resetHumanTask();
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_HINT}`,
	}));

	pi.on("tool_call", (event, ctx) => {
		const decision = ledger.beginCall({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			input: event.input,
			cwd: ctx.cwd,
		});
		if (decision.action === "block") return { block: true, reason: decision.reason };
		return undefined;
	});

	pi.on("tool_result", (event, ctx) => {
		ledger.finishCall({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			input: event.input,
			cwd: ctx.cwd,
			isError: Boolean(event.isError),
		});
	});

	pi.on("agent_end", () => {
		ledger.releaseAllInflight();
		const pending = ledger.pendingFinalPaths();
		if (pending.length === 0) return;
		if (ledger.followUpExhausted()) {
			if (!ledger.gateFailedAnnounced) {
				ledger.markGateFailedAnnounced();
				pi.sendMessage({
					customType: OFFICE_DOC_SHOT_GATE_CUSTOM_TYPE,
					content: gateFailedContent(pending),
					display: true,
				}, { deliverAs: "followUp" });
			}
			return;
		}
		ledger.recordFollowUp();
		pi.sendMessage({
			customType: OFFICE_DOC_SHOT_GATE_CUSTOM_TYPE,
			content: followUpContent(pending),
			display: true,
		}, { triggerTurn: true, deliverAs: "followUp" });
	});
}
