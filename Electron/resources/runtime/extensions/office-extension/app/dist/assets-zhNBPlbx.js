// ../../node_modules/@file-viewer/core/dist/platform/assets.js
var e = Symbol("automatic-file-viewer-asset-base"), t = e, n = (e) => {
	if (!e) return;
	let t = String(e).trim();
	if (t) return t.endsWith("/") ? t : `${t}/`;
}, r = (e) => {
	t = n(e);
}, i = () => {
	t = e;
}, a = (e) => e.split("/").filter(Boolean).length, o = (e, t) => {
	let n = e.split("/").filter(Boolean), r = t.split("/").filter(Boolean), i = [], a = Math.min(n.length, Math.max(0, r.length - 1));
	for (let e = 0; e < a && n[e] === r[e]; e += 1) i.push(n[e]);
	return i.length ? `/${i.join("/")}/` : "/";
}, s = (e, t, n) => {
	try {
		let r = e.src || e.getAttribute("src") || "";
		if (!r) return [];
		let i = new URL(r, t), s = i.pathname.match(/^(.*\/)@vite\/client$/i), c = /\/(?:src|node_modules|@fs|@id|@vite)(?:\/|$)/i.test(i.pathname), l = new URL(t), u = l.pathname.endsWith("/") ? l.pathname : `${l.pathname}/`, d = i.pathname.slice(i.pathname.lastIndexOf("/") + 1), f = /^(?:app|index|main|runtime|umi)(?:[.-]|$)/i.test(d), p = /* @__PURE__ */ new Map(), m = (t, r) => {
			let o = new URL(t, i).href, s = new URL(o), c = r + n / 1e4;
			s.origin === l.origin && (c += 8), u.startsWith(s.pathname) && (c += 16 + a(s.pathname) / 4), e.type === "module" && (c += 2), f && (c += 2);
			let d = p.get(o);
			(!d || d.score < c) && p.set(o, {
				url: o,
				score: c
			});
		};
		if (s && m(s[1], 12), c) return [...p.values()];
		let h = i.pathname.split("/").filter(Boolean).slice(0, -1);
		return [
			{
				segments: ["static", "js"],
				weight: 9
			},
			{
				segments: ["assets", "js"],
				weight: 9
			},
			{
				segments: ["assets", "chunks"],
				weight: 8
			},
			{
				segments: ["assets"],
				weight: 6
			},
			{
				segments: ["static"],
				weight: 6
			},
			{
				segments: ["js"],
				weight: 4
			}
		].forEach(({ segments: e, weight: t }) => {
			for (let n = 0; n <= h.length - e.length; n += 1) {
				if (!e.every((e, t) => h[n + t]?.toLowerCase() === e)) continue;
				let r = h.slice(0, n).length ? `/${h.slice(0, n).join("/")}/` : "/";
				m(r, t + e.length);
			}
		}), f && m(i.pathname.slice(0, i.pathname.lastIndexOf("/") + 1), 3), i.origin === l.origin && m(o(l.pathname, i.pathname), 8), [...p.values()];
	} catch {
		return [];
	}
}, c = (n) => {
	let r = n.baseURI || n.URL || "file:///";
	if (t !== e) {
		if (!t) return r;
		try {
			return new URL(t, r).href;
		} catch {
			return t;
		}
	}
	return n.querySelector("base[href]") ? r : Array.from(n.querySelectorAll("script[src]")).flatMap((e, t) => s(e, r, t)).sort((e, t) => t.score - e.score)[0]?.url || r;
}, l = (n) => t === e ? n ? c(n) : void 0 : t, u = "file:///", d = (n, r, i = {}) => {
	let a = n ? String(n) : r, o = i.documentBaseUrl || u, s = !n && t !== e ? t : void 0, c = i.baseUrl || s, l = c ? c.endsWith("/") ? c : `${c}/` : o, d = c ? new URL(l, o).href : l, f = new URL(a, d).href;
	return i.trimTrailingSlash ? f.replace(/\/+$/, "") : f;
}, f = (e, t) => {
	let n = e?.assetBaseUrl ? String(e.assetBaseUrl) : "", r = n ? new URL(n.endsWith("/") ? n : `${n}/`, t || u).href : t;
	return {
		workerUrl: d(e?.workerUrl, "vendor/pdf/pdf.worker.mjs", { documentBaseUrl: r }),
		cMapUrl: d(e?.cMapUrl, "vendor/pdf/cmaps/", { documentBaseUrl: r }),
		wasmUrl: d(e?.wasmUrl, "vendor/pdf/wasm/", { documentBaseUrl: r }),
		standardFontDataUrl: d(e?.standardFontDataUrl, "vendor/pdf/standard_fonts/", { documentBaseUrl: r }),
		cjkFontFallbackPath: d(e?.cjkFontFallbackPath, "vendor/pdf/fonts/", { documentBaseUrl: r })
	};
}, p = (e, t) => {
	let n = d(e?.workerUrl, "vendor/docx/docx.worker.js", { documentBaseUrl: t });
	return e?.workerUrl ? n : `${n}${n.includes("?") ? "&" : "?"}file-viewer-docx=0.3.26`;
}, m = (e, t) => {
	let n = d(e?.workerJsZipUrl, "vendor/docx/jszip.min.js", { documentBaseUrl: t });
	return e?.workerJsZipUrl ? n : `${n}${n.includes("?") ? "&" : "?"}file-viewer-docx=0.3.26`;
}, h = (e, t) => d(e?.workerUrl, "vendor/xlsx/sheet.worker.js", { documentBaseUrl: t }), g = (e, t) => d(e?.workerUrl, "vendor/pptx/pptx.worker.js", { documentBaseUrl: t });
export { p as a, c, m as i, h as l, i as n, f as o, d as r, g as s, l as t, r as u };
