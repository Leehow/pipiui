import { type Candidate, type PreparedEntry } from "./types.js";
export interface HeadroomClientOptions {
    baseUrl: string;
    healthTimeoutMs: number;
    requestTimeoutMs: number;
    fetchImpl?: typeof fetch;
}
export type CompressionOutcome = PreparedEntry | {
    status: "skipped";
    reason: "noop";
} | {
    status: "rejected";
    reason: string;
};
export declare const HEADROOM_EXACT_RETRIEVAL_NOTICE = "[Full original tool result available. Call headroom_retrieve with no arguments to retrieve it exactly.]";
export declare function buildCompressPayload(candidate: Candidate, modelId: string): {
    model: string;
    messages: ({
        role: string;
        tool_calls: {
            id: string;
            type: string;
            function: {
                name: string;
                arguments: string;
            };
        }[];
        tool_call_id?: undefined;
        content?: undefined;
    } | {
        role: string;
        tool_call_id: string;
        content: string;
        tool_calls?: undefined;
    })[];
    config: {
        compress_user_messages: boolean;
        mode: string;
    };
};
export declare function validateCompression(candidate: Candidate, response: unknown, retrieve: (hash: string) => Promise<string | undefined>): Promise<CompressionOutcome>;
export declare class HeadroomClient {
    #private;
    constructor(options: HeadroomClientOptions);
    health(signal?: AbortSignal): Promise<boolean>;
    compress(candidate: Candidate, modelId: string, signal?: AbortSignal): Promise<unknown>;
    retrieve(hash: string, signal?: AbortSignal): Promise<string | undefined>;
}
