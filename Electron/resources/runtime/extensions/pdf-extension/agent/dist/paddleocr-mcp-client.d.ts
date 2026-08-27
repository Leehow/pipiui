import { type ChildProcessWithoutNullStreams } from "node:child_process";
export declare const PADDLEOCR_VL_TOOL = "paddleocr_vl";
export declare const PADDLEOCR_MCP_COMMAND = "uvx";
export declare const PADDLEOCR_MCP_ARGS: string[];
export declare const PADDLEOCR_MCP_MODEL = "PaddleOCR-VL-1.6";
export declare const PADDLEOCR_MCP_SOURCE = "aistudio";
export type PaddleocrSpawnFn = (command: string, args: string[], options: Record<string, unknown>) => ChildProcessWithoutNullStreams;
export declare function paddleocrMcpEnv(token?: string, parent?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function extractMcpText(result: unknown): string;
export declare function redactSecret(text: string, secret?: string): string;
export declare function callPaddleocrVl(options: {
    filePath: string;
    token: string;
    spawnFn?: PaddleocrSpawnFn;
    env?: NodeJS.ProcessEnv;
}): Promise<{
    ok: true;
    text: string;
} | {
    ok: false;
    error: string;
}>;
