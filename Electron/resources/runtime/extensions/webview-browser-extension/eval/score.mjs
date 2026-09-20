import { querySelectorDeep, resolveShownNodes } from "./harness.mjs";

export function estimateOutputTokens(envelope) {
  let serialized = "";
  try {
    serialized = JSON.stringify(envelope) || "";
  } catch {
    serialized = "";
  }
  return {
    utf16Units: serialized.length,
    outputTokensEstimate: Math.ceil(serialized.length / 4),
    kind: "estimate_from_observation_json",
    usage: { status: "not_executed", reason: "no model call in baseline A" },
  };
}

export function observationStats(envelope) {
  const elements = Array.isArray(envelope?.elements) ? envelope.elements : [];
  const regions = Array.isArray(envelope?.regions) ? envelope.regions : [];
  let previewed = 0;
  for (const region of regions) {
    if (Array.isArray(region?.preview)) previewed += region.preview.length;
  }
  return {
    displayedElements: elements.length,
    displayedRegions: regions.length,
    previewed,
    nextCursor: envelope?.nextCursor == null ? null : String(envelope.nextCursor),
    truncated: envelope?.truncated === true,
    limitationCount: Array.isArray(envelope?.limitations) ? envelope.limitations.length : 0,
    collectedCount: { status: "not_in_public_envelope", reason: "A observe does not publish the raw collect size" },
  };
}

function ruleOk(rule, envelope, extras) {
  const haystack = (() => {
    try {
      return JSON.stringify(envelope) || "";
    } catch {
      return "";
    }
  })();
  switch (rule.kind) {
    case "ok_true":
      return envelope?.ok === true;
    case "snapshot_id":
      return typeof envelope?.snapshotID === "string" && envelope.snapshotID.length > 0;
    case "text_absent":
      return !haystack.includes(rule.value);
    case "text_present":
      return haystack.toLowerCase().includes(String(rule.value).toLowerCase());
    case "field_truthy":
      return Boolean(envelope?.[rule.field]);
    case "limitations_nonempty":
      return Array.isArray(envelope?.limitations) && envelope.limitations.length > 0;
    case "regions_have_counts":
      return Array.isArray(envelope?.regions)
        && envelope.regions.length > 0
        && envelope.regions.every((region) => Number(region?.count) >= 1);
    case "region_role":
      return (envelope?.regions || []).some((region) => String(region?.role || "").toLowerCase() === String(rule.role).toLowerCase());
    case "extra_true":
      return extras?.[rule.extra] === true;
    default:
      return false;
  }
}

export function evaluateRequiredInfo(envelope, rules = [], extras = {}) {
  const items = [];
  for (const rule of rules) {
    const ok = ruleOk(rule, envelope, extras);
    items.push({ id: rule.id, kind: rule.kind, ok });
  }
  const missing = items.filter((item) => !item.ok).map((item) => item.id);
  return {
    items,
    missing,
    status: missing.length === 0 ? "complete" : items.some((item) => item.ok) ? "partial" : "missing",
  };
}

export function scoreObservation({ session, envelope, gold, extras = {} }) {
  const presentInDom = gold?.present === false
    ? false
    : Boolean(gold?.selector && querySelectorDeep(session.window, gold.selector));
  if (gold?.present === false) {
    const falsePositive = (envelope?.elements || []).some((el) => {
      const name = String(el?.name || "").toLowerCase();
      return gold.name && name === String(gold.name).toLowerCase();
    });
    return {
      targetPresence: "absent",
      shownAt: null,
      recallAt12: null,
      target: falsePositive ? "false_positive" : "not_applicable",
      presentInDom: false,
    };
  }
  const shown = resolveShownNodes(session, envelope);
  const goldNode = gold?.selector ? querySelectorDeep(session.window, gold.selector) : null;
  let shownAt = null;
  if (goldNode) {
    const index = shown.findIndex((row) => row.node === goldNode);
    shownAt = index >= 0 ? index : null;
  }
  const hit = shownAt !== null;
  const recallAt12 = hit && shownAt < 12;
  return {
    targetPresence: presentInDom ? "present" : "missing_from_dom",
    shownAt,
    recallAt12: presentInDom ? Boolean(recallAt12) : null,
    target: !presentInDom ? "missing_from_dom" : hit ? (recallAt12 ? "hit" : "miss") : "miss",
    presentInDom,
  };
}

export function classifyCaseStatus({ toolOk, target, coverageStatus }) {
  if (!toolOk) return { kind: "failure", reason: "controller/observe error" };
  if (target === "missing_from_dom") {
    return { kind: "failure", reason: "gold selector not in the fixture DOM" };
  }
  if (target === "false_positive") {
    return { kind: "failure", reason: "no-match case displayed a fabricated gold name" };
  }
  const observation = target === "miss" ? "miss" : target === "hit" ? "hit" : "not_applicable";
  return {
    kind: "measured",
    observation,
    coverage: coverageStatus,
  };
}
