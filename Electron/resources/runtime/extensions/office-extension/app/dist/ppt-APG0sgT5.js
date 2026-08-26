import { c as Ue, d as Fe, e as ye, r as Ve, u as ne, n as We, a as Oe, b as Ze, w as le } from "./office-renderer-CZRmDY3X.js";
const I = 0.25, L = 3, we = 0.15, Se = 1.5, $e = 0.75, xe = 160, Ne = `
.ppt-binary-shell{position:relative;box-sizing:border-box;min-height:100%;padding:24px 20px;background:var(--file-viewer-render-surface-background,#eef3f8);color:#1f2d3b;font-family:Aptos,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
.ppt-binary-loading{position:sticky;top:12px;z-index:3;box-sizing:border-box;display:flex;width:max-content;max-width:calc(100% - 24px);align-items:center;gap:10px;margin:0 auto 18px;padding:10px 14px;border:1px solid rgba(42,94,144,.14);border-radius:999px;background:rgba(255,255,255,.92);color:#41556b;box-shadow:0 12px 32px rgba(24,44,64,.12);backdrop-filter:blur(18px)}
.ppt-binary-loading[hidden],.ppt-binary-error[hidden]{display:none!important}
.ppt-binary-loading-dot{width:9px;height:9px;flex:0 0 auto;border-radius:999px;background:#1f9d67;box-shadow:0 0 0 6px rgba(31,157,103,.13)}
.ppt-binary-error{box-sizing:border-box;width:min(680px,calc(100% - 32px));margin:48px auto;padding:24px;border:1px solid rgba(28,43,58,.12);border-radius:16px;background:#fff;color:#1f2d3b;box-shadow:0 16px 42px rgba(25,42,54,.08)}
.ppt-binary-error strong{display:block;margin-bottom:10px;font-size:18px}.ppt-binary-error p{margin:0;color:#607282;line-height:1.7}.ppt-binary-error small{display:block;margin-top:12px;color:#7a8b99;line-height:1.6}
.ppt-binary-slides{display:grid;box-sizing:border-box;width:max-content;min-width:100%;justify-items:center;gap:22px;margin:0 auto}
.ppt-binary-page{position:relative;box-sizing:border-box;overflow:hidden;background:#fff;box-shadow:0 10px 34px rgba(15,23,42,.14);transform-origin:top center;transition:width .18s ease}
.ppt-binary-page canvas{display:block;max-width:none;height:auto;background:#fff}
.ppt-binary-page-error{position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:#fff;color:#8b3a3a;text-align:center}
[data-viewer-theme='dark'] .ppt-binary-shell{background:var(--file-viewer-render-surface-background,#101820);color:#e5eef8}
[data-viewer-theme='dark'] .ppt-binary-loading{border-color:rgba(148,163,184,.18);background:rgba(15,23,42,.9);color:#cbd5e1;box-shadow:0 18px 44px rgba(0,0,0,.26)}
[data-viewer-theme='dark'] .ppt-binary-error{border-color:rgba(148,163,184,.18);background:#151f2b;color:#f8fafc;box-shadow:0 22px 56px rgba(0,0,0,.32)}
[data-viewer-theme='dark'] .ppt-binary-error p,[data-viewer-theme='dark'] .ppt-binary-error small{color:#94a3b8}
[data-viewer-theme='dark'] .ppt-binary-page{color-scheme:only light;forced-color-adjust:none;box-shadow:0 16px 44px rgba(0,0,0,.34)}
@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .ppt-binary-shell{background:var(--file-viewer-render-surface-background,#101820);color:#e5eef8}[data-viewer-theme='system'] .ppt-binary-loading{border-color:rgba(148,163,184,.18);background:rgba(15,23,42,.9);color:#cbd5e1}[data-viewer-theme='system'] .ppt-binary-error{border-color:rgba(148,163,184,.18);background:#151f2b;color:#f8fafc}[data-viewer-theme='system'] .ppt-binary-error p,[data-viewer-theme='system'] .ppt-binary-error small{color:#94a3b8}}
@media (max-width:640px){.ppt-binary-shell{padding:14px 10px}.ppt-binary-slides{gap:14px}.ppt-binary-loading{top:8px;margin-bottom:12px;padding:8px 12px;font-size:13px}}
@media (prefers-reduced-motion:reduce){.ppt-binary-page{transition:none}}
`, De = `
  .ppt-binary-shell { background: #fff !important; padding: 0 !important; }
  .ppt-binary-loading, .ppt-binary-error { display: none !important; }
  .ppt-binary-slides { display: block !important; width: 100% !important; min-width: 0 !important; }
  .ppt-binary-page { width: 100% !important; margin: 0 auto !important; box-shadow: none !important; break-after: page; page-break-after: always; }
  .ppt-binary-page:last-child { break-after: auto; page-break-after: auto; }
  .ppt-binary-page canvas, .ppt-binary-page img { display: block; width: 100% !important; height: auto !important; }
`, ke = (s) => Math.min(L, Math.max(I, s)), f = (s, d, x, r) => {
  const k = s.createElement(d);
  return x && (k.className = x), r !== void 0 && (k.textContent = r), k;
}, Be = async (s) => {
  const d = s ? await import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    s
  ) : await import("./index-CwvghT0Z.js");
  if (!d || typeof d.createPptViewer != "function")
    throw new Error("The configured PPT module does not export createPptViewer().");
  return d;
}, Me = async (s, d) => (await Be(s)).createPptViewer(d), Ie = (s) => new Promise((d) => {
  if (typeof s.toBlob == "function")
    try {
      s.toBlob(d, "image/png");
      return;
    } catch {
    }
  try {
    const x = s.toDataURL("image/png");
    fetch(x).then((r) => r.blob()).then(d, () => d(null));
  } catch {
    d(null);
  }
}), Le = (s, d, x) => ({
  print: !0,
  exportHtml: !0,
  includeDocumentStyles: !1,
  beforeSnapshot: () => le(d || void 0),
  getPrintMaskPages: () => s,
  printStyle: De,
  toHtml: async () => `<div class="ppt-binary-shell"><div class="ppt-binary-slides">${(await x()).map((V, A) => `<section class="ppt-binary-page" data-viewer-print-page-index="${A}"><img src="${V}" alt="Slide ${A + 1}"></section>`).join("")}</div></div>`
});
async function je(s, d, x, r) {
  var k, V, A, H, j, G, X, Y, Q, J, K, q, ee;
  const T = Ue(r?.options), m = d.ownerDocument || document, n = m.defaultView || (typeof window < "u" ? window : null), re = Oe(), de = f(m, "style");
  de.textContent = Ne;
  const p = f(m, "div", "ppt-binary-shell");
  p.dataset.viewerZoomProvider = "ppt";
  const R = f(m, "div", "ppt-binary-loading");
  R.setAttribute("role", "status"), R.setAttribute("aria-live", "polite");
  const _e = f(m, "span", void 0, T("presentation.ppt.state.loading"));
  R.append(f(m, "span", "ppt-binary-loading-dot"), _e);
  const Z = f(m, "div", "ppt-binary-error");
  Z.hidden = !0;
  const Pe = f(m, "strong", void 0, T("presentation.ppt.error.title")), se = f(m, "p"), Ee = f(m, "small", void 0, T("presentation.ppt.error.assetHint"));
  Z.append(Pe, se, Ee);
  const ie = f(m, "div", "ppt-binary-slides");
  p.append(R, Z, ie), d.replaceChildren(de, p);
  let te = null, y = null, C = null, $ = null, W = [];
  const M = [];
  let _ = null, pe = null, ue, g = 1, S = !1, ce = !1, P = 0, z = null, U = null, me = 0;
  const F = () => {
    var e, i;
    if (S || !((e = r?.signal) === null || e === void 0) && e.aborted)
      throw ((i = r?.signal) === null || i === void 0 ? void 0 : i.reason) || new DOMException("PPT rendering aborted.", "AbortError");
  }, N = () => {
    z !== null && (n ? n.clearTimeout(z) : clearTimeout(z), z = null);
  }, D = () => {
    U !== null && (n ? n.clearTimeout(U) : clearTimeout(U), U = null);
  }, ve = async () => {
    const e = C;
    if (!e || S)
      return;
    const i = ++me;
    try {
      const t = await e.cacheStats();
      if (i !== me || e !== C || S)
        return;
      const a = (l, h) => {
        Number.isFinite(h) && (p.dataset[l] = String(h));
      };
      p.dataset.pptCacheEnabled = String(t.enabled), p.dataset.pptCacheAvailable = String(t.available), a("pptCacheEntries", t.entries), a("pptCacheBytes", t.bytes), a("pptAttachedCanvases", t.attachedCanvases), a("pptActiveCanvases", t.activeCanvases), a("pptWasmMemoryBytes", t.wasmMemoryBytes);
    } catch {
    }
  }, Te = () => {
    D();
    const e = () => {
      U = null, ve();
    };
    U = n ? n.setTimeout(e, 200) : setTimeout(e, 200);
  }, ae = () => {
    if ($)
      return $;
    const e = C, i = y, t = te;
    return C = null, y = null, te = null, _?.disconnect(), _ = null, D(), !e && !i && !t ? Promise.resolve() : ($ = (async () => {
      try {
        e ? await e.close() : i && !i.closed && await i.close();
      } finally {
        await t?.close();
      }
    })(), $);
  }, Ae = () => {
    ae().catch((e) => {
      console.warn("PPT runtime cleanup warning:", e);
    });
  }, be = () => {
    P += 1, N(), D();
  };
  (k = r?.signal) === null || k === void 0 || k.addEventListener("abort", be, { once: !0 });
  const ge = () => ({
    scale: g,
    label: `${Math.round(g * 100)}%`,
    canZoomIn: g < L,
    canZoomOut: g > I,
    canReset: Math.abs(g - 1) > 1e-3,
    minScale: I,
    maxScale: L
  }), oe = () => {
    if (!y)
      return;
    const e = Math.max(1, Math.round(y.width * g)), i = Math.max(1, Math.round(y.height * g));
    W.forEach((t, a) => {
      t.style.width = `${e}px`, t.style.height = `${i}px`, t.style.maxWidth = "none";
      const l = M[a];
      l && (l.style.width = `${e}px`, l.style.height = `${i}px`, l.style.maxWidth = "none");
    });
  }, Re = async (e) => {
    var i, t, a, l;
    const h = y, c = C;
    if (!h || !c)
      return;
    const w = Math.min(2, Math.max(1, n?.devicePixelRatio || 1)), E = Math.min(Se, Math.max($e, g * w)), B = M.map((u, o) => ({ index: o, state: u.dataset.renderState })).filter((u) => u.state === "rendering" || u.state === "rendered").map((u) => u.index);
    for (const u of B) {
      if (F(), e !== P)
        return;
      const o = M[u], v = W[u];
      try {
        if (o.dataset.renderState === "rendering" && (await c.renderSlide(u), S || !((i = r?.signal) === null || i === void 0) && i.aborted || e !== P))
          return;
        if (o.dataset.renderState !== "rendered")
          continue;
        const b = await h.renderSlide(u, o, {
          scale: E,
          pixelRatio: 1
        });
        if (S || !((t = r?.signal) === null || t === void 0) && t.aborted || e !== P)
          return;
        if (b.cancelled)
          continue;
        if (!v.isConnected)
          return;
        (a = v.querySelector(".ppt-binary-page-error")) === null || a === void 0 || a.remove();
      } catch (b) {
        if (S || !((l = r?.signal) === null || l === void 0) && l.aborted || e !== P || !v.isConnected)
          return;
        const ze = f(m, "div", "ppt-binary-page-error", `${T("presentation.ppt.error.parseFailed")} (${u + 1})`);
        v.append(ze), console.warn(`PPT slide ${u + 1} render warning:`, b);
      }
      oe(), u + 1 < M.length && await le(n || void 0);
    }
  }, he = () => {
    N();
    const e = P, i = () => {
      z = null, Re(e).catch((t) => {
        var a;
        !S && !(!((a = r?.signal) === null || a === void 0) && a.aborted) && console.warn("PPT quality rerender warning:", t);
      });
    };
    z = n ? n.setTimeout(i, xe) : setTimeout(i, xe);
  }, O = (e) => (g = ke(e), P += 1, oe(), re.emit(), he(), ge()), Ce = (e) => {
    var i, t;
    if (!y)
      return {
        applied: !1,
        mode: e.mode,
        resize: e.resize,
        source: e.source,
        reason: "ppt-not-ready",
        provider: "zoom"
      };
    const a = Ze({
      mode: e.mode,
      viewportWidth: Math.max(1, (e.viewportWidth || p.clientWidth || 0) - e.padding * 2),
      viewportHeight: Math.max(1, (e.viewportHeight || p.clientHeight || 0) - e.padding * 2),
      contentWidth: y.width,
      contentHeight: y.height,
      minScale: (i = e.minScale) !== null && i !== void 0 ? i : I,
      maxScale: (t = e.maxScale) !== null && t !== void 0 ? t : L
    });
    if (!a)
      return {
        applied: !1,
        mode: e.mode,
        resize: e.resize,
        source: e.source,
        reason: "unmeasurable",
        provider: "zoom"
      };
    const l = O(a);
    return {
      applied: !0,
      mode: e.mode,
      resize: e.resize,
      scale: l.scale,
      source: e.source,
      provider: "zoom"
    };
  }, fe = async (e, i) => {
    const t = pe;
    if (!t)
      throw new Error(T("presentation.ppt.error.parseFailed"));
    const a = await Me(ue, {
      ...t,
      worker: !1,
      cache: !1
    });
    let l = null;
    try {
      l = await a.open(s.slice(0));
      const h = [];
      for (let c = 0; c < e.length; c += 1) {
        const w = e[c];
        F();
        const E = f(m, "canvas");
        try {
          await l.renderSlide(w, E, {
            scale: Se,
            pixelRatio: 1
          }), F(), h.push(await i(E));
        } finally {
          E.width = 1, E.height = 1;
        }
        c + 1 < e.length && (c + 1) % 4 === 0 && await le(n || void 0);
      }
      return h;
    } finally {
      l && !l.closed && await l.close().catch(() => {
      }), await a.close().catch(() => {
      });
    }
  };
  try {
    F();
    const e = (V = r?.options) === null || V === void 0 ? void 0 : V.presentation, i = Fe(m), t = e?.pptModuleUrl ? ye(e.pptModuleUrl, String(e.pptModuleUrl), { documentBaseUrl: i }) : void 0, a = (o) => o ? ye(o, String(o), { documentBaseUrl: i }) : void 0, l = {
      worker: (A = e?.pptWorker) !== null && A !== void 0 ? A : "auto",
      cache: e?.pptCache,
      wasmUrl: a(e?.pptWasmUrl),
      fontUrl: a(e?.pptFontUrl),
      workerUrl: a(e?.pptWorkerUrl)
    };
    ue = t, pe = l;
    const h = await Me(t, l);
    te = h, p.dataset.pptRuntimeMode = h.mode, F(), ie.className = "ppt-binary-mount";
    const c = await h.mount(ie, s, {
      replace: !0,
      className: "ppt-binary-slides",
      scale: 1,
      pixelRatio: 1,
      virtualize: e?.pptVirtualize !== !1,
      rootMargin: e?.pptVirtualRootMargin,
      releaseDelayMs: e?.pptReleaseDelayMs
    });
    C = c, y = c.document, p.dataset.pptVirtualized = String(c.virtualized), F(), Object.assign(c.root.style, {
      width: "max-content",
      minWidth: "100%",
      maxWidth: "none",
      padding: "0px",
      background: "transparent",
      justifyContent: "",
      gap: ""
    }), W = Array.from(c.root.children).map((o, v) => {
      const b = o;
      return b.classList.add("ppt-binary-page"), b.dataset.slideIndex = String(v), b.dataset.viewerPrintPageIndex = String(v), b.style.maxWidth = "none", b;
    }), M.push(...c.canvases), M.forEach((o, v) => {
      o.setAttribute("role", "img"), o.setAttribute("aria-label", `Slide ${v + 1}`), o.style.maxWidth = "none";
    });
    const w = (H = n?.getComputedStyle) === null || H === void 0 ? void 0 : H.call(n, p), E = (Number.parseFloat(w?.paddingLeft || "") || 0) + (Number.parseFloat(w?.paddingRight || "") || 0), B = Math.max(0, (p.clientWidth || d.clientWidth || 0) - E);
    g = B > 0 ? ke(Math.min(1, B / y.width)) : 1, oe(), Ve(p, {
      zoomIn: () => O(g + we),
      zoomOut: () => O(g - we),
      resetZoom: () => O(1),
      setZoom: O,
      fit: Ce,
      getState: ge,
      subscribe: re.subscribe
    });
    const u = n?.MutationObserver;
    u && (_ = new u((o) => {
      o.some((v) => {
        var b;
        return ((b = v.target.dataset) === null || b === void 0 ? void 0 : b.renderState) === "rendered";
      }) && he(), Te();
    }), M.forEach((o) => {
      _?.observe(o, {
        attributes: !0,
        attributeFilter: ["data-render-state"]
      });
    })), ce = !0, R.hidden = !0, ve(), (j = r?.onProgressiveRender) === null || j === void 0 || j.call(r), (G = r?.registerExportAdapter) === null || G === void 0 || G.call(r, Le(W, n, () => fe(M.map((o, v) => v), (o) => o.toDataURL("image/png")))), (X = r?.registerThumbnailAdapter) === null || X === void 0 || X.call(r, {
      captureSource: "rendered",
      beforeCapture: () => {
        if (!ce)
          throw new Error(T("presentation.ppt.error.parseFailed"));
      },
      capture: async () => (await fe([0], Ie))[0] || null,
      getTarget: () => W[0] || null
    }), re.emit();
  } catch (e) {
    throw S || !((Y = r?.signal) === null || Y === void 0) && Y.aborted ? (N(), (Q = r?.registerExportAdapter) === null || Q === void 0 || Q.call(r, null), (J = r?.registerThumbnailAdapter) === null || J === void 0 || J.call(r, null), ne(p), await ae().catch(() => {
    }), e) : (R.hidden = !0, Z.hidden = !1, se.textContent = We(e, r?.options) || T("presentation.ppt.error.parseFailed"), (K = r?.registerExportAdapter) === null || K === void 0 || K.call(r, null), (q = r?.registerThumbnailAdapter) === null || q === void 0 || q.call(r, null), ne(p), await ae().catch(() => {
    }), e);
  } finally {
    (ee = r?.signal) === null || ee === void 0 || ee.removeEventListener("abort", be);
  }
  return {
    $el: p,
    unmount() {
      var e, i;
      S = !0, P += 1, N(), D(), (e = r?.registerExportAdapter) === null || e === void 0 || e.call(r, null), (i = r?.registerThumbnailAdapter) === null || i === void 0 || i.call(r, null), ne(p), Ae(), d.replaceChildren();
    }
  };
}
export {
  je as default
};
