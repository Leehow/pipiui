import { u as e } from "./dist-BZCS2h0l.js";
import { d as t, i as n, m as r } from "./fit-OBfTsFJi.js";
import { t as i } from "./messages-DuQwbmFt.js";
// ../../node_modules/@file-viewer/renderer-ofd/dist/ofd.js
var a = .35, o = 3, s = .1, c = "\n.ofd-viewer{position:relative;display:flex;box-sizing:border-box;min-height:100%;min-width:0;flex-direction:column;background:var(--file-viewer-render-surface-background,#e9edf2);color:#172033;font-family:Aptos,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}\n.ofd-viewer *{box-sizing:border-box}\n.ofd-toolbar{position:sticky;top:0;z-index:4;display:flex;min-height:44px;align-items:center;justify-content:center;border-bottom:1px solid rgba(148,163,184,.32);background:rgba(255,255,255,.92);box-shadow:0 4px 14px rgba(15,23,42,.06);backdrop-filter:blur(10px)}\n.ofd-toolbar-group{display:inline-flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid #d7dee8;border-radius:9px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.06)}\n.ofd-page-button{display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:7px;color:#334155;background:transparent;font:700 22px/1 Aptos,'Segoe UI',sans-serif;cursor:pointer}\n.ofd-page-button:hover:not(:disabled){border-color:#b9d4f6;color:#1769d8;background:#edf5ff}\n.ofd-page-button:focus-visible{outline:2px solid #408fff;outline-offset:1px}\n.ofd-page-button:disabled{color:#a7b0bd;cursor:not-allowed}\n.ofd-page-meter{display:inline-flex;min-width:92px;align-items:baseline;justify-content:center;gap:5px;color:#64748b;font-size:12px;white-space:nowrap}\n.ofd-page-meter strong{color:#172033;font-size:13px}\n.ofd-stage{position:relative;flex:1;min-width:0;min-height:0;padding:18px 0 28px;overflow:auto;scrollbar-gutter:stable}\n.ofd-state{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;background:rgba(246,248,250,.92);color:#64748b;font-size:14px}\n.ofd-state[hidden]{display:none!important}\n.ofd-state.error{color:#b42318}\n.ofd-page-frame{position:relative;display:block;margin:0 auto 20px;overflow:visible}\n.ofd-page{display:block;margin-left:auto!important;margin-right:auto!important;background:#fff!important;color:#111827!important;color-scheme:only light;forced-color-adjust:none;isolation:isolate;box-shadow:0 10px 26px rgba(15,23,42,.12);transition:none}\n.ofd-page.ofd-page--zoom-ready{transition:transform .16s ease}\n.ofd-page,.ofd-page *{color-scheme:only light;forced-color-adjust:none}\n.ofd-page svg,.ofd-page canvas,.ofd-page img{filter:none!important;mix-blend-mode:normal!important}\n[data-viewer-theme='dark'] .ofd-viewer{background:var(--file-viewer-render-surface-background,#172033);color:#e5eef8}\n[data-viewer-theme='dark'] .ofd-state{background:rgba(15,23,42,.9);color:#cbd5e1}\n[data-viewer-theme='dark'] .ofd-toolbar{border-color:rgba(100,116,139,.5);background:rgba(15,23,42,.9)}\n[data-viewer-theme='dark'] .ofd-toolbar-group{border-color:#475569;background:#1e293b}\n[data-viewer-theme='dark'] .ofd-page-button{color:#e2e8f0}\n[data-viewer-theme='dark'] .ofd-page-button:hover:not(:disabled){border-color:#4d79ad;color:#93c5fd;background:#263b55}\n[data-viewer-theme='dark'] .ofd-page-button:disabled{color:#64748b}\n[data-viewer-theme='dark'] .ofd-page-meter{color:#94a3b8}\n[data-viewer-theme='dark'] .ofd-page-meter strong{color:#f1f5f9}\n@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .ofd-viewer{background:var(--file-viewer-render-surface-background,#172033);color:#e5eef8}[data-viewer-theme='system'] .ofd-state{background:rgba(15,23,42,.9);color:#cbd5e1}[data-viewer-theme='system'] .ofd-toolbar{border-color:rgba(100,116,139,.5);background:rgba(15,23,42,.9)}[data-viewer-theme='system'] .ofd-toolbar-group{border-color:#475569;background:#1e293b}[data-viewer-theme='system'] .ofd-page-button{color:#e2e8f0}[data-viewer-theme='system'] .ofd-page-button:hover:not(:disabled){border-color:#4d79ad;color:#93c5fd;background:#263b55}[data-viewer-theme='system'] .ofd-page-button:disabled{color:#64748b}[data-viewer-theme='system'] .ofd-page-meter{color:#94a3b8}[data-viewer-theme='system'] .ofd-page-meter strong{color:#f1f5f9}}\n@media (prefers-reduced-motion:reduce){.ofd-page.ofd-page--zoom-ready{transition:none}}\n@media print{.ofd-viewer{display:block;background:#fff!important}.ofd-toolbar{display:none!important}.ofd-stage{padding:0!important;overflow:visible!important}.ofd-page-frame{break-after:page;page-break-after:always;margin:0 auto!important}.ofd-page-frame:last-child{break-after:auto;page-break-after:auto}.ofd-page{box-shadow:none!important;transition:none!important}}\n", ee = (() => {
	let e = null;
	return () => (e ||= import("./ofd-DINuuFG9.js"), e);
})(), l = (e) => {
	let t = e.createElement("style");
	return t.textContent = c, t;
}, u = (e, t, n, r) => {
	let i = e.createElement(t);
	return n && (i.className = n), r !== void 0 && (i.textContent = r), i;
}, d = (t, n, r) => {
	if (t instanceof Error || typeof t == "string") return e(t, r?.options);
	try {
		return JSON.stringify(t);
	} catch {
		return String(t || n);
	}
}, f = (e) => Math.min(o, Math.max(a, Number(e.toFixed(2)))), p = (e) => new Promise((t) => {
	e?.requestAnimationFrame ? e.requestAnimationFrame(() => t()) : globalThis.setTimeout(t, 0);
}), te = (e, t) => new Promise((n, r) => {
	e.parseOfdDocument({
		ofd: t,
		success: (e) => n(e),
		fail: (e) => r(e)
	});
}), m = (e, t, n) => {
	let r = e.createDocumentFragment();
	n.forEach((t) => {
		let n = e.createElement("div");
		n.className = "ofd-page-frame", t.classList.add("ofd-page"), t.dataset.viewerThemeBoundary = "light", t.style.backgroundColor = "#fff", t.style.color = "#111827", t.style.colorScheme = "only light", n.appendChild(t), r.appendChild(n);
	}), t.appendChild(r);
}, ne = (e, t, n) => {
	let r = Array.from(t.children).filter((e) => e instanceof (t.ownerDocument.defaultView?.HTMLElement || HTMLElement) && e.classList.contains("ofd-page-frame"));
	return r.some((e) => e.querySelector(".fv-print-mask-canvas")) ? r.length === n.length && (n.forEach((e, t) => {
		let n = r[t], i = Array.from(n.children).find((e) => e.classList.contains("ofd-page"));
		n && i && (e.classList.add("ofd-page"), e.dataset.viewerThemeBoundary = "light", e.style.backgroundColor = "#fff", e.style.color = "#111827", e.style.colorScheme = "only light", i.replaceWith(e));
	}), !0) : (t.replaceChildren(), m(e, t, n), !0);
};
async function h(e, c, m) {
	var h, g;
	let _ = i(m?.options), v = c.ownerDocument || document, y = v.defaultView || (typeof window < "u" ? window : null), b = n(), x = !1, S = 0, C = null, w = 0, T = 0, E = "loading", D = "", O = 1, k = 1, A = 0, j = 0, M = null, N = l(v), P = u(v, "div", "ofd-viewer");
	P.dataset.viewerZoomProvider = "ofd";
	let F = u(v, "div", "ofd-state", _("ofd.state.loading"));
	F.setAttribute("aria-live", "polite");
	let I = u(v, "div", "ofd-toolbar");
	I.setAttribute("role", "toolbar"), I.setAttribute("aria-label", _("ofd.toolbar.pageNavigation"));
	let L = u(v, "div", "ofd-toolbar-group"), R = u(v, "button", "ofd-page-button", "‹");
	R.type = "button", R.title = _("ofd.toolbar.previousPage"), R.setAttribute("aria-label", _("ofd.toolbar.previousPage"));
	let z = u(v, "span", "ofd-page-meter");
	z.setAttribute("aria-live", "polite");
	let B = u(v, "strong", void 0, "1"), V = u(v, "span", void 0, "/ -");
	z.append(B, V);
	let H = u(v, "button", "ofd-page-button", "›");
	H.type = "button", H.title = _("ofd.toolbar.nextPage"), H.setAttribute("aria-label", _("ofd.toolbar.nextPage")), L.append(R, z, H), I.append(L);
	let U = u(v, "div", "ofd-stage");
	U.tabIndex = 0, U.setAttribute("aria-label", _("ofd.toolbar.documentPages")), P.append(I, F, U), c.replaceChildren(N, P);
	let W = () => {
		U.replaceChildren();
	}, G = () => {
		F.hidden = E === "ready", F.classList.toggle("error", E === "error"), F.textContent = E === "error" ? D : _("ofd.state.loading");
	}, K = () => Array.from(U.querySelectorAll(".ofd-page-frame")), q = () => {
		A = K().length, k = A ? Math.min(A, Math.max(1, k)) : 0, B.textContent = A ? String(k) : "-", V.textContent = `/ ${A || "-"}`, z.setAttribute("aria-label", A ? _("ofd.toolbar.pageStatus", {
			current: k,
			total: A
		}) : _("ofd.toolbar.noPages")), R.disabled = k <= 1, H.disabled = k <= 0 || k >= A;
	}, J = (e, t = "smooth") => {
		let n = K();
		if (!n.length) return k = 0, q(), !1;
		let r = Math.min(n.length, Math.max(1, Math.round(e)));
		k = r, q();
		let i = n[r - 1];
		return typeof i?.scrollIntoView == "function" && i.scrollIntoView({
			block: "start",
			inline: "nearest",
			behavior: t
		}), !0;
	}, Y = () => {
		let e = K();
		if (!e.length) {
			k = 0, q();
			return;
		}
		let t = U.getBoundingClientRect().top + U.clientHeight / 2, n = 0, r = Infinity;
		e.forEach((e, i) => {
			let a = e.getBoundingClientRect(), o = a.top + a.height / 2, s = Math.abs(o - t);
			s < r && (r = s, n = i);
		});
		let i = n + 1;
		i !== k && (k = i, q());
	}, re = () => {
		if (j) return;
		let e = (y?.requestAnimationFrame)?.bind(y);
		j = e ? e(() => {
			j = 0, Y();
		}) : y?.setTimeout(() => {
			j = 0, Y();
		}, 0) || 0;
	}, ie = async (t) => (M ||= te(t, e).then((e) => {
		let t = e[0];
		if (!t) throw Error(_("ofd.error.empty"));
		return t;
	}), M), ae = () => {
		let e = P.getBoundingClientRect().width || U.getBoundingClientRect().width || 0;
		return Math.max(Math.floor(e - 48), 240);
	}, X = () => ({
		scale: O,
		label: `${Math.round(O * 100)}%`,
		canZoomIn: O < o,
		canZoomOut: O > a,
		canReset: O !== 1,
		minScale: a,
		maxScale: o
	}), Z = (e = !1) => {
		let t = y?.HTMLElement || globalThis.HTMLElement;
		U.querySelectorAll(".ofd-page-frame").forEach((n) => {
			let r = n.firstElementChild;
			if (!t || !(r instanceof t)) return;
			r.classList.toggle("ofd-page--zoom-ready", e), r.style.position = "absolute", r.style.top = "0", r.style.left = "50%", r.style.transform = `translateX(-50%) scale(${O})`, r.style.transformOrigin = "top center", r.style.marginLeft = "0", r.style.marginRight = "0";
			let i = r.offsetWidth, a = r.offsetHeight;
			i && a && (n.style.width = `${Math.ceil(i * O)}px`, n.style.height = `${Math.ceil(a * O)}px`);
		});
	}, oe = () => {
		U.querySelectorAll(".ofd-page").forEach((e) => {
			e.getBoundingClientRect(), e.classList.add("ofd-page--zoom-ready");
		});
	}, Q = (e) => (O = f(e), Z(!0), b.emit(), X());
	t(P, {
		zoomIn: () => Q(O + s),
		zoomOut: () => Q(O - s),
		resetZoom: () => Q(1),
		setZoom: Q,
		getState: X,
		subscribe: b.subscribe
	});
	let se = async (e) => {
		let t = await ee(), n = await ie(t);
		return x ? [] : Promise.resolve(t.renderOfd(e, n));
	}, $ = async (e = {}) => {
		var t;
		if (x) return;
		if (m?.signal?.aborted) throw m.signal.reason || new DOMException("OFD rendering aborted.", "AbortError");
		let n = ae();
		if (!e.force && E === "ready" && Math.abs(n - T) < 8) return;
		let r = ++S;
		(e.showLoading || E !== "ready") && (E = "loading", W(), G()), D = "";
		try {
			await p(y);
			let e = await se(n);
			if (x || r !== S) return;
			if (m?.signal?.aborted) throw m.signal.reason || new DOMException("OFD rendering aborted.", "AbortError");
			if (!ne(v, U, e)) return;
			T = n, await p(y), Z(), oe(), q(), k > 1 && J(k, "auto"), E = "ready", G(), b.emit(), (t = m?.onProgressiveRender) == null || t.call(m);
		} catch (t) {
			if (x || r !== S) return;
			if (console.error(t), E = "error", D = d(t, _("ofd.error.parseFailed"), m) || _("ofd.error.parseFailed"), G(), e.rejectOnError) throw t;
		}
	}, ce = () => {
		y?.ResizeObserver && !C && (C = new y.ResizeObserver(() => {
			y.clearTimeout(w), w = y.setTimeout(() => {
				$({ showLoading: !1 });
			}, 180);
		}), C.observe(P));
	};
	R.addEventListener("click", () => {
		J(k - 1);
	}), H.addEventListener("click", () => {
		J(k + 1);
	}), U.addEventListener("scroll", re, { passive: !0 }), U.addEventListener("keydown", (e) => {
		e.key === "PageUp" ? (e.preventDefault(), J(k - 1)) : e.key === "PageDown" ? (e.preventDefault(), J(k + 1)) : e.key === "Home" && (e.ctrlKey || e.metaKey) ? (e.preventDefault(), J(1)) : e.key === "End" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), J(A));
	});
	try {
		await $({
			force: !0,
			showLoading: !0,
			rejectOnError: !0
		}), x || ce();
	} catch (e) {
		throw r(P), e;
	}
	return (h = m?.registerThumbnailAdapter) == null || h.call(m, {
		beforeCapture: async ({ signal: e }) => {
			for (; E === "loading" && !x;) {
				if (e?.aborted) throw e.reason;
				await new Promise((e) => {
					y ? y.setTimeout(e, 16) : setTimeout(e, 16);
				});
			}
			if (E === "error") throw Error(D || _("ofd.error.parseFailed"));
		},
		getTarget: () => U.querySelector(".ofd-page-frame, .ofd-page") || U
	}), (g = m?.registerExportAdapter) == null || g.call(m, {
		print: !0,
		exportHtml: !0,
		includeDocumentStyles: !0,
		getPrintMaskPages: () => Array.from(U.querySelectorAll(".ofd-page-frame")),
		toHtml: () => {
			let e = U.cloneNode(!0);
			return e.querySelectorAll(".ofd-page-frame").forEach((e, t) => {
				e.dataset.viewerPrintPageIndex = String(t);
			}), e.outerHTML;
		}
	}), {
		$el: P,
		unmount() {
			var e, t;
			x = !0, S += 1, y?.clearTimeout(w), j && (y?.cancelAnimationFrame ? y.cancelAnimationFrame(j) : y?.clearTimeout(j)), j = 0, C?.disconnect(), C = null, r(P), W(), (e = m?.registerExportAdapter) == null || e.call(m, null), (t = m?.registerThumbnailAdapter) == null || t.call(m, null);
		}
	};
}
export { h as default };
