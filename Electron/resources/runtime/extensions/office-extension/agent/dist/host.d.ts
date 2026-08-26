/**
 * Stable host library entry (`agent/dist/host.js`). Direct-only: exposes the
 * adapter, binary resolution, and the tool contract. It does not speak MCP.
 */
export { DirectOfficeAdapter, createDirectOfficeAdapter } from "./adapter.js";
export type { DirectOfficeAdapterOptions, DirectOfficeResult, GateMetadata, OfficeCommandInput, WriteSemantics, } from "./adapter.js";
export { DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_OUTPUT_LIMIT, DEFAULT_STARTUP_TIMEOUT_MS, } from "./adapter.js";
export { resolveOfficeCliBinary, bundledOfficeCliCandidate, packageRoot, PIPIUI_OFFICECLI_BINARY_ENV, OFFICECLI_RECEIPT_NAME, readOfficeCliReceipt, } from "./binary.js";
export { DIRECT_OFFICECLI_TOOL, OFFICE_COMMAND_INPUT_SCHEMA, createDirectOfficeTrack, officeCommandFixture, } from "./tool-contract.js";
export { OFFICECLI_PROVENANCE, OFFICECLI_WRITE_ATOMICITY } from "./provenance.js";
export { ensureOfficeCliUpdateDisabled, OFFICECLI_SKIP_UPDATE_ENV, SDK_FORCED_OPEN_OPTIONS } from "./sdk.js";
export { OFFICE_FORMAT_POLICIES, officeFormatPolicy } from "./edit-policy.js";
export { parseOfficeCommand } from "./command.js";
