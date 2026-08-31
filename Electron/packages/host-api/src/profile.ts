/** Path-free Product Profile summary exposed to every Pipi UI. */
export type ProductProfileDescriptor = {
  id: string;
  name: string;
  description?: string;
  state: "available" | "error";
  source?: "builtin" | "project";
  /** Only Settings-created project Profiles expose membership editing. */
  customizable?: boolean;
  error?: string;
  layout?: {
    primarySidebar?: string;
    center?: string;
    auxiliarySidebar?: string;
    activity?: string[];
  };
  requiredExtensionIds?: string[];
  recommendedExtensionIds?: string[];
};

/** Project-owned activation snapshot; extension settings and secrets are separate. */
export type ProjectProductActivation = {
  schemaVersion: 2;
  profile: string;
  overrides: Record<string, "enabled" | "disabled">;
};
