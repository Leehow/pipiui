import crypto from "node:crypto";
import { getMachineId, getQoderMode, isQoderCNMode } from "./cosy.js";
import { credentialsFromPat } from "./pat.js";
function getPrompt(callbacks) {
    return callbacks.onPrompt;
}
function getProgress(callbacks) {
    return callbacks.onProgress;
}
function getSignal(callbacks) {
    return callbacks.signal;
}
export function generatePKCE() {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    return { codeVerifier, codeChallenge };
}
function parseExpiresAt(s, expiresInSeconds) {
    if (s) {
        const t = Date.parse(s);
        if (!Number.isNaN(t))
            return t;
        const ms = Number.parseInt(s, 10);
        if (!Number.isNaN(ms) && ms > 0)
            return ms;
    }
    if (expiresInSeconds && expiresInSeconds > 0) {
        return Date.now() + expiresInSeconds * 1000;
    }
    return Date.now() + 30 * 24 * 60 * 60 * 1000; // default 30 days
}
export async function interactiveLogin(callbacks, mode = getQoderMode()) {
    // pi drives this via its built-in LoginDialog, which wires onPrompt/onAuth/
    // onProgress to a focused input. We must use those callbacks directly rather
    // than opening our own ctx.ui.custom surface (which would steal focus and
    // leave onPrompt unable to receive keystrokes).
    const prompt = getPrompt(callbacks);
    const pat = await prompt({
        message: isQoderCNMode(mode)
            ? "Paste a Qoder CN Personal Access Token, or leave empty to cancel"
            : "Paste a Qoder Personal Access Token (pt-...), or leave empty for browser login",
        placeholder: "pt-...",
        allowEmpty: true,
    });
    if (getSignal(callbacks)?.aborted)
        throw new Error("Login cancelled");
    if (pat?.trim()) {
        return patLogin(callbacks, pat.trim(), mode);
    }
    if (isQoderCNMode(mode)) {
        throw new Error("Qoder CN browser login is not supported here. Paste a Qoder CN PAT from https://qoder.com.cn/account/integrations or set QODERCN_PERSONAL_ACCESS_TOKEN.");
    }
    if (getSignal(callbacks)?.aborted)
        throw new Error("Login cancelled");
    return runDeviceFlow(callbacks);
}
/** Prompt for a PAT (if not provided) and exchange it for full credentials. */
async function patLogin(callbacks, providedPat, mode = getQoderMode()) {
    let pat = providedPat;
    if (!pat) {
        const prompt = getPrompt(callbacks);
        const entered = await prompt({
            message: isQoderCNMode(mode)
                ? "Paste your Qoder CN Personal Access Token"
                : "Paste your Qoder Personal Access Token (pt-...)",
            placeholder: "pt-...",
            allowEmpty: false,
        });
        if (getSignal(callbacks)?.aborted)
            throw new Error("Login cancelled");
        pat = entered?.trim();
    }
    if (!pat) {
        throw new Error("No Personal Access Token provided");
    }
    getProgress(callbacks)?.("Exchanging access token...");
    const creds = await credentialsFromPat(pat, mode);
    getProgress(callbacks)?.("Login successful!");
    return creds;
}
function abortableDelay(ms, signal) {
    if (signal?.aborted)
        return Promise.reject(signal.reason || new Error("Login cancelled"));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason || new Error("Login cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
async function runDeviceFlow(callbacks) {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const nonce = crypto.randomUUID();
    const machineID = getMachineId();
    const verificationURI = `https://qoder.com/device/selectAccounts?challenge=${codeChallenge}&challenge_method=S256&machine_id=${machineID}&nonce=${nonce}`;
    getProgress(callbacks)?.("Please complete login in your browser...");
    callbacks.onAuth({
        url: verificationURI,
        instructions: "Click to sign in with your Qoder account in the browser.",
    });
    const pollURL = `https://openapi.qoder.sh/api/v1/deviceToken/poll?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;
    const pollInterval = 2000;
    const maxAttempts = 90; // 3 minutes
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (getSignal(callbacks)?.aborted)
            throw new Error("Login cancelled");
        await abortableDelay(pollInterval, getSignal(callbacks));
        try {
            const response = await fetch(pollURL, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    "User-Agent": "pi-provider-qoder",
                },
                signal: getSignal(callbacks),
            });
            if (response.status === 202 || response.status === 404) {
                // Pending
                continue;
            }
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Device token poll failed: ${response.status} ${response.statusText}. Response: ${errText}`);
            }
            const tokenData = (await response.json());
            if (!tokenData.token) {
                throw new Error("Device token poll returned empty access token");
            }
            const expireMs = parseExpiresAt(tokenData.expires_at, tokenData.expires_in);
            // Fetch user info (best effort)
            getProgress(callbacks)?.("Fetching user profile...");
            let email = "";
            let name = "";
            try {
                const userinfoRes = await fetch("https://openapi.qoder.sh/api/v1/userinfo", {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${tokenData.token}`,
                        Accept: "application/json",
                        "User-Agent": "pi-provider-qoder",
                    },
                });
                if (userinfoRes.ok) {
                    const userinfo = (await userinfoRes.json());
                    email = userinfo.email || "";
                    name = userinfo.name || userinfo.username || "";
                }
            }
            catch { }
            getProgress(callbacks)?.("Login successful!");
            return {
                refresh: `${tokenData.refresh_token}|${tokenData.user_id}|${machineID}`,
                access: tokenData.token,
                expires: expireMs - 5 * 60 * 1000, // 5 min buffer
                userID: tokenData.user_id,
                email,
                name,
                machineID,
            };
        }
        catch (e) {
            const err = e;
            if (err.name === "AbortError" || getSignal(callbacks)?.aborted) {
                throw new Error("Login cancelled");
            }
            throw e;
        }
    }
    throw new Error("Authorization timed out");
}
