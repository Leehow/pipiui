import type { OAuthCredentials } from "@earendil-works/pi-ai";
/**
 * Marker prefix used in the credential `refresh` field to identify PAT-based
 * credentials. Layout: `pat|<personalToken>|<jobRefreshToken>|<userID>|<machineID>`
 */
export declare const PAT_REFRESH_PREFIX = "pat";
export interface PatExchangeResult {
    /** Short-lived job token (jt-...) used for auth + COSY signatures. */
    jobToken: string;
    /** Job refresh token (jrt-...), if returned. */
    jobRefreshToken: string;
    expiresAt: number;
}
export declare function isPatRefresh(refresh: string): boolean;
/** Encode a PAT credential's refresh field. */
export declare function encodePatRefresh(pat: string, jobRefreshToken: string, userID: string, machineID: string): string;
/** Decode a PAT credential's refresh field. */
export declare function decodePatRefresh(refresh: string): {
    pat: string;
    jobRefreshToken: string;
    userID: string;
    machineID: string;
};
/**
 * Exchange a Qoder Personal Access Token (pt-...) for a short-lived Job Token
 * (jt-...). PATs cannot authenticate API calls directly; they must first be
 * exchanged. This mirrors the official qodercli/qoderclicn flow:
 *   POST /api/v1/jobToken/exchange { personal_token } -> { token, refresh_token, expires_at }
 * The exchange endpoint does not require a COSY signature.
 */
export declare function exchangeJobToken(pat: string, mode?: string): Promise<PatExchangeResult>;
/**
 * Build full Qoder credentials from a Personal Access Token.
 * Exchanges the PAT for a job token, resolves identity, and encodes the PAT
 * into the refresh field so the token can be re-exchanged on expiry.
 */
export declare function credentialsFromPat(pat: string, mode?: string): Promise<OAuthCredentials>;
