import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MenuScreen } from "../types.js";
type MermaidTheme = Pick<Theme, "fg" | "bold">;
export declare function supportsRichMarkdown(): boolean;
export declare function prepareMermaidRenderer(): Promise<void> | undefined;
export declare function prepareMenuScreenRendering<ScreenId extends string, ActionId extends string>(screen: MenuScreen<ScreenId, ActionId>): Promise<void> | undefined;
export declare function mermaidMarkdownTransform(theme: MermaidTheme): ((markdown: string, availableWidth: number) => string) | undefined;
export {};
