// ../../node_modules/@file-viewer/core/dist/features/printMask.js
var e = (e) => Math.max(0, Math.min(100, e)), t = (t) => {
	if (!t) return null;
	let n = t.pageIndex;
	if (n !== void 0 && (!Number.isInteger(n) || n < 0)) return null;
	let r = e(Number(t.left) || 0), i = e(Number(t.top) || 0), a = e(Number(t.width) || 0), o = e(Number(t.height) || 0);
	return a <= 0 || o <= 0 ? null : {
		left: r,
		top: i,
		width: Math.min(a, 100 - r),
		height: Math.min(o, 100 - i),
		...n === void 0 ? {} : { pageIndex: n }
	};
}, n = (e) => {
	if (typeof e != "string") return "";
	let t = e.trim();
	return /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);/i.test(t) || /^(?:blob:|https?:\/\/|\/|\.\.?\/)/i.test(t) ? t : "";
}, r = (e) => {
	let t = Number(e);
	return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
}, i = (e) => {
	let t = Number(e);
	return Number.isFinite(t) ? (t % 360 + 360) % 360 : 0;
}, a = (e) => {
	let a = t(e), o = n(e?.src);
	return !a || !o ? null : {
		...a,
		src: o,
		opacity: r(e?.opacity),
		rotate: i(e?.rotate),
		...typeof e?.alt == "string" && e.alt.trim() ? { alt: e.alt.trim() } : {}
	};
}, o = (e) => {
	if (!e) return null;
	let n = (e.regions || []).map((e) => t(e)).filter((e) => !!e), r = (e.stamps || []).map((e) => a(e)).filter((e) => !!e);
	return !n.length && !r.length ? null : {
		...n.length ? { regions: n } : {},
		...r.length ? { stamps: r } : {},
		color: e.color || "#000000"
	};
}, s = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), c = (e, t = !1) => {
	let n = o(e);
	if (!n) return "";
	let r = n.color || "#000000", i = (n.regions || []).map((e) => `<div class="viewer-export-print-mask-block" style="left:${e.left}%;top:${e.top}%;width:${e.width}%;height:${e.height}%;background:${r};"></div>`).join(""), a = (n.stamps || []).map((e) => `<img class="viewer-export-print-stamp" src="${s(e.src)}" alt="${s(e.alt || "")}" draggable="false" style="left:${e.left}%;top:${e.top}%;width:${e.width}%;height:${e.height}%;opacity:${e.opacity ?? 1};transform:rotate(${e.rotate ?? 0}deg);" />`).join("");
	return `<div class="${t ? "viewer-export-print-mask viewer-export-print-mask--page" : "viewer-export-print-mask"}" aria-hidden="true">${i}${a}</div>`;
}, l = "\n  .viewer-export-print-mask{position:absolute;inset:0;z-index:15;pointer-events:none;print-color-adjust:exact;-webkit-print-color-adjust:exact;}\n  .viewer-export-print-mask--page{z-index:2147483647;}\n  .viewer-export-print-mask-block{position:absolute;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact;}\n  .viewer-export-print-stamp{position:absolute;display:block;object-fit:contain;transform-origin:center center;print-color-adjust:exact;-webkit-print-color-adjust:exact;}\n  [data-viewer-print-page-index]{position:relative!important;isolation:isolate;}\n", u = (e, t) => {
	var n, r;
	let i = o(t);
	if (!i) return e;
	let a = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Map();
	return (n = i.regions) == null || n.forEach((e) => {
		if (e.pageIndex === void 0) return;
		let t = a.get(e.pageIndex) || [];
		t.push(e), a.set(e.pageIndex, t);
	}), (r = i.stamps) == null || r.forEach((e) => {
		if (e.pageIndex === void 0) return;
		let t = s.get(e.pageIndex) || [];
		t.push(e), s.set(e.pageIndex, t);
	}), !a.size && !s.size ? e : e.replace(/(<[A-Za-z][^>]*\sdata-viewer-print-page-index=(['"])(\d+)\2[^>]*>)/g, (e, t, n, r) => {
		let o = a.get(Number(r)), l = s.get(Number(r));
		return !o?.length && !l?.length ? e : `${t}${c({
			regions: o || [],
			stamps: l || [],
			color: i.color
		}, !0)}`;
	});
};
export { t as a, o as i, u as n, a as o, c as r, l as t };
