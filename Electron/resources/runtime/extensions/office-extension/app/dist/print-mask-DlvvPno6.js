import { c as J, i as O, j as H } from "./office-renderer-CZRmDY3X.js";
const K = `
.fv-print-mask-layer{position:absolute;inset:0;z-index:2147483000;pointer-events:none;}
.fv-print-mask-canvas{position:absolute;inset:0;z-index:2147483000;pointer-events:none;cursor:default;}
.fv-print-mask-canvas.is-armed{pointer-events:auto;cursor:crosshair;touch-action:none;}
.fv-print-mask-block{position:absolute;background:#000;box-sizing:border-box;pointer-events:auto;}
.fv-print-mask-block-remove{position:absolute;right:-8px;top:-8px;width:18px;height:18px;border:0;border-radius:999px;background:#111;color:#fff;font:700 12px/18px system-ui,sans-serif;cursor:pointer;padding:0;}
.fv-print-stamp{position:absolute;box-sizing:border-box;border:1px dashed rgba(22,119,76,.7);border-radius:4px;pointer-events:auto;touch-action:none;cursor:move;transform-origin:center center;}
.fv-print-stamp img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none;}
.fv-print-stamp-resize{position:absolute;right:-7px;bottom:-7px;width:15px;height:15px;border:2px solid #fff;border-radius:4px;background:#16774c;box-shadow:0 1px 5px rgba(15,23,42,.22);cursor:nwse-resize;touch-action:none;}
.fv-print-stamp-input{display:none!important;}
.fv-print-mask-toolbar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483001;display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(20,35,53,.12);border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 12px 28px rgba(15,23,42,.16);pointer-events:auto;max-width:calc(100% - 24px);flex-wrap:wrap;justify-content:center;}
.fv-print-mask-toolbar span{font:600 12px/1.2 system-ui,sans-serif;color:#40546a;white-space:nowrap;}
.fv-print-mask-toolbar button{min-width:42px;height:30px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:#40546a;font:800 12px/1 system-ui,sans-serif;cursor:pointer;}
.fv-print-mask-toolbar button:hover,.fv-print-mask-toolbar button.is-active{background:rgba(33,163,102,.1);color:#16774c;}
.fv-print-mask-toolbar button.primary{background:#16774c;color:#fff;}
.fv-print-mask-toolbar button.primary:hover{background:#0f5f3c;}
`, Q = (p) => {
  const i = p.ownerDocument, n = p.getRootNode(), l = n === i ? i.head : n;
  if (l.querySelector("#fv-print-mask-designer-style"))
    return;
  const h = i.createElement("style");
  h.id = "fv-print-mask-designer-style", h.textContent = K, l.appendChild(h);
}, Z = (p, i, n, l) => {
  if (!n.width || !n.height)
    return null;
  const h = Math.min(p.x, i.x), c = Math.min(p.y, i.y), g = Math.abs(i.x - p.x), P = Math.abs(i.y - p.y);
  return g < 8 || P < 8 ? null : O({
    left: h / n.width * 100,
    top: c / n.height * 100,
    width: g / n.width * 100,
    height: P / n.height * 100,
    pageIndex: l
  });
}, tt = (p, i) => {
  const n = p.getBoundingClientRect(), l = Math.max(0, Math.min(n.right, i.right) - Math.max(n.left, i.left)), h = Math.max(0, Math.min(n.bottom, i.bottom) - Math.max(n.top, i.top));
  return l * h;
}, et = 10 * 1024 * 1024, nt = (p, i) => new Promise((n, l) => {
  if (!/^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/i.test(p.type) || p.size > et) {
    l(new Error("Unsupported print stamp image"));
    return;
  }
  const h = i?.FileReader || globalThis.FileReader, c = new h();
  c.addEventListener("load", () => {
    if (typeof c.result == "string" && c.result.startsWith("data:image/")) {
      n(c.result);
      return;
    }
    l(new Error("Invalid print stamp image"));
  }), c.addEventListener("error", () => l(c.error || new Error("Failed to read print stamp image"))), c.readAsDataURL(p);
}), it = (p) => {
  const i = p.root, n = i.ownerDocument, l = J(p.i18n), h = p.color || "#000000", c = [...p.initialRegions || []].map((d) => O(d)).filter((d) => !!d), g = [...p.initialStamps || []].map((d) => H(d)).filter((d) => !!d), P = Array.from(new Set(p.pages || [])).filter((d) => d === i || i.contains(d)), $ = P.length > 0, W = $ ? P : [i];
  Q(i);
  const F = (d) => {
    var k, r, b;
    const S = d.style.position;
    return (((b = (r = (k = n.defaultView) === null || k === void 0 ? void 0 : k.getComputedStyle) === null || r === void 0 ? void 0 : r.call(k, d)) === null || b === void 0 ? void 0 : b.position) || S || "static") === "static" && (d.style.position = "relative"), S;
  }, T = F(i);
  return new Promise((d) => {
    let k = !1, r = null;
    const b = n.createElement("div");
    b.className = "fv-print-mask-layer", b.setAttribute("data-viewer-print-mask-designer", "true");
    const S = (t, o) => {
      const a = F(t), e = n.createElement("div");
      return e.className = "fv-print-mask-canvas", t.appendChild(e), {
        element: t,
        pageIndex: o,
        canvas: e,
        previousPosition: a
      };
    }, f = W.map((t, o) => S(t, $ ? o : void 0)), B = $ && !f.some((t) => t.element === i) && (c.some((t) => t.pageIndex === void 0) || g.some((t) => t.pageIndex === void 0)) ? S(i) : null, X = B ? [...f, B] : f, I = n.createElement("div");
    I.className = "fv-print-mask-toolbar", I.setAttribute("role", "toolbar"), I.setAttribute("aria-label", l("toolbar.printMaskTitle"));
    const Y = n.createElement("span");
    Y.textContent = l("toolbar.printMaskHint");
    const M = n.createElement("button");
    M.type = "button", M.textContent = l("toolbar.printMaskAdd");
    const x = n.createElement("input");
    x.type = "file", x.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", x.className = "fv-print-stamp-input", x.setAttribute("data-viewer-print-stamp-input", "true");
    const A = n.createElement("button");
    A.type = "button", A.textContent = l("toolbar.printStampUpload");
    const z = n.createElement("button");
    z.type = "button", z.textContent = l("toolbar.printMaskClear");
    const N = n.createElement("button");
    N.type = "button", N.textContent = l("toolbar.printMaskCancel");
    const L = n.createElement("button");
    L.type = "button", L.className = "primary", L.textContent = l("toolbar.printMaskConfirm"), I.append(Y, M, A, z, N, L), b.append(x, I), i.appendChild(b);
    const R = () => {
      f.forEach((t) => t.canvas.classList.remove("is-armed")), M.classList.remove("is-active");
    }, _ = (t) => {
      k || (k = !0, b.remove(), X.forEach((o) => {
        o.canvas.remove(), o.previousPosition ? o.element.style.position = o.previousPosition : o.element.style.removeProperty("position");
      }), T ? i.style.position = T : i.style.removeProperty("position"), d(t));
    }, V = (t) => t.pageIndex === void 0 ? B || f[0] : f.find((o) => o.pageIndex === t.pageIndex) || null, w = () => {
      X.forEach((t) => t.canvas.replaceChildren()), c.forEach((t, o) => {
        const a = V(t);
        if (!a)
          return;
        const e = n.createElement("div");
        e.className = "fv-print-mask-block", e.style.left = `${t.left}%`, e.style.top = `${t.top}%`, e.style.width = `${t.width}%`, e.style.height = `${t.height}%`, e.style.background = h;
        const m = n.createElement("button");
        m.type = "button", m.className = "fv-print-mask-block-remove", m.title = l("toolbar.printMaskClear"), m.setAttribute("aria-label", l("toolbar.printMaskClear")), m.textContent = "−", m.addEventListener("click", (E) => {
          E.preventDefault(), E.stopPropagation(), c.splice(o, 1), w();
        }), e.appendChild(m), a.canvas.appendChild(e);
      }), g.forEach((t, o) => {
        const a = V(t);
        if (!a)
          return;
        const e = n.createElement("div");
        e.className = "fv-print-stamp", e.setAttribute("data-viewer-print-stamp", String(o));
        const m = () => {
          var s, u;
          e.style.left = `${t.left}%`, e.style.top = `${t.top}%`, e.style.width = `${t.width}%`, e.style.height = `${t.height}%`, e.style.opacity = String((s = t.opacity) !== null && s !== void 0 ? s : 1), e.style.transform = `rotate(${(u = t.rotate) !== null && u !== void 0 ? u : 0}deg)`;
        };
        m();
        const E = n.createElement("img");
        E.src = t.src, E.alt = t.alt || "", E.draggable = !1;
        const y = n.createElement("button");
        y.type = "button", y.className = "fv-print-mask-block-remove", y.title = l("toolbar.printStampRemove"), y.setAttribute("aria-label", l("toolbar.printStampRemove")), y.textContent = "−", y.addEventListener("pointerdown", (s) => s.stopPropagation()), y.addEventListener("click", (s) => {
          s.preventDefault(), s.stopPropagation(), g.splice(o, 1), w();
        });
        const C = n.createElement("span");
        C.className = "fv-print-stamp-resize", C.setAttribute("role", "button"), C.setAttribute("aria-label", l("toolbar.printStampResize")), C.title = l("toolbar.printStampResize");
        let v = null;
        e.addEventListener("pointerdown", (s) => {
          var u;
          s.button !== 0 || s.target.closest("button") || (s.preventDefault(), s.stopPropagation(), v = {
            pointerId: s.pointerId,
            mode: s.target === C ? "resize" : "move",
            startX: s.clientX,
            startY: s.clientY,
            left: t.left,
            top: t.top,
            width: t.width,
            height: t.height
          }, (u = e.setPointerCapture) === null || u === void 0 || u.call(e, s.pointerId));
        }), e.addEventListener("pointermove", (s) => {
          if (!v || v.pointerId !== s.pointerId)
            return;
          s.preventDefault();
          const u = a.canvas.getBoundingClientRect();
          if (!u.width || !u.height)
            return;
          const q = (s.clientX - v.startX) / u.width * 100, G = (s.clientY - v.startY) / u.height * 100;
          v.mode === "move" ? (t.left = Math.max(0, Math.min(100 - t.width, v.left + q)), t.top = Math.max(0, Math.min(100 - t.height, v.top + G))) : (t.width = Math.max(4, Math.min(100 - t.left, v.width + q)), t.height = Math.max(4, Math.min(100 - t.top, v.height + G))), m();
        });
        const j = (s) => {
          var u;
          if (!(!v || v.pointerId !== s.pointerId)) {
            try {
              (u = e.releasePointerCapture) === null || u === void 0 || u.call(e, v.pointerId);
            } catch {
            }
            v = null;
          }
        };
        e.addEventListener("pointerup", j), e.addEventListener("pointercancel", j), e.append(E, y, C), a.canvas.appendChild(e);
      });
    }, D = (t, o) => {
      const a = o.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(a.width, t.clientX - a.left)),
        y: Math.max(0, Math.min(a.height, t.clientY - a.top))
      };
    };
    f.forEach((t) => {
      t.canvas.addEventListener("pointerdown", (o) => {
        if (o.button !== 0 || !t.canvas.classList.contains("is-armed"))
          return;
        o.preventDefault();
        const a = D(o, t.canvas), e = n.createElement("div");
        e.className = "fv-print-mask-block", e.style.background = h, e.style.opacity = "0.72", t.canvas.appendChild(e), r = { surface: t, start: a, preview: e, pointerId: o.pointerId }, t.canvas.setPointerCapture(o.pointerId);
      }), t.canvas.addEventListener("pointermove", (o) => {
        if (!r || r.surface !== t)
          return;
        const a = D(o, t.canvas), e = Math.min(r.start.x, a.x), m = Math.min(r.start.y, a.y);
        r.preview.style.left = `${e}px`, r.preview.style.top = `${m}px`, r.preview.style.width = `${Math.abs(a.x - r.start.x)}px`, r.preview.style.height = `${Math.abs(a.y - r.start.y)}px`;
      }), t.canvas.addEventListener("pointerup", (o) => {
        if (!r || r.surface !== t)
          return;
        const a = D(o, t.canvas), e = Z(r.start, a, t.canvas.getBoundingClientRect(), t.pageIndex);
        r.preview.remove();
        try {
          t.canvas.releasePointerCapture(r.pointerId);
        } catch {
        }
        r = null, R(), e && c.push(e), w();
      }), t.canvas.addEventListener("pointercancel", () => {
        !r || r.surface !== t || (r.preview.remove(), r = null, R(), w());
      });
    });
    const U = () => {
      var t;
      const o = i.getBoundingClientRect();
      return ((t = f.map((a) => ({ surface: a, area: tt(a.element, o) })).sort((a, e) => e.area - a.area)[0]) === null || t === void 0 ? void 0 : t.surface) || f[0];
    };
    M.addEventListener("click", () => {
      R();
      const t = U();
      t?.canvas.classList.add("is-armed"), M.classList.toggle("is-active", !!t);
    }), A.addEventListener("click", () => {
      R(), x.click();
    }), x.addEventListener("change", async () => {
      var t;
      const o = (t = x.files) === null || t === void 0 ? void 0 : t[0];
      if (x.value = "", !!o)
        try {
          const a = await nt(o, n.defaultView), e = U();
          if (!e)
            return;
          const m = H({
            src: a,
            alt: o.name,
            left: 38,
            top: 38,
            width: 24,
            height: 18,
            pageIndex: e.pageIndex
          });
          m && (g.push(m), w());
        } catch {
        }
    }), z.addEventListener("click", () => {
      c.splice(0, c.length), g.splice(0, g.length), R(), w();
    }), N.addEventListener("click", () => _(null)), L.addEventListener("click", () => {
      if (!c.length && !g.length) {
        _(null);
        return;
      }
      _({
        mask: {
          ...c.length ? { regions: c.map((t) => ({ ...t })) } : {},
          ...g.length ? { stamps: g.map((t) => ({ ...t })) } : {},
          color: h
        }
      });
    }), w();
  });
};
export {
  it as openFileViewerPrintMaskDesigner
};
