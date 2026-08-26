import { c as fe, r as ue, u as Q, a as ge, n as me } from "./office-renderer-CZRmDY3X.js";
const q = 0.35, N = 3, ee = 0.1, pe = `
.ofd-viewer{position:relative;display:flex;box-sizing:border-box;min-height:100%;min-width:0;flex-direction:column;background:var(--file-viewer-render-surface-background,#e9edf2);color:#172033;font-family:Aptos,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
.ofd-viewer *{box-sizing:border-box}
.ofd-toolbar{position:sticky;top:0;z-index:4;display:flex;min-height:44px;align-items:center;justify-content:center;border-bottom:1px solid rgba(148,163,184,.32);background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(15,23,42,.06);backdrop-filter:blur(10px)}
.ofd-toolbar-group{display:inline-flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid #d7dee8;border-radius:9px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.06)}
.ofd-page-button{display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:7px;color:#334155;background:transparent;font:700 22px/1 Aptos,'Segoe UI',sans-serif;cursor:pointer}
.ofd-page-button:hover:not(:disabled){border-color:#b9d4f6;color:#1769d8;background:#edf5ff}
.ofd-page-button:focus-visible{outline:2px solid #408fff;outline-offset:1px}
.ofd-page-button:disabled{color:#a7b0bd;cursor:not-allowed}
.ofd-page-meter{display:inline-flex;min-width:92px;align-items:baseline;justify-content:center;gap:5px;color:#64748b;font-size:12px;white-space:nowrap}
.ofd-page-meter strong{color:#172033;font-size:13px}
.ofd-stage{position:relative;flex:1;min-width:0;min-height:0;padding:18px 0 28px;overflow:auto;scrollbar-gutter:stable}
.ofd-state{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;background:rgba(246,248,250,.92);color:#64748b;font-size:14px}
.ofd-state[hidden]{display:none!important}
.ofd-state.error{color:#b42318}
.ofd-page-frame{position:relative;display:block;margin:0 auto 20px;overflow:visible}
.ofd-page{display:block;margin-left:auto!important;margin-right:auto!important;background:#fff!important;color:#111827!important;color-scheme:only light;forced-color-adjust:none;isolation:isolate;box-shadow:0 10px 26px rgba(15,23,42,.12);transition:none}
.ofd-page.ofd-page--zoom-ready{transition:transform .16s ease}
.ofd-page,.ofd-page *{color-scheme:only light;forced-color-adjust:none}
.ofd-page svg,.ofd-page canvas,.ofd-page img{filter:none!important;mix-blend-mode:normal!important}
[data-viewer-theme='dark'] .ofd-viewer{background:var(--file-viewer-render-surface-background,#172033);color:#e5eef8}
[data-viewer-theme='dark'] .ofd-state{background:rgba(15,23,42,.9);color:#cbd5e1}
[data-viewer-theme='dark'] .ofd-toolbar{border-color:rgba(100,116,139,.5);background:rgba(15,23,42,.9)}
[data-viewer-theme='dark'] .ofd-toolbar-group{border-color:#475569;background:#1e293b}
[data-viewer-theme='dark'] .ofd-page-button{color:#e2e8f0}
[data-viewer-theme='dark'] .ofd-page-button:hover:not(:disabled){border-color:#4d79ad;color:#93c5fd;background:#263b55}
[data-viewer-theme='dark'] .ofd-page-button:disabled{color:#64748b}
[data-viewer-theme='dark'] .ofd-page-meter{color:#94a3b8}
[data-viewer-theme='dark'] .ofd-page-meter strong{color:#f1f5f9}
@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .ofd-viewer{background:var(--file-viewer-render-surface-background,#172033);color:#e5eef8}[data-viewer-theme='system'] .ofd-state{background:rgba(15,23,42,.9);color:#cbd5e1}[data-viewer-theme='system'] .ofd-toolbar{border-color:rgba(100,116,139,.5);background:rgba(15,23,42,.9)}[data-viewer-theme='system'] .ofd-toolbar-group{border-color:#475569;background:#1e293b}[data-viewer-theme='system'] .ofd-page-button{color:#e2e8f0}[data-viewer-theme='system'] .ofd-page-button:hover:not(:disabled){border-color:#4d79ad;color:#93c5fd;background:#263b55}[data-viewer-theme='system'] .ofd-page-button:disabled{color:#64748b}[data-viewer-theme='system'] .ofd-page-meter{color:#94a3b8}[data-viewer-theme='system'] .ofd-page-meter strong{color:#f1f5f9}}
@media (prefers-reduced-motion:reduce){.ofd-page.ofd-page--zoom-ready{transition:none}}
@media print{.ofd-viewer{display:block;background:#fff!important}.ofd-toolbar{display:none!important}.ofd-stage{padding:0!important;overflow:visible!important}.ofd-page-frame{break-after:page;page-break-after:always;margin:0 auto!important}.ofd-page-frame:last-child{break-after:auto;page-break-after:auto}.ofd-page{box-shadow:none!important;transition:none!important}}
`, be = /* @__PURE__ */ (() => {
  let a = null;
  return () => (a || (a = import("./ofd-B2Jfl0jw.js")), a);
})(), ve = (a) => {
  const i = a.createElement("style");
  return i.textContent = pe, i;
}, v = (a, i, o, g) => {
  const s = a.createElement(i);
  return o && (s.className = o), g !== void 0 && (s.textContent = g), s;
}, he = (a, i, o) => {
  if (a instanceof Error || typeof a == "string")
    return me(a, o?.options);
  try {
    return JSON.stringify(a);
  } catch {
    return String(a || i);
  }
}, ye = (a) => Math.min(N, Math.max(q, Number(a.toFixed(2)))), oe = (a) => new Promise((i) => {
  if (a?.requestAnimationFrame) {
    a.requestAnimationFrame(() => i());
    return;
  }
  globalThis.setTimeout(i, 0);
}), we = (a, i) => new Promise((o, g) => {
  a.parseOfdDocument({
    ofd: i,
    success: (s) => o(s),
    fail: (s) => g(s)
  });
}), ke = (a, i, o) => {
  const g = a.createDocumentFragment();
  o.forEach((s) => {
    const r = a.createElement("div");
    r.className = "ofd-page-frame", s.classList.add("ofd-page"), s.dataset.viewerThemeBoundary = "light", s.style.backgroundColor = "#fff", s.style.color = "#111827", s.style.colorScheme = "only light", r.appendChild(s), g.appendChild(r);
  }), i.appendChild(g);
}, xe = (a, i, o) => {
  const g = Array.from(i.children).filter((r) => {
    var c;
    return r instanceof (((c = i.ownerDocument.defaultView) === null || c === void 0 ? void 0 : c.HTMLElement) || HTMLElement) && r.classList.contains("ofd-page-frame");
  });
  return g.some((r) => r.querySelector(".fv-print-mask-canvas")) ? g.length !== o.length ? !1 : (o.forEach((r, c) => {
    const t = g[c], M = Array.from(t.children).find((h) => h.classList.contains("ofd-page"));
    !t || !M || (r.classList.add("ofd-page"), r.dataset.viewerThemeBoundary = "light", r.style.backgroundColor = "#fff", r.style.color = "#111827", r.style.colorScheme = "only light", M.replaceWith(r));
  }), !0) : (i.replaceChildren(), ke(a, i, o), !0);
};
async function Ee(a, i, o) {
  var g, s;
  const r = fe(o?.options), c = i.ownerDocument || document, t = c.defaultView || (typeof window < "u" ? window : null), M = ge();
  let h = !1, O = 0, P = null, I = 0, V = 0, b = "loading", D = "", p = 1, f = 1, y = 0, w = 0, R = null;
  const te = ve(c), k = v(c, "div", "ofd-viewer");
  k.dataset.viewerZoomProvider = "ofd";
  const T = v(c, "div", "ofd-state", r("ofd.state.loading"));
  T.setAttribute("aria-live", "polite");
  const L = v(c, "div", "ofd-toolbar");
  L.setAttribute("role", "toolbar"), L.setAttribute("aria-label", r("ofd.toolbar.pageNavigation"));
  const B = v(c, "div", "ofd-toolbar-group"), C = v(c, "button", "ofd-page-button", "‹");
  C.type = "button", C.title = r("ofd.toolbar.previousPage"), C.setAttribute("aria-label", r("ofd.toolbar.previousPage"));
  const z = v(c, "span", "ofd-page-meter");
  z.setAttribute("aria-live", "polite");
  const W = v(c, "strong", void 0, "1"), j = v(c, "span", void 0, "/ -");
  z.append(W, j);
  const S = v(c, "button", "ofd-page-button", "›");
  S.type = "button", S.title = r("ofd.toolbar.nextPage"), S.setAttribute("aria-label", r("ofd.toolbar.nextPage")), B.append(C, z, S), L.append(B);
  const u = v(c, "div", "ofd-stage");
  u.tabIndex = 0, u.setAttribute("aria-label", r("ofd.toolbar.documentPages")), k.append(L, T, u), i.replaceChildren(te, k);
  const $ = () => {
    u.replaceChildren();
  }, H = () => {
    T.hidden = b === "ready", T.classList.toggle("error", b === "error"), T.textContent = b === "error" ? D : r("ofd.state.loading");
  }, Z = () => Array.from(u.querySelectorAll(".ofd-page-frame")), F = () => {
    y = Z().length, f = y ? Math.min(y, Math.max(1, f)) : 0, W.textContent = y ? String(f) : "-", j.textContent = `/ ${y || "-"}`, z.setAttribute("aria-label", y ? r("ofd.toolbar.pageStatus", { current: f, total: y }) : r("ofd.toolbar.noPages")), C.disabled = f <= 1, S.disabled = f <= 0 || f >= y;
  }, E = (e, n = "smooth") => {
    const l = Z();
    if (!l.length)
      return f = 0, F(), !1;
    const d = Math.min(l.length, Math.max(1, Math.round(e)));
    f = d, F();
    const m = l[d - 1];
    return typeof m?.scrollIntoView == "function" && m.scrollIntoView({ block: "start", inline: "nearest", behavior: n }), !0;
  }, K = () => {
    const e = Z();
    if (!e.length) {
      f = 0, F();
      return;
    }
    const l = u.getBoundingClientRect().top + u.clientHeight / 2;
    let d = 0, m = Number.POSITIVE_INFINITY;
    e.forEach((A, se) => {
      const Y = A.getBoundingClientRect(), ce = Y.top + Y.height / 2, G = Math.abs(ce - l);
      G < m && (m = G, d = se);
    });
    const x = d + 1;
    x !== f && (f = x, F());
  }, re = () => {
    var e;
    if (w)
      return;
    const n = (e = t?.requestAnimationFrame) === null || e === void 0 ? void 0 : e.bind(t);
    if (n) {
      w = n(() => {
        w = 0, K();
      });
      return;
    }
    w = t?.setTimeout(() => {
      w = 0, K();
    }, 0) || 0;
  }, ae = async (e) => (R || (R = we(e, a).then((n) => {
    const l = n[0];
    if (!l)
      throw new Error(r("ofd.error.empty"));
    return l;
  })), R), ne = () => {
    const e = k.getBoundingClientRect().width || u.getBoundingClientRect().width || 0;
    return Math.max(Math.floor(e - 48), 240);
  }, J = () => ({
    scale: p,
    label: `${Math.round(p * 100)}%`,
    canZoomIn: p < N,
    canZoomOut: p > q,
    canReset: p !== 1,
    minScale: q,
    maxScale: N
  }), U = (e = !1) => {
    const n = t?.HTMLElement || globalThis.HTMLElement;
    u.querySelectorAll(".ofd-page-frame").forEach((l) => {
      const d = l.firstElementChild;
      if (!n || !(d instanceof n))
        return;
      d.classList.toggle("ofd-page--zoom-ready", e), d.style.position = "absolute", d.style.top = "0", d.style.left = "50%", d.style.transform = `translateX(-50%) scale(${p})`, d.style.transformOrigin = "top center", d.style.marginLeft = "0", d.style.marginRight = "0";
      const m = d.offsetWidth, x = d.offsetHeight;
      !m || !x || (l.style.width = `${Math.ceil(m * p)}px`, l.style.height = `${Math.ceil(x * p)}px`);
    });
  }, ie = () => {
    u.querySelectorAll(".ofd-page").forEach((e) => {
      e.getBoundingClientRect(), e.classList.add("ofd-page--zoom-ready");
    });
  }, _ = (e) => (p = ye(e), U(!0), M.emit(), J());
  ue(k, {
    zoomIn: () => _(p + ee),
    zoomOut: () => _(p - ee),
    resetZoom: () => _(1),
    setZoom: _,
    getState: J,
    subscribe: M.subscribe
  });
  const de = async (e) => {
    const n = await be(), l = await ae(n);
    return h ? [] : Promise.resolve(n.renderOfd(e, l));
  }, X = async (e = {}) => {
    var n, l, d;
    if (h)
      return;
    if (!((n = o?.signal) === null || n === void 0) && n.aborted)
      throw o.signal.reason || new DOMException("OFD rendering aborted.", "AbortError");
    const m = ne();
    if (!e.force && b === "ready" && Math.abs(m - V) < 8)
      return;
    const x = ++O;
    (e.showLoading || b !== "ready") && (b = "loading", $(), H()), D = "";
    try {
      await oe(t);
      const A = await de(m);
      if (h || x !== O)
        return;
      if (!((l = o?.signal) === null || l === void 0) && l.aborted)
        throw o.signal.reason || new DOMException("OFD rendering aborted.", "AbortError");
      if (!xe(c, u, A))
        return;
      V = m, await oe(t), U(), ie(), F(), f > 1 && E(f, "auto"), b = "ready", H(), M.emit(), (d = o?.onProgressiveRender) === null || d === void 0 || d.call(o);
    } catch (A) {
      if (h || x !== O)
        return;
      if (console.error(A), b = "error", D = he(A, r("ofd.error.parseFailed"), o) || r("ofd.error.parseFailed"), H(), e.rejectOnError)
        throw A;
    }
  }, le = () => {
    !t?.ResizeObserver || P || (P = new t.ResizeObserver(() => {
      t.clearTimeout(I), I = t.setTimeout(() => {
        X({ showLoading: !1 });
      }, 180);
    }), P.observe(k));
  };
  C.addEventListener("click", () => {
    E(f - 1);
  }), S.addEventListener("click", () => {
    E(f + 1);
  }), u.addEventListener("scroll", re, { passive: !0 }), u.addEventListener("keydown", (e) => {
    e.key === "PageUp" ? (e.preventDefault(), E(f - 1)) : e.key === "PageDown" ? (e.preventDefault(), E(f + 1)) : e.key === "Home" && (e.ctrlKey || e.metaKey) ? (e.preventDefault(), E(1)) : e.key === "End" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), E(y));
  });
  try {
    await X({ force: !0, showLoading: !0, rejectOnError: !0 }), h || le();
  } catch (e) {
    throw Q(k), e;
  }
  return (g = o?.registerThumbnailAdapter) === null || g === void 0 || g.call(o, {
    beforeCapture: async ({ signal: e }) => {
      for (; b === "loading" && !h; ) {
        if (e?.aborted)
          throw e.reason;
        await new Promise((n) => {
          t ? t.setTimeout(n, 16) : setTimeout(n, 16);
        });
      }
      if (b === "error")
        throw new Error(D || r("ofd.error.parseFailed"));
    },
    getTarget: () => u.querySelector(".ofd-page-frame, .ofd-page") || u
  }), (s = o?.registerExportAdapter) === null || s === void 0 || s.call(o, {
    print: !0,
    exportHtml: !0,
    includeDocumentStyles: !0,
    getPrintMaskPages: () => Array.from(u.querySelectorAll(".ofd-page-frame")),
    toHtml: () => {
      const e = u.cloneNode(!0);
      return e.querySelectorAll(".ofd-page-frame").forEach((n, l) => {
        n.dataset.viewerPrintPageIndex = String(l);
      }), e.outerHTML;
    }
  }), {
    $el: k,
    unmount() {
      var e, n;
      h = !0, O += 1, t?.clearTimeout(I), w && (t?.cancelAnimationFrame ? t.cancelAnimationFrame(w) : t?.clearTimeout(w)), w = 0, P?.disconnect(), P = null, Q(k), $(), (e = o?.registerExportAdapter) === null || e === void 0 || e.call(o, null), (n = o?.registerThumbnailAdapter) === null || n === void 0 || n.call(o, null);
    }
  };
}
export {
  Ee as default
};
