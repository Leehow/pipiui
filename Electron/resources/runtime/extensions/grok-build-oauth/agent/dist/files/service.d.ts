import { type GrokCredentialBroker } from "../oauth/broker.js";
import { FilesClient } from "./client.js";
export type InputFilesService = {
    upload(input: {
        bytes: Uint8Array;
        name: string;
        mimeType?: string;
        signal?: AbortSignal;
    }): Promise<{
        fileId: string;
        name: string;
        size: number;
        mimeType: string;
        digest: string;
    }>;
    remove(fileId: string, signal?: AbortSignal): Promise<void>;
};
export type InputFilesServiceOptions = {
    authPath?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    broker?: GrokCredentialBroker;
    client?: FilesClient;
};
export declare function createInputFilesService(options?: InputFilesServiceOptions): InputFilesService;
