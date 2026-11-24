import { r as e } from "./rolldown-runtime-QGRDbDUS.js";
import { t } from "./lib-ODMkZPnO.js";
import { a as n, c as r, i } from "./assets-zhNBPlbx.js";
import { d as a, i as o, m as s, r as c } from "./fit-OBfTsFJi.js";
import { i as l, n as u, r as d, t as f } from "./printLayout-Cc5MpfXo.js";
import { t as p } from "./messages-DuQwbmFt.js";
import { t as m } from "./options-LE2kKZFb.js";
import "./dist-BZCS2h0l.js";
// ../../node_modules/@file-viewer/renderer-word/dist/wordDocx.js
var h = /* @__PURE__ */ e(t(), 1), g = {
	width: 794,
	height: 1123
}, _ = /* @__PURE__ */ new Set([
	"file:",
	"about:",
	"data:"
]), v = .24, y = 3, b = .15, x = "0.3.26", S = 20555, C = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", w = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", T = "http://schemas.openxmlformats.org/package/2006/relationships", E = "urn:schemas-microsoft-com:vml", D = "word/document.xml", O = "word/_rels/document.xml.rels", k = "docx-page-background", ee = {
	bmp: "image/bmp",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	tif: "image/tiff",
	tiff: "image/tiff",
	webp: "image/webp"
}, A = (e) => {
	let t = typeof e.renderAsync == "function" ? e : e.default;
	if (!t || typeof t.renderAsync != "function") throw TypeError("@file-viewer/docx did not expose a compatible renderAsync function.");
	return t;
}, j = (() => {
	let e = {
		module: null,
		async load() {
			return this.module ||= import("./docx-preview-C1lzlDlE.js"), this.module;
		}
	};
	return async () => A(await e.load());
})(), M = (e) => e instanceof Error && /(?:undefined|null).*children|children.*(?:undefined|null)/i.test(e.message) && /renderHeaderFooter/i.test(e.stack || ""), N = async (e, t, n, r) => {
	try {
		return await e(t, n, void 0, r), !1;
	} catch (i) {
		if (!M(i)) throw i;
		return n.innerHTML = "", await e(t, n, void 0, {
			...r,
			renderHeaders: !1,
			renderFooters: !1
		}), !0;
	}
}, P = (e, t) => {
	if ((e.byteLength >= 4 ? new DataView(e).getUint16(0, !1) : 0) !== S) throw Error(p(t?.options)("word.error.invalidDocx"));
}, F = (e) => e.ownerDocument.defaultView, I = (e) => new ((F(e)?.DOMParser) ?? globalThis.DOMParser)(), L = (e) => {
	let t = [
		e.ownerDocument.URL,
		F(e)?.location?.href,
		globalThis.location?.href
	].filter(Boolean);
	for (let e of t) try {
		return new URL(e).protocol;
	} catch {}
	return "";
}, R = (e, t, n) => {
	let r = Array.from(e.getElementsByTagNameNS(t, n));
	return r.length ? r : Array.from(e.getElementsByTagName("*")).filter((e) => e.localName === n);
}, z = (e, t) => {
	let n = t.parseFromString(e, "application/xml");
	return R(n, "http://www.mozilla.org/newlayout/xml/parsererror.xml", "parsererror").length ? null : n;
}, B = (e, t) => {
	let n = t.startsWith("/") ? [] : e.split("/").slice(0, -1);
	return t.replace(/^\/+/, "").split("/").forEach((e) => {
		e && e !== "." && (e === ".." ? n.pop() : n.push(e));
	}), n.join("/");
}, V = (e) => ee[e.split(".").pop()?.toLowerCase() || ""], H = async (e, t = () => new DOMParser()) => {
	try {
		let n = await h.default.loadAsync(e), r = n.file(D), i = n.file(O);
		if (!r || !i) return;
		let a = t(), o = z(await r.async("string"), a), s = z(await i.async("string"), a);
		if (!o || !s) return;
		let c = R(o, C, "background")[0], l = c && R(c, E, "fill")[0], u = l?.getAttributeNS(w, "id") || l?.getAttribute("r:id");
		if (!u) return;
		let d = R(s, T, "Relationship").find((e) => e.getAttribute("Id") === u), f = d?.getAttribute("Target");
		if (!f || d?.getAttribute("TargetMode") === "External") return;
		let p = B(D, f), m = V(p), g = n.file(p) || n.file(decodeURIComponent(p));
		return !m || !g ? void 0 : `data:${m};base64,${await g.async("base64")}`;
	} catch {
		return;
	}
}, U = (e, t) => {
	if (!t) return 0;
	let n = 0;
	return e.querySelectorAll("section.docx").forEach((r) => {
		let i = Array.from(r.children).find((e) => e.classList.contains(k)), a = i || e.ownerDocument.createElement("div");
		a.className = k, a.setAttribute("aria-hidden", "true"), a.style.backgroundImage = `url("${t}")`, i || r.prepend(a), n += 1;
	}), n;
}, W = (e, t) => t?.worker === !1 ? !1 : t?.worker === !0 || !!((F(e)?.Worker ?? globalThis.Worker) && t?.workerUrl && !_.has(L(e))), G = (e) => {
	let t = F(e)?.matchMedia ?? globalThis.matchMedia;
	return typeof t == "function" && t("(prefers-color-scheme: dark)").matches;
}, K = (e, t, n) => {
	if (n?.darkMode !== void 0) return n.darkMode;
	let r = m(t?.options?.theme);
	return r === "dark" || r !== "light" && G(e);
}, q = (e, t) => !e || t ? e : `${e}${e.includes("?") ? "&" : "?"}file-viewer-docx=${x}`, J = (e, t) => {
	if (t === "allow") return 0;
	let n = 0;
	return e.querySelectorAll("a[href]").forEach((e) => {
		let t = e.getAttribute("href");
		t && !t.startsWith("#") && (e.hasAttribute("data-docx-external-href") || e.setAttribute("data-docx-external-href", t), e.removeAttribute("href"), e.setAttribute("aria-disabled", "true"), n += 1);
	}), n;
}, Y = (e, t, a) => {
	let o = t?.options?.docx, s = r(e.ownerDocument), c = W(e, o), l = o?.visualPagination === !0, u = K(e, t, o), d = (e) => {
		(e.phase === "render" || e.phase === "layout" || e.phase === "done") && a();
	}, f = o?.externalLinkPolicy ?? "block", p = {
		useWorker: c,
		breakPages: l,
		ignoreLastRenderedPageBreak: o?.ignoreLastRenderedPageBreak ?? !l,
		externalLinkPolicy: f,
		darkMode: u,
		progress: (t) => {
			(t.phase === "render" || t.phase === "layout" || t.phase === "done") && J(e, f), d(t);
		}
	};
	return c && (p.workerUrl = q(n(o, s), !!o?.workerUrl), p.workerJsZipUrl = q(i(o, s), !!o?.workerJsZipUrl)), o?.workerTimeout !== void 0 && (p.workerTimeout = o.workerTimeout), o?.renderPageBatchSize === void 0 ? o?.progressive === !1 && (p.renderPageBatchSize = 2 ** 53 - 1) : p.renderPageBatchSize = o.renderPageBatchSize, o?.renderYieldEveryMs !== void 0 && (p.renderYieldEveryMs = o.renderYieldEveryMs), o?.strictWordCompatibility !== void 0 && (p.strictWordCompatibility = o.strictWordCompatibility), o?.paginationTolerance !== void 0 && (p.paginationTolerance = o.paginationTolerance), o?.maxDynamicPaginationPasses !== void 0 && (p.maxDynamicPaginationPasses = o.maxDynamicPaginationPasses), o?.awaitLayout !== void 0 && (p.awaitLayout = o.awaitLayout), o?.preserveComplexFieldResults !== void 0 && (p.preserveComplexFieldResults = o.preserveComplexFieldResults), o?.updatePageReferences !== void 0 && (p.updatePageReferences = o.updatePageReferences), o?.hideWebHiddenContent !== void 0 && (p.hideWebHiddenContent = o.hideWebHiddenContent), p;
}, X = (e, t) => {
	let n = F(t)?.HTMLElement;
	return n ? e instanceof n : e instanceof HTMLElement;
}, te = "\n.docx-fit-viewer {\n  box-sizing: border-box;\n  height: 100%;\n  overflow: auto;\n  background: var(--file-viewer-render-surface-background, #ececec);\n  color-scheme: light;\n}\n.docx-fit-viewer[data-docx-dark-mode='true'] {\n  background: var(--file-viewer-render-surface-background, #242424);\n  color-scheme: dark;\n}\n.docx-fit-viewer .docx-wrapper {\n  box-sizing: border-box;\n  min-width: 0 !important;\n  width: 100% !important;\n  padding: 24px 14px 40px !important;\n  background: var(--file-viewer-render-surface-background, #e7e9ec) !important;\n}\n.docx-fit-viewer[data-docx-dark-mode='true'] .docx-wrapper {\n  background: var(--file-viewer-render-surface-background, #242424) !important;\n}\n.docx-fit-viewer .docx-page-frame {\n  position: relative;\n  width: 100%;\n  min-width: 0;\n  margin: 0 auto 24px;\n  overflow: visible;\n}\n.docx-fit-viewer .docx-flow-frame {\n  position: relative;\n  width: 100%;\n  min-width: 0;\n  margin: 0 auto 28px;\n  overflow: visible;\n}\n.docx-fit-viewer .docx-page-frame > section.docx,\n.docx-fit-viewer .docx-flow-frame > section.docx {\n  position: absolute;\n  top: 0;\n  left: 50%;\n  margin: 0 !important;\n  background: #ffffff !important;\n  box-shadow: 0 2px 14px rgba(25, 35, 48, 0.18);\n  box-sizing: border-box;\n  overflow: hidden;\n  transform-origin: top center;\n}\n.docx-fit-viewer .docx-page-background {\n  position: absolute;\n  inset: 0;\n  z-index: 0;\n  pointer-events: none;\n  background-position: center;\n  background-repeat: no-repeat;\n  background-size: 100% 100%;\n}\n.docx-fit-viewer[data-docx-dark-mode='true'] .docx-page-frame > section.docx,\n.docx-fit-viewer[data-docx-dark-mode='true'] .docx-flow-frame > section.docx {\n  background: rgb(51, 51, 51) !important;\n  box-shadow: 0 0 10px rgba(0, 0, 0, 0.8);\n  outline: 1px solid rgba(255, 255, 255, 0.15);\n  outline-offset: -1px;\n}\n.docx-fit-viewer .docx-flow-frame > section.docx {\n  height: auto !important;\n  min-height: var(--docx-page-height, auto) !important;\n  overflow: visible !important;\n}\n.docx-fit-viewer .docx-page-frame > section.docx > article,\n.docx-fit-viewer .docx-flow-frame > section.docx > article {\n  position: relative;\n  z-index: 1;\n}\n";
function ne(e) {
	let t = e.ownerDocument.createElement("style");
	return t.textContent = te, e.prepend(t), t;
}
function re(e, t) {
	let n = e.querySelector(".docx-wrapper");
	return n ? Array.from(n.children).flatMap((n) => {
		if (!X(n, e) || !n.matches("section.docx")) return [];
		let r = e.ownerDocument.createElement("div");
		return r.className = t ? "docx-page-frame" : "docx-flow-frame", n.before(r), r.appendChild(n), [r];
	}) : [];
}
function ie(e, t) {
	e.classList.add("docx-fit-viewer");
	let n = ne(e), r = t?.options?.docx?.visualPagination === !0, i = re(e, r), u = F(e), d = u?.ResizeObserver, f = 0, p = 1, m = 1, h = 1, _ = o(), x = (e) => Math.min(y, Math.max(v, Number(e.toFixed(2)))), S = () => {
		let t = m, n = h, a = !1;
		i.forEach((i) => {
			let o = i.firstElementChild;
			if (!X(o, e)) return;
			o.style.transform = "translateX(-50%)";
			let s = o.offsetWidth, c = r ? o.offsetHeight : Math.max(o.scrollHeight, o.offsetHeight);
			if (!s || !c) return;
			let l = Math.max(e.clientWidth - 28, 120), u = Math.min(1, Math.max(v, l / s)), d = x(u * p);
			a ||= (t = d, n = u, !0), o.style.transform = `translateX(-50%) scale(${d})`, i.style.width = `${Math.ceil(Math.max(s * d, e.clientWidth - 28, 120))}px`, i.style.maxWidth = "none", i.style.height = `${Math.ceil(c * d)}px`;
		}), a && (m = t, h = n, _.emit());
	}, C = () => {
		u ? (u.cancelAnimationFrame(f), f = u.requestAnimationFrame(() => {
			S();
		})) : S();
	}, w = () => ({
		scale: m,
		label: `${Math.round(m * 100)}%`,
		canZoomIn: m < y,
		canZoomOut: m > v,
		canReset: p !== 1,
		minScale: v,
		maxScale: y
	}), T = (e) => (p = Math.min(6, Math.max(.2, Number(e.toFixed(2)))), u?.cancelAnimationFrame(f), S(), w()), E = (e) => T(e / Math.max(h, .01)), D = () => {
		for (let e of i) {
			let t = Z(e);
			if (!t) continue;
			let n = l(t, g);
			return {
				width: t.offsetWidth || n.width || g.width,
				height: Q(e) ? g.height : t.offsetHeight || n.height || g.height
			};
		}
		return null;
	}, O = (t) => {
		let n = D();
		if (!n) return {
			applied: !1,
			mode: t.mode,
			resize: t.resize,
			source: t.source,
			reason: "unmeasurable",
			provider: "zoom"
		};
		let r = t.mode === "auto" ? "width" : t.mode, i = c({
			mode: r,
			viewportWidth: Math.max(1, t.viewportWidth || e.clientWidth || 0),
			viewportHeight: Math.max(1, t.viewportHeight || e.clientHeight || 0),
			contentWidth: n.width,
			contentHeight: n.height,
			currentScale: m,
			minScale: t.minScale ?? v,
			maxScale: t.maxScale ?? y
		});
		if (!i) return {
			applied: !1,
			mode: t.mode,
			resize: t.resize,
			source: t.source,
			reason: "unmeasurable",
			provider: "zoom"
		};
		let a = E(i);
		return {
			applied: !0,
			mode: t.mode,
			resize: t.resize,
			scale: a.scale,
			source: t.source,
			provider: "zoom"
		};
	};
	e.dataset.viewerZoomProvider = "docx", a(e, {
		zoomIn: () => T((m + b) / Math.max(h, .01)),
		zoomOut: () => T((m - b) / Math.max(h, .01)),
		resetZoom: () => T(1),
		setZoom: E,
		fit: O,
		getState: w,
		subscribe: _.subscribe
	});
	let k = d ? new d(C) : null;
	return k?.observe(e), i.forEach((e) => {
		let t = Z(e);
		t && k?.observe(t);
	}), S(), () => {
		u?.cancelAnimationFrame(f), k?.disconnect(), s(e), n.remove(), e.classList.remove("docx-fit-viewer");
	};
}
function Z(e) {
	let t = e.firstElementChild, n = e.ownerDocument.defaultView?.HTMLElement;
	return n && t instanceof n ? t : null;
}
function Q(e) {
	return !!e?.classList.contains("docx-flow-frame");
}
function $(e) {
	let t = e ? Z(e) : null;
	if (!t) return g;
	let n = l(t, g);
	return Q(e) ? {
		width: n.width,
		height: Math.max(t.scrollHeight || 0, t.offsetHeight || 0, g.height)
	} : n;
}
function ae(e, t) {
	let n = Q(e), r = d(t.width), i = d(t.height);
	f(e, t, { heightMode: n ? "min" : "fixed" }), e.style.margin = "0 auto 18px";
	let a = Z(e);
	a && (a.style.position = "relative", a.style.top = "auto", a.style.left = "auto", a.style.width = r, a.style.maxWidth = "none", a.style.minHeight = n ? "0" : i, a.style.height = n ? "auto" : i, a.style.margin = "0 auto", a.style.transform = "none", a.style.transformOrigin = "top left", a.style.overflow = n ? "visible" : "hidden", a.style.boxShadow = "none");
}
function oe(e) {
	let t = e.querySelector(".docx-page-frame, .docx-flow-frame"), n = $(t || void 0), r = t?.classList.contains("docx-flow-frame") ? ".viewer-export-content .docx-flow-frame" : ".viewer-export-content .docx-page-frame";
	return u({
		selector: r,
		width: n.width,
		height: t?.classList.contains("docx-flow-frame") ? g.height : n.height,
		heightMode: t?.classList.contains("docx-flow-frame") ? "min" : "fixed"
	});
}
function se(e) {
	let t = Array.from(e.querySelectorAll(".docx-page-frame, .docx-flow-frame")), n = e.cloneNode(!0), r = e.ownerDocument.createElement("div");
	r.className = "docx-print-document";
	let i = Array.from(n.querySelectorAll("style")).filter((e) => !e.textContent?.includes(".docx-fit-viewer")).map((e) => e.outerHTML).join("");
	return n.querySelectorAll(".docx-page-frame, .docx-flow-frame").forEach((e, n) => {
		e.dataset.viewerPrintPageIndex = String(n), ae(e, $(t[n])), r.appendChild(e.cloneNode(!0));
	}), r.childElementCount ? `${i}${r.outerHTML}` : n.innerHTML;
}
async function ce(e, t, n) {
	var r, i;
	P(e, n), t.innerHTML = "";
	let a = !1, o = () => {
		var e;
		a || (a = !0, (e = n?.onProgressiveRender) == null || e.call(n));
	}, s = Y(t, n, o), [{ defaultOptions: c, renderAsync: l }, u] = await Promise.all([j(), H(e, () => I(t))]);
	t.dataset.docxWorker = s.useWorker ? "self" : "false", t.dataset.docxDarkMode = s.darkMode ? "true" : "false";
	let d = await N(l, e, t, {
		...c,
		...s
	});
	J(t, s.externalLinkPolicy), t.dataset.docxHeaderFooterFallback = d ? "true" : "false", t.dataset.docxPageBackground = U(t, u) > 0 ? "true" : "false", o();
	let f = ie(t, n);
	return (r = n?.registerExportAdapter) == null || r.call(n, {
		includeDocumentStyles: !1,
		getPrintMaskPages: () => Array.from(t.querySelectorAll(".docx-page-frame, .docx-flow-frame")),
		beforeSnapshot: () => {
			let e = F(t);
			e && e.dispatchEvent(new e.Event("resize"));
		},
		printStyle: () => oe(t),
		toHtml: () => se(t)
	}), (i = n?.registerThumbnailAdapter) == null || i.call(n, { getTarget: () => t.querySelector(".docx-page-frame, .docx-flow-frame") || t }), {
		$el: t,
		unmount() {
			var e, r;
			(e = n?.registerExportAdapter) == null || e.call(n, null), (r = n?.registerThumbnailAdapter) == null || r.call(n, null), f(), delete t.dataset.docxWorker, delete t.dataset.docxDarkMode, delete t.dataset.docxHeaderFooterFallback, delete t.dataset.docxPageBackground, t.innerHTML = "";
		}
	};
}
export { ce as default };
