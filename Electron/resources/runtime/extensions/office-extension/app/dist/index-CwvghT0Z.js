const A = Object.freeze({ kind: "flyfish-ppt-public-native-wasm-v2", product: "Flyfish PPT Viewer", format: "PowerPoint 97-2003 (.ppt)", packageName: "@file-viewer/ppt", packageVersion: "0.3.3", engine: "flyfish-classic-ppt-native-engine", engineBuild: "d2b522ef23b5c08a", id: "FV-PPT-PUBLIC-WATERMARKED-V2", feature: "ppt", edition: "public-watermarked", holder: "Individuals and Organizations", distribution: "proprietary-public-binary", commercialUse: !0, publicAnyOrigin: !0, watermarkRequired: !0, watermarkText: "Flyfish Viewer", usePolicy: "public-watermarked-general-use", licensePolicy: "flyfish-public-watermarked-binary-license-v2", sourceCodeRights: !1, sourceDeliveryRights: !1, apacheLicenseApplies: !1, redistributionAllowed: !0, redistributionPolicy: "unmodified-integrated-bundling-only", standaloneRedistributionAllowed: !1, watermarkRemovalRequiresCommercialAuthorization: !0, runtimeLicenseRequired: !1, renderer: "native-wasm-worker-offscreen-canvas", integrity: "native-wasm-font-sha256-v2", wasmFile: "ppt-native.wasm", wasmBytes: 1557729, workerFile: "worker.mjs", fontPack: { kind: "flyfish-cjk-font-pack-v1", file: "ppt-font-cjk.otf", bytes: 16437364, sha256: "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b" }, workerDefault: !0, virtualScrollDefault: !0, frameCache: "indexeddb-final-watermarked-png-lru", watermarkEnforcement: "native-final-frame", wasmSha256: "5e1313c50fee36c9573527bc3bf88920ea54b25016ee72d369bb7b27df1540ba" }), x = import.meta.url, L = new URL("file-viewer/vendor/ppt/ppt-native.wasm", x), j = new URL("file-viewer/vendor/ppt/ppt-font-cjk.otf", x), I = new URL("file-viewer/vendor/ppt/worker.mjs", x), $ = Object.freeze([
  "memory",
  "ppt_input_alloc",
  "ppt_input_free",
  "ppt_font_pack_install",
  "ppt_font_pack_is_installed",
  "ppt_document_open",
  "ppt_document_close",
  "ppt_slide_count",
  "ppt_slide_width",
  "ppt_slide_height",
  "ppt_render_slide_rgba",
  "ppt_frame_ptr",
  "ppt_frame_len",
  "ppt_frame_width",
  "ppt_frame_height",
  "ppt_frame_stride",
  "ppt_frame_free",
  "ppt_last_error_code"
]), V = Object.freeze({
  id: "FV-PPT-PUBLIC-WATERMARKED-V2",
  edition: "public-watermarked",
  holder: "Individuals and Organizations",
  policy: "flyfish-public-watermarked-binary-license-v2",
  commercialUse: !0,
  sourceCodeRights: !1,
  sourceDeliveryRights: !1,
  apacheLicenseApplies: !1,
  redistributionAllowed: !0,
  redistributionPolicy: "unmodified-integrated-bundling-only",
  standaloneRedistributionAllowed: !1,
  watermarkRemovalRequiresCommercialAuthorization: !0
}), K = Object.freeze({ required: !0, text: "Flyfish Viewer" }), N = /* @__PURE__ */ new Map();
function ee() {
  return { ...A, fontPack: { ...A.fontPack } };
}
async function te(e = {}) {
  if (re(e) === "worker")
    try {
      return await ne(e);
    } catch (n) {
      if (e.worker === !0) throw n;
    }
  const r = await ce(e.wasmUrl, e.fontUrl);
  return de(r);
}
const Te = te;
function re(e) {
  const t = e.worker ?? "auto";
  if (t !== !0 && t !== !1 && t !== "auto")
    throw new TypeError('worker must be true, false, or "auto".');
  const r = typeof Worker == "function" && typeof OffscreenCanvas == "function" && (typeof HTMLCanvasElement > "u" || typeof HTMLCanvasElement.prototype?.transferControlToOffscreen == "function"), n = C(e.wasmUrl) && C(e.fontUrl) && C(e.workerUrl);
  if (t === !0 && !r)
    throw f("worker-unavailable", "Worker and OffscreenCanvas support are required for worker rendering.");
  if (t === !0 && !n)
    throw f("worker-source-invalid", "Worker rendering requires URL-based WASM, font, and worker assets.");
  return t !== !1 && r && n ? "worker" : "direct";
}
function C(e) {
  return e === void 0 || e instanceof URL || typeof e == "string";
}
async function ne(e) {
  const t = new oe(E(e.workerUrl, I)), r = e.transferInputOwnership === !0;
  try {
    await t.request("init", {
      manifest: ee(),
      wasmUrl: E(e.wasmUrl, L).href,
      fontUrl: E(e.fontUrl, j).href,
      cacheOptions: ve(e.cache)
    });
  } catch (a) {
    throw t.terminate(), a;
  }
  let n = null;
  const o = {
    mode: "worker",
    license: V,
    watermark: K,
    async open(a) {
      if (n && !n.closed)
        throw f("document-active", "Close the current worker document before opening another presentation.");
      const s = X(a);
      if (s.byteLength < 8 || !Y(s))
        throw f("ppt-signature-invalid", "Input is not a PowerPoint 97-2003 (.ppt) compound document.");
      const c = ge(a, s, r), g = await t.request("open", { input: c }, [c]);
      return n = ie(t, g), n;
    },
    async mount(a, s, c = {}) {
      return J(o, a, s, c);
    },
    async cacheStats() {
      return t.request("cacheStats");
    },
    async close() {
      try {
        n && !n.closed && await n.close();
      } finally {
        t.terminate();
      }
    }
  };
  return Object.freeze(o);
}
function ie(e, t) {
  const r = ke(t.slideCount, "slide count"), n = H(t.width, "slide width"), o = H(t.height, "slide height"), a = String(t.documentId || ""), s = /* @__PURE__ */ new Map();
  let c = !1;
  return Object.freeze({
    mode: "worker",
    documentId: a,
    get slideCount() {
      return r;
    },
    get width() {
      return n;
    },
    get height() {
      return o;
    },
    get closed() {
      return c;
    },
    async renderSlide(l, v, h = {}) {
      q(c), S(l, r);
      const u = Z(h);
      let w = s.get(l);
      if (w) {
        if (w.canvas !== v)
          throw f("canvas-already-attached", `Slide ${l + 1} is already attached to another Canvas.`);
      } else {
        const p = ae(v, n, o, u.scale);
        await e.request("attach", {
          slideIndex: l,
          canvas: p,
          scale: u.scale,
          pixelRatio: u.pixelRatio
        }, [p]), w = { canvas: v, scale: u.scale, pixelRatio: u.pixelRatio }, s.set(l, w);
      }
      const m = await e.request("activate", {
        slideIndex: l,
        scale: u.scale,
        pixelRatio: u.pixelRatio
      });
      return m?.cancelled ? Object.freeze({
        cancelled: !0,
        slideIndex: l,
        width: Math.round(n * u.nativeScale),
        height: Math.round(o * u.nativeScale),
        logicalWidth: n,
        logicalHeight: o,
        scale: u.scale,
        pixelRatio: u.pixelRatio
      }) : Object.freeze({ ...m, logicalWidth: n, logicalHeight: o });
    },
    async releaseSlide(l) {
      return q(c), S(l, r), s.has(l) ? (await e.request("deactivate", { slideIndex: l }), !0) : !1;
    },
    async cacheStats() {
      return q(c), e.request("cacheStats");
    },
    async close() {
      if (!c) {
        c = !0;
        try {
          await e.request("close");
        } finally {
          s.clear();
        }
      }
    }
  });
}
function ae(e, t, r, n) {
  if (typeof HTMLCanvasElement < "u" && e instanceof HTMLCanvasElement) {
    if (typeof e.transferControlToOffscreen != "function")
      throw f("offscreen-canvas-unavailable", "This Canvas cannot be transferred to the rendering worker.");
    return G(e, t, r, n), e.width = 1, e.height = 1, e.transferControlToOffscreen();
  }
  if (typeof OffscreenCanvas < "u" && e instanceof OffscreenCanvas) return e;
  throw new TypeError("renderSlide requires an HTMLCanvasElement or OffscreenCanvas.");
}
class oe {
  constructor(t) {
    this.worker = new Worker(t, { type: "module", name: "flyfish-ppt-renderer" }), this.nextId = 1, this.pending = /* @__PURE__ */ new Map(), this.terminated = !1, this.worker.addEventListener("message", (r) => this.receive(r.data)), this.worker.addEventListener("error", (r) => {
      this.failAll(f("worker-failed", r.message || "The PPT rendering worker failed."));
    }), this.worker.addEventListener("messageerror", () => {
      this.failAll(f("worker-message-invalid", "The PPT rendering worker returned an invalid message."));
    });
  }
  request(t, r = {}, n = []) {
    if (this.terminated) return Promise.reject(f("worker-closed", "The PPT rendering worker is closed."));
    const o = this.nextId++;
    return new Promise((a, s) => {
      this.pending.set(o, { resolve: a, reject: s });
      try {
        this.worker.postMessage({ id: o, type: t, ...r }, n);
      } catch (c) {
        this.pending.delete(o), s(c);
      }
    });
  }
  receive(t) {
    if (!t || !Number.isInteger(t.id)) return;
    const r = this.pending.get(t.id);
    r && (this.pending.delete(t.id), t.ok ? r.resolve(t.result) : r.reject(se(t.error)));
  }
  failAll(t) {
    for (const r of this.pending.values()) r.reject(t);
    this.pending.clear();
  }
  terminate() {
    this.terminated || (this.terminated = !0, this.worker.terminate(), this.failAll(f("worker-closed", "The PPT rendering worker was closed.")));
  }
}
function se(e) {
  const t = f(e?.code || "worker-operation-failed", e?.message || "The PPT rendering worker rejected the operation.");
  return e?.name && (t.name = e.name), t;
}
async function ce(e, t) {
  const r = fe(e, t);
  return r ? (N.has(r) || N.set(r, D(e ?? L, t ?? j).catch((n) => {
    throw N.delete(r), n;
  })), N.get(r)) : D(e ?? L, t ?? j);
}
function fe(e, t) {
  return !C(e) || !C(t) ? "" : `${E(e, L).href}
${E(t, j).href}`;
}
async function D(e, t) {
  const r = F(t, A.fontPack.bytes, "CJK font pack");
  r.catch(() => {
  });
  const n = await F(e, A.wasmBytes, "PPT rendering engine");
  await B(n, A.wasmSha256, "wasm-integrity-invalid", "The PPT rendering engine failed its SHA-256 integrity check.");
  const o = await WebAssembly.compile(n);
  if (WebAssembly.Module.imports(o).length !== 0)
    throw f("wasm-imports-rejected", "The PPT rendering engine must not import browser or host functions.");
  const s = await WebAssembly.instantiate(o, {});
  ue(s.exports);
  const c = await r;
  return await B(c, A.fontPack.sha256, "font-integrity-invalid", "The CJK font pack failed its SHA-256 integrity check."), le(s.exports, c), Object.freeze({ module: o, exports: s.exports });
}
function le(e, t) {
  if (Number(e.ppt_font_pack_is_installed()) === 1) return;
  const r = Number(e.ppt_input_alloc(t.byteLength));
  if (!r) throw P(e, "Unable to allocate native font-pack memory.");
  let n = !1;
  try {
    if (new Uint8Array(e.memory.buffer, r, t.byteLength).set(t), n = Number(e.ppt_font_pack_install(r, t.byteLength)) === 1, !n) throw P(e, "The native engine rejected the CJK font pack.");
  } finally {
    n || e.ppt_input_free(r, t.byteLength);
  }
  if (Number(e.ppt_font_pack_is_installed()) !== 1)
    throw f("font-install-invalid", "The native engine did not retain the verified CJK font pack.");
}
async function F(e, t, r) {
  if (!Number.isInteger(t) || t < 1)
    throw f("asset-manifest-invalid", `The ${r} manifest length is invalid.`);
  if (e instanceof Uint8Array) return O(Uint8Array.from(e), t, r);
  if (e instanceof ArrayBuffer) return O(new Uint8Array(e.slice(0)), t, r);
  if (typeof Response < "u" && e instanceof Response) {
    if (!e.ok) throw f("asset-request-failed", `${r} request failed with HTTP ${e.status}.`);
    return O(await W(e, t), t, r);
  }
  const n = await fetch(e instanceof URL || typeof e == "string" ? e : L);
  if (!n.ok) throw f("asset-request-failed", `${r} request failed with HTTP ${n.status}.`);
  return O(await W(n, t), t, r);
}
async function W(e, t) {
  if (!e.body || typeof e.body.getReader != "function") {
    const a = new Uint8Array(await e.arrayBuffer());
    if (a.byteLength > t) throw f("asset-too-large", "A protected viewer asset exceeded its fixed byte limit.");
    return a;
  }
  const r = e.body.getReader(), n = new Uint8Array(t);
  let o = 0;
  try {
    for (; ; ) {
      const { done: a, value: s } = await r.read();
      if (a) break;
      if (o += s.byteLength, o > t)
        throw await r.cancel("asset byte limit exceeded"), f("asset-too-large", "A protected viewer asset exceeded its fixed byte limit.");
      n.set(s, o - s.byteLength);
    }
  } finally {
    r.releaseLock();
  }
  return o === t ? n : n.subarray(0, o);
}
function O(e, t, r) {
  if (e.byteLength !== t)
    throw f("asset-length-invalid", `${r} byte length is ${e.byteLength}; expected ${t}.`);
  return e;
}
async function B(e, t, r, n) {
  const o = globalThis.crypto?.subtle;
  if (!o || typeof o.digest != "function")
    throw f("asset-integrity-unavailable", "Web Crypto SHA-256 support is required to verify protected viewer assets.");
  const a = new Uint8Array(await o.digest("SHA-256", e));
  if (Array.from(a, (c) => c.toString(16).padStart(2, "0")).join("") !== t) throw f(r, n);
}
function ue(e) {
  const t = Object.keys(e).sort(), r = [...$].sort();
  if (t.length !== r.length || t.some((n, o) => n !== r[o]))
    throw f("wasm-abi-invalid", "The PPT rendering engine has an unexpected public ABI.");
  if (!(e.memory instanceof WebAssembly.Memory))
    throw f("wasm-memory-invalid", "The PPT rendering engine did not provide its bounded working memory.");
  for (const n of $)
    if (n !== "memory" && typeof e[n] != "function")
      throw f("wasm-abi-invalid", `The PPT rendering engine is missing ${n}.`);
}
function de(e) {
  const t = {
    mode: "direct",
    license: V,
    watermark: K,
    async open(r) {
      return he(e.exports, r);
    },
    async mount(r, n, o = {}) {
      return J(t, r, n, o);
    },
    async cacheStats() {
      return Q(e.exports.memory.buffer.byteLength);
    },
    async close() {
    }
  };
  return Object.freeze(t);
}
function he(e, t) {
  const r = X(t);
  if (r.byteLength < 8 || !Y(r))
    throw f("ppt-signature-invalid", "Input is not a PowerPoint 97-2003 (.ppt) compound document.");
  const n = Number(e.ppt_input_alloc(r.byteLength));
  if (!n) throw P(e, "Unable to allocate native input memory.");
  let o = 0;
  try {
    new Uint8Array(e.memory.buffer, n, r.byteLength).set(r), o = Number(e.ppt_document_open(n, r.byteLength));
  } finally {
    e.ppt_input_free(n, r.byteLength);
  }
  if (!o) throw P(e, "The native PPT parser rejected the document.");
  const a = Number(e.ppt_slide_count(o)), s = Number(e.ppt_slide_width(o, 1e3)), c = Number(e.ppt_slide_height(o, 1e3));
  if (!Number.isInteger(a) || a < 1 || a > 1e4 || !Number.isFinite(s) || s <= 0 || !Number.isFinite(c) || c <= 0)
    throw e.ppt_document_close(o), P(e, "The native PPT parser returned invalid presentation dimensions.");
  const g = /* @__PURE__ */ new Map();
  let l = !1;
  return Object.freeze({
    mode: "direct",
    documentId: "",
    get slideCount() {
      return a;
    },
    get width() {
      return s;
    },
    get height() {
      return c;
    },
    get closed() {
      return l;
    },
    async renderSlide(h, u, w = {}) {
      if (l) throw f("document-closed", "The PPT document is already closed.");
      const m = me(e, o, a, s, c, h, u, w);
      return g.set(h, u), m;
    },
    async releaseSlide(h) {
      if (l) return !1;
      S(h, a);
      const u = g.get(h);
      return u ? (u.width = 1, u.height = 1, g.delete(h), !0) : !1;
    },
    async cacheStats() {
      return Q(e.memory.buffer.byteLength);
    },
    async close() {
      if (!l && (l = !0, g.clear(), Number(e.ppt_document_close(o)) !== 1))
        throw P(e, "Unable to close the native PPT document.");
    }
  });
}
function me(e, t, r, n, o, a, s, c) {
  if (S(a, r), !s || typeof s.getContext != "function")
    throw new TypeError("renderSlide requires an HTMLCanvasElement or OffscreenCanvas.");
  const { scale: g, pixelRatio: l, nativeScale: v } = Z(c), h = Math.round(v * 1e3), u = Number(e.ppt_slide_width(t, h)), w = Number(e.ppt_slide_height(t, h)), m = Number(e.ppt_render_slide_rgba(t, a, h));
  if (!m) throw P(e, `Unable to render slide ${a + 1}.`);
  try {
    const p = Number(e.ppt_frame_width(m)), b = Number(e.ppt_frame_height(m)), T = Number(e.ppt_frame_stride(m)), U = Number(e.ppt_frame_len(m)), R = Number(e.ppt_frame_ptr(m));
    if (p !== u || b !== w || T !== p * 4 || U !== T * b || !R)
      throw f("wasm-frame-invalid", "The native PPT engine returned an invalid RGBA frame.");
    s.width = p, s.height = b, typeof HTMLCanvasElement < "u" && s instanceof HTMLCanvasElement && G(s, n, o, g);
    const _ = s.getContext("2d", { alpha: !1, desynchronized: !1 });
    if (!_ || typeof _.putImageData != "function")
      throw f("canvas-context-unavailable", "A 2D Canvas context is required to display PPT slides.");
    const i = new Uint8ClampedArray(e.memory.buffer, R, U);
    let d;
    try {
      d = new ImageData(i, p, b);
    } catch {
      d = _.createImageData(p, b), d.data.set(i);
    }
    return _.putImageData(d, 0, 0), Object.freeze({ slideIndex: a, width: p, height: b, logicalWidth: n, logicalHeight: o, scale: g, pixelRatio: l });
  } finally {
    e.ppt_frame_free(m);
  }
}
async function J(e, t, r, n) {
  const o = pe(t), a = await e.open(r), s = we(o, n), c = [], g = [], l = Array.from({ length: a.slideCount }, () => "idle"), v = Array.from({ length: a.slideCount }, () => !1), h = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), w = /* @__PURE__ */ new Map();
  let m = null, p = !1;
  try {
    let R = function(i) {
      const d = w.get(i);
      d !== void 0 && clearTimeout(d), w.delete(i);
    };
    for (let i = 0; i < a.slideCount; i += 1) {
      const { shell: d, canvas: y } = ye(s, i, a.width, a.height, z(n.scale, 1));
      g.push(d), c.push(y);
    }
    const b = (i) => {
      if (p || l[i] === "rendered") return h.get(i) || Promise.resolve();
      const d = h.get(i);
      if (d) return d;
      R(i), l[i] = "rendering", c[i].dataset.renderState = "rendering";
      const y = a.renderSlide(i, c[i], n).then((k) => k?.cancelled ? (l[i] = "released", c[i].dataset.renderState = "released", k) : (l[i] = "rendered", c[i].dataset.renderState = "rendered", k)).catch((k) => {
        throw l[i] = "error", c[i].dataset.renderState = "error", k;
      }).finally(() => h.delete(i));
      return h.set(i, y), y;
    }, T = async (i) => {
      if (p || u.has(i)) return u.get(i);
      const d = (async () => {
        const y = h.get(i);
        if (y && await y.catch(() => {
        }), !(p || v[i] || l[i] !== "rendered"))
          try {
            await a.releaseSlide(i), l[i] = "released", c[i].dataset.renderState = "released", v[i] && !p && await b(i);
          } catch (k) {
            c[i].dataset.renderState = "error", console.warn("Flyfish PPT slide release failed.", k);
          }
      })().finally(() => u.delete(i));
      return u.set(i, d), d;
    }, U = (i) => {
      R(i);
      const d = M(n.releaseDelayMs, 1200, 0, 3e4), y = setTimeout(() => {
        w.delete(i), T(i);
      }, d);
      w.set(i, y);
    }, _ = n.virtualize !== !1 && typeof IntersectionObserver == "function";
    if (_) {
      m = new IntersectionObserver((i) => {
        for (const d of i) {
          const y = Number(d.target.dataset.slideIndex);
          d.isIntersecting ? (v[y] = !0, R(y), b(y).catch((k) => console.error(k))) : (v[y] = !1, U(y));
        }
      }, {
        root: n.scrollRoot || null,
        rootMargin: typeof n.rootMargin == "string" ? n.rootMargin : "150% 0px",
        threshold: 0
      });
      for (const i of g) m.observe(i);
      await b(0);
    } else
      for (let i = 0; i < a.slideCount; i += 1)
        await b(i), i + 1 < a.slideCount && await Pe();
    return Object.freeze({
      document: a,
      root: s,
      canvases: Object.freeze(c),
      virtualized: _,
      async renderSlide(i) {
        return S(i, a.slideCount), b(i);
      },
      async cacheStats() {
        return a.cacheStats();
      },
      async close() {
        if (!p) {
          p = !0, m?.disconnect();
          for (const i of w.values()) clearTimeout(i);
          w.clear(), await Promise.allSettled(h.values()), await Promise.allSettled(u.values()), await a.close(), s.remove();
        }
      }
    });
  } catch (b) {
    p = !0, m?.disconnect();
    for (const T of w.values()) clearTimeout(T);
    throw await Promise.allSettled(u.values()), s.remove(), await a.close().catch(() => {
    }), b;
  }
}
function pe(e) {
  const t = typeof e == "string" ? document.querySelector(e) : e;
  if (!t || typeof t.append != "function")
    throw new TypeError("mount requires a DOM element or a selector that resolves to one.");
  return t;
}
function we(e, t) {
  t.replace !== !1 && e.replaceChildren();
  const r = document.createElement("div");
  return r.className = t.className || "flyfish-ppt-viewer", r.dataset.flyfishPptEdition = "public-watermarked", r.dataset.flyfishPptVirtualized = String(t.virtualize !== !1), r.style.cssText = "display:grid;width:100%;min-width:0;justify-content:center;gap:20px;padding:20px;box-sizing:border-box;background:#eef1f5;", e.append(r), r;
}
function ye(e, t, r, n, o) {
  const a = document.createElement("section");
  a.dataset.slideIndex = String(t), a.style.cssText = `width:${Math.round(r * o)}px;max-width:100%;min-width:0;aspect-ratio:${r}/${n};overflow:hidden;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.14);`;
  const s = document.createElement("canvas");
  return s.width = 1, s.height = 1, s.dataset.renderState = "idle", s.setAttribute("role", "img"), s.setAttribute("aria-label", `Slide ${t + 1}`), s.style.cssText = "display:block;width:100%;height:100%;", a.append(s), e.append(a), { shell: a, canvas: s };
}
function G(e, t, r, n) {
  e.style.width = `${Math.round(t * n)}px`, e.style.maxWidth = "100%", e.style.height = "auto", e.style.aspectRatio = `${t} / ${r}`, e.style.display = "block";
}
function X(e) {
  if (e instanceof Uint8Array) return e;
  if (e instanceof ArrayBuffer) return new Uint8Array(e);
  if (ArrayBuffer.isView(e)) return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
  throw new TypeError("PPT input must be an ArrayBuffer or Uint8Array.");
}
function be(e) {
  const t = new Uint8Array(e.byteLength);
  return t.set(e), t.buffer;
}
function ge(e, t, r) {
  return r && t.byteOffset === 0 && t.buffer instanceof ArrayBuffer && t.byteLength === t.buffer.byteLength && (e instanceof ArrayBuffer || ArrayBuffer.isView(e)) ? t.buffer : be(t);
}
function Q(e = 0) {
  return Object.freeze({
    enabled: !1,
    available: !1,
    disabledReason: "worker-disabled",
    entries: 0,
    bytes: 0,
    maxBytes: 0,
    maxEntries: 0,
    maxEntryBytes: 0,
    hits: 0,
    misses: 0,
    writes: 0,
    nativeRenders: 0,
    cancellations: 0,
    attachedCanvases: 0,
    activeCanvases: 0,
    wasmMemoryBytes: e
  });
}
function Y(e) {
  return [208, 207, 17, 224, 161, 177, 26, 225].every((r, n) => e[n] === r);
}
function Z(e = {}) {
  const t = z(e.scale, 1), r = z(e.pixelRatio, _e()), n = t * r;
  if (n < 0.1 || n > 8)
    throw new RangeError("scale * pixelRatio must be between 0.1 and 8.");
  return { scale: t, pixelRatio: r, nativeScale: n };
}
function ve(e) {
  if (e === !1) return { enabled: !1 };
  const t = e && typeof e == "object" ? e : {};
  return {
    enabled: t.enabled !== !1,
    dbName: typeof t.dbName == "string" && t.dbName.trim() ? t.dbName.trim() : "flyfish-ppt-frame-cache-v1",
    maxBytes: M(t.maxBytes, 256 * 1024 * 1024, 16 * 1024 * 1024, 1024 * 1024 * 1024),
    maxEntries: M(t.maxEntries, 200, 8, 2e3),
    maxEntryBytes: M(t.maxEntryBytes, 32 * 1024 * 1024, 1024 * 1024, 128 * 1024 * 1024)
  };
}
function E(e, t) {
  if (e === void 0) return t;
  if (e instanceof URL) return e;
  if (typeof e == "string") return new URL(e, globalThis.location?.href || import.meta.url);
  throw new TypeError("Worker rendering asset sources must be URLs or URL strings.");
}
function S(e, t) {
  if (!Number.isInteger(e) || e < 0 || e >= t)
    throw new RangeError(`slideIndex must be between 0 and ${t - 1}.`);
}
function q(e) {
  if (e) throw f("document-closed", "The PPT document is already closed.");
}
function z(e, t) {
  if (e === void 0) return t;
  const r = Number(e);
  if (!Number.isFinite(r) || r <= 0) throw new RangeError("Render scale and pixelRatio must be finite positive numbers.");
  return r;
}
function M(e, t, r, n) {
  const o = e === void 0 ? t : Number(e);
  return Number.isFinite(o) ? Math.min(n, Math.max(r, Math.round(o))) : t;
}
function ke(e, t) {
  const r = Number(e);
  if (!Number.isInteger(r) || r < 1) throw f("worker-metadata-invalid", `Worker ${t} is invalid.`);
  return r;
}
function H(e, t) {
  const r = Number(e);
  if (!Number.isFinite(r) || r <= 0) throw f("worker-metadata-invalid", `Worker ${t} is invalid.`);
  return r;
}
function _e() {
  return typeof devicePixelRatio == "number" && Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1;
}
function Pe() {
  return typeof requestAnimationFrame == "function" ? new Promise((e) => requestAnimationFrame(() => e())) : Promise.resolve();
}
function P(e, t) {
  const r = Number(e.ppt_last_error_code()) || 0;
  return f(`native-${r || "unknown"}`, `${t} (native error ${r || "unknown"})`);
}
function f(e, t) {
  const r = new Error(t);
  return r.name = "FlyfishPptError", Object.defineProperty(r, "code", { value: e, enumerable: !0 }), r;
}
export {
  Te as createPptViewer,
  ee as getPptPackageManifest,
  te as loadPptViewer
};
