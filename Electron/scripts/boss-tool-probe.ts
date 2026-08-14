/**
 * Probe extension for `check-boss-tool-policy.mjs`. Not part of the shipped runtime.
 *
 * Writes the system prompt Pi actually built to the file named by PIPIUI_TOOL_PROBE_OUT.
 * That prompt is the only view of the real session's tool set reachable from an extension in
 * RPC mode: `getActiveTools`/`getAllTools` live on the command context, and Pi 0.84 cannot
 * dispatch a slash command over RPC. It is also the right view for this check — what the
 * model is told it has is exactly what the check is about.
 */
import * as fs from "node:fs";

export default function (pi: any) {
	pi.on("session_start", (_event: unknown, ctx: any) => {
		try {
			fs.writeFileSync(
				process.env.PIPIUI_TOOL_PROBE_OUT!,
				JSON.stringify({ systemPrompt: ctx.getSystemPrompt?.() ?? null }),
			);
		} catch (error) {
			process.stderr.write(`[boss-tool-probe] ${error}\n`);
		}
	});
}
