import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type DirectOfficeAdapter, type DirectOfficeAdapterOptions } from "./adapter.js";
export declare const OFFICE_EXTENSION_ID = "office-extension";
export declare function createOfficeAdapter(overrides?: Partial<DirectOfficeAdapterOptions>): DirectOfficeAdapter;
export declare function registerOfficeDirectTool(pi: Pick<ExtensionAPI, "registerTool">, adapter: DirectOfficeAdapter): void;
export default function officeExtension(pi: ExtensionAPI): void;
