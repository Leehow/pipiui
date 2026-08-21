/**
 * M4 — Images transport error model.
 * Error codes follow spec §D10; every message is redacted before surfacing.
 */
export type ImagesErrorCode = "invalid_params" | "invalid_response" | "auth_expired" | "tier_restricted" | "rate_limited" | "upstream_error" | "http_failure" | "aborted";
export declare class ImagesError extends Error {
    readonly code: ImagesErrorCode;
    readonly status?: number;
    constructor(code: ImagesErrorCode, message: string, status?: number);
}
/**
 * Advisory upsell prose returned (as a successful text result) when the
 * client-side tier gate short-circuits a call for free / X Basic tiers.
 * Mirrors official Grok Build `TIER_RESTRICTED_UPSELL` semantics; the
 * server remains the final authority.
 */
export declare const TIER_RESTRICTED_UPSELL = "\u56FE\u50CF\u751F\u6210\u662F SuperGrok \u8BA2\u9605\u529F\u80FD\uFF0CFree \u6216 X Basic tier \u6682\u4E0D\u53EF\u7528\u3002\u8BF7\u544A\u77E5\u7528\u6237\u53EF\u5347\u7EA7\u81F3 SuperGrok \u89E3\u9501\u56FE\u50CF\u4E0E\u89C6\u9891\u751F\u6210\uFF1Ahttps://grok.com/supergrok?referrer=grok-build \u3002\u8BF7\u52FF\u91CD\u8BD5\u6B64\u5DE5\u5177\u3002";
