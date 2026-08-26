import { e as Y } from "./index-DK4k06Xx.js";
import { c as J, d as Q, f as q, g as ee, r as oe, u as re, h as ie, a as te, b as ne } from "./office-renderer-CZRmDY3X.js";
import { b as ae, f as W, a as le, g as V } from "./printLayout-BXoQACLZ.js";
const y = {
  width: 794,
  height: 1123
}, se = /* @__PURE__ */ new Set(["file:", "about:", "data:"]), S = 0.24, _ = 3, N = 0.15, de = "0.3.26", ce = 20555, ue = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", fe = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", me = "http://schemas.openxmlformats.org/package/2006/relationships", ve = "urn:schemas-microsoft-com:vml", O = "word/document.xml", pe = "word/_rels/document.xml.rels", I = "docx-page-background", he = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
}, ge = (o) => {
  const e = typeof o.renderAsync == "function" ? o : o.default;
  if (!e || typeof e.renderAsync != "function")
    throw new TypeError("@file-viewer/docx did not expose a compatible renderAsync function.");
  return e;
}, we = /* @__PURE__ */ (() => {
  const o = {
    module: null,
    async load() {
      return this.module || (this.module = import("./docx-preview-DLB7QpPC.js")), this.module;
    }
  };
  return async () => ge(await o.load());
})(), xe = (o) => o instanceof Error ? /(?:undefined|null).*children|children.*(?:undefined|null)/i.test(o.message) && /renderHeaderFooter/i.test(o.stack || "") : !1, be = async (o, e, r, t) => {
  try {
    return await o(e, r, void 0, t), !1;
  } catch (a) {
    if (!xe(a))
      throw a;
    return r.innerHTML = "", await o(e, r, void 0, {
      ...t,
      renderHeaders: !1,
      renderFooters: !1
    }), !0;
  }
}, ye = (o, e) => {
  if ((o.byteLength >= 4 ? new DataView(o).getUint16(0, !1) : 0) !== ce)
    throw new Error(J(e?.options)("word.error.invalidDocx"));
}, k = (o) => o.ownerDocument.defaultView, Pe = (o) => {
  var e, r;
  const t = (r = (e = k(o)) === null || e === void 0 ? void 0 : e.DOMParser) !== null && r !== void 0 ? r : globalThis.DOMParser;
  return new t();
}, ke = (o) => {
  var e, r, t;
  const a = [
    o.ownerDocument.URL,
    (r = (e = k(o)) === null || e === void 0 ? void 0 : e.location) === null || r === void 0 ? void 0 : r.href,
    (t = globalThis.location) === null || t === void 0 ? void 0 : t.href
  ].filter(Boolean);
  for (const n of a)
    try {
      return new URL(n).protocol;
    } catch {
    }
  return "";
}, C = (o, e, r) => {
  const t = Array.from(o.getElementsByTagNameNS(e, r));
  return t.length ? t : Array.from(o.getElementsByTagName("*")).filter((a) => a.localName === r);
}, U = (o, e) => {
  const r = e.parseFromString(o, "application/xml");
  return C(r, "http://www.mozilla.org/newlayout/xml/parsererror.xml", "parsererror").length ? null : r;
}, Ee = (o, e) => {
  const r = e.startsWith("/") ? [] : o.split("/").slice(0, -1);
  return e.replace(/^\/+/, "").split("/").forEach((t) => {
    if (!(!t || t === ".")) {
      if (t === "..") {
        r.pop();
        return;
      }
      r.push(t);
    }
  }), r.join("/");
}, Se = (o) => {
  var e;
  const r = ((e = o.split(".").pop()) === null || e === void 0 ? void 0 : e.toLowerCase()) || "";
  return he[r];
}, Ae = async (o, e = () => new DOMParser()) => {
  try {
    const r = await Y.loadAsync(o), t = r.file(O), a = r.file(pe);
    if (!t || !a)
      return;
    const n = e(), i = U(await t.async("string"), n), d = U(await a.async("string"), n);
    if (!i || !d)
      return;
    const p = C(i, ue, "background")[0], f = p && C(p, ve, "fill")[0], h = f?.getAttributeNS(fe, "id") || f?.getAttribute("r:id");
    if (!h)
      return;
    const c = C(d, me, "Relationship").find((L) => L.getAttribute("Id") === h), v = c?.getAttribute("Target");
    if (!v || c?.getAttribute("TargetMode") === "External")
      return;
    const l = Ee(O, v), u = Se(l), P = r.file(l) || r.file(decodeURIComponent(l));
    return !u || !P ? void 0 : `data:${u};base64,${await P.async("base64")}`;
  } catch {
    return;
  }
}, Me = (o, e) => {
  if (!e)
    return 0;
  let r = 0;
  return o.querySelectorAll("section.docx").forEach((t) => {
    const a = Array.from(t.children).find((i) => i.classList.contains(I)), n = a || o.ownerDocument.createElement("div");
    n.className = I, n.setAttribute("aria-hidden", "true"), n.style.backgroundImage = `url("${e}")`, a || t.prepend(n), r += 1;
  }), r;
}, De = (o, e) => {
  var r, t;
  return e?.worker === !1 ? !1 : e?.worker === !0 ? !0 : !!(((t = (r = k(o)) === null || r === void 0 ? void 0 : r.Worker) !== null && t !== void 0 ? t : globalThis.Worker) && e?.workerUrl && !se.has(ke(o)));
}, _e = (o) => {
  var e;
  const r = k(o), t = (e = r?.matchMedia) !== null && e !== void 0 ? e : globalThis.matchMedia;
  return typeof t == "function" && t("(prefers-color-scheme: dark)").matches;
}, Ce = (o, e, r) => {
  var t;
  if (r?.darkMode !== void 0)
    return r.darkMode;
  const a = ie((t = e?.options) === null || t === void 0 ? void 0 : t.theme);
  return a === "dark" ? !0 : a === "light" ? !1 : _e(o);
}, B = (o, e) => !o || e ? o : `${o}${o.includes("?") ? "&" : "?"}file-viewer-docx=${de}`, X = (o, e) => {
  if (e === "allow")
    return 0;
  let r = 0;
  return o.querySelectorAll("a[href]").forEach((t) => {
    const a = t.getAttribute("href");
    !a || a.startsWith("#") || (t.hasAttribute("data-docx-external-href") || t.setAttribute("data-docx-external-href", a), t.removeAttribute("href"), t.setAttribute("aria-disabled", "true"), r += 1);
  }), r;
}, Te = (o, e, r) => {
  var t, a, n;
  const i = (t = e?.options) === null || t === void 0 ? void 0 : t.docx, d = Q(o.ownerDocument), p = De(o, i), f = i?.visualPagination === !0, h = Ce(o, e, i), c = (u) => {
    (u.phase === "render" || u.phase === "layout" || u.phase === "done") && r();
  }, v = (a = i?.externalLinkPolicy) !== null && a !== void 0 ? a : "block", l = {
    useWorker: p,
    breakPages: f,
    ignoreLastRenderedPageBreak: (n = i?.ignoreLastRenderedPageBreak) !== null && n !== void 0 ? n : !f,
    externalLinkPolicy: v,
    darkMode: h,
    progress: (u) => {
      (u.phase === "render" || u.phase === "layout" || u.phase === "done") && X(o, v), c(u);
    }
  };
  return p && (l.workerUrl = B(q(i, d), !!i?.workerUrl), l.workerJsZipUrl = B(ee(i, d), !!i?.workerJsZipUrl)), i?.workerTimeout !== void 0 && (l.workerTimeout = i.workerTimeout), i?.renderPageBatchSize !== void 0 ? l.renderPageBatchSize = i.renderPageBatchSize : i?.progressive === !1 && (l.renderPageBatchSize = Number.MAX_SAFE_INTEGER), i?.renderYieldEveryMs !== void 0 && (l.renderYieldEveryMs = i.renderYieldEveryMs), i?.strictWordCompatibility !== void 0 && (l.strictWordCompatibility = i.strictWordCompatibility), i?.paginationTolerance !== void 0 && (l.paginationTolerance = i.paginationTolerance), i?.maxDynamicPaginationPasses !== void 0 && (l.maxDynamicPaginationPasses = i.maxDynamicPaginationPasses), i?.awaitLayout !== void 0 && (l.awaitLayout = i.awaitLayout), i?.preserveComplexFieldResults !== void 0 && (l.preserveComplexFieldResults = i.preserveComplexFieldResults), i?.updatePageReferences !== void 0 && (l.updatePageReferences = i.updatePageReferences), i?.hideWebHiddenContent !== void 0 && (l.hideWebHiddenContent = i.hideWebHiddenContent), l;
}, Z = (o, e) => {
  var r;
  const t = (r = k(e)) === null || r === void 0 ? void 0 : r.HTMLElement;
  return t ? o instanceof t : o instanceof HTMLElement;
}, Le = `
.docx-fit-viewer {
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  background: var(--file-viewer-render-surface-background, #ececec);
  color-scheme: light;
}
.docx-fit-viewer[data-docx-dark-mode='true'] {
  background: var(--file-viewer-render-surface-background, #242424);
  color-scheme: dark;
}
.docx-fit-viewer .docx-wrapper {
  box-sizing: border-box;
  min-width: 0 !important;
  width: 100% !important;
  padding: 24px 14px 40px !important;
  background: var(--file-viewer-render-surface-background, #e7e9ec) !important;
}
.docx-fit-viewer[data-docx-dark-mode='true'] .docx-wrapper {
  background: var(--file-viewer-render-surface-background, #242424) !important;
}
.docx-fit-viewer .docx-page-frame {
  position: relative;
  width: 100%;
  min-width: 0;
  margin: 0 auto 24px;
  overflow: visible;
}
.docx-fit-viewer .docx-flow-frame {
  position: relative;
  width: 100%;
  min-width: 0;
  margin: 0 auto 28px;
  overflow: visible;
}
.docx-fit-viewer .docx-page-frame > section.docx,
.docx-fit-viewer .docx-flow-frame > section.docx {
  position: absolute;
  top: 0;
  left: 50%;
  margin: 0 !important;
  background: #ffffff !important;
  box-shadow: 0 2px 14px rgba(25, 35, 48, 0.18);
  box-sizing: border-box;
  overflow: hidden;
  transform-origin: top center;
}
.docx-fit-viewer .docx-page-background {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 100% 100%;
}
.docx-fit-viewer[data-docx-dark-mode='true'] .docx-page-frame > section.docx,
.docx-fit-viewer[data-docx-dark-mode='true'] .docx-flow-frame > section.docx {
  background: rgb(51, 51, 51) !important;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
  outline: 1px solid rgba(255, 255, 255, 0.15);
  outline-offset: -1px;
}
.docx-fit-viewer .docx-flow-frame > section.docx {
  height: auto !important;
  min-height: var(--docx-page-height, auto) !important;
  overflow: visible !important;
}
.docx-fit-viewer .docx-page-frame > section.docx > article,
.docx-fit-viewer .docx-flow-frame > section.docx > article {
  position: relative;
  z-index: 1;
}
`;
function Fe(o) {
  const e = o.ownerDocument.createElement("style");
  return e.textContent = Le, o.prepend(e), e;
}
function Re(o, e) {
  const r = o.querySelector(".docx-wrapper");
  return r ? Array.from(r.children).flatMap((t) => {
    if (!Z(t, o) || !t.matches("section.docx"))
      return [];
    const a = o.ownerDocument.createElement("div");
    return a.className = e ? "docx-page-frame" : "docx-flow-frame", t.before(a), a.appendChild(t), [a];
  }) : [];
}
function He(o, e) {
  var r, t;
  o.classList.add("docx-fit-viewer");
  const a = Fe(o), n = ((t = (r = e?.options) === null || r === void 0 ? void 0 : r.docx) === null || t === void 0 ? void 0 : t.visualPagination) === !0, i = Re(o, n), d = k(o), p = d?.ResizeObserver;
  let f = 0, h = 1, c = 1, v = 1;
  const l = te(), u = (s) => Math.min(_, Math.max(S, Number(s.toFixed(2)))), P = () => {
    let s = c, m = v, g = !1;
    i.forEach((b) => {
      const x = b.firstElementChild;
      if (!Z(x, o))
        return;
      x.style.transform = "translateX(-50%)";
      const E = x.offsetWidth, M = n ? x.offsetHeight : Math.max(x.scrollHeight, x.offsetHeight);
      if (!E || !M)
        return;
      const K = Math.max(o.clientWidth - 28, 120), z = Math.min(1, Math.max(S, K / E)), D = u(z * h);
      g || (s = D, m = z, g = !0), x.style.transform = `translateX(-50%) scale(${D})`, b.style.width = `${Math.ceil(Math.max(E * D, o.clientWidth - 28, 120))}px`, b.style.maxWidth = "none", b.style.height = `${Math.ceil(M * D)}px`;
    }), g && (c = s, v = m, l.emit());
  }, L = () => {
    if (!d) {
      P();
      return;
    }
    d.cancelAnimationFrame(f), f = d.requestAnimationFrame(() => {
      P();
    });
  }, R = () => ({
    scale: c,
    label: `${Math.round(c * 100)}%`,
    canZoomIn: c < _,
    canZoomOut: c > S,
    canReset: h !== 1,
    minScale: S,
    maxScale: _
  }), A = (s) => (h = Math.min(6, Math.max(0.2, Number(s.toFixed(2)))), d?.cancelAnimationFrame(f), P(), R()), H = (s) => A(s / Math.max(v, 0.01)), G = () => {
    for (const s of i) {
      const m = T(s);
      if (!m)
        continue;
      const g = V(m, y);
      return {
        width: m.offsetWidth || g.width || y.width,
        height: F(s) ? y.height : m.offsetHeight || g.height || y.height
      };
    }
    return null;
  }, j = (s) => {
    var m, g;
    const b = G();
    if (!b)
      return {
        applied: !1,
        mode: s.mode,
        resize: s.resize,
        source: s.source,
        reason: "unmeasurable",
        provider: "zoom"
      };
    const x = s.mode === "auto" ? "width" : s.mode, E = ne({
      mode: x,
      viewportWidth: Math.max(1, s.viewportWidth || o.clientWidth || 0),
      viewportHeight: Math.max(1, s.viewportHeight || o.clientHeight || 0),
      contentWidth: b.width,
      contentHeight: b.height,
      minScale: (m = s.minScale) !== null && m !== void 0 ? m : S,
      maxScale: (g = s.maxScale) !== null && g !== void 0 ? g : _
    });
    if (!E)
      return {
        applied: !1,
        mode: s.mode,
        resize: s.resize,
        source: s.source,
        reason: "unmeasurable",
        provider: "zoom"
      };
    const M = H(E);
    return {
      applied: !0,
      mode: s.mode,
      resize: s.resize,
      scale: M.scale,
      source: s.source,
      provider: "zoom"
    };
  };
  o.dataset.viewerZoomProvider = "docx", oe(o, {
    zoomIn: () => A((c + N) / Math.max(v, 0.01)),
    zoomOut: () => A((c - N) / Math.max(v, 0.01)),
    resetZoom: () => A(1),
    setZoom: H,
    fit: j,
    getState: R,
    subscribe: l.subscribe
  });
  const w = p ? new p(L) : null;
  return w?.observe(o), i.forEach((s) => {
    const m = T(s);
    m && w?.observe(m);
  }), P(), () => {
    d?.cancelAnimationFrame(f), w?.disconnect(), re(o), a.remove(), o.classList.remove("docx-fit-viewer");
  };
}
function T(o) {
  var e;
  const r = o.firstElementChild, t = (e = o.ownerDocument.defaultView) === null || e === void 0 ? void 0 : e.HTMLElement;
  return t && r instanceof t ? r : null;
}
function F(o) {
  return !!o?.classList.contains("docx-flow-frame");
}
function $(o) {
  const e = o ? T(o) : null;
  if (!e)
    return y;
  const r = V(e, y);
  return F(o) ? {
    width: r.width,
    height: Math.max(e.scrollHeight || 0, e.offsetHeight || 0, y.height)
  } : r;
}
function ze(o, e) {
  const r = F(o), t = W(e.width), a = W(e.height);
  le(o, e, { heightMode: r ? "min" : "fixed" }), o.style.margin = "0 auto 18px";
  const n = T(o);
  n && (n.style.position = "relative", n.style.top = "auto", n.style.left = "auto", n.style.width = t, n.style.maxWidth = "none", n.style.minHeight = r ? "0" : a, n.style.height = r ? "auto" : a, n.style.margin = "0 auto", n.style.transform = "none", n.style.transformOrigin = "top left", n.style.overflow = r ? "visible" : "hidden", n.style.boxShadow = "none");
}
function We(o) {
  const e = o.querySelector(".docx-page-frame, .docx-flow-frame"), r = $(e || void 0), t = e?.classList.contains("docx-flow-frame") ? ".viewer-export-content .docx-flow-frame" : ".viewer-export-content .docx-page-frame";
  return ae({
    selector: t,
    width: r.width,
    height: e?.classList.contains("docx-flow-frame") ? y.height : r.height,
    heightMode: e?.classList.contains("docx-flow-frame") ? "min" : "fixed"
  });
}
function Ne(o) {
  const e = Array.from(o.querySelectorAll(".docx-page-frame, .docx-flow-frame")), r = o.cloneNode(!0), t = o.ownerDocument.createElement("div");
  t.className = "docx-print-document";
  const a = Array.from(r.querySelectorAll("style")).filter((n) => {
    var i;
    return !(!((i = n.textContent) === null || i === void 0) && i.includes(".docx-fit-viewer"));
  }).map((n) => n.outerHTML).join("");
  return r.querySelectorAll(".docx-page-frame, .docx-flow-frame").forEach((n, i) => {
    n.dataset.viewerPrintPageIndex = String(i), ze(n, $(e[i])), t.appendChild(n.cloneNode(!0));
  }), t.childElementCount ? `${a}${t.outerHTML}` : r.innerHTML;
}
async function Be(o, e, r) {
  var t, a;
  ye(o, r), e.innerHTML = "";
  let n = !1;
  const i = () => {
    var l;
    n || (n = !0, (l = r?.onProgressiveRender) === null || l === void 0 || l.call(r));
  }, d = Te(e, r, i), [{ defaultOptions: p, renderAsync: f }, h] = await Promise.all([
    we(),
    Ae(o, () => Pe(e))
  ]);
  e.dataset.docxWorker = d.useWorker ? "self" : "false", e.dataset.docxDarkMode = d.darkMode ? "true" : "false";
  const c = await be(f, o, e, {
    ...p,
    ...d
  });
  X(e, d.externalLinkPolicy), e.dataset.docxHeaderFooterFallback = c ? "true" : "false", e.dataset.docxPageBackground = Me(e, h) > 0 ? "true" : "false", i();
  const v = He(e, r);
  return (t = r?.registerExportAdapter) === null || t === void 0 || t.call(r, {
    includeDocumentStyles: !1,
    getPrintMaskPages: () => Array.from(e.querySelectorAll(".docx-page-frame, .docx-flow-frame")),
    beforeSnapshot: () => {
      const l = k(e);
      l && l.dispatchEvent(new l.Event("resize"));
    },
    printStyle: () => We(e),
    toHtml: () => Ne(e)
  }), (a = r?.registerThumbnailAdapter) === null || a === void 0 || a.call(r, {
    getTarget: () => e.querySelector(".docx-page-frame, .docx-flow-frame") || e
  }), {
    $el: e,
    unmount() {
      var l, u;
      (l = r?.registerExportAdapter) === null || l === void 0 || l.call(r, null), (u = r?.registerThumbnailAdapter) === null || u === void 0 || u.call(r, null), v(), delete e.dataset.docxWorker, delete e.dataset.docxDarkMode, delete e.dataset.docxHeaderFooterFallback, delete e.dataset.docxPageBackground, e.innerHTML = "";
    }
  };
}
export {
  X as applyDocxExternalLinkPolicy,
  Me as applyDocxPageBackgroundImage,
  Te as createDocxOptions,
  Be as default,
  xe as isMissingDocxHeaderFooterRootError,
  be as renderDocxWithHeaderFooterFallback,
  Ae as resolveDocxPageBackgroundImage
};
