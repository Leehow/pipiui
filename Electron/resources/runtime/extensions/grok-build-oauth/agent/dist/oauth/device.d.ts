export type DeviceCode = {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
};
export type TokenSuccess = {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    id_token?: string;
};
export declare class OAuthError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare function requestDeviceCode(opts: {
    issuer: string;
    clientId: string;
    scopes: string[];
    referrer: string;
    surface?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<DeviceCode>;
export declare function pollDeviceToken(opts: {
    issuer: string;
    clientId: string;
    deviceCode: DeviceCode;
    surface?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    clock?: {
        nowMs: () => number;
        sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    };
}): Promise<TokenSuccess>;
export declare function refreshAccessToken(opts: {
    issuer: string;
    clientId: string;
    refreshToken: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<TokenSuccess>;
