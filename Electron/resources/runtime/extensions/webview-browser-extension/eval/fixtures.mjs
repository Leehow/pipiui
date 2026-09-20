/**
 * Synthetic observation gold and complete-task definitions.
 * Gold is authored here; never taken from a model or Jev score.
 */
export const SCHEMA_VERSION = "browser-observation-eval.v1";
export const SECRET_PASSWORD_VALUE = "s3cret-pass-value";

const FILLER = (n) => `Area ${String(n).padStart(2, "0")}`;

function sections(labels, goldByLabel = {}) {
  return labels.map((label, index) => {
    const gold = goldByLabel[label];
    const inner = gold || `<button type="button">Open ${label}</button>`;
    return `<section aria-label="${label}" id="sec-${index + 1}">${inner}</section>`;
  }).join("");
}

function page({ title, main, extra = "" }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
<header><h1>${title}</h1></header>
<nav aria-label="Primary"><a href="/home">Home</a><a href="/help">Help</a></nav>
${extra}
<main>${main}</main>
<footer><p>Synthetic fixture. No live site.</p></footer>
</body></html>`;
}

function wireClick(window, selector, flagId, value) {
  const node = window.document.querySelector(selector);
  if (!node) return;
  node.addEventListener("click", () => {
    const flag = window.document.getElementById(flagId);
    if (flag) flag.textContent = value;
  });
}

function writeIframe(window, iframeId, html) {
  const iframe = window.document.getElementById(iframeId);
  if (!iframe) return;
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
}

const TEN = Array.from({ length: 10 }, (_, i) => FILLER(i + 1));
const FORTY = Array.from({ length: 40 }, (_, i) => FILLER(i + 1));

export const OBSERVATION_CASES = [
  {
    id: "outside-region-preview",
    scenario: "区域预览外目标",
    intent: "pay now for the current cart",
    html: page({
      title: "Shop",
      extra: `<p id="order-status">unpaid</p>`,
      main: sections([...TEN.slice(0, 9), "Checkout"], {
        Checkout: `<button type="button" id="pay-now">Pay now</button>`,
      }),
    }),
    init: (window) => wireClick(window, "#pay-now", "order-status", "paid"),
    gold: { selector: "#pay-now", present: true, name: "Pay now", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "region-counts", kind: "regions_have_counts" },
      { id: "more-regions", kind: "field_truthy", field: "nextCursor" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "miss", reason: "gold lives in a region after the first 8 region previews" },
  },
  {
    id: "same-name-controls",
    scenario: "多个区域的同名控件",
    intent: "submit the checkout form, not the newsletter",
    html: page({
      title: "Duplicate Submit",
      extra: `<p id="checkout-status">idle</p>`,
      main: `<form aria-label="Newsletter"><label>Email <input id="newsletter-email"></label><button type="button" id="newsletter-submit">Submit</button></form>
        ${sections(TEN.slice(0, 8))}
        <form aria-label="Checkout"><label>Card name <input id="card-name"></label><button type="button" id="checkout-submit">Submit</button></form>`,
    }),
    init: (window) => wireClick(window, "#checkout-submit", "checkout-status", "submitted"),
    gold: { selector: "#checkout-submit", present: true, name: "Submit", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "miss", reason: "first Submit is newsletter; checkout Submit is after region pagination" },
  },
  {
    id: "zh-en-intent",
    scenario: "中英文表达",
    intent: "submit the order",
    html: page({
      title: "中英结算",
      extra: `<p id="order-status">unpaid</p>`,
      main: `${sections(TEN.slice(0, 9))}
        <section aria-label="结算" id="sec-zh"><button type="button" id="submit-order">提交订单</button></section>`,
    }),
    init: (window) => wireClick(window, "#submit-order", "order-status", "paid"),
    gold: { selector: "#submit-order", present: true, name: "提交订单", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "miss", reason: "Chinese gold is outside the first region page; A has no intent matching" },
  },
  {
    id: "semantic-mismatch",
    scenario: "语义与词面不一致",
    intent: "confirm payment",
    html: page({
      title: "Continue vs pay",
      extra: `<p id="pay-status">idle</p>`,
      main: `${sections(TEN.slice(0, 9))}
        <section aria-label="Review"><button type="button" id="continue-pay" aria-label="Confirm payment">Continue</button></section>`,
    }),
    init: (window) => wireClick(window, "#continue-pay", "pay-status", "confirmed"),
    gold: { selector: "#continue-pay", present: true, name: "Confirm payment", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "miss", reason: "visible text is Continue; gold is after the first region page" },
  },
  {
    id: "dialog-modal",
    scenario: "弹窗",
    intent: "confirm permanent delete",
    html: page({
      title: "Files",
      extra: `<p id="delete-status">kept</p>
        <dialog id="confirm-dialog" open>
          <h2>Delete file</h2>
          <button type="button" id="confirm-delete">Delete permanently</button>
          <button type="button" id="cancel-delete">Cancel</button>
        </dialog>`,
      main: `<section aria-label="Library"><button type="button" id="open-other">Open other</button></section>`,
    }),
    init: (window) => wireClick(window, "#confirm-delete", "delete-status", "deleted"),
    gold: { selector: "#confirm-delete", present: true, name: "Delete permanently", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "dialog-region", kind: "region_role", role: "dialog" },
      { id: "limitations", kind: "limitations_nonempty" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "hit", reason: "open dialog is an early landmark" },
  },
  {
    id: "sensitive-form",
    scenario: "表单敏感内容",
    intent: "sign in with the email field",
    html: page({
      title: "Sign in",
      extra: `<p id="auth-status">guest</p>`,
      main: `<form aria-label="Sign in" id="signin-form">
        <label for="email">Email</label>
        <input id="email" name="email" value="user@example.test">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" value="${SECRET_PASSWORD_VALUE}" autocomplete="current-password">
        <button type="button" id="sign-in">Sign in</button>
      </form>`,
    }),
    init: (window) => wireClick(window, "#sign-in", "auth-status", "signed-in"),
    gold: { selector: "#sign-in", present: true, name: "Sign in", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "password-absent", kind: "text_absent", value: SECRET_PASSWORD_VALUE },
      { id: "sensitive-hint", kind: "text_present", value: "sensitive value hidden" },
    ],
    baselineQuery: { scope: "viewport", region: "form" },
    expectedBaseline: { target: "hit", reason: "existing region expand publishes the form controls, including the redacted password" },
  },
  {
    id: "same-origin-iframe",
    scenario: "同源 iframe",
    intent: "pay the invoice inside the embedded frame",
    html: page({
      title: "Invoice host",
      extra: `<p id="invoice-status">unpaid</p><iframe id="pay-frame" title="Invoice" data-eval-box="0,80,400,160"></iframe>`,
      main: `<section aria-label="Summary"><p>Host chrome only.</p></section>`,
    }),
    init: (window) => {
      writeIframe(
        window,
        "pay-frame",
        `<!DOCTYPE html><html><body><button type="button" id="iframe-pay">Pay invoice</button></body></html>`,
      );
      const inner = window.document.getElementById("pay-frame")?.contentDocument?.getElementById("iframe-pay");
      inner?.addEventListener("click", () => {
        const flag = window.document.getElementById("invoice-status");
        if (flag) flag.textContent = "paid";
      });
    },
    gold: { selector: "#iframe-pay", present: true, name: "Pay invoice", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "hit", reason: "same-origin iframe is walked by collect" },
  },
  {
    id: "scope-filter",
    scenario: "范围过滤",
    intent: "export the CSV report",
    html: page({
      title: "Exports",
      main: `<section aria-label="Tools">
        <button type="button" id="export-pdf">Export PDF</button>
        <button type="button" id="export-csv">Export CSV</button>
        <button type="button" id="print-page">Print</button>
        <button type="button" id="share-link">Share</button>
      </section>
      ${sections(TEN.slice(0, 6))}`,
    }),
    gold: { selector: "#export-csv", present: true, name: "Export CSV", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "name-filter", kind: "text_present", value: "Export CSV" },
    ],
    baselineQuery: { scope: "viewport", role: "button", name: "Export CSV" },
    expectedBaseline: { target: "hit", reason: "existing role/name filters are part of A" },
  },
  {
    id: "page-change",
    scenario: "页面变更",
    intent: "save the draft",
    html: page({
      title: "Editor",
      extra: `<p id="save-status">dirty</p>`,
      main: `<section aria-label="Editor"><button type="button" id="live-save">Save draft</button></section>`,
    }),
    gold: { selector: "#live-save", present: true, name: "Save draft", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "stale-after-mutation", kind: "extra_true", extra: "staleAfterMutation" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "hit", reason: "gold is in the first region; mutation is a separate assertion" },
    afterObserve: (session, envelope) => {
      let token = null;
      for (const el of envelope?.elements || []) {
        if (!el?.token) continue;
        try {
          const node = session.window.__pipiBrowserDOM.resolveElement(el.token);
          if (node && node.id === "live-save") {
            token = el.token;
            break;
          }
        } catch {
          // ignore unresolved tokens
        }
      }
      const gold = session.window.document.getElementById("live-save");
      if (gold) gold.hidden = true;
      const snapshotID = envelope?.snapshotID;
      if (!token || !snapshotID) return { staleAfterMutation: false, reason: "gold token was not shown" };
      const clicked = session.window.eval(
        `globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify({
          action: "click",
          snapshot_id: snapshotID,
          element_token: token,
        })})`,
      );
      const stale = clicked && clicked.ok === false && (
        clicked.code === "stale_browser_snapshot"
        || clicked.code === "browser_target_not_actionable"
        || /hidden|stale|disabled|changed/i.test(String(clicked.error || ""))
      );
      return { staleAfterMutation: Boolean(stale), clickResult: { ok: clicked?.ok === true, code: clicked?.code || null } };
    },
  },
  {
    id: "no-match",
    scenario: "无匹配",
    intent: "open the quantum teleport control",
    html: page({
      title: "Settings",
      main: `<section aria-label="Settings">
        <button type="button" id="dark-mode">Dark mode</button>
        <button type="button" id="language">Language</button>
      </section>`,
    }),
    gold: { selector: "#quantum-teleport", present: false, name: "Quantum teleport", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "no-false-gold", kind: "text_absent", value: "Quantum teleport" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "not_applicable", reason: "no gold control exists; absence is the gold" },
  },
  {
    id: "over-budget",
    scenario: "超预算",
    intent: "open the last catalog area",
    html: page({
      title: "Huge catalog",
      extra: `<p id="tail-status">idle</p>`,
      main: sections([...FORTY.slice(0, 39), "Tail"], {
        Tail: `<button type="button" id="open-tail">Open tail</button>`,
      }),
    }),
    init: (window) => wireClick(window, "#open-tail", "tail-status", "opened"),
    gold: { selector: "#open-tail", present: true, name: "Open tail", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "incomplete", kind: "field_truthy", field: "nextCursor" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "miss", reason: "first observe only publishes 8 regions; gold is far beyond that page" },
  },
  {
    id: "dual-viewport",
    scenario: "双视口",
    intent: "open project settings",
    html: page({
      title: "Responsive shell",
      extra: `<aside id="desktop-rail"><button type="button" id="rail-settings">Project settings</button></aside>
        <nav id="mobile-bar" hidden><button type="button" id="mobile-search">Search</button></nav>`,
      main: `<section aria-label="Canvas"><p>Viewport-specific chrome.</p></section>`,
    }),
    init: (window, ctx) => {
      const mobile = ctx?.viewport?.id === "mobile";
      const rail = window.document.getElementById("desktop-rail");
      const bar = window.document.getElementById("mobile-bar");
      if (rail) rail.hidden = Boolean(mobile);
      if (bar) bar.hidden = !mobile;
    },
    viewports: [
      { id: "desktop", width: 1280, height: 800, goldSelector: "#rail-settings", goldName: "Project settings" },
      { id: "mobile", width: 390, height: 700, goldSelector: "#mobile-search", goldName: "Search" },
    ],
    gold: { selector: "#rail-settings", present: true, name: "Project settings", role: "button" },
    requiredInfo: [
      { id: "ok", kind: "ok_true" },
      { id: "snapshot", kind: "snapshot_id" },
      { id: "tokens-isolated", kind: "extra_true", extra: "tokensDistinct" },
    ],
    baselineQuery: { scope: "viewport" },
    expectedBaseline: { target: "hit", reason: "each viewport session has its own chrome gold" },
  },
];

function caseById(id) {
  const found = OBSERVATION_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown observation case ${id}`);
  return found;
}

export const TASK_DEFINITIONS = [
  {
    id: "task-pay-outside-preview",
    title: "Pay for the cart that sits outside the first region page",
    sourceCaseId: "outside-region-preview",
    intent: "pay now for the current cart",
    prompt: "On this synthetic shop page, pay for the current cart. Do not use live sites.",
    toolBudget: 8,
    gold: { selector: "#pay-now", present: true },
    requiredInfo: ["region counts remain visible", "pagination/nextCursor is not hidden"],
    completion: { flagId: "order-status", equals: "paid" },
    reset: "recreate the JSDOM session from the case HTML",
    fixtureActivation: { kind: "dom-click", selector: "#pay-now" },
    agentExecuted: false,
    modelExecuted: false,
  },
  {
    id: "task-signin-without-leaking-secret",
    title: "Sign in without putting the password value in an observation",
    sourceCaseId: "sensitive-form",
    intent: "sign in with the email field",
    prompt: "Sign in on this synthetic form. The password value must never appear in tool output.",
    toolBudget: 8,
    gold: { selector: "#sign-in", present: true },
    requiredInfo: ["sensitive value hidden", "password literal absent from observation JSON"],
    completion: { flagId: "auth-status", equals: "signed-in" },
    reset: "recreate the JSDOM session from the case HTML",
    fixtureActivation: { kind: "dom-click", selector: "#sign-in" },
    forbiddenInObservations: [SECRET_PASSWORD_VALUE],
    agentExecuted: false,
    modelExecuted: false,
  },
  {
    id: "task-confirm-dialog",
    title: "Confirm delete inside an open dialog",
    sourceCaseId: "dialog-modal",
    intent: "confirm permanent delete",
    prompt: "Confirm permanent delete in the open dialog on this synthetic page.",
    toolBudget: 6,
    gold: { selector: "#confirm-delete", present: true },
    requiredInfo: ["dialog region remains visible"],
    completion: { flagId: "delete-status", equals: "deleted" },
    reset: "recreate the JSDOM session from the case HTML",
    fixtureActivation: { kind: "dom-click", selector: "#confirm-delete" },
    agentExecuted: false,
    modelExecuted: false,
  },
  {
    id: "task-iframe-invoice",
    title: "Pay the invoice inside a same-origin iframe",
    sourceCaseId: "same-origin-iframe",
    intent: "pay the invoice inside the embedded frame",
    prompt: "Pay the invoice that is rendered in the same-origin iframe.",
    toolBudget: 8,
    gold: { selector: "#iframe-pay", present: true },
    requiredInfo: ["iframe contents are collected, not treated as cross-origin"],
    completion: { flagId: "invoice-status", equals: "paid" },
    reset: "recreate the JSDOM session from the case HTML",
    fixtureActivation: { kind: "dom-click-deep", selector: "#iframe-pay" },
    agentExecuted: false,
    modelExecuted: false,
  },
];

export function observationCaseById(id) {
  return caseById(id);
}

export function taskSourceCase(task) {
  return caseById(task.sourceCaseId);
}

export function isTaskComplete(view, task) {
  const flag = view.document.getElementById(task.completion.flagId);
  return Boolean(flag && flag.textContent === task.completion.equals);
}

export function applyFixtureActivation(view, task) {
  if (task.fixtureActivation?.kind === "dom-click") {
    view.document.querySelector(task.fixtureActivation.selector)?.click();
    return;
  }
  if (task.fixtureActivation?.kind === "dom-click-deep") {
    const iframe = view.document.querySelector("iframe");
    const inner = iframe?.contentDocument?.querySelector(task.fixtureActivation.selector)
      || view.document.querySelector(task.fixtureActivation.selector);
    inner?.click();
  }
}

export const BASELINE_GROUP = "A";
export const UNEVALUATED_GROUPS = {
  B: { status: "not_executed", reason: "baseline command measures A only; use run-browser-observation-contrast.mjs for the production B path" },
  C: { status: "not_executed", reason: "baseline command does not upload; the contrast runner requires explicit --live-synthetic authorization and a key" },
};
