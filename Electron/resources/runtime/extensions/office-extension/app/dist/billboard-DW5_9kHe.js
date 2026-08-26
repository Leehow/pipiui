import { formatSpecifier as Go, precisionFixed as Nl, precisionRound as Bl, precisionPrefix as Xl, formatPrefix as Gl, format as Yo } from "./index-CZLBAqmL.js";
var di = "http://www.w3.org/1999/xhtml";
const Ke = {
  svg: "http://www.w3.org/2000/svg",
  xhtml: di,
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};
function Sa(t) {
  var e = t += "", n = e.indexOf(":");
  return n >= 0 && (e = t.slice(0, n)) !== "xmlns" && (t = t.slice(n + 1)), Ke.hasOwnProperty(e) ? { space: Ke[e], local: t } : t;
}
function Yl(t) {
  return function() {
    var e = this.ownerDocument, n = this.namespaceURI;
    return n === di && e.documentElement.namespaceURI === di ? e.createElement(t) : e.createElementNS(n, t);
  };
}
function Vl(t) {
  return function() {
    return this.ownerDocument.createElementNS(t.space, t.local);
  };
}
function Vo(t) {
  var e = Sa(t);
  return (e.local ? Vl : Yl)(e);
}
function Ul() {
}
function zi(t) {
  return t == null ? Ul : function() {
    return this.querySelector(t);
  };
}
function Hl(t) {
  typeof t != "function" && (t = zi(t));
  for (var e = this._groups, n = e.length, a = new Array(n), i = 0; i < n; ++i)
    for (var r = e[i], o = r.length, s = a[i] = new Array(o), l, c, u = 0; u < o; ++u)
      (l = r[u]) && (c = t.call(l, l.__data__, u, r)) && ("__data__" in l && (c.__data__ = l.__data__), s[u] = c);
  return new Bt(a, this._parents);
}
function Uo(t) {
  return t == null ? [] : Array.isArray(t) ? t : Array.from(t);
}
function Wl() {
  return [];
}
function Ho(t) {
  return t == null ? Wl : function() {
    return this.querySelectorAll(t);
  };
}
function Zl(t) {
  return function() {
    return Uo(t.apply(this, arguments));
  };
}
function ql(t) {
  typeof t == "function" ? t = Zl(t) : t = Ho(t);
  for (var e = this._groups, n = e.length, a = [], i = [], r = 0; r < n; ++r)
    for (var o = e[r], s = o.length, l, c = 0; c < s; ++c)
      (l = o[c]) && (a.push(t.call(l, l.__data__, c, o)), i.push(l));
  return new Bt(a, i);
}
function Wo(t) {
  return function() {
    return this.matches(t);
  };
}
function Zo(t) {
  return function(e) {
    return e.matches(t);
  };
}
var jl = Array.prototype.find;
function Kl(t) {
  return function() {
    return jl.call(this.children, t);
  };
}
function Jl() {
  return this.firstElementChild;
}
function Ql(t) {
  return this.select(t == null ? Jl : Kl(typeof t == "function" ? t : Zo(t)));
}
var tc = Array.prototype.filter;
function ec() {
  return Array.from(this.children);
}
function nc(t) {
  return function() {
    return tc.call(this.children, t);
  };
}
function ac(t) {
  return this.selectAll(t == null ? ec : nc(typeof t == "function" ? t : Zo(t)));
}
function ic(t) {
  typeof t != "function" && (t = Wo(t));
  for (var e = this._groups, n = e.length, a = new Array(n), i = 0; i < n; ++i)
    for (var r = e[i], o = r.length, s = a[i] = [], l, c = 0; c < o; ++c)
      (l = r[c]) && t.call(l, l.__data__, c, r) && s.push(l);
  return new Bt(a, this._parents);
}
function qo(t) {
  return new Array(t.length);
}
function rc() {
  return new Bt(this._enter || this._groups.map(qo), this._parents);
}
function ra(t, e) {
  this.ownerDocument = t.ownerDocument, this.namespaceURI = t.namespaceURI, this._next = null, this._parent = t, this.__data__ = e;
}
ra.prototype = {
  constructor: ra,
  appendChild: function(t) {
    return this._parent.insertBefore(t, this._next);
  },
  insertBefore: function(t, e) {
    return this._parent.insertBefore(t, e);
  },
  querySelector: function(t) {
    return this._parent.querySelector(t);
  },
  querySelectorAll: function(t) {
    return this._parent.querySelectorAll(t);
  }
};
function oc(t) {
  return function() {
    return t;
  };
}
function sc(t, e, n, a, i, r) {
  for (var o = 0, s, l = e.length, c = r.length; o < c; ++o)
    (s = e[o]) ? (s.__data__ = r[o], a[o] = s) : n[o] = new ra(t, r[o]);
  for (; o < l; ++o)
    (s = e[o]) && (i[o] = s);
}
function lc(t, e, n, a, i, r, o) {
  var s, l, c = /* @__PURE__ */ new Map(), u = e.length, f = r.length, h = new Array(u), d;
  for (s = 0; s < u; ++s)
    (l = e[s]) && (h[s] = d = o.call(l, l.__data__, s, e) + "", c.has(d) ? i[s] = l : c.set(d, l));
  for (s = 0; s < f; ++s)
    d = o.call(t, r[s], s, r) + "", (l = c.get(d)) ? (a[s] = l, l.__data__ = r[s], c.delete(d)) : n[s] = new ra(t, r[s]);
  for (s = 0; s < u; ++s)
    (l = e[s]) && c.get(h[s]) === l && (i[s] = l);
}
function cc(t) {
  return t.__data__;
}
function uc(t, e) {
  if (!arguments.length) return Array.from(this, cc);
  var n = e ? lc : sc, a = this._parents, i = this._groups;
  typeof t != "function" && (t = oc(t));
  for (var r = i.length, o = new Array(r), s = new Array(r), l = new Array(r), c = 0; c < r; ++c) {
    var u = a[c], f = i[c], h = f.length, d = fc(t.call(u, u && u.__data__, c, a)), v = d.length, _ = s[c] = new Array(v), p = o[c] = new Array(v), g = l[c] = new Array(h);
    n(u, f, _, p, g, d, e);
    for (var x = 0, y = 0, m, T; x < v; ++x)
      if (m = _[x]) {
        for (x >= y && (y = x + 1); !(T = p[y]) && ++y < v; ) ;
        m._next = T || null;
      }
  }
  return o = new Bt(o, a), o._enter = s, o._exit = l, o;
}
function fc(t) {
  return typeof t == "object" && "length" in t ? t : Array.from(t);
}
function hc() {
  return new Bt(this._exit || this._groups.map(qo), this._parents);
}
function dc(t, e, n) {
  var a = this.enter(), i = this, r = this.exit();
  return typeof t == "function" ? (a = t(a), a && (a = a.selection())) : a = a.append(t + ""), e != null && (i = e(i), i && (i = i.selection())), n == null ? r.remove() : n(r), a && i ? a.merge(i).order() : i;
}
function vc(t) {
  for (var e = t.selection ? t.selection() : t, n = this._groups, a = e._groups, i = n.length, r = a.length, o = Math.min(i, r), s = new Array(i), l = 0; l < o; ++l)
    for (var c = n[l], u = a[l], f = c.length, h = s[l] = new Array(f), d, v = 0; v < f; ++v)
      (d = c[v] || u[v]) && (h[v] = d);
  for (; l < i; ++l)
    s[l] = n[l];
  return new Bt(s, this._parents);
}
function gc() {
  for (var t = this._groups, e = -1, n = t.length; ++e < n; )
    for (var a = t[e], i = a.length - 1, r = a[i], o; --i >= 0; )
      (o = a[i]) && (r && o.compareDocumentPosition(r) ^ 4 && r.parentNode.insertBefore(o, r), r = o);
  return this;
}
function pc(t) {
  t || (t = _c);
  function e(f, h) {
    return f && h ? t(f.__data__, h.__data__) : !f - !h;
  }
  for (var n = this._groups, a = n.length, i = new Array(a), r = 0; r < a; ++r) {
    for (var o = n[r], s = o.length, l = i[r] = new Array(s), c, u = 0; u < s; ++u)
      (c = o[u]) && (l[u] = c);
    l.sort(e);
  }
  return new Bt(i, this._parents).order();
}
function _c(t, e) {
  return t < e ? -1 : t > e ? 1 : t >= e ? 0 : NaN;
}
function xc() {
  var t = arguments[0];
  return arguments[0] = this, t.apply(null, arguments), this;
}
function mc() {
  return Array.from(this);
}
function yc() {
  for (var t = this._groups, e = 0, n = t.length; e < n; ++e)
    for (var a = t[e], i = 0, r = a.length; i < r; ++i) {
      var o = a[i];
      if (o) return o;
    }
  return null;
}
function bc() {
  let t = 0;
  for (const e of this) ++t;
  return t;
}
function Tc() {
  return !this.node();
}
function $c(t) {
  for (var e = this._groups, n = 0, a = e.length; n < a; ++n)
    for (var i = e[n], r = 0, o = i.length, s; r < o; ++r)
      (s = i[r]) && t.call(s, s.__data__, r, i);
  return this;
}
function wc(t) {
  return function() {
    this.removeAttribute(t);
  };
}
function Ac(t) {
  return function() {
    this.removeAttributeNS(t.space, t.local);
  };
}
function Sc(t, e) {
  return function() {
    this.setAttribute(t, e);
  };
}
function kc(t, e) {
  return function() {
    this.setAttributeNS(t.space, t.local, e);
  };
}
function Cc(t, e) {
  return function() {
    var n = e.apply(this, arguments);
    n == null ? this.removeAttribute(t) : this.setAttribute(t, n);
  };
}
function Rc(t, e) {
  return function() {
    var n = e.apply(this, arguments);
    n == null ? this.removeAttributeNS(t.space, t.local) : this.setAttributeNS(t.space, t.local, n);
  };
}
function Ec(t, e) {
  var n = Sa(t);
  if (arguments.length < 2) {
    var a = this.node();
    return n.local ? a.getAttributeNS(n.space, n.local) : a.getAttribute(n);
  }
  return this.each((e == null ? n.local ? Ac : wc : typeof e == "function" ? n.local ? Rc : Cc : n.local ? kc : Sc)(n, e));
}
function jo(t) {
  return t.ownerDocument && t.ownerDocument.defaultView || t.document && t || t.defaultView;
}
function Mc(t) {
  return function() {
    this.style.removeProperty(t);
  };
}
function Lc(t, e, n) {
  return function() {
    this.style.setProperty(t, e, n);
  };
}
function Dc(t, e, n) {
  return function() {
    var a = e.apply(this, arguments);
    a == null ? this.style.removeProperty(t) : this.style.setProperty(t, a, n);
  };
}
function Ic(t, e, n) {
  return arguments.length > 1 ? this.each((e == null ? Mc : typeof e == "function" ? Dc : Lc)(t, e, n ?? "")) : Je(this.node(), t);
}
function Je(t, e) {
  return t.style.getPropertyValue(e) || jo(t).getComputedStyle(t, null).getPropertyValue(e);
}
function zc(t) {
  return function() {
    delete this[t];
  };
}
function Pc(t, e) {
  return function() {
    this[t] = e;
  };
}
function Oc(t, e) {
  return function() {
    var n = e.apply(this, arguments);
    n == null ? delete this[t] : this[t] = n;
  };
}
function Fc(t, e) {
  return arguments.length > 1 ? this.each((e == null ? zc : typeof e == "function" ? Oc : Pc)(t, e)) : this.node()[t];
}
function Ko(t) {
  return t.trim().split(/^|\s+/);
}
function Pi(t) {
  return t.classList || new Jo(t);
}
function Jo(t) {
  this._node = t, this._names = Ko(t.getAttribute("class") || "");
}
Jo.prototype = {
  add: function(t) {
    var e = this._names.indexOf(t);
    e < 0 && (this._names.push(t), this._node.setAttribute("class", this._names.join(" ")));
  },
  remove: function(t) {
    var e = this._names.indexOf(t);
    e >= 0 && (this._names.splice(e, 1), this._node.setAttribute("class", this._names.join(" ")));
  },
  contains: function(t) {
    return this._names.indexOf(t) >= 0;
  }
};
function Qo(t, e) {
  for (var n = Pi(t), a = -1, i = e.length; ++a < i; ) n.add(e[a]);
}
function ts(t, e) {
  for (var n = Pi(t), a = -1, i = e.length; ++a < i; ) n.remove(e[a]);
}
function Nc(t) {
  return function() {
    Qo(this, t);
  };
}
function Bc(t) {
  return function() {
    ts(this, t);
  };
}
function Xc(t, e) {
  return function() {
    (e.apply(this, arguments) ? Qo : ts)(this, t);
  };
}
function Gc(t, e) {
  var n = Ko(t + "");
  if (arguments.length < 2) {
    for (var a = Pi(this.node()), i = -1, r = n.length; ++i < r; ) if (!a.contains(n[i])) return !1;
    return !0;
  }
  return this.each((typeof e == "function" ? Xc : e ? Nc : Bc)(n, e));
}
function Yc() {
  this.textContent = "";
}
function Vc(t) {
  return function() {
    this.textContent = t;
  };
}
function Uc(t) {
  return function() {
    var e = t.apply(this, arguments);
    this.textContent = e ?? "";
  };
}
function Hc(t) {
  return arguments.length ? this.each(t == null ? Yc : (typeof t == "function" ? Uc : Vc)(t)) : this.node().textContent;
}
function Wc() {
  this.innerHTML = "";
}
function Zc(t) {
  return function() {
    this.innerHTML = t;
  };
}
function qc(t) {
  return function() {
    var e = t.apply(this, arguments);
    this.innerHTML = e ?? "";
  };
}
function jc(t) {
  return arguments.length ? this.each(t == null ? Wc : (typeof t == "function" ? qc : Zc)(t)) : this.node().innerHTML;
}
function Kc() {
  this.nextSibling && this.parentNode.appendChild(this);
}
function Jc() {
  return this.each(Kc);
}
function Qc() {
  this.previousSibling && this.parentNode.insertBefore(this, this.parentNode.firstChild);
}
function tu() {
  return this.each(Qc);
}
function eu(t) {
  var e = typeof t == "function" ? t : Vo(t);
  return this.select(function() {
    return this.appendChild(e.apply(this, arguments));
  });
}
function nu() {
  return null;
}
function au(t, e) {
  var n = typeof t == "function" ? t : Vo(t), a = e == null ? nu : typeof e == "function" ? e : zi(e);
  return this.select(function() {
    return this.insertBefore(n.apply(this, arguments), a.apply(this, arguments) || null);
  });
}
function iu() {
  var t = this.parentNode;
  t && t.removeChild(this);
}
function ru() {
  return this.each(iu);
}
function ou() {
  var t = this.cloneNode(!1), e = this.parentNode;
  return e ? e.insertBefore(t, this.nextSibling) : t;
}
function su() {
  var t = this.cloneNode(!0), e = this.parentNode;
  return e ? e.insertBefore(t, this.nextSibling) : t;
}
function lu(t) {
  return this.select(t ? su : ou);
}
function cu(t) {
  return arguments.length ? this.property("__data__", t) : this.node().__data__;
}
function uu(t) {
  return function(e) {
    t.call(this, e, this.__data__);
  };
}
function fu(t) {
  return t.trim().split(/^|\s+/).map(function(e) {
    var n = "", a = e.indexOf(".");
    return a >= 0 && (n = e.slice(a + 1), e = e.slice(0, a)), { type: e, name: n };
  });
}
function hu(t) {
  return function() {
    var e = this.__on;
    if (e) {
      for (var n = 0, a = -1, i = e.length, r; n < i; ++n)
        r = e[n], (!t.type || r.type === t.type) && r.name === t.name ? this.removeEventListener(r.type, r.listener, r.options) : e[++a] = r;
      ++a ? e.length = a : delete this.__on;
    }
  };
}
function du(t, e, n) {
  return function() {
    var a = this.__on, i, r = uu(e);
    if (a) {
      for (var o = 0, s = a.length; o < s; ++o)
        if ((i = a[o]).type === t.type && i.name === t.name) {
          this.removeEventListener(i.type, i.listener, i.options), this.addEventListener(i.type, i.listener = r, i.options = n), i.value = e;
          return;
        }
    }
    this.addEventListener(t.type, r, n), i = { type: t.type, name: t.name, value: e, listener: r, options: n }, a ? a.push(i) : this.__on = [i];
  };
}
function vu(t, e, n) {
  var a = fu(t + ""), i, r = a.length, o;
  if (arguments.length < 2) {
    var s = this.node().__on;
    if (s) {
      for (var l = 0, c = s.length, u; l < c; ++l)
        for (i = 0, u = s[l]; i < r; ++i)
          if ((o = a[i]).type === u.type && o.name === u.name)
            return u.value;
    }
    return;
  }
  for (s = e ? du : hu, i = 0; i < r; ++i) this.each(s(a[i], e, n));
  return this;
}
function es(t, e, n) {
  var a = jo(t), i = a.CustomEvent;
  typeof i == "function" ? i = new i(e, n) : (i = a.document.createEvent("Event"), n ? (i.initEvent(e, n.bubbles, n.cancelable), i.detail = n.detail) : i.initEvent(e, !1, !1)), t.dispatchEvent(i);
}
function gu(t, e) {
  return function() {
    return es(this, t, e);
  };
}
function pu(t, e) {
  return function() {
    return es(this, t, e.apply(this, arguments));
  };
}
function _u(t, e) {
  return this.each((typeof e == "function" ? pu : gu)(t, e));
}
function* xu() {
  for (var t = this._groups, e = 0, n = t.length; e < n; ++e)
    for (var a = t[e], i = 0, r = a.length, o; i < r; ++i)
      (o = a[i]) && (yield o);
}
var Oi = [null];
function Bt(t, e) {
  this._groups = t, this._parents = e;
}
function sn() {
  return new Bt([[document.documentElement]], Oi);
}
function mu() {
  return this;
}
Bt.prototype = sn.prototype = {
  constructor: Bt,
  select: Hl,
  selectAll: ql,
  selectChild: Ql,
  selectChildren: ac,
  filter: ic,
  data: uc,
  enter: rc,
  exit: hc,
  join: dc,
  merge: vc,
  selection: mu,
  order: gc,
  sort: pc,
  call: xc,
  nodes: mc,
  node: yc,
  size: bc,
  empty: Tc,
  each: $c,
  attr: Ec,
  style: Ic,
  property: Fc,
  classed: Gc,
  text: Hc,
  html: jc,
  raise: Jc,
  lower: tu,
  append: eu,
  insert: au,
  remove: ru,
  clone: lu,
  datum: cu,
  on: vu,
  dispatch: _u,
  [Symbol.iterator]: xu
};
function N(t) {
  return typeof t == "string" ? new Bt([[document.querySelector(t)]], [document.documentElement]) : new Bt([[t]], Oi);
}
function yu(t) {
  let e;
  for (; e = t.sourceEvent; ) t = e;
  return t;
}
function Ht(t, e) {
  if (t = yu(t), e === void 0 && (e = t.currentTarget), e) {
    var n = e.ownerSVGElement || e;
    if (n.createSVGPoint) {
      var a = n.createSVGPoint();
      return a.x = t.clientX, a.y = t.clientY, a = a.matrixTransform(e.getScreenCTM().inverse()), [a.x, a.y];
    }
    if (e.getBoundingClientRect) {
      var i = e.getBoundingClientRect();
      return [t.clientX - i.left - e.clientLeft, t.clientY - i.top - e.clientTop];
    }
  }
  return [t.pageX, t.pageY];
}
function ns(t) {
  return typeof t == "string" ? new Bt([document.querySelectorAll(t)], [document.documentElement]) : new Bt([Uo(t)], Oi);
}
const Xa = /* @__PURE__ */ new Date(), Ga = /* @__PURE__ */ new Date();
function Et(t, e, n, a) {
  function i(r) {
    return t(r = arguments.length === 0 ? /* @__PURE__ */ new Date() : /* @__PURE__ */ new Date(+r)), r;
  }
  return i.floor = (r) => (t(r = /* @__PURE__ */ new Date(+r)), r), i.ceil = (r) => (t(r = new Date(r - 1)), e(r, 1), t(r), r), i.round = (r) => {
    const o = i(r), s = i.ceil(r);
    return r - o < s - r ? o : s;
  }, i.offset = (r, o) => (e(r = /* @__PURE__ */ new Date(+r), o == null ? 1 : Math.floor(o)), r), i.range = (r, o, s) => {
    const l = [];
    if (r = i.ceil(r), s = s == null ? 1 : Math.floor(s), !(r < o) || !(s > 0)) return l;
    let c;
    do
      l.push(c = /* @__PURE__ */ new Date(+r)), e(r, s), t(r);
    while (c < r && r < o);
    return l;
  }, i.filter = (r) => Et((o) => {
    if (o >= o) for (; t(o), !r(o); ) o.setTime(o - 1);
  }, (o, s) => {
    if (o >= o)
      if (s < 0) for (; ++s <= 0; )
        for (; e(o, -1), !r(o); )
          ;
      else for (; --s >= 0; )
        for (; e(o, 1), !r(o); )
          ;
  }), n && (i.count = (r, o) => (Xa.setTime(+r), Ga.setTime(+o), t(Xa), t(Ga), Math.floor(n(Xa, Ga))), i.every = (r) => (r = Math.floor(r), !isFinite(r) || !(r > 0) ? null : r > 1 ? i.filter(a ? (o) => a(o) % r === 0 : (o) => i.count(0, o) % r === 0) : i)), i;
}
const oa = Et(() => {
}, (t, e) => {
  t.setTime(+t + e);
}, (t, e) => e - t);
oa.every = (t) => (t = Math.floor(t), !isFinite(t) || !(t > 0) ? null : t > 1 ? Et((e) => {
  e.setTime(Math.floor(e / t) * t);
}, (e, n) => {
  e.setTime(+e + n * t);
}, (e, n) => (n - e) / t) : oa);
oa.range;
const fe = 1e3, Wt = fe * 60, he = Wt * 60, ve = he * 24, Fi = ve * 7, _r = ve * 30, Ya = ve * 365, Ce = Et((t) => {
  t.setTime(t - t.getMilliseconds());
}, (t, e) => {
  t.setTime(+t + e * fe);
}, (t, e) => (e - t) / fe, (t) => t.getUTCSeconds());
Ce.range;
const Ni = Et((t) => {
  t.setTime(t - t.getMilliseconds() - t.getSeconds() * fe);
}, (t, e) => {
  t.setTime(+t + e * Wt);
}, (t, e) => (e - t) / Wt, (t) => t.getMinutes());
Ni.range;
const Bi = Et((t) => {
  t.setUTCSeconds(0, 0);
}, (t, e) => {
  t.setTime(+t + e * Wt);
}, (t, e) => (e - t) / Wt, (t) => t.getUTCMinutes());
Bi.range;
const Xi = Et((t) => {
  t.setTime(t - t.getMilliseconds() - t.getSeconds() * fe - t.getMinutes() * Wt);
}, (t, e) => {
  t.setTime(+t + e * he);
}, (t, e) => (e - t) / he, (t) => t.getHours());
Xi.range;
const Gi = Et((t) => {
  t.setUTCMinutes(0, 0, 0);
}, (t, e) => {
  t.setTime(+t + e * he);
}, (t, e) => (e - t) / he, (t) => t.getUTCHours());
Gi.range;
const Pn = Et(
  (t) => t.setHours(0, 0, 0, 0),
  (t, e) => t.setDate(t.getDate() + e),
  (t, e) => (e - t - (e.getTimezoneOffset() - t.getTimezoneOffset()) * Wt) / ve,
  (t) => t.getDate() - 1
);
Pn.range;
const ka = Et((t) => {
  t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCDate(t.getUTCDate() + e);
}, (t, e) => (e - t) / ve, (t) => t.getUTCDate() - 1);
ka.range;
const as = Et((t) => {
  t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCDate(t.getUTCDate() + e);
}, (t, e) => (e - t) / ve, (t) => Math.floor(t / ve));
as.range;
function Pe(t) {
  return Et((e) => {
    e.setDate(e.getDate() - (e.getDay() + 7 - t) % 7), e.setHours(0, 0, 0, 0);
  }, (e, n) => {
    e.setDate(e.getDate() + n * 7);
  }, (e, n) => (n - e - (n.getTimezoneOffset() - e.getTimezoneOffset()) * Wt) / Fi);
}
const Ca = Pe(0), sa = Pe(1), bu = Pe(2), Tu = Pe(3), Qe = Pe(4), $u = Pe(5), wu = Pe(6);
Ca.range;
sa.range;
bu.range;
Tu.range;
Qe.range;
$u.range;
wu.range;
function Oe(t) {
  return Et((e) => {
    e.setUTCDate(e.getUTCDate() - (e.getUTCDay() + 7 - t) % 7), e.setUTCHours(0, 0, 0, 0);
  }, (e, n) => {
    e.setUTCDate(e.getUTCDate() + n * 7);
  }, (e, n) => (n - e) / Fi);
}
const Ra = Oe(0), la = Oe(1), Au = Oe(2), Su = Oe(3), tn = Oe(4), ku = Oe(5), Cu = Oe(6);
Ra.range;
la.range;
Au.range;
Su.range;
tn.range;
ku.range;
Cu.range;
const Yi = Et((t) => {
  t.setDate(1), t.setHours(0, 0, 0, 0);
}, (t, e) => {
  t.setMonth(t.getMonth() + e);
}, (t, e) => e.getMonth() - t.getMonth() + (e.getFullYear() - t.getFullYear()) * 12, (t) => t.getMonth());
Yi.range;
const Vi = Et((t) => {
  t.setUTCDate(1), t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCMonth(t.getUTCMonth() + e);
}, (t, e) => e.getUTCMonth() - t.getUTCMonth() + (e.getUTCFullYear() - t.getUTCFullYear()) * 12, (t) => t.getUTCMonth());
Vi.range;
const ge = Et((t) => {
  t.setMonth(0, 1), t.setHours(0, 0, 0, 0);
}, (t, e) => {
  t.setFullYear(t.getFullYear() + e);
}, (t, e) => e.getFullYear() - t.getFullYear(), (t) => t.getFullYear());
ge.every = (t) => !isFinite(t = Math.floor(t)) || !(t > 0) ? null : Et((e) => {
  e.setFullYear(Math.floor(e.getFullYear() / t) * t), e.setMonth(0, 1), e.setHours(0, 0, 0, 0);
}, (e, n) => {
  e.setFullYear(e.getFullYear() + n * t);
});
ge.range;
const pe = Et((t) => {
  t.setUTCMonth(0, 1), t.setUTCHours(0, 0, 0, 0);
}, (t, e) => {
  t.setUTCFullYear(t.getUTCFullYear() + e);
}, (t, e) => e.getUTCFullYear() - t.getUTCFullYear(), (t) => t.getUTCFullYear());
pe.every = (t) => !isFinite(t = Math.floor(t)) || !(t > 0) ? null : Et((e) => {
  e.setUTCFullYear(Math.floor(e.getUTCFullYear() / t) * t), e.setUTCMonth(0, 1), e.setUTCHours(0, 0, 0, 0);
}, (e, n) => {
  e.setUTCFullYear(e.getUTCFullYear() + n * t);
});
pe.range;
function Zn(t, e) {
  return t == null || e == null ? NaN : t < e ? -1 : t > e ? 1 : t >= e ? 0 : NaN;
}
function Ru(t, e) {
  return t == null || e == null ? NaN : e < t ? -1 : e > t ? 1 : e >= t ? 0 : NaN;
}
function Ui(t) {
  let e, n, a;
  t.length !== 2 ? (e = Zn, n = (s, l) => Zn(t(s), l), a = (s, l) => t(s) - l) : (e = t === Zn || t === Ru ? t : Eu, n = t, a = t);
  function i(s, l, c = 0, u = s.length) {
    if (c < u) {
      if (e(l, l) !== 0) return u;
      do {
        const f = c + u >>> 1;
        n(s[f], l) < 0 ? c = f + 1 : u = f;
      } while (c < u);
    }
    return c;
  }
  function r(s, l, c = 0, u = s.length) {
    if (c < u) {
      if (e(l, l) !== 0) return u;
      do {
        const f = c + u >>> 1;
        n(s[f], l) <= 0 ? c = f + 1 : u = f;
      } while (c < u);
    }
    return c;
  }
  function o(s, l, c = 0, u = s.length) {
    const f = i(s, l, c, u - 1);
    return f > c && a(s[f - 1], l) > -a(s[f], l) ? f - 1 : f;
  }
  return { left: i, center: o, right: r };
}
function Eu() {
  return 0;
}
function Mu(t) {
  return t === null ? NaN : +t;
}
const Lu = Ui(Zn), Du = Lu.right;
Ui(Mu).center;
class xr extends Map {
  constructor(e, n = Pu) {
    if (super(), Object.defineProperties(this, { _intern: { value: /* @__PURE__ */ new Map() }, _key: { value: n } }), e != null) for (const [a, i] of e) this.set(a, i);
  }
  get(e) {
    return super.get(mr(this, e));
  }
  has(e) {
    return super.has(mr(this, e));
  }
  set(e, n) {
    return super.set(Iu(this, e), n);
  }
  delete(e) {
    return super.delete(zu(this, e));
  }
}
function mr({ _intern: t, _key: e }, n) {
  const a = e(n);
  return t.has(a) ? t.get(a) : n;
}
function Iu({ _intern: t, _key: e }, n) {
  const a = e(n);
  return t.has(a) ? t.get(a) : (t.set(a, n), n);
}
function zu({ _intern: t, _key: e }, n) {
  const a = e(n);
  return t.has(a) && (n = t.get(a), t.delete(a)), n;
}
function Pu(t) {
  return t !== null && typeof t == "object" ? t.valueOf() : t;
}
const Ou = Math.sqrt(50), Fu = Math.sqrt(10), Nu = Math.sqrt(2);
function ca(t, e, n) {
  const a = (e - t) / Math.max(0, n), i = Math.floor(Math.log10(a)), r = a / Math.pow(10, i), o = r >= Ou ? 10 : r >= Fu ? 5 : r >= Nu ? 2 : 1;
  let s, l, c;
  return i < 0 ? (c = Math.pow(10, -i) / o, s = Math.round(t * c), l = Math.round(e * c), s / c < t && ++s, l / c > e && --l, c = -c) : (c = Math.pow(10, i) * o, s = Math.round(t / c), l = Math.round(e / c), s * c < t && ++s, l * c > e && --l), l < s && 0.5 <= n && n < 2 ? ca(t, e, n * 2) : [s, l, c];
}
function vi(t, e, n) {
  if (e = +e, t = +t, n = +n, !(n > 0)) return [];
  if (t === e) return [t];
  const a = e < t, [i, r, o] = a ? ca(e, t, n) : ca(t, e, n);
  if (!(r >= i)) return [];
  const s = r - i + 1, l = new Array(s);
  if (a)
    if (o < 0) for (let c = 0; c < s; ++c) l[c] = (r - c) / -o;
    else for (let c = 0; c < s; ++c) l[c] = (r - c) * o;
  else if (o < 0) for (let c = 0; c < s; ++c) l[c] = (i + c) / -o;
  else for (let c = 0; c < s; ++c) l[c] = (i + c) * o;
  return l;
}
function gi(t, e, n) {
  return e = +e, t = +t, n = +n, ca(t, e, n)[2];
}
function pi(t, e, n) {
  e = +e, t = +t, n = +n;
  const a = e < t, i = a ? gi(e, t, n) : gi(t, e, n);
  return (a ? -1 : 1) * (i < 0 ? 1 / -i : i);
}
function is(t, e, n, a, i, r) {
  const o = [
    [Ce, 1, fe],
    [Ce, 5, 5 * fe],
    [Ce, 15, 15 * fe],
    [Ce, 30, 30 * fe],
    [r, 1, Wt],
    [r, 5, 5 * Wt],
    [r, 15, 15 * Wt],
    [r, 30, 30 * Wt],
    [i, 1, he],
    [i, 3, 3 * he],
    [i, 6, 6 * he],
    [i, 12, 12 * he],
    [a, 1, ve],
    [a, 2, 2 * ve],
    [n, 1, Fi],
    [e, 1, _r],
    [e, 3, 3 * _r],
    [t, 1, Ya]
  ];
  function s(c, u, f) {
    const h = u < c;
    h && ([c, u] = [u, c]);
    const d = f && typeof f.range == "function" ? f : l(c, u, f), v = d ? d.range(c, +u + 1) : [];
    return h ? v.reverse() : v;
  }
  function l(c, u, f) {
    const h = Math.abs(u - c) / f, d = Ui(([, , p]) => p).right(o, h);
    if (d === o.length) return t.every(pi(c / Ya, u / Ya, f));
    if (d === 0) return oa.every(Math.max(pi(c, u, f), 1));
    const [v, _] = o[h / o[d - 1][2] < o[d][2] / h ? d - 1 : d];
    return v.every(_);
  }
  return [s, l];
}
const [Bu, Xu] = is(pe, Vi, Ra, as, Gi, Bi), [Gu, Yu] = is(ge, Yi, Ca, Pn, Xi, Ni);
function Va(t) {
  if (0 <= t.y && t.y < 100) {
    var e = new Date(-1, t.m, t.d, t.H, t.M, t.S, t.L);
    return e.setFullYear(t.y), e;
  }
  return new Date(t.y, t.m, t.d, t.H, t.M, t.S, t.L);
}
function Ua(t) {
  if (0 <= t.y && t.y < 100) {
    var e = new Date(Date.UTC(-1, t.m, t.d, t.H, t.M, t.S, t.L));
    return e.setUTCFullYear(t.y), e;
  }
  return new Date(Date.UTC(t.y, t.m, t.d, t.H, t.M, t.S, t.L));
}
function _n(t, e, n) {
  return { y: t, m: e, d: n, H: 0, M: 0, S: 0, L: 0 };
}
function Vu(t) {
  var e = t.dateTime, n = t.date, a = t.time, i = t.periods, r = t.days, o = t.shortDays, s = t.months, l = t.shortMonths, c = xn(i), u = mn(i), f = xn(r), h = mn(r), d = xn(o), v = mn(o), _ = xn(s), p = mn(s), g = xn(l), x = mn(l), y = {
    a: R,
    A: z,
    b: P,
    B: O,
    c: null,
    d: Ar,
    e: Ar,
    f: vf,
    g: wf,
    G: Sf,
    H: ff,
    I: hf,
    j: df,
    L: rs,
    m: gf,
    M: pf,
    p: X,
    q: G,
    Q: Cr,
    s: Rr,
    S: _f,
    u: xf,
    U: mf,
    V: yf,
    w: bf,
    W: Tf,
    x: null,
    X: null,
    y: $f,
    Y: Af,
    Z: kf,
    "%": kr
  }, m = {
    a: ht,
    A: et,
    b: Q,
    B,
    c: null,
    d: Sr,
    e: Sr,
    f: Mf,
    g: Xf,
    G: Yf,
    H: Cf,
    I: Rf,
    j: Ef,
    L: ss,
    m: Lf,
    M: Df,
    p: W,
    q: J,
    Q: Cr,
    s: Rr,
    S: If,
    u: zf,
    U: Pf,
    V: Of,
    w: Ff,
    W: Nf,
    x: null,
    X: null,
    y: Bf,
    Y: Gf,
    Z: Vf,
    "%": kr
  }, T = {
    a: C,
    A: E,
    b: M,
    B: L,
    c: $,
    d: $r,
    e: $r,
    f: sf,
    g: Tr,
    G: br,
    H: wr,
    I: wr,
    j: nf,
    L: of,
    m: ef,
    M: af,
    p: k,
    q: tf,
    Q: cf,
    s: uf,
    S: rf,
    u: qu,
    U: ju,
    V: Ku,
    w: Zu,
    W: Ju,
    x: D,
    X: S,
    y: Tr,
    Y: br,
    Z: Qu,
    "%": lf
  };
  y.x = b(n, y), y.X = b(a, y), y.c = b(e, y), m.x = b(n, m), m.X = b(a, m), m.c = b(e, m);
  function b(F, V) {
    return function(Z) {
      var I = [], ot = -1, it = 0, yt = F.length, bt, H, _t;
      for (Z instanceof Date || (Z = /* @__PURE__ */ new Date(+Z)); ++ot < yt; )
        F.charCodeAt(ot) === 37 && (I.push(F.slice(it, ot)), (H = yr[bt = F.charAt(++ot)]) != null ? bt = F.charAt(++ot) : H = bt === "e" ? " " : "0", (_t = V[bt]) && (bt = _t(Z, H)), I.push(bt), it = ot + 1);
      return I.push(F.slice(it, ot)), I.join("");
    };
  }
  function w(F, V) {
    return function(Z) {
      var I = _n(1900, void 0, 1), ot = A(I, F, Z += "", 0), it, yt;
      if (ot != Z.length) return null;
      if ("Q" in I) return new Date(I.Q);
      if ("s" in I) return new Date(I.s * 1e3 + ("L" in I ? I.L : 0));
      if (V && !("Z" in I) && (I.Z = 0), "p" in I && (I.H = I.H % 12 + I.p * 12), I.m === void 0 && (I.m = "q" in I ? I.q : 0), "V" in I) {
        if (I.V < 1 || I.V > 53) return null;
        "w" in I || (I.w = 1), "Z" in I ? (it = Ua(_n(I.y, 0, 1)), yt = it.getUTCDay(), it = yt > 4 || yt === 0 ? la.ceil(it) : la(it), it = ka.offset(it, (I.V - 1) * 7), I.y = it.getUTCFullYear(), I.m = it.getUTCMonth(), I.d = it.getUTCDate() + (I.w + 6) % 7) : (it = Va(_n(I.y, 0, 1)), yt = it.getDay(), it = yt > 4 || yt === 0 ? sa.ceil(it) : sa(it), it = Pn.offset(it, (I.V - 1) * 7), I.y = it.getFullYear(), I.m = it.getMonth(), I.d = it.getDate() + (I.w + 6) % 7);
      } else ("W" in I || "U" in I) && ("w" in I || (I.w = "u" in I ? I.u % 7 : "W" in I ? 1 : 0), yt = "Z" in I ? Ua(_n(I.y, 0, 1)).getUTCDay() : Va(_n(I.y, 0, 1)).getDay(), I.m = 0, I.d = "W" in I ? (I.w + 6) % 7 + I.W * 7 - (yt + 5) % 7 : I.w + I.U * 7 - (yt + 6) % 7);
      return "Z" in I ? (I.H += I.Z / 100 | 0, I.M += I.Z % 100, Ua(I)) : Va(I);
    };
  }
  function A(F, V, Z, I) {
    for (var ot = 0, it = V.length, yt = Z.length, bt, H; ot < it; ) {
      if (I >= yt) return -1;
      if (bt = V.charCodeAt(ot++), bt === 37) {
        if (bt = V.charAt(ot++), H = T[bt in yr ? V.charAt(ot++) : bt], !H || (I = H(F, Z, I)) < 0) return -1;
      } else if (bt != Z.charCodeAt(I++))
        return -1;
    }
    return I;
  }
  function k(F, V, Z) {
    var I = c.exec(V.slice(Z));
    return I ? (F.p = u.get(I[0].toLowerCase()), Z + I[0].length) : -1;
  }
  function C(F, V, Z) {
    var I = d.exec(V.slice(Z));
    return I ? (F.w = v.get(I[0].toLowerCase()), Z + I[0].length) : -1;
  }
  function E(F, V, Z) {
    var I = f.exec(V.slice(Z));
    return I ? (F.w = h.get(I[0].toLowerCase()), Z + I[0].length) : -1;
  }
  function M(F, V, Z) {
    var I = g.exec(V.slice(Z));
    return I ? (F.m = x.get(I[0].toLowerCase()), Z + I[0].length) : -1;
  }
  function L(F, V, Z) {
    var I = _.exec(V.slice(Z));
    return I ? (F.m = p.get(I[0].toLowerCase()), Z + I[0].length) : -1;
  }
  function $(F, V, Z) {
    return A(F, e, V, Z);
  }
  function D(F, V, Z) {
    return A(F, n, V, Z);
  }
  function S(F, V, Z) {
    return A(F, a, V, Z);
  }
  function R(F) {
    return o[F.getDay()];
  }
  function z(F) {
    return r[F.getDay()];
  }
  function P(F) {
    return l[F.getMonth()];
  }
  function O(F) {
    return s[F.getMonth()];
  }
  function X(F) {
    return i[+(F.getHours() >= 12)];
  }
  function G(F) {
    return 1 + ~~(F.getMonth() / 3);
  }
  function ht(F) {
    return o[F.getUTCDay()];
  }
  function et(F) {
    return r[F.getUTCDay()];
  }
  function Q(F) {
    return l[F.getUTCMonth()];
  }
  function B(F) {
    return s[F.getUTCMonth()];
  }
  function W(F) {
    return i[+(F.getUTCHours() >= 12)];
  }
  function J(F) {
    return 1 + ~~(F.getUTCMonth() / 3);
  }
  return {
    format: function(F) {
      var V = b(F += "", y);
      return V.toString = function() {
        return F;
      }, V;
    },
    parse: function(F) {
      var V = w(F += "", !1);
      return V.toString = function() {
        return F;
      }, V;
    },
    utcFormat: function(F) {
      var V = b(F += "", m);
      return V.toString = function() {
        return F;
      }, V;
    },
    utcParse: function(F) {
      var V = w(F += "", !0);
      return V.toString = function() {
        return F;
      }, V;
    }
  };
}
var yr = { "-": "", _: " ", 0: "0" }, Dt = /^\s*\d+/, Uu = /^%/, Hu = /[\\^$*+?|[\]().{}]/g;
function st(t, e, n) {
  var a = t < 0 ? "-" : "", i = (a ? -t : t) + "", r = i.length;
  return a + (r < n ? new Array(n - r + 1).join(e) + i : i);
}
function Wu(t) {
  return t.replace(Hu, "\\$&");
}
function xn(t) {
  return new RegExp("^(?:" + t.map(Wu).join("|") + ")", "i");
}
function mn(t) {
  return new Map(t.map((e, n) => [e.toLowerCase(), n]));
}
function Zu(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 1));
  return a ? (t.w = +a[0], n + a[0].length) : -1;
}
function qu(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 1));
  return a ? (t.u = +a[0], n + a[0].length) : -1;
}
function ju(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.U = +a[0], n + a[0].length) : -1;
}
function Ku(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.V = +a[0], n + a[0].length) : -1;
}
function Ju(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.W = +a[0], n + a[0].length) : -1;
}
function br(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 4));
  return a ? (t.y = +a[0], n + a[0].length) : -1;
}
function Tr(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.y = +a[0] + (+a[0] > 68 ? 1900 : 2e3), n + a[0].length) : -1;
}
function Qu(t, e, n) {
  var a = /^(Z)|([+-]\d\d)(?::?(\d\d))?/.exec(e.slice(n, n + 6));
  return a ? (t.Z = a[1] ? 0 : -(a[2] + (a[3] || "00")), n + a[0].length) : -1;
}
function tf(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 1));
  return a ? (t.q = a[0] * 3 - 3, n + a[0].length) : -1;
}
function ef(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.m = a[0] - 1, n + a[0].length) : -1;
}
function $r(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.d = +a[0], n + a[0].length) : -1;
}
function nf(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 3));
  return a ? (t.m = 0, t.d = +a[0], n + a[0].length) : -1;
}
function wr(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.H = +a[0], n + a[0].length) : -1;
}
function af(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.M = +a[0], n + a[0].length) : -1;
}
function rf(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 2));
  return a ? (t.S = +a[0], n + a[0].length) : -1;
}
function of(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 3));
  return a ? (t.L = +a[0], n + a[0].length) : -1;
}
function sf(t, e, n) {
  var a = Dt.exec(e.slice(n, n + 6));
  return a ? (t.L = Math.floor(a[0] / 1e3), n + a[0].length) : -1;
}
function lf(t, e, n) {
  var a = Uu.exec(e.slice(n, n + 1));
  return a ? n + a[0].length : -1;
}
function cf(t, e, n) {
  var a = Dt.exec(e.slice(n));
  return a ? (t.Q = +a[0], n + a[0].length) : -1;
}
function uf(t, e, n) {
  var a = Dt.exec(e.slice(n));
  return a ? (t.s = +a[0], n + a[0].length) : -1;
}
function Ar(t, e) {
  return st(t.getDate(), e, 2);
}
function ff(t, e) {
  return st(t.getHours(), e, 2);
}
function hf(t, e) {
  return st(t.getHours() % 12 || 12, e, 2);
}
function df(t, e) {
  return st(1 + Pn.count(ge(t), t), e, 3);
}
function rs(t, e) {
  return st(t.getMilliseconds(), e, 3);
}
function vf(t, e) {
  return rs(t, e) + "000";
}
function gf(t, e) {
  return st(t.getMonth() + 1, e, 2);
}
function pf(t, e) {
  return st(t.getMinutes(), e, 2);
}
function _f(t, e) {
  return st(t.getSeconds(), e, 2);
}
function xf(t) {
  var e = t.getDay();
  return e === 0 ? 7 : e;
}
function mf(t, e) {
  return st(Ca.count(ge(t) - 1, t), e, 2);
}
function os(t) {
  var e = t.getDay();
  return e >= 4 || e === 0 ? Qe(t) : Qe.ceil(t);
}
function yf(t, e) {
  return t = os(t), st(Qe.count(ge(t), t) + (ge(t).getDay() === 4), e, 2);
}
function bf(t) {
  return t.getDay();
}
function Tf(t, e) {
  return st(sa.count(ge(t) - 1, t), e, 2);
}
function $f(t, e) {
  return st(t.getFullYear() % 100, e, 2);
}
function wf(t, e) {
  return t = os(t), st(t.getFullYear() % 100, e, 2);
}
function Af(t, e) {
  return st(t.getFullYear() % 1e4, e, 4);
}
function Sf(t, e) {
  var n = t.getDay();
  return t = n >= 4 || n === 0 ? Qe(t) : Qe.ceil(t), st(t.getFullYear() % 1e4, e, 4);
}
function kf(t) {
  var e = t.getTimezoneOffset();
  return (e > 0 ? "-" : (e *= -1, "+")) + st(e / 60 | 0, "0", 2) + st(e % 60, "0", 2);
}
function Sr(t, e) {
  return st(t.getUTCDate(), e, 2);
}
function Cf(t, e) {
  return st(t.getUTCHours(), e, 2);
}
function Rf(t, e) {
  return st(t.getUTCHours() % 12 || 12, e, 2);
}
function Ef(t, e) {
  return st(1 + ka.count(pe(t), t), e, 3);
}
function ss(t, e) {
  return st(t.getUTCMilliseconds(), e, 3);
}
function Mf(t, e) {
  return ss(t, e) + "000";
}
function Lf(t, e) {
  return st(t.getUTCMonth() + 1, e, 2);
}
function Df(t, e) {
  return st(t.getUTCMinutes(), e, 2);
}
function If(t, e) {
  return st(t.getUTCSeconds(), e, 2);
}
function zf(t) {
  var e = t.getUTCDay();
  return e === 0 ? 7 : e;
}
function Pf(t, e) {
  return st(Ra.count(pe(t) - 1, t), e, 2);
}
function ls(t) {
  var e = t.getUTCDay();
  return e >= 4 || e === 0 ? tn(t) : tn.ceil(t);
}
function Of(t, e) {
  return t = ls(t), st(tn.count(pe(t), t) + (pe(t).getUTCDay() === 4), e, 2);
}
function Ff(t) {
  return t.getUTCDay();
}
function Nf(t, e) {
  return st(la.count(pe(t) - 1, t), e, 2);
}
function Bf(t, e) {
  return st(t.getUTCFullYear() % 100, e, 2);
}
function Xf(t, e) {
  return t = ls(t), st(t.getUTCFullYear() % 100, e, 2);
}
function Gf(t, e) {
  return st(t.getUTCFullYear() % 1e4, e, 4);
}
function Yf(t, e) {
  var n = t.getUTCDay();
  return t = n >= 4 || n === 0 ? tn(t) : tn.ceil(t), st(t.getUTCFullYear() % 1e4, e, 4);
}
function Vf() {
  return "+0000";
}
function kr() {
  return "%";
}
function Cr(t) {
  return +t;
}
function Rr(t) {
  return Math.floor(+t / 1e3);
}
var Xe, Hi, cs, Wi, us;
Uf({
  dateTime: "%x, %X",
  date: "%-m/%-d/%Y",
  time: "%-I:%M:%S %p",
  periods: ["AM", "PM"],
  days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  shortDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  shortMonths: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
});
function Uf(t) {
  return Xe = Vu(t), Hi = Xe.format, cs = Xe.parse, Wi = Xe.utcFormat, us = Xe.utcParse, Xe;
}
var Hf = { value: () => {
} };
function On() {
  for (var t = 0, e = arguments.length, n = {}, a; t < e; ++t) {
    if (!(a = arguments[t] + "") || a in n || /[\s.]/.test(a)) throw new Error("illegal type: " + a);
    n[a] = [];
  }
  return new qn(n);
}
function qn(t) {
  this._ = t;
}
function Wf(t, e) {
  return t.trim().split(/^|\s+/).map(function(n) {
    var a = "", i = n.indexOf(".");
    if (i >= 0 && (a = n.slice(i + 1), n = n.slice(0, i)), n && !e.hasOwnProperty(n)) throw new Error("unknown type: " + n);
    return { type: n, name: a };
  });
}
qn.prototype = On.prototype = {
  constructor: qn,
  on: function(t, e) {
    var n = this._, a = Wf(t + "", n), i, r = -1, o = a.length;
    if (arguments.length < 2) {
      for (; ++r < o; ) if ((i = (t = a[r]).type) && (i = Zf(n[i], t.name))) return i;
      return;
    }
    if (e != null && typeof e != "function") throw new Error("invalid callback: " + e);
    for (; ++r < o; )
      if (i = (t = a[r]).type) n[i] = Er(n[i], t.name, e);
      else if (e == null) for (i in n) n[i] = Er(n[i], t.name, null);
    return this;
  },
  copy: function() {
    var t = {}, e = this._;
    for (var n in e) t[n] = e[n].slice();
    return new qn(t);
  },
  call: function(t, e) {
    if ((i = arguments.length - 2) > 0) for (var n = new Array(i), a = 0, i, r; a < i; ++a) n[a] = arguments[a + 2];
    if (!this._.hasOwnProperty(t)) throw new Error("unknown type: " + t);
    for (r = this._[t], a = 0, i = r.length; a < i; ++a) r[a].value.apply(e, n);
  },
  apply: function(t, e, n) {
    if (!this._.hasOwnProperty(t)) throw new Error("unknown type: " + t);
    for (var a = this._[t], i = 0, r = a.length; i < r; ++i) a[i].value.apply(e, n);
  }
};
function Zf(t, e) {
  for (var n = 0, a = t.length, i; n < a; ++n)
    if ((i = t[n]).name === e)
      return i.value;
}
function Er(t, e, n) {
  for (var a = 0, i = t.length; a < i; ++a)
    if (t[a].name === e) {
      t[a] = Hf, t = t.slice(0, a).concat(t.slice(a + 1));
      break;
    }
  return n != null && t.push({ name: e, value: n }), t;
}
const qf = { passive: !1 }, Rn = { capture: !0, passive: !1 };
function Ha(t) {
  t.stopImmediatePropagation();
}
function Ze(t) {
  t.preventDefault(), t.stopImmediatePropagation();
}
function Zi(t) {
  var e = t.document.documentElement, n = N(t).on("dragstart.drag", Ze, Rn);
  "onselectstart" in e ? n.on("selectstart.drag", Ze, Rn) : (e.__noselect = e.style.MozUserSelect, e.style.MozUserSelect = "none");
}
function qi(t, e) {
  var n = t.document.documentElement, a = N(t).on("dragstart.drag", null);
  e && (a.on("click.drag", Ze, Rn), setTimeout(function() {
    a.on("click.drag", null);
  }, 0)), "onselectstart" in n ? a.on("selectstart.drag", null) : (n.style.MozUserSelect = n.__noselect, delete n.__noselect);
}
const Bn = (t) => () => t;
function _i(t, {
  sourceEvent: e,
  subject: n,
  target: a,
  identifier: i,
  active: r,
  x: o,
  y: s,
  dx: l,
  dy: c,
  dispatch: u
}) {
  Object.defineProperties(this, {
    type: { value: t, enumerable: !0, configurable: !0 },
    sourceEvent: { value: e, enumerable: !0, configurable: !0 },
    subject: { value: n, enumerable: !0, configurable: !0 },
    target: { value: a, enumerable: !0, configurable: !0 },
    identifier: { value: i, enumerable: !0, configurable: !0 },
    active: { value: r, enumerable: !0, configurable: !0 },
    x: { value: o, enumerable: !0, configurable: !0 },
    y: { value: s, enumerable: !0, configurable: !0 },
    dx: { value: l, enumerable: !0, configurable: !0 },
    dy: { value: c, enumerable: !0, configurable: !0 },
    _: { value: u }
  });
}
_i.prototype.on = function() {
  var t = this._.on.apply(this._, arguments);
  return t === this._ ? this : t;
};
function jf(t) {
  return !t.ctrlKey && !t.button;
}
function Kf() {
  return this.parentNode;
}
function Jf(t, e) {
  return e ?? { x: t.x, y: t.y };
}
function Qf() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function fs() {
  var t = jf, e = Kf, n = Jf, a = Qf, i = {}, r = On("start", "drag", "end"), o = 0, s, l, c, u, f = 0;
  function h(m) {
    m.on("mousedown.drag", d).filter(a).on("touchstart.drag", p).on("touchmove.drag", g, qf).on("touchend.drag touchcancel.drag", x).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  function d(m, T) {
    if (!(u || !t.call(this, m, T))) {
      var b = y(this, e.call(this, m, T), m, T, "mouse");
      b && (N(m.view).on("mousemove.drag", v, Rn).on("mouseup.drag", _, Rn), Zi(m.view), Ha(m), c = !1, s = m.clientX, l = m.clientY, b("start", m));
    }
  }
  function v(m) {
    if (Ze(m), !c) {
      var T = m.clientX - s, b = m.clientY - l;
      c = T * T + b * b > f;
    }
    i.mouse("drag", m);
  }
  function _(m) {
    N(m.view).on("mousemove.drag mouseup.drag", null), qi(m.view, c), Ze(m), i.mouse("end", m);
  }
  function p(m, T) {
    if (t.call(this, m, T)) {
      var b = m.changedTouches, w = e.call(this, m, T), A = b.length, k, C;
      for (k = 0; k < A; ++k)
        (C = y(this, w, m, T, b[k].identifier, b[k])) && (Ha(m), C("start", m, b[k]));
    }
  }
  function g(m) {
    var T = m.changedTouches, b = T.length, w, A;
    for (w = 0; w < b; ++w)
      (A = i[T[w].identifier]) && (Ze(m), A("drag", m, T[w]));
  }
  function x(m) {
    var T = m.changedTouches, b = T.length, w, A;
    for (u && clearTimeout(u), u = setTimeout(function() {
      u = null;
    }, 500), w = 0; w < b; ++w)
      (A = i[T[w].identifier]) && (Ha(m), A("end", m, T[w]));
  }
  function y(m, T, b, w, A, k) {
    var C = r.copy(), E = Ht(k || b, T), M, L, $;
    if (($ = n.call(m, new _i("beforestart", {
      sourceEvent: b,
      target: h,
      identifier: A,
      active: o,
      x: E[0],
      y: E[1],
      dx: 0,
      dy: 0,
      dispatch: C
    }), w)) != null)
      return M = $.x - E[0] || 0, L = $.y - E[1] || 0, function D(S, R, z) {
        var P = E, O;
        switch (S) {
          case "start":
            i[A] = D, O = o++;
            break;
          case "end":
            delete i[A], --o;
          // falls through
          case "drag":
            E = Ht(z || R, T), O = o;
            break;
        }
        C.call(
          S,
          m,
          new _i(S, {
            sourceEvent: R,
            subject: $,
            target: h,
            identifier: A,
            active: O,
            x: E[0] + M,
            y: E[1] + L,
            dx: E[0] - P[0],
            dy: E[1] - P[1],
            dispatch: C
          }),
          w
        );
      };
  }
  return h.filter = function(m) {
    return arguments.length ? (t = typeof m == "function" ? m : Bn(!!m), h) : t;
  }, h.container = function(m) {
    return arguments.length ? (e = typeof m == "function" ? m : Bn(m), h) : e;
  }, h.subject = function(m) {
    return arguments.length ? (n = typeof m == "function" ? m : Bn(m), h) : n;
  }, h.touchable = function(m) {
    return arguments.length ? (a = typeof m == "function" ? m : Bn(!!m), h) : a;
  }, h.on = function() {
    var m = r.on.apply(r, arguments);
    return m === r ? h : m;
  }, h.clickDistance = function(m) {
    return arguments.length ? (f = (m = +m) * m, h) : Math.sqrt(f);
  }, h;
}
function ji(t, e, n) {
  t.prototype = e.prototype = n, n.constructor = t;
}
function hs(t, e) {
  var n = Object.create(t.prototype);
  for (var a in e) n[a] = e[a];
  return n;
}
function Fn() {
}
var En = 0.7, ua = 1 / En, qe = "\\s*([+-]?\\d+)\\s*", Mn = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*", ie = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*", th = /^#([0-9a-f]{3,8})$/, eh = new RegExp(`^rgb\\(${qe},${qe},${qe}\\)$`), nh = new RegExp(`^rgb\\(${ie},${ie},${ie}\\)$`), ah = new RegExp(`^rgba\\(${qe},${qe},${qe},${Mn}\\)$`), ih = new RegExp(`^rgba\\(${ie},${ie},${ie},${Mn}\\)$`), rh = new RegExp(`^hsl\\(${Mn},${ie},${ie}\\)$`), oh = new RegExp(`^hsla\\(${Mn},${ie},${ie},${Mn}\\)$`), Mr = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
ji(Fn, Le, {
  copy(t) {
    return Object.assign(new this.constructor(), this, t);
  },
  displayable() {
    return this.rgb().displayable();
  },
  hex: Lr,
  // Deprecated! Use color.formatHex.
  formatHex: Lr,
  formatHex8: sh,
  formatHsl: lh,
  formatRgb: Dr,
  toString: Dr
});
function Lr() {
  return this.rgb().formatHex();
}
function sh() {
  return this.rgb().formatHex8();
}
function lh() {
  return ds(this).formatHsl();
}
function Dr() {
  return this.rgb().formatRgb();
}
function Le(t) {
  var e, n;
  return t = (t + "").trim().toLowerCase(), (e = th.exec(t)) ? (n = e[1].length, e = parseInt(e[1], 16), n === 6 ? Ir(e) : n === 3 ? new Gt(e >> 8 & 15 | e >> 4 & 240, e >> 4 & 15 | e & 240, (e & 15) << 4 | e & 15, 1) : n === 8 ? Xn(e >> 24 & 255, e >> 16 & 255, e >> 8 & 255, (e & 255) / 255) : n === 4 ? Xn(e >> 12 & 15 | e >> 8 & 240, e >> 8 & 15 | e >> 4 & 240, e >> 4 & 15 | e & 240, ((e & 15) << 4 | e & 15) / 255) : null) : (e = eh.exec(t)) ? new Gt(e[1], e[2], e[3], 1) : (e = nh.exec(t)) ? new Gt(e[1] * 255 / 100, e[2] * 255 / 100, e[3] * 255 / 100, 1) : (e = ah.exec(t)) ? Xn(e[1], e[2], e[3], e[4]) : (e = ih.exec(t)) ? Xn(e[1] * 255 / 100, e[2] * 255 / 100, e[3] * 255 / 100, e[4]) : (e = rh.exec(t)) ? Or(e[1], e[2] / 100, e[3] / 100, 1) : (e = oh.exec(t)) ? Or(e[1], e[2] / 100, e[3] / 100, e[4]) : Mr.hasOwnProperty(t) ? Ir(Mr[t]) : t === "transparent" ? new Gt(NaN, NaN, NaN, 0) : null;
}
function Ir(t) {
  return new Gt(t >> 16 & 255, t >> 8 & 255, t & 255, 1);
}
function Xn(t, e, n, a) {
  return a <= 0 && (t = e = n = NaN), new Gt(t, e, n, a);
}
function ch(t) {
  return t instanceof Fn || (t = Le(t)), t ? (t = t.rgb(), new Gt(t.r, t.g, t.b, t.opacity)) : new Gt();
}
function xi(t, e, n, a) {
  return arguments.length === 1 ? ch(t) : new Gt(t, e, n, a ?? 1);
}
function Gt(t, e, n, a) {
  this.r = +t, this.g = +e, this.b = +n, this.opacity = +a;
}
ji(Gt, xi, hs(Fn, {
  brighter(t) {
    return t = t == null ? ua : Math.pow(ua, t), new Gt(this.r * t, this.g * t, this.b * t, this.opacity);
  },
  darker(t) {
    return t = t == null ? En : Math.pow(En, t), new Gt(this.r * t, this.g * t, this.b * t, this.opacity);
  },
  rgb() {
    return this;
  },
  clamp() {
    return new Gt(Ee(this.r), Ee(this.g), Ee(this.b), fa(this.opacity));
  },
  displayable() {
    return -0.5 <= this.r && this.r < 255.5 && -0.5 <= this.g && this.g < 255.5 && -0.5 <= this.b && this.b < 255.5 && 0 <= this.opacity && this.opacity <= 1;
  },
  hex: zr,
  // Deprecated! Use color.formatHex.
  formatHex: zr,
  formatHex8: uh,
  formatRgb: Pr,
  toString: Pr
}));
function zr() {
  return `#${Re(this.r)}${Re(this.g)}${Re(this.b)}`;
}
function uh() {
  return `#${Re(this.r)}${Re(this.g)}${Re(this.b)}${Re((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}
function Pr() {
  const t = fa(this.opacity);
  return `${t === 1 ? "rgb(" : "rgba("}${Ee(this.r)}, ${Ee(this.g)}, ${Ee(this.b)}${t === 1 ? ")" : `, ${t})`}`;
}
function fa(t) {
  return isNaN(t) ? 1 : Math.max(0, Math.min(1, t));
}
function Ee(t) {
  return Math.max(0, Math.min(255, Math.round(t) || 0));
}
function Re(t) {
  return t = Ee(t), (t < 16 ? "0" : "") + t.toString(16);
}
function Or(t, e, n, a) {
  return a <= 0 ? t = e = n = NaN : n <= 0 || n >= 1 ? t = e = NaN : e <= 0 && (t = NaN), new te(t, e, n, a);
}
function ds(t) {
  if (t instanceof te) return new te(t.h, t.s, t.l, t.opacity);
  if (t instanceof Fn || (t = Le(t)), !t) return new te();
  if (t instanceof te) return t;
  t = t.rgb();
  var e = t.r / 255, n = t.g / 255, a = t.b / 255, i = Math.min(e, n, a), r = Math.max(e, n, a), o = NaN, s = r - i, l = (r + i) / 2;
  return s ? (e === r ? o = (n - a) / s + (n < a) * 6 : n === r ? o = (a - e) / s + 2 : o = (e - n) / s + 4, s /= l < 0.5 ? r + i : 2 - r - i, o *= 60) : s = l > 0 && l < 1 ? 0 : o, new te(o, s, l, t.opacity);
}
function fh(t, e, n, a) {
  return arguments.length === 1 ? ds(t) : new te(t, e, n, a ?? 1);
}
function te(t, e, n, a) {
  this.h = +t, this.s = +e, this.l = +n, this.opacity = +a;
}
ji(te, fh, hs(Fn, {
  brighter(t) {
    return t = t == null ? ua : Math.pow(ua, t), new te(this.h, this.s, this.l * t, this.opacity);
  },
  darker(t) {
    return t = t == null ? En : Math.pow(En, t), new te(this.h, this.s, this.l * t, this.opacity);
  },
  rgb() {
    var t = this.h % 360 + (this.h < 0) * 360, e = isNaN(t) || isNaN(this.s) ? 0 : this.s, n = this.l, a = n + (n < 0.5 ? n : 1 - n) * e, i = 2 * n - a;
    return new Gt(
      Wa(t >= 240 ? t - 240 : t + 120, i, a),
      Wa(t, i, a),
      Wa(t < 120 ? t + 240 : t - 120, i, a),
      this.opacity
    );
  },
  clamp() {
    return new te(Fr(this.h), Gn(this.s), Gn(this.l), fa(this.opacity));
  },
  displayable() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && 0 <= this.l && this.l <= 1 && 0 <= this.opacity && this.opacity <= 1;
  },
  formatHsl() {
    const t = fa(this.opacity);
    return `${t === 1 ? "hsl(" : "hsla("}${Fr(this.h)}, ${Gn(this.s) * 100}%, ${Gn(this.l) * 100}%${t === 1 ? ")" : `, ${t})`}`;
  }
}));
function Fr(t) {
  return t = (t || 0) % 360, t < 0 ? t + 360 : t;
}
function Gn(t) {
  return Math.max(0, Math.min(1, t || 0));
}
function Wa(t, e, n) {
  return (t < 60 ? e + (n - e) * t / 60 : t < 180 ? n : t < 240 ? e + (n - e) * (240 - t) / 60 : e) * 255;
}
const Ki = (t) => () => t;
function hh(t, e) {
  return function(n) {
    return t + n * e;
  };
}
function dh(t, e, n) {
  return t = Math.pow(t, n), e = Math.pow(e, n) - t, n = 1 / n, function(a) {
    return Math.pow(t + a * e, n);
  };
}
function vh(t) {
  return (t = +t) == 1 ? vs : function(e, n) {
    return n - e ? dh(e, n, t) : Ki(isNaN(e) ? n : e);
  };
}
function vs(t, e) {
  var n = e - t;
  return n ? hh(t, n) : Ki(isNaN(t) ? e : t);
}
const ha = (function t(e) {
  var n = vh(e);
  function a(i, r) {
    var o = n((i = xi(i)).r, (r = xi(r)).r), s = n(i.g, r.g), l = n(i.b, r.b), c = vs(i.opacity, r.opacity);
    return function(u) {
      return i.r = o(u), i.g = s(u), i.b = l(u), i.opacity = c(u), i + "";
    };
  }
  return a.gamma = t, a;
})(1);
function gh(t, e) {
  e || (e = []);
  var n = t ? Math.min(e.length, t.length) : 0, a = e.slice(), i;
  return function(r) {
    for (i = 0; i < n; ++i) a[i] = t[i] * (1 - r) + e[i] * r;
    return a;
  };
}
function ph(t) {
  return ArrayBuffer.isView(t) && !(t instanceof DataView);
}
function _h(t, e) {
  var n = e ? e.length : 0, a = t ? Math.min(n, t.length) : 0, i = new Array(a), r = new Array(n), o;
  for (o = 0; o < a; ++o) i[o] = ln(t[o], e[o]);
  for (; o < n; ++o) r[o] = e[o];
  return function(s) {
    for (o = 0; o < a; ++o) r[o] = i[o](s);
    return r;
  };
}
function xh(t, e) {
  var n = /* @__PURE__ */ new Date();
  return t = +t, e = +e, function(a) {
    return n.setTime(t * (1 - a) + e * a), n;
  };
}
function Jt(t, e) {
  return t = +t, e = +e, function(n) {
    return t * (1 - n) + e * n;
  };
}
function mh(t, e) {
  var n = {}, a = {}, i;
  (t === null || typeof t != "object") && (t = {}), (e === null || typeof e != "object") && (e = {});
  for (i in e)
    i in t ? n[i] = ln(t[i], e[i]) : a[i] = e[i];
  return function(r) {
    for (i in n) a[i] = n[i](r);
    return a;
  };
}
var mi = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g, Za = new RegExp(mi.source, "g");
function yh(t) {
  return function() {
    return t;
  };
}
function bh(t) {
  return function(e) {
    return t(e) + "";
  };
}
function gs(t, e) {
  var n = mi.lastIndex = Za.lastIndex = 0, a, i, r, o = -1, s = [], l = [];
  for (t = t + "", e = e + ""; (a = mi.exec(t)) && (i = Za.exec(e)); )
    (r = i.index) > n && (r = e.slice(n, r), s[o] ? s[o] += r : s[++o] = r), (a = a[0]) === (i = i[0]) ? s[o] ? s[o] += i : s[++o] = i : (s[++o] = null, l.push({ i: o, x: Jt(a, i) })), n = Za.lastIndex;
  return n < e.length && (r = e.slice(n), s[o] ? s[o] += r : s[++o] = r), s.length < 2 ? l[0] ? bh(l[0].x) : yh(e) : (e = l.length, function(c) {
    for (var u = 0, f; u < e; ++u) s[(f = l[u]).i] = f.x(c);
    return s.join("");
  });
}
function ln(t, e) {
  var n = typeof e, a;
  return e == null || n === "boolean" ? Ki(e) : (n === "number" ? Jt : n === "string" ? (a = Le(e)) ? (e = a, ha) : gs : e instanceof Le ? ha : e instanceof Date ? xh : ph(e) ? gh : Array.isArray(e) ? _h : typeof e.valueOf != "function" && typeof e.toString != "function" || isNaN(e) ? mh : Jt)(t, e);
}
function Th(t, e) {
  return t = +t, e = +e, function(n) {
    return Math.round(t * (1 - n) + e * n);
  };
}
var Nr = 180 / Math.PI, yi = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  skewX: 0,
  scaleX: 1,
  scaleY: 1
};
function ps(t, e, n, a, i, r) {
  var o, s, l;
  return (o = Math.sqrt(t * t + e * e)) && (t /= o, e /= o), (l = t * n + e * a) && (n -= t * l, a -= e * l), (s = Math.sqrt(n * n + a * a)) && (n /= s, a /= s, l /= s), t * a < e * n && (t = -t, e = -e, l = -l, o = -o), {
    translateX: i,
    translateY: r,
    rotate: Math.atan2(e, t) * Nr,
    skewX: Math.atan(l) * Nr,
    scaleX: o,
    scaleY: s
  };
}
var Yn;
function $h(t) {
  const e = new (typeof DOMMatrix == "function" ? DOMMatrix : WebKitCSSMatrix)(t + "");
  return e.isIdentity ? yi : ps(e.a, e.b, e.c, e.d, e.e, e.f);
}
function wh(t) {
  return t == null || (Yn || (Yn = document.createElementNS("http://www.w3.org/2000/svg", "g")), Yn.setAttribute("transform", t), !(t = Yn.transform.baseVal.consolidate())) ? yi : (t = t.matrix, ps(t.a, t.b, t.c, t.d, t.e, t.f));
}
function _s(t, e, n, a) {
  function i(c) {
    return c.length ? c.pop() + " " : "";
  }
  function r(c, u, f, h, d, v) {
    if (c !== f || u !== h) {
      var _ = d.push("translate(", null, e, null, n);
      v.push({ i: _ - 4, x: Jt(c, f) }, { i: _ - 2, x: Jt(u, h) });
    } else (f || h) && d.push("translate(" + f + e + h + n);
  }
  function o(c, u, f, h) {
    c !== u ? (c - u > 180 ? u += 360 : u - c > 180 && (c += 360), h.push({ i: f.push(i(f) + "rotate(", null, a) - 2, x: Jt(c, u) })) : u && f.push(i(f) + "rotate(" + u + a);
  }
  function s(c, u, f, h) {
    c !== u ? h.push({ i: f.push(i(f) + "skewX(", null, a) - 2, x: Jt(c, u) }) : u && f.push(i(f) + "skewX(" + u + a);
  }
  function l(c, u, f, h, d, v) {
    if (c !== f || u !== h) {
      var _ = d.push(i(d) + "scale(", null, ",", null, ")");
      v.push({ i: _ - 4, x: Jt(c, f) }, { i: _ - 2, x: Jt(u, h) });
    } else (f !== 1 || h !== 1) && d.push(i(d) + "scale(" + f + "," + h + ")");
  }
  return function(c, u) {
    var f = [], h = [];
    return c = t(c), u = t(u), r(c.translateX, c.translateY, u.translateX, u.translateY, f, h), o(c.rotate, u.rotate, f, h), s(c.skewX, u.skewX, f, h), l(c.scaleX, c.scaleY, u.scaleX, u.scaleY, f, h), c = u = null, function(d) {
      for (var v = -1, _ = h.length, p; ++v < _; ) f[(p = h[v]).i] = p.x(d);
      return f.join("");
    };
  };
}
var Ah = _s($h, "px, ", "px)", "deg)"), Sh = _s(wh, ", ", ")", ")"), kh = 1e-12;
function Br(t) {
  return ((t = Math.exp(t)) + 1 / t) / 2;
}
function Ch(t) {
  return ((t = Math.exp(t)) - 1 / t) / 2;
}
function Rh(t) {
  return ((t = Math.exp(2 * t)) - 1) / (t + 1);
}
const Eh = (function t(e, n, a) {
  function i(r, o) {
    var s = r[0], l = r[1], c = r[2], u = o[0], f = o[1], h = o[2], d = u - s, v = f - l, _ = d * d + v * v, p, g;
    if (_ < kh)
      g = Math.log(h / c) / e, p = function(w) {
        return [
          s + w * d,
          l + w * v,
          c * Math.exp(e * w * g)
        ];
      };
    else {
      var x = Math.sqrt(_), y = (h * h - c * c + a * _) / (2 * c * n * x), m = (h * h - c * c - a * _) / (2 * h * n * x), T = Math.log(Math.sqrt(y * y + 1) - y), b = Math.log(Math.sqrt(m * m + 1) - m);
      g = (b - T) / e, p = function(w) {
        var A = w * g, k = Br(T), C = c / (n * x) * (k * Rh(e * A + T) - Ch(T));
        return [
          s + C * d,
          l + C * v,
          c * k / Br(e * A + T)
        ];
      };
    }
    return p.duration = g * 1e3 * e / Math.SQRT2, p;
  }
  return i.rho = function(r) {
    var o = Math.max(1e-3, +r), s = o * o, l = s * s;
    return t(o, s, l);
  }, i;
})(Math.SQRT2, 2, 4);
var en = 0, An = 0, yn = 0, xs = 1e3, da, Sn, va = 0, De = 0, Ea = 0, Ln = typeof performance == "object" && performance.now ? performance : Date, ms = typeof window == "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(t) {
  setTimeout(t, 17);
};
function Ji() {
  return De || (ms(Mh), De = Ln.now() + Ea);
}
function Mh() {
  De = 0;
}
function ga() {
  this._call = this._time = this._next = null;
}
ga.prototype = ys.prototype = {
  constructor: ga,
  restart: function(t, e, n) {
    if (typeof t != "function") throw new TypeError("callback is not a function");
    n = (n == null ? Ji() : +n) + (e == null ? 0 : +e), !this._next && Sn !== this && (Sn ? Sn._next = this : da = this, Sn = this), this._call = t, this._time = n, bi();
  },
  stop: function() {
    this._call && (this._call = null, this._time = 1 / 0, bi());
  }
};
function ys(t, e, n) {
  var a = new ga();
  return a.restart(t, e, n), a;
}
function Lh() {
  Ji(), ++en;
  for (var t = da, e; t; )
    (e = De - t._time) >= 0 && t._call.call(void 0, e), t = t._next;
  --en;
}
function Xr() {
  De = (va = Ln.now()) + Ea, en = An = 0;
  try {
    Lh();
  } finally {
    en = 0, Ih(), De = 0;
  }
}
function Dh() {
  var t = Ln.now(), e = t - va;
  e > xs && (Ea -= e, va = t);
}
function Ih() {
  for (var t, e = da, n, a = 1 / 0; e; )
    e._call ? (a > e._time && (a = e._time), t = e, e = e._next) : (n = e._next, e._next = null, e = t ? t._next = n : da = n);
  Sn = t, bi(a);
}
function bi(t) {
  if (!en) {
    An && (An = clearTimeout(An));
    var e = t - De;
    e > 24 ? (t < 1 / 0 && (An = setTimeout(Xr, t - Ln.now() - Ea)), yn && (yn = clearInterval(yn))) : (yn || (va = Ln.now(), yn = setInterval(Dh, xs)), en = 1, ms(Xr));
  }
}
function Gr(t, e, n) {
  var a = new ga();
  return e = e == null ? 0 : +e, a.restart((i) => {
    a.stop(), t(i + e);
  }, e, n), a;
}
var zh = On("start", "end", "cancel", "interrupt"), Ph = [], bs = 0, Yr = 1, Ti = 2, jn = 3, Vr = 4, $i = 5, Kn = 6;
function Ma(t, e, n, a, i, r) {
  var o = t.__transition;
  if (!o) t.__transition = {};
  else if (n in o) return;
  Oh(t, n, {
    name: e,
    index: a,
    // For context during callback.
    group: i,
    // For context during callback.
    on: zh,
    tween: Ph,
    time: r.time,
    delay: r.delay,
    duration: r.duration,
    ease: r.ease,
    timer: null,
    state: bs
  });
}
function Qi(t, e) {
  var n = ee(t, e);
  if (n.state > bs) throw new Error("too late; already scheduled");
  return n;
}
function oe(t, e) {
  var n = ee(t, e);
  if (n.state > jn) throw new Error("too late; already running");
  return n;
}
function ee(t, e) {
  var n = t.__transition;
  if (!n || !(n = n[e])) throw new Error("transition not found");
  return n;
}
function Oh(t, e, n) {
  var a = t.__transition, i;
  a[e] = n, n.timer = ys(r, 0, n.time);
  function r(c) {
    n.state = Yr, n.timer.restart(o, n.delay, n.time), n.delay <= c && o(c - n.delay);
  }
  function o(c) {
    var u, f, h, d;
    if (n.state !== Yr) return l();
    for (u in a)
      if (d = a[u], d.name === n.name) {
        if (d.state === jn) return Gr(o);
        d.state === Vr ? (d.state = Kn, d.timer.stop(), d.on.call("interrupt", t, t.__data__, d.index, d.group), delete a[u]) : +u < e && (d.state = Kn, d.timer.stop(), d.on.call("cancel", t, t.__data__, d.index, d.group), delete a[u]);
      }
    if (Gr(function() {
      n.state === jn && (n.state = Vr, n.timer.restart(s, n.delay, n.time), s(c));
    }), n.state = Ti, n.on.call("start", t, t.__data__, n.index, n.group), n.state === Ti) {
      for (n.state = jn, i = new Array(h = n.tween.length), u = 0, f = -1; u < h; ++u)
        (d = n.tween[u].value.call(t, t.__data__, n.index, n.group)) && (i[++f] = d);
      i.length = f + 1;
    }
  }
  function s(c) {
    for (var u = c < n.duration ? n.ease.call(null, c / n.duration) : (n.timer.restart(l), n.state = $i, 1), f = -1, h = i.length; ++f < h; )
      i[f].call(t, u);
    n.state === $i && (n.on.call("end", t, t.__data__, n.index, n.group), l());
  }
  function l() {
    n.state = Kn, n.timer.stop(), delete a[e];
    for (var c in a) return;
    delete t.__transition;
  }
}
function je(t, e) {
  var n = t.__transition, a, i, r = !0, o;
  if (n) {
    e = e == null ? null : e + "";
    for (o in n) {
      if ((a = n[o]).name !== e) {
        r = !1;
        continue;
      }
      i = a.state > Ti && a.state < $i, a.state = Kn, a.timer.stop(), a.on.call(i ? "interrupt" : "cancel", t, t.__data__, a.index, a.group), delete n[o];
    }
    r && delete t.__transition;
  }
}
function Fh(t) {
  return this.each(function() {
    je(this, t);
  });
}
function Nh(t, e) {
  var n, a;
  return function() {
    var i = oe(this, t), r = i.tween;
    if (r !== n) {
      a = n = r;
      for (var o = 0, s = a.length; o < s; ++o)
        if (a[o].name === e) {
          a = a.slice(), a.splice(o, 1);
          break;
        }
    }
    i.tween = a;
  };
}
function Bh(t, e, n) {
  var a, i;
  if (typeof n != "function") throw new Error();
  return function() {
    var r = oe(this, t), o = r.tween;
    if (o !== a) {
      i = (a = o).slice();
      for (var s = { name: e, value: n }, l = 0, c = i.length; l < c; ++l)
        if (i[l].name === e) {
          i[l] = s;
          break;
        }
      l === c && i.push(s);
    }
    r.tween = i;
  };
}
function Xh(t, e) {
  var n = this._id;
  if (t += "", arguments.length < 2) {
    for (var a = ee(this.node(), n).tween, i = 0, r = a.length, o; i < r; ++i)
      if ((o = a[i]).name === t)
        return o.value;
    return null;
  }
  return this.each((e == null ? Nh : Bh)(n, t, e));
}
function tr(t, e, n) {
  var a = t._id;
  return t.each(function() {
    var i = oe(this, a);
    (i.value || (i.value = {}))[e] = n.apply(this, arguments);
  }), function(i) {
    return ee(i, a).value[e];
  };
}
function Ts(t, e) {
  var n;
  return (typeof e == "number" ? Jt : e instanceof Le ? ha : (n = Le(e)) ? (e = n, ha) : gs)(t, e);
}
function Gh(t) {
  return function() {
    this.removeAttribute(t);
  };
}
function Yh(t) {
  return function() {
    this.removeAttributeNS(t.space, t.local);
  };
}
function Vh(t, e, n) {
  var a, i = n + "", r;
  return function() {
    var o = this.getAttribute(t);
    return o === i ? null : o === a ? r : r = e(a = o, n);
  };
}
function Uh(t, e, n) {
  var a, i = n + "", r;
  return function() {
    var o = this.getAttributeNS(t.space, t.local);
    return o === i ? null : o === a ? r : r = e(a = o, n);
  };
}
function Hh(t, e, n) {
  var a, i, r;
  return function() {
    var o, s = n(this), l;
    return s == null ? void this.removeAttribute(t) : (o = this.getAttribute(t), l = s + "", o === l ? null : o === a && l === i ? r : (i = l, r = e(a = o, s)));
  };
}
function Wh(t, e, n) {
  var a, i, r;
  return function() {
    var o, s = n(this), l;
    return s == null ? void this.removeAttributeNS(t.space, t.local) : (o = this.getAttributeNS(t.space, t.local), l = s + "", o === l ? null : o === a && l === i ? r : (i = l, r = e(a = o, s)));
  };
}
function Zh(t, e) {
  var n = Sa(t), a = n === "transform" ? Sh : Ts;
  return this.attrTween(t, typeof e == "function" ? (n.local ? Wh : Hh)(n, a, tr(this, "attr." + t, e)) : e == null ? (n.local ? Yh : Gh)(n) : (n.local ? Uh : Vh)(n, a, e));
}
function qh(t, e) {
  return function(n) {
    this.setAttribute(t, e.call(this, n));
  };
}
function jh(t, e) {
  return function(n) {
    this.setAttributeNS(t.space, t.local, e.call(this, n));
  };
}
function Kh(t, e) {
  var n, a;
  function i() {
    var r = e.apply(this, arguments);
    return r !== a && (n = (a = r) && jh(t, r)), n;
  }
  return i._value = e, i;
}
function Jh(t, e) {
  var n, a;
  function i() {
    var r = e.apply(this, arguments);
    return r !== a && (n = (a = r) && qh(t, r)), n;
  }
  return i._value = e, i;
}
function Qh(t, e) {
  var n = "attr." + t;
  if (arguments.length < 2) return (n = this.tween(n)) && n._value;
  if (e == null) return this.tween(n, null);
  if (typeof e != "function") throw new Error();
  var a = Sa(t);
  return this.tween(n, (a.local ? Kh : Jh)(a, e));
}
function td(t, e) {
  return function() {
    Qi(this, t).delay = +e.apply(this, arguments);
  };
}
function ed(t, e) {
  return e = +e, function() {
    Qi(this, t).delay = e;
  };
}
function nd(t) {
  var e = this._id;
  return arguments.length ? this.each((typeof t == "function" ? td : ed)(e, t)) : ee(this.node(), e).delay;
}
function ad(t, e) {
  return function() {
    oe(this, t).duration = +e.apply(this, arguments);
  };
}
function id(t, e) {
  return e = +e, function() {
    oe(this, t).duration = e;
  };
}
function rd(t) {
  var e = this._id;
  return arguments.length ? this.each((typeof t == "function" ? ad : id)(e, t)) : ee(this.node(), e).duration;
}
function od(t, e) {
  if (typeof e != "function") throw new Error();
  return function() {
    oe(this, t).ease = e;
  };
}
function sd(t) {
  var e = this._id;
  return arguments.length ? this.each(od(e, t)) : ee(this.node(), e).ease;
}
function ld(t, e) {
  return function() {
    var n = e.apply(this, arguments);
    if (typeof n != "function") throw new Error();
    oe(this, t).ease = n;
  };
}
function cd(t) {
  if (typeof t != "function") throw new Error();
  return this.each(ld(this._id, t));
}
function ud(t) {
  typeof t != "function" && (t = Wo(t));
  for (var e = this._groups, n = e.length, a = new Array(n), i = 0; i < n; ++i)
    for (var r = e[i], o = r.length, s = a[i] = [], l, c = 0; c < o; ++c)
      (l = r[c]) && t.call(l, l.__data__, c, r) && s.push(l);
  return new _e(a, this._parents, this._name, this._id);
}
function fd(t) {
  if (t._id !== this._id) throw new Error();
  for (var e = this._groups, n = t._groups, a = e.length, i = n.length, r = Math.min(a, i), o = new Array(a), s = 0; s < r; ++s)
    for (var l = e[s], c = n[s], u = l.length, f = o[s] = new Array(u), h, d = 0; d < u; ++d)
      (h = l[d] || c[d]) && (f[d] = h);
  for (; s < a; ++s)
    o[s] = e[s];
  return new _e(o, this._parents, this._name, this._id);
}
function hd(t) {
  return (t + "").trim().split(/^|\s+/).every(function(e) {
    var n = e.indexOf(".");
    return n >= 0 && (e = e.slice(0, n)), !e || e === "start";
  });
}
function dd(t, e, n) {
  var a, i, r = hd(e) ? Qi : oe;
  return function() {
    var o = r(this, t), s = o.on;
    s !== a && (i = (a = s).copy()).on(e, n), o.on = i;
  };
}
function vd(t, e) {
  var n = this._id;
  return arguments.length < 2 ? ee(this.node(), n).on.on(t) : this.each(dd(n, t, e));
}
function gd(t) {
  return function() {
    var e = this.parentNode;
    for (var n in this.__transition) if (+n !== t) return;
    e && e.removeChild(this);
  };
}
function pd() {
  return this.on("end.remove", gd(this._id));
}
function _d(t) {
  var e = this._name, n = this._id;
  typeof t != "function" && (t = zi(t));
  for (var a = this._groups, i = a.length, r = new Array(i), o = 0; o < i; ++o)
    for (var s = a[o], l = s.length, c = r[o] = new Array(l), u, f, h = 0; h < l; ++h)
      (u = s[h]) && (f = t.call(u, u.__data__, h, s)) && ("__data__" in u && (f.__data__ = u.__data__), c[h] = f, Ma(c[h], e, n, h, c, ee(u, n)));
  return new _e(r, this._parents, e, n);
}
function xd(t) {
  var e = this._name, n = this._id;
  typeof t != "function" && (t = Ho(t));
  for (var a = this._groups, i = a.length, r = [], o = [], s = 0; s < i; ++s)
    for (var l = a[s], c = l.length, u, f = 0; f < c; ++f)
      if (u = l[f]) {
        for (var h = t.call(u, u.__data__, f, l), d, v = ee(u, n), _ = 0, p = h.length; _ < p; ++_)
          (d = h[_]) && Ma(d, e, n, _, h, v);
        r.push(h), o.push(u);
      }
  return new _e(r, o, e, n);
}
var md = sn.prototype.constructor;
function yd() {
  return new md(this._groups, this._parents);
}
function bd(t, e) {
  var n, a, i;
  return function() {
    var r = Je(this, t), o = (this.style.removeProperty(t), Je(this, t));
    return r === o ? null : r === n && o === a ? i : i = e(n = r, a = o);
  };
}
function $s(t) {
  return function() {
    this.style.removeProperty(t);
  };
}
function Td(t, e, n) {
  var a, i = n + "", r;
  return function() {
    var o = Je(this, t);
    return o === i ? null : o === a ? r : r = e(a = o, n);
  };
}
function $d(t, e, n) {
  var a, i, r;
  return function() {
    var o = Je(this, t), s = n(this), l = s + "";
    return s == null && (l = s = (this.style.removeProperty(t), Je(this, t))), o === l ? null : o === a && l === i ? r : (i = l, r = e(a = o, s));
  };
}
function wd(t, e) {
  var n, a, i, r = "style." + e, o = "end." + r, s;
  return function() {
    var l = oe(this, t), c = l.on, u = l.value[r] == null ? s || (s = $s(e)) : void 0;
    (c !== n || i !== u) && (a = (n = c).copy()).on(o, i = u), l.on = a;
  };
}
function Ad(t, e, n) {
  var a = (t += "") == "transform" ? Ah : Ts;
  return e == null ? this.styleTween(t, bd(t, a)).on("end.style." + t, $s(t)) : typeof e == "function" ? this.styleTween(t, $d(t, a, tr(this, "style." + t, e))).each(wd(this._id, t)) : this.styleTween(t, Td(t, a, e), n).on("end.style." + t, null);
}
function Sd(t, e, n) {
  return function(a) {
    this.style.setProperty(t, e.call(this, a), n);
  };
}
function kd(t, e, n) {
  var a, i;
  function r() {
    var o = e.apply(this, arguments);
    return o !== i && (a = (i = o) && Sd(t, o, n)), a;
  }
  return r._value = e, r;
}
function Cd(t, e, n) {
  var a = "style." + (t += "");
  if (arguments.length < 2) return (a = this.tween(a)) && a._value;
  if (e == null) return this.tween(a, null);
  if (typeof e != "function") throw new Error();
  return this.tween(a, kd(t, e, n ?? ""));
}
function Rd(t) {
  return function() {
    this.textContent = t;
  };
}
function Ed(t) {
  return function() {
    var e = t(this);
    this.textContent = e ?? "";
  };
}
function Md(t) {
  return this.tween("text", typeof t == "function" ? Ed(tr(this, "text", t)) : Rd(t == null ? "" : t + ""));
}
function Ld(t) {
  return function(e) {
    this.textContent = t.call(this, e);
  };
}
function Dd(t) {
  var e, n;
  function a() {
    var i = t.apply(this, arguments);
    return i !== n && (e = (n = i) && Ld(i)), e;
  }
  return a._value = t, a;
}
function Id(t) {
  var e = "text";
  if (arguments.length < 1) return (e = this.tween(e)) && e._value;
  if (t == null) return this.tween(e, null);
  if (typeof t != "function") throw new Error();
  return this.tween(e, Dd(t));
}
function zd() {
  for (var t = this._name, e = this._id, n = As(), a = this._groups, i = a.length, r = 0; r < i; ++r)
    for (var o = a[r], s = o.length, l, c = 0; c < s; ++c)
      if (l = o[c]) {
        var u = ee(l, e);
        Ma(l, t, n, c, o, {
          time: u.time + u.delay + u.duration,
          delay: 0,
          duration: u.duration,
          ease: u.ease
        });
      }
  return new _e(a, this._parents, t, n);
}
function Pd() {
  var t, e, n = this, a = n._id, i = n.size();
  return new Promise(function(r, o) {
    var s = { value: o }, l = { value: function() {
      --i === 0 && r();
    } };
    n.each(function() {
      var c = oe(this, a), u = c.on;
      u !== t && (e = (t = u).copy(), e._.cancel.push(s), e._.interrupt.push(s), e._.end.push(l)), c.on = e;
    }), i === 0 && r();
  });
}
var Od = 0;
function _e(t, e, n, a) {
  this._groups = t, this._parents = e, this._name = n, this._id = a;
}
function ws(t) {
  return sn().transition(t);
}
function As() {
  return ++Od;
}
var se = sn.prototype;
_e.prototype = ws.prototype = {
  constructor: _e,
  select: _d,
  selectAll: xd,
  selectChild: se.selectChild,
  selectChildren: se.selectChildren,
  filter: ud,
  merge: fd,
  selection: yd,
  transition: zd,
  call: se.call,
  nodes: se.nodes,
  node: se.node,
  size: se.size,
  empty: se.empty,
  each: se.each,
  on: vd,
  attr: Zh,
  attrTween: Qh,
  style: Ad,
  styleTween: Cd,
  text: Md,
  textTween: Id,
  remove: pd,
  tween: Xh,
  delay: nd,
  duration: rd,
  ease: sd,
  easeVarying: cd,
  end: Pd,
  [Symbol.iterator]: se[Symbol.iterator]
};
const Fd = (t) => +t;
function Nd(t) {
  return ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
}
var Bd = {
  time: null,
  // Set on use.
  delay: 0,
  duration: 250,
  ease: Nd
};
function Xd(t, e) {
  for (var n; !(n = t.__transition) || !(n = n[e]); )
    if (!(t = t.parentNode))
      throw new Error(`transition ${e} not found`);
  return n;
}
function Gd(t) {
  var e, n;
  t instanceof _e ? (e = t._id, t = t._name) : (e = As(), (n = Bd).time = Ji(), t = t == null ? null : t + "");
  for (var a = this._groups, i = a.length, r = 0; r < i; ++r)
    for (var o = a[r], s = o.length, l, c = 0; c < s; ++c)
      (l = o[c]) && Ma(l, t, e, c, o, n || Xd(l, e));
  return new _e(a, this._parents, t, e);
}
sn.prototype.interrupt = Fh;
sn.prototype.transition = Gd;
const qa = (t) => () => t;
function Yd(t, {
  sourceEvent: e,
  target: n,
  selection: a,
  mode: i,
  dispatch: r
}) {
  Object.defineProperties(this, {
    type: { value: t, enumerable: !0, configurable: !0 },
    sourceEvent: { value: e, enumerable: !0, configurable: !0 },
    target: { value: n, enumerable: !0, configurable: !0 },
    selection: { value: a, enumerable: !0, configurable: !0 },
    mode: { value: i, enumerable: !0, configurable: !0 },
    _: { value: r }
  });
}
function Vd(t) {
  t.stopImmediatePropagation();
}
function ja(t) {
  t.preventDefault(), t.stopImmediatePropagation();
}
var Ur = { name: "drag" }, Ka = { name: "space" }, Ge = { name: "handle" }, Ye = { name: "center" };
const { abs: Hr, max: It, min: zt } = Math;
function Wr(t) {
  return [+t[0], +t[1]];
}
function Zr(t) {
  return [Wr(t[0]), Wr(t[1])];
}
var Jn = {
  name: "x",
  handles: ["w", "e"].map(pa),
  input: function(t, e) {
    return t == null ? null : [[+t[0], e[0][1]], [+t[1], e[1][1]]];
  },
  output: function(t) {
    return t && [t[0][0], t[1][0]];
  }
}, Qn = {
  name: "y",
  handles: ["n", "s"].map(pa),
  input: function(t, e) {
    return t == null ? null : [[e[0][0], +t[0]], [e[1][0], +t[1]]];
  },
  output: function(t) {
    return t && [t[0][1], t[1][1]];
  }
}, le = {
  overlay: "crosshair",
  selection: "move",
  n: "ns-resize",
  e: "ew-resize",
  s: "ns-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  ne: "nesw-resize",
  se: "nwse-resize",
  sw: "nesw-resize"
}, qr = {
  e: "w",
  w: "e",
  nw: "ne",
  ne: "nw",
  se: "sw",
  sw: "se"
}, jr = {
  n: "s",
  s: "n",
  nw: "sw",
  ne: "se",
  se: "ne",
  sw: "nw"
}, Ud = {
  overlay: 1,
  selection: 1,
  n: null,
  e: 1,
  s: null,
  w: -1,
  nw: -1,
  ne: 1,
  se: 1,
  sw: -1
}, Hd = {
  overlay: 1,
  selection: 1,
  n: -1,
  e: null,
  s: 1,
  w: null,
  nw: -1,
  ne: -1,
  se: 1,
  sw: 1
};
function pa(t) {
  return { type: t };
}
function Wd(t) {
  return !t.ctrlKey && !t.button;
}
function Zd() {
  var t = this.ownerSVGElement || this;
  return t.hasAttribute("viewBox") ? (t = t.viewBox.baseVal, [[t.x, t.y], [t.x + t.width, t.y + t.height]]) : [[0, 0], [t.width.baseVal.value, t.height.baseVal.value]];
}
function qd() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function Ja(t) {
  for (; !t.__brush; ) if (!(t = t.parentNode)) return;
  return t.__brush;
}
function jd(t) {
  return t[0][0] === t[1][0] || t[0][1] === t[1][1];
}
function Ss(t) {
  var e = t.__brush;
  return e ? e.dim.output(e.selection) : null;
}
function Kd() {
  return ks(Jn);
}
function Jd() {
  return ks(Qn);
}
function ks(t) {
  var e = Zd, n = Wd, a = qd, i = !0, r = On("start", "brush", "end"), o = 6, s;
  function l(p) {
    var g = p.property("__brush", _).selectAll(".overlay").data([pa("overlay")]);
    g.enter().append("rect").attr("class", "overlay").attr("pointer-events", "all").attr("cursor", le.overlay).merge(g).each(function() {
      var y = Ja(this).extent;
      N(this).attr("x", y[0][0]).attr("y", y[0][1]).attr("width", y[1][0] - y[0][0]).attr("height", y[1][1] - y[0][1]);
    }), p.selectAll(".selection").data([pa("selection")]).enter().append("rect").attr("class", "selection").attr("cursor", le.selection).attr("fill", "#777").attr("fill-opacity", 0.3).attr("stroke", "#fff").attr("shape-rendering", "crispEdges");
    var x = p.selectAll(".handle").data(t.handles, function(y) {
      return y.type;
    });
    x.exit().remove(), x.enter().append("rect").attr("class", function(y) {
      return "handle handle--" + y.type;
    }).attr("cursor", function(y) {
      return le[y.type];
    }), p.each(c).attr("fill", "none").attr("pointer-events", "all").on("mousedown.brush", h).filter(a).on("touchstart.brush", h).on("touchmove.brush", d).on("touchend.brush touchcancel.brush", v).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  l.move = function(p, g, x) {
    p.tween ? p.on("start.brush", function(y) {
      u(this, arguments).beforestart().start(y);
    }).on("interrupt.brush end.brush", function(y) {
      u(this, arguments).end(y);
    }).tween("brush", function() {
      var y = this, m = y.__brush, T = u(y, arguments), b = m.selection, w = t.input(typeof g == "function" ? g.apply(this, arguments) : g, m.extent), A = ln(b, w);
      function k(C) {
        m.selection = C === 1 && w === null ? null : A(C), c.call(y), T.brush();
      }
      return b !== null && w !== null ? k : k(1);
    }) : p.each(function() {
      var y = this, m = arguments, T = y.__brush, b = t.input(typeof g == "function" ? g.apply(y, m) : g, T.extent), w = u(y, m).beforestart();
      je(y), T.selection = b === null ? null : b, c.call(y), w.start(x).brush(x).end(x);
    });
  }, l.clear = function(p, g) {
    l.move(p, null, g);
  };
  function c() {
    var p = N(this), g = Ja(this).selection;
    g ? (p.selectAll(".selection").style("display", null).attr("x", g[0][0]).attr("y", g[0][1]).attr("width", g[1][0] - g[0][0]).attr("height", g[1][1] - g[0][1]), p.selectAll(".handle").style("display", null).attr("x", function(x) {
      return x.type[x.type.length - 1] === "e" ? g[1][0] - o / 2 : g[0][0] - o / 2;
    }).attr("y", function(x) {
      return x.type[0] === "s" ? g[1][1] - o / 2 : g[0][1] - o / 2;
    }).attr("width", function(x) {
      return x.type === "n" || x.type === "s" ? g[1][0] - g[0][0] + o : o;
    }).attr("height", function(x) {
      return x.type === "e" || x.type === "w" ? g[1][1] - g[0][1] + o : o;
    })) : p.selectAll(".selection,.handle").style("display", "none").attr("x", null).attr("y", null).attr("width", null).attr("height", null);
  }
  function u(p, g, x) {
    var y = p.__brush.emitter;
    return y && (!x || !y.clean) ? y : new f(p, g, x);
  }
  function f(p, g, x) {
    this.that = p, this.args = g, this.state = p.__brush, this.active = 0, this.clean = x;
  }
  f.prototype = {
    beforestart: function() {
      return ++this.active === 1 && (this.state.emitter = this, this.starting = !0), this;
    },
    start: function(p, g) {
      return this.starting ? (this.starting = !1, this.emit("start", p, g)) : this.emit("brush", p), this;
    },
    brush: function(p, g) {
      return this.emit("brush", p, g), this;
    },
    end: function(p, g) {
      return --this.active === 0 && (delete this.state.emitter, this.emit("end", p, g)), this;
    },
    emit: function(p, g, x) {
      var y = N(this.that).datum();
      r.call(
        p,
        this.that,
        new Yd(p, {
          sourceEvent: g,
          target: l,
          selection: t.output(this.state.selection),
          mode: x,
          dispatch: r
        }),
        y
      );
    }
  };
  function h(p) {
    if (s && !p.touches || !n.apply(this, arguments)) return;
    var g = this, x = p.target.__data__.type, y = (i && p.metaKey ? x = "overlay" : x) === "selection" ? Ur : i && p.altKey ? Ye : Ge, m = t === Qn ? null : Ud[x], T = t === Jn ? null : Hd[x], b = Ja(g), w = b.extent, A = b.selection, k = w[0][0], C, E, M = w[0][1], L, $, D = w[1][0], S, R, z = w[1][1], P, O, X = 0, G = 0, ht, et = m && T && i && p.shiftKey, Q, B, W = Array.from(p.touches || [p], (H) => {
      const _t = H.identifier;
      return H = Ht(H, g), H.point0 = H.slice(), H.identifier = _t, H;
    });
    je(g);
    var J = u(g, arguments, !0).beforestart();
    if (x === "overlay") {
      A && (ht = !0);
      const H = [W[0], W[1] || W[0]];
      b.selection = A = [[
        C = t === Qn ? k : zt(H[0][0], H[1][0]),
        L = t === Jn ? M : zt(H[0][1], H[1][1])
      ], [
        S = t === Qn ? D : It(H[0][0], H[1][0]),
        P = t === Jn ? z : It(H[0][1], H[1][1])
      ]], W.length > 1 && ot(p);
    } else
      C = A[0][0], L = A[0][1], S = A[1][0], P = A[1][1];
    E = C, $ = L, R = S, O = P;
    var F = N(g).attr("pointer-events", "none"), V = F.selectAll(".overlay").attr("cursor", le[x]);
    if (p.touches)
      J.moved = I, J.ended = it;
    else {
      var Z = N(p.view).on("mousemove.brush", I, !0).on("mouseup.brush", it, !0);
      i && Z.on("keydown.brush", yt, !0).on("keyup.brush", bt, !0), Zi(p.view);
    }
    c.call(g), J.start(p, y.name);
    function I(H) {
      for (const _t of H.changedTouches || [H])
        for (const pn of W)
          pn.identifier === _t.identifier && (pn.cur = Ht(_t, g));
      if (et && !Q && !B && W.length === 1) {
        const _t = W[0];
        Hr(_t.cur[0] - _t[0]) > Hr(_t.cur[1] - _t[1]) ? B = !0 : Q = !0;
      }
      for (const _t of W)
        _t.cur && (_t[0] = _t.cur[0], _t[1] = _t.cur[1]);
      ht = !0, ja(H), ot(H);
    }
    function ot(H) {
      const _t = W[0], pn = _t.point0;
      var me;
      switch (X = _t[0] - pn[0], G = _t[1] - pn[1], y) {
        case Ka:
        case Ur: {
          m && (X = It(k - C, zt(D - S, X)), E = C + X, R = S + X), T && (G = It(M - L, zt(z - P, G)), $ = L + G, O = P + G);
          break;
        }
        case Ge: {
          W[1] ? (m && (E = It(k, zt(D, W[0][0])), R = It(k, zt(D, W[1][0])), m = 1), T && ($ = It(M, zt(z, W[0][1])), O = It(M, zt(z, W[1][1])), T = 1)) : (m < 0 ? (X = It(k - C, zt(D - C, X)), E = C + X, R = S) : m > 0 && (X = It(k - S, zt(D - S, X)), E = C, R = S + X), T < 0 ? (G = It(M - L, zt(z - L, G)), $ = L + G, O = P) : T > 0 && (G = It(M - P, zt(z - P, G)), $ = L, O = P + G));
          break;
        }
        case Ye: {
          m && (E = It(k, zt(D, C - X * m)), R = It(k, zt(D, S + X * m))), T && ($ = It(M, zt(z, L - G * T)), O = It(M, zt(z, P + G * T)));
          break;
        }
      }
      R < E && (m *= -1, me = C, C = S, S = me, me = E, E = R, R = me, x in qr && V.attr("cursor", le[x = qr[x]])), O < $ && (T *= -1, me = L, L = P, P = me, me = $, $ = O, O = me, x in jr && V.attr("cursor", le[x = jr[x]])), b.selection && (A = b.selection), Q && (E = A[0][0], R = A[1][0]), B && ($ = A[0][1], O = A[1][1]), (A[0][0] !== E || A[0][1] !== $ || A[1][0] !== R || A[1][1] !== O) && (b.selection = [[E, $], [R, O]], c.call(g), J.brush(H, y.name));
    }
    function it(H) {
      if (Vd(H), H.touches) {
        if (H.touches.length) return;
        s && clearTimeout(s), s = setTimeout(function() {
          s = null;
        }, 500);
      } else
        qi(H.view, ht), Z.on("keydown.brush keyup.brush mousemove.brush mouseup.brush", null);
      F.attr("pointer-events", "all"), V.attr("cursor", le.overlay), b.selection && (A = b.selection), jd(A) && (b.selection = null, c.call(g)), J.end(H, y.name);
    }
    function yt(H) {
      switch (H.keyCode) {
        case 16: {
          et = m && T;
          break;
        }
        case 18: {
          y === Ge && (m && (S = R - X * m, C = E + X * m), T && (P = O - G * T, L = $ + G * T), y = Ye, ot(H));
          break;
        }
        case 32: {
          (y === Ge || y === Ye) && (m < 0 ? S = R - X : m > 0 && (C = E - X), T < 0 ? P = O - G : T > 0 && (L = $ - G), y = Ka, V.attr("cursor", le.selection), ot(H));
          break;
        }
        default:
          return;
      }
      ja(H);
    }
    function bt(H) {
      switch (H.keyCode) {
        case 16: {
          et && (Q = B = et = !1, ot(H));
          break;
        }
        case 18: {
          y === Ye && (m < 0 ? S = R : m > 0 && (C = E), T < 0 ? P = O : T > 0 && (L = $), y = Ge, ot(H));
          break;
        }
        case 32: {
          y === Ka && (H.altKey ? (m && (S = R - X * m, C = E + X * m), T && (P = O - G * T, L = $ + G * T), y = Ye) : (m < 0 ? S = R : m > 0 && (C = E), T < 0 ? P = O : T > 0 && (L = $), y = Ge), V.attr("cursor", le[x]), ot(H));
          break;
        }
        default:
          return;
      }
      ja(H);
    }
  }
  function d(p) {
    u(this, arguments).moved(p);
  }
  function v(p) {
    u(this, arguments).ended(p);
  }
  function _() {
    var p = this.__brush || { selection: null };
    return p.extent = Zr(e.apply(this, arguments)), p.dim = t, p;
  }
  return l.extent = function(p) {
    return arguments.length ? (e = typeof p == "function" ? p : qa(Zr(p)), l) : e;
  }, l.filter = function(p) {
    return arguments.length ? (n = typeof p == "function" ? p : qa(!!p), l) : n;
  }, l.touchable = function(p) {
    return arguments.length ? (a = typeof p == "function" ? p : qa(!!p), l) : a;
  }, l.handleSize = function(p) {
    return arguments.length ? (o = +p, l) : o;
  }, l.keyModifiers = function(p) {
    return arguments.length ? (i = !!p, l) : i;
  }, l.on = function() {
    var p = r.on.apply(r, arguments);
    return p === r ? l : p;
  }, l;
}
var Kr = {}, Qa = {}, ti = 34, bn = 10, ei = 13;
function Cs(t) {
  return new Function("d", "return {" + t.map(function(e, n) {
    return JSON.stringify(e) + ": d[" + n + '] || ""';
  }).join(",") + "}");
}
function Qd(t, e) {
  var n = Cs(t);
  return function(a, i) {
    return e(n(a), i, t);
  };
}
function Jr(t) {
  var e = /* @__PURE__ */ Object.create(null), n = [];
  return t.forEach(function(a) {
    for (var i in a)
      i in e || n.push(e[i] = i);
  }), n;
}
function Xt(t, e) {
  var n = t + "", a = n.length;
  return a < e ? new Array(e - a + 1).join(0) + n : n;
}
function tv(t) {
  return t < 0 ? "-" + Xt(-t, 6) : t > 9999 ? "+" + Xt(t, 6) : Xt(t, 4);
}
function ev(t) {
  var e = t.getUTCHours(), n = t.getUTCMinutes(), a = t.getUTCSeconds(), i = t.getUTCMilliseconds();
  return isNaN(t) ? "Invalid Date" : tv(t.getUTCFullYear()) + "-" + Xt(t.getUTCMonth() + 1, 2) + "-" + Xt(t.getUTCDate(), 2) + (i ? "T" + Xt(e, 2) + ":" + Xt(n, 2) + ":" + Xt(a, 2) + "." + Xt(i, 3) + "Z" : a ? "T" + Xt(e, 2) + ":" + Xt(n, 2) + ":" + Xt(a, 2) + "Z" : n || e ? "T" + Xt(e, 2) + ":" + Xt(n, 2) + "Z" : "");
}
function Rs(t) {
  var e = new RegExp('["' + t + `
\r]`), n = t.charCodeAt(0);
  function a(f, h) {
    var d, v, _ = i(f, function(p, g) {
      if (d) return d(p, g - 1);
      v = p, d = h ? Qd(p, h) : Cs(p);
    });
    return _.columns = v || [], _;
  }
  function i(f, h) {
    var d = [], v = f.length, _ = 0, p = 0, g, x = v <= 0, y = !1;
    f.charCodeAt(v - 1) === bn && --v, f.charCodeAt(v - 1) === ei && --v;
    function m() {
      if (x) return Qa;
      if (y) return y = !1, Kr;
      var b, w = _, A;
      if (f.charCodeAt(w) === ti) {
        for (; _++ < v && f.charCodeAt(_) !== ti || f.charCodeAt(++_) === ti; ) ;
        return (b = _) >= v ? x = !0 : (A = f.charCodeAt(_++)) === bn ? y = !0 : A === ei && (y = !0, f.charCodeAt(_) === bn && ++_), f.slice(w + 1, b - 1).replace(/""/g, '"');
      }
      for (; _ < v; ) {
        if ((A = f.charCodeAt(b = _++)) === bn) y = !0;
        else if (A === ei)
          y = !0, f.charCodeAt(_) === bn && ++_;
        else if (A !== n) continue;
        return f.slice(w, b);
      }
      return x = !0, f.slice(w, v);
    }
    for (; (g = m()) !== Qa; ) {
      for (var T = []; g !== Kr && g !== Qa; ) T.push(g), g = m();
      h && (T = h(T, p++)) == null || d.push(T);
    }
    return d;
  }
  function r(f, h) {
    return f.map(function(d) {
      return h.map(function(v) {
        return u(d[v]);
      }).join(t);
    });
  }
  function o(f, h) {
    return h == null && (h = Jr(f)), [h.map(u).join(t)].concat(r(f, h)).join(`
`);
  }
  function s(f, h) {
    return h == null && (h = Jr(f)), r(f, h).join(`
`);
  }
  function l(f) {
    return f.map(c).join(`
`);
  }
  function c(f) {
    return f.map(u).join(t);
  }
  function u(f) {
    return f == null ? "" : f instanceof Date ? ev(f) : e.test(f += "") ? '"' + f.replace(/"/g, '""') + '"' : f;
  }
  return {
    parse: a,
    parseRows: i,
    format: o,
    formatBody: s,
    formatRows: l,
    formatRow: c,
    formatValue: u
  };
}
var Es = Rs(","), nv = Es.parse, av = Es.parseRows, Ms = Rs("	"), iv = Ms.parse, rv = Ms.parseRows;
function cn(t, e) {
  switch (arguments.length) {
    case 0:
      break;
    case 1:
      this.range(t);
      break;
    default:
      this.range(e).domain(t);
      break;
  }
  return this;
}
const Qr = /* @__PURE__ */ Symbol("implicit");
function Ls() {
  var t = new xr(), e = [], n = [], a = Qr;
  function i(r) {
    let o = t.get(r);
    if (o === void 0) {
      if (a !== Qr) return a;
      t.set(r, o = e.push(r) - 1);
    }
    return n[o % n.length];
  }
  return i.domain = function(r) {
    if (!arguments.length) return e.slice();
    e = [], t = new xr();
    for (const o of r)
      t.has(o) || t.set(o, e.push(o) - 1);
    return i;
  }, i.range = function(r) {
    return arguments.length ? (n = Array.from(r), i) : n.slice();
  }, i.unknown = function(r) {
    return arguments.length ? (a = r, i) : a;
  }, i.copy = function() {
    return Ls(e, n).unknown(a);
  }, cn.apply(i, arguments), i;
}
function ov(t) {
  return function() {
    return t;
  };
}
function sv(t) {
  return +t;
}
var to = [0, 1];
function He(t) {
  return t;
}
function wi(t, e) {
  return (e -= t = +t) ? function(n) {
    return (n - t) / e;
  } : ov(isNaN(e) ? NaN : 0.5);
}
function lv(t, e) {
  var n;
  return t > e && (n = t, t = e, e = n), function(a) {
    return Math.max(t, Math.min(e, a));
  };
}
function cv(t, e, n) {
  var a = t[0], i = t[1], r = e[0], o = e[1];
  return i < a ? (a = wi(i, a), r = n(o, r)) : (a = wi(a, i), r = n(r, o)), function(s) {
    return r(a(s));
  };
}
function uv(t, e, n) {
  var a = Math.min(t.length, e.length) - 1, i = new Array(a), r = new Array(a), o = -1;
  for (t[a] < t[0] && (t = t.slice().reverse(), e = e.slice().reverse()); ++o < a; )
    i[o] = wi(t[o], t[o + 1]), r[o] = n(e[o], e[o + 1]);
  return function(s) {
    var l = Du(t, s, 1, a) - 1;
    return r[l](i[l](s));
  };
}
function La(t, e) {
  return e.domain(t.domain()).range(t.range()).interpolate(t.interpolate()).clamp(t.clamp()).unknown(t.unknown());
}
function er() {
  var t = to, e = to, n = ln, a, i, r, o = He, s, l, c;
  function u() {
    var h = Math.min(t.length, e.length);
    return o !== He && (o = lv(t[0], t[h - 1])), s = h > 2 ? uv : cv, l = c = null, f;
  }
  function f(h) {
    return h == null || isNaN(h = +h) ? r : (l || (l = s(t.map(a), e, n)))(a(o(h)));
  }
  return f.invert = function(h) {
    return o(i((c || (c = s(e, t.map(a), Jt)))(h)));
  }, f.domain = function(h) {
    return arguments.length ? (t = Array.from(h, sv), u()) : t.slice();
  }, f.range = function(h) {
    return arguments.length ? (e = Array.from(h), u()) : e.slice();
  }, f.rangeRound = function(h) {
    return e = Array.from(h), n = Th, u();
  }, f.clamp = function(h) {
    return arguments.length ? (o = h ? !0 : He, u()) : o !== He;
  }, f.interpolate = function(h) {
    return arguments.length ? (n = h, u()) : n;
  }, f.unknown = function(h) {
    return arguments.length ? (r = h, f) : r;
  }, function(h, d) {
    return a = h, i = d, u();
  };
}
function Ds() {
  return er()(He, He);
}
function fv(t, e, n, a) {
  var i = pi(t, e, n), r;
  switch (a = Go(a ?? ",f"), a.type) {
    case "s": {
      var o = Math.max(Math.abs(t), Math.abs(e));
      return a.precision == null && !isNaN(r = Xl(i, o)) && (a.precision = r), Gl(a, o);
    }
    case "":
    case "e":
    case "g":
    case "p":
    case "r": {
      a.precision == null && !isNaN(r = Bl(i, Math.max(Math.abs(t), Math.abs(e)))) && (a.precision = r - (a.type === "e"));
      break;
    }
    case "f":
    case "%": {
      a.precision == null && !isNaN(r = Nl(i)) && (a.precision = r - (a.type === "%") * 2);
      break;
    }
  }
  return Yo(a);
}
function Is(t) {
  var e = t.domain;
  return t.ticks = function(n) {
    var a = e();
    return vi(a[0], a[a.length - 1], n ?? 10);
  }, t.tickFormat = function(n, a) {
    var i = e();
    return fv(i[0], i[i.length - 1], n ?? 10, a);
  }, t.nice = function(n) {
    n == null && (n = 10);
    var a = e(), i = 0, r = a.length - 1, o = a[i], s = a[r], l, c, u = 10;
    for (s < o && (c = o, o = s, s = c, c = i, i = r, r = c); u-- > 0; ) {
      if (c = gi(o, s, n), c === l)
        return a[i] = o, a[r] = s, e(a);
      if (c > 0)
        o = Math.floor(o / c) * c, s = Math.ceil(s / c) * c;
      else if (c < 0)
        o = Math.ceil(o * c) / c, s = Math.floor(s * c) / c;
      else
        break;
      l = c;
    }
    return t;
  }, t;
}
function _a() {
  var t = Ds();
  return t.copy = function() {
    return La(t, _a());
  }, cn.apply(t, arguments), Is(t);
}
function zs(t, e) {
  t = t.slice();
  var n = 0, a = t.length - 1, i = t[n], r = t[a], o;
  return r < i && (o = n, n = a, a = o, o = i, i = r, r = o), t[n] = e.floor(i), t[a] = e.ceil(r), t;
}
function eo(t) {
  return Math.log(t);
}
function no(t) {
  return Math.exp(t);
}
function hv(t) {
  return -Math.log(-t);
}
function dv(t) {
  return -Math.exp(-t);
}
function vv(t) {
  return isFinite(t) ? +("1e" + t) : t < 0 ? 0 : t;
}
function gv(t) {
  return t === 10 ? vv : t === Math.E ? Math.exp : (e) => Math.pow(t, e);
}
function pv(t) {
  return t === Math.E ? Math.log : t === 10 && Math.log10 || t === 2 && Math.log2 || (t = Math.log(t), (e) => Math.log(e) / t);
}
function ao(t) {
  return (e, n) => -t(-e, n);
}
function _v(t) {
  const e = t(eo, no), n = e.domain;
  let a = 10, i, r;
  function o() {
    return i = pv(a), r = gv(a), n()[0] < 0 ? (i = ao(i), r = ao(r), t(hv, dv)) : t(eo, no), e;
  }
  return e.base = function(s) {
    return arguments.length ? (a = +s, o()) : a;
  }, e.domain = function(s) {
    return arguments.length ? (n(s), o()) : n();
  }, e.ticks = (s) => {
    const l = n();
    let c = l[0], u = l[l.length - 1];
    const f = u < c;
    f && ([c, u] = [u, c]);
    let h = i(c), d = i(u), v, _;
    const p = s == null ? 10 : +s;
    let g = [];
    if (!(a % 1) && d - h < p) {
      if (h = Math.floor(h), d = Math.ceil(d), c > 0) {
        for (; h <= d; ++h)
          for (v = 1; v < a; ++v)
            if (_ = h < 0 ? v / r(-h) : v * r(h), !(_ < c)) {
              if (_ > u) break;
              g.push(_);
            }
      } else for (; h <= d; ++h)
        for (v = a - 1; v >= 1; --v)
          if (_ = h > 0 ? v / r(-h) : v * r(h), !(_ < c)) {
            if (_ > u) break;
            g.push(_);
          }
      g.length * 2 < p && (g = vi(c, u, p));
    } else
      g = vi(h, d, Math.min(d - h, p)).map(r);
    return f ? g.reverse() : g;
  }, e.tickFormat = (s, l) => {
    if (s == null && (s = 10), l == null && (l = a === 10 ? "s" : ","), typeof l != "function" && (!(a % 1) && (l = Go(l)).precision == null && (l.trim = !0), l = Yo(l)), s === 1 / 0) return l;
    const c = Math.max(1, a * s / e.ticks().length);
    return (u) => {
      let f = u / r(Math.round(i(u)));
      return f * a < a - 0.5 && (f *= a), f <= c ? l(u) : "";
    };
  }, e.nice = () => n(zs(n(), {
    floor: (s) => r(Math.floor(i(s))),
    ceil: (s) => r(Math.ceil(i(s)))
  })), e;
}
function Ps() {
  const t = _v(er()).domain([1, 10]);
  return t.copy = () => La(t, Ps()).base(t.base()), cn.apply(t, arguments), t;
}
function io(t) {
  return function(e) {
    return Math.sign(e) * Math.log1p(Math.abs(e / t));
  };
}
function ro(t) {
  return function(e) {
    return Math.sign(e) * Math.expm1(Math.abs(e)) * t;
  };
}
function xv(t) {
  var e = 1, n = t(io(e), ro(e));
  return n.constant = function(a) {
    return arguments.length ? t(io(e = +a), ro(e)) : e;
  }, Is(n);
}
function Os() {
  var t = xv(er());
  return t.copy = function() {
    return La(t, Os()).constant(t.constant());
  }, cn.apply(t, arguments);
}
function mv(t) {
  return new Date(t);
}
function yv(t) {
  return t instanceof Date ? +t : +/* @__PURE__ */ new Date(+t);
}
function nr(t, e, n, a, i, r, o, s, l, c) {
  var u = Ds(), f = u.invert, h = u.domain, d = c(".%L"), v = c(":%S"), _ = c("%I:%M"), p = c("%I %p"), g = c("%a %d"), x = c("%b %d"), y = c("%B"), m = c("%Y");
  function T(b) {
    return (l(b) < b ? d : s(b) < b ? v : o(b) < b ? _ : r(b) < b ? p : a(b) < b ? i(b) < b ? g : x : n(b) < b ? y : m)(b);
  }
  return u.invert = function(b) {
    return new Date(f(b));
  }, u.domain = function(b) {
    return arguments.length ? h(Array.from(b, yv)) : h().map(mv);
  }, u.ticks = function(b) {
    var w = h();
    return t(w[0], w[w.length - 1], b ?? 10);
  }, u.tickFormat = function(b, w) {
    return w == null ? T : c(w);
  }, u.nice = function(b) {
    var w = h();
    return (!b || typeof b.range != "function") && (b = e(w[0], w[w.length - 1], b ?? 10)), b ? h(zs(w, b)) : u;
  }, u.copy = function() {
    return La(u, nr(t, e, n, a, i, r, o, s, l, c));
  }, u;
}
function bv() {
  return cn.apply(nr(Gu, Yu, ge, Yi, Ca, Pn, Xi, Ni, Ce, Hi).domain([new Date(2e3, 0, 1), new Date(2e3, 0, 2)]), arguments);
}
function Tv() {
  return cn.apply(nr(Bu, Xu, pe, Vi, Ra, ka, Gi, Bi, Ce, Wi).domain([Date.UTC(2e3, 0, 1), Date.UTC(2e3, 0, 2)]), arguments);
}
function rt(t) {
  return function() {
    return t;
  };
}
const oo = Math.abs, Pt = Math.atan2, Ae = Math.cos, $v = Math.max, ni = Math.min, ne = Math.sin, We = Math.sqrt, Ot = 1e-12, Dn = Math.PI, xa = Dn / 2, ta = 2 * Dn;
function wv(t) {
  return t > 1 ? 0 : t < -1 ? Dn : Math.acos(t);
}
function so(t) {
  return t >= 1 ? xa : t <= -1 ? -xa : Math.asin(t);
}
const Ai = Math.PI, Si = 2 * Ai, Se = 1e-6, Av = Si - Se;
function Fs(t) {
  this._ += t[0];
  for (let e = 1, n = t.length; e < n; ++e)
    this._ += arguments[e] + t[e];
}
function Sv(t) {
  let e = Math.floor(t);
  if (!(e >= 0)) throw new Error(`invalid digits: ${t}`);
  if (e > 15) return Fs;
  const n = 10 ** e;
  return function(a) {
    this._ += a[0];
    for (let i = 1, r = a.length; i < r; ++i)
      this._ += Math.round(arguments[i] * n) / n + a[i];
  };
}
class kv {
  constructor(e) {
    this._x0 = this._y0 = // start of current subpath
    this._x1 = this._y1 = null, this._ = "", this._append = e == null ? Fs : Sv(e);
  }
  moveTo(e, n) {
    this._append`M${this._x0 = this._x1 = +e},${this._y0 = this._y1 = +n}`;
  }
  closePath() {
    this._x1 !== null && (this._x1 = this._x0, this._y1 = this._y0, this._append`Z`);
  }
  lineTo(e, n) {
    this._append`L${this._x1 = +e},${this._y1 = +n}`;
  }
  quadraticCurveTo(e, n, a, i) {
    this._append`Q${+e},${+n},${this._x1 = +a},${this._y1 = +i}`;
  }
  bezierCurveTo(e, n, a, i, r, o) {
    this._append`C${+e},${+n},${+a},${+i},${this._x1 = +r},${this._y1 = +o}`;
  }
  arcTo(e, n, a, i, r) {
    if (e = +e, n = +n, a = +a, i = +i, r = +r, r < 0) throw new Error(`negative radius: ${r}`);
    let o = this._x1, s = this._y1, l = a - e, c = i - n, u = o - e, f = s - n, h = u * u + f * f;
    if (this._x1 === null)
      this._append`M${this._x1 = e},${this._y1 = n}`;
    else if (h > Se) if (!(Math.abs(f * l - c * u) > Se) || !r)
      this._append`L${this._x1 = e},${this._y1 = n}`;
    else {
      let d = a - o, v = i - s, _ = l * l + c * c, p = d * d + v * v, g = Math.sqrt(_), x = Math.sqrt(h), y = r * Math.tan((Ai - Math.acos((_ + h - p) / (2 * g * x))) / 2), m = y / x, T = y / g;
      Math.abs(m - 1) > Se && this._append`L${e + m * u},${n + m * f}`, this._append`A${r},${r},0,0,${+(f * d > u * v)},${this._x1 = e + T * l},${this._y1 = n + T * c}`;
    }
  }
  arc(e, n, a, i, r, o) {
    if (e = +e, n = +n, a = +a, o = !!o, a < 0) throw new Error(`negative radius: ${a}`);
    let s = a * Math.cos(i), l = a * Math.sin(i), c = e + s, u = n + l, f = 1 ^ o, h = o ? i - r : r - i;
    this._x1 === null ? this._append`M${c},${u}` : (Math.abs(this._x1 - c) > Se || Math.abs(this._y1 - u) > Se) && this._append`L${c},${u}`, a && (h < 0 && (h = h % Si + Si), h > Av ? this._append`A${a},${a},0,1,${f},${e - s},${n - l}A${a},${a},0,1,${f},${this._x1 = c},${this._y1 = u}` : h > Se && this._append`A${a},${a},0,${+(h >= Ai)},${f},${this._x1 = e + a * Math.cos(r)},${this._y1 = n + a * Math.sin(r)}`);
  }
  rect(e, n, a, i) {
    this._append`M${this._x0 = this._x1 = +e},${this._y0 = this._y1 = +n}h${a = +a}v${+i}h${-a}Z`;
  }
  toString() {
    return this._;
  }
}
function ar(t) {
  let e = 3;
  return t.digits = function(n) {
    if (!arguments.length) return e;
    if (n == null)
      e = null;
    else {
      const a = Math.floor(n);
      if (!(a >= 0)) throw new RangeError(`invalid digits: ${n}`);
      e = a;
    }
    return t;
  }, () => new kv(e);
}
function Cv(t) {
  return t.innerRadius;
}
function Rv(t) {
  return t.outerRadius;
}
function Ev(t) {
  return t.startAngle;
}
function Mv(t) {
  return t.endAngle;
}
function Lv(t) {
  return t && t.padAngle;
}
function Dv(t, e, n, a, i, r, o, s) {
  var l = n - t, c = a - e, u = o - i, f = s - r, h = f * l - u * c;
  if (!(h * h < Ot))
    return h = (u * (e - r) - f * (t - i)) / h, [t + h * l, e + h * c];
}
function Vn(t, e, n, a, i, r, o) {
  var s = t - n, l = e - a, c = (o ? r : -r) / We(s * s + l * l), u = c * l, f = -c * s, h = t + u, d = e + f, v = n + u, _ = a + f, p = (h + v) / 2, g = (d + _) / 2, x = v - h, y = _ - d, m = x * x + y * y, T = i - r, b = h * _ - v * d, w = (y < 0 ? -1 : 1) * We($v(0, T * T * m - b * b)), A = (b * y - x * w) / m, k = (-b * x - y * w) / m, C = (b * y + x * w) / m, E = (-b * x + y * w) / m, M = A - p, L = k - g, $ = C - p, D = E - g;
  return M * M + L * L > $ * $ + D * D && (A = C, k = E), {
    cx: A,
    cy: k,
    x01: -u,
    y01: -f,
    x11: A * (i / T - 1),
    y11: k * (i / T - 1)
  };
}
function lo() {
  var t = Cv, e = Rv, n = rt(0), a = null, i = Ev, r = Mv, o = Lv, s = null, l = ar(c);
  function c() {
    var u, f, h = +t.apply(this, arguments), d = +e.apply(this, arguments), v = i.apply(this, arguments) - xa, _ = r.apply(this, arguments) - xa, p = oo(_ - v), g = _ > v;
    if (s || (s = u = l()), d < h && (f = d, d = h, h = f), !(d > Ot)) s.moveTo(0, 0);
    else if (p > ta - Ot)
      s.moveTo(d * Ae(v), d * ne(v)), s.arc(0, 0, d, v, _, !g), h > Ot && (s.moveTo(h * Ae(_), h * ne(_)), s.arc(0, 0, h, _, v, g));
    else {
      var x = v, y = _, m = v, T = _, b = p, w = p, A = o.apply(this, arguments) / 2, k = A > Ot && (a ? +a.apply(this, arguments) : We(h * h + d * d)), C = ni(oo(d - h) / 2, +n.apply(this, arguments)), E = C, M = C, L, $;
      if (k > Ot) {
        var D = so(k / h * ne(A)), S = so(k / d * ne(A));
        (b -= D * 2) > Ot ? (D *= g ? 1 : -1, m += D, T -= D) : (b = 0, m = T = (v + _) / 2), (w -= S * 2) > Ot ? (S *= g ? 1 : -1, x += S, y -= S) : (w = 0, x = y = (v + _) / 2);
      }
      var R = d * Ae(x), z = d * ne(x), P = h * Ae(T), O = h * ne(T);
      if (C > Ot) {
        var X = d * Ae(y), G = d * ne(y), ht = h * Ae(m), et = h * ne(m), Q;
        if (p < Dn)
          if (Q = Dv(R, z, ht, et, X, G, P, O)) {
            var B = R - Q[0], W = z - Q[1], J = X - Q[0], F = G - Q[1], V = 1 / ne(wv((B * J + W * F) / (We(B * B + W * W) * We(J * J + F * F))) / 2), Z = We(Q[0] * Q[0] + Q[1] * Q[1]);
            E = ni(C, (h - Z) / (V - 1)), M = ni(C, (d - Z) / (V + 1));
          } else
            E = M = 0;
      }
      w > Ot ? M > Ot ? (L = Vn(ht, et, R, z, d, M, g), $ = Vn(X, G, P, O, d, M, g), s.moveTo(L.cx + L.x01, L.cy + L.y01), M < C ? s.arc(L.cx, L.cy, M, Pt(L.y01, L.x01), Pt($.y01, $.x01), !g) : (s.arc(L.cx, L.cy, M, Pt(L.y01, L.x01), Pt(L.y11, L.x11), !g), s.arc(0, 0, d, Pt(L.cy + L.y11, L.cx + L.x11), Pt($.cy + $.y11, $.cx + $.x11), !g), s.arc($.cx, $.cy, M, Pt($.y11, $.x11), Pt($.y01, $.x01), !g))) : (s.moveTo(R, z), s.arc(0, 0, d, x, y, !g)) : s.moveTo(R, z), !(h > Ot) || !(b > Ot) ? s.lineTo(P, O) : E > Ot ? (L = Vn(P, O, X, G, h, -E, g), $ = Vn(R, z, ht, et, h, -E, g), s.lineTo(L.cx + L.x01, L.cy + L.y01), E < C ? s.arc(L.cx, L.cy, E, Pt(L.y01, L.x01), Pt($.y01, $.x01), !g) : (s.arc(L.cx, L.cy, E, Pt(L.y01, L.x01), Pt(L.y11, L.x11), !g), s.arc(0, 0, h, Pt(L.cy + L.y11, L.cx + L.x11), Pt($.cy + $.y11, $.cx + $.x11), g), s.arc($.cx, $.cy, E, Pt($.y11, $.x11), Pt($.y01, $.x01), !g))) : s.arc(0, 0, h, T, m, g);
    }
    if (s.closePath(), u) return s = null, u + "" || null;
  }
  return c.centroid = function() {
    var u = (+t.apply(this, arguments) + +e.apply(this, arguments)) / 2, f = (+i.apply(this, arguments) + +r.apply(this, arguments)) / 2 - Dn / 2;
    return [Ae(f) * u, ne(f) * u];
  }, c.innerRadius = function(u) {
    return arguments.length ? (t = typeof u == "function" ? u : rt(+u), c) : t;
  }, c.outerRadius = function(u) {
    return arguments.length ? (e = typeof u == "function" ? u : rt(+u), c) : e;
  }, c.cornerRadius = function(u) {
    return arguments.length ? (n = typeof u == "function" ? u : rt(+u), c) : n;
  }, c.padRadius = function(u) {
    return arguments.length ? (a = u == null ? null : typeof u == "function" ? u : rt(+u), c) : a;
  }, c.startAngle = function(u) {
    return arguments.length ? (i = typeof u == "function" ? u : rt(+u), c) : i;
  }, c.endAngle = function(u) {
    return arguments.length ? (r = typeof u == "function" ? u : rt(+u), c) : r;
  }, c.padAngle = function(u) {
    return arguments.length ? (o = typeof u == "function" ? u : rt(+u), c) : o;
  }, c.context = function(u) {
    return arguments.length ? (s = u ?? null, c) : s;
  }, c;
}
function ir(t) {
  return typeof t == "object" && "length" in t ? t : Array.from(t);
}
function Ns(t) {
  this._context = t;
}
Ns.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._point = 0;
  },
  lineEnd: function() {
    (this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1, this._line ? this._context.lineTo(t, e) : this._context.moveTo(t, e);
        break;
      case 1:
        this._point = 2;
      // falls through
      default:
        this._context.lineTo(t, e);
        break;
    }
  }
};
function rr(t) {
  return new Ns(t);
}
function Bs(t) {
  return t[0];
}
function Xs(t) {
  return t[1];
}
function Gs(t, e) {
  var n = rt(!0), a = null, i = rr, r = null, o = ar(s);
  t = typeof t == "function" ? t : t === void 0 ? Bs : rt(t), e = typeof e == "function" ? e : e === void 0 ? Xs : rt(e);
  function s(l) {
    var c, u = (l = ir(l)).length, f, h = !1, d;
    for (a == null && (r = i(d = o())), c = 0; c <= u; ++c)
      !(c < u && n(f = l[c], c, l)) === h && ((h = !h) ? r.lineStart() : r.lineEnd()), h && r.point(+t(f, c, l), +e(f, c, l));
    if (d) return r = null, d + "" || null;
  }
  return s.x = function(l) {
    return arguments.length ? (t = typeof l == "function" ? l : rt(+l), s) : t;
  }, s.y = function(l) {
    return arguments.length ? (e = typeof l == "function" ? l : rt(+l), s) : e;
  }, s.defined = function(l) {
    return arguments.length ? (n = typeof l == "function" ? l : rt(!!l), s) : n;
  }, s.curve = function(l) {
    return arguments.length ? (i = l, a != null && (r = i(a)), s) : i;
  }, s.context = function(l) {
    return arguments.length ? (l == null ? a = r = null : r = i(a = l), s) : a;
  }, s;
}
function Iv(t, e, n) {
  var a = null, i = rt(!0), r = null, o = rr, s = null, l = ar(c);
  t = typeof t == "function" ? t : t === void 0 ? Bs : rt(+t), e = typeof e == "function" ? e : rt(e === void 0 ? 0 : +e), n = typeof n == "function" ? n : n === void 0 ? Xs : rt(+n);
  function c(f) {
    var h, d, v, _ = (f = ir(f)).length, p, g = !1, x, y = new Array(_), m = new Array(_);
    for (r == null && (s = o(x = l())), h = 0; h <= _; ++h) {
      if (!(h < _ && i(p = f[h], h, f)) === g)
        if (g = !g)
          d = h, s.areaStart(), s.lineStart();
        else {
          for (s.lineEnd(), s.lineStart(), v = h - 1; v >= d; --v)
            s.point(y[v], m[v]);
          s.lineEnd(), s.areaEnd();
        }
      g && (y[h] = +t(p, h, f), m[h] = +e(p, h, f), s.point(a ? +a(p, h, f) : y[h], n ? +n(p, h, f) : m[h]));
    }
    if (x) return s = null, x + "" || null;
  }
  function u() {
    return Gs().defined(i).curve(o).context(r);
  }
  return c.x = function(f) {
    return arguments.length ? (t = typeof f == "function" ? f : rt(+f), a = null, c) : t;
  }, c.x0 = function(f) {
    return arguments.length ? (t = typeof f == "function" ? f : rt(+f), c) : t;
  }, c.x1 = function(f) {
    return arguments.length ? (a = f == null ? null : typeof f == "function" ? f : rt(+f), c) : a;
  }, c.y = function(f) {
    return arguments.length ? (e = typeof f == "function" ? f : rt(+f), n = null, c) : e;
  }, c.y0 = function(f) {
    return arguments.length ? (e = typeof f == "function" ? f : rt(+f), c) : e;
  }, c.y1 = function(f) {
    return arguments.length ? (n = f == null ? null : typeof f == "function" ? f : rt(+f), c) : n;
  }, c.lineX0 = c.lineY0 = function() {
    return u().x(t).y(e);
  }, c.lineY1 = function() {
    return u().x(t).y(n);
  }, c.lineX1 = function() {
    return u().x(a).y(e);
  }, c.defined = function(f) {
    return arguments.length ? (i = typeof f == "function" ? f : rt(!!f), c) : i;
  }, c.curve = function(f) {
    return arguments.length ? (o = f, r != null && (s = o(r)), c) : o;
  }, c.context = function(f) {
    return arguments.length ? (f == null ? r = s = null : s = o(r = f), c) : r;
  }, c;
}
function zv(t, e) {
  return e < t ? -1 : e > t ? 1 : e >= t ? 0 : NaN;
}
function Pv(t) {
  return t;
}
function Ov() {
  var t = Pv, e = zv, n = null, a = rt(0), i = rt(ta), r = rt(0);
  function o(s) {
    var l, c = (s = ir(s)).length, u, f, h = 0, d = new Array(c), v = new Array(c), _ = +a.apply(this, arguments), p = Math.min(ta, Math.max(-ta, i.apply(this, arguments) - _)), g, x = Math.min(Math.abs(p) / c, r.apply(this, arguments)), y = x * (p < 0 ? -1 : 1), m;
    for (l = 0; l < c; ++l)
      (m = v[d[l] = l] = +t(s[l], l, s)) > 0 && (h += m);
    for (e != null ? d.sort(function(T, b) {
      return e(v[T], v[b]);
    }) : n != null && d.sort(function(T, b) {
      return n(s[T], s[b]);
    }), l = 0, f = h ? (p - c * y) / h : 0; l < c; ++l, _ = g)
      u = d[l], m = v[u], g = _ + (m > 0 ? m * f : 0) + y, v[u] = {
        data: s[u],
        index: l,
        value: m,
        startAngle: _,
        endAngle: g,
        padAngle: x
      };
    return v;
  }
  return o.value = function(s) {
    return arguments.length ? (t = typeof s == "function" ? s : rt(+s), o) : t;
  }, o.sortValues = function(s) {
    return arguments.length ? (e = s, n = null, o) : e;
  }, o.sort = function(s) {
    return arguments.length ? (n = s, e = null, o) : n;
  }, o.startAngle = function(s) {
    return arguments.length ? (a = typeof s == "function" ? s : rt(+s), o) : a;
  }, o.endAngle = function(s) {
    return arguments.length ? (i = typeof s == "function" ? s : rt(+s), o) : i;
  }, o.padAngle = function(s) {
    return arguments.length ? (r = typeof s == "function" ? s : rt(+s), o) : r;
  }, o;
}
function $e() {
}
function ma(t, e, n) {
  t._context.bezierCurveTo(
    (2 * t._x0 + t._x1) / 3,
    (2 * t._y0 + t._y1) / 3,
    (t._x0 + 2 * t._x1) / 3,
    (t._y0 + 2 * t._y1) / 3,
    (t._x0 + 4 * t._x1 + e) / 6,
    (t._y0 + 4 * t._y1 + n) / 6
  );
}
function Da(t) {
  this._context = t;
}
Da.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._y0 = this._y1 = NaN, this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 3:
        ma(this, this._x1, this._y1);
      // falls through
      case 2:
        this._context.lineTo(this._x1, this._y1);
        break;
    }
    (this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1, this._line ? this._context.lineTo(t, e) : this._context.moveTo(t, e);
        break;
      case 1:
        this._point = 2;
        break;
      case 2:
        this._point = 3, this._context.lineTo((5 * this._x0 + this._x1) / 6, (5 * this._y0 + this._y1) / 6);
      // falls through
      default:
        ma(this, t, e);
        break;
    }
    this._x0 = this._x1, this._x1 = t, this._y0 = this._y1, this._y1 = e;
  }
};
function Fv(t) {
  return new Da(t);
}
function Ys(t) {
  this._context = t;
}
Ys.prototype = {
  areaStart: $e,
  areaEnd: $e,
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._x3 = this._x4 = this._y0 = this._y1 = this._y2 = this._y3 = this._y4 = NaN, this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 1: {
        this._context.moveTo(this._x2, this._y2), this._context.closePath();
        break;
      }
      case 2: {
        this._context.moveTo((this._x2 + 2 * this._x3) / 3, (this._y2 + 2 * this._y3) / 3), this._context.lineTo((this._x3 + 2 * this._x2) / 3, (this._y3 + 2 * this._y2) / 3), this._context.closePath();
        break;
      }
      case 3: {
        this.point(this._x2, this._y2), this.point(this._x3, this._y3), this.point(this._x4, this._y4);
        break;
      }
    }
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1, this._x2 = t, this._y2 = e;
        break;
      case 1:
        this._point = 2, this._x3 = t, this._y3 = e;
        break;
      case 2:
        this._point = 3, this._x4 = t, this._y4 = e, this._context.moveTo((this._x0 + 4 * this._x1 + t) / 6, (this._y0 + 4 * this._y1 + e) / 6);
        break;
      default:
        ma(this, t, e);
        break;
    }
    this._x0 = this._x1, this._x1 = t, this._y0 = this._y1, this._y1 = e;
  }
};
function Nv(t) {
  return new Ys(t);
}
function Vs(t) {
  this._context = t;
}
Vs.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._y0 = this._y1 = NaN, this._point = 0;
  },
  lineEnd: function() {
    (this._line || this._line !== 0 && this._point === 3) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1;
        break;
      case 1:
        this._point = 2;
        break;
      case 2:
        this._point = 3;
        var n = (this._x0 + 4 * this._x1 + t) / 6, a = (this._y0 + 4 * this._y1 + e) / 6;
        this._line ? this._context.lineTo(n, a) : this._context.moveTo(n, a);
        break;
      case 3:
        this._point = 4;
      // falls through
      default:
        ma(this, t, e);
        break;
    }
    this._x0 = this._x1, this._x1 = t, this._y0 = this._y1, this._y1 = e;
  }
};
function Bv(t) {
  return new Vs(t);
}
function Us(t, e) {
  this._basis = new Da(t), this._beta = e;
}
Us.prototype = {
  lineStart: function() {
    this._x = [], this._y = [], this._basis.lineStart();
  },
  lineEnd: function() {
    var t = this._x, e = this._y, n = t.length - 1;
    if (n > 0)
      for (var a = t[0], i = e[0], r = t[n] - a, o = e[n] - i, s = -1, l; ++s <= n; )
        l = s / n, this._basis.point(
          this._beta * t[s] + (1 - this._beta) * (a + l * r),
          this._beta * e[s] + (1 - this._beta) * (i + l * o)
        );
    this._x = this._y = null, this._basis.lineEnd();
  },
  point: function(t, e) {
    this._x.push(+t), this._y.push(+e);
  }
};
const Xv = (function t(e) {
  function n(a) {
    return e === 1 ? new Da(a) : new Us(a, e);
  }
  return n.beta = function(a) {
    return t(+a);
  }, n;
})(0.85);
function ya(t, e, n) {
  t._context.bezierCurveTo(
    t._x1 + t._k * (t._x2 - t._x0),
    t._y1 + t._k * (t._y2 - t._y0),
    t._x2 + t._k * (t._x1 - e),
    t._y2 + t._k * (t._y1 - n),
    t._x2,
    t._y2
  );
}
function or(t, e) {
  this._context = t, this._k = (1 - e) / 6;
}
or.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._y0 = this._y1 = this._y2 = NaN, this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 2:
        this._context.lineTo(this._x2, this._y2);
        break;
      case 3:
        ya(this, this._x1, this._y1);
        break;
    }
    (this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1, this._line ? this._context.lineTo(t, e) : this._context.moveTo(t, e);
        break;
      case 1:
        this._point = 2, this._x1 = t, this._y1 = e;
        break;
      case 2:
        this._point = 3;
      // falls through
      default:
        ya(this, t, e);
        break;
    }
    this._x0 = this._x1, this._x1 = this._x2, this._x2 = t, this._y0 = this._y1, this._y1 = this._y2, this._y2 = e;
  }
};
const Gv = (function t(e) {
  function n(a) {
    return new or(a, e);
  }
  return n.tension = function(a) {
    return t(+a);
  }, n;
})(0);
function sr(t, e) {
  this._context = t, this._k = (1 - e) / 6;
}
sr.prototype = {
  areaStart: $e,
  areaEnd: $e,
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._x3 = this._x4 = this._x5 = this._y0 = this._y1 = this._y2 = this._y3 = this._y4 = this._y5 = NaN, this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 1: {
        this._context.moveTo(this._x3, this._y3), this._context.closePath();
        break;
      }
      case 2: {
        this._context.lineTo(this._x3, this._y3), this._context.closePath();
        break;
      }
      case 3: {
        this.point(this._x3, this._y3), this.point(this._x4, this._y4), this.point(this._x5, this._y5);
        break;
      }
    }
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1, this._x3 = t, this._y3 = e;
        break;
      case 1:
        this._point = 2, this._context.moveTo(this._x4 = t, this._y4 = e);
        break;
      case 2:
        this._point = 3, this._x5 = t, this._y5 = e;
        break;
      default:
        ya(this, t, e);
        break;
    }
    this._x0 = this._x1, this._x1 = this._x2, this._x2 = t, this._y0 = this._y1, this._y1 = this._y2, this._y2 = e;
  }
};
const Yv = (function t(e) {
  function n(a) {
    return new sr(a, e);
  }
  return n.tension = function(a) {
    return t(+a);
  }, n;
})(0);
function lr(t, e) {
  this._context = t, this._k = (1 - e) / 6;
}
lr.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._y0 = this._y1 = this._y2 = NaN, this._point = 0;
  },
  lineEnd: function() {
    (this._line || this._line !== 0 && this._point === 3) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1;
        break;
      case 1:
        this._point = 2;
        break;
      case 2:
        this._point = 3, this._line ? this._context.lineTo(this._x2, this._y2) : this._context.moveTo(this._x2, this._y2);
        break;
      case 3:
        this._point = 4;
      // falls through
      default:
        ya(this, t, e);
        break;
    }
    this._x0 = this._x1, this._x1 = this._x2, this._x2 = t, this._y0 = this._y1, this._y1 = this._y2, this._y2 = e;
  }
};
const Vv = (function t(e) {
  function n(a) {
    return new lr(a, e);
  }
  return n.tension = function(a) {
    return t(+a);
  }, n;
})(0);
function cr(t, e, n) {
  var a = t._x1, i = t._y1, r = t._x2, o = t._y2;
  if (t._l01_a > Ot) {
    var s = 2 * t._l01_2a + 3 * t._l01_a * t._l12_a + t._l12_2a, l = 3 * t._l01_a * (t._l01_a + t._l12_a);
    a = (a * s - t._x0 * t._l12_2a + t._x2 * t._l01_2a) / l, i = (i * s - t._y0 * t._l12_2a + t._y2 * t._l01_2a) / l;
  }
  if (t._l23_a > Ot) {
    var c = 2 * t._l23_2a + 3 * t._l23_a * t._l12_a + t._l12_2a, u = 3 * t._l23_a * (t._l23_a + t._l12_a);
    r = (r * c + t._x1 * t._l23_2a - e * t._l12_2a) / u, o = (o * c + t._y1 * t._l23_2a - n * t._l12_2a) / u;
  }
  t._context.bezierCurveTo(a, i, r, o, t._x2, t._y2);
}
function Hs(t, e) {
  this._context = t, this._alpha = e;
}
Hs.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._y0 = this._y1 = this._y2 = NaN, this._l01_a = this._l12_a = this._l23_a = this._l01_2a = this._l12_2a = this._l23_2a = this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 2:
        this._context.lineTo(this._x2, this._y2);
        break;
      case 3:
        this.point(this._x2, this._y2);
        break;
    }
    (this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    if (t = +t, e = +e, this._point) {
      var n = this._x2 - t, a = this._y2 - e;
      this._l23_a = Math.sqrt(this._l23_2a = Math.pow(n * n + a * a, this._alpha));
    }
    switch (this._point) {
      case 0:
        this._point = 1, this._line ? this._context.lineTo(t, e) : this._context.moveTo(t, e);
        break;
      case 1:
        this._point = 2;
        break;
      case 2:
        this._point = 3;
      // falls through
      default:
        cr(this, t, e);
        break;
    }
    this._l01_a = this._l12_a, this._l12_a = this._l23_a, this._l01_2a = this._l12_2a, this._l12_2a = this._l23_2a, this._x0 = this._x1, this._x1 = this._x2, this._x2 = t, this._y0 = this._y1, this._y1 = this._y2, this._y2 = e;
  }
};
const Uv = (function t(e) {
  function n(a) {
    return e ? new Hs(a, e) : new or(a, 0);
  }
  return n.alpha = function(a) {
    return t(+a);
  }, n;
})(0.5);
function Ws(t, e) {
  this._context = t, this._alpha = e;
}
Ws.prototype = {
  areaStart: $e,
  areaEnd: $e,
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._x3 = this._x4 = this._x5 = this._y0 = this._y1 = this._y2 = this._y3 = this._y4 = this._y5 = NaN, this._l01_a = this._l12_a = this._l23_a = this._l01_2a = this._l12_2a = this._l23_2a = this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 1: {
        this._context.moveTo(this._x3, this._y3), this._context.closePath();
        break;
      }
      case 2: {
        this._context.lineTo(this._x3, this._y3), this._context.closePath();
        break;
      }
      case 3: {
        this.point(this._x3, this._y3), this.point(this._x4, this._y4), this.point(this._x5, this._y5);
        break;
      }
    }
  },
  point: function(t, e) {
    if (t = +t, e = +e, this._point) {
      var n = this._x2 - t, a = this._y2 - e;
      this._l23_a = Math.sqrt(this._l23_2a = Math.pow(n * n + a * a, this._alpha));
    }
    switch (this._point) {
      case 0:
        this._point = 1, this._x3 = t, this._y3 = e;
        break;
      case 1:
        this._point = 2, this._context.moveTo(this._x4 = t, this._y4 = e);
        break;
      case 2:
        this._point = 3, this._x5 = t, this._y5 = e;
        break;
      default:
        cr(this, t, e);
        break;
    }
    this._l01_a = this._l12_a, this._l12_a = this._l23_a, this._l01_2a = this._l12_2a, this._l12_2a = this._l23_2a, this._x0 = this._x1, this._x1 = this._x2, this._x2 = t, this._y0 = this._y1, this._y1 = this._y2, this._y2 = e;
  }
};
const Hv = (function t(e) {
  function n(a) {
    return e ? new Ws(a, e) : new sr(a, 0);
  }
  return n.alpha = function(a) {
    return t(+a);
  }, n;
})(0.5);
function Zs(t, e) {
  this._context = t, this._alpha = e;
}
Zs.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._x2 = this._y0 = this._y1 = this._y2 = NaN, this._l01_a = this._l12_a = this._l23_a = this._l01_2a = this._l12_2a = this._l23_2a = this._point = 0;
  },
  lineEnd: function() {
    (this._line || this._line !== 0 && this._point === 3) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    if (t = +t, e = +e, this._point) {
      var n = this._x2 - t, a = this._y2 - e;
      this._l23_a = Math.sqrt(this._l23_2a = Math.pow(n * n + a * a, this._alpha));
    }
    switch (this._point) {
      case 0:
        this._point = 1;
        break;
      case 1:
        this._point = 2;
        break;
      case 2:
        this._point = 3, this._line ? this._context.lineTo(this._x2, this._y2) : this._context.moveTo(this._x2, this._y2);
        break;
      case 3:
        this._point = 4;
      // falls through
      default:
        cr(this, t, e);
        break;
    }
    this._l01_a = this._l12_a, this._l12_a = this._l23_a, this._l01_2a = this._l12_2a, this._l12_2a = this._l23_2a, this._x0 = this._x1, this._x1 = this._x2, this._x2 = t, this._y0 = this._y1, this._y1 = this._y2, this._y2 = e;
  }
};
const Wv = (function t(e) {
  function n(a) {
    return e ? new Zs(a, e) : new lr(a, 0);
  }
  return n.alpha = function(a) {
    return t(+a);
  }, n;
})(0.5);
function qs(t) {
  this._context = t;
}
qs.prototype = {
  areaStart: $e,
  areaEnd: $e,
  lineStart: function() {
    this._point = 0;
  },
  lineEnd: function() {
    this._point && this._context.closePath();
  },
  point: function(t, e) {
    t = +t, e = +e, this._point ? this._context.lineTo(t, e) : (this._point = 1, this._context.moveTo(t, e));
  }
};
function Zv(t) {
  return new qs(t);
}
function co(t) {
  return t < 0 ? -1 : 1;
}
function uo(t, e, n) {
  var a = t._x1 - t._x0, i = e - t._x1, r = (t._y1 - t._y0) / (a || i < 0 && -0), o = (n - t._y1) / (i || a < 0 && -0), s = (r * i + o * a) / (a + i);
  return (co(r) + co(o)) * Math.min(Math.abs(r), Math.abs(o), 0.5 * Math.abs(s)) || 0;
}
function fo(t, e) {
  var n = t._x1 - t._x0;
  return n ? (3 * (t._y1 - t._y0) / n - e) / 2 : e;
}
function ai(t, e, n) {
  var a = t._x0, i = t._y0, r = t._x1, o = t._y1, s = (r - a) / 3;
  t._context.bezierCurveTo(a + s, i + s * e, r - s, o - s * n, r, o);
}
function ba(t) {
  this._context = t;
}
ba.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x0 = this._x1 = this._y0 = this._y1 = this._t0 = NaN, this._point = 0;
  },
  lineEnd: function() {
    switch (this._point) {
      case 2:
        this._context.lineTo(this._x1, this._y1);
        break;
      case 3:
        ai(this, this._t0, fo(this, this._t0));
        break;
    }
    (this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
  },
  point: function(t, e) {
    var n = NaN;
    if (t = +t, e = +e, !(t === this._x1 && e === this._y1)) {
      switch (this._point) {
        case 0:
          this._point = 1, this._line ? this._context.lineTo(t, e) : this._context.moveTo(t, e);
          break;
        case 1:
          this._point = 2;
          break;
        case 2:
          this._point = 3, ai(this, fo(this, n = uo(this, t, e)), n);
          break;
        default:
          ai(this, this._t0, n = uo(this, t, e));
          break;
      }
      this._x0 = this._x1, this._x1 = t, this._y0 = this._y1, this._y1 = e, this._t0 = n;
    }
  }
};
function js(t) {
  this._context = new Ks(t);
}
(js.prototype = Object.create(ba.prototype)).point = function(t, e) {
  ba.prototype.point.call(this, e, t);
};
function Ks(t) {
  this._context = t;
}
Ks.prototype = {
  moveTo: function(t, e) {
    this._context.moveTo(e, t);
  },
  closePath: function() {
    this._context.closePath();
  },
  lineTo: function(t, e) {
    this._context.lineTo(e, t);
  },
  bezierCurveTo: function(t, e, n, a, i, r) {
    this._context.bezierCurveTo(e, t, a, n, r, i);
  }
};
function qv(t) {
  return new ba(t);
}
function jv(t) {
  return new js(t);
}
function Js(t) {
  this._context = t;
}
Js.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x = [], this._y = [];
  },
  lineEnd: function() {
    var t = this._x, e = this._y, n = t.length;
    if (n)
      if (this._line ? this._context.lineTo(t[0], e[0]) : this._context.moveTo(t[0], e[0]), n === 2)
        this._context.lineTo(t[1], e[1]);
      else
        for (var a = ho(t), i = ho(e), r = 0, o = 1; o < n; ++r, ++o)
          this._context.bezierCurveTo(a[0][r], i[0][r], a[1][r], i[1][r], t[o], e[o]);
    (this._line || this._line !== 0 && n === 1) && this._context.closePath(), this._line = 1 - this._line, this._x = this._y = null;
  },
  point: function(t, e) {
    this._x.push(+t), this._y.push(+e);
  }
};
function ho(t) {
  var e, n = t.length - 1, a, i = new Array(n), r = new Array(n), o = new Array(n);
  for (i[0] = 0, r[0] = 2, o[0] = t[0] + 2 * t[1], e = 1; e < n - 1; ++e) i[e] = 1, r[e] = 4, o[e] = 4 * t[e] + 2 * t[e + 1];
  for (i[n - 1] = 2, r[n - 1] = 7, o[n - 1] = 8 * t[n - 1] + t[n], e = 1; e < n; ++e) a = i[e] / r[e - 1], r[e] -= a, o[e] -= a * o[e - 1];
  for (i[n - 1] = o[n - 1] / r[n - 1], e = n - 2; e >= 0; --e) i[e] = (o[e] - i[e + 1]) / r[e];
  for (r[n - 1] = (t[n] + i[n - 1]) / 2, e = 0; e < n - 1; ++e) r[e] = 2 * t[e + 1] - i[e + 1];
  return [i, r];
}
function Kv(t) {
  return new Js(t);
}
function Ia(t, e) {
  this._context = t, this._t = e;
}
Ia.prototype = {
  areaStart: function() {
    this._line = 0;
  },
  areaEnd: function() {
    this._line = NaN;
  },
  lineStart: function() {
    this._x = this._y = NaN, this._point = 0;
  },
  lineEnd: function() {
    0 < this._t && this._t < 1 && this._point === 2 && this._context.lineTo(this._x, this._y), (this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line >= 0 && (this._t = 1 - this._t, this._line = 1 - this._line);
  },
  point: function(t, e) {
    switch (t = +t, e = +e, this._point) {
      case 0:
        this._point = 1, this._line ? this._context.lineTo(t, e) : this._context.moveTo(t, e);
        break;
      case 1:
        this._point = 2;
      // falls through
      default: {
        if (this._t <= 0)
          this._context.lineTo(this._x, e), this._context.lineTo(t, e);
        else {
          var n = this._x * (1 - this._t) + t * this._t;
          this._context.lineTo(n, this._y), this._context.lineTo(n, e);
        }
        break;
      }
    }
    this._x = t, this._y = e;
  }
};
function Jv(t) {
  return new Ia(t, 0.5);
}
function Qv(t) {
  return new Ia(t, 0);
}
function tg(t) {
  return new Ia(t, 1);
}
function eg(t) {
  return t;
}
var ea = 1, na = 2, ki = 3, kn = 4, vo = 1e-6;
function ng(t) {
  return "translate(" + t + ",0)";
}
function ag(t) {
  return "translate(0," + t + ")";
}
function ig(t) {
  return (e) => +t(e);
}
function rg(t, e) {
  return e = Math.max(0, t.bandwidth() - e * 2) / 2, t.round() && (e = Math.round(e)), (n) => +t(n) + e;
}
function og() {
  return !this.__axis;
}
function za(t, e) {
  var n = [], a = null, i = null, r = 6, o = 6, s = 3, l = typeof window < "u" && window.devicePixelRatio > 1 ? 0 : 0.5, c = t === ea || t === kn ? -1 : 1, u = t === kn || t === na ? "x" : "y", f = t === ea || t === ki ? ng : ag;
  function h(d) {
    var v = a ?? (e.ticks ? e.ticks.apply(e, n) : e.domain()), _ = i ?? (e.tickFormat ? e.tickFormat.apply(e, n) : eg), p = Math.max(r, 0) + s, g = e.range(), x = +g[0] + l, y = +g[g.length - 1] + l, m = (e.bandwidth ? rg : ig)(e.copy(), l), T = d.selection ? d.selection() : d, b = T.selectAll(".domain").data([null]), w = T.selectAll(".tick").data(v, e).order(), A = w.exit(), k = w.enter().append("g").attr("class", "tick"), C = w.select("line"), E = w.select("text");
    b = b.merge(b.enter().insert("path", ".tick").attr("class", "domain").attr("stroke", "currentColor")), w = w.merge(k), C = C.merge(k.append("line").attr("stroke", "currentColor").attr(u + "2", c * r)), E = E.merge(k.append("text").attr("fill", "currentColor").attr(u, c * p).attr("dy", t === ea ? "0em" : t === ki ? "0.71em" : "0.32em")), d !== T && (b = b.transition(d), w = w.transition(d), C = C.transition(d), E = E.transition(d), A = A.transition(d).attr("opacity", vo).attr("transform", function(M) {
      return isFinite(M = m(M)) ? f(M + l) : this.getAttribute("transform");
    }), k.attr("opacity", vo).attr("transform", function(M) {
      var L = this.parentNode.__axis;
      return f((L && isFinite(L = L(M)) ? L : m(M)) + l);
    })), A.remove(), b.attr("d", t === kn || t === na ? o ? "M" + c * o + "," + x + "H" + l + "V" + y + "H" + c * o : "M" + l + "," + x + "V" + y : o ? "M" + x + "," + c * o + "V" + l + "H" + y + "V" + c * o : "M" + x + "," + l + "H" + y), w.attr("opacity", 1).attr("transform", function(M) {
      return f(m(M) + l);
    }), C.attr(u + "2", c * r), E.attr(u, c * p).text(_), T.filter(og).attr("fill", "none").attr("font-size", 10).attr("font-family", "sans-serif").attr("text-anchor", t === na ? "start" : t === kn ? "end" : "middle"), T.each(function() {
      this.__axis = m;
    });
  }
  return h.scale = function(d) {
    return arguments.length ? (e = d, h) : e;
  }, h.ticks = function() {
    return n = Array.from(arguments), h;
  }, h.tickArguments = function(d) {
    return arguments.length ? (n = d == null ? [] : Array.from(d), h) : n.slice();
  }, h.tickValues = function(d) {
    return arguments.length ? (a = d == null ? null : Array.from(d), h) : a && a.slice();
  }, h.tickFormat = function(d) {
    return arguments.length ? (i = d, h) : i;
  }, h.tickSize = function(d) {
    return arguments.length ? (r = o = +d, h) : r;
  }, h.tickSizeInner = function(d) {
    return arguments.length ? (r = +d, h) : r;
  }, h.tickSizeOuter = function(d) {
    return arguments.length ? (o = +d, h) : o;
  }, h.tickPadding = function(d) {
    return arguments.length ? (s = +d, h) : s;
  }, h.offset = function(d) {
    return arguments.length ? (l = +d, h) : l;
  }, h;
}
function sg(t) {
  return za(ea, t);
}
function lg(t) {
  return za(na, t);
}
function go(t) {
  return za(ki, t);
}
function po(t) {
  return za(kn, t);
}
function cg(t) {
  var e = 0, n = t.children, a = n && n.length;
  if (!a) e = 1;
  else for (; --a >= 0; ) e += n[a].value;
  t.value = e;
}
function ug() {
  return this.eachAfter(cg);
}
function fg(t, e) {
  let n = -1;
  for (const a of this)
    t.call(e, a, ++n, this);
  return this;
}
function hg(t, e) {
  for (var n = this, a = [n], i, r, o = -1; n = a.pop(); )
    if (t.call(e, n, ++o, this), i = n.children)
      for (r = i.length - 1; r >= 0; --r)
        a.push(i[r]);
  return this;
}
function dg(t, e) {
  for (var n = this, a = [n], i = [], r, o, s, l = -1; n = a.pop(); )
    if (i.push(n), r = n.children)
      for (o = 0, s = r.length; o < s; ++o)
        a.push(r[o]);
  for (; n = i.pop(); )
    t.call(e, n, ++l, this);
  return this;
}
function vg(t, e) {
  let n = -1;
  for (const a of this)
    if (t.call(e, a, ++n, this))
      return a;
}
function gg(t) {
  return this.eachAfter(function(e) {
    for (var n = +t(e.data) || 0, a = e.children, i = a && a.length; --i >= 0; ) n += a[i].value;
    e.value = n;
  });
}
function pg(t) {
  return this.eachBefore(function(e) {
    e.children && e.children.sort(t);
  });
}
function _g(t) {
  for (var e = this, n = xg(e, t), a = [e]; e !== n; )
    e = e.parent, a.push(e);
  for (var i = a.length; t !== n; )
    a.splice(i, 0, t), t = t.parent;
  return a;
}
function xg(t, e) {
  if (t === e) return t;
  var n = t.ancestors(), a = e.ancestors(), i = null;
  for (t = n.pop(), e = a.pop(); t === e; )
    i = t, t = n.pop(), e = a.pop();
  return i;
}
function mg() {
  for (var t = this, e = [t]; t = t.parent; )
    e.push(t);
  return e;
}
function yg() {
  return Array.from(this);
}
function bg() {
  var t = [];
  return this.eachBefore(function(e) {
    e.children || t.push(e);
  }), t;
}
function Tg() {
  var t = this, e = [];
  return t.each(function(n) {
    n !== t && e.push({ source: n.parent, target: n });
  }), e;
}
function* $g() {
  var t = this, e, n = [t], a, i, r;
  do
    for (e = n.reverse(), n = []; t = e.pop(); )
      if (yield t, a = t.children)
        for (i = 0, r = a.length; i < r; ++i)
          n.push(a[i]);
  while (n.length);
}
function ur(t, e) {
  t instanceof Map ? (t = [void 0, t], e === void 0 && (e = Sg)) : e === void 0 && (e = Ag);
  for (var n = new Ta(t), a, i = [n], r, o, s, l; a = i.pop(); )
    if ((o = e(a.data)) && (l = (o = Array.from(o)).length))
      for (a.children = o, s = l - 1; s >= 0; --s)
        i.push(r = o[s] = new Ta(o[s])), r.parent = a, r.depth = a.depth + 1;
  return n.eachBefore(Cg);
}
function wg() {
  return ur(this).eachBefore(kg);
}
function Ag(t) {
  return t.children;
}
function Sg(t) {
  return Array.isArray(t) ? t[1] : null;
}
function kg(t) {
  t.data.value !== void 0 && (t.value = t.data.value), t.data = t.data.data;
}
function Cg(t) {
  var e = 0;
  do
    t.height = e;
  while ((t = t.parent) && t.height < ++e);
}
function Ta(t) {
  this.data = t, this.depth = this.height = 0, this.parent = null;
}
Ta.prototype = ur.prototype = {
  constructor: Ta,
  count: ug,
  each: fg,
  eachAfter: dg,
  eachBefore: hg,
  find: vg,
  sum: gg,
  sort: pg,
  path: _g,
  ancestors: mg,
  descendants: yg,
  leaves: bg,
  links: Tg,
  copy: wg,
  [Symbol.iterator]: $g
};
function Rg(t) {
  if (typeof t != "function") throw new Error();
  return t;
}
function Tn() {
  return 0;
}
function $n(t) {
  return function() {
    return t;
  };
}
function Eg(t) {
  t.x0 = Math.round(t.x0), t.y0 = Math.round(t.y0), t.x1 = Math.round(t.x1), t.y1 = Math.round(t.y1);
}
function Pa(t, e, n, a, i) {
  for (var r = t.children, o, s = -1, l = r.length, c = t.value && (a - e) / t.value; ++s < l; )
    o = r[s], o.y0 = n, o.y1 = i, o.x0 = e, o.x1 = e += o.value * c;
}
function Oa(t, e, n, a, i) {
  for (var r = t.children, o, s = -1, l = r.length, c = t.value && (i - n) / t.value; ++s < l; )
    o = r[s], o.x0 = e, o.x1 = a, o.y0 = n, o.y1 = n += o.value * c;
}
var Qs = (1 + Math.sqrt(5)) / 2;
function tl(t, e, n, a, i, r) {
  for (var o = [], s = e.children, l, c, u = 0, f = 0, h = s.length, d, v, _ = e.value, p, g, x, y, m, T, b; u < h; ) {
    d = i - n, v = r - a;
    do
      p = s[f++].value;
    while (!p && f < h);
    for (g = x = p, T = Math.max(v / d, d / v) / (_ * t), b = p * p * T, m = Math.max(x / b, b / g); f < h; ++f) {
      if (p += c = s[f].value, c < g && (g = c), c > x && (x = c), b = p * p * T, y = Math.max(x / b, b / g), y > m) {
        p -= c;
        break;
      }
      m = y;
    }
    o.push(l = { value: p, dice: d < v, children: s.slice(u, f) }), l.dice ? Pa(l, n, a, i, _ ? a += v * p / _ : r) : Oa(l, n, a, _ ? n += d * p / _ : i, r), _ -= p, u = f;
  }
  return o;
}
const el = (function t(e) {
  function n(a, i, r, o, s) {
    tl(e, a, i, r, o, s);
  }
  return n.ratio = function(a) {
    return t((a = +a) > 1 ? a : 1);
  }, n;
})(Qs);
function Mg() {
  var t = el, e = !1, n = 1, a = 1, i = [0], r = Tn, o = Tn, s = Tn, l = Tn, c = Tn;
  function u(h) {
    return h.x0 = h.y0 = 0, h.x1 = n, h.y1 = a, h.eachBefore(f), i = [0], e && h.eachBefore(Eg), h;
  }
  function f(h) {
    var d = i[h.depth], v = h.x0 + d, _ = h.y0 + d, p = h.x1 - d, g = h.y1 - d;
    p < v && (v = p = (v + p) / 2), g < _ && (_ = g = (_ + g) / 2), h.x0 = v, h.y0 = _, h.x1 = p, h.y1 = g, h.children && (d = i[h.depth + 1] = r(h) / 2, v += c(h) - d, _ += o(h) - d, p -= s(h) - d, g -= l(h) - d, p < v && (v = p = (v + p) / 2), g < _ && (_ = g = (_ + g) / 2), t(h, v, _, p, g));
  }
  return u.round = function(h) {
    return arguments.length ? (e = !!h, u) : e;
  }, u.size = function(h) {
    return arguments.length ? (n = +h[0], a = +h[1], u) : [n, a];
  }, u.tile = function(h) {
    return arguments.length ? (t = Rg(h), u) : t;
  }, u.padding = function(h) {
    return arguments.length ? u.paddingInner(h).paddingOuter(h) : u.paddingInner();
  }, u.paddingInner = function(h) {
    return arguments.length ? (r = typeof h == "function" ? h : $n(+h), u) : r;
  }, u.paddingOuter = function(h) {
    return arguments.length ? u.paddingTop(h).paddingRight(h).paddingBottom(h).paddingLeft(h) : u.paddingTop();
  }, u.paddingTop = function(h) {
    return arguments.length ? (o = typeof h == "function" ? h : $n(+h), u) : o;
  }, u.paddingRight = function(h) {
    return arguments.length ? (s = typeof h == "function" ? h : $n(+h), u) : s;
  }, u.paddingBottom = function(h) {
    return arguments.length ? (l = typeof h == "function" ? h : $n(+h), u) : l;
  }, u.paddingLeft = function(h) {
    return arguments.length ? (c = typeof h == "function" ? h : $n(+h), u) : c;
  }, u;
}
function _o(t, e, n, a, i) {
  var r = t.children, o, s = r.length, l, c = new Array(s + 1);
  for (c[0] = l = o = 0; o < s; ++o)
    c[o + 1] = l += r[o].value;
  u(0, s, t.value, e, n, a, i);
  function u(f, h, d, v, _, p, g) {
    if (f >= h - 1) {
      var x = r[f];
      x.x0 = v, x.y0 = _, x.x1 = p, x.y1 = g;
      return;
    }
    for (var y = c[f], m = d / 2 + y, T = f + 1, b = h - 1; T < b; ) {
      var w = T + b >>> 1;
      c[w] < m ? T = w + 1 : b = w;
    }
    m - c[T - 1] < c[T] - m && f + 1 < T && --T;
    var A = c[T] - y, k = d - A;
    if (p - v > g - _) {
      var C = d ? (v * k + p * A) / d : p;
      u(f, T, A, v, _, C, g), u(T, h, k, C, _, p, g);
    } else {
      var E = d ? (_ * k + g * A) / d : g;
      u(f, T, A, v, _, p, E), u(T, h, k, v, E, p, g);
    }
  }
}
function Lg(t, e, n, a, i) {
  (t.depth & 1 ? Oa : Pa)(t, e, n, a, i);
}
const Dg = (function t(e) {
  function n(a, i, r, o, s) {
    if ((l = a._squarify) && l.ratio === e)
      for (var l, c, u, f, h = -1, d, v = l.length, _ = a.value; ++h < v; ) {
        for (c = l[h], u = c.children, f = c.value = 0, d = u.length; f < d; ++f) c.value += u[f].value;
        c.dice ? Pa(c, i, r, o, _ ? r += (s - r) * c.value / _ : s) : Oa(c, i, r, _ ? i += (o - i) * c.value / _ : o, s), _ -= c.value;
      }
    else
      a._squarify = l = tl(e, a, i, r, o, s), l.ratio = e;
  }
  return n.ratio = function(a) {
    return t((a = +a) > 1 ? a : 1);
  }, n;
})(Qs), Un = (t) => () => t;
function Ig(t, {
  sourceEvent: e,
  target: n,
  transform: a,
  dispatch: i
}) {
  Object.defineProperties(this, {
    type: { value: t, enumerable: !0, configurable: !0 },
    sourceEvent: { value: e, enumerable: !0, configurable: !0 },
    target: { value: n, enumerable: !0, configurable: !0 },
    transform: { value: a, enumerable: !0, configurable: !0 },
    _: { value: i }
  });
}
function de(t, e, n) {
  this.k = t, this.x = e, this.y = n;
}
de.prototype = {
  constructor: de,
  scale: function(t) {
    return t === 1 ? this : new de(this.k * t, this.x, this.y);
  },
  translate: function(t, e) {
    return t === 0 & e === 0 ? this : new de(this.k, this.x + this.k * t, this.y + this.k * e);
  },
  apply: function(t) {
    return [t[0] * this.k + this.x, t[1] * this.k + this.y];
  },
  applyX: function(t) {
    return t * this.k + this.x;
  },
  applyY: function(t) {
    return t * this.k + this.y;
  },
  invert: function(t) {
    return [(t[0] - this.x) / this.k, (t[1] - this.y) / this.k];
  },
  invertX: function(t) {
    return (t - this.x) / this.k;
  },
  invertY: function(t) {
    return (t - this.y) / this.k;
  },
  rescaleX: function(t) {
    return t.copy().domain(t.range().map(this.invertX, this).map(t.invert, t));
  },
  rescaleY: function(t) {
    return t.copy().domain(t.range().map(this.invertY, this).map(t.invert, t));
  },
  toString: function() {
    return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
  }
};
var ae = new de(1, 0, 0);
fr.prototype = de.prototype;
function fr(t) {
  for (; !t.__zoom; ) if (!(t = t.parentNode)) return ae;
  return t.__zoom;
}
function ii(t) {
  t.stopImmediatePropagation();
}
function wn(t) {
  t.preventDefault(), t.stopImmediatePropagation();
}
function zg(t) {
  return (!t.ctrlKey || t.type === "wheel") && !t.button;
}
function Pg() {
  var t = this;
  return t instanceof SVGElement ? (t = t.ownerSVGElement || t, t.hasAttribute("viewBox") ? (t = t.viewBox.baseVal, [[t.x, t.y], [t.x + t.width, t.y + t.height]]) : [[0, 0], [t.width.baseVal.value, t.height.baseVal.value]]) : [[0, 0], [t.clientWidth, t.clientHeight]];
}
function xo() {
  return this.__zoom || ae;
}
function Og(t) {
  return -t.deltaY * (t.deltaMode === 1 ? 0.05 : t.deltaMode ? 1 : 2e-3) * (t.ctrlKey ? 10 : 1);
}
function Fg() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function Ng(t, e, n) {
  var a = t.invertX(e[0][0]) - n[0][0], i = t.invertX(e[1][0]) - n[1][0], r = t.invertY(e[0][1]) - n[0][1], o = t.invertY(e[1][1]) - n[1][1];
  return t.translate(
    i > a ? (a + i) / 2 : Math.min(0, a) || Math.max(0, i),
    o > r ? (r + o) / 2 : Math.min(0, r) || Math.max(0, o)
  );
}
function Bg() {
  var t = zg, e = Pg, n = Ng, a = Og, i = Fg, r = [0, 1 / 0], o = [[-1 / 0, -1 / 0], [1 / 0, 1 / 0]], s = 250, l = Eh, c = On("start", "zoom", "end"), u, f, h, d = 500, v = 150, _ = 0, p = 10;
  function g($) {
    $.property("__zoom", xo).on("wheel.zoom", A, { passive: !1 }).on("mousedown.zoom", k).on("dblclick.zoom", C).filter(i).on("touchstart.zoom", E).on("touchmove.zoom", M).on("touchend.zoom touchcancel.zoom", L).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  g.transform = function($, D, S, R) {
    var z = $.selection ? $.selection() : $;
    z.property("__zoom", xo), $ !== z ? T($, D, S, R) : z.interrupt().each(function() {
      b(this, arguments).event(R).start().zoom(null, typeof D == "function" ? D.apply(this, arguments) : D).end();
    });
  }, g.scaleBy = function($, D, S, R) {
    g.scaleTo($, function() {
      var z = this.__zoom.k, P = typeof D == "function" ? D.apply(this, arguments) : D;
      return z * P;
    }, S, R);
  }, g.scaleTo = function($, D, S, R) {
    g.transform($, function() {
      var z = e.apply(this, arguments), P = this.__zoom, O = S == null ? m(z) : typeof S == "function" ? S.apply(this, arguments) : S, X = P.invert(O), G = typeof D == "function" ? D.apply(this, arguments) : D;
      return n(y(x(P, G), O, X), z, o);
    }, S, R);
  }, g.translateBy = function($, D, S, R) {
    g.transform($, function() {
      return n(this.__zoom.translate(
        typeof D == "function" ? D.apply(this, arguments) : D,
        typeof S == "function" ? S.apply(this, arguments) : S
      ), e.apply(this, arguments), o);
    }, null, R);
  }, g.translateTo = function($, D, S, R, z) {
    g.transform($, function() {
      var P = e.apply(this, arguments), O = this.__zoom, X = R == null ? m(P) : typeof R == "function" ? R.apply(this, arguments) : R;
      return n(ae.translate(X[0], X[1]).scale(O.k).translate(
        typeof D == "function" ? -D.apply(this, arguments) : -D,
        typeof S == "function" ? -S.apply(this, arguments) : -S
      ), P, o);
    }, R, z);
  };
  function x($, D) {
    return D = Math.max(r[0], Math.min(r[1], D)), D === $.k ? $ : new de(D, $.x, $.y);
  }
  function y($, D, S) {
    var R = D[0] - S[0] * $.k, z = D[1] - S[1] * $.k;
    return R === $.x && z === $.y ? $ : new de($.k, R, z);
  }
  function m($) {
    return [(+$[0][0] + +$[1][0]) / 2, (+$[0][1] + +$[1][1]) / 2];
  }
  function T($, D, S, R) {
    $.on("start.zoom", function() {
      b(this, arguments).event(R).start();
    }).on("interrupt.zoom end.zoom", function() {
      b(this, arguments).event(R).end();
    }).tween("zoom", function() {
      var z = this, P = arguments, O = b(z, P).event(R), X = e.apply(z, P), G = S == null ? m(X) : typeof S == "function" ? S.apply(z, P) : S, ht = Math.max(X[1][0] - X[0][0], X[1][1] - X[0][1]), et = z.__zoom, Q = typeof D == "function" ? D.apply(z, P) : D, B = l(et.invert(G).concat(ht / et.k), Q.invert(G).concat(ht / Q.k));
      return function(W) {
        if (W === 1) W = Q;
        else {
          var J = B(W), F = ht / J[2];
          W = new de(F, G[0] - J[0] * F, G[1] - J[1] * F);
        }
        O.zoom(null, W);
      };
    });
  }
  function b($, D, S) {
    return !S && $.__zooming || new w($, D);
  }
  function w($, D) {
    this.that = $, this.args = D, this.active = 0, this.sourceEvent = null, this.extent = e.apply($, D), this.taps = 0;
  }
  w.prototype = {
    event: function($) {
      return $ && (this.sourceEvent = $), this;
    },
    start: function() {
      return ++this.active === 1 && (this.that.__zooming = this, this.emit("start")), this;
    },
    zoom: function($, D) {
      return this.mouse && $ !== "mouse" && (this.mouse[1] = D.invert(this.mouse[0])), this.touch0 && $ !== "touch" && (this.touch0[1] = D.invert(this.touch0[0])), this.touch1 && $ !== "touch" && (this.touch1[1] = D.invert(this.touch1[0])), this.that.__zoom = D, this.emit("zoom"), this;
    },
    end: function() {
      return --this.active === 0 && (delete this.that.__zooming, this.emit("end")), this;
    },
    emit: function($) {
      var D = N(this.that).datum();
      c.call(
        $,
        this.that,
        new Ig($, {
          sourceEvent: this.sourceEvent,
          target: g,
          transform: this.that.__zoom,
          dispatch: c
        }),
        D
      );
    }
  };
  function A($, ...D) {
    if (!t.apply(this, arguments)) return;
    var S = b(this, D).event($), R = this.__zoom, z = Math.max(r[0], Math.min(r[1], R.k * Math.pow(2, a.apply(this, arguments)))), P = Ht($);
    if (S.wheel)
      (S.mouse[0][0] !== P[0] || S.mouse[0][1] !== P[1]) && (S.mouse[1] = R.invert(S.mouse[0] = P)), clearTimeout(S.wheel);
    else {
      if (R.k === z) return;
      S.mouse = [P, R.invert(P)], je(this), S.start();
    }
    wn($), S.wheel = setTimeout(O, v), S.zoom("mouse", n(y(x(R, z), S.mouse[0], S.mouse[1]), S.extent, o));
    function O() {
      S.wheel = null, S.end();
    }
  }
  function k($, ...D) {
    if (h || !t.apply(this, arguments)) return;
    var S = $.currentTarget, R = b(this, D, !0).event($), z = N($.view).on("mousemove.zoom", G, !0).on("mouseup.zoom", ht, !0), P = Ht($, S), O = $.clientX, X = $.clientY;
    Zi($.view), ii($), R.mouse = [P, this.__zoom.invert(P)], je(this), R.start();
    function G(et) {
      if (wn(et), !R.moved) {
        var Q = et.clientX - O, B = et.clientY - X;
        R.moved = Q * Q + B * B > _;
      }
      R.event(et).zoom("mouse", n(y(R.that.__zoom, R.mouse[0] = Ht(et, S), R.mouse[1]), R.extent, o));
    }
    function ht(et) {
      z.on("mousemove.zoom mouseup.zoom", null), qi(et.view, R.moved), wn(et), R.event(et).end();
    }
  }
  function C($, ...D) {
    if (t.apply(this, arguments)) {
      var S = this.__zoom, R = Ht($.changedTouches ? $.changedTouches[0] : $, this), z = S.invert(R), P = S.k * ($.shiftKey ? 0.5 : 2), O = n(y(x(S, P), R, z), e.apply(this, D), o);
      wn($), s > 0 ? N(this).transition().duration(s).call(T, O, R, $) : N(this).call(g.transform, O, R, $);
    }
  }
  function E($, ...D) {
    if (t.apply(this, arguments)) {
      var S = $.touches, R = S.length, z = b(this, D, $.changedTouches.length === R).event($), P, O, X, G;
      for (ii($), O = 0; O < R; ++O)
        X = S[O], G = Ht(X, this), G = [G, this.__zoom.invert(G), X.identifier], z.touch0 ? !z.touch1 && z.touch0[2] !== G[2] && (z.touch1 = G, z.taps = 0) : (z.touch0 = G, P = !0, z.taps = 1 + !!u);
      u && (u = clearTimeout(u)), P && (z.taps < 2 && (f = G[0], u = setTimeout(function() {
        u = null;
      }, d)), je(this), z.start());
    }
  }
  function M($, ...D) {
    if (this.__zooming) {
      var S = b(this, D).event($), R = $.changedTouches, z = R.length, P, O, X, G;
      for (wn($), P = 0; P < z; ++P)
        O = R[P], X = Ht(O, this), S.touch0 && S.touch0[2] === O.identifier ? S.touch0[0] = X : S.touch1 && S.touch1[2] === O.identifier && (S.touch1[0] = X);
      if (O = S.that.__zoom, S.touch1) {
        var ht = S.touch0[0], et = S.touch0[1], Q = S.touch1[0], B = S.touch1[1], W = (W = Q[0] - ht[0]) * W + (W = Q[1] - ht[1]) * W, J = (J = B[0] - et[0]) * J + (J = B[1] - et[1]) * J;
        O = x(O, Math.sqrt(W / J)), X = [(ht[0] + Q[0]) / 2, (ht[1] + Q[1]) / 2], G = [(et[0] + B[0]) / 2, (et[1] + B[1]) / 2];
      } else if (S.touch0) X = S.touch0[0], G = S.touch0[1];
      else return;
      S.zoom("touch", n(y(O, X, G), S.extent, o));
    }
  }
  function L($, ...D) {
    if (this.__zooming) {
      var S = b(this, D).event($), R = $.changedTouches, z = R.length, P, O;
      for (ii($), h && clearTimeout(h), h = setTimeout(function() {
        h = null;
      }, d), P = 0; P < z; ++P)
        O = R[P], S.touch0 && S.touch0[2] === O.identifier ? delete S.touch0 : S.touch1 && S.touch1[2] === O.identifier && delete S.touch1;
      if (S.touch1 && !S.touch0 && (S.touch0 = S.touch1, delete S.touch1), S.touch0) S.touch0[1] = this.__zoom.invert(S.touch0[0]);
      else if (S.end(), S.taps === 2 && (O = Ht(O, this), Math.hypot(f[0] - O[0], f[1] - O[1]) < p)) {
        var X = N(this).on("dblclick.zoom");
        X && X.apply(this, arguments);
      }
    }
  }
  return g.wheelDelta = function($) {
    return arguments.length ? (a = typeof $ == "function" ? $ : Un(+$), g) : a;
  }, g.filter = function($) {
    return arguments.length ? (t = typeof $ == "function" ? $ : Un(!!$), g) : t;
  }, g.touchable = function($) {
    return arguments.length ? (i = typeof $ == "function" ? $ : Un(!!$), g) : i;
  }, g.extent = function($) {
    return arguments.length ? (e = typeof $ == "function" ? $ : Un([[+$[0][0], +$[0][1]], [+$[1][0], +$[1][1]]]), g) : e;
  }, g.scaleExtent = function($) {
    return arguments.length ? (r[0] = +$[0], r[1] = +$[1], g) : [r[0], r[1]];
  }, g.translateExtent = function($) {
    return arguments.length ? (o[0][0] = +$[0][0], o[1][0] = +$[1][0], o[0][1] = +$[0][1], o[1][1] = +$[1][1], g) : [[o[0][0], o[0][1]], [o[1][0], o[1][1]]];
  }, g.constrain = function($) {
    return arguments.length ? (n = $, g) : n;
  }, g.duration = function($) {
    return arguments.length ? (s = +$, g) : s;
  }, g.interpolate = function($) {
    return arguments.length ? (l = $, g) : l;
  }, g.on = function() {
    var $ = c.on.apply(c, arguments);
    return $ === c ? g : $;
  }, g.clickDistance = function($) {
    return arguments.length ? (_ = ($ = +$) * $, g) : Math.sqrt(_);
  }, g.tapDistance = function($) {
    return arguments.length ? (p = +$, g) : p;
  }, g;
}
var K = function() {
  return K = Object.assign || function(e) {
    for (var n, a = 1, i = arguments.length; a < i; a++) {
      n = arguments[a];
      for (var r in n) Object.prototype.hasOwnProperty.call(n, r) && (e[r] = n[r]);
    }
    return e;
  }, K.apply(this, arguments);
};
function wt(t, e, n) {
  if (n || arguments.length === 2) for (var a = 0, i = e.length, r; a < i; a++)
    (r || !(a in e)) && (r || (r = Array.prototype.slice.call(e, 0, a)), r[a] = e[a]);
  return t.concat(r || Array.prototype.slice.call(e));
}
var j = {
  button: "bb-button",
  chart: "bb-chart",
  empty: "bb-empty",
  main: "bb-main",
  target: "bb-target",
  EXPANDED: "_expanded_",
  dummy: "_dummy_"
}, at = {
  arc: "bb-arc",
  arcLabelLine: "bb-arc-label-line",
  arcLabelLineText: "bb-arc-label-line-text",
  arcRange: "bb-arc-range",
  arcs: "bb-arcs",
  chartArc: "bb-chart-arc",
  chartArcs: "bb-chart-arcs",
  chartArcsBackground: "bb-chart-arcs-background",
  chartArcsTitle: "bb-chart-arcs-title",
  needle: "bb-needle"
}, $a = {
  area: "bb-area",
  areas: "bb-areas"
}, Rt = {
  axis: "bb-axis",
  axisX: "bb-axis-x",
  axisXLabel: "bb-axis-x-label",
  axisY: "bb-axis-y",
  axisY2: "bb-axis-y2",
  axisY2Label: "bb-axis-y2-label",
  axisYLabel: "bb-axis-y-label",
  axisXTooltip: "bb-axis-x-tooltip",
  axisYTooltip: "bb-axis-y-tooltip",
  axisY2Tooltip: "bb-axis-y2-tooltip",
  axisTooltipX: "bb-axis-tooltip-x",
  axisTooltipY: "bb-axis-tooltip-y"
}, Yt = {
  bar: "bb-bar",
  bars: "bb-bars",
  chartBar: "bb-chart-bar",
  chartBars: "bb-chart-bars",
  barConnectLine: "bb-bar-connectLine"
}, ce = {
  candlestick: "bb-candlestick",
  candlesticks: "bb-candlesticks",
  chartCandlestick: "bb-chart-candlestick",
  chartCandlesticks: "bb-chart-candlesticks",
  valueDown: "bb-value-down",
  valueUp: "bb-value-up"
}, Ft = {
  chartCircles: "bb-chart-circles",
  circle: "bb-circle",
  circles: "bb-circles"
}, Ci = {
  colorPattern: "bb-color-pattern",
  colorScale: "bb-colorscale"
}, ke = {
  dragarea: "bb-dragarea",
  INCLUDED: "_included_"
}, Cn = {
  funnel: "bb-funnel",
  chartFunnel: "bb-chart-funnel",
  chartFunnels: "bb-chart-funnels",
  funnelBackground: "bb-funnel-background"
}, Vt = {
  chartArcsGaugeMax: "bb-chart-arcs-gauge-max",
  chartArcsGaugeMin: "bb-chart-arcs-gauge-min",
  chartArcsGaugeUnit: "bb-chart-arcs-gauge-unit",
  chartArcsGaugeTitle: "bb-chart-arcs-gauge-title",
  gaugeValue: "bb-gauge-value"
}, dt = {
  legend: "bb-legend",
  legendBackground: "bb-legend-background",
  legendItem: "bb-legend-item",
  legendItemEvent: "bb-legend-item-event",
  legendItemHidden: "bb-legend-item-hidden",
  legendItemPoint: "bb-legend-item-point",
  legendItemTile: "bb-legend-item-tile"
}, ue = {
  chartLine: "bb-chart-line",
  chartLines: "bb-chart-lines",
  line: "bb-line",
  lines: "bb-lines"
}, Kt = {
  eventRect: "bb-event-rect",
  eventRects: "bb-event-rects",
  eventRectsMultiple: "bb-event-rects-multiple",
  eventRectsSingle: "bb-event-rects-single"
}, gt = {
  focused: "bb-focused",
  defocused: "bb-defocused",
  legendItemFocused: "bb-legend-item-focused",
  xgridFocus: "bb-xgrid-focus",
  ygridFocus: "bb-ygrid-focus"
}, Tt = {
  grid: "bb-grid",
  gridLines: "bb-grid-lines",
  xgrid: "bb-xgrid",
  xgridLine: "bb-xgrid-line",
  xgridLines: "bb-xgrid-lines",
  xgrids: "bb-xgrids",
  ygrid: "bb-ygrid",
  ygridLine: "bb-ygrid-line",
  ygridLines: "bb-ygrid-lines",
  ygrids: "bb-ygrids"
}, be = {
  level: "bb-level",
  levels: "bb-levels"
}, nl = {
  chartRadar: "bb-chart-radar",
  chartRadars: "bb-chart-radars"
}, In = {
  region: "bb-region",
  regions: "bb-regions"
}, xt = {
  selectedCircle: "bb-selected-circle",
  selectedCircles: "bb-selected-circles",
  SELECTED: "_selected_"
}, At = {
  shape: "bb-shape",
  shapes: "bb-shapes"
}, al = {
  brush: "bb-brush",
  subchart: "bb-subchart"
}, Ct = {
  chartText: "bb-chart-text",
  chartTexts: "bb-chart-texts",
  text: "bb-text",
  texts: "bb-texts",
  title: "bb-title",
  textBorderRect: "bb-text-border",
  textLabelImage: "bb-text-label-image",
  TextOverlapping: "text-overlapping"
}, aa = {
  tooltip: "bb-tooltip",
  tooltipContainer: "bb-tooltip-container",
  tooltipName: "bb-tooltip-name"
}, il = {
  treemap: "bb-treemap",
  chartTreemap: "bb-chart-treemap",
  chartTreemaps: "bb-chart-treemaps"
}, Ri = {
  buttonZoomReset: "bb-zoom-reset",
  zoomBrush: "bb-zoom-brush"
}, ut = K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K(K({}, j), at), $a), Rt), Yt), ce), Ft), Ci), ke), Vt), dt), ue), Kt), gt), Cn), Tt), nl), In), xt), At), al), Ct), aa), il), Ri), Xg = {
  /**
   * Set boost options
   * @name boost
   * @memberof Options
   * @type {object}
   * @property {object} boost boost object
   * @property {boolean} [boost.useCssRule=false] Avoid setting inline styles for each shape elements.
   * - **NOTE:**
   *   - Will append &lt;style> to the head tag and will add shpes' CSS rules dynamically.
   *   - For now, covers colors related properties (fill, stroke, etc.) only.
   * @property {boolean} [boost.useWorker=false] Use Web Worker as possible for processing.
   * - **NOTE:**
   *   - For now, only applies for data conversion at the initial time.
   *   - As of Web Worker's async nature, handling chart instance synchrously is not recommended.
   *   - When given data is empty, useWorker will be ignored.
   * @example
   *  boost: {
   *      useCssRule: true,
   *      useWorker: false
   *  }
   */
  boost_useCssRule: !1,
  boost_useWorker: !1
}, Gg = {
  /**
   * Set color of the data values
   * @name color
   * @memberof Options
   * @type {object}
   * @property {object} color color object
   * @property {string|object|((this: Chart, d: DataItem) => string)} [color.onover] Set the color value for each data point when mouse/touch onover event occurs.
   * @property {Array|null} [color.pattern=[]] Set custom color pattern. Passing `null` will not set a color for these elements, which requires the usage of custom CSS-based theming to work.
   * @property {(this: Chart) => SVGPathElement[]} [color.tiles] if defined, allows use svg's patterns to fill data area. It should return an array of [SVGPatternElement](https://developer.mozilla.org/en-US/docs/Web/API/SVGPatternElement).
   *  - **NOTE:** The pattern element's id will be defined as `bb-colorize-pattern-$COLOR-VALUE`.<br>
   *    ex. When color pattern value is `['red', '#fff']` and defined 2 patterns,then ids for pattern elements are:<br>
   *    - `bb-colorize-pattern-red`
   *    - `bb-colorize-pattern-fff`
   * @property {object} [color.threshold] color threshold for gauge and tooltip color
   * @property {string} [color.threshold.unit] If set to `value`, the threshold will be based on the data value. Otherwise it'll be based on equation of the `threshold.max` option value.
   * @property {Array} [color.threshold.values] Threshold values for each steps
   * @property {number} [color.threshold.max=100] The base value to determine threshold step value condition. When the given value is 15 and max 10, then the value for threshold is `15*100/10`.
   * @example
   *  color: {
   *      pattern: ["#1f77b4", "#aec7e8", ...],
   *
   *      // Set colors' patterns
   *      // it should return an array of SVGPatternElement
   *      tiles: function() {
   *         var pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
   *         var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
   *         var circle1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
   *
   *         pattern.setAttribute("patternUnits", "userSpaceOnUse");
   *         pattern.setAttribute("width", "32");
   *         pattern.setAttribute("height", "32");
   *
   *         g.style.fill = "#000";
   *         g.style.opacity = "0.2";
   *
   *         circle1.setAttribute("cx", "3");
   *         circle1.setAttribute("cy", "3");
   *         circle1.setAttribute("r", "3");
   *
   *         g.appendChild(circle1);
   *         pattern.appendChild(g);
   *
   *         return [pattern];
   *      },
   *
   *      // for threshold usage, pattern values should be set for each steps
   *      pattern: ["grey", "green", "yellow", "orange", "red"],
   *      threshold: {
   *          unit: "value",
   *
   *          // when value is 20 => 'green', value is 40 => 'orange' will be set.
   *          values: [10, 20, 30, 40, 50],
   *
   *          // the equation for max:
   *          // - unit == 'value': max => 30
   *          // - unit != 'value': max => value*100/30
   *          max: 30
   *      },
   *
   *      // set all data to 'red'
   *      onover: "red",
   *
   *      // set different color for data
   *      onover: {
   *          data1: "red",
   *          data2: "yellow"
   *      },
   *
   *      // will pass data object to the callback
   *      onover: function(d) {
   *          return d.id === "data1" ? "red" : "green";
   *      }
   *  }
   */
  color_pattern: [],
  color_tiles: void 0,
  color_threshold: {},
  color_onover: void 0
}, Yg = {
  /**
   * Legend options
   * @name legend
   * @memberof Options
   * @type {object}
   * @property {object} legend Legend object
   * @property {boolean} [legend.show=true] Show or hide legend.
   * @property {boolean} [legend.hide=false] Hide legend
   *  If true given, all legend will be hidden. If string or array given, only the legend that has the id will be hidden.
   * @property {string|HTMLElement} [legend.contents.bindto=undefined] Set CSS selector or element reference to bind legend items.
   * - **NOTE:** Should be used along with `legend.contents.template`.
   * @property {string|function} [legend.contents.template="<span style='color:#fff;padding:5px;background-color:{=COLOR}'>{=TITLE}</span>"] Set item's template.<br>
   *  - **NOTE:** Only common HTML tags are allowed to prevent XSS attacks. If creating charts from user input, it is recommended to sanitize input values to avoid potential vulnerabilities.
   *  - If set `string` value, within template the 'color' and 'title' can be replaced using template-like syntax string:
   *    - {=COLOR}: data color value
   *    - {=TITLE}: data title value
   *  - If set `function` value, will pass following arguments to the given function:
   *   - title {string}: data's id value
   *   - color {string}: color string
   *   - data {Array}: data array
   *  - **NOTE:** While basic XSS sanitization is applied, if you're allowing user-provided chart options in a service exposed to other users, you should implement additional security measures to prevent sophisticated XSS attacks.
   * @property {string} [legend.position=bottom] Change the position of legend.<br>
   *  Available values are: `bottom`, `right` and `inset` are supported.
   * @property {object} [legend.inset={anchor: 'top-left',x: 10,y: 0,step: undefined}] Change inset legend attributes.<br>
   *  This option accepts object that has the keys `anchor`, `x`, `y` and `step`.
   *  - **anchor** decides the position of the legend:
   *   - top-left
   *   - top-right
   *   - bottom-left
   *   - bottom-right
   *  - **x** and **y**:
   *   - set the position of the legend based on the anchor.
   *  - **step**:
   *   - defines the max step the legend has (e.g. If 2 set and legend has 3 legend item, the legend 2 columns).
   * @property {boolean} [legend.equally=false] Set to all items have same width size.
   * @property {number} [legend.padding=0] Set padding value
   * @property {boolean} [legend.item.interaction=true] Set legend item interaction.
   *  - **NOTE:**
   *    - This setting will not have effect on `.toggle()` method.
   *    - `legend.item.onXXX` listener options will work if set, regardless of this option value.
   * @property {boolean} [legend.item.interaction.dblclick=false] Set legend item to interact on double click.
   *  - **NOTE:**
   *    - Double clicking will make focused clicked dataseries only, hiding all others.
   *      - for single click case, `click + altKey(Win)/optionKey(Mac OS)` to have same effect.
   *    - To return initial state(which all dataseries are showing), double click current focused legend item again.
   *      - for single click case, `click + altKey(Win)/optionKey(Mac OS)` to have same effect.
   *    - In this case, default `click` interaction will be disabled.
   * @property {function} [legend.item.onclick=undefined] Set click event handler to the legend item.
   *  - **NOTE:**
   *    - When set, default `click` interaction will be disabled.
   *    - When `interaction.dblclick=true` is set, will be called on double click.
   * @property {function} [legend.item.onover=undefined] Set mouse/touch over event handler to the legend item.
   *  - **NOTE:** When set, default `mouseover` interaction will be disabled.
   * @property {function} [legend.item.onout=undefined] Set mouse/touch out event handler to the legend item.
   *  - **NOTE:** When set, default `mouseout` interaction will be disabled.
   * @property {number} [legend.item.tile.width=10] Set width for 'rectangle' legend item tile element.
   * @property {number} [legend.item.tile.height=10] Set height for 'rectangle' legend item tile element.
   * @property {number} [legend.item.tile.r=5] Set the radius for 'circle' legend item tile type.
   * @property {string} [legend.item.tile.type="rectangle"] Set legend item shape type.<br>
   * - **Available Values:**
   *   - circle
   *   - rectangle
   * @property {boolean} [legend.format] Set formatter function for legend text.
   * The argument:<br>
   *  - `id`: Legend text value. When `data.names` is specified, will pass from it, otherwise will pass data id.
   *  - `dataId`: When `data.names` specified, will pass the original data id. Otherwise will be undefined.
   * @property {boolean} [legend.tooltip=false] Show full legend text value using system tooltip(via `<title>` element).
   * @property {boolean} [legend.usePoint=false] Whether to use custom points in legend.
   * @see [Demo: format](https://naver.github.io/billboard.js/demo/#Legend.LegendFormat)
   * @see [Demo: item.interaction](https://naver.github.io/billboard.js/demo/#Legend.LegendItemInteraction)
   * @see [Demo: item.tile.type](https://naver.github.io/billboard.js/demo/#Legend.LegendItemTileType)
   * @see [Demo: position](https://naver.github.io/billboard.js/demo/#Legend.LegendPosition)
   * @see [Demo: contents.template](https://naver.github.io/billboard.js/demo/#Legend.LegendTemplate1)
   * @see [Demo: usePoint](https://naver.github.io/billboard.js/demo/#Legend.usePoint)
   * @example
   *  legend: {
   *      show: true,
   *      hide: true,
   *      //or hide: "data1"
   *      //or hide: ["data1", "data2"]
   *      contents: {
   *          bindto: "#legend",   // <ul id='legend'></ul>
   *
   *          // will be as: <li style='background-color:#1f77b4'>data1</li>
   *          template: "<li style='background-color:{=COLOR}'>{=TITLE}</li>"
   *
   *          // or using function
   *          template: function(id, color, data) {
   *               // if you want omit some legend, return falsy value
   *               if (id !== "data1") {
   *                    return "<li style='background-color:"+ color +">"+ id +"</li>";
   *               }
   *          }
   *      },
   *      position: "bottom",  // bottom, right, inset
   *      inset: {
   *          anchor: "top-right"  // top-left, top-right, bottom-left, bottom-right
   *          x: 20,
   *          y: 10,
   *          step: 2
   *      },
   *      equally: false,
   *      padding: 10,
   *      item: {
   *          // will disable default interaction
   *          interaction: false,
   *
   *          // set legend interact on double click
   *          // by double clicking, will make focused clicked dataseries only, hiding all others.
   *          interaction: {
   *            dblclick: true
   *          }
   *
   *          // when set below callback, will disable corresponding default interactions
   *          onclick: function(id, visible) {
   *           	// toggle based on the data visibility
   *           	this[visible ? "hide" : "show"](id);
   *          },
   *          onover: function(id, visible) { ... },
   *          onout: function(id, visible) { ... },
   *
   *          // set tile's size
   *          tile: {
   *              // set tile type
   *              type: "circle"  // or "rectangle" (default)
   *
   *              // width & height, are only applicable for 'rectangle' legend type
   *              width: 15,
   *              height: 15
   *
   *              // radius is only applicable for 'circle' legend type
   *              r: 10
   *          }
   *      },
   *      format: function(id, dataId) {
   *          // set ellipsis string when length is > 5
   *          // to get full legend value, combine with 'legend.tooltip=true'
   *          if (id.length > 5) {
   *            	id = id.substr(0, 5) + "...";
   *          }
   *
   *          return id;
   *      },
   *      tooltip: true,
   *      usePoint: true
   *  }
   */
  legend_contents_bindto: void 0,
  legend_contents_template: "<span style='color:#fff;padding:5px;background-color:{=COLOR}'>{=TITLE}</span>",
  legend_equally: !1,
  legend_hide: !1,
  legend_inset_anchor: "top-left",
  legend_inset_x: 10,
  legend_inset_y: 0,
  legend_inset_step: void 0,
  legend_item_interaction: !0,
  legend_item_dblclick: !1,
  legend_item_onclick: void 0,
  legend_item_onover: void 0,
  legend_item_onout: void 0,
  legend_item_tile_width: 10,
  legend_item_tile_height: 10,
  legend_item_tile_r: 5,
  legend_item_tile_type: "rectangle",
  legend_format: void 0,
  legend_padding: 0,
  legend_position: "bottom",
  legend_show: !0,
  legend_tooltip: !1,
  legend_usePoint: !1
}, Vg = {
  /**
   * Specify the CSS selector or the element which the chart will be set to. D3 selection object can be specified also.<br>
   * If another chart is already set, it will be replaced with the new one (only one chart can be set in one element).
   * - **NOTE:** In case the element doesn't exist or not specified, will add a `<div>` element to the body.
   * @name bindto
   * @memberof Options
   * @property {string|HTMLElement|d3.selection|object} [bindto="#chart"] Specify the element where chart will be drawn.
   * @property {string|HTMLElement|d3.selection} bindto.element="#chart" Specify the element where chart will be drawn.
   * @property {string} [bindto.classname=bb] Specify the class name of bind element.<br>
   *     **NOTE:** When the class name isn't `bb`, then you also need to update the default CSS to be rendered correctly.
   * @default #chart
   * @example
   * bindto: "#myContainer"
   *
   * // or HTMLElement
   * bindto: document.getElementById("myContainer")
   *
   * // or D3 selection object
   * bindto: d3.select("#myContainer")
   *
   * // or to change default classname
   * bindto: {
   *    element: "#chart",
   *    classname: "bill-board"  // ex) <div id='chart' class='bill-board'>
   * }
   */
  bindto: "#chart",
  /**
   * Set chart background.
   * @name background
   * @memberof Options
   * @property {object} background background object
   * @property {string} background.class Specify the class name for background element.
   * @property {string} background.color Specify the fill color for background element.<br>**NOTE:** Will be ignored if `imgUrl` option is set.
   * @property {string} background.imgUrl Specify the image url string for background.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#ChartOptions.Background)
   * @example
   * background: {
   *    class: "myClass",
   *    color: "red",
   *
   *    // Set image url for background.
   *    // If specified, 'color' option will be ignored.
   *    imgUrl: "https://naver.github.io/billboard.js/img/logo/billboard.js.svg",
   * }
   */
  background: {},
  /**
   * Set 'clip-path' attribute for chart element
   * - **NOTE:**
   *  > When false, chart node element is positioned after the axis node in DOM tree hierarchy.
   *  > This is to make the chart element positioned over axis element.
   * @name clipPath
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#ChartOptions.clipPath)
   * @example
   * // don't set 'clip-path' attribute
   * clipPath: false
   */
  clipPath: !0,
  /**
   * Set svg element's class name
   * @name svg
   * @memberof Options
   * @type {object}
   * @property {object} [svg] svg object
   * @property {string} [svg.classname] class name for svg element
   * @example
   * svg: {
   *   classname: "test_class"
   * }
   */
  svg_classname: void 0,
  /**
   * The desired size of the chart element.
   * If the value is not specified, the width of the chart will be calculated by the size of the parent element it's appended to.
   * @name size
   * @memberof Options
   * @type {object}
   * @property {object} [size] size object
   * @property {number} [size.width] width of the chart element
   * @property {number} [size.height] height of the chart element
   * @see [Demo](https://naver.github.io/billboard.js/demo/#ChartOptions.ChartSize)
   * @example
   * size: {
   *   width: 640,
   *   height: 480
   * }
   */
  size_width: void 0,
  size_height: void 0,
  /**
   * The padding of the chart element.
   * - **NOTE:** for more information, see the "[`Understanding padding`](https://github.com/naver/billboard.js/wiki/Understanding-padding)" wiki documentation.
   * @name padding
   * @memberof Options
   * @type {object}
   * @property {object|boolean} [padding=true] Set padding of chart, and accepts object or boolean type.
   * - `Object`: Specify each side's padding.
   * - `false`: Remove padding completely and make the shape fully occupy the container element.
   *   - In this case, axes and subchart will be hidden.
   *   - To adjust some padding from this state, use `axis.[x|y].padding` option.
   * @property {string} [padding.mode] padding mode
   * - `"fit"`: Reduce padding as much as possible to make chart fit to the container element for chart types w/axis.<br>When specified, all padding values will be relative from fitted value.
   * @property {number} [padding.top] padding on the top of chart
   * @property {number} [padding.right] padding on the right of chart
   * @property {number} [padding.bottom] padding on the bottom of chart
   * @property {number} [padding.left] padding on the left of chart
   * @see [Demo](https://naver.github.io/billboard.js/demo/#ChartOptions.Padding)
   * @see [Demo: Fit padding](https://naver.github.io/billboard.js/demo/#ChartOptions.FitPadding)
   * @example
   * // remove padding completely.
   * padding: false,
   *
   * padding: {
   *   // specifying mode value, will reduce padding and make fit to the container element.
   *   mode: "fit"
   *
   *   // when mode is "fit", all padding values will be relative from fitted value.
   *   // so, 0 will be initial fitted value.
   *   top: 20,
   *   right: 20,
   *   bottom: 20,
   *   left: 20
   * }
   *
   * // or specify padding value for each side
   * padding: {
   *   top: 20,
   *   right: 20,
   *   bottom: 20,
   *   left: 20
   * }
   */
  padding: !0,
  padding_mode: void 0,
  padding_left: void 0,
  padding_right: void 0,
  padding_top: void 0,
  padding_bottom: void 0,
  /**
   * Set chart resize options
   * @name resize
   * @memberof Options
   * @type {object}
   * @property {object} [resize] resize object
   * @property {boolean|string} [resize.auto=true] Set chart resize automatically on viewport changes.
   * - **NOTE:** Available options
   *   - true: Enables automatic resize.
   *   - false: Disables automatic resize.
   *   - "parent": Enables automatic resize when the parent node is resized.
   *   - "viewBox": Enables automatic resize, and size will be fixed based on the viewbox.
   * @property {boolean|number} [resize.timer=true] Set resize timer option.
   * - **NOTE:** Available options
   *   - The resize function will be called using:
   *     - true: `setTimeout()`
   *     - false: `requestIdleCallback()`
   *   - Given number(delay in ms) value, resize function will be triggered using `setTimeout()` with given delay.
   * @see [Demo: resize "parent"](https://naver.github.io/billboard.js/demo/#ChartOptions.resizeParent)
   * @see [Demo: resize "viewBox"](https://naver.github.io/billboard.js/demo/#ChartOptions.resizeViewBox)
   * @example
   *  resize: {
   *      auto: false,
   *
   *      // set resize based on parent node width value
   *      auto: "parent",
   *
   *      // set resize based on viewBox value
   *      auto: "viewBox",
   *
   *      // set resize function will be triggered using `setTimeout()`
   *      timer: true,
   *
   *      // set resize function will be triggered using `requestIdleCallback()`
   *      timer: false,
   *
   *      // set resize function will be triggered using `setTimeout()` with a delay of `100ms`.
   *      timer: 100
   *  }
   */
  resize_auto: !0,
  resize_timer: !0,
  /**
   * Set a callback to execute when the chart is clicked.
   * @name onclick
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onclick: function(event) {
   *   this; // chart instance itself
   *   event; // native event object
   *   ...
   * }
   */
  onclick: void 0,
  /**
   * Set a callback to execute when mouse/touch enters the chart.
   * @name onover
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onover: function(event) {
   *   this; // chart instance itself
   *   event; // native event object
   *   ...
   * }
   */
  onover: void 0,
  /**
   * Set a callback to execute when mouse/touch leaves the chart.
   * @name onout
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onout: function(event) {
   *   this; // chart instance itself
   *   event; // native event object
   *   ...
   * }
   */
  onout: void 0,
  /**
   * Set a callback to execute when user resizes the screen.
   * @name onresize
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onresize: function() {
   *   this; // chart instance itself
   *   ...
   * }
   */
  onresize: void 0,
  /**
   * Set a callback to execute when screen resize finished.
   * @name onresized
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onresized: function() {
   *   this; // chart instance itself
   *   ...
   * }
   */
  onresized: void 0,
  /**
   * Set a callback to execute before the chart is initialized
   * @name onbeforeinit
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onbeforeinit: function() {
   *   this; // chart instance itself
   *   ...
   * }
   */
  onbeforeinit: void 0,
  /**
   * Set a callback to execute when the chart is initialized.
   * @name oninit
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * oninit: function() {
   *   this; // chart instance itself
   *   ...
   * }
   */
  oninit: void 0,
  /**
   * Set a callback to execute after the chart is initialized
   * @name onafterinit
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onafterinit: function() {
   *   this; // chart instance itself
   *   ...
   * }
   */
  onafterinit: void 0,
  /**
   * Set a callback which is executed when the chart is rendered. Basically, this callback will be called in each time when the chart is redrawn.
   * @name onrendered
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * onrendered: function() {
   *   this; // chart instance itself
   *   ...
   * }
   */
  onrendered: void 0,
  /**
   * Set duration of transition (in milliseconds) for chart animation.<br><br>
   * - **NOTE:** If `0` or `null` is set, transition will be skipped. So, this makes initial rendering faster especially in case you have a lot of data.
   * @name transition
   * @memberof Options
   * @type {object}
   * @property {object} [transition] transition object
   * @property {number} [transition.duration=350] duration in milliseconds
   * @example
   * transition: {
   *    duration: 500
   * }
   */
  transition_duration: 250,
  /**
   * Set plugins
   * @name plugins
   * @memberof Options
   * @type {Array}
   * @example
   *  plugins: [
   *    new bb.plugin.stanford({ ... }),
   *    new PluginA(),
   *    ...
   * ]
   */
  plugins: [],
  /**
   * Control the render timing
   * @name render
   * @memberof Options
   * @type {object}
   * @property {object} [render] render object
   * @property {boolean} [render.lazy=true] Make it not render at initialization.
   * - **NOTE**:
   *   - Enabled by default when bind element's visibility is hidden.
   *   - When set to `false`, will initialize the chart regardless the bind element's visibility state, but in this case chart can't be guaranteed to be rendered properly.
   * @property {boolean} [render.observe=true] Observe bind element's visibility(`display` or `visibility` inline css property or class value) & render when it is visible automatically (for IEs, only works IE11+). When set to **false**, call [`.flush()`](./Chart.html#flush) to render.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#ChartOptions.LazyRender)
   * @example
   *  render: {
   *    lazy: true,
   *    observe: true
   * }
   *
   * @example
   * 	// <!-- render.lazy will detect visibility defined -->
   *  // (a) <div id='chart' class='hide'></div>
   *  // (b) <div id='chart' style='display:none'></div>
   *
   *  // render.lazy enabled by default when element is hidden
   *  var chart = bb.generate({ ... });
   *
   *  // chart will be rendered automatically when element's visibility changes
   *  // Note: works only for inlined css property or class attribute changes
   *  document.getElementById('chart').classList.remove('hide')  // (a)
   *  document.getElementById('chart').style.display = 'block';  // (b)
   *
   * @example
   * 	// chart won't be rendered and not observing bind element's visibility changes
   *  var chart = bb.generate({
   *     render: {
   *          lazy: true,
   *          observe: false
   *     }
   *  });
   *
   *  // call at any point when you want to render
   *  chart.flush();
   */
  render: {},
  /**
   * Show rectangles inside the chart.<br><br>
   * - **NOTE:**<br>
   *   - axis must be x, y or y2. start and end should be the value where regions start and end.
   *   - If not specified, the edge values will be used.
   *   - If timeseries x axis, date string, Date object and unixtime integer can be used.
   *   - If category x axis, category name can be used for start and end.
   *   - If class is set, the region element will have it as class.
   *
   * This option accept array of object with below values:
   * - `axis {string}`: 'x', 'y', or 'y2'
   * - `[start] {number|Date|string}`: Start position of the region. If not set, the start will be the edge of the chart.
   * - `[end] {number|Date|string}`: End position of the region. If not set, the end will be the edge of the chart.
   * - `[class] {string}`: Class value to apply to the region.
   * - `[label] {object}` Label text option.
   *   - `text {string}`: Text value.
   *   - `x {number}`: x Position.
   *   - `y {number}`: y Position.
   *   - `center {string}`: Align label at the center. Allowed values are 'x', 'y', 'xy'.
   *   - `color {string}`: Color string.
   *   - `rotated (boolean)`: Whether rotate label or not.
   * @name regions
   * @memberof Options
   * @type {Array}
   * @default []
   * @see [Demo: Regions](https://naver.github.io/billboard.js/demo/#Region.Region)
   * @see [Demo: Regions Timeseries](https://naver.github.io/billboard.js/demo/#Region.RegionWithTimeseries)
   * @see [Demo: Regions Label](https://naver.github.io/billboard.js/demo/#Region.RegionLabel)
   * @example
   *  regions: [
   *    {
   *      axis: "x",
   *      start: 1,
   *      end: 4,
   *      class: "region-1-4",
   *      label: {
   *      	text: "Region Text",
   *      	x: 5,  // position relative of the initial x coordinate
   *      	y: 5,  // position relative of the initial y coordinate
   *      	center: "xy",  // center text label in both direction.
   *      	color: "red",  // color string
   *      	rotated: true  // make text to show in vertical or horizontal
   *      }
   *    }
   *  ]
   */
  regions: []
}, Ug = {
  /**
   * Set title options
   * @name title
   * @memberof Options
   * @type {object}
   * @property {object} title Title object
   * @property {string} [title.text] Title text. If contains `\n`, it's used as line break allowing multiline title.
   * @property {number} [title.padding.top=0] Top padding value.
   * @property {number} [title.padding.right=0] Right padding value.
   * @property {number} [title.padding.bottom=0] Bottom padding value.
   * @property {number} [title.padding.left=0] Left padding value.
   * @property {string} [title.position=center] Available values are: 'center', 'right' and 'left'.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Title.MultilinedTitle)
   * @example
   *  title: {
   *      text: "Title Text",
   *
   *      // or Multiline title text
   *      text: "Main title text\nSub title text",
   *
   *      padding: {
   *          top: 10,
   *          right: 10,
   *          bottom: 10,
   *          left: 10
   *      },
   *      position: "center"
   *  }
   */
  title_text: void 0,
  title_padding: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  },
  title_position: "center"
}, Hg = {
  /**
   * Tooltip options
   * @name tooltip
   * @memberof Options
   * @type {object}
   * @property {object} tooltip Tooltip object
   * @property {boolean} [tooltip.show=true] Show or hide tooltip.
   * @property {boolean} [tooltip.doNotHide=false] Make tooltip keep showing not hiding on interaction.
   * @property {boolean} [tooltip.grouped=true] Set if tooltip is grouped or not for the data points.
   *   - **NOTE:** The overlapped data points will be displayed as grouped even if set false.
   * @property {boolean} [tooltip.linked=false] Set if tooltips on all visible charts with like x points are shown together when one is shown.
   * @property {string} [tooltip.linked.name=""] Groping name for linked tooltip.<br>If specified, linked tooltip will be groped interacting to be worked only with the same name.
   * @property {function} [tooltip.format.title] Set format for the title of tooltip.<br>
   *  Specified function receives x of the data point to show.
   * @property {function} [tooltip.format.name] Set format for the name of each data in tooltip.<br>
   *  Specified function receives name, ratio, id and index of the data point to show. ratio will be undefined if the chart is not donut/pie/gauge.
   * @property {function} [tooltip.format.value] Set format for the value of each data value in tooltip. If undefined returned, the row of that value will be skipped to be called.
   *  - Will pass following arguments to the given function:
   *    - `value {string}`: Value of the data point. If data row contains multiple or ranged(ex. candlestick, area range, etc.) value, formatter will be called as value length.
   *    - `ratio {number}`: Ratio of the data point in the `pie/donut/gauge` and `area/bar` when contains grouped data. Otherwise is `undefined`.
   *    - `id {string}`: id of the data point
   *    - `index {number}`: Index of the data point
   * @property {function} [tooltip.position] Set custom position function for the tooltip.<br>
   *  This option can be used to modify the tooltip position by returning object that has top and left.
   *  - Will pass following arguments to the given function:
   *    - `data {Array}`: Current selected data array object.
   *    - `width {number}`: Width of tooltip.
   *    - `height {number}`: Height of tooltip.
   *    - `element {SVGElement}`: Tooltip event bound element
   *    - `pos {object}`: Current position of the tooltip.
   * @property {function|object} [tooltip.contents] Set custom HTML for the tooltip.<br>
   *  If tooltip.grouped is true, data includes multiple data points.<br><br>
   *  Specified function receives `data` array and `defaultTitleFormat`, `defaultValueFormat` and `color` functions of the data point to show.
   *  - **Note:**
   *    - Only common HTML tags are allowed to prevent XSS attacks. If creating charts from user input, it is recommended to sanitize input values to avoid potential vulnerabilities.<br><br>
   *    - defaultTitleFormat:
   *      - if `axis.x.tick.format` option will be used if set.
   *      - otherwise, will return function based on tick format type(category, timeseries).
   *    - defaultValueFormat:
   * 	    - for Arc type (except gauge, radar), the function will return value from `(ratio * 100).toFixed(1)`.
   * 	    - for Axis based types, will be used `axis.[y|y2].tick.format` option value if is set.
   * 	    - otherwise, will parse value and return as number.
   * @property {string|HTMLElement} [tooltip.contents.bindto=undefined] Set CSS selector or element reference to bind tooltip.
   *  - **NOTE:** When is specified, will not be updating tooltip's position.
   * @property {string} [tooltip.contents.template=undefined] Set tooltip's template.
   *  - **NOTE:** Only common HTML tags are allowed to prevent XSS attacks. If creating charts from user input, it is recommended to sanitize input values to avoid potential vulnerabilities.<br><br>
   *  Within template, below syntax will be replaced using template-like syntax string:
   *    - **{{ ... }}**: the doubly curly brackets indicate loop block for data rows.
   *    - **{=CLASS_TOOLTIP}**: default tooltip class name `bb-tooltip`.
   *    - **{=CLASS_TOOLTIP_NAME}**: default tooltip data class name (ex. `bb-tooltip-name-data1`)
   *    - **{=TITLE}**: title value.
   *    - **{=COLOR}**: data color.
   *    - **{=NAME}**: data id value.
   *    - **{=VALUE}**: data value.
   *  - **NOTE:** While basic XSS sanitization is applied, if you're allowing user-provided chart options in a service exposed to other users, you should implement additional security measures to prevent sophisticated XSS attacks.
   * @property {object} [tooltip.contents.text=undefined] Set additional text content within data loop, using template syntax.
   *  - **NOTE:** It should contain `{ key: Array, ... }` value
   *    - 'key' name is used as substitution within template as '{=KEY}'
   *    - The value array length should match with the data length
   * @property {boolean} [tooltip.init.show=false] Show tooltip at the initialization.
   * @property {number} [tooltip.init.x=0] Set x Axis index(or index for Arc(donut, gauge, pie) types) to be shown at the initialization.
   * @property {object} [tooltip.init.position] Set the position of tooltip at the initialization.
   * @property {function} [tooltip.onshow] Set a callback that will be invoked before the tooltip is shown.
   * @property {function} [tooltip.onhide] Set a callback that will be invoked before the tooltip is hidden.
   * @property {function} [tooltip.onshown] Set a callback that will be invoked after the tooltip is shown
   * @property {function} [tooltip.onhidden] Set a callback that will be invoked after the tooltip is hidden.
   * @property {string|function|null} [tooltip.order=null] Set tooltip data display order.<br><br>
   *  **Available Values:**
   *  - `desc`: In descending data value order
   *  - `asc`: In ascending data value order
   *  - `null`: It keeps the data display order<br>
   *     **NOTE:** When `data.groups` is set, the order will follow as the stacked graph order.<br>
   *      If want to order as data bound, set any value rather than asc, desc or null. (ex. empty string "")
   *  - `function(data1, data2) { ... }`: [Array.sort compareFunction](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#Parameters)
   * @see [Demo: Hide Tooltip](https://naver.github.io/billboard.js/demo/#Tooltip.HideTooltip)
   * @see [Demo: Tooltip Grouping](https://naver.github.io/billboard.js/demo/#Tooltip.TooltipGrouping)
   * @see [Demo: Tooltip Format](https://naver.github.io/billboard.js/demo/#Tooltip.TooltipFormat)
   * @see [Demo: Linked Tooltip](https://naver.github.io/billboard.js/demo/#Tooltip.LinkedTooltips)
   * @see [Demo: Tooltip Position](https://naver.github.io/billboard.js/demo/#Tooltip.TooltipPosition)
   * @see [Demo: Tooltip Template](https://naver.github.io/billboard.js/demo/#Tooltip.TooltipTemplate)
   * @example
   *  tooltip: {
   *      show: true,
   *      doNotHide: true,
   *      grouped: false,
   *      format: {
   *          title: function(x) { return "Data " + x; },
   *          name: function(name, ratio, id, index) { return name; },
   *
   *          // If data row contains multiple or ranged(ex. candlestick, area range, etc.) value,
   *          // formatter will be called as value length times.
   *          value: function(value, ratio, id, index) { return ratio; }
   *      },
   *      position: function(data, width, height, element, pos) {
   *          // data: [{x, index, id, name, value}, ...]
   *          // width: Tooltip width
   *          // height: Tooltip height
   *          // element: Tooltip event bound element
   *          // pos: {
   *          //   x: Current mouse event x position,
   *          //   y: Current mouse event y position,
   *          //   xAxis: Current x Axis position (the value is given for axis based chart type only)
   *          //   yAxis: Current y Axis position value or function(the value is given for axis based chart type only)
   *          // }
   *
   *          // yAxis will work differently per data lengths
   *          // - a) Single data: `yAxis` will return `number` value
   *          // - b) Multiple data: `yAxis` will return a function with property value
   *
   *          // a) Single data:
   *          // Get y coordinate
   *          pos.yAxis; // y axis coordinate value of current data point
   *
   *          // b) Multiple data:
   *          // Get y coordinate of value 500, where 'data1' scales(y or y2).
   *          // When 'data.axes' option is used, data can bound to different axes.
   *          // - when "data.axes={data1: 'y'}", will return y value from y axis scale.
   *          // - when "data.axes={data1: 'y2'}", will return y value from y2 axis scale.
   *          pos.yAxis(500, "data1"); // will return y coordinate value of data1
   *
   *          pos.yAxis(500); // get y coordinate with value of 500, using y axis scale
   *          pos.yAxis(500, null, "y2"); // get y coordinate with value of 500, using y2 axis scale
   *
   *          return {
   *            top: 0,
   *            left: 0
   *          }
   *      },
   *
   *      contents: function(d, defaultTitleFormat, defaultValueFormat, color) {
   *          return ... // formatted html as you want
   *      },
   *
   *       // specify tooltip contents using template
   *       // - example of HTML returned:
   *       // <ul class="bb-tooltip">
   *       //   <li class="bb-tooltip-name-data1"><span>250</span><br><span style="color:#00c73c">data1</span></li>
   *       //   <li class="bb-tooltip-name-data2"><span>50</span><br><span style="color:#fa7171">data2</span></li>
   *       // </ul>
   *       contents: {
   *      	bindto: "#tooltip",
   *      	template: '<ul class={=CLASS_TOOLTIP}>{{' +
   *      			'<li class="{=CLASS_TOOLTIP_NAME}"><span>{=VALUE}</span><br>' +
   *      			'<span style=color:{=COLOR}>{=NAME}</span></li>' +
   *      		'}}</ul>'
   *      }
   *
   *       // with additional text value
   *       // - example of HTML returned:
   *       // <ul class="bb-tooltip">
   *       //   <li class="bb-tooltip-name-data1"><span>250</span><br>comment1<span style="color:#00c73c">data1</span>text1</li>
   *       //   <li class="bb-tooltip-name-data2"><span>50</span><br>comment2<span style="color:#fa7171">data2</span>text2</li>
   *       // </ul>
   *       contents: {
   *      	bindto: "#tooltip",
   *      	text: {
   *      		// a) 'key' name is used as substitution within template as '{=KEY}'
   *      		// b) the length should match with the data length
   *      		VAR1: ["text1", "text2"],
   *      		VAR2: ["comment1", "comment2"],
   *      	},
   *      	template: '<ul class={=CLASS_TOOLTIP}>{{' +
   *      			'<li class="{=CLASS_TOOLTIP_NAME}"><span>{=VALUE}</span>{=VAR2}<br>' +
   *      			'<span style=color:{=COLOR}>{=NAME}</span>{=VAR1}</li>' +
   *      		'}}</ul>'
   *      }
   *
   *      // sort tooltip data value display in ascending order
   *      order: "asc",
   *
   *      // specifying sort function
   *      order: function(a, b) {
   *         // param data passed format
   *         {x: 5, value: 250, id: "data1", index: 5, name: "data1"}
   *           ...
   *      },
   *
   *      // show at the initialization
   *      init: {
   *          show: true,
   *          x: 2, // x Axis index (or index for Arc(donut, gauge, pie) types)
   *          position: {
   *              top: "150px",  // specify as number or as string with 'px' unit string
   *              left: 250  // specify as number or as string with 'px' unit string
   *          }
   *      },
   *
   *      // fires prior tooltip is shown
   *      onshow: function(selectedData) {
   *      	// current dataset selected
   *      	// ==> [{x: 4, value: 150, id: "data2", index: 4, name: "data2"}, ...]
   *      	selectedData;
   *      },
   *
   *      // fires prior tooltip is hidden
   *      onhide: function(selectedData) {
   *      	// current dataset selected
   *      	// ==> [{x: 4, value: 150, id: "data2", index: 4, name: "data2"}, ...]
   *      	selectedData;
   *      },
   *
   *      // fires after tooltip is shown
   *      onshown: function(selectedData) {
   *      	// current dataset selected
   *      	// ==> [{x: 4, value: 150, id: "data2", index: 4, name: "data2"}, ...]
   *      	selectedData;
   *      },
   *
   *      // fires after tooltip is hidden
   *      onhidden: function(selectedData) {
   *      	// current dataset selected
   *      	// ==> [{x: 4, value: 150, id: "data2", index: 4, name: "data2"}, ...]
   *      	selectedData;
   *      },
   *
   *      // Link any tooltips when multiple charts are on the screen where same x coordinates are available
   *      // Useful for timeseries correlation
   *      linked: true,
   *
   *      // Specify name to interact those with the same name only.
   *      linked: {
   *          name: "some-group"
   *      }
   *  }
   */
  tooltip_show: !0,
  tooltip_doNotHide: !1,
  tooltip_grouped: !0,
  tooltip_format_title: void 0,
  tooltip_format_name: void 0,
  tooltip_format_value: void 0,
  tooltip_position: void 0,
  tooltip_contents: {},
  tooltip_init_show: !1,
  tooltip_init_x: 0,
  tooltip_init_position: void 0,
  tooltip_linked: !1,
  tooltip_linked_name: "",
  tooltip_onshow: function() {
  },
  tooltip_onhide: function() {
  },
  tooltip_onshown: function() {
  },
  tooltip_onhidden: function() {
  },
  tooltip_order: null
}, Wg = {
  /**
   * Specify the key of x values in the data.<br><br>
   * We can show the data with non-index x values by this option. This option is required when the type of x axis is timeseries. If this option is set on a category axis, the values of the data on the key will be used for category names.
   * @name data․x
   * @memberof Options
   * @type {string}
   * @default undefined
   * @example
   * data: {
   *   x: "date"
   * }
   */
  data_x: void 0,
  /**
   * Converts data id value
   * @name data․idConverter
   * @memberof Options
   * @type {function}
   * @default function(id) { return id; }
   * @example
   * data: {
   *    idConverter: function(id) {
   *       // when id is 'data1', converts to be 'data2'
   *       // 'data2' should be given as the initial data value
   *       if (id === "data1") {
   *          return "data2";
   *       } else {
   *          return id;
   *       }
   *    }
   * }
   */
  data_idConverter: function(t) {
    return t;
  },
  /**
   * Set custom data name.
   * If a name is set to `null`, the series is omitted from the legend.
   * @name data․names
   * @memberof Options
   * @type {object}
   * @default {}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataName)
   * @example
   * data: {
   *   names: {
   *     data1: "Data Name 1",
   *     data2: "Data Name 2"
   *   }
   * }
   */
  data_names: {},
  /**
   * Set custom data class.<br><br>
   * If this option is specified, the element g for the data has an additional class that has the prefix 'bb-target-' (eg. bb-target-additional-data1-class).
   * @name data․classes
   * @memberof Options
   * @type {object}
   * @default {}
   * @example
   * data: {
   *   classes: {
   *     data1: "additional-data1-class",
   *     data2: "additional-data2-class"
   *   }
   * }
   */
  data_classes: {},
  /**
   * Set chart type at once.<br><br>
   * If this option is specified, the type will be applied to every data. This setting can be overwritten by data.types.<br><br>
   * **Available Values:**
   * - area
   * - area-line-range
   * - area-spline
   * - area-spline-range
   * - area-step
   * - area-step-range
   * - bar
   * - bubble
   * - candlestick
   * - donut
   * - funnel
   * - gauge
   * - line
   * - pie
   * - polar
   * - radar
   * - scatter
   * - spline
   * - step
   * - treemap
   * @name data․type
   * @memberof Options
   * @type {string}
   * @default "line"<br>NOTE: When importing shapes by ESM, `line()` should be specified for type.
   * @example
   * data: {
   *    type: "bar"
   * }
   * @example
   * // Generate chart by importing ESM
   * // Import types to be used only, where this will make smaller bundle size.
   * import bb, {
   *   area,
   *   areaLineRange,
   *   areaSpline,
   *   areaSplineRange,
   *   areaStep,
   *   areaStepRange,
   *   bar,
   *   bubble,
   *   candlestick,
   *   donut,
   *   funnel,
   *   gauge,
   *   line,
   *   pie,
   *   polar,
   *   radar,
   *   scatter,
   *   spline,
   *   step,
   *   treemap
   * }
   *
   * bb.generate({
   *   ...,
   *   data: {
   *     type: bar()
   *   }
   * });
   */
  data_type: void 0,
  /**
   * Set chart type for each data.<br>
   * This setting overwrites data.type setting.
   * - **NOTE:** `radar` and `treemap` type can't be combined with other types.
   * @name data․types
   * @memberof Options
   * @type {object}
   * @default {}
   * @example
   * data: {
   *   types: {
   *     data1: "bar",
   *     data2: "spline"
   *   }
   * }
   * @example
   * // Generate chart by importing ESM
   * // Import types to be used only, where this will make smaller bundle size.
   * import bb, {
   *   area,
   *   areaLineRange,
   *   areaSpline,
   *   areaSplineRange,
   *   areaStep,
   *   areaStepRange,
   *   bar,
   *   bubble,
   *   candlestick,
   *   donut,
   *   funnel,
   *   gauge,
   *   line,
   *   pie,
   *   polar,
   *   radar,
   *   scatter,
   *   spline,
   *   step,
   *   treemap
   * }
   *
   * bb.generate({
   *   ...,
   *   data: {
   *     types: {
   *       data1: bar(),
   *       data1: spline()
   *     }
   *   }
   * });
   */
  data_types: {},
  /**
   *  This option changes the order of stacking data and pieces of pie/donut.
   *  - If `null` specified, it will be the order in which the data is loaded.
   *  - If a function is specified, it will be used as [Array.sort compareFunction](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#Parameters)<br><br>
   *
   *  **Available Values:**
   *  - `desc`: In descending order
   *  - `asc`: In ascending order
   *  - `null`: It keeps the data load order
   *  - `function(data1, data2) { ... }`: Array.sort compareFunction
   *
   *  **NOTE**: order function only works for Axis based types & Arc types, except `Radar` type.
   * @name data․order
   * @memberof Options
   * @type {string|function|null}
   * @default desc
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataOrder)
   * @example
   * data: {
   *   // in descending order (default)
   *   order: "desc"
   *
   *   // in ascending order
   *   order: "asc"
   *
   *   // keeps data input order
   *   order: null
   *
   *   // specifying sort function
   *   order: function(a, b) {
   *       // param data passed format
   *       // {
   *       //   id: "data1", id_org: "data1", values: [
   *       //      {x: 5, value: 250, id: "data1", index: 5, name: "data1"},
   *       //       ...
   *       //   ]
   *       // }
   *
   *       const reducer = (p, c) => p + Math.abs(c.value);
   *       const aSum = a.values.reduce(reducer, 0);
   *       const bSum = b.values.reduce(reducer, 0);
   *
   *       // ascending order
   *       return aSum - bSum;
   *
   *       // descending order
   *       // return bSum - aSum;
   *   }
   * }
   */
  data_order: "desc",
  /**
   * Set groups for the data for stacking.
   * @name data․groups
   * @memberof Options
   * @type {Array}
   * @default []
   * @example
   * data: {
   *   groups: [
   *     ["data1", "data2"],
   *     ["data3"]
   *   ]
   * }
   */
  data_groups: [],
  /**
   * Set how zero value will be treated on groups.<br>
   * Possible values:
   * - `zero`: 0 will be positioned at the absolute axis zero point.
   * - `positive`: 0 will be positioned at the top of a stack.
   * - `negative`: 0 will be positioned at the bottom of a stack.
   * @name data․groupsZeroAs
   * @memberof Options
   * @type {string}
   * @default "positive"
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.Groups)
   * @example
   * data: {
   *   groupsZeroAs: "zero" // "positive" or "negative"
   * }
   */
  data_groupsZeroAs: "positive",
  /**
   * Set color converter function.<br><br>
   * This option should be a function and the specified function receives color (e.g. '#ff0000') and d that has data parameters like id, value, index, etc. And it must return a string that represents color (e.g. '#00ff00').
   * @name data․color
   * @memberof Options
   * @type {function}
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataColor)
   * @example
   * data: {
   *   color: function(color, d) { ... }
   * }
   */
  data_color: void 0,
  /**
   * Set color for each data.
   * @name data․colors
   * @memberof Options
   * @type {object}
   * @default {}
   * @example
   * data: {
   *   colors: {
   *     data1: "#ff0000",
   *     data2: function(d) {
   *        return "#000";
   *     }
   *     ...
   *   }
   * }
   */
  data_colors: {},
  /**
   * Set labels options
   * @name data․labels
   * @memberof Options
   * @type {object}
   * @property {object} data Data object
   * @property {boolean} [data.labels=false] Show or hide labels on each data point
   * @property {boolean} [data.labels.centered=false] Centerize labels on `bar` shape. (**NOTE:** works only for 'bar' type)
   * @property {function} [data.labels.format] Set formatter function for data labels.<br>
   * The formatter function receives 4 arguments such as `v, id, i, texts` and it **must return a string** (`\n` character will be used as line break) that will be shown as the label.<br><br>
   * The arguments are:<br>
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   *  - `texts` is an array of whole corresponding data series' text labels.<br><br>
   * Formatter function can be defined for each data by specifying as an object and D3 formatter function can be set (ex. d3.format('$'))
   * @property {string|object|function} [data.labels.backgroundColors] Set label text background colors.<br><br>
   * - **NOTE**: When a function is set, background colors can be specified one color per dataset.
   *   - Within the function, the last returned color for dataset will be used.
   *   - Only can control set or unset background color for each values.
   * @property {string|object|function} [data.labels.colors] Set label text colors.
   * @property {object|function} [data.labels.position] Set each dataset position, relative to the original.<br><br>
   * When a function is specified, it will receive 5 arguments such as `type, v, id, i, texts` and it must return a position number.<br><br>
   * The arguments are:<br>
   *  - `type` coordinate type string, which will be 'x' or 'y'.
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   *  - `texts` is an array of whole corresponding data series' text labels.<br><br>
   * @property {number} [data.labels.position.x=0] x coordinate position, relative to the original.
   * @property {number} [data.labels.position.y=0] y coordinate position, relative to the original.
   * @property {object} [data.labels.rotate] Rotate label text. Specify degree value in a range of `0 ~ 360`.
   * - **NOTE:** Depending on the rotate value, the text position needs to be adjusted manually(using `data.labels.position` option) to be shown nicely.
   * @property {boolean|object} [data.labels.border=false] Add border to data label text. NOTE: When set as `true`, styling isn't applied. Hence, you need to set it using `.bb-text-border` class.
   * @property {number|string|object} [data.labels.border.padding="3 5"] Border padding. Can be a single number, string or object with top, bottom, left, right properties.
   * @property {number} [data.labels.border.radius=10] Border radius value.
   * @property {number} [data.labels.border.strokeWidth=1] Border stroke width.
   * @property {string} [data.labels.border.stroke="#000"] Border stroke color.
   * @property {string} [data.labels.border.fill="none"] Border fill color.
   * @property {object|function} [data.labels.image] Set image to be displayed next to the label text.<br><br>
   * When a function is specified, it will receive 3 arguments such as `v, id, i` and it must return an image object with `url`, `width`, `height`, and optional `pos` properties.<br><br>
   * The arguments are:<br>
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   * @property {string} data.labels.image.url Image URL path. Can use placeholder `{=ID}` which will be replaced with the data ID.
   * @property {number} data.labels.image.width Image width in pixels.
   * @property {number} data.labels.image.height Image height in pixels.
   * @property {object} [data.labels.image.pos] Image position relative to the label text.
   * @property {number} [data.labels.image.pos.x=0] x coordinate position, relative to the original.
   * @property {number} [data.labels.image.pos.y=0] y coordinate position, relative to the original.
   * @memberof Options
   * @type {object}
   * @default {}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataLabel)
   * @see [Demo: label border](https://naver.github.io/billboard.js/demo/#Data.DataLabelBorder)
   * @see [Demo: label colors](https://naver.github.io/billboard.js/demo/#Data.DataLabelColors)
   * @see [Demo: label format](https://naver.github.io/billboard.js/demo/#Data.DataLabelFormat)
   * @see [Demo: label image](https://naver.github.io/billboard.js/demo/#Data.DataLabelImage)
   * @see [Demo: label multiline](https://naver.github.io/billboard.js/demo/#Data.DataLabelMultiline)
   * @see [Demo: label overlap](https://naver.github.io/billboard.js/demo/#Data.DataLabelOverlap)
   * @see [Demo: label position](https://naver.github.io/billboard.js/demo/#Data.DataLabelPosition)
   * @see [Demo: label rotate](https://naver.github.io/billboard.js/demo/#Data.DataLabelRotate)
   * @example
   * data: {
   *   labels: true,
   *
   *   // or set specific options
   *   labels: {
   *     format: function(v, id, i, texts) {
   *         ...
   *         // to multiline, return with '\n' character
   *         return "Line1\nLine2";
   *     },
   *
   *     // it's possible to set for each data
   *     format: {
   *         data1: function(v, id, i, texts) { ... },
   *         ...
   *     },
   *
   *     // align text to center of the 'bar' shape (works only for 'bar' type)
   *     centered: true,
   *
   *     // apply background color for label texts
   *     backgroundColors: "red",
   *
   *     // set different background colors per dataset
   *     backgroundColors: {
   *          data1: "green",
   *          data2: "yellow"
   *     },
   *
   *     // call back for label text background color
   *     backgroundColors: function(color, d) {
   *         // color: the default data label color string
   *         // data: ex) {x: 0, value: 200, id: "data3", index: 0}
   *         ....
   *         return d.value > 200 ? "cyan" : "red";
   *     },
   *
   *     // apply for all label texts
   *     colors: "red",
   *
   *     // set different colors per dataset
   *     // for not specified dataset, will have the default color value
   *     colors: {
   *        data1: "yellow",
   *        data3: "green"
   *     },
   *
   *     // call back for label text color
   *     colors: function(color, d) {
   *         // color: the default data label color string
   *         // data: ex) {x: 0, value: 200, id: "data3", index: 0}
   *         ....
   *         return d.value > 200 ? "cyan" : color;
   *     },
   *
   *     // return x, y coordinate position
   *     // apt to handle each text position manually
   *     position: function(type, v, id, i, texts) {
   *         ...
   *         return type == "x" ? 10 : 20;
   *     },
   *
   *     // set x, y coordinate position
   *     position: {
   *        x: -10,
   *        y: 10
   *     },
   *
   *     // or set x, y coordinate position by each dataset
   *     position: {
   *        data1: {x: 5, y: 5},
   *        data2: {x: 10, y: -20}
   *     },
   *
   * 	   // rotate degree for label text
   *     rotate: 90,
   *
   *     // add border to data label text
   *     // NOTE: When set as `true`, styling aren't applied. Hence, need to set using '.bb-text-border' class.
   *     // ex. ".bb-text-border { fill: red; stroke: #000; stroke-width: 2px; rx: 10px; ry: 10px; }"
   *     border: true,
   *
   *     // or set detailed border options
   *     border: {
   *        padding: 10,  // set all padding to 10
   *        padding: "5 10",  // set top and bottom padding to 5, left and right padding to 10
   *        padding: {  // specify each padding
   *           top: 3,
   *           bottom: 5,
   *           left: 10,
   *           right: 13
   *        },
   *        radius: 10,
   *        strokeWidth: 2,
   *        stroke: "#000",
   *        fill: "red"
   *     },
   *
   *     // set image to be displayed next to the label text
   *     image: {
   *        url: "./sample.svg",
   *
   *        // use placeholder to dynamically set image URL based on data ID
   *        url: "./images/{=ID}.svg",  // will be replaced to "./images/data1.svg", "./images/data2.svg", etc.
   *        width: 35,
   *        height: 35,
   *        pos: {
   *           x: 0,
   *           y: 0
   *        }
   *     },
   *
   *     // or use function to return image configuration dynamically
   *     image: function(v, id, i) {
   *        // v is the value of the data point where the label is shown.
   *        // id is the id of the data where the label is shown.
   *        // i is the index of the data series point where the label is shown.
   *
   *        // Return different images based on value
   *        if (v > 500) {
   *           return {
   *              url: "./high-value.svg",
   *              width: 40,
   *              height: 40,
   *              pos: { x: 0, y: 0 }
   *           };
   *        } else if (v > 100) {
   *           return {
   *              url: "./medium-value.svg",
   *              width: 30,
   *              height: 30,
   *              pos: { x: 0, y: 0 }
   *           };
   *        } else if(v < 5) {
   *        	// Return falsy value in case you don't want to show image
   *           return null;
   *        } else {
   *           return {
   *              url: "./low-value.svg",
   *              width: 20,
   *              height: 20,
   *              pos: { x: 0, y: 0 }
   *           };
   *        }
   *     }
   *   }
   * }
   */
  data_labels: {},
  data_labels_backgroundColors: void 0,
  data_labels_colors: void 0,
  data_labels_position: {},
  data_labels_imgUrl: void 0,
  /**
   * Hide each data when the chart appears.<br><br>
   * If true is specified, all of data will be hidden. If multiple ids are specified as an array, those will be hidden.
   * @name data․hide
   * @memberof Options
   * @type {boolean|Array}
   * @default false
   * @example
   * data: {
   *   // all of data will be hidden
   *   hide: true
   *
   *   // specified data will be hidden
   *   hide: ["data1", ...]
   * }
   */
  data_hide: !1,
  /**
   * Filter values to be shown
   * The data value is the same as the returned by `.data()`.
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter
   * @name data․filter
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * data: {
   *   // filter for id value
   *   filter: function(v) {
   *      // v: [{id: "data1", id_org: "data1", values: [
   *      //      {x: 0, value: 130, id: "data2", index: 0}, ...]
   *      //    }, ...]
   *      return v.id !== "data1";
   *   }
   */
  data_filter: void 0,
  /**
   * Set a callback for click event on each data point.<br><br>
   * This callback will be called when each data point is clicked and will receive `d` and element as the arguments.
   * - `d` is the data clicked and element is the element clicked.
   * - `element` is the current interacting svg element.
   * - In this callback, `this` will be the Chart object.
   * @name data․onclick
   * @memberof Options
   * @type {function}
   * @default function() {}
   * @example
   * data: {
   *     onclick: function(d, element) {
   *        // d - ex) {x: 4, value: 150, id: "data1", index: 4, name: "data1"}
   *        // element - <circle>
   *        ...
   *     }
   * }
   */
  data_onclick: function() {
  },
  /**
   * Set a callback for mouse/touch over event on each data point.<br><br>
   * This callback will be called when the mouse cursor or touch moves onto each data point and will receive `d` and `element` as the argument.
   * - `d` is the data where mouse cursor moves onto.
   * - `element` is the current interacting svg element.
   * - In this callback, `this` will be the Chart object.
   * @name data․onover
   * @memberof Options
   * @type {function}
   * @default function() {}
   * @example
   * data: {
   *     onover: function(d, element) {
   *        // d - ex) {x: 4, value: 150, id: "data1", index: 4}
   *        // element - <circle>
   *        ...
   *     }
   * }
   */
  data_onover: function() {
  },
  /**
   * Set a callback for mouse/touch out event on each data point.<br><br>
   * This callback will be called when the mouse cursor or touch moves out each data point and will receive `d` as the argument.
   * - `d` is the data where mouse cursor moves out.
   * - `element` is the current interacting svg element.
   * - In this callback, `this` will be the Chart object.
   * @name data․onout
   * @memberof Options
   * @type {function}
   * @default function() {}
   * @example
   * data: {
   *     onout: function(d, element) {
   *        // d - ex) {x: 4, value: 150, id: "data1", index: 4}
   *        // element - <circle>
   *        ...
   *     }
   * }
   */
  data_onout: function() {
  },
  /**
   * Set a callback for when data is shown.<br>
   * The callback will receive shown data ids in array.
   * @name data․onshown
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   *  data: {
   *    onshown: function(ids) {
   *      // ids - ["data1", "data2", ...]
   *      ...
   *    }
   *  }
   */
  data_onshown: void 0,
  /**
   * Set a callback for when data is hidden.<br>
   * The callback will receive hidden data ids in array.
   * @name data․onhidden
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   *  data: {
   *    onhidden: function(ids) {
   *      // ids - ["data1", "data2", ...]
   *      ...
   *    }
   *  }
   */
  data_onhidden: void 0,
  /**
   * Set a callback for minimum data
   * - **NOTE:** For 'area-line-range', 'area-step-range' and 'area-spline-range', `mid` data will be taken for the comparison
   * @name data․onmin
   * @memberof Options
   * @type {function}
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.OnMinMaxCallback)
   * @example
   *  onmin: function(data) {
   *    // data - ex) [{x: 3, value: 400, id: "data1", index: 3}, ... ]
   *    ...
   *  }
   */
  data_onmin: void 0,
  /**
   * Set a callback for maximum data
   * - **NOTE:** For 'area-line-range', 'area-step-range' and 'area-spline-range', `mid` data will be taken for the comparison
   * @name data․onmax
   * @memberof Options
   * @type {function}
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.OnMinMaxCallback)
   * @example
   *  onmax: function(data) {
   *    // data - ex) [{x: 3, value: 400, id: "data1", index: 3}, ... ]
   *    ...
   *  }
   */
  data_onmax: void 0,
  /**
   * Load a CSV or JSON file from a URL. NOTE that this will not work if loading via the "file://" protocol as most browsers will block XMLHTTPRequests.
   * @name data․url
   * @memberof Options
   * @type {string}
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.LoadData)
   * @example
   * data: {
   *     url: "/data/test.csv"
   * }
   */
  data_url: void 0,
  /**
   * XHR header value
   * - **NOTE:** Should be used with `data.url` option
   * @name data․headers
   * @memberof Options
   * @type {string}
   * @default undefined
   * @see https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/setRequestHeader
   * @example
   * data: {
   *     url: "/data/test.csv",
   *     headers: {
   *        "Content-Type": "text/xml",
   *        ...
   *     }
   * }
   */
  data_headers: void 0,
  /**
   * Parse a JSON object for data. See also data.keys.
   * @name data․json
   * @memberof Options
   * @type {Array}
   * @default undefined
   * @see [data․keys](#.data%25E2%2580%25A4keys)
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.JSONData)
   * @example
   * data: {
   *     json: [
   *       {name: "www.site1.com", upload: 200, download: 200, total: 400},
   *       {name: "www.site2.com", upload: 100, download: 300, total: 400},
   *       {name: "www.site3.com", upload: 300, download: 200, total: 500},
   *       {name: "www.site4.com", upload: 400, download: 100, total: 500}
   *     ],
   *     keys: {
   *       // case 1: specify 'x' key for category axis
   *       x: "name", // 'name' key will be used as category x axis values
   *       value: ["upload", "download"]
   *
   *       // case 2: without 'x' key for non-category axis
   *       value: ["upload", "download"]
   *     }
   * }
   */
  data_json: void 0,
  /**
   * Load data from a multidimensional array, with the first element containing the data names, the following containing related data in that order.
   * @name data․rows
   * @memberof Options
   * @type {Array}
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.RowOrientedData)
   * @example
   * data: {
   *   rows: [
   *     ["A", "B", "C"],
   *     [90, 120, 300],
   *     [40, 160, 240],
   *     [50, 200, 290],
   *     [120, 160, 230],
   *     [80, 130, 300],
   *     [90, 220, 320]
   *   ]
   * }
   *
   * // for 'bar' type, data can contain:
   * // - an array of [start, end] data following the order
   * data: {
   *   rows: [
   *      ["data1", "data2"],
   *      [[100, 150], 120],
   *      [[200, 300], 55],
   *      [[-400, 500], 60]
   *   ],
   *   type: "bar"
   * }
   *
   * // for 'range' types('area-line-range' or 'area-step-range' or 'area-spline-range'), data should contain:
   * // - an array of [high, mid, low] data following the order
   * // - or an object with 'high', 'mid' and 'low' key value
   * data: {
   *   rows: [
   *      ["data1", "data2"],
   *      [
   *        // or {high:150, mid: 140, low: 110}, 120
   *        [150, 140, 110], 120
   *      ],
   *      [[155, 130, 115], 55],
   *      [[160, 135, 120], 60]
   *   ],
   *   types: {
   *       data1: "area-line-range",
   *       data2: "line"
   *   }
   * }
   *
   * // for 'bubble' type, data can contain dimension value:
   * // - an array of [y, z] data following the order
   * // - or an object with 'y' and 'z' key value
   * // 'y' is for y axis coordination and 'z' is the bubble radius value
   * data: {
   *   rows: [
   *      ["data1", "data2"],
   *      [
   *        // or {y:10, z: 140}, 120
   *        [10, 140], 120
   *      ],
   *      [[100, 30], 55],
   *      [[50, 100], 60]
   *   ],
   *   types: {
   *       data1: "bubble",
   *       data2: "line"
   *   }
   * }
   *
   * // for 'candlestick' type, data should contain:
   * // - an array of [open, high, low, close, volume(optional)] data following the order
   * // - or an object with 'open', 'high', 'low', 'close' and 'value'(optional) key value
   * data: {
   *   rows: [
   *      ["data1", "data2"],
   * 		[
   * 			// open, high, low, close, volume (optional)
   * 			{open: 1300, high: 1369, low: 1200, close: 1339, volume: 100},
   * 			[1000, 1100, 850, 870]
   * 		],
   * 		[
   * 			{open: 1348, high: 1371, low: 1271, close: 1320},
   * 			[870, 1250, 830, 1200, 50]
   * 		]
   *   ],
   *   type: "candlestick"
   * }
   */
  data_rows: void 0,
  /**
   * Load data from a multidimensional array, with each element containing an array consisting of a datum name and associated data values.
   * @name data․columns
   * @memberof Options
   * @type {Array}
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.ColumnOrientedData)
   * @example
   * data: {
   *   columns: [
   *      ["data1", 30, 20, 50, 40, 60, 50],
   *      ["data2", 200, 130, 90, 240, 130, 220],
   *      ["data3", 300, 200, 160, 400, 250, 250]
   *   ]
   * }
   *
   * // for 'bar' type, data can contain:
   * // - an array of [start, end] data following the order
   * data: {
   *   columns: [
   *     ["data1", -100, 50, [100, 200], [200, 300]],
   *     ["data2", -200, 300, [-100, 100], [-50, -30]],
   *   ],
   *   type: "bar"
   * }
   *
   * // for 'range' types('area-line-range' or 'area-step-range' or 'area-spline-range'), data should contain:
   * // - an array of [high, mid, low] data following the order
   * // - or an object with 'high', 'mid' and 'low' key value
   * data: {
   *   columns: [
   *      ["data1",
   *          [150, 140, 110],  // or {high:150, mid: 140, low: 110}
   *          [150, 140, 110],
   *          [150, 140, 110]
   *      ]
   *   ],
   *   type: "area-line-range"
   * }
   *
   * // for 'bubble' type, data can contain dimension value:
   * // - an array of [y, z] data following the order
   * // - or an object with 'y' and 'z' key value
   * // 'y' is for y axis coordination and 'z' is the bubble radius value
   * data: {
   *   columns: [
   *      ["data1",
   *          [10, 140],  // or {y:10, z: 140}
   *          [100, 30],
   *          [50, 100]
   *      ]
   *   ],
   *   type: "bubble"
   * }
   *
   * // for 'candlestick' type, data should contain:
   * // - an array of [open, high, low, close, volume(optional)] data following the order
   * // - or an object with 'open', 'high', 'low', 'close' and 'value'(optional) key value
   * data: {
   *   columns: [
   *      ["data1",
   *          [1000, 1100, 850, 870, 100],  // or {open:1000, high: 1100, low: 870, volume: 100}
   *          [870, 1250, 830, 1200]  // 'volume' can be omitted
   *      ]
   *   ],
   *   type: "candlestick"
   * }
   */
  data_columns: void 0,
  /**
   * Used if loading JSON via data.url.
   * - **Available Values:**
   *   - json
   *   - csv
   *   - tsv
   * @name data․mimeType
   * @memberof Options
   * @type {string}
   * @default csv
   * @example
   * data: {
   *     mimeType: "json"
   * }
   */
  data_mimeType: "csv",
  /**
   * Choose which JSON object keys correspond to desired data.
   * - **NOTE:** Only for JSON object given as array.
   * @name data․keys
   * @memberof Options
   * @type {string}
   * @default undefined
   * @example
   * data: {
   *     json: [
   *       {name: "www.site1.com", upload: 200, download: 200, total: 400},
   *       {name: "www.site2.com", upload: 100, download: 300, total: 400},
   *       {name: "www.site3.com", upload: 300, download: 200, total: 500},
   *       {name: "www.site4.com", upload: 400, download: 100, total: 500}
   *     ],
   *     keys: {
   *       // case 1: specify 'x' key for category axis
   *       x: "name", // 'name' key will be used as category x axis values
   *       value: ["upload", "download"]
   *
   *       // case 2: without 'x' key for non-category axis
   *       value: ["upload", "download"]
   *     }
   * }
   */
  data_keys: void 0,
  /**
   * Set text label to be displayed when there's no data to show.
   * - ex. Toggling all visible data to not be shown, unloading all current data, etc.
   * @name data․empty․label․text
   * @memberof Options
   * @type {string}
   * @default ""
   * @example
   * data: {
   *   empty: {
   *     label: {
   *       text: "No Data"
   *     }
   *   }
   * }
   */
  data_empty_label_text: ""
}, Zg = {
  /**
   * Interaction options
   * @name interaction
   * @memberof Options
   * @type {object}
   * @property {object} interaction Intersection object
   * @property {boolean} [interaction.enabled=true] Indicate if the chart should have interactions.<br>
   *     If `false` is set, all of interactions (showing/hiding tooltip, selection, mouse events, etc) will be disabled.
   * @property {boolean} [interaction.brighten=true] Make brighter for the selected area (ex. 'pie' type data selected area)
   * @property {boolean} [interaction.inputType.mouse=true] enable or disable mouse interaction
   * @property {boolean} [interaction.inputType.touch=true] enable or disable  touch interaction
   * @property {boolean|number} [interaction.inputType.touch.preventDefault=false] enable or disable to call event.preventDefault on touchstart & touchmove event. It's usually used to prevent document scrolling.<br>
   * - **NOTE**: When `true` is set, touch events are bound with [`{passive: false}`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#using_passive_listeners) option.
   * @property {boolean} [interaction.onout=true] Enable or disable "onout" event.<br>
   * 		When is disabled, defocus(hiding tooltip, focused gridline, etc.) event won't work.
   * @see [Demo: touch.preventDefault](https://naver.github.io/billboard.js/demo/#Interaction.PreventScrollOnTouch)
   * @example
   * interaction: {
   *    enabled: false,
   *    brighten: false,
   *    inputType: {
   *        mouse: true,
   *        touch: false
   *
   *        // or declare preventDefault explicitly.
   *        // In this case touch inputType is enabled by default
   *        touch: {
   *            preventDefault: true
   *
   *            // or threshold pixel value (pixel moved from touchstart to touchmove)
   *            preventDefault: 5
   *        }
   *    },
   *
   *    // disable "onout" event
   *    onout: false
   * }
   */
  interaction_enabled: !0,
  interaction_brighten: !0,
  interaction_inputType_mouse: !0,
  interaction_inputType_touch: {},
  interaction_onout: !0
};
function qg() {
  return typeof globalThis == "object" && globalThis !== null && globalThis.Object === Object && globalThis || typeof global == "object" && global !== null && global.Object === Object && global || typeof self == "object" && self !== null && self.Object === Object && self || Function("return this")();
}
function jg(t) {
  var e = typeof t?.requestAnimationFrame == "function" && typeof t?.cancelAnimationFrame == "function", n = typeof t?.requestIdleCallback == "function" && typeof t?.cancelIdleCallback == "function", a = function(r) {
    return setTimeout(r, 1);
  }, i = function(r) {
    return clearTimeout(r);
  };
  return [
    e ? t.requestAnimationFrame : a,
    e ? t.cancelAnimationFrame : i,
    n ? t.requestIdleCallback : a,
    n ? t.cancelIdleCallback : i
  ];
}
var tt = qg(), mt = tt?.document, rl = jg(tt), Kg = rl[0], ol = rl[2], Jg = /* @__PURE__ */ new Set([
  // HTML tags for tooltip/legend templates
  "span",
  "div",
  "p",
  "br",
  "b",
  "i",
  "em",
  "strong",
  "u",
  "s",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "hr",
  "pre",
  "code",
  "blockquote",
  "a",
  "img",
  // SVG tags for point patterns
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "use",
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "marker",
  "title",
  "desc"
]), mo = /* @__PURE__ */ new Set([
  // Common attributes
  "class",
  "id",
  "style",
  "title",
  "lang",
  "dir",
  // HTML specific
  "href",
  "src",
  "alt",
  "width",
  "height",
  "colspan",
  "rowspan",
  "scope",
  "headers",
  // SVG presentation attributes
  "d",
  "points",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "dx",
  "dy",
  "viewBox",
  "preserveAspectRatio",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "patternUnits",
  "patternTransform",
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "xlink:href"
]), Qg = /* @__PURE__ */ new Set([
  "http:",
  "https:",
  "mailto:"
]), tp = /* @__PURE__ */ new Set(["href", "src", "xlink:href"]), ep = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/, np = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/, ap = /^<([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)>$/, yo = /([a-zA-Z][\w:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, bo = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi, ip = [
  "expression(",
  "behavior:",
  "binding:",
  "@import",
  "@charset",
  "-moz-binding:"
];
function hr(t) {
  return t.replace(/&colon;/gi, ":").replace(/&newline;/gi, `
`).replace(/&tab;/gi, "	").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#(\d+);/gi, function(e, n) {
    return String.fromCharCode(parseInt(n, 10));
  }).replace(/&#x([0-9a-f]+);/gi, function(e, n) {
    return String.fromCharCode(parseInt(n, 16));
  });
}
function sl(t) {
  var e = hr(t).trim(), n = e.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (!n || n.startsWith("#") || n.startsWith("/") || n.startsWith("./") || n.startsWith("../") || !n.includes(":"))
    return !0;
  var a = n.indexOf(":");
  if (a > 0) {
    var i = n.substring(0, a + 1);
    return Qg.has(i);
  }
  return !1;
}
function rp(t) {
  var e = hr(t), n = e.replace(/[\u0000-\u001f]/g, "");
  bo.lastIndex = 0;
  for (var a; (a = bo.exec(n)) !== null; )
    if (!sl(a[1]))
      return null;
  for (var i = n.toLowerCase().replace(/\s/g, ""), r = 0, o = ip; r < o.length; r++) {
    var s = o[r];
    if (i.includes(s))
      return null;
  }
  return t;
}
var op = {
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;"
}, sp = /["'`]/g;
function ri(t) {
  return t.replace(sp, function(e) {
    return op[e];
  });
}
function lp(t, e, n) {
  if (n === void 0 && (n = !1), tp.has(t))
    return sl(e) ? n ? ri(e) : e : null;
  if (t === "style") {
    var a = rp(e);
    return a === null ? null : n ? ri(a) : a;
  }
  var i = hr(e).toLowerCase().replace(/\s/g, "");
  return /\bon\w+=/.test(i) ? null : n ? ri(e) : e;
}
function cp(t) {
  var e = t.match(ep);
  return e ? e[1].toLowerCase() : null;
}
function up(t) {
  var e = cp(t);
  return e !== null && Jg.has(e);
}
function fp(t) {
  var e = t.match(np);
  if (e)
    return "</".concat(e[1].toLowerCase(), ">");
  var n = t.match(ap);
  if (!n)
    return "";
  var a = n[1], i = n[2], r = n[3], o = a.toLowerCase(), s = [];
  yo.lastIndex = 0;
  for (var l; (l = yo.exec(i)) !== null; ) {
    var c = l[1].toLowerCase(), u = l[2], f = l[3], h = l[4];
    if (!c.startsWith("on")) {
      var d = void 0, v = void 0;
      if (u !== void 0)
        d = u, v = '"';
      else if (f !== void 0)
        d = f, v = "'";
      else if (h !== void 0)
        d = h, v = '"';
      else {
        mo.has(c) && s.push(c);
        continue;
      }
      if (mo.has(c)) {
        var _ = h !== void 0, p = lp(c, d, _);
        p !== null && s.push("".concat(c, "=").concat(v).concat(p).concat(v));
      }
    }
  }
  var g = s.length > 0 ? " ".concat(s.join(" ")) : "", x = r ? "/>" : ">";
  return "<".concat(o).concat(g).concat(x);
}
function nn(t) {
  return typeof t != "string" || !t || t.indexOf("<") === -1 ? t : t.replace(/<\/?[^>]*>|[^<>\s]+>/g, function(e) {
    return e.startsWith("<!--") ? "" : e.startsWith("<") ? up(e) ? fp(e) : e.replace(/</g, "&lt;") : e.slice(0, -1) + "&gt;";
  });
}
function ll(t, e, n) {
  n === void 0 && (n = !1);
  var a = function(r) {
    return r[t ? "getBoundingClientRect" : "getBBox"]();
  };
  if (n)
    return a(e);
  var i = !("rect" in e) || "rect" in e && e.hasAttribute("width") && e.rect.width !== +(e.getAttribute("width") || 0);
  return i ? e.rect = a(e) : e.rect;
}
function cl(t, e) {
  for (var n = 0; n < t.length; n++) {
    var a = t[n];
    a && e(a, n);
  }
}
var nt = function(t) {
  return t || t === 0;
}, U = function(t) {
  return typeof t == "function";
}, lt = function(t) {
  return typeof t == "string";
}, q = function(t) {
  return typeof t == "number";
}, St = function(t) {
  return typeof t > "u";
}, vt = function(t) {
  return typeof t < "u";
}, Ei = function(t) {
  return typeof t == "boolean";
}, hp = function(t) {
  return Math.ceil(t / 10) * 10;
}, Hn = function(t) {
  return Math.ceil(t) + 0.5;
}, Me = function(t) {
  return t[1] - t[0];
}, Ut = function(t) {
  return typeof t == "object";
}, dp = function(t) {
  for (var e in t)
    return !1;
  return !0;
}, qt = function(t) {
  return St(t) || t === null || lt(t) && t.length === 0 || Ut(t) && !(t instanceof Date) && dp(t) || q(t) && isNaN(t);
}, kt = function(t) {
  return !qt(t);
}, ft = function(t) {
  return Array.isArray(t);
}, ct = function(t) {
  return t && !t?.nodeType && Ut(t) && !ft(t);
};
function Te(t, e, n) {
  return vt(t[e]) ? t[e] : n;
}
function vp(t, e) {
  var n = !1;
  return Object.keys(t).forEach(function(a) {
    return t[a] === e && (n = !0);
  }), n;
}
function pt(t, e) {
  for (var n = [], a = 2; a < arguments.length; a++)
    n[a - 2] = arguments[a];
  var i = U(t);
  return i && t.call.apply(t, wt([e], n, !1)), i;
}
function wa(t, e) {
  var n = 0, a = function() {
    for (var i = [], r = 0; r < arguments.length; r++)
      i[r] = arguments[r];
    !--n && e.apply.apply(e, wt([this], i, !1));
  };
  "duration" in t ? t.each(function() {
    return ++n;
  }).on("end", a) : (++n, t.call(a));
}
function an(t, e, n, a) {
  if (n === void 0 && (n = [-1, 1]), a === void 0 && (a = !1), !(!t || !lt(e)))
    if (e.indexOf(`
`) === -1)
      t.text(e);
    else {
      var i = [t.text(), e].map(function(s) {
        return s.replace(/[\s\n]/g, "");
      });
      if (i[0] !== i[1]) {
        var r = e.split(`
`), o = a ? r.length - 1 : 1;
        t.html(""), r.forEach(function(s, l) {
          t.append("tspan").attr("x", 0).attr("dy", "".concat(l === 0 ? n[0] * o : n[1], "em")).text(s);
        });
      }
    }
}
function ul(t) {
  var e = t.getBBox(), n = e.x, a = e.y, i = e.width, r = e.height;
  return [
    { x: n, y: a + r },
    // seg0
    { x: n, y: a },
    // seg1
    { x: n + i, y: a },
    // seg2
    { x: n + i, y: a + r }
    // seg3
  ];
}
function fl(t) {
  var e = Mt(t), n = e.width, a = e.height, i = ul(t), r = i[0].x, o = Math.min(i[0].y, i[1].y);
  return {
    x: r,
    y: o,
    width: n,
    height: a
  };
}
function Zt(t, e) {
  var n, a = t && ((n = t.touches || t.sourceEvent && t.sourceEvent.touches) === null || n === void 0 ? void 0 : n[0]), i = [0, 0];
  try {
    i = Ht(a || t, e);
  } catch {
  }
  return i.map(function(r) {
    return isNaN(r) ? 0 : r;
  });
}
function hl(t) {
  var e = t.event, n = t.$el, a = n.subchart.main || n.main, i;
  return e && e.type === "brush" ? i = e.selection : a && (i = a.select(".bb-brush").node()) && (i = Ss(i)), i;
}
function Mt(t, e) {
  return e === void 0 && (e = !1), ll(!0, t, e);
}
function we(t, e) {
  return e === void 0 && (e = !1), ll(!1, t, e);
}
function re(t, e, n) {
  t === void 0 && (t = !0), e === void 0 && (e = 0), n === void 0 && (n = 1e4);
  var a = tt.crypto || tt.msCrypto, i = a ? e + a.getRandomValues(new Uint32Array(1))[0] % (n - e + 1) : Math.floor(Math.random() * (n - e) + e);
  return t ? String(i) : i;
}
function Mi(t, e, n, a, i) {
  if (n > a)
    return -1;
  var r = Math.floor((n + a) / 2), o = t[r], s = o.x, l = o.w, c = l === void 0 ? 0 : l;
  return i && (s = t[r].y, c = t[r].h), e >= s && e <= s + c ? r : e < s ? Mi(t, e, n, r - 1, i) : Mi(t, e, r + 1, a, i);
}
function dl(t) {
  var e = hl(t);
  return e ? e[0] === e[1] : !0;
}
function gp() {
  for (var t = [], e = 0; e < arguments.length; e++)
    t[e] = arguments[e];
  var n = function(a) {
    if (ct(a) && a.constructor) {
      var i = new a.constructor();
      for (var r in a)
        i[r] = n(a[r]);
      return i;
    }
    return a;
  };
  return t.map(function(a) {
    return n(a);
  }).reduce(function(a, i) {
    return K(K({}, a), i);
  });
}
function Lt(t, e) {
  t === void 0 && (t = {}), ft(e) && e.forEach(function(a) {
    return Lt(t, a);
  });
  for (var n in e)
    /^\d+$/.test(n) || n in t || (t[n] = e[n]);
  return t;
}
var Nt = function(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
};
function pp(t, e) {
  return e === void 0 && (e = "-"), t.split(e).map(function(n, a) {
    return a ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : n.toLowerCase();
  }).join("");
}
var Ie = function(t) {
  return [].slice.call(t);
};
function _p(t, e, n) {
  var a = t.rootSelector, i = a === void 0 ? "" : a, r = t.sheet, o = function(l) {
    return l.replace(/\s?(bb-)/g, ".$1").replace(/\.+/g, ".");
  }, s = "".concat(i, " ").concat(o(e), " {").concat(n.join(";"), "}");
  return r[r.insertRule ? "insertRule" : "addRule"](s, r.cssRules.length);
}
function xp(t) {
  var e = [];
  return t.forEach(function(n) {
    var a;
    try {
      n.cssRules && n.cssRules.length && (e = e.concat(Ie(n.cssRules)));
    } catch (i) {
      (a = tt.console) === null || a === void 0 || a.warn("Error while reading rules from ".concat(n.href, ": ").concat(i.toString()));
    }
  }), e;
}
function vl(t) {
  var e, n, a, i, r, o;
  return {
    x: ((n = (e = tt.pageXOffset) !== null && e !== void 0 ? e : tt.scrollX) !== null && n !== void 0 ? n : 0) + ((a = t.scrollLeft) !== null && a !== void 0 ? a : 0),
    y: ((r = (i = tt.pageYOffset) !== null && i !== void 0 ? i : tt.scrollY) !== null && r !== void 0 ? r : 0) + ((o = t.scrollTop) !== null && o !== void 0 ? o : 0)
  };
}
function Aa(t, e, n, a) {
  e === void 0 && (e = 0), n === void 0 && (n = 0), a === void 0 && (a = !0);
  var i = new DOMPoint(e, n), r = t.getScreenCTM(), o = i.matrixTransform(a ? r?.inverse() : r);
  if (a === !1) {
    var s = Mt(t);
    o.x -= s.x, o.y -= s.y;
  }
  return o;
}
function To(t) {
  var e = t ? t.transform : null, n = e && e.baseVal;
  return n && n.numberOfItems ? n.getItem(0).matrix : { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
}
function Li(t) {
  var e = t[0] instanceof Date, n = (e ? t.map(Number) : t).filter(function(a, i, r) {
    return r.indexOf(a) === i;
  });
  return e ? n.map(function(a) {
    return new Date(a);
  }) : n;
}
function $o(t) {
  return t && t.length ? t.reduce(function(e, n) {
    return e.concat(n);
  }) : [];
}
function rn(t) {
  for (var e = [], n = 1; n < arguments.length; n++)
    e[n - 1] = arguments[n];
  if (!e.length || e.length === 1 && !e[0])
    return t;
  var a = e.shift();
  return ct(t) && ct(a) && Object.keys(a).forEach(function(i) {
    if (!/^(__proto__|constructor|prototype)$/i.test(i)) {
      var r = a[i];
      ct(r) ? (!t[i] && (t[i] = {}), t[i] = rn(t[i], r)) : t[i] = ft(r) ? r.concat() : r;
    }
  }), rn.apply(void 0, wt([t], e, !1));
}
function on(t, e) {
  e === void 0 && (e = !0);
  var n;
  return t[0] instanceof Date ? n = e ? function(a, i) {
    return a - i;
  } : function(a, i) {
    return i - a;
  } : e && !t.every(isNaN) ? n = function(a, i) {
    return a - i;
  } : e || (n = function(a, i) {
    return a > i && -1 || a < i && 1 || a === i && 0;
  }), t.concat().sort(n);
}
function Qt(t, e) {
  var n = e.filter(function(a) {
    return kt(a);
  });
  return n.length ? q(n[0]) ? n = Math[t].apply(Math, n) : n[0] instanceof Date && (n = on(n, t === "min")[0]) : n = void 0, n;
}
var ia = function(t, e, n) {
  n === void 0 && (n = 1);
  for (var a = [], i = Math.max(0, Math.ceil((e - t) / n)) | 0, r = t; r < i; r++)
    a.push(t + r * n);
  return a;
}, mp = {
  mouse: (function() {
    var t = function() {
      return {
        bubbles: !1,
        cancelable: !1,
        screenX: 0,
        screenY: 0,
        clientX: 0,
        clientY: 0
      };
    };
    try {
      return new MouseEvent("t"), function(e, n, a) {
        a === void 0 && (a = t()), e.dispatchEvent(new MouseEvent(n, a));
      };
    } catch {
      return function(n, a, i) {
        i === void 0 && (i = t());
        var r = mt.createEvent("MouseEvent");
        r.initMouseEvent(
          a,
          i.bubbles,
          i.cancelable,
          tt,
          0,
          // the event's mouse click count
          i.screenX,
          i.screenY,
          i.clientX,
          i.clientY,
          !1,
          !1,
          !1,
          !1,
          0,
          null
        ), n.dispatchEvent(r);
      };
    }
  })(),
  touch: function(t, e, n) {
    var a = new Touch(rn({
      identifier: Date.now(),
      target: t,
      radiusX: 2.5,
      radiusY: 2.5,
      rotationAngle: 10,
      force: 0.5
    }, n));
    t.dispatchEvent(new TouchEvent(e, {
      cancelable: !0,
      bubbles: !0,
      shiftKey: !0,
      touches: [a],
      targetTouches: [],
      changedTouches: [a]
    }));
  }
};
function zn(t, e) {
  var n = t;
  for (var a in e)
    n = n.replace(new RegExp("{=".concat(a, "}"), "g"), e[a]);
  return nn(n);
}
function jt(t) {
  var e, n;
  if (t instanceof Date)
    n = t;
  else if (lt(t)) {
    var a = this, i = a.config, r = a.format;
    n = (e = r.dataTime(i.data_xFormat)(t)) !== null && e !== void 0 ? e : new Date(t);
  } else q(t) && !isNaN(t) && (n = /* @__PURE__ */ new Date(+t));
  return (!n || isNaN(+n)) && console && console.error && console.error("Failed to parse x '".concat(t, "' to Date object")), n;
}
function dr(t) {
  var e = t.attr("viewBox");
  return e ? /(\d+(\.\d+)?){3}/.test(e) : !1;
}
function yp(t, e, n) {
  n === void 0 && (n = !1);
  for (var a = !!t.node, i = !1, r = 0, o = Object.entries(e); r < o.length; r++) {
    var s = o[r], l = s[0], c = s[1];
    if (i = a ? t.style(l) === c : t.style[l] === c, n === !1 && i)
      break;
  }
  return i;
}
function Nn() {
  return mt?.hidden === !1 || mt?.visibilityState === "visible";
}
function bp(t, e) {
  var n = tt.DocumentTouch, a = tt.matchMedia, i = tt.navigator, r = a?.("(pointer:coarse)").matches, o = !1;
  if (e)
    if (i && "maxTouchPoints" in i)
      o = i.maxTouchPoints > 0;
    else if ("ontouchmove" in tt || n && mt instanceof n)
      o = !0;
    else if (r)
      o = !0;
    else {
      var s = i.userAgent;
      o = /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(s) || /\b(Android|Windows Phone|iPad|iPod)\b/i.test(s);
    }
  var l = t && !r && a?.("(pointer:fine)").matches;
  return l && "mouse" || o && "touch" || "mouse";
}
function gl(t, e) {
  e() === !1 ? Kg(function() {
    return gl(t, e);
  }) : t();
}
function Tp(t) {
  if (ct(t) && !lt(t)) {
    var e = t;
    return {
      top: e.top || 0,
      right: e.right || 0,
      bottom: e.bottom || 0,
      left: e.left || 0
    };
  }
  var n = (lt(t) ? t.trim().split(/\s+/) : [t]).map(function(u) {
    return +u || 0;
  }), a = n[0], i = n[1], r = i === void 0 ? a : i, o = n[2], s = o === void 0 ? a : o, l = n[3], c = l === void 0 ? r : l;
  return { top: a, right: r, bottom: s, left: c };
}
function pl(t, e) {
  t.pendingRaf !== null ? (tt.cancelAnimationFrame(t.pendingRaf), t.pendingRaf = tt.requestAnimationFrame(function() {
    t.pendingRaf = null, e();
  })) : (t.pendingRaf = tt.requestAnimationFrame(function() {
    t.pendingRaf = null;
  }), e());
}
function _l(t, e) {
  e === void 0 && (e = (function(a) {
    return a;
  }));
  var n = /* @__PURE__ */ new Set();
  return cl(t, function(a, i) {
    n.add(e(a, i));
  }), n;
}
function xl(t, e, n) {
  n === void 0 && (n = (function(i) {
    return i;
  }));
  var a = /* @__PURE__ */ new Map();
  return cl(t, function(i, r) {
    a.set(e(i, r), n(i, r));
  }), a;
}
var Fe = (
  /** @class */
  (function() {
    function t() {
      return gp(Vg, Xg, Wg, Gg, Zg, Yg, Ug, Hg, t.data);
    }
    return t.setOptions = function(e) {
      this.data = e.reduce(function(n, a) {
        return K(K({}, n), a);
      }, this.data);
    }, t.data = {}, t;
  })()
), $p = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t() {
      var e = {
        chart: null,
        main: null,
        svg: null,
        axis: {
          x: null,
          y: null,
          y2: null,
          subX: null
        },
        axisTooltip: {
          x: null,
          y: null,
          y2: null
        },
        defs: null,
        tooltip: null,
        legend: null,
        title: null,
        subchart: {
          main: null,
          // $$.context
          bar: null,
          // $$.contextBar
          line: null,
          // $$.contextLine
          area: null
          // $$.contextArea
        },
        arcs: null,
        bar: null,
        // mainBar,
        candlestick: null,
        line: null,
        // mainLine,
        area: null,
        // mainArea,
        circle: null,
        // mainCircle,
        radar: null,
        text: null,
        // mainText,
        grid: {
          main: null,
          // grid (also focus)
          x: null,
          // xgrid,
          y: null
          // ygrid,
        },
        gridLines: {
          main: null,
          // gridLines
          x: null,
          // xgridLines,
          y: null
          // ygridLines
        },
        region: {
          main: null,
          // region
          list: null
          // mainRegion
        },
        eventRect: null,
        zoomResetBtn: null
        // drag zoom reset button
      };
      return e;
    }
    return t;
  })()
), wp = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t() {
      return {
        // chart drawn area dimension, excluding axes
        width: 0,
        width2: 0,
        height: 0,
        height2: 0,
        margin: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        margin2: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        margin3: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        arcWidth: 0,
        arcHeight: 0,
        xAxisHeight: 0,
        hasAxis: !1,
        hasFunnel: !1,
        hasRadar: !1,
        hasTreemap: !1,
        // for data CSS rule index (used when boost.useCssRule is true)
        cssRule: {},
        // Data loading state (used in scale calculation)
        loading: void 0,
        // Zoom/subchart domain (different from current.domain which is for rendering)
        domain: void 0,
        current: {
          // current domain value. Assigned when is zoom is called
          domain: void 0,
          // chart whole dimension
          width: 0,
          height: 0,
          dataMax: 0,
          maxTickSize: {
            x: {
              width: 0,
              height: 0,
              ticks: [],
              clipPath: 0,
              domain: ""
            },
            y: { width: 0, height: 0, domain: "" },
            y2: { width: 0, height: 0, domain: "" }
          },
          // current used chart type list
          types: [],
          needle: void 0,
          // arc needle current value
          zoomDomain: null
          // zoomed domain value
        },
        // legend
        isLegendRight: !1,
        isLegendInset: !1,
        isLegendTop: !1,
        isLegendLeft: !1,
        legendStep: 0,
        legendItemWidth: 0,
        legendItemHeight: 0,
        legendHasRendered: !1,
        eventReceiver: {
          currentIdx: -1,
          // current event interaction index
          rect: {},
          // event rect's clientBoundingRect
          data: [],
          // event data bound of previoous eventRect
          coords: []
          // coordination value of previous eventRect
        },
        axis: {
          x: {
            padding: { left: 0, right: 0 },
            tickCount: 0
          }
        },
        rotatedPadding: {
          left: 30,
          right: 0,
          top: 5
        },
        withoutFadeIn: {},
        inputType: "",
        datetimeId: "",
        // clip id string
        clip: {
          id: "",
          idXAxis: "",
          idYAxis: "",
          idXAxisTickTexts: "",
          idGrid: "",
          idSubchart: "",
          // clipIdForSubchart
          path: "",
          pathXAxis: "",
          pathYAxis: "",
          pathXAxisTickTexts: "",
          pathGrid: ""
        },
        // state
        event: null,
        // event object
        dragStart: null,
        dragging: !1,
        flowing: !1,
        cancelClick: !1,
        mouseover: !1,
        rendered: !1,
        transiting: !1,
        redrawing: !1,
        // if redraw() is on process
        resizing: !1,
        // resize event called
        toggling: !1,
        // legend toggle
        zooming: !1,
        hasNegativeValue: !1,
        hasPositiveValue: !0,
        orgAreaOpacity: "0.2",
        orgConfig: {},
        // user original genration config
        // ID strings
        hiddenTargetIds: [],
        hiddenLegendIds: [],
        focusedTargetIds: [],
        defocusedTargetIds: [],
        // value for Arc
        radius: 0,
        innerRadius: 0,
        outerRadius: void 0,
        innerRadiusRatio: 0,
        gaugeArcWidth: 0,
        radiusExpanded: 0,
        // xgrid attribute
        xgridAttr: {
          x1: null,
          x2: null,
          y1: null,
          y2: null
        },
        // RAF batching for zoom/drag interactions
        pendingRaf: null,
        rafBatchQueue: []
      };
    }
    return t;
  })()
), wo = {
  element: $p,
  state: wp
}, Ap = (
  /** @class */
  (function() {
    function t() {
      var e = this;
      Object.keys(wo).forEach(function(n) {
        e[n] = new wo[n]();
      });
    }
    return t.prototype.getStore = function(e) {
      return this[e];
    }, t;
  })()
), $t = {
  bubbleBaseLength: "$baseLength",
  colorPattern: "__colorPattern__",
  dataMinMax: "$dataMinMax",
  dataTotalSum: "$dataTotalSum",
  dataTotalPerIndex: "$totalPerIndex",
  filteredTargets: "$filteredTargets",
  visibilityChecksum: "visibilityChecksum",
  legendItemTextBox: "legendItemTextBox",
  legendItemMap: "$legendItemMap",
  radarPoints: "$radarPoints",
  radarTextWidth: "$radarTextWidth",
  setOverOut: "setOverOut",
  callOverOutForTouch: "callOverOutForTouch",
  textRect: "textRect",
  shapeOffset: "$shapeOffset"
}, Sp = (
  /** @class */
  (function() {
    function t() {
      this.cache = {};
    }
    return t.prototype.add = function(e, n, a) {
      return a === void 0 && (a = !1), this.cache[e] = a ? this.cloneTarget(n) : n, this.cache[e];
    }, t.prototype.remove = function(e) {
      var n = this;
      (lt(e) ? [e] : e).forEach(function(a) {
        return delete n.cache[a];
      });
    }, t.prototype.get = function(e, n) {
      if (n === void 0 && (n = !1), n && Array.isArray(e)) {
        for (var a = [], i = 0, r = void 0; r = e[i]; i++)
          r in this.cache && a.push(this.cloneTarget(this.cache[r]));
        return a;
      } else {
        var o = this.cache[e];
        return nt(o) ? o : null;
      }
    }, t.prototype.has = function(e) {
      return e in this.cache && this.cache[e] !== null;
    }, t.prototype.getKeys = function() {
      return Object.keys(this.cache);
    }, t.prototype.reset = function(e) {
      var n = this;
      for (var a in n.cache)
        (e || /^\$/.test(a)) && (n.cache[a] = null);
    }, t.prototype.cloneTarget = function(e) {
      return {
        id: e.id,
        id_org: e.id_org,
        values: e.values.map(function(n) {
          return { x: n.x, value: n.value, id: n.id };
        })
      };
    }, t;
  })()
), Y = {
  AREA: "area",
  AREA_LINE_RANGE: "area-line-range",
  AREA_SPLINE: "area-spline",
  AREA_SPLINE_RANGE: "area-spline-range",
  AREA_STEP: "area-step",
  AREA_STEP_RANGE: "area-step-range",
  BAR: "bar",
  BUBBLE: "bubble",
  CANDLESTICK: "candlestick",
  DONUT: "donut",
  FUNNEL: "funnel",
  GAUGE: "gauge",
  LINE: "line",
  PIE: "pie",
  POLAR: "polar",
  RADAR: "radar",
  SCATTER: "scatter",
  SPLINE: "spline",
  STEP: "step",
  TREEMAP: "treemap"
}, oi = {
  AREA: "initArea",
  AREA_LINE_RANGE: "initArea",
  AREA_SPLINE: "initArea",
  AREA_SPLINE_RANGE: "initArea",
  AREA_STEP: "initArea",
  AREA_STEP_RANGE: "initArea",
  BAR: "initBar",
  BUBBLE: "initCircle",
  CANDLESTICK: "initCandlestick",
  DONUT: "initArc",
  FUNNEL: "initFunnel",
  GAUGE: "initArc",
  LINE: "initLine",
  PIE: "initArc",
  POLAR: "initPolar",
  RADAR: "initCircle",
  SCATTER: "initCircle",
  SPLINE: "initLine",
  STEP: "initLine",
  TREEMAP: "initTreemap"
}, ye = {
  Area: [
    Y.AREA,
    Y.AREA_SPLINE,
    Y.AREA_SPLINE_RANGE,
    Y.AREA_LINE_RANGE,
    Y.AREA_STEP,
    Y.AREA_STEP_RANGE
  ],
  AreaRange: [
    Y.AREA_SPLINE_RANGE,
    Y.AREA_LINE_RANGE,
    Y.AREA_STEP_RANGE
  ],
  Arc: [
    Y.PIE,
    Y.DONUT,
    Y.GAUGE,
    Y.POLAR,
    Y.RADAR
  ],
  Line: [
    Y.LINE,
    Y.SPLINE,
    Y.AREA,
    Y.AREA_SPLINE,
    Y.AREA_SPLINE_RANGE,
    Y.AREA_LINE_RANGE,
    Y.STEP,
    Y.AREA_STEP,
    Y.AREA_STEP_RANGE
  ],
  Step: [
    Y.STEP,
    Y.AREA_STEP,
    Y.AREA_STEP_RANGE
  ],
  Spline: [
    Y.SPLINE,
    Y.AREA_SPLINE,
    Y.AREA_SPLINE_RANGE
  ]
};
function kp(t) {
  var e = t, n = e.config, a = "";
  if (qt(n.data_type || n.data_types) && !e[oi.LINE])
    a = "line";
  else
    for (var i in oi) {
      var r = Y[i];
      if (e.hasType(r) && !e[oi[i]]) {
        a = r;
        break;
      }
    }
  a && Cp("Please, make sure if %c".concat(pp(a)), "module has been imported and specified correctly.", "https://github.com/naver/billboard.js/wiki/CHANGELOG-v2#modularization-by-its-functionality");
}
function Cp(t, e, n) {
  var a, i = "[billboard.js]", r = (a = tt.console) === null || a === void 0 ? void 0 : a.error;
  if (r) {
    var o = ["background:red;color:white;display:block;font-size:15px", e];
    console.error.apply(console, wt(["❌ ".concat(i, " ").concat(t), "background:red;color:white;display:block;font-size:15px"], o, !1)), console.info("%cℹ️", "font-size:15px", n);
  }
  throw Error("".concat(i, " ").concat(t.replace(/\%c([a-z-]+)/i, "'$1' "), " ").concat(e));
}
var Rp = tt.setTimeout, Ep = tt.clearTimeout;
function Mp(t) {
  var e = [], n, a = function() {
    a.clear(), t === !1 ? ol(function() {
      e.forEach(function(i) {
        return i();
      });
    }, { timeout: 200 }) : n = Rp(function() {
      e.forEach(function(i) {
        return i();
      });
    }, q(t) ? t : 200);
  };
  return a.clear = function() {
    n && (Ep(n), n = null);
  }, a.add = function(i) {
    return e.push(i);
  }, a.remove = function(i) {
    return e.splice(e.indexOf(i), 1);
  }, a;
}
function ml() {
  var t = [], e = function(n, a) {
    function i() {
      for (var r, o = 0, s = 0, l = void 0; l = t[s]; s++) {
        if (l === !0 || !((r = l.empty) === null || r === void 0) && r.call(l)) {
          o++;
          continue;
        }
        if (Nn() === !1) {
          o = t.length;
          break;
        }
        try {
          l.transition();
        } catch {
          o++;
        }
      }
      return o === t.length;
    }
    gl(function() {
      a?.();
    }, i);
  };
  return e.add = function(n) {
    ft(n) ? t = t.concat(n) : t.push(n);
  }, e;
}
var si = {};
function Lp(t, e) {
  var n, a = t.toString(), i = a.replace(/(function|[\s\W\n])/g, "").substring(0, 15);
  return i in si || (si[i] = new tt.Blob([
    "".concat((n = e?.map(String).join(";")) !== null && n !== void 0 ? n : "", `

			self.onmessage=function({data}) {
				const result = (`).concat(a, `).apply(null, data);
				self.postMessage(result);
			};`)
  ], {
    type: "text/javascript"
  })), tt.URL.createObjectURL(si[i]);
}
function Dp(t) {
  var e = new tt.Worker(t);
  return e.onerror = function(n) {
    console.error ? console.error(n) : console.log(n);
  }, e;
}
function li(t, e, n, a) {
  t === void 0 && (t = !0);
  var i = function() {
    for (var s = [], l = 0; l < arguments.length; l++)
      s[l] = arguments[l];
    var c = e.apply(void 0, s);
    n(c);
  };
  if (tt.Worker && t) {
    var r = Lp(e, a), o = Dp(r);
    i = function() {
      for (var s = [], l = 0; l < arguments.length; l++)
        s[l] = arguments[l];
      o.postMessage(s), o.onmessage = function(c) {
        return tt.URL.revokeObjectURL(r), n(c.data);
      };
    };
  }
  return i;
}
function Di(t) {
  var e = [];
  return t.forEach(function(n, a) {
    var i = n[0];
    n.forEach(function(r, o) {
      if (o > 0) {
        if (typeof e[o - 1] > "u" && (e[o - 1] = {}), typeof r > "u")
          throw new Error("Source data is missing a component at (".concat(a, ", ").concat(o, ")!"));
        e[o - 1][i] = r;
      }
    });
  }), e;
}
function Ii(t) {
  var e = t[0], n = [];
  return t.forEach(function(a, i) {
    if (i > 0) {
      var r = {};
      a.forEach(function(o, s) {
        if (typeof o > "u")
          throw new Error("Source data is missing a component at (".concat(i, ", ").concat(s, ")!"));
        r[e[s]] = o;
      }), n.push(r);
    }
  }), n;
}
function yl(t, e) {
  var n = [], a, i;
  if (Array.isArray(t)) {
    var r = function(o, s) {
      if (o[s] !== void 0)
        return o[s];
      var l = s.replace(/\[(\w+)\]/g, ".$1"), c = l.replace(/^\./, "").split("."), u = o;
      return c.some(function(f) {
        return !(u = u && f in u ? u[f] : void 0);
      }), u;
    };
    e.x ? a = e.value.concat(e.x) : a = e.value, n.push(a), t.forEach(function(o) {
      var s = a.map(function(l) {
        var c = r(o, l);
        return typeof c > "u" && (c = null), c;
      });
      n.push(s);
    }), i = Ii(n);
  } else
    Object.keys(t).forEach(function(o) {
      var s, l = t[o].concat();
      (s = l.unshift) === null || s === void 0 || s.call(l, o), n.push(l);
    }), i = Di(n);
  return i;
}
function Ip(t, e, n, a, i) {
  e === void 0 && (e = "csv");
  var r = new XMLHttpRequest(), o = { csv: zp, tsv: Pp, json: yl };
  r.open("GET", t), n && Object.keys(n).forEach(function(s) {
    r.setRequestHeader(s, n[s]);
  }), r.onreadystatechange = function() {
    if (r.readyState === 4)
      if (r.status === 200) {
        var s = r.responseText;
        s && i.call(this, o[e](e === "json" ? JSON.parse(s) : s, a));
      } else
        throw new Error("".concat(t, ": Something went wrong loading!"));
  }, r.send();
}
function bl(t, e) {
  var n = t.rows(e), a;
  return n.length === 1 ? (a = [{}], n[0].forEach(function(i) {
    a[0][i] = null;
  })) : a = t.parse(e), a;
}
function zp(t) {
  return bl({
    rows: av,
    parse: nv
  }, t);
}
function Pp(t) {
  return bl({
    rows: rv,
    parse: iv
  }, t);
}
function Ao(t, e) {
  var n = t || e?.data_keys;
  return n?.x && (e.data_x = n.x), n;
}
function Op(t, e, n) {
  var a = this, i = this, r = i.config, o;
  t.forEach(function(s) {
    var l = i.getXKey(s);
    if (n.customX || n.timeSeries ? n.xs.indexOf(l) >= 0 ? o = (n.appendXs && i.data.xs[s] || []).concat(e.map(function(c, u) {
      var f = nt(c[l]);
      return f ? i.generateTargetX(f, s, u) : !1;
    }).filter(function(c) {
      return c !== !1;
    })) : r.data_x ? o = a.getOtherTargetXs() : kt(r.data_xs) && (o = i.getXValuesOfXKey(l, i.data.targets)) : o = e.map(function(c, u) {
      return u;
    }), o)
      i.data.xs[s] = o;
    else
      throw new Error('x is not defined for id = "'.concat(s, '".'));
  });
}
var Fp = {
  /**
   * Convert data according its type
   * @param {object} args data object
   * @param {function} [callback] callback for url(XHR) type loading
   * @private
   */
  convertData: function(t, e) {
    var n = this.config, a = function(r) {
      return r?.length && !qt(r[0]) ? n.boost_useWorker : !1;
    }, i = t;
    if (t.bindto && (i = {}, ["url", "mimeType", "headers", "keys", "json", "keys", "rows", "columns"].forEach(function(r) {
      var o = "data_".concat(r);
      o in t && (i[r] = t[o]);
    })), i.url && e)
      Ip(i.url, i.mimeType, i.headers, Ao(i.keys, n), e);
    else if (i.json)
      li(a(i.json), yl, e, [Di, Ii])(i.json, Ao(i.keys, n));
    else if (i.rows)
      li(a(i.rows), Ii, e)(i.rows);
    else if (i.columns)
      li(a(i.columns), Di, e)(i.columns);
    else if (t.bindto)
      throw Error("url or json or rows or columns is required.");
  },
  /**
   * Convert data to targets
   * @param {object[]} data Data to convert
   * @param {boolean} appendXs Whether to append xs
   * @returns {IData[]} Converted targets
   * @private
   */
  convertDataToTargets: function(t, e) {
    var n = this, a = n.axis, i = n.config, r = n.state, o = i.data_type, s = Object.keys(t[0] || {}), l = s.length ? s.reduce(function(v, _) {
      return n.isX.call(n, _) ? v.xs.push(_) : n.isNotX.call(n, _) && v.ids.push(_), v;
    }, { ids: [], xs: [] }) : { ids: [], xs: [] }, c = l.ids, u = l.xs, f = {
      appendXs: e,
      xs: u,
      idConverter: i.data_idConverter.bind(n.api),
      categorized: a?.isCategorized(),
      timeSeries: a?.isTimeSeries(),
      customX: a?.isCustomX()
    };
    Op.bind(n)(c, t, f);
    var h = c.map(function(v, _) {
      var p = i.data_idConverter.bind(n.api)(v), g = n.getXKey(v), x = f.customX && f.categorized, y = x && (function() {
        var b = _l(i.axis_x_categories);
        return t.every(function(w) {
          return b.has(w.x);
        });
      })(), m = t.__append__, T = g === null && m ? n.api.data.values(v).length : 0;
      return {
        id: p,
        id_org: v,
        values: t.map(function(b, w) {
          var A = b[g], k = b[v], C;
          return k = k !== null && !isNaN(k) && !ct(k) ? +k : ft(k) || ct(k) ? k : null, (x || r.hasRadar) && _ === 0 && !St(A) ? (!y && _ === 0 && w === 0 && !m && (i.axis_x_categories = []), C = i.axis_x_categories.indexOf(A), C === -1 && (C = i.axis_x_categories.length, i.axis_x_categories.push(A))) : C = n.generateTargetX(A, v, T + w), (St(k) || n.data.xs[v].length <= w) && (C = void 0), {
            x: C,
            value: k,
            id: p,
            index: -1
          };
        }).filter(function(b) {
          return vt(b.x);
        })
      };
    });
    if (h.forEach(function(v) {
      var _;
      i.data_xSort && (v.values = v.values.sort(function(p, g) {
        var x = p.x || p.x === 0 ? p.x : 1 / 0, y = g.x || g.x === 0 ? g.x : 1 / 0;
        return x - y;
      })), v.values.forEach(function(p, g) {
        return p.index = g;
      }), (_ = n.data.xs[v.id]) === null || _ === void 0 || _.sort(function(p, g) {
        return p - g;
      });
    }), r.hasNegativeValue = n.hasNegativeValueInTargets(h), r.hasPositiveValue = n.hasPositiveValueInTargets(h), o && n.isValidChartType(o)) {
      var d = n.mapToIds(h).filter(function(v) {
        return !(v in i.data_types) || !n.isValidChartType(i.data_types[v]);
      });
      n.setTargetType(d, o);
    }
    return h.forEach(function(v) {
      return n.cache.add(v.id_org, v, !0);
    }), h;
  }
}, Np = {
  isX: function(t) {
    var e = this, n = e.config, a = n.data_x && t === n.data_x, i = kt(n.data_xs) && vp(n.data_xs, t);
    return a || i;
  },
  isNotX: function(t) {
    return !this.isX(t);
  },
  isStackNormalized: function() {
    var t = this.config;
    return !!((t.data_stack_normalize === !0 || Ut(t.data_stack_normalize)) && t.data_groups.length);
  },
  /**
   * Check if stack normalization should be applied per group
   * @returns {boolean}
   * @private
   */
  isStackNormalizedPerGroup: function() {
    var t, e = this.config;
    return !!(Ut(e.data_stack_normalize) && (!((t = e.data_stack_normalize) === null || t === void 0) && t.perGroup) && e.data_groups.length);
  },
  /**
   * Check if given id is grouped data or has grouped data
   * @param {string} id Data id value
   * @returns {boolean} is grouped data or has grouped data
   * @private
   */
  isGrouped: function(t) {
    var e = this.config.data_groups;
    return t ? e.some(function(n) {
      return n.indexOf(t) >= 0 && n.length > 1;
    }) : e.length > 0;
  },
  /**
   * Check if the given axis has any grouped data
   * @param {string} axisId Axis ID (e.g., "y", "y2")
   * @returns {boolean} true if axis has grouped data
   * @private
   */
  hasAxisGroupedData: function(t) {
    var e = this, n = e.axis, a = e.data.targets, i = a.filter(function(r) {
      return n.getId(r.id) === t;
    }).map(function(r) {
      return r.id;
    });
    return i.some(function(r) {
      return e.isGrouped(r);
    });
  },
  getXKey: function(t) {
    var e = this, n = e.config;
    return n.data_x ? n.data_x : kt(n.data_xs) ? n.data_xs[t] : null;
  },
  getXValuesOfXKey: function(t, e) {
    var n = this, a = e && kt(e) ? n.mapToIds(e) : [], i;
    return a.forEach(function(r) {
      n.getXKey(r) === t && (i = n.data.xs[r]);
    }), i;
  },
  /**
   * Get index number based on given x Axis value
   * @param {Date|number|string} x x Axis to be compared
   * @param {Array} basedX x Axis list to be based on
   * @returns {number} index number
   * @private
   */
  getIndexByX: function(t, e) {
    var n = this;
    return e ? e.indexOf(lt(t) ? t : +t) : (n.filterByX(n.data.targets, t)[0] || { index: null }).index;
  },
  getXValue: function(t, e) {
    var n = this;
    return t in n.data.xs && n.data.xs[t] && nt(n.data.xs[t][e]) ? n.data.xs[t][e] : e;
  },
  getOtherTargetXs: function() {
    var t = this, e = Object.keys(t.data.xs);
    return e.length ? t.data.xs[e[0]] : null;
  },
  getOtherTargetX: function(t) {
    var e = this.getOtherTargetXs();
    return e && t < e.length ? e[t] : null;
  },
  addXs: function(t) {
    var e = this, n = e.config;
    Object.keys(t).forEach(function(a) {
      n.data_xs[a] = t[a];
    });
  },
  /**
   * Determine if x axis is multiple
   * @returns {boolean} true: multiple, false: single
   * @private
   */
  isMultipleX: function() {
    return !this.config.axis_x_forceAsSingle && (kt(this.config.data_xs) || this.hasType("bubble") || this.hasType("scatter"));
  },
  addName: function(t) {
    var e = this, n = e.config, a;
    return t && (a = n.data_names[t.id], t.name = a !== void 0 ? a : t.id), t;
  },
  /**
   * Get all values on given index
   * @param {number} index Index
   * @param {boolean} filterNull Filter nullish value
   * @returns {Array}
   * @private
   */
  getAllValuesOnIndex: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = n.filterTargetsToShow(n.data.targets).map(function(i) {
      return n.addName(n.getValueOnIndex(i.values, t));
    });
    return e && (a = a.filter(function(i) {
      return i && "value" in i && nt(i.value);
    })), a;
  },
  getValueOnIndex: function(t, e) {
    var n = t.filter(function(a) {
      return a.index === e;
    });
    return n.length ? n[0] : null;
  },
  updateTargetX: function(t, e) {
    var n = this;
    t.forEach(function(a) {
      a.values.forEach(function(i, r) {
        i.x = n.generateTargetX(e[r], a.id, r);
      }), n.data.xs[a.id] = e;
    });
  },
  updateTargetXs: function(t, e) {
    var n = this;
    t.forEach(function(a) {
      e[a.id] && n.updateTargetX([a], e[a.id]);
    });
  },
  generateTargetX: function(t, e, n) {
    var a = this, i = a.axis, r = i?.isCategorized() ? n : t || n;
    if (i?.isTimeSeries()) {
      var o = jt.bind(a);
      r = o(t || a.getXValue(e, n));
    } else i?.isCustomX() && !i?.isCategorized() && (r = nt(t) ? +t : a.getXValue(e, n));
    return r;
  },
  updateXs: function(t) {
    t.length && (this.axis.xs = t.map(function(e) {
      return e.x;
    }));
  },
  getPrevX: function(t) {
    var e = this.axis.xs[t - 1];
    return vt(e) ? e : null;
  },
  getNextX: function(t) {
    var e = this.axis.xs[t + 1];
    return vt(e) ? e : null;
  },
  /**
   * Get base value isAreaRangeType
   * @param {object} data Data object
   * @returns {number}
   * @private
   */
  getBaseValue: function(t) {
    var e = this, n = e.state.hasAxis, a = t.value;
    return a && n && (e.isAreaRangeType(t) ? a = e.getRangedData(t, "mid") : e.isBubbleZType(t) && (a = e.getBubbleZData(a, "y"))), a;
  },
  /**
   * Get min/max value from the data
   * @private
   * @param {Array} data array data to be evaluated
   * @returns {{min: {number}, max: {number}}}
   */
  getMinMaxValue: function(t) {
    var e = this.getBaseValue.bind(this), n, a;
    return (t || this.data.targets.map(function(i) {
      return i.values;
    })).forEach(function(i, r) {
      var o = i.map(e).filter(q);
      n = Math.min.apply(Math, wt([r ? n : 1 / 0], o, !1)), a = Math.max.apply(Math, wt([r ? a : -1 / 0], o, !1));
    }), { min: n, max: a };
  },
  /**
   * Get the min/max data
   * @private
   * @returns {{min: Array, max: Array}}
   */
  getMinMaxData: function() {
    var t = this, e = $t.dataMinMax, n = t.cache.get(e);
    if (!n) {
      var a = t.data.targets.map(function(c) {
        return c.values;
      }), i = t.getMinMaxValue(a), r = [], o = [], s = i.min, l = i.max;
      a.forEach(function(c) {
        var u = t.getFilteredDataByValue(c, s), f = t.getFilteredDataByValue(c, l);
        u.length && (r = r.concat(u)), f.length && (o = o.concat(f));
      }), t.cache.add(e, n = { min: r, max: o });
    }
    return n;
  },
  /**
   * Get sum of data per index
   * @param {string} targetId Target ID to get total for (only for normalized stack per group)
   * @private
   * @returns {Array}
   */
  getTotalPerIndex: function(t) {
    var e = this, n = e.config, a = t ? "".concat($t.dataTotalPerIndex, "-").concat(t) : $t.dataTotalPerIndex, i = e.cache.get(a);
    if ((e.config.data_groups.length || e.isStackNormalized()) && !i) {
      i = [];
      var r = e.data.targets;
      if (e.isStackNormalizedPerGroup() && t) {
        var o = n.data_groups.find(function(s) {
          return s.indexOf(t) >= 0;
        });
        if (o)
          r = r.filter(function(s) {
            return o.indexOf(s.id) >= 0;
          });
        else
          return null;
      }
      r.forEach(function(s) {
        s.values.forEach(function(l, c) {
          i[c] || (i[c] = 0), i[c] += ~~l.value;
        });
      }), e.cache.add(a, i);
    }
    return i;
  },
  /**
   * Get total data sum
   * @param {boolean} subtractHidden Subtract hidden data from total
   * @returns {number}
   * @private
   */
  getTotalDataSum: function(t) {
    var e = this, n = $t.dataTotalSum, a = e.cache.get(n);
    return q(a) || (a = e.data.targets.reduce(function(i, r) {
      return i + r.values.reduce(function(o, s) {
        var l;
        return o + ((l = s.value) !== null && l !== void 0 ? l : 0);
      }, 0);
    }, 0), e.cache.add(n, a)), t && (a -= e.getHiddenTotalDataSum()), a;
  },
  /**
   * Get total hidden data sum
   * @returns {number}
   * @private
   */
  getHiddenTotalDataSum: function() {
    var t = this, e = t.api, n = t.state.hiddenTargetIds, a = 0;
    return n.length && (a = e.data.values.bind(e)(n).reduce(function(i, r) {
      return i + r;
    })), a;
  },
  /**
   * Get filtered data by value
   * @param {object} data Data
   * @param {number} value Value to be filtered
   * @returns {Array} filtered array data
   * @private
   */
  getFilteredDataByValue: function(t, e) {
    var n = this;
    return t.filter(function(a) {
      return n.getBaseValue(a) === e;
    });
  },
  /**
   * Return the max length of the data
   * @returns {number} max data length
   * @private
   */
  getMaxDataCount: function() {
    return Math.max.apply(Math, wt(wt([], this.data.targets.map(function(t) {
      return t.values.length;
    }), !1), [0], !1));
  },
  getMaxDataCountTarget: function() {
    var t = this.filterTargetsToShow() || [], e = t.length, n = this.config.axis_x_inverted;
    return e > 1 ? (t = t.map(function(a) {
      return a.values;
    }).reduce(function(a, i) {
      return a.concat(i);
    }).map(function(a) {
      return a.x;
    }), t = on(Li(t)).map(function(a, i, r) {
      return {
        x: a,
        index: n ? r.length - i - 1 : i
      };
    })) : e && (t = t[0].values.concat()), t;
  },
  mapToIds: function(t) {
    return t.map(function(e) {
      return e.id;
    });
  },
  mapToTargetIds: function(t) {
    var e = this;
    return t ? ft(t) ? t.concat() : [t] : e.mapToIds(e.data.targets);
  },
  hasTarget: function(t, e) {
    for (var n = this.mapToIds(t), a = 0, i = void 0; i = n[a]; a++)
      if (i === e)
        return !0;
    return !1;
  },
  isTargetToShow: function(t) {
    return this.state.hiddenTargetIds.indexOf(t) < 0;
  },
  isLegendToShow: function(t) {
    return this.state.hiddenLegendIds.indexOf(t) < 0;
  },
  filterTargetsToShow: function(t) {
    var e = this;
    if (!t) {
      var n = e.cache, a = e.data, i = e.state, r = $t.filteredTargets, o = i.hiddenTargetIds.join(","), s = n.get($t.visibilityChecksum);
      if (o !== s && (n.remove(r), n.add($t.visibilityChecksum, o)), n.has(r))
        return n.get(r);
      var l = a.targets.filter(function(c) {
        return e.isTargetToShow(c.id);
      });
      return n.add(r, l), l;
    }
    return t.filter(function(c) {
      return e.isTargetToShow(c.id);
    });
  },
  mapTargetsToUniqueXs: function(t) {
    var e = this, n = e.axis, a = [];
    return t?.length && (a = Li($o(t.map(function(i) {
      return i.values.map(function(r) {
        return +r.x;
      });
    }))), a = n?.isTimeSeries() ? a.map(function(i) {
      return /* @__PURE__ */ new Date(+i);
    }) : a.map(Number)), on(a);
  },
  /**
   * Add to thetarget Ids
   * @param {string} type State's prop name
   * @param {Array|string} targetIds Target ids array
   * @private
   */
  addTargetIds: function(t, e) {
    var n = this.state, a = ft(e) ? e : [e];
    a.forEach(function(i) {
      n[t].indexOf(i) < 0 && n[t].push(i);
    });
  },
  /**
   * Remove from the state target Ids
   * @param {string} type State's prop name
   * @param {Array|string} targetIds Target ids array
   * @private
   */
  removeTargetIds: function(t, e) {
    var n = this.state, a = ft(e) ? e : [e];
    a.forEach(function(i) {
      var r = n[t].indexOf(i);
      r >= 0 && n[t].splice(r, 1);
    });
  },
  addHiddenTargetIds: function(t) {
    this.addTargetIds("hiddenTargetIds", t);
  },
  removeHiddenTargetIds: function(t) {
    this.removeTargetIds("hiddenTargetIds", t);
  },
  addHiddenLegendIds: function(t) {
    this.addTargetIds("hiddenLegendIds", t);
  },
  removeHiddenLegendIds: function(t) {
    this.removeTargetIds("hiddenLegendIds", t);
  },
  getValuesAsIdKeyed: function(t) {
    var e = this, n = e.state.hasAxis, a = {}, i = e.isMultipleX(), r = i ? e.mapTargetsToUniqueXs(t).map(function(s) {
      return lt(s) ? s : +s;
    }) : null, o = r ? new Map(r.map(function(s, l) {
      return [s, l];
    })) : null;
    return t.forEach(function(s) {
      var l = [];
      s.values.filter(function(c) {
        var u = c.value;
        return nt(u) || u === null;
      }).forEach(function(c) {
        var u = c.value;
        if (u !== null && e.isCandlestickType(c) && (u = ft(u) ? u.slice(0, 4) : [u.open, u.high, u.low, u.close]), ft(u))
          l.push.apply(l, u);
        else if (ct(u) && "high" in u)
          l.push.apply(l, Object.values(u));
        else if (e.isBubbleZType(c))
          l.push(n && e.getBubbleZData(u, "y"));
        else if (i && o) {
          var f = lt(c.x) ? c.x : +c.x, h = o.get(f);
          h !== void 0 && (l[h] = u);
        } else
          l.push(u);
      }), a[s.id] = l;
    }), a;
  },
  checkValueInTargets: function(t, e) {
    return Object.keys(t).some(function(n) {
      return t[n].values.some(function(a) {
        return e(a.value);
      });
    });
  },
  hasMultiTargets: function() {
    return this.filterTargetsToShow().length > 1;
  },
  hasNegativeValueInTargets: function(t) {
    return this.checkValueInTargets(t, function(e) {
      return e < 0;
    });
  },
  hasPositiveValueInTargets: function(t) {
    return this.checkValueInTargets(t, function(e) {
      return e > 0;
    });
  },
  /**
   * Sort targets data
   * Note: For stacked bar, will sort from the total sum of data series, not for each stacked bar
   * @param {Array} targetsValue Target value
   * @returns {Array}
   * @private
   */
  orderTargets: function(t) {
    var e = this, n = wt([], t, !0), a = e.getSortCompareFn();
    return a && n.sort(a), n;
  },
  /**
   * Get data.order compare function
   * @param {boolean} isReversed for Arc & Treemap type sort order needs to be reversed
   * @returns {function} compare function
   * @private
   */
  getSortCompareFn: function(t) {
    t === void 0 && (t = !1);
    var e = this, n = e.config, a = n.data_order, i = /asc/i.test(a), r = /desc/i.test(a), o;
    if (i || r) {
      var s = function(c, u) {
        return c + Math.abs(u.value);
      }, l = function(c) {
        return q(c) ? c : "values" in c ? c.values.reduce(s, 0) : c.value;
      };
      o = function(c, u) {
        var f = l(c), h = l(u);
        return t ? i ? f - h : h - f : i ? h - f : f - h;
      };
    } else U(a) && (o = a.bind(e.api));
    return o || null;
  },
  filterByX: function(t, e) {
    return $o(t.map(function(n) {
      return n.values;
    })).filter(function(n) {
      return n.x - e === 0;
    });
  },
  filterNullish: function(t) {
    var e = function(n) {
      return nt(n.value);
    };
    return t && t.filter(function(n) {
      return "value" in n ? e(n) : n.values.some(e);
    });
  },
  filterRemoveNull: function(t) {
    var e = this;
    return t.filter(function(n) {
      return nt(e.getBaseValue(n));
    });
  },
  filterByXDomain: function(t, e) {
    return t.map(function(n) {
      return {
        id: n.id,
        id_org: n.id_org,
        values: n.values.filter(function(a) {
          return e[0] <= a.x && a.x <= e[1];
        })
      };
    });
  },
  hasDataLabel: function() {
    var t = this.config.data_labels;
    return Ei(t) && t || Ut(t) && kt(t);
  },
  /**
   * Determine if has null value
   * @param {Array} targets Data array to be evaluated
   * @returns {boolean}
   * @private
   */
  hasNullDataValue: function(t) {
    return t.some(function(e) {
      var n = e.value;
      return n === null;
    });
  },
  /**
   * Get data index from the event coodinates
   * @param {Event} event Event object
   * @returns {number}
   * @private
   */
  getDataIndexFromEvent: function(t) {
    var e = this, n = e.$el, a = e.config, i = e.state, r = i.hasRadar, o = i.inputType, s = i.eventReceiver, l = s.coords, c = s.rect, u;
    if (r) {
      var f = t.target;
      /tspan/i.test(f.tagName) && (f = f.parentNode);
      var h = N(f).datum();
      u = h && Object.keys(h).length === 1 ? h.index : void 0;
    } else {
      var d = a.axis_rotated, v = vl(n.chart.node()), _ = o === "touch" && t.changedTouches ? t.changedTouches[0] : t, p = d ? _.clientY + v.y : _.clientX + v.x;
      if (dr(n.svg)) {
        var g = [p, 0];
        d && g.reverse(), p = Aa.apply(void 0, wt([n.eventRect.node()], g, !1))[d ? "y" : "x"];
      } else
        p -= d ? c.top : c.left;
      u = Mi(l, p, 0, l.length - 1, d);
    }
    return u;
  },
  getDataLabelLength: function(t, e, n) {
    var a, i = this, r = 1.3;
    return ((a = i.getTextRect([t, e].map(function(o) {
      return i.dataLabelFormat()(o);
    }))) === null || a === void 0 ? void 0 : a.map(function(o) {
      return o[n] * r;
    })) || [0, 0];
  },
  isNoneArc: function(t) {
    return this.hasTarget(this.data.targets, t.id);
  },
  isArc: function(t) {
    return "data" in t && this.hasTarget(this.data.targets, t.data.id);
  },
  findSameXOfValues: function(t, e) {
    var n = t[e].x, a = [], i;
    for (i = e - 1; i >= 0 && n === t[i].x; i--)
      a.push(t[i]);
    for (i = e; i < t.length && n === t[i].x; i++)
      a.push(t[i]);
    return a;
  },
  findClosestFromTargets: function(t, e) {
    var n = this, a = t.map(function(i) {
      return n.findClosest(i.values, e);
    });
    return n.findClosest(a, e);
  },
  findClosest: function(t, e) {
    var n = this, a = n.$el.main, i = t.filter(function(s) {
      return s && nt(s.value);
    }), r, o;
    return i.filter(function(s) {
      return n.isBarType(s.id) || n.isCandlestickType(s.id);
    }).forEach(function(s) {
      var l = n.isBarType(s.id) ? ".".concat(Yt.chartBar, ".").concat(j.target).concat(n.getTargetSelectorSuffix(s.id), " .").concat(Yt.bar, "-").concat(s.index) : ".".concat(ce.chartCandlestick, ".").concat(j.target).concat(n.getTargetSelectorSuffix(s.id), " .").concat(ce.candlestick, "-").concat(s.index, " path");
      !o && n.isWithinBar(a.select(l).node()) && (o = s);
    }), i.filter(function(s) {
      return !n.isBarType(s.id) && !n.isCandlestickType(s.id);
    }).forEach(function(s) {
      var l = n.dist(s, e);
      r = n.getPointSensitivity(s), l < r && (r = l, o = s);
    }), o;
  },
  dist: function(t, e) {
    var n = this, a = n.config.axis_rotated, i = n.scale, r = +a, o = +!a, s = n.circleY(t, t.index), l = (i.zoom || i.x)(t.x);
    return Math.sqrt(Math.pow(l - e[r], 2) + Math.pow(s - e[o], 2));
  },
  /**
   * Convert data for step type
   * @param {Array} values Object data values
   * @returns {Array}
   * @private
   */
  convertValuesToStep: function(t) {
    var e = this, n = e.axis, a = e.config, i = a.line_step_type, r = n ? n.isCategorized() : !1, o = ft(t) ? t.concat() : [t];
    if (!(r || /step\-(after|before)/.test(i)))
      return t;
    if (o.length) {
      var s = o[0], l = o[o.length - 1], c = s.id, u = s.x;
      o.unshift({ x: --u, value: s.value, id: c }), r && i === "step-after" && o.unshift({ x: --u, value: s.value, id: c }), u = l.x, o.push({ x: ++u, value: l.value, id: c }), r && i === "step-before" && o.push({ x: ++u, value: l.value, id: c });
    }
    return o;
  },
  convertValuesToRange: function(t) {
    var e = ft(t) ? t.concat() : [t], n = [];
    return e.forEach(function(a) {
      var i = a.x, r = a.id;
      n.push({
        x: i,
        id: r,
        value: a.value[0]
      }), n.push({
        x: i,
        id: r,
        value: a.value[2]
      });
    }), n;
  },
  updateDataAttributes: function(t, e) {
    var n = this, a = n.config, i = a["data_".concat(t)];
    return St(e) || (Object.keys(e).forEach(function(r) {
      i[r] = e[r];
    }), n.redraw({ withLegend: !0 })), i;
  },
  getRangedData: function(t, e, n) {
    e === void 0 && (e = ""), n === void 0 && (n = "areaRange");
    var a = t?.value;
    if (ft(a)) {
      if (n === "bar")
        return a.reduce(function(r, o) {
          return o - r;
        });
      var i = {
        areaRange: ["high", "mid", "low"],
        candlestick: ["open", "high", "low", "close", "volume"]
      }[n].indexOf(e);
      return i >= 0 && a ? a[i] : void 0;
    } else if (a && e)
      return a[e];
    return a;
  },
  /**
   * Set ratio for grouped data
   * @param {Array} data Data array
   * @private
   */
  setRatioForGroupedData: function(t) {
    var e = this, n = e.config;
    if (n.data_groups.length && t.some(function(i) {
      return e.isGrouped(i.id);
    })) {
      var a = function(i) {
        return e.getRatio("index", i, !0);
      };
      t.forEach(function(i) {
        "values" in i ? i.values.forEach(a) : a(i);
      });
    }
  },
  /**
   * Get ratio value
   * @param {string} type Ratio for given type
   * @param {object} d Data value object
   * @param {boolean} asPercent Convert the return as percent or not
   * @returns {number} Ratio value
   * @private
   */
  getRatio: function(t, e, n) {
    n === void 0 && (n = !1);
    var a = this, i = a.config, r = a.state, o = a.api, s = 0;
    if (e && o.data.shown().length)
      if (s = e.ratio || e.value, t === "arc")
        if (a.pie.padAngle()())
          s = e.value / a.getTotalDataSum(!0);
        else {
          var l = i.gauge_fullCircle ? a.getArcLength() : a.getStartingAngle() * -2, c = a.hasType("gauge") ? l : Math.PI * 2;
          s = (e.endAngle - e.startAngle) / c;
        }
      else if (t === "index") {
        var u = o.data.values.bind(o), f = r.hiddenTargetIds, h = this.getTotalPerIndex(a.isStackNormalizedPerGroup() ? e.id : void 0);
        if (h === null)
          return s;
        if (f.length) {
          var d = f;
          if (a.isStackNormalizedPerGroup() && e.id) {
            var v = i.data_groups.find(function(y) {
              return y.indexOf(e.id) >= 0;
            });
            v && (d = d.filter(function(y) {
              return v.indexOf(y) >= 0;
            }));
          }
          if (d.length) {
            var _ = u(d, !1);
            _.length && (_ = _.reduce(function(y, m) {
              return y.map(function(T, b) {
                return ~~T + m[b];
              });
            }), h = h.map(function(y, m) {
              return y - _[m];
            }));
          }
        }
        var p = h[e.index];
        e.ratio = q(e.value) && h && p ? e.value / p : 0, s = e.ratio;
      } else if (t === "radar")
        s = parseFloat(String(Math.max(e.value, 0))) / r.current.dataMax * i.radar_size_ratio;
      else if (t === "bar") {
        var g = a.getYScaleById.bind(a)(e.id), x = g.domain().reduce(function(y, m) {
          return m - y;
        });
        s = x === 0 ? 0 : Math.abs(a.getRangedData(e, null, t) / x);
      } else t === "treemap" && (s /= a.getTotalDataSum(!0));
    return n && s ? s * 100 : s;
  },
  /**
   * Sort data index to be aligned with x axis.
   * @param {Array} tickValues Tick array values
   * @private
   */
  updateDataIndexByX: function(t) {
    var e = this, n = t.reduce(function(a, i, r) {
      return a[Number(i.x)] = r, a;
    }, {});
    e.data.targets.forEach(function(a) {
      a.values.forEach(function(i, r) {
        var o = n[Number(i.x)];
        o === void 0 && (o = r), i.index = o;
      });
    });
  },
  /**
   * Determine if bubble has dimension data
   * @param {object|Array} d data value
   * @returns {boolean}
   * @private
   */
  isBubbleZType: function(t) {
    var e = this;
    return e.isBubbleType(t) && (ct(t.value) && ("z" in t.value || "y" in t.value) || ft(t.value) && t.value.length >= 2);
  },
  /**
   * Determine if bar has ranged data
   * @param {Array} d data value
   * @returns {boolean}
   * @private
   */
  isBarRangeType: function(t) {
    var e = this, n = t.value;
    return e.isBarType(t) && ft(n) && n.length >= 2 && n.every(q);
  },
  /**
   * Get data object by id
   * @param {string} id data id
   * @returns {object}
   * @private
   */
  getDataById: function(t) {
    var e, n = this.cache.get(t) || this.api.data(t);
    return (e = n?.[0]) !== null && e !== void 0 ? e : n;
  }
};
function Tl(t, e) {
  e === void 0 && (e = !1);
  var n = this, a = n.api;
  e && n.api.flush(!0), t?.call(a);
}
var Bp = {
  load: function(t, e) {
    var n = this, a = n.axis, i = n.data, r = n.org, o = n.scale, s = e.append, l = {
      domain: null,
      currentDomain: null,
      x: null
    }, c = t;
    c && (e.filter && (c = c.filter(e.filter)), (e.type || e.types) && c.forEach(function(u) {
      var f, h = ((f = e.types) === null || f === void 0 ? void 0 : f[u.id]) || e.type;
      n.setTargetType(u.id, h);
    }), i.targets.forEach(function(u) {
      for (var f = 0; f < c.length; f++)
        if (u.id === c[f].id) {
          u.values = s ? u.values.concat(c[f].values) : c[f].values, c.splice(f, 1);
          break;
        }
    }), i.targets = i.targets.concat(c)), n.updateTargets(i.targets), o.zoom && (l.x = a.isCategorized() ? o.x.orgScale() : (r.xScale || o.x).copy(), l.domain = n.getXDomain(i.targets), l.x.domain(l.domain), l.currentDomain = n.zoom.getDomain(), n.withinRange(l.currentDomain, void 0, l.domain) || (o.x.domain(l.domain), o.zoom = null, n.$el.eventRect.property("__zoom", null))), n.redraw({
      withUpdateOrgXDomain: !0,
      withUpdateXDomain: !0,
      withLegend: !0
    }), o.zoom ? (r.xDomain = l.domain, r.xScale = l.x, a.isCategorized() && (l.currentDomain = n.getZoomDomainValue(l.currentDomain), r.xDomain = n.getZoomDomainValue(r.xDomain), r.xScale = l.x.domain(r.xDomain)), n.updateCurrentZoomTransform(l.x, l.currentDomain)) : r.xScale && r.xScale.domain(r.xDomain), n.updateTypesElements(), Tl.call(n, e.done, e.resizeAfter);
  },
  loadFromArgs: function(t) {
    var e = this;
    e.config && (e.cache.reset(), e.convertData(t, function(n) {
      var a = t.data || n;
      t.append && (a.__append__ = !0), a && e.load(e.convertDataToTargets.call(e, a), t);
    }));
  },
  unload: function(t, e) {
    var n, a = this, i = a.state, r = a.$el, o = a.$T, s = !!(!((n = a.hasLegendDefsPoint) === null || n === void 0) && n.call(a)), l = e, c = t;
    if (a.cache.reset(), l || (l = function() {
    }), c = c.filter(function(f) {
      return a.hasTarget(a.data.targets, f);
    }), !c || c.length === 0) {
      l();
      return;
    }
    c.forEach(function(f) {
      var h, d = a.getTargetSelectorSuffix(f);
      i.withoutFadeIn[f] = !1, r.legend && r.legend.selectAll(".".concat(dt.legendItem).concat(d)).remove(), a.data.targets = a.data.targets.filter(function(v) {
        return v.id !== f;
      }), s && ((h = r.defs) === null || h === void 0 || h.select("#".concat(a.getDefsPointId(d))).remove());
    }), i.hasFunnel && a.updateFunnel(a.data.targets), i.hasTreemap && a.updateTargetsForTreemap(a.data.targets), a.updateTypesElements();
    var u = r.svg.selectAll(c.map(function(f) {
      return a.selectorTarget(f);
    }));
    o(u).style("opacity", "0").remove().call(wa, l);
  }
}, Xp = {
  /**
   * Expand data shape/point
   * @param {number} index Index number
   * @param {string} id Data id
   * @param {boolean} reset Reset expand state
   * @private
   */
  setExpand: function(t, e, n) {
    var a = this, i = a.config, r = a.$el.circle;
    r && i.point_focus_expand_enabled && a.expandCircles(t, e, n), a.expandBarTypeShapes(!0, t, e, n);
  },
  /**
   * Expand/Unexpand bar type shapes
   * @param {boolean} expand Expand or unexpand
   * @param {number} i Shape index
   * @param {string} id Data id
   * @param {boolean} reset Reset expand style
   * @private
   */
  expandBarTypeShapes: function(t, e, n, a) {
    t === void 0 && (t = !0);
    var i = this;
    ["bar", "candlestick"].filter(function(r) {
      return i.$el[r];
    }).forEach(function(r) {
      a && i.$el[r].classed(j.EXPANDED, !1), i.getShapeByIndex(r, e, n).classed(j.EXPANDED, t);
    });
  },
  /**
   * Handle data.onover/out callback options
   * @param {boolean} isOver Over or not
   * @param {number|object} d data object
   * @private
   */
  setOverOut: function(t, e) {
    var n = this, a = n.config, i = n.state, r = i.hasFunnel, o = i.hasRadar, s = i.hasTreemap, l = n.$el.main, c = ct(e);
    if (c || e !== -1) {
      var u = a[t ? "data_onover" : "data_onout"].bind(n.api);
      if (a.color_onover && n.setOverColor(t, e, c), c) {
        var f = n.getTargetSelectorSuffix(e.id), h = r || s ? "".concat(j.target + f, " .").concat(At.shape) : at.arc + f;
        u(e, l.select(".".concat(h)).node());
      } else if (a.tooltip_grouped)
        t && (o && n.isPointFocusOnly() ? n.showCircleFocus(n.getAllValuesOnIndex(e, !0)) : n.setExpand(e, null, !0)), !n.isMultipleX() && l.selectAll(".".concat(At.shape, "-").concat(e)).each(function(g) {
          u(g, this);
        });
      else {
        var d = n.cache.get($t.setOverOut) || [], v = l.selectAll(".".concat(At.shape, "-").concat(e)).filter(function(g) {
          return n.isWithinShape(this, g);
        }), _ = v.filter(function() {
          var g = this;
          return d.every(function(x) {
            return x !== g;
          });
        });
        if (!t || v.empty() || d.length === _.size() && _.nodes().every(function(g, x) {
          return g !== d[x];
        }))
          for (; d.length; ) {
            var p = d.pop();
            a.data_onout.bind(n.api)(N(p).datum(), p);
          }
        _.each(function() {
          t && (u(N(this).datum(), this), d.push(this));
        }), n.cache.add($t.setOverOut, d);
      }
    }
  },
  /**
   * Call data.onover/out callback for touch event
   * @param {number|object} d target index or data object for Arc type
   * @private
   */
  callOverOutForTouch: function(t) {
    var e = this, n = e.cache.get($t.callOverOutForTouch);
    (ct(t) && n ? t.id !== n.id : t !== n) && ((n || q(n)) && e.setOverOut(!1, n), (t || q(t)) && e.setOverOut(!0, t), e.cache.add($t.callOverOutForTouch, t));
  },
  /**
   * Return draggable selection function
   * @returns {function}
   * @private
   */
  getDraggableSelection: function() {
    var t = this, e = t.config, n = t.state;
    return e.interaction_enabled && e.data_selection_draggable && t.drag ? fs().on("drag", function(a) {
      n.event = a, t.drag(Zt(a, this));
    }).on("start", function(a) {
      n.event = a, t.dragstart(Zt(a, this));
    }).on("end", function(a) {
      n.event = a, t.dragend();
    }) : function() {
    };
  },
  /**
   * Dispatch a mouse event.
   * @private
   * @param {string} type event type
   * @param {number} index Index of eventRect
   * @param {Array} mouse x and y coordinate value
   */
  dispatchEvent: function(t, e, n) {
    var a, i, r, o = this, s = o.config, l = o.state, c = l.eventReceiver, u = l.hasAxis, f = l.hasFunnel, h = l.hasRadar, d = l.hasTreemap, v = o.$el, _ = v.eventRect, p = v.funnel, g = v.radar, x = v.svg, y = v.treemap, m = (r = (i = (f || d) && c.rect || h && g.axes.select(".".concat(Rt.axis, "-").concat(e, " text")) || _ || ((a = o.getArcElementByIdOrIndex) === null || a === void 0 ? void 0 : a.call(o, e))) === null || i === void 0 ? void 0 : i.node) === null || r === void 0 ? void 0 : r.call(i);
    if (m) {
      var T = o.isMultipleX(), b = s.axis_rotated, w = Mt(m), A = w.width, k = w.left, C = w.top;
      if (u && !h && !T) {
        var E = c.coords[e];
        E ? (A = E.w, k += E.x, C += E.y) : (A = 0, k = 0, C = 0);
      }
      var M = k + (n ? n[0] : 0) + (T || b ? 0 : A / 2), L = C + (n ? n[1] : 0) + (b ? 4 : 0);
      if (dr(x)) {
        var $ = Aa(o.$el.eventRect.node(), M, L, !1);
        M = $.x, L = $.y;
      }
      var D = {
        screenX: M,
        screenY: L,
        clientX: M,
        clientY: L,
        bubbles: h
        // radar type needs to bubble up event
      };
      (f || d) && (m = (p ?? y).node()), mp[/^(mouse|click)/.test(t) ? "mouse" : "touch"](m, t, D);
    }
  },
  setDragStatus: function(t) {
    this.state.dragging = t;
  },
  /**
   * Unbind zoom events
   * @private
   */
  unbindZoomEvent: function() {
    var t = this, e = t.$el, n = e.eventRect, a = e.zoomResetBtn;
    n?.on(".zoom wheel.zoom .drag", null), a?.on("click", null).style("display", "none");
  },
  /**
   * Unbind all attached events
   * @private
   */
  unbindAllEvents: function() {
    var t, e = this, n = e.$el, a = n.arcs, i = n.eventRect, r = n.legend, o = n.region, s = n.svg, l = n.treemap, c = e.brush, u = [
      "wheel",
      "click",
      "mouseover",
      "mousemove",
      "mouseout",
      "touchstart",
      "touchmove",
      "touchend",
      "touchstart.eventRect",
      "touchmove.eventRect",
      "touchend.eventRect",
      ".brush",
      ".drag",
      ".zoom",
      "wheel.zoom",
      "dblclick.zoom"
    ].join(" ");
    [
      s,
      i,
      o?.list,
      c?.getSelection(),
      a?.selectAll("path"),
      r?.selectAll("g"),
      l
    ].forEach(function(f) {
      return f?.on(u, null);
    }), (t = e.unbindZoomEvent) === null || t === void 0 || t.call(e);
  }
}, Gp = {
  /**
   * Category Name
   * @param {number} i Index number
   * @returns {string} category Name
   * @private
   */
  categoryName: function(t) {
    var e, n = this.config.axis_x_categories;
    return (e = n?.[t]) !== null && e !== void 0 ? e : t;
  }
}, Yp = {
  generateClass: function(t, e) {
    return " ".concat(t, " ").concat(t + this.getTargetSelectorSuffix(e));
  },
  /**
   * Get class string
   * @param {string} type Shape type
   * @param {boolean} withShape Get with shape prefix
   * @returns {string} Class string
   * @private
   */
  getClass: function(t, e) {
    var n = this, a = /s$/.test(t), i = /^(area|arc|line|funnel|treemap)s?$/.test(t), r = a ? "id" : "index";
    return function(o) {
      var s = o.data || o, l = (e ? n.generateClass(ut[a ? "shapes" : "shape"], s[r]) : "") + n.generateClass(ut[t], s[i ? "id" : r]);
      return l.trim();
    };
  },
  /**
   * Get chart class string
   * @param {string} type Shape type
   * @returns {string} Class string
   * @private
   */
  getChartClass: function(t) {
    var e = this;
    return function(n) {
      return ut["chart".concat(t)] + e.classTarget((n.data ? n.data : n).id);
    };
  },
  generateExtraLineClass: function() {
    var t = this, e = t.config.line_classes || [], n = [];
    return function(a) {
      var i, r = a.id || ((i = a.data) === null || i === void 0 ? void 0 : i.id) || a;
      return n.indexOf(r) < 0 && n.push(r), e[n.indexOf(r) % e.length];
    };
  },
  classRegion: function(t, e) {
    return "".concat(this.generateClass(ut.region, e), " ").concat("class" in t ? t.class : "");
  },
  classTarget: function(t) {
    var e = this.config.data_classes[t], n = "";
    return e && (n = " ".concat(ut.target, "-").concat(e)), this.generateClass(ut.target, t) + n;
  },
  classFocus: function(t) {
    return this.classFocused(t) + this.classDefocused(t);
  },
  classFocused: function(t) {
    return " ".concat(this.state.focusedTargetIds.indexOf(t.id) >= 0 ? ut.focused : "");
  },
  classDefocused: function(t) {
    return " ".concat(this.state.defocusedTargetIds.indexOf(t.id) >= 0 ? ut.defocused : "");
  },
  getTargetSelectorSuffix: function(t) {
    var e = t || t === 0 ? "-".concat(t) : "";
    return e.replace(/[\x00-\x20\x7F-\xA0\s?!@#$%^&*()_=+,.<>'":;\[\]\/|~`{}\\]/g, "-");
  },
  selectorTarget: function(t, e, n) {
    e === void 0 && (e = ""), n === void 0 && (n = "");
    var a = this.getTargetSelectorSuffix(t);
    return "".concat(e, ".").concat(ut.target + a, " ").concat(n, ", ").concat(e, ".").concat(ut.circles + a, " ").concat(n);
  },
  selectorTargets: function(t, e) {
    var n = this, a = t || [];
    return a.length ? a.map(function(i) {
      return n.selectorTarget(i, e);
    }) : null;
  },
  selectorLegend: function(t) {
    return ".".concat(ut.legendItem + this.getTargetSelectorSuffix(t));
  },
  selectorLegends: function(t) {
    var e = this;
    return t?.length ? t.map(function(n) {
      return e.selectorLegend(n);
    }) : null;
  }
}, Vp = function(t, e, n) {
  var a = N(t.cloneNode(!0));
  return a.attr("id", n).insert("rect", ":first-child").attr("width", a.attr("width")).attr("height", a.attr("height")).style("fill", e), {
    id: n,
    node: a.node()
  };
};
function Up(t) {
  var e = $t.colorPattern, n = mt.body, a = n[e];
  if (!a) {
    var i = ";", r = t.classed(Ci.colorPattern, !0).style("background-image");
    t.classed(Ci.colorPattern, !1), r.indexOf(i) > -1 && (a = r.replace(/url[^#]*|["'()]|(\s|%20)/g, "").split(i).map(function(o) {
      return o.trim().replace(/[\"'\s]/g, "");
    }).filter(Boolean), n[e] = a);
  }
  return a;
}
var Hp = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf"
], Wp = {
  generateColor: function() {
    var t = this, e = t.$el, n = t.config, a = [], i = n.area_linearGradient || n.bar_linearGradient || n.point_radialGradient, r = kt(n.color_pattern) ? n.color_pattern : Ls(Up(e.chart) || Hp).range(), o = r;
    if (U(n.color_tiles)) {
      var s = n.color_tiles.bind(t.api)(), l = r.map(function(c, u) {
        var f = c.replace(/[#\(\)\s,]/g, ""), h = "".concat(t.state.datetimeId, "-pattern-").concat(f, "-").concat(u);
        return Vp(s[u % s.length], c, h);
      });
      r = l.map(function(c) {
        return "url(#".concat(c.id, ")");
      }), t.patterns = l;
    }
    return function(c) {
      var u, f = n.data_colors, h = n.data_color, d = c.id || ((u = c.data) === null || u === void 0 ? void 0 : u.id) || c, v = t.isTypeOf(d, ["line", "spline", "step"]) || !n.data_types[d], _;
      if (U(f[d]) ? _ = f[d].bind(t.api)(c) : f[d] ? _ = f[d] : (a.indexOf(d) < 0 && a.push(d), _ = v ? o[a.indexOf(d) % o.length] : r[a.indexOf(d) % r.length], f[d] = _), _ = U(h) ? h.call(t.api, _, c) : _, i) {
        var p = t.$el.defs.selectAll("[id$='-gradient".concat(t.getTargetSelectorSuffix(d), "'] stop")), g;
        p.each(function(x, y) {
          g = y === 0 ? this.style.stopColor : this.style.stopColor === g;
        }), g === !0 && p.attr("stop-color", _);
      }
      return _;
    };
  },
  generateLevelColor: function() {
    var t = this, e = t.config, n = e.color_pattern, a = e.color_threshold, i = a.unit === "value", r = a.max || 100, o = a.values && a.values.length ? a.values : [];
    return kt(a) ? function(s) {
      for (var l = i ? s : s * 100 / r, c = n[n.length - 1], u = 0, f = o.length; u < f; u++)
        if (l <= o[u]) {
          c = n[u];
          break;
        }
      return c;
    } : null;
  },
  /**
   * Append data backgound color filter definition
   * @param {string|object|function} color Color string, object, or function
   * @param {object} attr filter attribute
   * @private
   */
  generateTextBGColorFilter: function(t, e) {
    e === void 0 && (e = {
      x: 0,
      y: 0,
      width: 1,
      height: 1
    });
    var n = this, a = n.$el.defs, i = n.state;
    if (t) {
      var r = [];
      lt(t) ? r.push("") : ct(t) ? r = Object.keys(t) : U(t) && (r = n.mapToTargetIds()), r.forEach(function(o) {
        var s = "".concat(i.datetimeId, "-labels-bg").concat(n.getTargetSelectorSuffix(o)).concat(lt(t) ? n.getTargetSelectorSuffix(t) : ""), l = nn(o === "" ? t : t?.[o] || "");
        a.select("#".concat(s)).empty() && a.append("filter").attr("x", e.x).attr("y", e.y).attr("width", e.width).attr("height", e.height).attr("id", s).html('<feFlood flood-color="'.concat(l, `" />
							<feComposite in="SourceGraphic" />`));
      });
    }
  },
  /**
   * Get data gradient color url
   * @param {string} id Data id
   * @returns {string}
   * @private
   */
  getGradienColortUrl: function(t) {
    return "url(#".concat(this.state.datetimeId, "-gradient").concat(this.getTargetSelectorSuffix(t), ")");
  },
  /**
   * Update linear/radial gradient definition
   * - linear: area & bar only
   * - radial: type which has data points only
   * @private
   */
  updateLinearGradient: function() {
    var t = this, e = t.config, n = t.data.targets, a = t.state.datetimeId, i = t.$el.defs;
    n.forEach(function(r) {
      var o = "".concat(a, "-gradient").concat(t.getTargetSelectorSuffix(r.id)), s = t.hasPointType() && e.point_radialGradient, l = t.isAreaType(r) && "area" || t.isBarType(r) && "bar";
      if ((s || l) && i.select("#".concat(o)).empty()) {
        var c = t.color(r), u = {
          defs: null,
          stops: []
        };
        if (s) {
          var f = s.cx, h = f === void 0 ? 0.3 : f, d = s.cy, v = d === void 0 ? 0.3 : d, _ = s.r, p = _ === void 0 ? 0.7 : _, g = s.stops, x = g === void 0 ? [[0.1, c, 0], [0.9, c, 1]] : g;
          u.stops = x, u.defs = i.append("radialGradient").attr("id", "".concat(o)).attr("cx", h).attr("cy", v).attr("r", p);
        } else {
          var y = e.axis_rotated, m = e["".concat(l, "_linearGradient")], T = m.x, b = T === void 0 ? y ? [1, 0] : [0, 0] : T, w = m.y, A = w === void 0 ? y ? [0, 0] : [0, 1] : w, k = m.stops, x = k === void 0 ? [[0, c, 1], [1, c, 0]] : k;
          u.stops = x, u.defs = i.append("linearGradient").attr("id", "".concat(o)).attr("x1", b[0]).attr("x2", b[1]).attr("y1", A[0]).attr("y2", A[1]);
        }
        u.stops.forEach(function(C) {
          var E = C[0], M = C[1], L = C[2], $ = U(M) ? M.bind(t.api)(r.id) : M;
          u.defs && u.defs.append("stop").attr("offset", E).attr("stop-color", $ || c).attr("stop-opacity", L);
        });
      }
    });
  },
  /**
   * Set the data over color.
   * When is out, will restate in its previous color value
   * @param {boolean} isOver true: set overed color, false: restore
   * @param {number|object} d target index or data object for Arc type
   * @private
   */
  setOverColor: function(t, e) {
    var n = this, a = n.config, i = n.$el.main, r = a.color_onover, o = t ? r : n.color;
    ct(o) ? o = function(s) {
      var l = s.id;
      return l in r ? r[l] : n.color(l);
    } : lt(o) ? o = function() {
      return r;
    } : U(r) && (o = o.bind(n.api)), i.selectAll(ct(e) ? (
      // when is Arc type
      ".".concat(at.arc).concat(n.getTargetSelectorSuffix(e.id))
    ) : ".".concat(At.shape, "-").concat(e)).style("fill", o);
  }
}, Zp = {
  getYDomainMinMax: function(t, e) {
    var n = this, a = n.axis, i = n.config, r = e === "min", o = i.data_groups, s = n.mapToIds(t), l = _l(s), c = n.getValuesAsIdKeyed(t);
    if (o.length > 0) {
      var u = n["has".concat(r ? "Negative" : "Positive", "ValueInTargets")](t), f = new Map(s.map(function(h) {
        return [h, a.getId(h)];
      }));
      o.forEach(function(h) {
        var d = h.filter(function(p) {
          return l.has(p);
        });
        if (d.length) {
          var v = d[0], _ = f.get(v);
          u && c[v] && (c[v] = c[v].map(function(p) {
            return (r ? p < 0 : p > 0) ? p : 0;
          })), d.filter(function(p, g) {
            return g > 0;
          }).forEach(function(p) {
            if (c[p]) {
              var g = f.get(p);
              c[p].forEach(function(x, y) {
                var m = +x, T = r ? m > 0 : m < 0;
                g === _ && !(u && T) && (c[v][y] += m);
              });
            }
          });
        }
      });
    }
    return Qt(e, Object.keys(c).map(function(h) {
      return Qt(e, c[h]);
    }));
  },
  /**
   * Check if hidden targets bound to the given axis id
   * @param {string} id ID to be checked
   * @returns {boolean}
   * @private
   */
  isHiddenTargetWithYDomain: function(t) {
    var e = this;
    return e.state.hiddenTargetIds.some(function(n) {
      return e.axis.getId(n) === t;
    });
  },
  getYDomain: function(t, e, n) {
    var a = this, i = a.axis, r = a.config, o = a.scale, s = "axis_".concat(e);
    if (a.isStackNormalized()) {
      var l = t.filter(function(S) {
        return i.getId(S.id) === e;
      }).map(function(S) {
        return S.id;
      }), c = l.some(function(S) {
        return a.isGrouped(S);
      });
      if (c)
        return [0, 100];
    }
    var u = o?.[e] && o[e].type === "log", f = t.filter(function(S) {
      return i.getId(S.id) === e;
    }), h = n ? a.filterByXDomain(f, n) : f;
    if (h.length === 0)
      return a.isHiddenTargetWithYDomain(e) ? o[e].domain() : e === "y2" ? o.y.domain() : (
        // When all data bounds to y2, y Axis domain is called prior y2.
        // So, it needs to call to get y2 domain here
        a.getYDomain(t, "y2", n)
      );
    var d = r["".concat(s, "_min")], v = r["".concat(s, "_max")], _ = r["".concat(s, "_center")], p = r["".concat(s, "_inverted")], g = a.hasDataLabel() && r.axis_rotated, x = a.hasDataLabel() && !r.axis_rotated, y = a.getYDomainMinMax(h, "min"), m = a.getYDomainMinMax(h, "max"), T = wt([Y.BAR, Y.BUBBLE, Y.SCATTER], ye.Line, !0).some(function(S) {
      var R = S.indexOf("area") > -1 ? "area" : S;
      return a.hasType(S, h, !0) && r["".concat(R, "_zerobased")];
    });
    y = nt(d) ? d : nt(v) ? y <= v ? y : v - 10 : y, m = nt(v) ? v : nt(d) ? d <= m ? m : d + 10 : m, isNaN(y) && (y = 0), isNaN(m) && (m = y), y === m && (y < 0 ? m = 0 : y = 0);
    var b = y >= 0 && m >= 0, w = y <= 0 && m <= 0;
    (nt(d) && b || nt(v) && w) && (T = !1), T && (b && (y = 0), w && (m = 0));
    var A = Math.abs(m - y), k = { top: A * 0.1, bottom: A * 0.1 };
    if (vt(_)) {
      var C = Math.max(Math.abs(y), Math.abs(m));
      m = _ + C, y = _ - C;
    }
    if (g) {
      var E = Me(o.y.range()), M = a.getDataLabelLength(y, m, "width").map(function(S) {
        var R = S / E;
        return isFinite(R) ? R : 0;
      });
      ["bottom", "top"].forEach(function(S, R) {
        k[S] += A * (M[R] / (1 - M[0] - M[1]));
      });
    } else if (x) {
      var L = a.getDataLabelLength(y, m, "height");
      ["bottom", "top"].forEach(function(S, R) {
        k[S] += a.convertPixelToScale("y", L[R], A);
      });
    }
    k = a.getResettedPadding(k);
    var $ = r["".concat(s, "_padding")];
    kt($) && ["bottom", "top"].forEach(function(S) {
      k[S] = i.getPadding($, S, k[S], A);
    }), T && (b && (k.bottom = y), w && (k.top = -m));
    var D = u ? [y, m].map(function(S) {
      return S < 0 ? 0 : S;
    }) : [y - k.bottom, m + k.top];
    return p ? D.reverse() : D;
  },
  getXDomainMinMax: function(t, e) {
    var n, a = this, i = a.config["axis_x_".concat(e)], r = Qt(e, t.map(function(s) {
      return Qt(e, s.values.map(function(l) {
        return l.x;
      }));
    })), o = ct(i) ? i.value : i;
    return o = vt(o) && (!((n = a.axis) === null || n === void 0) && n.isTimeSeries()) ? jt.bind(this)(o) : o, ct(i) && i.fit && (e === "min" && o < r || e === "max" && o > r) && (o = void 0), vt(o) ? o : r;
  },
  /**
   * Get x Axis padding
   * @param {Array} domain x Axis domain
   * @param {number} tickCount Tick count
   * @returns {object} Padding object values with 'left' & 'right' key
   * @private
   */
  getXDomainPadding: function(t, e) {
    var n = this, a = n.axis, i = n.config, r = i.axis_x_padding, o = a.isTimeSeries() && e, s = Me(t), l;
    if (a.isCategorized() || o)
      l = 0;
    else if (n.hasType("bar")) {
      var c = n.getMaxDataCount();
      l = c > 1 ? s / (c - 1) / 2 : 0.5;
    } else
      l = n.getResettedPadding(s * 0.01);
    var u = q(r) ? { left: r, right: r } : r, f = u.left, h = f === void 0 ? l : f, d = u.right, v = d === void 0 ? l : d;
    if (r.unit === "px") {
      var _ = Math.abs(s + s * 0.2);
      h = a.getPadding(r, "left", l, _), v = a.getPadding(r, "right", l, _);
    } else {
      var p = s + h + v;
      if (o && p) {
        var g = s / e / p;
        h = h / p / g, v = v / p / g;
      }
    }
    return { left: h, right: v };
  },
  /**
   * Get x Axis domain
   * @param {Array} targets targets
   * @returns {Array} x Axis domain
   * @private
   */
  getXDomain: function(t) {
    var e = this, n = e.axis, a = e.config, i = e.scale.x, r = a.axis_x_inverted, o = [
      e.getXDomainMinMax(t, "min"),
      e.getXDomainMinMax(t, "max")
    ], s = o[0], l = s === void 0 ? 0 : s, c = o[1], u = c === void 0 ? 0 : c;
    if (i.type !== "log") {
      var f = n.isCategorized(), h = n.isTimeSeries(), d = e.getXDomainPadding(o), v = o[0], _ = o[1];
      v - _ === 0 && !f && (h ? (v = new Date(v.getTime() * 0.5), _ = new Date(_.getTime() * 1.5)) : (v = v === 0 ? 1 : v * 0.5, _ = _ === 0 ? -1 : _ * 1.5)), (v || v === 0) && (l = h ? new Date(v.getTime() - d.left) : v - d.left), (_ || _ === 0) && (u = h ? new Date(_.getTime() + d.right) : _ + d.right);
    }
    return r ? [u, l] : [l, u];
  },
  updateXDomain: function(t, e, n, a, i) {
    var r, o = this, s = o.config, l = o.org, c = o.scale, u = c.x, f = c.subX, h = s.zoom_enabled;
    if (n && (u.domain(i || on(o.getXDomain(t), !s.axis_x_inverted)), l.xDomain = u.domain(), f.domain(u.domain()), (r = o.brush) === null || r === void 0 || r.scale(f)), e) {
      var d = i || !o.brush || dl(o) ? l.xDomain : hl(o).map(f.invert);
      u.domain(d);
    }
    return (n || e) && h && o.zoom.updateScaleExtent(), a && u.domain(o.trimXDomain(u.orgDomain())), u.domain();
  },
  /**
   * Trim x domain when given domain surpasses the range
   * @param {Array} domain Domain value
   * @returns {Array} Trimed domain if given domain is out of range
   * @private
   */
  trimXDomain: function(t) {
    var e = this, n = e.config.axis_x_inverted, a = e.getZoomDomain(), i = a[0], r = a[1];
    return (n ? t[0] >= i : t[0] <= i) && (t[1] = +t[1] + (i - t[0]), t[0] = i), (n ? t[1] <= r : t[1] >= r) && (t[0] = +t[0] - (t[1] - r), t[1] = r), t;
  },
  /**
   * Get subchart/zoom domain
   * @param {string} type "subX" or "zoom"
   * @param {boolean} getCurrent Get current domain if true
   * @returns {Array} zoom domain
   * @private
   */
  getZoomDomain: function(t, e) {
    t === void 0 && (t = "zoom"), e === void 0 && (e = !1);
    var n = this, a = n.config, i = n.scale, r = n.org, o = e && i[t] ? i[t].domain() : r.xDomain, s = o[0], l = o[1];
    return t === "zoom" && (vt(a.zoom_x_min) && (s = Qt("min", [s, a.zoom_x_min])), vt(a.zoom_x_max) && (l = Qt("max", [l, a.zoom_x_max]))), [s, l];
  },
  /**
   * Return zoom domain from given domain
   * - 'category' type need to add offset to original value
   * @param {Array} domainValue domain value
   * @returns {Array} Zoom domain
   * @private
   */
  getZoomDomainValue: function(t) {
    var e = this, n = e.config, a = e.axis;
    if (a.isCategorized() && Array.isArray(t)) {
      var i = n.axis_x_inverted, r = t.map(function(o, s) {
        return Number(o) + (s === 0 ? +i : +!i);
      });
      return r;
    }
    return t;
  },
  /**
   * Converts pixels to axis' scale values
   * @param {string} type Axis type
   * @param {number} pixels Pixels
   * @param {number} domainLength Domain length
   * @returns {number}
   * @private
   */
  convertPixelToScale: function(t, e, n) {
    var a = this, i = a.config, r = a.state, o = i.axis_rotated, s;
    return t === "x" ? s = o ? "height" : "width" : s = o ? "width" : "height", n * (e / r[s]);
  },
  /**
   * Check if the given domain is within subchart/zoom range
   * @param {Array} domain Target domain value
   * @param {Array} current Current subchart/zoom domain value
   * @param {Array} range subchart/zoom range value
   * @returns {boolean}
   * @private
   */
  withinRange: function(t, e, n) {
    e === void 0 && (e = [0, 0]);
    var a = this, i = a.config.axis_x_inverted, r = n, o = r[0], s = r[1];
    if (Array.isArray(t)) {
      var l = wt([], t, !0);
      if (i && l.reverse(), l[0] < l[1])
        return t.every(function(c, u) {
          return (u === 0 ? i ? +c <= o : +c >= o : i ? +c >= s : +c <= s) && !t.every(function(f, h) {
            return f === e[h];
          });
        });
    }
    return !1;
  }
};
function So(t, e, n) {
  var a = t.config, i = "axis_".concat(e, "_tick_format"), r = a[i] ? a[i] : t.defaultValueFormat;
  return r.call(t.api, n);
}
var qp = {
  yFormat: function(t) {
    return So(this, "y", t);
  },
  y2Format: function(t) {
    return So(this, "y2", t);
  },
  /**
   * Get default value format function
   * @returns {function} formatter function
   * @private
   */
  getDefaultValueFormat: function() {
    var t = this, e = t.defaultArcValueFormat, n = t.yFormat, a = t.y2Format, i = t.hasArcType(null, ["gauge", "polar", "radar"]);
    return function(r, o, s) {
      var l = i ? e : t.axis && t.axis.getId(s) === "y2" ? a : n;
      return l.call(t, r, o);
    };
  },
  defaultValueFormat: function(t) {
    return ft(t) ? t.join("~") : nt(t) ? +t : "";
  },
  defaultArcValueFormat: function(t, e) {
    return "".concat((e * 100).toFixed(1), "%");
  },
  defaultPolarValueFormat: function(t) {
    return "".concat(t);
  },
  dataLabelFormat: function(t) {
    var e = this, n = e.config.data_labels, a = function(r) {
      var o = "~", s = r;
      return ft(r) ? s = r.join(o) : ct(r) && (s = Object.values(r).join(o)), s;
    }, i = a;
    return U(n.format) ? i = n.format : Ut(n.format) && (n.format[t] ? i = n.format[t] === !0 ? a : n.format[t] : i = function() {
      return "";
    }), i.bind(e.api);
  }
};
function Wn(t) {
  var e = this, n = e.getDataById(t), a = e.levelColor ? e.levelColor(n.values[0].value) : e.color(n);
  return a;
}
function ci(t, e) {
  var n;
  e === void 0 && (e = !0);
  var a = this.config, i = (n = a.data_names[t]) !== null && n !== void 0 ? n : t;
  return e && U(a.legend_format) && (i = a.legend_format(i, t !== i ? t : void 0)), i;
}
function jp(t, e) {
  if (!(!e || e.empty())) {
    var n = [];
    e.each(function(i) {
      n.push({ id: i, node: this });
    });
    var a = xl(n, function(i) {
      return i.id;
    }, function(i) {
      return i.node;
    });
    t.cache.add($t.legendItemMap, a);
  }
}
var Kp = {
  /**
   * Initialize the legend.
   * @private
   */
  initLegend: function() {
    var t = this, e = t.config, n = t.$el;
    t.legendItemTextBox = {}, t.state.legendHasRendered = !1, e.legend_show ? (e.legend_contents_bindto || (n.legend = t.$el.svg.append("g").classed(dt.legend, !0).attr("transform", t.getTranslate("legend"))), t.updateLegend()) : t.state.hiddenLegendIds = t.mapToIds(t.data.targets);
  },
  /**
   * Update legend element
   * @param {Array} targetIds ID's of target
   * @param {object} options withTransform : Whether to use the transform property / withTransitionForTransform: Whether transition is used when using the transform property / withTransition : whether or not to transition.
   * @param {object} transitions Return value of the generateTransitions
   * @private
   */
  updateLegend: function(t, e, n) {
    var a, i = this, r = i.config, o = i.state, s = i.scale, l = i.$el, c = e || {
      withTransform: !1,
      withTransitionForTransform: !1,
      withTransition: !1
    };
    c.withTransition = Te(c, "withTransition", !0), c.withTransitionForTransform = Te(c, "withTransitionForTransform", !0), r.legend_contents_bindto && r.legend_contents_template ? i.updateLegendTemplate() : o.hasTreemap || i.updateLegendElement(t || i.mapToIds(i.data.targets), c, n), (a = l.legend) === null || a === void 0 || a.selectAll(".".concat(dt.legendItem)).classed(dt.legendItemHidden, function(u) {
      var f = !i.isTargetToShow(u);
      return f && (this.style.opacity = null), f;
    }), i.updateScales(!1, !s.zoom), i.updateSvgSize(), i.transformAll(c.withTransitionForTransform, n), o.legendHasRendered = !0;
  },
  /**
   * Update legend using template option
   * @private
   */
  updateLegendTemplate: function() {
    var t = this, e = t.config, n = t.$el, a = N(e.legend_contents_bindto), i = e.legend_contents_template;
    if (!a.empty()) {
      var r = t.mapToIds(t.data.targets), o = [], s = "";
      r.forEach(function(c) {
        var u = U(i) ? nn(i.call(t.api, c, t.color(c), t.api.data(c)[0].values)) : zn(i, {
          COLOR: t.color(c),
          TITLE: c
        });
        u && (o.push(c), s += u);
      });
      var l = a.html(s).selectAll(function() {
        return this.childNodes;
      }).data(o);
      t.setLegendItem(l), n.legend = a;
    }
  },
  /**
   * Update the size of the legend.
   * @param {Obejct} size Size object
   * @private
   */
  updateSizeForLegend: function(t) {
    var e = this, n = e.config, a = e.state, i = a.isLegendTop, r = a.isLegendLeft, o = a.isLegendRight, s = a.isLegendInset, l = a.current, c = t.width, u = t.height, f = {
      top: i ? e.getCurrentPaddingByDirection("top") + n.legend_inset_y + 5.5 : l.height - u - e.getCurrentPaddingByDirection("bottom") - n.legend_inset_y,
      left: r ? e.getCurrentPaddingByDirection("left") + n.legend_inset_x + 0.5 : l.width - c - e.getCurrentPaddingByDirection("right") - n.legend_inset_x + 0.5
    };
    e.state.margin3 = {
      top: o ? 0 : s ? f.top : l.height - u,
      right: NaN,
      bottom: 0,
      left: o ? l.width - c : s ? f.left : 0
    };
  },
  /**
   * Transform Legend
   * @param {boolean} withTransition whether or not to transition.
   * @private
   */
  transformLegend: function(t) {
    var e = this, n = e.$el.legend, a = e.$T;
    a(n, t).attr("transform", e.getTranslate("legend"));
  },
  /**
   * Update the legend step
   * @param {number} step Step value
   * @private
   */
  updateLegendStep: function(t) {
    this.state.legendStep = t;
  },
  /**
   * Update legend item width
   * @param {number} width Width value
   * @private
   */
  updateLegendItemWidth: function(t) {
    this.state.legendItemWidth = t;
  },
  /**
   * Update legend item height
   * @param {number} height Height value
   * @private
   */
  updateLegendItemHeight: function(t) {
    this.state.legendItemHeight = t;
  },
  /**
   * Update legend item color
   * @param {string} id Corresponding data ID value
   * @param {string} color Color value
   * @private
   */
  updateLegendItemColor: function(t, e) {
    var n = this, a = n.$el.legend;
    if (a) {
      var i = n.getLegendItemById(t);
      i && N(i).select("line").style("stroke", e);
    }
  },
  /**
   * Get the width of the legend
   * @returns {number} width
   * @private
   */
  getLegendWidth: function() {
    var t = this, e = t.state, n = e.current.width, a = e.isLegendRight, i = e.isLegendInset, r = e.legendItemWidth, o = e.legendStep;
    return t.config.legend_show ? a || i ? r * (o + 1) : n : 0;
  },
  /**
   * Get the height of the legend
   * @returns {number} height
   * @private
   */
  getLegendHeight: function() {
    var t, e = this, n = e.state, a = n.current, i = n.isLegendRight, r = n.legendItemHeight, o = n.legendStep, s = ((t = e.config.padding) === null || t === void 0 ? void 0 : t.mode) === "fit", l = e.config.legend_show ? i ? a.height : Math.max(s ? 10 : 20, r) * (o + 1) : 0;
    return l;
  },
  /**
   * Get the opacity of the legend that is unfocused
   * @param {d3.selection} legendItem Legend item node
   * @returns {string|null} opacity
   * @private
   */
  opacityForUnfocusedLegend: function(t) {
    return t.classed(dt.legendItemHidden) ? null : "0.3";
  },
  /**
   * Toggles the focus of the legend
   * @param {Array} targetIds ID's of target
   * @param {boolean} focus whether or not to focus.
   * @private
   */
  toggleFocusLegend: function(t, e) {
    var n = this, a = n.$el.legend, i = n.$T, r = n.mapToTargetIds(t);
    a && i(a.selectAll(".".concat(dt.legendItem)).filter(function(o) {
      return r.indexOf(o) >= 0;
    }).classed(gt.legendItemFocused, e)).style("opacity", function() {
      return e ? null : n.opacityForUnfocusedLegend.call(n, N(this));
    });
  },
  /**
   * Revert the legend to its default state
   * @private
   */
  revertLegend: function() {
    var t = this, e = t.$el.legend, n = t.$T;
    e && n(e.selectAll(".".concat(dt.legendItem)).classed(gt.legendItemFocused, !1)).style("opacity", null);
  },
  /**
   * Shows the legend
   * @param {Array} targetIds ID's of target
   * @private
   */
  showLegend: function(t) {
    var e = this, n = e.config, a = e.$el, i = e.$T;
    n.legend_show || (n.legend_show = !0, a.legend ? a.legend.style("visibility", null) : e.initLegend(), !e.state.legendHasRendered && e.updateLegend()), e.removeHiddenLegendIds(t), i(a.legend.selectAll(e.selectorLegends(t)).style("visibility", null)).style("opacity", null);
  },
  /**
   * Hide the legend
   * @param {Array} targetIds ID's of target
   * @private
   */
  hideLegend: function(t) {
    var e = this, n = e.config, a = e.$el.legend;
    n.legend_show && qt(t) && (n.legend_show = !1, a.style("visibility", "hidden")), e.addHiddenLegendIds(t), a.selectAll(e.selectorLegends(t)).style("opacity", "0").style("visibility", "hidden");
  },
  /**
   * Get legend item textbox dimension
   * @param {string} id Data ID
   * @param {HTMLElement|d3.selection} textElement Text node element
   * @returns {object} Bounding rect
   * @private
   */
  getLegendItemTextBox: function(t, e) {
    var n = this, a = n.cache, i = n.state, r, o = $t.legendItemTextBox;
    return t && (r = !i.redrawing && a.get(o) || {}, r[t] || (r[t] = n.getTextRect(e, dt.legendItem), a.add(o, r)), r = r[t]), r;
  },
  /**
   * Set legend item style & bind events
   * @param {d3.selection} item Item node
   * @private
   */
  setLegendItem: function(t) {
    var e = this, n = e.$el, a = e.api, i = e.config, r = e.state, o = r.inputType === "touch", s = e.hasType("gauge"), l = i.boost_useCssRule, c = i.legend_item_interaction;
    t.attr("class", function(u) {
      var f = N(this), h = !f.empty() && f.attr("class") || "";
      return h + e.generateClass(dt.legendItem, u);
    }).style("visibility", function(u) {
      return e.isLegendToShow(u) ? null : "hidden";
    }), i.interaction_enabled && (l && [
      [".".concat(dt.legendItem), "cursor:pointer"],
      [".".concat(dt.legendItem, " text"), "pointer-events:none"],
      [".".concat(dt.legendItemPoint, " text"), "pointer-events:none"],
      [".".concat(dt.legendItemTile), "pointer-events:none"],
      [".".concat(dt.legendItemEvent), "fill-opacity:0"]
    ].forEach(function(u) {
      var f = u[0], h = u[1];
      e.setCssRule(!1, f, [h])(n.legend);
    }), t.on(c.dblclick ? "dblclick" : "click", c || U(i.legend_item_onclick) ? function(u, f) {
      if (!pt(i.legend_item_onclick, a, f, !r.hiddenTargetIds.includes(f))) {
        var h = u.altKey, d = u.target, v = u.type;
        v === "dblclick" || h ? r.hiddenTargetIds.length && d.parentNode.getAttribute("class").indexOf(dt.legendItemHidden) === -1 ? a.show() : (a.hide(), a.show(f)) : (a.toggle(f), N(this).classed(gt.legendItemFocused, !1));
      }
      o && e.hideTooltip();
    } : null), !o && t.on("mouseout", c || U(i.legend_item_onout) ? function(u, f) {
      pt(i.legend_item_onout, a, f, !r.hiddenTargetIds.includes(f)) || (N(this).classed(gt.legendItemFocused, !1), s && e.undoMarkOverlapped(e, ".".concat(Vt.gaugeValue)), e.api.revert());
    } : null).on("mouseover", c || U(i.legend_item_onover) ? function(u, f) {
      pt(i.legend_item_onover, a, f, !r.hiddenTargetIds.includes(f)) || (N(this).classed(gt.legendItemFocused, !0), s && e.markOverlapped(f, e, ".".concat(Vt.gaugeValue)), !r.transiting && e.isTargetToShow(f) && a.focus(f));
    } : null), !t.empty() && t.on("click mouseout mouseover") && t.style("cursor", e.getStylePropValue("pointer"))), jp(e, t);
  },
  /**
   * Get legend item node by ID using cached Map for O(1) lookup
   * Falls back to D3 selection if map is not available
   * @param {string} id Data ID
   * @returns {HTMLElement | null} Legend item node
   * @private
   */
  getLegendItemById: function(t) {
    var e, n = this, a = n.cache.get($t.legendItemMap);
    if (a && a instanceof Map)
      return a.get(t) || null;
    var i = (e = n.$el.legend) === null || e === void 0 ? void 0 : e.selectAll(".".concat(dt.legendItem)).filter(function(r) {
      return r === t;
    });
    return i?.node() || null;
  },
  /**
   * Update the legend
   * @param {Array} targetIds ID's of target
   * @param {object} options withTransform : Whether to use the transform property / withTransitionForTransform: Whether transition is used when using the transform property / withTransition : whether or not to transition.
   * @private
   */
  updateLegendElement: function(t, e) {
    var n = this, a = n.config, i = n.state, r = n.$el.legend, o = n.$T, s = a.legend_item_tile_type, l = s !== "circle", c = a.legend_item_tile_r, u = {
      width: l ? a.legend_item_tile_width : c * 2,
      height: l ? a.legend_item_tile_height : c * 2
    }, f = {
      padding: {
        top: 4,
        right: 10
      },
      max: {
        width: 0,
        height: 0
      },
      posMin: 10,
      step: 0,
      tileWidth: u.width + 5,
      totalLength: 0
    }, h = {
      offsets: {},
      widths: {},
      heights: {},
      margins: [0],
      steps: {}
    }, d, v, _, p = t.filter(function(b) {
      return !vt(a.data_names[b]) || a.data_names[b] !== null;
    }), g = e.withTransition, x = n.getUpdateLegendPositions(p, f, h);
    i.isLegendInset && (f.step = a.legend_inset_step ? a.legend_inset_step : p.length, n.updateLegendStep(f.step)), i.isLegendRight ? (d = function(b) {
      return f.max.width * h.steps[b];
    }, v = function(b) {
      return h.margins[h.steps[b]] + h.offsets[b];
    }) : i.isLegendInset ? (d = function(b) {
      return f.max.width * h.steps[b] + 10;
    }, v = function(b) {
      return h.margins[h.steps[b]] + h.offsets[b];
    }) : (d = function(b) {
      return h.margins[h.steps[b]] + h.offsets[b];
    }, v = function(b) {
      return f.max.height * h.steps[b];
    });
    var y = {
      xText: function(b, w) {
        return d(b, w) + 4 + u.width;
      },
      xRect: function(b, w) {
        return d(b, w);
      },
      x1Tile: function(b, w) {
        return d(b, w) - 2;
      },
      x2Tile: function(b, w) {
        return d(b, w) - 2 + u.width;
      },
      yText: function(b, w) {
        return v(b, w) + 9;
      },
      yRect: function(b, w) {
        return v(b, w) - 5;
      },
      yTile: function(b, w) {
        return v(b, w) + 4;
      }
    };
    n.generateLegendItem(p, u, x, y), _ = r.select(".".concat(dt.legendBackground, " rect")), i.isLegendInset && f.max.width > 0 && _.size() === 0 && (_ = r.insert("g", ".".concat(dt.legendItem)).attr("class", dt.legendBackground).append("rect")), a.legend_tooltip && r.selectAll("title").data(p).text(function(b) {
      return ci.bind(n)(b, !1);
    });
    var m = r.selectAll("text").data(p).text(function(b) {
      return ci.bind(n)(b);
    }).each(function(b, w) {
      x(this, b, w);
    });
    o(m, g).attr("x", y.xText).attr("y", y.yText);
    var T = r.selectAll("rect.".concat(dt.legendItemEvent)).data(p);
    o(T, g).attr("width", function(b) {
      return h.widths[b];
    }).attr("height", function(b) {
      return h.heights[b];
    }).attr("x", y.xRect).attr("y", y.yRect), n.updateLegendItemPos(p, g, y), _ && o(_, g).attr("height", n.getLegendHeight() - 12).attr("width", f.max.width * (f.step + 1) + 10), n.updateLegendItemWidth(f.max.width), n.updateLegendItemHeight(f.max.height), n.updateLegendStep(f.step);
  },
  /**
   * Get position update function
   * @param {Array} targetIdz Data ids
   * @param {object} dimension Dimension object
   * @param {object} sizes Size object
   * @returns {function} Update position function
   * @private
   */
  getUpdateLegendPositions: function(t, e, n) {
    var a = this, i = a.config, r = a.state, o = r.isLegendRight || r.isLegendInset;
    return function(s, l, c) {
      var u = c === 0, f = c === t.length - 1, h = a.getLegendItemTextBox(l, s), d = h.width + e.tileWidth + (f && !o ? 0 : e.padding.right) + i.legend_padding, v = h.height + e.padding.top, _ = o ? v : d, p = o ? a.getLegendHeight() : a.getLegendWidth(), g, x = function(m, T) {
        T || (g = (p - e.totalLength - _) / 2, g < e.posMin && (g = (p - _) / 2, e.totalLength = 0, e.step++)), n.steps[m] = e.step, n.margins[e.step] = r.isLegendInset ? 10 : g, n.offsets[m] = e.totalLength, e.totalLength += _;
      };
      if (u && (e.totalLength = 0, e.step = 0, e.max.width = 0, e.max.height = 0), i.legend_show && !a.isLegendToShow(l)) {
        n.widths[l] = 0, n.heights[l] = 0, n.steps[l] = 0, n.offsets[l] = 0;
        return;
      }
      n.widths[l] = d, n.heights[l] = v, (!e.max.width || d >= e.max.width) && (e.max.width = d), (!e.max.height || v >= e.max.height) && (e.max.height = v);
      var y = o ? e.max.height : e.max.width;
      i.legend_equally ? (Object.keys(n.widths).forEach(function(m) {
        return n.widths[m] = e.max.width;
      }), Object.keys(n.heights).forEach(function(m) {
        return n.heights[m] = e.max.height;
      }), g = (p - y * t.length) / 2, g < e.posMin ? (e.totalLength = 0, e.step = 0, t.forEach(function(m) {
        return x(m);
      })) : x(l, !0)) : x(l);
    };
  },
  /**
   * Generate legend item elements
   * @param {Array} targetIdz Data ids
   * @param {object} itemTileSize Item tile size {width, height}
   * @param {function} updatePositions Update position function
   * @param {object} posFn Position functions
   * @private
   */
  generateLegendItem: function(t, e, n, a) {
    var i = this, r = i.config, o = i.state, s = i.$el.legend, l = r.legend_usePoint, c = r.legend_item_tile_r, u = r.legend_item_tile_type, f = u !== "circle", h = o.isLegendRight || o.isLegendInset, d = -200, v = s.selectAll(".".concat(dt.legendItem)).data(t).enter().append("g");
    if (i.setLegendItem(v), r.legend_tooltip && v.append("title").text(function(g) {
      return g;
    }), v.append("text").text(function(g) {
      return ci.bind(i)(g);
    }).each(function(g, x) {
      n(this, g, x);
    }).style("pointer-events", i.getStylePropValue("none")).attr("x", h ? a.xText : d).attr("y", h ? d : a.yText), v.append("rect").attr("class", dt.legendItemEvent).style("fill-opacity", i.getStylePropValue("0")).attr("x", h ? a.xRect : d).attr("y", h ? d : a.yRect), l) {
      var _ = [], p = i.getValidPointPattern();
      v.append(function(g) {
        _.indexOf(g) === -1 && _.push(g);
        var x = p[_.indexOf(g) % p.length];
        return x === "rectangle" && (x = "rect"), mt.createElementNS(Ke.svg, "hasValidPointType" in i && i.hasValidPointType(x) ? x : "use");
      }).attr("class", dt.legendItemPoint).style("fill", Wn.bind(i)).style("pointer-events", i.getStylePropValue("none")).attr("href", function(g, x, y) {
        var m = y[x], T = m.nodeName.toLowerCase(), b = i.getTargetSelectorSuffix(g);
        return T === "use" ? "#".concat(o.datetimeId, "-point").concat(b) : void 0;
      });
    } else
      v.append(f ? "line" : u).attr("class", dt.legendItemTile).style("stroke", Wn.bind(i)).style("pointer-events", i.getStylePropValue("none")).call(function(g) {
        u === "circle" ? g.attr("r", c).style("fill", Wn.bind(i)).attr("cx", h ? a.x2Tile : d).attr("cy", h ? d : a.yTile) : f && g.attr("stroke-width", e.height).attr("x1", h ? a.x1Tile : d).attr("y1", h ? d : a.yTile).attr("x2", h ? a.x2Tile : d).attr("y2", h ? d : a.yTile);
      });
  },
  /**
   * Update legend item position
   * @param {Array} targetIdz Data ids
   * @param {boolean} withTransition Whether or not to apply transition
   * @param {object} posFn Position functions
   * @private
   */
  updateLegendItemPos: function(t, e, n) {
    var a = this, i = a.config, r = a.$el.legend, o = a.$T, s = i.legend_usePoint, l = i.legend_item_tile_type, c = l !== "circle";
    if (s) {
      var u = r.selectAll(".".concat(dt.legendItemPoint)).data(t);
      o(u, e).each(function() {
        var f = this.nodeName.toLowerCase(), h = i.point_r, d = "x", v = "y", _ = 2, p = 2.5, g = null, x = null, y = null;
        if (f === "circle") {
          var m = h * 0.2;
          d = "cx", v = "cy", g = h + m, _ = h * 2, p = -m;
        } else if (f === "rect") {
          var m = h * 2.5;
          x = m, y = m, p = 3;
        }
        N(this).attr(d, function(T) {
          return n.x1Tile(T) + _;
        }).attr(v, function(T) {
          return n.yTile(T) - p;
        }).attr("r", g).attr("width", x).attr("height", y);
      });
    } else {
      var u = r.selectAll(".".concat(dt.legendItemTile)).data(t);
      o(u, e).style("stroke", Wn.bind(a)).call(function(h) {
        l === "circle" ? h.attr("cx", function(d) {
          var v = n.x2Tile(d);
          return v - (v - n.x1Tile(d)) / 2;
        }).attr("cy", n.yTile) : c && h.attr("x1", n.x1Tile).attr("y1", n.yTile).attr("x2", n.x2Tile).attr("y2", n.yTile);
      });
    }
  }
}, Jp = {
  redraw: function(t) {
    var e, n, a, i;
    t === void 0 && (t = {});
    var r = this, o = r.config, s = r.state, l = r.$el, c = l.main, u = l.treemap;
    s.redrawing = !0;
    var f = r.filterTargetsToShow(r.data.targets), h = t.flow, d = t.initializing, v = r.getWithOption(t), _ = v.Transition ? o.transition_duration : 0, p = v.TransitionForExit ? _ : 0, g = v.TransitionForAxis ? _ : 0, x = (e = r.axis) === null || e === void 0 ? void 0 : e.generateTransitions(g);
    r.updateSizes(d), v.Legend && o.legend_show ? (t.withTransition = !!_, !u && r.updateLegend(r.mapToIds(r.data.targets), t, x)) : v.Dimension && r.updateDimension(!0), o.data_empty_label_text && c.select("text.".concat(Ct.text, ".").concat(j.empty)).attr("x", s.width / 2).attr("y", s.height / 2).text(o.data_empty_label_text).style("display", f.length ? "none" : null), s.hasAxis ? (r.axis.redrawAxis(f, v, x, h, d), r.hasGrid() && r.updateGrid(), o.regions.length && r.updateRegion(), ["bar", "candlestick", "line", "area"].forEach(function(y) {
      var m = Nt(y);
      (/^(line|area)$/.test(y) && r.hasTypeOf(m) || r.hasType(y)) && r["update".concat(m)](v.TransitionForExit);
    }), l.text && c.selectAll(".".concat(xt.selectedCircles)).filter(r.isBarType.bind(r)).selectAll("circle").remove(), o.interaction_enabled && !h && v.EventRect && (r.redrawEventRect(), (n = r.bindZoomEvent) === null || n === void 0 || n.call(r))) : (l.arcs && r.redrawArc(_, p, v.Transform), l.radar && r.redrawRadar(), l.polar && r.redrawPolar(), l.funnel && r.redrawFunnel(), u && r.updateTreemap(p)), !s.resizing && !u && (r.hasPointType() || s.hasRadar) ? r.updateCircle() : !((a = r.hasLegendDefsPoint) === null || a === void 0) && a.call(r) && r.data.targets.forEach(r.point("create", this)), r.hasDataLabel() && !r.hasArcType(null, ["radar"]) && r.updateText(), (i = r.redrawTitle) === null || i === void 0 || i.call(r), d && r.updateTypesElements(), r.generateRedrawList(f, h, _, v.Subchart), r.updateTooltipOnRedraw(), r.callPluginHook("$redraw", t, _);
  },
  /**
   * Generate redraw list
   * @param {object} targets targets data to be shown
   * @param {object} flow flow object
   * @param {number} duration duration value
   * @param {boolean} withSubchart whether or not to show subchart
   * @private
   */
  generateRedrawList: function(t, e, n, a) {
    var i = this, r = i.config, o = i.state, s = i.getDrawShape();
    o.hasAxis && r.subchart_show && i.redrawSubchart(a, n, s);
    var l = e && i.generateFlow({
      targets: t,
      flow: e,
      duration: e.duration,
      shape: s,
      xv: i.xv.bind(i)
    }), c = (n || l) && Nn(), u = i.getRedrawList(s, e, l, c), f = function() {
      l && l(), o.redrawing = !1, pt(r.onrendered, i.api);
    };
    if (f)
      if (c && u.length) {
        var h = ml();
        ws().duration(n).each(function() {
          u.reduce(function(d, v) {
            return d.concat(v);
          }, []).forEach(function(d) {
            return h.add(d);
          });
        }).call(h, f);
      } else o.transiting || f();
    i.mapToIds(i.data.targets).forEach(function(d) {
      o.withoutFadeIn[d] = !0;
    });
  },
  getRedrawList: function(t, e, n, a) {
    var i = this, r = i.config, o = i.state, s = o.hasAxis, l = o.hasRadar, c = o.hasTreemap, u = i.$el.grid, f = t.pos, h = f.cx, d = f.cy, v = f.xForText, _ = f.yForText, p = [];
    return s && ((r.grid_x_lines.length || r.grid_y_lines.length) && p.push(i.redrawGrid(a)), r.regions.length && p.push(i.redrawRegion(a)), Object.keys(t.type).forEach(function(g) {
      var x = Nt(g), y = t.type[g];
      (/^(area|line)$/.test(g) && i.hasTypeOf(x) || i.hasType(g)) && p.push(i["redraw".concat(x)](y, a));
    }), !e && u.main && p.push(i.updateGridFocus())), (!i.hasArcType() || l) && kt(r.data_labels) && r.data_labels !== !1 && p.push(i.redrawText(v, _, e, a)), (i.hasPointType() || l) && !i.isPointFocusOnly() && i.redrawCircle && p.push(i.redrawCircle(h, d, a, n)), c && p.push(i.redrawTreemap(a)), p;
  },
  updateAndRedraw: function(t) {
    t === void 0 && (t = {});
    var e = this, n = e.config, a = e.state, i;
    t.withTransition = Te(t, "withTransition", !0), t.withTransform = Te(t, "withTransform", !1), t.withLegend = Te(t, "withLegend", !1), t.withUpdateXDomain = !0, t.withUpdateOrgXDomain = !0, t.withTransitionForExit = !1, t.withTransitionForTransform = Te(t, "withTransitionForTransform", t.withTransition), t.withLegend && n.legend_show || (a.hasAxis && (i = e.axis.generateTransitions(t.withTransitionForAxis ? n.transition_duration : 0)), e.updateScales(), e.updateSvgSize(), e.transformAll(t.withTransitionForTransform, i)), e.redraw(t, i);
  }
};
function ze(t, e, n) {
  t === void 0 && (t = "linear");
  var a = {
    linear: _a,
    log: Os,
    _log: Ps,
    time: bv,
    utc: Tv
  }[t]();
  return a.type = t, /_?log/.test(t) && a.clamp(!0), a.range([e ?? 0, n ?? 1]);
}
var Qp = {
  /**
   * Get x Axis scale function
   * @param {number} min Min range value
   * @param {number} max Max range value
   * @param {Array} domain Domain value
   * @param {function} offset The offset getter to be sum
   * @returns {function} scale
   * @private
   */
  getXScale: function(t, e, n, a) {
    var i = this, r = i.state.loading !== "append" && i.scale.zoom || ze(i.axis.getAxisType("x"), t, e);
    return i.getCustomizedXScale(n ? r.domain(n) : r, a);
  },
  /**
   * Get y Axis scale function
   * @param {string} id Axis id: 'y' or 'y2'
   * @param {number} min Min value
   * @param {number} max Max value
   * @param {Array} domain Domain value
   * @returns {function} Scale function
   * @private
   */
  getYScale: function(t, e, n, a) {
    var i = this, r = ze(i.axis.getAxisType(t), e, n);
    return a && r.domain(a), r;
  },
  /**
   * Get y Axis scale
   * @param {string} id Axis id
   * @param {boolean} isSub Weather is sub Axis
   * @returns {function} Scale function
   * @private
   */
  getYScaleById: function(t, e) {
    var n;
    e === void 0 && (e = !1);
    var a = ((n = this.axis) === null || n === void 0 ? void 0 : n.getId(t)) === "y2", i = e ? a ? "subY2" : "subY" : a ? "y2" : "y";
    return this.scale[i];
  },
  /**
   * Get customized x axis scale
   * @param {d3.scaleLinear|d3.scaleTime} scaleValue Scale function
   * @param {function} offsetValue Offset getter to be sum
   * @returns {function} Scale function
   * @private
   */
  getCustomizedXScale: function(t, e) {
    var n = this, a = e || (function() {
      return n.axis.x.tickOffset();
    }), i = n.config.axis_x_inverted, r = function(s) {
      return t(s) + a();
    };
    for (var o in t)
      r[o] = t[o];
    return r.orgDomain = function() {
      return t.domain();
    }, r.orgScale = function() {
      return t;
    }, n.axis.isCategorized() && (r.domain = function(s) {
      var l = s;
      return arguments.length ? (t.domain(l), r) : (l = this.orgDomain(), i ? [l[0] + 1, l[1]] : [l[0], l[1] + 1]);
    }), r;
  },
  /**
   * Update scale
   * @param {boolean} isInit Param is given at the init rendering
   * @param {boolean} updateXDomain If update x domain
   * @private
   */
  updateScales: function(t, e) {
    var n, a;
    e === void 0 && (e = !0);
    var i = this, r = i.axis, o = i.config, s = i.format, l = i.org, c = i.scale, u = i.state, f = u.current, h = u.width, d = u.height, v = u.width2, _ = u.height2, p = u.hasAxis, g = u.hasTreemap;
    if (p) {
      var x = o.axis_rotated, y = i.getResettedPadding(1), m = {
        x: x ? y : 0,
        y: x ? 0 : d,
        subX: x ? 1 : 0,
        subY: x ? 0 : _
      }, T = {
        x: x ? d : h,
        y: x ? h : y,
        subX: x ? d : h,
        subY: x ? v : 1
      }, b = e && ((n = c.x) === null || n === void 0 ? void 0 : n.orgDomain()), w = e && l.xDomain;
      c.x = i.getXScale(m.x, T.x, b, function() {
        return r.x.tickOffset();
      }), c.subX = i.getXScale(m.x, T.x, w, function(k) {
        var C;
        return k % 1 ? 0 : ((C = r.subX) !== null && C !== void 0 ? C : r.x).tickOffset();
      }), s.xAxisTick = r.getXAxisTickFormat(), s.subXAxisTick = r.getXAxisTickFormat(!0), r.setAxis("x", c.x, o.axis_x_tick_outer, t), o.subchart_show && r.setAxis("subX", c.subX, o.axis_x_tick_outer, t), c.y = i.getYScale("y", m.y, T.y, c.y ? c.y.domain() : o.axis_y_default), c.subY = i.getYScale("y", m.subY, T.subY, c.subY ? c.subY.domain() : o.axis_y_default), r.setAxis("y", c.y, o.axis_y_tick_outer, t), o.axis_y2_show && (c.y2 = i.getYScale("y2", m.y, T.y, c.y2 ? c.y2.domain() : o.axis_y2_default), c.subY2 = i.getYScale("y2", m.subY, T.subY, c.subY2 ? c.subY2.domain() : o.axis_y2_default), r.setAxis("y2", c.y2, o.axis_y2_tick_outer, t));
    } else if (g) {
      var A = i.getCurrentPadding();
      c.x = _a().rangeRound([A.left, f.width - A.right]), c.y = _a().rangeRound([A.top, f.height - A.bottom]);
    } else
      (a = i.updateArc) === null || a === void 0 || a.call(i);
  },
  /**
   * Get the zoom or unzoomed scaled value
   * @param {Date|number|object} d Data value
   * @returns {number|null}
   * @private
   */
  xx: function(t) {
    var e = this, n = e.config, a = e.scale, i = a.x, r = a.zoom, o = n.zoom_enabled && r ? r : i;
    return t ? o(nt(t.x) ? t.x : t) : null;
  },
  xv: function(t) {
    var e = this, n = e.axis, a = e.config, i = e.scale, r = i.x, o = i.zoom, s = a.zoom_enabled && o ? o : r, l = e.getBaseValue(t);
    return n.isTimeSeries() ? l = jt.call(e, l) : n.isCategorized() && lt(l) && (l = a.axis_x_categories.indexOf(l)), s(l);
  },
  yv: function(t) {
    var e = this, n = e.scale, a = n.y, i = n.y2, r = t.axis && t.axis === "y2" ? i : a;
    return r(e.getBaseValue(t));
  },
  subxx: function(t) {
    return t ? this.scale.subX(t.x) : null;
  }
}, t_ = {
  /**
   * Update container size
   * @private
   */
  setContainerSize: function() {
    var t = this, e = t.state;
    e.current.width = t.getCurrentWidth(), e.current.height = t.getCurrentHeight();
  },
  getCurrentWidth: function() {
    var t = this;
    return t.config.size_width || t.getParentWidth();
  },
  getCurrentHeight: function() {
    var t = this, e = t.config, n = e.size_height || t.getParentHeight();
    return n > 0 ? n : 320 / (t.hasType("gauge") && !e.gauge_fullCircle ? 2 : 1);
  },
  /**
   * Get the parent rect element's size
   * @param {string} key property/attribute name
   * @returns {number}
   * @private
   */
  getParentRectValue: function(t) {
    for (var e = "offset".concat(Nt(t)), n = this.$el.chart.node(), a = 0; a < 30 && n && n.tagName !== "BODY"; ) {
      try {
        a = Mt(n, !0)[t];
      } catch {
        e in n && (a = n[e]);
      }
      n = n.parentNode;
    }
    var i = mt.body[e];
    return a > i && (a = i), a;
  },
  getParentWidth: function() {
    return this.getParentRectValue("width");
  },
  getParentHeight: function() {
    var t = this.$el.chart.style("height"), e = 0;
    return t && (e = /px$/.test(t) ? parseInt(t, 10) : this.getParentRectValue("height")), e;
  },
  getSvgLeft: function(t) {
    var e = this, n = e.config, a = e.state.hasAxis, i = e.$el, r = n.axis_rotated, o = r || !r && !n.axis_y_inner, s = r ? Rt.axisX : Rt.axisY, l = i.main.select(".".concat(s)).node(), c = a && n["axis_".concat(r ? "x" : "y", "_label")], u = 0;
    if (a && (lt(c) || lt(c.text) || /^inner-/.test(c?.position))) {
      var f = i.main.select(".".concat(s, "-label"));
      f.empty() || (u = Mt(f.node()).left);
    }
    var h = l && o ? Mt(l, !t) : { right: 0 }, d = Mt(i.chart.node(), !t).left + u, v = e.hasArcType(), _ = h.right - d - (v ? 0 : e.getCurrentPaddingByDirection("left", t));
    return _ > 0 ? _ : 0;
  },
  updateDimension: function(t) {
    var e, n = this, a = n.config, i = n.state.hasAxis, r = n.$el;
    i && !t && n.axis.x && a.axis_rotated && ((e = n.axis.subX) === null || e === void 0 || e.create(r.axis.subX)), n.updateScales(t), n.updateSvgSize(), n.transformAll(!1);
  },
  updateSvgSize: function() {
    var t = this, e = t.config, n = t.state, a = n.clip, i = n.current, r = n.hasAxis, o = n.width, s = n.height, l = t.$el.svg;
    if (e.resize_auto === "viewBox" ? l.attr("viewBox", "0 0 ".concat(i.width, " ").concat(i.height)) : l.attr("width", i.width).attr("height", i.height), r) {
      var c = l.select(".".concat(al.brush, " .overlay")), u = { width: 0, height: 0 };
      c.size() && (u.width = +c.attr("width"), u.height = +c.attr("height")), l.selectAll(["#".concat(a.id), "#".concat(a.idGrid)]).select("rect").attr("width", o).attr("height", s), l.select("#".concat(a.idXAxis)).select("rect").call(t.setXAxisClipPath.bind(t)), l.select("#".concat(a.idYAxis)).select("rect").call(t.setYAxisClipPath.bind(t)), a.idSubchart && l.select("#".concat(a.idSubchart)).select("rect").attr("width", o).attr("height", u.height);
    }
  },
  /**
   * Get padding by the direction.
   * @param {string} type "top" | "bottom" | "left" | "right"
   * @param {boolean} [withoutRecompute=false] If set true, do not recompute the padding value.
   * @param {boolean} [withXAxisTickTextOverflow=false] If set true, calculate x axis tick text overflow.
   * @returns {number} padding value
   * @private
   */
  getCurrentPaddingByDirection: function(t, e, n) {
    var a;
    e === void 0 && (e = !1), n === void 0 && (n = !1);
    var i = this, r = i.config, o = i.$el, s = i.state.hasAxis, l = r.axis_rotated, c = ((a = r.padding) === null || a === void 0 ? void 0 : a.mode) === "fit", u = q(r["padding_".concat(t)]) ? r["padding_".concat(t)] : void 0, f = s ? {
      top: l ? "y2" : null,
      bottom: l ? "y" : "x",
      left: l ? "x" : "y",
      right: l ? null : "y2"
    }[t] : null, h = /^(left|right)$/.test(t), d = f && r["axis_".concat(f, "_inner")], v = f && r["axis_".concat(f, "_show")], _ = f ? r["axis_".concat(f, "_axes")].length : 0, p = f ? h ? i.getAxisWidthByAxisId(f, e) : i.getHorizontalAxisHeight(f) : 0, g = 20, x = 0;
    !c && h && (p = hp(p));
    var y = s && h && (d || St(u) && !v) ? 0 : c ? (v ? p : 0) + (u ?? 0) : St(u) ? p : u;
    return h && s ? (f && (c || d) && r["axis_".concat(f, "_label")].text && (y += i.axis.getAxisLabelPosition(f).isOuter ? g : 0), t === "right" ? (y += l ? !c && St(u) ? 10 : 2 : !v || d ? c ? 2 : 1 : 0, y += n ? i.axis.getXAxisTickTextY2Overflow(g) : 0) : t === "left" && l && St(u) && (y = r.axis_x_show ? c ? p : Math.max(p, 40) : 1)) : t === "top" ? (o.title && o.title.node() && (y += i.getTitlePadding()), x = l && !d ? _ : 0) : t === "bottom" && s && l && !v && (y += 1), y + p * _ - x;
  },
  getCurrentPadding: function(t) {
    t === void 0 && (t = !1);
    var e = this, n = ["top", "bottom", "left", "right"].map(function(s) {
      return e.getCurrentPaddingByDirection(s, null, t);
    }), a = n[0], i = n[1], r = n[2], o = n[3];
    return { top: a, bottom: i, left: r, right: o };
  },
  /**
   * Get resetted padding values when 'padding=false' option is set
   * https://github.com/naver/billboard.js/issues/2367
   * @param {number|object} v Padding values to be resetted
   * @returns {number|object} Padding value
   * @private
   */
  getResettedPadding: function(t) {
    var e = this, n = e.config, a = q(t), i = a ? 0 : {};
    return n.padding === !1 ? !a && Object.keys(t).forEach(function(r) {
      i[r] = !qt(n.data_labels) && n.data_labels !== !1 && r === "top" ? t[r] : 0;
    }) : i = t, i;
  },
  /**
   * Update size values
   * @param {boolean} isInit If is called at initialization
   * @private
   */
  updateSizes: function(t) {
    var e, n, a, i, r, o = this, s = o.config, l = o.state, c = o.$el.legend, u = s.axis_rotated, f = o.hasArcType() || l.hasFunnel || l.hasTreemap, h = ((e = s.padding) === null || e === void 0 ? void 0 : e.mode) === "fit";
    !t && o.setContainerSize();
    var d = {
      width: c ? o.getLegendWidth() : 0,
      height: c ? o.getLegendHeight() : 0
    };
    !f && s.axis_x_show && s.axis_x_tick_autorotate && o.updateXAxisTickClip();
    var v = {
      right: s.legend_show && l.isLegendRight ? o.getLegendWidth() + (h ? 0 : 20) : 0,
      bottom: !s.legend_show || l.isLegendRight || l.isLegendInset ? 0 : d.height
    }, _ = u || f ? 0 : o.getHorizontalAxisHeight("x"), p = s.subchart_axis_x_show && s.subchart_axis_x_tick_text_show ? _ : 30, g = s.subchart_show && !f ? s.subchart_size_height + p : 0, x = o.hasType("gauge") && s.arc_needle_show && !s.gauge_fullCircle && !s.gauge_label_show ? 10 : 0, y = o.getCurrentPadding(!0);
    if (l.margin = !f && u ? {
      top: y.top,
      right: f ? 0 : y.right + v.right,
      bottom: v.bottom + y.bottom,
      left: g + (f ? 0 : y.left)
    } : {
      top: (h ? 0 : 4) + y.top,
      // for top tick text
      right: f ? 0 : y.right + v.right,
      bottom: x + g + v.bottom + y.bottom,
      left: f ? 0 : y.left
    }, l.margin = o.getResettedPadding(l.margin), l.margin2 = u ? {
      top: l.margin.top,
      right: NaN,
      bottom: 20 + v.bottom,
      left: o.state.rotatedPadding.left
    } : {
      top: l.current.height - g - v.bottom,
      right: NaN,
      bottom: p + v.bottom,
      left: l.margin.left
    }, l.margin3 = {
      top: 0,
      right: NaN,
      bottom: 0,
      left: 0
    }, (n = o.updateSizeForLegend) === null || n === void 0 || n.call(o, d), l.width = l.current.width - l.margin.left - l.margin.right, l.height = l.current.height - l.margin.top - l.margin.bottom, l.width < 0 && (l.width = 0), l.height < 0 && (l.height = 0), l.width2 = u ? l.margin.left - l.rotatedPadding.left - l.rotatedPadding.right : l.width, l.height2 = u ? l.height : l.current.height - l.margin2.top - l.margin2.bottom, l.width2 < 0 && (l.width2 = 0), l.height2 < 0 && (l.height2 = 0), o.hasArcType()) {
      var m = o.hasType("gauge"), T = s.legend_show && l.isLegendRight, b = (a = l.hasRadar && o.cache.get($t.radarTextWidth)) !== null && a !== void 0 ? a : 0;
      l.arcWidth = l.width - (T ? d.width + 10 : 0) - b, l.arcHeight = l.height - (T && !m ? 0 : 10), !((i = s.arc_rangeText_values) === null || i === void 0) && i.length && (m ? (l.arcWidth -= 25, l.arcHeight -= 10, l.margin.left += 10) : (l.arcHeight -= 20, l.margin.top += 10)), m && !s.gauge_fullCircle && (l.arcHeight += l.height - o.getPaddingBottomForGauge()), (r = o.updateRadius) === null || r === void 0 || r.call(o);
    }
    l.isLegendRight && f && (l.margin3.left = l.arcWidth / 2 + l.radiusExpanded * 1.1);
  }
}, e_ = {
  /**
   * Add props color css rule to given selector
   * @param {boolean} withShape Set shpes' prefix class
   * @param {string} selector CSS selector
   * @param {Array} props CSS props list
   * @param {function} propsFn Function to retrieve value or determine for props
   * @returns {function}
   * @private
   */
  setCssRule: function(t, e, n, a) {
    var i = this, r = i.config, o = i.state, s = o.cssRule, l = o.style;
    return r.boost_useCssRule ? function(c) {
      c.each(function(u) {
        var f = a && a?.call(i, u), h = "".concat(t ? ".".concat(At.shapes + i.getTargetSelectorSuffix(u.id)) : "").concat(e);
        e in s && l.sheet.deleteRule(s[h]), i.state.cssRule[h] = _p(l, h, n.filter(Boolean).map(function(d) {
          return lt(f) && d.indexOf(":") === -1 ? "".concat(d, ": ").concat(f) : d || "";
        }));
      });
    } : function() {
    };
  },
  /**
   * Get style prop value
   * @param {function|string} v Value
   * @returns {string|null}
   * @private
   */
  getStylePropValue: function(t) {
    var e = this.config.boost_useCssRule;
    return e ? null : U(t) ? t.bind(this) : t;
  }
};
function n_(t) {
  var e = "middle";
  return t > 0 && t <= 170 ? e = "end" : t > 190 && t <= 360 && (e = "start"), e;
}
function a_(t, e, n, a, i) {
  var r, o = this, s = t.value, l = o.isCandlestickType(t), c = q(s) && s < 0 || l && !(!((r = o.getCandlestickData(t)) === null || r === void 0) && r._isUp), u = e.x, f = e.y, h = 4, d = h * 2;
  return a ? n === "start" ? (u += c ? 0 : d, f += h) : n === "middle" ? (u += d, f -= d) : n === "end" && (c && (u -= d), f += h) : (n === "start" ? (u += h, c && (f += d * 2)) : n === "middle" ? f -= d : n === "end" && (u -= h, c && (f += d * 2)), i && (f += c ? -17 : l ? 13 : 7)), { x: u, y: f };
}
function ko(t, e) {
  var n, a = this.config.data_labels_position, i = t.id, r = t.index, o = t.value;
  return (n = U(a) ? a.bind(this.api)(e, o, i, r, this.$el.text) : (i in a ? a[i] : a)[e]) !== null && n !== void 0 ? n : 0;
}
function i_(t, e, n) {
  var a, i, r = this, o = r.config, s = r.$T, l = o.axis_rotated, c = o.data_labels.border, u = c.padding, f = u === void 0 ? "3 5" : u, h = c.radius, d = h === void 0 ? 10 : h, v = c.stroke, _ = v === void 0 ? "#000" : v, p = c.strokeWidth, g = p === void 0 ? 1 : p, x = c.fill, y = x === void 0 ? "none" : x, m = Tp(f), T = o.data_labels.border !== !0, b = we(t), w = N(t.previousElementSibling);
  (w.empty() || ((a = w.node()) === null || a === void 0 ? void 0 : a.tagName) !== "rect" || !(!((i = w.attr("class")) === null || i === void 0) && i.includes(n))) && (w = N(t.parentNode).insert("rect", function() {
    return t;
  }).attr("class", "".concat(Ct.textBorderRect, " ").concat(n)).attr("width", b.width + (T ? m.left + m.right : 0)).attr("height", b.height + (T ? m.top + m.bottom : 0)), T && w.style("fill", y).style("stroke", _).style("stroke-width", "".concat(g, "px")).attr("rx", d).attr("ry", d)), s(w).attr("x", e.x - (T ? m.left : 0) - (l ? 0 : b.width / 2)).attr("y", e.y - (T ? m.top : 0) - b.height / 4 * 3.2);
}
function vr(t, e) {
  t === void 0 && (t = 0);
  var n = this, a = n.config, i = a["".concat(e, "_label_threshold")] || 0;
  return t >= i;
}
function $l() {
  var t = this, e = t.$el.text, n = t.config, a = t.state.arcWidth;
  (a ? t.getArcLabelConfig("image") : n.data_labels.image) && e.filter(function() {
    var i = this.previousElementSibling;
    return i ? i.tagName !== "image" || !i.classList.contains(Ct.textLabelImage) : !0;
  }).each(function(i) {
    var r, o, s, l, c = r_.call(t, i), u = c.url, f = c.width, h = c.height, d = c.pos;
    if (u) {
      var v = N(this.parentNode);
      v?.insert("image", "".concat((o = (r = this.getAttribute("class")) === null || r === void 0 ? void 0 : r.replace(/(?:^(.)|\s)/g, ".$1")) !== null && o !== void 0 ? o : "text")).style("opacity", "0").attr("href", function(_) {
        return zn(u, {
          ID: "id" in _ ? _.id : _.data.id
        });
      }).attr("class", Ct.textLabelImage).style("pointer-events", "none").attr("width", f).attr("height", h).attr("transform", d ? "translate(".concat((s = d.x) !== null && s !== void 0 ? s : 0, " ").concat((l = d.y) !== null && l !== void 0 ? l : 0, ")") : null);
    }
  });
}
function r_(t) {
  var e, n = this, a = n.config, i = n.state, r = i.arcWidth ? n.getArcLabelConfig("image") : a.data_labels.image;
  if (U(r))
    return (e = r.call(n.api, t.value, t.id, t.index)) !== null && e !== void 0 ? e : {
      url: "",
      width: 0,
      height: 0,
      pos: { x: 0, y: 0 }
    };
  if (r) {
    var o = r.url, s = o === void 0 ? "" : o, l = r.width, c = l === void 0 ? 0 : l, u = r.height, f = u === void 0 ? 0 : u, h = r.pos;
    return {
      url: s,
      width: c,
      height: f,
      pos: h
    };
  }
  return null;
}
function wl(t, e) {
  var n = this, a, i = this, r = i.config, o = i.state, s = o.arcWidth, l = o.hasTreemap, c = r.axis_rotated, u = N(t.previousElementSibling), f = function(g) {
    var x, y = g.style.opacity !== "0" && g.style.fillOpacity !== "0";
    return (s ? g.textContent : y) && ((x = n.previousElementSibling) === null || x === void 0 ? void 0 : x.tagName) !== "image";
  };
  if (!u.empty() && ((a = u.node()) === null || a === void 0 ? void 0 : a.tagName) === "image") {
    var h = Mt(t), d = +u.attr("width") / 2, v = +u.attr("height") / 2, _ = e.x - d, p = e.y - v - h.height / 2;
    c ? e.x += d : (l && (_ = -d, p = -(v * 2 + h.height)), i.hasType("pie") || i.hasType("polar") || (e.y += v)), i.$T(u).style("opacity", f(t) ? null : "0").attr("x", _).attr("y", p);
  }
}
function o_(t) {
  return xl(t, function(e) {
    return e;
  }, function(e) {
    return we(e);
  });
}
var s_ = {
  opacityForText: function(t) {
    var e = this;
    return e.isBarType(t) && !vr.call(e, Math.abs(e.getRatio("bar", t)), "bar") ? "0" : e.hasDataLabel ? null : "0";
  },
  /**
   * Initializes the text
   * @private
   */
  initText: function() {
    var t = this.$el;
    t.main.select(".".concat(j.chart)).append("g").attr("class", Ct.chartTexts).style("pointer-events", t.funnel || t.treemap ? "none" : null);
  },
  /**
   * Update chartText
   * @param {object} targets $$.data.targets
   * @private
   */
  updateTargetsForText: function(t) {
    var e = this, n = e.getChartClass("Text"), a = e.getClass("texts", "id"), i = e.classFocus.bind(e), r = e.$el.main.select(".".concat(Ct.chartTexts)).selectAll(".".concat(Ct.chartText)).data(e.filterNullish(t)).attr("class", function(s) {
      return "".concat(n(s)).concat(i(s)).trim();
    }), o = r.enter().append("g").style("opacity", "0").attr("class", n).call(e.setCssRule(!0, " .".concat(Ct.text), ["fill", "pointer-events:none"], e.updateTextColor));
    o.append("g").attr("class", a);
  },
  /**
   * Update text
   * @private
   */
  updateText: function() {
    var t = this, e = t.$el, n = t.$T, a = t.config, i = t.axis, r = t.getClass("text", "index"), o = a.data_labels.centered, s = e.main.selectAll(".".concat(Ct.texts)).selectAll(".".concat(Ct.text)).data(t.labelishData.bind(t));
    n(s.exit()).style("fill-opacity", "0").remove(), e.text = s.enter().append("text").merge(s).attr("class", r).attr("text-anchor", function(l) {
      var c = a["axis_".concat(i?.getId(l.id), "_inverted")], u = c ? l.value > 0 : l.value < 0;
      if (t.isCandlestickType(l)) {
        var f = t.getCandlestickData(l);
        u = !f?._isUp;
      } else if (t.isTreemapType(l))
        return o ? "middle" : "start";
      return a.axis_rotated ? u ? "end" : "start" : "middle";
    }).style("fill", t.getStylePropValue(t.updateTextColor)).style("fill-opacity", "0").each(function(l, c, u) {
      var f = N(this), h = l.value;
      if (t.isBubbleZType(l))
        h = t.getBubbleZData(h, "z");
      else if (t.isCandlestickType(l)) {
        var d = t.getCandlestickData(l);
        d && (h = d.close);
      }
      h = t.isTreemapType(l) ? t.treemapDataLabelFormat(l)(f) : t.dataLabelFormat(l.id)(h, l.id, l.index, u), q(h) ? this.textContent = h : an(f, h, void 0, !0);
    }), $l.call(t);
  },
  updateTextColor: function(t) {
    var e = this, n = e.config, a = n.data_labels_colors, i = e.isArcType(t) && !e.isRadarType(t) || e.isFunnelType(t) || e.isTreemapType(t) ? null : e.color(t), r;
    if (lt(a))
      r = a;
    else if (ct(a)) {
      var o = (t.data || t).id;
      r = a[o];
    } else U(a) && (r = a.bind(e.api)(i, t));
    if (e.isCandlestickType(t) && !U(a)) {
      var s = e.getCandlestickData(t);
      if (!s?._isUp) {
        var l = n.candlestick_color_down;
        r = ct(l) ? l[t.id] : l;
      }
    }
    return r || i;
  },
  /**
   * Update data label text background color
   * @param {object} d Data object
   * @param {object|string|function} option option object
   * @returns {string|null}
   * @private
   */
  updateTextBGColor: function(t, e) {
    var n = this, a = n.$el.defs, i = "";
    if (e) {
      var r = lt(e) ? "" : n.getTargetSelectorSuffix("id" in t ? t.id : t.data.id), o = a.select(["filter[id*='labels-bg", "']"].join(r));
      if (o.size() && (i = "url(#".concat(o.attr("id"), ")")), U(e)) {
        n.generateTextBGColorFilter(e);
        var s = n.color(t), l = e.bind(n.api)(s, t);
        l ? o.select("feFlood").attr("flood-color", l) : i = "";
      }
    }
    return i || null;
  },
  /**
   * Redraw chartText
   * @param {function} getX Positioning function for x
   * @param {function} getY Positioning function for y
   * @param {boolean} forFlow Weather is flow
   * @param {boolean} withTransition transition is enabled
   * @returns {Array}
   * @private
   */
  redrawText: function(t, e, n, a) {
    var i = this, r = i.$T, o = i.axis, s = i.config, l = i.state.hasTreemap, c = re(!0), u = s.axis_rotated, f = s.data_labels.rotate, h = n_(f), d = f ? "rotate(".concat(f, ")") : "", v = /* @__PURE__ */ new Map();
    if (s.data_labels.centered) {
      var _ = [];
      i.$el.text.each(function(p) {
        (i.isBarType(p) || i.isTreemapType(p)) && _.push(this);
      }), _.length > 0 && (v = o_(_));
    }
    return i.$el.text.style("fill", i.getStylePropValue(i.updateTextColor)).attr("filter", function(p) {
      return i.updateTextBGColor.bind(i)(p, s.data_labels_backgroundColors);
    }).style("fill-opacity", n ? 0 : i.opacityForText.bind(i)).each(function(p, g) {
      var x = v.get(this), y = r(l && this.childElementCount ? this.parentNode : this, !!(a && (this.getAttribute("x") || this.getAttribute("transform"))), c), m = s["axis_".concat(o?.getId(p.id), "_inverted")], T = {
        x: t.bind(this)(p, g, x),
        y: e.bind(this)(p, g, x)
      };
      f && (T = a_.bind(i)(p, T, h, u, m), y.attr("text-anchor", h)), wl.call(i, this, T), this.childElementCount || f ? y.attr("transform", "translate(".concat(T.x, " ").concat(T.y, ") ").concat(d)) : y.attr("x", T.x).attr("y", T.y), s.data_labels.border && i_.call(i, y.node(), T, "".concat(Ct.textBorderRect, "-").concat(g));
    }), !0;
  },
  /**
   * Gets the getBoundingClientRect value of the element
   * @param {HTMLElement|d3.selection|Array} source Target element
   * @param {string} className Class name
   * @returns {object} value of element.getBoundingClientRect()
   * @private
   */
  getTextRect: function(t, e) {
    var n, a, i, r = this, o, s, l;
    Array.isArray(t) ? o = "".concat($t.textRect, "-").concat(t.join("_")) : (s = (i = (a = (n = t).node) === null || a === void 0 ? void 0 : a.call(n)) !== null && i !== void 0 ? i : t, /text/i.test(s.tagName) || (s = s.querySelector("text")), l = s.textContent, o = "".concat($t.textRect, "-").concat(l.replace(/\W/g, "_")));
    var c = r.cache.get(o) || [];
    return c.length === 0 && ((r.$el.svg || r.$el.chart.select("svg")).selectAll(".".concat(j.dummy)).data(l ? [l] : t).enter().append("text").style("visibility", "hidden").style("font", s ? N(s).style("font") : null).classed(e || j.dummy, !0).text(function(u) {
      return u;
    }).each(function(u, f) {
      c[f] = Mt(this);
    }).remove(), r.cache.add(o, c)), c.length > 1 ? c : c[0];
  },
  /**
   * Gets the x or y coordinate of the text
   * @param {object} indices Indices values
   * @param {boolean} forX whether or not to x
   * @returns {number} coordinates
   * @private
   */
  generateXYForText: function(t, e) {
    var n = this, a = n.state, i = a.hasRadar, r = a.hasFunnel, o = a.hasTreemap, s = Object.keys(t), l = {}, c = e ? n.getXForText : n.getYForText;
    return r && s.push("funnel"), i && s.push("radar"), o && s.push("treemap"), s.forEach(function(u) {
      l[u] = n["generateGet".concat(Nt(u), "Points")](t[u], !1);
    }), function(u, f) {
      var h = n.isAreaType(u) && "area" || n.isBarType(u) && "bar" || n.isCandlestickType(u) && "candlestick" || n.isFunnelType(u) && "funnel" || n.isRadarType(u) && "radar" || n.isTreemapType(u) && "treemap" || "line";
      return c.call(n, l[h](u, f), u, this);
    };
  },
  /**
   * Get centerized text position for bar type data.label.text
   * @param {object} d Data object
   * @param {Array} points Data points position
   * @param {HTMLElement} textElement Data label text element
   * @param {string} type 'x' or 'y'
   * @param {DOMRect} cachedBbox Optional cached bounding box (from getBBox batching)
   * @returns {number} Position value
   * @private
   */
  getCenteredTextPos: function(t, e, n, a, i) {
    var r = this, o = r.config, s = o.axis_rotated, l = r.isBarType(t), c = r.isTreemapType(t);
    if (o.data_labels.centered && (l || c)) {
      var u = i || we(n);
      if (l) {
        var f = r.getRangedData(t, null, "bar") >= 0;
        if (s) {
          var h = (f ? e[1][1] - e[0][1] : e[0][1] - e[1][1]) / 2 + u.width / 2;
          return f ? -h - 3 : h + 2;
        } else {
          var d = (f ? e[0][1] - e[1][1] : e[1][1] - e[0][1]) / 2 + u.height / 2;
          return f ? d : -d - 2;
        }
      } else if (c)
        return a === "x" ? (e[1][0] - e[0][0]) / 2 : (
          // X: Move to horizontal center of rect
          (e[1][1] - e[0][1]) / 2 - u.y - u.height / 2
        );
    }
    return 0;
  },
  /**
   * Gets the x coordinate of the text
   * @param {object} points Data points position
   * @param {object} d Data object
   * @param {HTMLElement} textElement Data label text element
   * @param {DOMRect} cachedBbox Optional cached bounding box (from getBBox batching)
   * @returns {number} x coordinate
   * @private
   */
  getXForText: function(t, e, n, a) {
    var i, r = this, o = r.config, s = o.axis_rotated, l = r.isFunnelType(e), c = r.isTreemapType(e), u = t ? t[0][0] : 0;
    if (r.isCandlestickType(e))
      s ? u = !((i = r.getCandlestickData(e)) === null || i === void 0) && i._isUp ? t[2][2] + 4 : t[2][1] - 4 : u += (t[1][0] - u) / 2;
    else if (l)
      u += r.state.current.width / 2;
    else if (c)
      u += o.data_labels.centered ? 0 : 5;
    else if (s) {
      var f = o["axis_".concat(r.axis.getId(e.id), "_inverted")], h = r.isBarType(e) ? 4 : 6, d = e.value;
      u = t[2][1], f ? u -= h * (d > 0 ? 1 : -1) : u += h * (d < 0 ? -1 : 1);
    } else
      u = r.hasType("bar") ? (t[2][0] + t[0][0]) / 2 : u;
    return (s || c) && (u += r.getCenteredTextPos(e, t, n, "x", a)), u + ko.call(this, e, "x");
  },
  /**
   * Gets the y coordinate of the text
   * @param {object} points Data points position
   * @param {object} d Data object
   * @param {HTMLElement} textElement Data label text element
   * @param {DOMRect} cachedBbox Optional cached bounding box (from getBBox batching)
   * @returns {number} y coordinate
   * @private
   */
  getYForText: function(t, e, n, a) {
    var i = this, r = i.axis, o = i.config, s = i.state, l = o.axis_rotated, c = o["axis_".concat(r?.getId(e.id), "_inverted")], u = i.isBarType(e), f = i.isFunnelType(e), h = i.isTreemapType(e), d = o.point_r, v = Mt(n), _ = e.value, p = 3, g;
    if (i.isCandlestickType(e))
      _ = i.getCandlestickData(e), l ? (g = t[0][0], g += (t[1][0] - g) / 2 + p) : (g = _ && _._isUp ? t[2][2] - p : t[2][1] + p * 4, c && (g += 15 * (_._isUp ? 1 : -1)));
    else if (f)
      g = t ? t[0][1] + (t[1][1] - t[0][1]) / 2 + v.height / 2 - 3 : 0;
    else if (h)
      g = t[0][1] + (o.data_labels.centered ? 0 : v.height + 5);
    else if (l)
      g = (t[0][0] + t[2][0] + v.height * 0.6) / 2;
    else if (g = t[2][1], q(d) && d > 5 && (i.isLineType(e) || i.isScatterType(e)) && (p += o.point_r / 2.3), _ < 0 || _ === 0 && !s.hasPositiveValue && s.hasNegativeValue)
      g += c ? u ? -3 : -5 : v.height + (u ? -p : p);
    else {
      var x = -p * 2;
      u ? x = -p : i.isBubbleType(e) && (x = p), c && (x = u ? 10 : 15), g += x;
    }
    return (!l || h) && (g += i.getCenteredTextPos(e, t, n, "y", a)), g + ko.call(this, e, "y");
  },
  /**
   * Calculate if two or more text nodes are overlapping
   * Mark overlapping text nodes with "text-overlapping" class
   * @param {string} id Axis id
   * @param {ChartInternal} $$ ChartInternal context
   * @param {string} selector Selector string
   * @private
   */
  markOverlapped: function(t, e, n) {
    var a = e.$el.arcs.selectAll(n), i = a.filter(function(l) {
      return l.data.id !== t;
    }), r = a.filter(function(l) {
      return l.data.id === t;
    }), o = To(r.node()), s = function(l, c) {
      return Math.sqrt(Math.pow(l, 2) + Math.pow(c, 2));
    };
    r.node() && i.each(function() {
      var l = To(this), c = N(this), u = s(o.e, o.f) > s(l.e, l.f) ? r : c, f = Math.ceil(Math.abs(o.e - l.e)) < Math.ceil(u.node().getComputedTextLength()), h = Math.ceil(Math.abs(o.f - l.f)) < parseInt(r.style("font-size"), 10);
      c.classed(Ct.TextOverlapping, f && h);
    });
  },
  /**
   * Calculate if two or more text nodes are overlapping
   * Remove "text-overlapping" class on selected text nodes
   * @param {ChartInternal} $$ ChartInternal context
   * @param {string} selector Selector string
   * @private
   */
  undoMarkOverlapped: function(t, e) {
    t.$el.arcs.selectAll(e).each(function() {
      ns([this, this.previousSibling]).classed(Ct.TextOverlapping, !1);
    });
  }
};
function Co(t, e) {
  t === void 0 && (t = "left");
  var n = q(e), a;
  return t.indexOf("center") > -1 ? a = n ? e / 2 : "middle" : t.indexOf("right") > -1 ? a = n ? e : "end" : a = n ? 0 : "start", a;
}
var l_ = {
  /**
   * Initializes the title
   * @private
   */
  initTitle: function() {
    var t = this, e = t.config, n = t.$el;
    if (e.title_text) {
      n.title = n.svg.append("g");
      var a = n.title.append("text").style("text-anchor", Co(e.title_position)).attr("class", Ct.title);
      an(a, e.title_text, [0.3, 1.5]);
    }
  },
  /**
   * Redraw title
   * @private
   */
  redrawTitle: function() {
    var t = this, e = t.config, n = t.state.current, a = t.$el.title;
    if (a) {
      var i = Co(e.title_position, n.width), r = (e.title_padding.top || 0) + t.getTextRect(t.$el.title, Ct.title).height;
      a.attr("transform", "translate(".concat(i, ", ").concat(r, ")"));
    }
  },
  /**
   * Get title padding
   * @returns {number} padding value
   * @private
   */
  getTitlePadding: function() {
    var t = this, e = t.$el.title, n = t.config;
    return (n.title_padding.top || 0) + (e ? t.getTextRect(e, Ct.title).height : 0) + (n.title_padding.bottom || 0);
  }
}, c_ = {
  /**
   * Initializes the tooltip
   * @private
   */
  initTooltip: function() {
    var t = this, e = t.config, n = t.$el;
    n.tooltip = N(e.tooltip_contents.bindto), n.tooltip.empty() && (n.tooltip = n.chart.append("div").attr("class", aa.tooltipContainer).style("position", "absolute").style("pointer-events", "none").style("display", "none")), t.bindTooltipResizePos();
  },
  /**
   * Show tooltip at initialization.
   * Is called only when tooltip.init.show=true option is set
   * @private
   */
  initShowTooltip: function() {
    var t, e, n = this, a = n.config, i = n.$el, r = n.state, o = r.hasAxis, s = r.hasRadar;
    if (a.tooltip_init_show) {
      var l = !(o || s);
      !((e = n.axis) === null || e === void 0) && e.isTimeSeries() && lt(a.tooltip_init_x) && (a.tooltip_init_x = jt.call(n, a.tooltip_init_x)), n.api.tooltip.show({
        data: (t = {}, t[l ? "index" : "x"] = a.tooltip_init_x, t)
      });
      var c = a.tooltip_init_position;
      if (!a.tooltip_contents.bindto && !qt(c)) {
        var u = c.top, f = u === void 0 ? 0 : u, h = c.left, d = h === void 0 ? 50 : h;
        i.tooltip.style("top", lt(f) ? f : "".concat(f, "px")).style("left", lt(d) ? d : "".concat(d, "px")).style("display", null);
      }
    }
  },
  /**
   * Get the tooltip HTML string
   * @param  {Array} args Arguments
   * @returns {string} Formatted HTML string
   * @private
   */
  getTooltipHTML: function() {
    for (var t = [], e = 0; e < arguments.length; e++)
      t[e] = arguments[e];
    var n = this, a = n.api, i = n.config;
    return nn(U(i.tooltip_contents) ? i.tooltip_contents.bind(a).apply(void 0, t) : n.getTooltipContent.apply(n, t));
  },
  /**
   * Returns the tooltip content(HTML string)
   * @param {object} d data
   * @param {function} defaultTitleFormat Default title format
   * @param {function} defaultValueFormat Default format for each data value in the tooltip.
   * @param {function} color Color function
   * @returns {string} html
   * @private
   */
  getTooltipContent: function(t, e, n, a) {
    var i, r = this, o = r.api, s = r.config, l = r.state, c = r.$el, u = ["title", "name", "value"].map(function(R) {
      var z = s["tooltip_format_".concat(R)];
      return U(z) ? z.bind(o) : z;
    }), f = u[0], h = u[1], d = u[2], v = function() {
      for (var R = [], z = 0; z < arguments.length; z++)
        R[z] = arguments[z];
      return (f || e).apply(void 0, R);
    }, _ = function() {
      for (var R = [], z = 0; z < arguments.length; z++)
        R[z] = arguments[z];
      return (h || (function(P) {
        return P;
      })).apply(void 0, R);
    }, p = function(R, z, P, O) {
      var X = d;
      return X || (l.hasTreemap || r.isStackNormalized() && (!r.isStackNormalizedPerGroup() || r.isGrouped(P)) ? X = function(G, ht) {
        return "".concat((ht * 100).toFixed(2), "%");
      } : X = n), X(R, z, P, O);
    }, g = s.tooltip_order, x = function(R) {
      return r.axis && r.isBubbleZType(R) ? r.getBubbleZData(R.value, "z") : r.getBaseValue(R);
    }, y = r.levelColor ? function(R) {
      return r.levelColor(R.value);
    } : function(R) {
      return a(R);
    }, m = s.tooltip_contents, T = m.template, b = r.mapToTargetIds();
    if (g === null && s.data_groups.length) {
      var w = r.orderTargets(r.data.targets).map(function(R) {
        return R.id;
      }).reverse();
      t.sort(function(R, z) {
        var P = R ? R.value : null, O = z ? z.value : null;
        return P > 0 && O > 0 && (P = R.id ? w.indexOf(R.id) : null, O = z.id ? w.indexOf(z.id) : null), P - O;
      });
    } else if (/^(asc|desc)$/.test(g)) {
      var A = g === "asc";
      t.sort(function(R, z) {
        var P = R ? x(R) : null, O = z ? x(z) : null;
        return A ? P - O : O - P;
      });
    } else U(g) && t.sort(g.bind(o));
    var k = r.getTooltipContentTemplate(T), C = t.length, E, M, L, $, D, S = function() {
      if (M = t[D], !M || !(x(M) || x(M) === 0))
        return "continue";
      if (St(E)) {
        var R = (l.hasAxis || l.hasRadar) && v(M.x);
        E = zn(k[0], {
          CLASS_TOOLTIP: aa.tooltip,
          TITLE: nt(R) ? T ? R : '<tr><th colspan="2">'.concat(R, "</th></tr>") : ""
        });
      }
      if (!M.ratio && c.arcs && (L = ["arc", r.$el.arcs.select("path.".concat(at.arc, "-").concat(M.id)).data()[0]], M.ratio = r.getRatio.apply(r, L)), L = [M.ratio, M.id, M.index], r.isAreaRangeType(M)) {
        var z = ["high", "low"].map(function(ot) {
          return p.apply(void 0, wt([r.getRangedData(M, ot)], L, !1));
        }), P = z[0], O = z[1], X = p.apply(void 0, wt([x(M)], L, !1));
        $ = "<b>Mid:</b> ".concat(X, " <b>High:</b> ").concat(P, " <b>Low:</b> ").concat(O);
      } else if (r.isCandlestickType(M)) {
        var G = ["open", "high", "low", "close", "volume"].map(function(yt) {
          var bt = r.getRangedData(M, yt, "candlestick");
          return bt ? p.apply(void 0, wt([r.getRangedData(M, yt, "candlestick")], L, !1)) : void 0;
        }), ht = G[0], P = G[1], O = G[2], et = G[3], Q = G[4];
        $ = "<b>Open:</b> ".concat(ht, " <b>High:</b> ").concat(P, " <b>Low:</b> ").concat(O, " <b>Close:</b> ").concat(et).concat(Q ? " <b>Volume:</b> ".concat(Q) : "");
      } else if (r.isBarRangeType(M)) {
        var B = M.value, W = M.id, J = M.index;
        $ = "".concat(p(B, void 0, W, J));
      } else
        $ = p.apply(void 0, wt([x(M)], L, !1));
      if ($ !== void 0) {
        if (M.name === null)
          return "continue";
        var F = _.apply(void 0, wt([(i = M.name) !== null && i !== void 0 ? i : M.id], L, !1)), V = y(M), Z = {
          CLASS_TOOLTIP_NAME: aa.tooltipName + r.getTargetSelectorSuffix(M.id),
          COLOR: T || !r.patterns ? V : '<svg><rect style="fill:'.concat(V, '" width="10" height="10"></rect></svg>'),
          NAME: F,
          VALUE: $
        };
        if (T && ct(m.text)) {
          var I = b.indexOf(M.id);
          Object.keys(m.text).forEach(function(ot) {
            Z[ot] = m.text[ot][I];
          });
        }
        E += zn(k[1], Z);
      }
    };
    for (D = 0; D < C; D++)
      S();
    return "".concat(E, "</table>");
  },
  /**
   * Get the content template string
   * @param {string} tplStr Tempalte string
   * @returns {Array} Template string
   * @private
   */
  getTooltipContentTemplate: function(t) {
    return (t || `<table class="{=CLASS_TOOLTIP}"><tbody>
				{=TITLE}
				{{<tr class="{=CLASS_TOOLTIP_NAME}">
					<td class="name">`.concat(this.patterns ? "{=COLOR}" : '<span style="background-color:{=COLOR}"></span>', `{=NAME}</td>
					<td class="value">{=VALUE}</td>
				</tr>}}
			</tbody></table>`)).replace(/(\r?\n|\t)/g, "").split(/{{(.*)}}/);
  },
  /**
   * Update tooltip position coordinate
   * @param {object} dataToShow Data object
   * @param {SVGElement} eventTarget Event element
   * @private
   */
  setTooltipPosition: function(t, e) {
    var n, a, i = this, r = i.config, o = i.scale, s = i.state, l = i.$el, c = l.eventRect, u = l.tooltip, f = l.svg, h = r.tooltip_contents.bindto, d = r.axis_rotated, v = u?.datum();
    if (!h && v) {
      var _ = t ?? JSON.parse(v.current), p = Zt(s.event, e ?? c?.node()), g = p[0], x = p[1], y = { x: g, y: x };
      if (s.hasAxis && o.x && v && "x" in v) {
        var m = function(C, E, M) {
          var L;
          C === void 0 && (C = 0), M === void 0 && (M = "y");
          var $ = o[E ? (L = i.axis) === null || L === void 0 ? void 0 : L.getId(E) : M];
          return $ ? $(C) + (d ? s.margin.left : s.margin.top) : 0;
        };
        y.xAxis = o.x(v.x) + // add margin only when user specified tooltip.position function
        (r.tooltip_position ? d ? s.margin.top : s.margin.left : 0), _.length === 1 ? y.yAxis = m(_[0].value, _[0].id) : y.yAxis = m;
      }
      var T = v.width, b = T === void 0 ? 0 : T, w = v.height, A = w === void 0 ? 0 : w, k = (a = (n = r.tooltip_position) === null || n === void 0 ? void 0 : n.bind(i.api)(_, b, A, c?.node(), y)) !== null && a !== void 0 ? a : dr(f) ? i.getTooltipPositionViewBox.bind(i)(b, A, y) : i.getTooltipPosition.bind(i)(b, A, y);
      ["top", "left"].forEach(function(C) {
        var E = k[C];
        u.style(C, "".concat(E, "px")), C === "left" && !v.xPosInPercent && (v.xPosInPercent = E / s.current.width * 100);
      });
    }
  },
  /**
   * Get tooltip position when svg has vieBox attribute
   * @param {number} tWidth Tooltip width value
   * @param {number} tHeight Tooltip height value
   * @param {object} currPos Current event position value from SVG coordinate
   * @returns {object} top, left value
   */
  getTooltipPositionViewBox: function(t, e, n) {
    var a, i, r = this, o = r.$el, s = o.eventRect, l = o.svg, c = r.config, u = r.state, f = c.axis_rotated, h = r.hasArcType() || u.hasFunnel || u.hasTreemap, d = (i = (a = h ? l : s) === null || a === void 0 ? void 0 : a.node()) !== null && i !== void 0 ? i : u.event.target, v = n.x, _ = n.y;
    u.hasAxis && (v = f ? v : n.xAxis, _ = f ? n.xAxis : _);
    var p = Aa(d, v, _, !1), g = Mt(d), x = Aa(d, 20, 0, !1).x, y = p.y, m = p.x + t / 2 + x;
    return h && (u.hasFunnel || u.hasTreemap || u.hasRadar ? (m -= t / 2 + x, y += e) : (y += g.height / 2, m += g.width / 2 - (t - x))), m + t > g.width && (m = g.width - t - x), y + e > g.height && (y -= e * 2), {
      top: y,
      left: m
    };
  },
  /**
   * Returns the position of the tooltip
   * @param {string} tWidth Width value of tooltip element
   * @param {string} tHeight Height value of tooltip element
   * @param {object} currPos Current mouse position
   * @returns {object} top, left value
   * @private
   */
  getTooltipPosition: function(t, e, n) {
    var a, i, r, o = this, s = o.config, l = o.scale, c = o.state, u = c.width, f = c.height, h = c.current, d = c.hasFunnel, v = c.hasRadar, _ = c.hasTreemap, p = c.isLegendRight, g = c.inputType, x = o.hasType("gauge") && !s.gauge_fullCircle, y = s.axis_rotated, m = o.hasArcType(), T = o.getSvgLeft(!0), b = T + h.width - o.getCurrentPaddingByDirection("right"), w = 20, A = n.x, k = n.y;
    if (v)
      A += A >= u / 2 ? 15 : -(t + 15), k += 15;
    else if (m) {
      var C = g !== "touch";
      if (C) {
        var E = (i = (a = o.getTitlePadding) === null || a === void 0 ? void 0 : a.call(o)) !== null && i !== void 0 ? i : 0;
        E && x && (!((r = s.arc_rangeText_values) === null || r === void 0) && r.length) && (E += 10), A += (u - (p ? o.getLegendWidth() : 0)) / 2, k += (x ? f : f / 2 + e) + E;
      }
    } else if (d || _)
      k += e;
    else {
      var M = {
        top: o.getCurrentPaddingByDirection("top", !0),
        left: o.getCurrentPaddingByDirection("left", !0)
      };
      y ? (A += T + M.left + w, k = M.top + n.xAxis + w, b -= T) : (A = T + M.left + w + (l.zoom ? A : n.xAxis), k += M.top - 5);
    }
    if (A + t + 15 > b && (A -= t + (d || _ || m ? 0 : y ? w * 2 : 38)), k + e > h.height) {
      var L = _ ? e + 10 : 30;
      k -= x ? e * 1.5 : e + L;
    }
    var $ = { top: k, left: A };
    return Object.keys($).forEach(function(D) {
      $[D] < 0 && ($[D] = 0);
    }), $;
  },
  /**
   * Show the tooltip
   * @param {object} selectedData Data object
   * @param {SVGElement} eventTarget Event element
   * @private
   */
  showTooltip: function(t, e) {
    var n = this, a = n.config, i = n.$el.tooltip, r = t.filter(function(f) {
      return f && nt(n.getBaseValue(f));
    });
    if (!(!i || r.length === 0 || !a.tooltip_show)) {
      var o = i.datum(), s = JSON.stringify(t);
      if (!o || o.current !== s) {
        var l = t.concat().sort()[0], c = l.index, u = l.x;
        pt(a.tooltip_onshow, n.api, t), i.html(n.getTooltipHTML(
          t,
          // data
          n.axis ? n.axis.getXAxisTickFormat() : n.categoryName.bind(n),
          // defaultTitleFormat
          n.getDefaultValueFormat(),
          // defaultValueFormat
          n.color
          // color
        )).style("display", null).style("visibility", null).datum(o = {
          index: c,
          x: u,
          current: s,
          width: i.property("offsetWidth"),
          height: i.property("offsetHeight")
        }), pt(a.tooltip_onshown, n.api, t), n._handleLinkedCharts(!0, c);
      }
      n.setTooltipPosition(r, e);
    }
  },
  /**
   * Adjust tooltip position on resize event
   * @private
   */
  bindTooltipResizePos: function() {
    var t = this, e = t.resizeFunction, n = t.state, a = t.$el.tooltip;
    e.add(function() {
      if (a.style("display") === "block") {
        var i = n.current, r = a.datum(), o = r.width, s = r.xPosInPercent, l = i.width / 100 * s, c = i.width - (l + o);
        c < 0 && (l += c), a.style("left", "".concat(l, "px"));
      }
    });
  },
  /**
   * Hide the tooltip
   * @param {boolean} force Force to hide
   * @private
   */
  hideTooltip: function(t) {
    var e, n = this, a = n.api, i = n.config, r = n.$el.tooltip;
    if (r && r.style("display") !== "none" && (!i.tooltip_doNotHide || t)) {
      var o = JSON.parse((e = r.datum().current) !== null && e !== void 0 ? e : {});
      pt(i.tooltip_onhide, a, o), r.style("display", "none").datum(null), pt(i.tooltip_onhidden, a, o);
    }
  },
  /**
   * Toggle display for linked chart instances
   * @param {boolean} show true: show, false: hide
   * @param {number} index x Axis index
   * @private
   */
  _handleLinkedCharts: function(t, e) {
    var n = this, a = n.charts, i = n.config, r = n.state.event;
    if (r?.isTrusted && i.tooltip_linked && a.length > 1) {
      var o = i.tooltip_linked_name;
      a.filter(function(s) {
        return s !== n.api;
      }).forEach(function(s) {
        var l = s.internal, c = l.config, u = l.$el, f = c.tooltip_linked, h = c.tooltip_linked_name, d = mt.body.contains(u.chart.node());
        if (f && o === h && d) {
          var v = u.tooltip.data()[0], _ = e !== v?.index;
          try {
            s.tooltip[t && _ ? "show" : "hide"]({ index: e });
          } catch {
          }
        }
      });
    }
  },
  /**
   * Update tooltip content on redraw
   * - In a situation where tooltip is displayed and data load happens, it should reflect loaded data to tooltip
   * @param {d3Selection} context Event rect element
   * @param {number} index Data index
   * @private
   */
  updateTooltipOnRedraw: function(t, e) {
    var n, a = this, i = a.config, r = a.$el, o = r.eventRect, s = r.svg, l = r.tooltip, c = a.state, u = c.event, f = c.hasAxis, h = c.hasRadar, d = c.hasTreemap;
    if (l?.style("display") === "block" && u) {
      var v = t ?? ((n = h ? s : o) === null || n === void 0 ? void 0 : n.node());
      if (f || h)
        if (a.isMultipleX())
          a.selectRectForMultipleXs(v, !1);
        else {
          var _ = e ?? a.getDataIndexFromEvent(u);
          e === -1 ? a.api.tooltip.hide() : (a.selectRectForSingle(v, _), a.setExpand(_, null, !0));
        }
      else {
        var p = u.clientX, g = u.clientY;
        setTimeout(function() {
          var x = [p, g].every(Number.isFinite) && mt.elementFromPoint(p, g), y = x && N(x).datum();
          if (y) {
            var m = a.hasArcType() ? a.convertToArcData(a.updateAngle(y)) : y?.data;
            d && (x = s.node()), m && a.showTooltip([m], x);
          } else
            a.api.tooltip.hide();
        }, i.transition_duration);
      }
    }
  }
}, u_ = {
  getTranslate: function(t, e) {
    var n;
    e === void 0 && (e = 0);
    var a = this, i = a.config, r = a.state, o = i.axis_rotated, s = 0, l, c;
    if (e && /^(x|y2?)$/.test(t) && (s = a.getAxisSize(t) * e), t === "main")
      l = Hn(r.margin.left), c = Hn(r.margin.top);
    else if (t === "context")
      l = Hn(r.margin2.left), c = Hn(r.margin2.top);
    else if (t === "legend")
      l = r.margin3.left, c = r.margin3.top;
    else if (t === "x")
      l = o ? -s : 0, c = o ? 0 : r.height + s;
    else if (t === "y")
      l = o ? 0 : -s, c = o ? r.height + s : 0;
    else if (t === "y2")
      l = o ? 0 : r.width + s, c = o ? -s - 1 : 0;
    else if (t === "subX")
      l = 0, c = o ? 0 : r.height2;
    else if (t === "arc")
      l = r.arcWidth / 2, c = r.arcHeight / 2, !((n = i.arc_rangeText_values) === null || n === void 0) && n.length && (c += 5 + (a.hasType("gauge") && i.title_text ? 10 : 0));
    else if (t === "polar")
      l = r.arcWidth / 2, c = r.arcHeight / 2;
    else if (t === "radar") {
      var u = a.getRadarSize(), f = u[0], h = u[1];
      l = r.width / 2 - f, c = r.height / 2 - h;
    }
    return "translate(".concat(l, ", ").concat(c, ")");
  },
  transformMain: function(t, e) {
    var n = this, a = n.$el.main, i = n.$T, r = e?.axisX ? e.axisX : i(a.select(".".concat(Rt.axisX)), t), o = e?.axisY ? e.axisY : i(a.select(".".concat(Rt.axisY)), t), s = e?.axisY2 ? e.axisY2 : i(a.select(".".concat(Rt.axisY2)), t);
    i(a, t).attr("transform", n.getTranslate("main")), r.attr("transform", n.getTranslate("x")), o.attr("transform", n.getTranslate("y")), s.attr("transform", n.getTranslate("y2")), a.select(".".concat(at.chartArcs)).attr("transform", n.getTranslate("arc"));
  },
  transformAll: function(t, e) {
    var n = this, a = n.config, i = n.state, r = i.hasAxis, o = i.hasFunnel, s = i.hasTreemap, l = n.$el;
    !o && !s && n.transformMain(t, e), r && a.subchart_show && n.transformContext(t, e), l.legend && n.transformLegend(t);
  }
}, f_ = {
  /**
   * Check if the given chart type is valid
   * @param {string} type Chart type string
   * @returns {boolean}
   * @private
   */
  isValidChartType: function(t) {
    return !!(t && Object.values(Y).indexOf(t) > -1);
  },
  setTargetType: function(t, e) {
    var n = this, a = n.config, i = n.state.withoutFadeIn;
    n.mapToTargetIds(t).forEach(function(r) {
      i[r] = e === a.data_types[r], a.data_types[r] = e;
    }), t || (a.data_type = e);
  },
  /**
   * Updte current used chart types
   * @private
   */
  updateTypesElements: function() {
    var t = this, e = t.state.current;
    Object.keys(Y).forEach(function(n) {
      var a = Y[n], i = t.hasType(a, null, !0), r = e.types.indexOf(a);
      r === -1 && i ? e.types.push(a) : r > -1 && !i && e.types.splice(r, 1);
    }), t.setChartElements();
  },
  /**
   * Check if given chart types exists
   * @param {string} type Chart type
   * @param {Array} targetsValue Data array
   * @param {boolean} checkFromData Force to check type cotains from data targets
   * @returns {boolean}
   * @private
   */
  hasType: function(t, e, n) {
    var a;
    n === void 0 && (n = !1);
    var i = this, r = i.config, o = i.state.current, s = r.data_types, l = e || i.data.targets, c = !1;
    return !n && ((a = o.types) === null || a === void 0 ? void 0 : a.indexOf(t)) > -1 ? c = !0 : l?.length ? l.forEach(function(u) {
      var f = s[u.id];
      (f === t || !f && t === "line") && (c = !0);
    }) : Object.keys(s).length ? Object.keys(s).forEach(function(u) {
      s[u] === t && (c = !0);
    }) : c = r.data_type === t, c;
  },
  /**
   * Check if contains given chart types
   * @param {string} type Type key
   * @param {object} targets Target data
   * @param {Array} exclude Excluded types
   * @returns {boolean}
   * @private
   */
  hasTypeOf: function(t, e, n) {
    var a = this;
    return n === void 0 && (n = []), t in ye ? !ye[t].filter(function(i) {
      return n.indexOf(i) === -1;
    }).every(function(i) {
      return !a.hasType(i, e);
    }) : !1;
  },
  /**
   * Check if given data is certain chart type
   * @param {object} d Data object
   * @param {string|Array} type chart type
   * @returns {boolean}
   * @private
   */
  isTypeOf: function(t, e) {
    var n, a = lt(t) ? t : t.id, i = this.config && (((n = this.config.data_types) === null || n === void 0 ? void 0 : n[a]) || this.config.data_type);
    return ft(e) ? e.indexOf(i) >= 0 : i === e;
  },
  hasPointType: function() {
    var t = this;
    return t.hasTypeOf("Line") || t.hasType("bubble") || t.hasType("scatter");
  },
  /**
   * Check if contains arc types chart
   * @param {object} targets Target data
   * @param {Array} exclude Excluded types
   * @returns {boolean}
   * @private
   */
  hasArcType: function(t, e) {
    return this.hasTypeOf("Arc", t, e);
  },
  hasMultiArcGauge: function() {
    return this.hasType("gauge") && this.config.gauge_type === "multi";
  },
  isLineType: function(t) {
    var e = lt(t) ? t : t.id;
    return !this.config.data_types[e] || this.isTypeOf(e, ye.Line);
  },
  isStepType: function(t) {
    return this.isTypeOf(t, ye.Step);
  },
  isSplineType: function(t) {
    return this.isTypeOf(t, ye.Spline);
  },
  isAreaType: function(t) {
    return this.isTypeOf(t, ye.Area);
  },
  isAreaRangeType: function(t) {
    return this.isTypeOf(t, ye.AreaRange);
  },
  isBarType: function(t) {
    return this.isTypeOf(t, "bar");
  },
  isBubbleType: function(t) {
    return this.isTypeOf(t, "bubble");
  },
  isCandlestickType: function(t) {
    return this.isTypeOf(t, "candlestick");
  },
  isScatterType: function(t) {
    return this.isTypeOf(t, "scatter");
  },
  isTreemapType: function(t) {
    return this.isTypeOf(t, "treemap");
  },
  isPieType: function(t) {
    return this.isTypeOf(t, "pie");
  },
  isFunnelType: function(t) {
    return this.isTypeOf(t, "funnel");
  },
  isGaugeType: function(t) {
    return this.isTypeOf(t, "gauge");
  },
  isDonutType: function(t) {
    return this.isTypeOf(t, "donut");
  },
  isPolarType: function(t) {
    return this.isTypeOf(t, "polar");
  },
  isRadarType: function(t) {
    return this.isTypeOf(t, "radar");
  },
  isArcType: function(t) {
    return this.isPieType(t) || this.isDonutType(t) || this.isGaugeType(t) || this.isPolarType(t) || this.isRadarType(t);
  },
  // determine if is 'circle' data point
  isCirclePoint: function(t) {
    var e = this.config, n = e.point_pattern, a = !1;
    return t?.tagName === "circle" ? a = !0 : a = e.point_type === "circle" && (!n || ft(n) && n.length === 0), a;
  },
  lineData: function(t) {
    return this.isLineType(t) ? [t] : [];
  },
  arcData: function(t) {
    return this.isArcType(t.data) ? [t] : [];
  },
  /**
   * Get data adapt for data label showing
   * @param {object} d Data object
   * @returns {Array}
   * @private
   */
  labelishData: function(t) {
    return this.isBarType(t) || this.isLineType(t) || this.isScatterType(t) || this.isBubbleType(t) || this.isCandlestickType(t) || this.isFunnelType(t) || this.isRadarType(t) || this.isTreemapType(t) ? t.values.filter(function(e) {
      return q(e.value) || !!e.value;
    }) : [];
  },
  barLineBubbleData: function(t) {
    return this.isBarType(t) || this.isLineType(t) || this.isBubbleType(t) ? t.values : [];
  },
  // https://github.com/d3/d3-shape#curves
  isInterpolationType: function(t) {
    return [
      "basis",
      "basis-closed",
      "basis-open",
      "bundle",
      "cardinal",
      "cardinal-closed",
      "cardinal-open",
      "catmull-rom",
      "catmull-rom-closed",
      "catmull-rom-open",
      "linear",
      "linear-closed",
      "monotone-x",
      "monotone-y",
      "natural"
    ].indexOf(t) >= 0;
  }
};
function h_(t) {
  var e = this, n;
  return e.isLineType(t) ? n = e.generateGetLinePoints(e.getShapeIndices(e.isLineType)) : e.isBarType(t) && (n = e.generateGetBarPoints(e.getShapeIndices(e.isBarType))), n;
}
var d_ = {
  /**
   * Get the shape draw function
   * @returns {object}
   * @private
   */
  getDrawShape: function() {
    var t = this, e = t.config.axis_rotated, n = t.state, a = n.hasRadar, i = n.hasTreemap, r = { type: {}, indices: {}, pos: {} };
    if (!i && ["bar", "candlestick", "line", "area"].forEach(function(l) {
      var c = Nt(/^(bubble|scatter)$/.test(l) ? "line" : l);
      if (t.hasType(l) || t.hasTypeOf(c) || l === "line" && (t.hasType("bubble") || t.hasType("scatter"))) {
        var u = t.getShapeIndices(t["is".concat(c, "Type")]), f = t["generateDraw".concat(c)];
        r.indices[l] = u, r.type[l] = f ? f.bind(t)(u, !1) : void 0;
      }
    }), !t.hasArcType() || a || i) {
      var o = void 0, s = void 0;
      i || (o = a ? t.radarCircleX : e ? t.circleY : t.circleX, s = a ? t.radarCircleY : e ? t.circleX : t.circleY), r.pos = {
        xForText: t.generateXYForText(r.indices, !0),
        yForText: t.generateXYForText(r.indices, !1),
        cx: (o || function() {
        }).bind(t),
        cy: (s || function() {
        }).bind(t)
      };
    }
    return r;
  },
  /**
   * Get shape's indices according it's position within each axis tick.
   *
   * From the below example, indices will be:
   * ==> {data1: 0, data2: 0, data3: 1, data4: 1, __max__: 1}
   *
   * 	data1 data3   data1 data3
   * 	data2 data4   data2 data4
   * 	-------------------------
   * 		 0             1
   * @param {function} typeFilter Chart type filter function
   * @returns {object} Indices object with its position
   */
  getShapeIndices: function(t) {
    var e = this, n = e.config, a = n.data_xs, i = kt(a), r = {}, o = i ? {} : 0;
    return i && Li(Object.keys(a).map(function(s) {
      return a[s];
    })).forEach(function(s) {
      o[s] = 0, r[s] = {};
    }), e.filterTargetsToShow(e.data.targets.filter(t, e)).forEach(function(s) {
      for (var l, c = (s.id in a) ? a[s.id] : "", u = c ? r[c] : r, f = 0, h = void 0; h = n.data_groups[f]; f++)
        if (!(h.indexOf(s.id) < 0))
          for (var d = 0, v = void 0; v = h[d]; d++) {
            if (v in u) {
              u[s.id] = u[v];
              break;
            }
            s.id !== v && c && (u[v] = (l = u[s.id]) !== null && l !== void 0 ? l : o[c]);
          }
      St(u[s.id]) && (u[s.id] = c ? o[c]++ : o++, u.__max__ = (c ? o[c] : o) - 1);
    }), r;
  },
  /**
   * Get indices value based on data ID value
   * @param {object} indices Indices object
   * @param {object} d Data row
   * @param {string} caller Caller function name (Used only for 'sparkline' plugin)
   * @returns {object} Indices object
   * @private
   */
  getIndices: function(t, e, n) {
    var a = this, i = a.config, r = i.data_xs, o = i.bar_indices_removeNull, s = e.id, l = e.index;
    if (a.isBarType(s) && o) {
      var c = {};
      return a.getAllValuesOnIndex(l, !0).forEach(function(u, f) {
        c[u.id] = f, c.__max__ = f;
      }), c;
    }
    return kt(r) ? t[r[s]] : t;
  },
  /**
   * Get indices max number
   * @param {object} indices Indices object
   * @returns {number} Max number
   * @private
   */
  getIndicesMax: function(t) {
    return kt(this.config.data_xs) ? (
      // if is multiple xs, return total sum of xs' __max__ value
      Object.keys(t).map(function(e) {
        return t[e].__max__ || 0;
      }).reduce(function(e, n) {
        return e + n;
      })
    ) : t.__max__;
  },
  getShapeX: function(t, e, n) {
    var a = this, i = a.config, r = a.scale, o = n ? r.subX : r.zoom || r.x, s = i.bar_overlap, l = i.bar_padding, c = function(f, h) {
      return f + h;
    }, u = Ut(t) && (t._$total.length ? t._$total.reduce(c) / 2 : 0);
    return function(f) {
      var h = a.getIndices(e, f, "getShapeX"), d = f.id in h ? h[f.id] : 0, v = (h.__max__ || 0) + 1, _ = 0;
      if (kt(f.x)) {
        var p = o(f.x, !0);
        if (u) {
          var g = t[f.id] || t._$width;
          _ = s ? p - g / 2 : p - g + t._$total.slice(0, d + 1).reduce(c) - u;
        } else
          _ = p - (q(t) ? t : t._$width) * (v / 2 - (s ? 1 : d));
      }
      return t && _ && v > 1 && l && (d && (_ += l * d), v > 2 ? _ -= (v - 1) * l / 2 : v === 2 && (_ -= l / 2)), _;
    };
  },
  getShapeY: function(t) {
    var e = this, n = e.isStackNormalized();
    return function(a) {
      var i = a.value;
      return q(a) ? i = a : e.isAreaRangeType(a) ? i = e.getBaseValue(a, "mid") : n ? i = e.getRatio("index", a, !0) : e.isBubbleZType(a) ? i = e.getBubbleZData(a.value, "y") : e.isBarRangeType(a) && (i = i[1]), e.getYScaleById(a.id, t)(i);
    };
  },
  /**
   * Get shape based y Axis min value
   * @param {string} id Data id
   * @returns {number}
   * @private
   */
  getShapeYMin: function(t) {
    var e = this, n = e.axis.getId(t), a = e.scale[n], i = a.domain()[0], r = e.config["axis_".concat(n, "_inverted")];
    return !e.isGrouped(t) && !r && i > 0 ? i : 0;
  },
  /**
   * Get Shape's offset data
   * @param {function} typeFilter Type filter function
   * @returns {object}
   * @private
   */
  getShapeOffsetData: function(t) {
    var e = this, n = e.orderTargets(e.filterTargetsToShow(e.data.targets.filter(t, e))), a = n.map(function(u) {
      return u.id;
    }).join("_"), i = "".concat($t.shapeOffset, "_").concat(a), r = e.cache.get(i);
    if (r)
      return r;
    var o = e.isStackNormalized(), s = n.map(function(u) {
      var f = u.values, h = {};
      e.isStepType(u) && (f = e.convertValuesToStep(f));
      var d = f.reduce(function(v, _) {
        var p = Number(_.x);
        return v[p] = _, h[p] = o ? e.getRatio("index", _, !0) : _.value, v;
      }, {});
      return {
        id: u.id,
        rowValues: f,
        rowValueMapByXValue: d,
        values: h
      };
    }), l = n.reduce(function(u, f, h) {
      var d = f.id;
      return u[d] = h, u;
    }, {}), c = { indexMapByTargetId: l, shapeOffsetTargets: s };
    return e.cache.add(i, c), c;
  },
  getShapeOffset: function(t, e, n) {
    var a = this, i = a.getShapeOffsetData(t), r = i.shapeOffsetTargets, o = i.indexMapByTargetId, s = a.config.data_groupsZeroAs;
    return function(l, c) {
      var u = l.id, f = l.value, h = l.x, d = a.getIndices(e, l), v = a.getYScaleById(u, n);
      if (a.isBarRangeType(l))
        return v(f[0]);
      var _ = Number(h), p = v(s === "zero" ? 0 : a.getShapeYMin(u)), g = p;
      return r.filter(function(x) {
        return x.id !== u && d[x.id] === d[u];
      }).forEach(function(x) {
        var y = x.id, m = x.rowValueMapByXValue, T = x.rowValues, b = x.values;
        if (o[y] < o[u]) {
          var w = b[_], A = T[c];
          if ((!A || Number(A.x) !== _) && (A = m[_]), A?.value * f >= 0 && q(w)) {
            var k = f === 0 ? s === "positive" && w > 0 || s === "negative" && w < 0 : !0;
            k && (g += v(w) - p);
          }
        }
      }), g;
    };
  },
  /**
   * Get data's y coordinate
   * @param {object} d Target data
   * @param {number} i Index number
   * @returns {number} y coordinate
   * @private
   */
  circleY: function(t, e) {
    var n = this, a = t.id, i;
    return n.isGrouped(a) && (i = h_.bind(n)(t)), i ? i(t, e)[0][1] : n.getYScaleById(a)(n.getBaseValue(t));
  },
  getBarW: function(t, e, n) {
    var a, i, r, o, s, l = this, c = l.config, u = l.org, f = l.scale, h = l.state, d = l.getMaxDataCount(), v = t === "bar" && ((a = c.data_groups) === null || a === void 0 ? void 0 : a.length), _ = "".concat(t, "_width"), p = ((r = (i = l.getZoomTransform) === null || i === void 0 ? void 0 : i.call(l)) !== null && r !== void 0 ? r : { k: 1 }).k, g = [
      (o = c.axis_x_min) !== null && o !== void 0 ? o : u.xDomain[0],
      (s = c.axis_x_max) !== null && s !== void 0 ? s : u.xDomain[1]
    ].map(l.axis.isTimeSeries() ? jt.bind(l) : Number), x = e.tickInterval(d);
    if (f.zoom && !l.axis.isCategorized() && p > 1) {
      var y = g.every(function(b, w) {
        return b === u.xDomain[w];
      });
      x = u.xDomain.map(function(b, w) {
        var A = y ? b : b - Math.abs(g[w]);
        return f.zoom(A);
      }).reduce(function(b, w) {
        return Math.abs(b) + w;
      }) / d;
    }
    var m = function(b) {
      var w = b ? c[_][b] : c[_], A = b ? w.ratio : c["".concat(_, "_ratio")], k = b ? w.max : c["".concat(_, "_max")], C = q(w) ? w : U(w) ? w.call(l, h.width, n, d) : n ? x * A / n : 0;
      return k && C > k ? k : C;
    }, T = m();
    return !v && Ut(c[_]) && (T = { _$width: T, _$total: [] }, l.filterTargetsToShow(l.data.targets).forEach(function(b) {
      c[_][b.id] && (T[b.id] = m(b.id), T._$total.push(T[b.id] || T._$width));
    })), T;
  },
  /**
   * Get shape element
   * @param {string} shapeName Shape string
   * @param {number} i Index number
   * @param {string} id Data series id
   * @returns {d3Selection}
   * @private
   */
  getShapeByIndex: function(t, e, n) {
    var a = this, i = a.$el, r = nt(e) ? "-".concat(e) : "", o = i[t];
    return o && !o.empty() ? o = o.filter(function(s) {
      return n ? s.id === n : !0;
    }).filter(function(s) {
      return nt(e) ? s.index === e : !0;
    }) : o = (n ? i.main.selectAll(".".concat(ut["".concat(t, "s")]).concat(a.getTargetSelectorSuffix(n))) : i.main).selectAll(".".concat(ut[t]).concat(r)), o;
  },
  isWithinShape: function(t, e) {
    var n, a = this, i = N(t), r;
    return a.isTargetToShow(e.id) ? !((n = a.hasValidPointType) === null || n === void 0) && n.call(a, t.nodeName) ? r = a.isStepType(e) ? a.isWithinStep(t, a.getYScaleById(e.id)(a.getBaseValue(e))) : a.isWithinCircle(t, a.isBubbleType(e) ? a.pointSelectR(e) * 1.5 : 0) : t.nodeName === "path" && (r = i.classed(ut.bar) ? a.isWithinBar(t) : !0) : r = !1, r;
  },
  getInterpolate: function(t) {
    var e = this, n = e.getInterpolateType(t);
    return {
      basis: Fv,
      "basis-closed": Nv,
      "basis-open": Bv,
      bundle: Xv,
      cardinal: Gv,
      "cardinal-closed": Yv,
      "cardinal-open": Vv,
      "catmull-rom": Uv,
      "catmull-rom-closed": Hv,
      "catmull-rom-open": Wv,
      "monotone-x": qv,
      "monotone-y": jv,
      natural: Kv,
      "linear-closed": Zv,
      linear: rr,
      step: Jv,
      "step-after": tg,
      "step-before": Qv
    }[n];
  },
  getInterpolateType: function(t) {
    var e = this, n = e.config, a = n.spline_interpolation_type, i = e.isInterpolationType(a) ? a : "cardinal";
    return e.isSplineType(t) ? i : e.isStepType(t) ? n.line_step_type : "linear";
  },
  isWithinBar: function(t) {
    var e = Zt(this.state.event, t), n = ul(t), a = n[0], i = n[1], r = Math.min(a.x, i.x), o = Math.min(a.y, i.y), s = this.config.bar_sensitivity, l = we(t, !0), c = l.width, u = l.height, f = r - s, h = r + c + s, d = o + u + s, v = o - s, _ = f < e[0] && e[0] < h && v < e[1] && e[1] < d;
    return _;
  }
}, Ne = (
  /** @class */
  (function() {
    function t(e) {
      this.data = {
        xs: {},
        targets: []
      }, this.scale = {
        x: null,
        y: null,
        y2: null,
        subX: null,
        subY: null,
        subY2: null,
        zoom: null
      }, this.org = {
        xScale: null,
        xDomain: null
      }, this.format = {
        extraLineClasses: null,
        xAxisTick: null,
        dataTime: null,
        // dataTimeFormat
        defaultAxisTime: null,
        // defaultAxisTimeFormat
        axisTime: null
        // axisTimeFormat
      };
      var n = this;
      n.api = e, n.config = new Fe(), n.cache = new Sp();
      var a = new Ap();
      n.$el = a.getStore("element"), n.state = a.getStore("state"), n.$T = n.$T.bind(n);
    }
    return t.prototype.$T = function(e, n, a) {
      var i = this, r = i.config, o = i.state, s = r.transition_duration, l = r.subchart_show, c = e;
      if (c) {
        "tagName" in c && (c = N(c));
        var u = (n !== !1 && s || n) && (!o.zooming || o.dragging) && !o.resizing && o.rendered && !l;
        c = u ? c.transition(a).duration(s) : c;
      }
      return c;
    }, t.prototype.beforeInit = function() {
      var e = this;
      e.callPluginHook("$beforeInit"), pt(e.config.onbeforeinit, e.api);
    }, t.prototype.afterInit = function() {
      var e = this;
      e.callPluginHook("$afterInit"), pt(e.config.onafterinit, e.api);
    }, t.prototype.init = function() {
      var e = this, n = e.config, a = e.state, i = e.$el, r = n.boost_useCssRule, o = n.bindto;
      kp(e);
      var s = e.hasArcType();
      if (a.hasRadar = !a.hasAxis && e.hasType("radar"), a.hasFunnel = !a.hasAxis && e.hasType("funnel"), a.hasTreemap = !a.hasAxis && e.hasType("treemap"), a.hasAxis = !s && !a.hasFunnel && !a.hasTreemap, a.datetimeId = "bb-".concat(+/* @__PURE__ */ new Date() * re()), r) {
        var l = mt.createElement("style");
        l.type = "text/css", mt.head.appendChild(l), a.style = {
          rootSelctor: ".".concat(a.datetimeId),
          sheet: l.sheet
        }, i.style = l;
      }
      var c = {
        element: o,
        classname: "bb"
      };
      ct(o) && (c.element = o.element || "#chart", c.classname = o.classname || c.classname), i.chart = U(c.element.node) ? o.element : N(c.element || []), i.chart.empty() && (i.chart = N(mt.body.appendChild(mt.createElement("div")))), i.chart.html("").classed(c.classname, !0).classed(a.datetimeId, r).style("position", "relative"), e.initParams(), e.initToRender();
    }, t.prototype.initToRender = function(e) {
      var n = this, a = n.config, i = n.state, r = n.$el.chart, o = function() {
        return yp(r, { display: "none", visibility: "hidden" });
      }, s = a.render.lazy === !1 ? !1 : a.render.lazy || o(), l = tt.MutationObserver;
      s && l && a.render.observe !== !1 && !e && new l(function(c, u) {
        o() || (u.disconnect(), !i.rendered && n.initToRender(!0));
      }).observe(r.node(), {
        attributes: !0,
        attributeFilter: ["class", "style"]
      }), (!s || e) && n.convertData(a, function(c) {
        n.initWithData(c), n.afterInit();
      });
    }, t.prototype.initParams = function() {
      var e, n = this, a = n.config, i = n.format, r = n.state;
      if (n.color = n.generateColor(), n.levelColor = n.generateLevelColor(), a.padding === !1 && (a.axis_x_show = !1, a.axis_y_show = !1, a.axis_y2_show = !1, a.subchart_show = !1), (n.hasPointType() || !((e = n.hasLegendDefsPoint) === null || e === void 0) && e.call(n)) && (n.point = n.generatePoint()), r.hasAxis) {
        n.initClip(), i.extraLineClasses = n.generateExtraLineClass(), i.dataTime = a.data_xLocaltime ? cs : us, i.axisTime = a.axis_x_localtime ? Hi : Wi;
        var o = a.zoom_enabled && a.zoom_type === "drag";
        i.defaultAxisTime = function(u) {
          var f = n.scale, h = f.x, d = f.zoom, v = o ? d : d && h.orgDomain().toString() !== d.domain().toString(), _ = u.getMilliseconds() && ".%L" || u.getSeconds() && ".:%S" || u.getMinutes() && "%I:%M" || u.getHours() && "%I %p" || u.getDate() !== 1 && "%b %d" || v && u.getDate() === 1 && "%b'%y" || u.getMonth() && "%-m/%-d" || "%Y";
          return i.axisTime(_)(u);
        };
      }
      var s = a.legend_position, l = a.legend_inset_anchor, c = a.axis_rotated;
      r.isLegendRight = s === "right", r.isLegendInset = s === "inset", r.isLegendTop = l === "top-left" || l === "top-right", r.isLegendLeft = l === "top-left" || l === "bottom-left", r.rotatedPadding.top = n.getResettedPadding(r.rotatedPadding.top), r.rotatedPadding.right = c && !a.axis_x_show ? 0 : 30, r.inputType = bp(a.interaction_inputType_mouse, a.interaction_inputType_touch);
    }, t.prototype.initWithData = function(e) {
      var n, a, i, r = this, o = r.config, s = r.scale, l = r.state, c = r.$el, u = r.org, f = l.hasAxis, h = l.hasFunnel, d = l.hasTreemap, v = o.interaction_enabled, _ = r.hasType("polar"), p = o.data_labels_backgroundColors;
      if (f && (r.axis = r.getAxisInstance(), o.zoom_enabled && r.initZoom()), r.data.xs = {}, r.data.targets = r.convertDataToTargets(e), o.data_filter && (r.data.targets = r.data.targets.filter(o.data_filter.bind(r.api))), o.data_hide && r.addHiddenTargetIds(o.data_hide === !0 ? r.mapToIds(r.data.targets) : o.data_hide), o.legend_hide && r.addHiddenLegendIds(o.legend_hide === !0 ? r.mapToIds(r.data.targets) : o.legend_hide), r.updateSizes(), r.updateScales(!0), f) {
        var g = s.x, x = s.y, y = s.y2, m = s.subX, T = s.subY, b = s.subY2;
        g && (g.domain(on(r.getXDomain(r.data.targets), !o.axis_x_inverted)), m.domain(g.domain()), u.xDomain = g.domain()), x && (x.domain(r.getYDomain(r.data.targets, "y")), T.domain(x.domain())), y && (y.domain(r.getYDomain(r.data.targets, "y2")), b && b.domain(y.domain()));
      }
      if (c.svg = c.chart.append("svg").style("overflow", "hidden").style("display", "block"), v && l.inputType) {
        var w = l.inputType === "touch", A = o.onclick, k = o.onover, C = o.onout;
        c.svg.on("click", A?.bind(r.api) || null).on(w ? "touchstart" : "mouseenter", k?.bind(r.api) || null, w ? { passive: !0 } : void 0).on(w ? "touchend" : "mouseleave", C?.bind(r.api) || null);
      }
      o.svg_classname && c.svg.attr("class", o.svg_classname);
      var E = U(o.color_tiles) && r.patterns;
      (f || E || _ || d || p || !((n = r.hasLegendDefsPoint) === null || n === void 0) && n.call(r)) && (c.defs = c.svg.append("defs"), f && ["id", "idXAxis", "idYAxis", "idGrid"].forEach(function($) {
        r.appendClip(c.defs, l.clip[$]);
      }), r.generateTextBGColorFilter(p), E && r.patterns.forEach(function($) {
        return c.defs.append(function() {
          return $.node;
        });
      })), r.updateSvgSize(), r.bindResize();
      var M = c.svg.append("g").classed(j.main, !0).attr("transform", h || d ? null : r.getTranslate("main"));
      if (c.main = M, o.subchart_show && r.initSubchart(), o.tooltip_show && r.initTooltip(), o.title_text && r.initTitle(), !d && o.legend_show && r.initLegend(), o.data_empty_label_text && M.append("text").attr("class", "".concat(Ct.text, " ").concat(j.empty)).attr("text-anchor", "middle").attr("dominant-baseline", "middle"), f && (o.regions.length && r.initRegion(), !o.clipPath && r.axis.init()), M.append("g").classed(j.chart, !0).attr("clip-path", f ? l.clip.path : null), r.callPluginHook("$init"), r.initChartElements(), f && (v && ((a = r.initEventRect) === null || a === void 0 || a.call(r)), r.initGrid(), o.clipPath && ((i = r.axis) === null || i === void 0 || i.init())), r.updateTargets(r.data.targets), r.updateDimension(), pt(o.oninit, r.api), r.setBackground(), r.redraw({
        withTransition: !1,
        withTransform: !0,
        withUpdateXDomain: !0,
        withUpdateOrgXDomain: !0,
        withTransitionForAxis: !1,
        initializing: !0
      }), o.data_onmin || o.data_onmax) {
        var L = r.getMinMaxData();
        pt(o.data_onmin, r.api, L.min), pt(o.data_onmax, r.api, L.max);
      }
      o.tooltip_show && r.initShowTooltip(), l.rendered = !0;
    }, t.prototype.initChartElements = function() {
      var e = this, n = e.state, a = n.hasAxis, i = n.hasRadar, r = n.hasTreemap, o = [];
      if (a) {
        var s = ["bar", "bubble", "candlestick", "line"];
        e.config.bar_front && s.push(s.shift());
        for (var l = 0, c = s; l < c.length; l++) {
          var u = c[l], f = Nt(u);
          (u === "line" && e.hasTypeOf(f) || e.hasType(u)) && o.push(f);
        }
      } else if (r)
        o.push("Treemap");
      else if (e.hasType("funnel"))
        o.push("Funnel");
      else {
        var h = e.hasType("polar"), d = e.hasType("gauge");
        i || o.push("Arc", "Pie"), d ? o.push("Gauge") : i ? o.push("Radar") : h && o.push("Polar");
      }
      for (var v = 0, _ = o; v < _.length; v++) {
        var p = _[v];
        e["init".concat(p)]();
      }
      kt(e.config.data_labels) && !e.hasArcType(null, ["radar"]) && e.initText();
    }, t.prototype.setChartElements = function() {
      var e = this, n = e.$el, a = n.chart, i = n.svg, r = n.defs, o = n.main, s = n.tooltip, l = n.legend, c = n.title, u = n.grid, f = n.needle, h = n.arcs, d = n.circle, v = n.bar, _ = n.candlestick, p = n.line, g = n.area, x = n.text;
      e.api.$ = {
        chart: a,
        svg: i,
        defs: r,
        main: o,
        tooltip: s,
        legend: l,
        title: c,
        grid: u,
        arc: h,
        circles: d,
        bar: { bars: v },
        candlestick: _,
        line: { lines: p, areas: g },
        needle: f,
        text: { texts: x }
      };
    }, t.prototype.setBackground = function() {
      var e = this, n = e.config.background, a = e.state, i = e.$el.svg;
      if (kt(n)) {
        var r = i.select("g").insert(n.imgUrl ? "image" : "rect", ":first-child");
        n.imgUrl ? r.attr("href", n.imgUrl) : n.color && r.style("fill", n.color).attr("clip-path", a.clip.path), r.attr("class", n.class || null).attr("width", "100%").attr("height", "100%");
      }
    }, t.prototype.updateTargets = function(e) {
      var n, a, i = this, r = i.state, o = r.hasAxis, s = r.hasFunnel, l = r.hasRadar, c = r.hasTreemap, u = function(x) {
        return i["updateTargetsFor".concat(x)](e.filter(i["is".concat(x, "Type")].bind(i)));
      };
      if (i.updateTargetsForText(e), o) {
        for (var f = ["bar", "candlestick", "line"], h = 0, d = f; h < d.length; h++) {
          var v = d[h], _ = Nt(v);
          (v === "line" && i.hasTypeOf(_) || i.hasType(v)) && u(_);
        }
        (n = i.updateTargetsForSubchart) === null || n === void 0 || n.call(i, e);
      } else if (i.hasArcType(e)) {
        var p = "Arc";
        l ? p = "Radar" : i.hasType("polar") && (p = "Polar"), u(p);
      } else s ? u("Funnel") : c && u("Treemap");
      var g = i.hasType("bubble") || i.hasType("scatter");
      g && ((a = i.updateTargetForCircle) === null || a === void 0 || a.call(i)), i.filterTargetsToShowAtInit(g);
    }, t.prototype.filterTargetsToShowAtInit = function(e) {
      e === void 0 && (e = !1);
      var n = this, a = n.$el.svg, i = n.$T, r = ".".concat(j.target);
      e && (r += ", .".concat(Ft.chartCircles, " > .").concat(Ft.circles)), i(a.selectAll(r).filter(function(o) {
        return n.isTargetToShow(o.id);
      })).style("opacity", null);
    }, t.prototype.getWithOption = function(e) {
      for (var n = {
        Dimension: !0,
        EventRect: !0,
        Legend: !1,
        Subchart: !0,
        Transform: !1,
        Transition: !0,
        TrimXDomain: !0,
        UpdateXAxis: "UpdateXDomain",
        UpdateXDomain: !1,
        UpdateOrgXDomain: !1,
        TransitionForExit: "Transition",
        TransitionForAxis: "Transition",
        Y: !0
      }, a = 0, i = Object.entries(n); a < i.length; a++) {
        var r = i[a], o = r[0], s = r[1], l = lt(s) ? n[s] : s;
        n[o] = Te(e, "with".concat(o), l);
      }
      return n;
    }, t.prototype.initialOpacity = function(e) {
      var n = this, a = n.state.withoutFadeIn;
      return n.getBaseValue(e) !== null && a[e.id] ? null : "0";
    }, t.prototype.bindResize = function() {
      var e = this, n = e.$el, a = e.config, i = e.state, r = Mp(a.resize_timer), o = a.resize_auto, s = [];
      s.push(function() {
        return pt(a.onresize, e.api);
      }), /^(true|parent)$/.test(o) && s.push(function() {
        i.resizing = !0, a.legend_show && (e.updateSizes(), e.updateLegend()), e.api.flush(!1);
      }), s.push(function() {
        pt(a.onresized, e.api), i.resizing = !1;
      }), s.forEach(function(l) {
        return r.add(l);
      }), e.resizeFunction = r, o === "parent" ? (e.resizeFunction.resizeObserver = new ResizeObserver(e.resizeFunction.bind(e))).observe(n.chart.node().parentNode) : tt.addEventListener("resize", e.resizeFunction);
    }, t.prototype.callPluginHook = function(e) {
      for (var n = this, a = [], i = 1; i < arguments.length; i++)
        a[i - 1] = arguments[i];
      this.config.plugins.forEach(function(r) {
        e === "$beforeInit" && (r.$$ = n, n.api.plugins.push(r)), r[e].apply(r, a);
      });
    }, t;
  })()
);
Lt(Ne.prototype, [
  // common
  Fp,
  Np,
  Bp,
  Gp,
  Yp,
  Wp,
  Zp,
  Xp,
  qp,
  Kp,
  Jp,
  Qp,
  d_,
  t_,
  e_,
  s_,
  l_,
  c_,
  u_,
  f_
]);
function v_(t) {
  var e = this.config, n, a, i, r = function() {
    var o = a.shift();
    if (o && n && Ut(n) && o in n)
      return n = n[o], r();
    if (!o)
      return n;
  };
  Object.keys(e).forEach(function(o) {
    n = t, a = o.split("_"), i = r(), vt(i) && (e[o] = i);
  }), this.api && (this.state.orgConfig = t);
}
var g_ = {
  /**
   * Resize the chart.
   * @function resize
   * @instance
   * @memberof Chart
   * @param {object} size This argument should include width and height in pixels.
   * @param {number} [size.width] width value
   * @param {number} [size.height] height value
   * @example
   * // Resize to 640x480
   * chart.resize({
   *    width: 640,
   *    height: 480
   * });
   */
  resize: function(t) {
    var e = this.internal, n = e.config, a = e.state;
    a.rendered && (n.size_width = t ? t.width : null, n.size_height = t ? t.height : null, a.resizing = !0, this.flush(!1), e.resizeFunction());
  },
  /**
   * Force to redraw.
   * - **NOTE:** When zoom/subchart is used, the zoomed state will be reset.
   * @function flush
   * @instance
   * @memberof Chart
   * @param {boolean} [soft] For soft redraw.
   * @example
   * chart.flush();
   *
   * // for soft redraw
   * chart.flush(true);
   */
  flush: function(t) {
    var e, n, a = this.internal, i = a.state, r = a.$el.zoomResetBtn;
    i.rendered ? (i.resizing ? (e = a.brush) === null || e === void 0 || e.updateResize() : (n = a.axis) === null || n === void 0 || n.setOrient(), r?.style("display", "none"), a.scale.zoom && (i.current.zoomDomain = a.scale.zoom.domain()), a.scale.zoom = null, t ? a.redraw({
      withTransform: !0,
      withUpdateXDomain: !0,
      withUpdateOrgXDomain: !0,
      withLegend: !0
    }) : a.updateAndRedraw({
      withLegend: !0,
      withTransition: !1,
      withTransitionForTransform: !1
    }), !i.resizing && a.brush && (a.brush.getSelection().call(a.brush.move), a.unselectRect()), i.current.zoomDomain && (a.api.zoom(i.current.zoomDomain), i.current.zoomDomain = null)) : a.initToRender(!0);
  },
  /**
   * Reset the chart object and remove element and events completely.
   * @function destroy
   * @instance
   * @memberof Chart
   * @returns {null}
   * @example
   * chart.destroy();
   */
  destroy: function() {
    var t = this, e, n = this.internal, a = n.$el, i = a.chart, r = a.style, o = a.svg;
    if (kt(n)) {
      n.callPluginHook("$willDestroy"), n.charts.splice(n.charts.indexOf(this), 1), n.unbindAllEvents(), o.select("*").interrupt(), n.resizeFunction.clear(), (e = n.resizeFunction.resizeObserver) === null || e === void 0 || e.disconnect(), tt.removeEventListener("resize", n.resizeFunction), i.classed("bb", !1).style("position", null).selectChildren().remove(), r && r.parentNode.removeChild(r), Object.keys(this).forEach(function(l) {
        l === "internal" && Object.keys(n).forEach(function(c) {
          n[c] = null;
        }), t[l] = null, delete t[l];
      });
      for (var s in this)
        this[s] = function() {
        };
    }
    return null;
  },
  /**
   * Get or set config option value.
   * - **NOTE**
   *  - The option key name must be specified as the last level.
   *  - When no argument is given, it will return all specified generation options object only. (will exclude any other options not specified at the initialization)
   * @function config
   * @instance
   * @memberof Chart
   * @param {string} name The option key name.
   * @param {string|number|boolean|object|Array} [value] The value accepted for indicated option.
   * @param {boolean} [redraw] Set to redraw with the new option changes.
   * - **NOTE:** Doesn't guarantee to work in all circumstances. It can be applied for limited options only.
   * @returns {string|number|boolean|object|Array} The option value or all options object
   * @example
   *
   * // Getter
   * chart.config("gauge.max");
   *
   * // Getter specified with top level key name will not work.
   * // The option key name must be specified as the last level.
   * // chart.config("gauge"); // will not work
   *
   * // without any arguments, it returns generation config object
   * chart.config();  // {data: { ... }, axis: { ... }, ...}
   *
   * // Setter
   * chart.config("gauge.max", 100);
   *
   * // Setter specified with top level key name will not work.
   * // The option key name must be specified as the last level.
   * // chart.config("gauge", {min: 10, max: 20}); // will not work
   *
   * // Setter & redraw with the new option
   * chart.config("gauge.max", 100, true);
   */
  config: function(t, e, n) {
    var a = this.internal, i = a.config, r = a.state, o = t?.replace(/\./g, "_"), s;
    return t && o in i ? vt(e) ? (i[o] = e, s = e, n && this.flush()) : s = i[o] : (arguments.length === 0 || qt(t)) && (s = r.orgConfig), s;
  }
}, p_ = {
  /**
   * Get the color
   * @function color
   * @instance
   * @memberof Chart
   * @param {string} id id to get the color
   * @returns {string}
   * @example
   * chart.color("data1");
   */
  color: function(t) {
    return this.internal.color(t);
  }
}, Al = function(t) {
  var e = this.internal.data.targets;
  if (!St(t)) {
    var n = ft(t) ? t : [t];
    return e.filter(function(a) {
      return n.some(function(i) {
        return i === a.id;
      });
    });
  }
  return e;
};
Lt(Al, {
  /**
   * Get data shown in the chart.
   * @function data․shown
   * @instance
   * @memberof Chart
   * @param {string|Array} targetIds If this argument is given, this API filters the data with specified target ids. If this argument is not given, all shown data will be returned.
   * @returns {Array} Data objects
   * @example
   * // Get shown data by filtering to include only data1 data
   * chart.data.shown("data1");
   * // --> [{id: "data1", id_org: "data1", values: Array(6)}, ...]
   *
   * // Get shown data by filtering to include data1 and data2 data
   * chart.data.shown(["data1", "data2"]);
   *
   * // Get all shown data
   * chart.data.shown();
   */
  shown: function(t) {
    return this.internal.filterTargetsToShow(this.data(t));
  },
  /**
   * Get values of the data loaded in the chart.
   * @function data․values
   * @instance
   * @memberof Chart
   * @param {string|Array|null} targetIds This API returns the values of specified target. If this argument is not given, null will be returned
   * @param {boolean} [flat=true] Get flatten values
   * @returns {Array} Data values
   * @example
   * // Get data1 values
   * chart.data.values("data1");
   * // --> [10, 20, 30, 40]
   */
  values: function(t, e) {
    e === void 0 && (e = !0);
    var n = null;
    if (t) {
      var a = this.data(t);
      ft(a) && (n = [], a.forEach(function(i) {
        var r = i.values.map(function(o) {
          return o.value;
        });
        e ? n = n.concat(r) : n.push(r);
      }));
    }
    return n;
  },
  /**
   * Get and set names of the data loaded in the chart.
   * @function data․names
   * @instance
   * @memberof Chart
   * @param {object} names If this argument is given, the names of data will be updated. If not given, the current names will be returned. The format of this argument is the same as [data.names](./Options.html#.data%25E2%2580%25A4names).
   * @returns {object} Corresponding names according its key value, if specified names values.
   * @example
   * // Get current names
   * chart.data.names();
   * // --> {data1: "test1", data2: "test2"}
   *
   * // Update names
   * chart.data.names({
   *  data1: "New Name 1",
   *  data2: "New Name 2"
   * });
   */
  names: function(t) {
    var e = this.internal;
    return e.updateDataAttributes("names", t);
  },
  /**
   * Get and set colors of the data loaded in the chart.
   * - **NOTE:** If gradient option is set, the color update will affect only gradient stops have the same color.
   * @function data․colors
   * @instance
   * @memberof Chart
   * @param {object} colors If this argument is given, the colors of data will be updated. If not given, the current colors will be returned. The format of this argument is the same as [data.colors](./Options.html#.data%25E2%2580%25A4colors).
   * @returns {object} Corresponding data color value according its key value.
   * @example
   * // Get current colors
   * chart.data.colors();
   * // --> {data1: "#00c73c", data2: "#fa7171"}
   *
   * // Update colors
   * chart.data.colors({
   *  data1: "#FFFFFF",
   *  data2: "#000000"
   * });
   */
  colors: function(t) {
    return this.internal.updateDataAttributes("colors", t);
  },
  /**
   * Get and set axes of the data loaded in the chart.
   * - **NOTE:** If all data is related to one of the axes, the domain of axis without related data will be replaced by the domain from the axis with related data
   * @function data․axes
   * @instance
   * @memberof Chart
   * @param {object} axes If this argument is given, the axes of data will be updated. If not given, the current axes will be returned. The format of this argument is the same as
   * @returns {object} Corresponding axes value for data, if specified axes value.
   * @example
   * // Get current axes
   * chart.data.axes();
   * // --> {data1: "y"}
   *
   * // Update axes
   * chart.data.axes({
   *  data1: "y",
   *  data2: "y2"
   * });
   */
  axes: function(t) {
    return this.internal.updateDataAttributes("axes", t);
  },
  /**
   * Get the minimum data value bound to the chart
   * @function data․min
   * @instance
   * @memberof Chart
   * @returns {Array} Data objects
   * @example
   * // Get current axes
   * chart.data.min();
   * // --> [{x: 0, value: 30, id: "data1", index: 0}, ...]
   */
  min: function() {
    return this.internal.getMinMaxData().min;
  },
  /**
   * Get the maximum data value bound to the chart
   * @function data․max
   * @instance
   * @memberof Chart
   * @returns {Array} Data objects
   * @example
   * // Get current axes
   * chart.data.max();
   * // --> [{x: 3, value: 400, id: "data1", index: 3}, ...]
   */
  max: function() {
    return this.internal.getMinMaxData().max;
  }
});
var __ = { data: Al }, x_ = function(t) {
  var e;
  return (e = tt.btoa) === null || e === void 0 ? void 0 : e.call(tt, encodeURIComponent(t).replace(/%([0-9A-F]{2})/g, function(n, a) {
    return String.fromCharCode(Number("0x".concat(a)));
  }));
};
function m_(t, e, n) {
  var a = e || n, i = a.width, r = a.height, o = new XMLSerializer(), s = t.cloneNode(!0), l = xp(Ie(mt.styleSheets)).filter(function(d) {
    return d.cssText;
  }).map(function(d) {
    return d.cssText;
  });
  s.setAttribute("xmlns", Ke.xhtml), s.style.margin = "0", s.style.padding = "0", e.preserveFontStyle && s.querySelectorAll("text").forEach(function(d) {
    d.innerHTML = "";
  });
  var c = o.serializeToString(s), u = mt.createElement("style");
  u.appendChild(mt.createTextNode(l.join(`
`)));
  var f = o.serializeToString(u), h = '<svg xmlns="'.concat(Ke.svg, '" width="').concat(i, '" height="').concat(r, `" 
		viewBox="0 0 `).concat(n.width, " ").concat(n.height, `" 
		preserveAspectRatio="`).concat(e?.preserveAspectRatio === !1 ? "none" : "xMinYMid meet", `">
			<foreignObject width="100%" height="100%">
				`).concat(f, `
				`).concat(c.replace(/(url\()[^#]+/g, "$1"), `
			</foreignObject></svg>`);
  return "data:image/svg+xml;base64,".concat(x_(h));
}
function y_(t, e) {
  var n = e.top, a = e.left, i = we(t, !0), r = i.x, o = i.y, s = t.getScreenCTM(), l = s.a, c = s.b, u = s.c, f = s.d, h = s.e, d = s.f, v = Mt(t, !0), _ = v.width, p = v.height;
  return {
    x: l * r + u * o + h - a,
    y: c * r + f * o + d - n + (p - Math.round(p / 4)),
    width: _,
    height: p
  };
}
function b_(t) {
  var e = Mt(t), n = e.left, a = e.top, i = function(o) {
    return o.textContent || o.childElementCount;
  }, r = [];
  return Ie(t.querySelectorAll("text")).filter(i).forEach(function(o) {
    var s = function(c) {
      var u, f = tt.getComputedStyle(c), h = f.fill, d = f.fontFamily, v = f.fontSize, _ = f.textAnchor, p = f.transform, g = y_(c, { left: n, top: a }), x = g.x, y = g.y, m = g.width, T = g.height;
      return u = {}, u[c.textContent] = {
        x,
        y,
        width: m,
        height: T,
        fill: h,
        fontFamily: d,
        fontSize: v,
        textAnchor: _,
        transform: p
      }, u;
    };
    if (o.childElementCount > 1) {
      var l = [];
      return Ie(o.querySelectorAll("tspan")).filter(i).forEach(function(c) {
        r.push(s(c));
      }), l;
    } else
      r.push(s(o));
  }), r;
}
function T_(t, e) {
  e.forEach(function(n) {
    Object.keys(n).forEach(function(a) {
      var i = n[a], r = i.x, o = i.y, s = i.width, l = i.height, c = i.fill, u = i.fontFamily, f = i.fontSize, h = i.transform;
      if (t.save(), t.font = "".concat(f, " ").concat(u), t.fillStyle = c, h === "none")
        t.fillText(a, r, o);
      else {
        var d = h.replace(/(matrix|\(|\))/g, "").split(",");
        d.splice(4).every(function(v) {
          return +v == 0;
        }) ? (d.push(r + s - s / 4), d.push(o - l + l / 3)) : (d.push(r), d.push(o)), t.transform.apply(t, d), t.fillText(a, 0, 0);
      }
      t.restore();
    });
  });
}
var $_ = {
  /**
   * Export chart as an image.
   * - **NOTE:**
   *   - IE11 and below not work properly due to the lack of the feature(<a href="https://msdn.microsoft.com/en-us/library/hh834675(v=vs.85).aspx">foreignObject</a>) support
   *   - Every style applied to the chart & the basic CSS file(ex. billboard.css) should be at same domain as API call context to get correct styled export image.
   * @function export
   * @instance
   * @memberof Chart
   * @param {object} option Export option
   * @param {string} [option.mimeType="image/png"] The desired output image format. (ex. 'image/png' for png, 'image/jpeg' for jpeg format)
   * @param {number} [option.width={currentWidth}] width
   * @param {number} [option.height={currentHeigth}] height
   * @param {boolean} [option.preserveAspectRatio=true] Preserve aspect ratio on given size
   * @param {boolean} [option.preserveFontStyle=false] Preserve font style(font-family).<br>
   * **NOTE:**
   *   - This option is useful when outlink web font style's `font-family` are applied to chart's text element.
   *   - Text element's position(especially "transformed") can't be preserved correctly according the page's layout condition.
   *   - If need to preserve accurate text position, embed the web font data within to the page and set `preserveFontStyle=false`.
   *     - Checkout the embed example: <a href="https://stackblitz.com/edit/zfbya9-8nf9nn?file=index.html">https://stackblitz.com/edit/zfbya9-8nf9nn?file=index.html</a>
   * @param {function(string): void} [callback] The callback to be invoked when export is ready.
   * @returns {string} dataURI
   * @example
   *  chart.export();
   *  // --> "data:image/svg+xml;base64,PHN..."
   *
   *  // Initialize the download automatically
   *  chart.export({mimeType: "image/png"}, dataUrl => {
   *     const link = document.createElement("a");
   *
   *     link.download = `${Date.now()}.png`;
   *     link.href = dataUrl;
   *     link.innerHTML = "Download chart as image";
   *
   *     document.body.appendChild(link);
   *  });
   *
   *  // Resize the exported image
   *  chart.export(
   *    {
   *      width: 800,
   *      height: 600,
   *      preserveAspectRatio: false,
   *      preserveFontStyle: false,
   *      mimeType: "image/png"
   *    },
   *    dataUrl => { ... }
   *  );
   */
  export: function(t, e) {
    var n = this, a = this.internal, i = a.state, r = a.$el, o = r.chart, s = r.svg, l = i.current, c = l.width, u = l.height, f = rn(/* @__PURE__ */ Object.create(null), {
      width: c,
      height: u,
      preserveAspectRatio: !0,
      preserveFontStyle: !1,
      mimeType: "image/png"
    }, t), h = m_(o.node(), f, { width: c, height: u }), d = f.preserveFontStyle ? b_(s.node()) : [];
    if (e && U(e)) {
      var v = new Image();
      v.crossOrigin = "Anonymous", v.onload = function() {
        var _ = mt.createElement("canvas"), p = _.getContext("2d");
        _.width = f.width || c, _.height = f.height || u, p.drawImage(v, 0, 0), d.length && (T_(p, d), d.length = 0), e.bind(n)(_.toDataURL(f.mimeType));
      }, v.src = h;
    }
    return h;
  }
}, w_ = {
  /**
   * This API highlights specified targets and fade out the others.<br><br>
   * You can specify multiple targets by giving an array that includes id as String. If no argument is given, all of targets will be highlighted.
   * @function focus
   * @instance
   * @memberof Chart
   * @param {string|Array} targetIdsValue Target ids to be highlighted.
   * @example
   *  // data1 will be highlighted and the others will be faded out
   *  chart.focus("data1");
   *
   * // data1 and data2 will be highlighted and the others will be faded out
   * chart.focus(["data1", "data2"]);
   *
   * // all targets will be highlighted
   * chart.focus();
   */
  focus: function(t) {
    var e = this.internal, n = e.state, a = e.mapToTargetIds(t), i = e.$el.svg.selectAll(e.selectorTargets(a.filter(e.isTargetToShow, e)));
    this.revert(), this.defocus(), i.classed(gt.focused, !0).classed(gt.defocused, !1), e.hasArcType() && !n.hasRadar && (e.expandArc(a), e.hasType("gauge") && e.markOverlapped(t, e, ".".concat(Vt.gaugeValue))), e.toggleFocusLegend(a, !0), n.focusedTargetIds = a, n.defocusedTargetIds = n.defocusedTargetIds.filter(function(r) {
      return a.indexOf(r) < 0;
    });
  },
  /**
   * This API fades out specified targets and reverts the others.<br><br>
   * You can specify multiple targets by giving an array that includes id as String. If no argument is given, all of targets will be faded out.
   * @function defocus
   * @instance
   * @memberof Chart
   * @param {string|Array} targetIdsValue Target ids to be faded out.
   * @example
   * // data1 will be faded out and the others will be reverted.
   * chart.defocus("data1");
   *
   * // data1 and data2 will be faded out and the others will be reverted.
   * chart.defocus(["data1", "data2"]);
   *
   * // all targets will be faded out.
   * chart.defocus();
   */
  defocus: function(t) {
    var e = this.internal, n = e.state, a = e.mapToTargetIds(t), i = e.$el.svg.selectAll(e.selectorTargets(a.filter(e.isTargetToShow, e)));
    i.classed(gt.focused, !1).classed(gt.defocused, !0), e.hasArcType(null, ["polar"]) && (e.unexpandArc(a), e.hasType("gauge") && e.undoMarkOverlapped(e, ".".concat(Vt.gaugeValue))), e.toggleFocusLegend(a, !1), n.focusedTargetIds = n.focusedTargetIds.filter(function(r) {
      return a.indexOf(r) < 0;
    }), n.defocusedTargetIds = a;
  },
  /**
   * Revert focused or defocused state to initial state.<br><br>
   * You can specify multiple targets by giving an array that includes id as string. If no argument is given, all of targets will be reverted.
   * @function revert
   * @instance
   * @memberof Chart
   * @param {string|Array} targetIdsValue Target ids to be reverted
   * @example
   * // 'data1' will be reverted.
   * chart.revert("data1");
   *
   * // 'data1' and 'data2' will be reverted.
   * chart.revert(["data1", "data2"]);
   *
   * // all targets will be reverted.
   * chart.revert();
   */
  revert: function(t) {
    var e = this.internal, n = e.config, a = e.state, i = e.$el, r = e.mapToTargetIds(t), o = i.svg.selectAll(e.selectorTargets(r));
    o.classed(gt.focused, !1).classed(gt.defocused, !1), e.hasArcType(null, ["polar"]) && e.unexpandArc(r), n.legend_show && (e.showLegend(r.filter(e.isLegendToShow.bind(e))), i.legend.selectAll(e.selectorLegends(r)).filter(function() {
      return N(this).classed(gt.legendItemFocused);
    }).classed(gt.legendItemFocused, !1)), a.focusedTargetIds = [], a.defocusedTargetIds = [];
  }
}, A_ = {
  /**
   * Show legend for each target.
   * - **NOTE:** Legend APIs aren't supported for `treemap` type.
   * @function legend․show
   * @instance
   * @memberof Chart
   * @param {string|Array} targetIds
   * - If targetIds is given, specified target's legend will be shown.
   * - If only one target is the candidate, String can be passed.
   * - If no argument is given, all of target's legend will be shown.
   * @example
   * // Show legend for data1.
   * chart.legend.show("data1");
   *
   * // Show legend for data1 and data2.
   * chart.legend.show(["data1", "data2"]);
   *
   * // Show all legend.
   * chart.legend.show();
   */
  show: function(t) {
    var e = this.internal;
    e.showLegend(e.mapToTargetIds(t)), e.updateAndRedraw({ withLegend: !0 });
  },
  /**
   * Hide legend for each target.
   * @function legend․hide
   * @instance
   * @memberof Chart
   * @param {string|Array} targetIds
   * - If targetIds is given, specified target's legend will be hidden.
   * - If only one target is the candidate, String can be passed.
   * - If no argument is given, all of target's legend will be hidden.
   * @example
   * // Hide legend for data1.
   * chart.legend.hide("data1");
   *
   * // Hide legend for data1 and data2.
   * chart.legend.hide(["data1", "data2"]);
   *
   * // Hide all legend.
   * chart.legend.hide();
   */
  hide: function(t) {
    var e = this.internal;
    e.hideLegend(e.mapToTargetIds(t)), e.updateAndRedraw({ withLegend: !0 });
  }
}, S_ = { legend: A_ }, k_ = {
  /**
   * Load data to the chart.<br><br>
   * You can specify multiple targets by giving an array that includes id as String. If no argument is given, all of targets will be toggles.
   * - <b>Note:</b>
   *   - unload should be used if some data needs to be unloaded simultaneously.
   *     If you call unload API soon after/before load instead of unload param, chart will not be rendered properly because of cancel of animation.<br>
   *   - done will be called after data loaded, but it's not after rendering.
   *     It's because rendering will finish after some transition and there is some time lag between loading and rendering
   * @function load
   * @instance
   * @memberof Chart
   * @param {object} args The object can consist with following members:<br>
   *
   *    | Key | Type | Description |
   *    | --- | --- | --- |
   *    | columns | Array | The `columns` data will be loaded. If data that has the same target id is given, the chart will be updated. Otherwise, new target will be added |
   *    | json | Array | The `json` data will be loaded. If data that has the same target id is given, the chart will be updated. Otherwise, new target will be added |
   *    | rows | Array | The `rows` data will be loaded. If data that has the same target id is given, the chart will be updated. Otherwise, new target will be added |
   *    | url | string | The data from `url` will be loaded. If data that has the same target id is given, the chart will be updated. Otherwise, new target will be added |
   *    | &nbsp; | | |
   *    | append | boolean | Load data appending it to the current dataseries.<br>If the existing chart has`x` value, should provide with corresponding `x` value for newly loaded data.  |
   *    | axes | Object | The axes specified by data.axes will be updated. axes must be Object that has target id as keys. |
   *    | categories | Array | The categories specified by axis.x.categories or data.x will be updated. categories must be Array. |
   *    | classes | Object | The classes specified by data.classes will be updated. classes must be Object that has target id as keys. |
   *    | colors | Object | The colors specified by data.colors will be updated. colors must be Object that has target id as keys. |
   *    | data | Object | Data objects to be loaded. Checkout the example. |
   *    | done | Function | The specified function will be called after data loaded.|
   *    | headers | string |  Set request header if loading via `data.url`.<br>@see [data․headers](Options.html#.data%25E2%2580%25A4headers) |
   *    | keys | Object |  Choose which JSON objects keys correspond to desired data.<br>**NOTE:** Only for JSON object given as array.<br>@see [data․keys](Options.html#.data%25E2%2580%25A4keys) |
   *    | mimeType | string |  Set 'json' if loading JSON via url.<br>@see [data․mimeType](Options.html#.data%25E2%2580%25A4mimeType) |
   *    | names | Object | Same as data.names() |
   *    | resizeAfter | boolean | Resize after the load. Default value is `false`.<br>- This option won't call `onresize` neither `onresized`.<br>- When set to 'true', will call `.flush(true)` at the end of load. |
   *    | type | string | The type of targets will be updated. |
   *    | types | Object | The types of targets will be updated. |
   *    | unload | Array | Specify the data will be unloaded before loading new data. If true given, all of data will be unloaded. If target ids given as String or Array, specified targets will be unloaded. If absent or false given, unload will not occur. |
   *    | xs | string | Same as data.xs option  |
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataFromURL)
   * @example
   * // Load data1 and unload data2 and data3
   * chart.load({
   *     columns: [
   *        ["data1", 100, 200, 150, ...],
   *        ...
   *    ],
   *    unload: ["data2", "data3"],
   *    url: "...",
   *    done: function() { ... }
   *    resizeAfter: true  // will resize after load
   * });
   * @example
   * const chart = bb.generate({
   *   data: {
   *     columns: [
   *       ["data1", 20, 30, 40]
   *     ]
   *   }
   * });
   *
   * chart.load({
   *    columns: [
   *        // with 'append' option, the 'data1' will have `[20,30,40,50,60]`.
   *        ["data1", 50, 60]
   *    ],
   *    append: true
   * });
   * @example
   * const chart = bb.generate({
   *   data: {
   *     x: "x",
   *     xFormat: "%Y-%m-%dT%H:%M:%S",
   *     columns: [
   *       ["x", "2021-01-03T03:00:00", "2021-01-04T12:00:00", "2021-01-05T21:00:00"],
   *       ["data1", 36, 30, 24]
   *     ]
   *   },
   *   axis: {
   *     x: {
   *       type: "timeseries"
   *     }
   *   }
   * };
   *
   * chart.load({
   *   columns: [
   *     // when existing chart has `x` value, should provide corresponding 'x' value.
   *     // with 'append' option, the 'data1' will have `[36,30,24,37]`.
   *     ["x", "2021-02-01T08:00:00"],
   *     ["data1", 37]
   *   ],
   *   append: true
   * });
   * @example
   * // myAPI.json
   * // {
   * //   "data1": [220, 240, 270, 250, 280],
   * //   "data2": [180, 150, 300, 70, 120]
   * // }
   *
   * chart.load({
   *     url: './data/myAPI.json',
   *     mimeType: "json",
   *
   *     // set request header if is needed
   *     headers: {
   *       "Content-Type": "text/json"
   *     }
   * });
   * @example
   * chart.load({
   *     data: [
   *       // equivalent as: columns: [["data1", 30, 200, 100]]
   *       {"data1": 30}, {"data1": 200}, {"data1": 100}
   *
   *       // or
   *       // equivalent as: columns: [["data1", 10, 20], ["data2", 13, 30]]
   *       // {"data1": 10, "data2": 13}, {"data1": 20, "data2": 30}}
   *     ]
   * });
   * @example
   * chart.load({
   *     json: [
   *          {name: "www.site1.com", upload: 800, download: 500, total: 400},
   *     ],
   *     keys: {
   *         x: "name",
   *         value: ["upload", "download"]
   *     }
   * });
   * @example
   * chart.load({
   *   json: {
   *       data1:[30, 20, 50, 40, 60, 50],
   *       data2:[200, 130, 90, 240, 130, 220],
   *   }
   * });
   */
  load: function(t) {
    var e = this.internal, n = e.config;
    t.xs && e.addXs(t.xs), "names" in t && this.data.names(t.names), "classes" in t && Object.keys(t.classes).forEach(function(a) {
      n.data_classes[a] = t.classes[a];
    }), "categories" in t && e.axis.isCategorized() && (n.axis_x_categories = t.categories), "axes" in t && Object.keys(t.axes).forEach(function(a) {
      n.data_axes[a] = t.axes[a];
    }), "colors" in t && Object.keys(t.colors).forEach(function(a) {
      n.data_colors[a] = t.colors[a];
    }), "unload" in t && t.unload !== !1 ? e.unload(e.mapToTargetIds(t.unload === !0 ? null : t.unload), function() {
      ol(function() {
        return e.loadFromArgs(t);
      });
    }) : e.loadFromArgs(t);
  },
  /**
   * Unload data to the chart.<br><br>
   * You can specify multiple targets by giving an array that includes id as String. If no argument is given, all of targets will be toggles.
   * - <b>Note:</b>
   * If you call load API soon after/before unload, unload param of load should be used. Otherwise chart will not be rendered properly because of cancel of animation.<br>
   * `done` will be called after data loaded, but it's not after rendering. It's because rendering will finish after some transition and there is some time lag between loading and rendering.
   * @function unload
   * @instance
   * @memberof Chart
   * @param {object} argsValue
   *  | key | Type | Description |
   *  | --- | --- | --- |
   *  | ids | String &vert; Array | Target id data to be unloaded. If not given, all data will be unloaded. |
   *  | done | Function | Callback after data is unloaded. |
   *  | resizeAfter | boolean | Resize after the unload. Default value is `false`.<br>- This option won't call `onresize` neither `onresized`.<br>- When set to 'true', will call `.flush(true)` at the end of unload. |
   * @example
   *  // Unload data2 and data3
   *  chart.unload({
   *    ids: ["data2", "data3"],
   *    done: function() {
   *       // called after the unloaded
   *    },
   *    resizeAfter: true  // will resize after unload
   *  });
   */
  unload: function(t) {
    var e = this.internal, n = t || {};
    qt(n) && this.tooltip.hide(), ft(n) ? n = { ids: n } : lt(n) && (n = { ids: [n] });
    var a = e.mapToTargetIds(n.ids);
    e.unload(a, function() {
      e.redraw({
        withUpdateOrgXDomain: !0,
        withUpdateXDomain: !0,
        withLegend: !0
      }), e.cache.remove(a), Tl.call(e, n.done, n.resizeAfter);
    });
  }
};
function Ro(t, e, n) {
  var a = this, i = this.internal, r = i.mapToTargetIds(e), o = i.state.hiddenTargetIds.map(function(c) {
    return r.indexOf(c) > -1 && c;
  }).filter(Boolean);
  i.state.toggling = !0, i["".concat(t ? "remove" : "add", "HiddenTargetIds")](r);
  var s = i.$el.svg.selectAll(i.selectorTargets(r)), l = t ? null : "0";
  t && o.length && (s.style("display", null), pt(i.config.data_onshown, this, o)), i.$T(s).style("opacity", l, "important").call(wa, function() {
    var c;
    !t && o.length === 0 && (s.style("display", "none"), pt((c = i.config) === null || c === void 0 ? void 0 : c.data_onhidden, a, r)), s.style("opacity", l);
  }), n.withLegend && i["".concat(t ? "show" : "hide", "Legend")](r), i.redraw({
    withUpdateOrgXDomain: !0,
    withUpdateXDomain: !0,
    withLegend: !0
  }), i.state.toggling = !1;
}
var C_ = {
  /**
   * Show data series on chart
   * @function show
   * @instance
   * @memberof Chart
   * @param {string|Array} [targetIdsValue] The target id value.
   * @param {object} [options] The object can consist with following members:<br>
   *
   *    | Key | Type | default | Description |
   *    | --- | --- | --- | --- |
   *    | withLegend | boolean | false | whether or not display legend |
   *
   * @example
   * // show 'data1'
   * chart.show("data1");
   *
   * // show 'data1' and 'data3'
   * chart.show(["data1", "data3"]);
   */
  show: function(t, e) {
    e === void 0 && (e = {}), Ro.call(this, !0, t, e);
  },
  /**
   * Hide data series from chart
   * @function hide
   * @instance
   * @memberof Chart
   * @param {string|Array} [targetIdsValue] The target id value.
   * @param {object} [options] The object can consist with following members:<br>
   *
   *    | Key | Type | default | Description |
   *    | --- | --- | --- | --- |
   *    | withLegend | boolean | false | whether or not display legend |
   *
   * @example
   * // hide 'data1'
   * chart.hide("data1");
   *
   * // hide 'data1' and 'data3'
   * chart.hide(["data1", "data3"]);
   */
  hide: function(t, e) {
    e === void 0 && (e = {}), Ro.call(this, !1, t, e);
  },
  /**
   * Toggle data series on chart. When target data is hidden, it will show. If is shown, it will hide in vice versa.
   * @function toggle
   * @instance
   * @memberof Chart
   * @param {string|Array} [targetIds] The target id value.
   * @param {object} [options] The object can consist with following members:<br>
   *
   *    | Key | Type | default | Description |
   *    | --- | --- | --- | --- |
   *    | withLegend | boolean | false | whether or not display legend |
   *
   * @example
   * // toggle 'data1'
   * chart.toggle("data1");
   *
   * // toggle 'data1' and 'data3'
   * chart.toggle(["data1", "data3"]);
   */
  toggle: function(t, e) {
    var n = this;
    e === void 0 && (e = {});
    var a = this.internal, i = { show: [], hide: [] };
    a.mapToTargetIds(t).forEach(function(r) {
      return i[a.isTargetToShow(r) ? "hide" : "show"].push(r);
    }), i.show.length && this.show(i.show, e), i.hide.length && setTimeout(function() {
      return n.hide(i.hide, e);
    }, 0);
  }
}, R_ = {
  /**
   * Show tooltip
   * @function tooltip․show
   * @instance
   * @memberof Chart
   * @param {object} args The object can consist with following members:<br>
   *
   *    | Key | Type | Description |
   *    | --- | --- | --- |
   *    | index | Number | Determine focus by index |
   *    | x | Number &vert; Date | Determine focus by x Axis index |
   *    | mouse | Array | Determine x and y coordinate value relative the targeted '.bb-event-rect' x Axis.<br>It should be used along with `data`, `index` or `x` value. The default value is set as `[0,0]` |
   *    | data | Object | When [data.xs](Options.html#.data%25E2%2580%25A4xs) option is used or [tooltip.grouped](Options.html#.tooltip) set to 'false', `should be used giving this param`.<br><br>**Key:**<br>- x {number &verbar; Date}: x Axis value<br>- index {number}: x Axis index (useless for data.xs)<br>- id {string}: data id<br>- value {number}: The corresponding value for tooltip. |
   *
   * @example
   *  // show the 2nd x Axis coordinate tooltip
   *  // for Arc(gauge, donut & pie) and radar type, approach showing tooltip by using "index" number.
   *  chart.tooltip.show({
   *    index: 1
   *  });
   *
   *  // show tooltip for the 3rd x Axis in x:50 and y:100 coordinate of '.bb-event-rect' of the x Axis.
   *  chart.tooltip.show({
   *    x: 2,
   *    mouse: [50, 100]
   *  });
   *
   *  // show tooltip for timeseries x axis
   *  chart.tooltip.show({
   *    x: new Date("2018-01-02 00:00")
   *  });
   *
   *  // treemap type can be shown by using "id" only.
   *  chart.tooltip.show({
   *    data: {
   *        id: "data1"  // data id
   *    }
   *  });
   *
   *  // for Arc types, specify 'id' or 'index'
   *  chart.tooltip.show({ data: { id: "data2" }});
   *  chart.tooltip.show({ data: { index: 2 }});
   *
   *  // when data.xs is used
   *  chart.tooltip.show({
   *    data: {
   *        x: 3,  // x Axis value
   *        id: "data1",  // data id
   *        value: 500  // data value
   *    }
   *  });
   *
   *  // when data.xs isn't used, but tooltip.grouped=false is set
   *  chart.tooltip.show({
   *    data: {
   *        index: 3,  // or 'x' key value
   *        id: "data1",  // data id
   *        value: 500  // data value
   *    }
   *  });
   */
  show: function(t) {
    var e, n, a, i = this.internal, r = i.$el, o = i.config, s = i.state, l = s.eventReceiver, c = s.hasFunnel, u = s.hasTreemap, f = s.inputType, h, d;
    if (t.mouse && (d = t.mouse), t.data) {
      var v = t.data, _ = (e = i.getYScaleById(v.id)) === null || e === void 0 ? void 0 : e(v.value);
      if ((c || u) && v.id) {
        var p = i.selectorTarget(v.id, void 0, ".".concat(At.shape));
        l.rect = r.main.select(p);
      } else i.isMultipleX() ? d = [i.xx(v), _] : (o.tooltip_grouped || (d = [0, _]), h = (n = v.index) !== null && n !== void 0 ? n : i.hasArcType() && v.id ? (a = i.getArcElementByIdOrIndex(v.id)) === null || a === void 0 ? void 0 : a.datum().index : i.getIndexByX(v.x));
    } else vt(t.x) ? h = i.getIndexByX(t.x) : vt(t.index) && (h = t.index);
    (f === "mouse" ? ["mouseover", "mousemove"] : ["touchstart"]).forEach(function(g) {
      i.dispatchEvent(g, h, d);
    });
  },
  /**
   * Hide tooltip
   * @function tooltip․hide
   * @instance
   * @memberof Chart
   */
  hide: function() {
    var t, e, n, a = this.internal, i = a.state.inputType, r = a.$el.tooltip, o = r?.datum();
    if (o) {
      var s = JSON.parse(o.current)[0].index;
      (i === "mouse" ? ["mouseout"] : ["touchend"]).forEach(function(l) {
        a.dispatchEvent(l, s);
      });
    }
    i === "touch" && a.callOverOutForTouch(), a.hideTooltip(!0), (t = a.hideGridFocus) === null || t === void 0 || t.call(a), (e = a.unexpandCircles) === null || e === void 0 || e.call(a), (n = a.expandBarTypeShapes) === null || n === void 0 || n.call(a, !1);
  }
}, E_ = { tooltip: R_ }, un = (
  /** @class */
  /* @__PURE__ */ (function() {
    function t(e) {
      this.plugins = [];
      var n = new Ne(this);
      this.internal = n, (function a(i, r, o) {
        Object.keys(i).forEach(function(s) {
          var l = U(i[s]), c = r !== o, u = kt(i[s]), f = u && Object.keys(i[s]).length > 0;
          l && (!c && f || c) ? r[s] = i[s].bind(o) : u && !l ? r[s] = {} : r[s] = i[s], f && a(i[s], r[s], o);
        });
      })(t.prototype, this, this), v_.call(n, e), n.beforeInit(), n.init();
    }
    return t;
  })()
);
Lt(un.prototype, [
  g_,
  p_,
  __,
  $_,
  w_,
  S_,
  k_,
  C_,
  E_
]);
function Eo(t, e, n) {
  var a = t.config, i = function(r, o) {
    var s = q(o) ? o : o === !1 ? void 0 : null;
    s !== null && (a["axis_".concat(r, "_").concat(e)] = s);
  };
  vt(n) && (Ut(n) ? Object.keys(n).forEach(function(r) {
    i(r, n[r]);
  }) : (q(n) || n === !1) && ["y", "y2"].forEach(function(r) {
    i(r, n);
  }), t.redraw({
    withUpdateOrgXDomain: !0,
    withUpdateXDomain: !0
  }));
}
function Mo(t, e) {
  var n = t.config;
  return {
    x: n["axis_x_".concat(e)],
    y: n["axis_y_".concat(e)],
    y2: n["axis_y2_".concat(e)]
  };
}
var M_ = {
  /**
   * Get and set axis labels.
   * - **NOTE:** Only applicable for chart types which has x and y axes.
   * @function axis․labels
   * @instance
   * @memberof Chart
   * @param {object} labels specified axis' label to be updated.
   * @param {string} [labels.x] x Axis string
   * @param {string} [labels.y] y Axis string
   * @param {string} [labels.y2] y2 Axis string
   * @returns {object|undefined} axis labels text object
   * @example
   * // Update axis' label
   * chart.axis.labels({
   *   x: "New X Axis Label",
   *   y: "New Y Axis Label",
   *   y2: "New Y2 Axis Label"
   * });
   *
   * chart.axis.labels();
   * // --> {
   * //  x: "New X Axis Label",
   * //  y: "New Y Axis Label",
   * //  y2: "New Y2 Axis Label"
   * // }
   */
  labels: function(t) {
    var e = this.internal, n;
    return t && (Object.keys(t).forEach(function(a) {
      e.axis.setLabelText(a, t[a]);
    }), e.axis.updateLabels()), ["x", "y", "y2"].forEach(function(a) {
      var i = e.axis.getLabelText(a);
      i && (!n && (n = {}), n[a] = i);
    }), n;
  },
  /**
   * Get and set axis min value.
   * - **NOTE:** Only applicable for chart types which has x and y axes.
   * @function axis․min
   * @instance
   * @memberof Chart
   * @param {object} min If min is given, specified axis' min value will be updated.<br>
   *   If no argument is given, the min values set on generating option for each axis will be returned.
   *   If not set any min values on generation, it will return `undefined`.<br>
   *   To unset specific axis max, set `false` to each of them.
   * @returns {object|undefined}
   * @example
   * // Update axis' min
   * chart.axis.min({
   *   x: -10,
   *   y: 1000,
   *   y2: 100
   * });
   *
   * // To unset specific axis min, set false to each of them.
   * chart.axis.min({
   *   x: false,
   *   y: false,
   *   y2: false
   * });
   *
   * // shorthand (only affects y and y2 axis)
   * chart.axis.min(-50);
   * chart.axis.min(false);
   */
  min: function(t) {
    var e = this.internal;
    return nt(t) || t === !1 ? Eo(e, "min", t) : Mo(e, "min");
  },
  /**
   * Get and set axis max value.
   * - **NOTE:** Only applicable for chart types which has x and y axes.
   * @function axis․max
   * @instance
   * @memberof Chart
   * @param {object} max If max is given, specified axis' max value will be updated.<br>
   *   If no argument is given, the max values set on generating option for each axis will be returned.
   *   If not set any max values on generation, it will return `undefined`.<br>
   *   To unset specific axis max, set `false` to each of them.
   * @returns {object|undefined}
   * @example
   * // Update axis' label
   * chart.axis.max({
   *    x: 100,
   *    y: 1000,
   *    y2: 10000
   * });
   *
   * // To unset specific axis max, set false to each of them.
   * chart.axis.max({
   *   x: false,
   *   y: false,
   *   y2: false
   * });
   *
   * // shorthand (only affects y and y2 axis)
   * chart.axis.max(10);
   * chart.axis.max(false);
   */
  max: function(t) {
    var e = this.internal;
    return nt(t) || t === !1 ? Eo(e, "max", t) : Mo(e, "max");
  },
  /**
   * Get and set axis min and max value.
   * - **NOTE:** Only applicable for chart types which has x and y axes.
   * @function axis․range
   * @instance
   * @memberof Chart
   * @param {object} range If range is given, specified axis' min and max value will be updated.
   *   If no argument is given, the current min and max values for each axis will be returned.<br>
   *   To unset specific axis max, set `false` to each of them.
   * @returns {object|undefined}
   * @example
   * // Update axis' label
   * chart.axis.range({
   *   min: {
   *     x: -10,
   *     y: -1000,
   *     y2: -10000
   *   },
   *   max: {
   *     x: 100,
   *     y: 1000,
   *     y2: 10000
   *   },
   * });
   *
   * // To unset specific axis max, set false to each of them.
   * chart.axis.range({
   *   min: {
   *     x: false,
   *     y: false,
   *     y2: false
   *   },
   *   max: {
   *     x: false,
   *     y: false,
   *     y2: false
   *   },
   * });
   *
   * // shorthand (only affects y and y2 axis)
   * chart.axis.range({ min: -50, max: 1000 });
   * chart.axis.range({ min: false, max: false });
   */
  range: function(t) {
    var e = this.axis;
    if (arguments.length) {
      var n = t.min, a = t.max;
      vt(a) && e.max(a), vt(n) && e.min(n);
    } else
      return {
        max: e.max(),
        min: e.min()
      };
  }
}, L_ = { axis: M_ }, D_ = {
  /**
   * Set specified category name on category axis.
   * @function category
   * @instance
   * @memberof Chart
   * @param {number} i index of category to be changed
   * @param {string} category category value to be changed
   * @returns {string}
   * @example
   * chart.category(2, "Category 3");
   */
  category: function(t, e) {
    var n = this.internal, a = n.config;
    return arguments.length > 1 && (a.axis_x_categories[t] = e, n.redraw()), a.axis_x_categories[t];
  },
  /**
   * Set or get category names on category axis.
   * @function categories
   * @instance
   * @memberof Chart
   * @param {Array} categories This must be an array that includes category names in string. If category names are included in the date by data.x option, this is not required.
   * @returns {Array}
   * @example
   * chart.categories([
   *      "Category 1", "Category 2", ...
   * ]);
   */
  categories: function(t) {
    var e = this.internal, n = e.config;
    if (!t || !Array.isArray(t)) {
      var a = n.axis_x_categories;
      return qt(a) ? Object.values(e.data.xs)[0] : a;
    }
    return n.axis_x_categories = t, e.redraw(), n.axis_x_categories;
  }
}, I_ = {
  /**
   * Flow data to the chart.<br><br>
   * By this API, you can append new data points to the chart.
   * @function flow
   * @instance
   * @memberof Chart
   * @param {object} args The object can consist with following members:<br>
   *
   *    | Key | Type | Description |
   *    | --- | --- | --- |
   *    | json | Object | Data as JSON format (@see [data․json](Options.html#.data%25E2%2580%25A4json)) |
   *    | rows | Array | Data in array as row format (@see [data․rows](Options.html#.data%25E2%2580%25A4json)) |
   *    | columns | Array | Data in array as column format (@see [data․columns](Options.html#.data%25E2%2580%25A4columns)) |
   *    | to | String | The lower x edge will move to that point. If not given, the lower x edge will move by the number of given data points |
   *    | length | Number | The lower x edge will move by the number of this argument |
   *    | duration | Number | The duration of the transition will be specified value. If not given, transition.duration will be used as default |
   *    | done | Function | The specified function will be called when flow ends |
   *
   * - **NOTE:**
   *   - If json, rows and columns given, the data will be loaded.
   *   - If data that has the same target id is given, the chart will be appended.
   *   - Otherwise, new target will be added. One of these is required when calling.
   *   - If json specified, keys is required as well as data.json.
   * 	 - If tab isn't visible(by evaluating `document.hidden`), will not be executed to prevent unnecessary work.
   * @example
   * // 2 data points will be appended to the tail and popped from the head.
   * // After that, 4 data points will be appended and no data points will be poppoed.
   * chart.flow({
   *  columns: [
   *    ["x", "2018-01-11", "2018-01-21"],
   *    ["data1", 500, 200],
   *    ["data2", 100, 300],
   *    ["data3", 200, 120]
   *  ],
   *  to: "2013-01-11",
   *  done: function () {
   *    chart.flow({
   *      columns: [
   *        ["x", "2018-02-11", "2018-02-12", "2018-02-13", "2018-02-14"],
   *        ["data1", 200, 300, 100, 250],
   *        ["data2", 100, 90, 40, 120],
   *        ["data3", 100, 100, 300, 500]
   *      ],
   *      length: 2,
   *      duration: 1500
   *    });
   *  }
   * });
   */
  flow: function(t) {
    var e = this.internal, n;
    (t.json || t.rows || t.columns) && e.convertData(t, function(i) {
      n = i, a();
    });
    function a() {
      var i, r = 0, o = 0, s, l;
      if (!(e.state.redrawing || !n || !Nn())) {
        var c = [], u = e.getMaxDataCount(), f = e.convertDataToTargets(n, !0), h = e.axis.isTimeSeries();
        e.data.targets.forEach(function(_) {
          for (var p = !1, g = 0; g < f.length; g++)
            if (_.id === f[g].id) {
              p = !0, _.values[_.values.length - 1] && (o = _.values[_.values.length - 1].index + 1), r = f[g].values.length;
              for (var x = 0; x < r; x++)
                f[g].values[x].index = o + x, h || (f[g].values[x].x = o + x);
              _.values = _.values.concat(f[g].values), f.splice(g, 1);
              break;
            }
          !p && c.push(_.id);
        }), e.data.targets.forEach(function(_) {
          for (var p = 0; p < c.length; p++)
            if (_.id === c[p]) {
              o = _.values[_.values.length - 1].index + 1;
              for (var g = 0; g < r; g++)
                _.values.push({
                  id: _.id,
                  index: o + g,
                  x: h ? e.getOtherTargetX(o + g) : o + g,
                  value: null
                });
            }
        }), e.data.targets.length && f.forEach(function(_) {
          for (var p = [], g = e.data.targets[0].values[0].index; g < o; g++)
            p.push({
              id: _.id,
              index: g,
              x: h ? e.getOtherTargetX(g) : g,
              value: null
            });
          _.values.forEach(function(x) {
            x.index += o, h || (x.x += o);
          }), _.values = p.concat(_.values);
        }), e.data.targets = e.data.targets.concat(f);
        var d = e.data.targets[0], v = d.values[0];
        vt(t.to) ? (r = 0, l = h ? jt.call(e, t.to) : t.to, d.values.forEach(function(_) {
          _.x < l && r++;
        })) : vt(t.length) && (r = t.length), u ? u === 1 && h && (s = (d.values[d.values.length - 1].x - v.x) / 2, i = [new Date(+v.x - s), new Date(+v.x + s)]) : (h ? s = d.values.length > 1 ? d.values[d.values.length - 1].x - v.x : v.x - e.getXDomain(e.data.targets)[0] : s = 1, i = [v.x - s, v.x]), i && e.updateXDomain(null, !0, !0, !1, i), e.updateTargets(e.data.targets), e.redraw({
          flow: {
            index: v.index,
            length: r,
            duration: nt(t.duration) ? t.duration : e.config.transition_duration,
            done: t.done,
            orgDataCount: u
          },
          withLegend: !0,
          withTransition: u > 1,
          withTrimXDomain: !1,
          withUpdateXAxis: !0
        });
      }
    }
  }
};
function gr(t, e) {
  var n = this.internal, a = n.config, i = a.transition_duration && Nn(), r = "grid_".concat(e, "_lines");
  return t && (a[r] = t, n.updateGrid(), n.redrawGrid(i)), a[r];
}
function Sl(t, e) {
  var n = "grid_".concat(e, "_lines");
  return gr.bind(this)(this.internal.config[n].concat(t || []), e);
}
function kl(t, e) {
  this.internal.removeGridLines(t, e);
}
var Cl = function(t) {
  return gr.bind(this)(t, "x");
};
Lt(Cl, {
  /**
   * Add x grid lines.<br>
   * This API adds new x grid lines instead of replacing like xgrids.
   * @function xgrids․add
   * @instance
   * @memberof Chart
   * @param {Array|object} grids New x grid lines will be added. The format of this argument is the same as grid.x.lines and it's possible to give an Object if only one line will be added.
   * @returns {Array}
   * @example
   *  // Add a new x grid line
   * chart.xgrids.add(
   *   {value: 4, text: "Label 4"}
   * );
   *
   * // Add new x grid lines
   * chart.xgrids.add([
   *   {value: 2, text: "Label 2"},
   *   {value: 4, text: "Label 4"}
   * ]);
   */
  add: function(t) {
    return Sl.bind(this)(t, "x");
  },
  /**
   * Remove x grid lines.<br>
   * This API removes x grid lines.
   * @function xgrids․remove
   * @instance
   * @memberof Chart
   * @param {object} grids This argument should include value or class. If value is given, the x grid lines that have specified x value will be removed. If class is given, the x grid lines that have specified class will be removed. If args is not given, all of x grid lines will be removed.
   * @param {number} [grids.value] target value
   * @param {string} [grids.class] target class
   * @returns {void}
   * @example
   * // x grid line on x = 2 will be removed
   * chart.xgrids.remove({value: 2});
   *
   * // x grid lines that have 'grid-A' will be removed
   * chart.xgrids.remove({
   *   class: "grid-A"
   * });
   *
   * // all of x grid lines will be removed
   * chart.xgrids.remove();
   */
  remove: function(t) {
    return kl.bind(this)(t, !0);
  }
});
var Rl = function(t) {
  return gr.bind(this)(t, "y");
};
Lt(Rl, {
  /**
   * Add y grid lines.<br>
   * This API adds new y grid lines instead of replacing like ygrids.
   * @function ygrids․add
   * @instance
   * @memberof Chart
   * @param {Array|object} grids New y grid lines will be added. The format of this argument is the same as grid.y.lines and it's possible to give an Object if only one line will be added.
   * @returns {object}
   * @example
   *  // Add a new x grid line
   * chart.ygrids.add(
   *   {value: 400, text: "Label 4"}
   * );
   *
   * // Add new x grid lines
   * chart.ygrids.add([
   *   {value: 200, text: "Label 2"},
   *   {value: 400, text: "Label 4"}
   * ]);
   */
  add: function(t) {
    return Sl.bind(this)(t, "y");
  },
  /**
   * Remove y grid lines.<br>
   * This API removes x grid lines.
   * @function ygrids․remove
   * @instance
   * @memberof Chart
   * @param {object} grids This argument should include value or class. If value is given, the y grid lines that have specified y value will be removed. If class is given, the y grid lines that have specified class will be removed. If args is not given, all of y grid lines will be removed.
   * @param {number} [grids.value] target value
   * @param {string} [grids.class] target class
   * @returns {void}
   * @example
   * // y grid line on y = 200 will be removed
   * chart.ygrids.remove({value: 200});
   *
   * // y grid lines that have 'grid-A' will be removed
   * chart.ygrids.remove({
   *   class: "grid-A"
   * });
   *
   * // all of y grid lines will be removed
   * chart.ygrids.remove();
   */
  remove: function(t) {
    return kl.bind(this)(t, !1);
  }
});
var z_ = { xgrids: Cl, ygrids: Rl }, P_ = {
  /**
   * Update groups for the targets.
   * @function groups
   * @instance
   * @memberof Chart
   * @param {Array} groups This argument needs to be an Array that includes one or more Array that includes target ids to be grouped.
   * @returns {Array} Grouped data names array
   * @example
   *  // data1 and data2 will be a new group.
   *  chart.groups([
   *     ["data1", "data2"]
   *  ]);
   */
  groups: function(t) {
    var e = this.internal, n = e.config;
    return St(t) || (n.data_groups = t, e.redraw()), n.data_groups;
  }
};
function El(t, e) {
  e === void 0 && (e = !1);
  var n = this.internal, a = n.config, i = a.transition_duration && Nn();
  return t ? (a.regions = e ? a.regions.concat(t) : t, n.updateRegion(), n.redrawRegion(i), e ? a.regions : t) : a.regions;
}
var Ml = function(t) {
  return El.bind(this)(t);
};
Lt(Ml, {
  /**
   * Add new region.<br><br>
   * This API adds new region instead of replacing like regions.
   * @function regions․add
   * @instance
   * @memberof Chart
   * @param {Array|object} regions New region will be added. The format of this argument is the same as [regions](./Options.html#.regions) and it's possible to give an Object if only one region will be added.
   * @returns {Array} regions
   * @example
   * // Add a new region
   * chart.regions.add(
   *    {
   *      axis: "x", start: 5, class: "regionX",
   *      label: {
   *      	text: "Region Text",
   *      	color: "red"  // color string
   *      }
   *    }
   * );
   *
   * // Add new regions
   * chart.regions.add([
   *    {axis: "x", start: 5, class: "regionX"},
   *    {
   *      axis: "y", end: 50, class: "regionY",
   *      label: {
   *      	text: "Region Text",
   *      	x: 5,  // position relative of the initial x coordinate
   *      	y: 5,  // position relative of the initial y coordinate
   *      	color: "red",  // color string
   *      	rotated: true  // make text to show in vertical or horizontal
   *      }
   *    }
   * ]);
   */
  add: function(t) {
    return El.bind(this)(t, !0);
  },
  /**
   * Remove regions.<br><br>
   * This API removes regions.
   * @function regions․remove
   * @instance
   * @memberof Chart
   * @param {object} optionsValue This argument should include classes. If classes is given, the regions that have one of the specified classes will be removed. If args is not given, all of regions will be removed.
   * @returns {Array} regions Removed regions
   * @example
   * // regions that have 'region-A' or 'region-B' will be removed.
   * chart.regions.remove({
   *   classes: [
   *     "region-A", "region-B"
   *   ]
   * });
   *
   * // all of regions will be removed.
   * chart.regions.remove();
   */
  remove: function(t) {
    var e = this.internal, n = e.config, a = e.$T, i = t || {}, r = Te(i, "classes", [In.region]), o = e.$el.main.select(".".concat(In.regions)).selectAll(r.map(function(s) {
      return ".".concat(s);
    }));
    return a(o).style("opacity", "0").remove(), o = n.regions, Object.keys(i).length ? (o = o.filter(function(s) {
      var l = !1;
      return s.class ? (s.class.split(" ").forEach(function(c) {
        r.indexOf(c) >= 0 && (l = !0);
      }), !l) : !0;
    }), n.regions = o) : n.regions = [], o;
  }
});
var O_ = { regions: Ml }, F_ = {
  /**
   * Get and set x values for the chart.
   * @function x
   * @instance
   * @memberof Chart
   * @param {Array} x If x is given, x values of every target will be updated. If no argument is given, current x values will be returned as an Object whose keys are the target ids.
   * @returns {object} xs
   * @example
   *  // Get current x values
   *  chart.x();
   *
   *  // Update x values for all targets
   *  chart.x([100, 200, 300, 400, ...]);
   */
  x: function(t) {
    var e = this.internal, n = e.axis, a = e.data, i = n.isCustomX() && n.isCategorized();
    return ft(t) && (i ? this.categories(t) : (e.updateTargetX(a.targets, t), e.redraw({
      withUpdateOrgXDomain: !0,
      withUpdateXDomain: !0
    }))), i ? this.categories() : a.xs;
  },
  /**
   * Get and set x values for the chart.
   * @function xs
   * @instance
   * @memberof Chart
   * @param {Array} xs If xs is given, specified target's x values will be updated. If no argument is given, current x values will be returned as an Object whose keys are the target ids.
   * @returns {object} xs
   * @example
   *  // Get current x values
   *  chart.xs();
   *
   *  // Update x values for all targets
   *  chart.xs({
   *    data1: [10, 20, 30, 40, ...],
   *    data2: [100, 200, 300, 400, ...]
   *  });
   */
  xs: function(t) {
    var e = this.internal;
    return ct(t) && (e.updateTargetXs(e.data.targets, t), e.redraw({
      withUpdateOrgXDomain: !0,
      withUpdateXDomain: !0
    })), e.data.xs;
  }
}, N_ = (
  /** @class */
  (function() {
    function t(e) {
      this.charSize = {};
      var n = ze(), a = e.config, i = e.params;
      this.owner = e, this.config = a, this.scale = n, (a.noTransition || !i.config.transition_duration) && (a.withoutTransition = !0), a.range = this.scaleExtent((i.orgXScale || n).range());
    }
    return t.prototype.getSizeFor1Char = function(e, n, a) {
      a === void 0 && (a = !0);
      var i = {
        w: 5.5,
        h: 11.5
      };
      return this.charSize[e] && a ? this.charSize[e] : (!n.empty() && n.text("0").call(function(r) {
        try {
          var o = we(r.node(), !0), s = o.width, l = o.height;
          s && l && (i.w = s, i.h = l);
        } finally {
          r.text("");
        }
      }), this.charSize[e] = i, i);
    }, t.prototype.getTickTransformSetter = function(e) {
      var n = this.config, a = e === "x" ? function(i) {
        return "translate(".concat(i + n.tickOffset, ",0)");
      } : function(i) {
        return "translate(0,".concat(i, ")");
      };
      return function(i, r) {
        i.attr("transform", function(o) {
          var s = r(o);
          return nt(o) ? a(s) : null;
        });
      };
    }, t.prototype.scaleExtent = function(e) {
      var n = e[0], a = e[e.length - 1];
      return n < a ? [n, a] : [a, n];
    }, t.prototype.generateTicks = function(e, n) {
      var a = this.owner.params.tickStepSize, i = e.domain(), r = i[0], o = i[1], s = [];
      if (n && a)
        for (var l = Math.round(r); l <= o; )
          s.push(l), l += a;
      else if (e.ticks) {
        var c = this.config.tickArguments;
        if (e.type === "log" && !c) {
          var u = ze("_log").domain([r > 0 ? r : 1, o]).range(e.range());
          s = u.ticks();
          for (var f = o.toFixed().length; s.length > 15; f--)
            s = u.ticks(f);
          s.splice(0, 1, r), s.splice(s.length - 1, 1, o);
        } else
          s = e.ticks.apply(e, this.config.tickArguments || []);
        s = s.map(function(h) {
          var d = lt(h) && q(h) && !isNaN(h) && Math.round(h * 10) / 10 || h;
          return d;
        });
      }
      return s;
    }, t.prototype.copyScale = function() {
      var e = this.scale.copy();
      return e.domain().length || e.domain(this.scale.domain()), e.type = this.scale.type, e;
    }, t.prototype.textFormatted = function(e) {
      var n = this.config.tickFormat, a = /\d+\.\d+0{5,}\d$/.test(e) ? +String(e).replace(/0+\d$/, "") : e, i = n ? n(a) : a;
      return vt(i) ? i : "";
    }, t.prototype.transitionise = function(e) {
      var n = this.config, a = e;
      if (n.withoutTransition)
        a = e.interrupt();
      else if (n.transition || !this.owner.params.noTransition)
        try {
          a = e.transition(n.transition);
        } catch {
        }
      return a;
    }, t;
  })()
), B_ = (
  /** @class */
  (function() {
    function t(e) {
      e === void 0 && (e = {});
      var n = {
        innerTickSize: 6,
        outerTickSize: e.outerTick ? 6 : 0,
        orient: "bottom",
        range: [],
        tickArguments: null,
        tickCentered: null,
        tickCulling: !0,
        tickFormat: null,
        tickLength: 9,
        tickOffset: 0,
        tickPadding: 3,
        tickValues: null,
        transition: null,
        noTransition: e.noTransition
      };
      n.tickLength = Math.max(n.innerTickSize, 0) + n.tickPadding, this.config = n, this.params = e, this.helper = new N_(this);
    }
    return t.prototype.create = function(e) {
      var n = this, a = n.config, i = n.helper, r = n.params, o = i.scale, s = a.orient, l = this.splitTickText.bind(n), c = /^(left|right)$/.test(s), u = /^(top|bottom)$/.test(s), f = i.getTickTransformSetter(u ? "x" : "y"), h = f === i.axisX ? "y" : "x", d = /^(top|left)$/.test(s) ? -1 : 1, v = r.tickTextRotate;
      this.config.range = o.rangeExtent ? o.rangeExtent() : i.scaleExtent((r.orgXScale || o).range());
      var _ = a.innerTickSize, p = a.tickLength, g = a.range, x = r.id, y = x && /^(x|y|y2)$/.test(x) ? r.config["axis_".concat(x, "_tick_text_position")] : { x: 0, y: 0 }, m = x === "subX" ? "subchart_axis_x" : "axis_".concat(x), T = r.config["".concat(m, "_show")], b = {
        tick: T ? r.config["".concat(m, "_tick_show")] : !1,
        text: T ? r.config["".concat(m, "_tick_text_show")] : !1
      }, w = r.config.axis_evalTextSize, A;
      e.each(function() {
        var k = N(this), C = this.__chart__ || o, E = i.copyScale();
        A = k, this.__chart__ = E, a.tickOffset = r.isCategory ? (E(1) - E(0)) / 2 : 0;
        var M = k.selectAll(".domain").data([0]);
        if (M.enter().append("path").attr("class", "domain").merge(M).attr("d", function() {
          var B = a.outerTickSize * d;
          return u ? "M".concat(g[0], ",").concat(B, "V0H").concat(g[1], "V").concat(B) : "M".concat(B, ",").concat(g[0], "H0V").concat(g[1], "H").concat(B);
        }), b.tick || b.text) {
          var L = a.tickValues || i.generateTicks(E, c || r.config.axis_rotated);
          n.generatedTicks = L;
          var $ = k.selectAll(".tick").data(L, E), D = $.enter().insert("g", ".domain").attr("class", "tick"), S = $.exit().remove();
          $ = D.merge($), b.tick && D.append("line"), b.text && D.append("text");
          var R = $.select("text"), z = [], P = { w: 0, h: 0 };
          U(w) && (P = w.bind(n.params.owner.api)(R.node(), x), this.classList.contains(j.dummy) && (this.sizeFor1Char = P)), (!P || P.w === 0 || P.h === 0) && (P = n.helper.getSizeFor1Char(s, R, !!w));
          var O = R.selectAll("tspan").data(function(B, W) {
            var J = r.tickMultiline ? l(B, E, L, c, P.w) : ft(i.textFormatted(B)) ? i.textFormatted(B).concat() : [i.textFormatted(B)];
            return z[W] = J.length, J.map(function(F) {
              return { index: W, splitted: F };
            });
          });
          O.exit().remove(), O = O.enter().append("tspan").merge(O).text(function(B) {
            return B.splitted;
          }), O.attr("x", u ? 0 : p * d).attr("dx", (function() {
            var B = 0;
            return /(top|bottom)/.test(s) && v && (B = 8 * Math.sin(Math.PI * (v / 180)) * (s === "top" ? -1 : 1)), B + (y.x || 0);
          })()).attr("dy", function(B, W) {
            var J = ".71em", F = 0;
            return s !== "top" && (F = P.h, W === 0 && (F = c ? -((z[B.index] - 1) * (P.h / 2) - 3) : y.y === 0 ? J : 0)), q(F) && y.y ? F + y.y : F || J;
          });
          var X = $.select("line"), G = $.select("text");
          if (D.select("line").attr("".concat(h, "2"), _ * d), D.select("text").attr(h, p * d), n.setTickLineTextPosition(X, G, P), r.tickTitle) {
            var ht = G.select("title");
            (ht.empty() ? G.append("title") : ht).text(function(B) {
              return r.tickTitle[B];
            });
          }
          if (E.bandwidth) {
            var et = E, Q = et.bandwidth() / 2;
            C = function(B) {
              return et(B) + Q;
            }, E = C;
          } else C.bandwidth ? C = E : f(S, E);
          $ = r.owner.state.flowing ? i.transitionise($) : r.owner.$T($), f(D, C), f($.style("opacity", null), E);
        }
      }), this.g = A;
    }, t.prototype.getGeneratedTicks = function(e) {
      var n, a = ((n = this.generatedTicks) === null || n === void 0 ? void 0 : n.length) - 1, i = this.generatedTicks;
      if (a > e) {
        var r = Math.round(a / e + 0.1);
        i = this.generatedTicks.map(function(o, s) {
          return s % r === 0 ? o : null;
        }).filter(function(o) {
          return o !== null;
        }).splice(0, e);
      }
      return i;
    }, t.prototype.getTickXY = function() {
      var e = this.config, n = { x: 0, y: 0 };
      return this.params.isCategory && (n.x = e.tickCentered ? 0 : e.tickOffset, n.y = e.tickCentered ? e.tickOffset : 0), n;
    }, t.prototype.getTickSize = function(e) {
      var n = this.helper.scale, a = this.config, i = a.innerTickSize, r = a.range, o = n(e) + (a.tickCentered ? 0 : a.tickOffset);
      return r[0] < o && o < r[1] ? i : 0;
    }, t.prototype.setTickLineTextPosition = function(e, n, a) {
      var i = this, r = this.getTickXY(), o = this.config, s = o.innerTickSize, l = o.orient, c = o.tickLength, u = o.tickOffset, f = this.params.id, h = this.params.tickTextRotate, d = 6, v = a.h / 2 - d, _ = function(b) {
        var w = ["start", "end"];
        return l === "top" && w.reverse(), b ? w[b > 0 ? 0 : 1] : "middle";
      }, p = function(b) {
        return b ? "rotate(".concat(b, ")") : null;
      }, g = function(b) {
        var w = b / (l === "bottom" ? 15 : 23), A = b ? 11.5 - 2.5 * w * (b > 0 ? 1 : -1) : c;
        return A;
      }, x = this.params.owner.config, y = x.axis_rotated, m = x.axis_x_tick_text_inner, T = this.params.config["axis_".concat(f, "_tick_inner")];
      switch (l) {
        case "bottom":
          e.attr("x1", r.x).attr("x2", r.x).attr("y2", function(b) {
            return i.getTickSize.bind(i)(b) * (T ? -1 : 1);
          }), n.attr("x", 0).attr("y", g(h)).style("text-anchor", _(h)).style("text-anchor", function(b, w, A) {
            var k = A.length;
            return !y && w === 0 && (m === !0 || m.first) ? "start" : !y && w === k - 1 && (m === !0 || m.last) ? "end" : _(h);
          }).attr("transform", p(h));
          break;
        case "top":
          e.attr("x2", 0).attr("y2", T ? s : -s), n.attr("x", 0).attr("y", -(g(h) + v + d)).style("text-anchor", _(h)).attr("transform", p(h));
          break;
        case "left":
          e.attr("x2", T ? s : -s).attr("y1", r.y).attr("y2", r.y), n.attr("x", -c).attr("y", u + (y ? v / 4 : v)).style("text-anchor", "end");
          break;
        case "right":
          e.attr("x2", T ? -s : s).attr("y2", 0), n.attr("x", c).attr("y", v).style("text-anchor", "start");
      }
    }, t.prototype.splitTickText = function(e, n, a, i, r) {
      var o = this.params, s = this.helper.textFormatted(e), l = lt(s) && s.indexOf(`
`) > -1 ? s.split(`
`) : [];
      if (l.length)
        return l;
      if (ft(s))
        return s;
      var c = o.tickWidth;
      (!c || c <= 0) && (c = i ? 95 : o.isCategory ? (o.isInverted ? n(a[0]) - n(a[1]) : n(a[1]) - n(a[0])) - 12 : 110);
      function u(f, h) {
        for (var d, v, _, p = 1; p < h.length; p++)
          if (h.charAt(p) === " " && (v = p), d = h.substr(0, p + 1), _ = r * d.length, c < _)
            return u(f.concat(h.substr(0, v || p)), h.slice(v ? v + 1 : p));
        return f.concat(h);
      }
      return u(l, String(s));
    }, t.prototype.scale = function(e) {
      return arguments.length ? (this.helper.scale = e, this) : this.helper.scale;
    }, t.prototype.orient = function(e) {
      return arguments.length ? (this.config.orient = e in {
        top: 1,
        right: 1,
        bottom: 1,
        left: 1
      } ? String(e) : "bottom", this) : this.config.orient;
    }, t.prototype.tickFormat = function(e) {
      var n = this.config;
      return arguments.length ? (n.tickFormat = e, this) : n.tickFormat;
    }, t.prototype.tickCentered = function(e) {
      var n = this.config;
      return arguments.length ? (n.tickCentered = e, this) : n.tickCentered;
    }, t.prototype.tickOffset = function() {
      return this.config.tickOffset;
    }, t.prototype.tickInterval = function(e) {
      var n, a = this.config, i = a.outerTickSize, r = a.tickOffset, o = a.tickValues, s;
      if (this.params.isCategory)
        s = r * 2;
      else {
        var l = (n = this.params.owner.scale.zoom) !== null && n !== void 0 ? n : this.helper.scale, c = this.g.select("path.domain").node().getTotalLength() - i * 2;
        s = c / (e || this.g.selectAll("line").size());
        var u = o ? o.map(function(f, h, d) {
          var v = h + 1;
          return v < d.length ? l(d[v]) - l(f) : null;
        }).filter(Boolean) : [];
        s = Math.min.apply(Math, wt(wt([], u, !1), [s], !1));
      }
      return s === 1 / 0 ? 0 : s;
    }, t.prototype.ticks = function() {
      for (var e = [], n = 0; n < arguments.length; n++)
        e[n] = arguments[n];
      var a = this.config;
      return e.length ? (a.tickArguments = Ie(e), this) : a.tickArguments;
    }, t.prototype.tickCulling = function(e) {
      var n = this.config;
      return arguments.length ? (n.tickCulling = e, this) : n.tickCulling;
    }, t.prototype.tickValues = function(e) {
      var n = this, a = this.config;
      if (U(e))
        a.tickValues = function() {
          return e(n.helper.scale.domain());
        };
      else {
        if (!arguments.length)
          return a.tickValues;
        a.tickValues = e;
      }
      return this;
    }, t.prototype.setTransition = function(e) {
      return this.config.transition = e, this;
    }, t;
  })()
), X_ = {
  getAxisInstance: function() {
    return this.axis || new G_(this);
  }
}, G_ = (
  /** @class */
  (function() {
    function t(e) {
      this.axesList = {}, this.tick = {
        x: null,
        y: null,
        y2: null
      }, this.xs = [], this.orient = {
        x: "bottom",
        y: "left",
        y2: "right",
        subX: "bottom"
      }, this.owner = e, this.setOrient();
    }
    return t.prototype.getAxisClassName = function(e) {
      return "".concat(Rt.axis, " ").concat(Rt["axis".concat(Nt(e))]);
    }, t.prototype.isHorizontal = function(e, n) {
      var a = e.config.axis_rotated;
      return n ? a : !a;
    }, t.prototype.isCategorized = function() {
      var e = this.owner, n = e.config, a = e.state;
      return n.axis_x_type.indexOf("category") >= 0 || a.hasRadar;
    }, t.prototype.isCustomX = function() {
      var e = this.owner.config;
      return !this.isTimeSeries() && (e.data_x || kt(e.data_xs));
    }, t.prototype.isTimeSeries = function(e) {
      return e === void 0 && (e = "x"), this.owner.config["axis_".concat(e, "_type")] === "timeseries";
    }, t.prototype.isLog = function(e) {
      return e === void 0 && (e = "x"), this.owner.config["axis_".concat(e, "_type")] === "log";
    }, t.prototype.isTimeSeriesY = function() {
      return this.isTimeSeries("y");
    }, t.prototype.getAxisType = function(e) {
      e === void 0 && (e = "x");
      var n = "linear";
      return this.isTimeSeries(e) ? n = this.owner.config.axis_x_localtime ? "time" : "utc" : this.isLog(e) && (n = "log"), n;
    }, t.prototype.getExtent = function() {
      var e = this.owner, n = e.config, a = e.scale, i = n.axis_x_extent;
      if (i) {
        if (U(i))
          i = i.bind(e.api)(e.getXDomain(e.data.targets), a.subX);
        else if (this.isTimeSeries() && i.every(isNaN)) {
          var r = jt.bind(e);
          i = i.map(function(o) {
            return a.subX(r(o));
          });
        }
      }
      return i;
    }, t.prototype.init = function() {
      var e = this, n = this.owner, a = n.config, i = n.$el, r = i.main, o = i.axis, s = n.state.clip, l = ["x", "y"];
      a.axis_y2_show && l.push("y2"), l.forEach(function(c) {
        var u = e.getAxisClassName(c);
        o[c] = r.append("g").attr("class", u).attr("clip-path", function() {
          var f = null;
          return c === "x" ? f = s.pathXAxis : c === "y" && (f = s.pathYAxis), f;
        }).attr("transform", n.getTranslate(c)).style("visibility", a["axis_".concat(c, "_show")] ? null : "hidden"), e.generateAxes(c);
      });
    }, t.prototype.setOrient = function() {
      var e = this.owner, n = e.config, a = n.axis_rotated, i = n.axis_y_inner, r = n.axis_y2_inner;
      this.orient = {
        x: a ? "left" : "bottom",
        y: a ? i ? "top" : "bottom" : i ? "right" : "left",
        y2: a ? r ? "bottom" : "top" : r ? "left" : "right",
        subX: a ? "left" : "bottom"
      };
    }, t.prototype.generateAxes = function(e) {
      var n = this.owner, a = n.config, i = [], r = a["axis_".concat(e, "_axes")], o = a.axis_rotated, s;
      e === "x" ? s = o ? po : go : e === "y" ? s = o ? go : po : e === "y2" && (s = o ? sg : lg), r.length && r.forEach(function(l) {
        var c = l.tick || {}, u = n.scale[e].copy();
        l.domain && u.domain(l.domain), i.push(s(u).ticks(c.count).tickFormat(U(c.format) ? c.format.bind(n.api) : (function(f) {
          return f;
        })).tickValues(c.values).tickSizeOuter(c.outer === !1 ? 0 : 6));
      }), this.axesList[e] = i;
    }, t.prototype.updateAxes = function() {
      var e = this, n = this.owner, a = n.config, i = n.$el.main, r = n.$T;
      Object.keys(this.axesList).forEach(function(o) {
        var s = a["axis_".concat(o, "_axes")], l = n.scale[o].copy(), c = l.range();
        e.axesList[o].forEach(function(u, f) {
          var h = u.scale().range();
          c.every(function(_, p) {
            return _ === h[p];
          }) || u.scale().range(c);
          var d = "".concat(e.getAxisClassName(o), "-").concat(f + 1), v = i.select(".".concat(d.replace(/\s/, ".")));
          v.empty() ? v = i.append("g").attr("class", d).style("visibility", a["axis_".concat(o, "_show")] ? null : "hidden").call(u) : (s[f].domain && l.domain(s[f].domain), r(v).call(u.scale(l))), v.attr("transform", n.getTranslate(o, f + 1));
        });
      });
    }, t.prototype.setAxis = function(e, n, a, i) {
      var r = this.owner;
      e !== "subX" && (this.tick[e] = this.getTickValues(e)), this[e] = this.getAxis(
        e,
        n,
        a,
        // do not transit x Axis on zoom and resizing
        // https://github.com/naver/billboard.js/issues/1949
        e === "x" && (r.scale.zoom || r.config.subchart_show || r.state.resizing) ? !0 : i
      );
    }, t.prototype.getAxis = function(e, n, a, i, r) {
      var o = this.owner, s = o.config, l = /^(x|subX)$/.test(e), c = l ? "x" : e, u = l && this.isCategorized(), f = this.orient[e], h = r ? 0 : o.getAxisTickRotate(c), d;
      if (l)
        d = e === "subX" ? o.format.subXAxisTick : o.format.xAxisTick;
      else {
        var v = s["axis_".concat(e, "_tick_format")];
        U(v) && (d = v.bind(o.api));
      }
      var _ = this.tick[c], p = rn({
        outerTick: a,
        noTransition: i,
        config: s,
        id: e,
        tickTextRotate: h,
        owner: o
      }, l && {
        isCategory: u,
        isInverted: s.axis_x_inverted,
        tickMultiline: s.axis_x_tick_multiline,
        tickWidth: s.axis_x_tick_width,
        tickTitle: u && s.axis_x_tick_tooltip && o.api.categories(),
        orgXScale: o.scale.x
      });
      l || (p.tickStepSize = s["axis_".concat(c, "_tick_stepSize")]);
      var g = new B_(p).scale(l && o.scale.zoom || n).orient(f);
      if (l && this.isTimeSeries() && _ && !U(_)) {
        var x = jt.bind(o);
        _ = _.map(function(m) {
          return x(m);
        });
      } else !l && this.isTimeSeriesY() && (g.ticks(s.axis_y_tick_time_value), _ = null);
      _ && g.tickValues(_), g.tickFormat(d || !l && o.isStackNormalized() && o.hasAxisGroupedData(e) && (function(m) {
        return "".concat(m, "%");
      })), u && (g.tickCentered(s.axis_x_tick_centered), qt(s.axis_x_tick_culling) && (s.axis_x_tick_culling = !1));
      var y = s["axis_".concat(c, "_tick_count")];
      return y && g.ticks(y), g;
    }, t.prototype.updateXAxisTickValues = function(e, n) {
      var a, i = this.owner, r = i.config, o = r.axis_x_tick_fit, s = r.axis_x_tick_count, l;
      return (o || s && o) && (l = i.mapTargetsToUniqueXs(e), this.isCategorized() && s > l.length && (s = l.length), l = this.generateTickValues(l, s, this.isTimeSeries())), n ? n.tickValues(l) : this.x && (this.x.tickValues(l), (a = this.subX) === null || a === void 0 || a.tickValues(l)), l;
    }, t.prototype.getId = function(e) {
      var n = this.owner, a = n.config, i = n.scale, r = a.data_axes[e];
      return (!r || !i[r]) && (r = "y"), r;
    }, t.prototype.getXAxisTickFormat = function(e) {
      var n = this.owner, a = n.config, i = n.format, r = e && a.subchart_axis_x_tick_format || a.axis_x_tick_format, o = this.isTimeSeries(), s = this.isCategorized(), l;
      return r ? U(r) ? l = r.bind(n.api) : o && (l = function(c) {
        return c ? i.axisTime(r)(c) : "";
      }) : l = o ? i.defaultAxisTime : s ? n.categoryName : function(c) {
        return c < 0 ? c.toFixed(0) : c;
      }, U(l) ? function(c) {
        return l.apply(n, s ? [c, n.categoryName(c)] : [c]);
      } : l;
    }, t.prototype.getTickValues = function(e) {
      var n = this.owner, a = n.config["axis_".concat(e, "_tick_values")], i = n["".concat(e, "Axis")];
      return (U(a) ? a.call(n.api) : a) || (i ? i.tickValues() : void 0);
    }, t.prototype.getLabelOptionByAxisId = function(e) {
      return this.owner.config["axis_".concat(e, "_label")];
    }, t.prototype.getLabelText = function(e) {
      var n = this.getLabelOptionByAxisId(e);
      return lt(n) ? n : n ? n.text : null;
    }, t.prototype.setLabelText = function(e, n) {
      var a = this.owner, i = a.config, r = this.getLabelOptionByAxisId(e);
      lt(r) ? i["axis_".concat(e, "_label")] = n : r && (r.text = n);
    }, t.prototype.getLabelPosition = function(e, n) {
      var a = this.owner.config.axis_rotated, i = this.getLabelOptionByAxisId(e), r = Ut(i) && i.position ? i.position : n[+!a], o = function(s) {
        return !!~r.indexOf(s);
      };
      return {
        isInner: o("inner"),
        isOuter: o("outer"),
        isLeft: o("left"),
        isCenter: o("center"),
        isRight: o("right"),
        isTop: o("top"),
        isMiddle: o("middle"),
        isBottom: o("bottom")
      };
    }, t.prototype.getAxisLabelPosition = function(e) {
      return this.getLabelPosition(e, e === "x" ? ["inner-top", "inner-right"] : ["inner-right", "inner-top"]);
    }, t.prototype.getLabelPositionById = function(e) {
      return this.getAxisLabelPosition(e);
    }, t.prototype.xForAxisLabel = function(e) {
      var n = this.owner, a = n.state, i = a.width, r = a.height, o = this.getAxisLabelPosition(e), s = o.isMiddle ? -r / 2 : 0;
      return this.isHorizontal(n, e !== "x") ? s = o.isLeft ? 0 : o.isCenter ? i / 2 : i : o.isBottom && (s = -r), s;
    }, t.prototype.textAnchorForAxisLabel = function(e) {
      var n = this.owner, a = this.getAxisLabelPosition(e), i = a.isMiddle ? "middle" : "end";
      return this.isHorizontal(n, e !== "x") ? i = a.isLeft ? "start" : a.isCenter ? "middle" : "end" : a.isBottom && (i = "start"), i;
    }, t.prototype.dxForAxisLabel = function(e) {
      var n = this.owner, a = this.getAxisLabelPosition(e), i = a.isBottom ? "0.5em" : "0";
      return this.isHorizontal(n, e !== "x") ? i = a.isLeft ? "0.5em" : a.isRight ? "-0.5em" : "0" : a.isTop && (i = "-0.5em"), i;
    }, t.prototype.dyForAxisLabel = function(e) {
      var n = this.owner, a = n.config, i = a.axis_rotated, r = this.getAxisLabelPosition(e).isInner, o = a["axis_".concat(e, "_tick_rotate")] ? n.getHorizontalAxisHeight(e) : 0, s = this.getMaxTickSize(e).width, l;
      if (e === "x") {
        var c = a.axis_x_height;
        i ? l = r ? "1.2em" : -25 - s : r ? l = "-0.5em" : c ? l = c - 10 : o ? l = o - 10 : l = "3em";
      } else
        l = {
          y: ["-0.5em", 10, "3em", "1.2em", 10],
          y2: ["1.2em", -20, "-2.2em", "-0.5em", 15]
        }[e], i ? r ? l = l[0] : o ? l = o * (e === "y2" ? -1 : 1) - l[1] : l = l[2] : l = r ? l[3] : (l[4] + (a["axis_".concat(e, "_inner")] ? 0 : s + l[4])) * (e === "y" ? -1 : 1);
      return l;
    }, t.prototype.getMaxTickSize = function(e, n) {
      var a = this.owner, i = a.config, r = a.state, o = r.current, s = r.resizing, l = a.$el, c = l.svg, u = l.chart, f = o.maxTickSize[e], h = "axis_".concat(e), d = {
        width: 0,
        height: 0
      };
      if (s || n || !i["".concat(h, "_show")] || f.width > 0 && a.filterTargetsToShow().length === 0)
        return f;
      if (c) {
        var v = /^y2?$/.test(e), _ = a.filterTargetsToShow(a.data.targets), p = a.scale[e].copy().domain(a["get".concat(v ? "Y" : "X", "Domain")](_, e)), g = p.domain(), x = g[0] === g[1] && g.every(function(E) {
          return E > 0;
        }), y = ft(f.domain) && f.domain[0] === f.domain[1] && f.domain.every(function(E) {
          return E > 0;
        });
        if (x || y)
          return f.size;
        f.domain = g, v || f.ticks.splice(0);
        var m = this.getAxis(e, p, !1, !1, !0), T = i["".concat(h, "_tick_rotate")], b = i["".concat(h, "_tick_count")], w = i["".concat(h, "_tick_values")];
        !w && b && m.tickValues(this.generateTickValues(g, b, v ? this.isTimeSeriesY() : this.isTimeSeries())), !v && this.updateXAxisTickValues(_, m);
        var A = u.append("svg").style("visibility", "hidden").style("position", "fixed").style("top", "0").style("left", "0"), k = A.append("g").attr("class", "".concat(Rt["axis".concat(Nt(e))], " ").concat(j.dummy));
        m.create(k);
        var C = k.node().sizeFor1Char;
        A.selectAll("text").attr("transform", q(T) ? "rotate(".concat(T, ")") : null).each(function(E, M) {
          var L = C ? {
            width: this.textContent.length * C.w,
            height: C.h
          } : Mt(this, !0), $ = L.width, D = L.height;
          d.width = Math.max(d.width, $), d.height = Math.max(d.height, D), v || (f.ticks[M] = $);
        }), A.remove();
      }
      return Object.keys(d).forEach(function(E) {
        d[E] > 0 && (f[E] = d[E]);
      }), f;
    }, t.prototype.getXAxisTickTextY2Overflow = function(e) {
      var n = this.owner, a = n.axis, i = n.config, r = n.state, o = r.current, s = r.isLegendRight, l = r.legendItemWidth, c = n.getAxisTickRotate("x"), u = c > 0 && c < 90;
      if ((a.isCategorized() || a.isTimeSeries()) && i.axis_x_tick_fit && (!i.axis_x_tick_culling || qt(i.axis_x_tick_culling)) && !i.axis_x_tick_multiline && u) {
        var f = i.axis_y2_show && o.maxTickSize.y2.width || 0, h = s && l || 0, d = o.width - n.getCurrentPaddingByDirection("left"), v = this.getXAxisTickMaxOverflow(c, d - e) - f - h, _ = Math.max(0, v) + e;
        return Math.min(_, d / 2);
      }
      return 0;
    }, t.prototype.getXAxisTickMaxOverflow = function(e, n) {
      for (var a = this.owner, i = a.axis, r = a.config, o = a.state, s = i.isTimeSeries(), l = o.current.maxTickSize.x.ticks, c = l.length, u = o.axis.x.padding, f = u.left, h = u.right, d = 0, v = c - (s && r.axis_x_tick_fit ? 0.5 : 0), _ = 0; _ < c; _++) {
        var p = _ + 1, g = Math.cos(Math.PI * e / 180) * l[_], x = p - (s ? 1 : 0.5) + f;
        if (!(x <= 0)) {
          var y = n - g, m = y / x, T = v - p, b = h * m, w = T * m + b, A = g - m / 2 - w;
          d = Math.max(d, A);
        }
      }
      var k = a.filterTargetsToShow(a.data.targets), C = 0;
      if (!s && r.axis_x_tick_count <= k.length && k[0].values.length) {
        var E = ze(a.axis.getAxisType("x"), 0, n - d).domain([
          f * -1,
          a.getXDomainMax(a.data.targets) + 1 + h
        ]);
        C = (E(1) - E(0)) / 2;
      }
      return d + C;
    }, t.prototype.updateLabels = function(e) {
      var n = this, a = this.owner, i = a.config, r = a.$el.main, o = a.$T, s = i.axis_rotated;
      ["x", "y", "y2"].forEach(function(l) {
        var c = n.getLabelText(l), u = "axis".concat(Nt(l)), f = Rt["".concat(u, "Label")];
        if (c) {
          var h = r.select("text.".concat(f));
          h.empty() && (h = r.select("g.".concat(Rt[u])).insert("text", ":first-child").attr("class", f).attr("transform", ["rotate(-90)", null][l === "x" ? +!s : +s]).style("text-anchor", function() {
            return n.textAnchorForAxisLabel(l);
          })), o(h, e).attr("x", function() {
            return n.xForAxisLabel(l);
          }).attr("dx", function() {
            return n.dxForAxisLabel(l);
          }).attr("dy", function() {
            return n.dyForAxisLabel(l);
          }).text(c);
        }
      });
    }, t.prototype.getPadding = function(e, n, a, i) {
      var r = q(e) ? e : e[n];
      return nt(r) ? this.owner.convertPixelToScale(/(bottom|top)/.test(n) ? "y" : "x", r, i) : a;
    }, t.prototype.generateTickValues = function(e, n, a) {
      var i = e;
      if (n) {
        var r = U(n) ? n() : n;
        if (r === 1)
          i = [e[0]];
        else if (r === 2)
          i = [e[0], e[e.length - 1]];
        else if (r > 2) {
          var o = this.isCategorized(), s = r - 2, l = e[0], c = e[e.length - 1], u = (c - l) / (s + 1), f = void 0;
          i = [l];
          for (var h = 0; h < s; h++)
            f = +l + u * (h + 1), i.push(a ? new Date(f) : o ? Math.round(f) : f);
          i.push(c);
        }
      }
      return a || (i = i.sort(function(d, v) {
        return d - v;
      })), i;
    }, t.prototype.generateTransitions = function(e) {
      var n = this.owner, a = n.$el.axis, i = n.$T, r = ["x", "y", "y2", "subX"].map(function(u) {
        return i(a[u], e);
      }), o = r[0], s = r[1], l = r[2], c = r[3];
      return { axisX: o, axisY: s, axisY2: l, axisSubX: c };
    }, t.prototype.redraw = function(e, n, a) {
      var i = this, r = this.owner, o = r.config, s = r.state, l = r.$el, c = n ? "0" : null;
      ["x", "y", "y2", "subX"].forEach(function(u) {
        var f = i[u], h = l.axis[u];
        f && h && (!a && !o.transition_duration && (f.config.withoutTransition = !0), h.style("opacity", c), f.create(e["axis".concat(Nt(u))]));
      }), this.updateAxes(), !s.rendered && o.axis_tooltip && this.setAxisTooltip();
    }, t.prototype.redrawAxis = function(e, n, a, i, r) {
      var o = this, s, l, c, u = this.owner, f = u.config, h = u.scale, d = u.$el, v = !!h.zoom, _;
      !v && this.isCategorized() && e.length === 0 && h.x.domain([0, d.axis.x.selectAll(".tick").size()]), h.x && e.length ? (!v && u.updateXDomain(e, n.UpdateXDomain, n.UpdateOrgXDomain, n.TrimXDomain), f.axis_x_tick_values || this.updateXAxisTickValues(e)) : this.x && (this.x.tickValues([]), (s = this.subX) === null || s === void 0 || s.tickValues([])), f.zoom_rescale && !i && (_ = h.x.orgDomain()), ["y", "y2"].forEach(function(p) {
        var g = "axis_".concat(p, "_"), x = h[p];
        if (x) {
          var y = f["".concat(g, "tick_values")], m = f["".concat(g, "tick_count")];
          if (x.domain(u.getYDomain(e, p, _)), !y && m) {
            var T = u.axis[p], b = x.domain();
            T.tickValues(o.generateTickValues(b, b.every(function(w) {
              return w === 0;
            }) ? 1 : m, o.isTimeSeriesY()));
          }
        }
      }), this.redraw(a, u.hasArcType(), r), this.updateLabels(n.Transition), (n.UpdateXDomain || n.UpdateXAxis || n.Y) && e.length && this.setCulling(), n.Y && ((l = h.subY) === null || l === void 0 || l.domain(u.getYDomain(e, "y")), (c = h.subY2) === null || c === void 0 || c.domain(u.getYDomain(e, "y2")));
    }, t.prototype.setCulling = function() {
      var e = this.owner, n = e.config, a = e.state, i = a.clip, r = a.current, o = e.$el;
      ["subX", "x", "y", "y2"].forEach(function(s) {
        var l = o.axis[s], c = s === "subX" ? "x" : s, u = "axis_".concat(c, "_tick_culling"), f = n[u];
        if (l && f) {
          var h = l.selectAll(".tick"), d = on(h.data(), !n["".concat(u, "_reverse")]), v = d.length, _ = n["".concat(u, "_max")], p = n["".concat(u, "_lines")], g;
          if (v) {
            for (var x = 1; x < v; x++)
              if (v / x < _) {
                g = x;
                break;
              }
            h.each(function(m) {
              var T = p ? this.querySelector("text") : this;
              T && (T.style.display = d.indexOf(m) % g ? "none" : null);
            });
          } else
            h.style("display", null);
          if (s === "x") {
            var y = r.maxTickSize.x.clipPath ? i.pathXAxisTickTexts : null;
            o.svg.selectAll(".".concat(Rt.axisX, " .tick text")).attr("clip-path", y);
          }
        }
      });
    }, t.prototype.setAxisTooltip = function() {
      var e, n = this.owner, a = n.config, i = a.axis_rotated, r = a.axis_tooltip, o = n.$el, s = o.axis, l = o.axisTooltip, c = (e = r.backgroundColor) !== null && e !== void 0 ? e : "black";
      n.generateTextBGColorFilter(c, {
        x: -0.15,
        y: -0.2,
        width: 1.3,
        height: 1.3
      }), ["x", "y", "y2"].forEach(function(u) {
        var f, h, d;
        if (lt(c) || c[u])
          if (l[u] = (f = s[u]) === null || f === void 0 ? void 0 : f.append("text").classed(Rt["axis".concat(u.toUpperCase(), "Tooltip")], !0).attr("filter", n.updateTextBGColor({ id: u }, c)), i) {
            var v = u === "x" ? "x" : "y", _ = u === "y" ? "1.15em" : u === "x" ? "-0.3em" : "-0.4em";
            (h = l[u]) === null || h === void 0 || h.attr(v, _).attr("d".concat(u === "x" ? "y" : "x"), u === "x" ? "0.4em" : "-1.3em").style("text-anchor", u === "x" ? "end" : null);
          } else {
            var v = u === "x" ? "y" : "x", _ = u === "x" ? "1.15em" : "".concat(u === "y" ? "-" : "", "0.4em");
            (d = l[u]) === null || d === void 0 || d.attr(v, _).attr("d".concat(u === "x" ? "x" : "y"), u === "x" ? "-1em" : "0.3em").style("text-anchor", u === "y" ? "end" : null);
          }
      });
    }, t;
  })()
), Y_ = {
  /**
   * Initialize the area that detects the event.
   * Add a container for the zone that detects the event.
   * @private
   */
  initEventRect: function() {
    var t = this;
    t.$el.main.select(".".concat(j.chart)).append("g").attr("class", Kt.eventRects).style("fill-opacity", "0");
  },
  /**
   * Redraws the area that detects the event.
   * @private
   */
  redrawEventRect: function() {
    var t, e = this, n = e.config, a = e.state, i = e.$el, r = e.isMultipleX(), o = n.axis_x_inverted;
    if (i.eventRect)
      e.updateEventRect(i.eventRect, !0);
    else if (e.data.targets.length) {
      var s = e.$el.main.select(".".concat(Kt.eventRects)).style("cursor", n.zoom_enabled && n.zoom_type !== "drag" ? n.axis_rotated ? "ns-resize" : "ew-resize" : null).classed(Kt.eventRectsMultiple, r).classed(Kt.eventRectsSingle, !r), l = s.selectAll(".".concat(Kt.eventRect)).data([0]).enter().append("rect");
      e.updateEventRect(l), e.updateEventType(l), l.call(e.getDraggableSelection()), i.eventRect = l, e.state.inputType === "touch" && !i.svg.on("touchstart.eventRect") && !e.hasArcType() && e.bindTouchOnEventRect(), a.rendered && e.updateEventRect(i.eventRect, !0);
    }
    if (!r) {
      var c = e.getMaxDataCountTarget();
      (!n.data_xSort || o) && c.sort(function(u, f) {
        return o ? f.x - u.x : u.x - f.x;
      }), e.updateDataIndexByX(c), e.updateXs(c), (t = e.updatePointClass) === null || t === void 0 || t.call(e, !0), a.eventReceiver.data = c;
    }
    e.updateEventRectData();
  },
  bindTouchOnEventRect: function() {
    var t = this, e = t.config, n = t.state, a = t.$el, i = a.eventRect, r = a.svg, o = function(v) {
      if (t.isMultipleX())
        t.selectRectForMultipleXs(v);
      else {
        var _ = t.getDataIndexFromEvent(n.event);
        t.callOverOutForTouch(_), _ === -1 ? t.unselectRect() : t.selectRectForSingle(v, _);
      }
    }, s = function() {
      t.unselectRect(), t.callOverOutForTouch();
    }, l = e.interaction_inputType_touch.preventDefault, c = Ei(l) && l || !1, u = !isNaN(l) && l || null, f, h = !c && u === null, d = function(v) {
      var _ = v.type, p = v.changedTouches[0], g = p["client".concat(e.axis_rotated ? "Y" : "X")];
      _ === "touchstart" ? c ? v.preventDefault() : u !== null && (f = g) : _ === "touchmove" && (c || f === !0 || u !== null && Math.abs(f - g) >= u) && (f = !0, v.preventDefault());
    };
    i.on("touchstart", function(v) {
      n.event = v, t.updateEventRect();
    }, { passive: h }).on("touchstart.eventRect touchmove.eventRect", function(v) {
      if (n.event = v, !i.empty() && i.classed(Kt.eventRect)) {
        if (n.dragging || n.flowing || t.hasArcType() || v.touches.length > 1)
          return;
        d(v), o(i.node());
      } else
        s();
    }, { passive: h }).on("touchend.eventRect", function(v) {
      n.event = v, !i.empty() && i.classed(Kt.eventRect) && (t.hasArcType() || !t.toggleShape || n.cancelClick) && n.cancelClick && (n.cancelClick = !1);
    }, { passive: h }), r.on("touchstart", function(v) {
      n.event = v;
      var _ = v.target;
      _ && _ !== i.node() && s();
    }, { passive: h });
  },
  /**
   * Update event rect size
   * @param {d3Selection} eventRect Event <rect> element
   * @param {boolean} force Force to update
   * @private
   */
  updateEventRect: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = n.state, i = n.$el, r = a.eventReceiver, o = a.width, s = a.height, l = a.rendered, c = a.resizing, u = t || i.eventRect, f = function() {
      if (r) {
        var h = vl(i.chart.node());
        r.rect = Mt(u.node(), !0).toJSON(), r.rect.top += h.y, r.rect.left += h.x;
      }
    };
    (!l || c || e) && (u.attr("x", 0).attr("y", 0).attr("width", o).attr("height", s), (!l || e) && u.classed(Kt.eventRect, !0)), f();
  },
  /**
   * Update event type (single or multiple x)
   * @param {d3Selection | boolean} target Target element or boolean to rebind event
   */
  updateEventType: function(t) {
    var e = this, n = Ei(t), a = n ? e.$el.eventRect : t, i = n ? t !== a?.datum().multipleX : !1;
    a && (i && a?.on("mouseover mousemove mouseout click", null), e.isMultipleX() ? e.generateEventRectsForMultipleXs(a) : e.generateEventRectsForSingleX(a));
  },
  /**
   * Updates the location and size of the eventRect.
   * @private
   */
  updateEventRectData: function() {
    var t = this, e = t.config, n = t.scale, a = t.state, i = n.zoom || n.x, r = e.axis_rotated, o = t.isMultipleX(), s, l, c, u;
    if (t.updateEventType(o), o)
      s = 0, l = 0, c = a.width, u = a.height;
    else {
      var f, h = void 0;
      if (t.axis.isCategorized())
        f = t.getEventRectWidth(), h = function(p) {
          return i(p.x) - f / 2;
        };
      else {
        var d = function(p) {
          var g = p.index;
          return {
            prev: t.getPrevX(g),
            next: t.getNextX(g)
          };
        };
        f = function(p) {
          var g = d(p), x = i.domain(), y;
          return g.prev === null && g.next === null ? y = r ? a.height : a.width : g.prev === null ? y = (i(g.next) + i(p.x)) / 2 : g.next === null ? y = i(x[1]) - (i(g.prev) + i(p.x)) / 2 : (Object.keys(g).forEach(function(m, T) {
            var b;
            g[m] = (b = g[m]) !== null && b !== void 0 ? b : x[T];
          }), y = Math.max(0, (i(g.next) - i(g.prev)) / 2)), y;
        }, h = function(p) {
          var g = d(p), x;
          return g.prev === null && g.next === null ? x = 0 : g.prev === null ? x = i(i.domain()[0]) : x = (i(p.x) + i(g.prev)) / 2, x;
        };
      }
      s = r ? 0 : h, l = r ? h : 0, c = r ? a.width : f, u = r ? f : a.height;
    }
    var v = a.eventReceiver, _ = function(p, g) {
      return U(p) ? p(g) : p;
    };
    v.coords.splice(v.data.length), v.data.forEach(function(p, g) {
      v.coords[g] = {
        x: _(s, p),
        y: _(l, p),
        w: _(c, p),
        h: _(u, p)
      };
    });
  },
  /**
   * Seletct rect for single x value
   * @param {d3Selection} context Event rect element
   * @param {number} index x Axis index
   * @private
   */
  selectRectForSingle: function(t, e) {
    var n, a, i = this, r = i.config, o = i.$el, s = o.main, l = o.circle, c = r.data_selection_enabled, u = r.data_selection_grouped, f = r.data_selection_isselectable, h = r.tooltip_grouped, d = i.getAllValuesOnIndex(e);
    if (!(h && (i.showTooltip(d, t), (n = i.showGridFocus) === null || n === void 0 || n.call(i, d), !c || u))) {
      !l && s.selectAll(".".concat(j.EXPANDED, ":not(.").concat(At.shape, "-").concat(e, ")")).classed(j.EXPANDED, !1);
      var v = s.selectAll(".".concat(At.shape, "-").concat(e)).classed(j.EXPANDED, !0).style("cursor", f ? "pointer" : null).filter(function(_) {
        return i.isWithinShape(this, _);
      });
      v.empty() && !h && r.interaction_onout && ((a = i.hideGridFocus) === null || a === void 0 || a.call(i), i.hideTooltip(), !u && i.setExpand(e)), v.call(function(_) {
        var p, g, x = _.data();
        c && (u || f?.bind(i.api)(x)) && (t.style.cursor = "pointer"), h || (i.showTooltip(x, t), (p = i.showGridFocus) === null || p === void 0 || p.call(i, x), (g = i.unexpandCircles) === null || g === void 0 || g.call(i), _.each(function(y) {
          return i.setExpand(e, y.id);
        }));
      });
    }
  },
  /**
   * Select rect for multiple x values
   * @param {d3Selection} context Event rect element
   * @param {boolean} [triggerEvent=true] Whether trigger event or not
   * @private
   */
  selectRectForMultipleXs: function(t, e) {
    e === void 0 && (e = !0);
    var n = this, a = n.config, i = n.state, r = n.filterTargetsToShow(n.data.targets);
    if (!(i.dragging || n.hasArcType(r))) {
      var o = Zt(i.event, t), s = n.findClosestFromTargets(r, o);
      if (e && i.mouseover && (!s || s.id !== i.mouseover.id) && (a.data_onout.call(n.api, i.mouseover), i.mouseover = void 0), !s) {
        n.unselectRect();
        return;
      }
      var l = n.isBubbleType(s) || n.isScatterType(s) || !a.tooltip_grouped ? [s] : n.filterByX(r, s.x), c = l.map(function(f) {
        return n.addName(f);
      });
      n.showTooltip(c, t), n.setExpand(s.index, s.id, !0), n.showGridFocus(c);
      var u = n.dist(s, o);
      (n.isBarType(s.id) || u < n.getPointSensitivity(s)) && (n.$el.svg.select(".".concat(Kt.eventRect)).style("cursor", "pointer"), e && (!i.mouseover || i.mouseover.x !== s.x || i.mouseover.id !== s.id) && (a.data_onover.call(n.api, s), i.mouseover = s));
    }
  },
  /**
   * Unselect EventRect.
   * @private
   */
  unselectRect: function() {
    var t = this, e = t.$el, n = e.circle, a = e.tooltip;
    t.$el.svg.select(".".concat(Kt.eventRect)).style("cursor", null), t.hideGridFocus(), a && (t.hideTooltip(), t._handleLinkedCharts(!1)), n && !t.isPointFocusOnly() && t.unexpandCircles(), t.expandBarTypeShapes(!1);
  },
  /**
   * Create eventRect for each data on the x-axis.
   * Register touch and drag events.
   * @param {object} eventRectEnter d3.select($EVENT.eventRects) object.
   * @returns {object} d3.select($EVENT.eventRects) object.
   * @private
   */
  generateEventRectsForSingleX: function(t) {
    var e = this, n = e.config, a = e.state, i = a.eventReceiver, r = t.style("cursor", n.data_selection_enabled && n.data_selection_grouped ? "pointer" : null).on("click", function(s) {
      a.event = s;
      var l = i.currentIdx, c = i.data, u = c[l === -1 ? e.getDataIndexFromEvent(s) : l];
      e.clickHandlerForSingleX.bind(this)(u, e);
    }).datum({ multipleX: !1 });
    if (a.inputType === "mouse") {
      var o = function(s) {
        var l = s ? e.getDataIndexFromEvent(s) : i.currentIdx;
        return l > -1 ? i.data[l] : null;
      };
      r.on("mouseover", function(s) {
        a.event = s, e.updateEventRect(), Object.values(e.$el.axisTooltip).forEach(function(l) {
          return l?.style("display", null);
        });
      }).on("mousemove", function(s) {
        var l = o(s);
        if (a.event = s, !!l) {
          var c = l.index, u = n.line_step_type;
          if (n.line_step_tooltipMatch && e.hasType("step") && /^step\-(before|after)$/.test(u)) {
            var f = e.scale.zoom || e.scale.x, h = e.axis.xs[c], d = f.invert(Zt(s, this)[0]);
            u === "step-after" && d < h ? c -= 1 : u === "step-before" && d > h && (c += 1);
          }
          e.showAxisGridFocus();
          var v = n.tooltip_grouped && c === i.currentIdx;
          if (a.dragging || a.flowing || e.hasArcType() || v) {
            n.tooltip_show && v && e.setTooltipPosition();
            return;
          }
          c !== i.currentIdx && (e.setOverOut(!1, i.currentIdx), i.currentIdx = c), c === -1 ? e.unselectRect() : e.selectRectForSingle(this, c), e.setOverOut(c !== -1, c);
        }
      }).on("mouseout", function(s) {
        a.event = s, !(!n || e.hasArcType() || i.currentIdx === -1 || !n.interaction_onout) && (e.hideAxisGridFocus(), e.unselectRect(), e.setOverOut(!1, i.currentIdx), i.currentIdx = -1);
      });
    }
    return r;
  },
  clickHandlerForSingleX: function(t, e) {
    var n = e, a = n.config, i = n.state, r = n.$el.main;
    if (!t || n.hasArcType() || i.cancelClick) {
      i.cancelClick && (i.cancelClick = !1);
      return;
    }
    var o = t.index;
    r.selectAll(".".concat(At.shape, "-").concat(o)).each(function(s) {
      var l;
      (a.data_selection_grouped || n.isWithinShape(this, s)) && ((l = n.toggleShape) === null || l === void 0 || l.call(n, this, s, o), a.data_onclick.bind(n.api)(s, this));
    });
  },
  /**
   * Create an eventRect,
   * Register touch and drag events.
   * @param {object} eventRectEnter d3.select($EVENT.eventRects) object.
   * @private
   */
  generateEventRectsForMultipleXs: function(t) {
    var e = this, n = e.config, a = e.state;
    t.on("click", function(i) {
      a.event = i, e.clickHandlerForMultipleXS.bind(this)(e);
    }).datum({ multipleX: !0 }), a.inputType === "mouse" && t.on("mouseover mousemove", function(i) {
      a.event = i, e.selectRectForMultipleXs(this);
    }).on("mouseout", function(i) {
      a.event = i, !(!e.config || e.hasArcType() || !n.interaction_onout) && e.unselectRect();
    });
  },
  clickHandlerForMultipleXS: function(t) {
    var e = t, n = e.config, a = e.state, i = e.filterTargetsToShow(e.data.targets);
    if (!e.hasArcType(i)) {
      var r = Zt(a.event, this), o = e.findClosestFromTargets(i, r), s = e.getPointSensitivity(o);
      o && (e.isBarType(o.id) || e.dist(o, r) < s) && e.$el.main.selectAll(".".concat(At.shapes).concat(e.getTargetSelectorSuffix(o.id))).selectAll(".".concat(At.shape, "-").concat(o.index)).each(function() {
        var l;
        (n.data_selection_grouped || e.isWithinShape(this, o)) && ((l = e.toggleShape) === null || l === void 0 || l.call(e, this, o, o.index), n.data_onclick.bind(e.api)(o, this));
      });
    }
  }
}, V_ = {
  /**
   * Generate flow
   * @param {object} args option object
   * @returns {function}
   * @private
   */
  generateFlow: function(t) {
    var e = this, n = e.data, a = e.state, i = e.$el;
    return function() {
      var r = t.flow.length;
      a.flowing = !0, n.targets.forEach(function(s) {
        s.values.splice(0, r);
      }), e.updateXGrid && e.updateXGrid(!0);
      var o = {};
      [
        "axis.x",
        "grid.x",
        "gridLines.x",
        "region.list",
        "text",
        "bar",
        "line",
        "area",
        "circle"
      ].forEach(function(s) {
        var l = s.split("."), c = i[l[0]];
        c && l.length > 1 && (c = c[l[1]]), c?.size() && (o[s] = c);
      }), e.hideGridFocus(), e.setFlowList(o, t);
    };
  },
  /**
   * Set flow list
   * @param {object} elements Target elements
   * @param {object} args option object
   * @private
   */
  setFlowList: function(t, e) {
    var n = this, a = e.flow, i = e.targets, r = a.duration, o = r === void 0 ? e.duration : r, s = a.index, l = a.length, c = a.orgDataCount, u = n.getFlowTransform(i, c, s, l), f = ml(), h;
    f.add(Object.keys(t).map(function(d) {
      return h = t[d].transition().ease(Fd).duration(o), d === "axis.x" ? h = h.call(function(v) {
        n.axis.x.setTransition(v).create(v);
      }) : d === "region.list" ? h = h.filter(n.isRegionOnX).attr("transform", u) : h = h.attr("transform", u), h;
    })), h.call(f, function() {
      n.cleanUpFlow(t, e);
    });
  },
  /**
   * Clean up flow
   * @param {object} elements Target elements
   * @param {object} args option object
   * @private
   */
  cleanUpFlow: function(t, e) {
    var n = this, a = n.config, i = n.state, r = n.$el.svg, o = a.axis_rotated, s = e.flow, l = e.shape, c = e.xv, u = l.pos, f = u.cx, h = u.cy, d = u.xForText, v = u.yForText, _ = s.done, p = _ === void 0 ? function() {
    } : _, g = s.length;
    g && (["circle", "text", "shape", "eventRect"].forEach(function(x) {
      for (var y = [], m = 0; m < g; m++)
        y.push(".".concat(ut[x], "-").concat(m));
      r.selectAll(".".concat(ut["".concat(x, "s")])).selectAll(y).remove();
    }), r.select(".".concat(ut.xgrid)).remove()), Object.keys(t).forEach(function(x) {
      var y = t[x];
      if (x !== "axis.x" && y.attr("transform", null), x === "grid.x")
        y.attr(i.xgridAttr);
      else if (x === "gridLines.x")
        y.attr("x1", o ? 0 : c).attr("x2", o ? i.width : c), y.select("text").attr("x", o ? i.width : 0).attr("y", c);
      else if (/^(area|bar|line)$/.test(x))
        y.attr("d", l.type[x]);
      else if (x === "text")
        y.attr("x", d).attr("y", v).style("fill-opacity", n.opacityForText.bind(n));
      else if (x === "circle")
        if (n.isCirclePoint())
          y.attr("cx", f).attr("cy", h);
        else {
          var m = function(b) {
            return f(b) - a.point_r;
          }, T = function(b) {
            return h(b) - a.point_r;
          };
          y.attr("x", m).attr("y", T);
        }
      else x === "region.list" && y.select("rect").filter(n.isRegionOnX).attr("x", n.regionX.bind(n)).attr("width", n.regionWidth.bind(n));
    }), a.interaction_enabled && n.redrawEventRect(), p.call(n.api), i.flowing = !1;
  },
  /**
   * Get flow transform value
   * @param {object} targets target
   * @param {number} orgDataCount original data count
   * @param {number} flowIndex flow index
   * @param {number} flowLength flow length
   * @returns {string}
   * @private
   */
  getFlowTransform: function(t, e, n, a) {
    var i = this, r = i.data, o = i.scale.x, s = r.targets[0].values, l = i.getValueOnIndex(s, n), c = i.getValueOnIndex(s, n + a), u, f = o.domain(), h = i.updateXDomain(t, !0, !0);
    e ? e === 1 || l?.x === c?.x ? u = o(f[0]) - o(h[0]) : u = i.axis.isTimeSeries() ? o(f[0]) - o(h[0]) : o(l?.x || 0) - o(c.x) : s.length !== 1 ? u = o(f[0]) - o(h[0]) : i.axis.isTimeSeries() ? (l = i.getValueOnIndex(s, 0), c = i.getValueOnIndex(s, s.length - 1), u = o(l.x) - o(c.x)) : u = Me(h) / 2;
    var d = Me(f) / Me(h);
    return "translate(".concat(u, ",0) scale(").concat(d, ",1)");
  }
}, U_ = {
  initClip: function() {
    var t = this, e = t.state, n = e.clip, a = e.datetimeId;
    n.id = "".concat(a, "-clip"), n.idXAxis = "".concat(n.id, "-xaxis"), n.idYAxis = "".concat(n.id, "-yaxis"), n.idGrid = "".concat(n.id, "-grid"), n.path = t.getClipPath(n.id), n.pathXAxis = t.getClipPath(n.idXAxis), n.pathYAxis = t.getClipPath(n.idYAxis), n.pathGrid = t.getClipPath(n.idGrid);
  },
  getClipPath: function(t) {
    var e = this, n = e.config;
    return !n.clipPath && /-clip$/.test(t) || !n.axis_x_clipPath && /-clip-xaxis$/.test(t) || !n.axis_y_clipPath && /-clip-yaxis$/.test(t) ? null : "url(#".concat(t, ")");
  },
  appendClip: function(t, e) {
    e && t.append("clipPath").attr("id", e).append("rect");
  },
  /**
   * Set x Axis clipPath dimension
   * @param {d3Selecton} node clipPath <rect> selection
   * @private
   */
  setXAxisClipPath: function(t) {
    var e = this, n = e.config, a = e.state, i = a.margin, r = a.width, o = a.height, s = n.axis_rotated, l = Math.max(30, i.left) - (s ? 0 : 20), c = (s ? i.top + o + 10 : i.bottom) + 20, u = s ? -(1 + l) : -(l - 1), f = -15, h = s ? i.left + 20 : r + 10 + l;
    t.attr("x", u).attr("y", f).attr("width", h).attr("height", c);
  },
  /**
   * Set y Axis clipPath dimension
   * @param {d3Selection} node clipPath <rect> selection
   * @private
   */
  setYAxisClipPath: function(t) {
    var e = this, n = e.config, a = e.state, i = a.margin, r = a.width, o = a.height, s = n.axis_rotated, l = Math.max(30, i.left) - (s ? 20 : 0), c = n.axis_y_inner, u = c && !s ? n.axis_y_label.text ? -20 : -1 : s ? -(1 + l) : -(l - 1), f = -(s ? 20 : i.top), h = (s ? r + 15 + l : i.left + 20) + (c ? 20 : 0), d = (s ? i.bottom + 10 : i.top + o) + 10;
    t.attr("x", u).attr("y", f).attr("width", h).attr("height", d);
  },
  updateXAxisTickClip: function() {
    var t = this, e = t.config, n = t.state, a = n.clip, i = n.xAxisHeight, r = t.$el.defs, o = t.getHorizontalAxisHeight("x");
    if (r && !a.idXAxisTickTexts) {
      var s = "".concat(a.id, "-xaxisticktexts");
      t.appendClip(r, s), a.pathXAxisTickTexts = t.getClipPath(a.idXAxisTickTexts), a.idXAxisTickTexts = s;
    }
    !e.axis_x_tick_multiline && t.getAxisTickRotate("x") && o !== i && (t.setXAxisTickClipWidth(), t.setXAxisTickTextClipPathWidth()), t.state.xAxisHeight = o;
  },
  setXAxisTickClipWidth: function() {
    var t = this, e = t.config, n = t.state.current.maxTickSize, a = t.getAxisTickRotate("x");
    if (!e.axis_x_tick_multiline && a) {
      var i = Math.sin(Math.PI / 180 * Math.abs(a));
      n.x.clipPath = (t.getHorizontalAxisHeight("x") - 20) / i;
    } else
      n.x.clipPath = null;
  },
  setXAxisTickTextClipPathWidth: function() {
    var t = this, e = t.state, n = e.clip, a = e.current, i = t.$el.svg;
    i && i.select("#".concat(n.idXAxisTickTexts, " rect")).attr("width", a.maxTickSize.x.clipPath).attr("height", 30);
  }
}, H_ = function(t) {
  return nt(t.position) || "end";
}, W_ = function(t) {
  return t.position === "start" ? 4 : t.position === "middle" ? 0 : -4;
};
function Lo(t, e, n) {
  return function(a) {
    var i = t ? 0 : e;
    return a.position === "start" ? i = t ? -n : 0 : a.position === "middle" && (i = (t ? -n : e) / 2), i;
  };
}
function Do(t, e) {
  t.each(function() {
    var n = N(this);
    ["x1", "x2", "y1", "y2"].forEach(function(a) {
      return n.attr(a, +n.attr(a));
    });
  });
}
var Z_ = {
  hasGrid: function() {
    var t = this.config;
    return ["x", "y"].some(function(e) {
      return t["grid_".concat(e, "_show")] || t["grid_".concat(e, "_lines")].length;
    });
  },
  initGrid: function() {
    var t = this;
    t.hasGrid() && t.initGridLines(), t.initFocusGrid();
  },
  initGridLines: function() {
    var t = this, e = t.config, n = t.state.clip, a = t.$el;
    (e.grid_x_lines.length || e.grid_y_lines.length) && (a.gridLines.main = a.main.insert("g", ".".concat(j.chart).concat(e.grid_lines_front ? " + *" : "")).attr("clip-path", n.pathGrid).attr("class", "".concat(Tt.grid, " ").concat(Tt.gridLines)), a.gridLines.main.append("g").attr("class", Tt.xgridLines), a.gridLines.main.append("g").attr("class", Tt.ygridLines), a.gridLines.x = ns([]));
  },
  updateXGrid: function(t) {
    var e = this, n = e.config, a = e.scale, i = e.state, r = e.$el, o = r.main, s = r.grid, l = n.axis_rotated, c = e.generateGridData(n.grid_x_type, a.x), u = e.axis.isCategorized() ? e.axis.x.tickOffset() : 0, f = function(h) {
      return (a.zoom || a.x)(h) + u * (l ? -1 : 1);
    };
    i.xgridAttr = l ? {
      x1: 0,
      x2: i.width,
      y1: f,
      y2: f
    } : {
      x1: f,
      x2: f,
      y1: 0,
      y2: i.height
    }, s.x = o.select(".".concat(Tt.xgrids)).selectAll(".".concat(Tt.xgrid)).data(c), s.x.exit().remove(), s.x = s.x.enter().append("line").attr("class", Tt.xgrid).merge(s.x), t || s.x.each(function() {
      var h = N(this);
      Object.keys(i.xgridAttr).forEach(function(d) {
        h.attr(d, i.xgridAttr[d]).style("opacity", function() {
          return h.attr(l ? "y1" : "x1") === (l ? i.height : 0) ? "0" : null;
        });
      });
    });
  },
  updateYGrid: function() {
    var t = this, e = t.axis, n = t.config, a = t.scale, i = t.state, r = t.$el, o = r.grid, s = r.main, l = n.axis_rotated, c = function(f) {
      return a.y(f);
    }, u = e.y.getGeneratedTicks(n.grid_y_ticks) || t.scale.y.ticks(n.grid_y_ticks);
    o.y = s.select(".".concat(Tt.ygrids)).selectAll(".".concat(Tt.ygrid)).data(u), o.y.exit().remove(), o.y = o.y.enter().append("line").attr("class", Tt.ygrid).merge(o.y), o.y.attr("x1", l ? c : 0).attr("x2", l ? c : i.width).attr("y1", l ? 0 : c).attr("y2", l ? i.height : c), Do(o.y);
  },
  updateGrid: function() {
    var t = this, e = t.$el, n = e.grid, a = e.gridLines;
    !a.main && t.initGridLines(), n.main.style("visibility", t.hasArcType() ? "hidden" : null), t.hideGridFocus(), t.updateGridLines("x"), t.updateGridLines("y");
  },
  /**
   * Update Grid lines
   * @param {string} type x | y
   * @private
   */
  updateGridLines: function(t) {
    var e = this, n = e.config, a = e.$el, i = a.gridLines, r = a.main, o = e.$T, s = n.axis_rotated, l = t === "x";
    n["grid_".concat(t, "_show")] && e["update".concat(t.toUpperCase(), "Grid")]();
    var c = r.select(".".concat(Tt["".concat(t, "gridLines")])).selectAll(".".concat(Tt["".concat(t, "gridLine")])).data(n["grid_".concat(t, "_lines")]);
    o(c.exit()).style("opacity", "0").remove();
    var u = c.enter().append("g");
    u.append("line").style("opacity", "0"), c = u.merge(c), c.each(function(f) {
      var h = N(this);
      h.select("text").empty() && f.text && h.append("text").style("opacity", "0");
    }), o(c.attr("class", function(f) {
      return "".concat(Tt["".concat(t, "gridLine")], " ").concat(f.class || "").trim();
    }).select("text").attr("text-anchor", H_).attr("transform", function() {
      return l ? s ? null : "rotate(-90)" : s ? "rotate(-90)" : null;
    }).attr("dx", W_).attr("dy", -5)).text(function(f) {
      var h;
      return (h = f.text) !== null && h !== void 0 ? h : this.remove();
    }), i[t] = c;
  },
  redrawGrid: function(t) {
    var e = this, n = e.config.axis_rotated, a = e.state, i = a.width, r = a.height, o = e.$el.gridLines, s = e.$T, l = e.xv.bind(e), c = e.yv.bind(e), u = o.x.select("line"), f = o.x.select("text"), h = o.y.select("line"), d = o.y.select("text");
    return u = s(u, t).attr("x1", n ? 0 : l).attr("x2", n ? i : l).attr("y1", n ? l : 0).attr("y2", n ? l : r), f = s(f, t).attr("x", Lo(!n, i, r)).attr("y", l), h = s(h, t).attr("x1", n ? c : 0).attr("x2", n ? c : i).attr("y1", n ? 0 : c).attr("y2", n ? r : c), d = s(d, t).attr("x", Lo(n, i, r)).attr("y", c), [
      u.style("opacity", null),
      f.style("opacity", null),
      h.style("opacity", null),
      d.style("opacity", null)
    ];
  },
  initFocusGrid: function() {
    var t = this, e = t.config, n = t.state.clip, a = t.$el, i = e.grid_front, r = ".".concat(i && a.gridLines.main ? Tt.gridLines : j.chart).concat(i ? " + *" : ""), o = a.main.insert("g", r).attr("clip-path", n.pathGrid).attr("class", Tt.grid);
    if (a.grid.main = o, e.grid_x_show && o.append("g").attr("class", Tt.xgrids), e.grid_y_show && o.append("g").attr("class", Tt.ygrids), e.axis_tooltip) {
      var s = o.append("g").attr("class", "bb-axis-tooltip");
      s.append("line").attr("class", "bb-axis-tooltip-x"), s.append("line").attr("class", "bb-axis-tooltip-y");
    }
    e.interaction_enabled && e.grid_focus_show && !e.axis_tooltip && (o.append("g").attr("class", gt.xgridFocus).append("line").attr("class", gt.xgridFocus), e.grid_focus_y && !e.tooltip_grouped && o.append("g").attr("class", gt.ygridFocus).append("line").attr("class", gt.ygridFocus));
  },
  showAxisGridFocus: function() {
    for (var t, e, n = this, a = n.config, i = n.format, r = n.state, o = r.event, s = r.width, l = r.height, c = a.axis_rotated, u = Zt(o, (t = n.$el.eventRect) === null || t === void 0 ? void 0 : t.node()), f = u[0], h = u[1], d = { x: f, y: h }, v = 0, _ = Object.entries(n.$el.axisTooltip); v < _.length; v++) {
      var p = _[v], g = p[0], x = p[1], y = g === "x" && !c || g !== "x" && c ? "x" : "y", m = d[y], T = (e = n.scale[g]) === null || e === void 0 ? void 0 : e.invert(m);
      T && (T = g === "x" && n.axis.isTimeSeries() ? i.xAxisTick(T) : T?.toFixed(2), x?.attr(y, m).text(T));
    }
    n.$el.main.selectAll("line.bb-axis-tooltip-x, line.bb-axis-tooltip-y").style("visibility", null).each(function(b, w) {
      var A = N(this);
      w === 0 ? A.attr("x1", f).attr("x2", f).attr("y1", w ? 0 : l).attr("y2", w ? l : 0) : A.attr("x1", w ? 0 : s).attr("x2", w ? s : 0).attr("y1", h).attr("y2", h);
    });
  },
  hideAxisGridFocus: function() {
    var t = this;
    t.$el.main.selectAll("line.".concat(Rt.axisTooltipX, ", line.").concat(Rt.axisTooltipY)).style("visibility", "hidden"), Object.values(t.$el.axisTooltip).forEach(function(e) {
      return e?.style("display", "none");
    });
  },
  /**
   * Show grid focus line
   * @param {Array} data Selected data
   * @private
   */
  showGridFocus: function(t) {
    var e, n = this, a = n.config, i = n.state, r = i.width, o = i.height, s = a.axis_rotated, l = n.$el.main.selectAll("line.".concat(gt.xgridFocus, ", line.").concat(gt.ygridFocus)), c = (t || [l.datum()]).filter(function(h) {
      return h && nt(n.getBaseValue(h));
    });
    if (!(!a.tooltip_show || c.length === 0 || !a.axis_x_forceAsSingle && n.hasType("bubble") || n.hasArcType())) {
      var u = a.grid_focus_edge && !a.tooltip_grouped, f = n.xx.bind(n);
      l.style("visibility", null).data(c.concat(c)).each(function(h) {
        var d = N(this), v = {
          x: f(h),
          y: n.getYScaleById(h.id)(h.value)
        }, _;
        if (d.classed(gt.xgridFocus))
          _ = s ? [
            null,
            // x1
            v.x,
            // y1
            u ? v.y : r,
            // x2
            v.x
            // y2
          ] : [
            v.x,
            u ? v.y : null,
            v.x,
            o
          ];
        else {
          var p = n.axis.getId(h.id) === "y2";
          _ = s ? [
            v.y,
            // x1
            u && !p ? v.x : null,
            // y1
            v.y,
            // x2
            u && p ? v.x : o
            // y2
          ] : [
            u && p ? v.x : null,
            v.y,
            u && !p ? v.x : r,
            v.y
          ];
        }
        ["x1", "y1", "x2", "y2"].forEach(function(g, x) {
          return d.attr(g, _[x]);
        });
      }), Do(l), (e = n.showCircleFocus) === null || e === void 0 || e.call(n, t);
    }
  },
  hideGridFocus: function() {
    var t, e = this, n = e.state, a = n.inputType, i = n.resizing, r = e.$el.main;
    (a === "mouse" || !i) && (r.selectAll("line.".concat(gt.xgridFocus, ", line.").concat(gt.ygridFocus)).style("visibility", "hidden"), (t = e.hideCircleFocus) === null || t === void 0 || t.call(e));
  },
  updateGridFocus: function() {
    var t, e = this, n = e.state, a = n.inputType, i = n.width, r = n.height, o = n.resizing, s = e.$el.grid, l = s.main.select("line.".concat(gt.xgridFocus));
    if (a === "touch")
      l.empty() ? o && ((t = e.showCircleFocus) === null || t === void 0 || t.call(e)) : e.showGridFocus();
    else {
      var c = e.config.axis_rotated;
      l.attr("x1", c ? 0 : -10).attr("x2", c ? i : -10).attr("y1", c ? -10 : 0).attr("y2", c ? -10 : r);
    }
    return !0;
  },
  generateGridData: function(t, e) {
    var n = this, a = n.$el.main.select(".".concat(Rt.axisX)).selectAll(".tick").size(), i = [];
    if (t === "year")
      for (var r = n.getXDomain(), o = r.map(function(u) {
        return u.getFullYear();
      }), s = o[0], l = o[1], c = s; c <= l; c++)
        i.push(new Date("".concat(c, "-01-01 00:00:00")));
    else
      i = e.ticks(10), i.length > a && (i = i.filter(function(u) {
        return String(u).indexOf(".") < 0;
      }));
    return i;
  },
  getGridFilterToRemove: function(t) {
    return t ? function(e) {
      var n = !1;
      return (ft(t) ? t.concat() : [t]).forEach(function(a) {
        ("value" in a && e.value === a.value || "class" in a && e.class === a.class) && (n = !0);
      }), n;
    } : function() {
      return !0;
    };
  },
  removeGridLines: function(t, e) {
    var n = this, a = n.config, i = n.$T, r = n.getGridFilterToRemove(t), o = function(u) {
      return !r(u);
    }, s = e ? Tt.xgridLines : Tt.ygridLines, l = e ? Tt.xgridLine : Tt.ygridLine;
    i(n.$el.main.select(".".concat(s)).selectAll(".".concat(l)).filter(r)).style("opacity", "0").remove();
    var c = "grid_".concat(e ? "x" : "y", "_lines");
    a[c] = a[c].filter(o);
  }
}, q_ = {
  initRegion: function() {
    var t = this, e = t.$el;
    e.region.main = e.main.insert("g", ":first-child").attr("clip-path", t.state.clip.path).attr("class", In.regions);
  },
  updateRegion: function() {
    var t = this, e = t.config, n = t.$el.region, a = t.$T;
    n.main || t.initRegion(), n.main.style("visibility", t.hasArcType() ? "hidden" : null);
    var i = n.main.selectAll(".".concat(In.region)).data(e.regions);
    a(i.exit()).style("opacity", "0").remove();
    var r = i.enter().append("g");
    r.append("rect").style("fill-opacity", "0"), n.list = r.merge(i).attr("class", t.classRegion.bind(t)), n.list.each(function(o) {
      var s, l = N(this);
      l.select("text").empty() && (!((s = o.label) === null || s === void 0) && s.text) && N(this).append("text").style("opacity", "0");
    });
  },
  redrawRegion: function(t) {
    var e = this, n = e.$el.region, a = e.$T, i = e.regionX.bind(e), r = e.regionY.bind(e), o = ["width", "height"], s = n.list.select("rect"), l = n.list.selectAll("text");
    return s = a(s, t).attr("x", i).attr("y", r).attr("width", e.regionWidth.bind(e)).attr("height", e.regionHeight.bind(e)), l = a(l, t).text(function(c) {
      var u;
      return (u = c.label) === null || u === void 0 ? void 0 : u.text;
    }).attr("transform", function(c) {
      var u = c.label;
      return u.rotated ? " rotate(-90)" : null;
    }).attr("transform", function(c) {
      var u = this, f, h = (f = c.label) !== null && f !== void 0 ? f : {}, d = h.x, v = d === void 0 ? 0 : d, _ = h.y, p = _ === void 0 ? 0 : _, g = h.center, x = g === void 0 ? !1 : g, y = h.rotated, m = y === void 0 ? !1 : y, T = this.previousElementSibling, b = { x: 0, y: 0 };
      return lt(x) && ["x", "y"].forEach(function(w, A) {
        x.indexOf(w) > -1 && (b[w] = (+T.getAttribute(o[A]) - Mt(u)[o[A]]) / 2);
      }), "translate(".concat(i(c) + b.x + v, ", ").concat(r(c) + b.y + p, ")").concat(m ? " rotate(-90)" : "");
    }).attr("text-anchor", function(c) {
      var u = c.label;
      return u?.rotated ? "end" : null;
    }).attr("dy", "1em").style("fill", function(c) {
      var u, f = c.label;
      return (u = f?.color) !== null && u !== void 0 ? u : null;
    }), [
      s.style("fill-opacity", function(c) {
        return nt(c.opacity) ? c.opacity : null;
      }).on("end", function() {
        N(this.parentNode).selectAll("rect:not([x])").remove();
      }),
      l.style("opacity", null)
    ];
  },
  regionX: function(t) {
    return this.getRegionSize("x", t);
  },
  regionY: function(t) {
    return this.getRegionSize("y", t);
  },
  regionWidth: function(t) {
    return this.getRegionSize("width", t);
  },
  regionHeight: function(t) {
    return this.getRegionSize("height", t);
  },
  /**
   * Get Region size according start/end position
   * @param {string} type Type string
   * @param {ojbect} d Data object
   * @returns {number}
   * @private
   */
  getRegionSize: function(t, e) {
    var n = this, a = n.config, i = n.scale, r = n.state, o = a.axis_rotated, s = /(x|y|y2)/.test(t), l = s ? t === "x" : t === "width", c = !s && n[l ? "regionX" : "regionY"](e), u = s ? "start" : "end", f = s ? 0 : r[t], h;
    if (e.axis === "y" || e.axis === "y2" ? (!s && !l ? u = "start" : s && !l && (u = "end"), (l ? o : !o) && u in e && (h = i[e.axis])) : (l ? !o : o) && u in e && (h = i.zoom || i.x), h) {
      var d = 0;
      f = e[u], n.axis.isTimeSeries(e.axis) ? f = jt.call(n, f) : /(x|width)/.test(t) && n.axis.isCategorized() && isNaN(f) && (f = a.axis_x_categories.indexOf(f), d = n.axis.x.tickOffset() * (u === "start" ? -1 : 1)), f = h(f) + d;
    }
    return s ? f : f < c ? 0 : f - c;
  },
  isRegionOnX: function(t) {
    return !t.axis || t.axis === "x";
  }
}, j_ = {
  /**
   * Get Axis size according its position
   * @param {string} id Axis id value - x, y or y2
   * @returns {number} size Axis size value
   * @private
   */
  getAxisSize: function(t) {
    var e = this, n = e.config.axis_rotated;
    return n && t === "x" || !n && /y2?/.test(t) ? e.getAxisWidthByAxisId(t, !0) : e.getHorizontalAxisHeight(t);
  },
  getAxisWidthByAxisId: function(t, e) {
    var n, a, i = this;
    if (i.axis) {
      var r = (n = i.axis) === null || n === void 0 ? void 0 : n.getLabelPositionById(t), o = i.axis.getMaxTickSize(t, e).width, s = o === 0 ? 0.5 : 0;
      return o + (((a = i.config.padding) === null || a === void 0 ? void 0 : a.mode) === "fit" ? r.isInner ? 10 + s : 10 : r.isInner ? 20 + s : 40);
    } else
      return 40;
  },
  getHorizontalAxisHeight: function(t) {
    var e, n, a = this, i = a.config, r = a.state, o = r.rotatedPadding, s = r.isLegendRight, l = r.isLegendInset, c = i.axis_rotated, u = ((e = i.padding) === null || e === void 0 ? void 0 : e.mode) === "fit", f = i["axis_".concat(t, "_inner")], h = i["axis_".concat(t, "_label")].text, d = 13, v = ((n = i.padding) === null || n === void 0 ? void 0 : n.mode) === "fit" ? f && !h ? t === "y" ? 1 : 0 : 20 : 30;
    if (t === "x" && !i.axis_x_show)
      return 8;
    if (t === "x" && q(i.axis_x_height))
      return i.axis_x_height;
    if (t === "y" && !i.axis_y_show)
      return i.legend_show && !s && !l ? 10 : 1;
    if (t === "y2" && !i.axis_y2_show)
      return u ? 0 : o.top;
    var _ = a.axis.getMaxTickSize(t), p = Math.abs(i.axis_x_tick_rotate) > 0 && (!i.axis_x_tick_autorotate || a.needToRotateXAxisTickTexts());
    return (i.axis_x_tick_multiline || p) && _.height > d && (v += _.height - d), v + (a.axis.getLabelPositionById(t).isInner ? 0 : 10) + (t === "y2" && !c ? -10 : 0);
  },
  getEventRectWidth: function() {
    var t = this, e = t.config, n = t.axis, a = e.axis_x_inverted, i = n.x.tickInterval();
    return Math.max(0, a ? Math.abs(i) : i);
  },
  /**
   * Get axis tick test rotate value
   * @param {string} id Axis id
   * @returns {number} rotate value
   * @private
   */
  getAxisTickRotate: function(t) {
    var e = this, n = e.axis, a = e.config, i = e.state, r = e.$el, o = a["axis_".concat(t, "_tick_rotate")];
    if (t === "x") {
      var s = n.isCategorized() || n.isTimeSeries();
      if (a.axis_x_tick_fit && s) {
        var l = a.axis_x_tick_count, c = i.current.maxTickSize.x.ticks.length, u = 0;
        if (l ? u = l > c ? c : l : c && (u = c), u !== i.axis.x.tickCount) {
          var f = e.data.targets;
          i.axis.x.padding = e.getXDomainPadding([
            e.getXDomainMinMax(f, "min"),
            e.getXDomainMinMax(f, "max")
          ], u);
        }
        i.axis.x.tickCount = u;
      }
      r.svg && a.axis_x_tick_autorotate && a.axis_x_tick_fit && !a.axis_x_tick_multiline && !a.axis_x_tick_culling && s && (o = e.needToRotateXAxisTickTexts() ? a.axis_x_tick_rotate : 0);
    }
    return o;
  },
  /**
   * Check weather axis tick text needs to be rotated
   * @returns {boolean}
   * @private
   */
  needToRotateXAxisTickTexts: function() {
    var t = this, e = t.state, n = e.axis, a = e.current, i = e.isLegendRight, r = e.legendItemWidth, o = i && r, s = a.width - o - t.getCurrentPaddingByDirection("left") - t.getCurrentPaddingByDirection("right"), l = n.x.tickCount + n.x.padding.left + n.x.padding.right, c = t.axis.getMaxTickSize("x").width, u = l ? s / l : 0;
    return c > u;
  }
}, K_ = {
  /**
   * Set clip-path attribute for x axis element
   * @name axis․x․clipPath
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo]()
   * @example
   * // don't set 'clip-path' attribute
   * clipPath: false
   */
  axis_x_clipPath: !0,
  /**
   * Show or hide x axis.
   * @name axis․x․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   x: {
   *     show: false
   *   }
   * }
   */
  axis_x_show: !0,
  /**
   * Force the x axis to interact as single rather than multiple x axes.
   * - **NOTE:** The tooltip event will be triggered nearing each data points(for multiple xs) rather than x axis based(as single x does) in below condition:
   *   - for `bubble` & `scatter` type
   *   - when `data.xs` is set
   *   - when `tooltip.grouped=false` is set
   *     - `tooltip.grouped` options will take precedence over `axis.forceSingleX` option.
   * @name axis․x․forceAsSingle
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.ForceAsSingle)
   * @example
   * axis: {
   *   x: {
   *      // will work as single x axis
   *      forceAsSingle: true
   *   }
   * }
   */
  axis_x_forceAsSingle: !1,
  /**
   * Set type of x axis.<br><br>
   * **Available Values:**
   * - category
   * - indexed
   * - log
   * - timeseries
   *
   * **NOTE:**<br>
   * - **log** type:
   *   - the x values specified by [`data.x`](#.data%25E2%2580%25A4x)(or by any equivalent option), must be exclusively-positive.
   *   - x axis min value should be >= 0.
   *   - for 'category' type, `data.xs` option isn't supported.
   * @name axis․x․type
   * @memberof Options
   * @type {string}
   * @default indexed
   * @see [Demo: indexed](https://naver.github.io/billboard.js/demo/#Chart.AreaChart)
   * @see [Demo: timeseries](https://naver.github.io/billboard.js/demo/#Chart.TimeseriesChart)
   * @see [Demo: category](https://naver.github.io/billboard.js/demo/#Data.CategoryData)
   * @see [Demo: log](https://naver.github.io/billboard.js/demo/#Axis.LogScales)
   * @example
   * axis: {
   *   x: {
   *     type: "timeseries"
   *   }
   * }
   */
  axis_x_type: "indexed",
  /**
   * Set how to treat the timezone of x values.<br>
   * If true, treat x value as localtime. If false, convert to UTC internally.
   * @name axis․x․localtime
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   x: {
   *     localtime: false
   *   }
   * }
   */
  axis_x_localtime: !0,
  /**
   * Set category names on category axis.
   * This must be an array that includes category names in string. If category names are included in the date by data.x option, this is not required.
   * @name axis․x․categories
   * @memberof Options
   * @type {Array}
   * @default []
   * @example
   * axis: {
   *   x: {
   *     categories: ["Category 1", "Category 2", ...]
   *   }
   * }
   */
  axis_x_categories: [],
  /**
   * centerize ticks on category axis.
   * @name axis․x․tick․centered
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       centered: true
   *     }
   *   }
   * }
   */
  axis_x_tick_centered: !1,
  /**
   * A function to format tick value. Format string is also available for timeseries data.
   * @name axis․x․tick․format
   * @memberof Options
   * @type {function|string}
   * @default undefined
   * @see [D3's time specifier](https://d3js.org/d3-time-format#locale_format)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *        // for timeseries, a 'datetime' object is given as parameter
   *       format: function(x) {
   *           return x.getFullYear();
   *       }
   *
   *       // for category, index(Number) and categoryName(String) are given as parameter
   *       format: function(index, categoryName) {
   *           return categoryName.substr(0, 10);
   *       },
   *
   *        // for timeseries format specifier
   *        format: "%Y-%m-%d %H:%M:%S"
   *     }
   *   }
   * }
   */
  axis_x_tick_format: void 0,
  /**
   * Setting for culling ticks.
   * - `true`: the ticks will be culled, then only limited tick text will be shown.<br>
   *   This option does not hide the tick lines by default, if want to hide tick lines, set `axis.x.tick.culling.lines=false`.
   * - `false`: all of ticks will be shown.<br><br>
   * The number of ticks to be shown can be changed by `axis.x.tick.culling.max`.
   * @name axis․x․tick․culling
   * @memberof Options
   * @type {boolean}
   * @default
   * `true` for indexed axis and timeseries axis, `false` for category axis
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       culling: false,
   *     }
   *   }
   * }
   */
  axis_x_tick_culling: {},
  /**
   * The number of tick texts will be adjusted to less than this value.
   * @name axis․x․tick․culling․max
   * @memberof Options
   * @type {number}
   * @default 10
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       culling: {
   *           max: 5
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_culling_max: 10,
  /**
   * Control visibility of tick lines within culling option, along with tick text.
   * @name axis․x․tick․culling․lines
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       culling: {
   *           lines: false,
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_culling_lines: !0,
  /**
   * Control culling start point to be reversed. If set to true, the culling will be started from the end to start.
   * - **NOTE:** This option is only available when `axis.x.tick.culling` is set to truthy value.
   * @name axis․x․tick․culling․reverse
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.XAxisTickCulling)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       culling: {
   *           reverse: true,
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_culling_reverse: !1,
  /**
   * The number of x axis ticks to show.<br><br>
   * This option hides tick lines together with tick text. If this option is used on timeseries axis, the ticks position will be determined precisely and not nicely positioned (e.g. it will have rough second value).
   * @name axis․x․tick․count
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       count: 5
   *     }
   *   }
   * }
   */
  axis_x_tick_count: void 0,
  /**
   * Set the axis tick line to be positioned inside of the chart.
   * @name axis․x․tick․inner
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.TickInner)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       inner: true
   *     }
   *   }
   * }
   */
  axis_x_tick_inner: !1,
  /**
   * Show or hide x axis tick line.
   * @name axis․x․tick․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.HideTickLineText)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       show: false
   *     }
   *   }
   * }
   */
  axis_x_tick_show: !0,
  /**
   * Show or hide x axis tick text.
   * @name axis․x․tick․text․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.HideTickLineText)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       text: {
   *           show: false
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_text_show: !0,
  /**
   * Set the first/last axis tick text to be positioned inside of the chart on non-rotated axis.
   * @name axis․x․tick․text․inner
   * @memberof Options
   * @type {boolean|object}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.XAxisTickInner)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       text: {
   *          inner: true,
   *
   *          // or specify each position of the first and last tick text
   *          inner: {
   *       	   first: true,
   *       	   last: true
   *       	}
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_text_inner: !1,
  /**
   * Set the x Axis tick text's position relatively its original position
   * @name axis․x․tick․text․position
   * @memberof Options
   * @type {object}
   * @default {x: 0, y:0}
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       text: {
   *         position: {
   *           x: 10,
   *           y: 10
   *         }
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_text_position: { x: 0, y: 0 },
  /**
   * Fit x axis ticks.
   * - **true**: ticks will be shown according to x value of the data points.
   * - **false**: ticks will be shown as to have same intervals.
   * @name axis․x․tick․fit
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.XAxisTickFitting)
   * @see [Demo: for timeseries zoom](https://naver.github.io/billboard.js/demo/#Axis.XAxisTickTimeseries)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       fit: false
   *     }
   *   }
   * }
   */
  axis_x_tick_fit: !0,
  /**
   * Set the x values of ticks manually.<br><br>
   * If this option is provided, the position of the ticks will be determined based on those values.<br>
   * This option works with `timeseries` data and the x values will be parsed according to the type of the value and data.xFormat option.
   * @name axis․x․tick․values
   * @memberof Options
   * @type {Array|function}
   * @default null
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       values: [1, 2, 4, 8, 16, 32, ...],
   *
   *       // an Array value should be returned
   *       values: function() {
   *       	return [ ... ];
   *       }
   *     }
   *   }
   * }
   */
  axis_x_tick_values: null,
  /**
   * Rotate x axis tick text if there is not enough space for 'category' and 'timeseries' type axis.
   * - **NOTE:** The conditions where `autorotate` is enabled are:
   *   - axis.x.type='category' or 'timeseries
   *   - axis.x.tick.multiline=false
   *   - axis.x.tick.culling=false
   *   - axis.x.tick.fit=true
   * - **NOTE:** axis.x.tick.clippath=false is necessary for calculating the overflow padding between the end of x axis and the width of the SVG
   * @name axis․x․tick․autorotate
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.XAxisTickAutorotate)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       rotate: 15,
   *       autorotate: true,
   *       multiline: false,
   *       culling: false,
   *       fit: true
   *     },
   *     clipPath: false
   *   }
   * }
   */
  axis_x_tick_autorotate: !1,
  /**
   * Rotate x axis tick text.
   * - If you set negative value, it will rotate to opposite direction.
   * - Applied when [`axis.rotated`](#.axis%25E2%2580%25A4rotated) option is `false`.
   * - As long as `axis_x_tick_fit` is set to `true` it will calculate an overflow for the y2 axis and add this value to the right padding.
   * @name axis․x․tick․rotate
   * @memberof Options
   * @type {number}
   * @default 0
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.RotateXAxisTickText)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       rotate: 60
   *     }
   *   }
   * }
   */
  axis_x_tick_rotate: 0,
  /**
   * Show x axis outer tick.
   * @name axis․x․tick․outer
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       outer: false
   *     }
   *   }
   * }
   */
  axis_x_tick_outer: !0,
  /**
   * Set tick text to be multiline
   * - **NOTE:**
   *  > When x tick text contains `\n`, it's used as line break and 'axis.x.tick.width' option is ignored.
   * @name axis․x․tick․multiline
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.XAxisTickMultiline)
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       multiline: false
   *     }
   *   }
   * }
   * @example
   * // example of line break with '\n'
   * // In this case, 'axis.x.tick.width' is ignored
   * data: {
   *    x: "x",
   *    columns: [
   *        ["x", "long\ntext", "Another\nLong\nText"],
   *        ...
   *    ],
   * }
   */
  axis_x_tick_multiline: !0,
  /**
   * Set tick width
   * - **NOTE:**
   *  > When x tick text contains `\n`, this option is ignored.
   * @name axis․x․tick․width
   * @memberof Options
   * @type {number}
   * @default null
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       width: 50
   *     }
   *   }
   * }
   */
  axis_x_tick_width: null,
  /**
   * Set to display system tooltip(via `<title>` element) for tick text
   * - **NOTE:** Only available for category axis type (`axis.x.type='category'`)
   * @name axis․x․tick․tooltip
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   x: {
   *     tick: {
   *       tooltip: true
   *     }
   *   }
   * }
   */
  axis_x_tick_tooltip: !1,
  /**
   * Set max value of x axis range.
   * @name axis․x․max
   * @memberof Options
   * @property {number} max Set the max value
   * @property {boolean} [max.fit=false] When specified `max.value` is greater than the bound data value, setting `true` will make x axis max to be fitted to the bound data max value.
   * - **NOTE:** If the bound data max value is greater than the `max.value`, the x axis max will be limited as the given `max.value`.
   * @property {number} [max.value] Set the max value
   * @example
   * axis: {
   *   x: {
   *     max: 100,
   *
   *     max: {
   *       // 'fit=true' will make x axis max to be limited as the bound data value max when 'max.value' is greater.
   *       // - when bound data max is '10' and max.value: '100' ==>  x axis max will be '10'
   *       // - when bound data max is '1000' and max.value: '100' ==> x axis max will be '100'
   *       fit: true,
   *       value: 100
   *     }
   *   }
   * }
   */
  axis_x_max: void 0,
  /**
   * Set min value of x axis range.
   * @name axis․x․min
   * @memberof Options
   * @property {number} min Set the min value
   * @property {boolean} [min.fit=false] When specified `min.value` is lower than the bound data value, setting `true` will make x axis min to be fitted to the bound data min value.
   * - **NOTE:** If the bound data min value is lower than the `min.value`, the x axis min will be limited as the given `min.value`.
   * @property {number} [min.value] Set the min value
   * @example
   * axis: {
   *   x: {
   *     min: -100,
   *
   *     min: {
   *       // 'fit=true' will make x axis min to be limited as the bound data value min when 'min.value' is lower.
   *       // - when bound data min is '-10' and min.value: '-100' ==>  x axis min will be '-10'
   *       // - when bound data min is '-1000' and min.value: '-100' ==> x axis min will be '-100'
   *       fit: true,
   *       value: -100
   *     }
   *   }
   * }
   */
  axis_x_min: void 0,
  /**
   * Change the direction of x axis.<br><br>
   * If true set, the direction will be `right -> left`.
   * @name axis․x․inverted
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.InvertedAxis)
   * @example
   * axis: {
   *   x: {
   *     inverted: true
   *   }
   * }
   */
  axis_x_inverted: !1,
  /**
   * Set padding for x axis.<br><br>
   * If this option is set, the range of x axis will increase/decrease according to the values.
   * If no padding is needed in the rage of x axis, 0 should be set.
   * By default, left/right padding are set depending on x axis type or chart types.
   * - **NOTE:**
   *   - The meaning of padding values, differs according axis types:<br>
   *     - **category/indexed:** The unit of tick value
   *       ex. the given value `1`, is same as the width of 1 tick width
   *     - **timeseries:** Numeric time value
   *       ex. the given value `1000*60*60*24`, which is numeric time equivalent of a day, is same as the width of 1 tick width
   *   - If want values to be treated as pixels, specify `unit:"px"`.
   *     - The pixel value will be converted based on the scale values. Hence can not reflect accurate padding result.
   * @name axis․x․padding
   * @memberof Options
   * @type {object|number}
   * @default {}
   * @example
   * axis: {
   *   x: {
   *     padding: {
   *       // when axis type is 'category'
   *       left: 1,  // set left padding width of equivalent value of a tick's width
   *       right: 0.5  // set right padding width as half of equivalent value of tick's width
   *
   *       // when axis type is 'timeseries'
   *       left: 1000*60*60*24,  // set left padding width of equivalent value of a day tick's width
   *       right: 1000*60*60*12   // set right padding width as half of equivalent value of a day tick's width
   *     },
   *
   *     // or set both values at once.
   *     padding: 10,
   *
   *     // or set padding values as pixel unit.
   *     padding: {
   *       left: 100,
   *       right: 50,
   *       unit: "px"
   *     },
   *   }
   * }
   */
  axis_x_padding: {},
  /**
   * Set height of x axis.<br><br>
   * The height of x axis can be set manually by this option. If you need more space for x axis, please use this option for that. The unit is pixel.
   * @name axis․x․height
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   x: {
   *     height: 20
   *   }
   * }
   */
  axis_x_height: void 0,
  /**
   * Set extent for subchart and zoom(drag only). This can be an array or function that returns an array.
   * - **NOTE:** Specifying value, will limit the zoom scope selection within.
   * @name axis․x․extent
   * @memberof Options
   * @type {Array|function}
   * @default undefined
   * @example
   * axis: {
   *   x: {
   *     // extent range as a pixel value
   *     extent: [0, 200],
   *
   *     // when axis is 'timeseries', parsable datetime string
   *     extent: ["2019-03-01", "2019-03-05"],
   *
   *     // return extent value
   *     extent: function(domain, scale) {
   *    	 var extent = domain.map(function(v) {
   *     	    return scale(v);
   *     	 });
   *
   *   	 // it should return a format of array
   *   	 // ex) [0, 584]
   *     	 return extent;
   *     }
   *   }
   * }
   */
  axis_x_extent: void 0,
  /**
   * Set label on x axis.<br><br>
   * You can set x axis label and change its position by this option.
   * `string` and `object` can be passed and we can change the poisiton by passing object that has position key.<br>
   * Available position differs according to the axis direction (vertical or horizontal).
   * If string set, the position will be the default.
   *
   *  - **If it's horizontal axis:**
   *    - inner-right [default]
   *    - inner-center
   *    - inner-left
   *    - outer-right
   *    - outer-center
   *    - outer-left
   *  - **If it's vertical axis:**
   *    - inner-top [default]
   *    - inner-middle
   *    - inner-bottom
   *    - outer-top
   *    - outer-middle
   *    - outer-bottom
   * @name axis․x․label
   * @memberof Options
   * @type {string|object}
   * @default undefined
   * @example
   * axis: {
   *   x: {
   *     label: "Your X Axis"
   *   }
   * }
   *
   * axis: {
   *   x: {
   *     label: {
   *        text: "Your X Axis",
   *        position: "outer-center"
   *     }
   *   }
   * }
   */
  axis_x_label: {},
  /**
   * Set additional axes for x Axis.
   * - **NOTE:** Axis' scale is based on x Axis value if domain option isn't set.
   *
   * Each axis object should consist with following options:
   *
   * | Name | Type | Default | Description |
   * | --- | --- | --- | --- |
   * | domain | Array | - | Set the domain value |
   * | tick.outer | boolean | true | Show outer tick |
   * | tick.format | Function | - | Set formatter for tick text |
   * | tick.count | Number | - | Set the number of y axis ticks |
   * | tick.values | Array | - | Set tick values manually |
   * @name axis․x․axes
   * @memberof Options
   * @type {Array}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.MultiAxes)
   * @see [Demo: Domain](https://naver.github.io/billboard.js/demo/#Axis.MultiAxesDomain)
   * @example
   * x: {
   *    axes: [
   *      {
   *        // if set, will not be correlated with the main x Axis domain value
   *        domain: [0, 1000],
   *        tick: {
   *          outer: false,
   *          format: function(x) {
   *             return x + "%";
   *          },
   *          count: 2,
   *          values: [10, 20, 30]
   *        }
   *      },
   *      ...
   *    ]
   * }
   */
  axis_x_axes: []
}, J_ = {
  /**
   * Set clip-path attribute for y axis element
   * - **NOTE**: `clip-path` attribute for y Axis is set only when `axis.y.inner` option is true.
   * @name axis․y․clipPath
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * // don't set 'clip-path' attribute
   * clipPath: false
   */
  axis_y_clipPath: !0,
  /**
   * Show or hide y axis.
   * @name axis․y․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   y: {
   *     show: false
   *   }
   * }
   */
  axis_y_show: !0,
  /**
   * Set type of y axis.<br><br>
   * **Available Values:**
   *  - indexed
   *  - log
   *  - timeseries
   *
   * **NOTE:**<br>
   * - **log** type:
   *   - the bound data values must be exclusively-positive.
   *   - y axis min value should be >= 0.
   *   - [`data.groups`](#.data%25E2%2580%25A4groups)(stacked data) option aren't supported.
   *
   * @name axis․y․type
   * @memberof Options
   * @type {string}
   * @default "indexed"
   * @see [Demo: log](https://naver.github.io/billboard.js/demo/#Axis.LogScales)
   * @example
   * axis: {
   *   y: {
   *     type: "log"
   *   }
   * }
   */
  axis_y_type: "indexed",
  /**
   * Set max value of y axis.
   * - **NOTE:** Padding will be added based on this value, so if you don't need the padding, please set axis.y.padding to disable it (e.g. axis.y.padding = 0).
   * @name axis․y․max
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y: {
   *     max: 1000
   *   }
   * }
   */
  axis_y_max: void 0,
  /**
   * Set min value of y axis.
   * - **NOTE:**
   *   Padding will be added based on this value, so if you don't need the padding, please set axis.y.padding to disable it (e.g. axis.y.padding = 0).
   * @name axis․y․min
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y: {
   *     min: 1000
   *   }
   * }
   */
  axis_y_min: void 0,
  /**
   * Change the direction of y axis.<br><br>
   * If true set, the direction will be `top -> bottom`.
   * @name axis․y․inverted
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.InvertedAxis)
   * @example
   * axis: {
   *   y: {
   *     inverted: true
   *   }
   * }
   */
  axis_y_inverted: !1,
  /**
   * Set center value of y axis.
   * @name axis․y․center
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y: {
   *     center: 0
   *   }
   * }
   */
  axis_y_center: void 0,
  /**
   * Show y axis inside of the chart.
   * @name axis․y․inner
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y: {
   *     inner: true
   *   }
   * }
   */
  axis_y_inner: !1,
  /**
   * Set label on y axis.<br><br>
   * You can set y axis label and change its position by this option. This option works in the same way as [axis.x.label](#.axis%25E2%2580%25A4x%25E2%2580%25A4label).
   * @name axis․y․label
   * @memberof Options
   * @type {string|object}
   * @default {}
   * @see [axis.x.label](#.axis%25E2%2580%25A4x%25E2%2580%25A4label) for position string value.
   * @example
   * axis: {
   *   y: {
   *     label: "Your Y Axis"
   *   }
   * }
   *
   * axis: {
   *   y: {
   *     label: {
   *        text: "Your Y Axis",
   *        position: "outer-middle"
   *     }
   *   }
   * }
   */
  axis_y_label: {},
  /**
   * Set formatter for y axis tick text.<br><br>
   * This option accepts d3.format object as well as a function you define.
   * @name axis․y․tick․format
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       format: function(x) {
   *           return x.getFullYear();
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_format: void 0,
  /**
   * Setting for culling ticks.
   * - `true`: the ticks will be culled, then only limited tick text will be shown.<br>
   *   This option does not hide the tick lines by default, if want to hide tick lines, set `axis.y.tick.culling.lines=false`.
   * - `false`: all of ticks will be shown.<br><br>
   * The number of ticks to be shown can be changed by `axis.y.tick.culling.max`.
   * @name axis․y․tick․culling
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       culling: false
   *     }
   *   }
   * }
   */
  axis_y_tick_culling: !1,
  /**
   * The number of tick texts will be adjusted to less than this value.
   * @name axis․y․tick․culling․max
   * @memberof Options
   * @type {number}
   * @default 5
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       culling: {
   *           max: 5
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_culling_max: 5,
  /**
   * Control visibility of tick lines within culling option, along with tick text.
   * @name axis․y․tick․culling․lines
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       culling: {
   *           lines: false,
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_culling_lines: !0,
  /**
   * Control culling start point to be reversed. If set to true, the culling will be started from the end to start.
   * - **NOTE:** This option is only available when `axis.y.tick.culling` is set to truthy value.
   * @name axis․y․tick․culling․reverse
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       culling: {
   *           reverse: true,
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_culling_reverse: !1,
  /**
   * Set the axis tick line to be positioned inside of the chart.
   * @name axis․y․tick․inner
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.TickInner)
   * axis: {
   *   y: {
   *     tick: {
   *       inner: true
   *     }
   *   }
   * }
   */
  axis_y_tick_inner: !1,
  /**
   * Show y axis outer tick.
   * @name axis․y․tick․outer
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       outer: false
   *     }
   *   }
   * }
   */
  axis_y_tick_outer: !0,
  /**
   * Set y axis tick values manually.
   * @name axis․y․tick․values
   * @memberof Options
   * @type {Array|function}
   * @default null
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       values: [100, 1000, 10000],
   *
   *       // an Array value should be returned
   *       values: function() {
   *       	return [ ... ];
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_values: null,
  /**
   * Rotate y axis tick text.
   * - If you set negative value, it will rotate to opposite direction.
   * - Applied when [`axis.rotated`](#.axis%25E2%2580%25A4rotated) option is `true`.
   * @name axis․y․tick․rotate
   * @memberof Options
   * @type {number}
   * @default 0
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       rotate: 60
   *     }
   *   }
   * }
   */
  axis_y_tick_rotate: 0,
  /**
   * Set the number of y axis ticks.<br><br>
   * - **NOTE:** The position of the ticks will be calculated precisely, so the values on the ticks will not be rounded nicely. In the case, axis.y.tick.format or axis.y.tick.values will be helpful.
   * @name axis․y․tick․count
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       count: 5
   *     }
   *   }
   * }
   */
  axis_y_tick_count: void 0,
  /**
   * Show or hide y axis tick line.
   * @name axis․y․tick․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.HideTickLineText)
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       show: false
   *     }
   *   }
   * }
   */
  axis_y_tick_show: !0,
  /**
   * Set axis tick step(interval) size.
   * - **NOTE:** Will be ignored if `axis.y.tick.count` or `axis.y.tick.values` options are set.
   * @name axis․y․tick․stepSize
   * @memberof Options
   * @type {number}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.StepSizeForYAxis)
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       // tick value will step as indicated interval value.
   *       // ex) 'stepSize=15' ==> [0, 15, 30, 45, 60]
   *       stepSize: 15
   *     }
   *   }
   * }
   */
  axis_y_tick_stepSize: null,
  /**
   * Show or hide y axis tick text.
   * @name axis․y․tick․text․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.HideTickLineText)
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       text: {
   *           show: false
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_text_show: !0,
  /**
   * Set the y Axis tick text's position relatively its original position
   * @name axis․y․tick․text․position
   * @memberof Options
   * @type {object}
   * @default {x: 0, y:0}
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       text: {
   *         position: {
   *           x: 10,
   *           y: 10
   *         }
   *       }
   *     }
   *   }
   * }
   */
  axis_y_tick_text_position: { x: 0, y: 0 },
  /**
   * Set the number of y axis ticks.<br><br>
   * - **NOTE:** The position of the ticks will be calculated precisely, so the values on the ticks will not be rounded nicely. In the case, axis.y.tick.format or axis.y.tick.values will be helpful.
   * @name axis․y․tick․time
   * @memberof Options
   * @private
   * @type {object}
   * @property {object} time time object
   * @property {function} [time.value] D3's time interval function (https://github.com/d3/d3-time#intervals)
   * @example
   * axis: {
   *   y: {
   *     tick: {
   *       time: {
   *          // ticks at 15-minute intervals
   *          // https://github.com/d3/d3-scale/blob/master/README.md#time_ticks
   *          value: d3.timeMinute.every(15)
   *       }
   *     }
   *   }
   * }
   */
  // @TODO: not fully implemented yet
  axis_y_tick_time_value: void 0,
  /**
   * Set padding for y axis.<br><br>
   * You can set padding for y axis to create more space on the edge of the axis.
   * This option accepts object and it can include top and bottom. top, bottom will be treated as pixels.
   *
   * - **NOTE:**
   *   - Given values are translated relative to the y Axis domain value for padding
   *   - For area and bar type charts, [area.zerobased](#.area) or [bar.zerobased](#.bar) options should be set to 'false` to get padded bottom.
   * @name axis․y․padding
   * @memberof Options
   * @type {object|number}
   * @default {}
   * @example
   * axis: {
   *   y: {
   *     padding: {
   *       top: 0,
   *       bottom: 0
   *     },
   *
   *     // or set both values at once.
   *     padding: 10
   *   }
   * }
   */
  axis_y_padding: {},
  /**
   * Set default range of y axis.<br><br>
   * This option set the default value for y axis when there is no data on init.
   * @name axis․y․default
   * @memberof Options
   * @type {Array}
   * @default undefined
   * @example
   * axis: {
   *   y: {
   *     default: [0, 1000]
   *   }
   * }
   */
  axis_y_default: void 0,
  /**
   * Set additional axes for y Axis.
   * - **NOTE:** Axis' scale is based on y Axis value if domain option isn't set.
   *
   * Each axis object should consist with following options:
   *
   * | Name | Type | Default | Description |
   * | --- | --- | --- | --- |
   * | domain | Array | - | Set the domain value |
   * | tick.outer | boolean | true | Show outer tick |
   * | tick.format | Function | - | Set formatter for tick text |
   * | tick.count | Number | - | Set the number of y axis ticks |
   * | tick.values | Array | - | Set tick values manually |
   * @name axis․y․axes
   * @memberof Options
   * @type {Array}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.MultiAxes)
   * @see [Demo: Domain](https://naver.github.io/billboard.js/demo/#Axis.MultiAxesDomain)
   * @example
   * y: {
   *    axes: [
   *      {
   *        // if set, will not be correlated with the main y Axis domain value
   *        domain: [0, 1000],
   *        tick: {
   *          outer: false,
   *          format: function(x) {
   *             return x + "%";
   *          },
   *          count: 2,
   *          values: [10, 20, 30]
   *        }
   *      },
   *      ...
   *    ]
   * }
   */
  axis_y_axes: []
}, Q_ = {
  /**
   * Show or hide y2 axis.
   * - **NOTE**:
   *   - When set to `false` will not generate y2 axis node. In this case, all 'y2' axis related functionality won't work properly.
   *   - If need to use 'y2' related options while y2 isn't visible, set the value `true` and control visibility by css display property.
   * @name axis․y2․show
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y2: {
   *     show: true
   *   }
   * }
   */
  axis_y2_show: !1,
  /**
   * Set type of y2 axis.<br><br>
   * **Available Values:**
   *  - indexed
   *  - log
   *  - timeseries
   *
   * **NOTE:**<br>
   * - **log** type:
   *   - the bound data values must be exclusively-positive.
   *   - y2 axis min value should be >= 0.
   *   - [`data.groups`](#.data%25E2%2580%25A4groups)(stacked data) option aren't supported.
   *
   * @name axis․y2․type
   * @memberof Options
   * @type {string}
   * @default "indexed"
   * @see [Demo: log](https://naver.github.io/billboard.js/demo/#Axis.LogScales)
   * @example
   * axis: {
   *   y2: {
   *     type: "indexed"
   *   }
   * }
   */
  axis_y2_type: "indexed",
  /**
   * Set max value of y2 axis.
   * @name axis․y2․max
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y2: {
   *     max: 1000
   *   }
   * }
   */
  axis_y2_max: void 0,
  /**
   * Set min value of y2 axis.
   * @name axis․y2․min
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y2: {
   *     min: -1000
   *   }
   * }
   */
  axis_y2_min: void 0,
  /**
   * Change the direction of y2 axis.<br><br>
   * If true set, the direction will be `top -> bottom`.
   * @name axis․y2․inverted
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.InvertedAxis)
   * @example
   * axis: {
   *   y2: {
   *     inverted: true
   *   }
   * }
   */
  axis_y2_inverted: !1,
  /**
   * Set center value of y2 axis.
   * @name axis․y2․center
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y2: {
   *     center: 0
   *   }
   * }
   */
  axis_y2_center: void 0,
  /**
   * Show y2 axis inside of the chart.
   * @name axis․y2․inner
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y2: {
   *     inner: true
   *   }
   * }
   */
  axis_y2_inner: !1,
  /**
   * Set label on y2 axis.<br><br>
   * You can set y2 axis label and change its position by this option. This option works in the same way as [axis.x.label](#.axis%25E2%2580%25A4x%25E2%2580%25A4label).
   * @name axis․y2․label
   * @memberof Options
   * @type {string|object}
   * @default {}
   * @see [axis.x.label](#.axis%25E2%2580%25A4x%25E2%2580%25A4label) for position string value.
   * @example
   * axis: {
   *   y2: {
   *     label: "Your Y2 Axis"
   *   }
   * }
   *
   * axis: {
   *   y2: {
   *     label: {
   *        text: "Your Y2 Axis",
   *        position: "outer-middle"
   *     }
   *   }
   * }
   */
  axis_y2_label: {},
  /**
   * Set formatter for y2 axis tick text.<br><br>
   * This option works in the same way as axis.y.format.
   * @name axis․y2․tick․format
   * @memberof Options
   * @type {function}
   * @default undefined
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       format: d3.format("$,")
   *       //or format: function(d) { return "$" + d; }
   *     }
   *   }
   * }
   */
  axis_y2_tick_format: void 0,
  /**
   * Setting for culling ticks.
   * - `true`: the ticks will be culled, then only limited tick text will be shown.<br>
   *   This option does not hide the tick lines by default, if want to hide tick lines, set `axis.y2.tick.culling.lines=false`.
   * - `false`: all of ticks will be shown.<br><br>
   * The number of ticks to be shown can be changed by `axis.y2.tick.culling.max`.
   * @name axis․y2․tick․culling
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       culling: false
   *     }
   *   }
   * }
   */
  axis_y2_tick_culling: !1,
  /**
   * The number of tick texts will be adjusted to less than this value.
   * @name axis․y2․tick․culling․max
   * @memberof Options
   * @type {number}
   * @default 5
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       culling: {
   *           max: 5
   *       }
   *     }
   *   }
   * }
   */
  axis_y2_tick_culling_max: 5,
  /**
   * Control visibility of tick lines within culling option, along with tick text.
   * @name axis․y2․tick․culling․lines
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       culling: {
   *           lines: false,
   *       }
   *     }
   *   }
   * }
   */
  axis_y2_tick_culling_lines: !0,
  /**
   * Control culling start point to be reversed. If set to true, the culling will be started from the end to start.
   * - **NOTE:** This option is only available when `axis.y2.tick.culling` is set to truthy value.
   * @name axis․y2․tick․culling․reverse
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       culling: {
   *           reverse: true,
   *       }
   *     }
   *   }
   * }
   */
  axis_y2_tick_culling_reverse: !1,
  /**
   * Set the axis tick line to be positioned inside of the chart.
   * @name axis․y2․tick․inner
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.TickInner)
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       inner: true
   *     }
   *   }
   * }
   */
  axis_y2_tick_inner: !1,
  /**
   * Show or hide y2 axis outer tick.
   * @name axis․y2․tick․outer
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       outer: false
   *     }
   *   }
   * }
   */
  axis_y2_tick_outer: !0,
  /**
   * Set y2 axis tick values manually.
   * @name axis․y2․tick․values
   * @memberof Options
   * @type {Array|function}
   * @default null
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       values: [100, 1000, 10000],
   *
   *       // an Array value should be returned
   *       values: function() {
   *       	return [ ... ];
   *       }
   *     }
   *   }
   * }
   */
  axis_y2_tick_values: null,
  /**
   * Rotate y2 axis tick text.
   * - If you set negative value, it will rotate to opposite direction.
   * - Applied when [`axis.rotated`](#.axis%25E2%2580%25A4rotated) option is `true`.
   * @name axis․y2․tick․rotate
   * @memberof Options
   * @type {number}
   * @default 0
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       rotate: 60
   *     }
   *   }
   * }
   */
  axis_y2_tick_rotate: 0,
  /**
   * Set the number of y2 axis ticks.
   * - **NOTE:** This works in the same way as axis.y.tick.count.
   * @name axis․y2․tick․count
   * @memberof Options
   * @type {number}
   * @default undefined
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       count: 5
   *     }
   *   }
   * }
   */
  axis_y2_tick_count: void 0,
  /**
   * Show or hide y2 axis tick line.
   * @name axis․y2․tick․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.HideTickLineText)
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       show: false
   *     }
   *   }
   * }
   */
  axis_y2_tick_show: !0,
  /**
   * Set axis tick step(interval) size.
   * - **NOTE:** Will be ignored if `axis.y2.tick.count` or `axis.y2.tick.values` options are set.
   * @name axis․y2․tick․stepSize
   * @memberof Options
   * @type {number}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.StepSizeForYAxis)
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       // tick value will step as indicated interval value.
   *       // ex) 'stepSize=15' ==> [0, 15, 30, 45, 60]
   *       stepSize: 15
   *     }
   *   }
   * }
   */
  axis_y2_tick_stepSize: null,
  /**
   * Show or hide y2 axis tick text.
   * @name axis․y2․tick․text․show
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.HideTickLineText)
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       text: {
   *           show: false
   *       }
   *     }
   *   }
   * }
   */
  axis_y2_tick_text_show: !0,
  /**
   * Set the y2 Axis tick text's position relatively its original position
   * @name axis․y2․tick․text․position
   * @memberof Options
   * @type {object}
   * @default {x: 0, y:0}
   * @example
   * axis: {
   *   y2: {
   *     tick: {
   *       text: {
   *         position: {
   *           x: 10,
   *           y: 10
   *         }
   *       }
   *     }
   *   }
   * }
   */
  axis_y2_tick_text_position: { x: 0, y: 0 },
  /**
   * Set padding for y2 axis.<br><br>
   * You can set padding for y2 axis to create more space on the edge of the axis.
   * This option accepts object and it can include top and bottom. top, bottom will be treated as pixels.
   *
   * - **NOTE:**
   *   - Given values are translated relative to the y2 Axis domain value for padding
   *   - For area and bar type charts, [area.zerobased](#.area) or [bar.zerobased](#.bar) options should be set to 'false` to get padded bottom.
   * @name axis․y2․padding
   * @memberof Options
   * @type {object|number}
   * @default {}
   * @example
   * axis: {
   *   y2: {
   *     padding: {
   *       top: 100,
   *       bottom: 100
   *     }
   *
   *     // or set both values at once.
   *     padding: 10
   * }
   */
  axis_y2_padding: {},
  /**
   * Set default range of y2 axis.<br><br>
   * This option set the default value for y2 axis when there is no data on init.
   * @name axis․y2․default
   * @memberof Options
   * @type {Array}
   * @default undefined
   * @example
   * axis: {
   *   y2: {
   *     default: [0, 1000]
   *   }
   * }
   */
  axis_y2_default: void 0,
  /**
   * Set additional axes for y2 Axis.
   * - **NOTE:** Axis' scale is based on y2 Axis value if domain option isn't set.
   *
   * Each axis object should consist with following options:
   *
   * | Name | Type | Default | Description |
   * | --- | --- | --- | --- |
   * | domain | Array | - | Set the domain value |
   * | tick.outer | boolean | true | Show outer tick |
   * | tick.format | Function | - | Set formatter for tick text |
   * | tick.count | Number | - | Set the number of y axis ticks |
   * | tick.values | Array | - | Set tick values manually |
   * @name axis․y2․axes
   * @memberof Options
   * @type {Array}
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.MultiAxes)
   * @see [Demo: Domain](https://naver.github.io/billboard.js/demo/#Axis.MultiAxesDomain)
   * @example
   * y2: {
   *    axes: [
   *      {
   *        // if set, will not be correlated with the main y2 Axis domain value
   *        domain: [0, 1000],
   *        tick: {
   *          outer: false,
   *          format: function(x) {
   *             return x + "%";
   *          },
   *          count: 2,
   *          values: [10, 20, 30]
   *        }
   *      },
   *      ...
   *    ]
   * }
   */
  axis_y2_axes: []
}, t0 = K(K(K({
  /**
   * Setup the way to evaluate tick text size.
   * - **NOTE:**
   *   - When setting `false` or a custom evaluator, it is highly recommended to memoize evaluated text dimension value to not degrade performance.
   * @name axis․evalTextSize
   * @memberof Options
   * @type {boolean|function}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.AxisEvalTextSize)
   * @example
   * axis: {
   *   // will evaluate getting text size every time.
   *   evalTextSize: false,
   *
   *   // set a custom evaluator
   *   evalTextSize: function(textElement, axisId) {
   *     // set some character to be evaluated
   *     // NOTE: The dummy textElement is a descendant of given axisId('x', 'y' or 'y2').
   *     textElement.textContent = "0";
   *
   *     // get the size
   *     const box = textElement.getBBox();
   *
   *     // clear text
   *     textElement.textContent = "";
   *
   *     return { w: 7, h: 12};
   *   },
   *
   *   // set a custom evaluator by returning fixed value
   *   evalTextSize: function(textElement, axisId) {
   *     return {
   *        x: {w: 7, h: 12},
   *        y: {w: 15.75, h: 30},
   *        y2: {w: 9.5, h: 18}
   *     }[axisId];
   *   }
   * }
   */
  axis_evalTextSize: !0,
  /**
   * Switch x and y axis position.
   * @name axis․rotated
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * axis: {
   *   rotated: true
   * }
   */
  axis_rotated: !1,
  /**
   * Set axis tooltip.
   * - **NOTE:**
   *   - When enabled, will disable default focus grid line.
   *   - For `timeseries` x Axis, tooltip will be formatted using x Axis' tick format.
   *   - For `category` x Axis, tooltip will be displaying scales' value text.
   * @name axis․tooltip
   * @memberof Options
   * @type {boolean}
   * @default false
   * @property {object} axis Axis object
   * @property {boolean} [axis.tooltip=false] Show tooltip or not.
   * @property {string|object} [axis.tooltip.backgroundColor] Set axis tooltip text background colors.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Axis.AxisTooltip)
   * @example
   * axis: {
   *     tooltip: true, // default background color is
   *
   *     // set background color for axis tooltip texts
   *     tooltip: {
   *          backgroundColor: "red",
   *
   *          // set different background colors per axes
   *          // NOTE: In this case, only specified axes tooltip will appear.
   *          backgroundColor: {
   *               x: "green",
   *               y: "yellow",
   *               y2: "red"
   *          }
   *     }
   * }
   */
  axis_tooltip: !1
}, K_), J_), Q_), e0 = {
  /**
   * Set related options
   * @name grid
   * @memberof Options
   * @type {object}
   * @property {boolean} [front=false] Set 'grid & focus lines' to be positioned over grid lines and chart elements.
   * @property {object} x Grid x object
   * @property {boolean} [x.show=false] Show grids along x axis.
   * @property {Array} [x.lines=[]] Show additional grid lines along x axis.<br>
   *  This option accepts array including object that has value, text, position and class. text, position and class are optional. For position, start, middle and end (default) are available.
   *  If x axis is category axis, value can be category name. If x axis is timeseries axis, value can be date string, Date object and unixtime integer.
   * @property {object} y Grid y object
   * @property {boolean} [y.show=false] Show grids along x axis.
   * @property {Array} [y.lines=[]] Show additional grid lines along y axis.<br>
   *  This option accepts array including object that has value, text, position and class.
   * @property {number} [y.ticks=undefined] Number of y grids to be shown.
   * @property {object} focus Grid focus object
   * @property {boolean} [focus.edge=false] Show edged focus grid line.<br>**NOTE:** Available when [`tooltip.grouped=false`](#.tooltip) option is set.
   * @property {boolean} [focus.show=true] Show grid line when focus.
   * @property {boolean} [focus.y=false] Show y coordinate focus grid line.<br>**NOTE:** Available when [`tooltip.grouped=false`](#.tooltip) option is set.
   * @property {object} lines Grid lines object
   * @property {boolean} [lines.front=true] Set grid lines to be positioned over chart elements.
   * @default undefined
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Grid.GridLines)
   * @see [Demo: X Grid Lines](https://naver.github.io/billboard.js/demo/#Grid.OptionalXGridLines)
   * @see [Demo: Y Grid Lines](https://naver.github.io/billboard.js/demo/#Grid.OptionalYGridLines)
   * @example
   * grid: {
   *   x: {
   *     show: true,
   *     lines: [
   *       {value: 2, text: "Label on 2"},
   *       {value: 5, text: "Label on 5", class: "label-5"},
   *       {value: 6, text: "Label on 6", position: "start"}
   *     ]
   *   },
   *   y: {
   *     show: true,
   *     lines: [
   *       {value: 100, text: "Label on 100"},
   *       {value: 200, text: "Label on 200", class: "label-200"},
   *       {value: 300, text: "Label on 300", position: 'middle'}
   *     ],
   *     ticks: 5
   *   },
   *   front: true,
   *   focus: {
   *      show: false,
   *
   *      // Below options are available when 'tooltip.grouped=false' option is set
   *      edge: true,
   *      y: true
   *   },
   *   lines: {
   *      front: false
   *   }
   * }
   */
  grid_x_show: !1,
  grid_x_type: "tick",
  grid_x_lines: [],
  grid_y_show: !1,
  grid_y_lines: [],
  grid_y_ticks: void 0,
  grid_focus_edge: !1,
  grid_focus_show: !0,
  grid_focus_y: !1,
  grid_front: !1,
  grid_lines_front: !0
}, n0 = {
  /**
   * Specify the keys of the x values for each data.<br><br>
   * This option can be used if we want to show the data that has different x values.
   * @name data․xs
   * @memberof Options
   * @type {object}
   * @default {}
   * @example
   * data: {
   *   xs: {
   *      data1: "x1",
   *      data2: "x2"
   *   }
   * }
   */
  data_xs: {},
  /**
   * Set a format specifier to parse string specified as x.
   * @name data․xFormat
   * @memberof Options
   * @type {string}
   * @default %Y-%m-%d
   * @example
   * data: {
   *    x: "x",
   *    columns: [
   *        ["x", "01012019", "02012019", "03012019"],
   *        ["data1", 30, 200, 100]
   *    ],
   *    // Format specifier to parse as datetime for given 'x' string value
   *    xFormat: "%m%d%Y"
   * },
   * axis: {
   *    x: {
   *        type: "timeseries"
   *    }
   * }
   * @see [D3's time specifier](https://d3js.org/d3-time-format#locale_format)
   */
  data_xFormat: "%Y-%m-%d",
  /**
   * Set localtime format to parse x axis.
   * @name data․xLocaltime
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * data: {
   *   xLocaltime: false
   * }
   */
  data_xLocaltime: !0,
  /**
   * Sort on x axis.
   * - **NOTE:** This option works for lineish(area/line/spline/step) types only.
   * @name data․xSort
   * @memberof Options
   * @type {boolean}
   * @default true
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataXSort)
   * @example
   * data: {
   *   xSort: false,
   *   x: "x",
   *   columns: [
   *     // The line graph will start to be drawn following the x axis sequence
   *     // Below data, will start drawing x=1: 200, x=2: 300, x=3: 100
   *     ["x", 3, 1, 2],
   *     ["data1", 100, 200, 300]
   *   ]
   * }
   */
  data_xSort: !0,
  /**
   * Set y axis the data related to. y and y2 can be used.
   * - **NOTE:** If all data is related to one of the axes, the domain of axis without related data will be replaced by the domain from the axis with related data
   * @name data․axes
   * @memberof Options
   * @type {object}
   * @default {}
   * @example
   * data: {
   *   axes: {
   *     data1: "y",
   *     data2: "y2"
   *   }
   * }
   */
  data_axes: {},
  /**
   * Define regions for each data.<br>
   * The values must be an array for each data and it should include an object that has `start`, `end` and `style`.
   * - The object type should be as:
   *   - start {number}: Start data point number. If not set, the start will be the first data point.
   *   - [end] {number}: End data point number. If not set, the end will be the last data point.
   *   - [style.dasharray="2 2"] {string}: The first number specifies a distance for the filled area, and the second a distance for the unfilled area.
   * - **NOTE:**
   *   - Supports only line type.
   *   - `start` and `end` values should be in the exact x value range.
   *   - Dashes will be applied using `stroke-dasharray` css property when data doesn't contain nullish value(or nullish value with `line.connectNull=true` set).
   *   - Dashes will be applied via path command when data contains nullish value.
   * @name data․regions
   * @memberof Options
   * @type {object}
   * @default {}
   * @example
   * data: {
   *   regions: {
   *     data1: [{
   *         start: 1,
   *         end: 2,
   *         style: {
   *             dasharray: "5 2"
   *         }
   *     }, {
   *         start: 3
   *     }],
   *     ...
   *   }
   * }
   */
  data_regions: {},
  /**
   * Set the stacking to be normalized
   * - **NOTE:**
   *   - For stacking, '[data.groups](#.data%25E2%2580%25A4groups)' option should be set
   *   - y Axis will be set in percentage value (0 ~ 100%)
   *   - Must have positive values
   *   - Data not in any group will not be normalized when using perGroup option
   * @name data․stack․normalize
   * @memberof Options
   * @type {boolean|object}
   * @default false
   * @see [Demo: Data Stack Normalized](https://naver.github.io/billboard.js/demo/#Data.DataStackNormalized)
   * @see [Demo: Data Stack Normalized per Group](https://naver.github.io/billboard.js/demo/#Data.DataStackNormalizedGroup)
   * @example
   * data: {
   *   stack: {
   *      // Normalize all grouped data together (all groups combined to 0-100%)
   *      normalize: true
   *
   *      // Normalize per group (each group independently becomes 0-100%)
   *      // Data not in any group will display with their original values.
   *      // If non-grouped data shares the same axis (e.g., y), it will be
   *      // displayed on the 0-100 absolute scale. To display original values,
   *      // assign them to a separate axis (e.g., y2).
   *      normalize: {
   *        perGroup: true
   *      }
   *   },
   *   groups: [
   *     ["data1", "data2"]  // This group will be normalized to 0-100%
   *   ],
   *   // data3 is not in any group, so it displays original values
   *   // Assign it to y2 axis to use a separate scale
   *   axes: {
   *     data3: "y2"
   *   }
   * },
   * axis: {
   *   y2: {
   *     show: true
   *   }
   * }
   */
  data_stack_normalize: !1
}, a0 = [
  L_,
  D_,
  I_,
  z_,
  P_,
  O_,
  F_
], Ll = {
  axis: X_,
  clip: U_,
  eventrect: Y_,
  flow: V_,
  grid: Z_,
  region: q_,
  sizeAxis: j_
}, Dl = {
  optDataAxis: n0,
  optAxis: t0,
  optGrid: e0
}, i0 = 15, Io = 20, zo = 0.35;
function r0(t) {
  t === void 0 && (t = !1);
  var e = this;
  return ["donut", "pie", "polar", "gauge"].find(function(n) {
    return e.hasType(n) && !(n === "gauge" && t && e.hasMultiArcGauge());
  });
}
function Il() {
  var t = this, e = t.config, n = r0.call(t, !0), a = n && e["".concat(n, "_label_line")], i = Ut(a), r = function(l, c, u) {
    return u;
  }, o = {
    show: a === !0 || i && a?.show !== !1,
    distance: i && a?.distance || Io
  };
  if (a === !0)
    return {
      chartType: n,
      line: o,
      text: { formatter: r }
    };
  if (!i)
    return {
      chartType: n,
      line: { show: !1, distance: Io },
      text: { formatter: null }
    };
  var s = r;
  return U(a.text) ? s = a.text : a.text === !1 && (s = null), {
    chartType: n,
    line: o,
    text: { formatter: s }
  };
}
function o0(t, e) {
  var n = this, a = n.state, i = n.updateAngle(t);
  if (!i)
    return null;
  var r = n.getRadius(t).outerRadius, o = r;
  n.hasType("polar") && (o = n.getPolarOuterRadius(t, r), r = a.radius);
  var s = (i.startAngle + i.endAngle) / 2, l = Math.abs(i.endAngle - i.startAngle - 2 * Math.PI) < 0.01;
  l && (s = Math.PI / 2);
  var c = Math.sin(s), u = -Math.cos(s), f = {
    x: c * o,
    y: u * o
  }, h = r + i0, d = {
    x: c * h,
    y: u * h
  }, v = c >= 0, _ = {
    x: d.x + e * (v ? 1 : -1),
    y: d.y
  };
  return { startPoint: f, breakPoint: d, endPoint: _, isRight: v, midAngle: s };
}
function Po() {
  return Il.call(this).line.show;
}
function s0(t) {
  var e = this, n = e.$el.arcs, a = e.$T, i = Il.call(e), r = i.line, o = i.text, s = r.distance, l = null;
  n.selectAll(".".concat(at.chartArc)).each(function(c) {
    var u, f, h, d = N(this), v = o0.call(e, c, s), _ = (u = c._cache) !== null && u !== void 0 ? u : {}, p = _.ratio, g = _.meetsThreshold, x = _.updated;
    if (!(!x || !v)) {
      var y = e.isTargetToShow(c.data.id) && g, m = v.startPoint, T = v.breakPoint, b = v.endPoint, w = v.isRight, A = "".concat(m.x, ",").concat(m.y, " ").concat(T.x, ",").concat(T.y, " ").concat(b.x, ",").concat(b.y);
      if (r.show) {
        var k = d.select(".".concat(at.arcLabelLine));
        k.empty() && (k = d.append("polyline").attr("class", at.arcLabelLine)), a(k, t).attr("points", A).style("stroke", e.color(c.data)).style("opacity", y ? null : "0");
      }
      var C = d.select(".".concat(at.arcLabelLineText));
      if (C.empty() && (C = d.append("text").attr("class", at.arcLabelLineText).style("pointer-events", "none")), y) {
        var E = x.value, M = c.data.id, L = ((h = (f = o.formatter) !== null && f !== void 0 ? f : e.getArcLabelConfig("format")) !== null && h !== void 0 ? h : e.defaultArcValueFormat)(E, p, M).toString();
        an(C, L, [-1, 1], !1);
        var $ = {
          x: b.x + 5 * (w ? 1 : -1),
          // 5: label offset from endpoint
          y: b.y
        };
        C.style("text-anchor", w ? "start" : "end");
        var D = C.node(), S = D?.querySelectorAll("tspan");
        if (l === null && (l = parseFloat(tt.getComputedStyle(D).fontSize) || 12), S && S.length > 1) {
          var R = S.length, z = (R - 3) / 2;
          $.y += (-z + zo) * l;
        } else
          $.y += zo * l;
        a(C, t).attr("transform", "translate(".concat($.x, ",").concat($.y, ")")).style("opacity", null).style("fill", e.updateTextColor.bind(e)(c));
      } else
        a(C, t).style("opacity", "0");
    }
  });
}
function l0(t) {
  return ["donut", "pie", "polar", "gauge"].find(function(e) {
    return t.hasType(e);
  });
}
function c0(t, e, n, a) {
  var i, r, o = t.config, s = t.state.radiusExpanded, l = n.endAngle - Math.PI / 2, c = Math.sin(l), u = {
    x: Math.cos(l) * (s + (a ? 5 : 25)),
    // 5: range offset, 25: gauge offset
    y: c * (s + 15 - Math.abs(c * 10)) + 3
    // 10: y factor, 3: y offset
  };
  if (a) {
    var f = o.arc_rangeText_position;
    if (f) {
      var h = o.arc_rangeText_values, d = U(f) ? f(h[e.index]) : f;
      u.x += (i = d?.x) !== null && i !== void 0 ? i : 0, u.y += (r = d?.y) !== null && r !== void 0 ? r : 0;
    }
  }
  return u;
}
function u0(t, e, n, a) {
  var i = t.config, r = l0(t), o = r ? i["".concat(r, "_label_ratio")] : void 0;
  if (o)
    o = U(o) ? o.bind(t.api)(e, n, a) : o;
  else {
    var s = 36, l = 0.375, c = 1.175, u = 0.8, f = s / n, h = f > l;
    o = n && a ? (h ? c - f : u) * n / a : 0;
  }
  return o;
}
function f0(t, e, n) {
  var a = t.getRadius(e).outerRadius;
  t.hasType("polar") && (a = t.getPolarOuterRadius(e, a));
  var i = t.svgArc.centroid(n).map(function(c) {
    return isNaN(c) ? 0 : c;
  }), r = i[0], o = i[1], s = Math.sqrt(r * r + o * o), l = u0(t, e, a, s);
  return {
    pos: { x: r, y: o },
    ratio: l
  };
}
function Oo(t) {
  t === void 0 && (t = 0);
  var e = this, n = e.config, a = e.state, i = e.hasMultiArcGauge(), r = a.gaugeArcWidth / e.filterTargetsToShow(e.data.targets).length, o = t ? Math.min(a.radiusExpanded * t - a.radius, r * 0.8 - (1 - t) * 100) : 0;
  return {
    /**
     * Getter of arc innerRadius value
     * @param {IArcData} d Data object
     * @returns {number} innerRadius value
     * @private
     */
    inner: function(s) {
      var l = e.getRadius(s).innerRadius;
      return i ? a.radius - r * (s.index + 1) : q(l) ? l : 0;
    },
    /**
     * Getter of arc outerRadius value
     * @param {IArcData} d Data object
     * @returns {number} outerRadius value
     * @private
     */
    outer: function(s) {
      var l = e.getRadius(s).outerRadius, c;
      if (i)
        c = a.radius - r * s.index + o;
      else if (e.hasType("polar") && !t)
        c = e.getPolarOuterRadius(s, l);
      else if (c = l, t) {
        var u = a.radiusExpanded;
        a.radius !== l && (u -= Math.abs(a.radius - l)), c = u * t;
      }
      return c;
    },
    /**
     * Getter of arc cornerRadius value
     * @param {IArcData} d Data object
     * @param {number} outerRadius outer radius value
     * @returns {number} cornerRadius value
     * @private
     */
    corner: function(s, l) {
      var c = n.arc_cornerRadius_ratio, u = c === void 0 ? 0 : c, f = n.arc_cornerRadius, h = f === void 0 ? 0 : f, d = s.data.id, v = s.value, _ = 0;
      return u ? _ = u * l : _ = q(h) ? h : h.call(e.api, d, v, l), _;
    }
  };
}
function ui(t) {
  return function(e) {
    var n = function(i) {
      var r = i.startAngle, o = r === void 0 ? 0 : r, s = i.endAngle, l = s === void 0 ? 0 : s, c = i.padAngle, u = c === void 0 ? 0 : c;
      return {
        startAngle: o,
        endAngle: l,
        padAngle: u
      };
    }, a = ln(n(this._current), n(e));
    return this._current = e, function(i) {
      var r = a(i), o = e.data, s = e.index, l = e.value;
      return t(K(K({}, r), { data: o, index: s, value: l }));
    };
  };
}
var h0 = {
  initPie: function() {
    var t = this, e = t.config, n = e.data_type, a = e["".concat(n, "_padding")], i = e["".concat(n, "_startingAngle")] || 0, r = (a ? a * 0.01 : e["".concat(n, "_padAngle")]) || 0;
    t.pie = Ov().startAngle(i).endAngle(i + 2 * Math.PI).padAngle(r).value(function(o) {
      var s, l;
      return (l = (s = o.values) === null || s === void 0 ? void 0 : s.reduce(function(c, u) {
        return c + u.value;
      }, 0)) !== null && l !== void 0 ? l : o;
    }).sort(t.getSortCompareFn.bind(t)(!0));
  },
  updateRadius: function() {
    var t = this, e = t.config, n = t.state, a = e.data_type, i = e["".concat(a, "_padding")], r = e.gauge_width || e.donut_width, o = t.filterTargetsToShow(t.data.targets).length * e.gauge_arcs_minWidth, s = 0.85, l = Po.call(t) ? s : 1;
    n.radiusExpanded = Math.min(n.arcWidth, n.arcHeight) / 2 * (t.hasMultiArcGauge() && e.gauge_label_show ? s : l), n.radius = n.radiusExpanded * 0.95, n.innerRadiusRatio = r ? (n.radius - r) / n.radius : 0.6, n.gaugeArcWidth = r || (o <= n.radius - n.innerRadius ? n.radius - n.innerRadius : o <= n.radius ? o : n.radius);
    var c = e.pie_innerRadius || (i ? i * (n.innerRadiusRatio + 0.1) : 0);
    n.outerRadius = e.pie_outerRadius, n.innerRadius = t.hasType("donut") || t.hasType("gauge") ? n.radius * n.innerRadiusRatio : c;
  },
  /**
   * Get pie's inner & outer radius value
   * @param {object|undefined} d Data object
   * @returns {object}
   * @private
   */
  getRadius: function(t) {
    var e = this, n = t?.data, a = e.state, i = a.innerRadius, r = a.outerRadius;
    return !q(i) && n && (i = i[n.id] || 0), ct(r) && n && n.id in r ? r = r[n.id] : q(r) || (r = e.state.radius), { innerRadius: i, outerRadius: r };
  },
  updateArc: function() {
    var t = this;
    t.updateRadius(), t.svgArc = t.getSvgArc(), t.svgArcExpanded = t.getSvgArcExpanded();
  },
  getArcLength: function() {
    var t = this, e = t.config, n = e.gauge_arcLength * 3.6, a = 2 * (n / 360);
    return n < -360 ? a = -2 : n > 360 && (a = 2), a * Math.PI;
  },
  getStartingAngle: function() {
    var t = this, e = t.config, n = e.data_type, a = t.hasType("gauge") ? e.gauge_fullCircle : !1, i = -1 * Math.PI / 2, r = Math.PI / 2, o = e["".concat(n, "_startingAngle")] || 0;
    return !a && o <= i ? o = i : !a && o >= r ? o = r : (o > Math.PI || o < -1 * Math.PI) && (o = Math.PI), o;
  },
  /**
   * Update angle data
   * @param {object} dValue Data object
   * @param {boolean} forRange Weather is for ranged text option(arc.rangeText.values)
   * @returns {object|null} Updated angle data
   * @private
   */
  updateAngle: function(t, e) {
    var n;
    e === void 0 && (e = !1);
    var a = this, i = a.config, r = a.state, o = e && a.hasType("gauge"), s = a.pie, l = t, c = !1;
    if (!i)
      return null;
    var u = a.getStartingAngle(), f = i.gauge_fullCircle || e && !o ? a.getArcLength() : u * -2;
    if (l.data && a.isGaugeType(l.data) && !a.hasMultiArcGauge()) {
      var h = i.gauge_min, d = i.gauge_max, v = a.getTotalDataSum(r.rendered), _ = f * ((v - h) / (d - h));
      s = s.startAngle(u).endAngle(_ + u);
    }
    if (e === !1 && s(a.filterTargetsToShow()).forEach(function(m, T) {
      var b;
      !c && m.data.id === ((b = l.data) === null || b === void 0 ? void 0 : b.id) && (c = !0, l = m, l.index = T);
    }), isNaN(l.startAngle) && (l.startAngle = 0), isNaN(l.endAngle) && (l.endAngle = l.startAngle), e || l.data && (i.gauge_enforceMinMax || a.hasMultiArcGauge())) {
      var h = i.gauge_min, d = i.gauge_max, p = e && !o ? a.getTotalDataSum(r.rendered) : d, g = f / (p - h), x = (n = l.value) !== null && n !== void 0 ? n : 0, y = x < h ? 0 : x < p ? x - h : p - h;
      l.startAngle = u, l.endAngle = u + g * y;
    }
    return c || e ? l : null;
  },
  getSvgArc: function() {
    var t = this, e = Oo.call(t), n = e.inner, a = e.outer, i = e.corner, r = lo().innerRadius(n).outerRadius(a), o = function(s, l) {
      var c, u = "M 0 0";
      if (s.value || s.data) {
        var f = l ? s : (c = t.updateAngle(s)) !== null && c !== void 0 ? c : null;
        f && (u = r.cornerRadius(i(f, a(f)))(f));
      }
      return u;
    };
    return o.centroid = r.centroid, o;
  },
  /**
   * Get expanded arc path function
   * @param {number} rate Expand rate
   * @returns {function} Expanded arc path getter function
   * @private
   */
  getSvgArcExpanded: function(t) {
    t === void 0 && (t = 1);
    var e = this, n = Oo.call(e, t), a = n.inner, i = n.outer, r = n.corner, o = lo().innerRadius(a).outerRadius(i);
    return function(s) {
      var l = e.updateAngle(s), c = i(l), u = 0;
      return l && (u = r(l, c)), l ? o.cornerRadius(u)(l) : "M 0 0";
    };
  },
  getArc: function(t, e, n) {
    return n || this.isArcType(t.data) ? this.svgArc(t, e) : "M 0 0";
  },
  /**
   * Render range value text
   * @private
   */
  redrawArcRangeText: function() {
    var t = this, e = t.config, n = t.$el.arcs, a = t.state, i = t.$T, r = e.arc_rangeText_format, o = t.hasType("gauge") && e.arc_rangeText_fixed, s = e.arc_rangeText_values;
    if (s?.length) {
      var l = e.arc_rangeText_unit === "%", c = t.getTotalDataSum(a.rendered);
      l && (s = s.map(function(h) {
        return c / 100 * h;
      }));
      var u = t.pie(s).map(function(h, d) {
        return h.index = d, h;
      }), f = n.selectAll(".".concat(at.arcRange)).data(s);
      f.exit(), f = i(f.enter().append("text").attr("class", at.arcRange).style("text-anchor", "middle").style("pointer-events", "none").style("opacity", "0").text(function(h) {
        var d = l ? h / c * 100 : h;
        return U(r) ? r(d) : "".concat(d).concat(l ? "%" : "");
      }).merge(f)), (!a.rendered || a.rendered && !o) && c > 0 && f.attr("transform", function(h, d) {
        return t.transformForArcLabel(this, u[d], !0);
      }), f.style("opacity", function(h) {
        return !o && (h > c || c === 0) ? "0" : null;
      });
    }
  },
  /**
   * Set transform attributes to arc label text
   * @param {SVGTextElement} textNode Text node element
   * @param {object} d Data object
   * @param {boolean} forRange Weather is for ranged text option(arc.rangeText.values)
   * @returns {string} Translate attribute string
   * @private
   */
  transformForArcLabel: function(t, e, n) {
    n === void 0 && (n = !1);
    var a = this, i = a.updateAngle(e, n);
    if (!i)
      return "";
    var r, o = 1;
    if (n || a.hasMultiArcGauge())
      r = c0(a, e, i, n);
    else if (!a.hasType("gauge") || a.data.targets.length > 1) {
      var s = f0(a, e, i);
      r = s.pos, o = s.ratio;
    } else
      return "";
    return wl.call(a, t, r), "translate(".concat(r.x * o, ",").concat(r.y * o, ")");
  },
  convertToArcData: function(t) {
    return this.addName({
      id: "data" in t ? t.data.id : t.id,
      value: t.value,
      ratio: this.getRatio("arc", t),
      index: t.index
    });
  },
  textForArcLabel: function(t) {
    var e, n = this, a = n.hasType("gauge"), i = (e = ["donut", "gauge", "pie", "polar"].filter(n.hasType.bind(n))) === null || e === void 0 ? void 0 : e[0];
    n.shouldShowArcLabel() && t.style("fill", n.updateTextColor.bind(n)).attr("filter", function(r) {
      return n.updateTextBGColor.bind(n)(r, n.config.data_labels_backgroundColors);
    }).each(function(r) {
      var o = N(this), s = n.updateAngle(r), l = n.getRatio("arc", s), c = vr.call(n, l, i);
      if (r._cache = { updated: s, ratio: l, meetsThreshold: c }, c) {
        var u = (s || r).value, f = (n.getArcLabelConfig("format") || n.defaultArcValueFormat)(u, l, r.data.id).toString();
        an(o, f, [-1, 1], a);
      } else
        o.text("");
    });
  },
  expandArc: function(t) {
    var e = this, n = e.state.transiting, a = e.$el;
    if (n) {
      var i = setInterval(function() {
        n || (clearInterval(i), a.legend.selectAll(".".concat(gt.legendItemFocused)).size() > 0 && e.expandArc(t));
      }, 10);
      return;
    }
    var r = e.mapToTargetIds(t);
    a.svg.selectAll(e.selectorTargets(r, ".".concat(at.chartArc))).each(function(o) {
      if (e.shouldExpand(o.data.id)) {
        var s = e.getExpandConfig(o.data.id, "duration"), l = e.getSvgArcExpanded(e.getExpandConfig(o.data.id, "rate"));
        N(this).selectAll("path").transition().duration(s).attrTween("d", ui(e.svgArcExpanded.bind(e))).transition().duration(s * 2).attrTween("d", ui(l.bind(e)));
      }
    });
  },
  unexpandArc: function(t) {
    var e = this, n = e.state.transiting, a = e.$el.svg;
    if (!n) {
      var i = e.mapToTargetIds(t);
      a.selectAll(e.selectorTargets(i, ".".concat(at.chartArc))).selectAll("path").transition().duration(function(r) {
        return e.getExpandConfig(r.data.id, "duration");
      }).attrTween("d", ui(e.svgArc.bind(e))), a.selectAll("".concat(at.arc)).style("opacity", null);
    }
  },
  /**
   * Get expand config value
   * @param {string} id data ID
   * @param {string} key config key: 'duration | rate'
   * @returns {number}
   * @private
   */
  getExpandConfig: function(t, e) {
    var n = this, a = n.config, i = {
      duration: 50,
      rate: 0.98
    }, r;
    return n.isDonutType(t) ? r = "donut" : n.isGaugeType(t) ? r = "gauge" : n.isPieType(t) && (r = "pie"), r ? a["".concat(r, "_expand_").concat(e)] : i[e];
  },
  shouldExpand: function(t) {
    var e = this, n = e.config;
    return e.isDonutType(t) && n.donut_expand || e.isGaugeType(t) && n.gauge_expand || e.isPieType(t) && n.pie_expand;
  },
  shouldShowArcLabel: function() {
    var t = this, e = t.config;
    return ["donut", "gauge", "pie", "polar"].some(function(n) {
      return t.hasType(n) && e["".concat(n, "_label_show")];
    });
  },
  getArcLabelConfig: function(t) {
    t === void 0 && (t = "format");
    var e = this, n = e.config, a = function(i) {
      return i;
    };
    return ["donut", "gauge", "pie", "polar"].filter(e.hasType.bind(e)).forEach(function(i) {
      a = n["".concat(i, "_label_").concat(t)];
    }), t === "format" && U(a) ? a.bind(e.api) : a;
  },
  updateTargetsForArc: function(t) {
    var e = this, n = e.$el, a = e.hasType("gauge"), i = e.getChartClass("Arc"), r = e.getClass("arcs", !0), o = e.classFocus.bind(e), s = n.main.select(".".concat(at.chartArcs)), l = s.selectAll(".".concat(at.chartArc)).data(e.pie(t)).attr("class", function(u) {
      return i(u) + o(u.data);
    }), c = l.enter().append("g").attr("class", i).call(this.setCssRule(!1, ".".concat(at.chartArcs, " text"), [
      "pointer-events:none",
      "text-anchor:middle"
    ]));
    c.append("g").attr("class", r).merge(l), c.append("text").attr("dy", a && !e.hasMultiTargets() ? "-.1em" : null).style("opacity", "0").style("text-anchor", e.getStylePropValue("middle")).style("pointer-events", e.getStylePropValue("none")), n.text = s.selectAll(".".concat(j.target, " text"));
  },
  initArc: function() {
    var t = this, e = t.$el;
    e.arcs = e.main.select(".".concat(j.chart)).append("g").attr("class", at.chartArcs).attr("transform", t.getTranslate("arc")), t.setArcTitle();
  },
  /**
   * Set arc title text
   * @param {string} str Title text
   * @private
   */
  setArcTitle: function(t) {
    var e = this, n = t || e.getArcTitle(), a = e.hasType("gauge");
    if (n) {
      var i = a ? Vt.chartArcsGaugeTitle : at.chartArcsTitle, r = e.$el.arcs.select(".".concat(i));
      r.empty() && (r = e.$el.arcs.append("text").attr("class", i).style("text-anchor", "middle")), a && r.attr("dy", "-0.3em"), an(r, n, a ? void 0 : [-0.6, 1.35], !0);
    }
  },
  /**
   * Return arc title text
   * @returns {string} Arc title text
   * @private
   */
  getArcTitle: function() {
    var t = this, e = t.hasType("donut") && "donut" || t.hasType("gauge") && "gauge";
    return e ? t.config["".concat(e, "_title")] : "";
  },
  /**
   * Get arc title text with needle value
   * @returns {string|boolean} When title contains needle template string will return processed string, otherwise false
   * @private
   */
  getArcTitleWithNeedleValue: function() {
    var t = this, e = t.config, n = t.state, a = t.getArcTitle();
    if (a && t.config.arc_needle_show && /{=[A-Z_]+}/.test(a)) {
      var i = n.current.needle;
      return q(i) || (i = e.arc_needle_value), zn(a, {
        NEEDLE_VALUE: ~~i
      });
    }
    return !1;
  },
  redrawArc: function(t, e, n) {
    var a = this, i = a.config, r = a.state, o = a.$el.main, s = i.interaction_enabled, l = s && i.data_selection_isselectable, c = o.selectAll(".".concat(at.arcs)).selectAll(".".concat(at.arc)).data(a.arcData.bind(a));
    c.exit().transition().duration(e).style("opacity", "0").remove(), c = c.enter().append("path").attr("class", a.getClass("arc", !0)).style("fill", function(u) {
      return a.color(u.data);
    }).style("cursor", function(u) {
      var f;
      return !((f = l?.bind) === null || f === void 0) && f.call(l, a.api)(u) ? "pointer" : null;
    }).style("opacity", "0").each(function(u) {
      a.isGaugeType(u.data) && (u.startAngle = i.gauge_startingAngle, u.endAngle = i.gauge_startingAngle), this._current = u;
    }).merge(c), a.hasType("gauge") && (a.updateGaugeMax(), a.hasMultiArcGauge() && a.redrawArcGaugeLine()), c.attr("transform", function(u) {
      return !a.isGaugeType(u.data) && n ? "scale(0)" : "";
    }).style("opacity", function(u) {
      return u === this._current ? "0" : null;
    }).each(function() {
      r.transiting = !0;
    }).transition().duration(t).attrTween("d", function(u) {
      var f = a.updateAngle(u);
      if (!f)
        return function() {
          return "M 0 0";
        };
      isNaN(this._current.startAngle) && (this._current.startAngle = 0), isNaN(this._current.endAngle) && (this._current.endAngle = this._current.startAngle);
      var h = ln(this._current, f);
      return this._current = h(0), function(d) {
        var v = h(d);
        return v.data = u.data, a.getArc(v, !0);
      };
    }).attr("transform", n ? "scale(1)" : "").style("fill", function(u) {
      var f;
      return a.levelColor ? (f = a.levelColor(u.data.values[0].value), i.data_colors[u.data.id] = f) : f = a.color(u.data), f;
    }).style("opacity", null).call(wa, function() {
      if (a.levelColor) {
        var u = N(this), f = u.datum(this._current);
        a.updateLegendItemColor(f.data.id, u.style("fill"));
      }
      r.transiting = !1, pt(i.onrendered, a.api);
    }), s && a.bindArcEvent(c), a.hasType("polar") && a.redrawPolar(), a.hasType("gauge") && a.redrawBackgroundArcs(), i.arc_needle_show && a.redrawNeedle(), a.redrawArcText(t), a.redrawArcRangeText();
  },
  /**
   * Update needle element
   * @private
   */
  redrawNeedle: function() {
    var t = this, e = t.$el, n = t.config, a = t.state, i = a.hiddenTargetIds, r = a.radius, o = (r - 1) / 100 * n.arc_needle_length, s = i.length !== t.data.targets.length, l = t.$el.arcs.select(".".concat(at.needle)), c = n.arc_needle_path, u = n.arc_needle_bottom_width / 2, f = n.arc_needle_top_width / 2, h = n.arc_needle_top_rx, d = n.arc_needle_top_ry, v = n.arc_needle_bottom_len, _ = n.arc_needle_bottom_rx, p = n.arc_needle_bottom_ry, g = t.getNeedleAngle(), x = function() {
      var m = t.getArcTitleWithNeedleValue();
      m && t.setArcTitle(m);
    };
    if (x(), l.empty() && (l = e.arcs.append("path").classed(at.needle, !0), e.needle = l, e.needle.updateHelper = function(m, T) {
      T === void 0 && (T = !1), e.needle.style("display") !== "none" && t.$T(e.needle).style("transform", "rotate(".concat(t.getNeedleAngle(m), "deg)")).call(wa, function() {
        T && (n.arc_needle_value = m), x();
      });
    }), s) {
      var y = U(c) ? c.call(t, o) : "M-".concat(u, " ").concat(v, " A").concat(_, " ").concat(p, " 0 0 0 ").concat(u, " ").concat(v, " L").concat(f, " -").concat(o, " A").concat(h, " ").concat(d, " 0 0 0 -").concat(f, " -").concat(o, " L-").concat(u, " ").concat(v, " Z");
      t.$T(l).attr("d", y).style("fill", n.arc_needle_color).style("display", null).style("transform", "rotate(".concat(g, "deg)"));
    } else
      l.style("display", "none");
  },
  /**
   * Get needle angle value relative given value
   * @param {number} v Value to be calculated angle
   * @returns {number} angle value
   * @private
   */
  getNeedleAngle: function(t) {
    var e = this, n = e.config, a = e.state, i = e.getArcLength(), r = e.hasType("gauge"), o = e.getTotalDataSum(!0), s = vt(t) ? t : n.arc_needle_value, l = n["".concat(n.data_type, "_startingAngle")] || 0, c = 0;
    if (q(s) || (s = r && e.data.targets.length === 1 ? o : 0), a.current.needle = s, r) {
      l = e.getStartingAngle();
      var u = n.gauge_fullCircle ? i : l * -2, f = n.gauge_min, h = n.gauge_max;
      c = u * ((s - f) / (h - f));
    } else
      c = i * (s / o);
    return (l + c) * (180 / Math.PI);
  },
  redrawBackgroundArcs: function() {
    var t = this, e = t.config, n = t.state, a = t.hasMultiArcGauge(), i = e.gauge_fullCircle, r = t.filterTargetsToShow(t.data.targets).length === 0 && !!e.data_empty_label_text, o = t.getStartingAngle(), s = i ? o + t.getArcLength() : o * -1, l = t.$el.arcs.select("".concat(a ? "g" : "", ".").concat(at.chartArcsBackground));
    if (a) {
      var c = 0;
      l = l.selectAll("path.".concat(at.chartArcsBackground)).data(t.data.targets), l.enter().append("path").attr("class", function(u, f) {
        return "".concat(at.chartArcsBackground, " ").concat(at.chartArcsBackground, "-").concat(f);
      }).merge(l).style("fill", e.gauge_background || null).attr("d", function(u) {
        var f = u.id;
        if (r || n.hiddenTargetIds.indexOf(f) >= 0)
          return "M 0 0";
        var h = {
          data: [{ value: e.gauge_max }],
          startAngle: o,
          endAngle: s,
          index: c++
        };
        return t.getArc(h, !0, !0);
      }), l.exit().remove();
    } else
      l.attr("d", r ? "M 0 0" : function() {
        var u = {
          data: [{ value: e.gauge_max }],
          startAngle: o,
          endAngle: s
        };
        return t.getArc(u, !0, !0);
      });
  },
  bindArcEvent: function(t) {
    var e = this, n = e.config, a = e.state, i = a.inputType === "touch", r = a.inputType === "mouse";
    function o(c, u, f) {
      e.expandArc(f), e.api.focus(f), e.toggleFocusLegend(f, !0), e.showTooltip([u], c);
    }
    function s(c) {
      var u = void 0;
      e.unexpandArc(u), e.api.revert(), e.revertLegend(), e.hideTooltip();
    }
    if (t.on("click", function(c, u, f) {
      var h, d = e.updateAngle(u), v;
      d && (v = e.convertToArcData(d), (h = e.toggleShape) === null || h === void 0 || h.call(e, this, v, f), n.data_onclick.bind(e.api)(v, this));
    }), r && t.on("mouseover", function(c, u) {
      if (!a.transiting) {
        a.event = c;
        var f = e.updateAngle(u), h = f ? e.convertToArcData(f) : null, d = h?.id || void 0;
        o(this, h, d), e.setOverOut(!0, h);
      }
    }).on("mouseout", function(c, u) {
      if (!(a.transiting || !n.interaction_onout)) {
        a.event = c;
        var f = e.updateAngle(u), h = f ? e.convertToArcData(f) : null;
        s(), e.setOverOut(!1, h);
      }
    }).on("mousemove", function(c, u) {
      var f = e.updateAngle(u), h = f ? e.convertToArcData(f) : null;
      a.event = c, e.showTooltip([h], this);
    }), i && e.hasArcType() && !e.radars) {
      var l = function(c) {
        var u, f, h = (f = (u = c.changedTouches) === null || u === void 0 ? void 0 : u[0]) !== null && f !== void 0 ? f : { clientX: 0, clientY: 0 }, d = h.clientX, v = h.clientY, _ = N(mt.elementFromPoint(d, v));
        return _;
      };
      e.$el.svg.on("touchstart touchmove", function(c) {
        if (!a.transiting) {
          a.event = c;
          var u = l(c), f = u.datum(), h = f?.data && f.data.id ? e.updateAngle(f) : null, d = h ? e.convertToArcData(h) : null, v = d?.id || void 0;
          e.callOverOutForTouch(d), St(v) ? s() : o(this, d, v);
        }
      }, { passive: !0 });
    }
  },
  redrawArcText: function(t) {
    var e = this, n = e.config, a = e.state, i = e.$el, r = i.main, o = i.arcs, s = e.hasType("gauge"), l = e.hasMultiArcGauge(), c;
    if (s && e.data.targets.length === 1 && n.gauge_title || (c = r.selectAll(".".concat(at.chartArc)).select("text").style("opacity", "0").attr("class", function(f) {
      return e.isGaugeType(f.data) ? Vt.gaugeValue : null;
    }).call(e.textForArcLabel.bind(e)).style("font-size", function(f) {
      return e.isGaugeType(f.data) && e.data.targets.length === 1 && !l ? "".concat(Math.round(a.radius / 5), "px") : null;
    }), $l.call(e), c.attr("transform", function(f) {
      return e.transformForArcLabel.bind(e)(this, f);
    }).transition().duration(t).style("opacity", function(f) {
      return e.isTargetToShow(f.data.id) && e.isArcType(f.data) ? null : "0";
    }), l && c.attr("dy", "-.1em")), r.select(".".concat(at.chartArcsTitle)).style("opacity", e.hasType("donut") || s ? null : "0"), s) {
      var u = n.gauge_fullCircle;
      u && c?.attr("dy", "".concat(l ? 0 : Math.round(a.radius / 14))), n.gauge_label_show && (o.select(".".concat(Vt.chartArcsGaugeUnit)).attr("dy", "".concat(u ? 1.5 : 0.75, "em")).text(n.gauge_units), o.select(".".concat(Vt.chartArcsGaugeMin)).attr("dx", "".concat(-1 * (a.innerRadius + (a.radius - a.innerRadius) / (u ? 1 : 2)), "px")).attr("dy", "1.2em").text(e.textForGaugeMinMax(n.gauge_min, !1)), !u && o.select(".".concat(Vt.chartArcsGaugeMax)).attr("dx", "".concat(a.innerRadius + (a.radius - a.innerRadius) / 2, "px")).attr("dy", "1.2em").text(e.textForGaugeMinMax(n.gauge_max, !0)));
    }
    Po.call(e) && s0.call(e, t);
  },
  /**
   * Get Arc element by id or index
   * @param {string|number} value id or index of Arc
   * @returns {d3Selection} Arc path element
   * @private
   */
  getArcElementByIdOrIndex: function(t) {
    var e = this, n = e.$el.arcs, a = q(t) ? function(i) {
      return i.index === t;
    } : function(i) {
      return i.data.id === t;
    };
    return n?.selectAll(".".concat(j.target, " path")).filter(a);
  }
}, fn = {
  initArea: function(t) {
    var e = this, n = e.config;
    t.insert("g", ".".concat(n.area_front ? Ft.circles : ue.lines)).attr("class", e.getClass("areas", !0));
  },
  /**
   * Update area color
   * @param {object} d Data object
   * @returns {string} Color string
   * @private
   */
  updateAreaColor: function(t) {
    var e = this;
    return e.config.area_linearGradient ? e.getGradienColortUrl(t.id) : e.color(t);
  },
  /**
   * Generate/Update elements
   * @param {boolean} withTransition Transition for exit elements
   * @param {boolean} isSub Subchart draw
   * @private
   */
  updateArea: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = n.config, i = n.state, r = n.$el, o = n.$T, s = e ? r.subchart : r;
    a.area_linearGradient && n.updateLinearGradient();
    var l = s.main.selectAll(".".concat($a.areas)).selectAll(".".concat($a.area)).data(n.lineData.bind(n));
    o(l.exit(), t).style("opacity", "0").remove(), s.area = l.enter().append("path").attr("class", n.getClass("area", !0)).style("fill", n.updateAreaColor.bind(n)).style("opacity", function() {
      return i.orgAreaOpacity = N(this).style("opacity"), "0";
    }).merge(l), l.style("opacity", i.orgAreaOpacity), n.setRatioForGroupedData(s.area.data());
  },
  /**
   * Redraw function
   * @param {function} drawFn Retuned functino from .generateDrawCandlestick()
   * @param {boolean} withTransition With or without transition
   * @param {boolean} isSub Subchart draw
   * @returns {Array}
   */
  redrawArea: function(t, e, n) {
    n === void 0 && (n = !1);
    var a = this, i = (n ? this.$el.subchart : this.$el).area, r = a.state.orgAreaOpacity;
    return [
      a.$T(i, e, re()).attr("d", t).style("fill", a.updateAreaColor.bind(a)).style("opacity", function(o) {
        return String(a.isAreaRangeType(o) ? r / 1.75 : r);
      })
    ];
  },
  /**
   * Generate area path data
   * @param {object} areaIndices Indices
   * @param {boolean} isSub Weather is sub axis
   * @returns {function}
   * @private
   */
  generateDrawArea: function(t, e) {
    var n = this, a = n.config, i = a.line_connectNull, r = a.axis_rotated, o = n.generateGetAreaPoints(t, e), s = n.getYScaleById.bind(n), l = function(f) {
      return (e ? n.subxx : n.xx).call(n, f);
    }, c = function(f, h) {
      return n.isGrouped(f.id) ? o(f, h)[0][1] : s(f.id, e)(n.isAreaRangeType(f) ? n.getRangedData(f, "high") : n.getShapeYMin(f.id));
    }, u = function(f, h) {
      return n.isGrouped(f.id) ? o(f, h)[1][1] : s(f.id, e)(n.isAreaRangeType(f) ? n.getRangedData(f, "low") : f.value);
    };
    return function(f) {
      var h = i ? n.filterRemoveNull(f.values) : f.values, d = 0, v = 0, _;
      if (n.isAreaType(f)) {
        var p = Iv();
        p = r ? p.y(l).x0(c).x1(u) : p.x(l).y0(a.area_above ? 0 : a.area_below ? n.state.height : c).y1(u), i || (p = p.defined(function(g) {
          return n.getBaseValue(g) !== null;
        })), n.isStepType(f) && (h = n.convertValuesToStep(h)), _ = p.curve(n.getCurve(f))(h);
      } else
        h[0] && (d = n.scale.x(h[0].x), v = n.getYScaleById(f.id)(h[0].value)), _ = r ? "M ".concat(v, " ").concat(d) : "M ".concat(d, " ").concat(v);
      return _ || "M 0 0";
    };
  },
  generateGetAreaPoints: function(t, e) {
    var n = this, a = n.config, i = n.getShapeX(0, t, e), r = n.getShapeY(!!e), o = n.getShapeOffset(n.isAreaType, t, e), s = n.getYScaleById.bind(n);
    return function(l, c) {
      var u = s.call(n, l.id, e)(n.getShapeYMin(l.id)), f = o(l, c) || u, h = i(l), d = l.value, v = r(l);
      return a.axis_rotated && (d > 0 && v < u || d < 0 && u < v) && (v = u), [
        [h, f],
        [h, v - (u - f)],
        [h, v - (u - f)],
        // needed for compatibility
        [h, f]
        // needed for compatibility
      ];
    };
  }
};
function fi(t) {
  var e = this.config.bar_connectLine, n = e?.[t] || e;
  return /^(start|end)\-(start|end)$/.test(n) ? n : null;
}
var d0 = {
  initBar: function() {
    var t = this, e = t.$el, n = t.config, a = t.state.clip;
    e.bar = e.main.select(".".concat(j.chart)), e.bar = n.bar_front ? e.bar.append("g") : e.bar.insert("g", ":first-child"), e.bar.attr("class", Yt.chartBars).call(this.setCssRule(!1, ".".concat(Yt.chartBars), ["pointer-events:none"])), n.clipPath === !1 && (n.bar_radius || n.bar_radius_ratio) && e.bar.attr("clip-path", a.pathXAxis.replace(/#[^)]*/, "#".concat(a.id)));
  },
  updateTargetsForBar: function(t) {
    var e = this, n = e.config, a = e.$el, i = e.getChartClass("Bar"), r = e.getClass("bars", !0), o = e.classFocus.bind(e), s = n.interaction_enabled && n.data_selection_isselectable;
    a.bar || e.initBar();
    var l = a.main.select(".".concat(Yt.chartBars)).selectAll(".".concat(Yt.chartBar)).data(e.filterNullish(t)).attr("class", function(u) {
      return i(u) + o(u);
    }), c = l.enter().append("g").attr("class", i).style("opacity", "0").style("pointer-events", e.getStylePropValue("none"));
    c.append("g").attr("class", r).style("cursor", function(u) {
      var f;
      return !((f = s?.bind) === null || f === void 0) && f.call(s, e.api)(u) ? "pointer" : null;
    }).call(function(u) {
      e.setCssRule(!0, " .".concat(Yt.bar), ["fill"], e.color)(u), u.each(function(f) {
        fi.call(e, f.id) && N(this).append("path").attr("class", Yt.barConnectLine);
      });
    });
  },
  /**
   * Generate/Update elements
   * @param {boolean} withTransition Transition for exit elements
   * @param {boolean} isSub Subchart draw
   * @private
   */
  updateBar: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = n.config, i = n.$el, r = n.$T, o = e ? i.subchart : i, s = n.getClass("bar", !0), l = n.initialOpacity.bind(n);
    a.bar_linearGradient && n.updateLinearGradient();
    var c = o.main.selectAll(".".concat(Yt.bars)).selectAll(".".concat(Yt.bar)).data(n.labelishData.bind(n));
    r(c.exit(), t).style("opacity", "0").remove(), o.bar = c.enter().append("path").attr("class", s).style("fill", n.updateBarColor.bind(n)).merge(c).style("opacity", l), n.setRatioForGroupedData(o.bar.data());
  },
  /**
   * Update bar color
   * @param {object} d Data object
   * @returns {string} Color string
   * @private
   */
  updateBarColor: function(t) {
    var e = this, n = e.getStylePropValue(e.color);
    return e.config.bar_linearGradient ? e.getGradienColortUrl(t.id) : n ? n(t) : null;
  },
  /**
   * Redraw function
   * @param {function} drawFn Retuned function from .getDrawShape() => .generateDrawBar()
   * @param {boolean} withTransition With or without transition
   * @param {boolean} isSub Subchart draw
   * @returns {Array}
   * @private
   */
  redrawBar: function(t, e, n) {
    n === void 0 && (n = !1);
    var a = this, i = (n ? a.$el.subchart : a.$el).bar, r = [];
    return [
      a.$T(i, e, re()).attr("d", function(o, s, l) {
        var c = (q(o.value) || a.isBarRangeType(o)) && t(o, s), u = fi.call(a, o.id);
        if (c.length > 1 && (r.push(c[1]), s === l.length - 1)) {
          var f = a.$T(N(this.parentNode.querySelector(".".concat(Yt.barConnectLine))), e, re());
          a.updateConnectLine(f, u, r), r.splice(0);
        }
        return c[0];
      }).style("fill", a.updateBarColor.bind(a)).style("clip-path", function(o) {
        return o.clipPath;
      }).style("opacity", null)
    ];
  },
  /**
   * Generate draw function
   * @param {object} barIndices data order within x axis.
   * barIndices ==> {data1: 0, data2: 0, data3: 1, data4: 1, __max__: 1}
   *
   * When gropus given as:
   *  groups: [
   * 		["data1", "data2"],
   * 		["data3", "data4"]
   * 	],
   *
   * Will be rendered as:
   * 		data1 data3   data1 data3
   * 		data2 data4   data2 data4
   * 		-------------------------
   * 			 0             1
   * @param {boolean} isSub If is for subchart
   * @returns {function}
   * @private
   */
  generateDrawBar: function(t, e) {
    var n = this, a = n.config, i = n.generateGetBarPoints(t, e), r = a.axis_rotated, o = a.bar_radius, s = a.bar_radius_ratio, l = q(o) && o > 0 ? function() {
      return o;
    } : q(s) ? function(c) {
      return c * s;
    } : null;
    return function(c, u) {
      var f = i(c, u), h = +r, d = +!h, v = c.value < 0, _ = a["axis_".concat(n.axis.getId(c.id), "_inverted")], p = !_ && v || _ && !v, g = ["", ""], x = n.isGrouped(c.id), y = l && x ? n.isStackingRadiusData(c) : !1, m = [
        f[0][h],
        f[0][d]
      ], T = 0;
      if (c.clipPath = null, l) {
        var b = r ? d : h, w = f[2][b] - f[0][b];
        T = !x || y ? l(w) : 0;
        var A = "a".concat(T, " ").concat(T, " ").concat(p ? "1 0 0" : "0 0 1", " ");
        g[+!r] = "".concat(A).concat(T, ",").concat(T), g[+r] = "".concat(A).concat([-T, T][r ? "sort" : "reverse"]()), p && g.reverse();
      }
      var k = r ? f[1][h] + (p ? T : -T) : f[1][d] + (p ? -T : T);
      if (T) {
        var C = "";
        r ? p && m[0] < k ? C = "0 ".concat(k - m[0], "px 0 0") : !p && m[0] > k && (C = "0 0 0 ".concat(m[0] - k, "px")) : p && m[1] > k ? C = "".concat(m[1] - k, "px 0 0 0") : !p && m[1] < k && (C = "0 0 ".concat(k - m[1], "px 0")), C && (c.clipPath = "inset(".concat(C, ")"));
      }
      var E = r ? "H".concat(k, " ").concat(g[0], "V").concat(f[2][d] - T, " ").concat(g[1], "H").concat(f[3][h]) : "V".concat(k, " ").concat(g[0], "H").concat(f[2][h] - T, " ").concat(g[1], "V").concat(f[3][d]), M = ["M".concat(f[0][h], ",").concat(f[0][d]).concat(E, "z")];
      return fi.call(n, c.id) && M.push(r ? {
        x: f[0][h],
        y: f[0][d],
        width: f[0][h] - k,
        height: f[2][d] - f[0][d]
      } : {
        x: f[0][h],
        y: k,
        width: f[2][h] - f[0][h],
        height: f[3][d] - k
      }), M;
    };
  },
  /**
   * Determine if given stacking bar data is radius type
   * @param {object} d Data row
   * @returns {boolean}
   */
  isStackingRadiusData: function(t) {
    var e = this, n = e.$el, a = e.config, i = e.data, r = e.state, o = t.id, s = t.index, l = t.value;
    if (r.hiddenTargetIds.indexOf(o) > -1) {
      var c = n.bar.filter(function(d) {
        return d.id === o && d.value === l;
      });
      return !c.empty() && /a\d+/i.test(c.attr("d"));
    }
    var u = a.data_groups.find(function(d) {
      return d.indexOf(o) > -1;
    }), f = e.orderTargets(e.filterTargetsToShow(i.targets.filter(e.isBarType, e))).filter(function(d) {
      return u.indexOf(d.id) > -1;
    }), h = f.map(function(d) {
      return d.values.filter(function(v) {
        return v.index === s && (q(l) && l > 0 ? v.value > 0 : v.value < 0);
      })[0];
    }).filter(Boolean).map(function(d) {
      return d.id;
    });
    return l !== 0 && h.indexOf(o) === h.length - 1;
  },
  /**
   * Generate bar coordinate points data
   * @param {object} barIndices Data order within x axis.
   * @param {boolean} isSub If is for subchart
   * @returns {Array} Array of coordinate points
   * @private
   */
  generateGetBarPoints: function(t, e) {
    var n = this, a = n.config, i = e ? n.axis.subX : n.axis.x, r = n.getIndicesMax(t) + 1, o = n.getBarW("bar", i, r), s = n.getShapeX(o, t, !!e), l = n.getShapeY(!!e), c = n.getShapeOffset(n.isBarType, t, !!e), u = n.getYScaleById.bind(n);
    return function(f, h) {
      var d = f.id, v = u.call(n, d, e)(n.getShapeYMin(d)), _ = c(f, h) || v, p = q(o) ? o : o[f.id] || o._$width, g = a["axis_".concat(n.axis.getId(d), "_inverted")], x = f.value, y = s(f), m = l(f);
      a.axis_rotated && !g && (x > 0 && m < v || x < 0 && v < m) && (m = v), n.isBarRangeType(f) || (m -= v - _);
      var T = y + p;
      return [
        [y, _],
        [y, m],
        [T, m],
        [T, _]
      ];
    };
  },
  /**
   * Update the bar connect line path
   * @param {d3Selection} node d3 selection of bar connect line
   * @param {string} type Type of connect line, one of "start-start", "start-end", "end-start", "end-end"
   * @param {Array} barPath d3 path data for the bar
   */
  updateConnectLine: function(t, e, n) {
    var a = this, i = n.map(function(r, o, s) {
      var l = a.config.axis_rotated, c = /^start-(start|end)$/.test(e), u = /^end-(start|end)$/.test(e), f = [], h = l ? u ? r.x - r.width : r.x : r.x + r.width, d = l || c ? r.y + r.height : r.y;
      return o === 0 ? f.push("".concat(h, ",").concat(d)) : (f.push(l ? "L".concat(r.x - (/\w+-end$/.test(e) ? r.width : 0), ",").concat(r.y) : "L".concat(r.x, ",").concat(r.y + (/\w+-start$/.test(e) ? r.height : 0))), o < s.length - 1 && f.push("M".concat(h, ",").concat(d))), f.join(" ");
    });
    t.attr("d", "M".concat(i.join(""), "z"));
  }
}, v0 = {
  /**
   * Initializer
   * @private
   */
  initBubble: function() {
    var t = this, e = t.config;
    t.hasType("bubble") && (e.point_show = !0, e.point_type = "circle");
  },
  /**
   * Get user agent's computed value
   * @returns {number}
   * @private
   */
  getBaseLength: function() {
    var t = this, e = t.state, n = e.width, a = e.height, i = $t.bubbleBaseLength, r = t.cache.get(i);
    return r || t.cache.add(i, r = Qt("min", [n, a])), r;
  },
  /**
   * Get the radius value for bubble circle
   * @param {object} d Data object
   * @returns {number}
   * @private
   */
  getBubbleR: function(t) {
    var e = this, n = e.config.bubble_maxR;
    U(n) ? n = n.bind(e.api)(t) : q(n) || (n = e.getBaseLength() / (e.getMaxDataCount() * 2) + 12);
    var a = Qt("max", e.getMinMaxData().max.map(function(o) {
      return e.isBubbleZType(o) ? e.getBubbleZData(o.value, "y") : ct(o.value) ? o.value.mid : o.value;
    })), i = n * n * Math.PI, r = (e.isBubbleZType(t) ? e.getBubbleZData(t.value, "z") : t.value) * (i / a);
    return Math.sqrt(r / Math.PI);
  },
  /**
   * Get bubble dimension data
   * @param {object|Array} d data value
   * @param {string} type - y or z
   * @returns {number}
   * @private
   */
  getBubbleZData: function(t, e) {
    return ct(t) ? t[e] : t[e === "y" ? 0 : 1];
  }
}, g0 = {
  initCandlestick: function() {
    var t = this.$el;
    t.candlestick = t.main.select(".".concat(j.chart)).append("g").attr("class", ce.chartCandlesticks);
  },
  /**
   * Update targets by its data
   * called from: ChartInternal.updateTargets()
   * @param {Array} targets Filtered target by type
   * @private
   */
  updateTargetsForCandlestick: function(t) {
    var e = this, n = e.$el, a = e.getChartClass("Candlestick");
    n.candlestick || e.initCandlestick();
    var i = e.$el.main.select(".".concat(ce.chartCandlesticks)).selectAll(".".concat(ce.chartCandlestick)).data(e.filterNullish(t));
    i.enter().append("g").attr("class", a).style("pointer-events", "none");
  },
  /**
   * Generate/Update elements
   * @param {boolean} withTransition Transition for exit elements
   * @param {boolean} isSub Subchart draw
   * @private
   */
  updateCandlestick: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = n.$el, i = n.$T, r = e ? a.subchart : a, o = n.getClass("candlestick", !0), s = n.initialOpacity.bind(n), l = r.main.selectAll(".".concat(ce.chartCandlestick)).selectAll(".".concat(ce.candlestick)).data(n.labelishData.bind(n));
    i(l.exit(), t).style("opacity", "0").remove();
    var c = l.enter().filter(function(u) {
      return u.value;
    }).append("g").attr("class", o);
    c.append("line"), c.append("path"), r.candlestick = l.merge(c).style("opacity", s);
  },
  /**
   * Get draw function
   * @param {object} indices Indice data
   * @param {boolean} isSub Subchart draw
   * @returns {function}
   * @private
   */
  generateDrawCandlestick: function(t, e) {
    var n = this, a = n.config, i = n.generateGetCandlestickPoints(t, e), r = a.axis_rotated, o = a.candlestick_color_down;
    return function(s, l, c) {
      var u = i(s, l), f = n.getCandlestickData(s), h = f?._isUp, d = +r, v = +!d;
      c.classed && c.classed(ce[h ? "valueUp" : "valueDown"], !0);
      var _ = r ? "H".concat(u[1][1], " V").concat(u[1][0], " H").concat(u[0][1]) : "V".concat(u[1][1], " H").concat(u[1][0], " V").concat(u[0][1]);
      c.select("path").attr("d", "M".concat(u[0][d], ",").concat(u[0][v]).concat(_, "z")).style("fill", function(y) {
        var m = h ? n.color(y) : ct(o) ? o[y.id] : o;
        return m || n.color(y);
      });
      var p = c.select("line"), g = r ? {
        x1: u[2][1],
        x2: u[2][2],
        y1: u[2][0],
        y2: u[2][0]
      } : {
        x1: u[2][0],
        x2: u[2][0],
        y1: u[2][1],
        y2: u[2][2]
      };
      for (var x in g)
        p.attr(x, g[x]);
    };
  },
  /**
   * Generate shape drawing points
   * @param {object} indices Indice data
   * @param {boolean} isSub Subchart draw
   * @returns {function}
   */
  generateGetCandlestickPoints: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = e ? n.axis.subX : n.axis.x, i = n.getIndicesMax(t) + 1, r = n.getBarW("candlestick", a, i), o = n.getShapeX(r, t, !!e), s = n.getShapeY(!!e), l = n.getShapeOffset(n.isBarType, t, !!e), c = n.getYScaleById.bind(n);
    return function(u, f) {
      var h = c.call(n, u.id, e)(n.getShapeYMin(u.id)), d = l(u, f) || h, v = q(r) ? r : r[u.id] || r._$width, _ = n.getCandlestickData(u), p;
      if (_ && q(_.open) && q(_.close)) {
        var g = {
          start: o(u),
          end: 0
        };
        g.end = g.start + v;
        var x = {
          start: s(_.open),
          end: s(_.close)
        }, y = {
          x: g.start + v / 2,
          high: s(_.high),
          low: s(_.low)
        };
        x.start -= h - d, p = [
          [g.start, x.start],
          [g.end, x.end],
          [y.x, y.low, y.high]
        ];
      } else
        p = [[0, 0], [0, 0], [0, 0, 0]];
      return p;
    };
  },
  /**
   * Redraw function
   * @param {function} drawFn Retuned functino from .generateDrawCandlestick()
   * @param {boolean} withTransition With or without transition
   * @param {boolean} isSub Subchart draw
   * @returns {Array}
   */
  redrawCandlestick: function(t, e, n) {
    n === void 0 && (n = !1);
    var a = this, i = a.$el, r = a.$T, o = (n ? i.subchart : i).candlestick, s = re(!0);
    return [
      o.each(function(l, c) {
        var u = r(N(this), e, s);
        t(l, c, u);
      }).style("opacity", null)
    ];
  },
  /**
   * Get candlestick data as object
   * @param {object} param Data object
   * @param {Array|object} param.value Data value
   * @returns {object|null} Converted data object
   * @private
   */
  getCandlestickData: function(t) {
    var e = t.value, n;
    if (ft(e)) {
      var a = e[0], i = e[1], r = e[2], o = e[3], s = e[4], l = s === void 0 ? !1 : s;
      n = { open: a, high: i, low: r, close: o }, l !== !1 && (n.volume = l);
    } else ct(e) && (n = K({}, e));
    return n && (n._isUp = n.close >= n.open), n || null;
  }
};
function Fa(t) {
  t === void 0 && (t = !1);
  var e = this, n = e.config, a = e.state.current, i = a.width, r = a.height, o = e.getCurrentPadding(), s = K({ width: i - (o.left + o.right), height: r - (n.legend_show ? e.getLegendHeight() + 10 : 0) - (o.top + o.bottom) }, o);
  if (t) {
    var l = zl.call(e, {
      width: s.width,
      height: s.height
    }), c = l.width, u = l.height;
    s.width < c && (s.width = c), s.height < u && (s.height = u);
  }
  return s;
}
function zl(t) {
  var e, n = this, a = n.config, i = a.funnel_neck_width, r = a.funnel_neck_height;
  return e = [i, r].map(function(o, s) {
    var l = o;
    return ct(o) && (l = t[s ? "height" : "width"] * o.ratio), l;
  }), i = e[0], r = e[1], {
    width: i,
    height: r
  };
}
function p0(t) {
  var e = this, n = Fa.call(e, !0), a = n.top, i = n.left, r = n.width, o = [];
  return t.forEach(function(s, l) {
    var c = s.ratio, u = l > 0 ? o[l - 1][2][1] : a;
    o.push(s.coords = [
      [i, u],
      // M
      [i + r, u],
      // 1
      [i + r, l > 0 ? c + u : c + a],
      // 2
      [i, l > 0 ? c + u : c + a],
      // 3
      [i, u]
      // 4
    ]);
  }), o;
}
function Fo(t) {
  t === void 0 && (t = !1);
  var e = this, n = Fa.call(e, !0), a = n.width, i = n.height, r = n.top, o = n.left, s = zl.call(e, { width: a, height: i }), l = (a - s.width) / 2, c = (a + s.width) / 2, u = i - s.height, f = [
    [0, 0],
    // M
    [a, 0],
    // 1
    [c, u],
    // 2
    [c, i],
    // 3
    [l, i],
    // 4
    [l, u],
    // 5
    [0, 0]
    // 6
  ];
  return t && f.forEach(function(h) {
    h[0] += o, h[1] += r;
  }), "M".concat(f.join("L"), "z");
}
function _0(t) {
  var e = this, n = e.config, a = t.map(function(i) {
    return {
      id: i.id,
      value: i.values.reduce(function(r, o) {
        return r + o.value;
      }, 0)
    };
  });
  return n.data_order && a.sort(e.getSortCompareFn.bind(e)(!0)), Pl.call(e, a);
}
function Pl(t) {
  var e = this, n = Fa.call(e).height, a = e.getTotalDataSum(!0);
  return t.forEach(function(i) {
    i.ratio = i.value / a * n;
  }), t;
}
var x0 = {
  /**
   * Initialize polar
   * @private
   */
  initFunnel: function() {
    var t = this, e = t.$el;
    e.funnel = e.main.select(".".concat(j.chart)).append("g").classed(Cn.chartFunnels, !0), e.funnel.background = e.funnel.append("path").classed(Cn.funnelBackground, !0), t.bindFunnelEvent();
  },
  /**
   * Bind events
   * @private
   */
  bindFunnelEvent: function() {
    var t = this, e = t.$el.funnel, n = t.config, a = t.state, i = function(o) {
      var s, l = o.isTrusted ? o.target : (s = a.eventReceiver.rect) === null || s === void 0 ? void 0 : s.node(), c;
      return /^path$/i.test(l.tagName) && (a.event = o, c = N(l).datum()), c;
    };
    if (n.interaction_enabled) {
      var r = a.inputType === "touch";
      e.on(r ? "touchstart" : "mouseover mousemove", function(o) {
        var s = i(o);
        s && (t.showTooltip([s], o.target), /^(touchstart|mouseover)$/.test(o.type) && t.setOverOut(!0, s));
      }, r ? { passive: !0 } : void 0).on(r ? "touchend" : "mouseout", function(o) {
        var s = i(o);
        n.interaction_onout && (t.hideTooltip(), t.setOverOut(!1, s));
      });
    }
  },
  /**
   * Update polar based on given data array
   * @param {object} t Data object
   * @private
   */
  updateTargetsForFunnel: function(t) {
    var e = this, n = e.$el.funnel, a = e.getChartClass("Funnel"), i = e.getClass("funnel", !0);
    n || e.initFunnel();
    var r = _0.call(e, t.filter(e.isFunnelType.bind(e))), o = n.selectAll(".".concat(Cn.chartFunnel)).data(e.filterNullish(r));
    o.exit().remove();
    var s = o.enter().insert("g", ".".concat(Cn.funnelBackground));
    s.append("path"), n.path = s.merge(o).attr("class", function(l) {
      return a(l);
    }).select("path").attr("class", i).style("opacity", "0").style("fill", e.color);
  },
  /**
   * Update funnel path selection
   * @param {object} targets Updated target data
   * @private
   */
  updateFunnel: function(t) {
    var e = this, n = e.$el.funnel, a = t.map(function(i) {
      var r = i.id;
      return r;
    });
    n.path = n.path.filter(function(i) {
      return a.indexOf(i.id) >= 0;
    });
  },
  /**
   * Generate treemap coordinate points data
   * @returns {Array} Array of coordinate points
   * @private
   */
  generateGetFunnelPoints: function() {
    var t = this, e = t.$el.funnel, n = t.filterTargetsToShow(e.path), a = Fa.call(t), i = a.top, r = a.left, o = a.right, s = (r - o) / 2, l = {}, c = i ?? 0;
    return n.each(function(u, f) {
      var h;
      l[u.id] = [
        [s, c],
        [s, c += ((h = n?.[f]) !== null && h !== void 0 ? h : u).ratio]
      ];
    }), function(u) {
      return l[u.id];
    };
  },
  /**
   * Called whenever redraw happens
   * @private
   */
  redrawFunnel: function() {
    var t = this, e = t.$T, n = t.$el.funnel, a = t.filterTargetsToShow(n.path), i = p0.call(t, Pl.call(t, a.data()));
    n.attr("clip-path", "path('".concat(Fo.bind(t)(), "')")), n.background.attr("d", Fo.call(t, !0)), e(a).attr("d", function(r, o) {
      return "M".concat(i[o].join("L"), "z");
    }).style("opacity", "1"), n.selectAll("g").style("opacity", null);
  }
}, m0 = {
  initGauge: function() {
    var t = this, e = t.config, n = t.$el.arcs, a = function(r, o) {
      r === void 0 && (r = null), o === void 0 && (o = ""), n.append("text").attr("class", r).style("text-anchor", "middle").style("pointer-events", "none").text(o);
    };
    if (t.hasType("gauge")) {
      var i = t.hasMultiArcGauge();
      n.append(i ? "g" : "path").attr("class", at.chartArcsBackground).style("fill", !i && e.gauge_background || null), e.gauge_units && a(Vt.chartArcsGaugeUnit), e.gauge_label_show && (a(Vt.chartArcsGaugeMin), !e.gauge_fullCircle && a(Vt.chartArcsGaugeMax));
    }
  },
  updateGaugeMax: function() {
    var t = this, e = t.config, n = t.state, a = t.hasMultiArcGauge(), i = a ? t.getMinMaxData().max[0].value : t.getTotalDataSum(n.rendered);
    !e.gauge_enforceMinMax && i + e.gauge_min * (e.gauge_min > 0 ? -1 : 1) > e.gauge_max && (e.gauge_max = i - e.gauge_min);
  },
  redrawArcGaugeLine: function() {
    var t = this, e = t.config, n = t.state, a = t.$el, i = t.state.hiddenTargetIds, r = a.main.selectAll(".".concat(at.arcs)).selectAll(".".concat(at.arcLabelLine)).data(t.arcData.bind(t)), o = r.enter().append("rect").attr("class", function(s) {
      return "".concat(at.arcLabelLine, " ").concat(j.target, " ").concat(j.target, "-").concat(s.data.id);
    }).merge(r);
    o.style("fill", function(s) {
      return t.levelColor ? t.levelColor(s.data.values[0].value) : t.color(s.data);
    }).style("display", e.gauge_label_show ? null : "none").each(function(s) {
      var l = 0, c = 2, u = 0, f = 0, h = "";
      if (i.indexOf(s.data.id) < 0) {
        var d = t.updateAngle(s), v = n.gaugeArcWidth / t.filterTargetsToShow(t.data.targets).length * (d.index + 1), _ = d.endAngle - Math.PI / 2, p = n.radius - v, g = _ - (p === 0 ? 0 : 1 / p);
        l = n.radiusExpanded - n.radius + v, u = Math.cos(g) * p, f = Math.sin(g) * p, h = "rotate(".concat(_ * 180 / Math.PI, ", ").concat(u, ", ").concat(f, ")");
      }
      N(this).attr("x", u).attr("y", f).attr("width", l).attr("height", c).attr("transform", h).style("stroke-dasharray", "0, ".concat(l + c, ", 0"));
    });
  },
  textForGaugeMinMax: function(t, e) {
    var n = this, a = n.config, i = a.gauge_label_extents;
    return U(i) ? i.bind(n.api)(t, e) : t;
  },
  getGaugeLabelHeight: function() {
    var t = this.config;
    return this.config.gauge_label_show && !t.gauge_fullCircle ? 20 : 0;
  },
  getPaddingBottomForGauge: function() {
    var t = this;
    return t.getGaugeLabelHeight() * (t.config.gauge_label_show ? 2 : 2.5);
  }
};
function y0(t, e, n, a) {
  a === void 0 && (a = !1);
  for (var i = t ? [t, 0] : n, r = function(l) {
    n.forEach(function(c) {
      l + c <= e && i.push(c), l += c;
    }), o = l;
  }, o, s = t || n.reduce(function(l, c) {
    return l + c;
  }); s <= e; )
    r(s), s = o;
  return i.length % 2 !== 0 && i.push(a ? n[1] : 0), {
    dash: i.join(" "),
    length: i.reduce(function(l, c) {
      return l + c;
    }, 0)
  };
}
function b0(t, e, n) {
  var a = this, i = [], r = "2 2";
  if (vt(e))
    for (var o = function(h, d) {
      return St(h) ? d : n ? jt.call(a, h) : h;
    }, s = 0, l = void 0; l = e[s]; s++) {
      var c = o(l.start, t[0].x), u = o(l.end, t[t.length - 1].x), f = l.style || { dasharray: r };
      i[s] = { start: c, end: u, style: f };
    }
  return i;
}
var T0 = {
  initLine: function() {
    var t = this.$el;
    t.line = t.main.select(".".concat(j.chart)).append("g").attr("class", ue.chartLines).call(this.setCssRule(!1, ".".concat(ue.chartLines), ["pointer-events:none"]));
  },
  updateTargetsForLine: function(t) {
    var e = this, n = e.$el, a = n.area, i = n.line, r = n.main, o = e.getChartClass("Line"), s = e.getClass("lines", !0), l = e.classFocus.bind(e);
    i || e.initLine();
    var c = t.filter(function(d) {
      return !(e.isScatterType(d) || e.isBubbleType(d));
    }), u = r.select(".".concat(ue.chartLines)).selectAll(".".concat(ue.chartLine)).data(e.filterNullish(c)).attr("class", function(d) {
      return o(d) + l(d);
    }), f = u.enter().append("g").attr("class", o).style("opacity", "0").style("pointer-events", e.getStylePropValue("none"));
    if (f.append("g").attr("class", s), e.hasTypeOf("Area")) {
      var h = (!a && f.empty() ? u : f).filter(e.isAreaType.bind(e));
      e.initArea(h);
    }
    e.updateTargetForCircle(c, f);
  },
  /**
   * Generate/Update elements
   * @param {boolean} withTransition Transition for exit elements
   * @param {boolean} isSub Subchart draw
   * @private
   */
  updateLine: function(t, e) {
    e === void 0 && (e = !1);
    var n = this, a = n.format.extraLineClasses, i = n.$el, r = n.$T, o = e ? i.subchart : i, s = o.main.selectAll(".".concat(ue.lines)).selectAll(".".concat(ue.line)).data(n.lineData.bind(n));
    r(s.exit(), t).style("opacity", "0").remove(), o.line = s.enter().append("path").attr("class", function(l) {
      return "".concat(n.getClass("line", !0)(l), " ").concat(a(l) || "");
    }).style("stroke", n.color).merge(s).style("opacity", n.initialOpacity.bind(n)).attr("transform", null);
  },
  /**
   * Redraw function
   * @param {function} drawFn Retuned functino from .generateDrawCandlestick()
   * @param {boolean} withTransition With or without transition
   * @param {boolean} isSub Subchart draw
   * @returns {Array}
   * @private
   */
  redrawLine: function(t, e, n) {
    n === void 0 && (n = !1);
    var a = this, i = a.$el, r = a.$T, o = (n ? i.subchart : i).line;
    return [
      r(o, e, re()).attr("d", t).style("stroke", this.color).style("opacity", null)
    ];
  },
  /**
   * Get the curve interpolate
   * @param {Array} d Data object
   * @returns {function}
   * @private
   */
  getCurve: function(t) {
    var e = this, n = e.config.axis_rotated && e.isStepType(t);
    return n ? function(a) {
      var i = e.getInterpolate(t)(a);
      return i.orgPoint = i.point, i.pointRotated = function(r, o) {
        this._point === 1 && (this._point = 2);
        var s = this._y * (1 - this._t) + o * this._t;
        this._context.lineTo(this._x, s), this._context.lineTo(r, s), this._x = r, this._y = o;
      }, i.point = function(r, o) {
        this._point === 0 ? this.orgPoint(r, o) : this.pointRotated(r, o);
      }, i;
    } : e.getInterpolate(t);
  },
  generateDrawLine: function(t, e) {
    var n = this, a = n.config, i = n.scale, r = a.line_connectNull, o = a.axis_rotated, s = n.generateGetLinePoints(t, e), l = n.getYScaleById.bind(n), c = function(d) {
      return (e ? n.subxx : n.xx).call(n, d);
    }, u = function(d, v) {
      return n.isGrouped(d.id) ? s(d, v)[0][1] : l(d.id, e)(n.getBaseValue(d));
    }, f = Gs();
    f = o ? f.x(u).y(c) : f.x(c).y(u), r || (f = f.defined(function(d) {
      return n.getBaseValue(d) !== null;
    }));
    var h = e ? i.subX : i.x;
    return function(d) {
      var v = l(d.id, e), _ = r ? n.filterRemoveNull(d.values) : d.values, p = 0, g = 0, x;
      if (n.isLineType(d)) {
        var y = a.data_regions[d.id];
        y ? (n.isAreaRangeType(d) && (_ = _.map(function(m) {
          return K(K({}, m), { value: n.getRangedData(m, "mid") });
        })), x = n.lineWithRegions(_, i.zoom || h, v, y)) : (n.isStepType(d) && (_ = n.convertValuesToStep(_)), x = f.curve(n.getCurve(d))(_));
      } else
        _[0] && (p = h(_[0].x), g = v(_[0].value)), x = o ? "M ".concat(g, " ").concat(p) : "M ".concat(p, " ").concat(g);
      return x || "M 0 0";
    };
  },
  /**
   * Set regions dasharray and get path
   * @param {Array} d Data object
   * @param {function} x x scale function
   * @param {function} y y scale function
   * @param {object} _regions regions to be set
   * @returns {stirng} Path string
   * @private
   */
  lineWithRegions: function(t, e, n, a) {
    for (var i = this, r = i.config, o = r.axis_rotated, s = i.axis.isTimeSeries(), l = "2 2", c = b0.bind(i)(t, a, s), u = i.hasNullDataValue(t), f, h, d, v, _ = o ? function(B) {
      return n(B.value);
    } : function(B) {
      return e(B.x);
    }, p = o ? function(B) {
      return e(B.x);
    } : function(B) {
      return n(B.value);
    }, g = function(B) {
      return "M".concat(B[0][0], ",").concat(B[0][1], "L").concat(B[1][0], ",").concat(B[1][1]);
    }, x = s ? function(B, W, J, F) {
      var V = B.x.getTime(), Z = W.x - B.x, I = new Date(V + Z * J), ot = new Date(V + Z * (J + F)), it = o ? [[n(h(J)), e(I)], [n(h(J + d)), e(ot)]] : [[e(I), n(h(J))], [e(ot), n(h(J + d))]];
      return g(it);
    } : function(B, W, J, F) {
      var V = e(W.x, !o), Z = n(W.value, o), I = J + F, ot = e(f(J), !o), it = n(h(J), o), yt = e(f(I), !o), bt = n(h(I), o);
      yt > V && (yt = V), B.value > W.value && (o ? bt < Z : bt > Z) && (bt = Z);
      var H = [
        [ot, it],
        [yt, bt]
      ];
      return o && H.forEach(function(_t) {
        return _t.reverse();
      }), g(H);
    }, y = { x: i.axis.getAxisType("x"), y: i.axis.getAxisType("y") }, m = "", T = i.$el.line.filter(function(B) {
      var W = B.id;
      return W === t[0].id;
    }), b = T.clone().style("display", "none"), w = function(B, W) {
      return B.attr("d", W).node().getTotalLength();
    }, A = {
      dash: [],
      lastLength: 0
    }, k = !1, C = 0, E = void 0; E = t[C]; C++) {
      var M = t[C - 1], L = M && nt(M.value), $ = i.isWithinRegions(E.x, c);
      if (nt(E.value)) {
        if (St(c) || !$ || !L)
          m += "".concat(C && L ? "L" : "M").concat(_(E), ",").concat(p(E));
        else if (L)
          if ($ = ($?.dasharray || l).split(" ").map(Number), f = ze(y.x, M.x, E.x), h = ze(y.y, M.value, E.value), u) {
            var D = e(E.x) - e(M.x), S = n(E.value) - n(M.value), R = Math.sqrt(Math.pow(D, 2) + Math.pow(S, 2));
            d = $[0] / R, v = d * $[1];
            for (var z = d; z <= 1; z += v)
              m += x(M, E, z, d), z + v >= 1 && (m += x(M, E, 1, 0));
          } else {
            var P = [];
            if (k = E.x === t[t.length - 1].x, s) {
              var O = +M.x, X = new Date(O), G = new Date(O + (+E.x - O));
              P = [
                [e(X), n(h(0))],
                // M
                [e(G), n(h(1))]
                // L
              ];
            } else
              P = [
                [e(f(0)), n(h(0))],
                // M
                [e(f(1)), n(h(1))]
                // L
              ];
            o && P.forEach(function(B) {
              return B.reverse();
            });
            var ht = w(b, m), et = w(b, m += "L".concat(P[1].join(","))), Q = y0(ht - A.lastLength, et - A.lastLength, $, k);
            A.lastLength += Q.length, A.dash.push(Q.dash);
          }
      }
    }
    return A.dash.length && (!k && A.dash.push(w(b, m)), b.remove(), T.attr("stroke-dasharray", A.dash.join(" "))), m;
  },
  isWithinRegions: function(t, e) {
    for (var n = 0, a = void 0; a = e[n]; n++)
      if (a.start < t && t <= a.end)
        return a.style;
    return !1;
  },
  isWithinStep: function(t, e) {
    return Math.abs(e - Zt(this.state.event, t)[1]) < 30;
  },
  shouldDrawPointsForLine: function(t) {
    var e = this.config.line_point;
    return e === !0 || ft(e) && e.indexOf(t.id) !== -1;
  }
}, Ve = function() {
  return re();
}, Na = {
  initialOpacityForCircle: function(t) {
    var e = this, n = e.config, a = e.state.withoutFadeIn, i = n.point_opacity;
    return St(i) && (i = this.getBaseValue(t) !== null && a[t.id] ? this.opacityForCircle(t) : "0"), i;
  },
  opacityForCircle: function(t) {
    var e, n = this.config, a = n.point_opacity;
    return St(a) && (a = n.point_show && !(!((e = this.isPointFocusOnly) === null || e === void 0) && e.call(this)) ? null : "0", a = nt(this.getBaseValue(t)) ? this.isBubbleType(t) || this.isScatterType(t) ? "0.5" : a : "0"), a;
  },
  initCircle: function() {
    var t = this, e = t.$el.main;
    !t.point && (t.point = t.generatePoint()), (t.hasType("bubble") || t.hasType("scatter")) && e.select(".".concat(j.chart, " > .").concat(Ft.chartCircles)).empty() && e.select(".".concat(j.chart)).append("g").attr("class", Ft.chartCircles);
  },
  updateTargetForCircle: function(t, e) {
    var n = this, a = this, i = a.config, r = a.data, o = a.$el, s = i.interaction_enabled && i.data_selection_enabled, l = s && i.data_selection_isselectable, c = a.getClass("circles", !0);
    if (i.point_show) {
      a.initCircle();
      var u = t, f = e;
      if (!u) {
        u = a.filterNullish(r.targets).filter(function(d) {
          return n.isScatterType(d) || n.isBubbleType(d);
        });
        var h = o.main.select(".".concat(Ft.chartCircles)).style("pointer-events", "none").selectAll(".".concat(Ft.circles)).data(u);
        h.exit().remove(), f = h.enter();
      }
      s && f.append("g").attr("class", function(d) {
        return a.generateClass(xt.selectedCircles, d.id);
      }), f.append("g").attr("class", c).call(function(d) {
        a.setCssRule(!0, ".".concat(Ft.circles), ["cursor:pointer"], l)(d), a.setCssRule(!0, " .".concat(Ft.circle), ["fill", "stroke"], a.color)(d);
      }).style("opacity", function() {
        var d = N(this.parentNode);
        return d.attr("class").indexOf(Ft.chartCircles) > -1 ? "0" : null;
      }), s && u.forEach(function(d) {
        o.main.selectAll(".".concat(xt.selectedCircles).concat(a.getTargetSelectorSuffix(d.id))).selectAll("".concat(xt.selectedCircle)).each(function(v) {
          v.value = d.values[v.index].value;
        });
      });
    }
  },
  updateCircle: function(t) {
    t === void 0 && (t = !1);
    var e = this, n = e.config, a = e.state, i = e.$el, r = e.isPointFocusOnly(), o = t ? i.subchart : i;
    if (n.point_show && !a.toggling) {
      n.point_radialGradient && e.updateLinearGradient();
      var s = o.main.selectAll(".".concat(Ft.circles)).selectAll(".".concat(Ft.circle)).data(function(l) {
        var c = e.isLineType(l) && e.shouldDrawPointsForLine(l) || e.isBubbleType(l) || e.isRadarType(l) || e.isScatterType(l) ? r ? [l.values[0]] : l.values : [];
        return e.filterNullish(c);
      });
      s.exit().remove(), s.enter().filter(Boolean).append(e.point("create", this, e.pointR.bind(e), e.updateCircleColor.bind(e))), o.circle = o.main.selectAll(".".concat(Ft.circles, " .").concat(Ft.circle)).style("stroke", e.getStylePropValue(e.color)).style("opacity", e.initialOpacityForCircle.bind(e));
    }
  },
  /**
   * Update circle color
   * @param {object} d Data object
   * @returns {string} Color string
   * @private
   */
  updateCircleColor: function(t) {
    var e = this, n = e.getStylePropValue(e.color);
    return e.config.point_radialGradient ? e.getGradienColortUrl(t.id) : n ? n(t) : null;
  },
  redrawCircle: function(t, e, n, a, i) {
    i === void 0 && (i = !1);
    var r = this, o = r.state.rendered, s = r.$el, l = r.$T, c = i ? s.subchart : s, u = c.main.selectAll(".".concat(xt.selectedCircle));
    if (!r.config.point_show)
      return [];
    var f = r.point("update", r, t, e, r.updateCircleColor.bind(r), n, a, u), h = r.isCirclePoint() ? "c" : "", d = re(), v = r.opacityForCircle.bind(r), _ = [];
    return c.circle.each(function(p) {
      var g = f.bind(this)(p);
      g = l(g, n || !o, d).style("opacity", v), _.push(g);
    }), [
      _,
      l(u, n).attr("".concat(h, "x"), t).attr("".concat(h, "y"), e)
    ];
  },
  /**
   * Show focused data point circle
   * @param {object} d Selected data
   * @private
   */
  showCircleFocus: function(t) {
    var e = this, n = e.state, a = n.hasRadar, i = n.resizing, r = n.toggling, o = n.transiting, s = e.$el, l = s.circle;
    if (o === !1 && l && e.isPointFocusOnly()) {
      var c = (a ? e.radarCircleX : e.circleX).bind(e), u = (a ? e.radarCircleY : e.circleY).bind(e), f = r || St(t), h = e.point("update", e, c, u, e.getStylePropValue(e.color), i ? !1 : f);
      t && (l = l.filter(function(d) {
        var v, _ = (v = t.filter) === null || v === void 0 ? void 0 : v.call(t, function(p) {
          return p.id === d.id;
        });
        return _.length ? N(this).datum(_[0]) : !1;
      })), l.attr("class", this.updatePointClass.bind(this)).style("opacity", null).each(function(d) {
        var v = d.id, _ = d.index, p = d.value, g = "hidden";
        nt(p) && (h.bind(this)(d), e.expandCircles(_, v), g = ""), this.style.visibility = g;
      });
    }
  },
  /**
   * Hide focused data point circle
   * @private
   */
  hideCircleFocus: function() {
    var t = this, e = t.$el.circle;
    t.isPointFocusOnly() && e && (t.unexpandCircles(), e.style("visibility", "hidden"));
  },
  circleX: function(t) {
    return this.xx(t);
  },
  updateCircleY: function(t) {
    t === void 0 && (t = !1);
    var e = this, n = e.generateGetLinePoints(e.getShapeIndices(e.isLineType), t);
    return function(a, i) {
      var r = a.id;
      return e.isGrouped(r) ? n(a, i)[0][1] : e.getYScaleById(r, t)(e.getBaseValue(a));
    };
  },
  expandCircles: function(t, e, n) {
    var a = this, i = a.pointExpandedR.bind(a);
    n && a.unexpandCircles();
    var r = a.getShapeByIndex("circle", t, e).classed(j.EXPANDED, !0), o = i(r) / a.config.point_r, s = 1 - o;
    a.isCirclePoint() ? r.attr("r", i) : r.each(function() {
      var l = N(this);
      if (this.tagName === "circle")
        l.attr("r", i);
      else {
        var c = we(this), u = c.width, f = c.height, h = s * (+l.attr("x") + u / 2), d = s * (+l.attr("y") + f / 2);
        l.attr("transform", "translate(".concat(h, " ").concat(d, ") scale(").concat(o, ")"));
      }
    });
  },
  unexpandCircles: function(t) {
    var e = this, n = e.pointR.bind(e), a = e.getShapeByIndex("circle", t).filter(function() {
      return N(this).classed(j.EXPANDED);
    }).classed(j.EXPANDED, !1);
    if (a.attr("r", n), !e.isCirclePoint()) {
      var i = n(a) / e.config.point_r;
      a.attr("transform", i !== 1 ? "scale(".concat(i, ")") : null);
    }
  },
  pointR: function(t) {
    var e = this, n = e.config, a = n.point_r, i = a;
    return e.isBubbleType(t) ? i = e.getBubbleR(t) : U(a) && (i = a.bind(e.api)(t)), t.r = i, i;
  },
  pointExpandedR: function(t) {
    var e = this, n = e.config, a = e.isBubbleType(t) ? 1.15 : 1.75;
    return n.point_focus_expand_enabled ? n.point_focus_expand_r || e.pointR(t) * a : e.pointR(t);
  },
  pointSelectR: function(t) {
    var e = this, n = e.config.point_select_r;
    return U(n) ? n(t) : n || e.pointR(t) * 4;
  },
  /**
   * Check if point.focus.only option can be applied.
   * @returns {boolean}
   * @private
   */
  isPointFocusOnly: function() {
    var t = this;
    return t.config.point_focus_only && !t.hasType("bubble") && !t.hasType("scatter") && !t.hasArcType(null, ["radar"]);
  },
  isWithinCircle: function(t, e) {
    var n = this.state, a = Zt(n.event, t), i = N(t), r = this.isCirclePoint(t) ? "c" : "", o = this.getPointSensitivity(i?.datum()), s = +i.attr("".concat(r, "x")), l = +i.attr("".concat(r, "y"));
    if (!(s || l) && t.nodeType === 1) {
      var c = Mt(t), u = c.x, f = c.y;
      s = u, l = f;
    }
    return Math.sqrt(Math.pow(s - a[0], 2) + Math.pow(l - a[1], 2)) < (e || o);
  },
  /**
   * Get data point sensitivity radius
   * @param {object} d Data point object
   * @returns {number} return the sensitivity value
   */
  getPointSensitivity: function(t) {
    var e = this, n = e.config.point_sensitivity;
    if (t)
      U(n) ? n = n.call(e.api, t) : n === "radius" && (n = t.r);
    else return n;
    return n;
  },
  updatePointClass: function(t) {
    var e = this, n = e.$el.circle, a = !1;
    return (ct(t) || n) && (a = t === !0 ? n.each(function(i) {
      var r = e.getClass("circle", !0)(i);
      this.getAttribute("class").indexOf(j.EXPANDED) > -1 && (r += " ".concat(j.EXPANDED)), this.setAttribute("class", r);
    }) : e.getClass("circle", !0)(t)), a;
  },
  generateGetLinePoints: function(t, e) {
    var n = this, a = n.config, i = n.getShapeX(0, t, e), r = n.getShapeY(e), o = n.getShapeOffset(n.isLineType, t, e), s = n.getYScaleById.bind(n);
    return function(l, c) {
      var u = s.call(n, l.id, e)(n.getShapeYMin(l.id)), f = o(l, c) || u, h = i(l), d = r(l);
      a.axis_rotated && (l.value > 0 && d < u || l.value < 0 && u < d) && (d = u);
      var v = [h, d - (u - f)];
      return [
        v,
        v,
        // from here and below, needed for compatibility
        v,
        v
      ];
    };
  },
  custom: {
    create: function(t, e, n) {
      return t.append("use").attr("xlink:href", "#".concat(e)).attr("class", this.updatePointClass.bind(this)).style("fill", n).node();
    },
    update: function(t, e, n, a, i, r, o) {
      var s = this, l = we(t.node()), c = l.width, u = l.height, f = function(v) {
        return nt(v.value) ? e(v) - c / 2 : 0;
      }, h = function(v) {
        return nt(v.value) ? n(v) - u / 2 : 0;
      }, d = t;
      return i && (r && d.attr("x", f), d = s.$T(d, i, Ve()), o && s.$T(o, i, Ve())), d.attr("x", f).attr("y", h).style("fill", a);
    }
  },
  // 'circle' data point
  circle: {
    create: function(t, e, n) {
      return t.append("circle").attr("class", this.updatePointClass.bind(this)).attr("r", e).style("fill", n).node();
    },
    update: function(t, e, n, a, i, r, o) {
      var s = this, l = t;
      return s.hasType("bubble") && l.attr("r", s.pointR.bind(s)), i && (r && l.attr("cx", e), l.attr("cx") && (l = s.$T(l, i, Ve())), o && s.$T(l, i, Ve())), l.attr("cx", e).attr("cy", n).style("fill", a);
    }
  },
  // 'rectangle' data point
  rectangle: {
    create: function(t, e, n) {
      var a = function(i) {
        return e(i) * 2;
      };
      return t.append("rect").attr("class", this.updatePointClass.bind(this)).attr("width", a).attr("height", a).style("fill", n).node();
    },
    update: function(t, e, n, a, i, r, o) {
      var s = this, l = s.config.point_r, c = function(h) {
        return e(h) - l;
      }, u = function(h) {
        return n(h) - l;
      }, f = t;
      return i && (r && f.attr("x", c), f = s.$T(f, i, Ve()), o && s.$T(o, i, Ve())), f.attr("x", c).attr("y", u).style("fill", a);
    }
  }
};
function $0(t) {
  return Ut(t) && U(t.create) && U(t.update);
}
function w0(t, e) {
  var n, a = this, i = function(c, u) {
    for (var f = c.attributes, h = 0, d; d = f[h]; h++)
      d = d.name, u.setAttribute(d, c.getAttribute(d));
  }, r = new DOMParser().parseFromString(nn(t), "image/svg+xml"), o = r.documentElement, s = mt.createElementNS(Ke.svg, o.nodeName.toLowerCase());
  if (s.id = e, s.style.fill = "inherit", s.style.stroke = "inherit", i(o, s), !((n = o.childNodes) === null || n === void 0) && n.length) {
    var l = N(s);
    "innerHTML" in s ? l.html(nn(o.innerHTML)) : Ie(o.childNodes).forEach(function(c) {
      i(c, l.append(c.tagName).node());
    });
  }
  a.$el.defs.node().appendChild(s);
}
var hn = {
  /**
   * Check if point type option is valid
   * @param {string} type point type
   * @returns {boolean}
   * @private
   */
  hasValidPointType: function(t) {
    return /^(circle|rect(angle)?|polygon|ellipse|use)$/i.test(t || this.config.point_type);
  },
  /**
   * Check if pattern point is set to be used on legend
   * @returns {boolean}
   * @private
   */
  hasLegendDefsPoint: function() {
    var t, e = this.config;
    return e.legend_show && ((t = e.point_pattern) === null || t === void 0 ? void 0 : t.length) && e.legend_usePoint;
  },
  getDefsPointId: function(t) {
    var e = this.state.datetimeId;
    return "".concat(e, "-point").concat(t);
  },
  /**
   * Get validated point pattern array
   * @returns {Array} Array of point types
   * @private
   */
  getValidPointPattern: function() {
    var t = this.config, e = /^(circle|rect(angle)?)$/i.test(t.point_type) ? t.point_type : "circle";
    return kt(t.point_pattern) ? t.point_pattern : [e];
  },
  /**
   * Get generate point function
   * @returns {function}
   * @private
   */
  generatePoint: function() {
    var t = this, e = t.$el, n = t.config, a = [], i = t.getValidPointPattern();
    return function(r, o) {
      for (var s = [], l = 2; l < arguments.length; l++)
        s[l - 2] = arguments[l];
      return function(c) {
        var u, f, h, d, v = t.getTargetSelectorSuffix(c.id || ((u = c.data) === null || u === void 0 ? void 0 : u.id) || c), _ = N(this);
        a.indexOf(v) < 0 && a.push(v);
        var p = i[a.indexOf(v) % i.length];
        if (t.hasValidPointType(p))
          p = t[p];
        else if (!$0(p || n.point_type)) {
          var g = t.getDefsPointId(v), x = e.defs.select("#".concat(g));
          if (x.size() < 1 && w0.call(t, p, g), r === "create")
            return (f = t.custom) === null || f === void 0 ? void 0 : f.create.bind(o).apply(void 0, wt([_, g], s, !1));
          if (r === "update")
            return (h = t.custom) === null || h === void 0 ? void 0 : h.update.bind(o).apply(void 0, wt([_], s, !1));
        }
        return (d = p[r]) === null || d === void 0 ? void 0 : d.bind(o).apply(void 0, wt([_], s, !1));
      };
    };
  }
};
function No(t) {
  var e = t.config.polar_level_max, n = t.getMinMaxData().max[0].value;
  return e && e > n && (n = e), n;
}
var A0 = {
  /**
   * Initialize polar
   * @private
   */
  initPolar: function() {
    var t = this, e = t.$el.arcs, n = t.config, a = n.polar_level_text_show, i = n.polar_level_text_backgroundColor;
    e.levels = e.append("g").attr("class", be.levels), a && i && t.generateTextBGColorFilter(i);
  },
  /**
   * Get polar outer radius according to the data value
   * @param {object} d Data object
   * @param {numbet} outerRadius Outer radius
   * @returns {number} outer radius
   * @private
   */
  getPolarOuterRadius: function(t, e) {
    var n, a = No(this);
    return ((n = t?.data.values[0].value) !== null && n !== void 0 ? n : 0) / a * e;
  },
  /**
   * Update polar based on given data array
   * @param {object} targets Data object
   * @private
   */
  updateTargetsForPolar: function(t) {
    this.updateTargetsForArc(t);
  },
  /**
   * Called whenever redraw happens
   * @private
   */
  redrawPolar: function() {
    var t = this, e = t.config;
    e.polar_level_show && t.updatePolarLevel();
  },
  /**
   * Update polar level circle
   * @private
   */
  updatePolarLevel: function() {
    var t = this, e = t.config, n = t.state, a = t.$el.arcs.levels, i = e.polar_level_depth, r = No(t), o = ia(0, i), s = n.radius, l = o.map(function(v) {
      return s * ((v + 1) / i);
    }), c = (e.polar_level_text_format || function() {
    }).bind(t.api), u = a.selectAll(".".concat(be.level)).data(o);
    u.exit().remove();
    var f = u.enter().append("g").attr("class", function(v, _) {
      return "".concat(be.level, " ").concat(be.level, "-").concat(_);
    });
    if (f.append("circle"), f.merge(u).selectAll("circle").style("visibility", e.polar_level_show ? null : "hidden").attr("cx", 0).attr("cy", 0).attr("r", function(v) {
      return l[v];
    }), e.polar_level_text_show) {
      var h = e.polar_level_text_backgroundColor, d = "#".concat(n.datetimeId, "-labels-bg").concat(t.getTargetSelectorSuffix(h));
      f.append("text").style("text-anchor", "middle"), f.merge(u).selectAll("text").attr("dy", function(v) {
        return -l[v] + 5;
      }).attr("filter", h ? "url(".concat(d, ")") : null).text(function(v) {
        return c(r / o.length * (v + 1));
      });
    }
  }
};
function S0(t, e, n, a, i, r) {
  var o = t && a > 0 ? n - a : a, s = 2 * Math.PI, l = e === "x" ? Math.sin : Math.cos;
  return i * (1 - r * l(o * s / n));
}
var Ue = $t.radarPoints, Bo = $t.radarTextWidth, k0 = {
  initRadar: function() {
    var t = this, e = t.config, n = t.state.current, a = t.$el;
    t.hasType("radar") && (a.radar = a.main.select(".".concat(j.chart)).append("g").attr("class", nl.chartRadars), a.radar.levels = a.radar.append("g").attr("class", be.levels), a.radar.axes = a.radar.append("g").attr("class", Rt.axis), a.radar.shapes = a.radar.append("g").attr("class", At.shapes), n.dataMax = e.radar_axis_max || t.getMinMaxData().max[0].value, e.radar_axis_text_show && (e.interaction_enabled && t.bindRadarEvent(), t.updateRadarLevel(), t.updateRadarAxes()));
  },
  getRadarSize: function() {
    var t = this, e = t.config, n = t.state, a = n.arcWidth, i = n.arcHeight, r = e.axis_x_categories.length < 4 ? -20 : 10, o = (Math.min(a, i) - r) / 2;
    return [o, o];
  },
  updateTargetsForRadar: function(t) {
    var e = this, n = e.config;
    qt(n.axis_x_categories) && (n.axis_x_categories = ia(0, Qt("max", t.map(function(a) {
      return a.values.length;
    })))), e.generateRadarPoints();
  },
  getRadarPosition: function(t, e, n, a) {
    var i = this, r = i.config, o = i.getRadarSize(), s = o[0], l = o[1], c = r.axis_x_categories.length, u = r.radar_direction_clockwise, f = Ie(t).map(function(h) {
      return S0(u, h, c, e, vt(n) ? n : t === "x" ? s : l, q(a) ? a : r.radar_size_ratio);
    });
    return f.length === 1 ? f[0] : f;
  },
  /**
   * Generate data points
   * @private
   */
  generateRadarPoints: function() {
    var t = this, e = t.data.targets, n = t.getRadarSize(), a = n[0], i = n[1], r = t.cache.get(Ue) || {}, o = r._size;
    (!o || o.width !== a && o.height !== i) && (e.forEach(function(s) {
      r[s.id] = s.values.map(function(l, c) {
        return t.getRadarPosition(["x", "y"], c, void 0, t.getRatio("radar", l));
      });
    }), r._size = { width: a, height: i }, t.cache.add(Ue, r));
  },
  redrawRadar: function() {
    var t = this, e = t.$el, n = e.radar, a = e.main, i = t.getTranslate("radar");
    i && (n.attr("transform", i), a.select(".".concat(Ct.chartTexts)).attr("transform", i), t.generateRadarPoints(), t.updateRadarLevel(), t.updateRadarAxes(), t.updateRadarShape());
  },
  generateGetRadarPoints: function() {
    var t = this.cache.get(Ue);
    return function(e, n) {
      var a = t[e.id][n];
      return [
        a,
        a,
        a,
        a
      ];
    };
  },
  updateRadarLevel: function() {
    var t = this, e = t.config, n = t.state, a = t.$el.radar, i = t.getRadarSize(), r = i[0], o = i[1], s = e.radar_level_depth, l = e.axis_x_categories.length, c = e.radar_level_text_show, u = a.levels, f = ia(0, s), h = e.radar_size_ratio * Math.min(r, o), d = f.map(function(x) {
      return h * ((x + 1) / s);
    }), v = (e.radar_level_text_format || function() {
    }).bind(t.api), _ = f.map(function(x) {
      var y = d[x], m = ia(0, l).map(function(T) {
        return t.getRadarPosition(["x", "y"], T, y, 1).join(",");
      });
      return m.join(" ");
    }), p = u.selectAll(".".concat(be.level)).data(f);
    p.exit().remove();
    var g = p.enter().append("g").attr("class", function(x, y) {
      return "".concat(be.level, " ").concat(be.level, "-").concat(y);
    });
    g.append("polygon").style("visibility", e.radar_level_show ? null : "hidden"), c && (u.select("text").empty() && u.append("text").attr("dx", "-.5em").attr("dy", "-.7em").style("text-anchor", "end").text(function() {
      return v(0);
    }), g.append("text").attr("dx", "-.5em").style("text-anchor", "end").text(function(x) {
      return v(n.current.dataMax / f.length * (x + 1));
    })), g.merge(p).attr("transform", function(x) {
      return "translate(".concat(r - d[x], ", ").concat(o - d[x], ")");
    }).selectAll("polygon").attr("points", function(x) {
      return _[x];
    }), c && u.selectAll("text").attr("x", function(x) {
      return St(x) ? r : _[x].split(",")[0];
    }).attr("y", function(x) {
      return St(x) ? o : 0;
    });
  },
  updateRadarAxes: function() {
    var t = this, e = t.config, n = t.$el.radar, a = t.getRadarSize(), i = a[0], r = a[1], o = e.axis_x_categories, s = n.axes.selectAll("g").data(o);
    s.exit().remove();
    var l = s.enter().append("g").attr("class", function(p, g) {
      return "".concat(Rt.axis, "-").concat(g);
    });
    if (e.radar_axis_line_show && l.append("line"), e.radar_axis_text_show && l.append("text"), s = l.merge(s), e.radar_axis_line_show && s.select("line").attr("x1", i).attr("y1", r).attr("x2", function(p, g) {
      return t.getRadarPosition("x", g);
    }).attr("y2", function(p, g) {
      return t.getRadarPosition("y", g);
    }), e.radar_axis_text_show) {
      var c = e.radar_axis_text_position, u = c.x, f = u === void 0 ? 0 : u, h = c.y, d = h === void 0 ? 0 : h, v = t.cache.get(Bo) || 0;
      if (s.select("text").style("text-anchor", "middle").attr("dy", ".5em").call(function(p) {
        p.each(function(g) {
          an(N(this), String(g), [-0.6, 1.2]);
        });
      }).datum(function(p, g) {
        return { index: g };
      }).attr("transform", function(p) {
        St(this.width) && (this.width = Mt(this, !0).width / 2);
        var g = t.getRadarPosition("x", p.index, void 0, 1), x = Math.round(t.getRadarPosition("y", p.index, void 0, 1));
        return g > i ? g += this.width + f : Math.round(g) < i && (g -= this.width + f), x > r ? (x / 2 === r && this.firstChild.tagName === "tspan" && this.firstChild.setAttribute("dy", "0em"), x += d) : x < r && (x -= d), "translate(".concat(g, " ").concat(x, ")");
      }), !v) {
        var _ = [n.axes, n.levels].map(function(p) {
          return fl(p.node()).width;
        });
        _.every(function(p) {
          return p > 0;
        }) && t.cache.add(Bo, _[0] - _[1]);
      }
    }
  },
  bindRadarEvent: function() {
    var t = this, e = t.config, n = t.state, a = t.$el, i = a.radar, r = a.svg, o = t.isPointFocusOnly(), s = n.inputType, l = n.transiting, c = s === "mouse", u = function(f) {
      if (n.event = f, !!e.interaction_onout) {
        var h = t.getDataIndexFromEvent(f), d = St(h);
        (c || d) && (t.hideTooltip(), o ? t.hideCircleFocus() : t.unexpandCircles(), c ? t.setOverOut(!1, h) : d && t.callOverOutForTouch());
      }
    };
    i.axes.on(c ? "mouseover " : "touchstart", function(f) {
      if (!l) {
        n.event = f;
        var h = t.getDataIndexFromEvent(f);
        t.selectRectForSingle(r.node(), h), c ? t.setOverOut(!0, h) : t.callOverOutForTouch(h);
      }
    }, c ? void 0 : { passive: !0 }).on("mouseout", c ? u : null), c || r.on("touchstart", u, { passive: !0 });
  },
  updateRadarShape: function() {
    var t = this, e = t.data.targets.filter(function(r) {
      return t.isRadarType(r);
    }), n = t.cache.get(Ue), a = t.$el.radar.shapes.selectAll("polygon").data(t.filterNullish(e)), i = a.enter().append("g").attr("class", t.getChartClass("Radar"));
    t.$T(a.exit()).remove(), i.append("polygon").merge(a).style("fill", t.color).style("stroke", t.color).attr("points", function(r) {
      return n[r.id].join(" ");
    }), t.updateTargetForCircle(e, i);
  },
  /**
   * Get data point x coordinate
   * @param {object} d Data object
   * @returns {number}
   * @private
   */
  radarCircleX: function(t) {
    return this.cache.get(Ue)[t.id][t.index][0];
  },
  /**
   * Get data point y coordinate
   * @param {object} d Data object
   * @returns {number}
   * @private
   */
  radarCircleY: function(t) {
    return this.cache.get(Ue)[t.id][t.index][1];
  }
};
function C0(t, e) {
  var n = this, a = n.scale, i = a.x, r = a.y, o = n.state.width;
  t.selectAll("g").attr("transform", function(s) {
    return "translate(".concat(s === e ? "0,0" : "".concat(i(s.x0), ",").concat(r(s.y0)), ")");
  }).select("rect").attr("width", function(s) {
    return s === e ? o : i(s.x1) - i(s.x0);
  }).attr("height", function(s) {
    return s === e ? 0 : r(s.y1) - r(s.y0);
  });
}
function R0(t) {
  var e = this;
  return t.map(function(n) {
    var a = n.id, i = n.values, r = i[0].value;
    return {
      name: a,
      id: a,
      // needed to keep compatibility on whole code logic
      value: r,
      ratio: e.getRatio("treemap", i[0])
    };
  });
}
function E0(t) {
  var e = this, n = ur(t).sum(function(i) {
    return i.value;
  }), a = e.getSortCompareFn(!0);
  return [
    e.treemap(a ? n.sort(a) : n)
  ];
}
var M0 = {
  initTreemap: function() {
    var t = this, e = t.$el, n = t.state, a = n.current, i = a.width, r = a.height, o = n.clip, s = n.datetimeId;
    o.id = "".concat(s, "-clip"), t.treemap = Mg().tile(t.getTreemapTile()), e.defs.append("clipPath").attr("id", o.id).append("rect").attr("width", i).attr("height", r), e.treemap = e.main.select(".".concat(j.chart)).attr("clip-path", "url(#".concat(o.id, ")")).append("g").classed(il.chartTreemaps, !0), t.bindTreemapEvent();
  },
  /**
   * Bind events
   * @private
   */
  bindTreemapEvent: function() {
    var t = this, e = t.$el, n = t.config, a = t.state, i = function(o) {
      var s, l = o.isTrusted ? o.target : (s = a.eventReceiver.rect) === null || s === void 0 ? void 0 : s.node(), c;
      return /^rect$/i.test(l.tagName) && (a.event = o, c = N(l).datum()), c?.data;
    };
    if (n.interaction_enabled) {
      var r = a.inputType === "touch";
      e.treemap.on(r ? "touchstart" : "mouseover mousemove", function(o) {
        var s = i(o);
        s && (t.showTooltip([s], o.currentTarget), /^(touchstart|mouseover)$/.test(o.type) && t.setOverOut(!0, s));
      }, r ? { passive: !0 } : void 0).on(r ? "touchend" : "mouseout", function(o) {
        var s = i(o);
        n.interaction_onout && (t.hideTooltip(), t.setOverOut(!1, s));
      });
    }
  },
  /**
   * Get tiling function
   * @returns {function}
   * @private
   */
  getTreemapTile: function() {
    var t, e, n = this, a = n.config, i = n.state.current, r = i.width, o = i.height, s = (e = {
      binary: _o,
      dice: Pa,
      slice: Oa,
      sliceDice: Lg,
      squarify: el,
      resquarify: Dg
    }[(t = a.treemap_tile) !== null && t !== void 0 ? t : "binary"]) !== null && e !== void 0 ? e : _o;
    return function(l, c, u, f, h) {
      s(l, 0, 0, r, o);
      for (var d = 0, v = l.children; d < v.length; d++) {
        var _ = v[d];
        _.x0 = c + _.x0 / r * (f - c), _.x1 = c + _.x1 / r * (f - c), _.y0 = u + _.y0 / o * (h - u), _.y1 = u + _.y1 / o * (h - u);
      }
    };
  },
  /**
   * Get treemap hierarchy data
   * @param {Array} targets Data targets
   * @returns {object}
   * @private
   */
  getTreemapData: function(t) {
    var e = this;
    return {
      name: "root",
      children: R0.bind(e)(e.filterTargetsToShow(t.filter(e.isTreemapType, e)))
    };
  },
  /**
   * Update treemap data
   * @param {Array} targets Data targets
   * @private
   */
  updateTargetsForTreemap: function(t) {
    var e = this, n = e.$el.treemap, a = E0.call(e, e.getTreemapData(t ?? e.data.targets));
    n.data(e.filterNullish(a));
  },
  /**
   * Render treemap
   * @param {number} durationForExit Duration for exit transition
   * @private
   */
  updateTreemap: function(t) {
    var e = this, n = e.$el, a = e.$T, i = n.treemap.datum(), r = e.getChartClass("Treemap"), o = e.getClass("treemap", !0), s = n.treemap.selectAll("g").data(i.children);
    a(s.exit(), t).style("opacity", "0").remove(), s.enter().append("g").append("rect"), n.treemap.selectAll("g").attr("class", r).select("rect").attr("class", o).attr("fill", function(l) {
      return e.color(l.data.name);
    });
  },
  /**
   * Generate treemap coordinate points data
   * @returns {Array} Array of coordinate points
   * @private
   */
  generateGetTreemapPoints: function() {
    var t = this, e = t.$el, n = t.scale, a = n.x, i = n.y, r = {};
    return e.treemap.selectAll("g").each(function(o) {
      r[o.data.name] = [
        [a(o.x0), i(o.y0)],
        [a(o.x1), i(o.y1)]
      ];
    }), function(o) {
      return r[o.id];
    };
  },
  /**
   * Redraw treemap
   * @param {boolean} withTransition With or without transition
   * @returns {Array} Selections
   * @private
   */
  redrawTreemap: function(t) {
    var e = this, n = e.$el, a = e.state.current, i = a.width, r = a.height;
    return n.defs.select("rect").attr("width", i).attr("height", r), [
      e.$T(n.treemap, t, re()).call(C0.bind(e), n.treemap.datum())
    ];
  },
  /**
   * Get treemap data label format function
   * @param {object} d Data object
   * @returns {function} Label formatter function
   * @private
   */
  treemapDataLabelFormat: function(t) {
    var e = this, n = e.$el.treemap, a = e.config, i = e.scale, r = i.x, o = i.y, s = t.id, l = t.value, c = a.treemap_label_format, u = e.getRatio("treemap", t), f = (u * 100).toFixed(2), h = a.treemap_label_show && vr.call(e, u, "treemap") ? null : "0", d = n.selectAll("g").filter(function(m) {
      return m.data.id === s;
    }).datum(), v = 0, _ = 0;
    if (d) {
      var p = d.x0, g = d.x1, x = d.y0, y = d.y1;
      v = r(g) - r(p), _ = o(y) - o(x);
    }
    return function(m) {
      return m.style("opacity", h), U(c) ? c.bind(e.api)(l, u, s, { width: v, height: _ }) : "".concat(s, `
`).concat(f, "%");
    };
  }
}, Be = {
  /**
   * Set point options
   * @name point
   * @memberof Options
   * @type {object}
   * @property {object} point Point object
   * @property {boolean} [point.show=true] Whether to show each point in line.
   * @property {number|function} [point.r=2.5] The radius size of each point.
   *  - **NOTE:** Disabled for 'bubble' type
   * @property {boolean|object} [point.radialGradient=false] Set the radial gradient on point.<br><br>
   * Or customize by giving below object value:
   *  - cx {number}: `cx` value (default: `0.3`)
   *  - cy {number}: `cy` value (default: `0.3`)
   *  - r {number}: `r` value (default: `0.7`)
   *  - stops {Array}: Each item should be having `[offset, stop-color, stop-opacity]` values.
   *    - (default: `[[0.1, $DATA_COLOR, 1], [0.9, $DATA_COLOR, 0]]`)
   * @property {boolean} [point.focus.expand.enabled=true] Whether to expand each point on focus.
   * @property {number} [point.focus.expand.r=point.r*1.75] The radius size of each point on focus.
   *  - **NOTE:** For 'bubble' type, the default is `bubbleSize*1.15`
   * @property {boolean} [point.focus.only=false] Show point only when is focused.
   * @property {number|null} [point.opacity=undefined] Set point opacity value.
   * - **NOTE:**
   * 	- `null` will make to not set inline 'opacity' css prop.
   * 	- when no value(or undefined) is set, it defaults to set opacity value according its chart types.
   * @property {number|string|function} [point.sensitivity=10] The sensitivity value for interaction boundary.
   * - **Available Values:**
   *   - {number}: Absolute sensitivity value which is the distance from the data point in pixel.
   *   - "radius": sensitivity based on point's radius
   *   - Function: callback for each point to determine the sensitivity<br>
   *    	```js
   *   	sensitivity: function(d) {
   * 	  // ex. of argument d:
   * 	  // ==> {x: 2, value: 55, id: 'data3', index: 2, r: 19.820624179302296}
   *
   * 	  // returning d.r, will make sensitivity same as point's radius value.
   *  	  return d.r;
   * 	}
   * 	```
   * @property {number} [point.select.r=point.r*4] The radius size of each point on selected.
   * @property {string} [point.type="circle"] The type of point to be drawn
   * - **NOTE:**
   *   - If chart has 'bubble' type, only circle can be used.
   *   - For IE, non circle point expansions are not supported due to lack of transform support.
   * - **Available Values:**
   *   - circle
   *   - rectangle
   * @property {Array} [point.pattern=[]] The type of point or svg shape as string, to be drawn for each line
   * - **NOTE:**
   *   - This is an `experimental` feature and can have some unexpected behaviors.
   *   - If chart has 'bubble' type, only circle can be used.
   *   - For IE, non circle point expansions are not supported due to lack of transform support.
   *   - Only common SVG tags are allowed to prevent XSS attacks. If creating charts from user input, it is recommended to sanitize input values to avoid potential vulnerabilities.
   * - **Available Values:**
   *   - circle
   *   - rectangle
   *   - svg shape tag interpreted as string<br>
   *     (ex. `<polygon points='2.5 0 0 5 5 5'></polygon>`)
   * @see [Demo: point type](https://naver.github.io/billboard.js/demo/#Point.RectanglePoints)
   * @see [Demo: point focus only](https://naver.github.io/billboard.js/demo/#Point.FocusOnly)
   * @see [Demo: point radialGradient](https://naver.github.io/billboard.js/demo/#Point.RadialGradientPoint)
   * @see [Demo: point sensitivity](https://naver.github.io/billboard.js/demo/#Point.PointSensitivity)
   * @example
   *  point: {
   *      show: false,
   *      r: 5,
   *
   *      // or customize the radius
   *      r: function(d) {
   *          ...
   *          return r;
   *      },
   *
   *      // will generate following radialGradient:
   *      // for more info: https://developer.mozilla.org/en-US/docs/Web/SVG/Element/radialGradient
   *      // <radualGradient cx="0.3" cy="0.3" r="0.7">
   *      //    <stop offset="0.1" stop-color="$DATA_COLOR" stop-opacity="1"></stop>
   *      //    <stop offset="0.9" stop-color="$DATA_COLOR" stop-opacity="0"></stop>
   *      // </radialrGradient>
   *      radialGradient: true,
   *
   *      // Or customized gradient
   *      radialGradient: {
   *      	cx: 0.3,  // cx attributes
   *      	cy: 0.5,  // cy attributes
   *      	r: 0.7,  // r attributes
   *      	stops: [
   *      	  // offset, stop-color, stop-opacity
   *      	  [0, "#7cb5ec", 1],
   *
   *      	  // setting 'null' for stop-color, will set its original data color
   *      	  [0.5, null, 0],
   *
   *      	  // setting 'function' for stop-color, will pass data id as argument.
   *      	  // It should return color string or null value
   *      	  [1, function(id) { return id === "data1" ? "red" : "blue"; }, 0],
   *      	]
   *      },
   *
   *      focus: {
   *          expand: {
   *              enabled: true,
   *              r: 1
   *          },
   *          only: true
   *      },
   *
   *      // do not set inline 'opacity' css prop setting
   *      opacity: null,
   *
   *      // set every data point's opacity value
   *      opacity: 0.7,
   *
   *      select: {
   *          r: 3
   *      },
   *
   *      // having lower value, means how closer to be for interaction
   *      sensitivity: 3,
   *
   *      // sensitivity based on point's radius
   *      sensitivity: "radius",
   *
   *      // callback for each point to determine the sensitivity
   *      sensitivity: function(d) {
   * 	// ex. of argument d:
   * 	// ==> {x: 2, value: 55, id: 'data3', index: 2, r: 19.820624179302296}
   *
   * 	// returning d.r, will make sensitivity same as point's radius value.
   * 	return d.r;
   *      }
   *
   *      // valid values are "circle" or "rectangle"
   *      type: "rectangle",
   *
   *      // or indicate as pattern
   *      pattern: [
   *        "circle",
   *        "rectangle",
   *        "<polygon points='0 6 4 0 -4 0'></polygon>"
   *     ],
   *  }
   */
  point_show: !0,
  point_r: 2.5,
  point_radialGradient: !1,
  point_sensitivity: 10,
  point_focus_expand_enabled: !0,
  point_focus_expand_r: void 0,
  point_focus_only: !1,
  point_opacity: void 0,
  point_pattern: [],
  point_select_r: void 0,
  point_type: "circle"
}, dn = {
  /**
   * Set area options
   * @name area
   * @memberof Options
   * @type {object}
   * @property {object} area Area object
   * @property {boolean} [area.above=false] Set background area `above` the data chart line.
   * @property {boolean} [area.below=false] Set background area `below` the data chart line.
   *  - **NOTE**: Can't be used along with `above` option. When above & below options are set to true, `above` will be prioritized.
   * @property {boolean} [area.front=true] Set area node to be positioned over line node.
   * @property {boolean|object} [area.linearGradient=false] Set the linear gradient on area.<br><br>
   * Or customize by giving below object value:
   *  - x {Array}: `x1`, `x2` value (default: `[0, 0]`)
   *  - y {Array}: `y1`, `y2` value (default: `[0, 1]`)
   *  - stops {Array}: Each item should be having `[offset, stop-color, stop-opacity]` values.
   *    - (default: `[[0, $DATA_COLOR, 1], [1, $DATA_COLOR, 0]]`)
   * @property {boolean} [area.zerobased=true] Set if min or max value will be 0 on area chart.
   * @see [MDN's &lt;linearGradient>](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/linearGradient), [&lt;stop>](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/stop)
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Chart.AreaChart)
   * @see [Demo: above](https://naver.github.io/billboard.js/demo/#AreaChartOptions.Above)
   * @see [Demo: below](https://naver.github.io/billboard.js/demo/#AreaChartOptions.Below)
   * @see [Demo: linearGradient](https://naver.github.io/billboard.js/demo/#AreaChartOptions.LinearGradient)
   * @example
   *  area: {
   *      above: true,
   *      below: false,
   *      zerobased: false,
   *
   *      // <g class='bb-areas'> will be positioned behind the line <g class='bb-lines'> in stacking order
   *      front: false,
   *
   *      // will generate following linearGradient:
   *      // for more info: https://developer.mozilla.org/en-US/docs/Web/SVG/Element/linearGradient
   *      // <linearGradient x1="0" x2="0" y1="0" y2="1">
   *      //    <stop offset="0" stop-color="$DATA_COLOR" stop-opacity="1"></stop>
   *      //    <stop offset="1" stop-color="$DATA_COLOR" stop-opacity="0"></stop>
   *      // </linearGradient>
   *      linearGradient: true,
   *
   *      // Or customized gradient
   *      linearGradient: {
   *      	x: [0, 0],  // x1, x2 attributes
   *      	y: [0, 0],  // y1, y2 attributes
   *      	stops: [
   *      	  // offset, stop-color, stop-opacity
   *      	  [0, "#7cb5ec", 1],
   *
   *      	  // setting 'null' for stop-color, will set its original data color
   *      	  [0.5, null, 0],
   *
   *      	  // setting 'function' for stop-color, will pass data id as argument.
   *      	  // It should return color string or null value
   *      	  [1, function(id) { return id === "data1" ? "red" : "blue"; }, 0],
   *      	]
   *      }
   *  }
   */
  area_above: !1,
  area_below: !1,
  area_front: !0,
  area_linearGradient: !1,
  area_zerobased: !0
}, L0 = {
  /**
   * Set bar options
   * @name bar
   * @memberof Options
   * @type {object}
   * @property {object} bar Bar object
   * @property {boolean} [bar.front=false] Set 'bar' to be positioned over(on the top) other shapes elements.
   * @property {number} [bar.indices.removeNull=false] Remove nullish data on bar indices positions.
   * @property {number} [bar.label.threshold=0] Set threshold ratio to show/hide labels.
   * @property {boolean|object} [bar.linearGradient=false] Set the linear gradient on bar.<br><br>
   * Or customize by giving below object value:
   *  - x {Array}: `x1`, `x2` value (default: `[0, 0]`)
   *  - y {Array}: `y1`, `y2` value (default: `[0, 1]`)
   *  - stops {Array}: Each item should be having `[offset, stop-color, stop-opacity]` values.
   *    - (default: `[[0, $DATA_COLOR, 1], [1, $DATA_COLOR, 0]]`)
   * @property {boolean} [bar.overlap=false] Bars will be rendered at same position, which will be overlapped each other. (for non-grouped bars only)
   * @property {number} [bar.padding=0] The padding pixel value between each bar.
   * @property {number} [bar.radius] Set the radius of bar edge in pixel.
   * @property {number} [bar.radius.ratio] Set the radius ratio of bar edge in relative the bar's width.
   * @property {number} [bar.sensitivity=2] The sensitivity offset value for interaction boundary.
   * @property {number|function|object} [bar.width] Change the width of bar chart.
   * @property {number} [bar.width.ratio=0.6] Change the width of bar chart by ratio.
   * - **NOTE:** Criteria for ratio.
   *   - When x ticks count is same with the data count, the baseline for ratio is the minimum interval value of x ticks.
   * 	   - ex. when timeseries x values are: [2024-01-01, 2024-02-01, 2024-03-01], the minimum interval will be `2024-02-01 ~ 2024-03-01`
   *     - if the minimum interval is 30px, then ratio=1 means 30px.
   *   - When x ticks count is lower than the data count, the baseline will be calculated as `chart width / data count`.
   * 	   - ex. when chart width is 500, data count is 5, then ratio=1 means 100px.
   * @property {number} [bar.width.max] The maximum width value for ratio.
   * @property {number} [bar.width.dataname] Change the width of bar for indicated dataset only.
   * @property {number} [bar.width.dataname.ratio=0.6] Change the width of bar chart by ratio.
   *  - **NOTE:**
   *   - Works only for non-stacked bar
   * @property {number} [bar.width.dataname.max] The maximum width value for ratio.
   * @property {boolean} [bar.zerobased=true] Set if min or max value will be 0 on bar chart.
   * @see [Demo: bar front](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarFront)
   * @see [Demo: bar indices](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarIndices)
   * @see [Demo: bar overlap](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarOverlap)
   * @see [Demo: bar padding](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarPadding)
   * @see [Demo: bar radius](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarRadius)
   * @see [Demo: bar width](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarWidth)
   * @see [Demo: bar width variant](https://naver.github.io/billboard.js/demo/#BarChartOptions.BarWidthVariant)
   * @example
   *  bar: {
   *      // make bar shape to be positioned over the other shape elements
   *      front: true,
   *
   *      // remove nullish data on bar indices positions
   *      indices: {
   *          removeNull: true
   *      },
   *
   *      // will generate following linearGradient:
   *      // for more info: https://developer.mozilla.org/en-US/docs/Web/SVG/Element/linearGradient
   *      // <linearGradient x1="0" x2="0" y1="0" y2="1">
   *      //    <stop offset="0" stop-color="$DATA_COLOR" stop-opacity="1"></stop>
   *      //    <stop offset="1" stop-color="$DATA_COLOR" stop-opacity="0"></stop>
   *      // </linearGradient>
   *      linearGradient: true,
   *
   *      // Or customized gradient
   *      linearGradient: {
   *      	x: [0, 0],  // x1, x2 attributes
   *      	y: [0, 0],  // y1, y2 attributes
   *      	stops: [
   *      	  // offset, stop-color, stop-opacity
   *      	  [0, "#7cb5ec", 1],
   *
   *      	  // setting 'null' for stop-color, will set its original data color
   *      	  [0.5, null, 0],
   *
   *      	  // setting 'function' for stop-color, will pass data id as argument.
   *      	  // It should return color string or null value
   *      	  [1, function(id) { return id === "data1" ? "red" : "blue"; }, 0],
   *      	]
   *      },
   *
   *      // remove nullish da
   *      overlap: true,
   *
   *      padding: 1,
   *
   *      // bar radius
   *      radius: 10,
   *      // or
   *      radius: {
   *          ratio: 0.5
   *      }
   *
   *      label: {
   *          // 0.1(10%) ratio value means, the minimum ratio to show text label relative to the y Axis domain range value.
   *          // if data value is below than 0.1, text label will be hidden.
   *          threshold: 0.1,
   *      },
   *
   *      // will not have offset between each bar elements for interaction
   *      sensitivity: 0,
   *
   *      width: 10,
   *
   *      // or specify width callback. The callback will receive width, targetsNum, maxDataCount as arguments.
   *      // - width: chart area width
   *      // - targetsNum: number of targets
   *      // - maxDataCount: maximum data count among targets
   *      width: function(width, targetsNum, maxDataCount) {
   *            return width / (targetsNum * maxDataCount);
   *      }
   *
   *      // or specify ratio & max
   *      width: {
   *          ratio: 0.2,
   *          max: 20
   *      },
   *
   *      // or specify width per dataset
   *      width: {
   *          data1: 20,
   *          data2: {
   *              ratio: 0.2,
   *              max: 20
   *          }
   *      },
   *
   *      zerobased: false
   *  }
   */
  bar_connectLine: !1,
  bar_front: !1,
  bar_indices_removeNull: !1,
  bar_label_threshold: 0,
  bar_linearGradient: !1,
  bar_overlap: !1,
  bar_padding: 0,
  bar_radius: void 0,
  bar_radius_ratio: void 0,
  bar_sensitivity: 2,
  bar_width: void 0,
  bar_width_ratio: 0.6,
  bar_width_max: void 0,
  bar_zerobased: !0
}, D0 = {
  /**
   * Set bubble options
   * @name bubble
   * @memberof Options
   * @type {object}
   * @property {object} bubble bubble object
   * @property {number|function} [bubble.maxR=35] Set the max bubble radius value
   * @property {boolean} [bubble.zerobased=false] Set if min or max value will be 0 on bubble chart.
   * @example
   *  bubble: {
   *      // ex) If 100 is the highest value among data bound, the representation bubble of 100 will have radius of 50.
   *      // And the lesser will have radius relatively from the max value.
   *      maxR: 50,
   *
   *      // or set radius callback
   *      maxR: function(d) {
   *          // ex. of d param - {x: Fri Oct 06 2017 00:00:00 GMT+0900, value: 80, id: "data2", index: 5}
   *          ...
   *          return Math.sqrt(d.value * 2);
   *      },
   *      zerobased: false
   *  }
   */
  bubble_maxR: 35,
  bubble_zerobased: !1
}, I0 = {
  /**
   * Set candlestick options
   * @name candlestick
   * @memberof Options
   * @type {object}
   * @property {object} candlestick Candlestick object
   * @property {number} [candlestick.width] Change the width.
   * @property {number} [candlestick.width.ratio=0.6] Change the width by ratio.
   * @property {number} [candlestick.width.max] The maximum width value for ratio.
   * @property {number} [candlestick.width.dataname] Change the width for indicated dataset only.
   * @property {number} [candlestick.width.dataname.ratio=0.6] Change the width of bar chart by ratio.
   * @property {number} [candlestick.width.dataname.max] The maximum width value for ratio.
   * @property {object} [candlestick.color] Color setting.
   * @property {string|object} [candlestick.color.down] Change down(bearish) value color.
   * @property {string} [candlestick.color.down.dataname] Change down value color for indicated dataset only.
   *
   * @see [Demo](https://naver.github.io/billboard.js/demo/##Chart.CandlestickChart)
   * @example
   *  candlestick: {
   *      width: 10,
   *
   *      // or
   *      width: {
   *         	ratio: 0.2,
   *         	max: 20
   *      },
   *
   *      // or specify width per dataset
   *      width: {
   *         	data1: 20,
   *         	data2: {
   *         	    ratio: 0.2,
   *         		max: 20
   *         	}
   *      },
   *      color: {
   *  	  	// specify bearish color
   *  	  	down: "red",
   *
   *  	  	// or specify color per dataset
   *  	  	down: {
   *  	  		data1: "red",
   *  	  		data2: "blue",
   *  	  	}
   *      }
   *  }
   */
  candlestick_width: void 0,
  candlestick_width_ratio: 0.6,
  candlestick_width_max: void 0,
  candlestick_color_down: "red"
}, z0 = {
  /**
   * Set line options
   * @name line
   * @memberof Options
   * @type {object}
   * @property {object} line Line object
   * @property {boolean} [line.connectNull=false] Set if null data point will be connected or not.<br>
   *  If true set, the region of null data will be connected without any data point. If false set, the region of null data will not be connected and get empty.
   * @property {Array}   [line.classes=undefined] If set, used to set a css class on each line.
   * @property {boolean} [line.step.type=step] Change step type for step chart.<br>
   * **Available values:**
   * - step
   * - step-before
   * - step-after
   * @property {boolean} [line.step.tooltipMatch=false] Set to `true` for `step-before` and `step-after` types to have cursor/tooltip match to hovered step's point instead of nearest point.
   * @property {boolean|Array} [line.point=true] Set to false to not draw points on linecharts. Or pass an array of line ids to draw points for.
   * @property {boolean} [line.zerobased=false] Set if min or max value will be 0 on line chart.
   * @example
   *  line: {
   *      connectNull: true,
   *      classes: [
   *          "line-class1",
   *          "line-class2"
   *      ],
   *      step: {
   *          type: "step-after",
   *
   *          // to have cursor/tooltip match to hovered step's point instead of nearest point.
   *          tooltipMatch: true
   *      },
   *
   *      // hide all data points ('point.show=false' also has similar effect)
   *      point: false,
   *
   *      // show data points for only indicated data
   *      point: [
   *          "data1", "data3"
   *      ],
   *
   *      zerobased: false
   *  }
   */
  line_connectNull: !1,
  line_step_type: "step",
  line_step_tooltipMatch: !1,
  line_zerobased: !1,
  line_classes: void 0,
  line_point: !0
}, P0 = {
  /**
   * Set scatter options
   * @name scatter
   * @memberof Options
   * @type {object}
   * @property {object} [scatter] scatter object
   * @property {boolean} [scatter.zerobased=false] Set if min or max value will be 0 on scatter chart.
   * @example
   *  scatter: {
   *      connectNull: true,
   *      step: {
   *          type: "step-after"
   *      },
   *
   *      // hide all data points ('point.show=false' also has similar effect)
   *      point: false,
   *
   *      // show data points for only indicated data
   *      point: [
   *          "data1", "data3"
   *      ],
   *
   *      zerobased: false
   *  }
   */
  scatter_zerobased: !1
}, pr = {
  /**
   * Set spline options
   * - **Available interpolation type values:**
   *  - basis (d3.curveBasis)
   *  - basis-closed (d3.curveBasisClosed)
   *  - basis-open (d3.curveBasisOpen)
   *  - bundle (d3.curveBundle)
   *  - cardinal (d3.curveCardinal)
   *  - cardinal-closed (d3.curveCardinalClosed)
   *  - cardinal-open (d3.curveCardinalOpen)
   *  - catmull-rom (d3.curveCatmullRom)
   *  - catmull-rom-closed (d3.curveCatmullRomClosed)
   *  - catmull-rom-open (d3.curveCatmullRomOpen)
   *  - monotone-x (d3.curveMonotoneX)
   *  - monotone-y (d3.curveMonotoneY)
   *  - natural (d3.curveNatural)
   *  - linear-closed (d3.curveLinearClosed)
   *  - linear (d3.curveLinear)
   *  - step (d3.curveStep)
   *  - step-after (d3.curveStepAfter)
   *  - step-before (d3.curveStepBefore)
   * @name spline
   * @memberof Options
   * @type {object}
   * @property {object} spline Spline object
   * @property {object} spline.interpolation Spline interpolation object
   * @property {string} [spline.interpolation.type="cardinal"] Interpolation type
   * @see [Interpolation (d3 v4)](http://bl.ocks.org/emmasaunders/c25a147970def2b02d8c7c2719dc7502)
   * @example
   *  spline: {
   *      interpolation: {
   *          type: "cardinal"
   *      }
   *  }
   */
  spline_interpolation_type: "cardinal"
}, Ba = {
  /**
   * Set arc options
   * @name arc
   * @memberof Options
   * @type {object}
   * @property {object} arc Arc object
   * @property {number|function} [arc.cornerRadius=0] Set corner radius of Arc(donut/gauge/pie/polar) shape.
   *  - **NOTE:**
   * 	  - Corner radius can't surpass the `(outerRadius - innerRadius) /2` of indicated shape.
   * @property {number} [arc.cornerRadius.ratio=0] Set ratio relative of outer radius.
   * @property {object} [arc.needle] Set needle options.
   * @property {boolean} [arc.needle.show=false] Show or hide needle.
   * @property {string} [arc.needle.color] Set needle filled color.
   * @property {function} [arc.needle.path] Set custom needle path function.
   *  - **NOTE:**
   *   - The path should be starting from 0,0 (which is center) to top center coordinate.
   *   - The function will receive, `length`{number} parameter which indicating the needle length in pixel relative to radius.
   * @property {number} [arc.needle.value] Set needle value.
   *  - **NOTE:**
   *   - For single gauge chart, needle will point the data value by default, otherwise will point 0(zero).
   * @property {number} [arc.needle.length=100] Set needle length in percentages relative to radius.
   * @property {object} [arc.needle.top] Set needle top options.
   * @property {number} [arc.needle.top.rx=0] Set needle top [rx radius value](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#elliptical_arc_curve).
   * @property {number} [arc.needle.top.ry=0] Set needle top [ry radius value](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#elliptical_arc_curve).
   * @property {number} [arc.needle.top.width=0] Set needle top width in pixel.
   * @property {object} [arc.needle.bottom] Set needle bottom options.
   * @property {number} [arc.needle.bottom.rx=1] Set needle bottom [rx radius value](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#elliptical_arc_curve).
   * @property {number} [arc.needle.bottom.ry=1] Set needle bottom [ry radius value](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#elliptical_arc_curve).
   * @property {number} [arc.needle.bottom.width=15] Set needle bottom width in pixel.
   * @property {number} [arc.needle.bottom.len=0] Set needle bottom length in pixel. Setting this value, will make bottom larger starting from center.
   * @property {object} [arc.rangeText] Set rangeText options.
   * @property {Array} [arc.rangeText.values] Set range text values to be shown around Arc.
   * - When `unit: 'absolute'`: Given values are treated as absolute values.
   * - When `unit: '%'`: Given values are treated as percentages.
   * @property {string} [arc.rangeText.unit="absolute"] Specify the range text unit.
   * - "absolute": Show absolute value
   * - "%": Show percentage value
   * @property {boolean} [arc.rangeText.fixed=false] Set if range text shown will be fixed w/o data toggle update. Only available for gauge chart.
   * @property {function} [arc.rangeText.format] Set format function for the range text.
   * @property {number} [arc.rangeText.position] Set position function or object for the range text.
   * @see [Demo: Donut corner radius](https://naver.github.io/billboard.js/demo/#DonutChartOptions.DonutCornerRadius)
   * @see [Demo: Donut corner radius](https://naver.github.io/billboard.js/demo/#PieChartOptions.CornerRadius)
   * @see [Demo: Donut needle](https://naver.github.io/billboard.js/demo/#DonutChartOptions.DonutNeedle)
   * @see [Demo: Donut RangeText](https://naver.github.io/billboard.js/demo/#DonutChartOptions.DonutRangeText)
   * @see [Demo: Gauge corner radius](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeCornerRadius)
   * @see [Demo: Gauge needle](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeNeedle)
   * @see [Demo: Gauge RangeText](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeRangeText)
   * @example
   *  arc: {
   *      cornerRadius: 12,
   *
   *      // can customize corner radius for each data with function callback
   *      //
   *      // The function will receive:
   *      // - id {string}: Data id
   *      // - value {number}: Data value
   *      // - outerRadius {number}: Outer radius value
   *      cornerRadius: function(id, value, outerRadius) {
   *          return (id === "data1" && value > 10) ?
   *          	50 : outerRadius * 1.2;
   *      },
   *
   *      // set ratio relative of outer radius
   *      cornerRadius: {
   *          ratio: 0.5
   *      },
   *
   *      needle: {
   *       	show: true,
   *       	color: "red", // any valid CSS color
   *       	path: function(length) {
   *       	  const len = length - 20;
   *
   *       	  // will return upper arrow shape path
   *       	  // Note: The path should begun from '0,0' coordinate to top center.
   *       	  const path = `M 0 -${len + 20}
   *       		L -12 -${len}
   *       		L -5 -${len}
   *       		L -5 0
   *       		A 1 1 0 0 0 5 0
   *       		L 5 -${len}
   *       		L 12 -${len} Z`;
   *
   *       	  return path;
   *       	},
   *       	value: 40,  // will make needle to point value 40.
   *       	length: 80, // needle length in percentages relative to radius.
   *
   *       	top: {
   *       	  // rx and ry are the two radii of the ellipse;
   *       	  // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#elliptical_arc_curve
   *       	  rx: 1,
   *       	  ry: 1,
   *       	  width: 5
   *       	},
   *       	bottom: {
   *       	  // rx and ry are the two radii of the ellipse;
   *       	  // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d#elliptical_arc_curve
   *       	  rx: 1,
   *       	  ry: 1,
   *       	  width: 10
   *       	  len: 10
   *       	}
   *      },
   *
   *      rangeText: {
   *       	values: [15, 30, 50, 75, 95],
   *       	unit: "%",
   *       	fixed: false, // only available for gauge chart
   *       	format: function(v) {
   *       	  return v === 15 ? "Fifteen" : v;
   *       	},
   *
   *       	position: function(v) {
   *       	  return v === 15 ? {x: 20, y: 10} : null; // can return one props value also.
   *       	},
   *       	position: {x: 10, y: 15},
   *       	position: {x: 10}
   *      }
   *  }
   */
  arc_cornerRadius: 0,
  arc_cornerRadius_ratio: 0,
  arc_needle_show: !1,
  arc_needle_color: void 0,
  arc_needle_value: void 0,
  arc_needle_path: void 0,
  arc_needle_length: 100,
  arc_needle_top_rx: 0,
  arc_needle_top_ry: 0,
  arc_needle_top_width: 0,
  arc_needle_bottom_rx: 1,
  arc_needle_bottom_ry: 1,
  arc_needle_bottom_width: 15,
  arc_needle_bottom_len: 0,
  arc_rangeText_values: void 0,
  arc_rangeText_unit: "absolute",
  arc_rangeText_fixed: !1,
  arc_rangeText_format: void 0,
  arc_rangeText_position: void 0
}, O0 = {
  /**
   * Set donut options
   * @name donut
   * @memberof Options
   * @type {object}
   * @property {object} donut Donut object
   * @property {boolean} [donut.label.show=true] Show or hide label on each donut piece.
   * @property {function} [donut.label.format] Set formatter for the label on each donut piece.
   * @property {number} [donut.label.threshold=0.05] Set threshold ratio to show/hide labels.
   * @property {number|function} [donut.label.ratio=undefined] Set ratio of labels position.
   * @property {boolean|object} [donut.label.line=false] Enable label with lines (displayed outside with connector lines).
   *  - `true`: Enable label with lines with default settings
   *  - `false`: Labels are displayed inside the donut slices (default behavior).
   *  - `{show: boolean, distance: number, text: boolean}`: Enable label with lines with custom settings. When object member is not provided, it will be set to default values.
   * @property {boolean} [donut.label.line.show=true] Show or hide connector lines.
   * @property {number} [donut.label.line.distance=20] Set the distance of the horizontal part of the connector line in pixels.
   * @property {boolean|function} [donut.label.line.text=true] Show text at the end of the connector line (outside the shape).
   *  - `true`: show data "id" text
   *  - `false`: use default formatter(label.format) to show text
   *  - `function(value, ratio, id)`: Custom formatter function for the text.
   *  - **NOTE:** When the viewport size decreases, the size is adjusted based on the shape, so text may appear clipped. In this case, consider setting `overflow: visible` on the SVG node.
   * @property {object|function} [donut.label.image] Set image to be displayed next to the label text.<br><br>
   * When function is specified, will receives 3 arguments such as `v, id, i` and it must return an image object with `url`, `width`, `height`, and optional `pos` properties.<br><br>
   * The arguments are:<br>
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   * @property {string} donut.label.image.url Image URL path. Can use placeholder `{=ID}` which will be replaced with the data ID.
   * @property {number} donut.label.image.width Image width in pixels.
   * @property {number} donut.label.image.height Image height in pixels.
   * @property {object} [donut.label.image.pos] Image position relative to the label text.
   * @property {number} [donut.label.image.pos.x=0] x coordinate position, relative the original.
   * @property {number} [donut.label.image.pos.y=0] y coordinate position, relative the original.
   * @property {boolean} [donut.expand=true] Enable or disable expanding donut pieces.
   * @property {number} [donut.expand.rate=0.98] Set expand rate.
   * @property {number} [donut.expand.duration=50] Set expand transition time in ms.
   * @property {number} [donut.width] Set width of donut chart.
   * @property {string} [donut.title=""] Set title of donut chart. Use `\n` character for line break.
   *  - **NOTE:**
   *    - When `arc.needle.show=true` is set, special template `{=NEEDLE_VALUE}` can be used inside the title text to show current needle value.
   * @property {number} [donut.padAngle=0] Set padding between data.
   * @property {number} [donut.startingAngle=0] Set starting angle where data draws.
   * @see [Demo: Corner Radius](https://naver.github.io/billboard.js/demo/#DonutChartOptions.DonutCornerRadius)
   * @see [Demo: Needle](https://naver.github.io/billboard.js/demo/#DonutChartOptions.DonutNeedle)
   * @see [Demo: Range Text](https://naver.github.io/billboard.js/demo/#DonutChartOptions.DonutRangeText)
   * @see [Demo: Label Image](https://naver.github.io/billboard.js/demo/#DonutChartOptions.LabelImage)
   * @see [Demo: Label Line](https://naver.github.io/billboard.js/demo/#DonutChartOptions.LabelLine)
   * @see [Demo: Label Ratio](https://naver.github.io/billboard.js/demo/#DonutChartOptions.LabelRatio)
   * @see [Demo: Multiline Label](https://naver.github.io/billboard.js/demo/#DonutChartOptions.MultilineLabel)
   * @see [Demo: Multiline Title](https://naver.github.io/billboard.js/demo/#DonutChartOptions.MultilineTitle)
   * @see [Demo: Pad Angle](https://naver.github.io/billboard.js/demo/#DonutChartOptions.padAngle)
   * @see [Demo: Starting Angle](https://naver.github.io/billboard.js/demo/#DonutChartOptions.StartingAngle)
   *
   * @example
   *  donut: {
   *      label: {
   *          show: false,
   *          format: function(value, ratio, id) {
   *              return d3.format("$")(value);
   *
   *              // to multiline, return with '\n' character
   *              // return value +"%\nLine1\n2Line2";
   *          },
   *
   *          // 0.1(10%) ratio value means, the minimum ratio to show text label relative to the total value.
   *          // if data value is below than 0.1, text label will be hidden.
   *          threshold: 0.1,
   *
   *          // set ratio callback. Should return ratio value
   *          ratio: function(d, radius, h) {
   *          	...
   *          	return ratio;
   *          },
   *          // or set ratio number
   *          ratio: 0.5,
   *
   *          // Enable label with lines (displayed outside with connector lines)
   *          line: false,  // default - labels inside
   *          line: true,   // enable label with lines with default settings
   *          line: {       // enable label with lines with custom settings
   *             show: true,
   *             distance: 20,  // horizontal line distance in pixels
   *
   *             // show text at the end of connector line (outside the shape)
   *             text: true,  // use default formatter
   *             text: function(value, ratio, id) {  // custom formatter
   *                 return d3.format(".1%")(ratio);
   *             }
   *          },
   *
   *          // set image to be displayed next to the label text
   *          image: {
   *             url: "./sample.svg",
   *
   *             // use placeholder to dynamically set image URL based on data ID
   *             url: "./images/{=ID}.svg",  // will be replaced to "./images/data1.svg", "./images/data2.svg", etc.
   *             width: 35,
   *             height: 35,
   *             pos: {
   *                x: 0,
   *                y: 0
   *             }
   *          },
   *
   *          // or use function to return image configuration dynamically
   *          image: function(v, id, i) {
   *             // Return different images based on value
   *             if (v > 500) {
   *                return {
   *                   url: "./high-value.svg",
   *                   width: 40,
   *                   height: 40,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if (v > 100) {
   *                return {
   *                   url: "./medium-value.svg",
   *                   width: 30,
   *                   height: 30,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if(v < 5) {
   *                // Return falsy value in case of don't want to show image
   *                return null;
   *             } else {
   *                return {
   *                   url: "./low-value.svg",
   *                   width: 20,
   *                   height: 20,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             }
   *          }
   *      },
   *
   *      // disable expand transition for interaction
   *      expand: false,
   *
   *      expand: {
   *      	// set duration of expand transition to 500ms.
   *          duration: 500,
   *
   *      	// set expand area rate
   *          rate: 1
   *      },
   *
   *      width: 10,
   *      padAngle: 0.2,
   *      startingAngle: 1,
   *      title: "Donut Title"
   *
   *      // when 'arc.needle.show=true' is set, can show current needle value.
   *      title: "Needle value:\n{=NEEDLE_VALUE}",
   *
   *      // title with line break
   *      title: "Title1\nTitle2"
   *  }
   */
  donut_label_show: !0,
  donut_label_format: void 0,
  donut_label_threshold: 0.05,
  donut_label_line: !1,
  donut_label_image: void 0,
  donut_label_ratio: void 0,
  donut_width: void 0,
  donut_title: "",
  donut_expand: {},
  donut_expand_rate: 0.98,
  donut_expand_duration: 50,
  donut_padAngle: 0,
  donut_startingAngle: 0
}, F0 = {
  /**
   * Set funnel options
   * @name funnel
   * @memberof Options
   * @type {object}
   * @property {object} funnel Funnel object
   * @property {number} [funnel.neck.width=0] Set funnel neck width.
   * @property {number} [funnel.neck.height=0] Set funnel neck height.
   * @property {number} [funnel.neck.width.ratio] Set funnel neck width in ratio.
   * @property {number} [funnel.neck.height.ratio] Set funnel neck height in ratio.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Chart.PolarChart)
   * @example
   *  funnel: {
   *      neck: {
   *          width: 200,
   *          height: 100,
   *
   *          // or specify as ratio value (relative to the chart size)
   *          width: {
   *            ratio: 0.5
   *          },
   *          height: {
   *            ratio: 0.5
   *          }
   *      }
   *  }
   */
  funnel_neck_width: 0,
  funnel_neck_height: 0
}, N0 = {
  /**
   * Set gauge options
   * @name gauge
   * @memberof Options
   * @type {object}
   * @property {object} gauge Gauge object
   * @property {boolean} [gauge.background=""] Set background color. (The `.bb-chart-arcs-background` element)
   * @property {boolean} [gauge.fullCircle=false] Show full circle as donut. When set to 'true', the max label will not be showed due to start and end points are same location.
   * @property {boolean} [gauge.label.show=true] Show or hide label on gauge.
   * @property {function} [gauge.label.extents] Set customized min/max label text.
   * @property {function} [gauge.label.format] Set formatter for the label on gauge. Label text can be multilined with `\n` character.<br>
   * Will pass following arguments to the given function:
   * - value {number}: absolute value
   * - ratio {number}: value's ratio
   * - id {string}: data's id value
   * @property {number|function} [gauge.label.ratio=undefined] Set ratio of labels position.
   * @property {number} [gauge.label.threshold=0] Set threshold ratio to show/hide labels.
   * @property {boolean|object} [gauge.label.line=false] Enable label with lines (displayed outside with connector lines).
   *  - **NOTE:** Only applicable for single gauge (not for `gauge.type="multi"`).
   *  - `true`: Enable label with lines with default settings
   *  - `false`: Labels are displayed inside the gauge (default behavior).
   *  - `{show: boolean, distance: number, text: boolean}`: Enable label with lines with custom settings. When object member is not provided, it will be set to default values.
   * @property {boolean} [gauge.label.line.show=true] Show or hide connector lines.
   * @property {number} [gauge.label.line.distance=20] Set the distance of the horizontal part of the connector line in pixels.
   * @property {boolean|function} [gauge.label.line.text=true] Show text at the end of the connector line (outside the shape).
   *  - `true`: show data "id" text
   *  - `false`: use default formatter(label.format) to show text
   *  - `function(value, ratio, id)`: Custom formatter function for the text.
   *  - **NOTE:** When the viewport size decreases, the size is adjusted based on the shape, so text may appear clipped. In this case, consider setting `overflow: visible` on the SVG node.
   * @property {object|function} [gauge.label.image] Set image to be displayed next to the label text.<br><br>
   * When function is specified, will receives 3 arguments such as `v, id, i` and it must return an image object with `url`, `width`, `height`, and optional `pos` properties.<br><br>
   * The arguments are:<br>
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   * @property {string} gauge.label.image.url Image URL path. Can use placeholder `{=ID}` which will be replaced with the data ID.
   * @property {number} gauge.label.image.width Image width in pixels.
   * @property {number} gauge.label.image.height Image height in pixels.
   * @property {object} [gauge.label.image.pos] Image position relative to the label text.
   * @property {number} [gauge.label.image.pos.x=0] x coordinate position, relative the original.
   * @property {number} [gauge.label.image.pos.y=0] y coordinate position, relative the original.
   * @property {boolean} [gauge.expand=true] Enable or disable expanding gauge.
   * @property {number} [gauge.expand.rate=0.98] Set expand rate.
   * @property {number} [gauge.expand.duration=50] Set the expand transition time in milliseconds.
   * @property {boolean} [gauge.enforceMinMax=false] Enforce to given min/max value.
   * - **Note:** Only works for single data series.
   * 	- When `gauge.min=50` and given value is `30`, gauge will render as empty value.
   * 	- When `gauge.max=100` and given value is `120`, gauge will render till 100, not surpassing max value.
   * @property {number} [gauge.min=0] Set min value of the gauge.
   * @property {number} [gauge.max=100] Set max value of the gauge.
   * @property {number} [gauge.startingAngle=-1 * Math.PI / 2] Set starting angle where data draws.
   *
   * **Limitations:**
   * - when `gauge.fullCircle=false`:
   *   - -1 * Math.PI / 2 <= startingAngle <= Math.PI / 2
   *   - `startingAngle <= -1 * Math.PI / 2` defaults to `-1 * Math.PI / 2`
   *   - `startingAngle >= Math.PI / 2` defaults to `Math.PI / 2`
   * - when `gauge.fullCircle=true`:
   *   - -1 * Math.PI < startingAngle < Math.PI
   *   - `startingAngle < -1 * Math.PI` defaults to `Math.PI`
   *   - `startingAngle >  Math.PI` defaults to `Math.PI`
   * @property {number} [gauge.arcLength=100] Set the length of the arc to be drawn in percent from -100 to 100.<br>
   * Negative value will draw the arc **counterclockwise**. Need to be used in conjunction with `gauge.fullCircle=true`.
   *
   * **Limitations:**
   * - -100 <= arcLength (in percent) <= 100
   * - 'arcLength < -100' defaults to -100
   * - 'arcLength > 100' defaults to 100
   * @property {string} [gauge.title=""] Set title of gauge chart. Use `\n` character for line break.
   *  - **NOTE:**
   *    - When `arc.needle.show=true` is set, special template `{=NEEDLE_VALUE}` can be used inside the title text to show current needle value.
   * @property {string} [gauge.units] Set units of the gauge.
   * @property {number} [gauge.width] Set width of gauge chart.
   * @property {string} [gauge.type="single"] Set type of gauge to be displayed.<br><br>
   * **Available Values:**
   * - single
   * - multi
   * @property {number} [gauge.arcs.minWidth=5] Set minimal width of gauge arcs until the innerRadius disappears.
   * @see [Demo: enforceMinMax, min/max](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeMinMax)
   * @see [Demo: archLength](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeArcLength)
   * @see [Demo: startingAngle](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeStartingAngle)
   * @see [Demo: label image](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeLabelImage)
   * @see [Demo: label line](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeLabelLine)
   * @see [Demo: label ratio](https://naver.github.io/billboard.js/demo/#GaugeChartOptions.GaugeLabelRatio)
   * @example
   *  gauge: {
   *      background: "#eee", // will set 'fill' css prop for '.bb-chart-arcs-background' classed element.
   *      fullCircle: false,
   *      label: {
   *          show: false,
   *          format: function(value, ratio, id) {
   *              return value;
   *
   *              // to multiline, return with '\n' character
   *              // return value +"%\nLine1\n2Line2";
   *          },
   *
   *           extents: function(value, isMax) {
   *              return (isMax ? "Max:" : "Min:") + value;
   *          },
   *
   *          // 0.1(10%) ratio value means, the minimum ratio to show text label relative to the total value.
   *          // if data value is below than 0.1, text label will be hidden.
   *          threshold: 0.1,
   *
   *          // Enable label with lines (displayed outside with connector lines)
   *          // NOTE: Only works with single gauge (not gauge.type="multi")
   *          line: true,   // enable label with lines with default settings
   *          line: {       // enable label with lines with custom settings
   *              show: true,      // enable lines (default: true when line is enabled)
   *              distance: 30,    // distance of horizontal line in pixels (default: 20)
   *
   *              // show text at the end of connector line (outside the shape)
   *              text: true,  // use default formatter
   *              text: function(value, ratio, id) {  // custom formatter
   *                  return d3.format(".1%")(ratio);
   *              }
   *          },
   *
   *          // set ratio callback. Should return ratio value
   *          ratio: function(d, radius, h) {
   *              ...
   *              return ratio;
   *          },
   *          // or set ratio number
   *          ratio: 0.5,
   *
   *          // set image to be displayed next to the label text
   *          image: {
   *             url: "./sample.svg",
   *
   *             // use placeholder to dynamically set image URL based on data ID
   *             url: "./images/{=ID}.svg",  // will be replaced to "./images/data1.svg", "./images/data2.svg", etc.
   *             width: 35,
   *             height: 35,
   *             pos: {
   *                x: 0,
   *                y: 0
   *             }
   *          },
   *
   *          // or use function to return image configuration dynamically
   *          image: function(v, id, i) {
   *             // Return different images based on value
   *             if (v > 500) {
   *                return {
   *                   url: "./high-value.svg",
   *                   width: 40,
   *                   height: 40,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if (v > 100) {
   *                return {
   *                   url: "./medium-value.svg",
   *                   width: 30,
   *                   height: 30,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if(v < 5) {
   *                // Return falsy value in case of don't want to show image
   *                return null;
   *             } else {
   *                return {
   *                   url: "./low-value.svg",
   *                   width: 20,
   *                   height: 20,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             }
   *          }
   *      },
   *
   *      // disable expand transition for interaction
   *      expand: false,
   *
   *      expand: {
   *      	// set duration of expand transition to 500ms.
   *          duration: 500,
   *
   *      	// set expand area rate
   *          rate: 1
   *      },
   *
   *      // enforce min/max value.
   * 		// when given value < min, will render as empty value.
   * 		// when value > max, will render to given max value not surpassing it.
   *      enforceMinMax: true,
   *
   *      min: -100,
   *      max: 200,
   *      type: "single"  // or 'multi'
   *      title: "Title Text",
   *
   *      // when 'arc.needle.show=true' is set, can show current needle value.
   *      title: "Needle value:\n{=NEEDLE_VALUE}",
   *
   *      units: "%",
   *      width: 10,
   *      startingAngle: -1 * Math.PI / 2,
   *      arcLength: 100,
   *      arcs: {
   *          minWidth: 5
   *      }
   *  }
   */
  gauge_background: "",
  gauge_fullCircle: !1,
  gauge_label_show: !0,
  gauge_label_extents: void 0,
  gauge_label_format: void 0,
  gauge_label_ratio: void 0,
  gauge_label_threshold: 0,
  gauge_label_line: !1,
  gauge_label_image: void 0,
  gauge_enforceMinMax: !1,
  gauge_min: 0,
  gauge_max: 100,
  gauge_type: "single",
  gauge_startingAngle: -1 * Math.PI / 2,
  gauge_arcLength: 100,
  gauge_title: "",
  gauge_units: void 0,
  gauge_width: void 0,
  gauge_arcs_minWidth: 5,
  gauge_expand: {},
  gauge_expand_rate: 0.98,
  gauge_expand_duration: 50
}, B0 = {
  /**
   * Set pie options
   * @name pie
   * @memberof Options
   * @type {object}
   * @property {object} pie Pie object
   * @property {boolean} [pie.label.show=true] Show or hide label on each pie piece.
   * @property {function} [pie.label.format] Set formatter for the label on each pie piece.
   * @property {number|function} [pie.label.ratio=undefined] Set ratio of labels position.
   * @property {number} [pie.label.threshold=0.05] Set threshold ratio to show/hide labels.
   * @property {boolean|object} [pie.label.line=false] Enable label with lines (displayed outside with connector lines).
   *  - `true`: Enable label with lines with default settings
   *  - `false`: Labels are displayed inside the pie slices (default behavior).
   *  - `{show: boolean, distance: number, text: boolean}`: Enable label with lines with custom settings. When object member is not provided, it will be set to default values.
   * @property {boolean} [pie.label.line.show=true] Show or hide connector lines.
   * @property {number} [pie.label.line.distance=20] Set the distance of the horizontal part of the connector line in pixels.
   * @property {boolean|function} [pie.label.line.text=true] Show text at the end of the connector line (outside the shape).
   *  - `true`: show data "id" text
   *  - `false`: use default formatter(label.format) to show text
   *  - `function(value, ratio, id)`: Custom formatter function for the text.
   *  - **NOTE:** When the viewport size decreases, the size is adjusted based on the shape, so text may appear clipped. In this case, consider setting `overflow: visible` on the SVG node.
   * @property {object|function} [pie.label.image] Set image to be displayed next to the label text.<br><br>
   * When function is specified, will receives 3 arguments such as `v, id, i` and it must return an image object with `url`, `width`, `height`, and optional `pos` properties.<br><br>
   * The arguments are:<br>
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   * @property {string} pie.label.image.url Image URL path. Can use placeholder `{=ID}` which will be replaced with the data ID.
   * @property {number} pie.label.image.width Image width in pixels.
   * @property {number} pie.label.image.height Image height in pixels.
   * @property {object} [pie.label.image.pos] Image position relative to the label text.
   * @property {number} [pie.label.image.pos.x=0] x coordinate position, relative the original.
   * @property {number} [pie.label.image.pos.y=0] y coordinate position, relative the original.
   * @property {boolean|object} [pie.expand=true] Enable or disable expanding pie pieces.
   * @property {number} [pie.expand.rate=0.98] Set expand rate.
   * @property {number} [pie.expand.duration=50] Set expand transition time in ms.
   * @property {number|object} [pie.innerRadius=0] Sets the inner radius of pie arc.
   * @property {number|object|undefined} [pie.outerRadius=undefined] Sets the outer radius of pie arc.
   * @property {number} [pie.padAngle=0] Set padding between data.
   * @property {number} [pie.padding=0] Sets the gap between pie arcs.
   * @property {number} [pie.startingAngle=0] Set starting angle where data draws.
   * @see [Demo: expand.rate](https://naver.github.io/billboard.js/demo/#PieChartOptions.ExpandRate)
   * @see [Demo: innerRadius](https://naver.github.io/billboard.js/demo/#PieChartOptions.InnerRadius)
   * @see [Demo: outerRadius](https://naver.github.io/billboard.js/demo/#PieChartOptions.OuterRadius)
   * @see [Demo: startingAngle](https://naver.github.io/billboard.js/demo/#PieChartOptions.StartingAngle)
   * @see [Demo: label image](https://naver.github.io/billboard.js/demo/#PieChartOptions.LabelImage)
   * @see [Demo: label line](https://naver.github.io/billboard.js/demo/#PieChartOptions.LabelLine)
   * @example
   *  pie: {
   *      label: {
   *          show: false,
   *          format: function(value, ratio, id) {
   *              return d3.format("$")(value);
   *
   *              // to multiline, return with '\n' character
   *              // return value +"%\nLine1\n2Line2";
   *          },
   *
   *          // 0.1(10%) ratio value means, the minimum ratio to show text label relative to the total value.
   *          // if data value is below than 0.1, text label will be hidden.
   *          threshold: 0.1,
   *
   *          // set ratio callback. Should return ratio value
   *          ratio: function(d, radius, h) {
   *              ...
   *              return ratio;
   *          },
   *          // or set ratio number
   *          ratio: 0.5,
   *
   *          // Enable label with lines (displayed outside with connector lines)
   *          line: false,  // default - labels inside
   *          line: true,   // enable label with lines with default settings
   *          line: {       // enable label with lines with custom settings
   *             show: true,
   *             distance: 20,  // horizontal line distance in pixels
   *
   *             // show text at the end of connector line (outside the shape)
   *             text: true,  // use default formatter
   *             text: function(value, ratio, id) {  // custom formatter
   *                 return d3.format(".1%")(ratio);
   *             }
   *          },
   *
   *          // set image to be displayed next to the label text
   *          image: {
   *             url: "./sample.svg",
   *
   *             // use placeholder to dynamically set image URL based on data ID
   *             url: "./images/{=ID}.svg",  // will be replaced to "./images/data1.svg", "./images/data2.svg", etc.
   *             width: 35,
   *             height: 35,
   *             pos: {
   *                x: 0,
   *                y: 0
   *             }
   *          },
   *
   *          // or use function to return image configuration dynamically
   *          image: function(v, id, i) {
   *             // Return different images based on value
   *             if (v > 500) {
   *                return {
   *                   url: "./high-value.svg",
   *                   width: 40,
   *                   height: 40,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if (v > 100) {
   *                return {
   *                   url: "./medium-value.svg",
   *                   width: 30,
   *                   height: 30,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if(v < 5) {
   *                // Return falsy value in case of don't want to show image
   *                return null;
   *             } else {
   *                return {
   *                   url: "./low-value.svg",
   *                   width: 20,
   *                   height: 20,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             }
   *          }
   *      },
   *
   *      // disable expand transition for interaction
   *      expand: false,
   *
   *      expand: {
   *      	// set duration of expand transition to 500ms.
   *          duration: 500,
   *
   *      	// set expand area rate
   *          rate: 1
   *      },
   *
   *      innerRadius: 0,
   *
   *      // set different innerRadius for each data
   *      innerRadius: {
   *      	data1: 10,
   *      	data2: 0
   *      },
   *
   *      outerRadius: 100,
   *
   *      // set different outerRadius for each data
   *      outerRadius: {
   *      	data1: 50,
   *      	data2: 100
   *      }
   *
   *      padAngle: 0.1,
   *      padding: 0,
   *      startingAngle: 1
   *  }
   */
  pie_label_show: !0,
  pie_label_format: void 0,
  pie_label_ratio: void 0,
  pie_label_threshold: 0.05,
  pie_label_line: !1,
  pie_label_image: void 0,
  pie_expand: {},
  pie_expand_rate: 0.98,
  pie_expand_duration: 50,
  pie_innerRadius: 0,
  pie_outerRadius: void 0,
  pie_padAngle: 0,
  pie_padding: 0,
  pie_startingAngle: 0
}, X0 = {
  /**
   * Set polar options
   * @name polar
   * @memberof Options
   * @type {object}
   * @property {object} polar Polar object
   * @property {boolean} [polar.label.show=true] Show or hide label on each polar piece.
   * @property {function} [polar.label.format] Set formatter for the label on each polar piece.
   * @property {number} [polar.label.threshold=0.05] Set threshold ratio to show/hide labels.
   * @property {number|function} [polar.label.ratio=undefined] Set ratio of labels position.
   * @property {boolean|object} [polar.label.line=false] Enable label with lines (displayed outside with connector lines).
   *  - `true`: Enable label with lines with default settings
   *  - `false`: Labels are displayed inside the polar slices (default behavior).
   *  - `{show: boolean, distance: number, text: boolean}`: Enable label with lines with custom settings. When object member is not provided, it will be set to default values.
   * @property {boolean} [polar.label.line.show=true] Show or hide connector lines.
   * @property {number} [polar.label.line.distance=20] Set the distance of the horizontal part of the connector line in pixels.
   * @property {boolean|function} [polar.label.line.text=true] Show text at the end of the connector line (outside the shape).
   *  - `true`: show data "id" text
   *  - `false`: use default formatter(label.format) to show text
   *  - `function(value, ratio, id)`: Custom formatter function for the text.
   *  - **NOTE:** When the viewport size decreases, the size is adjusted based on the shape, so text may appear clipped. In this case, consider setting `overflow: visible` on the SVG node.
   * @property {object|function} [polar.label.image] Set image to be displayed next to the label text.<br><br>
   * When function is specified, will receives 3 arguments such as `v, id, i` and it must return an image object with `url`, `width`, `height`, and optional `pos` properties.<br><br>
   * The arguments are:<br>
   *  - `v` is the value of the data point where the label is shown.
   *  - `id` is the id of the data where the label is shown.
   *  - `i` is the index of the data series point where the label is shown.
   * @property {string} polar.label.image.url Image URL path. Can use placeholder `{=ID}` which will be replaced with the data ID.
   * @property {number} polar.label.image.width Image width in pixels.
   * @property {number} polar.label.image.height Image height in pixels.
   * @property {object} [polar.label.image.pos] Image position relative to the label text.
   * @property {number} [polar.label.image.pos.x=0] x coordinate position, relative the original.
   * @property {number} [polar.label.image.pos.y=0] y coordinate position, relative the original.
   * @property {number} [polar.level.depth=3] Set the level depth.
   * @property {boolean} [polar.level.show=true] Show or hide level.
   * @property {string} [polar.level.text.backgroundColor="#fff"] Set label text's background color.
   * @property {function} [polar.level.text.format] Set format function for the level value.<br>- Default value: `(x) => x % 1 === 0 ? x : x.toFixed(2)`
   * @property {boolean} [polar.level.text.show=true] Show or hide level text.
   * @property {number} [polar.padAngle=0] Set padding between data.
   * @property {number} [polar.padding=0] Sets the gap between pie arcs.
   * @property {number} [polar.startingAngle=0] Set starting angle where data draws.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Chart.PolarChart)
   * @see [Demo: label image](https://naver.github.io/billboard.js/demo/#PolarChartOptions.LabelImage)
   * @see [Demo: label line](https://naver.github.io/billboard.js/demo/#PolarChartOptions.LabelLine)
   * @example
   *  polar: {
   *      label: {
   *          show: false,
   *          format: function(value, ratio, id) {
   *              return d3.format("$")(value);
   *
   *              // to multiline, return with '\n' character
   *              // return value +"%\nLine1\n2Line2";
   *          },
   *
   *          // 0.1(10%) ratio value means, the minimum ratio to show text label relative to the total value.
   *          // if data value is below than 0.1, text label will be hidden.
   *          threshold: 0.1,
   *
   *          // set ratio callback. Should return ratio value
   *          ratio: function(d, radius, h) {
   *              ...
   *              return ratio;
   *          },
   *          // or set ratio number
   *          ratio: 0.5,
   *
   *          // Enable label with lines (displayed outside with connector lines)
   *          line: false,  // default - labels inside
   *          line: true,   // enable label with lines with default settings
   *          line: {       // enable label with lines with custom settings
   *             show: true,
   *             distance: 20,  // horizontal line distance in pixels
   *
   *             // show text at the end of connector line (outside the shape)
   *             text: true,  // use default formatter
   *             text: function(value, ratio, id) {  // custom formatter
   *                 return d3.format(".1%")(ratio);
   *             }
   *          },
   *
   *          // set image to be displayed next to the label text
   *          image: {
   *             url: "./sample.svg",
   *
   *             // use placeholder to dynamically set image URL based on data ID
   *             url: "./images/{=ID}.svg",  // will be replaced to "./images/data1.svg", "./images/data2.svg", etc.
   *             width: 35,
   *             height: 35,
   *             pos: {
   *                x: 0,
   *                y: 0
   *             }
   *          },
   *
   *          // or use function to return image configuration dynamically
   *          image: function(v, id, i) {
   *             // Return different images based on value
   *             if (v > 500) {
   *                return {
   *                   url: "./high-value.svg",
   *                   width: 40,
   *                   height: 40,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if (v > 100) {
   *                return {
   *                   url: "./medium-value.svg",
   *                   width: 30,
   *                   height: 30,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             } else if(v < 5) {
   *                // Return falsy value in case of don't want to show image
   *                return null;
   *             } else {
   *                return {
   *                   url: "./low-value.svg",
   *                   width: 20,
   *                   height: 20,
   *                   pos: { x: 0, y: 0 }
   *                };
   *             }
   *          }
   *      },
   *      level: {
   *          depth: 3,
   *          max: 500,
   *          show: true,
   *          text: {
   *              format: function(x) {
   *                  return x + "%";
   *              },
   *              show: true,
   *              backgroundColor: "red"
   *          }
   *      },
   *      padAngle: 0.1,
   *      padding: 0,
   *      startingAngle: 1
   *  }
   */
  polar_label_show: !0,
  polar_label_format: void 0,
  polar_label_threshold: 0.05,
  polar_label_line: !1,
  polar_label_image: void 0,
  polar_label_ratio: void 0,
  polar_level_depth: 3,
  polar_level_max: void 0,
  polar_level_show: !0,
  polar_level_text_backgroundColor: "#fff",
  polar_level_text_format: function(t) {
    return t % 1 === 0 ? t : t.toFixed(2);
  },
  polar_level_text_show: !0,
  polar_padAngle: 0,
  polar_padding: 0,
  polar_startingAngle: 0
}, G0 = {
  /**
   * Set radar options
   * - **NOTE:**
   *  > When x tick text contains `\n`, it's used as line break.
   * @name radar
   * @memberof Options
   * @type {object}
   * @property {object} radar Radar object
   * @property {number} [radar.axis.max=undefined] The max value of axis. If not given, it'll take the max value from the given data.
   * @property {boolean} [radar.axis.line.show=true] Show or hide axis line.
   * @property {number} [radar.axis.text.position.x=0] x coordinate position, relative the original.
   * @property {number} [radar.axis.text.position.y=0] y coordinate position, relative the original.
   * @property {boolean} [radar.axis.text.show=true] Show or hide axis text.
   * @property {boolean} [radar.direction.clockwise=false] Set the direction to be drawn.
   * @property {number} [radar.level.depth=3] Set the level depth.
   * @property {boolean} [radar.level.show=true] Show or hide level.
   * @property {function} [radar.level.text.format] Set format function for the level value.<br>- Default value: `(x) => x % 1 === 0 ? x : x.toFixed(2)`
   * @property {boolean} [radar.level.text.show=true] Show or hide level text.
   * @property {number} [radar.size.ratio=0.87] Set size ratio.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Chart.RadarChart)
   * @see [Demo: radar axis](https://naver.github.io/billboard.js/demo/#RadarChartOptions.RadarAxis)
   * @see [Demo: radar level](https://naver.github.io/billboard.js/demo/#RadarChartOptions.RadarLevel)
   * @see [Demo: radar size](https://naver.github.io/billboard.js/demo/#RadarChartOptions.RadarSize)
   * @see [Demo: radar axis multiline](https://naver.github.io/billboard.js/demo/#RadarChartOptions.RadarAxisMultiline)
   * @example
   *  radar: {
   *      axis: {
   *          max: 50,
   *          line: {
   *              show: false
   *          },
   *          text: {
   *              position: {
   *              	x: 0,
   *              	y: 0
   *              },
   *              show: false
   *          }
   *      },
   *      direction: {
   *          clockwise: true
   *      },
   *      level: {
   *          show: false,
   *          text: {
   *              format: function(x) {
   *                  return x + "%";
   *              },
   *              show: true
   *          }
   *      },
   *      size: {
   *          ratio: 0.7
   *      }
   *  }
   */
  radar_axis_max: void 0,
  radar_axis_line_show: !0,
  radar_axis_text_show: !0,
  radar_axis_text_position: {},
  radar_level_depth: 3,
  radar_level_show: !0,
  radar_level_text_format: function(t) {
    return t % 1 === 0 ? t : t.toFixed(2);
  },
  radar_level_text_show: !0,
  radar_size_ratio: 0.87,
  radar_direction_clockwise: !1
}, Y0 = {
  /**
   * Set treemap options
   * @name treemap
   * @memberof Options
   * @type {object}
   * @property {object} treemap Treemap object
   * @property {string} [treemap.tile="binary"] Treemap tile type
   * - **Available tile type values:**
   * 	- binary ([d3.treemapBinary](https://github.com/d3/d3-hierarchy/blob/main/README.md#treemapBinary))
   * 	- dice ([d3.treemapDice](https://github.com/d3/d3-hierarchy/blob/main/README.md#treemapDice))
   * 	- slice ([d3.treemapSlice](https://github.com/d3/d3-hierarchy/blob/main/README.md#treemapSlice))
   * 	- sliceDice ([d3.treemapSliceDice](https://github.com/d3/d3-hierarchy/blob/main/README.md#treemapSliceDice))
   * 	- squrify ([d3.treemapSquarify](https://github.com/d3/d3-hierarchy/blob/main/README.md#treemapSquarify))
   * 	- resquarify ([d3.treemapResquarify](https://github.com/d3/d3-hierarchy/blob/main/README.md#treemapResquarify))
   * @property {function} [treemap.label.format] Set formatter for the label text.<br>
   * - **Arguments:**
   *   - `value {number}`: Data value
   *   - `ratio {number}`: The `ratio` of how much space this tile occupies relative to the total area (0~1)
   *   - `id {string}`: Data id
   *   - `size {object}`: Tile size `{width, height}` in pixels
   * @property {number} [treemap.label.threshold=0.05] Set threshold ratio to show/hide labels text.
   * @property {number} [treemap.label.show=true] Show or hide label text.
   * @see [Demo: treemap](https://naver.github.io/billboard.js/demo/#Chart.TreemapChart)
   * @example
   *  treemap: {
   *      // "binary", "dice", "slice", "sliceDice", "squrify", "resquarify"
   *      tile: "dice",
   *
   *      label: {
   *          // show or hide label text
   *          show: false,
   *
   *          // Example 1: Format with currency
   *          format: function(value, ratio, id, size) {
   *              // size: {width, height} - tile size in pixels
   *              return d3.format("$")(value);
   *          },
   *
   *          // Example 2: Show different content based on tile size
   *          format: function(value, ratio, id, size) {
   *              if (size.width > 100 && size.height > 50) {
   *                  return `${id}\n${d3.format("$")(value)}\n(${(ratio * 100).toFixed(1)}%)`;
   *              } else if (size.width > 50) {
   *                  return `${id}\n${d3.format("$")(value)}`;
   *              } else {
   *                  return d3.format("$")(value);
   *              }
   *          },
   *
   *          // Example 3: Include tile dimensions in label
   *          format: function(value, ratio, id, size) {
   *              return `${id}\n${value}\n${size.width.toFixed(0)}x${size.height.toFixed(0)}px`;
   *          },
   *
   *          // Example 4: Conditional formatting based on ratio
   *          format: function(value, ratio, id, size) {
   *              return ratio > 0.1 ?
   *                  `${id}\n${value} (${(ratio * 100).toFixed(1)}%)` :
   *                  value;
   *          },
   *
   *          // set ratio number
   *          ratio: 0.05
   *      }
   *  }
   */
  treemap_tile: "binary",
  treemap_label_format: void 0,
  treemap_label_threshold: 0.05,
  treemap_label_show: !0
};
function vn(t, e) {
  Lt(Ne.prototype, Object.values(Ll).concat(t)), Lt(un.prototype, a0), Fe.setOptions(Object.values(Dl).concat(e || []));
}
function xe(t, e) {
  vn([hn, Na, T0].concat(t || [])), Fe.setOptions([Be, z0].concat(e || []));
}
function gn(t, e) {
  Lt(Ne.prototype, [h0, hn].concat(t || [])), Fe.setOptions([Be].concat(e || []));
}
var V0 = function() {
  return xe(fn, [dn]), (V0 = function() {
    return Y.AREA;
  })();
}, U0 = function() {
  return xe(fn, [dn]), (U0 = function() {
    return Y.AREA_LINE_RANGE;
  })();
}, H0 = function() {
  return xe(fn, [dn]), (H0 = function() {
    return Y.AREA_STEP_RANGE;
  })();
}, W0 = function() {
  return xe(fn, [dn, pr]), (W0 = function() {
    return Y.AREA_SPLINE;
  })();
}, Z0 = function() {
  return xe(fn, [dn, pr]), (Z0 = function() {
    return Y.AREA_SPLINE_RANGE;
  })();
}, q0 = function() {
  return xe(fn, [dn]), (q0 = function() {
    return Y.AREA_STEP;
  })();
}, j0 = function() {
  return xe(), (j0 = function() {
    return Y.LINE;
  })();
}, K0 = function() {
  return xe(void 0, [pr]), (K0 = function() {
    return Y.SPLINE;
  })();
}, J0 = function() {
  return xe(), (J0 = function() {
    return Y.STEP;
  })();
}, Q0 = function() {
  return gn(void 0, [Ba, O0]), (Q0 = function() {
    return Y.DONUT;
  })();
}, tx = function() {
  return gn([m0], [Ba, N0]), (tx = function() {
    return Y.GAUGE;
  })();
}, ex = function() {
  return gn(void 0, [Ba, B0]), (ex = function() {
    return Y.PIE;
  })();
}, nx = function() {
  return gn([A0], [Ba, X0]), (nx = function() {
    return Y.POLAR;
  })();
}, ax = function() {
  return gn([Ll.eventrect, Na, k0], [Be, G0, { axis_x_categories: Dl.optAxis.axis_x_categories }]), (ax = function() {
    return Y.RADAR;
  })();
}, ix = function() {
  return vn([d0, hn], [L0, Be]), (ix = function() {
    return Y.BAR;
  })();
}, rx = function() {
  return vn([hn, Na, v0], [D0, Be]), (rx = function() {
    return Y.BUBBLE;
  })();
}, ox = function() {
  return vn([g0, hn], [I0, Be]), (ox = function() {
    return Y.CANDLESTICK;
  })();
}, sx = function() {
  return vn([hn, Na], [Be, P0]), (sx = function() {
    return Y.SCATTER;
  })();
}, lx = function() {
  return gn([x0], [F0]), (lx = function() {
    return Y.FUNNEL;
  })();
}, cx = function() {
  return vn([M0], [Y0]), (cx = function() {
    return Y.TREEMAP;
  })();
};
function Xo(t, e, n, a) {
  t === void 0 && (t = !1);
  var i = this, r = i.config, o = i.$el.main, s = r.data_selection_grouped, l = r.data_selection_isselectable.bind(i.api);
  r.data_selection_enabled && o.selectAll(".".concat(At.shapes)).selectAll(".".concat(At.shape)).each(function(c) {
    var u = N(this), f = c.data ? c.data : c, h = f.id, d = f.index, v = i.getToggle(this, c).bind(i), _ = s || !e || e.indexOf(h) >= 0, p = !n || n.indexOf(d) >= 0, g = u.classed(xt.SELECTED);
    u.classed(ue.line) || u.classed($a.area) || (t ? _ && p && l(c) && !g ? v(!0, u.classed(xt.SELECTED, !0), c, d) : vt(a) && a && g && v(!1, u.classed(xt.SELECTED, !1), c, d) : _ && p && l(c) && g && v(!1, u.classed(xt.SELECTED, !1), c, d));
  });
}
var ux = {
  /**
   * Get selected data points.<br><br>
   * By this API, you can get selected data points information. To use this API, data.selection.enabled needs to be set true.
   * @function selected
   * @instance
   * @memberof Chart
   * @param {string} [targetId] You can filter the result by giving target id that you want to get. If not given, all of data points will be returned.
   * @returns {Array} dataPoint Array of the data points.<br>ex.) `[{x: 1, value: 200, id: "data1", index: 1, name: "data1"}, ...]`
   * @example
   *  // all selected data points will be returned.
   *  chart.selected();
   *  // --> ex.) [{x: 1, value: 200, id: "data1", index: 1, name: "data1"}, ... ]
   *
   *  // all selected data points of data1 will be returned.
   *  chart.selected("data1");
   */
  selected: function(t) {
    var e = this.internal, n = [];
    return e.$el.main.selectAll(".".concat(At.shapes + e.getTargetSelectorSuffix(t))).selectAll(".".concat(At.shape)).filter(function() {
      return N(this).classed(xt.SELECTED);
    }).each(function(a) {
      return n.push(a);
    }), n;
  },
  /**
   * Set data points to be selected. ([`data.selection.enabled`](Options.html#.data%25E2%2580%25A4selection%25E2%2580%25A4enabled) option should be set true to use this method)
   * @function select
   * @instance
   * @memberof Chart
   * @param {string|Array} [ids] id value to get selected.
   * @param {Array} [indices] The index array of data points. If falsy value given, will select all data points.
   * @param {boolean} [resetOther] Unselect already selected.
   * @example
   *  // select all data points
   *  chart.select();
   *
   *  // select all from 'data2'
   *  chart.select("data2");
   *
   *  // select all from 'data1' and 'data2'
   *  chart.select(["data1", "data2"]);
   *
   *  // select from 'data1', indices 2 and unselect others selected
   *  chart.select("data1", [2], true);
   *
   *  // select from 'data1', indices 0, 3 and 5
   *  chart.select("data1", [0, 3, 5]);
   */
  select: function(t, e, n) {
    var a = this.internal;
    Xo.bind(a)(!0, t, e, n);
  },
  /**
   * Set data points to be un-selected.
   * @function unselect
   * @instance
   * @memberof Chart
   * @param {string|Array} [ids] id value to be unselected.
   * @param {Array} [indices] The index array of data points. If falsy value given, will select all data points.
   * @example
   *  // unselect all data points
   *  chart.unselect();
   *
   *  // unselect all from 'data1'
   *  chart.unselect("data1");
   *
   *  // unselect from 'data1', indices 2
   *  chart.unselect("data1", [2]);
   */
  unselect: function(t, e) {
    var n = this.internal;
    Xo.bind(n)(!1, t, e);
  }
}, Ol = function(t) {
  var e, n = this.internal, a = n.axis, i = n.brush, r = n.config, o = n.scale, s = o.x, l = o.subX, c = n.state, u;
  if (r.subchart_show)
    if (u = t, Array.isArray(u)) {
      a.isTimeSeries() && (u = u.map(function(h) {
        return jt.bind(n)(h);
      }));
      var f = n.withinRange(u, n.getZoomDomain("subX", !0), n.getZoomDomain("subX"));
      f && (c.domain = u, i.move(i.getSelection(), u.map(l)));
    } else
      u = (e = c.domain) !== null && e !== void 0 ? e : s.orgDomain();
  return u;
};
Lt(Ol, {
  /**
   * Show subchart
   * - **NOTE:** for ESM imports, needs to import 'subchart' exports and instantiate it by calling `subchart()`.
   * @function subchart․show
   * @instance
   * @memberof Chart
   * @example
   * // for ESM imports, needs to import 'subchart' and must be instantiated first to enable subchart's API.
   * import {subchart} from "billboard.js";
   *
   * const chart = bb.generate({
   *   ...
   *   subchart: {
   *      // need to be instantiated by calling 'subchart()'
   *      enabled: subchart()
   *
   *      // in case don't want subchart to be shown at initialization, instantiate with '!subchart()'
   *      enabled: !subchart()
   *   }
   * });
   *
   * chart.subchart.show();
   */
  show: function() {
    var t, e, n = this.internal, a = n.$el.subchart, i = n.config, r = i.subchart_show;
    if (!r) {
      n.unbindZoomEvent(), i.subchart_show = !r, !a.main && n.initSubchart();
      var o = a.main.selectAll(".".concat(j.target));
      n.data.targets.length !== o.size() && (n.updateSizes(), n.updateTargetsForSubchart(n.data.targets), o = (t = a.main) === null || t === void 0 ? void 0 : t.selectAll(".".concat(j.target))), o?.style("opacity", null), (e = a.main) === null || e === void 0 || e.style("display", null), this.resize();
    }
  },
  /**
   * Hide generated subchart
   * - **NOTE:** for ESM imports, needs to import 'subchart' exports and instantiate it by calling `subchart()`.
   * @function subchart․hide
   * @instance
   * @memberof Chart
   * @example
   *  chart.subchart.hide();
   */
  hide: function() {
    var t = this.internal, e = t.$el.subchart.main, n = t.config;
    n.subchart_show && e?.style("display") !== "none" && (n.subchart_show = !1, e.style("display", "none"), this.resize());
  },
  /**
   * Toggle the visibility of subchart
   * - **NOTE:** for ESM imports, needs to import 'subchart' exports and instantiate it by calling `subchart()`.
   * @function subchart․toggle
   * @instance
   * @memberof Chart
   * @example
   * // When subchart is hidden, will be shown
   * // When subchart is shown, will be hidden
   * chart.subchart.toggle();
   */
  toggle: function() {
    var t = this.internal, e = t.config;
    this.subchart[e.subchart_show ? "hide" : "show"]();
  },
  /**
   * Reset subchart selection
   * @function subchart․reset
   * @instance
   * @memberof Chart
   * @example
   * // Reset subchart selection
   * chart.subchart.reset();
   */
  reset: function() {
    var t = this.internal, e = t.brush;
    e.clear(e.getSelection());
  }
});
var fx = {
  subchart: Ol
}, Fl = function(t) {
  var e, n = this.internal, a = n.axis, i = n.config, r = n.org, o = n.scale, s = n.state, l = a.isCategorized(), c;
  if (i.zoom_enabled)
    if (c = t, Array.isArray(c)) {
      a.isTimeSeries() && (c = c.map(function(h) {
        return jt.bind(n)(h);
      }));
      var u = n.withinRange(c, n.getZoomDomain("zoom", !0), n.getZoomDomain("zoom"));
      if (u) {
        if (s.domain = c, c = n.getZoomDomainValue(c), n.api.tooltip.hide(), i.subchart_show) {
          var f = o.zoom || o.x;
          n.brush.getSelection().call(n.brush.move, c.map(f));
        } else {
          var f = l ? o.x.orgScale() : r.xScale || o.x;
          n.updateCurrentZoomTransform(f, c);
        }
        n.setZoomResetButton();
      }
    } else
      c = n.zoom.getDomain();
  return (e = s.domain) !== null && e !== void 0 ? e : c;
};
Lt(Fl, {
  /**
   * Enable and disable zooming.
   * @function zoom․enable
   * @instance
   * @memberof Chart
   * @param {string|boolean} enabled Possible string values are "wheel" or "drag". If enabled is true, "wheel" will be used. If false is given, zooming will be disabled.<br>When set to false, the current zooming status will be reset.
   * @example
   *  // Enable zooming using the mouse wheel
   *  chart.zoom.enable(true);
   *  // Or
   *  chart.zoom.enable("wheel");
   *
   *  // Enable zooming by dragging
   *  chart.zoom.enable("drag");
   *
   *  // Disable zooming
   *  chart.zoom.enable(false);
   */
  enable: function(t) {
    var e = this.internal, n = e.config;
    /^(drag|wheel)$/.test(t) && (n.zoom_type = t), n.zoom_enabled = !!t, e.zoom ? t === !1 && e.bindZoomEvent(!1) : (e.initZoom(), e.bindZoomEvent()), e.updateAndRedraw();
  },
  /**
   * Set or get x Axis maximum zoom range value
   * @function zoom․max
   * @instance
   * @memberof Chart
   * @param {number} [max] maximum value to set for zoom
   * @returns {number} zoom max value
   * @example
   *  // Set maximum range value
   *  chart.zoom.max(20);
   */
  max: function(t) {
    var e = this.internal, n = e.config, a = e.org.xDomain;
    return (t === 0 || t) && (n.zoom_x_max = Qt("max", [a[1], t])), n.zoom_x_max;
  },
  /**
   * Set or get x Axis minimum zoom range value
   * @function zoom․min
   * @instance
   * @memberof Chart
   * @param {number} [min] minimum value to set for zoom
   * @returns {number} zoom min value
   * @example
   *  // Set minimum range value
   *  chart.zoom.min(-1);
   */
  min: function(t) {
    var e = this.internal, n = e.config, a = e.org.xDomain;
    return (t === 0 || t) && (n.zoom_x_min = Qt("min", [a[0], t])), n.zoom_x_min;
  },
  /**
   * Set zoom range
   * @function zoom․range
   * @instance
   * @memberof Chart
   * @param {object} [range] zoom range
   * @returns {object} zoom range value
   * {
   *   min: 0,
   *   max: 100
   * }
   * @example
   *  chart.zoom.range({
   *      min: 10,
   *      max: 100
   *  });
   */
  range: function(t) {
    var e = this.zoom;
    if (ct(t)) {
      var n = t.min, a = t.max;
      vt(n) && e.min(n), vt(a) && e.max(a);
    }
    return {
      min: e.min(),
      max: e.max()
    };
  }
});
var hx = {
  zoom: Fl,
  /**
   * Unzoom zoomed area
   * - **NOTE:** Calling .unzoom() will not trigger zoom events.
   * @function unzoom
   * @instance
   * @memberof Chart
   * @example
   *  chart.unzoom();
   */
  unzoom: function() {
    var t = this.internal, e = t.config, n = t.$el, a = n.eventRect, i = n.zoomResetBtn, r = t.scale.zoom, o = t.state;
    r && (e.subchart_show ? t.brush.getSelection().call(t.brush.move, null) : t.zoom.updateTransformScale(ae), t.updateZoom(!0), i?.style("display", "none"), fr(a.node()) !== ae && t.zoom.transform(a, ae), o.domain = void 0);
  }
}, dx = {
  /**
   * Initialize the brush.
   * @private
   */
  initBrush: function() {
    var t = this, e = t.config, n = t.scale, a = t.$el.subchart, i = t.state, r = e.axis_rotated, o = e.subchart_size_height, s, l, c;
    t.brush = (r ? Jd() : Kd()).handleSize(5), t.brush.on("start brush end", function(u) {
      var f = u.selection, h = u.sourceEvent, d = u.target, v = u.type;
      v === "start" && (t.state.inputType === "touch" && t.hideTooltip(), l = h ? f : null), /(start|brush)/.test(v) && (v === "brush" && h && i.domain && l?.forEach(function(_, p) {
        _ !== f[p] && (i.domain[p] = n.x.orgDomain()[p]);
      }), t.redrawForBrush(v !== "start")), v === "end" && (s = n.x.orgDomain()), d?.handle && (f === null ? t.brush.handle.attr("display", "none") : t.brush.handle.attr("display", null).attr("transform", function(_, p) {
        var g = [f[p], o / 2];
        return "translate(".concat(r ? g.reverse() : g, ")");
      }));
    }), t.brush.updateResize = function() {
      var u = this;
      c && clearTimeout(c), c = setTimeout(function() {
        var f = u.getSelection();
        s && Ss(f.node()) && u.move(f, s.map(n.subX.orgScale()));
      }, 0);
    }, t.brush.update = function() {
      var u, f = this.extent()();
      return f[1].filter(function(h) {
        return isNaN(h);
      }).length === 0 && ((u = a.main) === null || u === void 0 || u.select(".".concat(ut.brush)).call(this)), this;
    }, t.brush.scale = function(u) {
      var f = e.subchart_size_height, h = t.axis.getExtent();
      !h && u.range ? h = [[0, 0], [u.range()[1], f]] : ft(h) && (h = h.map(function(d, v) {
        return [d, v > 0 ? f : v];
      })), r && h[1].reverse(), this.extent(h), this.update();
    }, t.brush.getSelection = function() {
      return (
        // @ts-ignore
        a.main ? a.main.select(".".concat(ut.brush)) : N([])
      );
    };
  },
  /**
   * Initialize the subchart.
   * @private
   */
  initSubchart: function() {
    var t = this, e = t.config, n = t.state, a = n.clip, i = n.hasAxis, r = t.$el, o = r.defs, s = r.svg, l = r.subchart, c = r.axis;
    if (i) {
      var u = e.subchart_show ? null : "hidden", f = "".concat(a.id, "-subchart"), h = t.getClipPath(f);
      a.idSubchart = f, t.appendClip(o, f), t.initBrush(), l.main = s.append("g").classed(ut.subchart, !0).attr("transform", t.getTranslate("context"));
      var d = l.main;
      d.style("visibility", u), d.append("g").attr("clip-path", h).attr("class", ut.chart), ["bar", "line", "bubble", "candlestick", "scatter"].forEach(function(_) {
        var p = Nt(/^(bubble|scatter)$/.test(_) ? "circle" : _);
        if (t.hasType(_) || t.hasTypeOf(p)) {
          var g = d.select(".".concat(ut.chart)), x = ut["chart".concat(p, "s")];
          g.select(".".concat(x)).empty() && g.append("g").attr("class", x);
        }
      });
      var v = d.append("g").attr("clip-path", h).attr("class", ut.brush).call(t.brush);
      e.subchart_showHandle && t.addBrushHandle(v), c.subX = d.append("g").attr("class", ut.axisX).attr("transform", t.getTranslate("subX")).attr("clip-path", e.axis_rotated ? "" : a.pathXAxis).style("visibility", e.subchart_axis_x_show ? u : "hidden");
    }
  },
  /**
   * Add brush handle
   * Enabled when: subchart.showHandle=true
   * @param {d3Selection} brush Brush selection
   * @private
   */
  addBrushHandle: function(t) {
    var e = this, n = e.config, a = n.axis_rotated, i = n.subchart_init_range, r = "handle--custom", o = a ? [
      "M8.5 0 a6 6 0 0 0 -6 -6.5 H-2.5 a 6 6 0 0 0 -6 6.5 z m-5 -2 H-3.5 m7 -2 H-3.5z",
      "M8.5 0 a6 -6 0 0 1 -6 6.5 H-2.5 a 6 -6 0 0 1 -6 -6.5z m-5 2 H-3.5 m7 2 H-3.5z"
    ] : [
      "M0 -8.5 A6 6 0 0 0 -6.5 -3.5 V2.5 A6 6 0 0 0 0 8.5 Z M-2 -3.5 V3.5 M-4 -3.5 V3.5z",
      "M0 -8.5 A6 6 0 0 1 6.5 -3.5 V2.5 A6 6 0 0 1 0 8.5 Z M2 -3.5 V3.5 M4 -3.5 V3.5z"
    ];
    e.brush.handle = t.selectAll(".".concat(r)).data(a ? [{ type: "n" }, { type: "s" }] : [{ type: "w" }, { type: "e" }]).enter().append("path").attr("class", r).attr("cursor", "".concat(a ? "ns" : "ew", "-resize")).attr("d", function(s) {
      return o[+/[se]/.test(s.type)];
    }).attr("display", i ? null : "none");
  },
  /**
   * Update sub chart
   * @param {object} targets $$.data.targets
   * @private
   */
  updateTargetsForSubchart: function(t) {
    var e = this, n = e.config, a = e.state, i = e.$el.subchart.main;
    n.subchart_show && (["bar", "line", "bubble", "candlestick", "scatter"].filter(function(r) {
      return e.hasType(r) || e.hasTypeOf(Nt(r));
    }).forEach(function(r) {
      var o = /^(bubble|scatter)$/.test(r), s = Nt(o ? "circle" : r), l = e.getChartClass(s, !0), c = e.getClass(o ? "circles" : "".concat(r, "s"), !0), u = i.select(".".concat(ut["chart".concat("".concat(s, "s"))]));
      if (o) {
        var f = u.selectAll(".".concat(ut.circles)).data(t.filter(e["is".concat(Nt(r), "Type")].bind(e))).attr("class", c);
        f.exit().remove(), f.enter().append("g").attr("class", c);
      } else {
        var h = u.selectAll(".".concat(ut["chart".concat(s)])).attr("class", l).data(t.filter(e["is".concat(s, "Type")].bind(e))), d = h.enter().append("g").style("opacity", "0").attr("class", l).append("g").attr("class", c);
        h.exit().remove(), r === "line" && e.hasTypeOf("Area") && d.append("g").attr("class", e.getClass("areas", !0));
      }
    }), i.selectAll(".".concat(ut.brush, " rect")).attr(n.axis_rotated ? "width" : "height", n.axis_rotated ? a.width2 : a.height2));
  },
  /**
   * Redraw subchart.
   * @private
   * @param {boolean} withSubchart whether or not to show subchart
   * @param {number} duration duration
   * @param {object} shape Shape's info
   */
  redrawSubchart: function(t, e, n) {
    var a, i = this, r = i.config, o = i.$el.subchart.main, s = i.state, l = !!e;
    if (o.style("visibility", r.subchart_show ? null : "hidden"), r.subchart_show && (((a = s.event) === null || a === void 0 ? void 0 : a.type) === "zoom" && i.brush.update(), t)) {
      var c = r.subchart_init_range;
      if (!dl(i) && i.brush.update(), Object.keys(n.type).forEach(function(h) {
        var d = Nt(h), v = i["generateDraw".concat(d)](n.indices[h], !0);
        i["update".concat(d)](l, !0), i["redraw".concat(d)](v, l, !0);
      }), i.hasType("bubble") || i.hasType("scatter")) {
        var u = n.pos.cx, f = i.updateCircleY(!0);
        i.updateCircle(!0), i.redrawCircle(u, f, l, void 0, !0);
      }
      !s.rendered && c && (s.domain = c, i.brush.move(i.brush.getSelection(), c.map(i.scale.x)));
    }
  },
  /**
   * Redraw the brush.
   * @param {boolean} [callCallbck=true] Call 'onbrush' callback or not.
   * @private
   */
  redrawForBrush: function(t) {
    var e;
    t === void 0 && (t = !0);
    var n = this, a = n.config, i = a.subchart_onbrush, r = a.zoom_rescale, o = n.scale, s = n.state;
    n.redraw({
      withTransition: !1,
      withY: r,
      withSubchart: !1,
      withUpdateXDomain: !0,
      withDimension: !1
    }), t && s.rendered && i.bind(n.api)((e = s.domain) !== null && e !== void 0 ? e : o.x.orgDomain());
  },
  /**
   * Transform context
   * @param {boolean} withTransition indicates transition is enabled
   * @param {object} transitions The return value of the generateTransitions method of Axis.
   * @private
   */
  transformContext: function(t, e) {
    var n = this, a = n.$el.subchart, i = n.$T, r = e?.axisSubX ? e.axisSubX : i(a.main.select(".".concat(ut.axisX)), t);
    a.main.attr("transform", n.getTranslate("context")), r.attr("transform", n.getTranslate("subX"));
  }
}, vx = {
  /**
   * Initialize zoom.
   * @private
   */
  initZoom: function() {
    var t = this;
    t.scale.zoom = null, t.generateZoom(), t.config.zoom_type === "drag" && t.initZoomBehaviour();
  },
  /**
   * Bind zoom event
   * @param {boolean} bind Weather bind or unbound
   * @private
   */
  bindZoomEvent: function(t) {
    t === void 0 && (t = !0);
    var e = this, n = e.config, a = n.zoom_enabled;
    a && t ? !n.subchart_show && e.bindZoomOnEventRect() : t === !1 && (e.api.unzoom(), e.unbindZoomEvent());
  },
  /**
   * Generate zoom
   * @private
   */
  generateZoom: function() {
    var t = this, e = t.config, n = t.org, a = t.scale, i = Bg().duration(0).on("start", t.onZoomStart.bind(t)).on("zoom", t.onZoom.bind(t)).on("end", t.onZoomEnd.bind(t));
    i.orgScaleExtent = function() {
      var r = e.zoom_extent || [1, 10];
      return [r[0], Math.max(t.getMaxDataCount() / r[1], r[1])];
    }, i.updateScaleExtent = function() {
      var r = Me(t.scale.x.orgDomain()) / Me(t.getZoomDomain()), o = this.orgScaleExtent();
      return this.scaleExtent([o[0] * r, o[1] * r]), this;
    }, i.updateTransformScale = function(r, o) {
      var s, l = e.axis_rotated;
      (s = n.xScale) === null || s === void 0 || s.range(a.x.range());
      var c = r[l ? "rescaleY" : "rescaleX"](n.xScale || a.x);
      if (!c.domain().some(function(_) {
        return /(Invalid Date|NaN)/.test(_.toString());
      })) {
        var u = t.trimXDomain(c.domain()), f = e.zoom_rescale;
        if (c.domain(u, n.xDomain), o) {
          var h = c(a.x.domain()[0]), d = l ? r.x : h, v = l ? h : r.y;
          t.$el.eventRect.property("__zoom", ae.translate(d, v).scale(r.k));
        }
        a.zoom = t.getCustomizedXScale(c), t.axis.x.scale(a.zoom), f ? (!n.xScale && (n.xScale = a.x.copy()), a.x.domain(u)) : n.xScale && (a.x.domain(n.xScale.domain()), n.xScale = null);
      }
    }, i.getDomain = function() {
      var r = a[a.zoom ? "zoom" : "subX"].domain(), o = t.axis.isCategorized();
      return o && (r[1] -= 2), r;
    }, t.zoom = i;
  },
  /**
   * 'start' event listener
   * @param {object} event Event object
   * @private
   */
  onZoomStart: function(t) {
    var e = this, n = t.sourceEvent;
    n && (e.zoom.startEvent = n, e.state.zooming = !0, pt(e.config.zoom_onzoomstart, e.api, t));
  },
  /**
   * 'zoom' event listener
   * @param {object} event Event object
   * @private
   */
  onZoom: function(t) {
    var e = this, n = e.config, a = e.scale, i = e.state, r = e.org, o = t.sourceEvent, s = t?.transform === ae;
    if (!(!n.zoom_enabled || e.filterTargetsToShow(e.data.targets).length === 0 || !a.zoom && o?.type.indexOf("touch") > -1 && o?.touches.length === 1)) {
      t.sourceEvent && (i.zooming = !0, i.domain = void 0);
      var l = o?.type === "mousemove", c = o?.wheelDelta < 0, u = t.transform;
      !l && c && a.x.domain().every(function(v, _) {
        return v !== r.xDomain[_];
      }) && a.x.domain(r.xDomain), e.zoom.updateTransformScale(u, n.zoom_type === "wheel" && o);
      var f = n.transition_duration > 0 && !n.subchart_show && (i.dragging || s || !t.sourceEvent), h = o && l && n.zoom_type !== "wheel", d = function() {
        var v;
        e.redraw({
          withTransition: f,
          withY: n.zoom_rescale,
          withSubchart: !1,
          withEventRect: !1,
          withDimension: !1
        }), e.state.cancelClick = l, !s && pt(n.zoom_onzoom, e.api, (v = e.state.domain) !== null && v !== void 0 ? v : e.zoom.getDomain());
      };
      h ? pl(e.state, d) : d();
    }
  },
  /**
   * 'end' event listener
   * @param {object} event Event object
   * @private
   */
  onZoomEnd: function(t) {
    var e, n, a = this, i = a.config, r = a.state, o = a.zoom.startEvent, s = t?.sourceEvent, l = t?.transform === ae;
    o?.type.indexOf("touch") > -1 && (o = o.changedTouches[0], s = (e = s?.changedTouches) === null || e === void 0 ? void 0 : e[0]), !(i.zoom_type === "drag" && s && o.clientX === s.clientX && o.clientY === s.clientY) && (r.zooming = !1, a.redrawEventRect(), a.updateZoom(), !l && (s || r.dragging) && pt(i.zoom_onzoomend, a.api, (n = a.state.domain) !== null && n !== void 0 ? n : a.zoom.getDomain()));
  },
  /**
   * Update zoom
   * @param {boolean} force Force unzoom
   * @private
   */
  updateZoom: function(t) {
    var e = this, n = e.scale, a = n.subX, i = n.x, r = n.zoom;
    if (r) {
      var o = r.domain(), s = a.domain(), l = 0.015, c = e.config.axis_x_inverted ? (o[0] >= s[0] || o[0] + l >= s[0]) && (s[1] >= o[1] || s[1] >= o[1] + l) : (o[0] <= s[0] || o[0] - l <= s[0]) && (s[1] <= o[1] || s[1] <= o[1] - l);
      (t || c) && (e.axis.x.scale(a), i.domain(a.orgDomain()), e.scale.zoom = null);
    }
  },
  /**
   * Set zoom transform to event rect
   * @param {function} x x Axis scale function
   * @param {Array} domain Domain value to be set
   * @private
   */
  updateCurrentZoomTransform: function(t, e) {
    var n, a = this, i = a.$el.eventRect, r = a.config, o = r.axis_rotated, s = [-t(e[0]), 0], l = (n = ae.scale(t.range()[1] / (t(e[1]) - t(e[0])))).translate.apply(n, o ? s.reverse() : s);
    i.call(a.zoom.transform, l);
  },
  /**
   * Attach zoom event on <rect>
   * @private
   */
  bindZoomOnEventRect: function() {
    var t, e = this, n = e.config, a = e.$el, i = a.eventRect, r = a.svg, o = n.zoom_type === "drag" ? e.zoomBehaviour : e.zoom;
    tt.GestureEvent && /^((?!chrome|android|mobile).)*safari/i.test((t = tt.navigator) === null || t === void 0 ? void 0 : t.userAgent) && r.on("wheel", function() {
    }), i?.call(o).on("dblclick.zoom", null);
  },
  /**
   * Initialize the drag behaviour used for zooming.
   * @private
   */
  initZoomBehaviour: function() {
    var t = this, e = t.config, n = t.state, a = e.axis_rotated, i = 0, r = 0, o, s, l = {
      axis: a ? "y" : "x",
      attr: a ? "height" : "width",
      index: a ? 1 : 0
    };
    t.zoomBehaviour = fs().clickDistance(4).on("start", function(c) {
      s = t.scale.zoom ? null : t.axis.getExtent(), n.event = c, t.setDragStatus(!0), t.unselectRect(), o || (o = t.$el.main.append("rect").attr("clip-path", n.clip.path).attr("class", Ri.zoomBrush).attr("width", a ? n.width : 0).attr("height", a ? 0 : n.height)), i = Zt(c, this)[l.index], s && (i < s[0] ? i = s[0] : i > s[1] && (i = s[1])), r = i, o.attr(l.axis, i).attr(l.attr, 0), t.onZoomStart(c);
    }).on("drag", function(c) {
      r = Zt(c, this)[l.index], s && (r > s[1] ? r = s[1] : r < s[0] && (r = s[0])), o.attr(l.axis, Math.min(i, r)).attr(l.attr, Math.abs(r - i));
    }).on("end", function(c) {
      var u, f = t.scale.zoom || t.scale.x;
      n.event = c, o.attr(l.axis, 0).attr(l.attr, 0), i > r && (u = [r, i], i = u[0], r = u[1]), i < 0 && (r += Math.abs(i), i = 0), i !== r && t.api.zoom([i, r].map(function(h) {
        return f.invert(h);
      })), t.setDragStatus(!1);
    });
  },
  setZoomResetButton: function() {
    var t = this, e = t.config, n = t.$el, a = e.zoom_resetButton;
    a && e.zoom_type === "drag" && (n.zoomResetBtn ? n.zoomResetBtn.style("display", null) : n.zoomResetBtn = t.$el.chart.append("div").classed(j.button, !0).append("span").on("click", function() {
      U(a.onclick) && a.onclick.bind(t.api)(this), t.api.unzoom();
    }).classed(Ri.buttonZoomReset, !0).text(a.text || "Reset Zoom"));
  },
  getZoomTransform: function() {
    var t = this, e = t.$el.eventRect;
    return e?.node() ? fr(e.node()) : { k: 1 };
  }
}, gx = {
  /**
   * Called when dragging.
   * Data points can be selected.
   * @private
   * @param {object} mouse Object
   */
  drag: function(t) {
    var e = this, n = e.config, a = e.state, i = e.$el.main, r = n.data_selection_grouped, o = n.interaction_enabled && n.data_selection_isselectable;
    if (!(e.hasArcType() || !n.data_selection_enabled || // do nothing if not selectable
    n.zoom_enabled && !e.zoom.altDomain || // skip if zoomable because of conflict drag behavior
    !n.data_selection_multiple)) {
      var s = a.dragStart || [0, 0], l = s[0], c = s[1], u = t[0], f = t[1], h = Math.min(l, u), d = Math.max(l, u), v = r ? a.margin.top : Math.min(c, f), _ = r ? a.height : Math.max(c, f), p = function() {
        !e || !e.$el || !e.$el.main || (i.select(".".concat(ke.dragarea)).attr("x", h).attr("y", v).attr("width", d - h).attr("height", _ - v), i.selectAll(".".concat(At.shapes)).selectAll(".".concat(At.shape)).filter(function(g) {
          return o?.bind(e.api)(g);
        }).each(function(g, x) {
          var y = N(this), m = y.classed(xt.SELECTED), T = y.classed(ke.INCLUDED), b = !1, w;
          if (y.classed(Ft.circle)) {
            var A = +y.attr("cx") * 1, k = +y.attr("cy") * 1;
            w = e.togglePoint, b = h < A && A < d && v < k && k < _;
          } else if (y.classed(Yt.bar)) {
            var C = fl(this), A = C.x, k = C.y, E = C.width, M = C.height;
            w = e.togglePath, b = !(d < A || A + E < h) && !(_ < k || k + M < v);
          } else
            return;
          b ^ T && (y.classed(ke.INCLUDED, !T), y.classed(xt.SELECTED, !m), w.call(e, !m, y, g, x));
        }));
      };
      pl(e.state, p);
    }
  },
  /**
   * Called when the drag starts.
   * Adds and Shows the drag area.
   * @private
   * @param {object} mouse Object
   */
  dragstart: function(t) {
    var e = this, n = e.config, a = e.state, i = e.$el.main;
    e.hasArcType() || !n.data_selection_enabled || (a.dragStart = t, i.select(".".concat(j.chart)).append("rect").attr("class", ke.dragarea).style("opacity", "0.1"), e.setDragStatus(!0));
  },
  /**
   * Called when the drag finishes.
   * Removes the drag area.
   * @private
   */
  dragend: function() {
    var t = this, e = t.config, n = t.$el.main, a = t.$T;
    t.hasArcType() || !e.data_selection_enabled || (a(n.select(".".concat(ke.dragarea))).style("opacity", "0").remove(), n.selectAll(".".concat(At.shape)).classed(ke.INCLUDED, !1), t.setDragStatus(!1));
  }
}, px = K(K({}, gx), {
  /**
   * Select a point
   * @param {object} target Target point
   * @param {object} d Data object
   * @param {number} i Index number
   * @private
   */
  selectPoint: function(t, e, n) {
    var a = this, i = a.config, r = a.$el.main, o = a.$T, s = i.axis_rotated, l = (s ? a.circleY : a.circleX).bind(a), c = (s ? a.circleX : a.circleY).bind(a), u = a.pointSelectR.bind(a);
    pt(i.data_onselected, a.api, e, t.node()), o(r.select(".".concat(xt.selectedCircles).concat(a.getTargetSelectorSuffix(e.id))).selectAll(".".concat(xt.selectedCircle, "-").concat(n)).data([e]).enter().append("circle").attr("class", function() {
      return a.generateClass(xt.selectedCircle, n);
    }).attr("cx", l).attr("cy", c).attr("stroke", a.color).attr("r", function(f) {
      return a.pointSelectR(f) * 1.4;
    })).attr("r", u);
  },
  /**
   * Unelect a point
   * @param {object} target Target point
   * @param {object} d Data object
   * @param {number} i Index number
   * @private
   */
  unselectPoint: function(t, e, n) {
    var a = this, i = a.config, r = a.$el.main, o = a.$T;
    pt(i.data_onunselected, a.api, e, t?.node()), o(r.select(".".concat(xt.selectedCircles).concat(a.getTargetSelectorSuffix(e.id))).selectAll(".".concat(xt.selectedCircle, "-").concat(n))).attr("r", 0).remove();
  },
  /**
   * Toggles the selection of points
   * @param {boolean} selected whether or not to select.
   * @param {object} target Target object
   * @param {object} d Data object
   * @param {number} i Index number
   * @private
   */
  togglePoint: function(t, e, n, a) {
    var i = "".concat(t ? "" : "un", "selectPoint");
    this[i](e, n, a);
  },
  /**
   * Select a path
   * @param {object} target Target path
   * @param {object} d Data object
   * @private
   */
  selectPath: function(t, e) {
    var n = this, a = n.config;
    pt(a.data_onselected, n.api, e, t.node()), a.interaction_brighten && t.style("filter", "brightness(1.25)");
  },
  /**
   * Unelect a path
   * @private
   * @param {object} target Target path
   * @param {object} d Data object
   */
  unselectPath: function(t, e) {
    var n = this, a = n.config;
    pt(a.data_onunselected, n.api, e, t.node()), a.interaction_brighten && t.style("filter", null);
  },
  /**
   * Toggles the selection of lines
   * @param {boolean} selected whether or not to select.
   * @param {object} target Target object
   * @param {object} d Data object
   * @param {number} i Index number
   * @private
   */
  togglePath: function(t, e, n, a) {
    this["".concat(t ? "" : "un", "selectPath")](e, n, a);
  },
  /**
   * Returns the toggle method of the target
   * @param {object} that shape
   * @param {object} d Data object
   * @returns {function} toggle method
   * @private
   */
  getToggle: function(t, e) {
    var n = this;
    return t.nodeName === "path" ? n.togglePath : n.isStepType(e) ? function() {
    } : (
      // circle is hidden in step chart, so treat as within the click area
      n.togglePoint
    );
  },
  /**
   * Toggles the selection of shapes
   * @param {object} that shape
   * @param {object} d Data object
   * @param {number} i Index number
   * @private
   */
  toggleShape: function(t, e, n) {
    var a, i = this, r = i.config, o = i.$el.main;
    if (r.data_selection_enabled && r.data_selection_isselectable.bind(i.api)(e)) {
      var s = N(t), l = s.classed(xt.SELECTED), c = i.getToggle(t, e).bind(i), u;
      if (!r.data_selection_multiple) {
        var f = (a = i.isPointFocusOnly) === null || a === void 0 ? void 0 : a.call(i), h = ".".concat(f ? xt.selectedCircles : At.shapes);
        r.data_selection_grouped && (h += i.getTargetSelectorSuffix(e.id)), o.selectAll(h).selectAll(f ? ".".concat(xt.selectedCircle) : ".".concat(At.shape, ".").concat(xt.SELECTED)).classed(xt.SELECTED, !1).each(function(d) {
          var v = N(this);
          u = v, c(!1, v, d, d.index);
        });
      }
      (!u || u.node() !== s.node()) && (s.classed(xt.SELECTED, !l), c(!l, s, e, n));
    }
  }
}), _x = {
  /**
   * Set data selection enabled<br><br>
   * If this option is set true, we can select the data points and get/set its state of selection by API (e.g. select, unselect, selected).
   *  - **NOTE:** for ESM imports, needs to import 'selection' exports and instantiate it by calling `selection()`.
   *    - `enabled: selection()`
   * @name data․selection․enabled
   * @memberof Options
   * @type {boolean}
   * @default false
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Data.DataSelection)
   * @example
   * data: {
   *    selection: {
   *       enabled: true
   *    }
   * }
   * @example
   * // importing ESM
   * import bb, {selection} from "billboard.js";
   *
   * data: {
   *    selection: {
   *       enabled: selection(),
   *       ...
   *    }
   * }
   */
  data_selection_enabled: !1,
  /**
   * Set grouped selection enabled.<br><br>
   * If this option set true, multiple data points that have same x value will be selected by one selection.
   * @name data․selection․grouped
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * data: {
   *    selection: {
   *       grouped: true
   *    }
   * }
   */
  data_selection_grouped: !1,
  /**
   * Set a callback for each data point to determine if it's selectable or not.<br><br>
   * The callback will receive d as an argument and it has some parameters like id, value, index. This callback should return boolean.
   * @name data․selection․isselectable
   * @memberof Options
   * @type {function}
   * @default function() { return true; }
   * @example
   * data: {
   *    selection: {
   *       isselectable: function(d) { ... }
   *    }
   * }
   */
  data_selection_isselectable: function() {
    return !0;
  },
  /**
   * Set multiple data points selection enabled.<br><br>
   * If this option set true, multiple data points can have the selected state at the same time. If false set, only one data point can have the selected state and the others will be unselected when the new data point is selected.
   * @name data․selection․multiple
   * @memberof Options
   * @type {boolean}
   * @default true
   * @example
   * data: {
   *    selection: {
   *       multiple: false
   *    }
   * }
   */
  data_selection_multiple: !0,
  /**
   * Enable to select data points by dragging.
   * If this option set true, data points can be selected by dragging.
   * - **NOTE:** If this option set true, scrolling on the chart will be disabled because dragging event will handle the event.
   * @name data․selection․draggable
   * @memberof Options
   * @type {boolean}
   * @default false
   * @example
   * data: {
   *    selection: {
   *       draggable: true
   *   }
   * }
   */
  data_selection_draggable: !1,
  /**
   * Set a callback for on data selection.
   * @name data․onselected
   * @memberof Options
   * @type {function}
   * @default function() {}
   * @example
   * data: {
   *     onselected: function(d, element) {
   *        // d - ex) {x: 4, value: 150, id: "data1", index: 4, name: "data1"}
   *        // element - <circle>
   *        ...
   *    }
   * }
   */
  data_onselected: function() {
  },
  /**
   * Set a callback for on data un-selection.
   * @name data․onunselected
   * @memberof Options
   * @type {function}
   * @default function() {}
   * @example
   * data: {
   *     onunselected: function(d, element) {
   *        // d - ex) {x: 4, value: 150, id: "data1", index: 4, name: "data1"}
   *        // element - <circle>
   *        ...
   *    }
   * }
   */
  data_onunselected: function() {
  }
}, xx = {
  /**
   * Set subchart options.
   * - **NOTE:** Not supported for `bubble`, `scatter` and non-Axis based(pie, donut, gauge, radar) types.
   * @name subchart
   * @memberof Options
   * @type {object}
   * @property {object} subchart Subchart object
   * @property {boolean} [subchart.show=false] Show sub chart on the bottom of the chart.
   *  - **NOTE:** for ESM imports, needs to import 'subchart' exports and instantiate it by calling `subchart()`.
   *    - `show: subchart()`
   * @property {boolean} [subchart.showHandle=false] Show sub chart's handle.
   * @property {boolean} [subchart.axis.x.show=true] Show or hide x axis.
   * @property {boolean} [subchart.axis.x.tick.show=true] Show or hide x axis tick line.
   * @property {function|string} [subchart.axis.x.tick.format] Use custom format for x axis ticks - see [axis.x.tick.format](#.axis․x․tick․format) for details.
   * @property {boolean} [subchart.axis.x.tick.text.show=true] Show or hide x axis tick text.
   * @property {Array} [subchart.init.range] Set initial selection domain range.
   * @property {number} [subchart.size.height] Change the height of the subchart.
   * @property {function} [subchart.onbrush] Set callback for brush event.<br>
   *  Specified function receives the current zoomed x domain.
   * @see [Demo](https://naver.github.io/billboard.js/demo/#Interaction.SubChart)
   * @example
   *  subchart: {
   *      show: true,
   *      showHandle: true,
   *      size: {
   *          height: 20
   *      },
   *      init: {
   *          // specify initial range domain selection
   *          range: [1, 2]
   *      },
   *      axis: {
   *      	x: {
   *      	  show: true,
   *      	    tick: {
   *      	      show: true,
   *      	      format: (x) => d3Format(".1f")(x)
   *      	      text: {
   *      	        show: false
   *      	      }
   *      	    }
   *      	}
   *      },
   *      onbrush: function(domain) { ... }
   *  }
   * @example
   * // importing ESM
   * import bb, {subchart} from "billboard.js";
   *
   * subchart: {
   *      show: subchart(),
   *      ...
   * }
   */
  subchart_show: !1,
  subchart_showHandle: !1,
  subchart_size_height: 60,
  subchart_axis_x_show: !0,
  subchart_axis_x_tick_show: !0,
  subchart_axis_x_tick_format: void 0,
  subchart_axis_x_tick_text_show: !0,
  subchart_init_range: void 0,
  subchart_onbrush: function() {
  }
}, mx = {
  /**
   * Set zoom options
   * @name zoom
   * @memberof Options
   * @type {object}
   * @property {object} zoom Zoom object
   * @property {boolean} [zoom.enabled=false] Enable zooming.
   *  - **NOTE:** for ESM imports, needs to import 'zoom' exports and instantiate it by calling `zoom()`.
   *    - `enabled: zoom()`
   * @property {string} [zoom.type='wheel'] Set zoom interaction type.
   *  - **Available types:**
   *    - wheel
   *    - drag
   * @property {boolean} [zoom.rescale=false] Enable to rescale after zooming.<br>
   *  If true set, y domain will be updated according to the zoomed region.
   * @property {Array} [zoom.extent=[1, 10]] Change zoom extent.
   * @property {number|Date} [zoom.x.min] Set x Axis minimum zoom range
   * @property {number|Date} [zoom.x.max] Set x Axis maximum zoom range
   * @property {function} [zoom.onzoomstart=undefined] Set callback that is called when zooming starts.<br>
   *  Specified function receives the zoom event.
   * @property {function} [zoom.onzoom=undefined] Set callback that is called when the chart is zooming.<br>
   *  Specified function receives the zoomed domain.
   * @property {function} [zoom.onzoomend=undefined] Set callback that is called when zooming ends.<br>
   *  Specified function receives the zoomed domain.
   * @property {boolean|object} [zoom.resetButton=true] Set to display zoom reset button for 'drag' type zoom
   * @property {function} [zoom.resetButton.onclick] Set callback when clicks the reset button. The callback will receive reset button element reference as argument.
   * @property {string} [zoom.resetButton.text='Reset Zoom'] Text value for zoom reset button.
   * @see [Demo:zoom](https://naver.github.io/billboard.js/demo/#Interaction.Zoom)
   * @see [Demo:drag zoom](https://naver.github.io/billboard.js/demo/#Interaction.DragZoom)
   * @example
   *  zoom: {
   *      enabled: true,
   *      type: "drag",
   *      rescale: true,
   *      extent: [1, 100]  // enable more zooming
   *      x: {
   *          min: -1,  // set min range
   *          max: 10  // set max range
   *      },
   *      onzoomstart: function(event) { ... },
   *      onzoom: function(domain) { ... },
   *      onzoomend: function(domain) { ... },
   *
   *      // show reset button when is zoomed-in
   *      resetButton: true,
   *
   *      resetButton: {
   *          // onclick callback when reset button is clicked
   *          onclick: function(button) {
   *            button; // Reset button element reference
   *            ...
   *          },
   *
   *          // customized text value for reset zoom button
   *          text: "Unzoom"
   *      }
   *  }
   * @example
   * // importing ESM
   * import bb, {zoom} from "billboard.js";
   *
   * zoom: {
   *      enabled: zoom(),
   *      ...
   * }
   */
  zoom_enabled: !1,
  zoom_type: "wheel",
  zoom_extent: void 0,
  zoom_privileged: !1,
  zoom_rescale: !1,
  zoom_onzoom: void 0,
  zoom_onzoomstart: void 0,
  zoom_onzoomend: void 0,
  zoom_resetButton: !0,
  zoom_x_min: void 0,
  zoom_x_max: void 0
}, yx = function() {
  return Lt(Ne.prototype, px), Lt(un.prototype, ux), Fe.setOptions([_x]), (yx = function() {
    return !0;
  })();
}, bx = function() {
  return Lt(Ne.prototype, dx), Lt(un.prototype, fx), Fe.setOptions([xx]), (bx = function() {
    return !0;
  })();
}, Tx = function() {
  return Lt(Ne.prototype, vx), Lt(un.prototype, hx), Fe.setOptions([mx]), (Tx = function() {
    return !0;
  })();
}, hi = /* @__PURE__ */ Object.create(null), wx = {
  /**
   * Version information
   * @property {string} version version
   * @example
   *    bb.version;  // "1.0.0"
   * @memberof bb
   */
  version: "3.18.0",
  /**
   * Generate chart
   * - **NOTE:** Bear in mind for the possibility of ***throwing an error***, during the generation when:
   *   - Unused option value is given.
   *     - ex) For `data.type="pie"` option, setting 'axis' option can cause unexpected generation error.
   *   - Insufficient value is given for certain option used.
   *     - ex) `data: { x: "x", columns: [["x"], ["data1", 30, 200, 100]] }`
   * @param {Options} config chart options
   * @memberof bb
   * @returns {Chart}
   * @see {@link Options} for different generation options
   * @see {@link Chart} for different methods API
   * @example
   *  <!-- chart holder -->
   * <div id="LineChart"></div>
   * @example
   *  // Generate chart with options
   *  var chart = bb.generate({
   *      "bindto": "#LineChart"
   *      "data": {
   *          "columns": [
   *              ["data1", 30, 200, 100, 400, 150, 250],
   *              ["data2", 50, 20, 10, 40, 15, 25]
   *           ],
   *          "type": "line"
   *      }
   *  });
   *
   *  // call some API
   *  // ex) get the data of 'data1'
   *  chart.data("data1");
   * @example
   * // Generate chart by importing ESM
   * // Import types to be used only, where this will make smaller bundle size.
   * import bb, {
   *   area,
   *   areaLineRange,
   *   areaSpline,
   *   areaSplineRange,
   *   areaStep,
   *   bar,
   *   bubble,
   *   donut,
   *   gauge,
   *   line,
   *   pie,
   *   polar,
   *   radar,
   *   scatter,
   *   spline,
   *   step
   * }
   *
   * bb.generate({
   *      "bindto": "#LineChart"
   *      "data": {
   *          "columns": [
   *              ["data1", 30, 200, 100, 400, 150, 250],
   *              ["data2", 50, 20, 10, 40, 15, 25]
   *           ]
   *      },
   *      type: line(),
   *
   *      // or
   *      types: {
   *        data1: bar(),
   *        data2: step()
   *      }
   * });
   */
  generate: function(t) {
    var e = rn(/* @__PURE__ */ Object.create(null), hi, t), n = new un(e);
    return n.internal.charts = this.instance, this.instance.push(n), n;
  },
  /**
   * Set or get global default options.
   * - **NOTE:**
   *   - The options values settings are valid within page context only.
   *   - If is called multiple times, will override the last value.
   * @param {Options} options chart options
   * @memberof bb
   * @returns {Options}
   * @see {@link Options}
   * @example
   * // Set same option value as for `.generate()`
   * bb.defaults({
   *   data: {
   *     type: "bar"
   *   }
   * });
   *
   * bb.defaults();  // {data:{type: "bar"}}
   *
   * // data.type defaults to 'bar'
   * var chart = bb.generate({ ... });
   */
  defaults: function(t) {
    return ct(t) && (hi = t), hi;
  },
  /**
   * An array containing instance created
   * @property {Array} instance instance array
   * @example
   *  // generate charts
   *  var chart1 = bb.generate(...);
   *  var chart2 = bb.generate(...);
   *
   *  bb.instance;  // [ chart1, chart2, ... ]
   * @memberof bb
   */
  instance: [],
  /**
   * Namespace for plugins
   * @property {object} plugin plugin namespace
   * @example
   *  // Stanford diagram plugin
   *  bb.plugin.stanford;
   * @memberof bb
   */
  plugin: {}
};
export {
  V0 as area,
  U0 as areaLineRange,
  W0 as areaSpline,
  Z0 as areaSplineRange,
  q0 as areaStep,
  H0 as areaStepRange,
  ix as bar,
  wx as bb,
  rx as bubble,
  ox as candlestick,
  wx as default,
  Q0 as donut,
  lx as funnel,
  tx as gauge,
  j0 as line,
  ex as pie,
  nx as polar,
  ax as radar,
  sx as scatter,
  yx as selection,
  K0 as spline,
  J0 as step,
  bx as subchart,
  cx as treemap,
  Tx as zoom
};
