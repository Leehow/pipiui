import { c as e, r as t } from "./assets-zhNBPlbx.js";
import { u as n, y as r } from "./dist-BZCS2h0l.js";
import { d as i, i as a, m as o, r as s } from "./fit-OBfTsFJi.js";
import { t as c } from "./messages-DuQwbmFt.js";
// ../../node_modules/@file-viewer/renderer-presentation/dist/ppt.js
var l = .25, u = 3, d = .15, f = 1.5, p = .75, m = 160, ee = "\n.ppt-binary-shell{position:relative;box-sizing:border-box;min-height:100%;padding:24px 20px;background:var(--file-viewer-render-surface-background,#eef3f8);color:#1f2d3b;font-family:Aptos,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}\n.ppt-binary-loading{position:sticky;top:12px;z-index:3;box-sizing:border-box;display:flex;width:max-content;max-width:calc(100% - 24px);align-items:center;gap:10px;margin:0 auto 18px;padding:10px 14px;border:1px solid rgba(42,94,144,.14);border-radius:999px;background:rgba(255,255,255,.92);color:#41556b;box-shadow:0 12px 32px rgba(24,44,64,.12);backdrop-filter:blur(18px)}\n.ppt-binary-loading[hidden],.ppt-binary-error[hidden]{display:none!important}\n.ppt-binary-loading-dot{width:9px;height:9px;flex:0 0 auto;border-radius:999px;background:#1f9d67;box-shadow:0 0 0 6px rgba(31,157,103,.13)}\n.ppt-binary-error{box-sizing:border-box;width:min(680px,calc(100% - 32px));margin:48px auto;padding:24px;border:1px solid rgba(28,43,58,.12);border-radius:16px;background:#fff;color:#1f2d3b;box-shadow:0 16px 42px rgba(25,42,54,.08)}\n.ppt-binary-error strong{display:block;margin-bottom:10px;font-size:18px}.ppt-binary-error p{margin:0;color:#607282;line-height:1.7}.ppt-binary-error small{display:block;margin-top:12px;color:#7a8b99;line-height:1.6}\n.ppt-binary-slides{display:grid;box-sizing:border-box;width:max-content;min-width:100%;justify-items:center;gap:22px;margin:0 auto}\n.ppt-binary-page{position:relative;box-sizing:border-box;overflow:hidden;background:#fff;box-shadow:0 10px 34px rgba(15,23,42,.14);transform-origin:top center;transition:width .18s ease}\n.ppt-binary-page canvas{display:block;max-width:none;height:auto;background:#fff}\n.ppt-binary-page-error{position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:#fff;color:#8b3a3a;text-align:center}\n[data-viewer-theme='dark'] .ppt-binary-shell{background:var(--file-viewer-render-surface-background,#101820);color:#e5eef8}\n[data-viewer-theme='dark'] .ppt-binary-loading{border-color:rgba(148,163,184,.18);background:rgba(15,23,42,.9);color:#cbd5e1;box-shadow:0 18px 44px rgba(0,0,0,.26)}\n[data-viewer-theme='dark'] .ppt-binary-error{border-color:rgba(148,163,184,.18);background:#151f2b;color:#f8fafc;box-shadow:0 22px 56px rgba(0,0,0,.32)}\n[data-viewer-theme='dark'] .ppt-binary-error p,[data-viewer-theme='dark'] .ppt-binary-error small{color:#94a3b8}\n[data-viewer-theme='dark'] .ppt-binary-page{color-scheme:only light;forced-color-adjust:none;box-shadow:0 16px 44px rgba(0,0,0,.34)}\n@media (prefers-color-scheme:dark){[data-viewer-theme='system'] .ppt-binary-shell{background:var(--file-viewer-render-surface-background,#101820);color:#e5eef8}[data-viewer-theme='system'] .ppt-binary-loading{border-color:rgba(148,163,184,.18);background:rgba(15,23,42,.9);color:#cbd5e1}[data-viewer-theme='system'] .ppt-binary-error{border-color:rgba(148,163,184,.18);background:#151f2b;color:#f8fafc}[data-viewer-theme='system'] .ppt-binary-error p,[data-viewer-theme='system'] .ppt-binary-error small{color:#94a3b8}}\n@media (max-width:640px){.ppt-binary-shell{padding:14px 10px}.ppt-binary-slides{gap:14px}.ppt-binary-loading{top:8px;margin-bottom:12px;padding:8px 12px;font-size:13px}}\n@media (prefers-reduced-motion:reduce){.ppt-binary-page{transition:none}}\n", h = "\n  .ppt-binary-shell { background: #fff !important; padding: 0 !important; }\n  .ppt-binary-loading, .ppt-binary-error { display: none !important; }\n  .ppt-binary-slides { display: block !important; width: 100% !important; min-width: 0 !important; }\n  .ppt-binary-page { width: 100% !important; margin: 0 auto !important; box-shadow: none !important; break-after: page; page-break-after: always; }\n  .ppt-binary-page:last-child { break-after: auto; page-break-after: auto; }\n  .ppt-binary-page canvas, .ppt-binary-page img { display: block; width: 100% !important; height: auto !important; }\n", g = (e) => Math.min(u, Math.max(l, e)), _ = (e, t, n, r) => {
	let i = e.createElement(t);
	return n && (i.className = n), r !== void 0 && (i.textContent = r), i;
}, v = async (e) => {
	let t = e ? await import(
		/* webpackIgnore: true */
		/* @vite-ignore */
		e
) : await import("./ppt-B6FRn6G4.js");
	if (!t || typeof t.createPptViewer != "function") throw Error("The configured PPT module does not export createPptViewer().");
	return t;
}, te = async (e, t) => (await v(e)).createPptViewer(t), ne = (e) => new Promise((t) => {
	if (typeof e.toBlob == "function") try {
		e.toBlob(t, "image/png");
		return;
	} catch {}
	try {
		let n = e.toDataURL("image/png");
		fetch(n).then((e) => e.blob()).then(t, () => t(null));
	} catch {
		t(null);
	}
}), re = (e, t, n) => ({
	print: !0,
	exportHtml: !0,
	includeDocumentStyles: !1,
	beforeSnapshot: () => r(t || void 0),
	getPrintMaskPages: () => e,
	printStyle: h,
	toHtml: async () => `<div class="ppt-binary-shell"><div class="ppt-binary-slides">${(await n()).map((e, t) => `<section class="ppt-binary-page" data-viewer-print-page-index="${t}"><img src="${e}" alt="Slide ${t + 1}"></section>`).join("")}</div></div>`
});
async function ie(h, v, ie, y) {
	var b, x, ae, oe, se, S, C, w, T;
	let E = c(y?.options), D = v.ownerDocument || document, O = D.defaultView || (typeof window < "u" ? window : null), k = a(), ce = _(D, "style");
	ce.textContent = ee;
	let A = _(D, "div", "ppt-binary-shell");
	A.dataset.viewerZoomProvider = "ppt";
	let j = _(D, "div", "ppt-binary-loading");
	j.setAttribute("role", "status"), j.setAttribute("aria-live", "polite");
	let le = _(D, "span", void 0, E("presentation.ppt.state.loading"));
	j.append(_(D, "span", "ppt-binary-loading-dot"), le);
	let M = _(D, "div", "ppt-binary-error");
	M.hidden = !0;
	let ue = _(D, "strong", void 0, E("presentation.ppt.error.title")), de = _(D, "p"), fe = _(D, "small", void 0, E("presentation.ppt.error.assetHint"));
	M.append(ue, de, fe);
	let N = _(D, "div", "ppt-binary-slides");
	A.append(j, M, N), v.replaceChildren(ce, A);
	let P = null, F = null, I = null, L = null, R = [], z = [], B = null, V = null, pe, H = 1, U = !1, me = !1, W = 0, G = null, K = null, he = 0, q = () => {
		if (U || y?.signal?.aborted) throw y?.signal?.reason || new DOMException("PPT rendering aborted.", "AbortError");
	}, J = () => {
		G !== null && (O ? O.clearTimeout(G) : clearTimeout(G), G = null);
	}, Y = () => {
		K !== null && (O ? O.clearTimeout(K) : clearTimeout(K), K = null);
	}, ge = async () => {
		let e = I;
		if (!e || U) return;
		let t = ++he;
		try {
			let n = await e.cacheStats();
			if (t !== he || e !== I || U) return;
			let r = (e, t) => {
				Number.isFinite(t) && (A.dataset[e] = String(t));
			};
			A.dataset.pptCacheEnabled = String(n.enabled), A.dataset.pptCacheAvailable = String(n.available), r("pptCacheEntries", n.entries), r("pptCacheBytes", n.bytes), r("pptAttachedCanvases", n.attachedCanvases), r("pptActiveCanvases", n.activeCanvases), r("pptWasmMemoryBytes", n.wasmMemoryBytes);
		} catch {}
	}, _e = () => {
		Y();
		let e = () => {
			K = null, ge();
		};
		K = O ? O.setTimeout(e, 200) : setTimeout(e, 200);
	}, X = () => {
		if (L) return L;
		let e = I, t = F, n = P;
		return I = null, F = null, P = null, B?.disconnect(), B = null, Y(), !e && !t && !n ? Promise.resolve() : (L = (async () => {
			try {
				e ? await e.close() : t && !t.closed && await t.close();
			} finally {
				await n?.close();
			}
		})(), L);
	}, ve = () => {
		X().catch((e) => {
			console.warn("PPT runtime cleanup warning:", e);
		});
	}, ye = () => {
		W += 1, J(), Y();
	};
	(b = y?.signal) == null || b.addEventListener("abort", ye, { once: !0 });
	let Z = () => ({
		scale: H,
		label: `${Math.round(H * 100)}%`,
		canZoomIn: H < u,
		canZoomOut: H > l,
		canReset: Math.abs(H - 1) > .001,
		minScale: l,
		maxScale: u
	}), Q = () => {
		if (!F) return;
		let e = Math.max(1, Math.round(F.width * H)), t = Math.max(1, Math.round(F.height * H));
		R.forEach((n, r) => {
			n.style.width = `${e}px`, n.style.height = `${t}px`, n.style.maxWidth = "none";
			let i = z[r];
			i && (i.style.width = `${e}px`, i.style.height = `${t}px`, i.style.maxWidth = "none");
		});
	}, be = async (e) => {
		var t;
		let n = F, i = I;
		if (!n || !i) return;
		let a = Math.min(2, Math.max(1, O?.devicePixelRatio || 1)), o = Math.min(f, Math.max(p, H * a)), s = z.map((e, t) => ({
			index: t,
			state: e.dataset.renderState
		})).filter((e) => e.state === "rendering" || e.state === "rendered").map((e) => e.index);
		for (let a of s) {
			if (q(), e !== W) return;
			let s = z[a], c = R[a];
			try {
				if (s.dataset.renderState === "rendering" && (await i.renderSlide(a), U || y?.signal?.aborted || e !== W)) return;
				if (s.dataset.renderState !== "rendered") continue;
				let r = await n.renderSlide(a, s, {
					scale: o,
					pixelRatio: 1
				});
				if (U || y?.signal?.aborted || e !== W) return;
				if (r.cancelled) continue;
				if (!c.isConnected) return;
				(t = c.querySelector(".ppt-binary-page-error")) == null || t.remove();
			} catch (t) {
				if (U || y?.signal?.aborted || e !== W || !c.isConnected) return;
				let n = _(D, "div", "ppt-binary-page-error", `${E("presentation.ppt.error.parseFailed")} (${a + 1})`);
				c.append(n), console.warn(`PPT slide ${a + 1} render warning:`, t);
			}
			Q(), a + 1 < z.length && await r(O || void 0);
		}
	}, xe = () => {
		J();
		let e = W, t = () => {
			G = null, be(e).catch((e) => {
				!U && !y?.signal?.aborted && console.warn("PPT quality rerender warning:", e);
			});
		};
		G = O ? O.setTimeout(t, m) : setTimeout(t, m);
	}, $ = (e) => (H = g(e), W += 1, Q(), k.emit(), xe(), Z()), Se = (e) => {
		if (!F) return {
			applied: !1,
			mode: e.mode,
			resize: e.resize,
			source: e.source,
			reason: "ppt-not-ready",
			provider: "zoom"
		};
		let t = s({
			mode: e.mode,
			viewportWidth: Math.max(1, (e.viewportWidth || A.clientWidth || 0) - e.padding * 2),
			viewportHeight: Math.max(1, (e.viewportHeight || A.clientHeight || 0) - e.padding * 2),
			contentWidth: F.width,
			contentHeight: F.height,
			currentScale: H,
			minScale: e.minScale ?? l,
			maxScale: e.maxScale ?? u
		});
		if (!t) return {
			applied: !1,
			mode: e.mode,
			resize: e.resize,
			source: e.source,
			reason: "unmeasurable",
			provider: "zoom"
		};
		let n = $(t);
		return {
			applied: !0,
			mode: e.mode,
			resize: e.resize,
			scale: n.scale,
			source: e.source,
			provider: "zoom"
		};
	}, Ce = async (e, t) => {
		let n = V;
		if (!n) throw Error(E("presentation.ppt.error.parseFailed"));
		let i = await te(pe, {
			...n,
			worker: !1,
			cache: !1
		}), a = null;
		try {
			a = await i.open(h.slice(0));
			let n = [];
			for (let i = 0; i < e.length; i += 1) {
				let o = e[i];
				q();
				let s = _(D, "canvas");
				try {
					await a.renderSlide(o, s, {
						scale: f,
						pixelRatio: 1
					}), q(), n.push(await t(s));
				} finally {
					s.width = 1, s.height = 1;
				}
				i + 1 < e.length && (i + 1) % 4 == 0 && await r(O || void 0);
			}
			return n;
		} finally {
			a && !a.closed && await a.close().catch(() => {}), await i.close().catch(() => {});
		}
	};
	try {
		q();
		let n = y?.options?.presentation, r = e(D), a = n?.pptModuleUrl ? t(n.pptModuleUrl, String(n.pptModuleUrl), { documentBaseUrl: r }) : void 0, o = (e) => e ? t(e, String(e), { documentBaseUrl: r }) : void 0, s = {
			worker: n?.pptWorker ?? "auto",
			cache: n?.pptCache,
			wasmUrl: o(n?.pptWasmUrl),
			fontUrl: o(n?.pptFontUrl),
			workerUrl: o(n?.pptWorkerUrl)
		};
		pe = a, V = s;
		let c = await te(a, s);
		P = c, A.dataset.pptRuntimeMode = c.mode, q(), N.className = "ppt-binary-mount";
		let l = await c.mount(N, h, {
			replace: !0,
			className: "ppt-binary-slides",
			scale: 1,
			pixelRatio: 1,
			virtualize: n?.pptVirtualize !== !1,
			rootMargin: n?.pptVirtualRootMargin,
			releaseDelayMs: n?.pptReleaseDelayMs
		});
		I = l, F = l.document, A.dataset.pptVirtualized = String(l.virtualized), q(), Object.assign(l.root.style, {
			width: "max-content",
			minWidth: "100%",
			maxWidth: "none",
			padding: "0px",
			background: "transparent",
			justifyContent: "",
			gap: ""
		}), R = Array.from(l.root.children).map((e, t) => {
			let n = e;
			return n.classList.add("ppt-binary-page"), n.dataset.slideIndex = String(t), n.dataset.viewerPrintPageIndex = String(t), n.style.maxWidth = "none", n;
		}), z.push(...l.canvases), z.forEach((e, t) => {
			e.setAttribute("role", "img"), e.setAttribute("aria-label", `Slide ${t + 1}`), e.style.maxWidth = "none";
		});
		let u = (O?.getComputedStyle)?.call(O, A), f = (Number.parseFloat(u?.paddingLeft || "") || 0) + (Number.parseFloat(u?.paddingRight || "") || 0), p = Math.max(0, (A.clientWidth || v.clientWidth || 0) - f);
		H = p > 0 ? g(Math.min(1, p / F.width)) : 1, Q(), i(A, {
			zoomIn: () => $(H + d),
			zoomOut: () => $(H - d),
			resetZoom: () => $(1),
			setZoom: $,
			fit: Se,
			getState: Z,
			subscribe: k.subscribe
		});
		let m = O?.MutationObserver;
		m && (B = new m((e) => {
			e.some((e) => e.target.dataset?.renderState === "rendered") && xe(), _e();
		}), z.forEach((e) => {
			B?.observe(e, {
				attributes: !0,
				attributeFilter: ["data-render-state"]
			});
		})), me = !0, j.hidden = !0, ge(), (x = y?.onProgressiveRender) == null || x.call(y), (ae = y?.registerExportAdapter) == null || ae.call(y, re(R, O, () => Ce(z.map((e, t) => t), (e) => e.toDataURL("image/png")))), (oe = y?.registerThumbnailAdapter) == null || oe.call(y, {
			captureSource: "rendered",
			beforeCapture: () => {
				if (!me) throw Error(E("presentation.ppt.error.parseFailed"));
			},
			capture: async () => (await Ce([0], ne))[0] || null,
			getTarget: () => R[0] || null
		}), k.emit();
	} catch (e) {
		throw U || y?.signal?.aborted ? (J(), (se = y?.registerExportAdapter) == null || se.call(y, null), (S = y?.registerThumbnailAdapter) == null || S.call(y, null), o(A), await X().catch(() => {}), e) : (j.hidden = !0, M.hidden = !1, de.textContent = n(e, y?.options) || E("presentation.ppt.error.parseFailed"), (C = y?.registerExportAdapter) == null || C.call(y, null), (w = y?.registerThumbnailAdapter) == null || w.call(y, null), o(A), await X().catch(() => {}), e);
	} finally {
		(T = y?.signal) == null || T.removeEventListener("abort", ye);
	}
	return {
		$el: A,
		unmount() {
			var e, t;
			U = !0, W += 1, J(), Y(), (e = y?.registerExportAdapter) == null || e.call(y, null), (t = y?.registerThumbnailAdapter) == null || t.call(y, null), o(A), ve(), v.replaceChildren();
		}
	};
}
export { ie as default };
