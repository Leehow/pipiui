import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { DATA_ROOT, EXTENSION_ID, capable, modelKey, preferencePath, parsePreference, requestPayload,
  reportedTier, observationStatus, tierRejected, estimatedUsage, estimateBasis } from "../shared/policy.js";

/** Preference and observation files contain flags/tier metadata only. Never content or credentials. */
function confined(root, relative, create = false) {
  let current = realpathSync(root);
  const parts = relative.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw Error("Unsafe Fast data path");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (create && i < parts.length - 1) mkdirSync(current, {mode: 0o700});
    }
  }
  return current;
}
function readPreference(root, sessionId, model) {
  try {
    const file = confined(root, preferencePath(sessionId, model));
    if (lstatSync(file).size > 4096) throw Error("Fast preference too large");
    return parsePreference(readFileSync(file, "utf8"));
  } catch { return {version: 1, enabled: false, revision: null}; }
}
function saveObservation(root, sessionId, request) {
  try {
    const file = confined(root, preferencePath(sessionId, request.model) + ".status.json", true);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let owned = false;
    try {
      writeFileSync(temp, JSON.stringify({version: 1, sessionId, model: modelKey(request.model),
        revision: request.preference.revision, requested: request.preference.enabled,
        effectiveTier: request.tier, status: request.status, completedAt: Date.now(),
        costBasis: estimateBasis(request.model, request.tier)}), {mode: 0o600, flag: "wx"});
      owned = true;
      renameSync(temp, file);
      owned = false;
    } finally { if (owned) { try { unlinkSync(temp); } catch {} } }
  } catch { /* Observation failure never changes the request or aborts a model response. */ }
}
export default function openaiFast(pi) {
  const root = process.env.PIPIUI_PROJECT_ROOT;
  const sessionId = process.env.PIPIUI_SESSION_ID;
  let request;
  pi.on("turn_start", () => { request = undefined; });
  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (!capable(model) || !event.payload || event.payload.model !== model.id) { request = undefined; return; }
    // Capture once before wire serialization. Later UI writes affect the next request only.
    const preference = root && sessionId ? readPreference(root, sessionId, model) : {enabled: false, revision: null};
    request = {model, preference, tier: null, status: "unknown"};
    return requestPayload(event.payload, model, preference.enabled);
  });
  pi.on("provider_stream_event", event => {
    if (!request || event.provider !== request.model.provider || event.model !== request.model.id) return;
    const tier = reportedTier(event.data);
    if (tier) request.tier = tier;
    const rejected = tierRejected(event.data?.error?.message || event.data?.message);
    request.status = observationStatus(request.preference.enabled, request.tier, rejected);
  });
  pi.on("message_end", event => {
    const message = event.message;
    if (!request || message?.role !== "assistant" || message.provider !== request.model.provider || message.model !== request.model.id) return;
    const rejected = request.status === "unsupported" || tierRejected(message.errorMessage);
    request.status = observationStatus(request.preference.enabled, request.tier, rejected);
    if (root && sessionId) saveObservation(root, sessionId, request);
    // Replacement runs before public listeners and SessionManager persistence on both pinned Pi runtimes.
    const usage = estimatedUsage(message.usage, request.model, request.tier);
    const observation = request;
    request = undefined;
    return {message: {...message, usage, serviceTier: observation.tier,
      fastMode: {requested: observation.preference.enabled, effectiveTier: observation.tier,
        status: observation.status, costBasis: estimateBasis(observation.model, observation.tier)}}};
  });
}
