import { a as Fr, c as O, r as Tr, g as Dr } from "./index-D_vHQ8I4.js";
var $ = {}, Q = {}, k = {};
const Br = {}, Pr = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Br
}, Symbol.toStringTag, { value: "Module" })), Lr = /* @__PURE__ */ Fr(Pr);
var ee, De;
function yr() {
  return De || (De = 1, ee = Lr), ee;
}
var Be;
function B() {
  if (Be) return k;
  if (Be = 1, k.base64 = !0, k.array = !0, k.string = !0, k.arraybuffer = typeof ArrayBuffer < "u" && typeof Uint8Array < "u", k.nodebuffer = typeof Buffer < "u", k.uint8array = typeof Uint8Array < "u", typeof ArrayBuffer > "u")
    k.blob = !1;
  else {
    var o = new ArrayBuffer(0);
    try {
      k.blob = new Blob([o], {
        type: "application/zip"
      }).size === 0;
    } catch {
      try {
        var a = self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder, n = new a();
        n.append(o), k.blob = n.getBlob("application/zip").size === 0;
      } catch {
        k.blob = !1;
      }
    }
  }
  try {
    k.nodestream = !!yr().Readable;
  } catch {
    k.nodestream = !1;
  }
  return k;
}
var H = {}, Pe;
function gr() {
  if (Pe) return H;
  Pe = 1;
  var o = w(), a = B(), n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  return H.encode = function(s) {
    for (var d = [], h, f, m, v, C, y, u, e = 0, r = s.length, i = r, p = o.getTypeOf(s) !== "string"; e < s.length; )
      i = r - e, p ? (h = s[e++], f = e < r ? s[e++] : 0, m = e < r ? s[e++] : 0) : (h = s.charCodeAt(e++), f = e < r ? s.charCodeAt(e++) : 0, m = e < r ? s.charCodeAt(e++) : 0), v = h >> 2, C = (h & 3) << 4 | f >> 4, y = i > 1 ? (f & 15) << 2 | m >> 6 : 64, u = i > 2 ? m & 63 : 64, d.push(n.charAt(v) + n.charAt(C) + n.charAt(y) + n.charAt(u));
    return d.join("");
  }, H.decode = function(s) {
    var d, h, f, m, v, C, y, u = 0, e = 0, r = "data:";
    if (s.substr(0, r.length) === r)
      throw new Error("Invalid base64 input, it looks like a data url.");
    s = s.replace(/[^A-Za-z0-9+/=]/g, "");
    var i = s.length * 3 / 4;
    if (s.charAt(s.length - 1) === n.charAt(64) && i--, s.charAt(s.length - 2) === n.charAt(64) && i--, i % 1 !== 0)
      throw new Error("Invalid base64 input, bad content length.");
    var p;
    for (a.uint8array ? p = new Uint8Array(i | 0) : p = new Array(i | 0); u < s.length; )
      m = n.indexOf(s.charAt(u++)), v = n.indexOf(s.charAt(u++)), C = n.indexOf(s.charAt(u++)), y = n.indexOf(s.charAt(u++)), d = m << 2 | v >> 4, h = (v & 15) << 4 | C >> 2, f = (C & 3) << 6 | y, p[e++] = d, C !== 64 && (p[e++] = h), y !== 64 && (p[e++] = f);
    return p;
  }, H;
}
var re, Le;
function Y() {
  return Le || (Le = 1, re = {
    /**
     * True if this is running in Nodejs, will be undefined in a browser.
     * In a browser, browserify won't include this file and the whole module
     * will be resolved an empty object.
     */
    isNode: typeof Buffer < "u",
    /**
     * Create a new nodejs Buffer from an existing content.
     * @param {Object} data the data to pass to the constructor.
     * @param {String} encoding the encoding to use.
     * @return {Buffer} a new Buffer.
     */
    newBufferFrom: function(o, a) {
      if (Buffer.from && Buffer.from !== Uint8Array.from)
        return Buffer.from(o, a);
      if (typeof o == "number")
        throw new Error('The "data" argument must not be a number');
      return new Buffer(o, a);
    },
    /**
     * Create a new nodejs Buffer with the specified size.
     * @param {Integer} size the size of the buffer.
     * @return {Buffer} a new Buffer.
     */
    allocBuffer: function(o) {
      if (Buffer.alloc)
        return Buffer.alloc(o);
      var a = new Buffer(o);
      return a.fill(0), a;
    },
    /**
     * Find out if an object is a Buffer.
     * @param {Object} b the object to test.
     * @return {Boolean} true if the object is a Buffer, false otherwise.
     */
    isBuffer: function(o) {
      return Buffer.isBuffer(o);
    },
    isStream: function(o) {
      return o && typeof o.on == "function" && typeof o.pause == "function" && typeof o.resume == "function";
    }
  }), re;
}
var te, ze;
function zr() {
  if (ze) return te;
  ze = 1;
  var o = O.MutationObserver || O.WebKitMutationObserver, a;
  if (o) {
    var n = 0, s = new o(v), d = O.document.createTextNode("");
    s.observe(d, {
      characterData: !0
    }), a = function() {
      d.data = n = ++n % 2;
    };
  } else if (!O.setImmediate && typeof O.MessageChannel < "u") {
    var h = new O.MessageChannel();
    h.port1.onmessage = v, a = function() {
      h.port2.postMessage(0);
    };
  } else "document" in O && "onreadystatechange" in O.document.createElement("script") ? a = function() {
    var y = O.document.createElement("script");
    y.onreadystatechange = function() {
      v(), y.onreadystatechange = null, y.parentNode.removeChild(y), y = null;
    }, O.document.documentElement.appendChild(y);
  } : a = function() {
    setTimeout(v, 0);
  };
  var f, m = [];
  function v() {
    f = !0;
    for (var y, u, e = m.length; e; ) {
      for (u = m, m = [], y = -1; ++y < e; )
        u[y]();
      e = m.length;
    }
    f = !1;
  }
  te = C;
  function C(y) {
    m.push(y) === 1 && !f && a();
  }
  return te;
}
var ie, Ne;
function Nr() {
  if (Ne) return ie;
  Ne = 1;
  var o = zr();
  function a() {
  }
  var n = {}, s = ["REJECTED"], d = ["FULFILLED"], h = ["PENDING"];
  ie = f;
  function f(t) {
    if (typeof t != "function")
      throw new TypeError("resolver must be a function");
    this.state = h, this.queue = [], this.outcome = void 0, t !== a && y(this, t);
  }
  f.prototype.finally = function(t) {
    if (typeof t != "function")
      return this;
    var l = this.constructor;
    return this.then(c, g);
    function c(x) {
      function S() {
        return x;
      }
      return l.resolve(t()).then(S);
    }
    function g(x) {
      function S() {
        throw x;
      }
      return l.resolve(t()).then(S);
    }
  }, f.prototype.catch = function(t) {
    return this.then(null, t);
  }, f.prototype.then = function(t, l) {
    if (typeof t != "function" && this.state === d || typeof l != "function" && this.state === s)
      return this;
    var c = new this.constructor(a);
    if (this.state !== h) {
      var g = this.state === d ? t : l;
      v(c, g, this.outcome);
    } else
      this.queue.push(new m(c, t, l));
    return c;
  };
  function m(t, l, c) {
    this.promise = t, typeof l == "function" && (this.onFulfilled = l, this.callFulfilled = this.otherCallFulfilled), typeof c == "function" && (this.onRejected = c, this.callRejected = this.otherCallRejected);
  }
  m.prototype.callFulfilled = function(t) {
    n.resolve(this.promise, t);
  }, m.prototype.otherCallFulfilled = function(t) {
    v(this.promise, this.onFulfilled, t);
  }, m.prototype.callRejected = function(t) {
    n.reject(this.promise, t);
  }, m.prototype.otherCallRejected = function(t) {
    v(this.promise, this.onRejected, t);
  };
  function v(t, l, c) {
    o(function() {
      var g;
      try {
        g = l(c);
      } catch (x) {
        return n.reject(t, x);
      }
      g === t ? n.reject(t, new TypeError("Cannot resolve promise with itself")) : n.resolve(t, g);
    });
  }
  n.resolve = function(t, l) {
    var c = u(C, l);
    if (c.status === "error")
      return n.reject(t, c.value);
    var g = c.value;
    if (g)
      y(t, g);
    else {
      t.state = d, t.outcome = l;
      for (var x = -1, S = t.queue.length; ++x < S; )
        t.queue[x].callFulfilled(l);
    }
    return t;
  }, n.reject = function(t, l) {
    t.state = s, t.outcome = l;
    for (var c = -1, g = t.queue.length; ++c < g; )
      t.queue[c].callRejected(l);
    return t;
  };
  function C(t) {
    var l = t && t.then;
    if (t && (typeof t == "object" || typeof t == "function") && typeof l == "function")
      return function() {
        l.apply(t, arguments);
      };
  }
  function y(t, l) {
    var c = !1;
    function g(b) {
      c || (c = !0, n.reject(t, b));
    }
    function x(b) {
      c || (c = !0, n.resolve(t, b));
    }
    function S() {
      l(x, g);
    }
    var E = u(S);
    E.status === "error" && g(E.value);
  }
  function u(t, l) {
    var c = {};
    try {
      c.value = t(l), c.status = "success";
    } catch (g) {
      c.status = "error", c.value = g;
    }
    return c;
  }
  f.resolve = e;
  function e(t) {
    return t instanceof this ? t : n.resolve(new this(a), t);
  }
  f.reject = r;
  function r(t) {
    var l = new this(a);
    return n.reject(l, t);
  }
  f.all = i;
  function i(t) {
    var l = this;
    if (Object.prototype.toString.call(t) !== "[object Array]")
      return this.reject(new TypeError("must be an array"));
    var c = t.length, g = !1;
    if (!c)
      return this.resolve([]);
    for (var x = new Array(c), S = 0, E = -1, b = new this(a); ++E < c; )
      A(t[E], E);
    return b;
    function A(P, j) {
      l.resolve(P).then(M, function(_) {
        g || (g = !0, n.reject(b, _));
      });
      function M(_) {
        x[j] = _, ++S === c && !g && (g = !0, n.resolve(b, x));
      }
    }
  }
  f.race = p;
  function p(t) {
    var l = this;
    if (Object.prototype.toString.call(t) !== "[object Array]")
      return this.reject(new TypeError("must be an array"));
    var c = t.length, g = !1;
    if (!c)
      return this.resolve([]);
    for (var x = -1, S = new this(a); ++x < c; )
      E(t[x]);
    return S;
    function E(b) {
      l.resolve(b).then(function(A) {
        g || (g = !0, n.resolve(S, A));
      }, function(A) {
        g || (g = !0, n.reject(S, A));
      });
    }
  }
  return ie;
}
var ne, Ue;
function q() {
  if (Ue) return ne;
  Ue = 1;
  var o = null;
  return typeof Promise < "u" ? o = Promise : o = Nr(), ne = {
    Promise: o
  }, ne;
}
var se = {}, qe;
function Ur() {
  return qe || (qe = 1, (function(o, a) {
    if (o.setImmediate)
      return;
    var n = 1, s = {}, d = !1, h = o.document, f;
    function m(c) {
      typeof c != "function" && (c = new Function("" + c));
      for (var g = new Array(arguments.length - 1), x = 0; x < g.length; x++)
        g[x] = arguments[x + 1];
      var S = { callback: c, args: g };
      return s[n] = S, f(n), n++;
    }
    function v(c) {
      delete s[c];
    }
    function C(c) {
      var g = c.callback, x = c.args;
      switch (x.length) {
        case 0:
          g();
          break;
        case 1:
          g(x[0]);
          break;
        case 2:
          g(x[0], x[1]);
          break;
        case 3:
          g(x[0], x[1], x[2]);
          break;
        default:
          g.apply(a, x);
          break;
      }
    }
    function y(c) {
      if (d)
        setTimeout(y, 0, c);
      else {
        var g = s[c];
        if (g) {
          d = !0;
          try {
            C(g);
          } finally {
            v(c), d = !1;
          }
        }
      }
    }
    function u() {
      f = function(c) {
        process.nextTick(function() {
          y(c);
        });
      };
    }
    function e() {
      if (o.postMessage && !o.importScripts) {
        var c = !0, g = o.onmessage;
        return o.onmessage = function() {
          c = !1;
        }, o.postMessage("", "*"), o.onmessage = g, c;
      }
    }
    function r() {
      var c = "setImmediate$" + Math.random() + "$", g = function(x) {
        x.source === o && typeof x.data == "string" && x.data.indexOf(c) === 0 && y(+x.data.slice(c.length));
      };
      o.addEventListener ? o.addEventListener("message", g, !1) : o.attachEvent("onmessage", g), f = function(x) {
        o.postMessage(c + x, "*");
      };
    }
    function i() {
      var c = new MessageChannel();
      c.port1.onmessage = function(g) {
        var x = g.data;
        y(x);
      }, f = function(g) {
        c.port2.postMessage(g);
      };
    }
    function p() {
      var c = h.documentElement;
      f = function(g) {
        var x = h.createElement("script");
        x.onreadystatechange = function() {
          y(g), x.onreadystatechange = null, c.removeChild(x), x = null;
        }, c.appendChild(x);
      };
    }
    function t() {
      f = function(c) {
        setTimeout(y, 0, c);
      };
    }
    var l = Object.getPrototypeOf && Object.getPrototypeOf(o);
    l = l && l.setTimeout ? l : o, {}.toString.call(o.process) === "[object process]" ? u() : e() ? r() : o.MessageChannel ? i() : h && "onreadystatechange" in h.createElement("script") ? p() : t(), l.setImmediate = m, l.clearImmediate = v;
  })(typeof self > "u" ? typeof O > "u" ? se : O : self)), se;
}
var We;
function w() {
  return We || (We = 1, (function(o) {
    var a = B(), n = gr(), s = Y(), d = q();
    Ur();
    function h(e) {
      var r = null;
      return a.uint8array ? r = new Uint8Array(e.length) : r = new Array(e.length), m(e, r);
    }
    o.newBlob = function(e, r) {
      o.checkSupport("blob");
      try {
        return new Blob([e], {
          type: r
        });
      } catch {
        try {
          var i = self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder, p = new i();
          return p.append(e), p.getBlob(r);
        } catch {
          throw new Error("Bug : can't construct the Blob.");
        }
      }
    };
    function f(e) {
      return e;
    }
    function m(e, r) {
      for (var i = 0; i < e.length; ++i)
        r[i] = e.charCodeAt(i) & 255;
      return r;
    }
    var v = {
      /**
       * Transform an array of int into a string, chunk by chunk.
       * See the performances notes on arrayLikeToString.
       * @param {Array|ArrayBuffer|Uint8Array|Buffer} array the array to transform.
       * @param {String} type the type of the array.
       * @param {Integer} chunk the chunk size.
       * @return {String} the resulting string.
       * @throws Error if the chunk is too big for the stack.
       */
      stringifyByChunk: function(e, r, i) {
        var p = [], t = 0, l = e.length;
        if (l <= i)
          return String.fromCharCode.apply(null, e);
        for (; t < l; )
          r === "array" || r === "nodebuffer" ? p.push(String.fromCharCode.apply(null, e.slice(t, Math.min(t + i, l)))) : p.push(String.fromCharCode.apply(null, e.subarray(t, Math.min(t + i, l)))), t += i;
        return p.join("");
      },
      /**
       * Call String.fromCharCode on every item in the array.
       * This is the naive implementation, which generate A LOT of intermediate string.
       * This should be used when everything else fail.
       * @param {Array|ArrayBuffer|Uint8Array|Buffer} array the array to transform.
       * @return {String} the result.
       */
      stringifyByChar: function(e) {
        for (var r = "", i = 0; i < e.length; i++)
          r += String.fromCharCode(e[i]);
        return r;
      },
      applyCanBeUsed: {
        /**
         * true if the browser accepts to use String.fromCharCode on Uint8Array
         */
        uint8array: (function() {
          try {
            return a.uint8array && String.fromCharCode.apply(null, new Uint8Array(1)).length === 1;
          } catch {
            return !1;
          }
        })(),
        /**
         * true if the browser accepts to use String.fromCharCode on nodejs Buffer.
         */
        nodebuffer: (function() {
          try {
            return a.nodebuffer && String.fromCharCode.apply(null, s.allocBuffer(1)).length === 1;
          } catch {
            return !1;
          }
        })()
      }
    };
    function C(e) {
      var r = 65536, i = o.getTypeOf(e), p = !0;
      if (i === "uint8array" ? p = v.applyCanBeUsed.uint8array : i === "nodebuffer" && (p = v.applyCanBeUsed.nodebuffer), p)
        for (; r > 1; )
          try {
            return v.stringifyByChunk(e, i, r);
          } catch {
            r = Math.floor(r / 2);
          }
      return v.stringifyByChar(e);
    }
    o.applyFromCharCode = C;
    function y(e, r) {
      for (var i = 0; i < e.length; i++)
        r[i] = e[i];
      return r;
    }
    var u = {};
    u.string = {
      string: f,
      array: function(e) {
        return m(e, new Array(e.length));
      },
      arraybuffer: function(e) {
        return u.string.uint8array(e).buffer;
      },
      uint8array: function(e) {
        return m(e, new Uint8Array(e.length));
      },
      nodebuffer: function(e) {
        return m(e, s.allocBuffer(e.length));
      }
    }, u.array = {
      string: C,
      array: f,
      arraybuffer: function(e) {
        return new Uint8Array(e).buffer;
      },
      uint8array: function(e) {
        return new Uint8Array(e);
      },
      nodebuffer: function(e) {
        return s.newBufferFrom(e);
      }
    }, u.arraybuffer = {
      string: function(e) {
        return C(new Uint8Array(e));
      },
      array: function(e) {
        return y(new Uint8Array(e), new Array(e.byteLength));
      },
      arraybuffer: f,
      uint8array: function(e) {
        return new Uint8Array(e);
      },
      nodebuffer: function(e) {
        return s.newBufferFrom(new Uint8Array(e));
      }
    }, u.uint8array = {
      string: C,
      array: function(e) {
        return y(e, new Array(e.length));
      },
      arraybuffer: function(e) {
        return e.buffer;
      },
      uint8array: f,
      nodebuffer: function(e) {
        return s.newBufferFrom(e);
      }
    }, u.nodebuffer = {
      string: C,
      array: function(e) {
        return y(e, new Array(e.length));
      },
      arraybuffer: function(e) {
        return u.nodebuffer.uint8array(e).buffer;
      },
      uint8array: function(e) {
        return y(e, new Uint8Array(e.length));
      },
      nodebuffer: f
    }, o.transformTo = function(e, r) {
      if (r || (r = ""), !e)
        return r;
      o.checkSupport(e);
      var i = o.getTypeOf(r), p = u[i][e](r);
      return p;
    }, o.resolve = function(e) {
      for (var r = e.split("/"), i = [], p = 0; p < r.length; p++) {
        var t = r[p];
        t === "." || t === "" && p !== 0 && p !== r.length - 1 || (t === ".." ? i.pop() : i.push(t));
      }
      return i.join("/");
    }, o.getTypeOf = function(e) {
      if (typeof e == "string")
        return "string";
      if (Object.prototype.toString.call(e) === "[object Array]")
        return "array";
      if (a.nodebuffer && s.isBuffer(e))
        return "nodebuffer";
      if (a.uint8array && e instanceof Uint8Array)
        return "uint8array";
      if (a.arraybuffer && e instanceof ArrayBuffer)
        return "arraybuffer";
    }, o.checkSupport = function(e) {
      var r = a[e.toLowerCase()];
      if (!r)
        throw new Error(e + " is not supported by this platform");
    }, o.MAX_VALUE_16BITS = 65535, o.MAX_VALUE_32BITS = -1, o.pretty = function(e) {
      var r = "", i, p;
      for (p = 0; p < (e || "").length; p++)
        i = e.charCodeAt(p), r += "\\x" + (i < 16 ? "0" : "") + i.toString(16).toUpperCase();
      return r;
    }, o.delay = function(e, r, i) {
      setImmediate(function() {
        e.apply(i || null, r || []);
      });
    }, o.inherits = function(e, r) {
      var i = function() {
      };
      i.prototype = r.prototype, e.prototype = new i();
    }, o.extend = function() {
      var e = {}, r, i;
      for (r = 0; r < arguments.length; r++)
        for (i in arguments[r])
          Object.prototype.hasOwnProperty.call(arguments[r], i) && typeof e[i] > "u" && (e[i] = arguments[r][i]);
      return e;
    }, o.prepareContent = function(e, r, i, p, t) {
      var l = d.Promise.resolve(r).then(function(c) {
        var g = a.blob && (c instanceof Blob || ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(c)) !== -1);
        return g && typeof FileReader < "u" ? new d.Promise(function(x, S) {
          var E = new FileReader();
          E.onload = function(b) {
            x(b.target.result);
          }, E.onerror = function(b) {
            S(b.target.error);
          }, E.readAsArrayBuffer(c);
        }) : c;
      });
      return l.then(function(c) {
        var g = o.getTypeOf(c);
        return g ? (g === "arraybuffer" ? c = o.transformTo("uint8array", c) : g === "string" && (t ? c = n.decode(c) : i && p !== !0 && (c = h(c))), c) : d.Promise.reject(
          new Error("Can't read the data of '" + e + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?")
        );
      });
    };
  })(Q)), Q;
}
var ae, je;
function F() {
  if (je) return ae;
  je = 1;
  function o(a) {
    this.name = a || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = !0, this.isFinished = !1, this.isLocked = !1, this._listeners = {
      data: [],
      end: [],
      error: []
    }, this.previous = null;
  }
  return o.prototype = {
    /**
     * Push a chunk to the next workers.
     * @param {Object} chunk the chunk to push
     */
    push: function(a) {
      this.emit("data", a);
    },
    /**
     * End the stream.
     * @return {Boolean} true if this call ended the worker, false otherwise.
     */
    end: function() {
      if (this.isFinished)
        return !1;
      this.flush();
      try {
        this.emit("end"), this.cleanUp(), this.isFinished = !0;
      } catch (a) {
        this.emit("error", a);
      }
      return !0;
    },
    /**
     * End the stream with an error.
     * @param {Error} e the error which caused the premature end.
     * @return {Boolean} true if this call ended the worker with an error, false otherwise.
     */
    error: function(a) {
      return this.isFinished ? !1 : (this.isPaused ? this.generatedError = a : (this.isFinished = !0, this.emit("error", a), this.previous && this.previous.error(a), this.cleanUp()), !0);
    },
    /**
     * Add a callback on an event.
     * @param {String} name the name of the event (data, end, error)
     * @param {Function} listener the function to call when the event is triggered
     * @return {GenericWorker} the current object for chainability
     */
    on: function(a, n) {
      return this._listeners[a].push(n), this;
    },
    /**
     * Clean any references when a worker is ending.
     */
    cleanUp: function() {
      this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
    },
    /**
     * Trigger an event. This will call registered callback with the provided arg.
     * @param {String} name the name of the event (data, end, error)
     * @param {Object} arg the argument to call the callback with.
     */
    emit: function(a, n) {
      if (this._listeners[a])
        for (var s = 0; s < this._listeners[a].length; s++)
          this._listeners[a][s].call(this, n);
    },
    /**
     * Chain a worker with an other.
     * @param {Worker} next the worker receiving events from the current one.
     * @return {worker} the next worker for chainability
     */
    pipe: function(a) {
      return a.registerPrevious(this);
    },
    /**
     * Same as `pipe` in the other direction.
     * Using an API with `pipe(next)` is very easy.
     * Implementing the API with the point of view of the next one registering
     * a source is easier, see the ZipFileWorker.
     * @param {Worker} previous the previous worker, sending events to this one
     * @return {Worker} the current worker for chainability
     */
    registerPrevious: function(a) {
      if (this.isLocked)
        throw new Error("The stream '" + this + "' has already been used.");
      this.streamInfo = a.streamInfo, this.mergeStreamInfo(), this.previous = a;
      var n = this;
      return a.on("data", function(s) {
        n.processChunk(s);
      }), a.on("end", function() {
        n.end();
      }), a.on("error", function(s) {
        n.error(s);
      }), this;
    },
    /**
     * Pause the stream so it doesn't send events anymore.
     * @return {Boolean} true if this call paused the worker, false otherwise.
     */
    pause: function() {
      return this.isPaused || this.isFinished ? !1 : (this.isPaused = !0, this.previous && this.previous.pause(), !0);
    },
    /**
     * Resume a paused stream.
     * @return {Boolean} true if this call resumed the worker, false otherwise.
     */
    resume: function() {
      if (!this.isPaused || this.isFinished)
        return !1;
      this.isPaused = !1;
      var a = !1;
      return this.generatedError && (this.error(this.generatedError), a = !0), this.previous && this.previous.resume(), !a;
    },
    /**
     * Flush any remaining bytes as the stream is ending.
     */
    flush: function() {
    },
    /**
     * Process a chunk. This is usually the method overridden.
     * @param {Object} chunk the chunk to process.
     */
    processChunk: function(a) {
      this.push(a);
    },
    /**
     * Add a key/value to be added in the workers chain streamInfo once activated.
     * @param {String} key the key to use
     * @param {Object} value the associated value
     * @return {Worker} the current worker for chainability
     */
    withStreamInfo: function(a, n) {
      return this.extraStreamInfo[a] = n, this.mergeStreamInfo(), this;
    },
    /**
     * Merge this worker's streamInfo into the chain's streamInfo.
     */
    mergeStreamInfo: function() {
      for (var a in this.extraStreamInfo)
        Object.prototype.hasOwnProperty.call(this.extraStreamInfo, a) && (this.streamInfo[a] = this.extraStreamInfo[a]);
    },
    /**
     * Lock the stream to prevent further updates on the workers chain.
     * After calling this method, all calls to pipe will fail.
     */
    lock: function() {
      if (this.isLocked)
        throw new Error("The stream '" + this + "' has already been used.");
      this.isLocked = !0, this.previous && this.previous.lock();
    },
    /**
     *
     * Pretty print the workers chain.
     */
    toString: function() {
      var a = "Worker " + this.name;
      return this.previous ? this.previous + " -> " + a : a;
    }
  }, ae = o, ae;
}
var Me;
function W() {
  return Me || (Me = 1, (function(o) {
    for (var a = w(), n = B(), s = Y(), d = F(), h = new Array(256), f = 0; f < 256; f++)
      h[f] = f >= 252 ? 6 : f >= 248 ? 5 : f >= 240 ? 4 : f >= 224 ? 3 : f >= 192 ? 2 : 1;
    h[254] = h[254] = 1;
    var m = function(e) {
      var r, i, p, t, l, c = e.length, g = 0;
      for (t = 0; t < c; t++)
        i = e.charCodeAt(t), (i & 64512) === 55296 && t + 1 < c && (p = e.charCodeAt(t + 1), (p & 64512) === 56320 && (i = 65536 + (i - 55296 << 10) + (p - 56320), t++)), g += i < 128 ? 1 : i < 2048 ? 2 : i < 65536 ? 3 : 4;
      for (n.uint8array ? r = new Uint8Array(g) : r = new Array(g), l = 0, t = 0; l < g; t++)
        i = e.charCodeAt(t), (i & 64512) === 55296 && t + 1 < c && (p = e.charCodeAt(t + 1), (p & 64512) === 56320 && (i = 65536 + (i - 55296 << 10) + (p - 56320), t++)), i < 128 ? r[l++] = i : i < 2048 ? (r[l++] = 192 | i >>> 6, r[l++] = 128 | i & 63) : i < 65536 ? (r[l++] = 224 | i >>> 12, r[l++] = 128 | i >>> 6 & 63, r[l++] = 128 | i & 63) : (r[l++] = 240 | i >>> 18, r[l++] = 128 | i >>> 12 & 63, r[l++] = 128 | i >>> 6 & 63, r[l++] = 128 | i & 63);
      return r;
    }, v = function(e, r) {
      var i;
      for (r = r || e.length, r > e.length && (r = e.length), i = r - 1; i >= 0 && (e[i] & 192) === 128; )
        i--;
      return i < 0 || i === 0 ? r : i + h[e[i]] > r ? i : r;
    }, C = function(e) {
      var r, i, p, t, l = e.length, c = new Array(l * 2);
      for (i = 0, r = 0; r < l; ) {
        if (p = e[r++], p < 128) {
          c[i++] = p;
          continue;
        }
        if (t = h[p], t > 4) {
          c[i++] = 65533, r += t - 1;
          continue;
        }
        for (p &= t === 2 ? 31 : t === 3 ? 15 : 7; t > 1 && r < l; )
          p = p << 6 | e[r++] & 63, t--;
        if (t > 1) {
          c[i++] = 65533;
          continue;
        }
        p < 65536 ? c[i++] = p : (p -= 65536, c[i++] = 55296 | p >> 10 & 1023, c[i++] = 56320 | p & 1023);
      }
      return c.length !== i && (c.subarray ? c = c.subarray(0, i) : c.length = i), a.applyFromCharCode(c);
    };
    o.utf8encode = function(r) {
      return n.nodebuffer ? s.newBufferFrom(r, "utf-8") : m(r);
    }, o.utf8decode = function(r) {
      return n.nodebuffer ? a.transformTo("nodebuffer", r).toString("utf-8") : (r = a.transformTo(n.uint8array ? "uint8array" : "array", r), C(r));
    };
    function y() {
      d.call(this, "utf-8 decode"), this.leftOver = null;
    }
    a.inherits(y, d), y.prototype.processChunk = function(e) {
      var r = a.transformTo(n.uint8array ? "uint8array" : "array", e.data);
      if (this.leftOver && this.leftOver.length) {
        if (n.uint8array) {
          var i = r;
          r = new Uint8Array(i.length + this.leftOver.length), r.set(this.leftOver, 0), r.set(i, this.leftOver.length);
        } else
          r = this.leftOver.concat(r);
        this.leftOver = null;
      }
      var p = v(r), t = r;
      p !== r.length && (n.uint8array ? (t = r.subarray(0, p), this.leftOver = r.subarray(p, r.length)) : (t = r.slice(0, p), this.leftOver = r.slice(p, r.length))), this.push({
        data: o.utf8decode(t),
        meta: e.meta
      });
    }, y.prototype.flush = function() {
      this.leftOver && this.leftOver.length && (this.push({
        data: o.utf8decode(this.leftOver),
        meta: {}
      }), this.leftOver = null);
    }, o.Utf8DecodeWorker = y;
    function u() {
      d.call(this, "utf-8 encode");
    }
    a.inherits(u, d), u.prototype.processChunk = function(e) {
      this.push({
        data: o.utf8encode(e.data),
        meta: e.meta
      });
    }, o.Utf8EncodeWorker = u;
  })($)), $;
}
var oe, Ze;
function qr() {
  if (Ze) return oe;
  Ze = 1;
  var o = F(), a = w();
  function n(s) {
    o.call(this, "ConvertWorker to " + s), this.destType = s;
  }
  return a.inherits(n, o), n.prototype.processChunk = function(s) {
    this.push({
      data: a.transformTo(this.destType, s.data),
      meta: s.meta
    });
  }, oe = n, oe;
}
var ue, He;
function Wr() {
  if (He) return ue;
  He = 1;
  var o = yr().Readable, a = w();
  a.inherits(n, o);
  function n(s, d, h) {
    o.call(this, d), this._helper = s;
    var f = this;
    s.on("data", function(m, v) {
      f.push(m) || f._helper.pause(), h && h(v);
    }).on("error", function(m) {
      f.emit("error", m);
    }).on("end", function() {
      f.push(null);
    });
  }
  return n.prototype._read = function() {
    this._helper.resume();
  }, ue = n, ue;
}
var fe, Ge;
function Cr() {
  if (Ge) return fe;
  Ge = 1;
  var o = w(), a = qr(), n = F(), s = gr(), d = B(), h = q(), f = null;
  if (d.nodestream)
    try {
      f = Wr();
    } catch {
    }
  function m(u, e, r) {
    switch (u) {
      case "blob":
        return o.newBlob(o.transformTo("arraybuffer", e), r);
      case "base64":
        return s.encode(e);
      default:
        return o.transformTo(u, e);
    }
  }
  function v(u, e) {
    var r, i = 0, p = null, t = 0;
    for (r = 0; r < e.length; r++)
      t += e[r].length;
    switch (u) {
      case "string":
        return e.join("");
      case "array":
        return Array.prototype.concat.apply([], e);
      case "uint8array":
        for (p = new Uint8Array(t), r = 0; r < e.length; r++)
          p.set(e[r], i), i += e[r].length;
        return p;
      case "nodebuffer":
        return Buffer.concat(e);
      default:
        throw new Error("concat : unsupported type '" + u + "'");
    }
  }
  function C(u, e) {
    return new h.Promise(function(r, i) {
      var p = [], t = u._internalType, l = u._outputType, c = u._mimeType;
      u.on("data", function(g, x) {
        p.push(g), e && e(x);
      }).on("error", function(g) {
        p = [], i(g);
      }).on("end", function() {
        try {
          var g = m(l, v(t, p), c);
          r(g);
        } catch (x) {
          i(x);
        }
        p = [];
      }).resume();
    });
  }
  function y(u, e, r) {
    var i = e;
    switch (e) {
      case "blob":
      case "arraybuffer":
        i = "uint8array";
        break;
      case "base64":
        i = "string";
        break;
    }
    try {
      this._internalType = i, this._outputType = e, this._mimeType = r, o.checkSupport(i), this._worker = u.pipe(new a(i)), u.lock();
    } catch (p) {
      this._worker = new n("error"), this._worker.error(p);
    }
  }
  return y.prototype = {
    /**
     * Listen a StreamHelper, accumulate its content and concatenate it into a
     * complete block.
     * @param {Function} updateCb the update callback.
     * @return Promise the promise for the accumulation.
     */
    accumulate: function(u) {
      return C(this, u);
    },
    /**
     * Add a listener on an event triggered on a stream.
     * @param {String} evt the name of the event
     * @param {Function} fn the listener
     * @return {StreamHelper} the current helper.
     */
    on: function(u, e) {
      var r = this;
      return u === "data" ? this._worker.on(u, function(i) {
        e.call(r, i.data, i.meta);
      }) : this._worker.on(u, function() {
        o.delay(e, arguments, r);
      }), this;
    },
    /**
     * Resume the flow of chunks.
     * @return {StreamHelper} the current helper.
     */
    resume: function() {
      return o.delay(this._worker.resume, [], this._worker), this;
    },
    /**
     * Pause the flow of chunks.
     * @return {StreamHelper} the current helper.
     */
    pause: function() {
      return this._worker.pause(), this;
    },
    /**
     * Return a nodejs stream for this helper.
     * @param {Function} updateCb the update callback.
     * @return {NodejsStreamOutputAdapter} the nodejs stream.
     */
    toNodejsStream: function(u) {
      if (o.checkSupport("nodestream"), this._outputType !== "nodebuffer")
        throw new Error(this._outputType + " is not supported by this method");
      return new f(this, {
        objectMode: this._outputType !== "nodebuffer"
      }, u);
    }
  }, fe = y, fe;
}
var I = {}, Ye;
function xr() {
  return Ye || (Ye = 1, I.base64 = !1, I.binary = !1, I.dir = !1, I.createFolders = !0, I.date = null, I.compression = null, I.compressionOptions = null, I.comment = null, I.unixPermissions = null, I.dosPermissions = null), I;
}
var ce, Ve;
function Sr() {
  if (Ve) return ce;
  Ve = 1;
  var o = w(), a = F(), n = 16 * 1024;
  function s(d) {
    a.call(this, "DataWorker");
    var h = this;
    this.dataIsReady = !1, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = !1, d.then(function(f) {
      h.dataIsReady = !0, h.data = f, h.max = f && f.length || 0, h.type = o.getTypeOf(f), h.isPaused || h._tickAndRepeat();
    }, function(f) {
      h.error(f);
    });
  }
  return o.inherits(s, a), s.prototype.cleanUp = function() {
    a.prototype.cleanUp.call(this), this.data = null;
  }, s.prototype.resume = function() {
    return a.prototype.resume.call(this) ? (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = !0, o.delay(this._tickAndRepeat, [], this)), !0) : !1;
  }, s.prototype._tickAndRepeat = function() {
    this._tickScheduled = !1, !(this.isPaused || this.isFinished) && (this._tick(), this.isFinished || (o.delay(this._tickAndRepeat, [], this), this._tickScheduled = !0));
  }, s.prototype._tick = function() {
    if (this.isPaused || this.isFinished)
      return !1;
    var d = n, h = null, f = Math.min(this.max, this.index + d);
    if (this.index >= this.max)
      return this.end();
    switch (this.type) {
      case "string":
        h = this.data.substring(this.index, f);
        break;
      case "uint8array":
        h = this.data.subarray(this.index, f);
        break;
      case "array":
      case "nodebuffer":
        h = this.data.slice(this.index, f);
        break;
    }
    return this.index = f, this.push({
      data: h,
      meta: {
        percent: this.max ? this.index / this.max * 100 : 0
      }
    });
  }, ce = s, ce;
}
var he, Xe;
function Oe() {
  if (Xe) return he;
  Xe = 1;
  var o = w();
  function a() {
    for (var h, f = [], m = 0; m < 256; m++) {
      h = m;
      for (var v = 0; v < 8; v++)
        h = h & 1 ? 3988292384 ^ h >>> 1 : h >>> 1;
      f[m] = h;
    }
    return f;
  }
  var n = a();
  function s(h, f, m, v) {
    var C = n, y = v + m;
    h = h ^ -1;
    for (var u = v; u < y; u++)
      h = h >>> 8 ^ C[(h ^ f[u]) & 255];
    return h ^ -1;
  }
  function d(h, f, m, v) {
    var C = n, y = v + m;
    h = h ^ -1;
    for (var u = v; u < y; u++)
      h = h >>> 8 ^ C[(h ^ f.charCodeAt(u)) & 255];
    return h ^ -1;
  }
  return he = function(f, m) {
    if (typeof f > "u" || !f.length)
      return 0;
    var v = o.getTypeOf(f) !== "string";
    return v ? s(m | 0, f, f.length, 0) : d(m | 0, f, f.length, 0);
  }, he;
}
var le, Ke;
function wr() {
  if (Ke) return le;
  Ke = 1;
  var o = F(), a = Oe(), n = w();
  function s() {
    o.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
  }
  return n.inherits(s, o), s.prototype.processChunk = function(d) {
    this.streamInfo.crc32 = a(d.data, this.streamInfo.crc32 || 0), this.push(d);
  }, le = s, le;
}
var de, Je;
function jr() {
  if (Je) return de;
  Je = 1;
  var o = w(), a = F();
  function n(s) {
    a.call(this, "DataLengthProbe for " + s), this.propName = s, this.withStreamInfo(s, 0);
  }
  return o.inherits(n, a), n.prototype.processChunk = function(s) {
    if (s) {
      var d = this.streamInfo[this.propName] || 0;
      this.streamInfo[this.propName] = d + s.data.length;
    }
    a.prototype.processChunk.call(this, s);
  }, de = n, de;
}
var pe, $e;
function Fe() {
  if ($e) return pe;
  $e = 1;
  var o = q(), a = Sr(), n = wr(), s = jr();
  function d(h, f, m, v, C) {
    this.compressedSize = h, this.uncompressedSize = f, this.crc32 = m, this.compression = v, this.compressedContent = C;
  }
  return d.prototype = {
    /**
     * Create a worker to get the uncompressed content.
     * @return {GenericWorker} the worker.
     */
    getContentWorker: function() {
      var h = new a(o.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new s("data_length")), f = this;
      return h.on("end", function() {
        if (this.streamInfo.data_length !== f.uncompressedSize)
          throw new Error("Bug : uncompressed data size mismatch");
      }), h;
    },
    /**
     * Create a worker to get the compressed content.
     * @return {GenericWorker} the worker.
     */
    getCompressedWorker: function() {
      return new a(o.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
    }
  }, d.createWorkerFrom = function(h, f, m) {
    return h.pipe(new n()).pipe(new s("uncompressedSize")).pipe(f.compressWorker(m)).pipe(new s("compressedSize")).withStreamInfo("compression", f);
  }, pe = d, pe;
}
var me, Qe;
function Mr() {
  if (Qe) return me;
  Qe = 1;
  var o = Cr(), a = Sr(), n = W(), s = Fe(), d = F(), h = function(C, y, u) {
    this.name = C, this.dir = u.dir, this.date = u.date, this.comment = u.comment, this.unixPermissions = u.unixPermissions, this.dosPermissions = u.dosPermissions, this._data = y, this._dataBinary = u.binary, this.options = {
      compression: u.compression,
      compressionOptions: u.compressionOptions
    };
  };
  h.prototype = {
    /**
     * Create an internal stream for the content of this object.
     * @param {String} type the type of each chunk.
     * @return StreamHelper the stream.
     */
    internalStream: function(C) {
      var y = null, u = "string";
      try {
        if (!C)
          throw new Error("No output type specified.");
        u = C.toLowerCase();
        var e = u === "string" || u === "text";
        (u === "binarystring" || u === "text") && (u = "string"), y = this._decompressWorker();
        var r = !this._dataBinary;
        r && !e && (y = y.pipe(new n.Utf8EncodeWorker())), !r && e && (y = y.pipe(new n.Utf8DecodeWorker()));
      } catch (i) {
        y = new d("error"), y.error(i);
      }
      return new o(y, u, "");
    },
    /**
     * Prepare the content in the asked type.
     * @param {String} type the type of the result.
     * @param {Function} onUpdate a function to call on each internal update.
     * @return Promise the promise of the result.
     */
    async: function(C, y) {
      return this.internalStream(C).accumulate(y);
    },
    /**
     * Prepare the content as a nodejs stream.
     * @param {String} type the type of each chunk.
     * @param {Function} onUpdate a function to call on each internal update.
     * @return Stream the stream.
     */
    nodeStream: function(C, y) {
      return this.internalStream(C || "nodebuffer").toNodejsStream(y);
    },
    /**
     * Return a worker for the compressed content.
     * @private
     * @param {Object} compression the compression object to use.
     * @param {Object} compressionOptions the options to use when compressing.
     * @return Worker the worker.
     */
    _compressWorker: function(C, y) {
      if (this._data instanceof s && this._data.compression.magic === C.magic)
        return this._data.getCompressedWorker();
      var u = this._decompressWorker();
      return this._dataBinary || (u = u.pipe(new n.Utf8EncodeWorker())), s.createWorkerFrom(u, C, y);
    },
    /**
     * Return a worker for the decompressed content.
     * @private
     * @return Worker the worker.
     */
    _decompressWorker: function() {
      return this._data instanceof s ? this._data.getContentWorker() : this._data instanceof d ? this._data : new a(this._data);
    }
  };
  for (var f = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], m = function() {
    throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
  }, v = 0; v < f.length; v++)
    h.prototype[f[v]] = m;
  return me = h, me;
}
var ve = {}, G = {}, U = {}, er;
function Zr() {
  if (er) return U;
  er = 1;
  var o = typeof Uint8Array < "u" && typeof Uint16Array < "u" && typeof Uint32Array < "u", a = Tr(), n = w(), s = F(), d = o ? "uint8array" : "array";
  U.magic = "\b\0";
  function h(f, m) {
    s.call(this, "FlateWorker/" + f), this._pako = null, this._pakoAction = f, this._pakoOptions = m, this.meta = {};
  }
  return n.inherits(h, s), h.prototype.processChunk = function(f) {
    this.meta = f.meta, this._pako === null && this._createPako(), this._pako.push(n.transformTo(d, f.data), !1);
  }, h.prototype.flush = function() {
    s.prototype.flush.call(this), this._pako === null && this._createPako(), this._pako.push([], !0);
  }, h.prototype.cleanUp = function() {
    s.prototype.cleanUp.call(this), this._pako = null;
  }, h.prototype._createPako = function() {
    this._pako = new a[this._pakoAction]({
      raw: !0,
      level: this._pakoOptions.level || -1
      // default compression
    });
    var f = this;
    this._pako.onData = function(m) {
      f.push({
        data: m,
        meta: f.meta
      });
    };
  }, U.compressWorker = function(f) {
    return new h("Deflate", f);
  }, U.uncompressWorker = function() {
    return new h("Inflate", {});
  }, U;
}
var rr;
function Er() {
  if (rr) return G;
  rr = 1;
  var o = F();
  return G.STORE = {
    magic: "\0\0",
    compressWorker: function() {
      return new o("STORE compression");
    },
    uncompressWorker: function() {
      return new o("STORE decompression");
    }
  }, G.DEFLATE = Zr(), G;
}
var D = {}, tr;
function br() {
  return tr || (tr = 1, D.LOCAL_FILE_HEADER = "PK", D.CENTRAL_FILE_HEADER = "PK", D.CENTRAL_DIRECTORY_END = "PK", D.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", D.ZIP64_CENTRAL_DIRECTORY_END = "PK", D.DATA_DESCRIPTOR = "PK\x07\b"), D;
}
var ye, ir;
function Hr() {
  if (ir) return ye;
  ir = 1;
  var o = w(), a = F(), n = W(), s = Oe(), d = br(), h = function(e, r) {
    var i = "", p;
    for (p = 0; p < r; p++)
      i += String.fromCharCode(e & 255), e = e >>> 8;
    return i;
  }, f = function(e, r) {
    var i = e;
    return e || (i = r ? 16893 : 33204), (i & 65535) << 16;
  }, m = function(e) {
    return (e || 0) & 63;
  }, v = function(e, r, i, p, t, l) {
    var c = e.file, g = e.compression, x = l !== n.utf8encode, S = o.transformTo("string", l(c.name)), E = o.transformTo("string", n.utf8encode(c.name)), b = c.comment, A = o.transformTo("string", l(b)), P = o.transformTo("string", n.utf8encode(b)), j = E.length !== c.name.length, M = P.length !== b.length, _, T, N = "", V = "", X = "", Te = c.dir, L = c.date, z = {
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0
    };
    (!r || i) && (z.crc32 = e.crc32, z.compressedSize = e.compressedSize, z.uncompressedSize = e.uncompressedSize);
    var K = 0;
    r && (K |= 8), !x && (j || M) && (K |= 2048);
    var Z = 0, J = 0;
    Te && (Z |= 16), t === "UNIX" ? (J = 798, Z |= f(c.unixPermissions, Te)) : (J = 20, Z |= m(c.dosPermissions)), _ = L.getUTCHours(), _ = _ << 6, _ = _ | L.getUTCMinutes(), _ = _ << 5, _ = _ | L.getUTCSeconds() / 2, T = L.getUTCFullYear() - 1980, T = T << 4, T = T | L.getUTCMonth() + 1, T = T << 5, T = T | L.getUTCDate(), j && (V = // Version
    h(1, 1) + // NameCRC32
    h(s(S), 4) + // UnicodeName
    E, N += // Info-ZIP Unicode Path Extra Field
    "up" + // size
    h(V.length, 2) + // content
    V), M && (X = // Version
    h(1, 1) + // CommentCRC32
    h(s(A), 4) + // UnicodeName
    P, N += // Info-ZIP Unicode Path Extra Field
    "uc" + // size
    h(X.length, 2) + // content
    X);
    var R = "";
    R += `
\0`, R += h(K, 2), R += g.magic, R += h(_, 2), R += h(T, 2), R += h(z.crc32, 4), R += h(z.compressedSize, 4), R += h(z.uncompressedSize, 4), R += h(S.length, 2), R += h(N.length, 2);
    var Ir = d.LOCAL_FILE_HEADER + R + S + N, Or = d.CENTRAL_FILE_HEADER + // version made by (00: DOS)
    h(J, 2) + // file header (common to file and central directory)
    R + // file comment length
    h(A.length, 2) + // disk number start
    "\0\0\0\0" + // external file attributes
    h(Z, 4) + // relative offset of local header
    h(p, 4) + // file name
    S + // extra field
    N + // file comment
    A;
    return {
      fileRecord: Ir,
      dirRecord: Or
    };
  }, C = function(e, r, i, p, t) {
    var l = "", c = o.transformTo("string", t(p));
    return l = d.CENTRAL_DIRECTORY_END + // number of this disk
    "\0\0\0\0" + // total number of entries in the central directory on this disk
    h(e, 2) + // total number of entries in the central directory
    h(e, 2) + // size of the central directory   4 bytes
    h(r, 4) + // offset of start of central directory with respect to the starting disk number
    h(i, 4) + // .ZIP file comment length
    h(c.length, 2) + // .ZIP file comment
    c, l;
  }, y = function(e) {
    var r = "";
    return r = d.DATA_DESCRIPTOR + // crc-32                          4 bytes
    h(e.crc32, 4) + // compressed size                 4 bytes
    h(e.compressedSize, 4) + // uncompressed size               4 bytes
    h(e.uncompressedSize, 4), r;
  };
  function u(e, r, i, p) {
    a.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = r, this.zipPlatform = i, this.encodeFileName = p, this.streamFiles = e, this.accumulate = !1, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
  }
  return o.inherits(u, a), u.prototype.push = function(e) {
    var r = e.meta.percent || 0, i = this.entriesCount, p = this._sources.length;
    this.accumulate ? this.contentBuffer.push(e) : (this.bytesWritten += e.data.length, a.prototype.push.call(this, {
      data: e.data,
      meta: {
        currentFile: this.currentFile,
        percent: i ? (r + 100 * (i - p - 1)) / i : 100
      }
    }));
  }, u.prototype.openedSource = function(e) {
    this.currentSourceOffset = this.bytesWritten, this.currentFile = e.file.name;
    var r = this.streamFiles && !e.file.dir;
    if (r) {
      var i = v(e, r, !1, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
      this.push({
        data: i.fileRecord,
        meta: { percent: 0 }
      });
    } else
      this.accumulate = !0;
  }, u.prototype.closedSource = function(e) {
    this.accumulate = !1;
    var r = this.streamFiles && !e.file.dir, i = v(e, r, !0, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
    if (this.dirRecords.push(i.dirRecord), r)
      this.push({
        data: y(e),
        meta: { percent: 100 }
      });
    else
      for (this.push({
        data: i.fileRecord,
        meta: { percent: 0 }
      }); this.contentBuffer.length; )
        this.push(this.contentBuffer.shift());
    this.currentFile = null;
  }, u.prototype.flush = function() {
    for (var e = this.bytesWritten, r = 0; r < this.dirRecords.length; r++)
      this.push({
        data: this.dirRecords[r],
        meta: { percent: 100 }
      });
    var i = this.bytesWritten - e, p = C(this.dirRecords.length, i, e, this.zipComment, this.encodeFileName);
    this.push({
      data: p,
      meta: { percent: 100 }
    });
  }, u.prototype.prepareNextSource = function() {
    this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
  }, u.prototype.registerPrevious = function(e) {
    this._sources.push(e);
    var r = this;
    return e.on("data", function(i) {
      r.processChunk(i);
    }), e.on("end", function() {
      r.closedSource(r.previous.streamInfo), r._sources.length ? r.prepareNextSource() : r.end();
    }), e.on("error", function(i) {
      r.error(i);
    }), this;
  }, u.prototype.resume = function() {
    if (!a.prototype.resume.call(this))
      return !1;
    if (!this.previous && this._sources.length)
      return this.prepareNextSource(), !0;
    if (!this.previous && !this._sources.length && !this.generatedError)
      return this.end(), !0;
  }, u.prototype.error = function(e) {
    var r = this._sources;
    if (!a.prototype.error.call(this, e))
      return !1;
    for (var i = 0; i < r.length; i++)
      try {
        r[i].error(e);
      } catch {
      }
    return !0;
  }, u.prototype.lock = function() {
    a.prototype.lock.call(this);
    for (var e = this._sources, r = 0; r < e.length; r++)
      e[r].lock();
  }, ye = u, ye;
}
var nr;
function Gr() {
  if (nr) return ve;
  nr = 1;
  var o = Er(), a = Hr(), n = function(s, d) {
    var h = s || d, f = o[h];
    if (!f)
      throw new Error(h + " is not a valid compression method !");
    return f;
  };
  return ve.generateWorker = function(s, d, h) {
    var f = new a(d.streamFiles, h, d.platform, d.encodeFileName), m = 0;
    try {
      s.forEach(function(v, C) {
        m++;
        var y = n(C.options.compression, d.compression), u = C.options.compressionOptions || d.compressionOptions || {}, e = C.dir, r = C.date;
        C._compressWorker(y, u).withStreamInfo("file", {
          name: v,
          dir: e,
          date: r,
          comment: C.comment || "",
          unixPermissions: C.unixPermissions,
          dosPermissions: C.dosPermissions
        }).pipe(f);
      }), f.entriesCount = m;
    } catch (v) {
      f.error(v);
    }
    return f;
  }, ve;
}
var ge, sr;
function Yr() {
  if (sr) return ge;
  sr = 1;
  var o = w(), a = F();
  function n(s, d) {
    a.call(this, "Nodejs stream input adapter for " + s), this._upstreamEnded = !1, this._bindStream(d);
  }
  return o.inherits(n, a), n.prototype._bindStream = function(s) {
    var d = this;
    this._stream = s, s.pause(), s.on("data", function(h) {
      d.push({
        data: h,
        meta: {
          percent: 0
        }
      });
    }).on("error", function(h) {
      d.isPaused ? this.generatedError = h : d.error(h);
    }).on("end", function() {
      d.isPaused ? d._upstreamEnded = !0 : d.end();
    });
  }, n.prototype.pause = function() {
    return a.prototype.pause.call(this) ? (this._stream.pause(), !0) : !1;
  }, n.prototype.resume = function() {
    return a.prototype.resume.call(this) ? (this._upstreamEnded ? this.end() : this._stream.resume(), !0) : !1;
  }, ge = n, ge;
}
var Ce, ar;
function Vr() {
  if (ar) return Ce;
  ar = 1;
  var o = W(), a = w(), n = F(), s = Cr(), d = xr(), h = Fe(), f = Mr(), m = Gr(), v = Y(), C = Yr(), y = function(t, l, c) {
    var g = a.getTypeOf(l), x, S = a.extend(c || {}, d);
    S.date = S.date || /* @__PURE__ */ new Date(), S.compression !== null && (S.compression = S.compression.toUpperCase()), typeof S.unixPermissions == "string" && (S.unixPermissions = parseInt(S.unixPermissions, 8)), S.unixPermissions && S.unixPermissions & 16384 && (S.dir = !0), S.dosPermissions && S.dosPermissions & 16 && (S.dir = !0), S.dir && (t = e(t)), S.createFolders && (x = u(t)) && r.call(this, x, !0);
    var E = g === "string" && S.binary === !1 && S.base64 === !1;
    (!c || typeof c.binary > "u") && (S.binary = !E);
    var b = l instanceof h && l.uncompressedSize === 0;
    (b || S.dir || !l || l.length === 0) && (S.base64 = !1, S.binary = !0, l = "", S.compression = "STORE", g = "string");
    var A = null;
    l instanceof h || l instanceof n ? A = l : v.isNode && v.isStream(l) ? A = new C(t, l) : A = a.prepareContent(t, l, S.binary, S.optimizedBinaryString, S.base64);
    var P = new f(t, A, S);
    this.files[t] = P;
  }, u = function(t) {
    t.slice(-1) === "/" && (t = t.substring(0, t.length - 1));
    var l = t.lastIndexOf("/");
    return l > 0 ? t.substring(0, l) : "";
  }, e = function(t) {
    return t.slice(-1) !== "/" && (t += "/"), t;
  }, r = function(t, l) {
    return l = typeof l < "u" ? l : d.createFolders, t = e(t), this.files[t] || y.call(this, t, null, {
      dir: !0,
      createFolders: l
    }), this.files[t];
  };
  function i(t) {
    return Object.prototype.toString.call(t) === "[object RegExp]";
  }
  var p = {
    /**
     * @see loadAsync
     */
    load: function() {
      throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
    },
    /**
     * Call a callback function for each entry at this folder level.
     * @param {Function} cb the callback function:
     * function (relativePath, file) {...}
     * It takes 2 arguments : the relative path and the file.
     */
    forEach: function(t) {
      var l, c, g;
      for (l in this.files)
        g = this.files[l], c = l.slice(this.root.length, l.length), c && l.slice(0, this.root.length) === this.root && t(c, g);
    },
    /**
     * Filter nested files/folders with the specified function.
     * @param {Function} search the predicate to use :
     * function (relativePath, file) {...}
     * It takes 2 arguments : the relative path and the file.
     * @return {Array} An array of matching elements.
     */
    filter: function(t) {
      var l = [];
      return this.forEach(function(c, g) {
        t(c, g) && l.push(g);
      }), l;
    },
    /**
     * Add a file to the zip file, or search a file.
     * @param   {string|RegExp} name The name of the file to add (if data is defined),
     * the name of the file to find (if no data) or a regex to match files.
     * @param   {String|ArrayBuffer|Uint8Array|Buffer} data  The file data, either raw or base64 encoded
     * @param   {Object} o     File options
     * @return  {JSZip|Object|Array} this JSZip object (when adding a file),
     * a file (when searching by string) or an array of files (when searching by regex).
     */
    file: function(t, l, c) {
      if (arguments.length === 1)
        if (i(t)) {
          var g = t;
          return this.filter(function(S, E) {
            return !E.dir && g.test(S);
          });
        } else {
          var x = this.files[this.root + t];
          return x && !x.dir ? x : null;
        }
      else
        t = this.root + t, y.call(this, t, l, c);
      return this;
    },
    /**
     * Add a directory to the zip file, or search.
     * @param   {String|RegExp} arg The name of the directory to add, or a regex to search folders.
     * @return  {JSZip} an object with the new directory as the root, or an array containing matching folders.
     */
    folder: function(t) {
      if (!t)
        return this;
      if (i(t))
        return this.filter(function(x, S) {
          return S.dir && t.test(x);
        });
      var l = this.root + t, c = r.call(this, l), g = this.clone();
      return g.root = c.name, g;
    },
    /**
     * Delete a file, or a directory and all sub-files, from the zip
     * @param {string} name the name of the file to delete
     * @return {JSZip} this JSZip object
     */
    remove: function(t) {
      t = this.root + t;
      var l = this.files[t];
      if (l || (t.slice(-1) !== "/" && (t += "/"), l = this.files[t]), l && !l.dir)
        delete this.files[t];
      else
        for (var c = this.filter(function(x, S) {
          return S.name.slice(0, t.length) === t;
        }), g = 0; g < c.length; g++)
          delete this.files[c[g].name];
      return this;
    },
    /**
     * @deprecated This method has been removed in JSZip 3.0, please check the upgrade guide.
     */
    generate: function() {
      throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
    },
    /**
     * Generate the complete zip file as an internal stream.
     * @param {Object} options the options to generate the zip file :
     * - compression, "STORE" by default.
     * - type, "base64" by default. Values are : string, base64, uint8array, arraybuffer, blob.
     * @return {StreamHelper} the streamed zip file.
     */
    generateInternalStream: function(t) {
      var l, c = {};
      try {
        if (c = a.extend(t || {}, {
          streamFiles: !1,
          compression: "STORE",
          compressionOptions: null,
          type: "",
          platform: "DOS",
          comment: null,
          mimeType: "application/zip",
          encodeFileName: o.utf8encode
        }), c.type = c.type.toLowerCase(), c.compression = c.compression.toUpperCase(), c.type === "binarystring" && (c.type = "string"), !c.type)
          throw new Error("No output type specified.");
        a.checkSupport(c.type), (c.platform === "darwin" || c.platform === "freebsd" || c.platform === "linux" || c.platform === "sunos") && (c.platform = "UNIX"), c.platform === "win32" && (c.platform = "DOS");
        var g = c.comment || this.comment || "";
        l = m.generateWorker(this, c, g);
      } catch (x) {
        l = new n("error"), l.error(x);
      }
      return new s(l, c.type || "string", c.mimeType);
    },
    /**
     * Generate the complete zip file asynchronously.
     * @see generateInternalStream
     */
    generateAsync: function(t, l) {
      return this.generateInternalStream(t).accumulate(l);
    },
    /**
     * Generate the complete zip file asynchronously.
     * @see generateInternalStream
     */
    generateNodeStream: function(t, l) {
      return t = t || {}, t.type || (t.type = "nodebuffer"), this.generateInternalStream(t).toNodejsStream(l);
    }
  };
  return Ce = p, Ce;
}
var xe, or;
function Ar() {
  if (or) return xe;
  or = 1;
  var o = w();
  function a(n) {
    this.data = n, this.length = n.length, this.index = 0, this.zero = 0;
  }
  return a.prototype = {
    /**
     * Check that the offset will not go too far.
     * @param {string} offset the additional offset to check.
     * @throws {Error} an Error if the offset is out of bounds.
     */
    checkOffset: function(n) {
      this.checkIndex(this.index + n);
    },
    /**
     * Check that the specified index will not be too far.
     * @param {string} newIndex the index to check.
     * @throws {Error} an Error if the index is out of bounds.
     */
    checkIndex: function(n) {
      if (this.length < this.zero + n || n < 0)
        throw new Error("End of data reached (data length = " + this.length + ", asked index = " + n + "). Corrupted zip ?");
    },
    /**
     * Change the index.
     * @param {number} newIndex The new index.
     * @throws {Error} if the new index is out of the data.
     */
    setIndex: function(n) {
      this.checkIndex(n), this.index = n;
    },
    /**
     * Skip the next n bytes.
     * @param {number} n the number of bytes to skip.
     * @throws {Error} if the new index is out of the data.
     */
    skip: function(n) {
      this.setIndex(this.index + n);
    },
    /**
     * Get the byte at the specified index.
     * @param {number} i the index to use.
     * @return {number} a byte.
     */
    byteAt: function() {
    },
    /**
     * Get the next number with a given byte size.
     * @param {number} size the number of bytes to read.
     * @return {number} the corresponding number.
     */
    readInt: function(n) {
      var s = 0, d;
      for (this.checkOffset(n), d = this.index + n - 1; d >= this.index; d--)
        s = (s << 8) + this.byteAt(d);
      return this.index += n, s;
    },
    /**
     * Get the next string with a given byte size.
     * @param {number} size the number of bytes to read.
     * @return {string} the corresponding string.
     */
    readString: function(n) {
      return o.transformTo("string", this.readData(n));
    },
    /**
     * Get raw data without conversion, <size> bytes.
     * @param {number} size the number of bytes to read.
     * @return {Object} the raw data, implementation specific.
     */
    readData: function() {
    },
    /**
     * Find the last occurrence of a zip signature (4 bytes).
     * @param {string} sig the signature to find.
     * @return {number} the index of the last occurrence, -1 if not found.
     */
    lastIndexOfSignature: function() {
    },
    /**
     * Read the signature (4 bytes) at the current position and compare it with sig.
     * @param {string} sig the expected signature
     * @return {boolean} true if the signature matches, false otherwise.
     */
    readAndCheckSignature: function() {
    },
    /**
     * Get the next date.
     * @return {Date} the date.
     */
    readDate: function() {
      var n = this.readInt(4);
      return new Date(Date.UTC(
        (n >> 25 & 127) + 1980,
        // year
        (n >> 21 & 15) - 1,
        // month
        n >> 16 & 31,
        // day
        n >> 11 & 31,
        // hour
        n >> 5 & 63,
        // minute
        (n & 31) << 1
      ));
    }
  }, xe = a, xe;
}
var Se, ur;
function _r() {
  if (ur) return Se;
  ur = 1;
  var o = Ar(), a = w();
  function n(s) {
    o.call(this, s);
    for (var d = 0; d < this.data.length; d++)
      s[d] = s[d] & 255;
  }
  return a.inherits(n, o), n.prototype.byteAt = function(s) {
    return this.data[this.zero + s];
  }, n.prototype.lastIndexOfSignature = function(s) {
    for (var d = s.charCodeAt(0), h = s.charCodeAt(1), f = s.charCodeAt(2), m = s.charCodeAt(3), v = this.length - 4; v >= 0; --v)
      if (this.data[v] === d && this.data[v + 1] === h && this.data[v + 2] === f && this.data[v + 3] === m)
        return v - this.zero;
    return -1;
  }, n.prototype.readAndCheckSignature = function(s) {
    var d = s.charCodeAt(0), h = s.charCodeAt(1), f = s.charCodeAt(2), m = s.charCodeAt(3), v = this.readData(4);
    return d === v[0] && h === v[1] && f === v[2] && m === v[3];
  }, n.prototype.readData = function(s) {
    if (this.checkOffset(s), s === 0)
      return [];
    var d = this.data.slice(this.zero + this.index, this.zero + this.index + s);
    return this.index += s, d;
  }, Se = n, Se;
}
var we, fr;
function Xr() {
  if (fr) return we;
  fr = 1;
  var o = Ar(), a = w();
  function n(s) {
    o.call(this, s);
  }
  return a.inherits(n, o), n.prototype.byteAt = function(s) {
    return this.data.charCodeAt(this.zero + s);
  }, n.prototype.lastIndexOfSignature = function(s) {
    return this.data.lastIndexOf(s) - this.zero;
  }, n.prototype.readAndCheckSignature = function(s) {
    var d = this.readData(4);
    return s === d;
  }, n.prototype.readData = function(s) {
    this.checkOffset(s);
    var d = this.data.slice(this.zero + this.index, this.zero + this.index + s);
    return this.index += s, d;
  }, we = n, we;
}
var Ee, cr;
function kr() {
  if (cr) return Ee;
  cr = 1;
  var o = _r(), a = w();
  function n(s) {
    o.call(this, s);
  }
  return a.inherits(n, o), n.prototype.readData = function(s) {
    if (this.checkOffset(s), s === 0)
      return new Uint8Array(0);
    var d = this.data.subarray(this.zero + this.index, this.zero + this.index + s);
    return this.index += s, d;
  }, Ee = n, Ee;
}
var be, hr;
function Kr() {
  if (hr) return be;
  hr = 1;
  var o = kr(), a = w();
  function n(s) {
    o.call(this, s);
  }
  return a.inherits(n, o), n.prototype.readData = function(s) {
    this.checkOffset(s);
    var d = this.data.slice(this.zero + this.index, this.zero + this.index + s);
    return this.index += s, d;
  }, be = n, be;
}
var Ae, lr;
function Rr() {
  if (lr) return Ae;
  lr = 1;
  var o = w(), a = B(), n = _r(), s = Xr(), d = Kr(), h = kr();
  return Ae = function(f) {
    var m = o.getTypeOf(f);
    return o.checkSupport(m), m === "string" && !a.uint8array ? new s(f) : m === "nodebuffer" ? new d(f) : a.uint8array ? new h(o.transformTo("uint8array", f)) : new n(o.transformTo("array", f));
  }, Ae;
}
var _e, dr;
function Jr() {
  if (dr) return _e;
  dr = 1;
  var o = Rr(), a = w(), n = Fe(), s = Oe(), d = W(), h = Er(), f = B(), m = 0, v = 3, C = function(u) {
    for (var e in h)
      if (Object.prototype.hasOwnProperty.call(h, e) && h[e].magic === u)
        return h[e];
    return null;
  };
  function y(u, e) {
    this.options = u, this.loadOptions = e;
  }
  return y.prototype = {
    /**
     * say if the file is encrypted.
     * @return {boolean} true if the file is encrypted, false otherwise.
     */
    isEncrypted: function() {
      return (this.bitFlag & 1) === 1;
    },
    /**
     * say if the file has utf-8 filename/comment.
     * @return {boolean} true if the filename/comment is in utf-8, false otherwise.
     */
    useUTF8: function() {
      return (this.bitFlag & 2048) === 2048;
    },
    /**
     * Read the local part of a zip file and add the info in this object.
     * @param {DataReader} reader the reader to use.
     */
    readLocalPart: function(u) {
      var e, r;
      if (u.skip(22), this.fileNameLength = u.readInt(2), r = u.readInt(2), this.fileName = u.readData(this.fileNameLength), u.skip(r), this.compressedSize === -1 || this.uncompressedSize === -1)
        throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
      if (e = C(this.compressionMethod), e === null)
        throw new Error("Corrupted zip : compression " + a.pretty(this.compressionMethod) + " unknown (inner file : " + a.transformTo("string", this.fileName) + ")");
      this.decompressed = new n(this.compressedSize, this.uncompressedSize, this.crc32, e, u.readData(this.compressedSize));
    },
    /**
     * Read the central part of a zip file and add the info in this object.
     * @param {DataReader} reader the reader to use.
     */
    readCentralPart: function(u) {
      this.versionMadeBy = u.readInt(2), u.skip(2), this.bitFlag = u.readInt(2), this.compressionMethod = u.readString(2), this.date = u.readDate(), this.crc32 = u.readInt(4), this.compressedSize = u.readInt(4), this.uncompressedSize = u.readInt(4);
      var e = u.readInt(2);
      if (this.extraFieldsLength = u.readInt(2), this.fileCommentLength = u.readInt(2), this.diskNumberStart = u.readInt(2), this.internalFileAttributes = u.readInt(2), this.externalFileAttributes = u.readInt(4), this.localHeaderOffset = u.readInt(4), this.isEncrypted())
        throw new Error("Encrypted zip are not supported");
      u.skip(e), this.readExtraFields(u), this.parseZIP64ExtraField(u), this.fileComment = u.readData(this.fileCommentLength);
    },
    /**
     * Parse the external file attributes and get the unix/dos permissions.
     */
    processAttributes: function() {
      this.unixPermissions = null, this.dosPermissions = null;
      var u = this.versionMadeBy >> 8;
      this.dir = !!(this.externalFileAttributes & 16), u === m && (this.dosPermissions = this.externalFileAttributes & 63), u === v && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), !this.dir && this.fileNameStr.slice(-1) === "/" && (this.dir = !0);
    },
    /**
     * Parse the ZIP64 extra field and merge the info in the current ZipEntry.
     * @param {DataReader} reader the reader to use.
     */
    parseZIP64ExtraField: function() {
      if (this.extraFields[1]) {
        var u = o(this.extraFields[1].value);
        this.uncompressedSize === a.MAX_VALUE_32BITS && (this.uncompressedSize = u.readInt(8)), this.compressedSize === a.MAX_VALUE_32BITS && (this.compressedSize = u.readInt(8)), this.localHeaderOffset === a.MAX_VALUE_32BITS && (this.localHeaderOffset = u.readInt(8)), this.diskNumberStart === a.MAX_VALUE_32BITS && (this.diskNumberStart = u.readInt(4));
      }
    },
    /**
     * Read the central part of a zip file and add the info in this object.
     * @param {DataReader} reader the reader to use.
     */
    readExtraFields: function(u) {
      var e = u.index + this.extraFieldsLength, r, i, p;
      for (this.extraFields || (this.extraFields = {}); u.index + 4 < e; )
        r = u.readInt(2), i = u.readInt(2), p = u.readData(i), this.extraFields[r] = {
          id: r,
          length: i,
          value: p
        };
      u.setIndex(e);
    },
    /**
     * Apply an UTF8 transformation if needed.
     */
    handleUTF8: function() {
      var u = f.uint8array ? "uint8array" : "array";
      if (this.useUTF8())
        this.fileNameStr = d.utf8decode(this.fileName), this.fileCommentStr = d.utf8decode(this.fileComment);
      else {
        var e = this.findExtraFieldUnicodePath();
        if (e !== null)
          this.fileNameStr = e;
        else {
          var r = a.transformTo(u, this.fileName);
          this.fileNameStr = this.loadOptions.decodeFileName(r);
        }
        var i = this.findExtraFieldUnicodeComment();
        if (i !== null)
          this.fileCommentStr = i;
        else {
          var p = a.transformTo(u, this.fileComment);
          this.fileCommentStr = this.loadOptions.decodeFileName(p);
        }
      }
    },
    /**
     * Find the unicode path declared in the extra field, if any.
     * @return {String} the unicode path, null otherwise.
     */
    findExtraFieldUnicodePath: function() {
      var u = this.extraFields[28789];
      if (u) {
        var e = o(u.value);
        return e.readInt(1) !== 1 || s(this.fileName) !== e.readInt(4) ? null : d.utf8decode(e.readData(u.length - 5));
      }
      return null;
    },
    /**
     * Find the unicode comment declared in the extra field, if any.
     * @return {String} the unicode comment, null otherwise.
     */
    findExtraFieldUnicodeComment: function() {
      var u = this.extraFields[25461];
      if (u) {
        var e = o(u.value);
        return e.readInt(1) !== 1 || s(this.fileComment) !== e.readInt(4) ? null : d.utf8decode(e.readData(u.length - 5));
      }
      return null;
    }
  }, _e = y, _e;
}
var ke, pr;
function $r() {
  if (pr) return ke;
  pr = 1;
  var o = Rr(), a = w(), n = br(), s = Jr(), d = B();
  function h(f) {
    this.files = [], this.loadOptions = f;
  }
  return h.prototype = {
    /**
     * Check that the reader is on the specified signature.
     * @param {string} expectedSignature the expected signature.
     * @throws {Error} if it is an other signature.
     */
    checkSignature: function(f) {
      if (!this.reader.readAndCheckSignature(f)) {
        this.reader.index -= 4;
        var m = this.reader.readString(4);
        throw new Error("Corrupted zip or bug: unexpected signature (" + a.pretty(m) + ", expected " + a.pretty(f) + ")");
      }
    },
    /**
     * Check if the given signature is at the given index.
     * @param {number} askedIndex the index to check.
     * @param {string} expectedSignature the signature to expect.
     * @return {boolean} true if the signature is here, false otherwise.
     */
    isSignature: function(f, m) {
      var v = this.reader.index;
      this.reader.setIndex(f);
      var C = this.reader.readString(4), y = C === m;
      return this.reader.setIndex(v), y;
    },
    /**
     * Read the end of the central directory.
     */
    readBlockEndOfCentral: function() {
      this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
      var f = this.reader.readData(this.zipCommentLength), m = d.uint8array ? "uint8array" : "array", v = a.transformTo(m, f);
      this.zipComment = this.loadOptions.decodeFileName(v);
    },
    /**
     * Read the end of the Zip 64 central directory.
     * Not merged with the method readEndOfCentral :
     * The end of central can coexist with its Zip64 brother,
     * I don't want to read the wrong number of bytes !
     */
    readBlockZip64EndOfCentral: function() {
      this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
      for (var f = this.zip64EndOfCentralSize - 44, m = 0, v, C, y; m < f; )
        v = this.reader.readInt(2), C = this.reader.readInt(4), y = this.reader.readData(C), this.zip64ExtensibleData[v] = {
          id: v,
          length: C,
          value: y
        };
    },
    /**
     * Read the end of the Zip 64 central directory locator.
     */
    readBlockZip64EndOfCentralLocator: function() {
      if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), this.disksCount > 1)
        throw new Error("Multi-volumes zip are not supported");
    },
    /**
     * Read the local files, based on the offset read in the central part.
     */
    readLocalFiles: function() {
      var f, m;
      for (f = 0; f < this.files.length; f++)
        m = this.files[f], this.reader.setIndex(m.localHeaderOffset), this.checkSignature(n.LOCAL_FILE_HEADER), m.readLocalPart(this.reader), m.handleUTF8(), m.processAttributes();
    },
    /**
     * Read the central directory.
     */
    readCentralDir: function() {
      var f;
      for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(n.CENTRAL_FILE_HEADER); )
        f = new s({
          zip64: this.zip64
        }, this.loadOptions), f.readCentralPart(this.reader), this.files.push(f);
      if (this.centralDirRecords !== this.files.length && this.centralDirRecords !== 0 && this.files.length === 0)
        throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
    },
    /**
     * Read the end of central directory.
     */
    readEndOfCentral: function() {
      var f = this.reader.lastIndexOfSignature(n.CENTRAL_DIRECTORY_END);
      if (f < 0) {
        var m = !this.isSignature(0, n.LOCAL_FILE_HEADER);
        throw m ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
      }
      this.reader.setIndex(f);
      var v = f;
      if (this.checkSignature(n.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === a.MAX_VALUE_16BITS || this.diskWithCentralDirStart === a.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === a.MAX_VALUE_16BITS || this.centralDirRecords === a.MAX_VALUE_16BITS || this.centralDirSize === a.MAX_VALUE_32BITS || this.centralDirOffset === a.MAX_VALUE_32BITS) {
        if (this.zip64 = !0, f = this.reader.lastIndexOfSignature(n.ZIP64_CENTRAL_DIRECTORY_LOCATOR), f < 0)
          throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
        if (this.reader.setIndex(f), this.checkSignature(n.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, n.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(n.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0))
          throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
        this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(n.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
      }
      var C = this.centralDirOffset + this.centralDirSize;
      this.zip64 && (C += 20, C += 12 + this.zip64EndOfCentralSize);
      var y = v - C;
      if (y > 0)
        this.isSignature(v, n.CENTRAL_FILE_HEADER) || (this.reader.zero = y);
      else if (y < 0)
        throw new Error("Corrupted zip: missing " + Math.abs(y) + " bytes.");
    },
    prepareReader: function(f) {
      this.reader = o(f);
    },
    /**
     * Read a zip file and create ZipEntries.
     * @param {String|ArrayBuffer|Uint8Array|Buffer} data the binary string representing a zip file.
     */
    load: function(f) {
      this.prepareReader(f), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
    }
  }, ke = h, ke;
}
var Re, mr;
function Qr() {
  if (mr) return Re;
  mr = 1;
  var o = w(), a = q(), n = W(), s = $r(), d = wr(), h = Y();
  function f(m) {
    return new a.Promise(function(v, C) {
      var y = m.decompressed.getContentWorker().pipe(new d());
      y.on("error", function(u) {
        C(u);
      }).on("end", function() {
        y.streamInfo.crc32 !== m.decompressed.crc32 ? C(new Error("Corrupted zip : CRC32 mismatch")) : v();
      }).resume();
    });
  }
  return Re = function(m, v) {
    var C = this;
    return v = o.extend(v || {}, {
      base64: !1,
      checkCRC32: !1,
      optimizedBinaryString: !1,
      createFolders: !1,
      decodeFileName: n.utf8decode
    }), h.isNode && h.isStream(m) ? a.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : o.prepareContent("the loaded zip file", m, !0, v.optimizedBinaryString, v.base64).then(function(y) {
      var u = new s(v);
      return u.load(y), u;
    }).then(function(u) {
      var e = [a.Promise.resolve(u)], r = u.files;
      if (v.checkCRC32)
        for (var i = 0; i < r.length; i++)
          e.push(f(r[i]));
      return a.Promise.all(e);
    }).then(function(u) {
      for (var e = u.shift(), r = e.files, i = 0; i < r.length; i++) {
        var p = r[i], t = p.fileNameStr, l = o.resolve(p.fileNameStr);
        C.file(l, p.decompressed, {
          binary: !0,
          optimizedBinaryString: !0,
          date: p.date,
          dir: p.dir,
          comment: p.fileCommentStr.length ? p.fileCommentStr : null,
          unixPermissions: p.unixPermissions,
          dosPermissions: p.dosPermissions,
          createFolders: v.createFolders
        }), p.dir || (C.file(l).unsafeOriginalName = t);
      }
      return e.zipComment.length && (C.comment = e.zipComment), C;
    });
  }, Re;
}
var Ie, vr;
function et() {
  if (vr) return Ie;
  vr = 1;
  function o() {
    if (!(this instanceof o))
      return new o();
    if (arguments.length)
      throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
    this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
      var a = new o();
      for (var n in this)
        typeof this[n] != "function" && (a[n] = this[n]);
      return a;
    };
  }
  return o.prototype = Vr(), o.prototype.loadAsync = Qr(), o.support = B(), o.defaults = xr(), o.version = "3.10.1", o.loadAsync = function(a, n) {
    return new o().loadAsync(a, n);
  }, o.external = q(), Ie = o, Ie;
}
var rt = et();
const it = /* @__PURE__ */ Dr(rt);
export {
  it as e
};
