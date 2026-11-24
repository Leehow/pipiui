// ../../node_modules/@file-viewer/core/dist/config/options.js
var e = (e) => e === "light" || e === "dark" || e === "system" ? e : "system", t = () => typeof globalThis.matchMedia == "function" && globalThis.matchMedia("(prefers-color-scheme: dark)").matches, n = (n, r = t()) => {
	let i = e(n);
	return i === "system" ? r ? "dark" : "light" : i;
}, r = (e, r = t()) => n(e, r) === "dark" ? "light" : "dark", i = (e) => e === "compact" ? "compact" : "comfortable";
export { r as i, i as n, n as r, e as t };
