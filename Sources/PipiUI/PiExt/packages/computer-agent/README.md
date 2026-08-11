# PipiUI Computer Agent

UI-neutral coordination and scoped Worker-tool primitives for PipiUI Computer Tasks.
The host Runtime remains the only Cua/TCC authority; this package never starts a
desktop driver directly.

Milestone 2 adds:

- fixed GUI Operator, Terminal Worker, and Verifier roles with no lateral dispatch;
- a dedicated bounded Terminal extension with no general shell, filesystem, or desktop capability;
- task-local artifact references and compressed Worker verdicts;
- a closed-schema, versioned JSON Procedure Store with canonical sensitive-policy injection, host executed-trajectory/replay receipts, independent replay promotion, drift repair, and monotonic suspension;
- a read-only compatibility adapter for existing `computer_recipe` retrieval.

The public seams are exported from `src/index.ts`. Hosts keep ownership of runtime
grants, task cancellation, durable store paths, and UI event projection. A Terminal
Worker must never be issued a `ComputerWorkerBroker` token; it receives only the
dedicated Terminal extension plus a one-time authenticated host Terminal broker
endpoint/token for its current Plan Step. Without both values the extension
registers no Terminal tools. The child never reads, writes, stats, or executes a
local pathname itself; all four operations are typed broker requests. The host
owns cwd/write-root/executable/command-budget enforcement and descriptor-relative
filesystem safety.

Procedure compilation never consumes a planner draft. The host must project a
verified executed trajectory, issue an opaque receipt, inject the canonical
sensitive-application predicate, and verify replay receipts bound to Procedure
ID/version, nonempty independent task/run identities, and fresh Postconditions.
Receipt issuing and verification are mandatory; malformed receipts cause zero
Store mutation. Store load and replay repeat strict admission. Coordinator
projection drops all Worker-provided prose. Only coordinator-generated status,
condition identifier/outcome pairs, and explicitly reconstructed digest-bearing
artifact references cross it.
