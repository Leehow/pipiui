import { c as D, r as T, u as V, a as _, b as $ } from "./office-renderer-CZRmDY3X.js";
const B = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  jxl: "image/jxl",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
}, N = `
.image-viewer{position:relative;width:100%;height:100%;overflow:auto;background:var(--file-viewer-render-surface-background,#eef1f4);box-sizing:border-box}
.image-stage{min-width:100%;min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.image-stage img{display:block;width:auto;max-width:none;margin:0 auto;border:0;box-shadow:0 18px 48px rgba(15,23,42,.16);background:#fff;cursor:zoom-in}
.image-stage img:focus-visible{outline:3px solid #2563eb;outline-offset:4px}
.image-lightbox{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:40px;background:rgba(15,23,42,.9);box-sizing:border-box;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .18s ease,visibility 0s linear .18s}
.image-lightbox[data-open='true']{opacity:1;visibility:visible;pointer-events:auto;transition-delay:0s}
.image-lightbox img{display:block;max-width:100%;max-height:100%;object-fit:contain;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.4);cursor:default;transform:scale(.985);transition:transform .18s ease}
.image-lightbox[data-open='true'] img{transform:scale(1)}
.image-lightbox button{position:absolute;top:16px;right:16px;display:grid;width:40px;height:40px;place-items:center;padding:0;border:1px solid rgba(255,255,255,.7);border-radius:999px;background:rgba(255,255,255,.96);color:#172033;font:400 27px/1 Arial,sans-serif;cursor:pointer;box-shadow:0 12px 28px rgba(0,0,0,.24);transition:background-color .14s ease,transform .14s ease}
.image-lightbox button:hover{background:#fff;transform:scale(1.04)}
.image-lightbox button:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}
[data-viewer-theme='dark'] .image-viewer{background:var(--file-viewer-render-surface-background,#101820)}
@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .image-viewer{background:var(--file-viewer-render-surface-background,#101820)}}
@media (max-width:767px){.image-stage{padding:12px}.image-lightbox{padding:16px}.image-lightbox button{top:12px;right:12px}}
@media (prefers-reduced-motion:reduce){.image-lightbox,.image-lightbox img,.image-lightbox button{transition:none}}
`, O = (a) => {
  const o = a.createElement("style");
  return o.textContent = N, o;
}, Z = (a) => {
  const o = (a || "").trim().toLowerCase();
  return B[o] || "image/*";
}, P = async (a) => await new Promise((o, s) => {
  const e = new FileReader();
  e.onload = (m) => {
    var r;
    const l = (r = m.target) === null || r === void 0 ? void 0 : r.result;
    if (typeof l == "string") {
      o(l);
      return;
    }
    s(new Error("Unable to read image data URL."));
  }, e.onerror = () => s(e.error || new Error("Unable to read image data URL.")), e.readAsDataURL(a);
}), K = async (a, o) => {
  const s = (o || "").trim().toLowerCase();
  if (s === "heic" || s === "heif")
    throw new Error("HEIC/HEIF image conversion has moved out of @file-viewer/core. Install and pass @file-viewer/renderer-image, or use @file-viewer/preset-all.");
  return P(new Blob([a], { type: Z(s) }));
}, R = (a) => Number(a.toFixed(3)), G = (a, o, s) => {
  const e = a.createElement("div");
  e.className = "image-lightbox", e.dataset.open = "false", e.setAttribute("role", "dialog"), e.setAttribute("aria-modal", "true"), e.setAttribute("aria-hidden", "true");
  const m = a.createElement("img");
  m.alt = s("image.lightbox.alt"), m.src = o;
  const r = a.createElement("button");
  r.type = "button", r.setAttribute("aria-label", s("image.lightbox.close")), r.textContent = "×";
  let l = null;
  const c = () => {
    e.dataset.open === "true" && (e.dataset.open = "false", e.setAttribute("aria-hidden", "true"), l?.isConnected && l.focus({ preventScroll: !0 }), l = null);
  }, p = (n) => {
    n.key === "Escape" && e.dataset.open === "true" && (n.preventDefault(), c());
  };
  return r.addEventListener("click", c), e.addEventListener("click", (n) => {
    n.target === e && c();
  }), a.addEventListener("keydown", p), e.append(m, r), {
    element: e,
    open(n) {
      l = n || (a.activeElement instanceof HTMLElement ? a.activeElement : null), e.dataset.open = "true", e.setAttribute("aria-hidden", "false"), r.focus({ preventScroll: !0 });
    },
    destroy() {
      r.removeEventListener("click", c), a.removeEventListener("keydown", p), e.remove();
    }
  };
};
async function X(a, o, s, e) {
  var m, r;
  const l = D(e?.options), c = o.ownerDocument || document, p = await K(a, s);
  (m = e?.registerThumbnailAdapter) === null || m === void 0 || m.call(e, {
    capture: () => new Blob([a], { type: Z(s) })
  });
  let n = 1, v = 1, g = 1, h = 0;
  const f = _(), d = c.createElement("div");
  d.className = "image-viewer", d.dataset.viewerZoomProvider = "image";
  const S = c.createElement("div");
  S.className = "image-stage";
  const i = c.createElement("img");
  i.alt = l("image.alt"), i.src = p, i.tabIndex = 0, i.setAttribute("role", "button"), i.setAttribute("aria-haspopup", "dialog"), S.append(i), d.append(S);
  const x = G(c, p, l), L = () => x.open(i), H = (t) => {
    (t.key === "Enter" || t.key === " ") && (t.preventDefault(), x.open(i));
  };
  i.addEventListener("click", L), i.addEventListener("keydown", H);
  const w = () => Math.min(0.1, v || 0.1), I = (t) => {
    const u = w();
    return Math.min(5, Math.max(u, R(t)));
  }, C = () => {
    const t = i.naturalWidth || 0, u = i.naturalHeight || 0;
    if (!t || !u)
      return 1;
    const b = Math.max((d.clientWidth || 0) - 48, 1), k = Math.max((d.clientHeight || h || 0) - 48, 1);
    return Math.min(1, b / t, k / u);
  }, z = () => {
    if (v = C(), g = I(v * n), i.naturalWidth && i.naturalHeight) {
      i.style.width = `${Math.max(1, Math.round(i.naturalWidth * g))}px`, i.style.height = `${Math.max(1, Math.round(i.naturalHeight * g))}px`;
      return;
    }
    i.style.width = "auto", i.style.height = h > 0 ? `${Math.max(1, Math.round(h * n))}px` : `${n * 100}%`;
  }, y = () => {
    h = d.clientHeight || 0, z(), f.emit();
  }, A = new ResizeObserver(y);
  A.observe(d), i.addEventListener("load", y);
  const M = () => ({
    scale: g,
    label: `${Math.round(g * 100)}%`,
    canZoomIn: g < 5,
    canZoomOut: g > w(),
    canReset: Math.abs(n - 1) > 1e-3,
    minScale: w(),
    maxScale: 5
  }), E = (t) => (n = I(t) / Math.max(v, 1e-3), z(), f.emit(), M());
  return T(d, {
    zoomIn: () => E(g + 0.15),
    zoomOut: () => E(g - 0.15),
    resetZoom: () => (n = 1, z(), f.emit(), M()),
    setZoom: E,
    fit: (t) => {
      var u, b;
      const k = i.naturalWidth || 0, F = i.naturalHeight || 0;
      if (!k || !F)
        return {
          applied: !1,
          mode: t.mode,
          resize: t.resize,
          source: t.source,
          reason: "image-not-ready",
          provider: "zoom"
        };
      const j = t.mode === "auto" ? "scale-down" : t.mode, W = $({
        mode: j,
        viewportWidth: Math.max(1, t.viewportWidth || d.clientWidth || 0),
        viewportHeight: Math.max(1, t.viewportHeight || d.clientHeight || h || 0),
        contentWidth: k,
        contentHeight: F,
        minScale: (u = t.minScale) !== null && u !== void 0 ? u : w(),
        maxScale: (b = t.maxScale) !== null && b !== void 0 ? b : 5
      });
      if (!W)
        return {
          applied: !1,
          mode: t.mode,
          resize: t.resize,
          source: t.source,
          reason: "unmeasurable",
          provider: "zoom"
        };
      const U = E(W);
      return {
        applied: !0,
        mode: t.mode,
        resize: t.resize,
        scale: U.scale,
        source: t.source,
        provider: "zoom"
      };
    },
    getState: M,
    subscribe: f.subscribe
  }), o.replaceChildren(O(c), d), (((r = e?.surface) === null || r === void 0 ? void 0 : r.shadowRoot) || o).append(x.element), y(), {
    $el: o,
    unmount() {
      var t;
      (t = e?.registerThumbnailAdapter) === null || t === void 0 || t.call(e, null), V(d), A.disconnect(), i.removeEventListener("load", y), i.removeEventListener("click", L), i.removeEventListener("keydown", H), x.destroy(), o.replaceChildren();
    }
  };
}
export {
  X as default
};
