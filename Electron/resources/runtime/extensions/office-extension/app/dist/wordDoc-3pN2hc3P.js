import "./dist-BZCS2h0l.js";
import { d as e, i as t, m as n, r } from "./fit-OBfTsFJi.js";
import { n as i, r as a, t as o } from "./printLayout-Cc5MpfXo.js";
// ../../node_modules/@file-viewer/doc/dist/core/utils.js
var s = globalThis.Buffer, c = 0;
function l(e) {
	return String(e).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function u(e = "id") {
	return c += 1, `${e}-${c}`;
}
function d(e) {
	return e % 2 == 0 ? e : e + 1;
}
function f(e) {
	let t = e instanceof Uint8Array ? e : e instanceof ArrayBuffer ? new Uint8Array(e) : new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
	if (s) return s.from(t).toString("base64");
	let n = "", r = 32768;
	for (let e = 0; e < t.length; e += r) n += String.fromCharCode(...t.subarray(e, Math.min(e + r, t.length)));
	return btoa(n);
}
function p(e, t = "application/octet-stream") {
	return `data:${t};base64,${f(e)}`;
}
function m(e) {
	return String(e ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
function h(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	let n = Object.keys(e), r = Object.keys(t);
	if (n.length !== r.length) return !1;
	for (let r of n) if (e[r] !== t[r]) return !1;
	return !0;
}
function g(e, t, n) {
	let r = n ? {
		message: t,
		...n
	} : { message: t };
	return e.push(r), r;
}
function _(e, t = 96) {
	if (!(e == null || Number.isNaN(e))) return e / 1440 * t;
}
function v(e) {
	return String(e ?? "").replace(/\u000b/g, "\n").replace(/\u000c/g, "\n");
}
function y(e = "utf-8") {
	return new TextDecoder(e, { fatal: !1 });
}
// ../../node_modules/@file-viewer/doc/dist/core/binary.js
var b = y("utf-16le"), x = y(typeof TextDecoder < "u" ? "windows-1252" : "latin1"), S = class {
	bytes;
	view;
	length;
	constructor(e) {
		if (e instanceof Uint8Array) this.bytes = e;
		else if (e instanceof ArrayBuffer) this.bytes = new Uint8Array(e);
		else if (ArrayBuffer.isView(e)) this.bytes = new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
		else throw TypeError("BinaryReader expects ArrayBuffer or Uint8Array");
		this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength), this.length = this.bytes.byteLength;
	}
	ensure(e, t = 1) {
		return e >= 0 && e + t <= this.length;
	}
	u8(e) {
		return this.ensure(e, 1) ? this.view.getUint8(e) : 0;
	}
	i8(e) {
		return this.ensure(e, 1) ? this.view.getInt8(e) : 0;
	}
	u16(e) {
		return this.ensure(e, 2) ? this.view.getUint16(e, !0) : 0;
	}
	i16(e) {
		return this.ensure(e, 2) ? this.view.getInt16(e, !0) : 0;
	}
	u32(e) {
		return this.ensure(e, 4) ? this.view.getUint32(e, !0) : 0;
	}
	i32(e) {
		return this.ensure(e, 4) ? this.view.getInt32(e, !0) : 0;
	}
	u64(e) {
		let t = this.u32(e);
		return this.u32(e + 4) * 4294967296 + t;
	}
	slice(e, t) {
		return this.ensure(e, t) ? this.bytes.subarray(e, e + t) : /* @__PURE__ */ new Uint8Array();
	}
	array(e, t, n) {
		let r = [], i = n.byteWidth ?? 1;
		for (let a = 0; a < t; a += 1) r.push(n.call(this, e + a * i));
		return r;
	}
	utf16le(e, t) {
		return this.ensure(e, t) ? b.decode(this.slice(e, t)) : "";
	}
	latin1(e, t) {
		return this.ensure(e, t) ? x.decode(this.slice(e, t)) : "";
	}
	ascii(e, t) {
		if (!this.ensure(e, t)) return "";
		let n = "", r = this.slice(e, t);
		for (let e = 0; e < r.length; e += 1) n += String.fromCharCode(r[e] ?? 0);
		return n;
	}
	utf16z(e, t) {
		let n = this.slice(e, t), r = n.length;
		for (let e = 0; e + 1 < n.length; e += 2) if (n[e] === 0 && n[e + 1] === 0) {
			r = e;
			break;
		}
		return b.decode(n.subarray(0, r));
	}
};
S.prototype.u8.byteWidth = 1, S.prototype.i8.byteWidth = 1, S.prototype.u16.byteWidth = 2, S.prototype.i16.byteWidth = 2, S.prototype.u32.byteWidth = 4, S.prototype.i32.byteWidth = 4;
function ee(e) {
	if (e instanceof Uint8Array) return e;
	if (e instanceof ArrayBuffer) return new Uint8Array(e);
	if (ArrayBuffer.isView(e)) return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
	throw TypeError("Unsupported binary input");
}
// ../../node_modules/@file-viewer/doc/dist/core/cfb.js
var te = [
	208,
	207,
	17,
	224,
	161,
	177,
	26,
	225
], ne = 4294967295, C = 4294967294, w = 4294967293, re = 4294967292, T = 1 << 20, ie = 4096;
function ae(e) {
	return e === ne || e === C || e === w || e === re;
}
function oe(e, t, n) {
	let r = 512 + n * t, i = r + t;
	if (r < 0 || r >= e.length) throw Error(`Sector ${n} is out of bounds`);
	if (i <= e.length) return e.subarray(r, i);
	let a = new Uint8Array(t);
	return a.set(e.subarray(r)), a;
}
function se(e, t, n = T) {
	let r = [], i = /* @__PURE__ */ new Set(), a = e, o = 0;
	for (; a !== C && a !== ne && a >= 0;) {
		if (i.has(a)) throw Error(`Detected sector loop at ${a}`);
		if (i.add(a), r.push(a), a = t(a), o += 1, o > n) throw Error("Sector chain exceeds safe limit");
	}
	return r;
}
function ce(e, t, n, r, i = null) {
	if (n === C || n === ne || n < 0) return /* @__PURE__ */ new Uint8Array();
	let a = se(n, (e) => r[e] ?? C), o = new Uint8Array(a.length * t), s = 0;
	for (let n of a) o.set(oe(e, t, n), s), s += t;
	return i == null ? o : o.subarray(0, Math.min(i, o.length));
}
function le(e) {
	function t(n, r) {
		if (n < 0 || n >= e.length) return;
		let i = e[n];
		i && (t(i.leftSiblingId, r), r.push(n), t(i.rightSiblingId, r));
	}
	function n(r) {
		let i = e[r];
		if (!i || i.childId < 0) return;
		let a = [];
		t(i.childId, a), i.children = a;
		for (let t of a) {
			let i = e[t];
			i && (i.parentId = r, n(t));
		}
	}
	let r = e.find((e) => e.objectType === 5);
	if (!r) throw Error("CFB root storage not found");
	return n(r.id), r;
}
function ue(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		if (!n || !n.name) continue;
		let r = [], i = n;
		for (; i;) i.objectType !== 5 && r.push(i.name), i = i.parentId == null ? null : e[i.parentId] ?? null;
		let a = `/${r.reverse().join("/")}`;
		n.path = a === "/" ? `/${n.name}` : a, t.set(n.path, n);
	}
	return t;
}
function de(e) {
	return e.replace(/\u0000+$/, "");
}
function fe(e, t = {}) {
	let n = ee(e), r = new S(n), i = [];
	for (let e = 0; e < te.length; e += 1) if (r.u8(e) !== te[e]) throw Error("Not a Compound File Binary document");
	let a = r.u16(26), o = r.u16(30), s = r.u16(32), c = 1 << o, l = 1 << s, u = r.u32(40), d = r.u32(44), f = r.i32(48), p = r.u32(52), m = r.u32(56), h = r.i32(60), _ = r.u32(64), v = r.i32(68), y = r.u32(72);
	m !== ie && g(i, `Unexpected mini stream cutoff size ${m}`);
	let b = [];
	for (let e = 0; e < 109; e += 1) {
		let t = r.i32(76 + e * 4);
		!ae(t) && t >= 0 && b.push(t);
	}
	let x = [...b], w = v, re = 0;
	for (; w !== C && w !== ne && w >= 0;) {
		let e = new S(oe(n, c, w)), t = c / 4 - 1;
		for (let n = 0; n < t; n += 1) {
			let t = e.i32(n * 4);
			!ae(t) && t >= 0 && x.push(t);
		}
		if (w = e.i32(c - 4), re += 1, re > y + 4) {
			g(i, "DIFAT chain exceeded declared sector count; stopping early");
			break;
		}
	}
	d && x.length < d && g(i, `FAT sector count mismatch: header says ${d}, found ${x.length}`);
	let T = [];
	for (let e of x) {
		let t = new S(oe(n, c, e));
		for (let e = 0; e < c / 4; e += 1) T.push(t.i32(e * 4));
	}
	let fe = ce(n, c, f, T), E = new S(fe), D = [];
	for (let e = 0, t = 0; e + 128 <= fe.length; e += 128, t += 1) {
		let n = E.u16(e + 64), r = de(E.utf16le(e, Math.max(0, n - 2)));
		(r || E.u8(e + 66) !== 0) && D.push({
			id: t,
			name: r,
			objectType: E.u8(e + 66),
			colorFlag: E.u8(e + 67),
			leftSiblingId: E.i32(e + 68),
			rightSiblingId: E.i32(e + 72),
			childId: E.i32(e + 76),
			clsid: E.slice(e + 80, 16),
			stateBits: E.u32(e + 96),
			creationTime: E.u64(e + 100),
			modifiedTime: E.u64(e + 108),
			startSector: E.i32(e + 116),
			streamSize: a === 3 ? E.u32(e + 120) : E.u64(e + 120),
			children: [],
			parentId: null
		});
	}
	let pe = le(D), me = ue(D), he = [];
	if (_ && h >= 0) {
		let e = ce(n, c, h, T), t = new S(e);
		for (let n = 0; n + 4 <= e.length; n += 4) he.push(t.i32(n));
	}
	let ge = ce(n, c, pe.startSector, T, pe.streamSize);
	function _e(e) {
		if (e.startSector < 0) return /* @__PURE__ */ new Uint8Array();
		let t = se(e.startSector, (e) => he[e] ?? C), n = new Uint8Array(t.length * l), r = 0;
		for (let e of t) {
			let t = e * l, i = t + l;
			if (i > ge.length) throw Error(`Mini sector ${e} is out of bounds`);
			n.set(ge.subarray(t, i), r), r += l;
		}
		return n.subarray(0, Math.min(e.streamSize, n.length));
	}
	function ve(e) {
		let t = typeof e == "string" ? me.get(e) ?? null : e;
		return !t || t.objectType !== 2 && t.objectType !== 5 ? null : t.objectType === 5 ? ge : t.streamSize < m && t.startSector >= 0 && he.length ? _e(t) : ce(n, c, t.startSector, T, t.streamSize);
	}
	function ye(e) {
		let t = typeof e == "string" ? me.get(e) ?? null : e;
		return t ? (t.children || []).map((e) => D[e]).filter((e) => !!e) : [];
	}
	return {
		bytes: n,
		majorVersion: a,
		sectorSize: c,
		miniSectorSize: l,
		numDirSectors: u,
		numFatSectors: d,
		firstDirSector: f,
		transactionSignature: p,
		miniStreamCutoffSize: m,
		warnings: i,
		entries: D,
		root: pe,
		pathMap: me,
		getEntry(e) {
			return me.get(e) ?? null;
		},
		getStream: ve,
		listChildren: ye,
		findByName(e, t = "/") {
			let n = t === "/" ? pe : me.get(t) ?? null;
			if (!n) return null;
			let r = [n];
			for (; r.length;) {
				let t = r.pop();
				if (t) {
					if (t.name === e) return t;
					for (let e of t.children || []) {
						let t = D[e];
						t && r.push(t);
					}
				}
			}
			return null;
		}
	};
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/clx.js
var E = {
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
function D(e) {
	return e.replace(/[\x82-\x8C\x91-\x9C\x9F]/g, (e) => E[e] || e);
}
function pe(e) {
	let t = "";
	for (let n = 0; n < e.length; n += 1) t += String.fromCharCode(e[n] ?? 0);
	return D(t);
}
function me(e) {
	return new TextDecoder("utf-16le").decode(e);
}
function he(e, t) {
	let n = t.fcClx, r = t.lcbClx;
	if (n == null || r == null || r <= 0) throw Error("FIB does not point to a CLX structure");
	let i = e.subarray(n, n + r), a = new S(i), o = 0, s = [];
	for (; o < i.length && a.u8(o) === 1;) {
		let e = a.u16(o + 1);
		s.push({
			type: 1,
			cbGrpprl: e,
			bytes: a.slice(o + 3, e)
		}), o += 3 + e;
	}
	if (a.u8(o) !== 2) throw Error("CLX does not contain a Pcdt marker");
	let c = a.u32(o + 1);
	return {
		prcs: s,
		pcdt: {
			lcb: c,
			pieceTable: ge(a.slice(o + 5, c))
		}
	};
}
function ge(e) {
	if (!e.length) throw Error("Empty PlcPcd");
	let t = new S(e), n = (e.length - 4) / 12;
	if (!Number.isInteger(n) || n < 0) throw Error("Invalid PlcPcd size");
	let r = [];
	for (let e = 0; e < n + 1; e += 1) r.push(t.u32(e * 4));
	let i = [], a = (n + 1) * 4;
	for (let e = 0; e < n; e += 1) {
		let n = t.u16(a), o = t.u32(a + 2) >>> 0, s = t.u16(a + 6), c = !!(o & 1073741824), l = o & 1073741823, u = r[e] ?? 0, d = r[e + 1] ?? u, f = c ? Math.floor(l / 2) : l, p = c ? d - u : (d - u) * 2;
		i.push({
			index: e,
			descriptor: n,
			fNoParaLast: !!(n & 1),
			fRaw: !!(n & 2),
			prm: s,
			compressed: c,
			fcRaw: o,
			fc: l,
			cpStart: u,
			cpEnd: d,
			actualByteStart: f,
			byteLength: p,
			actualByteEnd: f + p
		}), a += 8;
	}
	return {
		cps: r,
		pieces: i
	};
}
function _e(e, t) {
	let n = e.subarray(t.actualByteStart, t.actualByteEnd);
	return t.compressed ? pe(n) : me(n);
}
function ve(e, t) {
	return t.pcdt.pieceTable.pieces.map((t) => _e(e, t));
}
function ye(e, t, n = null) {
	let r = e.pcdt.pieceTable.pieces, i = n ?? !!(t & 1073741824), a = n == null ? t & 1073741823 : t, o = i ? Math.floor(a / 2) : a;
	for (let e of r) {
		if (o < e.actualByteStart || o > e.actualByteEnd) continue;
		let t = o - e.actualByteStart, n = e.cpStart + Math.floor(t / (e.compressed ? 1 : 2));
		if (n >= e.cpStart && n <= e.cpEnd) return n;
	}
	for (let e of r) {
		if (t < e.actualByteStart || t > e.actualByteEnd) continue;
		let n = t - e.actualByteStart, r = e.cpStart + Math.floor(n / (e.compressed ? 1 : 2));
		if (r >= e.cpStart && r <= e.cpEnd) return r;
	}
	return null;
}
function be(e, t, n, r, i) {
	if (i <= r) return "";
	let a = [];
	for (let e = 0; e < t.pcdt.pieceTable.pieces.length; e += 1) {
		let o = t.pcdt.pieceTable.pieces[e];
		if (o.cpEnd <= r) continue;
		if (o.cpStart >= i) break;
		let s = Math.max(r, o.cpStart) - o.cpStart, c = Math.min(i, o.cpEnd) - o.cpStart;
		a.push((n[e] ?? "").slice(s, c));
	}
	return a.join("");
}
function xe(e) {
	let t = [], n = 0;
	for (let r = 0; r < e.length; r += 1) {
		let i = e[r];
		(i === "\r" || i === "\x07") && (t.push({
			cpStart: n,
			cpEnd: r + 1,
			terminator: i
		}), n = r + 1);
	}
	return n < e.length && t.push({
		cpStart: n,
		cpEnd: e.length,
		terminator: ""
	}), t;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/constants.js
var O = {
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
}, Se = {
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
}, Ce = {
	0: "left",
	1: "center",
	2: "right",
	3: "justify",
	4: "distributed"
}, we = {
	0: "top",
	1: "center",
	2: "bottom"
}, Te = {
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
}, Ee = /* @__PURE__ */ "StshfOrig.Stshf.PlcffndRef.PlcffndTxt.PlcfandRef.PlcfandTxt.PlcfSed.PlcPad.PlcfPhe.SttbfGlsy.PlcfGlsy.PlcfHdd.PlcfBteChpx.PlcfBtePapx.PlcfSea.SttbfFfn.PlcfFldMom.PlcfFldHdr.PlcfFldFtn.PlcfFldAtn.PlcfFldMcr.SttbfBkmk.PlcfBkf.PlcfBkl.Cmds.Unused1.SttbfMcr.PrDrvr.PrEnvPort.PrEnvLand.Wss.Dop.SttbfAssoc.Clx.PlcfPgdFtn.AutosaveSource.GrpXstAtnOwners.SttbfAtnBkmk.Unused2.Unused3.PlcSpaMom.PlcSpaHdr.PlcfAtnBkf.PlcfAtnBkl.Pms.FormFldSttbs.PlcfendRef.PlcfendTxt.PlcfFldEdn.Unused4.DggInfo.SttbfRMark.SttbfCaption.SttbfAutoCaption.PlcfWkb.PlcfSpl.PlcftxbxTxt.PlcfFldTxbx.PlcfHdrtxbxTxt.PlcffldHdrTxbx.StwUser.SttbTtmbd.CookieData.PgdMotherOldOld.BkdMotherOldOld.PgdFtnOldOld.BkdFtnOldOld.PgdEdnOldOld.BkdEdnOldOld.SttbfIntlFld.RouteSlip.SttbSavedBy.SttbFnm.PlfLst.PlfLfo.PlcfTxbxBkd.PlcfTxbxHdrBkd.DocUndoWord9.RgbUse.Usp.Uskf.PlcupcRgbUse.PlcupcUsp.SttbGlsyStyle.Plgosl.Plcocx.PlcfBteLvc.dwLowDateTime.dwHighDateTime.PlcfLvcPre10.PlcfAsumy.PlcfGram.SttbListNames.SttbfUssr".split(".");
function De(e) {
	let t = new S(e), n = Oe(t), r = 32, i = t.u16(r);
	r += 2;
	let a = t.slice(r, i * 2);
	r += i * 2;
	let o = t.u16(r);
	r += 2;
	let s = t.slice(r, o * 4);
	r += o * 4;
	let c = t.u16(r);
	r += 2;
	let l = t.slice(r, c * 8);
	r += c * 8;
	let u = t.ensure(r, 2) ? t.u16(r) : 0;
	t.ensure(r, 2) && (r += 2);
	let d = u ? t.slice(r, u * 2) : /* @__PURE__ */ new Uint8Array(), f = ke(s), p = Ae(l, c);
	return {
		base: n,
		csw: i,
		cslw: o,
		cbRgFcLcb: c,
		cswNew: u,
		nFibNew: u ? new S(d).u16(0) : 0,
		fibRgWBytes: a,
		fibRgLwBytes: s,
		fibRgFcLcbBytes: l,
		fibRgCswNewBytes: d,
		fibRgLw: f,
		fibRgFcLcb: p
	};
}
function Oe(e) {
	let t = e.u16(0), n = e.u16(2), r = e.u16(6), i = e.u16(8), a = e.u16(10), o = e.u16(18);
	return {
		wIdent: t,
		nFib: n,
		lid: r,
		pnNext: i,
		flags: a,
		envFlags: o,
		fDot: !!(a & 1),
		fGlsy: !!(a & 2),
		fComplex: !!(a & 4),
		fHasPic: !!(a & 8),
		cQuickSaves: a >> 4 & 15,
		fEncrypted: !!(a & 256),
		fWhichTblStm: a & 512 ? 1 : 0,
		fReadOnlyRecommended: !!(a & 1024),
		fWriteReservation: !!(a & 2048),
		fExtChar: !!(a & 4096),
		fLoadOverride: !!(a & 8192),
		fFarEast: !!(a & 16384),
		fObfuscated: !!(a & 32768),
		nFibBack: e.u16(12),
		lKey: e.u32(14),
		envr: e.u8(18),
		fMac: !!(o & 1),
		fEmptySpecial: !!(o & 2),
		fLoadOverridePage: !!(o & 4)
	};
}
function ke(e) {
	let t = new S(e), n = [];
	for (let r = 0; r + 4 <= e.length; r += 4) n.push(t.i32(r));
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
function Ae(e, t) {
	let n = new S(e), r = { _pairs: [] }, i = [];
	for (let a = 0; a < t && a * 8 + 8 <= e.length; a += 1) {
		let e = n.u32(a * 8), t = n.u32(a * 8 + 4), o = Ee[a] || `Field${a}`;
		r[`fc${o}`] = e, r[`lcb${o}`] = t, i.push({
			name: o,
			fc: e,
			lcb: t,
			index: a
		});
	}
	return r._pairs = i, r;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/sprm.js
var k = {
	sprmCFRMarkDel: 2048,
	sprmCFRMark: 2049,
	sprmCFFldVanish: 2050,
	sprmCPicLocation: 27139,
	sprmCIbstRMark: 18436,
	sprmCDttmRMark: 26629,
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
	sprmCHpsKern: 18507,
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
	sprmPIstdPermute: 50689,
	sprmPIncLvl: 9730,
	sprmPJc80: 9219,
	sprmPFKeep: 9221,
	sprmPFKeepFollow: 9222,
	sprmPFPageBreakBefore: 9223,
	sprmPIlvl: 9738,
	sprmPIlfo: 17931,
	sprmPChgTabsPapx: 50701,
	sprmPDxaRight80: 33806,
	sprmPDxaLeft80: 33807,
	sprmPNest80: 17936,
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
	sprmPDcs: 17452,
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
	sprmPDxcRight: 17493,
	sprmPDxcLeft: 17494,
	sprmPDxcLeft1: 17495,
	sprmPDylBefore: 17496,
	sprmPDylAfter: 17497,
	sprmPFDyaBeforeAuto: 9307,
	sprmPFDyaAfterAuto: 9308,
	sprmPDxaRight: 33885,
	sprmPDxaLeft: 33886,
	sprmPNest: 18015,
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
	sprmTTlp: 29706,
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
}, je = /* @__PURE__ */ new Set([
	k.sprmPChgTabs,
	k.sprmPChgTabsPapx,
	k.sprmTDefTable,
	k.sprmTTableBorders80,
	k.sprmTTableBorders,
	k.sprmTDefTableShd,
	k.sprmTDefTableShd80,
	k.sprmTDefTableShd3rd,
	k.sprmTDefTableShd2nd,
	k.sprmTDefTableShdRaw,
	k.sprmTDefTableShdRaw2nd,
	k.sprmTDefTableShdRaw3rd,
	k.sprmTSetBrc80,
	k.sprmTSetBrc,
	k.sprmTSetShd,
	k.sprmTSetShdOdd,
	k.sprmTCellPadding,
	k.sprmTCellSpacingDefault,
	k.sprmTCellPaddingDefault,
	k.sprmTCellWidth,
	k.sprmTVertAlign,
	k.sprmTVertMerge
]);
function Me(e) {
	return e >> 13 & 7;
}
function A(e, t = 0) {
	return t + 2 > e.length ? 0 : (e[t] ?? 0) | (e[t + 1] ?? 0) << 8;
}
function j(e, t = 0) {
	let n = A(e, t);
	return n > 32767 ? n - 65536 : n;
}
function M(e, t = 0) {
	return t + 4 > e.length ? 0 : ((e[t] ?? 0) | (e[t + 1] ?? 0) << 8 | (e[t + 2] ?? 0) << 16 | (e[t + 3] ?? 0) << 24 >>> 0) >>> 0;
}
function N(e, t = 0) {
	return {
		first: e[t] ?? 0,
		lim: e[t + 1] ?? 0
	};
}
function P(e, t = 0) {
	if (t + 4 > e.length) return null;
	let n = M(e, t) >>> 0;
	if (n === 4294967295) return {
		raw: n,
		nil: !0
	};
	let r = n & 255, i = n >> 8 & 255, a = n >> 16 & 255, o = n >>> 24 & 255;
	return {
		raw: n,
		lineWidth: r,
		borderType: i,
		color: a,
		space: o & 31,
		shadow: !!(o & 32),
		frame: !!(o & 64)
	};
}
function F(e, t = 0) {
	if (t + 8 > e.length) return null;
	let n = M(e, t) >>> 0, r = M(e, t + 4) >>> 0;
	return r === 4294967295 ? {
		raw: r,
		colorRef: n,
		nil: !0
	} : {
		raw: r,
		colorRef: n,
		lineWidth: r & 255,
		borderType: r >>> 8 & 255,
		space: r >>> 16 & 31,
		shadow: !!(r & 1 << 21),
		frame: !!(r & 1 << 22)
	};
}
function Ne(e, t = 0) {
	let n = A(e, t);
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
function Pe(e, t = 0) {
	return t + 20 > e.length ? null : {
		tcgrf: Ne(e, t),
		wWidth: A(e, t + 2),
		borders: {
			top: P(e, t + 4) || {},
			left: P(e, t + 8) || {},
			bottom: P(e, t + 12) || {},
			right: P(e, t + 16) || {}
		}
	};
}
function Fe(e, t = 0) {
	if (t + 2 > e.length) return null;
	let n = A(e, t), r = n & 31, i = n >>> 5 & 31, a = n >>> 10 & 63;
	return {
		foregroundColorIndex: r,
		backgroundColorIndex: i,
		pattern: a,
		auto: a === 0,
		nil: n === 65535,
		legacy: !0
	};
}
function Ie(e, t = 0) {
	if (t + 10 > e.length) return null;
	let n = M(e, t) >>> 0, r = M(e, t + 4) >>> 0, i = A(e, t + 8);
	return {
		foregroundColorRef: n,
		backgroundColorRef: r,
		pattern: i,
		auto: i === 0,
		nil: i === 65535
	};
}
function Le(e, t) {
	let n = t ? 4 : 8;
	if (!e.length || e.length < 1 + n * 6) return null;
	let r = t ? P : F, i = [
		"top",
		"left",
		"bottom",
		"right",
		"horizontalInside",
		"verticalInside"
	], a = {};
	return i.forEach((t, i) => {
		let o = r(e, 1 + i * n);
		o && (a[t] = o);
	}), a;
}
function Re(e, t, n) {
	let r = n ? 2 : 10, i = Math.floor(Math.min(e[0] ?? 0, Math.max(0, e.length - 1)) / r), a = [];
	for (let t = 0; t < i; t += 1) {
		let i = n ? Fe(e, 1 + t * r) : Ie(e, 1 + t * r);
		i && a.push(i);
	}
	return {
		start: t,
		values: a
	};
}
function ze(e) {
	if (e.length < 3) return null;
	let t = A(e, 0), n = e[2] ?? 0, r = 3, i = [];
	for (let t = 0; t < n + 1 && r + 2 <= e.length; t += 1) i.push(j(e, r)), r += 2;
	let a = [];
	for (let t = 0; t < n && r + 20 <= e.length; t += 1) {
		let t = Pe(e, r);
		t && a.push(t), r += 20;
	}
	return {
		cb: t,
		numberOfColumns: n,
		rgdxaCenter: i,
		cells: a
	};
}
function Be(e) {
	return e.length ? {
		cb: e[0] ?? 0,
		range: N(e, 1),
		value: e[3] ?? 0,
		extra: e.subarray(4)
	} : null;
}
function Ve(e) {
	if (!e.length) return null;
	let t = e[0] ?? 0, n = A(e, 4);
	return {
		cb: t,
		range: N(e, 1),
		ftsWidth: e[3] ?? 0,
		width: n,
		wWidth: n
	};
}
function He(e) {
	if (e.length < 7) return null;
	let t = A(e, 5);
	return {
		cb: e[0] ?? 0,
		range: N(e, 1),
		sides: e[3] ?? 0,
		ftsWidth: e[4] ?? 0,
		width: t,
		wWidth: t
	};
}
function Ue(e) {
	return e.length < 8 ? null : {
		cb: e[0] ?? 0,
		range: N(e, 1),
		bordersToApply: e[3] ?? 0,
		border: P(e, 4) || { nil: !0 },
		extra: e.subarray(8)
	};
}
function We(e) {
	return e.length < 12 ? null : {
		cb: e[0] ?? 0,
		range: N(e, 1),
		bordersToApply: e[3] ?? 0,
		border: F(e, 4) || { nil: !0 },
		extra: e.subarray(12)
	};
}
function Ge(e, t = !1) {
	return e.length < 13 ? null : {
		cb: e[0] ?? 0,
		range: N(e, 1),
		shading: Ie(e, 3),
		odd: t
	};
}
function Ke(e) {
	return e.length < 3 ? null : {
		cb: e[0] ?? 0,
		index: e[1] ?? 0,
		value: e[2] ?? 0
	};
}
function qe(e) {
	return e.length < 3 ? null : {
		range: N(e, 0),
		value: e[2] ?? 0
	};
}
function Je(e) {
	if (e.length < 4) return null;
	let t = j(e, 2);
	return {
		range: N(e, 0),
		width: t,
		wWidth: t
	};
}
function Ye(e) {
	if (!e.length) return null;
	let t = A(e, 1);
	return {
		ftsWidth: e[0] ?? 0,
		width: t,
		wWidth: t
	};
}
function Xe(e) {
	return e.length < 4 ? null : {
		itcFirst: e[0] ?? 0,
		ctc: e[1] ?? 0,
		dxaCol: A(e, 2)
	};
}
function Ze(e, t, n) {
	let r = n >> 13 & 7;
	if (t >= e.length) return 0;
	if (n === k.sprmTDefTable) {
		let n = A(e, t);
		return n ? n + 1 : 0;
	}
	if (je.has(n)) return (e[t] ?? 0) + 1;
	switch (r) {
		case 0: return 1;
		case 1: return 1;
		case 2: return 2;
		case 3: return 4;
		case 4: return 2;
		case 5: return 2;
		case 6: return (e[t] ?? 0) + 1;
		case 7: return 3;
		default: return 0;
	}
}
function I(e) {
	return !!(e[0] ?? 0);
}
function L(e, t, n, r, i) {
	return {
		kind: e,
		name: t,
		value: n,
		raw: r,
		operandBytes: i
	};
}
function Qe(e, t) {
	let n = Me(e), r = t, i = e;
	switch (e) {
		case k.sprmCPicLocation: return L("char", "pictureOffset", M(r, 0) >>> 0, i, r);
		case k.sprmCFData: return L("char", "data", I(r), i, r);
		case k.sprmCFOle2: return L("char", "ole2", I(r), i, r);
		case k.sprmCIstd: return L("char", "charStyleId", A(r, 0), i, r);
		case k.sprmCPlain: return L("char", "plain", I(r), i, r);
		case k.sprmCFBold: return L("char", "bold", I(r), i, r);
		case k.sprmCFItalic: return L("char", "italic", I(r), i, r);
		case k.sprmCFStrike: return L("char", "strike", I(r), i, r);
		case k.sprmCFOutline: return L("char", "outline", I(r), i, r);
		case k.sprmCFShadow: return L("char", "shadow", I(r), i, r);
		case k.sprmCFSmallCaps: return L("char", "smallCaps", I(r), i, r);
		case k.sprmCFCaps: return L("char", "caps", I(r), i, r);
		case k.sprmCFVanish: return L("char", "hidden", I(r), i, r);
		case k.sprmCKul: return L("char", "underline", r[0] ?? 0, i, r);
		case k.sprmCDxaSpace: return L("char", "spacing", j(r, 0), i, r);
		case k.sprmCIco:
		case k.sprmCIcoBi: return L("char", "colorIndex", r[0] ?? 0, i, r);
		case k.sprmCHighlight: {
			let e = r[0] ?? 0;
			return L("char", "highlight", {
				index: e,
				color: Te[e]
			}, i, r);
		}
		case k.sprmCHps:
		case k.sprmCHpsBi: return L("char", "fontSizeHalfPoints", A(r, 0), i, r);
		case k.sprmCHpsPos: return L("char", "positionHalfPoints", j(r, 0), i, r);
		case k.sprmCSymbol: return L("char", "symbol", {
			font: A(r, 0),
			charCode: A(r, 2)
		}, i, r);
		case k.sprmCRgFtc0:
		case k.sprmCRgFtc1:
		case k.sprmCRgFtc2:
		case k.sprmCFtcBi: return L("char", "fontFamilyId", A(r, 0), i, r);
		case k.sprmCCharScale: return L("char", "scale", A(r, 0), i, r);
		case k.sprmCFDStrike: return L("char", "doubleStrike", I(r), i, r);
		case k.sprmCFImprint: return L("char", "imprint", I(r), i, r);
		case k.sprmCFSpec: return L("char", "special", I(r), i, r);
		case k.sprmCFObj: return L("char", "object", I(r), i, r);
		case k.sprmCFEmboss: return L("char", "emboss", I(r), i, r);
		case k.sprmCFBiDi: return L("char", "rtl", I(r), i, r);
		case k.sprmCFBoldBi: return L("char", "boldBi", I(r), i, r);
		case k.sprmCFItalicBi: return L("char", "italicBi", I(r), i, r);
		case k.sprmPIstd: return L("para", "styleId", A(r, 0), i, r);
		case k.sprmPJc80:
		case k.sprmPJc: return L("para", "alignment", r[0] ?? 0, i, r);
		case k.sprmPFKeep: return L("para", "keepLines", I(r), i, r);
		case k.sprmPFKeepFollow: return L("para", "keepNext", I(r), i, r);
		case k.sprmPFPageBreakBefore: return L("para", "pageBreakBefore", I(r), i, r);
		case k.sprmPIlvl: return L("para", "listLevel", r[0] ?? 0, i, r);
		case k.sprmPIlfo: return L("para", "listId", A(r, 0), i, r);
		case k.sprmPDxaRight80:
		case k.sprmPDxaRight: return L("para", "rightIndent", j(r, 0), i, r);
		case k.sprmPDxaLeft80:
		case k.sprmPDxaLeft: return L("para", "leftIndent", j(r, 0), i, r);
		case k.sprmPDxaLeft180:
		case k.sprmPDxaLeft1: return L("para", "firstLineIndent", j(r, 0), i, r);
		case k.sprmPDyaLine: return L("para", "lineSpacing", j(r, 0), i, r);
		case k.sprmPDyaBefore: return L("para", "spacingBefore", j(r, 0), i, r);
		case k.sprmPDyaAfter: return L("para", "spacingAfter", j(r, 0), i, r);
		case k.sprmPFInTable: return L("para", "inTable", I(r), i, r);
		case k.sprmPFTtp: return L("para", "tableRowEnd", I(r), i, r);
		case k.sprmPDxaAbs: return L("para", "frameLeft", j(r, 0), i, r);
		case k.sprmPDyaAbs: return L("para", "frameTop", j(r, 0), i, r);
		case k.sprmPDxaWidth: return L("para", "frameWidth", j(r, 0), i, r);
		case k.sprmPPc: return L("para", "framePosition", r[0] ?? 0, i, r);
		case k.sprmPWr: return L("para", "frameWrap", r[0] ?? 0, i, r);
		case k.sprmPBrcTop80: return L("para", "borderTop", P(r, 0), i, r);
		case k.sprmPBrcTop: return L("para", "borderTop", F(r, 1), i, r);
		case k.sprmPBrcLeft80: return L("para", "borderLeft", P(r, 0), i, r);
		case k.sprmPBrcLeft: return L("para", "borderLeft", F(r, 1), i, r);
		case k.sprmPBrcBottom80: return L("para", "borderBottom", P(r, 0), i, r);
		case k.sprmPBrcBottom: return L("para", "borderBottom", F(r, 1), i, r);
		case k.sprmPBrcRight80: return L("para", "borderRight", P(r, 0), i, r);
		case k.sprmPBrcRight: return L("para", "borderRight", F(r, 1), i, r);
		case k.sprmPBrcBetween80: return L("para", "borderBetween", P(r, 0), i, r);
		case k.sprmPBrcBetween: return L("para", "borderBetween", F(r, 1), i, r);
		case k.sprmPBrcBar80: return L("para", "borderBar", P(r, 0), i, r);
		case k.sprmPBrcBar: return L("para", "borderBar", F(r, 1), i, r);
		case k.sprmPWHeightAbs: return L("para", "frameHeight", j(r, 0), i, r);
		case k.sprmPShd80:
		case k.sprmPShd: return L("para", "shading", r.slice(), i, r);
		case k.sprmPDyaFromText: return L("para", "distanceFromTextY", j(r, 0), i, r);
		case k.sprmPDxaFromText: return L("para", "distanceFromTextX", j(r, 0), i, r);
		case k.sprmPFLocked: return L("para", "locked", I(r), i, r);
		case k.sprmPFWidowControl: return L("para", "widowControl", I(r), i, r);
		case k.sprmPFBiDi: return L("para", "rtlPara", I(r), i, r);
		case k.sprmPFAdjustRight: return L("para", "adjustRight", I(r), i, r);
		case k.sprmPItap: return L("para", "itap", M(r, 0), i, r);
		case k.sprmPDtap: return L("para", "dtap", M(r, 0), i, r);
		case k.sprmPFInnerTableCell: return L("para", "innerTableCell", I(r), i, r);
		case k.sprmPFInnerTtp: return L("para", "innerTableRowEnd", I(r), i, r);
		case k.sprmPFDyaBeforeAuto: return L("para", "spacingBeforeAuto", I(r), i, r);
		case k.sprmPFDyaAfterAuto: return L("para", "spacingAfterAuto", I(r), i, r);
		case k.sprmTJc90: return L("table", "alignment", A(r, 0), i, r);
		case k.sprmTDxaLeft: return L("table", "leftIndent", j(r, 0), i, r);
		case k.sprmTDxaGapHalf: return L("table", "gapHalf", A(r, 0), i, r);
		case k.sprmTFCantSplit90: return L("table", "cantSplit", I(r), i, r);
		case k.sprmTTableHeader: return L("table", "header", I(r), i, r);
		case k.sprmTDyaRowHeight: return L("table", "rowHeight", j(r, 0), i, r);
		case k.sprmTDefTable: return L("table", "defTable", ze(r), i, r);
		case k.sprmTTableBorders80: return L("table", "tableBorders", Le(r, !0), i, r);
		case k.sprmTTableBorders: return L("table", "tableBorders", Le(r, !1), i, r);
		case k.sprmTDefTableShd80: return L("table", "defaultShading", Re(r, 0, !0), i, r);
		case k.sprmTDefTableShd:
		case k.sprmTDefTableShdRaw: return L("table", "defaultShading", Re(r, 0, !1), i, r);
		case k.sprmTDefTableShd2nd:
		case k.sprmTDefTableShdRaw2nd: return L("table", "defaultShading", Re(r, 22, !1), i, r);
		case k.sprmTDefTableShd3rd:
		case k.sprmTDefTableShdRaw3rd: return L("table", "defaultShading", Re(r, 44, !1), i, r);
		case k.sprmTFBiDi: return L("table", "rtl", I(r), i, r);
		case k.sprmTPc: return L("table", "positionCode", r[0] ?? 0, i, r);
		case k.sprmTDxaAbs: return L("table", "absLeft", j(r, 0), i, r);
		case k.sprmTDyaAbs: return L("table", "absTop", j(r, 0), i, r);
		case k.sprmTDxaFromText: return L("table", "distanceLeft", j(r, 0), i, r);
		case k.sprmTDyaFromText: return L("table", "distanceTop", j(r, 0), i, r);
		case k.sprmTTableWidth: return L("table", "tableWidth", Ye(r), i, r);
		case k.sprmTFAutofit: return L("table", "autoFit", I(r), i, r);
		case k.sprmTWidthBefore: return L("table", "widthBefore", Ye(r), i, r);
		case k.sprmTWidthAfter: return L("table", "widthAfter", Ye(r), i, r);
		case k.sprmTInsert: return L("table", "insertCells", Xe(r), i, r);
		case k.sprmTDelete: return L("table", "deleteCells", N(r, 0), i, r);
		case k.sprmTDxaCol: return L("table", "columnWidth", Je(r), i, r);
		case k.sprmTMerge: return L("table", "merge", N(r, 0), i, r);
		case k.sprmTSplit: return L("table", "split", N(r, 0), i, r);
		case k.sprmTTextFlow: return L("table", "textFlow", {
			range: N(r, 0),
			value: A(r, 2)
		}, i, r);
		case k.sprmTVertMerge: return L("table", "vertMerge", Ke(r), i, r);
		case k.sprmTVertAlign: return L("table", "vertAlign", Be(r), i, r);
		case k.sprmTSetShd: return L("table", "setShading", Ge(r), i, r);
		case k.sprmTSetShdOdd: return L("table", "setShading", Ge(r, !0), i, r);
		case k.sprmTSetBrc80: return L("table", "setBorder", Ue(r), i, r);
		case k.sprmTSetBrc: return L("table", "setBorder", We(r), i, r);
		case k.sprmTCellPadding:
		case k.sprmTCellPaddingDefault: return L("table", "cellPadding", He(r), i, r);
		case k.sprmTCellSpacingDefault: return L("table", "cellSpacing", He(r), i, r);
		case k.sprmTCellWidth: return L("table", "cellWidth", Ve(r), i, r);
		case k.sprmTFitText: return L("table", "fitText", qe(r), i, r);
		case k.sprmTFCellNoWrap: return L("table", "cellNoWrap", Be(r), i, r);
		case k.sprmTIstd: return L("table", "styleId", A(r, 0), i, r);
		default: return {
			kind: n === 1 ? "para" : n === 2 ? "char" : n === 5 ? "table" : "unknown",
			name: `sprm_${e.toString(16)}`,
			value: r,
			raw: e,
			operandBytes: r
		};
	}
}
function $e(e, t, n) {
	let r = [], i = t;
	for (; i + 2 <= n;) {
		let t = A(e, i);
		i += 2;
		let a = Ze(e, i, t);
		if (!a || i + a > n) break;
		let o = e.subarray(i, i + a);
		i += a, r.push(Qe(t, o));
	}
	return r;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/fkp.js
function et(e, t = 0) {
	return t + 4 > e.length ? 0 : ((e[t] ?? 0) | (e[t + 1] ?? 0) << 8 | (e[t + 2] ?? 0) << 16 | (e[t + 3] ?? 0) << 24 >>> 0) >>> 0;
}
function tt(e, t, n) {
	if (t == null || n == null || n <= 0) return {
		aFC: [],
		pages: []
	};
	let r = new S(e.subarray(t, t + n)), i = Math.floor((n - 4) / 8);
	if (i <= 0) return {
		aFC: [],
		pages: []
	};
	let a = [];
	for (let e = 0; e <= i; e += 1) a.push(r.u32(e * 4) >>> 0);
	let o = [], s = (i + 1) * 4;
	for (let e = 0; e < i; e += 1) o.push(r.u32(s + e * 4) & 4194303);
	return {
		aFC: a,
		pages: o
	};
}
function nt(e, t) {
	let n = t * 512, r = e.subarray(n, n + 512);
	if (r.length < 512) return null;
	let i = new S(r), a = i.u8(511);
	if (!a || a > 100) return null;
	let o = [];
	for (let e = 0; e <= a; e += 1) o.push(i.u32(e * 4) >>> 0);
	let s = [], c = [], l = (a + 1) * 4;
	for (let e = 0; e < a; e += 1) {
		let t = i.u8(l + e);
		s.push(t), c.push(t ? n + t * 2 : 0);
	}
	return {
		crun: a,
		rgfc: o,
		rgb: s,
		chpxOffsets: c
	};
}
function rt(e, t) {
	let n = t * 512, r = e.subarray(n, n + 512);
	if (r.length < 512) return null;
	let i = new S(r), a = i.u8(511);
	if (a > 29) return null;
	let o = [];
	for (let e = 0; e <= a; e += 1) o.push(i.u32(e * 4) >>> 0);
	let s = (a + 1) * 4, c = [], l = [];
	for (let e = 0; e < a; e += 1) {
		let t = i.u8(s + e * 13);
		c.push(t), l.push(t ? n + t * 2 : 0);
	}
	return {
		cpara: a,
		rgfc: o,
		bOffsets: c,
		papxOffsets: l
	};
}
function it(e, t, n, r) {
	let i = n.fibRgFcLcb.fcPlcfBteChpx, a = n.fibRgFcLcb.lcbPlcfBteChpx, o = tt(t, i, a), s = [];
	for (let t of o.pages) {
		let n = nt(e, t);
		if (n) for (let t = 0; t < n.crun; t += 1) {
			let i = n.rgfc[t] ?? 0, a = n.rgfc[t + 1] ?? i, o = ye(r, i), c = ye(r, a);
			if (o == null || c == null || c <= o) continue;
			let l = n.chpxOffsets[t] ? ot(e, n.chpxOffsets[t]) : [];
			s.push({
				cpStart: o,
				cpEnd: c,
				fcStart: i,
				fcEnd: a,
				properties: l
			});
		}
	}
	return s.sort((e, t) => e.cpStart - t.cpStart || e.cpEnd - t.cpEnd), s;
}
function at(e, t, n, r, i) {
	let a = n.fibRgFcLcb.fcPlcfBtePapx, o = n.fibRgFcLcb.lcbPlcfBtePapx, s = tt(t, a, o), c = [];
	for (let t of s.pages) {
		let n = rt(e, t);
		if (n) for (let t = 0; t < n.cpara; t += 1) {
			let a = n.rgfc[t] ?? 0, o = n.rgfc[t + 1] ?? a, s = ye(r, a), l = ye(r, o);
			if (s == null || l == null || l < s) continue;
			let u = n.papxOffsets[t] ? lt(e, n.papxOffsets[t], i) : {
				styleId: 0,
				properties: []
			};
			c.push({
				cpStart: s,
				cpEnd: l,
				fcStart: a,
				fcEnd: o,
				styleId: u.styleId,
				properties: u.properties,
				rawOffset: n.papxOffsets[t] ?? 0
			});
		}
	}
	return c.sort((e, t) => e.cpStart - t.cpStart || e.cpEnd - t.cpEnd), c;
}
function ot(e, t) {
	if (t == null || t < 0 || t >= e.length) return [];
	let n = e[t] ?? 0;
	if (!n) return [];
	let r = t + 1;
	return $e(e, r, Math.min(e.length, r + n));
}
function st(e, t) {
	if (t < 0 || t + 2 > e.length) return [];
	let n = (e[t] ?? 0) | (e[t + 1] ?? 0) << 8;
	return !n || t + 2 + n > e.length ? [] : $e(e, t + 2, t + 2 + n);
}
function ct(e, t) {
	if (!t?.length) return e;
	let n = [];
	for (let r of e) {
		if (r.raw !== k.sprmPHugePapx) {
			n.push(r);
			continue;
		}
		let e = r.operandBytes || (r.value instanceof Uint8Array ? r.value : null);
		if (!e || e.length < 4) {
			n.push(r);
			continue;
		}
		let i = st(t, et(e));
		n.push(...i.length ? i : [r]);
	}
	return n;
}
function lt(e, t, n) {
	if (t == null || t < 0 || t >= e.length) return {
		styleId: 0,
		properties: []
	};
	let r = new S(e), i = r.u8(t);
	if (i === 0 && !r.ensure(t + 1, 1)) return {
		styleId: 0,
		properties: []
	};
	let a, o;
	return i === 0 ? (o = r.u8(t + 1) * 2, a = t + 2) : (o = i - 1, a = t + 1), o < 2 || !r.ensure(a, Math.max(2, o)) ? {
		styleId: 0,
		properties: []
	} : {
		styleId: r.u16(a),
		properties: ct($e(e, a + 2, Math.min(e.length, a + o)), n)
	};
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/fonts.js
function ut(e, t) {
	let n = t;
	for (; n + 1 < e.length && (e[n] !== 0 || e[n + 1] !== 0);) n += 2;
	return {
		value: new TextDecoder("utf-16le").decode(e.subarray(t, n)),
		nextOffset: Math.min(e.length, n + 2)
	};
}
function dt(e, t) {
	if (!e.length) return null;
	let n = new S(e), r = n.u8(0), i = n.u8(1), a = n.u16(2), o = n.u8(4), s = n.u8(5), c = n.slice(6, 10), l = n.slice(16, 24), u = "", d = "";
	if (e.length > 40) {
		let t = new TextDecoder("utf-16le").decode(e.subarray(40)).split("\0").filter(Boolean);
		if (u = t[0] || "", d = t[1] || "", !d && s) {
			let t = 40 + s * 2;
			t + 2 <= e.length && (d = ut(e, t).value);
		}
	}
	return {
		index: t,
		cbFfnM1: r,
		ffid: i,
		weight: a,
		charset: o,
		ixchSzAlt: s,
		panose: c,
		fontSignature: l,
		name: u,
		altName: d
	};
}
function ft(e, t) {
	let n = t.fcSttbfFfn, r = t.lcbSttbfFfn;
	if (n == null || r == null || r <= 0) return {
		header: null,
		fonts: [],
		byIndex(e) {
			return null;
		}
	};
	let i = e.subarray(n, n + r), a = new S(i), o = a.u16(0), s = a.u16(2), c = 4, l = [];
	for (let e = 0; e < o && c < i.length; e += 1) {
		let t = a.u8(c) + 1, n = dt(i.subarray(c, Math.min(c + t, i.length)), e);
		n && l.push(n), c += t + s;
	}
	return {
		header: {
			cData: o,
			cbExtra: s
		},
		fonts: l,
		byIndex(e) {
			return e == null || e < 0 ? null : l[e] || null;
		}
	};
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/properties.js
function pt(e) {
	let t = {
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
	for (let n of e || []) switch (n.name) {
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
		default: t[n.name] = n.value;
	}
	return t;
}
function mt(e) {
	let t = {
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
	for (let n of e || []) switch (n.name) {
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
		default: t[n.name] = n.value;
	}
	return t;
}
function ht(e) {
	let t = {
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
	for (let n of e || []) switch (n.name) {
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
		default: t.operations.push(n);
	}
	return t;
}
function gt(e) {
	return e?.inTable ? Math.max(1, e.itap || (e.dtap ? e.dtap : 1)) : 0;
}
function _t(e) {
	return Ce[e] || "left";
}
function vt(e) {
	return Se[e] || (e ? "single" : "none");
}
function yt(e) {
	return we[e] || "top";
}
function R(e, t, n) {
	if (!t) return;
	let r = Math.max(0, t.first || 0), i = Math.max(r, t.lim || r);
	for (let t = r; t < i && t < e.length; t += 1) n(e[t], t);
}
function bt(e) {
	let t = e?.defTable, n = (t?.cells || []).map((e, n) => ({
		index: n,
		width: t?.rgdxaCenter?.[n + 1] != null && t?.rgdxaCenter?.[n] != null ? Math.max(0, t.rgdxaCenter[n + 1] - t.rgdxaCenter[n]) : e?.wWidth,
		ftsWidth: e?.tcgrf?.ftsWidth,
		borders: e?.borders || {},
		merge: e?.tcgrf?.horzMerge || 0,
		vertMerge: e?.tcgrf?.vertMerge || 0,
		vertAlign: e?.tcgrf?.vertAlign || 0,
		fitText: !!e?.tcgrf?.fitText,
		noWrap: !!e?.tcgrf?.noWrap,
		hideMark: !!e?.tcgrf?.hideMark,
		textFlow: e?.tcgrf?.textFlow || 0,
		rightBoundary: t?.rgdxaCenter?.[n + 1],
		leftBoundary: t?.rgdxaCenter?.[n]
	})), r = !1, i = n[0]?.leftBoundary || 0;
	for (let i of e.operations || []) switch (i.name) {
		case "insertCells": {
			if (t?.cells?.length) break;
			let e = i.value, a = Math.min(n.length, Math.max(0, e?.itcFirst || 0)), o = Math.min(63 - n.length, Math.max(0, e?.ctc || 0)), s = Math.max(0, e?.dxaCol || 0);
			o && (n.splice(a, 0, ...Array.from({ length: o }, (e, t) => ({
				index: a + t,
				width: s,
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
			let e = i.value;
			if (e) {
				let t = Math.max(0, e.first || 0), i = Math.max(0, (e.lim || t) - t);
				i && (n.splice(t, i), r = !0);
			}
			break;
		}
		case "merge":
			R(n, i.value, (e, t) => {
				e.merge = t === i.value.first ? 2 : 1;
			});
			break;
		case "split":
			R(n, i.value, (e) => {
				e.merge = 0;
			});
			break;
		case "cellWidth":
			R(n, i.value.range, (e) => {
				let t = i.value;
				e.ftsWidth = t.ftsWidth, (t.ftsWidth === 2 || t.ftsWidth === 3) && t.width != null && (e.width = t.width);
			});
			break;
		case "columnWidth":
			R(n, i.value.range, (e) => {
				e.width = Math.max(0, i.value.width || 0), r = !0;
			});
			break;
		case "vertMerge": {
			let e = i.value, t = e?.index == null ? void 0 : n[e.index];
			t && (t.vertMerge = e?.value || 0);
			break;
		}
		case "vertAlign":
			R(n, i.value.range, (e) => {
				e.vertAlign = i.value.value;
			});
			break;
		case "setBorder":
			R(n, i.value.range, (e) => {
				let t = i.value, n = { ...e.borders || {} };
				t.bordersToApply & 1 && (n.top = t.border), t.bordersToApply & 2 && (n.left = t.border), t.bordersToApply & 4 && (n.bottom = t.border), t.bordersToApply & 8 && (n.right = t.border), t.bordersToApply & 16 && (n.diagonalDown = t.border), t.bordersToApply & 32 && (n.diagonalUp = t.border), e.borders = n;
			});
			break;
		case "setShading":
			R(n, i.value.range, (e, t) => {
				let n = i.value;
				n.odd && (t - n.range.first) % 2 != 0 || (e.shading = n.shading);
			});
			break;
		case "cellPadding":
		case "cellSpacing": {
			let e = i.value, t = e?.ftsWidth === 3 || i.name === "cellSpacing" && e?.ftsWidth === 19;
			if (!e?.range || !t || e.width == null) break;
			R(n, e.range, (t) => {
				let n = i.name === "cellPadding" ? "paddingTwips" : "spacingTwips", r = { ...t[n] || {} };
				(e.sides || 0) & 1 && (r.top = e.width), (e.sides || 0) & 2 && (r.left = e.width), (e.sides || 0) & 4 && (r.bottom = e.width), (e.sides || 0) & 8 && (r.right = e.width), t[n] = r;
			});
			break;
		}
		case "defaultShading": {
			let e = i.value;
			(e?.values || []).forEach((t, r) => {
				let i = n[(e?.start || 0) + r];
				i && (i.shading = t);
			});
			break;
		}
		case "fitText":
			R(n, i.value.range, (e) => {
				e.fitText = !!i.value.value;
			});
			break;
		case "cellNoWrap":
			R(n, i.value.range, (e) => {
				e.noWrap = !!i.value.value;
			});
			break;
		case "textFlow": R(n, i.value.range, (e) => {
			e.textFlow = i.value.value;
		});
	}
	if (r) {
		let e = i;
		n.forEach((t) => {
			let n = Math.max(0, t.width || 0);
			t.leftBoundary = e, e += n, t.rightBoundary = e;
		});
	}
	return n.forEach((e, t) => {
		e.index = t;
	}), n;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/html-word.js
var xt = /^(?:<!doctype\s+html\b|<html\b|<body\b)/i, St = /<(div|p|h[1-6]|li|pre|blockquote|tr)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi, Ct = /<(script|style|noscript|iframe|object|embed|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
function wt(e, t = 1024) {
	return Array.from(e.subarray(0, Math.min(t, e.length)), (e) => e === 0 ? "" : String.fromCharCode(e)).join("");
}
function Tt(e) {
	let t = wt(e).replace(/^\uFEFF/, "").trimStart();
	return xt.test(t);
}
function Et(e, t, n = !1) {
	try {
		return new TextDecoder(t, { fatal: n }).decode(e);
	} catch {
		return null;
	}
}
function Dt(e) {
	let t = e.length;
	for (; t > 0 && e[t - 1] === 0;) --t;
	let n = e.subarray(0, t), r = wt(n, 4096), i = /charset\s*=\s*["']?([a-z0-9._-]+)/i.exec(r)?.[1]?.toLowerCase(), a = i === "gb2312" || i === "gbk" ? "gb18030" : i;
	if (a) {
		let e = Et(n, a);
		if (e != null) return e;
	}
	return Et(n, "utf-8", !0) ?? Et(n, "gb18030") ?? Et(n, "utf-8") ?? "";
}
function Ot(e) {
	let t = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: "\xA0",
		quot: "\""
	};
	return e.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (e, n) => {
		if (n[0] === "#") {
			let t = n[1]?.toLowerCase() === "x", r = Number.parseInt(n.slice(t ? 2 : 1), t ? 16 : 10);
			if (Number.isFinite(r) && r >= 0 && r <= 1114111) try {
				return String.fromCodePoint(r);
			} catch {
				return e;
			}
			return e;
		}
		return t[n.toLowerCase()] ?? e;
	});
}
function kt(e) {
	return Ot(e.replace(Ct, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:div|p|h[1-6]|li|pre|blockquote|tr|table)>/gi, "\n").replace(/<\/?(?:td|th)\b[^>]*>/gi, "	").replace(/<[^>]+>/g, "").replace(/\u0000/g, "")).replace(/\r\n?/g, "\n").replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").trim();
}
function At(e) {
	let t = e.replace(Ct, "").replace(/<!--[\s\S]*?-->/g, ""), n = [];
	for (let e of t.matchAll(St)) {
		let t = e[3] || "", r = kt(t);
		r && n.push({
			text: r,
			attributes: e[2] || "",
			content: t
		});
	}
	if (n.length) return n;
	let r = kt(t);
	return r ? [{
		text: r,
		attributes: "",
		content: t
	}] : [];
}
function jt(e) {
	return /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(e)?.[2] || "";
}
function Mt(e, t) {
	let n = mt([]), r = pt([]), i = jt(e.attributes), a = /text-align\s*:\s*(center|right|justify)/i.exec(i)?.[1]?.toLowerCase();
	a === "center" && (n.alignment = 1), a === "right" && (n.alignment = 2), a === "justify" && (n.alignment = 3);
	let o = Number.parseFloat(/text-indent\s*:\s*([\d.]+)pt/i.exec(i)?.[1] || "");
	Number.isFinite(o) && (n.firstLineIndent = Math.round(o * 20));
	let s = Number.parseFloat(/font-size\s*:\s*([\d.]+)pt/i.exec(i)?.[1] || "");
	Number.isFinite(s) && (r.fontSizeHalfPoints = Math.round(Math.min(96, Math.max(8, s)) * 2)), (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(i) || /<(?:b|strong)\b/i.test(e.content)) && (r.bold = !0), (/font-style\s*:\s*italic/i.test(i) || /<(?:i|em)\b/i.test(e.content)) && (r.italic = !0);
	let c = e.text.split("\n").flatMap((e, t) => [...t ? [{ type: "lineBreak" }] : [], ...e ? [{
		type: "text",
		text: e,
		style: { ...r }
	}] : []]);
	return {
		type: "paragraph",
		id: `html-word-paragraph-${t + 1}`,
		styleId: 0,
		styleName: "Normal",
		paraState: n,
		inlines: c,
		text: e.text
	};
}
function Nt(e) {
	if (!Tt(e)) return null;
	let t = At(Dt(e));
	if (!t.length) return null;
	let n = t.map(Mt);
	return {
		kind: "msdoc",
		version: 1,
		warnings: [{
			message: "Recovered an HTML document stored inside the legacy WordDocument stream.",
			code: "MSDOC_HTML_WORDDOCUMENT_RECOVERED"
		}],
		meta: {
			fib: {
				wIdent: 0,
				nFib: 0,
				fWhichTblStm: 0,
				fComplex: !1,
				fEncrypted: !1,
				ccpText: t.reduce((e, t) => e + t.text.length, 0)
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
// ../../node_modules/@file-viewer/doc/dist/core/inflate.js
var z = class extends Error {
	name = "InflateError";
}, Pt = class {
	bytes;
	byteOffset = 0;
	bitBuffer = 0;
	bitCount = 0;
	constructor(e) {
		this.bytes = e;
	}
	readBits(e) {
		if (e < 0 || e > 24) throw new z("Invalid bit count");
		for (; this.bitCount < e;) {
			if (this.byteOffset >= this.bytes.length) throw new z("Unexpected end of deflate stream");
			this.bitBuffer |= (this.bytes[this.byteOffset++] ?? 0) << this.bitCount, this.bitCount += 8;
		}
		let t = e === 0 ? 0 : (1 << e) - 1, n = this.bitBuffer & t;
		return this.bitBuffer >>>= e, this.bitCount -= e, n;
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
}, Ft = class {
	buffer;
	length = 0;
	constructor(e = 32768) {
		this.buffer = new Uint8Array(e);
	}
	reserve(e) {
		let t = this.length + e;
		if (t <= this.buffer.length) return;
		let n = this.buffer.length;
		for (; n < t;) n *= 2;
		let r = new Uint8Array(n);
		r.set(this.buffer.subarray(0, this.length)), this.buffer = r;
	}
	push(e) {
		this.reserve(1), this.buffer[this.length++] = e & 255;
	}
	pushBytes(e) {
		this.reserve(e.length), this.buffer.set(e, this.length), this.length += e.length;
	}
	copyFromBack(e, t) {
		if (e <= 0 || e > this.length) throw new z("Invalid back-reference distance");
		this.reserve(t);
		for (let n = 0; n < t; n += 1) this.buffer[this.length] = this.buffer[this.length - e] ?? 0, this.length += 1;
	}
	toUint8Array(e) {
		let t = this.buffer.slice(0, this.length);
		return e != null && e >= 0 && t.length, t;
	}
};
function It(e) {
	let t = Math.max(0, ...e);
	if (t === 0) throw new z("Empty Huffman table");
	let n = Array(t + 1).fill(0);
	for (let r of e) {
		if (r < 0 || r > t) throw new z("Invalid code length");
		r && (n[r] += 1);
	}
	let r = Array(t + 1).fill(0), i = 0;
	for (let e = 1; e <= t; e += 1) i = i + (n[e - 1] ?? 0) << 1, r[e] = i;
	let a = Array.from({ length: t + 1 }, () => /* @__PURE__ */ new Map());
	for (let t = 0; t < e.length; t += 1) {
		let n = e[t] ?? 0;
		if (!n) continue;
		let i = r[n] ?? 0;
		r[n] = i + 1, a[n].set(i, t);
	}
	return {
		maps: a,
		maxBits: t
	};
}
function Lt(e, t) {
	let n = 0;
	for (let r = 1; r <= t.maxBits; r += 1) {
		n = n << 1 | e.readBit();
		let i = t.maps[r]?.get(n);
		if (i != null) return i;
	}
	throw new z("Invalid Huffman code");
}
var Rt = [
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
], zt = [
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
], Bt = [
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
], Vt = [
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
], Ht = null, Ut = null;
function Wt() {
	if (!Ht) {
		let e = Array(288).fill(0);
		for (let t = 0; t <= 143; t += 1) e[t] = 8;
		for (let t = 144; t <= 255; t += 1) e[t] = 9;
		for (let t = 256; t <= 279; t += 1) e[t] = 7;
		for (let t = 280; t <= 287; t += 1) e[t] = 8;
		Ht = It(e), Ut = It(Array(32).fill(5));
	}
	return {
		literalLength: Ht,
		distance: Ut
	};
}
var Gt = [
	16,
	17,
	18,
	0,
	8,
	7,
	9,
	6,
	10,
	5,
	11,
	4,
	12,
	3,
	13,
	2,
	14,
	1,
	15
];
function Kt(e) {
	let t = e.readBits(5) + 257, n = e.readBits(5) + 1, r = e.readBits(4) + 4, i = Array(19).fill(0);
	for (let t = 0; t < r; t += 1) i[Gt[t]] = e.readBits(3);
	let a = It(i), o = [];
	for (; o.length < t + n;) {
		let t = Lt(e, a);
		if (t <= 15) o.push(t);
		else if (t === 16) {
			if (!o.length) throw new z("Repeat code length without previous value");
			let t = e.readBits(2) + 3, n = o[o.length - 1] ?? 0;
			for (let e = 0; e < t; e += 1) o.push(n);
		} else if (t === 17) {
			let t = e.readBits(3) + 3;
			for (let e = 0; e < t; e += 1) o.push(0);
		} else if (t === 18) {
			let t = e.readBits(7) + 11;
			for (let e = 0; e < t; e += 1) o.push(0);
		} else throw new z("Invalid code length symbol");
	}
	let s = o.slice(0, t), c = o.slice(t, t + n);
	if (!s[256]) throw new z("Missing end-of-block code");
	return c.some(Boolean) || (c[0] = 1), {
		literalLength: It(s),
		distance: It(c)
	};
}
function qt(e, t, n, r) {
	for (;;) {
		let i = Lt(e, n);
		if (i < 256) {
			t.push(i);
			continue;
		}
		if (i === 256) return;
		if (i < 257 || i > 285) throw new z("Invalid length symbol");
		let a = i - 257, o = Rt[a] ?? 0, s = zt[a] ?? 0;
		s && (o += e.readBits(s));
		let c = Lt(e, r);
		if (c < 0 || c >= Bt.length) throw new z("Invalid distance symbol");
		let l = Bt[c] ?? 0, u = Vt[c] ?? 0;
		u && (l += e.readBits(u)), t.copyFromBack(l, o);
	}
}
function Jt(e, t) {
	let n = new Pt(e), r = new Ft(t && t > 0 ? t : void 0), i = !1;
	for (; !i;) {
		i = n.readBit() === 1;
		let e = n.readBits(2);
		if (e === 0) {
			n.alignToByte();
			let e = n.readByte() | n.readByte() << 8, t = n.readByte() | n.readByte() << 8;
			if (((e ^ 65535) & 65535) !== t) throw new z("Invalid stored block length");
			let i = new Uint8Array(e);
			for (let t = 0; t < e; t += 1) i[t] = n.readByte();
			r.pushBytes(i);
		} else if (e === 1) {
			let e = Wt();
			qt(n, r, e.literalLength, e.distance);
		} else if (e === 2) {
			let e = Kt(n);
			qt(n, r, e.literalLength, e.distance);
		} else throw new z("Reserved deflate block type");
	}
	return r.toUint8Array(t);
}
function Yt(e) {
	let t = 1, n = 0;
	for (let r of e) t = (t + r) % 65521, n = (n + t) % 65521;
	return (n << 16 | t) >>> 0;
}
function Xt(e, t) {
	if (e.length < 6) return null;
	let n = e[0] ?? 0, r = e[1] ?? 0;
	if ((n & 15) != 8 || n >>> 4 > 7 || ((n << 8) + r) % 31 != 0 || r & 32) return null;
	try {
		let n = Jt(e.subarray(2, Math.max(2, e.length - 4)), t), r = (e[e.length - 4] ?? 0) << 24 | (e[e.length - 3] ?? 0) << 16 | (e[e.length - 2] ?? 0) << 8 | (e[e.length - 1] ?? 0);
		return r >>> 0 && Yt(n) !== r >>> 0 ? null : n;
	} catch {
		return null;
	}
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/officeart.js
var Zt = 15, Qt = 61444, $t = 61450, en = 61451, tn = 61729, nn = 61730, rn = 260, an = 390, on = 261, sn = 896, cn = 897;
function ln(e, t) {
	return t + 2 > e.length ? 0 : (e[t] ?? 0) | (e[t + 1] ?? 0) << 8;
}
function un(e, t) {
	return t + 4 > e.length ? 0 : ((e[t] ?? 0) | (e[t + 1] ?? 0) << 8 | (e[t + 2] ?? 0) << 16 | (e[t + 3] ?? 0) << 24 >>> 0) >>> 0;
}
function dn(e) {
	if (e?.length) try {
		return new TextDecoder("utf-16le").decode(e).replace(/\0+$/g, "").trim() || void 0;
	} catch {
		return;
	}
}
function fn(e) {
	if (e?.length) try {
		return new TextDecoder("windows-1252").decode(e).replace(/\0+$/g, "").trim() || void 0;
	} catch {
		return;
	}
}
function pn(e) {
	return dn(e) || fn(e);
}
function mn(e) {
	switch (e) {
		case 2: return "image/emf";
		case 3: return "image/wmf";
		case 4: return "image/pict";
		case 5: return "image/jpeg";
		case 6: return "image/png";
		case 7: return "image/dib";
		case 17: return "image/tiff";
		case 18: return "image/jpeg";
		default: return null;
	}
}
function hn(e, t) {
	if (t < 0 || t + 8 > e.length) return null;
	let n = new S(e), r = n.u16(t), i = n.u16(t + 2), a = n.u32(t + 4), o = 8 + a;
	return i < 61440 || i > 65535 || a > e.length || t + o > e.length ? null : {
		recVer: r & 15,
		recInstance: r >>> 4,
		recType: i,
		recLen: a,
		size: o
	};
}
function gn(e, t, n) {
	let r = t + 8;
	if (r + n * 6 > e.length) return [];
	let i = [], a = r, o = r + n * 6;
	for (let t = 0; t < n; t += 1) {
		let t = ln(e, a), n = un(e, a + 2);
		a += 6;
		let r = t & 16383, s = !!(t >> 14 & 1), c = !!(t >> 15 & 1), l;
		if (c) {
			if (o + n > e.length) break;
			l = e.subarray(o, o + n), o += n;
		}
		i.push({
			propertyId: r,
			isBlipId: s,
			isComplex: c,
			value: n,
			complexData: l
		});
	}
	return i;
}
function _n(e, t, n, r) {
	let i = Math.max(0, t), a = Math.min(n, e.length);
	for (; i + 8 <= a;) {
		let t = hn(e, i);
		if (!t || i + t.size > a) i += 1;
		else {
			if (r(i, t) === !0 || t.recVer === Zt && _n(e, i + 8, i + t.size, r)) return !0;
			i += t.size;
		}
	}
	return !1;
}
function vn(e, t = 0) {
	let n = null;
	return _n(e, t, e.length, (t, r) => {
		if (r.recType !== Qt || r.recVer !== Zt) return !1;
		let i = t + r.size, a = t + 8, o = 0, s, c, l;
		for (; a + 8 <= i;) {
			let t = hn(e, a);
			if (!t || a + t.size > i) break;
			if (t.recType === $t && t.recLen >= 8) o = un(e, a + 8);
			else if (t.recType === en || t.recType === tn || t.recType === nn) {
				let n = gn(e, a, t.recInstance);
				for (let e of n) (e.isBlipId || e.propertyId === rn || e.propertyId === an) && e.value > 0 ? s = e.value : e.propertyId === sn ? c = pn(e.complexData) || c : (e.propertyId === cn || e.propertyId === on) && (l = pn(e.complexData) || l);
			}
			a += t.size;
		}
		return o ? (n = {
			shapeId: o,
			blipIndex: s,
			name: c,
			description: l
		}, !0) : !1;
	}), n;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/vector.js
var yn = {
	color: "#000000",
	width: 1
}, bn = {
	color: "#ffffff",
	none: !0
}, xn = {
	family: "sans-serif",
	size: 12
}, Sn = {
	m11: 1,
	m12: 0,
	m21: 0,
	m22: 1,
	dx: 0,
	dy: 0
}, Cn = 2596720087, wn = 18, B = {
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
}, V = {
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
}, H = {
	WHITE_BRUSH: 2147483648,
	LTGRAY_BRUSH: 2147483649,
	GRAY_BRUSH: 2147483650,
	DKGRAY_BRUSH: 2147483651,
	BLACK_BRUSH: 2147483652,
	NULL_BRUSH: 2147483653,
	WHITE_PEN: 2147483654,
	BLACK_PEN: 2147483655,
	NULL_PEN: 2147483656
}, Tn = {
	MWT_IDENTITY: 1,
	MWT_LEFTMULTIPLY: 2,
	MWT_RIGHTMULTIPLY: 3,
	MWT_SET: 4
};
function U(e) {
	let t = Math.round(e * 100) / 100;
	return String(t);
}
function W(e) {
	return Math.max(1, e.right - e.left || 0);
}
function G(e) {
	return Math.max(1, e.bottom - e.top || 0);
}
function En(e) {
	return {
		left: Math.min(e.left, e.right),
		top: Math.min(e.top, e.bottom),
		right: Math.max(e.left, e.right),
		bottom: Math.max(e.top, e.bottom)
	};
}
function Dn(e, t) {
	for (let n of t) Number.isFinite(n.x) && Number.isFinite(n.y) && (e.contentBounds ? (e.contentBounds.left = Math.min(e.contentBounds.left, n.x), e.contentBounds.top = Math.min(e.contentBounds.top, n.y), e.contentBounds.right = Math.max(e.contentBounds.right, n.x), e.contentBounds.bottom = Math.max(e.contentBounds.bottom, n.y)) : e.contentBounds = {
		left: n.x,
		top: n.y,
		right: n.x,
		bottom: n.y
	});
}
function K(e) {
	let t = e & 255, n = e >>> 8 & 255, r = e >>> 16 & 255;
	return `#${t.toString(16).padStart(2, "0")}${n.toString(16).padStart(2, "0")}${r.toString(16).padStart(2, "0")}`;
}
function On(e, t) {
	let n = /* @__PURE__ */ new Uint8Array(14), r = new DataView(n.buffer);
	return n[0] = 66, n[1] = 77, r.setUint32(2, t >>> 0, !0), r.setUint32(10, e >>> 0, !0), n;
}
function kn(e, t) {
	if (e.length < 12 || !t.length) return null;
	let n = 14 + e.length, r = n + t.length, i = new Uint8Array(r);
	return i.set(On(n, r), 0), i.set(e, 14), i.set(t, n), i;
}
function An(e, t, n) {
	let r = Math.max(1, Math.abs(t) || 1), i = {
		color: n,
		width: r
	};
	switch (e & 15) {
		case 1: return {
			...i,
			dasharray: `${r * 4} ${r * 2}`
		};
		case 2: return {
			...i,
			dasharray: `${r} ${r * 2}`
		};
		case 3: return {
			...i,
			dasharray: `${r * 4} ${r * 2} ${r} ${r * 2}`
		};
		case 4: return {
			...i,
			dasharray: `${r * 4} ${r * 2} ${r} ${r * 2} ${r} ${r * 2}`
		};
		case 5: return {
			...i,
			none: !0
		};
		default: return i;
	}
}
function jn(e, t) {
	return e === 1 ? {
		color: t,
		none: !0
	} : { color: t };
}
function Mn(e) {
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
function Nn(e, t) {
	let n = e.view;
	return {
		m11: e.ensure(t, 4) ? n.getFloat32(t, !0) : 1,
		m12: e.ensure(t + 4, 4) ? n.getFloat32(t + 4, !0) : 0,
		m21: e.ensure(t + 8, 4) ? n.getFloat32(t + 8, !0) : 0,
		m22: e.ensure(t + 12, 4) ? n.getFloat32(t + 12, !0) : 1,
		dx: e.ensure(t + 16, 4) ? n.getFloat32(t + 16, !0) : 0,
		dy: e.ensure(t + 20, 4) ? n.getFloat32(t + 20, !0) : 0
	};
}
function Pn(e, t) {
	return {
		m11: e.m11 * t.m11 + e.m12 * t.m21,
		m12: e.m11 * t.m12 + e.m12 * t.m22,
		m21: e.m21 * t.m11 + e.m22 * t.m21,
		m22: e.m21 * t.m12 + e.m22 * t.m22,
		dx: e.dx * t.m11 + e.dy * t.m21 + t.dx,
		dy: e.dx * t.m12 + e.dy * t.m22 + t.dy
	};
}
function Fn(e, t) {
	return {
		x: t.x * e.m11 + t.y * e.m21 + e.dx,
		y: t.x * e.m12 + t.y * e.m22 + e.dy
	};
}
function In(e, t) {
	return {
		x: t.x * e.m11 + t.y * e.m21,
		y: t.x * e.m12 + t.y * e.m22
	};
}
function Ln(e, t, n) {
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
			windowOrg: {
				x: n.left,
				y: n.top
			},
			windowExt: {
				x: W(n),
				y: G(n)
			},
			viewportOrg: {
				x: n.left,
				y: n.top
			},
			viewportExt: {
				x: W(n),
				y: G(n)
			},
			worldTransform: { ...Sn },
			currentPosition: {
				x: 0,
				y: 0
			},
			pen: { ...yn },
			brush: { ...bn },
			font: { ...xn },
			textColor: "#000000",
			bkColor: "#ffffff",
			bkMode: 1,
			textAlign: 0,
			polygonFillMode: 1
		}
	};
}
function q(e, t) {
	let n = Fn(e.state.worldTransform, t), r = e.state.windowExt.x || W(e.viewBox) || 1, i = e.state.windowExt.y || G(e.viewBox) || 1, a = e.state.viewportExt.x || W(e.viewBox) || 1, o = e.state.viewportExt.y || G(e.viewBox) || 1;
	return {
		x: e.state.viewportOrg.x + (n.x - e.state.windowOrg.x) * a / r,
		y: e.state.viewportOrg.y + (n.y - e.state.windowOrg.y) * o / i
	};
}
function Rn(e, t) {
	let n = In(e.state.worldTransform, t), r = e.state.windowExt.x || W(e.viewBox) || 1, i = e.state.windowExt.y || G(e.viewBox) || 1, a = e.state.viewportExt.x || W(e.viewBox) || 1, o = e.state.viewportExt.y || G(e.viewBox) || 1;
	return {
		x: n.x * a / r,
		y: n.y * o / i
	};
}
function zn(e, t) {
	let n = [
		q(e, {
			x: t.left,
			y: t.top
		}),
		q(e, {
			x: t.right,
			y: t.top
		}),
		q(e, {
			x: t.right,
			y: t.bottom
		}),
		q(e, {
			x: t.left,
			y: t.bottom
		})
	];
	return En({
		left: Math.min(...n.map((e) => e.x)),
		top: Math.min(...n.map((e) => e.y)),
		right: Math.max(...n.map((e) => e.x)),
		bottom: Math.max(...n.map((e) => e.y))
	});
}
function J(e) {
	return `${U(e.x)},${U(e.y)}`;
}
function Bn(e, t) {
	let n = Math.max(1, Math.abs(t.width) || 1), r = Rn(e, {
		x: n,
		y: 0
	}), i = Rn(e, {
		x: 0,
		y: n
	}), a = (Math.hypot(r.x, r.y) + Math.hypot(i.x, i.y)) / 2;
	return !Number.isFinite(a) || a <= 0 ? n : Math.max(.5, a);
}
function Vn(e, t) {
	if (!t.dasharray) return;
	let n = Math.max(1, Math.abs(t.width) || 1), r = Bn(e, t) / n;
	return t.dasharray.split(/\s+/).map((e) => Number(e)).filter((e) => Number.isFinite(e) && e > 0).map((e) => U(e * r)).join(" ") || void 0;
}
function Hn(e, t) {
	if (t.none) return "stroke=\"none\"";
	let n = [
		`stroke="${l(t.color)}"`,
		`stroke-width="${U(Bn(e, t))}"`,
		"fill=\"none\""
	], r = Vn(e, t);
	return r && n.push(`stroke-dasharray="${l(r)}"`), n.join(" ");
}
function Un(e) {
	let t = [e.state.pen.none ? "stroke=\"none\"" : `stroke="${l(e.state.pen.color)}"`, e.state.pen.none ? "" : `stroke-width="${U(Bn(e, e.state.pen))}"`].filter(Boolean), n = Vn(e, e.state.pen);
	return n && !e.state.pen.none && t.push(`stroke-dasharray="${l(n)}"`), t.push(e.state.brush.none ? "fill=\"none\"" : `fill="${l(e.state.brush.color)}"`), t.push(`fill-rule="${e.state.polygonFillMode === 2 ? "nonzero" : "evenodd"}"`), t.join(" ");
}
function Wn(e) {
	let t = ["stroke=\"none\""];
	return t.push(e.state.brush.none ? "fill=\"none\"" : `fill="${l(e.state.brush.color)}"`), t.push(`fill-rule="${e.state.polygonFillMode === 2 ? "nonzero" : "evenodd"}"`), t.join(" ");
}
function Gn(e) {
	let t = e.findIndex((e) => e == null);
	return t >= 0 ? t : (e.push(null), e.length - 1);
}
function Y(e, t, n) {
	for (; e.length <= t;) e.push(null);
	e[t] = n;
}
function Kn(e, t) {
	switch (t >>> 0) {
		case H.WHITE_BRUSH: return e.state.brush = { color: "#ffffff" }, !0;
		case H.LTGRAY_BRUSH: return e.state.brush = { color: "#c0c0c0" }, !0;
		case H.GRAY_BRUSH: return e.state.brush = { color: "#808080" }, !0;
		case H.DKGRAY_BRUSH: return e.state.brush = { color: "#404040" }, !0;
		case H.BLACK_BRUSH: return e.state.brush = { color: "#000000" }, !0;
		case H.NULL_BRUSH: return e.state.brush = {
			color: "none",
			none: !0
		}, !0;
		case H.WHITE_PEN: return e.state.pen = {
			color: "#ffffff",
			width: 1
		}, !0;
		case H.BLACK_PEN: return e.state.pen = {
			color: "#000000",
			width: 1
		}, !0;
		case H.NULL_PEN: return e.state.pen = {
			color: "none",
			width: 1,
			none: !0
		}, !0;
		default: return !1;
	}
}
function qn(e, t) {
	if (Kn(e, t)) return;
	let n = e.objects[t] || null;
	n && (n.kind === "pen" && (e.state.pen = { ...n.value }), n.kind === "brush" && (e.state.brush = { ...n.value }), n.kind === "font" && (e.state.font = { ...n.value }));
}
function X(e, t, n) {
	e.nodes.push(t), Dn(e, n);
}
function Jn(e, t, n) {
	t && (e.pathData.push(t), e.pathPoints.push(...n));
}
function Yn(e, t) {
	e.pathData.length && (X(e, `<path d="${e.pathData.join(" ")}" ${t} />`, e.pathPoints), e.pathData = [], e.pathPoints = [], e.capturePath = !1);
}
function Xn(e, t, n) {
	let r = q(e, t), i = q(e, n);
	e.state.currentPosition = { ...n }, e.capturePath ? Jn(e, `${e.pathData.length ? "" : `M ${J(r)}`} L ${J(i)}`.trim(), [r, i]) : X(e, `<line x1="${U(r.x)}" y1="${U(r.y)}" x2="${U(i.x)}" y2="${U(i.y)}" ${Hn(e, e.state.pen)} />`, [r, i]);
}
function Zn(e, t, n) {
	if (!t.length) return;
	let r = t.map((t) => q(e, t));
	e.state.currentPosition = { ...t[t.length - 1] };
	let i = r.map(J).join(" ");
	if (e.capturePath) {
		let t = [`M ${J(r[0])}`, ...r.slice(1).map((e) => `L ${J(e)}`)];
		n && t.push("Z"), Jn(e, t.join(" "), r);
	} else X(e, `<${n ? "polygon" : "polyline"} points="${i}" ${n ? Un(e) : Hn(e, e.state.pen)} />`, r);
}
function Qn(e, t, n = !1) {
	let r = [];
	if (n && r.push({ ...e.state.currentPosition }), r.push(...t), r.length < 4) return;
	let i = r.map((t) => q(e, t)), a = `M ${J(i[0])}`;
	for (let e = 1; e + 2 < i.length; e += 3) a += ` C ${J(i[e])} ${J(i[e + 1])} ${J(i[e + 2])}`;
	e.state.currentPosition = { ...r[r.length - 1] }, e.capturePath ? Jn(e, a, i) : X(e, `<path d="${a}" ${Hn(e, e.state.pen)} />`, i);
}
function $n(e, t, n) {
	let r = zn(e, t), i = [
		`x="${U(r.left)}"`,
		`y="${U(r.top)}"`,
		`width="${U(W(r))}"`,
		`height="${U(G(r))}"`
	];
	if (n) {
		let t = q(e, {
			x: n.x,
			y: n.y
		});
		i.push(`rx="${U(Math.abs(t.x - e.state.viewportOrg.x))}"`), i.push(`ry="${U(Math.abs(t.y - e.state.viewportOrg.y))}"`);
	}
	e.capturePath ? Jn(e, `M ${U(r.left)},${U(r.top)} L ${U(r.right)},${U(r.top)} L ${U(r.right)},${U(r.bottom)} L ${U(r.left)},${U(r.bottom)} Z`, [{
		x: r.left,
		y: r.top
	}, {
		x: r.right,
		y: r.bottom
	}]) : X(e, `<rect ${i.join(" ")} ${Un(e)} />`, [{
		x: r.left,
		y: r.top
	}, {
		x: r.right,
		y: r.bottom
	}]);
}
function er(e, t) {
	let n = zn(e, t), r = (n.left + n.right) / 2, i = (n.top + n.bottom) / 2, a = W(n) / 2, o = G(n) / 2;
	e.capturePath ? Jn(e, `M ${U(r - a)},${U(i)} A ${U(a)},${U(o)} 0 1 0 ${U(r + a)},${U(i)} A ${U(a)},${U(o)} 0 1 0 ${U(r - a)},${U(i)} Z`, [{
		x: n.left,
		y: n.top
	}, {
		x: n.right,
		y: n.bottom
	}]) : X(e, `<ellipse cx="${U(r)}" cy="${U(i)}" rx="${U(a)}" ry="${U(o)}" ${Un(e)} />`, [{
		x: n.left,
		y: n.top
	}, {
		x: n.right,
		y: n.bottom
	}]);
}
function tr(e, t, n) {
	if (!n.length) return;
	let r = zn(e, t), i = W(r), a = G(r), o = p(n, "image/bmp");
	X(e, `<image x="${U(r.left)}" y="${U(r.top)}" width="${U(i)}" height="${U(a)}" href="${o}" preserveAspectRatio="none" />`, [{
		x: r.left,
		y: r.top
	}, {
		x: r.right,
		y: r.bottom
	}]);
}
function nr(e) {
	return new TextDecoder("windows-1252").decode(e).replace(/\0+$/g, "");
}
function rr(e) {
	return new TextDecoder("utf-16le").decode(e).replace(/\0+$/g, "");
}
function ir(e) {
	let t = e & 6;
	return t === 2 ? "end" : t === 6 ? "middle" : "start";
}
function ar(e) {
	let t = e & 24;
	return t === 8 ? "text-after-edge" : t === 24 ? "alphabetic" : "text-before-edge";
}
function or(e, t, n) {
	if (!n) return;
	let r = q(e, t), i = Rn(e, {
		x: 0,
		y: Math.abs(e.state.font.size) || 12
	}), a = Math.hypot(i.x, i.y), o = Math.max(1, Number.isFinite(a) && a > 0 ? a : Math.abs(e.state.font.size) || 12), s = String(e.state.font.family || "sans-serif").replace(/\s+(?:Baltic|CE|Cyr|Greek|Tur|Vietnamese|Hebrew|Arabic|Thai|Symbol)$/i, "") || "sans-serif", c = [
		`x="${U(r.x)}"`,
		`y="${U(r.y)}"`,
		`fill="${l(e.state.textColor)}"`,
		`font-size="${U(o)}"`,
		`font-family="${l(s)}"`,
		`text-anchor="${ir(e.state.textAlign)}"`,
		`dominant-baseline="${ar(e.state.textAlign)}"`
	];
	e.state.font.weight && e.state.font.weight >= 600 && c.push("font-weight=\"700\""), e.state.font.italic && c.push("font-style=\"italic\"");
	let u = [e.state.font.underline ? "underline" : "", e.state.font.strike ? "line-through" : ""].filter(Boolean);
	u.length && c.push(`text-decoration="${u.join(" ")}"`), e.state.font.escapement && c.push(`transform="rotate(${U(e.state.font.escapement / 10)}, ${U(r.x)}, ${U(r.y)})"`), X(e, `<text ${c.join(" ")}>${l(n)}</text>`, [r]);
}
function sr(e, t) {
	if (!e.nodes.length) return null;
	let n = e.contentBounds ? En(e.contentBounds) : En(e.viewBox), r = En({
		left: Number.isFinite(e.viewBox.left) ? e.viewBox.left : n.left,
		top: Number.isFinite(e.viewBox.top) ? e.viewBox.top : n.top,
		right: Number.isFinite(e.viewBox.right) ? e.viewBox.right : n.right,
		bottom: Number.isFinite(e.viewBox.bottom) ? e.viewBox.bottom : n.bottom
	}), i = Math.max(1, Math.round(W(r))), a = Math.max(1, Math.round(G(r))), o = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${i}" height="${a}" viewBox="${U(r.left)} ${U(r.top)} ${U(W(r))} ${U(G(r))}" preserveAspectRatio="xMinYMin meet">\n${e.nodes.join("\n")}\n</svg>`, s = new TextEncoder().encode(o);
	return {
		mime: "image/svg+xml",
		bytes: s,
		dataUrl: p(s, "image/svg+xml"),
		width: i,
		height: a,
		sourceMime: t,
		recordCount: e.recordCount
	};
}
function cr(e) {
	let t = new S(e), n = 0, r = null;
	if (t.u32(0) === Cn && e.length >= 22 && (r = En({
		left: t.i16(6),
		top: t.i16(8),
		right: t.i16(10),
		bottom: t.i16(12)
	}), n = 22), n + wn > e.length) return null;
	let i = new S(e.subarray(n)), a = i.u16(2), o = i.u16(10), s = n + a * 2;
	if (s > e.length) return null;
	let c = r || {
		left: 0,
		top: 0,
		right: 1e3,
		bottom: 1e3
	}, l = Ln(W(c), G(c), c);
	l.objects = Array(Math.max(0, o)).fill(null), r && (l.state.windowOrg = {
		x: r.left,
		y: r.top
	}, l.state.windowExt = {
		x: W(r),
		y: G(r)
	}, l.state.viewportOrg = {
		x: r.left,
		y: r.top
	}, l.state.viewportExt = {
		x: W(r),
		y: G(r)
	});
	let u = s;
	for (; u + 6 <= e.length;) {
		let t = new S(e.subarray(u)), n = t.u32(0) * 2;
		if (n < 6 || u + n > e.length) break;
		let r = t.u16(4);
		switch (l.recordCount += 1, r) {
			case B.META_EOF: return u += n, sr(l, "image/wmf");
			case B.META_SETWINDOWORG:
				l.state.windowOrg = {
					x: t.i16(8),
					y: t.i16(6)
				};
				break;
			case B.META_SETWINDOWEXT:
				l.state.windowExt = {
					x: t.i16(8),
					y: t.i16(6)
				};
				break;
			case B.META_SETVIEWPORTORG:
				l.state.viewportOrg = {
					x: t.i16(8),
					y: t.i16(6)
				};
				break;
			case B.META_SETVIEWPORTEXT:
				l.state.viewportExt = {
					x: t.i16(8),
					y: t.i16(6)
				};
				break;
			case B.META_OFFSETWINDOWORG:
				l.state.windowOrg = {
					x: l.state.windowOrg.x + t.i16(8),
					y: l.state.windowOrg.y + t.i16(6)
				};
				break;
			case B.META_OFFSETVIEWPORTORG:
				l.state.viewportOrg = {
					x: l.state.viewportOrg.x + t.i16(8),
					y: l.state.viewportOrg.y + t.i16(6)
				};
				break;
			case B.META_SETBKMODE:
				l.state.bkMode = t.u16(6);
				break;
			case B.META_SETPOLYFILLMODE:
				l.state.polygonFillMode = t.u16(6);
				break;
			case B.META_SETBKCOLOR:
				l.state.bkColor = K(t.u32(6));
				break;
			case B.META_SETTEXTCOLOR:
				l.state.textColor = K(t.u32(6));
				break;
			case B.META_MOVETO:
				l.state.currentPosition = {
					x: t.i16(8),
					y: t.i16(6)
				};
				break;
			case B.META_LINETO: {
				let e = {
					x: t.i16(8),
					y: t.i16(6)
				};
				Xn(l, l.state.currentPosition, e);
				break;
			}
			case B.META_POLYLINE:
			case B.META_POLYGON: {
				let e = t.u16(6), i = [], a = 8;
				for (let r = 0; r < e && a + 4 <= n; r += 1) i.push({
					x: t.i16(a),
					y: t.i16(a + 2)
				}), a += 4;
				Zn(l, i, r === B.META_POLYGON);
				break;
			}
			case B.META_POLYPOLYGON: {
				let e = t.u16(6), r = [], i = 8;
				for (let a = 0; a < e && i + 2 <= n; a += 1) r.push(t.u16(i)), i += 2;
				for (let e of r) {
					let r = [];
					for (let a = 0; a < e && i + 4 <= n; a += 1) r.push({
						x: t.i16(i),
						y: t.i16(i + 2)
					}), i += 4;
					Zn(l, r, !0);
				}
				break;
			}
			case B.META_RECTANGLE:
				$n(l, {
					left: t.i16(12),
					top: t.i16(10),
					right: t.i16(8),
					bottom: t.i16(6)
				});
				break;
			case B.META_ELLIPSE:
				er(l, {
					left: t.i16(12),
					top: t.i16(10),
					right: t.i16(8),
					bottom: t.i16(6)
				});
				break;
			case B.META_ROUNDRECT:
				$n(l, {
					left: t.i16(16),
					top: t.i16(14),
					right: t.i16(12),
					bottom: t.i16(10)
				}, {
					x: t.i16(8),
					y: t.i16(6)
				});
				break;
			case B.META_TEXTOUT: {
				let e = t.u16(6), r = e + e % 2, i = nr(t.slice(8, Math.min(e, Math.max(0, n - 8 - 4)))), a = 8 + r, o = t.i16(a);
				or(l, {
					x: t.i16(a + 2),
					y: o
				}, i);
				break;
			}
			case B.META_CREATEPENINDIRECT: {
				let e = t.u16(6), n = t.i16(8), r = K(t.u32(12)), i = Gn(l.objects);
				Y(l.objects, i, {
					kind: "pen",
					value: An(e, n, r)
				});
				break;
			}
			case B.META_CREATEBRUSHINDIRECT: {
				let e = t.u16(6), n = K(t.u32(8)), r = Gn(l.objects);
				Y(l.objects, r, {
					kind: "brush",
					value: jn(e, n)
				});
				break;
			}
			case B.META_CREATEFONTINDIRECT: {
				let e = Math.abs(t.i16(6)), r = t.i16(10), i = t.u16(14), a = !!t.u8(16), o = !!t.u8(17), s = !!t.u8(18), c = nr(t.slice(24, Math.max(0, n - 24))).split("\0")[0] || "sans-serif", u = Gn(l.objects);
				Y(l.objects, u, {
					kind: "font",
					value: {
						family: c,
						size: e || 12,
						weight: i,
						italic: a,
						underline: o,
						strike: s,
						escapement: r
					}
				});
				break;
			}
			case B.META_SELECTOBJECT:
				qn(l, t.u16(6));
				break;
			case B.META_DELETEOBJECT: {
				let e = t.u16(6);
				e >= 0 && e < l.objects.length && (l.objects[e] = null);
				break;
			}
		}
		u += n;
	}
	return sr(l, "image/wmf");
}
function lr(e, t, n, r) {
	let i = [];
	for (let a = 0; a < n; a += 1) {
		let n = t + a * r;
		r === 8 ? i.push({
			x: e.i32(n),
			y: e.i32(n + 4)
		}) : i.push({
			x: e.i16(n),
			y: e.i16(n + 2)
		});
	}
	return i;
}
function ur(e, t) {
	if (!e.ensure(36, 40)) return null;
	let n = {
		x: e.i32(36),
		y: e.i32(40)
	}, r = e.u32(44), i = e.u32(48);
	if (!r || !i || i >= e.length) return null;
	let a = t ? r * 2 : r, o = e.slice(i, a);
	return {
		point: n,
		text: t ? rr(o) : nr(o)
	};
}
function dr(e) {
	if (!e.ensure(8, 24)) return null;
	let t = {
		x: e.i32(8),
		y: e.i32(12)
	}, n = e.u32(16), r = e.u32(20), i = 36;
	return r & 2 && (i += 16), !n || !e.ensure(i, n) ? null : {
		point: t,
		text: nr(e.slice(i, n))
	};
}
function fr(e, t, n, r, i) {
	let a = e.u32(t), o = e.u32(n), s = e.u32(r), c = e.u32(i);
	return !a || !o || !s || !c || !e.ensure(a, o) || !e.ensure(s, c) ? null : kn(e.slice(a, o), e.slice(s, c));
}
function pr(e, t) {
	if (!t.ensure(24, 56)) return;
	let n = fr(t, 48, 52, 56, 60);
	n && tr(e, {
		left: t.i32(24),
		top: t.i32(28),
		right: t.i32(24) + t.i32(72),
		bottom: t.i32(28) + t.i32(76)
	}, n);
}
function mr(e, t) {
	if (!t.ensure(24, 76)) return;
	let n = fr(t, 84, 88, 92, 96);
	n && tr(e, {
		left: t.i32(24),
		top: t.i32(28),
		right: t.i32(24) + t.i32(32),
		bottom: t.i32(28) + t.i32(36)
	}, n);
}
function hr(e) {
	e.pathData.length && e.pathData.push("Z");
}
function gr(e) {
	let t = new S(e);
	if (!t.ensure(0, 52) || t.u32(0) !== V.EMR_HEADER) return null;
	let n = En({
		left: t.i32(8),
		top: t.i32(12),
		right: t.i32(16),
		bottom: t.i32(20)
	}), r = W(n) > 0 && G(n) > 0 ? n : {
		left: 0,
		top: 0,
		right: 1e3,
		bottom: 1e3
	}, i = Ln(W(r), G(r), r);
	i.state.windowOrg = {
		x: r.left,
		y: r.top
	}, i.state.windowExt = {
		x: W(r),
		y: G(r)
	}, i.state.viewportOrg = {
		x: r.left,
		y: r.top
	}, i.state.viewportExt = {
		x: W(r),
		y: G(r)
	};
	let a = 0;
	for (; a + 8 <= e.length;) {
		let t = new S(e.subarray(a)), n = t.u32(0), r = t.u32(4);
		if (r < 8 || a + r > e.length) break;
		switch (i.recordCount += 1, n) {
			case V.EMR_EOF: return a += r, sr(i, "image/emf");
			case V.EMR_SETWINDOWORGEX:
				i.state.windowOrg = {
					x: t.i32(8),
					y: t.i32(12)
				};
				break;
			case V.EMR_SETWINDOWEXTEX:
				i.state.windowExt = {
					x: t.i32(8),
					y: t.i32(12)
				};
				break;
			case V.EMR_SETVIEWPORTORGEX:
				i.state.viewportOrg = {
					x: t.i32(8),
					y: t.i32(12)
				};
				break;
			case V.EMR_SETVIEWPORTEXTEX:
				i.state.viewportExt = {
					x: t.i32(8),
					y: t.i32(12)
				};
				break;
			case V.EMR_SETBKMODE:
				i.state.bkMode = t.u32(8);
				break;
			case V.EMR_SETPOLYFILLMODE:
				i.state.polygonFillMode = t.u32(8);
				break;
			case V.EMR_SETTEXTALIGN:
				i.state.textAlign = t.u32(8);
				break;
			case V.EMR_SETTEXTCOLOR:
				i.state.textColor = K(t.u32(8));
				break;
			case V.EMR_SETBKCOLOR:
				i.state.bkColor = K(t.u32(8));
				break;
			case V.EMR_SAVEDC:
				i.stateStack.push(Mn(i.state));
				break;
			case V.EMR_RESTOREDC: {
				let e = t.i32(8);
				if (e < 0) {
					let t = Math.min(i.stateStack.length, Math.abs(e));
					for (let e = 0; e < t - 1; e += 1) i.stateStack.pop();
					let n = i.stateStack.pop();
					n && (i.state = Mn(n));
				} else if (e > 0 && e <= i.stateStack.length) {
					let t = i.stateStack[e - 1];
					i.stateStack.length = e - 1, t && (i.state = Mn(t));
				}
				break;
			}
			case V.EMR_SETWORLDTRANSFORM:
				i.state.worldTransform = Nn(t, 8);
				break;
			case V.EMR_MODIFYWORLDTRANSFORM: {
				let e = Nn(t, 8), n = t.u32(32);
				n === Tn.MWT_IDENTITY ? i.state.worldTransform = { ...Sn } : n === Tn.MWT_SET ? i.state.worldTransform = e : n === Tn.MWT_LEFTMULTIPLY ? i.state.worldTransform = Pn(e, i.state.worldTransform) : n === Tn.MWT_RIGHTMULTIPLY && (i.state.worldTransform = Pn(i.state.worldTransform, e));
				break;
			}
			case V.EMR_MOVETOEX:
				i.state.currentPosition = {
					x: t.i32(8),
					y: t.i32(12)
				};
				break;
			case V.EMR_LINETO: {
				let e = {
					x: t.i32(8),
					y: t.i32(12)
				};
				Xn(i, i.state.currentPosition, e);
				break;
			}
			case V.EMR_POLYLINE:
			case V.EMR_POLYGON:
			case V.EMR_POLYLINE16:
			case V.EMR_POLYGON16:
				Zn(i, lr(t, 28, t.u32(24), n === V.EMR_POLYLINE16 || n === V.EMR_POLYGON16 ? 4 : 8), n === V.EMR_POLYGON || n === V.EMR_POLYGON16);
				break;
			case V.EMR_POLYBEZIER:
			case V.EMR_POLYBEZIER16:
				Qn(i, lr(t, 28, t.u32(24), n === V.EMR_POLYBEZIER16 ? 4 : 8), !1);
				break;
			case V.EMR_POLYBEZIERTO:
			case V.EMR_POLYBEZIERTO16:
				Qn(i, lr(t, 28, t.u32(24), n === V.EMR_POLYBEZIERTO16 ? 4 : 8), !0);
				break;
			case V.EMR_POLYLINETO:
			case V.EMR_POLYLINETO16: {
				let e = lr(t, 28, t.u32(24), n === V.EMR_POLYLINETO16 ? 4 : 8);
				Zn(i, [{ ...i.state.currentPosition }, ...e], !1);
				break;
			}
			case V.EMR_POLYPOLYLINE:
			case V.EMR_POLYPOLYGON:
			case V.EMR_POLYPOLYLINE16:
			case V.EMR_POLYPOLYGON16: {
				let e = t.u32(24), r = t.u32(28), a = n === V.EMR_POLYPOLYLINE16 || n === V.EMR_POLYPOLYGON16 ? 4 : 8, o = 32 + e * 4, s = [];
				for (let n = 0; n < e; n += 1) s.push(t.u32(32 + n * 4));
				let c = lr(t, o, r, a), l = 0;
				for (let e of s) Zn(i, c.slice(l, l + e), n === V.EMR_POLYPOLYGON || n === V.EMR_POLYPOLYGON16), l += e;
				break;
			}
			case V.EMR_RECTANGLE:
				$n(i, {
					left: t.i32(8),
					top: t.i32(12),
					right: t.i32(16),
					bottom: t.i32(20)
				});
				break;
			case V.EMR_ELLIPSE:
				er(i, {
					left: t.i32(8),
					top: t.i32(12),
					right: t.i32(16),
					bottom: t.i32(20)
				});
				break;
			case V.EMR_ROUNDRECT:
				$n(i, {
					left: t.i32(8),
					top: t.i32(12),
					right: t.i32(16),
					bottom: t.i32(20)
				}, {
					x: t.i32(24),
					y: t.i32(28)
				});
				break;
			case V.EMR_BEGINPATH:
				i.capturePath = !0, i.pathData = [], i.pathPoints = [];
				break;
			case V.EMR_ENDPATH:
				i.capturePath = !1;
				break;
			case V.EMR_CLOSEFIGURE:
				hr(i);
				break;
			case V.EMR_FILLPATH:
				Yn(i, Wn(i));
				break;
			case V.EMR_STROKEANDFILLPATH:
				Yn(i, Un(i));
				break;
			case V.EMR_STROKEPATH:
				Yn(i, Hn(i, i.state.pen));
				break;
			case V.EMR_SELECTCLIPPATH:
				i.capturePath = !1, i.pathData = [], i.pathPoints = [];
				break;
			case V.EMR_CREATEPEN: {
				let e = t.u32(8), n = t.u32(12), r = t.i32(16), a = K(t.u32(24));
				Y(i.objects, e, {
					kind: "pen",
					value: An(n, r, a)
				});
				break;
			}
			case V.EMR_CREATEBRUSHINDIRECT: {
				let e = t.u32(8), n = t.u32(12), r = K(t.u32(16));
				Y(i.objects, e, {
					kind: "brush",
					value: jn(n, r)
				});
				break;
			}
			case V.EMR_EXTCREATEPEN: {
				let e = t.u32(8), n = t.u32(28), r = t.i32(32), a = t.u32(36), o = a === 1 ? "none" : K(t.u32(40));
				Y(i.objects, e, {
					kind: "pen",
					value: a === 1 ? {
						color: o,
						width: r,
						none: !0
					} : An(n, r, o)
				});
				break;
			}
			case V.EMR_EXTCREATEFONTINDIRECTW: {
				let e = t.u32(8), n = Math.abs(t.i32(12)), r = t.i32(20), a = t.i32(28), o = !!t.u8(32), s = !!t.u8(33), c = !!t.u8(34), l = rr(t.slice(40, 64)).split("\0")[0] || "sans-serif";
				Y(i.objects, e, {
					kind: "font",
					value: {
						family: l,
						size: n || 12,
						weight: a,
						italic: o,
						underline: s,
						strike: c,
						escapement: r
					}
				});
				break;
			}
			case V.EMR_SELECTOBJECT:
				qn(i, t.u32(8));
				break;
			case V.EMR_DELETEOBJECT: {
				let e = t.u32(8);
				e >= 0 && e < i.objects.length && (i.objects[e] = null);
				break;
			}
			case V.EMR_EXTTEXTOUTA: {
				let e = ur(t, !1);
				e && or(i, e.point, e.text);
				break;
			}
			case V.EMR_EXTTEXTOUTW: {
				let e = ur(t, !0);
				e && or(i, e.point, e.text);
				break;
			}
			case V.EMR_SMALLTEXTOUT: {
				let e = dr(t);
				e && or(i, e.point, e.text);
				break;
			}
			case V.EMR_STRETCHDIBITS:
				pr(i, t);
				break;
			case V.EMR_BITBLT:
			case V.EMR_STRETCHBLT:
			case V.EMR_ALPHABLEND: mr(i, t);
		}
		a += r;
	}
	return sr(i, "image/emf");
}
function _r(e, t) {
	return t.length ? /image\/emf/i.test(e) ? gr(t) : /image\/wmf/i.test(e) ? cr(t) : null : null;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/objects.js
var vr = 8388608, yr = 68, br = 102, xr = 15, Sr = 61447, Cr = 61466, wr = 61467, Tr = 61468, Er = 61469, Dr = 61470, Or = 61471, kr = 61481, Ar = 61482;
function jr(e, t, n = 0) {
	if (n + t.length > e.length) return !1;
	for (let r = 0; r < t.length; r += 1) if (e[n + r] !== t[r]) return !1;
	return !0;
}
function Mr(e) {
	for (let t = 0; t < e.length; t += 1) {
		let n = e[t] ?? 0;
		if (n !== 0 && n !== 9 && n !== 10 && n !== 13 && (n < 32 || n === 127)) return !1;
	}
	return !0;
}
function Nr(e) {
	let t = e.trim();
	return t ? /^(?:file|https?|data|blob):/i.test(t) || /^(?:\\\\|[a-zA-Z]:[\\/]|\/)/.test(t) ? !0 : /\.(?:png|apng|jpe?g|gif|bmp|dib|tiff?|emf|wmf|pict|svg)(?:$|[?#])/i.test(t) : !1;
}
function Pr(e) {
	return /^file:/i.test(e) || /^(?:\\\\|[a-zA-Z]:[\\/]|\/)/.test(e);
}
function Fr(e) {
	let t = e.toLowerCase();
	return t.includes(".png") ? "image/png" : t.includes(".jpg") || t.includes(".jpeg") ? "image/jpeg" : t.includes(".gif") ? "image/gif" : t.includes(".bmp") || t.includes(".dib") ? "image/bmp" : t.includes(".tif") ? "image/tiff" : t.includes(".emf") ? "image/emf" : t.includes(".wmf") ? "image/wmf" : t.includes(".pict") || t.includes(".pct") || t.includes(".pic") ? "image/pict" : t.includes(".svg") ? "image/svg+xml" : null;
}
function Ir(e) {
	return /^(?:image\/png|image\/jpeg|image\/gif|image\/bmp|image\/webp|image\/svg\+xml|image\/tiff)$/i.test(e);
}
function Lr(e) {
	let t = e.toLowerCase();
	return t.endsWith(".doc") ? "application/msword" : t.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : t.endsWith(".xls") ? "application/vnd.ms-excel" : t.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : t.endsWith(".ppt") ? "application/vnd.ms-powerpoint" : t.endsWith(".pptx") ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : t.endsWith(".pdf") ? "application/pdf" : t.endsWith(".png") ? "image/png" : t.endsWith(".jpg") || t.endsWith(".jpeg") ? "image/jpeg" : t.endsWith(".gif") ? "image/gif" : t.endsWith(".bmp") ? "image/bmp" : t.endsWith(".zip") ? "application/zip" : t.endsWith(".txt") ? "text/plain" : "application/octet-stream";
}
function Rr(e) {
	let t = [
		{
			mime: "image/png",
			magic: [
				137,
				80,
				78,
				71
			],
			end: zr
		},
		{
			mime: "image/jpeg",
			magic: [
				255,
				216,
				255
			],
			end: Br
		},
		{
			mime: "image/gif",
			magic: [
				71,
				73,
				70,
				56
			],
			end: Vr
		},
		{
			mime: "image/bmp",
			magic: [66, 77],
			end: Hr
		},
		{
			mime: "image/tiff",
			magic: [
				73,
				73,
				42,
				0
			],
			end: null
		},
		{
			mime: "image/tiff",
			magic: [
				77,
				77,
				0,
				42
			],
			end: null
		},
		{
			mime: "image/emf",
			magic: [
				1,
				0,
				0,
				0
			],
			end: Ur
		},
		{
			mime: "image/wmf",
			magic: [
				215,
				205,
				198,
				154
			],
			end: null
		}
	];
	for (let n = 0; n < e.length - 4; n += 1) for (let r of t) if (jr(e, r.magic, n)) {
		if (r.mime === "image/emf" && Ur(e, n) === e.length) continue;
		let t = r.end ? r.end(e, n) : e.length;
		return {
			mime: r.mime,
			start: n,
			end: t || e.length
		};
	}
	return null;
}
function zr(e, t) {
	for (let n = t + 8; n + 8 < e.length; n += 1) if (jr(e, [
		73,
		69,
		78,
		68
	], n)) return n + 8;
	return e.length;
}
function Br(e, t) {
	for (let n = t + 2; n + 1 < e.length; n += 1) if (e[n] === 255 && e[n + 1] === 217) return n + 2;
	return e.length;
}
function Vr(e, t) {
	for (let n = t + 6; n < e.length; n += 1) if (e[n] === 59) return n + 1;
	return e.length;
}
function Hr(e, t) {
	if (t + 6 <= e.length) {
		let n = new S(e.subarray(t)).u32(2);
		if (n > 0 && t + n <= e.length) return t + n;
	}
	return e.length;
}
function Ur(e, t) {
	if (t + 52 > e.length) return e.length;
	let n = new S(e.subarray(t)), r = n.u32(0), i = n.u32(40), a = n.u32(48);
	return r !== 1 || i !== 1179469088 ? e.length : a > 0 && t + a <= e.length ? t + a : e.length;
}
function Wr(e) {
	if (e.length < yr) return null;
	let t = new S(e), n = t.i16(28), r = t.i16(30), i = t.u16(32), a = t.u16(34), o = n > 0 && i > 0 ? Math.max(15, Math.min(31680, Math.round(n * i / 1e3))) : void 0, s = r > 0 && a > 0 ? Math.max(15, Math.min(31680, Math.round(r * a / 1e3))) : void 0;
	return {
		lcb: t.i32(0),
		cbHeader: t.u16(4),
		mm: t.u16(6),
		xExt: t.i16(8),
		yExt: t.i16(10),
		dxaGoalTwips: n > 0 ? n : void 0,
		dyaGoalTwips: r > 0 ? r : void 0,
		scaleXPermille: i || void 0,
		scaleYPermille: a || void 0,
		displayWidthTwips: o,
		displayHeightTwips: s
	};
}
function Gr(e, t) {
	let n = Math.min(t.cbHeader || yr, e.length);
	if (n >= e.length) return null;
	let r = e[n] ?? 0;
	if (!r || n + 1 + r > e.length) return null;
	let i = e.subarray(n + 1, n + 1 + r);
	if (!Mr(i)) return null;
	let a = new TextDecoder("windows-1252").decode(i).replace(/\0+$/g, "");
	return !Nr(a) && t.mm !== br ? null : {
		value: a,
		nextOffset: n + 1 + r
	};
}
function Kr(e, t) {
	if (t < 0 || t + 8 > e.length) return null;
	let n = new S(e), r = n.u16(t), i = n.u16(t + 2), a = n.u32(t + 4);
	if (i < 61440 || i > 65535) return null;
	let o = 8 + a;
	return a > e.length || t + o > e.length ? null : {
		recVer: r & 15,
		recInstance: r >>> 4,
		recType: i,
		recLen: a,
		size: o
	};
}
function qr(e, t) {
	let n = /* @__PURE__ */ new Uint8Array(14), r = new DataView(n.buffer);
	return r.setUint8(0, 66), r.setUint8(1, 77), r.setUint32(2, t, !0), r.setUint16(6, 0, !0), r.setUint16(8, 0, !0), r.setUint32(10, e, !0), n;
}
function Jr(e) {
	if (e.length < 12) return null;
	let t = new S(e), n = t.u32(0);
	if (n < 12 || n > e.length) return null;
	let r = 0, i = 0, a = 0, o = 4;
	n === 12 ? (r = t.u16(10), o = 3) : (r = t.u16(14), i = t.u32(16), a = t.u32(32));
	let s = (a || (r > 0 && r <= 8 ? 1 << r : 0)) * o;
	i === 3 && n >= 40 && (s += 12);
	let c = 14 + n + s;
	if (c > 14 + e.length) return null;
	let l = qr(c, 14 + e.length), u = new Uint8Array(14 + e.length);
	return u.set(l, 0), u.set(e, 14), u;
}
function Yr(e, t, n) {
	let r = t + 8, i = r + n.recLen;
	if (i > e.length || n.recLen < 36) return null;
	let a = new S(e), o = a.u8(r), s = a.u8(r + 1), c = a.u16(r + 18), l = a.u32(r + 20), u = a.u32(r + 24), d = a.u32(r + 28), f = a.u8(r + 33), p = r + 36, m = p + f;
	if (m + 8 > i) return null;
	let h = Kr(e, m);
	if (!h) return null;
	let g = Xr(e, m, h);
	if (!g) return null;
	let _ = f > 0 && p + f <= i ? new TextDecoder("utf-16le").decode(e.subarray(p, p + Math.max(0, f - 2))).replace(/\0+$/g, "") : "";
	return {
		...g,
		meta: {
			...g.meta || {},
			fbseBlipType: o || s,
			fbseMime: mn(o || s),
			fbseTag: c,
			fbseSize: l,
			fbseRefCount: u,
			fbseDelayOffset: d,
			fbseName: _
		}
	};
}
function Xr(e, t, n) {
	let r = t + 8, i = ((n.recInstance & 1) == 1 ? 2 : 1) * 16, a = e.subarray(r, r + n.recLen);
	if (n.recType === Dr || n.recType === Er || n.recType === Ar || n.recType === Or || n.recType === kr) {
		let e = i + 1;
		if (a.length < e) return null;
		let t = "application/octet-stream", r = a.subarray(e);
		if (n.recType === Dr) t = "image/png";
		else if (n.recType === Er || n.recType === Ar) t = "image/jpeg";
		else if (n.recType === kr) t = "image/tiff";
		else if (n.recType === Or) {
			let e = Jr(r);
			e ? (r = e, t = "image/bmp") : t = "image/dib";
		}
		return {
			mime: t,
			bytes: r,
			displayable: Ir(t),
			kind: "officeArt",
			meta: {
				recType: n.recType,
				recInstance: n.recInstance
			}
		};
	}
	if (n.recType === Cr || n.recType === wr || n.recType === Tr) {
		let e = i + 34;
		if (a.length < e) return null;
		let t = new S(a), r = t.u32(i), o = t.u32(i + 28), s = a[i + 32] ?? 255, c = a[i + 33] ?? 255, l = a.subarray(e), u = l, d = !1, f = s !== 254;
		if (s === 0) {
			let e = Xt(l, r || void 0);
			e && (u = e, d = !0, f = !1);
		}
		let p = n.recType === Cr ? "image/emf" : n.recType === wr ? "image/wmf" : "image/pict";
		return {
			mime: p,
			bytes: u,
			displayable: Ir(p),
			kind: "officeArt",
			meta: {
				recType: n.recType,
				recInstance: n.recInstance,
				metafileUncompressedSize: r,
				metafileCompressedSize: o,
				metafileCompression: s,
				metafileFilter: c,
				metafileCompressed: f,
				metafileDecompressed: d,
				metafileOriginalByteLength: l.length,
				fbseSize: o
			}
		};
	}
	return null;
}
function Zr(e, t, n, r) {
	let i = t;
	for (; i + 8 <= n;) {
		let t = Kr(e, i);
		if (!t) break;
		let a = i + t.size;
		if (a > n) break;
		if (t.recVer === xr) Zr(e, i + 8, a, r);
		else if (t.recType === Sr) {
			let n = Yr(e, i, t);
			n && r.push(n);
		} else {
			let n = Xr(e, i, t);
			n && r.push(n);
		}
		i = a;
	}
}
function Qr(e, t) {
	if (t < 0 || t + 8 > e.length) return [];
	let n = [];
	return Zr(e, t, e.length, n), n;
}
function $r(e) {
	switch (e.mime) {
		case "image/png": return 100;
		case "image/jpeg": return 90;
		case "image/gif": return 80;
		case "image/bmp": return 70;
		case "image/tiff": return 60;
		case "image/svg+xml": return 50;
		case "image/emf": return 40;
		case "image/wmf": return 30;
		case "image/pict": return 20;
		default: return 0;
	}
}
function ei(e) {
	let t = null;
	for (let n of e) (!t || $r(n) > $r(t)) && (t = n);
	return t;
}
function ti(e) {
	if (!/^(?:image\/emf|image\/wmf)$/i.test(e.mime) || !e.bytes.length || e.meta?.metafileCompressed) return e;
	let t = _r(e.mime, e.bytes);
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
function ni(e, t, n, r, i) {
	let a = e.sourceUrl, o = a ? Pr(a) : !1, s = {
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
		blipIndex: i?.blipIndex,
		sourceShapeId: i?.shapeId,
		...e.meta || {}
	};
	return {
		id: u("asset-img"),
		type: "image",
		mime: e.mime,
		bytes: e.bytes,
		dataUrl: a ? "" : p(e.bytes, e.mime),
		sourceUrl: a,
		displayable: e.displayable && !o,
		meta: s
	};
}
function ri(e, t, n = {}) {
	if (!e || t == null || t < 0 || t + yr > e.length) return null;
	let r = new S(e).i32(t), i = r > 0 && t + r <= e.length ? r : Math.min(e.length - t, n.maxPictureBytes || vr), a = e.subarray(t, t + i), o = Wr(a);
	if (!o) return null;
	let s = Math.min(o.cbHeader || yr, a.length), c = Gr(a, o), l = c?.value;
	c && (s = c.nextOffset);
	let d = vn(a, s), f = ei(Qr(a, s));
	if (f) return ni(ti(f), t, o, l, d);
	if (l) {
		let e = Fr(l) || "application/octet-stream", n = Pr(l);
		return ni({
			mime: e,
			bytes: /* @__PURE__ */ new Uint8Array(),
			sourceUrl: l,
			displayable: Ir(e) && !n,
			kind: "linked",
			meta: { linkedPath: l }
		}, t, o, l, d);
	}
	let m = Math.min(o.cbHeader || yr, a.length), h = Rr(a.subarray(m));
	if (!h) return {
		id: u("asset-img"),
		type: "image",
		mime: "application/octet-stream",
		bytes: a,
		dataUrl: p(a, "application/octet-stream"),
		displayable: !1,
		meta: {
			pictureOffset: t,
			lcb: o.lcb,
			cbHeader: o.cbHeader,
			mm: o.mm,
			xExt: o.xExt,
			yExt: o.yExt,
			dxaGoalTwips: o.dxaGoalTwips,
			dyaGoalTwips: o.dyaGoalTwips,
			scaleXPermille: o.scaleXPermille,
			scaleYPermille: o.scaleYPermille,
			displayWidthTwips: o.displayWidthTwips,
			displayHeightTwips: o.displayHeightTwips,
			sourceKind: "fallback",
			browserRenderable: !1,
			blipIndex: d?.blipIndex,
			sourceShapeId: d?.shapeId
		}
	};
	let g = m + h.start, _ = Math.min(m + h.end, a.length), v = a.subarray(g, _), y = ti({
		mime: h.mime,
		bytes: v,
		displayable: Ir(h.mime),
		kind: "fallback",
		meta: {
			pictureOffset: t,
			lcb: o.lcb,
			cbHeader: o.cbHeader,
			mm: o.mm,
			xExt: o.xExt,
			yExt: o.yExt,
			dxaGoalTwips: o.dxaGoalTwips,
			dyaGoalTwips: o.dyaGoalTwips,
			scaleXPermille: o.scaleXPermille,
			scaleYPermille: o.scaleYPermille,
			displayWidthTwips: o.displayWidthTwips,
			displayHeightTwips: o.displayHeightTwips,
			sourceKind: "fallback",
			browserRenderable: Ir(h.mime)
		}
	});
	return {
		id: u("asset-img"),
		type: "image",
		mime: y.mime,
		bytes: y.bytes,
		dataUrl: p(y.bytes, y.mime),
		displayable: y.displayable,
		meta: {
			pictureOffset: t,
			lcb: o.lcb,
			cbHeader: o.cbHeader,
			mm: o.mm,
			xExt: o.xExt,
			yExt: o.yExt,
			dxaGoalTwips: o.dxaGoalTwips,
			dyaGoalTwips: o.dyaGoalTwips,
			scaleXPermille: o.scaleXPermille,
			scaleYPermille: o.scaleYPermille,
			displayWidthTwips: o.displayWidthTwips,
			displayHeightTwips: o.displayHeightTwips,
			sourceKind: "fallback",
			browserRenderable: !!y.displayable,
			blipIndex: d?.blipIndex,
			sourceShapeId: d?.shapeId,
			...y.meta || {}
		}
	};
}
function ii(e, t) {
	let n = t;
	for (; n < e.length && e[n] !== 0;) n += 1;
	return {
		value: new TextDecoder("windows-1252").decode(e.subarray(t, n)),
		nextOffset: n + 1
	};
}
function ai(e) {
	let t = new S(e);
	for (let n of [4, 6]) try {
		let r = n, i = ii(e, r);
		r = i.nextOffset;
		let a = ii(e, r);
		r = a.nextOffset;
		let o = ii(e, r);
		if (r = o.nextOffset, r + 4 > e.length) continue;
		let s = t.u32(r);
		if (r += 4, s > 0 && r + s <= e.length) {
			let t = e.subarray(r, r + s);
			return {
				label: i.value,
				originalPath: a.value,
				tempPath: o.value,
				dataSize: s,
				bytes: t
			};
		}
	} catch {}
	return null;
}
function oi(e, t) {
	let n = e.listChildren(t).filter((e) => e.objectType === 2 || e.objectType === 5), r = new Map(n.map((e) => [e.name.toLowerCase(), e])), i = r.get("objinfo") || r.get("objinfo") || r.get("objinfo"), a = r.get("ole10native") || r.get("ole10native") || r.get("ole10native"), o = r.get("package") || r.get("contents") || r.get("content"), s = {
		entry: t,
		streams: n,
		displayName: t.name,
		attachment: null,
		objectData: null
	};
	if (a) {
		let n = ai(e.getStream(a) || /* @__PURE__ */ new Uint8Array());
		if (n) {
			let e = n.label || n.originalPath.split(/[\\/]/).pop() || `${t.name}.bin`, r = Lr(e), i = {
				...n,
				sourceKind: "ole10-native"
			};
			return s.attachment = {
				id: u("asset-ole"),
				type: "attachment",
				name: e,
				mime: r,
				bytes: n.bytes,
				dataUrl: p(n.bytes, r),
				meta: i
			}, s;
		}
	}
	if (o) {
		let n = e.getStream(o) || /* @__PURE__ */ new Uint8Array(), r = `${m(t.name)}.bin`, i = Lr(r);
		s.attachment = {
			id: u("asset-pkg"),
			type: "attachment",
			name: r,
			mime: i,
			bytes: n,
			dataUrl: p(n, i),
			meta: {
				stream: o.name,
				sourceKind: "package"
			}
		};
	}
	return i && (s.objectData = e.getStream(i) || /* @__PURE__ */ new Uint8Array()), s;
}
function si(e) {
	let t = e.getEntry("/ObjectPool");
	if (!t) return /* @__PURE__ */ new Map();
	let n = e.listChildren(t).filter((e) => e.objectType === 1), r = /* @__PURE__ */ new Map();
	for (let t of n) r.set(t.name, oi(e, t));
	return r;
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/styles.js
var ci = /* @__PURE__ */ new Set([
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
function Z(...e) {
	let t = /* @__PURE__ */ new Map(), n = 0;
	for (let r of e) for (let e of r || []) {
		let r = e.kind === "table" && ci.has(e.name);
		t.set(r ? `${e.kind}:${e.name}:${n++}` : `${e.kind}:${e.name}`, e);
	}
	return Array.from(t.values());
}
function li(e) {
	let t = {
		para: [],
		char: [],
		table: []
	};
	for (let n of e || []) n.kind === "para" ? t.para.push(n) : n.kind === "char" ? t.char.push(n) : n.kind === "table" && t.table.push(n);
	return t;
}
function ui(e, t) {
	let n = new S(e), r = n.u16(t), i = t + 2, a = r * 2, o = n.utf16le(i, a), s = i + a + 2;
	return {
		value: o.replace(/\u0000+$/, ""),
		nextOffset: s
	};
}
function di(e, t) {
	let n = new S(e), r = n.u16(t), i = n.u16(t + 2), a = n.u16(t + 4);
	return {
		sti: r & 4095,
		flags1: r >> 12,
		stk: i & 15,
		istdBase: i >> 4 & 4095,
		cupx: a & 15,
		istdNext: a >> 4 & 4095,
		bchUpe: n.u16(t + 6),
		grfstd: n.u16(t + 8)
	};
}
function fi(e, t) {
	let n = new S(e).u16(t), r = t + 2, i = r + n, a = e.subarray(r, Math.min(i, e.length)), o = 0, s = [];
	return a.length >= 2 && (o = a[0] | (a[1] ?? 0) << 8, s = $e(a, 2, a.length)), {
		cbUpx: n,
		styleId: o,
		properties: s,
		nextOffset: d(i)
	};
}
function pi(e, t) {
	let n = new S(e).u16(t), r = t + 2, i = r + n, a = e.subarray(r, Math.min(i, e.length));
	return {
		cbUpx: n,
		properties: $e(a, 0, a.length),
		nextOffset: d(i)
	};
}
function mi(e, t) {
	let n = new S(e).u16(t), r = t + 2, i = r + n, a = e.subarray(r, Math.min(i, e.length));
	return {
		cbUpx: n,
		properties: $e(a, 0, a.length),
		nextOffset: d(i)
	};
}
function hi(e, t, n) {
	if (!e.length) return {
		istd: n,
		empty: !0,
		name: "",
		stdfBase: {
			istdBase: 4095,
			istdNext: 0,
			stk: 1,
			cupx: 0
		},
		paraProps: [],
		charProps: [],
		tableProps: []
	};
	let r = Math.max(10, Math.min(t || 10, e.length)), i = di(e, 0), a = r, o = ui(e, a);
	a = o.nextOffset;
	let s = [], c = [], l = [];
	try {
		if (i.stk === 1) {
			if (i.cupx >= 1 && a + 2 <= e.length) {
				let t = fi(e, a);
				s = t.properties, a = t.nextOffset;
			}
			i.cupx >= 2 && a + 2 <= e.length && (c = pi(e, a).properties);
		} else if (i.stk === 2) a + 2 <= e.length && (c = pi(e, a).properties);
		else if (i.stk === 3) {
			if (i.cupx >= 1 && a + 2 <= e.length) {
				let t = mi(e, a);
				l = t.properties, a = t.nextOffset;
			}
			if (i.cupx >= 2 && a + 2 <= e.length) {
				let t = fi(e, a);
				s = t.properties, a = t.nextOffset;
			}
			i.cupx >= 3 && a + 2 <= e.length && (c = pi(e, a).properties);
		}
	} catch {}
	return {
		istd: n,
		name: o.value,
		stdfBase: i,
		paraProps: s,
		charProps: c,
		tableProps: l,
		empty: !1
	};
}
function gi(e, t) {
	let n = t.fcStshf, r = t.lcbStshf;
	if (n == null || r == null || r <= 0) return {
		styles: /* @__PURE__ */ new Map(),
		header: null,
		resolveStyle(e) {
			return _i(/* @__PURE__ */ new Map(), e);
		}
	};
	let i = e.subarray(n, n + r), a = new S(i), o = a.u16(0), s = a.u16(2), c = a.u16(4), l = {
		cbStshi: o,
		cstd: s,
		cbSTDBaseInFile: c,
		ftcAsci: a.u16(12),
		ftcFE: a.u16(14),
		ftcOther: a.u16(16)
	}, u = 2 + o, f = /* @__PURE__ */ new Map();
	for (let e = 0; e < s && u + 2 <= i.length; e += 1) {
		let t = a.u16(u), n = u + 2, r = n + t;
		if (t === 0) {
			f.set(e, {
				istd: e,
				empty: !0,
				name: "",
				stdfBase: {
					istdBase: 4095,
					istdNext: 0,
					stk: 1,
					cupx: 0
				},
				paraProps: [],
				charProps: [],
				tableProps: []
			}), u = d(r);
			continue;
		}
		let o = hi(i.subarray(n, Math.min(r, i.length)), c, e);
		f.set(e, o), u = d(r);
	}
	return {
		header: l,
		styles: f,
		resolveStyle(e) {
			return _i(f, e);
		}
	};
}
function _i(e, t, n = /* @__PURE__ */ new Set()) {
	if (t == null || t === 4095 || n.has(t)) return {
		paraProps: [],
		charProps: [],
		tableProps: [],
		styleIds: []
	};
	let r = e.get(t);
	if (!r || r.empty) return {
		paraProps: [],
		charProps: [],
		tableProps: [],
		styleIds: []
	};
	n.add(t);
	let i = _i(e, r.stdfBase?.istdBase, n);
	return {
		styleIds: [...i.styleIds, t],
		paraProps: Z(i.paraProps, r.paraProps),
		charProps: Z(i.charProps, r.charProps),
		tableProps: Z(i.tableProps, r.tableProps)
	};
}
// ../../node_modules/@file-viewer/doc/dist/msdoc/parser.js
function vi(e, t, n, r) {
	let i = r?.index || 0;
	for (; i < e.length && e[i].cpEnd <= t;) i += 1;
	r && (r.index = i);
	let a = [], o = i;
	for (; o < e.length && e[o].cpStart < n;) e[o].cpEnd > t && a.push(e[o]), o += 1;
	return a;
}
function yi(e) {
	return String(e || "").trim();
}
function bi(e) {
	let t = String(e || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
	if (!t) return null;
	let n = t.toUpperCase();
	if (n.startsWith("HYPERLINK")) {
		let e = t.slice(9).trim(), n = e.match(/"([^"]+)"/)?.[1] || e.split(/\s+/)[0] || "";
		return n ? {
			type: "hyperlink",
			href: n
		} : null;
	}
	if (n.startsWith("INCLUDEPICTURE")) {
		let e = t.slice(14).trim();
		return {
			type: "includePicture",
			target: e.match(/"([^"]+)"/)?.[1] || e.split(/\s+/)[0] || ""
		};
	}
	return n.startsWith("EMBED") ? {
		type: "embed",
		raw: t
	} : n.startsWith("LINK") ? {
		type: "link",
		raw: t
	} : {
		type: "unknown",
		raw: t
	};
}
function xi(e, t) {
	if (!t.text) return;
	let n = e[e.length - 1];
	n && n.type === "text" && n.href === t.href && h(n.style, t.style) ? n.text += t.text : e.push(t);
}
function Q(e, t, n) {
	if (!n) return;
	let r = e.length ? e[e.length - 1].nodes : t;
	n.type === "text" ? xi(r, n) : r.push(n);
}
function Si(e, t) {
	let n = [
		`_${t}`,
		`_${String(t)}`,
		`_${t.toString(16)}`,
		`_${t.toString(16).toUpperCase()}`
	];
	for (let t of n) if (e.has(t)) return e.get(t) || null;
	return null;
}
function Ci(e, t, n, r, i, a = {}) {
	return function(o) {
		let s = o?.pictureOffset;
		if (s == null) return null;
		if (i.has(s)) return i.get(s) || null;
		let c = null, l = Si(t, s);
		if ((o.ole2 || o.object || o.data) && l?.attachment && (c = l.attachment, r.add(l.entry.name)), !c && e?.length) {
			let t = ri(e, s, a);
			t && t.mime !== "application/octet-stream" ? c = t : !c && l?.attachment ? (c = l.attachment, r.add(l.entry.name)) : t && (c = t);
		}
		return !c && l?.attachment && (c = l.attachment, r.add(l.entry.name)), c && n.push(c), i.set(s, c), c;
	};
}
function wi(e) {
	switch (e) {
		case O.nonBreakingHyphen: return "-";
		case O.nonRequiredHyphen:
		case O.annotationRef:
		case O.textBoxPlaceholder: return "";
		default: return e;
	}
}
function Ti(e) {
	return e.replaceAll(O.textBoxPlaceholder, "");
}
function Ei(e, t) {
	let n = [
		["main", e.fibRgLw.ccpText],
		["footnote", e.fibRgLw.ccpFtn],
		["header", e.fibRgLw.ccpHdd],
		["macro", e.fibRgLw.ccpMcr],
		["annotation", e.fibRgLw.ccpAtn],
		["endnote", e.fibRgLw.ccpEdn],
		["textbox", e.fibRgLw.ccpTxbx],
		["header-textbox", e.fibRgLw.ccpHdrTxbx]
	];
	if (!n.some(([, e]) => e > 0)) return [{
		kind: "main",
		cpStart: 0,
		cpEnd: t
	}];
	let r = [], i = 0;
	for (let [e, a] of n) {
		let n = Math.max(0, a || 0), o = Math.min(i, t);
		i += n;
		let s = Math.min(i, t);
		r.push({
			kind: e,
			cpStart: o,
			cpEnd: s
		});
	}
	return r;
}
function Di(e, t, n) {
	if (e.cpEnd <= e.cpStart) return [];
	let r = n.filter((t) => t.cpStart < e.cpEnd && t.cpEnd > e.cpStart);
	return r.length ? r.map((n) => {
		let r = Math.max(e.cpStart, n.cpStart), i = Math.min(e.cpEnd, n.cpEnd);
		return {
			cpStart: r,
			cpEnd: i,
			terminator: t[i - 1] || "",
			styleId: n.styleId,
			properties: n.properties,
			storyKind: e.kind
		};
	}).filter((e) => e.cpEnd > e.cpStart) : xe(t.slice(e.cpStart, e.cpEnd)).map((t) => ({
		...t,
		cpStart: t.cpStart + e.cpStart,
		cpEnd: t.cpEnd + e.cpStart,
		styleId: 0,
		properties: [],
		storyKind: e.kind
	}));
}
function Oi(e, t) {
	let n = [], r = [];
	for (let i of e) if (i.text && !i.state.hidden) for (let e of i.text) {
		let a = wi(e);
		if (a === O.fieldStart) {
			r.push({
				instruction: "",
				parsed: null,
				readingInstruction: !0,
				nodes: []
			});
			continue;
		}
		if (a === O.fieldSeparator) {
			let e = r[r.length - 1];
			e && (e.parsed = bi(e.instruction), e.readingInstruction = !1);
			continue;
		}
		if (a === O.fieldEnd) {
			let e = r.pop();
			if (!e) continue;
			let t = e.nodes;
			if (e.readingInstruction && (e.parsed = bi(e.instruction)), e.parsed?.type === "hyperlink") {
				let n = e.parsed.href;
				t = t.map((e) => e.type === "lineBreak" || e.type === "pageBreak" ? e : {
					...e,
					href: n
				});
			}
			for (let e of t) Q(r, n, e);
			continue;
		}
		let o = r[r.length - 1];
		if (o?.readingInstruction) o.instruction += a;
		else if (a === O.hardLineBreak) Q(r, n, { type: "lineBreak" });
		else if (a === O.pageBreak) Q(r, n, { type: "pageBreak" });
		else if (a === O.picture) {
			let e = t(i.state);
			e?.type === "image" ? Q(r, n, {
				type: "image",
				asset: e,
				style: i.state
			}) : e?.type === "attachment" && Q(r, n, {
				type: "attachment",
				asset: e,
				style: i.state
			});
		} else Q(r, n, {
			type: "text",
			text: v(a),
			style: i.state
		});
	}
	for (; r.length;) {
		let e = r.pop();
		for (let t of e.nodes) Q(r, n, t);
	}
	return n;
}
function ki(e, t, n, r, i, a, o, s = !1) {
	let c = vi(n, e.cpStart, e.cpEnd, o), l = /* @__PURE__ */ new Set([e.cpStart, e.cpEnd]);
	for (let t of c) l.add(Math.max(e.cpStart, t.cpStart)), l.add(Math.min(e.cpEnd, t.cpEnd));
	let u = Array.from(l).sort((e, t) => e - t), d = [];
	for (let n = 0; n < u.length - 1; n += 1) {
		let o = u[n], l = u[n + 1];
		if (l <= o) continue;
		let f = c.find((e) => e.cpStart <= o && e.cpEnd >= l)?.properties || [], p = pt(f), m = pt(Z(i, p.charStyleId == null ? [] : r.resolveStyle(p.charStyleId).charProps, f));
		s && m.colorIndex === 8 && (m.colorIndex = 1);
		let g = a(m.fontFamilyId);
		g && (m.fontFamily = g.name || g.altName || void 0);
		let _ = o - e.cpStart, v = l - e.cpStart, y = t.slice(_, v);
		if (!y) continue;
		let b = d[d.length - 1];
		b && h(b.state, m) ? (b.text += y, b.cpEnd = l) : d.push({
			cpStart: o,
			cpEnd: l,
			text: y,
			state: m
		});
	}
	if (!d.length && t) {
		let n = pt(i);
		s && n.colorIndex === 8 && (n.colorIndex = 1);
		let r = a(n.fontFamilyId);
		r && (n.fontFamily = r.name || r.altName || void 0), d.push({
			cpStart: e.cpStart,
			cpEnd: e.cpEnd,
			text: t,
			state: n
		});
	}
	return d;
}
function Ai(e, t, n, r, i, a, o) {
	let s = li(e.properties || []), c = e.styleId || s.para.find((e) => e.name === "styleId")?.value || 0, l = n.resolveStyle(c), d = Z(l.paraProps, s.para), f = mt(d), p = ht(s.table), m = Z(p.styleId == null ? [] : n.resolveStyle(p.styleId).tableProps, s.table), h = ht(m), g = l.charProps, _ = ki(e, t, i, n, g, (e) => r.byIndex(e), o, e.storyKind === "textbox" || e.storyKind === "header-textbox"), v = Oi(_, a);
	return {
		id: u("para"),
		cpStart: e.cpStart,
		cpEnd: e.cpEnd,
		terminator: e.terminator || "",
		text: t,
		rawProperties: e.properties || [],
		styleId: c,
		styleName: yi(n.styles.get(c)?.name),
		paraProps: d,
		paraState: f,
		tableProps: m,
		tableState: h,
		segments: _,
		inlines: v
	};
}
function ji(e) {
	for (let t of e) {
		t.cells.forEach((e, t) => {
			e.colIndex = t, e.colspan = 1, e.rowspan = 1, e.hidden = !1;
		});
		for (let e = 0; e < t.cells.length; e += 1) {
			let n = t.cells[e], r = n.meta?.merge || 0;
			if (r !== 1 && r > 1) {
				let r = e + 1;
				for (; r < t.cells.length && (t.cells[r].meta?.merge || 0) === 1;) t.cells[r].hidden = !0, n.colspan = (n.colspan || 1) + 1, r += 1;
				let i = t.cells[r - 1];
				if (n.meta && i?.meta && i !== n) {
					n.meta.rightBoundary = i.meta.rightBoundary, n.meta.leftBoundary != null && n.meta.rightBoundary != null && (n.meta.width = Math.max(0, n.meta.rightBoundary - n.meta.leftBoundary));
					let e = i.meta.borders?.right;
					e && (n.meta.borders = {
						...n.meta.borders || {},
						right: e
					});
				}
			}
		}
	}
	for (let t = 0; t < e.length; t += 1) {
		let n = e[t];
		for (let r of n.cells) {
			if (r.hidden) continue;
			let n = r.meta?.vertMerge || 0;
			if (n !== 1 && n > 1) {
				let n = t + 1;
				for (; n < e.length;) {
					let t = !0;
					for (let i = r.colIndex || 0; i < (r.colIndex || 0) + (r.colspan || 1); i += 1) {
						let r = e[n].cells[i];
						if (!r || (r.meta?.vertMerge || 0) !== 1) {
							t = !1;
							break;
						}
					}
					if (!t) break;
					for (let t = r.colIndex || 0; t < (r.colIndex || 0) + (r.colspan || 1); t += 1) e[n].cells[t].hidden = !0;
					r.rowspan = (r.rowspan || 1) + 1, n += 1;
				}
				let i = e[n - 1]?.cells[r.colIndex || 0], a = i?.meta?.borders?.bottom;
				r.meta && i?.meta && i !== r && a && (r.meta.borders = {
					...r.meta.borders || {},
					bottom: a
				});
			}
		}
	}
	let t = Array.from(new Set(e.flatMap((e) => e.cells.flatMap((e) => [e.meta?.leftBoundary, e.meta?.rightBoundary].filter((e) => e != null))))).sort((e, t) => e - t);
	if (t.length > 1) for (let n of e) for (let e of n.cells) {
		if (!e.meta) continue;
		let n = t.indexOf(e.meta.leftBoundary ?? NaN), r = t.indexOf(e.meta.rightBoundary ?? NaN);
		n >= 0 && (e.colIndex = n), !e.hidden && n >= 0 && r > n && (e.colspan = r - n);
	}
}
function Mi(e) {
	let t = (e, t) => Object.prototype.hasOwnProperty.call(e, t) && (() => {
		let n = e[t];
		return !!(n?.nil || n?.borderType);
	})();
	e.forEach((n, r) => {
		n.cells.forEach((i) => {
			if (i.hidden || !i.meta) return;
			let a = { ...i.meta.borders || {} }, o = n.state.borders || {}, s = i.colIndex || 0, c = s + (i.colspan || 1), l = r + (i.rowspan || 1), u = (e, n) => {
				!t(a, e) && n && (a[e] = n);
			};
			u("top", r === 0 ? o.top : o.horizontalInside), u("bottom", l >= e.length ? o.bottom : o.horizontalInside), u("left", s === 0 ? o.left : o.verticalInside), u("right", c >= n.cells.length ? o.right : o.verticalInside), i.meta.borders = a;
		});
	});
}
function Ni(e) {
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
function Pi(e) {
	let t = bt(e.tableState);
	if (!t.length) return "";
	let n = e.tableState, r = (e) => {
		let t = n.borders?.[e];
		return `${t?.borderType ?? ""}:${t?.lineWidth ?? ""}:${+!!t?.nil}`;
	};
	return [
		t[0]?.leftBoundary ?? "",
		t[t.length - 1]?.rightBoundary ?? "",
		n.alignment ?? "",
		n.leftIndent ?? "",
		n.gapHalf ?? "",
		+!!n.rtl,
		r("top"),
		r("left"),
		r("bottom"),
		r("right"),
		r("horizontalInside"),
		r("verticalInside")
	].join("|");
}
function Fi(e, t) {
	e.paraState.inTable = !0, e.paraState.itap = Math.max(t.paraState.itap || 1, e.paraState.itap || 0), e.tableState = t.tableState, e.tableProps = t.tableProps;
}
function Ii(e) {
	for (let t = 0; t < e.length; t += 1) {
		let n = e[t], r = bt(n.tableState).length;
		if (!n.paraState.tableRowEnd || !r) continue;
		n.paraState.inTable = !0, n.paraState.itap = Math.max(1, n.paraState.itap || 0);
		let i = r, a = t - 1, o = [];
		for (; a >= 0 && i > 0; --a) {
			let t = e[a];
			if (t.paraState.tableRowEnd || t.paraState.innerTableRowEnd) break;
			o.push(t), t.terminator === O.cellMark && --i;
		}
		if (i > 0) continue;
		let s = a;
		for (; s >= 0 && !e[s].paraState.tableRowEnd && !e[s].paraState.innerTableRowEnd && e[s].terminator !== O.cellMark;) --s;
		let c = e[s];
		if (c?.paraState.tableRowEnd && Pi(c) === Pi(n)) for (let n = s + 1; n < t; n += 1) {
			let t = e[n];
			o.includes(t) || o.push(t);
		}
		o.forEach((e) => Fi(e, n));
	}
}
function Li(e) {
	let t = [], n = { cells: [] }, r = [];
	for (let i of e) if (r.push(i), i.terminator === O.cellMark && (n.cells.push({
		id: u("cell"),
		paragraphs: r.map(Ni),
		meta: null
	}), r = [], i.paraState.tableRowEnd || i.paraState.innerTableRowEnd)) {
		let e = bt(i.tableState);
		for (; e.length && n.cells.length > e.length && n.cells[n.cells.length - 1].paragraphs.every((e) => !e.text && !(e.inlines || []).length);) n.cells.pop();
		n.cells.forEach((t, n) => {
			t.meta = e[n] || { index: n };
		});
		let r = e.length ? (e[e.length - 1].rightBoundary || 0) - (e[0].leftBoundary || 0) : 0;
		t.push({
			id: u("row"),
			cells: n.cells,
			state: i.tableState,
			gridWidthTwips: r
		}), n = { cells: [] };
	}
	r.length && n.cells.push({
		id: u("cell"),
		paragraphs: r.map(Ni),
		meta: null
	}), n.cells.length && t.push({
		id: u("row"),
		cells: n.cells,
		state: e[0]?.tableState || ht([]),
		gridWidthTwips: 0
	}), ji(t), Mi(t);
	let i = t.find((e) => e.gridWidthTwips)?.gridWidthTwips || 0, a = Math.max(...e.map((e) => gt(e.paraState)), 1);
	return {
		type: "table",
		id: u("table"),
		depth: a,
		rows: t,
		state: t[0]?.state || ht([]),
		gridWidthTwips: i
	};
}
function Ri(e) {
	let t = [], n = 0;
	for (; n < e.length;) {
		let r = e[n];
		if (gt(r.paraState) <= 0) {
			t.push(Ni(r)), n += 1;
			continue;
		}
		let i = [];
		for (; n < e.length && gt(e[n].paraState) > 0;) i.push(e[n]), n += 1;
		t.push(Li(i));
	}
	return t;
}
function zi(e, t = {}) {
	let n = [], r = fe(e, t);
	n.push(...r.warnings || []);
	let i = r.getStream("/WordDocument");
	if (!i) throw Error("Missing WordDocument stream");
	let a = Nt(i);
	if (a) return a.warnings.unshift(...r.warnings || []), a;
	let o = De(i);
	if (o.base.wIdent !== 42476 && g(n, `Unexpected FIB identifier: 0x${o.base.wIdent.toString(16)}`), o.base.fEncrypted) throw Error("Encrypted .doc files are not supported yet");
	let s = r.getStream(o.base.fWhichTblStm ? "/1Table" : "/0Table");
	if (!s) throw Error("Missing table stream");
	let c = r.getStream("/Data") || /* @__PURE__ */ new Uint8Array(), l = he(s, o.fibRgFcLcb), d = ve(i, l), f = d.join(""), p = Ei(o, f.length), m = p.find((e) => e.kind === "main") || {
		kind: "main",
		cpStart: 0,
		cpEnd: f.length
	}, h = p.filter((e) => (e.kind === "textbox" || e.kind === "header-textbox") && Ti(f.slice(e.cpStart, e.cpEnd)).replace(/[\r\u0007]/g, "").trim().length > 0), _ = gi(s, o.fibRgFcLcb), v = ft(s, o.fibRgFcLcb), y = Math.max(m.cpEnd, ...h.map((e) => e.cpEnd)), b = it(i, s, o, l).filter((e) => e.cpStart < y).map((e) => ({
		...e,
		cpEnd: Math.min(e.cpEnd, y)
	})), x = at(i, s, o, l, c).filter((e) => e.cpStart < y).map((e) => ({
		...e,
		cpEnd: Math.min(e.cpEnd, y)
	})), S = [m, ...h].flatMap((e) => Di(e, f, x));
	h.length && g(n, "Recovered text from a legacy Word text-box story; text-box positioning is unavailable, so the content was linearized after the main story.", {
		code: "MSDOC_TEXTBOX_STORY_LINEARIZED",
		storyCount: h.length
	});
	let ee = si(r), te = [], ne = /* @__PURE__ */ new Set(), C = Ci(c, ee, te, ne, /* @__PURE__ */ new Map(), t), w = { index: 0 }, re = S.flatMap((e) => {
		let t = be(i, l, d, e.cpStart, e.cpEnd), n = e.terminator === O.paragraph || e.terminator === O.cellMark ? e.terminator : "", r = n && t.endsWith(n) ? t.slice(0, -1) : t, a = Ti(r), o = e.storyKind === "textbox" || e.storyKind === "header-textbox";
		return (r.includes(O.textBoxPlaceholder) || o) && !a.trim() ? [] : [Ai({
			...e,
			terminator: n
		}, a, _, v, b, C, w)];
	});
	Ii(re);
	let T = Ri(re), ie = Array.from(ee.values()).filter((e) => e?.attachment && !ne.has(e.entry.name)).map((e) => e.attachment);
	for (let e of ie) te.push(e);
	return ie.length && T.push({
		type: "attachments",
		id: u("attachments"),
		items: ie
	}), {
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
				paragraphs: re.length,
				blocks: T.length,
				assets: te.length,
				styles: _.styles.size,
				fonts: v.fonts.length
			}
		},
		fonts: v.fonts,
		styles: Array.from(_.styles.values()).map((e) => ({
			istd: e.istd,
			name: e.name,
			type: e.stdfBase?.stk,
			basedOn: e.stdfBase?.istdBase,
			next: e.stdfBase?.istdNext
		})),
		blocks: T,
		assets: te
	};
}
// ../../node_modules/@file-viewer/doc/dist/render/html.js
var Bi = {
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
function Vi(e) {
	return Object.entries(e).filter(([, e]) => e != null && e !== "").map(([e, t]) => `${e}:${t}`).join(";");
}
function Hi(e) {
	if (!e || e.nil) return null;
	let t = e.borderType;
	if (!t) return null;
	let n = Math.max(2, e.lineWidth || 0), r = t >= 64 ? n : n / 8, i = Math.max(1, Math.round(96 / 72 * r)), a = t === 3 ? "double" : t === 6 ? "dotted" : [
		7,
		8,
		9
	].includes(t) ? "dashed" : "solid", o = e.color;
	return `${i}px ${a} ${e.colorRef == null ? Bi[o || 1] || "#000000" : Ui(e.colorRef)}`;
}
function Ui(e) {
	return e == null || e >>> 24 == 255 ? "#000000" : `#${[
		e & 255,
		e >>> 8 & 255,
		e >>> 16 & 255
	].map((e) => e.toString(16).padStart(2, "0")).join("")}`;
}
var Wi = {
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
function Gi(e, t, n) {
	let r = (e, t) => Number.parseInt(e.slice(t, t + 2), 16), i = Math.max(0, Math.min(100, n)) / 100;
	return `#${[
		1,
		3,
		5
	].map((n) => Math.round(r(e, n) * i + r(t, n) * (1 - i))).map((e) => e.toString(16).padStart(2, "0")).join("")}`;
}
function Ki(e) {
	if (!e || e.nil || e.auto || e.pattern === 0) return {};
	let t = e.foregroundColorRef == null ? Bi[e.foregroundColorIndex || 1] || "#000000" : Ui(e.foregroundColorRef), n = e.backgroundColorRef == null ? Bi[e.backgroundColorIndex || 8] || "#ffffff" : Ui(e.backgroundColorRef);
	if (e.pattern === 1) return { "background-color": t };
	if (Wi[e.pattern] != null) return { "background-color": Gi(t, n, Wi[e.pattern]) };
	let r = e.pattern === 14 || e.pattern === 20 ? `repeating-linear-gradient(0deg,${t} 0 1px,transparent 1px 4px)` : e.pattern === 15 || e.pattern === 21 ? `repeating-linear-gradient(90deg,${t} 0 1px,transparent 1px 4px)` : e.pattern === 16 || e.pattern === 22 ? `repeating-linear-gradient(45deg,${t} 0 1px,transparent 1px 5px)` : e.pattern === 17 || e.pattern === 23 ? `repeating-linear-gradient(-45deg,${t} 0 1px,transparent 1px 5px)` : null;
	return r ? {
		"background-color": n,
		"background-image": r
	} : { "background-color": n };
}
function qi(e) {
	let t = { "text-align": _t(e.alignment) }, n = _(e.spacingBefore), r = _(e.spacingAfter), i = _(e.leftIndent), a = _(e.rightIndent), o = _(e.firstLineIndent);
	if (n && (t["margin-top"] = `${n}px`), r && (t["margin-bottom"] = `${r}px`), i && (t["margin-left"] = `${i}px`), a && (t["margin-right"] = `${a}px`), o && (t["text-indent"] = `${o}px`), e.lineSpacing) {
		let n = Math.abs(e.lineSpacing) / 240;
		n && (t["line-height"] = String(Math.max(1, n)));
	}
	e.keepLines && (t["break-inside"] = "avoid"), e.keepNext && (t["break-after"] = "avoid"), e.pageBreakBefore && (t["break-before"] = "page"), e.rtlPara && (t.direction = "rtl");
	let s = Hi(e.borders?.top), c = Hi(e.borders?.right), l = Hi(e.borders?.bottom), u = Hi(e.borders?.left);
	return s && (t["border-top"] = s), c && (t["border-inline-end"] = c), l && (t["border-bottom"] = l), u && (t["border-inline-start"] = u), t;
}
function Ji(e) {
	let t = vt(e);
	if (!e || t === "none") return {};
	let n = { "text-decoration-line": "underline" };
	return n["text-decoration-style"] = t === "double" || t === "wavy-double" ? "double" : t.includes("dot") || t === "dotted-heavy" ? "dotted" : t.includes("dash") ? "dashed" : t.includes("wave") || t.includes("wavy") ? "wavy" : "solid", n;
}
function Yi(e) {
	let t = {};
	(e.bold || e.boldBi) && (t["font-weight"] = "700"), (e.italic || e.italicBi) && (t["font-style"] = "italic"), (e.strike || e.doubleStrike) && (t["text-decoration-line"] = `${t["text-decoration-line"] ? `${t["text-decoration-line"]} ` : ""}line-through`), Object.assign(t, Ji(e.underline)), e.fontSizeHalfPoints && (t["font-size"] = `${e.fontSizeHalfPoints / 2}pt`), e.fontFamily && (t["font-family"] = `'${String(e.fontFamily).replace(/'/g, "\\'")}', sans-serif`), e.colorIndex && Bi[e.colorIndex] && (t.color = Bi[e.colorIndex]);
	let n = typeof e.highlight == "number" ? e.highlight : e.highlight?.index;
	return n && Te[n] && (t["background-color"] = Te[n]), e.smallCaps && (t["font-variant-caps"] = "small-caps"), e.caps && (t["text-transform"] = "uppercase"), e.scale && e.scale !== 100 && (t.display = "inline-block", t.transform = `scaleX(${e.scale / 100})`, t["transform-origin"] = "left center"), e.positionHalfPoints > 0 && (t["vertical-align"] = "super"), e.positionHalfPoints < 0 && (t["vertical-align"] = "sub"), e.outline && (t["text-shadow"] = "0 0 0.02em currentColor"), (e.shadow || e.emboss || e.imprint) && (t["text-shadow"] = t["text-shadow"] ? `${t["text-shadow"]}, 0.06em 0.06em 0.08em rgba(0,0,0,.25)` : "0.06em 0.06em 0.08em rgba(0,0,0,.25)"), e.rtl && (t.direction = "rtl"), t;
}
function Xi(e) {
	let t = l(e.text), n = Yi(e.style);
	n["white-space"] = "break-spaces";
	let r = Vi(n), i = `<span${r ? ` style="${r}"` : ""}>${t}</span>`;
	return e.href ? `<a class="msdoc-link" href="${l(e.href)}" target="_blank" rel="noreferrer noopener">${i}</a>` : i;
}
function Zi(e) {
	let t = _(e.meta?.displayWidthTwips), n = _(e.meta?.displayHeightTwips);
	return {
		widthPx: t && t > 0 ? t : void 0,
		heightPx: n && n > 0 ? n : void 0
	};
}
function Qi(e, t) {
	let { widthPx: n, heightPx: r } = Zi(t);
	(n || r) && (n && (e.width = `${n}px`), r && (e.height = `${r}px`));
}
function $i(e) {
	let t = String(e || "").trim();
	return t && (/^data:image\//i.test(t) || /^(?:https?:|blob:)/i.test(t)) ? t : null;
}
function ea(e) {
	let t = String(e || "").trim();
	return t && /^(?:data:|blob:|https?:)/i.test(t) ? t : null;
}
function ta(e) {
	let t = $i(e.asset.sourceUrl) || $i(e.asset.dataUrl), n = Yi(e.style), r = Zi(e.asset);
	if (r.widthPx || r.heightPx ? (Qi(n, e.asset), n["max-width"] = "none", r.heightPx || (n.height = "auto")) : (n["max-width"] = "100%", n.height = "auto"), !t || e.asset.displayable === !1) {
		let t = ea(e.asset.dataUrl) || ea(e.asset.sourceUrl), n = l(String(e.asset.meta?.linkedPath || e.asset.mime || "image")), r = t ? `<a class="msdoc-attachment msdoc-image-fallback" href="${l(t)}" target="_blank" rel="noreferrer noopener">🖼 ${n}</a>` : `<span class="msdoc-image-fallback">🖼 ${n}</span>`;
		return e.href ? `<a class="msdoc-link" href="${l(e.href)}" target="_blank" rel="noreferrer noopener">${r}</a>` : r;
	}
	let i = `<img class="msdoc-image" src="${l(t)}" alt="" style="${Vi(n)}">`;
	return e.href ? `<a class="msdoc-link" href="${l(e.href)}" target="_blank" rel="noreferrer noopener">${i}</a>` : i;
}
function na(e) {
	let t = l(e.asset.name || "embedded-file"), n = `<a class="msdoc-attachment" href="${l(e.asset.dataUrl)}" download="${t}">📎 ${t}</a>`;
	return e.href ? `<a class="msdoc-link" href="${l(e.href)}" target="_blank" rel="noreferrer noopener">${n}</a>` : n;
}
function ra(e) {
	return e.map((e) => e.type === "text" ? Xi(e) : e.type === "image" ? ta(e) : e.type === "attachment" ? na(e) : e.type === "lineBreak" ? "<br>" : e.type === "pageBreak" ? "<span class=\"msdoc-page-break\"></span>" : "").join("");
}
function ia(e, t = {}) {
	let n = t.inline ? "div" : "p", r = Vi(qi(e.paraState)), i = ra(e.inlines || []) || "<br>", a = ["msdoc-paragraph"];
	return e.styleName && a.push(`msdoc-style-${m(e.styleName)}`), `<${n} class="${a.join(" ")}"${r ? ` style="${r}"` : ""}>${i}</${n}>`;
}
function aa(e) {
	let t = {}, n = _(e.meta?.rightBoundary != null && e.meta?.leftBoundary != null ? e.meta.rightBoundary - e.meta.leftBoundary : e.meta?.width);
	n && (t.width = `${n}px`), e.meta?.noWrap && (t["white-space"] = "nowrap"), e.meta?.fitText && (t["text-align"] = "justify"), e.meta?.vertAlign != null && (t["vertical-align"] = yt(e.meta.vertAlign));
	let r = e.meta?.borders || {}, i = Hi(r.all), a = (e) => Object.prototype.hasOwnProperty.call(r, e) ? Hi(r[e]) : i, o = a("top"), s = a("right"), c = a("bottom"), l = a("left");
	o && (t["border-top"] = o), s && (t["border-inline-end"] = s), c && (t["border-bottom"] = c), l && (t["border-inline-start"] = l);
	let u = e.meta?.paddingTwips;
	return u?.top != null && (t["padding-top"] = `${_(u.top)}px`), u?.right != null && (t["padding-inline-end"] = `${_(u.right)}px`), u?.bottom != null && (t["padding-bottom"] = `${_(u.bottom)}px`), u?.left != null && (t["padding-inline-start"] = `${_(u.left)}px`), Object.assign(t, Ki(e.meta?.shading)), t;
}
function oa(e) {
	let t = {}, n = _(e.gridWidthTwips || e.state?.tableWidth?.wWidth);
	t.width = n ? `${n}px` : "100%";
	let r = _(e.state?.leftIndent);
	r && (t["margin-inline-start"] = `${r}px`), e.state?.rtl && (t.direction = "rtl");
	let i = e.rows.flatMap((e) => e.cells).reduce((e, t) => {
		let n = t.meta?.spacingTwips;
		return n ? {
			horizontal: Math.max(e.horizontal, n.left || 0, n.right || 0),
			vertical: Math.max(e.vertical, n.top || 0, n.bottom || 0)
		} : e;
	}, {
		horizontal: 0,
		vertical: 0
	});
	return i.horizontal || i.vertical ? (t["border-collapse"] = "separate", t["border-spacing"] = `${_(i.horizontal)}px ${_(i.vertical)}px`) : t["border-collapse"] = "collapse", t["table-layout"] = "fixed", t;
}
function sa(e) {
	let t = e.rows.map((e) => {
		let t = e.state?.rowHeight ? _(Math.abs(e.state.rowHeight)) : null;
		return `<tr class="msdoc-row"${t ? ` style="height:${t}px"` : ""}>${e.cells.filter((e) => !e.hidden).map((e) => {
			let t = [];
			(e.colspan ?? 1) > 1 && t.push(` colspan="${e.colspan}"`), (e.rowspan ?? 1) > 1 && t.push(` rowspan="${e.rowspan}"`);
			let n = Vi(aa(e)), r = e.paragraphs.map((e) => ia(e, { inline: !0 })).join("");
			return `<td class="msdoc-cell"${t.join("")}${n ? ` style="${n}"` : ""}>${r || "<div class=\"msdoc-paragraph\"><br></div>"}</td>`;
		}).join("")}</tr>`;
	}).join("");
	return `<table class="msdoc-table msdoc-table-depth-${e.depth}" style="${Vi(oa(e))}"><tbody>${t}</tbody></table>`;
}
function ca(e) {
	return `<section class="msdoc-attachments"><div class="msdoc-attachments-title">Embedded attachments</div><ul>${e.items.map((e) => `<li><a class="msdoc-attachment" href="${l(e.dataUrl)}" download="${l(e.name || "embedded-file")}">📎 ${l(e.name || "embedded-file")}</a></li>`).join("")}</ul></section>`;
}
function la() {
	return "\n.msdoc-root{box-sizing:border-box;max-width:100%;padding:24px;background:#fff;color:#111;font:14px/1.6 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}\n.msdoc-root *{box-sizing:border-box}\n.msdoc-paragraph{margin:0 0 8px;white-space:normal;word-break:break-word;overflow-wrap:anywhere}\n.msdoc-paragraph:last-child{margin-bottom:0}\n.msdoc-table{margin:12px 0;border-collapse:collapse;border-spacing:0;max-width:100%}\n.msdoc-cell{padding:6px 8px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}\n.msdoc-link{color:#1a73e8;text-decoration:none}\n.msdoc-link:hover{text-decoration:underline}\n.msdoc-image{display:inline-block;vertical-align:middle}\n.msdoc-image-fallback{display:inline-flex;align-items:center;gap:6px}\n.msdoc-attachment{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;color:#0969da;text-decoration:none}\n.msdoc-attachments{margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb}\n.msdoc-attachments-title{font-weight:600;margin-bottom:8px}\n.msdoc-page-break{display:block;height:0;border-top:1px dashed #cbd5e1;margin:16px 0}\n";
}
function ua(e, t = {}) {
	let n = t.css ?? la();
	return {
		html: e.blocks.map((e) => e.type === "paragraph" ? ia(e) : e.type === "table" ? sa(e) : e.type === "attachments" ? ca(e) : "").join(""),
		css: n,
		warnings: e.warnings || [],
		meta: e.meta,
		assets: e.assets || [],
		parsed: e
	};
}
// ../../node_modules/@file-viewer/doc/dist/viewer.js
async function da(e) {
	if (e instanceof ArrayBuffer) return e;
	if (ArrayBuffer.isView(e)) {
		let t = new Uint8Array(e.byteLength);
		return t.set(new Uint8Array(e.buffer, e.byteOffset, e.byteLength)), t.buffer;
	}
	if (typeof Blob < "u" && e instanceof Blob) return await e.arrayBuffer();
	if (typeof e == "string") {
		let t = await fetch(e);
		if (!t.ok) throw Error(`Failed to fetch document: ${t.status}`);
		return await t.arrayBuffer();
	}
	throw TypeError("Unsupported input type");
}
async function fa(e, t = {}) {
	let n = await da(e);
	return t.workerClient ? t.workerClient.parseToHtml(n, {
		parseOptions: t.parseOptions || {},
		renderOptions: t.renderOptions || {}
	}) : ua(zi(n, t.parseOptions || {}), t.renderOptions || {});
}
// ../../node_modules/@file-viewer/renderer-word/dist/wordDoc.js
var pa = "<span class=\"msdoc-page-break\"></span>", ma = "<p class=\"msdoc-paragraph\"><br></p>", $ = {
	width: 794,
	height: 1123
}, ha = .24, ga = 3, _a = .15, va = "\n.msdoc-stage{\n  box-sizing:border-box;\n  min-height:100%;\n  padding:32px 24px 48px;\n  background:var(--file-viewer-render-surface-background,#ececec);\n  display:flex;\n  flex-direction:column;\n  align-items:center;\n  gap:24px;\n}\n.msdoc-page{\n  width:min(100%,794px);\n  box-sizing:border-box;\n}\n.msdoc-page > .msdoc-root{\n  box-sizing:border-box;\n  width:100%;\n  max-width:none;\n  min-height:1123px;\n  padding:clamp(24px,7%,96px) clamp(20px,6%,88px);\n  background:#fff;\n  border:1px solid #d9d9d9;\n  box-shadow:0 1px 3px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.12);\n  overflow-wrap:anywhere;\n}\n/* 表格不能沿用正文的 anywhere 断词，否则旧 DOC 的列宽和单元格内容会被过度压缩。 */\n.msdoc-page .msdoc-table{\n  display:table;\n  width:auto;\n  max-width:100%;\n  table-layout:auto!important;\n  border-collapse:collapse;\n  border-spacing:0;\n}\n.msdoc-page .msdoc-table tbody,\n.msdoc-page .msdoc-table tr{\n  width:auto;\n}\n.msdoc-page .msdoc-cell{\n  min-width:1.5em;\n  padding:4px 6px;\n  vertical-align:top;\n  word-break:normal;\n  overflow-wrap:normal;\n  white-space:normal;\n}\n.msdoc-page .msdoc-cell .msdoc-paragraph{\n  margin:0 0 4px;\n  word-break:normal;\n  overflow-wrap:break-word;\n}\n.msdoc-page .msdoc-cell .msdoc-paragraph:last-child{\n  margin-bottom:0;\n}\n.msdoc-page .msdoc-cell span{\n  white-space:normal!important;\n}\n.msdoc-page .msdoc-page-break{\n  display:none;\n}\n[data-viewer-theme='dark'] .msdoc-stage{\n  background:var(--file-viewer-render-surface-background,#111827);\n}\n[data-viewer-theme='dark'] .msdoc-page > .msdoc-root{\n  color-scheme:dark;\n  background:#161b22;\n  border-color:rgba(139,148,158,.24);\n  color:#e6edf3;\n  box-shadow:0 18px 44px rgba(0,0,0,.36);\n}\n[data-viewer-theme='dark'] .msdoc-page > .msdoc-root span[style*='color:#000000']{\n  color:#e6edf3!important;\n}\n[data-viewer-theme='dark'] .msdoc-page .msdoc-link{\n  color:#58a6ff;\n}\n[data-viewer-theme='dark'] .msdoc-page .msdoc-attachment{\n  border-color:rgba(139,148,158,.3);\n  background:#21262d;\n  color:#58a6ff;\n}\n@media (prefers-color-scheme:dark){\n  [data-viewer-theme='system'] .msdoc-stage{\n    background:var(--file-viewer-render-surface-background,#111827);\n  }\n  [data-viewer-theme='system'] .msdoc-page > .msdoc-root{\n    color-scheme:dark;\n    background:#161b22;\n    border-color:rgba(139,148,158,.24);\n    color:#e6edf3;\n    box-shadow:0 18px 44px rgba(0,0,0,.36);\n  }\n  [data-viewer-theme='system'] .msdoc-page > .msdoc-root span[style*='color:#000000']{\n    color:#e6edf3!important;\n  }\n  [data-viewer-theme='system'] .msdoc-page .msdoc-link{\n    color:#58a6ff;\n  }\n  [data-viewer-theme='system'] .msdoc-page .msdoc-attachment{\n    border-color:rgba(139,148,158,.3);\n    background:#21262d;\n    color:#58a6ff;\n  }\n}\n@media (max-width: 860px){\n  .msdoc-stage{\n    padding:16px 12px 24px;\n    gap:16px;\n  }\n  .msdoc-page{\n    width:100%;\n  }\n  .msdoc-page > .msdoc-root{\n    min-height:auto;\n    padding:24px 20px;\n    box-shadow:none;\n  }\n}\n", ya = `
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
  width:${$.width}px;
  max-width:none;
  margin:0;
  transform-origin:top center;
}
`, ba = (e) => e.ownerDocument.defaultView;
function xa(e) {
	return e.replace(/<(p|table|section)([^>]*?)style="([^"]*?\bbreak-before\s*:\s*page;?[^"]*?)"([^>]*)>/gi, (e) => `${pa}${e}`);
}
function Sa(e) {
	return `<div class="msdoc-stage">${xa(e).split(pa).map((e) => `<section class="msdoc-page"><div class="msdoc-root">${e || ma}</div></section>`).join("")}</div>`;
}
function Ca(e) {
	let t = e.cloneNode(!0);
	return t.classList.remove("msdoc-zoom-viewer"), t.querySelectorAll("style[data-msdoc-zoom]").forEach((e) => e.remove()), t.querySelectorAll(".msdoc-stage, .msdoc-page, .msdoc-root").forEach((e) => {
		e.style.height = "auto", e.style.maxHeight = "none", e.style.overflow = "visible", e.style.transform = "none";
	}), t.querySelectorAll(".msdoc-page").forEach((e, t) => {
		e.dataset.viewerPrintPageIndex = String(t), o(e, $, { heightMode: "min" }), e.style.position = "relative", e.style.width = a($.width), e.style.maxWidth = "none", e.style.margin = "0 auto 18px";
		let n = e.querySelector(".msdoc-root");
		n && (n.style.position = "relative", n.style.top = "auto", n.style.left = "auto", n.style.width = a($.width), n.style.maxWidth = "none", n.style.minHeight = a($.height), n.style.height = "auto", n.style.transform = "none", n.style.transformOrigin = "top left", n.style.boxShadow = "none", n.style.border = "0", n.style.overflow = "visible");
	}), t.innerHTML;
}
function wa() {
	return i({
		selector: ".viewer-export-content .msdoc-page",
		width: $.width,
		height: $.height,
		heightMode: "min"
	});
}
function Ta(i) {
	let a = Array.from(i.querySelectorAll(".msdoc-page"));
	if (!a.length) return () => {};
	i.classList.add("msdoc-zoom-viewer");
	let o = ba(i), s = o?.ResizeObserver, c = i.ownerDocument.createElement("style");
	c.dataset.msdocZoom = "true", c.textContent = ya, i.prepend(c);
	let l = t(), u = 0, d = 1, f = 1, p = 1, m = (e) => Math.min(ga, Math.max(ha, Number(e.toFixed(2)))), h = () => {
		let e = f, t = p, n = !1;
		a.forEach((r) => {
			let a = r.querySelector(".msdoc-root");
			if (!a) return;
			let o = a.offsetWidth || $.width, s = Math.max(a.scrollHeight, a.offsetHeight, $.height), c = Math.max(i.clientWidth - 48, 120), l = Math.min(1, Math.max(ha, c / o)), u = m(l * d);
			n ||= (e = u, t = l, !0), a.style.transform = `translateX(-50%) scale(${u})`, r.style.width = `${Math.ceil(Math.max(o * u, 120))}px`, r.style.height = `${Math.ceil(s * u)}px`;
		}), n && (f = e, p = t, l.emit());
	}, g = () => {
		o ? (o.cancelAnimationFrame(u), u = o.requestAnimationFrame(() => {
			h();
		})) : h();
	}, _ = () => ({
		scale: f,
		label: `${Math.round(f * 100)}%`,
		canZoomIn: f < ga,
		canZoomOut: f > ha,
		canReset: d !== 1,
		minScale: ha,
		maxScale: ga
	}), v = (e) => (d = Math.min(6, Math.max(.2, Number(e.toFixed(2)))), o?.cancelAnimationFrame(u), h(), _()), y = (e) => v(e / Math.max(p, .01)), b = () => ({
		width: a[0]?.querySelector(".msdoc-root")?.offsetWidth || $.width,
		height: $.height
	}), x = (e) => {
		let t = b(), n = e.mode === "auto" ? "width" : e.mode, a = r({
			mode: n,
			viewportWidth: Math.max(1, e.viewportWidth || i.clientWidth || 0),
			viewportHeight: Math.max(1, e.viewportHeight || i.clientHeight || 0),
			contentWidth: t.width,
			contentHeight: t.height,
			currentScale: f,
			minScale: e.minScale ?? ha,
			maxScale: e.maxScale ?? ga
		});
		if (!a) return {
			applied: !1,
			mode: e.mode,
			resize: e.resize,
			source: e.source,
			reason: "unmeasurable",
			provider: "zoom"
		};
		let o = y(a);
		return {
			applied: !0,
			mode: e.mode,
			resize: e.resize,
			scale: o.scale,
			source: e.source,
			provider: "zoom"
		};
	};
	i.dataset.viewerZoomProvider = "doc", e(i, {
		zoomIn: () => v((f + _a) / Math.max(p, .01)),
		zoomOut: () => v((f - _a) / Math.max(p, .01)),
		resetZoom: () => v(1),
		setZoom: y,
		fit: x,
		getState: _,
		subscribe: l.subscribe
	});
	let S = s ? new s(g) : null;
	return S?.observe(i), a.forEach((e) => {
		let t = e.querySelector(".msdoc-root");
		t && S?.observe(t);
	}), h(), () => {
		o?.cancelAnimationFrame(u), S?.disconnect(), n(i), c.remove(), i.classList.remove("msdoc-zoom-viewer");
	};
}
async function Ea(e, t, n) {
	var r, i;
	let a = await fa(e, { renderOptions: { css: `${la()}\n${va}` } });
	t.innerHTML = `<style data-msdoc>${a.css}</style>${Sa(a.html)}`;
	let o = Ta(t);
	return (r = n?.registerExportAdapter) == null || r.call(n, {
		includeDocumentStyles: !1,
		getPrintMaskPages: () => Array.from(t.querySelectorAll(".msdoc-page")),
		printStyle: wa,
		toHtml: () => Ca(t)
	}), (i = n?.registerThumbnailAdapter) == null || i.call(n, { getTarget: () => t.querySelector(".msdoc-page") || t }), {
		$el: t,
		unmount() {
			var e, r;
			(e = n?.registerExportAdapter) == null || e.call(n, null), (r = n?.registerThumbnailAdapter) == null || r.call(n, null), o(), t.innerHTML = "";
		}
	};
}
export { Ea as default };
