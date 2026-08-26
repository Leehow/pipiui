/** Upstream identity. Native binaries ship via the checksum-pinned target cache. */
export declare const OFFICECLI_PROVENANCE: {
    readonly sdkName: "@officecli/sdk";
    readonly sdkVersion: "0.1.2";
    readonly sdkLicense: "Apache-2.0";
    readonly upstreamRepository: "https://github.com/iOfficeAI/OfficeCLI";
    readonly upstreamMaintainer: "goworm";
    readonly upstreamLicense: "Apache-2.0";
    readonly cliVersion: "1.0.144";
    readonly binaryLayout: "bin/<platform>-<arch>/officecli";
    readonly binaryCacheLayout: "Electron/.officecli/<platform>-<arch>/extensions/office-extension/bin/<platform>-<arch>/officecli";
    readonly binaryReceipt: "receipt.json";
    readonly binaryAssetsMetadata: "Electron/officecli-assets.json";
    readonly binaryStatus: "shipped-via-target-cache";
    readonly autoInstall: false;
    readonly mcpTransport: false;
};
export declare const OFFICECLI_WRITE_ATOMICITY: {
    readonly flush: "officecli-document-close";
    readonly atomicRename: false;
    readonly limitation: "@officecli/sdk@0.1.2 Document.close() flushes in-memory state onto the original path; the SDK does not expose atomic temp+rename. Path checks reject symlink components and re-validate immediately before open/create, but a directory can still be replaced between that last check and the SDK process opening the path — irreducible without OS file-handle passing, which the SDK does not expose.";
};
