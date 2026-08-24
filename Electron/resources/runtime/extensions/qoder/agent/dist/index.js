import { registerQoderContextWindowCompat } from "./context-window.js";
import vendor from "./vendor/index.js";
const SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_QODER";
function applySettingsPat() {
    const raw = process.env[SETTINGS_ENV];
    if (!raw)
        return;
    try {
        const settings = JSON.parse(raw);
        const pat = typeof settings["ext.qoder.pat"] === "string" ? settings["ext.qoder.pat"] : "";
        const cnPat = typeof settings["ext.qoder.cnPat"] === "string" ? settings["ext.qoder.cnPat"] : "";
        if (pat && !process.env.QODER_PERSONAL_ACCESS_TOKEN && !process.env.QODER_API_KEY && !process.env.QODER_PAT) {
            process.env.QODER_PERSONAL_ACCESS_TOKEN = pat;
        }
        if (cnPat &&
            !process.env.QODERCN_PERSONAL_ACCESS_TOKEN &&
            !process.env.QODERCN_API_KEY &&
            !process.env.QODERCN_PAT) {
            process.env.QODERCN_PERSONAL_ACCESS_TOKEN = cnPat;
        }
    }
    catch {
        // settings snapshot is best-effort
    }
}
/** First-time provider registration (qoder + qoder-cn) plus context-window compat. */
export default async function (pi) {
    applySettingsPat();
    await vendor(pi);
    registerQoderContextWindowCompat(pi);
}
