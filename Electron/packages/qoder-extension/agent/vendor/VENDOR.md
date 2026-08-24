Vendored from `pi-provider-qoder@0.3.0`
(https://github.com/simonsmh/pi-provider-qoder).

Source: local clone `/tmp/pi-provider-qoder` (`package.json` version 0.3.0).
License: MIT — see `ThirdPartyNotices/QoderProvider-LICENSE.txt`.

PipiUI patches (do not drop on the next vendor bump unless upstream fixed them):

- `models.ts`: `getCachedModelConfig` returns the raw cache entry (no
  `withMaxContextAsDefault`). `getCachedModels` / `updateQoderModelsCache`
  set `contextWindow` from the API `is_default` tier (else `max_input_tokens`).
- `models.ts` / `oauth.ts`: state dir is `PIPIUI_QODER_AGENT_DIR` or
  `~/.pi/agent` (same production path as upstream; env override for tests).
