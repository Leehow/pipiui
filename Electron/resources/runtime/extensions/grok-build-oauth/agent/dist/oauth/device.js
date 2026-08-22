import { xGrokClientVersion } from "./config.js";
import { assertHttpsIssuer } from "./config.js";
import { redactMessage } from "./redact.js";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_GRANT = "refresh_token";
const MIN_INTERVAL_SECS = 1;
const DEFAULT_INTERVAL_SECS = 5;
const DEFAULT_EXPIRES_SECS = 10 * 60;
/** slow_down growth per spec §D4: interval *= 1.5, capped. */
const SLOW_DOWN_FACTOR = 1.5;
const SLOW_DOWN_INTERVAL_CAP_SECS = 30;
/** Per-request network timeout (device/token/refresh); refresh keeps it short. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export class OAuthError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
function mergedSignal(userSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return userSignal ? AbortSignal.any([userSignal, timeout]) : timeout;
}
function validateUserCode(code) {
    if (!code || !/^[A-Za-z0-9-]+$/.test(code)) {
        throw new OAuthError("invalid_response", "Server returned invalid user_code format");
    }
}
/**
 * Validate a verification URI. HTTPS only — the device verification page is
 * entered by the user with the user_code; a plain-HTTP page would let a
 * network attacker swap the code (round-2 reviewer: no loopback-HTTP
 * tolerance for issuers; local fakes use an https stub or the relay-free
 * test transport instead).
 */
function validateVerificationUri(uri) {
    if ([...uri].some((c) => c.charCodeAt(0) < 0x20)) {
        throw new OAuthError("invalid_response", "Server returned invalid verification URI");
    }
    let parsed;
    try {
        parsed = new URL(uri);
    }
    catch {
        throw new OAuthError("invalid_response", "Server returned invalid verification URI");
    }
    if (parsed.protocol !== "https:") {
        throw new OAuthError("invalid_response", "Server returned unsupported verification URI scheme (HTTPS only)");
    }
}
function sleepMs(ms, signal) {
    if (signal?.aborted)
        return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        const onAbort = () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal)
            signal.addEventListener("abort", onAbort, { once: true });
    });
}
export async function requestDeviceCode(opts) {
    if (opts.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
    assertHttpsIssuer(opts.issuer);
    const url = `${opts.issuer.replace(/\/+$/, "")}/oauth2/device/code`;
    const scopeStr = opts.scopes.join(" ");
    const fetchFn = opts.fetchImpl ?? fetch;
    const headers = {
        "x-grok-client-version": xGrokClientVersion(),
        "x-grok-client-surface": opts.surface ?? "cli",
    };
    const body = new URLSearchParams({
        client_id: opts.clientId,
        scope: scopeStr,
        referrer: opts.referrer,
    });
    const resp = await fetchFn(url, {
        method: "POST",
        headers: {
            ...headers,
            "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: mergedSignal(opts.signal),
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        if (resp.status === 404)
            throw new OAuthError("not_enabled", "Device-code login is not available for this deployment");
        throw new OAuthError("device_code_failed", `Device code request failed (HTTP ${resp.status}): ${text.slice(0, 500)}`);
    }
    const data = (await resp.json().catch(() => null));
    if (!data || typeof data.device_code !== "string" || typeof data.user_code !== "string" || typeof data.verification_uri !== "string") {
        throw new OAuthError("invalid_response", "Device code response missing required fields");
    }
    validateUserCode(data.user_code);
    validateVerificationUri(data.verification_uri);
    if (typeof data.verification_uri_complete === "string" && data.verification_uri_complete) {
        validateVerificationUri(data.verification_uri_complete);
    }
    const interval = typeof data.interval === "number" && Number.isFinite(data.interval) ? Math.max(MIN_INTERVAL_SECS, Math.floor(data.interval)) : DEFAULT_INTERVAL_SECS;
    // Honor the server's expiry as-is (spec §D4/§D6-06); only default when absent.
    const expires_in = typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0 ? Math.floor(data.expires_in) : DEFAULT_EXPIRES_SECS;
    return {
        device_code: data.device_code,
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        verification_uri_complete: typeof data.verification_uri_complete === "string" ? data.verification_uri_complete : undefined,
        expires_in,
        interval,
    };
}
export async function pollDeviceToken(opts) {
    assertHttpsIssuer(opts.issuer);
    const url = `${opts.issuer.replace(/\/+$/, "")}/oauth2/token`;
    const fetchFn = opts.fetchImpl ?? fetch;
    const sleep = opts.clock
        ? (ms) => opts.clock.sleep(ms, opts.signal)
        : (ms) => sleepMs(ms, opts.signal);
    const nowMs = opts.clock ? () => opts.clock.nowMs() : () => Date.now();
    let intervalMs = Math.max(MIN_INTERVAL_SECS, opts.deviceCode.interval) * 1000;
    // Honor the device code's expires_in as the total deadline (spec §D4),
    // checked before AND after each sleep/fetch so a hung request cannot blow
    // through the total window.
    const deadlineMs = nowMs() + Math.max(1, opts.deviceCode.expires_in) * 1000;
    const headers = {
        "x-grok-client-version": xGrokClientVersion(),
        "x-grok-client-surface": opts.surface ?? "cli",
    };
    // sleep first per official: avoid immediate pending
    while (true) {
        if (nowMs() > deadlineMs) {
            throw new OAuthError("expired_token", "Device code expired. Please retry login.");
        }
        await sleep(intervalMs);
        if (nowMs() > deadlineMs) {
            throw new OAuthError("expired_token", "Device code expired. Please retry login.");
        }
        if (opts.signal?.aborted)
            throw new DOMException("Aborted", "AbortError");
        const body = new URLSearchParams({
            grant_type: DEVICE_GRANT,
            device_code: opts.deviceCode.device_code,
            client_id: opts.clientId,
        });
        const resp = await fetchFn(url, {
            method: "POST",
            headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            // Per-request timeout is clamped to the remaining device-code deadline so
            // a hung request cannot blow past `expires_in` (round-2 reviewer warning).
            signal: mergedSignal(opts.signal, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.max(1_000, deadlineMs - nowMs()))),
        });
        if (resp.ok) {
            const tokens = (await resp.json().catch(() => null));
            if (!tokens || typeof tokens.access_token !== "string" || !tokens.access_token) {
                throw new OAuthError("invalid_response", "Token response missing access_token");
            }
            return tokens;
        }
        let errBody = null;
        try {
            errBody = (await resp.json());
        }
        catch {
            const text = await resp.text().catch(() => "");
            const redacted = redactMessage(text.slice(0, 500), [opts.deviceCode.device_code]);
            throw new OAuthError("token_failed", `Token exchange failed (HTTP ${resp.status}): ${redacted}`);
        }
        const error = typeof errBody?.error === "string" ? errBody.error : "";
        const desc = typeof errBody?.error_description === "string" ? errBody.error_description : error;
        switch (error) {
            case "authorization_pending":
                continue;
            case "slow_down":
                intervalMs = Math.min(SLOW_DOWN_INTERVAL_CAP_SECS * 1000, Math.round(intervalMs * SLOW_DOWN_FACTOR));
                continue;
            case "access_denied":
            case "authorization_denied":
                throw new OAuthError("access_denied", "Authorization denied. The user rejected the request.");
            case "expired_token":
                throw new OAuthError("expired_token", desc || "Device code expired. Please retry login.");
            default: {
                const msg = desc || `Token exchange error: ${error || resp.status}`;
                throw new OAuthError("token_failed", redactMessage(String(msg).slice(0, 800), [opts.deviceCode.device_code]));
            }
        }
    }
}
export async function refreshAccessToken(opts) {
    if (opts.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
    // Defense in depth: the refresh token is a long-lived credential; it is
    // only ever posted to an HTTPS issuer (config already enforces this).
    assertHttpsIssuer(opts.issuer);
    const url = `${opts.issuer.replace(/\/+$/, "")}/oauth2/token`;
    const fetchFn = opts.fetchImpl ?? fetch;
    const body = new URLSearchParams({
        grant_type: REFRESH_GRANT,
        refresh_token: opts.refreshToken,
        client_id: opts.clientId,
    });
    const resp = await fetchFn(url, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-grok-client-version": xGrokClientVersion(),
        },
        body: body.toString(),
        signal: mergedSignal(opts.signal),
    });
    if (!resp.ok) {
        let errBody = null;
        try {
            errBody = (await resp.json());
        }
        catch {
            const text = await resp.text().catch(() => "");
            throw new OAuthError("refresh_failed", `Refresh failed (HTTP ${resp.status}): ${text.slice(0, 500)}`);
        }
        const error = typeof errBody?.error === "string" ? errBody.error : `HTTP ${resp.status}`;
        const desc = typeof errBody?.error_description === "string" ? errBody.error_description : String(error);
        // Normalize invalid_grant -> access_denied style for caller to clear creds
        if (error === "invalid_grant" || error === "invalid_request") {
            throw new OAuthError("invalid_grant", redactMessage(desc, [opts.refreshToken]));
        }
        throw new OAuthError("refresh_failed", redactMessage(desc.slice(0, 800), [opts.refreshToken]));
    }
    const tokens = (await resp.json().catch(() => null));
    if (!tokens || typeof tokens.access_token !== "string" || !tokens.access_token) {
        throw new OAuthError("invalid_response", "Refresh response missing access_token");
    }
    return tokens;
}
