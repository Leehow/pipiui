import { type SafeInputFile } from "./types.js";
export declare function inputFilesStorePath(agentHome: string, sessionId: string): string;
export declare class SessionInputFileStore {
    private readonly agentHome;
    constructor(agentHome: string);
    list(sessionId: string): Promise<SafeInputFile[]>;
    write(sessionId: string, attachments: readonly SafeInputFile[]): Promise<SafeInputFile[]>;
    upsert(sessionId: string, attachment: SafeInputFile): Promise<SafeInputFile[]>;
    remove(sessionId: string, attachmentId: string): Promise<{
        removed?: SafeInputFile;
        attachments: SafeInputFile[];
    }>;
    findReusable(attachments: readonly SafeInputFile[], digest: string): SafeInputFile | undefined;
    materialized(attachments: readonly SafeInputFile[]): SafeInputFile[];
}
