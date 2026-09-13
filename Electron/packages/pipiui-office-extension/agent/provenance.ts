/** Upstream identity. Native binaries ship via the checksum-pinned target cache. */
export const OFFICECLI_PROVENANCE = {
  sdkName: "@officecli/sdk",
  sdkVersion: "0.1.2",
  sdkLicense: "Apache-2.0",
  upstreamRepository: "https://github.com/iOfficeAI/OfficeCLI",
  upstreamMaintainer: "goworm",
  upstreamLicense: "Apache-2.0",
  cliVersion: "1.0.147",
  binaryLayout: "bin/<platform>-<arch>/officecli",
  binaryCacheLayout: "Electron/.officecli/<platform>-<arch>/extensions/office-extension/bin/<platform>-<arch>/officecli",
  binaryReceipt: "receipt.json",
  binaryAssetsMetadata: "Electron/officecli-assets.json",
  binaryStatus: "shipped-via-target-cache",
  autoInstall: false,
  mcpTransport: false,
} as const;

export const OFFICECLI_WRITE_ATOMICITY = {
  flush: "officecli-document-close",
  atomicRename: false,
  limitation:
    "@officecli/sdk@0.1.2 Document.close() flushes in-memory state onto the original path; the SDK does not expose atomic temp+rename. Path checks reject symlink components and re-validate immediately before open/create, but a directory can still be replaced between that last check and the SDK process opening the path — irreducible without OS file-handle passing, which the SDK does not expose.",
} as const;
