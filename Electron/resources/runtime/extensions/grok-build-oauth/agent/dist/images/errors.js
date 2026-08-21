/**
 * M4 — Images transport error model.
 * Error codes follow spec §D10; every message is redacted before surfacing.
 */
export class ImagesError extends Error {
    code;
    status;
    constructor(code, message, status) {
        super(message);
        this.name = "ImagesError";
        this.code = code;
        this.status = status;
    }
}
/**
 * Advisory upsell prose returned (as a successful text result) when the
 * client-side tier gate short-circuits a call for free / X Basic tiers.
 * Mirrors official Grok Build `TIER_RESTRICTED_UPSELL` semantics; the
 * server remains the final authority.
 */
export const TIER_RESTRICTED_UPSELL = "图像生成是 SuperGrok 订阅功能，Free 或 X Basic tier 暂不可用。请告知用户可升级至 SuperGrok 解锁图像与视频生成：https://grok.com/supergrok?referrer=grok-build 。请勿重试此工具。";
