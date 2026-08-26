import { e as v } from "./index-DK4k06Xx.js";
import { c as b } from "./office-renderer-CZRmDY3X.js";
const x = `
.odf-viewer{min-height:100%;padding:28px;overflow:auto;background:var(--file-viewer-render-surface-background,#dfe5eb);box-sizing:border-box}
.odf-shell{width:min(100%,980px);margin:0 auto}.odf-shell>header{margin-bottom:18px;padding:18px 22px;border-radius:8px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.1);box-sizing:border-box}
.odf-shell>header span{color:#0f766e;font-size:12px;font-weight:800}.odf-shell>header h2{margin:6px 0 0;color:#132235;font-size:24px}
.odf-page{min-height:360px;margin:0 auto 18px;padding:42px 48px;border-radius:4px;background:#fff;box-shadow:0 16px 38px rgba(15,23,42,.12);color:#1f2937;box-sizing:border-box}
.odf-page h3{margin:0 0 20px;color:#334155;font-size:18px}.odf-page p{margin:0 0 12px;font-size:15px;line-height:1.85;white-space:pre-wrap}
.flyfish-rtf-viewer{min-height:100%;padding:28px;overflow:auto;background:var(--file-viewer-render-surface-background,#dfe5eb);color:#1f2937;box-sizing:border-box}
.flyfish-rtf-header{width:min(100%,900px);margin:0 auto 18px;padding:18px 22px;border-radius:8px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.1);box-sizing:border-box}
.flyfish-rtf-header span{display:block;color:#0f766e;font-size:12px;font-weight:800}.flyfish-rtf-header strong{display:block;margin-top:6px;color:#132235;font-size:24px}
.flyfish-rtf-paper{width:min(100%,900px);min-height:980px;margin:0 auto;padding:54px 62px;background:#fff;box-shadow:0 16px 38px rgba(15,23,42,.12);line-height:1.75;box-sizing:border-box}.flyfish-rtf-paper p{margin:0 0 12px}
[data-viewer-theme='dark'] .odf-viewer,[data-viewer-theme='dark'] .flyfish-rtf-viewer{color-scheme:dark;background:var(--file-viewer-render-surface-background,#0d1117);color:#e6edf3}
[data-viewer-theme='dark'] .odf-shell>header,[data-viewer-theme='dark'] .odf-page,[data-viewer-theme='dark'] .flyfish-rtf-header,[data-viewer-theme='dark'] .flyfish-rtf-paper{border:1px solid rgba(139,148,158,.24);background:#161b22;color:#e6edf3;box-shadow:0 18px 44px rgba(0,0,0,.34)}
[data-viewer-theme='dark'] .odf-shell>header h2,[data-viewer-theme='dark'] .odf-page h3,[data-viewer-theme='dark'] .flyfish-rtf-header strong{color:#f0f6fc}
[data-viewer-theme='dark'] .odf-shell>header span,[data-viewer-theme='dark'] .flyfish-rtf-header span{color:#6ee7b7}
@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .odf-viewer,[data-viewer-theme='system'] .flyfish-rtf-viewer{color-scheme:dark;background:var(--file-viewer-render-surface-background,#0d1117);color:#e6edf3}[data-viewer-theme='system'] .odf-shell>header,[data-viewer-theme='system'] .odf-page,[data-viewer-theme='system'] .flyfish-rtf-header,[data-viewer-theme='system'] .flyfish-rtf-paper{border:1px solid rgba(139,148,158,.24);background:#161b22;color:#e6edf3;box-shadow:0 18px 44px rgba(0,0,0,.34)}[data-viewer-theme='system'] .odf-shell>header h2,[data-viewer-theme='system'] .odf-page h3,[data-viewer-theme='system'] .flyfish-rtf-header strong{color:#f0f6fc}[data-viewer-theme='system'] .odf-shell>header span,[data-viewer-theme='system'] .flyfish-rtf-header span{color:#6ee7b7}}
@media (max-width:720px){.odf-viewer,.flyfish-rtf-viewer{padding:14px}.odf-page{padding:28px 24px}.flyfish-rtf-paper{padding:36px 28px}}
`, w = () => {
  const r = document.createElement("style");
  return r.textContent = x, r;
}, p = (r, a, i, e) => {
  const o = document.createElement(a);
  return o.textContent = i, r.appendChild(o), o;
}, u = (r) => (r.textContent || "").replace(/\s+/g, " ").trim(), y = async (r, a, i) => {
  var e;
  const d = await ((e = (await v.loadAsync(r)).file("content.xml")) === null || e === void 0 ? void 0 : e.async("text"));
  if (!d)
    throw new Error(i("word.error.missingOdfContent"));
  const t = new DOMParser().parseFromString(d, "application/xml");
  if (t.querySelector("parsererror"))
    throw new Error(i("word.error.odfXmlParseFailed"));
  if (a === "odp")
    return Array.from(t.getElementsByTagName("draw:page")).map((g, h) => {
      const s = Array.from(g.getElementsByTagName("text:p")).map(u).filter(Boolean);
      return {
        title: i("word.page.fallback", { page: h + 1 }),
        blocks: s.length ? s : [i("word.page.empty")]
      };
    });
  const l = [
    ...Array.from(t.getElementsByTagName("text:h")).map(u),
    ...Array.from(t.getElementsByTagName("text:p")).map(u)
  ].filter(Boolean);
  return [{ title: i("word.body"), blocks: l.length ? l : [i("word.body.empty")] }];
}, k = (r, a, i) => {
  const e = document.createElement("div");
  e.className = "odf-viewer";
  const o = document.createElement("section");
  o.className = "odf-shell";
  const d = document.createElement("header");
  return p(d, "span", r.toUpperCase()), p(d, "h2", a), o.appendChild(d), i.forEach((t) => {
    const n = document.createElement("article");
    n.className = "odf-page", p(n, "h3", t.title), t.blocks.forEach((l) => p(n, "p", l)), o.appendChild(n);
  }), e.appendChild(o), e;
}, E = async () => {
  const r = await import("./RTFJS.bundle-Bohv4W1H.js").then((a) => a.R);
  return r.RTFJS || r.default || r;
}, T = async (r, a, i, e) => {
  var o, d, t;
  const n = await E();
  (o = n.loggingEnabled) === null || o === void 0 || o.call(n, !1);
  const l = new n.Document(r, {}), f = ((d = l.metadata) === null || d === void 0 ? void 0 : d.call(l)) || {}, g = await l.render(), h = document.createElement("div");
  h.className = "flyfish-rtf-viewer";
  const s = document.createElement("div");
  s.className = "flyfish-rtf-header", p(s, "span", "RTF"), p(s, "strong", f.title || i("word.title.rtf"));
  const m = document.createElement("article");
  return m.className = "flyfish-rtf-paper", g.forEach((c) => m.appendChild(c)), h.append(s, m), a.replaceChildren(w(), h), (t = e?.registerThumbnailAdapter) === null || t === void 0 || t.call(e, { getTarget: () => m }), {
    $el: a,
    unmount() {
      var c;
      (c = e?.registerThumbnailAdapter) === null || c === void 0 || c.call(e, null), a.replaceChildren();
    }
  };
};
async function N(r, a, i, e) {
  var o;
  const d = b(e?.options), t = (i || "odt").toLowerCase();
  if (t === "rtf")
    return T(r, a, d, e);
  const n = await y(r, t, d), l = d(t === "odp" ? "word.title.openDocumentPresentation" : "word.title.openDocumentText");
  return a.replaceChildren(w(), k(t, l, n)), (o = e?.registerThumbnailAdapter) === null || o === void 0 || o.call(e, {
    getTarget: () => a.querySelector(".odf-page") || a
  }), {
    $el: a,
    unmount() {
      var f;
      (f = e?.registerThumbnailAdapter) === null || f === void 0 || f.call(e, null), a.replaceChildren();
    }
  };
}
export {
  N as default
};
