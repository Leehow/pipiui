import { n as e, t, u as n } from "./assets-zhNBPlbx.js";
import { C as r, D as i, E as a, O as o, S as s, T as c, _ as l, a as u, d, f, g as p, h as m, l as h, m as g, n as _, o as v, p as ee, r as te, s as ne, t as re, v as ie, w as y } from "./dist-BZCS2h0l.js";
import { t as ae } from "./messages-DuQwbmFt.js";
import { i as oe, n as se, r as ce, t as le } from "./options-LE2kKZFb.js";
import { Component as ue, forwardRef as b, useCallback as x, useEffect as S, useImperativeHandle as C, useMemo as w, useRef as T } from "react";
import { jsx as E } from "react/jsx-runtime";
// ../../node_modules/@file-viewer/core/dist/browser/controller.js
var de = () => typeof window < "u" && typeof document < "u", fe = (e = {}) => !!(e.url || e.file || e.buffer), D = (e = {}) => ({
	url: e.url,
	file: e.file,
	buffer: e.buffer,
	filename: e.filename || e.name,
	name: e.name,
	type: e.type,
	size: e.size
}), O = () => typeof fetch == "function", k = async ({ url: e, signal: t }) => {
	if (!O()) throw Error("fetch is not available in the current environment.");
	let n = h(e) || e, r = await fetch(n, { signal: t });
	if (!r.ok) throw Error(`Failed to fetch file: ${r.status} ${r.statusText}`);
	return r.blob();
}, pe = (e) => y(e.filename || e.name || a({
	file: e.file,
	url: e.url,
	fallback: "preview.bin"
}), e.type ? `preview.${e.type}` : s), me = async (e, t = {}) => {
	let n = pe(e), a = e.type || r(n);
	if (e.buffer) return {
		buffer: e.buffer,
		filename: n,
		type: a,
		size: e.size ?? e.buffer.byteLength,
		url: e.url
	};
	if (e.file) {
		let t = i(e.file, n);
		return {
			file: t,
			buffer: await c(t),
			filename: t.name || n,
			type: a || r(t.name),
			size: e.size ?? t.size,
			url: e.url
		};
	}
	if (e.url) {
		let o = await (t.fetchFile || k)({
			url: e.url,
			signal: t.signal,
			source: e
		});
		if (!o) throw Error("Downloaded file is empty.");
		let s = i(o, n);
		return {
			file: s,
			buffer: await c(s),
			filename: s.name || n,
			type: a || r(s.name),
			size: e.size ?? s.size,
			url: e.url
		};
	}
	return {
		filename: n,
		type: a
	};
}, he = (e, t) => ({
	load(t) {
		return e()?.load(t) ?? Promise.resolve();
	},
	update(t) {
		return e()?.update(t) ?? Promise.resolve();
	},
	reload() {
		return e()?.reload() ?? Promise.resolve();
	},
	destroy() {
		t();
	},
	getController: e,
	getApi() {
		return e()?.getApi() ?? null;
	},
	downloadOriginalFile() {
		return e()?.downloadOriginalFile() ?? Promise.resolve();
	},
	printRenderedHtml(t) {
		return e()?.printRenderedHtml(t) ?? Promise.resolve();
	},
	printWithMask(t) {
		return e()?.printWithMask(t) ?? Promise.resolve();
	},
	exportRenderedHtml() {
		return e()?.exportRenderedHtml() ?? Promise.resolve();
	},
	zoomIn() {
		return e()?.zoomIn() ?? Promise.resolve(null);
	},
	zoomOut() {
		return e()?.zoomOut() ?? Promise.resolve(null);
	},
	resetZoom() {
		return e()?.resetZoom() ?? Promise.resolve(null);
	},
	fitToView(t) {
		return e()?.fitToView(t) ?? Promise.resolve(null);
	},
	getViewState() {
		return e()?.getViewState() ?? null;
	},
	applyViewState(t, n) {
		return e()?.applyViewState(t, n) ?? Promise.resolve(null);
	},
	searchDocument(t) {
		return e()?.searchDocument(t) ?? Promise.resolve(null);
	},
	clearDocumentSearch() {
		return e()?.clearDocumentSearch() ?? Promise.resolve(null);
	},
	nextSearchResult() {
		return e()?.nextSearchResult() ?? Promise.resolve(null);
	},
	previousSearchResult() {
		return e()?.previousSearchResult() ?? Promise.resolve(null);
	},
	collectDocumentAnchors() {
		return e()?.collectDocumentAnchors() ?? Promise.resolve([]);
	},
	scrollToAnchor(t) {
		return e()?.scrollToAnchor(t) ?? Promise.resolve(!1);
	},
	scrollToLine(t) {
		return e()?.scrollToLine(t) ?? Promise.resolve(!1);
	},
	getDocumentTextChunks() {
		return e()?.getDocumentTextChunks() ?? [];
	},
	getOperationAvailability() {
		return e()?.getOperationAvailability() ?? null;
	},
	getZoomState() {
		return e()?.getZoomState() ?? null;
	},
	getSearchState() {
		return e()?.getSearchState() ?? null;
	},
	getState() {
		return e()?.getState() ?? null;
	},
	subscribe(t) {
		return e()?.subscribe(t) ?? (() => {});
	}
}), A = async (e, t, n) => e ? t(e) : n, ge = (e) => !!(e && typeof e == "object" && e.name === "AbortError"), _e = {
	download: !1,
	print: !1,
	exportHtml: !1,
	zoom: !1,
	zoomIn: !1,
	zoomOut: !1,
	zoomReset: !1
}, ve = {
	scale: 1,
	label: "100%",
	canZoomIn: !1,
	canZoomOut: !1,
	canReset: !1
}, ye = /* @__PURE__ */ new WeakMap(), be = "\n:host,.file-viewer-web-shell{display:block;width:100%;height:100%;min-width:0;min-height:0;contain:content;--file-viewer-bg:transparent;--file-viewer-content-bg:transparent;--file-viewer-text:#172033;--file-viewer-muted:#607282;--file-viewer-font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;--file-viewer-border:rgba(20,35,53,.08);--file-viewer-toolbar-bg:rgba(255,255,255,.92);--file-viewer-toolbar-border:rgba(20,35,53,.06);--file-viewer-toolbar-shadow:0 18px 44px rgba(15,23,42,.16);--file-viewer-toolbar-radius:999px;--file-viewer-toolbar-gap:6px;--file-viewer-toolbar-min-height:45px;--file-viewer-toolbar-padding:6px 10px;--file-viewer-toolbar-floating-min-height:42px;--file-viewer-toolbar-floating-padding:6px;--file-viewer-toolbar-floating-offset:16px;--file-viewer-group-bg:rgba(20,35,53,.035);--file-viewer-group-border:rgba(20,35,53,.08);--file-viewer-group-gap:2px;--file-viewer-group-padding:2px;--file-viewer-button-color:#40546a;--file-viewer-button-hover-bg:rgba(33,163,102,.1);--file-viewer-button-hover-color:#16774c;--file-viewer-button-disabled-color:#aab5c0;--file-viewer-button-radius:8px;--file-viewer-button-min-width:42px;--file-viewer-button-height:30px;--file-viewer-button-padding:0 10px;--file-viewer-icon-button-size:30px;--file-viewer-zoom-meter-min-width:48px;--file-viewer-zoom-meter-padding:0 8px;--file-viewer-floating-button-min-width:48px;--file-viewer-floating-button-height:32px;--file-viewer-floating-icon-button-size:32px;--file-viewer-floating-zoom-meter-min-width:54px;--file-viewer-search-input-height:30px;--file-viewer-search-input-padding:0 10px;--file-viewer-search-button-min-width:32px;--file-viewer-search-button-padding:0 8px;--file-viewer-search-count-min-width:42px;--file-viewer-floating-search-input-height:32px;--file-viewer-focus-ring:rgba(31,157,103,.22);--file-viewer-z-toolbar:20;--file-viewer-z-floating-toolbar:30}\n:host([theme='dark']),.file-viewer-web-shell[data-viewer-theme='dark']{--file-viewer-bg:#0f1720;--file-viewer-content-bg:#111b24;--file-viewer-text:#e5eef8;--file-viewer-muted:#cbd5e1;--file-viewer-border:rgba(148,163,184,.18);--file-viewer-toolbar-bg:rgba(15,23,42,.9);--file-viewer-toolbar-border:rgba(148,163,184,.18);--file-viewer-group-bg:rgba(148,163,184,.1);--file-viewer-group-border:rgba(148,163,184,.16);--file-viewer-button-color:#d7dee8;--file-viewer-button-hover-bg:rgba(45,212,191,.14);--file-viewer-button-hover-color:#5eead4;--file-viewer-button-disabled-color:#64748b;--file-viewer-input-bg:rgba(15,23,42,.78);--file-viewer-input-color:#f8fafc}\n.file-viewer-web-shell,.file-viewer-web-shell *,.file-viewer-web-shell *::before,.file-viewer-web-shell *::after{box-sizing:border-box}\n.file-viewer-web-shell{position:relative;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--file-viewer-render-surface-background,var(--file-viewer-bg));color:var(--file-viewer-text);font:var(--file-viewer-font);letter-spacing:0;box-sizing:border-box;contain:content}\n.file-viewer-web-shell[data-viewer-density=\"compact\"]{--file-viewer-toolbar-gap:3px;--file-viewer-toolbar-min-height:34px;--file-viewer-toolbar-padding:3px 5px;--file-viewer-toolbar-floating-min-height:32px;--file-viewer-toolbar-floating-padding:3px;--file-viewer-toolbar-floating-offset:10px;--file-viewer-group-gap:2px;--file-viewer-group-padding:2px;--file-viewer-button-radius:6px;--file-viewer-button-min-width:34px;--file-viewer-button-height:26px;--file-viewer-button-padding:0 6px;--file-viewer-icon-button-size:26px;--file-viewer-zoom-meter-min-width:42px;--file-viewer-zoom-meter-padding:0 5px;--file-viewer-floating-button-min-width:38px;--file-viewer-floating-button-height:28px;--file-viewer-floating-icon-button-size:28px;--file-viewer-floating-zoom-meter-min-width:46px;--file-viewer-search-input-height:26px;--file-viewer-search-input-padding:0 8px;--file-viewer-search-button-min-width:28px;--file-viewer-search-button-padding:0 6px;--file-viewer-search-count-min-width:36px;--file-viewer-floating-search-input-height:28px}\n.file-viewer-web-content{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;background:var(--file-viewer-render-surface-background,var(--file-viewer-content-bg))}\n.file-viewer-web-toolbar{flex:0 0 auto;min-height:var(--file-viewer-toolbar-min-height);display:inline-flex;align-items:center;justify-content:flex-end;gap:var(--file-viewer-toolbar-gap);padding:var(--file-viewer-toolbar-padding);border-bottom:1px solid var(--file-viewer-toolbar-border);background:var(--file-viewer-toolbar-bg);box-sizing:border-box;z-index:var(--file-viewer-z-toolbar)}\n.file-viewer-web-toolbar[hidden]{display:none!important}\n.file-viewer-web-toolbar[data-toolbar-position=\"top-center\"]{justify-content:center}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"]{position:absolute;right:calc(var(--file-viewer-toolbar-floating-offset) + env(safe-area-inset-right,0px));bottom:calc(var(--file-viewer-toolbar-floating-offset) + env(safe-area-inset-bottom,0px));min-height:var(--file-viewer-toolbar-floating-min-height);padding:var(--file-viewer-toolbar-floating-padding);border:1px solid var(--file-viewer-border);border-radius:var(--file-viewer-toolbar-radius);background:var(--file-viewer-toolbar-bg);box-shadow:var(--file-viewer-toolbar-shadow);backdrop-filter:blur(16px);z-index:var(--file-viewer-z-floating-toolbar)}\n.file-viewer-web-toolbar-group{display:inline-flex;align-items:center;gap:var(--file-viewer-group-gap);padding:var(--file-viewer-group-padding);border:1px solid var(--file-viewer-group-border);border-radius:var(--file-viewer-toolbar-radius);background:var(--file-viewer-group-bg)}\n.file-viewer-web-toolbar button{min-width:var(--file-viewer-button-min-width);height:var(--file-viewer-button-height);padding:var(--file-viewer-button-padding);border:0;border-radius:var(--file-viewer-button-radius);background:transparent;color:var(--file-viewer-button-color);font:inherit;font-size:12px;font-weight:800;line-height:1;letter-spacing:0;white-space:nowrap;cursor:pointer}\n.file-viewer-web-toolbar button:hover:not(:disabled){background:var(--file-viewer-button-hover-bg);color:var(--file-viewer-button-hover-color)}\n.file-viewer-web-toolbar button:disabled{color:var(--file-viewer-button-disabled-color);cursor:not-allowed}\n.file-viewer-web-toolbar .file-viewer-web-icon-button{width:var(--file-viewer-icon-button-size);min-width:var(--file-viewer-icon-button-size);padding:0;display:inline-flex;align-items:center;justify-content:center}\n.file-viewer-web-theme-button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\n.file-viewer-web-toolbar .file-viewer-web-zoom-meter{min-width:var(--file-viewer-zoom-meter-min-width);height:var(--file-viewer-button-height);padding:var(--file-viewer-zoom-meter-padding);display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;color:var(--file-viewer-button-color)}\n.file-viewer-web-toolbar .file-viewer-web-zoom-meter--readonly{font-size:12px;font-weight:800;line-height:1;white-space:nowrap}\n.file-viewer-web-print-menu{position:relative;display:inline-flex}\n.file-viewer-web-print-menu > button{min-width:var(--file-viewer-button-min-width);height:var(--file-viewer-button-height);padding:var(--file-viewer-button-padding);border:0;border-radius:var(--file-viewer-button-radius);background:transparent;color:var(--file-viewer-button-color);font:inherit;font-size:12px;font-weight:800;line-height:1;letter-spacing:0;white-space:nowrap;cursor:pointer}\n.file-viewer-web-print-menu > button:hover:not(:disabled){background:var(--file-viewer-button-hover-bg);color:var(--file-viewer-button-hover-color)}\n.file-viewer-web-print-menu > button:disabled{color:var(--file-viewer-button-disabled-color);cursor:not-allowed}\n.file-viewer-web-print-menu-panel{position:absolute;top:calc(100% + 4px);right:0;z-index:40;min-width:118px;padding:4px;border:1px solid var(--file-viewer-group-border);border-radius:10px;background:var(--file-viewer-toolbar-bg);box-shadow:var(--file-viewer-toolbar-shadow);display:none;flex-direction:column;gap:2px}\n.file-viewer-web-print-menu[data-open=\"true\"] .file-viewer-web-print-menu-panel{display:flex}\n.file-viewer-web-print-menu-panel button{width:100%;min-width:0;justify-content:flex-start;text-align:left;border-radius:8px}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] .file-viewer-web-print-menu-panel{top:auto;bottom:calc(100% + 6px);z-index:50}\n.file-viewer-web-search{gap:4px}\n.file-viewer-web-search input{width:clamp(128px,18vw,220px);height:var(--file-viewer-search-input-height);box-sizing:border-box;border:0;border-radius:var(--file-viewer-toolbar-radius);padding:var(--file-viewer-search-input-padding);background:var(--file-viewer-input-bg);color:var(--file-viewer-input-color);font:inherit;font-size:12px;line-height:var(--file-viewer-search-input-height);letter-spacing:0;outline:0}\n.file-viewer-web-search input:focus{box-shadow:0 0 0 2px var(--file-viewer-focus-ring)}\n.file-viewer-web-search button{min-width:var(--file-viewer-search-button-min-width);height:var(--file-viewer-search-input-height);padding:var(--file-viewer-search-button-padding);border-radius:999px}\n.file-viewer-web-search-count{min-width:var(--file-viewer-search-count-min-width);text-align:center;color:var(--file-viewer-muted);font-size:12px;font-weight:800;line-height:var(--file-viewer-search-input-height);white-space:nowrap}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] button{min-width:var(--file-viewer-floating-button-min-width);height:var(--file-viewer-floating-button-height);border-radius:999px}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] .file-viewer-web-icon-button{width:var(--file-viewer-floating-icon-button-size);min-width:var(--file-viewer-floating-icon-button-size)}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] .file-viewer-web-zoom-meter{min-width:var(--file-viewer-floating-zoom-meter-min-width);height:var(--file-viewer-floating-button-height)}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] .file-viewer-web-search button{min-width:var(--file-viewer-search-button-min-width);height:var(--file-viewer-floating-search-input-height)}\n.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] .file-viewer-web-search input{height:var(--file-viewer-floating-search-input-height);line-height:var(--file-viewer-floating-search-input-height);width:clamp(120px,18vw,190px)}\n.file-viewer-web-shell[data-viewer-theme='dark']{color-scheme:dark;--file-viewer-bg:#0f1720;--file-viewer-content-bg:#111b24;--file-viewer-text:#e5eef8;--file-viewer-muted:#cbd5e1;--file-viewer-border:rgba(148,163,184,.18);--file-viewer-toolbar-bg:rgba(15,23,42,.9);--file-viewer-toolbar-border:rgba(148,163,184,.18);--file-viewer-group-bg:rgba(148,163,184,.1);--file-viewer-group-border:rgba(148,163,184,.16);--file-viewer-button-color:#d7dee8;--file-viewer-button-hover-bg:rgba(45,212,191,.14);--file-viewer-button-hover-color:#5eead4;--file-viewer-button-disabled-color:#64748b;--file-viewer-input-bg:rgba(15,23,42,.78);--file-viewer-input-color:#f8fafc}\n@media (prefers-color-scheme:dark){.file-viewer-web-shell[data-viewer-theme='system']{color-scheme:dark;--file-viewer-bg:#0f1720;--file-viewer-content-bg:#111b24;--file-viewer-text:#e5eef8;--file-viewer-muted:#cbd5e1;--file-viewer-border:rgba(148,163,184,.18);--file-viewer-toolbar-bg:rgba(15,23,42,.9);--file-viewer-toolbar-border:rgba(148,163,184,.18);--file-viewer-group-bg:rgba(148,163,184,.1);--file-viewer-group-border:rgba(148,163,184,.16);--file-viewer-button-color:#d7dee8;--file-viewer-button-hover-bg:rgba(45,212,191,.14);--file-viewer-button-hover-color:#5eead4;--file-viewer-button-disabled-color:#64748b;--file-viewer-input-bg:rgba(15,23,42,.78);--file-viewer-input-color:#f8fafc}}\n@media (max-width:640px){.file-viewer-web-toolbar{max-width:100%;overflow-x:auto;overflow-y:visible}.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"]{max-width:calc(100% - 32px);overflow:visible}.file-viewer-web-toolbar[data-toolbar-position=\"bottom-right\"] .file-viewer-web-print-menu-panel{left:50%;right:auto;transform:translateX(-50%);min-width:min(148px,calc(100vw - 32px))}.file-viewer-web-search input{width:120px}}\n", j = (e, ...t) => {
	let n = e.part;
	if (n?.add) {
		n.add(...t);
		return;
	}
	let r = /* @__PURE__ */ new Set([...(e.getAttribute("part") || "").split(/\s+/).filter(Boolean), ...t]);
	e.setAttribute("part", [...r].join(" "));
}, M = (e, t, n, r) => {
	let i = e.createElement("button");
	return i.type = "button", i.className = n, j(i, "button"), i.textContent = t, i.title = t, i.setAttribute("aria-label", t), i.addEventListener("click", () => {
		r();
	}), i;
}, xe = (e, t, n) => {
	let r = e.createElement("span");
	return r.className = `${n} file-viewer-web-zoom-meter--readonly`, j(r, "button"), r.textContent = t, r.title = t, r.setAttribute("aria-label", t), r;
}, Se = (e, t) => {
	e.innerHTML = t === "dark" ? "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41\"/></svg>" : "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z\"/></svg>";
}, N = (e, t = {}, n = {}) => {
	var i, a;
	if (!de()) throw Error("Flyfish File Viewer can only be mounted in a browser DOM environment.");
	let o = e.ownerDocument, c = v(t.options?.styleIsolation), h = c === "auto" || c === "shadow", _ = e.shadowRoot, ie = ye.get(e), y = !!(_ && ie === _), ue = typeof e.attachShadow == "function" && !e.shadowRoot, b = null, x = e;
	if (h && y && _) x = _;
	else if (h && ue) try {
		x = e.attachShadow({
			mode: "open",
			delegatesFocus: !0
		}), ye.set(e, x);
	} catch {
		x = e;
	}
	else if (_ && !y) {
		if (b = o.createElement("div"), b.dataset.fileViewerMountBoundary = "true", _.appendChild(b), h && typeof b.attachShadow == "function") try {
			x = b.attachShadow({
				mode: "open",
				delegatesFocus: !0
			});
		} catch {
			x = b;
		}
		else x = b;
	} else if (!h && y && _) {
		let t = o.createElement("slot");
		t.dataset.fileViewerLightDomSlot = "true", _.replaceChildren(t), x = e;
	}
	x.replaceChildren();
	let S = te(x, be, { adoptedStyleSheet: u(x) }), C = o.createElement("div");
	C.className = "file-viewer-web-shell", j(C, "shell");
	let w = o.createElement("div");
	w.className = "file-viewer-web-toolbar", j(w, "toolbar");
	let T = o.createElement("div");
	T.className = "file-viewer-web-content", j(T, "content"), T.dataset.viewerScrollContainer = "true", C.append(w, T), x.appendChild(C);
	let E = !1, O = t, k = ((i = o.defaultView)?.matchMedia)?.call(i, "(prefers-color-scheme: dark)") ?? null, he = (e) => k ? ce(e, k.matches) : ce(e), N = fe(O) ? D(O) : null, P = null, F = /* @__PURE__ */ new Set(), I = {
		loading: !1,
		ready: !1,
		error: null,
		lastEvent: null,
		lifecycle: null,
		availability: null,
		search: null,
		zoom: null,
		location: null,
		viewState: null
	}, L = () => I.lifecycle?.type ? I.lifecycle.type : N ? r(pe(N)) : "", R = () => I.zoom || Y.getZoomState() || ve, z = () => l(I.availability || Y.getCapabilities() || _e, R()), B = () => ({
		...I,
		availability: z(),
		search: I.search ? {
			...I.search,
			matches: [...I.search.matches]
		} : null,
		zoom: I.zoom ? { ...I.zoom } : null,
		location: I.location ? { ...I.location } : null,
		viewState: I.viewState ? {
			...I.viewState,
			zoom: I.viewState.zoom ? { ...I.viewState.zoom } : void 0,
			scroll: I.viewState.scroll ? { ...I.viewState.scroll } : void 0,
			navigation: I.viewState.navigation ? { ...I.viewState.navigation } : void 0,
			extra: I.viewState.extra ? { ...I.viewState.extra } : void 0
		} : null
	}), Ce = () => {
		C.dataset.viewerTheme = le(O.options?.theme), C.dataset.viewerDensity = se(O.options?.ui?.density), ne(C, O.options);
	}, V = null, H = "", U = (e, t) => e.search === !1 || t.search === !1 || !I.ready || I.loading || I.error || T.querySelector(".file-viewer-missing-renderer") ? !1 : !!Y.getRenderer(L())?.capabilities?.search, W = () => {
		if (E) return;
		Ce();
		let e = O.options || {}, t = ee(e), n = z(), r = U(t, e), i = p(t, n, r), a = d(i), s = m(e, L()), c = I.loading || !!I.error, l = R(), u = ae(e);
		if (w.hidden = !a, w.dataset.toolbarPosition = s, w.replaceChildren(), !a) return;
		let h = () => {
			if (!r) return;
			let e = I.search, t = e?.total ?? 0, n = t > 0 ? (e?.currentIndex ?? -1) + 1 : 0, i = o.createElement("form");
			i.className = "file-viewer-web-toolbar-group file-viewer-web-search", j(i, "toolbar-group"), i.setAttribute("role", "search"), i.setAttribute("aria-label", u("toolbar.search"));
			let a = o.createElement("input");
			a.type = "search", j(a, "input"), a.value = H, a.placeholder = u("toolbar.searchPlaceholder"), a.title = u("toolbar.searchPlaceholder"), a.setAttribute("aria-label", u("toolbar.searchPlaceholder")), a.disabled = c, a.addEventListener("input", () => {
				H = a.value;
			});
			let s = o.createElement("button");
			s.type = "submit", j(s, "button"), s.textContent = u("toolbar.search"), s.title = u("toolbar.search"), s.setAttribute("aria-label", u("toolbar.search")), s.disabled = c;
			let l = M(o, "<", "file-viewer-web-icon-button", () => V?.previousSearchResult());
			l.title = u("toolbar.searchPrevious"), l.setAttribute("aria-label", u("toolbar.searchPrevious")), l.disabled = c || t < 1;
			let d = M(o, ">", "file-viewer-web-icon-button", () => V?.nextSearchResult());
			d.title = u("toolbar.searchNext"), d.setAttribute("aria-label", u("toolbar.searchNext")), d.disabled = c || t < 1;
			let f = M(o, "x", "file-viewer-web-icon-button", async () => {
				H = "", await V?.clearDocumentSearch();
			});
			f.title = u("toolbar.searchClear"), f.setAttribute("aria-label", u("toolbar.searchClear")), f.disabled = c || !H && !e?.query;
			let p = o.createElement("span");
			p.className = "file-viewer-web-search-count", j(p, "toolbar-status"), p.textContent = `${n}/${t}`, p.setAttribute("aria-live", "polite"), i.addEventListener("submit", (e) => {
				e.preventDefault(), H = a.value;
				let t = H.trim();
				t ? V?.searchDocument(t) : V?.clearDocumentSearch();
			}), i.append(a, s, l, d, f, p), w.appendChild(i);
		}, _ = () => {
			if (!i.zoom) return;
			let e = o.createElement("div");
			if (e.className = "file-viewer-web-toolbar-group", j(e, "toolbar-group"), e.setAttribute("aria-label", u("toolbar.zoomGroup")), n.zoomOut) {
				let t = M(o, "-", "file-viewer-web-icon-button", () => V?.zoomOut());
				t.title = u("toolbar.zoomOut"), t.setAttribute("aria-label", u("toolbar.zoomOut")), t.disabled = f({
					action: "canZoomOut",
					availability: n,
					toolbarDisabled: c,
					zoomState: l
				}), e.appendChild(t);
			}
			if (n.zoomReset) {
				let t = M(o, l.label, "file-viewer-web-zoom-meter", () => V?.resetZoom());
				t.title = u("toolbar.zoomReset"), t.disabled = f({
					action: "canReset",
					availability: n,
					toolbarDisabled: c,
					zoomState: l
				}), e.appendChild(t);
			} else e.appendChild(xe(o, l.label, "file-viewer-web-zoom-meter"));
			if (n.zoomReset) {
				let t = M(o, "1:1", "file-viewer-web-icon-button", () => V?.resetZoom());
				t.title = u("toolbar.zoomReset"), t.setAttribute("aria-label", u("toolbar.zoomReset")), t.disabled = f({
					action: "canReset",
					availability: n,
					toolbarDisabled: c,
					zoomState: l
				}), e.appendChild(t);
			}
			if (n.zoomIn) {
				let t = M(o, "+", "file-viewer-web-icon-button", () => V?.zoomIn());
				t.title = u("toolbar.zoomIn"), t.setAttribute("aria-label", u("toolbar.zoomIn")), t.disabled = f({
					action: "canZoomIn",
					availability: n,
					toolbarDisabled: c,
					zoomState: l
				}), e.appendChild(t);
			}
			e.childElementCount && w.appendChild(e);
		}, v = (e, t, n, r) => {
			if (!e) return;
			let i = M(o, t, "", r);
			i.title = n, i.disabled = c, w.appendChild(i);
		}, te = () => {
			if (!i.theme) return;
			let t = he(e.theme), n = u(t === "dark" ? "toolbar.themeToLight" : "toolbar.themeToDark"), r = M(o, "", "file-viewer-web-icon-button file-viewer-web-theme-button", async () => {
				let e = Y.getViewState(), t = oe(O.options?.theme, k?.matches);
				O = {
					...O,
					options: {
						...O.options || {},
						theme: t
					}
				}, Y.updateOptions({ theme: t }), J({
					type: "theme-change",
					payload: t
				}), N && await Z(N).catch(() => null) && e && await Y.applyViewState(e, {
					action: "restore",
					source: "api"
				});
			});
			j(r, "theme-toggle"), Se(r, t), r.title = n, r.setAttribute("aria-label", n), r.setAttribute("aria-pressed", String(t === "dark")), r.disabled = c, w.appendChild(r);
		};
		g(t).forEach((e) => {
			if (e === "search") h();
			else if (e === "zoom") _();
			else if (e === "download") v(i.download, u("toolbar.download"), u("toolbar.downloadTitle"), () => V?.downloadOriginalFile());
			else if (e === "print") {
				if (!i.print) return;
				let e = o.createElement("div");
				e.className = "file-viewer-web-print-menu", j(e, "toolbar-group");
				let t = M(o, u("toolbar.print"), "", () => {
					e.dataset.open = e.dataset.open === "true" ? "false" : "true";
				});
				t.title = u("toolbar.printTitle"), t.setAttribute("aria-label", u("toolbar.printTitle")), t.setAttribute("aria-haspopup", "menu"), t.disabled = c;
				let n = o.createElement("div");
				n.className = "file-viewer-web-print-menu-panel", n.setAttribute("role", "menu");
				let r = () => {
					e.dataset.open = "false";
				}, a = M(o, u("toolbar.printDirect"), "", async () => {
					r(), await V?.printRenderedHtml();
				});
				a.title = u("toolbar.printTitle"), a.setAttribute("role", "menuitem"), a.disabled = c;
				let s = M(o, u("toolbar.printMask"), "", async () => {
					r(), await V?.printWithMask();
				});
				s.title = u("toolbar.printMaskTitle"), s.setAttribute("role", "menuitem"), s.disabled = c, n.append(a, s), e.append(t, n), e.addEventListener("focusout", (t) => {
					let n = t.relatedTarget;
					n && e.contains(n) || r();
				}), w.appendChild(e);
			} else e === "exportHtml" ? v(i.exportHtml, u("toolbar.exportHtml"), u("toolbar.exportHtmlTitle"), () => V?.exportRenderedHtml()) : e === "theme" && te();
		});
	}, G = null, K = () => {
		le(O.options?.theme) === "system" && (W(), G?.());
	}, q = (e) => {
		var t;
		let n = B();
		W(), (t = O.onStateChange) == null || t.call(O, n, e), F.forEach((t) => t(n, e));
	}, J = (e) => {
		var t;
		I.lastEvent = e, e.type === "load-start" ? (I.loading = !0, I.ready = !1, I.error = null, I.lifecycle = e.payload, I.search = null, H = "") : e.type === "load-complete" ? (I.loading = !1, I.ready = !0, I.lifecycle = e.payload) : e.type === "unload-start" ? (I.loading = !0, I.ready = !1, I.lifecycle = e.payload) : e.type === "unload-complete" ? (I.loading = !1, I.ready = !1, I.lifecycle = e.payload) : e.type === "operation-availability-change" ? I.availability = e.payload : e.type === "search-change" ? (I.search = e.payload, H = e.payload.query) : e.type === "location-change" ? I.location = e.payload : e.type === "zoom-change" ? I.zoom = e.payload : e.type === "view-state-change" && (I.viewState = e.payload.state), (t = O.onEvent) == null || t.call(O, e), q(e);
	}, Y = re(T, {
		registry: n.registry,
		options: O.options,
		onEvent: J
	});
	(a = k?.addEventListener) == null || a.call(k, "change", K), W();
	let X = () => {
		P?.abort(), P = null;
	}, Z = async (e) => {
		var t;
		X(), N = e, P = typeof AbortController < "u" ? new AbortController() : null;
		let r = P;
		try {
			I.loading = !0, I.error = null, q();
			let t = await me(e, {
				fetchFile: n.fetchFile,
				signal: r?.signal
			});
			return E || r?.signal.aborted || P !== r ? null : await Y.load(t);
		} catch (i) {
			if (ge(i) && r?.signal.aborted) return null;
			throw I.loading = !1, I.ready = !1, I.error = i, q(), (t = n.onError) == null || t.call(n, i, e), i;
		} finally {
			P === r && (P = null);
		}
	};
	return G = async () => {
		if (!N) return;
		let e = Y.getViewState();
		await Z(N).catch(() => null) && e && await Y.applyViewState(e, {
			action: "restore",
			source: "api"
		});
	}, N && Z(N), V = {
		container: e,
		async load(e) {
			E || (O = e, Y.updateOptions(O.options || {}), W(), fe(O) && await Z(D(O)));
		},
		async update(e = {}) {
			E || (O = {
				...O,
				...e,
				options: e.options ?? O.options
			}, Y.updateOptions(O.options || {}), W(), fe(O) ? await Z(D(O)) : (N = null, await Y.load({ filename: s })));
		},
		async reload() {
			E || N && await Z(N);
		},
		destroy() {
			var e;
			E || (E = !0, X(), (e = k?.removeEventListener) == null || e.call(k, "change", K), Y.destroy("component-unmount"), S.remove(), x.replaceChildren(), b?.remove());
		},
		getApi() {
			return Y;
		},
		downloadOriginalFile() {
			return A(Y, (e) => e.download(), void 0);
		},
		printRenderedHtml(e) {
			return A(Y, (t) => t.print(e), void 0);
		},
		printWithMask(e) {
			return A(Y, (t) => t.printWithMask(e), void 0);
		},
		exportRenderedHtml() {
			return A(Y, (e) => e.exportHtml({ download: !0 }).then(() => void 0), void 0);
		},
		zoomIn() {
			return A(Y, (e) => e.zoomIn(), null);
		},
		zoomOut() {
			return A(Y, (e) => e.zoomOut(), null);
		},
		resetZoom() {
			return A(Y, (e) => e.resetZoom(), null);
		},
		fitToView(e) {
			return A(Y, (t) => t.fitToView(e), null);
		},
		getViewState() {
			return Y.getViewState();
		},
		applyViewState(e, t) {
			return A(Y, (n) => n.applyViewState(e, t), null);
		},
		searchDocument(e) {
			return A(Y, (t) => t.search(e), null);
		},
		clearDocumentSearch() {
			return A(Y, (e) => e.clearSearch(), null);
		},
		nextSearchResult() {
			return A(Y, (e) => e.nextSearchResult(), null);
		},
		previousSearchResult() {
			return A(Y, (e) => e.previousSearchResult(), null);
		},
		collectDocumentAnchors() {
			return A(Y, (e) => e.collectDocumentAnchors(), []);
		},
		scrollToAnchor(e) {
			return A(Y, (t) => t.scrollToDocumentAnchor(e), !1);
		},
		scrollToLine(e) {
			return A(Y, (t) => t.scrollToLine(e), !1);
		},
		getDocumentTextChunks() {
			return Y.getDocumentTextChunks();
		},
		getOperationAvailability() {
			return z();
		},
		getZoomState() {
			return Y.getZoomState();
		},
		getSearchState() {
			return Y.getSearchState();
		},
		getState() {
			return B();
		},
		subscribe(e) {
			return F.add(e), e(B()), () => {
				F.delete(e);
			};
		}
	}, V;
}, P = {
	width: "100%",
	height: "100%",
	minHeight: 0
}, F = { registry: _ }, I = (e, t) => {
	var n;
	(n = e.current) == null || n.destroy(), e.current = null, t && (t.innerHTML = "");
}, L = b((e, t) => {
	let { url: n, file: r, buffer: i, name: a, filename: o, type: s, size: c, options: l, onEvent: u, onStateChange: d, style: f, ...p } = e, m = T(null), h = T(null), g = T(null), _ = w(() => ({
		url: n,
		file: r,
		buffer: i,
		name: a,
		filename: o,
		type: s,
		size: c,
		options: l,
		onEvent: u,
		onStateChange: d
	}), [
		n,
		r,
		i,
		a,
		o,
		s,
		c,
		l,
		u,
		d
	]);
	return S(() => {
		let e = m.current;
		if (e && !h.current) return g.current = _, h.current = N(e, _, F), () => {
			g.current = null, I(h, e);
		};
	}, []), S(() => {
		var e;
		g.current !== _ && (g.current = _, (e = h.current) == null || e.update(_));
	}, [_]), C(t, () => he(() => h.current, () => I(h, m.current)), []), E("div", {
		...p,
		ref: m,
		style: {
			...P,
			...f
		}
	});
});
L.displayName = "FileViewer";
// ../../node_modules/@file-viewer/renderer-ofd/dist/index.js
var R = o.find((e) => e.id === "ofd");
if (!R) throw Error("@file-viewer/renderer-ofd could not locate the core OFD renderer definition.");
var z = R, B = {
	id: "file-viewer-renderer-ofd",
	label: "Flyfish File Viewer OFD renderer",
	definitions: [z],
	handlers: [{
		rendererId: z.id,
		handler: (e, t, n, r) => import("./ofd-DC42ej-l.js").then(({ default: n }) => n(e, t, r))
	}]
}, Ce = o.find((e) => e.id === "pdf");
if (!Ce) throw Error("@file-viewer/renderer-pdf could not locate the core PDF renderer definition.");
var V = Ce, H = {
	id: "file-viewer-renderer-pdf",
	label: "Flyfish File Viewer PDF renderer",
	definitions: [V],
	handlers: [{
		rendererId: V.id,
		handler: (e, t, n, r) => import("./pdf-BKyOop_k.js").then(({ default: n }) => n(e, t, r))
	}]
}, U = o.find((e) => e.id === "office-presentation-binary"), W = o.find((e) => e.id === "office-presentation");
if (!U || !W) throw Error("@file-viewer/renderer-presentation could not locate the core presentation renderer definitions.");
var G = U, K = W, q = {
	id: "file-viewer-renderer-presentation",
	label: "Flyfish File Viewer presentation renderer",
	definitions: [G, K],
	handlers: [{
		rendererId: G.id,
		handler: (e, t, n, r) => import("./ppt-CLxHGmqI.js").then(({ default: i }) => i(e, t, n, r))
	}, {
		rendererId: K.id,
		handler: (e, t, n, r) => import("./pptx-O4wa-Z89.js").then(({ default: i }) => i(e, t, n, r))
	}]
}, J = o.find((e) => e.id === "spreadsheet-openxml");
if (!J) throw Error("@file-viewer/renderer-spreadsheet could not locate the shared Spreadsheet format definition.");
var Y = J, X = {
	id: "file-viewer-renderer-spreadsheet",
	label: "Flyfish File Viewer Spreadsheet renderer",
	definitions: [Y],
	handlers: [{
		rendererId: Y.id,
		handler: (e, t, n, r) => import("./spreadsheet-DLUcOE1h.js").then(({ default: i }) => i(e, t, n, r))
	}]
}, Z = [
	"office-word-openxml",
	"office-word-binary",
	"open-document"
], we = o.filter((e) => Z.includes(e.id));
if (we.length !== Z.length) throw Error("@file-viewer/renderer-word could not locate the shared Word renderer definitions.");
var Te = we, Ee = (e, t, n, r) => import("./wordDocx-CvPWFlYS.js").then(({ default: n }) => n(e, t, r)), De = (e) => {
	if (e.byteLength < 2) return "binary";
	let t = new Uint8Array(e, 0, 2);
	return t[0] === 80 && t[1] === 75 ? "openxml" : "binary";
}, Oe = {
	id: "file-viewer-preset-office",
	label: "Flyfish File Viewer office renderer preset",
	renderers: [
		H,
		{
			id: "file-viewer-renderer-word",
			label: "Flyfish File Viewer Word renderer",
			definitions: Te,
			handlers: [
				{
					rendererId: "office-word-openxml",
					handler: Ee
				},
				{
					rendererId: "office-word-binary",
					handler: (e, t, n, r) => De(e) === "openxml" ? import("./wordDocx-CvPWFlYS.js").then(({ default: n }) => n(e, t, r)) : import("./wordDoc-3pN2hc3P.js").then(({ default: n }) => n(e, t, r))
				},
				{
					rendererId: "open-document",
					handler: (e, t, n, r) => import("./openDocument-DDsKAIiy.js").then(({ default: i }) => i(e, t, n, r))
				}
			]
		},
		X,
		q,
		B
	]
};
ie(Oe, {
	id: "office",
	packageName: "@file-viewer/preset-office"
});
// app/src/office-format-policy.ts
var ke = [
	".docx",
	".xlsx",
	".pptx"
], Ae = [
	".docm",
	".xlsm",
	".pptm"
], je = [
	".doc",
	".rtf",
	".odt",
	".epub",
	".xls",
	".xlsb",
	".ods",
	".ppt",
	".pps",
	".ppsx",
	".ppsm",
	".pot",
	".odp"
];
function Me(e) {
	let t = e.trim().toLowerCase();
	return t ? t.startsWith(".") ? t : `.${t}` : "";
}
var Ne = new Set(ke), Pe = new Set(Ae), Fe = new Set(je);
function Ie(e) {
	let t = Me(e);
	return Ne.has(t) ? "modern" : Pe.has(t) ? "macro" : (Fe.has(t), "best-effort");
}
function Le(e) {
	return Me(e).replace(/^\./, "");
}
// app/src/office-styles.ts
var Re = ".document-office-preview{width:100%;height:100%;min-width:0;min-height:360px}\n.document-office-preview>.document-file-viewer{display:block;width:100%;height:100%;min-width:0;min-height:0}\n.document-file-viewer::part(shell){width:100%;max-width:100%;min-width:0}\n.document-file-viewer::part(toolbar){display:flex;width:100%;max-width:100%;min-width:0;box-sizing:border-box;justify-content:space-between;flex-wrap:wrap;overflow-x:auto;overflow-y:hidden}\n.document-file-viewer::part(toolbar-group){min-width:0;max-width:100%;flex:0 1 auto}\n.document-file-viewer::part(input){width:auto;min-width:0;max-width:100%;flex:1 1 72px}\n", ze = {
	preset: Oe,
	rendererMode: "replace",
	locale: "zh-CN",
	ui: { density: "compact" },
	toolbar: {
		download: !1,
		print: !1,
		exportHtml: !1,
		theme: !1,
		position: "top"
	}
}, Q = "pipiui-office-extension-style";
function Be() {
	try {
		return new URL(
			/* @vite-ignore */
			"./file-viewer/",
			import.meta.url
		).href;
	} catch {
		return;
	}
}
function $() {
	return t() ?? "";
}
function Ve(t) {
	t ? n(t) : e();
}
function He() {
	if (typeof document > "u") return;
	let e = document.getElementById(Q);
	if (e) {
		e.dataset.refcount = String(Number(e.dataset.refcount || "0") + 1);
		return;
	}
	let t = document.createElement("style");
	t.id = Q, t.textContent = Re, t.dataset.refcount = "0";
	let r = $();
	t.dataset.prevAssetBase = r;
	let i = Be() ?? "";
	t.dataset.installedAssetBase = i;
	try {
		document.head.appendChild(t), i && n(i), t.dataset.installedAssetBase = $(), t.dataset.refcount = "1";
	} catch (e) {
		try {
			let e = $();
			(e === i || e === (t.dataset.installedAssetBase ?? "")) && Ve(r);
		} catch {}
		try {
			t.remove();
		} catch {}
		throw e;
	}
}
function Ue() {
	if (typeof document > "u") return;
	let e = document.getElementById(Q);
	if (!e) return;
	let t = Math.max(0, Number(e.dataset.refcount || "1") - 1);
	if (t > 0) {
		e.dataset.refcount = String(t);
		return;
	}
	let n = e.dataset.prevAssetBase ?? "", r = e.dataset.installedAssetBase ?? "";
	try {
		$() === r && Ve(n);
	} finally {
		e.remove();
	}
}
var We = class extends ue {
	state = { failed: !1 };
	static getDerivedStateFromError() {
		return { failed: !0 };
	}
	componentDidCatch() {
		this.props.onError();
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
};
function Ge(e) {
	if (!e) return null;
	let t = new Uint8Array(e.byteLength);
	return t.set(e), t.buffer;
}
function Ke(e) {
	S(() => (He(), () => Ue()), []);
	let t = T(!1), n = T(`${e.document.documentId}:${e.document.revision}`), r = `${e.document.documentId}:${e.document.revision}`;
	n.current !== r && (n.current = r, t.current = !1);
	let i = w(() => Ge(e.bytes), [e.bytes]), a = Ie(e.document.extension), o = Le(e.document.extension), s = x(() => {
		t.current || (t.current = !0, e.actions.useGenericFallback());
	}, [e.actions]);
	return i ? /* @__PURE__ */ E("div", {
		className: "document-office-preview",
		"data-testid": "office-renderer",
		"data-preview-tier": a,
		"data-extension": e.document.extension,
		"data-kind": e.document.documentKind,
		"aria-label": `文档内容 ${e.document.name}`,
		children: /* @__PURE__ */ E(We, {
			onError: s,
			children: /* @__PURE__ */ E(L, {
				className: "document-file-viewer",
				buffer: i,
				name: e.document.name,
				type: o,
				size: e.document.size,
				options: ze,
				onStateChange: (e) => {
					e.error && s();
				}
			}, r)
		}, r)
	}) : null;
}
export { Q as OFFICE_STYLE_ID, Ke as OfficeRenderer, Ke as default, He as acquireOfficeSideEffects, Ue as releaseOfficeSideEffects };
