/**
 * Agent-side edit policy owned by the extension, pinned to the frozen
 * docs/office/format-matrix.json corpus. Preview policy stays in app/.
 */

export const TIER1_EDIT_EXTENSIONS = [".docx", ".xlsx", ".pptx"] as const;
export const MACRO_CONTAINER_EXTENSIONS = [".docm", ".xlsm", ".pptm"] as const;
export const TIER2_PREVIEW_EXTENSIONS = [
  ".doc",
  ".rtf",
  ".odt",
  ".epub",
  ".xls",
  ".xlsb",
  ".ods",
  ".ppt",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".odp",
] as const;
export const GATE_ONLY_TEMPLATE_EXTENSIONS = [".dot", ".dotx", ".xlt", ".xltx", ".potx"] as const;

export type OfficeEditTier =
  | "tier1-guaranteed-edit"
  | "macro-preview-preserve"
  | "tier2-best-effort-preview"
  | "gate-only-template";

export type OfficeEditContract = "guaranteed" | "preserve-only" | "not-promised";

export type OfficeFormatPolicy = {
  extension: string;
  tier: OfficeEditTier;
  editContract: OfficeEditContract;
  macroContainer: boolean;
  shotGateCovered: boolean;
  writesAllowed: boolean;
};

const POLICIES: readonly OfficeFormatPolicy[] = [
  { extension: ".docx", tier: "tier1-guaranteed-edit", editContract: "guaranteed", macroContainer: false, shotGateCovered: true, writesAllowed: true },
  { extension: ".xlsx", tier: "tier1-guaranteed-edit", editContract: "guaranteed", macroContainer: false, shotGateCovered: true, writesAllowed: true },
  { extension: ".pptx", tier: "tier1-guaranteed-edit", editContract: "guaranteed", macroContainer: false, shotGateCovered: true, writesAllowed: true },
  { extension: ".docm", tier: "macro-preview-preserve", editContract: "preserve-only", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".xlsm", tier: "macro-preview-preserve", editContract: "preserve-only", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".pptm", tier: "macro-preview-preserve", editContract: "preserve-only", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".doc", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".rtf", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: false, shotGateCovered: false, writesAllowed: false },
  { extension: ".odt", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: false, shotGateCovered: false, writesAllowed: false },
  { extension: ".epub", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: false, shotGateCovered: false, writesAllowed: false },
  { extension: ".xls", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".xlsb", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".ods", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: false, shotGateCovered: false, writesAllowed: false },
  { extension: ".ppt", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".pps", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".ppsx", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: false, shotGateCovered: true, writesAllowed: false },
  { extension: ".ppsm", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: false, writesAllowed: false },
  { extension: ".pot", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".odp", tier: "tier2-best-effort-preview", editContract: "not-promised", macroContainer: false, shotGateCovered: false, writesAllowed: false },
  { extension: ".dot", tier: "gate-only-template", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".dotx", tier: "gate-only-template", editContract: "not-promised", macroContainer: false, shotGateCovered: true, writesAllowed: false },
  { extension: ".xlt", tier: "gate-only-template", editContract: "not-promised", macroContainer: true, shotGateCovered: true, writesAllowed: false },
  { extension: ".xltx", tier: "gate-only-template", editContract: "not-promised", macroContainer: false, shotGateCovered: true, writesAllowed: false },
  { extension: ".potx", tier: "gate-only-template", editContract: "not-promised", macroContainer: false, shotGateCovered: true, writesAllowed: false },
];

const BY_EXT = new Map(POLICIES.map((row) => [row.extension, row]));

export const OFFICE_FORMAT_POLICIES = POLICIES;

export function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function officeFormatPolicy(extension: string): OfficeFormatPolicy | undefined {
  return BY_EXT.get(normalizeExtension(extension));
}

export function isSupportedOfficeExtension(extension: string): boolean {
  return BY_EXT.has(normalizeExtension(extension));
}
