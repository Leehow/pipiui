(function () {
  "use strict";

  const API_NAME = "__pipiBrowserDOM";
  const OVERLAY_ATTRIBUTE = "data-pipiui-browser-highlight";
  const MAX_ELEMENTS = 256;
  const MAX_UTF16_UNITS = 20000;
  const MAX_REDACTION_ENTRIES = 64;
  const MAX_REDACTION_VALUE_UNITS = 4096;
  const MAX_REDACTION_TOTAL_UNITS = 16384;
  const REGION_PREVIEW_LIMIT = 3;
  const REGION_PAGE_SIZE = 8;
  const ELEMENT_PAGE_SIZE = 32;
  const MAX_MUTATION_SAMPLES = 8;
  const LANDMARK_ROLES = new Set([
    "banner", "navigation", "main", "complementary", "contentinfo",
    "form", "search", "dialog", "alertdialog", "region",
  ]);
  const LANDMARK_TAGS = new Set(["header", "nav", "main", "aside", "footer", "form", "dialog", "search"]);
  const SENSITIVE_AUTOCOMPLETE_TOKEN = /^(current-password|new-password|one-time-code|cc(?:-|$))/i;
  // Query/hash parameter names whose values must never appear in public observations.
  const SENSITIVE_URL_PARAM = /(?:^|[._-])(?:token|password|passwd|secret|key|reset|auth|otp|code|session|sig|signature|credential|bearer)(?:[._-]|$)|^(?:token|password|passwd|secret|key|reset|auth|otp|code|session|sig|signature|credential|bearer)$/i;
  const BARE_PASSWORD_SEMANTICS = /\b(?:password|passcode|passwd)\b|密码|密碼|口令/i;
  const STRING_LIMITS = Object.freeze({
    url: 4096,
    title: 512,
    name: 512,
    state: 256,
    valueHint: 256,
    frame: 160,
    limitation: 512,
    error: 512,
    selected: 256,
    action: 256,
    code: 128,
    token: 128,
    snapshotID: 128,
    description: 256,
    region: 160,
  });

  const state = {
    activeSnapshot: null,
    pendingFrameClick: null,
    redactionValues: [],
    redactionTotalUnits: 0,
    redactionOverflow: false,
    sequence: 0,
    highlight: null,
    highlightTimer: null,
    mutationObserver: null,
    mutationAdded: 0,
    mutationRemoved: 0,
    mutationAttributes: 0,
    mutationSamples: [],
    mutationDialogs: [],
    mutationURL: "",
  };

  function opaqueID(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
    state.sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${state.sequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizedText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function truncateUTF16(value, limit) {
    const string = String(value ?? "");
    if (string.length <= limit) return string;
    let end = Math.max(0, limit - 1);
    if (end > 0 && /[\uD800-\uDBFF]/.test(string.charAt(end - 1))) end -= 1;
    return `${string.slice(0, end)}…`;
  }

  function secretVariants(values) {
    const variants = new Set();
    for (const rawValue of values || []) {
      const raw = String(rawValue ?? "");
      if (!raw) continue;
      const normalized = normalizedText(raw);
      for (const candidate of [raw, normalized]) {
        if (!candidate) continue;
        variants.add(candidate);
        try {
          const encoded = encodeURIComponent(candidate);
          variants.add(encoded);
          variants.add(encoded.replace(/%20/g, "+"));
          const lowerEscapes = encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
          variants.add(lowerEscapes);
          variants.add(lowerEscapes.replace(/%20/gi, "+"));
        } catch (_) {}
      }
    }
    return Array.from(variants).sort((left, right) => right.length - left.length);
  }

  function retainRedactions(values) {
    if (state.redactionOverflow) return false;
    for (const value of values || []) {
      const raw = String(value ?? "");
      if (!raw || state.redactionValues.includes(raw)) continue;
      if (raw.length > MAX_REDACTION_VALUE_UNITS
        || state.redactionValues.length >= MAX_REDACTION_ENTRIES
        || state.redactionTotalUnits + raw.length > MAX_REDACTION_TOTAL_UNITS) {
        state.redactionOverflow = true;
        return false;
      }
      state.redactionValues.push(raw);
      state.redactionTotalUnits += raw.length;
    }
    return true;
  }

  function activeRedactionVariants(extraValues = []) {
    return secretVariants([...state.redactionValues, ...extraValues]);
  }

  function redactionCapacityFailure() {
    invalidateSnapshot();
    return {
      ok: false,
      error: "browser redaction capacity exceeded; reload the document before continuing",
      code: "browser_redaction_capacity_exceeded",
      requiresObservation: true,
      redacted: true,
    };
  }

  function redactString(value, variants) {
    let result = String(value ?? "");
    for (const secret of variants) {
      if (!secret || !result.includes(secret)) continue;
      if (secret.length < 3) return "[redacted]";
      result = result.split(secret).join("[redacted]");
    }
    return result;
  }

  function stringLimitForKey(key) {
    if (key === "limitations") return STRING_LIMITS.limitation;
    if (key === "id" || key === "nextCursor") return STRING_LIMITS.region;
    return STRING_LIMITS[key] || 512;
  }

  function sanitizePublic(value, variants, key = "") {
    if (typeof value === "string") {
      if (key === "token" || key === "snapshotID") return truncateUTF16(value, stringLimitForKey(key));
      return truncateUTF16(redactString(value, variants), stringLimitForKey(key));
    }
    if (Array.isArray(value)) return value.map((item) => sanitizePublic(item, variants, key));
    if (value && typeof value === "object") {
      const result = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        result[childKey] = sanitizePublic(childValue, variants, childKey);
      }
      return result;
    }
    return value;
  }

  function serializedLength(value) {
    try {
      return JSON.stringify(value).length;
    } catch (_) {
      return MAX_UTF16_UNITS + 1;
    }
  }

  function enforceEnvelopeBudget(value, variants) {
    const envelope = sanitizePublic(value, variants);
    const elementLists = [];
    const limitationLists = [];
    const regionLists = [];
    const sampleLists = [];
    function findDroppable(current) {
      if (!current || typeof current !== "object") return;
      if (Array.isArray(current.elements)) elementLists.push(current.elements);
      if (Array.isArray(current.preview)) elementLists.push(current.preview);
      if (Array.isArray(current.regions)) regionLists.push(current.regions);
      if (Array.isArray(current.limitations)) limitationLists.push(current.limitations);
      if (Array.isArray(current.samples) && ("added" in current || "removed" in current)) sampleLists.push(current.samples);
      for (const child of Object.values(current)) findDroppable(child);
    }
    findDroppable(envelope);
    const markTruncated = () => {
      if (envelope.observation && typeof envelope.observation === "object") envelope.observation.truncated = true;
      else envelope.truncated = true;
    };
    while (serializedLength(envelope) > MAX_UTF16_UNITS && sampleLists.some((list) => list.length)) {
      sampleLists.find((candidate) => candidate.length).pop();
      if (envelope.mutation && typeof envelope.mutation === "object") envelope.mutation.truncated = true;
    }
    while (serializedLength(envelope) > MAX_UTF16_UNITS && elementLists.some((list) => list.length)) {
      const list = elementLists.find((candidate) => candidate.length);
      list.pop();
      markTruncated();
    }
    while (serializedLength(envelope) > MAX_UTF16_UNITS && regionLists.some((list) => list.length)) {
      regionLists.find((candidate) => candidate.length).pop();
      markTruncated();
    }
    while (serializedLength(envelope) > MAX_UTF16_UNITS && limitationLists.some((list) => list.length)) {
      limitationLists.find((candidate) => candidate.length).pop();
    }
    if (serializedLength(envelope) > MAX_UTF16_UNITS) {
      return {
        ok: false,
        error: "browser response exceeded the public output budget",
        code: "browser_output_truncated",
        requiresObservation: true,
      };
    }
    return envelope;
  }

  function invalidateSnapshot() {
    state.activeSnapshot = null;
  }

  function clearPendingFrameClick() {
    const pending = state.pendingFrameClick;
    if (pending?.frameElement) {
      if (pending.onLoad) pending.frameElement.removeEventListener("load", pending.onLoad);
      if (pending.onError) pending.frameElement.removeEventListener("error", pending.onError);
    }
    state.pendingFrameClick = null;
  }

  function clearHighlight() {
    if (state.highlightTimer !== null) {
      clearTimeout(state.highlightTimer);
      state.highlightTimer = null;
    }
    if (state.highlight && state.highlight.isConnected) state.highlight.remove();
    state.highlight = null;
  }

  function highlight(element) {
    clearHighlight();
    const rect = element.getBoundingClientRect();
    const ownerDocument = element.ownerDocument || document;
    const overlay = ownerDocument.createElement("div");
    overlay.setAttribute(OVERLAY_ATTRIBUTE, "true");
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(0, rect.width)}px`,
      height: `${Math.max(0, rect.height)}px`,
      boxSizing: "border-box",
      border: "2px solid rgb(10, 132, 255)",
      borderRadius: "4px",
      background: "rgba(10, 132, 255, 0.10)",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    (ownerDocument.documentElement || ownerDocument.body).appendChild(overlay);
    state.highlight = overlay;
    state.highlightTimer = setTimeout(clearHighlight, 1000);
  }

  function implicitRole(element) {
    const tag = element.localName;
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "aside") return "complementary";
    if (tag === "form") return "form";
    if (tag === "dialog") return "dialog";
    if (tag === "search") return "search";
    if (tag === "summary") return "button";
    if (tag === "option") return "option";
    if (tag === "progress") return "progressbar";
    if (tag === "meter") return "meter";
    return "";
  }

  function role(element) {
    return normalizedText(element.getAttribute("role")) || implicitRole(element);
  }

  function referencedText(element, attribute) {
    const ids = normalizedText(element.getAttribute(attribute)).split(" ").filter(Boolean);
    if (!ids.length) return "";
    return normalizedText(ids.map((id) => element.ownerDocument.getElementById(id)?.textContent || "").join(" "));
  }

  function associatedLabels(element) {
    if (element.labels && element.labels.length) return Array.from(element.labels);
    const id = element.id;
    if (!id || !element.ownerDocument?.querySelectorAll) return [];
    try {
      return Array.from(element.ownerDocument.querySelectorAll("label")).filter((label) => {
        const htmlFor = label.htmlFor || label.getAttribute("for");
        return htmlFor === id;
      });
    } catch (_) {
      return [];
    }
  }

  function ownVisibleText(element) {
    let text = "";
    const nodes = element.childNodes || [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.nodeType === 3) text += node.textContent || "";
      else if (node.nodeType === 1 && !isSelfHidden(node)) text += ` ${ownVisibleText(node)} `;
    }
    return normalizedText(text);
  }

  function accessibleDescription(element) {
    const described = referencedText(element, "aria-describedby")
      || referencedText(element, "aria-errormessage")
      || referencedText(element, "aria-details");
    return truncateUTF16(described, STRING_LIMITS.description);
  }

  function accessibleName(element) {
    const labelled = referencedText(element, "aria-labelledby");
    if (labelled) return truncateUTF16(labelled, STRING_LIMITS.name);
    const aria = normalizedText(element.getAttribute("aria-label"));
    if (aria) return truncateUTF16(aria, STRING_LIMITS.name);
    const labelText = normalizedText(associatedLabels(element).map((label) => label.textContent || "").join(" "));
    if (labelText) return truncateUTF16(labelText, STRING_LIMITS.name);
    if (element.localName === "fieldset") {
      const legend = Array.from(element.children || []).find((child) => child.localName === "legend");
      const legendText = normalizedText(legend?.textContent);
      if (legendText) return truncateUTF16(legendText, STRING_LIMITS.name);
    }
    if (element.localName === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) {
        const value = normalizedText(element.value);
        if (value) return truncateUTF16(value, STRING_LIMITS.name);
      }
      if (type === "image") {
        const alt = normalizedText(element.getAttribute("alt"));
        if (alt) return truncateUTF16(alt, STRING_LIMITS.name);
      }
    }
    for (const attribute of ["alt", "title", "placeholder"]) {
      const value = normalizedText(element.getAttribute(attribute));
      if (value) return truncateUTF16(value, STRING_LIMITS.name);
    }
    const elementRole = role(element);
    if (["button", "a", "summary", "label", "option"].includes(element.localName)
      || ["button", "link", "menuitem", "option", "tab"].includes(elementRole)
      || element.isContentEditable) {
      const text = ownVisibleText(element);
      if (text) return truncateUTF16(text, STRING_LIMITS.name);
    }
    return truncateUTF16(normalizedText(element.textContent), STRING_LIMITS.name);
  }

  function semanticFieldText(element) {
    const raw = [
      element.id,
      element.getAttribute("name"),
      element.getAttribute("aria-label"),
      referencedText(element, "aria-labelledby"),
      element.getAttribute("placeholder"),
      accessibleName(element),
    ].filter(Boolean).join(" ");
    return normalizedText(raw
      .normalize("NFKC")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_./-]+/g, " "))
      .toLowerCase();
  }

  function isSensitive(element) {
    if (!["input", "textarea", "select"].includes(element.localName)) return false;
    const type = element.localName === "input"
      ? (element.getAttribute("type") || "text").toLowerCase()
      : "";
    const autocompleteTokens = normalizedText(element.getAttribute("autocomplete")).split(" ");
    if (type === "password" || autocompleteTokens.some((token) => SENSITIVE_AUTOCOMPLETE_TOKEN.test(token))) {
      return true;
    }

    const semantics = semanticFieldText(element);
    if (!semantics) return false;
    // Defense in depth: bare password keywords in name/id/label/placeholder.
    if (BARE_PASSWORD_SEMANTICS.test(semantics)) return true;
    const inputMode = normalizedText(element.getAttribute("inputmode")).toLowerCase();
    const numericEntry = ["numeric", "decimal", "tel"].includes(inputMode)
      || ["number", "tel"].includes(type);
    const otpSemantics = /(?:\botp\b|\bone\s*time\s*(?:code|passcode|password)\b|\b(?:verification|authentication|auth)\s*(?:code|passcode)\b|\b(?:sms|email)\s*(?:verification\s*)?code\b|验证码|驗證碼|一次性(?:密码|密碼|口令|验证码|驗證碼)|动态(?:码|碼|密码|密碼)|短信(?:码|碼|验证码|驗證碼)|认证码|認證碼)/i;
    const cardNumberSemantics = /(?:\b(?:credit|debit|payment|bank)\s*card\s*(?:number|no|pan)?\b|\bcard\s*(?:number|no|pan)\b|\bpan\b|银行卡号|銀行卡號|信用卡号|信用卡號|借记卡号|借記卡號|支付卡号|支付卡號|卡号|卡號)/i;
    const cardSecuritySemantics = /(?:\b(?:cvv2?|cvc2?|cid)\b|\b(?:card\s*)?(?:security|verification)\s*code\b|安全码|安全碼|卡片验证码|卡片驗證碼)/i;
    const cardExpirySemantics = /(?:\b(?:card\s*)?(?:expiry|expiration)(?:\s*(?:date|month|year|mm|yy))?\b|\bexp\s*(?:date|month|year|mm|yy)\b|有效期|到期(?:日|日期|月|月份|年|年份)|失效日期)/i;
    const numericAuthenticationSemantics = numericEntry
      && /(?:\b(?:verification|authentication|auth)\b|身份验证|身份驗證|认证|認證)/i.test(semantics);
    const numericPaymentSemantics = numericEntry
      && /(?:\b(?:credit|debit|payment|bank)\s*card\b|银行卡|銀行卡|信用卡|借记卡|借記卡)/i.test(semantics);
    return otpSemantics.test(semantics)
      || cardNumberSemantics.test(semantics)
      || cardSecuritySemantics.test(semantics)
      || cardExpirySemantics.test(semantics)
      || numericAuthenticationSemantics
      || numericPaymentSemantics;
  }

  function redactURLForObservation(href) {
    const raw = String(href || "");
    try {
      const url = new URL(raw, String(location.href));
      let changed = false;
      const redactParams = (params) => {
        for (const key of [...params.keys()]) {
          if (SENSITIVE_URL_PARAM.test(key)) {
            params.set(key, "[redacted]");
            changed = true;
          }
        }
      };
      redactParams(url.searchParams);
      if (url.hash && url.hash.length > 1) {
        const hashBody = url.hash.slice(1);
        if (hashBody.includes("=")) {
          const hashParams = new URLSearchParams(hashBody);
          const before = hashParams.toString();
          redactParams(hashParams);
          if (hashParams.toString() !== before) {
            url.hash = hashParams.toString();
            changed = true;
          }
        }
      }
      return changed ? url.toString() : raw;
    } catch (_) {
      return raw;
    }
  }

  function controlValue(element) {
    return ["input", "textarea", "select"].includes(element.localName)
      ? String(element.value || "")
      : "";
  }

  function collectCurrentSensitiveValues() {
    const values = [];
    function walk(root, iframeDepth) {
      const children = root.nodeType === Node.DOCUMENT_NODE
        ? (root.documentElement ? [root.documentElement] : [])
        : Array.from(root.children || []);
      for (const element of children) {
        if (isSensitive(element)) values.push(String(element.value || ""));
        if (element.shadowRoot) walk(element.shadowRoot, iframeDepth);
        if (element.localName === "iframe" && iframeDepth < 1) {
          try {
            if (element.contentDocument?.documentElement) walk(element.contentDocument, iframeDepth + 1);
          } catch (_) {}
        }
        walk(element, iframeDepth);
      }
    }
    walk(document, 0);
    return values;
  }

  function retainCurrentSensitiveValues() {
    return retainRedactions(collectCurrentSensitiveValues());
  }

  function isSelfHidden(element) {
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true" || element.hasAttribute("inert")) return true;
    if (element.hasAttribute(OVERLAY_ATTRIBUTE) || element.closest?.(`[${OVERLAY_ATTRIBUTE}]`)) return true;
    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle(element);
    return !style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
  }

  function isHiddenComposed(element) {
    let current = element;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      if (isSelfHidden(current)) return true;
      if (current.parentElement) {
        current = current.parentElement;
        continue;
      }
      const root = current.getRootNode?.();
      if (root && root.host) {
        current = root.host;
        continue;
      }
      const frameElement = current.ownerDocument?.defaultView?.frameElement;
      current = frameElement || null;
    }
    return false;
  }

  function isDisabled(element) {
    return Boolean(element.matches?.(":disabled") || element.getAttribute("aria-disabled") === "true");
  }

  function hasVisibleBox(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractive(element, elementRole) {
    if (element.matches?.("a[href],button,input,textarea,select,summary,[contenteditable='true'],[tabindex]")) return true;
    return ["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "menuitem", "option", "slider", "switch", "tab"].includes(elementRole);
  }

  function isContext(element, elementRole) {
    return /^h[1-6]$/.test(element.localName)
      || element.localName === "label"
      || ["heading", "main", "navigation", "banner", "contentinfo", "complementary", "form", "search", "dialog", "region"].includes(elementRole);
  }

  function stateDescription(element) {
    const values = [];
    if (element.matches?.(":checked") || element.getAttribute("aria-checked") === "true") values.push("checked");
    if (element.getAttribute("aria-checked") === "mixed") values.push("mixed");
    if (element.getAttribute("aria-pressed") === "true") values.push("pressed");
    if (element.getAttribute("aria-expanded") === "true") values.push("expanded");
    if (element.getAttribute("aria-expanded") === "false") values.push("collapsed");
    if (element.getAttribute("aria-selected") === "true") values.push("selected");
    const current = normalizedText(element.getAttribute("aria-current"));
    if (current && current !== "false") values.push(current === "true" ? "current" : `current:${current}`);
    if (element.matches?.(":focus")) values.push("focused");
    if (element.hasAttribute("required") || element.getAttribute("aria-required") === "true") values.push("required");
    if (element.getAttribute("aria-invalid") === "true" || element.matches?.(":invalid")) values.push("invalid");
    if (element.hasAttribute("readonly") || element.getAttribute("aria-readonly") === "true") values.push("readonly");
    const roleDescription = normalizedText(element.getAttribute("aria-roledescription"));
    if (roleDescription) values.push(`roledescription:${roleDescription}`);
    const description = accessibleDescription(element);
    if (description) values.push(`described:${description}`);
    return truncateUTF16(values.join(","), STRING_LIMITS.state);
  }

  function valueHint(element) {
    if (isSensitive(element)) return "sensitive value hidden";
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (element.localName === "select") {
      return truncateUTF16(normalizedText(element.selectedOptions?.[0]?.textContent || element.value), STRING_LIMITS.valueHint);
    }
    if (element.localName === "progress" || element.localName === "meter" || type === "range") {
      const valueText = normalizedText(element.getAttribute("aria-valuetext") || element.value);
      const min = element.min ?? element.getAttribute("min") ?? element.getAttribute("aria-valuemin") ?? "";
      const max = element.max ?? element.getAttribute("max") ?? element.getAttribute("aria-valuemax") ?? "";
      const range = min !== "" || max !== "" ? ` ${min}–${max}` : "";
      return truncateUTF16(valueText ? `${valueText}${range}` : `empty${range}`, STRING_LIMITS.valueHint);
    }
    if (element.localName === "input" || element.localName === "textarea") {
      const value = normalizedText(element.value);
      return value ? `value length ${value.length}` : "empty";
    }
    if (element.isContentEditable) {
      const value = normalizedText(element.textContent);
      return value ? `text length ${value.length}` : "empty";
    }
    return "";
  }

  function frameRect(element, offsetX, offsetY) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round((rect.left + offsetX) * 10) / 10,
      y: Math.round((rect.top + offsetY) * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  }

  function inViewport(rect) {
    return rect.x + rect.width > 0
      && rect.y + rect.height > 0
      && rect.x < globalThis.innerWidth
      && rect.y < globalThis.innerHeight;
  }

  function owningFrameElement(ownerDocument) {
    try {
      return ownerDocument?.defaultView?.frameElement || null;
    } catch (_) {
      return null;
    }
  }

  function resolvedHref(element) {
    if ((element.localName === "a" || element.localName === "area") && element.hasAttribute("href")) {
      return String(element.href || "");
    }
    return "";
  }

  function submitSemantics(element) {
    const type = (element.getAttribute("type") || (element.localName === "button" ? "submit" : "")).toLowerCase();
    const isSubmit = (element.localName === "button" && type === "submit")
      || (element.localName === "input" && ["submit", "image"].includes(type));
    if (!isSubmit || !element.form) return ["", ""];
    let action = "";
    try {
      action = String(
        element.hasAttribute("formaction")
          ? element.formAction
          : (element.form.action || element.ownerDocument.URL || ""),
      );
    } catch (_) {}
    const method = String(
      element.hasAttribute("formmethod") ? element.formMethod : (element.form.method || "get"),
    ).toLowerCase();
    return [action, method];
  }

  function composedParentElement(element) {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.();
    return root && root.host instanceof Element ? root.host : null;
  }

  function isLandmark(element) {
    const elementRole = role(element);
    if (elementRole === "region" || element.localName === "section") {
      return Boolean(accessibleName(element));
    }
    if (LANDMARK_ROLES.has(elementRole)) return true;
    return LANDMARK_TAGS.has(element.localName);
  }

  function nearestLandmark(element) {
    let current = element;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      if (isLandmark(current)) return current;
      const parent = composedParentElement(current);
      if (parent) {
        current = parent;
        continue;
      }
      const root = current.getRootNode?.();
      if (root && root.host) {
        current = root.host;
        continue;
      }
      current = owningFrameElement(current.ownerDocument);
    }
    return null;
  }

  function fallbackRegionHost(element) {
    let current = element;
    let top = element;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      const parent = composedParentElement(current);
      if (!parent || parent.localName === "body" || parent.localName === "html") {
        top = current.localName === "body" || current.localName === "html"
          ? (document.body || document.documentElement || current)
          : current;
        break;
      }
      top = current;
      current = parent;
    }
    if (!top || top.localName === "html" || top.localName === "body") {
      return document.body || document.documentElement || top;
    }
    return top;
  }

  function domPath(element) {
    const parts = [];
    let current = element;
    const visited = new Set();
    while (current && current.nodeType === 1 && !visited.has(current)) {
      visited.add(current);
      const tag = current.localName || "*";
      const parent = composedParentElement(current);
      if (parent) {
        let same = 0;
        let idx = 0;
        for (const child of parent.children || []) {
          if (child.localName !== tag) continue;
          if (child === current) idx = same;
          same += 1;
        }
        parts.push(same > 1 ? `${tag}[${idx}]` : tag);
        current = parent;
        continue;
      }
      const root = current.getRootNode?.();
      if (root && root.host) {
        parts.push(`${tag}::shadow`);
        current = root.host;
        continue;
      }
      parts.push(tag);
      break;
    }
    return parts.reverse().join("/");
  }

  function assignIdentity(candidates) {
    const groups = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.public.role}${candidate.public.name}`;
      const list = groups.get(key) || [];
      list.push(candidate);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      list.forEach((candidate, index) => {
        candidate.ordinal = index + 1;
        candidate.namedUnique = list.length === 1;
        candidate.identityKey = `${candidate.public.role}${candidate.public.name}${candidate.ordinal}`;
        candidate.semanticFingerprint = `${candidate.domPath}${candidate.identityKey}`;
      });
    }
  }

  function assignRegions(candidates) {
    const seen = new Map();
    const roleCounts = Object.create(null);
    function metaFor(element, idPrefix, fallbackName) {
      if (seen.has(element)) return seen.get(element);
      const elementRole = role(element) || element.localName || fallbackName;
      roleCounts[idPrefix] = (roleCounts[idPrefix] || 0) + 1;
      const n = roleCounts[idPrefix];
      const id = n === 1 ? idPrefix : `${idPrefix}:${n}`;
      const meta = {
        id,
        name: accessibleName(element) || fallbackName || elementRole,
        role: elementRole,
        element,
      };
      seen.set(element, meta);
      return meta;
    }
    let usedLandmark = false;
    for (const candidate of candidates) {
      const landmark = nearestLandmark(candidate.element);
      if (!landmark) continue;
      usedLandmark = true;
      const elementRole = role(landmark) || landmark.localName || "region";
      candidate.region = metaFor(landmark, elementRole, elementRole);
    }
    if (!usedLandmark) {
      for (const candidate of candidates) {
        const host = fallbackRegionHost(candidate.element);
        candidate.region = metaFor(host, "dom", host?.localName || "page");
      }
      return;
    }
    for (const candidate of candidates) {
      if (!candidate.region) {
        candidate.region = {
          id: "page",
          name: "page",
          role: "document",
          element: document.body || document.documentElement,
        };
      }
    }
  }

  function fingerprint(element, frame, elementRole, name) {
    const [formAction, formMethod] = submitSemantics(element);
    return [
      frame,
      element.localName,
      (element.getAttribute("type") || "").toLowerCase(),
      elementRole,
      name,
      resolvedHref(element),
      formAction,
      formMethod,
      element.isContentEditable ? "editable" : "not-editable",
    ].join("\u001f");
  }

  function collect(scope) {
    const candidates = [];
    const limitations = [
      "closed_shadow_roots_not_structured; use screenshot or Computer Use",
      // Platform gaps: declared so the model falls back to screenshot/user handoff.
      "js_dialogs_not_handled; alert/confirm/prompt are suppressed — use screenshot or user handoff if a dialog is required",
      "file_input_paths_not_supported; cannot supply local file paths — use screenshot or user handoff for uploads",
    ];
    let iframeCounter = 0;
    let sawFileInput = false;

    function walkContainer(root, frame, iframeDepth, offsetX, offsetY) {
      const children = root.nodeType === Node.DOCUMENT_NODE
        ? (root.documentElement ? [root.documentElement] : [])
        : Array.from(root.children || []);
      for (const current of children) {
        if (isSelfHidden(current)) continue;
        const currentRole = role(current);
        if (!isDisabled(current) && hasVisibleBox(current)) {
          const rect = frameRect(current, offsetX, offsetY);
          if ((scope === "page" || inViewport(rect)) && (isInteractive(current, currentRole) || isContext(current, currentRole))) {
            const name = accessibleName(current);
            candidates.push({
              element: current,
              ownerDocument: current.ownerDocument,
              rootNode: current.getRootNode(),
              owningFrameElement: owningFrameElement(current.ownerDocument),
              frame,
              domPath: domPath(current),
              fingerprint: fingerprint(current, frame, currentRole, name),
              public: {
                tag: current.localName,
                role: currentRole,
                name,
                state: stateDescription(current),
                valueHint: valueHint(current),
                frame,
                rect,
              },
            });
          }
        }

        if (current.localName === "input"
          && (current.getAttribute("type") || "").toLowerCase() === "file") {
          sawFileInput = true;
        }

        if (current.shadowRoot) walkContainer(current.shadowRoot, frame, iframeDepth, offsetX, offsetY);
        if (current.localName === "iframe") {
          const childFrame = `${frame}/iframe[${iframeCounter}]`;
          iframeCounter += 1;
          if (iframeDepth >= 1) {
            limitations.push(`nested_iframe_unavailable:${childFrame}`);
          } else {
            try {
              const childDocument = current.contentDocument;
              if (!childDocument || !childDocument.documentElement) throw new Error("cross-origin or unavailable");
              const iframeRect = current.getBoundingClientRect();
              walkContainer(childDocument, childFrame, iframeDepth + 1, offsetX + iframeRect.left, offsetY + iframeRect.top);
            } catch (_) {
              limitations.push(`cross_origin_iframe:${childFrame}; use screenshot or Computer Use`);
            }
          }
        }
        if (current.localName === "canvas") {
          limitations.push("canvas_or_webgl_not_structured; use screenshot or Computer Use");
        }
        walkContainer(current, frame, iframeDepth, offsetX, offsetY);
      }
    }

    walkContainer(document, "main", 0, 0, 0);
    if (sawFileInput) {
      limitations.push("file_input_present; structured browser cannot set file paths — use user handoff or Computer Use");
    }
    assignIdentity(candidates);
    assignRegions(candidates);
    return { candidates, limitations };
  }

  function viewportInfo() {
    return { width: Math.round(globalThis.innerWidth), height: Math.round(globalThis.innerHeight) };
  }

  function scrollInfo() {
    const root = document.scrollingElement || document.documentElement;
    const pixelsAbove = Math.max(0, Math.round(root.scrollTop));
    const pixelsBelow = Math.max(0, Math.round(root.scrollHeight - root.clientHeight - root.scrollTop));
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    return {
      pixelsAbove,
      pixelsBelow,
      positionPercent: maximum > 0 ? Math.round((root.scrollTop / maximum) * 1000) / 10 : 0,
    };
  }

  function parseCursor(value) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
    return 0;
  }

  function matchesRoleName(candidate, roleFilter, nameFilter) {
    if (roleFilter && String(candidate.public.role || "").toLowerCase() !== roleFilter) return false;
    if (nameFilter && !String(candidate.public.name || "").toLowerCase().includes(nameFilter)) return false;
    return true;
  }

  function matchesRegionFilter(region, regionFilter) {
    if (!regionFilter) return true;
    const needle = regionFilter.toLowerCase();
    return String(region.id || "").toLowerCase() === needle
      || String(region.name || "").toLowerCase() === needle
      || String(region.role || "").toLowerCase() === needle;
  }

  function publishElement(candidate, index, variants) {
    const token = opaqueID("element");
    return {
      token,
      publicElement: sanitizePublic({ index, token, ...candidate.public }, variants),
      record: { ...candidate, index, token },
    };
  }

  function observe(scope, action, secretValues, query = {}) {
    const normalizedScope = scope === "page" ? "page" : "viewport";
    if (!retainRedactions(secretValues) || !retainCurrentSensitiveValues()) {
      return redactionCapacityFailure();
    }
    const variants = activeRedactionVariants();
    const { candidates, limitations } = collect(normalizedScope);
    const snapshotID = opaqueID("snapshot");
    const map = new Map();
    const regionFilter = typeof query.region === "string" ? query.region.trim() : "";
    const roleFilter = typeof query.role === "string" ? query.role.trim().toLowerCase() : "";
    const nameFilter = typeof query.name === "string" ? query.name.trim().toLowerCase() : "";
    const cursor = parseCursor(query.cursor);
    const filtered = candidates.filter((candidate) => {
      if (!matchesRoleName(candidate, roleFilter, nameFilter)) return false;
      if (regionFilter && !matchesRegionFilter(candidate.region || {}, regionFilter)) return false;
      return true;
    });
    const expand = Boolean(regionFilter || roleFilter || nameFilter);
    const envelope = sanitizePublic({
      ok: true,
      snapshotID,
      // Public URL only — keep the raw href in activeSnapshot for stale checks.
      url: redactURLForObservation(String(location.href)),
      title: String(document.title || ""),
      loading: document.readyState !== "complete",
      viewport: viewportInfo(),
      scroll: scrollInfo(),
      regions: [],
      elements: [],
      limitations: [],
      truncated: false,
      ...(action ? { action } : {}),
    }, variants);

    for (const limitation of limitations) {
      const publicLimitation = sanitizePublic(limitation, variants, "limitations");
      envelope.limitations.push(publicLimitation);
      if (serializedLength(envelope) > MAX_UTF16_UNITS) {
        envelope.limitations.pop();
        envelope.truncated = true;
      }
    }

    const grouped = [];
    const groupIndex = new Map();
    for (const candidate of filtered) {
      const region = candidate.region || { id: "page", name: "page", role: "document" };
      let group = groupIndex.get(region.id);
      if (!group) {
        group = { id: region.id, name: region.name, role: region.role, items: [] };
        groupIndex.set(region.id, group);
        grouped.push(group);
      }
      group.items.push(candidate);
    }

    if (!expand) {
      const page = grouped.slice(cursor, cursor + REGION_PAGE_SIZE);
      for (const group of page) {
        const preview = [];
        for (let i = 0; i < Math.min(REGION_PREVIEW_LIMIT, group.items.length); i += 1) {
          if (envelope.elements.length >= MAX_ELEMENTS) {
            envelope.truncated = true;
            break;
          }
          const published = publishElement(group.items[i], envelope.elements.length, variants);
          preview.push(published.publicElement);
          envelope.elements.push(published.publicElement);
          if (serializedLength(envelope) > MAX_UTF16_UNITS) {
            preview.pop();
            envelope.elements.pop();
            envelope.truncated = true;
            break;
          }
          map.set(published.token, published.record);
        }
        envelope.regions.push(sanitizePublic({
          id: group.id,
          name: group.name,
          role: group.role,
          count: group.items.length,
          more: group.items.length > preview.length,
          preview,
        }, variants));
        if (serializedLength(envelope) > MAX_UTF16_UNITS) {
          envelope.regions.pop();
          envelope.truncated = true;
          break;
        }
      }
      if (cursor + page.length < grouped.length) envelope.nextCursor = String(cursor + page.length);
    } else {
      const pageSize = Math.min(ELEMENT_PAGE_SIZE, MAX_ELEMENTS);
      const page = filtered.slice(cursor, cursor + pageSize);
      const regionSummaries = grouped.map((group) => sanitizePublic({
        id: group.id,
        name: group.name,
        role: group.role,
        count: group.items.length,
        expanded: regionFilter ? matchesRegionFilter(group, regionFilter) : false,
      }, variants));
      envelope.regions.push(...regionSummaries);
      for (const candidate of page) {
        if (envelope.elements.length >= MAX_ELEMENTS) {
          envelope.truncated = true;
          break;
        }
        const published = publishElement(candidate, envelope.elements.length, variants);
        envelope.elements.push(published.publicElement);
        if (serializedLength(envelope) > MAX_UTF16_UNITS) {
          envelope.elements.pop();
          envelope.truncated = true;
          break;
        }
        map.set(published.token, published.record);
      }
      if (cursor + page.length < filtered.length) envelope.nextCursor = String(cursor + page.length);
    }

    if (envelope.truncated && envelope.nextCursor == null) {
      const consumed = expand ? cursor + envelope.elements.length : cursor + envelope.regions.length;
      envelope.nextCursor = String(consumed);
    }

    state.activeSnapshot = { id: snapshotID, url: String(location.href), map };
    clearPendingFrameClick();
    return enforceEnvelopeBudget(envelope, variants);
  }

  function failure(error, code, requiresObservation = false, extra = {}, secretValues = []) {
    if (!retainRedactions(secretValues)) return redactionCapacityFailure();
    return enforceEnvelopeBudget(
      { ok: false, error, code, requiresObservation, ...extra },
      activeRedactionVariants(),
    );
  }

  function stale(error) {
    invalidateSnapshot();
    return failure(error, "stale_browser_snapshot", true);
  }

  function validateEntry(entry, invalidateOnFailure = true) {
    const snapshot = state.activeSnapshot;
    if (!snapshot) return stale("The document changed; observe again.");
    if (snapshot.url !== String(location.href)) {
      return invalidateOnFailure ? stale("The document URL changed; observe again.") : failure("The document URL changed; observe again.", "stale_browser_snapshot", true);
    }
    const reject = (message) => (invalidateOnFailure ? stale(message) : failure(message, "stale_browser_snapshot", true));
    const element = entry.element;
    if (!element.isConnected
      || element.ownerDocument !== entry.ownerDocument
      || element.getRootNode() !== entry.rootNode
      || owningFrameElement(element.ownerDocument) !== entry.owningFrameElement) {
      return reject("The requested element moved to a different document or composed root.");
    }
    if (isHiddenComposed(element) || isDisabled(element) || !hasVisibleBox(element)) {
      return reject("The requested element is now hidden or disabled.");
    }
    const currentRole = role(element);
    const currentName = accessibleName(element);
    if (fingerprint(element, entry.frame, currentRole, currentName) !== entry.fingerprint) {
      return reject("The requested element changed; observe again.");
    }
    return null;
  }

  function isUsableRelocation(candidate) {
    const element = candidate.element;
    if (!element || isHiddenComposed(element) || isDisabled(element) || !hasVisibleBox(element)) return false;
    if (!isInteractive(element, role(element))) return false;
    const rect = candidate.public?.rect;
    if (!rect || !inViewport(rect)) return false;
    return true;
  }

  function tryRelocate(entry) {
    if (!entry?.semanticFingerprint || !entry.fingerprint) return null;
    const { candidates } = collect("page");
    const matches = candidates.filter((candidate) => (
      candidate.semanticFingerprint === entry.semanticFingerprint
      && candidate.fingerprint === entry.fingerprint
      && isUsableRelocation(candidate)
    ));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { ambiguous: true, count: matches.length };
    return null;
  }

  function resolveTarget(params) {
    const snapshot = state.activeSnapshot;
    if (!snapshot || typeof params.snapshot_id !== "string" || params.snapshot_id !== snapshot.id) {
      return { error: stale("The browser snapshot is stale; observe again.") };
    }
    if (snapshot.url !== String(location.href)) {
      return { error: stale("The document URL changed; observe again.") };
    }
    const hasIndex = Number.isInteger(params.element_index);
    const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;
    if (hasIndex === hasToken) {
      return { error: failure("Provide exactly one of element_index or element_token.", "invalid_browser_target") };
    }
    let entry = null;
    if (hasToken) entry = snapshot.map.get(params.element_token) || null;
    else entry = Array.from(snapshot.map.values()).find((candidate) => candidate.index === params.element_index) || null;
    if (!entry) return { error: stale("The requested element is no longer in the active snapshot.") };
    const validationError = validateEntry(entry, false);
    if (!validationError) return { entry };
    const relocated = tryRelocate(entry);
    if (relocated?.ambiguous) {
      return { error: stale("The requested element matched multiple candidates; observe again.") };
    }
    if (!relocated) {
      return { error: validationError.code === "stale_browser_snapshot"
        ? stale("The requested element could not be relocated; observe again.")
        : validationError };
    }
    const next = {
      ...relocated,
      index: entry.index,
      token: entry.token,
      relocated: true,
    };
    snapshot.map.set(entry.token, next);
    return { entry: next, relocated: true };
  }

  function resolveElement(token) {
    if (typeof token !== "string" || token.length === 0) {
      const error = new Error("el() requires a snapshot element token; observe again.");
      error.code = "stale_snapshot";
      throw error;
    }
    const snapshot = state.activeSnapshot;
    if (!snapshot) {
      const error = new Error("The browser snapshot is stale; observe again.");
      error.code = "stale_snapshot";
      throw error;
    }
    const entry = snapshot.map.get(token);
    if (!entry || !entry.element) {
      const error = new Error("The requested element is no longer in the active snapshot.");
      error.code = "stale_snapshot";
      throw error;
    }
    if (!entry.element.isConnected) {
      const error = new Error("The requested element is no longer connected; observe again.");
      error.code = "stale_snapshot";
      throw error;
    }
    return entry.element;
  }

  function nativeValueSetter(element, value) {
    const prototype = element.localName === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("native value setter unavailable");
    setter.call(element, value);
  }

  function dispatchBeforeInput(element, text) {
    return element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: "insertText",
    }));
  }

  function dispatchInputEvents(element, text) {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: text,
      inputType: "insertText",
    }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function isScrollableOnAxis(element, vertical) {
    const view = element.ownerDocument?.defaultView || globalThis;
    const style = view.getComputedStyle(element);
    const overflow = vertical ? style.overflowY : style.overflowX;
    if (!/(auto|scroll|overlay)/.test(overflow)) return false;
    return vertical
      ? element.scrollHeight > element.clientHeight
      : element.scrollWidth > element.clientWidth;
  }

  function resolveScrollTarget(element, vertical) {
    if (!element) {
      return { target: document.scrollingElement || document.documentElement, kind: "page" };
    }
    if (isScrollableOnAxis(element, vertical)) return { target: element, kind: "element" };
    let ancestor = composedParentElement(element);
    while (ancestor) {
      if (isScrollableOnAxis(ancestor, vertical)) return { target: ancestor, kind: "ancestor" };
      ancestor = composedParentElement(ancestor);
    }
    const ownerDocument = element.ownerDocument || document;
    return { target: ownerDocument.scrollingElement || ownerDocument.documentElement, kind: "page" };
  }

  function composedContains(ancestor, descendant) {
    if (ancestor === descendant || ancestor.contains?.(descendant)) return true;
    let current = descendant;
    while (current) {
      current = composedParentElement(current);
      if (current === ancestor) return true;
    }
    return false;
  }

  function clickCenter(element) {
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return { kind: "missing" };
    const ownerDocument = element.ownerDocument || document;
    const view = ownerDocument.defaultView || globalThis;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return { kind: "offscreen" };
    const hit = ownerDocument.elementFromPoint(x, y);
    if (!hit) return { kind: "missing" };
    if (composedContains(element, hit) || composedContains(hit, element)) return { kind: "clear" };
    return { kind: "obscured", hit };
  }

  function isInternalMutationNode(node) {
    return Boolean(node && node.nodeType === 1 && (
      node.hasAttribute?.(OVERLAY_ATTRIBUTE) || node.closest?.(`[${OVERLAY_ATTRIBUTE}]`)
    ));
  }

  function mutationSample(kind, node, attributeName) {
    if (state.mutationSamples.length >= MAX_MUTATION_SAMPLES) return;
    if (!node || node.nodeType !== 1) {
      state.mutationSamples.push({ op: kind, attribute: attributeName || "" });
      return;
    }
    const sample = {
      op: kind,
      tag: node.localName || "",
      role: role(node),
      name: accessibleName(node),
    };
    if (attributeName) sample.attribute = attributeName;
    state.mutationSamples.push(sample);
  }

  function noteDialog(node) {
    if (!node || node.nodeType !== 1) return;
    const dialogRole = role(node);
    const isDialog = node.localName === "dialog" || dialogRole === "dialog" || dialogRole === "alertdialog";
    if (!isDialog) {
      try {
        const nested = node.querySelector?.("dialog,[role='dialog'],[role='alertdialog']");
        if (nested) noteDialog(nested);
      } catch (_) {}
      return;
    }
    const open = node.localName !== "dialog" || node.hasAttribute("open") || node.open === true;
    if (!open || isHiddenComposed(node)) return;
    const label = accessibleName(node) || dialogRole || "dialog";
    if (!state.mutationDialogs.includes(label)) state.mutationDialogs.push(label);
  }

  function processMutationRecords(records) {
    for (const record of records || []) {
      if (isInternalMutationNode(record.target)) continue;
      if (record.type === "childList") {
        const added = record.addedNodes || [];
        for (let i = 0; i < added.length; i += 1) {
          const node = added[i];
          if (!node || node.nodeType !== 1 || isInternalMutationNode(node)) continue;
          state.mutationAdded += 1;
          mutationSample("added", node);
          noteDialog(node);
        }
        const removed = record.removedNodes || [];
        for (let i = 0; i < removed.length; i += 1) {
          const node = removed[i];
          if (!node || node.nodeType !== 1 || isInternalMutationNode(node)) continue;
          state.mutationRemoved += 1;
          mutationSample("removed", node);
        }
      } else if (record.type === "attributes") {
        if (isInternalMutationNode(record.target)) continue;
        state.mutationAttributes += 1;
        mutationSample("attr", record.target, record.attributeName || "");
      }
    }
  }

  function ensureMutationObserver() {
    if (state.mutationObserver || typeof MutationObserver !== "function") return;
    try {
      state.mutationObserver = new MutationObserver((records) => processMutationRecords(records));
      const root = document.documentElement || document.body || document;
      state.mutationObserver.observe(root, { subtree: true, childList: true, attributes: true });
    } catch (_) {
      state.mutationObserver = null;
    }
  }

  function beginMutationWindow() {
    ensureMutationObserver();
    try { processMutationRecords(state.mutationObserver?.takeRecords?.() || []); } catch (_) {}
    state.mutationAdded = 0;
    state.mutationRemoved = 0;
    state.mutationAttributes = 0;
    state.mutationSamples = [];
    state.mutationDialogs = [];
    state.mutationURL = String(location.href);
  }

  function countMagnitude(count) {
    const n = Math.max(0, Number(count) || 0);
    if (n === 0) return "none";
    if (n <= 8) return "few";
    if (n <= 80) return "some";
    return "many";
  }

  function mutationSummary() {
    try { processMutationRecords(state.mutationObserver?.takeRecords?.() || []); } catch (_) {}
    const urlNow = String(location.href);
    const urlChanged = urlNow !== state.mutationURL;
    const total = state.mutationAdded + state.mutationRemoved + state.mutationAttributes;
    const overBudget = state.mutationSamples.length >= MAX_MUTATION_SAMPLES || total > 80;
    if (overBudget) {
      const summary = {
        added: countMagnitude(state.mutationAdded),
        removed: countMagnitude(state.mutationRemoved),
        attributes: countMagnitude(state.mutationAttributes),
        dialogs: countMagnitude(state.mutationDialogs.length),
        urlChanged,
        truncated: true,
      };
      if (urlChanged) summary.url = redactURLForObservation(urlNow);
      return summary;
    }
    const summary = {
      added: state.mutationAdded,
      removed: state.mutationRemoved,
      attributes: state.mutationAttributes,
      dialogs: state.mutationDialogs.slice(0, 8),
      urlChanged,
    };
    if (urlChanged) summary.url = redactURLForObservation(urlNow);
    if (state.mutationSamples.length) summary.samples = state.mutationSamples.slice();
    return summary;
  }

  function attachMutation(result, extra = {}) {
    if (!result || typeof result !== "object") return result;
    if (result.code === "browser_redaction_capacity_exceeded") return result;
    return enforceEnvelopeBudget({
      ...result,
      mutation: mutationSummary(),
      ...extra,
    }, activeRedactionVariants());
  }

  function actionObservation(scope, action, secretValues = []) {
    return observe(scope, action, secretValues);
  }

  function sensitiveHandoff(scope, secretValues) {
    if (!retainRedactions(secretValues) || !retainCurrentSensitiveValues()) {
      return redactionCapacityFailure();
    }
    invalidateSnapshot();
    const observation = observe(scope, { kind: "focus", userHandoffRequired: true }, secretValues);
    return failure(
      "This sensitive field requires user input.",
      "user_handoff_required",
      false,
      { requiresUserInput: true, observation },
      secretValues,
    );
  }

  function queryVisibleSelector(selector) {
    if (typeof selector !== "string" || !selector.trim()) return null;
    let matched = null;
    try {
      matched = document.querySelector(selector);
    } catch (_) {
      return { error: failure("Invalid CSS selector.", "invalid_browser_wait") };
    }
    if (!matched) return { element: null };
    if (isHiddenComposed(matched) || !hasVisibleBox(matched)) return { element: null };
    return { element: matched };
  }

  function hasUnresolvedDocumentResources() {
    try {
      const images = document.images;
      for (let i = 0; i < images.length; i += 1) {
        if (!images[i].complete) return true;
      }
    } catch (_) {}
    return false;
  }

  function networkIdleStatus(quietMs) {
    const quiet = Math.min(5000, Math.max(50, Number(quietMs) || 500));
    const now = performance.now();
    let lastEnd = 0;
    let inflight = false;
    try {
      const navigationEntries = performance.getEntriesByType("navigation") || [];
      for (const entry of navigationEntries) {
        const end = entry.loadEventEnd || entry.domComplete || entry.responseEnd || 0;
        if (end > lastEnd) lastEnd = end;
      }
      const resources = performance.getEntriesByType("resource") || [];
      for (const entry of resources) {
        // Incomplete resource timings keep responseEnd at 0 in WebKit while in flight.
        if (!(entry.responseEnd > 0)) {
          inflight = true;
          continue;
        }
        if (entry.responseEnd > lastEnd) lastEnd = entry.responseEnd;
      }
    } catch (_) {}
    // Performance entries alone miss in-flight images on some WebKit builds; DOM complete flags cover that gap without page-world fetch/XHR patches.
    if (hasUnresolvedDocumentResources()) inflight = true;
    const readyState = String(document.readyState || "");
    if (readyState !== "complete") {
      return {
        ready: false,
        reason: "document_loading",
        readyState,
        lastActivityAgeMs: lastEnd > 0 ? Math.max(0, now - lastEnd) : 0,
        quietMs: quiet,
      };
    }
    if (inflight) {
      return {
        ready: false,
        reason: "resource_inflight",
        readyState,
        lastActivityAgeMs: 0,
        quietMs: quiet,
      };
    }
    if (!(lastEnd > 0)) {
      return {
        ready: true,
        reason: "idle",
        readyState,
        lastActivityAgeMs: quiet,
        quietMs: quiet,
      };
    }
    const age = Math.max(0, now - lastEnd);
    return {
      ready: age >= quiet,
      reason: age >= quiet ? "idle" : "quiet_window",
      readyState,
      lastActivityAgeMs: age,
      quietMs: quiet,
    };
  }

  function waitCheck(params, scope) {
    const mode = String(params?.mode || "");
    if (mode === "idle") {
      const status = networkIdleStatus(params.idle_ms);
      return enforceEnvelopeBudget({
        ok: true,
        ready: status.ready === true,
        mode: "idle",
        ...status,
      }, activeRedactionVariants());
    }

    if (mode !== "selector") {
      return failure("wait requires mode 'selector' or 'idle'.", "invalid_browser_wait");
    }

    const hasSelector = typeof params.selector === "string" && params.selector.trim().length > 0;
    const hasIndex = Number.isInteger(params.element_index);
    const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;
    if (hasSelector && (hasIndex || hasToken || typeof params.snapshot_id === "string")) {
      return failure("wait selector mode accepts selector or a snapshot element target, not both.", "invalid_browser_wait");
    }
    if (hasSelector) {
      const matched = queryVisibleSelector(params.selector);
      if (matched.error) return matched.error;
      return enforceEnvelopeBudget({
        ok: true,
        ready: Boolean(matched.element),
        mode: "selector",
        selector: truncateUTF16(params.selector, 512),
      }, activeRedactionVariants());
    }
    if (!hasIndex && !hasToken) {
      return failure("wait selector mode requires selector or a snapshot element target.", "invalid_browser_wait");
    }
    const resolved = resolveTarget(params);
    if (resolved.error) {
      // Stale/missing targets are "not ready yet" while the document may still be updating.
      // Hard validation errors (invalid_browser_target) stay terminal.
      const code = resolved.error.code;
      if (code === "invalid_browser_target" || code === "invalid_browser_wait") return resolved.error;
      return enforceEnvelopeBudget({
        ok: true,
        ready: false,
        mode: "selector",
        pendingReason: code || "target_not_ready",
      }, activeRedactionVariants());
    }
    return enforceEnvelopeBudget({
      ok: true,
      ready: true,
      mode: "selector",
      scope,
    }, activeRedactionVariants());
  }

  function dispatch(params) {
    const action = String(params?.action || "");
    const scope = params?.scope === "page" ? "page" : "viewport";
    ensureMutationObserver();
    if (action === "observe") return observe(scope, params.action_metadata || null, [], params);
    if (action === "wait_check") return waitCheck(params, scope);
    if (action === "clear") {
      invalidateSnapshot();
      clearPendingFrameClick();
      state.redactionValues = [];
      state.redactionTotalUnits = 0;
      state.redactionOverflow = false;
      clearHighlight();
      return { ok: true };
    }
    if (action === "invalidate") {
      invalidateSnapshot();
      clearPendingFrameClick();
      clearHighlight();
      return { ok: true };
    }
    if (action === "finalize_click") {
      const pending = state.pendingFrameClick;
      if (pending) {
        if (pending.activationCancelled) {
          clearPendingFrameClick();
          return actionObservation(scope, params.action_metadata || { kind: "click" });
        }
        if (pending.errorObserved) {
          clearPendingFrameClick();
          return failure(
            "The iframe navigation failed; use screenshot or Computer Use if the destination is unavailable.",
            "browser_iframe_navigation_failed",
            true,
            { limitations: ["iframe_navigation_failed; use screenshot or Computer Use"] },
          );
        }
        let currentDocument = null;
        try {
          currentDocument = pending.frameElement?.contentDocument || null;
        } catch (_) {}
        if (!currentDocument) {
          if (pending.loadObserved || pending.errorObserved) {
            clearPendingFrameClick();
            return failure(
              "The iframe destination is cross-origin or unavailable; use screenshot or Computer Use.",
              "browser_iframe_content_unavailable",
              true,
              { limitations: ["cross_origin_iframe_after_navigation; use screenshot or Computer Use"] },
            );
          }
          return enforceEnvelopeBudget({ ok: true, pendingFrameNavigation: true }, activeRedactionVariants());
        }
        if (pending.navigationBearing) {
          const documentChanged = currentDocument !== pending.sourceDocument
            || String(currentDocument.URL || "") !== pending.sourceURL;
          const sameDocumentURLChanged = currentDocument === pending.sourceDocument
            && String(currentDocument.URL || "") !== pending.sourceURL;
          const usable = currentDocument.readyState === "complete"
            && (pending.loadObserved || sameDocumentURLChanged);
          if (pending.loadObserved && !documentChanged) {
            clearPendingFrameClick();
            return failure(
              "The iframe navigation did not replace the source document.",
              "browser_iframe_navigation_failed",
              true,
              { limitations: ["iframe_navigation_failed; use screenshot or Computer Use"] },
            );
          }
          if (!documentChanged || !usable) {
            return enforceEnvelopeBudget({ ok: true, pendingFrameNavigation: true }, activeRedactionVariants());
          }
        }
      }
      clearPendingFrameClick();
      return actionObservation(scope, params.action_metadata || { kind: "click" });
    }

    const targeted = ["click", "input", "select"].includes(action)
      || (action === "scroll" && (Number.isInteger(params.element_index) || typeof params.element_token === "string"));
    const resolved = targeted ? resolveTarget(params) : null;
    if (resolved?.error) return resolved.error;
    const entry = resolved?.entry || null;
    const element = entry?.element || null;
    const relocated = resolved?.relocated === true || entry?.relocated === true;
    const relocatedExtra = relocated ? { relocated: true } : {};

    try {
      if (["click", "input", "select", "scroll"].includes(action)) beginMutationWindow();
      if (action === "click") {
        const hit = clickCenter(element);
        if (relocated && hit.kind !== "clear") {
          return stale("The requested element could not be relocated; observe again.");
        }
        if (hit.kind === "obscured") {
          invalidateSnapshot();
          return failure(
            "The target is obscured at its center; observe again before retrying.",
            "browser_target_obscured",
            true,
            { retryable: true },
          );
        }
        const preFocusSensitive = isSensitive(element);
        const preFocusValue = controlValue(element);
        highlight(element);
        element.focus({ preventScroll: true });
        const postFocusSensitive = isSensitive(element);
        const postFocusValue = (preFocusSensitive || postFocusSensitive) ? controlValue(element) : "";
        if (preFocusSensitive || postFocusSensitive) {
          return sensitiveHandoff(scope, [preFocusValue, postFocusValue]);
        }
        const postFocusError = validateEntry(entry);
        if (postFocusError) return postFocusError;
        const frameElement = entry.owningFrameElement;
        let pending = null;
        let clickEvent = null;
        let submitEvent = null;
        let invalidObserved = false;
        const ownerDocument = entry.ownerDocument;
        const submitForm = element.form || null;
        const [formAction] = submitSemantics(element);
        const href = resolvedHref(element);
        const initiallyNavigationBearing = Boolean((href && !href.toLowerCase().startsWith("javascript:")) || formAction);
        const captureClick = (event) => {
          const path = typeof event.composedPath === "function" ? event.composedPath() : [];
          if (event.target === element || path.includes(element)) clickEvent = event;
        };
        const captureSubmit = (event) => {
          if (submitForm && event.target === submitForm
            && (!event.submitter || event.submitter === element)) submitEvent = event;
        };
        const captureInvalid = (event) => {
          if (submitForm && event.target?.form === submitForm) invalidObserved = true;
        };
        ownerDocument.addEventListener("click", captureClick, true);
        if (submitForm) ownerDocument.addEventListener("submit", captureSubmit, true);
        if (submitForm) ownerDocument.addEventListener("invalid", captureInvalid, true);
        if (frameElement) {
          pending = {
            frameElement,
            sourceDocument: entry.ownerDocument,
            sourceURL: String(entry.ownerDocument.URL || ""),
            navigationBearing: initiallyNavigationBearing,
            activationCancelled: false,
            loadObserved: false,
            errorObserved: false,
          };
          pending.onLoad = () => { pending.loadObserved = true; };
          pending.onError = () => { pending.errorObserved = true; };
          frameElement.addEventListener("load", pending.onLoad);
          frameElement.addEventListener("error", pending.onError);
          state.pendingFrameClick = pending;
        } else {
          clearPendingFrameClick();
        }
        invalidateSnapshot();
        try {
          element.click();
        } finally {
          ownerDocument.removeEventListener("click", captureClick, true);
          if (submitForm) {
            ownerDocument.removeEventListener("submit", captureSubmit, true);
            ownerDocument.removeEventListener("invalid", captureInvalid, true);
          }
        }
        const constraintBlocked = Boolean(
          submitForm
          && !submitForm.noValidate
          && !element.formNoValidate
          && (invalidObserved || (!submitEvent && submitForm.matches(":invalid"))),
        );
        const activationCancelled = Boolean(
          clickEvent?.defaultPrevented
          || submitEvent?.defaultPrevented
          || constraintBlocked,
        );
        if (pending) {
          pending.activationCancelled = activationCancelled;
          pending.navigationBearing = initiallyNavigationBearing && !activationCancelled;
        }
        return attachMutation({
          ok: true,
          deferObservation: true,
          targetFrame: entry.frame,
          navigationBearing: state.pendingFrameClick?.navigationBearing === true,
          action: { kind: "click", ...(relocated ? { relocated: true } : {}) },
        }, relocatedExtra);
      }

      if (action === "input") {
        if (typeof params.text !== "string") return failure("input requires text.", "invalid_browser_input");
        if (!retainRedactions([params.text])) return redactionCapacityFailure();
        const preFocusSensitive = isSensitive(element);
        const preFocusValue = controlValue(element);
        highlight(element);
        element.focus({ preventScroll: true });
        const postFocusSensitive = isSensitive(element);
        const postFocusValue = (preFocusSensitive || postFocusSensitive) ? controlValue(element) : "";
        const secretValues = [params.text, preFocusValue, postFocusValue];
        if (preFocusSensitive || postFocusSensitive) {
          return sensitiveHandoff(scope, secretValues);
        }
        if (!retainCurrentSensitiveValues()) return redactionCapacityFailure();
        const postFocusError = validateEntry(entry);
        if (postFocusError) return postFocusError;
        if (!dispatchBeforeInput(element, params.text)) {
          invalidateSnapshot();
          return failure("The page cancelled text input; observe again.", "browser_input_cancelled", true, {}, secretValues);
        }
        if (isSensitive(element)) {
          return sensitiveHandoff(scope, [...secretValues, controlValue(element)]);
        }
        const postBeforeInputError = validateEntry(entry);
        if (postBeforeInputError) return postBeforeInputError;
        if (element.localName === "input" || element.localName === "textarea") {
          nativeValueSetter(element, params.text);
        } else if (element.isContentEditable) {
          element.textContent = params.text;
        } else {
          return failure("The target does not accept text input.", "unsupported_browser_action");
        }
        dispatchInputEvents(element, params.text);
        invalidateSnapshot();
        return attachMutation(
          actionObservation(scope, { kind: "input", characterCount: params.text.length, ...(relocated ? { relocated: true } : {}) }, [params.text]),
          relocatedExtra,
        );
      }

      if (action === "select") {
        if (element.localName !== "select") return failure("The target is not a select control.", "unsupported_browser_action");
        if (typeof params.option !== "string") return failure("select requires option.", "invalid_browser_input");
        const preFocusSensitive = isSensitive(element);
        const preFocusValue = controlValue(element);
        highlight(element);
        element.focus({ preventScroll: true });
        const postFocusSensitive = isSensitive(element);
        const postFocusValue = (preFocusSensitive || postFocusSensitive) ? controlValue(element) : "";
        if (preFocusSensitive || postFocusSensitive) {
          return sensitiveHandoff(scope, [params.option, preFocusValue, postFocusValue]);
        }
        const postFocusError = validateEntry(entry);
        if (postFocusError) return postFocusError;
        const option = Array.from(element.options).find((candidate) => candidate.label === params.option || candidate.value === params.option);
        if (!option) return stale("The requested option changed; observe again.");
        element.value = option.value;
        option.selected = true;
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        invalidateSnapshot();
        return attachMutation(
          actionObservation(scope, { kind: "select", selected: truncateUTF16(option.label || option.value, STRING_LIMITS.selected), ...(relocated ? { relocated: true } : {}) }),
          relocatedExtra,
        );
      }

      if (action === "scroll") {
        const direction = ["up", "down", "left", "right"].includes(params.direction) ? params.direction : "down";
        const amount = Math.min(10, Math.max(0.1, Number(params.amount) || 0.8));
        if (element) highlight(element);
        const vertical = direction === "up" || direction === "down";
        const { target, kind: targetKind } = resolveScrollTarget(element, vertical);
        const sign = direction === "up" || direction === "left" ? -1 : 1;
        const ownerView = target.ownerDocument?.defaultView || globalThis;
        const width = target === target.ownerDocument?.scrollingElement ? ownerView.innerWidth : target.clientWidth;
        const height = target === target.ownerDocument?.scrollingElement ? ownerView.innerHeight : target.clientHeight;
        target.scrollBy({ left: vertical ? 0 : sign * width * amount, top: vertical ? sign * height * amount : 0, behavior: "auto" });
        invalidateSnapshot();
        return attachMutation(
          actionObservation(scope, { kind: "scroll", direction, amount, target: targetKind, ...(relocated ? { relocated: true } : {}) }),
          relocatedExtra,
        );
      }
    } catch (_) {
      invalidateSnapshot();
      clearPendingFrameClick();
      return failure("The browser action could not be completed; observe again.", "browser_action_failed", true);
    }

    return failure(`Unsupported structured browser action: ${truncateUTF16(action, 128)}`, "unsupported_browser_action");
  }

  Object.defineProperty(globalThis, API_NAME, {
    value: Object.freeze({ dispatch, resolveElement }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
