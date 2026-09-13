import type { HeadroomConfig } from "./types.js";
export declare const HEADROOM_UPSTREAM_VERSION = "0.37.0";
export declare const HEADROOM_SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_PIPIUI_HEADROOM";
export declare const DEFAULT_CONFIG: Readonly<HeadroomConfig>;
export interface LoadedConfig {
    config: HeadroomConfig;
    warnings: string[];
}
export declare function normalizeLoopbackUrl(value: unknown): string | undefined;
export declare function loadHeadroomConfig(env?: NodeJS.ProcessEnv): LoadedConfig;
