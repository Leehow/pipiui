import { t as _u } from "./spreadsheet-Bchvk7X3.js";
import { e as Eu } from "./index-DK4k06Xx.js";
var rt = 1200, wu = [874, 932, 936, 949, 950, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258, 1e4], k0 = {
  0: 1252,
  /* ANSI */
  1: 65001,
  /* DEFAULT */
  2: 65001,
  /* SYMBOL */
  77: 1e4,
  /* MAC */
  128: 932,
  /* SHIFTJIS */
  129: 949,
  /* HANGUL */
  130: 1361,
  /* JOHAB */
  134: 936,
  /* GB2312 */
  136: 950,
  /* CHINESEBIG5 */
  161: 1253,
  /* GREEK */
  162: 1254,
  /* TURKISH */
  163: 1258,
  /* VIETNAMESE */
  177: 1255,
  /* HEBREW */
  178: 1256,
  /* ARABIC */
  186: 1257,
  /* BALTIC */
  204: 1251,
  /* RUSSIAN */
  222: 874,
  /* THAI */
  238: 1250,
  /* EASTEUROPE */
  255: 1252,
  /* OEM */
  69: 6969
  /* MISC */
}, D0 = function(e) {
  wu.indexOf(e) != -1 && (k0[0] = e);
};
function Au() {
  D0(1252);
}
var ft = function(e) {
  rt = e, D0(e);
};
function As() {
  ft(1200), Au();
}
function J0(e) {
  for (var t = [], r = 0, a = e.length; r < a; ++r) t[r] = e.charCodeAt(r);
  return t;
}
function Ts(e) {
  for (var t = [], r = 0; r < e.length >> 1; ++r) t[r] = String.fromCharCode(e.charCodeAt(2 * r) + (e.charCodeAt(2 * r + 1) << 8));
  return t.join("");
}
function Tu(e) {
  for (var t = [], r = 0; r < e.length >> 1; ++r) t[r] = String.fromCharCode(e[2 * r] + (e[2 * r + 1] << 8));
  return t.join("");
}
function Fs(e) {
  for (var t = [], r = 0; r < e.length >> 1; ++r) t[r] = String.fromCharCode(e.charCodeAt(2 * r + 1) + (e.charCodeAt(2 * r) << 8));
  return t.join("");
}
var Ra = function(e) {
  var t = e.charCodeAt(0), r = e.charCodeAt(1);
  return t == 255 && r == 254 ? Ts(e.slice(2)) : t == 254 && r == 255 ? Fs(e.slice(2)) : t == 65279 ? e.slice(1) : e;
}, hn = function(t) {
  return String.fromCharCode(t);
}, Z0 = function(t) {
  return String.fromCharCode(t);
}, Fu = null, tt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function Q0(e) {
  for (var t = "", r = 0, a = 0, n = 0, i = 0, c = 0, s = 0, u = 0, f = 0; f < e.length; )
    r = e.charCodeAt(f++), i = r >> 2, a = e.charCodeAt(f++), c = (r & 3) << 4 | a >> 4, n = e.charCodeAt(f++), s = (a & 15) << 2 | n >> 6, u = n & 63, isNaN(a) ? s = u = 64 : isNaN(n) && (u = 64), t += tt.charAt(i) + tt.charAt(c) + tt.charAt(s) + tt.charAt(u);
  return t;
}
function C0(e) {
  for (var t = "", r = 0, a = 0, n = 0, i = 0, c = 0, s = 0, u = 0, f = 0; f < e.length; )
    r = e[f++], i = r >> 2, a = e[f++], c = (r & 3) << 4 | a >> 4, n = e[f++], s = (a & 15) << 2 | n >> 6, u = n & 63, isNaN(a) ? s = u = 64 : isNaN(n) && (u = 64), t += tt.charAt(i) + tt.charAt(c) + tt.charAt(s) + tt.charAt(u);
  return t;
}
function qr(e) {
  var t = "", r = 0, a = 0, n = 0, i = 0, c = 0, s = 0, u = 0;
  if (e.slice(0, 5) == "data:") {
    var f = e.slice(0, 1024).indexOf(";base64,");
    f > -1 && (e = e.slice(f + 8));
  }
  e = e.replace(/[^\w\+\/\=]/g, "");
  for (var f = 0; f < e.length; )
    i = tt.indexOf(e.charAt(f++)), c = tt.indexOf(e.charAt(f++)), r = i << 2 | c >> 4, t += String.fromCharCode(r), s = tt.indexOf(e.charAt(f++)), a = (c & 15) << 4 | s >> 2, s !== 64 && (t += String.fromCharCode(a)), u = tt.indexOf(e.charAt(f++)), n = (s & 3) << 6 | u, u !== 64 && (t += String.fromCharCode(n));
  return t;
}
var Xe = /* @__PURE__ */ (function() {
  return typeof Buffer < "u" && typeof process < "u" && typeof process.versions < "u" && !!process.versions.node;
})(), zt = /* @__PURE__ */ (function() {
  if (typeof Buffer < "u") {
    var e = !Buffer.from;
    if (!e) try {
      Buffer.from("foo", "utf8");
    } catch {
      e = !0;
    }
    return e ? function(t, r) {
      return r ? new Buffer(t, r) : new Buffer(t);
    } : Buffer.from.bind(Buffer);
  }
  return function() {
  };
})(), $a = /* @__PURE__ */ (function() {
  if (typeof Buffer > "u") return !1;
  var e = zt([65, 0]);
  if (!e) return !1;
  var t = e.toString("utf16le");
  return t.length == 1;
})();
function Gt(e) {
  return Xe ? Buffer.alloc ? Buffer.alloc(e) : new Buffer(e) : typeof Uint8Array < "u" ? new Uint8Array(e) : new Array(e);
}
function ei(e) {
  return Xe ? Buffer.allocUnsafe ? Buffer.allocUnsafe(e) : new Buffer(e) : typeof Uint8Array < "u" ? new Uint8Array(e) : new Array(e);
}
var Gr = function(t) {
  return Xe ? zt(t, "binary") : t.split("").map(function(r) {
    return r.charCodeAt(0) & 255;
  });
};
function It(e) {
  if (Array.isArray(e)) return e.map(function(a) {
    return String.fromCharCode(a);
  }).join("");
  for (var t = [], r = 0; r < e.length; ++r) t[r] = String.fromCharCode(e[r]);
  return t.join("");
}
function y0(e) {
  if (typeof ArrayBuffer > "u") throw new Error("Unsupported");
  if (e instanceof ArrayBuffer) return y0(new Uint8Array(e));
  for (var t = new Array(e.length), r = 0; r < e.length; ++r) t[r] = e[r];
  return t;
}
var Ut = Xe ? function(e) {
  return Buffer.concat(e.map(function(t) {
    return Buffer.isBuffer(t) ? t : zt(t);
  }));
} : function(e) {
  if (typeof Uint8Array < "u") {
    var t = 0, r = 0;
    for (t = 0; t < e.length; ++t) r += e[t].length;
    var a = new Uint8Array(r), n = 0;
    for (t = 0, r = 0; t < e.length; r += n, ++t)
      n = e[t].length, e[t] instanceof Uint8Array ? a.set(e[t], r) : typeof e[t] == "string" ? a.set(new Uint8Array(Gr(e[t])), r) : a.set(new Uint8Array(e[t]), r);
    return a;
  }
  return [].concat.apply([], e.map(function(i) {
    return Array.isArray(i) ? i : [].slice.call(i);
  }));
};
function ku(e) {
  for (var t = [], r = 0, a = e.length + 250, n = Gt(e.length + 255), i = 0; i < e.length; ++i) {
    var c = e.charCodeAt(i);
    if (c < 128) n[r++] = c;
    else if (c < 2048)
      n[r++] = 192 | c >> 6 & 31, n[r++] = 128 | c & 63;
    else if (c >= 55296 && c < 57344) {
      c = (c & 1023) + 64;
      var s = e.charCodeAt(++i) & 1023;
      n[r++] = 240 | c >> 8 & 7, n[r++] = 128 | c >> 2 & 63, n[r++] = 128 | s >> 6 & 15 | (c & 3) << 4, n[r++] = 128 | s & 63;
    } else
      n[r++] = 224 | c >> 12 & 15, n[r++] = 128 | c >> 6 & 63, n[r++] = 128 | c & 63;
    r > a && (t.push(n.slice(0, r)), r = 0, n = Gt(65535), a = 65530);
  }
  return t.push(n.slice(0, r)), Ut(t);
}
var Pr = /\u0000/g, Ba = /[\u0001-\u0006]/g;
function wa(e) {
  for (var t = "", r = e.length - 1; r >= 0; ) t += e.charAt(r--);
  return t;
}
function ot(e, t) {
  var r = "" + e;
  return r.length >= t ? r : $e("0", t - r.length) + r;
}
function S0(e, t) {
  var r = "" + e;
  return r.length >= t ? r : $e(" ", t - r.length) + r;
}
function yn(e, t) {
  var r = "" + e;
  return r.length >= t ? r : r + $e(" ", t - r.length);
}
function Du(e, t) {
  var r = "" + Math.round(e);
  return r.length >= t ? r : $e("0", t - r.length) + r;
}
function Cu(e, t) {
  var r = "" + e;
  return r.length >= t ? r : $e("0", t - r.length) + r;
}
var ri = /* @__PURE__ */ Math.pow(2, 32);
function ga(e, t) {
  if (e > ri || e < -ri) return Du(e, t);
  var r = Math.round(e);
  return Cu(r, t);
}
function Sn(e, t) {
  return t = t || 0, e.length >= 7 + t && (e.charCodeAt(t) | 32) === 103 && (e.charCodeAt(t + 1) | 32) === 101 && (e.charCodeAt(t + 2) | 32) === 110 && (e.charCodeAt(t + 3) | 32) === 101 && (e.charCodeAt(t + 4) | 32) === 114 && (e.charCodeAt(t + 5) | 32) === 97 && (e.charCodeAt(t + 6) | 32) === 108;
}
var ti = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"]
], Zn = [
  ["J", "Jan", "January"],
  ["F", "Feb", "February"],
  ["M", "Mar", "March"],
  ["A", "Apr", "April"],
  ["M", "May", "May"],
  ["J", "Jun", "June"],
  ["J", "Jul", "July"],
  ["A", "Aug", "August"],
  ["S", "Sep", "September"],
  ["O", "Oct", "October"],
  ["N", "Nov", "November"],
  ["D", "Dec", "December"]
];
function yu(e) {
  return e || (e = {}), e[0] = "General", e[1] = "0", e[2] = "0.00", e[3] = "#,##0", e[4] = "#,##0.00", e[9] = "0%", e[10] = "0.00%", e[11] = "0.00E+00", e[12] = "# ?/?", e[13] = "# ??/??", e[14] = "m/d/yy", e[15] = "d-mmm-yy", e[16] = "d-mmm", e[17] = "mmm-yy", e[18] = "h:mm AM/PM", e[19] = "h:mm:ss AM/PM", e[20] = "h:mm", e[21] = "h:mm:ss", e[22] = "m/d/yy h:mm", e[37] = "#,##0 ;(#,##0)", e[38] = "#,##0 ;[Red](#,##0)", e[39] = "#,##0.00;(#,##0.00)", e[40] = "#,##0.00;[Red](#,##0.00)", e[45] = "mm:ss", e[46] = "[h]:mm:ss", e[47] = "mmss.0", e[48] = "##0.0E+0", e[49] = "@", e[56] = '"上午/下午 "hh"時"mm"分"ss"秒 "', e;
}
var Le = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
  56: '"上午/下午 "hh"時"mm"分"ss"秒 "'
}, ai = {
  5: 37,
  6: 38,
  7: 39,
  8: 40,
  //  5 -> 37 ...  8 -> 40
  23: 0,
  24: 0,
  25: 0,
  26: 0,
  // 23 ->  0 ... 26 ->  0
  27: 14,
  28: 14,
  29: 14,
  30: 14,
  31: 14,
  // 27 -> 14 ... 31 -> 14
  50: 14,
  51: 14,
  52: 14,
  53: 14,
  54: 14,
  // 50 -> 14 ... 58 -> 14
  55: 14,
  56: 14,
  57: 14,
  58: 14,
  59: 1,
  60: 2,
  61: 3,
  62: 4,
  // 59 ->  1 ... 62 ->  4
  67: 9,
  68: 10,
  // 67 ->  9 ... 68 -> 10
  69: 12,
  70: 13,
  71: 14,
  // 69 -> 12 ... 71 -> 14
  72: 14,
  73: 15,
  74: 16,
  75: 17,
  // 72 -> 14 ... 75 -> 17
  76: 20,
  77: 21,
  78: 22,
  // 76 -> 20 ... 78 -> 22
  79: 45,
  80: 46,
  81: 47,
  // 79 -> 45 ... 81 -> 47
  82: 0
  // 82 ->  0 ... 65536 -> 0 (omitted)
}, Su = {
  //  5 -- Currency,   0 decimal, black negative
  5: '"$"#,##0_);\\("$"#,##0\\)',
  63: '"$"#,##0_);\\("$"#,##0\\)',
  //  6 -- Currency,   0 decimal, red   negative
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  64: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  //  7 -- Currency,   2 decimal, black negative
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  65: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  //  8 -- Currency,   2 decimal, red   negative
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  66: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  // 41 -- Accounting, 0 decimal, No Symbol
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  // 42 -- Accounting, 0 decimal, $  Symbol
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  // 43 -- Accounting, 2 decimal, No Symbol
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  // 44 -- Accounting, 2 decimal, $  Symbol
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'
};
function bn(e, t, r) {
  for (var a = e < 0 ? -1 : 1, n = e * a, i = 0, c = 1, s = 0, u = 1, f = 0, o = 0, l = Math.floor(n); f < t && (l = Math.floor(n), s = l * c + i, o = l * f + u, !(n - l < 5e-8)); )
    n = 1 / (n - l), i = c, c = s, u = f, f = o;
  if (o > t && (f > t ? (o = u, s = i) : (o = f, s = c)), !r) return [0, a * s, o];
  var x = Math.floor(a * s / o);
  return [x, a * s - x * o, o];
}
function bu(e) {
  var t = e.toPrecision(16);
  if (t.indexOf("e") > -1) {
    var r = t.slice(0, t.indexOf("e"));
    return r = r.indexOf(".") > -1 ? r.slice(0, r.slice(0, 2) == "0." ? 17 : 16) : r.slice(0, 15) + $e("0", r.length - 15), r + t.slice(t.indexOf("e"));
  }
  var a = t.indexOf(".") > -1 ? t.slice(0, t.slice(0, 2) == "0." ? 17 : 16) : t.slice(0, 15) + $e("0", t.length - 15);
  return Number(a);
}
function wt(e, t, r) {
  if (e > 2958465 || e < 0) return null;
  e = bu(e);
  var a = e | 0, n = Math.floor(86400 * (e - a)), i = 0, c = [], s = { D: a, T: n, u: 86400 * (e - a) - n, y: 0, m: 0, d: 0, H: 0, M: 0, S: 0, q: 0 };
  if (Math.abs(s.u) < 1e-6 && (s.u = 0), t && t.date1904 && (a += 1462), s.u > 0.9999 && (s.u = 0, ++n == 86400 && (s.T = n = 0, ++a, ++s.D)), a === 60)
    c = r ? [1317, 10, 29] : [1900, 2, 29], i = 3;
  else if (a === 0)
    c = r ? [1317, 8, 29] : [1900, 1, 0], i = 6;
  else {
    a > 60 && --a;
    var u = new Date(1900, 0, 1);
    u.setDate(u.getDate() + a - 1), c = [u.getFullYear(), u.getMonth() + 1, u.getDate()], i = u.getDay(), a < 60 && (i = (i + 6) % 7), r && (i = Ru(u, c));
  }
  return s.y = c[0], s.m = c[1], s.d = c[2], s.S = n % 60, n = Math.floor(n / 60), s.M = n % 60, n = Math.floor(n / 60), s.H = n, s.q = i, s;
}
function b0(e) {
  return e.indexOf(".") == -1 ? e : e.replace(/(?:\.0*|(\.\d*[1-9])0+)$/, "$1");
}
function Iu(e) {
  return e.indexOf("E") == -1 ? e : e.replace(/(?:\.0*|(\.\d*[1-9])0+)[Ee]/, "$1E").replace(/(E[+-])(\d)$/, "$10$2");
}
function Nu(e) {
  var t = e < 0 ? 12 : 11, r = b0(e.toFixed(12));
  return r.length <= t || (r = e.toPrecision(10), r.length <= t) ? r : e.toExponential(5);
}
function Ou(e) {
  var t = b0(e.toFixed(11));
  return t.length > (e < 0 ? 12 : 11) || t === "0" || t === "-0" ? e.toPrecision(6) : t;
}
function ja(e) {
  if (!isFinite(e)) return isNaN(e) ? "#NUM!" : "#DIV/0!";
  var t = Math.floor(Math.log(Math.abs(e)) * Math.LOG10E), r;
  return t >= -4 && t <= -1 ? r = e.toPrecision(10 + t) : Math.abs(t) <= 9 ? r = Nu(e) : t === 10 ? r = e.toFixed(10).substr(0, 12) : r = Ou(e), b0(Iu(r.toUpperCase()));
}
function na(e, t) {
  switch (typeof e) {
    case "string":
      return e;
    case "boolean":
      return e ? "TRUE" : "FALSE";
    case "number":
      return (e | 0) === e ? e.toString(10) : ja(e);
    case "undefined":
      return "";
    case "object":
      if (e == null) return "";
      if (e instanceof Date) return $r(14, mr(e, t && t.date1904), t);
  }
  throw new Error("unsupported value in General format: " + e);
}
function Ru(e, t) {
  t[0] -= 581;
  var r = e.getDay();
  return e < 60 && (r = (r + 6) % 7), r;
}
function Bu(e, t, r, a) {
  var n = "", i = 0, c = 0, s = r.y, u, f = 0;
  switch (e) {
    case 98:
      s = r.y + 543;
    /* falls through */
    case 121:
      switch (t.length) {
        case 1:
        case 2:
          u = s % 100, f = 2;
          break;
        default:
          u = s % 1e4, f = 4;
          break;
      }
      break;
    case 109:
      switch (t.length) {
        case 1:
        case 2:
          u = r.m, f = t.length;
          break;
        case 3:
          return Zn[r.m - 1][1];
        case 5:
          return Zn[r.m - 1][0];
        default:
          return Zn[r.m - 1][2];
      }
      break;
    case 100:
      switch (t.length) {
        case 1:
        case 2:
          u = r.d, f = t.length;
          break;
        case 3:
          return ti[r.q][0];
        default:
          return ti[r.q][1];
      }
      break;
    case 104:
      switch (t.length) {
        case 1:
        case 2:
          u = 1 + (r.H + 11) % 12, f = t.length;
          break;
        default:
          throw "bad hour format: " + t;
      }
      break;
    case 72:
      switch (t.length) {
        case 1:
        case 2:
          u = r.H, f = t.length;
          break;
        default:
          throw "bad hour format: " + t;
      }
      break;
    case 77:
      switch (t.length) {
        case 1:
        case 2:
          u = r.M, f = t.length;
          break;
        default:
          throw "bad minute format: " + t;
      }
      break;
    case 115:
      if (t != "s" && t != "ss" && t != ".0" && t != ".00" && t != ".000") throw "bad second format: " + t;
      return r.u === 0 && (t == "s" || t == "ss") ? ot(r.S, t.length) : (a >= 2 ? c = a === 3 ? 1e3 : 100 : c = a === 1 ? 10 : 1, i = Math.round(c * (r.S + r.u)), i >= 60 * c && (i = 0), t === "s" ? i === 0 ? "0" : "" + i / c : (n = ot(i, 2 + a), t === "ss" ? n.substr(0, 2) : "." + n.substr(2, t.length - 1)));
    case 90:
      switch (t) {
        case "[h]":
        case "[hh]":
          u = r.D * 24 + r.H;
          break;
        case "[m]":
        case "[mm]":
          u = (r.D * 24 + r.H) * 60 + r.M;
          break;
        case "[s]":
        case "[ss]":
          u = ((r.D * 24 + r.H) * 60 + r.M) * 60 + (a == 0 ? Math.round(r.S + r.u) : r.S);
          break;
        default:
          throw "bad abstime format: " + t;
      }
      f = t.length === 3 ? 1 : 2;
      break;
    case 101:
      u = s, f = 1;
      break;
  }
  var o = f > 0 ? ot(u, f) : "";
  return o;
}
function At(e) {
  var t = 3;
  if (e.length <= t) return e;
  for (var r = e.length % t, a = e.substr(0, r); r != e.length; r += t) a += (a.length > 0 ? "," : "") + e.substr(r, t);
  return a;
}
var ks = /%/g;
function Lu(e, t, r) {
  var a = t.replace(ks, ""), n = t.length - a.length;
  return Dt(e, a, r * Math.pow(10, 2 * n)) + $e("%", n);
}
function Mu(e, t, r) {
  for (var a = t.length - 1; t.charCodeAt(a - 1) === 44; ) --a;
  return Dt(e, t.substr(0, a), r / Math.pow(10, 3 * (t.length - a)));
}
function Ds(e, t) {
  var r, a = e.indexOf("E") - e.indexOf(".") - 1;
  if (e.match(/^#+0.0E\+0$/)) {
    if (t == 0) return "0.0E+0";
    if (t < 0) return "-" + Ds(e, -t);
    var n = e.indexOf(".");
    n === -1 && (n = e.indexOf("E"));
    var i = Math.floor(Math.log(t) * Math.LOG10E) % n;
    if (i < 0 && (i += n), r = (t / Math.pow(10, i)).toPrecision(a + 1 + (n + i) % n), r.indexOf("e") === -1) {
      var c = Math.floor(Math.log(t) * Math.LOG10E);
      for (r.indexOf(".") === -1 ? r = r.charAt(0) + "." + r.substr(1) + "E+" + (c - r.length + i) : r += "E+" + (c - i); r.substr(0, 2) === "0."; )
        r = r.charAt(0) + r.substr(2, n) + "." + r.substr(2 + n), r = r.replace(/^0+([1-9])/, "$1").replace(/^0+\./, "0.");
      r = r.replace(/\+-/, "-");
    }
    r = r.replace(/^([+-]?)(\d*)\.(\d*)[Ee]/, function(s, u, f, o) {
      return u + f + o.substr(0, (n + i) % n) + "." + o.substr(i) + "E";
    });
  } else r = t.toExponential(a);
  return e.match(/E\+00$/) && r.match(/e[+-]\d$/) && (r = r.substr(0, r.length - 1) + "0" + r.charAt(r.length - 1)), e.match(/E\-/) && r.match(/e\+/) && (r = r.replace(/e\+/, "e")), r.replace("e", "E");
}
var Cs = /# (\?+)( ?)\/( ?)(\d+)/;
function Pu(e, t, r) {
  var a = parseInt(e[4], 10), n = Math.round(t * a), i = Math.floor(n / a), c = n - i * a, s = a;
  return r + (i === 0 ? "" : "" + i) + " " + (c === 0 ? $e(" ", e[1].length + 1 + e[4].length) : S0(c, e[1].length) + e[2] + "/" + e[3] + ot(s, e[4].length));
}
function Uu(e, t, r) {
  return r + (t === 0 ? "" : "" + t) + $e(" ", e[1].length + 2 + e[4].length);
}
var ys = /^#*0*\.([0#]+)/, Ss = /\)[^)]*[0#]/, bs = /\(###\) ###\\?-####/;
function Rr(e) {
  for (var t = "", r, a = 0; a != e.length; ++a) switch (r = e.charCodeAt(a)) {
    case 35:
      break;
    case 63:
      t += " ";
      break;
    case 48:
      t += "0";
      break;
    default:
      t += String.fromCharCode(r);
  }
  return t;
}
function ni(e, t) {
  var r = e < 0 ? -1 : 1, a = Math.pow(10, t);
  return "" + r * (Math.round(r * e * a) / a);
}
function ii(e, t) {
  var r = e - Math.floor(e), a = Math.pow(10, t);
  return t < ("" + Math.round(r * a)).length ? 0 : Math.round(r * a);
}
function Hu(e, t) {
  return t < ("" + Math.round((e - Math.floor(e)) * Math.pow(10, t))).length ? 1 : 0;
}
function Vu(e) {
  return e < 2147483647 && e > -2147483648 ? "" + (e >= 0 ? e | 0 : e - 1 | 0) : "" + Math.floor(e);
}
function Qr(e, t, r) {
  if (e.charCodeAt(0) === 40 && !t.match(Ss)) {
    var a = t.replace(/\( */, "").replace(/ \)/, "").replace(/\)/, "");
    return r >= 0 ? Qr("n", a, r) : "(" + Qr("n", a, -r) + ")";
  }
  if (t.charCodeAt(t.length - 1) === 44) return Mu(e, t, r);
  if (t.indexOf("%") !== -1) return Lu(e, t, r);
  if (t.indexOf("E") !== -1) return Ds(t, r);
  if (t.charCodeAt(0) === 36) return "$" + Qr(e, t.substr(t.charAt(1) == " " ? 2 : 1), r);
  var n, i, c, s, u = Math.abs(r), f = r < 0 ? "-" : "";
  if (t.match(/^00+$/)) return f + ga(u, t.length);
  if (t.match(/^[#?]+$/))
    return n = ga(r, 0), n === "0" && (n = ""), n.length > t.length ? n : Rr(t.substr(0, t.length - n.length)) + n;
  if (i = t.match(Cs)) return Pu(i, u, f);
  if (t.match(/^#+0+$/)) return f + ga(u, t.length - t.indexOf("0"));
  if (i = t.match(ys))
    return n = ni(r, i[1].length).replace(/^([^\.]+)$/, "$1." + Rr(i[1])).replace(/\.$/, "." + Rr(i[1])).replace(/\.(\d*)$/, function(g, _) {
      return "." + _ + $e("0", Rr(
        /*::(*/
        i[1]
      ).length - _.length);
    }), t.indexOf("0.") !== -1 ? n : n.replace(/^0\./, ".");
  if (t = t.replace(/^#+([0.])/, "$1"), i = t.match(/^(0*)\.(#*)$/))
    return f + ni(u, i[2].length).replace(/\.(\d*[1-9])0*$/, ".$1").replace(/^(-?\d*)$/, "$1.").replace(/^0\./, i[1].length ? "0." : ".");
  if (i = t.match(/^#{1,3},##0(\.?)$/)) return f + At(ga(u, 0));
  if (i = t.match(/^#,##0\.([#0]*0)$/))
    return r < 0 ? "-" + Qr(e, t, -r) : At("" + (Math.floor(r) + Hu(r, i[1].length))) + "." + ot(ii(r, i[1].length), i[1].length);
  if (i = t.match(/^#,#*,#0/)) return Qr(e, t.replace(/^#,#*,/, ""), r);
  if (i = t.match(/^([0#]+)(\\?-([0#]+))+$/))
    return n = wa(Qr(e, t.replace(/[\\-]/g, ""), r)), c = 0, wa(wa(t.replace(/\\/g, "")).replace(/[0#]/g, function(g) {
      return c < n.length ? n.charAt(c++) : g === "0" ? "0" : "";
    }));
  if (t.match(bs))
    return n = Qr(e, "##########", r), "(" + n.substr(0, 3) + ") " + n.substr(3, 3) + "-" + n.substr(6);
  var o = "";
  if (i = t.match(/^([#0?]+)( ?)\/( ?)([#0?]+)/))
    return c = Math.min(
      /*::String(*/
      i[4].length,
      7
    ), s = bn(u, Math.pow(10, c) - 1, !1), n = "" + f, o = Dt(
      "n",
      /*::String(*/
      i[1],
      s[1]
    ), o.charAt(o.length - 1) == " " && (o = o.substr(0, o.length - 1) + "0"), n += o + /*::String(*/
    i[2] + "/" + /*::String(*/
    i[3], o = yn(s[2], c), o.length < i[4].length && (o = Rr(i[4].substr(i[4].length - o.length)) + o), n += o, n;
  if (i = t.match(/^# ([#0?]+)( ?)\/( ?)([#0?]+)/))
    return c = Math.min(Math.max(i[1].length, i[4].length), 7), s = bn(u, Math.pow(10, c) - 1, !0), f + (s[0] || (s[1] ? "" : "0")) + " " + (s[1] ? S0(s[1], c) + i[2] + "/" + i[3] + yn(s[2], c) : $e(" ", 2 * c + 1 + i[2].length + i[3].length));
  if (i = t.match(/^[#0?]+$/))
    return n = ga(r, 0), t.length <= n.length ? n : Rr(t.substr(0, t.length - n.length)) + n;
  if (i = t.match(/^([#0?]+)\.([#0]+)$/)) {
    n = "" + r.toFixed(Math.min(i[2].length, 10)).replace(/([^0])0+$/, "$1"), c = n.indexOf(".");
    var l = t.indexOf(".") - c, x = t.length - n.length - l;
    return Rr(t.substr(0, l) + n + t.substr(t.length - x));
  }
  if (i = t.match(/^00,000\.([#0]*0)$/))
    return c = ii(r, i[1].length), r < 0 ? "-" + Qr(e, t, -r) : At(Vu(r)).replace(/^\d,\d{3}$/, "0$&").replace(/^\d*$/, function(g) {
      return "00," + (g.length < 3 ? ot(0, 3 - g.length) : "") + g;
    }) + "." + ot(c, i[1].length);
  switch (t) {
    case "###,##0.00":
      return Qr(e, "#,##0.00", r);
    case "###,###":
    case "##,###":
    case "#,###":
      var h = At(ga(u, 0));
      return h !== "0" ? f + h : "";
    case "###,###.00":
      return Qr(e, "###,##0.00", r).replace(/^0\./, ".");
    case "#,###.00":
      return Qr(e, "#,##0.00", r).replace(/^0\./, ".");
  }
  throw new Error("unsupported format |" + t + "|");
}
function Wu(e, t, r) {
  for (var a = t.length - 1; t.charCodeAt(a - 1) === 44; ) --a;
  return Dt(e, t.substr(0, a), r / Math.pow(10, 3 * (t.length - a)));
}
function Gu(e, t, r) {
  var a = t.replace(ks, ""), n = t.length - a.length;
  return Dt(e, a, r * Math.pow(10, 2 * n)) + $e("%", n);
}
function Is(e, t) {
  var r, a = e.indexOf("E") - e.indexOf(".") - 1;
  if (e.match(/^#+0.0E\+0$/)) {
    if (t == 0) return "0.0E+0";
    if (t < 0) return "-" + Is(e, -t);
    var n = e.indexOf(".");
    n === -1 && (n = e.indexOf("E"));
    var i = Math.floor(Math.log(t) * Math.LOG10E) % n;
    if (i < 0 && (i += n), r = (t / Math.pow(10, i)).toPrecision(a + 1 + (n + i) % n), !r.match(/[Ee]/)) {
      var c = Math.floor(Math.log(t) * Math.LOG10E);
      r.indexOf(".") === -1 ? r = r.charAt(0) + "." + r.substr(1) + "E+" + (c - r.length + i) : r += "E+" + (c - i), r = r.replace(/\+-/, "-");
    }
    r = r.replace(/^([+-]?)(\d*)\.(\d*)[Ee]/, function(s, u, f, o) {
      return u + f + o.substr(0, (n + i) % n) + "." + o.substr(i) + "E";
    });
  } else r = t.toExponential(a);
  return e.match(/E\+00$/) && r.match(/e[+-]\d$/) && (r = r.substr(0, r.length - 1) + "0" + r.charAt(r.length - 1)), e.match(/E\-/) && r.match(/e\+/) && (r = r.replace(/e\+/, "e")), r.replace("e", "E");
}
function gt(e, t, r) {
  if (e.charCodeAt(0) === 40 && !t.match(Ss)) {
    var a = t.replace(/\( */, "").replace(/ \)/, "").replace(/\)/, "");
    return r >= 0 ? gt("n", a, r) : "(" + gt("n", a, -r) + ")";
  }
  if (t.charCodeAt(t.length - 1) === 44) return Wu(e, t, r);
  if (t.indexOf("%") !== -1) return Gu(e, t, r);
  if (t.indexOf("E") !== -1) return Is(t, r);
  if (t.charCodeAt(0) === 36) return "$" + gt(e, t.substr(t.charAt(1) == " " ? 2 : 1), r);
  var n, i, c, s, u = Math.abs(r), f = r < 0 ? "-" : "";
  if (t.match(/^00+$/)) return f + ot(u, t.length);
  if (t.match(/^[#?]+$/))
    return n = "" + r, r === 0 && (n = ""), n.length > t.length ? n : Rr(t.substr(0, t.length - n.length)) + n;
  if (i = t.match(Cs)) return Uu(i, u, f);
  if (t.match(/^#+0+$/)) return f + ot(u, t.length - t.indexOf("0"));
  if (i = t.match(ys))
    return n = ("" + r).replace(/^([^\.]+)$/, "$1." + Rr(i[1])).replace(/\.$/, "." + Rr(i[1])), n = n.replace(/\.(\d*)$/, function(g, _) {
      return "." + _ + $e("0", Rr(i[1]).length - _.length);
    }), t.indexOf("0.") !== -1 ? n : n.replace(/^0\./, ".");
  if (t = t.replace(/^#+([0.])/, "$1"), i = t.match(/^(0*)\.(#*)$/))
    return f + ("" + u).replace(/\.(\d*[1-9])0*$/, ".$1").replace(/^(-?\d*)$/, "$1.").replace(/^0\./, i[1].length ? "0." : ".");
  if (i = t.match(/^#{1,3},##0(\.?)$/)) return f + At("" + u);
  if (i = t.match(/^#,##0\.([#0]*0)$/))
    return r < 0 ? "-" + gt(e, t, -r) : At("" + r) + "." + $e("0", i[1].length);
  if (i = t.match(/^#,#*,#0/)) return gt(e, t.replace(/^#,#*,/, ""), r);
  if (i = t.match(/^([0#]+)(\\?-([0#]+))+$/))
    return n = wa(gt(e, t.replace(/[\\-]/g, ""), r)), c = 0, wa(wa(t.replace(/\\/g, "")).replace(/[0#]/g, function(g) {
      return c < n.length ? n.charAt(c++) : g === "0" ? "0" : "";
    }));
  if (t.match(bs))
    return n = gt(e, "##########", r), "(" + n.substr(0, 3) + ") " + n.substr(3, 3) + "-" + n.substr(6);
  var o = "";
  if (i = t.match(/^([#0?]+)( ?)\/( ?)([#0?]+)/))
    return c = Math.min(
      /*::String(*/
      i[4].length,
      7
    ), s = bn(u, Math.pow(10, c) - 1, !1), n = "" + f, o = Dt(
      "n",
      /*::String(*/
      i[1],
      s[1]
    ), o.charAt(o.length - 1) == " " && (o = o.substr(0, o.length - 1) + "0"), n += o + /*::String(*/
    i[2] + "/" + /*::String(*/
    i[3], o = yn(s[2], c), o.length < i[4].length && (o = Rr(i[4].substr(i[4].length - o.length)) + o), n += o, n;
  if (i = t.match(/^# ([#0?]+)( ?)\/( ?)([#0?]+)/))
    return c = Math.min(Math.max(i[1].length, i[4].length), 7), s = bn(u, Math.pow(10, c) - 1, !0), f + (s[0] || (s[1] ? "" : "0")) + " " + (s[1] ? S0(s[1], c) + i[2] + "/" + i[3] + yn(s[2], c) : $e(" ", 2 * c + 1 + i[2].length + i[3].length));
  if (i = t.match(/^[#0?]+$/))
    return n = "" + r, t.length <= n.length ? n : Rr(t.substr(0, t.length - n.length)) + n;
  if (i = t.match(/^([#0]+)\.([#0]+)$/)) {
    n = "" + r.toFixed(Math.min(i[2].length, 10)).replace(/([^0])0+$/, "$1"), c = n.indexOf(".");
    var l = t.indexOf(".") - c, x = t.length - n.length - l;
    return Rr(t.substr(0, l) + n + t.substr(t.length - x));
  }
  if (i = t.match(/^00,000\.([#0]*0)$/))
    return r < 0 ? "-" + gt(e, t, -r) : At("" + r).replace(/^\d,\d{3}$/, "0$&").replace(/^\d*$/, function(g) {
      return "00," + (g.length < 3 ? ot(0, 3 - g.length) : "") + g;
    }) + "." + ot(0, i[1].length);
  switch (t) {
    case "###,###":
    case "##,###":
    case "#,###":
      var h = At("" + u);
      return h !== "0" ? f + h : "";
    default:
      if (t.match(/\.[0#?]*$/)) return gt(e, t.slice(0, t.lastIndexOf(".")), r) + Rr(t.slice(t.lastIndexOf(".")));
  }
  throw new Error("unsupported format |" + t + "|");
}
function Dt(e, t, r) {
  return (r | 0) === r ? gt(e, t, r) : Qr(e, t, r);
}
function Xu(e) {
  for (var t = [], r = !1, a = 0, n = 0; a < e.length; ++a) switch (
    /*cc=*/
    e.charCodeAt(a)
  ) {
    case 34:
      r = !r;
      break;
    case 95:
    case 42:
    case 92:
      ++a;
      break;
    case 59:
      t[t.length] = e.substr(n, a - n), n = a + 1;
  }
  if (t[t.length] = e.substr(n), r === !0) throw new Error("Format |" + e + "| unterminated string ");
  return t;
}
var Ns = /\[[HhMmSs\u0E0A\u0E19\u0E17]*\]/;
function lt(e) {
  for (var t = 0, r = "", a = ""; t < e.length; )
    switch (r = e.charAt(t)) {
      case "G":
        Sn(e, t) && (t += 6), t++;
        break;
      case '"':
        for (
          ;
          /*cc=*/
          e.charCodeAt(++t) !== 34 && t < e.length;
        )
          ;
        ++t;
        break;
      case "\\":
        t += 2;
        break;
      case "_":
        t += 2;
        break;
      case "@":
        ++t;
        break;
      case "B":
      case "b":
        if (e.charAt(t + 1) === "1" || e.charAt(t + 1) === "2") return !0;
      /* falls through */
      case "M":
      case "D":
      case "Y":
      case "H":
      case "S":
      case "E":
      /* falls through */
      case "m":
      case "d":
      case "y":
      case "h":
      case "s":
      case "e":
      case "g":
        return !0;
      case "A":
      case "a":
      case "上":
        if (e.substr(t, 3).toUpperCase() === "A/P" || e.substr(t, 5).toUpperCase() === "AM/PM" || e.substr(t, 5).toUpperCase() === "上午/下午") return !0;
        ++t;
        break;
      case "[":
        for (a = r; e.charAt(t++) !== "]" && t < e.length; ) a += e.charAt(t);
        if (a.match(Ns)) return !0;
        break;
      case ".":
      /* falls through */
      case "0":
      case "#":
        for (; t < e.length && ("0#?.,E+-%".indexOf(r = e.charAt(++t)) > -1 || r == "\\" && e.charAt(t + 1) == "-" && "0#".indexOf(e.charAt(t + 2)) > -1); )
          ;
        break;
      case "?":
        for (; e.charAt(++t) === r; )
          ;
        break;
      case "*":
        ++t, (e.charAt(t) == " " || e.charAt(t) == "*") && ++t;
        break;
      case "(":
      case ")":
        ++t;
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        for (; t < e.length && "0123456789".indexOf(e.charAt(++t)) > -1; )
          ;
        break;
      case " ":
        ++t;
        break;
      default:
        ++t;
        break;
    }
  return !1;
}
function zu(e, t, r, a) {
  for (var n = [], i = "", c = 0, s = "", u = "t", f, o, l, x = "H"; c < e.length; )
    switch (s = e.charAt(c)) {
      case "G":
        if (!Sn(e, c)) throw new Error("unrecognized character " + s + " in " + e);
        n[n.length] = { t: "G", v: "General" }, c += 7;
        break;
      case '"':
        for (i = ""; (l = e.charCodeAt(++c)) !== 34 && c < e.length; ) i += String.fromCharCode(l);
        n[n.length] = { t: "t", v: i }, ++c;
        break;
      case "\\":
        var h = e.charAt(++c), g = h === "(" || h === ")" ? h : "t";
        n[n.length] = { t: g, v: h }, ++c;
        break;
      case "_":
        n[n.length] = { t: "t", v: " " }, c += 2;
        break;
      case "@":
        n[n.length] = { t: "T", v: t }, ++c;
        break;
      case "B":
      case "b":
        if (e.charAt(c + 1) === "1" || e.charAt(c + 1) === "2") {
          if (f == null && (f = wt(t, r, e.charAt(c + 1) === "2"), f == null))
            return "";
          n[n.length] = { t: "X", v: e.substr(c, 2) }, u = s, c += 2;
          break;
        }
      /* falls through */
      case "M":
      case "D":
      case "Y":
      case "H":
      case "S":
      case "E":
        s = s.toLowerCase();
      /* falls through */
      case "m":
      case "d":
      case "y":
      case "h":
      case "s":
      case "e":
      case "g":
        if (t < 0 || f == null && (f = wt(t, r), f == null))
          return "";
        for (i = s; ++c < e.length && e.charAt(c).toLowerCase() === s; ) i += s;
        s === "m" && u.toLowerCase() === "h" && (s = "M"), s === "h" && (s = x), n[n.length] = { t: s, v: i }, u = s;
        break;
      case "A":
      case "a":
      case "上":
        var _ = { t: s, v: s };
        if (f == null && (f = wt(t, r)), e.substr(c, 3).toUpperCase() === "A/P" ? (f != null && (_.v = f.H >= 12 ? e.charAt(c + 2) : s), _.t = "T", x = "h", c += 3) : e.substr(c, 5).toUpperCase() === "AM/PM" ? (f != null && (_.v = f.H >= 12 ? "PM" : "AM"), _.t = "T", c += 5, x = "h") : e.substr(c, 5).toUpperCase() === "上午/下午" ? (f != null && (_.v = f.H >= 12 ? "下午" : "上午"), _.t = "T", c += 5, x = "h") : (_.t = "t", ++c), f == null && _.t === "T") return "";
        n[n.length] = _, u = s;
        break;
      case "[":
        for (i = s; e.charAt(c++) !== "]" && c < e.length; ) i += e.charAt(c);
        if (i.slice(-1) !== "]") throw 'unterminated "[" block: |' + i + "|";
        if (i.match(Ns)) {
          if (f == null && (f = wt(t, r), f == null))
            return "";
          n[n.length] = { t: "Z", v: i.toLowerCase() }, u = i.charAt(1);
        } else i.indexOf("$") > -1 && (i = (i.match(/\$([^-\[\]]*)/) || [])[1] || "$", lt(e) || (n[n.length] = { t: "t", v: i }));
        break;
      /* Numbers */
      case ".":
        if (f != null) {
          for (i = s; ++c < e.length && (s = e.charAt(c)) === "0"; ) i += s;
          n[n.length] = { t: "s", v: i };
          break;
        }
      /* falls through */
      case "0":
      case "#":
        for (i = s; ++c < e.length && "0#?.,E+-%".indexOf(s = e.charAt(c)) > -1; ) i += s;
        n[n.length] = { t: "n", v: i };
        break;
      case "?":
        for (i = s; e.charAt(++c) === s; ) i += s;
        n[n.length] = { t: s, v: i }, u = s;
        break;
      case "*":
        ++c, (e.charAt(c) == " " || e.charAt(c) == "*") && ++c;
        break;
      // **
      case "(":
      case ")":
        n[n.length] = { t: a === 1 ? "t" : s, v: s }, ++c;
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        for (i = s; c < e.length && "0123456789".indexOf(e.charAt(++c)) > -1; ) i += e.charAt(c);
        n[n.length] = { t: "D", v: i };
        break;
      case " ":
        n[n.length] = { t: s, v: s }, ++c;
        break;
      case "$":
        n[n.length] = { t: "t", v: "$" }, ++c;
        break;
      default:
        if (",$-+/():!^&'~{}<>=€acfijklopqrtuvwxzP".indexOf(s) === -1) throw new Error("unrecognized character " + s + " in " + e);
        n[n.length] = { t: "t", v: s }, ++c;
        break;
    }
  var d = 0, p = 0, w;
  for (c = n.length - 1, u = "t"; c >= 0; --c)
    switch (n[c].t) {
      case "h":
      case "H":
        n[c].t = x, u = "h", d < 1 && (d = 1);
        break;
      case "s":
        (w = n[c].v.match(/\.0+$/)) && (p = Math.max(p, w[0].length - 1), d = 4), d < 3 && (d = 3);
      /* falls through */
      case "d":
      case "y":
      case "e":
        u = n[c].t;
        break;
      case "M":
        u = n[c].t, d < 2 && (d = 2);
        break;
      case "m":
        u === "s" && (n[c].t = "M", d < 2 && (d = 2));
        break;
      case "X":
        break;
      case "Z":
        d < 1 && n[c].v.match(/[Hh]/) && (d = 1), d < 2 && n[c].v.match(/[Mm]/) && (d = 2), d < 3 && n[c].v.match(/[Ss]/) && (d = 3);
    }
  var m;
  switch (d) {
    case 0:
      break;
    case 1:
    case 2:
    case 3:
      f.u >= 0.5 && (f.u = 0, ++f.S), f.S >= 60 && (f.S = 0, ++f.M), f.M >= 60 && (f.M = 0, ++f.H), f.H >= 24 && (f.H = 0, ++f.D, m = wt(f.D), m.u = f.u, m.S = f.S, m.M = f.M, m.H = f.H, f = m);
      break;
    case 4:
      switch (p) {
        case 1:
          f.u = Math.round(f.u * 10) / 10;
          break;
        case 2:
          f.u = Math.round(f.u * 100) / 100;
          break;
        case 3:
          f.u = Math.round(f.u * 1e3) / 1e3;
          break;
      }
      f.u >= 1 && (f.u = 0, ++f.S), f.S >= 60 && (f.S = 0, ++f.M), f.M >= 60 && (f.M = 0, ++f.H), f.H >= 24 && (f.H = 0, ++f.D, m = wt(f.D), m.u = f.u, m.S = f.S, m.M = f.M, m.H = f.H, f = m);
      break;
  }
  var y = "", M;
  for (c = 0; c < n.length; ++c)
    switch (n[c].t) {
      case "t":
      case "T":
      case " ":
      case "D":
        break;
      case "X":
        n[c].v = "", n[c].t = ";";
        break;
      case "d":
      case "m":
      case "y":
      case "h":
      case "H":
      case "M":
      case "s":
      case "e":
      case "b":
      case "Z":
        n[c].v = Bu(n[c].t.charCodeAt(0), n[c].v, f, p), n[c].t = "t";
        break;
      case "n":
      case "?":
        for (M = c + 1; n[M] != null && ((s = n[M].t) === "?" || s === "D" || (s === " " || s === "t") && n[M + 1] != null && (n[M + 1].t === "?" || n[M + 1].t === "t" && n[M + 1].v === "/") || n[c].t === "(" && (s === " " || s === "n" || s === ")") || s === "t" && (n[M].v === "/" || n[M].v === " " && n[M + 1] != null && n[M + 1].t == "?")); )
          n[c].v += n[M].v, n[M] = { v: "", t: ";" }, ++M;
        y += n[c].v, c = M - 1;
        break;
      case "G":
        n[c].t = "t", n[c].v = na(t, r);
        break;
    }
  var W = "", I, L;
  if (y.length > 0) {
    y.charCodeAt(0) == 40 ? (I = t < 0 && y.charCodeAt(0) === 45 ? -t : t, L = Dt("n", y, I)) : (I = t < 0 && a > 1 ? -t : t, L = Dt("n", y, I), I < 0 && n[0] && n[0].t == "t" && (L = L.substr(1), n[0].v = "-" + n[0].v)), M = L.length - 1;
    var A = n.length;
    for (c = 0; c < n.length; ++c) if (n[c] != null && n[c].t != "t" && n[c].v.indexOf(".") > -1) {
      A = c;
      break;
    }
    var N = n.length;
    if (A === n.length && L.indexOf("E") === -1) {
      for (c = n.length - 1; c >= 0; --c)
        n[c] == null || "n?".indexOf(n[c].t) === -1 || (M >= n[c].v.length - 1 ? (M -= n[c].v.length, n[c].v = L.substr(M + 1, n[c].v.length)) : M < 0 ? n[c].v = "" : (n[c].v = L.substr(0, M + 1), M = -1), n[c].t = "t", N = c);
      M >= 0 && N < n.length && (n[N].v = L.substr(0, M + 1) + n[N].v);
    } else if (A !== n.length && L.indexOf("E") === -1) {
      for (M = L.indexOf(".") - 1, c = A; c >= 0; --c)
        if (!(n[c] == null || "n?".indexOf(n[c].t) === -1)) {
          for (o = n[c].v.indexOf(".") > -1 && c === A ? n[c].v.indexOf(".") - 1 : n[c].v.length - 1, W = n[c].v.substr(o + 1); o >= 0; --o)
            M >= 0 && (n[c].v.charAt(o) === "0" || n[c].v.charAt(o) === "#") && (W = L.charAt(M--) + W);
          n[c].v = W, n[c].t = "t", N = c;
        }
      for (M >= 0 && N < n.length && (n[N].v = L.substr(0, M + 1) + n[N].v), M = L.indexOf(".") + 1, c = A; c < n.length; ++c)
        if (!(n[c] == null || "n?(".indexOf(n[c].t) === -1 && c !== A)) {
          for (o = n[c].v.indexOf(".") > -1 && c === A ? n[c].v.indexOf(".") + 1 : 0, W = n[c].v.substr(0, o); o < n[c].v.length; ++o)
            M < L.length && (W += L.charAt(M++));
          n[c].v = W, n[c].t = "t", N = c;
        }
    }
  }
  for (c = 0; c < n.length; ++c) n[c] != null && "n?".indexOf(n[c].t) > -1 && (I = a > 1 && t < 0 && c > 0 && n[c - 1].v === "-" ? -t : t, n[c].v = Dt(n[c].t, n[c].v, I), n[c].t = "t");
  var R = "";
  for (c = 0; c !== n.length; ++c) n[c] != null && (R += n[c].v);
  return R;
}
var si = /\[(=|>[=]?|<[>=]?)(-?\d+(?:\.\d*)?)\]/;
function ci(e, t) {
  if (t == null) return !1;
  var r = parseFloat(t[2]);
  switch (t[1]) {
    case "=":
      if (e == r) return !0;
      break;
    case ">":
      if (e > r) return !0;
      break;
    case "<":
      if (e < r) return !0;
      break;
    case "<>":
      if (e != r) return !0;
      break;
    case ">=":
      if (e >= r) return !0;
      break;
    case "<=":
      if (e <= r) return !0;
      break;
  }
  return !1;
}
function qu(e, t) {
  var r = Xu(e), a = r.length, n = r[a - 1].indexOf("@");
  if (a < 4 && n > -1 && --a, r.length > 4) throw new Error("cannot find right format for |" + r.join("|") + "|");
  if (typeof t != "number") return [4, r.length === 4 || n > -1 ? r[r.length - 1] : "@"];
  switch (typeof t == "number" && !isFinite(t) && (t = 0), r.length) {
    case 1:
      r = n > -1 ? ["General", "General", "General", r[0]] : [r[0], r[0], r[0], "@"];
      break;
    case 2:
      r = n > -1 ? [r[0], r[0], r[0], r[1]] : [r[0], r[1], r[0], "@"];
      break;
    case 3:
      r = n > -1 ? [r[0], r[1], r[0], r[2]] : [r[0], r[1], r[2], "@"];
      break;
  }
  var i = t > 0 ? r[0] : t < 0 ? r[1] : r[2];
  if (r[0].indexOf("[") === -1 && r[1].indexOf("[") === -1) return [a, i];
  if (r[0].match(/\[[=<>]/) != null || r[1].match(/\[[=<>]/) != null) {
    var c = r[0].match(si), s = r[1].match(si);
    return ci(t, c) ? [a, r[0]] : ci(t, s) ? [a, r[1]] : [a, r[c != null && s != null ? 2 : 1]];
  }
  return [a, i];
}
function $r(e, t, r) {
  r == null && (r = {});
  var a = "";
  switch (typeof e) {
    case "string":
      e == "m/d/yy" && r.dateNF ? a = r.dateNF : a = e;
      break;
    case "number":
      e == 14 && r.dateNF ? a = r.dateNF : a = (r.table != null ? r.table : Le)[e], a == null && (a = r.table && r.table[ai[e]] || Le[ai[e]]), a == null && (a = Su[e] || "General");
      break;
  }
  if (Sn(a, 0)) return na(t, r);
  t instanceof Date && (t = mr(t, r.date1904));
  var n = qu(a, t);
  if (Sn(n[1])) return na(t, r);
  if (t === !0) t = "TRUE";
  else if (t === !1) t = "FALSE";
  else {
    if (t === "" || t == null) return "";
    if (isNaN(t) && n[1].indexOf("0") > -1) return "#NUM!";
    if (!isFinite(t) && n[1].indexOf("0") > -1) return "#DIV/0!";
  }
  return zu(n[1], t, r, n[0]);
}
function $u(e, t) {
  if (typeof t != "number") {
    t = +t || -1;
    for (var r = 0; r < 392; ++r) {
      if (Le[r] == null) {
        t < 0 && (t = r);
        continue;
      }
      if (Le[r] == e) {
        t = r;
        break;
      }
    }
    t < 0 && (t = 391);
  }
  return Le[t] = e, t;
}
function Os() {
  Le = yu();
}
var ju = {
  5: '"$"#,##0_);\\("$"#,##0\\)',
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  23: "General",
  24: "General",
  25: "General",
  26: "General",
  27: "m/d/yy",
  28: "m/d/yy",
  29: "m/d/yy",
  30: "m/d/yy",
  31: "m/d/yy",
  32: "h:mm:ss",
  33: "h:mm:ss",
  34: "h:mm:ss",
  35: "h:mm:ss",
  36: "m/d/yy",
  41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
  50: "m/d/yy",
  51: "m/d/yy",
  52: "m/d/yy",
  53: "m/d/yy",
  54: "m/d/yy",
  55: "m/d/yy",
  56: "m/d/yy",
  57: "m/d/yy",
  58: "m/d/yy",
  59: "0",
  60: "0.00",
  61: "#,##0",
  62: "#,##0.00",
  63: '"$"#,##0_);\\("$"#,##0\\)',
  64: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  65: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  66: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  67: "0%",
  68: "0.00%",
  69: "# ?/?",
  70: "# ??/??",
  71: "m/d/yy",
  72: "m/d/yy",
  73: "d-mmm-yy",
  74: "d-mmm",
  75: "mmm-yy",
  76: "h:mm",
  77: "h:mm:ss",
  78: "m/d/yy h:mm",
  79: "mm:ss",
  80: "[h]:mm:ss",
  81: "mmss.0"
}, In = /[dD]+|[mM]+|[yYeE]+|[Hh]+|[Ss]+/g;
function Ku(e) {
  var t = typeof e == "number" ? Le[e] : e;
  return t = t.replace(In, "(\\d+)"), In.lastIndex = 0, new RegExp("^" + t + "$");
}
function Yu(e, t, r) {
  var a = -1, n = -1, i = -1, c = -1, s = -1, u = -1;
  (t.match(In) || []).forEach(function(l, x) {
    var h = parseInt(r[x + 1], 10);
    switch (l.toLowerCase().charAt(0)) {
      case "y":
        a = h;
        break;
      case "d":
        i = h;
        break;
      case "h":
        c = h;
        break;
      case "s":
        u = h;
        break;
      case "m":
        c >= 0 ? s = h : n = h;
        break;
    }
  }), In.lastIndex = 0, u >= 0 && s == -1 && n >= 0 && (s = n, n = -1);
  var f = ("" + (a >= 0 ? a : (/* @__PURE__ */ new Date()).getFullYear())).slice(-4) + "-" + ("00" + (n >= 1 ? n : 1)).slice(-2) + "-" + ("00" + (i >= 1 ? i : 1)).slice(-2);
  f.length == 7 && (f = "0" + f), f.length == 8 && (f = "20" + f);
  var o = ("00" + (c >= 0 ? c : 0)).slice(-2) + ":" + ("00" + (s >= 0 ? s : 0)).slice(-2) + ":" + ("00" + (u >= 0 ? u : 0)).slice(-2);
  return c == -1 && s == -1 && u == -1 ? f : a == -1 && n == -1 && i == -1 ? o : f + "T" + o;
}
var Ju = {
  "d.m": "d\\.m"
  // Issue #2571 Google Sheets writes invalid format 'd.m', correct format is 'd"."m' or 'd\\.m'
};
function Qt(e, t) {
  return $u(Ju[e] || e, t);
}
var ui = /* @__PURE__ */ (function() {
  var e = {};
  e.version = "1.2.0";
  function t() {
    for (var I = 0, L = new Array(256), A = 0; A != 256; ++A)
      I = A, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, I = I & 1 ? -306674912 ^ I >>> 1 : I >>> 1, L[A] = I;
    return typeof Int32Array < "u" ? new Int32Array(L) : L;
  }
  var r = t();
  function a(I) {
    var L = 0, A = 0, N = 0, R = typeof Int32Array < "u" ? new Int32Array(4096) : new Array(4096);
    for (N = 0; N != 256; ++N) R[N] = I[N];
    for (N = 0; N != 256; ++N)
      for (A = I[N], L = 256 + N; L < 4096; L += 256) A = R[L] = A >>> 8 ^ I[A & 255];
    var V = [];
    for (N = 1; N != 16; ++N) V[N - 1] = typeof Int32Array < "u" && typeof R.subarray == "function" ? R.subarray(N * 256, N * 256 + 256) : R.slice(N * 256, N * 256 + 256);
    return V;
  }
  var n = a(r), i = n[0], c = n[1], s = n[2], u = n[3], f = n[4], o = n[5], l = n[6], x = n[7], h = n[8], g = n[9], _ = n[10], d = n[11], p = n[12], w = n[13], m = n[14];
  function y(I, L) {
    for (var A = L ^ -1, N = 0, R = I.length; N < R; ) A = A >>> 8 ^ r[(A ^ I.charCodeAt(N++)) & 255];
    return ~A;
  }
  function M(I, L) {
    for (var A = L ^ -1, N = I.length - 15, R = 0; R < N; ) A = m[I[R++] ^ A & 255] ^ w[I[R++] ^ A >> 8 & 255] ^ p[I[R++] ^ A >> 16 & 255] ^ d[I[R++] ^ A >>> 24] ^ _[I[R++]] ^ g[I[R++]] ^ h[I[R++]] ^ x[I[R++]] ^ l[I[R++]] ^ o[I[R++]] ^ f[I[R++]] ^ u[I[R++]] ^ s[I[R++]] ^ c[I[R++]] ^ i[I[R++]] ^ r[I[R++]];
    for (N += 15; R < N; ) A = A >>> 8 ^ r[(A ^ I[R++]) & 255];
    return ~A;
  }
  function W(I, L) {
    for (var A = L ^ -1, N = 0, R = I.length, V = 0, ae = 0; N < R; )
      V = I.charCodeAt(N++), V < 128 ? A = A >>> 8 ^ r[(A ^ V) & 255] : V < 2048 ? (A = A >>> 8 ^ r[(A ^ (192 | V >> 6 & 31)) & 255], A = A >>> 8 ^ r[(A ^ (128 | V & 63)) & 255]) : V >= 55296 && V < 57344 ? (V = (V & 1023) + 64, ae = I.charCodeAt(N++) & 1023, A = A >>> 8 ^ r[(A ^ (240 | V >> 8 & 7)) & 255], A = A >>> 8 ^ r[(A ^ (128 | V >> 2 & 63)) & 255], A = A >>> 8 ^ r[(A ^ (128 | ae >> 6 & 15 | (V & 3) << 4)) & 255], A = A >>> 8 ^ r[(A ^ (128 | ae & 63)) & 255]) : (A = A >>> 8 ^ r[(A ^ (224 | V >> 12 & 15)) & 255], A = A >>> 8 ^ r[(A ^ (128 | V >> 6 & 63)) & 255], A = A >>> 8 ^ r[(A ^ (128 | V & 63)) & 255]);
    return ~A;
  }
  return e.table = r, e.bstr = y, e.buf = M, e.str = W, e;
})(), je = /* @__PURE__ */ (function() {
  var t = (
    /*::(*/
    {}
  );
  t.version = "1.2.2";
  function r(v, D) {
    for (var T = v.split("/"), F = D.split("/"), C = 0, b = 0, q = Math.min(T.length, F.length); C < q; ++C) {
      if (b = T[C].length - F[C].length) return b;
      if (T[C] != F[C]) return T[C] < F[C] ? -1 : 1;
    }
    return T.length - F.length;
  }
  function a(v) {
    if (v.charAt(v.length - 1) == "/") return v.slice(0, -1).indexOf("/") === -1 ? v : a(v.slice(0, -1));
    var D = v.lastIndexOf("/");
    return D === -1 ? v : v.slice(0, D + 1);
  }
  function n(v) {
    if (v.charAt(v.length - 1) == "/") return n(v.slice(0, -1));
    var D = v.lastIndexOf("/");
    return D === -1 ? v : v.slice(D + 1);
  }
  function i(v, D) {
    typeof D == "string" && (D = new Date(D));
    var T = D.getHours();
    T = T << 6 | D.getMinutes(), T = T << 5 | D.getSeconds() >>> 1, v.write_shift(2, T);
    var F = D.getFullYear() - 1980;
    F = F << 4 | D.getMonth() + 1, F = F << 5 | D.getDate(), v.write_shift(2, F);
  }
  function c(v) {
    var D = v.read_shift(2) & 65535, T = v.read_shift(2) & 65535, F = /* @__PURE__ */ new Date(), C = T & 31;
    T >>>= 5;
    var b = T & 15;
    T >>>= 4, F.setMilliseconds(0), F.setFullYear(T + 1980), F.setMonth(b - 1), F.setDate(C);
    var q = D & 31;
    D >>>= 5;
    var Z = D & 63;
    return D >>>= 6, F.setHours(D), F.setMinutes(Z), F.setSeconds(q << 1), F;
  }
  function s(v) {
    xr(v, 0);
    for (var D = (
      /*::(*/
      {}
    ), T = 0; v.l <= v.length - 4; ) {
      var F = v.read_shift(2), C = v.read_shift(2), b = v.l + C, q = {};
      switch (F) {
        /* UNIX-style Timestamps */
        case 21589:
          T = v.read_shift(1), T & 1 && (q.mtime = v.read_shift(4)), C > 5 && (T & 2 && (q.atime = v.read_shift(4)), T & 4 && (q.ctime = v.read_shift(4))), q.mtime && (q.mt = new Date(q.mtime * 1e3));
          break;
        /* ZIP64 Extended Information Field */
        case 1:
          {
            var Z = v.read_shift(4), X = v.read_shift(4);
            q.usz = X * Math.pow(2, 32) + Z, Z = v.read_shift(4), X = v.read_shift(4), q.csz = X * Math.pow(2, 32) + Z;
          }
          break;
      }
      v.l = b, D[F] = q;
    }
    return D;
  }
  var u;
  function f() {
    return u || (u = Zu);
  }
  function o(v, D) {
    if (v[0] == 80 && v[1] == 75) return dt(v, D);
    if ((v[0] | 32) == 109 && (v[1] | 32) == 105) return ge(v, D);
    if (v.length < 512) throw new Error("CFB file size " + v.length + " < 512");
    var T = 3, F = 512, C = 0, b = 0, q = 0, Z = 0, X = 0, z = [], j = (
      /*::(*/
      v.slice(0, 512)
    );
    xr(j, 0);
    var he = l(j);
    switch (T = he[0], T) {
      case 3:
        F = 512;
        break;
      case 4:
        F = 4096;
        break;
      case 0:
        if (he[1] == 0) return dt(v, D);
      /* falls through */
      default:
        throw new Error("Major Version: Expected 3 or 4 saw " + T);
    }
    F !== 512 && (j = /*::(*/
    v.slice(0, F), xr(
      j,
      28
      /* blob.l */
    ));
    var ve = v.slice(0, F);
    x(j, T);
    var ke = j.read_shift(4, "i");
    if (T === 3 && ke !== 0) throw new Error("# Directory Sectors: Expected 0 saw " + ke);
    j.l += 4, q = j.read_shift(4, "i"), j.l += 4, j.chk("00100000", "Mini Stream Cutoff Size: "), Z = j.read_shift(4, "i"), C = j.read_shift(4, "i"), X = j.read_shift(4, "i"), b = j.read_shift(4, "i");
    for (var le = -1, me = 0; me < 109 && (le = j.read_shift(4, "i"), !(le < 0)); ++me)
      z[me] = le;
    var Be = h(v, F);
    d(X, b, Be, F, z);
    var tr = w(Be, q, z, F);
    q < tr.length && (tr[q].name = "!Directory"), C > 0 && Z !== ae && (tr[Z].name = "!MiniFAT"), tr[z[0]].name = "!FAT", tr.fat_addrs = z, tr.ssz = F;
    var ir = {}, Dr = [], ya = [], Sa = [];
    m(q, tr, Be, Dr, C, ir, ya, Z), g(ya, Sa, Dr), Dr.shift();
    var ba = {
      FileIndex: ya,
      FullPaths: Sa
    };
    return D && D.raw && (ba.raw = { header: ve, sectors: Be }), ba;
  }
  function l(v) {
    if (v[v.l] == 80 && v[v.l + 1] == 75) return [0, 0];
    v.chk(K, "Header Signature: "), v.l += 16;
    var D = v.read_shift(2, "u");
    return [v.read_shift(2, "u"), D];
  }
  function x(v, D) {
    var T = 9;
    switch (v.l += 2, T = v.read_shift(2)) {
      case 9:
        if (D != 3) throw new Error("Sector Shift: Expected 9 saw " + T);
        break;
      case 12:
        if (D != 4) throw new Error("Sector Shift: Expected 12 saw " + T);
        break;
      default:
        throw new Error("Sector Shift: Expected 9 or 12 saw " + T);
    }
    v.chk("0600", "Mini Sector Shift: "), v.chk("000000000000", "Reserved: ");
  }
  function h(v, D) {
    for (var T = Math.ceil(v.length / D) - 1, F = [], C = 1; C < T; ++C) F[C - 1] = v.slice(C * D, (C + 1) * D);
    return F[T - 1] = v.slice(T * D), F;
  }
  function g(v, D, T) {
    for (var F = 0, C = 0, b = 0, q = 0, Z = 0, X = T.length, z = [], j = []; F < X; ++F)
      z[F] = j[F] = F, D[F] = T[F];
    for (; Z < j.length; ++Z)
      F = j[Z], C = v[F].L, b = v[F].R, q = v[F].C, z[F] === F && (C !== -1 && z[C] !== C && (z[F] = z[C]), b !== -1 && z[b] !== b && (z[F] = z[b])), q !== -1 && (z[q] = F), C !== -1 && F != z[F] && (z[C] = z[F], j.lastIndexOf(C) < Z && j.push(C)), b !== -1 && F != z[F] && (z[b] = z[F], j.lastIndexOf(b) < Z && j.push(b));
    for (F = 1; F < X; ++F) z[F] === F && (b !== -1 && z[b] !== b ? z[F] = z[b] : C !== -1 && z[C] !== C && (z[F] = z[C]));
    for (F = 1; F < X; ++F)
      if (v[F].type !== 0) {
        if (Z = F, Z != z[Z]) do
          Z = z[Z], D[F] = D[Z] + "/" + D[F];
        while (Z !== 0 && z[Z] !== -1 && Z != z[Z]);
        z[F] = -1;
      }
    for (D[0] += "/", F = 1; F < X; ++F)
      v[F].type !== 2 && (D[F] += "/");
  }
  function _(v, D, T) {
    for (var F = v.start, C = v.size, b = [], q = F; T && C > 0 && q >= 0; )
      b.push(D.slice(q * V, q * V + V)), C -= V, q = Jt(T, q * 4);
    return b.length === 0 ? dr(0) : Ut(b).slice(0, v.size);
  }
  function d(v, D, T, F, C) {
    var b = ae;
    if (v === ae) {
      if (D !== 0) throw new Error("DIFAT chain shorter than expected");
    } else if (v !== -1) {
      var q = T[v], Z = (F >>> 2) - 1;
      if (!q) return;
      for (var X = 0; X < Z && (b = Jt(q, X * 4)) !== ae; ++X)
        C.push(b);
      D >= 1 && d(Jt(q, F - 4), D - 1, T, F, C);
    }
  }
  function p(v, D, T, F, C) {
    var b = [], q = [];
    C || (C = []);
    var Z = F - 1, X = 0, z = 0;
    for (X = D; X >= 0; ) {
      C[X] = !0, b[b.length] = X, q.push(v[X]);
      var j = T[Math.floor(X * 4 / F)];
      if (z = X * 4 & Z, F < 4 + z) throw new Error("FAT boundary crossed: " + X + " 4 " + F);
      if (!v[j]) break;
      X = Jt(v[j], z);
    }
    return { nodes: b, data: vi([q]) };
  }
  function w(v, D, T, F) {
    var C = v.length, b = [], q = [], Z = [], X = [], z = F - 1, j = 0, he = 0, ve = 0, ke = 0;
    for (j = 0; j < C; ++j)
      if (Z = [], ve = j + D, ve >= C && (ve -= C), !q[ve]) {
        X = [];
        var le = [];
        for (he = ve; he >= 0; ) {
          le[he] = !0, q[he] = !0, Z[Z.length] = he, X.push(v[he]);
          var me = T[Math.floor(he * 4 / F)];
          if (ke = he * 4 & z, F < 4 + ke) throw new Error("FAT boundary crossed: " + he + " 4 " + F);
          if (!v[me] || (he = Jt(v[me], ke), le[he])) break;
        }
        b[ve] = { nodes: Z, data: vi([X]) };
      }
    return b;
  }
  function m(v, D, T, F, C, b, q, Z) {
    for (var X = 0, z = F.length ? 2 : 0, j = D[v].data, he = 0, ve = 0, ke; he < j.length; he += 128) {
      var le = (
        /*::(*/
        j.slice(he, he + 128)
      );
      xr(le, 64), ve = le.read_shift(2), ke = B0(le, 0, ve - z), F.push(ke);
      var me = {
        name: ke,
        type: le.read_shift(1),
        color: le.read_shift(1),
        L: le.read_shift(4, "i"),
        R: le.read_shift(4, "i"),
        C: le.read_shift(4, "i"),
        clsid: le.read_shift(16),
        state: le.read_shift(4, "i"),
        start: 0,
        size: 0
      }, Be = le.read_shift(2) + le.read_shift(2) + le.read_shift(2) + le.read_shift(2);
      Be !== 0 && (me.ct = y(le, le.l - 8));
      var tr = le.read_shift(2) + le.read_shift(2) + le.read_shift(2) + le.read_shift(2);
      tr !== 0 && (me.mt = y(le, le.l - 8)), me.start = le.read_shift(4, "i"), me.size = le.read_shift(4, "i"), me.size < 0 && me.start < 0 && (me.size = me.type = 0, me.start = ae, me.name = ""), me.type === 5 ? (X = me.start, C > 0 && X !== ae && (D[X].name = "!StreamData")) : me.size >= 4096 ? (me.storage = "fat", D[me.start] === void 0 && (D[me.start] = p(T, me.start, D.fat_addrs, D.ssz)), D[me.start].name = me.name, me.content = D[me.start].data.slice(0, me.size)) : (me.storage = "minifat", me.size < 0 ? me.size = 0 : X !== ae && me.start !== ae && D[X] && (me.content = _(me, D[X].data, (D[Z] || {}).data))), me.content && xr(me.content, 0), b[ke] = me, q.push(me);
    }
  }
  function y(v, D) {
    return new Date((Xr(v, D + 4) / 1e7 * Math.pow(2, 32) + Xr(v, D) / 1e7 - 11644473600) * 1e3);
  }
  function M(v, D) {
    return f(), o(u.readFileSync(v), D);
  }
  function W(v, D) {
    var T = D && D.type;
    switch (T || Xe && Buffer.isBuffer(v) && (T = "buffer"), T || "base64") {
      case "file":
        return M(v, D);
      case "base64":
        return o(Gr(qr(v)), D);
      case "binary":
        return o(Gr(v), D);
    }
    return o(
      /*::typeof blob == 'string' ? new Buffer(blob, 'utf-8') : */
      v,
      D
    );
  }
  function I(v, D) {
    var T = D || {}, F = T.root || "Root Entry";
    if (v.FullPaths || (v.FullPaths = []), v.FileIndex || (v.FileIndex = []), v.FullPaths.length !== v.FileIndex.length) throw new Error("inconsistent CFB structure");
    v.FullPaths.length === 0 && (v.FullPaths[0] = F + "/", v.FileIndex[0] = { name: F, type: 5 }), T.CLSID && (v.FileIndex[0].clsid = T.CLSID), L(v);
  }
  function L(v) {
    var D = "Sh33tJ5";
    if (!je.find(v, "/" + D)) {
      var T = dr(4);
      T[0] = 55, T[1] = T[3] = 50, T[2] = 54, v.FileIndex.push({ name: D, type: 2, content: T, size: 4, L: 69, R: 69, C: 69 }), v.FullPaths.push(v.FullPaths[0] + D), A(v);
    }
  }
  function A(v, D) {
    I(v);
    for (var T = !1, F = !1, C = v.FullPaths.length - 1; C >= 0; --C) {
      var b = v.FileIndex[C];
      switch (b.type) {
        case 0:
          F ? T = !0 : (v.FileIndex.pop(), v.FullPaths.pop());
          break;
        case 1:
        case 2:
        case 5:
          F = !0, isNaN(b.R * b.L * b.C) && (T = !0), b.R > -1 && b.L > -1 && b.R == b.L && (T = !0);
          break;
        default:
          T = !0;
          break;
      }
    }
    if (!(!T && !D)) {
      var q = new Date(1987, 1, 19), Z = 0, X = Object.create ? /* @__PURE__ */ Object.create(null) : {}, z = [];
      for (C = 0; C < v.FullPaths.length; ++C)
        X[v.FullPaths[C]] = !0, v.FileIndex[C].type !== 0 && z.push([v.FullPaths[C], v.FileIndex[C]]);
      for (C = 0; C < z.length; ++C) {
        var j = a(z[C][0]);
        for (F = X[j]; !F; ) {
          for (; a(j) && !X[a(j)]; ) j = a(j);
          z.push([j, {
            name: n(j).replace("/", ""),
            type: 1,
            clsid: fe,
            ct: q,
            mt: q,
            content: null
          }]), X[j] = !0, j = a(z[C][0]), F = X[j];
        }
      }
      for (z.sort(function(ke, le) {
        return r(ke[0], le[0]);
      }), v.FullPaths = [], v.FileIndex = [], C = 0; C < z.length; ++C)
        v.FullPaths[C] = z[C][0], v.FileIndex[C] = z[C][1];
      for (C = 0; C < z.length; ++C) {
        var he = v.FileIndex[C], ve = v.FullPaths[C];
        if (he.name = n(ve).replace("/", ""), he.L = he.R = he.C = -(he.color = 1), he.size = he.content ? he.content.length : 0, he.start = 0, he.clsid = he.clsid || fe, C === 0)
          he.C = z.length > 1 ? 1 : -1, he.size = 0, he.type = 5;
        else if (ve.slice(-1) == "/") {
          for (Z = C + 1; Z < z.length && a(v.FullPaths[Z]) != ve; ++Z) ;
          for (he.C = Z >= z.length ? -1 : Z, Z = C + 1; Z < z.length && a(v.FullPaths[Z]) != a(ve); ++Z) ;
          he.R = Z >= z.length ? -1 : Z, he.type = 1;
        } else
          a(v.FullPaths[C + 1] || "") == a(ve) && (he.R = C + 1), he.type = 2;
      }
    }
  }
  function N(v, D) {
    var T = D || {};
    if (T.fileType == "mad") return ye(v, T);
    if (A(v), T.fileType === "zip")
      return va(v, T);
    var F = (function(ke) {
      for (var le = 0, me = 0, Be = 0; Be < ke.FileIndex.length; ++Be) {
        var tr = ke.FileIndex[Be];
        if (tr.content) {
          var ir = tr.content.length;
          ir > 0 && (ir < 4096 ? le += ir + 63 >> 6 : me += ir + 511 >> 9);
        }
      }
      for (var Dr = ke.FullPaths.length + 3 >> 2, ya = le + 7 >> 3, Sa = le + 127 >> 7, ba = ya + me + Dr + Sa, jt = ba + 127 >> 7, Jn = jt <= 109 ? 0 : Math.ceil((jt - 109) / 127); ba + jt + Jn + 127 >> 7 > jt; ) Jn = ++jt <= 109 ? 0 : Math.ceil((jt - 109) / 127);
      var Et = [1, Jn, jt, Sa, Dr, me, le, 0];
      return ke.FileIndex[0].size = le << 6, Et[7] = (ke.FileIndex[0].start = Et[0] + Et[1] + Et[2] + Et[3] + Et[4] + Et[5]) + (Et[6] + 7 >> 3), Et;
    })(v), C = dr(F[7] << 9), b = 0, q = 0;
    {
      for (b = 0; b < 8; ++b) C.write_shift(1, J[b]);
      for (b = 0; b < 8; ++b) C.write_shift(2, 0);
      for (C.write_shift(2, 62), C.write_shift(2, 3), C.write_shift(2, 65534), C.write_shift(2, 9), C.write_shift(2, 6), b = 0; b < 3; ++b) C.write_shift(2, 0);
      for (C.write_shift(4, 0), C.write_shift(4, F[2]), C.write_shift(4, F[0] + F[1] + F[2] + F[3] - 1), C.write_shift(4, 0), C.write_shift(4, 4096), C.write_shift(4, F[3] ? F[0] + F[1] + F[2] - 1 : ae), C.write_shift(4, F[3]), C.write_shift(-4, F[1] ? F[0] - 1 : ae), C.write_shift(4, F[1]), b = 0; b < 109; ++b) C.write_shift(-4, b < F[2] ? F[1] + b : -1);
    }
    if (F[1])
      for (q = 0; q < F[1]; ++q) {
        for (; b < 236 + q * 127; ++b) C.write_shift(-4, b < F[2] ? F[1] + b : -1);
        C.write_shift(-4, q === F[1] - 1 ? ae : q + 1);
      }
    var Z = function(ke) {
      for (q += ke; b < q - 1; ++b) C.write_shift(-4, b + 1);
      ke && (++b, C.write_shift(-4, ae));
    };
    for (q = b = 0, q += F[1]; b < q; ++b) C.write_shift(-4, Y.DIFSECT);
    for (q += F[2]; b < q; ++b) C.write_shift(-4, Y.FATSECT);
    Z(F[3]), Z(F[4]);
    for (var X = 0, z = 0, j = v.FileIndex[0]; X < v.FileIndex.length; ++X)
      j = v.FileIndex[X], j.content && (z = j.content.length, !(z < 4096) && (j.start = q, Z(z + 511 >> 9)));
    for (Z(F[6] + 7 >> 3); C.l & 511; ) C.write_shift(-4, Y.ENDOFCHAIN);
    for (q = b = 0, X = 0; X < v.FileIndex.length; ++X)
      j = v.FileIndex[X], j.content && (z = j.content.length, !(!z || z >= 4096) && (j.start = q, Z(z + 63 >> 6)));
    for (; C.l & 511; ) C.write_shift(-4, Y.ENDOFCHAIN);
    for (b = 0; b < F[4] << 2; ++b) {
      var he = v.FullPaths[b];
      if (!he || he.length === 0) {
        for (X = 0; X < 17; ++X) C.write_shift(4, 0);
        for (X = 0; X < 3; ++X) C.write_shift(4, -1);
        for (X = 0; X < 12; ++X) C.write_shift(4, 0);
        continue;
      }
      j = v.FileIndex[b], b === 0 && (j.start = j.size ? j.start - 1 : ae);
      var ve = b === 0 && T.root || j.name;
      if (ve.length > 31 && (console.error("Name " + ve + " will be truncated to " + ve.slice(0, 31)), ve = ve.slice(0, 31)), z = 2 * (ve.length + 1), C.write_shift(64, ve, "utf16le"), C.write_shift(2, z), C.write_shift(1, j.type), C.write_shift(1, j.color), C.write_shift(-4, j.L), C.write_shift(-4, j.R), C.write_shift(-4, j.C), j.clsid) C.write_shift(16, j.clsid, "hex");
      else for (X = 0; X < 4; ++X) C.write_shift(4, 0);
      C.write_shift(4, j.state || 0), C.write_shift(4, 0), C.write_shift(4, 0), C.write_shift(4, 0), C.write_shift(4, 0), C.write_shift(4, j.start), C.write_shift(4, j.size), C.write_shift(4, 0);
    }
    for (b = 1; b < v.FileIndex.length; ++b)
      if (j = v.FileIndex[b], j.size >= 4096)
        if (C.l = j.start + 1 << 9, Xe && Buffer.isBuffer(j.content))
          j.content.copy(C, C.l, 0, j.size), C.l += j.size + 511 & -512;
        else {
          for (X = 0; X < j.size; ++X) C.write_shift(1, j.content[X]);
          for (; X & 511; ++X) C.write_shift(1, 0);
        }
    for (b = 1; b < v.FileIndex.length; ++b)
      if (j = v.FileIndex[b], j.size > 0 && j.size < 4096)
        if (Xe && Buffer.isBuffer(j.content))
          j.content.copy(C, C.l, 0, j.size), C.l += j.size + 63 & -64;
        else {
          for (X = 0; X < j.size; ++X) C.write_shift(1, j.content[X]);
          for (; X & 63; ++X) C.write_shift(1, 0);
        }
    if (Xe)
      C.l = C.length;
    else
      for (; C.l < C.length; ) C.write_shift(1, 0);
    return C;
  }
  function R(v, D) {
    var T = v.FullPaths.map(function(X) {
      return X.toUpperCase();
    }), F = T.map(function(X) {
      var z = X.split("/");
      return z[z.length - (X.slice(-1) == "/" ? 2 : 1)];
    }), C = !1;
    D.charCodeAt(0) === 47 ? (C = !0, D = T[0].slice(0, -1) + D) : C = D.indexOf("/") !== -1;
    var b = D.toUpperCase(), q = C === !0 ? T.indexOf(b) : F.indexOf(b);
    if (q !== -1) return v.FileIndex[q];
    var Z = !b.match(Ba);
    for (b = b.replace(Pr, ""), Z && (b = b.replace(Ba, "!")), q = 0; q < T.length; ++q)
      if ((Z ? T[q].replace(Ba, "!") : T[q]).replace(Pr, "") == b || (Z ? F[q].replace(Ba, "!") : F[q]).replace(Pr, "") == b) return v.FileIndex[q];
    return null;
  }
  var V = 64, ae = -2, K = "d0cf11e0a1b11ae1", J = [208, 207, 17, 224, 161, 177, 26, 225], fe = "00000000000000000000000000000000", Y = {
    /* 2.1 Compund File Sector Numbers and Types */
    MAXREGSECT: -6,
    DIFSECT: -4,
    FATSECT: -3,
    ENDOFCHAIN: ae,
    FREESECT: -1,
    /* 2.2 Compound File Header */
    HEADER_SIGNATURE: K,
    HEADER_MINOR_VERSION: "3e00",
    MAXREGSID: -6,
    NOSTREAM: -1,
    HEADER_CLSID: fe,
    /* 2.6.1 Compound File Directory Entry */
    EntryTypes: ["unknown", "storage", "stream", "lockbytes", "property", "root"]
  };
  function oe(v, D, T) {
    f();
    var F = N(v, T);
    u.writeFileSync(D, F);
  }
  function ce(v) {
    for (var D = new Array(v.length), T = 0; T < v.length; ++T) D[T] = String.fromCharCode(v[T]);
    return D.join("");
  }
  function re(v, D) {
    var T = N(v, D);
    switch (D && D.type || "buffer") {
      case "file":
        return f(), u.writeFileSync(D.filename, T), T;
      case "binary":
        return typeof T == "string" ? T : ce(T);
      case "base64":
        return Q0(typeof T == "string" ? T : ce(T));
      case "buffer":
        if (Xe) return Buffer.isBuffer(T) ? T : zt(T);
      /* falls through */
      case "array":
        return typeof T == "string" ? Gr(T) : T;
    }
    return T;
  }
  var De;
  function be(v) {
    try {
      var D = v.InflateRaw, T = new D();
      if (T._processChunk(new Uint8Array([3, 0]), T._finishFlushFlag), T.bytesRead) De = v;
      else throw new Error("zlib does not expose bytesRead");
    } catch (F) {
      console.error("cannot use native zlib: " + (F.message || F));
    }
  }
  function de(v, D) {
    if (!De) return Lt(v, D);
    var T = De.InflateRaw, F = new T(), C = F._processChunk(v.slice(v.l), F._finishFlushFlag);
    return v.l += F.bytesRead, C;
  }
  function ie(v) {
    return De ? De.deflateRawSync(v) : Kr(v);
  }
  var Se = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], _e = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], Ne = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  function S(v) {
    var D = (v << 1 | v << 11) & 139536 | (v << 5 | v << 15) & 558144;
    return (D >> 16 | D >> 8 | D) & 255;
  }
  for (var G = typeof Uint8Array < "u", H = G ? new Uint8Array(256) : [], P = 0; P < 256; ++P) H[P] = S(P);
  function ee(v, D) {
    var T = H[v & 255];
    return D <= 8 ? T >>> 8 - D : (T = T << 8 | H[v >> 8 & 255], D <= 16 ? T >>> 16 - D : (T = T << 8 | H[v >> 16 & 255], T >>> 24 - D));
  }
  function Fe(v, D) {
    var T = D & 7, F = D >>> 3;
    return (v[F] | (T <= 6 ? 0 : v[F + 1] << 8)) >>> T & 3;
  }
  function te(v, D) {
    var T = D & 7, F = D >>> 3;
    return (v[F] | (T <= 5 ? 0 : v[F + 1] << 8)) >>> T & 7;
  }
  function ue(v, D) {
    var T = D & 7, F = D >>> 3;
    return (v[F] | (T <= 4 ? 0 : v[F + 1] << 8)) >>> T & 15;
  }
  function se(v, D) {
    var T = D & 7, F = D >>> 3;
    return (v[F] | (T <= 3 ? 0 : v[F + 1] << 8)) >>> T & 31;
  }
  function Ce(v, D) {
    var T = D & 7, F = D >>> 3;
    return (v[F] | (T <= 1 ? 0 : v[F + 1] << 8)) >>> T & 127;
  }
  function Ae(v, D, T) {
    var F = D & 7, C = D >>> 3, b = (1 << T) - 1, q = v[C] >>> F;
    return T < 8 - F || (q |= v[C + 1] << 8 - F, T < 16 - F) || (q |= v[C + 2] << 16 - F, T < 24 - F) || (q |= v[C + 3] << 24 - F), q & b;
  }
  function Te(v, D, T) {
    var F = D & 7, C = D >>> 3;
    return F <= 5 ? v[C] |= (T & 7) << F : (v[C] |= T << F & 255, v[C + 1] = (T & 7) >> 8 - F), D + 3;
  }
  function ze(v, D, T) {
    var F = D & 7, C = D >>> 3;
    return T = (T & 1) << F, v[C] |= T, D + 1;
  }
  function Ie(v, D, T) {
    var F = D & 7, C = D >>> 3;
    return T <<= F, v[C] |= T & 255, T >>>= 8, v[C + 1] = T, D + 8;
  }
  function Pe(v, D, T) {
    var F = D & 7, C = D >>> 3;
    return T <<= F, v[C] |= T & 255, T >>>= 8, v[C + 1] = T & 255, v[C + 2] = T >>> 8, D + 16;
  }
  function we(v, D) {
    var T = v.length, F = 2 * T > D ? 2 * T : D + 5, C = 0;
    if (T >= D) return v;
    if (Xe) {
      var b = ei(F);
      if (v.copy) v.copy(b);
      else for (; C < v.length; ++C) b[C] = v[C];
      return b;
    } else if (G) {
      var q = new Uint8Array(F);
      if (q.set) q.set(v);
      else for (; C < T; ++C) q[C] = v[C];
      return q;
    }
    return v.length = F, v;
  }
  function qe(v) {
    for (var D = new Array(v), T = 0; T < v; ++T) D[T] = 0;
    return D;
  }
  function pe(v, D, T) {
    var F = 1, C = 0, b = 0, q = 0, Z = 0, X = v.length, z = G ? new Uint16Array(32) : qe(32);
    for (b = 0; b < 32; ++b) z[b] = 0;
    for (b = X; b < T; ++b) v[b] = 0;
    X = v.length;
    var j = G ? new Uint16Array(X) : qe(X);
    for (b = 0; b < X; ++b)
      z[C = v[b]]++, F < C && (F = C), j[b] = 0;
    for (z[0] = 0, b = 1; b <= F; ++b) z[b + 16] = Z = Z + z[b - 1] << 1;
    for (b = 0; b < X; ++b)
      Z = v[b], Z != 0 && (j[b] = z[Z + 16]++);
    var he = 0;
    for (b = 0; b < X; ++b)
      if (he = v[b], he != 0)
        for (Z = ee(j[b], F) >> F - he, q = (1 << F + 4 - he) - 1; q >= 0; --q)
          D[Z | q << he] = he & 15 | b << 4;
    return F;
  }
  var Or = G ? new Uint16Array(512) : qe(512), _r = G ? new Uint16Array(32) : qe(32);
  if (!G) {
    for (var rr = 0; rr < 512; ++rr) Or[rr] = 0;
    for (rr = 0; rr < 32; ++rr) _r[rr] = 0;
  }
  (function() {
    for (var v = [], D = 0; D < 32; D++) v.push(5);
    pe(v, _r, 32);
    var T = [];
    for (D = 0; D <= 143; D++) T.push(8);
    for (; D <= 255; D++) T.push(9);
    for (; D <= 279; D++) T.push(7);
    for (; D <= 287; D++) T.push(8);
    pe(T, Or, 288);
  })();
  var jr = /* @__PURE__ */ (function() {
    for (var D = G ? new Uint8Array(32768) : [], T = 0, F = 0; T < Ne.length - 1; ++T)
      for (; F < Ne[T + 1]; ++F) D[F] = T;
    for (; F < 32768; ++F) D[F] = 29;
    var C = G ? new Uint8Array(259) : [];
    for (T = 0, F = 0; T < _e.length - 1; ++T)
      for (; F < _e[T + 1]; ++F) C[F] = T;
    function b(Z, X) {
      for (var z = 0; z < Z.length; ) {
        var j = Math.min(65535, Z.length - z), he = z + j == Z.length;
        for (X.write_shift(1, +he), X.write_shift(2, j), X.write_shift(2, ~j & 65535); j-- > 0; ) X[X.l++] = Z[z++];
      }
      return X.l;
    }
    function q(Z, X) {
      for (var z = 0, j = 0, he = G ? new Uint16Array(32768) : []; j < Z.length; ) {
        var ve = (
          /* data.length - boff; */
          Math.min(65535, Z.length - j)
        );
        if (ve < 10) {
          for (z = Te(X, z, +(j + ve == Z.length)), z & 7 && (z += 8 - (z & 7)), X.l = z / 8 | 0, X.write_shift(2, ve), X.write_shift(2, ~ve & 65535); ve-- > 0; ) X[X.l++] = Z[j++];
          z = X.l * 8;
          continue;
        }
        z = Te(X, z, +(j + ve == Z.length) + 2);
        for (var ke = 0; ve-- > 0; ) {
          var le = Z[j];
          ke = (ke << 5 ^ le) & 32767;
          var me = -1, Be = 0;
          if ((me = he[ke]) && (me |= j & -32768, me > j && (me -= 32768), me < j))
            for (; Z[me + Be] == Z[j + Be] && Be < 250; ) ++Be;
          if (Be > 2) {
            le = C[Be], le <= 22 ? z = Ie(X, z, H[le + 1] >> 1) - 1 : (Ie(X, z, 3), z += 5, Ie(X, z, H[le - 23] >> 5), z += 3);
            var tr = le < 8 ? 0 : le - 4 >> 2;
            tr > 0 && (Pe(X, z, Be - _e[le]), z += tr), le = D[j - me], z = Ie(X, z, H[le] >> 3), z -= 3;
            var ir = le < 4 ? 0 : le - 2 >> 1;
            ir > 0 && (Pe(X, z, j - me - Ne[le]), z += ir);
            for (var Dr = 0; Dr < Be; ++Dr)
              he[ke] = j & 32767, ke = (ke << 5 ^ Z[j]) & 32767, ++j;
            ve -= Be - 1;
          } else
            le <= 143 ? le = le + 48 : z = ze(X, z, 1), z = Ie(X, z, H[le]), he[ke] = j & 32767, ++j;
        }
        z = Ie(X, z, 0) - 1;
      }
      return X.l = (z + 7) / 8 | 0, X.l;
    }
    return function(X, z) {
      return X.length < 8 ? b(X, z) : q(X, z);
    };
  })();
  function Kr(v) {
    var D = dr(50 + Math.floor(v.length * 1.1)), T = jr(v, D);
    return D.slice(0, T);
  }
  var Oe = G ? new Uint16Array(32768) : qe(32768), nr = G ? new Uint16Array(32768) : qe(32768), vr = G ? new Uint16Array(128) : qe(128), Hr = 1, O = 1;
  function Ar(v, D) {
    var T = se(v, D) + 257;
    D += 5;
    var F = se(v, D) + 1;
    D += 5;
    var C = ue(v, D) + 4;
    D += 4;
    for (var b = 0, q = G ? new Uint8Array(19) : qe(19), Z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], X = 1, z = G ? new Uint8Array(8) : qe(8), j = G ? new Uint8Array(8) : qe(8), he = q.length, ve = 0; ve < C; ++ve)
      q[Se[ve]] = b = te(v, D), X < b && (X = b), z[b]++, D += 3;
    var ke = 0;
    for (z[0] = 0, ve = 1; ve <= X; ++ve) j[ve] = ke = ke + z[ve - 1] << 1;
    for (ve = 0; ve < he; ++ve) (ke = q[ve]) != 0 && (Z[ve] = j[ke]++);
    var le = 0;
    for (ve = 0; ve < he; ++ve)
      if (le = q[ve], le != 0) {
        ke = H[Z[ve]] >> 8 - le;
        for (var me = (1 << 7 - le) - 1; me >= 0; --me) vr[ke | me << le] = le & 7 | ve << 3;
      }
    var Be = [];
    for (X = 1; Be.length < T + F; )
      switch (ke = vr[Ce(v, D)], D += ke & 7, ke >>>= 3) {
        case 16:
          for (b = 3 + Fe(v, D), D += 2, ke = Be[Be.length - 1]; b-- > 0; ) Be.push(ke);
          break;
        case 17:
          for (b = 3 + te(v, D), D += 3; b-- > 0; ) Be.push(0);
          break;
        case 18:
          for (b = 11 + Ce(v, D), D += 7; b-- > 0; ) Be.push(0);
          break;
        default:
          Be.push(ke), X < ke && (X = ke);
          break;
      }
    var tr = Be.slice(0, T), ir = Be.slice(T);
    for (ve = T; ve < 286; ++ve) tr[ve] = 0;
    for (ve = F; ve < 30; ++ve) ir[ve] = 0;
    return Hr = pe(tr, Oe, 286), O = pe(ir, nr, 30), D;
  }
  function _t(v, D) {
    if (v[0] == 3 && !(v[1] & 3))
      return [Gt(D), 2];
    for (var T = 0, F = 0, C = ei(D || 1 << 18), b = 0, q = C.length >>> 0, Z = 0, X = 0; (F & 1) == 0; ) {
      if (F = te(v, T), T += 3, F >>> 1)
        F >> 1 == 1 ? (Z = 9, X = 5) : (T = Ar(v, T), Z = Hr, X = O);
      else {
        T & 7 && (T += 8 - (T & 7));
        var z = v[T >>> 3] | v[(T >>> 3) + 1] << 8;
        if (T += 32, z > 0)
          for (!D && q < b + z && (C = we(C, b + z), q = C.length); z-- > 0; )
            C[b++] = v[T >>> 3], T += 8;
        continue;
      }
      for (; ; ) {
        !D && q < b + 32767 && (C = we(C, b + 32767), q = C.length);
        var j = Ae(v, T, Z), he = F >>> 1 == 1 ? Or[j] : Oe[j];
        if (T += he & 15, he >>>= 4, (he >>> 8 & 255) === 0) C[b++] = he;
        else {
          if (he == 256) break;
          he -= 257;
          var ve = he < 8 ? 0 : he - 4 >> 2;
          ve > 5 && (ve = 0);
          var ke = b + _e[he];
          ve > 0 && (ke += Ae(v, T, ve), T += ve), j = Ae(v, T, X), he = F >>> 1 == 1 ? _r[j] : nr[j], T += he & 15, he >>>= 4;
          var le = he < 4 ? 0 : he - 2 >> 1, me = Ne[he];
          for (le > 0 && (me += Ae(v, T, le), T += le), !D && q < ke && (C = we(C, ke + 100), q = C.length); b < ke; )
            C[b] = C[b - me], ++b;
        }
      }
    }
    return D ? [C, T + 7 >>> 3] : [C.slice(0, b), T + 7 >>> 3];
  }
  function Lt(v, D) {
    var T = v.slice(v.l || 0), F = _t(T, D);
    return v.l += F[1], F[0];
  }
  function st(v, D) {
    if (v)
      typeof console < "u" && console.error(D);
    else throw new Error(D);
  }
  function dt(v, D) {
    var T = (
      /*::(*/
      v
    );
    xr(T, 0);
    var F = [], C = [], b = {
      FileIndex: F,
      FullPaths: C
    };
    I(b, { root: D.root });
    for (var q = T.length - 4; (T[q] != 80 || T[q + 1] != 75 || T[q + 2] != 5 || T[q + 3] != 6) && q >= 0; ) --q;
    T.l = q + 4, T.l += 4;
    var Z = T.read_shift(2);
    T.l += 6;
    var X = T.read_shift(4);
    for (T.l = X, q = 0; q < Z; ++q) {
      T.l += 20;
      var z = T.read_shift(4), j = T.read_shift(4), he = T.read_shift(2), ve = T.read_shift(2), ke = T.read_shift(2);
      T.l += 8;
      var le = T.read_shift(4), me = s(
        /*::(*/
        T.slice(T.l + he, T.l + he + ve)
        /*:: :any)*/
      );
      T.l += he + ve + ke;
      var Be = T.l;
      T.l = le + 4, me && me[1] && ((me[1] || {}).usz && (j = me[1].usz), (me[1] || {}).csz && (z = me[1].csz)), Yr(T, z, j, b, me), T.l = Be;
    }
    return b;
  }
  function Yr(v, D, T, F, C) {
    v.l += 2;
    var b = v.read_shift(2), q = v.read_shift(2), Z = c(v);
    if (b & 8257) throw new Error("Unsupported ZIP encryption");
    for (var X = v.read_shift(4), z = v.read_shift(4), j = v.read_shift(4), he = v.read_shift(2), ve = v.read_shift(2), ke = "", le = 0; le < he; ++le) ke += String.fromCharCode(v[v.l++]);
    if (ve) {
      var me = s(
        /*::(*/
        v.slice(v.l, v.l + ve)
        /*:: :any)*/
      );
      (me[21589] || {}).mt && (Z = me[21589].mt), (me[1] || {}).usz && (j = me[1].usz), (me[1] || {}).csz && (z = me[1].csz), C && ((C[21589] || {}).mt && (Z = C[21589].mt), (C[1] || {}).usz && (j = C[1].usz), (C[1] || {}).csz && (z = C[1].csz));
    }
    v.l += ve;
    var Be = v.slice(v.l, v.l + z);
    switch (q) {
      case 8:
        Be = de(v, j);
        break;
      case 0:
        v.l += z;
        break;
      // TODO: scan for magic number
      default:
        throw new Error("Unsupported ZIP Compression method " + q);
    }
    var tr = !1;
    b & 8 && (X = v.read_shift(4), X == 134695760 && (X = v.read_shift(4), tr = !0), z = v.read_shift(4), j = v.read_shift(4)), z != D && st(tr, "Bad compressed size: " + D + " != " + z), j != T && st(tr, "Bad uncompressed size: " + T + " != " + j), Ve(F, ke, Be, { unsafe: !0, mt: Z });
  }
  function va(v, D) {
    var T = D || {}, F = [], C = [], b = dr(1), q = T.compression ? 8 : 0, Z = 0, X = 0, z = 0, j = 0, he = 0, ve = v.FullPaths[0], ke = ve, le = v.FileIndex[0], me = [], Be = 0;
    for (X = 1; X < v.FullPaths.length; ++X)
      if (ke = v.FullPaths[X].slice(ve.length), le = v.FileIndex[X], !(!le.size || !le.content || Array.isArray(le.content) && le.content.length == 0 || ke == "Sh33tJ5")) {
        var tr = j, ir = dr(ke.length);
        for (z = 0; z < ke.length; ++z) ir.write_shift(1, ke.charCodeAt(z) & 127);
        ir = ir.slice(0, ir.l), me[he] = typeof le.content == "string" ? ui.bstr(le.content, 0) : ui.buf(
          /*::((*/
          le.content,
          0
        );
        var Dr = typeof le.content == "string" ? Gr(le.content) : le.content;
        q == 8 && (Dr = ie(Dr)), b = dr(30), b.write_shift(4, 67324752), b.write_shift(2, 20), b.write_shift(2, Z), b.write_shift(2, q), le.mt ? i(b, le.mt) : b.write_shift(4, 0), b.write_shift(-4, me[he]), b.write_shift(4, Dr.length), b.write_shift(
          4,
          /*::(*/
          le.content.length
        ), b.write_shift(2, ir.length), b.write_shift(2, 0), j += b.length, F.push(b), j += ir.length, F.push(ir), j += Dr.length, F.push(Dr), b = dr(46), b.write_shift(4, 33639248), b.write_shift(2, 0), b.write_shift(2, 20), b.write_shift(2, Z), b.write_shift(2, q), b.write_shift(4, 0), b.write_shift(-4, me[he]), b.write_shift(4, Dr.length), b.write_shift(
          4,
          /*::(*/
          le.content.length
        ), b.write_shift(2, ir.length), b.write_shift(2, 0), b.write_shift(2, 0), b.write_shift(2, 0), b.write_shift(2, 0), b.write_shift(4, 0), b.write_shift(4, tr), Be += b.l, C.push(b), Be += ir.length, C.push(ir), ++he;
      }
    return b = dr(22), b.write_shift(4, 101010256), b.write_shift(2, 0), b.write_shift(2, 0), b.write_shift(2, he), b.write_shift(2, he), b.write_shift(4, Be), b.write_shift(4, j), b.write_shift(2, 0), Ut([Ut(F), Ut(C), b]);
  }
  var xt = {
    htm: "text/html",
    xml: "text/xml",
    gif: "image/gif",
    jpg: "image/jpeg",
    png: "image/png",
    mso: "application/x-mso",
    thmx: "application/vnd.ms-officetheme",
    sh33tj5: "application/octet-stream"
  };
  function $t(v, D) {
    if (v.ctype) return v.ctype;
    var T = v.name || "", F = T.match(/\.([^\.]+)$/);
    return F && xt[F[1]] || D && (F = (T = D).match(/[\.\\]([^\.\\])+$/), F && xt[F[1]]) ? xt[F[1]] : "application/octet-stream";
  }
  function E(v) {
    for (var D = Q0(v), T = [], F = 0; F < D.length; F += 76) T.push(D.slice(F, F + 76));
    return T.join(`\r
`) + `\r
`;
  }
  function k(v) {
    var D = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7E-\xFF=]/g, function(z) {
      var j = z.charCodeAt(0).toString(16).toUpperCase();
      return "=" + (j.length == 1 ? "0" + j : j);
    });
    D = D.replace(/ $/mg, "=20").replace(/\t$/mg, "=09"), D.charAt(0) == `
` && (D = "=0D" + D.slice(1)), D = D.replace(/\r(?!\n)/mg, "=0D").replace(/\n\n/mg, `
=0A`).replace(/([^\r\n])\n/mg, "$1=0A");
    for (var T = [], F = D.split(`\r
`), C = 0; C < F.length; ++C) {
      var b = F[C];
      if (b.length == 0) {
        T.push("");
        continue;
      }
      for (var q = 0; q < b.length; ) {
        var Z = 76, X = b.slice(q, q + Z);
        X.charAt(Z - 1) == "=" ? Z-- : X.charAt(Z - 2) == "=" ? Z -= 2 : X.charAt(Z - 3) == "=" && (Z -= 3), X = b.slice(q, q + Z), q += Z, q < b.length && (X += "="), T.push(X);
      }
    }
    return T.join(`\r
`);
  }
  function B(v) {
    for (var D = [], T = 0; T < v.length; ++T) {
      for (var F = v[T]; T <= v.length && F.charAt(F.length - 1) == "="; ) F = F.slice(0, F.length - 1) + v[++T];
      D.push(F);
    }
    for (var C = 0; C < D.length; ++C) D[C] = D[C].replace(/[=][0-9A-Fa-f]{2}/g, function(b) {
      return String.fromCharCode(parseInt(b.slice(1), 16));
    });
    return Gr(D.join(`\r
`));
  }
  function Q(v, D, T) {
    for (var F = "", C = "", b = "", q, Z = 0; Z < 10; ++Z) {
      var X = D[Z];
      if (!X || X.match(/^\s*$/)) break;
      var z = X.match(/^([^:]*?):\s*([^\s].*)$/);
      if (z) switch (z[1].toLowerCase()) {
        case "content-location":
          F = z[2].trim();
          break;
        case "content-type":
          b = z[2].trim();
          break;
        case "content-transfer-encoding":
          C = z[2].trim();
          break;
      }
    }
    switch (++Z, C.toLowerCase()) {
      case "base64":
        q = Gr(qr(D.slice(Z).join("")));
        break;
      case "quoted-printable":
        q = B(D.slice(Z));
        break;
      default:
        throw new Error("Unsupported Content-Transfer-Encoding " + C);
    }
    var j = Ve(v, F.slice(T.length), q, { unsafe: !0 });
    b && (j.ctype = b);
  }
  function ge(v, D) {
    if (ce(v.slice(0, 13)).toLowerCase() != "mime-version:") throw new Error("Unsupported MAD header");
    var T = D && D.root || "", F = (Xe && Buffer.isBuffer(v) ? v.toString("binary") : ce(v)).split(`\r
`), C = 0, b = "";
    for (C = 0; C < F.length; ++C)
      if (b = F[C], !!/^Content-Location:/i.test(b) && (b = b.slice(b.indexOf("file")), T || (T = b.slice(0, b.lastIndexOf("/") + 1)), b.slice(0, T.length) != T))
        for (; T.length > 0 && (T = T.slice(0, T.length - 1), T = T.slice(0, T.lastIndexOf("/") + 1), b.slice(0, T.length) != T); )
          ;
    var q = (F[1] || "").match(/boundary="(.*?)"/);
    if (!q) throw new Error("MAD cannot find boundary");
    var Z = "--" + (q[1] || ""), X = [], z = [], j = {
      FileIndex: X,
      FullPaths: z
    };
    I(j);
    var he, ve = 0;
    for (C = 0; C < F.length; ++C) {
      var ke = F[C];
      ke !== Z && ke !== Z + "--" || (ve++ && Q(j, F.slice(he, C), T), he = C);
    }
    return j;
  }
  function ye(v, D) {
    var T = D || {}, F = T.boundary || "SheetJS";
    F = "------=" + F;
    for (var C = [
      "MIME-Version: 1.0",
      'Content-Type: multipart/related; boundary="' + F.slice(2) + '"',
      "",
      "",
      ""
    ], b = v.FullPaths[0], q = b, Z = v.FileIndex[0], X = 1; X < v.FullPaths.length; ++X)
      if (q = v.FullPaths[X].slice(b.length), Z = v.FileIndex[X], !(!Z.size || !Z.content || q == "Sh33tJ5")) {
        q = q.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7E-\xFF]/g, function(Be) {
          return "_x" + Be.charCodeAt(0).toString(16) + "_";
        }).replace(/[\u0080-\uFFFF]/g, function(Be) {
          return "_u" + Be.charCodeAt(0).toString(16) + "_";
        });
        for (var z = Z.content, j = Xe && Buffer.isBuffer(z) ? z.toString("binary") : ce(z), he = 0, ve = Math.min(1024, j.length), ke = 0, le = 0; le <= ve; ++le) (ke = j.charCodeAt(le)) >= 32 && ke < 128 && ++he;
        var me = he >= ve * 4 / 5;
        C.push(F), C.push("Content-Location: " + (T.root || "file:///C:/SheetJS/") + q), C.push("Content-Transfer-Encoding: " + (me ? "quoted-printable" : "base64")), C.push("Content-Type: " + $t(Z, q)), C.push(""), C.push(me ? k(j) : E(j));
      }
    return C.push(F + `--\r
`), C.join(`\r
`);
  }
  function xe(v) {
    var D = {};
    return I(D, v), D;
  }
  function Ve(v, D, T, F) {
    var C = F && F.unsafe;
    C || I(v);
    var b = !C && je.find(v, D);
    if (!b) {
      var q = v.FullPaths[0];
      D.slice(0, q.length) == q ? q = D : (q.slice(-1) != "/" && (q += "/"), q = (q + D).replace("//", "/")), b = { name: n(D), type: 2 }, v.FileIndex.push(b), v.FullPaths.push(q), C || je.utils.cfb_gc(v);
    }
    return b.content = T, b.size = T ? T.length : 0, F && (F.CLSID && (b.clsid = F.CLSID), F.mt && (b.mt = F.mt), F.ct && (b.ct = F.ct)), b;
  }
  function Me(v, D) {
    I(v);
    var T = je.find(v, D);
    if (T) {
      for (var F = 0; F < v.FileIndex.length; ++F) if (v.FileIndex[F] == T)
        return v.FileIndex.splice(F, 1), v.FullPaths.splice(F, 1), !0;
    }
    return !1;
  }
  function U(v, D, T) {
    I(v);
    var F = je.find(v, D);
    if (F) {
      for (var C = 0; C < v.FileIndex.length; ++C) if (v.FileIndex[C] == F)
        return v.FileIndex[C].name = n(T), v.FullPaths[C] = T, !0;
    }
    return !1;
  }
  function ne(v) {
    A(v, !0);
  }
  return t.find = R, t.read = W, t.parse = o, t.write = re, t.writeFile = oe, t.utils = {
    cfb_new: xe,
    cfb_add: Ve,
    cfb_del: Me,
    cfb_mov: U,
    cfb_gc: ne,
    ReadShift: Pa,
    CheckField: ic,
    prep_blob: xr,
    bconcat: Ut,
    use_zlib: be,
    _deflateRaw: Kr,
    _inflateRaw: Lt,
    consts: Y
  }, t;
})(), Zu;
function Qu(e) {
  if (typeof Deno < "u") return Deno.readFileSync(e);
  if (typeof $ < "u" && typeof File < "u" && typeof Folder < "u") try {
    var t = File(e);
    t.open("r"), t.encoding = "binary";
    var r = t.read();
    return t.close(), r;
  } catch (a) {
    if (!a.message || a.message.indexOf("onstruct") == -1) throw a;
  }
  throw new Error("Cannot access file " + e);
}
function br(e) {
  for (var t = Object.keys(e), r = [], a = 0; a < t.length; ++a) Object.prototype.hasOwnProperty.call(e, t[a]) && r.push(t[a]);
  return r;
}
function I0(e) {
  for (var t = [], r = br(e), a = 0; a !== r.length; ++a) t[e[r[a]]] = r[a];
  return t;
}
var Rs = /* @__PURE__ */ Date.UTC(1899, 11, 30, 0, 0, 0), ef = /* @__PURE__ */ Date.UTC(1899, 11, 31, 0, 0, 0), rf = /* @__PURE__ */ Date.UTC(1904, 0, 1, 0, 0, 0);
function mr(e, t) {
  var r = /* @__PURE__ */ e.getTime(), a = (r - Rs) / (1440 * 60 * 1e3);
  return t ? (a -= 1462, a < -1402 ? a - 1 : a) : a < 60 ? a - 1 : a;
}
function Vt(e) {
  if (e >= 60 && e < 61) return e;
  var t = /* @__PURE__ */ new Date();
  return t.setTime((e > 60 ? e : e + 1) * 24 * 60 * 60 * 1e3 + Rs), t;
}
function tf(e) {
  var t = 0, r = 0, a = !1, n = e.match(/P([0-9\.]+Y)?([0-9\.]+M)?([0-9\.]+D)?T([0-9\.]+H)?([0-9\.]+M)?([0-9\.]+S)?/);
  if (!n) throw new Error("|" + e + "| is not an ISO8601 Duration");
  for (var i = 1; i != n.length; ++i)
    if (n[i]) {
      switch (r = 1, i > 3 && (a = !0), n[i].slice(n[i].length - 1)) {
        case "Y":
          throw new Error("Unsupported ISO Duration Field: " + n[i].slice(n[i].length - 1));
        case "D":
          r *= 24;
        /* falls through */
        case "H":
          r *= 60;
        /* falls through */
        case "M":
          if (a) r *= 60;
          else throw new Error("Unsupported ISO Duration Field: M");
      }
      t += r * parseInt(n[i], 10);
    }
  return t;
}
var af = /^(\d+):(\d+)(:\d+)?(\.\d+)?$/, nf = /^(\d+)-(\d+)-(\d+)$/, Bs = /^(\d+)-(\d+)-(\d+)[T ](\d+):(\d+)(:\d+)?(\.\d+)?$/;
function kr(e, t) {
  if (e instanceof Date) return e;
  var r = e.match(af);
  if (r) return new Date((t ? rf : ef) + ((parseInt(r[1], 10) * 60 + parseInt(r[2], 10)) * 60 + (r[3] ? parseInt(r[3].slice(1), 10) : 0)) * 1e3 + (r[4] ? parseInt((r[4] + "000").slice(1, 4), 10) : 0));
  if (r = e.match(nf), r) return new Date(Date.UTC(+r[1], +r[2] - 1, +r[3], 0, 0, 0, 0));
  if (r = e.match(Bs), r) return new Date(Date.UTC(+r[1], +r[2] - 1, +r[3], +r[4], +r[5], r[6] && parseInt(r[6].slice(1), 10) || 0, r[7] && parseInt((r[7] + "0000").slice(1, 4), 10) || 0));
  var a = new Date(e);
  return a;
}
function ia(e, t) {
  if (Xe && Buffer.isBuffer(e)) {
    if (t && $a) {
      if (e[0] == 255 && e[1] == 254) return La(e.slice(2).toString("utf16le"));
      if (e[1] == 254 && e[2] == 255) return La(Fs(e.slice(2).toString("binary")));
    }
    return e.toString("binary");
  }
  if (typeof TextDecoder < "u") try {
    if (t) {
      if (e[0] == 255 && e[1] == 254) return La(new TextDecoder("utf-16le").decode(e.slice(2)));
      if (e[0] == 254 && e[1] == 255) return La(new TextDecoder("utf-16be").decode(e.slice(2)));
    }
    var r = {
      "€": "",
      "‚": "",
      ƒ: "",
      "„": "",
      "…": "",
      "†": "",
      "‡": "",
      "ˆ": "",
      "‰": "",
      Š: "",
      "‹": "",
      Œ: "",
      Ž: "",
      "‘": "",
      "’": "",
      "“": "",
      "”": "",
      "•": "",
      "–": "",
      "—": "",
      "˜": "",
      "™": "",
      š: "",
      "›": "",
      œ: "",
      ž: "",
      Ÿ: ""
    };
    return Array.isArray(e) && (e = new Uint8Array(e)), new TextDecoder("latin1").decode(e).replace(/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, function(i) {
      return r[i] || i;
    });
  } catch {
  }
  var a = [], n = 0;
  try {
    for (n = 0; n < e.length - 65536; n += 65536) a.push(String.fromCharCode.apply(0, e.slice(n, n + 65536)));
    a.push(String.fromCharCode.apply(0, e.slice(n)));
  } catch {
    try {
      for (; n < e.length - 16384; n += 16384) a.push(String.fromCharCode.apply(0, e.slice(n, n + 16384)));
      a.push(String.fromCharCode.apply(0, e.slice(n)));
    } catch {
      for (; n != e.length; ++n) a.push(String.fromCharCode(e[n]));
    }
  }
  return a.join("");
}
function Ze(e) {
  if (typeof JSON < "u" && !Array.isArray(e)) return JSON.parse(JSON.stringify(e));
  if (typeof e != "object" || e == null) return e;
  if (e instanceof Date) return new Date(e.getTime());
  var t = {};
  for (var r in e) Object.prototype.hasOwnProperty.call(e, r) && (t[r] = Ze(e[r]));
  return t;
}
function $e(e, t) {
  for (var r = ""; r.length < t; ) r += e;
  return r;
}
function zr(e) {
  var t = Number(e);
  if (!isNaN(t)) return isFinite(t) ? t : NaN;
  if (!/\d/.test(e)) return t;
  var r = 1, a = e.replace(/([\d]),([\d])/g, "$1$2").replace(/[$]/g, "").replace(/[%]/g, function() {
    return r *= 100, "";
  });
  return !isNaN(t = Number(a)) || (a = a.replace(/[(]([^()]*)[)]/, function(n, i) {
    return r = -r, i;
  }), !isNaN(t = Number(a))) ? t / r : t;
}
var sf = /^(0?\d|1[0-2])(?:|:([0-5]?\d)(?:|(\.\d+)(?:|:([0-5]?\d))|:([0-5]?\d)(|\.\d+)))\s+([ap])m?$/, cf = /^([01]?\d|2[0-3])(?:|:([0-5]?\d)(?:|(\.\d+)(?:|:([0-5]?\d))|:([0-5]?\d)(|\.\d+)))$/, uf = /^(\d+)-(\d+)-(\d+)[T ](\d+):(\d+)(:\d+)(\.\d+)?[Z]?$/, ff = (/* @__PURE__ */ new Date("6/9/69 00:00 UTC")).valueOf() == -177984e5;
function of(e) {
  return e[2] ? e[3] ? e[4] ? new Date(Date.UTC(1899, 11, 31, +e[1] % 12 + (e[7] == "p" ? 12 : 0), +e[2], +e[4], parseFloat(e[3]) * 1e3)) : new Date(Date.UTC(1899, 11, 31, e[7] == "p" ? 12 : 0, +e[1], +e[2], parseFloat(e[3]) * 1e3)) : e[5] ? new Date(Date.UTC(1899, 11, 31, +e[1] % 12 + (e[7] == "p" ? 12 : 0), +e[2], +e[5], e[6] ? parseFloat(e[6]) * 1e3 : 0)) : new Date(Date.UTC(1899, 11, 31, +e[1] % 12 + (e[7] == "p" ? 12 : 0), +e[2], 0, 0)) : new Date(Date.UTC(1899, 11, 31, +e[1] % 12 + (e[7] == "p" ? 12 : 0), 0, 0, 0));
}
function lf(e) {
  return e[2] ? e[3] ? e[4] ? new Date(Date.UTC(1899, 11, 31, +e[1], +e[2], +e[4], parseFloat(e[3]) * 1e3)) : new Date(Date.UTC(1899, 11, 31, 0, +e[1], +e[2], parseFloat(e[3]) * 1e3)) : e[5] ? new Date(Date.UTC(1899, 11, 31, +e[1], +e[2], +e[5], e[6] ? parseFloat(e[6]) * 1e3 : 0)) : new Date(Date.UTC(1899, 11, 31, +e[1], +e[2], 0, 0)) : new Date(Date.UTC(1899, 11, 31, +e[1], 0, 0, 0));
}
var hf = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function Ka(e) {
  if (uf.test(e)) return e.indexOf("Z") == -1 ? Hn(new Date(e)) : new Date(e);
  var t = e.toLowerCase(), r = t.replace(/\s+/g, " ").trim(), a = r.match(sf);
  if (a) return of(a);
  if (a = r.match(cf), a) return lf(a);
  if (a = r.match(Bs), a) return new Date(Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], a[6] && parseInt(a[6].slice(1), 10) || 0, a[7] && parseInt((a[7] + "0000").slice(1, 4), 10) || 0));
  var n = new Date(ff && e.indexOf("UTC") == -1 ? e + " UTC" : e), i = /* @__PURE__ */ new Date(NaN), c = n.getYear();
  n.getMonth();
  var s = n.getDate();
  if (isNaN(s)) return i;
  if (t.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/)) {
    if (t = t.replace(/[^a-z]/g, "").replace(/([^a-z]|^)[ap]m?([^a-z]|$)/, ""), t.length > 3 && hf.indexOf(t) == -1) return i;
  } else if (t.replace(/[ap]m?/, "").match(/[a-z]/)) return i;
  return c < 0 || c > 8099 || e.match(/[^-0-9:,\/\\\ ]/) ? i : n;
}
var df = /* @__PURE__ */ (function() {
  var e = "abacaba".split(/(:?b)/i).length == 5;
  return function(r, a, n) {
    if (e || typeof a == "string") return r.split(a);
    for (var i = r.split(a), c = [i[0]], s = 1; s < i.length; ++s)
      c.push(n), c.push(i[s]);
    return c;
  };
})();
function sa(e) {
  return new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), e.getUTCHours(), e.getUTCMinutes(), e.getUTCSeconds(), e.getUTCMilliseconds());
}
function Hn(e) {
  return new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate(), e.getHours(), e.getMinutes(), e.getSeconds(), e.getMilliseconds()));
}
function N0(e) {
  var t = e.slice(0, 1024), r = t.indexOf("<!DOCTYPE");
  if (r == -1) return e;
  var a = e.match(/<[\w]/);
  return a ? e.slice(0, r) + e.slice(a.index) : e;
}
function Ct(e, t, r) {
  for (var a = [], n = e.indexOf(t); n > -1; ) {
    var i = e.indexOf(r, n + t.length);
    if (i == -1) break;
    a.push(e.slice(n, i + r.length)), n = e.indexOf(t, i + r.length);
  }
  return a.length > 0 ? a : null;
}
function an(e, t, r) {
  var a = [], n = 0, i = e.indexOf(t);
  if (i == -1) return e;
  for (; i > -1; ) {
    a.push(e.slice(n, i));
    var c = e.indexOf(r, i + t.length);
    if (c == -1) break;
    (i = e.indexOf(t, n = c + r.length)) == -1 && a.push(e.slice(n));
  }
  return a.join("");
}
var xf = { " ": 1, "	": 1, "\r": 1, "\n": 1, ">": 1 };
function ea(e, t) {
  for (var r = e.indexOf("<" + t), a = t.length + 1, n = e.length; r >= 0 && r <= n - a && !xf[e.charAt(r + a)]; ) r = e.indexOf("<" + t, r + 1);
  if (r === -1) return null;
  var i = e.indexOf(">", r + t.length);
  if (i === -1) return null;
  var c = "</" + t + ">", s = e.indexOf(c, i);
  return s == -1 ? null : [e.slice(r, s + c.length), e.slice(i + 1, s)];
}
var Ye = /* @__PURE__ */ (function() {
  var e = {};
  return function(r, a) {
    var n = e[a];
    n || (e[a] = n = [
      new RegExp("<(?:\\w+:)?" + a + "\\b[^<>]*>", "g"),
      new RegExp("</(?:\\w+:)?" + a + ">", "g")
    ]), n[0].lastIndex = n[1].lastIndex = 0;
    var i = n[0].exec(r);
    if (!i) return null;
    var c = i.index, s = n[0].lastIndex;
    if (n[1].lastIndex = n[0].lastIndex, i = n[1].exec(r), !i) return null;
    var u = i.index, f = n[1].lastIndex;
    return [r.slice(c, f), r.slice(s, u)];
  };
})(), Ls = /* @__PURE__ */ (function() {
  var e = {};
  return function(r, a) {
    var n = [], i = e[a];
    i || (e[a] = i = [
      new RegExp("<(?:\\w+:)?" + a + "\\b[^<>]*>", "g"),
      new RegExp("</(?:\\w+:)?" + a + ">", "g")
    ]), i[0].lastIndex = i[1].lastIndex = 0;
    for (var c; c = i[0].exec(r); ) {
      var s = c.index;
      if (i[1].lastIndex = i[0].lastIndex, c = i[1].exec(r), !c) return null;
      var u = i[1].lastIndex;
      n.push(r.slice(s, u)), i[0].lastIndex = i[1].lastIndex;
    }
    return n.length == 0 ? null : n;
  };
})(), pf = /* @__PURE__ */ (function() {
  var e = {};
  return function(r, a) {
    var n = [], i = e[a];
    i || (e[a] = i = [
      new RegExp("<(?:\\w+:)?" + a + "\\b[^<>]*>", "g"),
      new RegExp("</(?:\\w+:)?" + a + ">", "g")
    ]), i[0].lastIndex = i[1].lastIndex = 0;
    for (var c, s = 0, u = 0; c = i[0].exec(r); ) {
      if (s = c.index, n.push(r.slice(u, s)), u = s, i[1].lastIndex = i[0].lastIndex, c = i[1].exec(r), !c) return null;
      u = i[1].lastIndex, i[0].lastIndex = i[1].lastIndex;
    }
    return n.push(r.slice(u)), n.length == 0 ? "" : n.join("");
  };
})(), vf = /* @__PURE__ */ (function() {
  var e = {};
  return function(r, a) {
    var n = [], i = e[a];
    i || (e[a] = i = [
      new RegExp("<" + a + "\\b[^<>]*>", "ig"),
      new RegExp("</" + a + ">", "ig")
    ]), i[0].lastIndex = i[1].lastIndex = 0;
    for (var c; c = i[0].exec(r); ) {
      var s = c.index;
      if (i[1].lastIndex = i[0].lastIndex, c = i[1].exec(r), !c) return null;
      var u = i[1].lastIndex;
      n.push(r.slice(s, u)), i[0].lastIndex = i[1].lastIndex;
    }
    return n.length == 0 ? null : n;
  };
})();
function Ms(e) {
  return e ? e.content && e.type ? ia(e.content, !0) : e.data ? Ra(e.data) : e.asNodeBuffer && Xe ? Ra(e.asNodeBuffer().toString("binary")) : e.asBinary ? Ra(e.asBinary()) : e._data && e._data.getContent ? Ra(ia(Array.prototype.slice.call(e._data.getContent(), 0))) : null : null;
}
function Ps(e) {
  if (!e) return null;
  if (e.data) return J0(e.data);
  if (e.asNodeBuffer && Xe) return e.asNodeBuffer();
  if (e._data && e._data.getContent) {
    var t = e._data.getContent();
    return typeof t == "string" ? J0(t) : Array.prototype.slice.call(t);
  }
  return e.content && e.type ? e.content : null;
}
function gf(e) {
  return e && e.name.slice(-4) === ".bin" ? Ps(e) : Ms(e);
}
function et(e, t) {
  for (var r = e.FullPaths || br(e.files), a = t.toLowerCase().replace(/[\/]/g, "\\"), n = a.replace(/\\/g, "/"), i = 0; i < r.length; ++i) {
    var c = r[i].replace(/^Root Entry[\/]/, "").toLowerCase();
    if (a == c || n == c) return e.files ? e.files[r[i]] : e.FileIndex[i];
  }
  return null;
}
function O0(e, t) {
  var r = et(e, t);
  if (r == null) throw new Error("Cannot find file " + t + " in zip");
  return r;
}
function lr(e, t, r) {
  if (!r) return gf(O0(e, t));
  if (!t) return null;
  try {
    return lr(e, t);
  } catch {
    return null;
  }
}
function gr(e, t, r) {
  if (!r) return Ms(O0(e, t));
  if (!t) return null;
  try {
    return gr(e, t);
  } catch {
    return null;
  }
}
function R0(e, t, r) {
  if (!r) return Ps(O0(e, t));
  if (!t) return null;
  try {
    return R0(e, t);
  } catch {
    return null;
  }
}
function fi(e) {
  for (var t = e.FullPaths || br(e.files), r = [], a = 0; a < t.length; ++a) t[a].slice(-1) != "/" && r.push(t[a].replace(/^Root Entry[\/]/, ""));
  return r.sort();
}
function mf(e, t, r) {
  if (e.FullPaths) {
    if (Array.isArray(r) && typeof r[0] == "string" && (r = r.join("")), typeof r == "string") {
      var a;
      return Xe ? a = zt(r) : a = ku(r), je.utils.cfb_add(e, t, a);
    }
    je.utils.cfb_add(e, t, r);
  } else e.file(t, r);
}
function Us(e, t) {
  switch (t.type) {
    case "base64":
      return je.read(e, { type: "base64" });
    case "binary":
      return je.read(e, { type: "binary" });
    case "buffer":
    case "array":
      return je.read(e, { type: "buffer" });
  }
  throw new Error("Unrecognized type " + t.type);
}
function Tt(e, t) {
  if (e.charAt(0) == "/") return e.slice(1);
  var r = t.split("/");
  t.slice(-1) != "/" && r.pop();
  for (var a = e.split("/"); a.length !== 0; ) {
    var n = a.shift();
    n === ".." ? r.pop() : n !== "." && r.push(n);
  }
  return r.join("/");
}
var Hs = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
`, Vs = /\s([^"\s?>\/]+)\s*=\s*((?:")([^"]*)(?:")|(?:')([^']*)(?:')|([^'">\s]+))/g, oi = /<[\/\?]?[a-zA-Z0-9:_-]+(?:\s+[^"\s?<>\/]+\s*=\s*(?:"[^"]*"|'[^']*'|[^'"<>\s=]+))*\s*[\/\?]?>/mg, _f = /<[^<>]*>/g, pr = /* @__PURE__ */ Hs.match(oi) ? oi : _f, Ef = /<\w*:/, wf = /<(\/?)\w+:/;
function Ee(e, t, r) {
  for (var a = {}, n = 0, i = 0; n !== e.length && !((i = e.charCodeAt(n)) === 32 || i === 10 || i === 13); ++n) ;
  if (t || (a[0] = e.slice(0, n)), n === e.length) return a;
  var c = e.match(Vs), s = 0, u = "", f = 0, o = "", l = "", x = 1;
  if (c) for (f = 0; f != c.length; ++f) {
    for (l = c[f].slice(1), i = 0; i != l.length && l.charCodeAt(i) !== 61; ++i) ;
    for (o = l.slice(0, i).trim(); l.charCodeAt(i + 1) == 32; ) ++i;
    for (x = (n = l.charCodeAt(i + 1)) == 34 || n == 39 ? 1 : 0, u = l.slice(i + 1 + x, l.length - x), s = 0; s != o.length && o.charCodeAt(s) !== 58; ++s) ;
    if (s === o.length)
      o.indexOf("_") > 0 && (o = o.slice(0, o.indexOf("_"))), a[o] = u, a[o.toLowerCase()] = u;
    else {
      var h = (s === 5 && o.slice(0, 5) === "xmlns" ? "xmlns" : "") + o.slice(s + 1);
      if (a[h] && o.slice(s - 3, s) == "ext") continue;
      a[h] = u, a[h.toLowerCase()] = u;
    }
  }
  return a;
}
function Af(e, t, r) {
  for (var a = {}, n = 0, i = 0; n !== e.length && !((i = e.charCodeAt(n)) === 32 || i === 10 || i === 13); ++n) ;
  if (n === e.length) return a;
  var c = e.match(Vs), s = "", u = 0, f = "", o = "", l = 1;
  if (c) for (u = 0; u != c.length; ++u) {
    for (o = c[u].slice(1), i = 0; i != o.length && o.charCodeAt(i) !== 61; ++i) ;
    for (f = o.slice(0, i).trim(); o.charCodeAt(i + 1) == 32; ) ++i;
    l = (n = o.charCodeAt(i + 1)) == 34 || n == 39 ? 1 : 0, s = o.slice(i + 1 + l, o.length - l), f.indexOf("_") > 0 && (f = f.slice(0, f.indexOf("_"))), a[f] = s, a[f.toLowerCase()] = s;
  }
  return a;
}
function Lr(e) {
  return e.replace(wf, "<$1");
}
var Ws = {
  "&quot;": '"',
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&amp;": "&"
}, Gs = /* @__PURE__ */ I0(Ws), Ue = /* @__PURE__ */ (function() {
  var e = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/ig, t = /_x([\da-fA-F]{4})_/g;
  function r(a) {
    var n = a + "", i = n.indexOf("<![CDATA[");
    if (i == -1) return n.replace(e, function(s, u) {
      return Ws[s] || String.fromCharCode(parseInt(u, s.indexOf("x") > -1 ? 16 : 10)) || s;
    }).replace(t, function(s, u) {
      return String.fromCharCode(parseInt(u, 16));
    });
    var c = n.indexOf("]]>");
    return r(n.slice(0, i)) + n.slice(i + 9, c) + r(n.slice(c + 3));
  }
  return function(n, i) {
    var c = r(n);
    return i ? c.replace(/\r\n/g, `
`) : c;
  };
})(), Xs = /[&<>'"]/g, Tf = /[\u0000-\u0008\u000b-\u001f\uFFFE-\uFFFF]/g;
function Ff(e) {
  var t = e + "";
  return t.replace(Xs, function(r) {
    return Gs[r];
  }).replace(Tf, function(r) {
    return "_x" + ("000" + r.charCodeAt(0).toString(16)).slice(-4) + "_";
  });
}
var kf = /[\u0000-\u001f]/g;
function Ft(e) {
  var t = e + "";
  return t.replace(Xs, function(r) {
    return Gs[r];
  }).replace(/\n/g, "<br/>").replace(kf, function(r) {
    return "&#x" + ("000" + r.charCodeAt(0).toString(16)).slice(-4) + ";";
  });
}
var li = /* @__PURE__ */ (function() {
  var e = /&#(\d+);/g;
  function t(r, a) {
    return String.fromCharCode(parseInt(a, 10));
  }
  return function(a) {
    return a.replace(e, t);
  };
})();
function Re(e) {
  switch (e) {
    case 1:
    case !0:
    case "1":
    case "true":
      return !0;
    case 0:
    case !1:
    case "0":
    case "false":
      return !1;
  }
  return !1;
}
function Qn(e) {
  for (var t = "", r = 0, a = 0, n = 0, i = 0, c = 0, s = 0; r < e.length; ) {
    if (a = e.charCodeAt(r++), a < 128) {
      t += String.fromCharCode(a);
      continue;
    }
    if (n = e.charCodeAt(r++), a > 191 && a < 224) {
      c = (a & 31) << 6, c |= n & 63, t += String.fromCharCode(c);
      continue;
    }
    if (i = e.charCodeAt(r++), a < 240) {
      t += String.fromCharCode((a & 15) << 12 | (n & 63) << 6 | i & 63);
      continue;
    }
    c = e.charCodeAt(r++), s = ((a & 7) << 18 | (n & 63) << 12 | (i & 63) << 6 | c & 63) - 65536, t += String.fromCharCode(55296 + (s >>> 10 & 1023)), t += String.fromCharCode(56320 + (s & 1023));
  }
  return t;
}
function hi(e) {
  var t = Gt(2 * e.length), r, a, n = 1, i = 0, c = 0, s;
  for (a = 0; a < e.length; a += n)
    n = 1, (s = e.charCodeAt(a)) < 128 ? r = s : s < 224 ? (r = (s & 31) * 64 + (e.charCodeAt(a + 1) & 63), n = 2) : s < 240 ? (r = (s & 15) * 4096 + (e.charCodeAt(a + 1) & 63) * 64 + (e.charCodeAt(a + 2) & 63), n = 3) : (n = 4, r = (s & 7) * 262144 + (e.charCodeAt(a + 1) & 63) * 4096 + (e.charCodeAt(a + 2) & 63) * 64 + (e.charCodeAt(a + 3) & 63), r -= 65536, c = 55296 + (r >>> 10 & 1023), r = 56320 + (r & 1023)), c !== 0 && (t[i++] = c & 255, t[i++] = c >>> 8, c = 0), t[i++] = r % 256, t[i++] = r >>> 8;
  return t.slice(0, i).toString("ucs2");
}
function di(e) {
  return zt(e, "binary").toString("utf8");
}
var dn = "foo bar bazâð£", Qe = /* @__PURE__ */ (function() {
  if (Xe) {
    if (di(dn) == Qn(dn)) return di;
    if (hi(dn) == Qn(dn)) return hi;
  }
  return Qn;
})(), La = Xe ? function(e) {
  return zt(e, "utf8").toString("binary");
} : function(e) {
  for (var t = [], r = 0, a = 0, n = 0; r < e.length; )
    switch (a = e.charCodeAt(r++), !0) {
      case a < 128:
        t.push(String.fromCharCode(a));
        break;
      case a < 2048:
        t.push(String.fromCharCode(192 + (a >> 6))), t.push(String.fromCharCode(128 + (a & 63)));
        break;
      case (a >= 55296 && a < 57344):
        a -= 55296, n = e.charCodeAt(r++) - 56320 + (a << 10), t.push(String.fromCharCode(240 + (n >> 18 & 7))), t.push(String.fromCharCode(144 + (n >> 12 & 63))), t.push(String.fromCharCode(128 + (n >> 6 & 63))), t.push(String.fromCharCode(128 + (n & 63)));
        break;
      default:
        t.push(String.fromCharCode(224 + (a >> 12))), t.push(String.fromCharCode(128 + (a >> 6 & 63))), t.push(String.fromCharCode(128 + (a & 63)));
    }
  return t.join("");
}, zs = /* @__PURE__ */ (function() {
  var e = [
    ["nbsp", " "],
    ["middot", "·"],
    ["quot", '"'],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["amp", "&"]
  ].map(function(t) {
    return [new RegExp("&" + t[0] + ";", "ig"), t[1]];
  });
  return function(r) {
    for (var a = r.replace(/^[\t\n\r ]+/, "").replace(/(^|[^\t\n\r ])[\t\n\r ]+$/, "$1").replace(/>\s+/g, ">").replace(/\b\s+</g, "<").replace(/[\t\n\r ]+/g, " ").replace(/<\s*[bB][rR]\s*\/?>/g, `
`).replace(/<[^<>]*>/g, ""), n = 0; n < e.length; ++n) a = a.replace(e[n][0], e[n][1]);
    return a;
  };
})(), Df = /<\/?(?:vt:)?variant>/g, Cf = /<(?:vt:)([^<"'>]*)>([\s\S]*)</;
function xi(e, t) {
  var r = Ee(e), a = Ls(e, r.baseType) || [], n = [];
  if (a.length != r.size) {
    if (t.WTF) throw new Error("unexpected vector length " + a.length + " != " + r.size);
    return n;
  }
  return a.forEach(function(i) {
    var c = i.replace(Df, "").match(Cf);
    c && n.push({ v: Qe(c[2]), t: c[1] });
  }), n;
}
var yf = /(^\s|\s$|\n)/;
function Sf(e) {
  return br(e).map(function(t) {
    return " " + t + '="' + e[t] + '"';
  }).join("");
}
function Nn(e, t, r) {
  return "<" + e + (r != null ? Sf(r) : "") + (t != null ? (t.match(yf) ? ' xml:space="preserve"' : "") + ">" + t + "</" + e : "/") + ">";
}
function Vn(e) {
  if (Xe && /*::typeof Buffer !== "undefined" && d != null && d instanceof Buffer &&*/
  Buffer.isBuffer(e)) return e.toString("utf8");
  if (typeof e == "string") return e;
  if (typeof Uint8Array < "u" && e instanceof Uint8Array) return Qe(It(y0(e)));
  throw new Error("Bad input format: expected Buffer or string");
}
var hr = /<([\/]?)([^\s?><!\/:"]*:|)([^\s?<>:\/"]+)(?:\s+[^<>=?"'\s]+="[^"]*?")*\s*[\/]?>/mg, bf = {
  CT: "http://schemas.openxmlformats.org/package/2006/content-types"
}, If = [
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
  "http://schemas.microsoft.com/office/excel/2006/main",
  "http://schemas.microsoft.com/office/excel/2006/2"
];
function Nf(e, t) {
  for (var r = 1 - 2 * (e[t + 7] >>> 7), a = ((e[t + 7] & 127) << 4) + (e[t + 6] >>> 4 & 15), n = e[t + 6] & 15, i = 5; i >= 0; --i) n = n * 256 + e[t + i];
  return a == 2047 ? n == 0 ? r * (1 / 0) : NaN : (a == 0 ? a = -1022 : (a -= 1023, n += Math.pow(2, 52)), r * Math.pow(2, a - 52) * n);
}
function Of(e, t, r) {
  var a = (t < 0 || 1 / t == -1 / 0 ? 1 : 0) << 7, n = 0, i = 0, c = a ? -t : t;
  isFinite(c) ? c == 0 ? n = i = 0 : (n = Math.floor(Math.log(c) / Math.LN2), i = c * Math.pow(2, 52 - n), n <= -1023 && (!isFinite(i) || i < Math.pow(2, 52)) ? n = -1022 : (i -= Math.pow(2, 52), n += 1023)) : (n = 2047, i = isNaN(t) ? 26985 : 0);
  for (var s = 0; s <= 5; ++s, i /= 256) e[r + s] = i & 255;
  e[r + 6] = (n & 15) << 4 | i & 15, e[r + 7] = n >> 4 | a;
}
var pi = function(e) {
  for (var t = [], r = 10240, a = 0; a < e[0].length; ++a) if (e[0][a]) for (var n = 0, i = e[0][a].length; n < i; n += r) t.push.apply(t, e[0][a].slice(n, n + r));
  return t;
}, vi = Xe ? function(e) {
  return e[0].length > 0 && Buffer.isBuffer(e[0][0]) ? Buffer.concat(e[0].map(function(t) {
    return Buffer.isBuffer(t) ? t : zt(t);
  })) : pi(e);
} : pi, gi = function(e, t, r) {
  for (var a = [], n = t; n < r; n += 2) a.push(String.fromCharCode(kt(e, n)));
  return a.join("").replace(Pr, "");
}, B0 = Xe ? function(e, t, r) {
  return !Buffer.isBuffer(e) || !$a ? gi(e, t, r) : e.toString("utf16le", t, r).replace(Pr, "");
} : gi, mi = function(e, t, r) {
  for (var a = [], n = t; n < t + r; ++n) a.push(("0" + e[n].toString(16)).slice(-2));
  return a.join("");
}, qs = Xe ? function(e, t, r) {
  return Buffer.isBuffer(e) ? e.toString("hex", t, t + r) : mi(e, t, r);
} : mi, _i = function(e, t, r) {
  for (var a = [], n = t; n < r; n++) a.push(String.fromCharCode(_a(e, n)));
  return a.join("");
}, nn = Xe ? function(t, r, a) {
  return Buffer.isBuffer(t) ? t.toString("utf8", r, a) : _i(t, r, a);
} : _i, $s = function(e, t) {
  var r = Xr(e, t);
  return r > 0 ? nn(e, t + 4, t + 4 + r - 1) : "";
}, js = $s, Ks = function(e, t) {
  var r = Xr(e, t);
  return r > 0 ? nn(e, t + 4, t + 4 + r - 1) : "";
}, Ys = Ks, Js = function(e, t) {
  var r = 2 * Xr(e, t);
  return r > 0 ? nn(e, t + 4, t + 4 + r - 1) : "";
}, Zs = Js, Qs = function(t, r) {
  var a = Xr(t, r);
  return a > 0 ? B0(t, r + 4, r + 4 + a) : "";
}, ec = Qs, rc = function(e, t) {
  var r = Xr(e, t);
  return r > 0 ? nn(e, t + 4, t + 4 + r) : "";
}, tc = rc, ac = function(e, t) {
  return Nf(e, t);
}, On = ac, nc = function(t) {
  return Array.isArray(t) || typeof Uint8Array < "u" && t instanceof Uint8Array;
};
Xe && (js = function(t, r) {
  if (!Buffer.isBuffer(t)) return $s(t, r);
  var a = t.readUInt32LE(r);
  return a > 0 ? t.toString("utf8", r + 4, r + 4 + a - 1) : "";
}, Ys = function(t, r) {
  if (!Buffer.isBuffer(t)) return Ks(t, r);
  var a = t.readUInt32LE(r);
  return a > 0 ? t.toString("utf8", r + 4, r + 4 + a - 1) : "";
}, Zs = function(t, r) {
  if (!Buffer.isBuffer(t) || !$a) return Js(t, r);
  var a = 2 * t.readUInt32LE(r);
  return t.toString("utf16le", r + 4, r + 4 + a - 1);
}, ec = function(t, r) {
  if (!Buffer.isBuffer(t) || !$a) return Qs(t, r);
  var a = t.readUInt32LE(r);
  return t.toString("utf16le", r + 4, r + 4 + a);
}, tc = function(t, r) {
  if (!Buffer.isBuffer(t)) return rc(t, r);
  var a = t.readUInt32LE(r);
  return t.toString("utf8", r + 4, r + 4 + a);
}, On = function(t, r) {
  return Buffer.isBuffer(t) ? t.readDoubleLE(r) : ac(t, r);
}, nc = function(t) {
  return Buffer.isBuffer(t) || Array.isArray(t) || typeof Uint8Array < "u" && t instanceof Uint8Array;
});
var _a = function(e, t) {
  return e[t];
}, kt = function(e, t) {
  return e[t + 1] * 256 + e[t];
}, Rf = function(e, t) {
  var r = e[t + 1] * 256 + e[t];
  return r < 32768 ? r : (65535 - r + 1) * -1;
}, Xr = function(e, t) {
  return e[t + 3] * (1 << 24) + (e[t + 2] << 16) + (e[t + 1] << 8) + e[t];
}, Jt = function(e, t) {
  return e[t + 3] << 24 | e[t + 2] << 16 | e[t + 1] << 8 | e[t];
}, Bf = function(e, t) {
  return e[t] << 24 | e[t + 1] << 16 | e[t + 2] << 8 | e[t + 3];
};
function Pa(e, t) {
  var r = "", a, n, i = [], c, s, u, f;
  switch (t) {
    case "dbcs":
      if (f = this.l, Xe && Buffer.isBuffer(this) && $a) r = this.slice(this.l, this.l + 2 * e).toString("utf16le");
      else for (u = 0; u < e; ++u)
        r += String.fromCharCode(kt(this, f)), f += 2;
      e *= 2;
      break;
    case "utf8":
      r = nn(this, this.l, this.l + e);
      break;
    case "utf16le":
      e *= 2, r = B0(this, this.l, this.l + e);
      break;
    case "wstr":
      return Pa.call(this, e, "dbcs");
    /* [MS-OLEDS] 2.1.4 LengthPrefixedAnsiString */
    case "lpstr-ansi":
      r = js(this, this.l), e = 4 + Xr(this, this.l);
      break;
    case "lpstr-cp":
      r = Ys(this, this.l), e = 4 + Xr(this, this.l);
      break;
    /* [MS-OLEDS] 2.1.5 LengthPrefixedUnicodeString */
    case "lpwstr":
      r = Zs(this, this.l), e = 4 + 2 * Xr(this, this.l);
      break;
    /* [MS-OFFCRYPTO] 2.1.2 Length-Prefixed Padded Unicode String (UNICODE-LP-P4) */
    case "lpp4":
      e = 4 + Xr(this, this.l), r = ec(this, this.l), e & 2 && (e += 2);
      break;
    /* [MS-OFFCRYPTO] 2.1.3 Length-Prefixed UTF-8 String (UTF-8-LP-P4) */
    case "8lpp4":
      e = 4 + Xr(this, this.l), r = tc(this, this.l), e & 3 && (e += 4 - (e & 3));
      break;
    case "cstr":
      for (e = 0, r = ""; (c = _a(this, this.l + e++)) !== 0; ) i.push(hn(c));
      r = i.join("");
      break;
    case "_wstr":
      for (e = 0, r = ""; (c = kt(this, this.l + e)) !== 0; )
        i.push(hn(c)), e += 2;
      e += 2, r = i.join("");
      break;
    /* sbcs and dbcs support continue records in the SST way TODO codepages */
    case "dbcs-cont":
      for (r = "", f = this.l, u = 0; u < e; ++u) {
        if (this.lens && this.lens.indexOf(f) !== -1)
          return c = _a(this, f), this.l = f + 1, s = Pa.call(this, e - u, c ? "dbcs-cont" : "sbcs-cont"), i.join("") + s;
        i.push(hn(kt(this, f))), f += 2;
      }
      r = i.join(""), e *= 2;
      break;
    case "cpstr":
    /* falls through */
    case "sbcs-cont":
      for (r = "", f = this.l, u = 0; u != e; ++u) {
        if (this.lens && this.lens.indexOf(f) !== -1)
          return c = _a(this, f), this.l = f + 1, s = Pa.call(this, e - u, c ? "dbcs-cont" : "sbcs-cont"), i.join("") + s;
        i.push(hn(_a(this, f))), f += 1;
      }
      r = i.join("");
      break;
    default:
      switch (e) {
        case 1:
          return a = _a(this, this.l), this.l++, a;
        case 2:
          return a = (t === "i" ? Rf : kt)(this, this.l), this.l += 2, a;
        case 4:
        case -4:
          return t === "i" || (this[this.l + 3] & 128) === 0 ? (a = (e > 0 ? Jt : Bf)(this, this.l), this.l += 4, a) : (n = Xr(this, this.l), this.l += 4, n);
        case 8:
        case -8:
          if (t === "f")
            return e == 8 ? n = On(this, this.l) : n = On([this[this.l + 7], this[this.l + 6], this[this.l + 5], this[this.l + 4], this[this.l + 3], this[this.l + 2], this[this.l + 1], this[this.l + 0]], 0), this.l += 8, n;
          e = 8;
        /* falls through */
        case 16:
          r = qs(this, this.l, e);
          break;
      }
  }
  return this.l += e, r;
}
var Lf = function(e, t, r) {
  e[r] = t & 255, e[r + 1] = t >>> 8 & 255, e[r + 2] = t >>> 16 & 255, e[r + 3] = t >>> 24 & 255;
}, Mf = function(e, t, r) {
  e[r] = t & 255, e[r + 1] = t >> 8 & 255, e[r + 2] = t >> 16 & 255, e[r + 3] = t >> 24 & 255;
}, Pf = function(e, t, r) {
  e[r] = t & 255, e[r + 1] = t >>> 8 & 255;
};
function Uf(e, t, r) {
  var a = 0, n = 0;
  if (r === "dbcs") {
    for (n = 0; n != t.length; ++n) Pf(this, t.charCodeAt(n), this.l + 2 * n);
    a = 2 * t.length;
  } else if (r === "sbcs" || r == "cpstr") {
    for (t = t.replace(/[^\x00-\x7F]/g, "_"), n = 0; n != t.length; ++n) this[this.l + n] = t.charCodeAt(n) & 255;
    a = t.length;
  } else if (r === "hex") {
    for (; n < e; ++n)
      this[this.l++] = parseInt(t.slice(2 * n, 2 * n + 2), 16) || 0;
    return this;
  } else if (r === "utf16le") {
    var i = Math.min(this.l + e, this.length);
    for (n = 0; n < Math.min(t.length, e); ++n) {
      var c = t.charCodeAt(n);
      this[this.l++] = c & 255, this[this.l++] = c >> 8;
    }
    for (; this.l < i; ) this[this.l++] = 0;
    return this;
  } else switch (e) {
    case 1:
      a = 1, this[this.l] = t & 255;
      break;
    case 2:
      a = 2, this[this.l] = t & 255, t >>>= 8, this[this.l + 1] = t & 255;
      break;
    case 3:
      a = 3, this[this.l] = t & 255, t >>>= 8, this[this.l + 1] = t & 255, t >>>= 8, this[this.l + 2] = t & 255;
      break;
    case 4:
      a = 4, Lf(this, t, this.l);
      break;
    case 8:
      if (a = 8, r === "f") {
        Of(this, t, this.l);
        break;
      }
    /* falls through */
    case 16:
      break;
    case -4:
      a = 4, Mf(this, t, this.l);
      break;
  }
  return this.l += a, this;
}
function ic(e, t) {
  var r = qs(this, this.l, e.length >> 1);
  if (r !== e) throw new Error(t + "Expected " + e + " saw " + r);
  this.l += e.length >> 1;
}
function xr(e, t) {
  e.l = t, e.read_shift = /*::(*/
  Pa, e.chk = ic, e.write_shift = Uf;
}
function Br(e, t) {
  e.l += t;
}
function dr(e) {
  var t = Gt(e);
  return xr(t, 0), t;
}
function Bt(e, t, r) {
  if (e) {
    var a, n, i;
    xr(e, e.l || 0);
    for (var c = e.length, s = 0, u = 0; e.l < c; ) {
      s = e.read_shift(1), s & 128 && (s = (s & 127) + ((e.read_shift(1) & 127) << 7));
      var f = Ln[s] || Ln[65535];
      for (a = e.read_shift(1), i = a & 127, n = 1; n < 4 && a & 128; ++n) i += ((a = e.read_shift(1)) & 127) << 7 * n;
      u = e.l + i;
      var o = f.f && f.f(e, i, r);
      if (e.l = u, t(o, f, s)) return;
    }
  }
}
function h0() {
  var e = [], t = Xe ? 16384 : 2048, r = Xe && typeof dr(t).subarray == "function", a = function(l) {
    var x = dr(l);
    return xr(x, 0), x;
  }, n = a(t), i = function() {
    n && (n.l && (n.length > n.l && (n = n.slice(0, n.l), n.l = n.length), n.length > 0 && e.push(n)), n = null);
  }, c = function(l) {
    return n && l < n.length - n.l ? n : (i(), n = a(Math.max(l + 1, t)));
  }, s = function() {
    return i(), Ut(e);
  }, u = function() {
    return i(), e;
  }, f = function(l) {
    n.l > 0 && e.push(n.slice(0, n.l)), e.push(l), n = r ? n.subarray(n.l || 0) : n.slice(n.l || 0), xr(n, 0);
  };
  return { next: c, push: f, end: s, _bufs: e, end2: u };
}
function Ua(e, t, r) {
  var a = Ze(e);
  if (t.s ? (a.cRel && (a.c += t.s.c), a.rRel && (a.r += t.s.r)) : (a.cRel && (a.c += t.c), a.rRel && (a.r += t.r)), !r || r.biff < 12) {
    for (; a.c >= 256; ) a.c -= 256;
    for (; a.r >= 65536; ) a.r -= 65536;
  }
  return a;
}
function Ei(e, t, r) {
  var a = Ze(e);
  return a.s = Ua(a.s, t.s, r), a.e = Ua(a.e, t.s, r), a;
}
function Ha(e, t) {
  if (e.cRel && e.c < 0)
    for (e = Ze(e); e.c < 0; ) e.c += t > 8 ? 16384 : 256;
  if (e.rRel && e.r < 0)
    for (e = Ze(e); e.r < 0; ) e.r += t > 8 ? 1048576 : t > 5 ? 65536 : 16384;
  var r = Ge(e);
  return !e.cRel && e.cRel != null && (r = Wf(r)), !e.rRel && e.rRel != null && (r = Hf(r)), r;
}
function e0(e, t) {
  return e.s.r == 0 && !e.s.rRel && e.e.r == (t.biff >= 12 ? 1048575 : t.biff >= 8 ? 65536 : 16384) && !e.e.rRel ? (e.s.cRel ? "" : "$") + Je(e.s.c) + ":" + (e.e.cRel ? "" : "$") + Je(e.e.c) : e.s.c == 0 && !e.s.cRel && e.e.c == (t.biff >= 12 ? 16383 : 255) && !e.e.cRel ? (e.s.rRel ? "" : "$") + er(e.s.r) + ":" + (e.e.rRel ? "" : "$") + er(e.e.r) : Ha(e.s, t.biff) + ":" + Ha(e.e, t.biff);
}
function L0(e) {
  return parseInt(Vf(e), 10) - 1;
}
function er(e) {
  return "" + (e + 1);
}
function Hf(e) {
  return e.replace(/([A-Z]|^)(\d+)$/, "$1$$$2");
}
function Vf(e) {
  return e.replace(/\$(\d+)$/, "$1");
}
function M0(e) {
  for (var t = Gf(e), r = 0, a = 0; a !== t.length; ++a) r = 26 * r + t.charCodeAt(a) - 64;
  return r - 1;
}
function Je(e) {
  if (e < 0) throw new Error("invalid column " + e);
  var t = "";
  for (++e; e; e = Math.floor((e - 1) / 26)) t = String.fromCharCode((e - 1) % 26 + 65) + t;
  return t;
}
function Wf(e) {
  return e.replace(/^([A-Z])/, "$$$1");
}
function Gf(e) {
  return e.replace(/^\$([A-Z])/, "$1");
}
function Xf(e) {
  return e.replace(/(\$?[A-Z]*)(\$?\d*)/, "$1,$2").split(",");
}
function Ir(e) {
  for (var t = 0, r = 0, a = 0; a < e.length; ++a) {
    var n = e.charCodeAt(a);
    n >= 48 && n <= 57 ? t = 10 * t + (n - 48) : n >= 65 && n <= 90 && (r = 26 * r + (n - 64));
  }
  return { c: r - 1, r: t - 1 };
}
function Ge(e) {
  for (var t = e.c + 1, r = ""; t; t = (t - 1) / 26 | 0) r = String.fromCharCode((t - 1) % 26 + 65) + r;
  return r + (e.r + 1);
}
function Nt(e) {
  var t = e.indexOf(":");
  return t == -1 ? { s: Ir(e), e: Ir(e) } : { s: Ir(e.slice(0, t)), e: Ir(e.slice(t + 1)) };
}
function He(e, t) {
  return typeof t > "u" || typeof t == "number" ? He(e.s, e.e) : (typeof e != "string" && (e = Ge(e)), typeof t != "string" && (t = Ge(t)), e == t ? e : e + ":" + t);
}
function zf(e, t) {
  if (!e && !(t && t.biff <= 5 && t.biff >= 2)) throw new Error("empty sheet name");
  return /[^\w\u4E00-\u9FFF\u3040-\u30FF]/.test(e) ? "'" + e.replace(/'/g, "''") + "'" : e;
}
function cr(e) {
  var t = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } }, r = 0, a = 0, n = 0, i = e.length;
  for (r = 0; a < i && !((n = e.charCodeAt(a) - 64) < 1 || n > 26); ++a)
    r = 26 * r + n;
  for (t.s.c = --r, r = 0; a < i && !((n = e.charCodeAt(a) - 48) < 0 || n > 9); ++a)
    r = 10 * r + n;
  if (t.s.r = --r, a === i || n != 10)
    return t.e.c = t.s.c, t.e.r = t.s.r, t;
  for (++a, r = 0; a != i && !((n = e.charCodeAt(a) - 64) < 1 || n > 26); ++a)
    r = 26 * r + n;
  for (t.e.c = --r, r = 0; a != i && !((n = e.charCodeAt(a) - 48) < 0 || n > 9); ++a)
    r = 10 * r + n;
  return t.e.r = --r, t;
}
function wi(e, t) {
  var r = e.t == "d" && t instanceof Date;
  if (e.z != null) try {
    return e.w = $r(e.z, r ? mr(t) : t);
  } catch {
  }
  try {
    return e.w = $r((e.XF || {}).numFmtId || (r ? 14 : 0), r ? mr(t) : t);
  } catch {
    return "" + t;
  }
}
function Ot(e, t, r) {
  return e == null || e.t == null || e.t == "z" ? "" : e.w !== void 0 ? e.w : (e.t == "d" && !e.z && r && r.dateNF && (e.z = r.dateNF), e.t == "e" ? Ur[e.v] || e.v : t == null ? wi(e, e.v) : wi(e, t));
}
function qt(e, t) {
  var r = t && t.sheet ? t.sheet : "Sheet1", a = {};
  return a[r] = e, { SheetNames: [r], Sheets: a };
}
function qf(e) {
  var t = {}, r = e || {};
  return r.dense && (t["!data"] = []), t;
}
function sc(e, t, r) {
  var a = r || {}, n = e ? e["!data"] != null : a.dense, i = e || (n ? { "!data": [] } : {});
  n && !i["!data"] && (i["!data"] = []);
  var c = 0, s = 0;
  if (i && a.origin != null)
    if (typeof a.origin == "number") c = a.origin;
    else {
      var u = typeof a.origin == "string" ? Ir(a.origin) : a.origin;
      c = u.r, s = u.c;
    }
  var f = { s: { c: 1e7, r: 1e7 }, e: { c: 0, r: 0 } };
  if (i["!ref"]) {
    var o = cr(i["!ref"]);
    f.s.c = o.s.c, f.s.r = o.s.r, f.e.c = Math.max(f.e.c, o.e.c), f.e.r = Math.max(f.e.r, o.e.r), c == -1 && (f.e.r = c = i["!ref"] ? o.e.r + 1 : 0);
  } else
    f.s.c = f.e.c = f.s.r = f.e.r = 0;
  for (var l = [], x = !1, h = 0; h != t.length; ++h)
    if (t[h]) {
      if (!Array.isArray(t[h])) throw new Error("aoa_to_sheet expects an array of arrays");
      var g = c + h;
      n && (i["!data"][g] || (i["!data"][g] = []), l = i["!data"][g]);
      for (var _ = t[h], d = 0; d != _.length; ++d)
        if (!(typeof _[d] > "u")) {
          var p = { v: _[d], t: "" }, w = s + d;
          if (f.s.r > g && (f.s.r = g), f.s.c > w && (f.s.c = w), f.e.r < g && (f.e.r = g), f.e.c < w && (f.e.c = w), x = !0, _[d] && typeof _[d] == "object" && !Array.isArray(_[d]) && !(_[d] instanceof Date)) p = _[d];
          else if (Array.isArray(p.v) && (p.f = _[d][1], p.v = p.v[0]), p.v === null)
            if (p.f) p.t = "n";
            else if (a.nullError)
              p.t = "e", p.v = 0;
            else if (a.sheetStubs) p.t = "z";
            else continue;
          else typeof p.v == "number" ? isFinite(p.v) ? p.t = "n" : isNaN(p.v) ? (p.t = "e", p.v = 15) : (p.t = "e", p.v = 7) : typeof p.v == "boolean" ? p.t = "b" : p.v instanceof Date ? (p.z = a.dateNF || Le[14], a.UTC || (p.v = Hn(p.v)), a.cellDates ? (p.t = "d", p.w = $r(p.z, mr(p.v, a.date1904))) : (p.t = "n", p.v = mr(p.v, a.date1904), p.w = $r(p.z, p.v))) : p.t = "s";
          if (n)
            l[w] && l[w].z && (p.z = l[w].z), l[w] = p;
          else {
            var m = Je(w) + (g + 1);
            i[m] && i[m].z && (p.z = i[m].z), i[m] = p;
          }
        }
    }
  return x && f.s.c < 104e5 && (i["!ref"] = He(f)), i;
}
function Ca(e, t) {
  return sc(null, e, t);
}
function $f(e) {
  return e.read_shift(4, "i");
}
function Nr(e) {
  var t = e.read_shift(4);
  return t === 0 ? "" : e.read_shift(t, "dbcs");
}
function jf(e) {
  return { ich: e.read_shift(2), ifnt: e.read_shift(2) };
}
function P0(e, t) {
  var r = e.l, a = e.read_shift(1), n = Nr(e), i = [], c = { t: n, h: n };
  if ((a & 1) !== 0) {
    for (var s = e.read_shift(4), u = 0; u != s; ++u) i.push(jf(e));
    c.r = i;
  } else c.r = [{ ich: 0, ifnt: 0 }];
  return e.l = r + t, c;
}
var Kf = P0;
function it(e) {
  var t = e.read_shift(4), r = e.read_shift(2);
  return r += e.read_shift(1) << 16, e.l++, { c: t, iStyleRef: r };
}
function ha(e) {
  var t = e.read_shift(2);
  return t += e.read_shift(1) << 16, e.l++, { c: -1, iStyleRef: t };
}
var Yf = Nr;
function Wn(e) {
  var t = e.read_shift(4);
  return t === 0 || t === 4294967295 ? "" : e.read_shift(t, "dbcs");
}
var Jf = Nr, d0 = Wn;
function Gn(e) {
  var t = e.slice(e.l, e.l + 4), r = t[0] & 1, a = t[0] & 2;
  e.l += 4;
  var n = a === 0 ? On([0, 0, 0, 0, t[0] & 252, t[1], t[2], t[3]], 0) : Jt(t, 0) >> 2;
  return r ? n / 100 : n;
}
function cc(e) {
  var t = { s: {}, e: {} };
  return t.s.r = e.read_shift(4), t.e.r = e.read_shift(4), t.s.c = e.read_shift(4), t.e.c = e.read_shift(4), t;
}
var da = cc;
function Sr(e) {
  if (e.length - e.l < 8) throw "XLS Xnum Buffer underflow";
  return e.read_shift(8, "f");
}
function Zf(e) {
  var t = {}, r = e.read_shift(1), a = r >>> 1, n = e.read_shift(1), i = e.read_shift(2, "i"), c = e.read_shift(1), s = e.read_shift(1), u = e.read_shift(1);
  switch (e.l++, a) {
    case 0:
      t.auto = 1;
      break;
    case 1:
      t.index = n;
      var f = mt[n];
      f && (t.rgb = fa(f));
      break;
    case 2:
      t.rgb = fa([c, s, u]);
      break;
    case 3:
      t.theme = n;
      break;
  }
  return i != 0 && (t.tint = i > 0 ? i / 32767 : i / 32768), t;
}
function Qf(e) {
  var t = e.read_shift(1);
  e.l++;
  var r = {
    fBold: t & 1,
    fItalic: t & 2,
    fUnderline: t & 4,
    fStrikeout: t & 8,
    fOutline: t & 16,
    fShadow: t & 32,
    fCondense: t & 64,
    fExtend: t & 128
  };
  return r;
}
function uc(e, t) {
  var r = { 2: "BITMAP", 3: "METAFILEPICT", 8: "DIB", 14: "ENHMETAFILE" }, a = e.read_shift(4);
  switch (a) {
    case 0:
      return "";
    case 4294967295:
    case 4294967294:
      return r[e.read_shift(4)] || "";
  }
  if (a > 400) throw new Error("Unsupported Clipboard: " + a.toString(16));
  return e.l -= 4, e.read_shift(0, t == 1 ? "lpstr" : "lpwstr");
}
function eo(e) {
  return uc(e, 1);
}
function ro(e) {
  return uc(e, 2);
}
var U0 = 2, Mr = 3, xn = 11, Ai = 12, Rn = 19, pn = 64, to = 65, ao = 71, no = 4108, io = 4126, Er = 80, fc = 81, so = [Er, fc], co = {
  1: { n: "CodePage", t: U0 },
  2: { n: "Category", t: Er },
  3: { n: "PresentationFormat", t: Er },
  4: { n: "ByteCount", t: Mr },
  5: { n: "LineCount", t: Mr },
  6: { n: "ParagraphCount", t: Mr },
  7: { n: "SlideCount", t: Mr },
  8: { n: "NoteCount", t: Mr },
  9: { n: "HiddenCount", t: Mr },
  10: { n: "MultimediaClipCount", t: Mr },
  11: { n: "ScaleCrop", t: xn },
  12: {
    n: "HeadingPairs",
    t: no
    /* VT_VECTOR | VT_VARIANT */
  },
  13: {
    n: "TitlesOfParts",
    t: io
    /* VT_VECTOR | VT_LPSTR */
  },
  14: { n: "Manager", t: Er },
  15: { n: "Company", t: Er },
  16: { n: "LinksUpToDate", t: xn },
  17: { n: "CharacterCount", t: Mr },
  19: { n: "SharedDoc", t: xn },
  22: { n: "HyperlinksChanged", t: xn },
  23: { n: "AppVersion", t: Mr, p: "version" },
  24: { n: "DigSig", t: to },
  26: { n: "ContentType", t: Er },
  27: { n: "ContentStatus", t: Er },
  28: { n: "Language", t: Er },
  29: { n: "Version", t: Er },
  255: {},
  /* [MS-OLEPS] 2.18 */
  2147483648: { n: "Locale", t: Rn },
  2147483651: { n: "Behavior", t: Rn },
  1919054434: {}
}, uo = {
  1: { n: "CodePage", t: U0 },
  2: { n: "Title", t: Er },
  3: { n: "Subject", t: Er },
  4: { n: "Author", t: Er },
  5: { n: "Keywords", t: Er },
  6: { n: "Comments", t: Er },
  7: { n: "Template", t: Er },
  8: { n: "LastAuthor", t: Er },
  9: { n: "RevNumber", t: Er },
  10: { n: "EditTime", t: pn },
  11: { n: "LastPrinted", t: pn },
  12: { n: "CreatedDate", t: pn },
  13: { n: "ModifiedDate", t: pn },
  14: { n: "PageCount", t: Mr },
  15: { n: "WordCount", t: Mr },
  16: { n: "CharCount", t: Mr },
  17: { n: "Thumbnail", t: ao },
  18: { n: "Application", t: Er },
  19: { n: "DocSecurity", t: Mr },
  255: {},
  /* [MS-OLEPS] 2.18 */
  2147483648: { n: "Locale", t: Rn },
  2147483651: { n: "Behavior", t: Rn },
  1919054434: {}
}, Ti = {
  1: "US",
  // United States
  2: "CA",
  // Canada
  3: "",
  // Latin America (except Brazil)
  7: "RU",
  // Russia
  20: "EG",
  // Egypt
  30: "GR",
  // Greece
  31: "NL",
  // Netherlands
  32: "BE",
  // Belgium
  33: "FR",
  // France
  34: "ES",
  // Spain
  36: "HU",
  // Hungary
  39: "IT",
  // Italy
  41: "CH",
  // Switzerland
  43: "AT",
  // Austria
  44: "GB",
  // United Kingdom
  45: "DK",
  // Denmark
  46: "SE",
  // Sweden
  47: "NO",
  // Norway
  48: "PL",
  // Poland
  49: "DE",
  // Germany
  52: "MX",
  // Mexico
  55: "BR",
  // Brazil
  61: "AU",
  // Australia
  64: "NZ",
  // New Zealand
  66: "TH",
  // Thailand
  81: "JP",
  // Japan
  82: "KR",
  // Korea
  84: "VN",
  // Viet Nam
  86: "CN",
  // China
  90: "TR",
  // Turkey
  105: "JS",
  // Ramastan
  213: "DZ",
  // Algeria
  216: "MA",
  // Morocco
  218: "LY",
  // Libya
  351: "PT",
  // Portugal
  354: "IS",
  // Iceland
  358: "FI",
  // Finland
  420: "CZ",
  // Czech Republic
  886: "TW",
  // Taiwan
  961: "LB",
  // Lebanon
  962: "JO",
  // Jordan
  963: "SY",
  // Syria
  964: "IQ",
  // Iraq
  965: "KW",
  // Kuwait
  966: "SA",
  // Saudi Arabia
  971: "AE",
  // United Arab Emirates
  972: "IL",
  // Israel
  974: "QA",
  // Qatar
  981: "IR",
  // Iran
  65535: "US"
  // United States
}, fo = [
  null,
  "solid",
  "mediumGray",
  "darkGray",
  "lightGray",
  "darkHorizontal",
  "darkVertical",
  "darkDown",
  "darkUp",
  "darkGrid",
  "darkTrellis",
  "lightHorizontal",
  "lightVertical",
  "lightDown",
  "lightUp",
  "lightGrid",
  "lightTrellis",
  "gray125",
  "gray0625"
];
function oo(e) {
  return e.map(function(t) {
    return [t >> 16 & 255, t >> 8 & 255, t & 255];
  });
}
var lo = /* @__PURE__ */ oo([
  /* Color Constants */
  0,
  16777215,
  16711680,
  65280,
  255,
  16776960,
  16711935,
  65535,
  /* Overridable Defaults */
  0,
  16777215,
  16711680,
  65280,
  255,
  16776960,
  16711935,
  65535,
  8388608,
  32768,
  128,
  8421376,
  8388736,
  32896,
  12632256,
  8421504,
  10066431,
  10040166,
  16777164,
  13434879,
  6684774,
  16744576,
  26316,
  13421823,
  128,
  16711935,
  16776960,
  65535,
  8388736,
  8388608,
  32896,
  255,
  52479,
  13434879,
  13434828,
  16777113,
  10079487,
  16751052,
  13408767,
  16764057,
  3368703,
  3394764,
  10079232,
  16763904,
  16750848,
  16737792,
  6710937,
  9868950,
  13158,
  3381606,
  13056,
  3355392,
  10040064,
  10040166,
  3355545,
  3355443,
  /* Other entries to appease BIFF8/12 */
  0,
  /* 0x40 icvForeground ?? */
  16777215,
  /* 0x41 icvBackground ?? */
  0,
  /* 0x42 icvFrame ?? */
  0,
  /* 0x43 icv3D ?? */
  0,
  /* 0x44 icv3DText ?? */
  0,
  /* 0x45 icv3DHilite ?? */
  0,
  /* 0x46 icv3DShadow ?? */
  0,
  /* 0x47 icvHilite ?? */
  0,
  /* 0x48 icvCtlText ?? */
  0,
  /* 0x49 icvCtlScrl ?? */
  0,
  /* 0x4A icvCtlInv ?? */
  0,
  /* 0x4B icvCtlBody ?? */
  0,
  /* 0x4C icvCtlFrame ?? */
  0,
  /* 0x4D icvCtlFore ?? */
  0,
  /* 0x4E icvCtlBack ?? */
  0,
  /* 0x4F icvCtlNeutral */
  0,
  /* 0x50 icvInfoBk ?? */
  0
  /* 0x51 icvInfoText ?? */
]), mt = /* @__PURE__ */ Ze(lo), Ur = {
  0: "#NULL!",
  7: "#DIV/0!",
  15: "#VALUE!",
  23: "#REF!",
  29: "#NAME?",
  36: "#NUM!",
  42: "#N/A",
  43: "#GETTING_DATA",
  255: "#WTF?"
}, Tr = {
  "#NULL!": 0,
  "#DIV/0!": 7,
  "#VALUE!": 15,
  "#REF!": 23,
  "#NAME?": 29,
  "#NUM!": 36,
  "#N/A": 42,
  "#GETTING_DATA": 43,
  "#WTF?": 255
}, oc = [
  "_xlnm.Consolidate_Area",
  "_xlnm.Auto_Open",
  "_xlnm.Auto_Close",
  "_xlnm.Extract",
  "_xlnm.Database",
  "_xlnm.Criteria",
  "_xlnm.Print_Area",
  "_xlnm.Print_Titles",
  "_xlnm.Recorder",
  "_xlnm.Data_Form",
  "_xlnm.Auto_Activate",
  "_xlnm.Auto_Deactivate",
  "_xlnm.Sheet_Title",
  "_xlnm._FilterDatabase"
], Fi = {
  /* Workbook */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": "workbooks",
  "application/vnd.ms-excel.sheet.macroEnabled.main+xml": "workbooks",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.main": "workbooks",
  "application/vnd.ms-excel.addin.macroEnabled.main+xml": "workbooks",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": "workbooks",
  /* Worksheet */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml": "sheets",
  "application/vnd.ms-excel.worksheet": "sheets",
  "application/vnd.ms-excel.binIndexWs": "TODO",
  /* Binary Index */
  /* Chartsheet */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml": "charts",
  "application/vnd.ms-excel.chartsheet": "charts",
  /* Macrosheet */
  "application/vnd.ms-excel.macrosheet+xml": "macros",
  "application/vnd.ms-excel.macrosheet": "macros",
  "application/vnd.ms-excel.intlmacrosheet": "TODO",
  "application/vnd.ms-excel.binIndexMs": "TODO",
  /* Binary Index */
  /* Dialogsheet */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml": "dialogs",
  "application/vnd.ms-excel.dialogsheet": "dialogs",
  /* Shared Strings */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml": "strs",
  "application/vnd.ms-excel.sharedStrings": "strs",
  /* Styles */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml": "styles",
  "application/vnd.ms-excel.styles": "styles",
  /* File Properties */
  "application/vnd.openxmlformats-package.core-properties+xml": "coreprops",
  "application/vnd.openxmlformats-officedocument.custom-properties+xml": "custprops",
  "application/vnd.openxmlformats-officedocument.extended-properties+xml": "extprops",
  /* Custom Data Properties */
  "application/vnd.openxmlformats-officedocument.customXmlProperties+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty": "TODO",
  /* Comments */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml": "comments",
  "application/vnd.ms-excel.comments": "comments",
  "application/vnd.ms-excel.threadedcomments+xml": "threadedcomments",
  "application/vnd.ms-excel.person+xml": "people",
  /* Metadata (Stock/Geography and Dynamic Array) */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml": "metadata",
  "application/vnd.ms-excel.sheetMetadata": "metadata",
  /* PivotTable */
  "application/vnd.ms-excel.pivotTable": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml": "TODO",
  /* Chart Objects */
  "application/vnd.openxmlformats-officedocument.drawingml.chart+xml": "TODO",
  /* Chart Colors */
  "application/vnd.ms-office.chartcolorstyle+xml": "TODO",
  /* Chart Style */
  "application/vnd.ms-office.chartstyle+xml": "TODO",
  /* Chart Advanced */
  "application/vnd.ms-office.chartex+xml": "TODO",
  /* Calculation Chain */
  "application/vnd.ms-excel.calcChain": "calcchains",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml": "calcchains",
  /* Printer Settings */
  "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings": "TODO",
  /* ActiveX */
  "application/vnd.ms-office.activeX": "TODO",
  "application/vnd.ms-office.activeX+xml": "TODO",
  /* Custom Toolbars */
  "application/vnd.ms-excel.attachedToolbars": "TODO",
  /* External Data Connections */
  "application/vnd.ms-excel.connections": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml": "TODO",
  /* External Links */
  "application/vnd.ms-excel.externalLink": "links",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml": "links",
  /* PivotCache */
  "application/vnd.ms-excel.pivotCacheDefinition": "TODO",
  "application/vnd.ms-excel.pivotCacheRecords": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml": "TODO",
  /* Query Table */
  "application/vnd.ms-excel.queryTable": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml": "TODO",
  /* Shared Workbook */
  "application/vnd.ms-excel.userNames": "TODO",
  "application/vnd.ms-excel.revisionHeaders": "TODO",
  "application/vnd.ms-excel.revisionLog": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionHeaders+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionLog+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.userNames+xml": "TODO",
  /* Single Cell Table */
  "application/vnd.ms-excel.tableSingleCells": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.tableSingleCells+xml": "TODO",
  /* Slicer */
  "application/vnd.ms-excel.slicer": "TODO",
  "application/vnd.ms-excel.slicerCache": "TODO",
  "application/vnd.ms-excel.slicer+xml": "TODO",
  "application/vnd.ms-excel.slicerCache+xml": "TODO",
  /* Sort Map */
  "application/vnd.ms-excel.wsSortMap": "TODO",
  /* Table */
  "application/vnd.ms-excel.table": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml": "TODO",
  /* Themes */
  "application/vnd.openxmlformats-officedocument.theme+xml": "themes",
  /* Theme Override */
  "application/vnd.openxmlformats-officedocument.themeOverride+xml": "TODO",
  /* Timeline */
  "application/vnd.ms-excel.Timeline+xml": "TODO",
  /* verify */
  "application/vnd.ms-excel.TimelineCache+xml": "TODO",
  /* verify */
  /* VBA */
  "application/vnd.ms-office.vbaProject": "vba",
  "application/vnd.ms-office.vbaProjectSignature": "TODO",
  /* Volatile Dependencies */
  "application/vnd.ms-office.volatileDependencies": "TODO",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.volatileDependencies+xml": "TODO",
  /* Control Properties */
  "application/vnd.ms-excel.controlproperties+xml": "TODO",
  /* Data Model */
  "application/vnd.openxmlformats-officedocument.model+data": "TODO",
  /* Survey */
  "application/vnd.ms-excel.Survey+xml": "TODO",
  /* Drawing */
  "application/vnd.openxmlformats-officedocument.drawing+xml": "drawings",
  "application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml": "TODO",
  "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml": "TODO",
  /* VML */
  "application/vnd.openxmlformats-officedocument.vmlDrawing": "TODO",
  "application/vnd.openxmlformats-package.relationships+xml": "rels",
  "application/vnd.openxmlformats-officedocument.oleObject": "TODO",
  /* Image */
  "image/png": "TODO",
  sheet: "js"
};
function ho() {
  return {
    workbooks: [],
    sheets: [],
    charts: [],
    dialogs: [],
    macros: [],
    rels: [],
    strs: [],
    comments: [],
    threadedcomments: [],
    links: [],
    coreprops: [],
    extprops: [],
    custprops: [],
    themes: [],
    styles: [],
    calcchains: [],
    vba: [],
    drawings: [],
    metadata: [],
    people: [],
    TODO: [],
    xmlns: ""
  };
}
function xo(e) {
  var t = ho();
  if (!e || !e.match) return t;
  var r = {};
  if ((e.match(pr) || []).forEach(function(a) {
    var n = Ee(a);
    switch (n[0].replace(Ef, "<")) {
      case "<?xml":
        break;
      case "<Types":
        t.xmlns = n["xmlns" + (n[0].match(/<(\w+):/) || ["", ""])[1]];
        break;
      case "<Default":
        r[n.Extension.toLowerCase()] = n.ContentType;
        break;
      case "<Override":
        t[Fi[n.ContentType]] !== void 0 && t[Fi[n.ContentType]].push(n.PartName);
        break;
    }
  }), t.xmlns !== bf.CT) throw new Error("Unknown Namespace: " + t.xmlns);
  return t.calcchain = t.calcchains.length > 0 ? t.calcchains[0] : "", t.sst = t.strs.length > 0 ? t.strs[0] : "", t.style = t.styles.length > 0 ? t.styles[0] : "", t.defaults = r, delete t.calcchains, t;
}
var Ea = {
  WB: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  SHEET: "http://sheetjs.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  HLINK: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  VML: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
  XPATH: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath",
  XMISS: "http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlPathMissing",
  XLINK: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink",
  CXML: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
  CXMLP: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps",
  CMNT: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  CORE_PROPS: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  EXT_PROPS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  CUST_PROPS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
  SST: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
  STY: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  THEME: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  CHART: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  CHARTEX: "http://schemas.microsoft.com/office/2014/relationships/chartEx",
  CS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet",
  WS: [
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet"
  ],
  DS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet",
  MS: "http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet",
  IMG: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  DRAW: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  XLMETA: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata",
  TCMNT: "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment",
  PEOPLE: "http://schemas.microsoft.com/office/2017/10/relationships/person",
  CONN: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections",
  VBA: "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
};
function Ya(e) {
  var t = e.lastIndexOf("/");
  return e.slice(0, t + 1) + "_rels/" + e.slice(t + 1) + ".rels";
}
function ra(e, t) {
  var r = { "!id": {} };
  if (!e) return r;
  t.charAt(0) !== "/" && (t = "/" + t);
  var a = {};
  return (e.match(pr) || []).forEach(function(n) {
    var i = Ee(n);
    if (i[0] === "<Relationship") {
      var c = {};
      c.Type = i.Type, c.Target = Ue(i.Target), c.Id = i.Id, i.TargetMode && (c.TargetMode = i.TargetMode);
      var s = i.TargetMode === "External" ? i.Target : Tt(i.Target, t);
      r[s] = c, a[i.Id] = c;
    }
  }), r["!id"] = a, r;
}
var po = "application/vnd.oasis.opendocument.spreadsheet";
function vo(e, t) {
  for (var r = Vn(e), a, n; a = hr.exec(r); )
    switch (a[3]) {
      case "manifest":
        break;
      case "file-entry":
        if (n = Ee(a[0], !1), n.path == "/" && n.type !== po)
          throw new Error("This OpenDocument is not a spreadsheet");
        break;
      case "encryption-data":
      case "algorithm":
      case "start-key-generation":
      case "key-derivation":
        throw new Error("Unsupported ODS Encryption");
      default:
        if (t && t.WTF)
          throw a;
    }
}
var ki = [
  ["cp:category", "Category"],
  ["cp:contentStatus", "ContentStatus"],
  ["cp:keywords", "Keywords"],
  ["cp:lastModifiedBy", "LastAuthor"],
  ["cp:lastPrinted", "LastPrinted"],
  ["cp:revision", "RevNumber"],
  ["cp:version", "Version"],
  ["dc:creator", "Author"],
  ["dc:description", "Comments"],
  ["dc:identifier", "Identifier"],
  ["dc:language", "Language"],
  ["dc:subject", "Subject"],
  ["dc:title", "Title"],
  ["dcterms:created", "CreatedDate", "date"],
  ["dcterms:modified", "ModifiedDate", "date"]
];
function lc(e) {
  var t = {};
  e = Qe(e);
  for (var r = 0; r < ki.length; ++r) {
    var a = ki[r], n = ea(e, a[0]);
    n != null && n.length > 0 && (t[a[1]] = Ue(n[1])), a[2] === "date" && t[a[1]] && (t[a[1]] = kr(t[a[1]]));
  }
  return t;
}
var go = [
  ["Application", "Application", "string"],
  ["AppVersion", "AppVersion", "string"],
  ["Company", "Company", "string"],
  ["DocSecurity", "DocSecurity", "string"],
  ["Manager", "Manager", "string"],
  ["HyperlinksChanged", "HyperlinksChanged", "bool"],
  ["SharedDoc", "SharedDoc", "bool"],
  ["LinksUpToDate", "LinksUpToDate", "bool"],
  ["ScaleCrop", "ScaleCrop", "bool"],
  ["HeadingPairs", "HeadingPairs", "raw"],
  ["TitlesOfParts", "TitlesOfParts", "raw"]
];
function hc(e, t, r, a) {
  var n = [];
  if (typeof e == "string") n = xi(e, a);
  else for (var i = 0; i < e.length; ++i) n = n.concat(e[i].map(function(o) {
    return { v: o };
  }));
  var c = typeof t == "string" ? xi(t, a).map(function(o) {
    return o.v;
  }) : t, s = 0, u = 0;
  if (c.length > 0) for (var f = 0; f !== n.length; f += 2) {
    switch (u = +n[f + 1].v, n[f].v) {
      case "Worksheets":
      case "工作表":
      case "Листы":
      case "أوراق العمل":
      case "ワークシート":
      case "גליונות עבודה":
      case "Arbeitsblätter":
      case "Çalışma Sayfaları":
      case "Feuilles de calcul":
      case "Fogli di lavoro":
      case "Folhas de cálculo":
      case "Planilhas":
      case "Regneark":
      case "Hojas de cálculo":
      case "Werkbladen":
        r.Worksheets = u, r.SheetNames = c.slice(s, s + u);
        break;
      case "Named Ranges":
      case "Rangos con nombre":
      case "名前付き一覧":
      case "Benannte Bereiche":
      case "Navngivne områder":
        r.NamedRanges = u, r.DefinedNames = c.slice(s, s + u);
        break;
      case "Charts":
      case "Diagramme":
        r.Chartsheets = u, r.ChartNames = c.slice(s, s + u);
        break;
    }
    s += u;
  }
}
function mo(e, t, r) {
  var a = {};
  return t || (t = {}), e = Qe(e), go.forEach(function(n) {
    var i = (Ye(e, n[0]) || [])[1];
    switch (n[2]) {
      case "string":
        i && (t[n[1]] = Ue(i));
        break;
      case "bool":
        t[n[1]] = i === "true";
        break;
      case "raw":
        var c = ea(e, n[0]);
        c && c.length > 0 && (a[n[1]] = c[1]);
        break;
    }
  }), a.HeadingPairs && a.TitlesOfParts && hc(a.HeadingPairs, a.TitlesOfParts, t, r), t;
}
var _o = /<[^<>]+>[^<]*/g;
function Eo(e, t) {
  var r = {}, a = "", n = e.match(_o);
  if (n) for (var i = 0; i != n.length; ++i) {
    var c = n[i], s = Ee(c);
    switch (Lr(s[0])) {
      case "<?xml":
        break;
      case "<Properties":
        break;
      case "<property":
        a = Ue(s.name);
        break;
      case "</property>":
        a = null;
        break;
      default:
        if (c.indexOf("<vt:") === 0) {
          var u = c.split(">"), f = u[0].slice(4), o = u[1];
          switch (f) {
            case "lpstr":
            case "bstr":
            case "lpwstr":
              r[a] = Ue(o);
              break;
            case "bool":
              r[a] = Re(o);
              break;
            case "i1":
            case "i2":
            case "i4":
            case "i8":
            case "int":
            case "uint":
              r[a] = parseInt(o, 10);
              break;
            case "r4":
            case "r8":
            case "decimal":
              r[a] = parseFloat(o);
              break;
            case "filetime":
            case "date":
              r[a] = kr(o);
              break;
            case "cy":
            case "error":
              r[a] = Ue(o);
              break;
            default:
              if (f.slice(-1) == "/") break;
              t.WTF && typeof console < "u" && console.warn("Unexpected", c, f, u);
          }
        } else if (c.slice(0, 2) !== "</") {
          if (t.WTF) throw new Error(c);
        }
    }
  }
  return r;
}
var wo = {
  Title: "Title",
  Subject: "Subject",
  Author: "Author",
  Keywords: "Keywords",
  Comments: "Description",
  LastAuthor: "LastAuthor",
  RevNumber: "Revision",
  Application: "AppName",
  /* TotalTime: 'TotalTime', */
  LastPrinted: "LastPrinted",
  CreatedDate: "Created",
  ModifiedDate: "LastSaved",
  /* Pages */
  /* Words */
  /* Characters */
  Category: "Category",
  /* PresentationFormat */
  Manager: "Manager",
  Company: "Company",
  /* Guid */
  /* HyperlinkBase */
  /* Bytes */
  /* Lines */
  /* Paragraphs */
  /* CharactersWithSpaces */
  AppVersion: "Version",
  ContentStatus: "ContentStatus",
  /* NOTE: missing from schema */
  Identifier: "Identifier",
  /* NOTE: missing from schema */
  Language: "Language"
  /* NOTE: missing from schema */
}, r0;
function Ao(e, t, r) {
  r0 || (r0 = I0(wo)), t = r0[t] || t, e[t] = r;
}
function H0(e) {
  var t = e.read_shift(4), r = e.read_shift(4);
  return new Date((r / 1e7 * Math.pow(2, 32) + t / 1e7 - 11644473600) * 1e3).toISOString().replace(/\.000/, "");
}
function To(e, t, r) {
  var a = e.l, n = e.read_shift(0, "lpstr-cp");
  if (r) for (; e.l - a & 3; ) ++e.l;
  return n;
}
function Fo(e, t, r) {
  var a = e.read_shift(0, "lpwstr");
  return a;
}
function dc(e, t, r) {
  return t === 31 ? Fo(e) : To(e, t, r);
}
function Va(e, t, r) {
  return dc(e, t, r === !1 ? 0 : 4);
}
function ko(e, t) {
  if (!t) throw new Error("VtUnalignedString must have positive length");
  return dc(e, t, 0);
}
function Do(e) {
  for (var t = e.read_shift(4), r = [], a = 0; a != t; ++a) {
    var n = e.l;
    r[a] = e.read_shift(0, "lpwstr").replace(Pr, ""), e.l - n & 2 && (e.l += 2);
  }
  return r;
}
function Co(e) {
  for (var t = e.read_shift(4), r = [], a = 0; a != t; ++a) r[a] = e.read_shift(0, "lpstr-cp").replace(Pr, "");
  return r;
}
function yo(e) {
  var t = e.l, r = Bn(e, fc);
  e[e.l] == 0 && e[e.l + 1] == 0 && e.l - t & 2 && (e.l += 2);
  var a = Bn(e, Mr);
  return [r, a];
}
function So(e) {
  for (var t = e.read_shift(4), r = [], a = 0; a < t / 2; ++a) r.push(yo(e));
  return r;
}
function Di(e, t) {
  for (var r = e.read_shift(4), a = {}, n = 0; n != r; ++n) {
    var i = e.read_shift(4), c = e.read_shift(4);
    a[i] = e.read_shift(c, t === 1200 ? "utf16le" : "utf8").replace(Pr, "").replace(Ba, "!"), t === 1200 && c % 2 && (e.l += 2);
  }
  return e.l & 3 && (e.l = e.l >> 3 << 2), a;
}
function xc(e) {
  var t = e.read_shift(4), r = e.slice(e.l, e.l + t);
  return e.l += t, (t & 3) > 0 && (e.l += 4 - (t & 3) & 3), r;
}
function bo(e) {
  var t = {};
  return t.Size = e.read_shift(4), e.l += t.Size + 3 - (t.Size - 1) % 4, t;
}
function Bn(e, t, r) {
  var a = e.read_shift(2), n, i = r || {};
  if (e.l += 2, t !== Ai && a !== t && so.indexOf(t) === -1 && !((t & 65534) == 4126 && (a & 65534) == 4126))
    throw new Error("Expected type " + t + " saw " + a);
  switch (t === Ai ? a : t) {
    case 2:
      return n = e.read_shift(2, "i"), i.raw || (e.l += 2), n;
    case 3:
      return n = e.read_shift(4, "i"), n;
    case 11:
      return e.read_shift(4) !== 0;
    case 19:
      return n = e.read_shift(4), n;
    case 30:
      e.l += 4, val = Va(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
      break;
    case 31:
      e.l += 4, val = Va(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
      break;
    case 64:
      return H0(e);
    case 65:
      return xc(e);
    case 71:
      return bo(e);
    case 80:
      return Va(e, a, !i.raw).replace(Pr, "");
    case 81:
      return ko(
        e,
        a
        /*, 4*/
      ).replace(Pr, "");
    case 4108:
      return So(e);
    case 4126:
    case 4127:
      return a == 4127 ? Do(e) : Co(e);
    default:
      throw new Error("TypedPropertyValue unrecognized type " + t + " " + a);
  }
}
function Ci(e, t) {
  var r = e.l, a = e.read_shift(4), n = e.read_shift(4), i = [], c = 0, s = 0, u = -1, f = {};
  for (c = 0; c != n; ++c) {
    var o = e.read_shift(4), l = e.read_shift(4);
    i[c] = [o, l + r];
  }
  i.sort(function(w, m) {
    return w[1] - m[1];
  });
  var x = {};
  for (c = 0; c != n; ++c) {
    if (e.l !== i[c][1]) {
      var h = !0;
      if (c > 0 && t) switch (t[i[c - 1][0]].t) {
        case 2:
          e.l + 2 === i[c][1] && (e.l += 2, h = !1);
          break;
        case 80:
          e.l <= i[c][1] && (e.l = i[c][1], h = !1);
          break;
        case 4108:
          e.l <= i[c][1] && (e.l = i[c][1], h = !1);
          break;
      }
      if ((!t || c == 0) && e.l <= i[c][1] && (h = !1, e.l = i[c][1]), h) throw new Error("Read Error: Expected address " + i[c][1] + " at " + e.l + " :" + c);
    }
    if (t) {
      if (i[c][0] == 0 && i.length > c + 1 && i[c][1] == i[c + 1][1]) continue;
      var g = t[i[c][0]];
      if (x[g.n] = Bn(e, g.t, { raw: !0 }), g.p === "version" && (x[g.n] = String(x[g.n] >> 16) + "." + ("0000" + String(x[g.n] & 65535)).slice(-4)), g.n == "CodePage") switch (x[g.n]) {
        case 0:
          x[g.n] = 1252;
        /* falls through */
        case 874:
        case 932:
        case 936:
        case 949:
        case 950:
        case 1250:
        case 1251:
        case 1253:
        case 1254:
        case 1255:
        case 1256:
        case 1257:
        case 1258:
        case 1e4:
        case 1200:
        case 1201:
        case 1252:
        case 65e3:
        case -536:
        case 65001:
        case -535:
          ft(s = x[g.n] >>> 0 & 65535);
          break;
        default:
          throw new Error("Unsupported CodePage: " + x[g.n]);
      }
    } else if (i[c][0] === 1) {
      if (s = x.CodePage = Bn(e, U0), ft(s), u !== -1) {
        var _ = e.l;
        e.l = i[u][1], f = Di(e, s), e.l = _;
      }
    } else if (i[c][0] === 0) {
      if (s === 0) {
        u = c, e.l = i[c + 1][1];
        continue;
      }
      f = Di(e, s);
    } else {
      var d = f[i[c][0]], p;
      switch (e[e.l]) {
        case 65:
          e.l += 4, p = xc(e);
          break;
        case 30:
          e.l += 4, p = Va(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
          break;
        case 31:
          e.l += 4, p = Va(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
          break;
        case 3:
          e.l += 4, p = e.read_shift(4, "i");
          break;
        case 19:
          e.l += 4, p = e.read_shift(4);
          break;
        case 5:
          e.l += 4, p = e.read_shift(8, "f");
          break;
        case 11:
          e.l += 4, p = fr(e, 4);
          break;
        case 64:
          e.l += 4, p = kr(H0(e));
          break;
        default:
          throw new Error("unparsed value: " + e[e.l]);
      }
      x[d] = p;
    }
  }
  return e.l = r + a, x;
}
function yi(e, t, r) {
  var a = e.content;
  if (!a) return {};
  xr(a, 0);
  var n, i, c, s, u = 0;
  a.chk("feff", "Byte Order: "), a.read_shift(2);
  var f = a.read_shift(4), o = a.read_shift(16);
  if (o !== je.utils.consts.HEADER_CLSID && o !== r) throw new Error("Bad PropertySet CLSID " + o);
  if (n = a.read_shift(4), n !== 1 && n !== 2) throw new Error("Unrecognized #Sets: " + n);
  if (i = a.read_shift(16), s = a.read_shift(4), n === 1 && s !== a.l) throw new Error("Length mismatch: " + s + " !== " + a.l);
  n === 2 && (c = a.read_shift(16), u = a.read_shift(4));
  var l = Ci(a, t), x = { SystemIdentifier: f };
  for (var h in l) x[h] = l[h];
  if (x.FMTID = i, n === 1) return x;
  if (u - a.l == 2 && (a.l += 2), a.l !== u) throw new Error("Length mismatch 2: " + a.l + " !== " + u);
  var g;
  try {
    g = Ci(a, null);
  } catch {
  }
  for (h in g) x[h] = g[h];
  return x.FMTID = [i, c], x;
}
function Mt(e, t) {
  return e.read_shift(t), null;
}
function Io(e, t, r) {
  for (var a = [], n = e.l + t; e.l < n; ) a.push(r(e, n - e.l));
  if (n !== e.l) throw new Error("Slurp error");
  return a;
}
function fr(e, t) {
  return e.read_shift(t) === 1;
}
function ur(e) {
  return e.read_shift(2, "u");
}
function pc(e, t) {
  return Io(e, t, ur);
}
function vc(e) {
  var t = e.read_shift(1), r = e.read_shift(1);
  return r === 1 ? t : t === 1;
}
function ca(e, t, r) {
  var a = e.read_shift(r && r.biff >= 12 ? 2 : 1), n = "sbcs-cont", i = rt;
  if (r && r.biff >= 8 && (rt = 1200), !r || r.biff == 8) {
    var c = e.read_shift(1);
    c && (n = "dbcs-cont");
  } else r.biff == 12 && (n = "wstr");
  r.biff >= 2 && r.biff <= 5 && (n = "cpstr");
  var s = a ? e.read_shift(a, n) : "";
  return rt = i, s;
}
function No(e) {
  var t = rt;
  rt = 1200;
  var r = e.read_shift(2), a = e.read_shift(1), n = a & 4, i = a & 8, c = 1 + (a & 1), s = 0, u, f = {};
  i && (s = e.read_shift(2)), n && (u = e.read_shift(4));
  var o = c == 2 ? "dbcs-cont" : "sbcs-cont", l = r === 0 ? "" : e.read_shift(r, o);
  return i && (e.l += 4 * s), n && (e.l += u), f.t = l, i || (f.raw = "<t>" + f.t + "</t>", f.r = f.t), rt = t, f;
}
function ua(e, t, r) {
  var a;
  if (r) {
    if (r.biff >= 2 && r.biff <= 5) return e.read_shift(t, "cpstr");
    if (r.biff >= 12) return e.read_shift(t, "dbcs-cont");
  }
  var n = e.read_shift(1);
  return n === 0 ? a = e.read_shift(t, "sbcs-cont") : a = e.read_shift(t, "dbcs-cont"), a;
}
function sn(e, t, r) {
  var a = e.read_shift(r && r.biff == 2 ? 1 : 2);
  return a === 0 ? (r.biff <= 8 && e.l++, "") : ua(e, a, r);
}
function xa(e, t, r) {
  if (r.biff > 5) return sn(e, t, r);
  var a = e.read_shift(1);
  return a === 0 ? (e.l++, "") : e.read_shift(a, r.biff <= 4 || !e.lens ? "cpstr" : "sbcs-cont");
}
function Oo(e) {
  var t = e.read_shift(1);
  e.l++;
  var r = e.read_shift(2);
  return e.l += 2, [t, r];
}
function Ro(e) {
  var t = e.read_shift(4), r = e.l, a = !1;
  t > 24 && (e.l += t - 24, e.read_shift(16) === "795881f43b1d7f48af2c825dc4852763" && (a = !0), e.l = r);
  var n = e.read_shift((a ? t - 24 : t) >> 1, "utf16le").replace(Pr, "");
  return a && (e.l += 24), n;
}
function Bo(e) {
  for (var t = e.read_shift(2), r = ""; t-- > 0; ) r += "../";
  var a = e.read_shift(0, "lpstr-ansi");
  if (e.l += 2, e.read_shift(2) != 57005) throw new Error("Bad FileMoniker");
  var n = e.read_shift(4);
  if (n === 0) return r + a.replace(/\\/g, "/");
  var i = e.read_shift(4);
  if (e.read_shift(2) != 3) throw new Error("Bad FileMoniker");
  var c = e.read_shift(i >> 1, "utf16le").replace(Pr, "");
  return r + c;
}
function Lo(e, t) {
  var r = e.read_shift(16);
  switch (r) {
    case "e0c9ea79f9bace118c8200aa004ba90b":
      return Ro(e);
    case "0303000000000000c000000000000046":
      return Bo(e);
    default:
      throw new Error("Unsupported Moniker " + r);
  }
}
function vn(e) {
  var t = e.read_shift(4), r = t > 0 ? e.read_shift(t, "utf16le").replace(Pr, "") : "";
  return r;
}
function Mo(e, t) {
  var r = e.l + t, a = e.read_shift(4);
  if (a !== 2) throw new Error("Unrecognized streamVersion: " + a);
  var n = e.read_shift(2);
  e.l += 2;
  var i, c, s, u, f = "", o, l;
  n & 16 && (i = vn(e, r - e.l)), n & 128 && (c = vn(e, r - e.l)), (n & 257) === 257 && (s = vn(e, r - e.l)), (n & 257) === 1 && (u = Lo(e, r - e.l)), n & 8 && (f = vn(e, r - e.l)), n & 32 && (o = e.read_shift(16)), n & 64 && (l = H0(
    e
    /*, 8*/
  )), e.l = r;
  var x = c || s || u || "";
  x && f && (x += "#" + f), x || (x = "#" + f), n & 2 && x.charAt(0) == "/" && x.charAt(1) != "/" && (x = "file://" + x);
  var h = { Target: x };
  return o && (h.guid = o), l && (h.time = l), i && (h.Tooltip = i), h;
}
function gc(e) {
  var t = e.read_shift(1), r = e.read_shift(1), a = e.read_shift(1), n = e.read_shift(1);
  return [t, r, a, n];
}
function mc(e, t) {
  var r = gc(e);
  return r[3] = 0, r;
}
function ht(e, t, r) {
  var a = e.read_shift(2), n = e.read_shift(2), i = { r: a, c: n, ixfe: 0 };
  if (r && r.biff == 2 || t == 7) {
    var c = e.read_shift(1);
    i.ixfe = c & 63, e.l += 2;
  } else i.ixfe = e.read_shift(2);
  return i;
}
function Po(e) {
  var t = e.read_shift(2), r = e.read_shift(2);
  return e.l += 8, { type: t, flags: r };
}
function Uo(e, t, r) {
  return t === 0 ? "" : xa(e, t, r);
}
function Ho(e, t, r) {
  var a = r.biff > 8 ? 4 : 2, n = e.read_shift(a), i = e.read_shift(a, "i"), c = e.read_shift(a, "i");
  return [n, i, c];
}
function _c(e) {
  var t = e.read_shift(2), r = Gn(e);
  return [t, r];
}
function Vo(e, t, r) {
  e.l += 4, t -= 4;
  var a = e.l + t, n = ca(e, t, r), i = e.read_shift(2);
  if (a -= e.l, i !== a) throw new Error("Malformed AddinUdf: padding = " + a + " != " + i);
  return e.l += i, n;
}
function Xn(e) {
  var t = e.read_shift(2), r = e.read_shift(2), a = e.read_shift(2), n = e.read_shift(2);
  return { s: { c: a, r: t }, e: { c: n, r } };
}
function Ec(e) {
  var t = e.read_shift(2), r = e.read_shift(2), a = e.read_shift(1), n = e.read_shift(1);
  return { s: { c: a, r: t }, e: { c: n, r } };
}
var Wo = Ec;
function wc(e) {
  e.l += 4;
  var t = e.read_shift(2), r = e.read_shift(2), a = e.read_shift(2);
  return e.l += 12, [r, t, a];
}
function Go(e) {
  var t = {};
  return e.l += 4, e.l += 16, t.fSharedNote = e.read_shift(2), e.l += 4, t;
}
function Xo(e) {
  var t = {};
  return e.l += 4, e.cf = e.read_shift(2), t;
}
function Cr(e) {
  e.l += 2, e.l += e.read_shift(2);
}
var zo = {
  0: Cr,
  /* FtEnd */
  4: Cr,
  /* FtMacro */
  5: Cr,
  /* FtButton */
  6: Cr,
  /* FtGmo */
  7: Xo,
  /* FtCf */
  8: Cr,
  /* FtPioGrbit */
  9: Cr,
  /* FtPictFmla */
  10: Cr,
  /* FtCbls */
  11: Cr,
  /* FtRbo */
  12: Cr,
  /* FtSbs */
  13: Go,
  /* FtNts */
  14: Cr,
  /* FtSbsFmla */
  15: Cr,
  /* FtGboData */
  16: Cr,
  /* FtEdoData */
  17: Cr,
  /* FtRboData */
  18: Cr,
  /* FtCblsData */
  19: Cr,
  /* FtLbsData */
  20: Cr,
  /* FtCblsFmla */
  21: wc
};
function qo(e, t) {
  for (var r = e.l + t, a = []; e.l < r; ) {
    var n = e.read_shift(2);
    e.l -= 2;
    try {
      a[n] = zo[n](e, r - e.l);
    } catch {
      return e.l = r, a;
    }
  }
  return e.l != r && (e.l = r), a;
}
function gn(e, t) {
  var r = { BIFFVer: 0, dt: 0 };
  switch (r.BIFFVer = e.read_shift(2), t -= 2, t >= 2 && (r.dt = e.read_shift(2), e.l -= 2), r.BIFFVer) {
    case 1536:
    /* BIFF8 */
    case 1280:
    /* BIFF5 */
    case 1024:
    /* BIFF4 */
    case 768:
    /* BIFF3 */
    case 512:
    /* BIFF2 */
    case 2:
    case 7:
      break;
    default:
      if (t > 6) throw new Error("Unexpected BIFF Ver " + r.BIFFVer);
  }
  return e.read_shift(t), r;
}
function $o(e, t) {
  return t === 0 || e.read_shift(2), 1200;
}
function jo(e, t, r) {
  if (r.enc)
    return e.l += t, "";
  var a = e.l, n = xa(e, 0, r);
  return e.read_shift(t + a - e.l), n;
}
function Ko(e, t, r) {
  var a = r && r.biff == 8 || t == 2 ? e.read_shift(2) : (e.l += t, 0);
  return { fDialog: a & 16, fBelow: a & 64, fRight: a & 128 };
}
function Yo(e, t, r) {
  var a = "";
  if (r.biff == 4)
    return a = ca(e, 0, r), a.length === 0 && (a = "Sheet1"), { name: a };
  var n = e.read_shift(4), i = e.read_shift(1) & 3, c = e.read_shift(1);
  switch (c) {
    case 0:
      c = "Worksheet";
      break;
    case 1:
      c = "Macrosheet";
      break;
    case 2:
      c = "Chartsheet";
      break;
    case 6:
      c = "VBAModule";
      break;
  }
  return a = ca(e, 0, r), a.length === 0 && (a = "Sheet1"), { pos: n, hs: i, dt: c, name: a };
}
function Jo(e, t) {
  for (var r = e.l + t, a = e.read_shift(4), n = e.read_shift(4), i = [], c = 0; c != n && e.l < r; ++c)
    i.push(No(e));
  return i.Count = a, i.Unique = n, i;
}
function Zo(e, t) {
  var r = {};
  return r.dsst = e.read_shift(2), e.l += t - 2, r;
}
function Qo(e) {
  var t = {};
  t.r = e.read_shift(2), t.c = e.read_shift(2), t.cnt = e.read_shift(2) - t.c;
  var r = e.read_shift(2);
  e.l += 4;
  var a = e.read_shift(1);
  e.l += 1;
  var n = e.read_shift(2);
  return t.ixfe = n & 4095, t.flags = n >> 12 & 15, a & 7 && (t.level = a & 7), a & 32 && (t.hidden = !0), a & 64 && (t.hpt = r / 20), t;
}
function el(e) {
  var t = Po(e);
  if (t.type != 2211) throw new Error("Invalid Future Record " + t.type);
  var r = e.read_shift(4);
  return r !== 0;
}
function rl(e) {
  return e.read_shift(2), e.read_shift(4);
}
function Si(e, t, r) {
  var a = 0;
  r && r.biff == 2 || (a = e.read_shift(2));
  var n = e.read_shift(2);
  r && r.biff == 2 && (a = 1 - (n >> 15), n &= 32767);
  var i = { Unsynced: a & 1, DyZero: (a & 2) >> 1, ExAsc: (a & 4) >> 2, ExDsc: (a & 8) >> 3 };
  return [i, n];
}
function tl(e) {
  var t = e.read_shift(2), r = e.read_shift(2), a = e.read_shift(2), n = e.read_shift(2), i = e.read_shift(2), c = e.read_shift(2), s = e.read_shift(2), u = e.read_shift(2), f = e.read_shift(2);
  return {
    Pos: [t, r],
    Dim: [a, n],
    Flags: i,
    CurTab: c,
    FirstTab: s,
    Selected: u,
    TabRatio: f
  };
}
function al(e, t, r) {
  if (r && r.biff >= 2 && r.biff < 5) return {};
  var a = e.read_shift(2);
  return { RTL: a & 64 };
}
function nl() {
}
function il(e, t, r) {
  var a = e.l + t, n = {
    dyHeight: e.read_shift(2),
    fl: e.read_shift(2)
  };
  switch (n.sz = n.dyHeight / 20, n.italic = !!(n.fl & 2), n.strike = !!(n.fl & 8), n.outline = !!(n.fl & 16), n.shadow = !!(n.fl & 32), n.condense = !!(n.fl & 64), n.extend = !!(n.fl & 128), r && r.biff || 8) {
    case 2:
      break;
    case 3:
    case 4:
      n.icv = e.read_shift(2);
      break;
    default:
      n.icv = e.read_shift(2), n.bls = e.read_shift(2), n.bold = n.bls >= 700, n.vertAlign = e.read_shift(2), n.underline = e.read_shift(1), n.family = e.read_shift(1), n.charset = e.read_shift(1), e.l++;
      break;
  }
  return n.name = e.l < a ? ca(e, a - e.l, r) : "", n;
}
function sl(e, t, r) {
  var a = ht(e, t, r);
  return a.isst = e.read_shift(4), a;
}
function cl(e, t, r) {
  r.biffguess && r.biff == 2 && (r.biff = 5);
  var a = e.l + t, n = ht(e, t, r), i = sn(e, a - e.l, r);
  return n.val = i, n;
}
function ul(e, t, r) {
  var a = e.read_shift(2), n = xa(e, 0, r);
  return [a, n];
}
var fl = xa;
function bi(e, t, r) {
  var a = e.l + t, n = r.biff == 8 || !r.biff ? 4 : 2, i = e.read_shift(n), c = e.read_shift(n), s = e.read_shift(2), u = e.read_shift(2);
  return e.l = a, { s: { r: i, c: s }, e: { r: c, c: u } };
}
function ol(e) {
  var t = e.read_shift(2), r = e.read_shift(2), a = _c(e);
  return { r: t, c: r, ixfe: a[0], rknum: a[1] };
}
function ll(e, t) {
  for (var r = e.l + t - 2, a = e.read_shift(2), n = e.read_shift(2), i = []; e.l < r; ) i.push(_c(e));
  if (e.l !== r) throw new Error("MulRK read error");
  var c = e.read_shift(2);
  if (i.length != c - n + 1) throw new Error("MulRK length mismatch");
  return { r: a, c: n, C: c, rkrec: i };
}
function hl(e, t) {
  for (var r = e.l + t - 2, a = e.read_shift(2), n = e.read_shift(2), i = []; e.l < r; ) i.push(e.read_shift(2));
  if (e.l !== r) throw new Error("MulBlank read error");
  var c = e.read_shift(2);
  if (i.length != c - n + 1) throw new Error("MulBlank length mismatch");
  return { r: a, c: n, C: c, ixfe: i };
}
function dl(e, t, r, a) {
  var n = {}, i = e.read_shift(4), c = e.read_shift(4), s = e.read_shift(4), u = e.read_shift(2);
  return n.patternType = fo[s >> 26], n.alc = i & 7, n.fWrap = i >> 3 & 1, n.alcV = i >> 4 & 7, n.fJustLast = i >> 7 & 1, n.trot = i >> 8 & 255, n.cIndent = i >> 16 & 15, n.fShrinkToFit = i >> 20 & 1, n.iReadOrder = i >> 22 & 2, n.fAtrNum = i >> 26 & 1, n.fAtrFnt = i >> 27 & 1, n.fAtrAlc = i >> 28 & 1, n.fAtrBdr = i >> 29 & 1, n.fAtrPat = i >> 30 & 1, n.fAtrProt = i >> 31 & 1, n.dgLeft = c & 15, n.dgRight = c >> 4 & 15, n.dgTop = c >> 8 & 15, n.dgBottom = c >> 12 & 15, n.icvLeft = c >> 16 & 127, n.icvRight = c >> 23 & 127, n.grbitDiag = c >> 30 & 3, n.icvTop = s & 127, n.icvBottom = s >> 7 & 127, n.icvDiag = s >> 14 & 127, n.dgDiag = s >> 21 & 15, n.icvFore = u & 127, n.icvBack = u >> 7 & 127, n.fsxButton = u >> 14 & 1, n;
}
function xl(e, t, r) {
  var a = {};
  return a.ifnt = e.read_shift(2), a.numFmtId = e.read_shift(2), a.flags = e.read_shift(2), a.locked = !!(a.flags & 1), a.hidden = !!(a.flags & 2), a.fStyle = a.flags >> 2 & 1, a.xfId = a.ixfeParent = a.flags >> 4 & 4095, t -= 6, a.data = dl(e, t, a.fStyle), a;
}
function pl(e) {
  var t = {};
  return t.ifnt = e.read_shift(1), e.l++, t.flags = e.read_shift(1), t.numFmtId = t.flags & 63, t.flags >>= 6, t.fStyle = 0, t.data = {}, t;
}
function vl(e) {
  var t = {};
  return t.ifnt = e.read_shift(1), t.numFmtId = e.read_shift(1), t.flags = e.read_shift(2), t.fStyle = t.flags >> 2 & 1, t.data = {}, t;
}
function gl(e) {
  var t = {};
  return t.ifnt = e.read_shift(1), t.numFmtId = e.read_shift(1), t.flags = e.read_shift(2), t.fStyle = t.flags >> 2 & 1, t.data = {}, t;
}
function ml(e) {
  e.l += 4;
  var t = [e.read_shift(2), e.read_shift(2)];
  if (t[0] !== 0 && t[0]--, t[1] !== 0 && t[1]--, t[0] > 7 || t[1] > 7) throw new Error("Bad Gutters: " + t.join("|"));
  return t;
}
function _l(e, t, r) {
  var a = ht(e, 6, r), n = vc(e);
  return a.val = n, a.t = n === !0 || n === !1 ? "b" : "e", a;
}
function El(e, t, r) {
  r.biffguess && r.biff == 2 && (r.biff = 5);
  var a = ht(e, 6, r), n = Sr(e);
  return a.val = n, a;
}
var Ii = Uo;
function wl(e, t, r) {
  var a = e.l + t, n = e.read_shift(2), i = e.read_shift(2);
  if (r.sbcch = i, i == 1025 || i == 14849) return [i, n];
  if (i < 1 || i > 255) throw new Error("Unexpected SupBook type: " + i);
  for (var c = ua(e, i), s = []; a > e.l; ) s.push(sn(e, a - e.l, r));
  return [i, n, c, s];
}
function Ni(e, t, r) {
  var a = e.read_shift(2), n, i = {
    fBuiltIn: a & 1,
    fWantAdvise: a >>> 1 & 1,
    fWantPict: a >>> 2 & 1,
    fOle: a >>> 3 & 1,
    fOleLink: a >>> 4 & 1,
    cf: a >>> 5 & 1023,
    fIcon: a >>> 15 & 1
  };
  return r.sbcch === 14849 && (n = Vo(e, t - 2, r)), i.body = n || e.read_shift(t - 2), typeof n == "string" && (i.Name = n), i;
}
function Oi(e, t, r) {
  var a = e.l + t, n = e.read_shift(2), i = e.read_shift(1), c = e.read_shift(1), s = e.read_shift(r && r.biff == 2 ? 1 : 2), u = 0;
  (!r || r.biff >= 5) && (r.biff != 5 && (e.l += 2), u = e.read_shift(2), r.biff == 5 && (e.l += 2), e.l += 4);
  var f = ua(e, c, r);
  n & 32 && (f = oc[f.charCodeAt(0)]);
  var o = a - e.l;
  r && r.biff == 2 && --o;
  var l = a == e.l || s === 0 || !(o > 0) ? [] : _d(e, o, r, s);
  return {
    chKey: i,
    Name: f,
    itab: u,
    rgce: l
  };
}
function Ac(e, t, r) {
  if (r.biff < 8 || !(r.biff > 8) && t == e[e.l] + (e[e.l + 1] == 3 ? 1 : 0) + 1) return Ri(e, t, r);
  for (var a = [], n = e.l + t, i = e.read_shift(r.biff > 8 ? 4 : 2); i-- !== 0; ) a.push(Ho(e, r.biff > 8 ? 12 : 6, r));
  if (e.l != n) throw new Error("Bad ExternSheet: " + e.l + " != " + n);
  return a;
}
function Ri(e, t, r) {
  e[e.l + 1] == 3 && e[e.l]++;
  var a = ca(e, t, r);
  return a.charCodeAt(0) == 3 ? a.slice(1) : a;
}
function Al(e, t, r) {
  if (r.biff < 8) {
    e.l += t;
    return;
  }
  var a = e.read_shift(2), n = e.read_shift(2), i = ua(e, a, r), c = ua(e, n, r);
  return [i, c];
}
function Tl(e, t, r) {
  var a = Ec(e);
  e.l++;
  var n = e.read_shift(1);
  return t -= 8, [Ed(e, t, r), n, a];
}
function Bi(e, t, r) {
  var a = Wo(e);
  switch (r.biff) {
    case 2:
      e.l++, t -= 7;
      break;
    case 3:
    case 4:
      e.l += 2, t -= 8;
      break;
    default:
      e.l += 6, t -= 12;
  }
  return [a, gd(e, t, r)];
}
function Fl(e) {
  var t = e.read_shift(4) !== 0, r = e.read_shift(4) !== 0, a = e.read_shift(4);
  return [t, r, a];
}
function kl(e, t, r) {
  var a = e.read_shift(2), n = e.read_shift(2), i = e.read_shift(2), c = e.read_shift(2), s = xa(e, 0, r);
  return [{ r: a, c: n }, s, c, i];
}
function Dl(e, t, r) {
  if (r && r.biff < 8) {
    var a = e.read_shift(2), n = e.read_shift(2);
    if (a == 65535 || a == -1) return;
    var i = e.read_shift(2), c = e.read_shift(Math.min(i, 2048), "cpstr");
    return [{ r: a, c: n }, c];
  }
  return kl(e, t, r);
}
function Cl(e, t) {
  for (var r = [], a = e.read_shift(2); a--; ) r.push(Xn(e));
  return r;
}
function yl(e, t, r) {
  if (r && r.biff < 8) return bl(e, t, r);
  var a = wc(e), n = qo(e, t - 22, a[1]);
  return { cmo: a, ft: n };
}
var Sl = {
  8: function(e, t) {
    var r = e.l + t;
    e.l += 10;
    var a = e.read_shift(2);
    e.l += 4, e.l += 2, e.l += 2, e.l += 2, e.l += 4;
    var n = e.read_shift(1);
    return e.l += n, e.l = r, { fmt: a };
  }
};
function bl(e, t, r) {
  e.l += 4;
  var a = e.read_shift(2), n = e.read_shift(2), i = e.read_shift(2);
  e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 6, t -= 36;
  var c = [];
  return c.push((Sl[a] || Br)(e, t, r)), { cmo: [n, a, i], ft: c };
}
function Il(e, t, r) {
  var a = e.l, n = "";
  try {
    e.l += 4;
    var i = (r.lastobj || { cmo: [0, 0] }).cmo[1], c;
    [0, 5, 7, 11, 12, 14].indexOf(i) == -1 ? e.l += 6 : c = Oo(e, 6, r);
    var s = e.read_shift(2);
    e.read_shift(2), ur(e, 2);
    var u = e.read_shift(2);
    e.l += u;
    for (var f = 1; f < e.lens.length - 1; ++f) {
      if (e.l - a != e.lens[f]) throw new Error("TxO: bad continue record");
      var o = e[e.l], l = ua(e, e.lens[f + 1] - e.lens[f] - 1);
      if (n += l, n.length >= (o ? s : 2 * s)) break;
    }
    if (n.length !== s && n.length !== s * 2)
      throw new Error("cchText: " + s + " != " + n.length);
    return e.l = a + t, { t: n };
  } catch {
    return e.l = a + t, { t: n };
  }
}
function Nl(e, t) {
  var r = Xn(e);
  e.l += 16;
  var a = Mo(e, t - 24);
  return [r, a];
}
function Ol(e, t) {
  e.read_shift(2);
  var r = Xn(e), a = e.read_shift((t - 10) / 2, "dbcs-cont");
  return a = a.replace(Pr, ""), [r, a];
}
function Rl(e) {
  var t = [0, 0], r;
  return r = e.read_shift(2), t[0] = Ti[r] || r, r = e.read_shift(2), t[1] = Ti[r] || r, t;
}
function Bl(e) {
  for (var t = e.read_shift(2), r = []; t-- > 0; ) r.push(mc(e));
  return r;
}
function Ll(e) {
  for (var t = e.read_shift(2), r = []; t-- > 0; ) r.push(mc(e));
  return r;
}
function Ml(e) {
  e.l += 2;
  var t = { cxfs: 0, crc: 0 };
  return t.cxfs = e.read_shift(2), t.crc = e.read_shift(4), t;
}
function Tc(e, t, r) {
  if (!r.cellStyles) return Br(e, t);
  var a = r && r.biff >= 12 ? 4 : 2, n = e.read_shift(a), i = e.read_shift(a), c = e.read_shift(a), s = e.read_shift(a), u = e.read_shift(2);
  a == 2 && (e.l += 2);
  var f = { s: n, e: i, w: c, ixfe: s, flags: u };
  return (r.biff >= 5 || !r.biff) && (f.level = u >> 8 & 7), f;
}
function Pl(e, t) {
  var r = {};
  return t < 32 || (e.l += 16, r.header = Sr(e), r.footer = Sr(e), e.l += 2), r;
}
function Ul(e, t, r) {
  var a = { area: !1 };
  if (r.biff != 5)
    return e.l += t, a;
  var n = e.read_shift(1);
  return e.l += 3, n & 16 && (a.area = !0), a;
}
var Hl = ht, Vl = pc, Wl = sn;
function Gl(e) {
  var t = e.read_shift(2), r = e.read_shift(2), a = e.read_shift(4), n = { fmt: t, env: r, len: a, data: e.slice(e.l, e.l + a) };
  return e.l += a, n;
}
function Xl(e, t, r) {
  r.biffguess && r.biff == 5 && (r.biff = 2);
  var a = ht(e, 7, r), n = xa(e, t - 7, r);
  return a.t = "str", a.val = n, a;
}
function zl(e, t, r) {
  var a = ht(e, 7, r), n = Sr(e);
  return a.t = "n", a.val = n, a;
}
function ql(e, t, r) {
  var a = ht(e, 7, r), n = e.read_shift(2);
  return a.t = "n", a.val = n, a;
}
function $l(e) {
  var t = e.read_shift(1);
  return t === 0 ? (e.l++, "") : e.read_shift(t, "sbcs-cont");
}
function jl(e, t, r) {
  var a = e.l + 7, n = ht(e, 6, r);
  e.l = a;
  var i = vc(e);
  return n.val = i, n.t = i === !0 || i === !1 ? "b" : "e", n;
}
function Kl(e, t) {
  e.l += 6, e.l += 2, e.l += 1, e.l += 3, e.l += 1, e.l += t - 13;
}
function Yl(e, t, r) {
  var a = e.l + t, n = ht(e, 6, r), i = e.read_shift(2), c = ua(e, i, r);
  return e.l = a, n.t = "str", n.val = c, n;
}
function Jl(e) {
  var t = e.read_shift(4), r = e.read_shift(1), a = e.read_shift(r, "sbcs");
  return a.length === 0 && (a = "Sheet1"), { flags: t, name: a };
}
var Zl = [2, 3, 48, 49, 131, 139, 140, 245], Li = /* @__PURE__ */ (function() {
  var e = {
    /* Code Pages Supported by Visual FoxPro */
    1: 437,
    2: 850,
    3: 1252,
    4: 1e4,
    100: 852,
    101: 866,
    102: 865,
    103: 861,
    104: 895,
    105: 620,
    106: 737,
    107: 857,
    120: 950,
    121: 949,
    122: 936,
    123: 932,
    124: 874,
    125: 1255,
    126: 1256,
    150: 10007,
    151: 10029,
    152: 10006,
    200: 1250,
    201: 1251,
    202: 1254,
    203: 1253,
    /* shapefile DBF extension */
    0: 20127,
    8: 865,
    9: 437,
    10: 850,
    11: 437,
    13: 437,
    14: 850,
    15: 437,
    16: 850,
    17: 437,
    18: 850,
    19: 932,
    20: 850,
    21: 437,
    22: 850,
    23: 865,
    24: 437,
    25: 437,
    26: 850,
    27: 437,
    28: 863,
    29: 850,
    31: 852,
    34: 852,
    35: 852,
    36: 860,
    37: 850,
    38: 866,
    55: 850,
    64: 852,
    77: 936,
    78: 949,
    79: 950,
    80: 874,
    87: 1252,
    88: 1252,
    89: 1252,
    108: 863,
    134: 737,
    135: 852,
    136: 857,
    204: 1257,
    255: 16969
  }, t = I0({
    1: 437,
    2: 850,
    3: 1252,
    4: 1e4,
    100: 852,
    101: 866,
    102: 865,
    103: 861,
    104: 895,
    105: 620,
    106: 737,
    107: 857,
    120: 950,
    121: 949,
    122: 936,
    123: 932,
    124: 874,
    125: 1255,
    126: 1256,
    150: 10007,
    151: 10029,
    152: 10006,
    200: 1250,
    201: 1251,
    202: 1254,
    203: 1253,
    0: 20127
  });
  function r(s, u) {
    var f = [], o = Gt(1);
    switch (u.type) {
      case "base64":
        o = Gr(qr(s));
        break;
      case "binary":
        o = Gr(s);
        break;
      case "buffer":
      case "array":
        o = s;
        break;
    }
    xr(o, 0);
    var l = o.read_shift(1), x = !!(l & 136), h = !1, g = !1;
    switch (l) {
      case 2:
        break;
      // dBASE II
      case 3:
        break;
      // dBASE III
      case 48:
        h = !0, x = !0;
        break;
      // VFP
      case 49:
        h = !0, x = !0;
        break;
      // VFP with autoincrement
      // 0x43 dBASE IV SQL table files
      // 0x63 dBASE IV SQL system files
      case 131:
        break;
      // dBASE III with memo
      case 139:
        break;
      // dBASE IV with memo
      case 140:
        g = !0;
        break;
      // dBASE Level 7 with memo
      // case 0xCB dBASE IV SQL table files with memo
      case 245:
        break;
      // FoxPro 2.x with memo
      // case 0xFB FoxBASE
      default:
        throw new Error("DBF Unsupported Version: " + l.toString(16));
    }
    var _ = 0, d = 521;
    l == 2 && (_ = o.read_shift(2)), o.l += 3, l != 2 && (_ = o.read_shift(4)), _ > 1048576 && (_ = 1e6), l != 2 && (d = o.read_shift(2));
    var p = o.read_shift(2);
    u.codepage, l != 2 && (o.l += 16, o.read_shift(1), o[o.l] !== 0 && e[o[o.l]], o.l += 1, o.l += 2), g && (o.l += 36);
    for (var w = [], m = {}, y = Math.min(o.length, l == 2 ? 521 : d - 10 - (h ? 264 : 0)), M = g ? 32 : 11; o.l < y && o[o.l] != 13; )
      switch (m = {}, m.name = It(o.slice(o.l, o.l + M)).replace(/[\u0000\r\n][\S\s]*$/g, ""), o.l += M, m.type = String.fromCharCode(o.read_shift(1)), l != 2 && !g && (m.offset = o.read_shift(4)), m.len = o.read_shift(1), l == 2 && (m.offset = o.read_shift(2)), m.dec = o.read_shift(1), m.name.length && w.push(m), l != 2 && (o.l += g ? 13 : 14), m.type) {
        case "B":
          (!h || m.len != 8) && u.WTF && console.log("Skipping " + m.name + ":" + m.type);
          break;
        case "G":
        // General (FoxPro and dBASE L7)
        case "P":
          u.WTF && console.log("Skipping " + m.name + ":" + m.type);
          break;
        case "+":
        // Autoincrement (dBASE L7 only)
        case "0":
        // _NullFlags (VFP only)
        case "@":
        // Timestamp (dBASE L7 only)
        case "C":
        // Character (dBASE II)
        case "D":
        // Date (dBASE III)
        case "F":
        // Float (dBASE IV)
        case "I":
        // Long (VFP and dBASE L7)
        case "L":
        // Logical (dBASE II)
        case "M":
        // Memo (dBASE III)
        case "N":
        // Number (dBASE II)
        case "O":
        // Double (dBASE L7 only)
        case "T":
        // Datetime (VFP only)
        case "Y":
          break;
        default:
          throw new Error("Unknown Field Type: " + m.type);
      }
    if (o[o.l] !== 13 && (o.l = d - 1), o.read_shift(1) !== 13) throw new Error("DBF Terminator not found " + o.l + " " + o[o.l]);
    o.l = d;
    var W = 0, I = 0;
    for (f[0] = [], I = 0; I != w.length; ++I) f[0][I] = w[I].name;
    for (; _-- > 0; ) {
      if (o[o.l] === 42) {
        o.l += p;
        continue;
      }
      for (++o.l, f[++W] = [], I = 0, I = 0; I != w.length; ++I) {
        var L = o.slice(o.l, o.l + w[I].len);
        o.l += w[I].len, xr(L, 0);
        var A = It(L);
        switch (w[I].type) {
          case "C":
            A.trim().length && (f[W][I] = A.replace(/([^\s])\s+$/, "$1"));
            break;
          case "D":
            A.length === 8 ? (f[W][I] = new Date(Date.UTC(+A.slice(0, 4), +A.slice(4, 6) - 1, +A.slice(6, 8), 0, 0, 0, 0)), u && u.UTC || (f[W][I] = sa(f[W][I]))) : f[W][I] = A;
            break;
          case "F":
            f[W][I] = parseFloat(A.trim());
            break;
          case "+":
          case "I":
            f[W][I] = g ? L.read_shift(-4, "i") ^ 2147483648 : L.read_shift(4, "i");
            break;
          case "L":
            switch (A.trim().toUpperCase()) {
              case "Y":
              case "T":
                f[W][I] = !0;
                break;
              case "N":
              case "F":
                f[W][I] = !1;
                break;
              case "":
              case "\0":
              case "?":
                break;
              default:
                throw new Error("DBF Unrecognized L:|" + A + "|");
            }
            break;
          case "M":
            if (!x) throw new Error("DBF Unexpected MEMO for type " + l.toString(16));
            f[W][I] = "##MEMO##" + (g ? parseInt(A.trim(), 10) : L.read_shift(4));
            break;
          case "N":
            A = A.replace(/\u0000/g, "").trim(), A && A != "." && (f[W][I] = +A || 0);
            break;
          case "@":
            f[W][I] = new Date(L.read_shift(-8, "f") - 621356832e5);
            break;
          case "T":
            {
              var N = L.read_shift(4), R = L.read_shift(4);
              if (N == 0 && R == 0) break;
              f[W][I] = new Date((N - 2440588) * 864e5 + R), u && u.UTC || (f[W][I] = sa(f[W][I]));
            }
            break;
          case "Y":
            f[W][I] = L.read_shift(4, "i") / 1e4 + L.read_shift(4, "i") / 1e4 * Math.pow(2, 32);
            break;
          case "O":
            f[W][I] = -L.read_shift(-8, "f");
            break;
          case "B":
            if (h && w[I].len == 8) {
              f[W][I] = L.read_shift(8, "f");
              break;
            }
          /* falls through */
          case "G":
          case "P":
            L.l += w[I].len;
            break;
          case "0":
            if (w[I].name === "_NullFlags") break;
          /* falls through */
          default:
            throw new Error("DBF Unsupported data type " + w[I].type);
        }
      }
    }
    if (l != 2 && o.l < o.length && o[o.l++] != 26) throw new Error("DBF EOF Marker missing " + (o.l - 1) + " of " + o.length + " " + o[o.l - 1].toString(16));
    return u && u.sheetRows && (f = f.slice(0, u.sheetRows)), u.DBF = w, f;
  }
  function a(s, u) {
    var f = u || {};
    f.dateNF || (f.dateNF = "yyyymmdd");
    var o = Ca(r(s, f), f);
    return o["!cols"] = f.DBF.map(function(l) {
      return {
        wch: l.len,
        DBF: l
      };
    }), delete f.DBF, o;
  }
  function n(s, u) {
    try {
      var f = qt(a(s, u), u);
      return f.bookType = "dbf", f;
    } catch (o) {
      if (u && u.WTF) throw o;
    }
    return { SheetNames: [], Sheets: {} };
  }
  var i = { B: 8, C: 250, L: 1, D: 8, "?": 0, "": 0 };
  function c(s, u) {
    if (!s["!ref"]) throw new Error("Cannot export empty sheet to DBF");
    var f = u || {}, o = rt;
    if (+f.codepage >= 0 && ft(+f.codepage), f.type == "string") throw new Error("Cannot write DBF to JS string");
    var l = h0(), x = w0(s, { header: 1, raw: !0, cellDates: !0 }), h = x[0], g = x.slice(1), _ = s["!cols"] || [], d = 0, p = 0, w = 0, m = 1;
    for (d = 0; d < h.length; ++d) {
      if (((_[d] || {}).DBF || {}).name) {
        h[d] = _[d].DBF.name, ++w;
        continue;
      }
      if (h[d] != null) {
        if (++w, typeof h[d] == "number" && (h[d] = h[d].toString(10)), typeof h[d] != "string") throw new Error("DBF Invalid column name " + h[d] + " |" + typeof h[d] + "|");
        if (h.indexOf(h[d]) !== d) {
          for (p = 0; p < 1024; ++p)
            if (h.indexOf(h[d] + "_" + p) == -1) {
              h[d] += "_" + p;
              break;
            }
        }
      }
    }
    var y = cr(s["!ref"]), M = [], W = [], I = [];
    for (d = 0; d <= y.e.c - y.s.c; ++d) {
      var L = "", A = "", N = 0, R = [];
      for (p = 0; p < g.length; ++p)
        g[p][d] != null && R.push(g[p][d]);
      if (R.length == 0 || h[d] == null) {
        M[d] = "?";
        continue;
      }
      for (p = 0; p < R.length; ++p) {
        switch (typeof R[p]) {
          /* TODO: check if L2 compat is desired */
          case "number":
            A = "B";
            break;
          case "string":
            A = "C";
            break;
          case "boolean":
            A = "L";
            break;
          case "object":
            A = R[p] instanceof Date ? "D" : "C";
            break;
          default:
            A = "C";
        }
        N = Math.max(N, String(R[p]).length), L = L && L != A ? "C" : A;
      }
      N > 250 && (N = 250), A = ((_[d] || {}).DBF || {}).type, A == "C" && _[d].DBF.len > N && (N = _[d].DBF.len), L == "B" && A == "N" && (L = "N", I[d] = _[d].DBF.dec, N = _[d].DBF.len), W[d] = L == "C" || A == "N" ? N : i[L] || 0, m += W[d], M[d] = L;
    }
    var V = l.next(32);
    for (V.write_shift(4, 318902576), V.write_shift(4, g.length), V.write_shift(2, 296 + 32 * w), V.write_shift(2, m), d = 0; d < 4; ++d) V.write_shift(4, 0);
    var ae = +t[
      /*::String(*/
      rt
      /*::)*/
    ] || 3;
    for (V.write_shift(4, 0 | ae << 8), e[ae] != +f.codepage && (f.codepage && console.error("DBF Unsupported codepage " + rt + ", using 1252"), rt = 1252), d = 0, p = 0; d < h.length; ++d)
      if (h[d] != null) {
        var K = l.next(32), J = (h[d].slice(-10) + "\0\0\0\0\0\0\0\0\0\0\0").slice(0, 11);
        K.write_shift(1, J, "sbcs"), K.write_shift(1, M[d] == "?" ? "C" : M[d], "sbcs"), K.write_shift(4, p), K.write_shift(1, W[d] || i[M[d]] || 0), K.write_shift(1, I[d] || 0), K.write_shift(1, 2), K.write_shift(4, 0), K.write_shift(1, 0), K.write_shift(4, 0), K.write_shift(4, 0), p += W[d] || i[M[d]] || 0;
      }
    var fe = l.next(264);
    for (fe.write_shift(4, 13), d = 0; d < 65; ++d) fe.write_shift(4, 0);
    for (d = 0; d < g.length; ++d) {
      var Y = l.next(m);
      for (Y.write_shift(1, 0), p = 0; p < h.length; ++p)
        if (h[p] != null)
          switch (M[p]) {
            case "L":
              Y.write_shift(1, g[d][p] == null ? 63 : g[d][p] ? 84 : 70);
              break;
            case "B":
              Y.write_shift(8, g[d][p] || 0, "f");
              break;
            case "N":
              var oe = "0";
              for (typeof g[d][p] == "number" && (oe = g[d][p].toFixed(I[p] || 0)), oe.length > W[p] && (oe = oe.slice(0, W[p])), w = 0; w < W[p] - oe.length; ++w) Y.write_shift(1, 32);
              Y.write_shift(1, oe, "sbcs");
              break;
            case "D":
              g[d][p] ? (Y.write_shift(4, ("0000" + g[d][p].getFullYear()).slice(-4), "sbcs"), Y.write_shift(2, ("00" + (g[d][p].getMonth() + 1)).slice(-2), "sbcs"), Y.write_shift(2, ("00" + g[d][p].getDate()).slice(-2), "sbcs")) : Y.write_shift(8, "00000000", "sbcs");
              break;
            case "C":
              var ce = Y.l, re = String(g[d][p] != null ? g[d][p] : "").slice(0, W[p]);
              for (Y.write_shift(1, re, "cpstr"), ce += W[p] - Y.l, w = 0; w < ce; ++w) Y.write_shift(1, 32);
              break;
          }
    }
    return rt = o, l.next(1).write_shift(1, 26), l.end();
  }
  return {
    to_workbook: n,
    to_sheet: a,
    from_sheet: c
  };
})(), Ql = /* @__PURE__ */ (function() {
  var e = {
    AA: "À",
    BA: "Á",
    CA: "Â",
    DA: 195,
    HA: "Ä",
    JA: 197,
    AE: "È",
    BE: "É",
    CE: "Ê",
    HE: "Ë",
    AI: "Ì",
    BI: "Í",
    CI: "Î",
    HI: "Ï",
    AO: "Ò",
    BO: "Ó",
    CO: "Ô",
    DO: 213,
    HO: "Ö",
    AU: "Ù",
    BU: "Ú",
    CU: "Û",
    HU: "Ü",
    Aa: "à",
    Ba: "á",
    Ca: "â",
    Da: 227,
    Ha: "ä",
    Ja: 229,
    Ae: "è",
    Be: "é",
    Ce: "ê",
    He: "ë",
    Ai: "ì",
    Bi: "í",
    Ci: "î",
    Hi: "ï",
    Ao: "ò",
    Bo: "ó",
    Co: "ô",
    Do: 245,
    Ho: "ö",
    Au: "ù",
    Bu: "ú",
    Cu: "û",
    Hu: "ü",
    KC: "Ç",
    Kc: "ç",
    q: "æ",
    z: "œ",
    a: "Æ",
    j: "Œ",
    DN: 209,
    Dn: 241,
    Hy: 255,
    S: 169,
    c: 170,
    R: 174,
    "B ": 180,
    0: 176,
    1: 177,
    2: 178,
    3: 179,
    5: 181,
    6: 182,
    7: 183,
    Q: 185,
    k: 186,
    b: 208,
    i: 216,
    l: 222,
    s: 240,
    y: 248,
    "!": 161,
    '"': 162,
    "#": 163,
    "(": 164,
    "%": 165,
    "'": 167,
    "H ": 168,
    "+": 171,
    ";": 187,
    "<": 188,
    "=": 189,
    ">": 190,
    "?": 191,
    "{": 223
  }, t = new RegExp("\x1BN(" + br(e).join("|").replace(/\|\|\|/, "|\\||").replace(/([?()+])/g, "\\$1").replace("{", "\\{") + "|\\|)", "gm");
  try {
    t = new RegExp("\x1BN(" + br(e).join("|").replace(/\|\|\|/, "|\\||").replace(/([?()+])/g, "\\$1") + "|\\|)", "gm");
  } catch {
  }
  var r = function(h, g) {
    var _ = e[g];
    return typeof _ == "number" ? Z0(_) : _;
  }, a = function(h, g, _) {
    var d = g.charCodeAt(0) - 32 << 4 | _.charCodeAt(0) - 48;
    return d == 59 ? h : Z0(d);
  };
  e["|"] = 254;
  var n = function(h) {
    return h.replace(/\n/g, "\x1B :").replace(/\r/g, "\x1B =");
  };
  function i(h, g) {
    switch (g.type) {
      case "base64":
        return c(qr(h), g);
      case "binary":
        return c(h, g);
      case "buffer":
        return c(Xe && Buffer.isBuffer(h) ? h.toString("binary") : It(h), g);
      case "array":
        return c(ia(h), g);
    }
    throw new Error("Unrecognized type " + g.type);
  }
  function c(h, g) {
    var _ = h.split(/[\n\r]+/), d = -1, p = -1, w = 0, m = 0, y = [], M = [], W = null, I = {}, L = [], A = [], N = [], R = 0, V, ae = { Workbook: { WBProps: {}, Names: [] } };
    for (+g.codepage >= 0 && ft(+g.codepage); w !== _.length; ++w) {
      R = 0;
      var K = _[w].trim().replace(/\x1B([\x20-\x2F])([\x30-\x3F])/g, a).replace(t, r), J = K.replace(/;;/g, "\0").split(";").map(function(P) {
        return P.replace(/\u0000/g, ";");
      }), fe = J[0], Y;
      if (K.length > 0) switch (fe) {
        case "ID":
          break;
        /* header */
        case "E":
          break;
        /* EOF */
        case "B":
          break;
        /* dimensions */
        case "O":
          for (m = 1; m < J.length; ++m) switch (J[m].charAt(0)) {
            case "V":
              {
                var oe = parseInt(J[m].slice(1), 10);
                oe >= 1 && oe <= 4 && (ae.Workbook.WBProps.date1904 = !0);
              }
              break;
          }
          break;
        case "W":
          break;
        /* window */
        case "P":
          J[1].charAt(0) === "P" && M.push(K.slice(3).replace(/;;/g, ";"));
          break;
        case "NN":
          {
            var ce = { Sheet: 0 };
            for (m = 1; m < J.length; ++m) switch (J[m].charAt(0)) {
              case "N":
                ce.Name = J[m].slice(1);
                break;
              case "E":
                ce.Ref = (g && g.sheet || "Sheet1") + "!" + ta(J[m].slice(1));
                break;
            }
            ae.Workbook.Names.push(ce);
          }
          break;
        // case 'NE': // ??
        // case 'NU': // ??
        case "C":
          var re = !1, De = !1, be = !1, de = !1, ie = -1, Se = -1, _e = "", Ne = "z", S = "";
          for (m = 1; m < J.length; ++m) switch (J[m].charAt(0)) {
            case "A":
              S = J[m].slice(1);
              break;
            // TODO: comment
            case "X":
              p = parseInt(J[m].slice(1), 10) - 1, De = !0;
              break;
            case "Y":
              for (d = parseInt(J[m].slice(1), 10) - 1, De || (p = 0), V = y.length; V <= d; ++V) y[V] = [];
              break;
            case "K":
              Y = J[m].slice(1), Y.charAt(0) === '"' ? (Y = Y.slice(1, Y.length - 1), Ne = "s") : Y === "TRUE" || Y === "FALSE" ? (Y = Y === "TRUE", Ne = "b") : Y.charAt(0) == "#" && Tr[Y] != null ? (Ne = "e", Y = Tr[Y]) : isNaN(zr(Y)) || (Y = zr(Y), Ne = "n", W !== null && lt(W) && g.cellDates && (Y = Vt(ae.Workbook.WBProps.date1904 ? Y + 1462 : Y), Ne = typeof Y == "number" ? "n" : "d")), re = !0;
              break;
            case "E":
              de = !0, _e = ta(J[m].slice(1), { r: d, c: p });
              break;
            case "S":
              be = !0;
              break;
            case "G":
              break;
            // unknown
            case "R":
              ie = parseInt(J[m].slice(1), 10) - 1;
              break;
            case "C":
              Se = parseInt(J[m].slice(1), 10) - 1;
              break;
            // case 'P': // ??
            // case 'D': // ??
            default:
              if (g && g.WTF) throw new Error("SYLK bad record " + K);
          }
          if (re && (y[d][p] ? (y[d][p].t = Ne, y[d][p].v = Y) : y[d][p] = { t: Ne, v: Y }, W && (y[d][p].z = W), g.cellText !== !1 && W && (y[d][p].w = $r(y[d][p].z, y[d][p].v, { date1904: ae.Workbook.WBProps.date1904 })), W = null), be) {
            if (de) throw new Error("SYLK shared formula cannot have own formula");
            var G = ie > -1 && y[ie][Se];
            if (!G || !G[1]) throw new Error("SYLK shared formula cannot find base");
            _e = Uc(G[1], { r: d - ie, c: p - Se });
          }
          _e && (y[d][p] ? y[d][p].f = _e : y[d][p] = { t: "n", f: _e }), S && (y[d][p] || (y[d][p] = { t: "z" }), y[d][p].c = [{ a: "SheetJSYLK", t: S }]);
          break;
        case "F":
          var H = 0;
          for (m = 1; m < J.length; ++m) switch (J[m].charAt(0)) {
            case "X":
              p = parseInt(J[m].slice(1), 10) - 1, ++H;
              break;
            case "Y":
              for (d = parseInt(J[m].slice(1), 10) - 1, V = y.length; V <= d; ++V) y[V] = [];
              break;
            case "M":
              R = parseInt(J[m].slice(1), 10) / 20;
              break;
            case "F":
              break;
            /* ??? */
            case "G":
              break;
            /* hide grid */
            case "P":
              W = M[parseInt(J[m].slice(1), 10)];
              break;
            case "S":
              break;
            /* cell style */
            case "D":
              break;
            /* column */
            case "N":
              break;
            /* font */
            case "W":
              for (N = J[m].slice(1).split(" "), V = parseInt(N[0], 10); V <= parseInt(N[1], 10); ++V)
                R = parseInt(N[2], 10), A[V - 1] = R === 0 ? { hidden: !0 } : { wch: R };
              break;
            case "C":
              p = parseInt(J[m].slice(1), 10) - 1, A[p] || (A[p] = {});
              break;
            case "R":
              d = parseInt(J[m].slice(1), 10) - 1, L[d] || (L[d] = {}), R > 0 ? (L[d].hpt = R, L[d].hpx = Za(R)) : R === 0 && (L[d].hidden = !0);
              break;
            // case 'K': // ??
            // case 'E': // ??
            default:
              if (g && g.WTF) throw new Error("SYLK bad record " + K);
          }
          H < 1 && (W = null);
          break;
        default:
          if (g && g.WTF) throw new Error("SYLK bad record " + K);
      }
    }
    return L.length > 0 && (I["!rows"] = L), A.length > 0 && (I["!cols"] = A), A.forEach(function(P) {
      Da(P);
    }), g && g.sheetRows && (y = y.slice(0, g.sheetRows)), [y, I, ae];
  }
  function s(h, g) {
    var _ = i(h, g), d = _[0], p = _[1], w = _[2], m = Ze(g);
    m.date1904 = (((w || {}).Workbook || {}).WBProps || {}).date1904;
    var y = Ca(d, m);
    br(p).forEach(function(W) {
      y[W] = p[W];
    });
    var M = qt(y, g);
    return br(w).forEach(function(W) {
      M[W] = w[W];
    }), M.bookType = "sylk", M;
  }
  function u(h, g, _, d, p, w) {
    var m = "C;Y" + (_ + 1) + ";X" + (d + 1) + ";K";
    switch (h.t) {
      case "n":
        m += isFinite(h.v) ? h.v || 0 : Ur[isNaN(h.v) ? 36 : 7], h.f && !h.F && (m += ";E" + t2(h.f, { r: _, c: d }));
        break;
      case "b":
        m += h.v ? "TRUE" : "FALSE";
        break;
      case "e":
        m += h.w || Ur[h.v] || h.v;
        break;
      case "d":
        m += mr(kr(h.v, w), w);
        break;
      case "s":
        m += '"' + (h.v == null ? "" : String(h.v)).replace(/"/g, "").replace(/;/g, ";;") + '"';
        break;
    }
    return m;
  }
  function f(h, g, _) {
    var d = "C;Y" + (g + 1) + ";X" + (_ + 1) + ";A";
    return d += n(h.map(function(p) {
      return p.t;
    }).join("")), d;
  }
  function o(h, g) {
    g.forEach(function(_, d) {
      var p = "F;W" + (d + 1) + " " + (d + 1) + " ";
      _.hidden ? p += "0" : (typeof _.width == "number" && !_.wpx && (_.wpx = Rt(_.width)), typeof _.wpx == "number" && !_.wch && (_.wch = oa(_.wpx)), typeof _.wch == "number" && (p += Math.round(_.wch))), p.charAt(p.length - 1) != " " && h.push(p);
    });
  }
  function l(h, g) {
    g.forEach(function(_, d) {
      var p = "F;";
      _.hidden ? p += "M0;" : _.hpt ? p += "M" + 20 * _.hpt + ";" : _.hpx && (p += "M" + 20 * Oc(_.hpx) + ";"), p.length > 2 && h.push(p + "R" + (d + 1));
    });
  }
  function x(h, g, _) {
    g || (g = {}), g._formats = ["General"];
    var d = ["ID;PSheetJS;N;E"], p = [], w = cr(h["!ref"] || "A1"), m, y = h["!data"] != null, M = `\r
`, W = (((_ || {}).Workbook || {}).WBProps || {}).date1904, I = "General";
    d.push("P;PGeneral");
    var L = w.s.r, A = w.s.c, N = [];
    if (h["!ref"]) {
      for (L = w.s.r; L <= w.e.r; ++L)
        if (!(y && !h["!data"][L])) {
          for (N = [], A = w.s.c; A <= w.e.c; ++A)
            m = y ? h["!data"][L][A] : h[Je(A) + er(L)], !(!m || !m.c) && N.push(f(m.c, L, A));
          N.length && p.push(N.join(M));
        }
    }
    if (h["!ref"]) {
      for (L = w.s.r; L <= w.e.r; ++L)
        if (!(y && !h["!data"][L])) {
          for (N = [], A = w.s.c; A <= w.e.c; ++A)
            if (m = y ? h["!data"][L][A] : h[Je(A) + er(L)], !(!m || m.v == null && (!m.f || m.F))) {
              if ((m.z || (m.t == "d" ? Le[14] : "General")) != I) {
                var R = g._formats.indexOf(m.z);
                R == -1 && (g._formats.push(m.z), R = g._formats.length - 1, d.push("P;P" + m.z.replace(/;/g, ";;"))), N.push("F;P" + R + ";Y" + (L + 1) + ";X" + (A + 1));
              }
              N.push(u(m, h, L, A, g, W));
            }
          p.push(N.join(M));
        }
    }
    return d.push("F;P0;DG0G8;M255"), h["!cols"] && o(d, h["!cols"]), h["!rows"] && l(d, h["!rows"]), h["!ref"] && d.push("B;Y" + (w.e.r - w.s.r + 1) + ";X" + (w.e.c - w.s.c + 1) + ";D" + [w.s.c, w.s.r, w.e.c, w.e.r].join(" ")), d.push("O;L;D;B" + (W ? ";V4" : "") + ";K47;G100 0.001"), delete g._formats, d.join(M) + M + p.join(M) + M + "E" + M;
  }
  return {
    to_workbook: s,
    from_sheet: x
  };
})(), eh = /* @__PURE__ */ (function() {
  function e(s, u) {
    switch (u.type) {
      case "base64":
        return t(qr(s), u);
      case "binary":
        return t(s, u);
      case "buffer":
        return t(Xe && Buffer.isBuffer(s) ? s.toString("binary") : It(s), u);
      case "array":
        return t(ia(s), u);
    }
    throw new Error("Unrecognized type " + u.type);
  }
  function t(s, u) {
    for (var f = s.split(`
`), o = -1, l = -1, x = 0, h = []; x !== f.length; ++x) {
      if (f[x].trim() === "BOT") {
        h[++o] = [], l = 0;
        continue;
      }
      if (!(o < 0)) {
        var g = f[x].trim().split(","), _ = g[0], d = g[1];
        ++x;
        for (var p = f[x] || ""; (p.match(/["]/g) || []).length & 1 && x < f.length - 1; ) p += `
` + f[++x];
        switch (p = p.trim(), +_) {
          case -1:
            if (p === "BOT") {
              h[++o] = [], l = 0;
              continue;
            } else if (p !== "EOD") throw new Error("Unrecognized DIF special command " + p);
            break;
          case 0:
            p === "TRUE" ? h[o][l] = !0 : p === "FALSE" ? h[o][l] = !1 : isNaN(zr(d)) ? isNaN(Ka(d).getDate()) ? h[o][l] = d : (h[o][l] = kr(d), u && u.UTC || (h[o][l] = sa(h[o][l]))) : h[o][l] = zr(d), ++l;
            break;
          case 1:
            p = p.slice(1, p.length - 1), p = p.replace(/""/g, '"'), p && p.match(/^=".*"$/) && (p = p.slice(2, -1)), h[o][l++] = p !== "" ? p : null;
            break;
        }
        if (p === "EOD") break;
      }
    }
    return u && u.sheetRows && (h = h.slice(0, u.sheetRows)), h;
  }
  function r(s, u) {
    return Ca(e(s, u), u);
  }
  function a(s, u) {
    var f = qt(r(s, u), u);
    return f.bookType = "dif", f;
  }
  function n(s, u) {
    return "0," + String(s) + `\r
` + u;
  }
  function i(s) {
    return `1,0\r
"` + s.replace(/"/g, '""') + '"';
  }
  function c(s) {
    if (!s["!ref"]) throw new Error("Cannot export empty sheet to DIF");
    for (var u = cr(s["!ref"]), f = s["!data"] != null, o = [
      `TABLE\r
0,1\r
"sheetjs"\r
`,
      `VECTORS\r
0,` + (u.e.r - u.s.r + 1) + `\r
""\r
`,
      `TUPLES\r
0,` + (u.e.c - u.s.c + 1) + `\r
""\r
`,
      `DATA\r
0,0\r
""\r
`
    ], l = u.s.r; l <= u.e.r; ++l) {
      for (var x = f ? s["!data"][l] : [], h = `-1,0\r
BOT\r
`, g = u.s.c; g <= u.e.c; ++g) {
        var _ = f ? x && x[g] : s[Ge({ r: l, c: g })];
        if (_ == null) {
          h += `1,0\r
""\r
`;
          continue;
        }
        switch (_.t) {
          case "n":
            _.w != null ? h += "0," + _.w + `\r
V` : _.v != null ? h += n(_.v, "V") : _.f != null && !_.F ? h += i("=" + _.f) : h += `1,0\r
""`;
            break;
          case "b":
            h += _.v ? n(1, "TRUE") : n(0, "FALSE");
            break;
          case "s":
            h += i(isNaN(+_.v) ? _.v : '="' + _.v + '"');
            break;
          case "d":
            _.w || (_.w = $r(_.z || Le[14], mr(kr(_.v)))), h += n(_.w, "V");
            break;
          default:
            h += `1,0\r
""`;
        }
        h += `\r
`;
      }
      o.push(h);
    }
    return o.join("") + `-1,0\r
EOD`;
  }
  return {
    to_workbook: a,
    to_sheet: r,
    from_sheet: c
  };
})(), rh = /* @__PURE__ */ (function() {
  function e(l) {
    return l.replace(/\\b/g, "\\").replace(/\\c/g, ":").replace(/\\n/g, `
`);
  }
  function t(l) {
    return l.replace(/\\/g, "\\b").replace(/:/g, "\\c").replace(/\n/g, "\\n");
  }
  function r(l, x) {
    for (var h = l.split(`
`), g = -1, _ = -1, d = 0, p = []; d !== h.length; ++d) {
      var w = h[d].trim().split(":");
      if (w[0] === "cell") {
        var m = Ir(w[1]);
        if (p.length <= m.r) for (g = p.length; g <= m.r; ++g) p[g] || (p[g] = []);
        switch (g = m.r, _ = m.c, w[2]) {
          case "t":
            p[g][_] = e(w[3]);
            break;
          case "v":
            p[g][_] = +w[3];
            break;
          case "vtf":
            var y = w[w.length - 1];
          /* falls through */
          case "vtc":
            w[3] === "nl" ? p[g][_] = !!+w[4] : p[g][_] = w[w.length - 1].charAt(0) == "#" ? { t: "e", v: Tr[w[w.length - 1]] } : +w[4], w[2] == "vtf" && (p[g][_] = [p[g][_], y]);
        }
      }
    }
    return x && x.sheetRows && (p = p.slice(0, x.sheetRows)), p;
  }
  function a(l, x) {
    return Ca(r(l, x), x);
  }
  function n(l, x) {
    return qt(a(l, x), x);
  }
  var i = [
    "socialcalc:version:1.5",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave"
  ].join(`
`), c = [
    "--SocialCalcSpreadsheetControlSave",
    "Content-type: text/plain; charset=UTF-8"
  ].join(`
`) + `
`, s = [
    "# SocialCalc Spreadsheet Control Save",
    "part:sheet"
  ].join(`
`), u = "--SocialCalcSpreadsheetControlSave--";
  function f(l) {
    if (!l || !l["!ref"]) return "";
    for (var x = [], h = [], g, _ = "", d = Nt(l["!ref"]), p = l["!data"] != null, w = d.s.r; w <= d.e.r; ++w)
      for (var m = d.s.c; m <= d.e.c; ++m)
        if (_ = Ge({ r: w, c: m }), g = p ? (l["!data"][w] || [])[m] : l[_], !(!g || g.v == null || g.t === "z")) {
          switch (h = ["cell", _, "t"], g.t) {
            case "s":
              h.push(t(g.v));
              break;
            case "b":
              h[2] = "vt" + (g.f ? "f" : "c"), h[3] = "nl", h[4] = g.v ? "1" : "0", h[5] = t(g.f || (g.v ? "TRUE" : "FALSE"));
              break;
            case "d":
              var y = mr(kr(g.v));
              h[2] = "vtc", h[3] = "nd", h[4] = "" + y, h[5] = g.w || $r(g.z || Le[14], y);
              break;
            case "n":
              isFinite(g.v) ? g.f ? (h[2] = "vtf", h[3] = "n", h[4] = g.v, h[5] = t(g.f)) : (h[2] = "v", h[3] = g.v) : (h[2] = "vt" + (g.f ? "f" : "c"), h[3] = "e" + Ur[isNaN(g.v) ? 36 : 7], h[4] = "0", h[5] = g.f || h[3].slice(1), h[6] = "e", h[7] = h[3].slice(1));
              break;
            case "e":
              continue;
          }
          x.push(h.join(":"));
        }
    return x.push("sheet:c:" + (d.e.c - d.s.c + 1) + ":r:" + (d.e.r - d.s.r + 1) + ":tvf:1"), x.push("valueformat:1:text-wiki"), x.join(`
`);
  }
  function o(l) {
    return [i, c, s, c, f(l), u].join(`
`);
  }
  return {
    to_workbook: n,
    to_sheet: a,
    from_sheet: o
  };
})(), ka = /* @__PURE__ */ (function() {
  function e(o, l, x, h, g) {
    g.raw ? l[x][h] = o : o === "" || (o === "TRUE" ? l[x][h] = !0 : o === "FALSE" ? l[x][h] = !1 : isNaN(zr(o)) ? isNaN(Ka(o).getDate()) ? o.charCodeAt(0) == 35 && Tr[o] != null ? l[x][h] = { t: "e", v: Tr[o], w: o } : l[x][h] = o : l[x][h] = kr(o) : l[x][h] = zr(o));
  }
  function t(o, l) {
    var x = l || {}, h = [];
    if (!o || o.length === 0) return h;
    for (var g = o.split(/[\r\n]/), _ = g.length - 1; _ >= 0 && g[_].length === 0; ) --_;
    for (var d = 10, p = 0, w = 0; w <= _; ++w)
      p = g[w].indexOf(" "), p == -1 ? p = g[w].length : p++, d = Math.max(d, p);
    for (w = 0; w <= _; ++w) {
      h[w] = [];
      var m = 0;
      for (e(g[w].slice(0, d).trim(), h, w, m, x), m = 1; m <= (g[w].length - d) / 10 + 1; ++m)
        e(g[w].slice(d + (m - 1) * 10, d + m * 10).trim(), h, w, m, x);
    }
    return x.sheetRows && (h = h.slice(0, x.sheetRows)), h;
  }
  var r = {
    44: ",",
    9: "	",
    59: ";",
    124: "|"
  }, a = {
    44: 3,
    9: 2,
    59: 1,
    124: 0
  };
  function n(o) {
    for (var l = {}, x = !1, h = 0, g = 0; h < o.length; ++h)
      (g = o.charCodeAt(h)) == 34 ? x = !x : !x && g in r && (l[g] = (l[g] || 0) + 1);
    g = [];
    for (h in l) Object.prototype.hasOwnProperty.call(l, h) && g.push([l[h], h]);
    if (!g.length) {
      l = a;
      for (h in l) Object.prototype.hasOwnProperty.call(l, h) && g.push([l[h], h]);
    }
    return g.sort(function(_, d) {
      return _[0] - d[0] || a[_[1]] - a[d[1]];
    }), r[g.pop()[1]] || 44;
  }
  function i(o, l) {
    var x = l || {}, h = "", g = {};
    x.dense && (g["!data"] = []);
    var _ = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
    o.slice(0, 4) == "sep=" ? o.charCodeAt(5) == 13 && o.charCodeAt(6) == 10 ? (h = o.charAt(4), o = o.slice(7)) : o.charCodeAt(5) == 13 || o.charCodeAt(5) == 10 ? (h = o.charAt(4), o = o.slice(6)) : h = n(o.slice(0, 1024)) : x && x.FS ? h = x.FS : h = n(o.slice(0, 1024));
    var d = 0, p = 0, w = 0, m = 0, y = 0, M = h.charCodeAt(0), W = !1, I = 0, L = o.charCodeAt(0), A = x.dateNF != null ? Ku(x.dateNF) : null;
    function N() {
      var R = o.slice(m, y);
      R.slice(-1) == "\r" && (R = R.slice(0, -1));
      var V = {};
      if (R.charAt(0) == '"' && R.charAt(R.length - 1) == '"' && (R = R.slice(1, -1).replace(/""/g, '"')), x.cellText !== !1 && (V.w = R), R.length === 0) V.t = "z";
      else if (x.raw)
        V.t = "s", V.v = R;
      else if (R.trim().length === 0)
        V.t = "s", V.v = R;
      else if (R.charCodeAt(0) == 61)
        R.charCodeAt(1) == 34 && R.charCodeAt(R.length - 1) == 34 ? (V.t = "s", V.v = R.slice(2, -1).replace(/""/g, '"')) : a2(R) ? (V.t = "s", V.f = R.slice(1), V.v = R) : (V.t = "s", V.v = R);
      else if (R == "TRUE")
        V.t = "b", V.v = !0;
      else if (R == "FALSE")
        V.t = "b", V.v = !1;
      else if (!isNaN(w = zr(R)))
        V.t = "n", V.v = w;
      else if (!isNaN((w = Ka(R)).getDate()) || A && R.match(A)) {
        if (V.z = x.dateNF || Le[14], A && R.match(A)) {
          var ae = Yu(R, x.dateNF, R.match(A) || []);
          w = kr(ae), x && x.UTC === !1 && (w = sa(w));
        } else x && x.UTC === !1 ? w = sa(w) : x.cellText !== !1 && x.dateNF && (V.w = $r(V.z, w));
        x.cellDates ? (V.t = "d", V.v = w) : (V.t = "n", V.v = mr(w)), x.cellNF || delete V.z;
      } else R.charCodeAt(0) == 35 && Tr[R] != null ? (V.t = "e", V.w = R, V.v = Tr[R]) : (V.t = "s", V.v = R);
      if (V.t == "z" || (x.dense ? (g["!data"][d] || (g["!data"][d] = []), g["!data"][d][p] = V) : g[Ge({ c: p, r: d })] = V), m = y + 1, L = o.charCodeAt(m), _.e.c < p && (_.e.c = p), _.e.r < d && (_.e.r = d), I == M) ++p;
      else if (p = 0, ++d, x.sheetRows && x.sheetRows <= d) return !0;
    }
    e: for (; y < o.length; ++y) switch (I = o.charCodeAt(y)) {
      case 34:
        L === 34 && (W = !W);
        break;
      case 13:
        if (W) break;
        o.charCodeAt(y + 1) == 10 && ++y;
      /* falls through */
      case M:
      case 10:
        if (!W && N()) break e;
        break;
    }
    return y - m > 0 && N(), g["!ref"] = He(_), g;
  }
  function c(o, l) {
    return !(l && l.PRN) || l.FS || o.slice(0, 4) == "sep=" || o.indexOf("	") >= 0 || o.indexOf(",") >= 0 || o.indexOf(";") >= 0 ? i(o, l) : Ca(t(o, l), l);
  }
  function s(o, l) {
    var x = "", h = l.type == "string" ? [0, 0, 0, 0] : K0(o, l);
    switch (l.type) {
      case "base64":
        x = qr(o);
        break;
      case "binary":
        x = o;
        break;
      case "buffer":
        l.codepage == 65001 ? x = o.toString("utf8") : (l.codepage, x = Xe && Buffer.isBuffer(o) ? o.toString("binary") : It(o));
        break;
      case "array":
        x = ia(o);
        break;
      case "string":
        x = o;
        break;
      default:
        throw new Error("Unrecognized type " + l.type);
    }
    return h[0] == 239 && h[1] == 187 && h[2] == 191 ? x = Qe(x.slice(3)) : l.type != "string" && l.type != "buffer" && l.codepage == 65001 ? x = Qe(x) : l.type == "binary", x.slice(0, 19) == "socialcalc:version:" ? rh.to_sheet(l.type == "string" ? x : Qe(x), l) : c(x, l);
  }
  function u(o, l) {
    return qt(s(o, l), l);
  }
  function f(o) {
    var l = [];
    if (!o["!ref"]) return "";
    for (var x = cr(o["!ref"]), h, g = o["!data"] != null, _ = x.s.r; _ <= x.e.r; ++_) {
      for (var d = [], p = x.s.c; p <= x.e.c; ++p) {
        var w = Ge({ r: _, c: p });
        if (h = g ? (o["!data"][_] || [])[p] : o[w], !h || h.v == null) {
          d.push("          ");
          continue;
        }
        for (var m = (h.w || (Ot(h), h.w) || "").slice(0, 10); m.length < 10; ) m += " ";
        d.push(m + (p === 0 ? " " : ""));
      }
      l.push(d.join(""));
    }
    return l.join(`
`);
  }
  return {
    to_workbook: u,
    to_sheet: s,
    from_sheet: f
  };
})();
function th(e, t) {
  var r = t || {}, a = !!r.WTF;
  r.WTF = !0;
  try {
    var n = Ql.to_workbook(e, r);
    return r.WTF = a, n;
  } catch (i) {
    if (r.WTF = a, i.message.indexOf("SYLK bad record ID") == -1 && a) throw i;
    return ka.to_workbook(e, t);
  }
}
function ah(e, t) {
  var r = t || {}, a = !!r.WTF;
  r.WTF = !0;
  try {
    var n = eh.to_workbook(e, r);
    if (!n || !n.Sheets) throw "DIF bad workbook";
    var i = n.Sheets[n.SheetNames[0]];
    if (!i || !i["!ref"]) throw "DIF empty worksheet";
    return r.WTF = a, n;
  } catch {
    return r.WTF = a, ka.to_workbook(e, t);
  }
}
var Wa = /* @__PURE__ */ (function() {
  function e(S, G, H) {
    if (S) {
      xr(S, S.l || 0);
      for (var P = H.Enum || de; S.l < S.length; ) {
        var ee = S.read_shift(2), Fe = P[ee] || P[65535], te = S.read_shift(2), ue = S.l + te, se = Fe.f && Fe.f(S, te, H);
        if (S.l = ue, G(se, Fe, ee)) return;
      }
    }
  }
  function t(S, G) {
    switch (G.type) {
      case "base64":
        return a(Gr(qr(S)), G);
      case "binary":
        return a(Gr(S), G);
      case "buffer":
      case "array":
        return a(S, G);
    }
    throw "Unsupported type " + G.type;
  }
  var r = [
    "mmmm",
    "dd-mmm-yyyy",
    "dd-mmm",
    "mmm-yyyy",
    "@",
    // "text"?
    "mm/dd",
    "hh:mm:ss AM/PM",
    // 7
    "hh:mm AM/PM",
    "mm/dd/yyyy",
    "mm/dd",
    "hh:mm:ss",
    "hh:mm"
    // 12
  ];
  function a(S, G) {
    if (!S) return S;
    var H = G || {}, P = {}, ee = "Sheet1", Fe = "", te = 0, ue = {}, se = [], Ce = [], Ae = [];
    H.dense && (Ae = P["!data"] = []);
    var Te = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }, ze = H.sheetRows || 0, Ie = {};
    if (S[4] == 81 && S[5] == 80 && S[6] == 87) return Ne(S, G);
    if (S[2] == 0 && (S[3] == 8 || S[3] == 9) && S.length >= 16 && S[14] == 5 && S[15] === 108)
      throw new Error("Unsupported Works 3 for Mac file");
    if (S[2] == 2)
      H.Enum = de, e(S, function(pe, Or, _r) {
        switch (_r) {
          case 0:
            H.vers = pe, pe >= 4096 && (H.qpro = !0);
            break;
          case 255:
            H.vers = pe, H.works = !0;
            break;
          case 6:
            Te = pe;
            break;
          /* RANGE */
          case 204:
            pe && (Fe = pe);
            break;
          /* SHEETNAMECS */
          case 222:
            Fe = pe;
            break;
          /* SHEETNAMELP */
          case 15:
          /* LABEL */
          case 51:
            (!H.qpro && !H.works || _r == 51) && pe[1].v.charCodeAt(0) < 48 && (pe[1].v = pe[1].v.slice(1)), (H.works || H.works2) && (pe[1].v = pe[1].v.replace(/\r\n/g, `
`));
          /* falls through */
          case 13:
          /* INTEGER */
          case 14:
          /* NUMBER */
          case 16:
            (pe[2] & 112) == 112 && (pe[2] & 15) > 1 && (pe[2] & 15) < 15 && (pe[1].z = H.dateNF || r[(pe[2] & 15) - 1] || Le[14], H.cellDates && (pe[1].v = Vt(pe[1].v), pe[1].t = typeof pe[1].v == "number" ? "n" : "d")), H.qpro && pe[3] > te && (P["!ref"] = He(Te), ue[ee] = P, se.push(ee), P = {}, H.dense && (Ae = P["!data"] = []), Te = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }, te = pe[3], ee = Fe || "Sheet" + (te + 1), Fe = "");
            var rr = H.dense ? (Ae[pe[0].r] || [])[pe[0].c] : P[Ge(pe[0])];
            if (rr) {
              rr.t = pe[1].t, rr.v = pe[1].v, pe[1].z != null && (rr.z = pe[1].z), pe[1].f != null && (rr.f = pe[1].f), Ie = rr;
              break;
            }
            H.dense ? (Ae[pe[0].r] || (Ae[pe[0].r] = []), Ae[pe[0].r][pe[0].c] = pe[1]) : P[Ge(pe[0])] = pe[1], Ie = pe[1];
            break;
          case 21509:
            H.works2 = !0;
            break;
          case 21506:
            pe == 5281 && (Ie.z = "hh:mm:ss", H.cellDates && Ie.t == "n" && (Ie.v = Vt(Ie.v), Ie.t = typeof Ie.v == "number" ? "n" : "d"));
            break;
        }
      }, H);
    else if (S[2] == 26 || S[2] == 14)
      H.Enum = ie, S[2] == 14 && (H.qpro = !0, S.l = 0), e(S, function(pe, Or, _r) {
        switch (_r) {
          case 204:
            ee = pe;
            break;
          /* SHEETNAMECS */
          case 22:
            pe[1].v.charCodeAt(0) < 48 && (pe[1].v = pe[1].v.slice(1)), pe[1].v = pe[1].v.replace(/\x0F./g, function(rr) {
              return String.fromCharCode(rr.charCodeAt(1) - 32);
            }).replace(/\r\n/g, `
`);
          /* falls through */
          case 23:
          /* NUMBER17 */
          case 24:
          /* NUMBER18 */
          case 25:
          /* FORMULA19 */
          case 37:
          /* NUMBER25 */
          case 39:
          /* NUMBER27 */
          case 40:
            if (pe[3] > te && (P["!ref"] = He(Te), ue[ee] = P, se.push(ee), P = {}, H.dense && (Ae = P["!data"] = []), Te = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }, te = pe[3], ee = "Sheet" + (te + 1)), ze > 0 && pe[0].r >= ze) break;
            H.dense ? (Ae[pe[0].r] || (Ae[pe[0].r] = []), Ae[pe[0].r][pe[0].c] = pe[1]) : P[Ge(pe[0])] = pe[1], Te.e.c < pe[0].c && (Te.e.c = pe[0].c), Te.e.r < pe[0].r && (Te.e.r = pe[0].r);
            break;
          case 27:
            pe[14e3] && (Ce[pe[14e3][0]] = pe[14e3][1]);
            break;
          case 1537:
            Ce[pe[0]] = pe[1], pe[0] == te && (ee = pe[1]);
            break;
        }
      }, H);
    else throw new Error("Unrecognized LOTUS BOF " + S[2]);
    if (P["!ref"] = He(Te), ue[Fe || ee] = P, se.push(Fe || ee), !Ce.length) return { SheetNames: se, Sheets: ue };
    for (var Pe = {}, we = [], qe = 0; qe < Ce.length; ++qe) ue[se[qe]] ? (we.push(Ce[qe] || se[qe]), Pe[Ce[qe]] = ue[Ce[qe]] || ue[se[qe]]) : (we.push(Ce[qe]), Pe[Ce[qe]] = { "!ref": "A1" });
    return { SheetNames: we, Sheets: Pe };
  }
  function n(S, G) {
    var H = G || {};
    if (+H.codepage >= 0 && ft(+H.codepage), H.type == "string") throw new Error("Cannot write WK1 to JS string");
    var P = h0();
    if (!S["!ref"]) throw new Error("Cannot export empty sheet to WK1");
    var ee = cr(S["!ref"]), Fe = S["!data"] != null, te = [];
    Vr(P, 0, c(1030)), Vr(P, 6, f(ee));
    for (var ue = Math.min(ee.e.r, 8191), se = ee.s.c; se <= ee.e.c; ++se) te[se] = Je(se);
    for (var Ce = ee.s.r; Ce <= ue; ++Ce) {
      var Ae = er(Ce);
      for (se = ee.s.c; se <= ee.e.c; ++se) {
        var Te = Fe ? (S["!data"][Ce] || [])[se] : S[te[se] + Ae];
        if (!(!Te || Te.t == "z"))
          switch (Te.t) {
            case "n":
              (Te.v | 0) == Te.v && Te.v >= -32768 && Te.v <= 32767 ? Vr(P, 13, d(Ce, se, Te)) : Vr(P, 14, w(Ce, se, Te));
              break;
            case "d":
              var ze = mr(Te.v);
              (ze | 0) == ze && ze >= -32768 && ze <= 32767 ? Vr(P, 13, d(Ce, se, { v: ze, z: Te.z || Le[14] })) : Vr(P, 14, w(Ce, se, { v: ze, z: Te.z || Le[14] }));
              break;
            default:
              var Ie = Ot(Te);
              Vr(P, 15, h(Ce, se, Ie.slice(0, 239)));
          }
      }
    }
    return Vr(P, 1), P.end();
  }
  function i(S, G) {
    var H = G || {};
    if (+H.codepage >= 0 && ft(+H.codepage), H.type == "string") throw new Error("Cannot write WK3 to JS string");
    var P = h0();
    Vr(P, 0, s(S));
    for (var ee = 0, Fe = 0; ee < S.SheetNames.length; ++ee) (S.Sheets[S.SheetNames[ee]] || {})["!ref"] && Vr(P, 27, be(S.SheetNames[ee], Fe++));
    var te = 0;
    for (ee = 0; ee < S.SheetNames.length; ++ee) {
      var ue = S.Sheets[S.SheetNames[ee]];
      if (!(!ue || !ue["!ref"])) {
        for (var se = cr(ue["!ref"]), Ce = ue["!data"] != null, Ae = [], Te = Math.min(se.e.r, 8191), ze = se.s.r; ze <= Te; ++ze)
          for (var Ie = er(ze), Pe = se.s.c; Pe <= se.e.c; ++Pe) {
            ze === se.s.r && (Ae[Pe] = Je(Pe));
            var we = Ae[Pe] + Ie, qe = Ce ? (ue["!data"][ze] || [])[Pe] : ue[we];
            if (!(!qe || qe.t == "z"))
              if (qe.t == "n")
                Vr(P, 23, ae(ze, Pe, te, qe.v));
              else {
                var pe = Ot(qe);
                Vr(P, 22, N(ze, Pe, te, pe.slice(0, 239)));
              }
          }
        ++te;
      }
    }
    return Vr(P, 1), P.end();
  }
  function c(S) {
    var G = dr(2);
    return G.write_shift(2, S), G;
  }
  function s(S) {
    var G = dr(26);
    G.write_shift(2, 4096), G.write_shift(2, 4), G.write_shift(4, 0);
    for (var H = 0, P = 0, ee = 0, Fe = 0; Fe < S.SheetNames.length; ++Fe) {
      var te = S.SheetNames[Fe], ue = S.Sheets[te];
      if (!(!ue || !ue["!ref"])) {
        ++ee;
        var se = Nt(ue["!ref"]);
        H < se.e.r && (H = se.e.r), P < se.e.c && (P = se.e.c);
      }
    }
    return H > 8191 && (H = 8191), G.write_shift(2, H), G.write_shift(1, ee), G.write_shift(1, P), G.write_shift(2, 0), G.write_shift(2, 0), G.write_shift(1, 1), G.write_shift(1, 2), G.write_shift(4, 0), G.write_shift(4, 0), G;
  }
  function u(S, G, H) {
    var P = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
    return G == 8 && H.qpro ? (P.s.c = S.read_shift(1), S.l++, P.s.r = S.read_shift(2), P.e.c = S.read_shift(1), S.l++, P.e.r = S.read_shift(2), P) : (P.s.c = S.read_shift(2), P.s.r = S.read_shift(2), G == 12 && H.qpro && (S.l += 2), P.e.c = S.read_shift(2), P.e.r = S.read_shift(2), G == 12 && H.qpro && (S.l += 2), P.s.c == 65535 && (P.s.c = P.e.c = P.s.r = P.e.r = 0), P);
  }
  function f(S) {
    var G = dr(8);
    return G.write_shift(2, S.s.c), G.write_shift(2, S.s.r), G.write_shift(2, S.e.c), G.write_shift(2, S.e.r), G;
  }
  function o(S, G, H) {
    var P = [{ c: 0, r: 0 }, { t: "n", v: 0 }, 0, 0];
    return H.qpro && H.vers != 20768 ? (P[0].c = S.read_shift(1), P[3] = S.read_shift(1), P[0].r = S.read_shift(2), S.l += 2) : H.works ? (P[0].c = S.read_shift(2), P[0].r = S.read_shift(2), P[2] = S.read_shift(2)) : (P[2] = S.read_shift(1), P[0].c = S.read_shift(2), P[0].r = S.read_shift(2)), P;
  }
  function l(S) {
    return S.z && lt(S.z) ? 240 | (r.indexOf(S.z) + 1 || 2) : 255;
  }
  function x(S, G, H) {
    var P = S.l + G, ee = o(S, G, H);
    if (ee[1].t = "s", (H.vers & 65534) == 20768) {
      S.l++;
      var Fe = S.read_shift(1);
      return ee[1].v = S.read_shift(Fe, "utf8"), ee;
    }
    return H.qpro && S.l++, ee[1].v = S.read_shift(P - S.l, "cstr"), ee;
  }
  function h(S, G, H) {
    var P = dr(7 + H.length);
    P.write_shift(1, 255), P.write_shift(2, G), P.write_shift(2, S), P.write_shift(1, 39);
    for (var ee = 0; ee < P.length; ++ee) {
      var Fe = H.charCodeAt(ee);
      P.write_shift(1, Fe >= 128 ? 95 : Fe);
    }
    return P.write_shift(1, 0), P;
  }
  function g(S, G, H) {
    var P = S.l + G, ee = o(S, G, H);
    if (ee[1].t = "s", H.vers == 20768) {
      var Fe = S.read_shift(1);
      return ee[1].v = S.read_shift(Fe, "utf8"), ee;
    }
    return ee[1].v = S.read_shift(P - S.l, "cstr"), ee;
  }
  function _(S, G, H) {
    var P = o(S, G, H);
    return P[1].v = S.read_shift(2, "i"), P;
  }
  function d(S, G, H) {
    var P = dr(7);
    return P.write_shift(1, l(H)), P.write_shift(2, G), P.write_shift(2, S), P.write_shift(2, H.v, "i"), P;
  }
  function p(S, G, H) {
    var P = o(S, G, H);
    return P[1].v = S.read_shift(8, "f"), P;
  }
  function w(S, G, H) {
    var P = dr(13);
    return P.write_shift(1, l(H)), P.write_shift(2, G), P.write_shift(2, S), P.write_shift(8, H.v, "f"), P;
  }
  function m(S, G, H) {
    var P = S.l + G, ee = o(S, G, H);
    if (ee[1].v = S.read_shift(8, "f"), H.qpro) S.l = P;
    else {
      var Fe = S.read_shift(2);
      I(S.slice(S.l, S.l + Fe), ee), S.l += Fe;
    }
    return ee;
  }
  function y(S, G, H) {
    var P = G & 32768;
    return G &= -32769, G = (P ? S : 0) + (G >= 8192 ? G - 16384 : G), (P ? "" : "$") + (H ? Je(G) : er(G));
  }
  var M = {
    31: ["NA", 0],
    // 0x20: ["ERR", 0],
    33: ["ABS", 1],
    34: ["TRUNC", 1],
    35: ["SQRT", 1],
    36: ["LOG", 1],
    37: ["LN", 1],
    38: ["PI", 0],
    39: ["SIN", 1],
    40: ["COS", 1],
    41: ["TAN", 1],
    42: ["ATAN2", 2],
    43: ["ATAN", 1],
    44: ["ASIN", 1],
    45: ["ACOS", 1],
    46: ["EXP", 1],
    47: ["MOD", 2],
    // 0x30
    49: ["ISNA", 1],
    50: ["ISERR", 1],
    51: ["FALSE", 0],
    52: ["TRUE", 0],
    53: ["RAND", 0],
    54: ["DATE", 3],
    // 0x37 NOW
    // 0x38 PMT
    // 0x39 PV
    // 0x3A FV
    // 0x3B IF
    // 0x3C DAY
    // 0x3D MONTH
    // 0x3E YEAR
    63: ["ROUND", 2],
    64: ["TIME", 3],
    // 0x41 HOUR
    // 0x42 MINUTE
    // 0x43 SECOND
    68: ["ISNUMBER", 1],
    69: ["ISTEXT", 1],
    70: ["LEN", 1],
    71: ["VALUE", 1],
    // 0x48: ["FIXED", ?? 1],
    73: ["MID", 3],
    74: ["CHAR", 1],
    // 0x4B
    // 0x4C FIND
    // 0x4D DATEVALUE
    // 0x4E TIMEVALUE
    // 0x4F CELL
    80: ["SUM", 69],
    81: ["AVERAGEA", 69],
    82: ["COUNTA", 69],
    83: ["MINA", 69],
    84: ["MAXA", 69],
    // 0x55 VLOOKUP
    // 0x56 NPV
    // 0x57 VAR
    // 0x58 STD
    // 0x59 IRR
    // 0x5A HLOOKUP
    // 0x5B DSUM
    // 0x5C DAVERAGE
    // 0x5D DCOUNTA
    // 0x5E DMIN
    // 0x5F DMAX
    // 0x60 DVARP
    // 0x61 DSTDEVP
    // 0x62 INDEX
    // 0x63 COLS
    // 0x64 ROWS
    // 0x65 REPEAT
    102: ["UPPER", 1],
    103: ["LOWER", 1],
    // 0x68 LEFT
    // 0x69 RIGHT
    // 0x6A REPLACE
    107: ["PROPER", 1],
    // 0x6C CELL
    109: ["TRIM", 1],
    // 0x6E CLEAN
    111: ["T", 1]
    // 0x70 V
  }, W = [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    // eslint-disable-line no-mixed-spaces-and-tabs
    "",
    "+",
    "-",
    "*",
    "/",
    "^",
    "=",
    "<>",
    // eslint-disable-line no-mixed-spaces-and-tabs
    "<=",
    ">=",
    "<",
    ">",
    "",
    "",
    "",
    "",
    // eslint-disable-line no-mixed-spaces-and-tabs
    "&",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
    // eslint-disable-line no-mixed-spaces-and-tabs
  ];
  function I(S, G) {
    xr(S, 0);
    for (var H = [], P = 0, ee = "", Fe = "", te = "", ue = ""; S.l < S.length; ) {
      var se = S[S.l++];
      switch (se) {
        case 0:
          H.push(S.read_shift(8, "f"));
          break;
        case 1:
          Fe = y(G[0].c, S.read_shift(2), !0), ee = y(G[0].r, S.read_shift(2), !1), H.push(Fe + ee);
          break;
        case 2:
          {
            var Ce = y(G[0].c, S.read_shift(2), !0), Ae = y(G[0].r, S.read_shift(2), !1);
            Fe = y(G[0].c, S.read_shift(2), !0), ee = y(G[0].r, S.read_shift(2), !1), H.push(Ce + Ae + ":" + Fe + ee);
          }
          break;
        case 3:
          if (S.l < S.length) {
            console.error("WK1 premature formula end");
            return;
          }
          break;
        case 4:
          H.push("(" + H.pop() + ")");
          break;
        case 5:
          H.push(S.read_shift(2));
          break;
        case 6:
          {
            for (var Te = ""; se = S[S.l++]; ) Te += String.fromCharCode(se);
            H.push('"' + Te.replace(/"/g, '""') + '"');
          }
          break;
        case 8:
          H.push("-" + H.pop());
          break;
        case 23:
          H.push("+" + H.pop());
          break;
        case 22:
          H.push("NOT(" + H.pop() + ")");
          break;
        case 20:
        case 21:
          ue = H.pop(), te = H.pop(), H.push(["AND", "OR"][se - 20] + "(" + te + "," + ue + ")");
          break;
        default:
          if (se < 32 && W[se])
            ue = H.pop(), te = H.pop(), H.push(te + W[se] + ue);
          else if (M[se]) {
            if (P = M[se][1], P == 69 && (P = S[S.l++]), P > H.length) {
              console.error("WK1 bad formula parse 0x" + se.toString(16) + ":|" + H.join("|") + "|");
              return;
            }
            var ze = H.slice(-P);
            H.length -= P, H.push(M[se][0] + "(" + ze.join(",") + ")");
          } else return se <= 7 ? console.error("WK1 invalid opcode " + se.toString(16)) : se <= 24 ? console.error("WK1 unsupported op " + se.toString(16)) : se <= 30 ? console.error("WK1 invalid opcode " + se.toString(16)) : se <= 115 ? console.error("WK1 unsupported function opcode " + se.toString(16)) : console.error("WK1 unrecognized opcode " + se.toString(16));
      }
    }
    H.length == 1 ? G[1].f = "" + H[0] : console.error("WK1 bad formula parse |" + H.join("|") + "|");
  }
  function L(S) {
    var G = [{ c: 0, r: 0 }, { t: "n", v: 0 }, 0];
    return G[0].r = S.read_shift(2), G[3] = S[S.l++], G[0].c = S[S.l++], G;
  }
  function A(S, G) {
    var H = L(S);
    return H[1].t = "s", H[1].v = S.read_shift(G - 4, "cstr"), H;
  }
  function N(S, G, H, P) {
    var ee = dr(6 + P.length);
    ee.write_shift(2, S), ee.write_shift(1, H), ee.write_shift(1, G), ee.write_shift(1, 39);
    for (var Fe = 0; Fe < P.length; ++Fe) {
      var te = P.charCodeAt(Fe);
      ee.write_shift(1, te >= 128 ? 95 : te);
    }
    return ee.write_shift(1, 0), ee;
  }
  function R(S, G) {
    var H = L(S);
    H[1].v = S.read_shift(2);
    var P = H[1].v >> 1;
    if (H[1].v & 1)
      switch (P & 7) {
        case 0:
          P = (P >> 3) * 5e3;
          break;
        case 1:
          P = (P >> 3) * 500;
          break;
        case 2:
          P = (P >> 3) / 20;
          break;
        case 3:
          P = (P >> 3) / 200;
          break;
        case 4:
          P = (P >> 3) / 2e3;
          break;
        case 5:
          P = (P >> 3) / 2e4;
          break;
        case 6:
          P = (P >> 3) / 16;
          break;
        case 7:
          P = (P >> 3) / 64;
          break;
      }
    return H[1].v = P, H;
  }
  function V(S, G) {
    var H = L(S), P = S.read_shift(4), ee = S.read_shift(4), Fe = S.read_shift(2);
    if (Fe == 65535)
      return P === 0 && ee === 3221225472 ? (H[1].t = "e", H[1].v = 15) : P === 0 && ee === 3489660928 ? (H[1].t = "e", H[1].v = 42) : H[1].v = 0, H;
    var te = Fe & 32768;
    return Fe = (Fe & 32767) - 16446, H[1].v = (1 - te * 2) * (ee * Math.pow(2, Fe + 32) + P * Math.pow(2, Fe)), H;
  }
  function ae(S, G, H, P) {
    var ee = dr(14);
    if (ee.write_shift(2, S), ee.write_shift(1, H), ee.write_shift(1, G), P == 0)
      return ee.write_shift(4, 0), ee.write_shift(4, 0), ee.write_shift(2, 65535), ee;
    var Fe = 0, te = 0, ue = 0, se = 0;
    return P < 0 && (Fe = 1, P = -P), te = Math.log2(P) | 0, P /= Math.pow(2, te - 31), se = P >>> 0, (se & 2147483648) == 0 && (P /= 2, ++te, se = P >>> 0), P -= se, se |= 2147483648, se >>>= 0, P *= Math.pow(2, 32), ue = P >>> 0, ee.write_shift(4, ue), ee.write_shift(4, se), te += 16383 + (Fe ? 32768 : 0), ee.write_shift(2, te), ee;
  }
  function K(S, G) {
    var H = V(S);
    return S.l += G - 14, H;
  }
  function J(S, G) {
    var H = L(S), P = S.read_shift(4);
    return H[1].v = P >> 6, H;
  }
  function fe(S, G) {
    var H = L(S), P = S.read_shift(8, "f");
    return H[1].v = P, H;
  }
  function Y(S, G) {
    var H = fe(S);
    return S.l += G - 12, H;
  }
  function oe(S, G) {
    return S[S.l + G - 1] == 0 ? S.read_shift(G, "cstr") : "";
  }
  function ce(S, G) {
    var H = S[S.l++];
    H > G - 1 && (H = G - 1);
    for (var P = ""; P.length < H; ) P += String.fromCharCode(S[S.l++]);
    return P;
  }
  function re(S, G, H) {
    if (!(!H.qpro || G < 21)) {
      var P = S.read_shift(1);
      S.l += 17, S.l += 1, S.l += 2;
      var ee = S.read_shift(G - 21, "cstr");
      return [P, ee];
    }
  }
  function De(S, G) {
    for (var H = {}, P = S.l + G; S.l < P; ) {
      var ee = S.read_shift(2);
      if (ee == 14e3) {
        for (H[ee] = [0, ""], H[ee][0] = S.read_shift(2); S[S.l]; )
          H[ee][1] += String.fromCharCode(S[S.l]), S.l++;
        S.l++;
      }
    }
    return H;
  }
  function be(S, G) {
    var H = dr(5 + S.length);
    H.write_shift(2, 14e3), H.write_shift(2, G);
    for (var P = 0; P < S.length; ++P) {
      var ee = S.charCodeAt(P);
      H[H.l++] = ee > 127 ? 95 : ee;
    }
    return H[H.l++] = 0, H;
  }
  var de = {
    0: { n: "BOF", f: ur },
    1: { n: "EOF" },
    2: { n: "CALCMODE" },
    3: { n: "CALCORDER" },
    4: { n: "SPLIT" },
    5: { n: "SYNC" },
    6: { n: "RANGE", f: u },
    7: { n: "WINDOW1" },
    8: { n: "COLW1" },
    9: { n: "WINTWO" },
    10: { n: "COLW2" },
    11: { n: "NAME" },
    12: { n: "BLANK" },
    13: { n: "INTEGER", f: _ },
    14: { n: "NUMBER", f: p },
    15: { n: "LABEL", f: x },
    16: { n: "FORMULA", f: m },
    24: { n: "TABLE" },
    25: { n: "ORANGE" },
    26: { n: "PRANGE" },
    27: { n: "SRANGE" },
    28: { n: "FRANGE" },
    29: { n: "KRANGE1" },
    32: { n: "HRANGE" },
    35: { n: "KRANGE2" },
    36: { n: "PROTEC" },
    37: { n: "FOOTER" },
    38: { n: "HEADER" },
    39: { n: "SETUP" },
    40: { n: "MARGINS" },
    41: { n: "LABELFMT" },
    42: { n: "TITLES" },
    43: { n: "SHEETJS" },
    45: { n: "GRAPH" },
    46: { n: "NGRAPH" },
    47: { n: "CALCCOUNT" },
    48: { n: "UNFORMATTED" },
    49: { n: "CURSORW12" },
    50: { n: "WINDOW" },
    51: { n: "STRING", f: g },
    55: { n: "PASSWORD" },
    56: { n: "LOCKED" },
    60: { n: "QUERY" },
    61: { n: "QUERYNAME" },
    62: { n: "PRINT" },
    63: { n: "PRINTNAME" },
    64: { n: "GRAPH2" },
    65: { n: "GRAPHNAME" },
    66: { n: "ZOOM" },
    67: { n: "SYMSPLIT" },
    68: { n: "NSROWS" },
    69: { n: "NSCOLS" },
    70: { n: "RULER" },
    71: { n: "NNAME" },
    72: { n: "ACOMM" },
    73: { n: "AMACRO" },
    74: { n: "PARSE" },
    // 0x0064
    102: { n: "PRANGES??" },
    103: { n: "RRANGES??" },
    104: { n: "FNAME??" },
    105: { n: "MRANGES??" },
    // 0x0096
    // 0x0099
    // 0x009A
    // 0x009B
    // 0x009C
    // 0x00C0
    // 0x00C7
    // 0x00C9
    204: { n: "SHEETNAMECS", f: oe },
    // 0x00CD
    222: { n: "SHEETNAMELP", f: ce },
    255: { n: "BOF", f: ur },
    21506: { n: "WKSNF", f: ur },
    65535: { n: "" }
  }, ie = {
    0: { n: "BOF" },
    1: { n: "EOF" },
    2: { n: "PASSWORD" },
    3: { n: "CALCSET" },
    4: { n: "WINDOWSET" },
    5: { n: "SHEETCELLPTR" },
    6: { n: "SHEETLAYOUT" },
    7: { n: "COLUMNWIDTH" },
    8: { n: "HIDDENCOLUMN" },
    9: { n: "USERRANGE" },
    10: { n: "SYSTEMRANGE" },
    11: { n: "ZEROFORCE" },
    12: { n: "SORTKEYDIR" },
    13: { n: "FILESEAL" },
    14: { n: "DATAFILLNUMS" },
    15: { n: "PRINTMAIN" },
    16: { n: "PRINTSTRING" },
    17: { n: "GRAPHMAIN" },
    18: { n: "GRAPHSTRING" },
    19: { n: "??" },
    20: { n: "ERRCELL" },
    21: { n: "NACELL" },
    22: { n: "LABEL16", f: A },
    23: { n: "NUMBER17", f: V },
    24: { n: "NUMBER18", f: R },
    25: { n: "FORMULA19", f: K },
    26: { n: "FORMULA1A" },
    27: { n: "XFORMAT", f: De },
    28: { n: "DTLABELMISC" },
    29: { n: "DTLABELCELL" },
    30: { n: "GRAPHWINDOW" },
    31: { n: "CPA" },
    32: { n: "LPLAUTO" },
    33: { n: "QUERY" },
    34: { n: "HIDDENSHEET" },
    35: { n: "??" },
    37: { n: "NUMBER25", f: J },
    38: { n: "??" },
    39: { n: "NUMBER27", f: fe },
    40: { n: "FORMULA28", f: Y },
    142: { n: "??" },
    147: { n: "??" },
    150: { n: "??" },
    151: { n: "??" },
    152: { n: "??" },
    153: { n: "??" },
    154: { n: "??" },
    155: { n: "??" },
    156: { n: "??" },
    163: { n: "??" },
    174: { n: "??" },
    175: { n: "??" },
    176: { n: "??" },
    177: { n: "??" },
    184: { n: "??" },
    185: { n: "??" },
    186: { n: "??" },
    187: { n: "??" },
    188: { n: "??" },
    195: { n: "??" },
    201: { n: "??" },
    204: { n: "SHEETNAMECS", f: oe },
    205: { n: "??" },
    206: { n: "??" },
    207: { n: "??" },
    208: { n: "??" },
    256: { n: "??" },
    259: { n: "??" },
    260: { n: "??" },
    261: { n: "??" },
    262: { n: "??" },
    263: { n: "??" },
    265: { n: "??" },
    266: { n: "??" },
    267: { n: "??" },
    268: { n: "??" },
    270: { n: "??" },
    271: { n: "??" },
    384: { n: "??" },
    389: { n: "??" },
    390: { n: "??" },
    393: { n: "??" },
    396: { n: "??" },
    512: { n: "??" },
    514: { n: "??" },
    513: { n: "??" },
    516: { n: "??" },
    517: { n: "??" },
    640: { n: "??" },
    641: { n: "??" },
    642: { n: "??" },
    643: { n: "??" },
    644: { n: "??" },
    645: { n: "??" },
    646: { n: "??" },
    647: { n: "??" },
    648: { n: "??" },
    658: { n: "??" },
    659: { n: "??" },
    660: { n: "??" },
    661: { n: "??" },
    662: { n: "??" },
    665: { n: "??" },
    666: { n: "??" },
    768: { n: "??" },
    772: { n: "??" },
    1537: { n: "SHEETINFOQP", f: re },
    1600: { n: "??" },
    1602: { n: "??" },
    1793: { n: "??" },
    1794: { n: "??" },
    1795: { n: "??" },
    1796: { n: "??" },
    1920: { n: "??" },
    2048: { n: "??" },
    2049: { n: "??" },
    2052: { n: "??" },
    2688: { n: "??" },
    10998: { n: "??" },
    12849: { n: "??" },
    28233: { n: "??" },
    28484: { n: "??" },
    65535: { n: "" }
  }, Se = {
    5: "dd-mmm-yy",
    6: "dd-mmm",
    7: "mmm-yy",
    8: "mm/dd/yy",
    // Long Date Intl
    10: "hh:mm:ss AM/PM",
    11: "hh:mm AM/PM",
    14: "dd-mmm-yyyy",
    15: "mmm-yyyy",
    /* It is suspected that the the low nybble specifies decimal places */
    34: "0.00",
    50: "0.00;[Red]0.00",
    66: "0.00;(0.00)",
    82: "0.00;[Red](0.00)",
    162: '"$"#,##0.00;\\("$"#,##0.00\\)',
    288: "0%",
    304: "0E+00",
    320: "# ?/?"
  };
  function _e(S) {
    var G = S.read_shift(2), H = S.read_shift(1);
    if (H != 0) throw "unsupported QPW string type " + H.toString(16);
    return S.read_shift(G, "sbcs-cont");
  }
  function Ne(S, G) {
    xr(S, 0);
    var H = G || {}, P = {};
    H.dense && (P["!data"] = []);
    var ee = [], Fe = "", te = { s: { r: -1, c: -1 }, e: { r: -1, c: -1 } }, ue = 0, se = 0, Ce = 0, Ae = 0, Te = { SheetNames: [], Sheets: {} }, ze = [];
    e: for (; S.l < S.length; ) {
      var Ie = S.read_shift(2), Pe = S.read_shift(2), we = S.slice(S.l, S.l + Pe);
      switch (xr(we, 0), Ie) {
        case 1:
          if (we.read_shift(4) != 962023505) throw "Bad QPW9 BOF!";
          break;
        case 2:
          break e;
        case 8:
          break;
        // TODO: this is tied to custom number formats
        case 10:
          for (var qe = we.read_shift(4), pe = (we.length - we.l) / qe | 0, Or = 0; Or < qe; ++Or) {
            var _r = we.l + pe, rr = {};
            we.l += 2, rr.numFmtId = we.read_shift(2), Se[rr.numFmtId] && (rr.z = Se[rr.numFmtId]), we.l = _r, ze.push(rr);
          }
          break;
        /* TODO: The behavior here should be consistent with Numbers: QP Notebook ~ .TN.SheetArchive, QP Sheet ~ .TST.TableModelArchive */
        case 1025:
          break;
        case 1026:
          break;
        case 1031:
          for (we.l += 12; we.l < we.length; )
            ue = we.read_shift(2), se = we.read_shift(1), ee.push(we.read_shift(ue, "cstr"));
          break;
        case 1032:
          break;
        case 1537:
          {
            var jr = we.read_shift(2);
            P = {}, H.dense && (P["!data"] = []), te.s.c = we.read_shift(2), te.e.c = we.read_shift(2), te.s.r = we.read_shift(4), te.e.r = we.read_shift(4), we.l += 4, we.l + 2 < we.length && (ue = we.read_shift(2), se = we.read_shift(1), Fe = ue == 0 ? "" : we.read_shift(ue, "cstr")), Fe || (Fe = Je(jr));
          }
          break;
        case 1538:
          {
            if (te.s.c > 255 || te.s.r > 999999) break;
            te.e.c < te.s.c && (te.e.c = te.s.c), te.e.r < te.s.r && (te.e.r = te.s.r), P["!ref"] = He(te), on(Te, P, Fe);
          }
          break;
        case 2561:
          Ce = we.read_shift(2), te.e.c < Ce && (te.e.c = Ce), te.s.c > Ce && (te.s.c = Ce), Ae = we.read_shift(4), te.s.r > Ae && (te.s.r = Ae), Ae = we.read_shift(4), te.e.r < Ae && (te.e.r = Ae);
          break;
        case 3073:
          {
            Ae = we.read_shift(4), ue = we.read_shift(4), te.s.r > Ae && (te.s.r = Ae), te.e.r < Ae + ue - 1 && (te.e.r = Ae + ue - 1);
            for (var Kr = Je(Ce); we.l < we.length; ) {
              var Oe = { t: "z" }, nr = we.read_shift(1), vr = -1;
              nr & 128 && (vr = we.read_shift(2));
              var Hr = nr & 64 ? we.read_shift(2) - 1 : 0;
              switch (nr & 31) {
                case 0:
                  break;
                case 1:
                  break;
                case 2:
                  Oe = { t: "n", v: we.read_shift(2) };
                  break;
                case 3:
                  Oe = { t: "n", v: we.read_shift(2, "i") };
                  break;
                case 4:
                  Oe = { t: "n", v: Gn(we) };
                  break;
                case 5:
                  Oe = { t: "n", v: we.read_shift(8, "f") };
                  break;
                case 7:
                  Oe = { t: "s", v: ee[se = we.read_shift(4) - 1] };
                  break;
                case 8:
                  Oe = { t: "n", v: we.read_shift(8, "f") }, we.l += 2, we.l += 4, isNaN(Oe.v) && (Oe = { t: "e", v: 15 });
                  break;
                default:
                  throw "Unrecognized QPW cell type " + (nr & 31);
              }
              vr != -1 && (ze[vr - 1] || {}).z && (Oe.z = ze[vr - 1].z);
              var O = 0;
              if (nr & 32) switch (nr & 31) {
                case 2:
                  O = we.read_shift(2);
                  break;
                case 3:
                  O = we.read_shift(2, "i");
                  break;
                case 7:
                  O = we.read_shift(2);
                  break;
                default:
                  throw "Unsupported delta for QPW cell type " + (nr & 31);
              }
              if (!(!H.sheetStubs && Oe.t == "z")) {
                var Ar = Ze(Oe);
                Oe.t == "n" && Oe.z && lt(Oe.z) && H.cellDates && (Ar.v = Vt(Oe.v), Ar.t = typeof Ar.v == "number" ? "n" : "d"), P["!data"] != null ? (P["!data"][Ae] || (P["!data"][Ae] = []), P["!data"][Ae][Ce] = Ar) : P[Kr + er(Ae)] = Ar;
              }
              for (++Ae, --ue; Hr-- > 0 && ue >= 0; ) {
                if (nr & 32) switch (nr & 31) {
                  case 2:
                    Oe = { t: "n", v: Oe.v + O & 65535 };
                    break;
                  case 3:
                    Oe = { t: "n", v: Oe.v + O & 65535 }, Oe.v > 32767 && (Oe.v -= 65536);
                    break;
                  case 7:
                    Oe = { t: "s", v: ee[se = se + O >>> 0] };
                    break;
                  default:
                    throw "Cannot apply delta for QPW cell type " + (nr & 31);
                }
                else switch (nr & 31) {
                  case 1:
                    Oe = { t: "z" };
                    break;
                  case 2:
                    Oe = { t: "n", v: we.read_shift(2) };
                    break;
                  case 7:
                    Oe = { t: "s", v: ee[se = we.read_shift(4) - 1] };
                    break;
                  default:
                    throw "Cannot apply repeat for QPW cell type " + (nr & 31);
                }
                !H.sheetStubs && Oe.t == "z" || (P["!data"] != null ? (P["!data"][Ae] || (P["!data"][Ae] = []), P["!data"][Ae][Ce] = Oe) : P[Kr + er(Ae)] = Oe), ++Ae, --ue;
              }
            }
          }
          break;
        case 3074:
          {
            Ce = we.read_shift(2), Ae = we.read_shift(4);
            var _t = _e(we);
            P["!data"] != null ? (P["!data"][Ae] || (P["!data"][Ae] = []), P["!data"][Ae][Ce] = { t: "s", v: _t }) : P[Je(Ce) + er(Ae)] = { t: "s", v: _t };
          }
          break;
      }
      S.l += Pe;
    }
    return Te;
  }
  return {
    sheet_to_wk1: n,
    book_to_wk3: i,
    to_workbook: t
  };
})();
function nh(e) {
  var t = {}, r = e.match(pr), a = 0, n = !1;
  if (r) for (; a != r.length; ++a) {
    var i = Ee(r[a]);
    switch (i[0].replace(/<\w*:/g, "<")) {
      /* 18.8.12 condense CT_BooleanProperty */
      /* ** not required . */
      case "<condense":
        break;
      /* 18.8.17 extend CT_BooleanProperty */
      /* ** not required . */
      case "<extend":
        break;
      /* 18.8.36 shadow CT_BooleanProperty */
      /* ** not required . */
      case "<shadow":
        if (!i.val) break;
      /* falls through */
      case "<shadow>":
      case "<shadow/>":
        t.shadow = 1;
        break;
      case "</shadow>":
        break;
      /* 18.4.1 charset CT_IntProperty TODO */
      case "<charset":
        if (i.val == "1") break;
        t.cp = k0[parseInt(i.val, 10)];
        break;
      /* 18.4.2 outline CT_BooleanProperty TODO */
      case "<outline":
        if (!i.val) break;
      /* falls through */
      case "<outline>":
      case "<outline/>":
        t.outline = 1;
        break;
      case "</outline>":
        break;
      /* 18.4.5 rFont CT_FontName */
      case "<rFont":
        t.name = i.val;
        break;
      /* 18.4.11 sz CT_FontSize */
      case "<sz":
        t.sz = i.val;
        break;
      /* 18.4.10 strike CT_BooleanProperty */
      case "<strike":
        if (!i.val) break;
      /* falls through */
      case "<strike>":
      case "<strike/>":
        t.strike = 1;
        break;
      case "</strike>":
        break;
      /* 18.4.13 u CT_UnderlineProperty */
      case "<u":
        if (!i.val) break;
        switch (i.val) {
          case "double":
            t.uval = "double";
            break;
          case "singleAccounting":
            t.uval = "single-accounting";
            break;
          case "doubleAccounting":
            t.uval = "double-accounting";
            break;
        }
      /* falls through */
      case "<u>":
      case "<u/>":
        t.u = 1;
        break;
      case "</u>":
        break;
      /* 18.8.2 b */
      case "<b":
        if (i.val == "0") break;
      /* falls through */
      case "<b>":
      case "<b/>":
        t.b = 1;
        break;
      case "</b>":
        break;
      /* 18.8.26 i */
      case "<i":
        if (i.val == "0") break;
      /* falls through */
      case "<i>":
      case "<i/>":
        t.i = 1;
        break;
      case "</i>":
        break;
      /* 18.3.1.15 color CT_Color TODO: tint, theme, auto, indexed */
      case "<color":
        i.rgb && (t.color = i.rgb.slice(2, 8));
        break;
      case "<color>":
      case "<color/>":
      case "</color>":
        break;
      /* 18.8.18 family ST_FontFamily */
      case "<family":
        t.family = i.val;
        break;
      case "<family>":
      case "<family/>":
      case "</family>":
        break;
      /* 18.4.14 vertAlign CT_VerticalAlignFontProperty TODO */
      case "<vertAlign":
        t.valign = i.val;
        break;
      case "<vertAlign>":
      case "<vertAlign/>":
      case "</vertAlign>":
        break;
      /* 18.8.35 scheme CT_FontScheme TODO */
      case "<scheme":
        break;
      case "<scheme>":
      case "<scheme/>":
      case "</scheme>":
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        n = !0;
        break;
      case "</ext>":
        n = !1;
        break;
      default:
        if (i[0].charCodeAt(1) !== 47 && !n) throw new Error("Unrecognized rich format " + i[0]);
    }
  }
  return t;
}
var ih = /* @__PURE__ */ (function() {
  function e(a) {
    var n = Ye(a, "t");
    if (!n) return { t: "s", v: "" };
    var i = { t: "s", v: Ue(n[1]) }, c = Ye(a, "rPr");
    return c && (i.s = nh(c[1])), i;
  }
  var t = /<(?:\w+:)?r>/g, r = /<\/(?:\w+:)?r>/;
  return function(n) {
    return n.replace(t, "").split(r).map(e).filter(function(i) {
      return i.v;
    });
  };
})(), sh = /* @__PURE__ */ (function() {
  var t = /(\r\n|\n)/g;
  function r(n, i, c) {
    var s = [];
    n.u && s.push("text-decoration: underline;"), n.uval && s.push("text-underline-style:" + n.uval + ";"), n.sz && s.push("font-size:" + n.sz + "pt;"), n.outline && s.push("text-effect: outline;"), n.shadow && s.push("text-shadow: auto;"), i.push('<span style="' + s.join("") + '">'), n.b && (i.push("<b>"), c.push("</b>")), n.i && (i.push("<i>"), c.push("</i>")), n.strike && (i.push("<s>"), c.push("</s>"));
    var u = n.valign || "";
    return u == "superscript" || u == "super" ? u = "sup" : u == "subscript" && (u = "sub"), u != "" && (i.push("<" + u + ">"), c.push("</" + u + ">")), c.push("</span>"), n;
  }
  function a(n) {
    var i = [[], n.v, []];
    return n.v ? (n.s && r(n.s, i[0], i[2]), i[0].join("") + i[1].replace(t, "<br/>") + i[2].join("")) : "";
  }
  return function(i) {
    return i.map(a).join("");
  };
})(), ch = /<(?:\w+:)?t\b[^<>]*>([^<]*)<\/(?:\w+:)?t>/g, uh = /<(?:\w+:)?r\b[^<>]*>/;
function V0(e, t) {
  var r = t ? t.cellHTML : !0, a = {};
  return e ? (e.match(/^\s*<(?:\w+:)?t[^>]*>/) ? (a.t = Ue(Qe(e.slice(e.indexOf(">") + 1).split(/<\/(?:\w+:)?t>/)[0] || ""), !0), a.r = Qe(e), r && (a.h = Ft(a.t))) : (
    /*y = */
    e.match(uh) && (a.r = Qe(e), a.t = Ue(Qe((pf(e, "rPh").match(ch) || []).join("").replace(pr, "")), !0), r && (a.h = sh(ih(a.r))))
  ), a) : { t: "" };
}
var fh = /<(?:\w+:)?(?:si|sstItem)>/g, oh = /<\/(?:\w+:)?(?:si|sstItem)>/;
function lh(e, t) {
  var r = [], a = "";
  if (!e) return r;
  var n = Ye(e, "sst");
  if (n) {
    a = n[1].replace(fh, "").split(oh);
    for (var i = 0; i != a.length; ++i) {
      var c = V0(a[i].trim(), t);
      c != null && (r[r.length] = c);
    }
    n = Ee(n[0].slice(0, n[0].indexOf(">"))), r.Count = n.count, r.Unique = n.uniqueCount;
  }
  return r;
}
function hh(e) {
  return [e.read_shift(4), e.read_shift(4)];
}
function dh(e, t) {
  var r = [], a = !1;
  return Bt(e, function(i, c, s) {
    switch (s) {
      case 159:
        r.Count = i[0], r.Unique = i[1];
        break;
      case 19:
        r.push(i);
        break;
      case 160:
        return !0;
      case 35:
        a = !0;
        break;
      case 36:
        a = !1;
        break;
      default:
        if (c.T, !a || t.WTF) throw new Error("Unexpected record 0x" + s.toString(16));
    }
  }), r;
}
function Fc(e) {
  for (var t = [], r = e.split(""), a = 0; a < r.length; ++a) t[a] = r[a].charCodeAt(0);
  return t;
}
function yt(e, t) {
  var r = {};
  return r.Major = e.read_shift(2), r.Minor = e.read_shift(2), t >= 4 && (e.l += t - 4), r;
}
function xh(e) {
  var t = {};
  return t.id = e.read_shift(0, "lpp4"), t.R = yt(e, 4), t.U = yt(e, 4), t.W = yt(e, 4), t;
}
function ph(e) {
  for (var t = e.read_shift(4), r = e.l + t - 4, a = {}, n = e.read_shift(4), i = []; n-- > 0; ) i.push({ t: e.read_shift(4), v: e.read_shift(0, "lpp4") });
  if (a.name = e.read_shift(0, "lpp4"), a.comps = i, e.l != r) throw new Error("Bad DataSpaceMapEntry: " + e.l + " != " + r);
  return a;
}
function vh(e) {
  var t = [];
  e.l += 4;
  for (var r = e.read_shift(4); r-- > 0; ) t.push(ph(e));
  return t;
}
function gh(e) {
  var t = [];
  e.l += 4;
  for (var r = e.read_shift(4); r-- > 0; ) t.push(e.read_shift(0, "lpp4"));
  return t;
}
function mh(e) {
  var t = {};
  return e.read_shift(4), e.l += 4, t.id = e.read_shift(0, "lpp4"), t.name = e.read_shift(0, "lpp4"), t.R = yt(e, 4), t.U = yt(e, 4), t.W = yt(e, 4), t;
}
function _h(e) {
  var t = mh(e);
  if (t.ename = e.read_shift(0, "8lpp4"), t.blksz = e.read_shift(4), t.cmode = e.read_shift(4), e.read_shift(4) != 4) throw new Error("Bad !Primary record");
  return t;
}
function kc(e, t) {
  var r = e.l + t, a = {};
  a.Flags = e.read_shift(4) & 63, e.l += 4, a.AlgID = e.read_shift(4);
  var n = !1;
  switch (a.AlgID) {
    case 26126:
    case 26127:
    case 26128:
      n = a.Flags == 36;
      break;
    case 26625:
      n = a.Flags == 4;
      break;
    case 0:
      n = a.Flags == 16 || a.Flags == 4 || a.Flags == 36;
      break;
    default:
      throw "Unrecognized encryption algorithm: " + a.AlgID;
  }
  if (!n) throw new Error("Encryption Flags/AlgID mismatch");
  return a.AlgIDHash = e.read_shift(4), a.KeySize = e.read_shift(4), a.ProviderType = e.read_shift(4), e.l += 8, a.CSPName = e.read_shift(r - e.l >> 1, "utf16le"), e.l = r, a;
}
function Dc(e, t) {
  var r = {}, a = e.l + t;
  return e.l += 4, r.Salt = e.slice(e.l, e.l + 16), e.l += 16, r.Verifier = e.slice(e.l, e.l + 16), e.l += 16, e.read_shift(4), r.VerifierHash = e.slice(e.l, a), e.l = a, r;
}
function Eh(e) {
  var t = yt(e);
  switch (t.Minor) {
    case 2:
      return [t.Minor, wh(e)];
    case 3:
      return [t.Minor, Ah()];
    case 4:
      return [t.Minor, Th(e)];
  }
  throw new Error("ECMA-376 Encrypted file unrecognized Version: " + t.Minor);
}
function wh(e) {
  var t = e.read_shift(4);
  if ((t & 63) != 36) throw new Error("EncryptionInfo mismatch");
  var r = e.read_shift(4), a = kc(e, r), n = Dc(e, e.length - e.l);
  return { t: "Std", h: a, v: n };
}
function Ah() {
  throw new Error("File is password-protected: ECMA-376 Extensible");
}
function Th(e) {
  var t = ["saltSize", "blockSize", "keyBits", "hashSize", "cipherAlgorithm", "cipherChaining", "hashAlgorithm", "saltValue"];
  e.l += 4;
  var r = e.read_shift(e.length - e.l, "utf8"), a = {};
  return r.replace(pr, function(i) {
    var c = Ee(i);
    switch (Lr(c[0])) {
      case "<?xml":
        break;
      case "<encryption":
      case "</encryption>":
        break;
      case "<keyData":
        t.forEach(function(s) {
          a[s] = c[s];
        });
        break;
      case "<dataIntegrity":
        a.encryptedHmacKey = c.encryptedHmacKey, a.encryptedHmacValue = c.encryptedHmacValue;
        break;
      case "<keyEncryptors>":
      case "<keyEncryptors":
        a.encs = [];
        break;
      case "</keyEncryptors>":
        break;
      case "<keyEncryptor":
        a.uri = c.uri;
        break;
      case "</keyEncryptor>":
        break;
      case "<encryptedKey":
        a.encs.push(c);
        break;
      default:
        throw c[0];
    }
  }), a;
}
function Fh(e, t) {
  var r = {}, a = r.EncryptionVersionInfo = yt(e, 4);
  if (t -= 4, a.Minor != 2) throw new Error("unrecognized minor version code: " + a.Minor);
  if (a.Major > 4 || a.Major < 2) throw new Error("unrecognized major version code: " + a.Major);
  r.Flags = e.read_shift(4), t -= 4;
  var n = e.read_shift(4);
  return t -= 4, r.EncryptionHeader = kc(e, n), t -= n, r.EncryptionVerifier = Dc(e, t), r;
}
function kh(e) {
  var t = {}, r = t.EncryptionVersionInfo = yt(e, 4);
  if (r.Major != 1 || r.Minor != 1) throw "unrecognized version code " + r.Major + " : " + r.Minor;
  return t.Salt = e.read_shift(16), t.EncryptedVerifier = e.read_shift(16), t.EncryptedVerifierHash = e.read_shift(16), t;
}
function Dh(e) {
  var t = 0, r, a = Fc(e), n = a.length + 1, i, c, s, u, f;
  for (r = Gt(n), r[0] = a.length, i = 1; i != n; ++i) r[i] = a[i - 1];
  for (i = n - 1; i >= 0; --i)
    c = r[i], s = (t & 16384) === 0 ? 0 : 1, u = t << 1 & 32767, f = s | u, t = f ^ c;
  return t ^ 52811;
}
var Cc = /* @__PURE__ */ (function() {
  var e = [187, 255, 255, 186, 255, 255, 185, 128, 0, 190, 15, 0, 191, 15, 0], t = [57840, 7439, 52380, 33984, 4364, 3600, 61902, 12606, 6258, 57657, 54287, 34041, 10252, 43370, 20163], r = [44796, 19929, 39858, 10053, 20106, 40212, 10761, 31585, 63170, 64933, 60267, 50935, 40399, 11199, 17763, 35526, 1453, 2906, 5812, 11624, 23248, 885, 1770, 3540, 7080, 14160, 28320, 56640, 55369, 41139, 20807, 41614, 21821, 43642, 17621, 28485, 56970, 44341, 19019, 38038, 14605, 29210, 60195, 50791, 40175, 10751, 21502, 43004, 24537, 18387, 36774, 3949, 7898, 15796, 31592, 63184, 47201, 24803, 49606, 37805, 14203, 28406, 56812, 17824, 35648, 1697, 3394, 6788, 13576, 27152, 43601, 17539, 35078, 557, 1114, 2228, 4456, 30388, 60776, 51953, 34243, 7079, 14158, 28316, 14128, 28256, 56512, 43425, 17251, 34502, 7597, 13105, 26210, 52420, 35241, 883, 1766, 3532, 4129, 8258, 16516, 33032, 4657, 9314, 18628], a = function(c) {
    return (c / 2 | c * 128) & 255;
  }, n = function(c, s) {
    return a(c ^ s);
  }, i = function(c) {
    for (var s = t[c.length - 1], u = 104, f = c.length - 1; f >= 0; --f)
      for (var o = c[f], l = 0; l != 7; ++l)
        o & 64 && (s ^= r[u]), o *= 2, --u;
    return s;
  };
  return function(c) {
    for (var s = Fc(c), u = i(s), f = s.length, o = Gt(16), l = 0; l != 16; ++l) o[l] = 0;
    var x, h, g;
    for ((f & 1) === 1 && (x = u >> 8, o[f] = n(e[0], x), --f, x = u & 255, h = s[s.length - 1], o[f] = n(h, x)); f > 0; )
      --f, x = u >> 8, o[f] = n(s[f], x), --f, x = u & 255, o[f] = n(s[f], x);
    for (f = 15, g = 15 - s.length; g > 0; )
      x = u >> 8, o[f] = n(e[g], x), --f, --g, x = u & 255, o[f] = n(s[f], x), --f, --g;
    return o;
  };
})(), Ch = function(e, t, r, a, n) {
  n || (n = t), a || (a = Cc(e));
  var i, c;
  for (i = 0; i != t.length; ++i)
    c = t[i], c ^= a[r], c = (c >> 5 | c << 3) & 255, n[i] = c, ++r;
  return [n, r, a];
}, yh = function(e) {
  var t = 0, r = Cc(e);
  return function(a) {
    var n = Ch("", a, t, r);
    return t = n[1], n[0];
  };
};
function Sh(e, t, r, a) {
  var n = { key: ur(e), verificationBytes: ur(e) };
  return r.password && (n.verifier = Dh(r.password)), a.valid = n.verificationBytes === n.verifier, a.valid && (a.insitu = yh(r.password)), n;
}
function bh(e, t, r) {
  var a = r || {};
  return a.Info = e.read_shift(2), e.l -= 2, a.Info === 1 ? a.Data = kh(e) : a.Data = Fh(e, t), a;
}
function Ih(e, t, r) {
  var a = { Type: r.biff >= 8 ? e.read_shift(2) : 0 };
  return a.Type ? bh(e, t - 2, a) : Sh(e, r.biff >= 8 ? t : t - 2, r, a), a;
}
function Nh(e, t) {
  switch (t.type) {
    case "base64":
      return mn(qr(e), t);
    case "binary":
      return mn(e, t);
    case "buffer":
      return mn(Xe && Buffer.isBuffer(e) ? e.toString("binary") : It(e), t);
    case "array":
      return mn(ia(e), t);
  }
  throw new Error("Unrecognized type " + t.type);
}
function mn(e, t) {
  var r = t || {}, a = {}, n = r.dense;
  n && (a["!data"] = []);
  var i = Ct(e, "\\trowd", "\\row");
  if (!i)
    throw new Error("RTF missing table");
  var c = { s: { c: 0, r: 0 }, e: { c: 0, r: i.length - 1 } }, s = [];
  return i.forEach(function(u, f) {
    n && (s = a["!data"][f] = []);
    for (var o = /\\[\w\-]+\b/g, l = 0, x, h = -1, g = []; (x = o.exec(u)) != null; ) {
      var _ = u.slice(l, o.lastIndex - x[0].length);
      switch (_.charCodeAt(0) == 32 && (_ = _.slice(1)), _.length && g.push(_), x[0]) {
        case "\\cell":
          if (++h, g.length) {
            var d = { v: g.join(""), t: "s" };
            d.v == "TRUE" || d.v == "FALSE" ? (d.v = d.v == "TRUE", d.t = "b") : isNaN(zr(d.v)) ? Tr[d.v] != null && (d.t = "e", d.w = d.v, d.v = Tr[d.v]) : (d.t = "n", r.cellText !== !1 && (d.w = d.v), d.v = zr(d.v)), n ? s[h] = d : a[Ge({ r: f, c: h })] = d;
          }
          g = [];
          break;
        case "\\par":
          g.push(`
`);
          break;
      }
      l = o.lastIndex;
    }
    h > c.e.c && (c.e.c = h);
  }), a["!ref"] = He(c), a;
}
function Oh(e, t) {
  var r = qt(Nh(e, t), t);
  return r.bookType = "rtf", r;
}
function Rh(e) {
  var t = e.slice(e[0] === "#" ? 1 : 0).slice(0, 6);
  return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
}
function fa(e) {
  for (var t = 0, r = 1; t != 3; ++t) r = r * 256 + (e[t] > 255 ? 255 : e[t] < 0 ? 0 : e[t]);
  return r.toString(16).toUpperCase().slice(1);
}
function Bh(e) {
  var t = e[0] / 255, r = e[1] / 255, a = e[2] / 255, n = Math.max(t, r, a), i = Math.min(t, r, a), c = n - i;
  if (c === 0) return [0, 0, t];
  var s = 0, u = 0, f = n + i;
  switch (u = c / (f > 1 ? 2 - f : f), n) {
    case t:
      s = ((r - a) / c + 6) % 6;
      break;
    case r:
      s = (a - t) / c + 2;
      break;
    case a:
      s = (t - r) / c + 4;
      break;
  }
  return [s / 6, u, f / 2];
}
function Lh(e) {
  var t = e[0], r = e[1], a = e[2], n = r * 2 * (a < 0.5 ? a : 1 - a), i = a - n / 2, c = [i, i, i], s = 6 * t, u;
  if (r !== 0) switch (s | 0) {
    case 0:
    case 6:
      u = n * s, c[0] += n, c[1] += u;
      break;
    case 1:
      u = n * (2 - s), c[0] += u, c[1] += n;
      break;
    case 2:
      u = n * (s - 2), c[1] += n, c[2] += u;
      break;
    case 3:
      u = n * (4 - s), c[1] += u, c[2] += n;
      break;
    case 4:
      u = n * (s - 4), c[2] += n, c[0] += u;
      break;
    case 5:
      u = n * (6 - s), c[2] += u, c[0] += n;
      break;
  }
  for (var f = 0; f != 3; ++f) c[f] = Math.round(c[f] * 255);
  return c;
}
function W0(e, t) {
  if (t === 0) return e;
  var r = Bh(Rh(e));
  return t < 0 ? r[2] = r[2] * (1 + t) : r[2] = 1 - (1 - r[2]) * (1 - t), fa(Lh(r));
}
function at(e, t) {
  var r = {};
  if (e == null) return r;
  if (e.auto != null && (r.auto = Re(e.auto)), e.rgb != null && (r.rgb = e.rgb.slice(-6).toUpperCase()), e.indexed != null) {
    r.indexed = parseInt(e.indexed, 10), r.index = r.indexed;
    var a = mt[r.indexed];
    r.indexed == 81 && (a = mt[1]), a || (a = mt[1]), a && (r.rgb = fa(a));
  }
  return e.theme != null && (r.theme = parseInt(e.theme, 10), e.tint != null && (r.tint = parseFloat(e.tint)), t && t.themeElements && t.themeElements.clrScheme && t.themeElements.clrScheme[r.theme] && (r.raw_rgb = t.themeElements.clrScheme[r.theme].rgb, r.rgb = W0(r.raw_rgb, r.tint || 0))), e.tint != null && r.tint == null && (r.tint = parseFloat(e.tint)), r;
}
function Zt(e, t) {
  if (!e) return e;
  var r = Ze(e);
  if (r.rgb && (r.rgb = ("" + r.rgb).slice(-6).toUpperCase()), r.indexed != null && !r.rgb) {
    var a = mt[r.indexed];
    r.indexed == 81 && (a = mt[1]), a || (a = mt[1]), a && (r.rgb = fa(a));
  }
  return r.index != null && r.indexed == null && (r.indexed = r.index), r.theme != null && t && t.themeElements && t.themeElements.clrScheme && t.themeElements.clrScheme[r.theme] && (r.raw_rgb = t.themeElements.clrScheme[r.theme].rgb, r.rgb = W0(r.raw_rgb, r.tint || 0)), r;
}
function Dn(e, t) {
  if (!e) return e;
  var r = Ze(e);
  return r.color && (r.color = Zt(r.color, t)), r.fgColor && (r.fgColor = Zt(r.fgColor, t)), r.bgColor && (r.bgColor = Zt(r.bgColor, t)), ["left", "right", "top", "bottom", "diagonal", "horizontal", "vertical", "start", "end"].forEach(function(a) {
    r[a] && r[a].color && (r[a].color = Zt(r[a].color, t));
  }), r.gradientFill && r.gradientFill.stops && r.gradientFill.stops.forEach(function(a) {
    a.color && (a.color = Zt(a.color, t));
  }), r;
}
var yc = 6, Mh = 15, Ph = 1, sr = yc;
function Rt(e) {
  return Math.floor((e + Math.round(128 / sr) / 256) * sr);
}
function oa(e) {
  return Math.floor((e - 5) / sr * 100 + 0.5) / 100;
}
function la(e) {
  return Math.round((e * sr + 5) / sr * 256) / 256;
}
function t0(e) {
  return la(oa(Rt(e)));
}
function G0(e) {
  var t = Math.abs(e - t0(e)), r = sr;
  if (t > 5e-3) for (sr = Ph; sr < Mh; ++sr) Math.abs(e - t0(e)) <= t && (t = Math.abs(e - t0(e)), r = sr);
  sr = r;
}
function Da(e) {
  e.width ? (e.wpx = Rt(e.width), e.wch = oa(e.wpx), e.MDW = sr) : e.wpx ? (e.wch = oa(e.wpx), e.width = la(e.wch), e.MDW = sr) : typeof e.wch == "number" && (e.width = la(e.wch), e.wpx = Rt(e.width), e.MDW = sr), e.customWidth && delete e.customWidth;
}
var x0 = 255, Mi = 5;
function Uh(e) {
  return e > x0 ? x0 : e < 0 ? 0 : e;
}
function Hh(e) {
  var t = la(oa(Math.max(0, e)));
  return Uh(t);
}
function Sc(e) {
  return e ? e.wpx != null ? e.wpx : e.width != null ? Rt(e.width) : e.wch != null ? Rt(la(e.wch)) : 64 : 64;
}
function Vh(e, t) {
  return e || (e = {}), e.wpx = Math.max(0, Math.ceil(t)), e.wch = oa(e.wpx), e.width = Hh(e.wpx), e.MDW = sr, e.bestFit = !0, e.customWidth = !0, e;
}
function Ja(e) {
  var t = e && e.font || {}, r = +t.sz;
  return r > 0 ? r : 11;
}
function Wh(e) {
  var t = e && e.font || {};
  return t.name || "Calibri";
}
function Pi(e) {
  var t = e && e.font || {}, r = [];
  t.italic && r.push("italic"), t.bold && r.push("bold"), r.push(Ja(e) + "pt");
  var a = Wh(e);
  return /[,\s'"]/.test(a) && (a = '"' + String(a).replace(/"/g, '\\"') + '"'), r.push(a), r.join(" ");
}
function Gh(e, t) {
  var r = e.charCodeAt(0);
  return r == 9 || r == 32 ? t * 0.33 : r >= 48 && r <= 57 ? t * 0.52 : r >= 65 && r <= 90 ? t * 0.62 : r >= 97 && r <= 122 ? "iljtfr".indexOf(e) > -1 ? t * 0.28 : "mw".indexOf(e) > -1 ? t * 0.82 : t * 0.5 : r >= 11904 ? t : t * 0.52;
}
function Xh(e, t) {
  for (var r = Qa(Ja(t)), a = 0, n = 0; n < e.length; ++n) a += Gh(e.charAt(n), r);
  return a;
}
function bc(e, t, r) {
  var a = r || {}, n = e == null ? "" : String(e), i = n.split(/\r\n|\n|\r/g), c = 0, s = 0, u = 0;
  if (a.measureText) for (s = 0; s < i.length; ++s)
    u = +a.measureText(i[s], Pi(t), t || {}), isFinite(u) && u > c && (c = u);
  else {
    var f = a.canvas, o = null;
    if (!f && typeof document < "u" && document.createElement) try {
      f = document.createElement("canvas");
    } catch {
    }
    try {
      o = f && f.getContext && f.getContext("2d");
    } catch {
      o = null;
    }
    if (o && o.measureText)
      for (o.font = Pi(t), s = 0; s < i.length; ++s)
        u = o.measureText(i[s]).width, isFinite(u) && u > c && (c = u);
    else for (s = 0; s < i.length; ++s)
      u = Xh(i[s], t || {}), isFinite(u) && u > c && (c = u);
  }
  return c;
}
function zh(e, t) {
  return !e || e.v == null ? "" : (e.w == null && e.t != "z" && Ot(e), String(e.w != null ? e.w : e.v));
}
function qh(e, t) {
  var r = String(e ?? "").split(/\r\n|\n|\r/g), a = [], n = 0, i = 0, c = null;
  if (!t) return r;
  for (n = 0; n < r.length; ++n) {
    for (c = r[n].split(/[\t \u00A0\-\/]+/), i = 0; i < c.length; ++i) c[i] && a.push(c[i]);
    (!c.length || c.length == 1 && !c[0]) && a.push(r[n]);
  }
  return a.length ? a : [""];
}
function $h(e, t, r, a) {
  var n = {}, i = e["!cols"] || [], c = e["!rows"] || [];
  return i[a] && i[a].s && St(n, i[a].s), c[r] && c[r].s && St(n, c[r].s), t && t.s && St(n, t.s), n;
}
function Ic(e, t, r) {
  for (var a = r || {}, n = zh(e), i = t && t.alignment || {}, c = !!i.wrapText, s = qh(n, c), u = 0, f = 0, o = 0; o < s.length; ++o)
    f = bc(s[o], t, a), f > u && (u = f);
  var l = +i.indent || 0;
  l > 0 && (u += l * 3 * Math.max(1, sr));
  var x = +i.textRotation || 0;
  if (x == 255 && (x = 90), x > 90 && (x = 90 - x), x < 0 && (x = -x), x > 0 && x < 90) {
    var h = x * Math.PI / 180, g = Qa(Ja(t));
    u = Math.abs(u * Math.cos(h)) + Math.abs(g * Math.sin(h));
  } else x >= 90 && (u = Math.max(sr + Mi, Qa(Ja(t)) + 2));
  return u + (a.padding != null ? +a.padding : Mi);
}
function jh(e) {
  for (var t = {}, r = 0; r < e.length; ++r) t[e[r].s.r + ":" + e[r].s.c] = e[r];
  return t;
}
function Kh(e, t, r) {
  for (var a = 0; a < e.length; ++a) {
    var n = e[a];
    if (n.s.r <= t && t <= n.e.r && n.s.c <= r && r <= n.e.c) return !(n.s.r == t && n.s.c == r);
  }
  return !1;
}
function p0(e, t) {
  var r = t || {}, a = sr;
  r.MDW && (sr = +r.MDW || sr);
  var n = r.range ? typeof r.range == "string" ? Nt(r.range) : r.range : Nt(e["!ref"] || "A1"), i = e["!cols"] || [], c = e["!rows"] || [], s = [], u = [], f = r.minPx != null ? +r.minPx : r.min != null ? Rt(la(+r.min)) : 0, o = r.maxPx != null ? +r.maxPx : Rt(x0), l = r.includeMerged === !1 ? [] : e["!merges"] || [], x = jh(l), h = e["!data"] != null, g = 0, _ = 0, d = 0, p = null, w = 0, m = null, y = null, M = 0, W = 0;
  for (g = n.s.c; g <= n.e.c; ++g)
    s[g] = Ze(i[g] || {}), !(s[g] && s[g].hidden && r.skipHidden) && (u[g] = s[g] && (s[g].wpx != null || s[g].width != null || s[g].wch != null) ? Sc(s[g]) : f);
  for (_ = n.s.r; _ <= n.e.r; ++_)
    if (!(c[_] && c[_].hidden && r.skipHidden)) {
      for (g = n.s.c; g <= n.e.c; ++g)
        if (!(s[g] && s[g].hidden && r.skipHidden) && !Kh(l, _, g) && (m = h ? (e["!data"][_] || [])[g] : e[Ge({ r: _, c: g })], !(!m || m.v == null)))
          if (y = $h(e, m, _, g), M = Ic(m, y, r), y && y.alignment && y.alignment.shrinkToFit && u[g] && (M = Math.min(M, u[g])), p = x[_ + ":" + g], d = p ? p.e.c - p.s.c + 1 : 1, d > 1) {
            for (W = 0, w = 0; w < d; ++w) W += u[g + w] || f;
            if (M > W) for (w = 0; w < d; ++w) u[g + w] = Math.min(o, Math.max(u[g + w] || f, (u[g + w] || f) + (M - W) / d));
          } else u[g] = Math.min(o, Math.max(u[g] || f, M));
    }
  for (g = n.s.c; g <= n.e.c; ++g) u[g] != null && (s[g] = Vh(s[g] || {}, Math.min(o, Math.max(f, u[g]))));
  return r.set === !1 ? (sr = a, s) : (e["!cols"] = s, sr = a, s);
}
var Yh = 96, Nc = Yh;
function Oc(e) {
  return e * 96 / Nc;
}
function Za(e) {
  return e * Nc / 96;
}
function Qa(e) {
  return e * 96 / 72;
}
function Jh(e) {
  return e * 72 / 96;
}
var Zh = {
  None: "none",
  Solid: "solid",
  Gray50: "mediumGray",
  Gray75: "darkGray",
  Gray25: "lightGray",
  HorzStripe: "darkHorizontal",
  VertStripe: "darkVertical",
  ReverseDiagStripe: "darkDown",
  DiagStripe: "darkUp",
  DiagCross: "darkGrid",
  ThickDiagCross: "darkTrellis",
  ThinHorzStripe: "lightHorizontal",
  ThinVertStripe: "lightVertical",
  ThinReverseDiagStripe: "lightDown",
  ThinHorzCross: "lightGrid"
};
function Qh(e, t, r, a) {
  t.Borders = [];
  var n = {}, i = "", c = !1;
  (e.match(pr) || []).forEach(function(s) {
    var u = Ee(s);
    switch (Lr(u[0])) {
      case "<borders":
      case "<borders>":
      case "</borders>":
        break;
      /* 18.8.4 border CT_Border */
      case "<border":
      case "<border>":
      case "<border/>":
        n = /*::(*/
        {}, u.diagonalUp && (n.diagonalUp = Re(u.diagonalUp)), u.diagonalDown && (n.diagonalDown = Re(u.diagonalDown)), t.Borders.push(n);
        break;
      case "</border>":
        break;
      /* note: not in spec, appears to be CT_BorderPr */
      case "<left/>":
        n.left = {}, u.style && (n.left.style = u.style);
        break;
      case "<left":
      case "<left>":
        i = "left", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</left>":
        i = "";
        break;
      /* note: not in spec, appears to be CT_BorderPr */
      case "<right/>":
        n.right = {}, u.style && (n.right.style = u.style);
        break;
      case "<right":
      case "<right>":
        i = "right", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</right>":
        i = "";
        break;
      /* 18.8.43 top CT_BorderPr */
      case "<top/>":
        n.top = {}, u.style && (n.top.style = u.style);
        break;
      case "<top":
      case "<top>":
        i = "top", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</top>":
        i = "";
        break;
      /* 18.8.6 bottom CT_BorderPr */
      case "<bottom/>":
        n.bottom = {}, u.style && (n.bottom.style = u.style);
        break;
      case "<bottom":
      case "<bottom>":
        i = "bottom", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</bottom>":
        i = "";
        break;
      /* 18.8.13 diagonal CT_BorderPr */
      case "<diagonal/>":
        n.diagonal = {}, u.style && (n.diagonal.style = u.style);
        break;
      case "<diagonal":
      case "<diagonal>":
        i = "diagonal", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</diagonal>":
        i = "";
        break;
      /* 18.8.25 horizontal CT_BorderPr */
      case "<horizontal/>":
        n.horizontal = {}, u.style && (n.horizontal.style = u.style);
        break;
      case "<horizontal":
      case "<horizontal>":
        i = "horizontal", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</horizontal>":
        i = "";
        break;
      /* 18.8.44 vertical CT_BorderPr */
      case "<vertical/>":
        n.vertical = {}, u.style && (n.vertical.style = u.style);
        break;
      case "<vertical":
      case "<vertical>":
        i = "vertical", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</vertical>":
        i = "";
        break;
      /* 18.8.37 start CT_BorderPr */
      case "<start/>":
        n.start = {}, u.style && (n.start.style = u.style);
        break;
      case "<start":
      case "<start>":
        i = "start", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</start>":
        i = "";
        break;
      /* 18.8.16 end CT_BorderPr */
      case "<end/>":
        n.end = {}, u.style && (n.end.style = u.style);
        break;
      case "<end":
      case "<end>":
        i = "end", n[i] = n[i] || {}, u.style && (n[i].style = u.style);
        break;
      case "</end>":
        i = "";
        break;
      /* 18.8.? color CT_Color */
      case "<color":
      case "<color>":
        i && (n[i].color = at(u, r));
        break;
      case "<color/>":
      case "</color>":
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        c = !0;
        break;
      case "</ext>":
        c = !1;
        break;
      default:
        if (a && a.WTF && !c)
          throw new Error("unrecognized " + u[0] + " in borders");
    }
  });
}
function e1(e, t, r, a) {
  t.Fills = [];
  var n = {}, i = null, c = null, s = !1;
  (e.match(pr) || []).forEach(function(u) {
    var f = Ee(u);
    switch (Lr(f[0])) {
      case "<fills":
      case "<fills>":
      case "</fills>":
        break;
      /* 18.8.20 fill CT_Fill */
      case "<fill>":
      case "<fill":
      case "<fill/>":
        n = {}, t.Fills.push(n);
        break;
      case "</fill>":
        break;
      /* 18.8.24 gradientFill CT_GradientFill */
      case "<gradientFill>":
        i = { stops: [] }, n.gradientFill = i;
        break;
      case "<gradientFill":
        i = { stops: [] }, f.type && (i.type = f.type), f.degree && (i.degree = parseFloat(f.degree)), ["left", "right", "top", "bottom"].forEach(function(o) {
          f[o] != null && (i[o] = parseFloat(f[o]));
        }), n.gradientFill = i;
        break;
      case "</gradientFill>":
        i = null;
        break;
      /* 18.8.32 patternFill CT_PatternFill */
      case "<patternFill":
      case "<patternFill>":
        f.patternType && (n.patternType = f.patternType);
        break;
      case "<patternFill/>":
      case "</patternFill>":
        break;
      /* 18.8.3 bgColor CT_Color */
      case "<bgColor":
        n.bgColor = at(f, r);
        break;
      case "<bgColor/>":
      case "</bgColor>":
        break;
      /* 18.8.19 fgColor CT_Color */
      case "<fgColor":
        n.fgColor = at(f, r);
        break;
      case "<fgColor/>":
      case "</fgColor>":
        break;
      /* 18.8.38 stop CT_GradientStop */
      case "<stop":
        c = {}, f.position != null && (c.position = parseFloat(f.position)), i && i.stops.push(c);
        break;
      case "<stop/>":
        i && (c = {}, f.position != null && (c.position = parseFloat(f.position)), i.stops.push(c)), c = null;
        break;
      case "</stop>":
        c = null;
        break;
      /* 18.8.? color CT_Color */
      case "<color":
        c && (c.color = at(f, r));
        break;
      case "<color/>":
        c && (c.color = at(f, r));
        break;
      case "</color>":
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        s = !0;
        break;
      case "</ext>":
        s = !1;
        break;
      default:
        if (a && a.WTF && !s)
          throw new Error("unrecognized " + f[0] + " in fills");
    }
  });
}
function r1(e, t, r, a) {
  t.Fonts = [];
  var n = {}, i = !1;
  (e.match(pr) || []).forEach(function(c) {
    var s = Ee(c);
    switch (Lr(s[0])) {
      case "<fonts":
      case "<fonts>":
      case "</fonts>":
        break;
      /* 18.8.22 font CT_Font */
      case "<font":
      case "<font>":
        break;
      case "</font>":
      case "<font/>":
        t.Fonts.push(n), n = {};
        break;
      /* 18.8.29 name CT_FontName */
      case "<name":
        s.val && (n.name = Qe(s.val));
        break;
      case "<name/>":
      case "</name>":
        break;
      /* 18.8.2  b CT_BooleanProperty */
      case "<b":
        n.bold = s.val ? Re(s.val) : 1;
        break;
      case "<b/>":
        n.bold = 1;
        break;
      case "</b>":
      case "</b":
        break;
      /* 18.8.26 i CT_BooleanProperty */
      case "<i":
        n.italic = s.val ? Re(s.val) : 1;
        break;
      case "<i/>":
        n.italic = 1;
        break;
      case "</i>":
      case "</i":
        break;
      /* 18.4.13 u CT_UnderlineProperty */
      case "<u":
        switch (s.val) {
          case "none":
            n.underline = 0;
            break;
          case "single":
            n.underline = 1;
            break;
          case "double":
            n.underline = 2;
            break;
          case "singleAccounting":
            n.underline = 33;
            break;
          case "doubleAccounting":
            n.underline = 34;
            break;
        }
        break;
      case "<u/>":
        n.underline = 1;
        break;
      case "</u>":
      case "</u":
        break;
      /* 18.4.10 strike CT_BooleanProperty */
      case "<strike":
        n.strike = s.val ? Re(s.val) : 1;
        break;
      case "<strike/>":
        n.strike = 1;
        break;
      case "</strike>":
      case "</strike":
        break;
      /* 18.4.2  outline CT_BooleanProperty */
      case "<outline":
        n.outline = s.val ? Re(s.val) : 1;
        break;
      case "<outline/>":
        n.outline = 1;
        break;
      case "</outline>":
      case "</outline":
        break;
      /* 18.8.36 shadow CT_BooleanProperty */
      case "<shadow":
        n.shadow = s.val ? Re(s.val) : 1;
        break;
      case "<shadow/>":
        n.shadow = 1;
        break;
      case "</shadow>":
      case "</shadow":
        break;
      /* 18.8.12 condense CT_BooleanProperty */
      case "<condense":
        n.condense = s.val ? Re(s.val) : 1;
        break;
      case "<condense/>":
        n.condense = 1;
        break;
      case "</condense>":
      case "</condense":
        break;
      /* 18.8.17 extend CT_BooleanProperty */
      case "<extend":
        n.extend = s.val ? Re(s.val) : 1;
        break;
      case "<extend/>":
        n.extend = 1;
        break;
      case "</extend>":
      case "</extend":
        break;
      /* 18.4.11 sz CT_FontSize */
      case "<sz":
        s.val && (n.sz = +s.val);
        break;
      case "<sz/>":
      case "</sz>":
      case "</sz":
        break;
      /* 18.4.14 vertAlign CT_VerticalAlignFontProperty */
      case "<vertAlign":
        s.val && (n.vertAlign = s.val);
        break;
      case "<vertAlign/>":
      case "</vertAlign>":
      case "</vertAlign":
        break;
      /* 18.8.18 family CT_FontFamily */
      case "<family":
        s.val && (n.family = parseInt(s.val, 10));
        break;
      case "<family/>":
      case "</family>":
      case "</family":
        break;
      /* 18.8.35 scheme CT_FontScheme */
      case "<scheme":
        s.val && (n.scheme = s.val);
        break;
      case "<scheme/>":
      case "</scheme>":
      case "</scheme":
        break;
      /* 18.4.1 charset CT_IntProperty */
      case "<charset":
        if (s.val == "1") break;
        s.codepage = k0[parseInt(s.val, 10)];
        break;
      case "<charset/>":
      case "</charset>":
      case "</charset":
        break;
      /* 18.?.? color CT_Color */
      case "<color":
        n.color = at(s, r);
        break;
      case "<color/>":
      case "</color>":
      case "</color":
        break;
      /* note: sometimes mc:AlternateContent appears bare */
      case "<AlternateContent":
        i = !0;
        break;
      case "</AlternateContent>":
      case "</AlternateContent":
        i = !1;
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        i = !0;
        break;
      case "</ext>":
        i = !1;
        break;
      default:
        if (a && a.WTF && !i)
          throw new Error("unrecognized " + s[0] + " in fonts");
    }
  });
}
function t1(e, t, r) {
  t.NumberFmt = [];
  for (var a = br(Le), n = 0; n < a.length; ++n) t.NumberFmt[a[n]] = Le[a[n]];
  var i = e.match(pr);
  if (i)
    for (n = 0; n < i.length; ++n) {
      var c = Ee(i[n]);
      switch (Lr(c[0])) {
        case "<numFmts":
        case "</numFmts>":
        case "<numFmts/>":
        case "<numFmts>":
          break;
        case "<numFmt":
          {
            var s = Ue(Qe(c.formatCode)), u = parseInt(c.numFmtId, 10);
            if (t.NumberFmt[u] = s, u > 0) {
              if (u > 392) {
                for (u = 392; u > 60 && t.NumberFmt[u] != null; --u) ;
                t.NumberFmt[u] = s;
              }
              Qt(s, u);
            }
          }
          break;
        case "</numFmt>":
          break;
        default:
          if (r.WTF) throw new Error("unrecognized " + c[0] + " in numFmts");
      }
    }
}
var _n = ["numFmtId", "fillId", "fontId", "borderId", "xfId"], En = ["applyAlignment", "applyBorder", "applyFill", "applyFont", "applyNumberFormat", "applyProtection", "pivotButton", "quotePrefix"];
function Rc(e, t, r, a) {
  t[a] = [];
  var n, i = !1;
  (e.match(pr) || []).forEach(function(c) {
    var s = Ee(c), u = 0;
    switch (Lr(s[0])) {
      case "<cellXfs":
      case "<cellXfs>":
      case "<cellXfs/>":
      case "</cellXfs>":
      case "<cellStyleXfs":
      case "<cellStyleXfs>":
      case "<cellStyleXfs/>":
      case "</cellStyleXfs>":
        break;
      /* 18.8.45 xf CT_Xf */
      case "<xf":
      case "<xf/>":
      case "<xf>":
        for (n = s, delete n[0], u = 0; u < _n.length; ++u) n[_n[u]] && (n[_n[u]] = parseInt(n[_n[u]], 10));
        for (u = 0; u < En.length; ++u) n[En[u]] && (n[En[u]] = Re(n[En[u]]));
        if (t.NumberFmt && n.numFmtId > 392) {
          for (u = 392; u > 60; --u) if (t.NumberFmt[n.numFmtId] == t.NumberFmt[u]) {
            n.numFmtId = u;
            break;
          }
        }
        t[a].push(n);
        break;
      case "</xf>":
        break;
      /* 18.8.1 alignment CT_CellAlignment */
      case "<alignment":
      case "<alignment/>":
      case "<alignment>":
        var f = {};
        s.vertical && (f.vertical = s.vertical), s.horizontal && (f.horizontal = s.horizontal), s.textRotation != null && (f.textRotation = parseInt(s.textRotation, 10)), s.indent && (f.indent = parseInt(s.indent, 10)), s.relativeIndent && (f.relativeIndent = parseInt(s.relativeIndent, 10)), s.readingOrder && (f.readingOrder = parseInt(s.readingOrder, 10)), s.wrapText && (f.wrapText = Re(s.wrapText)), s.shrinkToFit && (f.shrinkToFit = Re(s.shrinkToFit)), s.justifyLastLine && (f.justifyLastLine = Re(s.justifyLastLine)), n.alignment = f;
        break;
      case "</alignment>":
        break;
      /* 18.8.33 protection CT_CellProtection */
      case "<protection":
      case "<protection>":
        var o = {};
        s.locked != null && (o.locked = Re(s.locked)), s.hidden != null && (o.hidden = Re(s.hidden)), n.protection = o;
        break;
      case "<protection/>":
        o = {}, s.locked != null && (o.locked = Re(s.locked)), s.hidden != null && (o.hidden = Re(s.hidden)), n.protection = o;
        break;
      case "</protection>":
        break;
      /* note: sometimes mc:AlternateContent appears bare */
      case "<AlternateContent":
      case "<AlternateContent>":
        i = !0;
        break;
      case "</AlternateContent>":
        i = !1;
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        i = !0;
        break;
      case "</ext>":
        i = !1;
        break;
      default:
        if (r && r.WTF && !i)
          throw new Error("unrecognized " + s[0] + " in cellXfs");
    }
  });
}
function a1(e, t, r) {
  Rc(e, t, r, "CellXf");
}
function n1(e, t, r) {
  Rc(e, t, r, "CellStyleXf");
}
function i1(e, t, r) {
  t.CellStyles = [], (e.match(pr) || []).forEach(function(a) {
    var n = Ee(a);
    switch (Lr(n[0])) {
      case "<cellStyles":
      case "<cellStyles>":
      case "<cellStyles/>":
      case "</cellStyles>":
        break;
      case "<cellStyle":
      case "<cellStyle/>":
        delete n[0], n.xfId != null && (n.xfId = parseInt(n.xfId, 10)), n.builtinId != null && (n.builtinId = parseInt(n.builtinId, 10)), n.iLevel != null && (n.iLevel = parseInt(n.iLevel, 10)), n.customBuiltin != null && (n.customBuiltin = Re(n.customBuiltin)), n.hidden != null && (n.hidden = Re(n.hidden)), n.name && (n.name = Qe(n.name)), t.CellStyles.push(n);
        break;
      case "</cellStyle>":
        break;
      default:
        if (r && r.WTF) throw new Error("unrecognized " + n[0] + " in cellStyles");
    }
  });
}
function s1(e, t, r, a) {
  t.Dxfs = [];
  var n = null, i = null, c = null, s = null, u = "", f = !1;
  (e.match(pr) || []).forEach(function(o) {
    var l = Ee(o);
    switch (Lr(l[0])) {
      case "<dxfs":
      case "<dxfs>":
      case "<dxfs/>":
      case "</dxfs>":
        break;
      case "<dxf":
      case "<dxf>":
        n = {}, t.Dxfs.push(n);
        break;
      case "<dxf/>":
        t.Dxfs.push({}), n = null;
        break;
      case "</dxf>":
        n = null;
        break;
      case "<font":
      case "<font>":
        i = {}, n && (n.font = i);
        break;
      case "</font>":
      case "<font/>":
        i = null;
        break;
      case "<name":
        i && l.val && (i.name = Qe(l.val));
        break;
      case "<name/>":
      case "</name>":
        break;
      case "<b":
        i && (i.bold = l.val ? Re(l.val) : 1);
        break;
      case "<b/>":
        i && (i.bold = 1);
        break;
      case "</b>":
        break;
      case "<i":
        i && (i.italic = l.val ? Re(l.val) : 1);
        break;
      case "<i/>":
        i && (i.italic = 1);
        break;
      case "</i>":
        break;
      case "<u":
        i && (i.underline = l.val || 1);
        break;
      case "<u/>":
        i && (i.underline = 1);
        break;
      case "</u>":
        break;
      case "<strike":
        i && (i.strike = l.val ? Re(l.val) : 1);
        break;
      case "<strike/>":
        i && (i.strike = 1);
        break;
      case "</strike>":
        break;
      case "<sz":
        i && l.val && (i.sz = +l.val);
        break;
      case "<sz/>":
      case "</sz>":
        break;
      case "<outline":
        i && (i.outline = l.val ? Re(l.val) : 1);
        break;
      case "<outline/>":
        i && (i.outline = 1);
        break;
      case "</outline>":
        break;
      case "<shadow":
        i && (i.shadow = l.val ? Re(l.val) : 1);
        break;
      case "<shadow/>":
        i && (i.shadow = 1);
        break;
      case "</shadow>":
        break;
      case "<condense":
        i && (i.condense = l.val ? Re(l.val) : 1);
        break;
      case "<condense/>":
        i && (i.condense = 1);
        break;
      case "</condense>":
        break;
      case "<extend":
        i && (i.extend = l.val ? Re(l.val) : 1);
        break;
      case "<extend/>":
        i && (i.extend = 1);
        break;
      case "</extend>":
        break;
      case "<vertAlign":
        i && l.val && (i.vertAlign = l.val);
        break;
      case "<vertAlign/>":
      case "</vertAlign>":
        break;
      case "<family":
        i && l.val && (i.family = parseInt(l.val, 10));
        break;
      case "<family/>":
      case "</family>":
        break;
      case "<scheme":
        i && l.val && (i.scheme = l.val);
        break;
      case "<scheme/>":
      case "</scheme>":
        break;
      case "<charset":
        i && l.val != null && (i.charset = parseInt(l.val, 10));
        break;
      case "<charset/>":
      case "</charset>":
        break;
      case "<color":
        i ? i.color = at(l, r) : u && s && (s[u].color = at(l, r));
        break;
      case "<color/>":
      case "</color>":
        break;
      case "<fill":
      case "<fill>":
        c = {}, n && (n.fill = c);
        break;
      case "<fill/>":
        c = null;
        break;
      case "</fill>":
        c = null;
        break;
      case "<patternFill":
      case "<patternFill>":
        c && l.patternType && (c.patternType = l.patternType);
        break;
      case "<patternFill/>":
      case "</patternFill>":
        break;
      case "<fgColor":
        c && (c.fgColor = at(l, r));
        break;
      case "<fgColor/>":
      case "</fgColor>":
        break;
      case "<bgColor":
        c && (c.bgColor = at(l, r));
        break;
      case "<bgColor/>":
      case "</bgColor>":
        break;
      case "<border":
      case "<border>":
        s = {}, n && (n.border = s);
        break;
      case "<border/>":
        s = null;
        break;
      case "</border>":
        s = null;
        break;
      case "<left":
      case "<left>":
      case "<left/>":
        u = "left", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</left>":
        u = "";
        break;
      case "<right":
      case "<right>":
      case "<right/>":
        u = "right", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</right>":
        u = "";
        break;
      case "<top":
      case "<top>":
      case "<top/>":
        u = "top", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</top>":
        u = "";
        break;
      case "<bottom":
      case "<bottom>":
      case "<bottom/>":
        u = "bottom", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</bottom>":
        u = "";
        break;
      case "<diagonal":
      case "<diagonal>":
      case "<diagonal/>":
        u = "diagonal", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</diagonal>":
        u = "";
        break;
      case "<horizontal":
      case "<horizontal>":
      case "<horizontal/>":
        u = "horizontal", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</horizontal>":
        u = "";
        break;
      case "<vertical":
      case "<vertical>":
      case "<vertical/>":
        u = "vertical", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</vertical>":
        u = "";
        break;
      case "<start":
      case "<start>":
      case "<start/>":
        u = "start", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</start>":
        u = "";
        break;
      case "<end":
      case "<end>":
      case "<end/>":
        u = "end", s && (s[u] = s[u] || {}, l.style && (s[u].style = l.style)), l[0].slice(-2) == "/>" && (u = "");
        break;
      case "</end>":
        u = "";
        break;
      case "<alignment":
        n && (n.alignment = {}, l.vertical && (n.alignment.vertical = l.vertical), l.horizontal && (n.alignment.horizontal = l.horizontal), l.wrapText && (n.alignment.wrapText = Re(l.wrapText)));
        break;
      case "<alignment/>":
      case "</alignment>":
        break;
      case "<numFmt":
        n && (n.numFmt = { numFmtId: l.numFmtId != null ? parseInt(l.numFmtId, 10) : void 0, formatCode: l.formatCode ? Ue(Qe(l.formatCode)) : void 0 });
        break;
      case "<numFmt/>":
      case "</numFmt>":
        break;
      case "<protection":
        n && (n.protection = {}, l.locked != null && (n.protection.locked = Re(l.locked)), l.hidden != null && (n.protection.hidden = Re(l.hidden)));
        break;
      case "<protection/>":
      case "</protection>":
        break;
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        f = !0;
        break;
      case "</ext>":
        f = !1;
        break;
      default:
        if (a && a.WTF && !f)
          throw new Error("unrecognized " + l[0] + " in dxfs");
    }
  });
}
function c1(e, t, r, a) {
  t.Colors = { indexedColors: [], mruColors: [], themeColors: [] };
  var n = null, i = !1;
  (e.match(pr) || []).forEach(function(c) {
    var s = Ee(c);
    switch (Lr(s[0])) {
      case "<colors":
      case "<colors>":
      case "</colors>":
        break;
      case "<indexedColors":
      case "<indexedColors>":
        n = t.Colors.indexedColors;
        break;
      case "</indexedColors>":
        n = null;
        break;
      case "<themeColors":
      case "<themeColors>":
        n = t.Colors.themeColors;
        break;
      case "</themeColors>":
        n = null;
        break;
      case "<mruColors":
      case "<mruColors>":
        n = t.Colors.mruColors;
        break;
      case "</mruColors>":
        n = null;
        break;
      case "<rgbColor":
      case "<rgbColor/>":
        n && n.push(at(s, r));
        break;
      case "</rgbColor>":
        break;
      case "<color":
      case "<color/>":
        n && n.push(at(s, r));
        break;
      case "</color>":
        break;
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
        break;
      case "<ext":
        i = !0;
        break;
      case "</ext>":
        i = !1;
        break;
      default:
        if (a && a.WTF && !i)
          throw new Error("unrecognized " + s[0] + " in colors");
    }
  });
}
var u1 = /* @__PURE__ */ (function() {
  return function(r, a, n) {
    var i = {};
    if (!r) return i;
    r = N0(an(r, "<!--", "-->"));
    var c;
    return (c = Ye(r, "numFmts")) && t1(c[0], i, n), (c = Ye(r, "fonts")) && r1(c[0], i, a, n), (c = Ye(r, "fills")) && e1(c[0], i, a, n), (c = Ye(r, "borders")) && Qh(c[0], i, a, n), (c = Ye(r, "cellStyleXfs")) && n1(c[0], i, n), (c = Ye(r, "cellStyles")) && i1(c[0], i, n), (c = Ye(r, "cellXfs")) && a1(c[0], i, n), (c = Ye(r, "dxfs")) && s1(c[0], i, a, n), (c = Ye(r, "colors")) && c1(c[0], i, a, n), i;
  };
})();
function f1(e, t) {
  var r = e.read_shift(2), a = Nr(e);
  return [r, a];
}
function o1(e, t, r) {
  var a = {};
  a.sz = e.read_shift(2) / 20;
  var n = Qf(e);
  n.fItalic && (a.italic = 1), n.fCondense && (a.condense = 1), n.fExtend && (a.extend = 1), n.fShadow && (a.shadow = 1), n.fOutline && (a.outline = 1), n.fStrikeout && (a.strike = 1);
  var i = e.read_shift(2);
  switch (i === 700 && (a.bold = 1), e.read_shift(2)) {
    /* case 0: out.vertAlign = "baseline"; break; */
    case 1:
      a.vertAlign = "superscript";
      break;
    case 2:
      a.vertAlign = "subscript";
      break;
  }
  var c = e.read_shift(1);
  c != 0 && (a.underline = c);
  var s = e.read_shift(1);
  s > 0 && (a.family = s);
  var u = e.read_shift(1);
  switch (u > 0 && (a.charset = u), e.l++, a.color = Zf(e), e.read_shift(1)) {
    /* case 0: out.scheme = "none": break; */
    case 1:
      a.scheme = "major";
      break;
    case 2:
      a.scheme = "minor";
      break;
  }
  return a.name = Nr(e), a;
}
var l1 = Br;
function h1(e, t) {
  var r = e.l + t, a = e.read_shift(2), n = e.read_shift(2);
  return e.l = r, { ixfe: a, numFmtId: n };
}
var d1 = Br;
function x1(e, t, r) {
  var a = {};
  a.NumberFmt = [];
  for (var n in Le) a.NumberFmt[n] = Le[n];
  a.CellXf = [], a.Fonts = [];
  var i = [], c = !1;
  return Bt(e, function(u, f, o) {
    switch (o) {
      case 44:
        a.NumberFmt[u[0]] = u[1], Qt(u[1], u[0]);
        break;
      case 43:
        a.Fonts.push(u), u.color.theme != null && t && t.themeElements && t.themeElements.clrScheme && (u.color.rgb = W0(t.themeElements.clrScheme[u.color.theme].rgb, u.color.tint || 0));
        break;
      case 1025:
        break;
      case 45:
        break;
      case 46:
        break;
      case 47:
        i[i.length - 1] == 617 && a.CellXf.push(u);
        break;
      case 48:
      /* BrtStyle */
      case 507:
      /* BrtDXF */
      case 572:
      /* BrtMRUColor */
      case 475:
        break;
      case 1171:
      /* BrtDXF14 */
      case 2102:
      /* BrtDXF15 */
      case 1130:
      /* BrtSlicerStyleElement */
      case 512:
      /* BrtTableStyleElement */
      case 2095:
      /* BrtTimelineStyleElement */
      case 3072:
        break;
      case 35:
        c = !0;
        break;
      case 36:
        c = !1;
        break;
      case 37:
        i.push(o), c = !0;
        break;
      case 38:
        i.pop(), c = !1;
        break;
      default:
        if (f.T > 0) i.push(o);
        else if (f.T < 0) i.pop();
        else if (!c || r.WTF && i[i.length - 1] != 37) throw new Error("Unexpected record 0x" + o.toString(16));
    }
  }), a;
}
var p1 = [
  "</a:lt1>",
  "</a:dk1>",
  "</a:lt2>",
  "</a:dk2>",
  "</a:accent1>",
  "</a:accent2>",
  "</a:accent3>",
  "</a:accent4>",
  "</a:accent5>",
  "</a:accent6>",
  "</a:hlink>",
  "</a:folHlink>"
];
function v1(e, t, r) {
  t.themeElements.clrScheme = [];
  var a = {};
  (e[0].match(pr) || []).forEach(function(n) {
    var i = Ee(n);
    switch (i[0]) {
      /* 20.1.6.2 clrScheme (Color Scheme) CT_ColorScheme */
      case "<a:clrScheme":
      case "</a:clrScheme>":
        break;
      /* 20.1.2.3.32 srgbClr CT_SRgbColor */
      case "<a:srgbClr":
        a.rgb = i.val;
        break;
      case "</a:srgbClr>":
        break;
      /* 20.1.2.3.33 sysClr CT_SystemColor */
      case "<a:sysClr":
        a.rgb = i.lastClr;
        break;
      case "</a:sysClr>":
        break;
      /* 20.1.4.1.1 accent1 (Accent 1) */
      /* 20.1.4.1.2 accent2 (Accent 2) */
      /* 20.1.4.1.3 accent3 (Accent 3) */
      /* 20.1.4.1.4 accent4 (Accent 4) */
      /* 20.1.4.1.5 accent5 (Accent 5) */
      /* 20.1.4.1.6 accent6 (Accent 6) */
      /* 20.1.4.1.9 dk1 (Dark 1) */
      /* 20.1.4.1.10 dk2 (Dark 2) */
      /* 20.1.4.1.15 folHlink (Followed Hyperlink) */
      /* 20.1.4.1.19 hlink (Hyperlink) */
      /* 20.1.4.1.22 lt1 (Light 1) */
      /* 20.1.4.1.23 lt2 (Light 2) */
      case "</a:dk1>":
      case "</a:lt1>":
      case "<a:dk1>":
      case "<a:lt1>":
      case "<a:dk2>":
      case "</a:dk2>":
      case "<a:lt2>":
      case "</a:lt2>":
      case "<a:accent1>":
      case "</a:accent1>":
      case "<a:accent2>":
      case "</a:accent2>":
      case "<a:accent3>":
      case "</a:accent3>":
      case "<a:accent4>":
      case "</a:accent4>":
      case "<a:accent5>":
      case "</a:accent5>":
      case "<a:accent6>":
      case "</a:accent6>":
      case "<a:hlink>":
      case "</a:hlink>":
      case "<a:folHlink>":
      case "</a:folHlink>":
        i[0].charAt(1) === "/" ? (t.themeElements.clrScheme[p1.indexOf(i[0])] = a, a = {}) : a.name = i[0].slice(3, i[0].length - 1);
        break;
      default:
        if (r && r.WTF) throw new Error("Unrecognized " + i[0] + " in clrScheme");
    }
  });
}
function g1(e, t, r) {
  t.themeElements = {};
  var a;
  if (!(a = ea(e, "a:clrScheme"))) throw new Error("clrScheme not found in themeElements");
  if (v1(a, t, r), !(a = ea(e, "a:fontScheme"))) throw new Error("fontScheme not found in themeElements");
  if (!(a = ea(e, "a:fmtScheme"))) throw new Error("fmtScheme not found in themeElements");
}
function Bc(e, t) {
  (!e || e.length === 0) && (e = m1());
  var r, a = {};
  if (!(r = ea(e, "a:themeElements"))) throw new Error("themeElements not found in theme");
  return g1(r[0], a, t), a.raw = e, a;
}
function m1(e, t) {
  var r = [Hs];
  return r[r.length] = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">', r[r.length] = "<a:themeElements>", r[r.length] = '<a:clrScheme name="Office">', r[r.length] = '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>', r[r.length] = '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>', r[r.length] = '<a:dk2><a:srgbClr val="1F497D"/></a:dk2>', r[r.length] = '<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>', r[r.length] = '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>', r[r.length] = '<a:accent2><a:srgbClr val="C0504D"/></a:accent2>', r[r.length] = '<a:accent3><a:srgbClr val="9BBB59"/></a:accent3>', r[r.length] = '<a:accent4><a:srgbClr val="8064A2"/></a:accent4>', r[r.length] = '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5>', r[r.length] = '<a:accent6><a:srgbClr val="F79646"/></a:accent6>', r[r.length] = '<a:hlink><a:srgbClr val="0000FF"/></a:hlink>', r[r.length] = '<a:folHlink><a:srgbClr val="800080"/></a:folHlink>', r[r.length] = "</a:clrScheme>", r[r.length] = '<a:fontScheme name="Office">', r[r.length] = "<a:majorFont>", r[r.length] = '<a:latin typeface="Cambria"/>', r[r.length] = '<a:ea typeface=""/>', r[r.length] = '<a:cs typeface=""/>', r[r.length] = '<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/>', r[r.length] = '<a:font script="Hang" typeface="맑은 고딕"/>', r[r.length] = '<a:font script="Hans" typeface="宋体"/>', r[r.length] = '<a:font script="Hant" typeface="新細明體"/>', r[r.length] = '<a:font script="Arab" typeface="Times New Roman"/>', r[r.length] = '<a:font script="Hebr" typeface="Times New Roman"/>', r[r.length] = '<a:font script="Thai" typeface="Tahoma"/>', r[r.length] = '<a:font script="Ethi" typeface="Nyala"/>', r[r.length] = '<a:font script="Beng" typeface="Vrinda"/>', r[r.length] = '<a:font script="Gujr" typeface="Shruti"/>', r[r.length] = '<a:font script="Khmr" typeface="MoolBoran"/>', r[r.length] = '<a:font script="Knda" typeface="Tunga"/>', r[r.length] = '<a:font script="Guru" typeface="Raavi"/>', r[r.length] = '<a:font script="Cans" typeface="Euphemia"/>', r[r.length] = '<a:font script="Cher" typeface="Plantagenet Cherokee"/>', r[r.length] = '<a:font script="Yiii" typeface="Microsoft Yi Baiti"/>', r[r.length] = '<a:font script="Tibt" typeface="Microsoft Himalaya"/>', r[r.length] = '<a:font script="Thaa" typeface="MV Boli"/>', r[r.length] = '<a:font script="Deva" typeface="Mangal"/>', r[r.length] = '<a:font script="Telu" typeface="Gautami"/>', r[r.length] = '<a:font script="Taml" typeface="Latha"/>', r[r.length] = '<a:font script="Syrc" typeface="Estrangelo Edessa"/>', r[r.length] = '<a:font script="Orya" typeface="Kalinga"/>', r[r.length] = '<a:font script="Mlym" typeface="Kartika"/>', r[r.length] = '<a:font script="Laoo" typeface="DokChampa"/>', r[r.length] = '<a:font script="Sinh" typeface="Iskoola Pota"/>', r[r.length] = '<a:font script="Mong" typeface="Mongolian Baiti"/>', r[r.length] = '<a:font script="Viet" typeface="Times New Roman"/>', r[r.length] = '<a:font script="Uigh" typeface="Microsoft Uighur"/>', r[r.length] = '<a:font script="Geor" typeface="Sylfaen"/>', r[r.length] = "</a:majorFont>", r[r.length] = "<a:minorFont>", r[r.length] = '<a:latin typeface="Calibri"/>', r[r.length] = '<a:ea typeface=""/>', r[r.length] = '<a:cs typeface=""/>', r[r.length] = '<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/>', r[r.length] = '<a:font script="Hang" typeface="맑은 고딕"/>', r[r.length] = '<a:font script="Hans" typeface="宋体"/>', r[r.length] = '<a:font script="Hant" typeface="新細明體"/>', r[r.length] = '<a:font script="Arab" typeface="Arial"/>', r[r.length] = '<a:font script="Hebr" typeface="Arial"/>', r[r.length] = '<a:font script="Thai" typeface="Tahoma"/>', r[r.length] = '<a:font script="Ethi" typeface="Nyala"/>', r[r.length] = '<a:font script="Beng" typeface="Vrinda"/>', r[r.length] = '<a:font script="Gujr" typeface="Shruti"/>', r[r.length] = '<a:font script="Khmr" typeface="DaunPenh"/>', r[r.length] = '<a:font script="Knda" typeface="Tunga"/>', r[r.length] = '<a:font script="Guru" typeface="Raavi"/>', r[r.length] = '<a:font script="Cans" typeface="Euphemia"/>', r[r.length] = '<a:font script="Cher" typeface="Plantagenet Cherokee"/>', r[r.length] = '<a:font script="Yiii" typeface="Microsoft Yi Baiti"/>', r[r.length] = '<a:font script="Tibt" typeface="Microsoft Himalaya"/>', r[r.length] = '<a:font script="Thaa" typeface="MV Boli"/>', r[r.length] = '<a:font script="Deva" typeface="Mangal"/>', r[r.length] = '<a:font script="Telu" typeface="Gautami"/>', r[r.length] = '<a:font script="Taml" typeface="Latha"/>', r[r.length] = '<a:font script="Syrc" typeface="Estrangelo Edessa"/>', r[r.length] = '<a:font script="Orya" typeface="Kalinga"/>', r[r.length] = '<a:font script="Mlym" typeface="Kartika"/>', r[r.length] = '<a:font script="Laoo" typeface="DokChampa"/>', r[r.length] = '<a:font script="Sinh" typeface="Iskoola Pota"/>', r[r.length] = '<a:font script="Mong" typeface="Mongolian Baiti"/>', r[r.length] = '<a:font script="Viet" typeface="Arial"/>', r[r.length] = '<a:font script="Uigh" typeface="Microsoft Uighur"/>', r[r.length] = '<a:font script="Geor" typeface="Sylfaen"/>', r[r.length] = "</a:minorFont>", r[r.length] = "</a:fontScheme>", r[r.length] = '<a:fmtScheme name="Office">', r[r.length] = "<a:fillStyleLst>", r[r.length] = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>', r[r.length] = '<a:gradFill rotWithShape="1">', r[r.length] = "<a:gsLst>", r[r.length] = '<a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs>', r[r.length] = '<a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs>', r[r.length] = '<a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs>', r[r.length] = "</a:gsLst>", r[r.length] = '<a:lin ang="16200000" scaled="1"/>', r[r.length] = "</a:gradFill>", r[r.length] = '<a:gradFill rotWithShape="1">', r[r.length] = "<a:gsLst>", r[r.length] = '<a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs>', r[r.length] = '<a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs>', r[r.length] = "</a:gsLst>", r[r.length] = '<a:lin ang="16200000" scaled="0"/>', r[r.length] = "</a:gradFill>", r[r.length] = "</a:fillStyleLst>", r[r.length] = "<a:lnStyleLst>", r[r.length] = '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln>', r[r.length] = '<a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>', r[r.length] = '<a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>', r[r.length] = "</a:lnStyleLst>", r[r.length] = "<a:effectStyleLst>", r[r.length] = "<a:effectStyle>", r[r.length] = "<a:effectLst>", r[r.length] = '<a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw>', r[r.length] = "</a:effectLst>", r[r.length] = "</a:effectStyle>", r[r.length] = "<a:effectStyle>", r[r.length] = "<a:effectLst>", r[r.length] = '<a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw>', r[r.length] = "</a:effectLst>", r[r.length] = "</a:effectStyle>", r[r.length] = "<a:effectStyle>", r[r.length] = "<a:effectLst>", r[r.length] = '<a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw>', r[r.length] = "</a:effectLst>", r[r.length] = '<a:scene3d><a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="1200000"/></a:lightRig></a:scene3d>', r[r.length] = '<a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d>', r[r.length] = "</a:effectStyle>", r[r.length] = "</a:effectStyleLst>", r[r.length] = "<a:bgFillStyleLst>", r[r.length] = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>', r[r.length] = '<a:gradFill rotWithShape="1">', r[r.length] = "<a:gsLst>", r[r.length] = '<a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs>', r[r.length] = '<a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs>', r[r.length] = '<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs>', r[r.length] = "</a:gsLst>", r[r.length] = '<a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path>', r[r.length] = "</a:gradFill>", r[r.length] = '<a:gradFill rotWithShape="1">', r[r.length] = "<a:gsLst>", r[r.length] = '<a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs>', r[r.length] = '<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs>', r[r.length] = "</a:gsLst>", r[r.length] = '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>', r[r.length] = "</a:gradFill>", r[r.length] = "</a:bgFillStyleLst>", r[r.length] = "</a:fmtScheme>", r[r.length] = "</a:themeElements>", r[r.length] = "<a:objectDefaults>", r[r.length] = "<a:spDef>", r[r.length] = '<a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></a:style>', r[r.length] = "</a:spDef>", r[r.length] = "<a:lnDef>", r[r.length] = '<a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></a:style>', r[r.length] = "</a:lnDef>", r[r.length] = "</a:objectDefaults>", r[r.length] = "<a:extraClrSchemeLst/>", r[r.length] = "</a:theme>", r.join("");
}
function _1(e, t, r) {
  var a = e.l + t, n = e.read_shift(4);
  if (n !== 124226) {
    if (!r.cellStyles) {
      e.l = a;
      return;
    }
    var i = e.slice(e.l);
    e.l = a;
    var c;
    try {
      c = Us(i, { type: "array" });
    } catch {
      return;
    }
    var s = gr(c, "theme/theme/theme1.xml", !0);
    if (s)
      return Bc(s, r);
  }
}
function E1(e) {
  return e.read_shift(4);
}
function w1(e) {
  var t = {};
  switch (t.xclrType = e.read_shift(2), t.nTintShade = e.read_shift(2, "i"), t.xclrType) {
    case 0:
      e.l += 4;
      break;
    case 1:
      t.xclrValue = A1(e, 4);
      break;
    case 2:
      t.xclrValue = gc(e);
      break;
    case 3:
      t.xclrValue = E1(e);
      break;
    case 4:
      e.l += 4;
      break;
  }
  return e.l += 8, t;
}
function A1(e, t) {
  var r = e.l + t, a = e.read_shift(2) & 127;
  return e.l = r, a;
}
function T1(e, t) {
  return Br(e, t);
}
function F1(e) {
  var t = e.read_shift(2), r = e.read_shift(2) - 4, a = [t];
  switch (t) {
    case 4:
    case 5:
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
    case 13:
      a[1] = w1(e);
      break;
    case 6:
      a[1] = T1(e, r);
      break;
    case 14:
    case 15:
      a[1] = e.read_shift(r === 1 ? 1 : 2);
      break;
    default:
      throw new Error("Unrecognized ExtProp type: " + t + " " + r);
  }
  return a;
}
function k1(e, t) {
  var r = e.l + t;
  e.l += 2;
  var a = e.read_shift(2);
  e.l += 2;
  for (var n = e.read_shift(2), i = []; n-- > 0; ) i.push(F1(e, r - e.l));
  return { ixfe: a, ext: i };
}
function D1(e, t) {
  e && (e.data || (e.data = {}), t.forEach(function(r) {
    switch (r[0]) {
      /* 2.5.108 extPropData */
      case 4:
        e.data.xfextFore = r[1];
        break;
      /* foreground color */
      case 5:
        e.data.xfextBack = r[1];
        break;
      /* background color */
      case 6:
        e.data.gradientFill = r[1];
        break;
      /* gradient fill */
      case 7:
        e.data.xfextTop = r[1];
        break;
      /* top cell border color */
      case 8:
        e.data.xfextBottom = r[1];
        break;
      /* bottom cell border color */
      case 9:
        e.data.xfextLeft = r[1];
        break;
      /* left cell border color */
      case 10:
        e.data.xfextRight = r[1];
        break;
      /* right cell border color */
      case 11:
        e.data.xfextDiag = r[1];
        break;
      /* diagonal cell border color */
      case 13:
        e.xfextFont = r[1];
        break;
      /* text color */
      case 14:
        e.fontScheme = r[1];
        break;
      /* font scheme */
      case 15:
        e.data.cIndent = r[1];
        break;
    }
  }));
}
function C1(e, t) {
  return {
    flags: e.read_shift(4),
    version: e.read_shift(4),
    name: Nr(e)
  };
}
function y1(e) {
  for (var t = [], r = e.read_shift(4); r-- > 0; )
    t.push([e.read_shift(4), e.read_shift(4)]);
  return t;
}
function S1(e) {
  return e.l += 4, e.read_shift(4) != 0;
}
function b1(e, t, r) {
  var a = { Types: [], Cell: [], Value: [] }, n = r || {}, i = [], c = !1, s = 2;
  return Bt(e, function(u, f, o) {
    switch (o) {
      case 58:
        break;
      case 59:
        break;
      case 335:
        a.Types.push({ name: u.name });
        break;
      case 51:
        u.forEach(function(l) {
          s == 1 ? a.Cell.push({ type: a.Types[l[0] - 1].name, index: l[1] }) : s == 0 && a.Value.push({ type: a.Types[l[0] - 1].name, index: l[1] });
        });
        break;
      case 337:
        s = u ? 1 : 0;
        break;
      case 338:
        s = 2;
        break;
      case 35:
        i.push(o), c = !0;
        break;
      case 36:
        i.pop(), c = !1;
        break;
      default:
        if (!f.T) {
          if (!c || n.WTF && i[i.length - 1] != 35)
            throw new Error("Unexpected record 0x" + o.toString(16));
        }
    }
  }), a;
}
function I1(e, t, r) {
  var a = { Types: [], Cell: [], Value: [] };
  if (!e)
    return a;
  var n = !1, i = 2, c;
  return e.replace(pr, function(s) {
    var u = Ee(s);
    switch (Lr(u[0])) {
      case "<?xml":
        break;
      case "<metadata":
      case "</metadata>":
        break;
      case "<metadataTypes":
      case "</metadataTypes>":
        break;
      case "<metadataType":
        a.Types.push({ name: u.name });
        break;
      case "</metadataType>":
        break;
      case "<futureMetadata":
        for (var f = 0; f < a.Types.length; ++f)
          a.Types[f].name == u.name && (c = a.Types[f]);
        break;
      case "</futureMetadata>":
        break;
      case "<bk>":
        break;
      case "</bk>":
        break;
      case "<rc":
        i == 1 ? a.Cell.push({ type: a.Types[u.t - 1].name, index: +u.v }) : i == 0 && a.Value.push({ type: a.Types[u.t - 1].name, index: +u.v });
        break;
      case "</rc>":
        break;
      case "<cellMetadata":
        i = 1;
        break;
      case "</cellMetadata>":
        i = 2;
        break;
      case "<valueMetadata":
        i = 0;
        break;
      case "</valueMetadata>":
        i = 2;
        break;
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
      case "<extLst/>":
        break;
      case "<ext":
        n = !0;
        break;
      case "</ext>":
        n = !1;
        break;
      case "<rvb":
        if (!c)
          break;
        c.offsets || (c.offsets = []), c.offsets.push(+u.i);
        break;
      default:
        if (!n && r?.WTF)
          throw new Error("unrecognized " + u[0] + " in metadata");
    }
    return s;
  }), a;
}
function N1(e) {
  var t = [];
  if (!e) return t;
  var r = 1;
  return (e.match(pr) || []).forEach(function(a) {
    var n = Ee(a);
    switch (n[0]) {
      case "<?xml":
        break;
      /* 18.6.2  calcChain CT_CalcChain 1 */
      case "<calcChain":
      case "<calcChain>":
      case "</calcChain>":
        break;
      /* 18.6.1  c CT_CalcCell 1 */
      case "<c":
        delete n[0], n.i ? r = n.i : n.i = r, t.push(n);
        break;
    }
  }), t;
}
function O1(e) {
  var t = {};
  t.i = e.read_shift(4);
  var r = {};
  r.r = e.read_shift(4), r.c = e.read_shift(4), t.r = Ge(r);
  var a = e.read_shift(1);
  return a & 2 && (t.l = "1"), a & 8 && (t.a = "1"), t;
}
function R1(e, t, r) {
  var a = [];
  return Bt(e, function(i, c, s) {
    switch (s) {
      case 63:
        a.push(i);
        break;
      default:
        if (!c.T) throw new Error("Unexpected record 0x" + s.toString(16));
    }
  }), a;
}
function B1(e, t, r, a) {
  if (!e) return e;
  var n = a || {}, i = !1;
  Bt(e, function(s, u, f) {
    switch (f) {
      case 359:
      /* 'BrtSupTabs' */
      case 363:
      /* 'BrtExternTableStart' */
      case 364:
      /* 'BrtExternTableEnd' */
      case 366:
      /* 'BrtExternRowHdr' */
      case 367:
      /* 'BrtExternCellBlank' */
      case 368:
      /* 'BrtExternCellReal' */
      case 369:
      /* 'BrtExternCellBool' */
      case 370:
      /* 'BrtExternCellError' */
      case 371:
      /* 'BrtExternCellString' */
      case 472:
      /* 'BrtExternValueMeta' */
      case 577:
      /* 'BrtSupNameStart' */
      case 578:
      /* 'BrtSupNameValueStart' */
      case 579:
      /* 'BrtSupNameValueEnd' */
      case 580:
      /* 'BrtSupNameNum' */
      case 581:
      /* 'BrtSupNameErr' */
      case 582:
      /* 'BrtSupNameSt' */
      case 583:
      /* 'BrtSupNameNil' */
      case 584:
      /* 'BrtSupNameBool' */
      case 585:
      /* 'BrtSupNameFmla' */
      case 586:
      /* 'BrtSupNameBits' */
      case 587:
      /* 'BrtSupNameEnd' */
      case 5108:
        break;
      case 35:
        i = !0;
        break;
      case 36:
        i = !1;
        break;
      default:
        if (!u.T) {
          if (!i || n.WTF) throw new Error("Unexpected record 0x" + f.toString(16));
        }
    }
  }, n);
}
function Lc(e, t) {
  if (!e) return { charts: [], images: [], shapes: [], raw: "" };
  var r = { charts: [], images: [], shapes: [], raw: e };
  t || (t = { "!id": {} });
  var a = /<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1>/g, n = e.match(a) || [e];
  return n.forEach(function(i) {
    var c = L1(i);
    (i.match(/<c:chart\b[^<>]*r:id="([^<>"]*)"/g) || []).forEach(function(u) {
      var f = u.match(/r:id="([^<>"]*)"/);
      if (f) {
        var o = t["!id"][f[1]] || {};
        r.charts.push({ id: f[1], rel: o, target: o.Target, anchor: c });
      }
    }), (i.match(/<a:blip\b[^<>]*(?:r:embed|r:link)="([^<>"]*)"/g) || []).forEach(function(u) {
      var f = u.match(/(?:r:embed|r:link)="([^<>"]*)"/);
      if (f) {
        var o = t["!id"][f[1]] || {};
        r.images.push({ id: f[1], rel: o, target: o.Target, anchor: c });
      }
    });
    var s = M1(i);
    s && r.shapes.push({ text: s, anchor: c, raw: i });
  }), r.chart = r.charts[0] && r.charts[0].target, r;
}
function Ui(e, t) {
  var r = Ye(e, t), a = r && r[1] || "";
  function n(i) {
    var c = Ye(a, i);
    return c && c[1] != null ? parseInt(c[1], 10) : 0;
  }
  return { col: n("col"), colOff: n("colOff"), row: n("row"), rowOff: n("rowOff") };
}
function L1(e) {
  var t = (e.match(/^<(?:\w+:)?(\w+)/) || [])[1] || "anchor", r = { type: t };
  (e.indexOf("<xdr:from") >= 0 || e.indexOf("<from") >= 0) && (r.from = Ui(e, "from")), (e.indexOf("<xdr:to") >= 0 || e.indexOf("<to") >= 0) && (r.to = Ui(e, "to"));
  var a = e.match(/<(?:\w+:)?pos\b[^<>]*\/>/);
  if (a) {
    var n = Ee(a[0]);
    r.pos = { x: n.x ? parseInt(n.x, 10) : 0, y: n.y ? parseInt(n.y, 10) : 0 };
  }
  var i = e.match(/<(?:\w+:)?ext\b[^<>]*\/>/);
  if (i) {
    var c = Ee(i[0]);
    r.ext = { cx: c.cx ? parseInt(c.cx, 10) : 0, cy: c.cy ? parseInt(c.cy, 10) : 0 };
  }
  return r;
}
function M1(e) {
  var t = [];
  return (e.match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g) || []).forEach(function(r) {
    t.push(Ue(r.replace(/<[^>]*>/g, "")));
  }), t.join("");
}
function P1(e, t, r) {
  var a = e.slice(e.l, e.l + t);
  return e.l += t, !r || !r.drawings && !r.charts ? { raw: a, blips: [], shapes: [], images: [], charts: [], groups: !0 } : Mc(a, !0);
}
function U1(e, t, r) {
  var a = e.slice(e.l, e.l + t);
  return e.l += t, !r || !r.drawings && !r.charts ? { raw: a, blips: [], shapes: [], images: [], charts: [], groups: !1 } : Mc(a, !1);
}
function Wr(e, t) {
  return e[t] | e[t + 1] << 8;
}
function Aa(e, t) {
  return (e[t] | e[t + 1] << 8 | e[t + 2] << 16 | e[t + 3] << 24) >>> 0;
}
function Mc(e, t) {
  var r = { raw: e, blips: [], shapes: [], images: [], charts: [], groups: !!t }, a = { out: r, current: null };
  try {
    v0(e, 0, e.length, a);
  } catch (n) {
    r.error = n.message || String(n);
  }
  return r;
}
function v0(e, t, r, a) {
  for (var n = t; n + 8 <= r && n + 8 <= e.length; ) {
    var i = Wr(e, n), c = Wr(e, n + 2), s = Aa(e, n + 4), u = i & 15, f = i >> 4, o = n + 8, l = o + s;
    if (l > e.length && (l = e.length), c == 61444) {
      var x = { raw: e.slice(n, l), props: {} };
      a.out.shapes.push(x);
      var h = a.current;
      a.current = x, v0(e, o, l, a), a.current = h;
    } else c == 61447 ? a.out.blips.push(W1(e, o, l, f)) : c == 61450 && a.current ? (a.current.spid = Aa(e, o), a.current.flags = Aa(e, o + 4)) : c == 61451 && a.current ? (a.current.props = H1(e, o, l, f), a.current.props.pib != null && (a.current.blipId = a.current.props.pib)) : c == 61456 && a.current ? a.current.anchor = V1(e, o, l) : c == 61457 && a.current ? a.current.clientData = e.slice(o, l) : u == 15 && v0(e, o, l, a);
    n = l;
  }
}
function H1(e, t, r, a) {
  for (var n = {}, i = [], c = t, s = 0; s < a && c + 6 <= r; ++s, c += 6) {
    var u = Wr(e, c), f = Aa(e, c + 2), o = u & 16383;
    n[o] = f, u & 16384 && i.push([o, f]), o == 260 && (n.pib = f), o == 261 && (n.pibName = f), o == 896 && (n.fillColor = f), o == 897 && (n.fillOpacity = f), o == 959 && (n.lineColor = f);
  }
  return i.forEach(function(l) {
    c + l[1] <= r && (n["complex_" + l[0]] = e.slice(c, c + l[1])), c += l[1];
  }), n;
}
function V1(e, t, r) {
  if (r - t < 18) return {};
  var a = t, n = Wr(e, a);
  a += 2;
  var i = Wr(e, a), c = Wr(e, a + 2), s = Wr(e, a + 4), u = Wr(e, a + 6);
  a += 8;
  var f = Wr(e, a), o = Wr(e, a + 2), l = Wr(e, a + 4), x = Wr(e, a + 6);
  return { type: "twoCellAnchor", flags: n, from: { col: i, colOff: c * 9525 / 1024, row: s, rowOff: u * 9525 / 256 }, to: { col: f, colOff: o * 9525 / 1024, row: l, rowOff: x * 9525 / 256 } };
}
function Pc(e, t, r) {
  for (var a = t; a + 8 <= r; ++a) {
    if (e[a] == 137 && e[a + 1] == 80 && e[a + 2] == 78 && e[a + 3] == 71) return [a, "image/png"];
    if (e[a] == 255 && e[a + 1] == 216 && e[a + 2] == 255) return [a, "image/jpeg"];
    if (e[a] == 66 && e[a + 1] == 77) return [a, "image/bmp"];
  }
  return [t, ""];
}
function W1(e, t, r, a) {
  var n = { index: a, raw: e.slice(t, r) };
  if (r - t < 36) return n;
  n.btWin32 = e[t], n.btMacOS = e[t + 1], n.size = Aa(e, t + 20), n.cRef = Aa(e, t + 24);
  var i = t + 36;
  if (i + 8 <= r) {
    n.blipType = Wr(e, i + 2);
    var c = i + 8, s = r, u = Pc(e, c, s);
    u[1] && (n.contentType = u[1], n.data = e.slice(u[0], s), n.dataURI = "data:" + n.contentType + ";base64," + C0(n.data));
  }
  return n;
}
function G1(e, t, r) {
  var a = 0;
  (Ls(e, "(?:shape|rect)") || []).forEach(function(n) {
    var i = "", c = !0, s = -1, u = -1, f = -1;
    if (n.replace(pr, function(l, x) {
      var h = Ee(l);
      switch (Lr(h[0])) {
        case "<ClientData":
          h.ObjectType && (i = h.ObjectType);
          break;
        case "<Visible":
        case "<Visible/>":
          c = !1;
          break;
        case "<Row":
        case "<Row>":
          s = x + l.length;
          break;
        case "</Row>":
          u = +n.slice(s, x).trim();
          break;
        case "<Column":
        case "<Column>":
          s = x + l.length;
          break;
        case "</Column>":
          f = +n.slice(s, x).trim();
          break;
      }
      return "";
    }), i === "Note") {
      var o = rn(t, u >= 0 && f >= 0 ? Ge({ r: u, c: f }) : r[a].ref);
      o.c && (o.c.hidden = c), ++a;
    }
  });
}
function Hi(e, t, r, a) {
  var n = e["!data"] != null, i;
  t.forEach(function(c) {
    var s = Ir(c.ref);
    if (!(s.r < 0 || s.c < 0)) {
      if (n ? (e["!data"][s.r] || (e["!data"][s.r] = []), i = e["!data"][s.r][s.c]) : i = e[c.ref], !i) {
        i = { t: "z" }, n ? e["!data"][s.r][s.c] = i : e[c.ref] = i;
        var u = cr(e["!ref"] || "BDWGO1000001:A1");
        u.s.r > s.r && (u.s.r = s.r), u.e.r < s.r && (u.e.r = s.r), u.s.c > s.c && (u.s.c = s.c), u.e.c < s.c && (u.e.c = s.c);
        var f = He(u);
        e["!ref"] = f;
      }
      i.c || (i.c = []);
      var o = { a: c.author, t: c.t, r: c.r, T: r };
      c.h && (o.h = c.h);
      for (var l = i.c.length - 1; l >= 0; --l) {
        if (!r && i.c[l].T) return;
        r && !i.c[l].T && i.c.splice(l, 1);
      }
      if (r && a) {
        for (l = 0; l < a.length; ++l)
          if (o.a == a[l].id) {
            o.a = a[l].name || o.a;
            break;
          }
      }
      i.c.push(o);
    }
  });
}
function X1(e, t) {
  if (e.match(/<(?:\w+:)?comments *\/>/)) return [];
  var r = [], a = [], n = Ye(e, "authors");
  n && n[1] && n[1].split(/<\/\w*:?author>/).forEach(function(c) {
    if (!(c === "" || c.trim() === "")) {
      var s = c.match(/<(?:\w+:)?author[^<>]*>(.*)/);
      s && r.push(s[1]);
    }
  });
  var i = Ye(e, "commentList");
  return i && i[1] && i[1].split(/<\/\w*:?comment>/).forEach(function(c) {
    if (!(c === "" || c.trim() === "")) {
      var s = c.match(/<(?:\w+:)?comment[^<>]*>/);
      if (s) {
        var u = Ee(s[0]), f = { author: u.authorId && r[u.authorId] || "sheetjsghost", ref: u.ref, guid: u.guid }, o = Ir(u.ref);
        if (!(t.sheetRows && t.sheetRows <= o.r)) {
          var l = Ye(c, "text"), x = !!l && !!l[1] && V0(l[1]) || { r: "", t: "", h: "" };
          f.r = x.r, x.r == "<t></t>" && (x.t = x.h = ""), f.t = (x.t || "").replace(/\r\n/g, `
`).replace(/\r/g, `
`), t.cellHTML && (f.h = x.h), a.push(f);
        }
      }
    }
  }), a;
}
function z1(e, t) {
  var r = [], a = !1, n = {}, i = 0;
  return e.replace(pr, function(s, u) {
    var f = Ee(s);
    switch (Lr(f[0])) {
      case "<?xml":
        break;
      /* 2.6.207 ThreadedComments CT_ThreadedComments */
      case "<ThreadedComments":
        break;
      case "</ThreadedComments>":
        break;
      /* 2.6.205 threadedComment CT_ThreadedComment */
      case "<threadedComment":
        n = { author: f.personId, guid: f.id, ref: f.ref, T: 1 };
        break;
      case "</threadedComment>":
        n.t != null && r.push(n);
        break;
      case "<text>":
      case "<text":
        i = u + s.length;
        break;
      case "</text>":
        n.t = e.slice(i, u).replace(/\r\n/g, `
`).replace(/\r/g, `
`);
        break;
      /* 2.6.206 mentions CT_ThreadedCommentMentions TODO */
      case "<mentions":
      case "<mentions>":
        a = !0;
        break;
      case "</mentions>":
        a = !1;
        break;
      /* 2.6.202 mention CT_Mention TODO */
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
      case "<extLst/>":
        break;
      /* 18.2.7  ext CT_Extension + */
      case "<ext":
        a = !0;
        break;
      case "</ext>":
        a = !1;
        break;
      default:
        if (!a && t.WTF) throw new Error("unrecognized " + f[0] + " in threaded comments");
    }
    return s;
  }), r;
}
function q1(e, t) {
  var r = [], a = !1;
  return e.replace(pr, function(i) {
    var c = Ee(i);
    switch (Lr(c[0])) {
      case "<?xml":
        break;
      /* 2.4.85 personList CT_PersonList */
      case "<personList":
        break;
      case "</personList>":
        break;
      /* 2.6.203 person CT_Person TODO: providers */
      case "<person":
        r.push({ name: c.displayname, id: c.id });
        break;
      case "</person>":
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
      case "<extLst/>":
        break;
      /* 18.2.7  ext CT_Extension + */
      case "<ext":
        a = !0;
        break;
      case "</ext>":
        a = !1;
        break;
      default:
        if (!a && t.WTF) throw new Error("unrecognized " + c[0] + " in threaded comments");
    }
    return i;
  }), r;
}
function $1(e) {
  var t = {};
  t.iauthor = e.read_shift(4);
  var r = da(e);
  return t.rfx = r.s, t.ref = Ge(r.s), e.l += 16, t;
}
var j1 = Nr;
function K1(e, t) {
  var r = [], a = [], n = {}, i = !1;
  return Bt(e, function(s, u, f) {
    switch (f) {
      case 632:
        a.push(s);
        break;
      case 635:
        n = s;
        break;
      case 637:
        n.t = s.t, n.h = s.h, n.r = s.r;
        break;
      case 636:
        if (n.author = a[n.iauthor], delete n.iauthor, t.sheetRows && n.rfx && t.sheetRows <= n.rfx.r) break;
        n.t || (n.t = ""), delete n.rfx, r.push(n);
        break;
      case 3072:
        break;
      case 35:
        i = !0;
        break;
      case 36:
        i = !1;
        break;
      case 37:
        break;
      case 38:
        break;
      default:
        if (!u.T) {
          if (!i || t.WTF) throw new Error("Unexpected record 0x" + f.toString(16));
        }
    }
  }), r;
}
var Y1 = "application/vnd.ms-office.vbaProject";
function J1(e) {
  var t = je.utils.cfb_new({ root: "R" });
  return e.FullPaths.forEach(function(r, a) {
    if (!(r.slice(-1) === "/" || !r.match(/_VBA_PROJECT_CUR/))) {
      var n = r.replace(/^[^\/]*/, "R").replace(/\/_VBA_PROJECT_CUR\u0000*/, "");
      je.utils.cfb_add(t, n, e.FileIndex[a].content);
    }
  }), je.write(t);
}
function Z1() {
  return { "!type": "dialog" };
}
function Q1() {
  return { "!type": "dialog" };
}
function e2() {
  return { "!type": "macro" };
}
function r2() {
  return { "!type": "macro" };
}
var ta = /* @__PURE__ */ (function() {
  var e = /(^|[^A-Za-z_])R(\[?-?\d+\]|[1-9]\d*|)C(\[?-?\d+\]|[1-9]\d*|)(?![A-Za-z0-9_])/g, t = { r: 0, c: 0 };
  function r(a, n, i, c) {
    var s = !1, u = !1;
    i.length == 0 ? u = !0 : i.charAt(0) == "[" && (u = !0, i = i.slice(1, -1)), c.length == 0 ? s = !0 : c.charAt(0) == "[" && (s = !0, c = c.slice(1, -1));
    var f = i.length > 0 ? parseInt(i, 10) | 0 : 0, o = c.length > 0 ? parseInt(c, 10) | 0 : 0;
    return s ? o += t.c : --o, u ? f += t.r : --f, n + (s ? "" : "$") + Je(o) + (u ? "" : "$") + er(f);
  }
  return function(n, i) {
    return t = i, n.replace(e, r);
  };
})(), X0 = /(^|[^._A-Za-z0-9])(\$?)([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])(\$?)(\d{1,7})(?![_.\(A-Za-z0-9])/g;
try {
  X0 = /(^|[^._A-Za-z0-9])([$]?)([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])([$]?)(10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6]|[1-9]\d{0,5})(?![_.\(A-Za-z0-9])/g;
} catch {
}
var t2 = /* @__PURE__ */ (function() {
  return function(t, r) {
    return t.replace(X0, function(a, n, i, c, s, u) {
      var f = M0(c) - (i ? 0 : r.c), o = L0(u) - (s ? 0 : r.r), l = s == "$" ? o + 1 : o == 0 ? "" : "[" + o + "]", x = i == "$" ? f + 1 : f == 0 ? "" : "[" + f + "]";
      return n + "R" + l + "C" + x;
    });
  };
})();
function Uc(e, t) {
  return e.replace(X0, function(r, a, n, i, c, s) {
    return a + (n == "$" ? n + i : Je(M0(i) + t.c)) + (c == "$" ? c + s : er(L0(s) + t.r));
  });
}
function Vi(e, t, r) {
  var a = Nt(t), n = a.s, i = Ir(r), c = { r: i.r - n.r, c: i.c - n.c };
  return Uc(e, c);
}
function a2(e) {
  return e.length != 1;
}
function Wi(e) {
  return e.replace(/_xlfn\./g, "");
}
function or(e) {
  e.l += 1;
}
function Xt(e, t) {
  var r = e.read_shift(2);
  return [r & 16383, r >> 14 & 1, r >> 15 & 1];
}
function Hc(e, t, r) {
  var a = 2;
  if (r) {
    if (r.biff >= 2 && r.biff <= 5) return Vc(e);
    r.biff == 12 && (a = 4);
  }
  var n = e.read_shift(a), i = e.read_shift(a), c = Xt(e), s = Xt(e);
  return { s: { r: n, c: c[0], cRel: c[1], rRel: c[2] }, e: { r: i, c: s[0], cRel: s[1], rRel: s[2] } };
}
function Vc(e) {
  var t = Xt(e), r = Xt(e), a = e.read_shift(1), n = e.read_shift(1);
  return { s: { r: t[0], c: a, cRel: t[1], rRel: t[2] }, e: { r: r[0], c: n, cRel: r[1], rRel: r[2] } };
}
function n2(e, t, r) {
  if (r.biff < 8) return Vc(e);
  var a = e.read_shift(r.biff == 12 ? 4 : 2), n = e.read_shift(r.biff == 12 ? 4 : 2), i = Xt(e), c = Xt(e);
  return { s: { r: a, c: i[0], cRel: i[1], rRel: i[2] }, e: { r: n, c: c[0], cRel: c[1], rRel: c[2] } };
}
function Wc(e, t, r) {
  if (r && r.biff >= 2 && r.biff <= 5) return i2(e);
  var a = e.read_shift(r && r.biff == 12 ? 4 : 2), n = Xt(e);
  return { r: a, c: n[0], cRel: n[1], rRel: n[2] };
}
function i2(e) {
  var t = Xt(e), r = e.read_shift(1);
  return { r: t[0], c: r, cRel: t[1], rRel: t[2] };
}
function s2(e) {
  var t = e.read_shift(2), r = e.read_shift(2);
  return { r: t, c: r & 255, fQuoted: !!(r & 16384), cRel: r >> 15, rRel: r >> 15 };
}
function c2(e, t, r) {
  var a = r && r.biff ? r.biff : 8;
  if (a >= 2 && a <= 5) return u2(e);
  var n = e.read_shift(a >= 12 ? 4 : 2), i = e.read_shift(2), c = (i & 16384) >> 14, s = (i & 32768) >> 15;
  if (i &= 16383, s == 1) for (; n > 524287; ) n -= 1048576;
  if (c == 1) for (; i > 8191; ) i = i - 16384;
  return { r: n, c: i, cRel: c, rRel: s };
}
function u2(e) {
  var t = e.read_shift(2), r = e.read_shift(1), a = (t & 32768) >> 15, n = (t & 16384) >> 14;
  return t &= 16383, a == 1 && t >= 8192 && (t = t - 16384), n == 1 && r >= 128 && (r = r - 256), { r: t, c: r, cRel: n, rRel: a };
}
function f2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5, n = Hc(e, r.biff >= 2 && r.biff <= 5 ? 6 : 8, r);
  return [a, n];
}
function o2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5, n = e.read_shift(2, "i"), i = 8;
  if (r) switch (r.biff) {
    case 5:
      e.l += 12, i = 6;
      break;
    case 12:
      i = 12;
      break;
  }
  var c = Hc(e, i, r);
  return [a, n, c];
}
function l2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5;
  return e.l += r && r.biff > 8 ? 12 : r.biff < 8 ? 6 : 8, [a];
}
function h2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5, n = e.read_shift(2), i = 8;
  if (r) switch (r.biff) {
    case 5:
      e.l += 12, i = 6;
      break;
    case 12:
      i = 12;
      break;
  }
  return e.l += i, [a, n];
}
function d2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5, n = n2(e, t - 1, r);
  return [a, n];
}
function x2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5;
  return e.l += r.biff == 2 ? 6 : r.biff == 12 ? 14 : 7, [a];
}
function Gi(e) {
  var t = e[e.l + 1] & 1, r = 1;
  return e.l += 4, [t, r];
}
function p2(e, t, r) {
  e.l += 2;
  for (var a = e.read_shift(r && r.biff == 2 ? 1 : 2), n = [], i = 0; i <= a; ++i) n.push(e.read_shift(r && r.biff == 2 ? 1 : 2));
  return n;
}
function v2(e, t, r) {
  var a = e[e.l + 1] & 255 ? 1 : 0;
  return e.l += 2, [a, e.read_shift(r && r.biff == 2 ? 1 : 2)];
}
function g2(e, t, r) {
  var a = e[e.l + 1] & 255 ? 1 : 0;
  return e.l += 2, [a, e.read_shift(r && r.biff == 2 ? 1 : 2)];
}
function m2(e) {
  var t = e[e.l + 1] & 255 ? 1 : 0;
  return e.l += 2, [t, e.read_shift(2)];
}
function _2(e, t, r) {
  var a = e[e.l + 1] & 255 ? 1 : 0;
  return e.l += r && r.biff == 2 ? 3 : 4, [a];
}
function Gc(e) {
  var t = e.read_shift(1), r = e.read_shift(1);
  return [t, r];
}
function E2(e) {
  return e.read_shift(2), Gc(e);
}
function w2(e) {
  return e.read_shift(2), Gc(e);
}
function A2(e, t, r) {
  var a = (e[e.l] & 96) >> 5;
  e.l += 1;
  var n = Wc(e, 0, r);
  return [a, n];
}
function T2(e, t, r) {
  var a = (e[e.l] & 96) >> 5;
  e.l += 1;
  var n = c2(e, 0, r);
  return [a, n];
}
function F2(e, t, r) {
  var a = (e[e.l] & 96) >> 5;
  e.l += 1;
  var n = e.read_shift(2);
  r && r.biff == 5 && (e.l += 12);
  var i = Wc(e, 0, r);
  return [a, n, i];
}
function k2(e, t, r) {
  var a = (e[e.l] & 96) >> 5;
  e.l += 1;
  var n = e.read_shift(r && r.biff <= 3 ? 1 : 2);
  return [Dd[n], qc[n], a];
}
function D2(e, t, r) {
  var a = e[e.l++], n = e.read_shift(1), i = r && r.biff <= 3 ? [a == 88 ? -1 : 0, e.read_shift(1)] : C2(e);
  return [n, (i[0] === 0 ? qc : kd)[i[1]]];
}
function C2(e) {
  return [e[e.l + 1] >> 7, e.read_shift(2) & 32767];
}
function y2(e, t, r) {
  e.l += r && r.biff == 2 ? 3 : 4;
}
function S2(e, t, r) {
  if (e.l++, r && r.biff == 12) return [e.read_shift(4, "i"), 0];
  var a = e.read_shift(2), n = e.read_shift(r && r.biff == 2 ? 1 : 2);
  return [a, n];
}
function b2(e) {
  return e.l++, Ur[e.read_shift(1)];
}
function I2(e) {
  return e.l++, e.read_shift(2);
}
function N2(e) {
  return e.l++, e.read_shift(1) !== 0;
}
function O2(e) {
  return e.l++, Sr(e);
}
function R2(e, t, r) {
  return e.l++, ca(e, t - 1, r);
}
function B2(e, t) {
  var r = [e.read_shift(1)];
  if (t == 12) switch (r[0]) {
    case 2:
      r[0] = 4;
      break;
    /* SerBool */
    case 4:
      r[0] = 16;
      break;
    /* SerErr */
    case 0:
      r[0] = 1;
      break;
    /* SerNum */
    case 1:
      r[0] = 2;
      break;
  }
  switch (r[0]) {
    case 4:
      r[1] = fr(e, 1) ? "TRUE" : "FALSE", t != 12 && (e.l += 7);
      break;
    case 37:
    /* appears to be an alias */
    case 16:
      r[1] = Ur[e[e.l]], e.l += t == 12 ? 4 : 8;
      break;
    case 0:
      e.l += 8;
      break;
    case 1:
      r[1] = Sr(e);
      break;
    case 2:
      r[1] = xa(e, 0, { biff: t > 0 && t < 8 ? 2 : t });
      break;
    default:
      throw new Error("Bad SerAr: " + r[0]);
  }
  return r;
}
function L2(e, t, r) {
  for (var a = e.read_shift(r.biff == 12 ? 4 : 2), n = [], i = 0; i != a; ++i) n.push((r.biff == 12 ? da : Xn)(e));
  return n;
}
function M2(e, t, r) {
  var a = 0, n = 0;
  r.biff == 12 ? (a = e.read_shift(4), n = e.read_shift(4)) : (n = 1 + e.read_shift(1), a = 1 + e.read_shift(2)), r.biff >= 2 && r.biff < 8 && (--a, --n == 0 && (n = 256));
  for (var i = 0, c = []; i != a && (c[i] = []); ++i)
    for (var s = 0; s != n; ++s) c[i][s] = B2(e, r.biff);
  return c;
}
function P2(e, t, r) {
  var a = e.read_shift(1) >>> 5 & 3, n = !r || r.biff >= 8 ? 4 : 2, i = e.read_shift(n);
  switch (r.biff) {
    case 2:
      e.l += 5;
      break;
    case 3:
    case 4:
      e.l += 8;
      break;
    case 5:
      e.l += 12;
      break;
  }
  return [a, 0, i];
}
function U2(e, t, r) {
  if (r.biff == 5) return H2(e);
  var a = e.read_shift(1) >>> 5 & 3, n = e.read_shift(2), i = e.read_shift(4);
  return [a, n, i];
}
function H2(e) {
  var t = e.read_shift(1) >>> 5 & 3, r = e.read_shift(2, "i");
  e.l += 8;
  var a = e.read_shift(2);
  return e.l += 12, [t, r, a];
}
function V2(e, t, r) {
  var a = e.read_shift(1) >>> 5 & 3;
  e.l += r && r.biff == 2 ? 3 : 4;
  var n = e.read_shift(r && r.biff == 2 ? 1 : 2);
  return [a, n];
}
function W2(e, t, r) {
  var a = e.read_shift(1) >>> 5 & 3, n = e.read_shift(r && r.biff == 2 ? 1 : 2);
  return [a, n];
}
function G2(e, t, r) {
  var a = e.read_shift(1) >>> 5 & 3;
  return e.l += 4, r.biff < 8 && e.l--, r.biff == 12 && (e.l += 2), [a];
}
function X2(e, t, r) {
  var a = (e[e.l++] & 96) >> 5, n = e.read_shift(2), i = 4;
  if (r) switch (r.biff) {
    case 5:
      i = 15;
      break;
    case 12:
      i = 6;
      break;
  }
  return e.l += i, [a, n];
}
var z2 = Br, q2 = Br, $2 = Br;
function cn(e, t, r) {
  return e.l += 2, [s2(e)];
}
function z0(e) {
  return e.l += 6, [];
}
var j2 = cn, K2 = z0, Y2 = z0, J2 = cn;
function Xc(e) {
  return e.l += 2, [ur(e), e.read_shift(2) & 1];
}
var Z2 = cn, Q2 = Xc, ed = z0, rd = cn, td = cn, ad = [
  "Data",
  "All",
  "Headers",
  "??",
  "?Data2",
  "??",
  "?DataHeaders",
  "??",
  "Totals",
  "??",
  "??",
  "??",
  "?DataTotals",
  "??",
  "??",
  "??",
  "?Current"
];
function nd(e) {
  e.l += 2;
  var t = e.read_shift(2), r = e.read_shift(2), a = e.read_shift(4), n = e.read_shift(2), i = e.read_shift(2), c = ad[r >> 2 & 31];
  return { ixti: t, coltype: r & 3, rt: c, idx: a, c: n, C: i };
}
function id(e) {
  return e.l += 2, [e.read_shift(4)];
}
function sd(e, t, r) {
  return e.l += 5, e.l += 2, e.l += r.biff == 2 ? 1 : 4, ["PTGSHEET"];
}
function cd(e, t, r) {
  return e.l += r.biff == 2 ? 4 : 5, ["PTGENDSHEET"];
}
function ud(e) {
  var t = e.read_shift(1) >>> 5 & 3, r = e.read_shift(2);
  return [t, r];
}
function fd(e) {
  var t = e.read_shift(1) >>> 5 & 3, r = e.read_shift(2);
  return [t, r];
}
function od(e) {
  return e.l += 4, [0, 0];
}
var Xi = {
  1: { n: "PtgExp", f: S2 },
  2: { n: "PtgTbl", f: $2 },
  3: { n: "PtgAdd", f: or },
  4: { n: "PtgSub", f: or },
  5: { n: "PtgMul", f: or },
  6: { n: "PtgDiv", f: or },
  7: { n: "PtgPower", f: or },
  8: { n: "PtgConcat", f: or },
  9: { n: "PtgLt", f: or },
  10: { n: "PtgLe", f: or },
  11: { n: "PtgEq", f: or },
  12: { n: "PtgGe", f: or },
  13: { n: "PtgGt", f: or },
  14: { n: "PtgNe", f: or },
  15: { n: "PtgIsect", f: or },
  16: { n: "PtgUnion", f: or },
  17: { n: "PtgRange", f: or },
  18: { n: "PtgUplus", f: or },
  19: { n: "PtgUminus", f: or },
  20: { n: "PtgPercent", f: or },
  21: { n: "PtgParen", f: or },
  22: { n: "PtgMissArg", f: or },
  23: { n: "PtgStr", f: R2 },
  26: { n: "PtgSheet", f: sd },
  27: { n: "PtgEndSheet", f: cd },
  28: { n: "PtgErr", f: b2 },
  29: { n: "PtgBool", f: N2 },
  30: { n: "PtgInt", f: I2 },
  31: { n: "PtgNum", f: O2 },
  32: { n: "PtgArray", f: x2 },
  33: { n: "PtgFunc", f: k2 },
  34: { n: "PtgFuncVar", f: D2 },
  35: { n: "PtgName", f: P2 },
  36: { n: "PtgRef", f: A2 },
  37: { n: "PtgArea", f: f2 },
  38: { n: "PtgMemArea", f: V2 },
  39: { n: "PtgMemErr", f: z2 },
  40: { n: "PtgMemNoMem", f: q2 },
  41: { n: "PtgMemFunc", f: W2 },
  42: { n: "PtgRefErr", f: G2 },
  43: { n: "PtgAreaErr", f: l2 },
  44: { n: "PtgRefN", f: T2 },
  45: { n: "PtgAreaN", f: d2 },
  46: { n: "PtgMemAreaN", f: ud },
  47: { n: "PtgMemNoMemN", f: fd },
  57: { n: "PtgNameX", f: U2 },
  58: { n: "PtgRef3d", f: F2 },
  59: { n: "PtgArea3d", f: o2 },
  60: { n: "PtgRefErr3d", f: X2 },
  61: { n: "PtgAreaErr3d", f: h2 },
  255: {}
}, ld = {
  64: 32,
  96: 32,
  65: 33,
  97: 33,
  66: 34,
  98: 34,
  67: 35,
  99: 35,
  68: 36,
  100: 36,
  69: 37,
  101: 37,
  70: 38,
  102: 38,
  71: 39,
  103: 39,
  72: 40,
  104: 40,
  73: 41,
  105: 41,
  74: 42,
  106: 42,
  75: 43,
  107: 43,
  76: 44,
  108: 44,
  77: 45,
  109: 45,
  78: 46,
  110: 46,
  79: 47,
  111: 47,
  88: 34,
  120: 34,
  89: 57,
  121: 57,
  90: 58,
  122: 58,
  91: 59,
  123: 59,
  92: 60,
  124: 60,
  93: 61,
  125: 61
}, hd = {
  1: { n: "PtgElfLel", f: Xc },
  2: { n: "PtgElfRw", f: rd },
  3: { n: "PtgElfCol", f: j2 },
  6: { n: "PtgElfRwV", f: td },
  7: { n: "PtgElfColV", f: J2 },
  10: { n: "PtgElfRadical", f: Z2 },
  11: { n: "PtgElfRadicalS", f: ed },
  13: { n: "PtgElfColS", f: K2 },
  15: { n: "PtgElfColSV", f: Y2 },
  16: { n: "PtgElfRadicalLel", f: Q2 },
  25: { n: "PtgList", f: nd },
  29: { n: "PtgSxName", f: id },
  255: {}
}, dd = {
  0: { n: "PtgAttrNoop", f: od },
  1: { n: "PtgAttrSemi", f: _2 },
  2: { n: "PtgAttrIf", f: g2 },
  4: { n: "PtgAttrChoose", f: p2 },
  8: { n: "PtgAttrGoto", f: v2 },
  16: { n: "PtgAttrSum", f: y2 },
  32: { n: "PtgAttrBaxcel", f: Gi },
  33: { n: "PtgAttrBaxcel", f: Gi },
  64: { n: "PtgAttrSpace", f: E2 },
  65: { n: "PtgAttrSpaceSemi", f: w2 },
  128: { n: "PtgAttrIfError", f: m2 },
  255: {}
};
function un(e, t, r, a) {
  if (a.biff < 8) return Br(e, t);
  for (var n = e.l + t, i = [], c = 0; c !== r.length; ++c)
    switch (r[c][0]) {
      case "PtgArray":
        r[c][1] = M2(e, 0, a), i.push(r[c][1]);
        break;
      case "PtgMemArea":
        r[c][2] = L2(e, r[c][1], a), i.push(r[c][2]);
        break;
      case "PtgExp":
        a && a.biff == 12 && (r[c][1][1] = e.read_shift(4), i.push(r[c][1]));
        break;
      case "PtgList":
      /* TODO: PtgList -> PtgExtraList */
      case "PtgElfRadicalS":
      /* TODO: PtgElfRadicalS -> PtgExtraElf */
      case "PtgElfColS":
      /* TODO: PtgElfColS -> PtgExtraElf */
      case "PtgElfColSV":
        throw "Unsupported " + r[c][0];
    }
  return t = n - e.l, t !== 0 && i.push(Br(e, t)), i;
}
function fn(e, t, r) {
  for (var a = e.l + t, n, i, c = []; a != e.l; )
    t = a - e.l, i = e[e.l], n = Xi[i] || Xi[ld[i]], (i === 24 || i === 25) && (n = (i === 24 ? hd : dd)[e[e.l + 1]]), !n || !n.f ? Br(e, t) : c.push([n.n, n.f(e, t, r)]);
  return c;
}
function xd(e) {
  for (var t = [], r = 0; r < e.length; ++r) {
    for (var a = e[r], n = [], i = 0; i < a.length; ++i) {
      var c = a[i];
      c ? c[0] === 2 ? n.push('"' + c[1].replace(/"/g, '""') + '"') : n.push(c[1]) : n.push("");
    }
    t.push(n.join(","));
  }
  return t.join(";");
}
var pd = {
  PtgAdd: "+",
  PtgConcat: "&",
  PtgDiv: "/",
  PtgEq: "=",
  PtgGe: ">=",
  PtgGt: ">",
  PtgLe: "<=",
  PtgLt: "<",
  PtgMul: "*",
  PtgNe: "<>",
  PtgPower: "^",
  PtgSub: "-"
};
function vd(e, t) {
  var r = e.lastIndexOf("!"), a = t.lastIndexOf("!");
  return r == -1 && a == -1 ? e + ":" + t : r > 0 && a > 0 && e.slice(0, r).toLowerCase() == t.slice(0, a).toLowerCase() ? e + ":" + t.slice(a + 1) : (console.error("Cannot hydrate range", e, t), e + ":" + t);
}
function zc(e, t, r) {
  if (!e) return "SH33TJSERR0";
  if (r.biff > 8 && (!e.XTI || !e.XTI[t])) return e.SheetNames[t];
  if (!e.XTI) return "SH33TJSERR6";
  var a = e.XTI[t];
  if (r.biff < 8)
    return t > 1e4 && (t -= 65536), t < 0 && (t = -t), t == 0 ? "" : e.XTI[t - 1];
  if (!a) return "SH33TJSERR1";
  var n = "";
  if (r.biff > 8) switch (e[a[0]][0]) {
    case 357:
      return n = a[1] == -1 ? "#REF" : e.SheetNames[a[1]], a[1] == a[2] ? n : n + ":" + e.SheetNames[a[2]];
    case 358:
      return r.SID != null ? e.SheetNames[r.SID] : "SH33TJSSAME" + e[a[0]][0];
    /* 'BrtSupBookSrc' */
    /* falls through */
    default:
      return "SH33TJSSRC" + e[a[0]][0];
  }
  switch (e[a[0]][0][0]) {
    case 1025:
      return n = a[1] == -1 ? "#REF" : e.SheetNames[a[1]] || "SH33TJSERR3", a[1] == a[2] ? n : n + ":" + e.SheetNames[a[2]];
    case 14849:
      return e[a[0]].slice(1).map(function(i) {
        return i.Name;
      }).join(";;");
    //return "SH33TJSERR8";
    default:
      return e[a[0]][0][3] ? (n = a[1] == -1 ? "#REF" : e[a[0]][0][3][a[1]] || "SH33TJSERR4", a[1] == a[2] ? n : n + ":" + e[a[0]][0][3][a[2]]) : "SH33TJSERR2";
  }
}
function zi(e, t, r) {
  var a = zc(e, t, r);
  return a == "#REF" ? a : zf(a, r);
}
function yr(e, t, r, a, n) {
  var i = n && n.biff || 8, c = (
    /*range != null ? range :*/
    { s: { c: 0, r: 0 } }
  ), s = [], u, f, o, l = 0, x = 0, h, g = "";
  if (!e[0] || !e[0][0]) return "";
  for (var _ = -1, d = "", p = 0, w = e[0].length; p < w; ++p) {
    var m = e[0][p];
    switch (m[0]) {
      case "PtgUminus":
        s.push("-" + s.pop());
        break;
      case "PtgUplus":
        s.push("+" + s.pop());
        break;
      case "PtgPercent":
        s.push(s.pop() + "%");
        break;
      case "PtgAdd":
      /* [MS-XLS] 2.5.198.26 */
      case "PtgConcat":
      /* [MS-XLS] 2.5.198.43 */
      case "PtgDiv":
      /* [MS-XLS] 2.5.198.45 */
      case "PtgEq":
      /* [MS-XLS] 2.5.198.56 */
      case "PtgGe":
      /* [MS-XLS] 2.5.198.64 */
      case "PtgGt":
      /* [MS-XLS] 2.5.198.65 */
      case "PtgLe":
      /* [MS-XLS] 2.5.198.68 */
      case "PtgLt":
      /* [MS-XLS] 2.5.198.69 */
      case "PtgMul":
      /* [MS-XLS] 2.5.198.75 */
      case "PtgNe":
      /* [MS-XLS] 2.5.198.78 */
      case "PtgPower":
      /* [MS-XLS] 2.5.198.82 */
      case "PtgSub":
        if (u = s.pop(), f = s.pop(), _ >= 0) {
          switch (e[0][_][1][0]) {
            case 0:
              d = $e(" ", e[0][_][1][1]);
              break;
            case 1:
              d = $e("\r", e[0][_][1][1]);
              break;
            default:
              if (d = "", n.WTF) throw new Error("Unexpected PtgAttrSpaceType " + e[0][_][1][0]);
          }
          f = f + d, _ = -1;
        }
        s.push(f + pd[m[0]] + u);
        break;
      case "PtgIsect":
        u = s.pop(), f = s.pop(), s.push(f + " " + u);
        break;
      case "PtgUnion":
        u = s.pop(), f = s.pop(), s.push(f + "," + u);
        break;
      case "PtgRange":
        u = s.pop(), f = s.pop(), s.push(vd(f, u));
        break;
      case "PtgAttrChoose":
        break;
      case "PtgAttrGoto":
        break;
      case "PtgAttrIf":
        break;
      case "PtgAttrIfError":
        break;
      case "PtgRef":
        o = Ua(m[1][1], c, n), s.push(Ha(o, i));
        break;
      case "PtgRefN":
        o = r ? Ua(m[1][1], r, n) : m[1][1], s.push(Ha(o, i));
        break;
      case "PtgRef3d":
        l = /*::Number(*/
        m[1][1], o = Ua(m[1][2], c, n), g = zi(a, l, n), s.push(g + "!" + Ha(o, i));
        break;
      case "PtgFunc":
      /* [MS-XLS] 2.5.198.62 */
      case "PtgFuncVar":
        var y = m[1][0], M = m[1][1];
        y || (y = 0), y &= 127;
        var W = y == 0 ? [] : s.slice(-y);
        s.length -= y, M === "User" && (M = W.shift()), s.push(M + "(" + W.join(",") + ")");
        break;
      case "PtgBool":
        s.push(m[1] ? "TRUE" : "FALSE");
        break;
      case "PtgInt":
        s.push(
          /*::String(*/
          m[1]
          /*::)*/
        );
        break;
      case "PtgNum":
        s.push(String(m[1]));
        break;
      case "PtgStr":
        s.push('"' + m[1].replace(/"/g, '""') + '"');
        break;
      case "PtgErr":
        s.push(
          /*::String(*/
          m[1]
          /*::)*/
        );
        break;
      case "PtgAreaN":
        h = Ei(m[1][1], r ? { s: r } : c, n), s.push(e0(h, n));
        break;
      case "PtgArea":
        h = Ei(m[1][1], c, n), s.push(e0(h, n));
        break;
      case "PtgArea3d":
        l = /*::Number(*/
        m[1][1], h = m[1][2], g = zi(a, l, n), s.push(g + "!" + e0(h, n));
        break;
      case "PtgAttrSum":
        s.push("SUM(" + s.pop() + ")");
        break;
      case "PtgAttrBaxcel":
      /* [MS-XLS] 2.5.198.33 */
      case "PtgAttrSemi":
        break;
      case "PtgName":
        x = m[1][2];
        var I = (a.names || [])[x - 1] || (a[0] || [])[x], L = I ? I.Name : "SH33TJSNAME" + String(x);
        L && L.slice(0, 6) == "_xlfn." && !n.xlfn && (L = L.slice(6)), s.push(L);
        break;
      case "PtgNameX":
        var A = m[1][1];
        x = m[1][2];
        var N;
        if (n.biff <= 5)
          A < 0 && (A = -A), a[A] && (N = a[A][x]);
        else {
          var R = "";
          if (((a[A] || [])[0] || [])[0] == 14849 || (((a[A] || [])[0] || [])[0] == 1025 ? a[A][x] && a[A][x].itab > 0 && (R = a.SheetNames[a[A][x].itab - 1] + "!") : R = a.SheetNames[x - 1] + "!"), a[A] && a[A][x]) R += a[A][x].Name;
          else if (a[0] && a[0][x]) R += a[0][x].Name;
          else {
            var V = (zc(a, A, n) || "").split(";;");
            V[x - 1] ? R = V[x - 1] : R += "SH33TJSERRX";
          }
          s.push(R);
          break;
        }
        N || (N = { Name: "SH33TJSERRY" }), s.push(N.Name);
        break;
      case "PtgParen":
        var ae = "(", K = ")";
        if (_ >= 0) {
          switch (d = "", e[0][_][1][0]) {
            // $FlowIgnore
            case 2:
              ae = $e(" ", e[0][_][1][1]) + ae;
              break;
            // $FlowIgnore
            case 3:
              ae = $e("\r", e[0][_][1][1]) + ae;
              break;
            // $FlowIgnore
            case 4:
              K = $e(" ", e[0][_][1][1]) + K;
              break;
            // $FlowIgnore
            case 5:
              K = $e("\r", e[0][_][1][1]) + K;
              break;
            default:
              if (n.WTF) throw new Error("Unexpected PtgAttrSpaceType " + e[0][_][1][0]);
          }
          _ = -1;
        }
        s.push(ae + s.pop() + K);
        break;
      case "PtgRefErr":
        s.push("#REF!");
        break;
      case "PtgRefErr3d":
        s.push("#REF!");
        break;
      case "PtgExp":
        o = { c: m[1][1], r: m[1][0] };
        var J = { c: r.c, r: r.r };
        if (a.sharedf[Ge(o)]) {
          var fe = a.sharedf[Ge(o)];
          s.push(yr(fe, c, J, a, n));
        } else {
          var Y = !1;
          for (u = 0; u != a.arrayf.length; ++u)
            if (f = a.arrayf[u], !(o.c < f[0].s.c || o.c > f[0].e.c) && !(o.r < f[0].s.r || o.r > f[0].e.r)) {
              s.push(yr(f[1], c, J, a, n)), Y = !0;
              break;
            }
          Y || s.push(
            /*::String(*/
            m[1]
            /*::)*/
          );
        }
        break;
      case "PtgArray":
        s.push("{" + xd(
          /*::(*/
          m[1]
          /*:: :any)*/
        ) + "}");
        break;
      case "PtgMemArea":
        break;
      case "PtgAttrSpace":
      /* [MS-XLS] 2.5.198.38 */
      case "PtgAttrSpaceSemi":
        _ = p;
        break;
      case "PtgTbl":
        break;
      case "PtgMemErr":
        break;
      case "PtgMissArg":
        s.push("");
        break;
      case "PtgAreaErr":
        s.push("#REF!");
        break;
      case "PtgAreaErr3d":
        s.push("#REF!");
        break;
      case "PtgList":
        s.push("Table" + m[1].idx + "[#" + m[1].rt + "]");
        break;
      case "PtgMemAreaN":
      case "PtgMemNoMemN":
      case "PtgAttrNoop":
      case "PtgSheet":
      case "PtgEndSheet":
        break;
      case "PtgMemFunc":
        break;
      case "PtgMemNoMem":
        break;
      case "PtgElfCol":
      /* [MS-XLS] 2.5.198.46 */
      case "PtgElfColS":
      /* [MS-XLS] 2.5.198.47 */
      case "PtgElfColSV":
      /* [MS-XLS] 2.5.198.48 */
      case "PtgElfColV":
      /* [MS-XLS] 2.5.198.49 */
      case "PtgElfLel":
      /* [MS-XLS] 2.5.198.50 */
      case "PtgElfRadical":
      /* [MS-XLS] 2.5.198.51 */
      case "PtgElfRadicalLel":
      /* [MS-XLS] 2.5.198.52 */
      case "PtgElfRadicalS":
      /* [MS-XLS] 2.5.198.53 */
      case "PtgElfRw":
      /* [MS-XLS] 2.5.198.54 */
      case "PtgElfRwV":
        throw new Error("Unsupported ELFs");
      case "PtgSxName":
        throw new Error("Unrecognized Formula Token: " + String(m));
      default:
        throw new Error("Unrecognized Formula Token: " + String(m));
    }
    var oe = ["PtgAttrSpace", "PtgAttrSpaceSemi", "PtgAttrGoto"];
    if (n.biff != 3 && _ >= 0 && oe.indexOf(e[0][p][0]) == -1) {
      m = e[0][_];
      var ce = !0;
      switch (m[1][0]) {
        /* note: some bad XLSB files omit the PtgParen */
        case 4:
          ce = !1;
        /* falls through */
        case 0:
          d = $e(" ", m[1][1]);
          break;
        case 5:
          ce = !1;
        /* falls through */
        case 1:
          d = $e("\r", m[1][1]);
          break;
        default:
          if (d = "", n.WTF) throw new Error("Unexpected PtgAttrSpaceType " + m[1][0]);
      }
      s.push((ce ? d : "") + s.pop() + (ce ? "" : d)), _ = -1;
    }
  }
  if (s.length > 1 && n.WTF) throw new Error("bad formula stack");
  return s[0] == "TRUE" ? !0 : s[0] == "FALSE" ? !1 : s[0];
}
function gd(e, t, r) {
  var a = e.l + t, n = r.biff == 2 ? 1 : 2, i, c = e.read_shift(n);
  if (c == 65535) return [[], Br(e, t - 2)];
  var s = fn(e, c, r);
  return t !== c + n && (i = un(e, t - c - n, s, r)), e.l = a, [s, i];
}
function md(e, t, r) {
  var a = e.l + t, n = r.biff == 2 ? 1 : 2, i, c = e.read_shift(n);
  if (c == 65535) return [[], Br(e, t - 2)];
  var s = fn(e, c, r);
  return t !== c + n && (i = un(e, t - c - n, s, r)), e.l = a, [s, i];
}
function _d(e, t, r, a) {
  var n = e.l + t, i = fn(e, a, r), c;
  return n !== e.l && (c = un(e, n - e.l, i, r)), [i, c];
}
function Ed(e, t, r) {
  var a = e.l + t, n, i = e.read_shift(2), c = fn(e, i, r);
  return i == 65535 ? [[], Br(e, t - 2)] : (t !== i + 2 && (n = un(e, a - i - 2, c, r)), [c, n]);
}
function wd(e) {
  var t;
  if (kt(e, e.l + 6) !== 65535) return [Sr(e), "n"];
  switch (e[e.l]) {
    case 0:
      return e.l += 8, ["String", "s"];
    case 1:
      return t = e[e.l + 2] === 1, e.l += 8, [t, "b"];
    case 2:
      return t = e[e.l + 2], e.l += 8, [t, "e"];
    case 3:
      return e.l += 8, ["", "s"];
  }
  return [];
}
function a0(e, t, r) {
  var a = e.l + t, n = ht(e, 6, r), i = wd(e), c = e.read_shift(1);
  r.biff != 2 && (e.read_shift(1), r.biff >= 5 && e.read_shift(4));
  var s = md(e, a - e.l, r);
  return { cell: n, val: i[0], formula: s, shared: c >> 3 & 1, tt: i[1] };
}
function zn(e, t, r) {
  var a = e.read_shift(4), n = fn(e, a, r), i = e.read_shift(4), c = i > 0 ? un(e, i, n, r) : null;
  return [n, c];
}
var Ad = zn, qn = zn, Td = zn, Fd = zn, kd = {
  0: "BEEP",
  1: "OPEN",
  2: "OPEN.LINKS",
  3: "CLOSE.ALL",
  4: "SAVE",
  5: "SAVE.AS",
  6: "FILE.DELETE",
  7: "PAGE.SETUP",
  8: "PRINT",
  9: "PRINTER.SETUP",
  10: "QUIT",
  11: "NEW.WINDOW",
  12: "ARRANGE.ALL",
  13: "WINDOW.SIZE",
  14: "WINDOW.MOVE",
  15: "FULL",
  16: "CLOSE",
  17: "RUN",
  22: "SET.PRINT.AREA",
  23: "SET.PRINT.TITLES",
  24: "SET.PAGE.BREAK",
  25: "REMOVE.PAGE.BREAK",
  26: "FONT",
  27: "DISPLAY",
  28: "PROTECT.DOCUMENT",
  29: "PRECISION",
  30: "A1.R1C1",
  31: "CALCULATE.NOW",
  32: "CALCULATION",
  34: "DATA.FIND",
  35: "EXTRACT",
  36: "DATA.DELETE",
  37: "SET.DATABASE",
  38: "SET.CRITERIA",
  39: "SORT",
  40: "DATA.SERIES",
  41: "TABLE",
  42: "FORMAT.NUMBER",
  43: "ALIGNMENT",
  44: "STYLE",
  45: "BORDER",
  46: "CELL.PROTECTION",
  47: "COLUMN.WIDTH",
  48: "UNDO",
  49: "CUT",
  50: "COPY",
  51: "PASTE",
  52: "CLEAR",
  53: "PASTE.SPECIAL",
  54: "EDIT.DELETE",
  55: "INSERT",
  56: "FILL.RIGHT",
  57: "FILL.DOWN",
  61: "DEFINE.NAME",
  62: "CREATE.NAMES",
  63: "FORMULA.GOTO",
  64: "FORMULA.FIND",
  65: "SELECT.LAST.CELL",
  66: "SHOW.ACTIVE.CELL",
  67: "GALLERY.AREA",
  68: "GALLERY.BAR",
  69: "GALLERY.COLUMN",
  70: "GALLERY.LINE",
  71: "GALLERY.PIE",
  72: "GALLERY.SCATTER",
  73: "COMBINATION",
  74: "PREFERRED",
  75: "ADD.OVERLAY",
  76: "GRIDLINES",
  77: "SET.PREFERRED",
  78: "AXES",
  79: "LEGEND",
  80: "ATTACH.TEXT",
  81: "ADD.ARROW",
  82: "SELECT.CHART",
  83: "SELECT.PLOT.AREA",
  84: "PATTERNS",
  85: "MAIN.CHART",
  86: "OVERLAY",
  87: "SCALE",
  88: "FORMAT.LEGEND",
  89: "FORMAT.TEXT",
  90: "EDIT.REPEAT",
  91: "PARSE",
  92: "JUSTIFY",
  93: "HIDE",
  94: "UNHIDE",
  95: "WORKSPACE",
  96: "FORMULA",
  97: "FORMULA.FILL",
  98: "FORMULA.ARRAY",
  99: "DATA.FIND.NEXT",
  100: "DATA.FIND.PREV",
  101: "FORMULA.FIND.NEXT",
  102: "FORMULA.FIND.PREV",
  103: "ACTIVATE",
  104: "ACTIVATE.NEXT",
  105: "ACTIVATE.PREV",
  106: "UNLOCKED.NEXT",
  107: "UNLOCKED.PREV",
  108: "COPY.PICTURE",
  109: "SELECT",
  110: "DELETE.NAME",
  111: "DELETE.FORMAT",
  112: "VLINE",
  113: "HLINE",
  114: "VPAGE",
  115: "HPAGE",
  116: "VSCROLL",
  117: "HSCROLL",
  118: "ALERT",
  119: "NEW",
  120: "CANCEL.COPY",
  121: "SHOW.CLIPBOARD",
  122: "MESSAGE",
  124: "PASTE.LINK",
  125: "APP.ACTIVATE",
  126: "DELETE.ARROW",
  127: "ROW.HEIGHT",
  128: "FORMAT.MOVE",
  129: "FORMAT.SIZE",
  130: "FORMULA.REPLACE",
  131: "SEND.KEYS",
  132: "SELECT.SPECIAL",
  133: "APPLY.NAMES",
  134: "REPLACE.FONT",
  135: "FREEZE.PANES",
  136: "SHOW.INFO",
  137: "SPLIT",
  138: "ON.WINDOW",
  139: "ON.DATA",
  140: "DISABLE.INPUT",
  142: "OUTLINE",
  143: "LIST.NAMES",
  144: "FILE.CLOSE",
  145: "SAVE.WORKBOOK",
  146: "DATA.FORM",
  147: "COPY.CHART",
  148: "ON.TIME",
  149: "WAIT",
  150: "FORMAT.FONT",
  151: "FILL.UP",
  152: "FILL.LEFT",
  153: "DELETE.OVERLAY",
  155: "SHORT.MENUS",
  159: "SET.UPDATE.STATUS",
  161: "COLOR.PALETTE",
  162: "DELETE.STYLE",
  163: "WINDOW.RESTORE",
  164: "WINDOW.MAXIMIZE",
  166: "CHANGE.LINK",
  167: "CALCULATE.DOCUMENT",
  168: "ON.KEY",
  169: "APP.RESTORE",
  170: "APP.MOVE",
  171: "APP.SIZE",
  172: "APP.MINIMIZE",
  173: "APP.MAXIMIZE",
  174: "BRING.TO.FRONT",
  175: "SEND.TO.BACK",
  185: "MAIN.CHART.TYPE",
  186: "OVERLAY.CHART.TYPE",
  187: "SELECT.END",
  188: "OPEN.MAIL",
  189: "SEND.MAIL",
  190: "STANDARD.FONT",
  191: "CONSOLIDATE",
  192: "SORT.SPECIAL",
  193: "GALLERY.3D.AREA",
  194: "GALLERY.3D.COLUMN",
  195: "GALLERY.3D.LINE",
  196: "GALLERY.3D.PIE",
  197: "VIEW.3D",
  198: "GOAL.SEEK",
  199: "WORKGROUP",
  200: "FILL.GROUP",
  201: "UPDATE.LINK",
  202: "PROMOTE",
  203: "DEMOTE",
  204: "SHOW.DETAIL",
  206: "UNGROUP",
  207: "OBJECT.PROPERTIES",
  208: "SAVE.NEW.OBJECT",
  209: "SHARE",
  210: "SHARE.NAME",
  211: "DUPLICATE",
  212: "APPLY.STYLE",
  213: "ASSIGN.TO.OBJECT",
  214: "OBJECT.PROTECTION",
  215: "HIDE.OBJECT",
  216: "SET.EXTRACT",
  217: "CREATE.PUBLISHER",
  218: "SUBSCRIBE.TO",
  219: "ATTRIBUTES",
  220: "SHOW.TOOLBAR",
  222: "PRINT.PREVIEW",
  223: "EDIT.COLOR",
  224: "SHOW.LEVELS",
  225: "FORMAT.MAIN",
  226: "FORMAT.OVERLAY",
  227: "ON.RECALC",
  228: "EDIT.SERIES",
  229: "DEFINE.STYLE",
  240: "LINE.PRINT",
  243: "ENTER.DATA",
  249: "GALLERY.RADAR",
  250: "MERGE.STYLES",
  251: "EDITION.OPTIONS",
  252: "PASTE.PICTURE",
  253: "PASTE.PICTURE.LINK",
  254: "SPELLING",
  256: "ZOOM",
  259: "INSERT.OBJECT",
  260: "WINDOW.MINIMIZE",
  265: "SOUND.NOTE",
  266: "SOUND.PLAY",
  267: "FORMAT.SHAPE",
  268: "EXTEND.POLYGON",
  269: "FORMAT.AUTO",
  272: "GALLERY.3D.BAR",
  273: "GALLERY.3D.SURFACE",
  274: "FILL.AUTO",
  276: "CUSTOMIZE.TOOLBAR",
  277: "ADD.TOOL",
  278: "EDIT.OBJECT",
  279: "ON.DOUBLECLICK",
  280: "ON.ENTRY",
  281: "WORKBOOK.ADD",
  282: "WORKBOOK.MOVE",
  283: "WORKBOOK.COPY",
  284: "WORKBOOK.OPTIONS",
  285: "SAVE.WORKSPACE",
  288: "CHART.WIZARD",
  289: "DELETE.TOOL",
  290: "MOVE.TOOL",
  291: "WORKBOOK.SELECT",
  292: "WORKBOOK.ACTIVATE",
  293: "ASSIGN.TO.TOOL",
  295: "COPY.TOOL",
  296: "RESET.TOOL",
  297: "CONSTRAIN.NUMERIC",
  298: "PASTE.TOOL",
  302: "WORKBOOK.NEW",
  305: "SCENARIO.CELLS",
  306: "SCENARIO.DELETE",
  307: "SCENARIO.ADD",
  308: "SCENARIO.EDIT",
  309: "SCENARIO.SHOW",
  310: "SCENARIO.SHOW.NEXT",
  311: "SCENARIO.SUMMARY",
  312: "PIVOT.TABLE.WIZARD",
  313: "PIVOT.FIELD.PROPERTIES",
  314: "PIVOT.FIELD",
  315: "PIVOT.ITEM",
  316: "PIVOT.ADD.FIELDS",
  318: "OPTIONS.CALCULATION",
  319: "OPTIONS.EDIT",
  320: "OPTIONS.VIEW",
  321: "ADDIN.MANAGER",
  322: "MENU.EDITOR",
  323: "ATTACH.TOOLBARS",
  324: "VBAActivate",
  325: "OPTIONS.CHART",
  328: "VBA.INSERT.FILE",
  330: "VBA.PROCEDURE.DEFINITION",
  336: "ROUTING.SLIP",
  338: "ROUTE.DOCUMENT",
  339: "MAIL.LOGON",
  342: "INSERT.PICTURE",
  343: "EDIT.TOOL",
  344: "GALLERY.DOUGHNUT",
  350: "CHART.TREND",
  352: "PIVOT.ITEM.PROPERTIES",
  354: "WORKBOOK.INSERT",
  355: "OPTIONS.TRANSITION",
  356: "OPTIONS.GENERAL",
  370: "FILTER.ADVANCED",
  373: "MAIL.ADD.MAILER",
  374: "MAIL.DELETE.MAILER",
  375: "MAIL.REPLY",
  376: "MAIL.REPLY.ALL",
  377: "MAIL.FORWARD",
  378: "MAIL.NEXT.LETTER",
  379: "DATA.LABEL",
  380: "INSERT.TITLE",
  381: "FONT.PROPERTIES",
  382: "MACRO.OPTIONS",
  383: "WORKBOOK.HIDE",
  384: "WORKBOOK.UNHIDE",
  385: "WORKBOOK.DELETE",
  386: "WORKBOOK.NAME",
  388: "GALLERY.CUSTOM",
  390: "ADD.CHART.AUTOFORMAT",
  391: "DELETE.CHART.AUTOFORMAT",
  392: "CHART.ADD.DATA",
  393: "AUTO.OUTLINE",
  394: "TAB.ORDER",
  395: "SHOW.DIALOG",
  396: "SELECT.ALL",
  397: "UNGROUP.SHEETS",
  398: "SUBTOTAL.CREATE",
  399: "SUBTOTAL.REMOVE",
  400: "RENAME.OBJECT",
  412: "WORKBOOK.SCROLL",
  413: "WORKBOOK.NEXT",
  414: "WORKBOOK.PREV",
  415: "WORKBOOK.TAB.SPLIT",
  416: "FULL.SCREEN",
  417: "WORKBOOK.PROTECT",
  420: "SCROLLBAR.PROPERTIES",
  421: "PIVOT.SHOW.PAGES",
  422: "TEXT.TO.COLUMNS",
  423: "FORMAT.CHARTTYPE",
  424: "LINK.FORMAT",
  425: "TRACER.DISPLAY",
  430: "TRACER.NAVIGATE",
  431: "TRACER.CLEAR",
  432: "TRACER.ERROR",
  433: "PIVOT.FIELD.GROUP",
  434: "PIVOT.FIELD.UNGROUP",
  435: "CHECKBOX.PROPERTIES",
  436: "LABEL.PROPERTIES",
  437: "LISTBOX.PROPERTIES",
  438: "EDITBOX.PROPERTIES",
  439: "PIVOT.REFRESH",
  440: "LINK.COMBO",
  441: "OPEN.TEXT",
  442: "HIDE.DIALOG",
  443: "SET.DIALOG.FOCUS",
  444: "ENABLE.OBJECT",
  445: "PUSHBUTTON.PROPERTIES",
  446: "SET.DIALOG.DEFAULT",
  447: "FILTER",
  448: "FILTER.SHOW.ALL",
  449: "CLEAR.OUTLINE",
  450: "FUNCTION.WIZARD",
  451: "ADD.LIST.ITEM",
  452: "SET.LIST.ITEM",
  453: "REMOVE.LIST.ITEM",
  454: "SELECT.LIST.ITEM",
  455: "SET.CONTROL.VALUE",
  456: "SAVE.COPY.AS",
  458: "OPTIONS.LISTS.ADD",
  459: "OPTIONS.LISTS.DELETE",
  460: "SERIES.AXES",
  461: "SERIES.X",
  462: "SERIES.Y",
  463: "ERRORBAR.X",
  464: "ERRORBAR.Y",
  465: "FORMAT.CHART",
  466: "SERIES.ORDER",
  467: "MAIL.LOGOFF",
  468: "CLEAR.ROUTING.SLIP",
  469: "APP.ACTIVATE.MICROSOFT",
  470: "MAIL.EDIT.MAILER",
  471: "ON.SHEET",
  472: "STANDARD.WIDTH",
  473: "SCENARIO.MERGE",
  474: "SUMMARY.INFO",
  475: "FIND.FILE",
  476: "ACTIVE.CELL.FONT",
  477: "ENABLE.TIPWIZARD",
  478: "VBA.MAKE.ADDIN",
  480: "INSERTDATATABLE",
  481: "WORKGROUP.OPTIONS",
  482: "MAIL.SEND.MAILER",
  485: "AUTOCORRECT",
  489: "POST.DOCUMENT",
  491: "PICKLIST",
  493: "VIEW.SHOW",
  494: "VIEW.DEFINE",
  495: "VIEW.DELETE",
  509: "SHEET.BACKGROUND",
  510: "INSERT.MAP.OBJECT",
  511: "OPTIONS.MENONO",
  517: "MSOCHECKS",
  518: "NORMAL",
  519: "LAYOUT",
  520: "RM.PRINT.AREA",
  521: "CLEAR.PRINT.AREA",
  522: "ADD.PRINT.AREA",
  523: "MOVE.BRK",
  545: "HIDECURR.NOTE",
  546: "HIDEALL.NOTES",
  547: "DELETE.NOTE",
  548: "TRAVERSE.NOTES",
  549: "ACTIVATE.NOTES",
  620: "PROTECT.REVISIONS",
  621: "UNPROTECT.REVISIONS",
  647: "OPTIONS.ME",
  653: "WEB.PUBLISH",
  667: "NEWWEBQUERY",
  673: "PIVOT.TABLE.CHART",
  753: "OPTIONS.SAVE",
  755: "OPTIONS.SPELL",
  808: "HIDEALL.INKANNOTS"
}, qc = {
  0: "COUNT",
  1: "IF",
  2: "ISNA",
  3: "ISERROR",
  4: "SUM",
  5: "AVERAGE",
  6: "MIN",
  7: "MAX",
  8: "ROW",
  9: "COLUMN",
  10: "NA",
  11: "NPV",
  12: "STDEV",
  13: "DOLLAR",
  14: "FIXED",
  15: "SIN",
  16: "COS",
  17: "TAN",
  18: "ATAN",
  19: "PI",
  20: "SQRT",
  21: "EXP",
  22: "LN",
  23: "LOG10",
  24: "ABS",
  25: "INT",
  26: "SIGN",
  27: "ROUND",
  28: "LOOKUP",
  29: "INDEX",
  30: "REPT",
  31: "MID",
  32: "LEN",
  33: "VALUE",
  34: "TRUE",
  35: "FALSE",
  36: "AND",
  37: "OR",
  38: "NOT",
  39: "MOD",
  40: "DCOUNT",
  41: "DSUM",
  42: "DAVERAGE",
  43: "DMIN",
  44: "DMAX",
  45: "DSTDEV",
  46: "VAR",
  47: "DVAR",
  48: "TEXT",
  49: "LINEST",
  50: "TREND",
  51: "LOGEST",
  52: "GROWTH",
  53: "GOTO",
  54: "HALT",
  55: "RETURN",
  56: "PV",
  57: "FV",
  58: "NPER",
  59: "PMT",
  60: "RATE",
  61: "MIRR",
  62: "IRR",
  63: "RAND",
  64: "MATCH",
  65: "DATE",
  66: "TIME",
  67: "DAY",
  68: "MONTH",
  69: "YEAR",
  70: "WEEKDAY",
  71: "HOUR",
  72: "MINUTE",
  73: "SECOND",
  74: "NOW",
  75: "AREAS",
  76: "ROWS",
  77: "COLUMNS",
  78: "OFFSET",
  79: "ABSREF",
  80: "RELREF",
  81: "ARGUMENT",
  82: "SEARCH",
  83: "TRANSPOSE",
  84: "ERROR",
  85: "STEP",
  86: "TYPE",
  87: "ECHO",
  88: "SET.NAME",
  89: "CALLER",
  90: "DEREF",
  91: "WINDOWS",
  92: "SERIES",
  93: "DOCUMENTS",
  94: "ACTIVE.CELL",
  95: "SELECTION",
  96: "RESULT",
  97: "ATAN2",
  98: "ASIN",
  99: "ACOS",
  100: "CHOOSE",
  101: "HLOOKUP",
  102: "VLOOKUP",
  103: "LINKS",
  104: "INPUT",
  105: "ISREF",
  106: "GET.FORMULA",
  107: "GET.NAME",
  108: "SET.VALUE",
  109: "LOG",
  110: "EXEC",
  111: "CHAR",
  112: "LOWER",
  113: "UPPER",
  114: "PROPER",
  115: "LEFT",
  116: "RIGHT",
  117: "EXACT",
  118: "TRIM",
  119: "REPLACE",
  120: "SUBSTITUTE",
  121: "CODE",
  122: "NAMES",
  123: "DIRECTORY",
  124: "FIND",
  125: "CELL",
  126: "ISERR",
  127: "ISTEXT",
  128: "ISNUMBER",
  129: "ISBLANK",
  130: "T",
  131: "N",
  132: "FOPEN",
  133: "FCLOSE",
  134: "FSIZE",
  135: "FREADLN",
  136: "FREAD",
  137: "FWRITELN",
  138: "FWRITE",
  139: "FPOS",
  140: "DATEVALUE",
  141: "TIMEVALUE",
  142: "SLN",
  143: "SYD",
  144: "DDB",
  145: "GET.DEF",
  146: "REFTEXT",
  147: "TEXTREF",
  148: "INDIRECT",
  149: "REGISTER",
  150: "CALL",
  151: "ADD.BAR",
  152: "ADD.MENU",
  153: "ADD.COMMAND",
  154: "ENABLE.COMMAND",
  155: "CHECK.COMMAND",
  156: "RENAME.COMMAND",
  157: "SHOW.BAR",
  158: "DELETE.MENU",
  159: "DELETE.COMMAND",
  160: "GET.CHART.ITEM",
  161: "DIALOG.BOX",
  162: "CLEAN",
  163: "MDETERM",
  164: "MINVERSE",
  165: "MMULT",
  166: "FILES",
  167: "IPMT",
  168: "PPMT",
  169: "COUNTA",
  170: "CANCEL.KEY",
  171: "FOR",
  172: "WHILE",
  173: "BREAK",
  174: "NEXT",
  175: "INITIATE",
  176: "REQUEST",
  177: "POKE",
  178: "EXECUTE",
  179: "TERMINATE",
  180: "RESTART",
  181: "HELP",
  182: "GET.BAR",
  183: "PRODUCT",
  184: "FACT",
  185: "GET.CELL",
  186: "GET.WORKSPACE",
  187: "GET.WINDOW",
  188: "GET.DOCUMENT",
  189: "DPRODUCT",
  190: "ISNONTEXT",
  191: "GET.NOTE",
  192: "NOTE",
  193: "STDEVP",
  194: "VARP",
  195: "DSTDEVP",
  196: "DVARP",
  197: "TRUNC",
  198: "ISLOGICAL",
  199: "DCOUNTA",
  200: "DELETE.BAR",
  201: "UNREGISTER",
  204: "USDOLLAR",
  205: "FINDB",
  206: "SEARCHB",
  207: "REPLACEB",
  208: "LEFTB",
  209: "RIGHTB",
  210: "MIDB",
  211: "LENB",
  212: "ROUNDUP",
  213: "ROUNDDOWN",
  214: "ASC",
  215: "DBCS",
  216: "RANK",
  219: "ADDRESS",
  220: "DAYS360",
  221: "TODAY",
  222: "VDB",
  223: "ELSE",
  224: "ELSE.IF",
  225: "END.IF",
  226: "FOR.CELL",
  227: "MEDIAN",
  228: "SUMPRODUCT",
  229: "SINH",
  230: "COSH",
  231: "TANH",
  232: "ASINH",
  233: "ACOSH",
  234: "ATANH",
  235: "DGET",
  236: "CREATE.OBJECT",
  237: "VOLATILE",
  238: "LAST.ERROR",
  239: "CUSTOM.UNDO",
  240: "CUSTOM.REPEAT",
  241: "FORMULA.CONVERT",
  242: "GET.LINK.INFO",
  243: "TEXT.BOX",
  244: "INFO",
  245: "GROUP",
  246: "GET.OBJECT",
  247: "DB",
  248: "PAUSE",
  251: "RESUME",
  252: "FREQUENCY",
  253: "ADD.TOOLBAR",
  254: "DELETE.TOOLBAR",
  255: "User",
  256: "RESET.TOOLBAR",
  257: "EVALUATE",
  258: "GET.TOOLBAR",
  259: "GET.TOOL",
  260: "SPELLING.CHECK",
  261: "ERROR.TYPE",
  262: "APP.TITLE",
  263: "WINDOW.TITLE",
  264: "SAVE.TOOLBAR",
  265: "ENABLE.TOOL",
  266: "PRESS.TOOL",
  267: "REGISTER.ID",
  268: "GET.WORKBOOK",
  269: "AVEDEV",
  270: "BETADIST",
  271: "GAMMALN",
  272: "BETAINV",
  273: "BINOMDIST",
  274: "CHIDIST",
  275: "CHIINV",
  276: "COMBIN",
  277: "CONFIDENCE",
  278: "CRITBINOM",
  279: "EVEN",
  280: "EXPONDIST",
  281: "FDIST",
  282: "FINV",
  283: "FISHER",
  284: "FISHERINV",
  285: "FLOOR",
  286: "GAMMADIST",
  287: "GAMMAINV",
  288: "CEILING",
  289: "HYPGEOMDIST",
  290: "LOGNORMDIST",
  291: "LOGINV",
  292: "NEGBINOMDIST",
  293: "NORMDIST",
  294: "NORMSDIST",
  295: "NORMINV",
  296: "NORMSINV",
  297: "STANDARDIZE",
  298: "ODD",
  299: "PERMUT",
  300: "POISSON",
  301: "TDIST",
  302: "WEIBULL",
  303: "SUMXMY2",
  304: "SUMX2MY2",
  305: "SUMX2PY2",
  306: "CHITEST",
  307: "CORREL",
  308: "COVAR",
  309: "FORECAST",
  310: "FTEST",
  311: "INTERCEPT",
  312: "PEARSON",
  313: "RSQ",
  314: "STEYX",
  315: "SLOPE",
  316: "TTEST",
  317: "PROB",
  318: "DEVSQ",
  319: "GEOMEAN",
  320: "HARMEAN",
  321: "SUMSQ",
  322: "KURT",
  323: "SKEW",
  324: "ZTEST",
  325: "LARGE",
  326: "SMALL",
  327: "QUARTILE",
  328: "PERCENTILE",
  329: "PERCENTRANK",
  330: "MODE",
  331: "TRIMMEAN",
  332: "TINV",
  334: "MOVIE.COMMAND",
  335: "GET.MOVIE",
  336: "CONCATENATE",
  337: "POWER",
  338: "PIVOT.ADD.DATA",
  339: "GET.PIVOT.TABLE",
  340: "GET.PIVOT.FIELD",
  341: "GET.PIVOT.ITEM",
  342: "RADIANS",
  343: "DEGREES",
  344: "SUBTOTAL",
  345: "SUMIF",
  346: "COUNTIF",
  347: "COUNTBLANK",
  348: "SCENARIO.GET",
  349: "OPTIONS.LISTS.GET",
  350: "ISPMT",
  351: "DATEDIF",
  352: "DATESTRING",
  353: "NUMBERSTRING",
  354: "ROMAN",
  355: "OPEN.DIALOG",
  356: "SAVE.DIALOG",
  357: "VIEW.GET",
  358: "GETPIVOTDATA",
  359: "HYPERLINK",
  360: "PHONETIC",
  361: "AVERAGEA",
  362: "MAXA",
  363: "MINA",
  364: "STDEVPA",
  365: "VARPA",
  366: "STDEVA",
  367: "VARA",
  368: "BAHTTEXT",
  369: "THAIDAYOFWEEK",
  370: "THAIDIGIT",
  371: "THAIMONTHOFYEAR",
  372: "THAINUMSOUND",
  373: "THAINUMSTRING",
  374: "THAISTRINGLENGTH",
  375: "ISTHAIDIGIT",
  376: "ROUNDBAHTDOWN",
  377: "ROUNDBAHTUP",
  378: "THAIYEAR",
  379: "RTD",
  380: "CUBEVALUE",
  381: "CUBEMEMBER",
  382: "CUBEMEMBERPROPERTY",
  383: "CUBERANKEDMEMBER",
  384: "HEX2BIN",
  385: "HEX2DEC",
  386: "HEX2OCT",
  387: "DEC2BIN",
  388: "DEC2HEX",
  389: "DEC2OCT",
  390: "OCT2BIN",
  391: "OCT2HEX",
  392: "OCT2DEC",
  393: "BIN2DEC",
  394: "BIN2OCT",
  395: "BIN2HEX",
  396: "IMSUB",
  397: "IMDIV",
  398: "IMPOWER",
  399: "IMABS",
  400: "IMSQRT",
  401: "IMLN",
  402: "IMLOG2",
  403: "IMLOG10",
  404: "IMSIN",
  405: "IMCOS",
  406: "IMEXP",
  407: "IMARGUMENT",
  408: "IMCONJUGATE",
  409: "IMAGINARY",
  410: "IMREAL",
  411: "COMPLEX",
  412: "IMSUM",
  413: "IMPRODUCT",
  414: "SERIESSUM",
  415: "FACTDOUBLE",
  416: "SQRTPI",
  417: "QUOTIENT",
  418: "DELTA",
  419: "GESTEP",
  420: "ISEVEN",
  421: "ISODD",
  422: "MROUND",
  423: "ERF",
  424: "ERFC",
  425: "BESSELJ",
  426: "BESSELK",
  427: "BESSELY",
  428: "BESSELI",
  429: "XIRR",
  430: "XNPV",
  431: "PRICEMAT",
  432: "YIELDMAT",
  433: "INTRATE",
  434: "RECEIVED",
  435: "DISC",
  436: "PRICEDISC",
  437: "YIELDDISC",
  438: "TBILLEQ",
  439: "TBILLPRICE",
  440: "TBILLYIELD",
  441: "PRICE",
  442: "YIELD",
  443: "DOLLARDE",
  444: "DOLLARFR",
  445: "NOMINAL",
  446: "EFFECT",
  447: "CUMPRINC",
  448: "CUMIPMT",
  449: "EDATE",
  450: "EOMONTH",
  451: "YEARFRAC",
  452: "COUPDAYBS",
  453: "COUPDAYS",
  454: "COUPDAYSNC",
  455: "COUPNCD",
  456: "COUPNUM",
  457: "COUPPCD",
  458: "DURATION",
  459: "MDURATION",
  460: "ODDLPRICE",
  461: "ODDLYIELD",
  462: "ODDFPRICE",
  463: "ODDFYIELD",
  464: "RANDBETWEEN",
  465: "WEEKNUM",
  466: "AMORDEGRC",
  467: "AMORLINC",
  468: "CONVERT",
  724: "SHEETJS",
  469: "ACCRINT",
  470: "ACCRINTM",
  471: "WORKDAY",
  472: "NETWORKDAYS",
  473: "GCD",
  474: "MULTINOMIAL",
  475: "LCM",
  476: "FVSCHEDULE",
  477: "CUBEKPIMEMBER",
  478: "CUBESET",
  479: "CUBESETCOUNT",
  480: "IFERROR",
  481: "COUNTIFS",
  482: "SUMIFS",
  483: "AVERAGEIF",
  484: "AVERAGEIFS"
}, Dd = {
  2: 1,
  3: 1,
  10: 0,
  15: 1,
  16: 1,
  17: 1,
  18: 1,
  19: 0,
  20: 1,
  21: 1,
  22: 1,
  23: 1,
  24: 1,
  25: 1,
  26: 1,
  27: 2,
  30: 2,
  31: 3,
  32: 1,
  33: 1,
  34: 0,
  35: 0,
  38: 1,
  39: 2,
  40: 3,
  41: 3,
  42: 3,
  43: 3,
  44: 3,
  45: 3,
  47: 3,
  48: 2,
  53: 1,
  61: 3,
  63: 0,
  65: 3,
  66: 3,
  67: 1,
  68: 1,
  69: 1,
  70: 1,
  71: 1,
  72: 1,
  73: 1,
  74: 0,
  75: 1,
  76: 1,
  77: 1,
  79: 2,
  80: 2,
  83: 1,
  85: 0,
  86: 1,
  89: 0,
  90: 1,
  94: 0,
  95: 0,
  97: 2,
  98: 1,
  99: 1,
  101: 3,
  102: 3,
  105: 1,
  106: 1,
  108: 2,
  111: 1,
  112: 1,
  113: 1,
  114: 1,
  117: 2,
  118: 1,
  119: 4,
  121: 1,
  126: 1,
  127: 1,
  128: 1,
  129: 1,
  130: 1,
  131: 1,
  133: 1,
  134: 1,
  135: 1,
  136: 2,
  137: 2,
  138: 2,
  140: 1,
  141: 1,
  142: 3,
  143: 4,
  144: 4,
  161: 1,
  162: 1,
  163: 1,
  164: 1,
  165: 2,
  172: 1,
  175: 2,
  176: 2,
  177: 3,
  178: 2,
  179: 1,
  184: 1,
  186: 1,
  189: 3,
  190: 1,
  195: 3,
  196: 3,
  197: 1,
  198: 1,
  199: 3,
  201: 1,
  207: 4,
  210: 3,
  211: 1,
  212: 2,
  213: 2,
  214: 1,
  215: 1,
  225: 0,
  229: 1,
  230: 1,
  231: 1,
  232: 1,
  233: 1,
  234: 1,
  235: 3,
  244: 1,
  247: 4,
  252: 2,
  257: 1,
  261: 1,
  271: 1,
  273: 4,
  274: 2,
  275: 2,
  276: 2,
  277: 3,
  278: 3,
  279: 1,
  280: 3,
  281: 3,
  282: 3,
  283: 1,
  284: 1,
  285: 2,
  286: 4,
  287: 3,
  288: 2,
  289: 4,
  290: 3,
  291: 3,
  292: 3,
  293: 4,
  294: 1,
  295: 3,
  296: 1,
  297: 3,
  298: 1,
  299: 2,
  300: 3,
  301: 3,
  302: 4,
  303: 2,
  304: 2,
  305: 2,
  306: 2,
  307: 2,
  308: 2,
  309: 3,
  310: 2,
  311: 2,
  312: 2,
  313: 2,
  314: 2,
  315: 2,
  316: 4,
  325: 2,
  326: 2,
  327: 2,
  328: 2,
  331: 2,
  332: 2,
  337: 2,
  342: 1,
  343: 1,
  346: 2,
  347: 1,
  350: 4,
  351: 3,
  352: 1,
  353: 2,
  360: 1,
  368: 1,
  369: 1,
  370: 1,
  371: 1,
  372: 1,
  373: 1,
  374: 1,
  375: 1,
  376: 1,
  377: 1,
  378: 1,
  382: 3,
  385: 1,
  392: 1,
  393: 1,
  396: 2,
  397: 2,
  398: 2,
  399: 1,
  400: 1,
  401: 1,
  402: 1,
  403: 1,
  404: 1,
  405: 1,
  406: 1,
  407: 1,
  408: 1,
  409: 1,
  410: 1,
  414: 4,
  415: 1,
  416: 1,
  417: 2,
  420: 1,
  421: 1,
  422: 2,
  424: 1,
  425: 2,
  426: 2,
  427: 2,
  428: 2,
  430: 3,
  438: 3,
  439: 3,
  440: 3,
  443: 2,
  444: 2,
  445: 2,
  446: 2,
  447: 6,
  448: 6,
  449: 2,
  450: 2,
  464: 2,
  468: 3,
  476: 2,
  479: 1,
  480: 2,
  65535: 0
};
function qi(e) {
  return e.slice(0, 3) == "of:" && (e = e.slice(3)), e.charCodeAt(0) == 61 && (e = e.slice(1), e.charCodeAt(0) == 61 && (e = e.slice(1))), e = e.replace(/COM\.MICROSOFT\./g, ""), e = e.replace(/\[((?:\.[A-Z]+[0-9]+)(?::\.[A-Z]+[0-9]+)?)\]/g, function(t, r) {
    return r.replace(/\./g, "");
  }), e = e.replace(/\$'([^']|'')+'/g, function(t) {
    return t.slice(1);
  }), e = e.replace(/\$([^\]\. #$]+)/g, function(t, r) {
    return r.match(/^([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])?(10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6]|[1-9]\d{0,5})?$/) ? t : r;
  }), e = e.replace(/\[.(#[A-Z]*[?!])\]/g, "$1"), e.replace(/[;~]/g, ",").replace(/\|/g, ";");
}
function n0(e) {
  e = e.replace(/\$'([^']|'')+'/g, function(a) {
    return a.slice(1);
  }), e = e.replace(/\$([^\]\. #$]+)/g, function(a, n) {
    return n.match(/^([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])?(10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6]|[1-9]\d{0,5})?$/) ? a : n;
  });
  var t = e.split(":"), r = t[0].split(".")[0];
  return [r, t[0].split(".")[1] + (t.length > 1 ? ":" + (t[1].split(".")[1] || t[1].split(".")[0]) : "")];
}
var Ga = {}, Ta = {};
function Xa(e, t) {
  if (e) {
    var r = [0.7, 0.7, 0.75, 0.75, 0.3, 0.3];
    t == "xlml" && (r = [1, 1, 1, 1, 0.5, 0.5]), e.left == null && (e.left = r[0]), e.right == null && (e.right = r[1]), e.top == null && (e.top = r[2]), e.bottom == null && (e.bottom = r[3]), e.header == null && (e.header = r[4]), e.footer == null && (e.footer = r[5]);
  }
}
function St(e, t) {
  return t && br(t).forEach(function(r) {
    e[r] = Ze(t[r]);
  }), e;
}
function $c(e, t) {
  return t && (t.patternType != null && (e.patternType = t.patternType), t.fgColor != null && (e.fgColor = Ze(t.fgColor)), t.bgColor != null && (e.bgColor = Ze(t.bgColor)), t.gradientFill != null && (e.gradientFill = Ze(t.gradientFill))), e;
}
function Cd(e, t, r, a) {
  if (!e || !t) return null;
  var n = {};
  t.xfId != null && e.CellStyleXf && e.CellStyleXf[t.xfId] && St(n, e.CellStyleXf[t.xfId]), St(n, t);
  var i = { id: a, xf: Ze(n) };
  return n.numFmtId != null && (i.numFmtId = n.numFmtId, e.NumberFmt && e.NumberFmt[n.numFmtId] != null && (i.numFmt = e.NumberFmt[n.numFmtId])), n.fontId != null && e.Fonts && e.Fonts[n.fontId] && (i.font = Dn(e.Fonts[n.fontId], r)), n.fillId != null && e.Fills && e.Fills[n.fillId] && (i.fill = Dn(e.Fills[n.fillId], r), $c(i, i.fill)), n.borderId != null && e.Borders && e.Borders[n.borderId] && (i.border = Dn(e.Borders[n.borderId], r)), n.alignment && (i.alignment = Ze(n.alignment)), n.protection && (i.protection = Ze(n.protection)), i;
}
function jc(e, t, r, a, n, i, c, s, u) {
  try {
    a.cellNF && (e.z = Le[t]);
  } catch (l) {
    if (a.WTF) throw l;
  }
  if (!(e.t === "z" && !a.cellStyles)) {
    if (e.t === "d" && typeof e.v == "string" && (e.v = kr(e.v)), (!a || a.cellText !== !1) && e.t !== "z") try {
      if (Le[t] == null && Qt(ju[t] || "General", t), e.t === "e") e.w = e.w || Ur[e.v];
      else if (t === 0)
        if (e.t === "n")
          (e.v | 0) === e.v ? e.w = e.v.toString(10) : e.w = ja(e.v);
        else if (e.t === "d") {
          var f = mr(e.v, !!c);
          (f | 0) === f ? e.w = f.toString(10) : e.w = ja(f);
        } else {
          if (e.v === void 0) return "";
          e.w = na(e.v, Ta);
        }
      else e.t === "d" ? e.w = $r(t, mr(e.v, !!c), Ta) : e.w = $r(t, e.v, Ta);
    } catch (l) {
      if (a.WTF) throw l;
    }
    if (a.cellStyles) {
      if (s != null) try {
        var o = Cd(i, s, n, u);
        if (o) {
          e.s = o;
          return;
        }
      } catch (l) {
        if (a.WTF) throw l;
      }
      if (r != null) try {
        e.s = Dn(i.Fills[r], n);
      } catch (l) {
        if (a.WTF && i.Fills) throw l;
      }
    }
  }
}
function yd(e, t) {
  return !(e.e.r < t.s.r || t.e.r < e.s.r || e.e.c < t.s.c || t.e.c < e.s.c);
}
function q0(e, t) {
  for (var r = e && e["!merges"] || [], a = [], n = e && e["!ref"] ? cr(e["!ref"]) : null, i = {}, c = 0; c < r.length; ++c) {
    var s = r[c], u = "";
    if (!s || !s.s || !s.e) {
      a.push({ code: "E_MERGE_RANGE", message: "Merge range is malformed", index: c });
      continue;
    }
    if (s.s.r < 0 || s.s.c < 0 || s.e.r < s.s.r || s.e.c < s.s.c) {
      a.push({ code: "E_MERGE_RANGE", message: "Merge range is invalid", index: c, range: s });
      continue;
    }
    u = He(s), i[u] != null && a.push({ code: "E_MERGE_DUP", message: "Merge range is duplicated", index: c, other: i[u], range: u }), i[u] = c, n && (s.s.r < n.s.r || s.s.c < n.s.c || s.e.r > n.e.r || s.e.c > n.e.c) && a.push({ code: "E_MERGE_BOUNDS", message: "Merge range exceeds worksheet range", index: c, range: u, ref: He(n) });
    for (var f = 0; f < c; ++f)
      !r[f] || !r[f].s || !r[f].e || yd(s, r[f]) && He(r[f]) != u && a.push({ code: "E_MERGE_OVERLAP", message: "Merge ranges overlap", index: c, other: f, range: u, otherRange: He(r[f]) });
  }
  if (a.length && t && t.WTF) throw new Error(a[0].message + " (" + (a[0].range || a[0].index) + ")");
  return a;
}
function Sd(e, t) {
  var r = cr(t);
  r.s.r <= r.e.r && r.s.c <= r.e.c && r.s.r >= 0 && r.s.c >= 0 && (e["!ref"] = He(r));
}
var bd = /<(?:\w+:)?mergeCell ref=["'][A-Z0-9:]+['"]\s*[\/]?>/g, Id = /<(?:\w+:)?hyperlink [^<>]*>/mg, Nd = /"(\w*:\w*)"/, Od = /<(?:\w+:)?col\b[^<>]*[\/]?>/g, Rd = /<(?:\w:)?autoFilter[^>]*([\/]|>([\s\S]*)<\/(?:\w:)?autoFilter)>/g, Bd = /<(?:\w+:)?pageMargins[^<>]*\/>/g, Kc = /<(?:\w+:)?sheetPr\b[^<>]*?\/>/;
function Ld(e, t, r, a, n, i, c) {
  if (!e) return e;
  a || (a = { "!id": {} });
  var s = {};
  t.dense && (s["!data"] = []);
  var u = { s: { r: 2e6, c: 2e6 }, e: { r: 0, c: 0 } }, f = "", o = "", l = Ye(e, "sheetData");
  l ? (f = e.slice(0, l.index), o = e.slice(l.index + l[0].length)) : f = o = e;
  var x = f.match(Kc);
  x ? $0(x[0], s, n, r) : (x = Ye(f, "sheetPr")) && Md(x[0], x[1] || "", s, n, r);
  var h = (f.match(/<(?:\w*:)?dimension/) || { index: -1 }).index;
  if (h > 0) {
    var g = f.slice(h, h + 50).match(Nd);
    g && !(t && t.nodim) && Sd(s, g[1]);
  }
  var _ = Ye(f, "sheetViews");
  _ && _[1] && Gd(_[1], n);
  var d = [];
  if (t.cellStyles) {
    var p = f.match(Od);
    p && Hd(d, p);
  }
  l && Xd(l[1], s, t, u, i, c, n);
  var w = o.match(Rd);
  w && (s["!autofilter"] = Vd(w[0]));
  var m = [], y = o.match(bd);
  if (y) for (h = 0; h != y.length; ++h)
    m[h] = cr(y[h].slice(y[h].indexOf("=") + 2));
  var M = o.match(Id);
  M && Pd(s, M, a);
  var W = o.match(Bd);
  W && (s["!margins"] = Ud(Ee(W[0])));
  var I;
  if ((I = o.match(/<(?:\w+:)?drawing\b[^<>]*r:id="(.*?)"/)) && (s["!rel"] = I[1]), (I = o.match(/legacyDrawing r:id="(.*?)"/)) && (s["!legrel"] = I[1]), t && t.nodim && (u.s.c = u.s.r = 0), !s["!ref"] && u.e.c >= u.s.c && u.e.r >= u.s.r && (s["!ref"] = He(u)), t.sheetRows > 0 && s["!ref"]) {
    var L = cr(s["!ref"]);
    t.sheetRows <= +L.e.r && (L.e.r = t.sheetRows - 1, L.e.r > u.e.r && (L.e.r = u.e.r), L.e.r < L.s.r && (L.s.r = L.e.r), L.e.c > u.e.c && (L.e.c = u.e.c), L.e.c < L.s.c && (L.s.c = L.e.c), s["!fullref"] = s["!ref"], s["!ref"] = He(L));
  }
  if (d.length > 0 && (s["!cols"] = d), m.length > 0) {
    s["!merges"] = m;
    var A = q0(s, { WTF: !!(t && (t.WTF || t.validateMerges)) });
    A.length && (s["!mergeErrors"] = A);
  }
  return a["!id"][s["!rel"]] && (s["!drawel"] = a["!id"][s["!rel"]]), a["!id"][s["!legrel"]] && (s["!legdrawel"] = a["!id"][s["!legrel"]]), s;
}
function $0(e, t, r, a) {
  var n = Ee(e);
  r.Sheets[a] || (r.Sheets[a] = {}), n.codeName && (r.Sheets[a].CodeName = Ue(Qe(n.codeName)));
}
function Md(e, t, r, a, n) {
  $0(e.slice(0, e.indexOf(">")), r, a, n);
}
function Pd(e, t, r) {
  for (var a = e["!data"] != null, n = 0; n != t.length; ++n) {
    var i = Ee(Qe(t[n]), !0);
    if (!i.ref) return;
    var c = ((r || {})["!id"] || [])[i.id];
    c ? (i.Target = c.Target, i.location && (i.Target += "#" + Ue(i.location))) : (i.Target = "#" + Ue(i.location), c = { Target: i.Target, TargetMode: "Internal" }), i.Rel = c, i.tooltip && (i.Tooltip = i.tooltip, delete i.tooltip);
    for (var s = cr(i.ref), u = s.s.r; u <= s.e.r; ++u) for (var f = s.s.c; f <= s.e.c; ++f) {
      var o = Je(f) + er(u);
      a ? (e["!data"][u] || (e["!data"][u] = []), e["!data"][u][f] || (e["!data"][u][f] = { t: "z", v: void 0 }), e["!data"][u][f].l = i) : (e[o] || (e[o] = { t: "z", v: void 0 }), e[o].l = i);
    }
  }
}
function Ud(e) {
  var t = {};
  return ["left", "right", "top", "bottom", "header", "footer"].forEach(function(r) {
    e[r] && (t[r] = parseFloat(e[r]));
  }), t;
}
function Hd(e, t) {
  for (var r = !1, a = 0; a != t.length; ++a) {
    var n = Ee(t[a], !0);
    n.hidden && (n.hidden = Re(n.hidden)), n.bestFit && (n.bestFit = Re(n.bestFit)), n.customWidth && (n.customWidth = Re(n.customWidth));
    var i = parseInt(n.min, 10) - 1, c = parseInt(n.max, 10) - 1;
    for (n.outlineLevel && (n.level = +n.outlineLevel || 0), delete n.min, delete n.max, n.width = +n.width, !r && n.width && (r = !0, G0(n.width)), Da(n); i <= c; ) e[i++] = Ze(n);
  }
}
function Vd(e) {
  var t = { ref: (e.match(/ref=["']([^"']*)["']/) || [])[1] };
  return t;
}
var Wd = /<(?:\w:)?sheetView(?:[^<>a-z][^<>]*)?\/?>/g;
function Gd(e, t) {
  t.Views || (t.Views = [{}]), (e.match(Wd) || []).forEach(function(r, a) {
    var n = Ee(r);
    t.Views[a] || (t.Views[a] = {}), +n.zoomScale && (t.Views[a].zoom = +n.zoomScale), n.rightToLeft && Re(n.rightToLeft) && (t.Views[a].RTL = !0);
  });
}
var Xd = /* @__PURE__ */ (function() {
  var e = /<(?:\w+:)?c[ \/>]/, t = /<\/(?:\w+:)?row>/, r = /r=["']([^"']*)["']/, a = /ref=["']([^"']*)["']/;
  return function(i, c, s, u, f, o, l) {
    for (var x = 0, h = "", g = [], _ = [], d = 0, p = 0, w = 0, m = "", y, M, W = 0, I = 0, L, A, N = 0, R = 0, V = -1, ae = Array.isArray(o.CellXf), K, J = [], fe = [], Y = c["!data"] != null, oe = [], ce = {}, re = !1, De = !!s.sheetStubs, be = !!((l || {}).WBProps || {}).date1904, de = i.split(t), ie = 0, Se = de.length; ie != Se; ++ie) {
      h = de[ie].trim();
      var _e = h.length;
      if (_e !== 0) {
        var Ne = 0;
        e: for (x = 0; x < _e; ++x) switch (
          /*x.charCodeAt(ri)*/
          h[x]
        ) {
          case ">":
            if (
              /*x.charCodeAt(ri-1) != 47*/
              h[x - 1] != "/"
            ) {
              ++x;
              break e;
            }
            if (s && s.cellStyles) {
              if (M = Ee(h.slice(Ne, x), !0), W = M.r != null ? parseInt(M.r, 10) : W + 1, I = -1, s.sheetRows && s.sheetRows < W) continue;
              ce = {}, re = !1, M.ht && (re = !0, ce.hpt = parseFloat(M.ht), ce.hpx = Za(ce.hpt)), M.hidden && Re(M.hidden) && (re = !0, ce.hidden = !0), M.outlineLevel != null && (re = !0, ce.level = +M.outlineLevel), re && (oe[W - 1] = ce);
            }
            break;
          case "<":
            Ne = x;
            break;
        }
        if (Ne >= x) break;
        if (M = Ee(h.slice(Ne, x), !0), W = M.r != null ? parseInt(M.r, 10) : W + 1, I = -1, !(s.sheetRows && s.sheetRows < W)) {
          s.nodim || (u.s.r > W - 1 && (u.s.r = W - 1), u.e.r < W - 1 && (u.e.r = W - 1)), s && s.cellStyles && (ce = {}, re = !1, M.ht && (re = !0, ce.hpt = parseFloat(M.ht), ce.hpx = Za(ce.hpt)), M.hidden && Re(M.hidden) && (re = !0, ce.hidden = !0), M.outlineLevel != null && (re = !0, ce.level = +M.outlineLevel), re && (oe[W - 1] = ce)), g = h.slice(x).split(e);
          for (var S = 0; S != g.length && g[S].trim().charAt(0) == "<"; ++S) ;
          for (g = g.slice(S), x = 0; x != g.length; ++x)
            if (h = g[x].trim(), h.length !== 0) {
              if (_ = h.match(r), d = x, p = 0, w = 0, h = "<c " + (h.slice(0, 1) == "<" ? ">" : "") + h, _ != null && _.length === 2) {
                for (d = 0, m = _[1], p = 0; p != m.length && !((w = m.charCodeAt(p) - 64) < 1 || w > 26); ++p)
                  d = 26 * d + w;
                --d, I = d;
              } else ++I;
              for (p = 0; p != h.length && h.charCodeAt(p) !== 62; ++p) ;
              if (++p, M = Ee(h.slice(0, p), !0), M.r || (M.r = Ge({ r: W - 1, c: I })), m = h.slice(p), y = { t: "" }, (_ = Ye(m, "v")) != null && /*::cref != null && */
              _[1] !== "" && (y.v = Ue(_[1])), s.cellFormula) {
                if ((_ = Ye(m, "f")) != null) {
                  if (_[1] == "")
                    /*::cref != null && cref[0] != null && */
                    _[0].indexOf('t="shared"') > -1 && (A = Ee(_[0]), fe[A.si] && (y.f = Vi(fe[A.si][1], fe[A.si][2], M.r)));
                  else if (y.f = Ue(Qe(_[1]), !0), s.xlfn || (y.f = Wi(y.f)), /*::cref != null && cref[0] != null && */
                  _[0].indexOf('t="array"') > -1)
                    y.F = (m.match(a) || [])[1], y.F.indexOf(":") > -1 && J.push([cr(y.F), y.F]);
                  else if (
                    /*::cref != null && cref[0] != null && */
                    _[0].indexOf('t="shared"') > -1
                  ) {
                    A = Ee(_[0]);
                    var G = Ue(Qe(_[1]), !0);
                    s.xlfn || (G = Wi(G)), fe[parseInt(A.si, 10)] = [A, G, M.r];
                  }
                } else (_ = m.match(/<f[^<>]*\/>/)) && (A = Ee(_[0]), fe[A.si] && (y.f = Vi(fe[A.si][1], fe[A.si][2], M.r)));
                var H = Ir(M.r);
                for (p = 0; p < J.length; ++p)
                  H.r >= J[p][0].s.r && H.r <= J[p][0].e.r && H.c >= J[p][0].s.c && H.c <= J[p][0].e.c && (y.F = J[p][1]);
              }
              if (M.t == null && y.v === void 0)
                if (y.f || y.F)
                  y.v = 0, y.t = "n";
                else if (De) y.t = "z";
                else continue;
              else y.t = M.t || "n";
              switch (u.s.c > I && (u.s.c = I), u.e.c < I && (u.e.c = I), y.t) {
                case "n":
                  if (y.v == "" || y.v == null) {
                    if (!De) continue;
                    y.t = "z";
                  } else y.v = parseFloat(y.v);
                  break;
                case "s":
                  if (typeof y.v > "u") {
                    if (!De) continue;
                    y.t = "z";
                  } else
                    L = Ga[parseInt(y.v, 10)], y.v = L.t, y.r = L.r, s.cellHTML && (y.h = L.h);
                  break;
                case "str":
                  y.t = "s", y.v = y.v != null ? Ue(Qe(y.v), !0) : "", s.cellHTML && (y.h = Ft(y.v));
                  break;
                case "inlineStr":
                  _ = Ye(m, "is"), y.t = "s", _ != null && (L = V0(_[1])) ? (y.v = L.t, s.cellHTML && (y.h = L.h)) : y.v = "";
                  break;
                case "b":
                  y.v = Re(y.v);
                  break;
                case "d":
                  s.cellDates ? y.v = kr(y.v, be) : (y.v = mr(kr(y.v, be), be), y.t = "n");
                  break;
                /* error string in .w, number in .v */
                case "e":
                  (!s || s.cellText !== !1) && (y.w = y.v), y.v = Tr[y.v];
                  break;
              }
              if (N = R = 0, V = -1, K = null, ae && M.s !== void 0 && (V = parseInt(M.s, 10), K = o.CellXf[V], K != null && (K.numFmtId != null && (N = K.numFmtId), s.cellStyles && K.fillId != null && (R = K.fillId))), jc(y, N, R, s, f, o, be, K, V), s.cellDates && ae && y.t == "n" && lt(Le[N]) && (y.v = Vt(y.v + (be ? 1462 : 0)), y.t = typeof y.v == "number" ? "n" : "d"), M.cm && s.xlmeta) {
                var P = (s.xlmeta.Cell || [])[+M.cm - 1];
                P && P.type == "XLDAPR" && (y.D = !0);
              }
              var ee;
              s.nodim && (ee = Ir(M.r), u.s.r > ee.r && (u.s.r = ee.r), u.e.r < ee.r && (u.e.r = ee.r)), Y ? (ee = Ir(M.r), c["!data"][ee.r] || (c["!data"][ee.r] = []), c["!data"][ee.r][ee.c] = y) : c[M.r] = y;
            }
        }
      }
    }
    oe.length > 0 && (c["!rows"] = oe);
  };
})();
function zd(e, t) {
  var r = {}, a = e.l + t;
  r.r = e.read_shift(4), e.l += 4;
  var n = e.read_shift(2);
  e.l += 1;
  var i = e.read_shift(1);
  return e.l = a, i & 7 && (r.level = i & 7), i & 16 && (r.hidden = !0), i & 32 && (r.hpt = n / 20), r;
}
var qd = da;
function $d() {
}
function jd(e, t) {
  var r = {}, a = e[e.l];
  return ++e.l, r.above = !(a & 64), r.left = !(a & 128), e.l += 18, r.name = Yf(e), r;
}
function Kd(e) {
  var t = it(e);
  return [t];
}
function Yd(e) {
  var t = ha(e);
  return [t];
}
function Jd(e) {
  var t = it(e), r = e.read_shift(1);
  return [t, r, "b"];
}
function Zd(e) {
  var t = ha(e), r = e.read_shift(1);
  return [t, r, "b"];
}
function Qd(e) {
  var t = it(e), r = e.read_shift(1);
  return [t, r, "e"];
}
function ex(e) {
  var t = ha(e), r = e.read_shift(1);
  return [t, r, "e"];
}
function rx(e) {
  var t = it(e), r = e.read_shift(4);
  return [t, r, "s"];
}
function tx(e) {
  var t = ha(e), r = e.read_shift(4);
  return [t, r, "s"];
}
function ax(e) {
  var t = it(e), r = Sr(e);
  return [t, r, "n"];
}
function Yc(e) {
  var t = ha(e), r = Sr(e);
  return [t, r, "n"];
}
function nx(e) {
  var t = it(e), r = Gn(e);
  return [t, r, "n"];
}
function ix(e) {
  var t = ha(e), r = Gn(e);
  return [t, r, "n"];
}
function sx(e) {
  var t = it(e), r = P0(e);
  return [t, r, "is"];
}
function cx(e) {
  var t = it(e), r = Nr(e);
  return [t, r, "str"];
}
function ux(e) {
  var t = ha(e), r = Nr(e);
  return [t, r, "str"];
}
function fx(e, t, r) {
  var a = e.l + t, n = it(e);
  n.r = r["!row"];
  var i = e.read_shift(1), c = [n, i, "b"];
  if (r.cellFormula) {
    e.l += 2;
    var s = qn(e, a - e.l, r);
    c[3] = yr(s, null, n, r.supbooks, r);
  } else e.l = a;
  return c;
}
function ox(e, t, r) {
  var a = e.l + t, n = it(e);
  n.r = r["!row"];
  var i = e.read_shift(1), c = [n, i, "e"];
  if (r.cellFormula) {
    e.l += 2;
    var s = qn(e, a - e.l, r);
    c[3] = yr(s, null, n, r.supbooks, r);
  } else e.l = a;
  return c;
}
function lx(e, t, r) {
  var a = e.l + t, n = it(e);
  n.r = r["!row"];
  var i = Sr(e), c = [n, i, "n"];
  if (r.cellFormula) {
    e.l += 2;
    var s = qn(e, a - e.l, r);
    c[3] = yr(s, null, n, r.supbooks, r);
  } else e.l = a;
  return c;
}
function hx(e, t, r) {
  var a = e.l + t, n = it(e);
  n.r = r["!row"];
  var i = Nr(e), c = [n, i, "str"];
  if (r.cellFormula) {
    e.l += 2;
    var s = qn(e, a - e.l, r);
    c[3] = yr(s, null, n, r.supbooks, r);
  } else e.l = a;
  return c;
}
var dx = da;
function xx(e, t) {
  var r = e.l + t, a = da(e), n = Wn(e), i = Nr(e), c = Nr(e), s = Nr(e);
  e.l = r;
  var u = { rfx: a, relId: n, loc: i, display: s };
  return c && (u.Tooltip = c), u;
}
function px() {
}
function vx(e, t, r) {
  var a = e.l + t, n = cc(e), i = e.read_shift(1), c = [n];
  if (c[2] = i, r.cellFormula) {
    var s = Ad(e, a - e.l, r);
    c[1] = s;
  } else e.l = a;
  return c;
}
function gx(e, t, r) {
  var a = e.l + t, n = da(e), i = [n];
  if (r.cellFormula) {
    var c = Fd(e, a - e.l, r);
    i[1] = c, e.l = a;
  } else e.l = a;
  return i;
}
var mx = ["left", "right", "top", "bottom", "header", "footer"];
function _x(e) {
  var t = {};
  return mx.forEach(function(r) {
    t[r] = Sr(e);
  }), t;
}
function Ex(e) {
  var t = e.read_shift(2);
  return e.l += 28, { RTL: t & 32 };
}
function wx() {
}
function Ax() {
}
function Tx(e, t, r, a, n, i, c) {
  if (!e) return e;
  var s = t || {};
  a || (a = { "!id": {} });
  var u = {};
  s.dense && (u["!data"] = []);
  var f, o = { s: { r: 2e6, c: 2e6 }, e: { r: 0, c: 0 } }, l = !1, x = !1, h, g, _, d, p, w, m, y, M, W = [];
  s.biff = 12, s["!row"] = 0;
  var I = 0, L = !1, A = [], N = {}, R = s.supbooks || /*::(*/
  n.supbooks || [[]];
  if (R.sharedf = N, R.arrayf = A, R.SheetNames = n.SheetNames || n.Sheets.map(function(ce) {
    return ce.name;
  }), !s.supbooks && (s.supbooks = R, n.Names))
    for (var V = 0; V < n.Names.length; ++V) R[0][V + 1] = n.Names[V];
  var ae = [], K = [], J = !1;
  Ln[16] = { n: "BrtShortReal", f: Yc };
  var fe, Y = 1462 * +!!((n || {}).WBProps || {}).date1904;
  if (Bt(e, function(re, De, be) {
    if (!x)
      switch (be) {
        case 148:
          f = re;
          break;
        case 0:
          h = re, s.sheetRows && s.sheetRows <= h.r && (x = !0), y = er(d = h.r), s["!row"] = h.r, (re.hidden || re.hpt || re.level != null) && (re.hpt && (re.hpx = Za(re.hpt)), K[re.r] = re);
          break;
        case 2:
        /* 'BrtCellRk' */
        case 3:
        /* 'BrtCellError' */
        case 4:
        /* 'BrtCellBool' */
        case 5:
        /* 'BrtCellReal' */
        case 6:
        /* 'BrtCellSt' */
        case 7:
        /* 'BrtCellIsst' */
        case 8:
        /* 'BrtFmlaString' */
        case 9:
        /* 'BrtFmlaNum' */
        case 10:
        /* 'BrtFmlaBool' */
        case 11:
        /* 'BrtFmlaError' */
        case 13:
        /* 'BrtShortRk' */
        case 14:
        /* 'BrtShortError' */
        case 15:
        /* 'BrtShortBool' */
        case 16:
        /* 'BrtShortReal' */
        case 17:
        /* 'BrtShortSt' */
        case 18:
        /* 'BrtShortIsst' */
        case 62:
          switch (g = { t: re[2] }, re[2]) {
            case "n":
              g.v = re[1];
              break;
            case "s":
              m = Ga[re[1]], g.v = m.t, g.r = m.r;
              break;
            case "b":
              g.v = !!re[1];
              break;
            case "e":
              g.v = re[1], s.cellText !== !1 && (g.w = Ur[g.v]);
              break;
            case "str":
              g.t = "s", g.v = re[1];
              break;
            case "is":
              g.t = "s", g.v = re[1].t;
              break;
          }
          if ((_ = c.CellXf[re[0].iStyleRef]) && jc(g, _.numFmtId, null, s, i, c, Y > 0, _, re[0].iStyleRef), p = re[0].c == -1 ? p + 1 : re[0].c, s.dense ? (u["!data"][d] || (u["!data"][d] = []), u["!data"][d][p] = g) : u[Je(p) + y] = g, s.cellFormula) {
            for (L = !1, I = 0; I < A.length; ++I) {
              var de = A[I];
              h.r >= de[0].s.r && h.r <= de[0].e.r && p >= de[0].s.c && p <= de[0].e.c && (g.F = He(de[0]), L = !0);
            }
            !L && re.length > 3 && (g.f = re[3]);
          }
          if (o.s.r > h.r && (o.s.r = h.r), o.s.c > p && (o.s.c = p), o.e.r < h.r && (o.e.r = h.r), o.e.c < p && (o.e.c = p), s.cellDates && _ && g.t == "n" && lt(Le[_.numFmtId])) {
            var ie = wt(g.v + Y);
            ie && (g.t = "d", g.v = new Date(Date.UTC(ie.y, ie.m - 1, ie.d, ie.H, ie.M, ie.S, ie.u)));
          }
          fe && (fe.type == "XLDAPR" && (g.D = !0), fe = void 0);
          break;
        case 1:
        /* 'BrtCellBlank' */
        case 12:
          if (!s.sheetStubs || l) break;
          g = { t: "z", v: void 0 }, p = re[0].c == -1 ? p + 1 : re[0].c, s.dense ? (u["!data"][d] || (u["!data"][d] = []), u["!data"][d][p] = g) : u[Je(p) + y] = g, o.s.r > h.r && (o.s.r = h.r), o.s.c > p && (o.s.c = p), o.e.r < h.r && (o.e.r = h.r), o.e.c < p && (o.e.c = p), fe && (fe.type == "XLDAPR" && (g.D = !0), fe = void 0);
          break;
        case 176:
          W.push(re);
          break;
        case 49:
          fe = ((s.xlmeta || {}).Cell || [])[re - 1];
          break;
        case 494:
          var Se = a["!id"][re.relId];
          for (Se ? (re.Target = Se.Target, re.loc && (re.Target += "#" + re.loc), re.Rel = Se) : re.relId == "" && (re.Target = "#" + re.loc), d = re.rfx.s.r; d <= re.rfx.e.r; ++d) for (p = re.rfx.s.c; p <= re.rfx.e.c; ++p)
            s.dense ? (u["!data"][d] || (u["!data"][d] = []), u["!data"][d][p] || (u["!data"][d][p] = { t: "z", v: void 0 }), u["!data"][d][p].l = re) : (w = Je(p) + er(d), u[w] || (u[w] = { t: "z", v: void 0 }), u[w].l = re);
          break;
        case 426:
          if (!s.cellFormula) break;
          A.push(re), M = s.dense ? u["!data"][d][p] : u[Je(p) + y], M.f = yr(re[1], o, { r: h.r, c: p }, R, s), M.F = He(re[0]);
          break;
        case 427:
          if (!s.cellFormula) break;
          N[Ge(re[0].s)] = re[1], M = s.dense ? u["!data"][d][p] : u[Je(p) + y], M.f = yr(re[1], o, { r: h.r, c: p }, R, s);
          break;
        /* identical to 'ColInfo' in XLS */
        case 60:
          if (!s.cellStyles) break;
          for (; re.e >= re.s; )
            ae[re.e--] = { width: re.w / 256, hidden: !!(re.flags & 1), level: re.level }, J || (J = !0, G0(re.w / 256)), Da(ae[re.e + 1]);
          break;
        case 551:
          re && (u["!legrel"] = re);
          break;
        case 161:
          u["!autofilter"] = { ref: He(re) };
          break;
        case 476:
          u["!margins"] = re;
          break;
        case 147:
          n.Sheets[r] || (n.Sheets[r] = {}), re.name && (n.Sheets[r].CodeName = re.name), (re.above || re.left) && (u["!outline"] = { above: re.above, left: re.left });
          break;
        case 137:
          n.Views || (n.Views = [{}]), n.Views[0] || (n.Views[0] = {}), re.RTL && (n.Views[0].RTL = !0);
          break;
        case 485:
          break;
        case 64:
        /* 'BrtDVal' */
        case 1053:
          break;
        case 151:
          break;
        case 152:
        /* 'BrtSel' */
        case 175:
        /* 'BrtAFilterDateGroupItem' */
        case 644:
        /* 'BrtActiveX' */
        case 625:
        /* 'BrtBigName' */
        case 562:
        /* 'BrtBkHim' */
        case 396:
        /* 'BrtBrk' */
        case 1112:
        /* 'BrtCFIcon' */
        case 1146:
        /* 'BrtCFRuleExt' */
        case 471:
        /* 'BrtCFVO' */
        case 1050:
        /* 'BrtCFVO14' */
        case 649:
        /* 'BrtCellIgnoreEC' */
        case 1105:
        /* 'BrtCellIgnoreEC14' */
        case 589:
        /* 'BrtCellSmartTagProperty' */
        case 607:
        /* 'BrtCellWatch' */
        case 564:
        /* 'BrtColor' */
        case 1055:
        /* 'BrtColor14' */
        case 168:
        /* 'BrtColorFilter' */
        case 174:
        /* 'BrtCustomFilter' */
        case 1180:
        /* 'BrtCustomFilter14' */
        case 499:
        /* 'BrtDRef' */
        case 507:
        /* 'BrtDXF' */
        case 550:
        /* 'BrtDrawing' */
        case 171:
        /* 'BrtDynamicFilter' */
        case 167:
        /* 'BrtFilter' */
        case 1177:
        /* 'BrtFilter14' */
        case 169:
        /* 'BrtIconFilter' */
        case 1181:
        /* 'BrtIconFilter14' */
        case 552:
        /* 'BrtLegacyDrawingHF' */
        case 661:
        /* 'BrtListPart' */
        case 639:
        /* 'BrtOleObject' */
        case 478:
        /* 'BrtPageSetup' */
        case 537:
        /* 'BrtPhoneticInfo' */
        case 477:
        /* 'BrtPrintOptions' */
        case 536:
        /* 'BrtRangeProtection' */
        case 1103:
        /* 'BrtRangeProtection14' */
        case 680:
        /* 'BrtRangeProtectionIso' */
        case 1104:
        /* 'BrtRangeProtectionIso14' */
        case 1024:
        /* 'BrtRwDescent' */
        case 663:
        /* 'BrtSheetCalcProp' */
        case 535:
        /* 'BrtSheetProtection' */
        case 678:
        /* 'BrtSheetProtectionIso' */
        case 504:
        /* 'BrtSlc' */
        case 1043:
        /* 'BrtSparkline' */
        case 428:
        /* 'BrtTable' */
        case 170:
        /* 'BrtTop10Filter' */
        case 3072:
        /* 'BrtUid' */
        case 50:
        /* 'BrtValueMeta' */
        case 2070:
        /* 'BrtWebExtension' */
        case 1045:
          break;
        case 35:
          l = !0;
          break;
        case 36:
          l = !1;
          break;
        case 37:
          l = !0;
          break;
        case 38:
          l = !1;
          break;
        default:
          if (!De.T) {
            if (!l || s.WTF) throw new Error("Unexpected record 0x" + be.toString(16));
          }
      }
  }, s), delete s.supbooks, delete s["!row"], !u["!ref"] && (o.s.r < 2e6 || f && (f.e.r > 0 || f.e.c > 0 || f.s.r > 0 || f.s.c > 0)) && (u["!ref"] = He(f || o)), s.sheetRows && u["!ref"]) {
    var oe = cr(u["!ref"]);
    s.sheetRows <= +oe.e.r && (oe.e.r = s.sheetRows - 1, oe.e.r > o.e.r && (oe.e.r = o.e.r), oe.e.r < oe.s.r && (oe.s.r = oe.e.r), oe.e.c > o.e.c && (oe.e.c = o.e.c), oe.e.c < oe.s.c && (oe.s.c = oe.e.c), u["!fullref"] = u["!ref"], u["!ref"] = He(oe));
  }
  return W.length > 0 && (u["!merges"] = W), ae.length > 0 && (u["!cols"] = ae), K.length > 0 && (u["!rows"] = K), a["!id"][u["!legrel"]] && (u["!legdrawel"] = a["!id"][u["!legrel"]]), u;
}
function g0(e) {
  var t = [], r = e.match(/^<c:numCache>/), a;
  (e.match(/<c:pt idx="(\d*)"[^<>\/]*><c:v>([^<]*)<\/c:v><\/c:pt>/mg) || []).forEach(function(i) {
    var c = i.match(/<c:pt idx="(\d*)"[^<>\/]*><c:v>([^<]*)<\/c:v><\/c:pt>/);
    c && (t[+c[1]] = r ? +c[2] : c[2]);
  });
  var n = Ue((ea(e, "c:formatCode") || ["", "General"])[1]);
  return (Ct(e, "<c:f>", "</c:f>") || []).forEach(function(i) {
    a = i.replace(/<[^<>]*>/g, "");
  }), [t, n, a];
}
function Fx(e) {
  var t = Ct(e, "<c:numCache>", "</c:numCache>");
  if (t && t.length) {
    var r = g0(t[0]);
    return { values: r[0], formatCode: r[1], formula: r[2] };
  }
  var a = Ct(e, "<c:strCache>", "</c:strCache>");
  if (a && a.length) {
    var n = g0(a[0]);
    return { values: n[0], formatCode: n[1], formula: n[2] };
  }
  var i = (Ct(e, "<c:f>", "</c:f>") || [])[0];
  return { values: [], formula: i ? i.replace(/<[^<>]*>/g, "") : void 0 };
}
function kx(e) {
  var t = Ct(e, "<c:tx>", "</c:tx>");
  if (!t || !t.length) return "";
  var r = Ye(t[0], "v");
  if (r && r[1]) return Ue(r[1]);
  var a = Ye(t[0], "f");
  return a && a[1] ? Ue(a[1]) : "";
}
function Dx(e) {
  var t = { name: kx(e) }, r = Ye(e, "idx");
  r && (t.idx = +(Ee(r[0]).val || 0));
  var a = Ye(e, "order");
  return a && (t.order = +(Ee(a[0]).val || 0)), ["cat", "val", "xVal", "yVal", "bubbleSize"].forEach(function(n) {
    var i = Ye(e, n);
    i && (t[n] = Fx(i[0]));
  }), t.val && t.val.values ? t.data = t.val.values : t.yVal && t.yVal.values && (t.data = t.yVal.values), t;
}
function Cx(e) {
  var t = Ye(e, "title");
  if (!t) return "";
  var r = [];
  return (t[0].match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g) || []).forEach(function(a) {
    r.push(Ue(a.replace(/<[^>]*>/g, "")));
  }), r.join("");
}
function yx(e, t, r) {
  var a = { target: t, raw: e, rels: r, series: [] };
  a.title = Cx(e);
  var n = Ye(e, "plotArea"), i = n ? n[1] : e;
  ["barChart", "lineChart", "areaChart", "scatterChart", "pieChart", "doughnutChart", "bubbleChart"].forEach(function(u) {
    (Ct(i, "<c:" + u + ">", "</c:" + u + ">") || []).forEach(function(f) {
      a.type || (a.type = u);
      var o = Ye(f, "grouping");
      o && (a.grouping = Ee(o[0]).val), (Ct(f, "<c:ser>", "</c:ser>") || []).forEach(function(l) {
        var x = Dx(l);
        x.chartType = u, a.series.push(x);
      });
    });
  });
  var c = Ye(e, "legend");
  if (c) {
    a.legend = {};
    var s = Ye(c[0], "legendPos");
    s && (a.legend.position = Ee(s[0]).val);
  }
  return a;
}
function Jc(e, t, r, a, n, i) {
  var c = i || { "!type": "chart" };
  if (!e) return i;
  c["!chart"] = yx(e, t, a);
  var s = 0, u = 0, f = "A", o = { s: { r: 2e6, c: 2e6 }, e: { r: 0, c: 0 } };
  return (Ct(e, "<c:numCache>", "</c:numCache>") || []).forEach(function(l) {
    var x = g0(l);
    o.s.r = o.s.c = 0, o.e.c = s, f = Je(s), x[0].forEach(function(h, g) {
      c["!data"] ? (c["!data"][g] || (c["!data"][g] = []), c["!data"][g][s] = { t: "n", v: h, z: x[1] }) : c[f + er(g)] = { t: "n", v: h, z: x[1] }, u = g;
    }), o.e.r < u && (o.e.r = u), ++s;
  }), s > 0 && (c["!ref"] = He(o)), c;
}
function Sx(e, t, r, a, n) {
  if (!e) return e;
  a || (a = { "!id": {} });
  var i = { "!type": "chart", "!drawel": null, "!rel": "" }, c, s = e.match(Kc);
  return s && $0(s[0], i, n, r), (c = e.match(/drawing r:id="(.*?)"/)) && (i["!rel"] = c[1]), a["!id"][i["!rel"]] && (i["!drawel"] = a["!id"][i["!rel"]]), i;
}
function bx(e, t) {
  e.l += 10;
  var r = Nr(e);
  return { name: r };
}
function Ix(e, t, r, a, n) {
  if (!e) return e;
  a || (a = { "!id": {} });
  var i = { "!type": "chart", "!drawel": null, "!rel": "" }, c = !1;
  return Bt(e, function(u, f, o) {
    switch (o) {
      case 550:
        i["!rel"] = u;
        break;
      case 651:
        n.Sheets[r] || (n.Sheets[r] = {}), u.name && (n.Sheets[r].CodeName = u.name);
        break;
      case 562:
      /* 'BrtBkHim' */
      case 652:
      /* 'BrtCsPageSetup' */
      case 669:
      /* 'BrtCsProtection' */
      case 679:
      /* 'BrtCsProtectionIso' */
      case 551:
      /* 'BrtLegacyDrawing' */
      case 552:
      /* 'BrtLegacyDrawingHF' */
      case 476:
      /* 'BrtMargins' */
      case 3072:
        break;
      case 35:
        c = !0;
        break;
      case 36:
        c = !1;
        break;
      case 37:
        break;
      case 38:
        break;
      default:
        if (!(f.T > 0)) {
          if (!(f.T < 0)) {
            if (!c || t.WTF) throw new Error("Unexpected record 0x" + o.toString(16));
          }
        }
    }
  }, t), a["!id"][i["!rel"]] && (i["!drawel"] = a["!id"][i["!rel"]]), i;
}
var Zc = [
  ["allowRefreshQuery", !1, "bool"],
  ["autoCompressPictures", !0, "bool"],
  ["backupFile", !1, "bool"],
  ["checkCompatibility", !1, "bool"],
  ["CodeName", ""],
  ["date1904", !1, "bool"],
  ["defaultThemeVersion", 0, "int"],
  ["filterPrivacy", !1, "bool"],
  ["hidePivotFieldList", !1, "bool"],
  ["promptedSolutions", !1, "bool"],
  ["publishItems", !1, "bool"],
  ["refreshAllConnections", !1, "bool"],
  ["saveExternalLinkValues", !0, "bool"],
  ["showBorderUnselectedTables", !0, "bool"],
  ["showInkAnnotation", !0, "bool"],
  ["showObjects", "all"],
  ["showPivotChartFilter", !1, "bool"],
  ["updateLinks", "userSet"]
], Nx = [
  ["activeTab", 0, "int"],
  ["autoFilterDateGrouping", !0, "bool"],
  ["firstSheet", 0, "int"],
  ["minimized", !1, "bool"],
  ["showHorizontalScroll", !0, "bool"],
  ["showSheetTabs", !0, "bool"],
  ["showVerticalScroll", !0, "bool"],
  ["tabRatio", 600, "int"],
  ["visibility", "visible"]
  //window{Height,Width}, {x,y}Window
], Ox = [
  //['state', 'visible']
], Rx = [
  ["calcCompleted", "true"],
  ["calcMode", "auto"],
  ["calcOnSave", "true"],
  ["concurrentCalc", "true"],
  ["fullCalcOnLoad", "false"],
  ["fullPrecision", "true"],
  ["iterate", "false"],
  ["iterateCount", "100"],
  ["iterateDelta", "0.001"],
  ["refMode", "A1"]
];
function $i(e, t) {
  for (var r = 0; r != e.length; ++r)
    for (var a = e[r], n = 0; n != t.length; ++n) {
      var i = t[n];
      if (a[i[0]] == null) a[i[0]] = i[1];
      else switch (i[2]) {
        case "bool":
          typeof a[i[0]] == "string" && (a[i[0]] = Re(a[i[0]]));
          break;
        case "int":
          typeof a[i[0]] == "string" && (a[i[0]] = parseInt(a[i[0]], 10));
          break;
      }
    }
}
function ji(e, t) {
  for (var r = 0; r != t.length; ++r) {
    var a = t[r];
    if (e[a[0]] == null) e[a[0]] = a[1];
    else switch (a[2]) {
      case "bool":
        typeof e[a[0]] == "string" && (e[a[0]] = Re(e[a[0]]));
        break;
      case "int":
        typeof e[a[0]] == "string" && (e[a[0]] = parseInt(e[a[0]], 10));
        break;
    }
  }
}
function Qc(e) {
  ji(e.WBProps, Zc), ji(e.CalcPr, Rx), $i(e.WBView, Nx), $i(e.Sheets, Ox), Ta.date1904 = Re(e.WBProps.date1904);
}
var Bx = /* @__PURE__ */ ":][*?/\\".split("");
function Lx(e, t) {
  try {
    if (e == "") throw new Error("Sheet name cannot be blank");
    if (e.length > 31) throw new Error("Sheet name cannot exceed 31 chars");
    if (e.charCodeAt(0) == 39 || e.charCodeAt(e.length - 1) == 39) throw new Error("Sheet name cannot start or end with apostrophe (')");
    if (e.toLowerCase() == "history") throw new Error("Sheet name cannot be 'History'");
    Bx.forEach(function(r) {
      if (e.indexOf(r) != -1)
        throw new Error("Sheet name cannot contain : \\ / ? * [ ]");
    });
  } catch (r) {
    throw r;
  }
  return !0;
}
var Mx = /<\w+:workbook/;
function Px(e, t) {
  if (!e) throw new Error("Could not find file");
  var r = (
    /*::(*/
    { AppVersion: {}, WBProps: {}, WBView: [], Sheets: [], CalcPr: {}, Names: [], xmlns: "" }
  ), a = !1, n = "xmlns", i = {}, c = 0;
  if (e.replace(pr, function(u, f) {
    var o = Ee(u);
    switch (Lr(o[0])) {
      case "<?xml":
        break;
      /* 18.2.27 workbook CT_Workbook 1 */
      case "<workbook":
        u.match(Mx) && (n = "xmlns" + u.match(/<(\w+):/)[1]), r.xmlns = o[n];
        break;
      case "</workbook>":
        break;
      /* 18.2.13 fileVersion CT_FileVersion ? */
      case "<fileVersion":
        delete o[0], r.AppVersion = o;
        break;
      case "<fileVersion/>":
      case "</fileVersion>":
        break;
      /* 18.2.12 fileSharing CT_FileSharing ? */
      case "<fileSharing":
        break;
      case "<fileSharing/>":
        break;
      /* 18.2.28 workbookPr CT_WorkbookPr ? */
      case "<workbookPr":
      case "<workbookPr/>":
        Zc.forEach(function(l) {
          if (o[l[0]] != null)
            switch (l[2]) {
              case "bool":
                r.WBProps[l[0]] = Re(o[l[0]]);
                break;
              case "int":
                r.WBProps[l[0]] = parseInt(o[l[0]], 10);
                break;
              default:
                r.WBProps[l[0]] = o[l[0]];
            }
        }), o.codeName && (r.WBProps.CodeName = Qe(o.codeName));
        break;
      case "</workbookPr>":
        break;
      /* 18.2.29 workbookProtection CT_WorkbookProtection ? */
      case "<workbookProtection":
        break;
      case "<workbookProtection/>":
        break;
      /* 18.2.1  bookViews CT_BookViews ? */
      case "<bookViews":
      case "<bookViews>":
      case "</bookViews>":
        break;
      /* 18.2.30   workbookView CT_BookView + */
      case "<workbookView":
      case "<workbookView/>":
        delete o[0], r.WBView.push(o);
        break;
      case "</workbookView>":
        break;
      /* 18.2.20 sheets CT_Sheets 1 */
      case "<sheets":
      case "<sheets>":
      case "</sheets>":
        break;
      // aggregate sheet
      /* 18.2.19   sheet CT_Sheet + */
      case "<sheet":
        switch (o.state) {
          case "hidden":
            o.Hidden = 1;
            break;
          case "veryHidden":
            o.Hidden = 2;
            break;
          default:
            o.Hidden = 0;
        }
        delete o.state, o.name = Ue(Qe(o.name)), delete o[0], r.Sheets.push(o);
        break;
      case "</sheet>":
        break;
      /* 18.2.15 functionGroups CT_FunctionGroups ? */
      case "<functionGroups":
      case "<functionGroups/>":
        break;
      /* 18.2.14   functionGroup CT_FunctionGroup + */
      case "<functionGroup":
        break;
      /* 18.2.9  externalReferences CT_ExternalReferences ? */
      case "<externalReferences":
      case "</externalReferences>":
      case "<externalReferences>":
        break;
      /* 18.2.8    externalReference CT_ExternalReference + */
      case "<externalReference":
        break;
      /* 18.2.6  definedNames CT_DefinedNames ? */
      case "<definedNames/>":
        break;
      case "<definedNames>":
      case "<definedNames":
        a = !0;
        break;
      case "</definedNames>":
        a = !1;
        break;
      /* 18.2.5    definedName CT_DefinedName + */
      case "<definedName":
        i = {}, i.Name = Qe(o.name), o.comment && (i.Comment = o.comment), o.localSheetId && (i.Sheet = +o.localSheetId), Re(o.hidden || "0") && (i.Hidden = !0), c = f + u.length;
        break;
      case "</definedName>":
        i.Ref = Ue(Qe(e.slice(c, f))), r.Names.push(i);
        break;
      case "<definedName/>":
        break;
      /* 18.2.2  calcPr CT_CalcPr ? */
      case "<calcPr":
        delete o[0], r.CalcPr = o;
        break;
      case "<calcPr/>":
        delete o[0], r.CalcPr = o;
        break;
      case "</calcPr>":
        break;
      /* 18.2.16 oleSize CT_OleSize ? (ref required) */
      case "<oleSize":
        break;
      /* 18.2.4  customWorkbookViews CT_CustomWorkbookViews ? */
      case "<customWorkbookViews>":
      case "</customWorkbookViews>":
      case "<customWorkbookViews":
        break;
      /* 18.2.3  customWorkbookView CT_CustomWorkbookView + */
      case "<customWorkbookView":
      case "</customWorkbookView>":
        break;
      /* 18.2.18 pivotCaches CT_PivotCaches ? */
      case "<pivotCaches>":
      case "</pivotCaches>":
      case "<pivotCaches":
        break;
      /* 18.2.17 pivotCache CT_PivotCache ? */
      case "<pivotCache":
        break;
      /* 18.2.21 smartTagPr CT_SmartTagPr ? */
      case "<smartTagPr":
      case "<smartTagPr/>":
        break;
      /* 18.2.23 smartTagTypes CT_SmartTagTypes ? */
      case "<smartTagTypes":
      case "<smartTagTypes>":
      case "</smartTagTypes>":
        break;
      /* 18.2.22 smartTagType CT_SmartTagType ? */
      case "<smartTagType":
        break;
      /* 18.2.24 webPublishing CT_WebPublishing ? */
      case "<webPublishing":
      case "<webPublishing/>":
        break;
      /* 18.2.11 fileRecoveryPr CT_FileRecoveryPr ? */
      case "<fileRecoveryPr":
      case "<fileRecoveryPr/>":
        break;
      /* 18.2.26 webPublishObjects CT_WebPublishObjects ? */
      case "<webPublishObjects>":
      case "<webPublishObjects":
      case "</webPublishObjects>":
        break;
      /* 18.2.25 webPublishObject CT_WebPublishObject ? */
      case "<webPublishObject":
        break;
      /* 18.2.10 extLst CT_ExtensionList ? */
      case "<extLst":
      case "<extLst>":
      case "</extLst>":
      case "<extLst/>":
        break;
      /* 18.2.7  ext CT_Extension + */
      case "<ext":
        a = !0;
        break;
      //TODO: check with versions of excel
      case "</ext>":
        a = !1;
        break;
      /* Others */
      case "<ArchID":
        break;
      case "<AlternateContent":
      case "<AlternateContent>":
        a = !0;
        break;
      case "</AlternateContent>":
        a = !1;
        break;
      /* TODO */
      case "<revisionPtr":
        break;
      default:
        if (!a && t.WTF) throw new Error("unrecognized " + o[0] + " in workbook");
    }
    return u;
  }), If.indexOf(r.xmlns) === -1) throw new Error("Unknown Namespace: " + r.xmlns);
  return Qc(r), r;
}
function Ux(e, t) {
  var r = {};
  return r.Hidden = e.read_shift(4), r.iTabID = e.read_shift(4), r.strRelID = d0(e), r.name = Nr(e), r;
}
function Hx(e, t) {
  var r = {}, a = e.read_shift(4);
  r.defaultThemeVersion = e.read_shift(4);
  var n = t > 8 ? Nr(e) : "";
  return n.length > 0 && (r.CodeName = n), r.autoCompressPictures = !!(a & 65536), r.backupFile = !!(a & 64), r.checkCompatibility = !!(a & 4096), r.date1904 = !!(a & 1), r.filterPrivacy = !!(a & 8), r.hidePivotFieldList = !!(a & 1024), r.promptedSolutions = !!(a & 16), r.publishItems = !!(a & 2048), r.refreshAllConnections = !!(a & 262144), r.saveExternalLinkValues = !!(a & 128), r.showBorderUnselectedTables = !!(a & 4), r.showInkAnnotation = !!(a & 32), r.showObjects = ["all", "placeholders", "none"][a >> 13 & 3], r.showPivotChartFilter = !!(a & 32768), r.updateLinks = ["userSet", "never", "always"][a >> 8 & 3], r;
}
function Vx(e, t) {
  var r = {};
  return e.read_shift(4), r.ArchID = e.read_shift(4), e.l += t - 8, r;
}
function Wx(e, t, r) {
  var a = e.l + t, n = e.read_shift(4);
  e.l += 1;
  var i = e.read_shift(4), c = Jf(e), s, u = "";
  try {
    s = Td(e, 0, r);
    try {
      u = Wn(e);
    } catch {
    }
  } catch {
    console.error("Could not parse defined name " + c);
  }
  n & 32 && (c = "_xlnm." + c), e.l = a;
  var f = { Name: c, Ptg: s, Flags: n };
  return i < 268435455 && (f.Sheet = i), u && (f.Comment = u), f;
}
function Gx(e, t) {
  var r = { AppVersion: {}, WBProps: {}, WBView: [], Sheets: [], CalcPr: {}, xmlns: "" }, a = [], n = !1;
  t || (t = {}), t.biff = 12;
  var i = [], c = [[]];
  return c.SheetNames = [], c.XTI = [], Ln[16] = { n: "BrtFRTArchID$", f: Vx }, Bt(e, function(u, f, o) {
    switch (o) {
      case 156:
        c.SheetNames.push(u.name), r.Sheets.push(u);
        break;
      case 153:
        r.WBProps = u;
        break;
      case 39:
        u.Sheet != null && (t.SID = u.Sheet), u.Ref = u.Ptg ? yr(u.Ptg, null, null, c, t) : "#REF!", delete t.SID, delete u.Ptg, i.push(u);
        break;
      case 1036:
        break;
      case 357:
      /* 'BrtSupSelf' */
      case 358:
      /* 'BrtSupSame' */
      case 355:
      /* 'BrtSupBookSrc' */
      case 667:
        c[0].length ? c.push([o, u]) : c[0] = [o, u], c[c.length - 1].XTI = [];
        break;
      case 362:
        c.length === 0 && (c[0] = [], c[0].XTI = []), c[c.length - 1].XTI = c[c.length - 1].XTI.concat(u), c.XTI = c.XTI.concat(u);
        break;
      case 361:
        break;
      case 2071:
      /* 'BrtAbsPath15' */
      case 158:
      /* 'BrtBookView' */
      case 143:
      /* 'BrtBeginBundleShs' */
      case 664:
      /* 'BrtBeginFnGroup' */
      case 353:
        break;
      /* case 'BrtModelTimeGroupingCalcCol' */
      case 3072:
      /* 'BrtUid' */
      case 3073:
      /* 'BrtRevisionPtr' */
      case 534:
      /* 'BrtBookProtection' */
      case 677:
      /* 'BrtBookProtectionIso' */
      case 157:
      /* 'BrtCalcProp' */
      case 610:
      /* 'BrtCrashRecErr' */
      case 2050:
      /* 'BrtDecoupledPivotCacheID' */
      case 155:
      /* 'BrtFileRecover' */
      case 548:
      /* 'BrtFileSharing' */
      case 676:
      /* 'BrtFileSharingIso' */
      case 128:
      /* 'BrtFileVersion' */
      case 665:
      /* 'BrtFnGroup' */
      case 2128:
      /* 'BrtModelRelationship' */
      case 2125:
      /* 'BrtModelTable' */
      case 549:
      /* 'BrtOleSize' */
      case 2053:
      /* 'BrtPivotTableRef' */
      case 596:
      /* 'BrtSmartTagType' */
      case 2076:
      /* 'BrtTableSlicerCacheID' */
      case 2075:
      /* 'BrtTableSlicerCacheIDs' */
      case 2082:
      /* 'BrtTimelineCachePivotCacheID' */
      case 397:
      /* 'BrtUserBookView' */
      case 154:
      /* 'BrtWbFactoid' */
      case 1117:
      /* 'BrtWbProp14' */
      case 553:
      /* 'BrtWebOpt' */
      case 2091:
        break;
      case 35:
        a.push(o), n = !0;
        break;
      case 36:
        a.pop(), n = !1;
        break;
      case 37:
        a.push(o), n = !0;
        break;
      case 38:
        a.pop(), n = !1;
        break;
      case 16:
        break;
      default:
        if (!f.T) {
          if (!n || t.WTF && a[a.length - 1] != 37 && a[a.length - 1] != 35) throw new Error("Unexpected record 0x" + o.toString(16));
        }
    }
  }, t), Qc(r), r.Names = i, r.supbooks = c, r;
}
function Xx(e, t, r) {
  return t.slice(-4) === ".bin" ? Gx(e, r) : Px(e, r);
}
function zx(e, t, r, a, n, i, c, s) {
  return t.slice(-4) === ".bin" ? Tx(e, a, r, n, i, c, s) : Ld(e, a, r, n, i, c, s);
}
function qx(e, t, r, a, n, i, c, s) {
  return t.slice(-4) === ".bin" ? Ix(e, a, r, n, i) : Sx(e, a, r, n, i);
}
function $x(e, t, r, a, n, i, c, s) {
  return t.slice(-4) === ".bin" ? e2() : r2();
}
function jx(e, t, r, a, n, i, c, s) {
  return t.slice(-4) === ".bin" ? Z1() : Q1();
}
function Kx(e, t, r, a) {
  return t.slice(-4) === ".bin" ? x1(e, r, a) : u1(e, r, a);
}
function Yx(e, t, r) {
  return t.slice(-4) === ".bin" ? dh(e, r) : lh(e, r);
}
function Jx(e, t, r) {
  return t.slice(-4) === ".bin" ? K1(e, r) : X1(e, r);
}
function Zx(e, t, r) {
  return t.slice(-4) === ".bin" ? R1(e) : N1(e);
}
function Qx(e, t, r, a) {
  return r.slice(-4) === ".bin" ? B1(e, t, r, a) : void 0;
}
function ep(e, t, r) {
  return t.slice(-4) === ".bin" ? b1(e, t, r) : I1(e, t, r);
}
var eu = /\b((?:\w+:)?[\w]+)=((?:")([^"]*)(?:")|(?:')([^']*)(?:'))/g, ru = /\b((?:\w+:)?[\w]+)=((?:")(?:[^"]*)(?:")|(?:')(?:[^']*)(?:'))/;
function ct(e, t) {
  var r = e.split(/\s+/), a = [];
  if (a[0] = r[0], r.length === 1) return a;
  var n = e.match(eu), i, c, s, u;
  if (n) for (u = 0; u != n.length; ++u)
    i = n[u].match(ru), (c = i[1].indexOf(":")) === -1 ? a[i[1]] = i[2].slice(1, i[2].length - 1) : (i[1].slice(0, 6) === "xmlns:" ? s = "xmlns" + i[1].slice(6) : s = i[1].slice(c + 1), a[s] = i[2].slice(1, i[2].length - 1));
  return a;
}
function rp(e) {
  var t = e.split(/\s+/), r = {};
  if (t.length === 1) return r;
  var a = e.match(eu), n, i, c, s;
  if (a) for (s = 0; s != a.length; ++s)
    n = a[s].match(ru), (i = n[1].indexOf(":")) === -1 ? r[n[1]] = n[2].slice(1, n[2].length - 1) : (n[1].slice(0, 6) === "xmlns:" ? c = "xmlns" + n[1].slice(6) : c = n[1].slice(i + 1), r[c] = n[2].slice(1, n[2].length - 1));
  return r;
}
var za;
function tp(e, t, r) {
  var a = za[e] || Ue(e);
  return a === "General" ? na(t) : $r(a, t, { date1904: !!r });
}
function ap(e, t, r, a) {
  var n = a;
  switch ((r[0].match(/dt:dt="([\w.]+)"/) || ["", ""])[1]) {
    case "boolean":
      n = Re(a);
      break;
    case "i2":
    case "int":
      n = parseInt(a, 10);
      break;
    case "r4":
    case "float":
      n = parseFloat(a);
      break;
    case "date":
    case "dateTime.tz":
      n = kr(a);
      break;
    case "i8":
    case "string":
    case "fixed":
    case "uuid":
    case "bin.base64":
      break;
    default:
      throw new Error("bad custprop:" + r[0]);
  }
  e[Ue(t)] = n;
}
function np(e, t, r, a) {
  if (e.t !== "z") {
    if (!r || r.cellText !== !1) try {
      e.t === "e" ? e.w = e.w || Ur[e.v] : t === "General" ? e.t === "n" ? (e.v | 0) === e.v ? e.w = e.v.toString(10) : e.w = ja(e.v) : e.w = na(e.v) : e.w = tp(t || "General", e.v, a);
    } catch (c) {
      if (r.WTF) throw c;
    }
    try {
      var n = za[t] || t || "General";
      if (r.cellNF && (e.z = n), r.cellDates && e.t == "n" && lt(n)) {
        var i = wt(e.v + (a ? 1462 : 0));
        i && (e.t = "d", e.v = new Date(Date.UTC(i.y, i.m - 1, i.d, i.H, i.M, i.S, i.u)));
      }
    } catch (c) {
      if (r.WTF) throw c;
    }
  }
}
function ip(e, t, r) {
  if (r.cellStyles && t.Interior) {
    var a = t.Interior;
    a.Pattern && (a.patternType = Zh[a.Pattern] || a.Pattern);
  }
  e[t.ID] = t;
}
function sp(e, t, r, a, n, i, c, s, u, f, o) {
  var l = "General", x = a.StyleID, h = {};
  f = f || {};
  var g = [], _ = 0;
  for (x === void 0 && s && (x = s.StyleID), x === void 0 && c && (x = c.StyleID); i[x] !== void 0; ) {
    var d = i[x];
    if (d.nf && (l = d.nf), d.Interior && g.push(d.Interior), !d.Parent) break;
    x = d.Parent;
  }
  switch (r.Type) {
    case "Boolean":
      a.t = "b", a.v = Re(e);
      break;
    case "String":
      a.t = "s", a.r = li(Ue(e)), a.v = e.indexOf("<") > -1 ? Ue(t || e).replace(/<[^<>]*>/g, "") : a.r;
      break;
    case "DateTime":
      e.slice(-1) != "Z" && (e += "Z"), a.v = mr(kr(e, o), o), a.v !== a.v && (a.v = Ue(e)), (!l || l == "General") && (l = "yyyy-mm-dd");
    /* falls through */
    case "Number":
      a.v === void 0 && (a.v = +e), a.t || (a.t = "n");
      break;
    case "Error":
      a.t = "e", a.v = Tr[e], f.cellText !== !1 && (a.w = e);
      break;
    default:
      e == "" && t == "" ? a.t = "z" : (a.t = "s", a.v = li(t || e));
      break;
  }
  if (np(a, l, f, o), f.cellFormula !== !1)
    if (a.Formula) {
      var p = Ue(a.Formula);
      p.charCodeAt(0) == 61 && (p = p.slice(1)), a.f = ta(p, n), delete a.Formula, a.ArrayRange == "RC" ? a.F = ta("RC:RC", n) : a.ArrayRange && (a.F = ta(a.ArrayRange, n), u.push([cr(a.F), a.F]));
    } else
      for (_ = 0; _ < u.length; ++_)
        n.r >= u[_][0].s.r && n.r <= u[_][0].e.r && n.c >= u[_][0].s.c && n.c <= u[_][0].e.c && (a.F = u[_][1]);
  f.cellStyles && (g.forEach(function(w) {
    !h.patternType && w.patternType && (h.patternType = w.patternType);
  }), a.s = h), a.StyleID !== void 0 && (a.ixfe = a.StyleID);
}
function cp(e) {
  return oc.indexOf("_xlnm." + e) > -1 ? "_xlnm." + e : e;
}
function up(e) {
  e.t = e.v || "", e.t = e.t.replace(/\r\n/g, `
`).replace(/\r/g, `
`), e.v = e.w = e.ixfe = void 0;
}
function i0(e, t) {
  var r = t || {};
  Os();
  var a = Ra(Vn(e));
  (r.type == "binary" || r.type == "array" || r.type == "base64") && (a = Qe(a));
  var n = a.slice(0, 1024).toLowerCase(), i = !1;
  if (n = n.replace(/".*?"/g, ""), (n.indexOf(">") & 1023) > Math.min(n.indexOf(",") & 1023, n.indexOf(";") & 1023)) {
    var c = Ze(r);
    return c.type = "string", ka.to_workbook(a, c);
  }
  if (n.indexOf("<?xml") == -1 && ["html", "table", "head", "meta", "script", "style", "div"].forEach(function(Ae) {
    n.indexOf("<" + Ae) >= 0 && (i = !0);
  }), i) return Pp(a, r);
  za = {
    "General Number": "General",
    "General Date": Le[22],
    "Long Date": "dddd, mmmm dd, yyyy",
    "Medium Date": Le[15],
    "Short Date": Le[14],
    "Long Time": Le[19],
    "Medium Time": Le[18],
    "Short Time": Le[20],
    Currency: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
    Fixed: Le[2],
    Standard: Le[4],
    Percent: Le[10],
    Scientific: Le[11],
    "Yes/No": '"Yes";"Yes";"No";@',
    "True/False": '"True";"True";"False";@',
    "On/Off": '"Yes";"Yes";"No";@'
  };
  var s, u = [], f, o = {}, l = [], x = {}, h = "";
  r.dense && (x["!data"] = []);
  var g = {}, _ = {}, d = ct('<Data ss:Type="String">'), p = 0, w = 0, m = 0, y = { s: { r: 2e6, c: 2e6 }, e: { r: 0, c: 0 } }, M = {}, W = {}, I = "", L = 0, A = [], N = {}, R = {}, V = 0, ae = [], K = [], J = {}, fe = [], Y, oe = !1, ce = [], re = [], De = {}, be = 0, de = 0, ie = { Sheets: [], WBProps: { date1904: !1 } }, Se = {};
  hr.lastIndex = 0, a = an(a, "<!--", "-->");
  for (var _e = ""; s = hr.exec(a); ) switch (s[3] = (_e = s[3]).toLowerCase()) {
    case "data":
      if (_e == "data") {
        if (s[1] === "/") {
          if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
        } else s[0].charAt(s[0].length - 2) !== "/" && u.push([s[3], !0]);
        break;
      }
      if (u[u.length - 1][1]) break;
      s[1] === "/" ? sp(a.slice(p, s.index), I, d, u[u.length - 1][0] == /*"Comment"*/
      "comment" ? J : g, { c: w, r: m }, M, fe[w], _, ce, r, ie.WBProps.date1904) : (I = "", d = ct(s[0]), p = s.index + s[0].length);
      break;
    case "cell":
      if (s[1] === "/")
        if (K.length > 0 && (g.c = K), (!r.sheetRows || r.sheetRows > m) && g.v !== void 0 && (r.dense ? (x["!data"][m] || (x["!data"][m] = []), x["!data"][m][w] = g) : x[Je(w) + er(m)] = g), g.HRef && (g.l = { Target: Ue(g.HRef) }, g.HRefScreenTip && (g.l.Tooltip = g.HRefScreenTip), delete g.HRef, delete g.HRefScreenTip), (g.MergeAcross || g.MergeDown) && (be = w + (parseInt(g.MergeAcross, 10) | 0), de = m + (parseInt(g.MergeDown, 10) | 0), (be > w || de > m) && A.push({ s: { c: w, r: m }, e: { c: be, r: de } })), !r.sheetStubs)
          g.MergeAcross ? w = be + 1 : ++w;
        else if (g.MergeAcross || g.MergeDown) {
          for (var Ne = w; Ne <= be; ++Ne)
            for (var S = m; S <= de; ++S)
              (Ne > w || S > m) && (r.dense ? (x["!data"][S] || (x["!data"][S] = []), x["!data"][S][Ne] = { t: "z" }) : x[Je(Ne) + er(S)] = { t: "z" });
          w = be + 1;
        } else ++w;
      else
        g = rp(s[0]), g.Index && (w = +g.Index - 1), w < y.s.c && (y.s.c = w), w > y.e.c && (y.e.c = w), s[0].slice(-2) === "/>" && ++w, K = [];
      break;
    case "row":
      s[1] === "/" || s[0].slice(-2) === "/>" ? (m < y.s.r && (y.s.r = m), m > y.e.r && (y.e.r = m), s[0].slice(-2) === "/>" && (_ = ct(s[0]), _.Index && (m = +_.Index - 1)), w = 0, ++m) : (_ = ct(s[0]), _.Index && (m = +_.Index - 1), De = {}, (_.AutoFitHeight == "0" || _.Height) && (De.hpx = parseInt(_.Height, 10), De.hpt = Oc(De.hpx), re[m] = De), _.Hidden == "1" && (De.hidden = !0, re[m] = De));
      break;
    case "worksheet":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
        l.push(h), y.s.r <= y.e.r && y.s.c <= y.e.c && (x["!ref"] = He(y), r.sheetRows && r.sheetRows <= y.e.r && (x["!fullref"] = x["!ref"], y.e.r = r.sheetRows - 1, x["!ref"] = He(y))), A.length && (x["!merges"] = A), fe.length > 0 && (x["!cols"] = fe), re.length > 0 && (x["!rows"] = re), o[h] = x;
      } else
        y = { s: { r: 2e6, c: 2e6 }, e: { r: 0, c: 0 } }, m = w = 0, u.push([s[3], !1]), f = ct(s[0]), h = Ue(f.Name), x = {}, r.dense && (x["!data"] = []), A = [], ce = [], re = [], Se = { name: h, Hidden: 0 }, ie.Sheets.push(Se);
      break;
    case "table":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
      } else {
        if (s[0].slice(-2) == "/>") break;
        u.push([s[3], !1]), fe = [], oe = !1;
      }
      break;
    case "style":
      s[1] === "/" ? ip(M, W, r) : W = ct(s[0]);
      break;
    case "numberformat":
      W.nf = Ue(ct(s[0]).Format || "General"), za[W.nf] && (W.nf = za[W.nf]);
      for (var G = 0; G != 392 && Le[G] != W.nf; ++G) ;
      if (G == 392) {
        for (G = 57; G != 392; ++G) if (Le[G] == null) {
          Qt(W.nf, G);
          break;
        }
      }
      break;
    case "column":
      if (u[u.length - 1][0] !== /*'Table'*/
      "table" || s[1] === "/") break;
      if (Y = ct(s[0]), Y.Hidden && (Y.hidden = !0, delete Y.Hidden), Y.Width && (Y.wpx = parseInt(Y.Width, 10)), !oe && Y.wpx > 10) {
        oe = !0, sr = yc;
        for (var H = 0; H < fe.length; ++H) fe[H] && Da(fe[H]);
      }
      oe && Da(Y), fe[Y.Index - 1 || fe.length] = Y;
      for (var P = 0; P < +Y.Span; ++P) fe[fe.length] = Ze(Y);
      break;
    case "namedrange":
      if (s[1] === "/") break;
      ie.Names || (ie.Names = []);
      var ee = Ee(s[0]), Fe = {
        Name: cp(ee.Name),
        Ref: ta(ee.RefersTo.slice(1), { r: 0, c: 0 })
      };
      ie.Sheets.length > 0 && (Fe.Sheet = ie.Sheets.length - 1), ie.Names.push(Fe);
      break;
    case "namedcell":
      break;
    case "b":
      break;
    case "i":
      break;
    case "u":
      break;
    case "s":
      break;
    case "em":
      break;
    case "h2":
      break;
    case "h3":
      break;
    case "sub":
      break;
    case "sup":
      break;
    case "span":
      break;
    case "alignment":
      break;
    case "borders":
      break;
    case "border":
      break;
    case "font":
      if (s[0].slice(-2) === "/>") break;
      s[1] === "/" ? I += a.slice(L, s.index) : L = s.index + s[0].length;
      break;
    case "interior":
      if (!r.cellStyles) break;
      W.Interior = ct(s[0]);
      break;
    case "protection":
      break;
    case "author":
    case "title":
    case "description":
    case "created":
    case "keywords":
    case "subject":
    case "category":
    case "company":
    case "lastauthor":
    case "lastsaved":
    case "lastprinted":
    case "version":
    case "revision":
    case "totaltime":
    case "hyperlinkbase":
    case "manager":
    case "contentstatus":
    case "identifier":
    case "language":
    case "appname":
      if (s[0].slice(-2) === "/>") break;
      s[1] === "/" ? Ao(N, _e, a.slice(V, s.index)) : V = s.index + s[0].length;
      break;
    case "paragraphs":
      break;
    case "styles":
    case "workbook":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
      } else u.push([s[3], !1]);
      break;
    case "comment":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
        up(J), K.push(J);
      } else
        u.push([s[3], !1]), f = ct(s[0]), Re(f.ShowAlways || "0") || (K.hidden = !0), J = { a: f.Author };
      break;
    case "autofilter":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
      } else if (s[0].charAt(s[0].length - 2) !== "/") {
        var te = ct(s[0]);
        x["!autofilter"] = { ref: ta(te.Range).replace(/\$/g, "") }, u.push([s[3], !0]);
      }
      break;
    case "name":
      break;
    case "datavalidation":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
      } else
        s[0].charAt(s[0].length - 2) !== "/" && u.push([s[3], !0]);
      break;
    case "pixelsperinch":
      break;
    case "componentoptions":
    case "documentproperties":
    case "customdocumentproperties":
    case "officedocumentsettings":
    case "pivottable":
    case "pivotcache":
    case "names":
    case "mapinfo":
    case "pagebreaks":
    case "querytable":
    case "sorting":
    case "schema":
    //case 'data' /*case 'data'*/:
    case "conditionalformatting":
    case "smarttagtype":
    case "smarttags":
    case "excelworkbook":
    case "workbookoptions":
    case "worksheetoptions":
      if (s[1] === "/") {
        if ((f = u.pop())[0] !== s[3]) throw new Error("Bad state: " + f.join("|"));
      } else s[0].charAt(s[0].length - 2) !== "/" && u.push([s[3], !0]);
      break;
    case "null":
      break;
    default:
      if (u.length == 0 && s[3] == "document" || u.length == 0 && s[3] == "uof") return as(a, r);
      var ue = !0;
      switch (u[u.length - 1][0]) {
        /* OfficeDocumentSettings */
        case "officedocumentsettings":
          switch (s[3]) {
            case "allowpng":
              break;
            case "removepersonalinformation":
              break;
            case "downloadcomponents":
              break;
            case "locationofcomponents":
              break;
            case "colors":
              break;
            case "color":
              break;
            case "index":
              break;
            case "rgb":
              break;
            case "targetscreensize":
              break;
            case "readonlyrecommended":
              break;
            default:
              ue = !1;
          }
          break;
        /* ComponentOptions */
        case "componentoptions":
          switch (s[3]) {
            case "toolbar":
              break;
            case "hideofficelogo":
              break;
            case "spreadsheetautofit":
              break;
            case "label":
              break;
            case "caption":
              break;
            case "maxheight":
              break;
            case "maxwidth":
              break;
            case "nextsheetnumber":
              break;
            default:
              ue = !1;
          }
          break;
        /* ExcelWorkbook */
        case "excelworkbook":
          switch (s[3]) {
            case "date1904":
              ie.WBProps.date1904 = !0;
              break;
            case "hidehorizontalscrollbar":
              break;
            case "hideverticalscrollbar":
              break;
            case "hideworkbooktabs":
              break;
            case "windowheight":
              break;
            case "windowwidth":
              break;
            case "windowtopx":
              break;
            case "windowtopy":
              break;
            case "tabratio":
              break;
            case "protectstructure":
              break;
            case "protectwindow":
              break;
            case "protectwindows":
              break;
            case "activesheet":
              break;
            case "displayinknotes":
              break;
            case "firstvisiblesheet":
              break;
            case "supbook":
              break;
            case "sheetname":
              break;
            case "sheetindex":
              break;
            case "sheetindexfirst":
              break;
            case "sheetindexlast":
              break;
            case "dll":
              break;
            case "acceptlabelsinformulas":
              break;
            case "donotsavelinkvalues":
              break;
            case "iteration":
              break;
            case "maxiterations":
              break;
            case "maxchange":
              break;
            case "path":
              break;
            case "xct":
              break;
            case "count":
              break;
            case "selectedsheets":
              break;
            case "calculation":
              break;
            case "uncalced":
              break;
            case "startupprompt":
              break;
            case "crn":
              break;
            case "externname":
              break;
            case "formula":
              break;
            case "colfirst":
              break;
            case "collast":
              break;
            case "wantadvise":
              break;
            case "boolean":
              break;
            case "error":
              break;
            case "text":
              break;
            case "ole":
              break;
            case "noautorecover":
              break;
            case "publishobjects":
              break;
            case "donotcalculatebeforesave":
              break;
            case "number":
              break;
            case "refmoder1c1":
              break;
            case "embedsavesmarttags":
              break;
            default:
              ue = !1;
          }
          break;
        /* WorkbookOptions */
        case "workbookoptions":
          switch (s[3]) {
            case "owcversion":
              break;
            case "height":
              break;
            case "width":
              break;
            default:
              ue = !1;
          }
          break;
        /* WorksheetOptions */
        case "worksheetoptions":
          switch (s[3]) {
            case "visible":
              if (s[0].slice(-2) !== "/>") if (s[1] === "/") switch (a.slice(V, s.index)) {
                case "SheetHidden":
                  Se.Hidden = 1;
                  break;
                case "SheetVeryHidden":
                  Se.Hidden = 2;
                  break;
              }
              else V = s.index + s[0].length;
              break;
            case "header":
              x["!margins"] || Xa(x["!margins"] = {}, "xlml"), isNaN(+Ee(s[0]).Margin) || (x["!margins"].header = +Ee(s[0]).Margin);
              break;
            case "footer":
              x["!margins"] || Xa(x["!margins"] = {}, "xlml"), isNaN(+Ee(s[0]).Margin) || (x["!margins"].footer = +Ee(s[0]).Margin);
              break;
            case "pagemargins":
              var se = Ee(s[0]);
              x["!margins"] || Xa(x["!margins"] = {}, "xlml"), isNaN(+se.Top) || (x["!margins"].top = +se.Top), isNaN(+se.Left) || (x["!margins"].left = +se.Left), isNaN(+se.Right) || (x["!margins"].right = +se.Right), isNaN(+se.Bottom) || (x["!margins"].bottom = +se.Bottom);
              break;
            case "displayrighttoleft":
              ie.Views || (ie.Views = []), ie.Views[0] || (ie.Views[0] = {}), ie.Views[0].RTL = !0;
              break;
            case "freezepanes":
              break;
            case "frozennosplit":
              break;
            case "splithorizontal":
            case "splitvertical":
              break;
            case "donotdisplaygridlines":
              break;
            case "activerow":
              break;
            case "activecol":
              break;
            case "toprowbottompane":
              break;
            case "leftcolumnrightpane":
              break;
            case "unsynced":
              break;
            case "print":
              break;
            case "printerrors":
              break;
            case "panes":
              break;
            case "scale":
              break;
            case "pane":
              break;
            case "number":
              break;
            case "layout":
              break;
            case "pagesetup":
              break;
            case "selected":
              break;
            case "protectobjects":
              break;
            case "enableselection":
              break;
            case "protectscenarios":
              break;
            case "validprinterinfo":
              break;
            case "horizontalresolution":
              break;
            case "verticalresolution":
              break;
            case "numberofcopies":
              break;
            case "activepane":
              break;
            case "toprowvisible":
              break;
            case "leftcolumnvisible":
              break;
            case "fittopage":
              break;
            case "rangeselection":
              break;
            case "papersizeindex":
              break;
            case "pagelayoutzoom":
              break;
            case "pagebreakzoom":
              break;
            case "filteron":
              break;
            case "fitwidth":
              break;
            case "fitheight":
              break;
            case "commentslayout":
              break;
            case "zoom":
              break;
            case "lefttoright":
              break;
            case "gridlines":
              break;
            case "allowsort":
              break;
            case "allowfilter":
              break;
            case "allowinsertrows":
              break;
            case "allowdeleterows":
              break;
            case "allowinsertcols":
              break;
            case "allowdeletecols":
              break;
            case "allowinserthyperlinks":
              break;
            case "allowformatcells":
              break;
            case "allowsizecols":
              break;
            case "allowsizerows":
              break;
            case "nosummaryrowsbelowdetail":
              x["!outline"] || (x["!outline"] = {}), x["!outline"].above = !0;
              break;
            case "tabcolorindex":
              break;
            case "donotdisplayheadings":
              break;
            case "showpagelayoutzoom":
              break;
            case "nosummarycolumnsrightdetail":
              x["!outline"] || (x["!outline"] = {}), x["!outline"].left = !0;
              break;
            case "blackandwhite":
              break;
            case "donotdisplayzeros":
              break;
            case "displaypagebreak":
              break;
            case "rowcolheadings":
              break;
            case "donotdisplayoutline":
              break;
            case "noorientation":
              break;
            case "allowusepivottables":
              break;
            case "zeroheight":
              break;
            case "viewablerange":
              break;
            case "selection":
              break;
            case "protectcontents":
              break;
            default:
              ue = !1;
          }
          break;
        /* PivotTable */
        case "pivottable":
        case "pivotcache":
          switch (s[3]) {
            case "immediateitemsondrop":
              break;
            case "showpagemultipleitemlabel":
              break;
            case "compactrowindent":
              break;
            case "location":
              break;
            case "pivotfield":
              break;
            case "orientation":
              break;
            case "layoutform":
              break;
            case "layoutsubtotallocation":
              break;
            case "layoutcompactrow":
              break;
            case "position":
              break;
            case "pivotitem":
              break;
            case "datatype":
              break;
            case "datafield":
              break;
            case "sourcename":
              break;
            case "parentfield":
              break;
            case "ptlineitems":
              break;
            case "ptlineitem":
              break;
            case "countofsameitems":
              break;
            case "item":
              break;
            case "itemtype":
              break;
            case "ptsource":
              break;
            case "cacheindex":
              break;
            case "consolidationreference":
              break;
            case "filename":
              break;
            case "reference":
              break;
            case "nocolumngrand":
              break;
            case "norowgrand":
              break;
            case "blanklineafteritems":
              break;
            case "hidden":
              break;
            case "subtotal":
              break;
            case "basefield":
              break;
            case "mapchilditems":
              break;
            case "function":
              break;
            case "refreshonfileopen":
              break;
            case "printsettitles":
              break;
            case "mergelabels":
              break;
            case "defaultversion":
              break;
            case "refreshname":
              break;
            case "refreshdate":
              break;
            case "refreshdatecopy":
              break;
            case "versionlastrefresh":
              break;
            case "versionlastupdate":
              break;
            case "versionupdateablemin":
              break;
            case "versionrefreshablemin":
              break;
            case "calculation":
              break;
            default:
              ue = !1;
          }
          break;
        /* PageBreaks */
        case "pagebreaks":
          switch (s[3]) {
            case "colbreaks":
              break;
            case "colbreak":
              break;
            case "rowbreaks":
              break;
            case "rowbreak":
              break;
            case "colstart":
              break;
            case "colend":
              break;
            case "rowend":
              break;
            default:
              ue = !1;
          }
          break;
        /* AutoFilter */
        case "autofilter":
          switch (s[3]) {
            case "autofiltercolumn":
              break;
            case "autofiltercondition":
              break;
            case "autofilterand":
              break;
            case "autofilteror":
              break;
            default:
              ue = !1;
          }
          break;
        /* QueryTable */
        case "querytable":
          switch (s[3]) {
            case "id":
              break;
            case "autoformatfont":
              break;
            case "autoformatpattern":
              break;
            case "querysource":
              break;
            case "querytype":
              break;
            case "enableredirections":
              break;
            case "refreshedinxl9":
              break;
            case "urlstring":
              break;
            case "htmltables":
              break;
            case "connection":
              break;
            case "commandtext":
              break;
            case "refreshinfo":
              break;
            case "notitles":
              break;
            case "nextid":
              break;
            case "columninfo":
              break;
            case "overwritecells":
              break;
            case "donotpromptforfile":
              break;
            case "textwizardsettings":
              break;
            case "source":
              break;
            case "number":
              break;
            case "decimal":
              break;
            case "thousandseparator":
              break;
            case "trailingminusnumbers":
              break;
            case "formatsettings":
              break;
            case "fieldtype":
              break;
            case "delimiters":
              break;
            case "tab":
              break;
            case "comma":
              break;
            case "autoformatname":
              break;
            case "versionlastedit":
              break;
            case "versionlastrefresh":
              break;
            default:
              ue = !1;
          }
          break;
        case "datavalidation":
          switch (s[3]) {
            case "range":
              break;
            case "type":
              break;
            case "min":
              break;
            case "max":
              break;
            case "sort":
              break;
            case "descending":
              break;
            case "order":
              break;
            case "casesensitive":
              break;
            case "value":
              break;
            case "errorstyle":
              break;
            case "errormessage":
              break;
            case "errortitle":
              break;
            case "inputmessage":
              break;
            case "inputtitle":
              break;
            case "combohide":
              break;
            case "inputhide":
              break;
            case "condition":
              break;
            case "qualifier":
              break;
            case "useblank":
              break;
            case "value1":
              break;
            case "value2":
              break;
            case "format":
              break;
            case "cellrangelist":
              break;
            default:
              ue = !1;
          }
          break;
        case "sorting":
        case "conditionalformatting":
          switch (s[3]) {
            case "range":
              break;
            case "type":
              break;
            case "min":
              break;
            case "max":
              break;
            case "sort":
              break;
            case "descending":
              break;
            case "order":
              break;
            case "casesensitive":
              break;
            case "value":
              break;
            case "errorstyle":
              break;
            case "errormessage":
              break;
            case "errortitle":
              break;
            case "cellrangelist":
              break;
            case "inputmessage":
              break;
            case "inputtitle":
              break;
            case "combohide":
              break;
            case "inputhide":
              break;
            case "condition":
              break;
            case "qualifier":
              break;
            case "useblank":
              break;
            case "value1":
              break;
            case "value2":
              break;
            case "format":
              break;
            default:
              ue = !1;
          }
          break;
        /* MapInfo (schema) */
        case "mapinfo":
        case "schema":
        case "data":
          switch (s[3]) {
            case "map":
              break;
            case "entry":
              break;
            case "range":
              break;
            case "xpath":
              break;
            case "field":
              break;
            case "xsdtype":
              break;
            case "filteron":
              break;
            case "aggregate":
              break;
            case "elementtype":
              break;
            case "attributetype":
              break;
            /* These are from xsd (XML Schema Definition) */
            case "schema":
            case "element":
            case "complextype":
            case "datatype":
            case "all":
            case "attribute":
            case "extends":
              break;
            case "row":
              break;
            default:
              ue = !1;
          }
          break;
        /* SmartTags (can be anything) */
        case "smarttags":
          break;
        default:
          ue = !1;
          break;
      }
      if (ue || s[3].match(/!\[CDATA/)) break;
      if (!u[u.length - 1][1]) throw "Unrecognized tag: " + s[3] + "|" + u.join("|");
      if (u[u.length - 1][0] === /*'CustomDocumentProperties'*/
      "customdocumentproperties") {
        if (s[0].slice(-2) === "/>") break;
        s[1] === "/" ? ap(R, _e, ae, a.slice(V, s.index)) : (ae = s, V = s.index + s[0].length);
        break;
      }
      if (r.WTF) throw "Unrecognized tag: " + s[3] + "|" + u.join("|");
  }
  var Ce = {};
  return !r.bookSheets && !r.bookProps && (Ce.Sheets = o), Ce.SheetNames = l, Ce.Workbook = ie, Ce.SSF = Ze(Le), Ce.Props = N, Ce.Custprops = R, Ce.bookType = "xlml", Ce;
}
function m0(e, t) {
  switch (j0(t = t || {}), t.type || "base64") {
    case "base64":
      return i0(qr(e), t);
    case "binary":
    case "buffer":
    case "file":
      return i0(e, t);
    case "array":
      return i0(It(e), t);
  }
}
function fp(e) {
  var t = {}, r = e.content;
  if (r.l = 28, t.AnsiUserType = r.read_shift(0, "lpstr-ansi"), t.AnsiClipboardFormat = eo(r), r.length - r.l <= 4) return t;
  var a = r.read_shift(4);
  if (a == 0 || a > 40 || (r.l -= 4, t.Reserved1 = r.read_shift(0, "lpstr-ansi"), r.length - r.l <= 4) || (a = r.read_shift(4), a !== 1907505652) || (t.UnicodeClipboardFormat = ro(r), a = r.read_shift(4), a == 0 || a > 40)) return t;
  r.l -= 4, t.Reserved2 = r.read_shift(0, "lpwstr");
}
var op = [60, 1084, 2066, 2165, 2175];
function lp(e, t, r, a, n) {
  var i = a, c = [], s = r.slice(r.l, r.l + i);
  if (n && n.enc && n.enc.insitu && s.length > 0) switch (e) {
    case 9:
    case 521:
    case 1033:
    case 2057:
    case 47:
    case 405:
    case 225:
    case 406:
    case 312:
    case 404:
    case 10:
      break;
    case 133:
      break;
    default:
      n.enc.insitu(s);
  }
  c.push(s), r.l += i;
  for (var u = kt(r, r.l), f = _0[u], o = 0; f != null && op.indexOf(u) > -1; )
    i = kt(r, r.l + 2), o = r.l + 4, u == 2066 ? o += 4 : (u == 2165 || u == 2175) && (o += 12), s = r.slice(o, r.l + 4 + i), c.push(s), r.l += 4 + i, f = _0[u = kt(r, r.l)];
  var l = Ut(c);
  xr(l, 0);
  var x = 0;
  l.lens = [];
  for (var h = 0; h < c.length; ++h)
    l.lens.push(x), x += c[h].length;
  if (l.length < a) throw "XLS Record 0x" + e.toString(16) + " Truncated: " + l.length + " < " + a;
  return t.f(l, l.length, n);
}
function pt(e, t, r) {
  if (e.t !== "z" && e.XF) {
    var a = 0;
    try {
      a = e.z || e.XF.numFmtId || 0, t.cellNF && e.z == null && (e.z = Le[a]);
    } catch (i) {
      if (t.WTF) throw i;
    }
    if (!t || t.cellText !== !1) try {
      e.t === "e" ? e.w = e.w || Ur[e.v] : a === 0 || a == "General" ? e.t === "n" ? (e.v | 0) === e.v ? e.w = e.v.toString(10) : e.w = ja(e.v) : e.w = na(e.v) : e.w = $r(a, e.v, { date1904: !!r, dateNF: t && t.dateNF });
    } catch (i) {
      if (t.WTF) throw i;
    }
    if (t.cellDates && a && e.t == "n" && lt(Le[a] || String(a))) {
      var n = wt(e.v + (r ? 1462 : 0));
      n && (e.t = "d", e.v = new Date(Date.UTC(n.y, n.m - 1, n.d, n.H, n.M, n.S, n.u)));
    }
  }
}
function wn(e, t, r) {
  return { v: e, ixfe: t, t: r };
}
var hp = [
  "none",
  "thin",
  "medium",
  "dashed",
  "dotted",
  "thick",
  "double",
  "hair",
  "mediumDashed",
  "dashDot",
  "mediumDashDot",
  "dashDotDot",
  "mediumDashDotDot",
  "slantDashDot"
], Ki = [null, "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"], Yi = ["top", "center", "bottom", "justify", "distributed"];
function dp(e, t) {
  var r = e.l + t, a = {};
  return t >= 16 && (a.x = e.read_shift(4, "i"), a.y = e.read_shift(4, "i"), a.w = e.read_shift(4, "i"), a.h = e.read_shift(4, "i")), e.l = r, a;
}
function xp(e, t) {
  var r = e.l + t, a = {};
  return t >= 12 && (a.catType = e.read_shift(2), a.valType = e.read_shift(2), a.cCat = e.read_shift(2), a.cVal = e.read_shift(2), a.bubbleType = e.read_shift(2), a.cBubble = e.read_shift(2)), e.l = r, a;
}
function pp(e, t, r) {
  var a = e.l + t, n = {};
  t >= 2 && (n.id = e.read_shift(2));
  try {
    e.l < a && (n.text = ca(e, a - e.l, r));
  } catch {
    e.l = a;
  }
  return e.l = a, n;
}
function vp(e, t) {
  var r = e.l + t, a = {};
  return t >= 20 && (a.x = e.read_shift(4, "i"), a.y = e.read_shift(4, "i"), a.w = e.read_shift(4, "i"), a.h = e.read_shift(4, "i"), a.dock = e.read_shift(1), a.spacing = e.read_shift(1), a.flags = e.read_shift(2)), e.l = r, a;
}
function gp(e, t) {
  var r = e.l + t, a = {};
  return t >= 2 && (a.axisType = e.read_shift(2)), e.l = r, a;
}
function mp(e, t) {
  var r = e.l + t, a = {};
  return t >= 32 && (a.hAlign = e.read_shift(1), a.vAlign = e.read_shift(1), a.bgMode = e.read_shift(2), a.color = e.read_shift(4), a.x = e.read_shift(4, "i"), a.y = e.read_shift(4, "i"), a.w = e.read_shift(4, "i"), a.h = e.read_shift(4, "i")), e.l = r, a;
}
function _p(e, t) {
  var r = e.l + t, a = {};
  if (t >= 6) {
    a.id = e.read_shift(1), a.rt = e.read_shift(1), a.flags = e.read_shift(2);
    var n = e.read_shift(2);
    a.cce = n, a.formulaRaw = e.slice(e.l, Math.min(r, e.l + n));
  }
  return e.l = r, a;
}
function pa(e) {
  return function(r, a) {
    var n = r.l + a, i = { type: e };
    return a >= 2 && (i.flags = r.read_shift(2)), r.l = n, i;
  };
}
var Ep = pa("barChart"), wp = pa("lineChart"), Ap = pa("pieChart"), Tp = pa("areaChart"), Fp = pa("scatterChart"), kp = pa("radarChart"), Dp = pa("surfaceChart");
function Cp(e, t) {
  var r = { opts: {} }, a = {}, n = {};
  t.dense && (n["!data"] = []);
  var i = {}, c = {}, s = null, u = [], f = "", o = {}, l, x = "", h, g, _, d, p = {}, w = [], m, y, M = [], W = [], I = {}, L = [], A = { Sheets: [], WBProps: { date1904: !1 }, Views: [{}] }, N = {}, R = !1, V = function(U) {
    return U < 8 ? mt[U] : U < 64 && L[U - 8] || mt[U];
  }, ae = function(U) {
    if (U == null) return null;
    var ne = V(U), v = { indexed: U, index: U };
    return ne && (v.rgb = fa(ne)), Zt(v, Se);
  }, K = function(U) {
    if (!U) return null;
    var ne = {};
    switch (U.xclrType) {
      case 0:
        ne.auto = 1;
        break;
      case 1:
        ne = ae(U.xclrValue) || {};
        break;
      case 2:
        ne.rgb = fa(U.xclrValue);
        break;
      case 3:
        ne.theme = U.xclrValue;
        break;
    }
    return U.nTintShade && (ne.tint = U.nTintShade > 0 ? U.nTintShade / 32767 : U.nTintShade / 32768), Zt(ne, Se);
  }, J = function(U, ne) {
    if (!U) return null;
    var v = {};
    return U.name && (v.name = U.name), U.sz && (v.sz = U.sz), U.bold && (v.bold = !0), U.italic && (v.italic = !0), U.underline && (v.underline = U.underline), U.strike && (v.strike = !0), U.outline && (v.outline = !0), U.shadow && (v.shadow = !0), U.family != null && (v.family = U.family), U.charset != null && (v.charset = U.charset), U.vertAlign == 1 ? v.vertAlign = "superscript" : U.vertAlign == 2 && (v.vertAlign = "subscript"), ne && ne.fontScheme != null && (v.scheme = ne.fontScheme == 1 ? "major" : ne.fontScheme == 2 ? "minor" : "none"), v.color = K(ne && ne.xfextFont) || ae(U.icv), v.color && v.color.auto && delete v.color, v;
  }, fe = function(U) {
    if (!U) return null;
    var ne = { patternType: U.patternType || "none" }, v = K(U.xfextFore) || ae(U.icvFore), D = K(U.xfextBack) || ae(U.icvBack);
    return v && (ne.fgColor = v), D && (ne.bgColor = D), U.gradientFill && (ne.gradientFill = U.gradientFill), ne;
  }, Y = function(U, ne, v) {
    if (!U) return null;
    var D = { style: hp[U] || "thin" }, T = K(v) || ae(ne);
    return T && (D.color = T), D;
  }, oe = function(U) {
    if (!U) return null;
    var ne = {}, v;
    return (v = Y(U.dgLeft, U.icvLeft, U.xfextLeft)) && (ne.left = v), (v = Y(U.dgRight, U.icvRight, U.xfextRight)) && (ne.right = v), (v = Y(U.dgTop, U.icvTop, U.xfextTop)) && (ne.top = v), (v = Y(U.dgBottom, U.icvBottom, U.xfextBottom)) && (ne.bottom = v), (v = Y(U.dgDiag, U.icvDiag, U.xfextDiag)) && (ne.diagonal = v), U.grbitDiag & 1 && (ne.diagonalUp = !0), U.grbitDiag & 2 && (ne.diagonalDown = !0), br(ne).length ? ne : null;
  }, ce = function(U) {
    if (!U) return null;
    var ne = {};
    return Ki[U.alc] && (ne.horizontal = Ki[U.alc]), Yi[U.alcV] && U.alcV != 2 && (ne.vertical = Yi[U.alcV]), U.fWrap && (ne.wrapText = !0), U.fShrinkToFit && (ne.shrinkToFit = !0), U.trot && (ne.textRotation = U.trot), U.cIndent && (ne.indent = U.cIndent), U.iReadOrder && (ne.readingOrder = U.iReadOrder), br(ne).length ? ne : null;
  }, re = function(U, ne) {
    if (!ne) return U;
    var v = ne.data || {};
    ne.numFmtId != null && (U.numFmtId = ne.numFmtId, Le[ne.numFmtId] != null && (U.numFmt = Le[ne.numFmtId]));
    var D = J(W[ne.ifnt], ne);
    D && (U.font = D);
    var T = fe(v);
    T && (U.fill = T, $c(U, T));
    var F = oe(v);
    F && (U.border = F);
    var C = ce(v);
    return C && (U.alignment = C), (ne.locked || ne.hidden) && (U.protection = { locked: ne.locked, hidden: ne.hidden }), U;
  }, De = function(U, ne) {
    if (!U) return null;
    if (ne == null && (ne = M.indexOf(U)), I[ne]) return I[ne];
    var v = { id: ne, xf: Ze(U) };
    return !U.fStyle && U.xfId != null && U.xfId !== ne && M[U.xfId] && St(v, De(M[U.xfId], U.xfId)), v.id = ne, v.xf = Ze(U), re(v, U), I[ne] = v;
  }, be = function(U, ne) {
    if (!(!U.XF || !ne || !ne.cellStyles)) {
      var v = De(U.XF, U.ixfe);
      v && (U.s = v);
    }
  }, de = function(U, ne, v) {
    if (!(!R && Ce > 1) && !(v.sheetRows && U.r >= v.sheetRows)) {
      if (v.cellStyles && ne.XF && ne.XF.data && be(ne, v), delete ne.ixfe, delete ne.XF, l = U, x = Ge(U), (!c || !c.s || !c.e) && (c = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }), U.r < c.s.r && (c.s.r = U.r), U.c < c.s.c && (c.s.c = U.c), U.r + 1 > c.e.r && (c.e.r = U.r + 1), U.c + 1 > c.e.c && (c.e.c = U.c + 1), v.cellFormula && ne.f) {
        for (var D = 0; D < w.length; ++D)
          if (!(w[D][0].s.c > U.c || w[D][0].s.r > U.r) && !(w[D][0].e.c < U.c || w[D][0].e.r < U.r)) {
            ne.F = He(w[D][0]), (w[D][0].s.c != U.c || w[D][0].s.r != U.r) && delete ne.f, ne.f && (ne.f = "" + yr(w[D][1], c, U, ue, ie));
            break;
          }
      }
      v.dense ? (n["!data"][U.r] || (n["!data"][U.r] = []), n["!data"][U.r][U.c] = ne) : n[x] = ne;
    }
  }, ie = {
    enc: !1,
    // encrypted
    sbcch: 0,
    // cch in the preceding SupBook
    snames: [],
    // sheetnames
    sharedf: p,
    // shared formulae by address
    arrayf: w,
    // array formulae array
    rrtabid: [],
    // RRTabId
    lastuser: "",
    // Last User from WriteAccess
    biff: 8,
    // BIFF version
    codepage: 0,
    // CP from CodePage record
    winlocked: 0,
    // fLockWn from WinProtect
    cellStyles: !!t && !!t.cellStyles,
    drawings: !!t && !!t.drawings,
    charts: !!t && !!t.charts,
    WTF: !!t && !!t.WTF
  };
  t.password && (ie.password = t.password);
  var Se, _e = [], Ne = [], S = [], G = [], H = !1, P = { blips: [] }, ee = null, Fe = [], te = null, ue = [];
  ue.SheetNames = ie.snames, ue.sharedf = ie.sharedf, ue.arrayf = ie.arrayf, ue.names = [], ue.XTI = [];
  var se = 0, Ce = 0, Ae = 0, Te = [], ze = [], Ie, Pe = function() {
    return ee || (ee = { raw: [], images: [], shapes: [], charts: [] }), ee;
  }, we = function(U) {
    if (U && !(!t.drawings && !t.charts))
      if (U.groups && U.blips) P.blips = P.blips.concat(U.blips);
      else {
        var ne = Pe();
        U.raw && ne.raw.push(U.raw), U.blips && U.blips.length && (P.blips = P.blips.concat(U.blips)), (U.shapes || []).forEach(function(v) {
          Fe.push(v);
          var D = v.blipId != null ? P.blips[v.blipId - 1] : null;
          D && D.dataURI ? ne.images.push({ id: "xls-image-" + (ne.images.length + 1), objectId: v.spid, biffType: "msoDrawing", anchor: v.anchor, dataURI: D.dataURI, contentType: D.contentType, raw: v.raw }) : ne.shapes.push({ id: "xls-shape-" + (ne.shapes.length + 1), objectId: v.spid, biffType: "msoDrawing", anchor: v.anchor, props: v.props, raw: v.raw });
        });
      }
  }, qe = function(U) {
    if (!(!U || !U.ImData || !U.ImData.data) && !(!t.drawings && !t.charts)) {
      var ne = Pe(), v = U.ImData.data, D = Pc(v, 0, v.length), T = U._shape || {}, F = { id: "xls-imdata-" + (ne.images.length + 1), objectId: U.cmo && U.cmo[0], biffType: "imData", anchor: T.anchor, raw: U.ImData };
      D[1] ? (F.contentType = D[1], F.dataURI = "data:" + D[1] + ";base64," + C0(v.slice(D[0])), ne.images.push(F)) : ne.shapes.push({ id: "xls-imdata-" + (ne.shapes.length + 1), objectId: F.objectId, biffType: "imData", anchor: T.anchor, raw: U.ImData });
    }
  }, pe = function() {
    te = { type: null, title: "", series: [], seriesText: [], raw: [], current: null };
  }, Or = function(U, ne) {
    switch (te || pe(), te.raw.push({ rt: U, v: ne }), U) {
      case 4099:
        te.current = { raw: ne, name: "", data: [] }, te.series.push(te.current);
        break;
      case 4109:
        ne && ne.text && (te.current && !te.current.name ? te.current.name = ne.text : te.title ? te.seriesText.push(ne.text) : te.title = ne.text);
        break;
      case 4119:
      case 4120:
      case 4121:
      case 4122:
      case 4123:
      case 4158:
      case 4159:
        ne && ne.type && (te.type = ne.type);
        break;
      case 4177:
        te.current && (te.current.brai || (te.current.brai = []), te.current.brai.push(ne));
        break;
    }
  }, _r = function(U) {
    if (!te || !te.raw.length) return null;
    var ne = { type: te.type || "barChart", title: te.title, series: [], raw: te.raw };
    if (U && U["!ref"]) {
      var v = cr(U["!ref"]), D = U["!data"] != null, T, F, C, b = !1;
      for (F = v.s.r; F <= v.e.r; ++F)
        C = D ? (U["!data"][F] || [])[v.s.c] : U[Ge({ r: F, c: v.s.c })], C && C.t == "n" && (b = !0);
      var q = [];
      if (!b && v.e.c > v.s.c) for (F = v.s.r; F <= v.e.r; ++F)
        C = D ? (U["!data"][F] || [])[v.s.c] : U[Ge({ r: F, c: v.s.c })], q.push(C ? C.w || C.v : "");
      for (T = v.s.c + (q.length ? 1 : 0); T <= v.e.c; ++T) {
        var Z = [], X = (te.series[T - v.s.c] || te.series[T - v.s.c - 1] || {}).name || "";
        for (F = v.s.r; F <= v.e.r; ++F)
          C = D ? (U["!data"][F] || [])[T] : U[Ge({ r: F, c: T })], C && C.t == "n" ? Z.push(C.v) : C && C.v != null && !isNaN(+C.v) && Z.push(+C.v);
        Z.length && ne.series.push({ name: X, data: Z, val: { values: Z }, cat: { values: q } });
      }
    }
    return ne.series.length || te.series.forEach(function(z) {
      ne.series.push({ name: z.name || "", data: [], raw: z });
    }), ne;
  }, rr = function(U) {
    if (U["!merges"] && U["!merges"].length) {
      var ne = q0(U, { WTF: !!(t && (t.WTF || t.validateMerges)) });
      ne.length && (U["!mergeErrors"] = ne);
    }
    ee && (ee.images.length || ee.shapes.length || ee.charts.length || ee.raw.length) && (U["!drawings"] = ee);
    var v = t.charts ? _r(U) : null;
    v && (U["!chart"] = v, U["!charts"] || (U["!charts"] = []), ee && ee.charts.length ? ee.charts.forEach(function(D) {
      D.model || (D.model = v), U["!charts"].push(D);
    }) : U["!charts"].push({ id: "xls-chart-" + U["!charts"].length, title: v.title, model: v, raw: v.raw, anchor: { type: "absoluteAnchor", pos: { x: 0, y: 0 }, ext: { cx: 480 * 9525, cy: 288 * 9525 } } }));
  };
  ie.codepage = 1200, ft(1200);
  for (var jr = !1; e.l < e.length - 1; ) {
    var Kr = e.l, Oe = e.read_shift(2);
    if (Oe === 0 && se === 10) break;
    var nr = e.l === e.length ? 0 : e.read_shift(2), vr = _0[Oe];
    if (Ce == 0 && [9, 521, 1033, 2057].indexOf(Oe) == -1) break;
    if (vr && vr.f) {
      if (t.bookSheets && se === 133 && Oe !== 133)
        break;
      if (se = Oe, vr.r === 2 || vr.r == 12) {
        var Hr = e.read_shift(2);
        if (nr -= 2, !ie.enc && Hr !== Oe && ((Hr & 255) << 8 | Hr >> 8) !== Oe) throw new Error("rt mismatch: " + Hr + "!=" + Oe);
        vr.r == 12 && (e.l += 10, nr -= 10);
      }
      var O = {};
      if (Oe === 10 ? O = /*::(*/
      vr.f(e, nr, ie) : O = /*::(*/
      lp(Oe, vr, e, nr, ie), Ce == 0 && [9, 521, 1033, 2057].indexOf(se) === -1) continue;
      switch (Oe) {
        case 34:
          r.opts.Date1904 = A.WBProps.date1904 = O;
          break;
        case 134:
          r.opts.WriteProtect = !0;
          break;
        case 47:
          if (ie.enc || (e.l = 0), ie.enc = O, !t.password) throw new Error("File is password-protected");
          if (O.valid == null) throw new Error("Encryption scheme unsupported");
          if (!O.valid) throw new Error("Password is incorrect");
          break;
        case 92:
          ie.lastuser = O;
          break;
        case 66:
          var Ar = Number(O);
          switch (Ar) {
            case 21010:
              Ar = 1200;
              break;
            case 32768:
              Ar = 1e4;
              break;
            case 32769:
              Ar = 1252;
              break;
          }
          ft(ie.codepage = Ar), jr = !0;
          break;
        case 317:
          ie.rrtabid = O;
          break;
        case 25:
          ie.winlocked = O;
          break;
        case 439:
          r.opts.RefreshAll = O;
          break;
        case 12:
          r.opts.CalcCount = O;
          break;
        case 16:
          r.opts.CalcDelta = O;
          break;
        case 17:
          r.opts.CalcIter = O;
          break;
        case 13:
          r.opts.CalcMode = O;
          break;
        case 14:
          r.opts.CalcPrecision = O;
          break;
        case 95:
          r.opts.CalcSaveRecalc = O;
          break;
        case 15:
          ie.CalcRefMode = O;
          break;
        // TODO: implement R1C1
        case 2211:
          r.opts.FullCalc = O;
          break;
        case 129:
          O.fDialog && (n["!type"] = "dialog"), O.fBelow || ((n["!outline"] || (n["!outline"] = {})).above = !0), O.fRight || ((n["!outline"] || (n["!outline"] = {})).left = !0);
          break;
        // TODO
        case 67:
        /* BIFF2XF */
        case 579:
        /* BIFF3XF */
        case 1091:
        /* BIFF4XF */
        case 224:
          M.push(O);
          break;
        case 49:
          W.push(O), ie.biff >= 5 && W.length == 4 && W.push(null);
          break;
        case 430:
          ue.push([O]), ue[ue.length - 1].XTI = [];
          break;
        case 35:
        case 547:
          ue[ue.length - 1].push(O);
          break;
        case 24:
        case 536:
          Ie = {
            Name: O.Name,
            Ref: yr(O.rgce, c, null, ue, ie)
          }, O.itab > 0 && (Ie.Sheet = O.itab - 1), ue.names.push(Ie), ue[0] || (ue[0] = [], ue[0].XTI = []), ue[ue.length - 1].push(O), O.Name == "_xlnm._FilterDatabase" && O.itab > 0 && O.rgce && O.rgce[0] && O.rgce[0][0] && O.rgce[0][0][0] == "PtgArea3d" && (ze[O.itab - 1] = { ref: He(O.rgce[0][0][1][2]) });
          break;
        case 22:
          ie.ExternCount = O;
          break;
        case 23:
          ue.length == 0 && (ue[0] = [], ue[0].XTI = []), ue[ue.length - 1].XTI = ue[ue.length - 1].XTI.concat(O), ue.XTI = ue.XTI.concat(O);
          break;
        case 2196:
          if (ie.biff < 8) break;
          Ie != null && (Ie.Comment = O[1]);
          break;
        case 18:
          n["!protect"] = O;
          break;
        /* for sheet or book */
        case 19:
          O !== 0 && ie.WTF && console.error("Password verifier: " + O);
          break;
        case 133:
          i[ie.biff == 4 ? ie.snames.length : O.pos] = O, ie.snames.push(O.name);
          break;
        case 10:
          {
            if (--Ce ? !R : R) break;
            if (c.e) {
              if (c.e.r > 0 && c.e.c > 0) {
                if (c.e.r--, c.e.c--, n["!ref"] = He(c), t.sheetRows && t.sheetRows <= c.e.r) {
                  var _t = c.e.r;
                  c.e.r = t.sheetRows - 1, n["!fullref"] = n["!ref"], n["!ref"] = He(c), c.e.r = _t;
                }
                c.e.r++, c.e.c++;
              }
              _e.length > 0 && (n["!merges"] = _e), Ne.length > 0 && (n["!objects"] = Ne), S.length > 0 && (n["!cols"] = S), G.length > 0 && (n["!rows"] = G), rr(n), A.Sheets.push(N);
            }
            f === "" ? o = n : a[f] = n, n = {}, t.dense && (n["!data"] = []);
          }
          break;
        case 9:
        case 521:
        case 1033:
        case 2057:
          {
            if (ie.biff === 8 && (ie.biff = {
              9: 2,
              521: 3,
              1033: 4
            }[Oe] || {
              512: 2,
              768: 3,
              1024: 4,
              1280: 5,
              1536: 8,
              2: 2,
              7: 2
            }[O.BIFFVer] || 8), ie.biffguess = O.BIFFVer == 0, O.BIFFVer == 0 && O.dt == 4096 && (ie.biff = 5, jr = !0, ft(ie.codepage = 28591)), ie.biff == 4 && O.dt & 256 && (R = !0), ie.biff == 8 && O.BIFFVer == 0 && O.dt == 16 && (ie.biff = 2), Ce++ && !R) break;
            if (n = {}, t.dense && (n["!data"] = []), ie.biff < 8 && !jr && (jr = !0, ft(ie.codepage = t.codepage || 1252)), ie.biff == 4 && R)
              f = (i[ie.snames.indexOf(f) + 1] || { name: "" }).name;
            else if (ie.biff < 5 || O.BIFFVer == 0 && O.dt == 4096) {
              f === "" && (f = "Sheet1"), c = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
              var Lt = { pos: e.l - nr, name: f };
              i[Lt.pos] = Lt, ie.snames.push(f);
            } else f = (i[Kr] || { name: "" }).name;
            O.dt == 32 && (n["!type"] = "chart"), O.dt == 64 && (n["!type"] = "macro"), _e = [], Ne = [], ee = null, Fe = [], pe(), ie.arrayf = w = [], S = [], G = [], H = !1, N = { Hidden: (i[Kr] || { hs: 0 }).hs, name: f };
          }
          break;
        case 515:
        case 3:
        case 2:
          n["!type"] == "chart" && (t.dense ? (n["!data"][O.r] || [])[O.c] : n[Je(O.c) + er(O.r)]) && ++O.c, m = { ixfe: O.ixfe, XF: M[O.ixfe] || {}, v: O.val, t: "n" }, Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: O.c, r: O.r }, m, t);
          break;
        case 5:
        case 517:
          m = { ixfe: O.ixfe, XF: M[O.ixfe], v: O.val, t: O.t }, Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: O.c, r: O.r }, m, t);
          break;
        case 638:
          m = { ixfe: O.ixfe, XF: M[O.ixfe], v: O.rknum, t: "n" }, Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: O.c, r: O.r }, m, t);
          break;
        case 189:
          for (var st = O.c; st <= O.C; ++st) {
            var dt = O.rkrec[st - O.c][0];
            m = { ixfe: dt, XF: M[dt], v: O.rkrec[st - O.c][1], t: "n" }, Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: st, r: O.r }, m, t);
          }
          break;
        case 6:
        case 518:
        case 1030:
          {
            if (O.val == "String") {
              s = O;
              break;
            }
            if (m = wn(O.val, O.cell.ixfe, O.tt), m.XF = M[m.ixfe], t.cellFormula) {
              var Yr = O.formula;
              if (Yr && Yr[0] && Yr[0][0] && Yr[0][0][0] == "PtgExp") {
                var va = Yr[0][0][1][0], xt = Yr[0][0][1][1], $t = Ge({ r: va, c: xt });
                p[$t] ? m.f = "" + yr(O.formula, c, O.cell, ue, ie) : m.F = ((t.dense ? (n["!data"][va] || [])[xt] : n[$t]) || {}).F;
              } else m.f = "" + yr(O.formula, c, O.cell, ue, ie);
            }
            Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de(O.cell, m, t), s = O;
          }
          break;
        case 7:
        case 519:
          if (s)
            s.val = O, m = wn(O, s.cell.ixfe, "s"), m.XF = M[m.ixfe], t.cellFormula && (m.f = "" + yr(s.formula, c, s.cell, ue, ie)), Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de(s.cell, m, t), s = null;
          else throw new Error("String record expects Formula");
          break;
        case 33:
        case 545:
          {
            w.push(O);
            var E = Ge(O[0].s);
            if (h = t.dense ? (n["!data"][O[0].s.r] || [])[O[0].s.c] : n[E], t.cellFormula && h) {
              if (!s || !E || !h) break;
              h.f = "" + yr(O[1], c, O[0], ue, ie), h.F = He(O[0]);
            }
          }
          break;
        case 1212:
          {
            if (!t.cellFormula) break;
            if (x) {
              if (!s) break;
              p[Ge(s.cell)] = O[0], h = t.dense ? (n["!data"][s.cell.r] || [])[s.cell.c] : n[Ge(s.cell)], (h || {}).f = "" + yr(O[0], c, l, ue, ie);
            }
          }
          break;
        case 253:
          m = wn(u[O.isst].t, O.ixfe, "s"), u[O.isst].h && (m.h = u[O.isst].h), m.XF = M[m.ixfe], Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: O.c, r: O.r }, m, t);
          break;
        case 513:
          t.sheetStubs && (m = { ixfe: O.ixfe, XF: M[O.ixfe], t: "z" }, Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: O.c, r: O.r }, m, t));
          break;
        case 190:
          if (t.sheetStubs)
            for (var k = O.c; k <= O.C; ++k) {
              var B = O.ixfe[k - O.c];
              m = { ixfe: B, XF: M[B], t: "z" }, Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: k, r: O.r }, m, t);
            }
          break;
        case 214:
        case 516:
        case 4:
          m = wn(O.val, O.ixfe, "s"), m.XF = M[m.ixfe], Ae > 0 && (m.z = m.XF && m.XF.numFmtId && Te[m.XF.numFmtId] || Te[m.ixfe >> 8 & 63]), pt(m, t, r.opts.Date1904), de({ c: O.c, r: O.r }, m, t);
          break;
        case 0:
        case 512:
          Ce === 1 && (c = O);
          break;
        case 252:
          u = O;
          break;
        case 1054:
          if (ie.biff >= 3 && ie.biff <= 4) {
            Te[Ae++] = O[1];
            for (var Q = 0; Q < Ae + 163 && Le[Q] != O[1]; ++Q) ;
            Q >= 163 && Qt(O[1], Ae + 163);
          } else Qt(O[1], O[0]);
          break;
        case 30:
          {
            Te[Ae++] = O;
            for (var ge = 0; ge < Ae + 163 && Le[ge] != O; ++ge) ;
            ge >= 163 && Qt(O, Ae + 163);
          }
          break;
        case 229:
          _e = _e.concat(O);
          break;
        case 235:
          we(O);
          break;
        case 236:
          we(O);
          break;
        case 93:
          if (Ne[O.cmo[0]] = ie.lastobj = O, Fe.length && (O._shape = Fe.shift(), O._shape.object = O, O.cmo[1] == 5)) {
            var ye = Pe();
            ye.charts.push({ id: "xls-chart-object-" + O.cmo[0], objectId: O.cmo[0], biffType: "obj", anchor: O._shape.anchor, raw: O._shape.raw });
          }
          break;
        case 438:
          ie.lastobj.TxO = O;
          break;
        case 127:
          ie.lastobj.ImData = O, qe(ie.lastobj);
          break;
        case 440:
          for (d = O[0].s.r; d <= O[0].e.r; ++d)
            for (_ = O[0].s.c; _ <= O[0].e.c; ++_)
              h = t.dense ? (n["!data"][d] || [])[_] : n[Ge({ c: _, r: d })], h && (h.l = O[1]);
          break;
        case 2048:
          for (d = O[0].s.r; d <= O[0].e.r; ++d)
            for (_ = O[0].s.c; _ <= O[0].e.c; ++_)
              h = t.dense ? (n["!data"][d] || [])[_] : n[Ge({ c: _, r: d })], h && h.l && (h.l.Tooltip = O[1]);
          break;
        case 28:
          {
            if (h = t.dense ? (n["!data"][O[0].r] || [])[O[0].c] : n[Ge(O[0])], h || (t.dense ? (n["!data"][O[0].r] || (n["!data"][O[0].r] = []), h = n["!data"][O[0].r][O[0].c] = { t: "z" }) : h = n[Ge(O[0])] = { t: "z" }, c.e.r = Math.max(c.e.r, O[0].r), c.s.r = Math.min(c.s.r, O[0].r), c.e.c = Math.max(c.e.c, O[0].c), c.s.c = Math.min(c.s.c, O[0].c)), h.c || (h.c = []), ie.biff <= 5 && ie.biff >= 2) g = { a: "SheetJ5", t: O[1] };
            else {
              var xe = Ne[O[2]];
              g = { a: O[1], t: xe.TxO.t }, O[3] != null && !(O[3] & 2) && (h.c.hidden = !0);
            }
            h.c.push(g);
          }
          break;
        case 2173:
          D1(M[O.ixfe], O.ext), I = {};
          break;
        case 125:
          {
            if (!ie.cellStyles) break;
            for (; O.e >= O.s; )
              S[O.e--] = { width: O.w / 256, level: O.level || 0, hidden: !!(O.flags & 1) }, O.ixfe != null && M[O.ixfe] && (S[O.e + 1].s = De(M[O.ixfe], O.ixfe)), H || (H = !0, G0(O.w / 256)), Da(S[O.e + 1]);
          }
          break;
        case 520:
          {
            var Ve = {};
            O.level != null && (G[O.r] = Ve, Ve.level = O.level), O.hidden && (G[O.r] = Ve, Ve.hidden = !0), ie.cellStyles && O.ixfe != null && O.ixfe != 4095 && M[O.ixfe] && (G[O.r] = Ve, Ve.s = De(M[O.ixfe], O.ixfe)), O.hpt && (G[O.r] = Ve, Ve.hpt = O.hpt, Ve.hpx = Za(O.hpt));
          }
          break;
        case 38:
        case 39:
        case 40:
        case 41:
          n["!margins"] || Xa(n["!margins"] = {}), n["!margins"][{ 38: "left", 39: "right", 40: "top", 41: "bottom" }[Oe]] = O;
          break;
        case 161:
          n["!margins"] || Xa(n["!margins"] = {}), n["!margins"].header = O.header, n["!margins"].footer = O.footer;
          break;
        case 574:
          O.RTL && (A.Views[0].RTL = !0);
          break;
        case 146:
          L = O, I = {};
          break;
        case 2198:
          Se = O, I = {};
          break;
        case 140:
          y = O;
          break;
        case 4098:
        case 4099:
        case 4109:
        case 4116:
        case 4117:
        case 4119:
        case 4120:
        case 4121:
        case 4122:
        case 4123:
        case 4125:
        case 4127:
        case 4128:
        case 4133:
        case 4149:
        case 4154:
        case 4158:
        case 4159:
        case 4161:
        case 4165:
        case 4177:
          Or(Oe, O);
          break;
        case 442:
          f ? N.CodeName = O || N.name : A.WBProps.CodeName = O || "ThisWorkbook";
          break;
      }
    } else
      vr || console.error("Missing Info for XLS Record 0x" + Oe.toString(16)), e.l += nr;
  }
  return r.SheetNames = br(i).sort(function(Me, U) {
    return Number(Me) - Number(U);
  }).map(function(Me) {
    return i[Me].name;
  }), t.bookSheets || (r.Sheets = a), !r.SheetNames.length && o["!ref"] ? (r.SheetNames.push("Sheet1"), r.Sheets && (r.Sheets.Sheet1 = o)) : r.Preamble = o, r.Sheets && ze.forEach(function(Me, U) {
    r.Sheets[r.SheetNames[U]]["!autofilter"] = Me;
  }), r.Strings = u, r.SSF = Ze(Le), ie.enc && (r.Encryption = ie.enc), Se && (r.Themes = Se), r.Metadata = {}, y !== void 0 && (r.Metadata.Country = y), ue.names.length > 0 && (A.Names = ue.names), r.Workbook = A, r;
}
var Ji = {
  SI: "e0859ff2f94f6810ab9108002b27b3d9",
  DSI: "02d5cdd59c2e1b10939708002b2cf9ae",
  UDI: "05d5cdd59c2e1b10939708002b2cf9ae"
};
function yp(e, t, r) {
  var a = je.find(e, "/!DocumentSummaryInformation");
  if (a && a.size > 0) try {
    var n = yi(a, co, Ji.DSI);
    for (var i in n) t[i] = n[i];
  } catch (f) {
    r.WTF && console.error(f && f.message || f);
  }
  var c = je.find(e, "/!SummaryInformation");
  if (c && c.size > 0) try {
    var s = yi(c, uo, Ji.SI);
    for (var u in s) t[u] == null && (t[u] = s[u]);
  } catch (f) {
    r.WTF && console.error(f && f.message || f);
  }
  t.HeadingPairs && t.TitlesOfParts && (hc(t.HeadingPairs, t.TitlesOfParts, t, r), delete t.HeadingPairs, delete t.TitlesOfParts);
}
function tu(e, t) {
  t || (t = {}), j0(t), As(), t.codepage && D0(t.codepage);
  var r, a;
  if (e.FullPaths) {
    if (je.find(e, "/encryption")) throw new Error("File is password-protected");
    r = je.find(e, "!CompObj"), a = je.find(e, "/Workbook") || je.find(e, "/Book");
  } else {
    switch (t.type) {
      case "base64":
        e = Gr(qr(e));
        break;
      case "binary":
        e = Gr(e);
        break;
      case "buffer":
        break;
      case "array":
        Array.isArray(e) || (e = Array.prototype.slice.call(e));
        break;
    }
    xr(e, 0), a = { content: e };
  }
  var n, i;
  if (r && fp(r), t.bookProps && !t.bookSheets) n = {};
  else {
    var c = Xe ? "buffer" : "array";
    if (a && a.content) n = Cp(a.content, t);
    else if ((i = je.find(e, "PerfectOffice_MAIN")) && i.content) n = Wa.to_workbook(i.content, (t.type = c, t));
    else if ((i = je.find(e, "NativeContent_MAIN")) && i.content) n = Wa.to_workbook(i.content, (t.type = c, t));
    else throw (i = je.find(e, "MN0")) && i.content ? new Error("Unsupported Works 4 for Mac file") : new Error("Cannot find Workbook stream");
    t.bookVBA && e.FullPaths && je.find(e, "/_VBA_PROJECT_CUR/VBA/dir") && (n.vbaraw = J1(e));
  }
  var s = {};
  return e.FullPaths && yp(
    /*::((*/
    e,
    s,
    t
  ), n.Props = n.Custprops = s, t.bookFiles && (n.cfb = e), n;
}
var Ln = {
  0: {
    /* n:"BrtRowHdr", */
    f: zd
  },
  1: {
    /* n:"BrtCellBlank", */
    f: Kd
  },
  2: {
    /* n:"BrtCellRk", */
    f: nx
  },
  3: {
    /* n:"BrtCellError", */
    f: Qd
  },
  4: {
    /* n:"BrtCellBool", */
    f: Jd
  },
  5: {
    /* n:"BrtCellReal", */
    f: ax
  },
  6: {
    /* n:"BrtCellSt", */
    f: cx
  },
  7: {
    /* n:"BrtCellIsst", */
    f: rx
  },
  8: {
    /* n:"BrtFmlaString", */
    f: hx
  },
  9: {
    /* n:"BrtFmlaNum", */
    f: lx
  },
  10: {
    /* n:"BrtFmlaBool", */
    f: fx
  },
  11: {
    /* n:"BrtFmlaError", */
    f: ox
  },
  12: {
    /* n:"BrtShortBlank", */
    f: Yd
  },
  13: {
    /* n:"BrtShortRk", */
    f: ix
  },
  14: {
    /* n:"BrtShortError", */
    f: ex
  },
  15: {
    /* n:"BrtShortBool", */
    f: Zd
  },
  16: {
    /* n:"BrtShortReal", */
    f: Yc
  },
  17: {
    /* n:"BrtShortSt", */
    f: ux
  },
  18: {
    /* n:"BrtShortIsst", */
    f: tx
  },
  19: {
    /* n:"BrtSSTItem", */
    f: P0
  },
  20: {
    /* n:"BrtPCDIMissing" */
  },
  21: {
    /* n:"BrtPCDINumber" */
  },
  22: {
    /* n:"BrtPCDIBoolean" */
  },
  23: {
    /* n:"BrtPCDIError" */
  },
  24: {
    /* n:"BrtPCDIString" */
  },
  25: {
    /* n:"BrtPCDIDatetime" */
  },
  26: {
    /* n:"BrtPCDIIndex" */
  },
  27: {
    /* n:"BrtPCDIAMissing" */
  },
  28: {
    /* n:"BrtPCDIANumber" */
  },
  29: {
    /* n:"BrtPCDIABoolean" */
  },
  30: {
    /* n:"BrtPCDIAError" */
  },
  31: {
    /* n:"BrtPCDIAString" */
  },
  32: {
    /* n:"BrtPCDIADatetime" */
  },
  33: {
    /* n:"BrtPCRRecord" */
  },
  34: {
    /* n:"BrtPCRRecordDt" */
  },
  35: {
    /* n:"BrtFRTBegin", */
    T: 1
  },
  36: {
    /* n:"BrtFRTEnd", */
    T: -1
  },
  37: {
    /* n:"BrtACBegin", */
    T: 1
  },
  38: {
    /* n:"BrtACEnd", */
    T: -1
  },
  39: {
    /* n:"BrtName", */
    f: Wx
  },
  40: {
    /* n:"BrtIndexRowBlock" */
  },
  42: {
    /* n:"BrtIndexBlock" */
  },
  43: {
    /* n:"BrtFont", */
    f: o1
  },
  44: {
    /* n:"BrtFmt", */
    f: f1
  },
  45: {
    /* n:"BrtFill", */
    f: l1
  },
  46: {
    /* n:"BrtBorder", */
    f: d1
  },
  47: {
    /* n:"BrtXF", */
    f: h1
  },
  48: {
    /* n:"BrtStyle" */
  },
  49: {
    /* n:"BrtCellMeta", */
    f: $f
  },
  50: {
    /* n:"BrtValueMeta" */
  },
  51: {
    /* n:"BrtMdb" */
    f: y1
  },
  52: {
    /* n:"BrtBeginFmd", */
    T: 1
  },
  53: {
    /* n:"BrtEndFmd", */
    T: -1
  },
  54: {
    /* n:"BrtBeginMdx", */
    T: 1
  },
  55: {
    /* n:"BrtEndMdx", */
    T: -1
  },
  56: {
    /* n:"BrtBeginMdxTuple", */
    T: 1
  },
  57: {
    /* n:"BrtEndMdxTuple", */
    T: -1
  },
  58: {
    /* n:"BrtMdxMbrIstr" */
  },
  59: {
    /* n:"BrtStr" */
  },
  60: {
    /* n:"BrtColInfo", */
    f: Tc
  },
  62: {
    /* n:"BrtCellRString", */
    f: sx
  },
  63: {
    /* n:"BrtCalcChainItem$", */
    f: O1
  },
  64: {
    /* n:"BrtDVal", */
    f: wx
  },
  65: {
    /* n:"BrtSxvcellNum" */
  },
  66: {
    /* n:"BrtSxvcellStr" */
  },
  67: {
    /* n:"BrtSxvcellBool" */
  },
  68: {
    /* n:"BrtSxvcellErr" */
  },
  69: {
    /* n:"BrtSxvcellDate" */
  },
  70: {
    /* n:"BrtSxvcellNil" */
  },
  128: {
    /* n:"BrtFileVersion" */
  },
  129: {
    /* n:"BrtBeginSheet", */
    T: 1
  },
  130: {
    /* n:"BrtEndSheet", */
    T: -1
  },
  131: {
    /* n:"BrtBeginBook", */
    T: 1,
    f: Br,
    p: 0
  },
  132: {
    /* n:"BrtEndBook", */
    T: -1
  },
  133: {
    /* n:"BrtBeginWsViews", */
    T: 1
  },
  134: {
    /* n:"BrtEndWsViews", */
    T: -1
  },
  135: {
    /* n:"BrtBeginBookViews", */
    T: 1
  },
  136: {
    /* n:"BrtEndBookViews", */
    T: -1
  },
  137: {
    /* n:"BrtBeginWsView", */
    T: 1,
    f: Ex
  },
  138: {
    /* n:"BrtEndWsView", */
    T: -1
  },
  139: {
    /* n:"BrtBeginCsViews", */
    T: 1
  },
  140: {
    /* n:"BrtEndCsViews", */
    T: -1
  },
  141: {
    /* n:"BrtBeginCsView", */
    T: 1
  },
  142: {
    /* n:"BrtEndCsView", */
    T: -1
  },
  143: {
    /* n:"BrtBeginBundleShs", */
    T: 1
  },
  144: {
    /* n:"BrtEndBundleShs", */
    T: -1
  },
  145: {
    /* n:"BrtBeginSheetData", */
    T: 1
  },
  146: {
    /* n:"BrtEndSheetData", */
    T: -1
  },
  147: {
    /* n:"BrtWsProp", */
    f: jd
  },
  148: {
    /* n:"BrtWsDim", */
    f: qd,
    p: 16
  },
  151: {
    /* n:"BrtPane", */
    f: px
  },
  152: {
    /* n:"BrtSel" */
  },
  153: {
    /* n:"BrtWbProp", */
    f: Hx
  },
  154: {
    /* n:"BrtWbFactoid" */
  },
  155: {
    /* n:"BrtFileRecover" */
  },
  156: {
    /* n:"BrtBundleSh", */
    f: Ux
  },
  157: {
    /* n:"BrtCalcProp" */
  },
  158: {
    /* n:"BrtBookView" */
  },
  159: {
    /* n:"BrtBeginSst", */
    T: 1,
    f: hh
  },
  160: {
    /* n:"BrtEndSst", */
    T: -1
  },
  161: {
    /* n:"BrtBeginAFilter", */
    T: 1,
    f: da
  },
  162: {
    /* n:"BrtEndAFilter", */
    T: -1
  },
  163: {
    /* n:"BrtBeginFilterColumn", */
    T: 1
  },
  164: {
    /* n:"BrtEndFilterColumn", */
    T: -1
  },
  165: {
    /* n:"BrtBeginFilters", */
    T: 1
  },
  166: {
    /* n:"BrtEndFilters", */
    T: -1
  },
  167: {
    /* n:"BrtFilter" */
  },
  168: {
    /* n:"BrtColorFilter" */
  },
  169: {
    /* n:"BrtIconFilter" */
  },
  170: {
    /* n:"BrtTop10Filter" */
  },
  171: {
    /* n:"BrtDynamicFilter" */
  },
  172: {
    /* n:"BrtBeginCustomFilters", */
    T: 1
  },
  173: {
    /* n:"BrtEndCustomFilters", */
    T: -1
  },
  174: {
    /* n:"BrtCustomFilter" */
  },
  175: {
    /* n:"BrtAFilterDateGroupItem" */
  },
  176: {
    /* n:"BrtMergeCell", */
    f: dx
  },
  177: {
    /* n:"BrtBeginMergeCells", */
    T: 1
  },
  178: {
    /* n:"BrtEndMergeCells", */
    T: -1
  },
  179: {
    /* n:"BrtBeginPivotCacheDef", */
    T: 1
  },
  180: {
    /* n:"BrtEndPivotCacheDef", */
    T: -1
  },
  181: {
    /* n:"BrtBeginPCDFields", */
    T: 1
  },
  182: {
    /* n:"BrtEndPCDFields", */
    T: -1
  },
  183: {
    /* n:"BrtBeginPCDField", */
    T: 1
  },
  184: {
    /* n:"BrtEndPCDField", */
    T: -1
  },
  185: {
    /* n:"BrtBeginPCDSource", */
    T: 1
  },
  186: {
    /* n:"BrtEndPCDSource", */
    T: -1
  },
  187: {
    /* n:"BrtBeginPCDSRange", */
    T: 1
  },
  188: {
    /* n:"BrtEndPCDSRange", */
    T: -1
  },
  189: {
    /* n:"BrtBeginPCDFAtbl", */
    T: 1
  },
  190: {
    /* n:"BrtEndPCDFAtbl", */
    T: -1
  },
  191: {
    /* n:"BrtBeginPCDIRun", */
    T: 1
  },
  192: {
    /* n:"BrtEndPCDIRun", */
    T: -1
  },
  193: {
    /* n:"BrtBeginPivotCacheRecords", */
    T: 1
  },
  194: {
    /* n:"BrtEndPivotCacheRecords", */
    T: -1
  },
  195: {
    /* n:"BrtBeginPCDHierarchies", */
    T: 1
  },
  196: {
    /* n:"BrtEndPCDHierarchies", */
    T: -1
  },
  197: {
    /* n:"BrtBeginPCDHierarchy", */
    T: 1
  },
  198: {
    /* n:"BrtEndPCDHierarchy", */
    T: -1
  },
  199: {
    /* n:"BrtBeginPCDHFieldsUsage", */
    T: 1
  },
  200: {
    /* n:"BrtEndPCDHFieldsUsage", */
    T: -1
  },
  201: {
    /* n:"BrtBeginExtConnection", */
    T: 1
  },
  202: {
    /* n:"BrtEndExtConnection", */
    T: -1
  },
  203: {
    /* n:"BrtBeginECDbProps", */
    T: 1
  },
  204: {
    /* n:"BrtEndECDbProps", */
    T: -1
  },
  205: {
    /* n:"BrtBeginECOlapProps", */
    T: 1
  },
  206: {
    /* n:"BrtEndECOlapProps", */
    T: -1
  },
  207: {
    /* n:"BrtBeginPCDSConsol", */
    T: 1
  },
  208: {
    /* n:"BrtEndPCDSConsol", */
    T: -1
  },
  209: {
    /* n:"BrtBeginPCDSCPages", */
    T: 1
  },
  210: {
    /* n:"BrtEndPCDSCPages", */
    T: -1
  },
  211: {
    /* n:"BrtBeginPCDSCPage", */
    T: 1
  },
  212: {
    /* n:"BrtEndPCDSCPage", */
    T: -1
  },
  213: {
    /* n:"BrtBeginPCDSCPItem", */
    T: 1
  },
  214: {
    /* n:"BrtEndPCDSCPItem", */
    T: -1
  },
  215: {
    /* n:"BrtBeginPCDSCSets", */
    T: 1
  },
  216: {
    /* n:"BrtEndPCDSCSets", */
    T: -1
  },
  217: {
    /* n:"BrtBeginPCDSCSet", */
    T: 1
  },
  218: {
    /* n:"BrtEndPCDSCSet", */
    T: -1
  },
  219: {
    /* n:"BrtBeginPCDFGroup", */
    T: 1
  },
  220: {
    /* n:"BrtEndPCDFGroup", */
    T: -1
  },
  221: {
    /* n:"BrtBeginPCDFGItems", */
    T: 1
  },
  222: {
    /* n:"BrtEndPCDFGItems", */
    T: -1
  },
  223: {
    /* n:"BrtBeginPCDFGRange", */
    T: 1
  },
  224: {
    /* n:"BrtEndPCDFGRange", */
    T: -1
  },
  225: {
    /* n:"BrtBeginPCDFGDiscrete", */
    T: 1
  },
  226: {
    /* n:"BrtEndPCDFGDiscrete", */
    T: -1
  },
  227: {
    /* n:"BrtBeginPCDSDTupleCache", */
    T: 1
  },
  228: {
    /* n:"BrtEndPCDSDTupleCache", */
    T: -1
  },
  229: {
    /* n:"BrtBeginPCDSDTCEntries", */
    T: 1
  },
  230: {
    /* n:"BrtEndPCDSDTCEntries", */
    T: -1
  },
  231: {
    /* n:"BrtBeginPCDSDTCEMembers", */
    T: 1
  },
  232: {
    /* n:"BrtEndPCDSDTCEMembers", */
    T: -1
  },
  233: {
    /* n:"BrtBeginPCDSDTCEMember", */
    T: 1
  },
  234: {
    /* n:"BrtEndPCDSDTCEMember", */
    T: -1
  },
  235: {
    /* n:"BrtBeginPCDSDTCQueries", */
    T: 1
  },
  236: {
    /* n:"BrtEndPCDSDTCQueries", */
    T: -1
  },
  237: {
    /* n:"BrtBeginPCDSDTCQuery", */
    T: 1
  },
  238: {
    /* n:"BrtEndPCDSDTCQuery", */
    T: -1
  },
  239: {
    /* n:"BrtBeginPCDSDTCSets", */
    T: 1
  },
  240: {
    /* n:"BrtEndPCDSDTCSets", */
    T: -1
  },
  241: {
    /* n:"BrtBeginPCDSDTCSet", */
    T: 1
  },
  242: {
    /* n:"BrtEndPCDSDTCSet", */
    T: -1
  },
  243: {
    /* n:"BrtBeginPCDCalcItems", */
    T: 1
  },
  244: {
    /* n:"BrtEndPCDCalcItems", */
    T: -1
  },
  245: {
    /* n:"BrtBeginPCDCalcItem", */
    T: 1
  },
  246: {
    /* n:"BrtEndPCDCalcItem", */
    T: -1
  },
  247: {
    /* n:"BrtBeginPRule", */
    T: 1
  },
  248: {
    /* n:"BrtEndPRule", */
    T: -1
  },
  249: {
    /* n:"BrtBeginPRFilters", */
    T: 1
  },
  250: {
    /* n:"BrtEndPRFilters", */
    T: -1
  },
  251: {
    /* n:"BrtBeginPRFilter", */
    T: 1
  },
  252: {
    /* n:"BrtEndPRFilter", */
    T: -1
  },
  253: {
    /* n:"BrtBeginPNames", */
    T: 1
  },
  254: {
    /* n:"BrtEndPNames", */
    T: -1
  },
  255: {
    /* n:"BrtBeginPName", */
    T: 1
  },
  256: {
    /* n:"BrtEndPName", */
    T: -1
  },
  257: {
    /* n:"BrtBeginPNPairs", */
    T: 1
  },
  258: {
    /* n:"BrtEndPNPairs", */
    T: -1
  },
  259: {
    /* n:"BrtBeginPNPair", */
    T: 1
  },
  260: {
    /* n:"BrtEndPNPair", */
    T: -1
  },
  261: {
    /* n:"BrtBeginECWebProps", */
    T: 1
  },
  262: {
    /* n:"BrtEndECWebProps", */
    T: -1
  },
  263: {
    /* n:"BrtBeginEcWpTables", */
    T: 1
  },
  264: {
    /* n:"BrtEndECWPTables", */
    T: -1
  },
  265: {
    /* n:"BrtBeginECParams", */
    T: 1
  },
  266: {
    /* n:"BrtEndECParams", */
    T: -1
  },
  267: {
    /* n:"BrtBeginECParam", */
    T: 1
  },
  268: {
    /* n:"BrtEndECParam", */
    T: -1
  },
  269: {
    /* n:"BrtBeginPCDKPIs", */
    T: 1
  },
  270: {
    /* n:"BrtEndPCDKPIs", */
    T: -1
  },
  271: {
    /* n:"BrtBeginPCDKPI", */
    T: 1
  },
  272: {
    /* n:"BrtEndPCDKPI", */
    T: -1
  },
  273: {
    /* n:"BrtBeginDims", */
    T: 1
  },
  274: {
    /* n:"BrtEndDims", */
    T: -1
  },
  275: {
    /* n:"BrtBeginDim", */
    T: 1
  },
  276: {
    /* n:"BrtEndDim", */
    T: -1
  },
  277: {
    /* n:"BrtIndexPartEnd" */
  },
  278: {
    /* n:"BrtBeginStyleSheet", */
    T: 1
  },
  279: {
    /* n:"BrtEndStyleSheet", */
    T: -1
  },
  280: {
    /* n:"BrtBeginSXView", */
    T: 1
  },
  281: {
    /* n:"BrtEndSXVI", */
    T: -1
  },
  282: {
    /* n:"BrtBeginSXVI", */
    T: 1
  },
  283: {
    /* n:"BrtBeginSXVIs", */
    T: 1
  },
  284: {
    /* n:"BrtEndSXVIs", */
    T: -1
  },
  285: {
    /* n:"BrtBeginSXVD", */
    T: 1
  },
  286: {
    /* n:"BrtEndSXVD", */
    T: -1
  },
  287: {
    /* n:"BrtBeginSXVDs", */
    T: 1
  },
  288: {
    /* n:"BrtEndSXVDs", */
    T: -1
  },
  289: {
    /* n:"BrtBeginSXPI", */
    T: 1
  },
  290: {
    /* n:"BrtEndSXPI", */
    T: -1
  },
  291: {
    /* n:"BrtBeginSXPIs", */
    T: 1
  },
  292: {
    /* n:"BrtEndSXPIs", */
    T: -1
  },
  293: {
    /* n:"BrtBeginSXDI", */
    T: 1
  },
  294: {
    /* n:"BrtEndSXDI", */
    T: -1
  },
  295: {
    /* n:"BrtBeginSXDIs", */
    T: 1
  },
  296: {
    /* n:"BrtEndSXDIs", */
    T: -1
  },
  297: {
    /* n:"BrtBeginSXLI", */
    T: 1
  },
  298: {
    /* n:"BrtEndSXLI", */
    T: -1
  },
  299: {
    /* n:"BrtBeginSXLIRws", */
    T: 1
  },
  300: {
    /* n:"BrtEndSXLIRws", */
    T: -1
  },
  301: {
    /* n:"BrtBeginSXLICols", */
    T: 1
  },
  302: {
    /* n:"BrtEndSXLICols", */
    T: -1
  },
  303: {
    /* n:"BrtBeginSXFormat", */
    T: 1
  },
  304: {
    /* n:"BrtEndSXFormat", */
    T: -1
  },
  305: {
    /* n:"BrtBeginSXFormats", */
    T: 1
  },
  306: {
    /* n:"BrtEndSxFormats", */
    T: -1
  },
  307: {
    /* n:"BrtBeginSxSelect", */
    T: 1
  },
  308: {
    /* n:"BrtEndSxSelect", */
    T: -1
  },
  309: {
    /* n:"BrtBeginISXVDRws", */
    T: 1
  },
  310: {
    /* n:"BrtEndISXVDRws", */
    T: -1
  },
  311: {
    /* n:"BrtBeginISXVDCols", */
    T: 1
  },
  312: {
    /* n:"BrtEndISXVDCols", */
    T: -1
  },
  313: {
    /* n:"BrtEndSXLocation", */
    T: -1
  },
  314: {
    /* n:"BrtBeginSXLocation", */
    T: 1
  },
  315: {
    /* n:"BrtEndSXView", */
    T: -1
  },
  316: {
    /* n:"BrtBeginSXTHs", */
    T: 1
  },
  317: {
    /* n:"BrtEndSXTHs", */
    T: -1
  },
  318: {
    /* n:"BrtBeginSXTH", */
    T: 1
  },
  319: {
    /* n:"BrtEndSXTH", */
    T: -1
  },
  320: {
    /* n:"BrtBeginISXTHRws", */
    T: 1
  },
  321: {
    /* n:"BrtEndISXTHRws", */
    T: -1
  },
  322: {
    /* n:"BrtBeginISXTHCols", */
    T: 1
  },
  323: {
    /* n:"BrtEndISXTHCols", */
    T: -1
  },
  324: {
    /* n:"BrtBeginSXTDMPS", */
    T: 1
  },
  325: {
    /* n:"BrtEndSXTDMPs", */
    T: -1
  },
  326: {
    /* n:"BrtBeginSXTDMP", */
    T: 1
  },
  327: {
    /* n:"BrtEndSXTDMP", */
    T: -1
  },
  328: {
    /* n:"BrtBeginSXTHItems", */
    T: 1
  },
  329: {
    /* n:"BrtEndSXTHItems", */
    T: -1
  },
  330: {
    /* n:"BrtBeginSXTHItem", */
    T: 1
  },
  331: {
    /* n:"BrtEndSXTHItem", */
    T: -1
  },
  332: {
    /* n:"BrtBeginMetadata", */
    T: 1
  },
  333: {
    /* n:"BrtEndMetadata", */
    T: -1
  },
  334: {
    /* n:"BrtBeginEsmdtinfo", */
    T: 1
  },
  335: {
    /* n:"BrtMdtinfo", */
    f: C1
  },
  336: {
    /* n:"BrtEndEsmdtinfo", */
    T: -1
  },
  337: {
    /* n:"BrtBeginEsmdb", */
    f: S1,
    T: 1
  },
  338: {
    /* n:"BrtEndEsmdb", */
    T: -1
  },
  339: {
    /* n:"BrtBeginEsfmd", */
    T: 1
  },
  340: {
    /* n:"BrtEndEsfmd", */
    T: -1
  },
  341: {
    /* n:"BrtBeginSingleCells", */
    T: 1
  },
  342: {
    /* n:"BrtEndSingleCells", */
    T: -1
  },
  343: {
    /* n:"BrtBeginList", */
    T: 1
  },
  344: {
    /* n:"BrtEndList", */
    T: -1
  },
  345: {
    /* n:"BrtBeginListCols", */
    T: 1
  },
  346: {
    /* n:"BrtEndListCols", */
    T: -1
  },
  347: {
    /* n:"BrtBeginListCol", */
    T: 1
  },
  348: {
    /* n:"BrtEndListCol", */
    T: -1
  },
  349: {
    /* n:"BrtBeginListXmlCPr", */
    T: 1
  },
  350: {
    /* n:"BrtEndListXmlCPr", */
    T: -1
  },
  351: {
    /* n:"BrtListCCFmla" */
  },
  352: {
    /* n:"BrtListTrFmla" */
  },
  353: {
    /* n:"BrtBeginExternals", */
    T: 1
  },
  354: {
    /* n:"BrtEndExternals", */
    T: -1
  },
  355: {
    /* n:"BrtSupBookSrc", */
    f: d0
  },
  357: {
    /* n:"BrtSupSelf" */
  },
  358: {
    /* n:"BrtSupSame" */
  },
  359: {
    /* n:"BrtSupTabs" */
  },
  360: {
    /* n:"BrtBeginSupBook", */
    T: 1
  },
  361: {
    /* n:"BrtPlaceholderName" */
  },
  362: {
    /* n:"BrtExternSheet", */
    f: Ac
  },
  363: {
    /* n:"BrtExternTableStart" */
  },
  364: {
    /* n:"BrtExternTableEnd" */
  },
  366: {
    /* n:"BrtExternRowHdr" */
  },
  367: {
    /* n:"BrtExternCellBlank" */
  },
  368: {
    /* n:"BrtExternCellReal" */
  },
  369: {
    /* n:"BrtExternCellBool" */
  },
  370: {
    /* n:"BrtExternCellError" */
  },
  371: {
    /* n:"BrtExternCellString" */
  },
  372: {
    /* n:"BrtBeginEsmdx", */
    T: 1
  },
  373: {
    /* n:"BrtEndEsmdx", */
    T: -1
  },
  374: {
    /* n:"BrtBeginMdxSet", */
    T: 1
  },
  375: {
    /* n:"BrtEndMdxSet", */
    T: -1
  },
  376: {
    /* n:"BrtBeginMdxMbrProp", */
    T: 1
  },
  377: {
    /* n:"BrtEndMdxMbrProp", */
    T: -1
  },
  378: {
    /* n:"BrtBeginMdxKPI", */
    T: 1
  },
  379: {
    /* n:"BrtEndMdxKPI", */
    T: -1
  },
  380: {
    /* n:"BrtBeginEsstr", */
    T: 1
  },
  381: {
    /* n:"BrtEndEsstr", */
    T: -1
  },
  382: {
    /* n:"BrtBeginPRFItem", */
    T: 1
  },
  383: {
    /* n:"BrtEndPRFItem", */
    T: -1
  },
  384: {
    /* n:"BrtBeginPivotCacheIDs", */
    T: 1
  },
  385: {
    /* n:"BrtEndPivotCacheIDs", */
    T: -1
  },
  386: {
    /* n:"BrtBeginPivotCacheID", */
    T: 1
  },
  387: {
    /* n:"BrtEndPivotCacheID", */
    T: -1
  },
  388: {
    /* n:"BrtBeginISXVIs", */
    T: 1
  },
  389: {
    /* n:"BrtEndISXVIs", */
    T: -1
  },
  390: {
    /* n:"BrtBeginColInfos", */
    T: 1
  },
  391: {
    /* n:"BrtEndColInfos", */
    T: -1
  },
  392: {
    /* n:"BrtBeginRwBrk", */
    T: 1
  },
  393: {
    /* n:"BrtEndRwBrk", */
    T: -1
  },
  394: {
    /* n:"BrtBeginColBrk", */
    T: 1
  },
  395: {
    /* n:"BrtEndColBrk", */
    T: -1
  },
  396: {
    /* n:"BrtBrk" */
  },
  397: {
    /* n:"BrtUserBookView" */
  },
  398: {
    /* n:"BrtInfo" */
  },
  399: {
    /* n:"BrtCUsr" */
  },
  400: {
    /* n:"BrtUsr" */
  },
  401: {
    /* n:"BrtBeginUsers", */
    T: 1
  },
  403: {
    /* n:"BrtEOF" */
  },
  404: {
    /* n:"BrtUCR" */
  },
  405: {
    /* n:"BrtRRInsDel" */
  },
  406: {
    /* n:"BrtRREndInsDel" */
  },
  407: {
    /* n:"BrtRRMove" */
  },
  408: {
    /* n:"BrtRREndMove" */
  },
  409: {
    /* n:"BrtRRChgCell" */
  },
  410: {
    /* n:"BrtRREndChgCell" */
  },
  411: {
    /* n:"BrtRRHeader" */
  },
  412: {
    /* n:"BrtRRUserView" */
  },
  413: {
    /* n:"BrtRRRenSheet" */
  },
  414: {
    /* n:"BrtRRInsertSh" */
  },
  415: {
    /* n:"BrtRRDefName" */
  },
  416: {
    /* n:"BrtRRNote" */
  },
  417: {
    /* n:"BrtRRConflict" */
  },
  418: {
    /* n:"BrtRRTQSIF" */
  },
  419: {
    /* n:"BrtRRFormat" */
  },
  420: {
    /* n:"BrtRREndFormat" */
  },
  421: {
    /* n:"BrtRRAutoFmt" */
  },
  422: {
    /* n:"BrtBeginUserShViews", */
    T: 1
  },
  423: {
    /* n:"BrtBeginUserShView", */
    T: 1
  },
  424: {
    /* n:"BrtEndUserShView", */
    T: -1
  },
  425: {
    /* n:"BrtEndUserShViews", */
    T: -1
  },
  426: {
    /* n:"BrtArrFmla", */
    f: vx
  },
  427: {
    /* n:"BrtShrFmla", */
    f: gx
  },
  428: {
    /* n:"BrtTable" */
  },
  429: {
    /* n:"BrtBeginExtConnections", */
    T: 1
  },
  430: {
    /* n:"BrtEndExtConnections", */
    T: -1
  },
  431: {
    /* n:"BrtBeginPCDCalcMems", */
    T: 1
  },
  432: {
    /* n:"BrtEndPCDCalcMems", */
    T: -1
  },
  433: {
    /* n:"BrtBeginPCDCalcMem", */
    T: 1
  },
  434: {
    /* n:"BrtEndPCDCalcMem", */
    T: -1
  },
  435: {
    /* n:"BrtBeginPCDHGLevels", */
    T: 1
  },
  436: {
    /* n:"BrtEndPCDHGLevels", */
    T: -1
  },
  437: {
    /* n:"BrtBeginPCDHGLevel", */
    T: 1
  },
  438: {
    /* n:"BrtEndPCDHGLevel", */
    T: -1
  },
  439: {
    /* n:"BrtBeginPCDHGLGroups", */
    T: 1
  },
  440: {
    /* n:"BrtEndPCDHGLGroups", */
    T: -1
  },
  441: {
    /* n:"BrtBeginPCDHGLGroup", */
    T: 1
  },
  442: {
    /* n:"BrtEndPCDHGLGroup", */
    T: -1
  },
  443: {
    /* n:"BrtBeginPCDHGLGMembers", */
    T: 1
  },
  444: {
    /* n:"BrtEndPCDHGLGMembers", */
    T: -1
  },
  445: {
    /* n:"BrtBeginPCDHGLGMember", */
    T: 1
  },
  446: {
    /* n:"BrtEndPCDHGLGMember", */
    T: -1
  },
  447: {
    /* n:"BrtBeginQSI", */
    T: 1
  },
  448: {
    /* n:"BrtEndQSI", */
    T: -1
  },
  449: {
    /* n:"BrtBeginQSIR", */
    T: 1
  },
  450: {
    /* n:"BrtEndQSIR", */
    T: -1
  },
  451: {
    /* n:"BrtBeginDeletedNames", */
    T: 1
  },
  452: {
    /* n:"BrtEndDeletedNames", */
    T: -1
  },
  453: {
    /* n:"BrtBeginDeletedName", */
    T: 1
  },
  454: {
    /* n:"BrtEndDeletedName", */
    T: -1
  },
  455: {
    /* n:"BrtBeginQSIFs", */
    T: 1
  },
  456: {
    /* n:"BrtEndQSIFs", */
    T: -1
  },
  457: {
    /* n:"BrtBeginQSIF", */
    T: 1
  },
  458: {
    /* n:"BrtEndQSIF", */
    T: -1
  },
  459: {
    /* n:"BrtBeginAutoSortScope", */
    T: 1
  },
  460: {
    /* n:"BrtEndAutoSortScope", */
    T: -1
  },
  461: {
    /* n:"BrtBeginConditionalFormatting", */
    T: 1
  },
  462: {
    /* n:"BrtEndConditionalFormatting", */
    T: -1
  },
  463: {
    /* n:"BrtBeginCFRule", */
    T: 1
  },
  464: {
    /* n:"BrtEndCFRule", */
    T: -1
  },
  465: {
    /* n:"BrtBeginIconSet", */
    T: 1
  },
  466: {
    /* n:"BrtEndIconSet", */
    T: -1
  },
  467: {
    /* n:"BrtBeginDatabar", */
    T: 1
  },
  468: {
    /* n:"BrtEndDatabar", */
    T: -1
  },
  469: {
    /* n:"BrtBeginColorScale", */
    T: 1
  },
  470: {
    /* n:"BrtEndColorScale", */
    T: -1
  },
  471: {
    /* n:"BrtCFVO" */
  },
  472: {
    /* n:"BrtExternValueMeta" */
  },
  473: {
    /* n:"BrtBeginColorPalette", */
    T: 1
  },
  474: {
    /* n:"BrtEndColorPalette", */
    T: -1
  },
  475: {
    /* n:"BrtIndexedColor" */
  },
  476: {
    /* n:"BrtMargins", */
    f: _x
  },
  477: {
    /* n:"BrtPrintOptions" */
  },
  478: {
    /* n:"BrtPageSetup" */
  },
  479: {
    /* n:"BrtBeginHeaderFooter", */
    T: 1
  },
  480: {
    /* n:"BrtEndHeaderFooter", */
    T: -1
  },
  481: {
    /* n:"BrtBeginSXCrtFormat", */
    T: 1
  },
  482: {
    /* n:"BrtEndSXCrtFormat", */
    T: -1
  },
  483: {
    /* n:"BrtBeginSXCrtFormats", */
    T: 1
  },
  484: {
    /* n:"BrtEndSXCrtFormats", */
    T: -1
  },
  485: {
    /* n:"BrtWsFmtInfo", */
    f: $d
  },
  486: {
    /* n:"BrtBeginMgs", */
    T: 1
  },
  487: {
    /* n:"BrtEndMGs", */
    T: -1
  },
  488: {
    /* n:"BrtBeginMGMaps", */
    T: 1
  },
  489: {
    /* n:"BrtEndMGMaps", */
    T: -1
  },
  490: {
    /* n:"BrtBeginMG", */
    T: 1
  },
  491: {
    /* n:"BrtEndMG", */
    T: -1
  },
  492: {
    /* n:"BrtBeginMap", */
    T: 1
  },
  493: {
    /* n:"BrtEndMap", */
    T: -1
  },
  494: {
    /* n:"BrtHLink", */
    f: xx
  },
  495: {
    /* n:"BrtBeginDCon", */
    T: 1
  },
  496: {
    /* n:"BrtEndDCon", */
    T: -1
  },
  497: {
    /* n:"BrtBeginDRefs", */
    T: 1
  },
  498: {
    /* n:"BrtEndDRefs", */
    T: -1
  },
  499: {
    /* n:"BrtDRef" */
  },
  500: {
    /* n:"BrtBeginScenMan", */
    T: 1
  },
  501: {
    /* n:"BrtEndScenMan", */
    T: -1
  },
  502: {
    /* n:"BrtBeginSct", */
    T: 1
  },
  503: {
    /* n:"BrtEndSct", */
    T: -1
  },
  504: {
    /* n:"BrtSlc" */
  },
  505: {
    /* n:"BrtBeginDXFs", */
    T: 1
  },
  506: {
    /* n:"BrtEndDXFs", */
    T: -1
  },
  507: {
    /* n:"BrtDXF" */
  },
  508: {
    /* n:"BrtBeginTableStyles", */
    T: 1
  },
  509: {
    /* n:"BrtEndTableStyles", */
    T: -1
  },
  510: {
    /* n:"BrtBeginTableStyle", */
    T: 1
  },
  511: {
    /* n:"BrtEndTableStyle", */
    T: -1
  },
  512: {
    /* n:"BrtTableStyleElement" */
  },
  513: {
    /* n:"BrtTableStyleClient" */
  },
  514: {
    /* n:"BrtBeginVolDeps", */
    T: 1
  },
  515: {
    /* n:"BrtEndVolDeps", */
    T: -1
  },
  516: {
    /* n:"BrtBeginVolType", */
    T: 1
  },
  517: {
    /* n:"BrtEndVolType", */
    T: -1
  },
  518: {
    /* n:"BrtBeginVolMain", */
    T: 1
  },
  519: {
    /* n:"BrtEndVolMain", */
    T: -1
  },
  520: {
    /* n:"BrtBeginVolTopic", */
    T: 1
  },
  521: {
    /* n:"BrtEndVolTopic", */
    T: -1
  },
  522: {
    /* n:"BrtVolSubtopic" */
  },
  523: {
    /* n:"BrtVolRef" */
  },
  524: {
    /* n:"BrtVolNum" */
  },
  525: {
    /* n:"BrtVolErr" */
  },
  526: {
    /* n:"BrtVolStr" */
  },
  527: {
    /* n:"BrtVolBool" */
  },
  528: {
    /* n:"BrtBeginCalcChain$", */
    T: 1
  },
  529: {
    /* n:"BrtEndCalcChain$", */
    T: -1
  },
  530: {
    /* n:"BrtBeginSortState", */
    T: 1
  },
  531: {
    /* n:"BrtEndSortState", */
    T: -1
  },
  532: {
    /* n:"BrtBeginSortCond", */
    T: 1
  },
  533: {
    /* n:"BrtEndSortCond", */
    T: -1
  },
  534: {
    /* n:"BrtBookProtection" */
  },
  535: {
    /* n:"BrtSheetProtection" */
  },
  536: {
    /* n:"BrtRangeProtection" */
  },
  537: {
    /* n:"BrtPhoneticInfo" */
  },
  538: {
    /* n:"BrtBeginECTxtWiz", */
    T: 1
  },
  539: {
    /* n:"BrtEndECTxtWiz", */
    T: -1
  },
  540: {
    /* n:"BrtBeginECTWFldInfoLst", */
    T: 1
  },
  541: {
    /* n:"BrtEndECTWFldInfoLst", */
    T: -1
  },
  542: {
    /* n:"BrtBeginECTwFldInfo", */
    T: 1
  },
  548: {
    /* n:"BrtFileSharing" */
  },
  549: {
    /* n:"BrtOleSize" */
  },
  550: {
    /* n:"BrtDrawing", */
    f: d0
  },
  551: {
    /* n:"BrtLegacyDrawing", */
    f: Wn
  },
  552: {
    /* n:"BrtLegacyDrawingHF" */
  },
  553: {
    /* n:"BrtWebOpt" */
  },
  554: {
    /* n:"BrtBeginWebPubItems", */
    T: 1
  },
  555: {
    /* n:"BrtEndWebPubItems", */
    T: -1
  },
  556: {
    /* n:"BrtBeginWebPubItem", */
    T: 1
  },
  557: {
    /* n:"BrtEndWebPubItem", */
    T: -1
  },
  558: {
    /* n:"BrtBeginSXCondFmt", */
    T: 1
  },
  559: {
    /* n:"BrtEndSXCondFmt", */
    T: -1
  },
  560: {
    /* n:"BrtBeginSXCondFmts", */
    T: 1
  },
  561: {
    /* n:"BrtEndSXCondFmts", */
    T: -1
  },
  562: {
    /* n:"BrtBkHim" */
  },
  564: {
    /* n:"BrtColor" */
  },
  565: {
    /* n:"BrtBeginIndexedColors", */
    T: 1
  },
  566: {
    /* n:"BrtEndIndexedColors", */
    T: -1
  },
  569: {
    /* n:"BrtBeginMRUColors", */
    T: 1
  },
  570: {
    /* n:"BrtEndMRUColors", */
    T: -1
  },
  572: {
    /* n:"BrtMRUColor" */
  },
  573: {
    /* n:"BrtBeginDVals", */
    T: 1
  },
  574: {
    /* n:"BrtEndDVals", */
    T: -1
  },
  577: {
    /* n:"BrtSupNameStart" */
  },
  578: {
    /* n:"BrtSupNameValueStart" */
  },
  579: {
    /* n:"BrtSupNameValueEnd" */
  },
  580: {
    /* n:"BrtSupNameNum" */
  },
  581: {
    /* n:"BrtSupNameErr" */
  },
  582: {
    /* n:"BrtSupNameSt" */
  },
  583: {
    /* n:"BrtSupNameNil" */
  },
  584: {
    /* n:"BrtSupNameBool" */
  },
  585: {
    /* n:"BrtSupNameFmla" */
  },
  586: {
    /* n:"BrtSupNameBits" */
  },
  587: {
    /* n:"BrtSupNameEnd" */
  },
  588: {
    /* n:"BrtEndSupBook", */
    T: -1
  },
  589: {
    /* n:"BrtCellSmartTagProperty" */
  },
  590: {
    /* n:"BrtBeginCellSmartTag", */
    T: 1
  },
  591: {
    /* n:"BrtEndCellSmartTag", */
    T: -1
  },
  592: {
    /* n:"BrtBeginCellSmartTags", */
    T: 1
  },
  593: {
    /* n:"BrtEndCellSmartTags", */
    T: -1
  },
  594: {
    /* n:"BrtBeginSmartTags", */
    T: 1
  },
  595: {
    /* n:"BrtEndSmartTags", */
    T: -1
  },
  596: {
    /* n:"BrtSmartTagType" */
  },
  597: {
    /* n:"BrtBeginSmartTagTypes", */
    T: 1
  },
  598: {
    /* n:"BrtEndSmartTagTypes", */
    T: -1
  },
  599: {
    /* n:"BrtBeginSXFilters", */
    T: 1
  },
  600: {
    /* n:"BrtEndSXFilters", */
    T: -1
  },
  601: {
    /* n:"BrtBeginSXFILTER", */
    T: 1
  },
  602: {
    /* n:"BrtEndSXFilter", */
    T: -1
  },
  603: {
    /* n:"BrtBeginFills", */
    T: 1
  },
  604: {
    /* n:"BrtEndFills", */
    T: -1
  },
  605: {
    /* n:"BrtBeginCellWatches", */
    T: 1
  },
  606: {
    /* n:"BrtEndCellWatches", */
    T: -1
  },
  607: {
    /* n:"BrtCellWatch" */
  },
  608: {
    /* n:"BrtBeginCRErrs", */
    T: 1
  },
  609: {
    /* n:"BrtEndCRErrs", */
    T: -1
  },
  610: {
    /* n:"BrtCrashRecErr" */
  },
  611: {
    /* n:"BrtBeginFonts", */
    T: 1
  },
  612: {
    /* n:"BrtEndFonts", */
    T: -1
  },
  613: {
    /* n:"BrtBeginBorders", */
    T: 1
  },
  614: {
    /* n:"BrtEndBorders", */
    T: -1
  },
  615: {
    /* n:"BrtBeginFmts", */
    T: 1
  },
  616: {
    /* n:"BrtEndFmts", */
    T: -1
  },
  617: {
    /* n:"BrtBeginCellXFs", */
    T: 1
  },
  618: {
    /* n:"BrtEndCellXFs", */
    T: -1
  },
  619: {
    /* n:"BrtBeginStyles", */
    T: 1
  },
  620: {
    /* n:"BrtEndStyles", */
    T: -1
  },
  625: {
    /* n:"BrtBigName" */
  },
  626: {
    /* n:"BrtBeginCellStyleXFs", */
    T: 1
  },
  627: {
    /* n:"BrtEndCellStyleXFs", */
    T: -1
  },
  628: {
    /* n:"BrtBeginComments", */
    T: 1
  },
  629: {
    /* n:"BrtEndComments", */
    T: -1
  },
  630: {
    /* n:"BrtBeginCommentAuthors", */
    T: 1
  },
  631: {
    /* n:"BrtEndCommentAuthors", */
    T: -1
  },
  632: {
    /* n:"BrtCommentAuthor", */
    f: j1
  },
  633: {
    /* n:"BrtBeginCommentList", */
    T: 1
  },
  634: {
    /* n:"BrtEndCommentList", */
    T: -1
  },
  635: {
    /* n:"BrtBeginComment", */
    T: 1,
    f: $1
  },
  636: {
    /* n:"BrtEndComment", */
    T: -1
  },
  637: {
    /* n:"BrtCommentText", */
    f: Kf
  },
  638: {
    /* n:"BrtBeginOleObjects", */
    T: 1
  },
  639: {
    /* n:"BrtOleObject" */
  },
  640: {
    /* n:"BrtEndOleObjects", */
    T: -1
  },
  641: {
    /* n:"BrtBeginSxrules", */
    T: 1
  },
  642: {
    /* n:"BrtEndSxRules", */
    T: -1
  },
  643: {
    /* n:"BrtBeginActiveXControls", */
    T: 1
  },
  644: {
    /* n:"BrtActiveX" */
  },
  645: {
    /* n:"BrtEndActiveXControls", */
    T: -1
  },
  646: {
    /* n:"BrtBeginPCDSDTCEMembersSortBy", */
    T: 1
  },
  648: {
    /* n:"BrtBeginCellIgnoreECs", */
    T: 1
  },
  649: {
    /* n:"BrtCellIgnoreEC" */
  },
  650: {
    /* n:"BrtEndCellIgnoreECs", */
    T: -1
  },
  651: {
    /* n:"BrtCsProp", */
    f: bx
  },
  652: {
    /* n:"BrtCsPageSetup" */
  },
  653: {
    /* n:"BrtBeginUserCsViews", */
    T: 1
  },
  654: {
    /* n:"BrtEndUserCsViews", */
    T: -1
  },
  655: {
    /* n:"BrtBeginUserCsView", */
    T: 1
  },
  656: {
    /* n:"BrtEndUserCsView", */
    T: -1
  },
  657: {
    /* n:"BrtBeginPcdSFCIEntries", */
    T: 1
  },
  658: {
    /* n:"BrtEndPCDSFCIEntries", */
    T: -1
  },
  659: {
    /* n:"BrtPCDSFCIEntry" */
  },
  660: {
    /* n:"BrtBeginListParts", */
    T: 1
  },
  661: {
    /* n:"BrtListPart" */
  },
  662: {
    /* n:"BrtEndListParts", */
    T: -1
  },
  663: {
    /* n:"BrtSheetCalcProp" */
  },
  664: {
    /* n:"BrtBeginFnGroup", */
    T: 1
  },
  665: {
    /* n:"BrtFnGroup" */
  },
  666: {
    /* n:"BrtEndFnGroup", */
    T: -1
  },
  667: {
    /* n:"BrtSupAddin" */
  },
  668: {
    /* n:"BrtSXTDMPOrder" */
  },
  669: {
    /* n:"BrtCsProtection" */
  },
  671: {
    /* n:"BrtBeginWsSortMap", */
    T: 1
  },
  672: {
    /* n:"BrtEndWsSortMap", */
    T: -1
  },
  673: {
    /* n:"BrtBeginRRSort", */
    T: 1
  },
  674: {
    /* n:"BrtEndRRSort", */
    T: -1
  },
  675: {
    /* n:"BrtRRSortItem" */
  },
  676: {
    /* n:"BrtFileSharingIso" */
  },
  677: {
    /* n:"BrtBookProtectionIso" */
  },
  678: {
    /* n:"BrtSheetProtectionIso" */
  },
  679: {
    /* n:"BrtCsProtectionIso" */
  },
  680: {
    /* n:"BrtRangeProtectionIso" */
  },
  681: {
    /* n:"BrtDValList" */
  },
  1024: {
    /* n:"BrtRwDescent" */
  },
  1025: {
    /* n:"BrtKnownFonts" */
  },
  1026: {
    /* n:"BrtBeginSXTupleSet", */
    T: 1
  },
  1027: {
    /* n:"BrtEndSXTupleSet", */
    T: -1
  },
  1028: {
    /* n:"BrtBeginSXTupleSetHeader", */
    T: 1
  },
  1029: {
    /* n:"BrtEndSXTupleSetHeader", */
    T: -1
  },
  1030: {
    /* n:"BrtSXTupleSetHeaderItem" */
  },
  1031: {
    /* n:"BrtBeginSXTupleSetData", */
    T: 1
  },
  1032: {
    /* n:"BrtEndSXTupleSetData", */
    T: -1
  },
  1033: {
    /* n:"BrtBeginSXTupleSetRow", */
    T: 1
  },
  1034: {
    /* n:"BrtEndSXTupleSetRow", */
    T: -1
  },
  1035: {
    /* n:"BrtSXTupleSetRowItem" */
  },
  1036: {
    /* n:"BrtNameExt" */
  },
  1037: {
    /* n:"BrtPCDH14" */
  },
  1038: {
    /* n:"BrtBeginPCDCalcMem14", */
    T: 1
  },
  1039: {
    /* n:"BrtEndPCDCalcMem14", */
    T: -1
  },
  1040: {
    /* n:"BrtSXTH14" */
  },
  1041: {
    /* n:"BrtBeginSparklineGroup", */
    T: 1
  },
  1042: {
    /* n:"BrtEndSparklineGroup", */
    T: -1
  },
  1043: {
    /* n:"BrtSparkline" */
  },
  1044: {
    /* n:"BrtSXDI14" */
  },
  1045: {
    /* n:"BrtWsFmtInfoEx14" */
  },
  1046: {
    /* n:"BrtBeginConditionalFormatting14", */
    T: 1
  },
  1047: {
    /* n:"BrtEndConditionalFormatting14", */
    T: -1
  },
  1048: {
    /* n:"BrtBeginCFRule14", */
    T: 1
  },
  1049: {
    /* n:"BrtEndCFRule14", */
    T: -1
  },
  1050: {
    /* n:"BrtCFVO14" */
  },
  1051: {
    /* n:"BrtBeginDatabar14", */
    T: 1
  },
  1052: {
    /* n:"BrtBeginIconSet14", */
    T: 1
  },
  1053: {
    /* n:"BrtDVal14", */
    f: Ax
  },
  1054: {
    /* n:"BrtBeginDVals14", */
    T: 1
  },
  1055: {
    /* n:"BrtColor14" */
  },
  1056: {
    /* n:"BrtBeginSparklines", */
    T: 1
  },
  1057: {
    /* n:"BrtEndSparklines", */
    T: -1
  },
  1058: {
    /* n:"BrtBeginSparklineGroups", */
    T: 1
  },
  1059: {
    /* n:"BrtEndSparklineGroups", */
    T: -1
  },
  1061: {
    /* n:"BrtSXVD14" */
  },
  1062: {
    /* n:"BrtBeginSXView14", */
    T: 1
  },
  1063: {
    /* n:"BrtEndSXView14", */
    T: -1
  },
  1064: {
    /* n:"BrtBeginSXView16", */
    T: 1
  },
  1065: {
    /* n:"BrtEndSXView16", */
    T: -1
  },
  1066: {
    /* n:"BrtBeginPCD14", */
    T: 1
  },
  1067: {
    /* n:"BrtEndPCD14", */
    T: -1
  },
  1068: {
    /* n:"BrtBeginExtConn14", */
    T: 1
  },
  1069: {
    /* n:"BrtEndExtConn14", */
    T: -1
  },
  1070: {
    /* n:"BrtBeginSlicerCacheIDs", */
    T: 1
  },
  1071: {
    /* n:"BrtEndSlicerCacheIDs", */
    T: -1
  },
  1072: {
    /* n:"BrtBeginSlicerCacheID", */
    T: 1
  },
  1073: {
    /* n:"BrtEndSlicerCacheID", */
    T: -1
  },
  1075: {
    /* n:"BrtBeginSlicerCache", */
    T: 1
  },
  1076: {
    /* n:"BrtEndSlicerCache", */
    T: -1
  },
  1077: {
    /* n:"BrtBeginSlicerCacheDef", */
    T: 1
  },
  1078: {
    /* n:"BrtEndSlicerCacheDef", */
    T: -1
  },
  1079: {
    /* n:"BrtBeginSlicersEx", */
    T: 1
  },
  1080: {
    /* n:"BrtEndSlicersEx", */
    T: -1
  },
  1081: {
    /* n:"BrtBeginSlicerEx", */
    T: 1
  },
  1082: {
    /* n:"BrtEndSlicerEx", */
    T: -1
  },
  1083: {
    /* n:"BrtBeginSlicer", */
    T: 1
  },
  1084: {
    /* n:"BrtEndSlicer", */
    T: -1
  },
  1085: {
    /* n:"BrtSlicerCachePivotTables" */
  },
  1086: {
    /* n:"BrtBeginSlicerCacheOlapImpl", */
    T: 1
  },
  1087: {
    /* n:"BrtEndSlicerCacheOlapImpl", */
    T: -1
  },
  1088: {
    /* n:"BrtBeginSlicerCacheLevelsData", */
    T: 1
  },
  1089: {
    /* n:"BrtEndSlicerCacheLevelsData", */
    T: -1
  },
  1090: {
    /* n:"BrtBeginSlicerCacheLevelData", */
    T: 1
  },
  1091: {
    /* n:"BrtEndSlicerCacheLevelData", */
    T: -1
  },
  1092: {
    /* n:"BrtBeginSlicerCacheSiRanges", */
    T: 1
  },
  1093: {
    /* n:"BrtEndSlicerCacheSiRanges", */
    T: -1
  },
  1094: {
    /* n:"BrtBeginSlicerCacheSiRange", */
    T: 1
  },
  1095: {
    /* n:"BrtEndSlicerCacheSiRange", */
    T: -1
  },
  1096: {
    /* n:"BrtSlicerCacheOlapItem" */
  },
  1097: {
    /* n:"BrtBeginSlicerCacheSelections", */
    T: 1
  },
  1098: {
    /* n:"BrtSlicerCacheSelection" */
  },
  1099: {
    /* n:"BrtEndSlicerCacheSelections", */
    T: -1
  },
  1100: {
    /* n:"BrtBeginSlicerCacheNative", */
    T: 1
  },
  1101: {
    /* n:"BrtEndSlicerCacheNative", */
    T: -1
  },
  1102: {
    /* n:"BrtSlicerCacheNativeItem" */
  },
  1103: {
    /* n:"BrtRangeProtection14" */
  },
  1104: {
    /* n:"BrtRangeProtectionIso14" */
  },
  1105: {
    /* n:"BrtCellIgnoreEC14" */
  },
  1111: {
    /* n:"BrtList14" */
  },
  1112: {
    /* n:"BrtCFIcon" */
  },
  1113: {
    /* n:"BrtBeginSlicerCachesPivotCacheIDs", */
    T: 1
  },
  1114: {
    /* n:"BrtEndSlicerCachesPivotCacheIDs", */
    T: -1
  },
  1115: {
    /* n:"BrtBeginSlicers", */
    T: 1
  },
  1116: {
    /* n:"BrtEndSlicers", */
    T: -1
  },
  1117: {
    /* n:"BrtWbProp14" */
  },
  1118: {
    /* n:"BrtBeginSXEdit", */
    T: 1
  },
  1119: {
    /* n:"BrtEndSXEdit", */
    T: -1
  },
  1120: {
    /* n:"BrtBeginSXEdits", */
    T: 1
  },
  1121: {
    /* n:"BrtEndSXEdits", */
    T: -1
  },
  1122: {
    /* n:"BrtBeginSXChange", */
    T: 1
  },
  1123: {
    /* n:"BrtEndSXChange", */
    T: -1
  },
  1124: {
    /* n:"BrtBeginSXChanges", */
    T: 1
  },
  1125: {
    /* n:"BrtEndSXChanges", */
    T: -1
  },
  1126: {
    /* n:"BrtSXTupleItems" */
  },
  1128: {
    /* n:"BrtBeginSlicerStyle", */
    T: 1
  },
  1129: {
    /* n:"BrtEndSlicerStyle", */
    T: -1
  },
  1130: {
    /* n:"BrtSlicerStyleElement" */
  },
  1131: {
    /* n:"BrtBeginStyleSheetExt14", */
    T: 1
  },
  1132: {
    /* n:"BrtEndStyleSheetExt14", */
    T: -1
  },
  1133: {
    /* n:"BrtBeginSlicerCachesPivotCacheID", */
    T: 1
  },
  1134: {
    /* n:"BrtEndSlicerCachesPivotCacheID", */
    T: -1
  },
  1135: {
    /* n:"BrtBeginConditionalFormattings", */
    T: 1
  },
  1136: {
    /* n:"BrtEndConditionalFormattings", */
    T: -1
  },
  1137: {
    /* n:"BrtBeginPCDCalcMemExt", */
    T: 1
  },
  1138: {
    /* n:"BrtEndPCDCalcMemExt", */
    T: -1
  },
  1139: {
    /* n:"BrtBeginPCDCalcMemsExt", */
    T: 1
  },
  1140: {
    /* n:"BrtEndPCDCalcMemsExt", */
    T: -1
  },
  1141: {
    /* n:"BrtPCDField14" */
  },
  1142: {
    /* n:"BrtBeginSlicerStyles", */
    T: 1
  },
  1143: {
    /* n:"BrtEndSlicerStyles", */
    T: -1
  },
  1144: {
    /* n:"BrtBeginSlicerStyleElements", */
    T: 1
  },
  1145: {
    /* n:"BrtEndSlicerStyleElements", */
    T: -1
  },
  1146: {
    /* n:"BrtCFRuleExt" */
  },
  1147: {
    /* n:"BrtBeginSXCondFmt14", */
    T: 1
  },
  1148: {
    /* n:"BrtEndSXCondFmt14", */
    T: -1
  },
  1149: {
    /* n:"BrtBeginSXCondFmts14", */
    T: 1
  },
  1150: {
    /* n:"BrtEndSXCondFmts14", */
    T: -1
  },
  1152: {
    /* n:"BrtBeginSortCond14", */
    T: 1
  },
  1153: {
    /* n:"BrtEndSortCond14", */
    T: -1
  },
  1154: {
    /* n:"BrtEndDVals14", */
    T: -1
  },
  1155: {
    /* n:"BrtEndIconSet14", */
    T: -1
  },
  1156: {
    /* n:"BrtEndDatabar14", */
    T: -1
  },
  1157: {
    /* n:"BrtBeginColorScale14", */
    T: 1
  },
  1158: {
    /* n:"BrtEndColorScale14", */
    T: -1
  },
  1159: {
    /* n:"BrtBeginSxrules14", */
    T: 1
  },
  1160: {
    /* n:"BrtEndSxrules14", */
    T: -1
  },
  1161: {
    /* n:"BrtBeginPRule14", */
    T: 1
  },
  1162: {
    /* n:"BrtEndPRule14", */
    T: -1
  },
  1163: {
    /* n:"BrtBeginPRFilters14", */
    T: 1
  },
  1164: {
    /* n:"BrtEndPRFilters14", */
    T: -1
  },
  1165: {
    /* n:"BrtBeginPRFilter14", */
    T: 1
  },
  1166: {
    /* n:"BrtEndPRFilter14", */
    T: -1
  },
  1167: {
    /* n:"BrtBeginPRFItem14", */
    T: 1
  },
  1168: {
    /* n:"BrtEndPRFItem14", */
    T: -1
  },
  1169: {
    /* n:"BrtBeginCellIgnoreECs14", */
    T: 1
  },
  1170: {
    /* n:"BrtEndCellIgnoreECs14", */
    T: -1
  },
  1171: {
    /* n:"BrtDxf14" */
  },
  1172: {
    /* n:"BrtBeginDxF14s", */
    T: 1
  },
  1173: {
    /* n:"BrtEndDxf14s", */
    T: -1
  },
  1177: {
    /* n:"BrtFilter14" */
  },
  1178: {
    /* n:"BrtBeginCustomFilters14", */
    T: 1
  },
  1180: {
    /* n:"BrtCustomFilter14" */
  },
  1181: {
    /* n:"BrtIconFilter14" */
  },
  1182: {
    /* n:"BrtPivotCacheConnectionName" */
  },
  2048: {
    /* n:"BrtBeginDecoupledPivotCacheIDs", */
    T: 1
  },
  2049: {
    /* n:"BrtEndDecoupledPivotCacheIDs", */
    T: -1
  },
  2050: {
    /* n:"BrtDecoupledPivotCacheID" */
  },
  2051: {
    /* n:"BrtBeginPivotTableRefs", */
    T: 1
  },
  2052: {
    /* n:"BrtEndPivotTableRefs", */
    T: -1
  },
  2053: {
    /* n:"BrtPivotTableRef" */
  },
  2054: {
    /* n:"BrtSlicerCacheBookPivotTables" */
  },
  2055: {
    /* n:"BrtBeginSxvcells", */
    T: 1
  },
  2056: {
    /* n:"BrtEndSxvcells", */
    T: -1
  },
  2057: {
    /* n:"BrtBeginSxRow", */
    T: 1
  },
  2058: {
    /* n:"BrtEndSxRow", */
    T: -1
  },
  2060: {
    /* n:"BrtPcdCalcMem15" */
  },
  2067: {
    /* n:"BrtQsi15" */
  },
  2068: {
    /* n:"BrtBeginWebExtensions", */
    T: 1
  },
  2069: {
    /* n:"BrtEndWebExtensions", */
    T: -1
  },
  2070: {
    /* n:"BrtWebExtension" */
  },
  2071: {
    /* n:"BrtAbsPath15" */
  },
  2072: {
    /* n:"BrtBeginPivotTableUISettings", */
    T: 1
  },
  2073: {
    /* n:"BrtEndPivotTableUISettings", */
    T: -1
  },
  2075: {
    /* n:"BrtTableSlicerCacheIDs" */
  },
  2076: {
    /* n:"BrtTableSlicerCacheID" */
  },
  2077: {
    /* n:"BrtBeginTableSlicerCache", */
    T: 1
  },
  2078: {
    /* n:"BrtEndTableSlicerCache", */
    T: -1
  },
  2079: {
    /* n:"BrtSxFilter15" */
  },
  2080: {
    /* n:"BrtBeginTimelineCachePivotCacheIDs", */
    T: 1
  },
  2081: {
    /* n:"BrtEndTimelineCachePivotCacheIDs", */
    T: -1
  },
  2082: {
    /* n:"BrtTimelineCachePivotCacheID" */
  },
  2083: {
    /* n:"BrtBeginTimelineCacheIDs", */
    T: 1
  },
  2084: {
    /* n:"BrtEndTimelineCacheIDs", */
    T: -1
  },
  2085: {
    /* n:"BrtBeginTimelineCacheID", */
    T: 1
  },
  2086: {
    /* n:"BrtEndTimelineCacheID", */
    T: -1
  },
  2087: {
    /* n:"BrtBeginTimelinesEx", */
    T: 1
  },
  2088: {
    /* n:"BrtEndTimelinesEx", */
    T: -1
  },
  2089: {
    /* n:"BrtBeginTimelineEx", */
    T: 1
  },
  2090: {
    /* n:"BrtEndTimelineEx", */
    T: -1
  },
  2091: {
    /* n:"BrtWorkBookPr15" */
  },
  2092: {
    /* n:"BrtPCDH15" */
  },
  2093: {
    /* n:"BrtBeginTimelineStyle", */
    T: 1
  },
  2094: {
    /* n:"BrtEndTimelineStyle", */
    T: -1
  },
  2095: {
    /* n:"BrtTimelineStyleElement" */
  },
  2096: {
    /* n:"BrtBeginTimelineStylesheetExt15", */
    T: 1
  },
  2097: {
    /* n:"BrtEndTimelineStylesheetExt15", */
    T: -1
  },
  2098: {
    /* n:"BrtBeginTimelineStyles", */
    T: 1
  },
  2099: {
    /* n:"BrtEndTimelineStyles", */
    T: -1
  },
  2100: {
    /* n:"BrtBeginTimelineStyleElements", */
    T: 1
  },
  2101: {
    /* n:"BrtEndTimelineStyleElements", */
    T: -1
  },
  2102: {
    /* n:"BrtDxf15" */
  },
  2103: {
    /* n:"BrtBeginDxfs15", */
    T: 1
  },
  2104: {
    /* n:"BrtEndDxfs15", */
    T: -1
  },
  2105: {
    /* n:"BrtSlicerCacheHideItemsWithNoData" */
  },
  2106: {
    /* n:"BrtBeginItemUniqueNames", */
    T: 1
  },
  2107: {
    /* n:"BrtEndItemUniqueNames", */
    T: -1
  },
  2108: {
    /* n:"BrtItemUniqueName" */
  },
  2109: {
    /* n:"BrtBeginExtConn15", */
    T: 1
  },
  2110: {
    /* n:"BrtEndExtConn15", */
    T: -1
  },
  2111: {
    /* n:"BrtBeginOledbPr15", */
    T: 1
  },
  2112: {
    /* n:"BrtEndOledbPr15", */
    T: -1
  },
  2113: {
    /* n:"BrtBeginDataFeedPr15", */
    T: 1
  },
  2114: {
    /* n:"BrtEndDataFeedPr15", */
    T: -1
  },
  2115: {
    /* n:"BrtTextPr15" */
  },
  2116: {
    /* n:"BrtRangePr15" */
  },
  2117: {
    /* n:"BrtDbCommand15" */
  },
  2118: {
    /* n:"BrtBeginDbTables15", */
    T: 1
  },
  2119: {
    /* n:"BrtEndDbTables15", */
    T: -1
  },
  2120: {
    /* n:"BrtDbTable15" */
  },
  2121: {
    /* n:"BrtBeginDataModel", */
    T: 1
  },
  2122: {
    /* n:"BrtEndDataModel", */
    T: -1
  },
  2123: {
    /* n:"BrtBeginModelTables", */
    T: 1
  },
  2124: {
    /* n:"BrtEndModelTables", */
    T: -1
  },
  2125: {
    /* n:"BrtModelTable" */
  },
  2126: {
    /* n:"BrtBeginModelRelationships", */
    T: 1
  },
  2127: {
    /* n:"BrtEndModelRelationships", */
    T: -1
  },
  2128: {
    /* n:"BrtModelRelationship" */
  },
  2129: {
    /* n:"BrtBeginECTxtWiz15", */
    T: 1
  },
  2130: {
    /* n:"BrtEndECTxtWiz15", */
    T: -1
  },
  2131: {
    /* n:"BrtBeginECTWFldInfoLst15", */
    T: 1
  },
  2132: {
    /* n:"BrtEndECTWFldInfoLst15", */
    T: -1
  },
  2133: {
    /* n:"BrtBeginECTWFldInfo15", */
    T: 1
  },
  2134: {
    /* n:"BrtFieldListActiveItem" */
  },
  2135: {
    /* n:"BrtPivotCacheIdVersion" */
  },
  2136: {
    /* n:"BrtSXDI15" */
  },
  2137: {
    /* n:"BrtBeginModelTimeGroupings", */
    T: 1
  },
  2138: {
    /* n:"BrtEndModelTimeGroupings", */
    T: -1
  },
  2139: {
    /* n:"BrtBeginModelTimeGrouping", */
    T: 1
  },
  2140: {
    /* n:"BrtEndModelTimeGrouping", */
    T: -1
  },
  2141: {
    /* n:"BrtModelTimeGroupingCalcCol" */
  },
  3072: {
    /* n:"BrtUid" */
  },
  3073: {
    /* n:"BrtRevisionPtr" */
  },
  4096: {
    /* n:"BrtBeginDynamicArrayPr", */
    T: 1
  },
  4097: {
    /* n:"BrtEndDynamicArrayPr", */
    T: -1
  },
  5002: {
    /* n:"BrtBeginRichValueBlock", */
    T: 1
  },
  5003: {
    /* n:"BrtEndRichValueBlock", */
    T: -1
  },
  5081: {
    /* n:"BrtBeginRichFilters", */
    T: 1
  },
  5082: {
    /* n:"BrtEndRichFilters", */
    T: -1
  },
  5083: {
    /* n:"BrtRichFilter" */
  },
  5084: {
    /* n:"BrtBeginRichFilterColumn", */
    T: 1
  },
  5085: {
    /* n:"BrtEndRichFilterColumn", */
    T: -1
  },
  5086: {
    /* n:"BrtBeginCustomRichFilters", */
    T: 1
  },
  5087: {
    /* n:"BrtEndCustomRichFilters", */
    T: -1
  },
  5088: {
    /* n:"BrtCustomRichFilter" */
  },
  5089: {
    /* n:"BrtTop10RichFilter" */
  },
  5090: {
    /* n:"BrtDynamicRichFilter" */
  },
  5092: {
    /* n:"BrtBeginRichSortCondition", */
    T: 1
  },
  5093: {
    /* n:"BrtEndRichSortCondition", */
    T: -1
  },
  5094: {
    /* n:"BrtRichFilterDateGroupItem" */
  },
  5095: {
    /* n:"BrtBeginCalcFeatures", */
    T: 1
  },
  5096: {
    /* n:"BrtEndCalcFeatures", */
    T: -1
  },
  5097: {
    /* n:"BrtCalcFeature" */
  },
  5099: {
    /* n:"BrtExternalLinksPr" */
  },
  5100: {
    /* n:"BrtPivotCacheImplicitMeasureSupport" */
  },
  5101: {
    /* n:"BrtPivotFieldIgnorableAfter" */
  },
  5102: {
    /* n:"BrtPivotHierarchyIgnorableAfter" */
  },
  5103: {
    /* n:"BrtPivotDataFieldFutureData" */
  },
  5105: {
    /* n:"BrtPivotCacheRichData" */
  },
  5108: {
    /* n:"BrtExternalLinksAlternateUrls" */
  },
  5109: {
    /* n:"BrtBeginPivotVersionInfo" */
  },
  5110: {
    /* n:"BrtEndPivotVersionInfo" */
  },
  5111: {
    /* n:"BrtBeginCacheVersionInfo" */
  },
  5112: {
    /* n:"BrtEndCacheVersionInfo" */
  },
  5113: {
    /* n:"BrtPivotRequiredFeature" */
  },
  5114: {
    /* n:"BrtPivotLastUsedFeature" */
  },
  5117: {
    /* n:"BrtExternalCodeService" */
  },
  5127: {
    /* n:"BrtShowDataTypeIcons" */
  },
  5130: {
    /* n:"BrtSXDIAggregation" */
  },
  5131: {
    /* n:"BrtPivotFieldFeatureSupportInfo" */
  },
  5132: {
    /* n:"BrtPivotCacheAutoRefresh" */
  },
  5134: {
    /* n:"BrtShowDataTypeIconsUserShView" */
  },
  5135: {
    /* n:"BrtWorkbookCompatibilityVersion" */
  },
  65535: { n: "" }
}, _0 = {
  /* [MS-XLS] 2.3 Record Enumeration 2021-08-17 */
  6: {
    /* n:"Formula", */
    f: a0
  },
  10: {
    /* n:"EOF", */
    f: Mt
  },
  12: {
    /* n:"CalcCount", */
    f: ur
  },
  //
  13: {
    /* n:"CalcMode", */
    f: ur
  },
  //
  14: {
    /* n:"CalcPrecision", */
    f: fr
  },
  //
  15: {
    /* n:"CalcRefMode", */
    f: fr
  },
  //
  16: {
    /* n:"CalcDelta", */
    f: Sr
  },
  //
  17: {
    /* n:"CalcIter", */
    f: fr
  },
  //
  18: {
    /* n:"Protect", */
    f: fr
  },
  19: {
    /* n:"Password", */
    f: ur
  },
  20: {
    /* n:"Header", */
    f: Ii
  },
  21: {
    /* n:"Footer", */
    f: Ii
  },
  23: {
    /* n:"ExternSheet", */
    f: Ac
  },
  24: {
    /* n:"Lbl", */
    f: Oi
  },
  25: {
    /* n:"WinProtect", */
    f: fr
  },
  26: {
    /* n:"VerticalPageBreaks", */
  },
  27: {
    /* n:"HorizontalPageBreaks", */
  },
  28: {
    /* n:"Note", */
    f: Dl
  },
  29: {
    /* n:"Selection", */
  },
  34: {
    /* n:"Date1904", */
    f: fr
  },
  35: {
    /* n:"ExternName", */
    f: Ni
  },
  38: {
    /* n:"LeftMargin", */
    f: Sr
  },
  // *
  39: {
    /* n:"RightMargin", */
    f: Sr
  },
  // *
  40: {
    /* n:"TopMargin", */
    f: Sr
  },
  // *
  41: {
    /* n:"BottomMargin", */
    f: Sr
  },
  // *
  42: {
    /* n:"PrintRowCol", */
    f: fr
  },
  43: {
    /* n:"PrintGrid", */
    f: fr
  },
  47: {
    /* n:"FilePass", */
    f: Ih
  },
  49: {
    /* n:"Font", */
    f: il
  },
  51: {
    /* n:"PrintSize", */
    f: ur
  },
  60: {
    /* n:"Continue", */
  },
  61: {
    /* n:"Window1", */
    f: tl
  },
  64: {
    /* n:"Backup", */
    f: fr
  },
  65: {
    /* n:"Pane", */
    f: nl
  },
  66: {
    /* n:"CodePage", */
    f: ur
  },
  77: {
    /* n:"Pls", */
  },
  80: {
    /* n:"DCon", */
  },
  81: {
    /* n:"DConRef", */
  },
  82: {
    /* n:"DConName", */
  },
  85: {
    /* n:"DefColWidth", */
    f: ur
  },
  89: {
    /* n:"XCT", */
  },
  90: {
    /* n:"CRN", */
  },
  91: {
    /* n:"FileSharing", */
  },
  92: {
    /* n:"WriteAccess", */
    f: jo
  },
  93: {
    /* n:"Obj", */
    f: yl
  },
  94: {
    /* n:"Uncalced", */
  },
  95: {
    /* n:"CalcSaveRecalc", */
    f: fr
  },
  //
  96: {
    /* n:"Template", */
  },
  97: {
    /* n:"Intl", */
  },
  99: {
    /* n:"ObjProtect", */
    f: fr
  },
  125: {
    /* n:"ColInfo", */
    f: Tc
  },
  128: {
    /* n:"Guts", */
    f: ml
  },
  129: {
    /* n:"WsBool", */
    f: Ko
  },
  130: {
    /* n:"GridSet", */
    f: ur
  },
  131: {
    /* n:"HCenter", */
    f: fr
  },
  132: {
    /* n:"VCenter", */
    f: fr
  },
  133: {
    /* n:"BoundSheet8", */
    f: Yo
  },
  134: {
    /* n:"WriteProtect", */
  },
  140: {
    /* n:"Country", */
    f: Rl
  },
  141: {
    /* n:"HideObj", */
    f: ur
  },
  144: {
    /* n:"Sort", */
  },
  146: {
    /* n:"Palette", */
    f: Ll
  },
  151: {
    /* n:"Sync", */
  },
  152: {
    /* n:"LPr", */
  },
  153: {
    /* n:"DxGCol", */
  },
  154: {
    /* n:"FnGroupName", */
  },
  155: {
    /* n:"FilterMode", */
  },
  156: {
    /* n:"BuiltInFnGroupCount", */
    f: ur
  },
  157: {
    /* n:"AutoFilterInfo", */
  },
  158: {
    /* n:"AutoFilter", */
  },
  160: {
    /* n:"Scl", */
    f: Vl
  },
  161: {
    /* n:"Setup", */
    f: Pl
  },
  174: {
    /* n:"ScenMan", */
  },
  175: {
    /* n:"SCENARIO", */
  },
  176: {
    /* n:"SxView", */
  },
  177: {
    /* n:"Sxvd", */
  },
  178: {
    /* n:"SXVI", */
  },
  180: {
    /* n:"SxIvd", */
  },
  181: {
    /* n:"SXLI", */
  },
  182: {
    /* n:"SXPI", */
  },
  184: {
    /* n:"DocRoute", */
  },
  185: {
    /* n:"RecipName", */
  },
  189: {
    /* n:"MulRk", */
    f: ll
  },
  190: {
    /* n:"MulBlank", */
    f: hl
  },
  193: {
    /* n:"Mms", */
    f: Mt
  },
  197: {
    /* n:"SXDI", */
  },
  198: {
    /* n:"SXDB", */
  },
  199: {
    /* n:"SXFDB", */
  },
  200: {
    /* n:"SXDBB", */
  },
  201: {
    /* n:"SXNum", */
  },
  202: {
    /* n:"SxBool", */
    f: fr
  },
  203: {
    /* n:"SxErr", */
  },
  204: {
    /* n:"SXInt", */
  },
  205: {
    /* n:"SXString", */
  },
  206: {
    /* n:"SXDtr", */
  },
  207: {
    /* n:"SxNil", */
  },
  208: {
    /* n:"SXTbl", */
  },
  209: {
    /* n:"SXTBRGIITM", */
  },
  210: {
    /* n:"SxTbpg", */
  },
  211: {
    /* n:"ObProj", */
  },
  213: {
    /* n:"SXStreamID", */
  },
  215: {
    /* n:"DBCell", */
  },
  216: {
    /* n:"SXRng", */
  },
  217: {
    /* n:"SxIsxoper", */
  },
  218: {
    /* n:"BookBool", */
    f: ur
  },
  220: {
    /* n:"DbOrParamQry", */
  },
  221: {
    /* n:"ScenarioProtect", */
    f: fr
  },
  222: {
    /* n:"OleObjectSize", */
  },
  224: {
    /* n:"XF", */
    f: xl
  },
  225: {
    /* n:"InterfaceHdr", */
    f: $o
  },
  226: {
    /* n:"InterfaceEnd", */
    f: Mt
  },
  227: {
    /* n:"SXVS", */
  },
  229: {
    /* n:"MergeCells", */
    f: Cl
  },
  233: {
    /* n:"BkHim", */
  },
  235: {
    /* n:"MsoDrawingGroup", */
    f: P1
  },
  236: {
    /* n:"MsoDrawing", */
    f: U1
  },
  237: {
    /* n:"MsoDrawingSelection", */
  },
  239: {
    /* n:"PhoneticInfo", */
  },
  240: {
    /* n:"SxRule", */
  },
  241: {
    /* n:"SXEx", */
  },
  242: {
    /* n:"SxFilt", */
  },
  244: {
    /* n:"SxDXF", */
  },
  245: {
    /* n:"SxItm", */
  },
  246: {
    /* n:"SxName", */
  },
  247: {
    /* n:"SxSelect", */
  },
  248: {
    /* n:"SXPair", */
  },
  249: {
    /* n:"SxFmla", */
  },
  251: {
    /* n:"SxFormat", */
  },
  252: {
    /* n:"SST", */
    f: Jo
  },
  253: {
    /* n:"LabelSst", */
    f: sl
  },
  255: {
    /* n:"ExtSST", */
    f: Zo
  },
  256: {
    /* n:"SXVDEx", */
  },
  259: {
    /* n:"SXFormula", */
  },
  290: {
    /* n:"SXDBEx", */
  },
  311: {
    /* n:"RRDInsDel", */
  },
  312: {
    /* n:"RRDHead", */
  },
  315: {
    /* n:"RRDChgCell", */
  },
  317: {
    /* n:"RRTabId", */
    f: pc
  },
  318: {
    /* n:"RRDRenSheet", */
  },
  319: {
    /* n:"RRSort", */
  },
  320: {
    /* n:"RRDMove", */
  },
  330: {
    /* n:"RRFormat", */
  },
  331: {
    /* n:"RRAutoFmt", */
  },
  333: {
    /* n:"RRInsertSh", */
  },
  334: {
    /* n:"RRDMoveBegin", */
  },
  335: {
    /* n:"RRDMoveEnd", */
  },
  336: {
    /* n:"RRDInsDelBegin", */
  },
  337: {
    /* n:"RRDInsDelEnd", */
  },
  338: {
    /* n:"RRDConflict", */
  },
  339: {
    /* n:"RRDDefName", */
  },
  340: {
    /* n:"RRDRstEtxp", */
  },
  351: {
    /* n:"LRng", */
  },
  352: {
    /* n:"UsesELFs", */
    f: fr
  },
  353: {
    /* n:"DSF", */
    f: Mt
  },
  401: {
    /* n:"CUsr", */
  },
  402: {
    /* n:"CbUsr", */
  },
  403: {
    /* n:"UsrInfo", */
  },
  404: {
    /* n:"UsrExcl", */
  },
  405: {
    /* n:"FileLock", */
  },
  406: {
    /* n:"RRDInfo", */
  },
  407: {
    /* n:"BCUsrs", */
  },
  408: {
    /* n:"UsrChk", */
  },
  425: {
    /* n:"UserBView", */
  },
  426: {
    /* n:"UserSViewBegin", */
  },
  427: {
    /* n:"UserSViewEnd", */
  },
  428: {
    /* n:"RRDUserView", */
  },
  429: {
    /* n:"Qsi", */
  },
  430: {
    /* n:"SupBook", */
    f: wl
  },
  431: {
    /* n:"Prot4Rev", */
    f: fr
  },
  432: {
    /* n:"CondFmt", */
  },
  433: {
    /* n:"CF", */
  },
  434: {
    /* n:"DVal", */
  },
  437: {
    /* n:"DConBin", */
  },
  438: {
    /* n:"TxO", */
    f: Il
  },
  439: {
    /* n:"RefreshAll", */
    f: fr
  },
  //
  440: {
    /* n:"HLink", */
    f: Nl
  },
  441: {
    /* n:"Lel", */
  },
  442: {
    /* n:"CodeName", */
    f: sn
  },
  443: {
    /* n:"SXFDBType", */
  },
  444: {
    /* n:"Prot4RevPass", */
    f: ur
  },
  445: {
    /* n:"ObNoMacros", */
  },
  446: {
    /* n:"Dv", */
  },
  448: {
    /* n:"Excel9File", */
    f: Mt
  },
  449: {
    /* n:"RecalcId", */
    f: rl,
    r: 2
  },
  450: {
    /* n:"EntExU2", */
    f: Mt
  },
  512: {
    /* n:"Dimensions", */
    f: bi
  },
  513: {
    /* n:"Blank", */
    f: Hl
  },
  515: {
    /* n:"Number", */
    f: El
  },
  516: {
    /* n:"Label", */
    f: cl
  },
  517: {
    /* n:"BoolErr", */
    f: _l
  },
  519: {
    /* n:"String", */
    f: Wl
  },
  520: {
    /* n:"Row", */
    f: Qo
  },
  523: {
    /* n:"Index", */
  },
  545: {
    /* n:"Array", */
    f: Bi
  },
  549: {
    /* n:"DefaultRowHeight", */
    f: Si
  },
  566: {
    /* n:"Table", */
  },
  574: {
    /* n:"Window2", */
    f: al
  },
  638: {
    /* n:"RK", */
    f: ol
  },
  659: {
    /* n:"Style", */
  },
  1048: {
    /* n:"BigName", */
  },
  1054: {
    /* n:"Format", */
    f: ul
  },
  1084: {
    /* n:"ContinueBigName", */
  },
  1212: {
    /* n:"ShrFmla", */
    f: Tl
  },
  2048: {
    /* n:"HLinkTooltip", */
    f: Ol
  },
  2049: {
    /* n:"WebPub", */
  },
  2050: {
    /* n:"QsiSXTag", */
  },
  2051: {
    /* n:"DBQueryExt", */
  },
  2052: {
    /* n:"ExtString", */
  },
  2053: {
    /* n:"TxtQry", */
  },
  2054: {
    /* n:"Qsir", */
  },
  2055: {
    /* n:"Qsif", */
  },
  2056: {
    /* n:"RRDTQSIF", */
  },
  2057: {
    /* n:"BOF", */
    f: gn
  },
  2058: {
    /* n:"OleDbConn", */
  },
  2059: {
    /* n:"WOpt", */
  },
  2060: {
    /* n:"SXViewEx", */
  },
  2061: {
    /* n:"SXTH", */
  },
  2062: {
    /* n:"SXPIEx", */
  },
  2063: {
    /* n:"SXVDTEx", */
  },
  2064: {
    /* n:"SXViewEx9", */
  },
  2066: {
    /* n:"ContinueFrt", */
  },
  2067: {
    /* n:"RealTimeData", */
  },
  2128: {
    /* n:"ChartFrtInfo", */
  },
  2129: {
    /* n:"FrtWrapper", */
  },
  2130: {
    /* n:"StartBlock", */
  },
  2131: {
    /* n:"EndBlock", */
  },
  2132: {
    /* n:"StartObject", */
  },
  2133: {
    /* n:"EndObject", */
  },
  2134: {
    /* n:"CatLab", */
  },
  2135: {
    /* n:"YMult", */
  },
  2136: {
    /* n:"SXViewLink", */
  },
  2137: {
    /* n:"PivotChartBits", */
  },
  2138: {
    /* n:"FrtFontList", */
  },
  2146: {
    /* n:"SheetExt", */
  },
  2147: {
    /* n:"BookExt", */
    r: 12
  },
  2148: {
    /* n:"SXAddl", */
  },
  2149: {
    /* n:"CrErr", */
  },
  2150: {
    /* n:"HFPicture", */
  },
  2151: {
    /* n:"FeatHdr", */
    f: Mt
  },
  2152: {
    /* n:"Feat", */
  },
  2154: {
    /* n:"DataLabExt", */
  },
  2155: {
    /* n:"DataLabExtContents", */
  },
  2156: {
    /* n:"CellWatch", */
  },
  2161: {
    /* n:"FeatHdr11", */
  },
  2162: {
    /* n:"Feature11", */
  },
  2164: {
    /* n:"DropDownObjIds", */
  },
  2165: {
    /* n:"ContinueFrt11", */
  },
  2166: {
    /* n:"DConn", */
  },
  2167: {
    /* n:"List12", */
  },
  2168: {
    /* n:"Feature12", */
  },
  2169: {
    /* n:"CondFmt12", */
  },
  2170: {
    /* n:"CF12", */
  },
  2171: {
    /* n:"CFEx", */
  },
  2172: {
    /* n:"XFCRC", */
    f: Ml,
    r: 12
  },
  2173: {
    /* n:"XFExt", */
    f: k1,
    r: 12
  },
  2174: {
    /* n:"AutoFilter12", */
  },
  2175: {
    /* n:"ContinueFrt12", */
  },
  2180: {
    /* n:"MDTInfo", */
  },
  2181: {
    /* n:"MDXStr", */
  },
  2182: {
    /* n:"MDXTuple", */
  },
  2183: {
    /* n:"MDXSet", */
  },
  2184: {
    /* n:"MDXProp", */
  },
  2185: {
    /* n:"MDXKPI", */
  },
  2186: {
    /* n:"MDB", */
  },
  2187: {
    /* n:"PLV", */
  },
  2188: {
    /* n:"Compat12", */
    f: fr,
    r: 12
  },
  2189: {
    /* n:"DXF", */
  },
  2190: {
    /* n:"TableStyles", */
    r: 12
  },
  2191: {
    /* n:"TableStyle", */
  },
  2192: {
    /* n:"TableStyleElement", */
  },
  2194: {
    /* n:"StyleExt", */
  },
  2195: {
    /* n:"NamePublish", */
  },
  2196: {
    /* n:"NameCmt", */
    f: Al,
    r: 12
  },
  2197: {
    /* n:"SortData", */
  },
  2198: {
    /* n:"Theme", */
    f: _1,
    r: 12
  },
  2199: {
    /* n:"GUIDTypeLib", */
  },
  2200: {
    /* n:"FnGrp12", */
  },
  2201: {
    /* n:"NameFnGrp12", */
  },
  2202: {
    /* n:"MTRSettings", */
    f: Fl,
    r: 12
  },
  2203: {
    /* n:"CompressPictures", */
    f: Mt
  },
  2204: {
    /* n:"HeaderFooter", */
  },
  2205: {
    /* n:"CrtLayout12", */
  },
  2206: {
    /* n:"CrtMlFrt", */
  },
  2207: {
    /* n:"CrtMlFrtContinue", */
  },
  2211: {
    /* n:"ForceFullCalculation", */
    f: el
  },
  2212: {
    /* n:"ShapePropsStream", */
  },
  2213: {
    /* n:"TextPropsStream", */
  },
  2214: {
    /* n:"RichTextStream", */
  },
  2215: {
    /* n:"CrtLayout12A", */
  },
  4097: {
    /* n:"Units", */
  },
  4098: {
    /* n:"Chart", */
    f: dp
  },
  4099: {
    /* n:"Series", */
    f: xp
  },
  4102: {
    /* n:"DataFormat", */
  },
  4103: {
    /* n:"LineFormat", */
  },
  4105: {
    /* n:"MarkerFormat", */
  },
  4106: {
    /* n:"AreaFormat", */
  },
  4107: {
    /* n:"PieFormat", */
  },
  4108: {
    /* n:"AttachedLabel", */
  },
  4109: {
    /* n:"SeriesText", */
    f: pp
  },
  4116: {
    /* n:"ChartFormat", */
  },
  4117: {
    /* n:"Legend", */
    f: vp
  },
  4118: {
    /* n:"SeriesList", */
  },
  4119: {
    /* n:"Bar", */
    f: Ep
  },
  4120: {
    /* n:"Line", */
    f: wp
  },
  4121: {
    /* n:"Pie", */
    f: Ap
  },
  4122: {
    /* n:"Area", */
    f: Tp
  },
  4123: {
    /* n:"Scatter", */
    f: Fp
  },
  4124: {
    /* n:"CrtLine", */
  },
  4125: {
    /* n:"Axis", */
    f: gp
  },
  4126: {
    /* n:"Tick", */
  },
  4127: {
    /* n:"ValueRange", */
  },
  4128: {
    /* n:"CatSerRange", */
  },
  4129: {
    /* n:"AxisLine", */
  },
  4130: {
    /* n:"CrtLink", */
  },
  4132: {
    /* n:"DefaultText", */
  },
  4133: {
    /* n:"Text", */
    f: mp
  },
  4134: {
    /* n:"FontX", */
    f: ur
  },
  4135: {
    /* n:"ObjectLink", */
  },
  4146: {
    /* n:"Frame", */
  },
  4147: {
    /* n:"Begin", */
  },
  4148: {
    /* n:"End", */
  },
  4149: {
    /* n:"PlotArea", */
  },
  4154: {
    /* n:"Chart3d", */
  },
  4156: {
    /* n:"PicF", */
  },
  4157: {
    /* n:"DropBar", */
  },
  4158: {
    /* n:"Radar", */
    f: kp
  },
  4159: {
    /* n:"Surf", */
    f: Dp
  },
  4160: {
    /* n:"RadarArea", */
  },
  4161: {
    /* n:"AxisParent", */
  },
  4163: {
    /* n:"LegendException", */
  },
  4164: {
    /* n:"ShtProps", */
    f: Ul
  },
  4165: {
    /* n:"SerToCrt", */
  },
  4166: {
    /* n:"AxesUsed", */
  },
  4168: {
    /* n:"SBaseRef", */
  },
  4170: {
    /* n:"SerParent", */
  },
  4171: {
    /* n:"SerAuxTrend", */
  },
  4174: {
    /* n:"IFmtRecord", */
  },
  4175: {
    /* n:"Pos", */
  },
  4176: {
    /* n:"AlRuns", */
  },
  4177: {
    /* n:"BRAI", */
    f: _p
  },
  4187: {
    /* n:"SerAuxErrBar", */
  },
  4188: {
    /* n:"ClrtClient", */
    f: Bl
  },
  4189: {
    /* n:"SerFmt", */
  },
  4191: {
    /* n:"Chart3DBarShape", */
  },
  4192: {
    /* n:"Fbi", */
  },
  4193: {
    /* n:"BopPop", */
  },
  4194: {
    /* n:"AxcExt", */
  },
  4195: {
    /* n:"Dat", */
  },
  4196: {
    /* n:"PlotGrowth", */
  },
  4197: {
    /* n:"SIIndex", */
  },
  4198: {
    /* n:"GelFrame", */
  },
  4199: {
    /* n:"BopPopCustom", */
  },
  4200: {
    /* n:"Fbi2", */
  },
  0: {
    /* n:"Dimensions", */
    f: bi
  },
  1: {
    /* n:"BIFF2BLANK", */
  },
  2: {
    /* n:"BIFF2INT", */
    f: ql
  },
  3: {
    /* n:"BIFF2NUM", */
    f: zl
  },
  4: {
    /* n:"BIFF2STR", */
    f: Xl
  },
  5: {
    /* n:"BIFF2BOOLERR", */
    f: jl
  },
  7: {
    /* n:"String", */
    f: $l
  },
  8: {
    /* n:"BIFF2ROW", */
  },
  9: {
    /* n:"BOF", */
    f: gn
  },
  11: {
    /* n:"Index", */
  },
  22: {
    /* n:"ExternCount", */
    f: ur
  },
  30: {
    /* n:"BIFF2FORMAT", */
    f: fl
  },
  31: {
    /* n:"BIFF2FMTCNT", */
  },
  /* 16-bit cnt of BIFF2FORMAT records */
  32: {
    /* n:"BIFF2COLINFO", */
  },
  33: {
    /* n:"Array", */
    f: Bi
  },
  36: {
    /* n:"COLWIDTH", */
  },
  37: {
    /* n:"DefaultRowHeight", */
    f: Si
  },
  // 0x002c ??
  // 0x002d ??
  // 0x002e ??
  // 0x0030 FONTCOUNT: number of fonts
  50: {
    /* n:"BIFF2FONTXTRA", */
    f: Kl
  },
  // 0x0035: INFOOPTS
  // 0x0036: TABLE (BIFF2 only)
  // 0x0037: TABLE2 (BIFF2 only)
  // 0x0038: WNDESK
  // 0x0039 ??
  // 0x003a: BEGINPREF
  // 0x003b: ENDPREF
  62: {
    /* n:"BIFF2WINDOW2", */
  },
  // 0x003f ??
  // 0x0046: SHOWSCROLL
  // 0x0047: SHOWFORMULA
  // 0x0048: STATUSBAR
  // 0x0049: SHORTMENUS
  // 0x004A:
  // 0x004B:
  // 0x004C:
  // 0x004E:
  // 0x004F:
  // 0x0058: TOOLBAR (BIFF3)
  /* - - - */
  52: {
    /* n:"DDEObjName", */
  },
  67: {
    /* n:"BIFF2XF", */
    f: pl
  },
  68: {
    /* n:"BIFF2XFINDEX", */
    f: ur
  },
  69: {
    /* n:"BIFF2FONTCLR", */
  },
  86: {
    /* n:"BIFF4FMTCNT", */
  },
  /* 16-bit cnt, similar to BIFF2 */
  126: {
    /* n:"RK", */
  },
  /* Not necessarily same as 0x027e */
  127: {
    /* n:"ImData", */
    f: Gl
  },
  135: {
    /* n:"Addin", */
  },
  136: {
    /* n:"Edg", */
  },
  137: {
    /* n:"Pub", */
  },
  // 0x8A
  // 0x8B LH: alternate menu key flag (BIFF3/4)
  // 0x8E
  143: {
    /* n:"BIFF4SheetInfo", */
    f: Jl
  },
  145: {
    /* n:"Sub", */
  },
  // 0x93 STYLE
  148: {
    /* n:"LHRecord", */
  },
  149: {
    /* n:"LHNGraph", */
  },
  150: {
    /* n:"Sound", */
  },
  // 0xA2 FNPROTO: function prototypes (BIFF4)
  // 0xA3
  // 0xA8
  169: {
    /* n:"CoordList", */
  },
  171: {
    /* n:"GCW", */
  },
  188: {
    /* n:"ShrFmla", */
  },
  /* Not necessarily same as 0x04bc */
  191: {
    /* n:"ToolbarHdr", */
  },
  192: {
    /* n:"ToolbarEnd", */
  },
  194: {
    /* n:"AddMenu", */
  },
  195: {
    /* n:"DelMenu", */
  },
  214: {
    /* n:"RString", */
    f: Yl
  },
  223: {
    /* n:"UDDesc", */
  },
  234: {
    /* n:"TabIdConf", */
  },
  354: {
    /* n:"XL5Modify", */
  },
  421: {
    /* n:"FileSharing2", */
  },
  518: {
    /* n:"Formula", */
    f: a0
  },
  521: {
    /* n:"BOF", */
    f: gn
  },
  536: {
    /* n:"Lbl", */
    f: Oi
  },
  547: {
    /* n:"ExternName", */
    f: Ni
  },
  561: {
    /* n:"Font", */
  },
  579: {
    /* n:"BIFF3XF", */
    f: vl
  },
  1030: {
    /* n:"Formula", */
    f: a0
  },
  1033: {
    /* n:"BOF", */
    f: gn
  },
  1091: {
    /* n:"BIFF4XF", */
    f: gl
  },
  2157: {
    /* n:"FeatInfo", */
  },
  2163: {
    /* n:"FeatInfo11", */
  },
  2177: {
    /* n:"SXAddl12", */
  },
  2240: {
    /* n:"AutoWebPub", */
  },
  2241: {
    /* n:"ListObj", */
  },
  2242: {
    /* n:"ListField", */
  },
  2243: {
    /* n:"ListDV", */
  },
  2244: {
    /* n:"ListCondFmt", */
  },
  2245: {
    /* n:"ListCF", */
  },
  2246: {
    /* n:"FMQry", */
  },
  2247: {
    /* n:"FMSQry", */
  },
  2248: {
    /* n:"PLV", */
  },
  2249: {
    /* n:"LnExt", */
  },
  2250: {
    /* n:"MkrExt", */
  },
  2251: {
    /* n:"CrtCoopt", */
  },
  2262: {
    /* n:"FRTArchId$", */
    r: 12
  },
  /* --- multiplan 4 records --- */
  101: {
    /* n:"", */
  },
  // one per window
  102: {
    /* n:"", */
  },
  // calc settings
  105: {
    /* n:"", */
  },
  // print header
  106: {
    /* n:"", */
  },
  // print footer
  107: {
    /* n:"", */
  },
  // print settings
  109: {
    /* n:"", */
  },
  // one per window
  112: {
    /* n:"", */
  },
  // includes default col width
  114: {
    /* n:"", */
  },
  // includes selected cell
  29282: {}
};
function Vr(e, t, r, a) {
  var n = t;
  if (!isNaN(n)) {
    var i = (r || []).length || 0, c = e.next(4);
    c.write_shift(2, n), c.write_shift(2, i), /*:: len != null &&*/
    i > 0 && nc(r) && e.push(r);
  }
}
function Zi(e, t) {
  var r = t || {}, a = r.dense != null ? r.dense : Fu, n = {};
  a && (n["!data"] = []), e = an(e, "<!--", "-->");
  var i = e.match(/<table/i);
  if (!i) throw new Error("Invalid HTML: could not find <table>");
  var c = e.match(/<\/table/i), s = i.index, u = c && c.index || e.length, f = df(e.slice(s, u), /(:?<tr[^<>]*>)/i, "<tr>"), o = -1, l = 0, x = 0, h = 0, g = { s: { r: 1e7, c: 1e7 }, e: { r: 0, c: 0 } }, _ = [];
  for (s = 0; s < f.length; ++s) {
    var d = f[s].trim(), p = d.slice(0, 3).toLowerCase();
    if (p == "<tr") {
      if (++o, r.sheetRows && r.sheetRows <= o) {
        --o;
        break;
      }
      l = 0;
      continue;
    }
    if (!(p != "<td" && p != "<th")) {
      var w = d.split(/<\/t[dh]>/i);
      for (u = 0; u < w.length; ++u) {
        var m = w[u].trim();
        if (m.match(/<t[dh]/i)) {
          for (var y = m, M = 0; y.charAt(0) == "<" && (M = y.indexOf(">")) > -1; ) y = y.slice(M + 1);
          for (var W = 0; W < _.length; ++W) {
            var I = _[W];
            I.s.c == l && I.s.r < o && o <= I.e.r && (l = I.e.c + 1, W = -1);
          }
          var L = Ee(m.slice(0, m.indexOf(">")));
          h = L.colspan ? +L.colspan : 1, ((x = +L.rowspan) > 1 || h > 1) && _.push({ s: { r: o, c: l }, e: { r: o + (x || 1) - 1, c: l + h - 1 } });
          var A = L.t || L["data-t"] || "";
          if (!y.length) {
            l += h;
            continue;
          }
          if (y = zs(y), g.s.r > o && (g.s.r = o), g.e.r < o && (g.e.r = o), g.s.c > l && (g.s.c = l), g.e.c < l && (g.e.c = l), !y.length) {
            l += h;
            continue;
          }
          var N = { t: "s", v: y };
          r.raw || !y.trim().length || A == "s" || (y === "TRUE" ? N = { t: "b", v: !0 } : y === "FALSE" ? N = { t: "b", v: !1 } : isNaN(zr(y)) ? isNaN(Ka(y).getDate()) ? y.charCodeAt(0) == 35 && Tr[y] != null && (N.t = "e", N.w = y, N.v = Tr[y]) : (N = { t: "d", v: kr(y) }, r.UTC === !1 && (N.v = sa(N.v)), r.cellDates || (N = { t: "n", v: mr(N.v) }), N.z = r.dateNF || Le[14]) : N = { t: "n", v: zr(y) }), N.cellText !== !1 && (N.w = y), a ? (n["!data"][o] || (n["!data"][o] = []), n["!data"][o][l] = N) : n[Ge({ r: o, c: l })] = N, l += h;
        }
      }
    }
  }
  return n["!ref"] = He(g), _.length && (n["!merges"] = _), n;
}
function Sp(e) {
  return Ff(String(e).replace(/"/g, "'"));
}
function Ma(e) {
  return e && e.rgb ? "#" + String(e.rgb).slice(-6) : "";
}
function bp(e) {
  return e ? "'" + Sp(e).replace(/'/g, "\\'") + "'" : "";
}
function Ip(e) {
  switch (e) {
    case "dashDot":
    case "dashDotDot":
    case "dashed":
    case "mediumDashed":
      return "dashed";
    case "dotted":
    case "hair":
      return "dotted";
    case "double":
      return "double";
    case "none":
      return "none";
    default:
      return "solid";
  }
}
function Np(e) {
  switch (e) {
    case "medium":
    case "mediumDashDot":
    case "mediumDashDotDot":
    case "mediumDashed":
      return "2px";
    case "thick":
      return "3px";
    case "hair":
      return "1px";
    default:
      return "1px";
  }
}
function An(e, t, r) {
  if (!(!r || !r.style || r.style == "none")) {
    var a = Ma(r.color) || "#000000";
    e.push("border-" + t + ":" + Np(r.style) + " " + Ip(r.style) + " " + a);
  }
}
function Op(e, t) {
  if (!t || !t.cellStyles || !e || !e.s) return "";
  var r = e.s, a = [], n = r.font || {};
  n.name && a.push("font-family:" + bp(n.name)), n.sz && a.push("font-size:" + n.sz + "pt"), n.bold && a.push("font-weight:bold"), n.italic && a.push("font-style:italic");
  var i = [];
  n.underline && i.push("underline"), n.strike && i.push("line-through"), i.length && a.push("text-decoration:" + i.join(" ")), n.color && Ma(n.color) && a.push("color:" + Ma(n.color));
  var c = r.fill || r, s = "";
  c.patternType != "none" && c.patternType != "gray125" && (s = Ma(c.fgColor) || Ma(c.bgColor)), s && a.push("background-color:" + s);
  var u = r.alignment || {};
  if (u.horizontal && a.push("text-align:" + u.horizontal), u.vertical && a.push("vertical-align:" + u.vertical), u.textRotation != null && u.textRotation !== 0) {
    var f = u.textRotation == 255 ? 90 : u.textRotation > 90 ? 90 - u.textRotation : u.textRotation;
    a.push("transform:rotate(" + f + "deg)"), a.push("transform-origin:center");
  }
  var o = r.border || {};
  return An(a, "left", o.left || o.start), An(a, "right", o.right || o.end), An(a, "top", o.top), An(a, "bottom", o.bottom), a.join(";");
}
function Rp(e, t, r, a, n) {
  if (!t || !e) return "";
  var i = e.s || {}, c = i.alignment || {}, s = [];
  if ((t.browserPixels || t.autoFit) && s.push("box-sizing:border-box;padding:0 2px;min-width:0"), c.wrapText ? s.push("white-space:pre-wrap;overflow-wrap:normal;word-break:normal") : (s.push("white-space:pre"), c.shrinkToFit || t.overflow == "clip" || t.overflow == "hidden" ? s.push("overflow:hidden;text-overflow:clip") : s.push("overflow:visible")), c.shrinkToFit && n && r != null) {
    for (var u = 0, f = a || 1, o = 0; o < f; ++o) u += Mn(n[r + o]);
    var l = Ic(e, i, t);
    if (u > 0 && l > u) {
      var x = Math.max(0.25, Math.min(1, u / l));
      s.push("font-size:" + Math.max(1, Ja(i) * x) + "pt");
    }
  }
  return s.join(";");
}
function Mn(e) {
  return Sc(e);
}
function E0(e) {
  return e ? e.hpx != null ? e.hpx : e.hpt != null ? Qa(e.hpt) : 20 : 20;
}
function Bp(e, t, r, a) {
  for (var n = e["!merges"] || [], i = [], c = {}, s = e["!data"] != null, u = (e["!rows"] || [])[r], f = a && a._htmlCols || e["!cols"] || [], o = t.s.c; o <= t.e.c; ++o) {
    for (var l = 0, x = 0, h = 0; h < n.length; ++h)
      if (!(n[h].s.r > r || n[h].s.c > o) && !(n[h].e.r < r || n[h].e.c < o)) {
        if (n[h].s.r < r || n[h].s.c < o) {
          l = -1;
          break;
        }
        l = n[h].e.r - n[h].s.r + 1, x = n[h].e.c - n[h].s.c + 1;
        break;
      }
    if (!(l < 0)) {
      var g = Je(o) + er(r), _ = s ? (e["!data"][r] || [])[o] : e[g], d = _;
      if (_ && _.t == "n" && _.v != null && !isFinite(_.v) && (isNaN(_.v) ? _ = { t: "e", v: 36, w: Ur[36] } : _ = { t: "e", v: 7, w: Ur[7] }, d = _), a.cellStyles) {
        var p = {};
        f[o] && f[o].s && St(p, f[o].s), u && u.s && St(p, u.s), _ && _.s && St(p, _.s), br(p).length && (d = _ ? Ze(_) : { t: "z" }, d.s = p);
      }
      var w = _ && _.v != null && (_.h || Ft(_.w || (Ot(_), _.w) || "")) || "";
      c = {}, l > 1 && (c.rowspan = l), x > 1 && (c.colspan = x), a.editable ? w = '<span contenteditable="true">' + w + "</span>" : _ && (c["data-t"] = _ && _.t || "z", _.v != null && (c["data-v"] = Ft(_.v instanceof Date ? _.v.toISOString() : _.v)), _.z != null && (c["data-z"] = _.z), _.f != null && (c["data-f"] = Ft(_.f)), _.l && (_.l.Target || "#").charAt(0) != "#" && (!a.sanitizeLinks || (_.l.Target || "").slice(0, 11).toLowerCase() != "javascript:") && (w = '<a href="' + Ft(_.l.Target) + '">' + w + "</a>"));
      var m = Op(d, a), y = Rp(d, a, o, x, f);
      y && (m = m ? m + ";" + y : y), m && (c.style = m), c.id = (a.id || "sjs") + "-" + g, i.push(Nn("td", w, c));
    }
  }
  var M = {}, W = [];
  return u && (u.hidden && W.push("display:none"), a.browserPixels && W.push("height:" + E0(u) + "px")), W.length && (M.style = W.join(";")), Nn("tr", i.join(""), M);
}
var Lp = '<html><head><meta charset="utf-8"/><title>SheetJS Table Export</title></head><body>', Mp = "</body></html>";
function Pp(e, t) {
  var r = vf(e, "table");
  if (!r || r.length == 0) throw new Error("Invalid HTML: could not find <table>");
  if (r.length == 1) {
    var a = qt(Zi(r[0], t), t);
    return a.bookType = "html", a;
  }
  var n = Y0();
  return r.forEach(function(i, c) {
    on(n, Zi(i, t), "Sheet" + (c + 1));
  }), n.bookType = "html", n;
}
var ma = 9525;
function Qi(e, t, r) {
  for (var a = { left: 0, top: 0, width: 480, height: 288 }, n = r && r._htmlCols || e["!cols"] || [], i = e["!rows"] || [], c = t && t.from || { col: 0, row: 0, colOff: 0, rowOff: 0 }, s = t && t.to, u = 0; u < (c.col || 0); ++u) a.left += Mn(n[u]);
  for (var f = 0; f < (c.row || 0); ++f) a.top += E0(i[f]);
  if (a.left += (c.colOff || 0) / ma, a.top += (c.rowOff || 0) / ma, s) {
    var o = 0, l = 0;
    for (u = 0; u < (s.col || 0); ++u) o += Mn(n[u]);
    for (f = 0; f < (s.row || 0); ++f) l += E0(i[f]);
    o += (s.colOff || 0) / ma, l += (s.rowOff || 0) / ma, a.width = Math.max(1, o - a.left), a.height = Math.max(1, l - a.top);
  } else t && t.ext && (t.ext.cx && (a.width = t.ext.cx / ma), t.ext.cy && (a.height = t.ext.cy / ma));
  return a;
}
function es(e) {
  return "position:absolute;left:" + Math.round(e.left) + "px;top:" + Math.round(e.top) + "px;width:" + Math.round(e.width) + "px;height:" + Math.round(e.height) + "px";
}
function Tn(e) {
  return e ? e.val && e.val.values ? e.val.values : e.yVal && e.yVal.values ? e.yVal.values : e.data && e.data.length ? e.data : [] : [];
}
function Up(e) {
  return e ? e.cat && e.cat.values ? e.cat.values : e.xVal && e.xVal.values ? e.xVal.values : [] : [];
}
function Hp(e, t, r) {
  var a = e && (e.model || e["!chart"] || e);
  if (!a) return "";
  var n = a.series || [], i = (a.type || "").replace(/Chart$/, ""), c = Math.max(160, Math.round(t || 480)), s = Math.max(120, Math.round(r || 288)), u = a.title || e.title || "", f = ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"], o = ['<svg class="sjs-chart-svg" xmlns="http://www.w3.org/2000/svg" width="' + c + '" height="' + s + '" viewBox="0 0 ' + c + " " + s + '">'];
  o.push('<rect x="0" y="0" width="' + c + '" height="' + s + '" fill="#fff" stroke="#d0d7de"/>'), u && o.push('<text x="' + c / 2 + '" y="20" text-anchor="middle" font-family="Arial" font-size="14">' + Ft(u) + "</text>");
  var l = u ? 34 : 16, x = 42, h = 14, g = 28, _ = c - x - h, d = s - l - g, p = [];
  n.forEach(function(ae) {
    Tn(ae).forEach(function(K) {
      typeof K == "number" && isFinite(K) && p.push(K);
    });
  });
  var w = Math.max.apply(Math, p.concat([0])), m = Math.min.apply(Math, p.concat([0]));
  if (m > 0 && (m = 0), w == m && (w = m + 1), o.push('<line x1="' + x + '" y1="' + (l + d) + '" x2="' + (x + _) + '" y2="' + (l + d) + '" stroke="#444"/>'), o.push('<line x1="' + x + '" y1="' + l + '" x2="' + x + '" y2="' + (l + d) + '" stroke="#444"/>'), i == "pie" || i == "doughnut") {
    var y = Tn(n[0] || {}), M = y.reduce(function(ae, K) {
      return ae + (typeof K == "number" ? Math.max(0, K) : 0);
    }, 0) || 1, W = c / 2, I = l + d / 2, L = Math.max(10, Math.min(_, d) / 2 - 8), A = -Math.PI / 2;
    return y.forEach(function(ae, K) {
      var J = A + Math.max(0, +ae || 0) / M * Math.PI * 2, fe = W + L * Math.cos(A), Y = I + L * Math.sin(A), oe = W + L * Math.cos(J), ce = I + L * Math.sin(J), re = J - A > Math.PI ? 1 : 0;
      o.push('<path d="M' + W + "," + I + " L" + fe + "," + Y + " A" + L + "," + L + " 0 " + re + ",1 " + oe + "," + ce + ' Z" fill="' + f[K % f.length] + '"/>'), A = J;
    }), i == "doughnut" && o.push('<circle cx="' + W + '" cy="' + I + '" r="' + L * 0.45 + '" fill="#fff"/>'), o.push("</svg>"), o.join("");
  }
  var N = 0;
  if (n.forEach(function(ae) {
    N = Math.max(N, Tn(ae).length);
  }), !N)
    return o.push("</svg>"), o.join("");
  var R = _ / N;
  n.forEach(function(ae, K) {
    var J = Tn(ae), fe = f[K % f.length];
    if (i == "line" || i == "scatter" || i == "area") {
      var Y = [];
      J.forEach(function(ce, re) {
        if (!(typeof ce != "number" || !isFinite(ce))) {
          var De = x + R * (re + 0.5), be = l + d - (ce - m) / (w - m) * d;
          Y.push([De, be]);
        }
      }), i == "area" && Y.length && o.push('<polygon points="' + [[Y[0][0], l + d]].concat(Y).concat([[Y[Y.length - 1][0], l + d]]).map(function(ce) {
        return ce[0] + "," + ce[1];
      }).join(" ") + '" fill="' + fe + '" opacity="0.35"/>'), Y.length && o.push('<polyline points="' + Y.map(function(ce) {
        return ce[0] + "," + ce[1];
      }).join(" ") + '" fill="none" stroke="' + fe + '" stroke-width="2"/>'), Y.forEach(function(ce) {
        o.push('<circle cx="' + ce[0] + '" cy="' + ce[1] + '" r="2.5" fill="' + fe + '"/>');
      });
    } else {
      var oe = Math.max(1, R / Math.max(n.length, 1) * 0.72);
      J.forEach(function(ce, re) {
        if (!(typeof ce != "number" || !isFinite(ce))) {
          var De = x + R * re + (R - oe * n.length) / 2 + oe * K, be = l + d - (ce - m) / (w - m) * d, de = l + d - (0 - m) / (w - m) * d;
          o.push('<rect x="' + De + '" y="' + Math.min(be, de) + '" width="' + oe + '" height="' + Math.max(1, Math.abs(de - be)) + '" fill="' + fe + '"/>');
        }
      });
    }
    ae.name && o.push('<text x="' + (x + 8) + '" y="' + (l + 14 + K * 14) + '" font-family="Arial" font-size="11" fill="' + fe + '">' + Ft(ae.name) + "</text>");
  });
  var V = Up(n[0] || {});
  return V.slice(0, Math.min(V.length, N)).forEach(function(ae, K) {
    K % Math.ceil(N / 8) == 0 && o.push('<text x="' + (x + R * (K + 0.5)) + '" y="' + (l + d + 16) + '" text-anchor="middle" font-family="Arial" font-size="10">' + Ft(String(ae)) + "</text>");
  }), o.push("</svg>"), o.join("");
}
function Vp(e, t) {
  var r = [], a = e["!drawings"] || {}, n = e["!charts"] || [];
  return t && t.drawings && a.images && a.images.forEach(function(i) {
    if (!(!i || !i.dataURI)) {
      var c = Qi(e, i.anchor, t);
      r.push('<img class="sjs-drawing-image" src="' + i.dataURI + '" style="' + es(c) + '"/>');
    }
  }), t && t.charts && n.forEach(function(i) {
    var c = Qi(e, i.anchor, t);
    r.push('<div class="sjs-chart" style="' + es(c) + '">' + Hp(i, c.width, c.height) + "</div>");
  }), r.length ? '<div class="sjs-drawing-layer" style="position:absolute;left:0;top:0;pointer-events:none">' + r.join("") + "</div>" : "";
}
function Wp(e, t, r) {
  var a = [], n = {}, i = [];
  r && r.id && (n.id = r.id), r && (r.browserPixels || r.autoFit) && i.push("border-collapse:collapse;table-layout:fixed"), i.length && (n.style = i.join(";"));
  var c = Nn("table", "", n).replace(/<\/table>$/, ""), s = r && r._htmlCols || e["!cols"];
  if (r && (r.browserPixels || r.autoFit) && s) {
    a.push("<colgroup>");
    for (var u = t.s.c; u <= t.e.c; ++u) {
      var f = s[u], o = [];
      o.push("width:" + Mn(f) + "px"), f && f.hidden && o.push("display:none"), a.push(Nn("col", null, { style: o.join(";") }));
    }
    a.push("</colgroup>");
  }
  return c + a.join("");
}
function Gp(e, t) {
  var r = {};
  if (t) for (var a in t) Object.prototype.hasOwnProperty.call(t, a) && (r[a] = t[a]);
  if (r.autoFit) {
    var n = { set: !1 };
    if (typeof r.autoFit == "object") for (a in r.autoFit) Object.prototype.hasOwnProperty.call(r.autoFit, a) && (n[a] = r.autoFit[a]);
    r.measureText && n.measureText == null && (n.measureText = r.measureText), r.canvas && n.canvas == null && (n.canvas = r.canvas), r._htmlCols = p0(e, n), r.browserPixels == null && (r.browserPixels = !0);
  }
  var i = r.header != null ? r.header : Lp, c = r.footer != null ? r.footer : Mp, s = [i], u = Nt(e["!ref"] || "A1"), f = r.charts && e["!charts"] && e["!charts"].length || r.drawings && e["!drawings"];
  if (f && s.push('<div class="sjs-sheet" style="position:relative;display:inline-block">'), s.push(Wp(e, u, r)), e["!ref"]) for (var o = u.s.r; o <= u.e.r; ++o) s.push(Bp(e, u, o, r));
  return f ? (s.push("</table>"), s.push(Vp(e, r)), s.push("</div>"), s.push(c)) : s.push("</table>" + c), s.join("");
}
function au(e, t, r) {
  var a = r || {}, n = e["!data"] != null, i = 0, c = 0;
  if (a.origin != null)
    if (typeof a.origin == "number") i = a.origin;
    else {
      var s = typeof a.origin == "string" ? Ir(a.origin) : a.origin;
      i = s.r, c = s.c;
    }
  var u = { s: { r: 0, c: 0 }, e: { r: i, c } };
  if (e["!ref"]) {
    var f = Nt(e["!ref"]);
    u.s.r = Math.min(u.s.r, f.s.r), u.s.c = Math.min(u.s.c, f.s.c), u.e.r = Math.max(u.e.r, f.e.r), u.e.c = Math.max(u.e.c, f.e.c), i == -1 && (u.e.r = i = f.e.r + 1);
  }
  var o = t.rows;
  if (!o)
    throw "Unsupported origin when " + t.tagName + " is not a TABLE";
  var l = Math.min(a.sheetRows || 1e7, o.length), x = [], h = 0, g = e["!rows"] || (e["!rows"] = []), _ = 0, d = 0, p = 0, w = 0, m = 0, y = 0;
  for (e["!cols"] || (e["!cols"] = []); _ < o.length && d < l; ++_) {
    var M = o[_];
    if (rs(M)) {
      if (a.display) continue;
      g[d] = { hidden: !0 };
    }
    var W = M.cells;
    for (p = w = 0; p < W.length; ++p) {
      var I = W[p];
      if (!(a.display && rs(I))) {
        var L = I.hasAttribute("data-v") ? I.getAttribute("data-v") : I.hasAttribute("v") ? I.getAttribute("v") : zs(I.innerHTML), A = I.getAttribute("data-z") || I.getAttribute("z"), N = I.hasAttribute("data-f") ? I.getAttribute("data-f") : I.hasAttribute("f") ? I.getAttribute("f") : null;
        for (h = 0; h < x.length; ++h) {
          var R = x[h];
          R.s.c == w + c && R.s.r < d + i && d + i <= R.e.r && (w = R.e.c + 1 - c, h = -1);
        }
        y = +I.getAttribute("colspan") || 1, ((m = +I.getAttribute("rowspan") || 1) > 1 || y > 1) && x.push({ s: { r: d + i, c: w + c }, e: { r: d + i + (m || 1) - 1, c: w + c + (y || 1) - 1 } });
        var V = { t: "s", v: L }, ae = I.getAttribute("data-t") || I.getAttribute("t") || "";
        L != null && (L.length == 0 ? V.t = ae || "z" : a.raw || L.trim().length == 0 || ae == "s" || (ae == "e" && Ur[+L] ? V = { t: "e", v: +L, w: Ur[+L] } : L === "TRUE" ? V = { t: "b", v: !0 } : L === "FALSE" ? V = { t: "b", v: !1 } : isNaN(zr(L)) ? isNaN(Ka(L).getDate()) ? L.charCodeAt(0) == 35 && Tr[L] != null && (V = { t: "e", v: Tr[L], w: L }) : (V = { t: "d", v: kr(L) }, a.UTC && (V.v = Hn(V.v)), a.cellDates || (V = { t: "n", v: mr(V.v) }), V.z = a.dateNF || Le[14]) : V = { t: "n", v: zr(L) })), V.z === void 0 && A != null && (V.z = A);
        var K = "", J = I.getElementsByTagName("A");
        if (J && J.length) for (var fe = 0; fe < J.length && !(J[fe].hasAttribute("href") && (K = J[fe].getAttribute("href"), K.charAt(0) != "#")); ++fe) ;
        K && K.charAt(0) != "#" && K.slice(0, 11).toLowerCase() != "javascript:" && (V.l = { Target: K }), N != null && (V.f = N), n ? (e["!data"][d + i] || (e["!data"][d + i] = []), e["!data"][d + i][w + c] = V) : e[Ge({ c: w + c, r: d + i })] = V, u.e.c < w + c && (u.e.c = w + c), w += y;
      }
    }
    ++d;
  }
  return x.length && (e["!merges"] = (e["!merges"] || []).concat(x)), u.e.r = Math.max(u.e.r, d - 1 + i), e["!ref"] = He(u), d >= l && (e["!fullref"] = He((u.e.r = o.length - _ + d - 1 + i, u))), e;
}
function nu(e, t) {
  var r = t || {}, a = {};
  return r.dense && (a["!data"] = []), au(a, e, t);
}
function Xp(e, t) {
  var r = qt(nu(e, t), t);
  return r;
}
function rs(e) {
  var t = "", r = zp(e);
  return r && (t = r(e).getPropertyValue("display")), t || (t = e.style && e.style.display), t === "none";
}
function zp(e) {
  return e.ownerDocument.defaultView && typeof e.ownerDocument.defaultView.getComputedStyle == "function" ? e.ownerDocument.defaultView.getComputedStyle : typeof getComputedStyle == "function" ? getComputedStyle : null;
}
function qp(e) {
  var t = e.replace(/[\t\r\n]/g, " ").trim().replace(/ +/g, " ").replace(/<text:s\/>/g, " ").replace(/<text:s text:c="(\d+)"\/>/g, function(a, n) {
    return Array(parseInt(n, 10) + 1).join(" ");
  }).replace(/<text:tab[^<>]*\/>/g, "	").replace(/<text:line-break\/>/g, `
`), r = Ue(t.replace(/<[^<>]*>/g, ""));
  return [r];
}
function iu(e, t, r) {
  var a = r || {}, n = Vn(e);
  hr.lastIndex = 0, n = N0(an(n, "<!--", "-->"));
  for (var i, c, s = "", u = "", f, o = 0, l = -1, x = ""; i = hr.exec(n); )
    switch (i[3] = i[3].replace(/_[\s\S]*$/, "")) {
      /* Number Format Definitions */
      case "number-style":
      // <number:number-style> 16.29.2
      case "currency-style":
      // <number:currency-style> 16.29.8
      case "percentage-style":
      // <number:percentage-style> 16.29.10
      case "date-style":
      // <number:date-style> 16.29.11
      case "time-style":
      // <number:time-style> 16.29.19
      case "text-style":
        i[1] === "/" ? (c["truncate-on-overflow"] == "false" && (s.match(/h/) ? s = s.replace(/h+/, "[$&]") : s.match(/m/) ? s = s.replace(/m+/, "[$&]") : s.match(/s/) && (s = s.replace(/s+/, "[$&]"))), a[c.name] = s, s = "") : i[0].charAt(i[0].length - 2) !== "/" && (s = "", c = Ee(i[0], !1));
        break;
      // LibreOffice bug https://bugs.documentfoundation.org/show_bug.cgi?id=149484
      case "boolean-style":
        i[1] === "/" ? (a[c.name] = "General", s = "") : i[0].charAt(i[0].length - 2) !== "/" && (s = "", c = Ee(i[0], !1));
        break;
      /* Number Format Elements */
      case "boolean":
        s += "General";
        break;
      case "text":
        i[1] === "/" ? (x = n.slice(l, hr.lastIndex - i[0].length), x == "%" && c[0] == "<number:percentage-style" ? s += "%" : s += '"' + x.replace(/"/g, '""') + '"') : i[0].charAt(i[0].length - 2) !== "/" && (l = hr.lastIndex);
        break;
      case "day":
        switch (f = Ee(i[0], !1), f.style) {
          case "short":
            s += "d";
            break;
          case "long":
            s += "dd";
            break;
          default:
            s += "dd";
            break;
        }
        break;
      case "day-of-week":
        switch (f = Ee(i[0], !1), f.style) {
          case "short":
            s += "ddd";
            break;
          case "long":
            s += "dddd";
            break;
          default:
            s += "ddd";
            break;
        }
        break;
      case "era":
        switch (f = Ee(i[0], !1), f.style) {
          case "short":
            s += "ee";
            break;
          case "long":
            s += "eeee";
            break;
          default:
            s += "eeee";
            break;
        }
        break;
      case "hours":
        switch (f = Ee(i[0], !1), f.style) {
          case "short":
            s += "h";
            break;
          case "long":
            s += "hh";
            break;
          default:
            s += "hh";
            break;
        }
        break;
      case "minutes":
        switch (f = Ee(i[0], !1), f.style) {
          case "short":
            s += "m";
            break;
          case "long":
            s += "mm";
            break;
          default:
            s += "mm";
            break;
        }
        break;
      case "month":
        switch (f = Ee(i[0], !1), f.textual && (s += "mm"), f.style) {
          case "short":
            s += "m";
            break;
          case "long":
            s += "mm";
            break;
          default:
            s += "m";
            break;
        }
        break;
      case "seconds":
        {
          switch (f = Ee(i[0], !1), f.style) {
            case "short":
              s += "s";
              break;
            case "long":
              s += "ss";
              break;
            default:
              s += "ss";
              break;
          }
          f["decimal-places"] && (s += "." + $e("0", +f["decimal-places"]));
        }
        break;
      case "year":
        switch (f = Ee(i[0], !1), f.style) {
          case "short":
            s += "yy";
            break;
          case "long":
            s += "yyyy";
            break;
          default:
            s += "yy";
            break;
        }
        break;
      case "am-pm":
        s += "AM/PM";
        break;
      case "week-of-year":
      // <number:week-of-year> 16.29.17
      case "quarter":
        console.error("Excel does not support ODS format token " + i[3]);
        break;
      case "fill-character":
        i[1] === "/" ? (x = n.slice(l, hr.lastIndex - i[0].length), s += '"' + x.replace(/"/g, '""') + '"*') : i[0].charAt(i[0].length - 2) !== "/" && (l = hr.lastIndex);
        break;
      case "scientific-number":
        f = Ee(i[0], !1), s += "0." + $e("0", +f["min-decimal-places"] || +f["decimal-places"] || 2) + $e("?", +f["decimal-places"] - +f["min-decimal-places"] || 0) + "E" + (Re(f["forced-exponent-sign"]) ? "+" : "") + $e("0", +f["min-exponent-digits"] || 2);
        break;
      case "fraction":
        f = Ee(i[0], !1), +f["min-integer-digits"] ? s += $e("0", +f["min-integer-digits"]) : s += "#", s += " ", s += $e("?", +f["min-numerator-digits"] || 1), s += "/", +f["denominator-value"] ? s += f["denominator-value"] : s += $e("?", +f["min-denominator-digits"] || 1);
        break;
      case "currency-symbol":
        i[1] === "/" ? s += '"' + n.slice(l, hr.lastIndex - i[0].length).replace(/"/g, '""') + '"' : i[0].charAt(i[0].length - 2) !== "/" ? l = hr.lastIndex : s += "$";
        break;
      case "text-properties":
        switch (f = Ee(i[0], !1), (f.color || "").toLowerCase().replace("#", "")) {
          case "ff0000":
          case "red":
            s = "[Red]" + s;
            break;
        }
        break;
      case "text-content":
        s += "@";
        break;
      case "map":
        f = Ee(i[0], !1), Ue(f.condition) == "value()>=0" ? s = a[f["apply-style-name"]] + ";" + s : t && t.WTF && console.error("ODS number format may be incorrect: " + f.condition);
        break;
      case "number":
        if (i[1] === "/") break;
        f = Ee(i[0], !1), u = "", u += $e("0", +f["min-integer-digits"] || 1), Re(f.grouping) && (u = At($e("#", Math.max(0, 4 - u.length)) + u)), (+f["min-decimal-places"] || +f["decimal-places"]) && (u += "."), +f["min-decimal-places"] && (u += $e("0", +f["min-decimal-places"] || 1)), +f["decimal-places"] - (+f["min-decimal-places"] || 0) && (u += $e("0", +f["decimal-places"] - (+f["min-decimal-places"] || 0))), s += u;
        break;
      case "embedded-text":
        i[1] === "/" ? o == 0 ? s += '"' + n.slice(l, hr.lastIndex - i[0].length).replace(/"/g, '""') + '"' : s = s.slice(0, o) + '"' + n.slice(l, hr.lastIndex - i[0].length).replace(/"/g, '""') + '"' + s.slice(o) : i[0].charAt(i[0].length - 2) !== "/" && (l = hr.lastIndex, o = -+Ee(i[0], !1).position || 0);
        break;
    }
  return a;
}
function su(e, t, r) {
  var a = t || {}, n = Vn(e), i = [], c, s, u, f = "", o = 0, l, x, h = {}, g = [], _ = {};
  a.dense && (_["!data"] = []);
  var d, p, w = { value: "" }, m = {}, y = "", M = 0, W = "", I = 0, L = [], A = [], N = -1, R = -1, V = { s: { r: 1e6, c: 1e7 }, e: { r: 0, c: 0 } }, ae = 0, K = r || {}, J = {}, fe = {}, Y = [], oe = {}, ce = 0, re = 0, De = [], be = 1, de = 1, ie = [], Se = { Names: [], WBProps: {}, Sheets: [] }, _e = {}, Ne = ["", ""], S = [], G = {}, H = "", P = 0, ee = !1, Fe = !1, te = 0;
  for (hr.lastIndex = 0, n = N0(an(n, "<!--", "-->")); d = hr.exec(n); ) switch (d[3] = d[3].replace(/_[\s\S]*$/, "")) {
    case "table":
    case "工作表":
      d[1] === "/" ? (V.e.c >= V.s.c && V.e.r >= V.s.r ? _["!ref"] = He(V) : _["!ref"] = "A1:A1", a.sheetRows > 0 && a.sheetRows <= V.e.r && (_["!fullref"] = _["!ref"], V.e.r = a.sheetRows - 1, _["!ref"] = He(V)), Y.length && (_["!merges"] = Y), De.length && (_["!rows"] = De), l.name = l.名称 || l.name, typeof JSON < "u" && JSON.stringify(l), g.push(l.name), h[l.name] = _, Se.Sheets.push({
        /* TODO: CodeName */
        Hidden: fe[l["style-name"]] && fe[l["style-name"]].display ? Re(fe[l["style-name"]].display) ? 0 : 1 : 0
      }), Fe = !1) : d[0].charAt(d[0].length - 2) !== "/" && (l = Ee(d[0], !1), N = R = -1, V.s.r = V.s.c = 1e7, V.e.r = V.e.c = 0, _ = {}, a.dense && (_["!data"] = []), Y = [], De = [], Fe = !0);
      break;
    case "table-row-group":
      d[1] === "/" ? --ae : ++ae;
      break;
    case "table-row":
    case "行":
      if (d[1] === "/") {
        N += be, be = 1;
        break;
      }
      if (x = Ee(d[0], !1), x.行号 ? N = x.行号 - 1 : N == -1 && (N = 0), be = +x["number-rows-repeated"] || 1, be < 10) for (te = 0; te < be; ++te) ae > 0 && (De[N + te] = { level: ae });
      R = -1;
      break;
    case "covered-table-cell":
      if (d[1] !== "/")
        if (++R, w = Ee(d[0], !1), de = parseInt(w["number-columns-repeated"] || "1", 10) || 1, a.sheetStubs) {
          for (; de-- > 0; )
            a.dense ? (_["!data"][N] || (_["!data"][N] = []), _["!data"][N][R] = { t: "z" }) : _[Ge({ r: N, c: R })] = { t: "z" }, ++R;
          --R;
        } else R += de - 1;
      y = "", L = [];
      break;
    /* stub */
    case "table-cell":
    case "数据":
      if (d[0].charAt(d[0].length - 2) === "/")
        ++R, w = Ee(d[0], !1), de = parseInt(w["number-columns-repeated"] || "1", 10) || 1, p = {
          t: "z",
          v: null
          /*:: , z:null, w:"",c:[]*/
        }, w.formula && a.cellFormula != !1 && (p.f = qi(Ue(w.formula))), w["style-name"] && J[w["style-name"]] && (p.z = J[w["style-name"]]), (w.数据类型 || w["value-type"]) == "string" && (p.t = "s", p.v = Ue(w["string-value"] || ""), a.dense ? (_["!data"][N] || (_["!data"][N] = []), _["!data"][N][R] = p) : _[Je(R) + er(N)] = p), R += de - 1;
      else if (d[1] !== "/") {
        ++R, y = W = "", M = I = 0, L = [], A = [], de = 1;
        var ue = be ? N + be - 1 : N;
        if (R > V.e.c && (V.e.c = R), R < V.s.c && (V.s.c = R), N < V.s.r && (V.s.r = N), ue > V.e.r && (V.e.r = ue), w = Ee(d[0], !1), m = Af(d[0]), S = [], G = {}, p = {
          t: w.数据类型 || w["value-type"],
          v: null
          /*:: , z:null, w:"",c:[]*/
        }, w["style-name"] && J[w["style-name"]] && (p.z = J[w["style-name"]]), a.cellFormula)
          if (w.formula && (w.formula = Ue(w.formula)), w["number-matrix-columns-spanned"] && w["number-matrix-rows-spanned"] && (ce = parseInt(w["number-matrix-rows-spanned"], 10) || 0, re = parseInt(w["number-matrix-columns-spanned"], 10) || 0, oe = { s: { r: N, c: R }, e: { r: N + ce - 1, c: R + re - 1 } }, p.F = He(oe), ie.push([oe, p.F])), w.formula) p.f = qi(w.formula);
          else for (te = 0; te < ie.length; ++te)
            N >= ie[te][0].s.r && N <= ie[te][0].e.r && R >= ie[te][0].s.c && R <= ie[te][0].e.c && (p.F = ie[te][1]);
        switch ((w["number-columns-spanned"] || w["number-rows-spanned"]) && (ce = parseInt(w["number-rows-spanned"] || "1", 10) || 1, re = parseInt(w["number-columns-spanned"] || "1", 10) || 1, ce * re > 1 && (oe = { s: { r: N, c: R }, e: { r: N + ce - 1, c: R + re - 1 } }, Y.push(oe))), w["number-columns-repeated"] && (de = parseInt(w["number-columns-repeated"], 10)), p.t) {
          case "boolean":
            p.t = "b", p.v = Re(w["boolean-value"]) || +w["boolean-value"] >= 1;
            break;
          case "float":
            p.t = "n", p.v = parseFloat(w.value), a.cellDates && p.z && lt(p.z) && (p.v = Vt(p.v + (Se.WBProps.date1904 ? 1462 : 0)), p.t = typeof p.v == "number" ? "n" : "d");
            break;
          case "percentage":
            p.t = "n", p.v = parseFloat(w.value);
            break;
          case "currency":
            p.t = "n", p.v = parseFloat(w.value);
            break;
          case "date":
            p.t = "d", p.v = kr(w["date-value"], Se.WBProps.date1904), a.cellDates || (p.t = "n", p.v = mr(p.v, Se.WBProps.date1904)), p.z || (p.z = "m/d/yy");
            break;
          /* NOTE: for `time`, Excel ODS export incorrectly uses durations relative to 1900 epoch even if 1904 is specified */
          case "time":
            p.t = "n", p.v = tf(w["time-value"]) / 86400, a.cellDates && (p.v = Vt(p.v), p.t = typeof p.v == "number" ? "n" : "d"), p.z || (p.z = "HH:MM:SS");
            break;
          case "number":
            p.t = "n", p.v = parseFloat(w.数据数值);
            break;
          default:
            if (p.t === "string" || p.t === "text" || !p.t)
              p.t = "s", w["string-value"] != null && (y = Ue(w["string-value"]), L = []);
            else throw new Error("Unsupported value type " + p.t);
        }
      } else {
        if (ee = !1, m["calcext:value-type"] == "error" && Tr[y] != null && (p.t = "e", p.w = y, p.v = Tr[y]), p.t === "s" && (p.v = y || "", L.length && (p.R = L), ee = M == 0), _e.Target && (p.l = _e), S.length > 0 && (p.c = S, S = []), y && a.cellText !== !1 && (p.w = y), ee && (p.t = "z", delete p.v), (!ee || a.sheetStubs) && !(a.sheetRows && a.sheetRows <= N))
          for (var se = 0; se < be; ++se) {
            if (de = parseInt(w["number-columns-repeated"] || "1", 10), a.dense)
              for (_["!data"][N + se] || (_["!data"][N + se] = []), _["!data"][N + se][R] = se == 0 ? p : Ze(p); --de > 0; ) _["!data"][N + se][R + de] = Ze(p);
            else
              for (_[Ge({ r: N + se, c: R })] = p; --de > 0; ) _[Ge({ r: N + se, c: R + de })] = Ze(p);
            V.e.c <= R && (V.e.c = R);
          }
        de = parseInt(w["number-columns-repeated"] || "1", 10), R += de - 1, de = 0, p = {
          /*:: t:"", v:null, z:null, w:"",c:[]*/
        }, y = "", L = [];
      }
      _e = {};
      break;
    // 9.1.4 <table:table-cell>
    /* pure state */
    case "document":
    // TODO: <office:document> is the root for FODS
    case "document-content":
    case "电子表格文档":
    // 3.1.3.2 <office:document-content>
    case "spreadsheet":
    case "主体":
    // 3.7 <office:spreadsheet>
    case "scripts":
    // 3.12 <office:scripts>
    case "styles":
    // TODO <office:styles>
    case "font-face-decls":
    // 3.14 <office:font-face-decls>
    case "master-styles":
      if (d[1] === "/") {
        if ((c = i.pop())[0] !== d[3]) throw "Bad state: " + c;
      } else d[0].charAt(d[0].length - 2) !== "/" && i.push([d[3], !0]);
      break;
    case "annotation":
      if (d[1] === "/") {
        if ((c = i.pop())[0] !== d[3]) throw "Bad state: " + c;
        G.t = y, L.length && (G.R = L), G.a = H, S.push(G), y = W, M = I, L = A;
      } else if (d[0].charAt(d[0].length - 2) !== "/") {
        i.push([d[3], !1]);
        var Ce = Ee(d[0], !0);
        Ce.display && Re(Ce.display) || (S.hidden = !0), W = y, I = M, A = L, y = "", M = 0, L = [];
      }
      H = "", P = 0;
      break;
    case "creator":
      d[1] === "/" ? H = n.slice(P, d.index) : P = d.index + d[0].length;
      break;
    /* ignore state */
    case "meta":
    case "元数据":
    // TODO: <office:meta> <uof:元数据> FODS/UOF
    case "settings":
    // TODO: <office:settings>
    case "config-item-set":
    // TODO: <office:config-item-set>
    case "config-item-map-indexed":
    // TODO: <office:config-item-map-indexed>
    case "config-item-map-entry":
    // TODO: <office:config-item-map-entry>
    case "config-item-map-named":
    // TODO: <office:config-item-map-entry>
    case "shapes":
    // 9.2.8 <table:shapes>
    case "frame":
    // 10.4.2 <draw:frame>
    case "text-box":
    // 10.4.3 <draw:text-box>
    case "image":
    // 10.4.4 <draw:image>
    case "data-pilot-tables":
    // 9.6.2 <table:data-pilot-tables>
    case "list-style":
    // 16.30 <text:list-style>
    case "form":
    // 13.13 <form:form>
    case "dde-links":
    // 9.8 <table:dde-links>
    case "event-listeners":
    // TODO
    case "chart":
      if (d[1] === "/") {
        if ((c = i.pop())[0] !== d[3]) throw "Bad state: " + c;
      } else d[0].charAt(d[0].length - 2) !== "/" && i.push([d[3], !1]);
      y = "", M = 0, L = [];
      break;
    case "scientific-number":
    // <number:scientific-number>
    case "currency-symbol":
    // <number:currency-symbol>
    case "fill-character":
      break;
    case "text-style":
    // 16.27.25 <number:text-style>
    case "boolean-style":
    // 16.27.23 <number:boolean-style>
    case "number-style":
    // 16.27.2 <number:number-style>
    case "currency-style":
    // 16.29.8 <number:currency-style>
    case "percentage-style":
    // 16.27.9 <number:percentage-style>
    case "date-style":
    // 16.27.10 <number:date-style>
    case "time-style":
      if (d[1] === "/") {
        var Ae = hr.lastIndex;
        iu(n.slice(u, hr.lastIndex), t, K), hr.lastIndex = Ae;
      } else d[0].charAt(d[0].length - 2) !== "/" && (u = hr.lastIndex - d[0].length);
      break;
    case "script":
      break;
    // 3.13 <office:script>
    case "libraries":
      break;
    // TODO: <ooo:libraries>
    case "automatic-styles":
      break;
    // 3.15.3 <office:automatic-styles>
    case "default-style":
    // TODO: <style:default-style>
    case "page-layout":
      break;
    // TODO: <style:page-layout>
    case "style":
      {
        var Te = Ee(d[0], !1);
        Te.family == "table-cell" && K[Te["data-style-name"]] ? J[Te.name] = K[Te["data-style-name"]] : Te.family == "table" && (fe[Te.name] = Te);
      }
      break;
    case "map":
      break;
    // 16.3 <style:map>
    case "font-face":
      break;
    // 16.21 <style:font-face>
    case "paragraph-properties":
      break;
    // 17.6 <style:paragraph-properties>
    case "table-properties":
      {
        var ze = Ee(d[0], !1);
        Te && Te.family == "table" && (Te.display = ze.display);
      }
      break;
    case "table-column-properties":
      break;
    // 17.16 <style:table-column-properties>
    case "table-row-properties":
      break;
    // 17.17 <style:table-row-properties>
    case "table-cell-properties":
      break;
    // 17.18 <style:table-cell-properties>
    case "number":
      break;
    case "fraction":
      break;
    // TODO 16.27.6 <number:fraction>
    case "day":
    // 16.27.11 <number:day>
    case "month":
    // 16.27.12 <number:month>
    case "year":
    // 16.27.13 <number:year>
    case "era":
    // 16.27.14 <number:era>
    case "day-of-week":
    // 16.27.15 <number:day-of-week>
    case "week-of-year":
    // 16.27.16 <number:week-of-year>
    case "quarter":
    // 16.27.17 <number:quarter>
    case "hours":
    // 16.27.19 <number:hours>
    case "minutes":
    // 16.27.20 <number:minutes>
    case "seconds":
    // 16.27.21 <number:seconds>
    case "am-pm":
      break;
    case "boolean":
      break;
    // 16.27.24 <number:boolean>
    case "text":
      if (d[0].slice(-2) === "/>") break;
      if (d[1] === "/") switch (i[i.length - 1][0]) {
        case "number-style":
        case "date-style":
        case "time-style":
          f += n.slice(o, d.index);
          break;
      }
      else o = d.index + d[0].length;
      break;
    case "named-range":
      s = Ee(d[0], !1), Ne = n0(s["cell-range-address"]);
      var Ie = { Name: s.name, Ref: Ne[0] + "!" + Ne[1] };
      Fe && (Ie.Sheet = g.length), Se.Names.push(Ie);
      break;
    case "text-content":
      break;
    // 16.27.27 <number:text-content>
    case "text-properties":
      break;
    // 16.27.27 <style:text-properties>
    case "embedded-text":
      break;
    // 16.27.4 <number:embedded-text>
    case "body":
    case "电子表格":
      break;
    // 3.3 16.9.6 19.726.3
    case "forms":
      break;
    // 12.25.2 13.2
    case "table-column":
      break;
    // 9.1.6 <table:table-column>
    case "table-header-rows":
      break;
    // 9.1.7 <table:table-header-rows>
    case "table-rows":
      break;
    // 9.1.12 <table:table-rows>
    /* TODO: outline levels */
    case "table-column-group":
      break;
    // 9.1.10 <table:table-column-group>
    case "table-header-columns":
      break;
    // 9.1.11 <table:table-header-columns>
    case "table-columns":
      break;
    // 9.1.12 <table:table-columns>
    case "null-date":
      s = Ee(d[0], !1), s["date-value"] === "1904-01-01" && (Se.WBProps.date1904 = !0);
      break;
    case "graphic-properties":
      break;
    // 17.21 <style:graphic-properties>
    case "calculation-settings":
      break;
    // 9.4.1 <table:calculation-settings>
    case "named-expressions":
      break;
    // 9.4.11 <table:named-expressions>
    case "label-range":
      break;
    // 9.4.9 <table:label-range>
    case "label-ranges":
      break;
    // 9.4.10 <table:label-ranges>
    case "named-expression":
      break;
    // 9.4.13 <table:named-expression>
    case "sort":
      break;
    // 9.4.19 <table:sort>
    case "sort-by":
      break;
    // 9.4.20 <table:sort-by>
    case "sort-groups":
      break;
    // 9.4.22 <table:sort-groups>
    case "tab":
      break;
    // 6.1.4 <text:tab>
    case "line-break":
      break;
    // 6.1.5 <text:line-break>
    case "span":
      break;
    // 6.1.7 <text:span>
    case "p":
    case "文本串":
      if (["master-styles"].indexOf(i[i.length - 1][0]) > -1) break;
      if (d[1] === "/" && (!w || !w["string-value"])) {
        var Pe = qp(n.slice(M, d.index));
        y = (y.length > 0 ? y + `
` : "") + Pe[0];
      } else d[0].slice(-2) == "/>" ? y += `
` : (Ee(d[0], !1), M = d.index + d[0].length);
      break;
    // <text:p>
    case "s":
      break;
    // <text:s>
    case "database-range":
      if (d[1] === "/") break;
      try {
        Ne = n0(Ee(d[0])["target-range-address"]), h[Ne[0]]["!autofilter"] = { ref: Ne[1] };
      } catch {
      }
      break;
    case "date":
      break;
    // <*:date>
    case "object":
      break;
    // 10.4.6.2 <draw:object>
    case "title":
    case "标题":
      break;
    // <*:title> OR <uof:标题>
    case "desc":
      break;
    // <*:desc>
    case "binary-data":
      break;
    // 10.4.5 TODO: b64 blob
    /* 9.2 Advanced Tables */
    case "table-source":
      break;
    // 9.2.6
    case "scenario":
      break;
    // 9.2.6
    case "iteration":
      break;
    // 9.4.3 <table:iteration>
    case "content-validations":
      break;
    // 9.4.4 <table:
    case "content-validation":
      break;
    // 9.4.5 <table:
    case "help-message":
      break;
    // 9.4.6 <table:
    case "error-message":
      break;
    // 9.4.7 <table:
    case "database-ranges":
      break;
    // 9.4.14 <table:database-ranges>
    /* 9.5 Filters */
    case "filter":
      break;
    // 9.5.2 <table:filter>
    case "filter-and":
      break;
    // 9.5.3 <table:filter-and>
    case "filter-or":
      break;
    // 9.5.4 <table:filter-or>
    case "filter-condition":
      break;
    // 9.5.5 <table:filter-condition>
    case "filter-set-item":
      break;
    // 9.5.6 <table:filter-condition>
    case "list-level-style-bullet":
      break;
    // 16.31 <text:
    case "list-level-style-number":
      break;
    // 16.32 <text:
    case "list-level-properties":
      break;
    // 17.19 <style:
    /* 7.3 Document Fields */
    case "sender-firstname":
    // 7.3.6.2
    case "sender-lastname":
    // 7.3.6.3
    case "sender-initials":
    // 7.3.6.4
    case "sender-title":
    // 7.3.6.5
    case "sender-position":
    // 7.3.6.6
    case "sender-email":
    // 7.3.6.7
    case "sender-phone-private":
    // 7.3.6.8
    case "sender-fax":
    // 7.3.6.9
    case "sender-company":
    // 7.3.6.10
    case "sender-phone-work":
    // 7.3.6.11
    case "sender-street":
    // 7.3.6.12
    case "sender-city":
    // 7.3.6.13
    case "sender-postal-code":
    // 7.3.6.14
    case "sender-country":
    // 7.3.6.15
    case "sender-state-or-province":
    // 7.3.6.16
    case "author-name":
    // 7.3.7.1
    case "author-initials":
    // 7.3.7.2
    case "chapter":
    // 7.3.8
    case "file-name":
    // 7.3.9
    case "template-name":
    // 7.3.9
    case "sheet-name":
      break;
    case "event-listener":
      break;
    /* TODO: FODS Properties */
    case "initial-creator":
    case "creation-date":
    case "print-date":
    case "generator":
    case "document-statistic":
    case "user-defined":
    case "editing-duration":
    case "editing-cycles":
      break;
    /* TODO: FODS Config */
    case "config-item":
      break;
    /* TODO: style tokens */
    case "page-number":
      break;
    // TODO <text:page-number>
    case "page-count":
      break;
    // TODO <text:page-count>
    case "time":
      break;
    // TODO <text:time>
    /* 9.3 Advanced Table Cells */
    case "cell-range-source":
      break;
    // 9.3.1 <table:
    case "detective":
      break;
    // 9.3.2 <table:
    case "operation":
      break;
    // 9.3.3 <table:
    case "highlighted-range":
      break;
    // 9.3.4 <table:
    /* 9.6 Data Pilot Tables <table: */
    case "data-pilot-table":
    // 9.6.3
    case "source-cell-range":
    // 9.6.5
    case "source-service":
    // 9.6.6
    case "data-pilot-field":
    // 9.6.7
    case "data-pilot-level":
    // 9.6.8
    case "data-pilot-subtotals":
    // 9.6.9
    case "data-pilot-subtotal":
    // 9.6.10
    case "data-pilot-members":
    // 9.6.11
    case "data-pilot-member":
    // 9.6.12
    case "data-pilot-display-info":
    // 9.6.13
    case "data-pilot-sort-info":
    // 9.6.14
    case "data-pilot-layout-info":
    // 9.6.15
    case "data-pilot-field-reference":
    // 9.6.16
    case "data-pilot-groups":
    // 9.6.17
    case "data-pilot-group":
    // 9.6.18
    case "data-pilot-group-member":
      break;
    /* 10.3 Drawing Shapes */
    case "rect":
      break;
    /* 14.6 DDE Connections */
    case "dde-connection-decls":
    // 14.6.2 <text:
    case "dde-connection-decl":
    // 14.6.3 <text:
    case "dde-link":
    // 14.6.4 <table:
    case "dde-source":
      break;
    case "properties":
      break;
    // 13.7 <form:properties>
    case "property":
      break;
    // 13.8 <form:property>
    case "a":
      if (d[1] !== "/") {
        if (_e = Ee(d[0], !1), !_e.href) break;
        _e.Target = Ue(_e.href), delete _e.href, _e.Target.charAt(0) == "#" && _e.Target.indexOf(".") > -1 ? (Ne = n0(_e.Target.slice(1)), _e.Target = "#" + Ne[0] + "!" + Ne[1]) : _e.Target.match(/^\.\.[\\\/]/) && (_e.Target = _e.Target.slice(3)), _e.title && (_e.Tooltip = Ue(_e.title), delete _e.title);
      }
      break;
    /* non-standard */
    case "table-protection":
      break;
    case "data-pilot-grand-total":
      break;
    // <table:
    case "office-document-common-attrs":
      break;
    // bare
    default:
      switch (d[2]) {
        case "dc:":
        // TODO: properties
        case "calcext:":
        // ignore undocumented extensions
        case "loext:":
        // ignore undocumented extensions
        case "ooo:":
        // ignore undocumented extensions
        case "chartooo:":
        // ignore undocumented extensions
        case "draw:":
        // TODO: drawing
        case "style:":
        // TODO: styles
        case "chart:":
        // TODO: charts
        case "form:":
        // TODO: forms
        case "uof:":
        // TODO: uof
        case "表:":
        // TODO: uof
        case "字:":
          break;
        default:
          if (a.WTF) throw new Error(d);
      }
  }
  var we = {
    Sheets: h,
    SheetNames: g,
    Workbook: Se
  };
  return a.bookSheets && delete /*::(*/
  we.Sheets, we;
}
function ts(e, t) {
  t = t || {}, et(e, "META-INF/manifest.xml") && vo(lr(e, "META-INF/manifest.xml"), t);
  var r = gr(e, "styles.xml"), a = r && iu(Qe(r), t), n = gr(e, "content.xml");
  if (!n) throw new Error("Missing content.xml in ODS / UOF file");
  var i = su(Qe(n), t, a);
  return et(e, "meta.xml") && (i.Props = lc(lr(e, "meta.xml"))), i.bookType = "ods", i;
}
function as(e, t) {
  var r = su(e, t);
  return r.bookType = "fods", r;
}
var Fr = (function() {
  try {
    return typeof Uint8Array > "u" || typeof Uint8Array.prototype.subarray > "u" ? "slice" : typeof Buffer < "u" ? typeof Buffer.prototype.subarray > "u" ? "slice" : (typeof Buffer.from == "function" ? Buffer.from([72, 62]) : new Buffer([72, 62])) instanceof Uint8Array ? "subarray" : "slice" : "subarray";
  } catch {
    return "slice";
  }
})();
function en(e) {
  return new DataView(e.buffer, e.byteOffset, e.byteLength);
}
function Fa(e) {
  return typeof TextDecoder < "u" ? new TextDecoder().decode(e) : Qe(It(e));
}
function cu(e) {
  for (var t = 0, r = 0; r < e.length; ++r)
    t += e[r].length;
  var a = new Uint8Array(t), n = 0;
  for (r = 0; r < e.length; ++r) {
    var i = e[r], c = i.length;
    if (c < 250)
      for (var s = 0; s < c; ++s)
        a[n++] = i[s];
    else
      a.set(i, n), n += c;
  }
  return a;
}
function qa(e) {
  return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), (e + (e >> 4) & 252645135) * 16843009 >>> 24;
}
function $p(e, t) {
  for (var r = (e[t + 15] & 127) << 7 | e[t + 14] >> 1, a = e[t + 14] & 1, n = t + 13; n >= t; --n)
    a = a * 256 + e[n];
  return (e[t + 15] & 128 ? -a : a) * Math.pow(10, r - 6176);
}
function Pn(e, t) {
  var r = t.l, a = e[r] & 127;
  e:
    if (e[r++] >= 128 && (a |= (e[r] & 127) << 7, e[r++] < 128 || (a |= (e[r] & 127) << 14, e[r++] < 128) || (a |= (e[r] & 127) << 21, e[r++] < 128) || (a += (e[r] & 127) * Math.pow(2, 28), ++r, e[r++] < 128) || (a += (e[r] & 127) * Math.pow(2, 35), ++r, e[r++] < 128) || (a += (e[r] & 127) * Math.pow(2, 42), ++r, e[r++] < 128)))
      break e;
  return t.l = r, a;
}
function Ke(e) {
  var t = 0, r = e[t] & 127;
  return e[t++] < 128 || (r |= (e[t] & 127) << 7, e[t++] < 128) || (r |= (e[t] & 127) << 14, e[t++] < 128) || (r |= (e[t] & 127) << 21, e[t++] < 128) || (r |= (e[t] & 15) << 28), r;
}
function We(e) {
  for (var t = [], r = { l: 0 }; r.l < e.length; ) {
    var a = r.l, n = Pn(e, r), i = n & 7;
    n = n / 8 | 0;
    var c, s = r.l;
    switch (i) {
      case 0:
        {
          for (; e[s++] >= 128; )
            ;
          c = e[Fr](r.l, s), r.l = s;
        }
        break;
      case 1:
        c = e[Fr](s, s + 8), r.l = s + 8;
        break;
      case 2:
        {
          var u = Pn(e, r);
          c = e[Fr](r.l, r.l + u), r.l += u;
        }
        break;
      case 5:
        c = e[Fr](s, s + 4), r.l = s + 4;
        break;
      default:
        throw new Error("PB Type ".concat(i, " for Field ").concat(n, " at offset ").concat(a));
    }
    var f = { data: c, type: i };
    t[n] == null && (t[n] = []), t[n].push(f);
  }
  return t;
}
function $n(e, t) {
  return e?.map(function(r) {
    return t(r.data);
  }) || [];
}
function jp(e) {
  for (var t, r = [], a = { l: 0 }; a.l < e.length; ) {
    var n = Pn(e, a), i = We(e[Fr](a.l, a.l + n));
    a.l += n;
    var c = {
      id: Ke(i[1][0].data),
      messages: []
    };
    i[2].forEach(function(s) {
      var u = We(s.data), f = Ke(u[3][0].data);
      c.messages.push({
        meta: u,
        data: e[Fr](a.l, a.l + f)
      }), a.l += f;
    }), (t = i[3]) != null && t[0] && (c.merge = Ke(i[3][0].data) >>> 0 > 0), r.push(c);
  }
  return r;
}
function Kp(e, t) {
  if (e != 0)
    throw new Error("Unexpected Snappy chunk type ".concat(e));
  for (var r = { l: 0 }, a = Pn(t, r), n = [], i = r.l; i < t.length; ) {
    var c = t[i] & 3;
    if (c == 0) {
      var s = t[i++] >> 2;
      if (s < 60)
        ++s;
      else {
        var u = s - 59;
        s = t[i], u > 1 && (s |= t[i + 1] << 8), u > 2 && (s |= t[i + 2] << 16), u > 3 && (s |= t[i + 3] << 24), s >>>= 0, s++, i += u;
      }
      n.push(t[Fr](i, i + s)), i += s;
      continue;
    } else {
      var f = 0, o = 0;
      if (c == 1 ? (o = (t[i] >> 2 & 7) + 4, f = (t[i++] & 224) << 3, f |= t[i++]) : (o = (t[i++] >> 2) + 1, c == 2 ? (f = t[i] | t[i + 1] << 8, i += 2) : (f = (t[i] | t[i + 1] << 8 | t[i + 2] << 16 | t[i + 3] << 24) >>> 0, i += 4)), f == 0)
        throw new Error("Invalid offset 0");
      for (var l = n.length - 1, x = f; l >= 0 && x >= n[l].length; )
        x -= n[l].length, --l;
      if (l < 0)
        if (x == 0)
          x = n[l = 0].length;
        else
          throw new Error("Invalid offset beyond length");
      if (o < x)
        n.push(n[l][Fr](n[l].length - x, n[l].length - x + o));
      else {
        for (x > 0 && (n.push(n[l][Fr](n[l].length - x)), o -= x), ++l; o >= n[l].length; )
          n.push(n[l]), o -= n[l].length, ++l;
        o && n.push(n[l][Fr](0, o));
      }
      n.length > 25 && (n = [cu(n)]);
    }
  }
  for (var h = 0, g = 0; g < n.length; ++g)
    h += n[g].length;
  if (h != a)
    throw new Error("Unexpected length: ".concat(h, " != ").concat(a));
  return n;
}
function Yp(e) {
  Array.isArray(e) && (e = new Uint8Array(e));
  for (var t = [], r = 0; r < e.length; ) {
    var a = e[r++], n = e[r] | e[r + 1] << 8 | e[r + 2] << 16;
    r += 3, t.push.apply(t, Kp(a, e[Fr](r, r + n))), r += n;
  }
  if (r !== e.length)
    throw new Error("data is not a valid framed stream!");
  return t.length == 1 ? t[0] : cu(t);
}
var Jp = function() {
  return { sst: [], rsst: [], ofmt: [], nfmt: [], fmla: [], ferr: [], cmnt: [] };
};
function uu(e, t, r, a, n) {
  var i, c, s, u, f = t & 255, o = t >> 8, l = o >= 5 ? n : a;
  e:
    if (r & (o > 4 ? 8 : 4) && e.t == "n" && f == 7) {
      var x = (i = l[7]) != null && i[0] ? Ke(l[7][0].data) : -1;
      if (x == -1)
        break e;
      var h = (c = l[15]) != null && c[0] ? Ke(l[15][0].data) : -1, g = (s = l[16]) != null && s[0] ? Ke(l[16][0].data) : -1, _ = (u = l[40]) != null && u[0] ? Ke(l[40][0].data) : -1, d = e.v, p = d;
      r:
        if (_) {
          if (d == 0) {
            h = g = 2;
            break r;
          }
          d >= 604800 ? h = 1 : d >= 86400 ? h = 2 : d >= 3600 ? h = 4 : d >= 60 ? h = 8 : d >= 1 ? h = 16 : h = 32, Math.floor(d) != d ? g = 32 : d % 60 ? g = 16 : d % 3600 ? g = 8 : d % 86400 ? g = 4 : d % 604800 && (g = 2), g < h && (g = h);
        }
      if (h == -1 || g == -1)
        break e;
      var w = [], m = [];
      h == 1 && (p = d / 604800, g == 1 ? m.push('d"d"') : (p |= 0, d -= 604800 * p), w.push(p + (x == 2 ? " week" + (p == 1 ? "" : "s") : x == 1 ? "w" : ""))), h <= 2 && g >= 2 && (p = d / 86400, g > 2 && (p |= 0, d -= 86400 * p), m.push('d"d"'), w.push(p + (x == 2 ? " day" + (p == 1 ? "" : "s") : x == 1 ? "d" : ""))), h <= 4 && g >= 4 && (p = d / 3600, g > 4 && (p |= 0, d -= 3600 * p), m.push((h >= 4 ? "[h]" : "h") + '"h"'), w.push(p + (x == 2 ? " hour" + (p == 1 ? "" : "s") : x == 1 ? "h" : ""))), h <= 8 && g >= 8 && (p = d / 60, g > 8 && (p |= 0, d -= 60 * p), m.push((h >= 8 ? "[m]" : "m") + '"m"'), x == 0 ? w.push((h == 8 && g == 8 || p >= 10 ? "" : "0") + p) : w.push(p + (x == 2 ? " minute" + (p == 1 ? "" : "s") : x == 1 ? "m" : ""))), h <= 16 && g >= 16 && (p = d, g > 16 && (p |= 0, d -= p), m.push((h >= 16 ? "[s]" : "s") + '"s"'), x == 0 ? w.push((g == 16 && h == 16 || p >= 10 ? "" : "0") + p) : w.push(p + (x == 2 ? " second" + (p == 1 ? "" : "s") : x == 1 ? "s" : ""))), g >= 32 && (p = Math.round(1e3 * d), h < 32 && m.push('.000"ms"'), x == 0 ? w.push((p >= 100 ? "" : p >= 10 ? "0" : "00") + p) : w.push(p + (x == 2 ? " millisecond" + (p == 1 ? "" : "s") : x == 1 ? "ms" : ""))), e.w = w.join(x == 0 ? ":" : " "), e.z = m.join(x == 0 ? '":"' : " "), x == 0 && (e.w = e.w.replace(/:(\d\d\d)$/, ".$1"));
    }
}
function Zp(e, t, r, a) {
  var n = en(e), i = n.getUint32(4, !0), c = -1, s = -1, u = -1, f = NaN, o = 0, l = new Date(Date.UTC(2001, 0, 1)), x = r > 1 ? 12 : 8;
  i & 2 && (u = n.getUint32(x, !0), x += 4), x += qa(i & (r > 1 ? 3468 : 396)) * 4, i & 512 && (c = n.getUint32(x, !0), x += 4), x += qa(i & (r > 1 ? 12288 : 4096)) * 4, i & 16 && (s = n.getUint32(x, !0), x += 4), i & 32 && (f = n.getFloat64(x, !0), x += 8), i & 64 && (l.setTime(l.getTime() + (o = n.getFloat64(x, !0)) * 1e3), x += 8), r > 1 && (i = n.getUint32(8, !0) >>> 16, i & 255 && (u == -1 && (u = n.getUint32(x, !0)), x += 4));
  var h, g = e[r >= 4 ? 1 : 2];
  switch (g) {
    case 0:
      return;
    case 2:
      h = { t: "n", v: f };
      break;
    case 3:
      h = { t: "s", v: t.sst[s] };
      break;
    case 5:
      a?.cellDates ? h = { t: "d", v: l } : h = { t: "n", v: o / 86400 + 35430, z: Le[14] };
      break;
    case 6:
      h = { t: "b", v: f > 0 };
      break;
    case 7:
      h = { t: "n", v: f };
      break;
    case 8:
      h = { t: "e", v: 0 };
      break;
    case 9:
      if (c > -1) {
        var _ = t.rsst[c];
        h = { t: "s", v: _.v }, _.l && (h.l = { Target: _.l });
      } else
        throw new Error("Unsupported cell type ".concat(e[Fr](0, 4)));
      break;
    default:
      throw new Error("Unsupported cell type ".concat(e[Fr](0, 4)));
  }
  return u > -1 && uu(h, g | r << 8, i, t.ofmt[u], t.nfmt[u]), g == 7 && (h.v /= 86400), h;
}
function Qp(e, t, r) {
  var a = en(e);
  a.getUint32(4, !0);
  var n = a.getUint32(8, !0), i = 12, c = -1, s = -1, u = -1, f = NaN, o = NaN, l = 0, x = new Date(Date.UTC(2001, 0, 1));
  n & 1 && (f = $p(e, i), i += 16), n & 2 && (o = a.getFloat64(i, !0), i += 8), n & 4 && (x.setTime(x.getTime() + (l = a.getFloat64(i, !0)) * 1e3), i += 8), n & 8 && (s = a.getUint32(i, !0), i += 4), n & 16 && (c = a.getUint32(i, !0), i += 4), i += qa(n & 480) * 4, n & 512 && (a.getUint32(i, !0), i += 4), i += qa(n & 1024) * 4, n & 2048 && (a.getUint32(i, !0), i += 4);
  var h, g = e[1];
  switch (g) {
    case 0:
      h = { t: "z" };
      break;
    case 2:
      h = { t: "n", v: f };
      break;
    case 3:
      h = { t: "s", v: t.sst[s] };
      break;
    case 5:
      r?.cellDates ? h = { t: "d", v: x } : h = { t: "n", v: l / 86400 + 35430, z: Le[14] };
      break;
    case 6:
      h = { t: "b", v: o > 0 };
      break;
    case 7:
      h = { t: "n", v: o };
      break;
    case 8:
      h = { t: "e", v: 0 };
      break;
    case 9:
      if (c > -1) {
        var _ = t.rsst[c];
        h = { t: "s", v: _.v }, _.l && (h.l = { Target: _.l });
      } else
        throw new Error("Unsupported cell type ".concat(e[1], " : ").concat(n & 31, " : ").concat(e[Fr](0, 4)));
      break;
    case 10:
      h = { t: "n", v: f };
      break;
    default:
      throw new Error("Unsupported cell type ".concat(e[1], " : ").concat(n & 31, " : ").concat(e[Fr](0, 4)));
  }
  if (i += qa(n & 4096) * 4, n & 516096 && (u == -1 && (u = a.getUint32(i, !0)), i += 4), n & 524288) {
    var d = a.getUint32(i, !0);
    i += 4, t.cmnt[d] && (h.c = av(t.cmnt[d]));
  }
  return u > -1 && uu(h, g | 1280, n >> 13, t.ofmt[u], t.nfmt[u]), g == 7 && (h.v /= 86400), h;
}
function ev(e, t, r) {
  switch (e[0]) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
      return Zp(e, t, e[0], r);
    case 5:
      return Qp(e, t, r);
    default:
      throw new Error("Unsupported payload version ".concat(e[0]));
  }
}
function wr(e) {
  var t = We(e);
  return Ke(t[1][0].data);
}
function Kt(e, t) {
  var r = We(t.data), a = Ke(r[1][0].data), n = r[3], i = [];
  return (n || []).forEach(function(c) {
    var s, u, f = We(c.data);
    if (f[1]) {
      var o = Ke(f[1][0].data) >>> 0;
      switch (a) {
        case 1:
          i[o] = Fa(f[3][0].data);
          break;
        case 8:
          {
            var l = e[wr(f[9][0].data)][0], x = We(l.data), h = e[wr(x[1][0].data)][0], g = Ke(h.meta[1][0].data);
            if (g != 2001)
              throw new Error("2000 unexpected reference to ".concat(g));
            var _ = We(h.data), d = { v: _[3].map(function(m) {
              return Fa(m.data);
            }).join("") };
            i[o] = d;
            e:
              if ((s = _?.[11]) != null && s[0]) {
                var p = (u = We(_[11][0].data)) == null ? void 0 : u[1];
                if (!p)
                  break e;
                p.forEach(function(m) {
                  var y, M, W, I = We(m.data);
                  if ((y = I[2]) != null && y[0]) {
                    var L = e[wr((M = I[2]) == null ? void 0 : M[0].data)][0], A = Ke(L.meta[1][0].data);
                    switch (A) {
                      case 2032:
                        var N = We(L.data);
                        (W = N?.[2]) != null && W[0] && !d.l && (d.l = Fa(N[2][0].data));
                        break;
                      case 2039:
                        break;
                      default:
                        console.log("unrecognized ObjectAttribute type ".concat(A));
                    }
                  }
                });
              }
          }
          break;
        case 2:
          i[o] = We(f[6][0].data);
          break;
        case 3:
          i[o] = We(f[5][0].data);
          break;
        case 10:
          {
            var w = e[wr(f[10][0].data)][0];
            i[o] = fu(e, w.data);
          }
          break;
        default:
          throw a;
      }
    }
  }), i;
}
function rv(e, t) {
  var r, a, n, i, c, s, u, f, o, l, x, h, g, _, d = We(e), p = Ke(d[1][0].data) >>> 0, w = Ke(d[2][0].data) >>> 0, m = ((a = (r = d[8]) == null ? void 0 : r[0]) == null ? void 0 : a.data) && Ke(d[8][0].data) > 0 || !1, y, M;
  if ((i = (n = d[7]) == null ? void 0 : n[0]) != null && i.data && t != 0)
    y = (s = (c = d[7]) == null ? void 0 : c[0]) == null ? void 0 : s.data, M = (f = (u = d[6]) == null ? void 0 : u[0]) == null ? void 0 : f.data;
  else if ((l = (o = d[4]) == null ? void 0 : o[0]) != null && l.data && t != 1)
    y = (h = (x = d[4]) == null ? void 0 : x[0]) == null ? void 0 : h.data, M = (_ = (g = d[3]) == null ? void 0 : g[0]) == null ? void 0 : _.data;
  else
    throw "NUMBERS Tile missing ".concat(t, " cell storage");
  for (var W = m ? 4 : 1, I = en(y), L = [], A = 0; A < y.length / 2; ++A) {
    var N = I.getUint16(A * 2, !0);
    N < 65535 && L.push([A, N]);
  }
  if (L.length != w)
    throw "Expected ".concat(w, " cells, found ").concat(L.length);
  var R = [];
  for (A = 0; A < L.length - 1; ++A)
    R[L[A][0]] = M[Fr](L[A][1] * W, L[A + 1][1] * W);
  return L.length >= 1 && (R[L[L.length - 1][0]] = M[Fr](L[L.length - 1][1] * W)), { R: p, cells: R };
}
function tv(e, t) {
  var r, a = We(t.data), n = -1;
  (r = a?.[7]) != null && r[0] && (Ke(a[7][0].data) >>> 0 ? n = 1 : n = 0);
  var i = $n(a[5], function(c) {
    return rv(c, n);
  });
  return {
    nrows: Ke(a[4][0].data) >>> 0,
    data: i.reduce(function(c, s) {
      return c[s.R] || (c[s.R] = []), s.cells.forEach(function(u, f) {
        if (c[s.R][f])
          throw new Error("Duplicate cell r=".concat(s.R, " c=").concat(f));
        c[s.R][f] = u;
      }), c;
    }, [])
  };
}
function fu(e, t) {
  var r, a, n, i, c, s, u, f, o, l, x = { t: "", a: "" }, h = We(t);
  if ((a = (r = h?.[1]) == null ? void 0 : r[0]) != null && a.data && (x.t = Fa((i = (n = h?.[1]) == null ? void 0 : n[0]) == null ? void 0 : i.data) || ""), (s = (c = h?.[3]) == null ? void 0 : c[0]) != null && s.data) {
    var g = e[wr((f = (u = h?.[3]) == null ? void 0 : u[0]) == null ? void 0 : f.data)][0], _ = We(g.data);
    (l = (o = _[1]) == null ? void 0 : o[0]) != null && l.data && (x.a = Fa(_[1][0].data));
  }
  return h?.[4] && (x.replies = [], h[4].forEach(function(d) {
    var p = e[wr(d.data)][0];
    x.replies.push(fu(e, p.data));
  })), x;
}
function av(e) {
  var t = [];
  return t.push({ t: e.t || "", a: e.a, T: e.replies && e.replies.length > 0 }), e.replies && e.replies.forEach(function(r) {
    t.push({ t: r.t || "", a: r.a, T: !0 });
  }), t;
}
function nv(e, t, r, a) {
  var n, i, c, s, u, f, o, l, x, h, g, _, d, p, w = We(t.data), m = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  if (m.e.r = (Ke(w[6][0].data) >>> 0) - 1, m.e.r < 0)
    throw new Error("Invalid row varint ".concat(w[6][0].data));
  if (m.e.c = (Ke(w[7][0].data) >>> 0) - 1, m.e.c < 0)
    throw new Error("Invalid col varint ".concat(w[7][0].data));
  r["!ref"] = He(m);
  var y = r["!data"] != null, M = r, W = We(w[4][0].data), I = Jp();
  (n = W[4]) != null && n[0] && (I.sst = Kt(e, e[wr(W[4][0].data)][0])), (i = W[6]) != null && i[0] && (I.fmla = Kt(e, e[wr(W[6][0].data)][0])), (c = W[11]) != null && c[0] && (I.ofmt = Kt(e, e[wr(W[11][0].data)][0])), (s = W[12]) != null && s[0] && (I.ferr = Kt(e, e[wr(W[12][0].data)][0])), (u = W[17]) != null && u[0] && (I.rsst = Kt(e, e[wr(W[17][0].data)][0])), (f = W[19]) != null && f[0] && (I.cmnt = Kt(e, e[wr(W[19][0].data)][0])), (o = W[22]) != null && o[0] && (I.nfmt = Kt(e, e[wr(W[22][0].data)][0]));
  var L = We(W[3][0].data), A = 0;
  if (!((l = W[9]) != null && l[0]))
    throw "NUMBERS file missing row tree";
  var N = We(W[9][0].data)[1].map(function(J) {
    return We(J.data);
  });
  if (N.forEach(function(J) {
    A = Ke(J[1][0].data);
    var fe = Ke(J[2][0].data), Y = L[1][fe];
    if (!Y)
      throw "NUMBERS missing tile " + fe;
    var oe = We(Y.data), ce = e[wr(oe[2][0].data)][0], re = Ke(ce.meta[1][0].data);
    if (re != 6002)
      throw new Error("6001 unexpected reference to ".concat(re));
    var De = tv(e, ce);
    De.data.forEach(function(be, de) {
      be.forEach(function(ie, Se) {
        var _e = ev(ie, I, a);
        _e && (y ? (M["!data"][A + de] || (M["!data"][A + de] = []), M["!data"][A + de][Se] = _e) : r[Je(Se) + er(A + de)] = _e);
      });
    }), A += De.nrows;
  }), (x = W[13]) != null && x[0]) {
    var R = e[wr(W[13][0].data)][0], V = Ke(R.meta[1][0].data);
    if (V != 6144)
      throw new Error("Expected merge type 6144, found ".concat(V));
    r["!merges"] = (h = We(R.data)) == null ? void 0 : h[1].map(function(J) {
      var fe = We(J.data), Y = en(We(fe[1][0].data)[1][0].data), oe = en(We(fe[2][0].data)[1][0].data);
      return {
        s: { r: Y.getUint16(0, !0), c: Y.getUint16(2, !0) },
        e: {
          r: Y.getUint16(0, !0) + oe.getUint16(0, !0) - 1,
          c: Y.getUint16(2, !0) + oe.getUint16(2, !0) - 1
        }
      };
    });
  }
  if (!((g = r["!merges"]) != null && g.length) && ((_ = w[47]) != null && _[0])) {
    var ae = We(w[47][0].data);
    if ((d = ae[2]) != null && d[0]) {
      var K = We(ae[2][0].data);
      (p = K[3]) != null && p[0] && (r["!merges"] = $n(K[3], function(J) {
        var fe, Y, oe, ce, re, De = We(J), be = We(De[2][0].data), de = We(be[1][0].data);
        if ((fe = de[1]) != null && fe[0]) {
          var ie = We(de[1][0].data), Se = Ke(ie[1][0].data);
          if (Se == 67) {
            var _e = We(ie[40][0].data);
            if (!(!((Y = _e[3]) != null && Y[0]) || !((oe = _e[4]) != null && oe[0]))) {
              var Ne = We(_e[3][0].data), S = We(_e[4][0].data), G = Ke(Ne[1][0].data), H = (ce = Ne[2]) != null && ce[0] ? Ke(Ne[2][0].data) : G, P = Ke(S[1][0].data), ee = (re = S[2]) != null && re[0] ? Ke(S[2][0].data) : P;
              return { s: { r: P, c: G }, e: { r: ee, c: H } };
            }
          }
        }
      }).filter(function(J) {
        return J != null;
      }));
    }
  }
}
function iv(e, t, r) {
  var a = We(t.data), n = { "!ref": "A1" };
  r?.dense && (n["!data"] = []);
  var i = e[wr(a[2][0].data)], c = Ke(i[0].meta[1][0].data);
  if (c != 6001)
    throw new Error("6000 unexpected reference to ".concat(c));
  return nv(e, i[0], n, r), n;
}
function sv(e, t, r) {
  var a, n = We(t.data), i = {
    name: (a = n[1]) != null && a[0] ? Fa(n[1][0].data) : "",
    sheets: []
  }, c = $n(n[2], wr);
  return c.forEach(function(s) {
    e[s].forEach(function(u) {
      var f = Ke(u.meta[1][0].data);
      f == 6e3 && i.sheets.push(iv(e, u, r));
    });
  }), i;
}
function cv(e, t, r) {
  var a, n = Y0();
  n.Workbook = { WBProps: { date1904: !0 } };
  var i = We(t.data);
  if ((a = i[2]) != null && a[0])
    throw new Error("Keynote presentations are not supported");
  var c = $n(i[1], wr);
  if (c.forEach(function(s) {
    e[s].forEach(function(u) {
      var f = Ke(u.meta[1][0].data);
      if (f == 2) {
        var o = sv(e, u, r);
        o.sheets.forEach(function(l, x) {
          on(n, l, x == 0 ? o.name : o.name + "_" + x, !0);
        });
      }
    });
  }), n.SheetNames.length == 0)
    throw new Error("Empty NUMBERS file");
  return n.bookType = "numbers", n;
}
function s0(e, t) {
  var r, a, n, i, c, s, u, f = {}, o = [];
  if (e.FullPaths.forEach(function(x) {
    if (x.match(/\.iwpv2/))
      throw new Error("Unsupported password protection");
  }), e.FileIndex.forEach(function(x) {
    if (x.name.match(/\.iwa$/) && x.content[0] == 0) {
      var h;
      try {
        h = Yp(x.content);
      } catch (_) {
        return console.log("?? " + x.content.length + " " + (_.message || _));
      }
      var g;
      try {
        g = jp(h);
      } catch (_) {
        return console.log("## " + (_.message || _));
      }
      g.forEach(function(_) {
        f[_.id] = _.messages, o.push(_.id);
      });
    }
  }), !o.length)
    throw new Error("File has no messages");
  if ((n = (a = (r = f?.[1]) == null ? void 0 : r[0].meta) == null ? void 0 : a[1]) != null && n[0].data && Ke(f[1][0].meta[1][0].data) == 1e4)
    throw new Error("Pages documents are not supported");
  var l = ((u = (s = (c = (i = f?.[1]) == null ? void 0 : i[0]) == null ? void 0 : c.meta) == null ? void 0 : s[1]) == null ? void 0 : u[0].data) && Ke(f[1][0].meta[1][0].data) == 1 && f[1][0];
  if (l || o.forEach(function(x) {
    f[x].forEach(function(h) {
      var g = Ke(h.meta[1][0].data) >>> 0;
      if (g == 1)
        if (!l)
          l = h;
        else
          throw new Error("Document has multiple roots");
    });
  }), !l)
    throw new Error("Cannot find Document root");
  return cv(f, l, t);
}
function uv(e) {
  return function(r) {
    for (var a = 0; a != e.length; ++a) {
      var n = e[a];
      r[n[0]] === void 0 && (r[n[0]] = n[1]), n[2] === "n" && (r[n[0]] = Number(r[n[0]]));
    }
  };
}
function j0(e) {
  uv([
    ["cellNF", !1],
    /* emit cell number format string as .z */
    ["cellHTML", !0],
    /* emit html string as .h */
    ["cellFormula", !0],
    /* emit formulae as .f */
    ["cellStyles", !1],
    /* emits style/theme as .s */
    ["cellText", !0],
    /* emit formatted text as .w */
    ["cellDates", !1],
    /* emit date cells with type `d` */
    ["sheetStubs", !1],
    /* emit empty cells */
    ["sheetRows", 0, "n"],
    /* read n rows (0 = read all rows) */
    ["bookDeps", !1],
    /* parse calculation chains */
    ["bookSheets", !1],
    /* only try to get sheet names (no Sheets) */
    ["bookProps", !1],
    /* only try to get properties (no Sheets) */
    ["bookFiles", !1],
    /* include raw file structure (keys, files, cfb) */
    ["bookVBA", !1],
    /* include vba raw data (vbaraw) */
    ["password", ""],
    /* password */
    ["WTF", !1]
    /* WTF mode (throws errors) */
  ])(e);
}
function fv(e) {
  return Ea.WS.indexOf(e) > -1 ? "sheet" : e == Ea.CS ? "chart" : e == Ea.DS ? "dialog" : e == Ea.MS ? "macro" : e && e.length ? e : "sheet";
}
function ov(e, t) {
  if (!e) return 0;
  try {
    e = t.map(function(a) {
      return a.id || (a.id = a.strRelID), [a.name, e["!id"][a.id].Target, fv(e["!id"][a.id].Type)];
    });
  } catch {
    return null;
  }
  return !e || e.length === 0 ? null : e;
}
function lv(e, t, r, a, n, i, c, s) {
  if (!(!e || !e["!legdrawel"])) {
    var u = Tt(e["!legdrawel"].Target, a), f = gr(r, u, !0);
    f && G1(Qe(f), e, s || []);
  }
}
function hv(e) {
  var t = (e || "").toLowerCase().replace(/.*\./, "");
  switch (t) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
function dv(e, t, r, a, n, i, c) {
  if (!(!e || !e["!drawel"]) && !(!i || !i.drawings && !i.charts)) {
    var s = Tt(e["!drawel"].Target, a), u = Ya(s), f = Lc(gr(r, s, !0), ra(gr(r, u, !0), s));
    e["!drawings"] = f, i.drawings && f.images && f.images.length && f.images.forEach(function(o) {
      if (!(!o || !o.target)) {
        var l = Tt(o.target, s), x = R0(r, l, !0);
        x && (o.dataURI = "data:" + hv(l) + ";base64," + C0(x)), o.path = l;
      }
    }), i.charts && f.charts && f.charts.length && (e["!charts"] = [], f.charts.forEach(function(o) {
      if (!(!o || !o.target)) {
        var l = Tt(o.target, s), x = Ya(l), h = Jc(gr(r, l, !0), l, i, ra(gr(r, x, !0), l), c, { "!type": "chart" });
        o.model = h && h["!chart"], o.data = h, o.path = l, e["!charts"].push(o);
      }
    }));
  }
}
function xv(e, t, r, a, n, i, c, s, u, f, o, l) {
  try {
    i[a] = ra(gr(e, r, !0), t);
    var x = lr(e, t), h;
    switch (s) {
      case "sheet":
        h = zx(x, t, n, u, i[a], f, o, l);
        break;
      case "chart":
        if (h = qx(x, t, n, u, i[a], f, o, l), !h || !h["!drawel"] || !u.drawings && !u.charts) break;
        var g = Tt(h["!drawel"].Target, t), _ = Ya(g), d = Lc(gr(e, g, !0), ra(gr(e, _, !0), g));
        if (h["!drawings"] = d, !u.charts || !d.chart) break;
        var p = Tt(d.chart, g), w = Ya(p);
        h = Jc(gr(e, p, !0), p, u, ra(gr(e, w, !0), p), f, h), d.charts && d.charts.length && (d.charts[0].model = h && h["!chart"], h["!charts"] = d.charts);
        break;
      case "macro":
        h = $x(x, t, n, u, i[a], f, o, l);
        break;
      case "dialog":
        h = jx(x, t, n, u, i[a], f, o, l);
        break;
      default:
        throw new Error("Unrecognized sheet type " + s);
    }
    c[a] = h;
    var m = [], y = [];
    i && i[a] && br(i[a]).forEach(function(M) {
      var W = "";
      if (i[a][M].Type == Ea.CMNT) {
        if (W = Tt(i[a][M].Target, t), m = Jx(lr(e, W, !0), W, u), !m || !m.length) return;
        Hi(h, m, !1);
      }
      i[a][M].Type == Ea.TCMNT && (W = Tt(i[a][M].Target, t), y = y.concat(z1(lr(e, W, !0), u)));
    }), y && y.length && Hi(h, y, !0, u.people || []), s == "sheet" && dv(h, s, e, t, n, u, f), lv(h, s, e, t, n, u, f, m);
  } catch (M) {
    if (u.WTF) throw M;
  }
}
function Jr(e) {
  return e.charAt(0) == "/" ? e.slice(1) : e;
}
function pv(e, t) {
  if (Os(), t = t || {}, j0(t), et(e, "META-INF/manifest.xml") || et(e, "objectdata.xml")) return ts(e, t);
  if (et(e, "Index/Document.iwa")) {
    if (typeof Uint8Array > "u") throw new Error("NUMBERS file parsing requires Uint8Array support");
    if (typeof s0 < "u") {
      if (e.FileIndex) return s0(e, t);
      var r = je.utils.cfb_new();
      return fi(e).forEach(function(J) {
        mf(r, J, R0(e, J));
      }), s0(r, t);
    }
    throw new Error("Unsupported NUMBERS file");
  }
  if (!et(e, "[Content_Types].xml")) {
    if (et(e, "index.xml.gz")) throw new Error("Unsupported NUMBERS 08 file");
    if (et(e, "index.xml")) throw new Error("Unsupported NUMBERS 09 file");
    var a = je.find(e, "Index.zip");
    if (a)
      return t = Ze(t), delete t.type, typeof a.content == "string" && (t.type = "binary"), typeof Bun < "u" && Buffer.isBuffer(a.content) ? aa(new Uint8Array(a.content), t) : aa(a.content, t);
    throw new Error("Unsupported ZIP file");
  }
  var n = fi(e), i = xo(gr(e, "[Content_Types].xml")), c = !1, s, u;
  if (i.workbooks.length === 0 && (u = "xl/workbook.xml", lr(e, u, !0) && i.workbooks.push(u)), i.workbooks.length === 0) {
    if (u = "xl/workbook.bin", !lr(e, u, !0)) throw new Error("Could not find workbook");
    i.workbooks.push(u), c = !0;
  }
  i.workbooks[0].slice(-3) == "bin" && (c = !0);
  var f = {}, o = {};
  if (!t.bookSheets && !t.bookProps) {
    if (Ga = [], i.sst) try {
      Ga = Yx(lr(e, Jr(i.sst)), i.sst, t);
    } catch (J) {
      if (t.WTF) throw J;
    }
    t.cellStyles && i.themes.length && (f = Bc(gr(e, i.themes[0].replace(/^\//, ""), !0) || "", t)), i.style && (o = Kx(lr(e, Jr(i.style)), i.style, f, t));
  }
  i.links.map(function(J) {
    try {
      var fe = ra(gr(e, Ya(Jr(J))), J);
      return Qx(lr(e, Jr(J)), fe, J, t);
    } catch {
    }
  });
  var l = Xx(lr(e, Jr(i.workbooks[0])), i.workbooks[0], t), x = {}, h = "";
  i.coreprops.length && (h = lr(e, Jr(i.coreprops[0]), !0), h && (x = lc(h)), i.extprops.length !== 0 && (h = lr(e, Jr(i.extprops[0]), !0), h && mo(h, x, t)));
  var g = {};
  (!t.bookSheets || t.bookProps) && i.custprops.length !== 0 && (h = gr(e, Jr(i.custprops[0]), !0), h && (g = Eo(h, t)));
  var _ = {};
  if ((t.bookSheets || t.bookProps) && (l.Sheets ? s = l.Sheets.map(function(fe) {
    return fe.name;
  }) : x.Worksheets && x.SheetNames.length > 0 && (s = x.SheetNames), t.bookProps && (_.Props = x, _.Custprops = g), t.bookSheets && typeof s < "u" && (_.SheetNames = s), t.bookSheets ? _.SheetNames : t.bookProps))
    return _;
  s = {};
  var d = {};
  t.bookDeps && i.calcchain && (d = Zx(lr(e, Jr(i.calcchain)), i.calcchain));
  var p = 0, w = {}, m, y;
  {
    var M = l.Sheets;
    x.Worksheets = M.length, x.SheetNames = [];
    for (var W = 0; W != M.length; ++W)
      x.SheetNames[W] = M[W].name;
  }
  var I = c ? "bin" : "xml", L = i.workbooks[0].lastIndexOf("/"), A = (i.workbooks[0].slice(0, L + 1) + "_rels/" + i.workbooks[0].slice(L + 1) + ".rels").replace(/^\//, "");
  et(e, A) || (A = "xl/_rels/workbook." + I + ".rels");
  var N = ra(gr(e, A, !0), A.replace(/_rels.*/, "s5s"));
  (i.metadata || []).length >= 1 && (t.xlmeta = ep(lr(e, Jr(i.metadata[0])), i.metadata[0], t)), (i.people || []).length >= 1 && (t.people = q1(lr(e, Jr(i.people[0])), t)), N && (N = ov(N, l.Sheets));
  var R = lr(e, "xl/worksheets/sheet.xml", !0) ? 1 : 0;
  e: for (p = 0; p != x.Worksheets; ++p) {
    var V = "sheet";
    if (N && N[p] ? (m = "xl/" + N[p][1].replace(/[\/]?xl\//, ""), et(e, m) || (m = N[p][1]), et(e, m) || (m = A.replace(/_rels\/[\S\s]*$/, "") + N[p][1]), V = N[p][2]) : (m = "xl/worksheets/sheet" + (p + 1 - R) + "." + I, m = m.replace(/sheet0\./, "sheet.")), y = m.replace(/^(.*)(\/)([^\/]*)$/, "$1/_rels/$3.rels"), t && t.sheets != null) switch (typeof t.sheets) {
      case "number":
        if (p != t.sheets) continue e;
        break;
      case "string":
        if (x.SheetNames[p].toLowerCase() != t.sheets.toLowerCase()) continue e;
        break;
      default:
        if (Array.isArray && Array.isArray(t.sheets)) {
          for (var ae = !1, K = 0; K != t.sheets.length; ++K)
            typeof t.sheets[K] == "number" && t.sheets[K] == p && (ae = 1), typeof t.sheets[K] == "string" && t.sheets[K].toLowerCase() == x.SheetNames[p].toLowerCase() && (ae = 1);
          if (!ae) continue e;
        }
    }
    xv(e, m, y, x.SheetNames[p], p, w, s, V, t, l, f, o);
  }
  return _ = {
    Directory: i,
    Workbook: l,
    Props: x,
    Custprops: g,
    Deps: d,
    Sheets: s,
    SheetNames: x.SheetNames,
    Strings: Ga,
    Styles: o,
    Themes: f,
    SSF: Ze(Le)
  }, t && t.bookFiles && (e.files ? (_.keys = n, _.files = e.files) : (_.keys = [], _.files = {}, e.FullPaths.forEach(function(J, fe) {
    J = J.replace(/^Root Entry[\/]/, ""), _.keys.push(J), _.files[J] = e.FileIndex[fe];
  }))), t && t.bookVBA && (i.vba.length > 0 ? _.vbaraw = lr(e, Jr(i.vba[0]), !0) : i.defaults && i.defaults.bin === Y1 && (_.vbaraw = lr(e, "xl/vbaProject.bin", !0))), _.bookType = c ? "xlsb" : "xlsx", _;
}
function vv(e, t) {
  var r = t || {}, a = "Workbook", n = je.find(e, a);
  try {
    if (a = "/!DataSpaces/Version", n = je.find(e, a), !n || !n.content) throw new Error("ECMA-376 Encrypted file missing " + a);
    if (xh(n.content), a = "/!DataSpaces/DataSpaceMap", n = je.find(e, a), !n || !n.content) throw new Error("ECMA-376 Encrypted file missing " + a);
    var i = vh(n.content);
    if (i.length !== 1 || i[0].comps.length !== 1 || i[0].comps[0].t !== 0 || i[0].name !== "StrongEncryptionDataSpace" || i[0].comps[0].v !== "EncryptedPackage")
      throw new Error("ECMA-376 Encrypted file bad " + a);
    if (a = "/!DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace", n = je.find(e, a), !n || !n.content) throw new Error("ECMA-376 Encrypted file missing " + a);
    var c = gh(n.content);
    if (c.length != 1 || c[0] != "StrongEncryptionTransform")
      throw new Error("ECMA-376 Encrypted file bad " + a);
    if (a = "/!DataSpaces/TransformInfo/StrongEncryptionTransform/!Primary", n = je.find(e, a), !n || !n.content) throw new Error("ECMA-376 Encrypted file missing " + a);
    _h(n.content);
  } catch {
  }
  if (a = "/EncryptionInfo", n = je.find(e, a), !n || !n.content) throw new Error("ECMA-376 Encrypted file missing " + a);
  var s = Eh(n.content);
  if (a = "/EncryptedPackage", n = je.find(e, a), !n || !n.content) throw new Error("ECMA-376 Encrypted file missing " + a);
  if (s[0] == 4 && typeof decrypt_agile < "u") return decrypt_agile(s[1], n.content, r.password || "", r);
  if (s[0] == 2 && typeof decrypt_std76 < "u") return decrypt_std76(s[1], n.content, r.password || "", r);
  throw new Error("File is password-protected");
}
function K0(e, t) {
  var r = "";
  switch ((t || {}).type || "base64") {
    case "buffer":
      return [e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7]];
    case "base64":
      r = qr(e.slice(0, 12));
      break;
    case "binary":
      r = e;
      break;
    case "array":
      return [e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7]];
    default:
      throw new Error("Unrecognized type " + (t && t.type || "undefined"));
  }
  return [r.charCodeAt(0), r.charCodeAt(1), r.charCodeAt(2), r.charCodeAt(3), r.charCodeAt(4), r.charCodeAt(5), r.charCodeAt(6), r.charCodeAt(7)];
}
function gv(e, t) {
  return je.find(e, "EncryptedPackage") ? vv(e, t) : tu(e, t);
}
function mv(e, t) {
  var r, a = e, n = t || {};
  return n.type || (n.type = Xe && Buffer.isBuffer(e) ? "buffer" : "base64"), r = Us(a, n), pv(r, n);
}
function ou(e, t) {
  var r = 0;
  e: for (; r < e.length; ) switch (e.charCodeAt(r)) {
    case 10:
    case 13:
    case 32:
      ++r;
      break;
    case 60:
      return m0(e.slice(r), t);
    default:
      break e;
  }
  return ka.to_workbook(e, t);
}
function _v(e, t) {
  var r = "", a = K0(e, t);
  switch (t.type) {
    case "base64":
      r = qr(e);
      break;
    case "binary":
      r = e;
      break;
    case "buffer":
      r = e.toString("binary");
      break;
    case "array":
      r = ia(e);
      break;
    default:
      throw new Error("Unrecognized type " + t.type);
  }
  return a[0] == 239 && a[1] == 187 && a[2] == 191 && (r = Qe(r)), t.type = "binary", ou(r, t);
}
function Ev(e, t) {
  var r = e;
  return t.type == "base64" && (r = qr(r)), typeof ArrayBuffer < "u" && e instanceof ArrayBuffer && (r = new Uint8Array(e)), r = Xe && Buffer.isBuffer(e) ? e.slice(2).toString("utf16le") : typeof Uint8Array < "u" && r instanceof Uint8Array ? typeof TextDecoder < "u" ? new TextDecoder("utf-16le").decode(r.slice(2)) : Tu(r.slice(2)) : Ts(r.slice(2)), t.type = "binary", ou(r, t);
}
function wv(e) {
  return e.match(/[^\x00-\x7F]/) ? La(e) : e;
}
function c0(e, t, r, a) {
  return a ? (r.type = "string", ka.to_workbook(e, r)) : ka.to_workbook(t, r);
}
function aa(e, t) {
  As();
  var r = t || {};
  if (r.codepage && console.error("Codepage tables are not loaded.  Non-ASCII characters may not give expected results"), typeof ArrayBuffer < "u" && e instanceof ArrayBuffer) return aa(new Uint8Array(e), (r = Ze(r), r.type = "array", r));
  if (typeof Int8Array < "u" && e instanceof Int8Array) return aa(new Uint8Array(e.buffer, e.byteOffset, e.length), r);
  typeof Uint8Array < "u" && e instanceof Uint8Array && !r.type && (r.type = typeof Deno < "u" ? "buffer" : "array");
  var a = e, n = [0, 0, 0, 0], i = !1;
  if (r.cellStyles && (r.cellNF = !0, r.sheetStubs = !0), Ta = {}, r.dateNF && (Ta.dateNF = r.dateNF), r.type || (r.type = Xe && Buffer.isBuffer(e) ? "buffer" : "base64"), r.type == "file" && (r.type = Xe ? "buffer" : "binary", a = Qu(e), typeof Uint8Array < "u" && !Xe && (r.type = "array")), r.type == "string" && (i = !0, r.type = "binary", r.codepage = 65001, a = wv(e)), r.type == "array" && typeof Uint8Array < "u" && e instanceof Uint8Array && typeof ArrayBuffer < "u") {
    var c = new ArrayBuffer(3), s = new Uint8Array(c);
    if (s.foo = "bar", !s.foo)
      return r = Ze(r), r.type = "array", aa(y0(a), r);
  }
  switch ((n = K0(a, r))[0]) {
    case 208:
      if (n[1] === 207 && n[2] === 17 && n[3] === 224 && n[4] === 161 && n[5] === 177 && n[6] === 26 && n[7] === 225) return gv(je.read(a, r), r);
      break;
    case 9:
      if (n[1] <= 8) return tu(a, r);
      break;
    case 60:
      return m0(a, r);
    case 73:
      if (n[1] === 73 && n[2] === 42 && n[3] === 0) throw new Error("TIFF Image File is not a spreadsheet");
      if (n[1] === 68) return th(a, r);
      break;
    case 84:
      if (n[1] === 65 && n[2] === 66 && n[3] === 76) return ah(a, r);
      break;
    case 80:
      return n[1] === 75 && n[2] < 9 && n[3] < 9 ? mv(a, r) : c0(e, a, r, i);
    case 239:
      return n[3] === 60 ? m0(a, r) : c0(e, a, r, i);
    case 255:
      if (n[1] === 254)
        return Ev(a, r);
      if (n[1] === 0 && n[2] === 2 && n[3] === 0) return Wa.to_workbook(a, r);
      break;
    case 0:
      if (n[1] === 0 && (n[2] >= 2 && n[3] === 0 || n[2] === 0 && (n[3] === 8 || n[3] === 9)))
        return Wa.to_workbook(a, r);
      break;
    case 3:
    case 131:
    case 139:
    case 140:
      return Li.to_workbook(a, r);
    case 123:
      if (n[1] === 92 && n[2] === 114 && n[3] === 116) return Oh(a, r);
      break;
    case 10:
    case 13:
    case 32:
      return _v(a, r);
    case 137:
      if (n[1] === 80 && n[2] === 78 && n[3] === 71) throw new Error("PNG Image File is not a spreadsheet");
      break;
    case 37:
      if (n[1] === 80 && n[2] === 68 && n[3] === 70) throw new Error("PDF File is not a spreadsheet");
      break;
    case 8:
      if (n[1] === 231) throw new Error("Unsupported Multiplan 1.x file!");
      break;
    case 12:
      if (n[1] === 236) throw new Error("Unsupported Multiplan 2.x file!");
      if (n[1] === 237) throw new Error("Unsupported Multiplan 3.x file!");
      break;
  }
  return Zl.indexOf(n[0]) > -1 && n[2] <= 12 && n[3] <= 31 ? Li.to_workbook(a, r) : c0(e, a, r, i);
}
function Av(e, t, r, a, n, i, c) {
  var s = er(r), u = c.defval, f = c.raw || !Object.prototype.hasOwnProperty.call(c, "raw"), o = !0, l = e["!data"] != null, x = n === 1 ? [] : {};
  if (n !== 1)
    if (Object.defineProperty) try {
      Object.defineProperty(x, "__rowNum__", { value: r, enumerable: !1 });
    } catch {
      x.__rowNum__ = r;
    }
    else x.__rowNum__ = r;
  if (!l || e["!data"][r]) for (var h = t.s.c; h <= t.e.c; ++h) {
    var g = l ? (e["!data"][r] || [])[h] : e[a[h] + s];
    if (g == null || g.t === void 0) {
      if (u === void 0) continue;
      i[h] != null && (x[i[h]] = u);
      continue;
    }
    var _ = g.v;
    switch (g.t) {
      case "z":
        if (_ == null) break;
        continue;
      case "e":
        _ = _ == 0 ? null : void 0;
        break;
      case "s":
      case "b":
        break;
      case "n":
        if (!g.z || !lt(g.z) || (_ = Vt(_), typeof _ == "number")) break;
      /* falls through */
      case "d":
        c && (c.UTC || c.raw === !1) || (_ = sa(new Date(_)));
        break;
      default:
        throw new Error("unrecognized type " + g.t);
    }
    if (i[h] != null) {
      if (_ == null)
        if (g.t == "e" && _ === null) x[i[h]] = null;
        else if (u !== void 0) x[i[h]] = u;
        else if (f && _ === null) x[i[h]] = null;
        else continue;
      else
        x[i[h]] = (g.t === "n" && typeof c.rawNumbers == "boolean" ? c.rawNumbers : f) ? _ : Ot(g, _, c);
      _ != null && (o = !1);
    }
  }
  return { row: x, isempty: o };
}
function w0(e, t) {
  if (e == null || e["!ref"] == null) return [];
  var r = { t: "n", v: 0 }, a = 0, n = 1, i = [], c = 0, s = "", u = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }, f = t || {}, o = f.range != null ? f.range : e["!ref"];
  switch (f.header === 1 ? a = 1 : f.header === "A" ? a = 2 : Array.isArray(f.header) ? a = 3 : f.header == null && (a = 0), typeof o) {
    case "string":
      u = cr(o);
      break;
    case "number":
      u = cr(e["!ref"]), u.s.r = o;
      break;
    default:
      u = o;
  }
  a > 0 && (n = 0);
  var l = er(u.s.r), x = [], h = [], g = 0, _ = 0, d = e["!data"] != null, p = u.s.r, w = 0, m = {};
  d && !e["!data"][p] && (e["!data"][p] = []);
  var y = f.skipHidden && e["!cols"] || [], M = f.skipHidden && e["!rows"] || [];
  for (w = u.s.c; w <= u.e.c; ++w)
    if (!(y[w] || {}).hidden)
      switch (x[w] = Je(w), r = d ? e["!data"][p][w] : e[x[w] + l], a) {
        case 1:
          i[w] = w - u.s.c;
          break;
        case 2:
          i[w] = x[w];
          break;
        case 3:
          i[w] = f.header[w - u.s.c];
          break;
        default:
          if (r == null && (r = { w: "__EMPTY", t: "s" }), s = c = Ot(r, null, f), _ = m[c] || 0, !_) m[c] = 1;
          else {
            do
              s = c + "_" + _++;
            while (m[s]);
            m[c] = _, m[s] = 1;
          }
          i[w] = s;
      }
  for (p = u.s.r + n; p <= u.e.r; ++p)
    if (!(M[p] || {}).hidden) {
      var W = Av(e, u, p, x, a, i, f);
      (W.isempty === !1 || (a === 1 ? f.blankrows !== !1 : f.blankrows)) && (h[g++] = W.row);
    }
  return h.length = g, h;
}
var ns = /"/g;
function Tv(e, t, r, a, n, i, c, s, u) {
  for (var f = !0, o = [], l = "", x = er(r), h = e["!data"] != null, g = h && e["!data"][r] || [], _ = t.s.c; _ <= t.e.c; ++_)
    if (a[_]) {
      var d = h ? g[_] : e[a[_] + x];
      if (d == null) l = "";
      else if (d.v != null) {
        f = !1, l = "" + (u.rawNumbers && d.t == "n" ? d.v : Ot(d, null, u));
        for (var p = 0, w = 0; p !== l.length; ++p) if ((w = l.charCodeAt(p)) === n || w === i || w === 10 || w === 13 || w === 34 || u.forceQuotes) {
          l = '"' + l.replace(ns, '""') + '"';
          break;
        }
        l == "ID" && s == 0 && o.length == 0 && (l = '"ID"');
      } else d.f != null && !d.F ? (f = !1, l = "=" + d.f, l.indexOf(",") >= 0 && (l = '"' + l.replace(ns, '""') + '"')) : l = "";
      o.push(l);
    }
  if (u.strip) for (; o[o.length - 1] === ""; ) --o.length;
  return u.blankrows === !1 && f ? null : o.join(c);
}
function lu(e, t) {
  var r = [], a = t ?? {};
  if (e == null || e["!ref"] == null) return "";
  for (var n = cr(e["!ref"]), i = a.FS !== void 0 ? a.FS : ",", c = i.charCodeAt(0), s = a.RS !== void 0 ? a.RS : `
`, u = s.charCodeAt(0), f = "", o = [], l = a.skipHidden && e["!cols"] || [], x = a.skipHidden && e["!rows"] || [], h = n.s.c; h <= n.e.c; ++h) (l[h] || {}).hidden || (o[h] = Je(h));
  for (var g = 0, _ = n.s.r; _ <= n.e.r; ++_)
    (x[_] || {}).hidden || (f = Tv(e, n, _, o, c, u, i, g, a), f != null && (f || a.blankrows !== !1) && r.push((g++ ? s : "") + f));
  return r.join("");
}
function Fv(e, t) {
  t || (t = {}), t.FS = "	", t.RS = `
`;
  var r = lu(e, t);
  return r;
}
function kv(e, t) {
  var r = "", a, n = "";
  if (e == null || e["!ref"] == null) return [];
  var i = cr(e["!ref"]), c = "", s = [], u, f = [], o = e["!data"] != null;
  for (u = i.s.c; u <= i.e.c; ++u) s[u] = Je(u);
  for (var l = i.s.r; l <= i.e.r; ++l)
    for (c = er(l), u = i.s.c; u <= i.e.c; ++u)
      if (r = s[u] + c, a = o ? (e["!data"][l] || [])[u] : e[r], n = "", a !== void 0) {
        if (a.F != null) {
          if (r = a.F, !a.f) continue;
          n = a.f, r.indexOf(":") == -1 && (r = r + ":" + r);
        }
        if (a.f != null) n = a.f;
        else {
          if (t && t.values === !1) continue;
          if (a.t == "z") continue;
          if (a.t == "n" && a.v != null) n = "" + a.v;
          else if (a.t == "b") n = a.v ? "TRUE" : "FALSE";
          else if (a.w !== void 0) n = "'" + a.w;
          else {
            if (a.v === void 0) continue;
            a.t == "s" ? n = "'" + a.v : n = "" + a.v;
          }
        }
        f[f.length] = r + "=" + n;
      }
  return f;
}
function hu(e, t, r) {
  var a = r || {}, n = e ? e["!data"] != null : a.dense, i = +!a.skipHeader, c = e || {};
  !e && n && (c["!data"] = []);
  var s = 0, u = 0;
  if (c && a.origin != null)
    if (typeof a.origin == "number") s = a.origin;
    else {
      var f = typeof a.origin == "string" ? Ir(a.origin) : a.origin;
      s = f.r, u = f.c;
    }
  var o = { s: { c: 0, r: 0 }, e: { c: u, r: s + t.length - 1 + i } };
  if (c["!ref"]) {
    var l = cr(c["!ref"]);
    o.e.c = Math.max(o.e.c, l.e.c), o.e.r = Math.max(o.e.r, l.e.r), s == -1 && (s = l.e.r + 1, o.e.r = s + t.length - 1 + i);
  } else
    s == -1 && (s = 0, o.e.r = t.length - 1 + i);
  var x = a.header || [], h = 0, g = [];
  t.forEach(function(d, p) {
    n && !c["!data"][s + p + i] && (c["!data"][s + p + i] = []), n && (g = c["!data"][s + p + i]), br(d).forEach(function(w) {
      (h = x.indexOf(w)) == -1 && (x[h = x.length] = w);
      var m = d[w], y = "z", M = "", W = n ? "" : Je(u + h) + er(s + p + i), I = n ? g[u + h] : c[W];
      m && typeof m == "object" && !(m instanceof Date) ? n ? g[u + h] = m : c[W] = m : (typeof m == "number" ? y = "n" : typeof m == "boolean" ? y = "b" : typeof m == "string" ? y = "s" : m instanceof Date ? (y = "d", a.UTC || (m = Hn(m)), a.cellDates || (y = "n", m = mr(m)), M = I != null && I.z && lt(I.z) ? I.z : a.dateNF || Le[14]) : m === null && a.nullError && (y = "e", m = 0), I ? (I.t = y, I.v = m, delete I.w, delete I.R, M && (I.z = M)) : n ? g[u + h] = I = { t: y, v: m } : c[W] = I = { t: y, v: m }, M && (I.z = M));
    });
  }), o.e.c = Math.max(o.e.c, u + x.length - 1);
  var _ = er(s);
  if (n && !c["!data"][s] && (c["!data"][s] = []), i) for (h = 0; h < x.length; ++h)
    n ? c["!data"][s][h + u] = { t: "s", v: x[h] } : c[Je(h + u) + _] = { t: "s", v: x[h] };
  return c["!ref"] = He(o), c;
}
function Dv(e, t) {
  return hu(null, e, t);
}
function rn(e, t, r) {
  if (typeof t == "string") {
    if (e["!data"] != null) {
      var a = Ir(t);
      return e["!data"][a.r] || (e["!data"][a.r] = []), e["!data"][a.r][a.c] || (e["!data"][a.r][a.c] = { t: "z" });
    }
    return e[t] || (e[t] = { t: "z" });
  }
  return typeof t != "number" ? rn(e, Ge(t)) : rn(e, Je(r || 0) + er(t));
}
function Cv(e, t) {
  if (typeof t == "number") {
    if (t >= 0 && e.SheetNames.length > t) return t;
    throw new Error("Cannot find sheet # " + t);
  } else if (typeof t == "string") {
    var r = e.SheetNames.indexOf(t);
    if (r > -1) return r;
    throw new Error("Cannot find sheet name |" + t + "|");
  } else throw new Error("Cannot find sheet |" + t + "|");
}
function Y0(e, t) {
  var r = { SheetNames: [], Sheets: {} };
  return e && on(r, e, t || "Sheet1"), r;
}
function on(e, t, r, a) {
  var n = 1;
  if (!r) for (; n <= 65535 && e.SheetNames.indexOf(r = "Sheet" + n) != -1; ++n, r = void 0) ;
  if (!r || e.SheetNames.length >= 65535) throw new Error("Too many worksheets");
  if (a && e.SheetNames.indexOf(r) >= 0 && r.length < 32) {
    var i = r.match(/\d+$/);
    n = i && +i[0] || 0;
    var c = i && r.slice(0, i.index) || r;
    for (++n; n <= 65535 && e.SheetNames.indexOf(r = c + n) != -1; ++n) ;
  }
  if (Lx(r), e.SheetNames.indexOf(r) >= 0) throw new Error("Worksheet with name |" + r + "| already exists!");
  return e.SheetNames.push(r), e.Sheets[r] = t, r;
}
function yv(e, t, r) {
  e.Workbook || (e.Workbook = {}), e.Workbook.Sheets || (e.Workbook.Sheets = []);
  var a = Cv(e, t);
  switch (e.Workbook.Sheets[a] || (e.Workbook.Sheets[a] = {}), r) {
    case 0:
    case 1:
    case 2:
      break;
    default:
      throw new Error("Bad sheet visibility setting " + r);
  }
  e.Workbook.Sheets[a].Hidden = r;
}
function Sv(e, t) {
  return e.z = t, e;
}
function du(e, t, r) {
  return t ? (e.l = { Target: t }, r && (e.l.Tooltip = r)) : delete e.l, e;
}
function bv(e, t, r) {
  return du(e, "#" + t, r);
}
function Iv(e, t, r) {
  e.c || (e.c = []), e.c.push({ t, a: r || "SheetJS" });
}
function Nv(e, t, r, a) {
  for (var n = typeof t != "string" ? t : cr(t), i = typeof t == "string" ? t : He(t), c = n.s.r; c <= n.e.r; ++c) for (var s = n.s.c; s <= n.e.c; ++s) {
    var u = rn(e, c, s);
    u.t = "n", u.F = i, delete u.v, c == n.s.r && s == n.s.c && (u.f = r, a && (u.D = !0));
  }
  var f = Nt(e["!ref"]);
  return f.s.r > n.s.r && (f.s.r = n.s.r), f.s.c > n.s.c && (f.s.c = n.s.c), f.e.r < n.e.r && (f.e.r = n.e.r), f.e.c < n.e.c && (f.e.c = n.e.c), e["!ref"] = He(f), e;
}
var ut = {
  encode_col: Je,
  encode_row: er,
  encode_cell: Ge,
  encode_range: He,
  decode_col: M0,
  decode_row: L0,
  split_cell: Xf,
  decode_cell: Ir,
  decode_range: Nt,
  format_cell: Ot,
  sheet_new: qf,
  sheet_add_aoa: sc,
  sheet_add_json: hu,
  sheet_add_dom: au,
  aoa_to_sheet: Ca,
  json_to_sheet: Dv,
  table_to_sheet: nu,
  table_to_book: Xp,
  sheet_to_csv: lu,
  sheet_to_txt: Fv,
  sheet_to_json: w0,
  sheet_to_html: Gp,
  sheet_to_formulae: kv,
  sheet_to_row_object_array: w0,
  validate_merges: q0,
  measure_text_width: bc,
  auto_fit_columns: p0,
  autofit_columns: p0,
  col_width_to_px: Rt,
  px_to_col_width: function(e) {
    return la(oa(e));
  },
  row_height_to_px: Qa,
  px_to_row_height: Jh,
  sheet_get_cell: rn,
  book_new: Y0,
  book_append_sheet: on,
  book_set_sheet_visibility: yv,
  cell_set_number_format: Sv,
  cell_set_hyperlink: du,
  cell_set_internal_link: bv,
  cell_add_comment: Iv,
  sheet_set_array_formula: Nv,
  consts: {
    SHEET_VISIBLE: 0,
    SHEET_HIDDEN: 1,
    SHEET_VERY_HIDDEN: 2
  }
};
const Ov = [
  "FF000000",
  "FFFFFFFF",
  "FFFF0000",
  "FF00FF00",
  "FF0000FF",
  "FFFFFF00",
  "FFFF00FF",
  "FF00FFFF",
  // 0-7
  "FF000000",
  "FFFFFFFF",
  "FFFF0000",
  "FF00FF00",
  "FF0000FF",
  "FFFFFF00",
  "FFFF00FF",
  "FF00FFFF",
  // 8-15
  "FF800000",
  "FF008000",
  "FF000080",
  "FF808000",
  "FF800080",
  "FF008080",
  "FFC0C0C0",
  "FF808080",
  // 16-23
  "FF9999FF",
  "FF993366",
  "FFFFFFCC",
  "FFCCFFFF",
  "FF660066",
  "FFFF8080",
  "FF0066CC",
  "FFCCCCFF",
  // 24-31
  "FF000080",
  "FFFF00FF",
  "FFFFFF00",
  "FF00FFFF",
  "FF800080",
  "FF800000",
  "FF008080",
  "FF0000FF",
  // 32-39
  "FF00CCFF",
  "FFCCFFFF",
  "FFCCFFCC",
  "FFFFFF99",
  "FF99CCFF",
  "FFFF99CC",
  "FFCC99FF",
  "FFFFCC99",
  // 40-47
  "FF3366FF",
  "FF33CCCC",
  "FF99CC00",
  "FFFFCC00",
  "FFFF9900",
  "FFFF6600",
  "FF666699",
  "FF969696",
  // 48-55
  "FF003366",
  "FF339966",
  "FF003300",
  "FF333300",
  "FF993300",
  "FF993366",
  "FF333399",
  "FF333333"
  // 56-63
], Wt = 240, u0 = 255;
function Rv(e, t, r) {
  const a = Math.max(e, t, r), n = Math.min(e, t, r), i = a + n, c = a - n, s = i / 2;
  let u, f;
  if (n == a)
    return [0, s, 0];
  s <= 0.5 ? f = c / i : f = c / (2 - i);
  const o = (a - e) / c, l = (a - t) / c, x = (a - r) / c;
  return e == a ? u = x - l : t === a ? u = 2 + o - x : u = 4 + l - o, u = u / 6 % 1, [u, s, f];
}
function Bv(e) {
  e.length > 6 && (e = e.substring(2));
  const t = parseInt(e.slice(0, 2), 16) / u0, r = parseInt(e.slice(2, 4), 16) / u0, a = parseInt(e.slice(4, 6), 16) / u0, [n, i, c] = Rv(t, r, a);
  return [Math.round(n * Wt), Math.round(i * Wt), Math.round(c * Wt)];
}
function Lv(e, t, r) {
  return _u({ h: e / Wt * 360, s: r / Wt, l: t / Wt }).toHex().toUpperCase();
}
function Mv(e, t) {
  return e <= 0 ? Math.round(t * (1 + e)) : Math.round(t * (1 - e) + (Wt - Wt * (1 - e)));
}
function Pv(e, t) {
  if (!e)
    return e;
  const [r, a, n] = Bv(e);
  return `FF${Lv(r, Mv(t, a), n)}`;
}
const Uv = 8.43, Hv = 15, Vv = "#202124", Wv = 9525, is = 480, ss = 288, Gv = 24, Xv = 8, f0 = 1e5, cs = 8, zv = 128, qv = (e, t) => {
  const r = Math.max(e, 1), a = Math.max(t, 1), n = a - 1;
  if (r * a <= f0)
    return [{
      s: { r: 0, c: 0 },
      e: { r: r - 1, c: n }
    }];
  const c = Math.max(1, Math.min(zv, Math.floor(f0 / a / cs))), s = Math.max(r - c, 0), u = Math.max(1, Math.floor(f0 / a / c)), f = Math.min(cs, u, Math.ceil(r / c)), o = /* @__PURE__ */ new Set();
  for (let l = 0; l < f; l += 1) {
    const x = f === 1 ? 0 : Math.round(s * l / (f - 1));
    o.add(x);
  }
  return Array.from(o, (l) => ({
    s: { r: l, c: 0 },
    e: { r: Math.min(l + c - 1, r - 1), c: n }
  }));
}, nt = (e) => typeof e == "number" && Number.isFinite(e) ? e : void 0, $v = () => {
  var e;
  const t = ut.col_width_to_px, r = typeof t == "function" ? t(Uv) : void 0;
  return Math.ceil((e = nt(r)) !== null && e !== void 0 ? e : 64);
}, jv = () => {
  var e;
  const t = ut.row_height_to_px, r = typeof t == "function" ? t(Hv) : void 0;
  return Math.ceil((e = nt(r)) !== null && e !== void 0 ? e : 20);
}, Kv = {
  rowHeight: jv(),
  colWidth: $v()
}, Yv = (e, t) => `${e}-${t}`, us = (e) => e ? e.w !== void 0 && e.w !== null ? `${e.w}` : e.v === void 0 || e.v === null ? "" : e.t === "d" && e.v instanceof Date ? e.v.toLocaleDateString() : `${e.v}` : "", o0 = (e) => {
  if (!e)
    return;
  if (e.hidden)
    return 0;
  const t = nt(e.wpx);
  if (t !== void 0 && t >= 0)
    return Math.ceil(t);
  const r = nt(e.width);
  if (r === 0)
    return 0;
  if (r !== void 0 && r > 0) {
    const n = ut.col_width_to_px, i = typeof n == "function" ? nt(n(r)) : void 0;
    return Math.ceil(i !== void 0 ? i : r * (e.MDW || 7));
  }
  const a = nt(e.wch);
  if (a === 0)
    return 0;
  if (a !== void 0 && a > 0)
    return Math.ceil(a * (e.MDW || 7) + 5);
}, Jv = (e, t, r) => {
  var a;
  return typeof e == "number" ? e : (a = e?.[t]) !== null && a !== void 0 ? a : r;
}, Pt = (e) => (e || 0) / Wv, Zv = (e) => {
  var t, r, a;
  return e ? e.hidden ? !0 : ((t = nt(e.wpx)) !== null && t !== void 0 ? t : -1) >= 0 || ((r = nt(e.width)) !== null && r !== void 0 ? r : -1) >= 0 || ((a = nt(e.wch)) !== null && a !== void 0 ? a : -1) >= 0 : !1;
}, fs = (e) => {
  if (!e)
    return;
  if (e.hidden)
    return 0;
  const t = nt(e.hpx);
  if (t !== void 0 && t >= 0)
    return Math.ceil(t);
  const r = nt(e.hpt);
  if (r !== void 0 && r >= 0) {
    const a = ut.row_height_to_px, n = typeof a == "function" ? nt(a(r)) : void 0;
    return Math.ceil(n ?? r * 96 / 72);
  }
}, Qv = (e) => {
  switch (`${e || ""}`) {
    case "left":
      return "Left";
    case "center":
    case "centerContinuous":
    case "distributed":
    case "justify":
      return "Center";
    case "right":
      return "Right";
    default:
      return;
  }
}, eg = (e) => {
  switch (`${e || ""}`) {
    case "top":
      return "Top";
    case "center":
    case "middle":
    case "distributed":
    case "justify":
      return "Middle";
    case "bottom":
      return "Bottom";
    default:
      return;
  }
}, os = (e) => {
  if (!e)
    return "";
  const t = [
    Qv(e.horizontal),
    eg(e.vertical)
  ].filter(Boolean).map((r) => `ht${r}`);
  return e.wrapText && t.push("htWrap"), e.shrinkToFit && t.push("htShrink"), t.join(" ");
}, A0 = (e) => {
  if (!e)
    return;
  const t = e.raw_rgb && typeof e.tint == "number" ? Pv(e.raw_rgb, e.tint) : void 0, r = e.rgb || t || e.raw_rgb;
  if (typeof r == "string" && r) {
    const n = r.startsWith("#") ? r.slice(1) : r;
    return `#${n.length > 6 ? n.slice(-6) : n}`;
  }
  const a = typeof e.indexed == "number" ? e.indexed : e.index;
  if (typeof a == "number") {
    const n = Ov[a];
    if (n)
      return `#${n.slice(-6)}`;
  }
}, rg = (e) => e ? (typeof e.indexed == "number" ? e.indexed : e.index) === 32767 : !1, tg = (e) => rg(e) ? Vv : A0(e), ag = (e) => {
  switch (e) {
    case "hair":
      return "0.5px";
    case "medium":
    case "mediumDashed":
    case "mediumDashDot":
    case "mediumDashDotDot":
      return "2px";
    case "thick":
    case "double":
      return "3px";
    default:
      return "1px";
  }
}, ng = (e) => {
  switch (e) {
    case "dashed":
    case "mediumDashed":
    case "dashDot":
    case "mediumDashDot":
    case "dashDotDot":
    case "mediumDashDotDot":
    case "slantDashDot":
      return "dashed";
    case "dotted":
      return "dotted";
    case "double":
      return "double";
    default:
      return "solid";
  }
}, ig = (...e) => {
  const t = {};
  return e.forEach((r) => {
    r && Object.entries(r).forEach(([a, n]) => {
      if (n && typeof n == "object" && !Array.isArray(n)) {
        t[a] = {
          ...t[a] && typeof t[a] == "object" ? t[a] : {},
          ...n
        };
        return;
      }
      t[a] = n;
    });
  }), Object.keys(t).length ? t : void 0;
}, sg = (e) => {
  const t = {}, r = e?.fill || {}, a = A0(e?.fgColor || r.fgColor || e?.bgColor || r.bgColor), n = e?.patternType || r.patternType;
  a && n !== "none" && (t.backgroundColor = a);
  const i = e?.font || {}, c = tg(i.color || e?.color);
  c && (t.color = c), (i.italic || e?.italic) && (t.fontStyle = "italic"), (i.bold || e?.bold) && (t.fontWeight = "bold");
  const s = i.sz || e?.sz;
  s && (t.fontSize = `${s}px`);
  const u = i.name || e?.name;
  u && (t.fontFamily = u);
  const f = e?.border;
  return f && ["top", "right", "bottom", "left"].forEach((o) => {
    const l = f[o];
    if (!l?.style || l.style === "none")
      return;
    const x = `border${o.charAt(0).toUpperCase()}${o.slice(1)}`;
    t[`${x}Width`] = ag(l.style), t[`${x}Style`] = ng(l.style), t[`${x}Color`] = A0(l.color) || "#000000";
  }), Object.keys(t).length ? t : void 0;
}, cg = (e, t) => {
  for (const r of e)
    for (let a = 0; a < t; a += 1)
      (r[a] === void 0 || r[a] === null) && (r[a] = "");
  return e;
};
class tn {
  static create(t, r = {}) {
    return new tn(t, r);
  }
  constructor(t, r) {
    this._ws = t, this._startRow = Math.max(r.startRow || 0, 0), this._pageSize = Math.max(r.pageSize || 500, 1), this._totalRows = r.totalRows, this._totalCols = r.totalCols, this._charts = r.charts || [];
    const { "!ref": a } = t;
    this.range = ut.decode_range(a || "A1");
  }
  get ws() {
    return this._ws;
  }
  get defaults() {
    return tn.defaults;
  }
  get data() {
    var t;
    return (t = this._data) !== null && t !== void 0 ? t : this._data = this.getData();
  }
  get cell() {
    var t;
    return (t = this._cell) !== null && t !== void 0 ? t : this._cell = this.getCell();
  }
  get merge() {
    var t;
    return (t = this._merge) !== null && t !== void 0 ? t : this._merge = this.getMerge();
  }
  get columns() {
    var t;
    return (t = this._columns) !== null && t !== void 0 ? t : this._columns = this.getColumns();
  }
  get structure() {
    var t;
    return (t = this._structure) !== null && t !== void 0 ? t : this._structure = this.getStructure();
  }
  get rowHeights() {
    var t;
    return (t = this._rowHeights) !== null && t !== void 0 ? t : this._rowHeights = this.getRowHeights();
  }
  get colWidths() {
    var t;
    return (t = this._colWidths) !== null && t !== void 0 ? t : this._colWidths = this.getColWidths();
  }
  get meta() {
    var t;
    return (t = this._meta) !== null && t !== void 0 ? t : this._meta = {
      startRow: this.startRow,
      endRow: this.endRow,
      pageSize: this._pageSize,
      totalRows: this.totalRows,
      totalCols: this.totalCols
    };
  }
  get totalRows() {
    var t;
    return (t = this._totalRows) !== null && t !== void 0 ? t : this.range.e.r + 1;
  }
  get totalCols() {
    var t;
    return (t = this._totalCols) !== null && t !== void 0 ? t : this.range.e.c + 1;
  }
  get startRow() {
    return Math.min(this._startRow, Math.max(this.totalRows - 1, 0));
  }
  get endRow() {
    return Math.min(this.startRow + this._pageSize, this.totalRows);
  }
  get denseRows() {
    const t = this.ws;
    return Array.isArray(t) ? t : Array.isArray(t["!data"]) ? t["!data"] : void 0;
  }
  getCellAt(t, r) {
    var a;
    const n = this.denseRows;
    return n ? (a = n[t]) === null || a === void 0 ? void 0 : a[r] : this.ws[ut.encode_cell({ r: t, c: r })];
  }
  getAxisOffset(t, r, a) {
    let n = 0;
    for (let i = 0; i < t; i += 1)
      n += Jv(r, i, a);
    return n;
  }
  getMarkerLeft(t) {
    return t ? this.getAxisOffset(t.col || 0, this.getColWidths(), this.defaults.colWidth) + Pt(t.colOff) : 0;
  }
  getMarkerTop(t) {
    return t ? this.getAxisOffset(t.row || 0, this.getAllRowHeights(), this.defaults.rowHeight) + Pt(t.rowOff) : 0;
  }
  getImages() {
    const t = this.ws["!drawings"], r = t?.images || [];
    if (!r.length)
      return;
    const a = r.flatMap((n, i) => {
      var c, s, u, f, o;
      const l = n.anchor;
      if (!n.dataURI || !l)
        return [];
      const x = l.from, h = x ? this.getMarkerLeft(x) : Pt((c = l.pos) === null || c === void 0 ? void 0 : c.x), g = x ? this.getMarkerTop(x) : Pt((s = l.pos) === null || s === void 0 ? void 0 : s.y), _ = l.to ? this.getMarkerLeft(l.to) : h + Pt((u = l.ext) === null || u === void 0 ? void 0 : u.cx), d = l.to ? this.getMarkerTop(l.to) : g + Pt((f = l.ext) === null || f === void 0 ? void 0 : f.cy);
      return [{
        id: n.id || ((o = n.objectId) === null || o === void 0 ? void 0 : o.toString()) || n.target || `image-${i + 1}`,
        src: n.dataURI,
        contentType: n.contentType,
        left: Math.max(0, h),
        top: Math.max(0, g),
        width: Math.max(1, _ > h ? _ - h : is),
        height: Math.max(1, d > g ? d - g : ss),
        row: x?.row || 0,
        col: x?.col || 0
      }];
    });
    return a.length ? a : void 0;
  }
  getCharts() {
    const t = this._charts.map((r) => {
      var a, n;
      const i = this.getMarkerLeft(r.from), c = this.getMarkerTop(r.from), s = r.to ? this.getMarkerLeft(r.to) : i + Pt((a = r.ext) === null || a === void 0 ? void 0 : a.width), u = r.to ? this.getMarkerTop(r.to) : c + Pt((n = r.ext) === null || n === void 0 ? void 0 : n.height);
      return {
        id: r.id,
        type: r.type,
        title: r.title,
        categoryAxisTitle: r.categoryAxisTitle,
        valueAxisTitle: r.valueAxisTitle,
        barDirection: r.barDirection,
        grouping: r.grouping,
        legendPosition: r.legendPosition,
        series: r.series,
        left: Math.max(0, i),
        top: Math.max(0, c),
        width: Math.max(1, s > i ? s - i : is),
        height: Math.max(1, u > c ? u - c : ss),
        row: r.from.row,
        col: r.from.col
      };
    });
    return t.length ? t : void 0;
  }
  getAllMerge() {
    const t = this.ws, { "!merges": r = [] } = t;
    return r.map((a) => {
      const { r: n, c: i } = a.s, { r: c, c: s } = a.e;
      return {
        row: n,
        col: i,
        rowspan: c - n + 1,
        colspan: s - i + 1
      };
    });
  }
  getData() {
    const t = [], r = this.denseRows;
    for (let a = this.startRow; a < this.endRow; a += 1) {
      const n = r?.[a], i = n ? n.slice(0, this.totalCols).map((c) => us(c)) : Array.from({ length: this.totalCols }, (c, s) => us(this.getCellAt(a, s)));
      t.push(i);
    }
    return cg(t, this.totalCols);
  }
  getCell() {
    var t, r;
    const a = {}, { "!cols": n = [], "!rows": i = [] } = this.ws;
    for (let c = this.startRow; c < this.endRow; c += 1)
      for (let s = 0; s < this.totalCols; s += 1) {
        const u = this.getCellAt(c, s), f = ig((t = n[s]) === null || t === void 0 ? void 0 : t.s, (r = i[c]) === null || r === void 0 ? void 0 : r.s, u?.s), o = os(f?.alignment), l = sg(f);
        !o && !l || (a[Yv(c - this.startRow, s)] = {
          ...o ? { className: o } : {},
          style: l || {}
        });
      }
    return a;
  }
  getMerge() {
    return this.getAllMerge().flatMap((t) => t.row + t.rowspan - 1 < this.startRow || t.row >= this.endRow || t.row < this.startRow ? [] : {
      ...t,
      row: t.row - this.startRow
    });
  }
  getRowHeights() {
    const { rowHeight: t } = this.defaults, { "!rows": r = [] } = this.ws, a = [];
    if (r.length && this.endRow > this.startRow)
      for (let n = this.startRow; n < this.endRow; n += 1) {
        const i = fs(r[n]);
        i !== void 0 && (a[n - this.startRow] = i);
      }
    return a.length === 1 ? a[0] : a.length ? a : t;
  }
  // 整表行高必须按绝对行号下发，否则拖动滚动条时隐藏行和特殊行高会造成高度跳变。
  getAllRowHeights() {
    const { "!rows": t = [] } = this.ws, r = [];
    if (t.length)
      for (let a = 0; a < this.totalRows; a += 1) {
        const n = fs(t[a]);
        n !== void 0 && (r[a] = n);
      }
    return r.length ? r : void 0;
  }
  getAutoFitColumns() {
    var t, r;
    const a = ut.auto_fit_columns || ut.autofit_columns;
    if (typeof a == "function")
      try {
        const n = this.getAutoFitSampleRanges(), i = [];
        for (const c of n) {
          const s = a(this.ws, {
            range: c,
            set: !1,
            skipHidden: !0,
            includeMerged: !1,
            minPx: Gv,
            padding: Xv
          });
          for (let u = 0; u < this.totalCols; u += 1) {
            const f = s?.[u];
            if (!f)
              continue;
            const o = (t = o0(i[u])) !== null && t !== void 0 ? t : -1, l = (r = o0(f)) !== null && r !== void 0 ? r : -1;
            (!i[u] || l > o) && (i[u] = f);
          }
        }
        return i.length ? i : void 0;
      } catch (n) {
        console.warn("[file-viewer] Excel 自动列宽计算失败，已回退到原始列宽。", n);
        return;
      }
  }
  getAutoFitSampleRanges() {
    return qv(this.totalRows, this.totalCols);
  }
  get autoFitColumns() {
    return this._autoFitColumns === void 0 && (this._autoFitColumns = this.getAutoFitColumns() || null), this._autoFitColumns || void 0;
  }
  getColumnMeta(t, r) {
    var a;
    const n = t[r];
    return Zv(n) ? n : ((a = this.autoFitColumns) === null || a === void 0 ? void 0 : a[r]) || n;
  }
  getColWidths() {
    const { colWidth: t } = this.defaults, { "!cols": r = [] } = this.ws, a = [];
    for (let n = 0; n < this.totalCols; n += 1) {
      const i = o0(this.getColumnMeta(r, n));
      i !== void 0 && (a[n] = i);
    }
    return a.length ? a : t;
  }
  getColumns() {
    const { "!cols": t = [] } = this.ws;
    return Array.from({ length: this.totalCols }, (r, a) => {
      var n;
      const i = this.getColumnMeta(t, a);
      return {
        key: a + 1,
        title: ut.encode_col(a),
        hidden: !!i?.hidden,
        editor: !1,
        className: os((n = i?.s) === null || n === void 0 ? void 0 : n.alignment),
        renderer: "styleRender"
      };
    });
  }
  getStructure() {
    return {
      merge: this.getAllMerge(),
      colWidths: this.getColWidths(),
      rowHeights: this.getAllRowHeights(),
      columns: this.getColumns(),
      images: this.getImages(),
      charts: this.getCharts()
    };
  }
  toObject(t = {}) {
    const { defaults: r, data: a, cell: n, merge: i, rowHeights: c, meta: s } = this;
    return {
      defaults: r,
      data: a,
      cell: n,
      merge: i,
      rowHeights: c,
      ...t.includeLayout === !1 ? {} : {
        colWidths: this.colWidths,
        columns: this.columns
      },
      meta: s
    };
  }
}
tn.defaults = Kv;
var Ia = {}, vt = {}, Yt = {}, ls;
function jn() {
  if (ls) return Yt;
  ls = 1;
  function e(i, c, s) {
    if (s === void 0 && (s = Array.prototype), i && typeof s.find == "function")
      return s.find.call(i, c);
    for (var u = 0; u < i.length; u++)
      if (Object.prototype.hasOwnProperty.call(i, u)) {
        var f = i[u];
        if (c.call(void 0, f, u, i))
          return f;
      }
  }
  function t(i, c) {
    return c === void 0 && (c = Object), c && typeof c.freeze == "function" ? c.freeze(i) : i;
  }
  function r(i, c) {
    if (i === null || typeof i != "object")
      throw new TypeError("target is not an object");
    for (var s in c)
      Object.prototype.hasOwnProperty.call(c, s) && (i[s] = c[s]);
    return i;
  }
  var a = t({
    /**
     * `text/html`, the only mime type that triggers treating an XML document as HTML.
     *
     * @see DOMParser.SupportedType.isHTML
     * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
     * @see https://en.wikipedia.org/wiki/HTML Wikipedia
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
     * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring WHATWG HTML Spec
     */
    HTML: "text/html",
    /**
     * Helper method to check a mime type if it indicates an HTML document
     *
     * @param {string} [value]
     * @returns {boolean}
     *
     * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
     * @see https://en.wikipedia.org/wiki/HTML Wikipedia
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
     * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring 	 */
    isHTML: function(i) {
      return i === a.HTML;
    },
    /**
     * `application/xml`, the standard mime type for XML documents.
     *
     * @see https://www.iana.org/assignments/media-types/application/xml IANA MimeType registration
     * @see https://tools.ietf.org/html/rfc7303#section-9.1 RFC 7303
     * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
     */
    XML_APPLICATION: "application/xml",
    /**
     * `text/html`, an alias for `application/xml`.
     *
     * @see https://tools.ietf.org/html/rfc7303#section-9.2 RFC 7303
     * @see https://www.iana.org/assignments/media-types/text/xml IANA MimeType registration
     * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
     */
    XML_TEXT: "text/xml",
    /**
     * `application/xhtml+xml`, indicates an XML document that has the default HTML namespace,
     * but is parsed as an XML document.
     *
     * @see https://www.iana.org/assignments/media-types/application/xhtml+xml IANA MimeType registration
     * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument WHATWG DOM Spec
     * @see https://en.wikipedia.org/wiki/XHTML Wikipedia
     */
    XML_XHTML_APPLICATION: "application/xhtml+xml",
    /**
     * `image/svg+xml`,
     *
     * @see https://www.iana.org/assignments/media-types/image/svg+xml IANA MimeType registration
     * @see https://www.w3.org/TR/SVG11/ W3C SVG 1.1
     * @see https://en.wikipedia.org/wiki/Scalable_Vector_Graphics Wikipedia
     */
    XML_SVG_IMAGE: "image/svg+xml"
  }), n = t({
    /**
     * The XHTML namespace.
     *
     * @see http://www.w3.org/1999/xhtml
     */
    HTML: "http://www.w3.org/1999/xhtml",
    /**
     * Checks if `uri` equals `NAMESPACE.HTML`.
     *
     * @param {string} [uri]
     *
     * @see NAMESPACE.HTML
     */
    isHTML: function(i) {
      return i === n.HTML;
    },
    /**
     * The SVG namespace.
     *
     * @see http://www.w3.org/2000/svg
     */
    SVG: "http://www.w3.org/2000/svg",
    /**
     * The `xml:` namespace.
     *
     * @see http://www.w3.org/XML/1998/namespace
     */
    XML: "http://www.w3.org/XML/1998/namespace",
    /**
     * The `xmlns:` namespace
     *
     * @see https://www.w3.org/2000/xmlns/
     */
    XMLNS: "http://www.w3.org/2000/xmlns/"
  });
  return Yt.assign = r, Yt.find = e, Yt.freeze = t, Yt.MIME_TYPE = a, Yt.NAMESPACE = n, Yt;
}
var hs;
function xu() {
  if (hs) return vt;
  hs = 1;
  var e = jn(), t = e.find, r = e.NAMESPACE;
  function a(E) {
    return E !== "";
  }
  function n(E) {
    return E ? E.split(/[\t\n\f\r ]+/).filter(a) : [];
  }
  function i(E, k) {
    return E.hasOwnProperty(k) || (E[k] = !0), E;
  }
  function c(E) {
    if (!E) return [];
    var k = n(E);
    return Object.keys(k.reduce(i, {}));
  }
  function s(E) {
    return function(k) {
      return E && E.indexOf(k) !== -1;
    };
  }
  function u(E, k) {
    for (var B in E)
      Object.prototype.hasOwnProperty.call(E, B) && (k[B] = E[B]);
  }
  function f(E, k) {
    var B = E.prototype;
    if (!(B instanceof k)) {
      let Q = function() {
      };
      Q.prototype = k.prototype, Q = new Q(), u(B, Q), E.prototype = B = Q;
    }
    B.constructor != E && (typeof E != "function" && console.error("unknown Class:" + E), B.constructor = E);
  }
  var o = {}, l = o.ELEMENT_NODE = 1, x = o.ATTRIBUTE_NODE = 2, h = o.TEXT_NODE = 3, g = o.CDATA_SECTION_NODE = 4, _ = o.ENTITY_REFERENCE_NODE = 5, d = o.ENTITY_NODE = 6, p = o.PROCESSING_INSTRUCTION_NODE = 7, w = o.COMMENT_NODE = 8, m = o.DOCUMENT_NODE = 9, y = o.DOCUMENT_TYPE_NODE = 10, M = o.DOCUMENT_FRAGMENT_NODE = 11, W = o.NOTATION_NODE = 12, I = {}, L = {};
  I.INDEX_SIZE_ERR = (L[1] = "Index size error", 1), I.DOMSTRING_SIZE_ERR = (L[2] = "DOMString size error", 2);
  var A = I.HIERARCHY_REQUEST_ERR = (L[3] = "Hierarchy request error", 3);
  I.WRONG_DOCUMENT_ERR = (L[4] = "Wrong document", 4);
  var N = I.INVALID_CHARACTER_ERR = (L[5] = "Invalid character", 5);
  I.NO_DATA_ALLOWED_ERR = (L[6] = "No data allowed", 6), I.NO_MODIFICATION_ALLOWED_ERR = (L[7] = "No modification allowed", 7);
  var R = I.NOT_FOUND_ERR = (L[8] = "Not found", 8);
  I.NOT_SUPPORTED_ERR = (L[9] = "Not supported", 9);
  var V = I.INUSE_ATTRIBUTE_ERR = (L[10] = "Attribute in use", 10), ae = I.INVALID_STATE_ERR = (L[11] = "Invalid state", 11);
  I.SYNTAX_ERR = (L[12] = "Syntax error", 12), I.INVALID_MODIFICATION_ERR = (L[13] = "Invalid modification", 13), I.NAMESPACE_ERR = (L[14] = "Invalid namespace", 14), I.INVALID_ACCESS_ERR = (L[15] = "Invalid access", 15);
  function K(E, k) {
    if (k instanceof Error)
      var B = k;
    else
      B = this, Error.call(this, L[E]), this.message = L[E], Error.captureStackTrace && Error.captureStackTrace(this, K);
    return B.code = E, k && (this.message = this.message + ": " + k), B;
  }
  K.prototype = Error.prototype, u(I, K);
  function J() {
  }
  J.prototype = {
    /**
     * The number of nodes in the list. The range of valid child node indices is 0 to length-1 inclusive.
     * @standard level1
     */
    length: 0,
    /**
     * Returns the indexth item in the collection. If index is greater than or equal to the number of nodes in the list, this returns null.
     * @standard level1
     * @param index  unsigned long
     *   Index into the collection.
     * @return Node
     * 	The node at the indexth position in the NodeList, or null if that is not a valid index.
     */
    item: function(E) {
      return E >= 0 && E < this.length ? this[E] : null;
    },
    toString: function(E, k, B) {
      for (var Q = !!B && !!B.requireWellFormed, ge = [], ye = 0; ye < this.length; ye++)
        Yr(this[ye], ge, E, k, null, Q);
      return ge.join("");
    },
    /**
     * @private
     * @param {function (Node):boolean} predicate
     * @returns {Node[]}
     */
    filter: function(E) {
      return Array.prototype.filter.call(this, E);
    },
    /**
     * @private
     * @param {Node} item
     * @returns {number}
     */
    indexOf: function(E) {
      return Array.prototype.indexOf.call(this, E);
    }
  };
  function fe(E, k) {
    this._node = E, this._refresh = k, Y(this);
  }
  function Y(E) {
    var k = E._node._inc || E._node.ownerDocument._inc;
    if (E._inc !== k) {
      var B = E._refresh(E._node);
      if ($t(E, "length", B.length), !E.$$length || B.length < E.$$length)
        for (var Q = B.length; Q in E; Q++)
          Object.prototype.hasOwnProperty.call(E, Q) && delete E[Q];
      u(B, E), E._inc = k;
    }
  }
  fe.prototype.item = function(E) {
    return Y(this), this[E] || null;
  }, f(fe, J);
  function oe() {
  }
  function ce(E, k) {
    for (var B = E.length; B--; )
      if (E[B] === k)
        return B;
  }
  function re(E, k, B, Q) {
    if (Q ? k[ce(k, Q)] = B : k[k.length++] = B, E) {
      B.ownerElement = E;
      var ge = E.ownerDocument;
      ge && (Q && G(ge, E, Q), S(ge, E, B));
    }
  }
  function De(E, k, B) {
    var Q = ce(k, B);
    if (Q >= 0) {
      for (var ge = k.length - 1; Q < ge; )
        k[Q] = k[++Q];
      if (k.length = ge, E) {
        var ye = E.ownerDocument;
        ye && (G(ye, E, B), B.ownerElement = null);
      }
    } else
      throw new K(R, new Error(E.tagName + "@" + B));
  }
  oe.prototype = {
    length: 0,
    item: J.prototype.item,
    getNamedItem: function(E) {
      for (var k = this.length; k--; ) {
        var B = this[k];
        if (B.nodeName == E)
          return B;
      }
    },
    setNamedItem: function(E) {
      var k = E.ownerElement;
      if (k && k != this._ownerElement)
        throw new K(V);
      var B = this.getNamedItem(E.nodeName);
      return re(this._ownerElement, this, E, B), B;
    },
    /* returns Node */
    setNamedItemNS: function(E) {
      var k = E.ownerElement, B;
      if (k && k != this._ownerElement)
        throw new K(V);
      return B = this.getNamedItemNS(E.namespaceURI, E.localName), re(this._ownerElement, this, E, B), B;
    },
    /* returns Node */
    removeNamedItem: function(E) {
      var k = this.getNamedItem(E);
      return De(this._ownerElement, this, k), k;
    },
    // raises: NOT_FOUND_ERR,NO_MODIFICATION_ALLOWED_ERR
    //for level2
    removeNamedItemNS: function(E, k) {
      var B = this.getNamedItemNS(E, k);
      return De(this._ownerElement, this, B), B;
    },
    getNamedItemNS: function(E, k) {
      for (var B = this.length; B--; ) {
        var Q = this[B];
        if (Q.localName == k && Q.namespaceURI == E)
          return Q;
      }
      return null;
    }
  };
  function be() {
  }
  be.prototype = {
    /**
     * The DOMImplementation.hasFeature() method returns a Boolean flag indicating if a given feature is supported.
     * The different implementations fairly diverged in what kind of features were reported.
     * The latest version of the spec settled to force this method to always return true, where the functionality was accurate and in use.
     *
     * @deprecated It is deprecated and modern browsers return true in all cases.
     *
     * @param {string} feature
     * @param {string} [version]
     * @returns {boolean} always true
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/hasFeature MDN
     * @see https://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-5CED94D7 DOM Level 1 Core
     * @see https://dom.spec.whatwg.org/#dom-domimplementation-hasfeature DOM Living Standard
     */
    hasFeature: function(E, k) {
      return !0;
    },
    /**
     * Creates an XML Document object of the specified type with its document element.
     *
     * __It behaves slightly different from the description in the living standard__:
     * - There is no interface/class `XMLDocument`, it returns a `Document` instance.
     * - `contentType`, `encoding`, `mode`, `origin`, `url` fields are currently not declared.
     * - this implementation is not validating names or qualified names
     *   (when parsing XML strings, the SAX parser takes care of that)
     *
     * @param {string|null} namespaceURI
     * @param {string} qualifiedName
     * @param {DocumentType=null} doctype
     * @returns {Document}
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocument MDN
     * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocument DOM Level 2 Core (initial)
     * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument  DOM Level 2 Core
     *
     * @see https://dom.spec.whatwg.org/#validate-and-extract DOM: Validate and extract
     * @see https://www.w3.org/TR/xml/#NT-NameStartChar XML Spec: Names
     * @see https://www.w3.org/TR/xml-names/#ns-qualnames XML Namespaces: Qualified names
     */
    createDocument: function(E, k, B) {
      var Q = new Ne();
      if (Q.implementation = this, Q.childNodes = new J(), Q.doctype = B || null, B && Q.appendChild(B), k) {
        var ge = Q.createElementNS(E, k);
        Q.appendChild(ge);
      }
      return Q;
    },
    /**
     * Returns a doctype, with the given `qualifiedName`, `publicId`, and `systemId`.
     *
     * __This implementation differs from the specification:__
     * - this implementation is not validating names or qualified names
     *   (when parsing XML strings, the SAX parser takes care of that)
     *
     * Note: `internalSubset` can only be introduced via a direct property write to `node.internalSubset` after creation.
     * Creation-time validation of `publicId`, `systemId` is not enforced.
     * The serializer-level check covers all mutation vectors, including direct property writes.
     * `internalSubset` is only serialized as `[ ... ]` when both `publicId` and `systemId` are
     * absent (empty or `'.'`) — if either external identifier is present, `internalSubset` is
     * silently omitted from the serialized output.
     *
     * @param {string} qualifiedName
     * @param {string} [publicId]
     * The external subset public identifier. Stored verbatim including surrounding quotes.
     * When serialized with `requireWellFormed: true` (via the 4th-parameter options object),
     * throws `DOMException` with code `INVALID_STATE_ERR` if the value is non-empty and does
     * not match the XML `PubidLiteral` production (W3C DOM Parsing §3.2.1.3; XML 1.0 [12]).
     * @param {string} [systemId]
     * The external subset system identifier. Stored verbatim including surrounding quotes.
     * When serialized with `requireWellFormed: true`, throws `DOMException` with code
     * `INVALID_STATE_ERR` if the value is non-empty and does not match the XML `SystemLiteral`
     * production (W3C DOM Parsing §3.2.1.3; XML 1.0 [11]).
     * @returns {DocumentType} which can either be used with `DOMImplementation.createDocument` upon document creation
     * 				  or can be put into the document via methods like `Node.insertBefore()` or `Node.replaceChild()`
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocumentType MDN
     * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocType DOM Level 2 Core
     * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocumenttype DOM Living Standard
     *
     * @see https://dom.spec.whatwg.org/#validate-and-extract DOM: Validate and extract
     * @see https://www.w3.org/TR/xml/#NT-NameStartChar XML Spec: Names
     * @see https://www.w3.org/TR/xml-names/#ns-qualnames XML Namespaces: Qualified names
     */
    createDocumentType: function(E, k, B) {
      var Q = new Oe();
      return Q.name = E, Q.nodeName = E, Q.publicId = k || "", Q.systemId = B || "", Q;
    }
  };
  function de() {
  }
  de.prototype = {
    firstChild: null,
    lastChild: null,
    previousSibling: null,
    nextSibling: null,
    attributes: null,
    parentNode: null,
    childNodes: null,
    ownerDocument: null,
    nodeValue: null,
    namespaceURI: null,
    prefix: null,
    localName: null,
    // Modified in DOM Level 2:
    insertBefore: function(E, k) {
      return Pe(this, E, k);
    },
    replaceChild: function(E, k) {
      Pe(this, E, k, Ie), k && this.removeChild(k);
    },
    removeChild: function(E) {
      return P(this, E);
    },
    appendChild: function(E) {
      return this.insertBefore(E, null);
    },
    hasChildNodes: function() {
      return this.firstChild != null;
    },
    cloneNode: function(E) {
      return xt(this.ownerDocument || this, this, E);
    },
    // Modified in DOM Level 2:
    /**
     * Puts the specified node and all of its subtree into a "normalized" form. In a normalized
     * subtree, no text nodes in the subtree are empty and there are no adjacent text nodes.
     *
     * Specifically, this method merges any adjacent text nodes (i.e., nodes for which `nodeType`
     * is `TEXT_NODE`) into a single node with the combined data. It also removes any empty text
     * nodes.
     *
     * This method iteratively traverses all child nodes to normalize all descendant nodes within
     * the subtree.
     *
     * @throws {DOMException}
     * May throw a DOMException if operations within removeChild or appendData (which are
     * potentially invoked in this method) do not meet their specific constraints.
     * @see {@link Node.removeChild}
     * @see {@link CharacterData.appendData}
     * @see ../docs/walk-dom.md.
     */
    normalize: function() {
      _e(this, null, {
        enter: function(E) {
          for (var k = E.firstChild; k; ) {
            var B = k.nextSibling;
            B !== null && B.nodeType === h && k.nodeType === h ? (E.removeChild(B), k.appendData(B.data)) : k = B;
          }
          return !0;
        }
      });
    },
    // Introduced in DOM Level 2:
    isSupported: function(E, k) {
      return this.ownerDocument.implementation.hasFeature(E, k);
    },
    // Introduced in DOM Level 2:
    hasAttributes: function() {
      return this.attributes.length > 0;
    },
    /**
     * Look up the prefix associated to the given namespace URI, starting from this node.
     * **The default namespace declarations are ignored by this method.**
     * See Namespace Prefix Lookup for details on the algorithm used by this method.
     *
     * _Note: The implementation seems to be incomplete when compared to the algorithm described in the specs._
     *
     * @param {string | null} namespaceURI
     * @returns {string | null}
     * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespacePrefix
     * @see https://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#lookupNamespacePrefixAlgo
     * @see https://dom.spec.whatwg.org/#dom-node-lookupprefix
     * @see https://github.com/xmldom/xmldom/issues/322
     */
    lookupPrefix: function(E) {
      for (var k = this; k; ) {
        var B = k._nsMap;
        if (B) {
          for (var Q in B)
            if (Object.prototype.hasOwnProperty.call(B, Q) && B[Q] === E)
              return Q;
        }
        k = k.nodeType == x ? k.ownerDocument : k.parentNode;
      }
      return null;
    },
    // Introduced in DOM Level 3:
    lookupNamespaceURI: function(E) {
      for (var k = this; k; ) {
        var B = k._nsMap;
        if (B && Object.prototype.hasOwnProperty.call(B, E))
          return B[E];
        k = k.nodeType == x ? k.ownerDocument : k.parentNode;
      }
      return null;
    },
    // Introduced in DOM Level 3:
    isDefaultNamespace: function(E) {
      var k = this.lookupPrefix(E);
      return k == null;
    }
  };
  function ie(E) {
    return E == "<" && "&lt;" || E == ">" && "&gt;" || E == "&" && "&amp;" || E == '"' && "&quot;" || "&#" + E.charCodeAt() + ";";
  }
  u(o, de), u(o, de.prototype);
  function Se(E, k) {
    return _e(E, null, { enter: function(B) {
      return k(B) ? _e.STOP : !0;
    } }) === _e.STOP;
  }
  function _e(E, k, B) {
    for (var Q = [{ node: E, context: k, phase: _e.ENTER }]; Q.length > 0; ) {
      var ge = Q.pop();
      if (ge.phase === _e.ENTER) {
        var ye = B.enter(ge.node, ge.context);
        if (ye === _e.STOP)
          return _e.STOP;
        if (Q.push({ node: ge.node, context: ye, phase: _e.EXIT }), ye == null)
          continue;
        for (var xe = ge.node.lastChild; xe; )
          Q.push({ node: xe, context: ye, phase: _e.ENTER }), xe = xe.previousSibling;
      } else
        B.exit && B.exit(ge.node, ge.context);
    }
  }
  _e.STOP = /* @__PURE__ */ Symbol("walkDOM.STOP"), _e.ENTER = 0, _e.EXIT = 1;
  function Ne() {
    this.ownerDocument = this;
  }
  function S(E, k, B) {
    E && E._inc++;
    var Q = B.namespaceURI;
    Q === r.XMLNS && (k._nsMap[B.prefix ? B.localName : ""] = B.value);
  }
  function G(E, k, B, Q) {
    E && E._inc++;
    var ge = B.namespaceURI;
    ge === r.XMLNS && delete k._nsMap[B.prefix ? B.localName : ""];
  }
  function H(E, k, B) {
    if (E && E._inc) {
      E._inc++;
      var Q = k.childNodes;
      if (B)
        Q[Q.length++] = B;
      else {
        for (var ge = k.firstChild, ye = 0; ge; )
          Q[ye++] = ge, ge = ge.nextSibling;
        Q.length = ye, delete Q[Q.length];
      }
    }
  }
  function P(E, k) {
    var B = k.previousSibling, Q = k.nextSibling;
    return B ? B.nextSibling = Q : E.firstChild = Q, Q ? Q.previousSibling = B : E.lastChild = B, k.parentNode = null, k.previousSibling = null, k.nextSibling = null, H(E.ownerDocument, E), k;
  }
  function ee(E) {
    return E && (E.nodeType === de.DOCUMENT_NODE || E.nodeType === de.DOCUMENT_FRAGMENT_NODE || E.nodeType === de.ELEMENT_NODE);
  }
  function Fe(E) {
    return E && (ue(E) || se(E) || te(E) || E.nodeType === de.DOCUMENT_FRAGMENT_NODE || E.nodeType === de.COMMENT_NODE || E.nodeType === de.PROCESSING_INSTRUCTION_NODE);
  }
  function te(E) {
    return E && E.nodeType === de.DOCUMENT_TYPE_NODE;
  }
  function ue(E) {
    return E && E.nodeType === de.ELEMENT_NODE;
  }
  function se(E) {
    return E && E.nodeType === de.TEXT_NODE;
  }
  function Ce(E, k) {
    var B = E.childNodes || [];
    if (t(B, ue) || te(k))
      return !1;
    var Q = t(B, te);
    return !(k && Q && B.indexOf(Q) > B.indexOf(k));
  }
  function Ae(E, k) {
    var B = E.childNodes || [];
    function Q(ye) {
      return ue(ye) && ye !== k;
    }
    if (t(B, Q))
      return !1;
    var ge = t(B, te);
    return !(k && ge && B.indexOf(ge) > B.indexOf(k));
  }
  function Te(E, k, B) {
    if (!ee(E))
      throw new K(A, "Unexpected parent node type " + E.nodeType);
    if (B && B.parentNode !== E)
      throw new K(R, "child not in parent");
    if (
      // 4. If `node` is not a DocumentFragment, DocumentType, Element, or CharacterData node, then throw a "HierarchyRequestError" DOMException.
      !Fe(k) || // 5. If either `node` is a Text node and `parent` is a document,
      // the sax parser currently adds top level text nodes, this will be fixed in 0.9.0
      // || (node.nodeType === Node.TEXT_NODE && parent.nodeType === Node.DOCUMENT_NODE)
      // or `node` is a doctype and `parent` is not a document, then throw a "HierarchyRequestError" DOMException.
      te(k) && E.nodeType !== de.DOCUMENT_NODE
    )
      throw new K(
        A,
        "Unexpected node type " + k.nodeType + " for parent node type " + E.nodeType
      );
  }
  function ze(E, k, B) {
    var Q = E.childNodes || [], ge = k.childNodes || [];
    if (k.nodeType === de.DOCUMENT_FRAGMENT_NODE) {
      var ye = ge.filter(ue);
      if (ye.length > 1 || t(ge, se))
        throw new K(A, "More than one element or text in fragment");
      if (ye.length === 1 && !Ce(E, B))
        throw new K(A, "Element in fragment can not be inserted before doctype");
    }
    if (ue(k) && !Ce(E, B))
      throw new K(A, "Only one element can be added and only after doctype");
    if (te(k)) {
      if (t(Q, te))
        throw new K(A, "Only one doctype is allowed");
      var xe = t(Q, ue);
      if (B && Q.indexOf(xe) < Q.indexOf(B))
        throw new K(A, "Doctype can only be inserted before an element");
      if (!B && xe)
        throw new K(A, "Doctype can not be appended since element is present");
    }
  }
  function Ie(E, k, B) {
    var Q = E.childNodes || [], ge = k.childNodes || [];
    if (k.nodeType === de.DOCUMENT_FRAGMENT_NODE) {
      var ye = ge.filter(ue);
      if (ye.length > 1 || t(ge, se))
        throw new K(A, "More than one element or text in fragment");
      if (ye.length === 1 && !Ae(E, B))
        throw new K(A, "Element in fragment can not be inserted before doctype");
    }
    if (ue(k) && !Ae(E, B))
      throw new K(A, "Only one element can be added and only after doctype");
    if (te(k)) {
      if (t(Q, function(Me) {
        return te(Me) && Me !== B;
      }))
        throw new K(A, "Only one doctype is allowed");
      var xe = t(Q, ue);
      if (B && Q.indexOf(xe) < Q.indexOf(B))
        throw new K(A, "Doctype can only be inserted before an element");
    }
  }
  function Pe(E, k, B, Q) {
    Te(E, k, B), E.nodeType === de.DOCUMENT_NODE && (Q || ze)(E, k, B);
    var ge = k.parentNode;
    if (ge && ge.removeChild(k), k.nodeType === M) {
      var ye = k.firstChild;
      if (ye == null)
        return k;
      var xe = k.lastChild;
    } else
      ye = xe = k;
    var Ve = B ? B.previousSibling : E.lastChild;
    ye.previousSibling = Ve, xe.nextSibling = B, Ve ? Ve.nextSibling = ye : E.firstChild = ye, B == null ? E.lastChild = xe : B.previousSibling = xe;
    do {
      ye.parentNode = E;
      var Me = E.ownerDocument || E;
      we(ye, Me);
    } while (ye !== xe && (ye = ye.nextSibling));
    return H(E.ownerDocument || E, E), k.nodeType == M && (k.firstChild = k.lastChild = null), k;
  }
  function we(E, k) {
    if (E.ownerDocument !== k) {
      if (E.ownerDocument = k, E.nodeType === l && E.attributes)
        for (var B = 0; B < E.attributes.length; B++) {
          var Q = E.attributes.item(B);
          Q && (Q.ownerDocument = k);
        }
      for (var ge = E.firstChild; ge; )
        we(ge, k), ge = ge.nextSibling;
    }
  }
  function qe(E, k) {
    k.parentNode && k.parentNode.removeChild(k), k.parentNode = E, k.previousSibling = E.lastChild, k.nextSibling = null, k.previousSibling ? k.previousSibling.nextSibling = k : E.firstChild = k, E.lastChild = k, H(E.ownerDocument, E, k);
    var B = E.ownerDocument || E;
    return we(k, B), k;
  }
  Ne.prototype = {
    //implementation : null,
    nodeName: "#document",
    nodeType: m,
    /**
     * The DocumentType node of the document.
     *
     * @readonly
     * @type DocumentType
     */
    doctype: null,
    documentElement: null,
    _inc: 1,
    insertBefore: function(E, k) {
      if (E.nodeType == M) {
        for (var B = E.firstChild; B; ) {
          var Q = B.nextSibling;
          this.insertBefore(B, k), B = Q;
        }
        return E;
      }
      return Pe(this, E, k), we(E, this), this.documentElement === null && E.nodeType === l && (this.documentElement = E), E;
    },
    removeChild: function(E) {
      return this.documentElement == E && (this.documentElement = null), P(this, E);
    },
    replaceChild: function(E, k) {
      Pe(this, E, k, Ie), we(E, this), k && this.removeChild(k), ue(E) && (this.documentElement = E);
    },
    // Introduced in DOM Level 2:
    importNode: function(E, k) {
      return va(this, E, k);
    },
    // Introduced in DOM Level 2:
    getElementById: function(E) {
      var k = null;
      return Se(this.documentElement, function(B) {
        if (B.nodeType == l && B.getAttribute("id") == E)
          return k = B, !0;
      }), k;
    },
    /**
     * The `getElementsByClassName` method of `Document` interface returns an array-like object
     * of all child elements which have **all** of the given class name(s).
     *
     * Returns an empty list if `classeNames` is an empty string or only contains HTML white space characters.
     *
     *
     * Warning: This is a live LiveNodeList.
     * Changes in the DOM will reflect in the array as the changes occur.
     * If an element selected by this array no longer qualifies for the selector,
     * it will automatically be removed. Be aware of this for iteration purposes.
     *
     * @param {string} classNames is a string representing the class name(s) to match; multiple class names are separated by (ASCII-)whitespace
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/getElementsByClassName
     * @see https://dom.spec.whatwg.org/#concept-getelementsbyclassname
     */
    getElementsByClassName: function(E) {
      var k = c(E);
      return new fe(this, function(B) {
        var Q = [];
        return k.length > 0 && Se(B.documentElement, function(ge) {
          if (ge !== B && ge.nodeType === l) {
            var ye = ge.getAttribute("class");
            if (ye) {
              var xe = E === ye;
              if (!xe) {
                var Ve = c(ye);
                xe = k.every(s(Ve));
              }
              xe && Q.push(ge);
            }
          }
        }), Q;
      });
    },
    //document factory method:
    createElement: function(E) {
      var k = new pe();
      k.ownerDocument = this, k.nodeName = E, k.tagName = E, k.localName = E, k.childNodes = new J();
      var B = k.attributes = new oe();
      return B._ownerElement = k, k;
    },
    createDocumentFragment: function() {
      var E = new O();
      return E.ownerDocument = this, E.childNodes = new J(), E;
    },
    createTextNode: function(E) {
      var k = new rr();
      return k.ownerDocument = this, k.appendData(E), k;
    },
    createComment: function(E) {
      var k = new jr();
      return k.ownerDocument = this, k.appendData(E), k;
    },
    /**
     * Returns a new CDATASection node whose data is `data`.
     *
     * __This implementation differs from the specification:__
     * - calling this method on an HTML document does not throw `NotSupportedError`.
     *
     * @param {string} data
     * @returns {CDATASection}
     * @throws DOMException with code `INVALID_CHARACTER_ERR` if `data` contains `"]]>"`.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createCDATASection
     * @see https://dom.spec.whatwg.org/#dom-document-createcdatasection
     */
    createCDATASection: function(E) {
      if (E.indexOf("]]>") !== -1)
        throw new K(N, 'data contains "]]>"');
      var k = new Kr();
      return k.ownerDocument = this, k.appendData(E), k;
    },
    /**
     * Returns a ProcessingInstruction node whose target is target and data is data.
     *
     * __This implementation differs from the specification:__
     * - it does not do any input validation on the arguments and doesn't throw "InvalidCharacterError".
     *
     * Note: When the resulting document is serialized with `requireWellFormed: true`, the
     * serializer throws with code `INVALID_STATE_ERR` if `.data` contains `?>` (W3C DOM Parsing
     * §3.2.1.7). Without that option the data is emitted verbatim.
     *
     * @param {string} target
     * @param {string} data
     * @returns {ProcessingInstruction}
     * @see https://developer.mozilla.org/docs/Web/API/Document/createProcessingInstruction
     * @see https://dom.spec.whatwg.org/#dom-document-createprocessinginstruction
     * @see https://www.w3.org/TR/DOM-Parsing/#dfn-concept-serialize-xml §3.2.1.7
     */
    createProcessingInstruction: function(E, k) {
      var B = new Ar();
      return B.ownerDocument = this, B.tagName = B.nodeName = B.target = E, B.nodeValue = B.data = k, B;
    },
    createAttribute: function(E) {
      var k = new Or();
      return k.ownerDocument = this, k.name = E, k.nodeName = E, k.localName = E, k.specified = !0, k;
    },
    createEntityReference: function(E) {
      var k = new Hr();
      return k.ownerDocument = this, k.nodeName = E, k;
    },
    // Introduced in DOM Level 2:
    createElementNS: function(E, k) {
      var B = new pe(), Q = k.split(":"), ge = B.attributes = new oe();
      return B.childNodes = new J(), B.ownerDocument = this, B.nodeName = k, B.tagName = k, B.namespaceURI = E, Q.length == 2 ? (B.prefix = Q[0], B.localName = Q[1]) : B.localName = k, ge._ownerElement = B, B;
    },
    // Introduced in DOM Level 2:
    createAttributeNS: function(E, k) {
      var B = new Or(), Q = k.split(":");
      return B.ownerDocument = this, B.nodeName = k, B.name = k, B.namespaceURI = E, B.specified = !0, Q.length == 2 ? (B.prefix = Q[0], B.localName = Q[1]) : B.localName = k, B;
    }
  }, f(Ne, de);
  function pe() {
    this._nsMap = {};
  }
  pe.prototype = {
    nodeType: l,
    hasAttribute: function(E) {
      return this.getAttributeNode(E) != null;
    },
    getAttribute: function(E) {
      var k = this.getAttributeNode(E);
      return k && k.value || "";
    },
    getAttributeNode: function(E) {
      return this.attributes.getNamedItem(E);
    },
    setAttribute: function(E, k) {
      var B = this.ownerDocument.createAttribute(E);
      B.value = B.nodeValue = "" + k, this.setAttributeNode(B);
    },
    removeAttribute: function(E) {
      var k = this.getAttributeNode(E);
      k && this.removeAttributeNode(k);
    },
    //four real opeartion method
    appendChild: function(E) {
      return E.nodeType === M ? this.insertBefore(E, null) : qe(this, E);
    },
    setAttributeNode: function(E) {
      return this.attributes.setNamedItem(E);
    },
    setAttributeNodeNS: function(E) {
      return this.attributes.setNamedItemNS(E);
    },
    removeAttributeNode: function(E) {
      return this.attributes.removeNamedItem(E.nodeName);
    },
    //get real attribute name,and remove it by removeAttributeNode
    removeAttributeNS: function(E, k) {
      var B = this.getAttributeNodeNS(E, k);
      B && this.removeAttributeNode(B);
    },
    hasAttributeNS: function(E, k) {
      return this.getAttributeNodeNS(E, k) != null;
    },
    getAttributeNS: function(E, k) {
      var B = this.getAttributeNodeNS(E, k);
      return B && B.value || "";
    },
    setAttributeNS: function(E, k, B) {
      var Q = this.ownerDocument.createAttributeNS(E, k);
      Q.value = Q.nodeValue = "" + B, this.setAttributeNode(Q);
    },
    getAttributeNodeNS: function(E, k) {
      return this.attributes.getNamedItemNS(E, k);
    },
    getElementsByTagName: function(E) {
      return new fe(this, function(k) {
        var B = [];
        return Se(k, function(Q) {
          Q !== k && Q.nodeType == l && (E === "*" || Q.tagName == E) && B.push(Q);
        }), B;
      });
    },
    getElementsByTagNameNS: function(E, k) {
      return new fe(this, function(B) {
        var Q = [];
        return Se(B, function(ge) {
          ge !== B && ge.nodeType === l && (E === "*" || ge.namespaceURI === E) && (k === "*" || ge.localName == k) && Q.push(ge);
        }), Q;
      });
    }
  }, Ne.prototype.getElementsByTagName = pe.prototype.getElementsByTagName, Ne.prototype.getElementsByTagNameNS = pe.prototype.getElementsByTagNameNS, f(pe, de);
  function Or() {
  }
  Or.prototype.nodeType = x, f(Or, de);
  function _r() {
  }
  _r.prototype = {
    data: "",
    substringData: function(E, k) {
      return this.data.substring(E, E + k);
    },
    appendData: function(E) {
      E = this.data + E, this.nodeValue = this.data = E, this.length = E.length;
    },
    insertData: function(E, k) {
      this.replaceData(E, 0, k);
    },
    appendChild: function(E) {
      throw new Error(L[A]);
    },
    deleteData: function(E, k) {
      this.replaceData(E, k, "");
    },
    replaceData: function(E, k, B) {
      var Q = this.data.substring(0, E), ge = this.data.substring(E + k);
      B = Q + B + ge, this.nodeValue = this.data = B, this.length = B.length;
    }
  }, f(_r, de);
  function rr() {
  }
  rr.prototype = {
    nodeName: "#text",
    nodeType: h,
    splitText: function(E) {
      var k = this.data, B = k.substring(E);
      k = k.substring(0, E), this.data = this.nodeValue = k, this.length = k.length;
      var Q = this.ownerDocument.createTextNode(B);
      return this.parentNode && this.parentNode.insertBefore(Q, this.nextSibling), Q;
    }
  }, f(rr, _r);
  function jr() {
  }
  jr.prototype = {
    nodeName: "#comment",
    nodeType: w
  }, f(jr, _r);
  function Kr() {
  }
  Kr.prototype = {
    nodeName: "#cdata-section",
    nodeType: g
  }, f(Kr, _r);
  function Oe() {
  }
  Oe.prototype.nodeType = y, f(Oe, de);
  function nr() {
  }
  nr.prototype.nodeType = W, f(nr, de);
  function vr() {
  }
  vr.prototype.nodeType = d, f(vr, de);
  function Hr() {
  }
  Hr.prototype.nodeType = _, f(Hr, de);
  function O() {
  }
  O.prototype.nodeName = "#document-fragment", O.prototype.nodeType = M, f(O, de);
  function Ar() {
  }
  Ar.prototype.nodeType = p, f(Ar, de);
  function _t() {
  }
  _t.prototype.serializeToString = function(E, k, B, Q) {
    return Lt.call(E, k, B, Q);
  }, de.prototype.toString = Lt;
  function Lt(E, k, B) {
    var Q = !!B && !!B.requireWellFormed, ge = [], ye = this.nodeType == 9 && this.documentElement || this, xe = ye.prefix, Ve = ye.namespaceURI;
    if (Ve && xe == null) {
      var xe = ye.lookupPrefix(Ve);
      if (xe == null)
        var Me = [
          { namespace: Ve, prefix: null }
          //{namespace:uri,prefix:''}
        ];
    }
    return Yr(this, ge, E, k, Me, Q), ge.join("");
  }
  function st(E, k, B) {
    var Q = E.prefix || "", ge = E.namespaceURI;
    if (!ge || Q === "xml" && ge === r.XML || ge === r.XMLNS)
      return !1;
    for (var ye = B.length; ye--; ) {
      var xe = B[ye];
      if (xe.prefix === Q)
        return xe.namespace !== ge;
    }
    return !0;
  }
  function dt(E, k, B) {
    E.push(" ", k, '="', B.replace(/[<>&"\t\n\r]/g, ie), '"');
  }
  function Yr(E, k, B, Q, ge, ye) {
    ge || (ge = []), _e(E, { ns: ge, isHTML: B }, {
      enter: function(xe, Ve) {
        var Me = Ve.ns, U = Ve.isHTML;
        if (Q)
          if (xe = Q(xe), xe) {
            if (typeof xe == "string")
              return k.push(xe), null;
          } else
            return null;
        switch (xe.nodeType) {
          case l:
            var ne = xe.attributes, v = ne.length, D = xe.tagName;
            U = r.isHTML(xe.namespaceURI) || U;
            var T = D;
            if (!U && !xe.prefix && xe.namespaceURI) {
              for (var F, C = 0; C < ne.length; C++)
                if (ne.item(C).name === "xmlns") {
                  F = ne.item(C).value;
                  break;
                }
              if (!F)
                for (var b = Me.length - 1; b >= 0; b--) {
                  var q = Me[b];
                  if (q.prefix === "" && q.namespace === xe.namespaceURI) {
                    F = q.namespace;
                    break;
                  }
                }
              if (F !== xe.namespaceURI)
                for (var b = Me.length - 1; b >= 0; b--) {
                  var q = Me[b];
                  if (q.namespace === xe.namespaceURI) {
                    q.prefix && (T = q.prefix + ":" + D);
                    break;
                  }
                }
            }
            k.push("<", T);
            for (var Z = Me.slice(), X = 0; X < v; X++) {
              var z = ne.item(X);
              z.prefix == "xmlns" ? Z.push({ prefix: z.localName, namespace: z.value }) : z.nodeName == "xmlns" && Z.push({ prefix: "", namespace: z.value });
            }
            for (var X = 0; X < v; X++) {
              var z = ne.item(X);
              if (st(z, U, Z)) {
                var j = z.prefix || "", he = z.namespaceURI;
                dt(k, j ? "xmlns:" + j : "xmlns", he), Z.push({ prefix: j, namespace: he });
              }
              var ve = Q ? Q(z) : z;
              ve && (typeof ve == "string" ? k.push(ve) : dt(k, ve.name, ve.value));
            }
            if (D === T && st(xe, U, Z)) {
              var ke = xe.prefix || "", he = xe.namespaceURI;
              dt(k, ke ? "xmlns:" + ke : "xmlns", he), Z.push({ prefix: ke, namespace: he });
            }
            var le = xe.firstChild;
            if (le || U && !/^(?:meta|link|img|br|hr|input)$/i.test(D)) {
              if (k.push(">"), U && /^script$/i.test(D)) {
                for (; le; )
                  le.data ? k.push(le.data) : Yr(le, k, U, Q, Z.slice(), ye), le = le.nextSibling;
                return k.push("</", D, ">"), null;
              }
              return { ns: Z, isHTML: U, tag: T };
            } else
              return k.push("/>"), null;
          case m:
          case M:
            return { ns: Me.slice(), isHTML: U, tag: null };
          case x:
            return dt(k, xe.name, xe.value), null;
          case h:
            return k.push(xe.data.replace(/[<&>]/g, ie)), null;
          case g:
            if (ye && xe.data.indexOf("]]>") !== -1)
              throw new K(ae, 'The CDATASection data contains "]]>"');
            return k.push("<![CDATA[", xe.data.replace(/]]>/g, "]]]]><![CDATA[>"), "]]>"), null;
          case w:
            if (ye && xe.data.indexOf("-->") !== -1)
              throw new K(ae, 'The comment node data contains "-->"');
            return k.push("<!--", xe.data, "-->"), null;
          case y:
            if (ye) {
              if (xe.publicId && !/^("[\x20\r\na-zA-Z0-9\-()+,.\/:=?;!*#@$_%']*"|'[\x20\r\na-zA-Z0-9\-()+,.\/:=?;!*#@$_%'"]*')$/.test(xe.publicId))
                throw new K(ae, "DocumentType publicId is not a valid PubidLiteral");
              if (xe.systemId && !/^("[^"]*"|'[^']*')$/.test(xe.systemId))
                throw new K(ae, "DocumentType systemId is not a valid SystemLiteral");
              if (xe.internalSubset && xe.internalSubset.indexOf("]>") !== -1)
                throw new K(ae, 'DocumentType internalSubset contains "]>"');
            }
            var me = xe.publicId, Be = xe.systemId;
            if (k.push("<!DOCTYPE ", xe.name), me)
              k.push(" PUBLIC ", me), Be && Be != "." && k.push(" ", Be), k.push(">");
            else if (Be && Be != ".")
              k.push(" SYSTEM ", Be, ">");
            else {
              var tr = xe.internalSubset;
              tr && k.push(" [", tr, "]"), k.push(">");
            }
            return null;
          case p:
            if (ye && xe.data.indexOf("?>") !== -1)
              throw new K(ae, 'The ProcessingInstruction data contains "?>"');
            return k.push("<?", xe.target, " ", xe.data, "?>"), null;
          case _:
            return k.push("&", xe.nodeName, ";"), null;
          //case ENTITY_NODE:
          //case NOTATION_NODE:
          default:
            return k.push("??", xe.nodeName), null;
        }
      },
      exit: function(xe, Ve) {
        Ve && Ve.tag && k.push("</", Ve.tag, ">");
      }
    });
  }
  function va(E, k, B) {
    var Q;
    return _e(k, null, {
      enter: function(ge, ye) {
        var xe = ge.cloneNode(!1);
        xe.ownerDocument = E, xe.parentNode = null, ye === null ? Q = xe : ye.appendChild(xe);
        var Ve = ge.nodeType === x || B;
        return Ve ? xe : null;
      }
    }), Q;
  }
  function xt(E, k, B) {
    var Q;
    return _e(k, null, {
      enter: function(ge, ye) {
        var xe = new ge.constructor();
        for (var Ve in ge)
          if (Object.prototype.hasOwnProperty.call(ge, Ve)) {
            var Me = ge[Ve];
            typeof Me != "object" && Me != xe[Ve] && (xe[Ve] = Me);
          }
        ge.childNodes && (xe.childNodes = new J()), xe.ownerDocument = E;
        var U = B;
        switch (xe.nodeType) {
          case l:
            var ne = ge.attributes, v = xe.attributes = new oe(), D = ne.length;
            v._ownerElement = xe;
            for (var T = 0; T < D; T++)
              xe.setAttributeNode(xt(E, ne.item(T), !0));
            break;
          case x:
            U = !0;
        }
        return ye !== null ? ye.appendChild(xe) : Q = xe, U ? xe : null;
      }
    }), Q;
  }
  function $t(E, k, B) {
    E[k] = B;
  }
  try {
    Object.defineProperty && (Object.defineProperty(fe.prototype, "length", {
      get: function() {
        return Y(this), this.$$length;
      }
    }), Object.defineProperty(de.prototype, "textContent", {
      get: function() {
        if (this.nodeType === l || this.nodeType === M) {
          var E = [];
          return _e(this, null, {
            enter: function(k) {
              if (k.nodeType === l || k.nodeType === M)
                return !0;
              if (k.nodeType === p || k.nodeType === w)
                return null;
              E.push(k.nodeValue);
            }
          }), E.join("");
        }
        return this.nodeValue;
      },
      set: function(E) {
        switch (this.nodeType) {
          case l:
          case M:
            for (; this.firstChild; )
              this.removeChild(this.firstChild);
            (E || String(E)) && this.appendChild(this.ownerDocument.createTextNode(E));
            break;
          default:
            this.data = E, this.value = E, this.nodeValue = E;
        }
      }
    }), $t = function(E, k, B) {
      E["$$" + k] = B;
    });
  } catch {
  }
  return vt.DocumentType = Oe, vt.DOMException = K, vt.DOMImplementation = be, vt.Element = pe, vt.Node = de, vt.NodeList = J, vt.walkDOM = _e, vt.XMLSerializer = _t, vt;
}
var Na = {}, l0 = {}, ds;
function ug() {
  return ds || (ds = 1, (function(e) {
    var t = jn().freeze;
    e.XML_ENTITIES = t({
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: '"'
    }), e.HTML_ENTITIES = t({
      Aacute: "Á",
      aacute: "á",
      Abreve: "Ă",
      abreve: "ă",
      ac: "∾",
      acd: "∿",
      acE: "∾̳",
      Acirc: "Â",
      acirc: "â",
      acute: "´",
      Acy: "А",
      acy: "а",
      AElig: "Æ",
      aelig: "æ",
      af: "⁡",
      Afr: "𝔄",
      afr: "𝔞",
      Agrave: "À",
      agrave: "à",
      alefsym: "ℵ",
      aleph: "ℵ",
      Alpha: "Α",
      alpha: "α",
      Amacr: "Ā",
      amacr: "ā",
      amalg: "⨿",
      AMP: "&",
      amp: "&",
      And: "⩓",
      and: "∧",
      andand: "⩕",
      andd: "⩜",
      andslope: "⩘",
      andv: "⩚",
      ang: "∠",
      ange: "⦤",
      angle: "∠",
      angmsd: "∡",
      angmsdaa: "⦨",
      angmsdab: "⦩",
      angmsdac: "⦪",
      angmsdad: "⦫",
      angmsdae: "⦬",
      angmsdaf: "⦭",
      angmsdag: "⦮",
      angmsdah: "⦯",
      angrt: "∟",
      angrtvb: "⊾",
      angrtvbd: "⦝",
      angsph: "∢",
      angst: "Å",
      angzarr: "⍼",
      Aogon: "Ą",
      aogon: "ą",
      Aopf: "𝔸",
      aopf: "𝕒",
      ap: "≈",
      apacir: "⩯",
      apE: "⩰",
      ape: "≊",
      apid: "≋",
      apos: "'",
      ApplyFunction: "⁡",
      approx: "≈",
      approxeq: "≊",
      Aring: "Å",
      aring: "å",
      Ascr: "𝒜",
      ascr: "𝒶",
      Assign: "≔",
      ast: "*",
      asymp: "≈",
      asympeq: "≍",
      Atilde: "Ã",
      atilde: "ã",
      Auml: "Ä",
      auml: "ä",
      awconint: "∳",
      awint: "⨑",
      backcong: "≌",
      backepsilon: "϶",
      backprime: "‵",
      backsim: "∽",
      backsimeq: "⋍",
      Backslash: "∖",
      Barv: "⫧",
      barvee: "⊽",
      Barwed: "⌆",
      barwed: "⌅",
      barwedge: "⌅",
      bbrk: "⎵",
      bbrktbrk: "⎶",
      bcong: "≌",
      Bcy: "Б",
      bcy: "б",
      bdquo: "„",
      becaus: "∵",
      Because: "∵",
      because: "∵",
      bemptyv: "⦰",
      bepsi: "϶",
      bernou: "ℬ",
      Bernoullis: "ℬ",
      Beta: "Β",
      beta: "β",
      beth: "ℶ",
      between: "≬",
      Bfr: "𝔅",
      bfr: "𝔟",
      bigcap: "⋂",
      bigcirc: "◯",
      bigcup: "⋃",
      bigodot: "⨀",
      bigoplus: "⨁",
      bigotimes: "⨂",
      bigsqcup: "⨆",
      bigstar: "★",
      bigtriangledown: "▽",
      bigtriangleup: "△",
      biguplus: "⨄",
      bigvee: "⋁",
      bigwedge: "⋀",
      bkarow: "⤍",
      blacklozenge: "⧫",
      blacksquare: "▪",
      blacktriangle: "▴",
      blacktriangledown: "▾",
      blacktriangleleft: "◂",
      blacktriangleright: "▸",
      blank: "␣",
      blk12: "▒",
      blk14: "░",
      blk34: "▓",
      block: "█",
      bne: "=⃥",
      bnequiv: "≡⃥",
      bNot: "⫭",
      bnot: "⌐",
      Bopf: "𝔹",
      bopf: "𝕓",
      bot: "⊥",
      bottom: "⊥",
      bowtie: "⋈",
      boxbox: "⧉",
      boxDL: "╗",
      boxDl: "╖",
      boxdL: "╕",
      boxdl: "┐",
      boxDR: "╔",
      boxDr: "╓",
      boxdR: "╒",
      boxdr: "┌",
      boxH: "═",
      boxh: "─",
      boxHD: "╦",
      boxHd: "╤",
      boxhD: "╥",
      boxhd: "┬",
      boxHU: "╩",
      boxHu: "╧",
      boxhU: "╨",
      boxhu: "┴",
      boxminus: "⊟",
      boxplus: "⊞",
      boxtimes: "⊠",
      boxUL: "╝",
      boxUl: "╜",
      boxuL: "╛",
      boxul: "┘",
      boxUR: "╚",
      boxUr: "╙",
      boxuR: "╘",
      boxur: "└",
      boxV: "║",
      boxv: "│",
      boxVH: "╬",
      boxVh: "╫",
      boxvH: "╪",
      boxvh: "┼",
      boxVL: "╣",
      boxVl: "╢",
      boxvL: "╡",
      boxvl: "┤",
      boxVR: "╠",
      boxVr: "╟",
      boxvR: "╞",
      boxvr: "├",
      bprime: "‵",
      Breve: "˘",
      breve: "˘",
      brvbar: "¦",
      Bscr: "ℬ",
      bscr: "𝒷",
      bsemi: "⁏",
      bsim: "∽",
      bsime: "⋍",
      bsol: "\\",
      bsolb: "⧅",
      bsolhsub: "⟈",
      bull: "•",
      bullet: "•",
      bump: "≎",
      bumpE: "⪮",
      bumpe: "≏",
      Bumpeq: "≎",
      bumpeq: "≏",
      Cacute: "Ć",
      cacute: "ć",
      Cap: "⋒",
      cap: "∩",
      capand: "⩄",
      capbrcup: "⩉",
      capcap: "⩋",
      capcup: "⩇",
      capdot: "⩀",
      CapitalDifferentialD: "ⅅ",
      caps: "∩︀",
      caret: "⁁",
      caron: "ˇ",
      Cayleys: "ℭ",
      ccaps: "⩍",
      Ccaron: "Č",
      ccaron: "č",
      Ccedil: "Ç",
      ccedil: "ç",
      Ccirc: "Ĉ",
      ccirc: "ĉ",
      Cconint: "∰",
      ccups: "⩌",
      ccupssm: "⩐",
      Cdot: "Ċ",
      cdot: "ċ",
      cedil: "¸",
      Cedilla: "¸",
      cemptyv: "⦲",
      cent: "¢",
      CenterDot: "·",
      centerdot: "·",
      Cfr: "ℭ",
      cfr: "𝔠",
      CHcy: "Ч",
      chcy: "ч",
      check: "✓",
      checkmark: "✓",
      Chi: "Χ",
      chi: "χ",
      cir: "○",
      circ: "ˆ",
      circeq: "≗",
      circlearrowleft: "↺",
      circlearrowright: "↻",
      circledast: "⊛",
      circledcirc: "⊚",
      circleddash: "⊝",
      CircleDot: "⊙",
      circledR: "®",
      circledS: "Ⓢ",
      CircleMinus: "⊖",
      CirclePlus: "⊕",
      CircleTimes: "⊗",
      cirE: "⧃",
      cire: "≗",
      cirfnint: "⨐",
      cirmid: "⫯",
      cirscir: "⧂",
      ClockwiseContourIntegral: "∲",
      CloseCurlyDoubleQuote: "”",
      CloseCurlyQuote: "’",
      clubs: "♣",
      clubsuit: "♣",
      Colon: "∷",
      colon: ":",
      Colone: "⩴",
      colone: "≔",
      coloneq: "≔",
      comma: ",",
      commat: "@",
      comp: "∁",
      compfn: "∘",
      complement: "∁",
      complexes: "ℂ",
      cong: "≅",
      congdot: "⩭",
      Congruent: "≡",
      Conint: "∯",
      conint: "∮",
      ContourIntegral: "∮",
      Copf: "ℂ",
      copf: "𝕔",
      coprod: "∐",
      Coproduct: "∐",
      COPY: "©",
      copy: "©",
      copysr: "℗",
      CounterClockwiseContourIntegral: "∳",
      crarr: "↵",
      Cross: "⨯",
      cross: "✗",
      Cscr: "𝒞",
      cscr: "𝒸",
      csub: "⫏",
      csube: "⫑",
      csup: "⫐",
      csupe: "⫒",
      ctdot: "⋯",
      cudarrl: "⤸",
      cudarrr: "⤵",
      cuepr: "⋞",
      cuesc: "⋟",
      cularr: "↶",
      cularrp: "⤽",
      Cup: "⋓",
      cup: "∪",
      cupbrcap: "⩈",
      CupCap: "≍",
      cupcap: "⩆",
      cupcup: "⩊",
      cupdot: "⊍",
      cupor: "⩅",
      cups: "∪︀",
      curarr: "↷",
      curarrm: "⤼",
      curlyeqprec: "⋞",
      curlyeqsucc: "⋟",
      curlyvee: "⋎",
      curlywedge: "⋏",
      curren: "¤",
      curvearrowleft: "↶",
      curvearrowright: "↷",
      cuvee: "⋎",
      cuwed: "⋏",
      cwconint: "∲",
      cwint: "∱",
      cylcty: "⌭",
      Dagger: "‡",
      dagger: "†",
      daleth: "ℸ",
      Darr: "↡",
      dArr: "⇓",
      darr: "↓",
      dash: "‐",
      Dashv: "⫤",
      dashv: "⊣",
      dbkarow: "⤏",
      dblac: "˝",
      Dcaron: "Ď",
      dcaron: "ď",
      Dcy: "Д",
      dcy: "д",
      DD: "ⅅ",
      dd: "ⅆ",
      ddagger: "‡",
      ddarr: "⇊",
      DDotrahd: "⤑",
      ddotseq: "⩷",
      deg: "°",
      Del: "∇",
      Delta: "Δ",
      delta: "δ",
      demptyv: "⦱",
      dfisht: "⥿",
      Dfr: "𝔇",
      dfr: "𝔡",
      dHar: "⥥",
      dharl: "⇃",
      dharr: "⇂",
      DiacriticalAcute: "´",
      DiacriticalDot: "˙",
      DiacriticalDoubleAcute: "˝",
      DiacriticalGrave: "`",
      DiacriticalTilde: "˜",
      diam: "⋄",
      Diamond: "⋄",
      diamond: "⋄",
      diamondsuit: "♦",
      diams: "♦",
      die: "¨",
      DifferentialD: "ⅆ",
      digamma: "ϝ",
      disin: "⋲",
      div: "÷",
      divide: "÷",
      divideontimes: "⋇",
      divonx: "⋇",
      DJcy: "Ђ",
      djcy: "ђ",
      dlcorn: "⌞",
      dlcrop: "⌍",
      dollar: "$",
      Dopf: "𝔻",
      dopf: "𝕕",
      Dot: "¨",
      dot: "˙",
      DotDot: "⃜",
      doteq: "≐",
      doteqdot: "≑",
      DotEqual: "≐",
      dotminus: "∸",
      dotplus: "∔",
      dotsquare: "⊡",
      doublebarwedge: "⌆",
      DoubleContourIntegral: "∯",
      DoubleDot: "¨",
      DoubleDownArrow: "⇓",
      DoubleLeftArrow: "⇐",
      DoubleLeftRightArrow: "⇔",
      DoubleLeftTee: "⫤",
      DoubleLongLeftArrow: "⟸",
      DoubleLongLeftRightArrow: "⟺",
      DoubleLongRightArrow: "⟹",
      DoubleRightArrow: "⇒",
      DoubleRightTee: "⊨",
      DoubleUpArrow: "⇑",
      DoubleUpDownArrow: "⇕",
      DoubleVerticalBar: "∥",
      DownArrow: "↓",
      Downarrow: "⇓",
      downarrow: "↓",
      DownArrowBar: "⤓",
      DownArrowUpArrow: "⇵",
      DownBreve: "̑",
      downdownarrows: "⇊",
      downharpoonleft: "⇃",
      downharpoonright: "⇂",
      DownLeftRightVector: "⥐",
      DownLeftTeeVector: "⥞",
      DownLeftVector: "↽",
      DownLeftVectorBar: "⥖",
      DownRightTeeVector: "⥟",
      DownRightVector: "⇁",
      DownRightVectorBar: "⥗",
      DownTee: "⊤",
      DownTeeArrow: "↧",
      drbkarow: "⤐",
      drcorn: "⌟",
      drcrop: "⌌",
      Dscr: "𝒟",
      dscr: "𝒹",
      DScy: "Ѕ",
      dscy: "ѕ",
      dsol: "⧶",
      Dstrok: "Đ",
      dstrok: "đ",
      dtdot: "⋱",
      dtri: "▿",
      dtrif: "▾",
      duarr: "⇵",
      duhar: "⥯",
      dwangle: "⦦",
      DZcy: "Џ",
      dzcy: "џ",
      dzigrarr: "⟿",
      Eacute: "É",
      eacute: "é",
      easter: "⩮",
      Ecaron: "Ě",
      ecaron: "ě",
      ecir: "≖",
      Ecirc: "Ê",
      ecirc: "ê",
      ecolon: "≕",
      Ecy: "Э",
      ecy: "э",
      eDDot: "⩷",
      Edot: "Ė",
      eDot: "≑",
      edot: "ė",
      ee: "ⅇ",
      efDot: "≒",
      Efr: "𝔈",
      efr: "𝔢",
      eg: "⪚",
      Egrave: "È",
      egrave: "è",
      egs: "⪖",
      egsdot: "⪘",
      el: "⪙",
      Element: "∈",
      elinters: "⏧",
      ell: "ℓ",
      els: "⪕",
      elsdot: "⪗",
      Emacr: "Ē",
      emacr: "ē",
      empty: "∅",
      emptyset: "∅",
      EmptySmallSquare: "◻",
      emptyv: "∅",
      EmptyVerySmallSquare: "▫",
      emsp: " ",
      emsp13: " ",
      emsp14: " ",
      ENG: "Ŋ",
      eng: "ŋ",
      ensp: " ",
      Eogon: "Ę",
      eogon: "ę",
      Eopf: "𝔼",
      eopf: "𝕖",
      epar: "⋕",
      eparsl: "⧣",
      eplus: "⩱",
      epsi: "ε",
      Epsilon: "Ε",
      epsilon: "ε",
      epsiv: "ϵ",
      eqcirc: "≖",
      eqcolon: "≕",
      eqsim: "≂",
      eqslantgtr: "⪖",
      eqslantless: "⪕",
      Equal: "⩵",
      equals: "=",
      EqualTilde: "≂",
      equest: "≟",
      Equilibrium: "⇌",
      equiv: "≡",
      equivDD: "⩸",
      eqvparsl: "⧥",
      erarr: "⥱",
      erDot: "≓",
      Escr: "ℰ",
      escr: "ℯ",
      esdot: "≐",
      Esim: "⩳",
      esim: "≂",
      Eta: "Η",
      eta: "η",
      ETH: "Ð",
      eth: "ð",
      Euml: "Ë",
      euml: "ë",
      euro: "€",
      excl: "!",
      exist: "∃",
      Exists: "∃",
      expectation: "ℰ",
      ExponentialE: "ⅇ",
      exponentiale: "ⅇ",
      fallingdotseq: "≒",
      Fcy: "Ф",
      fcy: "ф",
      female: "♀",
      ffilig: "ﬃ",
      fflig: "ﬀ",
      ffllig: "ﬄ",
      Ffr: "𝔉",
      ffr: "𝔣",
      filig: "ﬁ",
      FilledSmallSquare: "◼",
      FilledVerySmallSquare: "▪",
      fjlig: "fj",
      flat: "♭",
      fllig: "ﬂ",
      fltns: "▱",
      fnof: "ƒ",
      Fopf: "𝔽",
      fopf: "𝕗",
      ForAll: "∀",
      forall: "∀",
      fork: "⋔",
      forkv: "⫙",
      Fouriertrf: "ℱ",
      fpartint: "⨍",
      frac12: "½",
      frac13: "⅓",
      frac14: "¼",
      frac15: "⅕",
      frac16: "⅙",
      frac18: "⅛",
      frac23: "⅔",
      frac25: "⅖",
      frac34: "¾",
      frac35: "⅗",
      frac38: "⅜",
      frac45: "⅘",
      frac56: "⅚",
      frac58: "⅝",
      frac78: "⅞",
      frasl: "⁄",
      frown: "⌢",
      Fscr: "ℱ",
      fscr: "𝒻",
      gacute: "ǵ",
      Gamma: "Γ",
      gamma: "γ",
      Gammad: "Ϝ",
      gammad: "ϝ",
      gap: "⪆",
      Gbreve: "Ğ",
      gbreve: "ğ",
      Gcedil: "Ģ",
      Gcirc: "Ĝ",
      gcirc: "ĝ",
      Gcy: "Г",
      gcy: "г",
      Gdot: "Ġ",
      gdot: "ġ",
      gE: "≧",
      ge: "≥",
      gEl: "⪌",
      gel: "⋛",
      geq: "≥",
      geqq: "≧",
      geqslant: "⩾",
      ges: "⩾",
      gescc: "⪩",
      gesdot: "⪀",
      gesdoto: "⪂",
      gesdotol: "⪄",
      gesl: "⋛︀",
      gesles: "⪔",
      Gfr: "𝔊",
      gfr: "𝔤",
      Gg: "⋙",
      gg: "≫",
      ggg: "⋙",
      gimel: "ℷ",
      GJcy: "Ѓ",
      gjcy: "ѓ",
      gl: "≷",
      gla: "⪥",
      glE: "⪒",
      glj: "⪤",
      gnap: "⪊",
      gnapprox: "⪊",
      gnE: "≩",
      gne: "⪈",
      gneq: "⪈",
      gneqq: "≩",
      gnsim: "⋧",
      Gopf: "𝔾",
      gopf: "𝕘",
      grave: "`",
      GreaterEqual: "≥",
      GreaterEqualLess: "⋛",
      GreaterFullEqual: "≧",
      GreaterGreater: "⪢",
      GreaterLess: "≷",
      GreaterSlantEqual: "⩾",
      GreaterTilde: "≳",
      Gscr: "𝒢",
      gscr: "ℊ",
      gsim: "≳",
      gsime: "⪎",
      gsiml: "⪐",
      Gt: "≫",
      GT: ">",
      gt: ">",
      gtcc: "⪧",
      gtcir: "⩺",
      gtdot: "⋗",
      gtlPar: "⦕",
      gtquest: "⩼",
      gtrapprox: "⪆",
      gtrarr: "⥸",
      gtrdot: "⋗",
      gtreqless: "⋛",
      gtreqqless: "⪌",
      gtrless: "≷",
      gtrsim: "≳",
      gvertneqq: "≩︀",
      gvnE: "≩︀",
      Hacek: "ˇ",
      hairsp: " ",
      half: "½",
      hamilt: "ℋ",
      HARDcy: "Ъ",
      hardcy: "ъ",
      hArr: "⇔",
      harr: "↔",
      harrcir: "⥈",
      harrw: "↭",
      Hat: "^",
      hbar: "ℏ",
      Hcirc: "Ĥ",
      hcirc: "ĥ",
      hearts: "♥",
      heartsuit: "♥",
      hellip: "…",
      hercon: "⊹",
      Hfr: "ℌ",
      hfr: "𝔥",
      HilbertSpace: "ℋ",
      hksearow: "⤥",
      hkswarow: "⤦",
      hoarr: "⇿",
      homtht: "∻",
      hookleftarrow: "↩",
      hookrightarrow: "↪",
      Hopf: "ℍ",
      hopf: "𝕙",
      horbar: "―",
      HorizontalLine: "─",
      Hscr: "ℋ",
      hscr: "𝒽",
      hslash: "ℏ",
      Hstrok: "Ħ",
      hstrok: "ħ",
      HumpDownHump: "≎",
      HumpEqual: "≏",
      hybull: "⁃",
      hyphen: "‐",
      Iacute: "Í",
      iacute: "í",
      ic: "⁣",
      Icirc: "Î",
      icirc: "î",
      Icy: "И",
      icy: "и",
      Idot: "İ",
      IEcy: "Е",
      iecy: "е",
      iexcl: "¡",
      iff: "⇔",
      Ifr: "ℑ",
      ifr: "𝔦",
      Igrave: "Ì",
      igrave: "ì",
      ii: "ⅈ",
      iiiint: "⨌",
      iiint: "∭",
      iinfin: "⧜",
      iiota: "℩",
      IJlig: "Ĳ",
      ijlig: "ĳ",
      Im: "ℑ",
      Imacr: "Ī",
      imacr: "ī",
      image: "ℑ",
      ImaginaryI: "ⅈ",
      imagline: "ℐ",
      imagpart: "ℑ",
      imath: "ı",
      imof: "⊷",
      imped: "Ƶ",
      Implies: "⇒",
      in: "∈",
      incare: "℅",
      infin: "∞",
      infintie: "⧝",
      inodot: "ı",
      Int: "∬",
      int: "∫",
      intcal: "⊺",
      integers: "ℤ",
      Integral: "∫",
      intercal: "⊺",
      Intersection: "⋂",
      intlarhk: "⨗",
      intprod: "⨼",
      InvisibleComma: "⁣",
      InvisibleTimes: "⁢",
      IOcy: "Ё",
      iocy: "ё",
      Iogon: "Į",
      iogon: "į",
      Iopf: "𝕀",
      iopf: "𝕚",
      Iota: "Ι",
      iota: "ι",
      iprod: "⨼",
      iquest: "¿",
      Iscr: "ℐ",
      iscr: "𝒾",
      isin: "∈",
      isindot: "⋵",
      isinE: "⋹",
      isins: "⋴",
      isinsv: "⋳",
      isinv: "∈",
      it: "⁢",
      Itilde: "Ĩ",
      itilde: "ĩ",
      Iukcy: "І",
      iukcy: "і",
      Iuml: "Ï",
      iuml: "ï",
      Jcirc: "Ĵ",
      jcirc: "ĵ",
      Jcy: "Й",
      jcy: "й",
      Jfr: "𝔍",
      jfr: "𝔧",
      jmath: "ȷ",
      Jopf: "𝕁",
      jopf: "𝕛",
      Jscr: "𝒥",
      jscr: "𝒿",
      Jsercy: "Ј",
      jsercy: "ј",
      Jukcy: "Є",
      jukcy: "є",
      Kappa: "Κ",
      kappa: "κ",
      kappav: "ϰ",
      Kcedil: "Ķ",
      kcedil: "ķ",
      Kcy: "К",
      kcy: "к",
      Kfr: "𝔎",
      kfr: "𝔨",
      kgreen: "ĸ",
      KHcy: "Х",
      khcy: "х",
      KJcy: "Ќ",
      kjcy: "ќ",
      Kopf: "𝕂",
      kopf: "𝕜",
      Kscr: "𝒦",
      kscr: "𝓀",
      lAarr: "⇚",
      Lacute: "Ĺ",
      lacute: "ĺ",
      laemptyv: "⦴",
      lagran: "ℒ",
      Lambda: "Λ",
      lambda: "λ",
      Lang: "⟪",
      lang: "⟨",
      langd: "⦑",
      langle: "⟨",
      lap: "⪅",
      Laplacetrf: "ℒ",
      laquo: "«",
      Larr: "↞",
      lArr: "⇐",
      larr: "←",
      larrb: "⇤",
      larrbfs: "⤟",
      larrfs: "⤝",
      larrhk: "↩",
      larrlp: "↫",
      larrpl: "⤹",
      larrsim: "⥳",
      larrtl: "↢",
      lat: "⪫",
      lAtail: "⤛",
      latail: "⤙",
      late: "⪭",
      lates: "⪭︀",
      lBarr: "⤎",
      lbarr: "⤌",
      lbbrk: "❲",
      lbrace: "{",
      lbrack: "[",
      lbrke: "⦋",
      lbrksld: "⦏",
      lbrkslu: "⦍",
      Lcaron: "Ľ",
      lcaron: "ľ",
      Lcedil: "Ļ",
      lcedil: "ļ",
      lceil: "⌈",
      lcub: "{",
      Lcy: "Л",
      lcy: "л",
      ldca: "⤶",
      ldquo: "“",
      ldquor: "„",
      ldrdhar: "⥧",
      ldrushar: "⥋",
      ldsh: "↲",
      lE: "≦",
      le: "≤",
      LeftAngleBracket: "⟨",
      LeftArrow: "←",
      Leftarrow: "⇐",
      leftarrow: "←",
      LeftArrowBar: "⇤",
      LeftArrowRightArrow: "⇆",
      leftarrowtail: "↢",
      LeftCeiling: "⌈",
      LeftDoubleBracket: "⟦",
      LeftDownTeeVector: "⥡",
      LeftDownVector: "⇃",
      LeftDownVectorBar: "⥙",
      LeftFloor: "⌊",
      leftharpoondown: "↽",
      leftharpoonup: "↼",
      leftleftarrows: "⇇",
      LeftRightArrow: "↔",
      Leftrightarrow: "⇔",
      leftrightarrow: "↔",
      leftrightarrows: "⇆",
      leftrightharpoons: "⇋",
      leftrightsquigarrow: "↭",
      LeftRightVector: "⥎",
      LeftTee: "⊣",
      LeftTeeArrow: "↤",
      LeftTeeVector: "⥚",
      leftthreetimes: "⋋",
      LeftTriangle: "⊲",
      LeftTriangleBar: "⧏",
      LeftTriangleEqual: "⊴",
      LeftUpDownVector: "⥑",
      LeftUpTeeVector: "⥠",
      LeftUpVector: "↿",
      LeftUpVectorBar: "⥘",
      LeftVector: "↼",
      LeftVectorBar: "⥒",
      lEg: "⪋",
      leg: "⋚",
      leq: "≤",
      leqq: "≦",
      leqslant: "⩽",
      les: "⩽",
      lescc: "⪨",
      lesdot: "⩿",
      lesdoto: "⪁",
      lesdotor: "⪃",
      lesg: "⋚︀",
      lesges: "⪓",
      lessapprox: "⪅",
      lessdot: "⋖",
      lesseqgtr: "⋚",
      lesseqqgtr: "⪋",
      LessEqualGreater: "⋚",
      LessFullEqual: "≦",
      LessGreater: "≶",
      lessgtr: "≶",
      LessLess: "⪡",
      lesssim: "≲",
      LessSlantEqual: "⩽",
      LessTilde: "≲",
      lfisht: "⥼",
      lfloor: "⌊",
      Lfr: "𝔏",
      lfr: "𝔩",
      lg: "≶",
      lgE: "⪑",
      lHar: "⥢",
      lhard: "↽",
      lharu: "↼",
      lharul: "⥪",
      lhblk: "▄",
      LJcy: "Љ",
      ljcy: "љ",
      Ll: "⋘",
      ll: "≪",
      llarr: "⇇",
      llcorner: "⌞",
      Lleftarrow: "⇚",
      llhard: "⥫",
      lltri: "◺",
      Lmidot: "Ŀ",
      lmidot: "ŀ",
      lmoust: "⎰",
      lmoustache: "⎰",
      lnap: "⪉",
      lnapprox: "⪉",
      lnE: "≨",
      lne: "⪇",
      lneq: "⪇",
      lneqq: "≨",
      lnsim: "⋦",
      loang: "⟬",
      loarr: "⇽",
      lobrk: "⟦",
      LongLeftArrow: "⟵",
      Longleftarrow: "⟸",
      longleftarrow: "⟵",
      LongLeftRightArrow: "⟷",
      Longleftrightarrow: "⟺",
      longleftrightarrow: "⟷",
      longmapsto: "⟼",
      LongRightArrow: "⟶",
      Longrightarrow: "⟹",
      longrightarrow: "⟶",
      looparrowleft: "↫",
      looparrowright: "↬",
      lopar: "⦅",
      Lopf: "𝕃",
      lopf: "𝕝",
      loplus: "⨭",
      lotimes: "⨴",
      lowast: "∗",
      lowbar: "_",
      LowerLeftArrow: "↙",
      LowerRightArrow: "↘",
      loz: "◊",
      lozenge: "◊",
      lozf: "⧫",
      lpar: "(",
      lparlt: "⦓",
      lrarr: "⇆",
      lrcorner: "⌟",
      lrhar: "⇋",
      lrhard: "⥭",
      lrm: "‎",
      lrtri: "⊿",
      lsaquo: "‹",
      Lscr: "ℒ",
      lscr: "𝓁",
      Lsh: "↰",
      lsh: "↰",
      lsim: "≲",
      lsime: "⪍",
      lsimg: "⪏",
      lsqb: "[",
      lsquo: "‘",
      lsquor: "‚",
      Lstrok: "Ł",
      lstrok: "ł",
      Lt: "≪",
      LT: "<",
      lt: "<",
      ltcc: "⪦",
      ltcir: "⩹",
      ltdot: "⋖",
      lthree: "⋋",
      ltimes: "⋉",
      ltlarr: "⥶",
      ltquest: "⩻",
      ltri: "◃",
      ltrie: "⊴",
      ltrif: "◂",
      ltrPar: "⦖",
      lurdshar: "⥊",
      luruhar: "⥦",
      lvertneqq: "≨︀",
      lvnE: "≨︀",
      macr: "¯",
      male: "♂",
      malt: "✠",
      maltese: "✠",
      Map: "⤅",
      map: "↦",
      mapsto: "↦",
      mapstodown: "↧",
      mapstoleft: "↤",
      mapstoup: "↥",
      marker: "▮",
      mcomma: "⨩",
      Mcy: "М",
      mcy: "м",
      mdash: "—",
      mDDot: "∺",
      measuredangle: "∡",
      MediumSpace: " ",
      Mellintrf: "ℳ",
      Mfr: "𝔐",
      mfr: "𝔪",
      mho: "℧",
      micro: "µ",
      mid: "∣",
      midast: "*",
      midcir: "⫰",
      middot: "·",
      minus: "−",
      minusb: "⊟",
      minusd: "∸",
      minusdu: "⨪",
      MinusPlus: "∓",
      mlcp: "⫛",
      mldr: "…",
      mnplus: "∓",
      models: "⊧",
      Mopf: "𝕄",
      mopf: "𝕞",
      mp: "∓",
      Mscr: "ℳ",
      mscr: "𝓂",
      mstpos: "∾",
      Mu: "Μ",
      mu: "μ",
      multimap: "⊸",
      mumap: "⊸",
      nabla: "∇",
      Nacute: "Ń",
      nacute: "ń",
      nang: "∠⃒",
      nap: "≉",
      napE: "⩰̸",
      napid: "≋̸",
      napos: "ŉ",
      napprox: "≉",
      natur: "♮",
      natural: "♮",
      naturals: "ℕ",
      nbsp: " ",
      nbump: "≎̸",
      nbumpe: "≏̸",
      ncap: "⩃",
      Ncaron: "Ň",
      ncaron: "ň",
      Ncedil: "Ņ",
      ncedil: "ņ",
      ncong: "≇",
      ncongdot: "⩭̸",
      ncup: "⩂",
      Ncy: "Н",
      ncy: "н",
      ndash: "–",
      ne: "≠",
      nearhk: "⤤",
      neArr: "⇗",
      nearr: "↗",
      nearrow: "↗",
      nedot: "≐̸",
      NegativeMediumSpace: "​",
      NegativeThickSpace: "​",
      NegativeThinSpace: "​",
      NegativeVeryThinSpace: "​",
      nequiv: "≢",
      nesear: "⤨",
      nesim: "≂̸",
      NestedGreaterGreater: "≫",
      NestedLessLess: "≪",
      NewLine: `
`,
      nexist: "∄",
      nexists: "∄",
      Nfr: "𝔑",
      nfr: "𝔫",
      ngE: "≧̸",
      nge: "≱",
      ngeq: "≱",
      ngeqq: "≧̸",
      ngeqslant: "⩾̸",
      nges: "⩾̸",
      nGg: "⋙̸",
      ngsim: "≵",
      nGt: "≫⃒",
      ngt: "≯",
      ngtr: "≯",
      nGtv: "≫̸",
      nhArr: "⇎",
      nharr: "↮",
      nhpar: "⫲",
      ni: "∋",
      nis: "⋼",
      nisd: "⋺",
      niv: "∋",
      NJcy: "Њ",
      njcy: "њ",
      nlArr: "⇍",
      nlarr: "↚",
      nldr: "‥",
      nlE: "≦̸",
      nle: "≰",
      nLeftarrow: "⇍",
      nleftarrow: "↚",
      nLeftrightarrow: "⇎",
      nleftrightarrow: "↮",
      nleq: "≰",
      nleqq: "≦̸",
      nleqslant: "⩽̸",
      nles: "⩽̸",
      nless: "≮",
      nLl: "⋘̸",
      nlsim: "≴",
      nLt: "≪⃒",
      nlt: "≮",
      nltri: "⋪",
      nltrie: "⋬",
      nLtv: "≪̸",
      nmid: "∤",
      NoBreak: "⁠",
      NonBreakingSpace: " ",
      Nopf: "ℕ",
      nopf: "𝕟",
      Not: "⫬",
      not: "¬",
      NotCongruent: "≢",
      NotCupCap: "≭",
      NotDoubleVerticalBar: "∦",
      NotElement: "∉",
      NotEqual: "≠",
      NotEqualTilde: "≂̸",
      NotExists: "∄",
      NotGreater: "≯",
      NotGreaterEqual: "≱",
      NotGreaterFullEqual: "≧̸",
      NotGreaterGreater: "≫̸",
      NotGreaterLess: "≹",
      NotGreaterSlantEqual: "⩾̸",
      NotGreaterTilde: "≵",
      NotHumpDownHump: "≎̸",
      NotHumpEqual: "≏̸",
      notin: "∉",
      notindot: "⋵̸",
      notinE: "⋹̸",
      notinva: "∉",
      notinvb: "⋷",
      notinvc: "⋶",
      NotLeftTriangle: "⋪",
      NotLeftTriangleBar: "⧏̸",
      NotLeftTriangleEqual: "⋬",
      NotLess: "≮",
      NotLessEqual: "≰",
      NotLessGreater: "≸",
      NotLessLess: "≪̸",
      NotLessSlantEqual: "⩽̸",
      NotLessTilde: "≴",
      NotNestedGreaterGreater: "⪢̸",
      NotNestedLessLess: "⪡̸",
      notni: "∌",
      notniva: "∌",
      notnivb: "⋾",
      notnivc: "⋽",
      NotPrecedes: "⊀",
      NotPrecedesEqual: "⪯̸",
      NotPrecedesSlantEqual: "⋠",
      NotReverseElement: "∌",
      NotRightTriangle: "⋫",
      NotRightTriangleBar: "⧐̸",
      NotRightTriangleEqual: "⋭",
      NotSquareSubset: "⊏̸",
      NotSquareSubsetEqual: "⋢",
      NotSquareSuperset: "⊐̸",
      NotSquareSupersetEqual: "⋣",
      NotSubset: "⊂⃒",
      NotSubsetEqual: "⊈",
      NotSucceeds: "⊁",
      NotSucceedsEqual: "⪰̸",
      NotSucceedsSlantEqual: "⋡",
      NotSucceedsTilde: "≿̸",
      NotSuperset: "⊃⃒",
      NotSupersetEqual: "⊉",
      NotTilde: "≁",
      NotTildeEqual: "≄",
      NotTildeFullEqual: "≇",
      NotTildeTilde: "≉",
      NotVerticalBar: "∤",
      npar: "∦",
      nparallel: "∦",
      nparsl: "⫽⃥",
      npart: "∂̸",
      npolint: "⨔",
      npr: "⊀",
      nprcue: "⋠",
      npre: "⪯̸",
      nprec: "⊀",
      npreceq: "⪯̸",
      nrArr: "⇏",
      nrarr: "↛",
      nrarrc: "⤳̸",
      nrarrw: "↝̸",
      nRightarrow: "⇏",
      nrightarrow: "↛",
      nrtri: "⋫",
      nrtrie: "⋭",
      nsc: "⊁",
      nsccue: "⋡",
      nsce: "⪰̸",
      Nscr: "𝒩",
      nscr: "𝓃",
      nshortmid: "∤",
      nshortparallel: "∦",
      nsim: "≁",
      nsime: "≄",
      nsimeq: "≄",
      nsmid: "∤",
      nspar: "∦",
      nsqsube: "⋢",
      nsqsupe: "⋣",
      nsub: "⊄",
      nsubE: "⫅̸",
      nsube: "⊈",
      nsubset: "⊂⃒",
      nsubseteq: "⊈",
      nsubseteqq: "⫅̸",
      nsucc: "⊁",
      nsucceq: "⪰̸",
      nsup: "⊅",
      nsupE: "⫆̸",
      nsupe: "⊉",
      nsupset: "⊃⃒",
      nsupseteq: "⊉",
      nsupseteqq: "⫆̸",
      ntgl: "≹",
      Ntilde: "Ñ",
      ntilde: "ñ",
      ntlg: "≸",
      ntriangleleft: "⋪",
      ntrianglelefteq: "⋬",
      ntriangleright: "⋫",
      ntrianglerighteq: "⋭",
      Nu: "Ν",
      nu: "ν",
      num: "#",
      numero: "№",
      numsp: " ",
      nvap: "≍⃒",
      nVDash: "⊯",
      nVdash: "⊮",
      nvDash: "⊭",
      nvdash: "⊬",
      nvge: "≥⃒",
      nvgt: ">⃒",
      nvHarr: "⤄",
      nvinfin: "⧞",
      nvlArr: "⤂",
      nvle: "≤⃒",
      nvlt: "<⃒",
      nvltrie: "⊴⃒",
      nvrArr: "⤃",
      nvrtrie: "⊵⃒",
      nvsim: "∼⃒",
      nwarhk: "⤣",
      nwArr: "⇖",
      nwarr: "↖",
      nwarrow: "↖",
      nwnear: "⤧",
      Oacute: "Ó",
      oacute: "ó",
      oast: "⊛",
      ocir: "⊚",
      Ocirc: "Ô",
      ocirc: "ô",
      Ocy: "О",
      ocy: "о",
      odash: "⊝",
      Odblac: "Ő",
      odblac: "ő",
      odiv: "⨸",
      odot: "⊙",
      odsold: "⦼",
      OElig: "Œ",
      oelig: "œ",
      ofcir: "⦿",
      Ofr: "𝔒",
      ofr: "𝔬",
      ogon: "˛",
      Ograve: "Ò",
      ograve: "ò",
      ogt: "⧁",
      ohbar: "⦵",
      ohm: "Ω",
      oint: "∮",
      olarr: "↺",
      olcir: "⦾",
      olcross: "⦻",
      oline: "‾",
      olt: "⧀",
      Omacr: "Ō",
      omacr: "ō",
      Omega: "Ω",
      omega: "ω",
      Omicron: "Ο",
      omicron: "ο",
      omid: "⦶",
      ominus: "⊖",
      Oopf: "𝕆",
      oopf: "𝕠",
      opar: "⦷",
      OpenCurlyDoubleQuote: "“",
      OpenCurlyQuote: "‘",
      operp: "⦹",
      oplus: "⊕",
      Or: "⩔",
      or: "∨",
      orarr: "↻",
      ord: "⩝",
      order: "ℴ",
      orderof: "ℴ",
      ordf: "ª",
      ordm: "º",
      origof: "⊶",
      oror: "⩖",
      orslope: "⩗",
      orv: "⩛",
      oS: "Ⓢ",
      Oscr: "𝒪",
      oscr: "ℴ",
      Oslash: "Ø",
      oslash: "ø",
      osol: "⊘",
      Otilde: "Õ",
      otilde: "õ",
      Otimes: "⨷",
      otimes: "⊗",
      otimesas: "⨶",
      Ouml: "Ö",
      ouml: "ö",
      ovbar: "⌽",
      OverBar: "‾",
      OverBrace: "⏞",
      OverBracket: "⎴",
      OverParenthesis: "⏜",
      par: "∥",
      para: "¶",
      parallel: "∥",
      parsim: "⫳",
      parsl: "⫽",
      part: "∂",
      PartialD: "∂",
      Pcy: "П",
      pcy: "п",
      percnt: "%",
      period: ".",
      permil: "‰",
      perp: "⊥",
      pertenk: "‱",
      Pfr: "𝔓",
      pfr: "𝔭",
      Phi: "Φ",
      phi: "φ",
      phiv: "ϕ",
      phmmat: "ℳ",
      phone: "☎",
      Pi: "Π",
      pi: "π",
      pitchfork: "⋔",
      piv: "ϖ",
      planck: "ℏ",
      planckh: "ℎ",
      plankv: "ℏ",
      plus: "+",
      plusacir: "⨣",
      plusb: "⊞",
      pluscir: "⨢",
      plusdo: "∔",
      plusdu: "⨥",
      pluse: "⩲",
      PlusMinus: "±",
      plusmn: "±",
      plussim: "⨦",
      plustwo: "⨧",
      pm: "±",
      Poincareplane: "ℌ",
      pointint: "⨕",
      Popf: "ℙ",
      popf: "𝕡",
      pound: "£",
      Pr: "⪻",
      pr: "≺",
      prap: "⪷",
      prcue: "≼",
      prE: "⪳",
      pre: "⪯",
      prec: "≺",
      precapprox: "⪷",
      preccurlyeq: "≼",
      Precedes: "≺",
      PrecedesEqual: "⪯",
      PrecedesSlantEqual: "≼",
      PrecedesTilde: "≾",
      preceq: "⪯",
      precnapprox: "⪹",
      precneqq: "⪵",
      precnsim: "⋨",
      precsim: "≾",
      Prime: "″",
      prime: "′",
      primes: "ℙ",
      prnap: "⪹",
      prnE: "⪵",
      prnsim: "⋨",
      prod: "∏",
      Product: "∏",
      profalar: "⌮",
      profline: "⌒",
      profsurf: "⌓",
      prop: "∝",
      Proportion: "∷",
      Proportional: "∝",
      propto: "∝",
      prsim: "≾",
      prurel: "⊰",
      Pscr: "𝒫",
      pscr: "𝓅",
      Psi: "Ψ",
      psi: "ψ",
      puncsp: " ",
      Qfr: "𝔔",
      qfr: "𝔮",
      qint: "⨌",
      Qopf: "ℚ",
      qopf: "𝕢",
      qprime: "⁗",
      Qscr: "𝒬",
      qscr: "𝓆",
      quaternions: "ℍ",
      quatint: "⨖",
      quest: "?",
      questeq: "≟",
      QUOT: '"',
      quot: '"',
      rAarr: "⇛",
      race: "∽̱",
      Racute: "Ŕ",
      racute: "ŕ",
      radic: "√",
      raemptyv: "⦳",
      Rang: "⟫",
      rang: "⟩",
      rangd: "⦒",
      range: "⦥",
      rangle: "⟩",
      raquo: "»",
      Rarr: "↠",
      rArr: "⇒",
      rarr: "→",
      rarrap: "⥵",
      rarrb: "⇥",
      rarrbfs: "⤠",
      rarrc: "⤳",
      rarrfs: "⤞",
      rarrhk: "↪",
      rarrlp: "↬",
      rarrpl: "⥅",
      rarrsim: "⥴",
      Rarrtl: "⤖",
      rarrtl: "↣",
      rarrw: "↝",
      rAtail: "⤜",
      ratail: "⤚",
      ratio: "∶",
      rationals: "ℚ",
      RBarr: "⤐",
      rBarr: "⤏",
      rbarr: "⤍",
      rbbrk: "❳",
      rbrace: "}",
      rbrack: "]",
      rbrke: "⦌",
      rbrksld: "⦎",
      rbrkslu: "⦐",
      Rcaron: "Ř",
      rcaron: "ř",
      Rcedil: "Ŗ",
      rcedil: "ŗ",
      rceil: "⌉",
      rcub: "}",
      Rcy: "Р",
      rcy: "р",
      rdca: "⤷",
      rdldhar: "⥩",
      rdquo: "”",
      rdquor: "”",
      rdsh: "↳",
      Re: "ℜ",
      real: "ℜ",
      realine: "ℛ",
      realpart: "ℜ",
      reals: "ℝ",
      rect: "▭",
      REG: "®",
      reg: "®",
      ReverseElement: "∋",
      ReverseEquilibrium: "⇋",
      ReverseUpEquilibrium: "⥯",
      rfisht: "⥽",
      rfloor: "⌋",
      Rfr: "ℜ",
      rfr: "𝔯",
      rHar: "⥤",
      rhard: "⇁",
      rharu: "⇀",
      rharul: "⥬",
      Rho: "Ρ",
      rho: "ρ",
      rhov: "ϱ",
      RightAngleBracket: "⟩",
      RightArrow: "→",
      Rightarrow: "⇒",
      rightarrow: "→",
      RightArrowBar: "⇥",
      RightArrowLeftArrow: "⇄",
      rightarrowtail: "↣",
      RightCeiling: "⌉",
      RightDoubleBracket: "⟧",
      RightDownTeeVector: "⥝",
      RightDownVector: "⇂",
      RightDownVectorBar: "⥕",
      RightFloor: "⌋",
      rightharpoondown: "⇁",
      rightharpoonup: "⇀",
      rightleftarrows: "⇄",
      rightleftharpoons: "⇌",
      rightrightarrows: "⇉",
      rightsquigarrow: "↝",
      RightTee: "⊢",
      RightTeeArrow: "↦",
      RightTeeVector: "⥛",
      rightthreetimes: "⋌",
      RightTriangle: "⊳",
      RightTriangleBar: "⧐",
      RightTriangleEqual: "⊵",
      RightUpDownVector: "⥏",
      RightUpTeeVector: "⥜",
      RightUpVector: "↾",
      RightUpVectorBar: "⥔",
      RightVector: "⇀",
      RightVectorBar: "⥓",
      ring: "˚",
      risingdotseq: "≓",
      rlarr: "⇄",
      rlhar: "⇌",
      rlm: "‏",
      rmoust: "⎱",
      rmoustache: "⎱",
      rnmid: "⫮",
      roang: "⟭",
      roarr: "⇾",
      robrk: "⟧",
      ropar: "⦆",
      Ropf: "ℝ",
      ropf: "𝕣",
      roplus: "⨮",
      rotimes: "⨵",
      RoundImplies: "⥰",
      rpar: ")",
      rpargt: "⦔",
      rppolint: "⨒",
      rrarr: "⇉",
      Rrightarrow: "⇛",
      rsaquo: "›",
      Rscr: "ℛ",
      rscr: "𝓇",
      Rsh: "↱",
      rsh: "↱",
      rsqb: "]",
      rsquo: "’",
      rsquor: "’",
      rthree: "⋌",
      rtimes: "⋊",
      rtri: "▹",
      rtrie: "⊵",
      rtrif: "▸",
      rtriltri: "⧎",
      RuleDelayed: "⧴",
      ruluhar: "⥨",
      rx: "℞",
      Sacute: "Ś",
      sacute: "ś",
      sbquo: "‚",
      Sc: "⪼",
      sc: "≻",
      scap: "⪸",
      Scaron: "Š",
      scaron: "š",
      sccue: "≽",
      scE: "⪴",
      sce: "⪰",
      Scedil: "Ş",
      scedil: "ş",
      Scirc: "Ŝ",
      scirc: "ŝ",
      scnap: "⪺",
      scnE: "⪶",
      scnsim: "⋩",
      scpolint: "⨓",
      scsim: "≿",
      Scy: "С",
      scy: "с",
      sdot: "⋅",
      sdotb: "⊡",
      sdote: "⩦",
      searhk: "⤥",
      seArr: "⇘",
      searr: "↘",
      searrow: "↘",
      sect: "§",
      semi: ";",
      seswar: "⤩",
      setminus: "∖",
      setmn: "∖",
      sext: "✶",
      Sfr: "𝔖",
      sfr: "𝔰",
      sfrown: "⌢",
      sharp: "♯",
      SHCHcy: "Щ",
      shchcy: "щ",
      SHcy: "Ш",
      shcy: "ш",
      ShortDownArrow: "↓",
      ShortLeftArrow: "←",
      shortmid: "∣",
      shortparallel: "∥",
      ShortRightArrow: "→",
      ShortUpArrow: "↑",
      shy: "­",
      Sigma: "Σ",
      sigma: "σ",
      sigmaf: "ς",
      sigmav: "ς",
      sim: "∼",
      simdot: "⩪",
      sime: "≃",
      simeq: "≃",
      simg: "⪞",
      simgE: "⪠",
      siml: "⪝",
      simlE: "⪟",
      simne: "≆",
      simplus: "⨤",
      simrarr: "⥲",
      slarr: "←",
      SmallCircle: "∘",
      smallsetminus: "∖",
      smashp: "⨳",
      smeparsl: "⧤",
      smid: "∣",
      smile: "⌣",
      smt: "⪪",
      smte: "⪬",
      smtes: "⪬︀",
      SOFTcy: "Ь",
      softcy: "ь",
      sol: "/",
      solb: "⧄",
      solbar: "⌿",
      Sopf: "𝕊",
      sopf: "𝕤",
      spades: "♠",
      spadesuit: "♠",
      spar: "∥",
      sqcap: "⊓",
      sqcaps: "⊓︀",
      sqcup: "⊔",
      sqcups: "⊔︀",
      Sqrt: "√",
      sqsub: "⊏",
      sqsube: "⊑",
      sqsubset: "⊏",
      sqsubseteq: "⊑",
      sqsup: "⊐",
      sqsupe: "⊒",
      sqsupset: "⊐",
      sqsupseteq: "⊒",
      squ: "□",
      Square: "□",
      square: "□",
      SquareIntersection: "⊓",
      SquareSubset: "⊏",
      SquareSubsetEqual: "⊑",
      SquareSuperset: "⊐",
      SquareSupersetEqual: "⊒",
      SquareUnion: "⊔",
      squarf: "▪",
      squf: "▪",
      srarr: "→",
      Sscr: "𝒮",
      sscr: "𝓈",
      ssetmn: "∖",
      ssmile: "⌣",
      sstarf: "⋆",
      Star: "⋆",
      star: "☆",
      starf: "★",
      straightepsilon: "ϵ",
      straightphi: "ϕ",
      strns: "¯",
      Sub: "⋐",
      sub: "⊂",
      subdot: "⪽",
      subE: "⫅",
      sube: "⊆",
      subedot: "⫃",
      submult: "⫁",
      subnE: "⫋",
      subne: "⊊",
      subplus: "⪿",
      subrarr: "⥹",
      Subset: "⋐",
      subset: "⊂",
      subseteq: "⊆",
      subseteqq: "⫅",
      SubsetEqual: "⊆",
      subsetneq: "⊊",
      subsetneqq: "⫋",
      subsim: "⫇",
      subsub: "⫕",
      subsup: "⫓",
      succ: "≻",
      succapprox: "⪸",
      succcurlyeq: "≽",
      Succeeds: "≻",
      SucceedsEqual: "⪰",
      SucceedsSlantEqual: "≽",
      SucceedsTilde: "≿",
      succeq: "⪰",
      succnapprox: "⪺",
      succneqq: "⪶",
      succnsim: "⋩",
      succsim: "≿",
      SuchThat: "∋",
      Sum: "∑",
      sum: "∑",
      sung: "♪",
      Sup: "⋑",
      sup: "⊃",
      sup1: "¹",
      sup2: "²",
      sup3: "³",
      supdot: "⪾",
      supdsub: "⫘",
      supE: "⫆",
      supe: "⊇",
      supedot: "⫄",
      Superset: "⊃",
      SupersetEqual: "⊇",
      suphsol: "⟉",
      suphsub: "⫗",
      suplarr: "⥻",
      supmult: "⫂",
      supnE: "⫌",
      supne: "⊋",
      supplus: "⫀",
      Supset: "⋑",
      supset: "⊃",
      supseteq: "⊇",
      supseteqq: "⫆",
      supsetneq: "⊋",
      supsetneqq: "⫌",
      supsim: "⫈",
      supsub: "⫔",
      supsup: "⫖",
      swarhk: "⤦",
      swArr: "⇙",
      swarr: "↙",
      swarrow: "↙",
      swnwar: "⤪",
      szlig: "ß",
      Tab: "	",
      target: "⌖",
      Tau: "Τ",
      tau: "τ",
      tbrk: "⎴",
      Tcaron: "Ť",
      tcaron: "ť",
      Tcedil: "Ţ",
      tcedil: "ţ",
      Tcy: "Т",
      tcy: "т",
      tdot: "⃛",
      telrec: "⌕",
      Tfr: "𝔗",
      tfr: "𝔱",
      there4: "∴",
      Therefore: "∴",
      therefore: "∴",
      Theta: "Θ",
      theta: "θ",
      thetasym: "ϑ",
      thetav: "ϑ",
      thickapprox: "≈",
      thicksim: "∼",
      ThickSpace: "  ",
      thinsp: " ",
      ThinSpace: " ",
      thkap: "≈",
      thksim: "∼",
      THORN: "Þ",
      thorn: "þ",
      Tilde: "∼",
      tilde: "˜",
      TildeEqual: "≃",
      TildeFullEqual: "≅",
      TildeTilde: "≈",
      times: "×",
      timesb: "⊠",
      timesbar: "⨱",
      timesd: "⨰",
      tint: "∭",
      toea: "⤨",
      top: "⊤",
      topbot: "⌶",
      topcir: "⫱",
      Topf: "𝕋",
      topf: "𝕥",
      topfork: "⫚",
      tosa: "⤩",
      tprime: "‴",
      TRADE: "™",
      trade: "™",
      triangle: "▵",
      triangledown: "▿",
      triangleleft: "◃",
      trianglelefteq: "⊴",
      triangleq: "≜",
      triangleright: "▹",
      trianglerighteq: "⊵",
      tridot: "◬",
      trie: "≜",
      triminus: "⨺",
      TripleDot: "⃛",
      triplus: "⨹",
      trisb: "⧍",
      tritime: "⨻",
      trpezium: "⏢",
      Tscr: "𝒯",
      tscr: "𝓉",
      TScy: "Ц",
      tscy: "ц",
      TSHcy: "Ћ",
      tshcy: "ћ",
      Tstrok: "Ŧ",
      tstrok: "ŧ",
      twixt: "≬",
      twoheadleftarrow: "↞",
      twoheadrightarrow: "↠",
      Uacute: "Ú",
      uacute: "ú",
      Uarr: "↟",
      uArr: "⇑",
      uarr: "↑",
      Uarrocir: "⥉",
      Ubrcy: "Ў",
      ubrcy: "ў",
      Ubreve: "Ŭ",
      ubreve: "ŭ",
      Ucirc: "Û",
      ucirc: "û",
      Ucy: "У",
      ucy: "у",
      udarr: "⇅",
      Udblac: "Ű",
      udblac: "ű",
      udhar: "⥮",
      ufisht: "⥾",
      Ufr: "𝔘",
      ufr: "𝔲",
      Ugrave: "Ù",
      ugrave: "ù",
      uHar: "⥣",
      uharl: "↿",
      uharr: "↾",
      uhblk: "▀",
      ulcorn: "⌜",
      ulcorner: "⌜",
      ulcrop: "⌏",
      ultri: "◸",
      Umacr: "Ū",
      umacr: "ū",
      uml: "¨",
      UnderBar: "_",
      UnderBrace: "⏟",
      UnderBracket: "⎵",
      UnderParenthesis: "⏝",
      Union: "⋃",
      UnionPlus: "⊎",
      Uogon: "Ų",
      uogon: "ų",
      Uopf: "𝕌",
      uopf: "𝕦",
      UpArrow: "↑",
      Uparrow: "⇑",
      uparrow: "↑",
      UpArrowBar: "⤒",
      UpArrowDownArrow: "⇅",
      UpDownArrow: "↕",
      Updownarrow: "⇕",
      updownarrow: "↕",
      UpEquilibrium: "⥮",
      upharpoonleft: "↿",
      upharpoonright: "↾",
      uplus: "⊎",
      UpperLeftArrow: "↖",
      UpperRightArrow: "↗",
      Upsi: "ϒ",
      upsi: "υ",
      upsih: "ϒ",
      Upsilon: "Υ",
      upsilon: "υ",
      UpTee: "⊥",
      UpTeeArrow: "↥",
      upuparrows: "⇈",
      urcorn: "⌝",
      urcorner: "⌝",
      urcrop: "⌎",
      Uring: "Ů",
      uring: "ů",
      urtri: "◹",
      Uscr: "𝒰",
      uscr: "𝓊",
      utdot: "⋰",
      Utilde: "Ũ",
      utilde: "ũ",
      utri: "▵",
      utrif: "▴",
      uuarr: "⇈",
      Uuml: "Ü",
      uuml: "ü",
      uwangle: "⦧",
      vangrt: "⦜",
      varepsilon: "ϵ",
      varkappa: "ϰ",
      varnothing: "∅",
      varphi: "ϕ",
      varpi: "ϖ",
      varpropto: "∝",
      vArr: "⇕",
      varr: "↕",
      varrho: "ϱ",
      varsigma: "ς",
      varsubsetneq: "⊊︀",
      varsubsetneqq: "⫋︀",
      varsupsetneq: "⊋︀",
      varsupsetneqq: "⫌︀",
      vartheta: "ϑ",
      vartriangleleft: "⊲",
      vartriangleright: "⊳",
      Vbar: "⫫",
      vBar: "⫨",
      vBarv: "⫩",
      Vcy: "В",
      vcy: "в",
      VDash: "⊫",
      Vdash: "⊩",
      vDash: "⊨",
      vdash: "⊢",
      Vdashl: "⫦",
      Vee: "⋁",
      vee: "∨",
      veebar: "⊻",
      veeeq: "≚",
      vellip: "⋮",
      Verbar: "‖",
      verbar: "|",
      Vert: "‖",
      vert: "|",
      VerticalBar: "∣",
      VerticalLine: "|",
      VerticalSeparator: "❘",
      VerticalTilde: "≀",
      VeryThinSpace: " ",
      Vfr: "𝔙",
      vfr: "𝔳",
      vltri: "⊲",
      vnsub: "⊂⃒",
      vnsup: "⊃⃒",
      Vopf: "𝕍",
      vopf: "𝕧",
      vprop: "∝",
      vrtri: "⊳",
      Vscr: "𝒱",
      vscr: "𝓋",
      vsubnE: "⫋︀",
      vsubne: "⊊︀",
      vsupnE: "⫌︀",
      vsupne: "⊋︀",
      Vvdash: "⊪",
      vzigzag: "⦚",
      Wcirc: "Ŵ",
      wcirc: "ŵ",
      wedbar: "⩟",
      Wedge: "⋀",
      wedge: "∧",
      wedgeq: "≙",
      weierp: "℘",
      Wfr: "𝔚",
      wfr: "𝔴",
      Wopf: "𝕎",
      wopf: "𝕨",
      wp: "℘",
      wr: "≀",
      wreath: "≀",
      Wscr: "𝒲",
      wscr: "𝓌",
      xcap: "⋂",
      xcirc: "◯",
      xcup: "⋃",
      xdtri: "▽",
      Xfr: "𝔛",
      xfr: "𝔵",
      xhArr: "⟺",
      xharr: "⟷",
      Xi: "Ξ",
      xi: "ξ",
      xlArr: "⟸",
      xlarr: "⟵",
      xmap: "⟼",
      xnis: "⋻",
      xodot: "⨀",
      Xopf: "𝕏",
      xopf: "𝕩",
      xoplus: "⨁",
      xotime: "⨂",
      xrArr: "⟹",
      xrarr: "⟶",
      Xscr: "𝒳",
      xscr: "𝓍",
      xsqcup: "⨆",
      xuplus: "⨄",
      xutri: "△",
      xvee: "⋁",
      xwedge: "⋀",
      Yacute: "Ý",
      yacute: "ý",
      YAcy: "Я",
      yacy: "я",
      Ycirc: "Ŷ",
      ycirc: "ŷ",
      Ycy: "Ы",
      ycy: "ы",
      yen: "¥",
      Yfr: "𝔜",
      yfr: "𝔶",
      YIcy: "Ї",
      yicy: "ї",
      Yopf: "𝕐",
      yopf: "𝕪",
      Yscr: "𝒴",
      yscr: "𝓎",
      YUcy: "Ю",
      yucy: "ю",
      Yuml: "Ÿ",
      yuml: "ÿ",
      Zacute: "Ź",
      zacute: "ź",
      Zcaron: "Ž",
      zcaron: "ž",
      Zcy: "З",
      zcy: "з",
      Zdot: "Ż",
      zdot: "ż",
      zeetrf: "ℨ",
      ZeroWidthSpace: "​",
      Zeta: "Ζ",
      zeta: "ζ",
      Zfr: "ℨ",
      zfr: "𝔷",
      ZHcy: "Ж",
      zhcy: "ж",
      zigrarr: "⇝",
      Zopf: "ℤ",
      zopf: "𝕫",
      Zscr: "𝒵",
      zscr: "𝓏",
      zwj: "‍",
      zwnj: "‌"
    }), e.entityMap = e.HTML_ENTITIES;
  })(l0)), l0;
}
var Fn = {}, xs;
function fg() {
  if (xs) return Fn;
  xs = 1;
  var e = jn().NAMESPACE, t = /[A-Z_a-z\xC0-\xD6\xD8-\xF6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/, r = new RegExp("[\\-\\.0-9" + t.source.slice(1, -1) + "\\u00B7\\u0300-\\u036F\\u203F-\\u2040]"), a = new RegExp("^" + t.source + r.source + "*(?::" + t.source + r.source + "*)?$"), n = 0, i = 1, c = 2, s = 3, u = 4, f = 5, o = 6, l = 7;
  function x(A, N) {
    this.message = A, this.locator = N, Error.captureStackTrace && Error.captureStackTrace(this, x);
  }
  x.prototype = new Error(), x.prototype.name = x.name;
  function h() {
  }
  h.prototype = {
    parse: function(A, N, R) {
      var V = this.domBuilder;
      V.startDocument(), y(N, N = {}), g(
        A,
        N,
        R,
        V,
        this.errorHandler
      ), V.endDocument();
    }
  };
  function g(A, N, R, V, ae) {
    function K(Ie) {
      if (Ie > 65535) {
        Ie -= 65536;
        var Pe = 55296 + (Ie >> 10), we = 56320 + (Ie & 1023);
        return String.fromCharCode(Pe, we);
      } else
        return String.fromCharCode(Ie);
    }
    function J(Ie) {
      var Pe = Ie.slice(1, -1);
      return Object.hasOwnProperty.call(R, Pe) ? R[Pe] : Pe.charAt(0) === "#" ? K(parseInt(Pe.substr(1).replace("x", "0x"))) : (ae.error("entity not found:" + Ie), Ie);
    }
    function fe(Ie) {
      if (Ie > ie) {
        var Pe = A.substring(ie, Ie).replace(/&#?\w+;/g, J);
        De && Y(ie), V.characters(Pe, 0, Ie - ie), ie = Ie;
      }
    }
    function Y(Ie, Pe) {
      for (; Ie >= ce && (Pe = re.exec(A)); )
        oe = Pe.index, ce = oe + Pe[0].length, De.lineNumber++;
      De.columnNumber = Ie - oe + 1;
    }
    for (var oe = 0, ce = 0, re = /.*(?:\r\n?|\n)|.*$/g, De = V.locator, be = [{ currentNSMap: N }], de = {}, ie = 0; ; ) {
      try {
        var Se = A.indexOf("<", ie);
        if (Se < 0) {
          if (!A.substr(ie).match(/^\s*$/)) {
            var _e = V.doc, Ne = _e.createTextNode(A.substr(ie));
            _e.appendChild(Ne), V.currentElement = Ne;
          }
          return;
        }
        switch (Se > ie && fe(Se), A.charAt(Se + 1)) {
          case "/":
            var se = A.indexOf(">", Se + 3), S = A.substring(Se + 2, se).replace(/[ \t\n\r]+$/g, ""), G = be.pop();
            se < 0 ? (S = A.substring(Se + 2).replace(/[\s<].*/, ""), ae.error("end tag name: " + S + " is not complete:" + G.tagName), se = Se + 1 + S.length) : S.match(/\s</) && (S = S.replace(/[\s<].*/, ""), ae.error("end tag name: " + S + " maybe not complete"), se = Se + 1 + S.length);
            var H = G.localNSMap, P = G.tagName == S, ee = P || G.tagName && G.tagName.toLowerCase() == S.toLowerCase();
            if (ee) {
              if (V.endElement(G.uri, G.localName, S), H)
                for (var Fe in H)
                  Object.prototype.hasOwnProperty.call(H, Fe) && V.endPrefixMapping(Fe);
              P || ae.fatalError("end tag name: " + S + " is not match the current start tagName:" + G.tagName);
            } else
              be.push(G);
            se++;
            break;
          // end elment
          case "?":
            De && Y(Se), se = W(A, Se, V);
            break;
          case "!":
            De && Y(Se), se = M(A, Se, V, ae);
            break;
          default:
            De && Y(Se);
            var te = new I(), ue = be[be.length - 1].currentNSMap, se = d(A, Se, te, ue, J, ae), Ce = te.length;
            if (!te.closed && m(A, se, te.tagName, de) && (te.closed = !0, R.nbsp || ae.warning("unclosed xml attribute")), De && Ce) {
              for (var Ae = _(De, {}), Te = 0; Te < Ce; Te++) {
                var ze = te[Te];
                Y(ze.offset), ze.locator = _(De, {});
              }
              V.locator = Ae, p(te, V, ue) && be.push(te), V.locator = De;
            } else
              p(te, V, ue) && be.push(te);
            e.isHTML(te.uri) && !te.closed ? se = w(A, se, te.tagName, J, V) : se++;
        }
      } catch (Ie) {
        if (Ie instanceof x)
          throw Ie;
        ae.error("element parse error: " + Ie), se = -1;
      }
      se > ie ? ie = se : fe(Math.max(Se, ie) + 1);
    }
  }
  function _(A, N) {
    return N.lineNumber = A.lineNumber, N.columnNumber = A.columnNumber, N;
  }
  function d(A, N, R, V, ae, K) {
    function J(De, be, de) {
      R.attributeNames.hasOwnProperty(De) && K.fatalError("Attribute " + De + " redefined"), R.addValue(
        De,
        // @see https://www.w3.org/TR/xml/#AVNormalize
        // since the xmldom sax parser does not "interpret" DTD the following is not implemented:
        // - recursive replacement of (DTD) entity references
        // - trimming and collapsing multiple spaces into a single one for attributes that are not of type CDATA
        be.replace(/[\t\n\r]/g, " ").replace(/&#?\w+;/g, ae),
        de
      );
    }
    for (var fe, Y, oe = ++N, ce = n; ; ) {
      var re = A.charAt(oe);
      switch (re) {
        case "=":
          if (ce === i)
            fe = A.slice(N, oe), ce = s;
          else if (ce === c)
            ce = s;
          else
            throw new Error("attribute equal must after attrName");
          break;
        case "'":
        case '"':
          if (ce === s || ce === i)
            if (ce === i && (K.warning('attribute value must after "="'), fe = A.slice(N, oe)), N = oe + 1, oe = A.indexOf(re, N), oe > 0)
              Y = A.slice(N, oe), J(fe, Y, N - 1), ce = f;
            else
              throw new Error("attribute value no end '" + re + "' match");
          else if (ce == u)
            Y = A.slice(N, oe), J(fe, Y, N), K.warning('attribute "' + fe + '" missed start quot(' + re + ")!!"), N = oe + 1, ce = f;
          else
            throw new Error('attribute value must after "="');
          break;
        case "/":
          switch (ce) {
            case n:
              R.setTagName(A.slice(N, oe));
            case f:
            case o:
            case l:
              ce = l, R.closed = !0;
            case u:
            case i:
              break;
            case c:
              R.closed = !0;
              break;
            //case S_EQ:
            default:
              throw new Error("attribute invalid close char('/')");
          }
          break;
        case "":
          return K.error("unexpected end of input"), ce == n && R.setTagName(A.slice(N, oe)), oe;
        case ">":
          switch (ce) {
            case n:
              R.setTagName(A.slice(N, oe));
            case f:
            case o:
            case l:
              break;
            //normal
            case u:
            //Compatible state
            case i:
              Y = A.slice(N, oe), Y.slice(-1) === "/" && (R.closed = !0, Y = Y.slice(0, -1));
            case c:
              ce === c && (Y = fe), ce == u ? (K.warning('attribute "' + Y + '" missed quot(")!'), J(fe, Y, N)) : ((!e.isHTML(V[""]) || !Y.match(/^(?:disabled|checked|selected)$/i)) && K.warning('attribute "' + Y + '" missed value!! "' + Y + '" instead!!'), J(Y, Y, N));
              break;
            case s:
              throw new Error("attribute value missed!!");
          }
          return oe;
        /*xml space '\x20' | #x9 | #xD | #xA; */
        case "":
          re = " ";
        default:
          if (re <= " ")
            switch (ce) {
              case n:
                R.setTagName(A.slice(N, oe)), ce = o;
                break;
              case i:
                fe = A.slice(N, oe), ce = c;
                break;
              case u:
                var Y = A.slice(N, oe);
                K.warning('attribute "' + Y + '" missed quot(")!!'), J(fe, Y, N);
              case f:
                ce = o;
                break;
            }
          else
            switch (ce) {
              //case S_TAG:void();break;
              //case S_ATTR:void();break;
              //case S_ATTR_NOQUOT_VALUE:void();break;
              case c:
                R.tagName, (!e.isHTML(V[""]) || !fe.match(/^(?:disabled|checked|selected)$/i)) && K.warning('attribute "' + fe + '" missed value!! "' + fe + '" instead2!!'), J(fe, fe, N), N = oe, ce = i;
                break;
              case f:
                K.warning('attribute space is required"' + fe + '"!!');
              case o:
                ce = i, N = oe;
                break;
              case s:
                ce = u, N = oe;
                break;
              case l:
                throw new Error("elements closed character '/' and '>' must be connected to");
            }
      }
      oe++;
    }
  }
  function p(A, N, R) {
    for (var V = A.tagName, ae = null, re = A.length; re--; ) {
      var K = A[re], J = K.qName, fe = K.value, De = J.indexOf(":");
      if (De > 0)
        var Y = K.prefix = J.slice(0, De), oe = J.slice(De + 1), ce = Y === "xmlns" && oe;
      else
        oe = J, Y = null, ce = J === "xmlns" && "";
      K.localName = oe, ce !== !1 && (ae == null && (ae = {}, y(R, R = {})), R[ce] = ae[ce] = fe, K.uri = e.XMLNS, N.startPrefixMapping(ce, fe));
    }
    for (var re = A.length; re--; ) {
      K = A[re];
      var Y = K.prefix;
      Y && (Y === "xml" && (K.uri = e.XML), Y !== "xmlns" && (K.uri = R[Y || ""]));
    }
    var De = V.indexOf(":");
    De > 0 ? (Y = A.prefix = V.slice(0, De), oe = A.localName = V.slice(De + 1)) : (Y = null, oe = A.localName = V);
    var be = A.uri = R[Y || ""];
    if (N.startElement(be, oe, V, A), A.closed) {
      if (N.endElement(be, oe, V), ae)
        for (Y in ae)
          Object.prototype.hasOwnProperty.call(ae, Y) && N.endPrefixMapping(Y);
    } else
      return A.currentNSMap = R, A.localNSMap = ae, !0;
  }
  function w(A, N, R, V, ae) {
    if (/^(?:script|textarea)$/i.test(R)) {
      var K = A.indexOf("</" + R + ">", N), J = A.substring(N + 1, K);
      if (/[&<]/.test(J))
        return /^script$/i.test(R) ? (ae.characters(J, 0, J.length), K) : (J = J.replace(/&#?\w+;/g, V), ae.characters(J, 0, J.length), K);
    }
    return N + 1;
  }
  function m(A, N, R, V) {
    var ae = V[R];
    return ae == null && (ae = A.lastIndexOf("</" + R + ">"), ae < N && (ae = A.lastIndexOf("</" + R)), V[R] = ae), ae < N;
  }
  function y(A, N) {
    for (var R in A)
      Object.prototype.hasOwnProperty.call(A, R) && (N[R] = A[R]);
  }
  function M(A, N, R, V) {
    var ae = A.charAt(N + 2);
    switch (ae) {
      case "-":
        if (A.charAt(N + 3) === "-") {
          var K = A.indexOf("-->", N + 4);
          return K > N ? (R.comment(A, N + 4, K - N - 4), K + 3) : (V.error("Unclosed comment"), -1);
        } else
          return -1;
      default:
        if (A.substr(N + 3, 6) == "CDATA[") {
          var K = A.indexOf("]]>", N + 9);
          return R.startCDATA(), R.characters(A, N + 9, K - N - 9), R.endCDATA(), K + 3;
        }
        var J = L(A, N), fe = J.length;
        if (fe > 1 && /!doctype/i.test(J[0][0])) {
          var Y = J[1][0], oe = !1, ce = !1;
          fe > 3 && (/^public$/i.test(J[2][0]) ? (oe = J[3][0], ce = fe > 4 && J[4][0]) : /^system$/i.test(J[2][0]) && (ce = J[3][0]));
          var re = J[fe - 1];
          return R.startDTD(Y, oe, ce), R.endDTD(), re.index + re[0].length;
        }
    }
    return -1;
  }
  function W(A, N, R) {
    var V = A.indexOf("?>", N);
    if (V) {
      var ae = A.substring(N, V).match(/^<\?(\S*)\s*([\s\S]*?)$/);
      return ae ? (ae[0].length, R.processingInstruction(ae[1], ae[2]), V + 2) : -1;
    }
    return -1;
  }
  function I() {
    this.attributeNames = {};
  }
  I.prototype = {
    setTagName: function(A) {
      if (!a.test(A))
        throw new Error("invalid tagName:" + A);
      this.tagName = A;
    },
    addValue: function(A, N, R) {
      if (!a.test(A))
        throw new Error("invalid attribute:" + A);
      this.attributeNames[A] = this.length, this[this.length++] = { qName: A, value: N, offset: R };
    },
    length: 0,
    getLocalName: function(A) {
      return this[A].localName;
    },
    getLocator: function(A) {
      return this[A].locator;
    },
    getQName: function(A) {
      return this[A].qName;
    },
    getURI: function(A) {
      return this[A].uri;
    },
    getValue: function(A) {
      return this[A].value;
    }
    //	,getIndex:function(uri, localName)){
    //		if(localName){
    //
    //		}else{
    //			var qName = uri
    //		}
    //	},
    //	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
    //	getType:function(uri,localName){}
    //	getType:function(i){},
  };
  function L(A, N) {
    var R, V = [], ae = /'[^']+'|"[^"]+"|[^\s<>\/=]+=?|(\/?\s*>|<)/g;
    for (ae.lastIndex = N, ae.exec(A); R = ae.exec(A); )
      if (V.push(R), R[1]) return V;
  }
  return Fn.XMLReader = h, Fn.ParseError = x, Fn;
}
var ps;
function og() {
  if (ps) return Na;
  ps = 1;
  var e = jn(), t = xu(), r = ug(), a = fg(), n = t.DOMImplementation, i = e.NAMESPACE, c = a.ParseError, s = a.XMLReader;
  function u(d) {
    return d.replace(/\r[\n\u0085]/g, `
`).replace(/[\r\u0085\u2028]/g, `
`);
  }
  function f(d) {
    this.options = d || { locator: {} };
  }
  f.prototype.parseFromString = function(d, p) {
    var w = this.options, m = new s(), y = w.domBuilder || new l(), M = w.errorHandler, W = w.locator, I = w.xmlns || {}, L = /\/x?html?$/.test(p), A = L ? r.HTML_ENTITIES : r.XML_ENTITIES;
    W && y.setDocumentLocator(W), m.errorHandler = o(M, y, W), m.domBuilder = w.domBuilder || y, L && (I[""] = i.HTML), I.xml = I.xml || i.XML;
    var N = w.normalizeLineEndings || u;
    return d && typeof d == "string" ? m.parse(
      N(d),
      I,
      A
    ) : m.errorHandler.error("invalid doc source"), y.doc;
  };
  function o(d, p, w) {
    if (!d) {
      if (p instanceof l)
        return p;
      d = p;
    }
    var m = {}, y = d instanceof Function;
    w = w || {};
    function M(W) {
      var I = d[W];
      !I && y && (I = d.length == 2 ? function(L) {
        d(W, L);
      } : d), m[W] = I && function(L) {
        I("[xmldom " + W + "]	" + L + h(w));
      } || function() {
      };
    }
    return M("warning"), M("error"), M("fatalError"), m;
  }
  function l() {
    this.cdata = !1;
  }
  function x(d, p) {
    p.lineNumber = d.lineNumber, p.columnNumber = d.columnNumber;
  }
  l.prototype = {
    startDocument: function() {
      this.doc = new n().createDocument(null, null, null), this.locator && (this.doc.documentURI = this.locator.systemId);
    },
    startElement: function(d, p, w, m) {
      var y = this.doc, M = y.createElementNS(d, w || p), W = m.length;
      _(this, M), this.currentElement = M, this.locator && x(this.locator, M);
      for (var I = 0; I < W; I++) {
        var d = m.getURI(I), L = m.getValue(I), w = m.getQName(I), A = y.createAttributeNS(d, w);
        this.locator && x(m.getLocator(I), A), A.value = A.nodeValue = L, M.setAttributeNode(A);
      }
    },
    endElement: function(d, p, w) {
      var m = this.currentElement;
      m.tagName, this.currentElement = m.parentNode;
    },
    startPrefixMapping: function(d, p) {
    },
    endPrefixMapping: function(d) {
    },
    processingInstruction: function(d, p) {
      var w = this.doc.createProcessingInstruction(d, p);
      this.locator && x(this.locator, w), _(this, w);
    },
    ignorableWhitespace: function(d, p, w) {
    },
    characters: function(d, p, w) {
      if (d = g.apply(this, arguments), d) {
        if (this.cdata)
          var m = this.doc.createCDATASection(d);
        else
          var m = this.doc.createTextNode(d);
        this.currentElement ? this.currentElement.appendChild(m) : /^\s*$/.test(d) && this.doc.appendChild(m), this.locator && x(this.locator, m);
      }
    },
    skippedEntity: function(d) {
    },
    endDocument: function() {
      this.doc.normalize();
    },
    setDocumentLocator: function(d) {
      (this.locator = d) && (d.lineNumber = 0);
    },
    //LexicalHandler
    comment: function(d, p, w) {
      d = g.apply(this, arguments);
      var m = this.doc.createComment(d);
      this.locator && x(this.locator, m), _(this, m);
    },
    startCDATA: function() {
      this.cdata = !0;
    },
    endCDATA: function() {
      this.cdata = !1;
    },
    startDTD: function(d, p, w) {
      var m = this.doc.implementation;
      if (m && m.createDocumentType) {
        var y = m.createDocumentType(d, p, w);
        this.locator && x(this.locator, y), _(this, y), this.doc.doctype = y;
      }
    },
    /**
     * @see org.xml.sax.ErrorHandler
     * @link http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
     */
    warning: function(d) {
      console.warn("[xmldom warning]	" + d, h(this.locator));
    },
    error: function(d) {
      console.error("[xmldom error]	" + d, h(this.locator));
    },
    fatalError: function(d) {
      throw new c(d, this.locator);
    }
  };
  function h(d) {
    if (d)
      return `
@` + (d.systemId || "") + "#[line:" + d.lineNumber + ",col:" + d.columnNumber + "]";
  }
  function g(d, p, w) {
    return typeof d == "string" ? d.substr(p, w) : d.length >= p + w || p ? new java.lang.String(d, p, w) + "" : d;
  }
  "endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(/\w+/g, function(d) {
    l.prototype[d] = function() {
      return null;
    };
  });
  function _(d, p) {
    d.currentElement ? d.currentElement.appendChild(p) : d.doc.appendChild(p);
  }
  return Na.__DOMHandler = l, Na.normalizeLineEndings = u, Na.DOMParser = f, Na;
}
var vs;
function lg() {
  if (vs) return Ia;
  vs = 1;
  var e = xu();
  return Ia.DOMImplementation = e.DOMImplementation, Ia.XMLSerializer = e.XMLSerializer, Ia.DOMParser = og().DOMParser, Ia;
}
var hg = lg();
const dg = "/chart", xg = "/drawing", pg = "/worksheet", vg = {
  areaChart: "area",
  area3DChart: "area",
  barChart: "bar",
  bar3DChart: "bar",
  doughnutChart: "doughnut",
  lineChart: "line",
  line3DChart: "line",
  pieChart: "pie",
  pie3DChart: "pie",
  radarChart: "radar",
  scatterChart: "scatter"
}, gg = {
  b: "bottom",
  l: "left",
  r: "right",
  t: "top",
  tr: "top"
}, mg = {
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  dk1: "#000000",
  dk2: "#44546a",
  lt1: "#ffffff",
  lt2: "#e7e6e6",
  tx1: "#000000",
  tx2: "#44546a"
}, Kn = (e) => {
  const t = e.localName || e.nodeName;
  return t.split(":").pop() || t;
}, Yn = (e) => e ? Array.from(e.childNodes).filter((t) => t.nodeType === 1) : [], pu = (e, t) => Yn(e).filter((r) => Kn(r) === t), ar = (e, t) => pu(e, t)[0], ln = (e, t) => {
  const r = [], a = (n) => {
    Yn(n).forEach((i) => {
      Kn(i) === t && r.push(i), a(i);
    });
  };
  return e && a(e), r;
}, bt = (e, t) => ln(e, t)[0], kn = (e, t = "val") => {
  const r = Number(e?.getAttribute(t));
  return Number.isFinite(r) ? r : 0;
}, Ht = (e) => {
  var t;
  return ((t = e?.textContent) === null || t === void 0 ? void 0 : t.trim()) || "";
}, vu = (e) => e && (e.getAttribute("r:id") || e.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")) || "", _g = (e, t) => {
  const r = e.includes("/") ? e.slice(0, e.lastIndexOf("/")) : "", a = (t.startsWith("/") ? t.slice(1) : `${r}/${t}`).split("/"), n = [];
  for (const i of a)
    if (!(!i || i === ".")) {
      if (i === "..") {
        n.pop();
        continue;
      }
      n.push(i);
    }
  return n.join("/");
}, Eg = (e) => {
  const t = e.lastIndexOf("/"), r = t >= 0 ? e.slice(0, t) : "", a = t >= 0 ? e.slice(t + 1) : e;
  return `${r ? `${r}/` : ""}_rels/${a}.rels`;
}, wg = (e) => new hg.DOMParser().parseFromString(e, "application/xml"), Un = async (e, t) => {
  const r = e.file(t);
  return r ? wg(await r.async("text")) : null;
}, T0 = async (e, t) => {
  const r = await Un(e, Eg(t));
  return r ? ln(r.documentElement, "Relationship").flatMap((a) => {
    const n = a.getAttribute("Id") || "", i = a.getAttribute("Target") || "", c = a.getAttribute("Type") || "";
    return !n || !i || a.getAttribute("TargetMode") === "External" ? [] : [{ id: n, target: _g(t, i), type: c }];
  }) : [];
}, gu = (e, t) => e.find((r) => r.id === t), gs = (e) => {
  if (e)
    return {
      row: Number(Ht(ar(e, "row"))) || 0,
      col: Number(Ht(ar(e, "col"))) || 0,
      rowOff: Number(Ht(ar(e, "rowOff"))) || 0,
      colOff: Number(Ht(ar(e, "colOff"))) || 0
    };
}, F0 = (e) => e ? ln(e, "pt").map((t) => ({
  index: Number(t.getAttribute("idx")) || 0,
  value: Ht(ar(t, "v")) || Ht(bt(t, "v"))
})).sort((t, r) => t.index - r.index).map((t) => t.value) : [], Cn = (e) => {
  if (!e)
    return "";
  const t = F0(e);
  if (t.length)
    return t.join(" ").trim();
  const r = ln(e, "t").map(Ht).filter(Boolean).join(" ").trim();
  return r || Ht(bt(e, "v"));
}, Ag = (e) => {
  var t, r;
  const a = ar(e, "spPr"), n = bt(a, "solidFill"), i = (t = bt(n, "srgbClr")) === null || t === void 0 ? void 0 : t.getAttribute("val");
  if (i && /^[0-9a-f]{6}$/i.test(i))
    return `#${i}`;
  const c = ((r = bt(n, "schemeClr")) === null || r === void 0 ? void 0 : r.getAttribute("val")) || "";
  return mg[c];
}, Tg = (e) => pu(e, "ser").map((t, r) => {
  const a = ar(t, "tx"), n = ar(t, "cat") || ar(t, "xVal"), i = ar(t, "val") || ar(t, "yVal"), c = F0(n), s = F0(i).map(Number).filter(Number.isFinite);
  return {
    name: Cn(a) || `Series ${r + 1}`,
    categories: c.length ? c : s.map((u, f) => `${f + 1}`),
    values: s,
    color: Ag(t)
  };
}), Fg = (e) => {
  var t, r, a;
  const n = e.documentElement, i = bt(n, "chart"), c = ar(i, "plotArea") || bt(i, "plotArea"), s = Yn(c).map((h) => ({ element: h, type: vg[Kn(h)] })).find((h) => h.type);
  if (!s)
    return null;
  const u = ar(i, "legend"), f = ((t = ar(u, "legendPos")) === null || t === void 0 ? void 0 : t.getAttribute("val")) || "", o = ar(c, "catAx"), l = ar(c, "valAx"), x = ((r = ar(s.element, "barDir")) === null || r === void 0 ? void 0 : r.getAttribute("val")) === "bar" ? "bar" : "column";
  return {
    type: s.type,
    title: Cn(ar(i, "title")) || void 0,
    categoryAxisTitle: Cn(ar(o, "title")) || void 0,
    valueAxisTitle: Cn(ar(l, "title")) || void 0,
    barDirection: x,
    grouping: ((a = ar(s.element, "grouping")) === null || a === void 0 ? void 0 : a.getAttribute("val")) || void 0,
    legendPosition: u ? gg[f] || "bottom" : void 0,
    series: Tg(s.element)
  };
}, kg = async (e, t) => {
  const [r, a] = await Promise.all([
    Un(e, t),
    T0(e, t)
  ]);
  if (!r)
    return [];
  const n = Yn(r.documentElement).filter((c) => Kn(c).endsWith("Anchor"));
  return (await Promise.all(n.map(async (c, s) => {
    var u;
    const f = bt(c, "chart"), o = gu(a, vu(f));
    if (!o?.type.endsWith(dg))
      return null;
    const l = await Un(e, o.target), x = l ? Fg(l) : null;
    if (!x || !x.series.length || x.series.every((p) => !p.values.length))
      return null;
    const h = gs(ar(c, "from")) || {
      row: 0,
      col: 0,
      rowOff: kn(ar(c, "pos"), "y"),
      colOff: kn(ar(c, "pos"), "x")
    }, g = gs(ar(c, "to")), _ = ar(c, "ext"), d = (u = bt(c, "cNvPr")) === null || u === void 0 ? void 0 : u.getAttribute("name");
    return {
      ...x,
      id: d || o.target || `chart-${s + 1}`,
      from: h,
      to: g,
      ext: _ ? {
        width: kn(_, "cx"),
        height: kn(_, "cy")
      } : void 0
    };
  }))).filter((c) => c !== null);
}, Dg = async (e) => {
  const t = await Eu.loadAsync(e), r = "xl/workbook.xml", [a, n] = await Promise.all([
    Un(t, r),
    T0(t, r)
  ]), i = {};
  if (!a)
    return i;
  for (const c of ln(a.documentElement, "sheet")) {
    const s = c.getAttribute("name") || "", u = gu(n, vu(c));
    if (!s || !u?.type.endsWith(pg))
      continue;
    const f = await T0(t, u.target), o = Array.from(new Set(f.filter((x) => x.type.endsWith(xg)).map((x) => x.target))), l = (await Promise.all(o.map((x) => kg(t, x)))).flat();
    l.length && (i[s] = l);
  }
  return i;
}, ms = /* @__PURE__ */ new Set(["csv", "tsv"]), Cg = /* @__PURE__ */ new Set([
  "text/csv",
  "text/tab-separated-values"
]), yg = (e) => String(e || "").trim().toLowerCase().replace(/^\./, "").split(/[?#;]/, 1)[0], Sg = (e) => {
  const t = String(e || "").trim().toLowerCase().split(/[?#]/, 1)[0], r = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")), a = t.lastIndexOf(".");
  return a > r ? t.slice(a + 1) : "";
}, bg = ({ fileType: e, filename: t }) => {
  const r = yg(e);
  return r ? ms.has(r) || Cg.has(r) : ms.has(Sg(t));
}, Oa = (e, t) => {
  if (typeof TextDecoder > "u")
    throw new Error("Spreadsheet text decoding requires the browser TextDecoder API.");
  try {
    return new TextDecoder(t).decode(e);
  } catch (r) {
    throw t === "gb18030" && r instanceof RangeError ? new Error('This browser does not provide GB18030 text decoding. Use a current browser or set spreadsheet.textEncoding to "utf-8".') : r;
  }
}, _s = (e) => e.length >= 3 && e[0] === 239 && e[1] === 187 && e[2] === 191, Zr = (e) => e !== void 0 && e >= 128 && e <= 191, Ig = (e) => {
  for (let t = 0; t < e.length; ) {
    const r = e[t];
    if (r === void 0)
      return !1;
    if (r <= 127) {
      t += 1;
      continue;
    }
    const a = e[t + 1], n = e[t + 2], i = e[t + 3];
    if (r >= 194 && r <= 223 && Zr(a)) {
      t += 2;
      continue;
    }
    if (r === 224 && a !== void 0 && a >= 160 && a <= 191 && Zr(n)) {
      t += 3;
      continue;
    }
    if ((r >= 225 && r <= 236 || r >= 238 && r <= 239) && Zr(a) && Zr(n)) {
      t += 3;
      continue;
    }
    if (r === 237 && a !== void 0 && a >= 128 && a <= 159 && Zr(n)) {
      t += 3;
      continue;
    }
    if (r === 240 && a !== void 0 && a >= 144 && a <= 191 && Zr(n) && Zr(i)) {
      t += 4;
      continue;
    }
    if (r >= 241 && r <= 243 && Zr(a) && Zr(n) && Zr(i)) {
      t += 4;
      continue;
    }
    if (r === 244 && a !== void 0 && a >= 128 && a <= 143 && Zr(n) && Zr(i)) {
      t += 4;
      continue;
    }
    return !1;
  }
  return !0;
}, Ng = (e) => {
  const t = String(e || "auto").trim().toLowerCase().replace("_", "-");
  return t === "utf8" || t === "utf-8" ? "utf-8" : t === "gbk" || t === "cp936" || t === "gb2312" ? "gbk" : t === "gb18030" ? "gb18030" : "auto";
}, Og = (e, t = "auto") => {
  const r = new Uint8Array(e), a = Ng(t);
  if (a === "utf-8") {
    const n = _s(r) ? r.subarray(3) : r;
    return { text: Oa(n, "utf-8"), encoding: "utf-8" };
  }
  return a === "gbk" || a === "gb18030" ? { text: Oa(r, "gb18030"), encoding: "gb18030" } : _s(r) ? { text: Oa(r.subarray(3), "utf-8"), encoding: "utf-8" } : Ig(r) ? { text: Oa(r, "utf-8"), encoding: "utf-8" } : { text: Oa(r, "gb18030"), encoding: "gb18030" };
}, Rg = (e, t = {}) => {
  if (!bg(t))
    return { kind: "binary", data: e };
  const r = Og(e, t.textEncoding);
  return {
    kind: "text",
    data: r.text,
    encoding: r.encoding
  };
}, Es = {
  type: "array",
  dense: !0,
  cellDates: !0,
  cellStyles: !0,
  browserPixels: !0,
  drawings: !0,
  validateMerges: !0
}, Yg = () => ({
  workbook: null,
  sheets: [],
  charts: {}
}), mu = (e, t = {}) => ({
  type: "parseError",
  payload: {
    ...t,
    message: e instanceof Error ? e.message : String(e)
  }
}), Bg = (e) => {
  var t;
  return (((t = e?.["!drawings"]) === null || t === void 0 ? void 0 : t.images) || []).reduce((a, n) => {
    var i, c, s, u, f, o;
    const l = n.anchor, x = Number((c = (i = l?.to) === null || i === void 0 ? void 0 : i.row) !== null && c !== void 0 ? c : (s = l?.from) === null || s === void 0 ? void 0 : s.row), h = Number((f = (u = l?.to) === null || u === void 0 ? void 0 : u.col) !== null && f !== void 0 ? f : (o = l?.from) === null || o === void 0 ? void 0 : o.col);
    return {
      rowCount: Number.isFinite(x) ? Math.max(a.rowCount, x + 1) : a.rowCount,
      colCount: Number.isFinite(h) ? Math.max(a.colCount, h + 1) : a.colCount
    };
  }, {
    rowCount: 0,
    colCount: 0
  });
}, Lg = (e) => (e || []).reduce((t, r) => {
  var a, n, i, c, s, u;
  const f = !((a = r.ext) === null || a === void 0) && a.height ? Math.ceil(r.ext.height / 9525 / 20) : 0, o = !((n = r.ext) === null || n === void 0) && n.width ? Math.ceil(r.ext.width / 9525 / 64) : 0, l = (c = (i = r.to) === null || i === void 0 ? void 0 : i.row) !== null && c !== void 0 ? c : r.from.row + f, x = (u = (s = r.to) === null || s === void 0 ? void 0 : s.col) !== null && u !== void 0 ? u : r.from.col + o;
  return {
    rowCount: Math.max(t.rowCount, l + 1),
    colCount: Math.max(t.colCount, x + 1)
  };
}, {
  rowCount: 0,
  colCount: 0
}), Mg = 1e3, Pg = 256, Ug = 256, Hg = 64, Vg = 4, Wg = (e) => {
  const t = { rowCount: 0, colCount: 0 };
  if (!e)
    return t;
  const r = Array.isArray(e) ? e : e["!data"];
  if (Array.isArray(r)) {
    for (const a of Object.keys(r)) {
      const n = Number(a), i = r[n];
      if (!(!Number.isInteger(n) || n < 0 || !Array.isArray(i)))
        for (const c of Object.keys(i)) {
          const s = Number(c);
          !Number.isInteger(s) || s < 0 || i[s] == null || (t.rowCount = Math.max(t.rowCount, n + 1), t.colCount = Math.max(t.colCount, s + 1));
        }
    }
    return t;
  }
  for (const a of Object.keys(e))
    if (!(a.startsWith("!") || !/^[A-Z]+[1-9][0-9]*$/i.test(a) || e[a] == null))
      try {
        const n = ut.decode_cell(a);
        t.rowCount = Math.max(t.rowCount, n.r + 1), t.colCount = Math.max(t.colCount, n.c + 1);
      } catch {
      }
  return t;
}, Gg = (e) => (e?.["!merges"] || []).reduce((t, r) => {
  var a, n, i, c, s, u;
  const f = Number((n = (a = r.e) === null || a === void 0 ? void 0 : a.row) !== null && n !== void 0 ? n : (i = r.e) === null || i === void 0 ? void 0 : i.r), o = Number((s = (c = r.e) === null || c === void 0 ? void 0 : c.col) !== null && s !== void 0 ? s : (u = r.e) === null || u === void 0 ? void 0 : u.c);
  return {
    rowCount: Number.isFinite(f) ? Math.max(t.rowCount, f + 1) : t.rowCount,
    colCount: Number.isFinite(o) ? Math.max(t.colCount, o + 1) : t.colCount
  };
}, { rowCount: 0, colCount: 0 }), ws = (e, t, r, a) => {
  if (t <= 0)
    return Math.min(Math.max(e, 1), a);
  const n = Math.max(t + r, t * Vg);
  return e <= n ? Math.max(e, t) : t;
}, Xg = (e, t) => {
  let r = 0, a = 0;
  const n = e?.["!ref"];
  if (n)
    try {
      const h = ut.decode_range(n);
      r = h.e.r + 1, a = h.e.c + 1;
    } catch {
    }
  const i = Wg(e), c = Gg(e), s = Bg(e), u = Lg(t), f = Math.max(i.rowCount, c.rowCount, s.rowCount, u.rowCount), o = Math.max(i.colCount, c.colCount, s.colCount, u.colCount), l = ws(r, f, Ug, Mg), x = ws(a, o, Hg, Pg);
  return {
    rowCount: l,
    colCount: x,
    declaredRowCount: r,
    declaredColCount: a,
    observedRowCount: f,
    observedColCount: o,
    trimmed: l < r || x < a
  };
}, zg = (e) => {
  var t;
  const r = e.workbook;
  if (!r?.SheetNames)
    return [];
  const a = ((t = r.Workbook) === null || t === void 0 ? void 0 : t.Sheets) || [];
  return e.sheets = r.SheetNames.reduce((n, i, c) => {
    var s;
    const u = r.Sheets[i], f = Xg(u, e.charts[i]);
    return !u?.["!ref"] && !f.observedRowCount && !f.observedColCount || (f.trimmed && console.warn(`[file-viewer] Ignored pathological worksheet dimensions for ${i}: ${f.declaredRowCount}x${f.declaredColCount} -> ${f.rowCount}x${f.colCount}.`), n.push({
      id: n.length,
      name: i,
      hidden: !!(!((s = a[c]) === null || s === void 0) && s.Hidden),
      rowCount: f.rowCount,
      colCount: f.colCount
    })), n;
  }, []), [{ type: "sheets", payload: { sheets: e.sheets } }];
}, qg = async (e, t, r = {}) => {
  try {
    const a = Rg(t, r);
    if (e.workbook = a.kind === "text" ? aa(a.data, { ...Es, type: "string" }) : aa(a.data, Es), (t.byteLength >= 2 ? new DataView(t).getUint16(0, !1) : 0) === 20555)
      try {
        e.charts = await Dg(t);
      } catch (i) {
        e.charts = {}, console.warn("[file-viewer] Spreadsheet chart parsing failed; continuing with cell content.", i);
      }
    else
      e.charts = {};
    return zg(e);
  } catch (a) {
    return [mu(a)];
  }
}, $g = (e, t = {}) => {
  var r;
  const { sheet: a, startRow: n = 0, pageSize: i = 500, sessionId: c = 0 } = t;
  try {
    const s = e.workbook, u = (r = e.sheets.find((g) => g.id === a)) === null || r === void 0 ? void 0 : r.name;
    if (!s?.Sheets || !u)
      return [];
    const f = s.Sheets[u];
    if (!f)
      return [];
    const o = e.sheets.find((g) => g.id === a), l = tn.create(f, {
      startRow: n,
      pageSize: i,
      totalRows: o?.rowCount,
      totalCols: o?.colCount,
      charts: e.charts[u]
    }), x = l.toObject({ includeLayout: n === 0 }), h = n === 0 ? l.structure : void 0;
    return [{
      type: "parseSheet",
      payload: {
        sessionId: c,
        sheet: a,
        sheetData: h ? {
          ...x,
          structure: h
        } : x
      }
    }];
  } catch (s) {
    return [mu(s, { sessionId: c, startRow: n })];
  }
}, Jg = (e, t) => {
  var r, a, n, i;
  switch (t.type) {
    case "parseWorkbook":
      return qg(e, (r = t.payload) === null || r === void 0 ? void 0 : r.workbook, {
        fileType: (a = t.payload) === null || a === void 0 ? void 0 : a.fileType,
        filename: (n = t.payload) === null || n === void 0 ? void 0 : n.filename,
        textEncoding: (i = t.payload) === null || i === void 0 ? void 0 : i.textEncoding
      });
    case "parseSheet":
      return $g(e, t.payload);
    default:
      return [];
  }
};
export {
  Yg as createSpreadsheetParserContext,
  Xg as getWorksheetDisplayBounds,
  Jg as handleSpreadsheetWorkerRequest,
  $g as parseSpreadsheetSheet,
  qg as parseSpreadsheetWorkbook
};
