/**
 * Auto-revival suppression for sessions the user manually stopped or archived.
 *
 * The PipiUI host decides at spawn time whether this session must stay inert:
 * archived sessions (`sidebarSessionPreferences.archivedSessionIds`) and
 * sessions whose manual-stop marker is persisted in pipiui-settings.json spawn
 * the Pi child with `PIPIUI_GOAL_AUTO_RESUME=blocked` (see
 * Electron/packages/pi-backend/src/spawn-assembly.ts). While blocked:
 *
 * - `session_start` must not resurrect the restored goal's wait timer,
 * - `agent_end` / `agent_settled` / compaction recovery must not mint or send
 *   automatic continuations.
 *
 * The block covers ONLY automatic revival. Genuine user input lifts it for the
 * process lifetime (see GoalRuntime.noteUserInput), so wake/prompt flows keep
 * working unchanged. The literal is duplicated from spawn-assembly.ts on
 * purpose — vendored runtime trees stay dependency-isolated from the backend.
 */
export const GOAL_AUTO_RESUME_ENV = "PIPIUI_GOAL_AUTO_RESUME";
export type GoalAutoResumeState = "run" | "blocked";

export function initialGoalAutoResume(env: NodeJS.ProcessEnv = process.env): GoalAutoResumeState {
	return env[GOAL_AUTO_RESUME_ENV] === "blocked" ? "blocked" : "run";
}
