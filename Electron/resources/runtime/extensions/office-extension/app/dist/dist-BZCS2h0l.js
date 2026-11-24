import { _ as e, a as t, b as n, c as r, g as i, h as a, n as o, o as s, p as c, r as l, s as u, t as d, u as f, v as p, x as m, y as h } from "./fit-OBfTsFJi.js";
import { i as g, n as _, r as v, t as y } from "./printMask-4Y1aWsg3.js";
import { n as b, r as x } from "./messages-DuQwbmFt.js";
// ../../node_modules/@file-viewer/core/dist/registry/formats.js
var S = /* @__PURE__ */ "zip.zipx.7z.rar.tar.gz.gzip.tgz.bz2.bzip2.tbz.tbz2.xz.txz.lzma.zst.tzst.cab.ar.cpio.iso.xar.lha.lzh.jar.war.ear.apk.cbz.cbr".split("."), C = /* @__PURE__ */ "glb.gltf.obj.stl.ply.fbx.dae.3ds.3mf.amf.usd.usda.usdc.usdz.kmz.step.stp.iges.igs.ifc.3dm.brep.pcd.wrl.vrml.xyz.vtk.vtp".split("."), w = /* @__PURE__ */ "txt.json.js.mjs.cjs.css.java.py.html.htm.jsx.ts.tsx.xml.log.vue.yaml.yml.ini.sh.bash.sql.go.rs.php.c.cpp.cc.h.hpp.cs.diff.patch.bundle.bdl.jsonc.json5.ipynb.toml.proto.hcl.tex.gv.http.react.rb.swift.kt".split("."), T = [
	"gif",
	"jpg",
	"jpeg",
	"bmp",
	"tiff",
	"tif",
	"png",
	"svg",
	"webp",
	"avif",
	"ico",
	"heic",
	"heif",
	"jxl"
], E = [
	{
		id: "office-word-openxml",
		label: "Word OpenXML",
		category: "office",
		extensions: [
			"docx",
			"docm",
			"dotx",
			"dotm"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: "adapter",
			exportHtml: "adapter",
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "office-word-binary",
		label: "Word Binary",
		category: "office",
		extensions: ["doc", "dot"],
		async: !0,
		capabilities: {
			download: !0,
			print: "adapter",
			exportHtml: "adapter",
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "office-presentation-binary",
		label: "PowerPoint 97–2003",
		category: "office",
		extensions: ["ppt"],
		async: !0,
		capabilities: {
			download: !0,
			print: "adapter",
			exportHtml: "adapter",
			zoom: "provider",
			search: !1
		}
	},
	{
		id: "office-presentation",
		label: "PowerPoint OpenXML",
		category: "office",
		extensions: [
			"pptx",
			"pptm",
			"potx",
			"potm",
			"ppsx",
			"ppsm"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "open-document",
		label: "Open Document",
		category: "office",
		extensions: [
			"rtf",
			"odt",
			"odp"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "spreadsheet-openxml",
		label: "Spreadsheet",
		category: "office",
		extensions: [
			"xlsx",
			"xltx",
			"xlsm",
			"xlsb",
			"xls",
			"xlt",
			"xltm",
			"csv",
			"tsv",
			"ods",
			"fods",
			"numbers"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !1,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "pdf",
		label: "PDF",
		category: "document",
		extensions: ["pdf"],
		async: !0,
		capabilities: {
			download: !0,
			print: "adapter",
			exportHtml: "adapter",
			zoom: "provider",
			search: "provider"
		}
	},
	{
		id: "ofd",
		label: "OFD",
		category: "document",
		extensions: ["ofd"],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "typst",
		label: "Typst",
		category: "document",
		extensions: ["typ", "typst"],
		async: !0,
		capabilities: {
			download: !0,
			print: "adapter",
			exportHtml: "adapter",
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "archive",
		label: "Archive",
		category: "archive",
		extensions: S,
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !1,
			zoom: !1,
			search: !0
		}
	},
	{
		id: "email",
		label: "Email",
		category: "email",
		extensions: [
			"eml",
			"msg",
			"mbox"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !0,
			zoom: !1,
			search: !0
		}
	},
	{
		id: "eda",
		label: "EDA",
		category: "eda",
		extensions: [
			"olb",
			"dra",
			"gds",
			"oas",
			"oasis"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: !1,
			search: !0
		}
	},
	{
		id: "cad",
		label: "CAD",
		category: "cad",
		extensions: [
			"dxf",
			"dwg",
			"dwf",
			"dwfx",
			"xps"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !1
		}
	},
	{
		id: "model",
		label: "3D Model",
		category: "model",
		extensions: C,
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !1,
			zoom: "provider",
			search: !1
		}
	},
	{
		id: "geo",
		label: "Geospatial",
		category: "geo",
		extensions: [
			"geojson",
			"kml",
			"gpx",
			"shp"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "drawing",
		label: "Drawing",
		category: "drawing",
		extensions: [
			"excalidraw",
			"drawio",
			"dio",
			"mermaid",
			"mmd",
			"plantuml",
			"puml"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "mindmap",
		label: "Mind Map",
		category: "mindmap",
		extensions: ["xmind"],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "epub",
		label: "EPUB",
		category: "ebook",
		extensions: ["epub"],
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !0,
			zoom: !1,
			search: "provider"
		}
	},
	{
		id: "umd",
		label: "UMD",
		category: "ebook",
		extensions: ["umd"],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !0
		}
	},
	{
		id: "image",
		label: "Image",
		category: "image",
		extensions: T,
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: "provider",
			search: !1
		}
	},
	{
		id: "markdown",
		label: "Markdown",
		category: "markdown",
		extensions: ["md", "markdown"],
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: !1,
			search: !0
		}
	},
	{
		id: "code",
		label: "Code and Text",
		category: "code",
		extensions: w,
		async: !0,
		capabilities: {
			download: !0,
			print: !0,
			exportHtml: !0,
			zoom: !1,
			search: !0
		}
	},
	{
		id: "video",
		label: "Video",
		category: "media",
		extensions: [
			"mp4",
			"webm",
			"m3u8"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !1,
			zoom: !1,
			search: !1
		}
	},
	{
		id: "audio",
		label: "Audio",
		category: "media",
		extensions: [
			"mp3",
			"mpeg",
			"wav",
			"ogg",
			"oga",
			"opus",
			"m4a",
			"aac",
			"flac",
			"weba",
			"midi",
			"mid"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !1,
			zoom: !1,
			search: !1
		}
	},
	{
		id: "data-asset",
		label: "Data Asset",
		category: "asset",
		extensions: [
			"ttf",
			"otf",
			"woff",
			"woff2",
			"psd",
			"ai",
			"eps",
			"sqlite",
			"wasm",
			"parquet",
			"avro",
			"webarchive"
		],
		async: !0,
		capabilities: {
			download: !0,
			print: !1,
			exportHtml: !0,
			zoom: !1,
			search: !0
		}
	}
];
Object.freeze(Array.from(new Set(E.flatMap((e) => e.extensions))).sort());
// ../../node_modules/@file-viewer/core/dist/source/index.js
var D = "preview.bin", O = (e) => e.trim().replace(/^\./, "").toLowerCase(), k = (e) => {
	try {
		return decodeURIComponent(e);
	} catch {
		return e;
	}
}, A = (e) => {
	let t = e.split(/[?#]/)[0] || e, n = t.lastIndexOf(".");
	return n === -1 ? "" : O(t.slice(n + 1));
}, j = (e, t = D) => {
	let n = (e || "").split(/[?#]/)[0].trim();
	if (!n) return t;
	let r = Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\"));
	return k(r === -1 ? n : n.slice(r + 1));
}, M = (e) => e.file ? "file" : e.buffer ? "buffer" : e.url ? "url" : "empty", N = (e) => e && "name" in e && typeof e.name == "string" ? e.name : void 0, ee = ({ filename: e, file: t, url: n, fallback: r = "" }) => {
	if (e) return j(e, r);
	let i = N(t);
	return i ? j(i, r) : n ? j(n, r) : r;
}, te = (e) => {
	let t = M(e), n = j(e.filename || N(e.file) || e.url, e.type ? `preview.${O(e.type)}` : D), r = O(e.type || A(n)), i = typeof e.size == "number" ? e.size : e.file ? e.file.size : e.buffer ? e.buffer.byteLength : void 0;
	return {
		kind: t,
		filename: n,
		extension: r,
		url: e.url,
		file: e.file,
		buffer: e.buffer,
		size: i
	};
}, ne = (e, t = D) => {
	if (typeof File < "u" && e instanceof File) return e;
	let n = j(t || "preview.bin");
	if (typeof Blob < "u" && e instanceof Blob) return new File([e], n, { type: e.type });
	if (e instanceof ArrayBuffer) return new File([e], n, {});
	throw Error("Unsupported file source input.");
}, re = async (e) => typeof e.arrayBuffer == "function" ? e.arrayBuffer() : new Promise((t, n) => {
	let r = new FileReader();
	r.onload = (e) => {
		let r = e.target?.result;
		r instanceof ArrayBuffer ? t(r) : n(/* @__PURE__ */ Error("Failed to read file as ArrayBuffer."));
	}, r.onerror = (e) => n(e), r.readAsArrayBuffer(e);
});
[...Object.keys({
	docx: ["[content_types].xml", "word/document.xml"],
	docm: ["[content_types].xml", "word/document.xml"],
	dotx: ["[content_types].xml", "word/document.xml"],
	dotm: ["[content_types].xml", "word/document.xml"],
	xlsx: ["[content_types].xml", "xl/workbook.xml"],
	xltx: ["[content_types].xml", "xl/workbook.xml"],
	xlsm: ["[content_types].xml", "xl/workbook.xml"],
	xltm: ["[content_types].xml", "xl/workbook.xml"],
	xlsb: ["[content_types].xml", "xl/workbook.bin"],
	pptx: ["[content_types].xml", "ppt/presentation.xml"],
	pptm: ["[content_types].xml", "ppt/presentation.xml"],
	potx: ["[content_types].xml", "ppt/presentation.xml"],
	potm: ["[content_types].xml", "ppt/presentation.xml"],
	ppsx: ["[content_types].xml", "ppt/presentation.xml"],
	ppsm: ["[content_types].xml", "ppt/presentation.xml"],
	odt: ["content.xml"],
	ods: ["content.xml"],
	odp: ["content.xml"],
	ofd: ["ofd.xml"],
	numbers: ["index/document.iwa"],
	epub: ["meta-inf/container.xml"],
	xps: ["[content_types].xml"],
	dwfx: ["[content_types].xml"]
})], new TextDecoder("utf-8");
var ie = [
	"auto",
	"scroll",
	"overlay"
], P = (e) => Math.max(0, e.scrollHeight - e.clientHeight), F = (e, t = {}) => {
	let n = t.minScrollRange ?? 2;
	if (P(e) <= n) return !1;
	let r = e.ownerDocument?.defaultView, i = r?.getComputedStyle ? r : typeof window < "u" ? window : void 0;
	if (!i?.getComputedStyle) return !1;
	let a = i.getComputedStyle(e), o = a.overflowY || a.overflow;
	return (t.overflowValues || ie).includes(o);
}, I = (e, t = {}) => {
	if (!e) return null;
	let n = t.preferredSelector || "[data-viewer-scroll-container], .pdf-wrapper", r = t.candidateSelector || "div, section, article, pre", i = e.querySelector(n);
	return i && F(i, t) ? i : F(e, t) ? e : Array.from(e.querySelectorAll(r)).filter((e) => F(e, t)).sort((e, t) => P(t) - P(e))[0] || i || e;
}, L = "script,style,textarea,input,select,button,.viewer-actions,.viewer-watermark,.state-panel,.pdf-toolbar,.pdf-nav-pane,[aria-hidden=\"true\"],.flyfish-search-match,.textLayer,.annotationLayer,.xfaLayer,svg,canvas,iframe,video,audio", ae = (e) => ({
	...e,
	anchor: e.anchor ? { ...e.anchor } : null
}), oe = (e) => ({
	query: e.query,
	total: e.total,
	currentIndex: e.currentIndex,
	current: e.current ? ae(e.current) : null,
	matches: e.matches.map(ae)
}), R = (e, t) => {
	let n = oe(t);
	return e.query = n.query, e.total = n.total, e.currentIndex = n.currentIndex, e.current = n.current, e.matches = n.matches, e;
}, z = (e, t) => (e.anchors.value = t.anchors, R(e.state, t.state), e.state), B = (e, t) => (t.observe(), z(e, t)), V = async (e, t, n) => (await n(), z(e, t)), H = (e, t) => (t.destroy(), z(e, t)), U = (e, t) => ({
	observe() {
		return B(e, t);
	},
	async refreshAnchors() {
		return await V(e, t, () => t.refreshAnchors()), e.anchors.value;
	},
	async search(n) {
		return V(e, t, () => t.search(n));
	},
	async next() {
		return V(e, t, () => t.next());
	},
	async previous() {
		return V(e, t, () => t.previous());
	},
	async clear() {
		return V(e, t, () => t.clear());
	},
	destroy() {
		return H(e, t);
	}
}), W = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), se = (e) => e.replace(/\s+/g, " ").trim(), ce = (e, t) => {
	let n = t.wholeWord ? `\\b${W(e)}\\b` : W(e);
	return new RegExp(n, t.caseSensitive ? "g" : "gi");
}, le = (e) => e.map(({ element: e, ...t }) => t), ue = (e) => {
	let t = e.parentNode;
	if (t) {
		for (; e.firstChild;) t.insertBefore(e.firstChild, e);
		t.removeChild(e), t.normalize();
	}
}, de = (e, t) => {
	let n = e.parentElement;
	return !n || n.closest(L) ? !0 : !t.contains(n) || !e.data.trim();
}, fe = (e, t) => {
	let n = e.ownerDocument.defaultView?.NodeFilter || (typeof NodeFilter < "u" ? NodeFilter : void 0);
	return n ? n[t] : t === "SHOW_TEXT" ? 4 : t === "FILTER_REJECT" ? 2 : 1;
}, pe = (e) => {
	let t = [], n = e.ownerDocument.createTreeWalker(e, fe(e, "SHOW_TEXT"), { acceptNode(t) {
		return de(t, e) ? fe(e, "FILTER_REJECT") : fe(e, "FILTER_ACCEPT");
	} }), r = n.nextNode();
	for (; r;) de(r, e) || t.push(r), r = n.nextNode();
	return t;
}, me = (e) => e?.ownerDocument?.defaultView?.MutationObserver || (typeof MutationObserver < "u" ? MutationObserver : void 0), he = (e) => e?.ownerDocument?.defaultView || (typeof window < "u" ? window : void 0), ge = (e) => {
	if (Math.max(0, e.scrollHeight - e.clientHeight) <= 2) return !1;
	let t = e.ownerDocument.defaultView || (typeof window < "u" ? window : void 0);
	if (!t?.getComputedStyle) return !0;
	let n = t.getComputedStyle(e), r = n.overflowY || n.overflow;
	return [
		"auto",
		"scroll",
		"overlay",
		"visible"
	].includes(r);
}, _e = ({ root: e, options: t, waitForDomUpdate: r, preferredScrollContainer: o }) => {
	let c = [], l = [], u = /* @__PURE__ */ new Set(), d = n(), f = null, p = !1, h = null, g = !1, _ = () => m(t?.()), v = () => {
		let e = le(l);
		d.total = e.length, d.currentIndex = e.length ? Math.max(0, Math.min(d.currentIndex, e.length - 1)) : -1, d.current = d.currentIndex >= 0 ? e[d.currentIndex] : null, d.matches = e;
	}, y = (e) => R(d, e), b = () => {
		Array.from(u).forEach(ue), u.clear(), l = [], d.total = 0, d.currentIndex = -1, d.current = null, d.matches = [];
	}, x = async (t, r = d.query) => {
		let i = s(e());
		if (!i) return null;
		b();
		let a = await t(i);
		return y(a || i.getState?.call(i) || n(r));
	}, S = () => {
		f?.disconnect(), f = null;
	}, C = (t) => {
		let n = e() || null, r = o?.() || null;
		if (r && (r === t || r.contains(t))) return r;
		let i = t.parentElement;
		for (; i;) {
			if (ge(i)) return i;
			if (i === n) break;
			i = i.parentElement;
		}
		return n;
	}, w = (e) => {
		let t = C(e);
		if (!t) {
			e.scrollIntoView({
				block: "center",
				inline: "nearest"
			});
			return;
		}
		let n = t.scrollLeft, r = t.getBoundingClientRect(), i = e.getBoundingClientRect(), a = i.top - r.top + t.scrollTop - t.clientHeight / 2 + i.height / 2, o = Math.max(0, t.scrollHeight - t.clientHeight), s = Math.max(0, Math.min(a, o));
		typeof t.scrollTo == "function" ? t.scrollTo({
			top: s,
			left: n,
			behavior: "auto"
		}) : (t.scrollTop = s, t.scrollLeft = n), t.scrollLeft = n;
	}, T = (e, t = !0) => {
		let n = _();
		if (!l.length) return v(), d;
		let r = (e % l.length + l.length) % l.length;
		l.forEach((e) => {
			e.element.classList.remove(n.activeClassName || "flyfish-search-match--active");
		});
		let i = l[r];
		return i.element.classList.add(n.activeClassName || "flyfish-search-match--active"), d.currentIndex = r, v(), t && w(i.element), d;
	}, E = (t, n, r, a) => {
		var o;
		let s = e();
		if (!s) return;
		let l = _(), d = t.data, f = 0, p, m = t.ownerDocument.createDocumentFragment(), h = !1;
		for (n.lastIndex = 0; (p = n.exec(d)) && a.length < r;) {
			if (!p[0]) {
				n.lastIndex += 1;
				continue;
			}
			p.index > f && m.appendChild(t.ownerDocument.createTextNode(d.slice(f, p.index)));
			let e = t.ownerDocument.createElement("mark");
			e.className = l.className || "flyfish-search-match", e.textContent = p[0], e.dataset.searchMatchId = `viewer-search-match-${a.length + 1}`, u.add(e), m.appendChild(e), h = !0;
			let r = i(t.parentElement, c, s);
			a.push({
				id: e.dataset.searchMatchId,
				index: a.length,
				text: p[0],
				anchor: r,
				line: r?.line,
				page: r?.page,
				element: e
			}), f = p.index + p[0].length;
		}
		h && (f < d.length && m.appendChild(t.ownerDocument.createTextNode(d.slice(f))), (o = t.parentNode) == null || o.replaceChild(m, t));
	}, D = () => {
		S();
		let t = e(), n = me(t);
		p && t && n && !s(t) && (f = new n(A), f.observe(t, {
			childList: !0,
			subtree: !0,
			characterData: !0
		}));
	}, O = () => {
		if (!p) return;
		let t = he(e());
		t?.setTimeout ? t.setTimeout(D, 0) : setTimeout(D, 0);
	}, k = async (t, n = 0) => {
		let i = se(t), o = _();
		d.query = i, S(), g = !0;
		try {
			b();
			let t = e();
			if (!i || o.enabled === !1 || !t) return await x((e) => e.clear?.call(e), i) || d;
			let s = await x((e) => e.search(i, o), i);
			if (s) return s;
			await r?.();
			let u = e();
			if (!u) return d;
			c = a(u);
			let f = ce(i, o), p = Math.max(1, o.maxMatches || 1e3), m = [], h = pe(u);
			for (let e of h) {
				if (m.length >= p) break;
				E(e, f, p, m);
			}
			l = m, v(), m.length && T(n, !0);
		} finally {
			g = !1, O();
		}
		return d;
	}, A = () => {
		let e = _();
		d.query && !g && e.enabled !== !1 && (h !== null && clearTimeout(h), h = setTimeout(() => {
			h = null, k(d.query, Math.max(0, d.currentIndex));
		}, e.debounce ?? 180));
	};
	return {
		get anchors() {
			return c;
		},
		state: d,
		getInternalMatches: () => l,
		observe() {
			p = !0, D();
		},
		async refreshAnchors() {
			return await r?.(), c = a(e() || null), c;
		},
		search: (e) => k(e, 0),
		next: async () => await x((e) => e.next?.call(e) || e.getState?.call(e)) || T(d.currentIndex + 1),
		previous: async () => await x((e) => e.previous?.call(e) || e.getState?.call(e)) || T(d.currentIndex - 1),
		clear: async () => {
			d.query = "", S(), g = !0;
			try {
				return b(), await x((e) => e.clear?.call(e), "") || d;
			} finally {
				g = !1, O();
			}
		},
		destroy() {
			p = !1, S(), h !== null && (clearTimeout(h), h = null), b();
		}
	};
}, ve = (e) => oe(e), ye = ({ root: t, anchors: n }) => e(t || null, n), be = ({ root: e, searchTarget: t, searchOptions: n, waitForDomUpdate: r, preferredScrollContainer: i, getAiOptions: a, onSearchChange: o, onLocationChange: s }) => {
	let c = null, l = U(t, _e({
		root: e,
		options: n,
		waitForDomUpdate: r,
		preferredScrollContainer: () => i?.() ?? c?.getScrollContainer() ?? null
	}));
	return c = Ce({
		root: e,
		searchController: {
			getAnchors: () => t.anchors.value,
			getSearchState: () => t.state,
			observe: l.observe,
			refreshAnchors: l.refreshAnchors,
			search: l.search,
			clear: l.clear,
			next: l.next,
			previous: l.previous
		},
		getAiOptions: a,
		onSearchChange: o,
		onLocationChange: s
	}), {
		...c,
		destroyDocumentFeatures: l.destroy
	};
}, xe = ({ state: e, onChange: t }) => {
	let n = ve(e);
	return t?.(n), !0;
}, Se = ({ anchor: e, onChange: t }) => (t?.(e), !0), Ce = ({ root: e, searchController: t, getAiOptions: n, onSearchChange: r, onLocationChange: i }) => {
	let a = () => e() || null, o = () => t.getAnchors(), s = () => ve(t.getSearchState()), c = () => {
		let e = s();
		return xe({
			state: e,
			onChange: r
		}), e;
	}, l = () => ye({
		root: a(),
		anchors: o()
	}), u = () => {
		let e = l();
		return Se({
			anchor: e,
			onChange: i
		}), e;
	}, d = (e) => e?.notify === !1 ? l() : u(), f = async (e) => {
		t.observe();
		let n = await t.refreshAnchors();
		return d(e), n;
	}, m = async (e) => (o().length || await f(e), o()), g = (e, t) => {
		let n = p(a(), e);
		return d(t), n;
	};
	return {
		refreshDocumentIndex: f,
		async clearDocumentState() {
			return await t.clear(), s();
		},
		getScrollContainer() {
			return I(a());
		},
		async searchDocument(e) {
			return await t.search(e), c();
		},
		async clearDocumentSearch() {
			return await t.clear(), c();
		},
		async nextSearchResult() {
			return await t.next(), u(), c();
		},
		async previousSearchResult() {
			return await t.previous(), u(), c();
		},
		getSearchState: s,
		async collectDocumentAnchors(e) {
			return await f(e), o();
		},
		getCurrentDocumentAnchor: l,
		scrollToLoadedAnchor: g,
		async scrollToAnchor(e, t) {
			return await m(t), g(e, t);
		},
		async scrollToLine(e, t) {
			return await m(t), g(e, t);
		},
		getDocumentTextChunks(e) {
			return h(o(), e ?? n?.());
		}
	};
}, G = (e) => e ? {
	...e,
	zoom: e.zoom ? { ...e.zoom } : void 0,
	scroll: e.scroll ? { ...e.scroll } : void 0,
	navigation: e.navigation ? { ...e.navigation } : void 0,
	extra: e.extra ? { ...e.extra } : void 0
} : null, we = (e, t = {}) => ({
	state: G(e) || {},
	action: t.action || "init",
	source: t.source || "viewer",
	timestamp: t.timestamp || Date.now()
}), Te = () => {
	let e = /* @__PURE__ */ new Set();
	return {
		emit(t) {
			e.forEach((e) => e(t));
		},
		subscribe(t) {
			return e.add(t), () => {
				e.delete(t);
			};
		}
	};
}, Ee = (e) => e.ownerDocument?.defaultView || (typeof window < "u" ? window : void 0), De = (e) => {
	let t = Ee(e);
	return new Promise((e) => {
		t?.requestAnimationFrame ? t.requestAnimationFrame(() => e()) : setTimeout(e, 16);
	});
}, Oe = (e) => {
	let t = Math.max(0, e.scrollHeight - e.clientHeight), n = Math.max(0, e.scrollWidth - e.clientWidth);
	return {
		top: e.scrollTop || 0,
		left: e.scrollLeft || 0,
		width: e.scrollWidth || 0,
		height: e.scrollHeight || 0,
		clientWidth: e.clientWidth || 0,
		clientHeight: e.clientHeight || 0,
		topRatio: t > 0 ? (e.scrollTop || 0) / t : 0,
		leftRatio: n > 0 ? (e.scrollLeft || 0) / n : 0
	};
}, ke = (e, t, n) => {
	if (Number.isFinite(e)) return Number(e);
	if (Number.isFinite(t)) return Number(t) * n;
}, Ae = ({ host: e, renderer: t, scrollTarget: n }) => {
	var i;
	let a = Te(), o = Ee(e), s = !1, u = 0, d = 0, p = null, m = () => typeof n == "function" ? n() || e : n || I(e) || e, h = () => r(e), g = () => {
		var e;
		let n = ((e = h())?.getState)?.call(e), r = m();
		return {
			renderer: t,
			scale: n?.scale,
			zoom: n,
			scroll: r ? Oe(r) : void 0
		};
	}, _ = (e, t = "viewer") => {
		if (s) return g();
		let n = g();
		return a.emit(we(n, {
			action: e,
			source: t
		})), n;
	}, v = () => {
		d = Math.max(d, Date.now() + 180);
	}, y = (e) => {
		if (!e) return;
		let t = m(), n = Math.max(0, t.scrollHeight - t.clientHeight), r = Math.max(0, t.scrollWidth - t.clientWidth), i = ke(e.top, e.topRatio, n), a = ke(e.left, e.leftRatio, r);
		v(), i !== void 0 && (t.scrollTop = Math.min(Math.max(0, i), n)), a !== void 0 && (t.scrollLeft = Math.min(Math.max(0, a), r));
	}, b = async (t) => {
		let n = h();
		if (n?.fit) return n.fit(t);
		if (!n?.setZoom) return {
			applied: !1,
			mode: t.mode,
			resize: t.resize,
			source: t.source,
			reason: "zoom-provider-unavailable",
			provider: "view-state"
		};
		let r = n.getState(), i = Number(r.scale) > 0 ? Number(r.scale) : 1, a = m(), o = t.viewportWidth || a.clientWidth || e.clientWidth, s = t.viewportHeight || a.clientHeight || e.clientHeight, c = Math.max(a.scrollWidth || 0, e.scrollWidth || 0, a.getBoundingClientRect?.call(a).width || 0), u = Math.max(a.scrollHeight || 0, e.scrollHeight || 0, a.getBoundingClientRect?.call(a).height || 0), d = l({
			mode: t.mode,
			viewportWidth: o,
			viewportHeight: s,
			contentWidth: c / i,
			contentHeight: u / i,
			currentScale: i,
			minScale: t.minScale ?? r.minScale,
			maxScale: t.maxScale ?? r.maxScale
		});
		if (!d) return {
			applied: !1,
			mode: t.mode,
			resize: t.resize,
			source: t.source,
			reason: "unmeasurable",
			provider: "view-state"
		};
		v(), await n.setZoom(d), await De(e);
		let f = _("fit", t.source);
		return {
			applied: !0,
			mode: t.mode,
			resize: t.resize,
			scale: d,
			source: t.source,
			provider: "view-state",
			state: f
		};
	}, x = () => {
		s || Date.now() < d || u || (u = (o?.requestAnimationFrame || ((e) => setTimeout(() => e(Date.now()), 16)))(() => {
			u = 0, _("scroll", "user");
		}));
	}, S = {
		getState: g,
		async applyState(t, n = {}) {
			let r = n.source || "api", i = n.action || "restore", a = n.notify !== !1, o = h(), s = Number(t.scale ?? t.zoom?.scale);
			return v(), Number.isFinite(s) && o?.setZoom && await o.setZoom(s), await De(e), y(t.scroll), await De(e), y(t.scroll), a ? _(i, r) : g();
		},
		fit: b,
		subscribe: a.subscribe
	};
	e.dataset.viewerViewStateProvider = "generic", f(e, S), (i = e.addEventListener) == null || i.call(e, "scroll", x, {
		capture: !0,
		passive: !0
	});
	let C = h();
	return p = (C?.subscribe)?.call(C, () => {
		_("zoom-change", "viewer");
	}) || null, {
		provider: S,
		destroy() {
			var t;
			s = !0, p?.(), p = null, u && o?.cancelAnimationFrame && o.cancelAnimationFrame(u), u = 0, (t = e.removeEventListener) == null || t.call(e, "scroll", x, !0), c(e);
		}
	};
}, je = (e) => e?.ownerDocument?.defaultView?.MutationObserver || (typeof MutationObserver < "u" ? MutationObserver : void 0), Me = ({ root: e, enabled: t, onChange: n }) => {
	let r = null, i = null, a = null, o = null, s = () => G((r?.getState)?.call(r) || null), c = (e, t) => (o = G(e), t && o && n?.({
		...t,
		state: G(t.state) || o
	}), G(o)), l = () => (i?.(), i = null, r = null, c(null)), d = () => {
		if (t?.() === !1) return l(), null;
		let n = u(e());
		return n !== r && (i?.(), r = n, i = (n?.subscribe)?.call(n, (e) => {
			c(e.state, e);
		}) || null), c(s()), n;
	}, f = () => {
		a?.disconnect(), a = null;
	};
	return {
		get provider() {
			return r;
		},
		get state() {
			return G(o);
		},
		hasProvider() {
			return !!d();
		},
		refreshProvider: d,
		observe() {
			f();
			let t = e(), n = je(t);
			!t || !n || (a = new n(() => {
				d();
			}), a.observe(t, {
				childList: !0,
				subtree: !0
			})), d();
		},
		clearProvider: l,
		getState() {
			return d(), G(o);
		},
		async applyState(e, t) {
			let n = d();
			if (!n?.applyState) return G(o);
			let r = await n.applyState(e, t);
			return c(r || n.getState()), G(o);
		},
		destroy() {
			f(), l();
		}
	};
}, Ne = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), Pe = "\n  * { box-sizing: border-box; }\n  html, body { margin: 0; min-height: 100%; background: #f2f4f7; color: #172033; font-family: Aptos, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n  body { padding: 24px; }\n  .viewer-export-shell { position: relative; min-height: calc(100vh - 48px); overflow: visible; background: #f2f4f7; }\n  .viewer-export-content { position: relative; z-index: 1; contain: none; width: 100%; min-height: 100%; overflow: visible; }\n  .viewer-export-watermark { position: absolute; inset: 0; pointer-events: none; z-index: 20; background-repeat: repeat; print-color-adjust: exact; -webkit-print-color-adjust: exact; }\n  .viewer-export-content .file-render,\n  .viewer-export-content .file-viewer,\n  .viewer-export-content .viewer-stage,\n  .viewer-export-content .content,\n  .viewer-export-content .pdf-shell,\n  .viewer-export-content .pdf-content,\n  .viewer-export-content .pdf-viewport,\n  .viewer-export-content .pdf-wrapper,\n  .viewer-export-content .docx-fit-viewer,\n  .viewer-export-content .docx-wrapper,\n  .viewer-export-content .msdoc-stage,\n  .viewer-export-content .code-viewer,\n  .viewer-export-content .markdown-viewer,\n  .viewer-export-content .email-shell,\n  .viewer-export-content .archive-shell,\n  .viewer-export-content .eda-shell,\n  .viewer-export-content .ebook-shell,\n  .viewer-export-content .umd-shell,\n  .viewer-export-content .drawing-shell,\n  .viewer-export-content .audio-shell,\n  .viewer-export-content .cad-shell,\n  .viewer-export-content .cad-body,\n  .viewer-export-content .cad-canvas-wrap,\n  .viewer-export-content .dwg-preview-frame {\n    position: relative !important;\n    inset: auto !important;\n    contain: none !important;\n    width: 100% !important;\n    height: auto !important;\n    min-height: 0 !important;\n    max-height: none !important;\n    overflow: visible !important;\n  }\n  .viewer-export-content .docx-wrapper {\n    display: block !important;\n    padding: 0 !important;\n    background: transparent !important;\n  }\n  .viewer-export-content .docx-print-document {\n    display: block !important;\n    width: fit-content !important;\n    max-width: 100% !important;\n    height: auto !important;\n    overflow: visible !important;\n    margin: 0 auto !important;\n  }\n  .viewer-export-content .docx-page-frame {\n    position: relative !important;\n    width: var(--viewer-print-page-width, fit-content) !important;\n    height: var(--viewer-print-page-height, auto) !important;\n    min-height: var(--viewer-print-page-height, 0) !important;\n    max-width: 100% !important;\n    margin: 0 auto 18px !important;\n    overflow: hidden !important;\n    break-inside: avoid;\n    page-break-inside: avoid;\n    break-after: page;\n    page-break-after: always;\n  }\n  .viewer-export-content .msdoc-page {\n    position: relative !important;\n    width: var(--viewer-print-page-width, 794px) !important;\n    min-height: var(--viewer-print-page-height, 1123px) !important;\n    max-width: 100% !important;\n    height: auto !important;\n    margin: 0 auto 18px !important;\n    overflow: visible !important;\n    break-after: page;\n    page-break-after: always;\n  }\n  .viewer-export-content .docx-page-frame:last-child,\n  .viewer-export-content .msdoc-page:last-child {\n    break-after: auto;\n    page-break-after: auto;\n  }\n  .viewer-export-content .docx-page-frame > section.docx {\n    position: relative !important;\n    top: auto !important;\n    left: auto !important;\n    width: var(--viewer-print-page-width, auto) !important;\n    min-height: var(--viewer-print-page-height, auto) !important;\n    max-width: none !important;\n    margin: 0 auto !important;\n    overflow: visible !important;\n    transform: none !important;\n    box-shadow: none !important;\n    break-inside: avoid;\n    page-break-inside: avoid;\n  }\n  .viewer-export-content .msdoc-stage {\n    display: block !important;\n    padding: 0 !important;\n    background: transparent !important;\n  }\n  .viewer-export-content .msdoc-page > .msdoc-root {\n    margin: 0 auto !important;\n    box-shadow: none !important;\n    overflow: visible !important;\n  }\n  .viewer-export-content .pdf-toolbar,\n  .viewer-export-content .pdf-nav-pane,\n  .viewer-export-content .viewer-actions,\n  .viewer-export-content .code-toolbar,\n  .viewer-export-content .umd-toolbar,\n  .viewer-export-content .drawing-toolbar,\n  .viewer-export-content .cad-toolbar {\n    display: none !important;\n  }\n  .viewer-export-content .pdf-content,\n  .viewer-export-content .pdf-shell--nav-hidden .pdf-content,\n  .viewer-export-content .cad-body.without-layers {\n    display: block !important;\n    grid-template-columns: none !important;\n  }\n  .viewer-export-content .pdfViewer { padding: 0 !important; }\n  .viewer-export-content .pdfViewer .page {\n    margin: 0 auto 16px !important;\n    border: 0 !important;\n    box-shadow: none !important;\n    break-after: page;\n    page-break-after: always;\n  }\n  .viewer-export-content .pdfViewer .page:last-child {\n    break-after: auto;\n    page-break-after: auto;\n  }\n  .viewer-export-content .pdf-export-document {\n    display: grid;\n    justify-items: center;\n    gap: 18px;\n    padding: 4px 0;\n  }\n  .viewer-export-content .pdf-export-page {\n    width: var(--viewer-print-page-width, auto);\n    height: var(--viewer-print-page-height, auto);\n    max-width: 100%;\n    overflow: hidden;\n    background: #ffffff;\n    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);\n    break-inside: avoid;\n    page-break-inside: avoid;\n    break-after: page;\n    page-break-after: always;\n  }\n  .viewer-export-content .pdf-export-page:last-child {\n    break-after: auto;\n    page-break-after: auto;\n  }\n  .viewer-export-content .pdf-export-page img {\n    display: block;\n    width: 100%;\n    height: 100%;\n    object-fit: contain;\n  }\n  .viewer-export-content .pptx-wrapper {\n    width: 100% !important;\n    max-width: 100% !important;\n    height: auto !important;\n    overflow: visible !important;\n    transform: none !important;\n  }\n  .viewer-export-content .pptx-wrapper .slide {\n    margin: 0 auto 18px !important;\n    break-inside: avoid;\n    page-break-inside: avoid;\n    break-after: page;\n    page-break-after: always;\n    box-shadow: none !important;\n  }\n  .viewer-export-content .pptx-wrapper .slide:last-child {\n    break-after: auto;\n    page-break-after: auto;\n  }\n  .viewer-export-content .ofd-stage {\n    padding: 0 !important;\n    overflow: visible !important;\n  }\n  .viewer-export-content .ofd-page,\n  .viewer-export-content .drawing-svg,\n  .viewer-export-content .cad-canvas-wrap,\n  .viewer-export-content .dwg-preview-frame {\n    break-inside: avoid;\n    page-break-inside: avoid;\n    break-after: page;\n    page-break-after: always;\n    box-shadow: none !important;\n  }\n  .viewer-export-content .ofd-page:last-child,\n  .viewer-export-content .drawing-svg:last-child,\n  .viewer-export-content .cad-canvas-wrap:last-child,\n  .viewer-export-content .dwg-preview-frame:last-child {\n    break-after: auto;\n    page-break-after: auto;\n  }\n  .viewer-export-content .code-area {\n    overflow: visible !important;\n    white-space: pre-wrap !important;\n    word-break: break-word !important;\n  }\n  .viewer-export-content .umd-body,\n  .viewer-export-content .umd-stage-wrap,\n  .viewer-export-content .umd-stage {\n    display: block !important;\n    height: auto !important;\n    max-height: none !important;\n    overflow: visible !important;\n  }\n  .viewer-export-content .umd-toc {\n    display: none !important;\n  }\n  img, canvas, svg, video { max-width: 100%; }\n  @media print {\n    @page { margin: 12mm; }\n    html, body { min-height: auto; background: #ffffff; }\n    body { padding: 0; }\n    .viewer-export-shell,\n    .viewer-export-content {\n      min-height: 0;\n      overflow: visible;\n      background: #ffffff;\n    }\n    .viewer-export-content .pdf-export-document {\n      display: block;\n      padding: 0;\n    }\n    .viewer-export-content .pdf-export-page {\n      width: var(--viewer-print-page-width, auto) !important;\n      height: var(--viewer-print-page-height, auto) !important;\n      max-width: none !important;\n      margin: 0;\n      overflow: hidden;\n      box-shadow: none;\n    }\n    .viewer-export-content .docx-page-frame {\n      width: var(--viewer-print-page-width, auto) !important;\n      height: var(--viewer-print-page-height, auto) !important;\n      min-height: var(--viewer-print-page-height, 0) !important;\n      max-width: none !important;\n      margin: 0 !important;\n      overflow: hidden !important;\n    }\n    .viewer-export-content .msdoc-page {\n      width: var(--viewer-print-page-width, 794px) !important;\n      min-height: var(--viewer-print-page-height, 1123px) !important;\n      max-width: none !important;\n      margin: 0 !important;\n      overflow: visible !important;\n    }\n    .viewer-export-content .docx-page-frame > section.docx,\n    .viewer-export-content .msdoc-page > .msdoc-root {\n      width: var(--viewer-print-page-width, 100%) !important;\n      max-width: none !important;\n      border: 0 !important;\n    }\n    .viewer-export-content .pptx-wrapper .slide,\n    .viewer-export-content .ofd-page,\n    .viewer-export-content .drawing-svg,\n    .viewer-export-content .cad-canvas-wrap,\n    .viewer-export-content .dwg-preview-frame {\n      box-shadow: none !important;\n    }\n  }\n", Fe = () => Array.from(document.querySelectorAll("style, link[rel=\"stylesheet\"]")).map((e) => e instanceof HTMLStyleElement ? `<style>${e.textContent || ""}</style>` : e.href ? `<link rel="stylesheet" href="${Ne(e.href)}" />` : "").filter(Boolean).join("\n"), Ie = ({ contentHtml: e, includeDocumentStyles: t = !0, printStyle: n = "", title: r, watermarkInlineStyle: i = "", mask: a = null }) => {
	let o = i ? `<div class="viewer-export-watermark" style="${i}"></div>` : "", s = g(a), c = s ? {
		...s,
		regions: s.regions?.filter((e) => e.pageIndex === void 0),
		stamps: s.stamps?.filter((e) => e.pageIndex === void 0)
	} : null, l = v(c), u = _(e, s), d = t ? Fe() : "", f = n ? `<style data-viewer-print-style>${n}</style>` : "", p = s ? `<style data-viewer-print-mask-style>${y}</style>` : "";
	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${Ne(r)}</title>
  ${d}
  <style>${Pe}</style>
  ${p}
</head>
<body>
  <main class="viewer-export-shell">
    <div class="viewer-export-content">${u}</div>
    ${l}
    ${o}
  </main>
  ${f}
</body>
</html>`;
}, K = (e, t) => {
	let n = URL.createObjectURL(e), r = document.createElement("a");
	r.href = n, r.download = t, r.rel = "noopener", document.body.appendChild(r), r.click(), r.remove(), window.setTimeout(() => URL.revokeObjectURL(n), 4e3);
}, Le = (e, t) => {
	let n = document.createElement("a");
	n.href = e, n.download = t, n.rel = "noopener", n.target = "_blank", document.body.appendChild(n), n.click(), n.remove();
}, Re = (e, t) => {
	let n = Array.from(e.querySelectorAll("canvas"));
	Array.from(t.querySelectorAll("canvas")).forEach((e, t) => {
		let r = n[t];
		if (r) try {
			let t = document.createElement("img");
			t.src = r.toDataURL("image/png"), t.alt = "rendered canvas", t.style.maxWidth = "100%", t.style.display = "block", t.style.margin = "0 auto", e.replaceWith(t);
		} catch {}
	});
}, ze = (e) => new Promise((t) => {
	let n = e || (typeof window < "u" ? window : void 0);
	if (!n || typeof n.requestAnimationFrame != "function") {
		(n?.setTimeout ? n.setTimeout.bind(n) : globalThis.setTimeout.bind(globalThis))(() => t(), 0);
		return;
	}
	let r = n.requestAnimationFrame.bind(n);
	r(() => {
		r(() => t());
	});
}), Be = async (e) => {
	if (!e || typeof e.querySelectorAll != "function") return;
	let t = Array.from(e.querySelectorAll("img"));
	await Promise.all(t.map(async (e) => {
		if (!e.complete) {
			if ("decode" in e) try {
				await e.decode();
				return;
			} catch {}
			await new Promise((t) => {
				e.addEventListener("load", () => t(), { once: !0 }), e.addEventListener("error", () => t(), { once: !0 });
			});
		}
	}));
}, Ve = (e, t) => {
	let n = t || "application/octet-stream", r = globalThis.Buffer;
	if (r) return `data:${n};base64,${r.from(e).toString("base64")}`;
	let i = "", a = new Uint8Array(e);
	for (let e = 0; e < a.length; e += 1) i += String.fromCharCode(a[e]);
	return `data:${n};base64,${btoa(i)}`;
}, He = async (e) => {
	if (typeof FileReader == "function") try {
		return await new Promise((t, n) => {
			let r = new FileReader();
			r.onload = () => t(String(r.result || "")), r.onerror = () => n(r.error || /* @__PURE__ */ Error("Failed to read blob")), r.readAsDataURL(e);
		});
	} catch {}
	return Ve(await e.arrayBuffer(), e.type || "application/octet-stream");
}, Ue = (e) => {
	let t = e.match(/blob:[^\s"'<>)\\]+/g) || [];
	return Array.from(new Set(t));
}, We = async (e) => {
	if (!e.includes("blob:") || typeof fetch != "function") return e;
	let t = Ue(e);
	if (!t.length) return e;
	let n = await Promise.all(t.map(async (e) => {
		try {
			let t = await fetch(e);
			if (!t.ok) return null;
			let n = await He(await t.blob());
			return n ? [e, n] : null;
		} catch {
			return null;
		}
	})), r = e;
	for (let e of n) {
		if (!e) continue;
		let [t, n] = e;
		r = r.split(t).join(n);
	}
	return r;
}, Ge = async (e) => {
	let { document: t } = e;
	t.readyState !== "complete" && await new Promise((t) => {
		e.addEventListener("load", () => t(), { once: !0 }), e.setTimeout(() => t(), 1200);
	}), await Promise.all(Array.from(t.images).map(async (t) => {
		if (!t.complete) {
			if ("decode" in t) try {
				await t.decode();
				return;
			} catch {}
			await new Promise((n) => {
				t.addEventListener("load", () => n(), { once: !0 }), t.addEventListener("error", () => n(), { once: !0 }), e.setTimeout(() => n(), 1500);
			});
		}
	})), await new Promise((t) => {
		e.requestAnimationFrame(() => {
			e.requestAnimationFrame(() => t());
		});
	});
}, Ke = async (e, t) => t.mode !== "print" || !e?.printStyle ? "" : typeof e.printStyle == "function" ? await e.printStyle(t) : e.printStyle, qe = async (e, t) => {
	await (t?.beforeSnapshot)?.call(t), await ze(), await Be(e);
}, Je = async ({ source: e, mode: t = "export", title: n, adapter: r = null, watermarkInlineStyle: i = "", mask: a = null }) => {
	let o = {
		mode: t,
		title: n
	}, s = r?.toHtml, c = g(a);
	if (s) {
		await qe(e, r);
		let t = await We(await s(o)), a = await Ke(r, o);
		return Ie({
			contentHtml: t,
			includeDocumentStyles: r.includeDocumentStyles !== !1,
			printStyle: a,
			title: n,
			watermarkInlineStyle: i,
			mask: c
		});
	}
	await qe(e, r);
	let l = e.cloneNode(!0);
	l.querySelectorAll(".viewer-watermark").forEach((e) => e.remove()), Re(e, l);
	let u = await Ke(r, o);
	return Ie({
		contentHtml: await We(l.innerHTML),
		printStyle: u,
		title: n,
		watermarkInlineStyle: i,
		mask: c
	});
}, Ye = "file-viewer-preview", Xe = "preview", Ze = D, Qe = (e) => e && "name" in e && typeof e.name == "string" ? e.name : "", $e = (e) => e && typeof e.type == "string" ? e.type : "", et = ({ buffer: e = null, file: t = null, url: n = null, filename: r = null, mimeType: i = null } = {}) => ({
	buffer: e,
	file: t,
	url: n,
	filename: r,
	mimeType: i || $e(t) || null
}), tt = (e, t = Xe) => e?.filename || t, nt = (e, t = Xe) => et({
	buffer: e?.buffer,
	file: e?.file,
	url: e?.url,
	filename: tt(e, t),
	mimeType: e?.file?.type
}), rt = (e, t = "preview") => e.filename || Qe(e.file) || t, q = ({ filename: e, source: t, fallback: n = Ye }) => e || (t ? rt(t, "") : "") || n, it = (e) => !!e.buffer || !!e.file || !!e.url, at = async (e, t) => !e || await e(t), ot = async (e, { source: t, title: n, filename: r, adapter: i = null, watermarkInlineStyle: a, mask: o = null, i18n: s }) => {
	if (!t) throw Error(x(s, "error.noExportContent"));
	return Je({
		source: t,
		mode: e,
		title: q({
			filename: n || r,
			fallback: Ye
		}),
		adapter: i,
		watermarkInlineStyle: a,
		mask: e === "print" ? o : null
	});
}, st = async ({ source: e, filename: t, beforeOperation: n, i18n: r, throwOnMissingSource: i = !0 }) => {
	if (!it(e)) {
		if (i) throw Error(x(r, "error.noDownloadSource"));
		return !1;
	}
	if (!await at(n, "download")) return !1;
	let a = q({
		filename: t,
		source: e,
		fallback: Ze
	});
	return e.buffer && (e.buffer.byteLength > 0 || !e.file && !e.url) ? (K(new Blob([e.buffer], { type: e.mimeType || e.file?.type || "application/octet-stream" }), a), !0) : e.file && (e.file.size > 0 || !e.url) ? (K(e.file, a), !0) : e.url ? (Le(e.url, a), !0) : e.file ? (K(e.file, a), !0) : (K(new Blob([e.buffer], { type: e.mimeType || "application/octet-stream" }), a), !0);
}, ct = async ({ download: e = !0, filename: t, beforeOperation: n, i18n: r, ...i }) => {
	if (!await at(n, "export-html")) return "";
	let a = await ot("export", {
		...i,
		filename: t,
		i18n: r
	});
	if (e !== !1) {
		let e = q({
			filename: t || i.title,
			fallback: Xe
		});
		K(new Blob([a], { type: "text/html;charset=utf-8" }), `${e}.rendered.html`);
	}
	return a;
}, lt = async ({ autoPrint: e = !0, beforeOperation: t, i18n: n, openWindow: r, printAvailable: i = !0, printWindow: a, ...o }) => {
	if (!i) throw Error(x(n, "error.printUnavailable"));
	if (!await at(t, "print")) return !1;
	let s = await ot("print", {
		...o,
		i18n: n
	}), c = a || r?.() || (typeof window < "u" ? window.open("", "_blank") : null);
	if (!c) throw Error(x(n, "error.printWindowBlocked"));
	return c.document.open(), c.document.write(s), c.document.close(), c.focus(), await Ge(c), e !== !1 && c.print(), !0;
}, ut = "__flyfish_file_viewer_auto_renderer_presets__", J = () => {
	let e = globalThis;
	return e[ut] || (e[ut] = {
		version: 0,
		presets: /* @__PURE__ */ new Map()
	}), e[ut];
}, dt = (e) => ({
	...e,
	extensions: e.extensions.map(O)
}), ft = (e = E) => {
	let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), r = (e) => {
		let r = dt(e), i = t.get(r.id);
		i && i.extensions.forEach((e) => {
			n.get(e)?.id === i.id && n.delete(e);
		}), t.set(r.id, r), r.extensions.forEach((e) => {
			let t = n.get(e);
			if (t && t.id !== r.id) throw Error(`File extension "${e}" is already registered by renderer "${t.id}".`);
			n.set(e, r);
		});
	};
	return e.forEach(r), {
		register: r,
		unregister(e) {
			let r = t.get(e);
			return r ? (r.extensions.forEach((t) => {
				n.get(t)?.id === e && n.delete(t);
			}), t.delete(e), !0) : !1;
		},
		getById(e) {
			return t.get(e);
		},
		getByExtension(e) {
			return n.get(O(e));
		},
		hasExtension(e) {
			return n.has(O(e));
		},
		list() {
			return Array.from(t.values());
		},
		listExtensions() {
			return Array.from(n.keys()).sort();
		}
	};
}, pt = (e) => !!e && typeof e == "object" && !Array.isArray(e) && Array.isArray(e.renderers), mt = (e) => e ? Array.isArray(e) ? e.flatMap((e) => mt(e)) : pt(e) ? mt(e.renderers) : [e] : [], ht = (e, t = {}) => t.id ? t.id : t.packageName ? t.packageName : pt(e) ? e.id : !Array.isArray(e) && e && typeof e == "object" && "id" in e ? String(e.id) : "file-viewer-auto-renderers", gt = (e, t = {}) => {
	let n = J(), r = ht(e, t), i = n.presets.get(r);
	return (i?.input !== e || i.packageName !== t.packageName) && (n.presets.set(r, {
		id: r,
		packageName: t.packageName,
		input: e
	}), n.version += 1), () => {
		_t(r);
	};
}, _t = (e) => {
	let t = J(), n = t.presets.delete(e);
	return n && (t.version += 1), n;
}, vt = () => Array.from(J().presets.values()).map((e) => e.input), yt = (e) => {
	let t = J(), n = t.presets.get(e);
	if (n) return n.input;
	let r = e.startsWith("@file-viewer/preset-") ? e : `@file-viewer/preset-${e}`;
	return Array.from(t.presets.values()).find((e) => e.packageName === r || e.id === r)?.input;
}, bt = () => J().version, xt = (e) => e ? typeof e == "string" ? !0 : Array.isArray(e) ? e.some((e) => xt(e)) : !1 : !1, St = (e) => {
	if (!e) return [];
	if (typeof e == "string") {
		let t = yt(e);
		return t ? [t] : [];
	}
	return Array.isArray(e) ? e.flatMap((e) => St(e)) : [e];
}, Ct = async ({ registry: e, plugins: t, registerHandler: n }) => {
	var r, i;
	for (let a of t) (r = a.definitions) == null || r.forEach((t) => {
		e.register(t);
	}), (i = a.handlers) == null || i.forEach((e) => {
		n?.(e);
	}), await a.install?.call(a, {
		registry: e,
		registerHandler: n
	});
	return e;
}, wt = ({ registry: e = ft(E), handlers: t, fallbackHandler: n, fallbackKey: r = "error" }) => {
	let i = Array.from(t).reduce((e, t) => (e.set(t.rendererId, t.handler), e), /* @__PURE__ */ new Map()), a = /* @__PURE__ */ new Map(), o = [];
	e.list().forEach((e) => {
		let t = i.get(e.id);
		t ? e.extensions.forEach((e) => {
			a.set(O(e), t);
		}) : o.push(e.id);
	}), n && r && a.set(O(r), n);
	let s = (e) => a.get(O(e));
	return {
		handlersByRendererId: i,
		handlersByExtension: a,
		missingRendererIds: o,
		get: s,
		resolve(e) {
			return s(e) || (r ? s(r) : void 0);
		},
		has(e) {
			return a.has(O(e));
		},
		listExtensions() {
			return Array.from(a.keys()).sort();
		}
	};
}, Tt = Object.freeze({
	download: !1,
	print: !1,
	exportHtml: !1,
	zoom: !1,
	zoomIn: !1,
	zoomOut: !1,
	zoomReset: !1
}), Y = (e) => e === !0 || e === "adapter" || e === "provider", Et = (e, t) => e ? {
	download: e.capabilities?.download !== !1,
	print: Y(e.capabilities?.print),
	exportHtml: Y(e.capabilities?.exportHtml),
	zoom: Y(e.capabilities?.zoom),
	zoomIn: Y(e.capabilities?.zoom),
	zoomOut: Y(e.capabilities?.zoom),
	zoomReset: Y(e.capabilities?.zoom),
	...(t?.getAvailability)?.call(t)
} : { ...Tt }, Dt = (e, t) => {
	let n = e.zoom && (t.canZoomIn || t.canZoomOut || t.canReset);
	return {
		...e,
		zoom: n,
		zoomIn: n && t.canZoomIn,
		zoomOut: n && t.canZoomOut,
		zoomReset: n && t.canReset
	};
}, Ot = (e) => ({
	...Tt,
	download: O(e).length > 0
});
[...w, ...T], [...S, ...C];
// ../../node_modules/@file-viewer/core/dist/lifecycle/operations.js
var kt = {
	"load-start": "onLoadStart",
	"load-complete": "onLoadComplete",
	"unload-start": "onUnloadStart",
	"unload-complete": "onUnloadComplete"
}, At = [
	"zoom-in",
	"zoom-out",
	"zoom-reset"
], jt = {
	canZoomIn: "zoom-in",
	canZoomOut: "zoom-out",
	canReset: "zoom-reset"
}, Mt = [
	"search",
	"zoom",
	"download",
	"print",
	"exportHtml",
	"theme"
], Nt = ({ phase: e, version: t, source: n, filename: r, file: i, url: a, size: o, bufferSize: s, startedAt: c, duration: l, timestamp: u, reason: d }) => {
	let f = j(i?.name || r || a || ""), p = u ?? Date.now();
	return {
		phase: e,
		type: A(f),
		filename: f,
		source: n,
		url: a,
		file: i || void 0,
		size: o ?? i?.size ?? s,
		version: t,
		timestamp: p,
		duration: l ?? (e === "load-complete" && typeof c == "number" ? p - c : void 0),
		reason: d
	};
}, Pt = ({ phase: e, source: t, version: n, startedAt: r, timestamp: i, reason: a }) => {
	let o = i ?? Date.now();
	return Nt({
		phase: e,
		filename: t.filename,
		source: t.kind,
		url: t.url,
		file: typeof File < "u" && t.file instanceof File ? t.file : void 0,
		size: t.size,
		version: n,
		timestamp: o,
		duration: e.endsWith("complete") && typeof r == "number" ? o - r : void 0,
		reason: a
	});
}, Ft = (e, t, n = Date.now(), r) => {
	let { phase: i, ...a } = t, o = {
		download: "operation.download",
		print: "operation.print",
		"export-html": "operation.exportHtml",
		"zoom-in": "operation.zoomIn",
		"zoom-out": "operation.zoomOut",
		"zoom-reset": "operation.zoomReset"
	};
	return {
		...a,
		operation: e,
		label: x(r, o[e]),
		timestamp: n
	};
}, It = (e) => kt[e], Lt = async (e, t, n) => {
	let r = t?.[It(e.phase)];
	if (r) try {
		await r(e);
	} catch (t) {
		n?.(t, e);
	}
}, Rt = (e, t) => {
	let n = e?.toolbar;
	if (!n || typeof n != "object") return [e?.beforeOperation];
	let r = t === "download" ? n.beforeDownload : t === "print" ? n.beforePrint : t === "export-html" ? n.beforeExportHtml : void 0;
	return [
		e?.beforeOperation,
		n.beforeOperation,
		r
	];
}, zt = (e, t) => e?.[t] !== !1, Bt = (e, t) => !e || typeof e != "object" || zt(e.permissions, t), Vt = (e, t) => zt(e.items, t) && zt(e.permissions, t), Ht = (e) => {
	if (e === "search" || e === "zoom" || e === "download" || e === "print") return e;
	if (e === "exportHtml" || e === "export-html") return "exportHtml";
	if (e === "theme") return "theme";
}, Ut = (e) => {
	let t = [], n = /* @__PURE__ */ new Set(), r = (e) => {
		let r = Ht(e);
		r && !n.has(r) && (n.add(r), t.push(r));
	};
	return Array.isArray(e?.order) && e.order.forEach(r), Mt.forEach(r), t;
}, Wt = (e) => At.some((t) => Vt(e, t)), Gt = async ({ context: e, options: t, onBefore: n, onCancel: r, onError: i }) => {
	n?.(e);
	try {
		if (!Bt(t?.toolbar, e.operation)) return r?.(e), !1;
		for (let n of Rt(t, e.operation)) if (n && await n(e) === !1) return r?.(e), !1;
	} catch (t) {
		return i?.(t, e), r?.(e), !1;
	}
	return !0;
}, Kt = (e) => {
	let t = e?.toolbar;
	return t === !1 ? {
		download: !1,
		print: !1,
		exportHtml: !1,
		zoom: !1,
		search: !1,
		theme: !1,
		order: Ut(void 0)
	} : t && typeof t == "object" ? {
		download: t.download !== !1 && Vt(t, "download"),
		print: t.print !== !1 && Vt(t, "print"),
		exportHtml: t.exportHtml !== !1 && Vt(t, "export-html"),
		zoom: t.zoom !== !1 && Wt(t),
		search: t.search !== !1,
		theme: t.theme !== !1,
		order: Ut(t),
		items: t.items,
		permissions: t.permissions,
		position: t.position,
		beforeOperation: t.beforeOperation,
		beforeDownload: t.beforeDownload,
		beforePrint: t.beforePrint,
		beforeExportHtml: t.beforeExportHtml
	} : {
		download: !0,
		print: !0,
		exportHtml: !0,
		zoom: !0,
		search: !0,
		theme: !0,
		order: Ut(void 0)
	};
}, qt = (e, t, n = !0) => ({
	download: e.download && t.download,
	print: e.print && t.print,
	exportHtml: e.exportHtml && t.exportHtml,
	zoom: e.zoom && t.zoom,
	search: e.search !== !1 && n,
	theme: e.theme !== !1
}), Jt = (e) => !!(e.download || e.print || e.exportHtml || e.zoom || e.search || e.theme), Yt = ({ toolbarDisabled: e = !1, availability: t, zoomState: n, action: r }) => {
	let i = jt[r], a = i === "zoom-in" ? t.zoomIn : i === "zoom-out" ? t.zoomOut : t.zoomReset;
	return e || !t.zoom || !a || !n[r];
}, Xt = (e, t) => {
	let n = e?.toolbar, r = n && typeof n == "object" ? n.position : "auto";
	return r === "top" || r === "top-center" || r === "bottom-right" ? r : t === "pdf" ? "bottom-right" : "top";
};
Object.freeze({
	downloading: "正在下载文件资源...",
	streamingPdf: "正在建立 PDF 流式预览...",
	reading: "正在解析文件内容..."
});
var Zt = Object.freeze({
	accent: "#5f6f82",
	soft: "rgba(95, 111, 130, 0.12)",
	badge: "DOC",
	label: "文件内容",
	hint: "正在整理内容结构并生成预览。"
}), Qt = (e, t) => {
	let n = O(e);
	if (n) return `.${n}`;
	let r = b(t);
	return r === "zh-CN" ? "当前文件" : r === "ja-JP" ? "現在のファイル" : "current file";
}, $t = {
	"office-word-openxml": "@file-viewer/renderer-word",
	"office-word-binary": "@file-viewer/renderer-word",
	"office-presentation-binary": "@file-viewer/renderer-presentation",
	"office-presentation": "@file-viewer/renderer-presentation",
	"open-document": "@file-viewer/renderer-word",
	"spreadsheet-openxml": "@file-viewer/renderer-spreadsheet",
	pdf: "@file-viewer/renderer-pdf",
	ofd: "@file-viewer/renderer-ofd",
	typst: "@file-viewer/renderer-typst",
	archive: "@file-viewer/renderer-archive",
	email: "@file-viewer/renderer-email",
	eda: "@file-viewer/renderer-eda",
	cad: "@file-viewer/renderer-cad",
	model: "@file-viewer/renderer-3d",
	geo: "@file-viewer/renderer-geo",
	drawing: "@file-viewer/renderer-drawing",
	mindmap: "@file-viewer/renderer-mindmap",
	epub: "@file-viewer/renderer-epub",
	umd: "@file-viewer/renderer-epub",
	image: "@file-viewer/renderer-image",
	markdown: "@file-viewer/renderer-text",
	code: "@file-viewer/renderer-text",
	video: "@file-viewer/renderer-media",
	audio: "@file-viewer/renderer-media",
	"data-asset": "@file-viewer/renderer-data"
}, en = /* @__PURE__ */ new Set([
	"office-word-openxml",
	"office-word-binary",
	"office-presentation-binary",
	"office-presentation",
	"open-document",
	"spreadsheet-openxml",
	"pdf",
	"ofd"
]), tn = /* @__PURE__ */ new Set([
	"image",
	"markdown",
	"code",
	"video",
	"audio"
]), nn = /* @__PURE__ */ new Set([
	"typst",
	"archive",
	"eda",
	"cad",
	"model",
	"geo",
	"drawing",
	"mindmap",
	"data-asset"
]), rn = (e) => en.has(e.id) ? {
	packageName: "@file-viewer/preset-office",
	vitePreset: "office",
	label: "Office preset"
} : nn.has(e.id) ? {
	packageName: "@file-viewer/preset-engineering",
	vitePreset: "engineering",
	label: "Engineering preset"
} : tn.has(e.id) ? {
	packageName: "@file-viewer/preset-lite",
	vitePreset: "lite",
	label: "Lite preset"
} : {
	packageName: "@file-viewer/preset-all",
	vitePreset: "all",
	label: "Full preset"
}, an = (e = "") => {
	let t = O(e), n = E.find((e) => e.extensions.map(O).includes(t));
	if (!n) return null;
	let r = rn(n);
	return {
		extension: t,
		rendererId: n.id,
		rendererLabel: n.label,
		rendererCategory: n.category,
		rendererPackage: $t[n.id],
		presetPackage: r.packageName,
		vitePreset: r.vitePreset,
		presetLabel: r.label
	};
}, on = ({ state: e, extension: t = "", title: n, message: r, description: i, theme: a = Zt, recoverable: o }) => ({
	state: e,
	extension: O(t),
	title: n,
	message: r,
	description: i,
	theme: a,
	recoverable: o
}), sn = (e = "", t = Zt, n) => {
	let r = Qt(e, n), i = an(e);
	if (i) {
		let a = b(n), o = i.rendererPackage ? a === "zh-CN" ? `；如果需要极致裁剪，也可以只安装 ${i.rendererPackage}` : a === "ja-JP" ? `；厳密に最小構成へ絞る場合は ${i.rendererPackage} のみをインストールすることもできます` : `; for a strict custom cut, install only ${i.rendererPackage}` : "";
		return on({
			state: "unsupported",
			extension: e,
			title: x(n, "state.unsupported.install.title"),
			message: x(n, "state.unsupported.install.message", {
				extension: r,
				rendererLabel: i.rendererLabel
			}),
			description: x(n, "state.unsupported.install.description", {
				extension: r,
				rendererLabel: i.rendererLabel,
				presetPackage: i.presetPackage,
				vitePreset: i.vitePreset,
				rendererTip: o
			}),
			theme: t,
			recoverable: !0
		});
	}
	return on({
		state: "unsupported",
		extension: e,
		title: x(n, "state.unsupported.title"),
		message: x(n, "state.unsupported.message", { extension: r }),
		description: x(n, "state.unsupported.description"),
		theme: t,
		recoverable: !0
	});
}, cn = {
	"Blob is not available in the current execution environment.": "error.blobUnavailable",
	"Unsupported file source input.": "error.sourceUnsupported",
	"Failed to read file as ArrayBuffer.": "error.fileReadArrayBuffer",
	"Failed to read file as data URL.": "error.fileReadDataUrl",
	"Failed to read file as text.": "error.fileReadText",
	"Unable to read image data URL.": "error.imageDataUrlRead",
	"文件不是有效的 DOCX/OOXML 压缩包，可能下载不完整或被服务端错误内容替换，请重新上传或检查文件源。": "word.error.invalidDocx",
	"ODF 文件缺少 content.xml": "word.error.missingOdfContent",
	"ODF 文件缺少 content.xml。": "word.error.missingOdfContent",
	"ODF XML 解析失败": "word.error.odfXmlParseFailed",
	"ODF XML 解析失败。": "word.error.odfXmlParseFailed",
	"OFD 文件中没有可渲染的文档": "ofd.error.empty",
	"OFD 文件解析失败": "ofd.error.parseFailed",
	"IndexedDB 不可用": "archive.error.indexedDbUnavailable",
	"Web Worker is not supported by this browser.": "archive.error.workerUnsupported"
}, ln = (e, t) => {
	let n = cn[e.trim()];
	return n ? x(t, n) : e;
}, un = (e, t) => {
	try {
		return e[t];
	} catch {
		return;
	}
}, dn = (e, t) => {
	if (e instanceof Error) return ln(e.message, t);
	if (typeof e == "string") return ln(e, t);
	if (e == null) return x(t, "error.unknown");
	if (typeof e == "object") {
		let n = un(e, "message");
		if (typeof n == "string" && n.trim()) return ln(n, t);
		let r = un(e, "reason");
		if (r !== void 0 && r !== e) return dn(r, t);
	}
	let n = String(e);
	return n === "[object Object]" ? x(t, "error.unknown") : n;
}, fn = 65536, pn = () => {
	let e = 0, t = null;
	return {
		get version() {
			return e;
		},
		createVersion() {
			return e += 1, t?.abort(), t = null, e;
		},
		isCurrent(t) {
			return t === e;
		},
		createAbortController() {
			return t = typeof AbortController == "function" ? new AbortController() : null, t;
		},
		clearAbortController(e) {
			t === e && (t = null);
		},
		abort() {
			t?.abort(), t = null;
		}
	};
}, mn = (e = pn()) => ({
	requestController: e,
	getCurrentVersion: () => e.version,
	isCurrentRequest: (t) => e.isCurrent(t)
}), hn = /^[a-z][a-z0-9+.-]*:\/\//i, gn = /^[a-z][a-z0-9+.-]*:/i, _n = (e) => {
	let t = e.indexOf("?"), n = e.indexOf("#");
	return t === -1 ? n : n === -1 ? t : Math.min(t, n);
}, vn = (e) => {
	if (!e) return e;
	let t = e;
	try {
		t = decodeURIComponent(e);
	} catch {}
	return encodeURIComponent(t).replace(/%3A/gi, ":").replace(/%40/gi, "@").replace(/%24/g, "$").replace(/%26/g, "&").replace(/%2B/gi, "+").replace(/%2C/gi, ",").replace(/%3B/gi, ";").replace(/%3D/gi, "=");
}, yn = (e) => e.split("/").map(vn).join("/"), bn = (e) => {
	if (e.startsWith("//")) {
		let t = e.indexOf("/", 2);
		return t === -1 ? {
			prefix: e,
			pathname: ""
		} : {
			prefix: e.slice(0, t),
			pathname: e.slice(t)
		};
	}
	let t = e.match(hn);
	if (t) {
		let n = e.indexOf("/", t[0].length);
		return n === -1 ? {
			prefix: e,
			pathname: ""
		} : {
			prefix: e.slice(0, n),
			pathname: e.slice(n)
		};
	}
	return gn.test(e) ? {
		prefix: e,
		pathname: ""
	} : {
		prefix: "",
		pathname: e
	};
}, xn = (e) => {
	let t = e?.trim();
	if (!t) return null;
	let n = _n(t), r = n === -1 ? t : t.slice(0, n), i = n === -1 ? "" : t.slice(n), { prefix: a, pathname: o } = bn(r);
	return o ? `${a}${yn(o)}${i}` : `${a}${i}`;
}, Sn = "--file-viewer-render-surface-background", Cn = "file-render-host", wn = "file-render-shadow-target", Tn = (e) => {
	if (typeof e != "string") return null;
	let t = e.trim();
	return t && t.toLowerCase() !== "auto" ? t : null;
}, En = (e, t) => {
	if (!e) return null;
	let n = Tn(t?.ui?.surfaceBackground);
	return n ? e.style.setProperty(Sn, n) : e.style.removeProperty(Sn), n;
}, X = (e) => !e || typeof e != "object" ? !1 : typeof ShadowRoot < "u" && e instanceof ShadowRoot || e.nodeType === 11 && !!e.host, Dn = (e) => (e?.getRootNode)?.call(e) || null, On = (e) => {
	if (!e) return null;
	if (X(e)) return e;
	let t = e.getRootNode?.call(e);
	return X(t) ? t : null;
}, kn = (e) => e === "shadow" || e === "scoped" || e === "none" ? e : "auto", An = (e, t) => {
	let n = kn(e?.styleIsolation);
	return n === "auto" ? X(Dn(t)) ? "scoped" : "none" : n === "shadow" && X(Dn(t)) ? "scoped" : n;
}, jn = (e, t = {}) => {
	let n = e.ownerDocument.createElement("div");
	return n.className = t.className || "file-render", n.style.width = "100%", n.style.minWidth = "0", n.style.minHeight = "0", e.appendChild(n), n;
}, Mn = (e, t = {}) => {
	let n = An({ styleIsolation: t.styleIsolation }, e), r = t.className || "file-render";
	if (n === "shadow" && typeof e.attachShadow == "function") {
		let t = e.ownerDocument.createElement("div");
		t.className = `${Cn} ${r}`, t.dataset.fileViewerStyleIsolation = "shadow", t.style.width = "100%", t.style.minWidth = "0", t.style.minHeight = "0";
		let i = t.attachShadow({ mode: "open" }), a = e.ownerDocument.createElement("div");
		return a.className = `${wn} ${r}`, a.dataset.fileViewerStyleIsolation = "shadow", a.style.width = "100%", a.style.minWidth = "0", a.style.minHeight = "0", i.appendChild(a), e.appendChild(t), {
			host: t,
			container: a,
			shadowRoot: i,
			styleIsolation: n
		};
	}
	let i = jn(e, { className: r });
	return i.dataset.fileViewerStyleIsolation = n, {
		host: i,
		container: i,
		styleIsolation: n
	};
}, Nn = (e, t) => {
	let n = e.ownerDocument.createElement("style");
	return n.textContent = t, e.appendChild(n), n;
}, Pn = (e) => {
	let t = e.ownerDocument.defaultView?.CSSStyleSheet ?? (typeof CSSStyleSheet < "u" ? CSSStyleSheet : void 0);
	return "adoptedStyleSheets" in e && t && typeof t.prototype.replaceSync == "function" ? t : null;
}, Fn = (e, t, n = {}) => {
	let r = On(e), i = r ? Pn(r) : null;
	if (n.adoptedStyleSheet && r && i) {
		let e = new i();
		return e.replaceSync(t), r.adoptedStyleSheets = [...r.adoptedStyleSheets, e], {
			sheet: e,
			remove() {
				r.adoptedStyleSheets = r.adoptedStyleSheets.filter((t) => t !== e);
			}
		};
	}
	let a = Nn((X(e), e), t);
	return {
		node: a,
		remove() {
			a.remove();
		}
	};
}, In = (e, t) => t.parentNode === e && (e.removeChild(t), !0), Ln = () => ({
	session: null,
	exportAdapter: null,
	thumbnailAdapter: null
}), Z = (e, t) => ("session" in t && (e.session = t.session ?? null), "exportAdapter" in t && (e.exportAdapter = t.exportAdapter ?? null), "thumbnailAdapter" in t && (e.thumbnailAdapter = t.thumbnailAdapter ?? null), e), Rn = (e, t) => ({
	rendered: e,
	destroy: () => t ? t() : zn(e)
}), zn = (e) => {
	if (!e || typeof e != "object") return;
	let t = e;
	if (typeof t.unmount == "function") return t.unmount();
	if (typeof t.$destroy == "function") return t.$destroy();
	if (typeof t.destroy == "function") return t.destroy();
}, Bn = ({ source: e, surface: t, options: n, signal: r, registerExportAdapter: i, registerThumbnailAdapter: a, renderContext: o }) => ({
	filename: e.filename,
	url: e.url,
	streamUrl: e.url,
	signal: r,
	options: n,
	surface: t,
	registerExportAdapter: i,
	registerThumbnailAdapter: a,
	...o
}), Vn = ({ handler: e, rendererId: t, getTarget: n = (e) => e.surface.container, createContext: r = Bn, destroy: i }) => async (a) => {
	let { source: o } = a;
	if (!o.buffer) throw Error("FileRenderHandler renderer requires an ArrayBuffer source.");
	let s = n(a), c = r(a), l = await e(o.buffer, s, o.extension, c), d = u(s), f = d ? null : Ae({
		host: s,
		renderer: t || o.extension
	}), p = d || f?.provider || null;
	return a.options.initialViewState && p?.applyState && await p.applyState(a.options.initialViewState, {
		action: "restore",
		source: "initial"
	}), Rn(l, () => {
		let e = () => i ? i(l, a) : zn(l);
		try {
			f?.destroy();
		} finally {
			return e();
		}
	});
}, Hn = ({ definitions: e = E, handlers: t, getTarget: n, createContext: r, destroy: i }) => {
	let a = ft(e), o = wt({
		registry: a,
		handlers: t
	});
	return {
		registry: ft(a.list().map((e) => {
			let t = o.handlersByRendererId.get(e.id);
			return t ? {
				...e,
				load: Vn({
					handler: t,
					rendererId: e.id,
					getTarget: n,
					createContext: r,
					destroy: i
				})
			} : e;
		})),
		dispatcher: o,
		missingRendererIds: o.missingRendererIds
	};
}, Un = (e) => ({
	$el: e,
	unmount() {}
}), Wn = [{
	rendererId: "image",
	handler: async (e, t, n, r) => {
		let { default: i } = await import("./image-D4iWXlvE.js");
		return i(e, t, n, r);
	}
}], Gn = ["image"], Kn = Wn.filter((e) => Gn.includes(e.rendererId)), qn = E.filter((e) => Gn.includes(e.id)), Jn = (e) => e === "none" ? [] : e === "lite" ? qn : E, Yn = (e) => e === "none" ? [] : e === "lite" ? Kn : Wn, Xn = async (e, t, n, r) => {
	let i = sn(n, void 0, r?.options), a = document.createElement("div");
	a.style.textAlign = "center", a.style.marginTop = "80px";
	let o = document.createElement("div");
	if (o.textContent = i.message, a.appendChild(o), i.description) {
		let e = document.createElement("div");
		e.textContent = i.description, a.appendChild(e);
	}
	return t.replaceChildren(a), Un(t);
}, Zn = (e = {}) => {
	let t = e.builtinRenderers || "all", n = Hn({
		definitions: Jn(t),
		handlers: Yn(t)
	});
	return {
		...n,
		dispatcher: wt({
			registry: n.registry,
			handlers: Wn,
			fallbackHandler: Xn
		})
	};
}, Qn = Zn(), $n = Qn.registry;
Qn.dispatcher, Qn.missingRendererIds;
// ../../node_modules/@file-viewer/core/dist/features/watermark.js
var er = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), tr = (e) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(e)}")`, Q = (e, t, n, r) => Math.min(r, Math.max(n, typeof e == "number" && Number.isFinite(e) ? e : t)), nr = (e) => e ? e === !0 ? {
	enabled: !0,
	text: "Flyfish Viewer"
} : e.enabled === !1 || !e.text && !e.image ? null : {
	enabled: !0,
	...e
} : null, rr = (e) => {
	let t = Q(e.gapX, 260, 96, 800), n = Q(e.gapY, 180, 80, 800), r = Q(e.width, e.image ? 160 : 220, 32, t), i = Q(e.height, (e.image, 72), 24, n), a = Q(e.rotate, -24, -75, 75), o = Q(e.opacity, .18, .02, .8), s = (t - r) / 2, c = (n - i) / 2, l = t / 2, u = n / 2;
	if (e.image) return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${n}" viewBox="0 0 ${t} ${n}"><g opacity="${o}" transform="rotate(${a} ${l} ${u})"><image href="${er(e.image)}" x="${s}" y="${c}" width="${r}" height="${i}" preserveAspectRatio="xMidYMid meet"/></g></svg>`;
	let d = er(e.text || "Flyfish Viewer"), f = Q(e.fontSize, 20, 10, 72);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${n}" viewBox="0 0 ${t} ${n}"><g opacity="${o}" transform="rotate(${a} ${l} ${u})"><text x="${l}" y="${u}" text-anchor="middle" dominant-baseline="middle" fill="${er(e.color || "#355070")}" font-family="${er(e.fontFamily || "Aptos, 'Segoe UI', sans-serif")}" font-size="${f}" font-weight="700">${d}</text></g></svg>`;
}, ir = (e) => {
	let t = nr(e);
	return t ? tr(rr(t)) : "";
}, ar = (e) => {
	let t = ir(e);
	return t ? `position:absolute;inset:0;pointer-events:none;background-image:${t};background-repeat:repeat;z-index:20;` : "";
}, or = async (e) => {
	let { openFileViewerPrintMaskDesigner: t } = await import("./print-mask-CPgpxlnx.js");
	return t(e);
}, $ = async (e, t, n, r, i, a, o) => {
	let s = Pt({
		phase: n,
		source: r,
		version: i,
		timestamp: Date.now(),
		startedAt: a,
		reason: o
	});
	await Lt(s, e.hooks, (e) => {
		throw e;
	}), t?.({
		type: n,
		payload: s
	});
}, sr = (e, t) => t.rendererMode === "replace" ? ft([]) : e.registry ? e.registry : Zn({ builtinRenderers: t.builtinRenderers }).registry, cr = (e) => {
	let t = e.autoRenderers;
	return typeof t == "boolean" ? t : t?.enabled === void 0 ? (e.rendererMode || "extend") !== "replace" : t.enabled;
}, lr = (e, t) => {
	if (!e) return t.find((e) => e);
	let n = [];
	e.signal.addEventListener("abort", () => n.splice(0).forEach((e) => e()), { once: !0 });
	for (let r of t) {
		if (!r) continue;
		if (r.aborted) {
			e.abort(r.reason);
			break;
		}
		let t = () => e.abort(r.reason);
		r.addEventListener("abort", t, { once: !0 }), n.push(() => r.removeEventListener("abort", t));
	}
	return e.signal;
}, ur = (e, t, n) => {
	let r = e.ownerDocument, i = sn(t, void 0, n), a = r.createElement("div");
	a.className = "file-viewer-missing-renderer", a.style.cssText = "display:flex;min-height:260px;height:100%;align-items:center;justify-content:center;padding:32px;box-sizing:border-box;text-align:center;color:#64748b;font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif";
	let o = r.createElement("div"), s = r.createElement("strong");
	s.textContent = i.message, s.style.cssText = "display:block;margin-bottom:8px;color:#172033;font-size:16px;";
	let c = r.createElement("p");
	c.textContent = i.description || i.title, c.style.cssText = "max-width:520px;margin:0;", o.append(s, c), a.append(o), e.replaceChildren(a);
}, dr = (e, r = {}) => {
	let i = r.options || {}, a = sr(r, i), s, c, l, u = i.rendererMode || "extend", f = i.builtinRenderers || "all", p = cr(i), m = -1, h = null, g = null, _ = null, v = Ln(), y = mn(), b = {
		anchors: { value: [] },
		state: n()
	}, x = null, S = !1, C = null, w = null, T = null, E = () => e.ownerDocument.defaultView || (typeof window < "u" ? window : void 0), D = () => {
		if (T === null) return;
		let e = E();
		e?.cancelAnimationFrame && e.cancelAnimationFrame(T), T = null;
	}, O = () => {
		if (T = null, !x || x.parentElement !== e) return;
		let t = x.style.display;
		x.style.display = "none";
		let n = Math.max(e.scrollWidth, e.clientWidth), r = Math.max(e.scrollHeight, e.clientHeight);
		x.style.display = t, x.style.width = `${n}px`, x.style.height = `${r}px`;
	}, k = () => {
		if (!x) return;
		D();
		let e = E();
		e?.requestAnimationFrame ? T = e.requestAnimationFrame(O) : O();
	}, A = () => {
		D(), C?.disconnect(), C = null, w?.disconnect(), w = null;
	}, j = () => {
		A();
		let t = E();
		t?.ResizeObserver && (C = new t.ResizeObserver(() => k()), C.observe(e)), t?.MutationObserver && (w = new t.MutationObserver((e) => {
			e.every((e) => x && (e.target === x || x.contains(e.target))) || k();
		}), w.observe(e, {
			attributes: !0,
			childList: !0,
			subtree: !0
		})), k();
	}, M = () => {
		A(), x?.remove(), x = null, S &&= (e.style.position = "", !1);
	}, N = (t = g) => {
		t && (In(e, t), g === t && (g = null));
	}, ee = (t = !0) => {
		let n = Mn(e, { styleIsolation: i.styleIsolation }), r = n.host || n.container;
		return t && (r.style.height = "100%", n.container.style.height = "100%"), En(r, i), g = r, n;
	}, ne = async (e, t) => {
		try {
			await (e?.destroy)?.call(e);
		} finally {
			N(t);
		}
	}, re = () => {
		let t = ar(i.watermark);
		if (!t) {
			M();
			return;
		}
		x && x.ownerDocument === e.ownerDocument || (x = e.ownerDocument.createElement("div"), x.className = "viewer-watermark", x.setAttribute("aria-hidden", "true")), x.style.cssText = t;
		let n = E();
		n?.getComputedStyle && n.getComputedStyle(e).position === "static" && !e.style.position && (e.style.position = "relative", S = !0), x.parentElement !== e && e.appendChild(x), j();
	}, ie = async () => {
		let e = i.rendererMode || "extend", t = i.renderers, n = i.preset, o = i.presets, d = i.builtinRenderers || "all", h = cr(i), g = h || xt(n) || xt(o) ? bt() : 0;
		if (e === u && t === s && n === c && o === l && d === f && h === p && g === m) return;
		a = sr(r, i), u = e, s = t, c = n, l = o, f = d, p = h, m = g;
		let _ = [];
		h && _.push(...vt()), _.push(...St(n), ...St(o)), t && _.push(t);
		let v = mt(_);
		v.length && await Ct({
			registry: a,
			plugins: v,
			registerHandler: (e) => {
				let t = a.getById(e.rendererId);
				t && a.register({
					...t,
					load: Vn({
						handler: e.handler,
						rendererId: t.id,
						getTarget: (e) => e.surface.container
					})
				});
			}
		});
	}, P = () => Pt({
		phase: "load-complete",
		source: h || te({}),
		version: y.getCurrentVersion(),
		timestamp: Date.now()
	}), F = async (e) => Gt({
		context: Ft(e, P()),
		options: i,
		onBefore: (e) => {
			var t;
			(t = r.onEvent) == null || t.call(r, {
				type: "operation-before",
				payload: e
			});
		},
		onCancel: (e) => {
			var t;
			(t = r.onEvent) == null || t.call(r, {
				type: "operation-cancel",
				payload: e
			});
		},
		onError(e) {
			throw e;
		}
	}), I = (e) => typeof e == "string" ? e : ar(i.watermark), L = (e) => {
		let t = e || h?.extension || "", n = a.getByExtension(t), r = B.getState();
		return Dt(n ? Et(n, v.session) : Ot(t), r);
	}, ae = () => {
		var e;
		(e = r.onEvent) == null || e.call(r, {
			type: "operation-availability-change",
			payload: L()
		});
	}, oe = (e = B.getState()) => {
		var t;
		(t = r.onEvent) == null || t.call(r, {
			type: "zoom-change",
			payload: e
		});
	}, R = (e = B.getState()) => {
		oe(e), ae();
	}, z = (e) => {
		var t;
		(t = r.onEvent) == null || t.call(r, {
			type: "fit-change",
			payload: e
		});
	}, B = t({
		root: () => _ || e,
		beforeZoom: F,
		onChange: (e) => R(e)
	}), V = d({
		root: () => _ || e,
		getFit: () => i.fit,
		onFit: (e) => {
			B.refreshProvider(), H.refreshProvider(), R(), z(e);
		}
	}), H = Me({
		root: () => _ || e,
		onChange: (e) => {
			var t;
			(e.source === "user" || e.source === "api") && e.action !== "fit" && V.markUserInteraction(), (t = r.onEvent) == null || t.call(r, {
				type: "view-state-change",
				payload: e
			});
		}
	}), U = be({
		root: () => _ || e,
		searchTarget: b,
		searchOptions: () => i.search,
		getAiOptions: () => i.ai,
		onSearchChange: (e) => {
			var t;
			(t = r.onEvent) == null || t.call(r, {
				type: "search-change",
				payload: e
			});
		},
		onLocationChange: (e) => {
			var t;
			(t = r.onEvent) == null || t.call(r, {
				type: "location-change",
				payload: e
			});
		}
	});
	B.observe(), H.observe(), V.observe();
	let W = async (e = "replace") => {
		let t = v.session, n = g;
		if (!h && !t && !n) return;
		let a = h, o = Date.now(), s = y.getCurrentVersion();
		a && await $(i, r.onEvent, "unload-start", a, s, o, e), await (t?.destroy)?.call(t), N(n || void 0), h = null, _ = null, Z(v, {
			session: null,
			exportAdapter: null,
			thumbnailAdapter: null
		}), M(), await U.clearDocumentState(), B.clearProvider(), H.clearProvider(), V.resetAutoFit(), R(), a && await $(i, r.onEvent, "unload-complete", a, s, o, e);
	}, se = {
		container: e,
		async prepare() {
			await ie();
		},
		async load(e, t = {}) {
			let n = y.requestController.createVersion(), s = lr(y.requestController.createAbortController(), [r.signal, t.signal]);
			if (await W("replace"), await ie(), !y.isCurrentRequest(n)) return null;
			let c = te(e);
			h = c;
			let l = a.getByExtension(c.extension), u = Date.now();
			await $(i, r.onEvent, "load-start", c, n, u);
			let d = ee(l?.id !== "office-presentation" && l?.id !== "office-presentation-binary"), f = d.container, p = d.host || f;
			if (_ = f, !l?.load) return ur(f, c.extension, i), Z(v, { session: null }), re(), R(), await $(i, r.onEvent, "load-complete", c, n, u), null;
			let m;
			try {
				m = await l.load({
					source: c,
					surface: d,
					options: i,
					signal: s,
					registerExportAdapter: (e) => {
						y.isCurrentRequest(n) && Z(v, { exportAdapter: e });
					},
					registerThumbnailAdapter: (e) => {
						y.isCurrentRequest(n) && Z(v, { thumbnailAdapter: e });
					},
					renderContext: { renderPurpose: r.renderPurpose || "preview" }
				});
			} catch (e) {
				if (!y.isCurrentRequest(n)) return N(p), null;
				throw N(p), e;
			}
			return y.isCurrentRequest(n) ? (Z(v, { session: m }), re(), B.refreshProvider(), H.refreshProvider(), await U.refreshDocumentIndex({ notify: !1 }), await V.applyInitialFit({ skip: o(i.initialViewState) }), B.refreshProvider(), H.refreshProvider(), R(), await $(i, r.onEvent, "load-complete", c, n, u), m) : (await ne(m, p), null);
		},
		async unload(e = "replace") {
			y.requestController.createVersion(), await W(e);
		},
		async destroy(e = "component-unmount") {
			y.requestController.createVersion(), await W(e), U.destroyDocumentFeatures(), B.destroy(), H.destroy(), V.destroy(), M();
		},
		updateOptions(e) {
			let t = i.fit;
			i = {
				...i,
				...e
			}, En(g, i), re(), "fit" in e && e.fit !== t && (V.resetAutoFit(), V.scheduleFit("resize"));
		},
		getCapabilities(e) {
			return L(e);
		},
		getRenderer(e) {
			return a.getByExtension(e || h?.extension || "");
		},
		getSource() {
			return h;
		},
		registerExportAdapter(e) {
			Z(v, { exportAdapter: e });
		},
		getExportAdapter() {
			return v.exportAdapter;
		},
		registerThumbnailAdapter(e) {
			Z(v, { thumbnailAdapter: e });
		},
		getThumbnailAdapter() {
			return v.thumbnailAdapter;
		},
		async download(e = {}) {
			let t = nt(h);
			await st({
				source: t,
				filename: e.filename || q({
					source: t,
					fallback: Ze
				}),
				beforeOperation: F
			});
		},
		async exportHtml(t = {}) {
			return ct({
				source: e,
				adapter: v.exportAdapter,
				download: t.download,
				filename: t.filename || q({
					filename: tt(h),
					fallback: "preview"
				}),
				title: t.title || q({
					filename: tt(h),
					fallback: "file-viewer-preview"
				}),
				watermarkInlineStyle: I(t.watermarkInlineStyle),
				beforeOperation: F
			});
		},
		async print(t = {}) {
			await lt({
				source: e,
				adapter: v.exportAdapter,
				autoPrint: t.autoPrint,
				openWindow: t.openWindow,
				printWindow: t.printWindow,
				title: t.title || q({
					filename: tt(h),
					fallback: "file-viewer-preview"
				}),
				watermarkInlineStyle: I(t.watermarkInlineStyle),
				mask: t.mask,
				printAvailable: L().print,
				beforeOperation: F
			});
		},
		async printWithMask(t = {}) {
			var n;
			let r = await or({
				root: e,
				pages: ((n = v.exportAdapter)?.getPrintMaskPages)?.call(n),
				i18n: i,
				color: t.mask?.color,
				initialRegions: t.mask?.regions,
				initialStamps: t.mask?.stamps
			});
			r?.mask && await se.print({
				...t,
				mask: r.mask
			});
		},
		async zoomIn() {
			V.markUserInteraction();
			let e = await B.zoomIn();
			return R(e), e;
		},
		async zoomOut() {
			V.markUserInteraction();
			let e = await B.zoomOut();
			return R(e), e;
		},
		async resetZoom() {
			V.markUserInteraction();
			let e = await B.resetZoom();
			return R(e), e;
		},
		async fitToView(e) {
			let t = await V.fit(e, {
				source: "api",
				reason: "api"
			});
			return B.refreshProvider(), H.refreshProvider(), R(), t;
		},
		getZoomState() {
			return B.getState();
		},
		getViewState() {
			return H.getState();
		},
		applyViewState(e, t) {
			return V.markUserInteraction(), H.applyState(e, t);
		},
		search(e) {
			return U.searchDocument(e);
		},
		nextSearchResult() {
			return U.nextSearchResult();
		},
		previousSearchResult() {
			return U.previousSearchResult();
		},
		clearSearch() {
			return U.clearDocumentSearch();
		},
		getSearchState() {
			return U.getSearchState();
		},
		collectDocumentAnchors() {
			return U.collectDocumentAnchors({ notify: !1 });
		},
		getCurrentDocumentAnchor() {
			return U.getCurrentDocumentAnchor();
		},
		scrollToDocumentAnchor(e) {
			return U.scrollToLoadedAnchor(e);
		},
		scrollToLine(e) {
			return U.scrollToLine(e);
		},
		getDocumentTextChunks(e) {
			return U.getDocumentTextChunks(e);
		}
	};
	return se;
};
export { A as C, ne as D, ee as E, E as O, D as S, re as T, Dt as _, X as a, we as b, fn as c, Jt as d, Yt as f, qt as g, Xt as h, On as i, xn as l, Ut as m, $n as n, kn as o, Kt as p, Fn as r, En as s, dr as t, dn as u, gt as v, j as w, Te as x, ze as y };
