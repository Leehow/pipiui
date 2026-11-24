import { c as e, l as t } from "./assets-zhNBPlbx.js";
import "./dist-BZCS2h0l.js";
import { d as n, i as r, m as i, r as a } from "./fit-OBfTsFJi.js";
import { t as o } from "./messages-DuQwbmFt.js";
import { r as s } from "./options-LE2kKZFb.js";
// ../../node_modules/@file-viewer/core/dist/platform/worker.js
var c = (e, t = {}) => {
	let n = e(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Set(), o = (e, t) => {
		n?.postMessage({
			type: e,
			payload: t
		});
	}, s = (e) => {
		let { type: t, payload: n } = e.data || {};
		r.get(t)?.forEach((e) => e(n)), i.forEach((t) => t(e));
	}, c = (e) => {
		t.logErrors !== !1 && console.error(e), a.forEach((t) => t(e));
	};
	return n?.addEventListener("message", s), n?.addEventListener("error", c), {
		instance: n,
		worker: { emit: o },
		emit: o,
		onWorkerMessage(e) {
			return i.add(e), () => {
				i.delete(e);
			};
		},
		onWorkerError(e) {
			return a.add(e), () => {
				a.delete(e);
			};
		},
		onWorkerEvent(e, t) {
			let n = r.get(e);
			return n || (n = /* @__PURE__ */ new Set(), r.set(e, n)), n.add(t), () => {
				n?.delete(t), n?.size === 0 && r.delete(e);
			};
		},
		mapEvents(e) {
			return Array.isArray(e) ? e.reduce((e, t) => (e[t] = (e) => o(t, e), e), {}) : Object.keys(e).reduce((t, n) => {
				let r = e[n];
				return t[r] = (e) => o(n, e), t;
			}, {});
		},
		destroy() {
			n?.removeEventListener("message", s), n?.removeEventListener("error", c), n?.terminate(), r.clear(), i.clear(), a.clear();
		}
	};
}, l = "http://www.w3.org/2000/svg", u = [
	"#4472c4",
	"#ed7d31",
	"#70ad47",
	"#ffc000",
	"#5b9bd5",
	"#a5a5a5"
], d = (e, t, n = {}) => {
	let r = e.createElementNS(l, t);
	return Object.entries(n).forEach(([e, t]) => r.setAttribute(e, `${t}`)), r;
}, f = (e, t, n, r, i = {}) => {
	let a = d(e, "text", {
		x: n,
		y: r,
		"text-anchor": i.anchor || "start",
		"font-family": "Aptos, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
		"font-size": i.size || 11,
		"font-weight": i.weight || "400",
		fill: i.fill || "#5f6368"
	});
	return i.rotate && a.setAttribute("transform", `rotate(${i.rotate} ${n} ${r})`), a.textContent = t, a;
}, p = (e, t) => e.color || u[t % u.length], m = (e) => {
	let t = e.series.find((e) => e.categories.length)?.categories || [], n = Math.max(0, ...e.series.map((e) => e.values.length));
	return t.length ? t : Array.from({ length: n }, (e, t) => `${t + 1}`);
}, h = (e) => {
	let t = e.series.flatMap((e) => e.values).filter(Number.isFinite), n = Math.min(0, ...t), r = Math.max(0, ...t);
	return n === r ? {
		min: 0,
		max: Math.max(1, r),
		span: Math.max(1, r)
	} : {
		min: n,
		max: r,
		span: r - n
	};
}, ee = (e) => {
	let t = !!e.title, n = !!e.legendPosition, r = e.legendPosition === "right", i = t ? 48 : 24, a = n && !r ? 302 : 326, o = e.valueAxisTitle ? 76 : 58;
	return {
		left: o,
		top: i,
		width: (r ? 492 : 612) - o,
		height: a - i,
		bottom: a
	};
}, g = (e, t, n, r) => {
	for (let i = 0; i <= 5; i += 1) {
		let a = i / 5, o = n.bottom - a * n.height, s = r.min + a * r.span;
		t.appendChild(d(e, "line", {
			x1: n.left,
			y1: o,
			x2: n.left + n.width,
			y2: o,
			stroke: i === 0 ? "#9ca3af" : "#e5e7eb",
			"stroke-width": 1
		})), t.appendChild(f(e, Number.isInteger(s) ? `${s}` : s.toFixed(1), n.left - 8, o + 4, {
			anchor: "end",
			size: 10
		}));
	}
}, _ = (e, t, n, r) => {
	let i = m(n);
	if (!i.length) return;
	let a = r.width / i.length;
	i.forEach((n, o) => {
		let s = i.length > 8 ? 8 : 14, c = n.length > s ? `${n.slice(0, s - 1)}…` : n;
		t.appendChild(f(e, c, r.left + (o + .5) * a, r.bottom + 17, {
			anchor: "middle",
			size: 10
		}));
	});
}, te = (e, t, n, r) => {
	let i = h(n), a = m(n), o = Math.max(a.length, ...n.series.map((e) => e.values.length), 1), s = r.width / o, c = Math.max(n.series.length, 1), l = s * .76 / c, u = r.bottom - (0 - i.min) / i.span * r.height;
	g(e, t, r, i), n.series.forEach((n, a) => {
		n.values.forEach((o, c) => {
			let f = r.bottom - (o - i.min) / i.span * r.height, m = d(e, "rect", {
				x: r.left + c * s + s * .12 + a * l,
				y: Math.min(u, f),
				width: Math.max(1, l - 2),
				height: Math.max(1, Math.abs(u - f)),
				fill: p(n, a),
				rx: 1
			}), h = d(e, "title");
			h.textContent = `${n.name}: ${o}`, m.appendChild(h), t.appendChild(m);
		});
	}), _(e, t, n, r);
}, ne = (e, t, n, r) => {
	let i = h(n), a = m(n), o = Math.max(a.length, ...n.series.map((e) => e.values.length), 1), s = r.height / o, c = Math.max(n.series.length, 1), l = s * .76 / c, u = r.left + (0 - i.min) / i.span * r.width;
	for (let n = 0; n <= 5; n += 1) {
		let i = n / 5, a = r.left + i * r.width;
		t.appendChild(d(e, "line", {
			x1: a,
			y1: r.top,
			x2: a,
			y2: r.bottom,
			stroke: "#e5e7eb",
			"stroke-width": 1
		}));
	}
	n.series.forEach((n, a) => {
		n.values.forEach((o, c) => {
			let f = r.left + (o - i.min) / i.span * r.width, m = r.top + c * s + s * .12 + a * l;
			t.appendChild(d(e, "rect", {
				x: Math.min(u, f),
				y: m,
				width: Math.max(1, Math.abs(f - u)),
				height: Math.max(1, l - 2),
				fill: p(n, a),
				rx: 1
			}));
		});
	}), a.forEach((n, i) => {
		t.appendChild(f(e, n, r.left - 8, r.top + (i + .5) * s + 4, {
			anchor: "end",
			size: 10
		}));
	});
}, v = (e, t, n, r, i) => {
	let a = h(n), o = Math.max(...n.series.map((e) => e.values.length), 1), s = o > 1 ? r.width / (o - 1) : r.width;
	g(e, t, r, a), n.series.forEach((n, c) => {
		let l = n.values.map((e, t) => ({
			x: r.left + (o > 1 ? t * s : r.width / 2),
			y: r.bottom - (e - a.min) / a.span * r.height
		}));
		if (!l.length) return;
		let u = l.map((e, t) => `${t ? "L" : "M"}${e.x},${e.y}`).join(" ");
		i && l.length > 1 && t.appendChild(d(e, "path", {
			d: `${u} L${l[l.length - 1].x},${r.bottom} L${l[0].x},${r.bottom} Z`,
			fill: p(n, c),
			opacity: .2
		})), t.appendChild(d(e, "path", {
			d: u,
			fill: "none",
			stroke: p(n, c),
			"stroke-width": 2.5,
			"stroke-linejoin": "round",
			"stroke-linecap": "round"
		})), l.forEach((r) => {
			t.appendChild(d(e, "circle", {
				cx: r.x,
				cy: r.y,
				r: 3.5,
				fill: p(n, c),
				stroke: "#ffffff",
				"stroke-width": 1
			}));
		});
	}), _(e, t, n, r);
}, y = (e, t, n, r) => {
	let i = (r - 90) * Math.PI / 180;
	return {
		x: e + n * Math.cos(i),
		y: t + n * Math.sin(i)
	};
}, re = (e, t, n, r, i, a) => {
	let o = y(e, t, n, a), s = y(e, t, n, i), c = +(a - i > 180);
	if (!r) return `M${e},${t} L${o.x},${o.y} A${n},${n} 0 ${c},0 ${s.x},${s.y} Z`;
	let l = y(e, t, r, i), u = y(e, t, r, a);
	return `M${o.x},${o.y} A${n},${n} 0 ${c},0 ${s.x},${s.y} L${l.x},${l.y} A${r},${r} 0 ${c},1 ${u.x},${u.y} Z`;
}, ie = (e, t, n, r) => {
	let i = n.series[0], a = i?.values || [], o = i?.categories || [], s = a.reduce((e, t) => e + Math.max(0, t), 0) || 1, c = n.legendPosition === "right" ? 260 : 320, l = n.title ? 180 : 170, f = 0;
	a.forEach((n, i) => {
		let a = f + Math.max(0, n) / s * 360, p = u[i % u.length], m = d(e, "path", {
			d: re(c, l, 120, r ? 62 : 0, f, a),
			fill: p,
			stroke: "#ffffff",
			"stroke-width": 1.5
		}), h = d(e, "title");
		h.textContent = `${o[i] || i + 1}: ${n}`, m.appendChild(h), t.appendChild(m), f = a;
	});
}, ae = (e, t, n) => {
	if (!n.legendPosition) return;
	let r = n.legendPosition === "right";
	n.series.slice(0, 8).forEach((n, i) => {
		let a = r ? 510 : 76 + i % 4 * 136, o = r ? 72 + i * 28 : 342 - Math.floor(i / 4) * 20;
		t.appendChild(d(e, "rect", {
			x: a,
			y: o - 10,
			width: 10,
			height: 10,
			fill: p(n, i)
		}));
		let s = n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name;
		t.appendChild(f(e, s, a + 15, o, { size: 10 }));
	});
}, oe = (e, t) => {
	let n = e.createElement("div");
	n.className = "excel-chart", n.dataset.chartId = t.id, n.dataset.chartType = t.type, n.dataset.seriesNames = JSON.stringify(t.series.map((e) => e.name)), n.setAttribute("role", "img"), n.setAttribute("aria-label", t.title || t.id || "Spreadsheet chart");
	let r = d(e, "svg", {
		viewBox: "0 0 640 360",
		preserveAspectRatio: "xMidYMid meet",
		focusable: "false",
		"aria-hidden": "true"
	});
	r.appendChild(d(e, "rect", {
		x: .5,
		y: .5,
		width: 639,
		height: 359,
		fill: "#ffffff",
		stroke: "#d1d5db"
	})), t.title && r.appendChild(f(e, t.title, 320, 28, {
		anchor: "middle",
		size: 16,
		weight: "600",
		fill: "#1f2937"
	}));
	let i = ee(t);
	switch (t.type) {
		case "pie":
			ie(e, r, t, !1);
			break;
		case "doughnut":
			ie(e, r, t, !0);
			break;
		case "line":
		case "scatter":
		case "radar":
			v(e, r, t, i, !1);
			break;
		case "area":
			v(e, r, t, i, !0);
			break;
		default: t.barDirection === "bar" ? ne(e, r, t, i) : te(e, r, t, i);
	}
	return t.categoryAxisTitle && t.type !== "pie" && t.type !== "doughnut" && r.appendChild(f(e, t.categoryAxisTitle, i.left + i.width / 2, 324, {
		anchor: "middle",
		size: 11,
		fill: "#374151"
	})), t.valueAxisTitle && t.type !== "pie" && t.type !== "doughnut" && r.appendChild(f(e, t.valueAxisTitle, 18, i.top + i.height / 2, {
		anchor: "middle",
		size: 11,
		fill: "#374151",
		rotate: -90
	})), ae(e, r, t), n.appendChild(r), n;
}, se = "__index", ce = {
	rowHeight: 20,
	colWidth: 64
}, b = {
	Placeholder: 0,
	Loading: 1,
	Loaded: 2
}, le = () => ({
	active: !1,
	totalRows: 0,
	totalCols: 0,
	indexOffset: 0,
	defaults: { ...ce },
	dataKeys: [],
	rows: [],
	columns: [],
	cellCache: /* @__PURE__ */ new Map(),
	mergeStartMap: /* @__PURE__ */ new Map(),
	mergeCoveredMap: /* @__PURE__ */ new Map(),
	rowHeightCache: /* @__PURE__ */ new Map(),
	windowRows: /* @__PURE__ */ new Map(),
	windowCells: /* @__PURE__ */ new Map(),
	loadedWindows: /* @__PURE__ */ new Set(),
	loadingWindows: /* @__PURE__ */ new Set()
}), x = (e, t) => `${e}-${t}`, ue = (e) => `c${e}`, de = (e) => e?.__s ?? b.Placeholder, fe = (e) => {
	let t = Array(e);
	for (let n = 0; n < e; n += 1) t[n] = {
		__k: `${n}`,
		__s: b.Placeholder
	};
	return t;
}, pe = (e) => e ? Math.floor(Math.max(e - 1, 0) / 500) * 500 : 0, me = (e = 0, t = 0) => Math.min(Math.max(e, 0), pe(t)), he = (e = 0, t = 0) => me(Math.floor(Math.max(e, 0) / 500) * 500, t), ge = ({ startRow: e, endRow: t, direction: n, totalRows: r, far: i = !1 }) => {
	let a = /* @__PURE__ */ new Set(), o = he(e, r), s = he(t, r);
	for (let e = o; e <= s; e += 500) a.add(e);
	let c = i ? 4 : 3, l = i ? 2 : 1, u = n > 0 ? s : o;
	for (let e = 1; e <= c; e += 1) a.add(me(u + n * e * 500, r));
	for (let e = 1; e <= l; e += 1) a.add(me(u - n * e * 500, r));
	return Array.from(a);
}, _e = (e, t, n, r) => {
	let i = Math.min(n + 500, t);
	for (let t = n; t < i; t += 1) {
		let n = e[t];
		n && (n.__s = r);
	}
};
// ../../node_modules/tinycolor2/esm/tinycolor.js
function S(e) {
	"@babel/helpers - typeof";
	return S = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
		return typeof e;
	} : function(e) {
		return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
	}, S(e);
}
var ve = /^\s+/, ye = /\s+$/;
function C(e, t) {
	if (e ||= "", t ||= {}, e instanceof C) return e;
	if (!(this instanceof C)) return new C(e, t);
	var n = be(e);
	this._originalInput = e, this._r = n.r, this._g = n.g, this._b = n.b, this._a = n.a, this._roundA = Math.round(100 * this._a) / 100, this._format = t.format || n.format, this._gradientType = t.gradientType, this._r < 1 && (this._r = Math.round(this._r)), this._g < 1 && (this._g = Math.round(this._g)), this._b < 1 && (this._b = Math.round(this._b)), this._ok = n.ok;
}
C.prototype = {
	isDark: function() {
		return this.getBrightness() < 128;
	},
	isLight: function() {
		return !this.isDark();
	},
	isValid: function() {
		return this._ok;
	},
	getOriginalInput: function() {
		return this._originalInput;
	},
	getFormat: function() {
		return this._format;
	},
	getAlpha: function() {
		return this._a;
	},
	getBrightness: function() {
		var e = this.toRgb();
		return (e.r * 299 + e.g * 587 + e.b * 114) / 1e3;
	},
	getLuminance: function() {
		var e = this.toRgb(), t = e.r / 255, n = e.g / 255, r = e.b / 255, i = t <= .03928 ? t / 12.92 : ((t + .055) / 1.055) ** 2.4, a = n <= .03928 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4, o = r <= .03928 ? r / 12.92 : ((r + .055) / 1.055) ** 2.4;
		return .2126 * i + .7152 * a + .0722 * o;
	},
	setAlpha: function(e) {
		return this._a = P(e), this._roundA = Math.round(100 * this._a) / 100, this;
	},
	toHsv: function() {
		var e = Ce(this._r, this._g, this._b);
		return {
			h: e.h * 360,
			s: e.s,
			v: e.v,
			a: this._a
		};
	},
	toHsvString: function() {
		var e = Ce(this._r, this._g, this._b), t = Math.round(e.h * 360), n = Math.round(e.s * 100), r = Math.round(e.v * 100);
		return this._a == 1 ? "hsv(" + t + ", " + n + "%, " + r + "%)" : "hsva(" + t + ", " + n + "%, " + r + "%, " + this._roundA + ")";
	},
	toHsl: function() {
		var e = Se(this._r, this._g, this._b);
		return {
			h: e.h * 360,
			s: e.s,
			l: e.l,
			a: this._a
		};
	},
	toHslString: function() {
		var e = Se(this._r, this._g, this._b), t = Math.round(e.h * 360), n = Math.round(e.s * 100), r = Math.round(e.l * 100);
		return this._a == 1 ? "hsl(" + t + ", " + n + "%, " + r + "%)" : "hsla(" + t + ", " + n + "%, " + r + "%, " + this._roundA + ")";
	},
	toHex: function(e) {
		return Te(this._r, this._g, this._b, e);
	},
	toHexString: function(e) {
		return "#" + this.toHex(e);
	},
	toHex8: function(e) {
		return Ee(this._r, this._g, this._b, this._a, e);
	},
	toHex8String: function(e) {
		return "#" + this.toHex8(e);
	},
	toRgb: function() {
		return {
			r: Math.round(this._r),
			g: Math.round(this._g),
			b: Math.round(this._b),
			a: this._a
		};
	},
	toRgbString: function() {
		return this._a == 1 ? "rgb(" + Math.round(this._r) + ", " + Math.round(this._g) + ", " + Math.round(this._b) + ")" : "rgba(" + Math.round(this._r) + ", " + Math.round(this._g) + ", " + Math.round(this._b) + ", " + this._roundA + ")";
	},
	toPercentageRgb: function() {
		return {
			r: Math.round(F(this._r, 255) * 100) + "%",
			g: Math.round(F(this._g, 255) * 100) + "%",
			b: Math.round(F(this._b, 255) * 100) + "%",
			a: this._a
		};
	},
	toPercentageRgbString: function() {
		return this._a == 1 ? "rgb(" + Math.round(F(this._r, 255) * 100) + "%, " + Math.round(F(this._g, 255) * 100) + "%, " + Math.round(F(this._b, 255) * 100) + "%)" : "rgba(" + Math.round(F(this._r, 255) * 100) + "%, " + Math.round(F(this._g, 255) * 100) + "%, " + Math.round(F(this._b, 255) * 100) + "%, " + this._roundA + ")";
	},
	toName: function() {
		return this._a === 0 ? "transparent" : this._a < 1 ? !1 : M[Te(this._r, this._g, this._b, !0)] || !1;
	},
	toFilter: function(e) {
		var t = "#" + De(this._r, this._g, this._b, this._a), n = t, r = this._gradientType ? "GradientType = 1, " : "";
		if (e) {
			var i = C(e);
			n = "#" + De(i._r, i._g, i._b, i._a);
		}
		return "progid:DXImageTransform.Microsoft.gradient(" + r + "startColorstr=" + t + ",endColorstr=" + n + ")";
	},
	toString: function(e) {
		var t = !!e;
		e ||= this._format;
		var n = !1, r = this._a < 1 && this._a >= 0;
		return !t && r && (e === "hex" || e === "hex6" || e === "hex3" || e === "hex4" || e === "hex8" || e === "name") ? e === "name" && this._a === 0 ? this.toName() : this.toRgbString() : (e === "rgb" && (n = this.toRgbString()), e === "prgb" && (n = this.toPercentageRgbString()), (e === "hex" || e === "hex6") && (n = this.toHexString()), e === "hex3" && (n = this.toHexString(!0)), e === "hex4" && (n = this.toHex8String(!0)), e === "hex8" && (n = this.toHex8String()), e === "name" && (n = this.toName()), e === "hsl" && (n = this.toHslString()), e === "hsv" && (n = this.toHsvString()), n || this.toHexString());
	},
	clone: function() {
		return C(this.toString());
	},
	_applyModification: function(e, t) {
		var n = e.apply(null, [this].concat([].slice.call(t)));
		return this._r = n._r, this._g = n._g, this._b = n._b, this.setAlpha(n._a), this;
	},
	lighten: function() {
		return this._applyModification(D, arguments);
	},
	brighten: function() {
		return this._applyModification(ke, arguments);
	},
	darken: function() {
		return this._applyModification(O, arguments);
	},
	desaturate: function() {
		return this._applyModification(Oe, arguments);
	},
	saturate: function() {
		return this._applyModification(T, arguments);
	},
	greyscale: function() {
		return this._applyModification(E, arguments);
	},
	spin: function() {
		return this._applyModification(k, arguments);
	},
	_applyCombination: function(e, t) {
		return e.apply(null, [this].concat([].slice.call(t)));
	},
	analogous: function() {
		return this._applyCombination(Me, arguments);
	},
	complement: function() {
		return this._applyCombination(A, arguments);
	},
	monochromatic: function() {
		return this._applyCombination(Ne, arguments);
	},
	splitcomplement: function() {
		return this._applyCombination(je, arguments);
	},
	triad: function() {
		return this._applyCombination(Ae, [3]);
	},
	tetrad: function() {
		return this._applyCombination(Ae, [4]);
	}
}, C.fromRatio = function(e, t) {
	if (S(e) == "object") {
		var n = {};
		for (var r in e) e.hasOwnProperty(r) && (n[r] = r === "a" ? e[r] : z(e[r]));
		e = n;
	}
	return C(e, t);
};
function be(e) {
	var t = {
		r: 0,
		g: 0,
		b: 0
	}, n = 1, r = null, i = null, a = null, o = !1, s = !1;
	return typeof e == "string" && (e = Re(e)), S(e) == "object" && (V(e.r) && V(e.g) && V(e.b) ? (t = xe(e.r, e.g, e.b), o = !0, s = String(e.r).substr(-1) === "%" ? "prgb" : "rgb") : V(e.h) && V(e.s) && V(e.v) ? (r = z(e.s), i = z(e.v), t = we(e.h, r, i), o = !0, s = "hsv") : V(e.h) && V(e.s) && V(e.l) && (r = z(e.s), a = z(e.l), t = w(e.h, r, a), o = !0, s = "hsl"), e.hasOwnProperty("a") && (n = e.a)), n = P(n), {
		ok: o,
		format: e.format || s,
		r: Math.min(255, Math.max(t.r, 0)),
		g: Math.min(255, Math.max(t.g, 0)),
		b: Math.min(255, Math.max(t.b, 0)),
		a: n
	};
}
function xe(e, t, n) {
	return {
		r: F(e, 255) * 255,
		g: F(t, 255) * 255,
		b: F(n, 255) * 255
	};
}
function Se(e, t, n) {
	e = F(e, 255), t = F(t, 255), n = F(n, 255);
	var r = Math.max(e, t, n), i = Math.min(e, t, n), a, o, s = (r + i) / 2;
	if (r == i) a = o = 0;
	else {
		var c = r - i;
		switch (o = s > .5 ? c / (2 - r - i) : c / (r + i), r) {
			case e:
				a = (t - n) / c + (t < n ? 6 : 0);
				break;
			case t:
				a = (n - e) / c + 2;
				break;
			case n: a = (e - t) / c + 4;
		}
		a /= 6;
	}
	return {
		h: a,
		s: o,
		l: s
	};
}
function w(e, t, n) {
	var r, i, a;
	e = F(e, 360), t = F(t, 100), n = F(n, 100);
	function o(e, t, n) {
		return n < 0 && (n += 1), n > 1 && --n, n < 1 / 6 ? e + (t - e) * 6 * n : n < 1 / 2 ? t : n < 2 / 3 ? e + (t - e) * (2 / 3 - n) * 6 : e;
	}
	if (t === 0) r = i = a = n;
	else {
		var s = n < .5 ? n * (1 + t) : n + t - n * t, c = 2 * n - s;
		r = o(c, s, e + 1 / 3), i = o(c, s, e), a = o(c, s, e - 1 / 3);
	}
	return {
		r: r * 255,
		g: i * 255,
		b: a * 255
	};
}
function Ce(e, t, n) {
	e = F(e, 255), t = F(t, 255), n = F(n, 255);
	var r = Math.max(e, t, n), i = Math.min(e, t, n), a, o, s = r, c = r - i;
	if (o = r === 0 ? 0 : c / r, r == i) a = 0;
	else {
		switch (r) {
			case e:
				a = (t - n) / c + (t < n ? 6 : 0);
				break;
			case t:
				a = (n - e) / c + 2;
				break;
			case n: a = (e - t) / c + 4;
		}
		a /= 6;
	}
	return {
		h: a,
		s: o,
		v: s
	};
}
function we(e, t, n) {
	e = F(e, 360) * 6, t = F(t, 100), n = F(n, 100);
	var r = Math.floor(e), i = e - r, a = n * (1 - t), o = n * (1 - i * t), s = n * (1 - (1 - i) * t), c = r % 6, l = [
		n,
		o,
		a,
		a,
		s,
		n
	][c], u = [
		s,
		n,
		n,
		o,
		a,
		a
	][c], d = [
		a,
		a,
		s,
		n,
		n,
		o
	][c];
	return {
		r: l * 255,
		g: u * 255,
		b: d * 255
	};
}
function Te(e, t, n, r) {
	var i = [
		R(Math.round(e).toString(16)),
		R(Math.round(t).toString(16)),
		R(Math.round(n).toString(16))
	];
	return r && i[0].charAt(0) == i[0].charAt(1) && i[1].charAt(0) == i[1].charAt(1) && i[2].charAt(0) == i[2].charAt(1) ? i[0].charAt(0) + i[1].charAt(0) + i[2].charAt(0) : i.join("");
}
function Ee(e, t, n, r, i) {
	var a = [
		R(Math.round(e).toString(16)),
		R(Math.round(t).toString(16)),
		R(Math.round(n).toString(16)),
		R(Ie(r))
	];
	return i && a[0].charAt(0) == a[0].charAt(1) && a[1].charAt(0) == a[1].charAt(1) && a[2].charAt(0) == a[2].charAt(1) && a[3].charAt(0) == a[3].charAt(1) ? a[0].charAt(0) + a[1].charAt(0) + a[2].charAt(0) + a[3].charAt(0) : a.join("");
}
function De(e, t, n, r) {
	return [
		R(Ie(r)),
		R(Math.round(e).toString(16)),
		R(Math.round(t).toString(16)),
		R(Math.round(n).toString(16))
	].join("");
}
C.equals = function(e, t) {
	return !e || !t ? !1 : C(e).toRgbString() == C(t).toRgbString();
}, C.random = function() {
	return C.fromRatio({
		r: Math.random(),
		g: Math.random(),
		b: Math.random()
	});
};
function Oe(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = C(e).toHsl();
	return n.s -= t / 100, n.s = Pe(n.s), C(n);
}
function T(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = C(e).toHsl();
	return n.s += t / 100, n.s = Pe(n.s), C(n);
}
function E(e) {
	return C(e).desaturate(100);
}
function D(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = C(e).toHsl();
	return n.l += t / 100, n.l = Pe(n.l), C(n);
}
function ke(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = C(e).toRgb();
	return n.r = Math.max(0, Math.min(255, n.r - Math.round(255 * -(t / 100)))), n.g = Math.max(0, Math.min(255, n.g - Math.round(255 * -(t / 100)))), n.b = Math.max(0, Math.min(255, n.b - Math.round(255 * -(t / 100)))), C(n);
}
function O(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = C(e).toHsl();
	return n.l -= t / 100, n.l = Pe(n.l), C(n);
}
function k(e, t) {
	var n = C(e).toHsl(), r = (n.h + t) % 360;
	return n.h = r < 0 ? 360 + r : r, C(n);
}
function A(e) {
	var t = C(e).toHsl();
	return t.h = (t.h + 180) % 360, C(t);
}
function Ae(e, t) {
	if (isNaN(t) || t <= 0) throw Error("Argument to polyad must be a positive number");
	for (var n = C(e).toHsl(), r = [C(e)], i = 360 / t, a = 1; a < t; a++) r.push(C({
		h: (n.h + a * i) % 360,
		s: n.s,
		l: n.l
	}));
	return r;
}
function je(e) {
	var t = C(e).toHsl(), n = t.h;
	return [
		C(e),
		C({
			h: (n + 72) % 360,
			s: t.s,
			l: t.l
		}),
		C({
			h: (n + 216) % 360,
			s: t.s,
			l: t.l
		})
	];
}
function Me(e, t, n) {
	t ||= 6, n ||= 30;
	var r = C(e).toHsl(), i = 360 / n, a = [C(e)];
	for (r.h = (r.h - (i * t >> 1) + 720) % 360; --t;) r.h = (r.h + i) % 360, a.push(C(r));
	return a;
}
function Ne(e, t) {
	t ||= 6;
	for (var n = C(e).toHsv(), r = n.h, i = n.s, a = n.v, o = [], s = 1 / t; t--;) o.push(C({
		h: r,
		s: i,
		v: a
	})), a = (a + s) % 1;
	return o;
}
C.mix = function(e, t, n) {
	n = n === 0 ? 0 : n || 50;
	var r = C(e).toRgb(), i = C(t).toRgb(), a = n / 100;
	return C({
		r: (i.r - r.r) * a + r.r,
		g: (i.g - r.g) * a + r.g,
		b: (i.b - r.b) * a + r.b,
		a: (i.a - r.a) * a + r.a
	});
}, C.readability = function(e, t) {
	var n = C(e), r = C(t);
	return (Math.max(n.getLuminance(), r.getLuminance()) + .05) / (Math.min(n.getLuminance(), r.getLuminance()) + .05);
}, C.isReadable = function(e, t, n) {
	var r = C.readability(e, t), i, a = !1;
	switch (i = ze(n), i.level + i.size) {
		case "AAsmall":
		case "AAAlarge":
			a = r >= 4.5;
			break;
		case "AAlarge":
			a = r >= 3;
			break;
		case "AAAsmall": a = r >= 7;
	}
	return a;
}, C.mostReadable = function(e, t, n) {
	var r = null, i = 0, a, o, s, c;
	n ||= {}, o = n.includeFallbackColors, s = n.level, c = n.size;
	for (var l = 0; l < t.length; l++) a = C.readability(e, t[l]), a > i && (i = a, r = C(t[l]));
	return C.isReadable(e, r, {
		level: s,
		size: c
	}) || !o ? r : (n.includeFallbackColors = !1, C.mostReadable(e, ["#fff", "#000"], n));
};
var j = C.names = {
	aliceblue: "f0f8ff",
	antiquewhite: "faebd7",
	aqua: "0ff",
	aquamarine: "7fffd4",
	azure: "f0ffff",
	beige: "f5f5dc",
	bisque: "ffe4c4",
	black: "000",
	blanchedalmond: "ffebcd",
	blue: "00f",
	blueviolet: "8a2be2",
	brown: "a52a2a",
	burlywood: "deb887",
	burntsienna: "ea7e5d",
	cadetblue: "5f9ea0",
	chartreuse: "7fff00",
	chocolate: "d2691e",
	coral: "ff7f50",
	cornflowerblue: "6495ed",
	cornsilk: "fff8dc",
	crimson: "dc143c",
	cyan: "0ff",
	darkblue: "00008b",
	darkcyan: "008b8b",
	darkgoldenrod: "b8860b",
	darkgray: "a9a9a9",
	darkgreen: "006400",
	darkgrey: "a9a9a9",
	darkkhaki: "bdb76b",
	darkmagenta: "8b008b",
	darkolivegreen: "556b2f",
	darkorange: "ff8c00",
	darkorchid: "9932cc",
	darkred: "8b0000",
	darksalmon: "e9967a",
	darkseagreen: "8fbc8f",
	darkslateblue: "483d8b",
	darkslategray: "2f4f4f",
	darkslategrey: "2f4f4f",
	darkturquoise: "00ced1",
	darkviolet: "9400d3",
	deeppink: "ff1493",
	deepskyblue: "00bfff",
	dimgray: "696969",
	dimgrey: "696969",
	dodgerblue: "1e90ff",
	firebrick: "b22222",
	floralwhite: "fffaf0",
	forestgreen: "228b22",
	fuchsia: "f0f",
	gainsboro: "dcdcdc",
	ghostwhite: "f8f8ff",
	gold: "ffd700",
	goldenrod: "daa520",
	gray: "808080",
	green: "008000",
	greenyellow: "adff2f",
	grey: "808080",
	honeydew: "f0fff0",
	hotpink: "ff69b4",
	indianred: "cd5c5c",
	indigo: "4b0082",
	ivory: "fffff0",
	khaki: "f0e68c",
	lavender: "e6e6fa",
	lavenderblush: "fff0f5",
	lawngreen: "7cfc00",
	lemonchiffon: "fffacd",
	lightblue: "add8e6",
	lightcoral: "f08080",
	lightcyan: "e0ffff",
	lightgoldenrodyellow: "fafad2",
	lightgray: "d3d3d3",
	lightgreen: "90ee90",
	lightgrey: "d3d3d3",
	lightpink: "ffb6c1",
	lightsalmon: "ffa07a",
	lightseagreen: "20b2aa",
	lightskyblue: "87cefa",
	lightslategray: "789",
	lightslategrey: "789",
	lightsteelblue: "b0c4de",
	lightyellow: "ffffe0",
	lime: "0f0",
	limegreen: "32cd32",
	linen: "faf0e6",
	magenta: "f0f",
	maroon: "800000",
	mediumaquamarine: "66cdaa",
	mediumblue: "0000cd",
	mediumorchid: "ba55d3",
	mediumpurple: "9370db",
	mediumseagreen: "3cb371",
	mediumslateblue: "7b68ee",
	mediumspringgreen: "00fa9a",
	mediumturquoise: "48d1cc",
	mediumvioletred: "c71585",
	midnightblue: "191970",
	mintcream: "f5fffa",
	mistyrose: "ffe4e1",
	moccasin: "ffe4b5",
	navajowhite: "ffdead",
	navy: "000080",
	oldlace: "fdf5e6",
	olive: "808000",
	olivedrab: "6b8e23",
	orange: "ffa500",
	orangered: "ff4500",
	orchid: "da70d6",
	palegoldenrod: "eee8aa",
	palegreen: "98fb98",
	paleturquoise: "afeeee",
	palevioletred: "db7093",
	papayawhip: "ffefd5",
	peachpuff: "ffdab9",
	peru: "cd853f",
	pink: "ffc0cb",
	plum: "dda0dd",
	powderblue: "b0e0e6",
	purple: "800080",
	rebeccapurple: "663399",
	red: "f00",
	rosybrown: "bc8f8f",
	royalblue: "4169e1",
	saddlebrown: "8b4513",
	salmon: "fa8072",
	sandybrown: "f4a460",
	seagreen: "2e8b57",
	seashell: "fff5ee",
	sienna: "a0522d",
	silver: "c0c0c0",
	skyblue: "87ceeb",
	slateblue: "6a5acd",
	slategray: "708090",
	slategrey: "708090",
	snow: "fffafa",
	springgreen: "00ff7f",
	steelblue: "4682b4",
	tan: "d2b48c",
	teal: "008080",
	thistle: "d8bfd8",
	tomato: "ff6347",
	turquoise: "40e0d0",
	violet: "ee82ee",
	wheat: "f5deb3",
	white: "fff",
	whitesmoke: "f5f5f5",
	yellow: "ff0",
	yellowgreen: "9acd32"
}, M = C.hexNames = N(j);
function N(e) {
	var t = {};
	for (var n in e) e.hasOwnProperty(n) && (t[e[n]] = n);
	return t;
}
function P(e) {
	return e = parseFloat(e), (isNaN(e) || e < 0 || e > 1) && (e = 1), e;
}
function F(e, t) {
	L(e) && (e = "100%");
	var n = Fe(e);
	return e = Math.min(t, Math.max(0, parseFloat(e))), n && (e = parseInt(e * t, 10) / 100), Math.abs(e - t) < 1e-6 ? 1 : e % t / parseFloat(t);
}
function Pe(e) {
	return Math.min(1, Math.max(0, e));
}
function I(e) {
	return parseInt(e, 16);
}
function L(e) {
	return typeof e == "string" && e.indexOf(".") != -1 && parseFloat(e) === 1;
}
function Fe(e) {
	return typeof e == "string" && e.indexOf("%") != -1;
}
function R(e) {
	return e.length == 1 ? "0" + e : "" + e;
}
function z(e) {
	return e <= 1 && (e = e * 100 + "%"), e;
}
function Ie(e) {
	return Math.round(parseFloat(e) * 255).toString(16);
}
function Le(e) {
	return I(e) / 255;
}
var B = function() {
	var e = "(?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?)", t = "[\\s|\\(]+(" + e + ")[,|\\s]+(" + e + ")[,|\\s]+(" + e + ")\\s*\\)?", n = "[\\s|\\(]+(" + e + ")[,|\\s]+(" + e + ")[,|\\s]+(" + e + ")[,|\\s]+(" + e + ")\\s*\\)?";
	return {
		CSS_UNIT: new RegExp(e),
		rgb: RegExp("rgb" + t),
		rgba: RegExp("rgba" + n),
		hsl: RegExp("hsl" + t),
		hsla: RegExp("hsla" + n),
		hsv: RegExp("hsv" + t),
		hsva: RegExp("hsva" + n),
		hex3: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
		hex6: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
		hex4: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
		hex8: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/
	};
}();
function V(e) {
	return !!B.CSS_UNIT.exec(e);
}
function Re(e) {
	e = e.replace(ve, "").replace(ye, "").toLowerCase();
	var t = !1;
	if (j[e]) e = j[e], t = !0;
	else if (e == "transparent") return {
		r: 0,
		g: 0,
		b: 0,
		a: 0,
		format: "name"
	};
	var n;
	return (n = B.rgb.exec(e)) ? {
		r: n[1],
		g: n[2],
		b: n[3]
	} : (n = B.rgba.exec(e)) ? {
		r: n[1],
		g: n[2],
		b: n[3],
		a: n[4]
	} : (n = B.hsl.exec(e)) ? {
		h: n[1],
		s: n[2],
		l: n[3]
	} : (n = B.hsla.exec(e)) ? {
		h: n[1],
		s: n[2],
		l: n[3],
		a: n[4]
	} : (n = B.hsv.exec(e)) ? {
		h: n[1],
		s: n[2],
		v: n[3]
	} : (n = B.hsva.exec(e)) ? {
		h: n[1],
		s: n[2],
		v: n[3],
		a: n[4]
	} : (n = B.hex8.exec(e)) ? {
		r: I(n[1]),
		g: I(n[2]),
		b: I(n[3]),
		a: Le(n[4]),
		format: t ? "name" : "hex8"
	} : (n = B.hex6.exec(e)) ? {
		r: I(n[1]),
		g: I(n[2]),
		b: I(n[3]),
		format: t ? "name" : "hex"
	} : (n = B.hex4.exec(e)) ? {
		r: I(n[1] + "" + n[1]),
		g: I(n[2] + "" + n[2]),
		b: I(n[3] + "" + n[3]),
		a: Le(n[4] + "" + n[4]),
		format: t ? "name" : "hex8"
	} : (n = B.hex3.exec(e)) ? {
		r: I(n[1] + "" + n[1]),
		g: I(n[2] + "" + n[2]),
		b: I(n[3] + "" + n[3]),
		format: t ? "name" : "hex"
	} : !1;
}
function ze(e) {
	var t, n;
	return e ||= {
		level: "AA",
		size: "small"
	}, t = (e.level || "AA").toUpperCase(), n = (e.size || "small").toLowerCase(), t !== "AA" && t !== "AAA" && (t = "AA"), n !== "small" && n !== "large" && (n = "small"), {
		level: t,
		size: n
	};
}
var Be = .25, Ve = 2.5, H = "Aptos, Calibri, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif", He = 11, Ue = 8, We = .1, Ge = 2, U = 1.2, Ke = "#f3f3f3", qe = "#5f6368", W = "#d7dbe0", Je = "#1f2937", Ye = "#cbd5e1", Xe = "#374151", G = "#111827", Ze = "#e5e7eb", Qe = "#21a366", $e = "rgba(33, 163, 102, 0.1)", et = 1, tt = "#000000", nt = {
	double: 8,
	solid: 7,
	dashed: 5,
	dotted: 4
}, rt = `bold 12px ${H}`, it = `${He}px ${H}`, K = 32, at, ot = /* @__PURE__ */ new Map(), q = (e = 1) => Number.isFinite(e) ? Math.min(Ve, Math.max(Be, e)) : 1, J = (e, t) => Math.max(1, Math.round(e * q(t))), Y = (e, t) => {
	if (!e) return e;
	let n = q(t);
	return e.replace(/(\d+(?:\.\d+)?)px/g, (e, t) => `${Number(t) * n}px`);
}, st = (e, t) => {
	if (e) return {
		...e,
		width: Math.max(.5, e.width * q(t))
	};
}, X = (e, t) => {
	if (e) return {
		...e,
		font: Y(e.font, t),
		borderTop: st(e.borderTop, t),
		borderRight: st(e.borderRight, t),
		borderBottom: st(e.borderBottom, t),
		borderLeft: st(e.borderLeft, t)
	};
}, ct = (e) => Y(rt, e) || rt, lt = (e) => Y(it, e) || it, Z = (e, t = !1) => ({
	backgroundColor: t ? Je : Ke,
	color: t ? Ye : qe,
	font: ct(e)
}), ut = (e, t = !1) => ({
	backgroundColor: t ? "#18212f" : "#f4f7f9",
	color: t ? "#94a3b8" : "#73808d",
	font: Y(`italic ${He}px ${H}`, e)
}), dt = (e) => e.map((e) => ({
	...e,
	...e.children?.length ? { children: dt(e.children) } : {}
})), ft = (e) => {
	if (typeof e.font == "string" && e.font.trim()) return e.font;
	if (e.fontFamily === void 0 && e.fontSize === void 0 && e.fontWeight === void 0 && e.fontStyle === void 0) return;
	let t = (() => {
		let { fontWeight: t } = e;
		if (typeof t == "number") return t >= 600 ? "bold" : "normal";
		if (typeof t == "string") {
			let e = t.trim();
			return /^\d+$/.test(e) ? Number(e) >= 600 ? "bold" : "normal" : e;
		}
		return "normal";
	})();
	return [
		e.fontStyle || "normal",
		t,
		`${Number.parseInt(e.fontSize, 10) || He}px`,
		e.fontFamily || H
	].join(" ");
}, pt = (e) => {
	if (e) {
		if (e.includes("htLeft")) return "left";
		if (e.includes("htRight")) return "right";
		if (e.includes("htCenter")) return "center";
	}
}, mt = (e) => {
	if (e) {
		if (e.includes("htTop")) return "top";
		if (e.includes("htBottom")) return "bottom";
		if (e.includes("htMiddle")) return "middle";
	}
}, ht = (e, t) => !!e?.split(/\s+/).includes(t), gt = (e, t, n) => typeof e == "number" ? e : e?.[t] ?? n, Q = (e) => {
	let t = Number(e?.width);
	return Number.isFinite(t) && t > 0 ? t : 0;
}, _t = (e) => !!e && !e.hide && Q(e) > 0, vt = (e) => e.structure?.columns?.length ? e.structure.columns : e.columns, yt = (e) => e.structure?.colWidths ?? e.colWidths, bt = (e, t, n) => typeof e == "number" ? e : e?.[t] ?? n, xt = (e, t) => typeof e == "number" && Number.isFinite(e) ? e <= 0 ? We : Math.max(Math.ceil(e), Ue) : Math.max(Math.ceil(t), Ue), St = (e) => {
	if (e == null) return !1;
	let t = `${e}`.trim();
	return t ? !/^\d+([./:-]\d+)*$/.test(t) : !1;
}, Ct = (e) => {
	let t = e.meta, n = e.data || [];
	if (!t || n.length < 2 || (e.merge || []).length) return 0;
	let r = n[0] || [], i = n[1] || [], a = r.filter((e) => `${e ?? ""}`.trim() !== ""), o = i.filter((e) => `${e ?? ""}`.trim() !== "");
	return a.length < Math.min(Math.max(Math.floor(t.totalCols / 2), 3), 6) || !a.every(St) || o.length < 2 ? 0 : 1;
}, wt = (e) => {
	let t = vt(e), n = yt(e), r = [{
		key: se,
		title: "",
		type: "index",
		fixed: "left",
		width: 68,
		minWidth: 68,
		maxWidth: 68,
		widthFillDisable: !0,
		headerAlign: "center",
		align: "center",
		headerVerticalAlign: "middle",
		verticalAlign: "middle",
		overflowTooltipShow: !1,
		overflowTooltipHeaderShow: !1
	}], i = [];
	for (let a = 0; a < (e.meta?.totalCols || 0); a += 1) {
		let o = ue(a), s = t?.[a], c = gt(n, a, e.defaults.colWidth), l = !!s?.hidden || c <= 0, u = mt(s?.className) || "middle";
		i.push(o), r.push({
			key: o,
			title: s?.title || `${a + 1}`,
			width: l ? 0 : Math.max(Math.ceil(c), 1),
			hide: l,
			widthFillDisable: !0,
			renderType: "both",
			headerAlign: "center",
			headerVerticalAlign: "middle",
			align: pt(s?.className) || "left",
			verticalAlign: u,
			overflowTooltipShow: !0,
			overflowTooltipHeaderShow: !0
		});
	}
	return {
		columns: r,
		dataKeys: i
	};
}, Tt = (e, t) => {
	let n = {
		...e,
		...e.children?.length ? { children: e.children.map((e) => Tt(e, t)) } : {}
	}, r = Number(e.width);
	Number.isFinite(r) && r > 0 && (n.width = J(r, t));
	let i = Number(e.minWidth);
	Number.isFinite(i) && i > 0 && (n.minWidth = J(i, t));
	let a = Number(e.maxWidth);
	return Number.isFinite(a) && a > 0 && (n.maxWidth = J(a, t)), n;
}, Et = (e, t = 1) => {
	let n = q(t);
	return n === 1 ? dt(e) : e.map((e) => Tt(e, n));
}, Dt = (e) => {
	if (typeof e == "number" && Number.isFinite(e)) return Math.max(e, 0);
	if (typeof e == "string") {
		let t = Number.parseFloat(e);
		return Number.isFinite(t) ? Math.max(t, 0) : 0;
	}
	return 0;
}, Ot = (e) => {
	if (typeof e != "string") return "solid";
	let t = e.trim();
	switch (t) {
		case "double":
		case "dashed":
		case "dotted":
		case "solid": return t;
		default: return "solid";
	}
}, kt = (e, t) => {
	let n = Dt(e[`border${t}Width`]);
	if (n) return {
		width: n,
		style: Ot(e[`border${t}Style`]),
		color: e[`border${t}Color`] || tt
	};
}, At = (e) => e ? !!(e.borderTop || e.borderRight || e.borderBottom || e.borderLeft) : !1, jt = (e) => e ? !!(e.horizontalAlign || e.verticalAlign || e.wrapText || e.shrinkToFit) : !1, Mt = (e, t) => jt(e) ? !!(e?.wrapText || e?.shrinkToFit || e?.horizontalAlign && e.horizontalAlign !== (t?.align || "left") || e?.verticalAlign && e.verticalAlign !== (t?.verticalAlign || "middle")) : !1, Nt = (e) => {
	switch (e) {
		case "center": return "center";
		case "right": return "flex-end";
		default: return "flex-start";
	}
}, Pt = (e) => {
	switch (e) {
		case "top": return "flex-start";
		case "bottom": return "flex-end";
		default: return "center";
	}
}, Ft = (e, t, n, r) => {
	switch (e) {
		case "right": return t - n;
		case "center": return -Math.min(r, Math.max((n - t) / 2, 0));
		default: return 0;
	}
}, It = (e) => typeof e._height == "number" && e._height <= We, Lt = (e, t) => {
	let n = e?.key;
	if (typeof n == "string" && n.startsWith("c")) {
		let e = Number(n.slice(1));
		if (Number.isInteger(e) && e >= 0) return e;
	}
	return Math.max(t - 1, 0);
}, Rt = (e, t, n) => x(e, Lt(n, t) + 1), zt = (e, t) => x(e, t + 1), Bt = (e) => e == null ? "" : `${e}`, Vt = (e) => Bt(e).trim() !== "", Ht = (e) => /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(e.trim()), Ut = (e, t, n, r) => {
	let i = `${t}\n${n}\n${e}`, a = ot.get(i);
	if (a !== void 0) return a;
	!at && r && (at = r.createElement("canvas"));
	let o = at?.getContext("2d");
	if (!o) return e.length * He;
	o.font = t;
	let s = o.measureText(e).width + n * 2;
	return ot.set(i, s), s;
}, Wt = (e, t, n, r) => {
	let i = e.columns[r + 1];
	if (!_t(i)) return !1;
	let a = zt(n, r);
	return e.mergeStartMap.has(a) || e.mergeCoveredMap.has(a) ? !1 : !Vt(t[ue(r)]);
}, Gt = (e, t, n, r, i) => {
	let a = 0;
	for (let o = 1; o <= K; o += 1) {
		let s = r + o * i;
		if (s < 0 || s >= e.totalCols || !Wt(e, t, n, s)) break;
		a += Q(e.columns[s + 1]);
	}
	return a;
}, Kt = (e, t, n, r, i, a, o, s, c) => {
	let l = Bt(o);
	if (!l || a?.wrapText || a?.shrinkToFit || Ht(l)) return;
	let u = zt(n, r);
	if (e.mergeStartMap.has(u) || e.mergeCoveredMap.has(u)) return;
	let d = Q(i);
	if (!d) return;
	let f = a?.font || it, p = Math.ceil(Ut(l, f, J(Ge, s), c));
	if (p <= d) return;
	let m = a?.horizontalAlign || i?.align || "left", h = m === "right" || m === "center" ? Gt(e, t, n, r, -1) : 0, ee = m === "right" ? 0 : Gt(e, t, n, r, 1), g = d + h + ee;
	if (g <= d) return;
	let _ = Math.min(p, g);
	return {
		left: Ft(m, d, _, h),
		width: _
	};
}, qt = (e, t, n) => {
	let r = 0;
	for (let i = t; i < n; i += 1) r += Q(e.columns[i + 1]);
	return r;
}, Jt = (e, t, n, r, i, a) => {
	if (!Wt(e, t, n, r)) return;
	let o = e.columns[r + 1], s = Q(o);
	if (s) for (let o = 1; o <= K; o += 1) {
		let c = r - o;
		if (c < 0) break;
		let l = e.columns[c + 1];
		if (!_t(l)) break;
		let u = t[ue(c)];
		if (!Vt(u)) {
			if (!Wt(e, t, n, c)) break;
			continue;
		}
		let d = zt(n, c), f = e.cellCache.get(d), p = {
			...X(f, i) || {},
			horizontalAlign: f?.horizontalAlign || l?.align,
			verticalAlign: f?.verticalAlign || l?.verticalAlign
		}, m = Kt(e, t, n, c, l, p, u, i, a);
		if (!m) return;
		let h = qt(e, c, r), ee = m.left, g = m.left + m.width, _ = h;
		return ee < h + s && g > _ ? {
			value: u,
			style: p,
			overflowLayout: {
				left: m.left - h,
				width: m.width
			}
		} : void 0;
	}
}, $ = (e) => e ? e.width * 100 + (nt[e.style] || 1) : 0, Yt = (e, t, n, r, i) => {
	let a = X(e.cellCache.get(x(t - 1, n + 1)), i), o = X(e.cellCache.get(x(t + 1, n + 1)), i), s = X(e.cellCache.get(x(t, n)), i), c = X(e.cellCache.get(x(t, n + 2)), i), l = $(r.borderTop) >= $(a?.borderBottom) ? r.borderTop : void 0, u = $(r.borderBottom) > $(o?.borderTop) ? r.borderBottom : void 0, d = $(r.borderLeft) >= $(s?.borderRight) ? r.borderLeft : void 0, f = $(r.borderRight) > $(c?.borderLeft) ? r.borderRight : void 0;
	return {
		...r,
		borderTop: l,
		borderRight: f,
		borderBottom: u,
		borderLeft: d
	};
}, Xt = (e, t, n) => {
	let r = e.createElement("span"), i = n.width / 2;
	return Object.assign(r.style, {
		position: "absolute",
		pointerEvents: "none",
		boxSizing: "border-box"
	}), t === "top" || t === "bottom" ? (Object.assign(r.style, {
		left: `${-i}px`,
		width: `calc(100% + ${n.width}px)`,
		height: "0"
	}), r.style[t] = `${-i}px`, r.style.borderTop = `${n.width}px ${n.style} ${n.color}`) : (Object.assign(r.style, {
		top: `${-i}px`,
		height: `calc(100% + ${n.width}px)`,
		width: "0"
	}), r.style[t] = `${-i}px`, r.style.borderLeft = `${n.width}px ${n.style} ${n.color}`), r;
}, Zt = (e, t, n, r) => {
	let i = e.createElement("span");
	return i.textContent = Bt(t), Object.assign(i.style, {
		position: "relative",
		zIndex: "1",
		width: "100%",
		height: "100%",
		boxSizing: "border-box",
		display: "flex",
		alignItems: Pt(n.verticalAlign),
		justifyContent: Nt(n.horizontalAlign),
		padding: `0 ${r}px`,
		overflow: "hidden",
		textOverflow: n.wrapText ? "clip" : "ellipsis",
		whiteSpace: n.wrapText ? "pre-wrap" : "nowrap",
		wordBreak: n.wrapText ? "break-word" : "normal",
		lineHeight: `${U}`,
		textAlign: n.horizontalAlign || "left",
		color: n.color || "inherit",
		font: n.font || it,
		transform: n.shrinkToFit ? "scale(0.92)" : "none",
		transformOrigin: `${n.horizontalAlign || "left"} center`
	}), i;
}, Qt = (e, t) => {
	t && Object.assign(e.style, {
		position: "absolute",
		left: `${t.left}px`,
		top: "0",
		width: `${t.width}px`,
		overflow: "hidden",
		textOverflow: "clip"
	});
}, $t = (e, t, n, r, i, a, o) => {
	let s = e.ownerDocument;
	e.replaceChildren(), Object.assign(e.style, {
		pointerEvents: "none",
		overflow: a ? "hidden" : "visible",
		background: "transparent"
	});
	let c = s.createDocumentFragment();
	if (i) {
		let e = Zt(s, r, n, J(Ge, o));
		Qt(e, a), c.appendChild(e);
	}
	t.borderTop && c.appendChild(Xt(s, "top", t.borderTop)), t.borderRight && c.appendChild(Xt(s, "right", t.borderRight)), t.borderBottom && c.appendChild(Xt(s, "bottom", t.borderBottom)), t.borderLeft && c.appendChild(Xt(s, "left", t.borderLeft)), e.appendChild(c);
}, en = (e) => {
	if (!e) return;
	let t = e.style || {}, n = {};
	t.backgroundColor && (n.backgroundColor = t.backgroundColor), t.color ? n.color = t.color : t.backgroundColor && C(t.backgroundColor).isDark() && (n.color = "#ffffff");
	let r = ft(t);
	r ? n.font = r : t.backgroundColor && C(t.backgroundColor).isDark() && (n.font = `bold ${He}px ${H}`);
	let i = kt(t, "Top");
	i && (n.borderTop = i);
	let a = kt(t, "Right");
	a && (n.borderRight = a);
	let o = kt(t, "Bottom");
	o && (n.borderBottom = o);
	let s = kt(t, "Left");
	s && (n.borderLeft = s);
	let c = pt(e.className);
	c && (n.horizontalAlign = c);
	let l = mt(e.className);
	if (l && (n.verticalAlign = l), ht(e.className, "htWrap") && (n.wrapText = !0), ht(e.className, "htShrink") && (n.shrinkToFit = !0), n.backgroundColor || n.color || n.font || At(n) || jt(n)) return n;
}, tn = ({ hostHeight: e, darkMode: t = !1, resizableColumns: n = !1, resizableRows: r = !1, copySelection: i, sheetDefaults: a, virtualState: o, zoomScale: s = 1 }) => {
	let c = q(s), l = J(Ge, c), u = J(34, c), d = J(xt(a.rowHeight, a.rowHeight), c), f = J(a.colWidth, c), p = Z(c, t), m = ut(c, t);
	return {
		ROW_KEY: "__k",
		DISABLED: !0,
		HEIGHT: Math.max(e, 240),
		MAX_HEIGHT: Math.max(e, 240),
		HEADER_HEIGHT: u,
		CELL_HEIGHT: d,
		CELL_WIDTH: f,
		CELL_PADDING: l,
		CELL_LINE_HEIGHT: U,
		COLUMNS_VERTICAL_ALIGN: "middle",
		HEADER_FONT: ct(c),
		BODY_FONT: lt(c),
		BORDER_RADIUS: 0,
		BORDER_COLOR: t ? Xe : W,
		HEADER_BG_COLOR: t ? Je : Ke,
		BODY_BG_COLOR: t ? G : "#ffffff",
		HEADER_TEXT_COLOR: t ? Ye : qe,
		BODY_TEXT_COLOR: t ? Ze : "#202124",
		READONLY_COLOR: t ? G : "#ffffff",
		READONLY_TEXT_COLOR: t ? Ze : "#202124",
		EDIT_BG_COLOR: t ? "#18212f" : "#ffffff",
		PLACEHOLDER_COLOR: t ? "#94a3b8" : "#8a94a3",
		SCROLLER_COLOR: t ? "#475569" : "#c1c7d0",
		SCROLLER_FOCUS_COLOR: t ? "#64748b" : "#9aa0a6",
		SELECT_ROW_COL_BG_COLOR: $e,
		SELECT_AREA_COLOR: "rgba(33, 163, 102, 0.14)",
		SELECT_BORDER_COLOR: Qe,
		AUTOFILL_POINT_BORDER_COLOR: Qe,
		ENABLE_SELECTOR: !0,
		ENABLE_SELECTOR_SINGLE: !1,
		ENABLE_SELECTOR_SPAN_COL: !0,
		ENABLE_SELECTOR_SPAN_ROW: !0,
		ENABLE_SELECTOR_ALL_ROWS: !0,
		ENABLE_SELECTOR_ALL_COLS: !0,
		SELECTOR_AREA_MIN_X: et,
		ENABLE_CONTEXT_MENU: !1,
		ENABLE_HEADER_CONTEXT_MENU: !1,
		ENABLE_AUTOFILL: !0,
		ENABLE_AUTOFILL_SPAN_COL: !0,
		ENABLE_AUTOFILL_SPAN_ROW: !0,
		ENABLE_PASTER: !1,
		ENABLE_HISTORY: !1,
		ENABLE_RESIZE_COLUMN: n,
		ENABLE_RESIZE_COLUMN_TEXT: n,
		RESIZE_COLUMN_LINE_COLOR: Qe,
		RESIZE_COLUMN_TEXT_BG_COLOR: Qe,
		RESIZE_COLUMN_MIN_WIDTH: 40,
		ENABLE_RESIZE_ROW: r,
		RESIZE_ROW_LINE_COLOR: Qe,
		RESIZE_ROW_MIN_HEIGHT: J(18, c),
		ENABLE_KEYBOARD: !0,
		ENABLE_COPY: !0,
		BEFORE_COPY_METHOD: i ? (e) => {
			i(e);
		} : void 0,
		BEFORE_AUTOFILL_DATA_METHOD: () => [],
		SPAN_METHOD: ({ rowIndex: e, colIndex: t, column: n }) => {
			if (t === 0) return;
			let r = Rt(e, t, n);
			if (o.mergeCoveredMap.has(r)) return {
				rowspan: 0,
				colspan: 0
			};
			let i = o.mergeStartMap.get(r);
			if (i) return {
				rowspan: i.rowspan,
				colspan: i.colspan
			};
		},
		HEADER_CELL_STYLE_METHOD: () => p,
		BODY_CELL_STYLE_METHOD: ({ row: e, rowIndex: t, colIndex: n, column: r }) => {
			if (n === 0) return p;
			let i = e;
			if (!It(i)) return de(i) === b.Loaded ? X(o.cellCache.get(Rt(t, n, r)), c) : m;
		},
		BODY_CELL_RENDER_METHOD: ({ row: e, rowIndex: t, colIndex: n, column: r, value: i }) => {
			let a = e;
			if (n === 0 || It(a) || de(a) !== b.Loaded) return;
			let s = Rt(t, n, r);
			if (o.mergeCoveredMap.has(s)) return;
			let l = X(o.cellCache.get(s), c), u = Lt(r, n), d = typeof document > "u" ? void 0 : document, f = Kt(o, a, t, u, r, l, i, c, d), p = Vt(i) ? void 0 : Jt(o, a, t, u, c, d), m = Mt(l, r) || !!f || !!p;
			if (At(l) || m) return ((e) => {
				let n = {
					...l || {},
					horizontalAlign: l?.horizontalAlign || r?.align,
					verticalAlign: l?.verticalAlign || r?.verticalAlign
				}, a = At(l) ? Yt(o, t, u, n, c) : n;
				$t(e, a, p?.style || a, p ? p.value : i, m, p?.overflowLayout || f, c);
			});
		},
		BODY_CELL_FORMATTER_METHOD: ({ row: e, rowIndex: t, colIndex: n, column: r, value: i }) => {
			if (It(e)) return "";
			if (n === 0) {
				let e = t + 1 - o.indexOffset;
				return e > 0 ? `${e}` : "";
			}
			if (de(e) !== b.Loaded) return "";
			let a = e, s = X(o.cellCache.get(Rt(t, n, r)), c), l = Lt(r, n), u = typeof document > "u" ? void 0 : document, d = Kt(o, a, t, l, r, s, i, c, u), f = Vt(i) ? void 0 : Jt(o, a, t, l, c, u);
			return Mt(s, r) || d || f || i == null ? "" : `${i}`;
		}
	};
}, nn = 18, rn = 1048576, an = [
	".e-virt-table-container",
	".e-virt-table-overlayer",
	".e-virt-table-editor",
	".e-virt-table-context-menu"
], on = ".excel-wrapper[data-file-viewer-spreadsheet-root]", sn = "file-viewer-e-virt-table-rotate", cn = "\n.excel-wrapper{position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:var(--file-viewer-render-surface-background,#fff);color:#172033;font-family:Aptos,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}\n.excel-wrapper *{box-sizing:border-box}\n.excel-wrapper .table-wrapper{position:relative;width:100%;flex:1;min-height:0;background:#fff;overflow:hidden}\n.excel-wrapper .table-host{position:absolute;inset:0}\n.excel-wrapper .table-target{width:100%;height:100%}\n.excel-wrapper .table-host .e-virt-table-container,.excel-wrapper .table-host .e-virt-table-stage{width:100%!important}\n.excel-wrapper .table-host .e-virt-table-container{height:100%!important}\n.excel-wrapper .table-host .e-virt-table-stage{overflow:hidden}\n.excel-wrapper .sheet-loading{position:absolute;right:18px;bottom:18px;z-index:20;display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:14px;background:rgba(33,163,102,.1);border:1px solid rgba(33,163,102,.2);box-shadow:0 8px 20px rgba(33,163,102,.12);color:#1a7f50;font-size:12px;font-weight:700;pointer-events:none}\n.excel-wrapper .sheet-loading-dot{width:8px;height:8px;flex-shrink:0;border-radius:999px;background:#21a366;box-shadow:0 0 0 6px rgba(33,163,102,.12);animation:file-viewer-spreadsheet-loading-pulse 1.2s ease-in-out infinite}\n.excel-wrapper .sheet-loading-summary{color:#5f6368}\n.excel-wrapper .excel-image-viewport{position:absolute;z-index:35;overflow:hidden;pointer-events:none}\n.excel-wrapper .excel-image-layer{position:absolute;inset:0 auto auto 0;width:0;height:0;transform-origin:0 0;will-change:transform}\n.excel-wrapper .excel-image{position:absolute;display:block;max-width:none;height:auto;object-fit:contain;user-select:none}\n.excel-wrapper .excel-chart{position:absolute;display:block;max-width:none;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.08);user-select:none}\n.excel-wrapper .excel-chart svg{display:block;width:100%;height:100%;overflow:visible}\n.excel-wrapper .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.96);z-index:999;backdrop-filter:blur(6px)}\n.excel-wrapper .loading-card{width:min(100%,460px);display:flex;align-items:center;gap:18px;padding:22px;border-radius:24px;background:rgba(255,255,255,.92);border:1px solid rgba(33,163,102,.1);box-shadow:0 22px 48px rgba(18,36,27,.12)}\n.excel-wrapper .loading-brand{flex-shrink:0;width:78px;height:78px;display:flex;align-items:center;justify-content:center;border-radius:22px;background:linear-gradient(135deg,rgba(33,163,102,.14),rgba(33,163,102,.04));color:#1a7f50;font-size:18px;font-weight:900;letter-spacing:0}\n.excel-wrapper .loading-copy{min-width:0;flex:1}\n.excel-wrapper .loading-kicker{display:block;color:#21a366;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}\n.excel-wrapper .loading-copy strong{display:block;margin-top:6px;color:#183828;font-size:20px;line-height:1.3}\n.excel-wrapper .loading-copy p{margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.5}\n.excel-wrapper .loading-spinner{width:28px;height:28px;border-radius:999px;border:3px solid rgba(33,163,102,.16);border-top-color:#21a366;animation:file-viewer-spreadsheet-loading-spin .8s linear infinite}\n.excel-wrapper .error{position:absolute;left:50%;top:50%;z-index:1000;transform:translate(-50%,-50%);max-width:min(520px,calc(100% - 48px));padding:16px 18px;border-radius:16px;background:#fff7ed;color:#9a3412;border:1px solid rgba(234,88,12,.18);box-shadow:0 18px 42px rgba(154,52,18,.12);font-size:14px;line-height:1.6}\n.excel-wrapper .toolbar{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #e5e7eb;background:#f8fafc}\n.excel-wrapper .btn-group{min-width:0;max-width:100%;flex:1 1 auto;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable;scrollbar-width:thin;overscroll-behavior-x:contain}\n.excel-wrapper .sheet-tab{flex:0 0 auto;width:max-content;min-width:72px;max-width:min(260px,70vw);height:30px;border:1px solid transparent;border-radius:8px;padding:0 12px;background:transparent;color:#526173;font:inherit;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}\n.excel-wrapper .sheet-tab:hover{background:#edf2f7}\n.excel-wrapper .sheet-tab.active{border-color:rgba(33,163,102,.28);background:rgba(33,163,102,.12);color:#137347}\n.excel-wrapper .summary{flex:0 0 auto;max-width:42%;overflow:hidden;color:#64748b;font-size:12px;font-weight:700;white-space:nowrap;text-overflow:ellipsis}\n.excel-wrapper .hidden{display:none!important}\n.excel-wrapper[data-spreadsheet-theme='dark']{color-scheme:dark;background:var(--file-viewer-render-surface-background,#0f172a);color:#e5e7eb}\n.excel-wrapper[data-spreadsheet-theme='dark'] .table-wrapper{background:#111827}\n.excel-wrapper[data-spreadsheet-theme='dark'] .toolbar{background:#111827;border-color:rgba(148,163,184,.22)}\n.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-tab{color:#cbd5e1}\n.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-tab:hover{background:#1f2937}\n.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-tab.active{border-color:rgba(52,211,153,.38);background:rgba(33,163,102,.2);color:#6ee7b7}\n.excel-wrapper[data-spreadsheet-theme='dark'] .summary,.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-loading-summary{color:#94a3b8}\n.excel-wrapper[data-spreadsheet-theme='dark'] .loading{background:rgba(2,6,23,.9)}\n.excel-wrapper[data-spreadsheet-theme='dark'] .loading-card{border-color:rgba(52,211,153,.2);background:rgba(17,24,39,.96);box-shadow:0 24px 58px rgba(0,0,0,.42)}\n.excel-wrapper[data-spreadsheet-theme='dark'] .loading-copy strong{color:#f0fdf4}\n.excel-wrapper[data-spreadsheet-theme='dark'] .loading-copy p{color:#94a3b8}\n.excel-wrapper[data-spreadsheet-theme='dark'] .error{border-color:rgba(251,146,60,.28);background:#2a1710;color:#fdba74;box-shadow:0 20px 48px rgba(0,0,0,.36)}\n@keyframes file-viewer-spreadsheet-loading-spin{to{transform:rotate(360deg)}}\n@keyframes file-viewer-spreadsheet-loading-pulse{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1)}}\n@media (max-width:720px){.excel-wrapper .toolbar{align-items:stretch;flex-direction:column}.excel-wrapper .btn-group{flex:0 0 auto}.excel-wrapper .summary{max-width:none;white-space:normal}.excel-wrapper .sheet-loading{left:12px;right:12px;bottom:58px;justify-content:center}.excel-wrapper .loading-card{margin:18px;flex-direction:column;text-align:center}}\n".replace(/\.excel-wrapper/g, on), ln = (e) => typeof e == "function", un = (e) => e && typeof e == "object" ? e : null, dn = () => (typeof globalThis > "u" ? null : globalThis)?.EVirtTable, fn = (e) => {
	let t = un(e), n = un(t?.default), r = un(t?.["module.exports"]), i = dn(), a = [
		e,
		t?.default,
		t?.EVirtTable,
		t?.["module.exports"],
		n?.default,
		n?.EVirtTable,
		r?.default,
		r?.EVirtTable,
		i
	].find(ln);
	if (!a) {
		let n = t ? Object.keys(t).join(", ") : typeof e;
		throw Error(`Unable to resolve e-virt-table constructor from module exports: ${n}`);
	}
	return a;
}, pn = (e) => an.every((t) => e.includes(t)), mn = (e) => [e, typeof document > "u" ? null : document].filter((e, t, n) => !!e && n.indexOf(e) === t), hn = (e) => e.flatMap((e) => Array.from(e.head?.querySelectorAll("style") || [])), gn = "", _n = (e) => {
	let t = hn(mn(e));
	for (let e = t.length - 1; e >= 0; --e) {
		let n = t[e]?.textContent || "";
		if (pn(n)) return n;
	}
	return "";
}, vn = async (e) => {
	let t = mn(e), n = new Set(hn(t)), r = await import("./index.es-eqmS3UD1.js"), i = hn(t).filter((e) => !n.has(e) && pn(e.textContent || "")), a = i[i.length - 1];
	return a && (gn = a.textContent || ""), i.forEach((e) => e.remove()), {
		constructor: fn(r),
		styleText: gn || _n(e)
	};
}, yn = (e, t) => {
	let n = t ? `:host,${on}` : on, r = t ? `:host(.dark),${on}[data-spreadsheet-theme='dark']` : `${on}[data-spreadsheet-theme='dark']`, i = (e) => {
		let t = e.trim();
		return t === ":root" ? n : t === ".dark" ? r : `${on} ${t}`;
	};
	return e.replace(/@keyframes\s+rotate\b/g, `@keyframes ${sn}`).replace(/animation:\s*rotate\b/g, `animation:${sn}`).replace(/(^|})\s*(:root|\.dark|\.e-virt-table-[^{}]+)\{/g, (e, t, n) => `${t}${n.split(",").map(i).join(",")}{`);
}, bn = (e) => e.ownerDocument.defaultView, xn = (t) => e(t.ownerDocument), Sn = (e, t) => {
	e && (typeof e == "function" ? e(t) : e.handleEvent(t));
}, Cn = class {
	constructor(e) {
		this.onmessage = null, this.onerror = null, this.destroyed = !1, this.listeners = /* @__PURE__ */ new Map(), this.parserPromise = null, this.context = null, this.targetWindow = e;
	}
	addEventListener(e, t) {
		var n;
		this.listeners.has(e) || this.listeners.set(e, /* @__PURE__ */ new Set()), (n = this.listeners.get(e)) == null || n.add(t);
	}
	removeEventListener(e, t) {
		var n;
		(n = this.listeners.get(e)) == null || n.delete(t);
	}
	terminate() {
		this.destroyed = !0, this.listeners.clear();
	}
	postMessage(e) {
		this.handleMessage(e);
	}
	async loadParser() {
		this.parserPromise ||= import("./parser-bpLy1I7P.js");
		let e = await this.parserPromise;
		return this.context ||= e.createSpreadsheetParserContext(), e;
	}
	dispatch(e, t) {
		var n;
		(n = this.listeners.get(e)) == null || n.forEach((e) => Sn(e, t));
	}
	dispatchMessage(e) {
		var t;
		let n = this.targetWindow?.MessageEvent || (typeof MessageEvent < "u" ? MessageEvent : void 0), r = n ? new n("message", { data: e }) : {
			type: "message",
			data: e
		};
		(t = this.onmessage) == null || t.call(this, r), this.dispatch("message", r);
	}
	dispatchError(e) {
		var t;
		let n = e instanceof Error ? e.message : String(e), r = this.targetWindow?.ErrorEvent || (typeof ErrorEvent < "u" ? ErrorEvent : void 0), i = r ? new r("error", {
			message: n,
			error: e
		}) : {
			type: "error",
			message: n,
			error: e
		};
		(t = this.onerror) == null || t.call(this, i), this.dispatch("error", i);
	}
	async handleMessage(e) {
		if (!this.destroyed) try {
			let t = await this.loadParser();
			(await t.handleSpreadsheetWorkerRequest(this.context || t.createSpreadsheetParserContext(), e)).forEach((e) => {
				this.destroyed || this.dispatchMessage(e);
			});
		} catch (e) {
			this.destroyed || this.dispatchError(e);
		}
	}
}, wn = class {
	constructor(e, t) {
		this.createFallback = t, this.onmessage = null, this.onerror = null, this.destroyed = !1, this.usingFallback = !1, this.hasPrimaryMessage = !1, this.pendingMessages = [], this.listeners = /* @__PURE__ */ new Map(), this.handleMessage = (e) => {
			var t;
			this.destroyed || (this.usingFallback || (this.hasPrimaryMessage = !0, this.pendingMessages.length = 0), (t = this.onmessage) == null || t.call(this, e), this.dispatch("message", e));
		}, this.handleError = (e) => {
			var t;
			this.destroyed || (!this.usingFallback && !this.hasPrimaryMessage ? this.switchToFallback(e) : ((t = this.onerror) == null || t.call(this, e), this.dispatch("error", e)));
		}, this.active = e, this.attach(e);
	}
	addEventListener(e, t) {
		var n;
		this.listeners.has(e) || this.listeners.set(e, /* @__PURE__ */ new Set()), (n = this.listeners.get(e)) == null || n.add(t);
	}
	removeEventListener(e, t) {
		var n;
		(n = this.listeners.get(e)) == null || n.delete(t);
	}
	terminate() {
		this.destroyed = !0, this.detach(this.active), this.active.terminate(), this.pendingMessages.length = 0, this.listeners.clear();
	}
	postMessage(e) {
		this.destroyed || (!this.usingFallback && !this.hasPrimaryMessage && this.pendingMessages.push(e), this.active.postMessage(e));
	}
	attach(e) {
		e.addEventListener("message", this.handleMessage), e.addEventListener("error", this.handleError);
	}
	detach(e) {
		e.removeEventListener("message", this.handleMessage), e.removeEventListener("error", this.handleError);
	}
	dispatch(e, t) {
		var n;
		(n = this.listeners.get(e)) == null || n.forEach((e) => Sn(e, t));
	}
	switchToFallback(e) {
		var t;
		let n = this.pendingMessages.splice(0);
		this.detach(this.active), this.active.terminate(), this.usingFallback = !0, this.hasPrimaryMessage = !1;
		try {
			this.active = this.createFallback(), this.attach(this.active), console.warn("[file-viewer] Spreadsheet Worker 自动模式启动失败，已回退到主线程解析。", e.message || e.type), n.forEach((e) => this.active.postMessage(e));
		} catch (e) {
			let n = (typeof window < "u" ? window : void 0)?.ErrorEvent || (typeof ErrorEvent < "u" ? ErrorEvent : void 0), r = e instanceof Error ? e.message : String(e), i = n ? new n("error", {
				message: r,
				error: e
			}) : {
				type: "error",
				message: r,
				error: e
			};
			(t = this.onerror) == null || t.call(this, i), this.dispatch("error", i);
		}
	}
}, Tn = (e) => new Cn(bn(e)), En = (e) => e?.options?.spreadsheet?.worker ?? "auto", Dn = (e, t) => {
	let n = t?.options?.spreadsheet, r = En(t);
	return r === !0 || r !== !1 && e >= (typeof n?.workerAutoThreshold == "number" && Number.isFinite(n.workerAutoThreshold) && n.workerAutoThreshold >= 0 ? n.workerAutoThreshold : rn);
}, On = (e, t, n) => En(n) === "auto" ? new wn(e, () => Tn(t)) : e, kn = (e, n, r) => () => {
	if (!Dn(n, r)) return Tn(e);
	let i = bn(e)?.Worker || (typeof Worker < "u" ? Worker : void 0);
	if (!i) return Tn(e);
	let a = t(r?.options?.spreadsheet, xn(e));
	try {
		return On(new i(a, { type: "module" }), e, r);
	} catch (t) {
		try {
			return On(new i(a), e, r);
		} catch (n) {
			return console.warn("[file-viewer] Spreadsheet Worker 无法创建，已回退到主线程解析。", n || t), Tn(e);
		}
	}
}, An = (e, t = cn) => {
	let n = e.createElement("style");
	return n.textContent = t, n;
}, jn = (e, t, n) => {
	if (!n) throw Error("Unable to resolve the e-virt-table stylesheet for the spreadsheet render surface.");
	let r = t.getRootNode(), i = t.ownerDocument.defaultView?.ShadowRoot, a = An(e, yn(n, !!i && r instanceof i));
	return a.dataset.fileViewerVendorStyle = "e-virt-table", a;
}, Mn = (e, t) => {
	e.classList.toggle("hidden", t);
}, Nn = (e) => Math.min(Ve, Math.max(Be, Number(e.toFixed(2)))), Pn = (e) => {
	if (e == null) return "";
	let t = `${e}`;
	return /[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, "\"\"")}"` : t;
}, Fn = (e) => Array.isArray(e) ? e.map((e) => Array.isArray(e) ? e.map(Pn).join("	") : Pn(e)).join("\n") : Pn(e), In = (e, t) => {
	var n;
	let r = e.body;
	if (!r || typeof e.execCommand != "function") return !1;
	let i = e.activeElement, a = e.createElement("textarea");
	a.value = t, a.setAttribute("readonly", "true"), a.setAttribute("aria-hidden", "true"), Object.assign(a.style, {
		position: "fixed",
		top: "0",
		left: "0",
		width: "1px",
		height: "1px",
		padding: "0",
		border: "0",
		opacity: "0",
		pointerEvents: "none"
	}), r.appendChild(a), a.focus({ preventScroll: !0 }), a.select(), a.setSelectionRange(0, a.value.length);
	let o = !1;
	try {
		o = e.execCommand("copy");
	} finally {
		a.remove(), (n = i?.focus) == null || n.call(i, { preventScroll: !0 });
	}
	return o;
}, Ln = async (e, t) => {
	let n = e.defaultView, r = n?.navigator?.clipboard;
	if (n?.isSecureContext && typeof r?.writeText == "function") try {
		return await r.writeText(t), !0;
	} catch {
		return In(e, t);
	}
	return In(e, t);
}, Rn = async (e, t, l, u) => {
	var d, f, p;
	let m = t.ownerDocument, h = await vn(m), ee = h.constructor, g = o(u?.options), _ = r(), te = ((d = m.defaultView)?.matchMedia)?.call(d, "(prefers-color-scheme: dark)").matches ?? !1, ne = s(u?.options?.theme, te) === "dark", v = m.createElement("div");
	v.className = "excel-wrapper", v.dataset.fileViewerSpreadsheetRoot = "true", v.dataset.spreadsheetTheme = ne ? "dark" : "light", v.dataset.viewerZoomProvider = "xlsx";
	let y = m.createElement("div");
	y.className = "loading";
	let re = m.createElement("div");
	re.className = "loading-card";
	let ie = m.createElement("div");
	ie.className = "loading-brand", ie.textContent = "XLSX";
	let ae = m.createElement("div");
	ae.className = "loading-copy";
	let se = m.createElement("span");
	se.className = "loading-kicker", se.textContent = g("spreadsheet.loading.kicker");
	let de = m.createElement("strong");
	de.dataset.loadingTitle = "true", de.textContent = g("spreadsheet.loading.title");
	let pe = m.createElement("p");
	pe.textContent = g("spreadsheet.loading.hint"), ae.append(se, de, pe);
	let he = m.createElement("span");
	he.className = "loading-spinner", re.append(ie, ae, he), y.appendChild(re);
	let S = m.createElement("div");
	S.className = "error hidden";
	let ve = m.createElement("div");
	ve.className = "table-wrapper";
	let ye = m.createElement("div");
	ye.className = "sheet-loading hidden";
	let C = m.createElement("span");
	C.className = "sheet-loading-dot";
	let be = m.createElement("span");
	be.textContent = g("spreadsheet.loading.streaming");
	let xe = m.createElement("span");
	xe.className = "sheet-loading-summary", ye.append(C, be, xe);
	let Se = m.createElement("div");
	Se.className = "table-host";
	let w = m.createElement("div");
	w.className = "table-target";
	let Ce = m.createElement("div");
	Ce.className = "excel-image-viewport hidden";
	let we = m.createElement("div");
	we.className = "excel-image-layer", Ce.appendChild(we), Se.append(w, Ce), ve.append(ye, Se);
	let Te = m.createElement("div");
	Te.className = "toolbar";
	let Ee = m.createElement("div");
	Ee.className = "btn-group", Ee.setAttribute("aria-label", g("spreadsheet.tabs.ariaLabel"));
	let De = m.createElement("div");
	De.className = "summary", Te.append(Ee, De), v.append(y, S, ve, Te), t.replaceChildren(jn(m, t, h.styleText), An(m), v);
	let Oe = [], T = 0, E = "", D = 0, ke = 0, O = { ...ce }, k = !0, A = !1, Ae = 0, je = 0, Me = [], Ne = [], j = 1, M = {
		scrollX: 0,
		scrollY: 0,
		width: 0,
		height: 0
	}, N = !0, P = le(), F = /* @__PURE__ */ new Map(), Pe = /* @__PURE__ */ new Map(), I = /* @__PURE__ */ new Map(), L = null, Fe = null, R = 0, z = 0, Ie = 0, Le = [], B = {
		start: 0,
		end: 0
	}, V = 1, Re = 0, ze = 0, H = !1, He = !1, Ue = !1, We = u?.options?.spreadsheet?.resizableColumns === !0, Ge = u?.options?.spreadsheet?.resizableRows === !0, U = c(kn(t, e.byteLength, u), { logErrors: !1 }), Ke = () => Oe.find((e) => e.id === T), qe = () => {
		let e = Oe.filter((e) => !e.hidden);
		return e.length ? e : Oe;
	}, W = () => T ?? Oe[0]?.id, Je = () => w.clientHeight || 0, Ye = () => !E && !A && (N || k), Xe = () => !Ye() && !E && A && je > 0, G = (e) => Math.max(1, Math.round(e * j)), Ze = (e) => Math.max(.1, Math.round(e * j)), Qe = () => {
		if (!Oe.length) return g("spreadsheet.state.parsingWorkbook");
		let e = Ke()?.name;
		return e ? g("spreadsheet.state.preparingSheetNamed", { name: e }) : g("spreadsheet.state.preparingSheet");
	}, $e = () => {
		if (!D) return "";
		let e = Math.min(Ae * 500, D);
		return g("spreadsheet.state.cachedRows", {
			cached: e.toLocaleString(),
			total: D.toLocaleString()
		});
	}, et = () => {
		let e = D || Ke()?.rowCount || 0, t = ke || Ke()?.colCount || 0;
		return e ? t ? g("spreadsheet.state.rowsAndColumns", {
			rows: e.toLocaleString(),
			cols: t.toLocaleString()
		}) : g("spreadsheet.state.rows", { rows: e.toLocaleString() }) : "";
	}, tt = () => ({
		scale: j,
		label: `${Math.round(j * 100)}%`,
		canZoomIn: j < Ve,
		canZoomOut: j > Be,
		canReset: j !== 1,
		minScale: Be,
		maxScale: Ve
	}), nt = () => {
		let e = w.querySelector(".e-virt-table-container"), t = e ? Math.max(e.offsetWidth - e.clientWidth, 0) : 0, n = e ? Math.max(e.offsetHeight - e.clientHeight, 0) : 0;
		return {
			vertical: t || nn,
			horizontal: n || nn
		};
	}, rt = () => {
		let e = nt(), t = Math.max(M.width - G(68) - e.vertical, 0), n = Math.max(M.height - G(34) - e.horizontal, 0), r = Me.filter((e) => {
			let r = G(e.left) - M.scrollX, i = G(e.top) - M.scrollY;
			return r + G(e.width) >= -240 && r <= t + 240 && i + G(e.height) >= -240 && i <= n + 240;
		}), i = Ne.filter((e) => {
			let r = G(e.left) - M.scrollX, i = G(e.top) - M.scrollY;
			return r + G(e.width) >= -240 && r <= t + 240 && i + G(e.height) >= -240 && i <= n + 240;
		});
		Mn(Ce, r.length === 0 && i.length === 0), Object.assign(Ce.style, {
			left: `${G(68)}px`,
			top: `${G(34)}px`,
			right: "auto",
			bottom: "auto",
			width: `${t}px`,
			height: `${n}px`
		}), we.style.transform = `translate(${-M.scrollX}px, ${-M.scrollY}px)`;
		let a = r.map((e, t) => {
			let n = m.createElement("img");
			return n.className = "excel-image", n.src = e.src, n.alt = e.id, n.draggable = !1, Object.assign(n.style, {
				left: `${G(e.left)}px`,
				top: `${G(e.top)}px`,
				width: `${G(e.width)}px`,
				height: `${G(e.height)}px`
			}), n.dataset.imageIndex = `${t}`, n;
		}), o = i.map((e) => {
			let t = oe(m, e);
			return Object.assign(t.style, {
				left: `${G(e.left)}px`,
				top: `${G(e.top)}px`,
				width: `${G(e.width)}px`,
				height: `${G(e.height)}px`
			}), t;
		});
		we.replaceChildren(...a, ...o);
	}, it = () => {
		requestAnimationFrame(() => {
			var e;
			(e = Ee.querySelector(".sheet-tab.active")) == null || e.scrollIntoView({
				block: "nearest",
				inline: "center",
				behavior: "smooth"
			});
		});
	}, K = () => {
		Mn(y, !Ye());
		let e = y.querySelector("[data-loading-title]");
		e && (e.textContent = Qe()), S.textContent = E, Mn(S, !E), Mn(ye, !Xe());
		let t = ye.querySelector(".sheet-loading-summary");
		t && (t.textContent = $e()), De.textContent = et(), Ee.replaceChildren(...qe().map((e) => {
			let t = m.createElement("button");
			return t.type = "button", t.className = `sheet-tab${T === e.id ? " active" : ""}`, t.title = e.name, t.textContent = e.name, t.setAttribute("aria-pressed", T === e.id ? "true" : "false"), t.addEventListener("click", () => Wt(e.id)), t;
		})), rt();
	}, at = (e) => {
		N = e, K();
	}, ot = (e, t) => {
		at(!0), U.emit(e, t);
	}, q = (e, t) => {
		e.__baseHeight = t, e._height = Ze(t);
	}, J = () => {
		P.rowHeightCache.forEach((e, t) => {
			let n = P.rows[t];
			n && q(n, e);
		});
	}, Y = (e) => (j = Nn(e), J(), vt(), _.emit(), K(), tt()), st = () => {
		let e = P.columns.reduce((e, t) => {
			let n = t;
			if (n.hide) return e;
			let r = Number(n.width);
			return e + (Number.isFinite(r) && r > 0 ? r : O.colWidth);
		}, 0), t = xt(O.rowHeight, ce.rowHeight), n = 0, r = 0;
		return P.rowHeightCache.forEach((e) => {
			n += xt(e, t), r += 1;
		}), {
			contentWidth: e,
			contentHeight: 34 + n + Math.max(0, P.totalRows - r) * t
		};
	}, X = (e) => {
		let t = st(), n = e.mode === "auto", r = e.viewportWidth || w.clientWidth || 0, i = e.viewportHeight || w.clientHeight || 0;
		if (!(r <= 0 || i <= 0)) return a({
			mode: n ? "width" : e.mode,
			viewportWidth: r,
			viewportHeight: i,
			contentWidth: t.contentWidth,
			contentHeight: t.contentHeight,
			currentScale: j,
			minScale: e.minScale ?? Be,
			maxScale: e.maxScale ?? (n ? 1 : Ve)
		});
	}, ct = (e) => {
		if (!P.active || !P.columns.length) return {
			applied: !1,
			mode: e.mode,
			resize: e.resize,
			source: e.source,
			reason: "pending",
			provider: "zoom"
		};
		let t = X(e);
		if (!t) return {
			applied: !1,
			mode: e.mode,
			resize: e.resize,
			source: e.source,
			reason: "unmeasurable",
			provider: "zoom"
		};
		let n = Y(t);
		return {
			applied: !0,
			mode: e.mode,
			resize: e.resize,
			scale: n.scale,
			source: e.source,
			provider: "zoom"
		};
	}, lt = () => {
		let e = Number(u?.options?.initialViewState?.scale ?? u?.options?.initialViewState?.zoom?.scale);
		if (Ue || u?.options?.fit !== void 0 || Number.isFinite(e) && e > 0) {
			Ue = !0;
			return;
		}
		let n = X({
			mode: "auto",
			resize: "initial",
			padding: 0,
			source: "initial",
			reason: "initial",
			viewportWidth: w.clientWidth || t.clientWidth || 0,
			viewportHeight: w.clientHeight || t.clientHeight || 0,
			container: w
		});
		!n || n >= j ? n && (Ue = !0) : (j = Nn(n), J(), _.emit(), Ue = !0);
	};
	n(v, {
		zoomIn: () => Y(j + .1),
		zoomOut: () => Y(j - .1),
		resetZoom: () => Y(1),
		setZoom: Y,
		fit: ct,
		getState: tt,
		subscribe: _.subscribe
	});
	let Z = () => {
		Ae = P.loadedWindows.size, je = P.loadingWindows.size, K();
	}, ut = () => {
		M = {
			scrollX: L?.ctx.scrollX || 0,
			scrollY: L?.ctx.scrollY || 0,
			width: w.clientWidth || 0,
			height: w.clientHeight || 0
		}, rt();
	}, dt = (e) => {
		var t, n, r, i;
		let a = L?.ctx.selector;
		a && (a.xArrCopy = e.xArr.slice(), a.yArrCopy = e.yArr.slice(), (n = L == null ? void 0 : (t = L.ctx).emit) == null || n.call(t, "copyChange", {
			xArr: a.xArrCopy,
			yArr: a.yArrCopy,
			data: e.data
		}), (i = L == null ? void 0 : (r = L.ctx).emit) == null || i.call(r, "draw"));
	}, ft = (e) => {
		let t = Fn(e.data);
		Ln(m, t).then((t) => {
			t ? dt(e) : console.error("Spreadsheet copy failed: clipboard fallback returned false.");
		}).catch((e) => {
			console.error("Spreadsheet copy failed:", e);
		});
	}, pt = () => ({
		config: tn({
			hostHeight: Je(),
			darkMode: ne,
			resizableColumns: We,
			resizableRows: Ge,
			copySelection: ft,
			sheetDefaults: O,
			virtualState: P,
			zoomScale: j
		}),
		columns: Et(P.columns, j)
	}), mt = () => {
		B = {
			start: 0,
			end: 0
		}, V = 1, Re = 0;
	}, ht = (e, t) => {
		P.active && P.totalRows && ge({
			startRow: e,
			endRow: t,
			direction: V,
			totalRows: P.totalRows
		}).forEach((e) => jt(e, !0));
	}, gt = () => {
		L && !H && (z && cancelAnimationFrame(z), z = requestAnimationFrame(() => {
			if (z = 0, !L || !P.active || !P.totalRows || H) return;
			let e = Math.max(L.ctx.body.headIndex || 0, 0), t = Math.max(L.ctx.body.tailIndex || e, e), n = L.ctx.scrollY || 0;
			V = n >= Re ? 1 : -1, Re = n, B = {
				start: e,
				end: t
			}, ut(), ht(e, t);
		}));
	}, Q = () => L || (L = new ee(w, {
		data: [],
		columns: [],
		config: tn({
			hostHeight: Je(),
			darkMode: ne,
			resizableColumns: We,
			resizableRows: Ge,
			copySelection: ft,
			sheetDefaults: O,
			virtualState: P,
			zoomScale: j
		})
	}), L.on("onScrollX", gt), L.on("onScrollY", gt), L.on("resize", gt), L.on("resizeColumnChange", kt), L.on("resizeRowChange", At), L), _t = (e, t = P.columns, n = P.rows, r = !1) => {
		let i = {
			config: tn({
				hostHeight: Je(),
				darkMode: ne,
				resizableColumns: We,
				resizableRows: Ge,
				copySelection: ft,
				sheetDefaults: O,
				virtualState: P,
				zoomScale: j
			}),
			columns: Et(t, j)
		};
		e.loadConfig(i.config), e.loadColumns(i.columns), e.loadData(n), e.draw(), ut(), r ? requestAnimationFrame(() => {
			e.scrollTo(0, 0), e.draw(), ut(), gt();
		}) : gt();
	};
	function vt() {
		let e = Q(), { config: t, columns: n } = pt();
		e.loadConfig(t), P.active && n.length && e.loadColumns(n), e.doLayout(), e.draw(), ut(), gt();
	}
	let yt = () => {
		Ie += 1;
		let e = bn(t);
		for (; Le.length;) {
			let t = Le.pop();
			t !== void 0 && e?.clearTimeout(t);
		}
	}, St = () => {
		if (H || !L || !P.active) return;
		let e = w.getBoundingClientRect();
		e.width <= 0 || e.height <= 0 || (lt(), vt());
	}, Tt = () => {
		var e;
		yt();
		let n = Ie, r = bn(t);
		r && ([
			0,
			32,
			120,
			300,
			700
		].forEach((e) => {
			let t = r.setTimeout(() => {
				let e = Le.indexOf(t);
				e >= 0 && Le.splice(e, 1), r.requestAnimationFrame(() => {
					n === Ie && St();
				});
			}, e);
			Le.push(t);
		}), (e = m.fonts) == null || e.ready.then(() => {
			n === Ie && St();
		}).catch(() => {}));
	};
	function Dt(e, t, n) {
		for (let r of e) {
			if (`${r.key}` === t) return r.width = n, !0;
			if (Array.isArray(r.children) && Dt(r.children, t, n)) return !0;
		}
		return !1;
	}
	function Ot() {
		var e;
		try {
			(e = L?.setCustomHeader) == null || e.call(L, { resizableData: {} }, !0);
		} catch {}
	}
	function kt(e) {
		if (!We || H) return;
		let t = e?.key === void 0 ? "" : `${e.key}`, n = Number(e?.width);
		if (!t || t === "__index" || !Number.isFinite(n) || n <= 0) return;
		let r = Math.max(1, Math.round(n / Math.max(j, .01)));
		if (!Dt(P.columns, t, Math.max(r, Math.round(40 / Math.max(j, 1))))) return;
		let i = W();
		i !== void 0 && F.set(i, P), Ot(), vt();
	}
	function At(e) {
		if (!Ge || H) return;
		let t = Number(e?.rowIndex), n = Number(e?.height);
		if (!Number.isInteger(t) || t < 0 || !Number.isFinite(n) || n <= 0) return;
		let r = P.rows[t];
		if (!r) return;
		let i = xt(Math.max(18, Math.round(n / Math.max(j, .01))), P.defaults.rowHeight);
		q(r, i), P.rowHeightCache.set(t, i);
		let a = W();
		a !== void 0 && F.set(a, P), vt();
	}
	function jt(e = 0, t = !0) {
		let n = W();
		if (n === void 0) return;
		let r = me(e, P.totalRows);
		P.loadedWindows.has(r) || P.loadingWindows.has(r) || (P.loadingWindows.add(r), Z(), P.active && (_e(P.rows, P.totalRows, r, b.Loading), L?.draw()), E = "", ot("parseSheet", {
			sheet: n,
			startRow: r,
			pageSize: 500,
			sessionId: ze
		}), t && (N = !1, K()));
	}
	let Mt = (e) => {
		let t = e.meta;
		if (!t) return;
		let { columns: n, dataKeys: r } = wt(e);
		P = {
			...le(),
			active: !0,
			totalRows: t.totalRows,
			totalCols: t.totalCols,
			indexOffset: Ct(e),
			defaults: e.defaults,
			dataKeys: r,
			rows: fe(t.totalRows),
			columns: n
		}, O = e.defaults, D = t.totalRows, ke = t.totalCols, Z();
	}, Nt = (e) => {
		P.dataKeys.forEach((t) => {
			delete e[t];
		});
	}, Pt = (e) => {
		Array.isArray(e) && e.forEach((e, t) => {
			if (e === void 0) return;
			let n = P.rows[t];
			if (!n) return;
			let r = xt(e, P.defaults.rowHeight);
			q(n, r), P.rowHeightCache.set(t, r);
		});
	}, Ft = (e) => {
		let t = e.meta;
		if (!t) return;
		let n = [], r = Math.min(t.endRow, P.totalRows);
		for (let i = t.startRow; i < r; i += 1) {
			let r = P.rows[i], a = i - t.startRow;
			if (!r) continue;
			Nt(r), (e.data?.[a] || []).forEach((e, t) => {
				e !== "" && e != null && (r[ue(t)] = e);
			});
			let o = bt(e.rowHeights, a, P.defaults.rowHeight), s = xt(bt(e.structure?.rowHeights, i, o), P.defaults.rowHeight);
			q(r, s), r.__s = b.Loaded, P.rowHeightCache.set(i, s), n.push(i);
		}
		P.windowRows.set(t.startRow, n);
	}, It = (e) => {
		let t = e.meta;
		if (!t) return;
		let n = [];
		Object.entries(e.cell || {}).forEach(([e, r]) => {
			let [i, a] = e.split("-").map(Number), o = x(t.startRow + i, a + 1), s = en(r);
			s && (P.cellCache.set(o, s), n.push(o));
		}), P.windowCells.set(t.startRow, n);
	}, Lt = (e) => {
		P.mergeStartMap.clear(), P.mergeCoveredMap.clear(), e.forEach((e) => {
			let t = x(e.row, e.col + 1);
			P.mergeStartMap.set(t, {
				...e,
				col: e.col + 1
			});
			for (let t = 0; t < e.rowspan; t += 1) for (let n = 0; n < e.colspan; n += 1) {
				if (t === 0 && n === 0) continue;
				let r = x(e.row + t, e.col + n + 1);
				P.mergeCoveredMap.set(r, !0);
			}
		});
	}, Rt = (e) => {
		let t = e.structure, n = t?.merge;
		if (n) Lt(n);
		else {
			let t = e.meta;
			t && !P.mergeStartMap.size && Lt((e.merge || []).map((e) => ({
				...e,
				row: e.row + t.startRow
			})));
		}
		if (Pt(t?.rowHeights), t?.images) {
			Me = t.images;
			let e = W();
			e !== void 0 && Pe.set(e, t.images);
		}
		if (t?.charts) {
			Ne = t.charts;
			let e = W();
			e !== void 0 && I.set(e, t.charts);
		}
	}, zt = (e) => {
		var t;
		let n = e.meta;
		if (!n) return;
		let r = !A;
		P.active || Mt(e), Rt(e), Ft(e), It(e), lt(), P.loadedWindows.add(n.startRow), P.loadingWindows.delete(n.startRow), Z(), A = !0;
		let i = W();
		i !== void 0 && F.set(i, P), r ? _t(Q(), P.columns, P.rows, !0) : L?.draw(), N = !1, k = !1, K(), He || (He = !0, (t = u?.onProgressiveRender) == null || t.call(u)), r && Tt();
		let a = B.start || n.startRow, o = Math.max(B.end, n.endRow - 1, n.startRow);
		ht(a, o);
	}, Bt = () => {
		E = "", D = 0, ke = 0, O = { ...ce }, Me = [], Ne = [], P = le(), A = !1, mt(), Z(), ut(), L && (L.loadColumns([]), L.loadData([]), L.scrollTo(0, 0), L.draw());
	}, Vt = () => {
		let e = W();
		e !== void 0 && P.active && F.set(e, P);
	}, Ht = (e) => {
		let t = F.get(e);
		return t ? (t.loadingWindows.clear(), P = t, E = "", D = t.totalRows, ke = t.totalCols, O = t.defaults, Me = Pe.get(e) || [], Ne = I.get(e) || [], A = t.loadedWindows.size > 0, k = !A, Z(), queueMicrotask(() => {
			H || (_t(Q(), t.columns, t.rows), ut(), Tt());
		}), !0) : !1;
	}, Ut = () => {
		let e = W();
		e === void 0 ? (N = !1, k = !1, K()) : (ze += 1, Ht(e) ? (N = !1, K()) : (k = !0, Bt(), jt(0, !1)));
	};
	function Wt(e) {
		T === e || (Vt(), T = e, K(), Ut()), it();
	}
	let Gt = () => {
		ot("parseWorkbook", {
			workbook: e,
			fileType: l,
			filename: u?.filename,
			textEncoding: u?.options?.spreadsheet?.textEncoding
		});
	};
	U.onWorkerEvent("sheets", ({ sheets: e }) => {
		Oe = e;
		let t = e.find((e) => !e.hidden) || e[0];
		t ? (T = t.id, K(), Ut(), it()) : (k = !1, N = !1, K());
	}), U.onWorkerEvent("parseSheet", ({ sessionId: e, sheet: t, sheetData: n }) => {
		e === ze && t === W() && zt(n);
	}), U.onWorkerEvent("parseError", ({ sessionId: e, startRow: t, message: n }) => {
		e && e !== ze || (k = !1, N = !1, typeof t == "number" ? (P.loadingWindows.delete(t), Z(), P.active && (_e(P.rows, P.totalRows, t, b.Placeholder), L?.draw())) : (P.loadingWindows.clear(), Z()), E = n || g("spreadsheet.error.parseFailed"), K());
	}), U.onWorkerError((e) => {
		k = !1, N = !1, E = e.message || g("spreadsheet.error.workerFailed"), K();
	}), (f = u?.registerExportAdapter) == null || f.call(u, {
		print: !1,
		exportHtml: !1
	}), (p = u?.registerThumbnailAdapter) == null || p.call(u, {
		beforeCapture: async ({ signal: e }) => {
			for (; !A && !E && !H;) {
				if (e?.aborted) throw e.reason;
				await new Promise((e) => {
					let n = bn(t);
					n ? n.setTimeout(e, 16) : setTimeout(e, 16);
				});
			}
			if (E) throw Error(E);
		},
		getTarget: () => ve
	}), Q();
	let Kt = bn(t)?.ResizeObserver || (typeof ResizeObserver < "u" ? ResizeObserver : void 0);
	return Kt && (Fe = new Kt(() => {
		R && cancelAnimationFrame(R), R = requestAnimationFrame(() => {
			R = 0, vt();
		});
	}), Fe.observe(w)), K(), Gt(), {
		$el: v,
		unmount() {
			var e, t;
			H = !0, R && cancelAnimationFrame(R), z && cancelAnimationFrame(z), yt(), Fe?.disconnect(), Fe = null, i(v), U.destroy(), L?.destroy(), L = null, (e = u?.registerExportAdapter) == null || e.call(u, null), (t = u?.registerThumbnailAdapter) == null || t.call(u, null);
		}
	};
};
export { Rn as default, C as t };
