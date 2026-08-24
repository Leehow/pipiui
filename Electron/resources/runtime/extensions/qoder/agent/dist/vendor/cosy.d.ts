export type QoderMode = "global" | "cn";
export interface CosyCredentials {
    userID: string;
    authToken: string;
    name: string;
    email: string;
    machineID?: string;
}
export declare function getQoderMode(modeOverride?: string): QoderMode;
export declare function isQoderCNMode(modeOverride?: string): boolean;
export declare function getQoderCNPat(): string;
export declare function getQoderBaseUrl(mode?: string): string;
export declare function getQoderOpenApiUrl(mode?: string): string;
export declare function getQoderCenterUrl(mode?: string): string;
export declare function getQoderModelListURL(mode?: string): string;
export declare function getQoderChatURL(mode?: string): string;
export declare function getQoderExchangeURL(mode?: string): string;
export declare function getQoderUserInfoURL(mode?: string): string;
export declare function getQoderUsageURL(mode?: string): string;
export declare function getQoderRefreshURL(mode?: string): string;
export declare function getQoderCNDirectModel(modelID?: string): string;
export declare function getQoderCNFriendlyModelInfo(key: string, display?: string): {
    id: string;
    name: string;
};
export declare function toQoderCNFriendlyModel<T extends {
    id: string;
    name: string;
}>(model: T): T;
export declare function getQoderManageUrl(mode?: string): string;
export declare function getQoderUserEmailFallback(mode?: string): string;
export declare function getMachineId(): string;
export declare function buildAuthHeaders(body: Buffer | string | null, requestURL: string, creds: CosyCredentials): Record<string, string>;
