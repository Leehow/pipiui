import type { OAuthCredentials } from "@earendil-works/pi-ai";
export interface QoderProviderUsage {
    summary?: string;
    subscriptionTitle?: string;
    resetAt?: string;
    manageUrl?: string;
    usageBuckets?: Array<{
        id: string;
        label: string;
        usedDisplay: string;
        limitDisplay?: string;
        unit?: string;
        resetAt?: string;
    }>;
    raw?: Record<string, unknown>;
}
export declare function fetchQoderUsage(credentials: OAuthCredentials): Promise<QoderProviderUsage>;
export declare function fetchQoderUsageCN(credentials: OAuthCredentials): Promise<QoderProviderUsage>;
