# PipiUI PDF (`pdf-extension`)

Bundled PipiUI extension owning the PDF parsing/OCR half of the public tool
`pipiui_firecrawl_pdf`. Extracted from the former built-in runtime extension
(`resources/runtime/extensions/pipiui-firecrawl-pdf.ts` + siblings); until the
host cutover lands, that legacy file keeps mounting in parallel with identical
behavior.

## What this package owns

- `agent/index.ts` — tool contract: source validation (absolute path / `file://`
  / http(s)), 50 MB limit, `%PDF-` magic check, `auto`/`fast`/`ocr` routing,
  temp-file cleanup for URL downloads, secret redaction on surfaced errors.
- `agent/pdf-inspector-local.ts` — vendored `@firecrawl/pdf-inspector` 1.15.0
  native/WASM adapter under `vendor/pdf-inspector/node_modules`, resolved
  relative to this package only; there is no host env-root override.
- `agent/paddleocr-mcp-client.ts` — newline-delimited JSON-RPC stdio client for
  `uvx --from paddleocr-mcp paddleocr_mcp` (`paddleocr_vl`), token only ever in
  the child env.

## Token source

Precedence: extension-secret env `EXT_PDF_EXTENSION_AISTUDIOACCESSTOKEN`
(derived from the namespaced project setting key
`ext.pdf-extension.aistudioAccessToken`, injected by a later host cutover),
then the legacy per-project `<agentDir>/paddleocr.json` field
`aistudioAccessToken`. The legacy file stays authoritative until migration is
proven; secrets are never echoed back to the UI.

## Build / mirror

`npm run build -w @pipiui/pipiui-pdf-extension` compiles `agent/dist` and its
postbuild runs `scripts/sync-bundled-extension.mjs`, regenerating the runtime
mirror at `resources/runtime/extensions/pdf-extension` (manifest, compiled
agent, and the declared `vendor/pdf-inspector` dependency tree). Never edit the
mirror by hand.
