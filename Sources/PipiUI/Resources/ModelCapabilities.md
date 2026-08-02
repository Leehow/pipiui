# Model capability registry

`ModelCapabilities.json` is the bundled record of model behavior measured by
`scripts/probe-parallel-toolcalls.mjs`. `parallel_tool_calls` is Probe A and
`tasks_batch` is Probe C. A status of `unavailable` or `skipped` is a probe
outcome, not a claim about the model's general quality.

## Add or refresh a model

1. Add `["provider", "model"]` to `TARGETS` in
   `scripts/probe-parallel-toolcalls.mjs` after the model is present in
   `~/.pi/agent/models-store.json`.
2. Run one command:

   ```sh
   node scripts/probe-parallel-toolcalls.mjs --only provider/model --emit-registry
   ```

   It runs the A/B/C probes, writes the raw report and matrix, and merges that
   model into `ModelCapabilities.json`.
3. The exporter recommends `worker` for completed probes. It also recommends
   `boss` when Probe A passes in at least two of three runs and Probe C either
   prefers `tasks[]` in at least two runs or emits multiple independent
   subagent calls in at least two runs. Unavailable and skipped models receive
   no recommended roles.
4. Review the generated notes and commit the registry update.

`--list` remains read-only: it prints planned probes without calling providers
or changing the registry.
