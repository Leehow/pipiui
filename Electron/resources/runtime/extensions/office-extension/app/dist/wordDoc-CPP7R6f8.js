import { r as An, u as Ln, a as Fn, b as _n } from "./office-renderer-CZRmDY3X.js";
import { b as Dn, a as $n, f as Ke } from "./printLayout-BXoQACLZ.js";
const gt = globalThis.Buffer;
let xt = 0;
function F(e) {
  return String(e).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function Z(e = "id") {
  return xt += 1, `${e}-${xt}`;
}
function Be(e) {
  return e % 2 === 0 ? e : e + 1;
}
function Nn(e) {
  const t = e instanceof Uint8Array ? e : e instanceof ArrayBuffer ? new Uint8Array(e) : new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
  if (gt)
    return gt.from(t).toString("base64");
  let n = "";
  const r = 32768;
  for (let a = 0; a < t.length; a += r)
    n += String.fromCharCode(...t.subarray(a, Math.min(a + r, t.length)));
  return btoa(n);
}
function de(e, t = "application/octet-stream") {
  return `data:${t};base64,${Nn(e)}`;
}
function en(e) {
  return String(e ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
function tn(e, t) {
  if (e === t)
    return !0;
  if (!e || !t)
    return !1;
  const n = Object.keys(e), r = Object.keys(t);
  if (n.length !== r.length)
    return !1;
  for (const a of n)
    if (e[a] !== t[a])
      return !1;
  return !0;
}
function Pe(e, t, n) {
  const r = n ? { message: t, ...n } : { message: t };
  return e.push(r), r;
}
function z(e, t = 96) {
  if (!(e == null || Number.isNaN(e)))
    return e / 1440 * t;
}
function Wn(e) {
  return String(e ?? "").replace(/\u000b/g, `
`).replace(/\u000c/g, `
`);
}
function rt(e = "utf-8") {
  return new TextDecoder(e, { fatal: !1 });
}
const bt = rt("utf-16le"), Hn = rt(typeof TextDecoder < "u" ? "windows-1252" : "latin1");
class M {
  bytes;
  view;
  length;
  constructor(t) {
    if (t instanceof Uint8Array)
      this.bytes = t;
    else if (t instanceof ArrayBuffer)
      this.bytes = new Uint8Array(t);
    else if (ArrayBuffer.isView(t))
      this.bytes = new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
    else
      throw new TypeError("BinaryReader expects ArrayBuffer or Uint8Array");
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength), this.length = this.bytes.byteLength;
  }
  ensure(t, n = 1) {
    return t >= 0 && t + n <= this.length;
  }
  u8(t) {
    return this.ensure(t, 1) ? this.view.getUint8(t) : 0;
  }
  i8(t) {
    return this.ensure(t, 1) ? this.view.getInt8(t) : 0;
  }
  u16(t) {
    return this.ensure(t, 2) ? this.view.getUint16(t, !0) : 0;
  }
  i16(t) {
    return this.ensure(t, 2) ? this.view.getInt16(t, !0) : 0;
  }
  u32(t) {
    return this.ensure(t, 4) ? this.view.getUint32(t, !0) : 0;
  }
  i32(t) {
    return this.ensure(t, 4) ? this.view.getInt32(t, !0) : 0;
  }
  u64(t) {
    const n = this.u32(t);
    return this.u32(t + 4) * 4294967296 + n;
  }
  slice(t, n) {
    return this.ensure(t, n) ? this.bytes.subarray(t, t + n) : new Uint8Array(0);
  }
  array(t, n, r) {
    const a = [], s = r.byteWidth ?? 1;
    for (let o = 0; o < n; o += 1)
      a.push(r.call(this, t + o * s));
    return a;
  }
  utf16le(t, n) {
    return this.ensure(t, n) ? bt.decode(this.slice(t, n)) : "";
  }
  latin1(t, n) {
    return this.ensure(t, n) ? Hn.decode(this.slice(t, n)) : "";
  }
  ascii(t, n) {
    if (!this.ensure(t, n))
      return "";
    let r = "";
    const a = this.slice(t, n);
    for (let s = 0; s < a.length; s += 1)
      r += String.fromCharCode(a[s] ?? 0);
    return r;
  }
  utf16z(t, n) {
    const r = this.slice(t, n);
    let a = r.length;
    for (let s = 0; s + 1 < r.length; s += 2)
      if (r[s] === 0 && r[s + 1] === 0) {
        a = s;
        break;
      }
    return bt.decode(r.subarray(0, a));
  }
}
M.prototype.u8.byteWidth = 1;
M.prototype.i8.byteWidth = 1;
M.prototype.u16.byteWidth = 2;
M.prototype.i16.byteWidth = 2;
M.prototype.u32.byteWidth = 4;
M.prototype.i32.byteWidth = 4;
function Un(e) {
  if (e instanceof Uint8Array)
    return e;
  if (e instanceof ArrayBuffer)
    return new Uint8Array(e);
  if (ArrayBuffer.isView(e))
    return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
  throw new TypeError("Unsupported binary input");
}
const Tt = [208, 207, 17, 224, 161, 177, 26, 225], Ge = 4294967295, ge = 4294967294, zn = 4294967293, jn = 4294967292, Yn = 1 << 20, Gn = 4096;
function Et(e) {
  return e === Ge || e === ge || e === zn || e === jn;
}
function at(e, t, n) {
  const r = 512 + n * t, a = r + t;
  if (r < 0 || r >= e.length)
    throw new Error(`Sector ${n} is out of bounds`);
  if (a <= e.length)
    return e.subarray(r, a);
  const s = new Uint8Array(t);
  return s.set(e.subarray(r)), s;
}
function nn(e, t, n = Yn) {
  const r = [], a = /* @__PURE__ */ new Set();
  let s = e, o = 0;
  for (; s !== ge && s !== Ge && s >= 0; ) {
    if (a.has(s))
      throw new Error(`Detected sector loop at ${s}`);
    if (a.add(s), r.push(s), s = t(s), o += 1, o > n)
      throw new Error("Sector chain exceeds safe limit");
  }
  return r;
}
function Le(e, t, n, r, a = null) {
  if (n === ge || n === Ge || n < 0)
    return new Uint8Array(0);
  const s = nn(n, (l) => r[l] ?? ge), o = new Uint8Array(s.length * t);
  let i = 0;
  for (const l of s)
    o.set(at(e, t, l), i), i += t;
  return a == null ? o : o.subarray(0, Math.min(a, o.length));
}
function Xn(e) {
  function t(a, s) {
    if (a < 0 || a >= e.length)
      return;
    const o = e[a];
    o && (t(o.leftSiblingId, s), s.push(a), t(o.rightSiblingId, s));
  }
  function n(a) {
    const s = e[a];
    if (!s || s.childId < 0)
      return;
    const o = [];
    t(s.childId, o), s.children = o;
    for (const i of o) {
      const l = e[i];
      l && (l.parentId = a, n(i));
    }
  }
  const r = e.find((a) => a.objectType === 5);
  if (!r)
    throw new Error("CFB root storage not found");
  return n(r.id), r;
}
function Vn(e) {
  const t = /* @__PURE__ */ new Map();
  for (const n of e) {
    if (!n || !n.name)
      continue;
    const r = [];
    let a = n;
    for (; a; )
      a.objectType !== 5 && r.push(a.name), a = a.parentId != null ? e[a.parentId] ?? null : null;
    const s = `/${r.reverse().join("/")}`;
    n.path = s === "/" ? `/${n.name}` : s, t.set(n.path, n);
  }
  return t;
}
function Kn(e) {
  return e.replace(/\u0000+$/, "");
}
function Zn(e, t = {}) {
  const n = Un(e), r = new M(n), a = [];
  for (let w = 0; w < Tt.length; w += 1)
    if (r.u8(w) !== Tt[w])
      throw new Error("Not a Compound File Binary document");
  const s = r.u16(26), o = r.u16(30), i = r.u16(32), l = 1 << o, c = 1 << i, f = r.u32(40), u = r.u32(44), m = r.i32(48), h = r.u32(52), g = r.u32(56), x = r.i32(60), T = r.u32(64), P = r.i32(68), R = r.u32(72);
  g !== Gn && Pe(a, `Unexpected mini stream cutoff size ${g}`);
  const E = [];
  for (let w = 0; w < 109; w += 1) {
    const C = r.i32(76 + w * 4);
    !Et(C) && C >= 0 && E.push(C);
  }
  const v = [...E];
  let O = P, _ = 0;
  for (; O !== ge && O !== Ge && O >= 0; ) {
    const w = at(n, l, O), C = new M(w), D = l / 4 - 1;
    for (let H = 0; H < D; H += 1) {
      const X = C.i32(H * 4);
      !Et(X) && X >= 0 && v.push(X);
    }
    if (O = C.i32(l - 4), _ += 1, _ > R + 4) {
      Pe(a, "DIFAT chain exceeded declared sector count; stopping early");
      break;
    }
  }
  u && v.length < u && Pe(a, `FAT sector count mismatch: header says ${u}, found ${v.length}`);
  const $ = [];
  for (const w of v) {
    const C = at(n, l, w), D = new M(C);
    for (let H = 0; H < l / 4; H += 1)
      $.push(D.i32(H * 4));
  }
  const Y = Le(n, l, m, $), I = new M(Y), G = [];
  for (let w = 0, C = 0; w + 128 <= Y.length; w += 128, C += 1) {
    const D = I.u16(w + 64), H = Kn(I.utf16le(w, Math.max(0, D - 2)));
    !H && I.u8(w + 66) === 0 || G.push({
      id: C,
      name: H,
      objectType: I.u8(w + 66),
      colorFlag: I.u8(w + 67),
      leftSiblingId: I.i32(w + 68),
      rightSiblingId: I.i32(w + 72),
      childId: I.i32(w + 76),
      clsid: I.slice(w + 80, 16),
      stateBits: I.u32(w + 96),
      creationTime: I.u64(w + 100),
      modifiedTime: I.u64(w + 108),
      startSector: I.i32(w + 116),
      streamSize: s === 3 ? I.u32(w + 120) : I.u64(w + 120),
      children: [],
      parentId: null
    });
  }
  const q = Xn(G), j = Vn(G), le = [];
  if (T && x >= 0) {
    const w = Le(n, l, x, $), C = new M(w);
    for (let D = 0; D + 4 <= w.length; D += 4)
      le.push(C.i32(D));
  }
  const S = Le(n, l, q.startSector, $, q.streamSize);
  function be(w) {
    if (w.startSector < 0)
      return new Uint8Array(0);
    const C = nn(w.startSector, (X) => le[X] ?? ge), D = new Uint8Array(C.length * c);
    let H = 0;
    for (const X of C) {
      const Ae = X * c, Ee = Ae + c;
      if (Ee > S.length)
        throw new Error(`Mini sector ${X} is out of bounds`);
      D.set(S.subarray(Ae, Ee), H), H += c;
    }
    return D.subarray(0, Math.min(w.streamSize, D.length));
  }
  function Te(w) {
    const C = typeof w == "string" ? j.get(w) ?? null : w;
    return !C || C.objectType !== 2 && C.objectType !== 5 ? null : C.objectType === 5 ? S : C.streamSize < g && C.startSector >= 0 && le.length ? be(C) : Le(n, l, C.startSector, $, C.streamSize);
  }
  function ke(w) {
    const C = typeof w == "string" ? j.get(w) ?? null : w;
    return C ? (C.children || []).map((D) => G[D]).filter((D) => !!D) : [];
  }
  return {
    bytes: n,
    majorVersion: s,
    sectorSize: l,
    miniSectorSize: c,
    numDirSectors: f,
    numFatSectors: u,
    firstDirSector: m,
    transactionSignature: h,
    miniStreamCutoffSize: g,
    warnings: a,
    entries: G,
    root: q,
    pathMap: j,
    getEntry(w) {
      return j.get(w) ?? null;
    },
    getStream: Te,
    listChildren: ke,
    findByName(w, C = "/") {
      const D = C === "/" ? q : j.get(C) ?? null;
      if (!D)
        return null;
      const H = [D];
      for (; H.length; ) {
        const X = H.pop();
        if (X) {
          if (X.name === w)
            return X;
          for (const Ae of X.children || []) {
            const Ee = G[Ae];
            Ee && H.push(Ee);
          }
        }
      }
      return null;
    }
  };
}
const Jn = {
  "": "‚",
  "": "ƒ",
  "": "„",
  "": "…",
  "": "†",
  "": "‡",
  "": "ˆ",
  "": "‰",
  "": "Š",
  "": "‹",
  "": "Œ",
  "": "‘",
  "": "’",
  "": "“",
  "": "”",
  "": "•",
  "": "–",
  "": "—",
  "": "˜",
  "": "™",
  "": "š",
  "": "›",
  "": "œ",
  "": "Ÿ"
};
function qn(e) {
  return e.replace(/[\x82-\x8C\x91-\x9C\x9F]/g, (t) => Jn[t] || t);
}
function Qn(e) {
  let t = "";
  for (let n = 0; n < e.length; n += 1)
    t += String.fromCharCode(e[n] ?? 0);
  return qn(t);
}
function er(e) {
  return new TextDecoder("utf-16le").decode(e);
}
function tr(e, t) {
  const n = t.fcClx, r = t.lcbClx;
  if (n == null || r == null || r <= 0)
    throw new Error("FIB does not point to a CLX structure");
  const a = e.subarray(n, n + r), s = new M(a);
  let o = 0;
  const i = [];
  for (; o < a.length && s.u8(o) === 1; ) {
    const u = s.u16(o + 1);
    i.push({ type: 1, cbGrpprl: u, bytes: s.slice(o + 3, u) }), o += 3 + u;
  }
  if (s.u8(o) !== 2)
    throw new Error("CLX does not contain a Pcdt marker");
  const l = s.u32(o + 1), c = s.slice(o + 5, l), f = nr(c);
  return { prcs: i, pcdt: { lcb: l, pieceTable: f } };
}
function nr(e) {
  if (!e.length)
    throw new Error("Empty PlcPcd");
  const t = new M(e), n = (e.length - 4) / 12;
  if (!Number.isInteger(n) || n < 0)
    throw new Error("Invalid PlcPcd size");
  const r = [];
  for (let o = 0; o < n + 1; o += 1)
    r.push(t.u32(o * 4));
  const a = [];
  let s = (n + 1) * 4;
  for (let o = 0; o < n; o += 1) {
    const i = t.u16(s), l = t.u32(s + 2) >>> 0, c = t.u16(s + 6), f = !!(l & 1073741824), u = l & 1073741823, m = r[o] ?? 0, h = r[o + 1] ?? m, g = f ? Math.floor(u / 2) : u, x = f ? h - m : (h - m) * 2;
    a.push({
      index: o,
      descriptor: i,
      fNoParaLast: !!(i & 1),
      fRaw: !!(i & 2),
      prm: c,
      compressed: f,
      fcRaw: l,
      fc: u,
      cpStart: m,
      cpEnd: h,
      actualByteStart: g,
      byteLength: x,
      actualByteEnd: g + x
    }), s += 8;
  }
  return { cps: r, pieces: a };
}
function rr(e, t) {
  const n = e.subarray(t.actualByteStart, t.actualByteEnd);
  return t.compressed ? Qn(n) : er(n);
}
function ar(e, t) {
  return t.pcdt.pieceTable.pieces.map((n) => rr(e, n));
}
function He(e, t, n = null) {
  const r = e.pcdt.pieceTable.pieces, a = n ?? !!(t & 1073741824), s = n == null ? t & 1073741823 : t, o = a ? Math.floor(s / 2) : s;
  for (const i of r) {
    if (o < i.actualByteStart || o > i.actualByteEnd)
      continue;
    const l = o - i.actualByteStart, c = i.cpStart + Math.floor(l / (i.compressed ? 1 : 2));
    if (c >= i.cpStart && c <= i.cpEnd)
      return c;
  }
  for (const i of r) {
    if (t < i.actualByteStart || t > i.actualByteEnd)
      continue;
    const l = t - i.actualByteStart, c = i.cpStart + Math.floor(l / (i.compressed ? 1 : 2));
    if (c >= i.cpStart && c <= i.cpEnd)
      return c;
  }
  return null;
}
function or(e, t, n, r, a) {
  if (a <= r)
    return "";
  const s = [];
  for (let o = 0; o < t.pcdt.pieceTable.pieces.length; o += 1) {
    const i = t.pcdt.pieceTable.pieces[o];
    if (i.cpEnd <= r)
      continue;
    if (i.cpStart >= a)
      break;
    const l = Math.max(r, i.cpStart) - i.cpStart, c = Math.min(a, i.cpEnd) - i.cpStart;
    s.push((n[o] ?? "").slice(l, c));
  }
  return s.join("");
}
function sr(e) {
  const t = [];
  let n = 0;
  for (let r = 0; r < e.length; r += 1) {
    const a = e[r];
    (a === "\r" || a === "\x07") && (t.push({ cpStart: n, cpEnd: r + 1, terminator: a }), n = r + 1);
  }
  return n < e.length && t.push({ cpStart: n, cpEnd: e.length, terminator: "" }), t;
}
const U = {
  paragraph: "\r",
  cellMark: "\x07",
  picture: "",
  textBoxPlaceholder: "\b",
  fieldStart: "",
  fieldSeparator: "",
  fieldEnd: "",
  annotationRef: "",
  hardLineBreak: "\v",
  pageBreak: "\f",
  nonBreakingHyphen: "",
  nonRequiredHyphen: ""
}, ir = {
  0: "none",
  1: "single",
  2: "word",
  3: "double",
  4: "dotted",
  5: "hidden",
  6: "thick",
  7: "dash",
  9: "dot-dash",
  10: "dot-dot-dash",
  11: "wave",
  16: "dotted-heavy",
  17: "dashed-heavy",
  18: "dash-long",
  19: "dash-long-heavy",
  20: "dot-dash-heavy",
  21: "dot-dot-dash-heavy",
  22: "wavy-heavy",
  23: "wavy-double"
}, cr = {
  0: "left",
  1: "center",
  2: "right",
  3: "justify",
  4: "distributed"
}, lr = {
  0: "top",
  1: "center",
  2: "bottom"
}, ot = {
  1: "#000000",
  2: "#0000ff",
  3: "#00ffff",
  4: "#00ff00",
  5: "#ff00ff",
  6: "#ff0000",
  7: "#ffff00",
  8: "#ffffff",
  9: "#000080",
  10: "#008080",
  11: "#008000",
  12: "#800080",
  13: "#800000",
  14: "#808000",
  15: "#808080",
  16: "#c0c0c0"
}, ur = [
  "StshfOrig",
  "Stshf",
  "PlcffndRef",
  "PlcffndTxt",
  "PlcfandRef",
  "PlcfandTxt",
  "PlcfSed",
  "PlcPad",
  "PlcfPhe",
  "SttbfGlsy",
  "PlcfGlsy",
  "PlcfHdd",
  "PlcfBteChpx",
  "PlcfBtePapx",
  "PlcfSea",
  "SttbfFfn",
  "PlcfFldMom",
  "PlcfFldHdr",
  "PlcfFldFtn",
  "PlcfFldAtn",
  "PlcfFldMcr",
  "SttbfBkmk",
  "PlcfBkf",
  "PlcfBkl",
  "Cmds",
  "Unused1",
  "SttbfMcr",
  "PrDrvr",
  "PrEnvPort",
  "PrEnvLand",
  "Wss",
  "Dop",
  "SttbfAssoc",
  "Clx",
  "PlcfPgdFtn",
  "AutosaveSource",
  "GrpXstAtnOwners",
  "SttbfAtnBkmk",
  "Unused2",
  "Unused3",
  "PlcSpaMom",
  "PlcSpaHdr",
  "PlcfAtnBkf",
  "PlcfAtnBkl",
  "Pms",
  "FormFldSttbs",
  "PlcfendRef",
  "PlcfendTxt",
  "PlcfFldEdn",
  "Unused4",
  "DggInfo",
  "SttbfRMark",
  "SttbfCaption",
  "SttbfAutoCaption",
  "PlcfWkb",
  "PlcfSpl",
  "PlcftxbxTxt",
  "PlcfFldTxbx",
  "PlcfHdrtxbxTxt",
  "PlcffldHdrTxbx",
  "StwUser",
  "SttbTtmbd",
  "CookieData",
  "PgdMotherOldOld",
  "BkdMotherOldOld",
  "PgdFtnOldOld",
  "BkdFtnOldOld",
  "PgdEdnOldOld",
  "BkdEdnOldOld",
  "SttbfIntlFld",
  "RouteSlip",
  "SttbSavedBy",
  "SttbFnm",
  "PlfLst",
  "PlfLfo",
  "PlcfTxbxBkd",
  "PlcfTxbxHdrBkd",
  "DocUndoWord9",
  "RgbUse",
  "Usp",
  "Uskf",
  "PlcupcRgbUse",
  "PlcupcUsp",
  "SttbGlsyStyle",
  "Plgosl",
  "Plcocx",
  "PlcfBteLvc",
  "dwLowDateTime",
  "dwHighDateTime",
  "PlcfLvcPre10",
  "PlcfAsumy",
  "PlcfGram",
  "SttbListNames",
  "SttbfUssr"
];
function fr(e) {
  const t = new M(e), n = dr(t);
  let r = 32;
  const a = t.u16(r);
  r += 2;
  const s = t.slice(r, a * 2);
  r += a * 2;
  const o = t.u16(r);
  r += 2;
  const i = t.slice(r, o * 4);
  r += o * 4;
  const l = t.u16(r);
  r += 2;
  const c = t.slice(r, l * 8);
  r += l * 8;
  const f = t.ensure(r, 2) ? t.u16(r) : 0;
  t.ensure(r, 2) && (r += 2);
  const u = f ? t.slice(r, f * 2) : new Uint8Array(0), m = pr(i), h = mr(c, l), g = f ? new M(u).u16(0) : 0;
  return {
    base: n,
    csw: a,
    cslw: o,
    cbRgFcLcb: l,
    cswNew: f,
    nFibNew: g,
    fibRgWBytes: s,
    fibRgLwBytes: i,
    fibRgFcLcbBytes: c,
    fibRgCswNewBytes: u,
    fibRgLw: m,
    fibRgFcLcb: h
  };
}
function dr(e) {
  const t = e.u16(0), n = e.u16(2), r = e.u16(6), a = e.u16(8), s = e.u16(10), o = e.u16(18);
  return {
    wIdent: t,
    nFib: n,
    lid: r,
    pnNext: a,
    flags: s,
    envFlags: o,
    fDot: !!(s & 1),
    fGlsy: !!(s & 2),
    fComplex: !!(s & 4),
    fHasPic: !!(s & 8),
    cQuickSaves: s >> 4 & 15,
    fEncrypted: !!(s & 256),
    fWhichTblStm: s & 512 ? 1 : 0,
    fReadOnlyRecommended: !!(s & 1024),
    fWriteReservation: !!(s & 2048),
    fExtChar: !!(s & 4096),
    fLoadOverride: !!(s & 8192),
    fFarEast: !!(s & 16384),
    fObfuscated: !!(s & 32768),
    nFibBack: e.u16(12),
    lKey: e.u32(14),
    envr: e.u8(18),
    fMac: !!(o & 1),
    fEmptySpecial: !!(o & 2),
    fLoadOverridePage: !!(o & 4)
  };
}
function pr(e) {
  const t = new M(e), n = [];
  for (let r = 0; r + 4 <= e.length; r += 4)
    n.push(t.i32(r));
  return {
    raw: n,
    cbMac: n[0] ?? 0,
    ccpText: n[3] ?? 0,
    ccpFtn: n[4] ?? 0,
    ccpHdd: n[5] ?? 0,
    ccpMcr: n[6] ?? 0,
    ccpAtn: n[7] ?? 0,
    ccpEdn: n[8] ?? 0,
    ccpTxbx: n[9] ?? 0,
    ccpHdrTxbx: n[10] ?? 0
  };
}
function mr(e, t) {
  const n = new M(e), r = { _pairs: [] }, a = [];
  for (let s = 0; s < t && s * 8 + 8 <= e.length; s += 1) {
    const o = n.u32(s * 8), i = n.u32(s * 8 + 4), l = ur[s] || `Field${s}`;
    r[`fc${l}`] = o, r[`lcb${l}`] = i, a.push({ name: l, fc: o, lcb: i, index: s });
  }
  return r._pairs = a, r;
}
const d = {
  sprmCPicLocation: 27139,
  sprmCFData: 2054,
  sprmCFOle2: 2058,
  sprmCHighlight: 10764,
  sprmCIstd: 18992,
  sprmCPlain: 10803,
  sprmCFBold: 2101,
  sprmCFItalic: 2102,
  sprmCFStrike: 2103,
  sprmCFOutline: 2104,
  sprmCFShadow: 2105,
  sprmCFSmallCaps: 2106,
  sprmCFCaps: 2107,
  sprmCFVanish: 2108,
  sprmCKul: 10814,
  sprmCDxaSpace: 34880,
  sprmCIco: 10818,
  sprmCHps: 19011,
  sprmCHpsPos: 18501,
  sprmCSymbol: 27145,
  sprmCRgFtc0: 19023,
  sprmCRgFtc1: 19024,
  sprmCRgFtc2: 19025,
  sprmCCharScale: 18514,
  sprmCFDStrike: 10835,
  sprmCFImprint: 2132,
  sprmCFSpec: 2133,
  sprmCFObj: 2134,
  sprmCFEmboss: 2136,
  sprmCFBiDi: 2138,
  sprmCFBoldBi: 2140,
  sprmCFItalicBi: 2141,
  sprmCFtcBi: 19038,
  sprmCIcoBi: 19040,
  sprmCHpsBi: 19041,
  sprmPIstd: 17920,
  sprmPJc80: 9219,
  sprmPFKeep: 9221,
  sprmPFKeepFollow: 9222,
  sprmPFPageBreakBefore: 9223,
  sprmPIlvl: 9738,
  sprmPIlfo: 17931,
  sprmPChgTabsPapx: 50701,
  sprmPDxaRight80: 33806,
  sprmPDxaLeft80: 33807,
  sprmPDxaLeft180: 33809,
  sprmPDyaLine: 25618,
  sprmPDyaBefore: 42003,
  sprmPDyaAfter: 42004,
  sprmPChgTabs: 50709,
  sprmPFInTable: 9238,
  sprmPFTtp: 9239,
  sprmPDxaAbs: 33816,
  sprmPDyaAbs: 33817,
  sprmPDxaWidth: 33818,
  sprmPPc: 9755,
  sprmPWr: 9251,
  sprmPBrcTop80: 25636,
  sprmPBrcLeft80: 25637,
  sprmPBrcBottom80: 25638,
  sprmPBrcRight80: 25639,
  sprmPBrcBetween80: 25640,
  sprmPBrcBar80: 26153,
  sprmPWHeightAbs: 17451,
  sprmPShd80: 17453,
  sprmPDyaFromText: 33838,
  sprmPDxaFromText: 33839,
  sprmPFLocked: 9264,
  sprmPFWidowControl: 9265,
  sprmPFBiDi: 9281,
  sprmPHugePapx: 26182,
  sprmPFAdjustRight: 9288,
  sprmPItap: 26185,
  sprmPDtap: 26186,
  sprmPFInnerTableCell: 9291,
  sprmPFInnerTtp: 9292,
  sprmPShd: 50765,
  sprmPBrcTop: 50766,
  sprmPBrcLeft: 50767,
  sprmPBrcBottom: 50768,
  sprmPBrcRight: 50769,
  sprmPBrcBetween: 50770,
  sprmPBrcBar: 50771,
  sprmPFDyaBeforeAuto: 9307,
  sprmPFDyaAfterAuto: 9308,
  sprmPDxaRight: 33885,
  sprmPDxaLeft: 33886,
  sprmPDxaLeft1: 33888,
  sprmPJc: 9313,
  sprmTJc90: 21504,
  sprmTDxaLeft: 38401,
  sprmTDxaGapHalf: 38402,
  sprmTFCantSplit90: 13315,
  sprmTTableHeader: 13316,
  sprmTTableBorders80: 54789,
  sprmTDyaRowHeight: 37895,
  sprmTDefTable: 54792,
  sprmTDefTableShd80: 54793,
  sprmTFBiDi: 22027,
  sprmTDefTableShd3rd: 54796,
  sprmTPc: 13837,
  sprmTDxaAbs: 37902,
  sprmTDyaAbs: 37903,
  sprmTDxaFromText: 37904,
  sprmTDyaFromText: 37905,
  sprmTDefTableShd: 54802,
  sprmTTableBorders: 54803,
  sprmTTableWidth: 62996,
  sprmTFAutofit: 13845,
  sprmTDefTableShd2nd: 54806,
  sprmTWidthBefore: 62999,
  sprmTWidthAfter: 63e3,
  sprmTSetBrc80: 54816,
  sprmTInsert: 30241,
  sprmTDelete: 22050,
  sprmTDxaCol: 30243,
  sprmTMerge: 22052,
  sprmTSplit: 22053,
  sprmTTextFlow: 30249,
  sprmTVertMerge: 54827,
  sprmTVertAlign: 54828,
  sprmTSetShd: 54829,
  sprmTSetShdOdd: 54830,
  sprmTSetBrc: 54831,
  sprmTCellPadding: 54834,
  sprmTCellSpacingDefault: 54835,
  sprmTCellPaddingDefault: 54836,
  sprmTCellWidth: 54837,
  sprmTFitText: 63030,
  sprmTFCellNoWrap: 54841,
  sprmTIstd: 22074,
  sprmTDefTableShdRaw: 54896,
  sprmTDefTableShdRaw2nd: 54897,
  sprmTDefTableShdRaw3rd: 54898
}, hr = /* @__PURE__ */ new Set([
  d.sprmPChgTabs,
  d.sprmPChgTabsPapx,
  d.sprmTDefTable,
  d.sprmTTableBorders80,
  d.sprmTTableBorders,
  d.sprmTDefTableShd,
  d.sprmTDefTableShd80,
  d.sprmTDefTableShd3rd,
  d.sprmTDefTableShd2nd,
  d.sprmTDefTableShdRaw,
  d.sprmTDefTableShdRaw2nd,
  d.sprmTDefTableShdRaw3rd,
  d.sprmTSetBrc80,
  d.sprmTSetBrc,
  d.sprmTSetShd,
  d.sprmTSetShdOdd,
  d.sprmTCellPadding,
  d.sprmTCellSpacingDefault,
  d.sprmTCellPaddingDefault,
  d.sprmTCellWidth,
  d.sprmTVertAlign,
  d.sprmTVertMerge
]);
function gr(e) {
  return e >> 13 & 7;
}
function A(e, t = 0) {
  return t + 2 > e.length ? 0 : (e[t] ?? 0) | (e[t + 1] ?? 0) << 8;
}
function L(e, t = 0) {
  const n = A(e, t);
  return n > 32767 ? n - 65536 : n;
}
function ie(e, t = 0) {
  return t + 4 > e.length ? 0 : ((e[t] ?? 0) | (e[t + 1] ?? 0) << 8 | (e[t + 2] ?? 0) << 16 | (e[t + 3] ?? 0) << 24 >>> 0) >>> 0;
}
function J(e, t = 0) {
  return {
    first: e[t] ?? 0,
    lim: e[t + 1] ?? 0
  };
}
function K(e, t = 0) {
  if (t + 4 > e.length)
    return null;
  const n = ie(e, t) >>> 0;
  if (n === 4294967295)
    return { raw: n, nil: !0 };
  const r = n & 255, a = n >> 8 & 255, s = n >> 16 & 255, o = n >>> 24 & 255;
  return {
    raw: n,
    lineWidth: r,
    borderType: a,
    color: s,
    space: o & 31,
    shadow: !!(o & 32),
    frame: !!(o & 64)
  };
}
function se(e, t = 0) {
  if (t + 8 > e.length)
    return null;
  const n = ie(e, t) >>> 0, r = ie(e, t + 4) >>> 0;
  return r === 4294967295 ? { raw: r, colorRef: n, nil: !0 } : {
    raw: r,
    colorRef: n,
    lineWidth: r & 255,
    borderType: r >>> 8 & 255,
    space: r >>> 16 & 31,
    shadow: !!(r & 1 << 21),
    frame: !!(r & 1 << 22)
  };
}
function xr(e, t = 0) {
  const n = A(e, t);
  return {
    raw: n,
    horzMerge: n & 3,
    textFlow: n >> 2 & 7,
    vertMerge: n >> 5 & 3,
    vertAlign: n >> 7 & 3,
    ftsWidth: n >> 9 & 7,
    fitText: !!(n & 4096),
    noWrap: !!(n & 8192),
    hideMark: !!(n & 16384)
  };
}
function br(e, t = 0) {
  return t + 20 > e.length ? null : {
    tcgrf: xr(e, t),
    wWidth: A(e, t + 2),
    borders: {
      top: K(e, t + 4) || {},
      left: K(e, t + 8) || {},
      bottom: K(e, t + 12) || {},
      right: K(e, t + 16) || {}
    }
  };
}
function Tr(e, t = 0) {
  if (t + 2 > e.length)
    return null;
  const n = A(e, t), r = n & 31, a = n >>> 5 & 31, s = n >>> 10 & 63;
  return {
    foregroundColorIndex: r,
    backgroundColorIndex: a,
    pattern: s,
    auto: s === 0,
    nil: n === 65535,
    legacy: !0
  };
}
function rn(e, t = 0) {
  if (t + 10 > e.length)
    return null;
  const n = ie(e, t) >>> 0, r = ie(e, t + 4) >>> 0, a = A(e, t + 8);
  return {
    foregroundColorRef: n,
    backgroundColorRef: r,
    pattern: a,
    auto: a === 0,
    nil: a === 65535
  };
}
function wt(e, t) {
  const n = t ? 4 : 8;
  if (!e.length || e.length < 1 + n * 6)
    return null;
  const r = t ? K : se, a = [
    "top",
    "left",
    "bottom",
    "right",
    "horizontalInside",
    "verticalInside"
  ], s = {};
  return a.forEach((o, i) => {
    const l = r(e, 1 + i * n);
    l && (s[o] = l);
  }), s;
}
function Fe(e, t, n) {
  const r = n ? 2 : 10, a = Math.floor(Math.min(e[0] ?? 0, Math.max(0, e.length - 1)) / r), s = [];
  for (let o = 0; o < a; o += 1) {
    const i = n ? Tr(e, 1 + o * r) : rn(e, 1 + o * r);
    i && s.push(i);
  }
  return { start: t, values: s };
}
function Er(e) {
  if (e.length < 3)
    return null;
  const t = A(e, 0), n = e[2] ?? 0;
  let r = 3;
  const a = [];
  for (let o = 0; o < n + 1 && r + 2 <= e.length; o += 1)
    a.push(L(e, r)), r += 2;
  const s = [];
  for (let o = 0; o < n && r + 20 <= e.length; o += 1) {
    const i = br(e, r);
    i && s.push(i), r += 20;
  }
  return { cb: t, numberOfColumns: n, rgdxaCenter: a, cells: s };
}
function yt(e) {
  return e.length ? {
    cb: e[0] ?? 0,
    range: J(e, 1),
    value: e[3] ?? 0,
    extra: e.subarray(4)
  } : null;
}
function wr(e) {
  if (!e.length)
    return null;
  const t = e[0] ?? 0, n = A(e, 4);
  return {
    cb: t,
    range: J(e, 1),
    ftsWidth: e[3] ?? 0,
    width: n,
    wWidth: n
  };
}
function Pt(e) {
  if (e.length < 7)
    return null;
  const t = A(e, 5);
  return {
    cb: e[0] ?? 0,
    range: J(e, 1),
    sides: e[3] ?? 0,
    ftsWidth: e[4] ?? 0,
    width: t,
    wWidth: t
  };
}
function yr(e) {
  return e.length < 8 ? null : {
    cb: e[0] ?? 0,
    range: J(e, 1),
    bordersToApply: e[3] ?? 0,
    border: K(e, 4) || { nil: !0 },
    extra: e.subarray(8)
  };
}
function Pr(e) {
  return e.length < 12 ? null : {
    cb: e[0] ?? 0,
    range: J(e, 1),
    bordersToApply: e[3] ?? 0,
    border: se(e, 4) || { nil: !0 },
    extra: e.subarray(12)
  };
}
function St(e, t = !1) {
  return e.length < 13 ? null : {
    cb: e[0] ?? 0,
    range: J(e, 1),
    shading: rn(e, 3),
    odd: t
  };
}
function Sr(e) {
  return e.length < 3 ? null : { cb: e[0] ?? 0, index: e[1] ?? 0, value: e[2] ?? 0 };
}
function Mr(e) {
  return e.length < 3 ? null : { range: J(e, 0), value: e[2] ?? 0 };
}
function vr(e) {
  if (e.length < 4)
    return null;
  const t = L(e, 2);
  return { range: J(e, 0), width: t, wWidth: t };
}
function Ze(e) {
  if (!e.length)
    return null;
  const t = A(e, 1);
  return {
    ftsWidth: e[0] ?? 0,
    width: t,
    wWidth: t
  };
}
function Rr(e) {
  return e.length < 4 ? null : {
    itcFirst: e[0] ?? 0,
    ctc: e[1] ?? 0,
    dxaCol: A(e, 2)
  };
}
function Br(e, t, n) {
  const r = n >> 13 & 7;
  if (t >= e.length)
    return 0;
  if (n === d.sprmTDefTable) {
    const a = A(e, t);
    return a ? a + 1 : 0;
  }
  if (hr.has(n))
    return (e[t] ?? 0) + 1;
  switch (r) {
    case 0:
      return 1;
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 4;
    case 4:
      return 2;
    case 5:
      return 2;
    case 6:
      return (e[t] ?? 0) + 1;
    case 7:
      return 3;
    default:
      return 0;
  }
}
function B(e) {
  return !!(e[0] ?? 0);
}
function p(e, t, n, r, a) {
  return { kind: e, name: t, value: n, raw: r, operandBytes: a };
}
function Cr(e, t) {
  const n = gr(e), r = t, a = e;
  switch (e) {
    case d.sprmCPicLocation:
      return p("char", "pictureOffset", ie(r, 0) >>> 0, a, r);
    case d.sprmCFData:
      return p("char", "data", B(r), a, r);
    case d.sprmCFOle2:
      return p("char", "ole2", B(r), a, r);
    case d.sprmCIstd:
      return p("char", "charStyleId", A(r, 0), a, r);
    case d.sprmCPlain:
      return p("char", "plain", B(r), a, r);
    case d.sprmCFBold:
      return p("char", "bold", B(r), a, r);
    case d.sprmCFItalic:
      return p("char", "italic", B(r), a, r);
    case d.sprmCFStrike:
      return p("char", "strike", B(r), a, r);
    case d.sprmCFOutline:
      return p("char", "outline", B(r), a, r);
    case d.sprmCFShadow:
      return p("char", "shadow", B(r), a, r);
    case d.sprmCFSmallCaps:
      return p("char", "smallCaps", B(r), a, r);
    case d.sprmCFCaps:
      return p("char", "caps", B(r), a, r);
    case d.sprmCFVanish:
      return p("char", "hidden", B(r), a, r);
    case d.sprmCKul:
      return p("char", "underline", r[0] ?? 0, a, r);
    case d.sprmCDxaSpace:
      return p("char", "spacing", L(r, 0), a, r);
    case d.sprmCIco:
    case d.sprmCIcoBi:
      return p("char", "colorIndex", r[0] ?? 0, a, r);
    case d.sprmCHighlight: {
      const s = r[0] ?? 0, o = { index: s, color: ot[s] };
      return p("char", "highlight", o, a, r);
    }
    case d.sprmCHps:
    case d.sprmCHpsBi:
      return p("char", "fontSizeHalfPoints", A(r, 0), a, r);
    case d.sprmCHpsPos:
      return p("char", "positionHalfPoints", L(r, 0), a, r);
    case d.sprmCSymbol:
      return p("char", "symbol", { font: A(r, 0), charCode: A(r, 2) }, a, r);
    case d.sprmCRgFtc0:
    case d.sprmCRgFtc1:
    case d.sprmCRgFtc2:
    case d.sprmCFtcBi:
      return p("char", "fontFamilyId", A(r, 0), a, r);
    case d.sprmCCharScale:
      return p("char", "scale", A(r, 0), a, r);
    case d.sprmCFDStrike:
      return p("char", "doubleStrike", B(r), a, r);
    case d.sprmCFImprint:
      return p("char", "imprint", B(r), a, r);
    case d.sprmCFSpec:
      return p("char", "special", B(r), a, r);
    case d.sprmCFObj:
      return p("char", "object", B(r), a, r);
    case d.sprmCFEmboss:
      return p("char", "emboss", B(r), a, r);
    case d.sprmCFBiDi:
      return p("char", "rtl", B(r), a, r);
    case d.sprmCFBoldBi:
      return p("char", "boldBi", B(r), a, r);
    case d.sprmCFItalicBi:
      return p("char", "italicBi", B(r), a, r);
    case d.sprmPIstd:
      return p("para", "styleId", A(r, 0), a, r);
    case d.sprmPJc80:
    case d.sprmPJc:
      return p("para", "alignment", r[0] ?? 0, a, r);
    case d.sprmPFKeep:
      return p("para", "keepLines", B(r), a, r);
    case d.sprmPFKeepFollow:
      return p("para", "keepNext", B(r), a, r);
    case d.sprmPFPageBreakBefore:
      return p("para", "pageBreakBefore", B(r), a, r);
    case d.sprmPIlvl:
      return p("para", "listLevel", r[0] ?? 0, a, r);
    case d.sprmPIlfo:
      return p("para", "listId", A(r, 0), a, r);
    case d.sprmPDxaRight80:
    case d.sprmPDxaRight:
      return p("para", "rightIndent", L(r, 0), a, r);
    case d.sprmPDxaLeft80:
    case d.sprmPDxaLeft:
      return p("para", "leftIndent", L(r, 0), a, r);
    case d.sprmPDxaLeft180:
    case d.sprmPDxaLeft1:
      return p("para", "firstLineIndent", L(r, 0), a, r);
    case d.sprmPDyaLine:
      return p("para", "lineSpacing", L(r, 0), a, r);
    case d.sprmPDyaBefore:
      return p("para", "spacingBefore", L(r, 0), a, r);
    case d.sprmPDyaAfter:
      return p("para", "spacingAfter", L(r, 0), a, r);
    case d.sprmPFInTable:
      return p("para", "inTable", B(r), a, r);
    case d.sprmPFTtp:
      return p("para", "tableRowEnd", B(r), a, r);
    case d.sprmPDxaAbs:
      return p("para", "frameLeft", L(r, 0), a, r);
    case d.sprmPDyaAbs:
      return p("para", "frameTop", L(r, 0), a, r);
    case d.sprmPDxaWidth:
      return p("para", "frameWidth", L(r, 0), a, r);
    case d.sprmPPc:
      return p("para", "framePosition", r[0] ?? 0, a, r);
    case d.sprmPWr:
      return p("para", "frameWrap", r[0] ?? 0, a, r);
    case d.sprmPBrcTop80:
      return p("para", "borderTop", K(r, 0), a, r);
    case d.sprmPBrcTop:
      return p("para", "borderTop", se(r, 1), a, r);
    case d.sprmPBrcLeft80:
      return p("para", "borderLeft", K(r, 0), a, r);
    case d.sprmPBrcLeft:
      return p("para", "borderLeft", se(r, 1), a, r);
    case d.sprmPBrcBottom80:
      return p("para", "borderBottom", K(r, 0), a, r);
    case d.sprmPBrcBottom:
      return p("para", "borderBottom", se(r, 1), a, r);
    case d.sprmPBrcRight80:
      return p("para", "borderRight", K(r, 0), a, r);
    case d.sprmPBrcRight:
      return p("para", "borderRight", se(r, 1), a, r);
    case d.sprmPBrcBetween80:
      return p("para", "borderBetween", K(r, 0), a, r);
    case d.sprmPBrcBetween:
      return p("para", "borderBetween", se(r, 1), a, r);
    case d.sprmPBrcBar80:
      return p("para", "borderBar", K(r, 0), a, r);
    case d.sprmPBrcBar:
      return p("para", "borderBar", se(r, 1), a, r);
    case d.sprmPWHeightAbs:
      return p("para", "frameHeight", L(r, 0), a, r);
    case d.sprmPShd80:
    case d.sprmPShd:
      return p("para", "shading", r.slice(), a, r);
    case d.sprmPDyaFromText:
      return p("para", "distanceFromTextY", L(r, 0), a, r);
    case d.sprmPDxaFromText:
      return p("para", "distanceFromTextX", L(r, 0), a, r);
    case d.sprmPFLocked:
      return p("para", "locked", B(r), a, r);
    case d.sprmPFWidowControl:
      return p("para", "widowControl", B(r), a, r);
    case d.sprmPFBiDi:
      return p("para", "rtlPara", B(r), a, r);
    case d.sprmPFAdjustRight:
      return p("para", "adjustRight", B(r), a, r);
    case d.sprmPItap:
      return p("para", "itap", ie(r, 0), a, r);
    case d.sprmPDtap:
      return p("para", "dtap", ie(r, 0), a, r);
    case d.sprmPFInnerTableCell:
      return p("para", "innerTableCell", B(r), a, r);
    case d.sprmPFInnerTtp:
      return p("para", "innerTableRowEnd", B(r), a, r);
    case d.sprmPFDyaBeforeAuto:
      return p("para", "spacingBeforeAuto", B(r), a, r);
    case d.sprmPFDyaAfterAuto:
      return p("para", "spacingAfterAuto", B(r), a, r);
    case d.sprmTJc90:
      return p("table", "alignment", A(r, 0), a, r);
    case d.sprmTDxaLeft:
      return p("table", "leftIndent", L(r, 0), a, r);
    case d.sprmTDxaGapHalf:
      return p("table", "gapHalf", A(r, 0), a, r);
    case d.sprmTFCantSplit90:
      return p("table", "cantSplit", B(r), a, r);
    case d.sprmTTableHeader:
      return p("table", "header", B(r), a, r);
    case d.sprmTDyaRowHeight:
      return p("table", "rowHeight", L(r, 0), a, r);
    case d.sprmTDefTable:
      return p("table", "defTable", Er(r), a, r);
    case d.sprmTTableBorders80:
      return p("table", "tableBorders", wt(r, !0), a, r);
    case d.sprmTTableBorders:
      return p("table", "tableBorders", wt(r, !1), a, r);
    case d.sprmTDefTableShd80:
      return p("table", "defaultShading", Fe(r, 0, !0), a, r);
    case d.sprmTDefTableShd:
    case d.sprmTDefTableShdRaw:
      return p("table", "defaultShading", Fe(r, 0, !1), a, r);
    case d.sprmTDefTableShd2nd:
    case d.sprmTDefTableShdRaw2nd:
      return p("table", "defaultShading", Fe(r, 22, !1), a, r);
    case d.sprmTDefTableShd3rd:
    case d.sprmTDefTableShdRaw3rd:
      return p("table", "defaultShading", Fe(r, 44, !1), a, r);
    case d.sprmTFBiDi:
      return p("table", "rtl", B(r), a, r);
    case d.sprmTPc:
      return p("table", "positionCode", r[0] ?? 0, a, r);
    case d.sprmTDxaAbs:
      return p("table", "absLeft", L(r, 0), a, r);
    case d.sprmTDyaAbs:
      return p("table", "absTop", L(r, 0), a, r);
    case d.sprmTDxaFromText:
      return p("table", "distanceLeft", L(r, 0), a, r);
    case d.sprmTDyaFromText:
      return p("table", "distanceTop", L(r, 0), a, r);
    case d.sprmTTableWidth:
      return p("table", "tableWidth", Ze(r), a, r);
    case d.sprmTFAutofit:
      return p("table", "autoFit", B(r), a, r);
    case d.sprmTWidthBefore:
      return p("table", "widthBefore", Ze(r), a, r);
    case d.sprmTWidthAfter:
      return p("table", "widthAfter", Ze(r), a, r);
    case d.sprmTInsert:
      return p("table", "insertCells", Rr(r), a, r);
    case d.sprmTDelete:
      return p("table", "deleteCells", J(r, 0), a, r);
    case d.sprmTDxaCol:
      return p("table", "columnWidth", vr(r), a, r);
    case d.sprmTMerge:
      return p("table", "merge", J(r, 0), a, r);
    case d.sprmTSplit:
      return p("table", "split", J(r, 0), a, r);
    case d.sprmTTextFlow:
      return p("table", "textFlow", {
        range: J(r, 0),
        value: A(r, 2)
      }, a, r);
    case d.sprmTVertMerge:
      return p("table", "vertMerge", Sr(r), a, r);
    case d.sprmTVertAlign:
      return p("table", "vertAlign", yt(r), a, r);
    case d.sprmTSetShd:
      return p("table", "setShading", St(r), a, r);
    case d.sprmTSetShdOdd:
      return p("table", "setShading", St(r, !0), a, r);
    case d.sprmTSetBrc80:
      return p("table", "setBorder", yr(r), a, r);
    case d.sprmTSetBrc:
      return p("table", "setBorder", Pr(r), a, r);
    case d.sprmTCellPadding:
    case d.sprmTCellPaddingDefault:
      return p("table", "cellPadding", Pt(r), a, r);
    case d.sprmTCellSpacingDefault:
      return p("table", "cellSpacing", Pt(r), a, r);
    case d.sprmTCellWidth:
      return p("table", "cellWidth", wr(r), a, r);
    case d.sprmTFitText:
      return p("table", "fitText", Mr(r), a, r);
    case d.sprmTFCellNoWrap:
      return p("table", "cellNoWrap", yt(r), a, r);
    case d.sprmTIstd:
      return p("table", "styleId", A(r, 0), a, r);
    default:
      return { kind: n === 1 ? "para" : n === 2 ? "char" : n === 5 ? "table" : "unknown", name: `sprm_${e.toString(16)}`, value: r, raw: e, operandBytes: r };
  }
}
function xe(e, t, n) {
  const r = [];
  let a = t;
  for (; a + 2 <= n; ) {
    const s = A(e, a);
    a += 2;
    const o = Br(e, a, s);
    if (!o || a + o > n)
      break;
    const i = e.subarray(a, a + o);
    a += o, r.push(Cr(s, i));
  }
  return r;
}
function Or(e, t = 0) {
  return t + 4 > e.length ? 0 : ((e[t] ?? 0) | (e[t + 1] ?? 0) << 8 | (e[t + 2] ?? 0) << 16 | (e[t + 3] ?? 0) << 24 >>> 0) >>> 0;
}
function an(e, t, n) {
  if (t == null || n == null || n <= 0)
    return { aFC: [], pages: [] };
  const r = e.subarray(t, t + n), a = new M(r), s = Math.floor((n - 4) / 8);
  if (s <= 0)
    return { aFC: [], pages: [] };
  const o = [];
  for (let c = 0; c <= s; c += 1)
    o.push(a.u32(c * 4) >>> 0);
  const i = [], l = (s + 1) * 4;
  for (let c = 0; c < s; c += 1)
    i.push(a.u32(l + c * 4) & 4194303);
  return { aFC: o, pages: i };
}
function Ir(e, t) {
  const n = t * 512, r = e.subarray(n, n + 512);
  if (r.length < 512)
    return null;
  const a = new M(r), s = a.u8(511);
  if (!s || s > 100)
    return null;
  const o = [];
  for (let f = 0; f <= s; f += 1)
    o.push(a.u32(f * 4) >>> 0);
  const i = [], l = [], c = (s + 1) * 4;
  for (let f = 0; f < s; f += 1) {
    const u = a.u8(c + f);
    i.push(u), l.push(u ? n + u * 2 : 0);
  }
  return { crun: s, rgfc: o, rgb: i, chpxOffsets: l };
}
function kr(e, t) {
  const n = t * 512, r = e.subarray(n, n + 512);
  if (r.length < 512)
    return null;
  const a = new M(r), s = a.u8(511);
  if (s > 29)
    return null;
  const o = [];
  for (let f = 0; f <= s; f += 1)
    o.push(a.u32(f * 4) >>> 0);
  const i = (s + 1) * 4, l = [], c = [];
  for (let f = 0; f < s; f += 1) {
    const u = a.u8(i + f * 13);
    l.push(u), c.push(u ? n + u * 2 : 0);
  }
  return { cpara: s, rgfc: o, bOffsets: l, papxOffsets: c };
}
function Ar(e, t, n, r) {
  const a = n.fibRgFcLcb.fcPlcfBteChpx, s = n.fibRgFcLcb.lcbPlcfBteChpx, o = an(t, a, s), i = [];
  for (const l of o.pages) {
    const c = Ir(e, l);
    if (c)
      for (let f = 0; f < c.crun; f += 1) {
        const u = c.rgfc[f] ?? 0, m = c.rgfc[f + 1] ?? u, h = He(r, u), g = He(r, m);
        if (h == null || g == null || g <= h)
          continue;
        const x = c.chpxOffsets[f] ? Fr(e, c.chpxOffsets[f]) : [];
        i.push({ cpStart: h, cpEnd: g, fcStart: u, fcEnd: m, properties: x });
      }
  }
  return i.sort((l, c) => l.cpStart - c.cpStart || l.cpEnd - c.cpEnd), i;
}
function Lr(e, t, n, r, a) {
  const s = n.fibRgFcLcb.fcPlcfBtePapx, o = n.fibRgFcLcb.lcbPlcfBtePapx, i = an(t, s, o), l = [];
  for (const c of i.pages) {
    const f = kr(e, c);
    if (f)
      for (let u = 0; u < f.cpara; u += 1) {
        const m = f.rgfc[u] ?? 0, h = f.rgfc[u + 1] ?? m, g = He(r, m), x = He(r, h);
        if (g == null || x == null || x < g)
          continue;
        const T = f.papxOffsets[u] ? $r(e, f.papxOffsets[u], a) : { styleId: 0, properties: [] };
        l.push({ cpStart: g, cpEnd: x, fcStart: m, fcEnd: h, styleId: T.styleId, properties: T.properties, rawOffset: f.papxOffsets[u] ?? 0 });
      }
  }
  return l.sort((c, f) => c.cpStart - f.cpStart || c.cpEnd - f.cpEnd), l;
}
function Fr(e, t) {
  if (t == null || t < 0 || t >= e.length)
    return [];
  const n = e[t] ?? 0;
  if (!n)
    return [];
  const r = t + 1, a = Math.min(e.length, r + n);
  return xe(e, r, a);
}
function _r(e, t) {
  if (t < 0 || t + 2 > e.length)
    return [];
  const n = (e[t] ?? 0) | (e[t + 1] ?? 0) << 8;
  return !n || t + 2 + n > e.length ? [] : xe(e, t + 2, t + 2 + n);
}
function Dr(e, t) {
  if (!t?.length)
    return e;
  const n = [];
  for (const r of e) {
    if (r.raw !== d.sprmPHugePapx) {
      n.push(r);
      continue;
    }
    const a = r.operandBytes || (r.value instanceof Uint8Array ? r.value : null);
    if (!a || a.length < 4) {
      n.push(r);
      continue;
    }
    const s = Or(a), o = _r(t, s);
    n.push(...o.length ? o : [r]);
  }
  return n;
}
function $r(e, t, n) {
  if (t == null || t < 0 || t >= e.length)
    return { styleId: 0, properties: [] };
  const r = new M(e), a = r.u8(t);
  if (a === 0 && !r.ensure(t + 1, 1))
    return { styleId: 0, properties: [] };
  let s, o;
  if (a === 0 ? (o = r.u8(t + 1) * 2, s = t + 2) : (o = a - 1, s = t + 1), o < 2 || !r.ensure(s, Math.max(2, o)))
    return { styleId: 0, properties: [] };
  const i = r.u16(s), l = s + 2, c = Math.min(e.length, s + o), f = Dr(xe(e, l, c), n);
  return { styleId: i, properties: f };
}
function Nr(e, t) {
  let n = t;
  for (; n + 1 < e.length && !(e[n] === 0 && e[n + 1] === 0); )
    n += 2;
  return { value: new TextDecoder("utf-16le").decode(e.subarray(t, n)), nextOffset: Math.min(e.length, n + 2) };
}
function Wr(e, t) {
  if (!e.length)
    return null;
  const n = new M(e), r = n.u8(0), a = n.u8(1), s = n.u16(2), o = n.u8(4), i = n.u8(5), l = n.slice(6, 10), c = n.slice(16, 24), f = 40;
  let u = "", m = "";
  if (e.length > f) {
    const g = new TextDecoder("utf-16le").decode(e.subarray(f)).split("\0").filter(Boolean);
    if (u = g[0] || "", m = g[1] || "", !m && i) {
      const x = f + i * 2;
      x + 2 <= e.length && (m = Nr(e, x).value);
    }
  }
  return {
    index: t,
    cbFfnM1: r,
    ffid: a,
    weight: s,
    charset: o,
    ixchSzAlt: i,
    panose: l,
    fontSignature: c,
    name: u,
    altName: m
  };
}
function Hr(e, t) {
  const n = t.fcSttbfFfn, r = t.lcbSttbfFfn;
  if (n == null || r == null || r <= 0)
    return {
      header: null,
      fonts: [],
      byIndex(f) {
        return f == null, null;
      }
    };
  const a = e.subarray(n, n + r), s = new M(a), o = s.u16(0), i = s.u16(2);
  let l = 4;
  const c = [];
  for (let f = 0; f < o && l < a.length; f += 1) {
    const m = s.u8(l) + 1, h = a.subarray(l, Math.min(l + m, a.length)), g = Wr(h, f);
    g && c.push(g), l += m + i;
  }
  return {
    header: { cData: o, cbExtra: i },
    fonts: c,
    byIndex(f) {
      return f == null || f < 0 ? null : c[f] || null;
    }
  };
}
function Ne(e) {
  const t = {
    bold: !1,
    italic: !1,
    strike: !1,
    underline: 0,
    fontSizeHalfPoints: void 0,
    fontFamilyId: void 0,
    colorIndex: void 0,
    highlight: void 0,
    spacing: 0,
    positionHalfPoints: 0,
    scale: 100,
    hidden: !1,
    smallCaps: !1,
    caps: !1,
    outline: !1,
    shadow: !1,
    emboss: !1,
    imprint: !1,
    rtl: !1,
    pictureOffset: void 0,
    data: !1,
    ole2: !1,
    object: !1,
    special: !1,
    charStyleId: void 0
  };
  for (const n of e || [])
    switch (n.name) {
      case "plain":
        n.value && (t.bold = !1, t.italic = !1, t.strike = !1, t.underline = 0, t.smallCaps = !1, t.caps = !1);
        break;
      case "bold":
      case "italic":
      case "strike":
      case "hidden":
      case "smallCaps":
      case "caps":
      case "outline":
      case "shadow":
      case "emboss":
      case "imprint":
      case "rtl":
      case "data":
      case "ole2":
      case "object":
      case "special":
        t[n.name] = !!n.value;
        break;
      case "underline":
        t.underline = n.value ?? 0;
        break;
      case "fontSizeHalfPoints":
        t.fontSizeHalfPoints = n.value;
        break;
      case "fontFamilyId":
        t.fontFamilyId = n.value;
        break;
      case "colorIndex":
        t.colorIndex = n.value;
        break;
      case "highlight":
        t.highlight = n.value;
        break;
      case "spacing":
        t.spacing = n.value || 0;
        break;
      case "positionHalfPoints":
        t.positionHalfPoints = n.value || 0;
        break;
      case "scale":
        t.scale = n.value || 100;
        break;
      case "pictureOffset":
        t.pictureOffset = n.value;
        break;
      case "charStyleId":
        t.charStyleId = n.value;
        break;
      default:
        t[n.name] = n.value;
        break;
    }
  return t;
}
function on(e) {
  const t = {
    styleId: 0,
    alignment: 0,
    spacingBefore: 0,
    spacingAfter: 0,
    lineSpacing: 0,
    leftIndent: 0,
    rightIndent: 0,
    firstLineIndent: 0,
    keepLines: !1,
    keepNext: !1,
    pageBreakBefore: !1,
    widowControl: !1,
    inTable: !1,
    tableRowEnd: !1,
    innerTableCell: !1,
    innerTableRowEnd: !1,
    itap: 0,
    dtap: 0,
    listLevel: void 0,
    listId: void 0,
    rtlPara: !1,
    adjustRight: !1,
    frameLeft: void 0,
    frameTop: void 0,
    frameWidth: void 0,
    frameHeight: void 0,
    framePosition: void 0,
    frameWrap: void 0,
    borders: {},
    shading: void 0
  };
  for (const n of e || [])
    switch (n.name) {
      case "styleId":
        t.styleId = n.value || 0;
        break;
      case "alignment":
        t.alignment = n.value ?? 0;
        break;
      case "spacingBefore":
        t.spacingBefore = n.value || 0;
        break;
      case "spacingAfter":
        t.spacingAfter = n.value || 0;
        break;
      case "lineSpacing":
        t.lineSpacing = n.value || 0;
        break;
      case "leftIndent":
        t.leftIndent = n.value || 0;
        break;
      case "rightIndent":
        t.rightIndent = n.value || 0;
        break;
      case "firstLineIndent":
        t.firstLineIndent = n.value || 0;
        break;
      case "keepLines":
      case "keepNext":
      case "pageBreakBefore":
      case "widowControl":
      case "inTable":
      case "tableRowEnd":
      case "innerTableCell":
      case "innerTableRowEnd":
      case "rtlPara":
      case "adjustRight":
        t[n.name] = !!n.value;
        break;
      case "itap":
        t.itap = n.value || 0;
        break;
      case "dtap":
        t.dtap = n.value || 0;
        break;
      case "listLevel":
        t.listLevel = n.value;
        break;
      case "listId":
        t.listId = n.value;
        break;
      case "frameLeft":
        t.frameLeft = n.value;
        break;
      case "frameTop":
        t.frameTop = n.value;
        break;
      case "frameWidth":
        t.frameWidth = n.value;
        break;
      case "frameHeight":
        t.frameHeight = n.value;
        break;
      case "framePosition":
        t.framePosition = n.value;
        break;
      case "frameWrap":
        t.frameWrap = n.value;
        break;
      case "borderTop":
        t.borders.top = n.value;
        break;
      case "borderLeft":
        t.borders.left = n.value;
        break;
      case "borderBottom":
        t.borders.bottom = n.value;
        break;
      case "borderRight":
        t.borders.right = n.value;
        break;
      case "borderBetween":
        t.borders.between = n.value;
        break;
      case "borderBar":
        t.borders.bar = n.value;
        break;
      case "shading":
        t.shading = n.value;
        break;
      default:
        t[n.name] = n.value;
        break;
    }
  return t;
}
function Ue(e) {
  const t = {
    styleId: void 0,
    alignment: 0,
    leftIndent: 0,
    gapHalf: 0,
    cantSplit: !1,
    header: !1,
    rowHeight: 0,
    rtl: !1,
    positionCode: void 0,
    absLeft: void 0,
    absTop: void 0,
    distanceLeft: void 0,
    distanceTop: void 0,
    tableWidth: void 0,
    autoFit: void 0,
    widthBefore: void 0,
    widthAfter: void 0,
    borders: {},
    defTable: void 0,
    operations: []
  };
  for (const n of e || [])
    switch (n.name) {
      case "styleId":
        t.styleId = n.value;
        break;
      case "alignment":
        t.alignment = n.value ?? 0;
        break;
      case "leftIndent":
        t.leftIndent = n.value || 0;
        break;
      case "gapHalf":
        t.gapHalf = n.value || 0;
        break;
      case "cantSplit":
      case "header":
      case "rtl":
        t[n.name] = !!n.value;
        break;
      case "rowHeight":
        t.rowHeight = n.value || 0;
        break;
      case "positionCode":
        t.positionCode = n.value;
        break;
      case "absLeft":
        t.absLeft = n.value;
        break;
      case "absTop":
        t.absTop = n.value;
        break;
      case "distanceLeft":
        t.distanceLeft = n.value;
        break;
      case "distanceTop":
        t.distanceTop = n.value;
        break;
      case "tableWidth":
        t.tableWidth = n.value;
        break;
      case "autoFit":
        t.autoFit = n.value;
        break;
      case "widthBefore":
        t.widthBefore = n.value;
        break;
      case "widthAfter":
        t.widthAfter = n.value;
        break;
      case "tableBorders":
        t.borders = n.value || {};
        break;
      case "defTable":
        t.defTable = n.value;
        break;
      default:
        t.operations.push(n);
        break;
    }
  return t;
}
function st(e) {
  return e?.inTable ? Math.max(1, e.itap || 0 || (e.dtap ? e.dtap : 1)) : 0;
}
function Ur(e) {
  return cr[e] || "left";
}
function zr(e) {
  return ir[e] || (e ? "single" : "none");
}
function jr(e) {
  return lr[e] || "top";
}
function Q(e, t, n) {
  if (!t)
    return;
  const r = Math.max(0, t.first || 0), a = Math.max(r, t.lim || r);
  for (let s = r; s < a && s < e.length; s += 1)
    n(e[s], s);
}
function pt(e) {
  const t = e?.defTable, n = (t?.cells || []).map((s, o) => ({
    index: o,
    width: t?.rgdxaCenter?.[o + 1] != null && t?.rgdxaCenter?.[o] != null ? Math.max(0, t.rgdxaCenter[o + 1] - t.rgdxaCenter[o]) : s?.wWidth,
    ftsWidth: s?.tcgrf?.ftsWidth,
    borders: s?.borders || {},
    merge: s?.tcgrf?.horzMerge || 0,
    vertMerge: s?.tcgrf?.vertMerge || 0,
    vertAlign: s?.tcgrf?.vertAlign || 0,
    fitText: !!s?.tcgrf?.fitText,
    noWrap: !!s?.tcgrf?.noWrap,
    hideMark: !!s?.tcgrf?.hideMark,
    textFlow: s?.tcgrf?.textFlow || 0,
    rightBoundary: t?.rgdxaCenter?.[o + 1],
    leftBoundary: t?.rgdxaCenter?.[o]
  }));
  let r = !1;
  const a = n[0]?.leftBoundary || 0;
  for (const s of e.operations || [])
    switch (s.name) {
      case "insertCells": {
        if (t?.cells?.length)
          break;
        const o = s.value, i = Math.min(n.length, Math.max(0, o?.itcFirst || 0)), l = Math.min(63 - n.length, Math.max(0, o?.ctc || 0)), c = Math.max(0, o?.dxaCol || 0);
        l && (n.splice(i, 0, ...Array.from({ length: l }, (f, u) => ({
          index: i + u,
          width: c,
          borders: {},
          merge: 0,
          vertMerge: 0,
          vertAlign: 0,
          fitText: !1,
          noWrap: !1,
          hideMark: !1,
          textFlow: 0
        }))), r = !0);
        break;
      }
      case "deleteCells": {
        const o = s.value;
        if (o) {
          const i = Math.max(0, o.first || 0), l = Math.max(0, (o.lim || i) - i);
          l && (n.splice(i, l), r = !0);
        }
        break;
      }
      case "merge":
        Q(n, s.value, (o, i) => {
          const l = s.value;
          i === l.first ? o.merge = 2 : o.merge = 1;
        });
        break;
      case "split":
        Q(n, s.value, (o) => {
          o.merge = 0;
        });
        break;
      case "cellWidth":
        Q(n, s.value.range, (o) => {
          const i = s.value;
          o.ftsWidth = i.ftsWidth, (i.ftsWidth === 2 || i.ftsWidth === 3) && i.width != null && (o.width = i.width);
        });
        break;
      case "columnWidth":
        Q(n, s.value.range, (o) => {
          o.width = Math.max(0, s.value.width || 0), r = !0;
        });
        break;
      case "vertMerge": {
        const o = s.value, i = o?.index != null ? n[o.index] : void 0;
        i && (i.vertMerge = o?.value || 0);
        break;
      }
      case "vertAlign":
        Q(n, s.value.range, (o) => {
          o.vertAlign = s.value.value;
        });
        break;
      case "setBorder":
        Q(n, s.value.range, (o) => {
          const i = s.value, l = { ...o.borders || {} };
          i.bordersToApply & 1 && (l.top = i.border), i.bordersToApply & 2 && (l.left = i.border), i.bordersToApply & 4 && (l.bottom = i.border), i.bordersToApply & 8 && (l.right = i.border), i.bordersToApply & 16 && (l.diagonalDown = i.border), i.bordersToApply & 32 && (l.diagonalUp = i.border), o.borders = l;
        });
        break;
      case "setShading":
        Q(n, s.value.range, (o, i) => {
          const l = s.value;
          (!l.odd || (i - l.range.first) % 2 === 0) && (o.shading = l.shading);
        });
        break;
      case "cellPadding":
      case "cellSpacing": {
        const o = s.value, i = o?.ftsWidth === 3 || s.name === "cellSpacing" && o?.ftsWidth === 19;
        if (!o?.range || !i || o.width == null)
          break;
        Q(n, o.range, (l) => {
          const c = s.name === "cellPadding" ? "paddingTwips" : "spacingTwips", f = { ...l[c] || {} };
          (o.sides || 0) & 1 && (f.top = o.width), (o.sides || 0) & 2 && (f.left = o.width), (o.sides || 0) & 4 && (f.bottom = o.width), (o.sides || 0) & 8 && (f.right = o.width), l[c] = f;
        });
        break;
      }
      case "defaultShading": {
        const o = s.value;
        (o?.values || []).forEach((i, l) => {
          const c = n[(o?.start || 0) + l];
          c && (c.shading = i);
        });
        break;
      }
      case "fitText":
        Q(n, s.value.range, (o) => {
          o.fitText = !!s.value.value;
        });
        break;
      case "cellNoWrap":
        Q(n, s.value.range, (o) => {
          o.noWrap = !!s.value.value;
        });
        break;
      case "textFlow":
        Q(n, s.value.range, (o) => {
          o.textFlow = s.value.value;
        });
        break;
    }
  if (r) {
    let s = a;
    n.forEach((o) => {
      const i = Math.max(0, o.width || 0);
      o.leftBoundary = s, s += i, o.rightBoundary = s;
    });
  }
  return n.forEach((s, o) => {
    s.index = o;
  }), n;
}
const Yr = /^(?:<!doctype\s+html\b|<html\b|<body\b)/i, Gr = /<(div|p|h[1-6]|li|pre|blockquote|tr)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi, sn = /<(script|style|noscript|iframe|object|embed|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
function cn(e, t = 1024) {
  return Array.from(e.subarray(0, Math.min(t, e.length)), (n) => n === 0 ? "" : String.fromCharCode(n)).join("");
}
function Xr(e) {
  const t = cn(e).replace(/^\uFEFF/, "").trimStart();
  return Yr.test(t);
}
function _e(e, t, n = !1) {
  try {
    return new TextDecoder(t, { fatal: n }).decode(e);
  } catch {
    return null;
  }
}
function Vr(e) {
  let t = e.length;
  for (; t > 0 && e[t - 1] === 0; )
    t -= 1;
  const n = e.subarray(0, t), r = cn(n, 4096), a = /charset\s*=\s*["']?([a-z0-9._-]+)/i.exec(r)?.[1]?.toLowerCase(), s = a === "gb2312" || a === "gbk" ? "gb18030" : a;
  if (s) {
    const i = _e(n, s);
    if (i != null)
      return i;
  }
  const o = _e(n, "utf-8", !0);
  return o ?? _e(n, "gb18030") ?? _e(n, "utf-8") ?? "";
}
function Kr(e) {
  const t = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return e.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (n, r) => {
    if (r[0] === "#") {
      const a = r[1]?.toLowerCase() === "x", s = Number.parseInt(r.slice(a ? 2 : 1), a ? 16 : 10);
      if (Number.isFinite(s) && s >= 0 && s <= 1114111)
        try {
          return String.fromCodePoint(s);
        } catch {
          return n;
        }
      return n;
    }
    return t[r.toLowerCase()] ?? n;
  });
}
function Mt(e) {
  return Kr(e.replace(sn, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<br\s*\/?>/gi, `
`).replace(/<\/(?:div|p|h[1-6]|li|pre|blockquote|tr|table)>/gi, `
`).replace(/<\/?(?:td|th)\b[^>]*>/gi, "	").replace(/<[^>]+>/g, "").replace(/\u0000/g, "")).replace(/\r\n?/g, `
`).replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, `
`).trim();
}
function Zr(e) {
  const t = e.replace(sn, "").replace(/<!--[\s\S]*?-->/g, ""), n = [];
  for (const a of t.matchAll(Gr)) {
    const s = a[3] || "", o = Mt(s);
    o && n.push({ text: o, attributes: a[2] || "", content: s });
  }
  if (n.length)
    return n;
  const r = Mt(t);
  return r ? [{ text: r, attributes: "", content: t }] : [];
}
function Jr(e) {
  return /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(e)?.[2] || "";
}
function qr(e, t) {
  const n = on([]), r = Ne([]), a = Jr(e.attributes), s = /text-align\s*:\s*(center|right|justify)/i.exec(a)?.[1]?.toLowerCase();
  s === "center" && (n.alignment = 1), s === "right" && (n.alignment = 2), s === "justify" && (n.alignment = 3);
  const o = Number.parseFloat(/text-indent\s*:\s*([\d.]+)pt/i.exec(a)?.[1] || "");
  Number.isFinite(o) && (n.firstLineIndent = Math.round(o * 20));
  const i = Number.parseFloat(/font-size\s*:\s*([\d.]+)pt/i.exec(a)?.[1] || "");
  Number.isFinite(i) && (r.fontSizeHalfPoints = Math.round(Math.min(96, Math.max(8, i)) * 2)), (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(a) || /<(?:b|strong)\b/i.test(e.content)) && (r.bold = !0), (/font-style\s*:\s*italic/i.test(a) || /<(?:i|em)\b/i.test(e.content)) && (r.italic = !0);
  const l = e.text.split(`
`).flatMap((c, f) => [
    ...f ? [{ type: "lineBreak" }] : [],
    ...c ? [{ type: "text", text: c, style: { ...r } }] : []
  ]);
  return {
    type: "paragraph",
    id: `html-word-paragraph-${t + 1}`,
    styleId: 0,
    styleName: "Normal",
    paraState: n,
    inlines: l,
    text: e.text
  };
}
function Qr(e) {
  if (!Xr(e))
    return null;
  const t = Zr(Vr(e));
  if (!t.length)
    return null;
  const n = t.map(qr), r = t.reduce((a, s) => a + s.text.length, 0);
  return {
    kind: "msdoc",
    version: 1,
    warnings: [
      {
        message: "Recovered an HTML document stored inside the legacy WordDocument stream.",
        code: "MSDOC_HTML_WORDDOCUMENT_RECOVERED"
      }
    ],
    meta: {
      fib: {
        wIdent: 0,
        nFib: 0,
        fWhichTblStm: 0,
        fComplex: !1,
        fEncrypted: !1,
        ccpText: r
      },
      counts: {
        paragraphs: n.length,
        blocks: n.length,
        assets: 0,
        styles: 0,
        fonts: 0
      }
    },
    fonts: [],
    styles: [],
    blocks: n,
    assets: []
  };
}
class V extends Error {
  name = "InflateError";
}
class ea {
  bytes;
  byteOffset = 0;
  bitBuffer = 0;
  bitCount = 0;
  constructor(t) {
    this.bytes = t;
  }
  readBits(t) {
    if (t < 0 || t > 24)
      throw new V("Invalid bit count");
    for (; this.bitCount < t; ) {
      if (this.byteOffset >= this.bytes.length)
        throw new V("Unexpected end of deflate stream");
      this.bitBuffer |= (this.bytes[this.byteOffset++] ?? 0) << this.bitCount, this.bitCount += 8;
    }
    const n = t === 0 ? 0 : (1 << t) - 1, r = this.bitBuffer & n;
    return this.bitBuffer >>>= t, this.bitCount -= t, r;
  }
  readBit() {
    return this.readBits(1);
  }
  alignToByte() {
    this.bitBuffer = 0, this.bitCount = 0;
  }
  readByte() {
    return this.readBits(8);
  }
}
class ta {
  buffer;
  length = 0;
  constructor(t = 32768) {
    this.buffer = new Uint8Array(t);
  }
  reserve(t) {
    const n = this.length + t;
    if (n <= this.buffer.length)
      return;
    let r = this.buffer.length;
    for (; r < n; )
      r *= 2;
    const a = new Uint8Array(r);
    a.set(this.buffer.subarray(0, this.length)), this.buffer = a;
  }
  push(t) {
    this.reserve(1), this.buffer[this.length++] = t & 255;
  }
  pushBytes(t) {
    this.reserve(t.length), this.buffer.set(t, this.length), this.length += t.length;
  }
  copyFromBack(t, n) {
    if (t <= 0 || t > this.length)
      throw new V("Invalid back-reference distance");
    this.reserve(n);
    for (let r = 0; r < n; r += 1)
      this.buffer[this.length] = this.buffer[this.length - t] ?? 0, this.length += 1;
  }
  toUint8Array(t) {
    const n = this.buffer.slice(0, this.length);
    return t != null && t >= 0 && n.length !== t, n;
  }
}
function Se(e) {
  const t = Math.max(0, ...e);
  if (t === 0)
    throw new V("Empty Huffman table");
  const n = new Array(t + 1).fill(0);
  for (const o of e) {
    if (o < 0 || o > t)
      throw new V("Invalid code length");
    o && (n[o] += 1);
  }
  const r = new Array(t + 1).fill(0);
  let a = 0;
  for (let o = 1; o <= t; o += 1)
    a = a + (n[o - 1] ?? 0) << 1, r[o] = a;
  const s = Array.from({ length: t + 1 }, () => /* @__PURE__ */ new Map());
  for (let o = 0; o < e.length; o += 1) {
    const i = e[o] ?? 0;
    if (!i)
      continue;
    const l = r[i] ?? 0;
    r[i] = l + 1, s[i].set(l, o);
  }
  return { maps: s, maxBits: t };
}
function it(e, t) {
  let n = 0;
  for (let r = 1; r <= t.maxBits; r += 1) {
    n = n << 1 | e.readBit();
    const a = t.maps[r]?.get(n);
    if (a != null)
      return a;
  }
  throw new V("Invalid Huffman code");
}
const na = [
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258
], ra = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0
], vt = [
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577
], aa = [
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13
];
let Je = null, Rt = null;
function oa() {
  if (!Je) {
    const e = new Array(288).fill(0);
    for (let t = 0; t <= 143; t += 1)
      e[t] = 8;
    for (let t = 144; t <= 255; t += 1)
      e[t] = 9;
    for (let t = 256; t <= 279; t += 1)
      e[t] = 7;
    for (let t = 280; t <= 287; t += 1)
      e[t] = 8;
    Je = Se(e), Rt = Se(new Array(32).fill(5));
  }
  return { literalLength: Je, distance: Rt };
}
const sa = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function ia(e) {
  const t = e.readBits(5) + 257, n = e.readBits(5) + 1, r = e.readBits(4) + 4, a = new Array(19).fill(0);
  for (let c = 0; c < r; c += 1)
    a[sa[c]] = e.readBits(3);
  const s = Se(a), o = [];
  for (; o.length < t + n; ) {
    const c = it(e, s);
    if (c <= 15)
      o.push(c);
    else if (c === 16) {
      if (!o.length)
        throw new V("Repeat code length without previous value");
      const f = e.readBits(2) + 3, u = o[o.length - 1] ?? 0;
      for (let m = 0; m < f; m += 1)
        o.push(u);
    } else if (c === 17) {
      const f = e.readBits(3) + 3;
      for (let u = 0; u < f; u += 1)
        o.push(0);
    } else if (c === 18) {
      const f = e.readBits(7) + 11;
      for (let u = 0; u < f; u += 1)
        o.push(0);
    } else
      throw new V("Invalid code length symbol");
  }
  const i = o.slice(0, t), l = o.slice(t, t + n);
  if (!i[256])
    throw new V("Missing end-of-block code");
  return l.some(Boolean) || (l[0] = 1), {
    literalLength: Se(i),
    distance: Se(l)
  };
}
function Bt(e, t, n, r) {
  for (; ; ) {
    const a = it(e, n);
    if (a < 256) {
      t.push(a);
      continue;
    }
    if (a === 256)
      return;
    if (a < 257 || a > 285)
      throw new V("Invalid length symbol");
    const s = a - 257;
    let o = na[s] ?? 0;
    const i = ra[s] ?? 0;
    i && (o += e.readBits(i));
    const l = it(e, r);
    if (l < 0 || l >= vt.length)
      throw new V("Invalid distance symbol");
    let c = vt[l] ?? 0;
    const f = aa[l] ?? 0;
    f && (c += e.readBits(f)), t.copyFromBack(c, o);
  }
}
function ca(e, t) {
  const n = new ea(e), r = new ta(t && t > 0 ? t : void 0);
  let a = !1;
  for (; !a; ) {
    a = n.readBit() === 1;
    const s = n.readBits(2);
    if (s === 0) {
      n.alignToByte();
      const o = n.readByte() | n.readByte() << 8, i = n.readByte() | n.readByte() << 8;
      if (((o ^ 65535) & 65535) !== i)
        throw new V("Invalid stored block length");
      const l = new Uint8Array(o);
      for (let c = 0; c < o; c += 1)
        l[c] = n.readByte();
      r.pushBytes(l);
    } else if (s === 1) {
      const o = oa();
      Bt(n, r, o.literalLength, o.distance);
    } else if (s === 2) {
      const o = ia(n);
      Bt(n, r, o.literalLength, o.distance);
    } else
      throw new V("Reserved deflate block type");
  }
  return r.toUint8Array(t);
}
function la(e) {
  let t = 1, n = 0;
  for (const r of e)
    t = (t + r) % 65521, n = (n + t) % 65521;
  return (n << 16 | t) >>> 0;
}
function ua(e, t) {
  if (e.length < 6)
    return null;
  const n = e[0] ?? 0, r = e[1] ?? 0;
  if ((n & 15) !== 8 || n >>> 4 > 7 || ((n << 8) + r) % 31 !== 0 || r & 32)
    return null;
  try {
    const a = e.subarray(2, Math.max(2, e.length - 4)), s = ca(a, t), o = (e[e.length - 4] ?? 0) << 24 | (e[e.length - 3] ?? 0) << 16 | (e[e.length - 2] ?? 0) << 8 | (e[e.length - 1] ?? 0);
    return o >>> 0 && la(s) !== o >>> 0 ? null : s;
  } catch {
    return null;
  }
}
const ln = 15, fa = 61444, da = 61450, pa = 61451, ma = 61729, ha = 61730, ga = 260, xa = 390, ba = 261, Ta = 896, Ea = 897;
function wa(e, t) {
  return t + 2 > e.length ? 0 : (e[t] ?? 0) | (e[t + 1] ?? 0) << 8;
}
function un(e, t) {
  return t + 4 > e.length ? 0 : ((e[t] ?? 0) | (e[t + 1] ?? 0) << 8 | (e[t + 2] ?? 0) << 16 | (e[t + 3] ?? 0) << 24 >>> 0) >>> 0;
}
function ya(e) {
  if (e?.length)
    try {
      return new TextDecoder("utf-16le").decode(e).replace(/\0+$/g, "").trim() || void 0;
    } catch {
      return;
    }
}
function Pa(e) {
  if (e?.length)
    try {
      return new TextDecoder("windows-1252").decode(e).replace(/\0+$/g, "").trim() || void 0;
    } catch {
      return;
    }
}
function Ct(e) {
  return ya(e) || Pa(e);
}
function Sa(e) {
  switch (e) {
    case 2:
      return "image/emf";
    case 3:
      return "image/wmf";
    case 4:
      return "image/pict";
    case 5:
      return "image/jpeg";
    case 6:
      return "image/png";
    case 7:
      return "image/dib";
    case 17:
      return "image/tiff";
    case 18:
      return "image/jpeg";
    default:
      return null;
  }
}
function fn(e, t) {
  if (t < 0 || t + 8 > e.length)
    return null;
  const n = new M(e), r = n.u16(t), a = n.u16(t + 2), s = n.u32(t + 4), o = 8 + s;
  return a < 61440 || a > 65535 || s > e.length || t + o > e.length ? null : {
    recVer: r & 15,
    recInstance: r >>> 4,
    recType: a,
    recLen: s,
    size: o
  };
}
function Ma(e, t, n) {
  const r = t + 8;
  if (r + n * 6 > e.length)
    return [];
  const a = [];
  let s = r, o = r + n * 6;
  for (let i = 0; i < n; i += 1) {
    const l = wa(e, s), c = un(e, s + 2);
    s += 6;
    const f = l & 16383, u = !!(l >> 14 & 1), m = !!(l >> 15 & 1);
    let h;
    if (m) {
      if (o + c > e.length)
        break;
      h = e.subarray(o, o + c), o += c;
    }
    a.push({ propertyId: f, isBlipId: u, isComplex: m, value: c, complexData: h });
  }
  return a;
}
function dn(e, t, n, r) {
  let a = Math.max(0, t);
  const s = Math.min(n, e.length);
  for (; a + 8 <= s; ) {
    const o = fn(e, a);
    if (!o || a + o.size > s) {
      a += 1;
      continue;
    }
    if (r(a, o) === !0 || o.recVer === ln && dn(e, a + 8, a + o.size, r))
      return !0;
    a += o.size;
  }
  return !1;
}
function va(e, t = 0) {
  let n = null;
  return dn(e, t, e.length, (r, a) => {
    if (a.recType !== fa || a.recVer !== ln)
      return !1;
    const s = r + a.size;
    let o = r + 8, i = 0, l, c, f;
    for (; o + 8 <= s; ) {
      const u = fn(e, o);
      if (!u || o + u.size > s)
        break;
      if (u.recType === da && u.recLen >= 8)
        i = un(e, o + 8);
      else if (u.recType === pa || u.recType === ma || u.recType === ha) {
        const m = Ma(e, o, u.recInstance);
        for (const h of m)
          (h.isBlipId || h.propertyId === ga || h.propertyId === xa) && h.value > 0 ? l = h.value : h.propertyId === Ta ? c = Ct(h.complexData) || c : (h.propertyId === Ea || h.propertyId === ba) && (f = Ct(h.complexData) || f);
      }
      o += u.size;
    }
    return i ? (n = { shapeId: i, blipIndex: l, name: c, description: f }, !0) : !1;
  }), n;
}
const Ra = { color: "#000000", width: 1 }, Ba = { color: "#ffffff", none: !0 }, Ca = { family: "sans-serif", size: 12 }, pn = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 }, Oa = 2596720087, Ia = 18, k = {
  META_EOF: 0,
  META_SETBKMODE: 258,
  META_SETPOLYFILLMODE: 262,
  META_SETBKCOLOR: 513,
  META_SETTEXTCOLOR: 521,
  META_SETWINDOWORG: 523,
  META_SETWINDOWEXT: 524,
  META_SETVIEWPORTORG: 525,
  META_SETVIEWPORTEXT: 526,
  META_OFFSETWINDOWORG: 527,
  META_OFFSETVIEWPORTORG: 529,
  META_LINETO: 531,
  META_MOVETO: 532,
  META_POLYGON: 804,
  META_POLYLINE: 805,
  META_TEXTOUT: 1313,
  META_POLYPOLYGON: 1336,
  META_ELLIPSE: 1048,
  META_RECTANGLE: 1051,
  META_ROUNDRECT: 1564,
  META_CREATEBRUSHINDIRECT: 764,
  META_CREATEPENINDIRECT: 762,
  META_CREATEFONTINDIRECT: 763,
  META_SELECTOBJECT: 301,
  META_DELETEOBJECT: 496
}, b = {
  EMR_HEADER: 1,
  EMR_POLYBEZIER: 2,
  EMR_POLYGON: 3,
  EMR_POLYLINE: 4,
  EMR_POLYBEZIERTO: 5,
  EMR_POLYLINETO: 6,
  EMR_POLYPOLYLINE: 7,
  EMR_POLYPOLYGON: 8,
  EMR_SETWINDOWEXTEX: 9,
  EMR_SETWINDOWORGEX: 10,
  EMR_SETVIEWPORTEXTEX: 11,
  EMR_SETVIEWPORTORGEX: 12,
  EMR_EOF: 14,
  EMR_SETBKMODE: 18,
  EMR_SETPOLYFILLMODE: 19,
  EMR_SETTEXTALIGN: 22,
  EMR_SETTEXTCOLOR: 24,
  EMR_SETBKCOLOR: 25,
  EMR_MOVETOEX: 27,
  EMR_SAVEDC: 33,
  EMR_RESTOREDC: 34,
  EMR_SETWORLDTRANSFORM: 35,
  EMR_MODIFYWORLDTRANSFORM: 36,
  EMR_SELECTOBJECT: 37,
  EMR_CREATEPEN: 38,
  EMR_CREATEBRUSHINDIRECT: 39,
  EMR_DELETEOBJECT: 40,
  EMR_ELLIPSE: 42,
  EMR_RECTANGLE: 43,
  EMR_ROUNDRECT: 44,
  EMR_BEGINPATH: 59,
  EMR_ENDPATH: 60,
  EMR_CLOSEFIGURE: 61,
  EMR_FILLPATH: 62,
  EMR_STROKEANDFILLPATH: 63,
  EMR_STROKEPATH: 64,
  EMR_SELECTCLIPPATH: 67,
  EMR_LINETO: 54,
  EMR_BITBLT: 76,
  EMR_STRETCHBLT: 77,
  EMR_STRETCHDIBITS: 81,
  EMR_EXTCREATEFONTINDIRECTW: 82,
  EMR_EXTTEXTOUTA: 83,
  EMR_EXTTEXTOUTW: 84,
  EMR_POLYBEZIER16: 85,
  EMR_POLYGON16: 86,
  EMR_POLYLINE16: 87,
  EMR_POLYBEZIERTO16: 88,
  EMR_POLYLINETO16: 89,
  EMR_POLYPOLYLINE16: 90,
  EMR_POLYPOLYGON16: 91,
  EMR_EXTCREATEPEN: 95,
  EMR_SMALLTEXTOUT: 108,
  EMR_ALPHABLEND: 114
}, ne = 2147483648, re = {
  WHITE_BRUSH: ne,
  LTGRAY_BRUSH: ne + 1,
  GRAY_BRUSH: ne + 2,
  DKGRAY_BRUSH: ne + 3,
  BLACK_BRUSH: ne + 4,
  NULL_BRUSH: ne + 5,
  WHITE_PEN: ne + 6,
  BLACK_PEN: ne + 7,
  NULL_PEN: ne + 8
}, De = {
  MWT_IDENTITY: 1,
  MWT_LEFTMULTIPLY: 2,
  MWT_RIGHTMULTIPLY: 3,
  MWT_SET: 4
};
function y(e) {
  const t = Math.round(e * 100) / 100;
  return Number.isInteger(t), String(t);
}
function N(e) {
  return Math.max(1, e.right - e.left || 0);
}
function W(e) {
  return Math.max(1, e.bottom - e.top || 0);
}
function me(e) {
  return {
    left: Math.min(e.left, e.right),
    top: Math.min(e.top, e.bottom),
    right: Math.max(e.left, e.right),
    bottom: Math.max(e.top, e.bottom)
  };
}
function ka(e, t) {
  for (const n of t)
    if (!(!Number.isFinite(n.x) || !Number.isFinite(n.y))) {
      if (!e.contentBounds) {
        e.contentBounds = { left: n.x, top: n.y, right: n.x, bottom: n.y };
        continue;
      }
      e.contentBounds.left = Math.min(e.contentBounds.left, n.x), e.contentBounds.top = Math.min(e.contentBounds.top, n.y), e.contentBounds.right = Math.max(e.contentBounds.right, n.x), e.contentBounds.bottom = Math.max(e.contentBounds.bottom, n.y);
    }
}
function ae(e) {
  const t = e & 255, n = e >>> 8 & 255, r = e >>> 16 & 255;
  return `#${t.toString(16).padStart(2, "0")}${n.toString(16).padStart(2, "0")}${r.toString(16).padStart(2, "0")}`;
}
function Aa(e, t) {
  const n = new Uint8Array(14), r = new DataView(n.buffer);
  return n[0] = 66, n[1] = 77, r.setUint32(2, t >>> 0, !0), r.setUint32(10, e >>> 0, !0), n;
}
function La(e, t) {
  if (e.length < 12 || !t.length)
    return null;
  const n = 14 + e.length, r = n + t.length, a = new Uint8Array(r);
  return a.set(Aa(n, r), 0), a.set(e, 14), a.set(t, n), a;
}
function ct(e, t, n) {
  const r = Math.max(1, Math.abs(t) || 1), a = { color: n, width: r };
  switch (e & 15) {
    case 1:
      return { ...a, dasharray: `${r * 4} ${r * 2}` };
    case 2:
      return { ...a, dasharray: `${r} ${r * 2}` };
    case 3:
      return { ...a, dasharray: `${r * 4} ${r * 2} ${r} ${r * 2}` };
    case 4:
      return { ...a, dasharray: `${r * 4} ${r * 2} ${r} ${r * 2} ${r} ${r * 2}` };
    case 5:
      return { ...a, none: !0 };
    default:
      return a;
  }
}
function mn(e, t) {
  return e === 1 ? { color: t, none: !0 } : { color: t };
}
function qe(e) {
  return {
    ...e,
    windowOrg: { ...e.windowOrg },
    windowExt: { ...e.windowExt },
    viewportOrg: { ...e.viewportOrg },
    viewportExt: { ...e.viewportExt },
    worldTransform: { ...e.worldTransform },
    currentPosition: { ...e.currentPosition },
    pen: { ...e.pen },
    brush: { ...e.brush },
    font: { ...e.font }
  };
}
function Ot(e, t) {
  const n = e.view;
  return {
    m11: e.ensure(t, 4) ? n.getFloat32(t, !0) : 1,
    m12: e.ensure(t + 4, 4) ? n.getFloat32(t + 4, !0) : 0,
    m21: e.ensure(t + 8, 4) ? n.getFloat32(t + 8, !0) : 0,
    m22: e.ensure(t + 12, 4) ? n.getFloat32(t + 12, !0) : 1,
    dx: e.ensure(t + 16, 4) ? n.getFloat32(t + 16, !0) : 0,
    dy: e.ensure(t + 20, 4) ? n.getFloat32(t + 20, !0) : 0
  };
}
function It(e, t) {
  return {
    m11: e.m11 * t.m11 + e.m12 * t.m21,
    m12: e.m11 * t.m12 + e.m12 * t.m22,
    m21: e.m21 * t.m11 + e.m22 * t.m21,
    m22: e.m21 * t.m12 + e.m22 * t.m22,
    dx: e.dx * t.m11 + e.dy * t.m21 + t.dx,
    dy: e.dx * t.m12 + e.dy * t.m22 + t.dy
  };
}
function Fa(e, t) {
  return {
    x: t.x * e.m11 + t.y * e.m21 + e.dx,
    y: t.x * e.m12 + t.y * e.m22 + e.dy
  };
}
function _a(e, t) {
  return {
    x: t.x * e.m11 + t.y * e.m21,
    y: t.x * e.m12 + t.y * e.m22
  };
}
function hn(e, t, n) {
  return {
    width: e,
    height: t,
    viewBox: n,
    recordCount: 0,
    contentBounds: null,
    nodes: [],
    stateStack: [],
    capturePath: !1,
    pathData: [],
    pathPoints: [],
    objects: [],
    state: {
      windowOrg: { x: n.left, y: n.top },
      windowExt: { x: N(n), y: W(n) },
      viewportOrg: { x: n.left, y: n.top },
      viewportExt: { x: N(n), y: W(n) },
      worldTransform: { ...pn },
      currentPosition: { x: 0, y: 0 },
      pen: { ...Ra },
      brush: { ...Ba },
      font: { ...Ca },
      textColor: "#000000",
      bkColor: "#ffffff",
      bkMode: 1,
      textAlign: 0,
      polygonFillMode: 1
    }
  };
}
function te(e, t) {
  const n = Fa(e.state.worldTransform, t), r = e.state.windowExt.x || N(e.viewBox) || 1, a = e.state.windowExt.y || W(e.viewBox) || 1, s = e.state.viewportExt.x || N(e.viewBox) || 1, o = e.state.viewportExt.y || W(e.viewBox) || 1;
  return {
    x: e.state.viewportOrg.x + (n.x - e.state.windowOrg.x) * s / r,
    y: e.state.viewportOrg.y + (n.y - e.state.windowOrg.y) * o / a
  };
}
function lt(e, t) {
  const n = _a(e.state.worldTransform, t), r = e.state.windowExt.x || N(e.viewBox) || 1, a = e.state.windowExt.y || W(e.viewBox) || 1, s = e.state.viewportExt.x || N(e.viewBox) || 1, o = e.state.viewportExt.y || W(e.viewBox) || 1;
  return {
    x: n.x * s / r,
    y: n.y * o / a
  };
}
function mt(e, t) {
  const n = [
    te(e, { x: t.left, y: t.top }),
    te(e, { x: t.right, y: t.top }),
    te(e, { x: t.right, y: t.bottom }),
    te(e, { x: t.left, y: t.bottom })
  ];
  return me({
    left: Math.min(...n.map((r) => r.x)),
    top: Math.min(...n.map((r) => r.y)),
    right: Math.max(...n.map((r) => r.x)),
    bottom: Math.max(...n.map((r) => r.y))
  });
}
function oe(e) {
  return `${y(e.x)},${y(e.y)}`;
}
function ht(e, t) {
  const n = Math.max(1, Math.abs(t.width) || 1), r = lt(e, { x: n, y: 0 }), a = lt(e, { x: 0, y: n }), s = Math.hypot(r.x, r.y), o = Math.hypot(a.x, a.y), i = (s + o) / 2;
  return !Number.isFinite(i) || i <= 0 ? n : Math.max(0.5, i);
}
function gn(e, t) {
  if (!t.dasharray)
    return;
  const n = Math.max(1, Math.abs(t.width) || 1), r = ht(e, t) / n;
  return t.dasharray.split(/\s+/).map((a) => Number(a)).filter((a) => Number.isFinite(a) && a > 0).map((a) => y(a * r)).join(" ") || void 0;
}
function Xe(e, t) {
  if (t.none)
    return 'stroke="none"';
  const n = [`stroke="${F(t.color)}"`, `stroke-width="${y(ht(e, t))}"`, 'fill="none"'], r = gn(e, t);
  return r && n.push(`stroke-dasharray="${F(r)}"`), n.join(" ");
}
function Ve(e) {
  const t = [e.state.pen.none ? 'stroke="none"' : `stroke="${F(e.state.pen.color)}"`, e.state.pen.none ? "" : `stroke-width="${y(ht(e, e.state.pen))}"`].filter(Boolean), n = gn(e, e.state.pen);
  return n && !e.state.pen.none && t.push(`stroke-dasharray="${F(n)}"`), t.push(e.state.brush.none ? 'fill="none"' : `fill="${F(e.state.brush.color)}"`), t.push(`fill-rule="${e.state.polygonFillMode === 2 ? "nonzero" : "evenodd"}"`), t.join(" ");
}
function Da(e) {
  const t = ['stroke="none"'];
  return t.push(e.state.brush.none ? 'fill="none"' : `fill="${F(e.state.brush.color)}"`), t.push(`fill-rule="${e.state.polygonFillMode === 2 ? "nonzero" : "evenodd"}"`), t.join(" ");
}
function Qe(e) {
  const t = e.findIndex((n) => n == null);
  return t >= 0 ? t : (e.push(null), e.length - 1);
}
function fe(e, t, n) {
  for (; e.length <= t; )
    e.push(null);
  e[t] = n;
}
function $a(e, t) {
  switch (t >>> 0) {
    case re.WHITE_BRUSH:
      return e.state.brush = { color: "#ffffff" }, !0;
    case re.LTGRAY_BRUSH:
      return e.state.brush = { color: "#c0c0c0" }, !0;
    case re.GRAY_BRUSH:
      return e.state.brush = { color: "#808080" }, !0;
    case re.DKGRAY_BRUSH:
      return e.state.brush = { color: "#404040" }, !0;
    case re.BLACK_BRUSH:
      return e.state.brush = { color: "#000000" }, !0;
    case re.NULL_BRUSH:
      return e.state.brush = { color: "none", none: !0 }, !0;
    case re.WHITE_PEN:
      return e.state.pen = { color: "#ffffff", width: 1 }, !0;
    case re.BLACK_PEN:
      return e.state.pen = { color: "#000000", width: 1 }, !0;
    case re.NULL_PEN:
      return e.state.pen = { color: "none", width: 1, none: !0 }, !0;
    default:
      return !1;
  }
}
function xn(e, t) {
  if ($a(e, t))
    return;
  const n = e.objects[t] || null;
  n && (n.kind === "pen" && (e.state.pen = { ...n.value }), n.kind === "brush" && (e.state.brush = { ...n.value }), n.kind === "font" && (e.state.font = { ...n.value }));
}
function ce(e, t, n) {
  e.nodes.push(t), ka(e, n);
}
function Ie(e, t, n) {
  t && (e.pathData.push(t), e.pathPoints.push(...n));
}
function et(e, t) {
  e.pathData.length && (ce(e, `<path d="${e.pathData.join(" ")}" ${t} />`, e.pathPoints), e.pathData = [], e.pathPoints = [], e.capturePath = !1);
}
function bn(e, t, n) {
  const r = te(e, t), a = te(e, n);
  if (e.state.currentPosition = { ...n }, e.capturePath) {
    Ie(e, `${e.pathData.length ? "" : `M ${oe(r)}`} L ${oe(a)}`.trim(), [r, a]);
    return;
  }
  ce(e, `<line x1="${y(r.x)}" y1="${y(r.y)}" x2="${y(a.x)}" y2="${y(a.y)}" ${Xe(e, e.state.pen)} />`, [r, a]);
}
function Me(e, t, n) {
  if (!t.length)
    return;
  const r = t.map((i) => te(e, i));
  e.state.currentPosition = { ...t[t.length - 1] };
  const a = r.map(oe).join(" ");
  if (e.capturePath) {
    const i = [`M ${oe(r[0])}`, ...r.slice(1).map((l) => `L ${oe(l)}`)];
    n && i.push("Z"), Ie(e, i.join(" "), r);
    return;
  }
  const s = n ? "polygon" : "polyline", o = n ? Ve(e) : Xe(e, e.state.pen);
  ce(e, `<${s} points="${a}" ${o} />`, r);
}
function kt(e, t, n = !1) {
  const r = [];
  if (n && r.push({ ...e.state.currentPosition }), r.push(...t), r.length < 4)
    return;
  const a = r.map((o) => te(e, o));
  let s = `M ${oe(a[0])}`;
  for (let o = 1; o + 2 < a.length; o += 3)
    s += ` C ${oe(a[o])} ${oe(a[o + 1])} ${oe(a[o + 2])}`;
  if (e.state.currentPosition = { ...r[r.length - 1] }, e.capturePath) {
    Ie(e, s, a);
    return;
  }
  ce(e, `<path d="${s}" ${Xe(e, e.state.pen)} />`, a);
}
function ze(e, t, n) {
  const r = mt(e, t), a = [
    `x="${y(r.left)}"`,
    `y="${y(r.top)}"`,
    `width="${y(N(r))}"`,
    `height="${y(W(r))}"`
  ];
  if (n) {
    const s = te(e, { x: n.x, y: n.y });
    a.push(`rx="${y(Math.abs(s.x - e.state.viewportOrg.x))}"`), a.push(`ry="${y(Math.abs(s.y - e.state.viewportOrg.y))}"`);
  }
  if (e.capturePath) {
    Ie(e, `M ${y(r.left)},${y(r.top)} L ${y(r.right)},${y(r.top)} L ${y(r.right)},${y(r.bottom)} L ${y(r.left)},${y(r.bottom)} Z`, [
      { x: r.left, y: r.top },
      { x: r.right, y: r.bottom }
    ]);
    return;
  }
  ce(e, `<rect ${a.join(" ")} ${Ve(e)} />`, [
    { x: r.left, y: r.top },
    { x: r.right, y: r.bottom }
  ]);
}
function Tn(e, t) {
  const n = mt(e, t), r = (n.left + n.right) / 2, a = (n.top + n.bottom) / 2, s = N(n) / 2, o = W(n) / 2;
  if (e.capturePath) {
    Ie(e, `M ${y(r - s)},${y(a)} A ${y(s)},${y(o)} 0 1 0 ${y(r + s)},${y(a)} A ${y(s)},${y(o)} 0 1 0 ${y(r - s)},${y(a)} Z`, [
      { x: n.left, y: n.top },
      { x: n.right, y: n.bottom }
    ]);
    return;
  }
  ce(e, `<ellipse cx="${y(r)}" cy="${y(a)}" rx="${y(s)}" ry="${y(o)}" ${Ve(e)} />`, [
    { x: n.left, y: n.top },
    { x: n.right, y: n.bottom }
  ]);
}
function En(e, t, n) {
  if (!n.length)
    return;
  const r = mt(e, t), a = N(r), s = W(r), o = de(n, "image/bmp");
  ce(e, `<image x="${y(r.left)}" y="${y(r.top)}" width="${y(a)}" height="${y(s)}" href="${o}" preserveAspectRatio="none" />`, [
    { x: r.left, y: r.top },
    { x: r.right, y: r.bottom }
  ]);
}
function je(e) {
  return new TextDecoder("windows-1252").decode(e).replace(/\0+$/g, "");
}
function wn(e) {
  return new TextDecoder("utf-16le").decode(e).replace(/\0+$/g, "");
}
function Na(e) {
  const t = e & 6;
  return t === 2 ? "end" : t === 6 ? "middle" : "start";
}
function Wa(e) {
  const t = e & 24;
  return t === 8 ? "text-after-edge" : t === 24 ? "alphabetic" : "text-before-edge";
}
function We(e, t, n) {
  if (!n)
    return;
  const r = te(e, t), a = lt(e, { x: 0, y: Math.abs(e.state.font.size) || 12 }), s = Math.hypot(a.x, a.y), o = Math.max(1, Number.isFinite(s) && s > 0 ? s : Math.abs(e.state.font.size) || 12), i = String(e.state.font.family || "sans-serif").replace(/\s+(?:Baltic|CE|Cyr|Greek|Tur|Vietnamese|Hebrew|Arabic|Thai|Symbol)$/i, "") || "sans-serif", l = [
    `x="${y(r.x)}"`,
    `y="${y(r.y)}"`,
    `fill="${F(e.state.textColor)}"`,
    `font-size="${y(o)}"`,
    `font-family="${F(i)}"`,
    `text-anchor="${Na(e.state.textAlign)}"`,
    `dominant-baseline="${Wa(e.state.textAlign)}"`
  ];
  e.state.font.weight && e.state.font.weight >= 600 && l.push('font-weight="700"'), e.state.font.italic && l.push('font-style="italic"');
  const c = [e.state.font.underline ? "underline" : "", e.state.font.strike ? "line-through" : ""].filter(Boolean);
  c.length && l.push(`text-decoration="${c.join(" ")}"`), e.state.font.escapement && l.push(`transform="rotate(${y(e.state.font.escapement / 10)}, ${y(r.x)}, ${y(r.y)})"`), ce(e, `<text ${l.join(" ")}>${F(n)}</text>`, [r]);
}
function Ye(e, t) {
  if (!e.nodes.length)
    return null;
  const n = e.contentBounds ? me(e.contentBounds) : me(e.viewBox), r = me({
    left: Number.isFinite(e.viewBox.left) ? e.viewBox.left : n.left,
    top: Number.isFinite(e.viewBox.top) ? e.viewBox.top : n.top,
    right: Number.isFinite(e.viewBox.right) ? e.viewBox.right : n.right,
    bottom: Number.isFinite(e.viewBox.bottom) ? e.viewBox.bottom : n.bottom
  }), a = Math.max(1, Math.round(N(r))), s = Math.max(1, Math.round(W(r))), o = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${a}" height="${s}" viewBox="${y(r.left)} ${y(r.top)} ${y(N(r))} ${y(W(r))}" preserveAspectRatio="xMinYMin meet">
${e.nodes.join(`
`)}
</svg>`, i = new TextEncoder().encode(o);
  return {
    mime: "image/svg+xml",
    bytes: i,
    dataUrl: de(i, "image/svg+xml"),
    width: a,
    height: s,
    sourceMime: t,
    recordCount: e.recordCount
  };
}
function Ha(e) {
  const t = new M(e);
  let n = 0, r = null;
  if (t.u32(0) === Oa && e.length >= 22 && (r = me({
    left: t.i16(6),
    top: t.i16(8),
    right: t.i16(10),
    bottom: t.i16(12)
  }), n = 22), n + Ia > e.length)
    return null;
  const a = new M(e.subarray(n)), s = a.u16(2), o = a.u16(10), i = n + s * 2;
  if (i > e.length)
    return null;
  const l = r || { left: 0, top: 0, right: 1e3, bottom: 1e3 }, c = hn(N(l), W(l), l);
  c.objects = new Array(Math.max(0, o)).fill(null), r && (c.state.windowOrg = { x: r.left, y: r.top }, c.state.windowExt = { x: N(r), y: W(r) }, c.state.viewportOrg = { x: r.left, y: r.top }, c.state.viewportExt = { x: N(r), y: W(r) });
  let f = i;
  for (; f + 6 <= e.length; ) {
    const u = new M(e.subarray(f)), h = u.u32(0) * 2;
    if (h < 6 || f + h > e.length)
      break;
    const g = u.u16(4);
    switch (c.recordCount += 1, g) {
      case k.META_EOF:
        return f += h, Ye(c, "image/wmf");
      case k.META_SETWINDOWORG:
        c.state.windowOrg = { x: u.i16(8), y: u.i16(6) };
        break;
      case k.META_SETWINDOWEXT:
        c.state.windowExt = { x: u.i16(8), y: u.i16(6) };
        break;
      case k.META_SETVIEWPORTORG:
        c.state.viewportOrg = { x: u.i16(8), y: u.i16(6) };
        break;
      case k.META_SETVIEWPORTEXT:
        c.state.viewportExt = { x: u.i16(8), y: u.i16(6) };
        break;
      case k.META_OFFSETWINDOWORG:
        c.state.windowOrg = { x: c.state.windowOrg.x + u.i16(8), y: c.state.windowOrg.y + u.i16(6) };
        break;
      case k.META_OFFSETVIEWPORTORG:
        c.state.viewportOrg = { x: c.state.viewportOrg.x + u.i16(8), y: c.state.viewportOrg.y + u.i16(6) };
        break;
      case k.META_SETBKMODE:
        c.state.bkMode = u.u16(6);
        break;
      case k.META_SETPOLYFILLMODE:
        c.state.polygonFillMode = u.u16(6);
        break;
      case k.META_SETBKCOLOR:
        c.state.bkColor = ae(u.u32(6));
        break;
      case k.META_SETTEXTCOLOR:
        c.state.textColor = ae(u.u32(6));
        break;
      case k.META_MOVETO:
        c.state.currentPosition = { x: u.i16(8), y: u.i16(6) };
        break;
      case k.META_LINETO: {
        const x = { x: u.i16(8), y: u.i16(6) };
        bn(c, c.state.currentPosition, x);
        break;
      }
      case k.META_POLYLINE:
      case k.META_POLYGON: {
        const x = u.u16(6), T = [];
        let P = 8;
        for (let R = 0; R < x && P + 4 <= h; R += 1)
          T.push({ x: u.i16(P), y: u.i16(P + 2) }), P += 4;
        Me(c, T, g === k.META_POLYGON);
        break;
      }
      case k.META_POLYPOLYGON: {
        const x = u.u16(6), T = [];
        let P = 8;
        for (let R = 0; R < x && P + 2 <= h; R += 1)
          T.push(u.u16(P)), P += 2;
        for (const R of T) {
          const E = [];
          for (let v = 0; v < R && P + 4 <= h; v += 1)
            E.push({ x: u.i16(P), y: u.i16(P + 2) }), P += 4;
          Me(c, E, !0);
        }
        break;
      }
      case k.META_RECTANGLE: {
        ze(c, {
          left: u.i16(12),
          top: u.i16(10),
          right: u.i16(8),
          bottom: u.i16(6)
        });
        break;
      }
      case k.META_ELLIPSE: {
        Tn(c, {
          left: u.i16(12),
          top: u.i16(10),
          right: u.i16(8),
          bottom: u.i16(6)
        });
        break;
      }
      case k.META_ROUNDRECT: {
        ze(c, {
          left: u.i16(16),
          top: u.i16(14),
          right: u.i16(12),
          bottom: u.i16(10)
        }, {
          x: u.i16(8),
          y: u.i16(6)
        });
        break;
      }
      case k.META_TEXTOUT: {
        const x = u.u16(6), T = 8, P = x + x % 2, R = je(u.slice(T, Math.min(x, Math.max(0, h - T - 4)))), E = T + P, v = u.i16(E), O = u.i16(E + 2);
        We(c, { x: O, y: v }, R);
        break;
      }
      case k.META_CREATEPENINDIRECT: {
        const x = u.u16(6), T = u.i16(8), P = ae(u.u32(12)), R = Qe(c.objects);
        fe(c.objects, R, { kind: "pen", value: ct(x, T, P) });
        break;
      }
      case k.META_CREATEBRUSHINDIRECT: {
        const x = u.u16(6), T = ae(u.u32(8)), P = Qe(c.objects);
        fe(c.objects, P, { kind: "brush", value: mn(x, T) });
        break;
      }
      case k.META_CREATEFONTINDIRECT: {
        const x = Math.abs(u.i16(6)), T = u.i16(10), P = u.u16(14), R = !!u.u8(16), E = !!u.u8(17), v = !!u.u8(18), O = je(u.slice(24, Math.max(0, h - 24))).split("\0")[0] || "sans-serif", _ = Qe(c.objects);
        fe(c.objects, _, {
          kind: "font",
          value: { family: O, size: x || 12, weight: P, italic: R, underline: E, strike: v, escapement: T }
        });
        break;
      }
      case k.META_SELECTOBJECT:
        xn(c, u.u16(6));
        break;
      case k.META_DELETEOBJECT: {
        const x = u.u16(6);
        x >= 0 && x < c.objects.length && (c.objects[x] = null);
        break;
      }
    }
    f += h;
  }
  return Ye(c, "image/wmf");
}
function we(e, t, n, r) {
  const a = [];
  for (let s = 0; s < n; s += 1) {
    const o = t + s * r;
    r === 8 ? a.push({ x: e.i32(o), y: e.i32(o + 4) }) : a.push({ x: e.i16(o), y: e.i16(o + 2) });
  }
  return a;
}
function At(e, t) {
  if (!e.ensure(36, 40))
    return null;
  const n = { x: e.i32(36), y: e.i32(40) }, r = e.u32(44), a = e.u32(48);
  if (!r || !a || a >= e.length)
    return null;
  const s = t ? r * 2 : r, o = e.slice(a, s), i = t ? wn(o) : je(o);
  return { point: n, text: i };
}
function Ua(e) {
  if (!e.ensure(8, 24))
    return null;
  const t = { x: e.i32(8), y: e.i32(12) }, n = e.u32(16), r = e.u32(20);
  let a = 36;
  if (r & 2 && (a += 16), !n || !e.ensure(a, n))
    return null;
  const s = je(e.slice(a, n));
  return { point: t, text: s };
}
function yn(e, t, n, r, a) {
  const s = e.u32(t), o = e.u32(n), i = e.u32(r), l = e.u32(a);
  return !s || !o || !i || !l || !e.ensure(s, o) || !e.ensure(i, l) ? null : La(e.slice(s, o), e.slice(i, l));
}
function za(e, t) {
  if (!t.ensure(24, 56))
    return;
  const n = yn(t, 48, 52, 56, 60);
  n && En(e, {
    left: t.i32(24),
    top: t.i32(28),
    right: t.i32(24) + t.i32(72),
    bottom: t.i32(28) + t.i32(76)
  }, n);
}
function ja(e, t) {
  if (!t.ensure(24, 76))
    return;
  const n = yn(t, 84, 88, 92, 96);
  n && En(e, {
    left: t.i32(24),
    top: t.i32(28),
    right: t.i32(24) + t.i32(32),
    bottom: t.i32(28) + t.i32(36)
  }, n);
}
function Ya(e) {
  e.pathData.length && e.pathData.push("Z");
}
function Ga(e) {
  const t = new M(e);
  if (!t.ensure(0, 52) || t.u32(0) !== b.EMR_HEADER)
    return null;
  const n = me({
    left: t.i32(8),
    top: t.i32(12),
    right: t.i32(16),
    bottom: t.i32(20)
  }), r = N(n) > 0 && W(n) > 0 ? n : { left: 0, top: 0, right: 1e3, bottom: 1e3 }, a = hn(N(r), W(r), r);
  a.state.windowOrg = { x: r.left, y: r.top }, a.state.windowExt = { x: N(r), y: W(r) }, a.state.viewportOrg = { x: r.left, y: r.top }, a.state.viewportExt = { x: N(r), y: W(r) };
  let s = 0;
  for (; s + 8 <= e.length; ) {
    const o = new M(e.subarray(s)), i = o.u32(0), l = o.u32(4);
    if (l < 8 || s + l > e.length)
      break;
    switch (a.recordCount += 1, i) {
      case b.EMR_EOF:
        return s += l, Ye(a, "image/emf");
      case b.EMR_SETWINDOWORGEX:
        a.state.windowOrg = { x: o.i32(8), y: o.i32(12) };
        break;
      case b.EMR_SETWINDOWEXTEX:
        a.state.windowExt = { x: o.i32(8), y: o.i32(12) };
        break;
      case b.EMR_SETVIEWPORTORGEX:
        a.state.viewportOrg = { x: o.i32(8), y: o.i32(12) };
        break;
      case b.EMR_SETVIEWPORTEXTEX:
        a.state.viewportExt = { x: o.i32(8), y: o.i32(12) };
        break;
      case b.EMR_SETBKMODE:
        a.state.bkMode = o.u32(8);
        break;
      case b.EMR_SETPOLYFILLMODE:
        a.state.polygonFillMode = o.u32(8);
        break;
      case b.EMR_SETTEXTALIGN:
        a.state.textAlign = o.u32(8);
        break;
      case b.EMR_SETTEXTCOLOR:
        a.state.textColor = ae(o.u32(8));
        break;
      case b.EMR_SETBKCOLOR:
        a.state.bkColor = ae(o.u32(8));
        break;
      case b.EMR_SAVEDC:
        a.stateStack.push(qe(a.state));
        break;
      case b.EMR_RESTOREDC: {
        const c = o.i32(8);
        if (c < 0) {
          const f = Math.min(a.stateStack.length, Math.abs(c));
          for (let m = 0; m < f - 1; m += 1)
            a.stateStack.pop();
          const u = a.stateStack.pop();
          u && (a.state = qe(u));
        } else if (c > 0 && c <= a.stateStack.length) {
          const f = a.stateStack[c - 1];
          a.stateStack.length = c - 1, f && (a.state = qe(f));
        }
        break;
      }
      case b.EMR_SETWORLDTRANSFORM:
        a.state.worldTransform = Ot(o, 8);
        break;
      case b.EMR_MODIFYWORLDTRANSFORM: {
        const c = Ot(o, 8), f = o.u32(32);
        f === De.MWT_IDENTITY ? a.state.worldTransform = { ...pn } : f === De.MWT_SET ? a.state.worldTransform = c : f === De.MWT_LEFTMULTIPLY ? a.state.worldTransform = It(c, a.state.worldTransform) : f === De.MWT_RIGHTMULTIPLY && (a.state.worldTransform = It(a.state.worldTransform, c));
        break;
      }
      case b.EMR_MOVETOEX:
        a.state.currentPosition = { x: o.i32(8), y: o.i32(12) };
        break;
      case b.EMR_LINETO: {
        const c = { x: o.i32(8), y: o.i32(12) };
        bn(a, a.state.currentPosition, c);
        break;
      }
      case b.EMR_POLYLINE:
      case b.EMR_POLYGON:
      case b.EMR_POLYLINE16:
      case b.EMR_POLYGON16: {
        const c = o.u32(24), f = 28, u = i === b.EMR_POLYLINE16 || i === b.EMR_POLYGON16 ? 4 : 8, m = we(o, f, c, u);
        Me(a, m, i === b.EMR_POLYGON || i === b.EMR_POLYGON16);
        break;
      }
      case b.EMR_POLYBEZIER:
      case b.EMR_POLYBEZIER16: {
        const c = o.u32(24), f = 28, u = i === b.EMR_POLYBEZIER16 ? 4 : 8, m = we(o, f, c, u);
        kt(a, m, !1);
        break;
      }
      case b.EMR_POLYBEZIERTO:
      case b.EMR_POLYBEZIERTO16: {
        const c = o.u32(24), f = 28, u = i === b.EMR_POLYBEZIERTO16 ? 4 : 8, m = we(o, f, c, u);
        kt(a, m, !0);
        break;
      }
      case b.EMR_POLYLINETO:
      case b.EMR_POLYLINETO16: {
        const c = o.u32(24), f = 28, u = i === b.EMR_POLYLINETO16 ? 4 : 8, m = we(o, f, c, u);
        Me(a, [{ ...a.state.currentPosition }, ...m], !1);
        break;
      }
      case b.EMR_POLYPOLYLINE:
      case b.EMR_POLYPOLYGON:
      case b.EMR_POLYPOLYLINE16:
      case b.EMR_POLYPOLYGON16: {
        const c = o.u32(24), f = o.u32(28), u = 32, m = i === b.EMR_POLYPOLYLINE16 || i === b.EMR_POLYPOLYGON16 ? 4 : 8, h = u + c * 4, g = [];
        for (let P = 0; P < c; P += 1)
          g.push(o.u32(u + P * 4));
        const x = we(o, h, f, m);
        let T = 0;
        for (const P of g)
          Me(a, x.slice(T, T + P), i === b.EMR_POLYPOLYGON || i === b.EMR_POLYPOLYGON16), T += P;
        break;
      }
      case b.EMR_RECTANGLE:
        ze(a, { left: o.i32(8), top: o.i32(12), right: o.i32(16), bottom: o.i32(20) });
        break;
      case b.EMR_ELLIPSE:
        Tn(a, { left: o.i32(8), top: o.i32(12), right: o.i32(16), bottom: o.i32(20) });
        break;
      case b.EMR_ROUNDRECT:
        ze(a, { left: o.i32(8), top: o.i32(12), right: o.i32(16), bottom: o.i32(20) }, { x: o.i32(24), y: o.i32(28) });
        break;
      case b.EMR_BEGINPATH:
        a.capturePath = !0, a.pathData = [], a.pathPoints = [];
        break;
      case b.EMR_ENDPATH:
        a.capturePath = !1;
        break;
      case b.EMR_CLOSEFIGURE:
        Ya(a);
        break;
      case b.EMR_FILLPATH:
        et(a, Da(a));
        break;
      case b.EMR_STROKEANDFILLPATH:
        et(a, Ve(a));
        break;
      case b.EMR_STROKEPATH:
        et(a, Xe(a, a.state.pen));
        break;
      case b.EMR_SELECTCLIPPATH:
        a.capturePath = !1, a.pathData = [], a.pathPoints = [];
        break;
      case b.EMR_CREATEPEN: {
        const c = o.u32(8), f = o.u32(12), u = o.i32(16), m = ae(o.u32(24));
        fe(a.objects, c, { kind: "pen", value: ct(f, u, m) });
        break;
      }
      case b.EMR_CREATEBRUSHINDIRECT: {
        const c = o.u32(8), f = o.u32(12), u = ae(o.u32(16));
        fe(a.objects, c, { kind: "brush", value: mn(f, u) });
        break;
      }
      case b.EMR_EXTCREATEPEN: {
        const c = o.u32(8), f = o.u32(28), u = o.i32(32), m = o.u32(36), h = m === 1 ? "none" : ae(o.u32(40));
        fe(a.objects, c, { kind: "pen", value: m === 1 ? { color: h, width: u, none: !0 } : ct(f, u, h) });
        break;
      }
      case b.EMR_EXTCREATEFONTINDIRECTW: {
        const c = o.u32(8), f = Math.abs(o.i32(12)), u = o.i32(20), m = o.i32(28), h = !!o.u8(32), g = !!o.u8(33), x = !!o.u8(34), T = wn(o.slice(40, 64)).split("\0")[0] || "sans-serif";
        fe(a.objects, c, {
          kind: "font",
          value: { family: T, size: f || 12, weight: m, italic: h, underline: g, strike: x, escapement: u }
        });
        break;
      }
      case b.EMR_SELECTOBJECT:
        xn(a, o.u32(8));
        break;
      case b.EMR_DELETEOBJECT: {
        const c = o.u32(8);
        c >= 0 && c < a.objects.length && (a.objects[c] = null);
        break;
      }
      case b.EMR_EXTTEXTOUTA: {
        const c = At(o, !1);
        c && We(a, c.point, c.text);
        break;
      }
      case b.EMR_EXTTEXTOUTW: {
        const c = At(o, !0);
        c && We(a, c.point, c.text);
        break;
      }
      case b.EMR_SMALLTEXTOUT: {
        const c = Ua(o);
        c && We(a, c.point, c.text);
        break;
      }
      case b.EMR_STRETCHDIBITS:
        za(a, o);
        break;
      case b.EMR_BITBLT:
      case b.EMR_STRETCHBLT:
      case b.EMR_ALPHABLEND:
        ja(a, o);
        break;
    }
    s += l;
  }
  return Ye(a, "image/emf");
}
function Xa(e, t) {
  return t.length ? /image\/emf/i.test(e) ? Ga(t) : /image\/wmf/i.test(e) ? Ha(t) : null : null;
}
const Va = 8 * 1024 * 1024, ve = 68, Ka = 102, Za = 15, Ja = 61447, Lt = 61466, Ft = 61467, qa = 61468, _t = 61469, Dt = 61470, $t = 61471, Nt = 61481, Wt = 61482;
function Pn(e, t, n = 0) {
  if (n + t.length > e.length)
    return !1;
  for (let r = 0; r < t.length; r += 1)
    if (e[n + r] !== t[r])
      return !1;
  return !0;
}
function Qa(e) {
  for (let t = 0; t < e.length; t += 1) {
    const n = e[t] ?? 0;
    if (!(n === 0 || n === 9 || n === 10 || n === 13) && (n < 32 || n === 127))
      return !1;
  }
  return !0;
}
function eo(e) {
  const t = e.trim();
  return t ? /^(?:file|https?|data|blob):/i.test(t) || /^(?:\\\\|[a-zA-Z]:[\\/]|\/)/.test(t) ? !0 : /\.(?:png|apng|jpe?g|gif|bmp|dib|tiff?|emf|wmf|pict|svg)(?:$|[?#])/i.test(t) : !1;
}
function Sn(e) {
  return /^file:/i.test(e) || /^(?:\\\\|[a-zA-Z]:[\\/]|\/)/.test(e);
}
function to(e) {
  const t = e.toLowerCase();
  return t.includes(".png") ? "image/png" : t.includes(".jpg") || t.includes(".jpeg") ? "image/jpeg" : t.includes(".gif") ? "image/gif" : t.includes(".bmp") || t.includes(".dib") ? "image/bmp" : t.includes(".tif") ? "image/tiff" : t.includes(".emf") ? "image/emf" : t.includes(".wmf") ? "image/wmf" : t.includes(".pict") || t.includes(".pct") || t.includes(".pic") ? "image/pict" : t.includes(".svg") ? "image/svg+xml" : null;
}
function Re(e) {
  return /^(?:image\/png|image\/jpeg|image\/gif|image\/bmp|image\/webp|image\/svg\+xml|image\/tiff)$/i.test(e);
}
function Ht(e) {
  const t = e.toLowerCase();
  return t.endsWith(".doc") ? "application/msword" : t.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : t.endsWith(".xls") ? "application/vnd.ms-excel" : t.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : t.endsWith(".ppt") ? "application/vnd.ms-powerpoint" : t.endsWith(".pptx") ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : t.endsWith(".pdf") ? "application/pdf" : t.endsWith(".png") ? "image/png" : t.endsWith(".jpg") || t.endsWith(".jpeg") ? "image/jpeg" : t.endsWith(".gif") ? "image/gif" : t.endsWith(".bmp") ? "image/bmp" : t.endsWith(".zip") ? "application/zip" : t.endsWith(".txt") ? "text/plain" : "application/octet-stream";
}
function no(e) {
  const t = [
    { mime: "image/png", magic: [137, 80, 78, 71], end: ro },
    { mime: "image/jpeg", magic: [255, 216, 255], end: ao },
    { mime: "image/gif", magic: [71, 73, 70, 56], end: oo },
    { mime: "image/bmp", magic: [66, 77], end: so },
    { mime: "image/tiff", magic: [73, 73, 42, 0], end: null },
    { mime: "image/tiff", magic: [77, 77, 0, 42], end: null },
    { mime: "image/emf", magic: [1, 0, 0, 0], end: Ut },
    { mime: "image/wmf", magic: [215, 205, 198, 154], end: null }
  ];
  for (let n = 0; n < e.length - 4; n += 1)
    for (const r of t)
      if (Pn(e, r.magic, n)) {
        if (r.mime === "image/emf" && Ut(e, n) === e.length)
          continue;
        const a = r.end ? r.end(e, n) : e.length;
        return { mime: r.mime, start: n, end: a || e.length };
      }
  return null;
}
function ro(e, t) {
  for (let n = t + 8; n + 8 < e.length; n += 1)
    if (Pn(e, [73, 69, 78, 68], n))
      return n + 8;
  return e.length;
}
function ao(e, t) {
  for (let n = t + 2; n + 1 < e.length; n += 1)
    if (e[n] === 255 && e[n + 1] === 217)
      return n + 2;
  return e.length;
}
function oo(e, t) {
  for (let n = t + 6; n < e.length; n += 1)
    if (e[n] === 59)
      return n + 1;
  return e.length;
}
function so(e, t) {
  if (t + 6 <= e.length) {
    const n = new M(e.subarray(t)).u32(2);
    if (n > 0 && t + n <= e.length)
      return t + n;
  }
  return e.length;
}
function Ut(e, t) {
  if (t + 52 > e.length)
    return e.length;
  const n = new M(e.subarray(t)), r = n.u32(0), a = n.u32(40), s = n.u32(48);
  return r !== 1 || a !== 1179469088 ? e.length : s > 0 && t + s <= e.length ? t + s : e.length;
}
function io(e) {
  if (e.length < ve)
    return null;
  const t = new M(e), n = t.i16(28), r = t.i16(30), a = t.u16(32), s = t.u16(34), o = n > 0 && a > 0 ? Math.max(15, Math.min(31680, Math.round(n * a / 1e3))) : void 0, i = r > 0 && s > 0 ? Math.max(15, Math.min(31680, Math.round(r * s / 1e3))) : void 0;
  return {
    lcb: t.i32(0),
    cbHeader: t.u16(4),
    mm: t.u16(6),
    xExt: t.i16(8),
    yExt: t.i16(10),
    dxaGoalTwips: n > 0 ? n : void 0,
    dyaGoalTwips: r > 0 ? r : void 0,
    scaleXPermille: a || void 0,
    scaleYPermille: s || void 0,
    displayWidthTwips: o,
    displayHeightTwips: i
  };
}
function co(e, t) {
  const n = Math.min(t.cbHeader || ve, e.length);
  if (n >= e.length)
    return null;
  const r = e[n] ?? 0;
  if (!r || n + 1 + r > e.length)
    return null;
  const a = e.subarray(n + 1, n + 1 + r);
  if (!Qa(a))
    return null;
  const s = new TextDecoder("windows-1252").decode(a).replace(/\0+$/g, "");
  return !eo(s) && t.mm !== Ka ? null : { value: s, nextOffset: n + 1 + r };
}
function Mn(e, t) {
  if (t < 0 || t + 8 > e.length)
    return null;
  const n = new M(e), r = n.u16(t), a = n.u16(t + 2), s = n.u32(t + 4);
  if (a < 61440 || a > 65535)
    return null;
  const o = 8 + s;
  return s > e.length || t + o > e.length ? null : {
    recVer: r & 15,
    recInstance: r >>> 4,
    recType: a,
    recLen: s,
    size: o
  };
}
function lo(e, t) {
  const n = new Uint8Array(14), r = new DataView(n.buffer);
  return r.setUint8(0, 66), r.setUint8(1, 77), r.setUint32(2, t, !0), r.setUint16(6, 0, !0), r.setUint16(8, 0, !0), r.setUint32(10, e, !0), n;
}
function uo(e) {
  if (e.length < 12)
    return null;
  const t = new M(e), n = t.u32(0);
  if (n < 12 || n > e.length)
    return null;
  let r = 0, a = 0, s = 0, o = 4;
  n === 12 ? (r = t.u16(10), o = 3) : (r = t.u16(14), a = t.u32(16), s = t.u32(32));
  let l = (s || (r > 0 && r <= 8 ? 1 << r : 0)) * o;
  a === 3 && n >= 40 && (l += 12);
  const c = 14 + n + l;
  if (c > 14 + e.length)
    return null;
  const f = lo(c, 14 + e.length), u = new Uint8Array(14 + e.length);
  return u.set(f, 0), u.set(e, 14), u;
}
function fo(e, t, n) {
  const r = t + 8, a = r + n.recLen;
  if (a > e.length || n.recLen < 36)
    return null;
  const s = new M(e), o = s.u8(r), i = s.u8(r + 1), l = s.u16(r + 18), c = s.u32(r + 20), f = s.u32(r + 24), u = s.u32(r + 28), m = s.u8(r + 33), h = r + 36, g = h + m;
  if (g + 8 > a)
    return null;
  const x = Mn(e, g);
  if (!x)
    return null;
  const T = vn(e, g, x);
  if (!T)
    return null;
  const P = m > 0 && h + m <= a ? new TextDecoder("utf-16le").decode(e.subarray(h, h + Math.max(0, m - 2))).replace(/\0+$/g, "") : "";
  return {
    ...T,
    meta: {
      ...T.meta || {},
      fbseBlipType: o || i,
      fbseMime: Sa(o || i),
      fbseTag: l,
      fbseSize: c,
      fbseRefCount: f,
      fbseDelayOffset: u,
      fbseName: P
    }
  };
}
function vn(e, t, n) {
  const r = t + 8, s = ((n.recInstance & 1) === 1 ? 2 : 1) * 16, o = e.subarray(r, r + n.recLen);
  if (n.recType === Dt || n.recType === _t || n.recType === Wt || n.recType === $t || n.recType === Nt) {
    const i = s + 1;
    if (o.length < i)
      return null;
    let l = "application/octet-stream", c = o.subarray(i);
    if (n.recType === Dt)
      l = "image/png";
    else if (n.recType === _t || n.recType === Wt)
      l = "image/jpeg";
    else if (n.recType === Nt)
      l = "image/tiff";
    else if (n.recType === $t) {
      const f = uo(c);
      f ? (c = f, l = "image/bmp") : l = "image/dib";
    }
    return {
      mime: l,
      bytes: c,
      displayable: Re(l),
      kind: "officeArt",
      meta: { recType: n.recType, recInstance: n.recInstance }
    };
  }
  if (n.recType === Lt || n.recType === Ft || n.recType === qa) {
    const i = s + 34;
    if (o.length < i)
      return null;
    const l = new M(o), c = l.u32(s), f = l.u32(s + 28), u = o[s + 32] ?? 255, m = o[s + 33] ?? 255, h = o.subarray(i);
    let g = h, x = !1, T = u !== 254;
    if (u === 0) {
      const R = ua(h, c || void 0);
      R && (g = R, x = !0, T = !1);
    }
    const P = n.recType === Lt ? "image/emf" : n.recType === Ft ? "image/wmf" : "image/pict";
    return {
      mime: P,
      bytes: g,
      displayable: Re(P),
      kind: "officeArt",
      meta: {
        recType: n.recType,
        recInstance: n.recInstance,
        metafileUncompressedSize: c,
        metafileCompressedSize: f,
        metafileCompression: u,
        metafileFilter: m,
        metafileCompressed: T,
        metafileDecompressed: x,
        metafileOriginalByteLength: h.length,
        fbseSize: f
      }
    };
  }
  return null;
}
function Rn(e, t, n, r) {
  let a = t;
  for (; a + 8 <= n; ) {
    const s = Mn(e, a);
    if (!s)
      break;
    const o = a + s.size;
    if (o > n)
      break;
    if (s.recVer === Za)
      Rn(e, a + 8, o, r);
    else if (s.recType === Ja) {
      const i = fo(e, a, s);
      i && r.push(i);
    } else {
      const i = vn(e, a, s);
      i && r.push(i);
    }
    a = o;
  }
}
function po(e, t) {
  if (t < 0 || t + 8 > e.length)
    return [];
  const n = [];
  return Rn(e, t, e.length, n), n;
}
function zt(e) {
  switch (e.mime) {
    case "image/png":
      return 100;
    case "image/jpeg":
      return 90;
    case "image/gif":
      return 80;
    case "image/bmp":
      return 70;
    case "image/tiff":
      return 60;
    case "image/svg+xml":
      return 50;
    case "image/emf":
      return 40;
    case "image/wmf":
      return 30;
    case "image/pict":
      return 20;
    default:
      return 0;
  }
}
function mo(e) {
  let t = null;
  for (const n of e)
    (!t || zt(n) > zt(t)) && (t = n);
  return t;
}
function jt(e) {
  if (!/^(?:image\/emf|image\/wmf)$/i.test(e.mime) || !e.bytes.length || e.meta?.metafileCompressed)
    return e;
  const t = Xa(e.mime, e.bytes);
  return t ? {
    ...e,
    mime: t.mime,
    bytes: t.bytes,
    displayable: !0,
    meta: {
      ...e.meta || {},
      vectorConverted: !0,
      vectorSourceMime: t.sourceMime,
      vectorWidth: t.width,
      vectorHeight: t.height,
      vectorRecordCount: t.recordCount
    }
  } : e;
}
function Yt(e, t, n, r, a) {
  const s = e.sourceUrl, o = s ? Sn(s) : !1, i = {
    pictureOffset: t,
    lcb: n.lcb,
    cbHeader: n.cbHeader,
    mm: n.mm,
    xExt: n.xExt,
    yExt: n.yExt,
    dxaGoalTwips: n.dxaGoalTwips,
    dyaGoalTwips: n.dyaGoalTwips,
    scaleXPermille: n.scaleXPermille,
    scaleYPermille: n.scaleYPermille,
    displayWidthTwips: n.displayWidthTwips,
    displayHeightTwips: n.displayHeightTwips,
    linkedPath: r,
    sourceKind: e.kind === "officeArt" ? "embedded" : e.kind,
    localExternal: o,
    browserRenderable: e.displayable,
    blipIndex: a?.blipIndex,
    sourceShapeId: a?.shapeId,
    ...e.meta || {}
  };
  return {
    id: Z("asset-img"),
    type: "image",
    mime: e.mime,
    bytes: e.bytes,
    dataUrl: s ? "" : de(e.bytes, e.mime),
    sourceUrl: s,
    displayable: e.displayable && !o,
    meta: i
  };
}
function ho(e, t, n = {}) {
  if (!e || t == null || t < 0 || t + ve > e.length)
    return null;
  const a = new M(e).i32(t), s = a > 0 && t + a <= e.length ? a : Math.min(e.length - t, n.maxPictureBytes || Va), o = e.subarray(t, t + s), i = io(o);
  if (!i)
    return null;
  let l = Math.min(i.cbHeader || ve, o.length);
  const c = co(o, i), f = c?.value;
  c && (l = c.nextOffset);
  const u = va(o, l), m = po(o, l), h = mo(m);
  if (h)
    return Yt(jt(h), t, i, f, u);
  if (f) {
    const v = to(f) || "application/octet-stream", O = Sn(f), _ = {
      mime: v,
      bytes: new Uint8Array(0),
      sourceUrl: f,
      displayable: Re(v) && !O,
      kind: "linked",
      meta: { linkedPath: f }
    };
    return Yt(_, t, i, f, u);
  }
  const g = Math.min(i.cbHeader || ve, o.length), x = no(o.subarray(g));
  if (!x)
    return {
      id: Z("asset-img"),
      type: "image",
      mime: "application/octet-stream",
      bytes: o,
      dataUrl: de(o, "application/octet-stream"),
      displayable: !1,
      meta: {
        pictureOffset: t,
        lcb: i.lcb,
        cbHeader: i.cbHeader,
        mm: i.mm,
        xExt: i.xExt,
        yExt: i.yExt,
        dxaGoalTwips: i.dxaGoalTwips,
        dyaGoalTwips: i.dyaGoalTwips,
        scaleXPermille: i.scaleXPermille,
        scaleYPermille: i.scaleYPermille,
        displayWidthTwips: i.displayWidthTwips,
        displayHeightTwips: i.displayHeightTwips,
        sourceKind: "fallback",
        browserRenderable: !1,
        blipIndex: u?.blipIndex,
        sourceShapeId: u?.shapeId
      }
    };
  const T = g + x.start, P = Math.min(g + x.end, o.length), R = o.subarray(T, P), E = jt({
    mime: x.mime,
    bytes: R,
    displayable: Re(x.mime),
    kind: "fallback",
    meta: {
      pictureOffset: t,
      lcb: i.lcb,
      cbHeader: i.cbHeader,
      mm: i.mm,
      xExt: i.xExt,
      yExt: i.yExt,
      dxaGoalTwips: i.dxaGoalTwips,
      dyaGoalTwips: i.dyaGoalTwips,
      scaleXPermille: i.scaleXPermille,
      scaleYPermille: i.scaleYPermille,
      displayWidthTwips: i.displayWidthTwips,
      displayHeightTwips: i.displayHeightTwips,
      sourceKind: "fallback",
      browserRenderable: Re(x.mime)
    }
  });
  return {
    id: Z("asset-img"),
    type: "image",
    mime: E.mime,
    bytes: E.bytes,
    dataUrl: de(E.bytes, E.mime),
    displayable: E.displayable,
    meta: {
      pictureOffset: t,
      lcb: i.lcb,
      cbHeader: i.cbHeader,
      mm: i.mm,
      xExt: i.xExt,
      yExt: i.yExt,
      dxaGoalTwips: i.dxaGoalTwips,
      dyaGoalTwips: i.dyaGoalTwips,
      scaleXPermille: i.scaleXPermille,
      scaleYPermille: i.scaleYPermille,
      displayWidthTwips: i.displayWidthTwips,
      displayHeightTwips: i.displayHeightTwips,
      sourceKind: "fallback",
      browserRenderable: !!E.displayable,
      blipIndex: u?.blipIndex,
      sourceShapeId: u?.shapeId,
      ...E.meta || {}
    }
  };
}
function tt(e, t) {
  let n = t;
  for (; n < e.length && e[n] !== 0; )
    n += 1;
  return { value: new TextDecoder("windows-1252").decode(e.subarray(t, n)), nextOffset: n + 1 };
}
function go(e) {
  const t = new M(e), n = [4, 6];
  for (const r of n)
    try {
      let a = r;
      const s = tt(e, a);
      a = s.nextOffset;
      const o = tt(e, a);
      a = o.nextOffset;
      const i = tt(e, a);
      if (a = i.nextOffset, a + 4 > e.length)
        continue;
      const l = t.u32(a);
      if (a += 4, l > 0 && a + l <= e.length) {
        const c = e.subarray(a, a + l);
        return { label: s.value, originalPath: o.value, tempPath: i.value, dataSize: l, bytes: c };
      }
    } catch {
    }
  return null;
}
function xo(e, t) {
  const n = e.listChildren(t).filter((l) => l.objectType === 2 || l.objectType === 5), r = new Map(n.map((l) => [l.name.toLowerCase(), l])), a = r.get("objinfo") || r.get("objinfo") || r.get("objinfo"), s = r.get("ole10native") || r.get("ole10native") || r.get("ole10native"), o = r.get("package") || r.get("contents") || r.get("content"), i = { entry: t, streams: n, displayName: t.name, attachment: null, objectData: null };
  if (s) {
    const l = e.getStream(s) || new Uint8Array(0), c = go(l);
    if (c) {
      const f = c.label || c.originalPath.split(/[\\/]/).pop() || `${t.name}.bin`, u = Ht(f), m = { ...c, sourceKind: "ole10-native" }, h = {
        id: Z("asset-ole"),
        type: "attachment",
        name: f,
        mime: u,
        bytes: c.bytes,
        dataUrl: de(c.bytes, u),
        meta: m
      };
      return i.attachment = h, i;
    }
  }
  if (o) {
    const l = e.getStream(o) || new Uint8Array(0), c = `${en(t.name)}.bin`, f = Ht(c), u = {
      id: Z("asset-pkg"),
      type: "attachment",
      name: c,
      mime: f,
      bytes: l,
      dataUrl: de(l, f),
      meta: { stream: o.name, sourceKind: "package" }
    };
    i.attachment = u;
  }
  return a && (i.objectData = e.getStream(a) || new Uint8Array(0)), i;
}
function bo(e) {
  const t = e.getEntry("/ObjectPool");
  if (!t)
    return /* @__PURE__ */ new Map();
  const n = e.listChildren(t).filter((a) => a.objectType === 1), r = /* @__PURE__ */ new Map();
  for (const a of n)
    r.set(a.name, xo(e, a));
  return r;
}
const To = /* @__PURE__ */ new Set([
  "insertCells",
  "deleteCells",
  "columnWidth",
  "merge",
  "split",
  "textFlow",
  "vertMerge",
  "vertAlign",
  "setShading",
  "defaultShading",
  "setBorder",
  "cellPadding",
  "cellSpacing",
  "cellWidth",
  "fitText",
  "cellNoWrap"
]);
function he(...e) {
  const t = /* @__PURE__ */ new Map();
  let n = 0;
  for (const r of e)
    for (const a of r || []) {
      const s = a.kind === "table" && To.has(a.name);
      t.set(s ? `${a.kind}:${a.name}:${n++}` : `${a.kind}:${a.name}`, a);
    }
  return Array.from(t.values());
}
function Eo(e) {
  const t = { para: [], char: [], table: [] };
  for (const n of e || [])
    n.kind === "para" ? t.para.push(n) : n.kind === "char" ? t.char.push(n) : n.kind === "table" && t.table.push(n);
  return t;
}
function wo(e, t) {
  const n = new M(e), r = n.u16(t), a = t + 2, s = r * 2, o = n.utf16le(a, s), i = a + s + 2;
  return { value: o.replace(/\u0000+$/, ""), nextOffset: i };
}
function yo(e, t) {
  const n = new M(e), r = n.u16(t), a = n.u16(t + 2), s = n.u16(t + 4);
  return {
    sti: r & 4095,
    flags1: r >> 12,
    stk: a & 15,
    istdBase: a >> 4 & 4095,
    cupx: s & 15,
    istdNext: s >> 4 & 4095,
    bchUpe: n.u16(t + 6),
    grfstd: n.u16(t + 8)
  };
}
function Gt(e, t) {
  const r = new M(e).u16(t), a = t + 2, s = a + r, o = e.subarray(a, Math.min(s, e.length));
  let i = 0, l = [];
  return o.length >= 2 && (i = o[0] | (o[1] ?? 0) << 8, l = xe(o, 2, o.length)), { cbUpx: r, styleId: i, properties: l, nextOffset: Be(s) };
}
function nt(e, t) {
  const r = new M(e).u16(t), a = t + 2, s = a + r, o = e.subarray(a, Math.min(s, e.length)), i = xe(o, 0, o.length);
  return { cbUpx: r, properties: i, nextOffset: Be(s) };
}
function Po(e, t) {
  const r = new M(e).u16(t), a = t + 2, s = a + r, o = e.subarray(a, Math.min(s, e.length)), i = xe(o, 0, o.length);
  return { cbUpx: r, properties: i, nextOffset: Be(s) };
}
function So(e, t, n) {
  if (!e.length)
    return {
      istd: n,
      empty: !0,
      name: "",
      stdfBase: { istdBase: 4095, istdNext: 0, stk: 1, cupx: 0 },
      paraProps: [],
      charProps: [],
      tableProps: []
    };
  const r = Math.max(10, Math.min(t || 10, e.length)), a = yo(e, 0);
  let s = r;
  const o = wo(e, s);
  s = o.nextOffset;
  let i = [], l = [], c = [];
  try {
    if (a.stk === 1) {
      if (a.cupx >= 1 && s + 2 <= e.length) {
        const f = Gt(e, s);
        i = f.properties, s = f.nextOffset;
      }
      a.cupx >= 2 && s + 2 <= e.length && (l = nt(e, s).properties);
    } else if (a.stk === 2)
      s + 2 <= e.length && (l = nt(e, s).properties);
    else if (a.stk === 3) {
      if (a.cupx >= 1 && s + 2 <= e.length) {
        const f = Po(e, s);
        c = f.properties, s = f.nextOffset;
      }
      if (a.cupx >= 2 && s + 2 <= e.length) {
        const f = Gt(e, s);
        i = f.properties, s = f.nextOffset;
      }
      a.cupx >= 3 && s + 2 <= e.length && (l = nt(e, s).properties);
    }
  } catch {
  }
  return {
    istd: n,
    name: o.value,
    stdfBase: a,
    paraProps: i,
    charProps: l,
    tableProps: c,
    empty: !1
  };
}
function Mo(e, t) {
  const n = t.fcStshf, r = t.lcbStshf;
  if (n == null || r == null || r <= 0)
    return { styles: /* @__PURE__ */ new Map(), header: null, resolveStyle(T) {
      return ut(/* @__PURE__ */ new Map(), T);
    } };
  const a = e.subarray(n, n + r), s = new M(a), o = s.u16(0), i = 2, l = s.u16(i + 0), c = s.u16(i + 2), f = s.u16(i + 10), u = s.u16(i + 12), m = s.u16(i + 14), h = { cbStshi: o, cstd: l, cbSTDBaseInFile: c, ftcAsci: f, ftcFE: u, ftcOther: m };
  let g = 2 + o;
  const x = /* @__PURE__ */ new Map();
  for (let T = 0; T < l && g + 2 <= a.length; T += 1) {
    const P = s.u16(g), R = g + 2, E = R + P;
    if (P === 0) {
      x.set(T, {
        istd: T,
        empty: !0,
        name: "",
        stdfBase: { istdBase: 4095, istdNext: 0, stk: 1, cupx: 0 },
        paraProps: [],
        charProps: [],
        tableProps: []
      }), g = Be(E);
      continue;
    }
    const v = a.subarray(R, Math.min(E, a.length)), O = So(v, c, T);
    x.set(T, O), g = Be(E);
  }
  return {
    header: h,
    styles: x,
    resolveStyle(T) {
      return ut(x, T);
    }
  };
}
function ut(e, t, n = /* @__PURE__ */ new Set()) {
  if (t == null || t === 4095 || n.has(t))
    return { paraProps: [], charProps: [], tableProps: [], styleIds: [] };
  const r = e.get(t);
  if (!r || r.empty)
    return { paraProps: [], charProps: [], tableProps: [], styleIds: [] };
  n.add(t);
  const a = ut(e, r.stdfBase?.istdBase, n);
  return {
    styleIds: [...a.styleIds, t],
    paraProps: he(a.paraProps, r.paraProps),
    charProps: he(a.charProps, r.charProps),
    tableProps: he(a.tableProps, r.tableProps)
  };
}
function vo(e, t, n, r) {
  let a = r?.index || 0;
  for (; a < e.length && e[a].cpEnd <= t; )
    a += 1;
  r && (r.index = a);
  const s = [];
  let o = a;
  for (; o < e.length && e[o].cpStart < n; )
    e[o].cpEnd > t && s.push(e[o]), o += 1;
  return s;
}
function Ro(e) {
  return String(e || "").trim();
}
function Xt(e) {
  const t = String(e || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t)
    return null;
  const n = t.toUpperCase();
  if (n.startsWith("HYPERLINK")) {
    const r = t.slice(9).trim(), s = r.match(/"([^"]+)"/)?.[1] || r.split(/\s+/)[0] || "";
    return s ? { type: "hyperlink", href: s } : null;
  }
  if (n.startsWith("INCLUDEPICTURE")) {
    const r = t.slice(14).trim();
    return { type: "includePicture", target: r.match(/"([^"]+)"/)?.[1] || r.split(/\s+/)[0] || "" };
  }
  return n.startsWith("EMBED") ? { type: "embed", raw: t } : n.startsWith("LINK") ? { type: "link", raw: t } : { type: "unknown", raw: t };
}
function Bo(e, t) {
  if (!t.text)
    return;
  const n = e[e.length - 1];
  if (n && n.type === "text" && n.href === t.href && tn(n.style, t.style)) {
    n.text += t.text;
    return;
  }
  e.push(t);
}
function ue(e, t, n) {
  if (!n)
    return;
  const r = e.length ? e[e.length - 1].nodes : t;
  n.type === "text" ? Bo(r, n) : r.push(n);
}
function Co(e, t) {
  const n = [
    `_${t}`,
    `_${String(t)}`,
    `_${t.toString(16)}`,
    `_${t.toString(16).toUpperCase()}`
  ];
  for (const r of n)
    if (e.has(r))
      return e.get(r) || null;
  return null;
}
function Oo(e, t, n, r, a, s = {}) {
  return function(i) {
    const l = i?.pictureOffset;
    if (l == null)
      return null;
    if (a.has(l))
      return a.get(l) || null;
    let c = null;
    const f = Co(t, l);
    if ((i.ole2 || i.object || i.data) && f?.attachment && (c = f.attachment, r.add(f.entry.name)), !c && e?.length) {
      const u = ho(e, l, s);
      u && u.mime !== "application/octet-stream" ? c = u : !c && f?.attachment ? (c = f.attachment, r.add(f.entry.name)) : u && (c = u);
    }
    return !c && f?.attachment && (c = f.attachment, r.add(f.entry.name)), c && n.push(c), a.set(l, c), c;
  };
}
function Io(e) {
  switch (e) {
    case U.nonBreakingHyphen:
      return "-";
    case U.nonRequiredHyphen:
    case U.annotationRef:
    case U.textBoxPlaceholder:
      return "";
    default:
      return e;
  }
}
function Vt(e) {
  return e.replaceAll(U.textBoxPlaceholder, "");
}
function ko(e, t) {
  const n = [
    ["main", e.fibRgLw.ccpText],
    ["footnote", e.fibRgLw.ccpFtn],
    ["header", e.fibRgLw.ccpHdd],
    ["macro", e.fibRgLw.ccpMcr],
    ["annotation", e.fibRgLw.ccpAtn],
    ["endnote", e.fibRgLw.ccpEdn],
    ["textbox", e.fibRgLw.ccpTxbx],
    ["header-textbox", e.fibRgLw.ccpHdrTxbx]
  ];
  if (!n.some(([, o]) => o > 0))
    return [{ kind: "main", cpStart: 0, cpEnd: t }];
  const a = [];
  let s = 0;
  for (const [o, i] of n) {
    const l = Math.max(0, i || 0), c = Math.min(s, t);
    s += l;
    const f = Math.min(s, t);
    a.push({ kind: o, cpStart: c, cpEnd: f });
  }
  return a;
}
function Ao(e, t, n) {
  if (e.cpEnd <= e.cpStart)
    return [];
  const r = n.filter((a) => a.cpStart < e.cpEnd && a.cpEnd > e.cpStart);
  return r.length ? r.map((a) => {
    const s = Math.max(e.cpStart, a.cpStart), o = Math.min(e.cpEnd, a.cpEnd);
    return {
      cpStart: s,
      cpEnd: o,
      terminator: t[o - 1] || "",
      styleId: a.styleId,
      properties: a.properties,
      storyKind: e.kind
    };
  }).filter((a) => a.cpEnd > a.cpStart) : sr(t.slice(e.cpStart, e.cpEnd)).map((a) => ({
    ...a,
    cpStart: a.cpStart + e.cpStart,
    cpEnd: a.cpEnd + e.cpStart,
    styleId: 0,
    properties: [],
    storyKind: e.kind
  }));
}
function Lo(e, t) {
  const n = [], r = [];
  for (const a of e)
    if (!(!a.text || a.state.hidden))
      for (const s of a.text) {
        const o = Io(s);
        if (o === U.fieldStart) {
          r.push({ instruction: "", parsed: null, readingInstruction: !0, nodes: [] });
          continue;
        }
        if (o === U.fieldSeparator) {
          const l = r[r.length - 1];
          l && (l.parsed = Xt(l.instruction), l.readingInstruction = !1);
          continue;
        }
        if (o === U.fieldEnd) {
          const l = r.pop();
          if (!l)
            continue;
          let c = l.nodes;
          if (l.readingInstruction && (l.parsed = Xt(l.instruction)), l.parsed?.type === "hyperlink") {
            const f = l.parsed.href;
            c = c.map((u) => u.type === "lineBreak" || u.type === "pageBreak" ? u : { ...u, href: f });
          }
          for (const f of c)
            ue(r, n, f);
          continue;
        }
        const i = r[r.length - 1];
        if (i?.readingInstruction) {
          i.instruction += o;
          continue;
        }
        if (o === U.hardLineBreak) {
          ue(r, n, { type: "lineBreak" });
          continue;
        }
        if (o === U.pageBreak) {
          ue(r, n, { type: "pageBreak" });
          continue;
        }
        if (o === U.picture) {
          const l = t(a.state);
          l?.type === "image" ? ue(r, n, { type: "image", asset: l, style: a.state }) : l?.type === "attachment" && ue(r, n, { type: "attachment", asset: l, style: a.state });
          continue;
        }
        ue(r, n, {
          type: "text",
          text: Wn(o),
          style: a.state
        });
      }
  for (; r.length; ) {
    const a = r.pop();
    for (const s of a.nodes)
      ue(r, n, s);
  }
  return n;
}
function Fo(e, t, n, r, a, s, o, i = !1) {
  const l = vo(n, e.cpStart, e.cpEnd, o), c = /* @__PURE__ */ new Set([e.cpStart, e.cpEnd]);
  for (const m of l)
    c.add(Math.max(e.cpStart, m.cpStart)), c.add(Math.min(e.cpEnd, m.cpEnd));
  const f = Array.from(c).sort((m, h) => m - h), u = [];
  for (let m = 0; m < f.length - 1; m += 1) {
    const h = f[m], g = f[m + 1];
    if (g <= h)
      continue;
    const T = l.find((G) => G.cpStart <= h && G.cpEnd >= g)?.properties || [], P = Ne(T), R = P.charStyleId != null ? r.resolveStyle(P.charStyleId).charProps : [], E = he(a, R, T), v = Ne(E);
    i && v.colorIndex === 8 && (v.colorIndex = 1);
    const O = s(v.fontFamilyId);
    O && (v.fontFamily = O.name || O.altName || void 0);
    const _ = h - e.cpStart, $ = g - e.cpStart, Y = t.slice(_, $);
    if (!Y)
      continue;
    const I = u[u.length - 1];
    if (I && tn(I.state, v)) {
      I.text += Y, I.cpEnd = g;
      continue;
    }
    u.push({ cpStart: h, cpEnd: g, text: Y, state: v });
  }
  if (!u.length && t) {
    const m = Ne(a);
    i && m.colorIndex === 8 && (m.colorIndex = 1);
    const h = s(m.fontFamilyId);
    h && (m.fontFamily = h.name || h.altName || void 0), u.push({ cpStart: e.cpStart, cpEnd: e.cpEnd, text: t, state: m });
  }
  return u;
}
function _o(e, t, n, r, a, s, o) {
  const i = Eo(e.properties || []), l = e.styleId || i.para.find((v) => v.name === "styleId")?.value || 0, c = n.resolveStyle(l), f = he(c.paraProps, i.para), u = on(f), m = Ue(i.table), h = m.styleId != null ? n.resolveStyle(m.styleId).tableProps : [], g = he(h, i.table), x = Ue(g), T = c.charProps, R = Fo(e, t, a, n, T, (v) => r.byIndex(v), o, e.storyKind === "textbox" || e.storyKind === "header-textbox"), E = Lo(R, s);
  return {
    id: Z("para"),
    cpStart: e.cpStart,
    cpEnd: e.cpEnd,
    terminator: e.terminator || "",
    text: t,
    rawProperties: e.properties || [],
    styleId: l,
    styleName: Ro(n.styles.get(l)?.name),
    paraProps: f,
    paraState: u,
    tableProps: g,
    tableState: x,
    segments: R,
    inlines: E
  };
}
function Do(e) {
  for (const n of e) {
    n.cells.forEach((r, a) => {
      r.colIndex = a, r.colspan = 1, r.rowspan = 1, r.hidden = !1;
    });
    for (let r = 0; r < n.cells.length; r += 1) {
      const a = n.cells[r], s = a.meta?.merge || 0;
      if (s !== 1 && s > 1) {
        let o = r + 1;
        for (; o < n.cells.length && (n.cells[o].meta?.merge || 0) === 1; )
          n.cells[o].hidden = !0, a.colspan = (a.colspan || 1) + 1, o += 1;
        const i = n.cells[o - 1];
        if (a.meta && i?.meta && i !== a) {
          a.meta.rightBoundary = i.meta.rightBoundary, a.meta.leftBoundary != null && a.meta.rightBoundary != null && (a.meta.width = Math.max(0, a.meta.rightBoundary - a.meta.leftBoundary));
          const l = i.meta.borders?.right;
          l && (a.meta.borders = {
            ...a.meta.borders || {},
            right: l
          });
        }
      }
    }
  }
  for (let n = 0; n < e.length; n += 1) {
    const r = e[n];
    for (const a of r.cells) {
      if (a.hidden)
        continue;
      const s = a.meta?.vertMerge || 0;
      if (s !== 1 && s > 1) {
        let o = n + 1;
        for (; o < e.length; ) {
          let c = !0;
          for (let f = a.colIndex || 0; f < (a.colIndex || 0) + (a.colspan || 1); f += 1) {
            const u = e[o].cells[f];
            if (!u || (u.meta?.vertMerge || 0) !== 1) {
              c = !1;
              break;
            }
          }
          if (!c)
            break;
          for (let f = a.colIndex || 0; f < (a.colIndex || 0) + (a.colspan || 1); f += 1)
            e[o].cells[f].hidden = !0;
          a.rowspan = (a.rowspan || 1) + 1, o += 1;
        }
        const i = e[o - 1]?.cells[a.colIndex || 0], l = i?.meta?.borders?.bottom;
        a.meta && i?.meta && i !== a && l && (a.meta.borders = {
          ...a.meta.borders || {},
          bottom: l
        });
      }
    }
  }
  const t = Array.from(new Set(e.flatMap((n) => n.cells.flatMap((r) => {
    const a = r.meta?.leftBoundary, s = r.meta?.rightBoundary;
    return [a, s].filter((o) => o != null);
  })))).sort((n, r) => n - r);
  if (t.length > 1)
    for (const n of e)
      for (const r of n.cells) {
        if (!r.meta)
          continue;
        const a = t.indexOf(r.meta.leftBoundary ?? Number.NaN), s = t.indexOf(r.meta.rightBoundary ?? Number.NaN);
        a >= 0 && (r.colIndex = a), !r.hidden && a >= 0 && s > a && (r.colspan = s - a);
      }
}
function $o(e) {
  const t = (n, r) => Object.prototype.hasOwnProperty.call(n, r) && (() => {
    const a = n[r];
    return !!(a?.nil || a?.borderType);
  })();
  e.forEach((n, r) => {
    n.cells.forEach((a) => {
      if (a.hidden || !a.meta)
        return;
      const s = { ...a.meta.borders || {} }, o = n.state.borders || {}, i = a.colIndex || 0, l = i + (a.colspan || 1), c = r + (a.rowspan || 1), f = (u, m) => {
        !t(s, u) && m && (s[u] = m);
      };
      f("top", r === 0 ? o.top : o.horizontalInside), f("bottom", c >= e.length ? o.bottom : o.horizontalInside), f("left", i === 0 ? o.left : o.verticalInside), f("right", l >= n.cells.length ? o.right : o.verticalInside), a.meta.borders = s;
    });
  });
}
function ft(e) {
  return {
    type: "paragraph",
    id: e.id,
    styleId: e.styleId,
    styleName: e.styleName,
    paraState: e.paraState,
    inlines: e.inlines,
    text: e.text
  };
}
function Kt(e) {
  const t = pt(e.tableState);
  if (!t.length)
    return "";
  const n = e.tableState, r = (a) => {
    const s = n.borders?.[a];
    return `${s?.borderType ?? ""}:${s?.lineWidth ?? ""}:${s?.nil ? 1 : 0}`;
  };
  return [
    t[0]?.leftBoundary ?? "",
    t[t.length - 1]?.rightBoundary ?? "",
    n.alignment ?? "",
    n.leftIndent ?? "",
    n.gapHalf ?? "",
    n.rtl ? 1 : 0,
    r("top"),
    r("left"),
    r("bottom"),
    r("right"),
    r("horizontalInside"),
    r("verticalInside")
  ].join("|");
}
function No(e, t) {
  e.paraState.inTable = !0, e.paraState.itap = Math.max(t.paraState.itap || 1, e.paraState.itap || 0), e.tableState = t.tableState, e.tableProps = t.tableProps;
}
function Wo(e) {
  for (let t = 0; t < e.length; t += 1) {
    const n = e[t], r = pt(n.tableState).length;
    if (!n.paraState.tableRowEnd || !r)
      continue;
    n.paraState.inTable = !0, n.paraState.itap = Math.max(1, n.paraState.itap || 0);
    let a = r, s = t - 1;
    const o = [];
    for (; s >= 0 && a > 0; s -= 1) {
      const c = e[s];
      if (c.paraState.tableRowEnd || c.paraState.innerTableRowEnd)
        break;
      o.push(c), c.terminator === U.cellMark && (a -= 1);
    }
    if (a > 0)
      continue;
    let i = s;
    for (; i >= 0 && !e[i].paraState.tableRowEnd && !e[i].paraState.innerTableRowEnd && e[i].terminator !== U.cellMark; )
      i -= 1;
    const l = e[i];
    if (l?.paraState.tableRowEnd && Kt(l) === Kt(n))
      for (let c = i + 1; c < t; c += 1) {
        const f = e[c];
        o.includes(f) || o.push(f);
      }
    o.forEach((c) => No(c, n));
  }
}
function Ho(e) {
  const t = [];
  let n = { cells: [] }, r = [];
  for (const o of e)
    if (r.push(o), o.terminator === U.cellMark && (n.cells.push({
      id: Z("cell"),
      paragraphs: r.map(ft),
      meta: null
    }), r = [], o.paraState.tableRowEnd || o.paraState.innerTableRowEnd)) {
      const i = pt(o.tableState);
      for (; i.length && n.cells.length > i.length && n.cells[n.cells.length - 1].paragraphs.every((c) => !c.text && !(c.inlines || []).length); )
        n.cells.pop();
      n.cells.forEach((c, f) => {
        c.meta = i[f] || { index: f };
      });
      const l = i.length ? (i[i.length - 1].rightBoundary || 0) - (i[0].leftBoundary || 0) : 0;
      t.push({
        id: Z("row"),
        cells: n.cells,
        state: o.tableState,
        gridWidthTwips: l
      }), n = { cells: [] };
    }
  r.length && n.cells.push({ id: Z("cell"), paragraphs: r.map(ft), meta: null }), n.cells.length && t.push({ id: Z("row"), cells: n.cells, state: e[0]?.tableState || Ue([]), gridWidthTwips: 0 }), Do(t), $o(t);
  const a = t.find((o) => o.gridWidthTwips)?.gridWidthTwips || 0, s = Math.max(...e.map((o) => st(o.paraState)), 1);
  return {
    type: "table",
    id: Z("table"),
    depth: s,
    rows: t,
    state: t[0]?.state || Ue([]),
    gridWidthTwips: a
  };
}
function Uo(e) {
  const t = [];
  let n = 0;
  for (; n < e.length; ) {
    const r = e[n];
    if (st(r.paraState) <= 0) {
      t.push(ft(r)), n += 1;
      continue;
    }
    const s = [];
    for (; n < e.length && st(e[n].paraState) > 0; )
      s.push(e[n]), n += 1;
    t.push(Ho(s));
  }
  return t;
}
function zo(e, t = {}) {
  const n = [], r = Zn(e, t);
  n.push(...r.warnings || []);
  const a = r.getStream("/WordDocument");
  if (!a)
    throw new Error("Missing WordDocument stream");
  const s = Qr(a);
  if (s)
    return s.warnings.unshift(...r.warnings || []), s;
  const o = fr(a);
  if (o.base.wIdent !== 42476 && Pe(n, `Unexpected FIB identifier: 0x${o.base.wIdent.toString(16)}`), o.base.fEncrypted)
    throw new Error("Encrypted .doc files are not supported yet");
  const i = r.getStream(o.base.fWhichTblStm ? "/1Table" : "/0Table");
  if (!i)
    throw new Error("Missing table stream");
  const l = r.getStream("/Data") || new Uint8Array(0), c = tr(i, o.fibRgFcLcb), f = ar(a, c), u = f.join(""), m = ko(o, u.length), h = m.find((S) => S.kind === "main") || { kind: "main", cpStart: 0, cpEnd: u.length }, g = m.filter((S) => (S.kind === "textbox" || S.kind === "header-textbox") && Vt(u.slice(S.cpStart, S.cpEnd)).replace(/[\r\u0007]/g, "").trim().length > 0), x = Mo(i, o.fibRgFcLcb), T = Hr(i, o.fibRgFcLcb), P = Math.max(h.cpEnd, ...g.map((S) => S.cpEnd)), R = Ar(a, i, o, c).filter((S) => S.cpStart < P).map((S) => ({ ...S, cpEnd: Math.min(S.cpEnd, P) })), E = Lr(a, i, o, c, l).filter((S) => S.cpStart < P).map((S) => ({ ...S, cpEnd: Math.min(S.cpEnd, P) })), v = [h, ...g].flatMap((S) => Ao(S, u, E));
  g.length && Pe(n, "Recovered text from a legacy Word text-box story; text-box positioning is unavailable, so the content was linearized after the main story.", { code: "MSDOC_TEXTBOX_STORY_LINEARIZED", storyCount: g.length });
  const O = bo(r), _ = [], $ = /* @__PURE__ */ new Set(), I = Oo(l, O, _, $, /* @__PURE__ */ new Map(), t), G = { index: 0 }, q = v.flatMap((S) => {
    const be = or(a, c, f, S.cpStart, S.cpEnd), Te = S.terminator === U.paragraph || S.terminator === U.cellMark ? S.terminator : "", ke = Te && be.endsWith(Te) ? be.slice(0, -1) : be, w = Vt(ke), C = S.storyKind === "textbox" || S.storyKind === "header-textbox";
    return (ke.includes(U.textBoxPlaceholder) || C) && !w.trim() ? [] : [_o({ ...S, terminator: Te }, w, x, T, R, I, G)];
  });
  Wo(q);
  const j = Uo(q), le = Array.from(O.values()).filter((S) => S?.attachment && !$.has(S.entry.name)).map((S) => S.attachment);
  for (const S of le)
    _.push(S);
  return le.length && j.push({ type: "attachments", id: Z("attachments"), items: le }), {
    kind: "msdoc",
    version: 1,
    warnings: n,
    meta: {
      fib: {
        wIdent: o.base.wIdent,
        nFib: o.base.nFib,
        fWhichTblStm: o.base.fWhichTblStm,
        fComplex: o.base.fComplex,
        fEncrypted: o.base.fEncrypted,
        ccpText: o.fibRgLw.ccpText
      },
      counts: {
        paragraphs: q.length,
        blocks: j.length,
        assets: _.length,
        styles: x.styles.size,
        fonts: T.fonts.length
      }
    },
    fonts: T.fonts,
    styles: Array.from(x.styles.values()).map((S) => ({
      istd: S.istd,
      name: S.name,
      type: S.stdfBase?.stk,
      basedOn: S.stdfBase?.istdBase,
      next: S.stdfBase?.istdNext
    })),
    blocks: j,
    assets: _
  };
}
const Ce = {
  1: "#000000",
  2: "#0000ff",
  3: "#00ffff",
  4: "#00ff00",
  5: "#ff00ff",
  6: "#ff0000",
  7: "#ffff00",
  8: "#ffffff",
  9: "#000080",
  10: "#008080",
  11: "#008000",
  12: "#800080",
  13: "#800000",
  14: "#808000",
  15: "#808080",
  16: "#c0c0c0"
};
function Oe(e) {
  return Object.entries(e).filter(([, t]) => t != null && t !== "").map(([t, n]) => `${t}:${n}`).join(";");
}
function pe(e) {
  if (!e || e.nil)
    return null;
  const t = e.borderType;
  if (!t)
    return null;
  const n = Math.max(2, e.lineWidth || 0), r = t >= 64 ? n : n / 8, a = Math.max(1, Math.round(r * (96 / 72))), s = t === 3 ? "double" : t === 6 ? "dotted" : [7, 8, 9].includes(t) ? "dashed" : "solid", o = e.color, i = e.colorRef != null ? dt(e.colorRef) : Ce[o || 1] || "#000000";
  return `${a}px ${s} ${i}`;
}
function dt(e) {
  if (e == null || e >>> 24 === 255)
    return "#000000";
  const t = e & 255, n = e >>> 8 & 255, r = e >>> 16 & 255;
  return `#${[t, n, r].map((a) => a.toString(16).padStart(2, "0")).join("")}`;
}
const Zt = {
  2: 5,
  3: 10,
  4: 20,
  5: 25,
  6: 30,
  7: 40,
  8: 50,
  9: 60,
  10: 70,
  11: 75,
  12: 80,
  13: 90
};
function jo(e, t, n) {
  const r = (o, i) => Number.parseInt(o.slice(i, i + 2), 16), a = Math.max(0, Math.min(100, n)) / 100;
  return `#${[1, 3, 5].map((o) => Math.round(r(e, o) * a + r(t, o) * (1 - a))).map((o) => o.toString(16).padStart(2, "0")).join("")}`;
}
function Yo(e) {
  if (!e || e.nil || e.auto || e.pattern === 0)
    return {};
  const t = e.foregroundColorRef != null ? dt(e.foregroundColorRef) : Ce[e.foregroundColorIndex || 1] || "#000000", n = e.backgroundColorRef != null ? dt(e.backgroundColorRef) : Ce[e.backgroundColorIndex || 8] || "#ffffff";
  if (e.pattern === 1)
    return { "background-color": t };
  if (Zt[e.pattern] != null)
    return { "background-color": jo(t, n, Zt[e.pattern]) };
  const r = e.pattern === 14 || e.pattern === 20 ? `repeating-linear-gradient(0deg,${t} 0 1px,transparent 1px 4px)` : e.pattern === 15 || e.pattern === 21 ? `repeating-linear-gradient(90deg,${t} 0 1px,transparent 1px 4px)` : e.pattern === 16 || e.pattern === 22 ? `repeating-linear-gradient(45deg,${t} 0 1px,transparent 1px 5px)` : e.pattern === 17 || e.pattern === 23 ? `repeating-linear-gradient(-45deg,${t} 0 1px,transparent 1px 5px)` : null;
  return r ? { "background-color": n, "background-image": r } : { "background-color": n };
}
function Go(e) {
  const t = {
    "text-align": Ur(e.alignment)
  }, n = z(e.spacingBefore), r = z(e.spacingAfter), a = z(e.leftIndent), s = z(e.rightIndent), o = z(e.firstLineIndent);
  if (n && (t["margin-top"] = `${n}px`), r && (t["margin-bottom"] = `${r}px`), a && (t["margin-left"] = `${a}px`), s && (t["margin-right"] = `${s}px`), o && (t["text-indent"] = `${o}px`), e.lineSpacing) {
    const u = Math.abs(e.lineSpacing) / 240;
    u && (t["line-height"] = String(Math.max(1, u)));
  }
  e.keepLines && (t["break-inside"] = "avoid"), e.keepNext && (t["break-after"] = "avoid"), e.pageBreakBefore && (t["break-before"] = "page"), e.rtlPara && (t.direction = "rtl");
  const i = pe(e.borders?.top), l = pe(e.borders?.right), c = pe(e.borders?.bottom), f = pe(e.borders?.left);
  return i && (t["border-top"] = i), l && (t["border-inline-end"] = l), c && (t["border-bottom"] = c), f && (t["border-inline-start"] = f), t;
}
function Xo(e) {
  const t = zr(e);
  if (!e || t === "none")
    return {};
  const n = { "text-decoration-line": "underline" };
  return t === "double" || t === "wavy-double" ? n["text-decoration-style"] = "double" : t.includes("dot") || t === "dotted-heavy" ? n["text-decoration-style"] = "dotted" : t.includes("dash") ? n["text-decoration-style"] = "dashed" : t.includes("wave") || t.includes("wavy") ? n["text-decoration-style"] = "wavy" : n["text-decoration-style"] = "solid", n;
}
function Bn(e) {
  const t = {};
  (e.bold || e.boldBi) && (t["font-weight"] = "700"), (e.italic || e.italicBi) && (t["font-style"] = "italic"), (e.strike || e.doubleStrike) && (t["text-decoration-line"] = `${t["text-decoration-line"] ? `${t["text-decoration-line"]} ` : ""}line-through`), Object.assign(t, Xo(e.underline)), e.fontSizeHalfPoints && (t["font-size"] = `${e.fontSizeHalfPoints / 2}pt`), e.fontFamily && (t["font-family"] = `'${String(e.fontFamily).replace(/'/g, "\\'")}', sans-serif`), e.colorIndex && Ce[e.colorIndex] && (t.color = Ce[e.colorIndex]);
  const n = typeof e.highlight == "number" ? e.highlight : e.highlight?.index;
  return n && ot[n] && (t["background-color"] = ot[n]), e.smallCaps && (t["font-variant-caps"] = "small-caps"), e.caps && (t["text-transform"] = "uppercase"), e.scale && e.scale !== 100 && (t.display = "inline-block", t.transform = `scaleX(${e.scale / 100})`, t["transform-origin"] = "left center"), e.positionHalfPoints > 0 && (t["vertical-align"] = "super"), e.positionHalfPoints < 0 && (t["vertical-align"] = "sub"), e.outline && (t["text-shadow"] = "0 0 0.02em currentColor"), (e.shadow || e.emboss || e.imprint) && (t["text-shadow"] = t["text-shadow"] ? `${t["text-shadow"]}, 0.06em 0.06em 0.08em rgba(0,0,0,.25)` : "0.06em 0.06em 0.08em rgba(0,0,0,.25)"), e.rtl && (t.direction = "rtl"), t;
}
function Vo(e) {
  const t = F(e.text), n = Bn(e.style);
  n["white-space"] = "break-spaces";
  const r = Oe(n), a = `<span${r ? ` style="${r}"` : ""}>${t}</span>`;
  return e.href ? `<a class="msdoc-link" href="${F(e.href)}" target="_blank" rel="noreferrer noopener">${a}</a>` : a;
}
function Cn(e) {
  const t = z(e.meta?.displayWidthTwips), n = z(e.meta?.displayHeightTwips);
  return {
    widthPx: t && t > 0 ? t : void 0,
    heightPx: n && n > 0 ? n : void 0
  };
}
function Ko(e, t) {
  const { widthPx: n, heightPx: r } = Cn(t);
  !n && !r || (n && (e.width = `${n}px`), r && (e.height = `${r}px`));
}
function Jt(e) {
  const t = String(e || "").trim();
  return t && (/^data:image\//i.test(t) || /^(?:https?:|blob:)/i.test(t)) ? t : null;
}
function qt(e) {
  const t = String(e || "").trim();
  return t && /^(?:data:|blob:|https?:)/i.test(t) ? t : null;
}
function Zo(e) {
  const t = Jt(e.asset.sourceUrl) || Jt(e.asset.dataUrl), n = Bn(e.style), r = Cn(e.asset);
  if (r.widthPx || r.heightPx ? (Ko(n, e.asset), n["max-width"] = "none", r.heightPx || (n.height = "auto")) : (n["max-width"] = "100%", n.height = "auto"), !t || e.asset.displayable === !1) {
    const s = qt(e.asset.dataUrl) || qt(e.asset.sourceUrl), o = F(String(e.asset.meta?.linkedPath || e.asset.mime || "image")), i = s ? `<a class="msdoc-attachment msdoc-image-fallback" href="${F(s)}" target="_blank" rel="noreferrer noopener">🖼 ${o}</a>` : `<span class="msdoc-image-fallback">🖼 ${o}</span>`;
    return e.href ? `<a class="msdoc-link" href="${F(e.href)}" target="_blank" rel="noreferrer noopener">${i}</a>` : i;
  }
  const a = `<img class="msdoc-image" src="${F(t)}" alt="" style="${Oe(n)}">`;
  return e.href ? `<a class="msdoc-link" href="${F(e.href)}" target="_blank" rel="noreferrer noopener">${a}</a>` : a;
}
function Jo(e) {
  const t = F(e.asset.name || "embedded-file"), n = `<a class="msdoc-attachment" href="${F(e.asset.dataUrl)}" download="${t}">📎 ${t}</a>`;
  return e.href ? `<a class="msdoc-link" href="${F(e.href)}" target="_blank" rel="noreferrer noopener">${n}</a>` : n;
}
function qo(e) {
  return e.map((t) => t.type === "text" ? Vo(t) : t.type === "image" ? Zo(t) : t.type === "attachment" ? Jo(t) : t.type === "lineBreak" ? "<br>" : t.type === "pageBreak" ? '<span class="msdoc-page-break"></span>' : "").join("");
}
function On(e, t = {}) {
  const n = t.inline ? "div" : "p", r = Oe(Go(e.paraState)), s = qo(e.inlines || []) || "<br>", o = ["msdoc-paragraph"];
  return e.styleName && o.push(`msdoc-style-${en(e.styleName)}`), `<${n} class="${o.join(" ")}"${r ? ` style="${r}"` : ""}>${s}</${n}>`;
}
function Qo(e) {
  const t = {}, n = e.meta?.rightBoundary != null && e.meta?.leftBoundary != null ? e.meta.rightBoundary - e.meta.leftBoundary : e.meta?.width, r = z(n);
  r && (t.width = `${r}px`), e.meta?.noWrap && (t["white-space"] = "nowrap"), e.meta?.fitText && (t["text-align"] = "justify"), e.meta?.vertAlign != null && (t["vertical-align"] = jr(e.meta.vertAlign));
  const a = e.meta?.borders || {}, s = pe(a.all), o = (m) => Object.prototype.hasOwnProperty.call(a, m) ? pe(a[m]) : s, i = o("top"), l = o("right"), c = o("bottom"), f = o("left");
  i && (t["border-top"] = i), l && (t["border-inline-end"] = l), c && (t["border-bottom"] = c), f && (t["border-inline-start"] = f);
  const u = e.meta?.paddingTwips;
  return u?.top != null && (t["padding-top"] = `${z(u.top)}px`), u?.right != null && (t["padding-inline-end"] = `${z(u.right)}px`), u?.bottom != null && (t["padding-bottom"] = `${z(u.bottom)}px`), u?.left != null && (t["padding-inline-start"] = `${z(u.left)}px`), Object.assign(t, Yo(e.meta?.shading)), t;
}
function es(e) {
  const t = {}, n = z(e.gridWidthTwips || e.state?.tableWidth?.wWidth);
  n ? t.width = `${n}px` : t.width = "100%";
  const r = z(e.state?.leftIndent);
  r && (t["margin-inline-start"] = `${r}px`), e.state?.rtl && (t.direction = "rtl");
  const a = e.rows.flatMap((s) => s.cells).reduce((s, o) => {
    const i = o.meta?.spacingTwips;
    return i ? {
      horizontal: Math.max(s.horizontal, i.left || 0, i.right || 0),
      vertical: Math.max(s.vertical, i.top || 0, i.bottom || 0)
    } : s;
  }, { horizontal: 0, vertical: 0 });
  return a.horizontal || a.vertical ? (t["border-collapse"] = "separate", t["border-spacing"] = `${z(a.horizontal)}px ${z(a.vertical)}px`) : t["border-collapse"] = "collapse", t["table-layout"] = "fixed", t;
}
function ts(e) {
  const t = e.rows.map((n) => {
    const r = n.state?.rowHeight ? z(Math.abs(n.state.rowHeight)) : null, a = r ? ` style="height:${r}px"` : "", s = n.cells.filter((o) => !o.hidden).map((o) => {
      const i = [];
      (o.colspan ?? 1) > 1 && i.push(` colspan="${o.colspan}"`), (o.rowspan ?? 1) > 1 && i.push(` rowspan="${o.rowspan}"`);
      const l = Oe(Qo(o)), c = o.paragraphs.map((f) => On(f, { inline: !0 })).join("");
      return `<td class="msdoc-cell"${i.join("")}${l ? ` style="${l}"` : ""}>${c || '<div class="msdoc-paragraph"><br></div>'}</td>`;
    }).join("");
    return `<tr class="msdoc-row"${a}>${s}</tr>`;
  }).join("");
  return `<table class="msdoc-table msdoc-table-depth-${e.depth}" style="${Oe(es(e))}"><tbody>${t}</tbody></table>`;
}
function ns(e) {
  return `<section class="msdoc-attachments"><div class="msdoc-attachments-title">Embedded attachments</div><ul>${e.items.map((n) => `<li><a class="msdoc-attachment" href="${F(n.dataUrl)}" download="${F(n.name || "embedded-file")}">📎 ${F(n.name || "embedded-file")}</a></li>`).join("")}</ul></section>`;
}
function In() {
  return `
.msdoc-root{box-sizing:border-box;max-width:100%;padding:24px;background:#fff;color:#111;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.msdoc-root *{box-sizing:border-box}
.msdoc-paragraph{margin:0 0 8px;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
.msdoc-paragraph:last-child{margin-bottom:0}
.msdoc-table{margin:12px 0;border-collapse:collapse;border-spacing:0;max-width:100%}
.msdoc-cell{padding:6px 8px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}
.msdoc-link{color:#1a73e8;text-decoration:none}
.msdoc-link:hover{text-decoration:underline}
.msdoc-image{display:inline-block;vertical-align:middle}
.msdoc-image-fallback{display:inline-flex;align-items:center;gap:6px}
.msdoc-attachment{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;color:#0969da;text-decoration:none}
.msdoc-attachments{margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb}
.msdoc-attachments-title{font-weight:600;margin-bottom:8px}
.msdoc-page-break{display:block;height:0;border-top:1px dashed #cbd5e1;margin:16px 0}
`;
}
function rs(e, t = {}) {
  const n = t.css ?? In();
  return {
    html: e.blocks.map((a) => a.type === "paragraph" ? On(a) : a.type === "table" ? ts(a) : a.type === "attachments" ? ns(a) : "").join(""),
    css: n,
    warnings: e.warnings || [],
    meta: e.meta,
    assets: e.assets || [],
    parsed: e
  };
}
async function as(e) {
  if (e instanceof ArrayBuffer)
    return e;
  if (ArrayBuffer.isView(e)) {
    const t = new Uint8Array(e.byteLength);
    return t.set(new Uint8Array(e.buffer, e.byteOffset, e.byteLength)), t.buffer;
  }
  if (typeof Blob < "u" && e instanceof Blob)
    return await e.arrayBuffer();
  if (typeof e == "string") {
    const t = await fetch(e);
    if (!t.ok)
      throw new Error(`Failed to fetch document: ${t.status}`);
    return await t.arrayBuffer();
  }
  throw new TypeError("Unsupported input type");
}
async function os(e, t = {}) {
  const n = await as(e);
  if (t.workerClient)
    return t.workerClient.parseToHtml(n, {
      parseOptions: t.parseOptions || {},
      renderOptions: t.renderOptions || {}
    });
  const r = zo(n, t.parseOptions || {});
  return rs(r, t.renderOptions || {});
}
const kn = '<span class="msdoc-page-break"></span>', ss = '<p class="msdoc-paragraph"><br></p>', ee = {
  width: 794,
  height: 1123
}, ye = 0.24, $e = 3, Qt = 0.15, is = `
.msdoc-stage{
  box-sizing:border-box;
  min-height:100%;
  padding:32px 24px 48px;
  background:var(--file-viewer-render-surface-background,#ececec);
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:24px;
}
.msdoc-page{
  width:min(100%,794px);
  box-sizing:border-box;
}
.msdoc-page > .msdoc-root{
  box-sizing:border-box;
  width:100%;
  max-width:none;
  min-height:1123px;
  padding:clamp(24px,7%,96px) clamp(20px,6%,88px);
  background:#fff;
  border:1px solid #d9d9d9;
  box-shadow:0 1px 3px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.12);
  overflow-wrap:anywhere;
}
/* 表格不能沿用正文的 anywhere 断词，否则旧 DOC 的列宽和单元格内容会被过度压缩。 */
.msdoc-page .msdoc-table{
  display:table;
  width:auto;
  max-width:100%;
  table-layout:auto!important;
  border-collapse:collapse;
  border-spacing:0;
}
.msdoc-page .msdoc-table tbody,
.msdoc-page .msdoc-table tr{
  width:auto;
}
.msdoc-page .msdoc-cell{
  min-width:1.5em;
  padding:4px 6px;
  vertical-align:top;
  word-break:normal;
  overflow-wrap:normal;
  white-space:normal;
}
.msdoc-page .msdoc-cell .msdoc-paragraph{
  margin:0 0 4px;
  word-break:normal;
  overflow-wrap:break-word;
}
.msdoc-page .msdoc-cell .msdoc-paragraph:last-child{
  margin-bottom:0;
}
.msdoc-page .msdoc-cell span{
  white-space:normal!important;
}
.msdoc-page .msdoc-page-break{
  display:none;
}
[data-viewer-theme='dark'] .msdoc-stage{
  background:var(--file-viewer-render-surface-background,#111827);
}
[data-viewer-theme='dark'] .msdoc-page > .msdoc-root{
  color-scheme:dark;
  background:#161b22;
  border-color:rgba(139,148,158,.24);
  color:#e6edf3;
  box-shadow:0 18px 44px rgba(0,0,0,.36);
}
[data-viewer-theme='dark'] .msdoc-page > .msdoc-root span[style*='color:#000000']{
  color:#e6edf3!important;
}
[data-viewer-theme='dark'] .msdoc-page .msdoc-link{
  color:#58a6ff;
}
[data-viewer-theme='dark'] .msdoc-page .msdoc-attachment{
  border-color:rgba(139,148,158,.3);
  background:#21262d;
  color:#58a6ff;
}
@media (prefers-color-scheme:dark){
  [data-viewer-theme='system'] .msdoc-stage{
    background:var(--file-viewer-render-surface-background,#111827);
  }
  [data-viewer-theme='system'] .msdoc-page > .msdoc-root{
    color-scheme:dark;
    background:#161b22;
    border-color:rgba(139,148,158,.24);
    color:#e6edf3;
    box-shadow:0 18px 44px rgba(0,0,0,.36);
  }
  [data-viewer-theme='system'] .msdoc-page > .msdoc-root span[style*='color:#000000']{
    color:#e6edf3!important;
  }
  [data-viewer-theme='system'] .msdoc-page .msdoc-link{
    color:#58a6ff;
  }
  [data-viewer-theme='system'] .msdoc-page .msdoc-attachment{
    border-color:rgba(139,148,158,.3);
    background:#21262d;
    color:#58a6ff;
  }
}
@media (max-width: 860px){
  .msdoc-stage{
    padding:16px 12px 24px;
    gap:16px;
  }
  .msdoc-page{
    width:100%;
  }
  .msdoc-page > .msdoc-root{
    min-height:auto;
    padding:24px 20px;
    box-shadow:none;
  }
}
`, cs = `
.msdoc-zoom-viewer{
  box-sizing:border-box;
  height:100%;
  overflow:auto;
  background:var(--file-viewer-render-surface-background,#ececec);
}
[data-viewer-theme='dark'] .msdoc-zoom-viewer{
  background:var(--file-viewer-render-surface-background,#111827);
}
@media (prefers-color-scheme:dark){
  [data-viewer-theme='system'] .msdoc-zoom-viewer{
    background:var(--file-viewer-render-surface-background,#111827);
  }
}
.msdoc-zoom-viewer .msdoc-stage{
  min-width:max-content;
}
.msdoc-zoom-viewer .msdoc-page{
  position:relative;
  max-width:none;
  overflow:visible;
}
.msdoc-zoom-viewer .msdoc-page > .msdoc-root{
  position:absolute;
  top:0;
  left:50%;
  width:${ee.width}px;
  max-width:none;
  margin:0;
  transform-origin:top center;
}
`, ls = (e) => e.ownerDocument.defaultView;
function us(e) {
  return e.replace(/<(p|table|section)([^>]*?)style="([^"]*?\bbreak-before\s*:\s*page;?[^"]*?)"([^>]*)>/gi, (t) => `${kn}${t}`);
}
function fs(e) {
  return `<div class="msdoc-stage">${us(e).split(kn).map((r) => `<section class="msdoc-page"><div class="msdoc-root">${r || ss}</div></section>`).join("")}</div>`;
}
function ds(e) {
  const t = e.cloneNode(!0);
  return t.classList.remove("msdoc-zoom-viewer"), t.querySelectorAll("style[data-msdoc-zoom]").forEach((n) => n.remove()), t.querySelectorAll(".msdoc-stage, .msdoc-page, .msdoc-root").forEach((n) => {
    n.style.height = "auto", n.style.maxHeight = "none", n.style.overflow = "visible", n.style.transform = "none";
  }), t.querySelectorAll(".msdoc-page").forEach((n, r) => {
    n.dataset.viewerPrintPageIndex = String(r), $n(n, ee, { heightMode: "min" }), n.style.position = "relative", n.style.width = Ke(ee.width), n.style.maxWidth = "none", n.style.margin = "0 auto 18px";
    const a = n.querySelector(".msdoc-root");
    a && (a.style.position = "relative", a.style.top = "auto", a.style.left = "auto", a.style.width = Ke(ee.width), a.style.maxWidth = "none", a.style.minHeight = Ke(ee.height), a.style.height = "auto", a.style.transform = "none", a.style.transformOrigin = "top left", a.style.boxShadow = "none", a.style.border = "0", a.style.overflow = "visible");
  }), t.innerHTML;
}
function ps() {
  return Dn({
    selector: ".viewer-export-content .msdoc-page",
    width: ee.width,
    height: ee.height,
    heightMode: "min"
  });
}
function ms(e) {
  const t = Array.from(e.querySelectorAll(".msdoc-page"));
  if (!t.length)
    return () => {
    };
  e.classList.add("msdoc-zoom-viewer");
  const n = ls(e), r = n?.ResizeObserver, a = e.ownerDocument.createElement("style");
  a.dataset.msdocZoom = "true", a.textContent = cs, e.prepend(a);
  const s = Fn();
  let o = 0, i = 1, l = 1, c = 1;
  const f = (E) => Math.min($e, Math.max(ye, Number(E.toFixed(2)))), u = () => {
    let E = l, v = c, O = !1;
    t.forEach((_) => {
      const $ = _.querySelector(".msdoc-root");
      if (!$)
        return;
      const Y = $.offsetWidth || ee.width, I = Math.max($.scrollHeight, $.offsetHeight, ee.height), G = Math.max(e.clientWidth - 48, 120), q = Math.min(1, Math.max(ye, G / Y)), j = f(q * i);
      O || (E = j, v = q, O = !0), $.style.transform = `translateX(-50%) scale(${j})`, _.style.width = `${Math.ceil(Math.max(Y * j, 120))}px`, _.style.height = `${Math.ceil(I * j)}px`;
    }), O && (l = E, c = v, s.emit());
  }, m = () => {
    if (!n) {
      u();
      return;
    }
    n.cancelAnimationFrame(o), o = n.requestAnimationFrame(() => {
      u();
    });
  }, h = () => ({
    scale: l,
    label: `${Math.round(l * 100)}%`,
    canZoomIn: l < $e,
    canZoomOut: l > ye,
    canReset: i !== 1,
    minScale: ye,
    maxScale: $e
  }), g = (E) => (i = Math.min(6, Math.max(0.2, Number(E.toFixed(2)))), n?.cancelAnimationFrame(o), u(), h()), x = (E) => g(E / Math.max(c, 0.01)), T = () => {
    var E;
    const v = (E = t[0]) === null || E === void 0 ? void 0 : E.querySelector(".msdoc-root");
    return {
      width: v?.offsetWidth || ee.width,
      height: ee.height
    };
  }, P = (E) => {
    var v, O;
    const _ = T(), $ = E.mode === "auto" ? "width" : E.mode, Y = _n({
      mode: $,
      viewportWidth: Math.max(1, E.viewportWidth || e.clientWidth || 0),
      viewportHeight: Math.max(1, E.viewportHeight || e.clientHeight || 0),
      contentWidth: _.width,
      contentHeight: _.height,
      minScale: (v = E.minScale) !== null && v !== void 0 ? v : ye,
      maxScale: (O = E.maxScale) !== null && O !== void 0 ? O : $e
    });
    if (!Y)
      return {
        applied: !1,
        mode: E.mode,
        resize: E.resize,
        source: E.source,
        reason: "unmeasurable",
        provider: "zoom"
      };
    const I = x(Y);
    return {
      applied: !0,
      mode: E.mode,
      resize: E.resize,
      scale: I.scale,
      source: E.source,
      provider: "zoom"
    };
  };
  e.dataset.viewerZoomProvider = "doc", An(e, {
    zoomIn: () => g((l + Qt) / Math.max(c, 0.01)),
    zoomOut: () => g((l - Qt) / Math.max(c, 0.01)),
    resetZoom: () => g(1),
    setZoom: x,
    fit: P,
    getState: h,
    subscribe: s.subscribe
  });
  const R = r ? new r(m) : null;
  return R?.observe(e), t.forEach((E) => {
    const v = E.querySelector(".msdoc-root");
    v && R?.observe(v);
  }), u(), () => {
    n?.cancelAnimationFrame(o), R?.disconnect(), Ln(e), a.remove(), e.classList.remove("msdoc-zoom-viewer");
  };
}
async function xs(e, t, n) {
  var r, a;
  const s = await os(e, {
    renderOptions: {
      css: `${In()}
${is}`
    }
  });
  t.innerHTML = `<style data-msdoc>${s.css}</style>${fs(s.html)}`;
  const o = ms(t);
  return (r = n?.registerExportAdapter) === null || r === void 0 || r.call(n, {
    includeDocumentStyles: !1,
    getPrintMaskPages: () => Array.from(t.querySelectorAll(".msdoc-page")),
    printStyle: ps,
    toHtml: () => ds(t)
  }), (a = n?.registerThumbnailAdapter) === null || a === void 0 || a.call(n, {
    getTarget: () => t.querySelector(".msdoc-page") || t
  }), {
    $el: t,
    unmount() {
      var i, l;
      (i = n?.registerExportAdapter) === null || i === void 0 || i.call(n, null), (l = n?.registerThumbnailAdapter) === null || l === void 0 || l.call(n, null), o(), t.innerHTML = "";
    }
  };
}
export {
  xs as default
};
