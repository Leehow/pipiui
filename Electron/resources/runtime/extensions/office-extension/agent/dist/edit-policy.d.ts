/**
 * Agent-side edit policy owned by the extension, pinned to the frozen
 * docs/office/format-matrix.json corpus. Preview policy stays in app/.
 */
export declare const TIER1_EDIT_EXTENSIONS: readonly [".docx", ".xlsx", ".pptx"];
export declare const MACRO_CONTAINER_EXTENSIONS: readonly [".docm", ".xlsm", ".pptm"];
export declare const TIER2_PREVIEW_EXTENSIONS: readonly [".doc", ".rtf", ".odt", ".epub", ".xls", ".xlsb", ".ods", ".ppt", ".pps", ".ppsx", ".ppsm", ".pot", ".odp"];
export declare const GATE_ONLY_TEMPLATE_EXTENSIONS: readonly [".dot", ".dotx", ".xlt", ".xltx", ".potx"];
export type OfficeEditTier = "tier1-guaranteed-edit" | "macro-preview-preserve" | "tier2-best-effort-preview" | "gate-only-template";
export type OfficeEditContract = "guaranteed" | "preserve-only" | "not-promised";
export type OfficeFormatPolicy = {
    extension: string;
    tier: OfficeEditTier;
    editContract: OfficeEditContract;
    macroContainer: boolean;
    shotGateCovered: boolean;
    writesAllowed: boolean;
};
export declare const OFFICE_FORMAT_POLICIES: readonly OfficeFormatPolicy[];
export declare function normalizeExtension(value: string): string;
export declare function officeFormatPolicy(extension: string): OfficeFormatPolicy | undefined;
export declare function isSupportedOfficeExtension(extension: string): boolean;
