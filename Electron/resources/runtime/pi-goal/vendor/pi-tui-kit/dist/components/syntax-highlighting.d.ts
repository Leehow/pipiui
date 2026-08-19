import type { Theme } from "@earendil-works/pi-coding-agent";
export type SyntaxTheme = Pick<Theme, "fg" | "bold"> & Partial<Pick<Theme, "italic" | "underline">>;
export declare function getLanguageFromPath(filePath: string): string | undefined;
export declare function highlightCode(code: string, language: string | undefined, theme: SyntaxTheme): string;
