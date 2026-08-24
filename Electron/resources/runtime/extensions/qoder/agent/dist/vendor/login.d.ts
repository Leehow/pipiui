import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
export declare function generatePKCE(): {
    codeVerifier: string;
    codeChallenge: string;
};
export declare function interactiveLogin(callbacks: OAuthLoginCallbacks, mode?: string): Promise<OAuthCredentials>;
