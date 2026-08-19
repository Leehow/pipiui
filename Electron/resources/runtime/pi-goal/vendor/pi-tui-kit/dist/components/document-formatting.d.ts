import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ReviewFormat } from "../types.js";
export declare const RPC_DOCUMENT_LINE_WIDTH = 120;
export declare const RPC_DOCUMENT_PAGE_SIZE = 8;
type DocumentTheme = Pick<Theme, "fg" | "bold"> & Partial<Pick<Theme, "italic" | "underline" | "strikethrough">>;
export declare function createDocumentLineCache(theme: DocumentTheme): {
    lines(content: string, format: ReviewFormat | undefined, width: number): string[];
    invalidate(): void;
};
export declare function formatDocumentLines(content: string, format: ReviewFormat | undefined, width: number, theme: DocumentTheme): string[];
export declare function plainDocumentLines(content: string, width: number): string[];
export declare function documentDialogPages(content: string, width: number, pageSize: number): string[][];
export {};
