import { r as e } from "./rolldown-runtime-QGRDbDUS.js";
import { t } from "./lib-ODMkZPnO.js";
import { t as n } from "./messages-DuQwbmFt.js";
import "./dist-BZCS2h0l.js";
// ../../node_modules/@file-viewer/renderer-word/dist/openDocument.js
var r = /* @__PURE__ */ e(t(), 1), i = "\n.odf-viewer{min-height:100%;padding:28px;overflow:auto;background:var(--file-viewer-render-surface-background,#dfe5eb);box-sizing:border-box}\n.odf-shell{width:min(100%,980px);margin:0 auto}.odf-shell>header{margin-bottom:18px;padding:18px 22px;border-radius:8px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.1);box-sizing:border-box}\n.odf-shell>header span{color:#0f766e;font-size:12px;font-weight:800}.odf-shell>header h2{margin:6px 0 0;color:#132235;font-size:24px}\n.odf-page{min-height:360px;margin:0 auto 18px;padding:42px 48px;border-radius:4px;background:#fff;box-shadow:0 16px 38px rgba(15,23,42,.12);color:#1f2937;box-sizing:border-box}\n.odf-page h3{margin:0 0 20px;color:#334155;font-size:18px}.odf-page p{margin:0 0 12px;font-size:15px;line-height:1.85;white-space:pre-wrap}\n.flyfish-rtf-viewer{min-height:100%;padding:28px;overflow:auto;background:var(--file-viewer-render-surface-background,#dfe5eb);color:#1f2937;box-sizing:border-box}\n.flyfish-rtf-header{width:min(100%,900px);margin:0 auto 18px;padding:18px 22px;border-radius:8px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.1);box-sizing:border-box}\n.flyfish-rtf-header span{display:block;color:#0f766e;font-size:12px;font-weight:800}.flyfish-rtf-header strong{display:block;margin-top:6px;color:#132235;font-size:24px}\n.flyfish-rtf-paper{width:min(100%,900px);min-height:980px;margin:0 auto;padding:54px 62px;background:#fff;box-shadow:0 16px 38px rgba(15,23,42,.12);line-height:1.75;box-sizing:border-box}.flyfish-rtf-paper p{margin:0 0 12px}\n[data-viewer-theme='dark'] .odf-viewer,[data-viewer-theme='dark'] .flyfish-rtf-viewer{color-scheme:dark;background:var(--file-viewer-render-surface-background,#0d1117);color:#e6edf3}\n[data-viewer-theme='dark'] .odf-shell>header,[data-viewer-theme='dark'] .odf-page,[data-viewer-theme='dark'] .flyfish-rtf-header,[data-viewer-theme='dark'] .flyfish-rtf-paper{border:1px solid rgba(139,148,158,.24);background:#161b22;color:#e6edf3;box-shadow:0 18px 44px rgba(0,0,0,.34)}\n[data-viewer-theme='dark'] .odf-shell>header h2,[data-viewer-theme='dark'] .odf-page h3,[data-viewer-theme='dark'] .flyfish-rtf-header strong{color:#f0f6fc}\n[data-viewer-theme='dark'] .odf-shell>header span,[data-viewer-theme='dark'] .flyfish-rtf-header span{color:#6ee7b7}\n@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .odf-viewer,[data-viewer-theme='system'] .flyfish-rtf-viewer{color-scheme:dark;background:var(--file-viewer-render-surface-background,#0d1117);color:#e6edf3}[data-viewer-theme='system'] .odf-shell>header,[data-viewer-theme='system'] .odf-page,[data-viewer-theme='system'] .flyfish-rtf-header,[data-viewer-theme='system'] .flyfish-rtf-paper{border:1px solid rgba(139,148,158,.24);background:#161b22;color:#e6edf3;box-shadow:0 18px 44px rgba(0,0,0,.34)}[data-viewer-theme='system'] .odf-shell>header h2,[data-viewer-theme='system'] .odf-page h3,[data-viewer-theme='system'] .flyfish-rtf-header strong{color:#f0f6fc}[data-viewer-theme='system'] .odf-shell>header span,[data-viewer-theme='system'] .flyfish-rtf-header span{color:#6ee7b7}}\n@media (max-width:720px){.odf-viewer,.flyfish-rtf-viewer{padding:14px}.odf-page{padding:28px 24px}.flyfish-rtf-paper{padding:36px 28px}}\n", a = () => {
	let e = document.createElement("style");
	return e.textContent = i, e;
}, o = (e, t, n, r) => {
	let i = document.createElement(t);
	return r && (i.className = r), i.textContent = n, e.appendChild(i), i;
}, s = (e) => (e.textContent || "").replace(/\s+/g, " ").trim(), c = async (e, t, n) => {
	let i = await (await r.default.loadAsync(e)).file("content.xml")?.async("text");
	if (!i) throw Error(n("word.error.missingOdfContent"));
	let a = new DOMParser().parseFromString(i, "application/xml");
	if (a.querySelector("parsererror")) throw Error(n("word.error.odfXmlParseFailed"));
	if (t === "odp") return Array.from(a.getElementsByTagName("draw:page")).map((e, t) => {
		let r = Array.from(e.getElementsByTagName("text:p")).map(s).filter(Boolean);
		return {
			title: n("word.page.fallback", { page: t + 1 }),
			blocks: r.length ? r : [n("word.page.empty")]
		};
	});
	let o = [...Array.from(a.getElementsByTagName("text:h")).map(s), ...Array.from(a.getElementsByTagName("text:p")).map(s)].filter(Boolean);
	return [{
		title: n("word.body"),
		blocks: o.length ? o : [n("word.body.empty")]
	}];
}, l = (e, t, n) => {
	let r = document.createElement("div");
	r.className = "odf-viewer";
	let i = document.createElement("section");
	i.className = "odf-shell";
	let a = document.createElement("header");
	return o(a, "span", e.toUpperCase()), o(a, "h2", t), i.appendChild(a), n.forEach((e) => {
		let t = document.createElement("article");
		t.className = "odf-page", o(t, "h3", e.title), e.blocks.forEach((e) => o(t, "p", e)), i.appendChild(t);
	}), r.appendChild(i), r;
}, u = async () => {
	let t = await import("./RTFJS.bundle-DzN5MoeD.js").then((t) => /* @__PURE__ */ e(t.default, 1));
	return t.RTFJS || t.default || t;
}, d = async (e, t, n, r) => {
	var i, s;
	let c = await u();
	(i = c.loggingEnabled) == null || i.call(c, !1);
	let l = new c.Document(e, {}), d = l.metadata?.call(l) || {}, f = await l.render(), p = document.createElement("div");
	p.className = "flyfish-rtf-viewer";
	let m = document.createElement("div");
	m.className = "flyfish-rtf-header", o(m, "span", "RTF"), o(m, "strong", d.title || n("word.title.rtf"));
	let h = document.createElement("article");
	return h.className = "flyfish-rtf-paper", f.forEach((e) => h.appendChild(e)), p.append(m, h), t.replaceChildren(a(), p), (s = r?.registerThumbnailAdapter) == null || s.call(r, { getTarget: () => h }), {
		$el: t,
		unmount() {
			var e;
			(e = r?.registerThumbnailAdapter) == null || e.call(r, null), t.replaceChildren();
		}
	};
};
async function f(e, t, r, i) {
	var o;
	let s = n(i?.options), u = (r || "odt").toLowerCase();
	if (u === "rtf") return d(e, t, s, i);
	let f = await c(e, u, s), p = s(u === "odp" ? "word.title.openDocumentPresentation" : "word.title.openDocumentText");
	return t.replaceChildren(a(), l(u, p, f)), (o = i?.registerThumbnailAdapter) == null || o.call(i, { getTarget: () => t.querySelector(".odf-page") || t }), {
		$el: t,
		unmount() {
			var e;
			(e = i?.registerThumbnailAdapter) == null || e.call(i, null), t.replaceChildren();
		}
	};
}
export { f as default };
