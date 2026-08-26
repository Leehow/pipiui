(function() {
  try {
    if (typeof document < "u") {
      var a = document.createElement("style");
      a.appendChild(document.createTextNode(":root{--evt-header-font: 12px normal Arial;--evt-body-font: 12px normal Arial;--evt-color-white: #fff;--evt-color-black: #000000;--evt-color-primary: rgb(82, 146, 247);--evt-text-color-primary: #333;--evt-text-color-regular: #666;--evt-text-color-secondary: #999;--evt-box-shadow: 0 2px 12px 0 #0000001a;--evt-editor-bg-color: #fff;--evt-editor-text-color: #333;--evt-border-color: #e1e6eb;--evt-fixed-column-shadow-color: rgba(0, 0, 0, .1);--evt-fixed-column-shadow-fade-color: rgba(0, 0, 0, 0);--evt-body-bg-color: #fff;--evt-stripe-color: #fafafa;--evt-placeholder-color: #cdd0dc;--evt-header-bg-color: #f8faff;--evt-header-text-color: #1d2129;--evt-body-text-color: #4e5969;--evt-footer-text-color: #4e5969;--evt-loading-icon-color: #4e5969;--evt-expand-icon-color: #4e5969;--evt-shrink-icon-color: #4e5969;--evt-error-tip-icon-color: red;--evt-required-color: #f56c6c;--evt-cell-hover-icon-bg-color: #fff;--evt-cell-hover-icon-border-color: #dde0ea;--evt-scroller-color: #dee0e3;--evt-scroller-track-color: #fff;--evt-scroller-focus-color: #bbbec4;--evt-select-border-color: var(--evt-color-primary);--evt-select-area-color: rgba(82, 146, 247, .1);--evt-select-row-col-bg-color: rgba(82, 146, 247, .1);--evt-autofill-point-border-color: #fff;--evt-edit-bg-color: #fcf6ed;--evt-checkbox-color: var(--evt-color-primary);--evt-checkbox-uncheck-color: #dde0ea;--evt-checkbox-disabled-color: #f1f2f4;--evt-checkbox-check-disabled-color: #dde0ea;--evt-icon-edit-color: #4e5969;--evt-icon-select-color: #4e5969;--evt-readonly-color: #fff;--evt-readonly-text-color: var(--evt-body-text-color);--evt-error-tip-color: #ed3f14;--evt-footer-bg-color: #fafafa;--evt-highlight-hover-row-color: rgba(186, 203, 231, .1);--evt-highlight-selected-row-color: rgba(82, 146, 247, .1);--evt-tooltip-bg-color: #303133;--evt-tooltip-text-color: #fff;--evt-resize-row-line-color: #e1e6eb;--evt-resize-column-text-color: #fff;--evt-resize-column-text-bg-color: var(--evt-color-primary);--evt-resize-column-line-color: #e1e6eb;--evt-tree-line-color: #e1e6eb;--evt-sort-icon-color: var(--evt-color-primary);--evt-drag-tip-bg-color: rgba(82, 146, 247, .1);--evt-drag-tip-line-color: var(--evt-color-primary);--evt-context-menu-min-width: 150px;--evt-context-menu-max-width: 220px;--evt-context-menu-item-padding: 8px 12px;--evt-context-menu-bg-color: #fff;--evt-context-menu-text-color: #333;--evt-context-menu-item-hover-text-color: var(--evt-color-primary);--evt-context-menu-item-hover-bg-color: #f5f5f5;--evt-context-menu-text-size: 13px}.dark{--evt-border-color: #363637;--evt-header-bg-color: #141414;--evt-body-bg-color: #141414;--evt-header-text-color: #a3a6ad;--evt-body-text-color: #cfd3dc;--evt-readonly-text-color: #cfd3dc;--evt-footer-text-color: #cfd3dc;--evt-scroller-color: #414243;--evt-scroller-track-color: #141414;--evt-scroller-focus-color: #a3a6ad;--evt-edit-bg-color: #141414;--evt-footer-bg-color: #262727;--evt-autofill-point-border-color: #fff;--evt-editor-bg-color: #434343;--evt-editor-text-color: #cfd3dc;--evt-context-menu-bg-color: #141414;--evt-context-menu-text-color: #cfd3dc;--evt-context-menu-item-hover-text-color: var(--evt-color-primary);--evt-context-menu-item-hover-bg-color: #414243}.e-virt-table-container{position:relative;outline:none}.e-virt-table-stage{position:relative;overflow:hidden;outline:none;box-sizing:border-box;z-index:10;border-radius:8px;border:1px solid var(--evt-border-color)}.e-virt-table-canvas{position:absolute;left:0;top:0;box-sizing:border-box;background-color:var(--evt-body-bg-color);border:none;outline:none;z-index:10}.e-virt-table-editor{position:absolute;top:-10000px;left:-10000px;text-align:left;height:auto;line-height:0;z-index:100;overflow:hidden;background-color:var(--evt-editor-bg-color);border:2px solid var(--evt-color-primary);box-sizing:border-box;box-shadow:var(--evt-box-shadow);display:flex;align-items:center}.e-virt-table-overlayer{position:absolute;left:0;top:0;overflow:hidden;z-index:100;pointer-events:none}.e-virt-table-editor-textarea{width:100%;box-sizing:border-box;outline:none;font-weight:400;padding:8px;font-size:12px;color:inherit;white-space:pre-wrap;word-wrap:break-word;word-break:break-all;line-height:1.5;margin:0;border:none;vertical-align:middle;background:var(--evt-editor-bg-color);color:var(--evt-editor-text-color);overflow-y:auto;resize:none}.e-virt-table-context-menu{position:absolute;font-size:14px;color:var(--evt-text-color-regular);background-color:var(--evt-color-white);border-radius:4px;border:1px solid #e4e7ed;box-shadow:var(--evt-box-shadow);width:fit-content;padding:6px 0;z-index:9999;left:-99999px;top:-99999px}.e-virt-table-context-menu-item{cursor:pointer;padding:6px 24px;color:var(--evt-text-color-regular)}.e-virt-table-context-menu-item:hover{color:var(--evt-color-primary);background-color:#f5f7fa}.e-virt-table-loading{display:none;position:absolute;left:0;top:0;right:0;bottom:0;width:100%;height:100%;z-index:2000;background-color:#fff6;display:flex;align-items:center;justify-content:center}.e-virt-table-loading-spinner{opacity:1;display:flex;flex-direction:column;align-items:center;justify-content:center}.e-virt-table-loading-spinner svg{color:var(--evt-text-color-regular);animation:rotate 1s linear infinite}@keyframes rotate{0%{transform:rotate(0)}to{transform:rotate(360deg)}}.e-virt-table-loading-text{margin:0;font-size:12px;color:var(--evt-text-color-regular)}.e-virt-table-main-menu,.e-virt-table-submenu{position:absolute;background:var(--evt-context-menu-bg-color);border-radius:4px;box-shadow:0 2px 8px #0000001a;min-width:var(--evt-context-menu-min-width);max-width:var(--evt-context-menu-max-width);color:var(--evt-text-color-primary)}.e-virt-table-main-menu{border:1px solid var(--evt-border-color);z-index:3000;left:-99999px;top:-99999px;display:none;position:fixed;background-color:var(--evt-body-bg-color)}.e-virt-table-submenu{border:1px solid var(--evt-border-color);z-index:1000;max-height:350px;overflow-y:auto;opacity:0;visibility:hidden;transform:translate(-10px);transition:opacity .2s,visibility .2s,transform .2s;-ms-overflow-style:none;scrollbar-width:none}.e-virt-table-submenu::-webkit-scrollbar{display:none}.e-virt-table-submenu.show{opacity:1;visibility:visible;transform:translate(0)}.e-virt-table-submenu:not(.show){transition:none}.e-virt-table-menu-item,.e-virt-table-submenu-item{position:relative;-webkit-user-select:none;user-select:none;padding:var(--evt-context-menu-item-padding);cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background .2s,color .2s;color:var(--evt-context-menu-text-color);font-size:var(--evt-context-menu-text-size)}.e-virt-table-menu-item:last-child,.e-virt-table-submenu-item:last-child{border-bottom:none}.e-virt-table-menu-item:has(.e-virt-table-menu-item-icon){padding-left:8px}.e-virt-table-menu-item-content{display:flex;align-items:center;flex:1;min-width:0}.e-virt-table-menu-item-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:8px;flex-shrink:0}.e-virt-table-menu-item-icon svg{width:100%;height:100%;fill:currentColor}.e-virt-table-menu-item-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.e-virt-table-menu-arrow{display:inline-flex;align-items:center;justify-content:center;color:var(--evt-text-color-regular);transition:color .2s}.e-virt-table-menu-arrow svg{width:20px;height:20px;fill:currentColor}.e-virt-table-submenu-item:hover,.e-virt-table-menu-item:hover,.e-virt-table-menu-item.active{background:var(--evt-context-menu-item-hover-bg-color);color:var(--evt-context-menu-item-hover-text-color)}.e-virt-table-menu-item.disabled,.e-virt-table-submenu-item.disabled{cursor:not-allowed}.e-virt-table-finder-bar{position:absolute;top:8px;right:16px;display:none;z-index:10000;background:#fff;border:1px solid #dadce0;border-radius:12px;box-shadow:0 2px 6px #0003;padding:0 8px;height:48px;min-width:250px;align-items:center;font-size:12px}.e-virt-table-finder-bar.show{display:flex}.e-virt-table-finder-bar-input-wrapper{display:flex;align-items:center;flex:1;padding:0 8px;position:relative}.e-virt-table-finder-bar-input{border:none;outline:none;flex:1;font-size:12px;background:transparent;color:#333;min-width:150px;padding-left:0;position:relative}.e-virt-table-finder-bar-nav{display:flex;flex-direction:row;gap:8px;margin:0 8px;align-items:center}.e-virt-table-finder-bar-nav-btn{border:none;background:transparent;cursor:pointer;padding:0;color:#666;border-radius:50%;display:flex;align-items:center;justify-content:center}.e-virt-table-finder-bar-nav-btn svg{width:24px;height:24px}.e-virt-table-finder-bar-nav-btn.prev-btn{transform:rotate(-90deg)}.e-virt-table-finder-bar-nav-btn.next-btn{transform:rotate(90deg)}.e-virt-table-finder-bar-nav-btn.close-btn{font-size:24px;color:#666;line-height:1;width:24px;height:24px}.e-virt-table-finder-bar-nav-btn:hover{color:#666;background-color:#f0f0f0}.e-virt-table-finder-bar-count{color:#666;font-size:12px;margin:0 8px;white-space:nowrap;flex-shrink:0}.e-virt-table-finder-bar-count.no-results{color:#999}.e-virt-table-finder-bar-loading{display:none;position:absolute;left:8px;top:0;width:16px;height:16px;flex-shrink:0;pointer-events:none;z-index:0}.e-virt-table-finder-bar-loading.show{display:block}.e-virt-table-finder-bar-loading svg{width:100%;height:100%;color:#666;animation:rotate 1s linear infinite}.e-virt-table-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:14px;color:#666;z-index:15}")), document.head.appendChild(a);
    }
  } catch (t) {
    console.error("vite-plugin-css-injected-by-js", t);
  }
})();
var Te = Object.defineProperty, Oe = (a, t, e) => t in a ? Te(a, t, { enumerable: !0, configurable: !0, writable: !0, value: e }) : a[t] = e, n = (a, t, e) => Oe(a, typeof t != "symbol" ? t + "" : t, e);
class Se {
  constructor(t) {
    n(this, "rules"), this.rules = t;
  }
  validate(t) {
    const e = [], { column: i, row: s, key: o, rowKey: r, colIndex: l, rowIndex: h, value: c, field: u, fieldValue: d } = t;
    Array.isArray(this.rules) || (this.rules = [this.rules]);
    for (const x of this.rules) {
      if (x.validator) {
        const f = {
          field: u,
          fieldValue: d,
          value: c,
          column: i,
          colIndex: l,
          rowIndex: h,
          row: s,
          key: o,
          rowKey: r,
          ...x
        };
        x.validator(f, c, (m) => {
          m && e.push({
            ...f,
            message: m
          });
        });
      }
      if (!x.required && (c == null || c === ""))
        return e;
      x.pattern && !x.pattern.test(c) && e.push({
        value: c,
        column: i,
        row: s,
        key: o,
        rowKey: r,
        colIndex: l,
        rowIndex: h,
        field: u,
        fieldValue: d,
        message: x.message || `${o} is pattern validation error`
      }), x.required && (c == null || c === "") && e.push({
        value: c,
        column: i,
        row: s,
        key: o,
        rowKey: r,
        colIndex: l,
        rowIndex: h,
        field: u,
        fieldValue: d,
        message: x.message || `${o} is required`
      });
    }
    return e;
  }
}
function oe() {
  return "xxxxxxxxxxxxxxxxxx".replace(/[x]/g, function(a) {
    const t = Math.random() * 16 | 0;
    return (a === "x" ? t : t & 3 | 8).toString(16);
  });
}
function At(a, t) {
  let e = 0, i;
  return function(...s) {
    const o = (/* @__PURE__ */ new Date()).getTime(), r = o - e, l = typeof t == "function" ? t() : t;
    !e || r >= l ? (a.apply(this, s), e = o) : i || (i = setTimeout(() => {
      a.apply(this, s), e = (/* @__PURE__ */ new Date()).getTime(), i = void 0;
    }, l - r));
  };
}
function at(a = []) {
  return a.length ? a.map((t) => at(t.children) + 1).sort((t, e) => e - t)[0] : 0;
}
function Le(a = []) {
  let t = [], e = [], i = [];
  return a.forEach((s) => {
    s.fixed === "left" ? t.push(s) : s.fixed === "right" ? i.push(s) : e.push(s);
  }), [
    ...t.sort((s, o) => (s.sort ?? 0) - (o.sort ?? 0)),
    ...e.sort((s, o) => (s.sort ?? 0) - (o.sort ?? 0)),
    ...i.sort((s, o) => (s.sort ?? 0) - (o.sort ?? 0))
  ];
}
function ct(a = [], t = 1, e = 0, i = "") {
  return a.sort((s, o) => (s.sort ?? 0) - (o.sort ?? 0)).map((s) => {
    if (s.children) {
      let o = 0, r = s.fixed;
      s.children.forEach((h) => {
        h.fixed = r;
      });
      const l = ct(s.children, t - 1, e + 1, s.key);
      return l && l.forEach((h) => {
        o += h.colspan ?? 0;
      }), {
        ...s,
        width: s.width,
        level: e,
        rowspan: 1,
        colspan: o,
        parentKey: i,
        children: l.sort((h, c) => (h.sort ?? 0) - (c.sort ?? 0))
      };
    }
    return {
      ...s,
      level: e,
      rowspan: t,
      colspan: 1,
      parentKey: i
    };
  });
}
function it(a = []) {
  let t = [];
  return a.forEach((e) => {
    e.children ? t = t.concat(it(e.children)) : t.push(e);
  }), t;
}
function re(a) {
  return a.filter((t) => !t.hide).map((t) => Array.isArray(t.children) && t.children.length > 0 ? {
    ...t,
    children: re(t.children)
    // 递归处理
  } : { ...t });
}
const Yt = /^(\r\n|\n\r|\r|\n)/, Me = /^[^\t\r\n]+/, Wt = /^\t/;
function Ae(a) {
  let t = [[""]];
  if (a.length === 0)
    return t;
  let e = 0, i = 0, s;
  for (; a.length > 0 && s !== a.length; )
    if (s = a.length, a.match(Wt))
      a = a.replace(Wt, ""), e += 1, t[i][e] = "";
    else if (a.match(Yt))
      a = a.replace(Yt, ""), e = 0, i += 1, t[i] = [""];
    else {
      let o = "";
      if (a.startsWith('"')) {
        let r = 0, l = !0;
        for (; l; ) {
          const h = a.slice(0, 1);
          h === '"' && (r += 1), o += h, a = a.slice(1), (a.length === 0 || a.match(/^[\t\r\n]/) && r % 2 === 0) && (l = !1);
        }
        o = o.replace(/^"/, "").replace(/"$/, "").replace(/["]*/g, (h) => new Array(Math.floor(h.length / 2)).fill('"').join(""));
      } else {
        const r = a.match(Me);
        o = r ? r[0] : "", a = a.slice(o.length);
      }
      t[i][e] = o;
    }
  return Array.isArray(t) && t.length > 1 && t[t.length - 1].length === 1 && t[t.length - 1][0] === "" && (t = t.slice(0, t.length - 1)), t;
}
function De(a) {
  let t, e, i, s, o = "", r;
  for (t = 0, e = a.length; t < e; t += 1) {
    for (s = a[t].length, i = 0; i < s; i += 1)
      i > 0 && (o += "	"), r = a[t][i], typeof r == "string" ? r.indexOf(`
`) > -1 ? o += `"${r.replace(/"/g, '""')}"` : o += r : r == null ? o += "" : o += r;
    t !== e - 1 && (o += `
`);
  }
  return o;
}
function ne(a, t, e = []) {
  let i = 0;
  const s = [];
  return a.forEach((o, r) => {
    if (r === 0)
      s.push(1);
    else {
      const l = e.reduce((c, u) => `${c}${o[u] ?? ""}`, "") || o[t], h = e.reduce((c, u) => `${c}${a[r - 1][u] ?? ""}`, "") || a[r - 1][t];
      l === h ? (s[i] += 1, s.push(0)) : (s.push(1), i = r);
    }
  }), s;
}
function le(a, t) {
  let e = "", i = "";
  const s = {};
  return t.forEach((o, r) => {
    r === 0 ? (e = o.key, i = o.key, s[o.key] = 1) : a[o.key] === a[e] ? (s[o.key] = 0, s[i] += 1) : (s[o.key] = 1, e = o.key, i = o.key);
  }), s;
}
function He(a, t, e = []) {
  const { visibleRows: i, rowIndex: s, headIndex: o } = a, r = ne(i, t, e);
  return r[s - o] === 0 ? {
    rowspan: 0,
    colspan: 0,
    relationRowKeys: e,
    mergeRow: !0
  } : {
    rowspan: r[s - o],
    colspan: 1,
    relationRowKeys: e,
    mergeRow: !0
  };
}
function Ne(a, t = []) {
  const { column: e, row: i, visibleLeafColumns: s } = a, o = s.filter((r) => t.includes(r.key));
  if (t.includes(e.key)) {
    const r = le(i, o);
    return r[e.key] === 0 ? {
      rowspan: 0,
      colspan: 0,
      relationColKeys: t,
      mergeCol: !0
    } : {
      rowspan: 1,
      colspan: r[e.key],
      relationColKeys: t,
      mergeCol: !0
    };
  }
}
function ke(a, t = document.documentElement) {
  const e = a.startsWith("--") ? a : `--${a}`;
  return getComputedStyle(t).getPropertyValue(e).trim();
}
function Vt(a) {
  if (!a) return /* @__PURE__ */ new Date(0);
  if (typeof a == "number")
    return new Date(a);
  const t = String(a).trim(), e = new Date(t);
  if (!isNaN(e.getTime()))
    return e;
  const i = [
    // YYYY-MM-DD
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    // YYYY/MM/DD
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
    // YYYY.MM.DD
    /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/,
    // DD-MM-YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    // DD/MM/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // DD.MM.YYYY
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    // MM-DD-YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    // MM/DD/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // MM.DD.YYYY
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    // YYYYMMDD
    /^(\d{4})(\d{2})(\d{2})$/,
    // 带时间的格式 YYYY-MM-DD HH:mm:ss
    /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
    // 带时间的格式 YYYY/MM/DD HH:mm:ss
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/
  ];
  for (const s of i) {
    const o = t.match(s);
    if (o) {
      const r = o.slice(1).map(Number);
      if (s.source.includes("YYYY-MM-DD") || s.source.includes("YYYY/MM/DD") || s.source.includes("YYYY.MM.DD")) {
        const [l, h, c, u = 0, d = 0, x = 0] = r;
        return new Date(l, h - 1, c, u, d, x);
      } else if (s.source.includes("DD-MM-YYYY") || s.source.includes("DD/MM/YYYY") || s.source.includes("DD.MM.YYYY")) {
        const [l, h, c, u = 0, d = 0, x = 0] = r;
        return new Date(c, h - 1, l, u, d, x);
      } else if (s.source.includes("MM-DD-YYYY") || s.source.includes("MM/DD/YYYY") || s.source.includes("MM.DD.YYYY")) {
        const [l, h, c, u = 0, d = 0, x = 0] = r;
        return new Date(c, l - 1, h, u, d, x);
      } else if (s.source.includes("YYYYMMDD")) {
        const [l, h, c] = r;
        return new Date(l, h - 1, c);
      }
    }
  }
  return /* @__PURE__ */ new Date(NaN);
}
function Be(a, t) {
  const e = Vt(a), i = Vt(t);
  return isNaN(e.getTime()) && isNaN(i.getTime()) ? 0 : isNaN(e.getTime()) ? -1 : isNaN(i.getTime()) ? 1 : e.getTime() - i.getTime();
}
function Ke(a) {
  const t = String(a).match(/\.(\d+)/);
  return t?.[1].length ?? 0;
}
function Fe(a) {
  return (a.scrollbarMode ?? a.SCROLLBAR_MODE) === "inner" ? "inner" : "outer";
}
function V(a) {
  return Fe(a) === "inner";
}
function B(a) {
  return V(a) ? 0 : a.SCROLLER_TRACK_SIZE || 0;
}
function he(a) {
  return a.SCROLLER_TRACK_SIZE || 0;
}
function zt(a, t) {
  return !V(a) || !t ? 0 : he(a);
}
function Xe(a) {
  return V(a) ? 1 : 0;
}
function Ye(a) {
  return !V(a);
}
function We(a) {
  return !V(a);
}
function Ve(a, t) {
  return V(a) && t;
}
function ze(a, t) {
  return V(a) ? t.innerVisible || t.isFocus || t.isDragging : !0;
}
class ae {
  constructor(t, e, i, s, o, r, l) {
    n(this, "ctx"), n(this, "x", 0), n(this, "y", 0), n(this, "width", 0), n(this, "height", 0), n(this, "visibleWidth", 0), n(this, "visibleHeight", 0), n(this, "fixed"), n(this, "cellType"), n(this, "drawX", 0), n(this, "drawY", 0), n(this, "cellImages", /* @__PURE__ */ new Map()), this.ctx = t, this.x = e, this.y = i, this.width = s, this.height = o, this.fixed = l, this.cellType = r;
  }
  isHorizontalVisible() {
    if (this.fixed)
      return !0;
    const { stageWidth: t, fixedLeftWidth: e, scrollX: i, fixedRightWidth: s } = this.ctx, o = t;
    return !(this.x + this.width - e - i <= 0 || this.x - i >= o - s);
  }
  isVerticalVisible() {
    const { stageHeight: t, scrollY: e } = this.ctx, i = t;
    return !(this.y + this.height - e <= 0 || this.y - e >= i);
  }
  getDrawX() {
    if (this.fixed === "left")
      return this.x;
    if (this.fixed === "right") {
      const { stageWidth: t } = this.ctx;
      return t - (this.ctx.header.width - this.x) - B(this.ctx.config);
    }
    return this.x - this.ctx.scrollX;
  }
  getDrawY() {
    return this.cellType === "header" ? this.y : this.cellType === "footer" && this.ctx.config.FOOTER_FIXED ? this.y : this.y - this.ctx.scrollY;
  }
  getLeftFixedX() {
    return this.x - this.ctx.scrollX;
  }
  isInside(t, e) {
    return t >= this.drawX && t <= this.drawX + this.width && e >= this.drawY && e <= this.drawY + this.height;
  }
  /**
   * 判断是否在可见区域,合并单元格用
   * @param x 
   * @param y 
   * @returns 
   */
  isInsideVisible(t, e) {
    return t >= this.drawX && t <= this.drawX + this.visibleWidth && e >= this.drawY && e <= this.drawY + this.visibleHeight && this.isInside(t, e);
  }
  setImage(t, e) {
    this.cellImages.set(t, e);
  }
  getImages() {
    return this.cellImages;
  }
  getImage(t) {
    return this.cellImages.get(t);
  }
  isImageInside(t, e) {
    const { offsetX: i, offsetY: s } = this.ctx.getOffset(e), o = this.getImage(t);
    return o ? o.isInside(i, s) : !1;
  }
  // 判断图片点击方向返回点击上下左右
  getImageClickDirection(t, e) {
    const { offsetX: i, offsetY: s } = this.ctx.getOffset(e), o = this.getImage(t);
    if (!o) return null;
    const r = i - o.x, l = s - o.y, h = o.width / 2, c = o.height / 2;
    return l < c ? r < h ? "up-left" : "up-right" : r < h ? "down-left" : "down-right";
  }
}
class Z {
  constructor(t, e, i, s, o, r) {
    n(this, "source"), n(this, "name"), n(this, "x"), n(this, "y"), n(this, "width"), n(this, "height"), n(this, "visible", !0), this.source = r, this.name = t, this.x = e, this.y = i, this.width = s, this.height = o;
  }
  drawWrapper(t, e) {
    t.paint.drawRect(this.x - 2, this.y - 2, this.width + 4, this.height + 4, {
      radius: 4,
      borderWidth: 1,
      ...e
    });
  }
  setVisible(t) {
    this.visible = t;
  }
  isInside(t, e) {
    return this.visible ? !!(this.source && t > this.x && t < this.x + this.width && e > this.y && e < this.y + this.height) : !1;
  }
}
function Pe(a) {
  return a.ENABLE_RESIZE_COLUMN ? a.RESIZE_COLUMN_DIVIDER_COLOR : void 0;
}
function ot(a) {
  return a === !0 ? "default" : a === !1 ? "inner" : a;
}
function dt(a) {
  return ot(a) === "default";
}
function Dt(a) {
  const t = ot(a);
  return t === "default" || t === "inner";
}
function Ge(a, t, e, i, s = {}) {
  const { fixedLeftEnd: o = i, fixedRightStart: r = 0 } = s;
  return a === "right" ? t > r + 0.01 ? "left" : null : a === "left" ? t + e < o - 0.01 ? "right" : null : t + e < i - 0.01 ? "right" : null;
}
function $e(a) {
  const t = ot(a);
  return t === "default" || t === "outer";
}
function _t(a) {
  return ot(a) === "default";
}
function Ue(a, t) {
  return _t(a) || t;
}
class ce extends ae {
  constructor(t, e, i, s, o, r, l, h, c, u = "body", d = !0) {
    super(t, s, o, r, l, u, h.fixed), n(this, "parentRowKey", ""), n(this, "parentRowKeys", []), n(this, "formatter"), n(this, "formatterFinderValue"), n(this, "formatterFinderFooterValue"), n(this, "formatterFooter"), n(this, "hoverIconName", ""), n(this, "operation", !1), n(this, "align"), n(this, "verticalAlign"), n(this, "fixed"), n(this, "type"), n(this, "editorType"), n(this, "editorProps"), n(this, "cellType"), n(this, "level"), n(this, "colspan", 1), n(this, "rowspan", 1), n(this, "mergeRow", !1), n(this, "mergeCol", !1), n(this, "relationRowKeys", []), n(this, "relationColKeys", []), n(this, "key"), n(this, "column"), n(this, "rowIndex"), n(this, "colIndex"), n(this, "rowKey"), n(this, "row"), n(this, "value"), n(this, "render"), n(this, "renderFooter"), n(this, "style", {}), n(this, "domDataset", {}), n(this, "rules", []), n(this, "message", ""), n(this, "text", ""), n(this, "displayText", ""), n(this, "visibleWidth", 0), n(this, "visibleHeight", 0), n(this, "isHasChanged", !1), n(this, "drawX", 0), n(this, "drawY", 0), n(this, "drawCellBgColor", ""), n(this, "drawCellSkyBgColor", ""), n(this, "drawTextColor", ""), n(this, "drawTextFont", ""), n(this, "drawTextX", 0), n(this, "drawTextY", 0), n(this, "drawTextWidth", 0), n(this, "drawTextHeight", 0), n(this, "autoRowHeight", !1), n(this, "calculatedHeight", 0), n(this, "ellipsis", !1), n(this, "rowExpand", !1), n(this, "rowHasChildren", !1), n(this, "overflowTooltipShow", !0), n(this, "selectorCellValueType", "value"), n(this, "overflowTooltipMaxWidth", 500), n(this, "overflowTooltipPlacement", "top"), n(this, "maxLineClamp", "auto"), n(this, "precision"), n(this, "min"), n(this, "max"), n(this, "maxlength"), n(this, "mixedRender", !1), n(this, "renderType", "default"), n(this, "renderFooterType", "default"), this.visibleWidth = this.width, this.visibleHeight = this.height, this.colIndex = i, this.rowIndex = e, this.key = h.key, this.type = h.type || "", this.editorType = h.editorType || "text", this.selectorCellValueType = h.selectorCellValueType || this.ctx.config.SELECTOR_CELL_VALUE_TYPE || "value", this.editorProps = h.editorProps || {}, this.cellType = u, this.align = h.align || this.ctx.config.COLUMNS_ALIGN, this.verticalAlign = h.verticalAlign || this.ctx.config.COLUMNS_VERTICAL_ALIGN, this.fixed = h.fixed || "", this.level = h.level || 0, this.operation = h.operation || !1, this.column = h, this.rules = h.rules || [], this.row = c, this.rowKey = this.cellType === "body" ? this.ctx.database.getRowKeyForRowIndex(e) : `${this.cellType}_${this.rowIndex}`, this.value = this.getValue(), this.render = h.render, this.overflowTooltipShow = h.overflowTooltipShow !== !1, this.autoRowHeight = h.autoRowHeight !== void 0 ? h.autoRowHeight : this.ctx.config.AUTO_ROW_HEIGHT, this.overflowTooltipMaxWidth = h.overflowTooltipMaxWidth || 500, this.overflowTooltipPlacement = h.overflowTooltipPlacement || "top", this.renderFooter = h.renderFooter, this.hoverIconName = h.hoverIconName, this.formatter = h.formatter, this.formatterFinderValue = h.formatterFinderValue, this.formatterFinderFooterValue = h.formatterFinderFooterValue, this.formatterFooter = h.formatterFooter, this.maxLineClamp = h.maxLineClamp || "auto", this.precision = h.precision, this.min = h.min, this.max = h.max, this.maxlength = h.maxlength, this.mixedRender = h.mixedRender || !1, this.renderType = h.renderType || "default", this.renderFooterType = h.renderFooterType || "default";
    const x = this.ctx.database.getRowForRowKey(this.rowKey);
    this.cellType === "body" && x && (this.parentRowKey = x.parentRowKey, this.parentRowKeys = x.parentRowKeys), d && this.update();
  }
  setWidthHeight(t, e) {
    this.width = t, this.height = e;
  }
  getValidationMessage() {
    const t = this.ctx.database.getValidationError(this.rowKey, this.key);
    if (Array.isArray(t) && t.length) {
      const [e] = t;
      this.message = e.message || "";
    }
    return this.message;
  }
  update() {
    this.drawX = this.getDrawX(), this.drawY = this.getDrawY(), this.updateSpan(), this.updateDragImage();
    const t = this.getImage("drag"), e = t ? t.width : 0;
    this.drawTextX = this.drawX + e, this.drawTextY = this.drawY, this.isHasChanged = this.ctx.database.isHasChangedData(this.rowKey, this.key), this.drawTextWidth = this.visibleWidth - e, this.drawTextHeight = this.visibleHeight, this.updateStyle(), this.updateType(), this.updateHoverIcon(), this.updateSelection(), this.updateTree(), this.updateEditor(), this.updateRender(), this.getValidationMessage(), this.updateContainer(), this.text = this.getText(), this.displayText = this.getDisplayText();
  }
  updateSpan() {
    if (this.cellType === "footer")
      return;
    const { SPAN_METHOD: t } = this.ctx.config;
    if (typeof t == "function") {
      const e = t, {
        colspan: i = 1,
        rowspan: s = 1,
        relationRowKeys: o,
        relationColKeys: r,
        mergeRow: l = !1,
        mergeCol: h = !1
      } = e({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.getValue(),
        headIndex: this.ctx.body.headIndex,
        headPosition: this.ctx.database.getPositionForRowIndex(this.ctx.body.headIndex),
        visibleRows: this.ctx.body.visibleRows,
        visibleLeafColumns: this.ctx.header.visibleLeafColumns,
        rows: this.ctx.body.data
      }) || {};
      Array.isArray(o) && o.length > 0 ? this.relationRowKeys = o : this.relationRowKeys = [this.key], Array.isArray(r) && r.length > 0 ? this.relationColKeys = r : this.relationColKeys = [this.key], this.mergeCol = h, this.mergeRow = l, this.colspan = i, this.rowspan = s, this.visibleWidth = this.getWidthByColIndexColSpan(this.colIndex, this.colspan), this.visibleHeight = this.ctx.database.getHeightByRowIndexRowSpan(this.rowIndex, this.rowspan);
    }
  }
  updateSpanInfo() {
    if (this.mergeRow || this.mergeCol) {
      const t = this.getSpanInfo();
      this.height = t.height, this.width = t.width, this.drawX = this.getDrawX(), this.drawY = this.getDrawY(), this.drawY -= t.offsetTop, this.drawX -= t.offsetLeft;
    }
  }
  updateType() {
    const { BODY_CELL_TYPE_METHOD: t } = this.ctx.config;
    if (typeof t == "function") {
      const e = t({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.getValue()
      });
      e !== void 0 && (this.type = e);
    }
  }
  updateEditor() {
    const { BODY_CELL_EDITOR_METHOD: t } = this.ctx.config;
    if (typeof t == "function") {
      const e = t({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.getValue()
      });
      if (e !== void 0) {
        const { type: i, props: s = {} } = e;
        this.editorType = i, this.editorProps = s;
      }
    }
  }
  updateRender() {
    const { BODY_CELL_RENDER_METHOD: t } = this.ctx.config;
    if (typeof t == "function") {
      const e = t({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.getValue()
      });
      e !== void 0 && (this.render = e);
    }
  }
  validate() {
    this.ctx.database.getValidator(this.rowKey, this.key).then((t) => {
      if (Array.isArray(t) && t.length) {
        const [e] = t;
        this.message = e.message;
      } else
        this.message = "";
    }).finally(() => {
      this.ctx.emit("draw");
    });
  }
  /**
   * 更新样式
   */
  updateStyle() {
    this.autoRowHeight && (this.domDataset = {
      "data-auto-height": !0,
      "data-row-index": this.rowIndex,
      "data-col-index": this.colIndex
    }), this.style = this.getOverlayerViewsStyle();
  }
  isInsideVisible(t, e) {
    return t >= this.drawX && t <= this.drawX + this.visibleWidth && e >= this.drawY && e <= this.drawY + this.visibleHeight;
  }
  updateTree() {
    const { CELL_PADDING: t = 0 } = this.ctx.config, { rowKey: e, cellType: i } = this;
    let s, o = 0, r = "";
    if (!(["tree", "selection-tree", "tree-selection"].includes(this.type) && i === "body"))
      return;
    const l = this.ctx.database.getRowForRowKey(e), { expand: h = !1, hasChildren: c = !1, expandLoading: u = !1, level: d = 0 } = l || {};
    this.rowExpand = h, this.rowHasChildren = c;
    const { TREE_INDENT: x = 16, CHECKBOX_SIZE: f, TREE_ICON_SIZE: m } = this.ctx.config;
    if (o = d * x, u) {
      const T = this.ctx.icons.get("loading");
      r = "loading", s = T;
    } else if (c) {
      const T = this.ctx.icons.get("expand"), v = this.ctx.icons.get("shrink");
      s = h ? v : T, r = h ? "shrink" : "expand";
    }
    let g = m, w = m, C = this.drawX;
    (this.align === "center" || this.align === "right") && (C = this.drawX + (this.visibleWidth - g - 2 * t) / 2, this.align = "left");
    let E = C + o + t, b = this.drawY + (this.visibleHeight - w) / 2, p = o + this.drawX + g - 0.5;
    const y = this.getImage("selection"), R = this.getImage("drag"), _ = R ? R.width : 0;
    if (this.type === "selection-tree" && y) {
      const T = y.x, v = y.width;
      E = o + T + v, p = E + g - t / 2;
    } else this.type === "tree-selection" ? (E += _, p = E + f + g - t / 2) : (E += _, p = E + g - t / 2);
    this.drawTextX = p, this.drawTextWidth = this.drawX + this.visibleWidth - p, !(E + g + t > this.drawX + this.visibleWidth) && (b + w + t > this.drawY + this.visibleHeight || this.setImage("tree", new Z(r, E, b, g, w, s)));
  }
  updateDragImage() {
    if (this.cellType === "body" && this.column.dragRow) {
      const { DRAG_ROW_ICON_SIZE: t, CELL_PADDING: e } = this.ctx.config, i = this.drawX + e / 2, s = this.drawY + (this.visibleHeight - t) / 2, o = new Z("drag", i, s, t, t, this.ctx.icons.get("drag"));
      this.rowspan === 0 && o.setVisible(!1), this.setImage("drag", o);
    }
  }
  drawTreeLine() {
    const { TREE_LINE: t, TREE_INDENT: e = 16, TREE_ICON_SIZE: i = 16, TREE_LINE_COLOR: s = "#e1e6eb" } = this.ctx.config;
    if (!t || this.cellType !== "body" || !["tree", "selection-tree", "tree-selection"].includes(this.type) || this.rowspan === 0 || this.colspan === 0) return;
    const o = this.ctx.database.getRowForRowKey(this.rowKey) || {}, r = o.level ?? 0, l = this.getImage("tree");
    if (!l) return;
    const h = l.x, c = l.y, u = l.width, d = l.height, x = h + u / 2, f = c + d / 2;
    let m = h - r * e;
    const g = Array.isArray(o.parentRowKeys) ? o.parentRowKeys : [];
    if (r > 0) {
      for (let b = 0; b < r - 1; b += 1) {
        const p = g[b + 1];
        if ((p ? this.ctx.database.getRowForRowKey(p) || {} : {}).isLastChild) continue;
        const y = Math.round(h - (r - b) * e + i / 2);
        this.ctx.paint.drawLine([y, this.drawY, y, this.drawY + this.visibleHeight], {
          borderColor: s,
          borderWidth: 1,
          lineDash: [4, 4],
          lineDashOffset: 0
        });
      }
      const w = Math.round(h - e + i / 2), C = o.isLastChild ? f : this.drawY + this.visibleHeight;
      this.ctx.paint.drawLine([w, this.drawY, w, C], {
        borderColor: s,
        borderWidth: 1,
        lineDash: [4, 4],
        lineDashOffset: 0
      });
      const E = Math.round(m + (r - 1) * e + i / 2);
      this.ctx.paint.drawLine([E, f, x, f], {
        borderColor: s,
        borderWidth: 1,
        lineDash: [4, 4],
        lineDashOffset: 0
      });
    }
    if (o.hasChildren && o.expand) {
      const w = c + d, C = this.drawY + this.visibleHeight;
      this.ctx.paint.drawLine([x, w, x, C], {
        borderColor: s,
        borderWidth: 1,
        lineDash: [4, 4],
        lineDashOffset: 0
      });
    }
  }
  updateContainer() {
    const {
      BODY_BG_COLOR: t,
      EDIT_BG_COLOR: e,
      BODY_CELL_STYLE_METHOD: i,
      FOOTER_CELL_STYLE_METHOD: s,
      READONLY_TEXT_COLOR: o,
      BODY_TEXT_COLOR: r,
      FOOTER_TEXT_COLOR: l,
      FOOTER_BG_COLOR: h,
      HIGHLIGHT_SELECTED_ROW: c,
      HIGHLIGHT_SELECTED_ROW_COLOR: u,
      HIGHLIGHT_HOVER_ROW: d,
      HIGHLIGHT_HOVER_ROW_COLOR: x,
      STRIPE: f,
      STRIPE_COLOR: m,
      FINDER_CELL_BG_COLOR: g
    } = this.ctx.config;
    if (this.cellType === "footer") {
      let I = h, O = l;
      if (typeof s == "function") {
        const D = s, { backgroundColor: H, color: A, font: k } = D({
          row: this.row,
          rowIndex: this.rowIndex,
          colIndex: this.colIndex,
          column: this.column,
          value: this.getValue()
        }) || {};
        H && (I = H), A && (O = A), k && (this.drawTextFont = k);
      }
      const { rowIndex: M, colIndex: L, type: S } = this.ctx.finderBar;
      M === this.rowIndex && L === this.colIndex && S === "footer" && (I = g), this.drawCellSkyBgColor = "transparent", this.drawCellBgColor = I, this.drawTextColor = O;
      return;
    }
    let w = "transparent";
    const C = this.ctx.hoverCell, E = this.ctx.currentCell;
    let b = this.rowIndex, p = this.rowIndex;
    if (this.rowspan !== 1 && (d || c)) {
      const I = this.getSpanInfo(), { yArr: O } = I;
      b = O[0], p = O[1];
    }
    d && C && !this.ctx.dragRowIng && (C.rowKey === this.rowKey && (w = x), C.rowIndex >= b && C.rowIndex <= p && (w = x)), c && E && !this.ctx.dragRowIng && (E.rowKey === this.rowKey && (w = u), E.rowIndex >= b && E.rowIndex <= p && (w = u)), this.drawCellSkyBgColor = w;
    let y = t, R = r;
    if (!this.ctx.database.getReadonly(this.rowKey, this.key) && !["index", "index-selection"].includes(this.type) && (y = e, R = o), f && (this.rowIndex % 2 ? y = m : y = t), typeof i == "function") {
      const I = i, { backgroundColor: O, color: M, font: L } = I({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        isHasChanged: this.isHasChanged,
        value: this.getValue()
      }) || {};
      O && (y = O), M && (R = M), L && (this.drawTextFont = L);
    }
    const { rowIndex: _, colIndex: T, type: v } = this.ctx.finderBar;
    _ === this.rowIndex && T === this.colIndex && v === "body" && (y = g), this.drawCellBgColor = y, this.drawTextColor = R;
  }
  updateSelection() {
    const { visibleWidth: t, visibleHeight: e, rowspan: i, colspan: s, cellType: o, type: r, rowIndex: l, rowKey: h } = this;
    if (i === 0 || s === 0 || o === "footer" || !["index-selection", "selection", "selection-tree", "tree-selection"].includes(r))
      return;
    const c = this.ctx.database.getRowSelectable(h), { CHECKBOX_SIZE: u = 0, CELL_PADDING: d } = this.ctx.config;
    let x = this.drawX + d;
    (this.align === "center" || this.align === "right") && (x = this.drawX + (t - u) / 2);
    let f = x, m = this.drawY + (e - u) / 2;
    if (r !== "selection-tree" && r === "tree-selection") {
      const { TREE_INDENT: p = 16, TREE_ICON_SIZE: y } = this.ctx.config, R = this.ctx.database.getRowForRowKey(h), { level: _ = 0 } = R || {}, T = _ * p;
      f = x + y + T;
    }
    let g = this.ctx.icons.get("checkbox-uncheck"), w = "checkbox-uncheck";
    if (r === "selection-tree" || r === "tree-selection") {
      const p = this.ctx.database.getTreeSelectionState(h);
      p.indeterminate && c ? (g = this.ctx.icons.get("checkbox-indeterminate"), w = "checkbox-indeterminate") : p.checked && c ? (g = this.ctx.icons.get("checkbox-check"), w = "checkbox-check") : !p.checked && c ? (g = this.ctx.icons.get("checkbox-uncheck"), w = "checkbox-uncheck") : (g = this.ctx.icons.get("checkbox-disabled"), w = "checkbox-disabled");
    } else {
      const p = this.ctx.database.getRowSelection(h);
      p && c ? (g = this.ctx.icons.get("checkbox-check"), w = "checkbox-check") : p && !c ? (g = this.ctx.icons.get("checkbox-check-disabled"), w = "checkbox-check-disabled") : !p && c ? (g = this.ctx.icons.get("checkbox-uncheck"), w = "checkbox-uncheck") : (g = this.ctx.icons.get("checkbox-disabled"), w = "checkbox-disabled");
    }
    const C = this.getImage("drag"), E = C ? C.width : 0;
    if (f += E, f + u + d > this.drawX + this.visibleWidth || m + u + d > this.drawY + this.visibleHeight)
      return;
    const b = new Z(w, f, m, u, u, g);
    if (r === "index-selection") {
      b.setVisible(!1), (this.ctx.hoverCell && this.ctx.hoverCell.rowIndex === l || ["checkbox-disabled", "checkbox-check"].includes(w)) && b.setVisible(!0);
      let p = this.rowIndex, y = this.rowIndex;
      const R = this.ctx.hoverCell, _ = this.getSpanInfo(), { yArr: T } = _;
      p = T[0], y = T[1], R && R.rowIndex >= p && R.rowIndex <= y && b.setVisible(!0);
    }
    this.setImage("selection", b);
  }
  updateHoverIcon() {
    if (this.ctx.database.getReadonly(this.rowKey, this.key))
      return;
    const { BODY_CELL_HOVER_ICON_METHOD: t, CELL_HOVER_ICON_SIZE: e, CELL_PADDING: i, ENABLE_MERGE_CELL_LINK: s } = this.ctx.config;
    if (typeof t == "function") {
      const r = t({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.getValue()
      });
      r !== void 0 && (this.hoverIconName = r);
    }
    const { hoverCell: o } = this.ctx;
    if (this.hoverIconName && !this.ctx.editing && !this.ctx.dragRowIng && o) {
      let r = 0, l = 0;
      if (o.rowKey === this.rowKey && (r = this.drawX + this.width - e - i, l = this.drawY + (this.height - e) / 2), this.rowspan !== 1 && s) {
        const u = this.getSpanInfo(), { yArr: d } = u, x = d[0], f = d[1];
        if (o.rowIndex >= x && o.rowIndex <= f) {
          const { width: m, height: g, offsetTop: w, offsetLeft: C } = u;
          r = this.drawX - C + m - e - i, l = this.drawY - w + (g - e) / 2;
        }
      }
      const h = this.ctx.icons.get(this.hoverIconName), c = new Z(this.hoverIconName, r, l, e, e, h);
      (this.rowspan === 0 || this.colspan === 0) && c.setVisible(!1), this.setImage("hover", c);
    }
  }
  /**
   * 获取自动高度
   * @returns
   */
  getAutoHeight() {
    if (this.cellType !== "body" || !this.autoRowHeight || this.rowspan === 0)
      return 0;
    if (this.render) {
      const r = this.ctx.database.getOverlayerAutoHeight(this.rowIndex, this.colIndex);
      return this.rowspan > 1 ? r < this.visibleHeight ? 0 : Math.round(r - (this.visibleHeight - this.height)) : Math.round(r);
    }
    if (!(this.displayText && typeof this.displayText == "string"))
      return 0;
    const { BODY_FONT: t, CELL_PADDING: e, CELL_LINE_HEIGHT: i } = this.ctx.config, s = `${this.displayText}_${this.drawTextWidth}_${this.drawTextFont}`, o = this.ctx.paint.calculateTextHeight(this.displayText, this.drawTextWidth, {
      font: this.drawTextFont || t,
      padding: e,
      align: this.align,
      verticalAlign: this.verticalAlign,
      color: this.drawTextColor,
      autoRowHeight: this.autoRowHeight,
      lineHeight: i,
      maxLineClamp: this.maxLineClamp,
      cacheTextKey: s
    });
    return this.rowspan > 1 ? o < this.visibleHeight ? 0 : Math.round(o - (this.visibleHeight - this.height)) : Math.round(o);
  }
  // 过去跨度配置
  getSpanInfo() {
    return this.ctx.database.getSpanInfo(this);
  }
  /**
   * 获取显示文本
   * @returns
   */
  getDisplayText(t = this.text) {
    if (this.cellType === "footer")
      return this.renderFooter && this.renderFooterType === "default" || t == null ? "" : `${t}`;
    {
      if (this.rowspan === 0 || this.colspan === 0 || this.render && this.renderType === "default" && !this.mixedRender)
        return "";
      const e = this.getImage("selection");
      return this.type === "index-selection" && e && e.visible || t == null ? "" : `${t}`;
    }
  }
  /**
   * 获取文本
   * @returns
   */
  getText() {
    if (this.cellType === "footer")
      return typeof this.formatterFooter == "function" ? this.formatterFooter({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.row[this.key]
      }) : this.row[this.key];
    if (typeof this.formatter == "function")
      return this.formatter({
        row: this.row,
        rowIndex: this.rowIndex,
        colIndex: this.colIndex,
        column: this.column,
        value: this.getValue()
      });
    const { BODY_CELL_FORMATTER_METHOD: t } = this.ctx.config;
    return typeof t == "function" ? t({
      row: this.row,
      rowIndex: this.rowIndex,
      colIndex: this.colIndex,
      column: this.column,
      value: this.getValue()
    }) : ["index-selection", "index"].includes(this.type) ? `${this.rowIndex + 1}` : (this.value = this.ctx.database.getItemValue(this.rowKey, this.key), this.value);
  }
  getFinderText() {
    const t = this.getDisplayText(this.getText()), e = this.cellType === "footer" ? this.formatterFinderFooterValue : this.formatterFinderValue;
    if (typeof e != "function")
      return t;
    const i = e({
      row: this.row,
      rowIndex: this.rowIndex,
      colIndex: this.colIndex,
      column: this.column,
      value: this.cellType === "footer" ? this.row[this.key] : this.getValue(),
      displayText: t
    });
    return i == null ? t : `${i}`;
  }
  getValue() {
    return this.ctx.database.getItemValue(this.rowKey, this.key);
  }
  // 拓展格子可设置数据
  setValue(t) {
    this.ctx.setItemValueByEditor(this.rowKey, this.key, t);
  }
  /**
   * 获取样式
   */
  getOverlayerViewsStyle() {
    let t = this.drawX - this.ctx.fixedLeftWidth, e = this.drawY - this.ctx.body.y;
    if (this.fixed === "left" ? t = this.drawX : this.fixed === "right" && (t = this.drawX - (this.ctx.stageWidth - this.ctx.fixedRightWidth)), this.cellType === "footer" && this.ctx.config.FOOTER_FIXED && (e = this.drawY - this.ctx.footer.y), this.autoRowHeight && this.render && this.verticalAlign === "middle") {
      const s = this.ctx.database.getOverlayerAutoHeight(this.rowIndex, this.colIndex);
      if (s < this.visibleHeight && s > 0) {
        const o = (this.visibleHeight - s) / 2;
        e = e + o;
      }
    }
    this.autoRowHeight && this.ctx.database.getOverlayerAutoHeight(this.rowIndex, this.colIndex) === 0 && (t = -99999, e = -99999);
    let i = {};
    return this.rowspan === 0 && (i = {
      display: "none"
    }), {
      position: "absolute",
      overflow: "hidden",
      left: `${Math.round(t - 1)}px`,
      top: `${Math.round(e - 1)}px`,
      width: `${this.visibleWidth}px`,
      height: this.autoRowHeight && this.renderType === "default" ? "auto" : `${this.visibleHeight}px`,
      // height: `${this.visibleHeight}px`,
      // minHeight: `${this.visibleHeight}px`,
      pointerEvents: "initial",
      userSelect: "none",
      ...i
    };
  }
  drawContainer() {
    const { paint: t, config: e } = this.ctx, { BORDER: i } = e, { drawX: s, drawY: o } = this, r = dt(i) ? e.BORDER_COLOR : void 0;
    t.drawRect(s, o, this.visibleWidth, this.visibleHeight, {
      borderColor: r,
      fillColor: this.drawCellBgColor
    }), t.drawRect(s, o, this.width, this.height, {
      fillColor: this.drawCellSkyBgColor
    });
  }
  drawHorizontalBorder() {
    const { config: t } = this.ctx, { BORDER: e } = t;
    if (!Dt(e) || this.cellType !== "footer" && dt(e))
      return;
    const { drawX: i, drawY: s } = this, o = t.BORDER_COLOR;
    this.ctx.paint.drawLine(
      [i, s + this.visibleHeight, i + this.visibleWidth, s + this.visibleHeight],
      {
        borderColor: o,
        fillColor: o,
        borderWidth: 1,
        lineCap: "round",
        lineJoin: "round"
      }
    );
  }
  drawAutofillPiont() {
    if (this.cellType === "footer")
      return;
    const { SELECT_BORDER_COLOR: t, ENABLE_AUTOFILL: e, ENABLE_SELECTOR: i, AUTOFILL_POINT_BORDER_COLOR: s } = this.ctx.config;
    if (!i || !e || this.ctx.editing)
      return;
    const { xArr: o, yArr: r } = this.ctx.selector, l = o[1], h = r[1], { colIndex: c, rowIndex: u, drawX: d, drawY: x } = this;
    if (c === l && u === h) {
      const f = c === this.ctx.maxColIndex || u === this.ctx.maxRowIndex || c === this.ctx.lastCenterColIndex ? 6 : 4;
      this.ctx.paint.drawRect(d + this.width - f, x + this.height - f, 6, 6, {
        borderColor: s,
        fillColor: t
      });
    }
  }
  draw() {
    this.drawTreeLine(), this.drawText(), this.drawImage(), this.drawSelector(), this.drawAutofillPiont(), this.drawErrorTip();
  }
  /**
   * 根据列的索引获取列的宽度
   * @param {Number} colIndex
   */
  getWidthByColIndexColSpan(t, e) {
    if (e === 0)
      return 0;
    let i = 0;
    for (let s = t; s < t + e; s++) {
      const o = this.ctx.header.leafCellHeaders[s];
      i += o.width;
    }
    return i;
  }
  drawText() {
    const { CELL_PADDING: t, BODY_FONT: e, PLACEHOLDER_COLOR: i, CELL_LINE_HEIGHT: s } = this.ctx.config, { placeholder: o } = this.column;
    let r = this.displayText, l = this.drawTextColor;
    if (!this.ctx.database.getReadonly(this.rowKey, this.key) && o && ["", null, void 0].includes(this.text) && this.cellType === "body" && !(this.rowspan === 0 || this.colspan === 0) && (r = o, l = i), ["", null, void 0].includes(r))
      return !1;
    typeof r != "string" && (r = `${r}`);
    const h = `${r}_${this.drawTextWidth}_${this.drawTextFont}`;
    return this.ellipsis = this.ctx.paint.drawText(
      r,
      this.drawTextX,
      this.drawTextY,
      this.drawTextWidth,
      this.drawTextHeight,
      {
        font: this.drawTextFont || e,
        padding: t,
        align: this.align,
        verticalAlign: this.verticalAlign,
        color: l,
        autoRowHeight: this.autoRowHeight,
        lineHeight: s,
        maxLineClamp: this.maxLineClamp,
        cacheTextKey: h,
        layoutCallback: (c) => {
          this.ctx.emit(
            "registerTextLayout",
            `${this.cellType}-${this.rowIndex}-${this.colIndex}`,
            c
          );
        }
      }
    ), this.ellipsis;
  }
  drawImage() {
    this.getImages().forEach((t, e) => {
      if (t.visible && t.source) {
        if (e === "hover") {
          const { CELL_HOVER_ICON_BG_COLOR: i, CELL_HOVER_ICON_BORDER_COLOR: s } = this.ctx.config;
          t.drawWrapper(this.ctx, {
            borderColor: s,
            fillColor: i
          });
        }
        this.ctx.paint.drawImage(
          t.source,
          t.x,
          t.y,
          t.width,
          t.height
        );
      }
    });
  }
  drawSelector() {
    if (this.cellType === "footer")
      return;
    const { ENABLE_SELECTOR: t } = this.ctx.config;
    if (!t)
      return;
    const { xArr: e, yArr: i, xArrCopy: s, yArrCopy: o } = this.ctx.selector;
    this.drawBorder({
      xArr: s,
      yArr: o,
      borderColor: this.ctx.config.SELECT_BORDER_COLOR || "rgb(82,146,247)",
      fillColor: "transparent",
      borderWidth: 1,
      lineDash: [4, 4]
    }), this.drawBorder({
      xArr: this.ctx.autofill.xArr,
      yArr: this.ctx.autofill.yArr,
      borderColor: this.ctx.config.SELECT_BORDER_COLOR || "rgb(82,146,247)",
      fillColor: "transparent",
      borderWidth: 1,
      lineDash: [4, 4]
    }), this.drawBorder({
      xArr: e,
      yArr: i,
      borderColor: this.ctx.config.SELECT_BORDER_COLOR || "rgb(82,146,247)",
      fillColor: "transparent",
      borderWidth: 1
    });
    const [r, l] = e, [h, c] = i;
    !(r === l && h === c) && this.colIndex >= r && this.colIndex <= l && this.rowIndex >= h && this.rowIndex <= c && this.ctx.paint.drawRect(this.drawX, this.drawY, this.width, this.height, {
      borderColor: "transparent",
      fillColor: this.ctx.config.SELECT_AREA_COLOR || "rgba(82,146,247,0.1)"
    }), this.operation && this.rowIndex >= h && this.rowIndex <= c && this.ctx.paint.drawRect(this.drawX, this.drawY, this.visibleWidth, this.visibleHeight, {
      borderColor: "transparent",
      fillColor: this.ctx.config.SELECT_ROW_COL_BG_COLOR || "transparent"
    });
  }
  drawErrorTip() {
    if (this.cellType === "footer" || !this.message || this.rowspan === 0 || this.colspan === 0)
      return;
    const { ERROR_TIP_ICON_SIZE: t, ERROR_TIP_COLOR: e } = this.ctx.config, { width: i } = this, s = this.drawX, o = this.drawY, r = [
      s + i - t - 0.5,
      o,
      s + i - 0.5,
      o,
      s + i - 0.5,
      o + t
    ];
    this.ctx.paint.drawLine(r, {
      borderColor: e,
      fillColor: e,
      borderWidth: 1,
      lineCap: "round",
      lineJoin: "round"
    });
  }
  drawBorder(t) {
    const { drawX: e, drawY: i, rowIndex: s, colIndex: o, height: r, width: l } = this;
    let h = e, c = i;
    const { xArr: u, yArr: d, lineDash: x = [], borderWidth: f = 1, borderColor: m, fillColor: g } = t, w = u[0], C = u[1], E = d[0], b = d[1];
    if (o >= w && o <= C && s === E) {
      const p = o === C ? 1 : 0, y = o === w ? 1 : 0;
      this.ctx.paint.drawLine([h + y, c + 1, h + l - p, c + 1], {
        borderColor: m,
        fillColor: g,
        borderWidth: f,
        lineCap: "round",
        lineJoin: "round",
        lineDash: x
      });
    }
    if (o === C && s >= E && s <= b) {
      const p = s === E ? 1 : 0, y = s === b ? 1 : 0;
      this.ctx.paint.drawLine([h + l - 1, c + p, h + l - 1, c + r - y], {
        borderColor: m,
        fillColor: g,
        borderWidth: f,
        lineCap: "round",
        lineJoin: "round",
        lineDash: x
      });
    }
    if (o >= w && o <= C && s === b) {
      const p = o === C ? 1 : 0, y = o === w ? 1 : 0;
      this.ctx.paint.drawLine([h + y, c + r - 1, h + l - p, c + r - 1], {
        borderColor: m,
        fillColor: g,
        borderWidth: f,
        lineCap: "round",
        lineJoin: "round",
        lineDash: x
      });
    }
    if (o === w && s >= E && s <= b) {
      const p = s === b ? 1 : 0, y = s === E ? 1 : 0;
      this.ctx.paint.drawLine([h + 1, c + y, h + 1, c + r - p], {
        borderColor: m,
        fillColor: g,
        borderWidth: f,
        lineCap: "round",
        lineJoin: "round",
        lineDash: x
      });
    }
  }
}
class je {
  constructor(t, e) {
    n(this, "ctx"), n(this, "data"), n(this, "columns"), n(this, "footerData", []), n(this, "rowKeyMap", /* @__PURE__ */ new Map()), n(this, "colIndexKeyMap", /* @__PURE__ */ new Map()), n(this, "headerMap", /* @__PURE__ */ new Map()), n(this, "rowIndexRowKeyMap", /* @__PURE__ */ new Map()), n(this, "rowKeyRowIndexMap", /* @__PURE__ */ new Map()), n(this, "checkboxKeyMap", /* @__PURE__ */ new Map()), n(this, "selectionMap", /* @__PURE__ */ new Map()), n(this, "expandMap", /* @__PURE__ */ new Map()), n(this, "originalDataMap", /* @__PURE__ */ new Map()), n(this, "changedDataMap", /* @__PURE__ */ new Map()), n(this, "validationErrorMap", /* @__PURE__ */ new Map()), n(this, "itemRowKeyMap", /* @__PURE__ */ new WeakMap()), n(this, "bufferData", []), n(this, "customHeader", {
      fixedData: {},
      sortData: {},
      hideData: {},
      resizableData: {}
    }), n(this, "overlayerAutoHeightMap", /* @__PURE__ */ new Map()), n(this, "maxRowHeightCellMap", /* @__PURE__ */ new Map()), n(this, "bufferCheckState", {
      buffer: !1,
      check: !1,
      indeterminate: !1,
      selectable: !0
    }), n(this, "sumHeight", 0), n(this, "filterMethod"), n(this, "positions", []), n(this, "sortState", /* @__PURE__ */ new Map()), this.ctx = t;
    const { data: i = [], columns: s = [], footerData: o = [] } = e;
    this.data = i, this.footerData = o, this.columns = s, this.init();
  }
  // 初始化默认不忽略清空改变值和校验map
  init(t = !0) {
    this.ctx.paint.clearTextCache(), this.clearBufferData(), this.rowKeyMap.clear(), this.checkboxKeyMap.clear(), this.colIndexKeyMap.clear(), this.rowIndexRowKeyMap.clear(), this.rowKeyRowIndexMap.clear(), this.maxRowHeightCellMap.clear();
    const e = this.getColumns(), i = it(e);
    if (this.ctx.hasSelection = i.some((s) => s.type === "selection"), this.ctx.hasTree = i.some((s) => {
      var o;
      return (o = s.type) == null ? void 0 : o.includes("tree");
    }), t) {
      this.originalDataMap.clear(), this.changedDataMap.clear(), this.validationErrorMap.clear();
      const { ROW_KEY: s } = this.ctx.config;
      s ? (this.ctx.hasSelection || this.selectionMap.clear(), this.ctx.hasTree || this.expandMap.clear()) : (this.selectionMap.clear(), this.expandMap.clear());
    }
    this.itemRowKeyMap = /* @__PURE__ */ new WeakMap(), this.initData(this.data), this.getData(), this.bufferCheckState.buffer = !1;
  }
  /**
   * 清除缓存数据
   */
  clearBufferData() {
    this.bufferData = [];
  }
  /**
   * 解析行唯一标识，统一转为 string
   */
  resolveRowKey(t, e = "") {
    let i;
    return typeof e == "function" ? i = e(t) : e && (i = t[e]), i != null ? String(i) : oe();
  }
  /**
   * 初始化数据
   * @param dataList
   * @param level
   */
  initData(t, e = 0, i = []) {
    const s = t.length, {
      ROW_KEY: o = "",
      DEFAULT_EXPAND_ALL: r,
      CELL_HEIGHT: l,
      SELECTABLE_METHOD: h,
      CHECKBOX_KEY: c,
      TREE_CHILDREN_KEY: u
    } = this.ctx.config;
    t.forEach((d, x) => {
      var f;
      u !== "children" && (d.children = d[u]);
      const m = this.resolveRowKey(d, o);
      this.itemRowKeyMap.set(d, m);
      const g = d._height || l, w = d._readonly;
      let C = !0;
      if (typeof h == "function" && (C = h), c) {
        const b = d[c];
        if (this.checkboxKeyMap.has(b)) {
          const p = this.checkboxKeyMap.get(b) || [];
          p.push(m), this.checkboxKeyMap.set(b, p);
        } else
          this.checkboxKeyMap.set(b, [m]);
      }
      this.selectionMap.set(m, {
        key: c ? d[c] : m,
        row: d,
        check: ((f = this.selectionMap.get(m)) == null ? void 0 : f.check) || !1
      });
      const E = r || this.expandMap.get(m) || d._expand || !1;
      this.expandMap.set(m, E), this.rowKeyMap.set(m, {
        readonly: w,
        index: x,
        rowIndex: x,
        level: e,
        height: g,
        calculatedHeight: -1,
        check: !1,
        selectable: C,
        expand: E,
        expandLazy: !1,
        hasChildren: d._hasChildren || (Array.isArray(d.children) ? d.children.length > 0 : !1),
        expandLoading: !1,
        item: d,
        parentRowKeys: i,
        parentRowKey: i[i.length - 1] || "",
        isLastChild: x === s - 1
      }), Array.isArray(d.children) && d.children.length && this.initData(d.children, e + 1, [...i, m]);
    });
  }
  /**
   *
   * @param rowKey 设置Row高度
   * @param height
   */
  setRowHeight(t, e) {
    const i = this.rowIndexRowKeyMap.get(t);
    if (i === void 0)
      return;
    const s = this.rowKeyMap.get(i);
    s.height = e, s.item._height = e, this.clearBufferData();
  }
  // 批量设置行高度
  setBatchRowHeight(t) {
    t.forEach(({ rowIndex: e, height: i }) => {
      const s = this.rowIndexRowKeyMap.get(e);
      if (s) {
        const o = this.rowKeyMap.get(s);
        o.height = i, o.item._height = i;
      }
    }), this.clearBufferData();
  }
  // 批量设置计算行高度
  setBatchCalculatedRowHeight(t) {
    return t.every(({ height: e, rowIndex: i }) => this.getPositionForRowIndex(i).calculatedHeight === e) ? !1 : (t.forEach(({ rowIndex: e, height: i }) => {
      const s = this.rowIndexRowKeyMap.get(e);
      if (s) {
        const o = this.rowKeyMap.get(s), { height: r = -1 } = this.getMaxRowHeightItem(s) || {};
        o.calculatedHeight = Math.max(i, r);
      }
    }), this.clearBufferData(), this.getData(), !0);
  }
  /**
   * 获取所有行数据（平铺）
   * @returns 获取转化平铺数据
   */
  getAllRowsData() {
    let t = [];
    const e = (i) => {
      i.forEach((s) => {
        t.push(s), Array.isArray(s.children) && e(s.children);
      });
    };
    return e(this.data), t;
  }
  generateColumns(t) {
    const e = (i) => i.map((s) => {
      var o, r, l, h, c, u, d, x;
      const f = s.children && Array.isArray(s.children) ? e(s.children) : void 0, m = {
        hide: (r = (o = this.customHeader) == null ? void 0 : o.hideData) == null ? void 0 : r[s.key],
        fixed: (h = (l = this.customHeader) == null ? void 0 : l.fixedData) == null ? void 0 : h[s.key],
        sort: (u = (c = this.customHeader) == null ? void 0 : c.sortData) == null ? void 0 : u[s.key],
        width: (x = (d = this.customHeader) == null ? void 0 : d.resizableData) == null ? void 0 : x[s.key]
      }, g = {};
      for (const [C, E] of Object.entries(m))
        E !== void 0 && (g[C] = E);
      const w = f && f.every((C) => C.hide);
      return {
        ...s,
        children: f,
        hide: w || (typeof s.hide == "function" ? s.hide(s) : s.hide),
        ...g
      };
    });
    return e(t);
  }
  getColumns() {
    return this.generateColumns(this.columns);
  }
  setColumns(t) {
    this.columns = t, this.clearBufferData();
  }
  setData(t) {
    this.data = t, this.init();
  }
  getOriginalData() {
    return this.data;
  }
  /**
   * 统一转化数据，给画body使用，包括过滤树状等，统一入口
   * @returns
   */
  getData() {
    if (this.bufferData.length > 0)
      return {
        data: this.bufferData,
        sumHeight: this.sumHeight,
        positions: this.positions
      };
    let t = [], e = 0;
    this.sumHeight = 0, this.positions = [];
    const i = (o) => {
      o?.forEach((r) => {
        t.push(r);
        const l = this.itemRowKeyMap.get(r), { expand: h, hasChildren: c, height: u, calculatedHeight: d } = this.rowKeyMap.get(l), x = this.sumHeight, f = Math.max(d, u);
        this.sumHeight += f, this.rowIndexRowKeyMap.set(e, l), this.rowKeyRowIndexMap.set(l, e), this.positions.push({
          top: x,
          height: f,
          bottom: this.sumHeight,
          calculatedHeight: d
        }), e += 1, h && c && i(r.children);
      });
    };
    this.rowIndexRowKeyMap.clear(), this.rowKeyRowIndexMap.clear();
    let s = this.data;
    if (typeof this.filterMethod == "function" && (s = this.filterMethod(s)), this.sortState.size) {
      const o = Array.from(this.sortState.entries()).sort((r, l) => r[1].timestamp - l[1].timestamp);
      s = this.sortDataRecursive(s, o);
    }
    return i(s), this.bufferData = t, {
      data: t,
      sumHeight: this.sumHeight,
      positions: this.positions
    };
  }
  setFooterData(t) {
    this.footerData = t;
  }
  getFooterData() {
    return this.footerData;
  }
  /**
   * 设置过滤方法
   */
  setFilterMethod(t) {
    this.filterMethod = t;
  }
  /**
   * 清空过滤方法
   */
  clearFilterMethod() {
    this.filterMethod = void 0;
  }
  /**
   * 获取排序状态
   */
  getSortState(t) {
    return this.sortState.get(t) || { direction: "none", timestamp: 0 };
  }
  /**
   * 设置排序状态
   */
  setSortState(t, e) {
    const i = Date.now();
    this.ctx.config.SORT_STRICTLY && this.sortState.clear(), e === "none" ? this.sortState.delete(t) : this.sortState.set(t, { direction: e, timestamp: i }), this.ctx.emit("sortChange", this.sortState), this.clearBufferData(), this.ctx.emit("draw");
  }
  /**
   * 清除所有排序状态
   */
  clearSort() {
    this.sortState.clear(), this.ctx.emit("sortChange", this.sortState), this.clearBufferData(), this.ctx.emit("draw");
  }
  /**
   * 递归排序方法，支持树形数据
   * @param data 要排序的数据
   * @param sortedEntries 排序条目，按时间戳排序
   * @returns 排序后的数据
   */
  sortDataRecursive(t, e) {
    let i = [...t];
    for (const [s, { direction: o }] of e) {
      if (o === "none") continue;
      const r = this.getColumnByKey(s);
      !r || !r.column.sortBy || (i = this.applySingleColumnSort(i, s, o, r.column.sortBy));
    }
    return i.map((s) => (s.children && Array.isArray(s.children) && (s.children = this.sortDataRecursive(s.children, e)), s));
  }
  /**
   * 对数组进行单列排序
   * @param data 要排序的数据
   * @param key 排序的列键
   * @param direction 排序方向
   * @param sortBy 排序类型
   * @returns 排序后的数据
   */
  applySingleColumnSort(t, e, i, s) {
    return t.sort((o, r) => {
      const l = o[e], h = r[e];
      let c = 0;
      if (typeof s == "function")
        c = s(o, r);
      else if (s === "number") {
        const u = Number(l) || 0, d = Number(h) || 0;
        c = u - d;
      } else if (s === "string") {
        const u = String(l || ""), d = String(h || "");
        c = u.localeCompare(d);
      } else s === "date" && (c = Be(l, h));
      return i === "asc" ? c : -c;
    });
  }
  /**
   * 根据rowKey,控制指定展开行
   * @param rowKey
   * @param expand
   */
  expandItem(t, e = !1) {
    const i = this.rowKeyMap.get(t);
    i.expand = e, this.expandMap.set(t, e), this.clearBufferData(), this.ctx.emit("draw");
  }
  setExpandRowKeys(t, e = !0) {
    this.expandMap.clear(), t.forEach((i) => {
      const s = this.rowKeyMap.get(i);
      this.expandMap.set(i, e), s.expand = e;
    }), this.clearBufferData(), this.ctx.emit("draw");
  }
  getExpandRowKeys() {
    let t = [];
    return this.rowKeyMap.forEach((e, i) => {
      e.expand && t.push(i);
    }), t;
  }
  expandAll(t) {
    this.expandMap.clear(), this.rowKeyMap.forEach((e, i) => {
      e.expand = t, this.expandMap.set(i, t);
    }), this.clearBufferData(), this.ctx.emit("draw");
  }
  expandLoading(t, e = !1) {
    const i = this.rowKeyMap.get(t);
    i.expandLoading = e, this.clearBufferData(), this.ctx.emit("draw");
  }
  setExpandChildren(t, e) {
    const i = this.rowKeyMap.get(t);
    i.expand = !0, this.expandMap.set(t, !0), i.expandLazy = !0, i.item.children = e, this.initData(i.item.children, i.level + 1), this.clearBufferData();
  }
  getIsExpandLoading(t) {
    return this.rowKeyMap.get(t).expandLoading;
  }
  getIsExpandLazy(t) {
    return this.rowKeyMap.get(t).expandLazy;
  }
  /**
   * 根据rowKey获取是否展开
   * @param rowKey
   * @returns
   */
  getIsExpand(t) {
    return this.rowKeyMap.get(t).expand;
  }
  /**
   * 根据rowKey获取行数据
   * @param rowKey
   * @returns
   */
  getRowForRowKey(t) {
    return this.rowKeyMap.get(t);
  }
  getRowForRowIndex(t) {
    const e = this.getRowKeyForRowIndex(t);
    return this.rowKeyMap.get(e);
  }
  /**
   * 根据rowIndex获取rowKey
   * @param rowKey
   * @returns
   */
  getRowKeyForRowIndex(t) {
    return this.rowIndexRowKeyMap.get(t) || "";
  }
  getRowKeyByItem(t) {
    return this.itemRowKeyMap.get(t);
  }
  getRowIndexForRowKey(t) {
    return this.rowKeyRowIndexMap.get(t);
  }
  /**
   * 根据rowIndex和colIndex获取单元格数据
   * @param rowIndex
   * @param colIndex
   * @returns
   */
  getItemValueForRowIndexAndColIndex(t, e) {
    if (!(this.rowIndexRowKeyMap.has(t) && this.colIndexKeyMap.get(e)))
      return null;
    const i = this.rowIndexRowKeyMap.get(t), s = this.colIndexKeyMap.get(e);
    return i === void 0 || s === void 0 ? null : {
      rowKey: i,
      key: s,
      value: this.getItemValue(i, s)
    };
  }
  /**
   * 根据rowKey和key获取单元格数据
   * @param rowKey
   * @param key
   * @returns
   */
  getItemValue(t, e) {
    const i = this.rowKeyMap.get(t);
    return i && i.item ? i.item[e] === void 0 ? null : i.item[e] : null;
  }
  /**
   * 批量设置数据
   * @param list
   * @param history
   * @returns
   */
  async batchSetItemValue(t, e = !1, i = !0, s = "none") {
    var o;
    let r = [], l = i;
    const h = /* @__PURE__ */ new Map(), c = [];
    let u = [];
    for (const g of t) {
      const { rowKey: w, key: C } = g;
      let E = g.value;
      const b = this.getRowDataItemForRowKey(w), p = this.getItemValue(w, C), y = this.getVirtualBodyCellByKey(w, C), R = {
        ...g,
        oldValue: p,
        row: b
      };
      if (y?.type === "number")
        if (["", void 0, null].includes(E))
          E = null;
        else if (/^-?\d+(\.\d+)?$/.test(String(E))) {
          const _ = Ke(E);
          if (typeof y.precision == "number" && y.precision >= 0 && _ > y.precision) {
            const T = 10 ** y.precision;
            E = Math.round(Number(E) * T) / T;
            const v = this.ctx.locale.getText("numberTruncated", { precision: y.precision });
            c.push({
              ...R,
              column: y?.column,
              code: "ERR_NUMBER_PRECISION",
              message: v
            });
          } else if (typeof y.min == "number" && Number(E) < y.min) {
            const T = this.ctx.locale.getText("numberMin", { min: y.min });
            E = y.min, c.push({
              ...R,
              column: y?.column,
              code: "ERR_NUMBER_MIN",
              message: T
            });
          } else if (typeof y.max == "number" && Number(E) > y.max) {
            const T = this.ctx.locale.getText("numberMax", { max: y.max });
            E = y.max, c.push({
              ...R,
              column: y?.column,
              code: "ERR_NUMBER_MAX",
              message: T
            });
          } else
            E = Number(E);
        } else
          E = p, c.push({
            ...R,
            column: y?.column,
            code: "ERR_INVALID_NUMBER",
            message: this.ctx.locale.getText("invalidNumber")
          });
      else if (y?.editorType === "text" && typeof y.maxlength == "number" && String(E).length > y.maxlength) {
        E = String(E).slice(0, y.maxlength);
        const _ = this.ctx.locale.getText("stringMaxlength", { maxlength: y.maxlength });
        c.push({
          ...R,
          column: y?.column,
          code: "ERR_STRING_MAXLENGTH",
          message: _
        });
      }
      typeof ((o = y?.column) == null ? void 0 : o.canValueChange) == "function" && (await y.column.canValueChange({
        ...R,
        value: E
      }) || (E = p)), E !== p && u.push({
        ...g,
        value: E,
        oldValue: p,
        row: b
      });
    }
    if (c.length) {
      const g = {
        code: "ERR_BATCH_SET_ITEM_VALUE",
        message: this.ctx.locale.getText("batchSetItemValueError"),
        data: c
      };
      this.ctx.emit("error", g);
    }
    if (!u.length)
      return;
    const { BEFORE_VALUE_CHANGE_METHOD: d } = this.ctx.config;
    s === "none" && typeof d == "function" && (u = await d(u), l = !1);
    const x = [];
    u.forEach((g) => {
      const { value: w, rowKey: C, key: E, row: b } = g, p = this.getItemValue(C, E);
      h.set(C, b), this.setItemValue(C, E, w, !1, !1, !1, l), x.push(this.getValidator(g.rowKey, g.key)), r.push({
        rowKey: C,
        key: E,
        oldValue: p,
        newValue: w
      });
    });
    const f = Array.from(h.values());
    await Promise.all(x), this.validationErrorMap.size === 0 && this.changedDataMap.size > 0 && this.ctx.emit("validateChangedData", this.getChangedData());
    const m = u.map((g) => {
      var w;
      const C = !!this.getValidationError(g.rowKey, g.key).length, { rowKey: E, key: b } = g, p = this.getVirtualBodyCellByKey(E, b);
      return typeof ((w = p?.column) == null ? void 0 : w.valueChange) == "function" && p.column.valueChange({
        ...g,
        errorTip: C
      }), {
        ...g,
        errorTip: C
      };
    });
    this.ctx.emit("change", m, f), e && this.ctx.history.pushState({
      changeList: r,
      scrollX: this.ctx.scrollX,
      scrollY: this.ctx.scrollY,
      type: "multiple"
    }), this.ctx.emit("draw");
  }
  /**
   *设置单一数据
   * @param rowKey
   * @param key
   * @param value
   * @param history 是否添加历史记录
   * @param reDraw 是否刷新重绘
   * @param isEditor 是否是编辑器
   * @param checkReadonly 是否检查只读
   * @returns
   */
  async setItemValue(t, e, i, s = !1, o = !1, r = !1, l = !0) {
    if (!this.rowKeyMap.has(t))
      return {};
    const { item: h } = this.rowKeyMap.get(t);
    let c = h[e], u = i;
    if (l && this.ctx.database.getReadonly(t, e))
      return {
        oldValue: c,
        newValue: c
      };
    h[e] !== null && typeof h[e] == "object" && (c = JSON.parse(JSON.stringify(h[e])));
    const d = `${t}​_${e}`;
    this.originalDataMap.has(d) || this.originalDataMap.set(d, c);
    const x = this.originalDataMap.get(d), f = this.getRowDataItemForRowKey(t), m = {
      rowKey: t,
      key: e,
      value: u,
      oldValue: c,
      row: f
    };
    if (r) {
      if (u === c)
        return {
          oldValue: c,
          newValue: c
        };
      this.batchSetItemValue([m], s, !1), this.ctx.emit("editChange", {
        ...m,
        originalValue: x
      });
    } else
      this.changedDataMap.set(d, u), h[e] = u;
    return this.ctx.hasEvent("iterationChange") && this.ctx.emit("iterationChange", {
      ...m,
      originalValue: x
    }), o && this.ctx.emit("draw"), {
      oldValue: c,
      newValue: u
    };
  }
  /**
   * 根据rowKey 获取行数据
   * @param rowKey
   * @returns
   */
  getRowDataItemForRowKey(t) {
    if (!this.rowKeyMap.has(t))
      return {};
    const { item: e } = this.rowKeyMap.get(t);
    return e;
  }
  /**
   *
   * @param rowKey 设置选中状态ByCheckboxKey，用于合并Checkbox单元格时声明唯一key
   * @param check
   */
  setRowSelectionByCheckboxKey(t, e) {
    const { CHECKBOX_KEY: i } = this.ctx.config;
    if (i) {
      if (!this.rowKeyMap.has(t))
        return !1;
      const { item: s } = this.rowKeyMap.get(t), o = s[i];
      this.checkboxKeyMap.has(o) && (this.checkboxKeyMap.get(o) || []).forEach((r) => {
        const l = this.selectionMap.get(r);
        l && (l.check = e);
      });
    }
  }
  /**
   * 根据rowKey 取反选中
   * @param rowKey
   */
  toggleRowSelection(t, e) {
    const i = this.rowKeyMap.get(t), s = this.selectionMap.get(t);
    if (!s)
      return;
    e === "selection-tree" || e === "tree-selection" ? this.toggleTreeSelection(t) : (s.check = !s.check, this.setRowSelectionByCheckboxKey(t, s.check)), this.ctx.emit("toggleRowSelection", i);
    const o = this.getSelectionRows();
    this.ctx.emit("selectionChange", o), this.bufferCheckState.buffer = !1, this.ctx.emit("draw");
  }
  // 切换树形选择状态
  toggleTreeSelection(t) {
    const e = this.getTreeSelectionState(t), i = this.ctx.config.TREE_SELECT_MODE;
    if (i === "auto")
      e.checked && !e.indeterminate ? (this.clearTreeSelectionRecursive(t), this.setRowSelection(t, !1, !1)) : (this.selectTreeSelectionRecursive(t), this.setRowSelection(t, !0, !1));
    else if (i === "cautious")
      e.checked && !e.indeterminate ? (this.clearTreeSelectionRecursive(t), this.setRowSelection(t, !1, !1)) : (this.selectTreeSelectionRecursive(t), this.setRowSelection(t, !0, !1));
    else if (i === "strictly") {
      const s = this.selectionMap.get(t);
      s && (s.check = !s.check, this.setRowSelectionByCheckboxKey(t, s.check));
    }
    this.ctx.emit("selectionChange", this.getSelectionRows()), this.ctx.emit("draw");
  }
  // 递归选中树形选择
  selectTreeSelectionRecursive(t) {
    this.getTreeChildren(t).forEach((e) => {
      this.setRowSelectionByParent(e, !0), this.selectTreeSelectionRecursive(e);
    });
  }
  // 递归取消树形选择
  clearTreeSelectionRecursive(t) {
    this.getTreeChildren(t).forEach((e) => {
      this.setRowSelectionByParent(e, !1), this.clearTreeSelectionRecursive(e);
    });
  }
  // 向上递归更新父项状态
  updateParentTreeSelection(t) {
    const e = this.getTreeParent(t);
    if (!e)
      return;
    const i = this.getTreeChildren(e).map((h) => this.selectionMap.get(h)), s = i.filter((h) => h?.check).length, o = i.length;
    let r = !1;
    o > 0 && (s === 0 ? r = !1 : s === o || this.ctx.config.TREE_SELECT_MODE === "auto" ? r = !0 : this.ctx.config.TREE_SELECT_MODE === "cautious" && (r = !1));
    const l = this.selectionMap.get(e);
    l && l.check !== r && (l.check = r, this.setRowSelectionByCheckboxKey(e, r), this.updateParentTreeSelection(e));
  }
  /**
   * 根据rowKey 设置选中状态
   * @param rowKey
   */
  setRowSelection(t, e, i = !0) {
    const s = this.selectionMap.get(t);
    s && (s.check = e, this.setRowSelectionByCheckboxKey(t, s.check), this.ctx.emit("setRowSelection", e, s.row), (this.ctx.config.TREE_SELECT_MODE === "auto" || this.ctx.config.TREE_SELECT_MODE === "cautious") && this.updateParentTreeSelection(t), i && (this.bufferCheckState.buffer = !1, this.ctx.emit("draw")));
  }
  setRowSelectionByParent(t, e) {
    const i = this.selectionMap.get(t);
    i && (i.check = e, this.setRowSelectionByCheckboxKey(t, i.check));
  }
  getSelectionRows() {
    let t = [];
    return this.selectionMap.forEach((e) => {
      e.check && t.push(e.row);
    }), t;
  }
  /**
   * 根据rowKey 获取选中状态
   * @param rowKey
   */
  getRowSelection(t) {
    const e = this.selectionMap.get(t);
    return e ? e.check : !1;
  }
  // 获取树形选择状态
  getTreeSelectionState(t) {
    if (!this.getRowForRowKey(t))
      return { checked: !1, indeterminate: !1 };
    const e = this.selectionMap.get(t), i = e?.check || !1;
    if (this.getTreeChildren(t).length === 0)
      return { checked: i, indeterminate: !1 };
    let s = !1, o = i;
    if (this.ctx.config.TREE_SELECT_MODE === "auto") {
      const r = (d) => {
        const x = this.getTreeChildren(d);
        let f = [];
        for (const m of x)
          f.push(m), f.push(...r(m));
        return f;
      }, l = r(t).map((d) => this.selectionMap.get(d)), h = l.filter((d) => d?.check).length, c = l.length, u = h > 0;
      s = u && h !== c, o = i || u, i && c > 0 && h === 0 && (o = !1, s = !1);
    } else if (this.ctx.config.TREE_SELECT_MODE === "cautious") {
      const r = (x) => {
        const f = this.getTreeChildren(x);
        let m = [];
        for (const g of f)
          m.push(g), m.push(...r(g));
        return m;
      }, l = r(t).map((x) => this.selectionMap.get(x)), h = l.filter((x) => x?.check).length, c = l.length, u = h > 0, d = h === c;
      s = u && !d, o = i || d, i && c > 0 && h === 0 && (o = !1, s = !1);
    } else this.ctx.config.TREE_SELECT_MODE === "strictly" && (s = !1, o = i);
    return { checked: o, indeterminate: s };
  }
  // 获取树形子节点
  getTreeChildren(t) {
    const e = this.getRowForRowKey(t);
    if (!e || !e.item || !e.item.children)
      return [];
    const i = [], s = (o) => {
      for (const r of o) {
        const l = this.getRowKeyByItem(r);
        l && i.push(l), r.children && r.children.length > 0 && s(r.children);
      }
    };
    return s(e.item.children), i;
  }
  // 获取树形父节点
  getTreeParent(t) {
    const e = (i, s) => {
      for (const o of i) {
        const r = this.getRowKeyByItem(o);
        if (o.children)
          for (const l of o.children) {
            if (this.getRowKeyByItem(l) === s)
              return r;
            const h = e(o.children, s);
            if (h)
              return h;
          }
      }
      return null;
    };
    return e(this.data, t);
  }
  /**
   * 根据rowKey 获取选中状态
   * @param rowKey
   */
  getRowSelectable(t) {
    const { selectable: e, item: i, rowIndex: s } = this.rowKeyMap.get(t);
    return typeof e == "function" ? e({
      row: i,
      rowIndex: s
    }) : e;
  }
  /**
   * 全选
   * @param rowKey
   */
  toggleAllSelection() {
    this.ctx.config.TREE_SELECT_MODE === "auto" || this.ctx.config.TREE_SELECT_MODE === "cautious" ? this.rowKeyMap.forEach((e, i) => {
      let s = e.selectable;
      if (typeof s == "function" && (s = s({
        row: e.item,
        rowIndex: e.rowIndex
      })), s) {
        const o = this.selectionMap.get(i);
        o && (o.check = !0, this.setRowSelectionByCheckboxKey(i, !0));
      }
    }) : this.rowKeyMap.forEach((e, i) => {
      let s = e.selectable;
      typeof s == "function" && (s = s({
        row: e.item,
        rowIndex: e.rowIndex
      })), s && this.setRowSelection(i, !0, !1);
    });
    const t = this.getSelectionRows();
    this.ctx.emit("toggleAllSelection", t), this.ctx.emit("selectionChange", t), this.bufferCheckState.buffer = !1, this.ctx.emit("draw");
  }
  /**
   * 清除选中
   * @param rowKey
   */
  clearSelection(t = !1) {
    const e = this.ctx.config.TREE_SELECT_MODE === "auto" || this.ctx.config.TREE_SELECT_MODE === "cautious";
    t ? e ? this.rowKeyMap.forEach((s, o) => {
      const r = this.selectionMap.get(o);
      r && (r.check = !1, this.setRowSelectionByCheckboxKey(o, !1));
    }) : this.rowKeyMap.forEach((s, o) => {
      this.setRowSelection(o, !1, !1);
    }) : (this.selectionMap.clear(), this.rowKeyMap.forEach((s, o) => {
      this.selectionMap.set(o, {
        check: !1,
        row: s.item,
        key: o
      });
    }));
    const i = this.getSelectionRows();
    this.ctx.emit("clearSelection"), this.ctx.emit("selectionChange", i), this.bufferCheckState.buffer = !1, this.ctx.emit("draw");
  }
  /**
   * 获取选中状态，表头用
   * @param rowKey
   */
  getCheckedState() {
    const { buffer: t, ...e } = this.bufferCheckState;
    if (t)
      return e;
    const i = this.rowKeyMap.size;
    let s = 0, o = 0;
    const r = this.selectionMap.size, l = Array.from(this.selectionMap.values()).some((x) => x.check);
    this.rowKeyMap.forEach((x, f) => {
      var m;
      (m = this.selectionMap.get(f)) != null && m.check && (s += 1);
      let g = x.selectable;
      typeof g == "function" && (g = g({
        row: x.item,
        rowIndex: x.rowIndex
      })), g && (o += 1);
    });
    const h = r > i && s === 0 && l, c = o && o > s && s > 0 || h, u = o !== 0, d = !!o && o === s;
    return this.bufferCheckState = {
      buffer: !0,
      check: d,
      indeterminate: c,
      selectable: u
    }, {
      check: d,
      indeterminate: c,
      selectable: u
    };
  }
  /**
   * 更新列索引
   * @param list 表头末级列表
   */
  updateColIndexKeyMap(t = []) {
    this.colIndexKeyMap.clear(), t.forEach((e) => {
      this.colIndexKeyMap.set(e.colIndex, e.key);
    });
  }
  getColumnByColIndex(t) {
    var e;
    const i = this.colIndexKeyMap.get(t);
    if (i && this.headerMap.has(i))
      return (e = this.headerMap.get(i)) == null ? void 0 : e.column;
  }
  getColumnByKey(t) {
    const e = this.headerMap.get(t);
    if (e)
      return e;
  }
  getColIndexForKey(t) {
    var e;
    if (t && this.headerMap.has(t))
      return (e = this.headerMap.get(t)) == null ? void 0 : e.colIndex;
  }
  getColHeaderByIndex(t) {
    const e = this.colIndexKeyMap.get(t);
    if (e && this.headerMap.has(e))
      return this.headerMap.get(e);
  }
  /**
   * 获取以改变数据
   */
  getChangedData() {
    let t = [];
    return this.changedDataMap.forEach((e, i) => {
      const s = this.originalDataMap.get(i), o = i.split("​_")[0], r = i.split("​_")[1];
      s !== e && t.push({
        rowKey: o,
        colKey: r,
        originalValue: s,
        row: this.ctx.database.getRowDataItemForRowKey(o),
        value: e
      });
    }), t;
  }
  getChangedRows() {
    const t = /* @__PURE__ */ new Set();
    this.changedDataMap.forEach((i, s) => {
      const o = this.originalDataMap.get(s), r = s.split("​_")[0];
      o !== i && t.add(r);
    });
    let e = [];
    return t.forEach((i) => {
      e.push(this.ctx.database.getRowDataItemForRowKey(i));
    }), e;
  }
  /**
   * 获取改变值是否已经改变
   * @param rowKey
   * @param key
   * @returns
   */
  isHasChangedData(t, e) {
    const i = `${t}​_${e}`;
    if (!this.changedDataMap.has(i))
      return !1;
    const s = this.originalDataMap.get(i), o = this.changedDataMap.get(i);
    return s !== o;
  }
  getPositionForRowIndex(t) {
    return t < this.positions.length ? this.positions[t] : {
      height: 0,
      top: 0,
      bottom: 0,
      calculatedHeight: 0
    };
  }
  setHeader(t, e) {
    return t ? (this.headerMap.set(t, e), !0) : !1;
  }
  getReadonly(t, e) {
    var i;
    const { DISABLED: s } = this.ctx.config;
    if (s)
      return !0;
    const o = this.rowKeyMap.get(t), r = this.headerMap.get(e);
    if (!o || !r)
      return !0;
    const l = o.readonly, h = r.readonly, { BODY_CELL_READONLY_METHOD: c } = this.ctx.config;
    if (typeof c == "function" && r) {
      const u = c({
        row: o.item,
        rowIndex: o.rowIndex,
        colIndex: r.colIndex,
        column: r.column,
        value: this.getItemValue(t, e)
      });
      if (u !== void 0)
        return u;
    }
    if (typeof ((i = r.column) == null ? void 0 : i.readonly) == "function") {
      const u = r.column.readonly({
        row: o.item,
        rowIndex: o.rowIndex,
        colIndex: r.colIndex,
        column: r.column,
        value: this.getItemValue(t, e)
      });
      if (u !== void 0)
        return u;
    }
    return h || l;
  }
  clearValidate() {
    this.validationErrorMap.clear();
  }
  hasValidationError() {
    return this.validationErrorMap.size !== 0;
  }
  getValidator(t, e) {
    const i = this.ctx.database.getReadonly(t, e), { ENABLE_READONLY_VALIDATE: s } = this.ctx.config;
    return !s && i ? new Promise((o) => {
      o([]);
    }) : new Promise((o) => {
      const r = this.rowKeyMap.get(t), l = this.headerMap.get(e), { BODY_CELL_RULES_METHOD: h } = this.ctx.config;
      if (r === void 0 || l === void 0)
        return o([]);
      const c = l.column;
      let u = c.rules;
      if (typeof h == "function") {
        const d = h({
          row: r.item,
          rowIndex: r.rowIndex,
          colIndex: l.colIndex,
          column: c,
          value: this.getItemValue(t, e)
        });
        d && (u = d);
      }
      if (u) {
        const d = {
          row: r.item,
          rowIndex: r.rowIndex,
          colIndex: l.colIndex,
          column: c,
          key: e,
          rowKey: t,
          value: this.getItemValue(t, e),
          field: e,
          fieldValue: this.getItemValue(t, e)
        }, x = new Se(u).validate(d);
        x.length ? this.setValidationError(t, e, x) : this.clearValidationError(t, e), o(x);
      } else
        this.clearValidationError(t, e), o([]);
    });
  }
  getHeightByRowIndexRowSpan(t, e) {
    let i = 0;
    for (let s = 0; s < e; s++) {
      const o = this.positions[t + s];
      o && (i += o.height);
    }
    return i;
  }
  getSpanInfo(t) {
    const {
      rowIndex: e,
      key: i,
      rowKey: s,
      row: o,
      value: r,
      colIndex: l,
      relationRowKeys: h,
      relationColKeys: c,
      rowspan: u,
      height: d,
      width: x,
      colspan: f,
      mergeRow: m,
      mergeCol: g
    } = t;
    if (u === 1 && f === 1)
      return {
        xArr: [l, l],
        yArr: [e, e],
        rowspan: u,
        colspan: f,
        height: d,
        width: x,
        offsetTop: 0,
        offsetLeft: 0,
        dataList: [
          {
            rowKey: s,
            key: i,
            row: o,
            value: r
          }
        ]
      };
    let w = e, C = e, E = l, b = l, p = [], y = 0, R = 0, _ = 0, T = 0;
    if (u !== 1 && m) {
      T = x;
      const v = h.reduce((I, O) => {
        const M = this.getItemValue(s, O) ?? "";
        return `${I}${M}`;
      }, "");
      for (let I = e - 1; I >= 0; I--) {
        const O = this.rowIndexRowKeyMap.get(I) || "", M = h.reduce((L, S) => {
          const D = this.getItemValue(O, S) ?? "";
          return `${L}${D}`;
        }, "");
        if (v === M)
          w = I;
        else
          break;
      }
      for (let I = e; I <= this.ctx.maxRowIndex; I++) {
        const O = this.rowIndexRowKeyMap.get(I) || "", M = h.reduce((L, S) => {
          const D = this.getItemValue(O, S) ?? "";
          return `${L}${D}`;
        }, "");
        if (v === M)
          C = I;
        else
          break;
      }
      for (let I = w; I < e; I++) {
        const { height: O } = this.positions[I];
        y += O;
      }
      for (let I = w; I <= C; I++) {
        const { height: O } = this.positions[I];
        _ += O;
        const M = this.rowIndexRowKeyMap.get(I) || "", { item: L } = this.rowKeyMap.get(M), S = this.getItemValue(M, i);
        p.push({
          rowKey: M,
          key: i,
          value: S,
          row: L
        });
      }
    }
    if (f !== 1 && g) {
      _ = d;
      for (let v = l - 1; v >= 0; v--) {
        const I = this.getColumnByColIndex(v);
        if (!I)
          break;
        const O = this.getItemValue(s, i), M = this.getItemValue(s, I.key);
        if (O === M && c.includes(I.key))
          E = v;
        else
          break;
      }
      for (let v = l; v <= this.ctx.maxColIndex; v++) {
        const I = this.getColumnByColIndex(v);
        if (!I)
          break;
        const O = this.getItemValue(s, i), M = this.getItemValue(s, I.key);
        if (O === M && c.includes(I.key))
          b = v;
        else
          break;
      }
      for (let v = E; v < l; v++) {
        const I = this.getColumnByColIndex(v);
        if (!I)
          break;
        R += I.width || 100;
      }
      for (let v = E; v <= b; v++) {
        const I = this.getColumnByColIndex(v);
        if (!I)
          break;
        T += I.width || 100, p.push({
          rowKey: s,
          key: I.key,
          value: this.getItemValue(s, I.key),
          row: o
        });
      }
    }
    return {
      xArr: [E, b],
      yArr: [w, C],
      rowspan: u,
      colspan: f,
      height: _,
      width: T,
      offsetTop: y,
      offsetLeft: R,
      dataList: p
    };
  }
  setValidationErrorByRowKey(t, e, i) {
    const s = `${t}​_${e}`, o = this.getRowForRowKey(t), r = o?.rowIndex, l = this.getColumnByKey(e);
    if (!t || !l || !o)
      return;
    const h = this.getItemValue(t, e), c = [
      {
        key: e,
        rowKey: t,
        rowIndex: r,
        colIndex: l.colIndex,
        column: l.column,
        row: o,
        value: h,
        message: i,
        field: e,
        fieldValue: h
      }
    ];
    this.validationErrorMap.set(s, c);
  }
  setValidationError(t, e, i) {
    const s = `${t}​_${e}`;
    this.validationErrorMap.set(s, i);
  }
  clearValidationError(t, e) {
    const i = `${t}​_${e}`;
    this.validationErrorMap.has(i) && this.validationErrorMap.delete(i);
  }
  getValidationError(t, e) {
    const i = `${t}​_${e}`;
    return this.validationErrorMap.get(i) || [];
  }
  // 获取虚拟单元格,只针对可见的
  getVirtualBodyCell(t, e, i = !0) {
    const s = this.getColumnByColIndex(e), o = this.getRowForRowIndex(t);
    return !s || !o ? void 0 : new ce(this.ctx, t, e, 0, 0, 0, 0, s, o.item, "body", i);
  }
  getVirtualBodyCellByKey(t, e) {
    const i = this.getRowIndexForRowKey(t), s = this.getColIndexForKey(e);
    if (!(i === void 0 || s === void 0))
      return this.getVirtualBodyCell(i, s);
  }
  hasMergeCell(t, e) {
    let i = !1;
    for (let s = e[0]; s <= e[1]; s++)
      for (let o = t[0]; o <= t[1]; o++) {
        const r = this.getVirtualBodyCell(s, o);
        if (r && (r.rowspan !== 1 || r.colspan !== 1)) {
          i = !0;
          break;
        }
      }
    return i;
  }
  /**
   * 计算树形数据的最大深度
   * @param data 树形数据
   * @param currentDepth 当前深度
   * @returns 最大深度
   */
  calculateMaxTreeDepth(t, e = 0) {
    let i = e;
    return t.forEach((s) => {
      if (Array.isArray(s.children) && s.children.length > 0) {
        const o = this.calculateMaxTreeDepth(s.children, e + 1);
        i = Math.max(i, o);
      }
    }), i;
  }
  setOverlayerAutoHeightMap(t) {
    this.overlayerAutoHeightMap = t;
  }
  getOverlayerAutoHeightMap() {
    return this.overlayerAutoHeightMap;
  }
  getOverlayerAutoHeight(t, e) {
    const i = `${t}​_${e}`;
    return this.overlayerAutoHeightMap.get(i) || 0;
  }
  setCustomHeader(t, e = !1) {
    if (["fixedData", "sortData", "hideData", "resizableData"].forEach((i) => {
      const s = t[i];
      s !== void 0 && (this.customHeader[i] = s);
    }), !e) {
      const i = this.clearCustomHeaderInvalidValues(this.columns);
      this.ctx.emit("customHeaderChange", i);
    }
  }
  resetCustomHeader() {
    this.customHeader = {}, this.ctx.emit("resetHeader"), this.ctx.emit("customHeaderChange", this.customHeader);
  }
  getCustomHeader() {
    return this.customHeader;
  }
  setCustomHeaderResizableData(t, e) {
    let { resizableData: i = {} } = this.customHeader;
    i[t] = e, this.setCustomHeader({
      resizableData: i
    });
  }
  setCustomHeaderHideData(t, e) {
    let { hideData: i = {} } = this.customHeader;
    t.forEach((s) => {
      i[s] = e;
    }), this.setCustomHeader({
      hideData: i
    }), this.ctx.emit("resetHeader");
  }
  setCustomHeaderFixedData(t, e) {
    let { fixedData: i = {} } = this.customHeader;
    t.forEach((s) => {
      i[s] = e;
    }), this.setCustomHeader({
      fixedData: i
    }), this.ctx.emit("resetHeader");
  }
  // 递归处理
  clearCustomHeaderInvalidValues(t) {
    const e = (s, o = {}) => {
      s.forEach((r) => {
        r.children && r.children.length > 0 && e(r.children, o);
        const l = (h, c) => {
          var u, d;
          const x = (u = this.customHeader[h]) == null ? void 0 : u[r.key];
          x !== void 0 && x !== c && (o[h] || (o[h] = {}), o[h][r.key] = x, h === "fixedData" && !x && !c && ((d = o[h]) == null || delete d[r.key]));
        };
        l("fixedData", r.fixed), l("sortData", r.sort), l("hideData", r.hide), l("resizableData", r.width);
      });
    };
    let i = {};
    return e(t, i), i;
  }
  setMaxRowHeightItem(t, e, i) {
    this.maxRowHeightCellMap.set(t, {
      key: e,
      height: i
    });
  }
  getMaxRowHeightItem(t) {
    return this.maxRowHeightCellMap.get(t);
  }
  clearChangeData() {
    this.changedDataMap.clear();
  }
}
class qe {
  constructor(t) {
    n(this, "ctx"), n(this, "history", []), n(this, "historyIndex", -1), this.ctx = t, this.init();
  }
  init() {
    this.ctx.on("keydown", (t) => {
      if (!this.ctx.editing) {
        if (t.ctrlKey && !t.shiftKey && t.code === "KeyZ" || t.metaKey && !t.shiftKey && t.code === "KeyZ") {
          t.preventDefault(), this.ctx.clearSelector(), this.ctx.clearAutofill(), this.backState();
          return;
        }
        if (t.ctrlKey && t.code === "KeyY" || t.ctrlKey && t.shiftKey && t.code === "KeyZ" || t.metaKey && t.shiftKey && t.code === "KeyZ") {
          t.preventDefault(), this.ctx.clearSelector(), this.ctx.clearAutofill(), this.forwardState();
          return;
        }
      }
    });
  }
  pushState(t) {
    const { HISTORY_NUM: e = 0, ENABLE_HISTORY: i } = this.ctx.config;
    i && (this.history.push(t), this.history.length > e && this.history.splice(0, 1), this.historyIndex = this.history.length - 1);
  }
  // 回退
  backState() {
    if (this.historyIndex >= 0) {
      const { changeList: t, scrollX: e, scrollY: i } = this.history[this.historyIndex], s = t.map((o) => ({
        rowKey: o.rowKey,
        key: o.key,
        value: o.oldValue,
        row: {}
      }));
      this.ctx.setScroll(e, i), this.ctx.database.batchSetItemValue(s, !1, !1, "back"), this.historyIndex -= 1;
    }
  }
  // 前进
  forwardState() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      const { changeList: t } = this.history[this.historyIndex], e = t.map((i) => ({
        rowKey: i.rowKey,
        key: i.key,
        value: i.newValue,
        row: {}
      }));
      this.ctx.database.batchSetItemValue(e, !1, !1, "forward");
    }
  }
  // 清空历史
  clear() {
    this.history = [], this.historyIndex = -1;
  }
}
class Ze {
  constructor(t) {
    n(this, "eventTasks", /* @__PURE__ */ new Set()), n(this, "ctx"), this.ctx = t, this.init();
  }
  init() {
    this.bind(window, "resize", this.handleResize.bind(this)), this.bind(window, "mouseup", this.handleMouseUp.bind(this)), this.bind(window, "mousemove", this.handleMousemove.bind(this)), this.bind(window, "blur", this.handleOutsideMousedown.bind(this)), this.bind(window, "mousedown", this.handleOutsideMousedown.bind(this)), this.bind(this.ctx.stageElement, "click", this.handleClick.bind(this)), this.bind(window, "keydown", this.handleKeydown.bind(this)), this.bind(this.ctx.stageElement, "wheel", this.handleWheel.bind(this), { passive: !1 }), this.bind(this.ctx.stageElement, "touchstart", this.handleTouchstart.bind(this), { passive: !1 }), this.bind(this.ctx.stageElement, "touchend", this.handleTouchend.bind(this)), this.bind(this.ctx.stageElement, "touchmove", this.handleTouchmove.bind(this), { passive: !1 }), this.bind(this.ctx.stageElement, "contextmenu", this.handleContextMenu.bind(this)), this.bind(this.ctx.stageElement, "mousedown", this.handleMouseDown.bind(this)), this.bind(this.ctx.stageElement, "dblclick", this.handleDblclick.bind(this)), this.bind(this.ctx.stageElement, "mouseover", this.handleMouseover.bind(this)), this.bind(this.ctx.stageElement, "mouseout", this.handleMouseout.bind(this)), this.bind(document, "selectionchange", this.selectionchange.bind(this));
  }
  selectionchange() {
    this.ctx.domSelectionStr = "";
    const t = window.getSelection();
    t && t.toString() && (this.ctx.domSelectionStr = t.toString());
  }
  clearDomSelection() {
    const t = window.getSelection();
    t && !t.isCollapsed && t.removeAllRanges();
  }
  destroy() {
    Array.from(this.eventTasks).forEach(({ target: t, name: e, fn: i, options: s }) => {
      this.unbind(t, e, i, s);
    }), this.eventTasks.clear();
  }
  handleResize(t) {
    this.ctx.emit("resetHeader", t), this.ctx.emit("resize", t);
  }
  handleMouseDown(t) {
    this.clearDomSelection(), t.button === 0 && (this.ctx.mousedown = !0), this.ctx.emit("mousedown", t);
  }
  handleMousemove(t) {
    const e = t, i = this.ctx.containerElement.getBoundingClientRect(), s = e.clientX - i.left, o = e.clientY - i.top;
    this.ctx.mouseX = s, this.ctx.mouseY = o, this.ctx.emit("mousemove", t);
  }
  handleMouseUp(t) {
    t.button === 0 && (this.ctx.mousedown = !1), this.ctx.emit("mouseup", t);
  }
  handleClick(t) {
    this.ctx.emit("click", t);
  }
  handleKeydown(t) {
    const { ENABLE_KEYBOARD: e } = this.ctx.config;
    e && this.ctx.isTarget(t) && (this.ctx.dragHeaderIng || this.ctx.emit("keydown", t));
  }
  handleWheel(t) {
    this.ctx.emit("wheel", t);
  }
  handleTouchstart(t) {
    this.ctx.emit("touchstart", t);
  }
  handleTouchend(t) {
    this.ctx.emit("touchend", t);
  }
  handleTouchmove(t) {
    this.ctx.emit("touchmove", t);
  }
  handleContextMenu(t) {
    t.preventDefault(), this.ctx.emit("contextMenu", t);
  }
  handleMouseover(t) {
    this.ctx.isMouseoverTargetContainer = !0, this.ctx.emit("mouseover", t);
  }
  handleMouseout(t) {
    this.ctx.isMouseoverTargetContainer = !1, this.ctx.emit("mouseout", t);
  }
  handleDblclick(t) {
    this.ctx.emit("dblclick", t);
  }
  handleOutsideMousedown(t) {
    this.ctx.selector.enable && (t.target instanceof Window || t.target instanceof Node && !this.ctx.containerElement.contains(t.target)) && this.ctx.emit("outsideMousedown", t);
  }
  bind(t, e, i, s) {
    t.addEventListener(e, i, s), this.eventTasks.add({ target: t, name: e, fn: i, options: s });
  }
  unbind(t, e, i, s) {
    t.removeEventListener(e, i, s);
    for (const o of this.eventTasks)
      if (o.target === t && o.name === e && o.fn === i) {
        this.eventTasks.delete(o);
        break;
      }
  }
}
class Je {
  constructor() {
    n(this, "events", /* @__PURE__ */ new Map());
  }
  has(t) {
    return this.events.has(t);
  }
  // 订阅事件
  on(t, e) {
    const i = this.events.get(t) || [];
    i.push(e), this.events.set(t, i);
  }
  // 一次性订阅事件
  once(t, e) {
    const i = (...s) => {
      e(...s), this.off(t, i);
    };
    return this.on(t, i), this;
  }
  // 取消订阅事件
  off(t, e) {
    const i = this.events.get(t);
    if (i) {
      const s = i.indexOf(e);
      s >= 0 && (i.splice(s, 1), i.length === 0 ? this.events.delete(t) : this.events.set(t, i));
    }
  }
  // 发布事件
  emit(t, ...e) {
    const i = this.events.get(t);
    i && i.forEach((s) => {
      s(...e);
    });
  }
  destroy() {
    this.events.clear();
  }
}
class Qe {
  constructor(t) {
    n(this, "ctx"), n(this, "textCacheMap", /* @__PURE__ */ new Map());
    const e = t.getContext("2d");
    if (!e) throw new Error("canvas context not found");
    this.ctx = e;
  }
  getCtx() {
    return this.ctx;
  }
  clearTextCache() {
    this.textCacheMap.clear();
  }
  scale(t) {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0), this.ctx.scale(t, t);
  }
  save() {
    this.ctx.save();
  }
  restore() {
    this.ctx.restore();
  }
  translate(t, e) {
    this.ctx.translate(t, e);
  }
  setCursor(t = "default") {
    this.ctx.canvas.style.cursor = t;
  }
  clear(t = 0, e = 0, i, s) {
    this.ctx.clearRect(t, e, i || this.ctx.canvas.width, s || this.ctx.canvas.height);
  }
  /**
   * 在 Canvas 上绘制单侧阴影
   * @param {number} x - 矩形的 x 坐标
   * @param {number} y - 矩形的 y 坐标
   * @param {number} width - 矩形的宽度
   * @param {number} height - 矩形的高度
   * @param {string} side - 阴影的位置（'left', 'right', 'top', 'bottom'）
   * @param {number} shadowWidth - 阴影的宽度
   * @param {string} color - 阴影的颜色
   */
  drawShadow(t, e, i, s, o) {
    const { fillColor: r, side: l, shadowWidth: h, colorStart: c, colorEnd: u } = o;
    if (this.ctx.save(), r && (this.ctx.fillStyle = r, this.ctx.fillRect(t, e, i, s)), !Number.isFinite(h) || h <= 0) {
      this.ctx.restore();
      return;
    }
    let d;
    switch (l) {
      case "left":
        d = this.ctx.createLinearGradient(t - h, e, t, e), d.addColorStop(0, c), d.addColorStop(1, u), this.ctx.fillStyle = d, this.ctx.fillRect(t - h, e, h, s);
        break;
      case "right":
        d = this.ctx.createLinearGradient(t + i, e, t + i + h, e), d.addColorStop(0, c), d.addColorStop(1, u), this.ctx.fillStyle = d, this.ctx.fillRect(t + i, e, h, s);
        break;
      case "top":
        d = this.ctx.createLinearGradient(t, e - h, t, e), d.addColorStop(0, c), d.addColorStop(1, u), this.ctx.fillStyle = d, this.ctx.fillRect(t, e - h, i, h);
        break;
      case "bottom":
        d = this.ctx.createLinearGradient(t, e + s, t, e + s + h), d.addColorStop(0, c), d.addColorStop(1, u), this.ctx.fillStyle = d, this.ctx.fillRect(t, e + s, i, h);
        break;
      default:
        console.error("Invalid side specified for shadow");
        break;
    }
    this.ctx.restore();
  }
  // 绘制线条
  drawLine(t, e) {
    if (t.length < 4 || t.length % 2 !== 0)
      throw new Error("A valid array of points is required to draw a line");
    this.ctx.save();
    const { borderColor: i = "black", borderWidth: s = 1 } = e;
    this.ctx.beginPath(), this.ctx.moveTo(t[0] - 0.5, t[1] - 0.5);
    for (let o = 2; o < t.length; o += 2)
      this.ctx.lineTo(t[o] - 0.5, t[o + 1] - 0.5);
    this.ctx.strokeStyle = i, this.ctx.lineWidth = s, e.lineDash && (this.ctx.lineDashOffset = e.lineDashOffset ?? 0, this.ctx.setLineDash(e.lineDash)), e.fillColor && (this.ctx.fillStyle = e.fillColor, this.ctx.fill()), e.borderColor && (this.ctx.strokeStyle = e.borderColor), this.ctx.stroke(), this.ctx.closePath(), this.ctx.restore();
  }
  drawImage(t, e, i, s, o) {
    this.ctx.save(), this.ctx.drawImage(t, e, i, s, o), this.ctx.restore();
  }
  drawRect(t, e, i, s, { borderWidth: o = 1, borderColor: r, fillColor: l, radius: h = 0 } = {}) {
    if (this.ctx.save(), l !== void 0 && (this.ctx.fillStyle = l), r !== void 0 && (this.ctx.lineWidth = o, this.ctx.strokeStyle = r), this.ctx.beginPath(), h === 0)
      l !== void 0 && this.ctx.fillRect(t, e, i, s), this.ctx.rect(t - 0.5, e - 0.5, i, s);
    else {
      const [c, u, d, x] = typeof h == "number" ? [h, h, h, h] : h;
      this.ctx.moveTo(t + c, e), this.ctx.arcTo(t + i, e, t + i, e + u, u), this.ctx.arcTo(t + i, e + s, t + i - d, e + s, d), this.ctx.arcTo(t, e + s, t, e + s - x, x), this.ctx.arcTo(t, e, t + c, e, c);
    }
    l !== void 0 && h !== 0 && this.ctx.fill(), r !== void 0 && this.ctx.stroke(), this.ctx.restore();
  }
  /**
   * 画文本
   * @param text
   * @param x
   * @param y
   * @param width
   * @param height
   * @param options
   * @returns 是否溢出
   */
  drawText(t = "", e, i, s, o, r = {}) {
    var l, h, c;
    this.ctx.save();
    const {
      font: u = "12px Arial",
      align: d = "center",
      color: x = "#495060",
      padding: f = 0,
      verticalAlign: m = "middle",
      maxLineClamp: g = 1,
      autoRowHeight: w = !1,
      offsetLeft: C = 0,
      offsetRight: E = 0
    } = r;
    if (this.ctx.font = u, this.ctx.fillStyle = x, ["", null, void 0].includes(t))
      return this.ctx.restore(), !1;
    const b = parseInt(((l = u.match(/\d+/)) == null ? void 0 : l[0]) || "12") * (r.lineHeight || 1.2), p = this.buildTextLayout(t, e, i, s, o, {
      font: u,
      color: x,
      align: d,
      padding: f,
      verticalAlign: m,
      maxLineClamp: g,
      autoRowHeight: w,
      lineHeight: b,
      offsetLeft: C,
      offsetRight: E
    });
    if (this.ctx.textBaseline = "middle", this.ctx.textAlign = "left", p.lines.forEach((y) => {
      this.ctx.fillText(y.text, y.drawX, y.drawY + p.lineHeight / 2);
    }), r.textCallback && p.lines.length) {
      const y = p.lines.reduce((I, O) => Math.max(I, O.width), 0), R = Math.round(y);
      let _ = ((h = p.lines[0]) == null ? void 0 : h.drawX) ?? e + f + C, T = _ + R;
      d === "center" ? (_ = e + s / 2 - R / 2, T = e + s / 2 + R / 2) : d === "right" && (_ = e + s - f - E - R, T = e + s - f - E);
      const v = {
        x: ((c = p.lines[0]) == null ? void 0 : c.drawX) ?? _,
        y: p.contentY,
        width: R,
        height: p.lines.length * b,
        left: _,
        right: T,
        top: p.contentY,
        bottom: p.contentY + p.lines.length * b
      };
      r.textCallback(v);
    }
    return r.layoutCallback && r.layoutCallback(p), this.ctx.restore(), p.ellipsis;
  }
  buildTextLayout(t, e, i, s, o, r) {
    const {
      font: l,
      color: h,
      align: c,
      padding: u,
      verticalAlign: d,
      maxLineClamp: x,
      autoRowHeight: f,
      lineHeight: m,
      offsetLeft: g,
      offsetRight: w
    } = r;
    this.ctx.save(), this.ctx.font = l;
    const C = s - u * 2 - g - w, E = C, b = o - u * 2, p = Array.from(t);
    let y = this.wrapTextToLines(t, C);
    const R = Math.round(b / m);
    let _ = Math.min(y.length, Math.max(R, 1));
    x === "auto" && f ? _ = y.length : typeof x == "number" && x < _ && x !== 1 ? _ = x : (x === 1 && (y = [{ items: p.map((L, S) => ({ char: L, sourceIndex: S })), text: t, caretIndex: 0, lineIndex: 0, drawX: 0, drawY: 0, width: 0, segments: [] }], _ = 1), x === "auto" && R === 1 && (y = [{ items: p.map((L, S) => ({ char: L, sourceIndex: S })), text: t, caretIndex: 0, lineIndex: 0, drawX: 0, drawY: 0, width: 0, segments: [] }], _ = 1));
    let T = !1;
    const v = y.slice(0, _);
    if (y.length > _) {
      T = !0;
      const L = y.slice(_ - 1), S = this.buildEllipsisLine(L, s, u);
      S.lineIndex = _ - 1, v[_ - 1] = S;
    } else if (_ > 0) {
      const L = _ - 1, S = y.slice(L), D = S.map((A) => A.text).join(""), { ellipsis: H } = this.handleEllipsis(D, s, u, l);
      if (H) {
        T = !0;
        const A = this.buildEllipsisLine(S, s, u);
        A.lineIndex = L, v[L] = A;
      }
    }
    const I = v.length * m;
    let O = i + u;
    d === "middle" ? O = i + (o - I) / 2 : d === "bottom" && (O = i + o - I - u);
    const M = [];
    return v.forEach((L, S) => {
      L.lineIndex = S;
      const D = this.buildLineSegments(L), H = D.reduce((N, vt) => N + vt.width, 0);
      let A = e + u + g;
      c === "center" ? A = e + (s - H) / 2 : c === "right" && (A = e + s - u - w - H);
      const k = O + S * m;
      L.drawX = A, L.drawY = k, L.width = H, L.segments = D, D.forEach((N) => {
        N.sourceIndex < 0 || M.push({
          char: N.char,
          index: N.sourceIndex,
          line: S,
          x: A + N.x,
          y: k,
          width: N.width,
          height: m
        });
      });
    }), this.ctx.restore(), {
      text: t,
      chars: p,
      glyphs: M,
      lines: v,
      box: { x: e, y: i, width: s, height: o },
      contentBox: { x: e + u + g, y: i + u, width: E, height: b },
      contentY: O,
      lineHeight: m,
      font: l,
      color: h,
      align: c,
      ellipsis: T
    };
  }
  wrapTextToLines(t, e) {
    if (!t)
      return [{ items: [], text: "", caretIndex: 0, lineIndex: 0, drawX: 0, drawY: 0, width: 0, segments: [] }];
    const i = Array.from(t), s = [];
    let o = [], r = 0, l = 0;
    const h = (c) => {
      const u = o.map((d) => d.char).join("");
      s.push({
        items: o,
        text: u,
        caretIndex: l,
        lineIndex: s.length,
        drawX: 0,
        drawY: 0,
        width: 0,
        segments: []
      }), o = [], r = 0, l = c;
    };
    for (let c = 0; c < i.length; c++) {
      const u = i[c];
      if (u === `
`) {
        h(c + 1);
        continue;
      }
      const d = this.ctx.measureText(u).width;
      if (r + d > e && o.length > 0) {
        h(o[o.length - 1].sourceIndex + 1), o.push({ char: u, sourceIndex: c }), r = d;
        continue;
      }
      o.push({ char: u, sourceIndex: c }), r += d;
    }
    return (o.length > 0 || s.length === 0) && h(i.length), s;
  }
  buildEllipsisLine(t, e, i) {
    var s;
    const o = t.flatMap((d) => d.items), r = o.map((d) => d.char).join(""), { _text: l, ellipsis: h } = this.handleEllipsis(r, e, i, this.ctx.font), c = h ? l.slice(0, -3) : l, u = [];
    for (let d = 0; d < c.length; d++) {
      const x = o[d];
      if (!x)
        break;
      u.push({ char: x.char, sourceIndex: x.sourceIndex });
    }
    return h && u.push(
      { char: ".", sourceIndex: -1, ellipsis: !0 },
      { char: ".", sourceIndex: -1, ellipsis: !0 },
      { char: ".", sourceIndex: -1, ellipsis: !0 }
    ), {
      items: u,
      text: l,
      caretIndex: ((s = t[0]) == null ? void 0 : s.caretIndex) ?? 0,
      lineIndex: 0,
      drawX: 0,
      drawY: 0,
      width: 0,
      segments: []
    };
  }
  buildLineSegments(t) {
    const e = [];
    let i = 0;
    return t.items.forEach((s, o) => {
      const r = this.ctx.measureText(s.char).width;
      e.push({
        char: s.char,
        itemIndex: o,
        sourceIndex: s.sourceIndex,
        x: i,
        width: r
      }), i += r;
    }), e;
  }
  /**
   * 将文本按宽度换行
   * @param text
   * @param maxWidth
   * @returns
   */
  wrapText(t, e, i = "") {
    if (!t) return [""];
    if (i && this.textCacheMap.has(i))
      return this.textCacheMap.get(i) || [""];
    const s = [], o = t.split(`
`);
    for (const l of o) {
      if (l === "") {
        s.push("");
        continue;
      }
      const h = l.split("");
      let c = "";
      for (const u of h) {
        const d = c + u;
        this.ctx.measureText(d).width <= e ? c = d : c ? (s.push(c), c = u) : (s.push(u), c = "");
      }
      c && s.push(c);
    }
    const r = s.length > 0 ? s : [""];
    return i && this.textCacheMap.set(i, r), r;
  }
  /**
   * 计算文本自适应高度
   * @param text
   * @param width
   * @param options
   * @returns 计算出的高度
   */
  calculateTextHeight(t = "", e, i = {}) {
    var s;
    const {
      font: o = "12px Arial",
      padding: r = 0,
      align: l = "center",
      color: h = "#495060",
      maxLineClamp: c = 1,
      cacheTextKey: u = ""
    } = i;
    this.ctx.save(), this.ctx.font = o, this.ctx.fillStyle = h, this.ctx.textAlign = l;
    const d = parseInt(((s = o.match(/\d+/)) == null ? void 0 : s[0]) || "12"), x = d * (i.lineHeight || 1.2), f = e - r * 2, m = this.wrapText(t, f, u);
    let g = 1;
    return c === "auto" ? g = m.length : m.length > c ? g = c : g = m.length, this.ctx.restore(), Math.max(Math.floor(g * x + r * 2), Math.floor(d + r * 2));
  }
  handleEllipsis(t, e, i = 0, s = "12px Arial") {
    this.ctx.save();
    let o = !1, r = t;
    if (this.ctx.font = s, t == null || t === "")
      return this.ctx.restore(), {
        _text: "",
        ellipsis: o
      };
    const l = this.ctx.measureText("...").width;
    if (e <= l + i * 2)
      return this.ctx.restore(), {
        _text: "",
        ellipsis: !0
      };
    const h = this.ctx.measureText(t).width, c = e - i * 2;
    if (h && h >= c) {
      o = !0;
      let u = 0;
      for (let d = 0; d < t.length; d++)
        if (u += this.ctx.measureText(t[d]).width, u >= c - l) {
          r = t.slice(0, d) + "...", o = !0;
          break;
        }
    }
    return this.ctx.restore(), {
      _text: r,
      ellipsis: o
    };
  }
}
class Pt {
  constructor(t) {
    n(this, "_config", {}), n(this, "CSS_PREFIX", "e-virt-table"), n(this, "ICONS", []), n(this, "ROW_KEY", ""), n(this, "DISABLED", !1), n(this, "HEADER_FONT", "12px normal Arial"), n(this, "BODY_FONT", "12px normal Arial"), n(this, "BORDER", !0), n(this, "STRIPE", !1), n(this, "STRIPE_COLOR", "#fafafa"), n(this, "BORDER_COLOR", "#e1e6eb"), n(this, "FIXED_COLUMN_SHADOW_COLOR", "rgba(0,0,0,0.1)"), n(this, "FIXED_COLUMN_SHADOW_FADE_COLOR", "rgba(0,0,0,0)"), n(this, "FIXED_COLUMN_SHADOW_WIDTH", 4), n(this, "HEIGHT", 0), n(this, "PLACEHOLDER_COLOR", "#CDD0DC"), n(this, "EMPTY_BODY_HEIGHT", 120), n(this, "EMPTY_CUSTOM_STYLE", {}), n(this, "EMPTY_TEXT", ""), n(this, "LOADING_TEXT", ""), n(this, "MAX_HEIGHT", 1e3), n(this, "BORDER_RADIUS", 8), n(this, "ENABLE_OFFSET_HEIGHT", !1), n(this, "OFFSET_HEIGHT", 0), n(this, "HEADER_HEIGHT", 36), n(this, "ENABLE_HEADER_STICKY", !1), n(this, "HEADER_BG_COLOR", "#F8FAFF"), n(this, "BODY_BG_COLOR", "#FFF"), n(this, "HEADER_TEXT_COLOR", "#1D2129"), n(this, "REQUIRED_COLOR", "#F56C6C"), n(this, "BODY_TEXT_COLOR", "#4E5969"), n(this, "FOOTER_TEXT_COLOR", "#4E5969"), n(this, "LOADING_ICON_SVG", ""), n(this, "LOADING_ICON_COLOR", "#4E5969"), n(this, "EXPAND_ICON_SVG", ""), n(this, "SHRINK_ICON_SVG", ""), n(this, "EXPAND_ICON_COLOR", "#4E5969"), n(this, "SHRINK_ICON_COLOR", "#4E5969"), n(this, "ERROR_TIP_ICON_COLOR", "red"), n(this, "ERROR_TIP_ICON_SIZE", 6), n(this, "COLUMNS_ALIGN", "left"), n(this, "COLUMNS_VERTICAL_ALIGN", "middle"), n(this, "EXPAND_LAZY", !0), n(this, "DEFAULT_EXPAND_ALL", !1), n(this, "CELL_WIDTH", 100), n(this, "CELL_HEIGHT", 36), n(this, "CELL_PADDING", 8), n(this, "CELL_HOVER_ICON_SIZE", 14), n(this, "CELL_HOVER_ICON_BG_COLOR", "#fff"), n(this, "CELL_HOVER_ICON_BORDER_COLOR", "#DDE0EA"), n(this, "SCROLLER_TRACK_SIZE", 14), n(this, "scrollbarMode", "outer"), n(this, "SCROLLBAR_SHOW_DELAY", 300), n(this, "SCROLLER_SIZE", 8), n(this, "SCROLLER_COLOR", "#dee0e3"), n(this, "SCROLLER_TRACK_COLOR", "#fff"), n(this, "SCROLLER_FOCUS_COLOR", "#bbbec4"), n(this, "SELECT_BORDER_COLOR", "rgb(82,146,247)"), n(this, "SELECT_AREA_COLOR", "rgba(82,146,247,0.1)"), n(this, "SELECT_ROW_COL_BG_COLOR", "transparent"), n(this, "AUTOFILL_POINT_BORDER_COLOR", "#fff"), n(this, "EDIT_BG_COLOR", "#fcf6ed"), n(this, "CHECKBOX_KEY", ""), n(this, "CHECKBOX_COLOR", "rgb(82,146,247)"), n(this, "FINDER_CELL_BG_COLOR", "rgb(255,229,144)"), n(this, "ENABLE_FINDER", !0), n(this, "CHECKBOX_SIZE", 20), n(this, "CHECKBOX_DISABLED_SVG", ""), n(this, "CHECKBOX_DISABLED_COLOR", "#F1F2F4"), n(this, "CHECKBOX_CHECK_SVG", ""), n(this, "CHECKBOX_UNCHECK_SVG", ""), n(this, "CHECKBOX_UNCHECK_COLOR", "#DDE0EA"), n(this, "CHECKBOX_INDETERMINATE_SVG", ""), n(this, "CHECKBOX_CHECK_DISABLED_SVG", ""), n(this, "CHECKBOX_CHECK_DISABLED_COLOR", "#DDE0EA"), n(this, "ICON_EDIT_SVG", ""), n(this, "ICON_EDIT_COLOR", "#4E5969"), n(this, "ICON_SELECT_SVG", ""), n(this, "ICON_SELECT_COLOR", "#4E5969"), n(this, "SORT_STRICTLY", !0), n(this, "SORT_ASC_ICON_SVG", ""), n(this, "SORT_DESC_ICON_SVG", ""), n(this, "SORTABLE_ICON_SVG", ""), n(this, "SORT_ICON_COLOR", "rgb(82,146,247)"), n(this, "READONLY_COLOR", "#fff"), n(this, "READONLY_TEXT_COLOR", "#4E5969"), n(this, "ENABLE_READONLY_VALIDATE", !1), n(this, "ERROR_TIP_COLOR", "#ED3F14"), n(this, "FOOTER_BG_COLOR", "#fafafa"), n(this, "FOOTER_FIXED", !0), n(this, "FOOTER_POSITION", "bottom"), n(this, "CELL_FOOTER_HEIGHT", 36), n(this, "ENABLE_SELECTOR", !0), n(this, "TREE_SELECT_MODE", "auto"), n(this, "TREE_CHILDREN_KEY", "children"), n(this, "TREE_INDENT", 20), n(this, "TREE_ICON_SIZE", 20), n(this, "TREE_LINE", !1), n(this, "TREE_LINE_COLOR", "#e1e6eb"), n(this, "ENABLE_EDIT_SINGLE_CLICK", !1), n(this, "ENABLE_EDIT_CLICK_SELECTOR", !0), n(this, "SELECTOR_AREA_MIN_X", 0), n(this, "SELECTOR_AREA_MAX_X_OFFSET", 0), n(this, "SELECTOR_AREA_MAX_X", 0), n(this, "SELECTOR_AREA_MIN_Y", 0), n(this, "SELECTOR_AREA_MAX_Y", 0), n(this, "SELECTOR_AREA_MAX_Y_OFFSET", 0), n(this, "SELECTOR_CELL_VALUE_TYPE", "value"), n(this, "ENABLE_AUTO_THEME", !0), n(this, "ENABLE_SELECTOR_SINGLE", !1), n(this, "ENABLE_SELECTOR_SPAN_COL", !0), n(this, "ENABLE_SELECTOR_SPAN_ROW", !0), n(this, "ENABLE_SELECTOR_ALL_ROWS", !0), n(this, "ENABLE_SELECTOR_ALL_COLS", !0), n(this, "ENABLE_MERGE_CELL_LINK", !1), n(this, "ENABLE_AUTOFILL", !1), n(this, "ENABLE_AUTOFILL_SPAN_COL", !0), n(this, "ENABLE_AUTOFILL_SPAN_ROW", !0), n(this, "ENABLE_CONTEXT_MENU", !1), n(this, "ENABLE_HEADER_CONTEXT_MENU", !1), n(this, "ENABLE_TEXT_SELECTION", !0), n(this, "ENABLE_COPY", !0), n(this, "ENABLE_PASTER", !0), n(this, "ENABLE_RESIZE_ROW", !0), n(this, "ENABLE_RESIZE_COLUMN", !0), n(this, "RESIZE_COLUMN_DIVIDER_COLOR"), n(this, "RESIZE_ROW_LINE_COLOR", "#e1e6eb"), n(this, "RESIZE_COLUMN_LINE_COLOR", "#e1e6eb"), n(this, "ENABLE_RESIZE_COLUMN_TEXT", !0), n(this, "RESIZE_COLUMN_TEXT_COLOR", "#fff"), n(this, "RESIZE_COLUMN_TEXT_BG_COLOR", "rgb(82,146,247)"), n(this, "RESIZE_ROW_MIN_HEIGHT", 36), n(this, "RESIZE_COLUMN_MIN_WIDTH", 40), n(this, "DRAG_TIP_BG_COLOR", "rgba(82,146,247,0.1)"), n(this, "DRAG_TIP_LINE_COLOR", "rgb(82,146,247)"), n(this, "ENABLE_KEYBOARD", !0), n(this, "ENABLE_HISTORY", !1), n(this, "ENABLE_VALIDATOR_IMMEDIATE", !0), n(this, "HISTORY_NUM", 50), n(this, "HIGHLIGHT_HOVER_ROW", !1), n(this, "HIGHLIGHT_HOVER_ROW_COLOR", "rgba(186,203,231,0.1)"), n(this, "HIGHLIGHT_SELECTED_ROW", !1), n(this, "HIGHLIGHT_SELECTED_ROW_COLOR", "rgba(82,146,247,0.1)"), n(this, "TOOLTIP_BG_COLOR", "#303133"), n(this, "TOOLTIP_TEXT_COLOR", "#fff"), n(this, "TOOLTIP_ZINDEX", 3e3), n(this, "TOOLTIP_CUSTOM_STYLE", {}), n(this, "CONTEXT_MENU", [{ value: "copy" }, { value: "cut" }, { value: "paste" }, { value: "clearSelected" }]), n(this, "CUSTOM_BODY_CONTEXT_MENU", []), n(this, "HEADER_CONTEXT_MENU", [
      { value: "fixedLeft" },
      { value: "fixedRight" },
      { value: "fixedNone" },
      { value: "hide" },
      { value: "visible" },
      { value: "resetHeader" }
    ]), n(this, "CUSTOM_HEADER_CONTEXT_MENU", []), n(this, "CELL_LINE_HEIGHT", 1.2), n(this, "AUTO_ROW_HEIGHT", !1), n(this, "ENABLE_DRAG_COLUMN", !1), n(this, "ENABLE_DRAG_ROW", !1), n(this, "ENABLE_DRAG_ROW_CROSS_LEVEL", !1), n(this, "ENABLE_DRAG_ROW_CUSTOM", !1), n(this, "DRAG_ROW_TIP_LINE_COLOR", "rgb(82,146,247)"), n(this, "DRAG_ROW_ICON_SVG", ""), n(this, "DRAG_ROW_ICON_SIZE", 18), n(this, "DRAG_ROW_ICON_COLOR", "#bec4c7"), n(this, "HEADER_CELL_STYLE_METHOD"), n(this, "BODY_CELL_STYLE_METHOD"), n(this, "FOOTER_CELL_STYLE_METHOD"), n(this, "BODY_CELL_READONLY_METHOD"), n(this, "BODY_CELL_FORMATTER_METHOD"), n(this, "BODY_CELL_RULES_METHOD"), n(this, "BODY_CELL_TYPE_METHOD"), n(this, "BODY_CELL_EDITOR_METHOD"), n(this, "BODY_CELL_RENDER_METHOD"), n(this, "BODY_CELL_HOVER_ICON_METHOD"), n(this, "SPAN_METHOD"), n(this, "SELECTABLE_METHOD"), n(this, "EXPAND_LAZY_METHOD"), n(this, "BEFORE_VALUE_CHANGE_METHOD"), n(this, "BEFORE_PASTE_DATA_METHOD"), n(this, "BEFORE_AUTOFILL_DATA_METHOD"), n(this, "BEFORE_SET_SELECTOR_METHOD"), n(this, "BEFORE_SET_AUTOFILL_METHOD"), n(this, "BEFORE_HEADER_CONTEXT_MENU_METHOD"), n(this, "BEFORE_BODY_CONTEXT_MENU_METHOD"), n(this, "BEFORE_COPY_METHOD"), n(this, "BEFORE_DRAG_ROW_METHOD"), this._config = t, this.updateCssVar();
  }
  /** 初始化 */
  init(t) {
    this._config = t, this.updateCssVar();
  }
  /** 同步css 样式变量 */
  updateCssVar() {
    let t = {};
    Object.keys(this).forEach((e) => {
      if (e.endsWith("_COLOR") || e.endsWith("_FONT")) {
        const i = `--evt-${e.toLocaleLowerCase().replace(/_/g, "-")}`, s = ke(i);
        s && (t[e] = s);
      }
    }), Object.assign(this, t, this._config);
  }
}
const ut = `<svg t="1724122015492" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4237" width="32" height="32"><path d="M401.472 316.992l159.04 217.664L591.488 512l-30.976-22.656-159.04 217.728q-2.24 3.008-3.84 6.464-1.6 3.456-2.496 7.104-0.896 3.648-1.024 7.424-0.192 3.84 0.384 7.552 0.64 3.712 1.92 7.296 1.28 3.52 3.2 6.784 1.984 3.2 4.544 6.016 2.56 2.752 5.632 4.992 3.072 2.24 6.464 3.84 3.456 1.6 7.168 2.496 3.648 0.896 7.424 1.024 3.776 0.192 7.488-0.448 3.776-0.576 7.296-1.856 3.584-1.28 6.784-3.264 3.2-1.92 6.016-4.48 2.816-2.56 5.056-5.632l159.04-217.728q3.584-4.928 5.504-10.752 1.92-5.76 1.92-11.904 0-6.08-1.92-11.904-1.92-5.76-5.504-10.752L463.488 271.68q-2.24-3.072-5.056-5.632-2.752-2.56-6.016-4.48-3.2-1.984-6.784-3.328-3.52-1.28-7.296-1.856-3.712-0.576-7.488-0.448-3.84 0.192-7.424 1.088-3.712 0.896-7.168 2.496-3.392 1.6-6.4 3.84-3.136 2.176-5.696 4.992-2.56 2.752-4.48 6.016-1.984 3.2-3.264 6.784-1.28 3.52-1.92 7.296-0.576 3.712-0.384 7.488 0.128 3.84 1.024 7.488 0.896 3.648 2.496 7.04 1.6 3.456 3.84 6.528z m30.976-61.056q-3.776 0-7.488 0.704-3.712 0.768-7.168 2.24-3.52 1.408-6.656 3.52-3.2 2.112-5.824 4.8-2.688 2.624-4.8 5.76-2.112 3.2-3.52 6.656-1.472 3.52-2.176 7.232-0.768 3.712-0.768 7.488 0 3.776 0.768 7.488 0.704 3.712 2.176 7.232 1.408 3.456 3.52 6.592 2.112 3.2 4.8 5.824 2.688 2.688 5.76 4.8 3.2 2.112 6.72 3.52 3.456 1.472 7.168 2.176 3.712 0.768 7.488 0.768 3.84 0 7.488-0.768 3.712-0.704 7.232-2.176 3.456-1.408 6.592-3.52 3.2-2.112 5.824-4.8 2.688-2.688 4.8-5.76 2.112-3.2 3.52-6.656 1.472-3.52 2.24-7.232 0.704-3.712 0.704-7.488 0-3.84-0.704-7.488-0.768-3.712-2.24-7.232-1.408-3.456-3.52-6.592-2.112-3.2-4.8-5.824-2.624-2.688-5.76-4.8-3.2-2.112-6.656-3.52-3.52-1.472-7.232-2.24Q436.224 256 432.448 256z m0 435.392q-3.776 0-7.488 0.704-3.712 0.768-7.168 2.176-3.52 1.472-6.656 3.584-3.2 2.112-5.824 4.736-2.688 2.688-4.8 5.824-2.112 3.2-3.52 6.656-1.472 3.52-2.176 7.232-0.768 3.712-0.768 7.488 0 3.776 0.768 7.488 0.704 3.712 2.176 7.168 1.408 3.52 3.52 6.656 2.112 3.2 4.8 5.76 2.688 2.752 5.76 4.8 3.2 2.112 6.72 3.584 3.456 1.472 7.168 2.176 3.712 0.768 7.488 0.768 3.84 0 7.488-0.768 3.712-0.704 7.232-2.176 3.456-1.472 6.592-3.584 3.2-2.048 5.824-4.736 2.688-2.688 4.8-5.824 2.112-3.2 3.52-6.656 1.472-3.456 2.24-7.168 0.704-3.712 0.704-7.488 0-3.84-0.704-7.488-0.768-3.712-2.24-7.232-1.408-3.52-3.52-6.656-2.112-3.136-4.8-5.76-2.624-2.688-5.76-4.8-3.2-2.112-6.656-3.584-3.52-1.408-7.232-2.176-3.712-0.704-7.488-0.704z" p-id="4238"></path></svg>\r
`, Gt = `<svg t="1722595535853" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4551" width="32" height="32"><path d="M640 128H384c-170.496 0-256 85.504-256 256v256c0 170.496 85.504 256 256 256h256c170.496 0 256-85.504 256-256V384c0-170.496-85.504-256-256-256z m67.584 302.592c-2.048 4.608-4.608 8.704-8.192 12.288L506.88 634.88c-3.584 3.584-7.68 6.144-12.288 8.192-4.608 2.048-9.728 3.072-14.848 3.072s-10.24-1.024-14.848-3.072c-4.608-2.048-8.704-4.608-12.288-8.192l-96.256-96.256c-3.584-3.584-6.144-7.68-8.192-12.288-2.048-4.608-3.072-9.728-3.072-14.848 0-2.56 0-5.12 1.024-7.68 0.512-2.56 1.024-5.12 2.048-7.168 1.024-2.56 2.048-4.608 3.584-6.656 1.536-2.048 3.072-4.096 4.608-5.632 1.536-2.048 3.584-3.584 5.632-4.608 2.048-1.536 4.096-2.56 6.656-3.584 2.56-1.024 4.608-1.536 7.168-2.048 2.56-0.512 5.12-0.512 7.68-0.512 5.12 0 10.24 1.024 14.848 3.072 4.608 2.048 8.704 4.608 12.288 8.192l69.12 68.608L645.12 389.12c3.584-3.584 7.68-6.144 12.288-8.192 4.608-2.048 9.728-3.072 14.848-3.072 2.56 0 5.12 0 7.68 0.512s5.12 1.024 7.168 2.048c2.56 1.024 4.608 2.048 6.656 3.584 2.048 1.536 4.096 3.072 5.632 4.608 1.536 1.536 3.584 3.584 4.608 5.632 1.536 2.048 2.56 4.096 3.584 6.656 1.024 2.56 1.536 4.608 2.048 7.168 0.512 2.56 1.024 5.12 1.024 7.68 0 5.12-1.024 10.24-3.072 14.848z" p-id="4552"></path></svg>
`, $t = `<svg t="1724122044148" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4551" width="32" height="32"><path d="M707.648 401.28L489.28 560.704l22.656 30.976 22.656-30.976L316.16 401.216q-3.072-2.24-6.464-3.84-3.456-1.536-7.104-2.432-3.712-0.896-7.488-1.088-3.776-0.128-7.488 0.448-3.776 0.64-7.296 1.92-3.584 1.28-6.784 3.2-3.2 1.984-6.016 4.544-2.816 2.56-5.056 5.632-2.176 3.072-3.84 6.464-1.536 3.456-2.432 7.104-0.896 3.712-1.088 7.488-0.128 3.776 0.448 7.488 0.64 3.776 1.92 7.296 1.28 3.584 3.2 6.784 1.984 3.2 4.544 6.016 2.56 2.752 5.632 4.992l218.368 159.552q4.928 3.584 10.752 5.504 5.76 1.92 11.904 1.92 6.08 0 11.904-1.92 5.76-1.92 10.752-5.504l218.368-159.552q3.008-2.24 5.568-4.992 2.56-2.816 4.544-6.016 1.92-3.2 3.264-6.784 1.28-3.52 1.92-7.296 0.576-3.712 0.384-7.488-0.128-3.84-1.024-7.488-0.896-3.648-2.496-7.04-1.6-3.456-3.84-6.528-2.24-3.072-4.992-5.632-2.816-2.56-6.016-4.48-3.2-1.984-6.784-3.328-3.584-1.28-7.296-1.856-3.712-0.64-7.488-0.448-3.84 0.192-7.488 1.088-3.648 0.896-7.04 2.496-3.456 1.536-6.528 3.84z m61.056 30.976q0-3.84-0.768-7.488-0.704-3.712-2.176-7.232-1.472-3.456-3.52-6.656-2.112-3.136-4.8-5.76-2.688-2.688-5.76-4.8-3.2-2.112-6.72-3.584-3.456-1.408-7.168-2.176-3.712-0.704-7.488-0.704-3.84 0-7.488 0.704-3.712 0.768-7.232 2.176-3.456 1.472-6.656 3.584-3.136 2.112-5.76 4.8-2.688 2.624-4.8 5.76-2.112 3.2-3.584 6.656-1.408 3.52-2.176 7.232-0.704 3.712-0.704 7.488 0 3.776 0.704 7.488 0.768 3.712 2.176 7.168 1.472 3.52 3.584 6.656 2.112 3.2 4.8 5.824 2.624 2.688 5.76 4.8 3.2 2.112 6.656 3.52 3.52 1.472 7.232 2.176 3.712 0.768 7.488 0.768 3.776 0 7.488-0.768 3.712-0.704 7.168-2.176 3.52-1.408 6.656-3.52 3.2-2.112 5.824-4.8 2.688-2.688 4.8-5.76 2.048-3.2 3.52-6.72 1.472-3.456 2.176-7.168 0.768-3.712 0.768-7.488z m-436.736 0q0-3.84-0.768-7.488-0.704-3.712-2.176-7.232-1.408-3.456-3.52-6.656-2.112-3.136-4.8-5.76-2.688-2.688-5.76-4.8-3.2-2.112-6.656-3.584-3.52-1.408-7.232-2.176-3.712-0.704-7.488-0.704-3.84 0-7.488 0.704-3.712 0.768-7.232 2.176-3.456 1.472-6.592 3.584-3.2 2.112-5.824 4.8-2.688 2.624-4.8 5.76-2.112 3.2-3.52 6.656-1.472 3.52-2.24 7.232-0.704 3.712-0.704 7.488 0 3.776 0.704 7.488 0.768 3.712 2.24 7.168 1.408 3.52 3.52 6.656 2.112 3.2 4.8 5.824 2.624 2.688 5.76 4.8 3.2 2.112 6.656 3.52 3.52 1.472 7.232 2.176 3.712 0.768 7.488 0.768 3.776 0 7.488-0.768 3.712-0.704 7.232-2.176 3.456-1.408 6.592-3.52 3.2-2.112 5.824-4.8 2.688-2.688 4.8-5.76 2.112-3.2 3.52-6.72 1.472-3.456 2.176-7.168 0.768-3.712 0.768-7.488z" p-id="4552"></path></svg>
`, Ht = `<svg t="1755138507987" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5079" width="200" height="200"><path d="M512 938.688a42.688 42.688 0 0 1-35.072-18.432l-192-277.312A42.56 42.56 0 0 1 320 576h384a42.752 42.752 0 0 1 35.072 66.944l-192 277.312a42.688 42.688 0 0 1-35.072 18.432" fill="currentColor" p-id="2016"></path><path d="M704 448H320a42.752 42.752 0 0 1-35.072-66.944l192-277.312c16-23.04 54.208-23.04 70.144 0l192 277.312A42.56 42.56 0 0 1 704 448" fill="currentColor" p-id="2015"></path></svg>
`, de = `<svg t="1724133395728" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2893" width="32" height="32"><path d="M512 226.8476541a19.82487759 19.82487759 0 0 1 14.66497778 5.70304692c3.80203107 3.82918865 5.70304692 8.71751457 5.70304693 14.66497779v122.20814825a19.82487759 19.82487759 0 0 1-5.70304693 14.66497778 19.82487759 19.82487759 0 0 1-14.66497778 5.70304691 19.82487759 19.82487759 0 0 1-14.66497778-5.70304691 19.82487759 19.82487759 0 0 1-5.70304693-14.66497778v-122.20814825a19.82487759 19.82487759 0 0 1 5.70304693-14.66497779 19.82487759 19.82487759 0 0 1 14.66497778-5.70304692z m0 407.36049415a19.82487759 19.82487759 0 0 1 14.66497778 5.70304691c3.80203107 3.82918865 5.70304692 8.71751457 5.70304693 14.66497778v122.20814827a19.82487759 19.82487759 0 0 1-5.70304693 14.66497776 19.82487759 19.82487759 0 0 1-14.66497778 5.70304693 19.82487759 19.82487759 0 0 1-14.66497778-5.70304693 19.82487759 19.82487759 0 0 1-5.70304693-14.66497776v-122.20814827a19.82487759 19.82487759 0 0 1 5.70304693-14.66497778 19.82487759 19.82487759 0 0 1 14.66497778-5.70304691zM797.1523459 512a19.82487759 19.82487759 0 0 1-5.70304692 14.66497778 19.82487759 19.82487759 0 0 1-14.66497779 5.70304693h-122.20814825a19.82487759 19.82487759 0 0 1-14.66497778-5.70304693 19.82487759 19.82487759 0 0 1-5.70304691-14.66497778 19.82487759 19.82487759 0 0 1 5.70304691-14.66497778 19.82487759 19.82487759 0 0 1 14.66497778-5.70304693h122.20814825a19.82487759 19.82487759 0 0 1 14.66497779 5.70304693c3.80203107 3.82918865 5.70304692 8.71751457 5.70304692 14.66497778z m-407.36049415 0a19.82487759 19.82487759 0 0 1-5.70304691 14.66497778 19.82487759 19.82487759 0 0 1-14.66497778 5.70304693h-122.20814827a19.82487759 19.82487759 0 0 1-14.66497776-5.70304693 19.82487759 19.82487759 0 0 1-5.70304693-14.66497778 19.82487759 19.82487759 0 0 1 5.70304693-14.66497778 19.82487759 19.82487759 0 0 1 14.66497776-5.70304693h122.20814827a19.82487759 19.82487759 0 0 1 14.66497778 5.70304693c3.80203107 3.82918865 5.70304692 8.71751457 5.70304691 14.66497778zM310.22076878 310.22076878a21.29137537 21.29137537 0 0 1 14.66497779-5.70304693c5.51294514 0 10.18401235 1.90101585 14.01320099 5.70304693l86.55052591 86.57768347a20.91117183 20.91117183 0 0 1 5.73020449 14.31193182 19.28172983 19.28172983 0 0 1-6.05609289 14.013201 19.11878565 19.11878565 0 0 1-14.013201 6.05609289 20.96548698 20.96548698 0 0 1-14.31193182-5.70304692L310.22076878 338.87178998a19.06447114 19.06447114 0 0 1-5.70304693-14.01320099c0-5.54010272 1.90101585-10.42842865 5.70304693-14.66497778z m288.32975775 288.32975775a19.79772001 19.79772001 0 0 1 14.3390894-6.35482371c5.29568642 0 10.04822572 2.11827457 14.31193182 6.38198066l86.57768347 86.55052651c3.80203107 3.80203107 5.70304692 8.47309828 5.70304691 14.01320102a19.55330372 19.55330372 0 0 1-6.05609225 14.31193182 19.66193339 19.66193339 0 0 1-14.31193245 6.05609288 19.01015661 19.01015661 0 0 1-14.01320099-5.70304692l-86.55052591-86.57768347a19.79772001 19.79772001 0 0 1-6.38198129-14.31193245c0-5.29568642 2.11827457-10.07538268 6.38198129-14.33908939zM713.77923122 310.22076878c3.80203107 4.26370672 5.70304692 9.15203265 5.70304693 14.66497779s-1.90101585 10.18401235-5.70304693 14.01320099l-86.57768347 86.55052591a20.91117183 20.91117183 0 0 1-14.31193182 5.73020449 19.28172983 19.28172983 0 0 1-14.013201-6.05609289 19.11878565 19.11878565 0 0 1-6.05609289-14.013201c0-5.29568642 1.90101585-10.07538268 5.70304692-14.31193182l86.57768348-86.57768347c3.80203107-3.80203107 8.50025585-5.70304692 14.01320099-5.70304693 5.54010272 0 10.40127108 1.90101585 14.66497779 5.70304693zM425.44947347 598.57768347a19.79772001 19.79772001 0 0 1 6.35482371 14.33908939c0 5.29568642-2.11827457 10.04822572-6.38198066 14.31193245L338.89894756 713.77923122a19.06447114 19.06447114 0 0 1-14.01320099 5.70304693 19.55330372 19.55330372 0 0 1-14.31193245-6.05609227 19.68909035 19.68909035 0 0 1-6.05609227-14.31193245 19.01015661 19.01015661 0 0 1 5.70304693-14.01320099l86.57768347-86.55052591a19.79772001 19.79772001 0 0 1 14.31193182-6.38198129c5.29568642 0 10.07538268 2.11827457 14.3390894 6.38198129z" fill="#000000" fill-opacity=".65" p-id="2894"></path></svg>
`, ti = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2s.9-2 2-2s2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2z" fill="currentColor"></path></svg>
`, ei = `<svg t="1722595639920" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4708" width="32" height="32"><path d="M128 640V384a256 256 0 0 1 256-256h256a256 256 0 0 1 256 256v256a256 256 0 0 1-256 256H384a256 256 0 0 1-256-256z m64 0q0 79.552 56.256 135.744Q304.448 832 384 832h256q79.552 0 135.744-56.256Q832 719.552 832 640V384q0-79.552-56.256-135.744Q719.552 192 640 192H384q-79.552 0-135.744 56.256Q192 304.448 192 384v256z" p-id="4709"></path></svg>
`, ii = `<svg t="1722595280953" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4394" width="32" height="32"><path d="M128 384v256q0 12.608 1.28 25.088 1.216 12.544 3.648 24.832 2.432 12.352 6.08 24.384t8.448 23.68q4.864 11.584 10.752 22.72 5.952 11.072 12.928 21.504 7.04 10.496 14.976 20.224 8 9.728 16.896 18.56 8.896 8.96 18.56 16.896 9.728 8 20.224 14.976 10.432 7.04 21.504 12.928 11.136 5.888 22.72 10.688 11.648 4.864 23.68 8.512 12.032 3.648 24.32 6.08 12.352 2.432 24.896 3.712Q371.392 896 384 896h256q12.608 0 25.088-1.28 12.544-1.216 24.832-3.648 12.352-2.432 24.384-6.08t23.68-8.512q11.584-4.8 22.72-10.688 11.072-5.952 21.504-12.928 10.496-7.04 20.224-14.976 9.728-8 18.56-16.896 8.96-8.832 16.896-18.56 8-9.728 14.976-20.224 7.04-10.432 12.928-21.504 5.888-11.136 10.688-22.72 4.864-11.648 8.512-23.68 3.648-12.032 6.08-24.32 2.432-12.352 3.712-24.896Q896 652.608 896 640V384q0-12.608-1.28-25.088-1.216-12.544-3.648-24.832-2.432-12.352-6.08-24.384t-8.512-23.68q-4.8-11.584-10.688-22.72-5.952-11.072-12.928-21.504-7.04-10.496-14.976-20.224-8-9.664-16.896-18.56-8.832-8.96-18.56-16.896-9.728-8-20.224-14.976-10.432-7.04-21.504-12.928-11.136-5.888-22.72-10.752-11.648-4.8-23.68-8.448-12.032-3.648-24.32-6.08-12.352-2.432-24.896-3.712Q652.608 128 640 128H384q-12.608 0-25.088 1.28-12.544 1.216-24.832 3.648-12.352 2.432-24.384 6.08t-23.68 8.448q-11.584 4.864-22.72 10.752-11.072 5.952-21.504 12.928-10.496 7.04-20.224 14.976-9.664 8-18.56 16.896-8.96 8.896-16.896 18.56-8 9.728-14.976 20.224-7.04 10.432-12.928 21.504-5.888 11.136-10.752 22.72-4.8 11.648-8.448 23.68-3.648 12.032-6.08 24.32-2.432 12.352-3.712 24.896Q128 371.392 128 384z m566.016 166.336H330.112a38.4 38.4 0 0 1 0-76.8h363.904a38.4 38.4 0 0 1 0 76.8z" p-id="4395"></path></svg>
`, si = `<svg t="1722595946663" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4865" width="32" height="32"><path d="M128 640V384a256 256 0 0 1 256-256h256a256 256 0 0 1 256 256v256a256 256 0 0 1-256 256H384a256 256 0 0 1-256-256z" p-id="4866"></path><path d="M128 640V384a256 256 0 0 1 256-256h256a256 256 0 0 1 256 256v256a256 256 0 0 1-256 256H384a256 256 0 0 1-256-256z m64 0q0 79.552 56.256 135.744Q304.448 832 384 832h256q79.552 0 135.744-56.256Q832 719.552 832 640V384q0-79.552-56.256-135.744Q719.552 192 640 192H384q-79.552 0-135.744 56.256Q192 304.448 192 384v256z" fill="#DDE0EA" p-id="4867"></path></svg>
`, oi = `<svg t="1744798692576" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6606" width="200" height="200"><path d="M855.296 894.528H168.768v-76.8h686.528v76.8z m38.4-38.4q0 3.84-0.768 7.488-0.704 3.712-2.176 7.232-1.472 3.52-3.52 6.656-2.112 3.136-4.8 5.76-2.688 2.688-5.824 4.8-3.2 2.112-6.656 3.584-3.456 1.408-7.168 2.176-3.712 0.704-7.488 0.704-3.84 0-7.488-0.704-3.712-0.768-7.232-2.176-3.52-1.472-6.656-3.584-3.136-2.112-5.76-4.736-2.688-2.688-4.8-5.824-2.112-3.2-3.584-6.656-1.408-3.52-2.176-7.232-0.704-3.648-0.704-7.488 0-3.776 0.704-7.488 0.768-3.712 2.176-7.168 1.472-3.52 3.584-6.656 2.112-3.136 4.736-5.76 2.688-2.752 5.824-4.8 3.2-2.112 6.656-3.584 3.52-1.472 7.232-2.176 3.712-0.768 7.488-0.768 3.776 0 7.488 0.768 3.712 0.704 7.168 2.176 3.52 1.472 6.656 3.584 3.2 2.048 5.76 4.736 2.752 2.688 4.864 5.824 2.048 3.2 3.52 6.656 1.472 3.456 2.176 7.168 0.768 3.712 0.768 7.488z m-686.528 0q0 3.84-0.768 7.488-0.704 3.712-2.176 7.232-1.472 3.52-3.52 6.656-2.112 3.136-4.8 5.76-2.688 2.688-5.76 4.8-3.2 2.112-6.72 3.584-3.456 1.408-7.168 2.176-3.712 0.704-7.488 0.704-3.84 0-7.488-0.704-3.712-0.768-7.232-2.176-3.456-1.472-6.656-3.584-3.136-2.112-5.76-4.736-2.688-2.688-4.8-5.824-2.112-3.2-3.584-6.656-1.408-3.52-2.176-7.232-0.704-3.648-0.704-7.488 0-3.776 0.704-7.488 0.768-3.712 2.176-7.168 1.472-3.52 3.584-6.656 2.112-3.136 4.736-5.76 2.688-2.752 5.824-4.8 3.2-2.112 6.656-3.584 3.52-1.472 7.232-2.176 3.712-0.768 7.488-0.768 3.776 0 7.488 0.768 3.712 0.704 7.168 2.176 3.52 1.472 6.656 3.584 3.2 2.048 5.824 4.736 2.688 2.688 4.8 5.824 2.048 3.2 3.52 6.656 1.472 3.456 2.176 7.168 0.768 3.712 0.768 7.488zM652.032 211.2l-369.92 370.368v89.344h90.048l369.664-369.856L652.032 211.2z m-54.4-54.272q22.528-22.528 54.4-22.528 31.808 0 54.336 22.528l89.792 89.856q22.464 22.464 22.464 54.272t-22.464 54.272l-369.664 369.856q-22.464 22.528-54.336 22.528H282.24q-31.808 0-54.336-22.528-22.464-22.464-22.464-54.272V581.568q0-31.808 22.4-54.272l369.92-370.368z" p-id="6607"></path></svg>
`, ri = Ht.replace('fill="currentColor" p-id="2016"', 'fill="#bec4c7" p-id="2016"'), ni = Ht.replace('fill="currentColor" p-id="2015"', 'fill="#bec4c7" p-id="2015"');
class li {
  constructor(t) {
    n(this, "ctx"), n(this, "list", [
      {
        name: "loading",
        configName: "LOADING_ICON_SVG",
        configColorName: "LOADING_ICON_COLOR",
        svg: de,
        color: "#4E5969"
      },
      {
        name: "expand",
        configName: "EXPAND_ICON_SVG",
        configColorName: "EXPAND_ICON_COLOR",
        svg: ut,
        color: "#4E5969"
      },
      {
        name: "shrink",
        configName: "SHRINK_ICON_SVG",
        configColorName: "SHRINK_ICON_COLOR",
        svg: $t,
        color: "#4E5969"
      },
      {
        name: "checkbox-uncheck",
        configName: "CHECKBOX_UNCHECK_SVG",
        configColorName: "CHECKBOX_UNCHECK_COLOR",
        svg: ei,
        color: ""
      },
      {
        name: "checkbox-check",
        configName: "CHECKBOX_CHECK_SVG",
        configColorName: "CHECKBOX_COLOR",
        svg: Gt,
        color: "rgb(82,146,247)"
      },
      {
        name: "checkbox-indeterminate",
        configName: "CHECKBOX_INDETERMINATE_SVG",
        configColorName: "CHECKBOX_COLOR",
        svg: ii,
        color: "rgb(82,146,247)"
      },
      {
        name: "checkbox-check-disabled",
        configName: "CHECKBOX_CHECK_DISABLED_SVG",
        svg: Gt,
        color: "#DDE0EA"
      },
      {
        name: "checkbox-disabled",
        configName: "CHECKBOX_DISABLED_SVG",
        configColorName: "CHECKBOX_DISABLED_COLOR",
        svg: si,
        color: "#F1F2F4"
      },
      {
        name: "icon-edit",
        configName: "ICON_EDIT_SVG",
        configColorName: "ICON_EDIT_COLOR",
        svg: oi,
        color: "#4E5969"
      },
      {
        name: "icon-select",
        configName: "ICON_SELECT_SVG",
        configColorName: "ICON_SELECT_COLOR",
        svg: $t,
        color: "#4E5969"
      },
      {
        name: "sort-asc",
        configName: "SORT_ASC_ICON_SVG",
        configColorName: "SORT_ICON_COLOR",
        svg: ri,
        color: "rgb(82,146,247)"
      },
      {
        name: "sort-desc",
        configName: "SORT_DESC_ICON_SVG",
        configColorName: "SORT_ICON_COLOR",
        svg: ni,
        color: "rgb(82,146,247)"
      },
      {
        name: "sort-default",
        configName: "SORTABLE_ICON_SVG",
        svg: Ht,
        color: "#bec4c7"
      },
      {
        name: "drag",
        configName: "DRAG_ROW_ICON_SVG",
        svg: ti,
        color: "#4E5969"
      }
    ]), n(this, "icons", /* @__PURE__ */ new Map()), this.ctx = t, this.init();
  }
  async init() {
    const t = [];
    for (let e = 0; e < this.list.length; e++) {
      const i = this.list[e];
      let s = i.color, o = i.svg;
      if (i.configColorName) {
        const l = this.ctx.config[i.configColorName];
        l && (s = l);
      }
      if (i.configName) {
        const l = this.ctx.config[i.configName];
        l && (o = l);
      }
      const r = this.createImageFromSVG(o, s).then((l) => {
        this.icons.set(i.name, l);
      });
      t.push(r);
    }
    for (let e = 0; e < this.ctx.config.ICONS.length; e++) {
      const i = this.ctx.config.ICONS[e];
      let s = i.color;
      const o = this.createImageFromSVG(i.svg, s, i.isBlob).then((r) => {
        this.icons.set(i.name, r);
      });
      t.push(o);
    }
    await Promise.all(t), this.ctx.emit("draw");
  }
  async createImageFromSVG(t, e, i = !1) {
    const s = new DOMParser().parseFromString(t, "image/svg+xml").documentElement;
    e && s.querySelectorAll("*").forEach((l) => {
      const h = l.getAttribute("fill");
      (h === "currentColor" || h === null) && l.setAttribute("fill", e);
    });
    const o = new Image();
    let r = "";
    if (i) {
      const l = new Blob([new XMLSerializer().serializeToString(s)], {
        type: "image/svg+xml"
      });
      r = URL.createObjectURL(l);
    } else
      r = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(s));
    return o.src = r, new Promise((l, h) => {
      o.onerror = () => h(new Error("Failed to load image:" + t)), o.onload = () => {
        l(o);
      };
    });
  }
  get(t) {
    return this.icons.get(t);
  }
  getSvg(t) {
    return this.list.find((e) => e.name === t);
  }
}
class hi {
  constructor(t) {
    n(this, "ctx"), n(this, "visibleHoverCell"), n(this, "resizeObserver"), n(this, "mutationObserver"), this.ctx = t, this.init();
  }
  init() {
    this.resizeObserver = new ResizeObserver((t) => {
      this.ctx.emit("resetHeader"), this.ctx.emit("resizeObserver", t), this.ctx.emit("containerResize", this.ctx.containerElement);
    }), this.resizeObserver.observe(this.ctx.containerElement), this.mutationObserver = new MutationObserver((t) => {
      for (const e of t)
        e.type === "attributes" && e.attributeName === "class" && (this.ctx.config.updateCssVar(), this.ctx.emit("draw"));
    }), this.ctx.config.ENABLE_AUTO_THEME && this.mutationObserver.observe(document.documentElement, {
      attributes: !0,
      attributeFilter: ["class"]
      // ✅ 只监听 class 更改
    }), this.ctx.on("mousedown", (t) => {
      if (this.isBusy(t))
        return;
      const { offsetY: e, offsetX: i } = this.ctx.getOffset(t), s = e, o = i;
      this.isInsideBody(o, s) || this.ctx.emit("mousedownBodyOutside", t), t.button === 0 && (this.handleHeaderEvent(o, s, this.ctx.header.renderCellHeaders, (r) => {
        this.ctx.focusCellHeader = r, this.ctx.focusCell = void 0, this.ctx.emit("cellHeaderMousedown", r, t);
      }), this.handleBodyEvent(o, s, this.ctx.body.renderRows, (r) => {
        this.ctx.setFocusCell(r), this.ctx.focusCellHeader = void 0, this.ctx.emit("cellMousedown", r, t);
      }, !0));
    }), this.ctx.on("mouseup", (t) => {
      if (t.button !== 0 || this.isBusy(t))
        return;
      const { offsetY: e, offsetX: i } = this.ctx.getOffset(t), s = e, o = i;
      this.handleHeaderEvent(o, s, this.ctx.header.renderCellHeaders, (r) => {
        this.ctx.emit("cellHeaderMouseup", r, t);
      }), this.handleBodyEvent(o, s, this.ctx.body.renderRows, (r) => {
        this.ctx.emit("cellMouseup", r, t);
      });
    }), this.ctx.on("click", (t) => {
      if (t.button !== 0 || this.isBusy(t))
        return;
      const e = this.ctx.getOffset(t).offsetY, i = this.ctx.getOffset(t).offsetX;
      this.handleHeaderEvent(i, e, this.ctx.header.renderCellHeaders, (s) => {
        this.ctx.clickCellHeader = s, this.ctx.emit("cellHeaderClick", s, t);
      }), this.handleBodyEvent(
        i,
        e,
        this.ctx.body.renderRows,
        (s) => {
          this.ctx.clickCell = s, this.ctx.emit("cellClick", s, t);
          const o = s.getImage("hover");
          !this.ctx.disableHoverIconClick && o && o.isInside(i, e) && this.ctx.emit("hoverIconClick", s);
        },
        !0
      );
    }), this.ctx.on("dblclick", (t) => {
      if (t.button !== 0 || this.isBusy(t))
        return;
      const e = this.ctx.getOffset(t).offsetY, i = this.ctx.getOffset(t).offsetX;
      this.handleHeaderEvent(i, e, this.ctx.header.renderCellHeaders, (s) => {
        this.ctx.emit("cellHeaderDblclick", s, t);
      }), this.handleBodyEvent(i, e, this.ctx.body.renderRows, (s) => {
        this.ctx.clickCell = s, this.ctx.emit("cellDblclick", s, t);
      });
    }), this.ctx.on("contextMenu", (t) => {
      if (this.isBusy(t))
        return;
      const { offsetY: e, offsetX: i } = this.ctx.getOffset(t), s = e, o = i;
      this.handleHeaderEvent(o, s, this.ctx.header.renderCellHeaders, (r) => {
        this.ctx.emit("cellHeaderContextMenuClick", r, t);
      }), this.handleBodyEvent(o, s, this.ctx.body.renderRows, (r) => {
        this.ctx.emit("cellContextMenuClick", r, t);
      });
    }), this.ctx.on("mouseout", (t) => {
      !this.ctx.containerElement.contains(t.relatedTarget) && this.ctx.hoverCell !== void 0 && (this.ctx.hoverRow = void 0, this.ctx.hoverCell = void 0, this.ctx.emit("draw"));
    }), this.ctx.on("mousemove", (t) => {
      if (this.isBusy(t))
        return;
      !this.ctx.mousedown && this.ctx.stageElement.style.cursor !== "default" && (this.ctx.stageElement.style.cursor = "default");
      const e = this.ctx.getOffset(t).offsetY, i = this.ctx.getOffset(t).offsetX;
      this.handleHeaderEvent(i, e, this.ctx.header.renderCellHeaders, (s) => {
        this.imageEnterAndLeave(s, t), this.ctx.emit("cellHeaderMouseenter", s, t), this.ctx.hoverCellHeader && this.ctx.hoverCellHeader !== s && this.ctx.emit("cellHeaderMouseleave", this.ctx.hoverCellHeader, t), this.ctx.hoverCellHeader !== s && (this.ctx.hoverCellHeader = s, this.visibleHoverCell = void 0, this.ctx.emit("cellHeaderHoverChange", s, t));
      }), this.handleBodyEvent(
        i,
        e,
        this.ctx.body.renderRows,
        (s) => {
          this.imageEnterAndLeave(s, t), this.visibleHoverCell !== s && (this.ctx.emit("visibleCellMouseleave", s, t), this.visibleHoverCell = s, this.ctx.hoverCellHeader = void 0, this.ctx.emit("visibleCellHoverChange", s, t));
        },
        !0
      ), this.handleBodyEvent(i, e, this.ctx.body.renderRows, (s) => {
        var o;
        this.ctx.emit("cellMouseenter", s, t), this.ctx.hoverCell && this.ctx.hoverCell !== s && this.ctx.emit("cellMouseleave", s, t), this.ctx.hoverCell !== s && (((o = this.ctx.hoverCell) == null ? void 0 : o.rowKey) !== s.rowKey && (this.ctx.hoverCell = s, this.ctx.hoverRow = this.ctx.body.renderRows.find((r) => r.rowKey === s.rowKey), this.ctx.emit("rowHoverChange", this.ctx.hoverRow, s, t), this.ctx.emit("draw")), this.ctx.hoverCell = s, this.ctx.emit("cellHoverChange", s, t));
      }), this.handleFooterEvent(i, e, this.ctx.footer.renderRows, (s) => {
        this.ctx.emit("cellFooterMouseenter", s, t), this.ctx.hoverCell && this.ctx.hoverCell !== s && this.ctx.emit("cellFooterMouseleave", s, t), this.ctx.emit("cellFooterHoverChange", s, t);
      });
    });
  }
  /**
   * 图标进入和离开事件，包括选中，展开，提示图标等
   * @param cell
   * @param e
   */
  imageEnterAndLeave(t, e) {
    if (this.ctx.dragRowIng || this.ctx.dragHeaderIng || this.ctx.selectorMove || this.ctx.autofillMove)
      return;
    const { offsetY: i, offsetX: s } = this.ctx.getOffset(e), o = i, r = s;
    t.cellImages.forEach((l, h) => {
      l.isInside(r, o) && (h === "drag" ? this.ctx.stageElement.style.cursor = "grab" : this.ctx.stageElement.style.cursor = "pointer");
    });
  }
  isBusy(t) {
    const { offsetY: e, offsetX: i } = this.ctx.getOffset(t), s = e, o = i;
    if (this.ctx.loading || !this.ctx.isTarget(t) || this.ctx.stageElement.style.cursor === "row-resize" || this.ctx.stageElement.style.cursor === "col-resize" || this.ctx.columnResizing || this.ctx.rowResizing)
      return !0;
    const { SCROLLER_TRACK_SIZE: r } = this.ctx.config, l = V(this.ctx.config);
    return !!(this.ctx.scrollerMove || this.ctx.scrollerFocus || !l && s > this.ctx.stageHeight - r || !l && o > this.ctx.stageWidth - r);
  }
  handleBodyEvent(t, e, i, s, o = !1) {
    if (this.isInsideBody(t, e))
      for (const r of i) {
        const l = r.fixedCells.concat(r.noFixedCells);
        for (const h of l)
          if (o ? h.isInsideVisible(t, e) : h.isInside(t, e)) {
            s(h);
            return;
          }
      }
  }
  handleHeaderEvent(t, e, i, s) {
    for (const o of i)
      if (o.isInside(t, e)) {
        s(o);
        return;
      }
  }
  handleFooterEvent(t, e, i, s) {
    for (const o of i) {
      const r = o.fixedCells.concat(o.noFixedCells);
      for (const l of r)
        if (l.isInside(t, e)) {
          s(l);
          return;
        }
    }
  }
  isInsideBody(t, e) {
    const { body: {
      y: i,
      visibleHeight: s,
      height: o,
      visibleWidth: r
    } } = this.ctx, l = Math.min(o, s);
    return t > 0 && t < r && e > i && e < i + l;
  }
  destroy() {
    this.resizeObserver.unobserve(this.ctx.stageElement), this.mutationObserver.disconnect();
  }
}
const ai = {
  numberErrorTip: "只允许输入数字",
  emptyText: "暂无数据",
  loadingText: "加载中...",
  copy: "复制",
  cut: "剪切",
  paste: "粘贴",
  clearSelected: "清空选中内容",
  fixedLeft: "左固定",
  fixedRight: "右固定",
  fixedNone: "取消固定",
  hide: "隐藏",
  visible: "显示",
  resetHeader: "恢复默认",
  invalidNumber: "请输入数字类型",
  mergeCellNoFill: "合并单元格不能填充",
  mergeCellNoCopy: "合并单元格不能复制",
  mergeCellNoPaste: "合并单元格不能粘贴",
  numberTruncated: "输入的数字已截取至小数点后{precision}位",
  batchSetItemValueError: "批量赋值错误",
  numberMin: "输入值小于{min}，已自动调整为{min}",
  numberMax: "输入值大于{max}，已自动调整为{max}",
  stringMaxlength: "输入值超过{maxlength}个字符，已自动截取"
};
class ci {
  constructor() {
    n(this, "langConfig");
  }
  use(t) {
    this.langConfig = t;
  }
  getText(t, e) {
    const i = { ...ai };
    Object.assign(i, ds.locale, this.langConfig);
    const s = i[t];
    return s ? s.replace(/{(\w+)}/g, (o, r) => e?.[r] || o) : "";
  }
}
class di {
  constructor(t, e) {
    n(this, "eventBus"), n(this, "eventBrowser"), n(this, "eventTable"), n(this, "locale", new ci()), n(this, "containerElement"), n(this, "stageElement"), n(this, "canvasElement"), n(this, "overlayerElement"), n(this, "editorElement"), n(this, "emptyElement"), n(this, "contextMenuElement"), n(this, "loadingElement"), n(this, "stageWidth", 0), n(this, "stageHeight", 0), n(this, "paint"), n(this, "icons"), n(this, "domSelectionStr", ""), n(this, "textSelectionStr", ""), n(this, "textSelecting", !1), n(this, "isMouseoverTargetContainer", !1), n(this, "mousedown", !1), n(this, "isEmpty", !1), n(this, "rowResizing", !1), n(this, "columnResizing", !1), n(this, "scrollerMove", !1), n(this, "scrollerFocus", !1), n(this, "autofillMove", !1), n(this, "selectorMove", !1), n(this, "disableHoverIconClick", !1), n(this, "selectColsIng", !1), n(this, "selectRowsIng", !1), n(this, "dragHeaderIng", !1), n(this, "dragRowIng", !1), n(this, "finding", !1), n(this, "contextMenuIng", !1), n(this, "editing", !1), n(this, "loading", !1), n(this, "onlyMergeCell", !1), n(this, "selectOnlyOne", !1), n(this, "hasSelection", !1), n(this, "hasTree", !1), n(this, "scrollY", 0), n(this, "scrollX", 0), n(this, "fixedLeftWidth", 0), n(this, "fixedRightWidth", 0), n(this, "lastCenterColIndex", 0), n(this, "maxColIndex", 0), n(this, "maxRowIndex", 0), n(this, "hoverRow"), n(this, "clickCell"), n(this, "focusCell"), n(this, "currentCell"), n(this, "hoverCell"), n(this, "clickCellHeader"), n(this, "focusCellHeader"), n(this, "hoverCellHeader"), n(this, "mouseX", 0), n(this, "mouseY", 0), n(this, "body", {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visibleHeight: 0,
      visibleWidth: 0,
      headIndex: 0,
      tailIndex: 0,
      visibleRows: [],
      renderRows: [],
      data: []
    }), n(this, "footer", {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visibleHeight: 0,
      visibleWidth: 0,
      renderRows: []
    }), n(this, "header", {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visibleHeight: 0,
      visibleWidth: 0,
      visibleLeafColumns: [],
      leafCellHeaders: [],
      allCellHeaders: [],
      renderLeafCellHeaders: [],
      renderCellHeaders: [],
      fixedLeftCellHeaders: [],
      fixedRightCellHeaders: [],
      renderCenterCellHeaders: []
    }), n(this, "selector", {
      enable: !1,
      xArr: [-1, -1],
      yArr: [-1, -1],
      xArrCopy: [-1, -1],
      yArrCopy: [-1, -1]
    }), n(this, "autofill", {
      enable: !1,
      xArr: [-1, -1],
      yArr: [-1, -1]
    }), n(this, "finderBar", {
      text: "",
      rowIndex: -1,
      colIndex: -1,
      type: "body"
    }), n(this, "database"), n(this, "history"), n(this, "config");
    const {
      containerElement: i,
      stageElement: s,
      canvasElement: o,
      overlayerElement: r,
      editorElement: l,
      emptyElement: h,
      loadingElement: c,
      contextMenuElement: u
    } = t;
    this.containerElement = i, s.tabIndex = 0, this.stageElement = s, this.canvasElement = o, this.overlayerElement = r, this.editorElement = l, this.emptyElement = h, this.loadingElement = c, this.contextMenuElement = u, this.config = new Pt(e.config || {}), this.eventBus = new Je(), this.eventBrowser = new Ze(this), this.eventTable = new hi(this), this.paint = new Qe(this.canvasElement), this.database = new je(this, e), this.history = new qe(this), this.icons = new li(this);
  }
  setConfig(t) {
    this.config = new Pt(t);
  }
  setItemValueByEditor(t, e, i, s = !0, o = !0, r = !0) {
    if (this.config.ENABLE_MERGE_CELL_LINK) {
      const l = this.database.getVirtualBodyCellByKey(t, e);
      if (l && (l.mergeRow || l.mergeCol)) {
        const { dataList: h } = l.getSpanInfo(), c = h.map((u) => ({ ...u, value: i }));
        this.database.batchSetItemValue(c, s, r);
        return;
      }
    }
    this.database.setItemValue(t, e, i, s, o, !0, r);
  }
  batchSetItemValueByEditor(t, e = !0, i = !0) {
    if (this.config.ENABLE_MERGE_CELL_LINK) {
      const s = [];
      t.forEach((o) => {
        const r = this.database.getRowIndexForRowKey(o.rowKey), l = this.database.getColIndexForKey(o.key);
        if (r === void 0 || l === void 0) return;
        const h = this.database.getVirtualBodyCell(r, l);
        if (h) {
          const { dataList: c } = h.getSpanInfo(), u = c.map((d) => ({ ...d, value: o.value }));
          s.push(...u);
        }
      }), this.database.batchSetItemValue(s, e, i);
    } else
      this.database.batchSetItemValue(t, e, i);
  }
  setFocusCell(t) {
    var e;
    if (this.focusCell !== t) {
      if (((e = this.focusCell) == null ? void 0 : e.rowKey) !== t.rowKey) {
        this.currentCell = t, this.emit("rowFocusChange", t);
        const i = {
          rowIndex: t.rowIndex,
          rowKey: t.rowKey,
          row: t.row
        };
        this.emit("currentRowChange", i);
      }
      this.focusCell = t, this.emit("cellFocusChange", t);
    }
  }
  clearSelector() {
    this.selector.enable = !1, this.selector.xArr = [-1, -1], this.selector.yArr = [-1, -1], this.emit("clearSelector");
  }
  clearSelectorCopy() {
    this.selector.xArrCopy = [-1, -1], this.selector.yArrCopy = [-1, -1];
  }
  clearAutofill() {
    this.autofill = {
      enable: !1,
      xArr: [-1, -1],
      yArr: [-1, -1]
    };
  }
  /**
   * 获取选中的数据
   * @returns
   */
  getSelectedData() {
    var t;
    const e = [], i = this.selector.yArr, s = this.selector.xArr;
    let o = "";
    for (let r = 0; r <= i[1] - i[0]; r++) {
      const l = [];
      for (let h = 0; h <= s[1] - s[0]; h++) {
        const c = r + i[0], u = h + s[0], d = this.database.getVirtualBodyCell(c, u);
        if (d)
          if ((t = d?.column) != null && t.formatterSelectorValue) {
            const {
              row: x,
              rowIndex: f,
              colIndex: m,
              column: g
            } = d, w = d.column.formatterSelectorValue({
              row: x,
              rowIndex: f,
              colIndex: m,
              column: g,
              value: d.getValue()
            });
            l.push(w);
          } else d.selectorCellValueType === "displayText" ? l.push(d.displayText) : l.push(d.getValue());
      }
      o += `${l.join("	")}\r`, e.push(l);
    }
    return o = o ? o.replace(/\r$/, "") : " ", {
      xArr: s,
      yArr: i,
      text: o,
      value: e
    };
  }
  setScroll(t, e) {
    let i = Math.floor(t);
    const s = this.body.width - this.body.visibleWidth;
    i < 0 ? i = 0 : i > s && (i = s);
    let o = Math.floor(e), r = this.body.height - this.body.visibleHeight;
    this.config.FOOTER_FIXED || (r = this.body.height + this.footer.height - this.body.visibleHeight), o < 0 ? o = 0 : o > r && (o = r), this.emit("setScroll", i, o);
  }
  setScrollX(t) {
    let e = Math.floor(t);
    const i = this.body.width - this.body.visibleWidth;
    e < 0 ? e = 0 : e > i && (e = i), this.emit("setScrollX", e);
  }
  setScrollY(t) {
    let e = Math.floor(t), i = 0;
    this.config.FOOTER_FIXED || (i = this.footer.height);
    const s = this.body.height - this.body.visibleHeight + i;
    e < 0 ? e = 0 : e > s && (e = s), this.emit("setScrollY", e);
  }
  startAdjustPosition(t) {
    this.emit("startAdjustPosition", t);
  }
  stopAdjustPosition() {
    this.emit("stopAdjustPosition");
  }
  isTarget(t) {
    return !!this.containerElement.contains(t.target);
  }
  getOffset(t) {
    const { left: e, top: i } = this.containerElement.getBoundingClientRect();
    return {
      offsetX: t.clientX - e,
      offsetY: t.clientY - i
    };
  }
  hasEvent(t) {
    return this.eventBus.has(t);
  }
  on(t, e) {
    this.eventBus.on(t, e);
  }
  once(t, e) {
    this.eventBus.once(t, e);
  }
  off(t, e) {
    this.eventBus.off(t, e);
  }
  emit(t, ...e) {
    this.eventBus.emit(t, ...e);
  }
  destroy() {
    this.eventTable.destroy(), this.eventBrowser.destroy(), this.eventBus.destroy();
  }
}
function Ut(a, t, e, i = t, s = 30) {
  if (a <= 0 || t <= 0 || e <= 0 || i <= 0)
    return 0;
  const o = Math.floor(t / e * i);
  return o < s ? Math.min(s, i) : o > i ? 0 : o;
}
function ui(a) {
  return a.shiftKey ? Math.abs(a.deltaX) > Math.abs(a.deltaY) ? a.deltaX : a.deltaY : a.deltaX;
}
class jt {
  constructor(t, e) {
    n(this, "ctx"), n(this, "type"), n(this, "isFocus", !1), n(this, "trackX", 0), n(this, "trackY", 0), n(this, "trackWidth", 0), n(this, "trackHeight", 0), n(this, "splitPoints", []), n(this, "barX", 0), n(this, "barY", 0), n(this, "barWidth", 0), n(this, "barHeight", 0), n(this, "distance", 0), n(this, "visibleDistance", 0), n(this, "thumbTrackDistance", 0), n(this, "thumbTravelDistance", 0), n(this, "clientX", 0), n(this, "clientY", 0), n(this, "dragStart", 0), n(this, "innerVisible", !1), n(this, "innerShowTimer", 0), n(this, "isDragging", !1), n(this, "scroll", 0), this.ctx = t, this.type = e, this.type === "vertical" ? this.scroll = this.ctx.scrollY : this.scroll = this.ctx.scrollX;
  }
  onWheel(t) {
    this.updateScroll(t);
  }
  onTouchmove(t) {
    const { clientY: e, clientX: i } = t.touches[0], s = e - this.clientY, o = i - this.clientX;
    let r = 0;
    this.type === "vertical" ? (r = Math.max(0, Math.min(this.dragStart - s, this.distance)), this.hasScrollbar() && !(r === 0 && s > 0 || r === this.distance && s < 0) && t.preventDefault()) : this.type === "horizontal" && (r = Math.max(0, Math.min(this.dragStart - o, this.distance))), this.scroll = r;
  }
  onTouchstart(t) {
    const { clientY: e, clientX: i } = t.touches[0];
    this.clientX = i, this.clientY = e, this.dragStart = this.scroll;
  }
  onMouseDown(t) {
    if (!(t.target instanceof Element) || !this.ctx.isTarget(t))
      return;
    if (this.ctx.stageElement.style.cursor === "row-resize" || this.ctx.stageElement.style.cursor === "col-resize")
      return !0;
    const { clientX: e, clientY: i } = t, { offsetX: s, offsetY: o } = this.ctx.getOffset(t);
    if (!(e == this.clientX && i == this.clientY) && !(this.isInnerMode() && !this.canInteractWithScrollbar())) {
      if (this.isOnScrollbar(s, o))
        this.clientX = e, this.clientY = i, this.isDragging = !0, this.ctx.scrollerMove = !0, this.isFocus = !0, this.dragStart = this.scroll, t.preventDefault();
      else if (this.isOnTrack(s, o)) {
        let r = 0;
        this.type === "vertical" ? r = (o - this.ctx.header.height - this.barHeight / 2) / this.thumbTravelDistance * this.distance : r = (s - this.barWidth / 2) / this.thumbTravelDistance * this.distance, this.scroll = Math.max(0, Math.min(r, this.distance));
      }
    }
  }
  onMouseUp() {
    this.isDragging = !1, this.isFocus = !1, this.clientX = 0, this.clientY = 0;
  }
  onMouseMove(t, e) {
    const { clientX: i, clientY: s, buttons: o } = t, { offsetX: r, offsetY: l } = this.ctx.getOffset(t);
    let h = !1;
    if (Ve(this.ctx.config, e) ? this.startInnerShowTimer() : h = this.hideInnerScrollbar(), this.canInteractWithScrollbar() && (this.isOnScrollbar(r, l) || this.isOnTrack(r, l)) && e ? (this.isFocus = !0, this.ctx.stageElement.style.cursor = "pointer") : this.isFocus = !1, o === 0 || i == this.clientX && s == this.clientY) return h;
    let c = 0;
    if (this.type === "horizontal" ? c = i - this.clientX : c = s - this.clientY, this.isDragging && c !== 0) {
      let u = 0;
      this.type === "vertical" ? u = this.dragStart + c / this.thumbTravelDistance * this.distance : u = this.dragStart + c / this.thumbTravelDistance * this.distance, this.scroll = Math.max(0, Math.min(u, this.distance));
    }
    return h;
  }
  isPointInElement(t, e, i, s, o, r) {
    return t >= i && t <= i + o && e >= s && e <= s + r;
  }
  hasScrollbar() {
    return this.type === "vertical" ? this.barHeight > 0 : this.type === "horizontal" ? this.barWidth > 0 : !1;
  }
  isOnScrollbar(t, e) {
    return this.isPointInElement(t, e, this.barX, this.barY, this.barWidth, this.barHeight);
  }
  isOnTrack(t, e) {
    return this.isPointInElement(t, e, this.trackX, this.trackY, this.trackWidth, this.trackHeight);
  }
  isInnerMode() {
    return V(this.ctx.config);
  }
  shouldDrawInnerScrollbar() {
    return ze(this.ctx.config, {
      innerVisible: this.innerVisible,
      isFocus: this.isFocus,
      isDragging: this.isDragging
    });
  }
  canInteractWithScrollbar() {
    return !this.isInnerMode() || this.shouldDrawInnerScrollbar();
  }
  startInnerShowTimer() {
    if (!this.isInnerMode() || this.innerVisible || this.innerShowTimer)
      return;
    const t = Math.max(0, this.ctx.config.SCROLLBAR_SHOW_DELAY || 0);
    this.innerShowTimer = window.setTimeout(() => {
      this.innerVisible = !0, this.innerShowTimer = 0, this.ctx.emit("draw");
    }, t);
  }
  cancelInnerShowTimer() {
    this.innerShowTimer && (clearTimeout(this.innerShowTimer), this.innerShowTimer = 0);
  }
  hideInnerScrollbar() {
    if (!this.isInnerMode() || this.isDragging)
      return !1;
    const t = this.innerVisible || this.isFocus;
    return this.cancelInnerShowTimer(), this.innerVisible = !1, this.isFocus = !1, t;
  }
  updateScroll(t) {
    const e = t.deltaY;
    if (this.type === "vertical" && t.shiftKey === !1)
      this.hasScrollbar() && !(this.scroll === 0 && e < 0 || this.scroll === this.distance && e > 0) && t.preventDefault(), this.scroll = Math.max(0, Math.min(this.scroll + e, this.distance));
    else if (this.type === "horizontal") {
      const i = ui(t), s = this.hasScrollbar();
      i !== 0 && s && !(this.scroll === 0 && i < 0 || this.scroll === this.distance && i > 0) && t.preventDefault(), this.scroll = Math.max(0, Math.min(this.scroll + i, this.distance));
    }
  }
  updatedSize() {
    const {
      body: t,
      header: e,
      stageHeight: i,
      stageWidth: s,
      config: { SCROLLER_SIZE: o = 0, BORDER: r }
    } = this.ctx, l = B(this.ctx.config), h = he(this.ctx.config), c = s, u = i, d = e.height, x = e.width, f = t.height, m = this.ctx.footer.height, g = u - l - d, w = c - l, C = Math.max(0, f - g + m), E = Math.max(0, x - w), b = Xe(this.ctx.config);
    if (this.type === "vertical") {
      this.visibleDistance = g, this.distance = C;
      const p = zt(this.ctx.config, E > 0);
      this.thumbTrackDistance = Math.max(0, this.visibleDistance - p), this.trackX = c - h, this.trackY = 0, this.splitPoints = [this.trackX, d, this.trackX + h, d], this.trackWidth = h, this.trackHeight = Math.max(0, u - p), this.barX = this.trackX - 1 + (h - o) / 2, this.barWidth = o, this.barHeight = Ut(
        this.distance,
        this.visibleDistance,
        f + m,
        this.thumbTrackDistance
      ), this.thumbTravelDistance = Math.max(0, this.thumbTrackDistance - this.barHeight - b);
      const y = this.distance ? this.scroll / this.distance : 0;
      this.barY = d + y * this.thumbTravelDistance, this.scroll = Math.max(0, Math.min(this.scroll, this.distance));
    } else {
      this.visibleDistance = w, this.distance = E;
      const p = zt(this.ctx.config, C > 0);
      this.thumbTrackDistance = Math.max(0, this.visibleDistance - p), this.splitPoints = [
        c - h,
        u - h,
        c - h,
        u
      ];
      const y = _t(r) ? 0 : 0.5;
      this.trackX = 0, this.trackY = u - h + y, this.trackWidth = Math.max(0, c - p), this.trackHeight = h, this.barWidth = Ut(
        this.distance,
        this.visibleDistance,
        x,
        this.thumbTrackDistance
      ), this.thumbTravelDistance = Math.max(0, this.thumbTrackDistance - this.barWidth - b), this.barY = this.trackY - 1 + (h - o) / 2, this.barHeight = o;
      const R = this.distance ? this.scroll / this.distance : 0;
      this.barX = R * this.thumbTravelDistance, this.scroll = Math.max(0, Math.min(this.scroll, this.distance));
    }
  }
  draw() {
    const {
      config: { SCROLLER_FOCUS_COLOR: t, SCROLLER_COLOR: e, BORDER_COLOR: i, BORDER: s, SCROLLER_TRACK_COLOR: o }
    } = this.ctx;
    if (this.updatedSize(), this.isInnerMode() && !this.shouldDrawInnerScrollbar())
      return this.isFocus || this.isDragging;
    const r = Ye(this.ctx.config), l = We(this.ctx.config), h = r && _t(s) ? i : "transparent", c = this.hasScrollbar(), u = Ue(s, c);
    return l && u ? (this.ctx.paint.drawRect(this.trackX, this.trackY, this.trackWidth, this.trackHeight, {
      fillColor: o
    }), this.drawTrackHeaderBackground(), r && (this.ctx.paint.drawRect(this.trackX, this.trackY, this.trackWidth, this.trackHeight, {
      borderColor: h
    }), this.drawRightBoundaryBorder())) : l && this.drawInactiveTrackBackground(), c && this.ctx.paint.drawRect(this.barX, this.barY, this.barWidth, this.barHeight, {
      fillColor: this.isFocus || this.isDragging ? t : e,
      radius: 4
    }), r && u && this.splitPoints.length > 0 && this.ctx.paint.drawLine(this.splitPoints, {
      borderColor: h,
      borderWidth: 1
    }), this.isFocus || this.isDragging;
  }
  drawTrackHeaderBackground() {
    if (this.type !== "vertical" || this.trackWidth <= 0)
      return;
    const {
      header: t,
      config: { HEADER_BG_COLOR: e }
    } = this.ctx, i = Math.max(0, Math.min(t.height, this.trackHeight));
    i <= 0 || this.ctx.paint.drawRect(this.trackX, this.trackY, this.trackWidth, i, {
      fillColor: e
    });
  }
  drawInactiveTrackBackground() {
    if (this.type !== "vertical")
      return;
    const {
      footer: t,
      header: e,
      scrollY: i,
      stageHeight: s,
      config: {
        BODY_BG_COLOR: o,
        FOOTER_BG_COLOR: r,
        FOOTER_FIXED: l,
        FOOTER_POSITION: h,
        HEADER_BG_COLOR: c,
        SCROLLER_TRACK_SIZE: u = 0
      }
    } = this.ctx, d = Math.max(0, s - u);
    if (d <= 0 || this.trackWidth <= 0 || (this.ctx.paint.drawRect(this.trackX, 0, this.trackWidth, d, {
      fillColor: o
    }), this.ctx.paint.drawRect(this.trackX, 0, this.trackWidth, e.height, {
      fillColor: c
    }), !t.height))
      return;
    const x = l ? h === "top" ? e.height : d - t.height : t.y - i, f = Math.max(e.height, Math.min(x, d)), m = Math.max(0, Math.min(t.height, d - f));
    m > 0 && this.ctx.paint.drawRect(this.trackX, f, this.trackWidth, m, {
      fillColor: r
    });
  }
  drawRightBoundaryBorder() {
    const {
      stageHeight: t,
      config: { BORDER: e, BORDER_COLOR: i, SCROLLER_TRACK_SIZE: s = 0 }
    } = this.ctx;
    this.type;
  }
}
class xi {
  // 垂直滚动定时器
  constructor(t) {
    n(this, "ctx"), n(this, "verticalScrollbar"), n(this, "horizontalScrollbar"), n(this, "mousedownHeader", !1), n(this, "adjustPositionX", ""), n(this, "adjustPositionY", ""), n(this, "timerX", 0), n(this, "timerY", 0), this.ctx = t, this.verticalScrollbar = new jt(t, "vertical"), this.horizontalScrollbar = new jt(t, "horizontal"), this.ctx.on("wheel", (e) => this.onWheel(e)), this.ctx.on("mousedown", (e) => this.onMouseDown(e)), this.ctx.on("mousemove", (e) => this.onMouseMove(e)), this.ctx.on("mouseup", () => this.onMouseUp()), this.ctx.on("mouseout", (e) => this.onMouseOut(e)), this.ctx.on("touchmove", (e) => this.onTouchmove(e)), this.ctx.on("touchstart", (e) => {
      this.onTouchstart(e);
    }), this.ctx.on("setScroll", (e, i) => {
      this.setScroll(e, i);
    }), this.ctx.on("setScrollX", (e) => {
      this.setScrollX(e);
    }), this.ctx.on("setScrollY", (e) => {
      this.setScrollY(e);
    }), this.ctx.on("scrollToIndex", (e, i, s = "body") => {
      this.scrollToIndex(e, i, s);
    }), this.ctx.on("cellHeaderMousedown", () => {
      this.mousedownHeader = !0;
    }), this.ctx.on("startAdjustPosition", (e) => {
      this.startAdjustPosition(e);
    }), this.ctx.on("stopAdjustPosition", () => {
      this.stopAdjustPosition();
    });
  }
  onWheel(t) {
    this.verticalScrollbar.onWheel(t), this.horizontalScrollbar.onWheel(t), this.draw();
  }
  onTouchmove(t) {
    this.verticalScrollbar.onTouchmove(t), this.horizontalScrollbar.onTouchmove(t), this.draw();
  }
  onTouchstart(t) {
    this.verticalScrollbar.onTouchstart(t), this.horizontalScrollbar.onTouchstart(t), this.draw();
  }
  onMouseDown(t) {
    this.verticalScrollbar.onMouseDown(t), this.horizontalScrollbar.onMouseDown(t), this.draw();
  }
  onMouseMove(t) {
    const e = this.ctx.containerElement.getBoundingClientRect(), i = t.clientX >= e.left && t.clientX <= e.right && t.clientY >= e.top && t.clientY <= e.bottom, s = this.verticalScrollbar.onMouseMove(t, i), o = this.horizontalScrollbar.onMouseMove(t, i);
    s || o ? this.ctx.emit("draw") : this.draw();
  }
  onMouseUp() {
    this.mousedownHeader = !1, this.verticalScrollbar.onMouseUp(), this.horizontalScrollbar.onMouseUp(), this.ctx.scrollerMove = !1;
  }
  onMouseOut(t) {
    this.ctx.containerElement.contains(t.relatedTarget) || (this.verticalScrollbar.hideInnerScrollbar(), this.horizontalScrollbar.hideInnerScrollbar(), this.ctx.emit("draw"));
  }
  draw() {
    const t = this.verticalScrollbar.draw(), e = this.horizontalScrollbar.draw();
    this.ctx.scrollerFocus = t || e;
    const i = Math.floor(this.horizontalScrollbar.scroll), s = Math.floor(this.verticalScrollbar.scroll);
    (i !== this.ctx.scrollX || s !== this.ctx.scrollY) && (this.ctx.emit("onScroll", i, s), i !== this.ctx.scrollX && this.ctx.emit("onScrollX", i), s !== this.ctx.scrollY && this.ctx.emit("onScrollY", s), this.ctx.scrollX = i, this.ctx.scrollY = s, this.ctx.emit("draw"));
  }
  setScroll(t, e) {
    this.horizontalScrollbar.scroll = t, this.verticalScrollbar.scroll = e, this.ctx.emit("draw"), this.ctx.emit("onScroll", t, e);
  }
  setScrollX(t) {
    this.horizontalScrollbar.scroll = t, this.ctx.emit("draw");
  }
  setScrollY(t) {
    this.verticalScrollbar.scroll = t, this.ctx.emit("draw");
  }
  scrollToColkey(t) {
    const { header: e } = this.ctx, i = e.leafCellHeaders.find((s) => s.key === t);
    i && this.setScrollX(i.x - e.visibleWidth / 2);
  }
  scrollToColIndex(t) {
    const { header: e } = this.ctx, i = e.leafCellHeaders.find((s) => s.colIndex === t);
    i && this.setScrollX(i.x - e.visibleWidth / 2);
  }
  scrollToRowIndex(t) {
    const { body: e, database: i } = this.ctx, { top: s } = i.getPositionForRowIndex(t);
    this.setScrollY(s - e.visibleHeight / 2);
  }
  scrollToFooterRowIndex(t) {
    const { body: e, config: i, footer: s } = this.ctx;
    if (i.FOOTER_FIXED)
      return;
    const o = s.renderRows.find((r) => r.rowIndex === t);
    o && this.setScrollY(o.y - e.y - (e.visibleHeight - o.height) / 2);
  }
  scrollToIndex(t, e, i = "body") {
    i === "body" ? this.scrollToRowIndex(t) : i === "footer" && this.scrollToFooterRowIndex(t), this.scrollToColIndex(e);
  }
  scrollToRowKey(t) {
    const { body: e, database: i } = this.ctx, s = i.getRowIndexForRowKey(t);
    if (s === void 0)
      return;
    const { top: o } = i.getPositionForRowIndex(s);
    this.setScrollY(o - e.visibleHeight / 2);
  }
  /**
   * 调整滚动条位置，让到达边界时自动滚动
   */
  startAdjustPosition(t) {
    var e, i;
    const { offsetX: s, offsetY: o } = this.ctx.getOffset(t);
    let r = "", l = "";
    if (((e = this.ctx.focusCell) == null ? void 0 : e.fixed) !== "left" && s < this.ctx.fixedLeftWidth ? r = "left" : ((i = this.ctx.focusCell) == null ? void 0 : i.fixed) !== "right" && s > this.ctx.body.visibleWidth - this.ctx.fixedRightWidth ? r = "right" : (r = "", this.stopAdjustPosition(!0, !1)), !this.mousedownHeader && o < this.ctx.header.visibleHeight ? l = "top" : o > this.ctx.header.visibleHeight + this.ctx.body.visibleHeight ? l = "bottom" : (l = "", this.stopAdjustPosition(!1, !0)), r && this.adjustPositionX !== r) {
      this.adjustPositionX = r;
      let h = 10 * (r === "left" ? -1 : 1);
      this.timerX && (clearInterval(this.timerX), this.timerX = 0), this.timerX = setInterval(() => {
        h *= 1.5;
        const { scrollX: c } = this.ctx, u = c + h;
        (u < 0 || u > this.ctx.body.width) && (clearInterval(this.timerX), this.timerX = 0), this.ctx.setScrollX(u);
      }, 100);
    }
    if (l && this.adjustPositionY !== l) {
      this.adjustPositionY = l;
      let h = 10 * (l === "top" ? -1 : 1);
      this.timerY && (clearInterval(this.timerY), this.timerY = 0), this.timerY = setInterval(() => {
        h *= 1.5;
        const { scrollY: c } = this.ctx, u = c + h;
        (u < 0 || u > this.ctx.body.height) && (clearInterval(this.timerY), this.timerY = 0), this.ctx.setScrollY(u);
      }, 100);
    }
  }
  stopAdjustPosition(t = !0, e = !0) {
    t && (this.adjustPositionX = "", this.timerX && (clearInterval(this.timerX), this.timerX = 0)), e && (this.adjustPositionY = "", this.timerY && (clearInterval(this.timerY), this.timerY = 0));
  }
}
class fi extends ae {
  constructor(t, e, i, s, o, r, l) {
    super(t, i, s, o, r, "header", l.fixed), n(this, "align"), n(this, "hideHeaderSelection", !1), n(this, "verticalAlign", "middle"), n(this, "fixed"), n(this, "minWidth"), n(this, "maxWidth"), n(this, "formatterFinderHeaderValue"), n(this, "widthFillDisable"), n(this, "type"), n(this, "operation", !1), n(this, "editorType"), n(this, "level"), n(this, "text"), n(this, "hide", !1), n(this, "displayText", ""), n(this, "colspan"), n(this, "rowspan"), n(this, "row"), n(this, "key"), n(this, "required", !1), n(this, "readonly", !1), n(this, "ellipsis", !1), n(this, "overflowTooltipShow", !0), n(this, "children", []), n(this, "column"), n(this, "colIndex"), n(this, "rowKey"), n(this, "rules"), n(this, "hasChildren"), n(this, "render"), n(this, "style", {}), n(this, "drawX", 0), n(this, "drawY", 0), n(this, "sortIconName", "sort-default"), n(this, "sortAscIconName", "sort-asc"), n(this, "sortDescIconName", "sort-desc"), n(this, "visibleWidth", 0), n(this, "visibleHeight", 0), n(this, "maxLineClampHeader", "auto"), n(this, "domDataset", {}), n(this, "textOffsetRight", 0), n(this, "textOffsetLeft", 0), n(this, "textInfo"), n(this, "drawTextX", 0), n(this, "drawTextY", 0), n(this, "drawTextWidth", 0), n(this, "drawTextHeight", 0), n(this, "drawCellBgColor", ""), n(this, "drawTextColor", ""), n(this, "drawTextFont", ""), n(this, "drawSelectionImageX", 0), n(this, "drawSelectionImageY", 0), n(this, "drawSelectionImageWidth", 0), n(this, "drawSelectionImageHeight", 0), n(this, "drawSelectionImageName", ""), n(this, "drawSelectionImageSource"), n(this, "drawSortImageX", 0), n(this, "drawSortImageY", 0), n(this, "drawSortImageWidth", 0), n(this, "drawSortImageHeight", 0), n(this, "drawSortImageName", ""), n(this, "drawSortImageSource"), n(this, "renderHeaderType", "default"), this.ctx = t, this.x = i, this.y = s, this.width = o, this.height = r, this.visibleWidth = o, this.visibleHeight = r, this.colIndex = e, this.key = l.key, this.minWidth = l.minWidth, this.maxWidth = l.maxWidth, this.formatterFinderHeaderValue = l.formatterFinderHeaderValue, this.hide = (typeof l.hide == "function" ? l.hide(l) : l.hide) || !1, this.type = l.type || "", this.editorType = l.editorType || "text", this.hideHeaderSelection = l.hideHeaderSelection || !1, this.align = l.headerAlign || l.align || this.ctx.config.COLUMNS_ALIGN, this.verticalAlign = l.headerVerticalAlign || l.verticalAlign || this.ctx.config.COLUMNS_VERTICAL_ALIGN, this.fixed = l.fixed || "", this.level = l.level || 0, this.operation = l.operation || !1, this.text = l.title, this.column = l, this.colspan = l.colspan || 1, this.widthFillDisable = l.widthFillDisable || !1, this.rowspan = l.rowspan || 1, this.rules = l.rules, this.readonly = typeof l.readonly == "boolean" ? l.readonly : !1, this.required = l.required || !1, this.sortIconName = l.sortIconName || "sort-default", this.sortAscIconName = l.sortAscIconName || "sort-asc", this.sortDescIconName = l.sortDescIconName || "sort-desc", this.rowKey = oe(), this.overflowTooltipShow = l.overflowTooltipHeaderShow !== !1, this.hasChildren = l.children && l.children.length > 0 || !1, this.render = l.renderHeader, this.maxLineClampHeader = l.maxLineClampHeader || "auto", this.renderHeaderType = l.renderHeaderType || "default";
  }
  /**
   * 是否可见，覆盖基类方法，表头是跟y滚动条没有关系的所以不需要加滚动参数
   * @returns
   */
  isVerticalVisible() {
    const { stageHeight: t } = this.ctx, e = t;
    return !(this.y + this.height <= 0 || this.y >= e);
  }
  /**
   * 更新样式
   */
  updateStyle() {
    this.style = this.getOverlayerViewsStyle();
  }
  updateContainer() {
    const { HEADER_CELL_STYLE_METHOD: t, HEADER_BG_COLOR: e, HEADER_TEXT_COLOR: i } = this.ctx.config;
    let s = e, o = i;
    if (typeof t == "function") {
      const h = t, { backgroundColor: c, color: u, font: d } = h({
        colIndex: this.colIndex,
        column: this.column
      }) || {};
      c && (s = c), u && (o = u), d && (this.drawTextFont = d);
    }
    const { colKey: r, type: l } = this.ctx.finderBar;
    l === "header" && r === this.key && (s = this.ctx.config.FINDER_CELL_BG_COLOR), this.drawCellBgColor = s, this.drawTextColor = o;
  }
  updateOffset() {
    this.column.sortBy && (this.textOffsetRight = 16), this.required && (this.textOffsetLeft = 12);
  }
  update() {
    this.updateContainer(), this.updateOffset(), this.displayText = this.getText(), this.drawX = this.getDrawX(), this.drawY = this.getDrawY(), this.drawTextX = this.drawX, this.drawTextY = this.drawY, this.drawTextWidth = this.width, this.drawTextHeight = this.height, this.updateSelection(), this.updateStyle();
  }
  draw() {
    this.drawEdge(), this.drawText(), this.drawBg(), this.updateSortIcon(), this.drawImages(), this.drawRequired();
  }
  drawImages() {
    this.getImages().forEach((t) => {
      t.visible && t.source && this.ctx.paint.drawImage(t.source, t.x, t.y, t.width, t.height);
    });
  }
  getFinderText() {
    const t = this.displayText;
    if (typeof this.formatterFinderHeaderValue != "function")
      return t;
    const e = this.formatterFinderHeaderValue({
      rowIndex: this.level,
      colIndex: this.colIndex,
      column: this.column,
      value: this.text,
      displayText: t
    });
    return e == null ? t : `${e}`;
  }
  drawEdge() {
    const { paint: t, config: e } = this.ctx, i = Pe(e), s = dt(e.BORDER) && i === void 0;
    t.drawRect(this.drawX, this.drawY, this.width, this.height, {
      borderColor: s ? e.BORDER_COLOR : void 0,
      fillColor: this.drawCellBgColor
    }), s || (this.drawColumnDivider(i), this.drawHorizontalDivider());
  }
  drawColumnDivider(t) {
    const { paint: e, header: i, config: s, fixedLeftWidth: o, fixedRightWidth: r, scrollX: l, stageWidth: h } = this.ctx;
    if (t === void 0)
      return;
    const c = l > 0 ? o : void 0, u = l < Math.floor(i.width - h - 1) ? i.width - r + B(s) : void 0, d = Ge(this.fixed, this.x, this.width, i.width, {
      fixedLeftEnd: c,
      fixedRightStart: u
    });
    if (!d)
      return;
    const x = d === "left" ? this.drawX : this.drawX + this.visibleWidth;
    e.drawLine([x, this.drawY, x, this.drawY + this.visibleHeight], {
      borderColor: t,
      borderWidth: 1
    });
  }
  drawHorizontalDivider() {
    const { paint: t, config: e, header: i } = this.ctx;
    if (!dt(e.BORDER) || this.y + this.height >= i.height)
      return;
    const s = this.drawY + this.visibleHeight;
    t.drawLine([this.drawX, s, this.drawX + this.visibleWidth, s], {
      borderColor: e.BORDER_COLOR,
      borderWidth: 1
    });
  }
  drawText() {
    const {
      paint: t,
      config: { HEADER_FONT: e, CELL_PADDING: i }
    } = this.ctx, s = `${this.displayText}_${this.drawTextWidth}_${this.drawTextFont}`;
    this.ellipsis = t.drawText(
      this.displayText,
      this.drawTextX,
      this.drawTextY,
      this.drawTextWidth,
      this.drawTextHeight,
      {
        font: this.drawTextFont || e,
        padding: i,
        color: this.drawTextColor,
        align: this.align,
        verticalAlign: this.verticalAlign,
        maxLineClamp: this.maxLineClampHeader,
        offsetRight: this.textOffsetRight,
        // 右边占位
        offsetLeft: this.textOffsetLeft,
        // 左边占位
        cacheTextKey: s,
        textCallback: (o) => {
          this.textInfo = o;
        },
        layoutCallback: (o) => {
          this.ctx.emit("registerTextLayout", `${this.cellType}-${this.colIndex}-${this.level}`, o);
        }
      }
    );
  }
  drawRequired() {
    if (!this.required || !this.textInfo)
      return;
    const { left: t, top: e, height: i } = this.textInfo, { paint: s, config: { REQUIRED_COLOR: o } } = this.ctx;
    s.drawText("*", t - 18, e + (i - 12) / 2, 24, 24, {
      color: o,
      font: "18px Arial",
      align: "center",
      verticalAlign: "middle",
      padding: 0
    });
  }
  drawBg() {
    if (this.ctx.dragHeaderIng)
      return;
    const { ENABLE_SELECTOR: t, ENABLE_SELECTOR_SINGLE: e } = this.ctx.config;
    let i = -1, s = -1;
    if (this.ctx.focusCellHeader && (i = this.ctx.focusCellHeader.colIndex, s = this.ctx.focusCellHeader.colIndex + this.ctx.focusCellHeader.colspan - 1), t && !e) {
      const { xArr: r } = this.ctx.selector;
      i = r[0], s = r[1];
    }
    const o = this.colspan + this.colIndex - 1;
    this.colIndex >= i && this.colIndex <= s && o <= s && this.ctx.paint.drawRect(this.drawX, this.drawY, this.width, this.height, {
      borderColor: "transparent",
      fillColor: this.ctx.config.SELECT_ROW_COL_BG_COLOR || "transparent"
    });
  }
  updateSelection() {
    if (["index-selection", "selection", "selection-tree", "tree-selection"].includes(this.type)) {
      const { indeterminate: t, check: e, selectable: i } = this.ctx.database.getCheckedState(), { CHECKBOX_SIZE: s = 0, CELL_PADDING: o } = this.ctx.config;
      let r = this.drawX + (this.width - s) / 2, l = this.drawY + (this.height - s) / 2;
      this.drawTextX = r + s - o / 2, this.drawTextWidth = this.drawX + this.visibleWidth - this.drawTextX, (this.align === "left" || this.align === "right") && (r = this.drawX + o, this.drawTextX = r + s - o / 2, this.drawTextWidth = this.drawX + this.visibleWidth - this.drawTextX), this.verticalAlign === "top" ? l = this.drawY + o / 2 : this.verticalAlign === "bottom" && (l = this.drawY + this.height - s - o / 2), this.column.dragRow && (r += this.ctx.config.DRAG_ROW_ICON_SIZE, this.drawTextX += this.ctx.config.DRAG_ROW_ICON_SIZE, this.drawTextWidth -= this.ctx.config.DRAG_ROW_ICON_SIZE);
      let h = this.ctx.icons.get("checkbox-uncheck"), c = "checkbox-uncheck";
      t ? (h = this.ctx.icons.get("checkbox-indeterminate"), c = "checkbox-indeterminate") : e && i ? (h = this.ctx.icons.get("checkbox-check"), c = "checkbox-check") : e && !i ? (h = this.ctx.icons.get("checkbox-check-disabled"), c = "checkbox-check-disabled") : !e && i ? (h = this.ctx.icons.get("checkbox-uncheck"), c = "checkbox-uncheck") : (h = this.ctx.icons.get("checkbox-disabled"), c = "checkbox-disabled");
      const u = new Z(c, r, l, s, s, h);
      u.setVisible(!this.hideHeaderSelection), this.setImage("selection", u);
    }
  }
  updateSortIcon() {
    if (!this.column.sortBy || !this.textInfo)
      return;
    const { right: t, top: e, height: i } = this.textInfo, s = t + 4, o = e + (i - 16) / 2, r = 16;
    let l = this.sortIconName;
    const h = this.ctx.database.getSortState(this.key);
    h.direction === "asc" ? l = this.sortAscIconName : h.direction === "desc" && (l = this.sortDescIconName);
    const c = this.ctx.icons.get(l), u = new Z(l, s, o, r, r, c);
    this.setImage("sort", u);
  }
  getText() {
    return this.render && this.renderHeaderType === "default" || ["", null, void 0].includes(this.text) ? "" : `${this.text}`;
  }
  /**
   * 获取样式
   */
  getOverlayerViewsStyle() {
    let t = "";
    return this.fixed === "left" ? t = `${this.drawX}px` : this.fixed === "right" ? t = `${this.drawX - (this.ctx.stageWidth - this.ctx.fixedRightWidth)}px` : t = `${this.drawX - this.ctx.fixedLeftWidth}px`, {
      position: "absolute",
      overflow: "hidden",
      left: t,
      top: `${this.drawY + 1}px`,
      width: `${this.width}px`,
      height: `${this.height - 2}px`,
      pointerEvents: "initial",
      userSelect: "none"
    };
  }
}
class ue {
  constructor(t, e) {
    n(this, "root"), n(this, "key"), n(this, "childrenKey"), this.root = t, this.key = e?.key || "key", this.childrenKey = e?.childrenKey || "children";
  }
  getTree() {
    return this.root;
  }
  treeMove(t, e, i) {
    if (i === "none" || String(t) === String(e))
      return;
    const s = this.findNodeWithParent(this.root, t);
    if (!s) return;
    const o = this.findNodeWithParent(this.root, e);
    if (!o) return;
    const { parent: r, index: l, node: h } = s, { parent: c, index: u, node: d } = o;
    if (this.isDescendant(h, e))
      return;
    const x = r ? r[this.childrenKey] : this.root;
    if (x.splice(l, 1), r && x.length === 0 && delete r[this.childrenKey], i === "inside") {
      Array.isArray(d[this.childrenKey]) || (d[this.childrenKey] = []), d[this.childrenKey].push(h);
      return;
    }
    const f = c ? c[this.childrenKey] : this.root;
    let m = u;
    r === c && l < u && m--, i === "after" && m++, f.splice(m, 0, h);
  }
  getNodeKey(t) {
    return typeof this.key == "function" ? this.key(t) : t[this.key];
  }
  isSameKey(t, e) {
    return t == null || e === void 0 || e === null ? !1 : String(t) === String(e);
  }
  findNodeWithParent(t, e, i = null) {
    for (let s = 0; s < t.length; s++) {
      const o = t[s];
      if (this.isSameKey(this.getNodeKey(o), e)) return { parent: i, index: s, node: o };
      const r = o[this.childrenKey];
      if (Array.isArray(r)) {
        const l = this.findNodeWithParent(r, e, o);
        if (l) return l;
      }
    }
    return null;
  }
  isDescendant(t, e) {
    const i = t[this.childrenKey];
    if (!Array.isArray(i)) return !1;
    for (const s of i)
      if (this.isSameKey(this.getNodeKey(s), e) || this.isDescendant(s, e)) return !0;
    return !1;
  }
}
class gi {
  constructor(t) {
    n(this, "ctx"), n(this, "x", 0), n(this, "y", 0), n(this, "width", 0), n(this, "height", 0), n(this, "resizeTarget", null), n(this, "dragTarget", null), n(this, "dragingCell"), n(this, "dragCellDiff", 0), n(this, "resizeNum", 0), n(this, "isResizing", !1), n(this, "clientX", 0), n(this, "resizeDiff", 0), n(this, "columnIndex", 0), n(this, "isMouseDown", !1), n(this, "columns"), n(this, "visibleColumns"), n(this, "visibleLeafColumns", []), n(this, "visibleHeight", 0), n(this, "visibleWidth", 0), n(this, "allCellHeaders", []), n(this, "leafCellHeaders", []), n(this, "renderLeafCellHeaders", []), n(this, "fixedLeftCellHeaders", []), n(this, "centerCellHeaders", []), n(this, "fixedRightCellHeaders", []), n(this, "renderCenterCellHeaders", []), n(this, "renderFixedCellHeaders", []), this.ctx = t, this.ctx.on(
      "resetHeader",
      At(() => {
        this.init(), this.ctx.clearSelector(), this.ctx.emit("draw");
      }, 100)
    ), this.init(), this.initSelection(), this.initSort(), this.initResizeColumn(), this.initDragColumn();
  }
  init(t = !1) {
    const {
      config: { HEADER_HEIGHT: e }
    } = this.ctx, i = B(this.ctx.config);
    if (!t) {
      const d = this.ctx.database.getColumns();
      this.columns = d;
    }
    this.allCellHeaders = [], this.leafCellHeaders = [], this.fixedLeftCellHeaders = [], this.fixedRightCellHeaders = [], this.centerCellHeaders = [], this.visibleColumns = re(this.columns);
    const s = at(this.visibleColumns), o = it(this.visibleColumns);
    this.height = e * s, this.visibleHeight = this.height, this.width = o.reduce((d, x) => {
      const f = x.width || 100, { maxWidth: m, minWidth: g } = x;
      return m && f > m ? d + m : g && f < g ? d + g : d + f;
    }, 0), this.columnIndex = 0, this.resizeNum = 0;
    const r = Le(ct(this.visibleColumns, s));
    this.render(r, 0), this.ctx.database.updateColIndexKeyMap(this.leafCellHeaders);
    const l = this.ctx.containerElement.getBoundingClientRect();
    this.resizeNum > 0 ? this.ctx.stageWidth = Math.floor(l.width) : this.ctx.stageWidth = Math.min(
      Math.floor(this.width + i),
      Math.floor(l.width)
    ), this.ctx.stageElement.style.width = `${this.ctx.stageWidth}px`, this.visibleWidth = this.ctx.stageWidth - i;
    const h = this.visibleWidth - this.width;
    if (this.resizeNum && h > 0) {
      const d = Math.floor(h / this.resizeNum * 100) / 100;
      this.resizeAllColumn(d);
    }
    const c = this.fixedLeftCellHeaders.filter((d) => !d.hasChildren);
    this.ctx.fixedLeftWidth = c.reduce((d, x) => d + x.width, 0);
    const u = this.fixedRightCellHeaders.filter((d) => !d.hasChildren);
    this.ctx.fixedRightWidth = u.reduce((d, x) => d + x.width, i), this.ctx.maxColIndex = this.leafCellHeaders.length - 1, this.ctx.header.x = this.x, this.ctx.header.y = this.y, this.ctx.header.width = this.width, this.ctx.header.height = this.height, this.ctx.header.allCellHeaders = this.allCellHeaders, this.ctx.header.visibleWidth = this.visibleWidth, this.ctx.header.visibleHeight = this.visibleHeight;
  }
  initSort() {
    this.ctx.on("cellHeaderClick", (t, e) => {
      if (!t.isImageInside("sort", e))
        return;
      const { sortIconType: i = "up-down" } = t.column, s = t.getImageClickDirection("sort", e);
      let o = "none";
      const r = this.ctx.database.getSortState(t.key);
      function l(h, c) {
        return h === "none" ? c : h === c ? "none" : c;
      }
      i === "loop" ? r.direction === "none" ? o = "asc" : r.direction === "asc" ? o = "desc" : o = "none" : s && i === "up-down" ? s.includes("up") ? o = l(r.direction, "asc") : s.includes("down") && (o = l(r.direction, "desc")) : s && i === "left-right" && (s.includes("left") ? o = l(r.direction, "asc") : s.includes("right") && (o = l(r.direction, "desc"))), this.ctx.database.setSortState(t.key, o);
    });
  }
  initSelection() {
    this.ctx.on("cellHeaderClick", (t, e) => {
      if (this.ctx.stageElement.style.cursor !== "pointer" || !t.isImageInside("selection", e))
        return;
      const i = t.getImage("selection");
      ["checkbox-uncheck", "checkbox-indeterminate"].includes(i.name) ? this.ctx.database.toggleAllSelection() : i.name === "checkbox-check" && this.ctx.database.clearSelection(!0);
    });
  }
  // 调整表头的宽度
  initResizeColumn() {
    this.ctx.on("mousedown", (t) => {
      this.ctx.config.ENABLE_RESIZE_COLUMN && this.ctx.isTarget(t) && (this.clientX = t.clientX, this.resizeTarget ? (this.isResizing = !0, this.ctx.columnResizing = !0) : this.isResizing = !1, this.isMouseDown = !0);
    }), this.ctx.on("mouseup", () => {
      this.ctx.config.ENABLE_RESIZE_COLUMN && (this.isMouseDown = !1, this.resizeDiff !== 0 && this.resizeTarget && this.resizeColumn(this.resizeTarget, this.resizeDiff), this.resizeTarget = null, this.isResizing = !1, this.isMouseDown = !1, this.ctx.columnResizing = !1, this.clientX = 0, this.resizeDiff = 0);
    }), this.ctx.on("mousemove", (t) => {
      if (!this.ctx.config.ENABLE_RESIZE_COLUMN || this.ctx.editing) return;
      const {
        stageWidth: e,
        config: { RESIZE_COLUMN_MIN_WIDTH: i }
      } = this.ctx;
      if (this.isResizing && this.resizeTarget) {
        const s = this.resizeTarget.width, o = this.resizeTarget.minWidth, r = this.resizeTarget.maxWidth;
        let l = t.clientX - this.clientX;
        l + s < i && (l = -(s - i)), o && l + s < o && (l = -(s - o)), r && l + s > r && (l = r - s), this.resizeDiff = l, this.ctx.emit("draw");
      } else {
        if (this.resizeTarget = null, this.isMouseDown)
          return;
        const { offsetX: s } = this.ctx.getOffset(t);
        if (s < 0 || s > this.visibleWidth) {
          this.ctx.stageElement.style.cursor === "col-resize" && (this.ctx.stageElement.style.cursor = "default");
          return;
        }
        this.ctx.stageElement.style.cursor === "col-resize" && (this.ctx.stageElement.style.cursor = "default");
        const o = [...this.renderFixedCellHeaders, ...this.renderCenterCellHeaders];
        for (const r of o) {
          const { offsetX: l, offsetY: h } = this.ctx.getOffset(t), c = l, u = h, d = r.getDrawX(), x = r.getDrawY();
          if (c > d + r.width - 5 && c < d + r.width + 4 && c < e - 4 && // 视窗中最后一列不允许调整宽
          u > x) {
            const f = r.colIndex + r.colspan - 1, m = this.leafCellHeaders.find((g) => g.colIndex === f);
            if (!m || !m.fixed && this.ctx.stageWidth - this.ctx.fixedRightWidth < d + r.width)
              return;
            this.ctx.isTarget(t) && h <= this.height && (this.ctx.stageElement.style.cursor = "col-resize", this.resizeTarget = m);
          }
        }
      }
    });
  }
  initDragColumn() {
    this.ctx.on("cellHeaderMousedown", (t) => {
      this.ctx.stageElement.style.cursor === "default" && this.ctx.config.ENABLE_DRAG_COLUMN && (t.column.dragDisabled || (this.dragTarget === t ? (this.ctx.dragHeaderIng = !0, this.dragCellDiff = this.ctx.mouseX - t.drawX, this.ctx.stageElement.style.cursor = "grabbing") : (this.dragTarget = t, this.ctx.dragHeaderIng = !1)));
    }), this.ctx.on("cellMousedown", () => {
      this.ctx.config.ENABLE_DRAG_COLUMN && (this.dragTarget = null, this.ctx.dragHeaderIng = !1);
    }), this.ctx.on("mouseup", () => {
      if (this.ctx.config.ENABLE_DRAG_COLUMN) {
        if (this.dragingCell && this.dragTarget) {
          const t = (c, u = {}) => (c.forEach((d, x) => {
            d.children && t(d.children, u), u[d.key] = x;
          }), u), e = this.ctx.database.getColumns(), i = ct(e, at(e)), s = new ue(i, {
            key: "key",
            // 节点唯一标识字段（对应我们之前的field）
            childrenKey: "children"
            // 子节点数组字段
          }), o = this.dragTarget.colIndex > this.dragingCell.colIndex ? "before" : "after";
          s.treeMove(this.dragTarget.column.key, this.dragingCell.column.key, o);
          const r = s.getTree(), l = t(r);
          this.ctx.database.setCustomHeader({ sortData: l }), this.init();
          const h = {
            source: this.dragTarget,
            target: this.dragingCell,
            columns: i
          };
          this.ctx.emit("columnDragChange", h);
        }
        this.ctx.dragHeaderIng && this.dragTarget && (this.ctx.stageElement.style.cursor === "grabbing" && (this.ctx.stageElement.style.cursor = "default"), this.ctx.dragHeaderIng = !1, this.dragTarget = null, this.dragingCell = void 0, this.dragCellDiff = 0, this.ctx.clearSelector(), this.ctx.focusCellHeader = void 0, this.ctx.emit("draw"));
      }
    }), this.ctx.on("mousemove", (t) => {
      this.ctx.config.ENABLE_DRAG_COLUMN && (!this.ctx.dragHeaderIng || !this.dragTarget || (this.dragTarget.fixed || this.ctx.startAdjustPosition(t), this.ctx.emit("draw")));
    }), this.ctx.on("cellHoverChange", (t) => {
      this.ctx.config.ENABLE_DRAG_COLUMN && (t.column.dragDisabled || (this.dragingCell = this.getDragCellHeader(t.colIndex)));
    }), this.ctx.on("cellHeaderHoverChange", (t) => {
      this.ctx.config.ENABLE_DRAG_COLUMN && (t.column.dragDisabled || (this.dragingCell = this.getDragCellHeader(t.colIndex)));
    });
  }
  getDragCellHeader(t) {
    if (!this.dragTarget || !this.ctx.dragHeaderIng)
      return;
    const {
      column: { parentKey: e },
      key: i,
      level: s,
      fixed: o
    } = this.dragTarget, r = this.allCellHeaders.find(
      (l) => l.key !== i && l.fixed === o && l.column.level === s && l.column.parentKey === e && l.colIndex <= t && l.colIndex + l.colspan - 1 >= t
    );
    if (this.ctx.dragHeaderIng) {
      const l = r ? "grabbing" : "not-allowed";
      this.ctx.stageElement.style.cursor = l;
    }
    return r;
  }
  resizeColumn(t, e) {
    const i = (r) => {
      r.forEach((l) => {
        if (l.children && l.children.length > 0 && i(l.children), l.key === t.key) {
          const h = l.width || 100;
          l.width = h + e;
        }
      });
    };
    i(this.columns);
    let s = 0;
    if (this.width < this.visibleWidth) {
      const r = this.visibleWidth - this.width;
      s = Math.floor(r / this.resizeNum * 100) / 100, this.resizeAllColumn(s);
    }
    const o = t.width + e + s;
    this.ctx.emit("resizeColumnChange", {
      colIndex: t.colIndex,
      key: t.key,
      oldWidth: t.width,
      width: o,
      column: t.column,
      columns: this.columns
    }), this.ctx.database.setCustomHeaderResizableData(t.key, o), this.init(!0), this.ctx.emit("draw");
  }
  resizeAllColumn(t) {
    if (t === 0) return;
    const e = /* @__PURE__ */ new Map();
    let i = !0;
    for (const o of this.allCellHeaders)
      if (o.widthFillDisable)
        e.set(o.key, o.width);
      else {
        const r = o.width + t * o.colspan;
        e.set(o.key, r), r < this.ctx.config.RESIZE_COLUMN_MIN_WIDTH && (i = !1);
      }
    if (!i)
      return;
    const s = (o) => {
      o.forEach((r) => {
        e.has(r.key) && (r.width = e.get(r.key)), r.children && r.children.length > 0 && s(r.children);
      });
    };
    s(this.columns), this.init(!0), this.ctx.emit("draw");
  }
  getCustomHeader() {
    const t = this.ctx.database.getColumns(), e = this.ctx.database.getCustomHeader(), { sortData: i = {} } = e;
    return Object.keys(i).length === 0 ? {
      columns: t,
      customHeader: e
    } : {
      columns: ct(t, at(t)),
      customHeader: e
    };
  }
  render(t, e) {
    const i = t.length;
    let s = e;
    const { HEADER_HEIGHT: o = 0 } = this.ctx.config;
    for (let r = 0; r < i; r++) {
      const l = t[r], h = o * (l.rowspan || 0), c = o * (l.level || 0);
      let { minWidth: u, maxWidth: d } = l, x = l.width || 100;
      u && x < u && (x = u), d && x > d && (x = d), l.children && (x = it(l.children).reduce((m, g) => m + (g?.width || 100), 0));
      const f = new fi(this.ctx, this.columnIndex, s, c, x, h, l);
      this.ctx.database.setHeader(l.key, f), this.allCellHeaders.push(f), l.children || (this.leafCellHeaders.push(f), f.column.widthFillDisable || this.resizeNum++), l.fixed === "left" ? this.fixedLeftCellHeaders.push(f) : l.fixed === "right" ? this.fixedRightCellHeaders.push(f) : this.centerCellHeaders.push(f), !l.children && this.columnIndex++, l.children && this.render(l.children, s), s += x;
    }
  }
  drawTipLine() {
    if (this.isResizing && this.resizeTarget) {
      const {
        stageHeight: t,
        config: {
          RESIZE_COLUMN_LINE_COLOR: e,
          RESIZE_COLUMN_TEXT_COLOR: i,
          RESIZE_COLUMN_TEXT_BG_COLOR: s,
          ENABLE_RESIZE_COLUMN_TEXT: o
        }
      } = this.ctx, r = this.resizeTarget.getDrawX(), l = this.resizeTarget.width, h = r + l + this.resizeDiff - 0.5, c = [h - 0.5, 0, h - 0.5, t];
      if (this.ctx.paint.drawLine(c, {
        borderColor: e
      }), o) {
        const u = `${Math.floor(l + this.resizeDiff)}px`, d = 45, x = 24;
        this.ctx.paint.drawRect(h + d / 2, this.ctx.mouseY - x / 2, d, x, {
          fillColor: s,
          borderWidth: 0,
          borderColor: "transparent"
        }), this.ctx.paint.drawText(u, h + d / 2, this.ctx.mouseY - x / 2, d, x + 2, {
          padding: 0,
          color: i,
          align: "center",
          verticalAlign: "middle"
        });
      }
    }
  }
  drawDragTip() {
    if (this.dragTarget && this.ctx.dragHeaderIng) {
      const { DRAG_TIP_BG_COLOR: t, DRAG_TIP_LINE_COLOR: e } = this.ctx.config, i = this.dragTarget.width;
      if (this.ctx.paint.drawRect(
        this.ctx.mouseX - this.dragCellDiff,
        this.visibleHeight,
        i,
        this.ctx.body.visibleHeight,
        {
          fillColor: t,
          borderWidth: 0,
          borderColor: "transparent"
        }
      ), this.dragingCell) {
        const { drawX: s, drawY: o, visibleWidth: r, colIndex: l } = this.dragingCell;
        let h = s, c = o;
        l > this.dragTarget.colIndex && (h = s + r), l === 0 && (h = h + 1), l === this.ctx.maxColIndex && (h = h - 1);
        const u = [h, c, h, this.ctx.stageHeight], d = [h - 4, c, h + 4, c, h, c + 6, h - 4, c];
        this.ctx.paint.drawLine(d, {
          borderColor: e,
          borderWidth: 1.2,
          fillColor: e
        }), this.ctx.paint.drawLine(u, {
          borderColor: e,
          borderWidth: 1.2
        });
      }
    }
  }
  drawFixedShadow() {
    const {
      fixedLeftWidth: t,
      fixedRightWidth: e,
      scrollX: i,
      header: s,
      stageWidth: o,
      config: {
        HEADER_BG_COLOR: r,
        FIXED_COLUMN_SHADOW_COLOR: l,
        FIXED_COLUMN_SHADOW_FADE_COLOR: h,
        FIXED_COLUMN_SHADOW_WIDTH: c
      }
    } = this.ctx, u = B(this.ctx.config);
    if (i > 0 && t !== 0 && this.ctx.paint.drawShadow(this.x, this.y, t, this.height, {
      fillColor: r,
      side: "right",
      shadowWidth: c,
      colorStart: l,
      colorEnd: h
    }), i < Math.floor(s.width - o - 1) && e !== u) {
      const d = s.width - (this.x + this.width) + o - e;
      this.ctx.paint.drawShadow(d, this.y, e, this.height, {
        fillColor: r,
        side: "left",
        shadowWidth: c,
        colorStart: h,
        colorEnd: l
      });
    }
  }
  update() {
    const t = [], e = [], i = [];
    if (this.centerCellHeaders.length) {
      const s = this.centerCellHeaders[this.centerCellHeaders.length - 1];
      this.ctx.lastCenterColIndex = s.colIndex;
    }
    this.centerCellHeaders.forEach((s) => {
      s.isHorizontalVisible() && s.isVerticalVisible() && (e.push(s), s.hasChildren || t.push(s));
    }), this.fixedLeftCellHeaders.forEach((s) => {
      i.push(s), s.hasChildren || t.push(s);
    }), this.fixedRightCellHeaders.forEach((s) => {
      i.push(s), s.hasChildren || t.push(s);
    }), this.renderCenterCellHeaders = e, this.renderFixedCellHeaders = i, this.renderLeafCellHeaders = t.sort((s, o) => s.x - o.x), this.visibleLeafColumns = this.renderLeafCellHeaders.map((s) => s.column), this.ctx.header.visibleLeafColumns = this.visibleLeafColumns, this.ctx.header.leafCellHeaders = this.leafCellHeaders, this.ctx.header.renderLeafCellHeaders = this.renderLeafCellHeaders, this.ctx.header.renderCellHeaders = this.renderFixedCellHeaders.concat(this.renderCenterCellHeaders);
  }
  drawBottomLine() {
    const { stageWidth: t, config: e } = this.ctx, { BORDER: i } = e;
    if (!Dt(i))
      return;
    const s = [0, this.height, t, this.height];
    this.ctx.paint.drawLine(s, {
      borderColor: e.BORDER_COLOR,
      borderWidth: 1
    });
  }
  draw() {
    this.renderCenterCellHeaders.forEach((t) => {
      t.update(), t.draw();
    }), this.drawFixedShadow(), this.renderFixedCellHeaders.forEach((t) => {
      t.update(), t.draw();
    }), this.drawBottomLine(), this.drawTipLine(), this.drawDragTip();
  }
}
class xe {
  constructor(t, e, i = 0, s = 0, o = 0, r = 0, l, h = "body") {
    n(this, "ctx"), n(this, "x", 0), n(this, "y", 0), n(this, "width", 0), n(this, "height"), n(this, "cells", []), n(this, "fixedCells", []), n(this, "noFixedCells", []), n(this, "calculatedHeightCells", []), n(this, "rowIndex", 0), n(this, "rowKey", ""), n(this, "rowType", "body"), n(this, "data"), n(this, "calculatedHeight", -1), this.ctx = t, this.x = i, this.y = s, this.width = o, this.height = r, this.rowIndex = e, this.rowKey = t.database.getRowKeyForRowIndex(e) || "", this.rowType = h, this.data = l, this.update();
  }
  update() {
    const { header: t } = this.ctx, e = [], i = [], s = [], o = [];
    t.renderLeafCellHeaders.forEach((r) => {
      const l = new ce(
        this.ctx,
        this.rowIndex,
        r.colIndex,
        r.x,
        this.y,
        r.width,
        this.height,
        r.column,
        this.data,
        this.rowType
      );
      l.fixed ? i.push(l) : s.push(l), e.push(l), l.autoRowHeight && o.push(l);
    }), this.cells = e, this.calculatedHeightCells = o, this.fixedCells = i, this.noFixedCells = s;
  }
  updateCalculatedHeight() {
    const t = this.calculatedHeightCells.map((e) => {
      const i = e.getAutoHeight(), { key: s, height: o = -1 } = this.ctx.database.getMaxRowHeightItem(this.rowKey) || {};
      return i > o ? this.ctx.database.setMaxRowHeightItem(this.rowKey, e.key, i) : e.key === s && i < o && this.ctx.database.setMaxRowHeightItem(this.rowKey, e.key, i), i;
    });
    return this.calculatedHeight = t.length ? Math.max(...t) : -1, this.calculatedHeight;
  }
  drawCenter() {
    this.noFixedCells.forEach((t) => {
      t.draw();
    });
  }
  drawFixed() {
    this.fixedCells.forEach((t) => {
      t.draw();
    });
  }
  drawContainer() {
    this.noFixedCells.forEach((t) => {
      t.drawContainer();
    });
  }
  drawFixedContainer() {
    this.fixedCells.forEach((t) => {
      t.drawContainer();
    });
  }
  drawHorizontalBorder() {
    this.noFixedCells.forEach((t) => {
      t.drawHorizontalBorder();
    });
  }
  drawFixedHorizontalBorder() {
    this.fixedCells.forEach((t) => {
      t.drawHorizontalBorder();
    });
  }
}
class mi {
  constructor(t) {
    n(this, "resizeTarget", null), n(this, "dragSource", null), n(this, "dragTarget", null), n(this, "dragRowDiff", 0), n(this, "dragPosition", "none"), n(this, "isMouseDown", !1), n(this, "resizeDiff", 0), n(this, "clientY", 0), n(this, "ctx"), n(this, "x", 0), n(this, "y", 0), n(this, "width", 0), n(this, "height", 0), n(this, "headIndex", 0), n(this, "tailIndex", 0), n(this, "isResizing", !1), n(this, "renderRows", []), n(this, "visibleRows", []), n(this, "visibleHeight", 0), n(this, "visibleWidth", 0), n(this, "containerRect"), n(this, "data", []), this.ctx = t, this.init(), this.initTree(), this.initSelection(), this.initResizeRow(), this.initDragRow();
  }
  init() {
    const {
      canvasElement: t,
      header: e,
      footer: i,
      database: s,
      config: {
        FOOTER_FIXED: o,
        HEIGHT: r,
        EMPTY_BODY_HEIGHT: l = 0,
        MAX_HEIGHT: h = 0,
        ENABLE_OFFSET_HEIGHT: c = 0,
        OFFSET_HEIGHT: u = 0,
        FOOTER_POSITION: d
      }
    } = this.ctx, x = B(this.ctx.config);
    if (!e.width)
      return;
    this.x = 0, d === "top" && o ? this.y = e.height + i.height : this.y = e.height;
    const { data: f, sumHeight: m } = s.getData();
    this.height = m, this.data = f, this.width = e.width, this.visibleWidth = this.ctx.stageWidth - x;
    const g = this.ctx.footer.height;
    this.ctx.isEmpty = !this.data.length, !this.data.length && !r ? this.height = l : !this.data.length && r && (this.height = r - e.height - g - x);
    let w = this.height + e.height + x;
    w += g;
    let C = w;
    const E = window.innerHeight, { top: b } = this.containerRect || this.ctx.containerElement.getBoundingClientRect();
    if (E > b && c && !r) {
      const O = E - b - u;
      O > e.height + x ? C = O : w > h && (C = h);
    } else this.data.length && r ? C = r : this.data.length && h && w > h && (C = h);
    C > 0 && (this.ctx.stageHeight = Math.floor(C), this.ctx.stageElement.style.height = `${this.ctx.stageHeight}px`);
    let p = this.ctx.stageHeight - e.height - x;
    o ? this.visibleHeight = p - g : this.visibleHeight = p, this.data.length || (this.height = this.visibleHeight), this.ctx.body.x = this.x, this.ctx.body.y = this.y, this.ctx.body.width = this.width, this.ctx.body.height = this.height, this.ctx.body.visibleWidth = this.visibleWidth, this.ctx.body.visibleHeight = this.visibleHeight, this.ctx.body.data = f;
    const y = window.devicePixelRatio || 1, R = this.ctx.stageWidth * y, _ = this.ctx.stageHeight * y;
    t.width = Math.round(R), t.height = Math.round(_);
    const T = this.data.length ? "not-empty" : "empty";
    this.ctx.emit("emptyChange", {
      isEmpty: T,
      type: T,
      headerHeight: e.height,
      bodyHeight: this.height,
      footerHeight: g,
      width: this.width,
      height: this.data.length ? 0 : l + g
    });
    const v = Math.round(t.width / y * 1e4) / 1e4, I = Math.round(t.height / y * 1e4) / 1e4;
    this.ctx.canvasElement.setAttribute("style", `height:${I}px;width:${v}px;`), this.ctx.paint.scale(y);
  }
  initTree() {
    this.ctx.on("cellClick", (t, e) => {
      if (this.ctx.stageElement.style.cursor !== "pointer" || !t.isImageInside("tree", e))
        return;
      const i = this.ctx.database.getRowForRowKey(t.rowKey), { expand: s = !1, expandLazy: o = !1 } = i || {}, { EXPAND_LAZY: r, EXPAND_LAZY_METHOD: l } = this.ctx.config;
      if (r && l && !s && !o)
        typeof l == "function" && (this.ctx.database.expandLoading(t.rowKey, !0), l({
          row: t.row,
          rowIndex: t.rowIndex,
          colIndex: t.colIndex,
          column: t.column,
          value: t.getValue()
        }).then((h) => {
          this.ctx.database.setExpandChildren(t.rowKey, h), this.ctx.database.expandLoading(t.rowKey, !1), this.ctx.emit("expandChange", this.ctx.database.getExpandRowKeys());
        }).catch((h) => {
          this.ctx.database.expandLoading(t.rowKey, !1), console.error(h);
        }));
      else {
        const h = this.ctx.database.getIsExpand(t.rowKey);
        this.ctx.database.expandItem(t.rowKey, !h), this.ctx.emit("expandChange", this.ctx.database.getExpandRowKeys());
      }
    });
  }
  initSelection() {
    this.ctx.on("cellClick", (t, e) => {
      this.ctx.stageElement.style.cursor !== "pointer" || !t.isImageInside("selection", e) || !this.ctx.database.getRowSelectable(t.rowKey) || this.ctx.database.toggleRowSelection(t.rowKey, t.type);
    });
  }
  // 调整行的高度
  initResizeRow() {
    this.ctx.on("resize", () => {
      this.ctx.config.ENABLE_RESIZE_ROW && (this.containerRect = this.ctx.containerElement.getBoundingClientRect());
    }), this.ctx.on("resizeObserver", () => {
      this.ctx.config.ENABLE_RESIZE_ROW && (this.containerRect = this.ctx.containerElement.getBoundingClientRect());
    }), this.ctx.on("mouseup", () => {
      this.ctx.config.ENABLE_RESIZE_ROW && (this.isMouseDown = !1, this.resizeDiff !== 0 && this.resizeTarget && this.resizeRow(this.resizeTarget, this.resizeDiff), this.resizeTarget = null, this.resizeDiff = 0, this.isResizing = !1, setTimeout(() => {
        this.ctx.rowResizing = !1;
      }, 0), this.clientY = 0);
    }), this.ctx.on("mousedown", (t) => {
      this.ctx.config.ENABLE_RESIZE_ROW && this.ctx.isTarget(t) && (this.clientY = t.clientY, this.resizeTarget ? (this.isResizing = !0, this.ctx.rowResizing = !0) : (this.isResizing = !1, this.ctx.rowResizing = !1), this.isMouseDown = !0);
    }), this.ctx.on("mousemove", (t) => {
      if (!this.ctx.config.ENABLE_RESIZE_ROW || this.ctx.editing) return;
      const { offsetY: e, offsetX: i } = this.ctx.getOffset(t), s = e, o = i, r = t.clientY, {
        stageHeight: l,
        scrollY: h,
        config: { RESIZE_ROW_MIN_HEIGHT: c = 0 }
      } = this.ctx;
      if (this.isResizing && this.resizeTarget) {
        const u = this.resizeTarget.height;
        let d = r - this.clientY;
        const { calculatedHeight: x } = this.resizeTarget, f = x === -1 ? c : x;
        d + u < f && (d = -(u - f)), this.resizeDiff = d, this.ctx.emit("draw");
      } else {
        if (this.resizeTarget = null, this.isMouseDown)
          return;
        if (o < 0 || o > this.ctx.body.visibleWidth || s < 0 || s > this.ctx.header.visibleHeight + this.ctx.body.visibleHeight) {
          this.ctx.stageElement.style.cursor === "row-resize" && (this.ctx.stageElement.style.cursor = "default");
          return;
        }
        if (this.ctx.stageElement.style.cursor === "crosshair")
          return;
        this.ctx.stageElement.style.cursor === "row-resize" && (this.ctx.stageElement.style.cursor = "default");
        for (let u = 0; u < this.renderRows.length; u++) {
          const d = this.renderRows[u];
          if (s > d.y - h + d.height - 1.5 && s < d.y - h + d.height + 1.5 && s < l - 4)
            for (let x = 0; x < d.cells.length; x++) {
              const f = d.cells[x];
              o > f.drawX + 10 && o < f.drawX + f.width - 10 && f.rowspan === 1 && (this.ctx.stageElement.style.cursor = "row-resize", this.resizeTarget = d);
            }
        }
      }
    });
  }
  initDragRow() {
    this.ctx.on("cellMousedown", (t, e) => {
      this.ctx.config.ENABLE_DRAG_ROW && t.isImageInside("drag", e) && (this.dragSource = t, this.ctx.database.expandItem(t.rowKey, !1), this.ctx.dragRowIng = !0, this.dragRowDiff = this.ctx.mouseY - t.drawY, this.ctx.stageElement.style.cursor = "grabbing", this.ctx.clearSelector(), this.ctx.emit("dragRowMouseDown", t), this.ctx.emit("draw"));
    }), this.ctx.on("mouseup", async () => {
      if (this.ctx.dragRowIng) {
        if (this.dragSource && this.dragTarget && this.ctx.stageElement.style.cursor !== "not-allowed") {
          const t = this.dragSource, e = this.dragTarget, i = {
            source: t,
            target: e,
            position: this.dragPosition
          };
          this.ctx.emit("dragRowChange", i);
          let s = !0;
          const { BEFORE_DRAG_ROW_METHOD: o } = this.ctx.config;
          if (typeof o == "function" && (s = await o(i)), s && !this.ctx.config.ENABLE_DRAG_ROW_CUSTOM) {
            const r = this.ctx.database.getOriginalData(), { TREE_CHILDREN_KEY: l, ROW_KEY: h } = this.ctx.config, c = new ue(r, {
              key: h,
              childrenKey: l
            });
            c.treeMove(t.rowKey, e.rowKey, this.dragPosition), this.ctx.emit("loadData", c.getTree());
          }
        }
        this.dragTarget || (this.ctx.stageElement.style.cursor = "grab"), this.ctx.dragRowIng = !1, this.dragSource = null, this.dragTarget = null, this.dragPosition = "after", this.dragRowDiff = 0, this.ctx.emit("draw");
      }
    }), this.ctx.on("mousemove", (t) => {
      if (!this.ctx.dragRowIng)
        return;
      const { offsetY: e } = this.ctx.getOffset(t), { drawY: i } = this.dragTarget;
      i < e || i > e ? this.ctx.startAdjustPosition(t) : this.ctx.stopAdjustPosition();
    }), this.ctx.on("cellMouseenter", (t) => {
      if (!this.ctx.dragRowIng)
        return;
      this.dragTarget = t;
      const { ENABLE_DRAG_ROW_CROSS_LEVEL: e } = this.ctx.config, i = this.dragSource, s = this.dragTarget;
      if (!e && i && s && i.parentRowKey !== s.parentRowKey) {
        this.ctx.stageElement.style.cursor = "not-allowed";
        return;
      }
      this.ctx.stageElement.style.cursor = "grabbing", this.dragTarget = t;
      const { drawY: o, visibleHeight: r } = t, l = e ? r / 3 : r / 2;
      this.ctx.mouseY <= o + l ? this.dragPosition = "before" : this.ctx.mouseY > o + r - l ? this.dragPosition = "after" : this.dragPosition = "inside";
      const h = {
        dragSource: this.dragSource,
        dragTarget: this.dragTarget,
        dragPosition: this.dragPosition
      };
      this.ctx.emit("dragRowMove", h), this.ctx.emit("draw");
    });
  }
  resizeRow(t, e) {
    const { rowIndex: i, height: s, rowKey: o, data: r } = t;
    this.ctx.database.setRowHeight(i, s + e), this.init(), this.ctx.emit("draw"), this.ctx.emit("resizeRowChange", {
      rowIndex: i,
      oldHeight: s,
      height: s + e,
      rowKey: o,
      row: r,
      data: this.data
    });
  }
  drawTipLine() {
    if (this.isResizing && this.resizeTarget) {
      const {
        stageWidth: t,
        scrollY: e,
        config: { RESIZE_ROW_LINE_COLOR: i }
      } = this.ctx, s = this.resizeTarget.y - e, o = this.resizeTarget.height, r = s + o + this.resizeDiff - 0.5, l = [0, r - 0.5, t, r - 0.5];
      this.ctx.paint.drawLine(l, {
        borderColor: i,
        borderWidth: 1
      });
    }
  }
  // 拖拽提示线绘制
  drawDragRowTip() {
    if (this.ctx.dragRowIng && this.dragTarget && this.dragSource) {
      const {
        stageWidth: t,
        config: { DRAG_ROW_TIP_LINE_COLOR: e, DRAG_TIP_BG_COLOR: i }
      } = this.ctx, s = this.dragSource.visibleHeight;
      this.ctx.paint.drawRect(0, this.ctx.mouseY - this.dragRowDiff, this.visibleWidth, s, {
        fillColor: i,
        borderWidth: 0,
        borderColor: "transparent"
      });
      const o = this.dragTarget.drawY, r = this.dragTarget.height;
      let l = o;
      if (["before", "after"].includes(this.dragPosition)) {
        this.dragPosition === "after" && (l = o + r);
        const c = [0, l - 0.5, t, l - 0.5];
        this.ctx.paint.drawLine(c, {
          borderColor: e,
          borderWidth: 1.2
        });
      }
      ["inside"].includes(this.dragPosition) && (l = o + r / 2);
      const h = [0, l - 4, 6, l, 0, l + 4, 0, l - 4];
      this.ctx.paint.drawLine(h, {
        borderColor: e,
        borderWidth: 1.2,
        fillColor: e
      });
    }
  }
  drawFixedShadow() {
    const {
      fixedLeftWidth: t,
      fixedRightWidth: e,
      scrollX: i,
      header: s,
      stageWidth: o,
      config: {
        HEADER_BG_COLOR: r,
        FIXED_COLUMN_SHADOW_COLOR: l,
        FIXED_COLUMN_SHADOW_FADE_COLOR: h,
        FIXED_COLUMN_SHADOW_WIDTH: c
      }
    } = this.ctx, u = B(this.ctx.config);
    if (i > 0 && t !== 0 && !this.ctx.isEmpty && this.ctx.paint.drawShadow(this.x, this.y, t, this.height, {
      fillColor: r,
      side: "right",
      shadowWidth: c,
      colorStart: l,
      colorEnd: h
    }), i < Math.floor(s.width - o - 1) && e !== u && !this.ctx.isEmpty) {
      const d = s.width - (this.x + this.width) + o - e;
      this.ctx.paint.drawShadow(d, this.y, e, this.height, {
        fillColor: r,
        side: "left",
        shadowWidth: c,
        colorStart: h,
        colorEnd: l
      });
    }
  }
  binarySearch(t, e) {
    let i = 0, s = t.length - 1, o = -1;
    for (; i <= s; ) {
      let r = Math.floor((i + s) / 2), l = t[r].bottom;
      if (l === e)
        return r;
      l < e ? i = r + 1 : (o = r, s = r - 1);
    }
    return o;
  }
  update() {
    this.init();
    const {
      header: t,
      database: e,
      scrollY: i,
      config: { CELL_HEIGHT: s }
    } = this.ctx, o = i, { data: r, positions: l } = e.getData();
    this.ctx.maxRowIndex = r.length - 1;
    let h = this.binarySearch(l, o), c = this.binarySearch(l, o + this.visibleHeight);
    if (c === -1 && (c = this.ctx.maxRowIndex), h === -1 && c === this.ctx.maxRowIndex) {
      const d = Math.floor(this.visibleHeight / s);
      h = this.ctx.maxRowIndex - d;
    }
    this.headIndex = Math.max(0, h), this.tailIndex = Math.min(this.ctx.maxRowIndex, c + 1), this.visibleRows = r.slice(this.headIndex, this.tailIndex + 1), this.ctx.body.headIndex = this.headIndex, this.ctx.body.tailIndex = this.tailIndex, this.ctx.body.visibleRows = this.visibleRows;
    const u = [];
    for (let d = 0; d < this.visibleRows.length; d++) {
      const x = this.headIndex + d, f = this.visibleRows[d], { height: m, top: g } = this.ctx.database.getPositionForRowIndex(x), w = new xe(this.ctx, x, 0, g + this.y, t.width, m, f);
      u.push(w);
    }
    this.renderRows = u, this.ctx.body.renderRows = u;
  }
  updateAutoHeight() {
    const t = this.ctx.body.renderRows;
    if (!t.some((i) => i.calculatedHeightCells.length > 0))
      return !1;
    t.forEach((i) => {
      i.updateCalculatedHeight();
    });
    const e = t.map((i) => ({
      height: i.calculatedHeight,
      rowIndex: i.rowIndex
    }));
    return this.ctx.database.setBatchCalculatedRowHeight(e);
  }
  draw() {
    this.renderRows.forEach((t) => {
      t.drawContainer();
    }), this.renderRows.forEach((t) => {
      t.drawHorizontalBorder();
    }), this.renderRows.forEach((t) => {
      t.drawCenter();
    }), this.drawFixedShadow(), this.renderRows.forEach((t) => {
      t.drawFixedContainer();
    }), this.renderRows.forEach((t) => {
      t.drawFixedHorizontalBorder();
    }), this.renderRows.forEach((t) => {
      t.drawFixed();
    }), this.drawTipLine();
  }
}
class wi {
  constructor(t) {
    n(this, "ctx"), n(this, "renderRows", []), n(this, "data", []), n(this, "x", 0), n(this, "y", 0), n(this, "width", 0), n(this, "height", 0), n(this, "visibleWidth", 0), n(this, "visibleHeight", 0), this.ctx = t, this.init();
  }
  init() {
    this.data = this.ctx.database.getFooterData();
    const {
      header: t,
      body: e,
      config: { CELL_FOOTER_HEIGHT: i, FOOTER_FIXED: s, FOOTER_POSITION: o }
    } = this.ctx, r = B(this.ctx.config);
    this.width = t.width, this.visibleWidth = t.visibleWidth, this.height = this.data.reduce((l) => l + i, 0), this.visibleHeight = this.height, s ? o === "top" ? this.y = this.ctx.header.height : this.y = this.ctx.stageHeight - this.height - r : this.y = e.y + e.height, this.ctx.footer.x = this.x, this.ctx.footer.y = this.y, this.ctx.footer.height = this.height, this.ctx.footer.width = this.width, this.ctx.footer.visibleWidth = this.visibleWidth, this.ctx.footer.visibleHeight = this.visibleHeight;
  }
  drawFixedShadow() {
    const {
      fixedLeftWidth: t,
      fixedRightWidth: e,
      scrollX: i,
      header: s,
      stageWidth: o,
      config: {
        HEADER_BG_COLOR: r,
        FIXED_COLUMN_SHADOW_COLOR: l,
        FIXED_COLUMN_SHADOW_FADE_COLOR: h,
        FIXED_COLUMN_SHADOW_WIDTH: c
      }
    } = this.ctx, u = B(this.ctx.config);
    let d = this.y;
    if (this.ctx.config.FOOTER_FIXED || (d = this.y - this.ctx.scrollY), i > 0 && t !== 0 && this.ctx.paint.drawShadow(this.x, d, t, this.height, {
      fillColor: r,
      side: "right",
      shadowWidth: c,
      colorStart: l,
      colorEnd: h
    }), i < Math.floor(s.width - o - 1) && e !== u) {
      const x = s.width - (this.x + this.width) + o - e;
      this.ctx.paint.drawShadow(x, d, e, this.height, {
        fillColor: r,
        side: "left",
        shadowWidth: c,
        colorStart: h,
        colorEnd: l
      });
    }
  }
  update() {
    this.init();
    const { CELL_FOOTER_HEIGHT: t } = this.ctx.config;
    let e = this.y;
    const i = [];
    this.data.forEach((s, o) => {
      const r = new xe(this.ctx, o, 0, e, this.width, t, s, "footer");
      e += t, i.push(r);
    }), this.renderRows = i, this.ctx.footer.renderRows = this.renderRows;
  }
  drawTopLine() {
    const { stageWidth: t, config: e } = this.ctx, { BORDER: i } = e;
    if (!Dt(i))
      return;
    const s = [0, this.y, t, this.y];
    this.ctx.paint.drawLine(s, {
      borderColor: e.BORDER_COLOR,
      borderWidth: 1
    });
  }
  draw() {
    this.renderRows.forEach((t) => {
      t.drawContainer();
    }), this.renderRows.forEach((t) => {
      t.drawHorizontalBorder();
    }), this.renderRows.forEach((t) => {
      t.drawCenter();
    }), this.drawFixedShadow(), this.renderRows.forEach((t) => {
      t.drawFixedContainer();
    }), this.renderRows.forEach((t) => {
      t.drawFixedHorizontalBorder();
    }), this.renderRows.forEach((t) => {
      t.drawFixed();
    }), this.drawTopLine();
  }
}
class pi {
  constructor(t) {
    n(this, "isCut", !1), n(this, "isMultipleRow", !1), n(this, "ctx"), this.ctx = t, this.init();
  }
  init() {
    this.ctx.on("setMoveFocus", (t) => {
      this.moveFocus(t);
    }), this.ctx.on(
      "mousemove",
      At((t) => {
        var e;
        (e = this.ctx.focusCellHeader) != null && e.fixed || !this.ctx.dragHeaderIng && this.ctx.selectorMove && this.ctx.startAdjustPosition(t);
      }, 100)
    ), this.ctx.on("cellHoverChange", (t) => {
      if (!this.ctx.autofillMove) {
        if (t.operation) {
          this.selectRows(t, !1);
          return;
        }
        this.isMultipleRow || this.mouseenter();
      }
    }), this.ctx.on("cellClick", () => {
      this.adjustBoundaryPosition();
    }), this.ctx.on("cellMousedown", (t, e) => {
      if (!(!this.ctx.isTarget(e) || this.ctx.stageElement.style.cursor === "pointer" || this.ctx.stageElement.style.cursor === "crosshair")) {
        if (t.operation) {
          this.isMultipleRow = !0, this.selectRows(t);
          return;
        }
        window.getComputedStyle(e.target).userSelect !== "text" && e.preventDefault(), this.isMultipleRow = !1, this.click(e.shiftKey), this.ctx.emit("selectorClick", t);
      }
    }), this.ctx.on("mouseup", () => {
      this.ctx.selectorMove = !1, this.ctx.stopAdjustPosition(), setTimeout(() => {
        this.ctx.disableHoverIconClick = !1;
      }, 0);
    }), this.ctx.on("cellHeaderHoverChange", (t) => {
      this.ctx.textSelecting || this.ctx.mousedown && this.selectCols(t);
    }), this.ctx.on("cellHoverChange", (t) => {
      this.ctx.textSelecting || this.ctx.mousedown && this.selectCols(t);
    }), this.ctx.on("cellHeaderMousedown", (t, e) => {
      this.ctx.stageElement.style.cursor !== "pointer" && (window.getComputedStyle(e.target).userSelect !== "text" && e.preventDefault(), this.ctx.clearSelector(), t.operation ? this.selectAll() : this.selectCols(t));
    }), this.ctx.on("keydown", (t) => {
      if (!this.ctx.editing && !this.ctx.finding) {
        if (t.ctrlKey && t.code === "KeyV" || t.metaKey && t.code === "KeyV") {
          this.paste();
          return;
        }
        if (t.ctrlKey && t.code === "KeyC" || t.metaKey && t.code === "KeyC") {
          this.copy(), this.isCut = !1;
          return;
        }
        if (t.ctrlKey && t.code === "KeyX" || t.metaKey && t.code === "KeyX") {
          this.isCut = !0, this.copy();
          return;
        }
        if ((t.ctrlKey && t.code === "KeyA" || t.metaKey && t.code === "KeyA") && (t.preventDefault(), this.selectAll()), t.code === "ArrowLeft" || t.shiftKey && t.code === "Tab") {
          t.preventDefault(), this.moveFocus("LEFT");
          return;
        }
        if (t.code === "ArrowUp") {
          t.preventDefault(), this.moveFocus("TOP");
          return;
        }
        if (t.code === "ArrowRight" || t.code === "Tab") {
          t.preventDefault(), this.moveFocus("RIGHT");
          return;
        }
        if (t.code === "ArrowDown") {
          t.preventDefault(), this.moveFocus("BOTTOM");
          return;
        }
        if (t.code === "Delete" || t.code === "Backspace") {
          t.preventDefault();
          const { xArr: e, yArr: i } = this.ctx.selector;
          this.clearSelectedData(e, i);
          return;
        }
      }
    }), this.ctx.on("contextMenuClearSelected", () => {
      const { xArr: t, yArr: e } = this.ctx.selector;
      this.clearSelectedData(t, e);
    }), this.ctx.on("contextMenuCopy", () => {
      this.copy();
    }), this.ctx.on("contextMenuPaste", () => {
      this.paste();
    }), this.ctx.on("contextMenuCut", () => {
      this.isCut = !0, this.copy();
    }), this.ctx.on("setSelectorCell", (t) => {
      this.ctx.setFocusCell(t), this.click(), this.adjustBoundaryPosition();
    }), this.ctx.on("selectCols", (t) => {
      this.selectCols(t);
    });
  }
  setSelector(t, e) {
    if (this.ctx.dragHeaderIng || this.ctx.dragRowIng)
      return;
    const { ENABLE_SELECTOR_SPAN_COL: i, ENABLE_SELECTOR_SPAN_ROW: s } = this.ctx.config;
    let o = t, r = e;
    if (!s) {
      const [l] = r;
      r = [l, l];
    }
    if (!i) {
      const [l] = o;
      o = [l, l];
    }
    if (JSON.stringify(this.ctx.selector.xArr) !== JSON.stringify(o) || JSON.stringify(this.ctx.selector.yArr) !== JSON.stringify(r)) {
      this.ctx.mousedown && (this.ctx.selectorMove = !0, this.ctx.disableHoverIconClick = !0), this.ctx.selector.enable = !0;
      const {
        SELECTOR_AREA_MIN_X: l,
        SELECTOR_AREA_MAX_X: h,
        SELECTOR_AREA_MIN_Y: c,
        SELECTOR_AREA_MAX_Y: u,
        SELECTOR_AREA_MAX_X_OFFSET: d,
        SELECTOR_AREA_MAX_Y_OFFSET: x
      } = this.ctx.config, f = l, m = h || this.ctx.maxColIndex - d, g = c, w = u || this.ctx.maxRowIndex - x;
      let [C, E] = o, [b, p] = r;
      if (C < f || E > m || b < g || p > w)
        return;
      if (this.ctx.config.ENABLE_MERGE_CELL_LINK) {
        const R = this.adjustMergeCells(o, r);
        b = R.yArr[0], p = R.yArr[1], C = R.xArr[0], E = R.xArr[1], this.ctx.onlyMergeCell = R.onlyMergeCell;
      }
      C === E && b === p ? this.ctx.selectOnlyOne = !0 : this.ctx.selectOnlyOne = !1, o = [Math.max(f, C), Math.min(m, E)], r = [Math.max(g, b), Math.min(w, p)];
      const { BEFORE_SET_SELECTOR_METHOD: y } = this.ctx.config;
      if (typeof y == "function") {
        const R = y({
          focusCell: this.ctx.focusCell,
          xArr: o,
          yArr: r
        });
        if (!R)
          return;
        o = R.xArr, r = R.yArr;
      }
      this.ctx.selector.xArr = o, this.ctx.selector.yArr = r, p === this.ctx.maxRowIndex && b === 0 ? this.ctx.selectColsIng = !0 : this.ctx.selectColsIng = !1, E === this.ctx.maxColIndex && C === 0 ? this.ctx.selectRowsIng = !0 : this.ctx.selectRowsIng = !1, this.ctx.emit("setSelector", this.ctx.selector), this.ctx.emit("drawView");
    }
  }
  adjustMergeCells(t, e) {
    var i;
    const [s, o] = e, [r, l] = t;
    if (o === this.ctx.maxRowIndex && s === 0 || l === this.ctx.maxColIndex && r === 0)
      return {
        xArr: t,
        yArr: e,
        onlyMergeCell: !1
      };
    let h = [], c = [];
    for (let g = 0; g <= e[1] - e[0]; g++)
      for (let w = 0; w <= t[1] - t[0]; w++) {
        const C = g + e[0], E = w + t[0], b = this.ctx.database.getVirtualBodyCell(C, E);
        b && ((C === s || C === o) && h.push(b), (E === r || E === l) && c.push(b));
      }
    const u = h.reduce(
      (g, w) => {
        const { yArr: C } = w.getSpanInfo(), [E, b] = C;
        return g.minY = Math.min(g.minY, E), g.maxY = Math.max(g.maxY, b), g;
      },
      {
        minY: s,
        maxY: o
      }
    ), d = c.reduce(
      (g, w) => {
        const { xArr: C } = w.getSpanInfo(), [E, b] = C;
        return g.minX = Math.min(g.minX, E), g.maxX = Math.max(g.maxX, b), g;
      },
      {
        minX: r,
        maxX: l
      }
    ), x = [d.minX, d.maxX], f = [u.minY, u.maxY];
    let m = !1;
    if (d.minX !== d.maxX || u.minY !== u.maxY) {
      const g = JSON.stringify(x) + JSON.stringify(f), w = (i = this.ctx.focusCell) == null ? void 0 : i.getSpanInfo();
      m = (w && JSON.stringify(w.xArr) + JSON.stringify(w.yArr)) === g;
    }
    return {
      xArr: x,
      yArr: f,
      onlyMergeCell: m
    };
  }
  selectCols(t) {
    if (this.ctx.config.ENABLE_SELECTOR_SINGLE || !this.ctx.config.ENABLE_SELECTOR_ALL_ROWS || this.ctx.autofillMove || this.ctx.columnResizing || this.ctx.editing)
      return;
    const { SELECTOR_AREA_MIN_Y: e, SELECTOR_AREA_MAX_Y: i, SELECTOR_AREA_MAX_Y_OFFSET: s } = this.ctx.config, o = e, r = i || this.ctx.maxRowIndex - s;
    if (this.ctx.focusCellHeader) {
      const { colIndex: l } = this.ctx.focusCellHeader;
      if (this.ctx.clearSelector(), this.ctx.mousedown && t.colIndex >= l) {
        const h = [l, t.colIndex + t.colspan - 1], c = [o, r];
        this.setSelector(h, c);
      } else {
        const h = [t.colIndex, l + t.colspan - 1], c = [o, r];
        this.setSelector(h, c);
      }
    }
  }
  selectAll() {
    if (this.ctx.autofillMove || this.ctx.editing)
      return;
    const { ENABLE_SELECTOR_ALL_ROWS: t, ENABLE_SELECTOR_ALL_COLS: e } = this.ctx.config;
    if (t && e) {
      const {
        SELECTOR_AREA_MIN_X: i,
        SELECTOR_AREA_MAX_X: s,
        SELECTOR_AREA_MIN_Y: o,
        SELECTOR_AREA_MAX_Y: r,
        SELECTOR_AREA_MAX_X_OFFSET: l,
        SELECTOR_AREA_MAX_Y_OFFSET: h
      } = this.ctx.config, c = i, u = s || this.ctx.maxColIndex - l, d = o, x = r || this.ctx.maxRowIndex - h, f = [c, u], m = [d, x];
      this.setSelector(f, m);
    }
  }
  selectRows(t, e = !0) {
    if (this.ctx.config.ENABLE_SELECTOR_SINGLE || !this.ctx.config.ENABLE_SELECTOR_ALL_COLS || this.ctx.autofillMove || this.ctx.editing)
      return;
    const { SELECTOR_AREA_MIN_X: i, SELECTOR_AREA_MAX_X: s, SELECTOR_AREA_MAX_X_OFFSET: o } = this.ctx.config, r = s || this.ctx.maxColIndex - o, l = i;
    if (e) {
      this.ctx.setFocusCell(t);
      const h = [l, r], c = [t.rowIndex, t.rowIndex];
      this.setSelector(h, c);
    }
    if (this.ctx.focusCell && this.ctx.mousedown) {
      const { rowIndex: h } = this.ctx.focusCell;
      if (t.rowIndex >= h) {
        const c = [l, r], u = [h, t.rowIndex];
        this.setSelector(c, u);
      } else {
        const c = [l, r], u = [t.rowIndex, h];
        this.setSelector(c, u);
      }
    }
  }
  mouseenter() {
    if (this.ctx.config.ENABLE_SELECTOR_SINGLE || this.ctx.editing)
      return;
    const { mousedown: t, focusCell: e, hoverCell: i } = this.ctx;
    if (t && e && i) {
      const { rowIndex: s, colIndex: o } = e, r = Math.min(i.colIndex, o), l = Math.max(i.colIndex, o), h = Math.min(i.rowIndex, s), c = Math.max(i.rowIndex, s), u = [r, l], d = [h, c];
      this.setSelector(u, d);
    }
  }
  click(t = !1) {
    const { focusCell: e, clickCell: i } = this.ctx;
    if (e && this.isInSettingRange(e.rowIndex, e.colIndex))
      if (this.ctx.selector.enable = !0, i && t) {
        if (this.ctx.config.ENABLE_SELECTOR_SINGLE)
          return;
        const { colIndex: s, rowIndex: o } = i, { colIndex: r, rowIndex: l } = e, h = Math.min(r, s), c = Math.max(r, s), u = Math.min(l, o), d = Math.max(l, o), x = [h, c], f = [u, d];
        this.setSelector(x, f);
      } else {
        this.ctx.emit("cellSelectedClick", e);
        const s = [e.colIndex, e.colIndex], o = [e.rowIndex, e.rowIndex];
        this.setSelector(s, o);
      }
  }
  clearCopyLine() {
    this.ctx.selector.xArrCopy = [-1, -1], this.ctx.selector.yArrCopy = [-1, -1];
  }
  /**
   * 获取选中单元格
   * @param rowIndex
   * @param colIndex
   * @returns
   */
  getCell(t, e) {
    const i = this.ctx.body.renderRows.find((s) => s.rowIndex === t);
    return i?.cells.find((s) => s.colIndex === e);
  }
  /**
   * 复制
   * @returns
   */
  copy() {
    if (!this.ctx.config.ENABLE_COPY || this.ctx.domSelectionStr || this.ctx.textSelectionStr)
      return;
    let { value: t, xArr: e, yArr: i } = this.ctx.getSelectedData();
    if (this.ctx.config.ENABLE_MERGE_CELL_LINK && this.ctx.database.hasMergeCell(e, i))
      if (this.ctx.onlyMergeCell && this.ctx.focusCell) {
        const r = this.ctx.focusCell;
        t = [[r.getValue()]], e = [r.colIndex, r.colIndex], i = [r.rowIndex, r.rowIndex];
      } else {
        const r = {
          code: "ERR_MERGED_CELLS_COPY",
          message: this.ctx.locale.getText("mergeCellNoCopy")
        };
        this.ctx.hasEvent("error") ? this.ctx.emit("error", r) : console.error(r.message);
        return;
      }
    const { BEFORE_COPY_METHOD: s } = this.ctx.config;
    if (typeof s == "function") {
      const r = s({
        focusCell: this.ctx.focusCell,
        data: t,
        xArr: e,
        yArr: i
      });
      if (!r)
        return;
      t = r.data;
    }
    const o = De(t);
    navigator.clipboard ? navigator.clipboard.writeText(o).then(() => {
      this.ctx.selector.xArrCopy = this.ctx.selector.xArr.slice(), this.ctx.selector.yArrCopy = this.ctx.selector.yArr.slice(), this.ctx.emit("copyChange", {
        xArr: this.ctx.selector.xArrCopy,
        yArr: this.ctx.selector.yArrCopy,
        data: t
      }), this.ctx.emit("draw");
    }).catch((r) => console.error("Copy Failure:", r)) : console.error("current browser does not support the Clipboard API");
  }
  clearSelectedData(t, e, i = !1, s = null) {
    let o = [];
    const r = /* @__PURE__ */ new Set();
    for (let h = 0; h <= e[1] - e[0]; h++)
      for (let c = 0; c <= t[1] - t[0]; c++) {
        const u = h + e[0], d = c + t[0], x = this.ctx.database.getItemValueForRowIndexAndColIndex(u, d);
        if (x) {
          const { rowKey: f, key: m } = x;
          this.ctx.database.getReadonly(f, m) || (r.add(f), o.push({
            rowKey: f,
            key: m,
            value: s,
            row: {}
            //内部有设置
          }));
        }
      }
    if (!o.length)
      return [];
    if (i)
      return o;
    this.ctx.database.batchSetItemValue(o, !0);
    let l = [];
    return r.forEach((h) => {
      l.push(this.ctx.database.getRowDataItemForRowKey(h));
    }), this.ctx.emit("clearSelectedDataChange", o, l), o;
  }
  paste() {
    if (!navigator.clipboard) {
      console.error("current browser does not support the Clipboard API");
      return;
    }
    const { ENABLE_PASTER: t } = this.ctx.config;
    if (this.ctx.selector.enable && t) {
      const e = this.ctx.selector.yArr[0], i = this.ctx.selector.xArr[0], s = /* @__PURE__ */ new Set();
      navigator.clipboard.readText().then(async (o) => {
        let r = Ae(o);
        const l = [i, i + r[0].length - 1], h = [e, e + r.length - 1], [c, u] = h, [d, x] = l, f = u - this.ctx.maxRowIndex, m = x - this.ctx.maxColIndex;
        (f > 0 || m > 0) && this.ctx.emit("onPastedDataOverflow", {
          maxY: u,
          maxX: x,
          minY: c,
          minX: d,
          overflowRowCount: f,
          overflowColCount: m,
          textArr: r
        });
        const g = r.length === 1 && r[0].length === 1;
        if (this.ctx.config.ENABLE_MERGE_CELL_LINK && this.ctx.database.hasMergeCell(l, h) && !g) {
          const b = {
            code: "ERR_MERGED_CELLS_PASTE",
            message: this.ctx.locale.getText("mergeCellNoPaste"),
            data: []
          };
          this.ctx.hasEvent("error") ? this.ctx.emit("error", b) : console.error(b.message);
          return;
        }
        let w = [];
        for (let b = 0; b <= r.length - 1; b++) {
          const p = r[b].length;
          for (let y = 0; y <= p - 1; y++) {
            const R = b + e, _ = y + i, T = r[b][y], v = this.ctx.database.getItemValueForRowIndexAndColIndex(
              R,
              _
            );
            if (v) {
              const { rowKey: I, key: O } = v;
              this.ctx.database.getReadonly(I, O) || (s.add(I), w.push({
                rowKey: I,
                key: O,
                value: T,
                row: {}
                //内部有设置
              }));
            }
          }
        }
        if (this.isCut) {
          const b = this.clearSelectedData(
            this.ctx.selector.xArrCopy,
            this.ctx.selector.yArrCopy,
            !0
            // 忽略设置，只返回数据，用于cut，实现历史回退需要返回两次问题
          ), p = w.map((y) => `${y.rowKey}-${y.key}`);
          b.forEach((y) => {
            p.includes(`${y.rowKey}-${y.key}`) || w.unshift(y);
          }), this.isCut = !1;
        }
        if (!w.length)
          return;
        const { BEFORE_PASTE_DATA_METHOD: C } = this.ctx.config;
        if (typeof C == "function") {
          const b = C, p = w.map((y) => ({
            rowKey: y.rowKey,
            key: y.key,
            value: y.value,
            oldValue: this.ctx.database.getItemValue(y.rowKey, y.key),
            row: this.ctx.database.getRowDataItemForRowKey(y.rowKey)
          }));
          if (w = await b(p, l, h, r), w && !w.length)
            return;
        }
        this.clearCopyLine(), this.ctx.batchSetItemValueByEditor(w, !0);
        let E = [];
        s.forEach((b) => {
          E.push(this.ctx.database.getRowDataItemForRowKey(b));
        }), this.ctx.emit("pasteChange", w, E), this.ctx.emit("draw");
      }).catch((o) => {
        console.error("Failed to get the clipboard content:", o);
      });
    }
  }
  /**键盘上下左右切换
   * @param dir
   */
  moveFocus(t) {
    if (this.ctx.editing)
      return;
    const { focusCell: e } = this.ctx;
    if (!e)
      return;
    let { colIndex: i = 0, rowIndex: s = 0 } = e;
    const o = 0, r = 0, l = this.ctx.maxColIndex, h = this.ctx.maxRowIndex;
    switch (t) {
      case "LEFT":
        i > o && i--;
        break;
      case "TOP":
        s > r && s--;
        break;
      case "RIGHT":
        i < l && i++;
        break;
      case "BOTTOM":
        s < h && s++;
        break;
    }
    const c = [i, i], u = [s, s], d = this.getCell(s, i);
    d && (d.operation || this.isInSettingRange(d.rowIndex, d.colIndex) && (this.ctx.setFocusCell(d), this.setSelector(c, u), this.adjustBoundaryPosition(), this.ctx.emit("moveFocus", d), this.ctx.emit("draw")));
  }
  // 判断是否在设置范围内
  isInSettingRange(t, e) {
    const {
      SELECTOR_AREA_MIN_X: i,
      SELECTOR_AREA_MAX_X: s,
      SELECTOR_AREA_MIN_Y: o,
      SELECTOR_AREA_MAX_Y: r,
      SELECTOR_AREA_MAX_X_OFFSET: l,
      SELECTOR_AREA_MAX_Y_OFFSET: h
    } = this.ctx.config, c = i, u = s || this.ctx.maxColIndex - l, d = o, x = r || this.ctx.maxRowIndex - h;
    return !(e < c || e > u || t < d || t > x);
  }
  /**
   * 调整滚动条位置，让焦点单元格始终出现在可视区域内
   */
  adjustBoundaryPosition() {
    const {
      stageHeight: t,
      stageWidth: e,
      focusCell: i,
      fixedRightWidth: s,
      fixedLeftWidth: o,
      header: r,
      footer: l,
      body: h,
      scrollX: c,
      scrollY: u,
      config: { FOOTER_FIXED: d, FOOTER_POSITION: x, ENABLE_MERGE_CELL_LINK: f }
    } = this.ctx, m = B(this.ctx.config);
    if (!i)
      return;
    f && this.ctx.onlyMergeCell && i.updateSpanInfo();
    const { drawX: g, drawY: w, width: C, height: E, fixed: b } = i, p = o - g + 1, y = i.drawX + C - (e - s) + 1;
    let R = r.height - w, _ = E;
    _ > h.visibleHeight && (_ = h.visibleHeight);
    let T = 0;
    d && (x === "top" ? R = r.height + l.height - w : T = l.visibleHeight);
    const v = w + _ - (t - T - m);
    let I = c, O = u;
    y > 0 && !b ? I = Math.floor(c + y) : p > 0 && !b && (I = Math.floor(c - p)), R > 0 ? O = Math.floor(u - R) : v > 0 && (O = Math.floor(u + v)), (Math.abs(c - I) > 2.5 || Math.abs(u - O) > 2.5) && this.ctx.setScroll(I, O);
  }
  destroy() {
  }
}
class Ei {
  constructor(t) {
    n(this, "ctx"), n(this, "maxColRowCell"), this.ctx = t, this.init();
  }
  init() {
    this.ctx.on("mousemove", (t) => {
      if (this.ctx.stageElement.style.cursor === "crosshair" && (this.ctx.stageElement.style.cursor = "default"), this.ctx.editing || !this.ctx.focusCell || !this.maxColRowCell)
        return;
      const { offsetX: e, offsetY: i } = this.ctx.getOffset(t), { colIndex: s, rowIndex: o, drawX: r, drawY: l, width: h, height: c } = this.maxColRowCell, u = 6, d = s === this.ctx.maxColIndex || o === this.ctx.maxRowIndex ? 0 : 2, x = r + h - u + d, f = l + c - u + d;
      e > x && i > f && e < x + u && i < f + u && (this.ctx.stageElement.style.cursor = "crosshair"), this.ctx.autofillMove && this.ctx.startAdjustPosition(t);
    }), this.ctx.on("cellMouseenter", (t) => {
      const { xArr: e, yArr: i } = this.ctx.selector, s = e[1], o = i[1], { colIndex: r, rowIndex: l } = t;
      this.ctx.config.ENABLE_AUTOFILL && r === s && l === o && (this.maxColRowCell = t), this.mouseenter(t);
    }), this.ctx.on("mousedown", () => {
      this.ctx.stageElement.style.cursor === "crosshair" && this.setMousedown();
    }), this.ctx.on("mouseup", () => {
      this.setMouseUp(), this.ctx.stopAdjustPosition();
    });
  }
  /**
   * 是否在填充
   * @returns
   */
  isAutofillIng() {
    const { xArr: t, yArr: e } = this.ctx.selector;
    return !(JSON.stringify(this.ctx.autofill.xArr) === JSON.stringify(t) && JSON.stringify(this.ctx.autofill.yArr) === JSON.stringify(e));
  }
  setMousedown() {
    this.ctx.autofill.enable = !0, this.ctx.autofillMove = !0, this.ctx.disableHoverIconClick = !0;
  }
  setMouseUp() {
    this.ctx.autofill.enable && (this.isAutofillIng() && this.autofillData(), this.ctx.autofill.enable = !1, this.ctx.autofillMove = !1, this.ctx.autofill.xArr = [-1, -1], this.ctx.autofill.yArr = [-1, -1], setTimeout(() => {
      this.ctx.disableHoverIconClick = !1;
    }, 0));
  }
  setAutofill(t, e) {
    const { ENABLE_AUTOFILL: i, ENABLE_AUTOFILL_SPAN_COL: s, ENABLE_AUTOFILL_SPAN_ROW: o } = this.ctx.config;
    if (!i)
      return;
    let r = t, l = e;
    const h = this.ctx.selector.xArr, c = this.ctx.selector.yArr;
    if (!(!o && JSON.stringify(c) !== JSON.stringify(l)) && !(!s && JSON.stringify(h) !== JSON.stringify(r)) && (JSON.stringify(this.ctx.autofill.xArr) !== JSON.stringify(r) || JSON.stringify(this.ctx.autofill.yArr) !== JSON.stringify(l))) {
      const {
        SELECTOR_AREA_MIN_X: u,
        SELECTOR_AREA_MAX_X: d,
        SELECTOR_AREA_MIN_Y: x,
        SELECTOR_AREA_MAX_Y: f,
        SELECTOR_AREA_MAX_X_OFFSET: m,
        SELECTOR_AREA_MAX_Y_OFFSET: g
      } = this.ctx.config, w = u, C = d || this.ctx.maxColIndex - m, E = x, b = f || this.ctx.maxRowIndex - g;
      let [p, y] = r, [R, _] = l;
      if (p < w || R < E)
        return;
      r = [Math.max(w, p), Math.min(C, y)], l = [Math.max(E, R), Math.min(b, _)];
      const { BEFORE_SET_AUTOFILL_METHOD: T } = this.ctx.config;
      if (typeof T == "function") {
        const v = T({
          focusCell: this.ctx.focusCell,
          xArr: r,
          yArr: l
        });
        if (!v)
          return;
        r = v.xArr, l = v.yArr;
      }
      this.ctx.autofill.xArr = r, this.ctx.autofill.yArr = l, this.ctx.emit("setAutofill", this.ctx.autofill), this.ctx.emit("draw");
    }
  }
  /**
   * 填充数据
   */
  async autofillData() {
    const t = /* @__PURE__ */ new Set(), e = this.ctx.getSelectedData(), i = /* @__PURE__ */ new Map();
    for (let f = 0; f <= e.yArr[1] - e.yArr[0]; f++)
      for (let m = 0; m <= e.xArr[1] - e.xArr[0]; m++) {
        const g = f + e.yArr[0], w = m + e.xArr[0];
        i.set(`${g}-${w}`, !0);
      }
    const { value: s } = e, o = s[0].length, r = s.length, l = this.ctx.autofill.xArr, h = this.ctx.autofill.yArr, c = o === 1 && r === 1;
    if (this.ctx.config.ENABLE_MERGE_CELL_LINK && this.ctx.database.hasMergeCell(l, h) && !c) {
      const f = {
        code: "ERR_MERGED_CELLS_AUTOFILL",
        message: this.ctx.locale.getText("mergeCellNoFill"),
        data: []
      };
      this.ctx.hasEvent("error") ? this.ctx.emit("error", f) : console.error(f.message);
      return;
    }
    let u = [];
    for (let f = 0; f <= h[1] - h[0]; f++)
      for (let m = 0; m <= l[1] - l[0]; m++) {
        const g = m + l[0], w = f + h[0], C = s[f % r][m % o], E = this.ctx.database.getItemValueForRowIndexAndColIndex(w, g), b = `${w}-${g}`;
        if (E && !i.has(b)) {
          const { rowKey: p, key: y } = E;
          this.ctx.database.getReadonly(p, y) || (t.add(p), u.push({
            rowKey: p,
            key: y,
            value: C,
            row: {}
          }));
        }
      }
    if (!u.length)
      return;
    this.ctx.selector.xArr = this.ctx.autofill.xArr, this.ctx.selector.yArr = this.ctx.autofill.yArr;
    const { BEFORE_AUTOFILL_DATA_METHOD: d } = this.ctx.config;
    if (typeof d == "function") {
      const f = d, m = u.map((g) => ({
        rowKey: g.rowKey,
        key: g.key,
        value: g.value,
        oldValue: this.ctx.database.getItemValue(g.rowKey, g.key),
        row: this.ctx.database.getRowDataItemForRowKey(g.rowKey)
      }));
      if (u = await f(m, l, h), u && !u.length)
        return;
    }
    this.ctx.batchSetItemValueByEditor(u, !0);
    let x = [];
    t.forEach((f) => {
      x.push(this.ctx.database.getRowDataItemForRowKey(f));
    }), this.ctx.emit("autofillChange", u, x), this.ctx.emit("draw");
  }
  mouseenter(t) {
    if (["index", "selection", "index-selection"].includes(t.type))
      return;
    const { selector: e, autofill: i } = this.ctx;
    if (this.ctx.mousedown && e.enable && i.enable) {
      const { rowIndex: s, colIndex: o } = t, r = e.xArr.slice(), l = e.yArr.slice();
      s >= e.yArr[0] && s <= e.yArr[1] ? o > e.xArr[1] ? r.splice(1, 1, o) : o < e.xArr[0] && r.splice(0, 1, o) : s > e.yArr[1] ? l.splice(1, 1, s) : s < e.yArr[0] && l.splice(0, 1, s), this.setAutofill(r, l);
    }
  }
  destroy() {
  }
}
const Q = Math.min, U = Math.max, xt = Math.round, ht = Math.floor, Y = (a) => ({
  x: a,
  y: a
}), yi = {
  left: "right",
  right: "left",
  bottom: "top",
  top: "bottom"
};
function Tt(a, t, e) {
  return U(a, Q(t, e));
}
function rt(a, t) {
  return typeof a == "function" ? a(t) : a;
}
function j(a) {
  return a.split("-")[0];
}
function nt(a) {
  return a.split("-")[1];
}
function fe(a) {
  return a === "x" ? "y" : "x";
}
function Nt(a) {
  return a === "y" ? "height" : "width";
}
function P(a) {
  const t = a[0];
  return t === "t" || t === "b" ? "y" : "x";
}
function kt(a) {
  return fe(P(a));
}
function bi(a, t, e) {
  e === void 0 && (e = !1);
  const i = nt(a), s = kt(a), o = Nt(s);
  let r = s === "x" ? i === (e ? "end" : "start") ? "right" : "left" : i === "start" ? "bottom" : "top";
  return t.reference[o] > t.floating[o] && (r = ft(r)), [r, ft(r)];
}
function Ci(a) {
  const t = ft(a);
  return [Ot(a), t, Ot(t)];
}
function Ot(a) {
  return a.includes("start") ? a.replace("start", "end") : a.replace("end", "start");
}
const qt = ["left", "right"], Zt = ["right", "left"], vi = ["top", "bottom"], Ri = ["bottom", "top"];
function Ii(a, t, e) {
  switch (a) {
    case "top":
    case "bottom":
      return e ? t ? Zt : qt : t ? qt : Zt;
    case "left":
    case "right":
      return t ? vi : Ri;
    default:
      return [];
  }
}
function _i(a, t, e, i) {
  const s = nt(a);
  let o = Ii(j(a), e === "start", i);
  return s && (o = o.map((r) => r + "-" + s), t && (o = o.concat(o.map(Ot)))), o;
}
function ft(a) {
  const t = j(a);
  return yi[t] + a.slice(t.length);
}
function Ti(a) {
  return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    ...a
  };
}
function ge(a) {
  return typeof a != "number" ? Ti(a) : {
    top: a,
    right: a,
    bottom: a,
    left: a
  };
}
function gt(a) {
  const {
    x: t,
    y: e,
    width: i,
    height: s
  } = a;
  return {
    width: i,
    height: s,
    top: e,
    left: t,
    right: t + i,
    bottom: e + s,
    x: t,
    y: e
  };
}
function Jt(a, t, e) {
  let {
    reference: i,
    floating: s
  } = a;
  const o = P(t), r = kt(t), l = Nt(r), h = j(t), c = o === "y", u = i.x + i.width / 2 - s.width / 2, d = i.y + i.height / 2 - s.height / 2, x = i[l] / 2 - s[l] / 2;
  let f;
  switch (h) {
    case "top":
      f = {
        x: u,
        y: i.y - s.height
      };
      break;
    case "bottom":
      f = {
        x: u,
        y: i.y + i.height
      };
      break;
    case "right":
      f = {
        x: i.x + i.width,
        y: d
      };
      break;
    case "left":
      f = {
        x: i.x - s.width,
        y: d
      };
      break;
    default:
      f = {
        x: i.x,
        y: i.y
      };
  }
  switch (nt(t)) {
    case "start":
      f[r] -= x * (e && c ? -1 : 1);
      break;
    case "end":
      f[r] += x * (e && c ? -1 : 1);
      break;
  }
  return f;
}
async function Oi(a, t) {
  var e;
  t === void 0 && (t = {});
  const {
    x: i,
    y: s,
    platform: o,
    rects: r,
    elements: l,
    strategy: h
  } = a, {
    boundary: c = "clippingAncestors",
    rootBoundary: u = "viewport",
    elementContext: d = "floating",
    altBoundary: x = !1,
    padding: f = 0
  } = rt(t, a), m = ge(f), g = l[x ? d === "floating" ? "reference" : "floating" : d], w = gt(await o.getClippingRect({
    element: (e = await (o.isElement == null ? void 0 : o.isElement(g))) == null || e ? g : g.contextElement || await (o.getDocumentElement == null ? void 0 : o.getDocumentElement(l.floating)),
    boundary: c,
    rootBoundary: u,
    strategy: h
  })), C = d === "floating" ? {
    x: i,
    y: s,
    width: r.floating.width,
    height: r.floating.height
  } : r.reference, E = await (o.getOffsetParent == null ? void 0 : o.getOffsetParent(l.floating)), b = await (o.isElement == null ? void 0 : o.isElement(E)) ? await (o.getScale == null ? void 0 : o.getScale(E)) || {
    x: 1,
    y: 1
  } : {
    x: 1,
    y: 1
  }, p = gt(o.convertOffsetParentRelativeRectToViewportRelativeRect ? await o.convertOffsetParentRelativeRectToViewportRelativeRect({
    elements: l,
    rect: C,
    offsetParent: E,
    strategy: h
  }) : C);
  return {
    top: (w.top - p.top + m.top) / b.y,
    bottom: (p.bottom - w.bottom + m.bottom) / b.y,
    left: (w.left - p.left + m.left) / b.x,
    right: (p.right - w.right + m.right) / b.x
  };
}
const Si = 50, Li = async (a, t, e) => {
  const {
    placement: i = "bottom",
    strategy: s = "absolute",
    middleware: o = [],
    platform: r
  } = e, l = r.detectOverflow ? r : {
    ...r,
    detectOverflow: Oi
  }, h = await (r.isRTL == null ? void 0 : r.isRTL(t));
  let c = await r.getElementRects({
    reference: a,
    floating: t,
    strategy: s
  }), {
    x: u,
    y: d
  } = Jt(c, i, h), x = i, f = 0;
  const m = {};
  for (let g = 0; g < o.length; g++) {
    const w = o[g];
    if (!w)
      continue;
    const {
      name: C,
      fn: E
    } = w, {
      x: b,
      y: p,
      data: y,
      reset: R
    } = await E({
      x: u,
      y: d,
      initialPlacement: i,
      placement: x,
      strategy: s,
      middlewareData: m,
      rects: c,
      platform: l,
      elements: {
        reference: a,
        floating: t
      }
    });
    u = b ?? u, d = p ?? d, m[C] = {
      ...m[C],
      ...y
    }, R && f < Si && (f++, typeof R == "object" && (R.placement && (x = R.placement), R.rects && (c = R.rects === !0 ? await r.getElementRects({
      reference: a,
      floating: t,
      strategy: s
    }) : R.rects), {
      x: u,
      y: d
    } = Jt(c, x, h)), g = -1);
  }
  return {
    x: u,
    y: d,
    placement: x,
    strategy: s,
    middlewareData: m
  };
}, Mi = (a) => ({
  name: "arrow",
  options: a,
  async fn(t) {
    const {
      x: e,
      y: i,
      placement: s,
      rects: o,
      platform: r,
      elements: l,
      middlewareData: h
    } = t, {
      element: c,
      padding: u = 0
    } = rt(a, t) || {};
    if (c == null)
      return {};
    const d = ge(u), x = {
      x: e,
      y: i
    }, f = kt(s), m = Nt(f), g = await r.getDimensions(c), w = f === "y", C = w ? "top" : "left", E = w ? "bottom" : "right", b = w ? "clientHeight" : "clientWidth", p = o.reference[m] + o.reference[f] - x[f] - o.floating[m], y = x[f] - o.reference[f], R = await (r.getOffsetParent == null ? void 0 : r.getOffsetParent(c));
    let _ = R ? R[b] : 0;
    (!_ || !await (r.isElement == null ? void 0 : r.isElement(R))) && (_ = l.floating[b] || o.floating[m]);
    const T = p / 2 - y / 2, v = _ / 2 - g[m] / 2 - 1, I = Q(d[C], v), O = Q(d[E], v), M = I, L = _ - g[m] - O, S = _ / 2 - g[m] / 2 + T, D = Tt(M, S, L), H = !h.arrow && nt(s) != null && S !== D && o.reference[m] / 2 - (S < M ? I : O) - g[m] / 2 < 0, A = H ? S < M ? S - M : S - L : 0;
    return {
      [f]: x[f] + A,
      data: {
        [f]: D,
        centerOffset: S - D - A,
        ...H && {
          alignmentOffset: A
        }
      },
      reset: H
    };
  }
}), Ai = function(a) {
  return a === void 0 && (a = {}), {
    name: "flip",
    options: a,
    async fn(t) {
      var e, i;
      const {
        placement: s,
        middlewareData: o,
        rects: r,
        initialPlacement: l,
        platform: h,
        elements: c
      } = t, {
        mainAxis: u = !0,
        crossAxis: d = !0,
        fallbackPlacements: x,
        fallbackStrategy: f = "bestFit",
        fallbackAxisSideDirection: m = "none",
        flipAlignment: g = !0,
        ...w
      } = rt(a, t);
      if ((e = o.arrow) != null && e.alignmentOffset)
        return {};
      const C = j(s), E = P(l), b = j(l) === l, p = await (h.isRTL == null ? void 0 : h.isRTL(c.floating)), y = x || (b || !g ? [ft(l)] : Ci(l)), R = m !== "none";
      !x && R && y.push(..._i(l, g, m, p));
      const _ = [l, ...y], T = await h.detectOverflow(t, w), v = [];
      let I = ((i = o.flip) == null ? void 0 : i.overflows) || [];
      if (u && v.push(T[C]), d) {
        const S = bi(s, r, p);
        v.push(T[S[0]], T[S[1]]);
      }
      if (I = [...I, {
        placement: s,
        overflows: v
      }], !v.every((S) => S <= 0)) {
        var O, M;
        const S = (((O = o.flip) == null ? void 0 : O.index) || 0) + 1, D = _[S];
        if (D && (!(d === "alignment" && E !== P(D)) || // We leave the current main axis only if every placement on that axis
        // overflows the main axis.
        I.every((A) => P(A.placement) === E ? A.overflows[0] > 0 : !0)))
          return {
            data: {
              index: S,
              overflows: I
            },
            reset: {
              placement: D
            }
          };
        let H = (M = I.filter((A) => A.overflows[0] <= 0).sort((A, k) => A.overflows[1] - k.overflows[1])[0]) == null ? void 0 : M.placement;
        if (!H)
          switch (f) {
            case "bestFit": {
              var L;
              const A = (L = I.filter((k) => {
                if (R) {
                  const N = P(k.placement);
                  return N === E || // Create a bias to the `y` side axis due to horizontal
                  // reading directions favoring greater width.
                  N === "y";
                }
                return !0;
              }).map((k) => [k.placement, k.overflows.filter((N) => N > 0).reduce((N, vt) => N + vt, 0)]).sort((k, N) => k[1] - N[1])[0]) == null ? void 0 : L[0];
              A && (H = A);
              break;
            }
            case "initialPlacement":
              H = l;
              break;
          }
        if (s !== H)
          return {
            reset: {
              placement: H
            }
          };
      }
      return {};
    }
  };
}, Di = /* @__PURE__ */ new Set(["left", "top"]);
async function Hi(a, t) {
  const {
    placement: e,
    platform: i,
    elements: s
  } = a, o = await (i.isRTL == null ? void 0 : i.isRTL(s.floating)), r = j(e), l = nt(e), h = P(e) === "y", c = Di.has(r) ? -1 : 1, u = o && h ? -1 : 1, d = rt(t, a);
  let {
    mainAxis: x,
    crossAxis: f,
    alignmentAxis: m
  } = typeof d == "number" ? {
    mainAxis: d,
    crossAxis: 0,
    alignmentAxis: null
  } : {
    mainAxis: d.mainAxis || 0,
    crossAxis: d.crossAxis || 0,
    alignmentAxis: d.alignmentAxis
  };
  return l && typeof m == "number" && (f = l === "end" ? m * -1 : m), h ? {
    x: f * u,
    y: x * c
  } : {
    x: x * c,
    y: f * u
  };
}
const Ni = function(a) {
  return a === void 0 && (a = 0), {
    name: "offset",
    options: a,
    async fn(t) {
      var e, i;
      const {
        x: s,
        y: o,
        placement: r,
        middlewareData: l
      } = t, h = await Hi(t, a);
      return r === ((e = l.offset) == null ? void 0 : e.placement) && (i = l.arrow) != null && i.alignmentOffset ? {} : {
        x: s + h.x,
        y: o + h.y,
        data: {
          ...h,
          placement: r
        }
      };
    }
  };
}, ki = function(a) {
  return a === void 0 && (a = {}), {
    name: "shift",
    options: a,
    async fn(t) {
      const {
        x: e,
        y: i,
        placement: s,
        platform: o
      } = t, {
        mainAxis: r = !0,
        crossAxis: l = !1,
        limiter: h = {
          fn: (C) => {
            let {
              x: E,
              y: b
            } = C;
            return {
              x: E,
              y: b
            };
          }
        },
        ...c
      } = rt(a, t), u = {
        x: e,
        y: i
      }, d = await o.detectOverflow(t, c), x = P(j(s)), f = fe(x);
      let m = u[f], g = u[x];
      if (r) {
        const C = f === "y" ? "top" : "left", E = f === "y" ? "bottom" : "right", b = m + d[C], p = m - d[E];
        m = Tt(b, m, p);
      }
      if (l) {
        const C = x === "y" ? "top" : "left", E = x === "y" ? "bottom" : "right", b = g + d[C], p = g - d[E];
        g = Tt(b, g, p);
      }
      const w = h.fn({
        ...t,
        [f]: m,
        [x]: g
      });
      return {
        ...w,
        data: {
          x: w.x - e,
          y: w.y - i,
          enabled: {
            [f]: r,
            [x]: l
          }
        }
      };
    }
  };
};
function Et() {
  return typeof window < "u";
}
function et(a) {
  return me(a) ? (a.nodeName || "").toLowerCase() : "#document";
}
function K(a) {
  var t;
  return (a == null || (t = a.ownerDocument) == null ? void 0 : t.defaultView) || window;
}
function W(a) {
  var t;
  return (t = (me(a) ? a.ownerDocument : a.document) || window.document) == null ? void 0 : t.documentElement;
}
function me(a) {
  return Et() ? a instanceof Node || a instanceof K(a).Node : !1;
}
function F(a) {
  return Et() ? a instanceof Element || a instanceof K(a).Element : !1;
}
function z(a) {
  return Et() ? a instanceof HTMLElement || a instanceof K(a).HTMLElement : !1;
}
function Qt(a) {
  return !Et() || typeof ShadowRoot > "u" ? !1 : a instanceof ShadowRoot || a instanceof K(a).ShadowRoot;
}
function lt(a) {
  const {
    overflow: t,
    overflowX: e,
    overflowY: i,
    display: s
  } = X(a);
  return /auto|scroll|overlay|hidden|clip/.test(t + i + e) && s !== "inline" && s !== "contents";
}
function Bi(a) {
  return /^(table|td|th)$/.test(et(a));
}
function yt(a) {
  try {
    if (a.matches(":popover-open"))
      return !0;
  } catch {
  }
  try {
    return a.matches(":modal");
  } catch {
    return !1;
  }
}
const Ki = /transform|translate|scale|rotate|perspective|filter/, Fi = /paint|layout|strict|content/, $ = (a) => !!a && a !== "none";
let Rt;
function Bt(a) {
  const t = F(a) ? X(a) : a;
  return $(t.transform) || $(t.translate) || $(t.scale) || $(t.rotate) || $(t.perspective) || !Kt() && ($(t.backdropFilter) || $(t.filter)) || Ki.test(t.willChange || "") || Fi.test(t.contain || "");
}
function Xi(a) {
  let t = G(a);
  for (; z(t) && !tt(t); ) {
    if (Bt(t))
      return t;
    if (yt(t))
      return null;
    t = G(t);
  }
  return null;
}
function Kt() {
  return Rt == null && (Rt = typeof CSS < "u" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none")), Rt;
}
function tt(a) {
  return /^(html|body|#document)$/.test(et(a));
}
function X(a) {
  return K(a).getComputedStyle(a);
}
function bt(a) {
  return F(a) ? {
    scrollLeft: a.scrollLeft,
    scrollTop: a.scrollTop
  } : {
    scrollLeft: a.scrollX,
    scrollTop: a.scrollY
  };
}
function G(a) {
  if (et(a) === "html")
    return a;
  const t = (
    // Step into the shadow DOM of the parent of a slotted node.
    a.assignedSlot || // DOM Element detected.
    a.parentNode || // ShadowRoot detected.
    Qt(a) && a.host || // Fallback.
    W(a)
  );
  return Qt(t) ? t.host : t;
}
function we(a) {
  const t = G(a);
  return tt(t) ? a.ownerDocument ? a.ownerDocument.body : a.body : z(t) && lt(t) ? t : we(t);
}
function st(a, t, e) {
  var i;
  t === void 0 && (t = []), e === void 0 && (e = !0);
  const s = we(a), o = s === ((i = a.ownerDocument) == null ? void 0 : i.body), r = K(s);
  if (o) {
    const l = St(r);
    return t.concat(r, r.visualViewport || [], lt(s) ? s : [], l && e ? st(l) : []);
  } else
    return t.concat(s, st(s, [], e));
}
function St(a) {
  return a.parent && Object.getPrototypeOf(a.parent) ? a.frameElement : null;
}
function pe(a) {
  const t = X(a);
  let e = parseFloat(t.width) || 0, i = parseFloat(t.height) || 0;
  const s = z(a), o = s ? a.offsetWidth : e, r = s ? a.offsetHeight : i, l = xt(e) !== o || xt(i) !== r;
  return l && (e = o, i = r), {
    width: e,
    height: i,
    $: l
  };
}
function Ft(a) {
  return F(a) ? a : a.contextElement;
}
function J(a) {
  const t = Ft(a);
  if (!z(t))
    return Y(1);
  const e = t.getBoundingClientRect(), {
    width: i,
    height: s,
    $: o
  } = pe(t);
  let r = (o ? xt(e.width) : e.width) / i, l = (o ? xt(e.height) : e.height) / s;
  return (!r || !Number.isFinite(r)) && (r = 1), (!l || !Number.isFinite(l)) && (l = 1), {
    x: r,
    y: l
  };
}
const Yi = /* @__PURE__ */ Y(0);
function Ee(a) {
  const t = K(a);
  return !Kt() || !t.visualViewport ? Yi : {
    x: t.visualViewport.offsetLeft,
    y: t.visualViewport.offsetTop
  };
}
function Wi(a, t, e) {
  return t === void 0 && (t = !1), !e || t && e !== K(a) ? !1 : t;
}
function q(a, t, e, i) {
  t === void 0 && (t = !1), e === void 0 && (e = !1);
  const s = a.getBoundingClientRect(), o = Ft(a);
  let r = Y(1);
  t && (i ? F(i) && (r = J(i)) : r = J(a));
  const l = Wi(o, e, i) ? Ee(o) : Y(0);
  let h = (s.left + l.x) / r.x, c = (s.top + l.y) / r.y, u = s.width / r.x, d = s.height / r.y;
  if (o) {
    const x = K(o), f = i && F(i) ? K(i) : i;
    let m = x, g = St(m);
    for (; g && i && f !== m; ) {
      const w = J(g), C = g.getBoundingClientRect(), E = X(g), b = C.left + (g.clientLeft + parseFloat(E.paddingLeft)) * w.x, p = C.top + (g.clientTop + parseFloat(E.paddingTop)) * w.y;
      h *= w.x, c *= w.y, u *= w.x, d *= w.y, h += b, c += p, m = K(g), g = St(m);
    }
  }
  return gt({
    width: u,
    height: d,
    x: h,
    y: c
  });
}
function Ct(a, t) {
  const e = bt(a).scrollLeft;
  return t ? t.left + e : q(W(a)).left + e;
}
function ye(a, t) {
  const e = a.getBoundingClientRect(), i = e.left + t.scrollLeft - Ct(a, e), s = e.top + t.scrollTop;
  return {
    x: i,
    y: s
  };
}
function Vi(a) {
  let {
    elements: t,
    rect: e,
    offsetParent: i,
    strategy: s
  } = a;
  const o = s === "fixed", r = W(i), l = t ? yt(t.floating) : !1;
  if (i === r || l && o)
    return e;
  let h = {
    scrollLeft: 0,
    scrollTop: 0
  }, c = Y(1);
  const u = Y(0), d = z(i);
  if ((d || !d && !o) && ((et(i) !== "body" || lt(r)) && (h = bt(i)), d)) {
    const f = q(i);
    c = J(i), u.x = f.x + i.clientLeft, u.y = f.y + i.clientTop;
  }
  const x = r && !d && !o ? ye(r, h) : Y(0);
  return {
    width: e.width * c.x,
    height: e.height * c.y,
    x: e.x * c.x - h.scrollLeft * c.x + u.x + x.x,
    y: e.y * c.y - h.scrollTop * c.y + u.y + x.y
  };
}
function zi(a) {
  return Array.from(a.getClientRects());
}
function Pi(a) {
  const t = W(a), e = bt(a), i = a.ownerDocument.body, s = U(t.scrollWidth, t.clientWidth, i.scrollWidth, i.clientWidth), o = U(t.scrollHeight, t.clientHeight, i.scrollHeight, i.clientHeight);
  let r = -e.scrollLeft + Ct(a);
  const l = -e.scrollTop;
  return X(i).direction === "rtl" && (r += U(t.clientWidth, i.clientWidth) - s), {
    width: s,
    height: o,
    x: r,
    y: l
  };
}
const te = 25;
function Gi(a, t) {
  const e = K(a), i = W(a), s = e.visualViewport;
  let o = i.clientWidth, r = i.clientHeight, l = 0, h = 0;
  if (s) {
    o = s.width, r = s.height;
    const u = Kt();
    (!u || u && t === "fixed") && (l = s.offsetLeft, h = s.offsetTop);
  }
  const c = Ct(i);
  if (c <= 0) {
    const u = i.ownerDocument, d = u.body, x = getComputedStyle(d), f = u.compatMode === "CSS1Compat" && parseFloat(x.marginLeft) + parseFloat(x.marginRight) || 0, m = Math.abs(i.clientWidth - d.clientWidth - f);
    m <= te && (o -= m);
  } else c <= te && (o += c);
  return {
    width: o,
    height: r,
    x: l,
    y: h
  };
}
function $i(a, t) {
  const e = q(a, !0, t === "fixed"), i = e.top + a.clientTop, s = e.left + a.clientLeft, o = z(a) ? J(a) : Y(1), r = a.clientWidth * o.x, l = a.clientHeight * o.y, h = s * o.x, c = i * o.y;
  return {
    width: r,
    height: l,
    x: h,
    y: c
  };
}
function ee(a, t, e) {
  let i;
  if (t === "viewport")
    i = Gi(a, e);
  else if (t === "document")
    i = Pi(W(a));
  else if (F(t))
    i = $i(t, e);
  else {
    const s = Ee(a);
    i = {
      x: t.x - s.x,
      y: t.y - s.y,
      width: t.width,
      height: t.height
    };
  }
  return gt(i);
}
function be(a, t) {
  const e = G(a);
  return e === t || !F(e) || tt(e) ? !1 : X(e).position === "fixed" || be(e, t);
}
function Ui(a, t) {
  const e = t.get(a);
  if (e)
    return e;
  let i = st(a, [], !1).filter((l) => F(l) && et(l) !== "body"), s = null;
  const o = X(a).position === "fixed";
  let r = o ? G(a) : a;
  for (; F(r) && !tt(r); ) {
    const l = X(r), h = Bt(r);
    !h && l.position === "fixed" && (s = null), (o ? !h && !s : !h && l.position === "static" && s && (s.position === "absolute" || s.position === "fixed") || lt(r) && !h && be(a, r)) ? i = i.filter((c) => c !== r) : s = l, r = G(r);
  }
  return t.set(a, i), i;
}
function ji(a) {
  let {
    element: t,
    boundary: e,
    rootBoundary: i,
    strategy: s
  } = a;
  const o = [...e === "clippingAncestors" ? yt(t) ? [] : Ui(t, this._c) : [].concat(e), i], r = ee(t, o[0], s);
  let l = r.top, h = r.right, c = r.bottom, u = r.left;
  for (let d = 1; d < o.length; d++) {
    const x = ee(t, o[d], s);
    l = U(x.top, l), h = Q(x.right, h), c = Q(x.bottom, c), u = U(x.left, u);
  }
  return {
    width: h - u,
    height: c - l,
    x: u,
    y: l
  };
}
function qi(a) {
  const {
    width: t,
    height: e
  } = pe(a);
  return {
    width: t,
    height: e
  };
}
function Zi(a, t, e) {
  const i = z(t), s = W(t), o = e === "fixed", r = q(a, !0, o, t);
  let l = {
    scrollLeft: 0,
    scrollTop: 0
  };
  const h = Y(0);
  function c() {
    h.x = Ct(s);
  }
  if (i || !i && !o)
    if ((et(t) !== "body" || lt(s)) && (l = bt(t)), i) {
      const f = q(t, !0, o, t);
      h.x = f.x + t.clientLeft, h.y = f.y + t.clientTop;
    } else s && c();
  o && !i && s && c();
  const u = s && !i && !o ? ye(s, l) : Y(0), d = r.left + l.scrollLeft - h.x - u.x, x = r.top + l.scrollTop - h.y - u.y;
  return {
    x: d,
    y: x,
    width: r.width,
    height: r.height
  };
}
function It(a) {
  return X(a).position === "static";
}
function ie(a, t) {
  if (!z(a) || X(a).position === "fixed")
    return null;
  if (t)
    return t(a);
  let e = a.offsetParent;
  return W(a) === e && (e = e.ownerDocument.body), e;
}
function Ce(a, t) {
  const e = K(a);
  if (yt(a))
    return e;
  if (!z(a)) {
    let s = G(a);
    for (; s && !tt(s); ) {
      if (F(s) && !It(s))
        return s;
      s = G(s);
    }
    return e;
  }
  let i = ie(a, t);
  for (; i && Bi(i) && It(i); )
    i = ie(i, t);
  return i && tt(i) && It(i) && !Bt(i) ? e : i || Xi(a) || e;
}
const Ji = async function(a) {
  const t = this.getOffsetParent || Ce, e = this.getDimensions, i = await e(a.floating);
  return {
    reference: Zi(a.reference, await t(a.floating), a.strategy),
    floating: {
      x: 0,
      y: 0,
      width: i.width,
      height: i.height
    }
  };
};
function Qi(a) {
  return X(a).direction === "rtl";
}
const ts = {
  convertOffsetParentRelativeRectToViewportRelativeRect: Vi,
  getDocumentElement: W,
  getClippingRect: ji,
  getOffsetParent: Ce,
  getElementRects: Ji,
  getClientRects: zi,
  getDimensions: qi,
  getScale: J,
  isElement: F,
  isRTL: Qi
};
function ve(a, t) {
  return a.x === t.x && a.y === t.y && a.width === t.width && a.height === t.height;
}
function es(a, t) {
  let e = null, i;
  const s = W(a);
  function o() {
    var l;
    clearTimeout(i), (l = e) == null || l.disconnect(), e = null;
  }
  function r(l, h) {
    l === void 0 && (l = !1), h === void 0 && (h = 1), o();
    const c = a.getBoundingClientRect(), {
      left: u,
      top: d,
      width: x,
      height: f
    } = c;
    if (l || t(), !x || !f)
      return;
    const m = ht(d), g = ht(s.clientWidth - (u + x)), w = ht(s.clientHeight - (d + f)), C = ht(u), E = {
      rootMargin: -m + "px " + -g + "px " + -w + "px " + -C + "px",
      threshold: U(0, Q(1, h)) || 1
    };
    let b = !0;
    function p(y) {
      const R = y[0].intersectionRatio;
      if (R !== h) {
        if (!b)
          return r();
        R ? r(!1, R) : i = setTimeout(() => {
          r(!1, 1e-7);
        }, 1e3);
      }
      R === 1 && !ve(c, a.getBoundingClientRect()) && r(), b = !1;
    }
    try {
      e = new IntersectionObserver(p, {
        ...E,
        // Handle <iframe>s
        root: s.ownerDocument
      });
    } catch {
      e = new IntersectionObserver(p, E);
    }
    e.observe(a);
  }
  return r(!0), o;
}
function Lt(a, t, e, i) {
  i === void 0 && (i = {});
  const {
    ancestorScroll: s = !0,
    ancestorResize: o = !0,
    elementResize: r = typeof ResizeObserver == "function",
    layoutShift: l = typeof IntersectionObserver == "function",
    animationFrame: h = !1
  } = i, c = Ft(a), u = s || o ? [...c ? st(c) : [], ...t ? st(t) : []] : [];
  u.forEach((C) => {
    s && C.addEventListener("scroll", e, {
      passive: !0
    }), o && C.addEventListener("resize", e);
  });
  const d = c && l ? es(c, e) : null;
  let x = -1, f = null;
  r && (f = new ResizeObserver((C) => {
    let [E] = C;
    E && E.target === c && f && t && (f.unobserve(t), cancelAnimationFrame(x), x = requestAnimationFrame(() => {
      var b;
      (b = f) == null || b.observe(t);
    })), e();
  }), c && !h && f.observe(c), t && f.observe(t));
  let m, g = h ? q(a) : null;
  h && w();
  function w() {
    const C = q(a);
    g && !ve(g, C) && e(), g = C, m = requestAnimationFrame(w);
  }
  return e(), () => {
    var C;
    u.forEach((E) => {
      s && E.removeEventListener("scroll", e), o && E.removeEventListener("resize", e);
    }), d?.(), (C = f) == null || C.disconnect(), f = null, h && cancelAnimationFrame(m);
  };
}
const mt = Ni, wt = ki, Xt = Ai, is = Mi, pt = (a, t, e) => {
  const i = /* @__PURE__ */ new Map(), s = {
    platform: ts,
    ...e
  }, o = {
    ...s.platform,
    _c: i
  };
  return Li(a, t, {
    ...s,
    platform: o
  });
};
let ss = class {
  constructor(a) {
    n(this, "ctx"), n(this, "enable", !1), n(this, "contentEl"), n(this, "floatingEl"), n(this, "arrowEl"), this.ctx = a;
    const { TOOLTIP_BG_COLOR: t, TOOLTIP_TEXT_COLOR: e, TOOLTIP_ZINDEX: i, TOOLTIP_CUSTOM_STYLE: s, CSS_PREFIX: o } = this.ctx.config;
    this.contentEl = document.createElement("div"), this.arrowEl = document.createElement("div"), this.floatingEl = document.createElement("div"), this.floatingEl.className = `${o}-tooltip`, this.contentEl.className = `${o}-tooltip-content`, this.arrowEl.className = `${o}-tooltip-arrow`;
    const r = {
      display: "none",
      position: "absolute",
      background: t,
      color: e,
      boxSizing: "border-box",
      zIndex: i,
      padding: "8px",
      borderRadius: "4px",
      fontSize: "12px",
      ...s
    }, l = {
      position: "absolute",
      width: "10px",
      height: "10px",
      background: r.background,
      backgroundColor: r.backgroundColor,
      transform: "rotate(45deg)",
      zIndex: r.zIndex
    };
    Object.assign(this.arrowEl.style, l), Object.assign(this.floatingEl.style, r), this.floatingEl.appendChild(this.contentEl), this.floatingEl.appendChild(this.arrowEl), this.ctx.containerElement.appendChild(this.floatingEl), this.init();
  }
  init() {
    this.floatingEl.addEventListener("mouseleave", () => {
      this.hide();
    }), this.ctx.on("mouseout", (a) => {
      this.floatingEl.contains(a.relatedTarget) || this.hide();
    }), this.ctx.on("onScroll", () => {
      this.hide();
    }), this.ctx.on("startEdit", () => {
      this.hide();
    }), this.ctx.on("visibleCellHoverChange", (a, t) => {
      this.floatingEl.contains(t.target) || (a.ellipsis || a.message) && this.show(a);
    }), this.ctx.on("visibleCellMouseleave", (a, t) => {
      this.floatingEl.contains(t.target) || this.hide();
    }), this.ctx.on("cellHeaderMouseleave", (a, t) => {
      this.floatingEl.contains(t.target) || this.hide();
    }), this.ctx.on("cellHeaderHoverChange", (a, t) => {
      this.floatingEl.contains(t.target) || a.ellipsis && this.show(a);
    }), this.ctx.on("cellFooterMouseleave", (a, t) => {
      this.floatingEl.contains(t.target) || this.hide();
    }), this.ctx.on("cellFooterHoverChange", (a, t) => {
      this.floatingEl.contains(t.target) || a.ellipsis && this.show(a);
    }), this.ctx.on("cellShowTooltip", (a, t) => {
      this.show(a, t);
    }), this.ctx.on("cellHideTooltip", () => {
      this.hide();
    });
  }
  show(a, t) {
    if (this.ctx.contextMenuIng || !a.overflowTooltipShow || this.ctx.mousedown)
      return;
    this.floatingEl.style.display = "block";
    let e = a.getText();
    a.message && (e = a.message), t && (e = t);
    const i = this.ctx.containerElement.getBoundingClientRect();
    if (!i)
      return;
    this.enable = !0, this.contentEl.style.maxWidth = `${a.overflowTooltipMaxWidth || 500}px`, this.contentEl.style.minWidth = "100px", this.contentEl.style.width = "100%", this.contentEl.style.display = "inline-block", this.contentEl.style.wordBreak = "break-all", this.contentEl.style.lineHeight = "1.5", this.contentEl.innerText = e;
    const s = a.drawX + i.x, o = a.drawY + i.y;
    pt({
      getBoundingClientRect() {
        return {
          width: a.visibleWidth,
          height: a.visibleHeight,
          x: s,
          y: o,
          left: s,
          right: s + a.visibleWidth,
          top: o,
          bottom: o + a.visibleHeight
        };
      }
    }, this.floatingEl, {
      placement: a.overflowTooltipPlacement,
      middleware: [wt(), Xt(), mt(6), is({ element: this.arrowEl })]
    }).then((r) => {
      const { x: l, y: h, placement: c, middlewareData: u } = r;
      if (Object.assign(this.floatingEl.style, {
        top: `${h}px`,
        left: `${l}px`
      }), u.arrow) {
        const d = u.arrow;
        ["left", "left-start", "left-end"].includes(c) ? Object.assign(this.arrowEl.style, {
          top: `${d.y}px`,
          bottom: "",
          left: "",
          right: "-5px"
        }) : ["right", "right-start", "right-end"].includes(c) ? Object.assign(this.arrowEl.style, {
          top: `${d.y}px`,
          bottom: "",
          left: "-5px",
          right: ""
        }) : ["bottom", "bottom-start", "bottom-end"].includes(c) ? Object.assign(this.arrowEl.style, {
          top: "-5px",
          bottom: "",
          left: `${d.x}px`,
          right: ""
        }) : ["top", "top-start", "top-end"].includes(c) && Object.assign(this.arrowEl.style, {
          top: "",
          bottom: "-5px",
          left: `${d.x}px`,
          right: ""
        });
      }
    });
  }
  hide() {
    this.enable && (this.enable = !1, this.floatingEl.style.display = "none");
  }
  destroy() {
    this.contentEl.remove(), this.arrowEl.remove(), this.floatingEl.remove();
  }
};
class os {
  constructor(t) {
    n(this, "editorEl"), n(this, "inputEl"), n(this, "enable", !1), n(this, "cellTarget", null), n(this, "selectorArrStr", ""), n(this, "ctx"), n(this, "drawY", 0), n(this, "drawX", 0), n(this, "cancel", !1), this.ctx = t, this.initTextEditor(), this.init();
  }
  init() {
    this.ctx.on("outsideMousedown", () => {
      this.cellTarget && this.cellTarget.editorType === "text" && this.clearEditor();
    }), this.ctx.on("moveFocus", (t) => {
      this.cellTarget = t, this.resetEditorStyle();
      const { xArr: e, yArr: i } = this.ctx.selector;
      this.selectorArrStr = JSON.stringify(e) + JSON.stringify(i), this.focusInput();
    }), this.ctx.on("onScroll", () => {
      this.enable && this.doneEdit();
    }), this.ctx.on("hoverIconClick", (t) => {
      this.editCell(t.rowIndex, t.colIndex);
    }), this.ctx.on("keydown", (t) => {
      if (!this.ctx.isTarget(t) || !this.ctx.focusCell || this.ctx.finding)
        return;
      const { focusCell: e } = this.ctx;
      if (t.code === "Escape" && this.ctx.editing) {
        this.cancel = !0;
        const { focusCell: h } = this.ctx;
        h && (this.ctx.emit("setSelectorCell", h), this.cellTarget = h), this.doneEdit();
        return;
      }
      if ((t.altKey || t.metaKey) && t.key === "Enter" && this.ctx.editing && this.inputEl) {
        t.preventDefault();
        const h = this.inputEl.selectionStart, c = this.inputEl.value.substring(0, h), u = this.inputEl.value.substring(h);
        this.inputEl.value = c + `
` + u, this.inputEl.selectionStart = this.inputEl.selectionEnd = h + 1, this.autoSize();
        return;
      }
      if (t.code === "Tab" && this.ctx.editing) {
        if (t.preventDefault(), this.doneEdit(), t.shiftKey) {
          this.ctx.emit("setMoveFocus", "LEFT");
          return;
        }
        this.ctx.emit("setMoveFocus", "RIGHT");
        return;
      }
      if (t.key === "Enter" && this.ctx.editing) {
        if (t.preventDefault(), this.doneEdit(), t.shiftKey) {
          this.ctx.emit("setMoveFocus", "TOP");
          return;
        }
        this.ctx.emit("setMoveFocus", "BOTTOM");
        return;
      }
      if (t.key === "Enter" && !this.ctx.editing) {
        t.preventDefault(), this.startEdit();
        return;
      }
      const i = t.key, s = t.ctrlKey, o = t.altKey, r = t.shiftKey, l = t.metaKey;
      if (!(s || o || r || l || [
        "Enter",
        "CapsLock",
        "Escape",
        "Tab",
        "Backspace",
        "Delete",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Insert",
        "F1",
        "F2",
        "F3",
        "F4",
        "F5",
        "F6",
        "F7",
        "F8",
        "F9",
        "F10",
        "F11",
        "F12"
      ].includes(i))) {
        if (document.activeElement !== this.inputEl && e.editorType === "text") {
          t.preventDefault();
          return;
        }
        this.startEdit(!0);
      }
    }), this.ctx.on("cellClick", (t) => {
      if (this.ctx.stageElement.style.cursor === "pointer" || !this.isInSelectorRange(t.rowIndex, t.colIndex))
        return;
      const { xArr: e, yArr: i } = this.ctx.selector, s = JSON.stringify(e) + JSON.stringify(i);
      if (this.focusInput(), this.selectorArrStr === s && this.cellTarget) {
        if (this.ctx.config.ENABLE_MERGE_CELL_LINK && this.ctx.onlyMergeCell) {
          this.startEdit();
          return;
        }
        if (this.ctx.selectOnlyOne && t.rowKey === this.cellTarget.rowKey && t.key === this.cellTarget.key) {
          this.startEdit();
          return;
        }
      }
      if (this.selectorArrStr = s, this.doneEdit(), this.cellTarget = t, this.resetEditorStyle(), this.ctx.config.ENABLE_EDIT_SINGLE_CLICK) {
        if (this.ctx.config.ENABLE_MERGE_CELL_LINK && this.ctx.onlyMergeCell) {
          this.startEdit();
          return;
        }
        this.ctx.selectOnlyOne && this.startEdit();
      }
    });
  }
  isTextSelectionActive() {
    return this.ctx.config.ENABLE_TEXT_SELECTION && (this.ctx.textSelecting || !!this.ctx.textSelectionStr);
  }
  isInSelectorRange(t, e) {
    const { xArr: i, yArr: s } = this.ctx.selector, [o, r] = i, [l, h] = s;
    return !(e < o || e > r || t < l || t > h);
  }
  initTextEditor() {
    this.inputEl = document.createElement("textarea"), this.inputEl.id = "e-virt-table-editor-textarea", this.inputEl.setAttribute("rows", "1"), this.inputEl.setAttribute("tabindex", "-1"), this.inputEl.addEventListener("input", this.autoSize.bind(this)), this.editorEl = this.ctx.editorElement, this.inputEl.className = "e-virt-table-editor-textarea", this.editorEl.appendChild(this.inputEl), this.ctx.containerElement.appendChild(this.editorEl);
  }
  autoSize() {
    if (!this.ctx.editing)
      return;
    const t = this.inputEl.value;
    if (this.cellTarget && this.cellTarget.type === "number" && t !== "" && (this.ctx.emit("cellHideTooltip"), !/^-?\d+(\.\d+)?$/.test(t))) {
      const h = this.ctx.locale.getText("numberErrorTip");
      this.ctx.emit("cellShowTooltip", this.cellTarget, h);
    }
    this.inputEl.style.height = "auto";
    let e = this.inputEl.scrollHeight, i = this.ctx.body.visibleHeight;
    e > i && (e = i);
    const {
      stageHeight: s,
      footer: o,
      header: r
    } = this.ctx, l = s - o.height - B(this.ctx.config);
    this.editorEl.style.bottom = "auto", this.drawY < r.height && (this.editorEl.style.top = `${r.height - 1}px`), this.drawY + e > l && (this.editorEl.style.left = `${this.drawX - 1}px`, this.editorEl.style.top = "auto", this.editorEl.style.bottom = `${s - l}px`), this.inputEl.style.height = `${e}px`;
  }
  startEditByInput(t, e = !1) {
    const i = e ? null : t.getValue(), { editorType: s } = t;
    if (s === "none")
      return;
    t.update(), this.ctx.config.ENABLE_MERGE_CELL_LINK && t.updateSpanInfo();
    let { height: o, width: r, drawY: l, drawX: h } = t;
    this.drawX = h, this.drawY = l;
    const {
      config: { CELL_PADDING: c },
      header: u
    } = this.ctx;
    let d = this.ctx.body.visibleHeight;
    o > d && (o = d), this.editorEl.style.zIndex = "100", this.editorEl.style.left = `${this.drawX - 1}px`, this.editorEl.style.top = `${this.drawY}px`, this.editorEl.style.bottom = "auto", this.editorEl.style.maxWidth = "none", this.editorEl.style.border = "", this.editorEl.style.maxHeight = `${d}px`, ["text"].includes(s) ? (this.inputEl.style.opacity = "1", this.inputEl.style.position = "relative", this.inputEl.style.minWidth = `${r - 1}px`, this.inputEl.style.minHeight = `${o - 1}px`, this.inputEl.style.maxHeight = `${d}px`, this.inputEl.style.width = `${r}px`, this.inputEl.style.height = "auto", this.inputEl.style.padding = `${c}px`, this.inputEl.value = "", i !== null && (this.inputEl.value = i), (this.inputEl.scrollHeight > o || this.drawY < u.height) && this.autoSize()) : (this.inputEl.style.opacity = "0", this.inputEl.style.zIndex = "-1", this.inputEl.style.width = "1px", this.inputEl.style.height = "1px", this.inputEl.style.position = "absolute", this.inputEl.style.left = "0px", this.inputEl.style.top = "0px");
  }
  doneEditByInput() {
    if (this.cellTarget && this.cellTarget.editorType === "text") {
      const { rowKey: t, key: e } = this.cellTarget, i = this.cellTarget.getValue(), s = this.inputEl.value;
      s !== i && !(s === "" && i === null) && !this.cancel && this.ctx.setItemValueByEditor(t, e, s, !0);
    }
  }
  focusInput() {
    document.activeElement !== this.inputEl && this.inputEl.focus({ preventScroll: !0 });
  }
  startEdit(t = !1) {
    if (this.isTextSelectionActive())
      return;
    this.cancel = !1;
    const { ENABLE_EDIT_CLICK_SELECTOR: e } = this.ctx.config;
    if (!e)
      return;
    const i = this.ctx.focusCell;
    i && (i.isVerticalVisible() && i.isHorizontalVisible() || this.ctx.emit("scrollToIndex", i.rowIndex, i.colIndex), this.editCell(i.rowIndex, i.colIndex, t));
  }
  editCell(t, e, i = !1) {
    const s = this.ctx.body.renderRows.find((u) => u.rowIndex === t);
    if (!s)
      return;
    const o = s.cells.find((u) => u.colIndex === e);
    if (!o || !(o.isVerticalVisible() && o.isHorizontalVisible()))
      return;
    this.ctx.emit("setSelectorCell", o);
    const r = this.ctx.focusCell;
    if (!r || ["index", "index-selection", "selection"].includes(r.type) || this.enable)
      return;
    const { rowKey: l, key: h } = r, c = this.ctx.database.getReadonly(l, h);
    r && !c && (this.enable = !0, this.ctx.editing = !0, this.cellTarget = r, this.startEditByInput(this.cellTarget, i), this.ctx.emit("startEdit", this.cellTarget), this.ctx.emit("draw"));
  }
  doneEdit() {
    this.enable && (this.doneEditByInput(), this.ctx.emit("cellHideTooltip"), this.ctx.emit("doneEdit", this.cellTarget), this.enable = !1, this.ctx.editing = !1, this.resetEditorStyle(), setTimeout(() => {
      this.focusInput();
    }, 0), this.ctx.emit("draw"));
  }
  resetEditorStyle() {
    const t = this.cellTarget;
    t && (this.editorEl.style.left = `${t.drawX}px`, this.editorEl.style.top = `${t.drawY}px`, this.editorEl.style.maxWidth = "1px", this.editorEl.style.maxHeight = "1px", this.editorEl.style.zIndex = "-1", this.editorEl.style.border = "none");
  }
  clearEditor() {
    this.doneEdit(), this.cellTarget = null, this.selectorArrStr = "", this.ctx.clearSelector(), this.ctx.focusCell = void 0, this.inputEl.blur(), this.ctx.emit("draw");
  }
  destroy() {
    var t;
    (t = this.editorEl) == null || t.remove();
  }
}
let rs = class {
  constructor(a) {
    n(this, "ctx"), n(this, "emptyEl"), this.ctx = a;
    const { EMPTY_CUSTOM_STYLE: t } = this.ctx.config;
    this.ctx.emptyElement ? this.emptyEl = this.ctx.emptyElement : (this.emptyEl = document.createElement("div"), this.emptyEl.innerText = this.getText()), this.emptyEl.className = "e-virt-table-empty", this.emptyEl.style.display = "none", this.ctx.containerElement.appendChild(this.emptyEl), this.ctx.on("emptyChange", ({ type: e, headerHeight: i, bodyHeight: s, footerHeight: o }) => {
      const r = i + (s + o) / 2, l = {
        display: e === "empty" ? "block" : "none",
        top: `${r}px`,
        ...t
      };
      Object.assign(this.emptyEl.style, l);
    });
  }
  getText() {
    return this.ctx.config.EMPTY_TEXT || this.ctx.locale.getText("emptyText");
  }
  draw() {
    this.ctx.emptyElement || (this.emptyEl.innerText = this.getText());
  }
  destroy() {
    this.emptyEl.remove();
  }
};
class ns {
  constructor(t) {
    n(this, "ctx"), n(this, "observer"), this.ctx = t, this.init();
  }
  arerMapsEqual(t, e) {
    if (t.size !== e.size) return !1;
    for (let [i, s] of t)
      if (!e.has(i) || e.get(i) !== s) return !1;
    return !0;
  }
  init() {
    this.observer = new MutationObserver(
      At(() => {
        const t = this.ctx.overlayerElement.querySelectorAll('[data-auto-height="true"]'), e = /* @__PURE__ */ new Map();
        t.forEach((s) => {
          const o = Number(s.getAttribute("data-row-index")), r = Number(s.getAttribute("data-col-index"));
          if (isNaN(o) || isNaN(r))
            return;
          const l = s.getBoundingClientRect(), h = `${o}​_${r}`;
          e.set(h, Math.round(l.height));
        });
        const i = this.ctx.database.getOverlayerAutoHeightMap();
        if (!this.arerMapsEqual(i, e)) {
          if (this.ctx.database.setOverlayerAutoHeightMap(e), i.size === 0 && e.size === 0)
            return;
          this.ctx.emit("draw");
        }
      }, 16.67)
    ), this.observer.observe(this.ctx.overlayerElement, {
      childList: !0,
      subtree: !0,
      attributes: !0,
      characterData: !0
    }), this.ctx.overlayerElement.getAttribute("data-overlayer") === "default" && this.ctx.on("overlayerChange", (t) => {
      const e = this.ctx.overlayerElement;
      e.replaceChildren(), Object.assign(e.style, t.style), t.views.forEach((i) => {
        const s = document.createElement("div");
        s.className = i.class, Object.assign(s.style, i.style), i.views.forEach((o) => {
          const r = document.createElement("div");
          Object.assign(r.style, o.style), o.cells.forEach((l) => {
            const h = document.createElement("div");
            Object.assign(h.style, l.style), Object.keys(l.domDataset || {}).forEach((c) => {
              h.setAttribute(c, l.domDataset[c]);
            }), typeof l.render == "function" && l.render(h, l), r.appendChild(h);
          }), s.appendChild(r);
        }), e.appendChild(s);
      });
    });
  }
  draw() {
    const t = this.getContainer();
    this.ctx.emit("overlayerChange", t);
  }
  destroy() {
    this.observer && this.observer.disconnect(), this.ctx.emit("overlayerChange", {
      style: {},
      views: []
    });
  }
  getContainer() {
    const t = this.getHeader(), e = this.getBody(), i = this.getFooter();
    let s = [];
    const { FOOTER_FIXED: o, FOOTER_POSITION: r } = this.ctx.config;
    return o ? r === "top" ? s = [t, i, e] : s = [t, e, i] : s = [t, e], {
      views: s
    };
  }
  getHeader() {
    const {
      fixedLeftWidth: t,
      fixedRightWidth: e,
      config: { CSS_PREFIX: i }
    } = this.ctx, s = B(this.ctx.config), { visibleWidth: o, visibleHeight: r, renderCellHeaders: l } = this.ctx.header;
    let h = [], c = [], u = [];
    l.forEach((g) => {
      g.render && (g.fixed === "left" ? c.push(g) : g.fixed === "right" ? u.push(g) : h.push(g));
    });
    const d = e - s, x = {
      key: "left",
      style: {
        position: "absolute",
        top: "0px",
        left: "0px",
        overflow: "hidden",
        width: `${t}px`,
        height: `${r}px`
      },
      cells: c
    }, f = {
      key: "center",
      style: {
        position: "absolute",
        top: "0px",
        left: `${t}px`,
        overflow: "hidden",
        width: `${o - t - d + 1}px`,
        height: `${r}px`
      },
      cells: h
    }, m = {
      key: "right",
      style: {
        position: "absolute",
        top: "0px",
        right: "0px",
        overflow: "hidden",
        width: `${d + 1}px`,
        height: `${r}px`
      },
      cells: u
    };
    return {
      type: "header",
      class: `${i}-overlayer-header`,
      style: {
        position: "relative",
        overflow: "hidden",
        width: `${o}px`,
        height: `${r}px`
      },
      views: [x, f, m]
    };
  }
  getBody() {
    const t = [], e = [], i = [];
    let s = this.ctx.body.renderRows;
    this.ctx.config.FOOTER_FIXED || (s = s.concat(this.ctx.footer.renderRows)), s.forEach((g) => {
      g.cells.forEach((w) => {
        w.cellType === "footer" && (w.render = w.renderFooter), w.render && (w.fixed === "left" ? e.push(w) : w.fixed === "right" ? i.push(w) : t.push(w));
      });
    });
    const {
      fixedLeftWidth: o,
      fixedRightWidth: r,
      config: { CSS_PREFIX: l }
    } = this.ctx, h = B(this.ctx.config), { visibleWidth: c, visibleHeight: u } = this.ctx.body, d = r - h, x = {
      key: "left",
      style: {
        position: "absolute",
        top: `${0.5}px`,
        left: `${0.5}px`,
        overflow: "hidden",
        width: `${o}px`,
        height: `${u}px`
      },
      cells: e
    }, f = {
      key: "center",
      style: {
        position: "absolute",
        top: `${0.5}px`,
        left: `${o - 0.5}px`,
        overflow: "hidden",
        width: `${c - o - d}px`,
        height: `${u}px`
      },
      cells: t
    }, m = {
      key: "right",
      style: {
        position: "absolute",
        top: "0px",
        right: "0px",
        overflow: "hidden",
        width: `${d}px`,
        height: `${u}px`
      },
      cells: i
    };
    return {
      type: "body",
      class: `${l}-overlayer-body`,
      style: {
        position: "relative",
        overflow: "hidden",
        width: `${c}px`,
        height: `${u}px`
      },
      views: [x, f, m]
    };
  }
  getFooter() {
    const t = [], e = [], i = [];
    this.ctx.footer.renderRows.forEach((m) => {
      m.cells.forEach((g) => {
        g.cellType === "footer" && g.renderFooter && (g.render = g.renderFooter, g.fixed === "left" ? e.push(g) : g.fixed === "right" ? i.push(g) : t.push(g));
      });
    });
    const {
      fixedLeftWidth: s,
      fixedRightWidth: o,
      config: { CSS_PREFIX: r }
    } = this.ctx, l = B(this.ctx.config), { visibleWidth: h, visibleHeight: c } = this.ctx.footer, u = o - l, d = {
      key: "left",
      style: {
        position: "absolute",
        top: `${0.5}px`,
        left: `${0.5}px`,
        overflow: "hidden",
        width: `${s}px`,
        height: `${c}px`
      },
      cells: e
    }, x = {
      key: "center",
      style: {
        position: "absolute",
        top: `${0.5}px`,
        left: `${s - 0.5}px`,
        overflow: "hidden",
        width: `${h - s - u}px`,
        height: `${c}px`
      },
      cells: t
    }, f = {
      key: "right",
      style: {
        position: "absolute",
        top: `${0.5}px`,
        right: `${0.5}px`,
        overflow: "hidden",
        width: `${u}px`,
        height: `${c}px`
      },
      cells: i
    };
    return {
      type: "footer",
      class: `${r}-overlayer-footer`,
      style: {
        position: "relative",
        overflow: "hidden",
        width: `${h}px`,
        height: `${c}px`
      },
      views: [d, x, f]
    };
  }
}
class se {
  constructor(t, e = [], i = {}) {
    n(this, "container"), n(this, "menuData"), n(this, "onClick"), n(this, "activeSubmenus", /* @__PURE__ */ new Set()), n(this, "boundMouseEnterHandler"), n(this, "boundMouseLeaveHandler"), n(this, "boundClickHandler"), this.container = t, this.menuData = e, this.onClick = i.onClick, this.boundMouseEnterHandler = (s) => this.handleMouseEvent(s, "enter"), this.boundMouseLeaveHandler = (s) => this.handleMouseEvent(s, "leave"), this.boundClickHandler = (s) => this.handleClick(s), this.createMenu(), this.bindEvents();
  }
  createMenu() {
    this.container.className = "e-virt-table-main-menu", this.container.style.display = "block";
    const t = document.createDocumentFragment();
    this.menuData.forEach((e) => {
      t.appendChild(this.createMenuItem(e));
    }), this.container.appendChild(t);
  }
  createMenuItem(t, e = !1) {
    var i;
    const s = this.createElement(
      "div",
      e ? "e-virt-table-submenu-item" : "e-virt-table-menu-item"
    );
    s.setAttribute(e ? "data-submenu" : "data-menu", t.value), t.disabled && s.classList.add("disabled");
    const o = this.createElement("div", "e-virt-table-menu-item-content");
    if (t.icon) {
      const l = this.createElement("span", "e-virt-table-menu-item-icon");
      l.innerHTML = t.icon, o.appendChild(l);
    } else
      o.classList.add("menu-item-no-icon");
    const r = this.createElement("span", "e-virt-table-menu-item-text");
    if (r.textContent = t.label || "", o.appendChild(r), s.appendChild(o), (i = t.children) != null && i.length) {
      const l = this.createElement("span", "e-virt-table-menu-arrow");
      l.innerHTML = ut, s.appendChild(l);
      const h = this.createSubmenu(t.children);
      s._submenu = h, this.container.appendChild(h);
    }
    return s;
  }
  createSubmenu(t) {
    const e = this.createElement("div", "e-virt-table-submenu");
    return t.forEach((i) => {
      e.appendChild(this.createMenuItem(i, !0));
    }), e;
  }
  createElement(t, e = "") {
    const i = document.createElement(t);
    return e && (i.className = e), i;
  }
  bindEvents() {
    this.container.addEventListener("mouseenter", this.boundMouseEnterHandler, !0), this.container.addEventListener("mouseleave", this.boundMouseLeaveHandler, !0), this.container.addEventListener("click", this.boundClickHandler);
  }
  handleMouseEvent(t, e) {
    t.stopPropagation();
    const i = t.target.closest(".e-virt-table-menu-item, .e-virt-table-submenu-item");
    i && (this.container.contains(i) || i.classList.contains("e-virt-table-submenu-item")) && (e === "enter" ? this.handleHover(i) : this.handleLeave(i));
  }
  handleHover(t) {
    t.classList.contains("e-virt-table-menu-item") && (this.container.querySelectorAll(".e-virt-table-menu-item").forEach((i) => i.classList.remove("active")), t.classList.contains("disabled") || t.classList.add("active"));
    const e = t._submenu || t.querySelector(".e-virt-table-submenu");
    e && (this.hideSiblingSubmenus(t), this.showSubmenu(t, e));
  }
  handleLeave(t) {
    const e = t._submenu || t.querySelector(".e-virt-table-submenu");
    setTimeout(() => {
      const i = e;
      i && !i.matches(":hover") && !t.matches(":hover") && (this.hideSubmenu(i), t.classList.contains("e-virt-table-menu-item") && t.classList.remove("active"));
    }, 150);
  }
  hideSiblingSubmenus(t) {
    let e;
    if (t.classList.contains("e-virt-table-menu-item"))
      e = this.container.querySelectorAll(".e-virt-table-menu-item");
    else {
      const i = t.closest(".e-virt-table-submenu");
      if (i)
        e = i.querySelectorAll(".e-virt-table-submenu-item");
      else
        return;
    }
    e.forEach((i) => {
      i !== t && i._submenu && this.hideSubmenu(i._submenu);
    });
  }
  async showSubmenu(t, e) {
    if (this.activeSubmenus.has(e)) return;
    this.activeSubmenus.add(e), e.classList.add("show");
    const i = Lt(t, e, async () => {
      const s = this.container.getBoundingClientRect(), o = window.innerWidth, r = e.offsetWidth || 200, l = o - s.right, h = s.left, c = l >= r || l >= h ? "right-start" : "left-start", { x: u, y: d } = await pt(t, e, {
        placement: c,
        middleware: [mt(8), wt({ padding: 8 })]
      });
      Object.assign(e.style, {
        left: `${u}px`,
        top: `${d}px`
      });
    });
    e._cleanup = i;
  }
  hideSubmenu(t) {
    if (!this.activeSubmenus.has(t)) return;
    this.activeSubmenus.delete(t), t.classList.remove("show"), this.hideAllChildSubmenus(t);
    const e = t;
    e._cleanup && (e._cleanup(), delete e._cleanup);
  }
  hideAllChildSubmenus(t) {
    t.querySelectorAll(".e-virt-table-submenu-item").forEach((e) => {
      if (e._submenu) {
        const i = e._submenu;
        if (this.activeSubmenus.has(i)) {
          this.activeSubmenus.delete(i), i.classList.remove("show");
          const s = i;
          s._cleanup && (s._cleanup(), delete s._cleanup), this.hideAllChildSubmenus(i);
        }
      }
    });
  }
  handleClick(t) {
    t.stopPropagation();
    const e = t.target.closest(
      ".e-virt-table-menu-item, .e-virt-table-submenu-item"
    );
    if (!e || e.classList.contains("disabled")) return;
    if (e.classList.contains("e-virt-table-menu-item")) {
      const o = e._submenu || e.querySelector(".e-virt-table-submenu");
      if (o) {
        this.showSubmenu(e, o);
        return;
      }
    }
    const i = e.getAttribute("data-menu") || e?.getAttribute("data-submenu"), s = this.findMenuItem(i || "");
    s && this.onClick && this.onClick(s, i || "");
  }
  findMenuItem(t, e = this.menuData) {
    for (const i of e) {
      if (i.value === t) return i;
      if (i.children) {
        const s = this.findMenuItem(t, i.children);
        if (s) return s;
      }
    }
    return null;
  }
  positionMenu(t) {
    const e = {
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        top: t.clientY,
        left: t.clientX,
        right: t.clientX,
        bottom: t.clientY,
        x: t.clientX,
        y: t.clientY
      }),
      contextElement: document.body
    };
    Lt(e, this.container, () => {
      pt(e, this.container, {
        placement: "right-start",
        middleware: [mt(), wt(), Xt()]
      }).then(({ x: i, y: s }) => {
        this.container && Object.assign(this.container.style, {
          left: `${i}px`,
          top: `${s}px`
        });
      });
    });
  }
  destroy() {
    this.container.removeEventListener("mouseenter", this.boundMouseEnterHandler, !0), this.container.removeEventListener("mouseleave", this.boundMouseLeaveHandler, !0), this.container.removeEventListener("click", this.boundClickHandler), this.cleanupAllSubmenus(this.container), this.container.style.display = "none", this.container.replaceChildren();
  }
  /**
   * 删除指定值的菜单项
   * @param value 要删除的菜单项的值
   * @returns 是否成功删除
   */
  removeMenuItem(t) {
    const e = this.container.querySelector(`[data-menu="${t}"]`);
    if (!e)
      return !1;
    const i = e.querySelector(".e-virt-table-submenu");
    return i && this.cleanupSubmenuRecursively(i), e.remove(), !0;
  }
  /**
   * 删除指定值的子菜单项
   * @param value 要删除的子菜单项的值
   * @returns 是否成功删除
   */
  removeSubMenuItem(t) {
    const e = this.container.querySelector(`[data-submenu="${t}"]`);
    if (!e)
      return !1;
    const i = e.closest(".e-virt-table-submenu"), s = e._submenu;
    if (s && this.cleanupSubmenuRecursively(s), e.remove(), i && i.querySelectorAll(".e-virt-table-submenu-item").length === 0) {
      const o = this.container.querySelector("[data-menu]");
      if (o && o._submenu === i)
        this.removeMenuItem(o.getAttribute("data-menu") || "");
      else {
        const r = this.container.querySelectorAll("[data-menu], [data-submenu]");
        for (const l of r)
          if (l._submenu === i) {
            const h = l.getAttribute("data-menu") || l.getAttribute("data-submenu");
            h && (l.hasAttribute("data-menu") ? this.removeMenuItem(h) : this.removeSubMenuItem(h));
            break;
          }
      }
    }
    return !0;
  }
  cleanupAllSubmenus(t) {
    t.querySelectorAll(".e-virt-table-menu-item").forEach((e) => {
      e._submenu && (this.cleanupSubmenuRecursively(e._submenu), e._submenu = void 0);
    });
  }
  cleanupSubmenuRecursively(t) {
    const e = t;
    e._cleanup && (e._cleanup(), delete e._cleanup), t.querySelectorAll(".e-virt-table-submenu-item").forEach((i) => {
      i._submenu && this.cleanupSubmenuRecursively(i._submenu);
    }), t.remove();
  }
}
class ls {
  constructor(t) {
    n(this, "ctx"), n(this, "contextMenuEl"), n(this, "currentDOMTreeMenu"), n(this, "isCustom", !1), this.ctx = t, this.ctx.contextMenuElement ? (this.contextMenuEl = this.ctx.contextMenuElement, this.contextMenuEl.className = "e-virt-table-main-menu", this.isCustom = !0) : (this.contextMenuEl = document.createElement("div"), this.isCustom = !1), this.ctx.containerElement.appendChild(this.contextMenuEl), this.init();
  }
  init() {
    this.ctx.on("outsideMousedown", () => {
      this.hide();
    }), this.ctx.on("cellContextMenuClick", async (t, e) => {
      if (this.isCustom) {
        this.contextMenuEl.style.display = "block", this.positionMenu(e);
        return;
      }
      const { ENABLE_CONTEXT_MENU: i, CUSTOM_BODY_CONTEXT_MENU: s, CONTEXT_MENU: o, BEFORE_BODY_CONTEXT_MENU_METHOD: r } = this.ctx.config;
      let l = o.map((w) => ({
        ...w,
        label: w.label || this.ctx.locale.getText(w.value)
      }));
      if (l = [...l, ...s], r && (l = await r({ list: l, cell: t, hide: this.hide.bind(this) })), !i || l.length === 0) return;
      e.preventDefault();
      const { xArr: h, yArr: c } = this.ctx.selector, [u, d] = h, [x, f] = c, { rowIndex: m, colIndex: g } = t;
      m >= x && m <= f && g >= u && g <= d || this.ctx.emit("setSelectorCell", t, e), this.currentDOMTreeMenu && this.currentDOMTreeMenu.destroy(), this.ctx.contextMenuIng = !0, this.currentDOMTreeMenu = new se(this.contextMenuEl, l, {
        onClick: (w, C) => {
          C === "copy" ? (this.ctx.emit("contextMenuCopy"), this.hide()) : C === "paste" ? (this.ctx.emit("contextMenuPaste"), this.hide()) : C === "cut" ? (this.ctx.emit("contextMenuCut"), this.hide()) : C === "clearSelected" ? (this.ctx.emit("contextMenuClearSelected"), this.hide()) : w.event && w.event(e, {
            hide: this.hide.bind(this),
            cell: t
          });
        }
      }), this.currentDOMTreeMenu.positionMenu(e);
    }), this.ctx.on("cellHeaderContextMenuClick", async (t, e) => {
      if (this.isCustom) {
        this.contextMenuEl.style.display = "block", this.positionMenu(e);
        return;
      }
      const { SELECTOR_AREA_MIN_X: i, SELECTOR_AREA_MAX_X: s, SELECTOR_AREA_MAX_X_OFFSET: o, BEFORE_HEADER_CONTEXT_MENU_METHOD: r } = this.ctx.config, l = i, h = s || this.ctx.maxColIndex - o;
      if (t.colIndex < l || t.colIndex > h)
        return;
      const { HEADER_CONTEXT_MENU: c, CUSTOM_HEADER_CONTEXT_MENU: u, ENABLE_HEADER_CONTEXT_MENU: d } = this.ctx.config;
      let x = c.map((b) => ({
        ...b,
        label: b.label || this.ctx.locale.getText(b.value)
      }));
      if (x = [...x, ...u], r && (x = await r({ list: x, cell: t, hide: this.hide.bind(this) })), !d || x.length === 0) return;
      e.preventDefault();
      const { xArr: f } = this.ctx.selector, [m, g] = f, { colIndex: w } = t;
      w >= m && w <= g || (this.ctx.focusCellHeader = t, this.ctx.emit("selectCols", t)), this.currentDOMTreeMenu && this.currentDOMTreeMenu.destroy();
      const C = this.ctx.database.getColumns(), E = x.map((b) => b.value === "visible" ? {
        ...b,
        children: this.filterColumns(C)
      } : b);
      this.ctx.contextMenuIng = !0, this.currentDOMTreeMenu = new se(this.contextMenuEl, E, {
        onClick: (b, p) => {
          const { xArr: y } = this.ctx.selector, [R, _] = y;
          if (p === "fixedLeft" || p === "fixedRight" || p === "fixedNone") {
            const T = this.ctx.header.allCellHeaders.filter((v) => v.colIndex >= R && v.colIndex <= _).filter((v) => v.level === 0).filter((v) => !v.column.fixedDisabled).map((v) => v.key);
            this.ctx.database.setCustomHeaderFixedData(
              T,
              p === "fixedLeft" ? "left" : p === "fixedRight" ? "right" : ""
            ), this.hide();
          } else if (p === "hide") {
            const T = this.ctx.header.leafCellHeaders.filter((v) => v.colIndex >= R && v.colIndex <= _).filter((v) => !v.children.length).filter((v) => !v.column.hideDisabled).map((v) => v.key);
            T.length > 0 && this.ctx.database.setCustomHeaderHideData(T, !0), this.hide();
          } else if (p !== "visible") if (p.startsWith("visible_")) {
            if (!b.key) return;
            if (b.children) {
              const v = this.getLeafKeys(b.children);
              this.ctx.database.setCustomHeaderHideData(v, !1);
            } else
              this.ctx.database.setCustomHeaderHideData([b.key], !1);
            this.currentDOMTreeMenu && this.currentDOMTreeMenu.removeSubMenuItem(p);
            const T = this.ctx.database.getColumns();
            it(T).filter((v) => v.hide).length === 0 && this.hide();
          } else p === "resetHeader" ? (this.ctx.database.resetCustomHeader(), this.hide()) : b.event && b.event(e, {
            hide: this.hide.bind(this),
            cell: t
          });
        }
      }), this.positionMenu(e);
    }), this.ctx.on("click", () => {
      this.hide();
    }), this.ctx.on("onScroll", this.hide.bind(this)), this.ctx.on("resize", this.hide.bind(this));
  }
  positionMenu(t) {
    const e = {
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        top: t.clientY,
        left: t.clientX,
        right: t.clientX,
        bottom: t.clientY,
        x: t.clientX,
        y: t.clientY
      }),
      contextElement: document.body
    };
    Lt(e, this.contextMenuEl, () => {
      pt(e, this.contextMenuEl, {
        placement: "right-start",
        middleware: [mt(), wt(), Xt()]
      }).then(({ x: i, y: s }) => {
        this.contextMenuEl && Object.assign(this.contextMenuEl.style, {
          left: `${i}px`,
          top: `${s}px`
        });
      });
    });
  }
  filterColumns(t) {
    const e = [];
    for (const i of t)
      if (i.children && i.children.length > 0) {
        const s = this.filterColumns(i.children);
        s.length > 0 && e.push({
          label: i.title,
          key: i.key,
          value: `visible_${i.key}`,
          // disabled: true, // 非末级，且有子项保留 → disabled
          children: s
        });
      } else i.hide && e.push({ label: i.title, value: `visible_${i.key}`, key: i.key });
    return e;
  }
  // 递归获取所有子项key
  getLeafKeys(t) {
    return t.reduce((e, i) => (!i.children || i.children.length === 0 ? e.push(String(i.key)) : e.push(...this.getLeafKeys(i.children)), e), []);
  }
  hide() {
    this.currentDOMTreeMenu && (this.currentDOMTreeMenu.destroy(), this.currentDOMTreeMenu = void 0), this.contextMenuEl.style.display = "none", this.ctx.contextMenuIng = !1;
  }
  destroy() {
    var t;
    this.hide(), (t = this.contextMenuEl) == null || t.remove();
  }
}
class hs {
  constructor(t) {
    if (n(this, "ctx"), n(this, "loadingEl"), n(this, "textEl", document.createElement("p")), this.ctx = t, this.ctx.loadingElement)
      this.loadingEl = this.ctx.loadingElement;
    else {
      this.loadingEl = document.createElement("div");
      const e = document.createElement("div");
      e.className = "e-virt-table-loading-spinner";
      const i = this.ctx.icons.getSvg("loading");
      if (i) {
        const s = new DOMParser().parseFromString(i.svg, "image/svg+xml").documentElement;
        e.appendChild(s);
      }
      this.textEl.className = "e-virt-table-loading-text", this.textEl.innerText = this.getText(), e.appendChild(this.textEl), this.loadingEl.appendChild(e);
    }
    this.loadingEl.className = "e-virt-table-loading", this.loadingEl.style.display = "none", this.ctx.containerElement.appendChild(this.loadingEl);
  }
  getText() {
    return this.ctx.config.LOADING_TEXT || this.ctx.locale.getText("loadingText");
  }
  show() {
    this.loadingEl.style.display = "flex";
  }
  hide() {
    this.loadingEl.style.display = "none";
  }
  draw() {
    this.ctx.loadingElement || (this.textEl.innerText = this.getText());
  }
  destroy() {
    this.loadingEl.remove();
  }
}
class as {
  constructor(t) {
    n(this, "ctx"), n(this, "container"), n(this, "input"), n(this, "prevBtn"), n(this, "nextBtn"), n(this, "closeBtn"), n(this, "countEl"), n(this, "loadingEl"), n(this, "isVisible", !1), n(this, "searchResults", []), n(this, "currentIndex", -1), n(this, "searchData", []), n(this, "isComposing", !1), this.ctx = t, this.container = this.createContainer(), this.ctx.containerElement.appendChild(this.container), this.bindEvents(), this.ctx.on("keydown", (e) => {
      if (this.ctx.config.ENABLE_FINDER && !this.ctx.editing) {
        if ((e.ctrlKey || e.metaKey) && e.code === "KeyF") {
          e.preventDefault(), this.show();
          return;
        }
        if (this.ctx.finding) {
          if (e.code === "Escape") {
            e.preventDefault(), this.hide();
            return;
          }
          if (e.code === "ArrowUp" || e.shiftKey && e.key === "Enter") {
            e.preventDefault(), this.navigatePrevious();
            return;
          }
          if (e.code === "ArrowDown" || e.key === "Enter") {
            e.preventDefault(), this.navigateNext();
            return;
          }
        }
      }
    }), this.ctx.on("setSelector", () => {
      this.hide();
    }), this.ctx.on("outsideMousedown", () => {
      this.hide();
    });
  }
  async initSearchData() {
    this.showLoading(), this.searchData = [], setTimeout(() => {
      const { allCellHeaders: t } = this.ctx.header;
      for (let s = 0; s < t.length; s++) {
        const o = t[s];
        if (!o)
          continue;
        const r = o.getFinderText();
        r && this.searchData.push({
          rowIndex: o.level,
          colIndex: o.colIndex,
          text: r,
          type: "header",
          colKey: o.key
        });
      }
      const { maxColIndex: e, maxRowIndex: i } = this.ctx;
      for (let s = 0; s <= i; s++)
        for (let o = 0; o <= e; o++) {
          const r = this.ctx.database.getVirtualBodyCell(s, o, !1), l = r?.getFinderText();
          l && this.searchData.push({
            rowIndex: s,
            colIndex: o,
            text: l,
            type: "body"
          });
        }
      for (const s of this.ctx.footer.renderRows)
        for (const o of s.cells) {
          const r = o.getFinderText();
          r && this.searchData.push({
            rowIndex: o.rowIndex,
            colIndex: o.colIndex,
            text: r,
            type: "footer"
          });
        }
      this.hideLoading();
    }, 0);
  }
  createContainer() {
    const t = document.createElement("div");
    t.className = "e-virt-table-finder-bar";
    const e = document.createElement("div");
    e.className = "e-virt-table-finder-bar-input-wrapper", this.input = document.createElement("input"), this.input.type = "text", this.input.className = "e-virt-table-finder-bar-input", this.input.placeholder = "", e.appendChild(this.input), this.loadingEl = document.createElement("div"), this.loadingEl.className = "e-virt-table-finder-bar-loading";
    const i = de;
    this.loadingEl.innerHTML = i, e.appendChild(this.loadingEl), this.countEl = document.createElement("span"), this.countEl.className = "e-virt-table-finder-bar-count";
    const s = document.createElement("div");
    return s.className = "e-virt-table-finder-bar-nav", this.prevBtn = document.createElement("button"), this.prevBtn.className = "e-virt-table-finder-bar-nav-btn prev-btn", this.prevBtn.innerHTML = ut, this.nextBtn = document.createElement("button"), this.nextBtn.className = "e-virt-table-finder-bar-nav-btn next-btn", this.nextBtn.innerHTML = ut, s.appendChild(this.prevBtn), s.appendChild(this.nextBtn), this.closeBtn = document.createElement("button"), this.closeBtn.className = "e-virt-table-finder-bar-nav-btn close-btn", this.closeBtn.innerHTML = "×", t.appendChild(e), t.appendChild(this.countEl), t.appendChild(s), t.appendChild(this.closeBtn), t;
  }
  bindEvents() {
    this.input.addEventListener("input", () => {
      this.isComposing || this.performSearch();
    }), this.input.addEventListener("compositionstart", () => {
      this.isComposing = !0;
    }), this.input.addEventListener("compositionend", () => {
      this.isComposing = !1, this.performSearch();
    }), this.prevBtn.addEventListener("click", () => {
      this.navigatePrevious();
    }), this.nextBtn.addEventListener("click", () => {
      this.navigateNext();
    }), this.closeBtn.addEventListener("click", () => {
      this.hide();
    });
  }
  performSearch() {
    const t = this.input.value.trim();
    if (this.searchResults = [], this.currentIndex = -1, !t) {
      this.cearFinderBar(), this.updateCount();
      return;
    }
    this.showLoading(), setTimeout(() => {
      this.searchResults = this.searchData.filter(
        (e) => e.text.toLowerCase().includes(t.toLowerCase())
      ), this.searchResults.length > 0 ? (this.currentIndex = 0, this.scrollToCurrentResult()) : this.cearFinderBar(), this.updateCount(), this.hideLoading();
    }, 0);
  }
  scrollToCurrentResult() {
    if (this.currentIndex < 0 || this.currentIndex >= this.searchResults.length)
      return;
    const t = this.searchResults[this.currentIndex];
    this.ctx.finderBar = t;
    const { rowIndex: e, colIndex: i } = t;
    this.ctx.emit("scrollToIndex", e, i, t.type);
  }
  navigateNext() {
    this.searchResults.length !== 0 && (this.currentIndex = (this.currentIndex + 1) % this.searchResults.length, this.scrollToCurrentResult(), this.updateCount());
  }
  navigatePrevious() {
    this.searchResults.length !== 0 && (this.currentIndex = this.currentIndex <= 0 ? this.searchResults.length - 1 : this.currentIndex - 1, this.scrollToCurrentResult(), this.updateCount());
  }
  updateCount() {
    if (this.searchResults.length === 0)
      this.input.value.trim() ? (this.countEl.textContent = "0/0", this.countEl.classList.add("no-results")) : (this.countEl.textContent = "", this.countEl.classList.remove("no-results"));
    else {
      const t = this.currentIndex + 1, e = this.searchResults.length;
      this.countEl.textContent = `${t}/${e}`, this.countEl.classList.remove("no-results");
    }
  }
  show() {
    this.isVisible || (this.isVisible = !0, this.ctx.finding = !0, this.container.classList.add("show"), this.input.focus(), this.initSearchData());
  }
  showLoading() {
    var t;
    this.loadingEl.classList.add("show"), (t = this.loadingEl.parentElement) == null || t.classList.add("loading"), this.input.readOnly = !0;
  }
  hideLoading() {
    var t;
    this.loadingEl.classList.remove("show"), (t = this.loadingEl.parentElement) == null || t.classList.remove("loading"), this.input.readOnly = !1;
  }
  cearFinderBar() {
    this.ctx.finderBar = {
      rowIndex: -1,
      colIndex: -1,
      text: "",
      type: "header"
    }, this.ctx.emit("draw");
  }
  hide() {
    this.isVisible && (this.isVisible = !1, this.container.classList.remove("show"), this.ctx.finding = !1, this.input.value = "", this.searchResults = [], this.searchData = [], this.currentIndex = -1, this.hideLoading(), this.ctx.finderBar = {
      rowIndex: -1,
      colIndex: -1,
      text: "",
      type: "header"
    }, this.updateCount(), this.ctx.emit("draw"));
  }
  destroy() {
    this.hide(), this.container.remove();
  }
}
const Re = class Mt {
  constructor(t) {
    n(this, "ctx"), n(this, "layouts", /* @__PURE__ */ new Map()), n(this, "activeCellKey", ""), n(this, "selectionStart", null), n(this, "selectionEnd", null), n(this, "pending", null), this.ctx = t, this.ctx.on("registerTextLayout", (e, i) => this.layouts.set(e, i)), this.ctx.on("mousedown", (e) => this.onMouseDown(e)), this.ctx.on("mousemove", (e) => this.onMouseMove(e)), this.ctx.on("mouseup", () => this.onMouseUp()), this.ctx.on("cellHeaderHoverChange", (e) => this.yieldToColumnDrag(e)), this.ctx.on("cellHoverChange", () => this.yieldToColumnDrag()), this.ctx.on("keydown", (e) => this.onCopyKeydown(e)), this.ctx.on("outsideMousedown", () => this.resetSelection());
  }
  get canSelect() {
    return this.ctx.config.ENABLE_TEXT_SELECTION && !this.ctx.editing && !this.ctx.finding;
  }
  /** 跨表头列或从表头拖入 body 时，让位给列/区域选择 */
  yieldToColumnDrag(t) {
    const e = this.ctx.focusCellHeader;
    if (!(!this.ctx.textSelecting || !e)) {
      if (t) {
        const i = e.colIndex, s = e.colIndex + e.colspan - 1, o = t.colIndex, r = t.colIndex + t.colspan - 1;
        if (o >= i && r <= s)
          return;
      }
      this.resetSelection();
    }
  }
  onMouseDown(t) {
    if (!this.canSelect || !this.ctx.isTarget(t))
      return;
    this.ctx.containerElement.contains(document.activeElement) || this.ctx.containerElement.focus({ preventScroll: !0 });
    const e = this.hitTest(t);
    if (!e) {
      this.resetSelection();
      return;
    }
    const { offsetX: i, offsetY: s } = this.ctx.getOffset(t);
    this.pending = { cellKey: e.cellKey, index: e.index, startX: i, startY: s };
  }
  onMouseMove(t) {
    if (!this.canSelect || (this.ctx.textSelecting || this.tryStartDrag(t), !this.ctx.textSelecting))
      return;
    const e = this.layouts.get(this.activeCellKey);
    if (!e)
      return;
    const { offsetX: i, offsetY: s } = this.ctx.getOffset(t), o = this.hitTestText(e, i, s);
    o !== null && (this.selectionEnd = o, this.updateSelection());
  }
  tryStartDrag(t) {
    if (!this.pending || !this.ctx.mousedown)
      return;
    const { offsetX: e, offsetY: i } = this.ctx.getOffset(t), s = Math.abs(e - this.pending.startX), o = Math.abs(i - this.pending.startY);
    if (s < Mt.DRAG_THRESHOLD && o < Mt.DRAG_THRESHOLD)
      return;
    const r = this.hitTest(t);
    if (!r || r.cellKey !== this.pending.cellKey) {
      this.pending = null;
      return;
    }
    this.activeCellKey = this.pending.cellKey, this.selectionStart = this.pending.index, this.selectionEnd = r.index, this.pending = null, this.ctx.textSelecting = !0, this.updateSelection();
  }
  onMouseUp() {
    this.pending = null, this.ctx.textSelecting = !1, this.ctx.textSelectionStr = this.getSelectedText(), this.ctx.textSelectionStr && this.ctx.emit("drawView");
  }
  onCopyKeydown(t) {
    var e;
    if (!this.canSelect || !((t.ctrlKey || t.metaKey) && t.code === "KeyC"))
      return;
    const i = this.getSelectedText();
    i && (t.preventDefault(), (e = navigator.clipboard) == null || e.writeText(i).catch((s) => console.error("Copy Failure:", s)));
  }
  /**
   * 命中最顶层文字（固定列/表头后绘制会覆盖普通单元格，取最后一个命中）。
   */
  hitTest(t) {
    const { offsetX: e, offsetY: i } = this.ctx.getOffset(t);
    let s = null;
    for (const [o, r] of this.layouts) {
      const l = this.hitTestText(r, e, i);
      l !== null && (s = { cellKey: o, index: l });
    }
    return s;
  }
  updateSelection() {
    this.ctx.textSelectionStr = this.getSelectedText(), this.ctx.emit("drawView");
  }
  hitTestText(t, e, i) {
    const { glyphs: s, contentY: o, lineHeight: r, lines: l } = t;
    if (!s.length)
      return null;
    const h = Math.floor((i - o) / r);
    if (h < 0 || h >= l.length)
      return null;
    const c = s.filter((m) => m.line === h);
    if (!c.length)
      return null;
    const u = 2, d = o + h * r;
    if (i < d - u || i >= d + r + u)
      return null;
    const x = c[0], f = c[c.length - 1];
    if (e < x.x - u || e > f.x + f.width + u)
      return null;
    if (e <= x.x)
      return x.index;
    for (const m of c)
      if (e < m.x + m.width / 2)
        return m.index;
    return f.index + 1;
  }
  clearLayouts() {
    this.layouts.clear();
  }
  draw() {
    if (!this.ctx.config.ENABLE_TEXT_SELECTION)
      return;
    const t = this.getSelectionRange(), e = t && this.layouts.get(this.activeCellKey);
    e && this.drawTextSelection(e, t);
  }
  drawTextSelection(t, e, i = "#fff", s = "#3b82f6") {
    if (e.start >= e.end)
      return;
    const o = /* @__PURE__ */ new Map();
    for (const l of t.glyphs) {
      if (l.index < e.start || l.index >= e.end)
        continue;
      const h = o.get(l.line) ?? [];
      h.push(l), o.set(l.line, h);
    }
    if (!o.size)
      return;
    const r = this.ctx.paint.getCtx();
    r.save(), r.font = t.font, r.textBaseline = "middle", r.textAlign = "left", o.forEach((l) => {
      const h = l[0], c = l[l.length - 1];
      r.fillStyle = s, r.fillRect(h.x, h.y - 1, c.x + c.width - h.x, h.height), r.fillStyle = i;
      for (const u of l)
        r.fillText(u.char, u.x, u.y + t.lineHeight / 2);
    }), r.restore();
  }
  getSelectionRange() {
    return this.selectionStart === null || this.selectionEnd === null ? null : {
      start: Math.min(this.selectionStart, this.selectionEnd),
      end: Math.max(this.selectionStart, this.selectionEnd)
    };
  }
  getSelectedText() {
    const t = this.getSelectionRange(), e = t && this.layouts.get(this.activeCellKey);
    return !e || t.start >= t.end ? "" : e.chars.slice(t.start, t.end).join("");
  }
  resetSelection() {
    this.activeCellKey = "", this.selectionStart = null, this.selectionEnd = null, this.pending = null, this.ctx.textSelecting = !1, this.ctx.textSelectionStr = "", this.ctx.emit("drawView");
  }
  destroy() {
    this.layouts.clear(), this.resetSelection();
  }
};
n(Re, "DRAG_THRESHOLD", 4);
let cs = Re;
const Ie = class _e {
  constructor(t, e) {
    n(this, "options"), n(this, "scroller"), n(this, "header"), n(this, "body"), n(this, "footer"), n(this, "selector"), n(this, "autofill"), n(this, "tooltip"), n(this, "editor"), n(this, "empty"), n(this, "overlayer"), n(this, "contextMenu"), n(this, "loading"), n(this, "finderBar"), n(this, "textSelector"), n(this, "animationFrameId"), n(this, "ctx"), this.options = e;
    const { overlayerElement: i, editorElement: s, emptyElement: o, contextMenuElement: r } = this.options, l = this.createContainer(
      t,
      i,
      s,
      o,
      r
    );
    this.ctx = new di(l, this.options), this.textSelector = new cs(this.ctx), this.header = new gi(this.ctx), this.footer = new wi(this.ctx), this.body = new mi(this.ctx), this.scroller = new xi(this.ctx), this.selector = new pi(this.ctx), this.autofill = new Ei(this.ctx), this.tooltip = new ss(this.ctx), this.empty = new rs(this.ctx), this.editor = new os(this.ctx), this.overlayer = new ns(this.ctx), this.contextMenu = new ls(this.ctx), this.loading = new hs(this.ctx), this.finderBar = new as(this.ctx), this.ctx.on("loadData", (h) => {
      this.loadData(h);
    }), this.ctx.on("draw", () => {
      this.draw();
    }), this.ctx.on("drawView", () => {
      this.draw(!0);
    }), this.draw();
  }
  static useLocale(t) {
    _e.locale = t;
  }
  createContainer(t, e, i, s, o) {
    t.className = "e-virt-table-container";
    const r = document.createElement("div"), l = document.createElement("canvas"), h = e || document.createElement("div");
    r.className = "e-virt-table-stage", t.tabIndex = 0, l.className = "e-virt-table-canvas", h.className = "e-virt-table-overlayer", h.setAttribute("data-overlayer", e ? "custom" : "default");
    const c = i || document.createElement("div");
    c.className = "e-virt-table-editor";
    const u = s, d = o;
    return r.appendChild(l), r.appendChild(h), t.appendChild(r), {
      containerElement: t,
      stageElement: r,
      canvasElement: l,
      overlayerElement: h,
      editorElement: c,
      emptyElement: u,
      contextMenuElement: d
    };
  }
  doDraw(t = !1) {
    this.updateStageBorder(), this.header.update(), this.body.update(), this.footer.update(), this.ctx.paint.clear(), this.textSelector.clearLayouts(), this.body.draw(), this.footer.draw(), this.header.draw(), this.textSelector.draw(), this.body.drawDragRowTip(), this.scroller.draw(), this.empty.draw(), this.loading.draw(), t || this.overlayer.draw();
  }
  updateStageBorder() {
    const { BORDER: t, BORDER_COLOR: e, BORDER_RADIUS: i } = this.ctx.config;
    this.ctx.stageElement.dataset.borderStyle = ot(t), this.ctx.stageElement.style.borderColor = $e(t) ? e : "transparent", this.ctx.stageElement.style.borderRadius = `${i}px`;
  }
  draw(t = !1) {
    this.animationFrameId && cancelAnimationFrame(this.animationFrameId), this.animationFrameId = requestAnimationFrame(() => {
      this.doDraw(t), this.body.updateAutoHeight() && this.doDraw(t);
    });
  }
  loadConfig(t) {
    this.ctx.config.init(t), this.ctx.database.init(!1), this.header.init(), this.ctx.emit("draw");
  }
  loadColumns(t) {
    this.editor.doneEdit(), this.ctx.database.setColumns(t), this.header.init(), this.ctx.emit("draw");
  }
  loadData(t) {
    this.editor.doneEdit(), this.ctx.database.setData(t), this.header.init(), this.tooltip.hide(), this.ctx.emit("draw");
  }
  loadFooterData(t) {
    this.ctx.database.setFooterData(t), this.ctx.emit("draw");
  }
  setCustomHeader(t, e = !0) {
    this.ctx.database.setCustomHeader(t, e), this.header.init(), this.ctx.emit("draw");
  }
  getCustomHeader() {
    return this.header.getCustomHeader();
  }
  showColumns(t, e = !0) {
    this.ctx.database.setCustomHeaderHideData(t, !e), this.header.init(), this.ctx.emit("draw");
  }
  fixedColumns(t, e) {
    this.ctx.database.setCustomHeaderFixedData(t, e), this.header.init(), this.ctx.emit("draw");
  }
  setLoading(t) {
    this.ctx.loading = t, t ? this.loading.show() : this.loading.hide();
  }
  on(t, e) {
    this.ctx.on(t, e);
  }
  emit(t, ...e) {
    this.ctx.emit(t, ...e);
  }
  off(t, e) {
    this.ctx.off(t, e);
  }
  filterMethod(t) {
    this.ctx.database.setFilterMethod(t), this.ctx.database.init(!1), this.header.init(), this.ctx.emit("draw");
  }
  editCell(t, e) {
    this.editor.editCell(t, e);
  }
  setItemValue(t, e, i, s = !0, o = !0, r = !1, l = !0) {
    this.ctx.database.setItemValue(t, e, i, s, o, r, l);
  }
  batchSetItemValue(t, e = !0, i = !0) {
    this.ctx.database.batchSetItemValue(t, e, i);
  }
  setItemValueByEditor(t, e, i, s = !0, o = !0, r = !0) {
    this.ctx.setItemValueByEditor(t, e, i, s, o, r), this.editor.doneEdit();
  }
  clearEditableData(t = null) {
    const e = [0, this.ctx.maxColIndex], i = [0, this.ctx.maxRowIndex];
    return this.selector.clearSelectedData(e, i, !1, t);
  }
  clearEditor() {
    this.editor.clearEditor();
  }
  doLayout() {
    this.ctx.emit("draw");
  }
  getChangedData() {
    return this.ctx.database.getChangedData();
  }
  getChangedRows() {
    return this.ctx.database.getChangedRows();
  }
  setCurrentRowByRowIndex(t) {
    this.ctx.currentCell = this.ctx.database.getVirtualBodyCell(t, 0), this.ctx.emit("draw");
  }
  setCurrentRow(t) {
    const e = this.ctx.database.getColumnByColIndex(0);
    e && (this.ctx.currentCell = this.ctx.database.getVirtualBodyCellByKey(t, e.key), this.ctx.emit("draw"));
  }
  getCurrentRow() {
    const t = this.ctx.currentCell;
    return t ? {
      row: t.row,
      rowIndex: t.rowIndex,
      rowKey: t.rowKey
    } : void 0;
  }
  clearValidate() {
    this.ctx.database.clearValidate(), this.ctx.emit("draw");
  }
  validateFields(t, e = !0) {
    return new Promise(async (i, s) => {
      let o = [];
      for (let r = 0; r < t.length; r++) {
        const { rowKey: l, key: h } = t[r], c = await this.ctx.database.getValidator(l, h);
        Array.isArray(c) && c.length && o.push(c);
      }
      if (o.length) {
        if (s(o), e) {
          const [r] = o;
          if (Array.isArray(r) && r.length) {
            const [l] = r, { rowKey: h, key: c } = l;
            this.scrollToRowkey(h), this.scrollToColkey(c);
          }
        }
        this.ctx.emit("draw");
      } else
        i([]), this.ctx.emit("draw");
    });
  }
  async validate(t = !0) {
    return new Promise(async (e, i) => {
      try {
        const s = await this.getValidations();
        e(s);
      } catch (s) {
        if (t && Array.isArray(s) && s.length) {
          const [o] = s;
          if (Array.isArray(o) && o.length) {
            const [r] = o, { rowKey: l, key: h } = r, c = this.ctx.database.getRowForRowKey(l);
            if (c) {
              const { parentRowKeys: u = [] } = c;
              u && u.length && this.setExpandRowKeys(u, !0);
            }
            this.scrollToRowkey(l), this.scrollToColkey(h);
          }
        }
        i(s);
      }
    });
  }
  setValidations(t) {
    if (t.forEach((e) => {
      const { rowIndex: i, key: s, message: o, rowKey: r } = e;
      if (i !== void 0 && r === void 0) {
        const l = this.ctx.database.getRowKeyForRowIndex(i);
        this.ctx.database.setValidationErrorByRowKey(l, s, o);
      }
      r && this.ctx.database.setValidationErrorByRowKey(r, s, o);
    }), t && Array.isArray(t) && t.length) {
      const [e] = t;
      if (e && e.rowKey)
        this.scrollToRowkey(e.rowKey), this.scrollToColkey(e.key);
      else if (e && e.rowIndex !== void 0 && e.rowIndex >= 0 && e.key) {
        const { rowIndex: i, key: s } = e;
        this.scrollToRowIndex(i), this.scrollToColkey(s);
      }
    }
  }
  getValidations() {
    return this.ctx.config.DISABLED ? new Promise((t) => {
      t([]);
    }) : new Promise(async (t, e) => {
      const i = this.ctx.database.getAllRowsData(), s = this.ctx.header.leafCellHeaders;
      let o = [];
      for (let r = 0; r < i.length; r++)
        for (let l = 0; l < s.length; l++) {
          const h = this.ctx.database.getRowKeyByItem(i[r]), c = s[l].key, u = await this.ctx.database.getValidator(h, c);
          Array.isArray(u) && u.length && o.push(u);
        }
      o.length ? (e(o), this.ctx.emit("draw")) : (t([]), this.ctx.emit("draw"));
    });
  }
  hasValidationError() {
    return this.ctx.database.hasValidationError();
  }
  scrollTo(t, e) {
    this.scroller.setScroll(t, e);
  }
  scrollXTo(t) {
    this.scroller.setScrollX(t);
  }
  scrollToColkey(t) {
    this.scroller.scrollToColkey(t);
  }
  scrollToRowkey(t) {
    this.scroller.scrollToRowKey(t);
  }
  scrollToColIndex(t) {
    this.scroller.scrollToColIndex(t);
  }
  scrollToRowIndex(t) {
    this.scroller.scrollToRowIndex(t);
  }
  scrollYTo(t) {
    this.scroller.setScrollY(t);
  }
  setExpandRowKeys(t, e = !0) {
    this.ctx.database.setExpandRowKeys(t, e);
  }
  getExpandRowKeys() {
    return this.ctx.database.getExpandRowKeys();
  }
  clearSelection() {
    this.ctx.database.clearSelection(), this.ctx.emit("draw");
  }
  toggleRowSelection(t) {
    const e = this.ctx.database.getRowKeyByItem(t);
    this.ctx.database.toggleRowSelection(e), this.ctx.emit("draw");
  }
  setSelectionByRows(t, e = !0) {
    t.forEach((i) => {
      const s = this.ctx.database.getRowKeyByItem(i);
      this.ctx.database.setRowSelection(s, e, !1);
    }), this.ctx.emit("selectionChange", this.getSelectionRows()), this.ctx.emit("draw");
  }
  setSelectionByRowKeys(t, e = !0) {
    t.forEach((i) => {
      this.ctx.database.setRowSelection(i, e, !1);
    }), this.ctx.emit("selectionChange", this.getSelectionRows()), this.ctx.emit("draw");
  }
  toggleAllSelection() {
    this.ctx.database.toggleAllSelection(), this.ctx.emit("draw");
  }
  toggleRowExpand(t, e) {
    this.ctx.database.expandItem(t, e), this.ctx.emit("draw");
  }
  toggleExpandAll(t) {
    this.ctx.database.expandAll(t), this.ctx.emit("draw");
  }
  getSelectionRows() {
    return this.ctx.database.getSelectionRows();
  }
  getPositionForRowIndex(t) {
    return this.ctx.database.getPositionForRowIndex(t);
  }
  getCellValue(t, e) {
    return this.ctx.database.getItemValue(t, e);
  }
  getCellValueByIndex(t, e) {
    return this.ctx.database.getItemValueForRowIndexAndColIndex(t, e);
  }
  clearSort() {
    this.ctx.database.clearSort();
  }
  contextMenuHide() {
    this.contextMenu.hide();
  }
  getUtils() {
    return {
      mergeColCell: Ne,
      mergeRowCell: He,
      getSpanArrByRow: ne,
      getSpanObjByColumn: le
    };
  }
  getColumnByKey(t) {
    var e;
    return (e = this.ctx.database.getColumnByKey(t)) == null ? void 0 : e.column;
  }
  clearChangeData() {
    this.ctx.database.clearChangeData(), this.ctx.emit("draw");
  }
  getReadonly(t, e) {
    return this.ctx.database.getReadonly(t, e);
  }
  useLocale(t) {
    this.ctx.locale.use(t);
  }
  /**
   * 销毁
   */
  destroy() {
    this.overlayer.destroy(), this.empty.destroy(), this.editor.destroy(), this.tooltip.destroy(), this.selector.destroy(), this.autofill.destroy(), this.contextMenu.destroy(), this.loading.destroy(), this.finderBar.destroy(), this.textSelector.destroy(), this.ctx.destroy(), this.ctx.containerElement.remove();
  }
};
n(Ie, "locale");
let ds = Ie;
export {
  ds as default
};
