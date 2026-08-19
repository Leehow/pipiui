# PipiUI Computer Agent

UI-neutral single-agent intelligence and scoped Host-tool primitives for PipiUI Computer Tasks.
The host Runtime remains the only Cua/TCC authority; this package never starts a
desktop driver directly.

The normal Electron `computer_task` path now uses one private `computer-use` episode:

- its public schema contains only `goal` and the child has no delegation or agent-management tools;
- ordinary relevant task tools remain available, while the Desktop Agent Interface is only
  `desktop_observe`, `desktop_open_application`, and `desktop_run_action_block`;
- guarded blocks bind semantic targets just in time, stop on Runtime barriers, preserve
  `outcome_unknown`, and enforce Cold/Candidate/Practiced mutation limits of 2/4/12;
- a Host Task Checkpoint preserves constraints, success conditions, verified facts, pending unknown
  effects, active target/workflow, and evidence references across recovery;
- Workflow Memory schema v2 lives under the backend-resolved active project Pi home, recalls at most
  three entries, promotes after two independent successes, suspends on drift/failure, parameterizes
  task values, isolates corrupt records, and never auto-imports the legacy global Procedure Store.

The former Leader, GUI Operator, Terminal Worker, Verifier, Procedure Host, and coordinator modules
remain temporarily as unreachable compatibility code for older internal tests and imports. The normal
`registerComputerTaskTool` does not call them, does not accept their public parameters, and does not
inject their global store.

The public seams are exported from `src/index.ts`. Hosts keep ownership of runtime
grants, task cancellation, durable store paths, and UI event projection. A Terminal
Worker must never be issued a `ComputerWorkerBroker` token; it receives only the
dedicated Terminal extension plus a one-time authenticated host Terminal broker
endpoint/token for its current Plan Step. Without both values the extension
registers no Terminal tools. The child never reads, writes, stats, or executes a
local pathname itself; all four operations are typed broker requests. The host
owns cwd/write-root/executable/command-budget enforcement and descriptor-relative
filesystem safety.

Compatibility Procedure compilation never consumes a planner draft. The host must project a
verified executed trajectory, issue an opaque receipt, inject the canonical
sensitive-application predicate, and verify replay receipts bound to Procedure
ID/version, nonempty independent task/run identities, and fresh Postconditions.
Receipt issuing and verification are mandatory; malformed receipts cause zero
Store mutation. Store load and replay repeat strict admission. Coordinator
projection drops all Worker-provided prose. Only coordinator-generated status,
condition identifier/outcome pairs, and explicitly reconstructed digest-bearing
artifact references cross it.
