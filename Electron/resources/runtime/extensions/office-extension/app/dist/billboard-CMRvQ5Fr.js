import { a as e, i as t, n, o as r, r as i, s as a } from "./src-BLBF3wlC.js";
var o = {
	svg: "http://www.w3.org/2000/svg",
	xhtml: "http://www.w3.org/1999/xhtml",
	xlink: "http://www.w3.org/1999/xlink",
	xml: "http://www.w3.org/XML/1998/namespace",
	xmlns: "http://www.w3.org/2000/xmlns/"
};
// ../../node_modules/d3-selection/src/namespace.js
function s(e) {
	var t = e += "", n = t.indexOf(":");
	return n >= 0 && (t = e.slice(0, n)) !== "xmlns" && (e = e.slice(n + 1)), o.hasOwnProperty(t) ? {
		space: o[t],
		local: e
	} : e;
}
// ../../node_modules/d3-selection/src/creator.js
function c(e) {
	return function() {
		var t = this.ownerDocument, n = this.namespaceURI;
		return n === "http://www.w3.org/1999/xhtml" && t.documentElement.namespaceURI === "http://www.w3.org/1999/xhtml" ? t.createElement(e) : t.createElementNS(n, e);
	};
}
function l(e) {
	return function() {
		return this.ownerDocument.createElementNS(e.space, e.local);
	};
}
function u(e) {
	var t = s(e);
	return (t.local ? l : c)(t);
}
// ../../node_modules/d3-selection/src/selector.js
function d() {}
function f(e) {
	return e == null ? d : function() {
		return this.querySelector(e);
	};
}
// ../../node_modules/d3-selection/src/selection/select.js
function p(e) {
	typeof e != "function" && (e = f(e));
	for (var t = this._groups, n = t.length, r = Array(n), i = 0; i < n; ++i) for (var a = t[i], o = a.length, s = r[i] = Array(o), c, l, u = 0; u < o; ++u) (c = a[u]) && (l = e.call(c, c.__data__, u, a)) && ("__data__" in c && (l.__data__ = c.__data__), s[u] = l);
	return new Ct(r, this._parents);
}
// ../../node_modules/d3-selection/src/array.js
function m(e) {
	return e == null ? [] : Array.isArray(e) ? e : Array.from(e);
}
// ../../node_modules/d3-selection/src/selectorAll.js
function h() {
	return [];
}
function g(e) {
	return e == null ? h : function() {
		return this.querySelectorAll(e);
	};
}
// ../../node_modules/d3-selection/src/selection/selectAll.js
function _(e) {
	return function() {
		return m(e.apply(this, arguments));
	};
}
function v(e) {
	e = typeof e == "function" ? _(e) : g(e);
	for (var t = this._groups, n = t.length, r = [], i = [], a = 0; a < n; ++a) for (var o = t[a], s = o.length, c, l = 0; l < s; ++l) (c = o[l]) && (r.push(e.call(c, c.__data__, l, o)), i.push(c));
	return new Ct(r, i);
}
// ../../node_modules/d3-selection/src/matcher.js
function y(e) {
	return function() {
		return this.matches(e);
	};
}
function b(e) {
	return function(t) {
		return t.matches(e);
	};
}
// ../../node_modules/d3-selection/src/selection/selectChild.js
var x = Array.prototype.find;
function S(e) {
	return function() {
		return x.call(this.children, e);
	};
}
function C() {
	return this.firstElementChild;
}
function w(e) {
	return this.select(e == null ? C : S(typeof e == "function" ? e : b(e)));
}
// ../../node_modules/d3-selection/src/selection/selectChildren.js
var T = Array.prototype.filter;
function E() {
	return Array.from(this.children);
}
function D(e) {
	return function() {
		return T.call(this.children, e);
	};
}
function O(e) {
	return this.selectAll(e == null ? E : D(typeof e == "function" ? e : b(e)));
}
// ../../node_modules/d3-selection/src/selection/filter.js
function k(e) {
	typeof e != "function" && (e = y(e));
	for (var t = this._groups, n = t.length, r = Array(n), i = 0; i < n; ++i) for (var a = t[i], o = a.length, s = r[i] = [], c, l = 0; l < o; ++l) (c = a[l]) && e.call(c, c.__data__, l, a) && s.push(c);
	return new Ct(r, this._parents);
}
// ../../node_modules/d3-selection/src/selection/sparse.js
function ee(e) {
	return Array(e.length);
}
// ../../node_modules/d3-selection/src/selection/enter.js
function A() {
	return new Ct(this._enter || this._groups.map(ee), this._parents);
}
function te(e, t) {
	this.ownerDocument = e.ownerDocument, this.namespaceURI = e.namespaceURI, this._next = null, this._parent = e, this.__data__ = t;
}
te.prototype = {
	constructor: te,
	appendChild: function(e) {
		return this._parent.insertBefore(e, this._next);
	},
	insertBefore: function(e, t) {
		return this._parent.insertBefore(e, t);
	},
	querySelector: function(e) {
		return this._parent.querySelector(e);
	},
	querySelectorAll: function(e) {
		return this._parent.querySelectorAll(e);
	}
};
// ../../node_modules/d3-selection/src/constant.js
function j(e) {
	return function() {
		return e;
	};
}
// ../../node_modules/d3-selection/src/selection/data.js
function ne(e, t, n, r, i, a) {
	for (var o = 0, s, c = t.length, l = a.length; o < l; ++o) (s = t[o]) ? (s.__data__ = a[o], r[o] = s) : n[o] = new te(e, a[o]);
	for (; o < c; ++o) (s = t[o]) && (i[o] = s);
}
function re(e, t, n, r, i, a, o) {
	var s, c, l = /* @__PURE__ */ new Map(), u = t.length, d = a.length, f = Array(u), p;
	for (s = 0; s < u; ++s) (c = t[s]) && (f[s] = p = o.call(c, c.__data__, s, t) + "", l.has(p) ? i[s] = c : l.set(p, c));
	for (s = 0; s < d; ++s) p = o.call(e, a[s], s, a) + "", (c = l.get(p)) ? (r[s] = c, c.__data__ = a[s], l.delete(p)) : n[s] = new te(e, a[s]);
	for (s = 0; s < u; ++s) (c = t[s]) && l.get(f[s]) === c && (i[s] = c);
}
function ie(e) {
	return e.__data__;
}
function ae(e, t) {
	if (!arguments.length) return Array.from(this, ie);
	var n = t ? re : ne, r = this._parents, i = this._groups;
	typeof e != "function" && (e = j(e));
	for (var a = i.length, o = Array(a), s = Array(a), c = Array(a), l = 0; l < a; ++l) {
		var u = r[l], d = i[l], f = d.length, p = oe(e.call(u, u && u.__data__, l, r)), m = p.length, h = s[l] = Array(m), g = o[l] = Array(m);
		n(u, d, h, g, c[l] = Array(f), p, t);
		for (var _ = 0, v = 0, y, b; _ < m; ++_) if (y = h[_]) {
			for (_ >= v && (v = _ + 1); !(b = g[v]) && ++v < m;);
			y._next = b || null;
		}
	}
	return o = new Ct(o, r), o._enter = s, o._exit = c, o;
}
function oe(e) {
	return typeof e == "object" && "length" in e ? e : Array.from(e);
}
// ../../node_modules/d3-selection/src/selection/exit.js
function se() {
	return new Ct(this._exit || this._groups.map(ee), this._parents);
}
// ../../node_modules/d3-selection/src/selection/join.js
function ce(e, t, n) {
	var r = this.enter(), i = this, a = this.exit();
	return typeof e == "function" ? (r = e(r), r &&= r.selection()) : r = r.append(e + ""), t != null && (i = t(i), i &&= i.selection()), n == null ? a.remove() : n(a), r && i ? r.merge(i).order() : i;
}
// ../../node_modules/d3-selection/src/selection/merge.js
function le(e) {
	for (var t = e.selection ? e.selection() : e, n = this._groups, r = t._groups, i = n.length, a = r.length, o = Math.min(i, a), s = Array(i), c = 0; c < o; ++c) for (var l = n[c], u = r[c], d = l.length, f = s[c] = Array(d), p, m = 0; m < d; ++m) (p = l[m] || u[m]) && (f[m] = p);
	for (; c < i; ++c) s[c] = n[c];
	return new Ct(s, this._parents);
}
// ../../node_modules/d3-selection/src/selection/order.js
function ue() {
	for (var e = this._groups, t = -1, n = e.length; ++t < n;) for (var r = e[t], i = r.length - 1, a = r[i], o; --i >= 0;) (o = r[i]) && (a && o.compareDocumentPosition(a) ^ 4 && a.parentNode.insertBefore(o, a), a = o);
	return this;
}
// ../../node_modules/d3-selection/src/selection/sort.js
function de(e) {
	e ||= fe;
	function t(t, n) {
		return t && n ? e(t.__data__, n.__data__) : !t - !n;
	}
	for (var n = this._groups, r = n.length, i = Array(r), a = 0; a < r; ++a) {
		for (var o = n[a], s = o.length, c = i[a] = Array(s), l, u = 0; u < s; ++u) (l = o[u]) && (c[u] = l);
		c.sort(t);
	}
	return new Ct(i, this._parents).order();
}
function fe(e, t) {
	return e < t ? -1 : e > t ? 1 : e >= t ? 0 : NaN;
}
// ../../node_modules/d3-selection/src/selection/call.js
function pe() {
	var e = arguments[0];
	return arguments[0] = this, e.apply(null, arguments), this;
}
// ../../node_modules/d3-selection/src/selection/nodes.js
function me() {
	return Array.from(this);
}
// ../../node_modules/d3-selection/src/selection/node.js
function he() {
	for (var e = this._groups, t = 0, n = e.length; t < n; ++t) for (var r = e[t], i = 0, a = r.length; i < a; ++i) {
		var o = r[i];
		if (o) return o;
	}
	return null;
}
// ../../node_modules/d3-selection/src/selection/size.js
function ge() {
	let e = 0;
	for (let t of this) ++e;
	return e;
}
// ../../node_modules/d3-selection/src/selection/empty.js
function _e() {
	return !this.node();
}
// ../../node_modules/d3-selection/src/selection/each.js
function ve(e) {
	for (var t = this._groups, n = 0, r = t.length; n < r; ++n) for (var i = t[n], a = 0, o = i.length, s; a < o; ++a) (s = i[a]) && e.call(s, s.__data__, a, i);
	return this;
}
// ../../node_modules/d3-selection/src/selection/attr.js
function ye(e) {
	return function() {
		this.removeAttribute(e);
	};
}
function be(e) {
	return function() {
		this.removeAttributeNS(e.space, e.local);
	};
}
function xe(e, t) {
	return function() {
		this.setAttribute(e, t);
	};
}
function Se(e, t) {
	return function() {
		this.setAttributeNS(e.space, e.local, t);
	};
}
function Ce(e, t) {
	return function() {
		var n = t.apply(this, arguments);
		n == null ? this.removeAttribute(e) : this.setAttribute(e, n);
	};
}
function we(e, t) {
	return function() {
		var n = t.apply(this, arguments);
		n == null ? this.removeAttributeNS(e.space, e.local) : this.setAttributeNS(e.space, e.local, n);
	};
}
function Te(e, t) {
	var n = s(e);
	if (arguments.length < 2) {
		var r = this.node();
		return n.local ? r.getAttributeNS(n.space, n.local) : r.getAttribute(n);
	}
	return this.each((t == null ? n.local ? be : ye : typeof t == "function" ? n.local ? we : Ce : n.local ? Se : xe)(n, t));
}
// ../../node_modules/d3-selection/src/window.js
function Ee(e) {
	return e.ownerDocument && e.ownerDocument.defaultView || e.document && e || e.defaultView;
}
// ../../node_modules/d3-selection/src/selection/style.js
function De(e) {
	return function() {
		this.style.removeProperty(e);
	};
}
function Oe(e, t, n) {
	return function() {
		this.style.setProperty(e, t, n);
	};
}
function ke(e, t, n) {
	return function() {
		var r = t.apply(this, arguments);
		r == null ? this.style.removeProperty(e) : this.style.setProperty(e, r, n);
	};
}
function Ae(e, t, n) {
	return arguments.length > 1 ? this.each((t == null ? De : typeof t == "function" ? ke : Oe)(e, t, n ?? "")) : je(this.node(), e);
}
function je(e, t) {
	return e.style.getPropertyValue(t) || Ee(e).getComputedStyle(e, null).getPropertyValue(t);
}
// ../../node_modules/d3-selection/src/selection/property.js
function Me(e) {
	return function() {
		delete this[e];
	};
}
function Ne(e, t) {
	return function() {
		this[e] = t;
	};
}
function Pe(e, t) {
	return function() {
		var n = t.apply(this, arguments);
		n == null ? delete this[e] : this[e] = n;
	};
}
function Fe(e, t) {
	return arguments.length > 1 ? this.each((t == null ? Me : typeof t == "function" ? Pe : Ne)(e, t)) : this.node()[e];
}
// ../../node_modules/d3-selection/src/selection/classed.js
function Ie(e) {
	return e.trim().split(/^|\s+/);
}
function Le(e) {
	return e.classList || new Re(e);
}
function Re(e) {
	this._node = e, this._names = Ie(e.getAttribute("class") || "");
}
Re.prototype = {
	add: function(e) {
		this._names.indexOf(e) < 0 && (this._names.push(e), this._node.setAttribute("class", this._names.join(" ")));
	},
	remove: function(e) {
		var t = this._names.indexOf(e);
		t >= 0 && (this._names.splice(t, 1), this._node.setAttribute("class", this._names.join(" ")));
	},
	contains: function(e) {
		return this._names.indexOf(e) >= 0;
	}
};
function ze(e, t) {
	for (var n = Le(e), r = -1, i = t.length; ++r < i;) n.add(t[r]);
}
function Be(e, t) {
	for (var n = Le(e), r = -1, i = t.length; ++r < i;) n.remove(t[r]);
}
function Ve(e) {
	return function() {
		ze(this, e);
	};
}
function He(e) {
	return function() {
		Be(this, e);
	};
}
function Ue(e, t) {
	return function() {
		(t.apply(this, arguments) ? ze : Be)(this, e);
	};
}
function We(e, t) {
	var n = Ie(e + "");
	if (arguments.length < 2) {
		for (var r = Le(this.node()), i = -1, a = n.length; ++i < a;) if (!r.contains(n[i])) return !1;
		return !0;
	}
	return this.each((typeof t == "function" ? Ue : t ? Ve : He)(n, t));
}
// ../../node_modules/d3-selection/src/selection/text.js
function Ge() {
	this.textContent = "";
}
function Ke(e) {
	return function() {
		this.textContent = e;
	};
}
function qe(e) {
	return function() {
		var t = e.apply(this, arguments);
		this.textContent = t ?? "";
	};
}
function Je(e) {
	return arguments.length ? this.each(e == null ? Ge : (typeof e == "function" ? qe : Ke)(e)) : this.node().textContent;
}
// ../../node_modules/d3-selection/src/selection/html.js
function Ye() {
	this.innerHTML = "";
}
function Xe(e) {
	return function() {
		this.innerHTML = e;
	};
}
function Ze(e) {
	return function() {
		var t = e.apply(this, arguments);
		this.innerHTML = t ?? "";
	};
}
function Qe(e) {
	return arguments.length ? this.each(e == null ? Ye : (typeof e == "function" ? Ze : Xe)(e)) : this.node().innerHTML;
}
// ../../node_modules/d3-selection/src/selection/raise.js
function $e() {
	this.nextSibling && this.parentNode.appendChild(this);
}
function et() {
	return this.each($e);
}
// ../../node_modules/d3-selection/src/selection/lower.js
function tt() {
	this.previousSibling && this.parentNode.insertBefore(this, this.parentNode.firstChild);
}
function nt() {
	return this.each(tt);
}
// ../../node_modules/d3-selection/src/selection/append.js
function rt(e) {
	var t = typeof e == "function" ? e : u(e);
	return this.select(function() {
		return this.appendChild(t.apply(this, arguments));
	});
}
// ../../node_modules/d3-selection/src/selection/insert.js
function it() {
	return null;
}
function at(e, t) {
	var n = typeof e == "function" ? e : u(e), r = t == null ? it : typeof t == "function" ? t : f(t);
	return this.select(function() {
		return this.insertBefore(n.apply(this, arguments), r.apply(this, arguments) || null);
	});
}
// ../../node_modules/d3-selection/src/selection/remove.js
function ot() {
	var e = this.parentNode;
	e && e.removeChild(this);
}
function st() {
	return this.each(ot);
}
// ../../node_modules/d3-selection/src/selection/clone.js
function ct() {
	var e = this.cloneNode(!1), t = this.parentNode;
	return t ? t.insertBefore(e, this.nextSibling) : e;
}
function lt() {
	var e = this.cloneNode(!0), t = this.parentNode;
	return t ? t.insertBefore(e, this.nextSibling) : e;
}
function ut(e) {
	return this.select(e ? lt : ct);
}
// ../../node_modules/d3-selection/src/selection/datum.js
function dt(e) {
	return arguments.length ? this.property("__data__", e) : this.node().__data__;
}
// ../../node_modules/d3-selection/src/selection/on.js
function ft(e) {
	return function(t) {
		e.call(this, t, this.__data__);
	};
}
function pt(e) {
	return e.trim().split(/^|\s+/).map(function(e) {
		var t = "", n = e.indexOf(".");
		return n >= 0 && (t = e.slice(n + 1), e = e.slice(0, n)), {
			type: e,
			name: t
		};
	});
}
function mt(e) {
	return function() {
		var t = this.__on;
		if (t) {
			for (var n = 0, r = -1, i = t.length, a; n < i; ++n) a = t[n], (!e.type || a.type === e.type) && a.name === e.name ? this.removeEventListener(a.type, a.listener, a.options) : t[++r] = a;
			++r ? t.length = r : delete this.__on;
		}
	};
}
function ht(e, t, n) {
	return function() {
		var r = this.__on, i, a = ft(t);
		if (r) {
			for (var o = 0, s = r.length; o < s; ++o) if ((i = r[o]).type === e.type && i.name === e.name) {
				this.removeEventListener(i.type, i.listener, i.options), this.addEventListener(i.type, i.listener = a, i.options = n), i.value = t;
				return;
			}
		}
		this.addEventListener(e.type, a, n), i = {
			type: e.type,
			name: e.name,
			value: t,
			listener: a,
			options: n
		}, r ? r.push(i) : this.__on = [i];
	};
}
function gt(e, t, n) {
	var r = pt(e + ""), i, a = r.length, o;
	if (arguments.length < 2) {
		var s = this.node().__on;
		if (s) {
			for (var c = 0, l = s.length, u; c < l; ++c) for (i = 0, u = s[c]; i < a; ++i) if ((o = r[i]).type === u.type && o.name === u.name) return u.value;
		}
	} else {
		for (s = t ? ht : mt, i = 0; i < a; ++i) this.each(s(r[i], t, n));
		return this;
	}
}
// ../../node_modules/d3-selection/src/selection/dispatch.js
function _t(e, t, n) {
	var r = Ee(e), i = r.CustomEvent;
	typeof i == "function" ? i = new i(t, n) : (i = r.document.createEvent("Event"), n ? (i.initEvent(t, n.bubbles, n.cancelable), i.detail = n.detail) : i.initEvent(t, !1, !1)), e.dispatchEvent(i);
}
function vt(e, t) {
	return function() {
		return _t(this, e, t);
	};
}
function yt(e, t) {
	return function() {
		return _t(this, e, t.apply(this, arguments));
	};
}
function bt(e, t) {
	return this.each((typeof t == "function" ? yt : vt)(e, t));
}
// ../../node_modules/d3-selection/src/selection/iterator.js
function* xt() {
	for (var e = this._groups, t = 0, n = e.length; t < n; ++t) for (var r = e[t], i = 0, a = r.length, o; i < a; ++i) (o = r[i]) && (yield o);
}
// ../../node_modules/d3-selection/src/selection/index.js
var St = [null];
function Ct(e, t) {
	this._groups = e, this._parents = t;
}
function wt() {
	return new Ct([[document.documentElement]], St);
}
function Tt() {
	return this;
}
Ct.prototype = wt.prototype = {
	constructor: Ct,
	select: p,
	selectAll: v,
	selectChild: w,
	selectChildren: O,
	filter: k,
	data: ae,
	enter: A,
	exit: se,
	join: ce,
	merge: le,
	selection: Tt,
	order: ue,
	sort: de,
	call: pe,
	nodes: me,
	node: he,
	size: ge,
	empty: _e,
	each: ve,
	attr: Te,
	style: Ae,
	property: Fe,
	classed: We,
	text: Je,
	html: Qe,
	raise: et,
	lower: nt,
	append: rt,
	insert: at,
	remove: st,
	clone: ut,
	datum: dt,
	on: gt,
	dispatch: bt,
	[Symbol.iterator]: xt
};
// ../../node_modules/d3-selection/src/select.js
function M(e) {
	return typeof e == "string" ? new Ct([[document.querySelector(e)]], [document.documentElement]) : new Ct([[e]], St);
}
// ../../node_modules/d3-selection/src/sourceEvent.js
function Et(e) {
	let t;
	for (; t = e.sourceEvent;) e = t;
	return e;
}
// ../../node_modules/d3-selection/src/pointer.js
function Dt(e, t) {
	if (e = Et(e), t === void 0 && (t = e.currentTarget), t) {
		var n = t.ownerSVGElement || t;
		if (n.createSVGPoint) {
			var r = n.createSVGPoint();
			return r.x = e.clientX, r.y = e.clientY, r = r.matrixTransform(t.getScreenCTM().inverse()), [r.x, r.y];
		}
		if (t.getBoundingClientRect) {
			var i = t.getBoundingClientRect();
			return [e.clientX - i.left - t.clientLeft, e.clientY - i.top - t.clientTop];
		}
	}
	return [e.pageX, e.pageY];
}
// ../../node_modules/d3-selection/src/selectAll.js
function Ot(e) {
	return typeof e == "string" ? new Ct([document.querySelectorAll(e)], [document.documentElement]) : new Ct([m(e)], St);
}
// ../../node_modules/d3-time/src/interval.js
var kt = /* @__PURE__ */ new Date(), At = /* @__PURE__ */ new Date();
function jt(e, t, n, r) {
	function i(t) {
		return e(t = arguments.length === 0 ? /* @__PURE__ */ new Date() : /* @__PURE__ */ new Date(+t)), t;
	}
	return i.floor = (t) => (e(t = /* @__PURE__ */ new Date(+t)), t), i.ceil = (n) => (e(n = /* @__PURE__ */ new Date(n - 1)), t(n, 1), e(n), n), i.round = (e) => {
		let t = i(e), n = i.ceil(e);
		return e - t < n - e ? t : n;
	}, i.offset = (e, n) => (t(e = /* @__PURE__ */ new Date(+e), n == null ? 1 : Math.floor(n)), e), i.range = (n, r, a) => {
		let o = [];
		if (n = i.ceil(n), a = a == null ? 1 : Math.floor(a), !(n < r) || !(a > 0)) return o;
		let s;
		do
			o.push(s = /* @__PURE__ */ new Date(+n)), t(n, a), e(n);
		while (s < n && n < r);
		return o;
	}, i.filter = (n) => jt((t) => {
		if (t >= t) for (; e(t), !n(t);) t.setTime(t - 1);
	}, (e, r) => {
		if (e >= e) {
			if (r < 0) for (; ++r <= 0;) for (; t(e, -1), !n(e););
			else for (; --r >= 0;) for (; t(e, 1), !n(e););
		}
	}), n && (i.count = (t, r) => (kt.setTime(+t), At.setTime(+r), e(kt), e(At), Math.floor(n(kt, At))), i.every = (e) => (e = Math.floor(e), !isFinite(e) || !(e > 0) ? null : e > 1 ? i.filter(r ? (t) => r(t) % e === 0 : (t) => i.count(0, t) % e === 0) : i)), i;
}
// ../../node_modules/d3-time/src/millisecond.js
var Mt = jt(() => {}, (e, t) => {
	e.setTime(+e + t);
}, (e, t) => t - e);
Mt.every = (e) => (e = Math.floor(e), !isFinite(e) || !(e > 0) ? null : e > 1 ? jt((t) => {
	t.setTime(Math.floor(t / e) * e);
}, (t, n) => {
	t.setTime(+t + n * e);
}, (t, n) => (n - t) / e) : Mt), Mt.range;
// ../../node_modules/d3-time/src/duration.js
var Nt = 1e3, Pt = Nt * 60, Ft = Pt * 60, It = Ft * 24, Lt = It * 7, Rt = It * 30, zt = It * 365, Bt = jt((e) => {
	e.setTime(e - e.getMilliseconds());
}, (e, t) => {
	e.setTime(+e + t * Nt);
}, (e, t) => (t - e) / Nt, (e) => e.getUTCSeconds());
Bt.range;
// ../../node_modules/d3-time/src/minute.js
var Vt = jt((e) => {
	e.setTime(e - e.getMilliseconds() - e.getSeconds() * Nt);
}, (e, t) => {
	e.setTime(+e + t * Pt);
}, (e, t) => (t - e) / Pt, (e) => e.getMinutes());
Vt.range;
var Ht = jt((e) => {
	e.setUTCSeconds(0, 0);
}, (e, t) => {
	e.setTime(+e + t * Pt);
}, (e, t) => (t - e) / Pt, (e) => e.getUTCMinutes());
Ht.range;
// ../../node_modules/d3-time/src/hour.js
var Ut = jt((e) => {
	e.setTime(e - e.getMilliseconds() - e.getSeconds() * Nt - e.getMinutes() * Pt);
}, (e, t) => {
	e.setTime(+e + t * Ft);
}, (e, t) => (t - e) / Ft, (e) => e.getHours());
Ut.range;
var Wt = jt((e) => {
	e.setUTCMinutes(0, 0, 0);
}, (e, t) => {
	e.setTime(+e + t * Ft);
}, (e, t) => (t - e) / Ft, (e) => e.getUTCHours());
Wt.range;
// ../../node_modules/d3-time/src/day.js
var Gt = jt((e) => e.setHours(0, 0, 0, 0), (e, t) => e.setDate(e.getDate() + t), (e, t) => (t - e - (t.getTimezoneOffset() - e.getTimezoneOffset()) * Pt) / It, (e) => e.getDate() - 1);
Gt.range;
var Kt = jt((e) => {
	e.setUTCHours(0, 0, 0, 0);
}, (e, t) => {
	e.setUTCDate(e.getUTCDate() + t);
}, (e, t) => (t - e) / It, (e) => e.getUTCDate() - 1);
Kt.range;
var qt = jt((e) => {
	e.setUTCHours(0, 0, 0, 0);
}, (e, t) => {
	e.setUTCDate(e.getUTCDate() + t);
}, (e, t) => (t - e) / It, (e) => Math.floor(e / It));
qt.range;
// ../../node_modules/d3-time/src/week.js
function Jt(e) {
	return jt((t) => {
		t.setDate(t.getDate() - (t.getDay() + 7 - e) % 7), t.setHours(0, 0, 0, 0);
	}, (e, t) => {
		e.setDate(e.getDate() + t * 7);
	}, (e, t) => (t - e - (t.getTimezoneOffset() - e.getTimezoneOffset()) * Pt) / Lt);
}
var Yt = Jt(0), Xt = Jt(1), Zt = Jt(2), Qt = Jt(3), $t = Jt(4), en = Jt(5), tn = Jt(6);
Yt.range, Xt.range, Zt.range, Qt.range, $t.range, en.range, tn.range;
function nn(e) {
	return jt((t) => {
		t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 7 - e) % 7), t.setUTCHours(0, 0, 0, 0);
	}, (e, t) => {
		e.setUTCDate(e.getUTCDate() + t * 7);
	}, (e, t) => (t - e) / Lt);
}
var rn = nn(0), an = nn(1), on = nn(2), sn = nn(3), cn = nn(4), ln = nn(5), un = nn(6);
rn.range, an.range, on.range, sn.range, cn.range, ln.range, un.range;
// ../../node_modules/d3-time/src/month.js
var dn = jt((e) => {
	e.setDate(1), e.setHours(0, 0, 0, 0);
}, (e, t) => {
	e.setMonth(e.getMonth() + t);
}, (e, t) => t.getMonth() - e.getMonth() + (t.getFullYear() - e.getFullYear()) * 12, (e) => e.getMonth());
dn.range;
var fn = jt((e) => {
	e.setUTCDate(1), e.setUTCHours(0, 0, 0, 0);
}, (e, t) => {
	e.setUTCMonth(e.getUTCMonth() + t);
}, (e, t) => t.getUTCMonth() - e.getUTCMonth() + (t.getUTCFullYear() - e.getUTCFullYear()) * 12, (e) => e.getUTCMonth());
fn.range;
// ../../node_modules/d3-time/src/year.js
var pn = jt((e) => {
	e.setMonth(0, 1), e.setHours(0, 0, 0, 0);
}, (e, t) => {
	e.setFullYear(e.getFullYear() + t);
}, (e, t) => t.getFullYear() - e.getFullYear(), (e) => e.getFullYear());
pn.every = (e) => !isFinite(e = Math.floor(e)) || !(e > 0) ? null : jt((t) => {
	t.setFullYear(Math.floor(t.getFullYear() / e) * e), t.setMonth(0, 1), t.setHours(0, 0, 0, 0);
}, (t, n) => {
	t.setFullYear(t.getFullYear() + n * e);
}), pn.range;
var mn = jt((e) => {
	e.setUTCMonth(0, 1), e.setUTCHours(0, 0, 0, 0);
}, (e, t) => {
	e.setUTCFullYear(e.getUTCFullYear() + t);
}, (e, t) => t.getUTCFullYear() - e.getUTCFullYear(), (e) => e.getUTCFullYear());
mn.every = (e) => !isFinite(e = Math.floor(e)) || !(e > 0) ? null : jt((t) => {
	t.setUTCFullYear(Math.floor(t.getUTCFullYear() / e) * e), t.setUTCMonth(0, 1), t.setUTCHours(0, 0, 0, 0);
}, (t, n) => {
	t.setUTCFullYear(t.getUTCFullYear() + n * e);
}), mn.range;
// ../../node_modules/d3-array/src/ascending.js
function hn(e, t) {
	return e == null || t == null ? NaN : e < t ? -1 : e > t ? 1 : e >= t ? 0 : NaN;
}
// ../../node_modules/d3-array/src/descending.js
function gn(e, t) {
	return e == null || t == null ? NaN : t < e ? -1 : t > e ? 1 : t >= e ? 0 : NaN;
}
// ../../node_modules/d3-array/src/bisector.js
function _n(e) {
	let t, n, r;
	e.length === 2 ? (t = e === hn || e === gn ? e : vn, n = e, r = e) : (t = hn, n = (t, n) => hn(e(t), n), r = (t, n) => e(t) - n);
	function i(e, r, i = 0, a = e.length) {
		if (i < a) {
			if (t(r, r) !== 0) return a;
			do {
				let t = i + a >>> 1;
				n(e[t], r) < 0 ? i = t + 1 : a = t;
			} while (i < a);
		}
		return i;
	}
	function a(e, r, i = 0, a = e.length) {
		if (i < a) {
			if (t(r, r) !== 0) return a;
			do {
				let t = i + a >>> 1;
				n(e[t], r) <= 0 ? i = t + 1 : a = t;
			} while (i < a);
		}
		return i;
	}
	function o(e, t, n = 0, a = e.length) {
		let o = i(e, t, n, a - 1);
		return o > n && r(e[o - 1], t) > -r(e[o], t) ? o - 1 : o;
	}
	return {
		left: i,
		center: o,
		right: a
	};
}
function vn() {
	return 0;
}
// ../../node_modules/d3-array/src/number.js
function yn(e) {
	return e === null ? NaN : +e;
}
// ../../node_modules/d3-array/src/bisect.js
var bn = _n(hn), xn = bn.right;
bn.left, _n(yn).center;
// ../../node_modules/internmap/src/index.js
var Sn = class extends Map {
	constructor(e, t = En) {
		if (super(), Object.defineProperties(this, {
			_intern: { value: /* @__PURE__ */ new Map() },
			_key: { value: t }
		}), e != null) for (let [t, n] of e) this.set(t, n);
	}
	get(e) {
		return super.get(Cn(this, e));
	}
	has(e) {
		return super.has(Cn(this, e));
	}
	set(e, t) {
		return super.set(wn(this, e), t);
	}
	delete(e) {
		return super.delete(Tn(this, e));
	}
};
function Cn({ _intern: e, _key: t }, n) {
	let r = t(n);
	return e.has(r) ? e.get(r) : n;
}
function wn({ _intern: e, _key: t }, n) {
	let r = t(n);
	return e.has(r) ? e.get(r) : (e.set(r, n), n);
}
function Tn({ _intern: e, _key: t }, n) {
	let r = t(n);
	return e.has(r) && (n = e.get(r), e.delete(r)), n;
}
function En(e) {
	return typeof e == "object" && e ? e.valueOf() : e;
}
// ../../node_modules/d3-array/src/ticks.js
var Dn = Math.sqrt(50), On = Math.sqrt(10), kn = Math.sqrt(2);
function An(e, t, n) {
	let r = (t - e) / Math.max(0, n), i = Math.floor(Math.log10(r)), a = r / 10 ** i, o = a >= Dn ? 10 : a >= On ? 5 : a >= kn ? 2 : 1, s, c, l;
	return i < 0 ? (l = 10 ** -i / o, s = Math.round(e * l), c = Math.round(t * l), s / l < e && ++s, c / l > t && --c, l = -l) : (l = 10 ** i * o, s = Math.round(e / l), c = Math.round(t / l), s * l < e && ++s, c * l > t && --c), c < s && .5 <= n && n < 2 ? An(e, t, n * 2) : [
		s,
		c,
		l
	];
}
function jn(e, t, n) {
	if (t = +t, e = +e, n = +n, !(n > 0)) return [];
	if (e === t) return [e];
	let r = t < e, [i, a, o] = r ? An(t, e, n) : An(e, t, n);
	if (!(a >= i)) return [];
	let s = a - i + 1, c = Array(s);
	if (r) {
		if (o < 0) for (let e = 0; e < s; ++e) c[e] = (a - e) / -o;
		else for (let e = 0; e < s; ++e) c[e] = (a - e) * o;
	} else if (o < 0) for (let e = 0; e < s; ++e) c[e] = (i + e) / -o;
	else for (let e = 0; e < s; ++e) c[e] = (i + e) * o;
	return c;
}
function Mn(e, t, n) {
	return t = +t, e = +e, n = +n, An(e, t, n)[2];
}
function Nn(e, t, n) {
	t = +t, e = +e, n = +n;
	let r = t < e, i = r ? Mn(t, e, n) : Mn(e, t, n);
	return (r ? -1 : 1) * (i < 0 ? 1 / -i : i);
}
// ../../node_modules/d3-time/src/ticks.js
function Pn(e, t, n, r, i, a) {
	let o = [
		[
			Bt,
			1,
			Nt
		],
		[
			Bt,
			5,
			5 * Nt
		],
		[
			Bt,
			15,
			15 * Nt
		],
		[
			Bt,
			30,
			30 * Nt
		],
		[
			a,
			1,
			Pt
		],
		[
			a,
			5,
			5 * Pt
		],
		[
			a,
			15,
			15 * Pt
		],
		[
			a,
			30,
			30 * Pt
		],
		[
			i,
			1,
			Ft
		],
		[
			i,
			3,
			3 * Ft
		],
		[
			i,
			6,
			6 * Ft
		],
		[
			i,
			12,
			12 * Ft
		],
		[
			r,
			1,
			It
		],
		[
			r,
			2,
			2 * It
		],
		[
			n,
			1,
			Lt
		],
		[
			t,
			1,
			Rt
		],
		[
			t,
			3,
			3 * Rt
		],
		[
			e,
			1,
			zt
		]
	];
	function s(e, t, n) {
		let r = t < e;
		r && ([e, t] = [t, e]);
		let i = n && typeof n.range == "function" ? n : c(e, t, n), a = i ? i.range(e, +t + 1) : [];
		return r ? a.reverse() : a;
	}
	function c(t, n, r) {
		let i = Math.abs(n - t) / r, a = _n(([, , e]) => e).right(o, i);
		if (a === o.length) return e.every(Nn(t / zt, n / zt, r));
		if (a === 0) return Mt.every(Math.max(Nn(t, n, r), 1));
		let [s, c] = o[i / o[a - 1][2] < o[a][2] / i ? a - 1 : a];
		return s.every(c);
	}
	return [s, c];
}
var [Fn, In] = Pn(mn, fn, rn, qt, Wt, Ht), [Ln, Rn] = Pn(pn, dn, Yt, Gt, Ut, Vt);
// ../../node_modules/d3-time-format/src/locale.js
function zn(e) {
	if (0 <= e.y && e.y < 100) {
		var t = new Date(-1, e.m, e.d, e.H, e.M, e.S, e.L);
		return t.setFullYear(e.y), t;
	}
	return new Date(e.y, e.m, e.d, e.H, e.M, e.S, e.L);
}
function Bn(e) {
	if (0 <= e.y && e.y < 100) {
		var t = new Date(Date.UTC(-1, e.m, e.d, e.H, e.M, e.S, e.L));
		return t.setUTCFullYear(e.y), t;
	}
	return new Date(Date.UTC(e.y, e.m, e.d, e.H, e.M, e.S, e.L));
}
function Vn(e, t, n) {
	return {
		y: e,
		m: t,
		d: n,
		H: 0,
		M: 0,
		S: 0,
		L: 0
	};
}
function Hn(e) {
	var t = e.dateTime, n = e.date, r = e.time, i = e.periods, a = e.days, o = e.shortDays, s = e.months, c = e.shortMonths, l = Jn(i), u = Yn(i), d = Jn(a), f = Yn(a), p = Jn(o), m = Yn(o), h = Jn(s), g = Yn(s), _ = Jn(c), v = Yn(c), y = {
		a: j,
		A: ne,
		b: re,
		B: ie,
		c: null,
		d: gr,
		e: gr,
		f: xr,
		g: Mr,
		G: Pr,
		H: _r,
		I: vr,
		j: yr,
		L: br,
		m: Sr,
		M: Cr,
		p: ae,
		q: oe,
		Q: ri,
		s: ii,
		S: wr,
		u: Tr,
		U: Er,
		V: Or,
		w: kr,
		W: Ar,
		x: null,
		X: null,
		y: jr,
		Y: Nr,
		Z: Fr,
		"%": ni
	}, b = {
		a: se,
		A: ce,
		b: le,
		B: ue,
		c: null,
		d: Ir,
		e: Ir,
		f: Vr,
		g: Qr,
		G: ei,
		H: Lr,
		I: Rr,
		j: zr,
		L: Br,
		m: Hr,
		M: Ur,
		p: de,
		q: fe,
		Q: ri,
		s: ii,
		S: Wr,
		u: Gr,
		U: Kr,
		V: Jr,
		w: Yr,
		W: Xr,
		x: null,
		X: null,
		y: Zr,
		Y: $r,
		Z: ti,
		"%": ni
	}, x = {
		a: E,
		A: D,
		b: O,
		B: k,
		c: ee,
		d: or,
		e: or,
		f: fr,
		g: nr,
		G: tr,
		H: cr,
		I: cr,
		j: sr,
		L: dr,
		m: ar,
		M: lr,
		p: T,
		q: ir,
		Q: mr,
		s: hr,
		S: ur,
		u: Zn,
		U: Qn,
		V: $n,
		w: Xn,
		W: er,
		x: A,
		X: te,
		y: nr,
		Y: tr,
		Z: rr,
		"%": pr
	};
	y.x = S(n, y), y.X = S(r, y), y.c = S(t, y), b.x = S(n, b), b.X = S(r, b), b.c = S(t, b);
	function S(e, t) {
		return function(n) {
			var r = [], i = -1, a = 0, o = e.length, s, c, l;
			for (n instanceof Date || (n = /* @__PURE__ */ new Date(+n)); ++i < o;) e.charCodeAt(i) === 37 && (r.push(e.slice(a, i)), (c = Un[s = e.charAt(++i)]) == null ? c = s === "e" ? " " : "0" : s = e.charAt(++i), (l = t[s]) && (s = l(n, c)), r.push(s), a = i + 1);
			return r.push(e.slice(a, i)), r.join("");
		};
	}
	function C(e, t) {
		return function(n) {
			var r = Vn(1900, void 0, 1), i = w(r, e, n += "", 0), a, o;
			if (i != n.length) return null;
			if ("Q" in r) return new Date(r.Q);
			if ("s" in r) return new Date(r.s * 1e3 + ("L" in r ? r.L : 0));
			if (t && !("Z" in r) && (r.Z = 0), "p" in r && (r.H = r.H % 12 + r.p * 12), r.m === void 0 && (r.m = "q" in r ? r.q : 0), "V" in r) {
				if (r.V < 1 || r.V > 53) return null;
				"w" in r || (r.w = 1), "Z" in r ? (a = Bn(Vn(r.y, 0, 1)), o = a.getUTCDay(), a = o > 4 || o === 0 ? an.ceil(a) : an(a), a = Kt.offset(a, (r.V - 1) * 7), r.y = a.getUTCFullYear(), r.m = a.getUTCMonth(), r.d = a.getUTCDate() + (r.w + 6) % 7) : (a = zn(Vn(r.y, 0, 1)), o = a.getDay(), a = o > 4 || o === 0 ? Xt.ceil(a) : Xt(a), a = Gt.offset(a, (r.V - 1) * 7), r.y = a.getFullYear(), r.m = a.getMonth(), r.d = a.getDate() + (r.w + 6) % 7);
			} else ("W" in r || "U" in r) && ("w" in r || (r.w = "u" in r ? r.u % 7 : +("W" in r)), o = "Z" in r ? Bn(Vn(r.y, 0, 1)).getUTCDay() : zn(Vn(r.y, 0, 1)).getDay(), r.m = 0, r.d = "W" in r ? (r.w + 6) % 7 + r.W * 7 - (o + 5) % 7 : r.w + r.U * 7 - (o + 6) % 7);
			return "Z" in r ? (r.H += r.Z / 100 | 0, r.M += r.Z % 100, Bn(r)) : zn(r);
		};
	}
	function w(e, t, n, r) {
		for (var i = 0, a = t.length, o = n.length, s, c; i < a;) {
			if (r >= o) return -1;
			if (s = t.charCodeAt(i++), s === 37) {
				if (s = t.charAt(i++), c = x[s in Un ? t.charAt(i++) : s], !c || (r = c(e, n, r)) < 0) return -1;
			} else if (s != n.charCodeAt(r++)) return -1;
		}
		return r;
	}
	function T(e, t, n) {
		var r = l.exec(t.slice(n));
		return r ? (e.p = u.get(r[0].toLowerCase()), n + r[0].length) : -1;
	}
	function E(e, t, n) {
		var r = p.exec(t.slice(n));
		return r ? (e.w = m.get(r[0].toLowerCase()), n + r[0].length) : -1;
	}
	function D(e, t, n) {
		var r = d.exec(t.slice(n));
		return r ? (e.w = f.get(r[0].toLowerCase()), n + r[0].length) : -1;
	}
	function O(e, t, n) {
		var r = _.exec(t.slice(n));
		return r ? (e.m = v.get(r[0].toLowerCase()), n + r[0].length) : -1;
	}
	function k(e, t, n) {
		var r = h.exec(t.slice(n));
		return r ? (e.m = g.get(r[0].toLowerCase()), n + r[0].length) : -1;
	}
	function ee(e, n, r) {
		return w(e, t, n, r);
	}
	function A(e, t, r) {
		return w(e, n, t, r);
	}
	function te(e, t, n) {
		return w(e, r, t, n);
	}
	function j(e) {
		return o[e.getDay()];
	}
	function ne(e) {
		return a[e.getDay()];
	}
	function re(e) {
		return c[e.getMonth()];
	}
	function ie(e) {
		return s[e.getMonth()];
	}
	function ae(e) {
		return i[+(e.getHours() >= 12)];
	}
	function oe(e) {
		return 1 + ~~(e.getMonth() / 3);
	}
	function se(e) {
		return o[e.getUTCDay()];
	}
	function ce(e) {
		return a[e.getUTCDay()];
	}
	function le(e) {
		return c[e.getUTCMonth()];
	}
	function ue(e) {
		return s[e.getUTCMonth()];
	}
	function de(e) {
		return i[+(e.getUTCHours() >= 12)];
	}
	function fe(e) {
		return 1 + ~~(e.getUTCMonth() / 3);
	}
	return {
		format: function(e) {
			var t = S(e += "", y);
			return t.toString = function() {
				return e;
			}, t;
		},
		parse: function(e) {
			var t = C(e += "", !1);
			return t.toString = function() {
				return e;
			}, t;
		},
		utcFormat: function(e) {
			var t = S(e += "", b);
			return t.toString = function() {
				return e;
			}, t;
		},
		utcParse: function(e) {
			var t = C(e += "", !0);
			return t.toString = function() {
				return e;
			}, t;
		}
	};
}
var Un = {
	"-": "",
	_: " ",
	0: "0"
}, Wn = /^\s*\d+/, Gn = /^%/, Kn = /[\\^$*+?|[\]().{}]/g;
function N(e, t, n) {
	var r = e < 0 ? "-" : "", i = (r ? -e : e) + "", a = i.length;
	return r + (a < n ? Array(n - a + 1).join(t) + i : i);
}
function qn(e) {
	return e.replace(Kn, "\\$&");
}
function Jn(e) {
	return RegExp("^(?:" + e.map(qn).join("|") + ")", "i");
}
function Yn(e) {
	return new Map(e.map((e, t) => [e.toLowerCase(), t]));
}
function Xn(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 1));
	return r ? (e.w = +r[0], n + r[0].length) : -1;
}
function Zn(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 1));
	return r ? (e.u = +r[0], n + r[0].length) : -1;
}
function Qn(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.U = +r[0], n + r[0].length) : -1;
}
function $n(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.V = +r[0], n + r[0].length) : -1;
}
function er(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.W = +r[0], n + r[0].length) : -1;
}
function tr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 4));
	return r ? (e.y = +r[0], n + r[0].length) : -1;
}
function nr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.y = +r[0] + (+r[0] > 68 ? 1900 : 2e3), n + r[0].length) : -1;
}
function rr(e, t, n) {
	var r = /^(Z)|([+-]\d\d)(?::?(\d\d))?/.exec(t.slice(n, n + 6));
	return r ? (e.Z = r[1] ? 0 : -(r[2] + (r[3] || "00")), n + r[0].length) : -1;
}
function ir(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 1));
	return r ? (e.q = r[0] * 3 - 3, n + r[0].length) : -1;
}
function ar(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.m = r[0] - 1, n + r[0].length) : -1;
}
function or(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.d = +r[0], n + r[0].length) : -1;
}
function sr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 3));
	return r ? (e.m = 0, e.d = +r[0], n + r[0].length) : -1;
}
function cr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.H = +r[0], n + r[0].length) : -1;
}
function lr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.M = +r[0], n + r[0].length) : -1;
}
function ur(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 2));
	return r ? (e.S = +r[0], n + r[0].length) : -1;
}
function dr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 3));
	return r ? (e.L = +r[0], n + r[0].length) : -1;
}
function fr(e, t, n) {
	var r = Wn.exec(t.slice(n, n + 6));
	return r ? (e.L = Math.floor(r[0] / 1e3), n + r[0].length) : -1;
}
function pr(e, t, n) {
	var r = Gn.exec(t.slice(n, n + 1));
	return r ? n + r[0].length : -1;
}
function mr(e, t, n) {
	var r = Wn.exec(t.slice(n));
	return r ? (e.Q = +r[0], n + r[0].length) : -1;
}
function hr(e, t, n) {
	var r = Wn.exec(t.slice(n));
	return r ? (e.s = +r[0], n + r[0].length) : -1;
}
function gr(e, t) {
	return N(e.getDate(), t, 2);
}
function _r(e, t) {
	return N(e.getHours(), t, 2);
}
function vr(e, t) {
	return N(e.getHours() % 12 || 12, t, 2);
}
function yr(e, t) {
	return N(1 + Gt.count(pn(e), e), t, 3);
}
function br(e, t) {
	return N(e.getMilliseconds(), t, 3);
}
function xr(e, t) {
	return br(e, t) + "000";
}
function Sr(e, t) {
	return N(e.getMonth() + 1, t, 2);
}
function Cr(e, t) {
	return N(e.getMinutes(), t, 2);
}
function wr(e, t) {
	return N(e.getSeconds(), t, 2);
}
function Tr(e) {
	var t = e.getDay();
	return t === 0 ? 7 : t;
}
function Er(e, t) {
	return N(Yt.count(pn(e) - 1, e), t, 2);
}
function Dr(e) {
	var t = e.getDay();
	return t >= 4 || t === 0 ? $t(e) : $t.ceil(e);
}
function Or(e, t) {
	return e = Dr(e), N($t.count(pn(e), e) + (pn(e).getDay() === 4), t, 2);
}
function kr(e) {
	return e.getDay();
}
function Ar(e, t) {
	return N(Xt.count(pn(e) - 1, e), t, 2);
}
function jr(e, t) {
	return N(e.getFullYear() % 100, t, 2);
}
function Mr(e, t) {
	return e = Dr(e), N(e.getFullYear() % 100, t, 2);
}
function Nr(e, t) {
	return N(e.getFullYear() % 1e4, t, 4);
}
function Pr(e, t) {
	var n = e.getDay();
	return e = n >= 4 || n === 0 ? $t(e) : $t.ceil(e), N(e.getFullYear() % 1e4, t, 4);
}
function Fr(e) {
	var t = e.getTimezoneOffset();
	return (t > 0 ? "-" : (t *= -1, "+")) + N(t / 60 | 0, "0", 2) + N(t % 60, "0", 2);
}
function Ir(e, t) {
	return N(e.getUTCDate(), t, 2);
}
function Lr(e, t) {
	return N(e.getUTCHours(), t, 2);
}
function Rr(e, t) {
	return N(e.getUTCHours() % 12 || 12, t, 2);
}
function zr(e, t) {
	return N(1 + Kt.count(mn(e), e), t, 3);
}
function Br(e, t) {
	return N(e.getUTCMilliseconds(), t, 3);
}
function Vr(e, t) {
	return Br(e, t) + "000";
}
function Hr(e, t) {
	return N(e.getUTCMonth() + 1, t, 2);
}
function Ur(e, t) {
	return N(e.getUTCMinutes(), t, 2);
}
function Wr(e, t) {
	return N(e.getUTCSeconds(), t, 2);
}
function Gr(e) {
	var t = e.getUTCDay();
	return t === 0 ? 7 : t;
}
function Kr(e, t) {
	return N(rn.count(mn(e) - 1, e), t, 2);
}
function qr(e) {
	var t = e.getUTCDay();
	return t >= 4 || t === 0 ? cn(e) : cn.ceil(e);
}
function Jr(e, t) {
	return e = qr(e), N(cn.count(mn(e), e) + (mn(e).getUTCDay() === 4), t, 2);
}
function Yr(e) {
	return e.getUTCDay();
}
function Xr(e, t) {
	return N(an.count(mn(e) - 1, e), t, 2);
}
function Zr(e, t) {
	return N(e.getUTCFullYear() % 100, t, 2);
}
function Qr(e, t) {
	return e = qr(e), N(e.getUTCFullYear() % 100, t, 2);
}
function $r(e, t) {
	return N(e.getUTCFullYear() % 1e4, t, 4);
}
function ei(e, t) {
	var n = e.getUTCDay();
	return e = n >= 4 || n === 0 ? cn(e) : cn.ceil(e), N(e.getUTCFullYear() % 1e4, t, 4);
}
function ti() {
	return "+0000";
}
function ni() {
	return "%";
}
function ri(e) {
	return +e;
}
function ii(e) {
	return Math.floor(e / 1e3);
}
// ../../node_modules/d3-time-format/src/defaultLocale.js
var ai, oi, si, ci, li;
ui({
	dateTime: "%x, %X",
	date: "%-m/%-d/%Y",
	time: "%-I:%M:%S %p",
	periods: ["AM", "PM"],
	days: [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday"
	],
	shortDays: [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat"
	],
	months: [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	],
	shortMonths: [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec"
	]
});
function ui(e) {
	return ai = Hn(e), oi = ai.format, si = ai.parse, ci = ai.utcFormat, li = ai.utcParse, ai;
}
// ../../node_modules/d3-dispatch/src/dispatch.js
var di = { value: () => {} };
function fi() {
	for (var e = 0, t = arguments.length, n = {}, r; e < t; ++e) {
		if (!(r = arguments[e] + "") || r in n || /[\s.]/.test(r)) throw Error("illegal type: " + r);
		n[r] = [];
	}
	return new pi(n);
}
function pi(e) {
	this._ = e;
}
function mi(e, t) {
	return e.trim().split(/^|\s+/).map(function(e) {
		var n = "", r = e.indexOf(".");
		if (r >= 0 && (n = e.slice(r + 1), e = e.slice(0, r)), e && !t.hasOwnProperty(e)) throw Error("unknown type: " + e);
		return {
			type: e,
			name: n
		};
	});
}
pi.prototype = fi.prototype = {
	constructor: pi,
	on: function(e, t) {
		var n = this._, r = mi(e + "", n), i, a = -1, o = r.length;
		if (arguments.length < 2) {
			for (; ++a < o;) if ((i = (e = r[a]).type) && (i = hi(n[i], e.name))) return i;
		} else {
			if (t != null && typeof t != "function") throw Error("invalid callback: " + t);
			for (; ++a < o;) if (i = (e = r[a]).type) n[i] = gi(n[i], e.name, t);
			else if (t == null) for (i in n) n[i] = gi(n[i], e.name, null);
			return this;
		}
	},
	copy: function() {
		var e = {}, t = this._;
		for (var n in t) e[n] = t[n].slice();
		return new pi(e);
	},
	call: function(e, t) {
		if ((i = arguments.length - 2) > 0) for (var n = Array(i), r = 0, i, a; r < i; ++r) n[r] = arguments[r + 2];
		if (!this._.hasOwnProperty(e)) throw Error("unknown type: " + e);
		for (a = this._[e], r = 0, i = a.length; r < i; ++r) a[r].value.apply(t, n);
	},
	apply: function(e, t, n) {
		if (!this._.hasOwnProperty(e)) throw Error("unknown type: " + e);
		for (var r = this._[e], i = 0, a = r.length; i < a; ++i) r[i].value.apply(t, n);
	}
};
function hi(e, t) {
	for (var n = 0, r = e.length, i; n < r; ++n) if ((i = e[n]).name === t) return i.value;
}
function gi(e, t, n) {
	for (var r = 0, i = e.length; r < i; ++r) if (e[r].name === t) {
		e[r] = di, e = e.slice(0, r).concat(e.slice(r + 1));
		break;
	}
	return n != null && e.push({
		name: t,
		value: n
	}), e;
}
// ../../node_modules/d3-drag/src/noevent.js
var _i = { passive: !1 }, vi = {
	capture: !0,
	passive: !1
};
function yi(e) {
	e.stopImmediatePropagation();
}
function bi(e) {
	e.preventDefault(), e.stopImmediatePropagation();
}
// ../../node_modules/d3-drag/src/nodrag.js
function xi(e) {
	var t = e.document.documentElement, n = M(e).on("dragstart.drag", bi, vi);
	"onselectstart" in t ? n.on("selectstart.drag", bi, vi) : (t.__noselect = t.style.MozUserSelect, t.style.MozUserSelect = "none");
}
function Si(e, t) {
	var n = e.document.documentElement, r = M(e).on("dragstart.drag", null);
	t && (r.on("click.drag", bi, vi), setTimeout(function() {
		r.on("click.drag", null);
	}, 0)), "onselectstart" in n ? r.on("selectstart.drag", null) : (n.style.MozUserSelect = n.__noselect, delete n.__noselect);
}
// ../../node_modules/d3-drag/src/constant.js
var Ci = (e) => () => e;
// ../../node_modules/d3-drag/src/event.js
function wi(e, { sourceEvent: t, subject: n, target: r, identifier: i, active: a, x: o, y: s, dx: c, dy: l, dispatch: u }) {
	Object.defineProperties(this, {
		type: {
			value: e,
			enumerable: !0,
			configurable: !0
		},
		sourceEvent: {
			value: t,
			enumerable: !0,
			configurable: !0
		},
		subject: {
			value: n,
			enumerable: !0,
			configurable: !0
		},
		target: {
			value: r,
			enumerable: !0,
			configurable: !0
		},
		identifier: {
			value: i,
			enumerable: !0,
			configurable: !0
		},
		active: {
			value: a,
			enumerable: !0,
			configurable: !0
		},
		x: {
			value: o,
			enumerable: !0,
			configurable: !0
		},
		y: {
			value: s,
			enumerable: !0,
			configurable: !0
		},
		dx: {
			value: c,
			enumerable: !0,
			configurable: !0
		},
		dy: {
			value: l,
			enumerable: !0,
			configurable: !0
		},
		_: { value: u }
	});
}
wi.prototype.on = function() {
	var e = this._.on.apply(this._, arguments);
	return e === this._ ? this : e;
};
// ../../node_modules/d3-drag/src/drag.js
function Ti(e) {
	return !e.ctrlKey && !e.button;
}
function Ei() {
	return this.parentNode;
}
function Di(e, t) {
	return t ?? {
		x: e.x,
		y: e.y
	};
}
function Oi() {
	return navigator.maxTouchPoints || "ontouchstart" in this;
}
function ki() {
	var e = Ti, t = Ei, n = Di, r = Oi, i = {}, a = fi("start", "drag", "end"), o = 0, s, c, l, u, d = 0;
	function f(e) {
		e.on("mousedown.drag", p).filter(r).on("touchstart.drag", g).on("touchmove.drag", _, _i).on("touchend.drag touchcancel.drag", v).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
	}
	function p(n, r) {
		if (!u && e.call(this, n, r)) {
			var i = y(this, t.call(this, n, r), n, r, "mouse");
			i && (M(n.view).on("mousemove.drag", m, vi).on("mouseup.drag", h, vi), xi(n.view), yi(n), l = !1, s = n.clientX, c = n.clientY, i("start", n));
		}
	}
	function m(e) {
		if (bi(e), !l) {
			var t = e.clientX - s, n = e.clientY - c;
			l = t * t + n * n > d;
		}
		i.mouse("drag", e);
	}
	function h(e) {
		M(e.view).on("mousemove.drag mouseup.drag", null), Si(e.view, l), bi(e), i.mouse("end", e);
	}
	function g(n, r) {
		if (e.call(this, n, r)) for (var i = n.changedTouches, a = t.call(this, n, r), o = i.length, s = 0, c; s < o; ++s) (c = y(this, a, n, r, i[s].identifier, i[s])) && (yi(n), c("start", n, i[s]));
	}
	function _(e) {
		for (var t = e.changedTouches, n = t.length, r = 0, a; r < n; ++r) (a = i[t[r].identifier]) && (bi(e), a("drag", e, t[r]));
	}
	function v(e) {
		var t = e.changedTouches, n = t.length, r, a;
		for (u && clearTimeout(u), u = setTimeout(function() {
			u = null;
		}, 500), r = 0; r < n; ++r) (a = i[t[r].identifier]) && (yi(e), a("end", e, t[r]));
	}
	function y(e, t, r, s, c, l) {
		var u = a.copy(), d = Dt(l || r, t), p, m, h;
		if ((h = n.call(e, new wi("beforestart", {
			sourceEvent: r,
			target: f,
			identifier: c,
			active: o,
			x: d[0],
			y: d[1],
			dx: 0,
			dy: 0,
			dispatch: u
		}), s)) != null) return p = h.x - d[0] || 0, m = h.y - d[1] || 0, function n(r, a, l) {
			var g = d, _;
			switch (r) {
				case "start":
					i[c] = n, _ = o++;
					break;
				case "end": delete i[c], --o;
				case "drag": d = Dt(l || a, t), _ = o;
			}
			u.call(r, e, new wi(r, {
				sourceEvent: a,
				subject: h,
				target: f,
				identifier: c,
				active: _,
				x: d[0] + p,
				y: d[1] + m,
				dx: d[0] - g[0],
				dy: d[1] - g[1],
				dispatch: u
			}), s);
		};
	}
	return f.filter = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : Ci(!!t), f) : e;
	}, f.container = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : Ci(e), f) : t;
	}, f.subject = function(e) {
		return arguments.length ? (n = typeof e == "function" ? e : Ci(e), f) : n;
	}, f.touchable = function(e) {
		return arguments.length ? (r = typeof e == "function" ? e : Ci(!!e), f) : r;
	}, f.on = function() {
		var e = a.on.apply(a, arguments);
		return e === a ? f : e;
	}, f.clickDistance = function(e) {
		return arguments.length ? (d = (e = +e) * e, f) : Math.sqrt(d);
	}, f;
}
// ../../node_modules/d3-color/src/define.js
function Ai(e, t, n) {
	e.prototype = t.prototype = n, n.constructor = e;
}
function ji(e, t) {
	var n = Object.create(e.prototype);
	for (var r in t) n[r] = t[r];
	return n;
}
// ../../node_modules/d3-color/src/color.js
function Mi() {}
var Ni = .7, Pi = 1 / Ni, Fi = "\\s*([+-]?\\d+)\\s*", Ii = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*", Li = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*", Ri = /^#([0-9a-f]{3,8})$/, zi = RegExp(`^rgb\\(${Fi},${Fi},${Fi}\\)$`), Bi = RegExp(`^rgb\\(${Li},${Li},${Li}\\)$`), Vi = RegExp(`^rgba\\(${Fi},${Fi},${Fi},${Ii}\\)$`), Hi = RegExp(`^rgba\\(${Li},${Li},${Li},${Ii}\\)$`), Ui = RegExp(`^hsl\\(${Ii},${Li},${Li}\\)$`), Wi = RegExp(`^hsla\\(${Ii},${Li},${Li},${Ii}\\)$`), Gi = {
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
Ai(Mi, Xi, {
	copy(e) {
		return Object.assign(new this.constructor(), this, e);
	},
	displayable() {
		return this.rgb().displayable();
	},
	hex: Ki,
	formatHex: Ki,
	formatHex8: qi,
	formatHsl: Ji,
	formatRgb: Yi,
	toString: Yi
});
function Ki() {
	return this.rgb().formatHex();
}
function qi() {
	return this.rgb().formatHex8();
}
function Ji() {
	return la(this).formatHsl();
}
function Yi() {
	return this.rgb().formatRgb();
}
function Xi(e) {
	var t, n;
	return e = (e + "").trim().toLowerCase(), (t = Ri.exec(e)) ? (n = t[1].length, t = parseInt(t[1], 16), n === 6 ? Zi(t) : n === 3 ? new ta(t >> 8 & 15 | t >> 4 & 240, t >> 4 & 15 | t & 240, (t & 15) << 4 | t & 15, 1) : n === 8 ? Qi(t >> 24 & 255, t >> 16 & 255, t >> 8 & 255, (t & 255) / 255) : n === 4 ? Qi(t >> 12 & 15 | t >> 8 & 240, t >> 8 & 15 | t >> 4 & 240, t >> 4 & 15 | t & 240, ((t & 15) << 4 | t & 15) / 255) : null) : (t = zi.exec(e)) ? new ta(t[1], t[2], t[3], 1) : (t = Bi.exec(e)) ? new ta(t[1] * 255 / 100, t[2] * 255 / 100, t[3] * 255 / 100, 1) : (t = Vi.exec(e)) ? Qi(t[1], t[2], t[3], t[4]) : (t = Hi.exec(e)) ? Qi(t[1] * 255 / 100, t[2] * 255 / 100, t[3] * 255 / 100, t[4]) : (t = Ui.exec(e)) ? ca(t[1], t[2] / 100, t[3] / 100, 1) : (t = Wi.exec(e)) ? ca(t[1], t[2] / 100, t[3] / 100, t[4]) : Gi.hasOwnProperty(e) ? Zi(Gi[e]) : e === "transparent" ? new ta(NaN, NaN, NaN, 0) : null;
}
function Zi(e) {
	return new ta(e >> 16 & 255, e >> 8 & 255, e & 255, 1);
}
function Qi(e, t, n, r) {
	return r <= 0 && (e = t = n = NaN), new ta(e, t, n, r);
}
function $i(e) {
	return e instanceof Mi || (e = Xi(e)), e ? (e = e.rgb(), new ta(e.r, e.g, e.b, e.opacity)) : new ta();
}
function ea(e, t, n, r) {
	return arguments.length === 1 ? $i(e) : new ta(e, t, n, r ?? 1);
}
function ta(e, t, n, r) {
	this.r = +e, this.g = +t, this.b = +n, this.opacity = +r;
}
Ai(ta, ea, ji(Mi, {
	brighter(e) {
		return e = e == null ? Pi : Pi ** +e, new ta(this.r * e, this.g * e, this.b * e, this.opacity);
	},
	darker(e) {
		return e = e == null ? Ni : Ni ** +e, new ta(this.r * e, this.g * e, this.b * e, this.opacity);
	},
	rgb() {
		return this;
	},
	clamp() {
		return new ta(oa(this.r), oa(this.g), oa(this.b), aa(this.opacity));
	},
	displayable() {
		return -.5 <= this.r && this.r < 255.5 && -.5 <= this.g && this.g < 255.5 && -.5 <= this.b && this.b < 255.5 && 0 <= this.opacity && this.opacity <= 1;
	},
	hex: na,
	formatHex: na,
	formatHex8: ra,
	formatRgb: ia,
	toString: ia
}));
function na() {
	return `#${sa(this.r)}${sa(this.g)}${sa(this.b)}`;
}
function ra() {
	return `#${sa(this.r)}${sa(this.g)}${sa(this.b)}${sa((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}
function ia() {
	let e = aa(this.opacity);
	return `${e === 1 ? "rgb(" : "rgba("}${oa(this.r)}, ${oa(this.g)}, ${oa(this.b)}${e === 1 ? ")" : `, ${e})`}`;
}
function aa(e) {
	return isNaN(e) ? 1 : Math.max(0, Math.min(1, e));
}
function oa(e) {
	return Math.max(0, Math.min(255, Math.round(e) || 0));
}
function sa(e) {
	return e = oa(e), (e < 16 ? "0" : "") + e.toString(16);
}
function ca(e, t, n, r) {
	return r <= 0 ? e = t = n = NaN : n <= 0 || n >= 1 ? e = t = NaN : t <= 0 && (e = NaN), new da(e, t, n, r);
}
function la(e) {
	if (e instanceof da) return new da(e.h, e.s, e.l, e.opacity);
	if (e instanceof Mi || (e = Xi(e)), !e) return new da();
	if (e instanceof da) return e;
	e = e.rgb();
	var t = e.r / 255, n = e.g / 255, r = e.b / 255, i = Math.min(t, n, r), a = Math.max(t, n, r), o = NaN, s = a - i, c = (a + i) / 2;
	return s ? (o = t === a ? (n - r) / s + (n < r) * 6 : n === a ? (r - t) / s + 2 : (t - n) / s + 4, s /= c < .5 ? a + i : 2 - a - i, o *= 60) : s = c > 0 && c < 1 ? 0 : o, new da(o, s, c, e.opacity);
}
function ua(e, t, n, r) {
	return arguments.length === 1 ? la(e) : new da(e, t, n, r ?? 1);
}
function da(e, t, n, r) {
	this.h = +e, this.s = +t, this.l = +n, this.opacity = +r;
}
Ai(da, ua, ji(Mi, {
	brighter(e) {
		return e = e == null ? Pi : Pi ** +e, new da(this.h, this.s, this.l * e, this.opacity);
	},
	darker(e) {
		return e = e == null ? Ni : Ni ** +e, new da(this.h, this.s, this.l * e, this.opacity);
	},
	rgb() {
		var e = this.h % 360 + (this.h < 0) * 360, t = isNaN(e) || isNaN(this.s) ? 0 : this.s, n = this.l, r = n + (n < .5 ? n : 1 - n) * t, i = 2 * n - r;
		return new ta(ma(e >= 240 ? e - 240 : e + 120, i, r), ma(e, i, r), ma(e < 120 ? e + 240 : e - 120, i, r), this.opacity);
	},
	clamp() {
		return new da(fa(this.h), pa(this.s), pa(this.l), aa(this.opacity));
	},
	displayable() {
		return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && 0 <= this.l && this.l <= 1 && 0 <= this.opacity && this.opacity <= 1;
	},
	formatHsl() {
		let e = aa(this.opacity);
		return `${e === 1 ? "hsl(" : "hsla("}${fa(this.h)}, ${pa(this.s) * 100}%, ${pa(this.l) * 100}%${e === 1 ? ")" : `, ${e})`}`;
	}
}));
function fa(e) {
	return e = (e || 0) % 360, e < 0 ? e + 360 : e;
}
function pa(e) {
	return Math.max(0, Math.min(1, e || 0));
}
function ma(e, t, n) {
	return (e < 60 ? t + (n - t) * e / 60 : e < 180 ? n : e < 240 ? t + (n - t) * (240 - e) / 60 : t) * 255;
}
// ../../node_modules/d3-interpolate/src/constant.js
var ha = (e) => () => e;
// ../../node_modules/d3-interpolate/src/color.js
function ga(e, t) {
	return function(n) {
		return e + n * t;
	};
}
function _a(e, t, n) {
	return e **= +n, t = t ** +n - e, n = 1 / n, function(r) {
		return (e + r * t) ** +n;
	};
}
function va(e) {
	return (e = +e) == 1 ? ya : function(t, n) {
		return n - t ? _a(t, n, e) : ha(isNaN(t) ? n : t);
	};
}
function ya(e, t) {
	var n = t - e;
	return n ? ga(e, n) : ha(isNaN(e) ? t : e);
}
// ../../node_modules/d3-interpolate/src/rgb.js
var ba = (function e(t) {
	var n = va(t);
	function r(e, t) {
		var r = n((e = ea(e)).r, (t = ea(t)).r), i = n(e.g, t.g), a = n(e.b, t.b), o = ya(e.opacity, t.opacity);
		return function(t) {
			return e.r = r(t), e.g = i(t), e.b = a(t), e.opacity = o(t), e + "";
		};
	}
	return r.gamma = e, r;
})(1);
// ../../node_modules/d3-interpolate/src/numberArray.js
function xa(e, t) {
	t ||= [];
	var n = e ? Math.min(t.length, e.length) : 0, r = t.slice(), i;
	return function(a) {
		for (i = 0; i < n; ++i) r[i] = e[i] * (1 - a) + t[i] * a;
		return r;
	};
}
function Sa(e) {
	return ArrayBuffer.isView(e) && !(e instanceof DataView);
}
// ../../node_modules/d3-interpolate/src/array.js
function Ca(e, t) {
	for (var n = t ? t.length : 0, r = e ? Math.min(n, e.length) : 0, i = Array(r), a = Array(n), o = 0; o < r; ++o) i[o] = Ma(e[o], t[o]);
	for (; o < n; ++o) a[o] = t[o];
	return function(e) {
		for (o = 0; o < r; ++o) a[o] = i[o](e);
		return a;
	};
}
// ../../node_modules/d3-interpolate/src/date.js
function wa(e, t) {
	var n = /* @__PURE__ */ new Date();
	return e = +e, t = +t, function(r) {
		return n.setTime(e * (1 - r) + t * r), n;
	};
}
// ../../node_modules/d3-interpolate/src/number.js
function Ta(e, t) {
	return e = +e, t = +t, function(n) {
		return e * (1 - n) + t * n;
	};
}
// ../../node_modules/d3-interpolate/src/object.js
function Ea(e, t) {
	var n = {}, r = {}, i;
	for (i in typeof e == "object" && e || (e = {}), typeof t == "object" && t || (t = {}), t) i in e ? n[i] = Ma(e[i], t[i]) : r[i] = t[i];
	return function(e) {
		for (i in n) r[i] = n[i](e);
		return r;
	};
}
// ../../node_modules/d3-interpolate/src/string.js
var Da = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g, Oa = new RegExp(Da.source, "g");
function ka(e) {
	return function() {
		return e;
	};
}
function Aa(e) {
	return function(t) {
		return e(t) + "";
	};
}
function ja(e, t) {
	var n = Da.lastIndex = Oa.lastIndex = 0, r, i, a, o = -1, s = [], c = [];
	for (e += "", t += ""; (r = Da.exec(e)) && (i = Oa.exec(t));) (a = i.index) > n && (a = t.slice(n, a), s[o] ? s[o] += a : s[++o] = a), (r = r[0]) === (i = i[0]) ? s[o] ? s[o] += i : s[++o] = i : (s[++o] = null, c.push({
		i: o,
		x: Ta(r, i)
	})), n = Oa.lastIndex;
	return n < t.length && (a = t.slice(n), s[o] ? s[o] += a : s[++o] = a), s.length < 2 ? c[0] ? Aa(c[0].x) : ka(t) : (t = c.length, function(e) {
		for (var n = 0, r; n < t; ++n) s[(r = c[n]).i] = r.x(e);
		return s.join("");
	});
}
// ../../node_modules/d3-interpolate/src/value.js
function Ma(e, t) {
	var n = typeof t, r;
	return t == null || n === "boolean" ? ha(t) : (n === "number" ? Ta : n === "string" ? (r = Xi(t)) ? (t = r, ba) : ja : t instanceof Xi ? ba : t instanceof Date ? wa : Sa(t) ? xa : Array.isArray(t) ? Ca : typeof t.valueOf != "function" && typeof t.toString != "function" || isNaN(t) ? Ea : Ta)(e, t);
}
// ../../node_modules/d3-interpolate/src/round.js
function Na(e, t) {
	return e = +e, t = +t, function(n) {
		return Math.round(e * (1 - n) + t * n);
	};
}
// ../../node_modules/d3-interpolate/src/transform/decompose.js
var Pa = 180 / Math.PI, Fa = {
	translateX: 0,
	translateY: 0,
	rotate: 0,
	skewX: 0,
	scaleX: 1,
	scaleY: 1
};
function Ia(e, t, n, r, i, a) {
	var o, s, c;
	return (o = Math.sqrt(e * e + t * t)) && (e /= o, t /= o), (c = e * n + t * r) && (n -= e * c, r -= t * c), (s = Math.sqrt(n * n + r * r)) && (n /= s, r /= s, c /= s), e * r < t * n && (e = -e, t = -t, c = -c, o = -o), {
		translateX: i,
		translateY: a,
		rotate: Math.atan2(t, e) * Pa,
		skewX: Math.atan(c) * Pa,
		scaleX: o,
		scaleY: s
	};
}
// ../../node_modules/d3-interpolate/src/transform/parse.js
var La;
function Ra(e) {
	let t = new (typeof DOMMatrix == "function" ? DOMMatrix : WebKitCSSMatrix)(e + "");
	return t.isIdentity ? Fa : Ia(t.a, t.b, t.c, t.d, t.e, t.f);
}
function za(e) {
	return e == null || (La ||= document.createElementNS("http://www.w3.org/2000/svg", "g"), La.setAttribute("transform", e), !(e = La.transform.baseVal.consolidate())) ? Fa : (e = e.matrix, Ia(e.a, e.b, e.c, e.d, e.e, e.f));
}
// ../../node_modules/d3-interpolate/src/transform/index.js
function Ba(e, t, n, r) {
	function i(e) {
		return e.length ? e.pop() + " " : "";
	}
	function a(e, r, i, a, o, s) {
		if (e !== i || r !== a) {
			var c = o.push("translate(", null, t, null, n);
			s.push({
				i: c - 4,
				x: Ta(e, i)
			}, {
				i: c - 2,
				x: Ta(r, a)
			});
		} else (i || a) && o.push("translate(" + i + t + a + n);
	}
	function o(e, t, n, a) {
		e === t ? t && n.push(i(n) + "rotate(" + t + r) : (e - t > 180 ? t += 360 : t - e > 180 && (e += 360), a.push({
			i: n.push(i(n) + "rotate(", null, r) - 2,
			x: Ta(e, t)
		}));
	}
	function s(e, t, n, a) {
		e === t ? t && n.push(i(n) + "skewX(" + t + r) : a.push({
			i: n.push(i(n) + "skewX(", null, r) - 2,
			x: Ta(e, t)
		});
	}
	function c(e, t, n, r, a, o) {
		if (e !== n || t !== r) {
			var s = a.push(i(a) + "scale(", null, ",", null, ")");
			o.push({
				i: s - 4,
				x: Ta(e, n)
			}, {
				i: s - 2,
				x: Ta(t, r)
			});
		} else (n !== 1 || r !== 1) && a.push(i(a) + "scale(" + n + "," + r + ")");
	}
	return function(t, n) {
		var r = [], i = [];
		return t = e(t), n = e(n), a(t.translateX, t.translateY, n.translateX, n.translateY, r, i), o(t.rotate, n.rotate, r, i), s(t.skewX, n.skewX, r, i), c(t.scaleX, t.scaleY, n.scaleX, n.scaleY, r, i), t = n = null, function(e) {
			for (var t = -1, n = i.length, a; ++t < n;) r[(a = i[t]).i] = a.x(e);
			return r.join("");
		};
	};
}
var Va = Ba(Ra, "px, ", "px)", "deg)"), Ha = Ba(za, ", ", ")", ")"), Ua = 1e-12;
function Wa(e) {
	return ((e = Math.exp(e)) + 1 / e) / 2;
}
function Ga(e) {
	return ((e = Math.exp(e)) - 1 / e) / 2;
}
function Ka(e) {
	return ((e = Math.exp(2 * e)) - 1) / (e + 1);
}
var qa = (function e(t, n, r) {
	function i(e, i) {
		var a = e[0], o = e[1], s = e[2], c = i[0], l = i[1], u = i[2], d = c - a, f = l - o, p = d * d + f * f, m, h;
		if (p < Ua) h = Math.log(u / s) / t, m = function(e) {
			return [
				a + e * d,
				o + e * f,
				s * Math.exp(t * e * h)
			];
		};
		else {
			var g = Math.sqrt(p), _ = (u * u - s * s + r * p) / (2 * s * n * g), v = (u * u - s * s - r * p) / (2 * u * n * g), y = Math.log(Math.sqrt(_ * _ + 1) - _);
			h = (Math.log(Math.sqrt(v * v + 1) - v) - y) / t, m = function(e) {
				var r = e * h, i = Wa(y), c = s / (n * g) * (i * Ka(t * r + y) - Ga(y));
				return [
					a + c * d,
					o + c * f,
					s * i / Wa(t * r + y)
				];
			};
		}
		return m.duration = h * 1e3 * t / Math.SQRT2, m;
	}
	return i.rho = function(t) {
		var n = Math.max(.001, +t), r = n * n;
		return e(n, r, r * r);
	}, i;
})(Math.SQRT2, 2, 4), Ja = 0, Ya = 0, Xa = 0, Za = 1e3, Qa, $a, eo = 0, to = 0, no = 0, ro = typeof performance == "object" && performance.now ? performance : Date, io = typeof window == "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(e) {
	setTimeout(e, 17);
};
function ao() {
	return to ||= (io(oo), ro.now() + no);
}
function oo() {
	to = 0;
}
function so() {
	this._call = this._time = this._next = null;
}
so.prototype = co.prototype = {
	constructor: so,
	restart: function(e, t, n) {
		if (typeof e != "function") throw TypeError("callback is not a function");
		n = (n == null ? ao() : +n) + (t == null ? 0 : +t), !this._next && $a !== this && ($a ? $a._next = this : Qa = this, $a = this), this._call = e, this._time = n, mo();
	},
	stop: function() {
		this._call && (this._call = null, this._time = Infinity, mo());
	}
};
function co(e, t, n) {
	var r = new so();
	return r.restart(e, t, n), r;
}
function lo() {
	ao(), ++Ja;
	for (var e = Qa, t; e;) (t = to - e._time) >= 0 && e._call.call(void 0, t), e = e._next;
	--Ja;
}
function uo() {
	to = (eo = ro.now()) + no, Ja = Ya = 0;
	try {
		lo();
	} finally {
		Ja = 0, po(), to = 0;
	}
}
function fo() {
	var e = ro.now(), t = e - eo;
	t > Za && (no -= t, eo = e);
}
function po() {
	for (var e, t = Qa, n, r = Infinity; t;) t._call ? (r > t._time && (r = t._time), e = t, t = t._next) : (n = t._next, t._next = null, t = e ? e._next = n : Qa = n);
	$a = e, mo(r);
}
function mo(e) {
	Ja || (Ya &&= clearTimeout(Ya), e - to > 24 ? (e < Infinity && (Ya = setTimeout(uo, e - ro.now() - no)), Xa &&= clearInterval(Xa)) : (Xa ||= (eo = ro.now(), setInterval(fo, Za)), Ja = 1, io(uo)));
}
// ../../node_modules/d3-timer/src/timeout.js
function ho(e, t, n) {
	var r = new so();
	return t = t == null ? 0 : +t, r.restart((n) => {
		r.stop(), e(n + t);
	}, t, n), r;
}
// ../../node_modules/d3-transition/src/transition/schedule.js
var go = fi("start", "end", "cancel", "interrupt"), _o = [];
function vo(e, t, n, r, i, a) {
	var o = e.__transition;
	if (!o) e.__transition = {};
	else if (n in o) return;
	So(e, n, {
		name: t,
		index: r,
		group: i,
		on: go,
		tween: _o,
		time: a.time,
		delay: a.delay,
		duration: a.duration,
		ease: a.ease,
		timer: null,
		state: 0
	});
}
function yo(e, t) {
	var n = xo(e, t);
	if (n.state > 0) throw Error("too late; already scheduled");
	return n;
}
function bo(e, t) {
	var n = xo(e, t);
	if (n.state > 3) throw Error("too late; already running");
	return n;
}
function xo(e, t) {
	var n = e.__transition;
	if (!n || !(n = n[t])) throw Error("transition not found");
	return n;
}
function So(e, t, n) {
	var r = e.__transition, i;
	r[t] = n, n.timer = co(a, 0, n.time);
	function a(e) {
		n.state = 1, n.timer.restart(o, n.delay, n.time), n.delay <= e && o(e - n.delay);
	}
	function o(a) {
		var l, u, d, f;
		if (n.state !== 1) return c();
		for (l in r) if (f = r[l], f.name === n.name) {
			if (f.state === 3) return ho(o);
			f.state === 4 ? (f.state = 6, f.timer.stop(), f.on.call("interrupt", e, e.__data__, f.index, f.group), delete r[l]) : +l < t && (f.state = 6, f.timer.stop(), f.on.call("cancel", e, e.__data__, f.index, f.group), delete r[l]);
		}
		if (ho(function() {
			n.state === 3 && (n.state = 4, n.timer.restart(s, n.delay, n.time), s(a));
		}), n.state = 2, n.on.call("start", e, e.__data__, n.index, n.group), n.state === 2) {
			for (n.state = 3, i = Array(d = n.tween.length), l = 0, u = -1; l < d; ++l) (f = n.tween[l].value.call(e, e.__data__, n.index, n.group)) && (i[++u] = f);
			i.length = u + 1;
		}
	}
	function s(t) {
		for (var r = t < n.duration ? n.ease.call(null, t / n.duration) : (n.timer.restart(c), n.state = 5, 1), a = -1, o = i.length; ++a < o;) i[a].call(e, r);
		n.state === 5 && (n.on.call("end", e, e.__data__, n.index, n.group), c());
	}
	function c() {
		for (var i in n.state = 6, n.timer.stop(), delete r[t], r) return;
		delete e.__transition;
	}
}
// ../../node_modules/d3-transition/src/interrupt.js
function Co(e, t) {
	var n = e.__transition, r, i, a = !0, o;
	if (n) {
		for (o in t = t == null ? null : t + "", n) (r = n[o]).name === t ? (i = r.state > 2 && r.state < 5, r.state = 6, r.timer.stop(), r.on.call(i ? "interrupt" : "cancel", e, e.__data__, r.index, r.group), delete n[o]) : a = !1;
		a && delete e.__transition;
	}
}
// ../../node_modules/d3-transition/src/selection/interrupt.js
function wo(e) {
	return this.each(function() {
		Co(this, e);
	});
}
// ../../node_modules/d3-transition/src/transition/tween.js
function To(e, t) {
	var n, r;
	return function() {
		var i = bo(this, e), a = i.tween;
		if (a !== n) {
			r = n = a;
			for (var o = 0, s = r.length; o < s; ++o) if (r[o].name === t) {
				r = r.slice(), r.splice(o, 1);
				break;
			}
		}
		i.tween = r;
	};
}
function Eo(e, t, n) {
	var r, i;
	if (typeof n != "function") throw Error();
	return function() {
		var a = bo(this, e), o = a.tween;
		if (o !== r) {
			i = (r = o).slice();
			for (var s = {
				name: t,
				value: n
			}, c = 0, l = i.length; c < l; ++c) if (i[c].name === t) {
				i[c] = s;
				break;
			}
			c === l && i.push(s);
		}
		a.tween = i;
	};
}
function Do(e, t) {
	var n = this._id;
	if (e += "", arguments.length < 2) {
		for (var r = xo(this.node(), n).tween, i = 0, a = r.length, o; i < a; ++i) if ((o = r[i]).name === e) return o.value;
		return null;
	}
	return this.each((t == null ? To : Eo)(n, e, t));
}
function Oo(e, t, n) {
	var r = e._id;
	return e.each(function() {
		var e = bo(this, r);
		(e.value ||= {})[t] = n.apply(this, arguments);
	}), function(e) {
		return xo(e, r).value[t];
	};
}
// ../../node_modules/d3-transition/src/transition/interpolate.js
function ko(e, t) {
	var n;
	return (typeof t == "number" ? Ta : t instanceof Xi ? ba : (n = Xi(t)) ? (t = n, ba) : ja)(e, t);
}
// ../../node_modules/d3-transition/src/transition/attr.js
function Ao(e) {
	return function() {
		this.removeAttribute(e);
	};
}
function jo(e) {
	return function() {
		this.removeAttributeNS(e.space, e.local);
	};
}
function Mo(e, t, n) {
	var r, i = n + "", a;
	return function() {
		var o = this.getAttribute(e);
		return o === i ? null : o === r ? a : a = t(r = o, n);
	};
}
function No(e, t, n) {
	var r, i = n + "", a;
	return function() {
		var o = this.getAttributeNS(e.space, e.local);
		return o === i ? null : o === r ? a : a = t(r = o, n);
	};
}
function Po(e, t, n) {
	var r, i, a;
	return function() {
		var o, s = n(this), c;
		return s == null ? void this.removeAttribute(e) : (o = this.getAttribute(e), c = s + "", o === c ? null : o === r && c === i ? a : (i = c, a = t(r = o, s)));
	};
}
function Fo(e, t, n) {
	var r, i, a;
	return function() {
		var o, s = n(this), c;
		return s == null ? void this.removeAttributeNS(e.space, e.local) : (o = this.getAttributeNS(e.space, e.local), c = s + "", o === c ? null : o === r && c === i ? a : (i = c, a = t(r = o, s)));
	};
}
function Io(e, t) {
	var n = s(e), r = n === "transform" ? Ha : ko;
	return this.attrTween(e, typeof t == "function" ? (n.local ? Fo : Po)(n, r, Oo(this, "attr." + e, t)) : t == null ? (n.local ? jo : Ao)(n) : (n.local ? No : Mo)(n, r, t));
}
// ../../node_modules/d3-transition/src/transition/attrTween.js
function Lo(e, t) {
	return function(n) {
		this.setAttribute(e, t.call(this, n));
	};
}
function Ro(e, t) {
	return function(n) {
		this.setAttributeNS(e.space, e.local, t.call(this, n));
	};
}
function zo(e, t) {
	var n, r;
	function i() {
		var i = t.apply(this, arguments);
		return i !== r && (n = (r = i) && Ro(e, i)), n;
	}
	return i._value = t, i;
}
function Bo(e, t) {
	var n, r;
	function i() {
		var i = t.apply(this, arguments);
		return i !== r && (n = (r = i) && Lo(e, i)), n;
	}
	return i._value = t, i;
}
function Vo(e, t) {
	var n = "attr." + e;
	if (arguments.length < 2) return (n = this.tween(n)) && n._value;
	if (t == null) return this.tween(n, null);
	if (typeof t != "function") throw Error();
	var r = s(e);
	return this.tween(n, (r.local ? zo : Bo)(r, t));
}
// ../../node_modules/d3-transition/src/transition/delay.js
function Ho(e, t) {
	return function() {
		yo(this, e).delay = +t.apply(this, arguments);
	};
}
function Uo(e, t) {
	return t = +t, function() {
		yo(this, e).delay = t;
	};
}
function Wo(e) {
	var t = this._id;
	return arguments.length ? this.each((typeof e == "function" ? Ho : Uo)(t, e)) : xo(this.node(), t).delay;
}
// ../../node_modules/d3-transition/src/transition/duration.js
function Go(e, t) {
	return function() {
		bo(this, e).duration = +t.apply(this, arguments);
	};
}
function Ko(e, t) {
	return t = +t, function() {
		bo(this, e).duration = t;
	};
}
function qo(e) {
	var t = this._id;
	return arguments.length ? this.each((typeof e == "function" ? Go : Ko)(t, e)) : xo(this.node(), t).duration;
}
// ../../node_modules/d3-transition/src/transition/ease.js
function Jo(e, t) {
	if (typeof t != "function") throw Error();
	return function() {
		bo(this, e).ease = t;
	};
}
function Yo(e) {
	var t = this._id;
	return arguments.length ? this.each(Jo(t, e)) : xo(this.node(), t).ease;
}
// ../../node_modules/d3-transition/src/transition/easeVarying.js
function Xo(e, t) {
	return function() {
		var n = t.apply(this, arguments);
		if (typeof n != "function") throw Error();
		bo(this, e).ease = n;
	};
}
function Zo(e) {
	if (typeof e != "function") throw Error();
	return this.each(Xo(this._id, e));
}
// ../../node_modules/d3-transition/src/transition/filter.js
function Qo(e) {
	typeof e != "function" && (e = y(e));
	for (var t = this._groups, n = t.length, r = Array(n), i = 0; i < n; ++i) for (var a = t[i], o = a.length, s = r[i] = [], c, l = 0; l < o; ++l) (c = a[l]) && e.call(c, c.__data__, l, a) && s.push(c);
	return new Ds(r, this._parents, this._name, this._id);
}
// ../../node_modules/d3-transition/src/transition/merge.js
function $o(e) {
	if (e._id !== this._id) throw Error();
	for (var t = this._groups, n = e._groups, r = t.length, i = n.length, a = Math.min(r, i), o = Array(r), s = 0; s < a; ++s) for (var c = t[s], l = n[s], u = c.length, d = o[s] = Array(u), f, p = 0; p < u; ++p) (f = c[p] || l[p]) && (d[p] = f);
	for (; s < r; ++s) o[s] = t[s];
	return new Ds(o, this._parents, this._name, this._id);
}
// ../../node_modules/d3-transition/src/transition/on.js
function es(e) {
	return (e + "").trim().split(/^|\s+/).every(function(e) {
		var t = e.indexOf(".");
		return t >= 0 && (e = e.slice(0, t)), !e || e === "start";
	});
}
function ts(e, t, n) {
	var r, i, a = es(t) ? yo : bo;
	return function() {
		var o = a(this, e), s = o.on;
		s !== r && (i = (r = s).copy()).on(t, n), o.on = i;
	};
}
function ns(e, t) {
	var n = this._id;
	return arguments.length < 2 ? xo(this.node(), n).on.on(e) : this.each(ts(n, e, t));
}
// ../../node_modules/d3-transition/src/transition/remove.js
function rs(e) {
	return function() {
		var t = this.parentNode;
		for (var n in this.__transition) if (+n !== e) return;
		t && t.removeChild(this);
	};
}
function is() {
	return this.on("end.remove", rs(this._id));
}
// ../../node_modules/d3-transition/src/transition/select.js
function as(e) {
	var t = this._name, n = this._id;
	typeof e != "function" && (e = f(e));
	for (var r = this._groups, i = r.length, a = Array(i), o = 0; o < i; ++o) for (var s = r[o], c = s.length, l = a[o] = Array(c), u, d, p = 0; p < c; ++p) (u = s[p]) && (d = e.call(u, u.__data__, p, s)) && ("__data__" in u && (d.__data__ = u.__data__), l[p] = d, vo(l[p], t, n, p, l, xo(u, n)));
	return new Ds(a, this._parents, t, n);
}
// ../../node_modules/d3-transition/src/transition/selectAll.js
function os(e) {
	var t = this._name, n = this._id;
	typeof e != "function" && (e = g(e));
	for (var r = this._groups, i = r.length, a = [], o = [], s = 0; s < i; ++s) for (var c = r[s], l = c.length, u, d = 0; d < l; ++d) if (u = c[d]) {
		for (var f = e.call(u, u.__data__, d, c), p, m = xo(u, n), h = 0, _ = f.length; h < _; ++h) (p = f[h]) && vo(p, t, n, h, f, m);
		a.push(f), o.push(u);
	}
	return new Ds(a, o, t, n);
}
// ../../node_modules/d3-transition/src/transition/selection.js
var ss = wt.prototype.constructor;
function cs() {
	return new ss(this._groups, this._parents);
}
// ../../node_modules/d3-transition/src/transition/style.js
function ls(e, t) {
	var n, r, i;
	return function() {
		var a = je(this, e), o = (this.style.removeProperty(e), je(this, e));
		return a === o ? null : a === n && o === r ? i : i = t(n = a, r = o);
	};
}
function us(e) {
	return function() {
		this.style.removeProperty(e);
	};
}
function ds(e, t, n) {
	var r, i = n + "", a;
	return function() {
		var o = je(this, e);
		return o === i ? null : o === r ? a : a = t(r = o, n);
	};
}
function fs(e, t, n) {
	var r, i, a;
	return function() {
		var o = je(this, e), s = n(this), c = s + "";
		return s ?? (c = s = (this.style.removeProperty(e), je(this, e))), o === c ? null : o === r && c === i ? a : (i = c, a = t(r = o, s));
	};
}
function ps(e, t) {
	var n, r, i, a = "style." + t, o = "end." + a, s;
	return function() {
		var c = bo(this, e), l = c.on, u = c.value[a] == null ? s ||= us(t) : void 0;
		(l !== n || i !== u) && (r = (n = l).copy()).on(o, i = u), c.on = r;
	};
}
function ms(e, t, n) {
	var r = (e += "") == "transform" ? Va : ko;
	return t == null ? this.styleTween(e, ls(e, r)).on("end.style." + e, us(e)) : typeof t == "function" ? this.styleTween(e, fs(e, r, Oo(this, "style." + e, t))).each(ps(this._id, e)) : this.styleTween(e, ds(e, r, t), n).on("end.style." + e, null);
}
// ../../node_modules/d3-transition/src/transition/styleTween.js
function hs(e, t, n) {
	return function(r) {
		this.style.setProperty(e, t.call(this, r), n);
	};
}
function gs(e, t, n) {
	var r, i;
	function a() {
		var a = t.apply(this, arguments);
		return a !== i && (r = (i = a) && hs(e, a, n)), r;
	}
	return a._value = t, a;
}
function _s(e, t, n) {
	var r = "style." + (e += "");
	if (arguments.length < 2) return (r = this.tween(r)) && r._value;
	if (t == null) return this.tween(r, null);
	if (typeof t != "function") throw Error();
	return this.tween(r, gs(e, t, n ?? ""));
}
// ../../node_modules/d3-transition/src/transition/text.js
function vs(e) {
	return function() {
		this.textContent = e;
	};
}
function ys(e) {
	return function() {
		var t = e(this);
		this.textContent = t ?? "";
	};
}
function bs(e) {
	return this.tween("text", typeof e == "function" ? ys(Oo(this, "text", e)) : vs(e == null ? "" : e + ""));
}
// ../../node_modules/d3-transition/src/transition/textTween.js
function xs(e) {
	return function(t) {
		this.textContent = e.call(this, t);
	};
}
function Ss(e) {
	var t, n;
	function r() {
		var r = e.apply(this, arguments);
		return r !== n && (t = (n = r) && xs(r)), t;
	}
	return r._value = e, r;
}
function Cs(e) {
	var t = "text";
	if (arguments.length < 1) return (t = this.tween(t)) && t._value;
	if (e == null) return this.tween(t, null);
	if (typeof e != "function") throw Error();
	return this.tween(t, Ss(e));
}
// ../../node_modules/d3-transition/src/transition/transition.js
function ws() {
	for (var e = this._name, t = this._id, n = ks(), r = this._groups, i = r.length, a = 0; a < i; ++a) for (var o = r[a], s = o.length, c, l = 0; l < s; ++l) if (c = o[l]) {
		var u = xo(c, t);
		vo(c, e, n, l, o, {
			time: u.time + u.delay + u.duration,
			delay: 0,
			duration: u.duration,
			ease: u.ease
		});
	}
	return new Ds(r, this._parents, e, n);
}
// ../../node_modules/d3-transition/src/transition/end.js
function Ts() {
	var e, t, n = this, r = n._id, i = n.size();
	return new Promise(function(a, o) {
		var s = { value: o }, c = { value: function() {
			--i === 0 && a();
		} };
		n.each(function() {
			var n = bo(this, r), i = n.on;
			i !== e && (t = (e = i).copy(), t._.cancel.push(s), t._.interrupt.push(s), t._.end.push(c)), n.on = t;
		}), i === 0 && a();
	});
}
// ../../node_modules/d3-transition/src/transition/index.js
var Es = 0;
function Ds(e, t, n, r) {
	this._groups = e, this._parents = t, this._name = n, this._id = r;
}
function Os(e) {
	return wt().transition(e);
}
function ks() {
	return ++Es;
}
var As = wt.prototype;
Ds.prototype = Os.prototype = {
	constructor: Ds,
	select: as,
	selectAll: os,
	selectChild: As.selectChild,
	selectChildren: As.selectChildren,
	filter: Qo,
	merge: $o,
	selection: cs,
	transition: ws,
	call: As.call,
	nodes: As.nodes,
	node: As.node,
	size: As.size,
	empty: As.empty,
	each: As.each,
	on: ns,
	attr: Io,
	attrTween: Vo,
	style: ms,
	styleTween: _s,
	text: bs,
	textTween: Cs,
	remove: is,
	tween: Do,
	delay: Wo,
	duration: qo,
	ease: Yo,
	easeVarying: Zo,
	end: Ts,
	[Symbol.iterator]: As[Symbol.iterator]
};
// ../../node_modules/d3-ease/src/linear.js
var js = (e) => +e;
// ../../node_modules/d3-ease/src/cubic.js
function Ms(e) {
	return ((e *= 2) <= 1 ? e * e * e : (e -= 2) * e * e + 2) / 2;
}
// ../../node_modules/d3-transition/src/selection/transition.js
var Ns = {
	time: null,
	delay: 0,
	duration: 250,
	ease: Ms
};
function Ps(e, t) {
	for (var n; !(n = e.__transition) || !(n = n[t]);) if (!(e = e.parentNode)) throw Error(`transition ${t} not found`);
	return n;
}
function Fs(e) {
	var t, n;
	e instanceof Ds ? (t = e._id, e = e._name) : (t = ks(), (n = Ns).time = ao(), e = e == null ? null : e + "");
	for (var r = this._groups, i = r.length, a = 0; a < i; ++a) for (var o = r[a], s = o.length, c, l = 0; l < s; ++l) (c = o[l]) && vo(c, e, t, l, o, n || Ps(c, t));
	return new Ds(r, this._parents, e, t);
}
wt.prototype.interrupt = wo, wt.prototype.transition = Fs;
// ../../node_modules/d3-brush/src/constant.js
var Is = (e) => () => e;
// ../../node_modules/d3-brush/src/event.js
function Ls(e, { sourceEvent: t, target: n, selection: r, mode: i, dispatch: a }) {
	Object.defineProperties(this, {
		type: {
			value: e,
			enumerable: !0,
			configurable: !0
		},
		sourceEvent: {
			value: t,
			enumerable: !0,
			configurable: !0
		},
		target: {
			value: n,
			enumerable: !0,
			configurable: !0
		},
		selection: {
			value: r,
			enumerable: !0,
			configurable: !0
		},
		mode: {
			value: i,
			enumerable: !0,
			configurable: !0
		},
		_: { value: a }
	});
}
// ../../node_modules/d3-brush/src/noevent.js
function Rs(e) {
	e.stopImmediatePropagation();
}
function zs(e) {
	e.preventDefault(), e.stopImmediatePropagation();
}
// ../../node_modules/d3-brush/src/brush.js
var Bs = { name: "drag" }, Vs = { name: "space" }, Hs = { name: "handle" }, Us = { name: "center" }, { abs: Ws, max: Gs, min: Ks } = Math;
function qs(e) {
	return [+e[0], +e[1]];
}
function Js(e) {
	return [qs(e[0]), qs(e[1])];
}
var Ys = {
	name: "x",
	handles: ["w", "e"].map(nc),
	input: function(e, t) {
		return e == null ? null : [[+e[0], t[0][1]], [+e[1], t[1][1]]];
	},
	output: function(e) {
		return e && [e[0][0], e[1][0]];
	}
}, Xs = {
	name: "y",
	handles: ["n", "s"].map(nc),
	input: function(e, t) {
		return e == null ? null : [[t[0][0], +e[0]], [t[1][0], +e[1]]];
	},
	output: function(e) {
		return e && [e[0][1], e[1][1]];
	}
};
[
	"n",
	"w",
	"e",
	"s",
	"nw",
	"ne",
	"sw",
	"se"
].map(nc);
var Zs = {
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
}, Qs = {
	e: "w",
	w: "e",
	nw: "ne",
	ne: "nw",
	se: "sw",
	sw: "se"
}, $s = {
	n: "s",
	s: "n",
	nw: "sw",
	ne: "se",
	se: "ne",
	sw: "nw"
}, ec = {
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
}, tc = {
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
function nc(e) {
	return { type: e };
}
function rc(e) {
	return !e.ctrlKey && !e.button;
}
function ic() {
	var e = this.ownerSVGElement || this;
	return e.hasAttribute("viewBox") ? (e = e.viewBox.baseVal, [[e.x, e.y], [e.x + e.width, e.y + e.height]]) : [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]];
}
function ac() {
	return navigator.maxTouchPoints || "ontouchstart" in this;
}
function oc(e) {
	for (; !e.__brush;) if (!(e = e.parentNode)) return;
	return e.__brush;
}
function sc(e) {
	return e[0][0] === e[1][0] || e[0][1] === e[1][1];
}
function cc(e) {
	var t = e.__brush;
	return t ? t.dim.output(t.selection) : null;
}
function lc() {
	return dc(Ys);
}
function uc() {
	return dc(Xs);
}
function dc(e) {
	var t = ic, n = rc, r = ac, i = !0, a = fi("start", "brush", "end"), o = 6, s;
	function c(t) {
		var n = t.property("__brush", h).selectAll(".overlay").data([nc("overlay")]);
		n.enter().append("rect").attr("class", "overlay").attr("pointer-events", "all").attr("cursor", Zs.overlay).merge(n).each(function() {
			var e = oc(this).extent;
			M(this).attr("x", e[0][0]).attr("y", e[0][1]).attr("width", e[1][0] - e[0][0]).attr("height", e[1][1] - e[0][1]);
		}), t.selectAll(".selection").data([nc("selection")]).enter().append("rect").attr("class", "selection").attr("cursor", Zs.selection).attr("fill", "#777").attr("fill-opacity", .3).attr("stroke", "#fff").attr("shape-rendering", "crispEdges");
		var i = t.selectAll(".handle").data(e.handles, function(e) {
			return e.type;
		});
		i.exit().remove(), i.enter().append("rect").attr("class", function(e) {
			return "handle handle--" + e.type;
		}).attr("cursor", function(e) {
			return Zs[e.type];
		}), t.each(l).attr("fill", "none").attr("pointer-events", "all").on("mousedown.brush", f).filter(r).on("touchstart.brush", f).on("touchmove.brush", p).on("touchend.brush touchcancel.brush", m).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
	}
	c.move = function(t, n, r) {
		t.tween ? t.on("start.brush", function(e) {
			u(this, arguments).beforestart().start(e);
		}).on("interrupt.brush end.brush", function(e) {
			u(this, arguments).end(e);
		}).tween("brush", function() {
			var t = this, r = t.__brush, i = u(t, arguments), a = r.selection, o = e.input(typeof n == "function" ? n.apply(this, arguments) : n, r.extent), s = Ma(a, o);
			function c(e) {
				r.selection = e === 1 && o === null ? null : s(e), l.call(t), i.brush();
			}
			return a !== null && o !== null ? c : c(1);
		}) : t.each(function() {
			var t = this, i = arguments, a = t.__brush, o = e.input(typeof n == "function" ? n.apply(t, i) : n, a.extent), s = u(t, i).beforestart();
			Co(t), a.selection = o === null ? null : o, l.call(t), s.start(r).brush(r).end(r);
		});
	}, c.clear = function(e, t) {
		c.move(e, null, t);
	};
	function l() {
		var e = M(this), t = oc(this).selection;
		t ? (e.selectAll(".selection").style("display", null).attr("x", t[0][0]).attr("y", t[0][1]).attr("width", t[1][0] - t[0][0]).attr("height", t[1][1] - t[0][1]), e.selectAll(".handle").style("display", null).attr("x", function(e) {
			return e.type[e.type.length - 1] === "e" ? t[1][0] - o / 2 : t[0][0] - o / 2;
		}).attr("y", function(e) {
			return e.type[0] === "s" ? t[1][1] - o / 2 : t[0][1] - o / 2;
		}).attr("width", function(e) {
			return e.type === "n" || e.type === "s" ? t[1][0] - t[0][0] + o : o;
		}).attr("height", function(e) {
			return e.type === "e" || e.type === "w" ? t[1][1] - t[0][1] + o : o;
		})) : e.selectAll(".selection,.handle").style("display", "none").attr("x", null).attr("y", null).attr("width", null).attr("height", null);
	}
	function u(e, t, n) {
		var r = e.__brush.emitter;
		return r && (!n || !r.clean) ? r : new d(e, t, n);
	}
	function d(e, t, n) {
		this.that = e, this.args = t, this.state = e.__brush, this.active = 0, this.clean = n;
	}
	d.prototype = {
		beforestart: function() {
			return ++this.active === 1 && (this.state.emitter = this, this.starting = !0), this;
		},
		start: function(e, t) {
			return this.starting ? (this.starting = !1, this.emit("start", e, t)) : this.emit("brush", e), this;
		},
		brush: function(e, t) {
			return this.emit("brush", e, t), this;
		},
		end: function(e, t) {
			return --this.active === 0 && (delete this.state.emitter, this.emit("end", e, t)), this;
		},
		emit: function(t, n, r) {
			var i = M(this.that).datum();
			a.call(t, this.that, new Ls(t, {
				sourceEvent: n,
				target: c,
				selection: e.output(this.state.selection),
				mode: r,
				dispatch: a
			}), i);
		}
	};
	function f(t) {
		if (s && !t.touches || !n.apply(this, arguments)) return;
		var r = this, a = t.target.__data__.type, o = (i && t.metaKey ? a = "overlay" : a) === "selection" ? Bs : i && t.altKey ? Us : Hs, c = e === Xs ? null : ec[a], d = e === Ys ? null : tc[a], f = oc(r), p = f.extent, m = f.selection, h = p[0][0], g, _, v = p[0][1], y, b, x = p[1][0], S, C, w = p[1][1], T, E, D = 0, O = 0, k, ee = c && d && i && t.shiftKey, A, te, j = Array.from(t.touches || [t], (e) => {
			let t = e.identifier;
			return e = Dt(e, r), e.point0 = e.slice(), e.identifier = t, e;
		});
		Co(r);
		var ne = u(r, arguments, !0).beforestart();
		if (a === "overlay") {
			m && (k = !0);
			let n = [j[0], j[1] || j[0]];
			f.selection = m = [[g = e === Xs ? h : Ks(n[0][0], n[1][0]), y = e === Ys ? v : Ks(n[0][1], n[1][1])], [S = e === Xs ? x : Gs(n[0][0], n[1][0]), T = e === Ys ? w : Gs(n[0][1], n[1][1])]], j.length > 1 && se(t);
		} else g = m[0][0], y = m[0][1], S = m[1][0], T = m[1][1];
		_ = g, b = y, C = S, E = T;
		var re = M(r).attr("pointer-events", "none"), ie = re.selectAll(".overlay").attr("cursor", Zs[a]);
		if (t.touches) ne.moved = oe, ne.ended = ce;
		else {
			var ae = M(t.view).on("mousemove.brush", oe, !0).on("mouseup.brush", ce, !0);
			i && ae.on("keydown.brush", le, !0).on("keyup.brush", ue, !0), xi(t.view);
		}
		l.call(r), ne.start(t, o.name);
		function oe(e) {
			for (let t of e.changedTouches || [e]) for (let e of j) e.identifier === t.identifier && (e.cur = Dt(t, r));
			if (ee && !A && !te && j.length === 1) {
				let e = j[0];
				Ws(e.cur[0] - e[0]) > Ws(e.cur[1] - e[1]) ? te = !0 : A = !0;
			}
			for (let e of j) e.cur && (e[0] = e.cur[0], e[1] = e.cur[1]);
			k = !0, zs(e), se(e);
		}
		function se(e) {
			let t = j[0], n = t.point0;
			var i;
			switch (D = t[0] - n[0], O = t[1] - n[1], o) {
				case Vs:
				case Bs:
					c && (D = Gs(h - g, Ks(x - S, D)), _ = g + D, C = S + D), d && (O = Gs(v - y, Ks(w - T, O)), b = y + O, E = T + O);
					break;
				case Hs:
					j[1] ? (c &&= (_ = Gs(h, Ks(x, j[0][0])), C = Gs(h, Ks(x, j[1][0])), 1), d &&= (b = Gs(v, Ks(w, j[0][1])), E = Gs(v, Ks(w, j[1][1])), 1)) : (c < 0 ? (D = Gs(h - g, Ks(x - g, D)), _ = g + D, C = S) : c > 0 && (D = Gs(h - S, Ks(x - S, D)), _ = g, C = S + D), d < 0 ? (O = Gs(v - y, Ks(w - y, O)), b = y + O, E = T) : d > 0 && (O = Gs(v - T, Ks(w - T, O)), b = y, E = T + O));
					break;
				case Us: c && (_ = Gs(h, Ks(x, g - D * c)), C = Gs(h, Ks(x, S + D * c))), d && (b = Gs(v, Ks(w, y - O * d)), E = Gs(v, Ks(w, T + O * d)));
			}
			C < _ && (c *= -1, i = g, g = S, S = i, i = _, _ = C, C = i, a in Qs && ie.attr("cursor", Zs[a = Qs[a]])), E < b && (d *= -1, i = y, y = T, T = i, i = b, b = E, E = i, a in $s && ie.attr("cursor", Zs[a = $s[a]])), f.selection && (m = f.selection), A && (_ = m[0][0], C = m[1][0]), te && (b = m[0][1], E = m[1][1]), (m[0][0] !== _ || m[0][1] !== b || m[1][0] !== C || m[1][1] !== E) && (f.selection = [[_, b], [C, E]], l.call(r), ne.brush(e, o.name));
		}
		function ce(e) {
			if (Rs(e), e.touches) {
				if (e.touches.length) return;
				s && clearTimeout(s), s = setTimeout(function() {
					s = null;
				}, 500);
			} else Si(e.view, k), ae.on("keydown.brush keyup.brush mousemove.brush mouseup.brush", null);
			re.attr("pointer-events", "all"), ie.attr("cursor", Zs.overlay), f.selection && (m = f.selection), sc(m) && (f.selection = null, l.call(r)), ne.end(e, o.name);
		}
		function le(e) {
			switch (e.keyCode) {
				case 16:
					ee = c && d;
					break;
				case 18:
					o === Hs && (c && (S = C - D * c, g = _ + D * c), d && (T = E - O * d, y = b + O * d), o = Us, se(e));
					break;
				case 32:
					(o === Hs || o === Us) && (c < 0 ? S = C - D : c > 0 && (g = _ - D), d < 0 ? T = E - O : d > 0 && (y = b - O), o = Vs, ie.attr("cursor", Zs.selection), se(e));
					break;
				default: return;
			}
			zs(e);
		}
		function ue(e) {
			switch (e.keyCode) {
				case 16:
					ee && (A = te = ee = !1, se(e));
					break;
				case 18:
					o === Us && (c < 0 ? S = C : c > 0 && (g = _), d < 0 ? T = E : d > 0 && (y = b), o = Hs, se(e));
					break;
				case 32:
					o === Vs && (e.altKey ? (c && (S = C - D * c, g = _ + D * c), d && (T = E - O * d, y = b + O * d), o = Us) : (c < 0 ? S = C : c > 0 && (g = _), d < 0 ? T = E : d > 0 && (y = b), o = Hs), ie.attr("cursor", Zs[a]), se(e));
					break;
				default: return;
			}
			zs(e);
		}
	}
	function p(e) {
		u(this, arguments).moved(e);
	}
	function m(e) {
		u(this, arguments).ended(e);
	}
	function h() {
		var n = this.__brush || { selection: null };
		return n.extent = Js(t.apply(this, arguments)), n.dim = e, n;
	}
	return c.extent = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : Is(Js(e)), c) : t;
	}, c.filter = function(e) {
		return arguments.length ? (n = typeof e == "function" ? e : Is(!!e), c) : n;
	}, c.touchable = function(e) {
		return arguments.length ? (r = typeof e == "function" ? e : Is(!!e), c) : r;
	}, c.handleSize = function(e) {
		return arguments.length ? (o = +e, c) : o;
	}, c.keyModifiers = function(e) {
		return arguments.length ? (i = !!e, c) : i;
	}, c.on = function() {
		var e = a.on.apply(a, arguments);
		return e === a ? c : e;
	}, c;
}
// ../../node_modules/d3-dsv/src/dsv.js
var fc = {}, pc = {}, mc = 34, hc = 10, gc = 13;
function _c(e) {
	return Function("d", "return {" + e.map(function(e, t) {
		return JSON.stringify(e) + ": d[" + t + "] || \"\"";
	}).join(",") + "}");
}
function vc(e, t) {
	var n = _c(e);
	return function(r, i) {
		return t(n(r), i, e);
	};
}
function yc(e) {
	var t = Object.create(null), n = [];
	return e.forEach(function(e) {
		for (var r in e) r in t || n.push(t[r] = r);
	}), n;
}
function bc(e, t) {
	var n = e + "", r = n.length;
	return r < t ? Array(t - r + 1).join(0) + n : n;
}
function xc(e) {
	return e < 0 ? "-" + bc(-e, 6) : e > 9999 ? "+" + bc(e, 6) : bc(e, 4);
}
function Sc(e) {
	var t = e.getUTCHours(), n = e.getUTCMinutes(), r = e.getUTCSeconds(), i = e.getUTCMilliseconds();
	return isNaN(e) ? "Invalid Date" : xc(e.getUTCFullYear(), 4) + "-" + bc(e.getUTCMonth() + 1, 2) + "-" + bc(e.getUTCDate(), 2) + (i ? "T" + bc(t, 2) + ":" + bc(n, 2) + ":" + bc(r, 2) + "." + bc(i, 3) + "Z" : r ? "T" + bc(t, 2) + ":" + bc(n, 2) + ":" + bc(r, 2) + "Z" : n || t ? "T" + bc(t, 2) + ":" + bc(n, 2) + "Z" : "");
}
function Cc(e) {
	var t = RegExp("[\"" + e + "\n\r]"), n = e.charCodeAt(0);
	function r(e, t) {
		var n, r, a = i(e, function(e, i) {
			if (n) return n(e, i - 1);
			r = e, n = t ? vc(e, t) : _c(e);
		});
		return a.columns = r || [], a;
	}
	function i(e, t) {
		var r = [], i = e.length, a = 0, o = 0, s, c = i <= 0, l = !1;
		e.charCodeAt(i - 1) === hc && --i, e.charCodeAt(i - 1) === gc && --i;
		function u() {
			if (c) return pc;
			if (l) return l = !1, fc;
			var t, r = a, o;
			if (e.charCodeAt(r) === mc) {
				for (; a++ < i && e.charCodeAt(a) !== mc || e.charCodeAt(++a) === mc;);
				return (t = a) >= i ? c = !0 : (o = e.charCodeAt(a++)) === hc ? l = !0 : o === gc && (l = !0, e.charCodeAt(a) === hc && ++a), e.slice(r + 1, t - 1).replace(/""/g, "\"");
			}
			for (; a < i;) {
				if ((o = e.charCodeAt(t = a++)) === hc) l = !0;
				else if (o === gc) l = !0, e.charCodeAt(a) === hc && ++a;
				else if (o !== n) continue;
				return e.slice(r, t);
			}
			return c = !0, e.slice(r, i);
		}
		for (; (s = u()) !== pc;) {
			for (var d = []; s !== fc && s !== pc;) d.push(s), s = u();
			t && (d = t(d, o++)) == null || r.push(d);
		}
		return r;
	}
	function a(t, n) {
		return t.map(function(t) {
			return n.map(function(e) {
				return u(t[e]);
			}).join(e);
		});
	}
	function o(t, n) {
		return n ??= yc(t), [n.map(u).join(e)].concat(a(t, n)).join("\n");
	}
	function s(e, t) {
		return t ??= yc(e), a(e, t).join("\n");
	}
	function c(e) {
		return e.map(l).join("\n");
	}
	function l(t) {
		return t.map(u).join(e);
	}
	function u(e) {
		return e == null ? "" : e instanceof Date ? Sc(e) : t.test(e += "") ? "\"" + e.replace(/"/g, "\"\"") + "\"" : e;
	}
	return {
		parse: r,
		parseRows: i,
		format: o,
		formatBody: s,
		formatRows: c,
		formatRow: l,
		formatValue: u
	};
}
// ../../node_modules/d3-dsv/src/csv.js
var wc = Cc(","), Tc = wc.parse, Ec = wc.parseRows;
wc.format, wc.formatBody, wc.formatRows, wc.formatRow, wc.formatValue;
// ../../node_modules/d3-dsv/src/tsv.js
var Dc = Cc("	"), Oc = Dc.parse, kc = Dc.parseRows;
Dc.format, Dc.formatBody, Dc.formatRows, Dc.formatRow, Dc.formatValue;
// ../../node_modules/d3-scale/src/init.js
function Ac(e, t) {
	switch (arguments.length) {
		case 0: break;
		case 1:
			this.range(e);
			break;
		default: this.range(t).domain(e);
	}
	return this;
}
// ../../node_modules/d3-scale/src/ordinal.js
var jc = Symbol("implicit");
function Mc() {
	var e = new Sn(), t = [], n = [], r = jc;
	function i(i) {
		let a = e.get(i);
		if (a === void 0) {
			if (r !== jc) return r;
			e.set(i, a = t.push(i) - 1);
		}
		return n[a % n.length];
	}
	return i.domain = function(n) {
		if (!arguments.length) return t.slice();
		t = [], e = new Sn();
		for (let r of n) e.has(r) || e.set(r, t.push(r) - 1);
		return i;
	}, i.range = function(e) {
		return arguments.length ? (n = Array.from(e), i) : n.slice();
	}, i.unknown = function(e) {
		return arguments.length ? (r = e, i) : r;
	}, i.copy = function() {
		return Mc(t, n).unknown(r);
	}, Ac.apply(i, arguments), i;
}
// ../../node_modules/d3-scale/src/constant.js
function Nc(e) {
	return function() {
		return e;
	};
}
// ../../node_modules/d3-scale/src/number.js
function Pc(e) {
	return +e;
}
// ../../node_modules/d3-scale/src/continuous.js
var Fc = [0, 1];
function Ic(e) {
	return e;
}
function Lc(e, t) {
	return (t -= e = +e) ? function(n) {
		return (n - e) / t;
	} : Nc(isNaN(t) ? NaN : .5);
}
function Rc(e, t) {
	var n;
	return e > t && (n = e, e = t, t = n), function(n) {
		return Math.max(e, Math.min(t, n));
	};
}
function zc(e, t, n) {
	var r = e[0], i = e[1], a = t[0], o = t[1];
	return i < r ? (r = Lc(i, r), a = n(o, a)) : (r = Lc(r, i), a = n(a, o)), function(e) {
		return a(r(e));
	};
}
function Bc(e, t, n) {
	var r = Math.min(e.length, t.length) - 1, i = Array(r), a = Array(r), o = -1;
	for (e[r] < e[0] && (e = e.slice().reverse(), t = t.slice().reverse()); ++o < r;) i[o] = Lc(e[o], e[o + 1]), a[o] = n(t[o], t[o + 1]);
	return function(t) {
		var n = xn(e, t, 1, r) - 1;
		return a[n](i[n](t));
	};
}
function Vc(e, t) {
	return t.domain(e.domain()).range(e.range()).interpolate(e.interpolate()).clamp(e.clamp()).unknown(e.unknown());
}
function Hc() {
	var e = Fc, t = Fc, n = Ma, r, i, a, o = Ic, s, c, l;
	function u() {
		var n = Math.min(e.length, t.length);
		return o !== Ic && (o = Rc(e[0], e[n - 1])), s = n > 2 ? Bc : zc, c = l = null, d;
	}
	function d(i) {
		return i == null || isNaN(i = +i) ? a : (c ||= s(e.map(r), t, n))(r(o(i)));
	}
	return d.invert = function(n) {
		return o(i((l ||= s(t, e.map(r), Ta))(n)));
	}, d.domain = function(t) {
		return arguments.length ? (e = Array.from(t, Pc), u()) : e.slice();
	}, d.range = function(e) {
		return arguments.length ? (t = Array.from(e), u()) : t.slice();
	}, d.rangeRound = function(e) {
		return t = Array.from(e), n = Na, u();
	}, d.clamp = function(e) {
		return arguments.length ? (o = e ? !0 : Ic, u()) : o !== Ic;
	}, d.interpolate = function(e) {
		return arguments.length ? (n = e, u()) : n;
	}, d.unknown = function(e) {
		return arguments.length ? (a = e, d) : a;
	}, function(e, t) {
		return r = e, i = t, u();
	};
}
function Uc() {
	return Hc()(Ic, Ic);
}
// ../../node_modules/d3-scale/src/tickFormat.js
function Wc(o, s, c, l) {
	var u = Nn(o, s, c), d;
	switch (l = a(l ?? ",f"), l.type) {
		case "s":
			var f = Math.max(Math.abs(o), Math.abs(s));
			return l.precision == null && !isNaN(d = i(u, f)) && (l.precision = d), r(l, f);
		case "":
		case "e":
		case "g":
		case "p":
		case "r":
			l.precision == null && !isNaN(d = n(u, Math.max(Math.abs(o), Math.abs(s)))) && (l.precision = d - (l.type === "e"));
			break;
		case "f":
		case "%": l.precision == null && !isNaN(d = t(u)) && (l.precision = d - (l.type === "%") * 2);
	}
	return e(l);
}
// ../../node_modules/d3-scale/src/linear.js
function Gc(e) {
	var t = e.domain;
	return e.ticks = function(e) {
		var n = t();
		return jn(n[0], n[n.length - 1], e ?? 10);
	}, e.tickFormat = function(e, n) {
		var r = t();
		return Wc(r[0], r[r.length - 1], e ?? 10, n);
	}, e.nice = function(n) {
		n ??= 10;
		var r = t(), i = 0, a = r.length - 1, o = r[i], s = r[a], c, l, u = 10;
		for (s < o && (l = o, o = s, s = l, l = i, i = a, a = l); u-- > 0;) {
			if (l = Mn(o, s, n), l === c) return r[i] = o, r[a] = s, t(r);
			if (l > 0) o = Math.floor(o / l) * l, s = Math.ceil(s / l) * l;
			else if (l < 0) o = Math.ceil(o * l) / l, s = Math.floor(s * l) / l;
			else break;
			c = l;
		}
		return e;
	}, e;
}
function Kc() {
	var e = Uc();
	return e.copy = function() {
		return Vc(e, Kc());
	}, Ac.apply(e, arguments), Gc(e);
}
// ../../node_modules/d3-scale/src/nice.js
function qc(e, t) {
	e = e.slice();
	var n = 0, r = e.length - 1, i = e[n], a = e[r], o;
	return a < i && (o = n, n = r, r = o, o = i, i = a, a = o), e[n] = t.floor(i), e[r] = t.ceil(a), e;
}
// ../../node_modules/d3-scale/src/log.js
function Jc(e) {
	return Math.log(e);
}
function Yc(e) {
	return Math.exp(e);
}
function Xc(e) {
	return -Math.log(-e);
}
function Zc(e) {
	return -Math.exp(-e);
}
function Qc(e) {
	return isFinite(e) ? +("1e" + e) : e < 0 ? 0 : e;
}
function $c(e) {
	return e === 10 ? Qc : e === Math.E ? Math.exp : (t) => e ** +t;
}
function el(e) {
	return e === Math.E ? Math.log : e === 10 && Math.log10 || e === 2 && Math.log2 || (e = Math.log(e), (t) => Math.log(t) / e);
}
function tl(e) {
	return (t, n) => -e(-t, n);
}
function nl(t) {
	let n = t(Jc, Yc), r = n.domain, i = 10, o, s;
	function c() {
		return o = el(i), s = $c(i), r()[0] < 0 ? (o = tl(o), s = tl(s), t(Xc, Zc)) : t(Jc, Yc), n;
	}
	return n.base = function(e) {
		return arguments.length ? (i = +e, c()) : i;
	}, n.domain = function(e) {
		return arguments.length ? (r(e), c()) : r();
	}, n.ticks = (e) => {
		let t = r(), n = t[0], a = t[t.length - 1], c = a < n;
		c && ([n, a] = [a, n]);
		let l = o(n), u = o(a), d, f, p = e == null ? 10 : +e, m = [];
		if (!(i % 1) && u - l < p) {
			if (l = Math.floor(l), u = Math.ceil(u), n > 0) {
				for (; l <= u; ++l) for (d = 1; d < i; ++d) if (f = l < 0 ? d / s(-l) : d * s(l), !(f < n)) {
					if (f > a) break;
					m.push(f);
				}
			} else for (; l <= u; ++l) for (d = i - 1; d >= 1; --d) if (f = l > 0 ? d / s(-l) : d * s(l), !(f < n)) {
				if (f > a) break;
				m.push(f);
			}
			m.length * 2 < p && (m = jn(n, a, p));
		} else m = jn(l, u, Math.min(u - l, p)).map(s);
		return c ? m.reverse() : m;
	}, n.tickFormat = (t, r) => {
		if (t ??= 10, r ??= i === 10 ? "s" : ",", typeof r != "function" && (!(i % 1) && (r = a(r)).precision == null && (r.trim = !0), r = e(r)), t === Infinity) return r;
		let c = Math.max(1, i * t / n.ticks().length);
		return (e) => {
			let t = e / s(Math.round(o(e)));
			return t * i < i - .5 && (t *= i), t <= c ? r(e) : "";
		};
	}, n.nice = () => r(qc(r(), {
		floor: (e) => s(Math.floor(o(e))),
		ceil: (e) => s(Math.ceil(o(e)))
	})), n;
}
function rl() {
	let e = nl(Hc()).domain([1, 10]);
	return e.copy = () => Vc(e, rl()).base(e.base()), Ac.apply(e, arguments), e;
}
// ../../node_modules/d3-scale/src/symlog.js
function il(e) {
	return function(t) {
		return Math.sign(t) * Math.log1p(Math.abs(t / e));
	};
}
function al(e) {
	return function(t) {
		return Math.sign(t) * Math.expm1(Math.abs(t)) * e;
	};
}
function ol(e) {
	var t = 1, n = e(il(t), al(t));
	return n.constant = function(n) {
		return arguments.length ? e(il(t = +n), al(t)) : t;
	}, Gc(n);
}
function sl() {
	var e = ol(Hc());
	return e.copy = function() {
		return Vc(e, sl()).constant(e.constant());
	}, Ac.apply(e, arguments);
}
// ../../node_modules/d3-scale/src/time.js
function cl(e) {
	return new Date(e);
}
function ll(e) {
	return e instanceof Date ? +e : +/* @__PURE__ */ new Date(+e);
}
function ul(e, t, n, r, i, a, o, s, c, l) {
	var u = Uc(), d = u.invert, f = u.domain, p = l(".%L"), m = l(":%S"), h = l("%I:%M"), g = l("%I %p"), _ = l("%a %d"), v = l("%b %d"), y = l("%B"), b = l("%Y");
	function x(e) {
		return (c(e) < e ? p : s(e) < e ? m : o(e) < e ? h : a(e) < e ? g : r(e) < e ? i(e) < e ? _ : v : n(e) < e ? y : b)(e);
	}
	return u.invert = function(e) {
		return new Date(d(e));
	}, u.domain = function(e) {
		return arguments.length ? f(Array.from(e, ll)) : f().map(cl);
	}, u.ticks = function(t) {
		var n = f();
		return e(n[0], n[n.length - 1], t ?? 10);
	}, u.tickFormat = function(e, t) {
		return t == null ? x : l(t);
	}, u.nice = function(e) {
		var n = f();
		return e && typeof e.range == "function" || (e = t(n[0], n[n.length - 1], e ?? 10)), e ? f(qc(n, e)) : u;
	}, u.copy = function() {
		return Vc(u, ul(e, t, n, r, i, a, o, s, c, l));
	}, u;
}
function dl() {
	return Ac.apply(ul(Ln, Rn, pn, dn, Yt, Gt, Ut, Vt, Bt, oi).domain([new Date(2e3, 0, 1), new Date(2e3, 0, 2)]), arguments);
}
// ../../node_modules/d3-scale/src/utcTime.js
function fl() {
	return Ac.apply(ul(Fn, In, mn, fn, rn, Kt, Wt, Ht, Bt, ci).domain([Date.UTC(2e3, 0, 1), Date.UTC(2e3, 0, 2)]), arguments);
}
// ../../node_modules/d3-shape/src/constant.js
function P(e) {
	return function() {
		return e;
	};
}
// ../../node_modules/d3-shape/src/math.js
var pl = Math.abs, ml = Math.atan2, hl = Math.cos, gl = Math.max, _l = Math.min, vl = Math.sin, yl = Math.sqrt, bl = Math.PI, xl = bl / 2, Sl = 2 * bl;
function Cl(e) {
	return e > 1 ? 0 : e < -1 ? bl : Math.acos(e);
}
function wl(e) {
	return e >= 1 ? xl : e <= -1 ? -xl : Math.asin(e);
}
// ../../node_modules/d3-path/src/path.js
var Tl = Math.PI, El = 2 * Tl, Dl = 1e-6, Ol = El - Dl;
function kl(e) {
	this._ += e[0];
	for (let t = 1, n = e.length; t < n; ++t) this._ += arguments[t] + e[t];
}
function Al(e) {
	let t = Math.floor(e);
	if (!(t >= 0)) throw Error(`invalid digits: ${e}`);
	if (t > 15) return kl;
	let n = 10 ** t;
	return function(e) {
		this._ += e[0];
		for (let t = 1, r = e.length; t < r; ++t) this._ += Math.round(arguments[t] * n) / n + e[t];
	};
}
var jl = class {
	constructor(e) {
		this._x0 = this._y0 = this._x1 = this._y1 = null, this._ = "", this._append = e == null ? kl : Al(e);
	}
	moveTo(e, t) {
		this._append`M${this._x0 = this._x1 = +e},${this._y0 = this._y1 = +t}`;
	}
	closePath() {
		this._x1 !== null && (this._x1 = this._x0, this._y1 = this._y0, this._append`Z`);
	}
	lineTo(e, t) {
		this._append`L${this._x1 = +e},${this._y1 = +t}`;
	}
	quadraticCurveTo(e, t, n, r) {
		this._append`Q${+e},${+t},${this._x1 = +n},${this._y1 = +r}`;
	}
	bezierCurveTo(e, t, n, r, i, a) {
		this._append`C${+e},${+t},${+n},${+r},${this._x1 = +i},${this._y1 = +a}`;
	}
	arcTo(e, t, n, r, i) {
		if (e = +e, t = +t, n = +n, r = +r, i = +i, i < 0) throw Error(`negative radius: ${i}`);
		let a = this._x1, o = this._y1, s = n - e, c = r - t, l = a - e, u = o - t, d = l * l + u * u;
		if (this._x1 === null) this._append`M${this._x1 = e},${this._y1 = t}`;
		else if (d > Dl) {
			if (!(Math.abs(u * s - c * l) > Dl) || !i) this._append`L${this._x1 = e},${this._y1 = t}`;
			else {
				let f = n - a, p = r - o, m = s * s + c * c, h = f * f + p * p, g = Math.sqrt(m), _ = Math.sqrt(d), v = i * Math.tan((Tl - Math.acos((m + d - h) / (2 * g * _))) / 2), y = v / _, b = v / g;
				Math.abs(y - 1) > Dl && this._append`L${e + y * l},${t + y * u}`, this._append`A${i},${i},0,0,${+(u * f > l * p)},${this._x1 = e + b * s},${this._y1 = t + b * c}`;
			}
		}
	}
	arc(e, t, n, r, i, a) {
		if (e = +e, t = +t, n = +n, a = !!a, n < 0) throw Error(`negative radius: ${n}`);
		let o = n * Math.cos(r), s = n * Math.sin(r), c = e + o, l = t + s, u = 1 ^ a, d = a ? r - i : i - r;
		this._x1 === null ? this._append`M${c},${l}` : (Math.abs(this._x1 - c) > Dl || Math.abs(this._y1 - l) > Dl) && this._append`L${c},${l}`, n && (d < 0 && (d = d % El + El), d > Ol ? this._append`A${n},${n},0,1,${u},${e - o},${t - s}A${n},${n},0,1,${u},${this._x1 = c},${this._y1 = l}` : d > Dl && this._append`A${n},${n},0,${+(d >= Tl)},${u},${this._x1 = e + n * Math.cos(i)},${this._y1 = t + n * Math.sin(i)}`);
	}
	rect(e, t, n, r) {
		this._append`M${this._x0 = this._x1 = +e},${this._y0 = this._y1 = +t}h${n = +n}v${+r}h${-n}Z`;
	}
	toString() {
		return this._;
	}
};
jl.prototype;
// ../../node_modules/d3-shape/src/path.js
function Ml(e) {
	let t = 3;
	return e.digits = function(n) {
		if (!arguments.length) return t;
		if (n == null) t = null;
		else {
			let e = Math.floor(n);
			if (!(e >= 0)) throw RangeError(`invalid digits: ${n}`);
			t = e;
		}
		return e;
	}, () => new jl(t);
}
// ../../node_modules/d3-shape/src/arc.js
function Nl(e) {
	return e.innerRadius;
}
function Pl(e) {
	return e.outerRadius;
}
function Fl(e) {
	return e.startAngle;
}
function Il(e) {
	return e.endAngle;
}
function Ll(e) {
	return e && e.padAngle;
}
function Rl(e, t, n, r, i, a, o, s) {
	var c = n - e, l = r - t, u = o - i, d = s - a, f = d * c - u * l;
	if (!(f * f < 1e-12)) return f = (u * (t - a) - d * (e - i)) / f, [e + f * c, t + f * l];
}
function zl(e, t, n, r, i, a, o) {
	var s = e - n, c = t - r, l = (o ? a : -a) / yl(s * s + c * c), u = l * c, d = -l * s, f = e + u, p = t + d, m = n + u, h = r + d, g = (f + m) / 2, _ = (p + h) / 2, v = m - f, y = h - p, b = v * v + y * y, x = i - a, S = f * h - m * p, C = (y < 0 ? -1 : 1) * yl(gl(0, x * x * b - S * S)), w = (S * y - v * C) / b, T = (-S * v - y * C) / b, E = (S * y + v * C) / b, D = (-S * v + y * C) / b, O = w - g, k = T - _, ee = E - g, A = D - _;
	return O * O + k * k > ee * ee + A * A && (w = E, T = D), {
		cx: w,
		cy: T,
		x01: -u,
		y01: -d,
		x11: w * (i / x - 1),
		y11: T * (i / x - 1)
	};
}
function Bl() {
	var e = Nl, t = Pl, n = P(0), r = null, i = Fl, a = Il, o = Ll, s = null, c = Ml(l);
	function l() {
		var l, u, d = +e.apply(this, arguments), f = +t.apply(this, arguments), p = i.apply(this, arguments) - xl, m = a.apply(this, arguments) - xl, h = pl(m - p), g = m > p;
		if (s ||= l = c(), f < d && (u = f, f = d, d = u), !(f > 1e-12)) s.moveTo(0, 0);
		else if (h > Sl - 1e-12) s.moveTo(f * hl(p), f * vl(p)), s.arc(0, 0, f, p, m, !g), d > 1e-12 && (s.moveTo(d * hl(m), d * vl(m)), s.arc(0, 0, d, m, p, g));
		else {
			var _ = p, v = m, y = p, b = m, x = h, S = h, C = o.apply(this, arguments) / 2, w = C > 1e-12 && (r ? +r.apply(this, arguments) : yl(d * d + f * f)), T = _l(pl(f - d) / 2, +n.apply(this, arguments)), E = T, D = T, O, k;
			if (w > 1e-12) {
				var ee = wl(w / d * vl(C)), A = wl(w / f * vl(C));
				(x -= ee * 2) > 1e-12 ? (ee *= g ? 1 : -1, y += ee, b -= ee) : (x = 0, y = b = (p + m) / 2), (S -= A * 2) > 1e-12 ? (A *= g ? 1 : -1, _ += A, v -= A) : (S = 0, _ = v = (p + m) / 2);
			}
			var te = f * hl(_), j = f * vl(_), ne = d * hl(b), re = d * vl(b);
			if (T > 1e-12) {
				var ie = f * hl(v), ae = f * vl(v), oe = d * hl(y), se = d * vl(y), ce;
				if (h < bl) {
					if (ce = Rl(te, j, oe, se, ie, ae, ne, re)) {
						var le = te - ce[0], ue = j - ce[1], de = ie - ce[0], fe = ae - ce[1], pe = 1 / vl(Cl((le * de + ue * fe) / (yl(le * le + ue * ue) * yl(de * de + fe * fe))) / 2), me = yl(ce[0] * ce[0] + ce[1] * ce[1]);
						E = _l(T, (d - me) / (pe - 1)), D = _l(T, (f - me) / (pe + 1));
					} else E = D = 0;
				}
			}
			S > 1e-12 ? D > 1e-12 ? (O = zl(oe, se, te, j, f, D, g), k = zl(ie, ae, ne, re, f, D, g), s.moveTo(O.cx + O.x01, O.cy + O.y01), D < T ? s.arc(O.cx, O.cy, D, ml(O.y01, O.x01), ml(k.y01, k.x01), !g) : (s.arc(O.cx, O.cy, D, ml(O.y01, O.x01), ml(O.y11, O.x11), !g), s.arc(0, 0, f, ml(O.cy + O.y11, O.cx + O.x11), ml(k.cy + k.y11, k.cx + k.x11), !g), s.arc(k.cx, k.cy, D, ml(k.y11, k.x11), ml(k.y01, k.x01), !g))) : (s.moveTo(te, j), s.arc(0, 0, f, _, v, !g)) : s.moveTo(te, j), !(d > 1e-12) || !(x > 1e-12) ? s.lineTo(ne, re) : E > 1e-12 ? (O = zl(ne, re, ie, ae, d, -E, g), k = zl(te, j, oe, se, d, -E, g), s.lineTo(O.cx + O.x01, O.cy + O.y01), E < T ? s.arc(O.cx, O.cy, E, ml(O.y01, O.x01), ml(k.y01, k.x01), !g) : (s.arc(O.cx, O.cy, E, ml(O.y01, O.x01), ml(O.y11, O.x11), !g), s.arc(0, 0, d, ml(O.cy + O.y11, O.cx + O.x11), ml(k.cy + k.y11, k.cx + k.x11), g), s.arc(k.cx, k.cy, E, ml(k.y11, k.x11), ml(k.y01, k.x01), !g))) : s.arc(0, 0, d, b, y, g);
		}
		if (s.closePath(), l) return s = null, l + "" || null;
	}
	return l.centroid = function() {
		var n = (+e.apply(this, arguments) + +t.apply(this, arguments)) / 2, r = (+i.apply(this, arguments) + +a.apply(this, arguments)) / 2 - bl / 2;
		return [hl(r) * n, vl(r) * n];
	}, l.innerRadius = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : P(+t), l) : e;
	}, l.outerRadius = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : P(+e), l) : t;
	}, l.cornerRadius = function(e) {
		return arguments.length ? (n = typeof e == "function" ? e : P(+e), l) : n;
	}, l.padRadius = function(e) {
		return arguments.length ? (r = e == null ? null : typeof e == "function" ? e : P(+e), l) : r;
	}, l.startAngle = function(e) {
		return arguments.length ? (i = typeof e == "function" ? e : P(+e), l) : i;
	}, l.endAngle = function(e) {
		return arguments.length ? (a = typeof e == "function" ? e : P(+e), l) : a;
	}, l.padAngle = function(e) {
		return arguments.length ? (o = typeof e == "function" ? e : P(+e), l) : o;
	}, l.context = function(e) {
		return arguments.length ? (s = e ?? null, l) : s;
	}, l;
}
Array.prototype.slice;
function Vl(e) {
	return typeof e == "object" && "length" in e ? e : Array.from(e);
}
// ../../node_modules/d3-shape/src/curve/linear.js
function Hl(e) {
	this._context = e;
}
Hl.prototype = {
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
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1, this._line ? this._context.lineTo(e, t) : this._context.moveTo(e, t);
				break;
			case 1: this._point = 2;
			default: this._context.lineTo(e, t);
		}
	}
};
function Ul(e) {
	return new Hl(e);
}
// ../../node_modules/d3-shape/src/point.js
function Wl(e) {
	return e[0];
}
function Gl(e) {
	return e[1];
}
// ../../node_modules/d3-shape/src/line.js
function Kl(e, t) {
	var n = P(!0), r = null, i = Ul, a = null, o = Ml(s);
	e = typeof e == "function" ? e : e === void 0 ? Wl : P(e), t = typeof t == "function" ? t : t === void 0 ? Gl : P(t);
	function s(s) {
		var c, l = (s = Vl(s)).length, u, d = !1, f;
		for (r ?? (a = i(f = o())), c = 0; c <= l; ++c) !(c < l && n(u = s[c], c, s)) === d && ((d = !d) ? a.lineStart() : a.lineEnd()), d && a.point(+e(u, c, s), +t(u, c, s));
		if (f) return a = null, f + "" || null;
	}
	return s.x = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : P(+t), s) : e;
	}, s.y = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : P(+e), s) : t;
	}, s.defined = function(e) {
		return arguments.length ? (n = typeof e == "function" ? e : P(!!e), s) : n;
	}, s.curve = function(e) {
		return arguments.length ? (i = e, r != null && (a = i(r)), s) : i;
	}, s.context = function(e) {
		return arguments.length ? (e == null ? r = a = null : a = i(r = e), s) : r;
	}, s;
}
// ../../node_modules/d3-shape/src/area.js
function ql(e, t, n) {
	var r = null, i = P(!0), a = null, o = Ul, s = null, c = Ml(l);
	e = typeof e == "function" ? e : e === void 0 ? Wl : P(+e), t = typeof t == "function" ? t : P(t === void 0 ? 0 : +t), n = typeof n == "function" ? n : n === void 0 ? Gl : P(+n);
	function l(l) {
		var u, d, f, p = (l = Vl(l)).length, m, h = !1, g, _ = Array(p), v = Array(p);
		for (a ?? (s = o(g = c())), u = 0; u <= p; ++u) {
			if (!(u < p && i(m = l[u], u, l)) === h) {
				if (h = !h) d = u, s.areaStart(), s.lineStart();
				else {
					for (s.lineEnd(), s.lineStart(), f = u - 1; f >= d; --f) s.point(_[f], v[f]);
					s.lineEnd(), s.areaEnd();
				}
			}
			h && (_[u] = +e(m, u, l), v[u] = +t(m, u, l), s.point(r ? +r(m, u, l) : _[u], n ? +n(m, u, l) : v[u]));
		}
		if (g) return s = null, g + "" || null;
	}
	function u() {
		return Kl().defined(i).curve(o).context(a);
	}
	return l.x = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : P(+t), r = null, l) : e;
	}, l.x0 = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : P(+t), l) : e;
	}, l.x1 = function(e) {
		return arguments.length ? (r = e == null ? null : typeof e == "function" ? e : P(+e), l) : r;
	}, l.y = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : P(+e), n = null, l) : t;
	}, l.y0 = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : P(+e), l) : t;
	}, l.y1 = function(e) {
		return arguments.length ? (n = e == null ? null : typeof e == "function" ? e : P(+e), l) : n;
	}, l.lineX0 = l.lineY0 = function() {
		return u().x(e).y(t);
	}, l.lineY1 = function() {
		return u().x(e).y(n);
	}, l.lineX1 = function() {
		return u().x(r).y(t);
	}, l.defined = function(e) {
		return arguments.length ? (i = typeof e == "function" ? e : P(!!e), l) : i;
	}, l.curve = function(e) {
		return arguments.length ? (o = e, a != null && (s = o(a)), l) : o;
	}, l.context = function(e) {
		return arguments.length ? (e == null ? a = s = null : s = o(a = e), l) : a;
	}, l;
}
// ../../node_modules/d3-shape/src/descending.js
function Jl(e, t) {
	return t < e ? -1 : t > e ? 1 : t >= e ? 0 : NaN;
}
// ../../node_modules/d3-shape/src/identity.js
function Yl(e) {
	return e;
}
// ../../node_modules/d3-shape/src/pie.js
function Xl() {
	var e = Yl, t = Jl, n = null, r = P(0), i = P(Sl), a = P(0);
	function o(o) {
		var s, c = (o = Vl(o)).length, l, u, d = 0, f = Array(c), p = Array(c), m = +r.apply(this, arguments), h = Math.min(Sl, Math.max(-Sl, i.apply(this, arguments) - m)), g, _ = Math.min(Math.abs(h) / c, a.apply(this, arguments)), v = _ * (h < 0 ? -1 : 1), y;
		for (s = 0; s < c; ++s) (y = p[f[s] = s] = +e(o[s], s, o)) > 0 && (d += y);
		for (t == null ? n != null && f.sort(function(e, t) {
			return n(o[e], o[t]);
		}) : f.sort(function(e, n) {
			return t(p[e], p[n]);
		}), s = 0, u = d ? (h - c * v) / d : 0; s < c; ++s, m = g) l = f[s], y = p[l], g = m + (y > 0 ? y * u : 0) + v, p[l] = {
			data: o[l],
			index: s,
			value: y,
			startAngle: m,
			endAngle: g,
			padAngle: _
		};
		return p;
	}
	return o.value = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : P(+t), o) : e;
	}, o.sortValues = function(e) {
		return arguments.length ? (t = e, n = null, o) : t;
	}, o.sort = function(e) {
		return arguments.length ? (n = e, t = null, o) : n;
	}, o.startAngle = function(e) {
		return arguments.length ? (r = typeof e == "function" ? e : P(+e), o) : r;
	}, o.endAngle = function(e) {
		return arguments.length ? (i = typeof e == "function" ? e : P(+e), o) : i;
	}, o.padAngle = function(e) {
		return arguments.length ? (a = typeof e == "function" ? e : P(+e), o) : a;
	}, o;
}
// ../../node_modules/d3-shape/src/noop.js
function Zl() {}
// ../../node_modules/d3-shape/src/curve/basis.js
function Ql(e, t, n) {
	e._context.bezierCurveTo((2 * e._x0 + e._x1) / 3, (2 * e._y0 + e._y1) / 3, (e._x0 + 2 * e._x1) / 3, (e._y0 + 2 * e._y1) / 3, (e._x0 + 4 * e._x1 + t) / 6, (e._y0 + 4 * e._y1 + n) / 6);
}
function $l(e) {
	this._context = e;
}
$l.prototype = {
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
			case 3: Ql(this, this._x1, this._y1);
			case 2: this._context.lineTo(this._x1, this._y1);
		}
		(this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
	},
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1, this._line ? this._context.lineTo(e, t) : this._context.moveTo(e, t);
				break;
			case 1:
				this._point = 2;
				break;
			case 2: this._point = 3, this._context.lineTo((5 * this._x0 + this._x1) / 6, (5 * this._y0 + this._y1) / 6);
			default: Ql(this, e, t);
		}
		this._x0 = this._x1, this._x1 = e, this._y0 = this._y1, this._y1 = t;
	}
};
function eu(e) {
	return new $l(e);
}
// ../../node_modules/d3-shape/src/curve/basisClosed.js
function tu(e) {
	this._context = e;
}
tu.prototype = {
	areaStart: Zl,
	areaEnd: Zl,
	lineStart: function() {
		this._x0 = this._x1 = this._x2 = this._x3 = this._x4 = this._y0 = this._y1 = this._y2 = this._y3 = this._y4 = NaN, this._point = 0;
	},
	lineEnd: function() {
		switch (this._point) {
			case 1:
				this._context.moveTo(this._x2, this._y2), this._context.closePath();
				break;
			case 2:
				this._context.moveTo((this._x2 + 2 * this._x3) / 3, (this._y2 + 2 * this._y3) / 3), this._context.lineTo((this._x3 + 2 * this._x2) / 3, (this._y3 + 2 * this._y2) / 3), this._context.closePath();
				break;
			case 3: this.point(this._x2, this._y2), this.point(this._x3, this._y3), this.point(this._x4, this._y4);
		}
	},
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1, this._x2 = e, this._y2 = t;
				break;
			case 1:
				this._point = 2, this._x3 = e, this._y3 = t;
				break;
			case 2:
				this._point = 3, this._x4 = e, this._y4 = t, this._context.moveTo((this._x0 + 4 * this._x1 + e) / 6, (this._y0 + 4 * this._y1 + t) / 6);
				break;
			default: Ql(this, e, t);
		}
		this._x0 = this._x1, this._x1 = e, this._y0 = this._y1, this._y1 = t;
	}
};
function nu(e) {
	return new tu(e);
}
// ../../node_modules/d3-shape/src/curve/basisOpen.js
function ru(e) {
	this._context = e;
}
ru.prototype = {
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
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1;
				break;
			case 1:
				this._point = 2;
				break;
			case 2:
				this._point = 3;
				var n = (this._x0 + 4 * this._x1 + e) / 6, r = (this._y0 + 4 * this._y1 + t) / 6;
				this._line ? this._context.lineTo(n, r) : this._context.moveTo(n, r);
				break;
			case 3: this._point = 4;
			default: Ql(this, e, t);
		}
		this._x0 = this._x1, this._x1 = e, this._y0 = this._y1, this._y1 = t;
	}
};
function iu(e) {
	return new ru(e);
}
// ../../node_modules/d3-shape/src/curve/bundle.js
function au(e, t) {
	this._basis = new $l(e), this._beta = t;
}
au.prototype = {
	lineStart: function() {
		this._x = [], this._y = [], this._basis.lineStart();
	},
	lineEnd: function() {
		var e = this._x, t = this._y, n = e.length - 1;
		if (n > 0) for (var r = e[0], i = t[0], a = e[n] - r, o = t[n] - i, s = -1, c; ++s <= n;) c = s / n, this._basis.point(this._beta * e[s] + (1 - this._beta) * (r + c * a), this._beta * t[s] + (1 - this._beta) * (i + c * o));
		this._x = this._y = null, this._basis.lineEnd();
	},
	point: function(e, t) {
		this._x.push(+e), this._y.push(+t);
	}
};
var ou = (function e(t) {
	function n(e) {
		return t === 1 ? new $l(e) : new au(e, t);
	}
	return n.beta = function(t) {
		return e(+t);
	}, n;
})(.85);
// ../../node_modules/d3-shape/src/curve/cardinal.js
function su(e, t, n) {
	e._context.bezierCurveTo(e._x1 + e._k * (e._x2 - e._x0), e._y1 + e._k * (e._y2 - e._y0), e._x2 + e._k * (e._x1 - t), e._y2 + e._k * (e._y1 - n), e._x2, e._y2);
}
function cu(e, t) {
	this._context = e, this._k = (1 - t) / 6;
}
cu.prototype = {
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
			case 3: su(this, this._x1, this._y1);
		}
		(this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
	},
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1, this._line ? this._context.lineTo(e, t) : this._context.moveTo(e, t);
				break;
			case 1:
				this._point = 2, this._x1 = e, this._y1 = t;
				break;
			case 2: this._point = 3;
			default: su(this, e, t);
		}
		this._x0 = this._x1, this._x1 = this._x2, this._x2 = e, this._y0 = this._y1, this._y1 = this._y2, this._y2 = t;
	}
};
var lu = (function e(t) {
	function n(e) {
		return new cu(e, t);
	}
	return n.tension = function(t) {
		return e(+t);
	}, n;
})(0);
// ../../node_modules/d3-shape/src/curve/cardinalClosed.js
function uu(e, t) {
	this._context = e, this._k = (1 - t) / 6;
}
uu.prototype = {
	areaStart: Zl,
	areaEnd: Zl,
	lineStart: function() {
		this._x0 = this._x1 = this._x2 = this._x3 = this._x4 = this._x5 = this._y0 = this._y1 = this._y2 = this._y3 = this._y4 = this._y5 = NaN, this._point = 0;
	},
	lineEnd: function() {
		switch (this._point) {
			case 1:
				this._context.moveTo(this._x3, this._y3), this._context.closePath();
				break;
			case 2:
				this._context.lineTo(this._x3, this._y3), this._context.closePath();
				break;
			case 3: this.point(this._x3, this._y3), this.point(this._x4, this._y4), this.point(this._x5, this._y5);
		}
	},
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1, this._x3 = e, this._y3 = t;
				break;
			case 1:
				this._point = 2, this._context.moveTo(this._x4 = e, this._y4 = t);
				break;
			case 2:
				this._point = 3, this._x5 = e, this._y5 = t;
				break;
			default: su(this, e, t);
		}
		this._x0 = this._x1, this._x1 = this._x2, this._x2 = e, this._y0 = this._y1, this._y1 = this._y2, this._y2 = t;
	}
};
var du = (function e(t) {
	function n(e) {
		return new uu(e, t);
	}
	return n.tension = function(t) {
		return e(+t);
	}, n;
})(0);
// ../../node_modules/d3-shape/src/curve/cardinalOpen.js
function fu(e, t) {
	this._context = e, this._k = (1 - t) / 6;
}
fu.prototype = {
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
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1;
				break;
			case 1:
				this._point = 2;
				break;
			case 2:
				this._point = 3, this._line ? this._context.lineTo(this._x2, this._y2) : this._context.moveTo(this._x2, this._y2);
				break;
			case 3: this._point = 4;
			default: su(this, e, t);
		}
		this._x0 = this._x1, this._x1 = this._x2, this._x2 = e, this._y0 = this._y1, this._y1 = this._y2, this._y2 = t;
	}
};
var pu = (function e(t) {
	function n(e) {
		return new fu(e, t);
	}
	return n.tension = function(t) {
		return e(+t);
	}, n;
})(0);
// ../../node_modules/d3-shape/src/curve/catmullRom.js
function mu(e, t, n) {
	var r = e._x1, i = e._y1, a = e._x2, o = e._y2;
	if (e._l01_a > 1e-12) {
		var s = 2 * e._l01_2a + 3 * e._l01_a * e._l12_a + e._l12_2a, c = 3 * e._l01_a * (e._l01_a + e._l12_a);
		r = (r * s - e._x0 * e._l12_2a + e._x2 * e._l01_2a) / c, i = (i * s - e._y0 * e._l12_2a + e._y2 * e._l01_2a) / c;
	}
	if (e._l23_a > 1e-12) {
		var l = 2 * e._l23_2a + 3 * e._l23_a * e._l12_a + e._l12_2a, u = 3 * e._l23_a * (e._l23_a + e._l12_a);
		a = (a * l + e._x1 * e._l23_2a - t * e._l12_2a) / u, o = (o * l + e._y1 * e._l23_2a - n * e._l12_2a) / u;
	}
	e._context.bezierCurveTo(r, i, a, o, e._x2, e._y2);
}
function hu(e, t) {
	this._context = e, this._alpha = t;
}
hu.prototype = {
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
			case 3: this.point(this._x2, this._y2);
		}
		(this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
	},
	point: function(e, t) {
		if (e = +e, t = +t, this._point) {
			var n = this._x2 - e, r = this._y2 - t;
			this._l23_a = Math.sqrt(this._l23_2a = (n * n + r * r) ** +this._alpha);
		}
		switch (this._point) {
			case 0:
				this._point = 1, this._line ? this._context.lineTo(e, t) : this._context.moveTo(e, t);
				break;
			case 1:
				this._point = 2;
				break;
			case 2: this._point = 3;
			default: mu(this, e, t);
		}
		this._l01_a = this._l12_a, this._l12_a = this._l23_a, this._l01_2a = this._l12_2a, this._l12_2a = this._l23_2a, this._x0 = this._x1, this._x1 = this._x2, this._x2 = e, this._y0 = this._y1, this._y1 = this._y2, this._y2 = t;
	}
};
var gu = (function e(t) {
	function n(e) {
		return t ? new hu(e, t) : new cu(e, 0);
	}
	return n.alpha = function(t) {
		return e(+t);
	}, n;
})(.5);
// ../../node_modules/d3-shape/src/curve/catmullRomClosed.js
function _u(e, t) {
	this._context = e, this._alpha = t;
}
_u.prototype = {
	areaStart: Zl,
	areaEnd: Zl,
	lineStart: function() {
		this._x0 = this._x1 = this._x2 = this._x3 = this._x4 = this._x5 = this._y0 = this._y1 = this._y2 = this._y3 = this._y4 = this._y5 = NaN, this._l01_a = this._l12_a = this._l23_a = this._l01_2a = this._l12_2a = this._l23_2a = this._point = 0;
	},
	lineEnd: function() {
		switch (this._point) {
			case 1:
				this._context.moveTo(this._x3, this._y3), this._context.closePath();
				break;
			case 2:
				this._context.lineTo(this._x3, this._y3), this._context.closePath();
				break;
			case 3: this.point(this._x3, this._y3), this.point(this._x4, this._y4), this.point(this._x5, this._y5);
		}
	},
	point: function(e, t) {
		if (e = +e, t = +t, this._point) {
			var n = this._x2 - e, r = this._y2 - t;
			this._l23_a = Math.sqrt(this._l23_2a = (n * n + r * r) ** +this._alpha);
		}
		switch (this._point) {
			case 0:
				this._point = 1, this._x3 = e, this._y3 = t;
				break;
			case 1:
				this._point = 2, this._context.moveTo(this._x4 = e, this._y4 = t);
				break;
			case 2:
				this._point = 3, this._x5 = e, this._y5 = t;
				break;
			default: mu(this, e, t);
		}
		this._l01_a = this._l12_a, this._l12_a = this._l23_a, this._l01_2a = this._l12_2a, this._l12_2a = this._l23_2a, this._x0 = this._x1, this._x1 = this._x2, this._x2 = e, this._y0 = this._y1, this._y1 = this._y2, this._y2 = t;
	}
};
var vu = (function e(t) {
	function n(e) {
		return t ? new _u(e, t) : new uu(e, 0);
	}
	return n.alpha = function(t) {
		return e(+t);
	}, n;
})(.5);
// ../../node_modules/d3-shape/src/curve/catmullRomOpen.js
function yu(e, t) {
	this._context = e, this._alpha = t;
}
yu.prototype = {
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
	point: function(e, t) {
		if (e = +e, t = +t, this._point) {
			var n = this._x2 - e, r = this._y2 - t;
			this._l23_a = Math.sqrt(this._l23_2a = (n * n + r * r) ** +this._alpha);
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
			case 3: this._point = 4;
			default: mu(this, e, t);
		}
		this._l01_a = this._l12_a, this._l12_a = this._l23_a, this._l01_2a = this._l12_2a, this._l12_2a = this._l23_2a, this._x0 = this._x1, this._x1 = this._x2, this._x2 = e, this._y0 = this._y1, this._y1 = this._y2, this._y2 = t;
	}
};
var bu = (function e(t) {
	function n(e) {
		return t ? new yu(e, t) : new fu(e, 0);
	}
	return n.alpha = function(t) {
		return e(+t);
	}, n;
})(.5);
// ../../node_modules/d3-shape/src/curve/linearClosed.js
function xu(e) {
	this._context = e;
}
xu.prototype = {
	areaStart: Zl,
	areaEnd: Zl,
	lineStart: function() {
		this._point = 0;
	},
	lineEnd: function() {
		this._point && this._context.closePath();
	},
	point: function(e, t) {
		e = +e, t = +t, this._point ? this._context.lineTo(e, t) : (this._point = 1, this._context.moveTo(e, t));
	}
};
function Su(e) {
	return new xu(e);
}
// ../../node_modules/d3-shape/src/curve/monotone.js
function Cu(e) {
	return e < 0 ? -1 : 1;
}
function wu(e, t, n) {
	var r = e._x1 - e._x0, i = t - e._x1, a = (e._y1 - e._y0) / (r || i < 0 && -0), o = (n - e._y1) / (i || r < 0 && -0), s = (a * i + o * r) / (r + i);
	return (Cu(a) + Cu(o)) * Math.min(Math.abs(a), Math.abs(o), .5 * Math.abs(s)) || 0;
}
function Tu(e, t) {
	var n = e._x1 - e._x0;
	return n ? (3 * (e._y1 - e._y0) / n - t) / 2 : t;
}
function Eu(e, t, n) {
	var r = e._x0, i = e._y0, a = e._x1, o = e._y1, s = (a - r) / 3;
	e._context.bezierCurveTo(r + s, i + s * t, a - s, o - s * n, a, o);
}
function Du(e) {
	this._context = e;
}
Du.prototype = {
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
			case 3: Eu(this, this._t0, Tu(this, this._t0));
		}
		(this._line || this._line !== 0 && this._point === 1) && this._context.closePath(), this._line = 1 - this._line;
	},
	point: function(e, t) {
		var n = NaN;
		if (e = +e, t = +t, e !== this._x1 || t !== this._y1) {
			switch (this._point) {
				case 0:
					this._point = 1, this._line ? this._context.lineTo(e, t) : this._context.moveTo(e, t);
					break;
				case 1:
					this._point = 2;
					break;
				case 2:
					this._point = 3, Eu(this, Tu(this, n = wu(this, e, t)), n);
					break;
				default: Eu(this, this._t0, n = wu(this, e, t));
			}
			this._x0 = this._x1, this._x1 = e, this._y0 = this._y1, this._y1 = t, this._t0 = n;
		}
	}
};
function Ou(e) {
	this._context = new ku(e);
}
(Ou.prototype = Object.create(Du.prototype)).point = function(e, t) {
	Du.prototype.point.call(this, t, e);
};
function ku(e) {
	this._context = e;
}
ku.prototype = {
	moveTo: function(e, t) {
		this._context.moveTo(t, e);
	},
	closePath: function() {
		this._context.closePath();
	},
	lineTo: function(e, t) {
		this._context.lineTo(t, e);
	},
	bezierCurveTo: function(e, t, n, r, i, a) {
		this._context.bezierCurveTo(t, e, r, n, a, i);
	}
};
function Au(e) {
	return new Du(e);
}
function ju(e) {
	return new Ou(e);
}
// ../../node_modules/d3-shape/src/curve/natural.js
function Mu(e) {
	this._context = e;
}
Mu.prototype = {
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
		var e = this._x, t = this._y, n = e.length;
		if (n) {
			if (this._line ? this._context.lineTo(e[0], t[0]) : this._context.moveTo(e[0], t[0]), n === 2) this._context.lineTo(e[1], t[1]);
			else for (var r = Nu(e), i = Nu(t), a = 0, o = 1; o < n; ++a, ++o) this._context.bezierCurveTo(r[0][a], i[0][a], r[1][a], i[1][a], e[o], t[o]);
		}
		(this._line || this._line !== 0 && n === 1) && this._context.closePath(), this._line = 1 - this._line, this._x = this._y = null;
	},
	point: function(e, t) {
		this._x.push(+e), this._y.push(+t);
	}
};
function Nu(e) {
	var t, n = e.length - 1, r, i = Array(n), a = Array(n), o = Array(n);
	for (i[0] = 0, a[0] = 2, o[0] = e[0] + 2 * e[1], t = 1; t < n - 1; ++t) i[t] = 1, a[t] = 4, o[t] = 4 * e[t] + 2 * e[t + 1];
	for (i[n - 1] = 2, a[n - 1] = 7, o[n - 1] = 8 * e[n - 1] + e[n], t = 1; t < n; ++t) r = i[t] / a[t - 1], a[t] -= r, o[t] -= r * o[t - 1];
	for (i[n - 1] = o[n - 1] / a[n - 1], t = n - 2; t >= 0; --t) i[t] = (o[t] - i[t + 1]) / a[t];
	for (a[n - 1] = (e[n] + i[n - 1]) / 2, t = 0; t < n - 1; ++t) a[t] = 2 * e[t + 1] - i[t + 1];
	return [i, a];
}
function Pu(e) {
	return new Mu(e);
}
// ../../node_modules/d3-shape/src/curve/step.js
function Fu(e, t) {
	this._context = e, this._t = t;
}
Fu.prototype = {
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
	point: function(e, t) {
		switch (e = +e, t = +t, this._point) {
			case 0:
				this._point = 1, this._line ? this._context.lineTo(e, t) : this._context.moveTo(e, t);
				break;
			case 1: this._point = 2;
			default: if (this._t <= 0) this._context.lineTo(this._x, t), this._context.lineTo(e, t);
			else {
				var n = this._x * (1 - this._t) + e * this._t;
				this._context.lineTo(n, this._y), this._context.lineTo(n, t);
			}
		}
		this._x = e, this._y = t;
	}
};
function Iu(e) {
	return new Fu(e, .5);
}
function Lu(e) {
	return new Fu(e, 0);
}
function Ru(e) {
	return new Fu(e, 1);
}
// ../../node_modules/d3-axis/src/identity.js
function zu(e) {
	return e;
}
// ../../node_modules/d3-axis/src/axis.js
var Bu = 1, Vu = 2, Hu = 3, Uu = 4, Wu = 1e-6;
function Gu(e) {
	return "translate(" + e + ",0)";
}
function Ku(e) {
	return "translate(0," + e + ")";
}
function qu(e) {
	return (t) => +e(t);
}
function Ju(e, t) {
	return t = Math.max(0, e.bandwidth() - t * 2) / 2, e.round() && (t = Math.round(t)), (n) => +e(n) + t;
}
function Yu() {
	return !this.__axis;
}
function Xu(e, t) {
	var n = [], r = null, i = null, a = 6, o = 6, s = 3, c = typeof window < "u" && window.devicePixelRatio > 1 ? 0 : .5, l = e === Bu || e === Uu ? -1 : 1, u = e === Uu || e === Vu ? "x" : "y", d = e === Bu || e === Hu ? Gu : Ku;
	function f(f) {
		var p = r ?? (t.ticks ? t.ticks.apply(t, n) : t.domain()), m = i ?? (t.tickFormat ? t.tickFormat.apply(t, n) : zu), h = Math.max(a, 0) + s, g = t.range(), _ = +g[0] + c, v = +g[g.length - 1] + c, y = (t.bandwidth ? Ju : qu)(t.copy(), c), b = f.selection ? f.selection() : f, x = b.selectAll(".domain").data([null]), S = b.selectAll(".tick").data(p, t).order(), C = S.exit(), w = S.enter().append("g").attr("class", "tick"), T = S.select("line"), E = S.select("text");
		x = x.merge(x.enter().insert("path", ".tick").attr("class", "domain").attr("stroke", "currentColor")), S = S.merge(w), T = T.merge(w.append("line").attr("stroke", "currentColor").attr(u + "2", l * a)), E = E.merge(w.append("text").attr("fill", "currentColor").attr(u, l * h).attr("dy", e === Bu ? "0em" : e === Hu ? "0.71em" : "0.32em")), f !== b && (x = x.transition(f), S = S.transition(f), T = T.transition(f), E = E.transition(f), C = C.transition(f).attr("opacity", Wu).attr("transform", function(e) {
			return isFinite(e = y(e)) ? d(e + c) : this.getAttribute("transform");
		}), w.attr("opacity", Wu).attr("transform", function(e) {
			var t = this.parentNode.__axis;
			return d((t && isFinite(t = t(e)) ? t : y(e)) + c);
		})), C.remove(), x.attr("d", e === Uu || e === Vu ? o ? "M" + l * o + "," + _ + "H" + c + "V" + v + "H" + l * o : "M" + c + "," + _ + "V" + v : o ? "M" + _ + "," + l * o + "V" + c + "H" + v + "V" + l * o : "M" + _ + "," + c + "H" + v), S.attr("opacity", 1).attr("transform", function(e) {
			return d(y(e) + c);
		}), T.attr(u + "2", l * a), E.attr(u, l * h).text(m), b.filter(Yu).attr("fill", "none").attr("font-size", 10).attr("font-family", "sans-serif").attr("text-anchor", e === Vu ? "start" : e === Uu ? "end" : "middle"), b.each(function() {
			this.__axis = y;
		});
	}
	return f.scale = function(e) {
		return arguments.length ? (t = e, f) : t;
	}, f.ticks = function() {
		return n = Array.from(arguments), f;
	}, f.tickArguments = function(e) {
		return arguments.length ? (n = e == null ? [] : Array.from(e), f) : n.slice();
	}, f.tickValues = function(e) {
		return arguments.length ? (r = e == null ? null : Array.from(e), f) : r && r.slice();
	}, f.tickFormat = function(e) {
		return arguments.length ? (i = e, f) : i;
	}, f.tickSize = function(e) {
		return arguments.length ? (a = o = +e, f) : a;
	}, f.tickSizeInner = function(e) {
		return arguments.length ? (a = +e, f) : a;
	}, f.tickSizeOuter = function(e) {
		return arguments.length ? (o = +e, f) : o;
	}, f.tickPadding = function(e) {
		return arguments.length ? (s = +e, f) : s;
	}, f.offset = function(e) {
		return arguments.length ? (c = +e, f) : c;
	}, f;
}
function Zu(e) {
	return Xu(Bu, e);
}
function Qu(e) {
	return Xu(Vu, e);
}
function $u(e) {
	return Xu(Hu, e);
}
function ed(e) {
	return Xu(Uu, e);
}
// ../../node_modules/d3-hierarchy/src/hierarchy/count.js
function td(e) {
	var t = 0, n = e.children, r = n && n.length;
	if (!r) t = 1;
	else for (; --r >= 0;) t += n[r].value;
	e.value = t;
}
function nd() {
	return this.eachAfter(td);
}
// ../../node_modules/d3-hierarchy/src/hierarchy/each.js
function rd(e, t) {
	let n = -1;
	for (let r of this) e.call(t, r, ++n, this);
	return this;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/eachBefore.js
function id(e, t) {
	for (var n = this, r = [n], i, a, o = -1; n = r.pop();) if (e.call(t, n, ++o, this), i = n.children) for (a = i.length - 1; a >= 0; --a) r.push(i[a]);
	return this;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/eachAfter.js
function ad(e, t) {
	for (var n = this, r = [n], i = [], a, o, s, c = -1; n = r.pop();) if (i.push(n), a = n.children) for (o = 0, s = a.length; o < s; ++o) r.push(a[o]);
	for (; n = i.pop();) e.call(t, n, ++c, this);
	return this;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/find.js
function od(e, t) {
	let n = -1;
	for (let r of this) if (e.call(t, r, ++n, this)) return r;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/sum.js
function sd(e) {
	return this.eachAfter(function(t) {
		for (var n = +e(t.data) || 0, r = t.children, i = r && r.length; --i >= 0;) n += r[i].value;
		t.value = n;
	});
}
// ../../node_modules/d3-hierarchy/src/hierarchy/sort.js
function cd(e) {
	return this.eachBefore(function(t) {
		t.children && t.children.sort(e);
	});
}
// ../../node_modules/d3-hierarchy/src/hierarchy/path.js
function ld(e) {
	for (var t = this, n = ud(t, e), r = [t]; t !== n;) t = t.parent, r.push(t);
	for (var i = r.length; e !== n;) r.splice(i, 0, e), e = e.parent;
	return r;
}
function ud(e, t) {
	if (e === t) return e;
	var n = e.ancestors(), r = t.ancestors(), i = null;
	for (e = n.pop(), t = r.pop(); e === t;) i = e, e = n.pop(), t = r.pop();
	return i;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/ancestors.js
function dd() {
	for (var e = this, t = [e]; e = e.parent;) t.push(e);
	return t;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/descendants.js
function fd() {
	return Array.from(this);
}
// ../../node_modules/d3-hierarchy/src/hierarchy/leaves.js
function pd() {
	var e = [];
	return this.eachBefore(function(t) {
		t.children || e.push(t);
	}), e;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/links.js
function md() {
	var e = this, t = [];
	return e.each(function(n) {
		n !== e && t.push({
			source: n.parent,
			target: n
		});
	}), t;
}
// ../../node_modules/d3-hierarchy/src/hierarchy/iterator.js
function* hd() {
	var e = this, t, n = [e], r, i, a;
	do
		for (t = n.reverse(), n = []; e = t.pop();) if (yield e, r = e.children) for (i = 0, a = r.length; i < a; ++i) n.push(r[i]);
	while (n.length);
}
// ../../node_modules/d3-hierarchy/src/hierarchy/index.js
function gd(e, t) {
	e instanceof Map ? (e = [void 0, e], t === void 0 && (t = yd)) : t === void 0 && (t = vd);
	for (var n = new Sd(e), r, i = [n], a, o, s, c; r = i.pop();) if ((o = t(r.data)) && (c = (o = Array.from(o)).length)) for (r.children = o, s = c - 1; s >= 0; --s) i.push(a = o[s] = new Sd(o[s])), a.parent = r, a.depth = r.depth + 1;
	return n.eachBefore(xd);
}
function _d() {
	return gd(this).eachBefore(bd);
}
function vd(e) {
	return e.children;
}
function yd(e) {
	return Array.isArray(e) ? e[1] : null;
}
function bd(e) {
	e.data.value !== void 0 && (e.value = e.data.value), e.data = e.data.data;
}
function xd(e) {
	var t = 0;
	do
		e.height = t;
	while ((e = e.parent) && e.height < ++t);
}
function Sd(e) {
	this.data = e, this.depth = this.height = 0, this.parent = null;
}
Sd.prototype = gd.prototype = {
	constructor: Sd,
	count: nd,
	each: rd,
	eachAfter: ad,
	eachBefore: id,
	find: od,
	sum: sd,
	sort: cd,
	path: ld,
	ancestors: dd,
	descendants: fd,
	leaves: pd,
	links: md,
	copy: _d,
	[Symbol.iterator]: hd
};
// ../../node_modules/d3-hierarchy/src/accessors.js
function Cd(e) {
	if (typeof e != "function") throw Error();
	return e;
}
// ../../node_modules/d3-hierarchy/src/constant.js
function wd() {
	return 0;
}
function Td(e) {
	return function() {
		return e;
	};
}
// ../../node_modules/d3-hierarchy/src/treemap/round.js
function Ed(e) {
	e.x0 = Math.round(e.x0), e.y0 = Math.round(e.y0), e.x1 = Math.round(e.x1), e.y1 = Math.round(e.y1);
}
// ../../node_modules/d3-hierarchy/src/treemap/dice.js
function Dd(e, t, n, r, i) {
	for (var a = e.children, o, s = -1, c = a.length, l = e.value && (r - t) / e.value; ++s < c;) o = a[s], o.y0 = n, o.y1 = i, o.x0 = t, o.x1 = t += o.value * l;
}
// ../../node_modules/d3-hierarchy/src/treemap/slice.js
function Od(e, t, n, r, i) {
	for (var a = e.children, o, s = -1, c = a.length, l = e.value && (i - n) / e.value; ++s < c;) o = a[s], o.x0 = t, o.x1 = r, o.y0 = n, o.y1 = n += o.value * l;
}
// ../../node_modules/d3-hierarchy/src/treemap/squarify.js
var kd = (1 + Math.sqrt(5)) / 2;
function Ad(e, t, n, r, i, a) {
	for (var o = [], s = t.children, c, l, u = 0, d = 0, f = s.length, p, m, h = t.value, g, _, v, y, b, x, S; u < f;) {
		p = i - n, m = a - r;
		do
			g = s[d++].value;
		while (!g && d < f);
		for (_ = v = g, x = Math.max(m / p, p / m) / (h * e), S = g * g * x, b = Math.max(v / S, S / _); d < f; ++d) {
			if (g += l = s[d].value, l < _ && (_ = l), l > v && (v = l), S = g * g * x, y = Math.max(v / S, S / _), y > b) {
				g -= l;
				break;
			}
			b = y;
		}
		o.push(c = {
			value: g,
			dice: p < m,
			children: s.slice(u, d)
		}), c.dice ? Dd(c, n, r, i, h ? r += m * g / h : a) : Od(c, n, r, h ? n += p * g / h : i, a), h -= g, u = d;
	}
	return o;
}
var jd = (function e(t) {
	function n(e, n, r, i, a) {
		Ad(t, e, n, r, i, a);
	}
	return n.ratio = function(t) {
		return e((t = +t) > 1 ? t : 1);
	}, n;
})(kd);
// ../../node_modules/d3-hierarchy/src/treemap/index.js
function Md() {
	var e = jd, t = !1, n = 1, r = 1, i = [0], a = wd, o = wd, s = wd, c = wd, l = wd;
	function u(e) {
		return e.x0 = e.y0 = 0, e.x1 = n, e.y1 = r, e.eachBefore(d), i = [0], t && e.eachBefore(Ed), e;
	}
	function d(t) {
		var n = i[t.depth], r = t.x0 + n, u = t.y0 + n, d = t.x1 - n, f = t.y1 - n;
		d < r && (r = d = (r + d) / 2), f < u && (u = f = (u + f) / 2), t.x0 = r, t.y0 = u, t.x1 = d, t.y1 = f, t.children && (n = i[t.depth + 1] = a(t) / 2, r += l(t) - n, u += o(t) - n, d -= s(t) - n, f -= c(t) - n, d < r && (r = d = (r + d) / 2), f < u && (u = f = (u + f) / 2), e(t, r, u, d, f));
	}
	return u.round = function(e) {
		return arguments.length ? (t = !!e, u) : t;
	}, u.size = function(e) {
		return arguments.length ? (n = +e[0], r = +e[1], u) : [n, r];
	}, u.tile = function(t) {
		return arguments.length ? (e = Cd(t), u) : e;
	}, u.padding = function(e) {
		return arguments.length ? u.paddingInner(e).paddingOuter(e) : u.paddingInner();
	}, u.paddingInner = function(e) {
		return arguments.length ? (a = typeof e == "function" ? e : Td(+e), u) : a;
	}, u.paddingOuter = function(e) {
		return arguments.length ? u.paddingTop(e).paddingRight(e).paddingBottom(e).paddingLeft(e) : u.paddingTop();
	}, u.paddingTop = function(e) {
		return arguments.length ? (o = typeof e == "function" ? e : Td(+e), u) : o;
	}, u.paddingRight = function(e) {
		return arguments.length ? (s = typeof e == "function" ? e : Td(+e), u) : s;
	}, u.paddingBottom = function(e) {
		return arguments.length ? (c = typeof e == "function" ? e : Td(+e), u) : c;
	}, u.paddingLeft = function(e) {
		return arguments.length ? (l = typeof e == "function" ? e : Td(+e), u) : l;
	}, u;
}
// ../../node_modules/d3-hierarchy/src/treemap/binary.js
function Nd(e, t, n, r, i) {
	var a = e.children, o, s = a.length, c, l = Array(s + 1);
	for (l[0] = c = o = 0; o < s; ++o) l[o + 1] = c += a[o].value;
	u(0, s, e.value, t, n, r, i);
	function u(e, t, n, r, i, o, s) {
		if (e >= t - 1) {
			var c = a[e];
			c.x0 = r, c.y0 = i, c.x1 = o, c.y1 = s;
		} else {
			for (var d = l[e], f = n / 2 + d, p = e + 1, m = t - 1; p < m;) {
				var h = p + m >>> 1;
				l[h] < f ? p = h + 1 : m = h;
			}
			f - l[p - 1] < l[p] - f && e + 1 < p && --p;
			var g = l[p] - d, _ = n - g;
			if (o - r > s - i) {
				var v = n ? (r * _ + o * g) / n : o;
				u(e, p, g, r, i, v, s), u(p, t, _, v, i, o, s);
			} else {
				var y = n ? (i * _ + s * g) / n : s;
				u(e, p, g, r, i, o, y), u(p, t, _, r, y, o, s);
			}
		}
	}
}
// ../../node_modules/d3-hierarchy/src/treemap/sliceDice.js
function Pd(e, t, n, r, i) {
	(e.depth & 1 ? Od : Dd)(e, t, n, r, i);
}
// ../../node_modules/d3-hierarchy/src/treemap/resquarify.js
var Fd = (function e(t) {
	function n(e, n, r, i, a) {
		if ((o = e._squarify) && o.ratio === t) for (var o, s, c, l, u = -1, d, f = o.length, p = e.value; ++u < f;) {
			for (s = o[u], c = s.children, l = s.value = 0, d = c.length; l < d; ++l) s.value += c[l].value;
			s.dice ? Dd(s, n, r, i, p ? r += (a - r) * s.value / p : a) : Od(s, n, r, p ? n += (i - n) * s.value / p : i, a), p -= s.value;
		}
		else e._squarify = o = Ad(t, e, n, r, i, a), o.ratio = t;
	}
	return n.ratio = function(t) {
		return e((t = +t) > 1 ? t : 1);
	}, n;
})(kd), Id = (e) => () => e;
// ../../node_modules/d3-zoom/src/event.js
function Ld(e, { sourceEvent: t, target: n, transform: r, dispatch: i }) {
	Object.defineProperties(this, {
		type: {
			value: e,
			enumerable: !0,
			configurable: !0
		},
		sourceEvent: {
			value: t,
			enumerable: !0,
			configurable: !0
		},
		target: {
			value: n,
			enumerable: !0,
			configurable: !0
		},
		transform: {
			value: r,
			enumerable: !0,
			configurable: !0
		},
		_: { value: i }
	});
}
// ../../node_modules/d3-zoom/src/transform.js
function Rd(e, t, n) {
	this.k = e, this.x = t, this.y = n;
}
Rd.prototype = {
	constructor: Rd,
	scale: function(e) {
		return e === 1 ? this : new Rd(this.k * e, this.x, this.y);
	},
	translate: function(e, t) {
		return e === 0 & t === 0 ? this : new Rd(this.k, this.x + this.k * e, this.y + this.k * t);
	},
	apply: function(e) {
		return [e[0] * this.k + this.x, e[1] * this.k + this.y];
	},
	applyX: function(e) {
		return e * this.k + this.x;
	},
	applyY: function(e) {
		return e * this.k + this.y;
	},
	invert: function(e) {
		return [(e[0] - this.x) / this.k, (e[1] - this.y) / this.k];
	},
	invertX: function(e) {
		return (e - this.x) / this.k;
	},
	invertY: function(e) {
		return (e - this.y) / this.k;
	},
	rescaleX: function(e) {
		return e.copy().domain(e.range().map(this.invertX, this).map(e.invert, e));
	},
	rescaleY: function(e) {
		return e.copy().domain(e.range().map(this.invertY, this).map(e.invert, e));
	},
	toString: function() {
		return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
	}
};
var zd = new Rd(1, 0, 0);
Bd.prototype = Rd.prototype;
function Bd(e) {
	for (; !e.__zoom;) if (!(e = e.parentNode)) return zd;
	return e.__zoom;
}
// ../../node_modules/d3-zoom/src/noevent.js
function Vd(e) {
	e.stopImmediatePropagation();
}
function Hd(e) {
	e.preventDefault(), e.stopImmediatePropagation();
}
// ../../node_modules/d3-zoom/src/zoom.js
function Ud(e) {
	return (!e.ctrlKey || e.type === "wheel") && !e.button;
}
function Wd() {
	var e = this;
	return e instanceof SVGElement ? (e = e.ownerSVGElement || e, e.hasAttribute("viewBox") ? (e = e.viewBox.baseVal, [[e.x, e.y], [e.x + e.width, e.y + e.height]]) : [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]]) : [[0, 0], [e.clientWidth, e.clientHeight]];
}
function Gd() {
	return this.__zoom || zd;
}
function Kd(e) {
	return -e.deltaY * (e.deltaMode === 1 ? .05 : e.deltaMode ? 1 : .002) * (e.ctrlKey ? 10 : 1);
}
function qd() {
	return navigator.maxTouchPoints || "ontouchstart" in this;
}
function Jd(e, t, n) {
	var r = e.invertX(t[0][0]) - n[0][0], i = e.invertX(t[1][0]) - n[1][0], a = e.invertY(t[0][1]) - n[0][1], o = e.invertY(t[1][1]) - n[1][1];
	return e.translate(i > r ? (r + i) / 2 : Math.min(0, r) || Math.max(0, i), o > a ? (a + o) / 2 : Math.min(0, a) || Math.max(0, o));
}
function Yd() {
	var e = Ud, t = Wd, n = Jd, r = Kd, i = qd, a = [0, Infinity], o = [[-Infinity, -Infinity], [Infinity, Infinity]], s = 250, c = qa, l = fi("start", "zoom", "end"), u, d, f, p = 500, m = 150, h = 0, g = 10;
	function _(e) {
		e.property("__zoom", Gd).on("wheel.zoom", w, { passive: !1 }).on("mousedown.zoom", T).on("dblclick.zoom", E).filter(i).on("touchstart.zoom", D).on("touchmove.zoom", O).on("touchend.zoom touchcancel.zoom", k).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
	}
	_.transform = function(e, t, n, r) {
		var i = e.selection ? e.selection() : e;
		i.property("__zoom", Gd), e === i ? i.interrupt().each(function() {
			S(this, arguments).event(r).start().zoom(null, typeof t == "function" ? t.apply(this, arguments) : t).end();
		}) : x(e, t, n, r);
	}, _.scaleBy = function(e, t, n, r) {
		_.scaleTo(e, function() {
			return this.__zoom.k * (typeof t == "function" ? t.apply(this, arguments) : t);
		}, n, r);
	}, _.scaleTo = function(e, r, i, a) {
		_.transform(e, function() {
			var e = t.apply(this, arguments), a = this.__zoom, s = i == null ? b(e) : typeof i == "function" ? i.apply(this, arguments) : i, c = a.invert(s), l = typeof r == "function" ? r.apply(this, arguments) : r;
			return n(y(v(a, l), s, c), e, o);
		}, i, a);
	}, _.translateBy = function(e, r, i, a) {
		_.transform(e, function() {
			return n(this.__zoom.translate(typeof r == "function" ? r.apply(this, arguments) : r, typeof i == "function" ? i.apply(this, arguments) : i), t.apply(this, arguments), o);
		}, null, a);
	}, _.translateTo = function(e, r, i, a, s) {
		_.transform(e, function() {
			var e = t.apply(this, arguments), s = this.__zoom, c = a == null ? b(e) : typeof a == "function" ? a.apply(this, arguments) : a;
			return n(zd.translate(c[0], c[1]).scale(s.k).translate(typeof r == "function" ? -r.apply(this, arguments) : -r, typeof i == "function" ? -i.apply(this, arguments) : -i), e, o);
		}, a, s);
	};
	function v(e, t) {
		return t = Math.max(a[0], Math.min(a[1], t)), t === e.k ? e : new Rd(t, e.x, e.y);
	}
	function y(e, t, n) {
		var r = t[0] - n[0] * e.k, i = t[1] - n[1] * e.k;
		return r === e.x && i === e.y ? e : new Rd(e.k, r, i);
	}
	function b(e) {
		return [(+e[0][0] + +e[1][0]) / 2, (+e[0][1] + +e[1][1]) / 2];
	}
	function x(e, n, r, i) {
		e.on("start.zoom", function() {
			S(this, arguments).event(i).start();
		}).on("interrupt.zoom end.zoom", function() {
			S(this, arguments).event(i).end();
		}).tween("zoom", function() {
			var e = this, a = arguments, o = S(e, a).event(i), s = t.apply(e, a), l = r == null ? b(s) : typeof r == "function" ? r.apply(e, a) : r, u = Math.max(s[1][0] - s[0][0], s[1][1] - s[0][1]), d = e.__zoom, f = typeof n == "function" ? n.apply(e, a) : n, p = c(d.invert(l).concat(u / d.k), f.invert(l).concat(u / f.k));
			return function(e) {
				if (e === 1) e = f;
				else {
					var t = p(e), n = u / t[2];
					e = new Rd(n, l[0] - t[0] * n, l[1] - t[1] * n);
				}
				o.zoom(null, e);
			};
		});
	}
	function S(e, t, n) {
		return !n && e.__zooming || new C(e, t);
	}
	function C(e, n) {
		this.that = e, this.args = n, this.active = 0, this.sourceEvent = null, this.extent = t.apply(e, n), this.taps = 0;
	}
	C.prototype = {
		event: function(e) {
			return e && (this.sourceEvent = e), this;
		},
		start: function() {
			return ++this.active === 1 && (this.that.__zooming = this, this.emit("start")), this;
		},
		zoom: function(e, t) {
			return this.mouse && e !== "mouse" && (this.mouse[1] = t.invert(this.mouse[0])), this.touch0 && e !== "touch" && (this.touch0[1] = t.invert(this.touch0[0])), this.touch1 && e !== "touch" && (this.touch1[1] = t.invert(this.touch1[0])), this.that.__zoom = t, this.emit("zoom"), this;
		},
		end: function() {
			return --this.active === 0 && (delete this.that.__zooming, this.emit("end")), this;
		},
		emit: function(e) {
			var t = M(this.that).datum();
			l.call(e, this.that, new Ld(e, {
				sourceEvent: this.sourceEvent,
				target: _,
				type: e,
				transform: this.that.__zoom,
				dispatch: l
			}), t);
		}
	};
	function w(t, ...i) {
		if (!e.apply(this, arguments)) return;
		var s = S(this, i).event(t), c = this.__zoom, l = Math.max(a[0], Math.min(a[1], c.k * 2 ** r.apply(this, arguments))), u = Dt(t);
		if (s.wheel) (s.mouse[0][0] !== u[0] || s.mouse[0][1] !== u[1]) && (s.mouse[1] = c.invert(s.mouse[0] = u)), clearTimeout(s.wheel);
		else if (c.k === l) return;
		else s.mouse = [u, c.invert(u)], Co(this), s.start();
		Hd(t), s.wheel = setTimeout(d, m), s.zoom("mouse", n(y(v(c, l), s.mouse[0], s.mouse[1]), s.extent, o));
		function d() {
			s.wheel = null, s.end();
		}
	}
	function T(t, ...r) {
		if (f || !e.apply(this, arguments)) return;
		var i = t.currentTarget, a = S(this, r, !0).event(t), s = M(t.view).on("mousemove.zoom", d, !0).on("mouseup.zoom", p, !0), c = Dt(t, i), l = t.clientX, u = t.clientY;
		xi(t.view), Vd(t), a.mouse = [c, this.__zoom.invert(c)], Co(this), a.start();
		function d(e) {
			if (Hd(e), !a.moved) {
				var t = e.clientX - l, r = e.clientY - u;
				a.moved = t * t + r * r > h;
			}
			a.event(e).zoom("mouse", n(y(a.that.__zoom, a.mouse[0] = Dt(e, i), a.mouse[1]), a.extent, o));
		}
		function p(e) {
			s.on("mousemove.zoom mouseup.zoom", null), Si(e.view, a.moved), Hd(e), a.event(e).end();
		}
	}
	function E(r, ...i) {
		if (e.apply(this, arguments)) {
			var a = this.__zoom, c = Dt(r.changedTouches ? r.changedTouches[0] : r, this), l = a.invert(c), u = a.k * (r.shiftKey ? .5 : 2), d = n(y(v(a, u), c, l), t.apply(this, i), o);
			Hd(r), s > 0 ? M(this).transition().duration(s).call(x, d, c, r) : M(this).call(_.transform, d, c, r);
		}
	}
	function D(t, ...n) {
		if (e.apply(this, arguments)) {
			var r = t.touches, i = r.length, a = S(this, n, t.changedTouches.length === i).event(t), o, s, c, l;
			for (Vd(t), s = 0; s < i; ++s) c = r[s], l = Dt(c, this), l = [
				l,
				this.__zoom.invert(l),
				c.identifier
			], a.touch0 ? !a.touch1 && a.touch0[2] !== l[2] && (a.touch1 = l, a.taps = 0) : (a.touch0 = l, o = !0, a.taps = 1 + !!u);
			u &&= clearTimeout(u), o && (a.taps < 2 && (d = l[0], u = setTimeout(function() {
				u = null;
			}, p)), Co(this), a.start());
		}
	}
	function O(e, ...t) {
		if (this.__zooming) {
			var r = S(this, t).event(e), i = e.changedTouches, a = i.length, s, c, l, u;
			for (Hd(e), s = 0; s < a; ++s) c = i[s], l = Dt(c, this), r.touch0 && r.touch0[2] === c.identifier ? r.touch0[0] = l : r.touch1 && r.touch1[2] === c.identifier && (r.touch1[0] = l);
			if (c = r.that.__zoom, r.touch1) {
				var d = r.touch0[0], f = r.touch0[1], p = r.touch1[0], m = r.touch1[1], h = (h = p[0] - d[0]) * h + (h = p[1] - d[1]) * h, g = (g = m[0] - f[0]) * g + (g = m[1] - f[1]) * g;
				c = v(c, Math.sqrt(h / g)), l = [(d[0] + p[0]) / 2, (d[1] + p[1]) / 2], u = [(f[0] + m[0]) / 2, (f[1] + m[1]) / 2];
			} else if (r.touch0) l = r.touch0[0], u = r.touch0[1];
			else return;
			r.zoom("touch", n(y(c, l, u), r.extent, o));
		}
	}
	function k(e, ...t) {
		if (this.__zooming) {
			var n = S(this, t).event(e), r = e.changedTouches, i = r.length, a, o;
			for (Vd(e), f && clearTimeout(f), f = setTimeout(function() {
				f = null;
			}, p), a = 0; a < i; ++a) o = r[a], n.touch0 && n.touch0[2] === o.identifier ? delete n.touch0 : n.touch1 && n.touch1[2] === o.identifier && delete n.touch1;
			if (n.touch1 && !n.touch0 && (n.touch0 = n.touch1, delete n.touch1), n.touch0) n.touch0[1] = this.__zoom.invert(n.touch0[0]);
			else if (n.end(), n.taps === 2 && (o = Dt(o, this), Math.hypot(d[0] - o[0], d[1] - o[1]) < g)) {
				var s = M(this).on("dblclick.zoom");
				s && s.apply(this, arguments);
			}
		}
	}
	return _.wheelDelta = function(e) {
		return arguments.length ? (r = typeof e == "function" ? e : Id(+e), _) : r;
	}, _.filter = function(t) {
		return arguments.length ? (e = typeof t == "function" ? t : Id(!!t), _) : e;
	}, _.touchable = function(e) {
		return arguments.length ? (i = typeof e == "function" ? e : Id(!!e), _) : i;
	}, _.extent = function(e) {
		return arguments.length ? (t = typeof e == "function" ? e : Id([[+e[0][0], +e[0][1]], [+e[1][0], +e[1][1]]]), _) : t;
	}, _.scaleExtent = function(e) {
		return arguments.length ? (a[0] = +e[0], a[1] = +e[1], _) : [a[0], a[1]];
	}, _.translateExtent = function(e) {
		return arguments.length ? (o[0][0] = +e[0][0], o[1][0] = +e[1][0], o[0][1] = +e[0][1], o[1][1] = +e[1][1], _) : [[o[0][0], o[0][1]], [o[1][0], o[1][1]]];
	}, _.constrain = function(e) {
		return arguments.length ? (n = e, _) : n;
	}, _.duration = function(e) {
		return arguments.length ? (s = +e, _) : s;
	}, _.interpolate = function(e) {
		return arguments.length ? (c = e, _) : c;
	}, _.on = function() {
		var e = l.on.apply(l, arguments);
		return e === l ? _ : e;
	}, _.clickDistance = function(e) {
		return arguments.length ? (h = (e = +e) * e, _) : Math.sqrt(h);
	}, _.tapDistance = function(e) {
		return arguments.length ? (g = +e, _) : g;
	}, _;
}
// ../../node_modules/billboard.js/dist-esm/billboard.js
var F = function() {
	return F = Object.assign || function(e) {
		for (var t, n = 1, r = arguments.length; n < r; n++) for (var i in t = arguments[n], t) Object.prototype.hasOwnProperty.call(t, i) && (e[i] = t[i]);
		return e;
	}, F.apply(this, arguments);
};
function Xd(e, t, n) {
	if (n || arguments.length === 2) for (var r = 0, i = t.length, a; r < i; r++) (a || !(r in t)) && (a ||= Array.prototype.slice.call(t, 0, r), a[r] = t[r]);
	return e.concat(a || Array.prototype.slice.call(t));
}
var I = {
	button: "bb-button",
	chart: "bb-chart",
	empty: "bb-empty",
	main: "bb-main",
	target: "bb-target",
	EXPANDED: "_expanded_",
	dummy: "_dummy_"
}, L = {
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
}, Zd = {
	area: "bb-area",
	areas: "bb-areas"
}, Qd = {
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
}, $d = {
	bar: "bb-bar",
	bars: "bb-bars",
	chartBar: "bb-chart-bar",
	chartBars: "bb-chart-bars",
	barConnectLine: "bb-bar-connectLine"
}, ef = {
	candlestick: "bb-candlestick",
	candlesticks: "bb-candlesticks",
	chartCandlestick: "bb-chart-candlestick",
	chartCandlesticks: "bb-chart-candlesticks",
	valueDown: "bb-value-down",
	valueUp: "bb-value-up"
}, tf = {
	chartCircles: "bb-chart-circles",
	circle: "bb-circle",
	circles: "bb-circles"
}, nf = {
	colorPattern: "bb-color-pattern",
	colorScale: "bb-colorscale"
}, rf = {
	dragarea: "bb-dragarea",
	INCLUDED: "_included_"
}, af = {
	funnel: "bb-funnel",
	chartFunnel: "bb-chart-funnel",
	chartFunnels: "bb-chart-funnels",
	funnelBackground: "bb-funnel-background"
}, of = {
	chartArcsGaugeMax: "bb-chart-arcs-gauge-max",
	chartArcsGaugeMin: "bb-chart-arcs-gauge-min",
	chartArcsGaugeUnit: "bb-chart-arcs-gauge-unit",
	chartArcsGaugeTitle: "bb-chart-arcs-gauge-title",
	gaugeValue: "bb-gauge-value"
}, R = {
	legend: "bb-legend",
	legendBackground: "bb-legend-background",
	legendItem: "bb-legend-item",
	legendItemEvent: "bb-legend-item-event",
	legendItemHidden: "bb-legend-item-hidden",
	legendItemPoint: "bb-legend-item-point",
	legendItemTile: "bb-legend-item-tile"
}, sf = {
	chartLine: "bb-chart-line",
	chartLines: "bb-chart-lines",
	line: "bb-line",
	lines: "bb-lines"
}, cf = {
	eventRect: "bb-event-rect",
	eventRects: "bb-event-rects",
	eventRectsMultiple: "bb-event-rects-multiple",
	eventRectsSingle: "bb-event-rects-single"
}, z = {
	focused: "bb-focused",
	defocused: "bb-defocused",
	legendItemFocused: "bb-legend-item-focused",
	xgridFocus: "bb-xgrid-focus",
	ygridFocus: "bb-ygrid-focus"
}, B = {
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
}, lf = {
	level: "bb-level",
	levels: "bb-levels"
}, uf = {
	chartRadar: "bb-chart-radar",
	chartRadars: "bb-chart-radars"
}, df = {
	region: "bb-region",
	regions: "bb-regions"
}, V = {
	selectedCircle: "bb-selected-circle",
	selectedCircles: "bb-selected-circles",
	SELECTED: "_selected_"
}, H = {
	shape: "bb-shape",
	shapes: "bb-shapes"
}, ff = {
	brush: "bb-brush",
	subchart: "bb-subchart"
}, pf = {
	chartText: "bb-chart-text",
	chartTexts: "bb-chart-texts",
	text: "bb-text",
	texts: "bb-texts",
	title: "bb-title",
	textBorderRect: "bb-text-border",
	textLabelImage: "bb-text-label-image",
	TextOverlapping: "text-overlapping"
}, mf = {
	tooltip: "bb-tooltip",
	tooltipContainer: "bb-tooltip-container",
	tooltipName: "bb-tooltip-name"
}, hf = {
	treemap: "bb-treemap",
	chartTreemap: "bb-chart-treemap",
	chartTreemaps: "bb-chart-treemaps"
}, gf = {
	buttonZoomReset: "bb-zoom-reset",
	zoomBrush: "bb-zoom-brush"
}, U = F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F(F({}, I), L), Zd), Qd), $d), ef), tf), nf), rf), of), R), sf), cf), z), af), B), uf), df), V), H), ff), pf), mf), hf), gf), _f = {
	boost_useCssRule: !1,
	boost_useWorker: !1
}, vf = {
	color_pattern: [],
	color_tiles: void 0,
	color_threshold: {},
	color_onover: void 0
}, yf = {
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
}, bf = {
	bindto: "#chart",
	background: {},
	clipPath: !0,
	svg_classname: void 0,
	size_width: void 0,
	size_height: void 0,
	padding: !0,
	padding_mode: void 0,
	padding_left: void 0,
	padding_right: void 0,
	padding_top: void 0,
	padding_bottom: void 0,
	resize_auto: !0,
	resize_timer: !0,
	onclick: void 0,
	onover: void 0,
	onout: void 0,
	onresize: void 0,
	onresized: void 0,
	onbeforeinit: void 0,
	oninit: void 0,
	onafterinit: void 0,
	onrendered: void 0,
	transition_duration: 250,
	plugins: [],
	render: {},
	regions: []
}, xf = {
	title_text: void 0,
	title_padding: {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0
	},
	title_position: "center"
}, Sf = {
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
	tooltip_onshow: function() {},
	tooltip_onhide: function() {},
	tooltip_onshown: function() {},
	tooltip_onhidden: function() {},
	tooltip_order: null
}, Cf = {
	data_x: void 0,
	data_idConverter: function(e) {
		return e;
	},
	data_names: {},
	data_classes: {},
	data_type: void 0,
	data_types: {},
	data_order: "desc",
	data_groups: [],
	data_groupsZeroAs: "positive",
	data_color: void 0,
	data_colors: {},
	data_labels: {},
	data_labels_backgroundColors: void 0,
	data_labels_colors: void 0,
	data_labels_position: {},
	data_labels_imgUrl: void 0,
	data_hide: !1,
	data_filter: void 0,
	data_onclick: function() {},
	data_onover: function() {},
	data_onout: function() {},
	data_onshown: void 0,
	data_onhidden: void 0,
	data_onmin: void 0,
	data_onmax: void 0,
	data_url: void 0,
	data_headers: void 0,
	data_json: void 0,
	data_rows: void 0,
	data_columns: void 0,
	data_mimeType: "csv",
	data_keys: void 0,
	data_empty_label_text: ""
}, wf = {
	interaction_enabled: !0,
	interaction_brighten: !0,
	interaction_inputType_mouse: !0,
	interaction_inputType_touch: {},
	interaction_onout: !0
};
function Tf() {
	return typeof globalThis == "object" && globalThis !== null && globalThis.Object === Object && globalThis || typeof global == "object" && global !== null && global.Object === Object && global || typeof self == "object" && self !== null && self.Object === Object && self || Function("return this")();
}
function Ef(e) {
	var t = typeof e?.requestAnimationFrame == "function" && typeof e?.cancelAnimationFrame == "function", n = typeof e?.requestIdleCallback == "function" && typeof e?.cancelIdleCallback == "function", r = function(e) {
		return setTimeout(e, 1);
	}, i = function(e) {
		return clearTimeout(e);
	};
	return [
		t ? e.requestAnimationFrame : r,
		t ? e.cancelAnimationFrame : i,
		n ? e.requestIdleCallback : r,
		n ? e.cancelIdleCallback : i
	];
}
var W = Tf(), Df = W?.document, Of = Ef(W), kf = Of[0], Af = Of[2], jf = /* @__PURE__ */ new Set(/* @__PURE__ */ "span.div.p.br.b.i.em.strong.u.s.sub.sup.ul.ol.li.dl.dt.dd.table.thead.tbody.tfoot.tr.th.td.caption.colgroup.col.hr.pre.code.blockquote.a.img.svg.g.path.circle.ellipse.rect.line.polyline.polygon.text.tspan.textPath.use.defs.symbol.clipPath.mask.linearGradient.radialGradient.stop.pattern.marker.title.desc".split(".")), Mf = /* @__PURE__ */ new Set(/* @__PURE__ */ "class.id.style.title.lang.dir.href.src.alt.width.height.colspan.rowspan.scope.headers.d.points.x.y.x1.x2.y1.y2.cx.cy.r.rx.ry.dx.dy.viewBox.preserveAspectRatio.transform.fill.fill-opacity.fill-rule.stroke.stroke-width.stroke-opacity.stroke-linecap.stroke-linejoin.stroke-dasharray.stroke-dashoffset.opacity.clip-path.clip-rule.mask.font-family.font-size.font-weight.font-style.text-anchor.dominant-baseline.offset.stop-color.stop-opacity.gradientUnits.gradientTransform.spreadMethod.patternUnits.patternTransform.marker-start.marker-mid.marker-end.markerWidth.markerHeight.refX.refY.xlink:href".split(".")), Nf = /* @__PURE__ */ new Set([
	"http:",
	"https:",
	"mailto:"
]), Pf = /* @__PURE__ */ new Set([
	"href",
	"src",
	"xlink:href"
]), Ff = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/, If = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/, Lf = /^<([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)>$/, Rf = /([a-zA-Z][\w:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, zf = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi, Bf = [
	"expression(",
	"behavior:",
	"binding:",
	"@import",
	"@charset",
	"-moz-binding:"
];
function Vf(e) {
	return e.replace(/&colon;/gi, ":").replace(/&newline;/gi, "\n").replace(/&tab;/gi, "	").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&apos;/gi, "'").replace(/&#(\d+);/gi, function(e, t) {
		return String.fromCharCode(parseInt(t, 10));
	}).replace(/&#x([0-9a-f]+);/gi, function(e, t) {
		return String.fromCharCode(parseInt(t, 16));
	});
}
function Hf(e) {
	var t = Vf(e).trim().replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
	if (!t || t.startsWith("#") || t.startsWith("/") || t.startsWith("./") || t.startsWith("../") || !t.includes(":")) return !0;
	var n = t.indexOf(":");
	if (n > 0) {
		var r = t.substring(0, n + 1);
		return Nf.has(r);
	}
	return !1;
}
function Uf(e) {
	var t = Vf(e).replace(/[\u0000-\u001f]/g, "");
	zf.lastIndex = 0;
	for (var n; (n = zf.exec(t)) !== null;) if (!Hf(n[1])) return null;
	for (var r = t.toLowerCase().replace(/\s/g, ""), i = 0, a = Bf; i < a.length; i++) {
		var o = a[i];
		if (r.includes(o)) return null;
	}
	return e;
}
var Wf = {
	"\"": "&quot;",
	"'": "&#39;",
	"`": "&#96;"
}, Gf = /["'`]/g;
function Kf(e) {
	return e.replace(Gf, function(e) {
		return Wf[e];
	});
}
function qf(e, t, n) {
	if (n === void 0 && (n = !1), Pf.has(e)) return Hf(t) ? n ? Kf(t) : t : null;
	if (e === "style") {
		var r = Uf(t);
		return r === null ? null : n ? Kf(r) : r;
	}
	var i = Vf(t).toLowerCase().replace(/\s/g, "");
	return /\bon\w+=/.test(i) ? null : n ? Kf(t) : t;
}
function Jf(e) {
	var t = e.match(Ff);
	return t ? t[1].toLowerCase() : null;
}
function Yf(e) {
	var t = Jf(e);
	return t !== null && jf.has(t);
}
function Xf(e) {
	var t = e.match(If);
	if (t) return `</${t[1].toLowerCase()}>`;
	var n = e.match(Lf);
	if (!n) return "";
	var r = n[1], i = n[2], a = n[3], o = r.toLowerCase(), s = [];
	Rf.lastIndex = 0;
	for (var c; (c = Rf.exec(i)) !== null;) {
		var l = c[1].toLowerCase(), u = c[2], d = c[3], f = c[4];
		if (!l.startsWith("on")) {
			var p = void 0, m = void 0;
			if (u !== void 0) p = u, m = "\"";
			else if (d !== void 0) p = d, m = "'";
			else if (f !== void 0) p = f, m = "\"";
			else {
				Mf.has(l) && s.push(l);
				continue;
			}
			if (Mf.has(l)) {
				var h = qf(l, p, f !== void 0);
				h !== null && s.push(`${l}=${m}${h}${m}`);
			}
		}
	}
	return `<${o}${s.length > 0 ? ` ${s.join(" ")}` : ""}${a ? "/>" : ">"}`;
}
function Zf(e) {
	return typeof e != "string" || !e || e.indexOf("<") === -1 ? e : e.replace(/<\/?[^>]*>|[^<>\s]+>/g, function(e) {
		return e.startsWith("<!--") ? "" : e.startsWith("<") ? Yf(e) ? Xf(e) : e.replace(/</g, "&lt;") : e.slice(0, -1) + "&gt;";
	});
}
function Qf(e, t, n) {
	n === void 0 && (n = !1);
	var r = function(t) {
		return t[e ? "getBoundingClientRect" : "getBBox"]();
	};
	return n ? r(t) : !("rect" in t) || "rect" in t && t.hasAttribute("width") && t.rect.width !== +(t.getAttribute("width") || 0) ? t.rect = r(t) : t.rect;
}
function $f(e, t) {
	for (var n = 0; n < e.length; n++) {
		var r = e[n];
		r && t(r, n);
	}
}
var G = function(e) {
	return e || e === 0;
}, K = function(e) {
	return typeof e == "function";
}, q = function(e) {
	return typeof e == "string";
}, J = function(e) {
	return typeof e == "number";
}, ep = function(e) {
	return e === void 0;
}, Y = function(e) {
	return e !== void 0;
}, tp = function(e) {
	return typeof e == "boolean";
}, np = function(e) {
	return Math.ceil(e / 10) * 10;
}, rp = function(e) {
	return Math.ceil(e) + .5;
}, ip = function(e) {
	return e[1] - e[0];
}, ap = function(e) {
	return typeof e == "object";
}, op = function(e) {
	for (var t in e) return !1;
	return !0;
}, sp = function(e) {
	return ep(e) || e === null || q(e) && e.length === 0 || ap(e) && !(e instanceof Date) && op(e) || J(e) && isNaN(e);
}, cp = function(e) {
	return !sp(e);
}, X = function(e) {
	return Array.isArray(e);
}, Z = function(e) {
	return e && !e?.nodeType && ap(e) && !X(e);
};
function lp(e, t, n) {
	return Y(e[t]) ? e[t] : n;
}
function up(e, t) {
	var n = !1;
	return Object.keys(e).forEach(function(r) {
		return e[r] === t && (n = !0);
	}), n;
}
function Q(e, t) {
	var n = [...arguments].slice(2), r = K(e);
	return r && e.call.apply(e, Xd([t], n, !1)), r;
}
function dp(e, t) {
	var n = 0, r = function() {
		var e = [...arguments];
		!--n && t.apply.apply(t, Xd([this], e, !1));
	};
	"duration" in e ? e.each(function() {
		return ++n;
	}).on("end", r) : (++n, e.call(r));
}
function fp(e, t, n, r) {
	if (n === void 0 && (n = [-1, 1]), r === void 0 && (r = !1), e && q(t)) {
		if (t.indexOf("\n") === -1) e.text(t);
		else {
			var i = [e.text(), t].map(function(e) {
				return e.replace(/[\s\n]/g, "");
			});
			if (i[0] !== i[1]) {
				var a = t.split("\n"), o = r ? a.length - 1 : 1;
				e.html(""), a.forEach(function(t, r) {
					e.append("tspan").attr("x", 0).attr("dy", `${r === 0 ? n[0] * o : n[1]}em`).text(t);
				});
			}
		}
	}
}
function pp(e) {
	var t = e.getBBox(), n = t.x, r = t.y, i = t.width, a = t.height;
	return [
		{
			x: n,
			y: r + a
		},
		{
			x: n,
			y: r
		},
		{
			x: n + i,
			y: r
		},
		{
			x: n + i,
			y: r + a
		}
	];
}
function mp(e) {
	var t = _p(e), n = t.width, r = t.height, i = pp(e);
	return {
		x: i[0].x,
		y: Math.min(i[0].y, i[1].y),
		width: n,
		height: r
	};
}
function hp(e, t) {
	var n = e && (e.touches || e.sourceEvent && e.sourceEvent.touches)?.[0], r = [0, 0];
	try {
		r = Dt(n || e, t);
	} catch {}
	return r.map(function(e) {
		return isNaN(e) ? 0 : e;
	});
}
function gp(e) {
	var t = e.event, n = e.$el, r = n.subchart.main || n.main, i;
	return t && t.type === "brush" ? i = t.selection : r && (i = r.select(".bb-brush").node()) && (i = cc(i)), i;
}
function _p(e, t) {
	return t === void 0 && (t = !1), Qf(!0, e, t);
}
function vp(e, t) {
	return t === void 0 && (t = !1), Qf(!1, e, t);
}
function yp(e, t, n) {
	e === void 0 && (e = !0), t === void 0 && (t = 0), n === void 0 && (n = 1e4);
	var r = W.crypto || W.msCrypto, i = r ? t + r.getRandomValues(/* @__PURE__ */ new Uint32Array(1))[0] % (n - t + 1) : Math.floor(Math.random() * (n - t) + t);
	return e ? String(i) : i;
}
function bp(e, t, n, r, i) {
	if (n > r) return -1;
	var a = Math.floor((n + r) / 2), o = e[a], s = o.x, c = o.w, l = c === void 0 ? 0 : c;
	return i && (s = e[a].y, l = e[a].h), t >= s && t <= s + l ? a : t < s ? bp(e, t, n, a - 1, i) : bp(e, t, a + 1, r, i);
}
function xp(e) {
	var t = gp(e);
	return !t || t[0] === t[1];
}
function Sp() {
	var e = [...arguments], t = function(e) {
		if (Z(e) && e.constructor) {
			var n = new e.constructor();
			for (var r in e) n[r] = t(e[r]);
			return n;
		}
		return e;
	};
	return e.map(function(e) {
		return t(e);
	}).reduce(function(e, t) {
		return F(F({}, e), t);
	});
}
function Cp(e, t) {
	for (var n in e === void 0 && (e = {}), X(t) && t.forEach(function(t) {
		return Cp(e, t);
	}), t) /^\d+$/.test(n) || n in e || (e[n] = t[n]);
	return e;
}
var wp = function(e) {
	return e.charAt(0).toUpperCase() + e.slice(1);
};
function Tp(e, t) {
	return t === void 0 && (t = "-"), e.split(t).map(function(e, t) {
		return t ? e.charAt(0).toUpperCase() + e.slice(1).toLowerCase() : e.toLowerCase();
	}).join("");
}
var Ep = function(e) {
	return [].slice.call(e);
};
function Dp(e, t, n) {
	var r = e.rootSelector, i = r === void 0 ? "" : r, a = e.sheet, o = `${i} ${function(e) {
		return e.replace(/\s?(bb-)/g, ".$1").replace(/\.+/g, ".");
	}(t)} {${n.join(";")}}`;
	return a[a.insertRule ? "insertRule" : "addRule"](o, a.cssRules.length);
}
function Op(e) {
	var t = [];
	return e.forEach(function(e) {
		var n;
		try {
			e.cssRules && e.cssRules.length && (t = t.concat(Ep(e.cssRules)));
		} catch (t) {
			(n = W.console) == null || n.warn(`Error while reading rules from ${e.href}: ${t.toString()}`);
		}
	}), t;
}
function kp(e) {
	return {
		x: (W.pageXOffset ?? W.scrollX ?? 0) + (e.scrollLeft ?? 0),
		y: (W.pageYOffset ?? W.scrollY ?? 0) + (e.scrollTop ?? 0)
	};
}
function Ap(e, t, n, r) {
	t === void 0 && (t = 0), n === void 0 && (n = 0), r === void 0 && (r = !0);
	var i = new DOMPoint(t, n), a = e.getScreenCTM(), o = i.matrixTransform(r ? a?.inverse() : a);
	if (r === !1) {
		var s = _p(e);
		o.x -= s.x, o.y -= s.y;
	}
	return o;
}
function jp(e) {
	var t = e ? e.transform : null, n = t && t.baseVal;
	return n && n.numberOfItems ? n.getItem(0).matrix : {
		a: 0,
		b: 0,
		c: 0,
		d: 0,
		e: 0,
		f: 0
	};
}
function Mp(e) {
	var t = e[0] instanceof Date, n = (t ? e.map(Number) : e).filter(function(e, t, n) {
		return n.indexOf(e) === t;
	});
	return t ? n.map(function(e) {
		return new Date(e);
	}) : n;
}
function Np(e) {
	return e && e.length ? e.reduce(function(e, t) {
		return e.concat(t);
	}) : [];
}
function Pp(e) {
	var t = [...arguments].slice(1);
	if (!t.length || t.length === 1 && !t[0]) return e;
	var n = t.shift();
	return Z(e) && Z(n) && Object.keys(n).forEach(function(t) {
		if (!/^(__proto__|constructor|prototype)$/i.test(t)) {
			var r = n[t];
			Z(r) ? (!e[t] && (e[t] = {}), e[t] = Pp(e[t], r)) : e[t] = X(r) ? r.concat() : r;
		}
	}), Pp.apply(void 0, Xd([e], t, !1));
}
function Fp(e, t) {
	t === void 0 && (t = !0);
	var n;
	return e[0] instanceof Date ? n = t ? function(e, t) {
		return e - t;
	} : function(e, t) {
		return t - e;
	} : t && !e.every(isNaN) ? n = function(e, t) {
		return e - t;
	} : t || (n = function(e, t) {
		return e > t && -1 || e < t && 1 || e === t && 0;
	}), e.concat().sort(n);
}
function Ip(e, t) {
	var n = t.filter(function(e) {
		return cp(e);
	});
	return n.length ? J(n[0]) ? n = Math[e].apply(Math, n) : n[0] instanceof Date && (n = Fp(n, e === "min")[0]) : n = void 0, n;
}
var Lp = function(e, t, n) {
	n === void 0 && (n = 1);
	for (var r = [], i = Math.max(0, Math.ceil((t - e) / n)) | 0, a = e; a < i; a++) r.push(e + a * n);
	return r;
}, Rp = {
	mouse: (function() {
		var e = function() {
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
			return new MouseEvent("t"), function(t, n, r) {
				r === void 0 && (r = e()), t.dispatchEvent(new MouseEvent(n, r));
			};
		} catch {
			return function(t, n, r) {
				r === void 0 && (r = e());
				var i = Df.createEvent("MouseEvent");
				i.initMouseEvent(n, r.bubbles, r.cancelable, W, 0, r.screenX, r.screenY, r.clientX, r.clientY, !1, !1, !1, !1, 0, null), t.dispatchEvent(i);
			};
		}
	})(),
	touch: function(e, t, n) {
		var r = new Touch(Pp({
			identifier: Date.now(),
			target: e,
			radiusX: 2.5,
			radiusY: 2.5,
			rotationAngle: 10,
			force: .5
		}, n));
		e.dispatchEvent(new TouchEvent(t, {
			cancelable: !0,
			bubbles: !0,
			shiftKey: !0,
			touches: [r],
			targetTouches: [],
			changedTouches: [r]
		}));
	}
};
function zp(e, t) {
	var n = e;
	for (var r in t) n = n.replace(RegExp(`{=${r}}`, "g"), t[r]);
	return Zf(n);
}
function Bp(e) {
	var t;
	if (e instanceof Date) t = e;
	else if (q(e)) {
		var n = this, r = n.config;
		t = n.format.dataTime(r.data_xFormat)(e) ?? new Date(e);
	} else J(e) && !isNaN(e) && (t = /* @__PURE__ */ new Date(+e));
	return (!t || isNaN(+t)) && console && console.error && console.error(`Failed to parse x '${e}' to Date object`), t;
}
function Vp(e) {
	var t = e.attr("viewBox");
	return t ? /(\d+(\.\d+)?){3}/.test(t) : !1;
}
function Hp(e, t, n) {
	n === void 0 && (n = !1);
	for (var r = !!e.node, i = !1, a = 0, o = Object.entries(t); a < o.length; a++) {
		var s = o[a], c = s[0], l = s[1];
		if (i = r ? e.style(c) === l : e.style[c] === l, n === !1 && i) break;
	}
	return i;
}
function Up() {
	return Df?.hidden === !1 || Df?.visibilityState === "visible";
}
function Wp(e, t) {
	var n = W.DocumentTouch, r = W.matchMedia, i = W.navigator, a = r?.("(pointer:coarse)").matches, o = !1;
	if (t) {
		if (i && "maxTouchPoints" in i) o = i.maxTouchPoints > 0;
		else if ("ontouchmove" in W || n && Df instanceof n) o = !0;
		else if (a) o = !0;
		else {
			var s = i.userAgent;
			o = /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(s) || /\b(Android|Windows Phone|iPad|iPod)\b/i.test(s);
		}
	}
	return e && !a && r?.("(pointer:fine)").matches && "mouse" || o && "touch" || "mouse";
}
function Gp(e, t) {
	t() === !1 ? kf(function() {
		return Gp(e, t);
	}) : e();
}
function Kp(e) {
	if (Z(e) && !q(e)) {
		var t = e;
		return {
			top: t.top || 0,
			right: t.right || 0,
			bottom: t.bottom || 0,
			left: t.left || 0
		};
	}
	var n = (q(e) ? e.trim().split(/\s+/) : [e]).map(function(e) {
		return +e || 0;
	}), r = n[0], i = n[1], a = i === void 0 ? r : i, o = n[2], s = o === void 0 ? r : o, c = n[3];
	return {
		top: r,
		right: a,
		bottom: s,
		left: c === void 0 ? a : c
	};
}
function qp(e, t) {
	e.pendingRaf === null ? (e.pendingRaf = W.requestAnimationFrame(function() {
		e.pendingRaf = null;
	}), t()) : (W.cancelAnimationFrame(e.pendingRaf), e.pendingRaf = W.requestAnimationFrame(function() {
		e.pendingRaf = null, t();
	}));
}
function Jp(e, t) {
	t === void 0 && (t = (function(e) {
		return e;
	}));
	var n = /* @__PURE__ */ new Set();
	return $f(e, function(e, r) {
		n.add(t(e, r));
	}), n;
}
function Yp(e, t, n) {
	n === void 0 && (n = (function(e) {
		return e;
	}));
	var r = /* @__PURE__ */ new Map();
	return $f(e, function(e, i) {
		r.set(t(e, i), n(e, i));
	}), r;
}
var Xp = function() {
	function e() {
		return Sp(bf, _f, Cf, vf, wf, yf, xf, Sf, e.data);
	}
	return e.setOptions = function(e) {
		this.data = e.reduce(function(e, t) {
			return F(F({}, e), t);
		}, this.data);
	}, e.data = {}, e;
}(), Zp = {
	element: function() {
		function e() {
			return {
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
					bar: null,
					line: null,
					area: null
				},
				arcs: null,
				bar: null,
				candlestick: null,
				line: null,
				area: null,
				circle: null,
				radar: null,
				text: null,
				grid: {
					main: null,
					x: null,
					y: null
				},
				gridLines: {
					main: null,
					x: null,
					y: null
				},
				region: {
					main: null,
					list: null
				},
				eventRect: null,
				zoomResetBtn: null
			};
		}
		return e;
	}(),
	state: function() {
		function e() {
			return {
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
				cssRule: {},
				loading: void 0,
				domain: void 0,
				current: {
					domain: void 0,
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
						y: {
							width: 0,
							height: 0,
							domain: ""
						},
						y2: {
							width: 0,
							height: 0,
							domain: ""
						}
					},
					types: [],
					needle: void 0,
					zoomDomain: null
				},
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
					rect: {},
					data: [],
					coords: []
				},
				axis: { x: {
					padding: {
						left: 0,
						right: 0
					},
					tickCount: 0
				} },
				rotatedPadding: {
					left: 30,
					right: 0,
					top: 5
				},
				withoutFadeIn: {},
				inputType: "",
				datetimeId: "",
				clip: {
					id: "",
					idXAxis: "",
					idYAxis: "",
					idXAxisTickTexts: "",
					idGrid: "",
					idSubchart: "",
					path: "",
					pathXAxis: "",
					pathYAxis: "",
					pathXAxisTickTexts: "",
					pathGrid: ""
				},
				event: null,
				dragStart: null,
				dragging: !1,
				flowing: !1,
				cancelClick: !1,
				mouseover: !1,
				rendered: !1,
				transiting: !1,
				redrawing: !1,
				resizing: !1,
				toggling: !1,
				zooming: !1,
				hasNegativeValue: !1,
				hasPositiveValue: !0,
				orgAreaOpacity: "0.2",
				orgConfig: {},
				hiddenTargetIds: [],
				hiddenLegendIds: [],
				focusedTargetIds: [],
				defocusedTargetIds: [],
				radius: 0,
				innerRadius: 0,
				outerRadius: void 0,
				innerRadiusRatio: 0,
				gaugeArcWidth: 0,
				radiusExpanded: 0,
				xgridAttr: {
					x1: null,
					x2: null,
					y1: null,
					y2: null
				},
				pendingRaf: null,
				rafBatchQueue: []
			};
		}
		return e;
	}()
}, Qp = function() {
	function e() {
		var e = this;
		Object.keys(Zp).forEach(function(t) {
			e[t] = new Zp[t]();
		});
	}
	return e.prototype.getStore = function(e) {
		return this[e];
	}, e;
}(), $p = {
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
}, em = function() {
	function e() {
		this.cache = {};
	}
	return e.prototype.add = function(e, t, n) {
		return n === void 0 && (n = !1), this.cache[e] = n ? this.cloneTarget(t) : t, this.cache[e];
	}, e.prototype.remove = function(e) {
		var t = this;
		(q(e) ? [e] : e).forEach(function(e) {
			return delete t.cache[e];
		});
	}, e.prototype.get = function(e, t) {
		if (t === void 0 && (t = !1), t && Array.isArray(e)) {
			for (var n = [], r = 0, i = void 0; i = e[r]; r++) i in this.cache && n.push(this.cloneTarget(this.cache[i]));
			return n;
		}
		var a = this.cache[e];
		return G(a) ? a : null;
	}, e.prototype.has = function(e) {
		return e in this.cache && this.cache[e] !== null;
	}, e.prototype.getKeys = function() {
		return Object.keys(this.cache);
	}, e.prototype.reset = function(e) {
		var t = this;
		for (var n in t.cache) (e || /^\$/.test(n)) && (t.cache[n] = null);
	}, e.prototype.cloneTarget = function(e) {
		return {
			id: e.id,
			id_org: e.id_org,
			values: e.values.map(function(e) {
				return {
					x: e.x,
					value: e.value,
					id: e.id
				};
			})
		};
	}, e;
}(), $ = {
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
}, tm = {
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
}, nm = {
	Area: [
		$.AREA,
		$.AREA_SPLINE,
		$.AREA_SPLINE_RANGE,
		$.AREA_LINE_RANGE,
		$.AREA_STEP,
		$.AREA_STEP_RANGE
	],
	AreaRange: [
		$.AREA_SPLINE_RANGE,
		$.AREA_LINE_RANGE,
		$.AREA_STEP_RANGE
	],
	Arc: [
		$.PIE,
		$.DONUT,
		$.GAUGE,
		$.POLAR,
		$.RADAR
	],
	Line: [
		$.LINE,
		$.SPLINE,
		$.AREA,
		$.AREA_SPLINE,
		$.AREA_SPLINE_RANGE,
		$.AREA_LINE_RANGE,
		$.STEP,
		$.AREA_STEP,
		$.AREA_STEP_RANGE
	],
	Step: [
		$.STEP,
		$.AREA_STEP,
		$.AREA_STEP_RANGE
	],
	Spline: [
		$.SPLINE,
		$.AREA_SPLINE,
		$.AREA_SPLINE_RANGE
	]
};
function rm(e) {
	var t = e, n = t.config, r = "";
	if (sp(n.data_type || n.data_types) && !t[tm.LINE]) r = "line";
	else for (var i in tm) {
		var a = $[i];
		if (t.hasType(a) && !t[tm[i]]) {
			r = a;
			break;
		}
	}
	r && im(`Please, make sure if %c${Tp(r)}`, "module has been imported and specified correctly.", "https://github.com/naver/billboard.js/wiki/CHANGELOG-v2#modularization-by-its-functionality");
}
function im(e, t, n) {
	var r = "[billboard.js]";
	if (W.console?.error) {
		var i = ["background:red;color:white;display:block;font-size:15px", t];
		console.error.apply(console, Xd([`❌ ${r} ${e}`, "background:red;color:white;display:block;font-size:15px"], i, !1)), console.info("%cℹ️", "font-size:15px", n);
	}
	throw Error(`${r} ${e.replace(/\%c([a-z-]+)/i, "'$1' ")} ${t}`);
}
var am = W.setTimeout, om = W.clearTimeout;
function sm(e) {
	var t = [], n, r = function() {
		r.clear(), e === !1 ? Af(function() {
			t.forEach(function(e) {
				return e();
			});
		}, { timeout: 200 }) : n = am(function() {
			t.forEach(function(e) {
				return e();
			});
		}, J(e) ? e : 200);
	};
	return r.clear = function() {
		n &&= (om(n), null);
	}, r.add = function(e) {
		return t.push(e);
	}, r.remove = function(e) {
		return t.splice(t.indexOf(e), 1);
	}, r;
}
function cm() {
	var e = [], t = function(t, n) {
		function r() {
			for (var t = 0, n = 0, r = void 0; r = e[n]; n++) if (r === !0 || r.empty?.call(r)) t++;
			else {
				if (Up() === !1) {
					t = e.length;
					break;
				}
				try {
					r.transition();
				} catch {
					t++;
				}
			}
			return t === e.length;
		}
		Gp(function() {
			n?.();
		}, r);
	};
	return t.add = function(t) {
		X(t) ? e = e.concat(t) : e.push(t);
	}, t;
}
var lm = {};
function um(e, t) {
	var n = e.toString(), r = n.replace(/(function|[\s\W\n])/g, "").substring(0, 15);
	return r in lm || (lm[r] = new W.Blob([`${t?.map(String).join(";") ?? ""}

			self.onmessage=function({data}) {
				const result = (${n}).apply(null, data);
				self.postMessage(result);
			};`], { type: "text/javascript" })), W.URL.createObjectURL(lm[r]);
}
function dm(e) {
	var t = new W.Worker(e);
	return t.onerror = function(e) {
		console.error ? console.error(e) : console.log(e);
	}, t;
}
function fm(e, t, n, r) {
	e === void 0 && (e = !0);
	var i = function() {
		var e = [...arguments];
		n(t.apply(void 0, e));
	};
	if (W.Worker && e) {
		var a = um(t, r), o = dm(a);
		i = function() {
			var e = [...arguments];
			o.postMessage(e), o.onmessage = function(e) {
				return W.URL.revokeObjectURL(a), n(e.data);
			};
		};
	}
	return i;
}
function pm(e) {
	var t = [];
	return e.forEach(function(e, n) {
		var r = e[0];
		e.forEach(function(e, i) {
			if (i > 0) {
				if (t[i - 1] === void 0 && (t[i - 1] = {}), e === void 0) throw Error(`Source data is missing a component at (${n}, ${i})!`);
				t[i - 1][r] = e;
			}
		});
	}), t;
}
function mm(e) {
	var t = e[0], n = [];
	return e.forEach(function(e, r) {
		if (r > 0) {
			var i = {};
			e.forEach(function(e, n) {
				if (e === void 0) throw Error(`Source data is missing a component at (${r}, ${n})!`);
				i[t[n]] = e;
			}), n.push(i);
		}
	}), n;
}
function hm(e, t) {
	var n = [], r, i;
	if (Array.isArray(e)) {
		var a = function(e, t) {
			if (e[t] !== void 0) return e[t];
			var n = t.replace(/\[(\w+)\]/g, ".$1").replace(/^\./, "").split("."), r = e;
			return n.some(function(e) {
				return !(r = r && e in r ? r[e] : void 0);
			}), r;
		};
		r = t.x ? t.value.concat(t.x) : t.value, n.push(r), e.forEach(function(e) {
			var t = r.map(function(t) {
				var n = a(e, t);
				return n === void 0 && (n = null), n;
			});
			n.push(t);
		}), i = mm(n);
	} else Object.keys(e).forEach(function(t) {
		var r, i = e[t].concat();
		(r = i.unshift) == null || r.call(i, t), n.push(i);
	}), i = pm(n);
	return i;
}
function gm(e, t, n, r, i) {
	t === void 0 && (t = "csv");
	var a = new XMLHttpRequest(), o = {
		csv: vm,
		tsv: ym,
		json: hm
	};
	a.open("GET", e), n && Object.keys(n).forEach(function(e) {
		a.setRequestHeader(e, n[e]);
	}), a.onreadystatechange = function() {
		if (a.readyState === 4) {
			if (a.status === 200) {
				var n = a.responseText;
				n && i.call(this, o[t](t === "json" ? JSON.parse(n) : n, r));
			} else throw Error(`${e}: Something went wrong loading!`);
		}
	}, a.send();
}
function _m(e, t) {
	var n = e.rows(t), r;
	return n.length === 1 ? (r = [{}], n[0].forEach(function(e) {
		r[0][e] = null;
	})) : r = e.parse(t), r;
}
function vm(e) {
	return _m({
		rows: Ec,
		parse: Tc
	}, e);
}
function ym(e) {
	return _m({
		rows: kc,
		parse: Oc
	}, e);
}
function bm(e, t) {
	var n = e || t?.data_keys;
	return n?.x && (t.data_x = n.x), n;
}
function xm(e, t, n) {
	var r = this, i = this, a = i.config, o;
	e.forEach(function(e) {
		var s = i.getXKey(e);
		if (n.customX || n.timeSeries ? n.xs.indexOf(s) >= 0 ? o = (n.appendXs && i.data.xs[e] || []).concat(t.map(function(t, n) {
			var r = G(t[s]);
			return r ? i.generateTargetX(r, e, n) : !1;
		}).filter(function(e) {
			return e !== !1;
		})) : a.data_x ? o = r.getOtherTargetXs() : cp(a.data_xs) && (o = i.getXValuesOfXKey(s, i.data.targets)) : o = t.map(function(e, t) {
			return t;
		}), o) i.data.xs[e] = o;
		else throw Error(`x is not defined for id = "${e}".`);
	});
}
var Sm = {
	convertData: function(e, t) {
		var n = this.config, r = function(e) {
			return e?.length && !sp(e[0]) ? n.boost_useWorker : !1;
		}, i = e;
		if (e.bindto && (i = {}, [
			"url",
			"mimeType",
			"headers",
			"keys",
			"json",
			"keys",
			"rows",
			"columns"
		].forEach(function(t) {
			var n = `data_${t}`;
			n in e && (i[t] = e[n]);
		})), i.url && t) gm(i.url, i.mimeType, i.headers, bm(i.keys, n), t);
		else if (i.json) fm(r(i.json), hm, t, [pm, mm])(i.json, bm(i.keys, n));
		else if (i.rows) fm(r(i.rows), mm, t)(i.rows);
		else if (i.columns) fm(r(i.columns), pm, t)(i.columns);
		else if (e.bindto) throw Error("url or json or rows or columns is required.");
	},
	convertDataToTargets: function(e, t) {
		var n = this, r = n.axis, i = n.config, a = n.state, o = i.data_type, s = Object.keys(e[0] || {}), c = s.length ? s.reduce(function(e, t) {
			return n.isX.call(n, t) ? e.xs.push(t) : n.isNotX.call(n, t) && e.ids.push(t), e;
		}, {
			ids: [],
			xs: []
		}) : {
			ids: [],
			xs: []
		}, l = c.ids, u = {
			appendXs: t,
			xs: c.xs,
			idConverter: i.data_idConverter.bind(n.api),
			categorized: r?.isCategorized(),
			timeSeries: r?.isTimeSeries(),
			customX: r?.isCustomX()
		};
		xm.bind(n)(l, e, u);
		var d = l.map(function(t, r) {
			var o = i.data_idConverter.bind(n.api)(t), s = n.getXKey(t), c = u.customX && u.categorized, l = c && (function() {
				var t = Jp(i.axis_x_categories);
				return e.every(function(e) {
					return t.has(e.x);
				});
			})(), d = e.__append__, f = s === null && d ? n.api.data.values(t).length : 0;
			return {
				id: o,
				id_org: t,
				values: e.map(function(e, u) {
					var p = e[s], m = e[t], h;
					return m = m !== null && !isNaN(m) && !Z(m) ? +m : X(m) || Z(m) ? m : null, (c || a.hasRadar) && r === 0 && !ep(p) ? (!l && r === 0 && u === 0 && !d && (i.axis_x_categories = []), h = i.axis_x_categories.indexOf(p), h === -1 && (h = i.axis_x_categories.length, i.axis_x_categories.push(p))) : h = n.generateTargetX(p, t, f + u), (ep(m) || n.data.xs[t].length <= u) && (h = void 0), {
						x: h,
						value: m,
						id: o,
						index: -1
					};
				}).filter(function(e) {
					return Y(e.x);
				})
			};
		});
		if (d.forEach(function(e) {
			var t;
			i.data_xSort && (e.values = e.values.sort(function(e, t) {
				return (e.x || e.x === 0 ? e.x : Infinity) - (t.x || t.x === 0 ? t.x : Infinity);
			})), e.values.forEach(function(e, t) {
				return e.index = t;
			}), (t = n.data.xs[e.id]) == null || t.sort(function(e, t) {
				return e - t;
			});
		}), a.hasNegativeValue = n.hasNegativeValueInTargets(d), a.hasPositiveValue = n.hasPositiveValueInTargets(d), o && n.isValidChartType(o)) {
			var f = n.mapToIds(d).filter(function(e) {
				return !(e in i.data_types) || !n.isValidChartType(i.data_types[e]);
			});
			n.setTargetType(f, o);
		}
		return d.forEach(function(e) {
			return n.cache.add(e.id_org, e, !0);
		}), d;
	}
}, Cm = {
	isX: function(e) {
		var t = this.config, n = t.data_x && e === t.data_x, r = cp(t.data_xs) && up(t.data_xs, e);
		return n || r;
	},
	isNotX: function(e) {
		return !this.isX(e);
	},
	isStackNormalized: function() {
		var e = this.config;
		return !(e.data_stack_normalize !== !0 && !ap(e.data_stack_normalize) || !e.data_groups.length);
	},
	isStackNormalizedPerGroup: function() {
		var e = this.config;
		return !!(ap(e.data_stack_normalize) && e.data_stack_normalize?.perGroup && e.data_groups.length);
	},
	isGrouped: function(e) {
		var t = this.config.data_groups;
		return e ? t.some(function(t) {
			return t.indexOf(e) >= 0 && t.length > 1;
		}) : t.length > 0;
	},
	hasAxisGroupedData: function(e) {
		var t = this, n = t.axis;
		return t.data.targets.filter(function(t) {
			return n.getId(t.id) === e;
		}).map(function(e) {
			return e.id;
		}).some(function(e) {
			return t.isGrouped(e);
		});
	},
	getXKey: function(e) {
		var t = this.config;
		return t.data_x ? t.data_x : cp(t.data_xs) ? t.data_xs[e] : null;
	},
	getXValuesOfXKey: function(e, t) {
		var n = this, r = t && cp(t) ? n.mapToIds(t) : [], i;
		return r.forEach(function(t) {
			n.getXKey(t) === e && (i = n.data.xs[t]);
		}), i;
	},
	getIndexByX: function(e, t) {
		var n = this;
		return t ? t.indexOf(q(e) ? e : +e) : (n.filterByX(n.data.targets, e)[0] || { index: null }).index;
	},
	getXValue: function(e, t) {
		var n = this;
		return e in n.data.xs && n.data.xs[e] && G(n.data.xs[e][t]) ? n.data.xs[e][t] : t;
	},
	getOtherTargetXs: function() {
		var e = this, t = Object.keys(e.data.xs);
		return t.length ? e.data.xs[t[0]] : null;
	},
	getOtherTargetX: function(e) {
		var t = this.getOtherTargetXs();
		return t && e < t.length ? t[e] : null;
	},
	addXs: function(e) {
		var t = this.config;
		Object.keys(e).forEach(function(n) {
			t.data_xs[n] = e[n];
		});
	},
	isMultipleX: function() {
		return !this.config.axis_x_forceAsSingle && (cp(this.config.data_xs) || this.hasType("bubble") || this.hasType("scatter"));
	},
	addName: function(e) {
		var t = this.config, n;
		return e && (n = t.data_names[e.id], e.name = n === void 0 ? e.id : n), e;
	},
	getAllValuesOnIndex: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.filterTargetsToShow(n.data.targets).map(function(t) {
			return n.addName(n.getValueOnIndex(t.values, e));
		});
		return t && (r = r.filter(function(e) {
			return e && "value" in e && G(e.value);
		})), r;
	},
	getValueOnIndex: function(e, t) {
		var n = e.filter(function(e) {
			return e.index === t;
		});
		return n.length ? n[0] : null;
	},
	updateTargetX: function(e, t) {
		var n = this;
		e.forEach(function(e) {
			e.values.forEach(function(r, i) {
				r.x = n.generateTargetX(t[i], e.id, i);
			}), n.data.xs[e.id] = t;
		});
	},
	updateTargetXs: function(e, t) {
		var n = this;
		e.forEach(function(e) {
			t[e.id] && n.updateTargetX([e], t[e.id]);
		});
	},
	generateTargetX: function(e, t, n) {
		var r = this, i = r.axis, a = i?.isCategorized() ? n : e || n;
		return i?.isTimeSeries() ? a = Bp.bind(r)(e || r.getXValue(t, n)) : i?.isCustomX() && !i?.isCategorized() && (a = G(e) ? +e : r.getXValue(t, n)), a;
	},
	updateXs: function(e) {
		e.length && (this.axis.xs = e.map(function(e) {
			return e.x;
		}));
	},
	getPrevX: function(e) {
		var t = this.axis.xs[e - 1];
		return Y(t) ? t : null;
	},
	getNextX: function(e) {
		var t = this.axis.xs[e + 1];
		return Y(t) ? t : null;
	},
	getBaseValue: function(e) {
		var t = this, n = t.state.hasAxis, r = e.value;
		return r && n && (t.isAreaRangeType(e) ? r = t.getRangedData(e, "mid") : t.isBubbleZType(e) && (r = t.getBubbleZData(r, "y"))), r;
	},
	getMinMaxValue: function(e) {
		var t = this.getBaseValue.bind(this), n, r;
		return (e || this.data.targets.map(function(e) {
			return e.values;
		})).forEach(function(e, i) {
			var a = e.map(t).filter(J);
			n = Math.min.apply(Math, Xd([i ? n : Infinity], a, !1)), r = Math.max.apply(Math, Xd([i ? r : -Infinity], a, !1));
		}), {
			min: n,
			max: r
		};
	},
	getMinMaxData: function() {
		var e = this, t = $p.dataMinMax, n = e.cache.get(t);
		if (!n) {
			var r = e.data.targets.map(function(e) {
				return e.values;
			}), i = e.getMinMaxValue(r), a = [], o = [], s = i.min, c = i.max;
			r.forEach(function(t) {
				var n = e.getFilteredDataByValue(t, s), r = e.getFilteredDataByValue(t, c);
				n.length && (a = a.concat(n)), r.length && (o = o.concat(r));
			}), e.cache.add(t, n = {
				min: a,
				max: o
			});
		}
		return n;
	},
	getTotalPerIndex: function(e) {
		var t = this, n = t.config, r = e ? `${$p.dataTotalPerIndex}-${e}` : $p.dataTotalPerIndex, i = t.cache.get(r);
		if ((t.config.data_groups.length || t.isStackNormalized()) && !i) {
			i = [];
			var a = t.data.targets;
			if (t.isStackNormalizedPerGroup() && e) {
				var o = n.data_groups.find(function(t) {
					return t.indexOf(e) >= 0;
				});
				if (o) a = a.filter(function(e) {
					return o.indexOf(e.id) >= 0;
				});
				else return null;
			}
			a.forEach(function(e) {
				e.values.forEach(function(e, t) {
					i[t] || (i[t] = 0), i[t] += ~~e.value;
				});
			}), t.cache.add(r, i);
		}
		return i;
	},
	getTotalDataSum: function(e) {
		var t = this, n = $p.dataTotalSum, r = t.cache.get(n);
		return J(r) || (r = t.data.targets.reduce(function(e, t) {
			return e + t.values.reduce(function(e, t) {
				return e + (t.value ?? 0);
			}, 0);
		}, 0), t.cache.add(n, r)), e && (r -= t.getHiddenTotalDataSum()), r;
	},
	getHiddenTotalDataSum: function() {
		var e = this, t = e.api, n = e.state.hiddenTargetIds, r = 0;
		return n.length && (r = t.data.values.bind(t)(n).reduce(function(e, t) {
			return e + t;
		})), r;
	},
	getFilteredDataByValue: function(e, t) {
		var n = this;
		return e.filter(function(e) {
			return n.getBaseValue(e) === t;
		});
	},
	getMaxDataCount: function() {
		return Math.max.apply(Math, Xd(Xd([], this.data.targets.map(function(e) {
			return e.values.length;
		}), !1), [0], !1));
	},
	getMaxDataCountTarget: function() {
		var e = this.filterTargetsToShow() || [], t = e.length, n = this.config.axis_x_inverted;
		return t > 1 ? (e = e.map(function(e) {
			return e.values;
		}).reduce(function(e, t) {
			return e.concat(t);
		}).map(function(e) {
			return e.x;
		}), e = Fp(Mp(e)).map(function(e, t, r) {
			return {
				x: e,
				index: n ? r.length - t - 1 : t
			};
		})) : t && (e = e[0].values.concat()), e;
	},
	mapToIds: function(e) {
		return e.map(function(e) {
			return e.id;
		});
	},
	mapToTargetIds: function(e) {
		var t = this;
		return e ? X(e) ? e.concat() : [e] : t.mapToIds(t.data.targets);
	},
	hasTarget: function(e, t) {
		for (var n = this.mapToIds(e), r = 0, i = void 0; i = n[r]; r++) if (i === t) return !0;
		return !1;
	},
	isTargetToShow: function(e) {
		return this.state.hiddenTargetIds.indexOf(e) < 0;
	},
	isLegendToShow: function(e) {
		return this.state.hiddenLegendIds.indexOf(e) < 0;
	},
	filterTargetsToShow: function(e) {
		var t = this;
		if (!e) {
			var n = t.cache, r = t.data, i = t.state, a = $p.filteredTargets, o = i.hiddenTargetIds.join(",");
			if (o !== n.get($p.visibilityChecksum) && (n.remove(a), n.add($p.visibilityChecksum, o)), n.has(a)) return n.get(a);
			var s = r.targets.filter(function(e) {
				return t.isTargetToShow(e.id);
			});
			return n.add(a, s), s;
		}
		return e.filter(function(e) {
			return t.isTargetToShow(e.id);
		});
	},
	mapTargetsToUniqueXs: function(e) {
		var t = this.axis, n = [];
		return e?.length && (n = Mp(Np(e.map(function(e) {
			return e.values.map(function(e) {
				return +e.x;
			});
		}))), n = t?.isTimeSeries() ? n.map(function(e) {
			return /* @__PURE__ */ new Date(+e);
		}) : n.map(Number)), Fp(n);
	},
	addTargetIds: function(e, t) {
		var n = this.state;
		(X(t) ? t : [t]).forEach(function(t) {
			n[e].indexOf(t) < 0 && n[e].push(t);
		});
	},
	removeTargetIds: function(e, t) {
		var n = this.state;
		(X(t) ? t : [t]).forEach(function(t) {
			var r = n[e].indexOf(t);
			r >= 0 && n[e].splice(r, 1);
		});
	},
	addHiddenTargetIds: function(e) {
		this.addTargetIds("hiddenTargetIds", e);
	},
	removeHiddenTargetIds: function(e) {
		this.removeTargetIds("hiddenTargetIds", e);
	},
	addHiddenLegendIds: function(e) {
		this.addTargetIds("hiddenLegendIds", e);
	},
	removeHiddenLegendIds: function(e) {
		this.removeTargetIds("hiddenLegendIds", e);
	},
	getValuesAsIdKeyed: function(e) {
		var t = this, n = t.state.hasAxis, r = {}, i = t.isMultipleX(), a = i ? t.mapTargetsToUniqueXs(e).map(function(e) {
			return q(e) ? e : +e;
		}) : null, o = a ? new Map(a.map(function(e, t) {
			return [e, t];
		})) : null;
		return e.forEach(function(e) {
			var a = [];
			e.values.filter(function(e) {
				var t = e.value;
				return G(t) || t === null;
			}).forEach(function(e) {
				var r = e.value;
				if (r !== null && t.isCandlestickType(e) && (r = X(r) ? r.slice(0, 4) : [
					r.open,
					r.high,
					r.low,
					r.close
				]), X(r)) a.push.apply(a, r);
				else if (Z(r) && "high" in r) a.push.apply(a, Object.values(r));
				else if (t.isBubbleZType(e)) a.push(n && t.getBubbleZData(r, "y"));
				else if (i && o) {
					var s = q(e.x) ? e.x : +e.x, c = o.get(s);
					c !== void 0 && (a[c] = r);
				} else a.push(r);
			}), r[e.id] = a;
		}), r;
	},
	checkValueInTargets: function(e, t) {
		return Object.keys(e).some(function(n) {
			return e[n].values.some(function(e) {
				return t(e.value);
			});
		});
	},
	hasMultiTargets: function() {
		return this.filterTargetsToShow().length > 1;
	},
	hasNegativeValueInTargets: function(e) {
		return this.checkValueInTargets(e, function(e) {
			return e < 0;
		});
	},
	hasPositiveValueInTargets: function(e) {
		return this.checkValueInTargets(e, function(e) {
			return e > 0;
		});
	},
	orderTargets: function(e) {
		var t = this, n = Xd([], e, !0), r = t.getSortCompareFn();
		return r && n.sort(r), n;
	},
	getSortCompareFn: function(e) {
		e === void 0 && (e = !1);
		var t = this, n = t.config.data_order, r = /asc/i.test(n), i = /desc/i.test(n), a;
		if (r || i) {
			var o = function(e, t) {
				return e + Math.abs(t.value);
			}, s = function(e) {
				return J(e) ? e : "values" in e ? e.values.reduce(o, 0) : e.value;
			};
			a = function(t, n) {
				var i = s(t), a = s(n);
				return e ? r ? i - a : a - i : r ? a - i : i - a;
			};
		} else K(n) && (a = n.bind(t.api));
		return a || null;
	},
	filterByX: function(e, t) {
		return Np(e.map(function(e) {
			return e.values;
		})).filter(function(e) {
			return e.x - t === 0;
		});
	},
	filterNullish: function(e) {
		var t = function(e) {
			return G(e.value);
		};
		return e && e.filter(function(e) {
			return "value" in e ? t(e) : e.values.some(t);
		});
	},
	filterRemoveNull: function(e) {
		var t = this;
		return e.filter(function(e) {
			return G(t.getBaseValue(e));
		});
	},
	filterByXDomain: function(e, t) {
		return e.map(function(e) {
			return {
				id: e.id,
				id_org: e.id_org,
				values: e.values.filter(function(e) {
					return t[0] <= e.x && e.x <= t[1];
				})
			};
		});
	},
	hasDataLabel: function() {
		var e = this.config.data_labels;
		return tp(e) && e || ap(e) && cp(e);
	},
	hasNullDataValue: function(e) {
		return e.some(function(e) {
			return e.value === null;
		});
	},
	getDataIndexFromEvent: function(e) {
		var t = this, n = t.$el, r = t.config, i = t.state, a = i.hasRadar, o = i.inputType, s = i.eventReceiver, c = s.coords, l = s.rect, u;
		if (a) {
			var d = e.target;
			/tspan/i.test(d.tagName) && (d = d.parentNode);
			var f = M(d).datum();
			u = f && Object.keys(f).length === 1 ? f.index : void 0;
		} else {
			var p = r.axis_rotated, m = kp(n.chart.node()), h = o === "touch" && e.changedTouches ? e.changedTouches[0] : e, g = p ? h.clientY + m.y : h.clientX + m.x;
			if (Vp(n.svg)) {
				var _ = [g, 0];
				p && _.reverse(), g = Ap.apply(void 0, Xd([n.eventRect.node()], _, !1))[p ? "y" : "x"];
			} else g -= p ? l.top : l.left;
			u = bp(c, g, 0, c.length - 1, p);
		}
		return u;
	},
	getDataLabelLength: function(e, t, n) {
		var r = this, i = 1.3;
		return r.getTextRect([e, t].map(function(e) {
			return r.dataLabelFormat()(e);
		}))?.map(function(e) {
			return e[n] * i;
		}) || [0, 0];
	},
	isNoneArc: function(e) {
		return this.hasTarget(this.data.targets, e.id);
	},
	isArc: function(e) {
		return "data" in e && this.hasTarget(this.data.targets, e.data.id);
	},
	findSameXOfValues: function(e, t) {
		for (var n = e[t].x, r = [], i = t - 1; i >= 0 && n === e[i].x; i--) r.push(e[i]);
		for (i = t; i < e.length && n === e[i].x; i++) r.push(e[i]);
		return r;
	},
	findClosestFromTargets: function(e, t) {
		var n = this, r = e.map(function(e) {
			return n.findClosest(e.values, t);
		});
		return n.findClosest(r, t);
	},
	findClosest: function(e, t) {
		var n = this, r = n.$el.main, i = e.filter(function(e) {
			return e && G(e.value);
		}), a, o;
		return i.filter(function(e) {
			return n.isBarType(e.id) || n.isCandlestickType(e.id);
		}).forEach(function(e) {
			var t = n.isBarType(e.id) ? `.${$d.chartBar}.${I.target}${n.getTargetSelectorSuffix(e.id)} .${$d.bar}-${e.index}` : `.${ef.chartCandlestick}.${I.target}${n.getTargetSelectorSuffix(e.id)} .${ef.candlestick}-${e.index} path`;
			!o && n.isWithinBar(r.select(t).node()) && (o = e);
		}), i.filter(function(e) {
			return !n.isBarType(e.id) && !n.isCandlestickType(e.id);
		}).forEach(function(e) {
			var r = n.dist(e, t);
			a = n.getPointSensitivity(e), r < a && (a = r, o = e);
		}), o;
	},
	dist: function(e, t) {
		var n = this, r = n.config.axis_rotated, i = n.scale, a = +r, o = +!r, s = n.circleY(e, e.index), c = (i.zoom || i.x)(e.x);
		return Math.sqrt((c - t[a]) ** 2 + (s - t[o]) ** 2);
	},
	convertValuesToStep: function(e) {
		var t = this, n = t.axis, r = t.config.line_step_type, i = n ? n.isCategorized() : !1, a = X(e) ? e.concat() : [e];
		if (!(i || /step\-(after|before)/.test(r))) return e;
		if (a.length) {
			var o = a[0], s = a[a.length - 1], c = o.id, l = o.x;
			a.unshift({
				x: --l,
				value: o.value,
				id: c
			}), i && r === "step-after" && a.unshift({
				x: --l,
				value: o.value,
				id: c
			}), l = s.x, a.push({
				x: ++l,
				value: s.value,
				id: c
			}), i && r === "step-before" && a.push({
				x: ++l,
				value: s.value,
				id: c
			});
		}
		return a;
	},
	convertValuesToRange: function(e) {
		var t = X(e) ? e.concat() : [e], n = [];
		return t.forEach(function(e) {
			var t = e.x, r = e.id;
			n.push({
				x: t,
				id: r,
				value: e.value[0]
			}), n.push({
				x: t,
				id: r,
				value: e.value[2]
			});
		}), n;
	},
	updateDataAttributes: function(e, t) {
		var n = this, r = n.config[`data_${e}`];
		return ep(t) || (Object.keys(t).forEach(function(e) {
			r[e] = t[e];
		}), n.redraw({ withLegend: !0 })), r;
	},
	getRangedData: function(e, t, n) {
		t === void 0 && (t = ""), n === void 0 && (n = "areaRange");
		var r = e?.value;
		if (X(r)) {
			if (n === "bar") return r.reduce(function(e, t) {
				return t - e;
			});
			var i = {
				areaRange: [
					"high",
					"mid",
					"low"
				],
				candlestick: [
					"open",
					"high",
					"low",
					"close",
					"volume"
				]
			}[n].indexOf(t);
			return i >= 0 && r ? r[i] : void 0;
		}
		return r && t ? r[t] : r;
	},
	setRatioForGroupedData: function(e) {
		var t = this;
		if (t.config.data_groups.length && e.some(function(e) {
			return t.isGrouped(e.id);
		})) {
			var n = function(e) {
				return t.getRatio("index", e, !0);
			};
			e.forEach(function(e) {
				"values" in e ? e.values.forEach(n) : n(e);
			});
		}
	},
	getRatio: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = r.config, a = r.state, o = r.api, s = 0;
		if (t && o.data.shown().length) {
			if (s = t.ratio || t.value, e === "arc") {
				if (r.pie.padAngle()()) s = t.value / r.getTotalDataSum(!0);
				else {
					var c = i.gauge_fullCircle ? r.getArcLength() : r.getStartingAngle() * -2, l = r.hasType("gauge") ? c : Math.PI * 2;
					s = (t.endAngle - t.startAngle) / l;
				}
			} else if (e === "index") {
				var u = o.data.values.bind(o), d = a.hiddenTargetIds, f = this.getTotalPerIndex(r.isStackNormalizedPerGroup() ? t.id : void 0);
				if (f === null) return s;
				if (d.length) {
					var p = d;
					if (r.isStackNormalizedPerGroup() && t.id) {
						var m = i.data_groups.find(function(e) {
							return e.indexOf(t.id) >= 0;
						});
						m && (p = p.filter(function(e) {
							return m.indexOf(e) >= 0;
						}));
					}
					if (p.length) {
						var h = u(p, !1);
						h.length && (h = h.reduce(function(e, t) {
							return e.map(function(e, n) {
								return ~~e + t[n];
							});
						}), f = f.map(function(e, t) {
							return e - h[t];
						}));
					}
				}
				var g = f[t.index];
				t.ratio = J(t.value) && f && g ? t.value / g : 0, s = t.ratio;
			} else if (e === "radar") s = parseFloat(String(Math.max(t.value, 0))) / a.current.dataMax * i.radar_size_ratio;
			else if (e === "bar") {
				var _ = r.getYScaleById.bind(r)(t.id).domain().reduce(function(e, t) {
					return t - e;
				});
				s = _ === 0 ? 0 : Math.abs(r.getRangedData(t, null, e) / _);
			} else e === "treemap" && (s /= r.getTotalDataSum(!0));
		}
		return n && s ? s * 100 : s;
	},
	updateDataIndexByX: function(e) {
		var t = this, n = e.reduce(function(e, t, n) {
			return e[Number(t.x)] = n, e;
		}, {});
		t.data.targets.forEach(function(e) {
			e.values.forEach(function(e, t) {
				var r = n[Number(e.x)];
				r === void 0 && (r = t), e.index = r;
			});
		});
	},
	isBubbleZType: function(e) {
		return this.isBubbleType(e) && (Z(e.value) && ("z" in e.value || "y" in e.value) || X(e.value) && e.value.length >= 2);
	},
	isBarRangeType: function(e) {
		var t = this, n = e.value;
		return t.isBarType(e) && X(n) && n.length >= 2 && n.every(J);
	},
	getDataById: function(e) {
		var t = this.cache.get(e) || this.api.data(e);
		return t?.[0] ?? t;
	}
};
function wm(e, t) {
	t === void 0 && (t = !1);
	var n = this, r = n.api;
	t && n.api.flush(!0), e?.call(r);
}
var Tm = {
	load: function(e, t) {
		var n = this, r = n.axis, i = n.data, a = n.org, o = n.scale, s = t.append, c = {
			domain: null,
			currentDomain: null,
			x: null
		}, l = e;
		l && (t.filter && (l = l.filter(t.filter)), (t.type || t.types) && l.forEach(function(e) {
			var r = t.types?.[e.id] || t.type;
			n.setTargetType(e.id, r);
		}), i.targets.forEach(function(e) {
			for (var t = 0; t < l.length; t++) if (e.id === l[t].id) {
				e.values = s ? e.values.concat(l[t].values) : l[t].values, l.splice(t, 1);
				break;
			}
		}), i.targets = i.targets.concat(l)), n.updateTargets(i.targets), o.zoom && (c.x = r.isCategorized() ? o.x.orgScale() : (a.xScale || o.x).copy(), c.domain = n.getXDomain(i.targets), c.x.domain(c.domain), c.currentDomain = n.zoom.getDomain(), n.withinRange(c.currentDomain, void 0, c.domain) || (o.x.domain(c.domain), o.zoom = null, n.$el.eventRect.property("__zoom", null))), n.redraw({
			withUpdateOrgXDomain: !0,
			withUpdateXDomain: !0,
			withLegend: !0
		}), o.zoom ? (a.xDomain = c.domain, a.xScale = c.x, r.isCategorized() && (c.currentDomain = n.getZoomDomainValue(c.currentDomain), a.xDomain = n.getZoomDomainValue(a.xDomain), a.xScale = c.x.domain(a.xDomain)), n.updateCurrentZoomTransform(c.x, c.currentDomain)) : a.xScale && a.xScale.domain(a.xDomain), n.updateTypesElements(), wm.call(n, t.done, t.resizeAfter);
	},
	loadFromArgs: function(e) {
		var t = this;
		t.config && (t.cache.reset(), t.convertData(e, function(n) {
			var r = e.data || n;
			e.append && (r.__append__ = !0), r && t.load(t.convertDataToTargets.call(t, r), e);
		}));
	},
	unload: function(e, t) {
		var n = this, r = n.state, i = n.$el, a = n.$T, o = !!n.hasLegendDefsPoint?.call(n), s = t, c = e;
		n.cache.reset(), s ||= function() {}, c = c.filter(function(e) {
			return n.hasTarget(n.data.targets, e);
		}), !c || c.length === 0 ? s() : (c.forEach(function(e) {
			var t, a = n.getTargetSelectorSuffix(e);
			r.withoutFadeIn[e] = !1, i.legend && i.legend.selectAll(`.${R.legendItem}${a}`).remove(), n.data.targets = n.data.targets.filter(function(t) {
				return t.id !== e;
			}), o && ((t = i.defs) == null || t.select(`#${n.getDefsPointId(a)}`).remove());
		}), r.hasFunnel && n.updateFunnel(n.data.targets), r.hasTreemap && n.updateTargetsForTreemap(n.data.targets), n.updateTypesElements(), a(i.svg.selectAll(c.map(function(e) {
			return n.selectorTarget(e);
		}))).style("opacity", "0").remove().call(dp, s));
	}
}, Em = {
	setExpand: function(e, t, n) {
		var r = this, i = r.config;
		r.$el.circle && i.point_focus_expand_enabled && r.expandCircles(e, t, n), r.expandBarTypeShapes(!0, e, t, n);
	},
	expandBarTypeShapes: function(e, t, n, r) {
		e === void 0 && (e = !0);
		var i = this;
		["bar", "candlestick"].filter(function(e) {
			return i.$el[e];
		}).forEach(function(a) {
			r && i.$el[a].classed(I.EXPANDED, !1), i.getShapeByIndex(a, t, n).classed(I.EXPANDED, e);
		});
	},
	setOverOut: function(e, t) {
		var n = this, r = n.config, i = n.state, a = i.hasFunnel, o = i.hasRadar, s = i.hasTreemap, c = n.$el.main, l = Z(t);
		if (l || t !== -1) {
			var u = r[e ? "data_onover" : "data_onout"].bind(n.api);
			if (r.color_onover && n.setOverColor(e, t, l), l) {
				var d = n.getTargetSelectorSuffix(t.id), f = a || s ? `${I.target + d} .${H.shape}` : L.arc + d;
				u(t, c.select(`.${f}`).node());
			} else if (r.tooltip_grouped) e && (o && n.isPointFocusOnly() ? n.showCircleFocus(n.getAllValuesOnIndex(t, !0)) : n.setExpand(t, null, !0)), !n.isMultipleX() && c.selectAll(`.${H.shape}-${t}`).each(function(e) {
				u(e, this);
			});
			else {
				var p = n.cache.get($p.setOverOut) || [], m = c.selectAll(`.${H.shape}-${t}`).filter(function(e) {
					return n.isWithinShape(this, e);
				}), h = m.filter(function() {
					var e = this;
					return p.every(function(t) {
						return t !== e;
					});
				});
				if (!e || m.empty() || p.length === h.size() && h.nodes().every(function(e, t) {
					return e !== p[t];
				})) for (; p.length;) {
					var g = p.pop();
					r.data_onout.bind(n.api)(M(g).datum(), g);
				}
				h.each(function() {
					e && (u(M(this).datum(), this), p.push(this));
				}), n.cache.add($p.setOverOut, p);
			}
		}
	},
	callOverOutForTouch: function(e) {
		var t = this, n = t.cache.get($p.callOverOutForTouch);
		(Z(e) && n ? e.id !== n.id : e !== n) && ((n || J(n)) && t.setOverOut(!1, n), (e || J(e)) && t.setOverOut(!0, e), t.cache.add($p.callOverOutForTouch, e));
	},
	getDraggableSelection: function() {
		var e = this, t = e.config, n = e.state;
		return t.interaction_enabled && t.data_selection_draggable && e.drag ? ki().on("drag", function(t) {
			n.event = t, e.drag(hp(t, this));
		}).on("start", function(t) {
			n.event = t, e.dragstart(hp(t, this));
		}).on("end", function(t) {
			n.event = t, e.dragend();
		}) : function() {};
	},
	dispatchEvent: function(e, t, n) {
		var r, i = this, a = i.config, o = i.state, s = o.eventReceiver, c = o.hasAxis, l = o.hasFunnel, u = o.hasRadar, d = o.hasTreemap, f = i.$el, p = f.eventRect, m = f.funnel, h = f.radar, g = f.svg, _ = f.treemap, v = ((r = (l || d) && s.rect || u && h.axes.select(`.${Qd.axis}-${t} text`) || p || i.getArcElementByIdOrIndex?.call(i, t))?.node)?.call(r);
		if (v) {
			var y = i.isMultipleX(), b = a.axis_rotated, x = _p(v), S = x.width, C = x.left, w = x.top;
			if (c && !u && !y) {
				var T = s.coords[t];
				T ? (S = T.w, C += T.x, w += T.y) : (S = 0, C = 0, w = 0);
			}
			var E = C + (n ? n[0] : 0) + (y || b ? 0 : S / 2), D = w + (n ? n[1] : 0) + (b ? 4 : 0);
			if (Vp(g)) {
				var O = Ap(i.$el.eventRect.node(), E, D, !1);
				E = O.x, D = O.y;
			}
			var k = {
				screenX: E,
				screenY: D,
				clientX: E,
				clientY: D,
				bubbles: u
			};
			(l || d) && (v = (m ?? _).node()), Rp[/^(mouse|click)/.test(e) ? "mouse" : "touch"](v, e, k);
		}
	},
	setDragStatus: function(e) {
		this.state.dragging = e;
	},
	unbindZoomEvent: function() {
		var e = this.$el, t = e.eventRect, n = e.zoomResetBtn;
		t?.on(".zoom wheel.zoom .drag", null), n?.on("click", null).style("display", "none");
	},
	unbindAllEvents: function() {
		var e, t = this, n = t.$el, r = n.arcs, i = n.eventRect, a = n.legend, o = n.region, s = n.svg, c = n.treemap, l = t.brush, u = "wheel click mouseover mousemove mouseout touchstart touchmove touchend touchstart.eventRect touchmove.eventRect touchend.eventRect .brush .drag .zoom wheel.zoom dblclick.zoom";
		[
			s,
			i,
			o?.list,
			l?.getSelection(),
			r?.selectAll("path"),
			a?.selectAll("g"),
			c
		].forEach(function(e) {
			return e?.on(u, null);
		}), (e = t.unbindZoomEvent) == null || e.call(t);
	}
}, Dm = { categoryName: function(e) {
	return this.config.axis_x_categories?.[e] ?? e;
} }, Om = {
	generateClass: function(e, t) {
		return ` ${e} ${e + this.getTargetSelectorSuffix(t)}`;
	},
	getClass: function(e, t) {
		var n = this, r = /s$/.test(e), i = /^(area|arc|line|funnel|treemap)s?$/.test(e), a = r ? "id" : "index";
		return function(o) {
			var s = o.data || o;
			return ((t ? n.generateClass(U[r ? "shapes" : "shape"], s[a]) : "") + n.generateClass(U[e], s[i ? "id" : a])).trim();
		};
	},
	getChartClass: function(e) {
		var t = this;
		return function(n) {
			return U[`chart${e}`] + t.classTarget((n.data ? n.data : n).id);
		};
	},
	generateExtraLineClass: function() {
		var e = this.config.line_classes || [], t = [];
		return function(n) {
			var r = n.id || n.data?.id || n;
			return t.indexOf(r) < 0 && t.push(r), e[t.indexOf(r) % e.length];
		};
	},
	classRegion: function(e, t) {
		return `${this.generateClass(U.region, t)} ${"class" in e ? e.class : ""}`;
	},
	classTarget: function(e) {
		var t = this.config.data_classes[e], n = "";
		return t && (n = ` ${U.target}-${t}`), this.generateClass(U.target, e) + n;
	},
	classFocus: function(e) {
		return this.classFocused(e) + this.classDefocused(e);
	},
	classFocused: function(e) {
		return ` ${this.state.focusedTargetIds.indexOf(e.id) >= 0 ? U.focused : ""}`;
	},
	classDefocused: function(e) {
		return ` ${this.state.defocusedTargetIds.indexOf(e.id) >= 0 ? U.defocused : ""}`;
	},
	getTargetSelectorSuffix: function(e) {
		return (e || e === 0 ? `-${e}` : "").replace(/[\x00-\x20\x7F-\xA0\s?!@#$%^&*()_=+,.<>'":;\[\]\/|~`{}\\]/g, "-");
	},
	selectorTarget: function(e, t, n) {
		t === void 0 && (t = ""), n === void 0 && (n = "");
		var r = this.getTargetSelectorSuffix(e);
		return `${t}.${U.target + r} ${n}, ${t}.${U.circles + r} ${n}`;
	},
	selectorTargets: function(e, t) {
		var n = this, r = e || [];
		return r.length ? r.map(function(e) {
			return n.selectorTarget(e, t);
		}) : null;
	},
	selectorLegend: function(e) {
		return `.${U.legendItem + this.getTargetSelectorSuffix(e)}`;
	},
	selectorLegends: function(e) {
		var t = this;
		return e?.length ? e.map(function(e) {
			return t.selectorLegend(e);
		}) : null;
	}
}, km = function(e, t, n) {
	var r = M(e.cloneNode(!0));
	return r.attr("id", n).insert("rect", ":first-child").attr("width", r.attr("width")).attr("height", r.attr("height")).style("fill", t), {
		id: n,
		node: r.node()
	};
};
function Am(e) {
	var t = $p.colorPattern, n = Df.body, r = n[t];
	if (!r) {
		var i = ";", a = e.classed(nf.colorPattern, !0).style("background-image");
		e.classed(nf.colorPattern, !1), a.indexOf(i) > -1 && (r = a.replace(/url[^#]*|["'()]|(\s|%20)/g, "").split(i).map(function(e) {
			return e.trim().replace(/[\"'\s]/g, "");
		}).filter(Boolean), n[t] = r);
	}
	return r;
}
var jm = [
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
], Mm = {
	generateColor: function() {
		var e = this, t = e.$el, n = e.config, r = [], i = n.area_linearGradient || n.bar_linearGradient || n.point_radialGradient, a = cp(n.color_pattern) ? n.color_pattern : Mc(Am(t.chart) || jm).range(), o = a;
		if (K(n.color_tiles)) {
			var s = n.color_tiles.bind(e.api)(), c = a.map(function(t, n) {
				var r = t.replace(/[#\(\)\s,]/g, ""), i = `${e.state.datetimeId}-pattern-${r}-${n}`;
				return km(s[n % s.length], t, i);
			});
			a = c.map(function(e) {
				return `url(#${e.id})`;
			}), e.patterns = c;
		}
		return function(t) {
			var s = n.data_colors, c = n.data_color, l = t.id || t.data?.id || t, u = e.isTypeOf(l, [
				"line",
				"spline",
				"step"
			]) || !n.data_types[l], d;
			if (K(s[l]) ? d = s[l].bind(e.api)(t) : s[l] ? d = s[l] : (r.indexOf(l) < 0 && r.push(l), d = u ? o[r.indexOf(l) % o.length] : a[r.indexOf(l) % a.length], s[l] = d), d = K(c) ? c.call(e.api, d, t) : d, i) {
				var f = e.$el.defs.selectAll(`[id\$='-gradient${e.getTargetSelectorSuffix(l)}'] stop`), p;
				f.each(function(e, t) {
					p = t === 0 ? this.style.stopColor : this.style.stopColor === p;
				}), p === !0 && f.attr("stop-color", d);
			}
			return d;
		};
	},
	generateLevelColor: function() {
		var e = this.config, t = e.color_pattern, n = e.color_threshold, r = n.unit === "value", i = n.max || 100, a = n.values && n.values.length ? n.values : [];
		return cp(n) ? function(e) {
			for (var n = r ? e : e * 100 / i, o = t[t.length - 1], s = 0, c = a.length; s < c; s++) if (n <= a[s]) {
				o = t[s];
				break;
			}
			return o;
		} : null;
	},
	generateTextBGColorFilter: function(e, t) {
		t === void 0 && (t = {
			x: 0,
			y: 0,
			width: 1,
			height: 1
		});
		var n = this, r = n.$el.defs, i = n.state;
		if (e) {
			var a = [];
			q(e) ? a.push("") : Z(e) ? a = Object.keys(e) : K(e) && (a = n.mapToTargetIds()), a.forEach(function(a) {
				var o = `${i.datetimeId}-labels-bg${n.getTargetSelectorSuffix(a)}${q(e) ? n.getTargetSelectorSuffix(e) : ""}`, s = Zf(a === "" ? e : e?.[a] || "");
				r.select(`#${o}`).empty() && r.append("filter").attr("x", t.x).attr("y", t.y).attr("width", t.width).attr("height", t.height).attr("id", o).html(`<feFlood flood-color="${s}" />
							<feComposite in="SourceGraphic" />`);
			});
		}
	},
	getGradienColortUrl: function(e) {
		return `url(#${this.state.datetimeId}-gradient${this.getTargetSelectorSuffix(e)})`;
	},
	updateLinearGradient: function() {
		var e = this, t = e.config, n = e.data.targets, r = e.state.datetimeId, i = e.$el.defs;
		n.forEach(function(n) {
			var a = `${r}-gradient${e.getTargetSelectorSuffix(n.id)}`, o = e.hasPointType() && t.point_radialGradient, s = e.isAreaType(n) && "area" || e.isBarType(n) && "bar";
			if ((o || s) && i.select(`#${a}`).empty()) {
				var c = e.color(n), l = {
					defs: null,
					stops: []
				};
				if (o) {
					var u = o.cx, d = u === void 0 ? .3 : u, f = o.cy, p = f === void 0 ? .3 : f, m = o.r, h = m === void 0 ? .7 : m, g = o.stops, _ = g === void 0 ? [[
						.1,
						c,
						0
					], [
						.9,
						c,
						1
					]] : g;
					l.stops = _, l.defs = i.append("radialGradient").attr("id", `${a}`).attr("cx", d).attr("cy", p).attr("r", h);
				} else {
					var v = t.axis_rotated, y = t[`${s}_linearGradient`], b = y.x, x = b === void 0 ? v ? [1, 0] : [0, 0] : b, S = y.y, C = S === void 0 ? v ? [0, 0] : [0, 1] : S, w = y.stops, _ = w === void 0 ? [[
						0,
						c,
						1
					], [
						1,
						c,
						0
					]] : w;
					l.stops = _, l.defs = i.append("linearGradient").attr("id", `${a}`).attr("x1", x[0]).attr("x2", x[1]).attr("y1", C[0]).attr("y2", C[1]);
				}
				l.stops.forEach(function(t) {
					var r = t[0], i = t[1], a = t[2], o = K(i) ? i.bind(e.api)(n.id) : i;
					l.defs && l.defs.append("stop").attr("offset", r).attr("stop-color", o || c).attr("stop-opacity", a);
				});
			}
		});
	},
	setOverColor: function(e, t) {
		var n = this, r = n.config, i = n.$el.main, a = r.color_onover, o = e ? a : n.color;
		Z(o) ? o = function(e) {
			var t = e.id;
			return t in a ? a[t] : n.color(t);
		} : q(o) ? o = function() {
			return a;
		} : K(a) && (o = o.bind(n.api)), i.selectAll(Z(t) ? `.${L.arc}${n.getTargetSelectorSuffix(t.id)}` : `.${H.shape}-${t}`).style("fill", o);
	}
}, Nm = {
	getYDomainMinMax: function(e, t) {
		var n = this, r = n.axis, i = n.config, a = t === "min", o = i.data_groups, s = n.mapToIds(e), c = Jp(s), l = n.getValuesAsIdKeyed(e);
		if (o.length > 0) {
			var u = n[`has${a ? "Negative" : "Positive"}ValueInTargets`](e), d = new Map(s.map(function(e) {
				return [e, r.getId(e)];
			}));
			o.forEach(function(e) {
				var t = e.filter(function(e) {
					return c.has(e);
				});
				if (t.length) {
					var n = t[0], r = d.get(n);
					u && l[n] && (l[n] = l[n].map(function(e) {
						return (a ? e < 0 : e > 0) ? e : 0;
					})), t.filter(function(e, t) {
						return t > 0;
					}).forEach(function(e) {
						if (l[e]) {
							var t = d.get(e);
							l[e].forEach(function(e, i) {
								var o = +e;
								t === r && !(u && (a ? o > 0 : o < 0)) && (l[n][i] += o);
							});
						}
					});
				}
			});
		}
		return Ip(t, Object.keys(l).map(function(e) {
			return Ip(t, l[e]);
		}));
	},
	isHiddenTargetWithYDomain: function(e) {
		var t = this;
		return t.state.hiddenTargetIds.some(function(n) {
			return t.axis.getId(n) === e;
		});
	},
	getYDomain: function(e, t, n) {
		var r = this, i = r.axis, a = r.config, o = r.scale, s = `axis_${t}`;
		if (r.isStackNormalized() && e.filter(function(e) {
			return i.getId(e.id) === t;
		}).map(function(e) {
			return e.id;
		}).some(function(e) {
			return r.isGrouped(e);
		})) return [0, 100];
		var c = o?.[t] && o[t].type === "log", l = e.filter(function(e) {
			return i.getId(e.id) === t;
		}), u = n ? r.filterByXDomain(l, n) : l;
		if (u.length === 0) return r.isHiddenTargetWithYDomain(t) ? o[t].domain() : t === "y2" ? o.y.domain() : r.getYDomain(e, "y2", n);
		var d = a[`${s}_min`], f = a[`${s}_max`], p = a[`${s}_center`], m = a[`${s}_inverted`], h = r.hasDataLabel() && a.axis_rotated, g = r.hasDataLabel() && !a.axis_rotated, _ = r.getYDomainMinMax(u, "min"), v = r.getYDomainMinMax(u, "max"), y = Xd([
			$.BAR,
			$.BUBBLE,
			$.SCATTER
		], nm.Line, !0).some(function(e) {
			var t = e.indexOf("area") > -1 ? "area" : e;
			return r.hasType(e, u, !0) && a[`${t}_zerobased`];
		});
		_ = G(d) ? d : G(f) ? _ <= f ? _ : f - 10 : _, v = G(f) ? f : G(d) ? d <= v ? v : d + 10 : v, isNaN(_) && (_ = 0), isNaN(v) && (v = _), _ === v && (_ < 0 ? v = 0 : _ = 0);
		var b = _ >= 0 && v >= 0, x = _ <= 0 && v <= 0;
		(G(d) && b || G(f) && x) && (y = !1), y && (b && (_ = 0), x && (v = 0));
		var S = Math.abs(v - _), C = {
			top: S * .1,
			bottom: S * .1
		};
		if (Y(p)) {
			var w = Math.max(Math.abs(_), Math.abs(v));
			v = p + w, _ = p - w;
		}
		if (h) {
			var T = ip(o.y.range()), E = r.getDataLabelLength(_, v, "width").map(function(e) {
				var t = e / T;
				return isFinite(t) ? t : 0;
			});
			["bottom", "top"].forEach(function(e, t) {
				C[e] += S * (E[t] / (1 - E[0] - E[1]));
			});
		} else if (g) {
			var D = r.getDataLabelLength(_, v, "height");
			["bottom", "top"].forEach(function(e, t) {
				C[e] += r.convertPixelToScale("y", D[t], S);
			});
		}
		C = r.getResettedPadding(C);
		var O = a[`${s}_padding`];
		cp(O) && ["bottom", "top"].forEach(function(e) {
			C[e] = i.getPadding(O, e, C[e], S);
		}), y && (b && (C.bottom = _), x && (C.top = -v));
		var k = c ? [_, v].map(function(e) {
			return e < 0 ? 0 : e;
		}) : [_ - C.bottom, v + C.top];
		return m ? k.reverse() : k;
	},
	getXDomainMinMax: function(e, t) {
		var n = this, r = n.config[`axis_x_${t}`], i = Ip(t, e.map(function(e) {
			return Ip(t, e.values.map(function(e) {
				return e.x;
			}));
		})), a = Z(r) ? r.value : r;
		return a = Y(a) && n.axis?.isTimeSeries() ? Bp.bind(this)(a) : a, Z(r) && r.fit && (t === "min" && a < i || t === "max" && a > i) && (a = void 0), Y(a) ? a : i;
	},
	getXDomainPadding: function(e, t) {
		var n = this, r = n.axis, i = n.config.axis_x_padding, a = r.isTimeSeries() && t, o = ip(e), s;
		if (r.isCategorized() || a) s = 0;
		else if (n.hasType("bar")) {
			var c = n.getMaxDataCount();
			s = c > 1 ? o / (c - 1) / 2 : .5;
		} else s = n.getResettedPadding(o * .01);
		var l = J(i) ? {
			left: i,
			right: i
		} : i, u = l.left, d = u === void 0 ? s : u, f = l.right, p = f === void 0 ? s : f;
		if (i.unit === "px") {
			var m = Math.abs(o + o * .2);
			d = r.getPadding(i, "left", s, m), p = r.getPadding(i, "right", s, m);
		} else {
			var h = o + d + p;
			if (a && h) {
				var g = o / t / h;
				d = d / h / g, p = p / h / g;
			}
		}
		return {
			left: d,
			right: p
		};
	},
	getXDomain: function(e) {
		var t = this, n = t.axis, r = t.config, i = t.scale.x, a = r.axis_x_inverted, o = [t.getXDomainMinMax(e, "min"), t.getXDomainMinMax(e, "max")], s = o[0], c = s === void 0 ? 0 : s, l = o[1], u = l === void 0 ? 0 : l;
		if (i.type !== "log") {
			var d = n.isCategorized(), f = n.isTimeSeries(), p = t.getXDomainPadding(o), m = o[0], h = o[1];
			m - h === 0 && !d && (f ? (m = /* @__PURE__ */ new Date(m.getTime() * .5), h = /* @__PURE__ */ new Date(h.getTime() * 1.5)) : (m = m === 0 ? 1 : m * .5, h = h === 0 ? -1 : h * 1.5)), (m || m === 0) && (c = f ? new Date(m.getTime() - p.left) : m - p.left), (h || h === 0) && (u = f ? new Date(h.getTime() + p.right) : h + p.right);
		}
		return a ? [u, c] : [c, u];
	},
	updateXDomain: function(e, t, n, r, i) {
		var a, o = this, s = o.config, c = o.org, l = o.scale, u = l.x, d = l.subX, f = s.zoom_enabled;
		if (n && (u.domain(i || Fp(o.getXDomain(e), !s.axis_x_inverted)), c.xDomain = u.domain(), d.domain(u.domain()), (a = o.brush) == null || a.scale(d)), t) {
			var p = i || !o.brush || xp(o) ? c.xDomain : gp(o).map(d.invert);
			u.domain(p);
		}
		return (n || t) && f && o.zoom.updateScaleExtent(), r && u.domain(o.trimXDomain(u.orgDomain())), u.domain();
	},
	trimXDomain: function(e) {
		var t = this, n = t.config.axis_x_inverted, r = t.getZoomDomain(), i = r[0], a = r[1];
		return (n ? e[0] >= i : e[0] <= i) && (e[1] = +e[1] + (i - e[0]), e[0] = i), (n ? e[1] <= a : e[1] >= a) && (e[0] = +e[0] - (e[1] - a), e[1] = a), e;
	},
	getZoomDomain: function(e, t) {
		e === void 0 && (e = "zoom"), t === void 0 && (t = !1);
		var n = this, r = n.config, i = n.scale, a = n.org, o = t && i[e] ? i[e].domain() : a.xDomain, s = o[0], c = o[1];
		return e === "zoom" && (Y(r.zoom_x_min) && (s = Ip("min", [s, r.zoom_x_min])), Y(r.zoom_x_max) && (c = Ip("max", [c, r.zoom_x_max]))), [s, c];
	},
	getZoomDomainValue: function(e) {
		var t = this, n = t.config;
		if (t.axis.isCategorized() && Array.isArray(e)) {
			var r = n.axis_x_inverted;
			return e.map(function(e, t) {
				return Number(e) + (t === 0 ? +r : +!r);
			});
		}
		return e;
	},
	convertPixelToScale: function(e, t, n) {
		var r = this, i = r.config, a = r.state, o = i.axis_rotated;
		return n * (t / a[e === "x" ? o ? "height" : "width" : o ? "width" : "height"]);
	},
	withinRange: function(e, t, n) {
		t === void 0 && (t = [0, 0]);
		var r = this.config.axis_x_inverted, i = n, a = i[0], o = i[1];
		if (Array.isArray(e)) {
			var s = Xd([], e, !0);
			if (r && s.reverse(), s[0] < s[1]) return e.every(function(n, i) {
				return (i === 0 ? r ? +n <= a : +n >= a : r ? +n >= o : +n <= o) && !e.every(function(e, n) {
					return e === t[n];
				});
			});
		}
		return !1;
	}
};
function Pm(e, t, n) {
	var r = e.config, i = `axis_${t}_tick_format`;
	return (r[i] ? r[i] : e.defaultValueFormat).call(e.api, n);
}
var Fm = {
	yFormat: function(e) {
		return Pm(this, "y", e);
	},
	y2Format: function(e) {
		return Pm(this, "y2", e);
	},
	getDefaultValueFormat: function() {
		var e = this, t = e.defaultArcValueFormat, n = e.yFormat, r = e.y2Format, i = e.hasArcType(null, [
			"gauge",
			"polar",
			"radar"
		]);
		return function(a, o, s) {
			return (i ? t : e.axis && e.axis.getId(s) === "y2" ? r : n).call(e, a, o);
		};
	},
	defaultValueFormat: function(e) {
		return X(e) ? e.join("~") : G(e) ? +e : "";
	},
	defaultArcValueFormat: function(e, t) {
		return `${(t * 100).toFixed(1)}%`;
	},
	defaultPolarValueFormat: function(e) {
		return `${e}`;
	},
	dataLabelFormat: function(e) {
		var t = this, n = t.config.data_labels, r = function(e) {
			var t = "~", n = e;
			return X(e) ? n = e.join(t) : Z(e) && (n = Object.values(e).join(t)), n;
		}, i = r;
		return K(n.format) ? i = n.format : ap(n.format) && (i = n.format[e] ? n.format[e] === !0 ? r : n.format[e] : function() {
			return "";
		}), i.bind(t.api);
	}
};
function Im(e) {
	var t = this, n = t.getDataById(e);
	return t.levelColor ? t.levelColor(n.values[0].value) : t.color(n);
}
function Lm(e, t) {
	t === void 0 && (t = !0);
	var n = this.config, r = n.data_names[e] ?? e;
	return t && K(n.legend_format) && (r = n.legend_format(r, e === r ? void 0 : e)), r;
}
function Rm(e, t) {
	if (t && !t.empty()) {
		var n = [];
		t.each(function(e) {
			n.push({
				id: e,
				node: this
			});
		});
		var r = Yp(n, function(e) {
			return e.id;
		}, function(e) {
			return e.node;
		});
		e.cache.add($p.legendItemMap, r);
	}
}
var zm = {
	initLegend: function() {
		var e = this, t = e.config, n = e.$el;
		e.legendItemTextBox = {}, e.state.legendHasRendered = !1, t.legend_show ? (t.legend_contents_bindto || (n.legend = e.$el.svg.append("g").classed(R.legend, !0).attr("transform", e.getTranslate("legend"))), e.updateLegend()) : e.state.hiddenLegendIds = e.mapToIds(e.data.targets);
	},
	updateLegend: function(e, t, n) {
		var r, i = this, a = i.config, o = i.state, s = i.scale, c = i.$el, l = t || {
			withTransform: !1,
			withTransitionForTransform: !1,
			withTransition: !1
		};
		l.withTransition = lp(l, "withTransition", !0), l.withTransitionForTransform = lp(l, "withTransitionForTransform", !0), a.legend_contents_bindto && a.legend_contents_template ? i.updateLegendTemplate() : o.hasTreemap || i.updateLegendElement(e || i.mapToIds(i.data.targets), l, n), (r = c.legend) == null || r.selectAll(`.${R.legendItem}`).classed(R.legendItemHidden, function(e) {
			var t = !i.isTargetToShow(e);
			return t && (this.style.opacity = null), t;
		}), i.updateScales(!1, !s.zoom), i.updateSvgSize(), i.transformAll(l.withTransitionForTransform, n), o.legendHasRendered = !0;
	},
	updateLegendTemplate: function() {
		var e = this, t = e.config, n = e.$el, r = M(t.legend_contents_bindto), i = t.legend_contents_template;
		if (!r.empty()) {
			var a = e.mapToIds(e.data.targets), o = [], s = "";
			a.forEach(function(t) {
				var n = K(i) ? Zf(i.call(e.api, t, e.color(t), e.api.data(t)[0].values)) : zp(i, {
					COLOR: e.color(t),
					TITLE: t
				});
				n && (o.push(t), s += n);
			});
			var c = r.html(s).selectAll(function() {
				return this.childNodes;
			}).data(o);
			e.setLegendItem(c), n.legend = r;
		}
	},
	updateSizeForLegend: function(e) {
		var t = this, n = t.config, r = t.state, i = r.isLegendTop, a = r.isLegendLeft, o = r.isLegendRight, s = r.isLegendInset, c = r.current, l = e.width, u = e.height, d = {
			top: i ? t.getCurrentPaddingByDirection("top") + n.legend_inset_y + 5.5 : c.height - u - t.getCurrentPaddingByDirection("bottom") - n.legend_inset_y,
			left: a ? t.getCurrentPaddingByDirection("left") + n.legend_inset_x + .5 : c.width - l - t.getCurrentPaddingByDirection("right") - n.legend_inset_x + .5
		};
		t.state.margin3 = {
			top: o ? 0 : s ? d.top : c.height - u,
			right: NaN,
			bottom: 0,
			left: o ? c.width - l : s ? d.left : 0
		};
	},
	transformLegend: function(e) {
		var t = this, n = t.$el.legend, r = t.$T;
		r(n, e).attr("transform", t.getTranslate("legend"));
	},
	updateLegendStep: function(e) {
		this.state.legendStep = e;
	},
	updateLegendItemWidth: function(e) {
		this.state.legendItemWidth = e;
	},
	updateLegendItemHeight: function(e) {
		this.state.legendItemHeight = e;
	},
	updateLegendItemColor: function(e, t) {
		var n = this;
		if (n.$el.legend) {
			var r = n.getLegendItemById(e);
			r && M(r).select("line").style("stroke", t);
		}
	},
	getLegendWidth: function() {
		var e = this, t = e.state, n = t.current.width, r = t.isLegendRight, i = t.isLegendInset, a = t.legendItemWidth, o = t.legendStep;
		return e.config.legend_show ? r || i ? a * (o + 1) : n : 0;
	},
	getLegendHeight: function() {
		var e = this, t = e.state, n = t.current, r = t.isLegendRight, i = t.legendItemHeight, a = t.legendStep, o = e.config.padding?.mode === "fit";
		return e.config.legend_show ? r ? n.height : Math.max(o ? 10 : 20, i) * (a + 1) : 0;
	},
	opacityForUnfocusedLegend: function(e) {
		return e.classed(R.legendItemHidden) ? null : "0.3";
	},
	toggleFocusLegend: function(e, t) {
		var n = this, r = n.$el.legend, i = n.$T, a = n.mapToTargetIds(e);
		r && i(r.selectAll(`.${R.legendItem}`).filter(function(e) {
			return a.indexOf(e) >= 0;
		}).classed(z.legendItemFocused, t)).style("opacity", function() {
			return t ? null : n.opacityForUnfocusedLegend.call(n, M(this));
		});
	},
	revertLegend: function() {
		var e = this, t = e.$el.legend, n = e.$T;
		t && n(t.selectAll(`.${R.legendItem}`).classed(z.legendItemFocused, !1)).style("opacity", null);
	},
	showLegend: function(e) {
		var t = this, n = t.config, r = t.$el, i = t.$T;
		n.legend_show || (n.legend_show = !0, r.legend ? r.legend.style("visibility", null) : t.initLegend(), !t.state.legendHasRendered && t.updateLegend()), t.removeHiddenLegendIds(e), i(r.legend.selectAll(t.selectorLegends(e)).style("visibility", null)).style("opacity", null);
	},
	hideLegend: function(e) {
		var t = this, n = t.config, r = t.$el.legend;
		n.legend_show && sp(e) && (n.legend_show = !1, r.style("visibility", "hidden")), t.addHiddenLegendIds(e), r.selectAll(t.selectorLegends(e)).style("opacity", "0").style("visibility", "hidden");
	},
	getLegendItemTextBox: function(e, t) {
		var n = this, r = n.cache, i = n.state, a, o = $p.legendItemTextBox;
		return e && (a = !i.redrawing && r.get(o) || {}, a[e] || (a[e] = n.getTextRect(t, R.legendItem), r.add(o, a)), a = a[e]), a;
	},
	setLegendItem: function(e) {
		var t = this, n = t.$el, r = t.api, i = t.config, a = t.state, o = a.inputType === "touch", s = t.hasType("gauge"), c = i.boost_useCssRule, l = i.legend_item_interaction;
		e.attr("class", function(e) {
			var n = M(this);
			return (!n.empty() && n.attr("class") || "") + t.generateClass(R.legendItem, e);
		}).style("visibility", function(e) {
			return t.isLegendToShow(e) ? null : "hidden";
		}), i.interaction_enabled && (c && [
			[`.${R.legendItem}`, "cursor:pointer"],
			[`.${R.legendItem} text`, "pointer-events:none"],
			[`.${R.legendItemPoint} text`, "pointer-events:none"],
			[`.${R.legendItemTile}`, "pointer-events:none"],
			[`.${R.legendItemEvent}`, "fill-opacity:0"]
		].forEach(function(e) {
			var r = e[0], i = e[1];
			t.setCssRule(!1, r, [i])(n.legend);
		}), e.on(l.dblclick ? "dblclick" : "click", l || K(i.legend_item_onclick) ? function(e, n) {
			if (!Q(i.legend_item_onclick, r, n, !a.hiddenTargetIds.includes(n))) {
				var s = e.altKey, c = e.target;
				e.type === "dblclick" || s ? a.hiddenTargetIds.length && c.parentNode.getAttribute("class").indexOf(R.legendItemHidden) === -1 ? r.show() : (r.hide(), r.show(n)) : (r.toggle(n), M(this).classed(z.legendItemFocused, !1));
			}
			o && t.hideTooltip();
		} : null), !o && e.on("mouseout", l || K(i.legend_item_onout) ? function(e, n) {
			Q(i.legend_item_onout, r, n, !a.hiddenTargetIds.includes(n)) || (M(this).classed(z.legendItemFocused, !1), s && t.undoMarkOverlapped(t, `.${of.gaugeValue}`), t.api.revert());
		} : null).on("mouseover", l || K(i.legend_item_onover) ? function(e, n) {
			Q(i.legend_item_onover, r, n, !a.hiddenTargetIds.includes(n)) || (M(this).classed(z.legendItemFocused, !0), s && t.markOverlapped(n, t, `.${of.gaugeValue}`), !a.transiting && t.isTargetToShow(n) && r.focus(n));
		} : null), !e.empty() && e.on("click mouseout mouseover") && e.style("cursor", t.getStylePropValue("pointer"))), Rm(t, e);
	},
	getLegendItemById: function(e) {
		var t = this, n = t.cache.get($p.legendItemMap);
		return n && n instanceof Map ? n.get(e) || null : (t.$el.legend?.selectAll(`.${R.legendItem}`).filter(function(t) {
			return t === e;
		}))?.node() || null;
	},
	updateLegendElement: function(e, t) {
		var n = this, r = n.config, i = n.state, a = n.$el.legend, o = n.$T, s = r.legend_item_tile_type !== "circle", c = r.legend_item_tile_r, l = {
			width: s ? r.legend_item_tile_width : c * 2,
			height: s ? r.legend_item_tile_height : c * 2
		}, u = {
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
			tileWidth: l.width + 5,
			totalLength: 0
		}, d = {
			offsets: {},
			widths: {},
			heights: {},
			margins: [0],
			steps: {}
		}, f, p, m, h = e.filter(function(e) {
			return !Y(r.data_names[e]) || r.data_names[e] !== null;
		}), g = t.withTransition, _ = n.getUpdateLegendPositions(h, u, d);
		i.isLegendInset && (u.step = r.legend_inset_step ? r.legend_inset_step : h.length, n.updateLegendStep(u.step)), i.isLegendRight ? (f = function(e) {
			return u.max.width * d.steps[e];
		}, p = function(e) {
			return d.margins[d.steps[e]] + d.offsets[e];
		}) : i.isLegendInset ? (f = function(e) {
			return u.max.width * d.steps[e] + 10;
		}, p = function(e) {
			return d.margins[d.steps[e]] + d.offsets[e];
		}) : (f = function(e) {
			return d.margins[d.steps[e]] + d.offsets[e];
		}, p = function(e) {
			return u.max.height * d.steps[e];
		});
		var v = {
			xText: function(e, t) {
				return f(e, t) + 4 + l.width;
			},
			xRect: function(e, t) {
				return f(e, t);
			},
			x1Tile: function(e, t) {
				return f(e, t) - 2;
			},
			x2Tile: function(e, t) {
				return f(e, t) - 2 + l.width;
			},
			yText: function(e, t) {
				return p(e, t) + 9;
			},
			yRect: function(e, t) {
				return p(e, t) - 5;
			},
			yTile: function(e, t) {
				return p(e, t) + 4;
			}
		};
		n.generateLegendItem(h, l, _, v), m = a.select(`.${R.legendBackground} rect`), i.isLegendInset && u.max.width > 0 && m.size() === 0 && (m = a.insert("g", `.${R.legendItem}`).attr("class", R.legendBackground).append("rect")), r.legend_tooltip && a.selectAll("title").data(h).text(function(e) {
			return Lm.bind(n)(e, !1);
		}), o(a.selectAll("text").data(h).text(function(e) {
			return Lm.bind(n)(e);
		}).each(function(e, t) {
			_(this, e, t);
		}), g).attr("x", v.xText).attr("y", v.yText), o(a.selectAll(`rect.${R.legendItemEvent}`).data(h), g).attr("width", function(e) {
			return d.widths[e];
		}).attr("height", function(e) {
			return d.heights[e];
		}).attr("x", v.xRect).attr("y", v.yRect), n.updateLegendItemPos(h, g, v), m && o(m, g).attr("height", n.getLegendHeight() - 12).attr("width", u.max.width * (u.step + 1) + 10), n.updateLegendItemWidth(u.max.width), n.updateLegendItemHeight(u.max.height), n.updateLegendStep(u.step);
	},
	getUpdateLegendPositions: function(e, t, n) {
		var r = this, i = r.config, a = r.state, o = a.isLegendRight || a.isLegendInset;
		return function(s, c, l) {
			var u = l === 0, d = l === e.length - 1, f = r.getLegendItemTextBox(c, s), p = f.width + t.tileWidth + (d && !o ? 0 : t.padding.right) + i.legend_padding, m = f.height + t.padding.top, h = o ? m : p, g = o ? r.getLegendHeight() : r.getLegendWidth(), _, v = function(e, r) {
				r || (_ = (g - t.totalLength - h) / 2, _ < t.posMin && (_ = (g - h) / 2, t.totalLength = 0, t.step++)), n.steps[e] = t.step, n.margins[t.step] = a.isLegendInset ? 10 : _, n.offsets[e] = t.totalLength, t.totalLength += h;
			};
			if (u && (t.totalLength = 0, t.step = 0, t.max.width = 0, t.max.height = 0), i.legend_show && !r.isLegendToShow(c)) n.widths[c] = 0, n.heights[c] = 0, n.steps[c] = 0, n.offsets[c] = 0;
			else {
				n.widths[c] = p, n.heights[c] = m, (!t.max.width || p >= t.max.width) && (t.max.width = p), (!t.max.height || m >= t.max.height) && (t.max.height = m);
				var y = o ? t.max.height : t.max.width;
				i.legend_equally ? (Object.keys(n.widths).forEach(function(e) {
					return n.widths[e] = t.max.width;
				}), Object.keys(n.heights).forEach(function(e) {
					return n.heights[e] = t.max.height;
				}), _ = (g - y * e.length) / 2, _ < t.posMin ? (t.totalLength = 0, t.step = 0, e.forEach(function(e) {
					return v(e);
				})) : v(c, !0)) : v(c);
			}
		};
	},
	generateLegendItem: function(e, t, n, r) {
		var i = this, a = i.config, s = i.state, c = i.$el.legend, l = a.legend_usePoint, u = a.legend_item_tile_r, d = a.legend_item_tile_type, f = d !== "circle", p = s.isLegendRight || s.isLegendInset, m = -200, h = c.selectAll(`.${R.legendItem}`).data(e).enter().append("g");
		if (i.setLegendItem(h), a.legend_tooltip && h.append("title").text(function(e) {
			return e;
		}), h.append("text").text(function(e) {
			return Lm.bind(i)(e);
		}).each(function(e, t) {
			n(this, e, t);
		}).style("pointer-events", i.getStylePropValue("none")).attr("x", p ? r.xText : m).attr("y", p ? m : r.yText), h.append("rect").attr("class", R.legendItemEvent).style("fill-opacity", i.getStylePropValue("0")).attr("x", p ? r.xRect : m).attr("y", p ? m : r.yRect), l) {
			var g = [], _ = i.getValidPointPattern();
			h.append(function(e) {
				g.indexOf(e) === -1 && g.push(e);
				var t = _[g.indexOf(e) % _.length];
				return t === "rectangle" && (t = "rect"), Df.createElementNS(o.svg, "hasValidPointType" in i && i.hasValidPointType(t) ? t : "use");
			}).attr("class", R.legendItemPoint).style("fill", Im.bind(i)).style("pointer-events", i.getStylePropValue("none")).attr("href", function(e, t, n) {
				var r = n[t].nodeName.toLowerCase(), a = i.getTargetSelectorSuffix(e);
				return r === "use" ? `#${s.datetimeId}-point${a}` : void 0;
			});
		} else h.append(f ? "line" : d).attr("class", R.legendItemTile).style("stroke", Im.bind(i)).style("pointer-events", i.getStylePropValue("none")).call(function(e) {
			d === "circle" ? e.attr("r", u).style("fill", Im.bind(i)).attr("cx", p ? r.x2Tile : m).attr("cy", p ? m : r.yTile) : f && e.attr("stroke-width", t.height).attr("x1", p ? r.x1Tile : m).attr("y1", p ? m : r.yTile).attr("x2", p ? r.x2Tile : m).attr("y2", p ? m : r.yTile);
		});
	},
	updateLegendItemPos: function(e, t, n) {
		var r = this, i = r.config, a = r.$el.legend, o = r.$T, s = i.legend_usePoint, c = i.legend_item_tile_type, l = c !== "circle";
		if (s) {
			var u = a.selectAll(`.${R.legendItemPoint}`).data(e);
			o(u, t).each(function() {
				var e = this.nodeName.toLowerCase(), t = i.point_r, r = "x", a = "y", o = 2, s = 2.5, c = null, l = null, u = null;
				if (e === "circle") {
					var d = t * .2;
					r = "cx", a = "cy", c = t + d, o = t * 2, s = -d;
				} else if (e === "rect") {
					var d = t * 2.5;
					l = d, u = d, s = 3;
				}
				M(this).attr(r, function(e) {
					return n.x1Tile(e) + o;
				}).attr(a, function(e) {
					return n.yTile(e) - s;
				}).attr("r", c).attr("width", l).attr("height", u);
			});
		} else {
			var u = a.selectAll(`.${R.legendItemTile}`).data(e);
			o(u, t).style("stroke", Im.bind(r)).call(function(e) {
				c === "circle" ? e.attr("cx", function(e) {
					var t = n.x2Tile(e);
					return t - (t - n.x1Tile(e)) / 2;
				}).attr("cy", n.yTile) : l && e.attr("x1", n.x1Tile).attr("y1", n.yTile).attr("x2", n.x2Tile).attr("y2", n.yTile);
			});
		}
	}
}, Bm = {
	redraw: function(e) {
		var t, n;
		e === void 0 && (e = {});
		var r = this, i = r.config, a = r.state, o = r.$el, s = o.main, c = o.treemap;
		a.redrawing = !0;
		var l = r.filterTargetsToShow(r.data.targets), u = e.flow, d = e.initializing, f = r.getWithOption(e), p = f.Transition ? i.transition_duration : 0, m = f.TransitionForExit ? p : 0, h = f.TransitionForAxis ? p : 0, g = r.axis?.generateTransitions(h);
		r.updateSizes(d), f.Legend && i.legend_show ? (e.withTransition = !!p, !c && r.updateLegend(r.mapToIds(r.data.targets), e, g)) : f.Dimension && r.updateDimension(!0), i.data_empty_label_text && s.select(`text.${pf.text}.${I.empty}`).attr("x", a.width / 2).attr("y", a.height / 2).text(i.data_empty_label_text).style("display", l.length ? "none" : null), a.hasAxis ? (r.axis.redrawAxis(l, f, g, u, d), r.hasGrid() && r.updateGrid(), i.regions.length && r.updateRegion(), [
			"bar",
			"candlestick",
			"line",
			"area"
		].forEach(function(e) {
			var t = wp(e);
			(/^(line|area)$/.test(e) && r.hasTypeOf(t) || r.hasType(e)) && r[`update${t}`](f.TransitionForExit);
		}), o.text && s.selectAll(`.${V.selectedCircles}`).filter(r.isBarType.bind(r)).selectAll("circle").remove(), i.interaction_enabled && !u && f.EventRect && (r.redrawEventRect(), (t = r.bindZoomEvent) == null || t.call(r))) : (o.arcs && r.redrawArc(p, m, f.Transform), o.radar && r.redrawRadar(), o.polar && r.redrawPolar(), o.funnel && r.redrawFunnel(), c && r.updateTreemap(m)), !a.resizing && !c && (r.hasPointType() || a.hasRadar) ? r.updateCircle() : r.hasLegendDefsPoint?.call(r) && r.data.targets.forEach(r.point("create", this)), r.hasDataLabel() && !r.hasArcType(null, ["radar"]) && r.updateText(), (n = r.redrawTitle) == null || n.call(r), d && r.updateTypesElements(), r.generateRedrawList(l, u, p, f.Subchart), r.updateTooltipOnRedraw(), r.callPluginHook("$redraw", e, p);
	},
	generateRedrawList: function(e, t, n, r) {
		var i = this, a = i.config, o = i.state, s = i.getDrawShape();
		o.hasAxis && a.subchart_show && i.redrawSubchart(r, n, s);
		var c = t && i.generateFlow({
			targets: e,
			flow: t,
			duration: t.duration,
			shape: s,
			xv: i.xv.bind(i)
		}), l = (n || c) && Up(), u = i.getRedrawList(s, t, c, l), d = function() {
			c && c(), o.redrawing = !1, Q(a.onrendered, i.api);
		};
		if (d) {
			if (l && u.length) {
				var f = cm();
				Os().duration(n).each(function() {
					u.reduce(function(e, t) {
						return e.concat(t);
					}, []).forEach(function(e) {
						return f.add(e);
					});
				}).call(f, d);
			} else o.transiting || d();
		}
		i.mapToIds(i.data.targets).forEach(function(e) {
			o.withoutFadeIn[e] = !0;
		});
	},
	getRedrawList: function(e, t, n, r) {
		var i = this, a = i.config, o = i.state, s = o.hasAxis, c = o.hasRadar, l = o.hasTreemap, u = i.$el.grid, d = e.pos, f = d.cx, p = d.cy, m = d.xForText, h = d.yForText, g = [];
		return s && ((a.grid_x_lines.length || a.grid_y_lines.length) && g.push(i.redrawGrid(r)), a.regions.length && g.push(i.redrawRegion(r)), Object.keys(e.type).forEach(function(t) {
			var n = wp(t), a = e.type[t];
			(/^(area|line)$/.test(t) && i.hasTypeOf(n) || i.hasType(t)) && g.push(i[`redraw${n}`](a, r));
		}), !t && u.main && g.push(i.updateGridFocus())), (!i.hasArcType() || c) && cp(a.data_labels) && a.data_labels !== !1 && g.push(i.redrawText(m, h, t, r)), (i.hasPointType() || c) && !i.isPointFocusOnly() && i.redrawCircle && g.push(i.redrawCircle(f, p, r, n)), l && g.push(i.redrawTreemap(r)), g;
	},
	updateAndRedraw: function(e) {
		e === void 0 && (e = {});
		var t = this, n = t.config, r = t.state, i;
		e.withTransition = lp(e, "withTransition", !0), e.withTransform = lp(e, "withTransform", !1), e.withLegend = lp(e, "withLegend", !1), e.withUpdateXDomain = !0, e.withUpdateOrgXDomain = !0, e.withTransitionForExit = !1, e.withTransitionForTransform = lp(e, "withTransitionForTransform", e.withTransition), e.withLegend && n.legend_show || (r.hasAxis && (i = t.axis.generateTransitions(e.withTransitionForAxis ? n.transition_duration : 0)), t.updateScales(), t.updateSvgSize(), t.transformAll(e.withTransitionForTransform, i)), t.redraw(e, i);
	}
};
function Vm(e, t, n) {
	e === void 0 && (e = "linear");
	var r = {
		linear: Kc,
		log: sl,
		_log: rl,
		time: dl,
		utc: fl
	}[e]();
	return r.type = e, /_?log/.test(e) && r.clamp(!0), r.range([t ?? 0, n ?? 1]);
}
var Hm = {
	getXScale: function(e, t, n, r) {
		var i = this, a = i.state.loading !== "append" && i.scale.zoom || Vm(i.axis.getAxisType("x"), e, t);
		return i.getCustomizedXScale(n ? a.domain(n) : a, r);
	},
	getYScale: function(e, t, n, r) {
		var i = Vm(this.axis.getAxisType(e), t, n);
		return r && i.domain(r), i;
	},
	getYScaleById: function(e, t) {
		t === void 0 && (t = !1);
		var n = this.axis?.getId(e) === "y2", r = t ? n ? "subY2" : "subY" : n ? "y2" : "y";
		return this.scale[r];
	},
	getCustomizedXScale: function(e, t) {
		var n = this, r = t || (function() {
			return n.axis.x.tickOffset();
		}), i = n.config.axis_x_inverted, a = function(t) {
			return e(t) + r();
		};
		for (var o in e) a[o] = e[o];
		return a.orgDomain = function() {
			return e.domain();
		}, a.orgScale = function() {
			return e;
		}, n.axis.isCategorized() && (a.domain = function(t) {
			var n = t;
			return arguments.length ? (e.domain(n), a) : (n = this.orgDomain(), i ? [n[0] + 1, n[1]] : [n[0], n[1] + 1]);
		}), a;
	},
	updateScales: function(e, t) {
		var n;
		t === void 0 && (t = !0);
		var r = this, i = r.axis, a = r.config, o = r.format, s = r.org, c = r.scale, l = r.state, u = l.current, d = l.width, f = l.height, p = l.width2, m = l.height2, h = l.hasAxis, g = l.hasTreemap;
		if (h) {
			var _ = a.axis_rotated, v = r.getResettedPadding(1), y = {
				x: _ ? v : 0,
				y: _ ? 0 : f,
				subX: +!!_,
				subY: _ ? 0 : m
			}, b = {
				x: _ ? f : d,
				y: _ ? d : v,
				subX: _ ? f : d,
				subY: _ ? p : 1
			}, x = t && c.x?.orgDomain(), S = t && s.xDomain;
			c.x = r.getXScale(y.x, b.x, x, function() {
				return i.x.tickOffset();
			}), c.subX = r.getXScale(y.x, b.x, S, function(e) {
				return e % 1 ? 0 : (i.subX ?? i.x).tickOffset();
			}), o.xAxisTick = i.getXAxisTickFormat(), o.subXAxisTick = i.getXAxisTickFormat(!0), i.setAxis("x", c.x, a.axis_x_tick_outer, e), a.subchart_show && i.setAxis("subX", c.subX, a.axis_x_tick_outer, e), c.y = r.getYScale("y", y.y, b.y, c.y ? c.y.domain() : a.axis_y_default), c.subY = r.getYScale("y", y.subY, b.subY, c.subY ? c.subY.domain() : a.axis_y_default), i.setAxis("y", c.y, a.axis_y_tick_outer, e), a.axis_y2_show && (c.y2 = r.getYScale("y2", y.y, b.y, c.y2 ? c.y2.domain() : a.axis_y2_default), c.subY2 = r.getYScale("y2", y.subY, b.subY, c.subY2 ? c.subY2.domain() : a.axis_y2_default), i.setAxis("y2", c.y2, a.axis_y2_tick_outer, e));
		} else if (g) {
			var C = r.getCurrentPadding();
			c.x = Kc().rangeRound([C.left, u.width - C.right]), c.y = Kc().rangeRound([C.top, u.height - C.bottom]);
		} else (n = r.updateArc) == null || n.call(r);
	},
	xx: function(e) {
		var t = this, n = t.config, r = t.scale, i = r.x, a = r.zoom, o = n.zoom_enabled && a ? a : i;
		return e ? o(G(e.x) ? e.x : e) : null;
	},
	xv: function(e) {
		var t = this, n = t.axis, r = t.config, i = t.scale, a = i.x, o = i.zoom, s = r.zoom_enabled && o ? o : a, c = t.getBaseValue(e);
		return n.isTimeSeries() ? c = Bp.call(t, c) : n.isCategorized() && q(c) && (c = r.axis_x_categories.indexOf(c)), s(c);
	},
	yv: function(e) {
		var t = this, n = t.scale, r = n.y, i = n.y2;
		return (e.axis && e.axis === "y2" ? i : r)(t.getBaseValue(e));
	},
	subxx: function(e) {
		return e ? this.scale.subX(e.x) : null;
	}
}, Um = {
	setContainerSize: function() {
		var e = this, t = e.state;
		t.current.width = e.getCurrentWidth(), t.current.height = e.getCurrentHeight();
	},
	getCurrentWidth: function() {
		var e = this;
		return e.config.size_width || e.getParentWidth();
	},
	getCurrentHeight: function() {
		var e = this, t = e.config, n = t.size_height || e.getParentHeight();
		return n > 0 ? n : 320 / (e.hasType("gauge") && !t.gauge_fullCircle ? 2 : 1);
	},
	getParentRectValue: function(e) {
		for (var t = `offset${wp(e)}`, n = this.$el.chart.node(), r = 0; r < 30 && n && n.tagName !== "BODY";) {
			try {
				r = _p(n, !0)[e];
			} catch {
				t in n && (r = n[t]);
			}
			n = n.parentNode;
		}
		var i = Df.body[t];
		return r > i && (r = i), r;
	},
	getParentWidth: function() {
		return this.getParentRectValue("width");
	},
	getParentHeight: function() {
		var e = this.$el.chart.style("height"), t = 0;
		return e && (t = /px$/.test(e) ? parseInt(e, 10) : this.getParentRectValue("height")), t;
	},
	getSvgLeft: function(e) {
		var t = this, n = t.config, r = t.state.hasAxis, i = t.$el, a = n.axis_rotated, o = a || !a && !n.axis_y_inner, s = a ? Qd.axisX : Qd.axisY, c = i.main.select(`.${s}`).node(), l = r && n[`axis_${a ? "x" : "y"}_label`], u = 0;
		if (r && (q(l) || q(l.text) || /^inner-/.test(l?.position))) {
			var d = i.main.select(`.${s}-label`);
			d.empty() || (u = _p(d.node()).left);
		}
		var f = c && o ? _p(c, !e) : { right: 0 }, p = _p(i.chart.node(), !e).left + u, m = t.hasArcType(), h = f.right - p - (m ? 0 : t.getCurrentPaddingByDirection("left", e));
		return h > 0 ? h : 0;
	},
	updateDimension: function(e) {
		var t, n = this, r = n.config, i = n.state.hasAxis, a = n.$el;
		i && !e && n.axis.x && r.axis_rotated && ((t = n.axis.subX) == null || t.create(a.axis.subX)), n.updateScales(e), n.updateSvgSize(), n.transformAll(!1);
	},
	updateSvgSize: function() {
		var e = this, t = e.config, n = e.state, r = n.clip, i = n.current, a = n.hasAxis, o = n.width, s = n.height, c = e.$el.svg;
		if (t.resize_auto === "viewBox" ? c.attr("viewBox", `0 0 ${i.width} ${i.height}`) : c.attr("width", i.width).attr("height", i.height), a) {
			var l = c.select(`.${ff.brush} .overlay`), u = {
				width: 0,
				height: 0
			};
			l.size() && (u.width = +l.attr("width"), u.height = +l.attr("height")), c.selectAll([`#${r.id}`, `#${r.idGrid}`]).select("rect").attr("width", o).attr("height", s), c.select(`#${r.idXAxis}`).select("rect").call(e.setXAxisClipPath.bind(e)), c.select(`#${r.idYAxis}`).select("rect").call(e.setYAxisClipPath.bind(e)), r.idSubchart && c.select(`#${r.idSubchart}`).select("rect").attr("width", o).attr("height", u.height);
		}
	},
	getCurrentPaddingByDirection: function(e, t, n) {
		t === void 0 && (t = !1), n === void 0 && (n = !1);
		var r = this, i = r.config, a = r.$el, o = r.state.hasAxis, s = i.axis_rotated, c = i.padding?.mode === "fit", l = J(i[`padding_${e}`]) ? i[`padding_${e}`] : void 0, u = o ? {
			top: s ? "y2" : null,
			bottom: s ? "y" : "x",
			left: s ? "x" : "y",
			right: s ? null : "y2"
		}[e] : null, d = /^(left|right)$/.test(e), f = u && i[`axis_${u}_inner`], p = u && i[`axis_${u}_show`], m = u ? i[`axis_${u}_axes`].length : 0, h = u ? d ? r.getAxisWidthByAxisId(u, t) : r.getHorizontalAxisHeight(u) : 0, g = 20, _ = 0;
		!c && d && (h = np(h));
		var v = o && d && (f || ep(l) && !p) ? 0 : c ? (p ? h : 0) + (l ?? 0) : ep(l) ? h : l;
		return d && o ? (u && (c || f) && i[`axis_${u}_label`].text && (v += r.axis.getAxisLabelPosition(u).isOuter ? g : 0), e === "right" ? (v += s ? !c && ep(l) ? 10 : 2 : !p || f ? c ? 2 : 1 : 0, v += n ? r.axis.getXAxisTickTextY2Overflow(g) : 0) : e === "left" && s && ep(l) && (v = i.axis_x_show ? c ? h : Math.max(h, 40) : 1)) : e === "top" ? (a.title && a.title.node() && (v += r.getTitlePadding()), _ = s && !f ? m : 0) : e === "bottom" && o && s && !p && (v += 1), v + h * m - _;
	},
	getCurrentPadding: function(e) {
		e === void 0 && (e = !1);
		var t = this, n = [
			"top",
			"bottom",
			"left",
			"right"
		].map(function(n) {
			return t.getCurrentPaddingByDirection(n, null, e);
		});
		return {
			top: n[0],
			bottom: n[1],
			left: n[2],
			right: n[3]
		};
	},
	getResettedPadding: function(e) {
		var t = this.config, n = J(e), r = n ? 0 : {};
		return t.padding === !1 ? !n && Object.keys(e).forEach(function(n) {
			r[n] = !sp(t.data_labels) && t.data_labels !== !1 && n === "top" ? e[n] : 0;
		}) : r = e, r;
	},
	updateSizes: function(e) {
		var t, n, r = this, i = r.config, a = r.state, o = r.$el.legend, s = i.axis_rotated, c = r.hasArcType() || a.hasFunnel || a.hasTreemap, l = i.padding?.mode === "fit";
		!e && r.setContainerSize();
		var u = {
			width: o ? r.getLegendWidth() : 0,
			height: o ? r.getLegendHeight() : 0
		};
		!c && i.axis_x_show && i.axis_x_tick_autorotate && r.updateXAxisTickClip();
		var d = {
			right: i.legend_show && a.isLegendRight ? r.getLegendWidth() + (l ? 0 : 20) : 0,
			bottom: !i.legend_show || a.isLegendRight || a.isLegendInset ? 0 : u.height
		}, f = s || c ? 0 : r.getHorizontalAxisHeight("x"), p = i.subchart_axis_x_show && i.subchart_axis_x_tick_text_show ? f : 30, m = i.subchart_show && !c ? i.subchart_size_height + p : 0, h = r.hasType("gauge") && i.arc_needle_show && !i.gauge_fullCircle && !i.gauge_label_show ? 10 : 0, g = r.getCurrentPadding(!0);
		if (a.margin = !c && s ? {
			top: g.top,
			right: c ? 0 : g.right + d.right,
			bottom: d.bottom + g.bottom,
			left: m + (c ? 0 : g.left)
		} : {
			top: (l ? 0 : 4) + g.top,
			right: c ? 0 : g.right + d.right,
			bottom: h + m + d.bottom + g.bottom,
			left: c ? 0 : g.left
		}, a.margin = r.getResettedPadding(a.margin), a.margin2 = s ? {
			top: a.margin.top,
			right: NaN,
			bottom: 20 + d.bottom,
			left: r.state.rotatedPadding.left
		} : {
			top: a.current.height - m - d.bottom,
			right: NaN,
			bottom: p + d.bottom,
			left: a.margin.left
		}, a.margin3 = {
			top: 0,
			right: NaN,
			bottom: 0,
			left: 0
		}, (t = r.updateSizeForLegend) == null || t.call(r, u), a.width = a.current.width - a.margin.left - a.margin.right, a.height = a.current.height - a.margin.top - a.margin.bottom, a.width < 0 && (a.width = 0), a.height < 0 && (a.height = 0), a.width2 = s ? a.margin.left - a.rotatedPadding.left - a.rotatedPadding.right : a.width, a.height2 = s ? a.height : a.current.height - a.margin2.top - a.margin2.bottom, a.width2 < 0 && (a.width2 = 0), a.height2 < 0 && (a.height2 = 0), r.hasArcType()) {
			var _ = r.hasType("gauge"), v = i.legend_show && a.isLegendRight, y = (a.hasRadar && r.cache.get($p.radarTextWidth)) ?? 0;
			a.arcWidth = a.width - (v ? u.width + 10 : 0) - y, a.arcHeight = a.height - (v && !_ ? 0 : 10), i.arc_rangeText_values?.length && (_ ? (a.arcWidth -= 25, a.arcHeight -= 10, a.margin.left += 10) : (a.arcHeight -= 20, a.margin.top += 10)), _ && !i.gauge_fullCircle && (a.arcHeight += a.height - r.getPaddingBottomForGauge()), (n = r.updateRadius) == null || n.call(r);
		}
		a.isLegendRight && c && (a.margin3.left = a.arcWidth / 2 + a.radiusExpanded * 1.1);
	}
}, Wm = {
	setCssRule: function(e, t, n, r) {
		var i = this, a = i.config, o = i.state, s = o.cssRule, c = o.style;
		return a.boost_useCssRule ? function(a) {
			a.each(function(a) {
				var o = r && r?.call(i, a), l = `${e ? `.${H.shapes + i.getTargetSelectorSuffix(a.id)}` : ""}${t}`;
				t in s && c.sheet.deleteRule(s[l]), i.state.cssRule[l] = Dp(c, l, n.filter(Boolean).map(function(e) {
					return q(o) && e.indexOf(":") === -1 ? `${e}: ${o}` : e || "";
				}));
			});
		} : function() {};
	},
	getStylePropValue: function(e) {
		return this.config.boost_useCssRule ? null : K(e) ? e.bind(this) : e;
	}
};
function Gm(e) {
	var t = "middle";
	return e > 0 && e <= 170 ? t = "end" : e > 190 && e <= 360 && (t = "start"), t;
}
function Km(e, t, n, r, i) {
	var a = this, o = e.value, s = a.isCandlestickType(e), c = J(o) && o < 0 || s && !a.getCandlestickData(e)?._isUp, l = t.x, u = t.y, d = 4, f = d * 2;
	return r ? n === "start" ? (l += c ? 0 : f, u += d) : n === "middle" ? (l += f, u -= f) : n === "end" && (c && (l -= f), u += d) : (n === "start" ? (l += d, c && (u += f * 2)) : n === "middle" ? u -= f : n === "end" && (l -= d, c && (u += f * 2)), i && (u += c ? -17 : s ? 13 : 7)), {
		x: l,
		y: u
	};
}
function qm(e, t) {
	var n = this.config.data_labels_position, r = e.id, i = e.index, a = e.value;
	return (K(n) ? n.bind(this.api)(t, a, r, i, this.$el.text) : (r in n ? n[r] : n)[t]) ?? 0;
}
function Jm(e, t, n) {
	var r = this, i = r.config, a = r.$T, o = i.axis_rotated, s = i.data_labels.border, c = s.padding, l = c === void 0 ? "3 5" : c, u = s.radius, d = u === void 0 ? 10 : u, f = s.stroke, p = f === void 0 ? "#000" : f, m = s.strokeWidth, h = m === void 0 ? 1 : m, g = s.fill, _ = g === void 0 ? "none" : g, v = Kp(l), y = i.data_labels.border !== !0, b = vp(e), x = M(e.previousElementSibling);
	(x.empty() || x.node()?.tagName !== "rect" || !x.attr("class")?.includes(n)) && (x = M(e.parentNode).insert("rect", function() {
		return e;
	}).attr("class", `${pf.textBorderRect} ${n}`).attr("width", b.width + (y ? v.left + v.right : 0)).attr("height", b.height + (y ? v.top + v.bottom : 0)), y && x.style("fill", _).style("stroke", p).style("stroke-width", `${h}px`).attr("rx", d).attr("ry", d)), a(x).attr("x", t.x - (y ? v.left : 0) - (o ? 0 : b.width / 2)).attr("y", t.y - (y ? v.top : 0) - b.height / 4 * 3.2);
}
function Ym(e, t) {
	e === void 0 && (e = 0);
	var n = this.config[`${t}_label_threshold`] || 0;
	return e >= n;
}
function Xm() {
	var e = this, t = e.$el.text, n = e.config;
	(e.state.arcWidth ? e.getArcLabelConfig("image") : n.data_labels.image) && t.filter(function() {
		var e = this.previousElementSibling;
		return !e || e.tagName !== "image" || !e.classList.contains(pf.textLabelImage);
	}).each(function(t) {
		var n = Zm.call(e, t), r = n.url, i = n.width, a = n.height, o = n.pos;
		r && M(this.parentNode)?.insert("image", `${this.getAttribute("class")?.replace(/(?:^(.)|\s)/g, ".$1") ?? "text"}`).style("opacity", "0").attr("href", function(e) {
			return zp(r, { ID: "id" in e ? e.id : e.data.id });
		}).attr("class", pf.textLabelImage).style("pointer-events", "none").attr("width", i).attr("height", a).attr("transform", o ? `translate(${o.x ?? 0} ${o.y ?? 0})` : null);
	});
}
function Zm(e) {
	var t = this, n = t.config, r = t.state.arcWidth ? t.getArcLabelConfig("image") : n.data_labels.image;
	if (K(r)) return r.call(t.api, e.value, e.id, e.index) ?? {
		url: "",
		width: 0,
		height: 0,
		pos: {
			x: 0,
			y: 0
		}
	};
	if (r) {
		var i = r.url, a = i === void 0 ? "" : i, o = r.width, s = o === void 0 ? 0 : o, c = r.height;
		return {
			url: a,
			width: s,
			height: c === void 0 ? 0 : c,
			pos: r.pos
		};
	}
	return null;
}
function Qm(e, t) {
	var n = this, r = this, i = r.config, a = r.state, o = a.arcWidth, s = a.hasTreemap, c = i.axis_rotated, l = M(e.previousElementSibling), u = function(e) {
		var t = e.style.opacity !== "0" && e.style.fillOpacity !== "0";
		return (o ? e.textContent : t) && n.previousElementSibling?.tagName !== "image";
	};
	if (!l.empty() && l.node()?.tagName === "image") {
		var d = _p(e), f = l.attr("width") / 2, p = l.attr("height") / 2, m = t.x - f, h = t.y - p - d.height / 2;
		c ? t.x += f : (s && (m = -f, h = -(p * 2 + d.height)), r.hasType("pie") || r.hasType("polar") || (t.y += p)), r.$T(l).style("opacity", u(e) ? null : "0").attr("x", m).attr("y", h);
	}
}
function $m(e) {
	return Yp(e, function(e) {
		return e;
	}, function(e) {
		return vp(e);
	});
}
var eh = {
	opacityForText: function(e) {
		var t = this;
		return t.isBarType(e) && !Ym.call(t, Math.abs(t.getRatio("bar", e)), "bar") ? "0" : t.hasDataLabel ? null : "0";
	},
	initText: function() {
		var e = this.$el;
		e.main.select(`.${I.chart}`).append("g").attr("class", pf.chartTexts).style("pointer-events", e.funnel || e.treemap ? "none" : null);
	},
	updateTargetsForText: function(e) {
		var t = this, n = t.getChartClass("Text"), r = t.getClass("texts", "id"), i = t.classFocus.bind(t);
		t.$el.main.select(`.${pf.chartTexts}`).selectAll(`.${pf.chartText}`).data(t.filterNullish(e)).attr("class", function(e) {
			return `${n(e)}${i(e)}`.trim();
		}).enter().append("g").style("opacity", "0").attr("class", n).call(t.setCssRule(!0, ` .${pf.text}`, ["fill", "pointer-events:none"], t.updateTextColor)).append("g").attr("class", r);
	},
	updateText: function() {
		var e = this, t = e.$el, n = e.$T, r = e.config, i = e.axis, a = e.getClass("text", "index"), o = r.data_labels.centered, s = t.main.selectAll(`.${pf.texts}`).selectAll(`.${pf.text}`).data(e.labelishData.bind(e));
		n(s.exit()).style("fill-opacity", "0").remove(), t.text = s.enter().append("text").merge(s).attr("class", a).attr("text-anchor", function(t) {
			var n = r[`axis_${i?.getId(t.id)}_inverted`] ? t.value > 0 : t.value < 0;
			if (e.isCandlestickType(t)) n = !e.getCandlestickData(t)?._isUp;
			else if (e.isTreemapType(t)) return o ? "middle" : "start";
			return r.axis_rotated ? n ? "end" : "start" : "middle";
		}).style("fill", e.getStylePropValue(e.updateTextColor)).style("fill-opacity", "0").each(function(t, n, r) {
			var i = M(this), a = t.value;
			if (e.isBubbleZType(t)) a = e.getBubbleZData(a, "z");
			else if (e.isCandlestickType(t)) {
				var o = e.getCandlestickData(t);
				o && (a = o.close);
			}
			a = e.isTreemapType(t) ? e.treemapDataLabelFormat(t)(i) : e.dataLabelFormat(t.id)(a, t.id, t.index, r), J(a) ? this.textContent = a : fp(i, a, void 0, !0);
		}), Xm.call(e);
	},
	updateTextColor: function(e) {
		var t = this, n = t.config, r = n.data_labels_colors, i = t.isArcType(e) && !t.isRadarType(e) || t.isFunnelType(e) || t.isTreemapType(e) ? null : t.color(e), a;
		if (q(r) ? a = r : Z(r) ? a = r[(e.data || e).id] : K(r) && (a = r.bind(t.api)(i, e)), t.isCandlestickType(e) && !K(r) && !t.getCandlestickData(e)?._isUp) {
			var o = n.candlestick_color_down;
			a = Z(o) ? o[e.id] : o;
		}
		return a || i;
	},
	updateTextBGColor: function(e, t) {
		var n = this, r = n.$el.defs, i = "";
		if (t) {
			var a = q(t) ? "" : n.getTargetSelectorSuffix("id" in e ? e.id : e.data.id), o = r.select(["filter[id*='labels-bg", "']"].join(a));
			if (o.size() && (i = `url(#${o.attr("id")})`), K(t)) {
				n.generateTextBGColorFilter(t);
				var s = n.color(e), c = t.bind(n.api)(s, e);
				c ? o.select("feFlood").attr("flood-color", c) : i = "";
			}
		}
		return i || null;
	},
	redrawText: function(e, t, n, r) {
		var i = this, a = i.$T, o = i.axis, s = i.config, c = i.state.hasTreemap, l = yp(!0), u = s.axis_rotated, d = s.data_labels.rotate, f = Gm(d), p = d ? `rotate(${d})` : "", m = /* @__PURE__ */ new Map();
		if (s.data_labels.centered) {
			var h = [];
			i.$el.text.each(function(e) {
				(i.isBarType(e) || i.isTreemapType(e)) && h.push(this);
			}), h.length > 0 && (m = $m(h));
		}
		return i.$el.text.style("fill", i.getStylePropValue(i.updateTextColor)).attr("filter", function(e) {
			return i.updateTextBGColor.bind(i)(e, s.data_labels_backgroundColors);
		}).style("fill-opacity", n ? 0 : i.opacityForText.bind(i)).each(function(n, h) {
			var g = m.get(this), _ = a(c && this.childElementCount ? this.parentNode : this, !!(r && (this.getAttribute("x") || this.getAttribute("transform"))), l), v = s[`axis_${o?.getId(n.id)}_inverted`], y = {
				x: e.bind(this)(n, h, g),
				y: t.bind(this)(n, h, g)
			};
			d && (y = Km.bind(i)(n, y, f, u, v), _.attr("text-anchor", f)), Qm.call(i, this, y), this.childElementCount || d ? _.attr("transform", `translate(${y.x} ${y.y}) ${p}`) : _.attr("x", y.x).attr("y", y.y), s.data_labels.border && Jm.call(i, _.node(), y, `${pf.textBorderRect}-${h}`);
		}), !0;
	},
	getTextRect: function(e, t) {
		var n, r = this, i, a, o;
		Array.isArray(e) ? i = `${$p.textRect}-${e.join("_")}` : (a = (n = e).node?.call(n) ?? e, /text/i.test(a.tagName) || (a = a.querySelector("text")), o = a.textContent, i = `${$p.textRect}-${o.replace(/\W/g, "_")}`);
		var s = r.cache.get(i) || [];
		return s.length === 0 && ((r.$el.svg || r.$el.chart.select("svg")).selectAll(`.${I.dummy}`).data(o ? [o] : e).enter().append("text").style("visibility", "hidden").style("font", a ? M(a).style("font") : null).classed(t || I.dummy, !0).text(function(e) {
			return e;
		}).each(function(e, t) {
			s[t] = _p(this);
		}).remove(), r.cache.add(i, s)), s.length > 1 ? s : s[0];
	},
	generateXYForText: function(e, t) {
		var n = this, r = n.state, i = r.hasRadar, a = r.hasFunnel, o = r.hasTreemap, s = Object.keys(e), c = {}, l = t ? n.getXForText : n.getYForText;
		return a && s.push("funnel"), i && s.push("radar"), o && s.push("treemap"), s.forEach(function(t) {
			c[t] = n[`generateGet${wp(t)}Points`](e[t], !1);
		}), function(e, t) {
			var r = n.isAreaType(e) && "area" || n.isBarType(e) && "bar" || n.isCandlestickType(e) && "candlestick" || n.isFunnelType(e) && "funnel" || n.isRadarType(e) && "radar" || n.isTreemapType(e) && "treemap" || "line";
			return l.call(n, c[r](e, t), e, this);
		};
	},
	getCenteredTextPos: function(e, t, n, r, i) {
		var a = this, o = a.config, s = o.axis_rotated, c = a.isBarType(e), l = a.isTreemapType(e);
		if (o.data_labels.centered && (c || l)) {
			var u = i || vp(n);
			if (c) {
				var d = a.getRangedData(e, null, "bar") >= 0;
				if (s) {
					var f = (d ? t[1][1] - t[0][1] : t[0][1] - t[1][1]) / 2 + u.width / 2;
					return d ? -f - 3 : f + 2;
				}
				var p = (d ? t[0][1] - t[1][1] : t[1][1] - t[0][1]) / 2 + u.height / 2;
				return d ? p : -p - 2;
			}
			if (l) return r === "x" ? (t[1][0] - t[0][0]) / 2 : (t[1][1] - t[0][1]) / 2 - u.y - u.height / 2;
		}
		return 0;
	},
	getXForText: function(e, t, n, r) {
		var i = this, a = i.config, o = a.axis_rotated, s = i.isFunnelType(t), c = i.isTreemapType(t), l = e ? e[0][0] : 0;
		if (i.isCandlestickType(t)) o ? l = i.getCandlestickData(t)?._isUp ? e[2][2] + 4 : e[2][1] - 4 : l += (e[1][0] - l) / 2;
		else if (s) l += i.state.current.width / 2;
		else if (c) l += a.data_labels.centered ? 0 : 5;
		else if (o) {
			var u = a[`axis_${i.axis.getId(t.id)}_inverted`], d = i.isBarType(t) ? 4 : 6, f = t.value;
			l = e[2][1], u ? l -= d * (f > 0 ? 1 : -1) : l += d * (f < 0 ? -1 : 1);
		} else l = i.hasType("bar") ? (e[2][0] + e[0][0]) / 2 : l;
		return (o || c) && (l += i.getCenteredTextPos(t, e, n, "x", r)), l + qm.call(this, t, "x");
	},
	getYForText: function(e, t, n, r) {
		var i = this, a = i.axis, o = i.config, s = i.state, c = o.axis_rotated, l = o[`axis_${a?.getId(t.id)}_inverted`], u = i.isBarType(t), d = i.isFunnelType(t), f = i.isTreemapType(t), p = o.point_r, m = _p(n), h = t.value, g = 3, _;
		if (i.isCandlestickType(t)) h = i.getCandlestickData(t), c ? (_ = e[0][0], _ += (e[1][0] - _) / 2 + g) : (_ = h && h._isUp ? e[2][2] - g : e[2][1] + g * 4, l && (_ += 15 * (h._isUp ? 1 : -1)));
		else if (d) _ = e ? e[0][1] + (e[1][1] - e[0][1]) / 2 + m.height / 2 - 3 : 0;
		else if (f) _ = e[0][1] + (o.data_labels.centered ? 0 : m.height + 5);
		else if (c) _ = (e[0][0] + e[2][0] + m.height * .6) / 2;
		else if (_ = e[2][1], J(p) && p > 5 && (i.isLineType(t) || i.isScatterType(t)) && (g += o.point_r / 2.3), h < 0 || h === 0 && !s.hasPositiveValue && s.hasNegativeValue) _ += l ? u ? -3 : -5 : m.height + (u ? -g : g);
		else {
			var v = -g * 2;
			u ? v = -g : i.isBubbleType(t) && (v = g), l && (v = u ? 10 : 15), _ += v;
		}
		return (!c || f) && (_ += i.getCenteredTextPos(t, e, n, "y", r)), _ + qm.call(this, t, "y");
	},
	markOverlapped: function(e, t, n) {
		var r = t.$el.arcs.selectAll(n), i = r.filter(function(t) {
			return t.data.id !== e;
		}), a = r.filter(function(t) {
			return t.data.id === e;
		}), o = jp(a.node()), s = function(e, t) {
			return Math.sqrt(e ** 2 + t ** 2);
		};
		a.node() && i.each(function() {
			var e = jp(this), t = M(this), n = s(o.e, o.f) > s(e.e, e.f) ? a : t, r = Math.ceil(Math.abs(o.e - e.e)) < Math.ceil(n.node().getComputedTextLength()), i = Math.ceil(Math.abs(o.f - e.f)) < parseInt(a.style("font-size"), 10);
			t.classed(pf.TextOverlapping, r && i);
		});
	},
	undoMarkOverlapped: function(e, t) {
		e.$el.arcs.selectAll(t).each(function() {
			Ot([this, this.previousSibling]).classed(pf.TextOverlapping, !1);
		});
	}
};
function th(e, t) {
	e === void 0 && (e = "left");
	var n = J(t);
	return e.indexOf("center") > -1 ? n ? t / 2 : "middle" : e.indexOf("right") > -1 ? n ? t : "end" : n ? 0 : "start";
}
var nh = {
	initTitle: function() {
		var e = this, t = e.config, n = e.$el;
		t.title_text && (n.title = n.svg.append("g"), fp(n.title.append("text").style("text-anchor", th(t.title_position)).attr("class", pf.title), t.title_text, [.3, 1.5]));
	},
	redrawTitle: function() {
		var e = this, t = e.config, n = e.state.current, r = e.$el.title;
		if (r) {
			var i = th(t.title_position, n.width), a = (t.title_padding.top || 0) + e.getTextRect(e.$el.title, pf.title).height;
			r.attr("transform", `translate(${i}, ${a})`);
		}
	},
	getTitlePadding: function() {
		var e = this, t = e.$el.title, n = e.config;
		return (n.title_padding.top || 0) + (t ? e.getTextRect(t, pf.title).height : 0) + (n.title_padding.bottom || 0);
	}
}, rh = {
	initTooltip: function() {
		var e = this, t = e.config, n = e.$el;
		n.tooltip = M(t.tooltip_contents.bindto), n.tooltip.empty() && (n.tooltip = n.chart.append("div").attr("class", mf.tooltipContainer).style("position", "absolute").style("pointer-events", "none").style("display", "none")), e.bindTooltipResizePos();
	},
	initShowTooltip: function() {
		var e, t = this, n = t.config, r = t.$el, i = t.state, a = i.hasAxis, o = i.hasRadar;
		if (n.tooltip_init_show) {
			var s = !(a || o);
			t.axis?.isTimeSeries() && q(n.tooltip_init_x) && (n.tooltip_init_x = Bp.call(t, n.tooltip_init_x)), t.api.tooltip.show({ data: (e = {}, e[s ? "index" : "x"] = n.tooltip_init_x, e) });
			var c = n.tooltip_init_position;
			if (!n.tooltip_contents.bindto && !sp(c)) {
				var l = c.top, u = l === void 0 ? 0 : l, d = c.left, f = d === void 0 ? 50 : d;
				r.tooltip.style("top", q(u) ? u : `${u}px`).style("left", q(f) ? f : `${f}px`).style("display", null);
			}
		}
	},
	getTooltipHTML: function() {
		var e = [...arguments], t = this, n = t.api, r = t.config;
		return Zf(K(r.tooltip_contents) ? r.tooltip_contents.bind(n).apply(void 0, e) : t.getTooltipContent.apply(t, e));
	},
	getTooltipContent: function(e, t, n, r) {
		var i = this, a = i.api, o = i.config, s = i.state, c = i.$el, l = [
			"title",
			"name",
			"value"
		].map(function(e) {
			var t = o[`tooltip_format_${e}`];
			return K(t) ? t.bind(a) : t;
		}), u = l[0], d = l[1], f = l[2], p = function() {
			var e = [...arguments];
			return (u || t).apply(void 0, e);
		}, m = function() {
			var e = [...arguments];
			return (d || (function(e) {
				return e;
			})).apply(void 0, e);
		}, h = function(e, t, r, a) {
			var o = f;
			return o ||= s.hasTreemap || i.isStackNormalized() && (!i.isStackNormalizedPerGroup() || i.isGrouped(r)) ? function(e, t) {
				return `${(t * 100).toFixed(2)}%`;
			} : n, o(e, t, r, a);
		}, g = o.tooltip_order, _ = function(e) {
			return i.axis && i.isBubbleZType(e) ? i.getBubbleZData(e.value, "z") : i.getBaseValue(e);
		}, v = i.levelColor ? function(e) {
			return i.levelColor(e.value);
		} : function(e) {
			return r(e);
		}, y = o.tooltip_contents, b = y.template, x = i.mapToTargetIds();
		if (g === null && o.data_groups.length) {
			var S = i.orderTargets(i.data.targets).map(function(e) {
				return e.id;
			}).reverse();
			e.sort(function(e, t) {
				var n = e ? e.value : null, r = t ? t.value : null;
				return n > 0 && r > 0 && (n = e.id ? S.indexOf(e.id) : null, r = t.id ? S.indexOf(t.id) : null), n - r;
			});
		} else if (/^(asc|desc)$/.test(g)) {
			var C = g === "asc";
			e.sort(function(e, t) {
				var n = e ? _(e) : null, r = t ? _(t) : null;
				return C ? n - r : r - n;
			});
		} else K(g) && e.sort(g.bind(a));
		var w = i.getTooltipContentTemplate(b), T = e.length, E, D, O, k, ee, A = function() {
			if (D = e[ee], !D || !(_(D) || _(D) === 0)) return "continue";
			if (ep(E)) {
				var t = (s.hasAxis || s.hasRadar) && p(D.x);
				E = zp(w[0], {
					CLASS_TOOLTIP: mf.tooltip,
					TITLE: G(t) ? b ? t : `<tr><th colspan="2">${t}</th></tr>` : ""
				});
			}
			if (!D.ratio && c.arcs && (O = ["arc", i.$el.arcs.select(`path.${L.arc}-${D.id}`).data()[0]], D.ratio = i.getRatio.apply(i, O)), O = [
				D.ratio,
				D.id,
				D.index
			], i.isAreaRangeType(D)) {
				var n = ["high", "low"].map(function(e) {
					return h.apply(void 0, Xd([i.getRangedData(D, e)], O, !1));
				}), r = n[0], a = n[1];
				k = `<b>Mid:</b> ${h.apply(void 0, Xd([_(D)], O, !1))} <b>High:</b> ${r} <b>Low:</b> ${a}`;
			} else if (i.isCandlestickType(D)) {
				var o = [
					"open",
					"high",
					"low",
					"close",
					"volume"
				].map(function(e) {
					return i.getRangedData(D, e, "candlestick") ? h.apply(void 0, Xd([i.getRangedData(D, e, "candlestick")], O, !1)) : void 0;
				}), l = o[0], r = o[1], a = o[2], u = o[3], d = o[4];
				k = `<b>Open:</b> ${l} <b>High:</b> ${r} <b>Low:</b> ${a} <b>Close:</b> ${u}${d ? ` <b>Volume:</b> ${d}` : ""}`;
			} else if (i.isBarRangeType(D)) {
				var f = D.value, g = D.id, S = D.index;
				k = `${h(f, void 0, g, S)}`;
			} else k = h.apply(void 0, Xd([_(D)], O, !1));
			if (k !== void 0) {
				if (D.name === null) return "continue";
				var C = m.apply(void 0, Xd([D.name ?? D.id], O, !1)), T = v(D), A = {
					CLASS_TOOLTIP_NAME: mf.tooltipName + i.getTargetSelectorSuffix(D.id),
					COLOR: b || !i.patterns ? T : `<svg><rect style="fill:${T}" width="10" height="10"></rect></svg>`,
					NAME: C,
					VALUE: k
				};
				if (b && Z(y.text)) {
					var te = x.indexOf(D.id);
					Object.keys(y.text).forEach(function(e) {
						A[e] = y.text[e][te];
					});
				}
				E += zp(w[1], A);
			}
		};
		for (ee = 0; ee < T; ee++) A();
		return `${E}</table>`;
	},
	getTooltipContentTemplate: function(e) {
		return (e || `<table class="{=CLASS_TOOLTIP}"><tbody>
				{=TITLE}
				{{<tr class="{=CLASS_TOOLTIP_NAME}">
					<td class="name">${this.patterns ? "{=COLOR}" : "<span style=\"background-color:{=COLOR}\"></span>"}{=NAME}</td>
					<td class="value">{=VALUE}</td>
				</tr>}}
			</tbody></table>`).replace(/(\r?\n|\t)/g, "").split(/{{(.*)}}/);
	},
	setTooltipPosition: function(e, t) {
		var n = this, r = n.config, i = n.scale, a = n.state, o = n.$el, s = o.eventRect, c = o.tooltip, l = o.svg, u = r.tooltip_contents.bindto, d = r.axis_rotated, f = c?.datum();
		if (!u && f) {
			var p = e ?? JSON.parse(f.current), m = hp(a.event, t ?? s?.node()), h = {
				x: m[0],
				y: m[1]
			};
			if (a.hasAxis && i.x && f && "x" in f) {
				var g = function(e, t, r) {
					e === void 0 && (e = 0), r === void 0 && (r = "y");
					var o = i[t ? n.axis?.getId(t) : r];
					return o ? o(e) + (d ? a.margin.left : a.margin.top) : 0;
				};
				h.xAxis = i.x(f.x) + (r.tooltip_position ? d ? a.margin.top : a.margin.left : 0), h.yAxis = p.length === 1 ? g(p[0].value, p[0].id) : g;
			}
			var _ = f.width, v = _ === void 0 ? 0 : _, y = f.height, b = y === void 0 ? 0 : y, x = r.tooltip_position?.bind(n.api)(p, v, b, s?.node(), h) ?? (Vp(l) ? n.getTooltipPositionViewBox.bind(n)(v, b, h) : n.getTooltipPosition.bind(n)(v, b, h));
			["top", "left"].forEach(function(e) {
				var t = x[e];
				c.style(e, `${t}px`), e === "left" && !f.xPosInPercent && (f.xPosInPercent = t / a.current.width * 100);
			});
		}
	},
	getTooltipPositionViewBox: function(e, t, n) {
		var r = this, i = r.$el, a = i.eventRect, o = i.svg, s = r.config, c = r.state, l = s.axis_rotated, u = r.hasArcType() || c.hasFunnel || c.hasTreemap, d = (u ? o : a)?.node() ?? c.event.target, f = n.x, p = n.y;
		c.hasAxis && (f = l ? f : n.xAxis, p = l ? n.xAxis : p);
		var m = Ap(d, f, p, !1), h = _p(d), g = Ap(d, 20, 0, !1).x, _ = m.y, v = m.x + e / 2 + g;
		return u && (c.hasFunnel || c.hasTreemap || c.hasRadar ? (v -= e / 2 + g, _ += t) : (_ += h.height / 2, v += h.width / 2 - (e - g))), v + e > h.width && (v = h.width - e - g), _ + t > h.height && (_ -= t * 2), {
			top: _,
			left: v
		};
	},
	getTooltipPosition: function(e, t, n) {
		var r = this, i = r.config, a = r.scale, o = r.state, s = o.width, c = o.height, l = o.current, u = o.hasFunnel, d = o.hasRadar, f = o.hasTreemap, p = o.isLegendRight, m = o.inputType, h = r.hasType("gauge") && !i.gauge_fullCircle, g = i.axis_rotated, _ = r.hasArcType(), v = r.getSvgLeft(!0), y = v + l.width - r.getCurrentPaddingByDirection("right"), b = 20, x = n.x, S = n.y;
		if (d) x += x >= s / 2 ? 15 : -(e + 15), S += 15;
		else if (_) {
			if (m !== "touch") {
				var C = r.getTitlePadding?.call(r) ?? 0;
				C && h && i.arc_rangeText_values?.length && (C += 10), x += (s - (p ? r.getLegendWidth() : 0)) / 2, S += (h ? c : c / 2 + t) + C;
			}
		} else if (u || f) S += t;
		else {
			var w = {
				top: r.getCurrentPaddingByDirection("top", !0),
				left: r.getCurrentPaddingByDirection("left", !0)
			};
			g ? (x += v + w.left + b, S = w.top + n.xAxis + b, y -= v) : (x = v + w.left + b + (a.zoom ? x : n.xAxis), S += w.top - 5);
		}
		if (x + e + 15 > y && (x -= e + (u || f || _ ? 0 : g ? b * 2 : 38)), S + t > l.height) {
			var T = f ? t + 10 : 30;
			S -= h ? t * 1.5 : t + T;
		}
		var E = {
			top: S,
			left: x
		};
		return Object.keys(E).forEach(function(e) {
			E[e] < 0 && (E[e] = 0);
		}), E;
	},
	showTooltip: function(e, t) {
		var n = this, r = n.config, i = n.$el.tooltip, a = e.filter(function(e) {
			return e && G(n.getBaseValue(e));
		});
		if (i && a.length !== 0 && r.tooltip_show) {
			var o = i.datum(), s = JSON.stringify(e);
			if (!o || o.current !== s) {
				var c = e.concat().sort()[0], l = c.index, u = c.x;
				Q(r.tooltip_onshow, n.api, e), i.html(n.getTooltipHTML(e, n.axis ? n.axis.getXAxisTickFormat() : n.categoryName.bind(n), n.getDefaultValueFormat(), n.color)).style("display", null).style("visibility", null).datum(o = {
					index: l,
					x: u,
					current: s,
					width: i.property("offsetWidth"),
					height: i.property("offsetHeight")
				}), Q(r.tooltip_onshown, n.api, e), n._handleLinkedCharts(!0, l);
			}
			n.setTooltipPosition(a, t);
		}
	},
	bindTooltipResizePos: function() {
		var e = this, t = e.resizeFunction, n = e.state, r = e.$el.tooltip;
		t.add(function() {
			if (r.style("display") === "block") {
				var e = n.current, t = r.datum(), i = t.width, a = t.xPosInPercent, o = e.width / 100 * a, s = e.width - (o + i);
				s < 0 && (o += s), r.style("left", `${o}px`);
			}
		});
	},
	hideTooltip: function(e) {
		var t = this, n = t.api, r = t.config, i = t.$el.tooltip;
		if (i && i.style("display") !== "none" && (!r.tooltip_doNotHide || e)) {
			var a = JSON.parse(i.datum().current ?? {});
			Q(r.tooltip_onhide, n, a), i.style("display", "none").datum(null), Q(r.tooltip_onhidden, n, a);
		}
	},
	_handleLinkedCharts: function(e, t) {
		var n = this, r = n.charts, i = n.config;
		if (n.state.event?.isTrusted && i.tooltip_linked && r.length > 1) {
			var a = i.tooltip_linked_name;
			r.filter(function(e) {
				return e !== n.api;
			}).forEach(function(n) {
				var r = n.internal, i = r.config, o = r.$el, s = i.tooltip_linked, c = i.tooltip_linked_name, l = Df.body.contains(o.chart.node());
				if (s && a === c && l) {
					var u = t !== o.tooltip.data()[0]?.index;
					try {
						n.tooltip[e && u ? "show" : "hide"]({ index: t });
					} catch {}
				}
			});
		}
	},
	updateTooltipOnRedraw: function(e, t) {
		var n = this, r = n.config, i = n.$el, a = i.eventRect, o = i.svg, s = i.tooltip, c = n.state, l = c.event, u = c.hasAxis, d = c.hasRadar, f = c.hasTreemap;
		if (s?.style("display") === "block" && l) {
			var p = e ?? (d ? o : a)?.node();
			if (u || d) {
				if (n.isMultipleX()) n.selectRectForMultipleXs(p, !1);
				else {
					var m = t ?? n.getDataIndexFromEvent(l);
					t === -1 ? n.api.tooltip.hide() : (n.selectRectForSingle(p, m), n.setExpand(m, null, !0));
				}
			} else {
				var h = l.clientX, g = l.clientY;
				setTimeout(function() {
					var e = [h, g].every(Number.isFinite) && Df.elementFromPoint(h, g), t = e && M(e).datum();
					if (t) {
						var r = n.hasArcType() ? n.convertToArcData(n.updateAngle(t)) : t?.data;
						f && (e = o.node()), r && n.showTooltip([r], e);
					} else n.api.tooltip.hide();
				}, r.transition_duration);
			}
		}
	}
}, ih = {
	getTranslate: function(e, t) {
		t === void 0 && (t = 0);
		var n = this, r = n.config, i = n.state, a = r.axis_rotated, o = 0, s, c;
		if (t && /^(x|y2?)$/.test(e) && (o = n.getAxisSize(e) * t), e === "main") s = rp(i.margin.left), c = rp(i.margin.top);
		else if (e === "context") s = rp(i.margin2.left), c = rp(i.margin2.top);
		else if (e === "legend") s = i.margin3.left, c = i.margin3.top;
		else if (e === "x") s = a ? -o : 0, c = a ? 0 : i.height + o;
		else if (e === "y") s = a ? 0 : -o, c = a ? i.height + o : 0;
		else if (e === "y2") s = a ? 0 : i.width + o, c = a ? -o - 1 : 0;
		else if (e === "subX") s = 0, c = a ? 0 : i.height2;
		else if (e === "arc") s = i.arcWidth / 2, c = i.arcHeight / 2, r.arc_rangeText_values?.length && (c += 5 + (n.hasType("gauge") && r.title_text ? 10 : 0));
		else if (e === "polar") s = i.arcWidth / 2, c = i.arcHeight / 2;
		else if (e === "radar") {
			var l = n.getRadarSize(), u = l[0], d = l[1];
			s = i.width / 2 - u, c = i.height / 2 - d;
		}
		return `translate(${s}, ${c})`;
	},
	transformMain: function(e, t) {
		var n = this, r = n.$el.main, i = n.$T, a = t?.axisX ? t.axisX : i(r.select(`.${Qd.axisX}`), e), o = t?.axisY ? t.axisY : i(r.select(`.${Qd.axisY}`), e), s = t?.axisY2 ? t.axisY2 : i(r.select(`.${Qd.axisY2}`), e);
		i(r, e).attr("transform", n.getTranslate("main")), a.attr("transform", n.getTranslate("x")), o.attr("transform", n.getTranslate("y")), s.attr("transform", n.getTranslate("y2")), r.select(`.${L.chartArcs}`).attr("transform", n.getTranslate("arc"));
	},
	transformAll: function(e, t) {
		var n = this, r = n.config, i = n.state, a = i.hasAxis, o = i.hasFunnel, s = i.hasTreemap, c = n.$el;
		!o && !s && n.transformMain(e, t), a && r.subchart_show && n.transformContext(e, t), c.legend && n.transformLegend(e);
	}
}, ah = {
	isValidChartType: function(e) {
		return !!(e && Object.values($).indexOf(e) > -1);
	},
	setTargetType: function(e, t) {
		var n = this, r = n.config, i = n.state.withoutFadeIn;
		n.mapToTargetIds(e).forEach(function(e) {
			i[e] = t === r.data_types[e], r.data_types[e] = t;
		}), e || (r.data_type = t);
	},
	updateTypesElements: function() {
		var e = this, t = e.state.current;
		Object.keys($).forEach(function(n) {
			var r = $[n], i = e.hasType(r, null, !0), a = t.types.indexOf(r);
			a === -1 && i ? t.types.push(r) : a > -1 && !i && t.types.splice(a, 1);
		}), e.setChartElements();
	},
	hasType: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = r.config, a = r.state.current, o = i.data_types, s = t || r.data.targets, c = !1;
		return !n && a.types?.indexOf(e) > -1 ? c = !0 : s?.length ? s.forEach(function(t) {
			var n = o[t.id];
			(n === e || !n && e === "line") && (c = !0);
		}) : Object.keys(o).length ? Object.keys(o).forEach(function(t) {
			o[t] === e && (c = !0);
		}) : c = i.data_type === e, c;
	},
	hasTypeOf: function(e, t, n) {
		var r = this;
		return n === void 0 && (n = []), e in nm && !nm[e].filter(function(e) {
			return n.indexOf(e) === -1;
		}).every(function(e) {
			return !r.hasType(e, t);
		});
	},
	isTypeOf: function(e, t) {
		var n = q(e) ? e : e.id, r = this.config && (this.config.data_types?.[n] || this.config.data_type);
		return X(t) ? t.indexOf(r) >= 0 : r === t;
	},
	hasPointType: function() {
		var e = this;
		return e.hasTypeOf("Line") || e.hasType("bubble") || e.hasType("scatter");
	},
	hasArcType: function(e, t) {
		return this.hasTypeOf("Arc", e, t);
	},
	hasMultiArcGauge: function() {
		return this.hasType("gauge") && this.config.gauge_type === "multi";
	},
	isLineType: function(e) {
		var t = q(e) ? e : e.id;
		return !this.config.data_types[t] || this.isTypeOf(t, nm.Line);
	},
	isStepType: function(e) {
		return this.isTypeOf(e, nm.Step);
	},
	isSplineType: function(e) {
		return this.isTypeOf(e, nm.Spline);
	},
	isAreaType: function(e) {
		return this.isTypeOf(e, nm.Area);
	},
	isAreaRangeType: function(e) {
		return this.isTypeOf(e, nm.AreaRange);
	},
	isBarType: function(e) {
		return this.isTypeOf(e, "bar");
	},
	isBubbleType: function(e) {
		return this.isTypeOf(e, "bubble");
	},
	isCandlestickType: function(e) {
		return this.isTypeOf(e, "candlestick");
	},
	isScatterType: function(e) {
		return this.isTypeOf(e, "scatter");
	},
	isTreemapType: function(e) {
		return this.isTypeOf(e, "treemap");
	},
	isPieType: function(e) {
		return this.isTypeOf(e, "pie");
	},
	isFunnelType: function(e) {
		return this.isTypeOf(e, "funnel");
	},
	isGaugeType: function(e) {
		return this.isTypeOf(e, "gauge");
	},
	isDonutType: function(e) {
		return this.isTypeOf(e, "donut");
	},
	isPolarType: function(e) {
		return this.isTypeOf(e, "polar");
	},
	isRadarType: function(e) {
		return this.isTypeOf(e, "radar");
	},
	isArcType: function(e) {
		return this.isPieType(e) || this.isDonutType(e) || this.isGaugeType(e) || this.isPolarType(e) || this.isRadarType(e);
	},
	isCirclePoint: function(e) {
		var t = this.config, n = t.point_pattern, r = !1;
		return r = e?.tagName === "circle" || t.point_type === "circle" && (!n || X(n) && n.length === 0), r;
	},
	lineData: function(e) {
		return this.isLineType(e) ? [e] : [];
	},
	arcData: function(e) {
		return this.isArcType(e.data) ? [e] : [];
	},
	labelishData: function(e) {
		return this.isBarType(e) || this.isLineType(e) || this.isScatterType(e) || this.isBubbleType(e) || this.isCandlestickType(e) || this.isFunnelType(e) || this.isRadarType(e) || this.isTreemapType(e) ? e.values.filter(function(e) {
			return J(e.value) || !!e.value;
		}) : [];
	},
	barLineBubbleData: function(e) {
		return this.isBarType(e) || this.isLineType(e) || this.isBubbleType(e) ? e.values : [];
	},
	isInterpolationType: function(e) {
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
		].indexOf(e) >= 0;
	}
};
function oh(e) {
	var t = this, n;
	return t.isLineType(e) ? n = t.generateGetLinePoints(t.getShapeIndices(t.isLineType)) : t.isBarType(e) && (n = t.generateGetBarPoints(t.getShapeIndices(t.isBarType))), n;
}
var sh = {
	getDrawShape: function() {
		var e = this, t = e.config.axis_rotated, n = e.state, r = n.hasRadar, i = n.hasTreemap, a = {
			type: {},
			indices: {},
			pos: {}
		};
		if (!i && [
			"bar",
			"candlestick",
			"line",
			"area"
		].forEach(function(t) {
			var n = wp(/^(bubble|scatter)$/.test(t) ? "line" : t);
			if (e.hasType(t) || e.hasTypeOf(n) || t === "line" && (e.hasType("bubble") || e.hasType("scatter"))) {
				var r = e.getShapeIndices(e[`is${n}Type`]), i = e[`generateDraw${n}`];
				a.indices[t] = r, a.type[t] = i ? i.bind(e)(r, !1) : void 0;
			}
		}), !e.hasArcType() || r || i) {
			var o = void 0, s = void 0;
			i || (o = r ? e.radarCircleX : t ? e.circleY : e.circleX, s = r ? e.radarCircleY : t ? e.circleX : e.circleY), a.pos = {
				xForText: e.generateXYForText(a.indices, !0),
				yForText: e.generateXYForText(a.indices, !1),
				cx: (o || function() {}).bind(e),
				cy: (s || function() {}).bind(e)
			};
		}
		return a;
	},
	getShapeIndices: function(e) {
		var t = this, n = t.config, r = n.data_xs, i = cp(r), a = {}, o = i ? {} : 0;
		return i && Mp(Object.keys(r).map(function(e) {
			return r[e];
		})).forEach(function(e) {
			o[e] = 0, a[e] = {};
		}), t.filterTargetsToShow(t.data.targets.filter(e, t)).forEach(function(e) {
			for (var t = (e.id in r) ? r[e.id] : "", i = t ? a[t] : a, s = 0, c = void 0; c = n.data_groups[s]; s++) if (!(c.indexOf(e.id) < 0)) for (var l = 0, u = void 0; u = c[l]; l++) {
				if (u in i) {
					i[e.id] = i[u];
					break;
				}
				e.id !== u && t && (i[u] = i[e.id] ?? o[t]);
			}
			ep(i[e.id]) && (i[e.id] = t ? o[t]++ : o++, i.__max__ = (t ? o[t] : o) - 1);
		}), a;
	},
	getIndices: function(e, t, n) {
		var r = this, i = r.config, a = i.data_xs, o = i.bar_indices_removeNull, s = t.id, c = t.index;
		if (r.isBarType(s) && o) {
			var l = {};
			return r.getAllValuesOnIndex(c, !0).forEach(function(e, t) {
				l[e.id] = t, l.__max__ = t;
			}), l;
		}
		return cp(a) ? e[a[s]] : e;
	},
	getIndicesMax: function(e) {
		return cp(this.config.data_xs) ? Object.keys(e).map(function(t) {
			return e[t].__max__ || 0;
		}).reduce(function(e, t) {
			return e + t;
		}) : e.__max__;
	},
	getShapeX: function(e, t, n) {
		var r = this, i = r.config, a = r.scale, o = n ? a.subX : a.zoom || a.x, s = i.bar_overlap, c = i.bar_padding, l = function(e, t) {
			return e + t;
		}, u = ap(e) && (e._$total.length ? e._$total.reduce(l) / 2 : 0);
		return function(n) {
			var i = r.getIndices(t, n, "getShapeX"), a = n.id in i ? i[n.id] : 0, d = (i.__max__ || 0) + 1, f = 0;
			if (cp(n.x)) {
				var p = o(n.x, !0);
				if (u) {
					var m = e[n.id] || e._$width;
					f = s ? p - m / 2 : p - m + e._$total.slice(0, a + 1).reduce(l) - u;
				} else f = p - (J(e) ? e : e._$width) * (d / 2 - (s ? 1 : a));
			}
			return e && f && d > 1 && c && (a && (f += c * a), d > 2 ? f -= (d - 1) * c / 2 : d === 2 && (f -= c / 2)), f;
		};
	},
	getShapeY: function(e) {
		var t = this, n = t.isStackNormalized();
		return function(r) {
			var i = r.value;
			return J(r) ? i = r : t.isAreaRangeType(r) ? i = t.getBaseValue(r, "mid") : n ? i = t.getRatio("index", r, !0) : t.isBubbleZType(r) ? i = t.getBubbleZData(r.value, "y") : t.isBarRangeType(r) && (i = i[1]), t.getYScaleById(r.id, e)(i);
		};
	},
	getShapeYMin: function(e) {
		var t = this, n = t.axis.getId(e), r = t.scale[n].domain()[0], i = t.config[`axis_${n}_inverted`];
		return !t.isGrouped(e) && !i && r > 0 ? r : 0;
	},
	getShapeOffsetData: function(e) {
		var t = this, n = t.orderTargets(t.filterTargetsToShow(t.data.targets.filter(e, t))), r = n.map(function(e) {
			return e.id;
		}).join("_"), i = `${$p.shapeOffset}_${r}`, a = t.cache.get(i);
		if (a) return a;
		var o = t.isStackNormalized(), s = n.map(function(e) {
			var n = e.values, r = {};
			t.isStepType(e) && (n = t.convertValuesToStep(n));
			var i = n.reduce(function(e, n) {
				var i = Number(n.x);
				return e[i] = n, r[i] = o ? t.getRatio("index", n, !0) : n.value, e;
			}, {});
			return {
				id: e.id,
				rowValues: n,
				rowValueMapByXValue: i,
				values: r
			};
		}), c = {
			indexMapByTargetId: n.reduce(function(e, t, n) {
				var r = t.id;
				return e[r] = n, e;
			}, {}),
			shapeOffsetTargets: s
		};
		return t.cache.add(i, c), c;
	},
	getShapeOffset: function(e, t, n) {
		var r = this, i = r.getShapeOffsetData(e), a = i.shapeOffsetTargets, o = i.indexMapByTargetId, s = r.config.data_groupsZeroAs;
		return function(e, i) {
			var c = e.id, l = e.value, u = e.x, d = r.getIndices(t, e), f = r.getYScaleById(c, n);
			if (r.isBarRangeType(e)) return f(l[0]);
			var p = Number(u), m = f(s === "zero" ? 0 : r.getShapeYMin(c)), h = m;
			return a.filter(function(e) {
				return e.id !== c && d[e.id] === d[c];
			}).forEach(function(e) {
				var t = e.id, n = e.rowValueMapByXValue, r = e.rowValues, a = e.values;
				if (o[t] < o[c]) {
					var u = a[p], d = r[i];
					d && Number(d.x) === p || (d = n[p]), d?.value * l >= 0 && J(u) && (l !== 0 || s === "positive" && u > 0 || s === "negative" && u < 0) && (h += f(u) - m);
				}
			}), h;
		};
	},
	circleY: function(e, t) {
		var n = this, r = e.id, i;
		return n.isGrouped(r) && (i = oh.bind(n)(e)), i ? i(e, t)[0][1] : n.getYScaleById(r)(n.getBaseValue(e));
	},
	getBarW: function(e, t, n) {
		var r = this, i = r.config, a = r.org, o = r.scale, s = r.state, c = r.getMaxDataCount(), l = e === "bar" && i.data_groups?.length, u = `${e}_width`, d = (r.getZoomTransform?.call(r) ?? { k: 1 }).k, f = [i.axis_x_min ?? a.xDomain[0], i.axis_x_max ?? a.xDomain[1]].map(r.axis.isTimeSeries() ? Bp.bind(r) : Number), p = t.tickInterval(c);
		if (o.zoom && !r.axis.isCategorized() && d > 1) {
			var m = f.every(function(e, t) {
				return e === a.xDomain[t];
			});
			p = a.xDomain.map(function(e, t) {
				var n = m ? e : e - Math.abs(f[t]);
				return o.zoom(n);
			}).reduce(function(e, t) {
				return Math.abs(e) + t;
			}) / c;
		}
		var h = function(e) {
			var t = e ? i[u][e] : i[u], a = e ? t.ratio : i[`${u}_ratio`], o = e ? t.max : i[`${u}_max`], l = J(t) ? t : K(t) ? t.call(r, s.width, n, c) : n ? p * a / n : 0;
			return o && l > o ? o : l;
		}, g = h();
		return !l && ap(i[u]) && (g = {
			_$width: g,
			_$total: []
		}, r.filterTargetsToShow(r.data.targets).forEach(function(e) {
			i[u][e.id] && (g[e.id] = h(e.id), g._$total.push(g[e.id] || g._$width));
		})), g;
	},
	getShapeByIndex: function(e, t, n) {
		var r = this, i = r.$el, a = G(t) ? `-${t}` : "", o = i[e];
		return o = o && !o.empty() ? o.filter(function(e) {
			return !n || e.id === n;
		}).filter(function(e) {
			return !G(t) || e.index === t;
		}) : (n ? i.main.selectAll(`.${U[`${e}s`]}${r.getTargetSelectorSuffix(n)}`) : i.main).selectAll(`.${U[e]}${a}`), o;
	},
	isWithinShape: function(e, t) {
		var n = this, r = M(e), i;
		return n.isTargetToShow(t.id) ? n.hasValidPointType?.call(n, e.nodeName) ? i = n.isStepType(t) ? n.isWithinStep(e, n.getYScaleById(t.id)(n.getBaseValue(t))) : n.isWithinCircle(e, n.isBubbleType(t) ? n.pointSelectR(t) * 1.5 : 0) : e.nodeName === "path" && (i = !r.classed(U.bar) || n.isWithinBar(e)) : i = !1, i;
	},
	getInterpolate: function(e) {
		var t = this.getInterpolateType(e);
		return {
			basis: eu,
			"basis-closed": nu,
			"basis-open": iu,
			bundle: ou,
			cardinal: lu,
			"cardinal-closed": du,
			"cardinal-open": pu,
			"catmull-rom": gu,
			"catmull-rom-closed": vu,
			"catmull-rom-open": bu,
			"monotone-x": Au,
			"monotone-y": ju,
			natural: Pu,
			"linear-closed": Su,
			linear: Ul,
			step: Iu,
			"step-after": Ru,
			"step-before": Lu
		}[t];
	},
	getInterpolateType: function(e) {
		var t = this, n = t.config, r = n.spline_interpolation_type, i = t.isInterpolationType(r) ? r : "cardinal";
		return t.isSplineType(e) ? i : t.isStepType(e) ? n.line_step_type : "linear";
	},
	isWithinBar: function(e) {
		var t = hp(this.state.event, e), n = pp(e), r = n[0], i = n[1], a = Math.min(r.x, i.x), o = Math.min(r.y, i.y), s = this.config.bar_sensitivity, c = vp(e, !0), l = c.width, u = c.height, d = a - s, f = a + l + s, p = o + u + s, m = o - s;
		return d < t[0] && t[0] < f && m < t[1] && t[1] < p;
	}
}, ch = function() {
	function e(e) {
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
			defaultAxisTime: null,
			axisTime: null
		};
		var t = this;
		t.api = e, t.config = new Xp(), t.cache = new em();
		var n = new Qp();
		t.$el = n.getStore("element"), t.state = n.getStore("state"), t.$T = t.$T.bind(t);
	}
	return e.prototype.$T = function(e, t, n) {
		var r = this, i = r.config, a = r.state, o = i.transition_duration, s = i.subchart_show, c = e;
		return c &&= ("tagName" in c && (c = M(c)), (t !== !1 && o || t) && (!a.zooming || a.dragging) && !a.resizing && a.rendered && !s ? c.transition(n).duration(o) : c), c;
	}, e.prototype.beforeInit = function() {
		var e = this;
		e.callPluginHook("$beforeInit"), Q(e.config.onbeforeinit, e.api);
	}, e.prototype.afterInit = function() {
		var e = this;
		e.callPluginHook("$afterInit"), Q(e.config.onafterinit, e.api);
	}, e.prototype.init = function() {
		var e = this, t = e.config, n = e.state, r = e.$el, i = t.boost_useCssRule, a = t.bindto;
		rm(e);
		var o = e.hasArcType();
		if (n.hasRadar = !n.hasAxis && e.hasType("radar"), n.hasFunnel = !n.hasAxis && e.hasType("funnel"), n.hasTreemap = !n.hasAxis && e.hasType("treemap"), n.hasAxis = !o && !n.hasFunnel && !n.hasTreemap, n.datetimeId = `bb-${+/* @__PURE__ */ new Date() * yp()}`, i) {
			var s = Df.createElement("style");
			s.type = "text/css", Df.head.appendChild(s), n.style = {
				rootSelctor: `.${n.datetimeId}`,
				sheet: s.sheet
			}, r.style = s;
		}
		var c = {
			element: a,
			classname: "bb"
		};
		Z(a) && (c.element = a.element || "#chart", c.classname = a.classname || c.classname), r.chart = K(c.element.node) ? a.element : M(c.element || []), r.chart.empty() && (r.chart = M(Df.body.appendChild(Df.createElement("div")))), r.chart.html("").classed(c.classname, !0).classed(n.datetimeId, i).style("position", "relative"), e.initParams(), e.initToRender();
	}, e.prototype.initToRender = function(e) {
		var t = this, n = t.config, r = t.state, i = t.$el.chart, a = function() {
			return Hp(i, {
				display: "none",
				visibility: "hidden"
			});
		}, o = n.render.lazy === !1 ? !1 : n.render.lazy || a(), s = W.MutationObserver;
		o && s && n.render.observe !== !1 && !e && new s(function(e, n) {
			a() || (n.disconnect(), !r.rendered && t.initToRender(!0));
		}).observe(i.node(), {
			attributes: !0,
			attributeFilter: ["class", "style"]
		}), (!o || e) && t.convertData(n, function(e) {
			t.initWithData(e), t.afterInit();
		});
	}, e.prototype.initParams = function() {
		var e = this, t = e.config, n = e.format, r = e.state;
		if (e.color = e.generateColor(), e.levelColor = e.generateLevelColor(), t.padding === !1 && (t.axis_x_show = !1, t.axis_y_show = !1, t.axis_y2_show = !1, t.subchart_show = !1), (e.hasPointType() || e.hasLegendDefsPoint?.call(e)) && (e.point = e.generatePoint()), r.hasAxis) {
			e.initClip(), n.extraLineClasses = e.generateExtraLineClass(), n.dataTime = t.data_xLocaltime ? si : li, n.axisTime = t.axis_x_localtime ? oi : ci;
			var i = t.zoom_enabled && t.zoom_type === "drag";
			n.defaultAxisTime = function(t) {
				var r = e.scale, a = r.x, o = r.zoom, s = i ? o : o && a.orgDomain().toString() !== o.domain().toString(), c = t.getMilliseconds() && ".%L" || t.getSeconds() && ".:%S" || t.getMinutes() && "%I:%M" || t.getHours() && "%I %p" || t.getDate() !== 1 && "%b %d" || s && t.getDate() === 1 && "%b'%y" || t.getMonth() && "%-m/%-d" || "%Y";
				return n.axisTime(c)(t);
			};
		}
		var a = t.legend_position, o = t.legend_inset_anchor, s = t.axis_rotated;
		r.isLegendRight = a === "right", r.isLegendInset = a === "inset", r.isLegendTop = o === "top-left" || o === "top-right", r.isLegendLeft = o === "top-left" || o === "bottom-left", r.rotatedPadding.top = e.getResettedPadding(r.rotatedPadding.top), r.rotatedPadding.right = s && !t.axis_x_show ? 0 : 30, r.inputType = Wp(t.interaction_inputType_mouse, t.interaction_inputType_touch);
	}, e.prototype.initWithData = function(e) {
		var t, n, r = this, i = r.config, a = r.scale, o = r.state, s = r.$el, c = r.org, l = o.hasAxis, u = o.hasFunnel, d = o.hasTreemap, f = i.interaction_enabled, p = r.hasType("polar"), m = i.data_labels_backgroundColors;
		if (l && (r.axis = r.getAxisInstance(), i.zoom_enabled && r.initZoom()), r.data.xs = {}, r.data.targets = r.convertDataToTargets(e), i.data_filter && (r.data.targets = r.data.targets.filter(i.data_filter.bind(r.api))), i.data_hide && r.addHiddenTargetIds(i.data_hide === !0 ? r.mapToIds(r.data.targets) : i.data_hide), i.legend_hide && r.addHiddenLegendIds(i.legend_hide === !0 ? r.mapToIds(r.data.targets) : i.legend_hide), r.updateSizes(), r.updateScales(!0), l) {
			var h = a.x, g = a.y, _ = a.y2, v = a.subX, y = a.subY, b = a.subY2;
			h && (h.domain(Fp(r.getXDomain(r.data.targets), !i.axis_x_inverted)), v.domain(h.domain()), c.xDomain = h.domain()), g && (g.domain(r.getYDomain(r.data.targets, "y")), y.domain(g.domain())), _ && (_.domain(r.getYDomain(r.data.targets, "y2")), b && b.domain(_.domain()));
		}
		if (s.svg = s.chart.append("svg").style("overflow", "hidden").style("display", "block"), f && o.inputType) {
			var x = o.inputType === "touch", S = i.onclick, C = i.onover, w = i.onout;
			s.svg.on("click", S?.bind(r.api) || null).on(x ? "touchstart" : "mouseenter", C?.bind(r.api) || null, x ? { passive: !0 } : void 0).on(x ? "touchend" : "mouseleave", w?.bind(r.api) || null);
		}
		i.svg_classname && s.svg.attr("class", i.svg_classname);
		var T = K(i.color_tiles) && r.patterns;
		(l || T || p || d || m || r.hasLegendDefsPoint?.call(r)) && (s.defs = s.svg.append("defs"), l && [
			"id",
			"idXAxis",
			"idYAxis",
			"idGrid"
		].forEach(function(e) {
			r.appendClip(s.defs, o.clip[e]);
		}), r.generateTextBGColorFilter(m), T && r.patterns.forEach(function(e) {
			return s.defs.append(function() {
				return e.node;
			});
		})), r.updateSvgSize(), r.bindResize();
		var E = s.svg.append("g").classed(I.main, !0).attr("transform", u || d ? null : r.getTranslate("main"));
		if (s.main = E, i.subchart_show && r.initSubchart(), i.tooltip_show && r.initTooltip(), i.title_text && r.initTitle(), !d && i.legend_show && r.initLegend(), i.data_empty_label_text && E.append("text").attr("class", `${pf.text} ${I.empty}`).attr("text-anchor", "middle").attr("dominant-baseline", "middle"), l && (i.regions.length && r.initRegion(), !i.clipPath && r.axis.init()), E.append("g").classed(I.chart, !0).attr("clip-path", l ? o.clip.path : null), r.callPluginHook("$init"), r.initChartElements(), l && (f && ((t = r.initEventRect) == null || t.call(r)), r.initGrid(), i.clipPath && ((n = r.axis) == null || n.init())), r.updateTargets(r.data.targets), r.updateDimension(), Q(i.oninit, r.api), r.setBackground(), r.redraw({
			withTransition: !1,
			withTransform: !0,
			withUpdateXDomain: !0,
			withUpdateOrgXDomain: !0,
			withTransitionForAxis: !1,
			initializing: !0
		}), i.data_onmin || i.data_onmax) {
			var D = r.getMinMaxData();
			Q(i.data_onmin, r.api, D.min), Q(i.data_onmax, r.api, D.max);
		}
		i.tooltip_show && r.initShowTooltip(), o.rendered = !0;
	}, e.prototype.initChartElements = function() {
		var e = this, t = e.state, n = t.hasAxis, r = t.hasRadar, i = t.hasTreemap, a = [];
		if (n) {
			var o = [
				"bar",
				"bubble",
				"candlestick",
				"line"
			];
			e.config.bar_front && o.push(o.shift());
			for (var s = 0, c = o; s < c.length; s++) {
				var l = c[s], u = wp(l);
				(l === "line" && e.hasTypeOf(u) || e.hasType(l)) && a.push(u);
			}
		} else if (i) a.push("Treemap");
		else if (e.hasType("funnel")) a.push("Funnel");
		else {
			var d = e.hasType("polar"), f = e.hasType("gauge");
			r || a.push("Arc", "Pie"), f ? a.push("Gauge") : r ? a.push("Radar") : d && a.push("Polar");
		}
		for (var p = 0, m = a; p < m.length; p++) e[`init${m[p]}`]();
		cp(e.config.data_labels) && !e.hasArcType(null, ["radar"]) && e.initText();
	}, e.prototype.setChartElements = function() {
		var e = this, t = e.$el, n = t.chart, r = t.svg, i = t.defs, a = t.main, o = t.tooltip, s = t.legend, c = t.title, l = t.grid, u = t.needle, d = t.arcs, f = t.circle, p = t.bar, m = t.candlestick, h = t.line, g = t.area, _ = t.text;
		e.api.$ = {
			chart: n,
			svg: r,
			defs: i,
			main: a,
			tooltip: o,
			legend: s,
			title: c,
			grid: l,
			arc: d,
			circles: f,
			bar: { bars: p },
			candlestick: m,
			line: {
				lines: h,
				areas: g
			},
			needle: u,
			text: { texts: _ }
		};
	}, e.prototype.setBackground = function() {
		var e = this, t = e.config.background, n = e.state, r = e.$el.svg;
		if (cp(t)) {
			var i = r.select("g").insert(t.imgUrl ? "image" : "rect", ":first-child");
			t.imgUrl ? i.attr("href", t.imgUrl) : t.color && i.style("fill", t.color).attr("clip-path", n.clip.path), i.attr("class", t.class || null).attr("width", "100%").attr("height", "100%");
		}
	}, e.prototype.updateTargets = function(e) {
		var t, n, r = this, i = r.state, a = i.hasAxis, o = i.hasFunnel, s = i.hasRadar, c = i.hasTreemap, l = function(t) {
			return r[`updateTargetsFor${t}`](e.filter(r[`is${t}Type`].bind(r)));
		};
		if (r.updateTargetsForText(e), a) {
			for (var u = [
				"bar",
				"candlestick",
				"line"
			], d = 0, f = u; d < f.length; d++) {
				var p = f[d], m = wp(p);
				(p === "line" && r.hasTypeOf(m) || r.hasType(p)) && l(m);
			}
			(t = r.updateTargetsForSubchart) == null || t.call(r, e);
		} else if (r.hasArcType(e)) {
			var h = "Arc";
			s ? h = "Radar" : r.hasType("polar") && (h = "Polar"), l(h);
		} else o ? l("Funnel") : c && l("Treemap");
		var g = r.hasType("bubble") || r.hasType("scatter");
		g && ((n = r.updateTargetForCircle) == null || n.call(r)), r.filterTargetsToShowAtInit(g);
	}, e.prototype.filterTargetsToShowAtInit = function(e) {
		e === void 0 && (e = !1);
		var t = this, n = t.$el.svg, r = t.$T, i = `.${I.target}`;
		e && (i += `, .${tf.chartCircles} > .${tf.circles}`), r(n.selectAll(i).filter(function(e) {
			return t.isTargetToShow(e.id);
		})).style("opacity", null);
	}, e.prototype.getWithOption = function(e) {
		for (var t = {
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
		}, n = 0, r = Object.entries(t); n < r.length; n++) {
			var i = r[n], a = i[0], o = i[1], s = q(o) ? t[o] : o;
			t[a] = lp(e, `with${a}`, s);
		}
		return t;
	}, e.prototype.initialOpacity = function(e) {
		var t = this, n = t.state.withoutFadeIn;
		return t.getBaseValue(e) !== null && n[e.id] ? null : "0";
	}, e.prototype.bindResize = function() {
		var e = this, t = e.$el, n = e.config, r = e.state, i = sm(n.resize_timer), a = n.resize_auto, o = [];
		o.push(function() {
			return Q(n.onresize, e.api);
		}), /^(true|parent)$/.test(a) && o.push(function() {
			r.resizing = !0, n.legend_show && (e.updateSizes(), e.updateLegend()), e.api.flush(!1);
		}), o.push(function() {
			Q(n.onresized, e.api), r.resizing = !1;
		}), o.forEach(function(e) {
			return i.add(e);
		}), e.resizeFunction = i, a === "parent" ? (e.resizeFunction.resizeObserver = new ResizeObserver(e.resizeFunction.bind(e))).observe(t.chart.node().parentNode) : W.addEventListener("resize", e.resizeFunction);
	}, e.prototype.callPluginHook = function(e) {
		for (var t = this, n = [], r = 1; r < arguments.length; r++) n[r - 1] = arguments[r];
		this.config.plugins.forEach(function(r) {
			e === "$beforeInit" && (r.$$ = t, t.api.plugins.push(r)), r[e].apply(r, n);
		});
	}, e;
}();
Cp(ch.prototype, [
	Sm,
	Cm,
	Tm,
	Dm,
	Om,
	Mm,
	Nm,
	Em,
	Fm,
	zm,
	Bm,
	Hm,
	sh,
	Um,
	Wm,
	eh,
	nh,
	rh,
	ih,
	ah
]);
function lh(e) {
	var t = this.config, n, r, i, a = function() {
		var e = r.shift();
		if (e && n && ap(n) && e in n) return n = n[e], a();
		if (!e) return n;
	};
	Object.keys(t).forEach(function(o) {
		n = e, r = o.split("_"), i = a(), Y(i) && (t[o] = i);
	}), this.api && (this.state.orgConfig = e);
}
var uh = {
	resize: function(e) {
		var t = this.internal, n = t.config, r = t.state;
		r.rendered && (n.size_width = e ? e.width : null, n.size_height = e ? e.height : null, r.resizing = !0, this.flush(!1), t.resizeFunction());
	},
	flush: function(e) {
		var t, n, r = this.internal, i = r.state, a = r.$el.zoomResetBtn;
		i.rendered ? (i.resizing ? (t = r.brush) == null || t.updateResize() : (n = r.axis) == null || n.setOrient(), a?.style("display", "none"), r.scale.zoom && (i.current.zoomDomain = r.scale.zoom.domain()), r.scale.zoom = null, e ? r.redraw({
			withTransform: !0,
			withUpdateXDomain: !0,
			withUpdateOrgXDomain: !0,
			withLegend: !0
		}) : r.updateAndRedraw({
			withLegend: !0,
			withTransition: !1,
			withTransitionForTransform: !1
		}), !i.resizing && r.brush && (r.brush.getSelection().call(r.brush.move), r.unselectRect()), i.current.zoomDomain && (r.api.zoom(i.current.zoomDomain), i.current.zoomDomain = null)) : r.initToRender(!0);
	},
	destroy: function() {
		var e = this, t, n = this.internal, r = n.$el, i = r.chart, a = r.style, o = r.svg;
		if (cp(n)) for (var s in n.callPluginHook("$willDestroy"), n.charts.splice(n.charts.indexOf(this), 1), n.unbindAllEvents(), o.select("*").interrupt(), n.resizeFunction.clear(), (t = n.resizeFunction.resizeObserver) == null || t.disconnect(), W.removeEventListener("resize", n.resizeFunction), i.classed("bb", !1).style("position", null).selectChildren().remove(), a && a.parentNode.removeChild(a), Object.keys(this).forEach(function(t) {
			t === "internal" && Object.keys(n).forEach(function(e) {
				n[e] = null;
			}), e[t] = null, delete e[t];
		}), this) this[s] = function() {};
		return null;
	},
	config: function(e, t, n) {
		var r = this.internal, i = r.config, a = r.state, o = e?.replace(/\./g, "_"), s;
		return e && o in i ? Y(t) ? (i[o] = t, s = t, n && this.flush()) : s = i[o] : (arguments.length === 0 || sp(e)) && (s = a.orgConfig), s;
	}
}, dh = { color: function(e) {
	return this.internal.color(e);
} }, fh = function(e) {
	var t = this.internal.data.targets;
	if (!ep(e)) {
		var n = X(e) ? e : [e];
		return t.filter(function(e) {
			return n.some(function(t) {
				return t === e.id;
			});
		});
	}
	return t;
};
Cp(fh, {
	shown: function(e) {
		return this.internal.filterTargetsToShow(this.data(e));
	},
	values: function(e, t) {
		t === void 0 && (t = !0);
		var n = null;
		if (e) {
			var r = this.data(e);
			X(r) && (n = [], r.forEach(function(e) {
				var r = e.values.map(function(e) {
					return e.value;
				});
				t ? n = n.concat(r) : n.push(r);
			}));
		}
		return n;
	},
	names: function(e) {
		return this.internal.updateDataAttributes("names", e);
	},
	colors: function(e) {
		return this.internal.updateDataAttributes("colors", e);
	},
	axes: function(e) {
		return this.internal.updateDataAttributes("axes", e);
	},
	min: function() {
		return this.internal.getMinMaxData().min;
	},
	max: function() {
		return this.internal.getMinMaxData().max;
	}
});
var ph = { data: fh }, mh = function(e) {
	return W.btoa?.call(W, encodeURIComponent(e).replace(/%([0-9A-F]{2})/g, function(e, t) {
		return String.fromCharCode(Number(`0x${t}`));
	}));
};
function hh(e, t, n) {
	var r = t || n, i = r.width, a = r.height, s = new XMLSerializer(), c = e.cloneNode(!0), l = Op(Ep(Df.styleSheets)).filter(function(e) {
		return e.cssText;
	}).map(function(e) {
		return e.cssText;
	});
	c.setAttribute("xmlns", o.xhtml), c.style.margin = "0", c.style.padding = "0", t.preserveFontStyle && c.querySelectorAll("text").forEach(function(e) {
		e.innerHTML = "";
	});
	var u = s.serializeToString(c), d = Df.createElement("style");
	d.appendChild(Df.createTextNode(l.join("\n")));
	var f = s.serializeToString(d);
	return `data:image/svg+xml;base64,${mh(`<svg xmlns="${o.svg}" width="${i}" height="${a}" 
		viewBox="0 0 ${n.width} ${n.height}" 
		preserveAspectRatio="${t?.preserveAspectRatio === !1 ? "none" : "xMinYMid meet"}">
			<foreignObject width="100%" height="100%">
				${f}
				${u.replace(/(url\()[^#]+/g, "$1")}
			</foreignObject></svg>`)}`;
}
function gh(e, t) {
	var n = t.top, r = t.left, i = vp(e, !0), a = i.x, o = i.y, s = e.getScreenCTM(), c = s.a, l = s.b, u = s.c, d = s.d, f = s.e, p = s.f, m = _p(e, !0), h = m.width, g = m.height;
	return {
		x: c * a + u * o + f - r,
		y: l * a + d * o + p - n + (g - Math.round(g / 4)),
		width: h,
		height: g
	};
}
function _h(e) {
	var t = _p(e), n = t.left, r = t.top, i = function(e) {
		return e.textContent || e.childElementCount;
	}, a = [];
	return Ep(e.querySelectorAll("text")).filter(i).forEach(function(e) {
		var t = function(e) {
			var t, i = W.getComputedStyle(e), a = i.fill, o = i.fontFamily, s = i.fontSize, c = i.textAnchor, l = i.transform, u = gh(e, {
				left: n,
				top: r
			}), d = u.x, f = u.y, p = u.width, m = u.height;
			return t = {}, t[e.textContent] = {
				x: d,
				y: f,
				width: p,
				height: m,
				fill: a,
				fontFamily: o,
				fontSize: s,
				textAnchor: c,
				transform: l
			}, t;
		};
		if (e.childElementCount > 1) return Ep(e.querySelectorAll("tspan")).filter(i).forEach(function(e) {
			a.push(t(e));
		}), [];
		a.push(t(e));
	}), a;
}
function vh(e, t) {
	t.forEach(function(t) {
		Object.keys(t).forEach(function(n) {
			var r = t[n], i = r.x, a = r.y, o = r.width, s = r.height, c = r.fill, l = r.fontFamily, u = r.fontSize, d = r.transform;
			if (e.save(), e.font = `${u} ${l}`, e.fillStyle = c, d === "none") e.fillText(n, i, a);
			else {
				var f = d.replace(/(matrix|\(|\))/g, "").split(",");
				f.splice(4).every(function(e) {
					return +e == 0;
				}) ? (f.push(i + o - o / 4), f.push(a - s + s / 3)) : (f.push(i), f.push(a)), e.transform.apply(e, f), e.fillText(n, 0, 0);
			}
			e.restore();
		});
	});
}
var yh = { export: function(e, t) {
	var n = this, r = this.internal, i = r.state, a = r.$el, o = a.chart, s = a.svg, c = i.current, l = c.width, u = c.height, d = Pp(Object.create(null), {
		width: l,
		height: u,
		preserveAspectRatio: !0,
		preserveFontStyle: !1,
		mimeType: "image/png"
	}, e), f = hh(o.node(), d, {
		width: l,
		height: u
	}), p = d.preserveFontStyle ? _h(s.node()) : [];
	if (t && K(t)) {
		var m = new Image();
		m.crossOrigin = "Anonymous", m.onload = function() {
			var e = Df.createElement("canvas"), r = e.getContext("2d");
			e.width = d.width || l, e.height = d.height || u, r.drawImage(m, 0, 0), p.length &&= (vh(r, p), 0), t.bind(n)(e.toDataURL(d.mimeType));
		}, m.src = f;
	}
	return f;
} }, bh = {
	focus: function(e) {
		var t = this.internal, n = t.state, r = t.mapToTargetIds(e), i = t.$el.svg.selectAll(t.selectorTargets(r.filter(t.isTargetToShow, t)));
		this.revert(), this.defocus(), i.classed(z.focused, !0).classed(z.defocused, !1), t.hasArcType() && !n.hasRadar && (t.expandArc(r), t.hasType("gauge") && t.markOverlapped(e, t, `.${of.gaugeValue}`)), t.toggleFocusLegend(r, !0), n.focusedTargetIds = r, n.defocusedTargetIds = n.defocusedTargetIds.filter(function(e) {
			return r.indexOf(e) < 0;
		});
	},
	defocus: function(e) {
		var t = this.internal, n = t.state, r = t.mapToTargetIds(e);
		t.$el.svg.selectAll(t.selectorTargets(r.filter(t.isTargetToShow, t))).classed(z.focused, !1).classed(z.defocused, !0), t.hasArcType(null, ["polar"]) && (t.unexpandArc(r), t.hasType("gauge") && t.undoMarkOverlapped(t, `.${of.gaugeValue}`)), t.toggleFocusLegend(r, !1), n.focusedTargetIds = n.focusedTargetIds.filter(function(e) {
			return r.indexOf(e) < 0;
		}), n.defocusedTargetIds = r;
	},
	revert: function(e) {
		var t = this.internal, n = t.config, r = t.state, i = t.$el, a = t.mapToTargetIds(e);
		i.svg.selectAll(t.selectorTargets(a)).classed(z.focused, !1).classed(z.defocused, !1), t.hasArcType(null, ["polar"]) && t.unexpandArc(a), n.legend_show && (t.showLegend(a.filter(t.isLegendToShow.bind(t))), i.legend.selectAll(t.selectorLegends(a)).filter(function() {
			return M(this).classed(z.legendItemFocused);
		}).classed(z.legendItemFocused, !1)), r.focusedTargetIds = [], r.defocusedTargetIds = [];
	}
}, xh = { legend: {
	show: function(e) {
		var t = this.internal;
		t.showLegend(t.mapToTargetIds(e)), t.updateAndRedraw({ withLegend: !0 });
	},
	hide: function(e) {
		var t = this.internal;
		t.hideLegend(t.mapToTargetIds(e)), t.updateAndRedraw({ withLegend: !0 });
	}
} }, Sh = {
	load: function(e) {
		var t = this.internal, n = t.config;
		e.xs && t.addXs(e.xs), "names" in e && this.data.names(e.names), "classes" in e && Object.keys(e.classes).forEach(function(t) {
			n.data_classes[t] = e.classes[t];
		}), "categories" in e && t.axis.isCategorized() && (n.axis_x_categories = e.categories), "axes" in e && Object.keys(e.axes).forEach(function(t) {
			n.data_axes[t] = e.axes[t];
		}), "colors" in e && Object.keys(e.colors).forEach(function(t) {
			n.data_colors[t] = e.colors[t];
		}), "unload" in e && e.unload !== !1 ? t.unload(t.mapToTargetIds(e.unload === !0 ? null : e.unload), function() {
			Af(function() {
				return t.loadFromArgs(e);
			});
		}) : t.loadFromArgs(e);
	},
	unload: function(e) {
		var t = this.internal, n = e || {};
		sp(n) && this.tooltip.hide(), X(n) ? n = { ids: n } : q(n) && (n = { ids: [n] });
		var r = t.mapToTargetIds(n.ids);
		t.unload(r, function() {
			t.redraw({
				withUpdateOrgXDomain: !0,
				withUpdateXDomain: !0,
				withLegend: !0
			}), t.cache.remove(r), wm.call(t, n.done, n.resizeAfter);
		});
	}
};
function Ch(e, t, n) {
	var r = this, i = this.internal, a = i.mapToTargetIds(t), o = i.state.hiddenTargetIds.map(function(e) {
		return a.indexOf(e) > -1 && e;
	}).filter(Boolean);
	i.state.toggling = !0, i[`${e ? "remove" : "add"}HiddenTargetIds`](a);
	var s = i.$el.svg.selectAll(i.selectorTargets(a)), c = e ? null : "0";
	e && o.length && (s.style("display", null), Q(i.config.data_onshown, this, o)), i.$T(s).style("opacity", c, "important").call(dp, function() {
		!e && o.length === 0 && (s.style("display", "none"), Q(i.config?.data_onhidden, r, a)), s.style("opacity", c);
	}), n.withLegend && i[`${e ? "show" : "hide"}Legend`](a), i.redraw({
		withUpdateOrgXDomain: !0,
		withUpdateXDomain: !0,
		withLegend: !0
	}), i.state.toggling = !1;
}
var wh = {
	show: function(e, t) {
		t === void 0 && (t = {}), Ch.call(this, !0, e, t);
	},
	hide: function(e, t) {
		t === void 0 && (t = {}), Ch.call(this, !1, e, t);
	},
	toggle: function(e, t) {
		var n = this;
		t === void 0 && (t = {});
		var r = this.internal, i = {
			show: [],
			hide: []
		};
		r.mapToTargetIds(e).forEach(function(e) {
			return i[r.isTargetToShow(e) ? "hide" : "show"].push(e);
		}), i.show.length && this.show(i.show, t), i.hide.length && setTimeout(function() {
			return n.hide(i.hide, t);
		}, 0);
	}
}, Th = { tooltip: {
	show: function(e) {
		var t = this.internal, n = t.$el, r = t.config, i = t.state, a = i.eventReceiver, o = i.hasFunnel, s = i.hasTreemap, c = i.inputType, l, u;
		if (e.mouse && (u = e.mouse), e.data) {
			var d = e.data, f = t.getYScaleById(d.id)?.(d.value);
			if ((o || s) && d.id) {
				var p = t.selectorTarget(d.id, void 0, `.${H.shape}`);
				a.rect = n.main.select(p);
			} else t.isMultipleX() ? u = [t.xx(d), f] : (r.tooltip_grouped || (u = [0, f]), l = d.index ?? (t.hasArcType() && d.id ? t.getArcElementByIdOrIndex(d.id)?.datum().index : t.getIndexByX(d.x)));
		} else Y(e.x) ? l = t.getIndexByX(e.x) : Y(e.index) && (l = e.index);
		(c === "mouse" ? ["mouseover", "mousemove"] : ["touchstart"]).forEach(function(e) {
			t.dispatchEvent(e, l, u);
		});
	},
	hide: function() {
		var e, t, n, r = this.internal, i = r.state.inputType, a = r.$el.tooltip?.datum();
		if (a) {
			var o = JSON.parse(a.current)[0].index;
			(i === "mouse" ? ["mouseout"] : ["touchend"]).forEach(function(e) {
				r.dispatchEvent(e, o);
			});
		}
		i === "touch" && r.callOverOutForTouch(), r.hideTooltip(!0), (e = r.hideGridFocus) == null || e.call(r), (t = r.unexpandCircles) == null || t.call(r), (n = r.expandBarTypeShapes) == null || n.call(r, !1);
	}
} }, Eh = function() {
	function e(t) {
		this.plugins = [];
		var n = new ch(this);
		this.internal = n, (function e(t, n, r) {
			Object.keys(t).forEach(function(i) {
				var a = K(t[i]), o = n !== r, s = cp(t[i]), c = s && Object.keys(t[i]).length > 0;
				n[i] = a && (!o && c || o) ? t[i].bind(r) : s && !a ? {} : t[i], c && e(t[i], n[i], r);
			});
		})(e.prototype, this, this), lh.call(n, t), n.beforeInit(), n.init();
	}
	return e;
}();
Cp(Eh.prototype, [
	uh,
	dh,
	ph,
	yh,
	bh,
	xh,
	Sh,
	wh,
	Th
]);
function Dh(e, t, n) {
	var r = e.config, i = function(e, n) {
		var i = J(n) ? n : n === !1 ? void 0 : null;
		i !== null && (r[`axis_${e}_${t}`] = i);
	};
	Y(n) && (ap(n) ? Object.keys(n).forEach(function(e) {
		i(e, n[e]);
	}) : (J(n) || n === !1) && ["y", "y2"].forEach(function(e) {
		i(e, n);
	}), e.redraw({
		withUpdateOrgXDomain: !0,
		withUpdateXDomain: !0
	}));
}
function Oh(e, t) {
	var n = e.config;
	return {
		x: n[`axis_x_${t}`],
		y: n[`axis_y_${t}`],
		y2: n[`axis_y2_${t}`]
	};
}
var kh = { axis: {
	labels: function(e) {
		var t = this.internal, n;
		return e && (Object.keys(e).forEach(function(n) {
			t.axis.setLabelText(n, e[n]);
		}), t.axis.updateLabels()), [
			"x",
			"y",
			"y2"
		].forEach(function(e) {
			var r = t.axis.getLabelText(e);
			r && (!n && (n = {}), n[e] = r);
		}), n;
	},
	min: function(e) {
		var t = this.internal;
		return G(e) || e === !1 ? Dh(t, "min", e) : Oh(t, "min");
	},
	max: function(e) {
		var t = this.internal;
		return G(e) || e === !1 ? Dh(t, "max", e) : Oh(t, "max");
	},
	range: function(e) {
		var t = this.axis;
		if (arguments.length) {
			var n = e.min, r = e.max;
			Y(r) && t.max(r), Y(n) && t.min(n);
		} else return {
			max: t.max(),
			min: t.min()
		};
	}
} }, Ah = {
	category: function(e, t) {
		var n = this.internal, r = n.config;
		return arguments.length > 1 && (r.axis_x_categories[e] = t, n.redraw()), r.axis_x_categories[e];
	},
	categories: function(e) {
		var t = this.internal, n = t.config;
		if (!e || !Array.isArray(e)) {
			var r = n.axis_x_categories;
			return sp(r) ? Object.values(t.data.xs)[0] : r;
		}
		return n.axis_x_categories = e, t.redraw(), n.axis_x_categories;
	}
}, jh = { flow: function(e) {
	var t = this.internal, n;
	(e.json || e.rows || e.columns) && t.convertData(e, function(e) {
		n = e, r();
	});
	function r() {
		var r, i = 0, a = 0, o, s;
		if (!t.state.redrawing && n && Up()) {
			var c = [], l = t.getMaxDataCount(), u = t.convertDataToTargets(n, !0), d = t.axis.isTimeSeries();
			t.data.targets.forEach(function(e) {
				for (var t = !1, n = 0; n < u.length; n++) if (e.id === u[n].id) {
					t = !0, e.values[e.values.length - 1] && (a = e.values[e.values.length - 1].index + 1), i = u[n].values.length;
					for (var r = 0; r < i; r++) u[n].values[r].index = a + r, d || (u[n].values[r].x = a + r);
					e.values = e.values.concat(u[n].values), u.splice(n, 1);
					break;
				}
				!t && c.push(e.id);
			}), t.data.targets.forEach(function(e) {
				for (var n = 0; n < c.length; n++) if (e.id === c[n]) {
					a = e.values[e.values.length - 1].index + 1;
					for (var r = 0; r < i; r++) e.values.push({
						id: e.id,
						index: a + r,
						x: d ? t.getOtherTargetX(a + r) : a + r,
						value: null
					});
				}
			}), t.data.targets.length && u.forEach(function(e) {
				for (var n = [], r = t.data.targets[0].values[0].index; r < a; r++) n.push({
					id: e.id,
					index: r,
					x: d ? t.getOtherTargetX(r) : r,
					value: null
				});
				e.values.forEach(function(e) {
					e.index += a, d || (e.x += a);
				}), e.values = n.concat(e.values);
			}), t.data.targets = t.data.targets.concat(u);
			var f = t.data.targets[0], p = f.values[0];
			Y(e.to) ? (i = 0, s = d ? Bp.call(t, e.to) : e.to, f.values.forEach(function(e) {
				e.x < s && i++;
			})) : Y(e.length) && (i = e.length), l ? l === 1 && d && (o = (f.values[f.values.length - 1].x - p.x) / 2, r = [/* @__PURE__ */ new Date(+p.x - o), new Date(+p.x + o)]) : (o = d ? f.values.length > 1 ? f.values[f.values.length - 1].x - p.x : p.x - t.getXDomain(t.data.targets)[0] : 1, r = [p.x - o, p.x]), r && t.updateXDomain(null, !0, !0, !1, r), t.updateTargets(t.data.targets), t.redraw({
				flow: {
					index: p.index,
					length: i,
					duration: G(e.duration) ? e.duration : t.config.transition_duration,
					done: e.done,
					orgDataCount: l
				},
				withLegend: !0,
				withTransition: l > 1,
				withTrimXDomain: !1,
				withUpdateXAxis: !0
			});
		}
	}
} };
function Mh(e, t) {
	var n = this.internal, r = n.config, i = r.transition_duration && Up(), a = `grid_${t}_lines`;
	return e && (r[a] = e, n.updateGrid(), n.redrawGrid(i)), r[a];
}
function Nh(e, t) {
	var n = `grid_${t}_lines`;
	return Mh.bind(this)(this.internal.config[n].concat(e || []), t);
}
function Ph(e, t) {
	this.internal.removeGridLines(e, t);
}
var Fh = function(e) {
	return Mh.bind(this)(e, "x");
};
Cp(Fh, {
	add: function(e) {
		return Nh.bind(this)(e, "x");
	},
	remove: function(e) {
		return Ph.bind(this)(e, !0);
	}
});
var Ih = function(e) {
	return Mh.bind(this)(e, "y");
};
Cp(Ih, {
	add: function(e) {
		return Nh.bind(this)(e, "y");
	},
	remove: function(e) {
		return Ph.bind(this)(e, !1);
	}
});
var Lh = {
	xgrids: Fh,
	ygrids: Ih
}, Rh = { groups: function(e) {
	var t = this.internal, n = t.config;
	return ep(e) || (n.data_groups = e, t.redraw()), n.data_groups;
} };
function zh(e, t) {
	t === void 0 && (t = !1);
	var n = this.internal, r = n.config, i = r.transition_duration && Up();
	return e ? (r.regions = t ? r.regions.concat(e) : e, n.updateRegion(), n.redrawRegion(i), t ? r.regions : e) : r.regions;
}
var Bh = function(e) {
	return zh.bind(this)(e);
};
Cp(Bh, {
	add: function(e) {
		return zh.bind(this)(e, !0);
	},
	remove: function(e) {
		var t = this.internal, n = t.config, r = t.$T, i = e || {}, a = lp(i, "classes", [df.region]), o = t.$el.main.select(`.${df.regions}`).selectAll(a.map(function(e) {
			return `.${e}`;
		}));
		return r(o).style("opacity", "0").remove(), o = n.regions, Object.keys(i).length ? (o = o.filter(function(e) {
			var t = !1;
			return !e.class || (e.class.split(" ").forEach(function(e) {
				a.indexOf(e) >= 0 && (t = !0);
			}), !t);
		}), n.regions = o) : n.regions = [], o;
	}
});
var Vh = { regions: Bh }, Hh = {
	x: function(e) {
		var t = this.internal, n = t.axis, r = t.data, i = n.isCustomX() && n.isCategorized();
		return X(e) && (i ? this.categories(e) : (t.updateTargetX(r.targets, e), t.redraw({
			withUpdateOrgXDomain: !0,
			withUpdateXDomain: !0
		}))), i ? this.categories() : r.xs;
	},
	xs: function(e) {
		var t = this.internal;
		return Z(e) && (t.updateTargetXs(t.data.targets, e), t.redraw({
			withUpdateOrgXDomain: !0,
			withUpdateXDomain: !0
		})), t.data.xs;
	}
}, Uh = function() {
	function e(e) {
		this.charSize = {};
		var t = Vm(), n = e.config, r = e.params;
		this.owner = e, this.config = n, this.scale = t, (n.noTransition || !r.config.transition_duration) && (n.withoutTransition = !0), n.range = this.scaleExtent((r.orgXScale || t).range());
	}
	return e.prototype.getSizeFor1Char = function(e, t, n) {
		n === void 0 && (n = !0);
		var r = {
			w: 5.5,
			h: 11.5
		};
		return this.charSize[e] && n ? this.charSize[e] : (!t.empty() && t.text("0").call(function(e) {
			try {
				var t = vp(e.node(), !0), n = t.width, i = t.height;
				n && i && (r.w = n, r.h = i);
			} finally {
				e.text("");
			}
		}), this.charSize[e] = r, r);
	}, e.prototype.getTickTransformSetter = function(e) {
		var t = this.config, n = e === "x" ? function(e) {
			return `translate(${e + t.tickOffset},0)`;
		} : function(e) {
			return `translate(0,${e})`;
		};
		return function(e, t) {
			e.attr("transform", function(e) {
				var r = t(e);
				return G(e) ? n(r) : null;
			});
		};
	}, e.prototype.scaleExtent = function(e) {
		var t = e[0], n = e[e.length - 1];
		return t < n ? [t, n] : [n, t];
	}, e.prototype.generateTicks = function(e, t) {
		var n = this.owner.params.tickStepSize, r = e.domain(), i = r[0], a = r[1], o = [];
		if (t && n) for (var s = Math.round(i); s <= a;) o.push(s), s += n;
		else if (e.ticks) {
			var c = this.config.tickArguments;
			if (e.type === "log" && !c) {
				var l = Vm("_log").domain([i > 0 ? i : 1, a]).range(e.range());
				o = l.ticks();
				for (var u = a.toFixed().length; o.length > 15; u--) o = l.ticks(u);
				o.splice(0, 1, i), o.splice(o.length - 1, 1, a);
			} else o = e.ticks.apply(e, this.config.tickArguments || []);
			o = o.map(function(e) {
				return q(e) && J(e) && !isNaN(e) && Math.round(e * 10) / 10 || e;
			});
		}
		return o;
	}, e.prototype.copyScale = function() {
		var e = this.scale.copy();
		return e.domain().length || e.domain(this.scale.domain()), e.type = this.scale.type, e;
	}, e.prototype.textFormatted = function(e) {
		var t = this.config.tickFormat, n = /\d+\.\d+0{5,}\d$/.test(e) ? +String(e).replace(/0+\d$/, "") : e, r = t ? t(n) : n;
		return Y(r) ? r : "";
	}, e.prototype.transitionise = function(e) {
		var t = this.config, n = e;
		if (t.withoutTransition) n = e.interrupt();
		else if (t.transition || !this.owner.params.noTransition) try {
			n = e.transition(t.transition);
		} catch {}
		return n;
	}, e;
}(), Wh = function() {
	function e(e) {
		e === void 0 && (e = {});
		var t = {
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
		t.tickLength = Math.max(t.innerTickSize, 0) + t.tickPadding, this.config = t, this.params = e, this.helper = new Uh(this);
	}
	return e.prototype.create = function(e) {
		var t = this, n = t.config, r = t.helper, i = t.params, a = r.scale, o = n.orient, s = this.splitTickText.bind(t), c = /^(left|right)$/.test(o), l = /^(top|bottom)$/.test(o), u = r.getTickTransformSetter(l ? "x" : "y"), d = u === r.axisX ? "y" : "x", f = /^(top|left)$/.test(o) ? -1 : 1, p = i.tickTextRotate;
		this.config.range = a.rangeExtent ? a.rangeExtent() : r.scaleExtent((i.orgXScale || a).range());
		var m = n.innerTickSize, h = n.tickLength, g = n.range, _ = i.id, v = _ && /^(x|y|y2)$/.test(_) ? i.config[`axis_${_}_tick_text_position`] : {
			x: 0,
			y: 0
		}, y = _ === "subX" ? "subchart_axis_x" : `axis_${_}`, b = i.config[`${y}_show`], x = {
			tick: b ? i.config[`${y}_tick_show`] : !1,
			text: b ? i.config[`${y}_tick_text_show`] : !1
		}, S = i.config.axis_evalTextSize, C;
		e.each(function() {
			var e = M(this), y = this.__chart__ || a, b = r.copyScale();
			C = e, this.__chart__ = b, n.tickOffset = i.isCategory ? (b(1) - b(0)) / 2 : 0;
			var w = e.selectAll(".domain").data([0]);
			if (w.enter().append("path").attr("class", "domain").merge(w).attr("d", function() {
				var e = n.outerTickSize * f;
				return l ? `M${g[0]},${e}V0H${g[1]}V${e}` : `M${e},${g[0]}H0V${g[1]}H${e}`;
			}), x.tick || x.text) {
				var T = n.tickValues || r.generateTicks(b, c || i.config.axis_rotated);
				t.generatedTicks = T;
				var E = e.selectAll(".tick").data(T, b), D = E.enter().insert("g", ".domain").attr("class", "tick"), O = E.exit().remove();
				E = D.merge(E), x.tick && D.append("line"), x.text && D.append("text");
				var k = E.select("text"), ee = [], A = {
					w: 0,
					h: 0
				};
				K(S) && (A = S.bind(t.params.owner.api)(k.node(), _), this.classList.contains(I.dummy) && (this.sizeFor1Char = A)), A && A.w !== 0 && A.h !== 0 || (A = t.helper.getSizeFor1Char(o, k, !!S));
				var te = k.selectAll("tspan").data(function(e, t) {
					var n = i.tickMultiline ? s(e, b, T, c, A.w) : X(r.textFormatted(e)) ? r.textFormatted(e).concat() : [r.textFormatted(e)];
					return ee[t] = n.length, n.map(function(e) {
						return {
							index: t,
							splitted: e
						};
					});
				});
				te.exit().remove(), te = te.enter().append("tspan").merge(te).text(function(e) {
					return e.splitted;
				}), te.attr("x", l ? 0 : h * f).attr("dx", (function() {
					var e = 0;
					return /(top|bottom)/.test(o) && p && (e = 8 * Math.sin(p / 180 * Math.PI) * (o === "top" ? -1 : 1)), e + (v.x || 0);
				})()).attr("dy", function(e, t) {
					var n = ".71em", r = 0;
					return o !== "top" && (r = A.h, t === 0 && (r = c ? -((ee[e.index] - 1) * (A.h / 2) - 3) : v.y === 0 ? n : 0)), J(r) && v.y ? r + v.y : r || n;
				});
				var j = E.select("line"), ne = E.select("text");
				if (D.select("line").attr(`${d}2`, m * f), D.select("text").attr(d, h * f), t.setTickLineTextPosition(j, ne, A), i.tickTitle) {
					var re = ne.select("title");
					(re.empty() ? ne.append("title") : re).text(function(e) {
						return i.tickTitle[e];
					});
				}
				if (b.bandwidth) {
					var ie = b, ae = ie.bandwidth() / 2;
					y = function(e) {
						return ie(e) + ae;
					}, b = y;
				} else y.bandwidth ? y = b : u(O, b);
				E = i.owner.state.flowing ? r.transitionise(E) : i.owner.$T(E), u(D, y), u(E.style("opacity", null), b);
			}
		}), this.g = C;
	}, e.prototype.getGeneratedTicks = function(e) {
		var t = this.generatedTicks?.length - 1, n = this.generatedTicks;
		if (t > e) {
			var r = Math.round(t / e + .1);
			n = this.generatedTicks.map(function(e, t) {
				return t % r === 0 ? e : null;
			}).filter(function(e) {
				return e !== null;
			}).splice(0, e);
		}
		return n;
	}, e.prototype.getTickXY = function() {
		var e = this.config, t = {
			x: 0,
			y: 0
		};
		return this.params.isCategory && (t.x = e.tickCentered ? 0 : e.tickOffset, t.y = e.tickCentered ? e.tickOffset : 0), t;
	}, e.prototype.getTickSize = function(e) {
		var t = this.helper.scale, n = this.config, r = n.innerTickSize, i = n.range, a = t(e) + (n.tickCentered ? 0 : n.tickOffset);
		return i[0] < a && a < i[1] ? r : 0;
	}, e.prototype.setTickLineTextPosition = function(e, t, n) {
		var r = this, i = this.getTickXY(), a = this.config, o = a.innerTickSize, s = a.orient, c = a.tickLength, l = a.tickOffset, u = this.params.id, d = this.params.tickTextRotate, f = 6, p = n.h / 2 - f, m = function(e) {
			var t = ["start", "end"];
			return s === "top" && t.reverse(), e ? t[e > 0 ? 0 : 1] : "middle";
		}, h = function(e) {
			return e ? `rotate(${e})` : null;
		}, g = function(e) {
			var t = e / (s === "bottom" ? 15 : 23);
			return e ? 11.5 - 2.5 * t * (e > 0 ? 1 : -1) : c;
		}, _ = this.params.owner.config, v = _.axis_rotated, y = _.axis_x_tick_text_inner, b = this.params.config[`axis_${u}_tick_inner`];
		switch (s) {
			case "bottom":
				e.attr("x1", i.x).attr("x2", i.x).attr("y2", function(e) {
					return r.getTickSize.bind(r)(e) * (b ? -1 : 1);
				}), t.attr("x", 0).attr("y", g(d)).style("text-anchor", m(d)).style("text-anchor", function(e, t, n) {
					var r = n.length;
					return !v && t === 0 && (y === !0 || y.first) ? "start" : !v && t === r - 1 && (y === !0 || y.last) ? "end" : m(d);
				}).attr("transform", h(d));
				break;
			case "top":
				e.attr("x2", 0).attr("y2", b ? o : -o), t.attr("x", 0).attr("y", -(g(d) + p + f)).style("text-anchor", m(d)).attr("transform", h(d));
				break;
			case "left":
				e.attr("x2", b ? o : -o).attr("y1", i.y).attr("y2", i.y), t.attr("x", -c).attr("y", l + (v ? p / 4 : p)).style("text-anchor", "end");
				break;
			case "right": e.attr("x2", b ? -o : o).attr("y2", 0), t.attr("x", c).attr("y", p).style("text-anchor", "start");
		}
	}, e.prototype.splitTickText = function(e, t, n, r, i) {
		var a = this.params, o = this.helper.textFormatted(e), s = q(o) && o.indexOf("\n") > -1 ? o.split("\n") : [];
		if (s.length) return s;
		if (X(o)) return o;
		var c = a.tickWidth;
		(!c || c <= 0) && (c = r ? 95 : a.isCategory ? (a.isInverted ? t(n[0]) - t(n[1]) : t(n[1]) - t(n[0])) - 12 : 110);
		function l(e, t) {
			for (var n, r, a, o = 1; o < t.length; o++) if (t.charAt(o) === " " && (r = o), n = t.substr(0, o + 1), a = i * n.length, c < a) return l(e.concat(t.substr(0, r || o)), t.slice(r ? r + 1 : o));
			return e.concat(t);
		}
		return l(s, String(o));
	}, e.prototype.scale = function(e) {
		return arguments.length ? (this.helper.scale = e, this) : this.helper.scale;
	}, e.prototype.orient = function(e) {
		return arguments.length ? (this.config.orient = e in {
			top: 1,
			right: 1,
			bottom: 1,
			left: 1
		} ? String(e) : "bottom", this) : this.config.orient;
	}, e.prototype.tickFormat = function(e) {
		var t = this.config;
		return arguments.length ? (t.tickFormat = e, this) : t.tickFormat;
	}, e.prototype.tickCentered = function(e) {
		var t = this.config;
		return arguments.length ? (t.tickCentered = e, this) : t.tickCentered;
	}, e.prototype.tickOffset = function() {
		return this.config.tickOffset;
	}, e.prototype.tickInterval = function(e) {
		var t = this.config, n = t.outerTickSize, r = t.tickOffset, i = t.tickValues, a;
		if (this.params.isCategory) a = r * 2;
		else {
			var o = this.params.owner.scale.zoom ?? this.helper.scale;
			a = (this.g.select("path.domain").node().getTotalLength() - n * 2) / (e || this.g.selectAll("line").size());
			var s = i ? i.map(function(e, t, n) {
				var r = t + 1;
				return r < n.length ? o(n[r]) - o(e) : null;
			}).filter(Boolean) : [];
			a = Math.min.apply(Math, Xd(Xd([], s, !1), [a], !1));
		}
		return a === Infinity ? 0 : a;
	}, e.prototype.ticks = function() {
		var e = [...arguments], t = this.config;
		return e.length ? (t.tickArguments = Ep(e), this) : t.tickArguments;
	}, e.prototype.tickCulling = function(e) {
		var t = this.config;
		return arguments.length ? (t.tickCulling = e, this) : t.tickCulling;
	}, e.prototype.tickValues = function(e) {
		var t = this, n = this.config;
		if (K(e)) n.tickValues = function() {
			return e(t.helper.scale.domain());
		};
		else {
			if (!arguments.length) return n.tickValues;
			n.tickValues = e;
		}
		return this;
	}, e.prototype.setTransition = function(e) {
		return this.config.transition = e, this;
	}, e;
}(), Gh = { getAxisInstance: function() {
	return this.axis || new Kh(this);
} }, Kh = function() {
	function e(e) {
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
	return e.prototype.getAxisClassName = function(e) {
		return `${Qd.axis} ${Qd[`axis${wp(e)}`]}`;
	}, e.prototype.isHorizontal = function(e, t) {
		var n = e.config.axis_rotated;
		return t ? n : !n;
	}, e.prototype.isCategorized = function() {
		var e = this.owner, t = e.config, n = e.state;
		return t.axis_x_type.indexOf("category") >= 0 || n.hasRadar;
	}, e.prototype.isCustomX = function() {
		var e = this.owner.config;
		return !this.isTimeSeries() && (e.data_x || cp(e.data_xs));
	}, e.prototype.isTimeSeries = function(e) {
		return e === void 0 && (e = "x"), this.owner.config[`axis_${e}_type`] === "timeseries";
	}, e.prototype.isLog = function(e) {
		return e === void 0 && (e = "x"), this.owner.config[`axis_${e}_type`] === "log";
	}, e.prototype.isTimeSeriesY = function() {
		return this.isTimeSeries("y");
	}, e.prototype.getAxisType = function(e) {
		e === void 0 && (e = "x");
		var t = "linear";
		return this.isTimeSeries(e) ? t = this.owner.config.axis_x_localtime ? "time" : "utc" : this.isLog(e) && (t = "log"), t;
	}, e.prototype.getExtent = function() {
		var e = this.owner, t = e.config, n = e.scale, r = t.axis_x_extent;
		if (r) {
			if (K(r)) r = r.bind(e.api)(e.getXDomain(e.data.targets), n.subX);
			else if (this.isTimeSeries() && r.every(isNaN)) {
				var i = Bp.bind(e);
				r = r.map(function(e) {
					return n.subX(i(e));
				});
			}
		}
		return r;
	}, e.prototype.init = function() {
		var e = this, t = this.owner, n = t.config, r = t.$el, i = r.main, a = r.axis, o = t.state.clip, s = ["x", "y"];
		n.axis_y2_show && s.push("y2"), s.forEach(function(r) {
			var s = e.getAxisClassName(r);
			a[r] = i.append("g").attr("class", s).attr("clip-path", function() {
				var e = null;
				return r === "x" ? e = o.pathXAxis : r === "y" && (e = o.pathYAxis), e;
			}).attr("transform", t.getTranslate(r)).style("visibility", n[`axis_${r}_show`] ? null : "hidden"), e.generateAxes(r);
		});
	}, e.prototype.setOrient = function() {
		var e = this.owner.config, t = e.axis_rotated, n = e.axis_y_inner, r = e.axis_y2_inner;
		this.orient = {
			x: t ? "left" : "bottom",
			y: t ? n ? "top" : "bottom" : n ? "right" : "left",
			y2: t ? r ? "bottom" : "top" : r ? "left" : "right",
			subX: t ? "left" : "bottom"
		};
	}, e.prototype.generateAxes = function(e) {
		var t = this.owner, n = t.config, r = [], i = n[`axis_${e}_axes`], a = n.axis_rotated, o;
		e === "x" ? o = a ? ed : $u : e === "y" ? o = a ? $u : ed : e === "y2" && (o = a ? Zu : Qu), i.length && i.forEach(function(n) {
			var i = n.tick || {}, a = t.scale[e].copy();
			n.domain && a.domain(n.domain), r.push(o(a).ticks(i.count).tickFormat(K(i.format) ? i.format.bind(t.api) : (function(e) {
				return e;
			})).tickValues(i.values).tickSizeOuter(i.outer === !1 ? 0 : 6));
		}), this.axesList[e] = r;
	}, e.prototype.updateAxes = function() {
		var e = this, t = this.owner, n = t.config, r = t.$el.main, i = t.$T;
		Object.keys(this.axesList).forEach(function(a) {
			var o = n[`axis_${a}_axes`], s = t.scale[a].copy(), c = s.range();
			e.axesList[a].forEach(function(l, u) {
				var d = l.scale().range();
				c.every(function(e, t) {
					return e === d[t];
				}) || l.scale().range(c);
				var f = `${e.getAxisClassName(a)}-${u + 1}`, p = r.select(`.${f.replace(/\s/, ".")}`);
				p.empty() ? p = r.append("g").attr("class", f).style("visibility", n[`axis_${a}_show`] ? null : "hidden").call(l) : (o[u].domain && s.domain(o[u].domain), i(p).call(l.scale(s))), p.attr("transform", t.getTranslate(a, u + 1));
			});
		});
	}, e.prototype.setAxis = function(e, t, n, r) {
		var i = this.owner;
		e !== "subX" && (this.tick[e] = this.getTickValues(e)), this[e] = this.getAxis(e, t, n, e === "x" && (i.scale.zoom || i.config.subchart_show || i.state.resizing) ? !0 : r);
	}, e.prototype.getAxis = function(e, t, n, r, i) {
		var a = this.owner, o = a.config, s = /^(x|subX)$/.test(e), c = s ? "x" : e, l = s && this.isCategorized(), u = this.orient[e], d = i ? 0 : a.getAxisTickRotate(c), f;
		if (s) f = e === "subX" ? a.format.subXAxisTick : a.format.xAxisTick;
		else {
			var p = o[`axis_${e}_tick_format`];
			K(p) && (f = p.bind(a.api));
		}
		var m = this.tick[c], h = Pp({
			outerTick: n,
			noTransition: r,
			config: o,
			id: e,
			tickTextRotate: d,
			owner: a
		}, s && {
			isCategory: l,
			isInverted: o.axis_x_inverted,
			tickMultiline: o.axis_x_tick_multiline,
			tickWidth: o.axis_x_tick_width,
			tickTitle: l && o.axis_x_tick_tooltip && a.api.categories(),
			orgXScale: a.scale.x
		});
		s || (h.tickStepSize = o[`axis_${c}_tick_stepSize`]);
		var g = new Wh(h).scale(s && a.scale.zoom || t).orient(u);
		if (s && this.isTimeSeries() && m && !K(m)) {
			var _ = Bp.bind(a);
			m = m.map(function(e) {
				return _(e);
			});
		} else !s && this.isTimeSeriesY() && (g.ticks(o.axis_y_tick_time_value), m = null);
		m && g.tickValues(m), g.tickFormat(f || !s && a.isStackNormalized() && a.hasAxisGroupedData(e) && (function(e) {
			return `${e}%`;
		})), l && (g.tickCentered(o.axis_x_tick_centered), sp(o.axis_x_tick_culling) && (o.axis_x_tick_culling = !1));
		var v = o[`axis_${c}_tick_count`];
		return v && g.ticks(v), g;
	}, e.prototype.updateXAxisTickValues = function(e, t) {
		var n, r = this.owner, i = r.config, a = i.axis_x_tick_fit, o = i.axis_x_tick_count, s;
		return (a || o && a) && (s = r.mapTargetsToUniqueXs(e), this.isCategorized() && o > s.length && (o = s.length), s = this.generateTickValues(s, o, this.isTimeSeries())), t ? t.tickValues(s) : this.x && (this.x.tickValues(s), (n = this.subX) == null || n.tickValues(s)), s;
	}, e.prototype.getId = function(e) {
		var t = this.owner, n = t.config, r = t.scale, i = n.data_axes[e];
		return i && r[i] || (i = "y"), i;
	}, e.prototype.getXAxisTickFormat = function(e) {
		var t = this.owner, n = t.config, r = t.format, i = e && n.subchart_axis_x_tick_format || n.axis_x_tick_format, a = this.isTimeSeries(), o = this.isCategorized(), s;
		return i ? K(i) ? s = i.bind(t.api) : a && (s = function(e) {
			return e ? r.axisTime(i)(e) : "";
		}) : s = a ? r.defaultAxisTime : o ? t.categoryName : function(e) {
			return e < 0 ? e.toFixed(0) : e;
		}, K(s) ? function(e) {
			return s.apply(t, o ? [e, t.categoryName(e)] : [e]);
		} : s;
	}, e.prototype.getTickValues = function(e) {
		var t = this.owner, n = t.config[`axis_${e}_tick_values`], r = t[`${e}Axis`];
		return (K(n) ? n.call(t.api) : n) || (r ? r.tickValues() : void 0);
	}, e.prototype.getLabelOptionByAxisId = function(e) {
		return this.owner.config[`axis_${e}_label`];
	}, e.prototype.getLabelText = function(e) {
		var t = this.getLabelOptionByAxisId(e);
		return q(t) ? t : t ? t.text : null;
	}, e.prototype.setLabelText = function(e, t) {
		var n = this.owner.config, r = this.getLabelOptionByAxisId(e);
		q(r) ? n[`axis_${e}_label`] = t : r && (r.text = t);
	}, e.prototype.getLabelPosition = function(e, t) {
		var n = this.owner.config.axis_rotated, r = this.getLabelOptionByAxisId(e), i = ap(r) && r.position ? r.position : t[+!n], a = function(e) {
			return !!~i.indexOf(e);
		};
		return {
			isInner: a("inner"),
			isOuter: a("outer"),
			isLeft: a("left"),
			isCenter: a("center"),
			isRight: a("right"),
			isTop: a("top"),
			isMiddle: a("middle"),
			isBottom: a("bottom")
		};
	}, e.prototype.getAxisLabelPosition = function(e) {
		return this.getLabelPosition(e, e === "x" ? ["inner-top", "inner-right"] : ["inner-right", "inner-top"]);
	}, e.prototype.getLabelPositionById = function(e) {
		return this.getAxisLabelPosition(e);
	}, e.prototype.xForAxisLabel = function(e) {
		var t = this.owner, n = t.state, r = n.width, i = n.height, a = this.getAxisLabelPosition(e), o = a.isMiddle ? -i / 2 : 0;
		return this.isHorizontal(t, e !== "x") ? o = a.isLeft ? 0 : a.isCenter ? r / 2 : r : a.isBottom && (o = -i), o;
	}, e.prototype.textAnchorForAxisLabel = function(e) {
		var t = this.owner, n = this.getAxisLabelPosition(e), r = n.isMiddle ? "middle" : "end";
		return this.isHorizontal(t, e !== "x") ? r = n.isLeft ? "start" : n.isCenter ? "middle" : "end" : n.isBottom && (r = "start"), r;
	}, e.prototype.dxForAxisLabel = function(e) {
		var t = this.owner, n = this.getAxisLabelPosition(e), r = n.isBottom ? "0.5em" : "0";
		return this.isHorizontal(t, e !== "x") ? r = n.isLeft ? "0.5em" : n.isRight ? "-0.5em" : "0" : n.isTop && (r = "-0.5em"), r;
	}, e.prototype.dyForAxisLabel = function(e) {
		var t = this.owner, n = t.config, r = n.axis_rotated, i = this.getAxisLabelPosition(e).isInner, a = n[`axis_${e}_tick_rotate`] ? t.getHorizontalAxisHeight(e) : 0, o = this.getMaxTickSize(e).width, s;
		if (e === "x") {
			var c = n.axis_x_height;
			s = r ? i ? "1.2em" : -25 - o : i ? "-0.5em" : c ? c - 10 : a ? a - 10 : "3em";
		} else s = {
			y: [
				"-0.5em",
				10,
				"3em",
				"1.2em",
				10
			],
			y2: [
				"1.2em",
				-20,
				"-2.2em",
				"-0.5em",
				15
			]
		}[e], s = r ? i ? s[0] : a ? a * (e === "y2" ? -1 : 1) - s[1] : s[2] : i ? s[3] : (s[4] + (n[`axis_${e}_inner`] ? 0 : o + s[4])) * (e === "y" ? -1 : 1);
		return s;
	}, e.prototype.getMaxTickSize = function(e, t) {
		var n = this.owner, r = n.config, i = n.state, a = i.current, o = i.resizing, s = n.$el, c = s.svg, l = s.chart, u = a.maxTickSize[e], d = `axis_${e}`, f = {
			width: 0,
			height: 0
		};
		if (o || t || !r[`${d}_show`] || u.width > 0 && n.filterTargetsToShow().length === 0) return u;
		if (c) {
			var p = /^y2?$/.test(e), m = n.filterTargetsToShow(n.data.targets), h = n.scale[e].copy().domain(n[`get${p ? "Y" : "X"}Domain`](m, e)), g = h.domain(), _ = g[0] === g[1] && g.every(function(e) {
				return e > 0;
			}), v = X(u.domain) && u.domain[0] === u.domain[1] && u.domain.every(function(e) {
				return e > 0;
			});
			if (_ || v) return u.size;
			u.domain = g, p || u.ticks.splice(0);
			var y = this.getAxis(e, h, !1, !1, !0), b = r[`${d}_tick_rotate`], x = r[`${d}_tick_count`];
			!r[`${d}_tick_values`] && x && y.tickValues(this.generateTickValues(g, x, p ? this.isTimeSeriesY() : this.isTimeSeries())), !p && this.updateXAxisTickValues(m, y);
			var S = l.append("svg").style("visibility", "hidden").style("position", "fixed").style("top", "0").style("left", "0"), C = S.append("g").attr("class", `${Qd[`axis${wp(e)}`]} ${I.dummy}`);
			y.create(C);
			var w = C.node().sizeFor1Char;
			S.selectAll("text").attr("transform", J(b) ? `rotate(${b})` : null).each(function(e, t) {
				var n = w ? {
					width: this.textContent.length * w.w,
					height: w.h
				} : _p(this, !0), r = n.width, i = n.height;
				f.width = Math.max(f.width, r), f.height = Math.max(f.height, i), p || (u.ticks[t] = r);
			}), S.remove();
		}
		return Object.keys(f).forEach(function(e) {
			f[e] > 0 && (u[e] = f[e]);
		}), u;
	}, e.prototype.getXAxisTickTextY2Overflow = function(e) {
		var t = this.owner, n = t.axis, r = t.config, i = t.state, a = i.current, o = i.isLegendRight, s = i.legendItemWidth, c = t.getAxisTickRotate("x"), l = c > 0 && c < 90;
		if ((n.isCategorized() || n.isTimeSeries()) && r.axis_x_tick_fit && (!r.axis_x_tick_culling || sp(r.axis_x_tick_culling)) && !r.axis_x_tick_multiline && l) {
			var u = r.axis_y2_show && a.maxTickSize.y2.width || 0, d = o && s || 0, f = a.width - t.getCurrentPaddingByDirection("left"), p = this.getXAxisTickMaxOverflow(c, f - e) - u - d, m = Math.max(0, p) + e;
			return Math.min(m, f / 2);
		}
		return 0;
	}, e.prototype.getXAxisTickMaxOverflow = function(e, t) {
		for (var n = this.owner, r = n.axis, i = n.config, a = n.state, o = r.isTimeSeries(), s = a.current.maxTickSize.x.ticks, c = s.length, l = a.axis.x.padding, u = l.left, d = l.right, f = 0, p = c - (o && i.axis_x_tick_fit ? .5 : 0), m = 0; m < c; m++) {
			var h = m + 1, g = Math.cos(Math.PI * e / 180) * s[m], _ = h - (o ? 1 : .5) + u;
			if (!(_ <= 0)) {
				var v = (t - g) / _, y = p - h, b = d * v, x = y * v + b, S = g - v / 2 - x;
				f = Math.max(f, S);
			}
		}
		var C = n.filterTargetsToShow(n.data.targets), w = 0;
		if (!o && i.axis_x_tick_count <= C.length && C[0].values.length) {
			var T = Vm(n.axis.getAxisType("x"), 0, t - f).domain([u * -1, n.getXDomainMax(n.data.targets) + 1 + d]);
			w = (T(1) - T(0)) / 2;
		}
		return f + w;
	}, e.prototype.updateLabels = function(e) {
		var t = this, n = this.owner, r = n.config, i = n.$el.main, a = n.$T, o = r.axis_rotated;
		[
			"x",
			"y",
			"y2"
		].forEach(function(n) {
			var r = t.getLabelText(n), s = `axis${wp(n)}`, c = Qd[`${s}Label`];
			if (r) {
				var l = i.select(`text.${c}`);
				l.empty() && (l = i.select(`g.${Qd[s]}`).insert("text", ":first-child").attr("class", c).attr("transform", ["rotate(-90)", null][n === "x" ? +!o : +o]).style("text-anchor", function() {
					return t.textAnchorForAxisLabel(n);
				})), a(l, e).attr("x", function() {
					return t.xForAxisLabel(n);
				}).attr("dx", function() {
					return t.dxForAxisLabel(n);
				}).attr("dy", function() {
					return t.dyForAxisLabel(n);
				}).text(r);
			}
		});
	}, e.prototype.getPadding = function(e, t, n, r) {
		var i = J(e) ? e : e[t];
		return G(i) ? this.owner.convertPixelToScale(/(bottom|top)/.test(t) ? "y" : "x", i, r) : n;
	}, e.prototype.generateTickValues = function(e, t, n) {
		var r = e;
		if (t) {
			var i = K(t) ? t() : t;
			if (i === 1) r = [e[0]];
			else if (i === 2) r = [e[0], e[e.length - 1]];
			else if (i > 2) {
				var a = this.isCategorized(), o = i - 2, s = e[0], c = e[e.length - 1], l = (c - s) / (o + 1), u = void 0;
				r = [s];
				for (var d = 0; d < o; d++) u = +s + l * (d + 1), r.push(n ? new Date(u) : a ? Math.round(u) : u);
				r.push(c);
			}
		}
		return n || (r = r.sort(function(e, t) {
			return e - t;
		})), r;
	}, e.prototype.generateTransitions = function(e) {
		var t = this.owner, n = t.$el.axis, r = t.$T, i = [
			"x",
			"y",
			"y2",
			"subX"
		].map(function(t) {
			return r(n[t], e);
		});
		return {
			axisX: i[0],
			axisY: i[1],
			axisY2: i[2],
			axisSubX: i[3]
		};
	}, e.prototype.redraw = function(e, t, n) {
		var r = this, i = this.owner, a = i.config, o = i.state, s = i.$el, c = t ? "0" : null;
		[
			"x",
			"y",
			"y2",
			"subX"
		].forEach(function(t) {
			var i = r[t], o = s.axis[t];
			i && o && (!n && !a.transition_duration && (i.config.withoutTransition = !0), o.style("opacity", c), i.create(e[`axis${wp(t)}`]));
		}), this.updateAxes(), !o.rendered && a.axis_tooltip && this.setAxisTooltip();
	}, e.prototype.redrawAxis = function(e, t, n, r, i) {
		var a = this, o, s, c, l = this.owner, u = l.config, d = l.scale, f = l.$el, p = !!d.zoom, m;
		!p && this.isCategorized() && e.length === 0 && d.x.domain([0, f.axis.x.selectAll(".tick").size()]), d.x && e.length ? (!p && l.updateXDomain(e, t.UpdateXDomain, t.UpdateOrgXDomain, t.TrimXDomain), u.axis_x_tick_values || this.updateXAxisTickValues(e)) : this.x && (this.x.tickValues([]), (o = this.subX) == null || o.tickValues([])), u.zoom_rescale && !r && (m = d.x.orgDomain()), ["y", "y2"].forEach(function(t) {
			var n = `axis_${t}_`, r = d[t];
			if (r) {
				var i = u[`${n}tick_values`], o = u[`${n}tick_count`];
				if (r.domain(l.getYDomain(e, t, m)), !i && o) {
					var s = l.axis[t], c = r.domain();
					s.tickValues(a.generateTickValues(c, c.every(function(e) {
						return e === 0;
					}) ? 1 : o, a.isTimeSeriesY()));
				}
			}
		}), this.redraw(n, l.hasArcType(), i), this.updateLabels(t.Transition), (t.UpdateXDomain || t.UpdateXAxis || t.Y) && e.length && this.setCulling(), t.Y && ((s = d.subY) == null || s.domain(l.getYDomain(e, "y")), (c = d.subY2) == null || c.domain(l.getYDomain(e, "y2")));
	}, e.prototype.setCulling = function() {
		var e = this.owner, t = e.config, n = e.state, r = n.clip, i = n.current, a = e.$el;
		[
			"subX",
			"x",
			"y",
			"y2"
		].forEach(function(e) {
			var n = a.axis[e], o = `axis_${e === "subX" ? "x" : e}_tick_culling`, s = t[o];
			if (n && s) {
				var c = n.selectAll(".tick"), l = Fp(c.data(), !t[`${o}_reverse`]), u = l.length, d = t[`${o}_max`], f = t[`${o}_lines`], p;
				if (u) {
					for (var m = 1; m < u; m++) if (u / m < d) {
						p = m;
						break;
					}
					c.each(function(e) {
						var t = f ? this.querySelector("text") : this;
						t && (t.style.display = l.indexOf(e) % p ? "none" : null);
					});
				} else c.style("display", null);
				if (e === "x") {
					var h = i.maxTickSize.x.clipPath ? r.pathXAxisTickTexts : null;
					a.svg.selectAll(`.${Qd.axisX} .tick text`).attr("clip-path", h);
				}
			}
		});
	}, e.prototype.setAxisTooltip = function() {
		var e = this.owner, t = e.config, n = t.axis_rotated, r = t.axis_tooltip, i = e.$el, a = i.axis, o = i.axisTooltip, s = r.backgroundColor ?? "black";
		e.generateTextBGColorFilter(s, {
			x: -.15,
			y: -.2,
			width: 1.3,
			height: 1.3
		}), [
			"x",
			"y",
			"y2"
		].forEach(function(t) {
			var r, i;
			if (q(s) || s[t]) {
				if (o[t] = a[t]?.append("text").classed(Qd[`axis${t.toUpperCase()}Tooltip`], !0).attr("filter", e.updateTextBGColor({ id: t }, s)), n) {
					var c = t === "x" ? "x" : "y", l = t === "y" ? "1.15em" : t === "x" ? "-0.3em" : "-0.4em";
					(r = o[t]) == null || r.attr(c, l).attr(`d${t === "x" ? "y" : "x"}`, t === "x" ? "0.4em" : "-1.3em").style("text-anchor", t === "x" ? "end" : null);
				} else {
					var c = t === "x" ? "y" : "x", l = t === "x" ? "1.15em" : `${t === "y" ? "-" : ""}0.4em`;
					(i = o[t]) == null || i.attr(c, l).attr(`d${t === "x" ? "x" : "y"}`, t === "x" ? "-1em" : "0.3em").style("text-anchor", t === "y" ? "end" : null);
				}
			}
		});
	}, e;
}(), qh = {
	initEventRect: function() {
		this.$el.main.select(`.${I.chart}`).append("g").attr("class", cf.eventRects).style("fill-opacity", "0");
	},
	redrawEventRect: function() {
		var e, t = this, n = t.config, r = t.state, i = t.$el, a = t.isMultipleX(), o = n.axis_x_inverted;
		if (i.eventRect) t.updateEventRect(i.eventRect, !0);
		else if (t.data.targets.length) {
			var s = t.$el.main.select(`.${cf.eventRects}`).style("cursor", n.zoom_enabled && n.zoom_type !== "drag" ? n.axis_rotated ? "ns-resize" : "ew-resize" : null).classed(cf.eventRectsMultiple, a).classed(cf.eventRectsSingle, !a).selectAll(`.${cf.eventRect}`).data([0]).enter().append("rect");
			t.updateEventRect(s), t.updateEventType(s), s.call(t.getDraggableSelection()), i.eventRect = s, t.state.inputType === "touch" && !i.svg.on("touchstart.eventRect") && !t.hasArcType() && t.bindTouchOnEventRect(), r.rendered && t.updateEventRect(i.eventRect, !0);
		}
		if (!a) {
			var c = t.getMaxDataCountTarget();
			(!n.data_xSort || o) && c.sort(function(e, t) {
				return o ? t.x - e.x : e.x - t.x;
			}), t.updateDataIndexByX(c), t.updateXs(c), (e = t.updatePointClass) == null || e.call(t, !0), r.eventReceiver.data = c;
		}
		t.updateEventRectData();
	},
	bindTouchOnEventRect: function() {
		var e = this, t = e.config, n = e.state, r = e.$el, i = r.eventRect, a = r.svg, o = function(t) {
			if (e.isMultipleX()) e.selectRectForMultipleXs(t);
			else {
				var r = e.getDataIndexFromEvent(n.event);
				e.callOverOutForTouch(r), r === -1 ? e.unselectRect() : e.selectRectForSingle(t, r);
			}
		}, s = function() {
			e.unselectRect(), e.callOverOutForTouch();
		}, c = t.interaction_inputType_touch.preventDefault, l = tp(c) && c || !1, u = !isNaN(c) && c || null, d, f = !l && u === null, p = function(e) {
			var n = e.type, r = e.changedTouches[0][`client${t.axis_rotated ? "Y" : "X"}`];
			n === "touchstart" ? l ? e.preventDefault() : u !== null && (d = r) : n === "touchmove" && (l || d === !0 || u !== null && Math.abs(d - r) >= u) && (d = !0, e.preventDefault());
		};
		i.on("touchstart", function(t) {
			n.event = t, e.updateEventRect();
		}, { passive: f }).on("touchstart.eventRect touchmove.eventRect", function(t) {
			if (n.event = t, !i.empty() && i.classed(cf.eventRect)) {
				if (n.dragging || n.flowing || e.hasArcType() || t.touches.length > 1) return;
				p(t), o(i.node());
			} else s();
		}, { passive: f }).on("touchend.eventRect", function(t) {
			n.event = t, !i.empty() && i.classed(cf.eventRect) && (e.hasArcType() || !e.toggleShape || n.cancelClick) && (n.cancelClick &&= !1);
		}, { passive: f }), a.on("touchstart", function(e) {
			n.event = e;
			var t = e.target;
			t && t !== i.node() && s();
		}, { passive: f });
	},
	updateEventRect: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.state, i = n.$el, a = r.eventReceiver, o = r.width, s = r.height, c = r.rendered, l = r.resizing, u = e || i.eventRect;
		(!c || l || t) && (u.attr("x", 0).attr("y", 0).attr("width", o).attr("height", s), (!c || t) && u.classed(cf.eventRect, !0)), function() {
			if (a) {
				var e = kp(i.chart.node());
				a.rect = _p(u.node(), !0).toJSON(), a.rect.top += e.y, a.rect.left += e.x;
			}
		}();
	},
	updateEventType: function(e) {
		var t = this, n = tp(e), r = n ? t.$el.eventRect : e, i = n ? e !== r?.datum().multipleX : !1;
		r && (i && r?.on("mouseover mousemove mouseout click", null), t.isMultipleX() ? t.generateEventRectsForMultipleXs(r) : t.generateEventRectsForSingleX(r));
	},
	updateEventRectData: function() {
		var e = this, t = e.config, n = e.scale, r = e.state, i = n.zoom || n.x, a = t.axis_rotated, o = e.isMultipleX(), s, c, l, u;
		if (e.updateEventType(o), o) s = 0, c = 0, l = r.width, u = r.height;
		else {
			var d, f = void 0;
			if (e.axis.isCategorized()) d = e.getEventRectWidth(), f = function(e) {
				return i(e.x) - d / 2;
			};
			else {
				var p = function(t) {
					var n = t.index;
					return {
						prev: e.getPrevX(n),
						next: e.getNextX(n)
					};
				};
				d = function(e) {
					var t = p(e), n = i.domain(), o;
					return t.prev === null && t.next === null ? o = a ? r.height : r.width : t.prev === null ? o = (i(t.next) + i(e.x)) / 2 : t.next === null ? o = i(n[1]) - (i(t.prev) + i(e.x)) / 2 : (Object.keys(t).forEach(function(e, r) {
						t[e] = t[e] ?? n[r];
					}), o = Math.max(0, (i(t.next) - i(t.prev)) / 2)), o;
				}, f = function(e) {
					var t = p(e);
					return t.prev === null && t.next === null ? 0 : t.prev === null ? i(i.domain()[0]) : (i(e.x) + i(t.prev)) / 2;
				};
			}
			s = a ? 0 : f, c = a ? f : 0, l = a ? r.width : d, u = a ? d : r.height;
		}
		var m = r.eventReceiver, h = function(e, t) {
			return K(e) ? e(t) : e;
		};
		m.coords.splice(m.data.length), m.data.forEach(function(e, t) {
			m.coords[t] = {
				x: h(s, e),
				y: h(c, e),
				w: h(l, e),
				h: h(u, e)
			};
		});
	},
	selectRectForSingle: function(e, t) {
		var n, r, i = this, a = i.config, o = i.$el, s = o.main, c = o.circle, l = a.data_selection_enabled, u = a.data_selection_grouped, d = a.data_selection_isselectable, f = a.tooltip_grouped, p = i.getAllValuesOnIndex(t);
		if (!(f && (i.showTooltip(p, e), (n = i.showGridFocus) == null || n.call(i, p), !l || u))) {
			!c && s.selectAll(`.${I.EXPANDED}:not(.${H.shape}-${t})`).classed(I.EXPANDED, !1);
			var m = s.selectAll(`.${H.shape}-${t}`).classed(I.EXPANDED, !0).style("cursor", d ? "pointer" : null).filter(function(e) {
				return i.isWithinShape(this, e);
			});
			m.empty() && !f && a.interaction_onout && ((r = i.hideGridFocus) == null || r.call(i), i.hideTooltip(), !u && i.setExpand(t)), m.call(function(n) {
				var r, a, o = n.data();
				l && (u || d?.bind(i.api)(o)) && (e.style.cursor = "pointer"), f || (i.showTooltip(o, e), (r = i.showGridFocus) == null || r.call(i, o), (a = i.unexpandCircles) == null || a.call(i), n.each(function(e) {
					return i.setExpand(t, e.id);
				}));
			});
		}
	},
	selectRectForMultipleXs: function(e, t) {
		t === void 0 && (t = !0);
		var n = this, r = n.config, i = n.state, a = n.filterTargetsToShow(n.data.targets);
		if (!(i.dragging || n.hasArcType(a))) {
			var o = hp(i.event, e), s = n.findClosestFromTargets(a, o);
			if (t && i.mouseover && (!s || s.id !== i.mouseover.id) && (r.data_onout.call(n.api, i.mouseover), i.mouseover = void 0), !s) n.unselectRect();
			else {
				var c = (n.isBubbleType(s) || n.isScatterType(s) || !r.tooltip_grouped ? [s] : n.filterByX(a, s.x)).map(function(e) {
					return n.addName(e);
				});
				n.showTooltip(c, e), n.setExpand(s.index, s.id, !0), n.showGridFocus(c);
				var l = n.dist(s, o);
				(n.isBarType(s.id) || l < n.getPointSensitivity(s)) && (n.$el.svg.select(`.${cf.eventRect}`).style("cursor", "pointer"), t && (!i.mouseover || i.mouseover.x !== s.x || i.mouseover.id !== s.id) && (r.data_onover.call(n.api, s), i.mouseover = s));
			}
		}
	},
	unselectRect: function() {
		var e = this, t = e.$el, n = t.circle, r = t.tooltip;
		e.$el.svg.select(`.${cf.eventRect}`).style("cursor", null), e.hideGridFocus(), r && (e.hideTooltip(), e._handleLinkedCharts(!1)), n && !e.isPointFocusOnly() && e.unexpandCircles(), e.expandBarTypeShapes(!1);
	},
	generateEventRectsForSingleX: function(e) {
		var t = this, n = t.config, r = t.state, i = r.eventReceiver, a = e.style("cursor", n.data_selection_enabled && n.data_selection_grouped ? "pointer" : null).on("click", function(e) {
			r.event = e;
			var n = i.currentIdx, a = i.data[n === -1 ? t.getDataIndexFromEvent(e) : n];
			t.clickHandlerForSingleX.bind(this)(a, t);
		}).datum({ multipleX: !1 });
		if (r.inputType === "mouse") {
			var o = function(e) {
				var n = e ? t.getDataIndexFromEvent(e) : i.currentIdx;
				return n > -1 ? i.data[n] : null;
			};
			a.on("mouseover", function(e) {
				r.event = e, t.updateEventRect(), Object.values(t.$el.axisTooltip).forEach(function(e) {
					return e?.style("display", null);
				});
			}).on("mousemove", function(e) {
				var a = o(e);
				if (r.event = e, a) {
					var s = a.index, c = n.line_step_type;
					if (n.line_step_tooltipMatch && t.hasType("step") && /^step\-(before|after)$/.test(c)) {
						var l = t.scale.zoom || t.scale.x, u = t.axis.xs[s], d = l.invert(hp(e, this)[0]);
						c === "step-after" && d < u ? --s : c === "step-before" && d > u && (s += 1);
					}
					t.showAxisGridFocus();
					var f = n.tooltip_grouped && s === i.currentIdx;
					r.dragging || r.flowing || t.hasArcType() || f ? n.tooltip_show && f && t.setTooltipPosition() : (s !== i.currentIdx && (t.setOverOut(!1, i.currentIdx), i.currentIdx = s), s === -1 ? t.unselectRect() : t.selectRectForSingle(this, s), t.setOverOut(s !== -1, s));
				}
			}).on("mouseout", function(e) {
				r.event = e, n && !t.hasArcType() && i.currentIdx !== -1 && n.interaction_onout && (t.hideAxisGridFocus(), t.unselectRect(), t.setOverOut(!1, i.currentIdx), i.currentIdx = -1);
			});
		}
		return a;
	},
	clickHandlerForSingleX: function(e, t) {
		var n = t, r = n.config, i = n.state, a = n.$el.main;
		if (!e || n.hasArcType() || i.cancelClick) i.cancelClick &&= !1;
		else {
			var o = e.index;
			a.selectAll(`.${H.shape}-${o}`).each(function(e) {
				var t;
				(r.data_selection_grouped || n.isWithinShape(this, e)) && ((t = n.toggleShape) == null || t.call(n, this, e, o), r.data_onclick.bind(n.api)(e, this));
			});
		}
	},
	generateEventRectsForMultipleXs: function(e) {
		var t = this, n = t.config, r = t.state;
		e.on("click", function(e) {
			r.event = e, t.clickHandlerForMultipleXS.bind(this)(t);
		}).datum({ multipleX: !0 }), r.inputType === "mouse" && e.on("mouseover mousemove", function(e) {
			r.event = e, t.selectRectForMultipleXs(this);
		}).on("mouseout", function(e) {
			r.event = e, t.config && !t.hasArcType() && n.interaction_onout && t.unselectRect();
		});
	},
	clickHandlerForMultipleXS: function(e) {
		var t = e, n = t.config, r = t.state, i = t.filterTargetsToShow(t.data.targets);
		if (!t.hasArcType(i)) {
			var a = hp(r.event, this), o = t.findClosestFromTargets(i, a), s = t.getPointSensitivity(o);
			o && (t.isBarType(o.id) || t.dist(o, a) < s) && t.$el.main.selectAll(`.${H.shapes}${t.getTargetSelectorSuffix(o.id)}`).selectAll(`.${H.shape}-${o.index}`).each(function() {
				var e;
				(n.data_selection_grouped || t.isWithinShape(this, o)) && ((e = t.toggleShape) == null || e.call(t, this, o, o.index), n.data_onclick.bind(t.api)(o, this));
			});
		}
	}
}, Jh = {
	generateFlow: function(e) {
		var t = this, n = t.data, r = t.state, i = t.$el;
		return function() {
			var a = e.flow.length;
			r.flowing = !0, n.targets.forEach(function(e) {
				e.values.splice(0, a);
			}), t.updateXGrid && t.updateXGrid(!0);
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
			].forEach(function(e) {
				var t = e.split("."), n = i[t[0]];
				n && t.length > 1 && (n = n[t[1]]), n?.size() && (o[e] = n);
			}), t.hideGridFocus(), t.setFlowList(o, e);
		};
	},
	setFlowList: function(e, t) {
		var n = this, r = t.flow, i = t.targets, a = r.duration, o = a === void 0 ? t.duration : a, s = r.index, c = r.length, l = r.orgDataCount, u = n.getFlowTransform(i, l, s, c), d = cm(), f;
		d.add(Object.keys(e).map(function(t) {
			return f = e[t].transition().ease(js).duration(o), f = t === "axis.x" ? f.call(function(e) {
				n.axis.x.setTransition(e).create(e);
			}) : t === "region.list" ? f.filter(n.isRegionOnX).attr("transform", u) : f.attr("transform", u), f;
		})), f.call(d, function() {
			n.cleanUpFlow(e, t);
		});
	},
	cleanUpFlow: function(e, t) {
		var n = this, r = n.config, i = n.state, a = n.$el.svg, o = r.axis_rotated, s = t.flow, c = t.shape, l = t.xv, u = c.pos, d = u.cx, f = u.cy, p = u.xForText, m = u.yForText, h = s.done, g = h === void 0 ? function() {} : h, _ = s.length;
		_ && ([
			"circle",
			"text",
			"shape",
			"eventRect"
		].forEach(function(e) {
			for (var t = [], n = 0; n < _; n++) t.push(`.${U[e]}-${n}`);
			a.selectAll(`.${U[`${e}s`]}`).selectAll(t).remove();
		}), a.select(`.${U.xgrid}`).remove()), Object.keys(e).forEach(function(t) {
			var a = e[t];
			t !== "axis.x" && a.attr("transform", null), t === "grid.x" ? a.attr(i.xgridAttr) : t === "gridLines.x" ? (a.attr("x1", o ? 0 : l).attr("x2", o ? i.width : l), a.select("text").attr("x", o ? i.width : 0).attr("y", l)) : /^(area|bar|line)$/.test(t) ? a.attr("d", c.type[t]) : t === "text" ? a.attr("x", p).attr("y", m).style("fill-opacity", n.opacityForText.bind(n)) : t === "circle" ? n.isCirclePoint() ? a.attr("cx", d).attr("cy", f) : a.attr("x", function(e) {
				return d(e) - r.point_r;
			}).attr("y", function(e) {
				return f(e) - r.point_r;
			}) : t === "region.list" && a.select("rect").filter(n.isRegionOnX).attr("x", n.regionX.bind(n)).attr("width", n.regionWidth.bind(n));
		}), r.interaction_enabled && n.redrawEventRect(), g.call(n.api), i.flowing = !1;
	},
	getFlowTransform: function(e, t, n, r) {
		var i = this, a = i.data, o = i.scale.x, s = a.targets[0].values, c = i.getValueOnIndex(s, n), l = i.getValueOnIndex(s, n + r), u, d = o.domain(), f = i.updateXDomain(e, !0, !0);
		t ? u = t === 1 || c?.x === l?.x || i.axis.isTimeSeries() ? o(d[0]) - o(f[0]) : o(c?.x || 0) - o(l.x) : s.length === 1 ? i.axis.isTimeSeries() ? (c = i.getValueOnIndex(s, 0), l = i.getValueOnIndex(s, s.length - 1), u = o(c.x) - o(l.x)) : u = ip(f) / 2 : u = o(d[0]) - o(f[0]);
		var p = ip(d) / ip(f);
		return `translate(${u},0) scale(${p},1)`;
	}
}, Yh = {
	initClip: function() {
		var e = this, t = e.state, n = t.clip;
		n.id = `${t.datetimeId}-clip`, n.idXAxis = `${n.id}-xaxis`, n.idYAxis = `${n.id}-yaxis`, n.idGrid = `${n.id}-grid`, n.path = e.getClipPath(n.id), n.pathXAxis = e.getClipPath(n.idXAxis), n.pathYAxis = e.getClipPath(n.idYAxis), n.pathGrid = e.getClipPath(n.idGrid);
	},
	getClipPath: function(e) {
		var t = this.config;
		return !t.clipPath && /-clip$/.test(e) || !t.axis_x_clipPath && /-clip-xaxis$/.test(e) || !t.axis_y_clipPath && /-clip-yaxis$/.test(e) ? null : `url(#${e})`;
	},
	appendClip: function(e, t) {
		t && e.append("clipPath").attr("id", t).append("rect");
	},
	setXAxisClipPath: function(e) {
		var t = this, n = t.config, r = t.state, i = r.margin, a = r.width, o = r.height, s = n.axis_rotated, c = Math.max(30, i.left) - (s ? 0 : 20), l = (s ? i.top + o + 10 : i.bottom) + 20, u = s ? -(1 + c) : -(c - 1), d = -15, f = s ? i.left + 20 : a + 10 + c;
		e.attr("x", u).attr("y", d).attr("width", f).attr("height", l);
	},
	setYAxisClipPath: function(e) {
		var t = this, n = t.config, r = t.state, i = r.margin, a = r.width, o = r.height, s = n.axis_rotated, c = Math.max(30, i.left) - (s ? 20 : 0), l = n.axis_y_inner, u = l && !s ? n.axis_y_label.text ? -20 : -1 : s ? -(1 + c) : -(c - 1), d = -(s ? 20 : i.top), f = (s ? a + 15 + c : i.left + 20) + (l ? 20 : 0), p = (s ? i.bottom + 10 : i.top + o) + 10;
		e.attr("x", u).attr("y", d).attr("width", f).attr("height", p);
	},
	updateXAxisTickClip: function() {
		var e = this, t = e.config, n = e.state, r = n.clip, i = n.xAxisHeight, a = e.$el.defs, o = e.getHorizontalAxisHeight("x");
		if (a && !r.idXAxisTickTexts) {
			var s = `${r.id}-xaxisticktexts`;
			e.appendClip(a, s), r.pathXAxisTickTexts = e.getClipPath(r.idXAxisTickTexts), r.idXAxisTickTexts = s;
		}
		!t.axis_x_tick_multiline && e.getAxisTickRotate("x") && o !== i && (e.setXAxisTickClipWidth(), e.setXAxisTickTextClipPathWidth()), e.state.xAxisHeight = o;
	},
	setXAxisTickClipWidth: function() {
		var e = this, t = e.config, n = e.state.current.maxTickSize, r = e.getAxisTickRotate("x");
		if (!t.axis_x_tick_multiline && r) {
			var i = Math.sin(Math.PI / 180 * Math.abs(r));
			n.x.clipPath = (e.getHorizontalAxisHeight("x") - 20) / i;
		} else n.x.clipPath = null;
	},
	setXAxisTickTextClipPathWidth: function() {
		var e = this, t = e.state, n = t.clip, r = t.current, i = e.$el.svg;
		i && i.select(`#${n.idXAxisTickTexts} rect`).attr("width", r.maxTickSize.x.clipPath).attr("height", 30);
	}
}, Xh = function(e) {
	return G(e.position) || "end";
}, Zh = function(e) {
	return e.position === "start" ? 4 : e.position === "middle" ? 0 : -4;
};
function Qh(e, t, n) {
	return function(r) {
		var i = e ? 0 : t;
		return r.position === "start" ? i = e ? -n : 0 : r.position === "middle" && (i = (e ? -n : t) / 2), i;
	};
}
function $h(e, t) {
	e.each(function() {
		var e = M(this);
		[
			"x1",
			"x2",
			"y1",
			"y2"
		].forEach(function(t) {
			return e.attr(t, +e.attr(t));
		});
	});
}
var eg = {
	hasGrid: function() {
		var e = this.config;
		return ["x", "y"].some(function(t) {
			return e[`grid_${t}_show`] || e[`grid_${t}_lines`].length;
		});
	},
	initGrid: function() {
		var e = this;
		e.hasGrid() && e.initGridLines(), e.initFocusGrid();
	},
	initGridLines: function() {
		var e = this, t = e.config, n = e.state.clip, r = e.$el;
		(t.grid_x_lines.length || t.grid_y_lines.length) && (r.gridLines.main = r.main.insert("g", `.${I.chart}${t.grid_lines_front ? " + *" : ""}`).attr("clip-path", n.pathGrid).attr("class", `${B.grid} ${B.gridLines}`), r.gridLines.main.append("g").attr("class", B.xgridLines), r.gridLines.main.append("g").attr("class", B.ygridLines), r.gridLines.x = Ot([]));
	},
	updateXGrid: function(e) {
		var t = this, n = t.config, r = t.scale, i = t.state, a = t.$el, o = a.main, s = a.grid, c = n.axis_rotated, l = t.generateGridData(n.grid_x_type, r.x), u = t.axis.isCategorized() ? t.axis.x.tickOffset() : 0, d = function(e) {
			return (r.zoom || r.x)(e) + u * (c ? -1 : 1);
		};
		i.xgridAttr = c ? {
			x1: 0,
			x2: i.width,
			y1: d,
			y2: d
		} : {
			x1: d,
			x2: d,
			y1: 0,
			y2: i.height
		}, s.x = o.select(`.${B.xgrids}`).selectAll(`.${B.xgrid}`).data(l), s.x.exit().remove(), s.x = s.x.enter().append("line").attr("class", B.xgrid).merge(s.x), e || s.x.each(function() {
			var e = M(this);
			Object.keys(i.xgridAttr).forEach(function(t) {
				e.attr(t, i.xgridAttr[t]).style("opacity", function() {
					return e.attr(c ? "y1" : "x1") === (c ? i.height : 0) ? "0" : null;
				});
			});
		});
	},
	updateYGrid: function() {
		var e = this, t = e.axis, n = e.config, r = e.scale, i = e.state, a = e.$el, o = a.grid, s = a.main, c = n.axis_rotated, l = function(e) {
			return r.y(e);
		}, u = t.y.getGeneratedTicks(n.grid_y_ticks) || e.scale.y.ticks(n.grid_y_ticks);
		o.y = s.select(`.${B.ygrids}`).selectAll(`.${B.ygrid}`).data(u), o.y.exit().remove(), o.y = o.y.enter().append("line").attr("class", B.ygrid).merge(o.y), o.y.attr("x1", c ? l : 0).attr("x2", c ? l : i.width).attr("y1", c ? 0 : l).attr("y2", c ? i.height : l), $h(o.y);
	},
	updateGrid: function() {
		var e = this, t = e.$el, n = t.grid;
		!t.gridLines.main && e.initGridLines(), n.main.style("visibility", e.hasArcType() ? "hidden" : null), e.hideGridFocus(), e.updateGridLines("x"), e.updateGridLines("y");
	},
	updateGridLines: function(e) {
		var t = this, n = t.config, r = t.$el, i = r.gridLines, a = r.main, o = t.$T, s = n.axis_rotated, c = e === "x";
		n[`grid_${e}_show`] && t[`update${e.toUpperCase()}Grid`]();
		var l = a.select(`.${B[`${e}gridLines`]}`).selectAll(`.${B[`${e}gridLine`]}`).data(n[`grid_${e}_lines`]);
		o(l.exit()).style("opacity", "0").remove();
		var u = l.enter().append("g");
		u.append("line").style("opacity", "0"), l = u.merge(l), l.each(function(e) {
			var t = M(this);
			t.select("text").empty() && e.text && t.append("text").style("opacity", "0");
		}), o(l.attr("class", function(t) {
			return `${B[`${e}gridLine`]} ${t.class || ""}`.trim();
		}).select("text").attr("text-anchor", Xh).attr("transform", function() {
			return c ? s ? null : "rotate(-90)" : s ? "rotate(-90)" : null;
		}).attr("dx", Zh).attr("dy", -5)).text(function(e) {
			return e.text ?? this.remove();
		}), i[e] = l;
	},
	redrawGrid: function(e) {
		var t = this, n = t.config.axis_rotated, r = t.state, i = r.width, a = r.height, o = t.$el.gridLines, s = t.$T, c = t.xv.bind(t), l = t.yv.bind(t), u = o.x.select("line"), d = o.x.select("text"), f = o.y.select("line"), p = o.y.select("text");
		return u = s(u, e).attr("x1", n ? 0 : c).attr("x2", n ? i : c).attr("y1", n ? c : 0).attr("y2", n ? c : a), d = s(d, e).attr("x", Qh(!n, i, a)).attr("y", c), f = s(f, e).attr("x1", n ? l : 0).attr("x2", n ? l : i).attr("y1", n ? 0 : l).attr("y2", n ? a : l), p = s(p, e).attr("x", Qh(n, i, a)).attr("y", l), [
			u.style("opacity", null),
			d.style("opacity", null),
			f.style("opacity", null),
			p.style("opacity", null)
		];
	},
	initFocusGrid: function() {
		var e = this, t = e.config, n = e.state.clip, r = e.$el, i = t.grid_front, a = `.${i && r.gridLines.main ? B.gridLines : I.chart}${i ? " + *" : ""}`, o = r.main.insert("g", a).attr("clip-path", n.pathGrid).attr("class", B.grid);
		if (r.grid.main = o, t.grid_x_show && o.append("g").attr("class", B.xgrids), t.grid_y_show && o.append("g").attr("class", B.ygrids), t.axis_tooltip) {
			var s = o.append("g").attr("class", "bb-axis-tooltip");
			s.append("line").attr("class", "bb-axis-tooltip-x"), s.append("line").attr("class", "bb-axis-tooltip-y");
		}
		t.interaction_enabled && t.grid_focus_show && !t.axis_tooltip && (o.append("g").attr("class", z.xgridFocus).append("line").attr("class", z.xgridFocus), t.grid_focus_y && !t.tooltip_grouped && o.append("g").attr("class", z.ygridFocus).append("line").attr("class", z.ygridFocus));
	},
	showAxisGridFocus: function() {
		for (var e = this, t = e.config, n = e.format, r = e.state, i = r.event, a = r.width, o = r.height, s = t.axis_rotated, c = hp(i, e.$el.eventRect?.node()), l = c[0], u = c[1], d = {
			x: l,
			y: u
		}, f = 0, p = Object.entries(e.$el.axisTooltip); f < p.length; f++) {
			var m = p[f], h = m[0], g = m[1], _ = h === "x" && !s || h !== "x" && s ? "x" : "y", v = d[_], y = e.scale[h]?.invert(v);
			y && (y = h === "x" && e.axis.isTimeSeries() ? n.xAxisTick(y) : y?.toFixed(2), g?.attr(_, v).text(y));
		}
		e.$el.main.selectAll("line.bb-axis-tooltip-x, line.bb-axis-tooltip-y").style("visibility", null).each(function(e, t) {
			var n = M(this);
			t === 0 ? n.attr("x1", l).attr("x2", l).attr("y1", t ? 0 : o).attr("y2", t ? o : 0) : n.attr("x1", t ? 0 : a).attr("x2", t ? a : 0).attr("y1", u).attr("y2", u);
		});
	},
	hideAxisGridFocus: function() {
		var e = this;
		e.$el.main.selectAll(`line.${Qd.axisTooltipX}, line.${Qd.axisTooltipY}`).style("visibility", "hidden"), Object.values(e.$el.axisTooltip).forEach(function(e) {
			return e?.style("display", "none");
		});
	},
	showGridFocus: function(e) {
		var t, n = this, r = n.config, i = n.state, a = i.width, o = i.height, s = r.axis_rotated, c = n.$el.main.selectAll(`line.${z.xgridFocus}, line.${z.ygridFocus}`), l = (e || [c.datum()]).filter(function(e) {
			return e && G(n.getBaseValue(e));
		});
		if (!(!r.tooltip_show || l.length === 0 || !r.axis_x_forceAsSingle && n.hasType("bubble") || n.hasArcType())) {
			var u = r.grid_focus_edge && !r.tooltip_grouped, d = n.xx.bind(n);
			c.style("visibility", null).data(l.concat(l)).each(function(e) {
				var t = M(this), r = {
					x: d(e),
					y: n.getYScaleById(e.id)(e.value)
				}, i;
				if (t.classed(z.xgridFocus)) i = s ? [
					null,
					r.x,
					u ? r.y : a,
					r.x
				] : [
					r.x,
					u ? r.y : null,
					r.x,
					o
				];
				else {
					var c = n.axis.getId(e.id) === "y2";
					i = s ? [
						r.y,
						u && !c ? r.x : null,
						r.y,
						u && c ? r.x : o
					] : [
						u && c ? r.x : null,
						r.y,
						u && !c ? r.x : a,
						r.y
					];
				}
				[
					"x1",
					"y1",
					"x2",
					"y2"
				].forEach(function(e, n) {
					return t.attr(e, i[n]);
				});
			}), $h(c), (t = n.showCircleFocus) == null || t.call(n, e);
		}
	},
	hideGridFocus: function() {
		var e, t = this, n = t.state, r = n.inputType, i = n.resizing, a = t.$el.main;
		r !== "mouse" && i || (a.selectAll(`line.${z.xgridFocus}, line.${z.ygridFocus}`).style("visibility", "hidden"), (e = t.hideCircleFocus) == null || e.call(t));
	},
	updateGridFocus: function() {
		var e, t = this, n = t.state, r = n.inputType, i = n.width, a = n.height, o = n.resizing, s = t.$el.grid.main.select(`line.${z.xgridFocus}`);
		if (r === "touch") s.empty() ? o && ((e = t.showCircleFocus) == null || e.call(t)) : t.showGridFocus();
		else {
			var c = t.config.axis_rotated;
			s.attr("x1", c ? 0 : -10).attr("x2", c ? i : -10).attr("y1", c ? -10 : 0).attr("y2", c ? -10 : a);
		}
		return !0;
	},
	generateGridData: function(e, t) {
		var n = this, r = n.$el.main.select(`.${Qd.axisX}`).selectAll(".tick").size(), i = [];
		if (e === "year") for (var a = n.getXDomain().map(function(e) {
			return e.getFullYear();
		}), o = a[0], s = a[1], c = o; c <= s; c++) i.push(/* @__PURE__ */ new Date(`${c}-01-01 00:00:00`));
		else i = t.ticks(10), i.length > r && (i = i.filter(function(e) {
			return String(e).indexOf(".") < 0;
		}));
		return i;
	},
	getGridFilterToRemove: function(e) {
		return e ? function(t) {
			var n = !1;
			return (X(e) ? e.concat() : [e]).forEach(function(e) {
				("value" in e && t.value === e.value || "class" in e && t.class === e.class) && (n = !0);
			}), n;
		} : function() {
			return !0;
		};
	},
	removeGridLines: function(e, t) {
		var n = this, r = n.config, i = n.$T, a = n.getGridFilterToRemove(e), o = function(e) {
			return !a(e);
		}, s = t ? B.xgridLines : B.ygridLines, c = t ? B.xgridLine : B.ygridLine;
		i(n.$el.main.select(`.${s}`).selectAll(`.${c}`).filter(a)).style("opacity", "0").remove();
		var l = `grid_${t ? "x" : "y"}_lines`;
		r[l] = r[l].filter(o);
	}
}, tg = {
	initRegion: function() {
		var e = this, t = e.$el;
		t.region.main = t.main.insert("g", ":first-child").attr("clip-path", e.state.clip.path).attr("class", df.regions);
	},
	updateRegion: function() {
		var e = this, t = e.config, n = e.$el.region, r = e.$T;
		n.main || e.initRegion(), n.main.style("visibility", e.hasArcType() ? "hidden" : null);
		var i = n.main.selectAll(`.${df.region}`).data(t.regions);
		r(i.exit()).style("opacity", "0").remove();
		var a = i.enter().append("g");
		a.append("rect").style("fill-opacity", "0"), n.list = a.merge(i).attr("class", e.classRegion.bind(e)), n.list.each(function(e) {
			M(this).select("text").empty() && e.label?.text && M(this).append("text").style("opacity", "0");
		});
	},
	redrawRegion: function(e) {
		var t = this, n = t.$el.region, r = t.$T, i = t.regionX.bind(t), a = t.regionY.bind(t), o = ["width", "height"], s = n.list.select("rect"), c = n.list.selectAll("text");
		return s = r(s, e).attr("x", i).attr("y", a).attr("width", t.regionWidth.bind(t)).attr("height", t.regionHeight.bind(t)), c = r(c, e).text(function(e) {
			return e.label?.text;
		}).attr("transform", function(e) {
			return e.label.rotated ? " rotate(-90)" : null;
		}).attr("transform", function(e) {
			var t = this, n = e.label ?? {}, r = n.x, s = r === void 0 ? 0 : r, c = n.y, l = c === void 0 ? 0 : c, u = n.center, d = u !== void 0 && u, f = n.rotated, p = f !== void 0 && f, m = this.previousElementSibling, h = {
				x: 0,
				y: 0
			};
			return q(d) && ["x", "y"].forEach(function(e, n) {
				d.indexOf(e) > -1 && (h[e] = (+m.getAttribute(o[n]) - _p(t)[o[n]]) / 2);
			}), `translate(${i(e) + h.x + s}, ${a(e) + h.y + l})${p ? " rotate(-90)" : ""}`;
		}).attr("text-anchor", function(e) {
			return e.label?.rotated ? "end" : null;
		}).attr("dy", "1em").style("fill", function(e) {
			return e.label?.color ?? null;
		}), [s.style("fill-opacity", function(e) {
			return G(e.opacity) ? e.opacity : null;
		}).on("end", function() {
			M(this.parentNode).selectAll("rect:not([x])").remove();
		}), c.style("opacity", null)];
	},
	regionX: function(e) {
		return this.getRegionSize("x", e);
	},
	regionY: function(e) {
		return this.getRegionSize("y", e);
	},
	regionWidth: function(e) {
		return this.getRegionSize("width", e);
	},
	regionHeight: function(e) {
		return this.getRegionSize("height", e);
	},
	getRegionSize: function(e, t) {
		var n = this, r = n.config, i = n.scale, a = n.state, o = r.axis_rotated, s = /(x|y|y2)/.test(e), c = s ? e === "x" : e === "width", l = !s && n[c ? "regionX" : "regionY"](t), u = s ? "start" : "end", d = s ? 0 : a[e], f;
		if (t.axis === "y" || t.axis === "y2" ? (!s && !c ? u = "start" : s && !c && (u = "end"), (c ? o : !o) && u in t && (f = i[t.axis])) : (c ? !o : o) && u in t && (f = i.zoom || i.x), f) {
			var p = 0;
			d = t[u], n.axis.isTimeSeries(t.axis) ? d = Bp.call(n, d) : /(x|width)/.test(e) && n.axis.isCategorized() && isNaN(d) && (d = r.axis_x_categories.indexOf(d), p = n.axis.x.tickOffset() * (u === "start" ? -1 : 1)), d = f(d) + p;
		}
		return s ? d : d < l ? 0 : d - l;
	},
	isRegionOnX: function(e) {
		return !e.axis || e.axis === "x";
	}
}, ng = {
	getAxisSize: function(e) {
		var t = this, n = t.config.axis_rotated;
		return n && e === "x" || !n && /y2?/.test(e) ? t.getAxisWidthByAxisId(e, !0) : t.getHorizontalAxisHeight(e);
	},
	getAxisWidthByAxisId: function(e, t) {
		var n = this;
		if (n.axis) {
			var r = n.axis?.getLabelPositionById(e), i = n.axis.getMaxTickSize(e, t).width, a = i === 0 ? .5 : 0;
			return i + (n.config.padding?.mode === "fit" ? r.isInner ? 10 + a : 10 : r.isInner ? 20 + a : 40);
		}
		return 40;
	},
	getHorizontalAxisHeight: function(e) {
		var t = this, n = t.config, r = t.state, i = r.rotatedPadding, a = r.isLegendRight, o = r.isLegendInset, s = n.axis_rotated, c = n.padding?.mode === "fit", l = n[`axis_${e}_inner`], u = n[`axis_${e}_label`].text, d = 13, f = n.padding?.mode === "fit" ? l && !u ? +(e === "y") : 20 : 30;
		if (e === "x" && !n.axis_x_show) return 8;
		if (e === "x" && J(n.axis_x_height)) return n.axis_x_height;
		if (e === "y" && !n.axis_y_show) return n.legend_show && !a && !o ? 10 : 1;
		if (e === "y2" && !n.axis_y2_show) return c ? 0 : i.top;
		var p = t.axis.getMaxTickSize(e), m = Math.abs(n.axis_x_tick_rotate) > 0 && (!n.axis_x_tick_autorotate || t.needToRotateXAxisTickTexts());
		return (n.axis_x_tick_multiline || m) && p.height > d && (f += p.height - d), f + (t.axis.getLabelPositionById(e).isInner ? 0 : 10) + (e === "y2" && !s ? -10 : 0);
	},
	getEventRectWidth: function() {
		var e = this, t = e.config, n = e.axis, r = t.axis_x_inverted, i = n.x.tickInterval();
		return Math.max(0, r ? Math.abs(i) : i);
	},
	getAxisTickRotate: function(e) {
		var t = this, n = t.axis, r = t.config, i = t.state, a = t.$el, o = r[`axis_${e}_tick_rotate`];
		if (e === "x") {
			var s = n.isCategorized() || n.isTimeSeries();
			if (r.axis_x_tick_fit && s) {
				var c = r.axis_x_tick_count, l = i.current.maxTickSize.x.ticks.length, u = 0;
				if (c ? u = c > l ? l : c : l && (u = l), u !== i.axis.x.tickCount) {
					var d = t.data.targets;
					i.axis.x.padding = t.getXDomainPadding([t.getXDomainMinMax(d, "min"), t.getXDomainMinMax(d, "max")], u);
				}
				i.axis.x.tickCount = u;
			}
			a.svg && r.axis_x_tick_autorotate && r.axis_x_tick_fit && !r.axis_x_tick_multiline && !r.axis_x_tick_culling && s && (o = t.needToRotateXAxisTickTexts() ? r.axis_x_tick_rotate : 0);
		}
		return o;
	},
	needToRotateXAxisTickTexts: function() {
		var e = this, t = e.state, n = t.axis, r = t.current, i = t.isLegendRight, a = t.legendItemWidth, o = i && a, s = r.width - o - e.getCurrentPaddingByDirection("left") - e.getCurrentPaddingByDirection("right"), c = n.x.tickCount + n.x.padding.left + n.x.padding.right;
		return e.axis.getMaxTickSize("x").width > (c ? s / c : 0);
	}
}, rg = F(F(F({
	axis_evalTextSize: !0,
	axis_rotated: !1,
	axis_tooltip: !1
}, {
	axis_x_clipPath: !0,
	axis_x_show: !0,
	axis_x_forceAsSingle: !1,
	axis_x_type: "indexed",
	axis_x_localtime: !0,
	axis_x_categories: [],
	axis_x_tick_centered: !1,
	axis_x_tick_format: void 0,
	axis_x_tick_culling: {},
	axis_x_tick_culling_max: 10,
	axis_x_tick_culling_lines: !0,
	axis_x_tick_culling_reverse: !1,
	axis_x_tick_count: void 0,
	axis_x_tick_inner: !1,
	axis_x_tick_show: !0,
	axis_x_tick_text_show: !0,
	axis_x_tick_text_inner: !1,
	axis_x_tick_text_position: {
		x: 0,
		y: 0
	},
	axis_x_tick_fit: !0,
	axis_x_tick_values: null,
	axis_x_tick_autorotate: !1,
	axis_x_tick_rotate: 0,
	axis_x_tick_outer: !0,
	axis_x_tick_multiline: !0,
	axis_x_tick_width: null,
	axis_x_tick_tooltip: !1,
	axis_x_max: void 0,
	axis_x_min: void 0,
	axis_x_inverted: !1,
	axis_x_padding: {},
	axis_x_height: void 0,
	axis_x_extent: void 0,
	axis_x_label: {},
	axis_x_axes: []
}), {
	axis_y_clipPath: !0,
	axis_y_show: !0,
	axis_y_type: "indexed",
	axis_y_max: void 0,
	axis_y_min: void 0,
	axis_y_inverted: !1,
	axis_y_center: void 0,
	axis_y_inner: !1,
	axis_y_label: {},
	axis_y_tick_format: void 0,
	axis_y_tick_culling: !1,
	axis_y_tick_culling_max: 5,
	axis_y_tick_culling_lines: !0,
	axis_y_tick_culling_reverse: !1,
	axis_y_tick_inner: !1,
	axis_y_tick_outer: !0,
	axis_y_tick_values: null,
	axis_y_tick_rotate: 0,
	axis_y_tick_count: void 0,
	axis_y_tick_show: !0,
	axis_y_tick_stepSize: null,
	axis_y_tick_text_show: !0,
	axis_y_tick_text_position: {
		x: 0,
		y: 0
	},
	axis_y_tick_time_value: void 0,
	axis_y_padding: {},
	axis_y_default: void 0,
	axis_y_axes: []
}), {
	axis_y2_show: !1,
	axis_y2_type: "indexed",
	axis_y2_max: void 0,
	axis_y2_min: void 0,
	axis_y2_inverted: !1,
	axis_y2_center: void 0,
	axis_y2_inner: !1,
	axis_y2_label: {},
	axis_y2_tick_format: void 0,
	axis_y2_tick_culling: !1,
	axis_y2_tick_culling_max: 5,
	axis_y2_tick_culling_lines: !0,
	axis_y2_tick_culling_reverse: !1,
	axis_y2_tick_inner: !1,
	axis_y2_tick_outer: !0,
	axis_y2_tick_values: null,
	axis_y2_tick_rotate: 0,
	axis_y2_tick_count: void 0,
	axis_y2_tick_show: !0,
	axis_y2_tick_stepSize: null,
	axis_y2_tick_text_show: !0,
	axis_y2_tick_text_position: {
		x: 0,
		y: 0
	},
	axis_y2_padding: {},
	axis_y2_default: void 0,
	axis_y2_axes: []
}), ig = {
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
}, ag = {
	data_xs: {},
	data_xFormat: "%Y-%m-%d",
	data_xLocaltime: !0,
	data_xSort: !0,
	data_axes: {},
	data_regions: {},
	data_stack_normalize: !1
}, og = [
	kh,
	Ah,
	jh,
	Lh,
	Rh,
	Vh,
	Hh
], sg = {
	axis: Gh,
	clip: Yh,
	eventrect: qh,
	flow: Jh,
	grid: eg,
	region: tg,
	sizeAxis: ng
}, cg = {
	optDataAxis: ag,
	optAxis: rg,
	optGrid: ig
}, lg = 15, ug = 20, dg = .35;
function fg(e) {
	e === void 0 && (e = !1);
	var t = this;
	return [
		"donut",
		"pie",
		"polar",
		"gauge"
	].find(function(n) {
		return t.hasType(n) && !(n === "gauge" && e && t.hasMultiArcGauge());
	});
}
function pg() {
	var e = this, t = e.config, n = fg.call(e, !0), r = n && t[`${n}_label_line`], i = ap(r), a = function(e, t, n) {
		return n;
	}, o = {
		show: r === !0 || i && r?.show !== !1,
		distance: i && r?.distance || ug
	};
	if (r === !0) return {
		chartType: n,
		line: o,
		text: { formatter: a }
	};
	if (!i) return {
		chartType: n,
		line: {
			show: !1,
			distance: ug
		},
		text: { formatter: null }
	};
	var s = a;
	return K(r.text) ? s = r.text : r.text === !1 && (s = null), {
		chartType: n,
		line: o,
		text: { formatter: s }
	};
}
function mg(e, t) {
	var n = this, r = n.state, i = n.updateAngle(e);
	if (!i) return null;
	var a = n.getRadius(e).outerRadius, o = a;
	n.hasType("polar") && (o = n.getPolarOuterRadius(e, a), a = r.radius);
	var s = (i.startAngle + i.endAngle) / 2;
	Math.abs(i.endAngle - i.startAngle - 2 * Math.PI) < .01 && (s = Math.PI / 2);
	var c = Math.sin(s), l = -Math.cos(s), u = {
		x: c * o,
		y: l * o
	}, d = a + lg, f = {
		x: c * d,
		y: l * d
	}, p = c >= 0;
	return {
		startPoint: u,
		breakPoint: f,
		endPoint: {
			x: f.x + t * (p ? 1 : -1),
			y: f.y
		},
		isRight: p,
		midAngle: s
	};
}
function hg() {
	return pg.call(this).line.show;
}
function gg(e) {
	var t = this, n = t.$el.arcs, r = t.$T, i = pg.call(t), a = i.line, o = i.text, s = a.distance, c = null;
	n.selectAll(`.${L.chartArc}`).each(function(n) {
		var i = M(this), l = mg.call(t, n, s), u = n._cache ?? {}, d = u.ratio, f = u.meetsThreshold, p = u.updated;
		if (p && l) {
			var m = t.isTargetToShow(n.data.id) && f, h = l.startPoint, g = l.breakPoint, _ = l.endPoint, v = l.isRight, y = `${h.x},${h.y} ${g.x},${g.y} ${_.x},${_.y}`;
			if (a.show) {
				var b = i.select(`.${L.arcLabelLine}`);
				b.empty() && (b = i.append("polyline").attr("class", L.arcLabelLine)), r(b, e).attr("points", y).style("stroke", t.color(n.data)).style("opacity", m ? null : "0");
			}
			var x = i.select(`.${L.arcLabelLineText}`);
			if (x.empty() && (x = i.append("text").attr("class", L.arcLabelLineText).style("pointer-events", "none")), m) {
				var S = p.value, C = n.data.id, w = (o.formatter ?? t.getArcLabelConfig("format") ?? t.defaultArcValueFormat)(S, d, C).toString();
				fp(x, w, [-1, 1], !1);
				var T = {
					x: _.x + 5 * (v ? 1 : -1),
					y: _.y
				};
				x.style("text-anchor", v ? "start" : "end");
				var E = x.node(), D = E?.querySelectorAll("tspan");
				if (c === null && (c = parseFloat(W.getComputedStyle(E).fontSize) || 12), D && D.length > 1) {
					var O = (D.length - 3) / 2;
					T.y += (-O + dg) * c;
				} else T.y += dg * c;
				r(x, e).attr("transform", `translate(${T.x},${T.y})`).style("opacity", null).style("fill", t.updateTextColor.bind(t)(n));
			} else r(x, e).style("opacity", "0");
		}
	});
}
function _g(e) {
	return [
		"donut",
		"pie",
		"polar",
		"gauge"
	].find(function(t) {
		return e.hasType(t);
	});
}
function vg(e, t, n, r) {
	var i = e.config, a = e.state.radiusExpanded, o = n.endAngle - Math.PI / 2, s = Math.sin(o), c = {
		x: Math.cos(o) * (a + (r ? 5 : 25)),
		y: s * (a + 15 - Math.abs(s * 10)) + 3
	};
	if (r) {
		var l = i.arc_rangeText_position;
		if (l) {
			var u = i.arc_rangeText_values, d = K(l) ? l(u[t.index]) : l;
			c.x += d?.x ?? 0, c.y += d?.y ?? 0;
		}
	}
	return c;
}
function yg(e, t, n, r) {
	var i = e.config, a = _g(e), o = a ? i[`${a}_label_ratio`] : void 0;
	if (o) o = K(o) ? o.bind(e.api)(t, n, r) : o;
	else {
		var s = 36, c = .375, l = 1.175, u = .8, d = s / n;
		o = n && r ? (d > c ? l - d : u) * n / r : 0;
	}
	return o;
}
function bg(e, t, n) {
	var r = e.getRadius(t).outerRadius;
	e.hasType("polar") && (r = e.getPolarOuterRadius(t, r));
	var i = e.svgArc.centroid(n).map(function(e) {
		return isNaN(e) ? 0 : e;
	}), a = i[0], o = i[1], s = Math.sqrt(a * a + o * o), c = yg(e, t, r, s);
	return {
		pos: {
			x: a,
			y: o
		},
		ratio: c
	};
}
function xg(e) {
	e === void 0 && (e = 0);
	var t = this, n = t.config, r = t.state, i = t.hasMultiArcGauge(), a = r.gaugeArcWidth / t.filterTargetsToShow(t.data.targets).length, o = e ? Math.min(r.radiusExpanded * e - r.radius, a * .8 - (1 - e) * 100) : 0;
	return {
		inner: function(e) {
			var n = t.getRadius(e).innerRadius;
			return i ? r.radius - a * (e.index + 1) : J(n) ? n : 0;
		},
		outer: function(n) {
			var s = t.getRadius(n).outerRadius, c;
			if (i) c = r.radius - a * n.index + o;
			else if (t.hasType("polar") && !e) c = t.getPolarOuterRadius(n, s);
			else if (c = s, e) {
				var l = r.radiusExpanded;
				r.radius !== s && (l -= Math.abs(r.radius - s)), c = l * e;
			}
			return c;
		},
		corner: function(e, r) {
			var i = n.arc_cornerRadius_ratio, a = i === void 0 ? 0 : i, o = n.arc_cornerRadius, s = o === void 0 ? 0 : o, c = e.data.id, l = e.value, u = 0;
			return u = a ? a * r : J(s) ? s : s.call(t.api, c, l, r), u;
		}
	};
}
function Sg(e) {
	return function(t) {
		var n = function(e) {
			var t = e.startAngle, n = t === void 0 ? 0 : t, r = e.endAngle, i = r === void 0 ? 0 : r, a = e.padAngle;
			return {
				startAngle: n,
				endAngle: i,
				padAngle: a === void 0 ? 0 : a
			};
		}, r = Ma(n(this._current), n(t));
		return this._current = t, function(n) {
			var i = r(n), a = t.data, o = t.index, s = t.value;
			return e(F(F({}, i), {
				data: a,
				index: o,
				value: s
			}));
		};
	};
}
var Cg = {
	initPie: function() {
		var e = this, t = e.config, n = t.data_type, r = t[`${n}_padding`], i = t[`${n}_startingAngle`] || 0, a = (r ? r * .01 : t[`${n}_padAngle`]) || 0;
		e.pie = Xl().startAngle(i).endAngle(i + 2 * Math.PI).padAngle(a).value(function(e) {
			return e.values?.reduce(function(e, t) {
				return e + t.value;
			}, 0) ?? e;
		}).sort(e.getSortCompareFn.bind(e)(!0));
	},
	updateRadius: function() {
		var e = this, t = e.config, n = e.state, r = t[`${t.data_type}_padding`], i = t.gauge_width || t.donut_width, a = e.filterTargetsToShow(e.data.targets).length * t.gauge_arcs_minWidth, o = .85, s = hg.call(e) ? o : 1;
		n.radiusExpanded = Math.min(n.arcWidth, n.arcHeight) / 2 * (e.hasMultiArcGauge() && t.gauge_label_show ? o : s), n.radius = n.radiusExpanded * .95, n.innerRadiusRatio = i ? (n.radius - i) / n.radius : .6, n.gaugeArcWidth = i || (a <= n.radius - n.innerRadius ? n.radius - n.innerRadius : a <= n.radius ? a : n.radius);
		var c = t.pie_innerRadius || (r ? r * (n.innerRadiusRatio + .1) : 0);
		n.outerRadius = t.pie_outerRadius, n.innerRadius = e.hasType("donut") || e.hasType("gauge") ? n.radius * n.innerRadiusRatio : c;
	},
	getRadius: function(e) {
		var t = this, n = e?.data, r = t.state, i = r.innerRadius, a = r.outerRadius;
		return !J(i) && n && (i = i[n.id] || 0), Z(a) && n && n.id in a ? a = a[n.id] : J(a) || (a = t.state.radius), {
			innerRadius: i,
			outerRadius: a
		};
	},
	updateArc: function() {
		var e = this;
		e.updateRadius(), e.svgArc = e.getSvgArc(), e.svgArcExpanded = e.getSvgArcExpanded();
	},
	getArcLength: function() {
		var e = this.config.gauge_arcLength * 3.6, t = e / 360 * 2;
		return e < -360 ? t = -2 : e > 360 && (t = 2), t * Math.PI;
	},
	getStartingAngle: function() {
		var e = this, t = e.config, n = t.data_type, r = e.hasType("gauge") ? t.gauge_fullCircle : !1, i = -1 * Math.PI / 2, a = Math.PI / 2, o = t[`${n}_startingAngle`] || 0;
		return !r && o <= i ? o = i : !r && o >= a ? o = a : (o > Math.PI || o < -1 * Math.PI) && (o = Math.PI), o;
	},
	updateAngle: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.config, i = n.state, a = t && n.hasType("gauge"), o = n.pie, s = e, c = !1;
		if (!r) return null;
		var l = n.getStartingAngle(), u = r.gauge_fullCircle || t && !a ? n.getArcLength() : l * -2;
		if (s.data && n.isGaugeType(s.data) && !n.hasMultiArcGauge()) {
			var d = r.gauge_min, f = r.gauge_max, p = u * ((n.getTotalDataSum(i.rendered) - d) / (f - d));
			o = o.startAngle(l).endAngle(p + l);
		}
		if (t === !1 && o(n.filterTargetsToShow()).forEach(function(e, t) {
			!c && e.data.id === s.data?.id && (c = !0, s = e, s.index = t);
		}), isNaN(s.startAngle) && (s.startAngle = 0), isNaN(s.endAngle) && (s.endAngle = s.startAngle), t || s.data && (r.gauge_enforceMinMax || n.hasMultiArcGauge())) {
			var d = r.gauge_min, f = r.gauge_max, m = t && !a ? n.getTotalDataSum(i.rendered) : f, h = u / (m - d), g = s.value ?? 0, _ = g < d ? 0 : g < m ? g - d : m - d;
			s.startAngle = l, s.endAngle = l + h * _;
		}
		return c || t ? s : null;
	},
	getSvgArc: function() {
		var e = this, t = xg.call(e), n = t.inner, r = t.outer, i = t.corner, a = Bl().innerRadius(n).outerRadius(r), o = function(t, n) {
			var o = "M 0 0";
			if (t.value || t.data) {
				var s = n ? t : e.updateAngle(t) ?? null;
				s && (o = a.cornerRadius(i(s, r(s)))(s));
			}
			return o;
		};
		return o.centroid = a.centroid, o;
	},
	getSvgArcExpanded: function(e) {
		e === void 0 && (e = 1);
		var t = this, n = xg.call(t, e), r = n.inner, i = n.outer, a = n.corner, o = Bl().innerRadius(r).outerRadius(i);
		return function(e) {
			var n = t.updateAngle(e), r = i(n), s = 0;
			return n && (s = a(n, r)), n ? o.cornerRadius(s)(n) : "M 0 0";
		};
	},
	getArc: function(e, t, n) {
		return n || this.isArcType(e.data) ? this.svgArc(e, t) : "M 0 0";
	},
	redrawArcRangeText: function() {
		var e = this, t = e.config, n = e.$el.arcs, r = e.state, i = e.$T, a = t.arc_rangeText_format, o = e.hasType("gauge") && t.arc_rangeText_fixed, s = t.arc_rangeText_values;
		if (s?.length) {
			var c = t.arc_rangeText_unit === "%", l = e.getTotalDataSum(r.rendered);
			c && (s = s.map(function(e) {
				return l / 100 * e;
			}));
			var u = e.pie(s).map(function(e, t) {
				return e.index = t, e;
			}), d = n.selectAll(`.${L.arcRange}`).data(s);
			d.exit(), d = i(d.enter().append("text").attr("class", L.arcRange).style("text-anchor", "middle").style("pointer-events", "none").style("opacity", "0").text(function(e) {
				var t = c ? e / l * 100 : e;
				return K(a) ? a(t) : `${t}${c ? "%" : ""}`;
			}).merge(d)), (!r.rendered || r.rendered && !o) && l > 0 && d.attr("transform", function(t, n) {
				return e.transformForArcLabel(this, u[n], !0);
			}), d.style("opacity", function(e) {
				return !o && (e > l || l === 0) ? "0" : null;
			});
		}
	},
	transformForArcLabel: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = r.updateAngle(t, n);
		if (!i) return "";
		var a, o = 1;
		if (n || r.hasMultiArcGauge()) a = vg(r, t, i, n);
		else if (!r.hasType("gauge") || r.data.targets.length > 1) {
			var s = bg(r, t, i);
			a = s.pos, o = s.ratio;
		} else return "";
		return Qm.call(r, e, a), `translate(${a.x * o},${a.y * o})`;
	},
	convertToArcData: function(e) {
		return this.addName({
			id: "data" in e ? e.data.id : e.id,
			value: e.value,
			ratio: this.getRatio("arc", e),
			index: e.index
		});
	},
	textForArcLabel: function(e) {
		var t = this, n = t.hasType("gauge"), r = [
			"donut",
			"gauge",
			"pie",
			"polar"
		].filter(t.hasType.bind(t))?.[0];
		t.shouldShowArcLabel() && e.style("fill", t.updateTextColor.bind(t)).attr("filter", function(e) {
			return t.updateTextBGColor.bind(t)(e, t.config.data_labels_backgroundColors);
		}).each(function(e) {
			var i = M(this), a = t.updateAngle(e), o = t.getRatio("arc", a), s = Ym.call(t, o, r);
			if (e._cache = {
				updated: a,
				ratio: o,
				meetsThreshold: s
			}, s) {
				var c = (a || e).value;
				fp(i, (t.getArcLabelConfig("format") || t.defaultArcValueFormat)(c, o, e.data.id).toString(), [-1, 1], n);
			} else i.text("");
		});
	},
	expandArc: function(e) {
		var t = this, n = t.state.transiting, r = t.$el;
		if (n) var i = setInterval(function() {
			n || (clearInterval(i), r.legend.selectAll(`.${z.legendItemFocused}`).size() > 0 && t.expandArc(e));
		}, 10);
		else {
			var a = t.mapToTargetIds(e);
			r.svg.selectAll(t.selectorTargets(a, `.${L.chartArc}`)).each(function(e) {
				if (t.shouldExpand(e.data.id)) {
					var n = t.getExpandConfig(e.data.id, "duration"), r = t.getSvgArcExpanded(t.getExpandConfig(e.data.id, "rate"));
					M(this).selectAll("path").transition().duration(n).attrTween("d", Sg(t.svgArcExpanded.bind(t))).transition().duration(n * 2).attrTween("d", Sg(r.bind(t)));
				}
			});
		}
	},
	unexpandArc: function(e) {
		var t = this, n = t.state.transiting, r = t.$el.svg;
		if (!n) {
			var i = t.mapToTargetIds(e);
			r.selectAll(t.selectorTargets(i, `.${L.chartArc}`)).selectAll("path").transition().duration(function(e) {
				return t.getExpandConfig(e.data.id, "duration");
			}).attrTween("d", Sg(t.svgArc.bind(t))), r.selectAll(`${L.arc}`).style("opacity", null);
		}
	},
	getExpandConfig: function(e, t) {
		var n = this, r = n.config, i = {
			duration: 50,
			rate: .98
		}, a;
		return n.isDonutType(e) ? a = "donut" : n.isGaugeType(e) ? a = "gauge" : n.isPieType(e) && (a = "pie"), a ? r[`${a}_expand_${t}`] : i[t];
	},
	shouldExpand: function(e) {
		var t = this, n = t.config;
		return t.isDonutType(e) && n.donut_expand || t.isGaugeType(e) && n.gauge_expand || t.isPieType(e) && n.pie_expand;
	},
	shouldShowArcLabel: function() {
		var e = this, t = e.config;
		return [
			"donut",
			"gauge",
			"pie",
			"polar"
		].some(function(n) {
			return e.hasType(n) && t[`${n}_label_show`];
		});
	},
	getArcLabelConfig: function(e) {
		e === void 0 && (e = "format");
		var t = this, n = t.config, r = function(e) {
			return e;
		};
		return [
			"donut",
			"gauge",
			"pie",
			"polar"
		].filter(t.hasType.bind(t)).forEach(function(t) {
			r = n[`${t}_label_${e}`];
		}), e === "format" && K(r) ? r.bind(t.api) : r;
	},
	updateTargetsForArc: function(e) {
		var t = this, n = t.$el, r = t.hasType("gauge"), i = t.getChartClass("Arc"), a = t.getClass("arcs", !0), o = t.classFocus.bind(t), s = n.main.select(`.${L.chartArcs}`), c = s.selectAll(`.${L.chartArc}`).data(t.pie(e)).attr("class", function(e) {
			return i(e) + o(e.data);
		}), l = c.enter().append("g").attr("class", i).call(this.setCssRule(!1, `.${L.chartArcs} text`, ["pointer-events:none", "text-anchor:middle"]));
		l.append("g").attr("class", a).merge(c), l.append("text").attr("dy", r && !t.hasMultiTargets() ? "-.1em" : null).style("opacity", "0").style("text-anchor", t.getStylePropValue("middle")).style("pointer-events", t.getStylePropValue("none")), n.text = s.selectAll(`.${I.target} text`);
	},
	initArc: function() {
		var e = this, t = e.$el;
		t.arcs = t.main.select(`.${I.chart}`).append("g").attr("class", L.chartArcs).attr("transform", e.getTranslate("arc")), e.setArcTitle();
	},
	setArcTitle: function(e) {
		var t = this, n = e || t.getArcTitle(), r = t.hasType("gauge");
		if (n) {
			var i = r ? of.chartArcsGaugeTitle : L.chartArcsTitle, a = t.$el.arcs.select(`.${i}`);
			a.empty() && (a = t.$el.arcs.append("text").attr("class", i).style("text-anchor", "middle")), r && a.attr("dy", "-0.3em"), fp(a, n, r ? void 0 : [-.6, 1.35], !0);
		}
	},
	getArcTitle: function() {
		var e = this, t = e.hasType("donut") && "donut" || e.hasType("gauge") && "gauge";
		return t ? e.config[`${t}_title`] : "";
	},
	getArcTitleWithNeedleValue: function() {
		var e = this, t = e.config, n = e.state, r = e.getArcTitle();
		if (r && e.config.arc_needle_show && /{=[A-Z_]+}/.test(r)) {
			var i = n.current.needle;
			return J(i) || (i = t.arc_needle_value), zp(r, { NEEDLE_VALUE: ~~i });
		}
		return !1;
	},
	redrawArc: function(e, t, n) {
		var r = this, i = r.config, a = r.state, o = r.$el.main, s = i.interaction_enabled, c = s && i.data_selection_isselectable, l = o.selectAll(`.${L.arcs}`).selectAll(`.${L.arc}`).data(r.arcData.bind(r));
		l.exit().transition().duration(t).style("opacity", "0").remove(), l = l.enter().append("path").attr("class", r.getClass("arc", !0)).style("fill", function(e) {
			return r.color(e.data);
		}).style("cursor", function(e) {
			return (c?.bind)?.call(c, r.api)(e) ? "pointer" : null;
		}).style("opacity", "0").each(function(e) {
			r.isGaugeType(e.data) && (e.startAngle = i.gauge_startingAngle, e.endAngle = i.gauge_startingAngle), this._current = e;
		}).merge(l), r.hasType("gauge") && (r.updateGaugeMax(), r.hasMultiArcGauge() && r.redrawArcGaugeLine()), l.attr("transform", function(e) {
			return !r.isGaugeType(e.data) && n ? "scale(0)" : "";
		}).style("opacity", function(e) {
			return e === this._current ? "0" : null;
		}).each(function() {
			a.transiting = !0;
		}).transition().duration(e).attrTween("d", function(e) {
			var t = r.updateAngle(e);
			if (!t) return function() {
				return "M 0 0";
			};
			isNaN(this._current.startAngle) && (this._current.startAngle = 0), isNaN(this._current.endAngle) && (this._current.endAngle = this._current.startAngle);
			var n = Ma(this._current, t);
			return this._current = n(0), function(t) {
				var i = n(t);
				return i.data = e.data, r.getArc(i, !0);
			};
		}).attr("transform", n ? "scale(1)" : "").style("fill", function(e) {
			var t;
			return r.levelColor ? (t = r.levelColor(e.data.values[0].value), i.data_colors[e.data.id] = t) : t = r.color(e.data), t;
		}).style("opacity", null).call(dp, function() {
			if (r.levelColor) {
				var e = M(this), t = e.datum(this._current);
				r.updateLegendItemColor(t.data.id, e.style("fill"));
			}
			a.transiting = !1, Q(i.onrendered, r.api);
		}), s && r.bindArcEvent(l), r.hasType("polar") && r.redrawPolar(), r.hasType("gauge") && r.redrawBackgroundArcs(), i.arc_needle_show && r.redrawNeedle(), r.redrawArcText(e), r.redrawArcRangeText();
	},
	redrawNeedle: function() {
		var e = this, t = e.$el, n = e.config, r = e.state, i = r.hiddenTargetIds, a = (r.radius - 1) / 100 * n.arc_needle_length, o = i.length !== e.data.targets.length, s = e.$el.arcs.select(`.${L.needle}`), c = n.arc_needle_path, l = n.arc_needle_bottom_width / 2, u = n.arc_needle_top_width / 2, d = n.arc_needle_top_rx, f = n.arc_needle_top_ry, p = n.arc_needle_bottom_len, m = n.arc_needle_bottom_rx, h = n.arc_needle_bottom_ry, g = e.getNeedleAngle(), _ = function() {
			var t = e.getArcTitleWithNeedleValue();
			t && e.setArcTitle(t);
		};
		if (_(), s.empty() && (s = t.arcs.append("path").classed(L.needle, !0), t.needle = s, t.needle.updateHelper = function(r, i) {
			i === void 0 && (i = !1), t.needle.style("display") !== "none" && e.$T(t.needle).style("transform", `rotate(${e.getNeedleAngle(r)}deg)`).call(dp, function() {
				i && (n.arc_needle_value = r), _();
			});
		}), o) {
			var v = K(c) ? c.call(e, a) : `M-${l} ${p} A${m} ${h} 0 0 0 ${l} ${p} L${u} -${a} A${d} ${f} 0 0 0 -${u} -${a} L-${l} ${p} Z`;
			e.$T(s).attr("d", v).style("fill", n.arc_needle_color).style("display", null).style("transform", `rotate(${g}deg)`);
		} else s.style("display", "none");
	},
	getNeedleAngle: function(e) {
		var t = this, n = t.config, r = t.state, i = t.getArcLength(), a = t.hasType("gauge"), o = t.getTotalDataSum(!0), s = Y(e) ? e : n.arc_needle_value, c = n[`${n.data_type}_startingAngle`] || 0, l = 0;
		if (J(s) || (s = a && t.data.targets.length === 1 ? o : 0), r.current.needle = s, a) {
			c = t.getStartingAngle();
			var u = n.gauge_fullCircle ? i : c * -2, d = n.gauge_min, f = n.gauge_max;
			l = u * ((s - d) / (f - d));
		} else l = s / o * i;
		return (c + l) * (180 / Math.PI);
	},
	redrawBackgroundArcs: function() {
		var e = this, t = e.config, n = e.state, r = e.hasMultiArcGauge(), i = t.gauge_fullCircle, a = e.filterTargetsToShow(e.data.targets).length === 0 && !!t.data_empty_label_text, o = e.getStartingAngle(), s = i ? o + e.getArcLength() : o * -1, c = e.$el.arcs.select(`${r ? "g" : ""}.${L.chartArcsBackground}`);
		if (r) {
			var l = 0;
			c = c.selectAll(`path.${L.chartArcsBackground}`).data(e.data.targets), c.enter().append("path").attr("class", function(e, t) {
				return `${L.chartArcsBackground} ${L.chartArcsBackground}-${t}`;
			}).merge(c).style("fill", t.gauge_background || null).attr("d", function(r) {
				var i = r.id;
				if (a || n.hiddenTargetIds.indexOf(i) >= 0) return "M 0 0";
				var c = {
					data: [{ value: t.gauge_max }],
					startAngle: o,
					endAngle: s,
					index: l++
				};
				return e.getArc(c, !0, !0);
			}), c.exit().remove();
		} else c.attr("d", a ? "M 0 0" : function() {
			var n = {
				data: [{ value: t.gauge_max }],
				startAngle: o,
				endAngle: s
			};
			return e.getArc(n, !0, !0);
		});
	},
	bindArcEvent: function(e) {
		var t = this, n = t.config, r = t.state, i = r.inputType === "touch", a = r.inputType === "mouse";
		function o(e, n, r) {
			t.expandArc(r), t.api.focus(r), t.toggleFocusLegend(r, !0), t.showTooltip([n], e);
		}
		function s(e) {
			t.unexpandArc(void 0), t.api.revert(), t.revertLegend(), t.hideTooltip();
		}
		if (e.on("click", function(e, r, i) {
			var a, o = t.updateAngle(r), s;
			o && (s = t.convertToArcData(o), (a = t.toggleShape) == null || a.call(t, this, s, i), n.data_onclick.bind(t.api)(s, this));
		}), a && e.on("mouseover", function(e, n) {
			if (!r.transiting) {
				r.event = e;
				var i = t.updateAngle(n), a = i ? t.convertToArcData(i) : null, s = a?.id || void 0;
				o(this, a, s), t.setOverOut(!0, a);
			}
		}).on("mouseout", function(e, i) {
			if (!r.transiting && n.interaction_onout) {
				r.event = e;
				var a = t.updateAngle(i), o = a ? t.convertToArcData(a) : null;
				s(), t.setOverOut(!1, o);
			}
		}).on("mousemove", function(e, n) {
			var i = t.updateAngle(n), a = i ? t.convertToArcData(i) : null;
			r.event = e, t.showTooltip([a], this);
		}), i && t.hasArcType() && !t.radars) {
			var c = function(e) {
				var t = e.changedTouches?.[0] ?? {
					clientX: 0,
					clientY: 0
				}, n = t.clientX, r = t.clientY;
				return M(Df.elementFromPoint(n, r));
			};
			t.$el.svg.on("touchstart touchmove", function(e) {
				if (!r.transiting) {
					r.event = e;
					var n = c(e).datum(), i = n?.data && n.data.id ? t.updateAngle(n) : null, a = i ? t.convertToArcData(i) : null, l = a?.id || void 0;
					t.callOverOutForTouch(a), ep(l) ? s() : o(this, a, l);
				}
			}, { passive: !0 });
		}
	},
	redrawArcText: function(e) {
		var t = this, n = t.config, r = t.state, i = t.$el, a = i.main, o = i.arcs, s = t.hasType("gauge"), c = t.hasMultiArcGauge(), l;
		if (s && t.data.targets.length === 1 && n.gauge_title || (l = a.selectAll(`.${L.chartArc}`).select("text").style("opacity", "0").attr("class", function(e) {
			return t.isGaugeType(e.data) ? of.gaugeValue : null;
		}).call(t.textForArcLabel.bind(t)).style("font-size", function(e) {
			return t.isGaugeType(e.data) && t.data.targets.length === 1 && !c ? `${Math.round(r.radius / 5)}px` : null;
		}), Xm.call(t), l.attr("transform", function(e) {
			return t.transformForArcLabel.bind(t)(this, e);
		}).transition().duration(e).style("opacity", function(e) {
			return t.isTargetToShow(e.data.id) && t.isArcType(e.data) ? null : "0";
		}), c && l.attr("dy", "-.1em")), a.select(`.${L.chartArcsTitle}`).style("opacity", t.hasType("donut") || s ? null : "0"), s) {
			var u = n.gauge_fullCircle;
			u && l?.attr("dy", `${c ? 0 : Math.round(r.radius / 14)}`), n.gauge_label_show && (o.select(`.${of.chartArcsGaugeUnit}`).attr("dy", `${u ? 1.5 : .75}em`).text(n.gauge_units), o.select(`.${of.chartArcsGaugeMin}`).attr("dx", `${-1 * (r.innerRadius + (r.radius - r.innerRadius) / (u ? 1 : 2))}px`).attr("dy", "1.2em").text(t.textForGaugeMinMax(n.gauge_min, !1)), !u && o.select(`.${of.chartArcsGaugeMax}`).attr("dx", `${r.innerRadius + (r.radius - r.innerRadius) / 2}px`).attr("dy", "1.2em").text(t.textForGaugeMinMax(n.gauge_max, !0)));
		}
		hg.call(t) && gg.call(t, e);
	},
	getArcElementByIdOrIndex: function(e) {
		var t = this.$el.arcs, n = J(e) ? function(t) {
			return t.index === e;
		} : function(t) {
			return t.data.id === e;
		};
		return t?.selectAll(`.${I.target} path`).filter(n);
	}
}, wg = {
	initArea: function(e) {
		var t = this, n = t.config;
		e.insert("g", `.${n.area_front ? tf.circles : sf.lines}`).attr("class", t.getClass("areas", !0));
	},
	updateAreaColor: function(e) {
		var t = this;
		return t.config.area_linearGradient ? t.getGradienColortUrl(e.id) : t.color(e);
	},
	updateArea: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.config, i = n.state, a = n.$el, o = n.$T, s = t ? a.subchart : a;
		r.area_linearGradient && n.updateLinearGradient();
		var c = s.main.selectAll(`.${Zd.areas}`).selectAll(`.${Zd.area}`).data(n.lineData.bind(n));
		o(c.exit(), e).style("opacity", "0").remove(), s.area = c.enter().append("path").attr("class", n.getClass("area", !0)).style("fill", n.updateAreaColor.bind(n)).style("opacity", function() {
			return i.orgAreaOpacity = M(this).style("opacity"), "0";
		}).merge(c), c.style("opacity", i.orgAreaOpacity), n.setRatioForGroupedData(s.area.data());
	},
	redrawArea: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = (n ? this.$el.subchart : this.$el).area, a = r.state.orgAreaOpacity;
		return [r.$T(i, t, yp()).attr("d", e).style("fill", r.updateAreaColor.bind(r)).style("opacity", function(e) {
			return String(r.isAreaRangeType(e) ? a / 1.75 : a);
		})];
	},
	generateDrawArea: function(e, t) {
		var n = this, r = n.config, i = r.line_connectNull, a = r.axis_rotated, o = n.generateGetAreaPoints(e, t), s = n.getYScaleById.bind(n), c = function(e) {
			return (t ? n.subxx : n.xx).call(n, e);
		}, l = function(e, r) {
			return n.isGrouped(e.id) ? o(e, r)[0][1] : s(e.id, t)(n.isAreaRangeType(e) ? n.getRangedData(e, "high") : n.getShapeYMin(e.id));
		}, u = function(e, r) {
			return n.isGrouped(e.id) ? o(e, r)[1][1] : s(e.id, t)(n.isAreaRangeType(e) ? n.getRangedData(e, "low") : e.value);
		};
		return function(e) {
			var t = i ? n.filterRemoveNull(e.values) : e.values, o = 0, s = 0, d;
			if (n.isAreaType(e)) {
				var f = ql();
				f = a ? f.y(c).x0(l).x1(u) : f.x(c).y0(r.area_above ? 0 : r.area_below ? n.state.height : l).y1(u), i || (f = f.defined(function(e) {
					return n.getBaseValue(e) !== null;
				})), n.isStepType(e) && (t = n.convertValuesToStep(t)), d = f.curve(n.getCurve(e))(t);
			} else t[0] && (o = n.scale.x(t[0].x), s = n.getYScaleById(e.id)(t[0].value)), d = a ? `M ${s} ${o}` : `M ${o} ${s}`;
			return d || "M 0 0";
		};
	},
	generateGetAreaPoints: function(e, t) {
		var n = this, r = n.config, i = n.getShapeX(0, e, t), a = n.getShapeY(!!t), o = n.getShapeOffset(n.isAreaType, e, t), s = n.getYScaleById.bind(n);
		return function(e, c) {
			var l = s.call(n, e.id, t)(n.getShapeYMin(e.id)), u = o(e, c) || l, d = i(e), f = e.value, p = a(e);
			return r.axis_rotated && (f > 0 && p < l || f < 0 && l < p) && (p = l), [
				[d, u],
				[d, p - (l - u)],
				[d, p - (l - u)],
				[d, u]
			];
		};
	}
};
function Tg(e) {
	var t = this.config.bar_connectLine, n = t?.[e] || t;
	return /^(start|end)\-(start|end)$/.test(n) ? n : null;
}
var Eg = {
	initBar: function() {
		var e = this, t = e.$el, n = e.config, r = e.state.clip;
		t.bar = t.main.select(`.${I.chart}`), t.bar = n.bar_front ? t.bar.append("g") : t.bar.insert("g", ":first-child"), t.bar.attr("class", $d.chartBars).call(this.setCssRule(!1, `.${$d.chartBars}`, ["pointer-events:none"])), n.clipPath === !1 && (n.bar_radius || n.bar_radius_ratio) && t.bar.attr("clip-path", r.pathXAxis.replace(/#[^)]*/, `#${r.id}`));
	},
	updateTargetsForBar: function(e) {
		var t = this, n = t.config, r = t.$el, i = t.getChartClass("Bar"), a = t.getClass("bars", !0), o = t.classFocus.bind(t), s = n.interaction_enabled && n.data_selection_isselectable;
		r.bar || t.initBar(), r.main.select(`.${$d.chartBars}`).selectAll(`.${$d.chartBar}`).data(t.filterNullish(e)).attr("class", function(e) {
			return i(e) + o(e);
		}).enter().append("g").attr("class", i).style("opacity", "0").style("pointer-events", t.getStylePropValue("none")).append("g").attr("class", a).style("cursor", function(e) {
			return (s?.bind)?.call(s, t.api)(e) ? "pointer" : null;
		}).call(function(e) {
			t.setCssRule(!0, ` .${$d.bar}`, ["fill"], t.color)(e), e.each(function(e) {
				Tg.call(t, e.id) && M(this).append("path").attr("class", $d.barConnectLine);
			});
		});
	},
	updateBar: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.config, i = n.$el, a = n.$T, o = t ? i.subchart : i, s = n.getClass("bar", !0), c = n.initialOpacity.bind(n);
		r.bar_linearGradient && n.updateLinearGradient();
		var l = o.main.selectAll(`.${$d.bars}`).selectAll(`.${$d.bar}`).data(n.labelishData.bind(n));
		a(l.exit(), e).style("opacity", "0").remove(), o.bar = l.enter().append("path").attr("class", s).style("fill", n.updateBarColor.bind(n)).merge(l).style("opacity", c), n.setRatioForGroupedData(o.bar.data());
	},
	updateBarColor: function(e) {
		var t = this, n = t.getStylePropValue(t.color);
		return t.config.bar_linearGradient ? t.getGradienColortUrl(e.id) : n ? n(e) : null;
	},
	redrawBar: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = (n ? r.$el.subchart : r.$el).bar, a = [];
		return [r.$T(i, t, yp()).attr("d", function(n, i, o) {
			var s = (J(n.value) || r.isBarRangeType(n)) && e(n, i), c = Tg.call(r, n.id);
			if (s.length > 1 && (a.push(s[1]), i === o.length - 1)) {
				var l = r.$T(M(this.parentNode.querySelector(`.${$d.barConnectLine}`)), t, yp());
				r.updateConnectLine(l, c, a), a.splice(0);
			}
			return s[0];
		}).style("fill", r.updateBarColor.bind(r)).style("clip-path", function(e) {
			return e.clipPath;
		}).style("opacity", null)];
	},
	generateDrawBar: function(e, t) {
		var n = this, r = n.config, i = n.generateGetBarPoints(e, t), a = r.axis_rotated, o = r.bar_radius, s = r.bar_radius_ratio, c = J(o) && o > 0 ? function() {
			return o;
		} : J(s) ? function(e) {
			return e * s;
		} : null;
		return function(e, t) {
			var o = i(e, t), s = +a, l = +!s, u = e.value < 0, d = r[`axis_${n.axis.getId(e.id)}_inverted`], f = !d && u || d && !u, p = ["", ""], m = n.isGrouped(e.id), h = c && m ? n.isStackingRadiusData(e) : !1, g = [o[0][s], o[0][l]], _ = 0;
			if (e.clipPath = null, c) {
				var v = a ? l : s, y = o[2][v] - o[0][v];
				_ = !m || h ? c(y) : 0;
				var b = `a${_} ${_} ${f ? "1 0 0" : "0 0 1"} `;
				p[+!a] = `${b}${_},${_}`, p[+a] = `${b}${[-_, _][a ? "sort" : "reverse"]()}`, f && p.reverse();
			}
			var x = a ? o[1][s] + (f ? _ : -_) : o[1][l] + (f ? -_ : _);
			if (_) {
				var S = "";
				a ? f && g[0] < x ? S = `0 ${x - g[0]}px 0 0` : !f && g[0] > x && (S = `0 0 0 ${g[0] - x}px`) : f && g[1] > x ? S = `${g[1] - x}px 0 0 0` : !f && g[1] < x && (S = `0 0 ${x - g[1]}px 0`), S && (e.clipPath = `inset(${S})`);
			}
			var C = a ? `H${x} ${p[0]}V${o[2][l] - _} ${p[1]}H${o[3][s]}` : `V${x} ${p[0]}H${o[2][s] - _} ${p[1]}V${o[3][l]}`, w = [`M${o[0][s]},${o[0][l]}${C}z`];
			return Tg.call(n, e.id) && w.push(a ? {
				x: o[0][s],
				y: o[0][l],
				width: o[0][s] - x,
				height: o[2][l] - o[0][l]
			} : {
				x: o[0][s],
				y: x,
				width: o[2][s] - o[0][s],
				height: o[3][l] - x
			}), w;
		};
	},
	isStackingRadiusData: function(e) {
		var t = this, n = t.$el, r = t.config, i = t.data, a = t.state, o = e.id, s = e.index, c = e.value;
		if (a.hiddenTargetIds.indexOf(o) > -1) {
			var l = n.bar.filter(function(e) {
				return e.id === o && e.value === c;
			});
			return !l.empty() && /a\d+/i.test(l.attr("d"));
		}
		var u = r.data_groups.find(function(e) {
			return e.indexOf(o) > -1;
		}), d = t.orderTargets(t.filterTargetsToShow(i.targets.filter(t.isBarType, t))).filter(function(e) {
			return u.indexOf(e.id) > -1;
		}).map(function(e) {
			return e.values.filter(function(e) {
				return e.index === s && (J(c) && c > 0 ? e.value > 0 : e.value < 0);
			})[0];
		}).filter(Boolean).map(function(e) {
			return e.id;
		});
		return c !== 0 && d.indexOf(o) === d.length - 1;
	},
	generateGetBarPoints: function(e, t) {
		var n = this, r = n.config, i = t ? n.axis.subX : n.axis.x, a = n.getIndicesMax(e) + 1, o = n.getBarW("bar", i, a), s = n.getShapeX(o, e, !!t), c = n.getShapeY(!!t), l = n.getShapeOffset(n.isBarType, e, !!t), u = n.getYScaleById.bind(n);
		return function(e, i) {
			var a = e.id, d = u.call(n, a, t)(n.getShapeYMin(a)), f = l(e, i) || d, p = J(o) ? o : o[e.id] || o._$width, m = r[`axis_${n.axis.getId(a)}_inverted`], h = e.value, g = s(e), _ = c(e);
			r.axis_rotated && !m && (h > 0 && _ < d || h < 0 && d < _) && (_ = d), n.isBarRangeType(e) || (_ -= d - f);
			var v = g + p;
			return [
				[g, f],
				[g, _],
				[v, _],
				[v, f]
			];
		};
	},
	updateConnectLine: function(e, t, n) {
		var r = this, i = n.map(function(e, n, i) {
			var a = r.config.axis_rotated, o = /^start-(start|end)$/.test(t), s = /^end-(start|end)$/.test(t), c = [], l = a ? s ? e.x - e.width : e.x : e.x + e.width, u = a || o ? e.y + e.height : e.y;
			return n === 0 ? c.push(`${l},${u}`) : (c.push(a ? `L${e.x - (/\w+-end$/.test(t) ? e.width : 0)},${e.y}` : `L${e.x},${e.y + (/\w+-start$/.test(t) ? e.height : 0)}`), n < i.length - 1 && c.push(`M${l},${u}`)), c.join(" ");
		});
		e.attr("d", `M${i.join("")}z`);
	}
}, Dg = {
	initBubble: function() {
		var e = this, t = e.config;
		e.hasType("bubble") && (t.point_show = !0, t.point_type = "circle");
	},
	getBaseLength: function() {
		var e = this, t = e.state, n = t.width, r = t.height, i = $p.bubbleBaseLength, a = e.cache.get(i);
		return a || e.cache.add(i, a = Ip("min", [n, r])), a;
	},
	getBubbleR: function(e) {
		var t = this, n = t.config.bubble_maxR;
		K(n) ? n = n.bind(t.api)(e) : J(n) || (n = t.getBaseLength() / (t.getMaxDataCount() * 2) + 12);
		var r = Ip("max", t.getMinMaxData().max.map(function(e) {
			return t.isBubbleZType(e) ? t.getBubbleZData(e.value, "y") : Z(e.value) ? e.value.mid : e.value;
		})), i = n * n * Math.PI, a = (t.isBubbleZType(e) ? t.getBubbleZData(e.value, "z") : e.value) * (i / r);
		return Math.sqrt(a / Math.PI);
	},
	getBubbleZData: function(e, t) {
		return Z(e) ? e[t] : e[t === "y" ? 0 : 1];
	}
}, Og = {
	initCandlestick: function() {
		var e = this.$el;
		e.candlestick = e.main.select(`.${I.chart}`).append("g").attr("class", ef.chartCandlesticks);
	},
	updateTargetsForCandlestick: function(e) {
		var t = this, n = t.$el, r = t.getChartClass("Candlestick");
		n.candlestick || t.initCandlestick(), t.$el.main.select(`.${ef.chartCandlesticks}`).selectAll(`.${ef.chartCandlestick}`).data(t.filterNullish(e)).enter().append("g").attr("class", r).style("pointer-events", "none");
	},
	updateCandlestick: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.$el, i = n.$T, a = t ? r.subchart : r, o = n.getClass("candlestick", !0), s = n.initialOpacity.bind(n), c = a.main.selectAll(`.${ef.chartCandlestick}`).selectAll(`.${ef.candlestick}`).data(n.labelishData.bind(n));
		i(c.exit(), e).style("opacity", "0").remove();
		var l = c.enter().filter(function(e) {
			return e.value;
		}).append("g").attr("class", o);
		l.append("line"), l.append("path"), a.candlestick = c.merge(l).style("opacity", s);
	},
	generateDrawCandlestick: function(e, t) {
		var n = this, r = n.config, i = n.generateGetCandlestickPoints(e, t), a = r.axis_rotated, o = r.candlestick_color_down;
		return function(e, t, r) {
			var s = i(e, t), c = n.getCandlestickData(e)?._isUp, l = +a, u = +!l;
			r.classed && r.classed(ef[c ? "valueUp" : "valueDown"], !0);
			var d = a ? `H${s[1][1]} V${s[1][0]} H${s[0][1]}` : `V${s[1][1]} H${s[1][0]} V${s[0][1]}`;
			r.select("path").attr("d", `M${s[0][l]},${s[0][u]}${d}z`).style("fill", function(e) {
				return (c ? n.color(e) : Z(o) ? o[e.id] : o) || n.color(e);
			});
			var f = r.select("line"), p = a ? {
				x1: s[2][1],
				x2: s[2][2],
				y1: s[2][0],
				y2: s[2][0]
			} : {
				x1: s[2][0],
				x2: s[2][0],
				y1: s[2][1],
				y2: s[2][2]
			};
			for (var m in p) f.attr(m, p[m]);
		};
	},
	generateGetCandlestickPoints: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = t ? n.axis.subX : n.axis.x, i = n.getIndicesMax(e) + 1, a = n.getBarW("candlestick", r, i), o = n.getShapeX(a, e, !!t), s = n.getShapeY(!!t), c = n.getShapeOffset(n.isBarType, e, !!t), l = n.getYScaleById.bind(n);
		return function(e, r) {
			var i = l.call(n, e.id, t)(n.getShapeYMin(e.id)), u = c(e, r) || i, d = J(a) ? a : a[e.id] || a._$width, f = n.getCandlestickData(e), p;
			if (f && J(f.open) && J(f.close)) {
				var m = {
					start: o(e),
					end: 0
				};
				m.end = m.start + d;
				var h = {
					start: s(f.open),
					end: s(f.close)
				}, g = {
					x: m.start + d / 2,
					high: s(f.high),
					low: s(f.low)
				};
				h.start -= i - u, p = [
					[m.start, h.start],
					[m.end, h.end],
					[
						g.x,
						g.low,
						g.high
					]
				];
			} else p = [
				[0, 0],
				[0, 0],
				[
					0,
					0,
					0
				]
			];
			return p;
		};
	},
	redrawCandlestick: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = r.$el, a = r.$T, o = (n ? i.subchart : i).candlestick, s = yp(!0);
		return [o.each(function(n, r) {
			e(n, r, a(M(this), t, s));
		}).style("opacity", null)];
	},
	getCandlestickData: function(e) {
		var t = e.value, n;
		if (X(t)) {
			var r = t[0], i = t[1], a = t[2], o = t[3], s = t[4], c = s !== void 0 && s;
			n = {
				open: r,
				high: i,
				low: a,
				close: o
			}, c !== !1 && (n.volume = c);
		} else Z(t) && (n = F({}, t));
		return n && (n._isUp = n.close >= n.open), n || null;
	}
};
function kg(e) {
	e === void 0 && (e = !1);
	var t = this, n = t.config, r = t.state.current, i = r.width, a = r.height, o = t.getCurrentPadding(), s = F({
		width: i - (o.left + o.right),
		height: a - (n.legend_show ? t.getLegendHeight() + 10 : 0) - (o.top + o.bottom)
	}, o);
	if (e) {
		var c = Ag.call(t, {
			width: s.width,
			height: s.height
		}), l = c.width, u = c.height;
		s.width < l && (s.width = l), s.height < u && (s.height = u);
	}
	return s;
}
function Ag(e) {
	var t, n = this.config, r = n.funnel_neck_width, i = n.funnel_neck_height;
	return t = [r, i].map(function(t, n) {
		var r = t;
		return Z(t) && (r = e[n ? "height" : "width"] * t.ratio), r;
	}), r = t[0], i = t[1], {
		width: r,
		height: i
	};
}
function jg(e) {
	var t = this, n = kg.call(t, !0), r = n.top, i = n.left, a = n.width, o = [];
	return e.forEach(function(e, t) {
		var n = e.ratio, s = t > 0 ? o[t - 1][2][1] : r;
		o.push(e.coords = [
			[i, s],
			[i + a, s],
			[i + a, t > 0 ? n + s : n + r],
			[i, t > 0 ? n + s : n + r],
			[i, s]
		]);
	}), o;
}
function Mg(e) {
	e === void 0 && (e = !1);
	var t = this, n = kg.call(t, !0), r = n.width, i = n.height, a = n.top, o = n.left, s = Ag.call(t, {
		width: r,
		height: i
	}), c = (r - s.width) / 2, l = (r + s.width) / 2, u = i - s.height, d = [
		[0, 0],
		[r, 0],
		[l, u],
		[l, i],
		[c, i],
		[c, u],
		[0, 0]
	];
	return e && d.forEach(function(e) {
		e[0] += o, e[1] += a;
	}), `M${d.join("L")}z`;
}
function Ng(e) {
	var t = this, n = t.config, r = e.map(function(e) {
		return {
			id: e.id,
			value: e.values.reduce(function(e, t) {
				return e + t.value;
			}, 0)
		};
	});
	return n.data_order && r.sort(t.getSortCompareFn.bind(t)(!0)), Pg.call(t, r);
}
function Pg(e) {
	var t = this, n = kg.call(t).height, r = t.getTotalDataSum(!0);
	return e.forEach(function(e) {
		e.ratio = e.value / r * n;
	}), e;
}
var Fg = {
	initFunnel: function() {
		var e = this, t = e.$el;
		t.funnel = t.main.select(`.${I.chart}`).append("g").classed(af.chartFunnels, !0), t.funnel.background = t.funnel.append("path").classed(af.funnelBackground, !0), e.bindFunnelEvent();
	},
	bindFunnelEvent: function() {
		var e = this, t = e.$el.funnel, n = e.config, r = e.state, i = function(e) {
			var t = e.isTrusted ? e.target : r.eventReceiver.rect?.node(), n;
			return /^path$/i.test(t.tagName) && (r.event = e, n = M(t).datum()), n;
		};
		if (n.interaction_enabled) {
			var a = r.inputType === "touch";
			t.on(a ? "touchstart" : "mouseover mousemove", function(t) {
				var n = i(t);
				n && (e.showTooltip([n], t.target), /^(touchstart|mouseover)$/.test(t.type) && e.setOverOut(!0, n));
			}, a ? { passive: !0 } : void 0).on(a ? "touchend" : "mouseout", function(t) {
				var r = i(t);
				n.interaction_onout && (e.hideTooltip(), e.setOverOut(!1, r));
			});
		}
	},
	updateTargetsForFunnel: function(e) {
		var t = this, n = t.$el.funnel, r = t.getChartClass("Funnel"), i = t.getClass("funnel", !0);
		n || t.initFunnel();
		var a = Ng.call(t, e.filter(t.isFunnelType.bind(t))), o = n.selectAll(`.${af.chartFunnel}`).data(t.filterNullish(a));
		o.exit().remove();
		var s = o.enter().insert("g", `.${af.funnelBackground}`);
		s.append("path"), n.path = s.merge(o).attr("class", function(e) {
			return r(e);
		}).select("path").attr("class", i).style("opacity", "0").style("fill", t.color);
	},
	updateFunnel: function(e) {
		var t = this.$el.funnel, n = e.map(function(e) {
			return e.id;
		});
		t.path = t.path.filter(function(e) {
			return n.indexOf(e.id) >= 0;
		});
	},
	generateGetFunnelPoints: function() {
		var e = this, t = e.$el.funnel, n = e.filterTargetsToShow(t.path), r = kg.call(e), i = r.top, a = (r.left - r.right) / 2, o = {}, s = i ?? 0;
		return n.each(function(e, t) {
			o[e.id] = [[a, s], [a, s += (n?.[t] ?? e).ratio]];
		}), function(e) {
			return o[e.id];
		};
	},
	redrawFunnel: function() {
		var e = this, t = e.$T, n = e.$el.funnel, r = e.filterTargetsToShow(n.path), i = jg.call(e, Pg.call(e, r.data()));
		n.attr("clip-path", `path('${Mg.bind(e)()}')`), n.background.attr("d", Mg.call(e, !0)), t(r).attr("d", function(e, t) {
			return `M${i[t].join("L")}z`;
		}).style("opacity", "1"), n.selectAll("g").style("opacity", null);
	}
}, Ig = {
	initGauge: function() {
		var e = this, t = e.config, n = e.$el.arcs, r = function(e, t) {
			e === void 0 && (e = null), t === void 0 && (t = ""), n.append("text").attr("class", e).style("text-anchor", "middle").style("pointer-events", "none").text(t);
		};
		if (e.hasType("gauge")) {
			var i = e.hasMultiArcGauge();
			n.append(i ? "g" : "path").attr("class", L.chartArcsBackground).style("fill", !i && t.gauge_background || null), t.gauge_units && r(of.chartArcsGaugeUnit), t.gauge_label_show && (r(of.chartArcsGaugeMin), !t.gauge_fullCircle && r(of.chartArcsGaugeMax));
		}
	},
	updateGaugeMax: function() {
		var e = this, t = e.config, n = e.state, r = e.hasMultiArcGauge() ? e.getMinMaxData().max[0].value : e.getTotalDataSum(n.rendered);
		!t.gauge_enforceMinMax && r + t.gauge_min * (t.gauge_min > 0 ? -1 : 1) > t.gauge_max && (t.gauge_max = r - t.gauge_min);
	},
	redrawArcGaugeLine: function() {
		var e = this, t = e.config, n = e.state, r = e.$el, i = e.state.hiddenTargetIds, a = r.main.selectAll(`.${L.arcs}`).selectAll(`.${L.arcLabelLine}`).data(e.arcData.bind(e));
		a.enter().append("rect").attr("class", function(e) {
			return `${L.arcLabelLine} ${I.target} ${I.target}-${e.data.id}`;
		}).merge(a).style("fill", function(t) {
			return e.levelColor ? e.levelColor(t.data.values[0].value) : e.color(t.data);
		}).style("display", t.gauge_label_show ? null : "none").each(function(t) {
			var r = 0, a = 2, o = 0, s = 0, c = "";
			if (i.indexOf(t.data.id) < 0) {
				var l = e.updateAngle(t), u = n.gaugeArcWidth / e.filterTargetsToShow(e.data.targets).length * (l.index + 1), d = l.endAngle - Math.PI / 2, f = n.radius - u, p = d - (f === 0 ? 0 : 1 / f);
				r = n.radiusExpanded - n.radius + u, o = Math.cos(p) * f, s = Math.sin(p) * f, c = `rotate(${d * 180 / Math.PI}, ${o}, ${s})`;
			}
			M(this).attr("x", o).attr("y", s).attr("width", r).attr("height", a).attr("transform", c).style("stroke-dasharray", `0, ${r + a}, 0`);
		});
	},
	textForGaugeMinMax: function(e, t) {
		var n = this, r = n.config.gauge_label_extents;
		return K(r) ? r.bind(n.api)(e, t) : e;
	},
	getGaugeLabelHeight: function() {
		var e = this.config;
		return this.config.gauge_label_show && !e.gauge_fullCircle ? 20 : 0;
	},
	getPaddingBottomForGauge: function() {
		var e = this;
		return e.getGaugeLabelHeight() * (e.config.gauge_label_show ? 2 : 2.5);
	}
};
function Lg(e, t, n, r) {
	r === void 0 && (r = !1);
	for (var i = e ? [e, 0] : n, a = function(e) {
		n.forEach(function(n) {
			e + n <= t && i.push(n), e += n;
		}), o = e;
	}, o, s = e || n.reduce(function(e, t) {
		return e + t;
	}); s <= t;) a(s), s = o;
	return i.length % 2 != 0 && i.push(r ? n[1] : 0), {
		dash: i.join(" "),
		length: i.reduce(function(e, t) {
			return e + t;
		}, 0)
	};
}
function Rg(e, t, n) {
	var r = this, i = [], a = "2 2";
	if (Y(t)) for (var o = function(e, t) {
		return ep(e) ? t : n ? Bp.call(r, e) : e;
	}, s = 0, c = void 0; c = t[s]; s++) {
		var l = o(c.start, e[0].x), u = o(c.end, e[e.length - 1].x), d = c.style || { dasharray: a };
		i[s] = {
			start: l,
			end: u,
			style: d
		};
	}
	return i;
}
var zg = {
	initLine: function() {
		var e = this.$el;
		e.line = e.main.select(`.${I.chart}`).append("g").attr("class", sf.chartLines).call(this.setCssRule(!1, `.${sf.chartLines}`, ["pointer-events:none"]));
	},
	updateTargetsForLine: function(e) {
		var t = this, n = t.$el, r = n.area, i = n.line, a = n.main, o = t.getChartClass("Line"), s = t.getClass("lines", !0), c = t.classFocus.bind(t);
		i || t.initLine();
		var l = e.filter(function(e) {
			return !(t.isScatterType(e) || t.isBubbleType(e));
		}), u = a.select(`.${sf.chartLines}`).selectAll(`.${sf.chartLine}`).data(t.filterNullish(l)).attr("class", function(e) {
			return o(e) + c(e);
		}), d = u.enter().append("g").attr("class", o).style("opacity", "0").style("pointer-events", t.getStylePropValue("none"));
		if (d.append("g").attr("class", s), t.hasTypeOf("Area")) {
			var f = (!r && d.empty() ? u : d).filter(t.isAreaType.bind(t));
			t.initArea(f);
		}
		t.updateTargetForCircle(l, d);
	},
	updateLine: function(e, t) {
		t === void 0 && (t = !1);
		var n = this, r = n.format.extraLineClasses, i = n.$el, a = n.$T, o = t ? i.subchart : i, s = o.main.selectAll(`.${sf.lines}`).selectAll(`.${sf.line}`).data(n.lineData.bind(n));
		a(s.exit(), e).style("opacity", "0").remove(), o.line = s.enter().append("path").attr("class", function(e) {
			return `${n.getClass("line", !0)(e)} ${r(e) || ""}`;
		}).style("stroke", n.color).merge(s).style("opacity", n.initialOpacity.bind(n)).attr("transform", null);
	},
	redrawLine: function(e, t, n) {
		n === void 0 && (n = !1);
		var r = this, i = r.$el, a = r.$T, o = (n ? i.subchart : i).line;
		return [a(o, t, yp()).attr("d", e).style("stroke", this.color).style("opacity", null)];
	},
	getCurve: function(e) {
		var t = this;
		return t.config.axis_rotated && t.isStepType(e) ? function(n) {
			var r = t.getInterpolate(e)(n);
			return r.orgPoint = r.point, r.pointRotated = function(e, t) {
				this._point === 1 && (this._point = 2);
				var n = this._y * (1 - this._t) + t * this._t;
				this._context.lineTo(this._x, n), this._context.lineTo(e, n), this._x = e, this._y = t;
			}, r.point = function(e, t) {
				this._point === 0 ? this.orgPoint(e, t) : this.pointRotated(e, t);
			}, r;
		} : t.getInterpolate(e);
	},
	generateDrawLine: function(e, t) {
		var n = this, r = n.config, i = n.scale, a = r.line_connectNull, o = r.axis_rotated, s = n.generateGetLinePoints(e, t), c = n.getYScaleById.bind(n), l = function(e) {
			return (t ? n.subxx : n.xx).call(n, e);
		}, u = function(e, r) {
			return n.isGrouped(e.id) ? s(e, r)[0][1] : c(e.id, t)(n.getBaseValue(e));
		}, d = Kl();
		d = o ? d.x(u).y(l) : d.x(l).y(u), a || (d = d.defined(function(e) {
			return n.getBaseValue(e) !== null;
		}));
		var f = t ? i.subX : i.x;
		return function(e) {
			var s = c(e.id, t), l = a ? n.filterRemoveNull(e.values) : e.values, u = 0, p = 0, m;
			if (n.isLineType(e)) {
				var h = r.data_regions[e.id];
				h ? (n.isAreaRangeType(e) && (l = l.map(function(e) {
					return F(F({}, e), { value: n.getRangedData(e, "mid") });
				})), m = n.lineWithRegions(l, i.zoom || f, s, h)) : (n.isStepType(e) && (l = n.convertValuesToStep(l)), m = d.curve(n.getCurve(e))(l));
			} else l[0] && (u = f(l[0].x), p = s(l[0].value)), m = o ? `M ${p} ${u}` : `M ${u} ${p}`;
			return m || "M 0 0";
		};
	},
	lineWithRegions: function(e, t, n, r) {
		for (var i = this, a = i.config.axis_rotated, o = i.axis.isTimeSeries(), s = "2 2", c = Rg.bind(i)(e, r, o), l = i.hasNullDataValue(e), u, d, f, p, m = a ? function(e) {
			return n(e.value);
		} : function(e) {
			return t(e.x);
		}, h = a ? function(e) {
			return t(e.x);
		} : function(e) {
			return n(e.value);
		}, g = function(e) {
			return `M${e[0][0]},${e[0][1]}L${e[1][0]},${e[1][1]}`;
		}, _ = o ? function(e, r, i, o) {
			var s = e.x.getTime(), c = r.x - e.x, l = new Date(s + c * i), u = new Date(s + c * (i + o));
			return g(a ? [[n(d(i)), t(l)], [n(d(i + f)), t(u)]] : [[t(l), n(d(i))], [t(u), n(d(i + f))]]);
		} : function(e, r, i, o) {
			var s = t(r.x, !a), c = n(r.value, a), l = i + o, f = t(u(i), !a), p = n(d(i), a), m = t(u(l), !a), h = n(d(l), a);
			m > s && (m = s), e.value > r.value && (a ? h < c : h > c) && (h = c);
			var _ = [[f, p], [m, h]];
			return a && _.forEach(function(e) {
				return e.reverse();
			}), g(_);
		}, v = {
			x: i.axis.getAxisType("x"),
			y: i.axis.getAxisType("y")
		}, y = "", b = i.$el.line.filter(function(t) {
			return t.id === e[0].id;
		}), x = b.clone().style("display", "none"), S = function(e, t) {
			return e.attr("d", t).node().getTotalLength();
		}, C = {
			dash: [],
			lastLength: 0
		}, w = !1, T = 0, E = void 0; E = e[T]; T++) {
			var D = e[T - 1], O = D && G(D.value), k = i.isWithinRegions(E.x, c);
			if (G(E.value)) {
				if (ep(c) || !k || !O) y += `${T && O ? "L" : "M"}${m(E)},${h(E)}`;
				else if (O) {
					if (k = (k?.dasharray || s).split(" ").map(Number), u = Vm(v.x, D.x, E.x), d = Vm(v.y, D.value, E.value), l) {
						var ee = t(E.x) - t(D.x), A = n(E.value) - n(D.value), te = Math.sqrt(ee ** 2 + A ** 2);
						f = k[0] / te, p = f * k[1];
						for (var j = f; j <= 1; j += p) y += _(D, E, j, f), j + p >= 1 && (y += _(D, E, 1, 0));
					} else {
						var ne = [];
						if (w = E.x === e[e.length - 1].x, o) {
							var re = +D.x, ie = new Date(re), ae = new Date(re + (+E.x - re));
							ne = [[t(ie), n(d(0))], [t(ae), n(d(1))]];
						} else ne = [[t(u(0)), n(d(0))], [t(u(1)), n(d(1))]];
						a && ne.forEach(function(e) {
							return e.reverse();
						});
						var oe = S(x, y), se = S(x, y += `L${ne[1].join(",")}`), ce = Lg(oe - C.lastLength, se - C.lastLength, k, w);
						C.lastLength += ce.length, C.dash.push(ce.dash);
					}
				}
			}
		}
		return C.dash.length && (!w && C.dash.push(S(x, y)), x.remove(), b.attr("stroke-dasharray", C.dash.join(" "))), y;
	},
	isWithinRegions: function(e, t) {
		for (var n = 0, r = void 0; r = t[n]; n++) if (r.start < e && e <= r.end) return r.style;
		return !1;
	},
	isWithinStep: function(e, t) {
		return Math.abs(t - hp(this.state.event, e)[1]) < 30;
	},
	shouldDrawPointsForLine: function(e) {
		var t = this.config.line_point;
		return t === !0 || X(t) && t.indexOf(e.id) !== -1;
	}
}, Bg = function() {
	return yp();
}, Vg = {
	initialOpacityForCircle: function(e) {
		var t = this, n = t.config, r = t.state.withoutFadeIn, i = n.point_opacity;
		return ep(i) && (i = this.getBaseValue(e) !== null && r[e.id] ? this.opacityForCircle(e) : "0"), i;
	},
	opacityForCircle: function(e) {
		var t = this.config, n = t.point_opacity;
		return ep(n) && (n = t.point_show && !this.isPointFocusOnly?.call(this) ? null : "0", n = G(this.getBaseValue(e)) ? this.isBubbleType(e) || this.isScatterType(e) ? "0.5" : n : "0"), n;
	},
	initCircle: function() {
		var e = this, t = e.$el.main;
		!e.point && (e.point = e.generatePoint()), (e.hasType("bubble") || e.hasType("scatter")) && t.select(`.${I.chart} > .${tf.chartCircles}`).empty() && t.select(`.${I.chart}`).append("g").attr("class", tf.chartCircles);
	},
	updateTargetForCircle: function(e, t) {
		var n = this, r = this, i = r.config, a = r.data, o = r.$el, s = i.interaction_enabled && i.data_selection_enabled, c = s && i.data_selection_isselectable, l = r.getClass("circles", !0);
		if (i.point_show) {
			r.initCircle();
			var u = e, d = t;
			if (!u) {
				u = r.filterNullish(a.targets).filter(function(e) {
					return n.isScatterType(e) || n.isBubbleType(e);
				});
				var f = o.main.select(`.${tf.chartCircles}`).style("pointer-events", "none").selectAll(`.${tf.circles}`).data(u);
				f.exit().remove(), d = f.enter();
			}
			s && d.append("g").attr("class", function(e) {
				return r.generateClass(V.selectedCircles, e.id);
			}), d.append("g").attr("class", l).call(function(e) {
				r.setCssRule(!0, `.${tf.circles}`, ["cursor:pointer"], c)(e), r.setCssRule(!0, ` .${tf.circle}`, ["fill", "stroke"], r.color)(e);
			}).style("opacity", function() {
				return M(this.parentNode).attr("class").indexOf(tf.chartCircles) > -1 ? "0" : null;
			}), s && u.forEach(function(e) {
				o.main.selectAll(`.${V.selectedCircles}${r.getTargetSelectorSuffix(e.id)}`).selectAll(`${V.selectedCircle}`).each(function(t) {
					t.value = e.values[t.index].value;
				});
			});
		}
	},
	updateCircle: function(e) {
		e === void 0 && (e = !1);
		var t = this, n = t.config, r = t.state, i = t.$el, a = t.isPointFocusOnly(), o = e ? i.subchart : i;
		if (n.point_show && !r.toggling) {
			n.point_radialGradient && t.updateLinearGradient();
			var s = o.main.selectAll(`.${tf.circles}`).selectAll(`.${tf.circle}`).data(function(e) {
				var n = t.isLineType(e) && t.shouldDrawPointsForLine(e) || t.isBubbleType(e) || t.isRadarType(e) || t.isScatterType(e) ? a ? [e.values[0]] : e.values : [];
				return t.filterNullish(n);
			});
			s.exit().remove(), s.enter().filter(Boolean).append(t.point("create", this, t.pointR.bind(t), t.updateCircleColor.bind(t))), o.circle = o.main.selectAll(`.${tf.circles} .${tf.circle}`).style("stroke", t.getStylePropValue(t.color)).style("opacity", t.initialOpacityForCircle.bind(t));
		}
	},
	updateCircleColor: function(e) {
		var t = this, n = t.getStylePropValue(t.color);
		return t.config.point_radialGradient ? t.getGradienColortUrl(e.id) : n ? n(e) : null;
	},
	redrawCircle: function(e, t, n, r, i) {
		i === void 0 && (i = !1);
		var a = this, o = a.state.rendered, s = a.$el, c = a.$T, l = i ? s.subchart : s, u = l.main.selectAll(`.${V.selectedCircle}`);
		if (!a.config.point_show) return [];
		var d = a.point("update", a, e, t, a.updateCircleColor.bind(a), n, r, u), f = a.isCirclePoint() ? "c" : "", p = yp(), m = a.opacityForCircle.bind(a), h = [];
		return l.circle.each(function(e) {
			var t = d.bind(this)(e);
			t = c(t, n || !o, p).style("opacity", m), h.push(t);
		}), [h, c(u, n).attr(`${f}x`, e).attr(`${f}y`, t)];
	},
	showCircleFocus: function(e) {
		var t = this, n = t.state, r = n.hasRadar, i = n.resizing, a = n.toggling, o = n.transiting, s = t.$el.circle;
		if (o === !1 && s && t.isPointFocusOnly()) {
			var c = (r ? t.radarCircleX : t.circleX).bind(t), l = (r ? t.radarCircleY : t.circleY).bind(t), u = a || ep(e), d = t.point("update", t, c, l, t.getStylePropValue(t.color), !i && u);
			e && (s = s.filter(function(t) {
				var n = e.filter?.call(e, function(e) {
					return e.id === t.id;
				});
				return n.length ? M(this).datum(n[0]) : !1;
			})), s.attr("class", this.updatePointClass.bind(this)).style("opacity", null).each(function(e) {
				var n = e.id, r = e.index, i = e.value, a = "hidden";
				G(i) && (d.bind(this)(e), t.expandCircles(r, n), a = ""), this.style.visibility = a;
			});
		}
	},
	hideCircleFocus: function() {
		var e = this, t = e.$el.circle;
		e.isPointFocusOnly() && t && (e.unexpandCircles(), t.style("visibility", "hidden"));
	},
	circleX: function(e) {
		return this.xx(e);
	},
	updateCircleY: function(e) {
		e === void 0 && (e = !1);
		var t = this, n = t.generateGetLinePoints(t.getShapeIndices(t.isLineType), e);
		return function(r, i) {
			var a = r.id;
			return t.isGrouped(a) ? n(r, i)[0][1] : t.getYScaleById(a, e)(t.getBaseValue(r));
		};
	},
	expandCircles: function(e, t, n) {
		var r = this, i = r.pointExpandedR.bind(r);
		n && r.unexpandCircles();
		var a = r.getShapeByIndex("circle", e, t).classed(I.EXPANDED, !0), o = i(a) / r.config.point_r, s = 1 - o;
		r.isCirclePoint() ? a.attr("r", i) : a.each(function() {
			var e = M(this);
			if (this.tagName === "circle") e.attr("r", i);
			else {
				var t = vp(this), n = t.width, r = t.height, a = s * (+e.attr("x") + n / 2), c = s * (+e.attr("y") + r / 2);
				e.attr("transform", `translate(${a} ${c}) scale(${o})`);
			}
		});
	},
	unexpandCircles: function(e) {
		var t = this, n = t.pointR.bind(t), r = t.getShapeByIndex("circle", e).filter(function() {
			return M(this).classed(I.EXPANDED);
		}).classed(I.EXPANDED, !1);
		if (r.attr("r", n), !t.isCirclePoint()) {
			var i = n(r) / t.config.point_r;
			r.attr("transform", i === 1 ? null : `scale(${i})`);
		}
	},
	pointR: function(e) {
		var t = this, n = t.config.point_r, r = n;
		return t.isBubbleType(e) ? r = t.getBubbleR(e) : K(n) && (r = n.bind(t.api)(e)), e.r = r, r;
	},
	pointExpandedR: function(e) {
		var t = this, n = t.config, r = t.isBubbleType(e) ? 1.15 : 1.75;
		return n.point_focus_expand_enabled ? n.point_focus_expand_r || t.pointR(e) * r : t.pointR(e);
	},
	pointSelectR: function(e) {
		var t = this, n = t.config.point_select_r;
		return K(n) ? n(e) : n || t.pointR(e) * 4;
	},
	isPointFocusOnly: function() {
		var e = this;
		return e.config.point_focus_only && !e.hasType("bubble") && !e.hasType("scatter") && !e.hasArcType(null, ["radar"]);
	},
	isWithinCircle: function(e, t) {
		var n = this.state, r = hp(n.event, e), i = M(e), a = this.isCirclePoint(e) ? "c" : "", o = this.getPointSensitivity(i?.datum()), s = +i.attr(`${a}x`), c = +i.attr(`${a}y`);
		if (!(s || c) && e.nodeType === 1) {
			var l = _p(e), u = l.x, d = l.y;
			s = u, c = d;
		}
		return Math.sqrt((s - r[0]) ** 2 + (c - r[1]) ** 2) < (t || o);
	},
	getPointSensitivity: function(e) {
		var t = this, n = t.config.point_sensitivity;
		if (e) K(n) ? n = n.call(t.api, e) : n === "radius" && (n = e.r);
		else return n;
		return n;
	},
	updatePointClass: function(e) {
		var t = this, n = t.$el.circle, r = !1;
		return (Z(e) || n) && (r = e === !0 ? n.each(function(e) {
			var n = t.getClass("circle", !0)(e);
			this.getAttribute("class").indexOf(I.EXPANDED) > -1 && (n += ` ${I.EXPANDED}`), this.setAttribute("class", n);
		}) : t.getClass("circle", !0)(e)), r;
	},
	generateGetLinePoints: function(e, t) {
		var n = this, r = n.config, i = n.getShapeX(0, e, t), a = n.getShapeY(t), o = n.getShapeOffset(n.isLineType, e, t), s = n.getYScaleById.bind(n);
		return function(e, c) {
			var l = s.call(n, e.id, t)(n.getShapeYMin(e.id)), u = o(e, c) || l, d = i(e), f = a(e);
			r.axis_rotated && (e.value > 0 && f < l || e.value < 0 && l < f) && (f = l);
			var p = [d, f - (l - u)];
			return [
				p,
				p,
				p,
				p
			];
		};
	},
	custom: {
		create: function(e, t, n) {
			return e.append("use").attr("xlink:href", `#${t}`).attr("class", this.updatePointClass.bind(this)).style("fill", n).node();
		},
		update: function(e, t, n, r, i, a, o) {
			var s = this, c = vp(e.node()), l = c.width, u = c.height, d = function(e) {
				return G(e.value) ? t(e) - l / 2 : 0;
			}, f = function(e) {
				return G(e.value) ? n(e) - u / 2 : 0;
			}, p = e;
			return i && (a && p.attr("x", d), p = s.$T(p, i, Bg()), o && s.$T(o, i, Bg())), p.attr("x", d).attr("y", f).style("fill", r);
		}
	},
	circle: {
		create: function(e, t, n) {
			return e.append("circle").attr("class", this.updatePointClass.bind(this)).attr("r", t).style("fill", n).node();
		},
		update: function(e, t, n, r, i, a, o) {
			var s = this, c = e;
			return s.hasType("bubble") && c.attr("r", s.pointR.bind(s)), i && (a && c.attr("cx", t), c.attr("cx") && (c = s.$T(c, i, Bg())), o && s.$T(c, i, Bg())), c.attr("cx", t).attr("cy", n).style("fill", r);
		}
	},
	rectangle: {
		create: function(e, t, n) {
			var r = function(e) {
				return t(e) * 2;
			};
			return e.append("rect").attr("class", this.updatePointClass.bind(this)).attr("width", r).attr("height", r).style("fill", n).node();
		},
		update: function(e, t, n, r, i, a, o) {
			var s = this, c = s.config.point_r, l = function(e) {
				return t(e) - c;
			}, u = function(e) {
				return n(e) - c;
			}, d = e;
			return i && (a && d.attr("x", l), d = s.$T(d, i, Bg()), o && s.$T(o, i, Bg())), d.attr("x", l).attr("y", u).style("fill", r);
		}
	}
};
function Hg(e) {
	return ap(e) && K(e.create) && K(e.update);
}
function Ug(e, t) {
	var n = this, r = function(e, t) {
		for (var n = e.attributes, r = 0, i; i = n[r]; r++) i = i.name, t.setAttribute(i, e.getAttribute(i));
	}, i = new DOMParser().parseFromString(Zf(e), "image/svg+xml").documentElement, a = Df.createElementNS(o.svg, i.nodeName.toLowerCase());
	if (a.id = t, a.style.fill = "inherit", a.style.stroke = "inherit", r(i, a), i.childNodes?.length) {
		var s = M(a);
		"innerHTML" in a ? s.html(Zf(i.innerHTML)) : Ep(i.childNodes).forEach(function(e) {
			r(e, s.append(e.tagName).node());
		});
	}
	n.$el.defs.node().appendChild(a);
}
var Wg = {
	hasValidPointType: function(e) {
		return /^(circle|rect(angle)?|polygon|ellipse|use)$/i.test(e || this.config.point_type);
	},
	hasLegendDefsPoint: function() {
		var e = this.config;
		return e.legend_show && e.point_pattern?.length && e.legend_usePoint;
	},
	getDefsPointId: function(e) {
		return `${this.state.datetimeId}-point${e}`;
	},
	getValidPointPattern: function() {
		var e = this.config, t = /^(circle|rect(angle)?)$/i.test(e.point_type) ? e.point_type : "circle";
		return cp(e.point_pattern) ? e.point_pattern : [t];
	},
	generatePoint: function() {
		var e = this, t = e.$el, n = e.config, r = [], i = e.getValidPointPattern();
		return function(a, o) {
			var s = [...arguments].slice(2);
			return function(c) {
				var l = e.getTargetSelectorSuffix(c.id || c.data?.id || c), u = M(this);
				r.indexOf(l) < 0 && r.push(l);
				var d = i[r.indexOf(l) % i.length];
				if (e.hasValidPointType(d)) d = e[d];
				else if (!Hg(d || n.point_type)) {
					var f = e.getDefsPointId(l);
					if (t.defs.select(`#${f}`).size() < 1 && Ug.call(e, d, f), a === "create") return e.custom?.create.bind(o).apply(void 0, Xd([u, f], s, !1));
					if (a === "update") return e.custom?.update.bind(o).apply(void 0, Xd([u], s, !1));
				}
				return d[a]?.bind(o).apply(void 0, Xd([u], s, !1));
			};
		};
	}
};
function Gg(e) {
	var t = e.config.polar_level_max, n = e.getMinMaxData().max[0].value;
	return t && t > n && (n = t), n;
}
var Kg = {
	initPolar: function() {
		var e = this, t = e.$el.arcs, n = e.config, r = n.polar_level_text_show, i = n.polar_level_text_backgroundColor;
		t.levels = t.append("g").attr("class", lf.levels), r && i && e.generateTextBGColorFilter(i);
	},
	getPolarOuterRadius: function(e, t) {
		var n = Gg(this);
		return (e?.data.values[0].value ?? 0) / n * t;
	},
	updateTargetsForPolar: function(e) {
		this.updateTargetsForArc(e);
	},
	redrawPolar: function() {
		var e = this;
		e.config.polar_level_show && e.updatePolarLevel();
	},
	updatePolarLevel: function() {
		var e = this, t = e.config, n = e.state, r = e.$el.arcs.levels, i = t.polar_level_depth, a = Gg(e), o = Lp(0, i), s = n.radius, c = o.map(function(e) {
			return s * ((e + 1) / i);
		}), l = (t.polar_level_text_format || function() {}).bind(e.api), u = r.selectAll(`.${lf.level}`).data(o);
		u.exit().remove();
		var d = u.enter().append("g").attr("class", function(e, t) {
			return `${lf.level} ${lf.level}-${t}`;
		});
		if (d.append("circle"), d.merge(u).selectAll("circle").style("visibility", t.polar_level_show ? null : "hidden").attr("cx", 0).attr("cy", 0).attr("r", function(e) {
			return c[e];
		}), t.polar_level_text_show) {
			var f = t.polar_level_text_backgroundColor, p = `#${n.datetimeId}-labels-bg${e.getTargetSelectorSuffix(f)}`;
			d.append("text").style("text-anchor", "middle"), d.merge(u).selectAll("text").attr("dy", function(e) {
				return -c[e] + 5;
			}).attr("filter", f ? `url(${p})` : null).text(function(e) {
				return l(a / o.length * (e + 1));
			});
		}
	}
};
function qg(e, t, n, r, i, a) {
	var o = e && r > 0 ? n - r : r;
	return i * (1 - a * (t === "x" ? Math.sin : Math.cos)(2 * Math.PI * o / n));
}
var Jg = $p.radarPoints, Yg = $p.radarTextWidth, Xg = {
	initRadar: function() {
		var e = this, t = e.config, n = e.state.current, r = e.$el;
		e.hasType("radar") && (r.radar = r.main.select(`.${I.chart}`).append("g").attr("class", uf.chartRadars), r.radar.levels = r.radar.append("g").attr("class", lf.levels), r.radar.axes = r.radar.append("g").attr("class", Qd.axis), r.radar.shapes = r.radar.append("g").attr("class", H.shapes), n.dataMax = t.radar_axis_max || e.getMinMaxData().max[0].value, t.radar_axis_text_show && (t.interaction_enabled && e.bindRadarEvent(), e.updateRadarLevel(), e.updateRadarAxes()));
	},
	getRadarSize: function() {
		var e = this, t = e.config, n = e.state, r = n.arcWidth, i = n.arcHeight, a = t.axis_x_categories.length < 4 ? -20 : 10, o = (Math.min(r, i) - a) / 2;
		return [o, o];
	},
	updateTargetsForRadar: function(e) {
		var t = this, n = t.config;
		sp(n.axis_x_categories) && (n.axis_x_categories = Lp(0, Ip("max", e.map(function(e) {
			return e.values.length;
		})))), t.generateRadarPoints();
	},
	getRadarPosition: function(e, t, n, r) {
		var i = this, a = i.config, o = i.getRadarSize(), s = o[0], c = o[1], l = a.axis_x_categories.length, u = a.radar_direction_clockwise, d = Ep(e).map(function(i) {
			return qg(u, i, l, t, Y(n) ? n : e === "x" ? s : c, J(r) ? r : a.radar_size_ratio);
		});
		return d.length === 1 ? d[0] : d;
	},
	generateRadarPoints: function() {
		var e = this, t = e.data.targets, n = e.getRadarSize(), r = n[0], i = n[1], a = e.cache.get(Jg) || {}, o = a._size;
		(!o || o.width !== r && o.height !== i) && (t.forEach(function(t) {
			a[t.id] = t.values.map(function(t, n) {
				return e.getRadarPosition(["x", "y"], n, void 0, e.getRatio("radar", t));
			});
		}), a._size = {
			width: r,
			height: i
		}, e.cache.add(Jg, a));
	},
	redrawRadar: function() {
		var e = this, t = e.$el, n = t.radar, r = t.main, i = e.getTranslate("radar");
		i && (n.attr("transform", i), r.select(`.${pf.chartTexts}`).attr("transform", i), e.generateRadarPoints(), e.updateRadarLevel(), e.updateRadarAxes(), e.updateRadarShape());
	},
	generateGetRadarPoints: function() {
		var e = this.cache.get(Jg);
		return function(t, n) {
			var r = e[t.id][n];
			return [
				r,
				r,
				r,
				r
			];
		};
	},
	updateRadarLevel: function() {
		var e = this, t = e.config, n = e.state, r = e.$el.radar, i = e.getRadarSize(), a = i[0], o = i[1], s = t.radar_level_depth, c = t.axis_x_categories.length, l = t.radar_level_text_show, u = r.levels, d = Lp(0, s), f = t.radar_size_ratio * Math.min(a, o), p = d.map(function(e) {
			return f * ((e + 1) / s);
		}), m = (t.radar_level_text_format || function() {}).bind(e.api), h = d.map(function(t) {
			var n = p[t];
			return Lp(0, c).map(function(t) {
				return e.getRadarPosition(["x", "y"], t, n, 1).join(",");
			}).join(" ");
		}), g = u.selectAll(`.${lf.level}`).data(d);
		g.exit().remove();
		var _ = g.enter().append("g").attr("class", function(e, t) {
			return `${lf.level} ${lf.level}-${t}`;
		});
		_.append("polygon").style("visibility", t.radar_level_show ? null : "hidden"), l && (u.select("text").empty() && u.append("text").attr("dx", "-.5em").attr("dy", "-.7em").style("text-anchor", "end").text(function() {
			return m(0);
		}), _.append("text").attr("dx", "-.5em").style("text-anchor", "end").text(function(e) {
			return m(n.current.dataMax / d.length * (e + 1));
		})), _.merge(g).attr("transform", function(e) {
			return `translate(${a - p[e]}, ${o - p[e]})`;
		}).selectAll("polygon").attr("points", function(e) {
			return h[e];
		}), l && u.selectAll("text").attr("x", function(e) {
			return ep(e) ? a : h[e].split(",")[0];
		}).attr("y", function(e) {
			return ep(e) ? o : 0;
		});
	},
	updateRadarAxes: function() {
		var e = this, t = e.config, n = e.$el.radar, r = e.getRadarSize(), i = r[0], a = r[1], o = t.axis_x_categories, s = n.axes.selectAll("g").data(o);
		s.exit().remove();
		var c = s.enter().append("g").attr("class", function(e, t) {
			return `${Qd.axis}-${t}`;
		});
		if (t.radar_axis_line_show && c.append("line"), t.radar_axis_text_show && c.append("text"), s = c.merge(s), t.radar_axis_line_show && s.select("line").attr("x1", i).attr("y1", a).attr("x2", function(t, n) {
			return e.getRadarPosition("x", n);
		}).attr("y2", function(t, n) {
			return e.getRadarPosition("y", n);
		}), t.radar_axis_text_show) {
			var l = t.radar_axis_text_position, u = l.x, d = u === void 0 ? 0 : u, f = l.y, p = f === void 0 ? 0 : f, m = e.cache.get(Yg) || 0;
			if (s.select("text").style("text-anchor", "middle").attr("dy", ".5em").call(function(e) {
				e.each(function(e) {
					fp(M(this), String(e), [-.6, 1.2]);
				});
			}).datum(function(e, t) {
				return { index: t };
			}).attr("transform", function(t) {
				ep(this.width) && (this.width = _p(this, !0).width / 2);
				var n = e.getRadarPosition("x", t.index, void 0, 1), r = Math.round(e.getRadarPosition("y", t.index, void 0, 1));
				return n > i ? n += this.width + d : Math.round(n) < i && (n -= this.width + d), r > a ? (r / 2 === a && this.firstChild.tagName === "tspan" && this.firstChild.setAttribute("dy", "0em"), r += p) : r < a && (r -= p), `translate(${n} ${r})`;
			}), !m) {
				var h = [n.axes, n.levels].map(function(e) {
					return mp(e.node()).width;
				});
				h.every(function(e) {
					return e > 0;
				}) && e.cache.add(Yg, h[0] - h[1]);
			}
		}
	},
	bindRadarEvent: function() {
		var e = this, t = e.config, n = e.state, r = e.$el, i = r.radar, a = r.svg, o = e.isPointFocusOnly(), s = n.inputType, c = n.transiting, l = s === "mouse", u = function(r) {
			if (n.event = r, t.interaction_onout) {
				var i = e.getDataIndexFromEvent(r), a = ep(i);
				(l || a) && (e.hideTooltip(), o ? e.hideCircleFocus() : e.unexpandCircles(), l ? e.setOverOut(!1, i) : a && e.callOverOutForTouch());
			}
		};
		i.axes.on(l ? "mouseover " : "touchstart", function(t) {
			if (!c) {
				n.event = t;
				var r = e.getDataIndexFromEvent(t);
				e.selectRectForSingle(a.node(), r), l ? e.setOverOut(!0, r) : e.callOverOutForTouch(r);
			}
		}, l ? void 0 : { passive: !0 }).on("mouseout", l ? u : null), l || a.on("touchstart", u, { passive: !0 });
	},
	updateRadarShape: function() {
		var e = this, t = e.data.targets.filter(function(t) {
			return e.isRadarType(t);
		}), n = e.cache.get(Jg), r = e.$el.radar.shapes.selectAll("polygon").data(e.filterNullish(t)), i = r.enter().append("g").attr("class", e.getChartClass("Radar"));
		e.$T(r.exit()).remove(), i.append("polygon").merge(r).style("fill", e.color).style("stroke", e.color).attr("points", function(e) {
			return n[e.id].join(" ");
		}), e.updateTargetForCircle(t, i);
	},
	radarCircleX: function(e) {
		return this.cache.get(Jg)[e.id][e.index][0];
	},
	radarCircleY: function(e) {
		return this.cache.get(Jg)[e.id][e.index][1];
	}
};
function Zg(e, t) {
	var n = this, r = n.scale, i = r.x, a = r.y, o = n.state.width;
	e.selectAll("g").attr("transform", function(e) {
		return `translate(${e === t ? "0,0" : `${i(e.x0)},${a(e.y0)}`})`;
	}).select("rect").attr("width", function(e) {
		return e === t ? o : i(e.x1) - i(e.x0);
	}).attr("height", function(e) {
		return e === t ? 0 : a(e.y1) - a(e.y0);
	});
}
function Qg(e) {
	var t = this;
	return e.map(function(e) {
		var n = e.id, r = e.values;
		return {
			name: n,
			id: n,
			value: r[0].value,
			ratio: t.getRatio("treemap", r[0])
		};
	});
}
function $g(e) {
	var t = this, n = gd(e).sum(function(e) {
		return e.value;
	}), r = t.getSortCompareFn(!0);
	return [t.treemap(r ? n.sort(r) : n)];
}
var e_ = {
	initTreemap: function() {
		var e = this, t = e.$el, n = e.state, r = n.current, i = r.width, a = r.height, o = n.clip;
		o.id = `${n.datetimeId}-clip`, e.treemap = Md().tile(e.getTreemapTile()), t.defs.append("clipPath").attr("id", o.id).append("rect").attr("width", i).attr("height", a), t.treemap = t.main.select(`.${I.chart}`).attr("clip-path", `url(#${o.id})`).append("g").classed(hf.chartTreemaps, !0), e.bindTreemapEvent();
	},
	bindTreemapEvent: function() {
		var e = this, t = e.$el, n = e.config, r = e.state, i = function(e) {
			var t = e.isTrusted ? e.target : r.eventReceiver.rect?.node(), n;
			return /^rect$/i.test(t.tagName) && (r.event = e, n = M(t).datum()), n?.data;
		};
		if (n.interaction_enabled) {
			var a = r.inputType === "touch";
			t.treemap.on(a ? "touchstart" : "mouseover mousemove", function(t) {
				var n = i(t);
				n && (e.showTooltip([n], t.currentTarget), /^(touchstart|mouseover)$/.test(t.type) && e.setOverOut(!0, n));
			}, a ? { passive: !0 } : void 0).on(a ? "touchend" : "mouseout", function(t) {
				var r = i(t);
				n.interaction_onout && (e.hideTooltip(), e.setOverOut(!1, r));
			});
		}
	},
	getTreemapTile: function() {
		var e = this, t = e.config, n = e.state.current, r = n.width, i = n.height, a = {
			binary: Nd,
			dice: Dd,
			slice: Od,
			sliceDice: Pd,
			squarify: jd,
			resquarify: Fd
		}[t.treemap_tile ?? "binary"] ?? Nd;
		return function(e, t, n, o, s) {
			a(e, 0, 0, r, i);
			for (var c = 0, l = e.children; c < l.length; c++) {
				var u = l[c];
				u.x0 = t + u.x0 / r * (o - t), u.x1 = t + u.x1 / r * (o - t), u.y0 = n + u.y0 / i * (s - n), u.y1 = n + u.y1 / i * (s - n);
			}
		};
	},
	getTreemapData: function(e) {
		var t = this;
		return {
			name: "root",
			children: Qg.bind(t)(t.filterTargetsToShow(e.filter(t.isTreemapType, t)))
		};
	},
	updateTargetsForTreemap: function(e) {
		var t = this, n = t.$el.treemap, r = $g.call(t, t.getTreemapData(e ?? t.data.targets));
		n.data(t.filterNullish(r));
	},
	updateTreemap: function(e) {
		var t = this, n = t.$el, r = t.$T, i = n.treemap.datum(), a = t.getChartClass("Treemap"), o = t.getClass("treemap", !0), s = n.treemap.selectAll("g").data(i.children);
		r(s.exit(), e).style("opacity", "0").remove(), s.enter().append("g").append("rect"), n.treemap.selectAll("g").attr("class", a).select("rect").attr("class", o).attr("fill", function(e) {
			return t.color(e.data.name);
		});
	},
	generateGetTreemapPoints: function() {
		var e = this, t = e.$el, n = e.scale, r = n.x, i = n.y, a = {};
		return t.treemap.selectAll("g").each(function(e) {
			a[e.data.name] = [[r(e.x0), i(e.y0)], [r(e.x1), i(e.y1)]];
		}), function(e) {
			return a[e.id];
		};
	},
	redrawTreemap: function(e) {
		var t = this, n = t.$el, r = t.state.current, i = r.width, a = r.height;
		return n.defs.select("rect").attr("width", i).attr("height", a), [t.$T(n.treemap, e, yp()).call(Zg.bind(t), n.treemap.datum())];
	},
	treemapDataLabelFormat: function(e) {
		var t = this, n = t.$el.treemap, r = t.config, i = t.scale, a = i.x, o = i.y, s = e.id, c = e.value, l = r.treemap_label_format, u = t.getRatio("treemap", e), d = (u * 100).toFixed(2), f = r.treemap_label_show && Ym.call(t, u, "treemap") ? null : "0", p = n.selectAll("g").filter(function(e) {
			return e.data.id === s;
		}).datum(), m = 0, h = 0;
		if (p) {
			var g = p.x0, _ = p.x1, v = p.y0, y = p.y1;
			m = a(_) - a(g), h = o(y) - o(v);
		}
		return function(e) {
			return e.style("opacity", f), K(l) ? l.bind(t.api)(c, u, s, {
				width: m,
				height: h
			}) : `${s}
${d}%`;
		};
	}
}, t_ = {
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
}, n_ = {
	area_above: !1,
	area_below: !1,
	area_front: !0,
	area_linearGradient: !1,
	area_zerobased: !0
}, r_ = {
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
	bar_width_ratio: .6,
	bar_width_max: void 0,
	bar_zerobased: !0
}, i_ = {
	bubble_maxR: 35,
	bubble_zerobased: !1
}, a_ = {
	candlestick_width: void 0,
	candlestick_width_ratio: .6,
	candlestick_width_max: void 0,
	candlestick_color_down: "red"
}, o_ = {
	line_connectNull: !1,
	line_step_type: "step",
	line_step_tooltipMatch: !1,
	line_zerobased: !1,
	line_classes: void 0,
	line_point: !0
}, s_ = { scatter_zerobased: !1 }, c_ = { spline_interpolation_type: "cardinal" }, l_ = {
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
}, u_ = {
	donut_label_show: !0,
	donut_label_format: void 0,
	donut_label_threshold: .05,
	donut_label_line: !1,
	donut_label_image: void 0,
	donut_label_ratio: void 0,
	donut_width: void 0,
	donut_title: "",
	donut_expand: {},
	donut_expand_rate: .98,
	donut_expand_duration: 50,
	donut_padAngle: 0,
	donut_startingAngle: 0
}, d_ = {
	funnel_neck_width: 0,
	funnel_neck_height: 0
}, f_ = {
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
	gauge_expand_rate: .98,
	gauge_expand_duration: 50
}, p_ = {
	pie_label_show: !0,
	pie_label_format: void 0,
	pie_label_ratio: void 0,
	pie_label_threshold: .05,
	pie_label_line: !1,
	pie_label_image: void 0,
	pie_expand: {},
	pie_expand_rate: .98,
	pie_expand_duration: 50,
	pie_innerRadius: 0,
	pie_outerRadius: void 0,
	pie_padAngle: 0,
	pie_padding: 0,
	pie_startingAngle: 0
}, m_ = {
	polar_label_show: !0,
	polar_label_format: void 0,
	polar_label_threshold: .05,
	polar_label_line: !1,
	polar_label_image: void 0,
	polar_label_ratio: void 0,
	polar_level_depth: 3,
	polar_level_max: void 0,
	polar_level_show: !0,
	polar_level_text_backgroundColor: "#fff",
	polar_level_text_format: function(e) {
		return e % 1 == 0 ? e : e.toFixed(2);
	},
	polar_level_text_show: !0,
	polar_padAngle: 0,
	polar_padding: 0,
	polar_startingAngle: 0
}, h_ = {
	radar_axis_max: void 0,
	radar_axis_line_show: !0,
	radar_axis_text_show: !0,
	radar_axis_text_position: {},
	radar_level_depth: 3,
	radar_level_show: !0,
	radar_level_text_format: function(e) {
		return e % 1 == 0 ? e : e.toFixed(2);
	},
	radar_level_text_show: !0,
	radar_size_ratio: .87,
	radar_direction_clockwise: !1
}, g_ = {
	treemap_tile: "binary",
	treemap_label_format: void 0,
	treemap_label_threshold: .05,
	treemap_label_show: !0
};
function __(e, t) {
	Cp(ch.prototype, Object.values(sg).concat(e)), Cp(Eh.prototype, og), Xp.setOptions(Object.values(cg).concat(t || []));
}
function v_(e, t) {
	__([
		Wg,
		Vg,
		zg
	].concat(e || [])), Xp.setOptions([t_, o_].concat(t || []));
}
function y_(e, t) {
	Cp(ch.prototype, [Cg, Wg].concat(e || [])), Xp.setOptions([t_].concat(t || []));
}
var b_ = function() {
	return v_(wg, [n_]), (b_ = function() {
		return $.AREA;
	})();
}, x_ = function() {
	return v_(wg, [n_]), (x_ = function() {
		return $.AREA_LINE_RANGE;
	})();
}, S_ = function() {
	return v_(wg, [n_]), (S_ = function() {
		return $.AREA_STEP_RANGE;
	})();
}, C_ = function() {
	return v_(wg, [n_, c_]), (C_ = function() {
		return $.AREA_SPLINE;
	})();
}, w_ = function() {
	return v_(wg, [n_, c_]), (w_ = function() {
		return $.AREA_SPLINE_RANGE;
	})();
}, T_ = function() {
	return v_(wg, [n_]), (T_ = function() {
		return $.AREA_STEP;
	})();
}, E_ = function() {
	return v_(), (E_ = function() {
		return $.LINE;
	})();
}, D_ = function() {
	return v_(void 0, [c_]), (D_ = function() {
		return $.SPLINE;
	})();
}, O_ = function() {
	return v_(), (O_ = function() {
		return $.STEP;
	})();
}, k_ = function() {
	return y_(void 0, [l_, u_]), (k_ = function() {
		return $.DONUT;
	})();
}, A_ = function() {
	return y_([Ig], [l_, f_]), (A_ = function() {
		return $.GAUGE;
	})();
}, j_ = function() {
	return y_(void 0, [l_, p_]), (j_ = function() {
		return $.PIE;
	})();
}, M_ = function() {
	return y_([Kg], [l_, m_]), (M_ = function() {
		return $.POLAR;
	})();
}, N_ = function() {
	return y_([
		sg.eventrect,
		Vg,
		Xg
	], [
		t_,
		h_,
		{ axis_x_categories: cg.optAxis.axis_x_categories }
	]), (N_ = function() {
		return $.RADAR;
	})();
}, P_ = function() {
	return __([Eg, Wg], [r_, t_]), (P_ = function() {
		return $.BAR;
	})();
}, F_ = function() {
	return __([
		Wg,
		Vg,
		Dg
	], [i_, t_]), (F_ = function() {
		return $.BUBBLE;
	})();
}, I_ = function() {
	return __([Og, Wg], [a_, t_]), (I_ = function() {
		return $.CANDLESTICK;
	})();
}, L_ = function() {
	return __([Wg, Vg], [t_, s_]), (L_ = function() {
		return $.SCATTER;
	})();
}, R_ = function() {
	return y_([Fg], [d_]), (R_ = function() {
		return $.FUNNEL;
	})();
}, z_ = function() {
	return __([e_], [g_]), (z_ = function() {
		return $.TREEMAP;
	})();
};
function B_(e, t, n, r) {
	e === void 0 && (e = !1);
	var i = this, a = i.config, o = i.$el.main, s = a.data_selection_grouped, c = a.data_selection_isselectable.bind(i.api);
	a.data_selection_enabled && o.selectAll(`.${H.shapes}`).selectAll(`.${H.shape}`).each(function(a) {
		var o = M(this), l = a.data ? a.data : a, u = l.id, d = l.index, f = i.getToggle(this, a).bind(i), p = s || !t || t.indexOf(u) >= 0, m = !n || n.indexOf(d) >= 0, h = o.classed(V.SELECTED);
		o.classed(sf.line) || o.classed(Zd.area) || (e ? p && m && c(a) && !h ? f(!0, o.classed(V.SELECTED, !0), a, d) : Y(r) && r && h && f(!1, o.classed(V.SELECTED, !1), a, d) : p && m && c(a) && h && f(!1, o.classed(V.SELECTED, !1), a, d));
	});
}
var V_ = {
	selected: function(e) {
		var t = this.internal, n = [];
		return t.$el.main.selectAll(`.${H.shapes + t.getTargetSelectorSuffix(e)}`).selectAll(`.${H.shape}`).filter(function() {
			return M(this).classed(V.SELECTED);
		}).each(function(e) {
			return n.push(e);
		}), n;
	},
	select: function(e, t, n) {
		var r = this.internal;
		B_.bind(r)(!0, e, t, n);
	},
	unselect: function(e, t) {
		var n = this.internal;
		B_.bind(n)(!1, e, t);
	}
}, H_ = function(e) {
	var t = this.internal, n = t.axis, r = t.brush, i = t.config, a = t.scale, o = a.x, s = a.subX, c = t.state, l;
	return i.subchart_show && (l = e, Array.isArray(l) ? (n.isTimeSeries() && (l = l.map(function(e) {
		return Bp.bind(t)(e);
	})), t.withinRange(l, t.getZoomDomain("subX", !0), t.getZoomDomain("subX")) && (c.domain = l, r.move(r.getSelection(), l.map(s)))) : l = c.domain ?? o.orgDomain()), l;
};
Cp(H_, {
	show: function() {
		var e, t = this.internal, n = t.$el.subchart, r = t.config, i = r.subchart_show;
		if (!i) {
			t.unbindZoomEvent(), r.subchart_show = !i, !n.main && t.initSubchart();
			var a = n.main.selectAll(`.${I.target}`);
			t.data.targets.length !== a.size() && (t.updateSizes(), t.updateTargetsForSubchart(t.data.targets), a = n.main?.selectAll(`.${I.target}`)), a?.style("opacity", null), (e = n.main) == null || e.style("display", null), this.resize();
		}
	},
	hide: function() {
		var e = this.internal, t = e.$el.subchart.main, n = e.config;
		n.subchart_show && t?.style("display") !== "none" && (n.subchart_show = !1, t.style("display", "none"), this.resize());
	},
	toggle: function() {
		var e = this.internal.config;
		this.subchart[e.subchart_show ? "hide" : "show"]();
	},
	reset: function() {
		var e = this.internal.brush;
		e.clear(e.getSelection());
	}
});
var U_ = { subchart: H_ }, W_ = function(e) {
	var t = this.internal, n = t.axis, r = t.config, i = t.org, a = t.scale, o = t.state, s = n.isCategorized(), c;
	if (r.zoom_enabled) {
		if (c = e, Array.isArray(c)) {
			if (n.isTimeSeries() && (c = c.map(function(e) {
				return Bp.bind(t)(e);
			})), t.withinRange(c, t.getZoomDomain("zoom", !0), t.getZoomDomain("zoom"))) {
				if (o.domain = c, c = t.getZoomDomainValue(c), t.api.tooltip.hide(), r.subchart_show) {
					var l = a.zoom || a.x;
					t.brush.getSelection().call(t.brush.move, c.map(l));
				} else {
					var l = s ? a.x.orgScale() : i.xScale || a.x;
					t.updateCurrentZoomTransform(l, c);
				}
				t.setZoomResetButton();
			}
		} else c = t.zoom.getDomain();
	}
	return o.domain ?? c;
};
Cp(W_, {
	enable: function(e) {
		var t = this.internal, n = t.config;
		/^(drag|wheel)$/.test(e) && (n.zoom_type = e), n.zoom_enabled = !!e, t.zoom ? e === !1 && t.bindZoomEvent(!1) : (t.initZoom(), t.bindZoomEvent()), t.updateAndRedraw();
	},
	max: function(e) {
		var t = this.internal, n = t.config, r = t.org.xDomain;
		return (e === 0 || e) && (n.zoom_x_max = Ip("max", [r[1], e])), n.zoom_x_max;
	},
	min: function(e) {
		var t = this.internal, n = t.config, r = t.org.xDomain;
		return (e === 0 || e) && (n.zoom_x_min = Ip("min", [r[0], e])), n.zoom_x_min;
	},
	range: function(e) {
		var t = this.zoom;
		if (Z(e)) {
			var n = e.min, r = e.max;
			Y(n) && t.min(n), Y(r) && t.max(r);
		}
		return {
			min: t.min(),
			max: t.max()
		};
	}
});
var G_ = {
	zoom: W_,
	unzoom: function() {
		var e = this.internal, t = e.config, n = e.$el, r = n.eventRect, i = n.zoomResetBtn, a = e.scale.zoom, o = e.state;
		a && (t.subchart_show ? e.brush.getSelection().call(e.brush.move, null) : e.zoom.updateTransformScale(zd), e.updateZoom(!0), i?.style("display", "none"), Bd(r.node()) !== zd && e.zoom.transform(r, zd), o.domain = void 0);
	}
}, K_ = {
	initBrush: function() {
		var e = this, t = e.config, n = e.scale, r = e.$el.subchart, i = e.state, a = t.axis_rotated, o = t.subchart_size_height, s, c, l;
		e.brush = (a ? uc() : lc()).handleSize(5), e.brush.on("start brush end", function(t) {
			var r = t.selection, l = t.sourceEvent, u = t.target, d = t.type;
			d === "start" && (e.state.inputType === "touch" && e.hideTooltip(), c = l ? r : null), /(start|brush)/.test(d) && (d === "brush" && l && i.domain && c?.forEach(function(e, t) {
				e !== r[t] && (i.domain[t] = n.x.orgDomain()[t]);
			}), e.redrawForBrush(d !== "start")), d === "end" && (s = n.x.orgDomain()), u?.handle && (r === null ? e.brush.handle.attr("display", "none") : e.brush.handle.attr("display", null).attr("transform", function(e, t) {
				var n = [r[t], o / 2];
				return `translate(${a ? n.reverse() : n})`;
			}));
		}), e.brush.updateResize = function() {
			var e = this;
			l && clearTimeout(l), l = setTimeout(function() {
				var t = e.getSelection();
				s && cc(t.node()) && e.move(t, s.map(n.subX.orgScale()));
			}, 0);
		}, e.brush.update = function() {
			var e;
			return this.extent()()[1].filter(function(e) {
				return isNaN(e);
			}).length === 0 && ((e = r.main) == null || e.select(`.${U.brush}`).call(this)), this;
		}, e.brush.scale = function(n) {
			var r = t.subchart_size_height, i = e.axis.getExtent();
			!i && n.range ? i = [[0, 0], [n.range()[1], r]] : X(i) && (i = i.map(function(e, t) {
				return [e, t > 0 ? r : t];
			})), a && i[1].reverse(), this.extent(i), this.update();
		}, e.brush.getSelection = function() {
			return r.main ? r.main.select(`.${U.brush}`) : M([]);
		};
	},
	initSubchart: function() {
		var e = this, t = e.config, n = e.state, r = n.clip, i = n.hasAxis, a = e.$el, o = a.defs, s = a.svg, c = a.subchart, l = a.axis;
		if (i) {
			var u = t.subchart_show ? null : "hidden", d = `${r.id}-subchart`, f = e.getClipPath(d);
			r.idSubchart = d, e.appendClip(o, d), e.initBrush(), c.main = s.append("g").classed(U.subchart, !0).attr("transform", e.getTranslate("context"));
			var p = c.main;
			p.style("visibility", u), p.append("g").attr("clip-path", f).attr("class", U.chart), [
				"bar",
				"line",
				"bubble",
				"candlestick",
				"scatter"
			].forEach(function(t) {
				var n = wp(/^(bubble|scatter)$/.test(t) ? "circle" : t);
				if (e.hasType(t) || e.hasTypeOf(n)) {
					var r = p.select(`.${U.chart}`), i = U[`chart${n}s`];
					r.select(`.${i}`).empty() && r.append("g").attr("class", i);
				}
			});
			var m = p.append("g").attr("clip-path", f).attr("class", U.brush).call(e.brush);
			t.subchart_showHandle && e.addBrushHandle(m), l.subX = p.append("g").attr("class", U.axisX).attr("transform", e.getTranslate("subX")).attr("clip-path", t.axis_rotated ? "" : r.pathXAxis).style("visibility", t.subchart_axis_x_show ? u : "hidden");
		}
	},
	addBrushHandle: function(e) {
		var t = this, n = t.config, r = n.axis_rotated, i = n.subchart_init_range, a = "handle--custom", o = r ? ["M8.5 0 a6 6 0 0 0 -6 -6.5 H-2.5 a 6 6 0 0 0 -6 6.5 z m-5 -2 H-3.5 m7 -2 H-3.5z", "M8.5 0 a6 -6 0 0 1 -6 6.5 H-2.5 a 6 -6 0 0 1 -6 -6.5z m-5 2 H-3.5 m7 2 H-3.5z"] : ["M0 -8.5 A6 6 0 0 0 -6.5 -3.5 V2.5 A6 6 0 0 0 0 8.5 Z M-2 -3.5 V3.5 M-4 -3.5 V3.5z", "M0 -8.5 A6 6 0 0 1 6.5 -3.5 V2.5 A6 6 0 0 1 0 8.5 Z M2 -3.5 V3.5 M4 -3.5 V3.5z"];
		t.brush.handle = e.selectAll(`.${a}`).data(r ? [{ type: "n" }, { type: "s" }] : [{ type: "w" }, { type: "e" }]).enter().append("path").attr("class", a).attr("cursor", `${r ? "ns" : "ew"}-resize`).attr("d", function(e) {
			return o[+/[se]/.test(e.type)];
		}).attr("display", i ? null : "none");
	},
	updateTargetsForSubchart: function(e) {
		var t = this, n = t.config, r = t.state, i = t.$el.subchart.main;
		n.subchart_show && ([
			"bar",
			"line",
			"bubble",
			"candlestick",
			"scatter"
		].filter(function(e) {
			return t.hasType(e) || t.hasTypeOf(wp(e));
		}).forEach(function(n) {
			var r = /^(bubble|scatter)$/.test(n), a = wp(r ? "circle" : n), o = t.getChartClass(a, !0), s = t.getClass(r ? "circles" : `${n}s`, !0), c = i.select(`.${U[`chart${`${a}s`}`]}`);
			if (r) {
				var l = c.selectAll(`.${U.circles}`).data(e.filter(t[`is${wp(n)}Type`].bind(t))).attr("class", s);
				l.exit().remove(), l.enter().append("g").attr("class", s);
			} else {
				var u = c.selectAll(`.${U[`chart${a}`]}`).attr("class", o).data(e.filter(t[`is${a}Type`].bind(t))), d = u.enter().append("g").style("opacity", "0").attr("class", o).append("g").attr("class", s);
				u.exit().remove(), n === "line" && t.hasTypeOf("Area") && d.append("g").attr("class", t.getClass("areas", !0));
			}
		}), i.selectAll(`.${U.brush} rect`).attr(n.axis_rotated ? "width" : "height", n.axis_rotated ? r.width2 : r.height2));
	},
	redrawSubchart: function(e, t, n) {
		var r = this, i = r.config, a = r.$el.subchart.main, o = r.state, s = !!t;
		if (a.style("visibility", i.subchart_show ? null : "hidden"), i.subchart_show && (o.event?.type === "zoom" && r.brush.update(), e)) {
			var c = i.subchart_init_range;
			if (!xp(r) && r.brush.update(), Object.keys(n.type).forEach(function(e) {
				var t = wp(e), i = r[`generateDraw${t}`](n.indices[e], !0);
				r[`update${t}`](s, !0), r[`redraw${t}`](i, s, !0);
			}), r.hasType("bubble") || r.hasType("scatter")) {
				var l = n.pos.cx, u = r.updateCircleY(!0);
				r.updateCircle(!0), r.redrawCircle(l, u, s, void 0, !0);
			}
			!o.rendered && c && (o.domain = c, r.brush.move(r.brush.getSelection(), c.map(r.scale.x)));
		}
	},
	redrawForBrush: function(e) {
		e === void 0 && (e = !0);
		var t = this, n = t.config, r = n.subchart_onbrush, i = n.zoom_rescale, a = t.scale, o = t.state;
		t.redraw({
			withTransition: !1,
			withY: i,
			withSubchart: !1,
			withUpdateXDomain: !0,
			withDimension: !1
		}), e && o.rendered && r.bind(t.api)(o.domain ?? a.x.orgDomain());
	},
	transformContext: function(e, t) {
		var n = this, r = n.$el.subchart, i = n.$T, a = t?.axisSubX ? t.axisSubX : i(r.main.select(`.${U.axisX}`), e);
		r.main.attr("transform", n.getTranslate("context")), a.attr("transform", n.getTranslate("subX"));
	}
}, q_ = {
	initZoom: function() {
		var e = this;
		e.scale.zoom = null, e.generateZoom(), e.config.zoom_type === "drag" && e.initZoomBehaviour();
	},
	bindZoomEvent: function(e) {
		e === void 0 && (e = !0);
		var t = this, n = t.config;
		n.zoom_enabled && e ? !n.subchart_show && t.bindZoomOnEventRect() : e === !1 && (t.api.unzoom(), t.unbindZoomEvent());
	},
	generateZoom: function() {
		var e = this, t = e.config, n = e.org, r = e.scale, i = Yd().duration(0).on("start", e.onZoomStart.bind(e)).on("zoom", e.onZoom.bind(e)).on("end", e.onZoomEnd.bind(e));
		i.orgScaleExtent = function() {
			var n = t.zoom_extent || [1, 10];
			return [n[0], Math.max(e.getMaxDataCount() / n[1], n[1])];
		}, i.updateScaleExtent = function() {
			var t = ip(e.scale.x.orgDomain()) / ip(e.getZoomDomain()), n = this.orgScaleExtent();
			return this.scaleExtent([n[0] * t, n[1] * t]), this;
		}, i.updateTransformScale = function(i, a) {
			var o, s = t.axis_rotated;
			(o = n.xScale) == null || o.range(r.x.range());
			var c = i[s ? "rescaleY" : "rescaleX"](n.xScale || r.x);
			if (!c.domain().some(function(e) {
				return /(Invalid Date|NaN)/.test(e.toString());
			})) {
				var l = e.trimXDomain(c.domain()), u = t.zoom_rescale;
				if (c.domain(l, n.xDomain), a) {
					var d = c(r.x.domain()[0]), f = s ? i.x : d, p = s ? d : i.y;
					e.$el.eventRect.property("__zoom", zd.translate(f, p).scale(i.k));
				}
				r.zoom = e.getCustomizedXScale(c), e.axis.x.scale(r.zoom), u ? (!n.xScale && (n.xScale = r.x.copy()), r.x.domain(l)) : n.xScale &&= (r.x.domain(n.xScale.domain()), null);
			}
		}, i.getDomain = function() {
			var t = r[r.zoom ? "zoom" : "subX"].domain();
			return e.axis.isCategorized() && (t[1] -= 2), t;
		}, e.zoom = i;
	},
	onZoomStart: function(e) {
		var t = this, n = e.sourceEvent;
		n && (t.zoom.startEvent = n, t.state.zooming = !0, Q(t.config.zoom_onzoomstart, t.api, e));
	},
	onZoom: function(e) {
		var t = this, n = t.config, r = t.scale, i = t.state, a = t.org, o = e.sourceEvent, s = e?.transform === zd;
		if (!(!n.zoom_enabled || t.filterTargetsToShow(t.data.targets).length === 0 || !r.zoom && o?.type.indexOf("touch") > -1 && o?.touches.length === 1)) {
			e.sourceEvent && (i.zooming = !0, i.domain = void 0);
			var c = o?.type === "mousemove", l = o?.wheelDelta < 0, u = e.transform;
			!c && l && r.x.domain().every(function(e, t) {
				return e !== a.xDomain[t];
			}) && r.x.domain(a.xDomain), t.zoom.updateTransformScale(u, n.zoom_type === "wheel" && o);
			var d = n.transition_duration > 0 && !n.subchart_show && (i.dragging || s || !e.sourceEvent), f = o && c && n.zoom_type !== "wheel", p = function() {
				t.redraw({
					withTransition: d,
					withY: n.zoom_rescale,
					withSubchart: !1,
					withEventRect: !1,
					withDimension: !1
				}), t.state.cancelClick = c, !s && Q(n.zoom_onzoom, t.api, t.state.domain ?? t.zoom.getDomain());
			};
			f ? qp(t.state, p) : p();
		}
	},
	onZoomEnd: function(e) {
		var t = this, n = t.config, r = t.state, i = t.zoom.startEvent, a = e?.sourceEvent, o = e?.transform === zd;
		i?.type.indexOf("touch") > -1 && (i = i.changedTouches[0], a = a?.changedTouches?.[0]), n.zoom_type === "drag" && a && i.clientX === a.clientX && i.clientY === a.clientY || (r.zooming = !1, t.redrawEventRect(), t.updateZoom(), !o && (a || r.dragging) && Q(n.zoom_onzoomend, t.api, t.state.domain ?? t.zoom.getDomain()));
	},
	updateZoom: function(e) {
		var t = this, n = t.scale, r = n.subX, i = n.x, a = n.zoom;
		if (a) {
			var o = a.domain(), s = r.domain(), c = .015, l = t.config.axis_x_inverted ? (o[0] >= s[0] || o[0] + c >= s[0]) && (s[1] >= o[1] || s[1] >= o[1] + c) : (o[0] <= s[0] || o[0] - c <= s[0]) && (s[1] <= o[1] || s[1] <= o[1] - c);
			(e || l) && (t.axis.x.scale(r), i.domain(r.orgDomain()), t.scale.zoom = null);
		}
	},
	updateCurrentZoomTransform: function(e, t) {
		var n, r = this, i = r.$el.eventRect, a = r.config.axis_rotated, o = [-e(t[0]), 0], s = (n = zd.scale(e.range()[1] / (e(t[1]) - e(t[0])))).translate.apply(n, a ? o.reverse() : o);
		i.call(r.zoom.transform, s);
	},
	bindZoomOnEventRect: function() {
		var e = this, t = e.config, n = e.$el, r = n.eventRect, i = n.svg, a = t.zoom_type === "drag" ? e.zoomBehaviour : e.zoom;
		W.GestureEvent && /^((?!chrome|android|mobile).)*safari/i.test(W.navigator?.userAgent) && i.on("wheel", function() {}), r?.call(a).on("dblclick.zoom", null);
	},
	initZoomBehaviour: function() {
		var e = this, t = e.config, n = e.state, r = t.axis_rotated, i = 0, a = 0, o, s, c = {
			axis: r ? "y" : "x",
			attr: r ? "height" : "width",
			index: +!!r
		};
		e.zoomBehaviour = ki().clickDistance(4).on("start", function(t) {
			s = e.scale.zoom ? null : e.axis.getExtent(), n.event = t, e.setDragStatus(!0), e.unselectRect(), o ||= e.$el.main.append("rect").attr("clip-path", n.clip.path).attr("class", gf.zoomBrush).attr("width", r ? n.width : 0).attr("height", r ? 0 : n.height), i = hp(t, this)[c.index], s && (i < s[0] ? i = s[0] : i > s[1] && (i = s[1])), a = i, o.attr(c.axis, i).attr(c.attr, 0), e.onZoomStart(t);
		}).on("drag", function(e) {
			a = hp(e, this)[c.index], s && (a > s[1] ? a = s[1] : a < s[0] && (a = s[0])), o.attr(c.axis, Math.min(i, a)).attr(c.attr, Math.abs(a - i));
		}).on("end", function(t) {
			var r, s = e.scale.zoom || e.scale.x;
			n.event = t, o.attr(c.axis, 0).attr(c.attr, 0), i > a && (r = [a, i], i = r[0], a = r[1]), i < 0 && (a += Math.abs(i), i = 0), i !== a && e.api.zoom([i, a].map(function(e) {
				return s.invert(e);
			})), e.setDragStatus(!1);
		});
	},
	setZoomResetButton: function() {
		var e = this, t = e.config, n = e.$el, r = t.zoom_resetButton;
		r && t.zoom_type === "drag" && (n.zoomResetBtn ? n.zoomResetBtn.style("display", null) : n.zoomResetBtn = e.$el.chart.append("div").classed(I.button, !0).append("span").on("click", function() {
			K(r.onclick) && r.onclick.bind(e.api)(this), e.api.unzoom();
		}).classed(gf.buttonZoomReset, !0).text(r.text || "Reset Zoom"));
	},
	getZoomTransform: function() {
		var e = this.$el.eventRect;
		return e?.node() ? Bd(e.node()) : { k: 1 };
	}
}, J_ = F(F({}, {
	drag: function(e) {
		var t = this, n = t.config, r = t.state, i = t.$el.main, a = n.data_selection_grouped, o = n.interaction_enabled && n.data_selection_isselectable;
		if (!(t.hasArcType() || !n.data_selection_enabled || n.zoom_enabled && !t.zoom.altDomain || !n.data_selection_multiple)) {
			var s = r.dragStart || [0, 0], c = s[0], l = s[1], u = e[0], d = e[1], f = Math.min(c, u), p = Math.max(c, u), m = a ? r.margin.top : Math.min(l, d), h = a ? r.height : Math.max(l, d);
			qp(t.state, function() {
				t && t.$el && t.$el.main && (i.select(`.${rf.dragarea}`).attr("x", f).attr("y", m).attr("width", p - f).attr("height", h - m), i.selectAll(`.${H.shapes}`).selectAll(`.${H.shape}`).filter(function(e) {
					return o?.bind(t.api)(e);
				}).each(function(e, n) {
					var r = M(this), i = r.classed(V.SELECTED), a = r.classed(rf.INCLUDED), o = !1, s;
					if (r.classed(tf.circle)) {
						var c = r.attr("cx") * 1, l = r.attr("cy") * 1;
						s = t.togglePoint, o = f < c && c < p && m < l && l < h;
					} else if (r.classed($d.bar)) {
						var u = mp(this), c = u.x, l = u.y, d = u.width, g = u.height;
						s = t.togglePath, o = !(p < c || c + d < f) && !(h < l || l + g < m);
					} else return;
					o ^ a && (r.classed(rf.INCLUDED, !a), r.classed(V.SELECTED, !i), s.call(t, !i, r, e, n));
				}));
			});
		}
	},
	dragstart: function(e) {
		var t = this, n = t.config, r = t.state, i = t.$el.main;
		!t.hasArcType() && n.data_selection_enabled && (r.dragStart = e, i.select(`.${I.chart}`).append("rect").attr("class", rf.dragarea).style("opacity", "0.1"), t.setDragStatus(!0));
	},
	dragend: function() {
		var e = this, t = e.config, n = e.$el.main, r = e.$T;
		!e.hasArcType() && t.data_selection_enabled && (r(n.select(`.${rf.dragarea}`)).style("opacity", "0").remove(), n.selectAll(`.${H.shape}`).classed(rf.INCLUDED, !1), e.setDragStatus(!1));
	}
}), {
	selectPoint: function(e, t, n) {
		var r = this, i = r.config, a = r.$el.main, o = r.$T, s = i.axis_rotated, c = (s ? r.circleY : r.circleX).bind(r), l = (s ? r.circleX : r.circleY).bind(r), u = r.pointSelectR.bind(r);
		Q(i.data_onselected, r.api, t, e.node()), o(a.select(`.${V.selectedCircles}${r.getTargetSelectorSuffix(t.id)}`).selectAll(`.${V.selectedCircle}-${n}`).data([t]).enter().append("circle").attr("class", function() {
			return r.generateClass(V.selectedCircle, n);
		}).attr("cx", c).attr("cy", l).attr("stroke", r.color).attr("r", function(e) {
			return r.pointSelectR(e) * 1.4;
		})).attr("r", u);
	},
	unselectPoint: function(e, t, n) {
		var r = this, i = r.config, a = r.$el.main, o = r.$T;
		Q(i.data_onunselected, r.api, t, e?.node()), o(a.select(`.${V.selectedCircles}${r.getTargetSelectorSuffix(t.id)}`).selectAll(`.${V.selectedCircle}-${n}`)).attr("r", 0).remove();
	},
	togglePoint: function(e, t, n, r) {
		var i = `${e ? "" : "un"}selectPoint`;
		this[i](t, n, r);
	},
	selectPath: function(e, t) {
		var n = this, r = n.config;
		Q(r.data_onselected, n.api, t, e.node()), r.interaction_brighten && e.style("filter", "brightness(1.25)");
	},
	unselectPath: function(e, t) {
		var n = this, r = n.config;
		Q(r.data_onunselected, n.api, t, e.node()), r.interaction_brighten && e.style("filter", null);
	},
	togglePath: function(e, t, n, r) {
		this[`${e ? "" : "un"}selectPath`](t, n, r);
	},
	getToggle: function(e, t) {
		var n = this;
		return e.nodeName === "path" ? n.togglePath : n.isStepType(t) ? function() {} : n.togglePoint;
	},
	toggleShape: function(e, t, n) {
		var r = this, i = r.config, a = r.$el.main;
		if (i.data_selection_enabled && i.data_selection_isselectable.bind(r.api)(t)) {
			var o = M(e), s = o.classed(V.SELECTED), c = r.getToggle(e, t).bind(r), l;
			if (!i.data_selection_multiple) {
				var u = r.isPointFocusOnly?.call(r), d = `.${u ? V.selectedCircles : H.shapes}`;
				i.data_selection_grouped && (d += r.getTargetSelectorSuffix(t.id)), a.selectAll(d).selectAll(u ? `.${V.selectedCircle}` : `.${H.shape}.${V.SELECTED}`).classed(V.SELECTED, !1).each(function(e) {
					var t = M(this);
					l = t, c(!1, t, e, e.index);
				});
			}
			l && l.node() === o.node() || (o.classed(V.SELECTED, !s), c(!s, o, t, n));
		}
	}
}), Y_ = {
	data_selection_enabled: !1,
	data_selection_grouped: !1,
	data_selection_isselectable: function() {
		return !0;
	},
	data_selection_multiple: !0,
	data_selection_draggable: !1,
	data_onselected: function() {},
	data_onunselected: function() {}
}, X_ = {
	subchart_show: !1,
	subchart_showHandle: !1,
	subchart_size_height: 60,
	subchart_axis_x_show: !0,
	subchart_axis_x_tick_show: !0,
	subchart_axis_x_tick_format: void 0,
	subchart_axis_x_tick_text_show: !0,
	subchart_init_range: void 0,
	subchart_onbrush: function() {}
}, Z_ = {
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
}, Q_ = function() {
	return Cp(ch.prototype, J_), Cp(Eh.prototype, V_), Xp.setOptions([Y_]), (Q_ = function() {
		return !0;
	})();
}, $_ = function() {
	return Cp(ch.prototype, K_), Cp(Eh.prototype, U_), Xp.setOptions([X_]), ($_ = function() {
		return !0;
	})();
}, ev = function() {
	return Cp(ch.prototype, q_), Cp(Eh.prototype, G_), Xp.setOptions([Z_]), (ev = function() {
		return !0;
	})();
}, tv = Object.create(null), nv = {
	version: "3.18.0",
	generate: function(e) {
		var t = new Eh(Pp(Object.create(null), tv, e));
		return t.internal.charts = this.instance, this.instance.push(t), t;
	},
	defaults: function(e) {
		return Z(e) && (tv = e), tv;
	},
	instance: [],
	plugin: {}
};
export { b_ as area, x_ as areaLineRange, C_ as areaSpline, w_ as areaSplineRange, T_ as areaStep, S_ as areaStepRange, P_ as bar, nv as bb, nv as default, F_ as bubble, I_ as candlestick, k_ as donut, R_ as funnel, A_ as gauge, E_ as line, j_ as pie, M_ as polar, N_ as radar, L_ as scatter, Q_ as selection, D_ as spline, O_ as step, $_ as subchart, z_ as treemap, ev as zoom };
