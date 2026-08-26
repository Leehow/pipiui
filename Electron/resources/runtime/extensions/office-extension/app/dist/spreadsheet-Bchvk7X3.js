import { c as io, o as ao, r as so, u as lo, p as co, a as ho, d as uo, b as fo } from "./office-renderer-CZRmDY3X.js";
const po = (e, t = {}) => {
  const r = e(), n = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Set(), i = /* @__PURE__ */ new Set(), l = (p, u) => {
    r?.postMessage({
      type: p,
      payload: u
    });
  }, d = (p) => {
    const { type: u, payload: b } = p.data || {}, _ = n.get(u);
    _?.forEach((A) => A(b)), o.forEach((A) => A(p));
  }, c = (p) => {
    t.logErrors !== !1 && console.error(p), i.forEach((u) => u(p));
  };
  return r?.addEventListener("message", d), r?.addEventListener("error", c), {
    instance: r,
    worker: {
      emit: l
    },
    emit: l,
    onWorkerMessage(p) {
      return o.add(p), () => {
        o.delete(p);
      };
    },
    onWorkerError(p) {
      return i.add(p), () => {
        i.delete(p);
      };
    },
    onWorkerEvent(p, u) {
      let b = n.get(p);
      return b || (b = /* @__PURE__ */ new Set(), n.set(p, b)), b.add(u), () => {
        b?.delete(u), b?.size === 0 && n.delete(p);
      };
    },
    mapEvents(p) {
      return Array.isArray(p) ? p.reduce((u, b) => (u[b] = (_) => l(b, _), u), {}) : Object.keys(p).reduce((u, b) => {
        const _ = p[b];
        return u[_] = (A) => l(b, A), u;
      }, {});
    },
    destroy() {
      r?.removeEventListener("message", d), r?.removeEventListener("error", c), r?.terminate(), n.clear(), o.clear(), i.clear();
    }
  };
}, go = "http://www.w3.org/2000/svg", bt = ["#4472c4", "#ed7d31", "#70ad47", "#ffc000", "#5b9bd5", "#a5a5a5"], z = (e, t, r = {}) => {
  const n = e.createElementNS(go, t);
  return Object.entries(r).forEach(([o, i]) => n.setAttribute(o, `${i}`)), n;
}, xe = (e, t, r, n, o = {}) => {
  const i = z(e, "text", {
    x: r,
    y: n,
    "text-anchor": o.anchor || "start",
    "font-family": "Aptos, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    "font-size": o.size || 11,
    "font-weight": o.weight || "400",
    fill: o.fill || "#5f6368"
  });
  return o.rotate && i.setAttribute("transform", `rotate(${o.rotate} ${r} ${n})`), i.textContent = t, i;
}, Oe = (e, t) => e.color || bt[t % bt.length], jt = (e) => {
  var t;
  const r = ((t = e.series.find((o) => o.categories.length)) === null || t === void 0 ? void 0 : t.categories) || [], n = Math.max(0, ...e.series.map((o) => o.values.length));
  return r.length ? r : Array.from({ length: n }, (o, i) => `${i + 1}`);
}, Kt = (e) => {
  const t = e.series.flatMap((o) => o.values).filter(Number.isFinite), r = Math.min(0, ...t), n = Math.max(0, ...t);
  return r === n ? { min: 0, max: Math.max(1, n), span: Math.max(1, n) } : { min: r, max: n, span: n - r };
}, mo = (e) => {
  const t = !!e.title, r = !!e.legendPosition, n = e.legendPosition === "right", o = t ? 48 : 24, i = r && !n ? 302 : 326, l = e.valueAxisTitle ? 76 : 58;
  return {
    left: l,
    top: o,
    width: (n ? 492 : 612) - l,
    height: i - o,
    bottom: i
  };
}, Qr = (e, t, r, n) => {
  for (let i = 0; i <= 5; i += 1) {
    const l = i / 5, d = r.bottom - l * r.height, c = n.min + l * n.span;
    t.appendChild(z(e, "line", {
      x1: r.left,
      y1: d,
      x2: r.left + r.width,
      y2: d,
      stroke: i === 0 ? "#9ca3af" : "#e5e7eb",
      "stroke-width": 1
    })), t.appendChild(xe(e, Number.isInteger(c) ? `${c}` : c.toFixed(1), r.left - 8, d + 4, {
      anchor: "end",
      size: 10
    }));
  }
}, en = (e, t, r, n) => {
  const o = jt(r);
  if (!o.length)
    return;
  const i = n.width / o.length;
  o.forEach((l, d) => {
    const c = o.length > 8 ? 8 : 14, m = l.length > c ? `${l.slice(0, c - 1)}…` : l;
    t.appendChild(xe(e, m, n.left + (d + 0.5) * i, n.bottom + 17, {
      anchor: "middle",
      size: 10
    }));
  });
}, vo = (e, t, r, n) => {
  const o = Kt(r), i = jt(r), l = Math.max(i.length, ...r.series.map((u) => u.values.length), 1), d = n.width / l, c = Math.max(r.series.length, 1), m = d * 0.76 / c, p = n.bottom - (0 - o.min) / o.span * n.height;
  Qr(e, t, n, o), r.series.forEach((u, b) => {
    u.values.forEach((_, A) => {
      const x = n.bottom - (_ - o.min) / o.span * n.height, W = n.left + A * d + d * 0.12 + b * m, P = Math.min(p, x), L = z(e, "rect", {
        x: W,
        y: P,
        width: Math.max(1, m - 2),
        height: Math.max(1, Math.abs(p - x)),
        fill: Oe(u, b),
        rx: 1
      }), k = z(e, "title");
      k.textContent = `${u.name}: ${_}`, L.appendChild(k), t.appendChild(L);
    });
  }), en(e, t, r, n);
}, bo = (e, t, r, n) => {
  const o = Kt(r), i = jt(r), l = Math.max(i.length, ...r.series.map((u) => u.values.length), 1), d = n.height / l, c = Math.max(r.series.length, 1), m = d * 0.76 / c, p = n.left + (0 - o.min) / o.span * n.width;
  for (let u = 0; u <= 5; u += 1) {
    const b = u / 5, _ = n.left + b * n.width;
    t.appendChild(z(e, "line", {
      x1: _,
      y1: n.top,
      x2: _,
      y2: n.bottom,
      stroke: "#e5e7eb",
      "stroke-width": 1
    }));
  }
  r.series.forEach((u, b) => {
    u.values.forEach((_, A) => {
      const x = n.left + (_ - o.min) / o.span * n.width, W = n.top + A * d + d * 0.12 + b * m;
      t.appendChild(z(e, "rect", {
        x: Math.min(p, x),
        y: W,
        width: Math.max(1, Math.abs(x - p)),
        height: Math.max(1, m - 2),
        fill: Oe(u, b),
        rx: 1
      }));
    });
  }), i.forEach((u, b) => {
    t.appendChild(xe(e, u, n.left - 8, n.top + (b + 0.5) * d + 4, {
      anchor: "end",
      size: 10
    }));
  });
}, Cr = (e, t, r, n, o) => {
  const i = Kt(r), l = Math.max(...r.series.map((c) => c.values.length), 1), d = l > 1 ? n.width / (l - 1) : n.width;
  Qr(e, t, n, i), r.series.forEach((c, m) => {
    const p = c.values.map((b, _) => ({
      x: n.left + (l > 1 ? _ * d : n.width / 2),
      y: n.bottom - (b - i.min) / i.span * n.height
    }));
    if (!p.length)
      return;
    const u = p.map((b, _) => `${_ ? "L" : "M"}${b.x},${b.y}`).join(" ");
    o && p.length > 1 && t.appendChild(z(e, "path", {
      d: `${u} L${p[p.length - 1].x},${n.bottom} L${p[0].x},${n.bottom} Z`,
      fill: Oe(c, m),
      opacity: 0.2
    })), t.appendChild(z(e, "path", {
      d: u,
      fill: "none",
      stroke: Oe(c, m),
      "stroke-width": 2.5,
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    })), p.forEach((b) => {
      t.appendChild(z(e, "circle", {
        cx: b.x,
        cy: b.y,
        r: 3.5,
        fill: Oe(c, m),
        stroke: "#ffffff",
        "stroke-width": 1
      }));
    });
  }), en(e, t, r, n);
}, dt = (e, t, r, n) => {
  const o = (n - 90) * Math.PI / 180;
  return {
    x: e + r * Math.cos(o),
    y: t + r * Math.sin(o)
  };
}, wo = (e, t, r, n, o, i) => {
  const l = dt(e, t, r, i), d = dt(e, t, r, o), c = i - o > 180 ? 1 : 0;
  if (!n)
    return `M${e},${t} L${l.x},${l.y} A${r},${r} 0 ${c},0 ${d.x},${d.y} Z`;
  const m = dt(e, t, n, o), p = dt(e, t, n, i);
  return `M${l.x},${l.y} A${r},${r} 0 ${c},0 ${d.x},${d.y} L${m.x},${m.y} A${n},${n} 0 ${c},1 ${p.x},${p.y} Z`;
}, Sr = (e, t, r, n) => {
  const o = r.series[0], i = o?.values || [], l = o?.categories || [], d = i.reduce((b, _) => b + Math.max(0, _), 0) || 1, c = r.legendPosition === "right" ? 260 : 320, m = r.title ? 180 : 170, p = 120;
  let u = 0;
  i.forEach((b, _) => {
    const A = u + Math.max(0, b) / d * 360, x = bt[_ % bt.length], W = z(e, "path", {
      d: wo(c, m, p, n ? 62 : 0, u, A),
      fill: x,
      stroke: "#ffffff",
      "stroke-width": 1.5
    }), P = z(e, "title");
    P.textContent = `${l[_] || _ + 1}: ${b}`, W.appendChild(P), t.appendChild(W), u = A;
  });
}, xo = (e, t, r) => {
  if (!r.legendPosition)
    return;
  const n = r.legendPosition === "right";
  r.series.slice(0, 8).forEach((o, i) => {
    const l = n ? 510 : 76 + i % 4 * 136, d = n ? 72 + i * 28 : 342 - Math.floor(i / 4) * 20;
    t.appendChild(z(e, "rect", {
      x: l,
      y: d - 10,
      width: 10,
      height: 10,
      fill: Oe(o, i)
    }));
    const c = o.name.length > 16 ? `${o.name.slice(0, 15)}…` : o.name;
    t.appendChild(xe(e, c, l + 15, d, { size: 10 }));
  });
}, _o = (e, t) => {
  const r = e.createElement("div");
  r.className = "excel-chart", r.dataset.chartId = t.id, r.dataset.chartType = t.type, r.dataset.seriesNames = JSON.stringify(t.series.map((i) => i.name)), r.setAttribute("role", "img"), r.setAttribute("aria-label", t.title || t.id || "Spreadsheet chart");
  const n = z(e, "svg", {
    viewBox: "0 0 640 360",
    preserveAspectRatio: "xMidYMid meet",
    focusable: "false",
    "aria-hidden": "true"
  });
  n.appendChild(z(e, "rect", {
    x: 0.5,
    y: 0.5,
    width: 639,
    height: 359,
    fill: "#ffffff",
    stroke: "#d1d5db"
  })), t.title && n.appendChild(xe(e, t.title, 320, 28, {
    anchor: "middle",
    size: 16,
    weight: "600",
    fill: "#1f2937"
  }));
  const o = mo(t);
  switch (t.type) {
    case "pie":
      Sr(e, n, t, !1);
      break;
    case "doughnut":
      Sr(e, n, t, !0);
      break;
    case "line":
    case "scatter":
    case "radar":
      Cr(e, n, t, o, !1);
      break;
    case "area":
      Cr(e, n, t, o, !0);
      break;
    default:
      t.barDirection === "bar" ? bo(e, n, t, o) : vo(e, n, t, o);
      break;
  }
  return t.categoryAxisTitle && t.type !== "pie" && t.type !== "doughnut" && n.appendChild(xe(e, t.categoryAxisTitle, o.left + o.width / 2, 324, {
    anchor: "middle",
    size: 11,
    fill: "#374151"
  })), t.valueAxisTitle && t.type !== "pie" && t.type !== "doughnut" && n.appendChild(xe(e, t.valueAxisTitle, 18, o.top + o.height / 2, {
    anchor: "middle",
    size: 11,
    fill: "#374151",
    rotate: -90
  })), xo(e, n, t), r.appendChild(n), r;
}, Q = 500, Ar = 3, Mr = 1, tn = "__index", rn = "__k", yt = "__s", gt = {
  rowHeight: 20,
  colWidth: 64
}, ge = {
  Placeholder: 0,
  Loading: 1,
  Loaded: 2
}, Wt = () => ({
  active: !1,
  totalRows: 0,
  totalCols: 0,
  indexOffset: 0,
  defaults: { ...gt },
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
}), ae = (e, t) => `${e}-${t}`, Ct = (e) => `c${e}`, $t = (e) => {
  var t;
  return (t = e?.[yt]) !== null && t !== void 0 ? t : ge.Placeholder;
}, Eo = (e) => {
  const t = new Array(e);
  for (let r = 0; r < e; r += 1)
    t[r] = {
      [rn]: `${r}`,
      [yt]: ge.Placeholder
    };
  return t;
}, yo = (e) => e ? Math.floor(Math.max(e - 1, 0) / Q) * Q : 0, wt = (e = 0, t = 0) => Math.min(Math.max(e, 0), yo(t)), Tr = (e = 0, t = 0) => {
  const r = Math.floor(Math.max(e, 0) / Q) * Q;
  return wt(r, t);
}, Co = ({ startRow: e, endRow: t, direction: r, totalRows: n, far: o = !1 }) => {
  const i = /* @__PURE__ */ new Set(), l = Tr(e, n), d = Tr(t, n);
  for (let u = l; u <= d; u += Q)
    i.add(u);
  const c = o ? Ar + 1 : Ar, m = o ? Mr + 1 : Mr, p = r > 0 ? d : l;
  for (let u = 1; u <= c; u += 1)
    i.add(wt(p + r * u * Q, n));
  for (let u = 1; u <= m; u += 1)
    i.add(wt(p - r * u * Q, n));
  return Array.from(i);
}, Lr = (e, t, r, n) => {
  const o = Math.min(r + Q, t);
  for (let i = r; i < o; i += 1) {
    const l = e[i];
    l && (l[yt] = n);
  }
};
function xt(e) {
  "@babel/helpers - typeof";
  return xt = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(t) {
    return typeof t;
  } : function(t) {
    return t && typeof Symbol == "function" && t.constructor === Symbol && t !== Symbol.prototype ? "symbol" : typeof t;
  }, xt(e);
}
var So = /^\s+/, Ao = /\s+$/;
function v(e, t) {
  if (e = e || "", t = t || {}, e instanceof v)
    return e;
  if (!(this instanceof v))
    return new v(e, t);
  var r = Mo(e);
  this._originalInput = e, this._r = r.r, this._g = r.g, this._b = r.b, this._a = r.a, this._roundA = Math.round(100 * this._a) / 100, this._format = t.format || r.format, this._gradientType = t.gradientType, this._r < 1 && (this._r = Math.round(this._r)), this._g < 1 && (this._g = Math.round(this._g)), this._b < 1 && (this._b = Math.round(this._b)), this._ok = r.ok;
}
v.prototype = {
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
    var t = this.toRgb();
    return (t.r * 299 + t.g * 587 + t.b * 114) / 1e3;
  },
  getLuminance: function() {
    var t = this.toRgb(), r, n, o, i, l, d;
    return r = t.r / 255, n = t.g / 255, o = t.b / 255, r <= 0.03928 ? i = r / 12.92 : i = Math.pow((r + 0.055) / 1.055, 2.4), n <= 0.03928 ? l = n / 12.92 : l = Math.pow((n + 0.055) / 1.055, 2.4), o <= 0.03928 ? d = o / 12.92 : d = Math.pow((o + 0.055) / 1.055, 2.4), 0.2126 * i + 0.7152 * l + 0.0722 * d;
  },
  setAlpha: function(t) {
    return this._a = nn(t), this._roundA = Math.round(100 * this._a) / 100, this;
  },
  toHsv: function() {
    var t = kr(this._r, this._g, this._b);
    return {
      h: t.h * 360,
      s: t.s,
      v: t.v,
      a: this._a
    };
  },
  toHsvString: function() {
    var t = kr(this._r, this._g, this._b), r = Math.round(t.h * 360), n = Math.round(t.s * 100), o = Math.round(t.v * 100);
    return this._a == 1 ? "hsv(" + r + ", " + n + "%, " + o + "%)" : "hsva(" + r + ", " + n + "%, " + o + "%, " + this._roundA + ")";
  },
  toHsl: function() {
    var t = Rr(this._r, this._g, this._b);
    return {
      h: t.h * 360,
      s: t.s,
      l: t.l,
      a: this._a
    };
  },
  toHslString: function() {
    var t = Rr(this._r, this._g, this._b), r = Math.round(t.h * 360), n = Math.round(t.s * 100), o = Math.round(t.l * 100);
    return this._a == 1 ? "hsl(" + r + ", " + n + "%, " + o + "%)" : "hsla(" + r + ", " + n + "%, " + o + "%, " + this._roundA + ")";
  },
  toHex: function(t) {
    return Or(this._r, this._g, this._b, t);
  },
  toHexString: function(t) {
    return "#" + this.toHex(t);
  },
  toHex8: function(t) {
    return ko(this._r, this._g, this._b, this._a, t);
  },
  toHex8String: function(t) {
    return "#" + this.toHex8(t);
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
      r: Math.round(T(this._r, 255) * 100) + "%",
      g: Math.round(T(this._g, 255) * 100) + "%",
      b: Math.round(T(this._b, 255) * 100) + "%",
      a: this._a
    };
  },
  toPercentageRgbString: function() {
    return this._a == 1 ? "rgb(" + Math.round(T(this._r, 255) * 100) + "%, " + Math.round(T(this._g, 255) * 100) + "%, " + Math.round(T(this._b, 255) * 100) + "%)" : "rgba(" + Math.round(T(this._r, 255) * 100) + "%, " + Math.round(T(this._g, 255) * 100) + "%, " + Math.round(T(this._b, 255) * 100) + "%, " + this._roundA + ")";
  },
  toName: function() {
    return this._a === 0 ? "transparent" : this._a < 1 ? !1 : Vo[Or(this._r, this._g, this._b, !0)] || !1;
  },
  toFilter: function(t) {
    var r = "#" + Hr(this._r, this._g, this._b, this._a), n = r, o = this._gradientType ? "GradientType = 1, " : "";
    if (t) {
      var i = v(t);
      n = "#" + Hr(i._r, i._g, i._b, i._a);
    }
    return "progid:DXImageTransform.Microsoft.gradient(" + o + "startColorstr=" + r + ",endColorstr=" + n + ")";
  },
  toString: function(t) {
    var r = !!t;
    t = t || this._format;
    var n = !1, o = this._a < 1 && this._a >= 0, i = !r && o && (t === "hex" || t === "hex6" || t === "hex3" || t === "hex4" || t === "hex8" || t === "name");
    return i ? t === "name" && this._a === 0 ? this.toName() : this.toRgbString() : (t === "rgb" && (n = this.toRgbString()), t === "prgb" && (n = this.toPercentageRgbString()), (t === "hex" || t === "hex6") && (n = this.toHexString()), t === "hex3" && (n = this.toHexString(!0)), t === "hex4" && (n = this.toHex8String(!0)), t === "hex8" && (n = this.toHex8String()), t === "name" && (n = this.toName()), t === "hsl" && (n = this.toHslString()), t === "hsv" && (n = this.toHsvString()), n || this.toHexString());
  },
  clone: function() {
    return v(this.toString());
  },
  _applyModification: function(t, r) {
    var n = t.apply(null, [this].concat([].slice.call(r)));
    return this._r = n._r, this._g = n._g, this._b = n._b, this.setAlpha(n._a), this;
  },
  lighten: function() {
    return this._applyModification(Fo, arguments);
  },
  brighten: function() {
    return this._applyModification(Wo, arguments);
  },
  darken: function() {
    return this._applyModification($o, arguments);
  },
  desaturate: function() {
    return this._applyModification(Oo, arguments);
  },
  saturate: function() {
    return this._applyModification(Ho, arguments);
  },
  greyscale: function() {
    return this._applyModification(No, arguments);
  },
  spin: function() {
    return this._applyModification(Do, arguments);
  },
  _applyCombination: function(t, r) {
    return t.apply(null, [this].concat([].slice.call(r)));
  },
  analogous: function() {
    return this._applyCombination(zo, arguments);
  },
  complement: function() {
    return this._applyCombination(Io, arguments);
  },
  monochromatic: function() {
    return this._applyCombination(Po, arguments);
  },
  splitcomplement: function() {
    return this._applyCombination(Bo, arguments);
  },
  // Disabled until https://github.com/bgrins/TinyColor/issues/254
  // polyad: function (number) {
  //   return this._applyCombination(polyad, [number]);
  // },
  triad: function() {
    return this._applyCombination(Nr, [3]);
  },
  tetrad: function() {
    return this._applyCombination(Nr, [4]);
  }
};
v.fromRatio = function(e, t) {
  if (xt(e) == "object") {
    var r = {};
    for (var n in e)
      e.hasOwnProperty(n) && (n === "a" ? r[n] = e[n] : r[n] = Pe(e[n]));
    e = r;
  }
  return v(e, t);
};
function Mo(e) {
  var t = {
    r: 0,
    g: 0,
    b: 0
  }, r = 1, n = null, o = null, i = null, l = !1, d = !1;
  return typeof e == "string" && (e = Xo(e)), xt(e) == "object" && (ie(e.r) && ie(e.g) && ie(e.b) ? (t = To(e.r, e.g, e.b), l = !0, d = String(e.r).substr(-1) === "%" ? "prgb" : "rgb") : ie(e.h) && ie(e.s) && ie(e.v) ? (n = Pe(e.s), o = Pe(e.v), t = Ro(e.h, n, o), l = !0, d = "hsv") : ie(e.h) && ie(e.s) && ie(e.l) && (n = Pe(e.s), i = Pe(e.l), t = Lo(e.h, n, i), l = !0, d = "hsl"), e.hasOwnProperty("a") && (r = e.a)), r = nn(r), {
    ok: l,
    format: e.format || d,
    r: Math.min(255, Math.max(t.r, 0)),
    g: Math.min(255, Math.max(t.g, 0)),
    b: Math.min(255, Math.max(t.b, 0)),
    a: r
  };
}
function To(e, t, r) {
  return {
    r: T(e, 255) * 255,
    g: T(t, 255) * 255,
    b: T(r, 255) * 255
  };
}
function Rr(e, t, r) {
  e = T(e, 255), t = T(t, 255), r = T(r, 255);
  var n = Math.max(e, t, r), o = Math.min(e, t, r), i, l, d = (n + o) / 2;
  if (n == o)
    i = l = 0;
  else {
    var c = n - o;
    switch (l = d > 0.5 ? c / (2 - n - o) : c / (n + o), n) {
      case e:
        i = (t - r) / c + (t < r ? 6 : 0);
        break;
      case t:
        i = (r - e) / c + 2;
        break;
      case r:
        i = (e - t) / c + 4;
        break;
    }
    i /= 6;
  }
  return {
    h: i,
    s: l,
    l: d
  };
}
function Lo(e, t, r) {
  var n, o, i;
  e = T(e, 360), t = T(t, 100), r = T(r, 100);
  function l(m, p, u) {
    return u < 0 && (u += 1), u > 1 && (u -= 1), u < 1 / 6 ? m + (p - m) * 6 * u : u < 1 / 2 ? p : u < 2 / 3 ? m + (p - m) * (2 / 3 - u) * 6 : m;
  }
  if (t === 0)
    n = o = i = r;
  else {
    var d = r < 0.5 ? r * (1 + t) : r + t - r * t, c = 2 * r - d;
    n = l(c, d, e + 1 / 3), o = l(c, d, e), i = l(c, d, e - 1 / 3);
  }
  return {
    r: n * 255,
    g: o * 255,
    b: i * 255
  };
}
function kr(e, t, r) {
  e = T(e, 255), t = T(t, 255), r = T(r, 255);
  var n = Math.max(e, t, r), o = Math.min(e, t, r), i, l, d = n, c = n - o;
  if (l = n === 0 ? 0 : c / n, n == o)
    i = 0;
  else {
    switch (n) {
      case e:
        i = (t - r) / c + (t < r ? 6 : 0);
        break;
      case t:
        i = (r - e) / c + 2;
        break;
      case r:
        i = (e - t) / c + 4;
        break;
    }
    i /= 6;
  }
  return {
    h: i,
    s: l,
    v: d
  };
}
function Ro(e, t, r) {
  e = T(e, 360) * 6, t = T(t, 100), r = T(r, 100);
  var n = Math.floor(e), o = e - n, i = r * (1 - t), l = r * (1 - o * t), d = r * (1 - (1 - o) * t), c = n % 6, m = [r, l, i, i, d, r][c], p = [d, r, r, l, i, i][c], u = [i, i, d, r, r, l][c];
  return {
    r: m * 255,
    g: p * 255,
    b: u * 255
  };
}
function Or(e, t, r, n) {
  var o = [Z(Math.round(e).toString(16)), Z(Math.round(t).toString(16)), Z(Math.round(r).toString(16))];
  return n && o[0].charAt(0) == o[0].charAt(1) && o[1].charAt(0) == o[1].charAt(1) && o[2].charAt(0) == o[2].charAt(1) ? o[0].charAt(0) + o[1].charAt(0) + o[2].charAt(0) : o.join("");
}
function ko(e, t, r, n, o) {
  var i = [Z(Math.round(e).toString(16)), Z(Math.round(t).toString(16)), Z(Math.round(r).toString(16)), Z(on(n))];
  return o && i[0].charAt(0) == i[0].charAt(1) && i[1].charAt(0) == i[1].charAt(1) && i[2].charAt(0) == i[2].charAt(1) && i[3].charAt(0) == i[3].charAt(1) ? i[0].charAt(0) + i[1].charAt(0) + i[2].charAt(0) + i[3].charAt(0) : i.join("");
}
function Hr(e, t, r, n) {
  var o = [Z(on(n)), Z(Math.round(e).toString(16)), Z(Math.round(t).toString(16)), Z(Math.round(r).toString(16))];
  return o.join("");
}
v.equals = function(e, t) {
  return !e || !t ? !1 : v(e).toRgbString() == v(t).toRgbString();
};
v.random = function() {
  return v.fromRatio({
    r: Math.random(),
    g: Math.random(),
    b: Math.random()
  });
};
function Oo(e, t) {
  t = t === 0 ? 0 : t || 10;
  var r = v(e).toHsl();
  return r.s -= t / 100, r.s = St(r.s), v(r);
}
function Ho(e, t) {
  t = t === 0 ? 0 : t || 10;
  var r = v(e).toHsl();
  return r.s += t / 100, r.s = St(r.s), v(r);
}
function No(e) {
  return v(e).desaturate(100);
}
function Fo(e, t) {
  t = t === 0 ? 0 : t || 10;
  var r = v(e).toHsl();
  return r.l += t / 100, r.l = St(r.l), v(r);
}
function Wo(e, t) {
  t = t === 0 ? 0 : t || 10;
  var r = v(e).toRgb();
  return r.r = Math.max(0, Math.min(255, r.r - Math.round(255 * -(t / 100)))), r.g = Math.max(0, Math.min(255, r.g - Math.round(255 * -(t / 100)))), r.b = Math.max(0, Math.min(255, r.b - Math.round(255 * -(t / 100)))), v(r);
}
function $o(e, t) {
  t = t === 0 ? 0 : t || 10;
  var r = v(e).toHsl();
  return r.l -= t / 100, r.l = St(r.l), v(r);
}
function Do(e, t) {
  var r = v(e).toHsl(), n = (r.h + t) % 360;
  return r.h = n < 0 ? 360 + n : n, v(r);
}
function Io(e) {
  var t = v(e).toHsl();
  return t.h = (t.h + 180) % 360, v(t);
}
function Nr(e, t) {
  if (isNaN(t) || t <= 0)
    throw new Error("Argument to polyad must be a positive number");
  for (var r = v(e).toHsl(), n = [v(e)], o = 360 / t, i = 1; i < t; i++)
    n.push(v({
      h: (r.h + i * o) % 360,
      s: r.s,
      l: r.l
    }));
  return n;
}
function Bo(e) {
  var t = v(e).toHsl(), r = t.h;
  return [v(e), v({
    h: (r + 72) % 360,
    s: t.s,
    l: t.l
  }), v({
    h: (r + 216) % 360,
    s: t.s,
    l: t.l
  })];
}
function zo(e, t, r) {
  t = t || 6, r = r || 30;
  var n = v(e).toHsl(), o = 360 / r, i = [v(e)];
  for (n.h = (n.h - (o * t >> 1) + 720) % 360; --t; )
    n.h = (n.h + o) % 360, i.push(v(n));
  return i;
}
function Po(e, t) {
  t = t || 6;
  for (var r = v(e).toHsv(), n = r.h, o = r.s, i = r.v, l = [], d = 1 / t; t--; )
    l.push(v({
      h: n,
      s: o,
      v: i
    })), i = (i + d) % 1;
  return l;
}
v.mix = function(e, t, r) {
  r = r === 0 ? 0 : r || 50;
  var n = v(e).toRgb(), o = v(t).toRgb(), i = r / 100, l = {
    r: (o.r - n.r) * i + n.r,
    g: (o.g - n.g) * i + n.g,
    b: (o.b - n.b) * i + n.b,
    a: (o.a - n.a) * i + n.a
  };
  return v(l);
};
v.readability = function(e, t) {
  var r = v(e), n = v(t);
  return (Math.max(r.getLuminance(), n.getLuminance()) + 0.05) / (Math.min(r.getLuminance(), n.getLuminance()) + 0.05);
};
v.isReadable = function(e, t, r) {
  var n = v.readability(e, t), o, i;
  switch (i = !1, o = jo(r), o.level + o.size) {
    case "AAsmall":
    case "AAAlarge":
      i = n >= 4.5;
      break;
    case "AAlarge":
      i = n >= 3;
      break;
    case "AAAsmall":
      i = n >= 7;
      break;
  }
  return i;
};
v.mostReadable = function(e, t, r) {
  var n = null, o = 0, i, l, d, c;
  r = r || {}, l = r.includeFallbackColors, d = r.level, c = r.size;
  for (var m = 0; m < t.length; m++)
    i = v.readability(e, t[m]), i > o && (o = i, n = v(t[m]));
  return v.isReadable(e, n, {
    level: d,
    size: c
  }) || !l ? n : (r.includeFallbackColors = !1, v.mostReadable(e, ["#fff", "#000"], r));
};
var Pt = v.names = {
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
}, Vo = v.hexNames = Go(Pt);
function Go(e) {
  var t = {};
  for (var r in e)
    e.hasOwnProperty(r) && (t[e[r]] = r);
  return t;
}
function nn(e) {
  return e = parseFloat(e), (isNaN(e) || e < 0 || e > 1) && (e = 1), e;
}
function T(e, t) {
  Yo(e) && (e = "100%");
  var r = Uo(e);
  return e = Math.min(t, Math.max(0, parseFloat(e))), r && (e = parseInt(e * t, 10) / 100), Math.abs(e - t) < 1e-6 ? 1 : e % t / parseFloat(t);
}
function St(e) {
  return Math.min(1, Math.max(0, e));
}
function Y(e) {
  return parseInt(e, 16);
}
function Yo(e) {
  return typeof e == "string" && e.indexOf(".") != -1 && parseFloat(e) === 1;
}
function Uo(e) {
  return typeof e == "string" && e.indexOf("%") != -1;
}
function Z(e) {
  return e.length == 1 ? "0" + e : "" + e;
}
function Pe(e) {
  return e <= 1 && (e = e * 100 + "%"), e;
}
function on(e) {
  return Math.round(parseFloat(e) * 255).toString(16);
}
function Fr(e) {
  return Y(e) / 255;
}
var K = (function() {
  var e = "[-\\+]?\\d+%?", t = "[-\\+]?\\d*\\.\\d+%?", r = "(?:" + t + ")|(?:" + e + ")", n = "[\\s|\\(]+(" + r + ")[,|\\s]+(" + r + ")[,|\\s]+(" + r + ")\\s*\\)?", o = "[\\s|\\(]+(" + r + ")[,|\\s]+(" + r + ")[,|\\s]+(" + r + ")[,|\\s]+(" + r + ")\\s*\\)?";
  return {
    CSS_UNIT: new RegExp(r),
    rgb: new RegExp("rgb" + n),
    rgba: new RegExp("rgba" + o),
    hsl: new RegExp("hsl" + n),
    hsla: new RegExp("hsla" + o),
    hsv: new RegExp("hsv" + n),
    hsva: new RegExp("hsva" + o),
    hex3: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
    hex6: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
    hex4: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
    hex8: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/
  };
})();
function ie(e) {
  return !!K.CSS_UNIT.exec(e);
}
function Xo(e) {
  e = e.replace(So, "").replace(Ao, "").toLowerCase();
  var t = !1;
  if (Pt[e])
    e = Pt[e], t = !0;
  else if (e == "transparent")
    return {
      r: 0,
      g: 0,
      b: 0,
      a: 0,
      format: "name"
    };
  var r;
  return (r = K.rgb.exec(e)) ? {
    r: r[1],
    g: r[2],
    b: r[3]
  } : (r = K.rgba.exec(e)) ? {
    r: r[1],
    g: r[2],
    b: r[3],
    a: r[4]
  } : (r = K.hsl.exec(e)) ? {
    h: r[1],
    s: r[2],
    l: r[3]
  } : (r = K.hsla.exec(e)) ? {
    h: r[1],
    s: r[2],
    l: r[3],
    a: r[4]
  } : (r = K.hsv.exec(e)) ? {
    h: r[1],
    s: r[2],
    v: r[3]
  } : (r = K.hsva.exec(e)) ? {
    h: r[1],
    s: r[2],
    v: r[3],
    a: r[4]
  } : (r = K.hex8.exec(e)) ? {
    r: Y(r[1]),
    g: Y(r[2]),
    b: Y(r[3]),
    a: Fr(r[4]),
    format: t ? "name" : "hex8"
  } : (r = K.hex6.exec(e)) ? {
    r: Y(r[1]),
    g: Y(r[2]),
    b: Y(r[3]),
    format: t ? "name" : "hex"
  } : (r = K.hex4.exec(e)) ? {
    r: Y(r[1] + "" + r[1]),
    g: Y(r[2] + "" + r[2]),
    b: Y(r[3] + "" + r[3]),
    a: Fr(r[4] + "" + r[4]),
    format: t ? "name" : "hex8"
  } : (r = K.hex3.exec(e)) ? {
    r: Y(r[1] + "" + r[1]),
    g: Y(r[2] + "" + r[2]),
    b: Y(r[3] + "" + r[3]),
    format: t ? "name" : "hex"
  } : !1;
}
function jo(e) {
  var t, r;
  return e = e || {
    level: "AA",
    size: "small"
  }, t = (e.level || "AA").toUpperCase(), r = (e.size || "small").toLowerCase(), t !== "AA" && t !== "AAA" && (t = "AA"), r !== "small" && r !== "large" && (r = "small"), {
    level: t,
    size: r
  };
}
const Ve = 68, Ge = 0.25, Ye = 2.5, Ue = 'Aptos, Calibri, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', Xe = 11, Wr = 8, an = 0.1, Zt = 2, sn = 1.2, mt = 34, ln = 40, dn = 18, cn = "#f3f3f3", hn = "#5f6368", Ko = "#d7dbe0", un = "#1f2937", fn = "#cbd5e1", Zo = "#374151", $r = "#111827", Dr = "#e5e7eb", Be = "#21a366", qo = "rgba(33, 163, 102, 0.1)", Jo = 1, Qo = "#000000", ei = {
  double: 8,
  solid: 7,
  dashed: 5,
  dotted: 4
}, Ir = `bold 12px ${Ue}`, _t = `${Xe}px ${Ue}`, pn = 32;
let ze;
const Br = /* @__PURE__ */ new Map(), je = (e = 1) => Number.isFinite(e) ? Math.min(Ye, Math.max(Ge, e)) : 1, J = (e, t) => Math.max(1, Math.round(e * je(t))), At = (e, t) => {
  if (!e)
    return e;
  const r = je(t);
  return e.replace(/(\d+(?:\.\d+)?)px/g, (n, o) => `${Number(o) * r}px`);
}, ct = (e, t) => {
  if (e)
    return {
      ...e,
      width: Math.max(0.5, e.width * je(t))
    };
}, pe = (e, t) => {
  if (e)
    return {
      ...e,
      font: At(e.font, t),
      borderTop: ct(e.borderTop, t),
      borderRight: ct(e.borderRight, t),
      borderBottom: ct(e.borderBottom, t),
      borderLeft: ct(e.borderLeft, t)
    };
}, gn = (e) => At(Ir, e) || Ir, ti = (e) => At(_t, e) || _t, ri = (e, t = !1) => ({
  backgroundColor: t ? un : cn,
  color: t ? fn : hn,
  font: gn(e)
}), ni = (e, t = !1) => ({
  backgroundColor: t ? "#18212f" : "#f4f7f9",
  color: t ? "#94a3b8" : "#73808d",
  font: At(`italic ${Xe}px ${Ue}`, e)
}), mn = (e) => e.map((t) => {
  var r;
  return {
    ...t,
    ...!((r = t.children) === null || r === void 0) && r.length ? { children: mn(t.children) } : {}
  };
}), oi = (e) => {
  if (typeof e.font == "string" && e.font.trim())
    return e.font;
  if (!(e.fontFamily !== void 0 || e.fontSize !== void 0 || e.fontWeight !== void 0 || e.fontStyle !== void 0))
    return;
  const r = (() => {
    const { fontWeight: n } = e;
    if (typeof n == "number")
      return n >= 600 ? "bold" : "normal";
    if (typeof n == "string") {
      const o = n.trim();
      return /^\d+$/.test(o) ? Number(o) >= 600 ? "bold" : "normal" : o;
    }
    return "normal";
  })();
  return [
    e.fontStyle || "normal",
    r,
    `${Number.parseInt(e.fontSize, 10) || Xe}px`,
    e.fontFamily || Ue
  ].join(" ");
}, vn = (e) => {
  if (e) {
    if (e.includes("htLeft"))
      return "left";
    if (e.includes("htRight"))
      return "right";
    if (e.includes("htCenter"))
      return "center";
  }
}, bn = (e) => {
  if (e) {
    if (e.includes("htTop"))
      return "top";
    if (e.includes("htBottom"))
      return "bottom";
    if (e.includes("htMiddle"))
      return "middle";
  }
}, zr = (e, t) => !!e?.split(/\s+/).includes(t), ii = (e, t, r) => {
  var n;
  return typeof e == "number" ? e : (n = e?.[t]) !== null && n !== void 0 ? n : r;
}, Ke = (e) => {
  const t = Number(e?.width);
  return Number.isFinite(t) && t > 0 ? t : 0;
}, wn = (e) => !!e && !e.hide && Ke(e) > 0, ai = (e) => {
  var t, r;
  return !((r = (t = e.structure) === null || t === void 0 ? void 0 : t.columns) === null || r === void 0) && r.length ? e.structure.columns : e.columns;
}, si = (e) => {
  var t, r;
  return (r = (t = e.structure) === null || t === void 0 ? void 0 : t.colWidths) !== null && r !== void 0 ? r : e.colWidths;
}, Pr = (e, t, r) => {
  var n;
  return typeof e == "number" ? e : (n = e?.[t]) !== null && n !== void 0 ? n : r;
}, Le = (e, t) => typeof e == "number" && Number.isFinite(e) ? e <= 0 ? an : Math.max(Math.ceil(e), Wr) : Math.max(Math.ceil(t), Wr), li = (e) => {
  if (e == null)
    return !1;
  const t = `${e}`.trim();
  return t ? !/^\d+([./:-]\d+)*$/.test(t) : !1;
}, di = (e) => {
  const t = e.meta, r = e.data || [];
  if (!t || r.length < 2 || (e.merge || []).length)
    return 0;
  const n = r[0] || [], o = r[1] || [], i = n.filter((d) => `${d ?? ""}`.trim() !== ""), l = o.filter((d) => `${d ?? ""}`.trim() !== "");
  return i.length < Math.min(Math.max(Math.floor(t.totalCols / 2), 3), 6) || !i.every(li) || l.length < 2 ? 0 : 1;
}, ci = (e) => {
  var t;
  const r = ai(e), n = si(e), o = [{
    key: tn,
    title: "",
    type: "index",
    fixed: "left",
    width: Ve,
    minWidth: Ve,
    maxWidth: Ve,
    widthFillDisable: !0,
    headerAlign: "center",
    align: "center",
    headerVerticalAlign: "middle",
    verticalAlign: "middle",
    overflowTooltipShow: !1,
    overflowTooltipHeaderShow: !1
  }], i = [];
  for (let l = 0; l < (((t = e.meta) === null || t === void 0 ? void 0 : t.totalCols) || 0); l += 1) {
    const d = Ct(l), c = r?.[l], m = ii(n, l, e.defaults.colWidth), p = !!c?.hidden || m <= 0, u = bn(c?.className) || "middle";
    i.push(d), o.push({
      key: d,
      title: c?.title || `${l + 1}`,
      width: p ? 0 : Math.max(Math.ceil(m), 1),
      hide: p,
      widthFillDisable: !0,
      renderType: "both",
      headerAlign: "center",
      headerVerticalAlign: "middle",
      align: vn(c?.className) || "left",
      verticalAlign: u,
      overflowTooltipShow: !0,
      overflowTooltipHeaderShow: !0
    });
  }
  return { columns: o, dataKeys: i };
}, xn = (e, t) => {
  var r;
  const n = {
    ...e,
    ...!((r = e.children) === null || r === void 0) && r.length ? { children: e.children.map((d) => xn(d, t)) } : {}
  }, o = Number(e.width);
  Number.isFinite(o) && o > 0 && (n.width = J(o, t));
  const i = Number(e.minWidth);
  Number.isFinite(i) && i > 0 && (n.minWidth = J(i, t));
  const l = Number(e.maxWidth);
  return Number.isFinite(l) && l > 0 && (n.maxWidth = J(l, t)), n;
}, Vr = (e, t = 1) => {
  const r = je(t);
  return r === 1 ? mn(e) : e.map((n) => xn(n, r));
}, hi = (e) => {
  if (typeof e == "number" && Number.isFinite(e))
    return Math.max(e, 0);
  if (typeof e == "string") {
    const t = Number.parseFloat(e);
    return Number.isFinite(t) ? Math.max(t, 0) : 0;
  }
  return 0;
}, ui = (e) => {
  if (typeof e != "string")
    return "solid";
  const t = e.trim();
  switch (t) {
    case "double":
    case "dashed":
    case "dotted":
    case "solid":
      return t;
    default:
      return "solid";
  }
}, ht = (e, t) => {
  const r = hi(e[`border${t}Width`]);
  if (r)
    return {
      width: r,
      style: ui(e[`border${t}Style`]),
      color: e[`border${t}Color`] || Qo
    };
}, Vt = (e) => e ? !!(e.borderTop || e.borderRight || e.borderBottom || e.borderLeft) : !1, _n = (e) => e ? !!(e.horizontalAlign || e.verticalAlign || e.wrapText || e.shrinkToFit) : !1, Gr = (e, t) => _n(e) ? !!(e?.wrapText || e?.shrinkToFit || e?.horizontalAlign && e.horizontalAlign !== (t?.align || "left") || e?.verticalAlign && e.verticalAlign !== (t?.verticalAlign || "middle")) : !1, fi = (e) => {
  switch (e) {
    case "center":
      return "center";
    case "right":
      return "flex-end";
    default:
      return "flex-start";
  }
}, pi = (e) => {
  switch (e) {
    case "top":
      return "flex-start";
    case "bottom":
      return "flex-end";
    default:
      return "center";
  }
}, gi = (e, t, r, n) => {
  switch (e) {
    case "right":
      return t - r;
    case "center":
      return -Math.min(n, Math.max((r - t) / 2, 0));
    default:
      return 0;
  }
}, Dt = (e) => typeof e._height == "number" && e._height <= an, Gt = (e, t) => {
  const r = e?.key;
  if (typeof r == "string" && r.startsWith("c")) {
    const n = Number(r.slice(1));
    if (Number.isInteger(n) && n >= 0)
      return n;
  }
  return Math.max(t - 1, 0);
}, ut = (e, t, r) => ae(e, Gt(r, t) + 1), qt = (e, t) => ae(e, t + 1), Jt = (e) => e == null ? "" : `${e}`, Et = (e) => Jt(e).trim() !== "", mi = (e) => /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(e.trim()), vi = (e, t, r, n) => {
  const o = `${t}
${r}
${e}`, i = Br.get(o);
  if (i !== void 0)
    return i;
  !ze && n && (ze = n.createElement("canvas"));
  const l = ze?.getContext("2d");
  if (!l)
    return e.length * Xe;
  l.font = t;
  const d = l.measureText(e).width + r * 2;
  return Br.set(o, d), d;
}, Yt = (e, t, r, n) => {
  const o = e.columns[n + 1];
  if (!wn(o))
    return !1;
  const i = qt(r, n);
  return e.mergeStartMap.has(i) || e.mergeCoveredMap.has(i) ? !1 : !Et(t[Ct(n)]);
}, Yr = (e, t, r, n, o) => {
  let i = 0;
  for (let l = 1; l <= pn; l += 1) {
    const d = n + l * o;
    if (d < 0 || d >= e.totalCols || !Yt(e, t, r, d))
      break;
    i += Ke(e.columns[d + 1]);
  }
  return i;
}, Ut = (e, t, r, n, o, i, l, d, c) => {
  const m = Jt(l);
  if (!m || i?.wrapText || i?.shrinkToFit || mi(m))
    return;
  const p = qt(r, n);
  if (e.mergeStartMap.has(p) || e.mergeCoveredMap.has(p))
    return;
  const u = Ke(o);
  if (!u)
    return;
  const b = i?.font || _t, _ = Math.ceil(vi(m, b, J(Zt, d), c));
  if (_ <= u)
    return;
  const A = i?.horizontalAlign || o?.align || "left", x = A === "right" || A === "center" ? Yr(e, t, r, n, -1) : 0, W = A !== "right" ? Yr(e, t, r, n, 1) : 0, P = u + x + W;
  if (P <= u)
    return;
  const L = Math.min(_, P);
  return {
    left: gi(A, u, L, x),
    width: L
  };
}, bi = (e, t, r) => {
  let n = 0;
  for (let o = t; o < r; o += 1)
    n += Ke(e.columns[o + 1]);
  return n;
}, Ur = (e, t, r, n, o, i) => {
  if (!Yt(e, t, r, n))
    return;
  const l = e.columns[n + 1], d = Ke(l);
  if (d)
    for (let c = 1; c <= pn; c += 1) {
      const m = n - c;
      if (m < 0)
        break;
      const p = e.columns[m + 1];
      if (!wn(p))
        break;
      const u = t[Ct(m)];
      if (!Et(u)) {
        if (!Yt(e, t, r, m))
          break;
        continue;
      }
      const b = qt(r, m), _ = e.cellCache.get(b), A = {
        ...pe(_, o) || {},
        horizontalAlign: _?.horizontalAlign || p?.align,
        verticalAlign: _?.verticalAlign || p?.verticalAlign
      }, x = Ut(e, t, r, m, p, A, u, o, i);
      if (!x)
        return;
      const W = bi(e, m, n), P = x.left, L = x.left + x.width, k = W, N = W + d;
      return P < N && L > k ? {
        value: u,
        style: A,
        overflowLayout: {
          left: x.left - W,
          width: x.width
        }
      } : void 0;
    }
}, fe = (e) => e ? e.width * 100 + (ei[e.style] || 1) : 0, wi = (e, t, r, n, o) => {
  const i = pe(e.cellCache.get(ae(t - 1, r + 1)), o), l = pe(e.cellCache.get(ae(t + 1, r + 1)), o), d = pe(e.cellCache.get(ae(t, r)), o), c = pe(e.cellCache.get(ae(t, r + 2)), o), m = fe(n.borderTop) >= fe(i?.borderBottom) ? n.borderTop : void 0, p = fe(n.borderBottom) > fe(l?.borderTop) ? n.borderBottom : void 0, u = fe(n.borderLeft) >= fe(d?.borderRight) ? n.borderLeft : void 0, b = fe(n.borderRight) > fe(c?.borderLeft) ? n.borderRight : void 0;
  return {
    ...n,
    borderTop: m,
    borderRight: b,
    borderBottom: p,
    borderLeft: u
  };
}, ft = (e, t, r) => {
  const n = e.createElement("span"), o = r.width / 2;
  return Object.assign(n.style, {
    position: "absolute",
    pointerEvents: "none",
    boxSizing: "border-box"
  }), t === "top" || t === "bottom" ? (Object.assign(n.style, {
    left: `${-o}px`,
    width: `calc(100% + ${r.width}px)`,
    height: "0"
  }), n.style[t] = `${-o}px`, n.style.borderTop = `${r.width}px ${r.style} ${r.color}`) : (Object.assign(n.style, {
    top: `${-o}px`,
    height: `calc(100% + ${r.width}px)`,
    width: "0"
  }), n.style[t] = `${-o}px`, n.style.borderLeft = `${r.width}px ${r.style} ${r.color}`), n;
}, xi = (e, t, r, n) => {
  const o = e.createElement("span");
  return o.textContent = Jt(t), Object.assign(o.style, {
    position: "relative",
    zIndex: "1",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    alignItems: pi(r.verticalAlign),
    justifyContent: fi(r.horizontalAlign),
    padding: `0 ${n}px`,
    overflow: "hidden",
    textOverflow: r.wrapText ? "clip" : "ellipsis",
    whiteSpace: r.wrapText ? "pre-wrap" : "nowrap",
    wordBreak: r.wrapText ? "break-word" : "normal",
    lineHeight: `${sn}`,
    textAlign: r.horizontalAlign || "left",
    color: r.color || "inherit",
    font: r.font || _t,
    transform: r.shrinkToFit ? "scale(0.92)" : "none",
    transformOrigin: `${r.horizontalAlign || "left"} center`
  }), o;
}, _i = (e, t) => {
  t && Object.assign(e.style, {
    position: "absolute",
    left: `${t.left}px`,
    top: "0",
    width: `${t.width}px`,
    overflow: "hidden",
    textOverflow: "clip"
  });
}, Ei = (e, t, r, n, o, i, l) => {
  const d = e.ownerDocument;
  e.replaceChildren(), Object.assign(e.style, {
    pointerEvents: "none",
    overflow: i ? "hidden" : "visible",
    background: "transparent"
  });
  const c = d.createDocumentFragment();
  if (o) {
    const m = xi(d, n, r, J(Zt, l));
    _i(m, i), c.appendChild(m);
  }
  t.borderTop && c.appendChild(ft(d, "top", t.borderTop)), t.borderRight && c.appendChild(ft(d, "right", t.borderRight)), t.borderBottom && c.appendChild(ft(d, "bottom", t.borderBottom)), t.borderLeft && c.appendChild(ft(d, "left", t.borderLeft)), e.appendChild(c);
}, yi = (e) => {
  if (!e)
    return;
  const t = e.style || {}, r = {};
  t.backgroundColor && (r.backgroundColor = t.backgroundColor), t.color ? r.color = t.color : t.backgroundColor && v(t.backgroundColor).isDark() && (r.color = "#ffffff");
  const n = oi(t);
  n ? r.font = n : t.backgroundColor && v(t.backgroundColor).isDark() && (r.font = `bold ${Xe}px ${Ue}`);
  const o = ht(t, "Top");
  o && (r.borderTop = o);
  const i = ht(t, "Right");
  i && (r.borderRight = i);
  const l = ht(t, "Bottom");
  l && (r.borderBottom = l);
  const d = ht(t, "Left");
  d && (r.borderLeft = d);
  const c = vn(e.className);
  c && (r.horizontalAlign = c);
  const m = bn(e.className);
  if (m && (r.verticalAlign = m), zr(e.className, "htWrap") && (r.wrapText = !0), zr(e.className, "htShrink") && (r.shrinkToFit = !0), !(!r.backgroundColor && !r.color && !r.font && !Vt(r) && !_n(r)))
    return r;
}, It = ({ hostHeight: e, darkMode: t = !1, resizableColumns: r = !1, resizableRows: n = !1, copySelection: o, sheetDefaults: i, virtualState: l, zoomScale: d = 1 }) => {
  const c = je(d), m = J(Zt, c), p = J(mt, c), u = J(Le(i.rowHeight, i.rowHeight), c), b = J(i.colWidth, c), _ = ri(c, t), A = ni(c, t), x = ({ rowIndex: k, colIndex: N, column: $ }) => {
    if (N === 0)
      return;
    const S = ut(k, N, $);
    if (l.mergeCoveredMap.has(S))
      return { rowspan: 0, colspan: 0 };
    const R = l.mergeStartMap.get(S);
    if (R)
      return {
        rowspan: R.rowspan,
        colspan: R.colspan
      };
  }, W = () => _, P = ({ row: k, rowIndex: N, colIndex: $, column: S }) => {
    if ($ === 0)
      return _;
    const R = k;
    if (!Dt(R))
      return $t(R) !== ge.Loaded ? A : pe(l.cellCache.get(ut(N, $, S)), c);
  }, L = ({ row: k, rowIndex: N, colIndex: $, column: S, value: R }) => {
    const X = k;
    if ($ === 0 || Dt(X) || $t(X) !== ge.Loaded)
      return;
    const ee = ut(N, $, S);
    if (l.mergeCoveredMap.has(ee))
      return;
    const F = pe(l.cellCache.get(ee), c), q = Gt(S, $), se = typeof document > "u" ? void 0 : document, me = Ut(l, X, N, q, S, F, R, c, se), I = Et(R) ? void 0 : Ur(l, X, N, q, c, se), ve = Gr(F, S) || !!me || !!I;
    if (!(!Vt(F) && !ve))
      return ((_e) => {
        const le = {
          ...F || {},
          horizontalAlign: F?.horizontalAlign || S?.align,
          verticalAlign: F?.verticalAlign || S?.verticalAlign
        }, He = Vt(F) ? wi(l, N, q, le, c) : le;
        Ei(_e, He, I?.style || He, I ? I.value : R, ve, I?.overflowLayout || me, c);
      });
  };
  return {
    ROW_KEY: rn,
    DISABLED: !0,
    HEIGHT: Math.max(e, 240),
    MAX_HEIGHT: Math.max(e, 240),
    HEADER_HEIGHT: p,
    CELL_HEIGHT: u,
    CELL_WIDTH: b,
    CELL_PADDING: m,
    CELL_LINE_HEIGHT: sn,
    COLUMNS_VERTICAL_ALIGN: "middle",
    HEADER_FONT: gn(c),
    BODY_FONT: ti(c),
    BORDER_RADIUS: 0,
    BORDER_COLOR: t ? Zo : Ko,
    HEADER_BG_COLOR: t ? un : cn,
    BODY_BG_COLOR: t ? $r : "#ffffff",
    HEADER_TEXT_COLOR: t ? fn : hn,
    BODY_TEXT_COLOR: t ? Dr : "#202124",
    READONLY_COLOR: t ? $r : "#ffffff",
    READONLY_TEXT_COLOR: t ? Dr : "#202124",
    EDIT_BG_COLOR: t ? "#18212f" : "#ffffff",
    PLACEHOLDER_COLOR: t ? "#94a3b8" : "#8a94a3",
    SCROLLER_COLOR: t ? "#475569" : "#c1c7d0",
    SCROLLER_FOCUS_COLOR: t ? "#64748b" : "#9aa0a6",
    SELECT_ROW_COL_BG_COLOR: qo,
    SELECT_AREA_COLOR: "rgba(33, 163, 102, 0.14)",
    SELECT_BORDER_COLOR: Be,
    AUTOFILL_POINT_BORDER_COLOR: Be,
    ENABLE_SELECTOR: !0,
    ENABLE_SELECTOR_SINGLE: !1,
    ENABLE_SELECTOR_SPAN_COL: !0,
    ENABLE_SELECTOR_SPAN_ROW: !0,
    ENABLE_SELECTOR_ALL_ROWS: !0,
    ENABLE_SELECTOR_ALL_COLS: !0,
    SELECTOR_AREA_MIN_X: Jo,
    ENABLE_CONTEXT_MENU: !1,
    ENABLE_HEADER_CONTEXT_MENU: !1,
    ENABLE_AUTOFILL: !0,
    ENABLE_AUTOFILL_SPAN_COL: !0,
    ENABLE_AUTOFILL_SPAN_ROW: !0,
    ENABLE_PASTER: !1,
    ENABLE_HISTORY: !1,
    ENABLE_RESIZE_COLUMN: r,
    ENABLE_RESIZE_COLUMN_TEXT: r,
    RESIZE_COLUMN_LINE_COLOR: Be,
    RESIZE_COLUMN_TEXT_BG_COLOR: Be,
    RESIZE_COLUMN_MIN_WIDTH: ln,
    ENABLE_RESIZE_ROW: n,
    RESIZE_ROW_LINE_COLOR: Be,
    RESIZE_ROW_MIN_HEIGHT: J(dn, c),
    ENABLE_KEYBOARD: !0,
    ENABLE_COPY: !0,
    BEFORE_COPY_METHOD: o ? (k) => {
      o(k);
    } : void 0,
    // 预览态只开放“拖动扩选”的交互，不允许真正写回单元格内容。
    BEFORE_AUTOFILL_DATA_METHOD: () => [],
    SPAN_METHOD: x,
    HEADER_CELL_STYLE_METHOD: W,
    BODY_CELL_STYLE_METHOD: P,
    BODY_CELL_RENDER_METHOD: L,
    BODY_CELL_FORMATTER_METHOD: ({ row: k, rowIndex: N, colIndex: $, column: S, value: R }) => {
      if (Dt(k))
        return "";
      if ($ === 0) {
        const I = N + 1 - l.indexOffset;
        return I > 0 ? `${I}` : "";
      }
      if ($t(k) !== ge.Loaded)
        return "";
      const X = k, ee = pe(l.cellCache.get(ut(N, $, S)), c), F = Gt(S, $), q = typeof document > "u" ? void 0 : document, se = Ut(l, X, N, F, S, ee, R, c, q), me = Et(R) ? void 0 : Ur(l, X, N, F, c, q);
      return Gr(ee, S) || se || me || R == null ? "" : `${R}`;
    }
  };
}, Xr = 18, Ci = 1 * 1024 * 1024, Si = [
  ".e-virt-table-container",
  ".e-virt-table-overlayer",
  ".e-virt-table-editor",
  ".e-virt-table-context-menu"
], Re = ".excel-wrapper[data-file-viewer-spreadsheet-root]", jr = "file-viewer-e-virt-table-rotate", Ai = `
.excel-wrapper{position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:var(--file-viewer-render-surface-background,#fff);color:#172033;font-family:Aptos,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
.excel-wrapper *{box-sizing:border-box}
.excel-wrapper .table-wrapper{position:relative;width:100%;flex:1;min-height:0;background:#fff;overflow:hidden}
.excel-wrapper .table-host{position:absolute;inset:0}
.excel-wrapper .table-target{width:100%;height:100%}
.excel-wrapper .table-host .e-virt-table-container,.excel-wrapper .table-host .e-virt-table-stage{width:100%!important}
.excel-wrapper .table-host .e-virt-table-container{height:100%!important}
.excel-wrapper .table-host .e-virt-table-stage{overflow:hidden}
.excel-wrapper .sheet-loading{position:absolute;right:18px;bottom:18px;z-index:20;display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:14px;background:rgba(33,163,102,.1);border:1px solid rgba(33,163,102,.2);box-shadow:0 8px 20px rgba(33,163,102,.12);color:#1a7f50;font-size:12px;font-weight:700;pointer-events:none}
.excel-wrapper .sheet-loading-dot{width:8px;height:8px;flex-shrink:0;border-radius:999px;background:#21a366;box-shadow:0 0 0 6px rgba(33,163,102,.12);animation:file-viewer-spreadsheet-loading-pulse 1.2s ease-in-out infinite}
.excel-wrapper .sheet-loading-summary{color:#5f6368}
.excel-wrapper .excel-image-viewport{position:absolute;z-index:35;overflow:hidden;pointer-events:none}
.excel-wrapper .excel-image-layer{position:absolute;inset:0 auto auto 0;width:0;height:0;transform-origin:0 0;will-change:transform}
.excel-wrapper .excel-image{position:absolute;display:block;max-width:none;height:auto;object-fit:contain;user-select:none}
.excel-wrapper .excel-chart{position:absolute;display:block;max-width:none;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.08);user-select:none}
.excel-wrapper .excel-chart svg{display:block;width:100%;height:100%;overflow:visible}
.excel-wrapper .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.96);z-index:999;backdrop-filter:blur(6px)}
.excel-wrapper .loading-card{width:min(100%,460px);display:flex;align-items:center;gap:18px;padding:22px;border-radius:24px;background:rgba(255,255,255,.92);border:1px solid rgba(33,163,102,.1);box-shadow:0 22px 48px rgba(18,36,27,.12)}
.excel-wrapper .loading-brand{flex-shrink:0;width:78px;height:78px;display:flex;align-items:center;justify-content:center;border-radius:22px;background:linear-gradient(135deg,rgba(33,163,102,.14),rgba(33,163,102,.04));color:#1a7f50;font-size:18px;font-weight:900;letter-spacing:0}
.excel-wrapper .loading-copy{min-width:0;flex:1}
.excel-wrapper .loading-kicker{display:block;color:#21a366;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.excel-wrapper .loading-copy strong{display:block;margin-top:6px;color:#183828;font-size:20px;line-height:1.3}
.excel-wrapper .loading-copy p{margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.5}
.excel-wrapper .loading-spinner{width:28px;height:28px;border-radius:999px;border:3px solid rgba(33,163,102,.16);border-top-color:#21a366;animation:file-viewer-spreadsheet-loading-spin .8s linear infinite}
.excel-wrapper .error{position:absolute;left:50%;top:50%;z-index:1000;transform:translate(-50%,-50%);max-width:min(520px,calc(100% - 48px));padding:16px 18px;border-radius:16px;background:#fff7ed;color:#9a3412;border:1px solid rgba(234,88,12,.18);box-shadow:0 18px 42px rgba(154,52,18,.12);font-size:14px;line-height:1.6}
.excel-wrapper .toolbar{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid #e5e7eb;background:#f8fafc}
.excel-wrapper .btn-group{min-width:0;max-width:100%;flex:1 1 auto;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable;scrollbar-width:thin;overscroll-behavior-x:contain}
.excel-wrapper .sheet-tab{flex:0 0 auto;width:max-content;min-width:72px;max-width:min(260px,70vw);height:30px;border:1px solid transparent;border-radius:8px;padding:0 12px;background:transparent;color:#526173;font:inherit;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.excel-wrapper .sheet-tab:hover{background:#edf2f7}
.excel-wrapper .sheet-tab.active{border-color:rgba(33,163,102,.28);background:rgba(33,163,102,.12);color:#137347}
.excel-wrapper .summary{flex:0 0 auto;max-width:42%;overflow:hidden;color:#64748b;font-size:12px;font-weight:700;white-space:nowrap;text-overflow:ellipsis}
.excel-wrapper .hidden{display:none!important}
.excel-wrapper[data-spreadsheet-theme='dark']{color-scheme:dark;background:var(--file-viewer-render-surface-background,#0f172a);color:#e5e7eb}
.excel-wrapper[data-spreadsheet-theme='dark'] .table-wrapper{background:#111827}
.excel-wrapper[data-spreadsheet-theme='dark'] .toolbar{background:#111827;border-color:rgba(148,163,184,.22)}
.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-tab{color:#cbd5e1}
.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-tab:hover{background:#1f2937}
.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-tab.active{border-color:rgba(52,211,153,.38);background:rgba(33,163,102,.2);color:#6ee7b7}
.excel-wrapper[data-spreadsheet-theme='dark'] .summary,.excel-wrapper[data-spreadsheet-theme='dark'] .sheet-loading-summary{color:#94a3b8}
.excel-wrapper[data-spreadsheet-theme='dark'] .loading{background:rgba(2,6,23,.9)}
.excel-wrapper[data-spreadsheet-theme='dark'] .loading-card{border-color:rgba(52,211,153,.2);background:rgba(17,24,39,.96);box-shadow:0 24px 58px rgba(0,0,0,.42)}
.excel-wrapper[data-spreadsheet-theme='dark'] .loading-copy strong{color:#f0fdf4}
.excel-wrapper[data-spreadsheet-theme='dark'] .loading-copy p{color:#94a3b8}
.excel-wrapper[data-spreadsheet-theme='dark'] .error{border-color:rgba(251,146,60,.28);background:#2a1710;color:#fdba74;box-shadow:0 20px 48px rgba(0,0,0,.36)}
@keyframes file-viewer-spreadsheet-loading-spin{to{transform:rotate(360deg)}}
@keyframes file-viewer-spreadsheet-loading-pulse{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1)}}
@media (max-width:720px){.excel-wrapper .toolbar{align-items:stretch;flex-direction:column}.excel-wrapper .btn-group{flex:0 0 auto}.excel-wrapper .summary{max-width:none;white-space:normal}.excel-wrapper .sheet-loading{left:12px;right:12px;bottom:58px;justify-content:center}.excel-wrapper .loading-card{margin:18px;flex-direction:column;text-align:center}}
`, Mi = Ai.replace(/\.excel-wrapper/g, Re), Ti = (e) => typeof e == "function", Bt = (e) => e && typeof e == "object" ? e : null, Li = () => {
  const e = typeof globalThis > "u" ? null : globalThis;
  return e?.EVirtTable;
}, En = (e) => {
  const t = Bt(e), r = Bt(t?.default), n = Bt(t?.["module.exports"]), o = Li(), l = [
    e,
    t?.default,
    t?.EVirtTable,
    t?.["module.exports"],
    r?.default,
    r?.EVirtTable,
    n?.default,
    n?.EVirtTable,
    o
  ].find(Ti);
  if (!l) {
    const d = t ? Object.keys(t).join(", ") : typeof e;
    throw new Error(`Unable to resolve e-virt-table constructor from module exports: ${d}`);
  }
  return l;
}, yn = (e) => Si.every((t) => e.includes(t)), Cn = (e) => [
  e,
  typeof document > "u" ? null : document
].filter((t, r, n) => !!t && n.indexOf(t) === r), Xt = (e) => e.flatMap((t) => {
  var r;
  return Array.from(((r = t.head) === null || r === void 0 ? void 0 : r.querySelectorAll("style")) || []);
});
let Kr = "";
const Sn = (e) => {
  var t;
  const r = Xt(Cn(e));
  for (let n = r.length - 1; n >= 0; n -= 1) {
    const o = ((t = r[n]) === null || t === void 0 ? void 0 : t.textContent) || "";
    if (yn(o))
      return o;
  }
  return "";
}, Ri = async (e) => {
  const t = Cn(e), r = new Set(Xt(t)), n = await import("./index.es-B_r5Jj76.js"), o = Xt(t).filter((l) => !r.has(l) && yn(l.textContent || "")), i = o[o.length - 1];
  return i && (Kr = i.textContent || ""), o.forEach((l) => l.remove()), {
    constructor: En(n),
    // The vendor entry injects CSS while its dynamic import is evaluated.
    // Prefer that newly-created node so an app's independently loaded table
    // version cannot be mistaken for the renderer-owned dependency.
    styleText: Kr || Sn(e)
  };
}, An = (e, t) => {
  const r = t ? `:host,${Re}` : Re, n = t ? `:host(.dark),${Re}[data-spreadsheet-theme='dark']` : `${Re}[data-spreadsheet-theme='dark']`, o = (i) => {
    const l = i.trim();
    return l === ":root" ? r : l === ".dark" ? n : `${Re} ${l}`;
  };
  return e.replace(/@keyframes\s+rotate\b/g, `@keyframes ${jr}`).replace(/animation:\s*rotate\b/g, `animation:${jr}`).replace(/(^|})\s*(:root|\.dark|\.e-virt-table-[^{}]+)\{/g, (i, l, d) => {
    const c = d.split(",").map(o).join(",");
    return `${l}${c}{`;
  });
}, ke = (e) => e.ownerDocument.defaultView, ki = (e) => uo(e.ownerDocument), Mn = (e, t) => {
  if (e) {
    if (typeof e == "function") {
      e(t);
      return;
    }
    e.handleEvent(t);
  }
};
class Oi {
  constructor(t) {
    this.onmessage = null, this.onerror = null, this.destroyed = !1, this.listeners = /* @__PURE__ */ new Map(), this.parserPromise = null, this.context = null, this.targetWindow = t;
  }
  addEventListener(t, r) {
    var n;
    this.listeners.has(t) || this.listeners.set(t, /* @__PURE__ */ new Set()), (n = this.listeners.get(t)) === null || n === void 0 || n.add(r);
  }
  removeEventListener(t, r) {
    var n;
    (n = this.listeners.get(t)) === null || n === void 0 || n.delete(r);
  }
  terminate() {
    this.destroyed = !0, this.listeners.clear();
  }
  postMessage(t) {
    this.handleMessage(t);
  }
  async loadParser() {
    this.parserPromise || (this.parserPromise = import("./parser-CTMfgU57.js"));
    const t = await this.parserPromise;
    return this.context || (this.context = t.createSpreadsheetParserContext()), t;
  }
  dispatch(t, r) {
    var n;
    (n = this.listeners.get(t)) === null || n === void 0 || n.forEach((o) => Mn(o, r));
  }
  dispatchMessage(t) {
    var r;
    const n = this.targetWindow, o = n?.MessageEvent || (typeof MessageEvent < "u" ? MessageEvent : void 0), i = o ? new o("message", { data: t }) : { type: "message", data: t };
    (r = this.onmessage) === null || r === void 0 || r.call(this, i), this.dispatch("message", i);
  }
  dispatchError(t) {
    var r;
    const n = t instanceof Error ? t.message : String(t), o = this.targetWindow, i = o?.ErrorEvent || (typeof ErrorEvent < "u" ? ErrorEvent : void 0), l = i ? new i("error", { message: n, error: t }) : { type: "error", message: n, error: t };
    (r = this.onerror) === null || r === void 0 || r.call(this, l), this.dispatch("error", l);
  }
  async handleMessage(t) {
    if (!this.destroyed)
      try {
        const r = await this.loadParser();
        (await r.handleSpreadsheetWorkerRequest(this.context || r.createSpreadsheetParserContext(), t)).forEach((o) => {
          this.destroyed || this.dispatchMessage(o);
        });
      } catch (r) {
        this.destroyed || this.dispatchError(r);
      }
  }
}
class Hi {
  constructor(t, r) {
    this.createFallback = r, this.onmessage = null, this.onerror = null, this.destroyed = !1, this.usingFallback = !1, this.hasPrimaryMessage = !1, this.pendingMessages = [], this.listeners = /* @__PURE__ */ new Map(), this.handleMessage = (n) => {
      var o;
      this.destroyed || (this.usingFallback || (this.hasPrimaryMessage = !0, this.pendingMessages.length = 0), (o = this.onmessage) === null || o === void 0 || o.call(this, n), this.dispatch("message", n));
    }, this.handleError = (n) => {
      var o;
      if (!this.destroyed) {
        if (!this.usingFallback && !this.hasPrimaryMessage) {
          this.switchToFallback(n);
          return;
        }
        (o = this.onerror) === null || o === void 0 || o.call(this, n), this.dispatch("error", n);
      }
    }, this.active = t, this.attach(t);
  }
  addEventListener(t, r) {
    var n;
    this.listeners.has(t) || this.listeners.set(t, /* @__PURE__ */ new Set()), (n = this.listeners.get(t)) === null || n === void 0 || n.add(r);
  }
  removeEventListener(t, r) {
    var n;
    (n = this.listeners.get(t)) === null || n === void 0 || n.delete(r);
  }
  terminate() {
    this.destroyed = !0, this.detach(this.active), this.active.terminate(), this.pendingMessages.length = 0, this.listeners.clear();
  }
  postMessage(t) {
    this.destroyed || (!this.usingFallback && !this.hasPrimaryMessage && this.pendingMessages.push(t), this.active.postMessage(t));
  }
  attach(t) {
    t.addEventListener("message", this.handleMessage), t.addEventListener("error", this.handleError);
  }
  detach(t) {
    t.removeEventListener("message", this.handleMessage), t.removeEventListener("error", this.handleError);
  }
  dispatch(t, r) {
    var n;
    (n = this.listeners.get(t)) === null || n === void 0 || n.forEach((o) => Mn(o, r));
  }
  switchToFallback(t) {
    var r;
    const n = this.pendingMessages.splice(0);
    this.detach(this.active), this.active.terminate(), this.usingFallback = !0, this.hasPrimaryMessage = !1;
    try {
      this.active = this.createFallback(), this.attach(this.active), console.warn("[file-viewer] Spreadsheet Worker 自动模式启动失败，已回退到主线程解析。", t.message || t.type), n.forEach((o) => this.active.postMessage(o));
    } catch (o) {
      const i = typeof window < "u" ? window : void 0, l = i?.ErrorEvent || (typeof ErrorEvent < "u" ? ErrorEvent : void 0), d = o instanceof Error ? o.message : String(o), c = l ? new l("error", { message: d, error: o }) : { type: "error", message: d, error: o };
      (r = this.onerror) === null || r === void 0 || r.call(this, c), this.dispatch("error", c);
    }
  }
}
const vt = (e) => new Oi(ke(e)), Tn = (e) => {
  var t, r, n;
  return (n = (r = (t = e?.options) === null || t === void 0 ? void 0 : t.spreadsheet) === null || r === void 0 ? void 0 : r.worker) !== null && n !== void 0 ? n : "auto";
}, Ni = (e, t) => {
  var r;
  const n = (r = t?.options) === null || r === void 0 ? void 0 : r.spreadsheet, o = Tn(t);
  if (o === !0)
    return !0;
  if (o === !1)
    return !1;
  const i = typeof n?.workerAutoThreshold == "number" && Number.isFinite(n.workerAutoThreshold) && n.workerAutoThreshold >= 0 ? n.workerAutoThreshold : Ci;
  return e >= i;
}, Zr = (e, t, r) => Tn(r) !== "auto" ? e : new Hi(e, () => vt(t)), Fi = (e, t, r) => () => {
  var n;
  if (!Ni(t, r))
    return vt(e);
  const o = ke(e), i = o?.Worker || (typeof Worker < "u" ? Worker : void 0);
  if (!i)
    return vt(e);
  const l = co((n = r?.options) === null || n === void 0 ? void 0 : n.spreadsheet, ki(e));
  try {
    return Zr(new i(l, { type: "module" }), e, r);
  } catch (d) {
    try {
      return Zr(new i(l), e, r);
    } catch (c) {
      return console.warn("[file-viewer] Spreadsheet Worker 无法创建，已回退到主线程解析。", c || d), vt(e);
    }
  }
}, Ln = (e, t = Mi) => {
  const r = e.createElement("style");
  return r.textContent = t, r;
}, Wi = (e, t, r) => {
  var n;
  if (!r)
    throw new Error("Unable to resolve the e-virt-table stylesheet for the spreadsheet render surface.");
  const o = t.getRootNode(), i = (n = t.ownerDocument.defaultView) === null || n === void 0 ? void 0 : n.ShadowRoot, l = !!i && o instanceof i, d = Ln(e, An(r, l));
  return d.dataset.fileViewerVendorStyle = "e-virt-table", d;
}, pt = (e, t) => {
  e.classList.toggle("hidden", t);
}, qr = (e) => Math.min(Ye, Math.max(Ge, Number(e.toFixed(2)))), zt = (e) => {
  if (e == null)
    return "";
  const t = `${e}`;
  return /[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}, $i = (e) => Array.isArray(e) ? e.map((t) => Array.isArray(t) ? t.map(zt).join("	") : zt(t)).join(`
`) : zt(e), Jr = (e, t) => {
  var r;
  const n = e.body;
  if (!n || typeof e.execCommand != "function")
    return !1;
  const o = e.activeElement, i = e.createElement("textarea");
  i.value = t, i.setAttribute("readonly", "true"), i.setAttribute("aria-hidden", "true"), Object.assign(i.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none"
  }), n.appendChild(i), i.focus({ preventScroll: !0 }), i.select(), i.setSelectionRange(0, i.value.length);
  let l = !1;
  try {
    l = e.execCommand("copy");
  } finally {
    i.remove(), (r = o?.focus) === null || r === void 0 || r.call(o, { preventScroll: !0 });
  }
  return l;
}, Di = async (e, t) => {
  var r;
  const n = e.defaultView, o = (r = n?.navigator) === null || r === void 0 ? void 0 : r.clipboard;
  if (!!n?.isSecureContext && typeof o?.writeText == "function")
    try {
      return await o.writeText(t), !0;
    } catch {
      return Jr(e, t);
    }
  return Jr(e, t);
}, Ii = async (e, t, r, n) => {
  var o, i, l, d, c, m, p, u, b, _, A;
  const x = t.ownerDocument, W = await Ri(x), P = W.constructor, L = io(n?.options), k = ho(), N = (l = (i = (o = x.defaultView) === null || o === void 0 ? void 0 : o.matchMedia) === null || i === void 0 ? void 0 : i.call(o, "(prefers-color-scheme: dark)").matches) !== null && l !== void 0 ? l : !1, $ = ao((d = n?.options) === null || d === void 0 ? void 0 : d.theme, N) === "dark", S = x.createElement("div");
  S.className = "excel-wrapper", S.dataset.fileViewerSpreadsheetRoot = "true", S.dataset.spreadsheetTheme = $ ? "dark" : "light", S.dataset.viewerZoomProvider = "xlsx";
  const R = x.createElement("div");
  R.className = "loading";
  const X = x.createElement("div");
  X.className = "loading-card";
  const ee = x.createElement("div");
  ee.className = "loading-brand", ee.textContent = "XLSX";
  const F = x.createElement("div");
  F.className = "loading-copy";
  const q = x.createElement("span");
  q.className = "loading-kicker", q.textContent = L("spreadsheet.loading.kicker");
  const se = x.createElement("strong");
  se.dataset.loadingTitle = "true", se.textContent = L("spreadsheet.loading.title");
  const me = x.createElement("p");
  me.textContent = L("spreadsheet.loading.hint"), F.append(q, se, me);
  const I = x.createElement("span");
  I.className = "loading-spinner", X.append(ee, F, I), R.appendChild(X);
  const ve = x.createElement("div");
  ve.className = "error hidden";
  const _e = x.createElement("div");
  _e.className = "table-wrapper";
  const le = x.createElement("div");
  le.className = "sheet-loading hidden";
  const He = x.createElement("span");
  He.className = "sheet-loading-dot";
  const Qt = x.createElement("span");
  Qt.textContent = L("spreadsheet.loading.streaming");
  const er = x.createElement("span");
  er.className = "sheet-loading-summary", le.append(He, Qt, er);
  const Mt = x.createElement("div");
  Mt.className = "table-host";
  const V = x.createElement("div");
  V.className = "table-target";
  const Ne = x.createElement("div");
  Ne.className = "excel-image-viewport hidden";
  const Ze = x.createElement("div");
  Ze.className = "excel-image-layer", Ne.appendChild(Ze), Mt.append(V, Ne), _e.append(le, Mt);
  const Tt = x.createElement("div");
  Tt.className = "toolbar";
  const Fe = x.createElement("div");
  Fe.className = "btn-group", Fe.setAttribute("aria-label", L("spreadsheet.tabs.ariaLabel"));
  const Lt = x.createElement("div");
  Lt.className = "summary", Tt.append(Fe, Lt), S.append(R, ve, _e, Tt), t.replaceChildren(Wi(x, t, W.styleText), Ln(x), S);
  let Ee = [], te = 0, U = "", be = 0, qe = 0, de = { ...gt }, ce = !0, he = !1, tr = 0, rr = 0, Je = [], Qe = [], O = 1, re = {
    scrollX: 0,
    scrollY: 0,
    width: 0,
    height: 0
  }, ne = !0, g = Wt();
  const We = /* @__PURE__ */ new Map(), nr = /* @__PURE__ */ new Map(), or = /* @__PURE__ */ new Map();
  let w = null, ye = null, Ce = 0, Se = 0, et = 0;
  const $e = [];
  let tt = { start: 0, end: 0 }, Rt = 1, kt = 0, rt = 0, ue = !1, ir = !1, nt = !1;
  const ot = ((m = (c = n?.options) === null || c === void 0 ? void 0 : c.spreadsheet) === null || m === void 0 ? void 0 : m.resizableColumns) === !0, it = ((u = (p = n?.options) === null || p === void 0 ? void 0 : p.spreadsheet) === null || u === void 0 ? void 0 : u.resizableRows) === !0, Ae = po(Fi(t, e.byteLength, n), { logErrors: !1 }), Ot = () => Ee.find((a) => a.id === te), Rn = () => {
    const a = Ee.filter((s) => !s.hidden);
    return a.length ? a : Ee;
  }, oe = () => {
    var a;
    return te ?? ((a = Ee[0]) === null || a === void 0 ? void 0 : a.id);
  }, Ht = () => V.clientHeight || 0, ar = () => !U && !he && (ne || ce), kn = () => !ar() && !U && he && rr > 0, H = (a) => Math.max(1, Math.round(a * O)), On = (a) => Math.max(0.1, Math.round(a * O)), Hn = () => {
    var a;
    if (!Ee.length)
      return L("spreadsheet.state.parsingWorkbook");
    const s = (a = Ot()) === null || a === void 0 ? void 0 : a.name;
    return s ? L("spreadsheet.state.preparingSheetNamed", { name: s }) : L("spreadsheet.state.preparingSheet");
  }, Nn = () => {
    if (!be)
      return "";
    const a = Math.min(tr * Q, be);
    return L("spreadsheet.state.cachedRows", {
      cached: a.toLocaleString(),
      total: be.toLocaleString()
    });
  }, Fn = () => {
    var a, s;
    const h = be || ((a = Ot()) === null || a === void 0 ? void 0 : a.rowCount) || 0, f = qe || ((s = Ot()) === null || s === void 0 ? void 0 : s.colCount) || 0;
    return h ? f ? L("spreadsheet.state.rowsAndColumns", {
      rows: h.toLocaleString(),
      cols: f.toLocaleString()
    }) : L("spreadsheet.state.rows", { rows: h.toLocaleString() }) : "";
  }, sr = () => ({
    scale: O,
    label: `${Math.round(O * 100)}%`,
    canZoomIn: O < Ye,
    canZoomOut: O > Ge,
    canReset: O !== 1,
    minScale: Ge,
    maxScale: Ye
  }), Wn = () => {
    const a = V.querySelector(".e-virt-table-container"), s = a ? Math.max(a.offsetWidth - a.clientWidth, 0) : 0, h = a ? Math.max(a.offsetHeight - a.clientHeight, 0) : 0;
    return {
      vertical: s || Xr,
      horizontal: h || Xr
    };
  }, lr = () => {
    const s = Wn(), h = Math.max(re.width - H(Ve) - s.vertical, 0), f = Math.max(re.height - H(mt) - s.horizontal, 0), E = Je.filter((C) => {
      const j = H(C.left) - re.scrollX, B = H(C.top) - re.scrollY;
      return j + H(C.width) >= -240 && j <= h + 240 && B + H(C.height) >= -240 && B <= f + 240;
    }), y = Qe.filter((C) => {
      const j = H(C.left) - re.scrollX, B = H(C.top) - re.scrollY;
      return j + H(C.width) >= -240 && j <= h + 240 && B + H(C.height) >= -240 && B <= f + 240;
    });
    pt(Ne, E.length === 0 && y.length === 0), Object.assign(Ne.style, {
      left: `${H(Ve)}px`,
      top: `${H(mt)}px`,
      right: "auto",
      bottom: "auto",
      width: `${h}px`,
      height: `${f}px`
    }), Ze.style.transform = `translate(${-re.scrollX}px, ${-re.scrollY}px)`;
    const M = E.map((C, j) => {
      const B = x.createElement("img");
      return B.className = "excel-image", B.src = C.src, B.alt = C.id, B.draggable = !1, Object.assign(B.style, {
        left: `${H(C.left)}px`,
        top: `${H(C.top)}px`,
        width: `${H(C.width)}px`,
        height: `${H(C.height)}px`
      }), B.dataset.imageIndex = `${j}`, B;
    }), D = y.map((C) => {
      const j = _o(x, C);
      return Object.assign(j.style, {
        left: `${H(C.left)}px`,
        top: `${H(C.top)}px`,
        width: `${H(C.width)}px`,
        height: `${H(C.height)}px`
      }), j;
    });
    Ze.replaceChildren(...M, ...D);
  }, Nt = () => {
    requestAnimationFrame(() => {
      var a;
      (a = Fe.querySelector(".sheet-tab.active")) === null || a === void 0 || a.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth"
      });
    });
  }, G = () => {
    pt(R, !ar());
    const a = R.querySelector("[data-loading-title]");
    a && (a.textContent = Hn()), ve.textContent = U, pt(ve, !U), pt(le, !kn());
    const s = le.querySelector(".sheet-loading-summary");
    s && (s.textContent = Nn()), Lt.textContent = Fn(), Fe.replaceChildren(...Rn().map((h) => {
      const f = x.createElement("button");
      return f.type = "button", f.className = `sheet-tab${te === h.id ? " active" : ""}`, f.title = h.name, f.textContent = h.name, f.setAttribute("aria-pressed", te === h.id ? "true" : "false"), f.addEventListener("click", () => ro(h.id)), f;
    })), lr();
  }, $n = (a) => {
    ne = a, G();
  }, dr = (a, s) => {
    $n(!0), Ae.emit(a, s);
  }, at = (a, s) => {
    a.__baseHeight = s, a._height = On(s);
  }, cr = () => {
    g.rowHeightCache.forEach((a, s) => {
      const h = g.rows[s];
      h && at(h, a);
    });
  }, De = (a) => (O = qr(a), cr(), Ie(), k.emit(), G(), sr()), Dn = () => {
    const a = g.columns.reduce((y, M) => {
      const D = M;
      if (D.hide)
        return y;
      const C = Number(D.width);
      return y + (Number.isFinite(C) && C > 0 ? C : de.colWidth);
    }, 0), s = Le(de.rowHeight, gt.rowHeight);
    let h = 0, f = 0;
    g.rowHeightCache.forEach((y) => {
      h += Le(y, s), f += 1;
    });
    const E = mt + h + Math.max(0, g.totalRows - f) * s;
    return { contentWidth: a, contentHeight: E };
  }, hr = (a) => {
    var s, h;
    const f = Dn(), E = a.mode === "auto", y = a.viewportWidth || V.clientWidth || 0, M = a.viewportHeight || V.clientHeight || 0;
    if (!(y <= 0 || M <= 0))
      return fo({
        mode: E ? "width" : a.mode,
        viewportWidth: y,
        viewportHeight: M,
        contentWidth: f.contentWidth,
        contentHeight: f.contentHeight,
        minScale: (s = a.minScale) !== null && s !== void 0 ? s : Ge,
        maxScale: (h = a.maxScale) !== null && h !== void 0 ? h : E ? 1 : Ye
      });
  }, In = (a) => {
    if (!g.active || !g.columns.length)
      return {
        applied: !1,
        mode: a.mode,
        resize: a.resize,
        source: a.source,
        reason: "pending",
        provider: "zoom"
      };
    const s = hr(a);
    if (!s)
      return {
        applied: !1,
        mode: a.mode,
        resize: a.resize,
        source: a.source,
        reason: "unmeasurable",
        provider: "zoom"
      };
    const h = De(s);
    return {
      applied: !0,
      mode: a.mode,
      resize: a.resize,
      scale: h.scale,
      source: a.source,
      provider: "zoom"
    };
  }, ur = () => {
    var a, s, h, f, E, y, M;
    const D = Number((h = (s = (a = n?.options) === null || a === void 0 ? void 0 : a.initialViewState) === null || s === void 0 ? void 0 : s.scale) !== null && h !== void 0 ? h : (y = (E = (f = n?.options) === null || f === void 0 ? void 0 : f.initialViewState) === null || E === void 0 ? void 0 : E.zoom) === null || y === void 0 ? void 0 : y.scale);
    if (nt || ((M = n?.options) === null || M === void 0 ? void 0 : M.fit) !== void 0 || Number.isFinite(D) && D > 0) {
      nt = !0;
      return;
    }
    const C = hr({
      mode: "auto",
      viewportWidth: V.clientWidth || t.clientWidth || 0,
      viewportHeight: V.clientHeight || t.clientHeight || 0
    });
    if (!C || C >= O) {
      C && (nt = !0);
      return;
    }
    O = qr(C), cr(), k.emit(), nt = !0;
  };
  so(S, {
    zoomIn: () => De(O + 0.1),
    zoomOut: () => De(O - 0.1),
    resetZoom: () => De(1),
    setZoom: De,
    fit: In,
    getState: sr,
    subscribe: k.subscribe
  });
  const we = () => {
    tr = g.loadedWindows.size, rr = g.loadingWindows.size, G();
  }, Me = () => {
    re = {
      scrollX: w?.ctx.scrollX || 0,
      scrollY: w?.ctx.scrollY || 0,
      width: V.clientWidth || 0,
      height: V.clientHeight || 0
    }, lr();
  }, Bn = (a) => {
    var s, h, f, E;
    const y = w?.ctx.selector;
    y && (y.xArrCopy = a.xArr.slice(), y.yArrCopy = a.yArr.slice(), (h = w == null ? void 0 : (s = w.ctx).emit) === null || h === void 0 || h.call(s, "copyChange", {
      xArr: y.xArrCopy,
      yArr: y.yArrCopy,
      data: a.data
    }), (E = w == null ? void 0 : (f = w.ctx).emit) === null || E === void 0 || E.call(f, "draw"));
  }, Ft = (a) => {
    const s = $i(a.data);
    Di(x, s).then((h) => {
      if (h) {
        Bn(a);
        return;
      }
      console.error("Spreadsheet copy failed: clipboard fallback returned false.");
    }).catch((h) => {
      console.error("Spreadsheet copy failed:", h);
    });
  }, zn = () => ({
    config: It({
      hostHeight: Ht(),
      darkMode: $,
      resizableColumns: ot,
      resizableRows: it,
      copySelection: Ft,
      sheetDefaults: de,
      virtualState: g,
      zoomScale: O
    }),
    columns: Vr(g.columns, O)
  }), Pn = () => {
    tt = { start: 0, end: 0 }, Rt = 1, kt = 0;
  }, fr = (a, s) => {
    !g.active || !g.totalRows || Co({
      startRow: a,
      endRow: s,
      direction: Rt,
      totalRows: g.totalRows
    }).forEach((h) => wr(h, !0));
  }, Te = () => {
    !w || ue || (Se && cancelAnimationFrame(Se), Se = requestAnimationFrame(() => {
      if (Se = 0, !w || !g.active || !g.totalRows || ue)
        return;
      const a = Math.max(w.ctx.body.headIndex || 0, 0), s = Math.max(w.ctx.body.tailIndex || a, a), h = w.ctx.scrollY || 0;
      Rt = h >= kt ? 1 : -1, kt = h, tt = { start: a, end: s }, Me(), fr(a, s);
    }));
  }, st = () => w || (w = new P(V, {
    data: [],
    columns: [],
    config: It({
      hostHeight: Ht(),
      darkMode: $,
      resizableColumns: ot,
      resizableRows: it,
      copySelection: Ft,
      sheetDefaults: de,
      virtualState: g,
      zoomScale: O
    })
  }), w.on("onScrollX", Te), w.on("onScrollY", Te), w.on("resize", Te), w.on("resizeColumnChange", Gn), w.on("resizeRowChange", Yn), w), pr = (a, s = g.columns, h = g.rows, f = !1) => {
    const E = {
      config: It({
        hostHeight: Ht(),
        darkMode: $,
        resizableColumns: ot,
        resizableRows: it,
        copySelection: Ft,
        sheetDefaults: de,
        virtualState: g,
        zoomScale: O
      }),
      columns: Vr(s, O)
    };
    if (a.loadConfig(E.config), a.loadColumns(E.columns), a.loadData(h), a.draw(), Me(), f) {
      requestAnimationFrame(() => {
        a.scrollTo(0, 0), a.draw(), Me(), Te();
      });
      return;
    }
    Te();
  };
  function Ie() {
    const a = st(), { config: s, columns: h } = zn();
    a.loadConfig(s), g.active && h.length && a.loadColumns(h), a.doLayout(), a.draw(), Me(), Te();
  }
  const gr = () => {
    et += 1;
    const a = ke(t);
    for (; $e.length; ) {
      const s = $e.pop();
      s !== void 0 && a?.clearTimeout(s);
    }
  }, mr = () => {
    if (ue || !w || !g.active)
      return;
    const a = V.getBoundingClientRect();
    a.width <= 0 || a.height <= 0 || (ur(), Ie());
  }, vr = () => {
    var a;
    gr();
    const s = et, h = ke(t);
    if (!h)
      return;
    [0, 32, 120, 300, 700].forEach((E) => {
      const y = h.setTimeout(() => {
        const M = $e.indexOf(y);
        M >= 0 && $e.splice(M, 1), h.requestAnimationFrame(() => {
          s === et && mr();
        });
      }, E);
      $e.push(y);
    }), (a = x.fonts) === null || a === void 0 || a.ready.then(() => {
      s === et && mr();
    }).catch(() => {
    });
  };
  function br(a, s, h) {
    for (const f of a) {
      if (`${f.key}` === s)
        return f.width = h, !0;
      if (Array.isArray(f.children) && br(f.children, s, h))
        return !0;
    }
    return !1;
  }
  function Vn() {
    var a;
    try {
      (a = w?.setCustomHeader) === null || a === void 0 || a.call(w, { resizableData: {} }, !0);
    } catch {
    }
  }
  function Gn(a) {
    if (!ot || ue)
      return;
    const s = a?.key === void 0 ? "" : `${a.key}`, h = Number(a?.width);
    if (!s || s === tn || !Number.isFinite(h) || h <= 0)
      return;
    const f = Math.max(1, Math.round(h / Math.max(O, 0.01)));
    if (!br(g.columns, s, Math.max(f, Math.round(ln / Math.max(O, 1)))))
      return;
    const y = oe();
    y !== void 0 && We.set(y, g), Vn(), Ie();
  }
  function Yn(a) {
    if (!it || ue)
      return;
    const s = Number(a?.rowIndex), h = Number(a?.height);
    if (!Number.isInteger(s) || s < 0 || !Number.isFinite(h) || h <= 0)
      return;
    const f = g.rows[s];
    if (!f)
      return;
    const E = Le(Math.max(dn, Math.round(h / Math.max(O, 0.01))), g.defaults.rowHeight);
    at(f, E), g.rowHeightCache.set(s, E);
    const y = oe();
    y !== void 0 && We.set(y, g), Ie();
  }
  function wr(a = 0, s = !0) {
    const h = oe();
    if (h === void 0)
      return;
    const f = wt(a, g.totalRows);
    g.loadedWindows.has(f) || g.loadingWindows.has(f) || (g.loadingWindows.add(f), we(), g.active && (Lr(g.rows, g.totalRows, f, ge.Loading), w?.draw()), U = "", dr("parseSheet", {
      sheet: h,
      startRow: f,
      pageSize: Q,
      sessionId: rt
    }), s && (ne = !1, G()));
  }
  const Un = (a) => {
    const s = a.meta;
    if (!s)
      return;
    const { columns: h, dataKeys: f } = ci(a);
    g = {
      ...Wt(),
      active: !0,
      totalRows: s.totalRows,
      totalCols: s.totalCols,
      indexOffset: di(a),
      defaults: a.defaults,
      dataKeys: f,
      rows: Eo(s.totalRows),
      columns: h
    }, de = a.defaults, be = s.totalRows, qe = s.totalCols, we();
  }, Xn = (a) => {
    g.dataKeys.forEach((s) => {
      delete a[s];
    });
  }, jn = (a) => {
    Array.isArray(a) && a.forEach((s, h) => {
      if (s === void 0)
        return;
      const f = g.rows[h];
      if (!f)
        return;
      const E = Le(s, g.defaults.rowHeight);
      at(f, E), g.rowHeightCache.set(h, E);
    });
  }, Kn = (a) => {
    var s, h;
    const f = a.meta;
    if (!f)
      return;
    const E = [], y = Math.min(f.endRow, g.totalRows);
    for (let M = f.startRow; M < y; M += 1) {
      const D = g.rows[M], C = M - f.startRow;
      if (!D)
        continue;
      Xn(D), (((s = a.data) === null || s === void 0 ? void 0 : s[C]) || []).forEach((lt, oo) => {
        lt === "" || lt === null || lt === void 0 || (D[Ct(oo)] = lt);
      });
      const B = Pr(a.rowHeights, C, g.defaults.rowHeight), yr = Le(Pr((h = a.structure) === null || h === void 0 ? void 0 : h.rowHeights, M, B), g.defaults.rowHeight);
      at(D, yr), D[yt] = ge.Loaded, g.rowHeightCache.set(M, yr), E.push(M);
    }
    g.windowRows.set(f.startRow, E);
  }, Zn = (a) => {
    const s = a.meta;
    if (!s)
      return;
    const h = [];
    Object.entries(a.cell || {}).forEach(([f, E]) => {
      const [y, M] = f.split("-").map(Number), D = ae(s.startRow + y, M + 1), C = yi(E);
      C && (g.cellCache.set(D, C), h.push(D));
    }), g.windowCells.set(s.startRow, h);
  }, xr = (a) => {
    g.mergeStartMap.clear(), g.mergeCoveredMap.clear(), a.forEach((s) => {
      const h = ae(s.row, s.col + 1);
      g.mergeStartMap.set(h, {
        ...s,
        col: s.col + 1
      });
      for (let f = 0; f < s.rowspan; f += 1)
        for (let E = 0; E < s.colspan; E += 1) {
          if (f === 0 && E === 0)
            continue;
          const y = ae(s.row + f, s.col + E + 1);
          g.mergeCoveredMap.set(y, !0);
        }
    });
  }, qn = (a) => {
    const s = a.structure, h = s?.merge;
    if (h)
      xr(h);
    else {
      const f = a.meta;
      f && !g.mergeStartMap.size && xr((a.merge || []).map((E) => ({
        ...E,
        row: E.row + f.startRow
      })));
    }
    if (jn(s?.rowHeights), s?.images) {
      Je = s.images;
      const f = oe();
      f !== void 0 && nr.set(f, s.images);
    }
    if (s?.charts) {
      Qe = s.charts;
      const f = oe();
      f !== void 0 && or.set(f, s.charts);
    }
  }, Jn = (a) => {
    var s;
    const h = a.meta;
    if (!h)
      return;
    const f = !he;
    g.active || Un(a), qn(a), Kn(a), Zn(a), ur(), g.loadedWindows.add(h.startRow), g.loadingWindows.delete(h.startRow), we(), he = !0;
    const E = oe();
    E !== void 0 && We.set(E, g), f ? pr(st(), g.columns, g.rows, !0) : w?.draw(), ne = !1, ce = !1, G(), ir || (ir = !0, (s = n?.onProgressiveRender) === null || s === void 0 || s.call(n)), f && vr();
    const y = tt.start || h.startRow, M = Math.max(tt.end, h.endRow - 1, h.startRow);
    fr(y, M);
  }, Qn = () => {
    U = "", be = 0, qe = 0, de = { ...gt }, Je = [], Qe = [], g = Wt(), he = !1, Pn(), we(), Me(), w && (w.loadColumns([]), w.loadData([]), w.scrollTo(0, 0), w.draw());
  }, eo = () => {
    const a = oe();
    a === void 0 || !g.active || We.set(a, g);
  }, to = (a) => {
    const s = We.get(a);
    return s ? (s.loadingWindows.clear(), g = s, U = "", be = s.totalRows, qe = s.totalCols, de = s.defaults, Je = nr.get(a) || [], Qe = or.get(a) || [], he = s.loadedWindows.size > 0, ce = !he, we(), queueMicrotask(() => {
      ue || (pr(st(), s.columns, s.rows), Me(), vr());
    }), !0) : !1;
  }, _r = () => {
    const a = oe();
    if (a === void 0) {
      ne = !1, ce = !1, G();
      return;
    }
    if (rt += 1, to(a)) {
      ne = !1, G();
      return;
    }
    ce = !0, Qn(), wr(0, !1);
  };
  function ro(a) {
    if (te === a) {
      Nt();
      return;
    }
    eo(), te = a, G(), _r(), Nt();
  }
  const no = () => {
    var a, s;
    dr("parseWorkbook", {
      workbook: e,
      fileType: r,
      filename: n?.filename,
      textEncoding: (s = (a = n?.options) === null || a === void 0 ? void 0 : a.spreadsheet) === null || s === void 0 ? void 0 : s.textEncoding
    });
  };
  Ae.onWorkerEvent("sheets", ({ sheets: a }) => {
    Ee = a;
    const s = a.find((h) => !h.hidden) || a[0];
    if (s) {
      te = s.id, G(), _r(), Nt();
      return;
    }
    ce = !1, ne = !1, G();
  }), Ae.onWorkerEvent("parseSheet", ({ sessionId: a, sheet: s, sheetData: h }) => {
    a !== rt || s !== oe() || Jn(h);
  }), Ae.onWorkerEvent("parseError", ({ sessionId: a, startRow: s, message: h }) => {
    a && a !== rt || (ce = !1, ne = !1, typeof s == "number" ? (g.loadingWindows.delete(s), we(), g.active && (Lr(g.rows, g.totalRows, s, ge.Placeholder), w?.draw())) : (g.loadingWindows.clear(), we()), U = h || L("spreadsheet.error.parseFailed"), G());
  }), Ae.onWorkerError((a) => {
    ce = !1, ne = !1, U = a.message || L("spreadsheet.error.workerFailed"), G();
  }), (b = n?.registerExportAdapter) === null || b === void 0 || b.call(n, {
    print: !1,
    exportHtml: !1
  }), (_ = n?.registerThumbnailAdapter) === null || _ === void 0 || _.call(n, {
    beforeCapture: async ({ signal: a }) => {
      for (; !he && !U && !ue; ) {
        if (a?.aborted)
          throw a.reason;
        await new Promise((s) => {
          const h = ke(t);
          h ? h.setTimeout(s, 16) : setTimeout(s, 16);
        });
      }
      if (U)
        throw new Error(U);
    },
    getTarget: () => _e
  }), st();
  const Er = ((A = ke(t)) === null || A === void 0 ? void 0 : A.ResizeObserver) || (typeof ResizeObserver < "u" ? ResizeObserver : void 0);
  return Er && (ye = new Er(() => {
    Ce && cancelAnimationFrame(Ce), Ce = requestAnimationFrame(() => {
      Ce = 0, Ie();
    });
  }), ye.observe(V)), G(), no(), {
    $el: S,
    unmount() {
      var a, s;
      ue = !0, Ce && cancelAnimationFrame(Ce), Se && cancelAnimationFrame(Se), gr(), ye?.disconnect(), ye = null, lo(S), Ae.destroy(), w?.destroy(), w = null, (a = n?.registerExportAdapter) === null || a === void 0 || a.call(n, null), (s = n?.registerThumbnailAdapter) === null || s === void 0 || s.call(n, null);
    }
  };
}, zi = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Ii,
  resolveEVirtTableConstructor: En,
  resolveEVirtTableStyleText: Sn,
  scopeEVirtTableStyleText: An
}, Symbol.toStringTag, { value: "Module" }));
export {
  zi as s,
  v as t
};
