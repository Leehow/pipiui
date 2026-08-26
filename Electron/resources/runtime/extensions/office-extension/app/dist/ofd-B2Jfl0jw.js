import { e as W1 } from "./index-DK4k06Xx.js";
const D1 = (e) => {
  let t = e.split(" "), i = [], r = 0;
  for (; r < t.length; ) {
    if (t[r] === "M" || t[r] === "S") {
      let c = {
        type: "M",
        x: parseFloat(t[r + 1]),
        y: parseFloat(t[r + 2])
      };
      r = r + 3, i.push(c);
    }
    if (t[r] === "L") {
      let c = {
        type: "L",
        x: parseFloat(t[r + 1]),
        y: parseFloat(t[r + 2])
      };
      r = r + 3, i.push(c);
    } else if (t[r] === "C") {
      let c = {
        type: "C",
        x: 0,
        y: 0
      };
      i.push(c), r++;
    } else if (t[r] === "B") {
      let c = {
        type: "B",
        x1: parseFloat(t[r + 1]),
        y1: parseFloat(t[r + 2]),
        x2: parseFloat(t[r + 3]),
        y2: parseFloat(t[r + 4]),
        x3: parseFloat(t[r + 5]),
        y3: parseFloat(t[r + 6])
      };
      r = r + 7, i.push(c);
    } else if (t[r] === "Q") {
      let c = {
        type: "Q",
        x1: parseFloat(t[r + 1]),
        y1: parseFloat(t[r + 2]),
        x2: parseFloat(t[r + 3]),
        y2: parseFloat(t[r + 4])
      };
      r = r + 5, i.push(c);
    } else
      r++;
  }
  return i;
}, E1 = function(e) {
  let t = [];
  for (let i = 0; i < e.length; i++) {
    let r = e[i];
    if (r.type === "M" || r.type === "L" || r.type === "C") {
      let c = 0, o = 0;
      c = r.x, o = r.y, r.x = X(c), r.y = X(o), t.push(r);
    } else if (r.type === "B") {
      let c = r.x1, o = r.y1, s = r.x2, a = r.y2, m = r.x3, S = r.y3, f = {
        type: "B",
        x1: X(c),
        y1: X(o),
        x2: X(s),
        y2: X(a),
        x3: X(m),
        y3: X(S)
      };
      t.push(f);
    } else if (r.type === "Q") {
      let c = {
        type: "Q",
        x1: X(r.x1),
        y1: X(r.y1),
        x2: X(r.x2),
        y2: X(r.y2)
      };
      t.push(c);
    }
  }
  return t;
}, q1 = function(e, t) {
  return e * t / 25.4;
};
let e1 = 10, We = e1;
const U1 = function(e) {
  e1 = e > 5 ? 5 : e;
}, P1 = function(e) {
  We = e > 1 ? e : 1, We = We > e1 ? e1 : We;
}, j1 = function() {
  return We;
}, X = function(e) {
  return q1(e, We * 25.4);
}, f1 = function(e) {
  if (e.indexOf("g") === -1) {
    let t = [];
    for (let i of e.split(" "))
      t.push(parseFloat(i));
    return t;
  } else {
    const t = e.split(" ");
    let i = !1, r = !1, c = 0, o = [];
    for (const s of t)
      if (s === "g")
        i = !0;
      else {
        if (!s || s.trim().length == 0)
          continue;
        if (i)
          c = parseInt(s), r = !0, i = !1;
        else if (r) {
          for (let a = 0; a < c; a++)
            o.push(parseFloat(s));
          r = !1;
        } else
          o.push(parseFloat(s));
      }
    return o;
  }
}, $1 = function(e) {
  let t = 0, i = 0, r = [];
  if (!e)
    return r;
  for (let c of e) {
    if (!c)
      continue;
    t = parseFloat(c["@_X"]), i = parseFloat(c["@_Y"]), isNaN(t) && (t = 0), isNaN(i) && (i = 0);
    let o = [], s = [];
    c["@_DeltaX"] && c["@_DeltaX"].length > 0 && (o = f1(c["@_DeltaX"])), c["@_DeltaY"] && c["@_DeltaY"].length > 0 && (s = f1(c["@_DeltaY"]));
    let a = c["#text"];
    if (a) {
      a += "", a = Z1(a);
      for (let m = 0; m < a.length; m++) {
        m > 0 && o.length > 0 && (t += o[m - 1]), m > 0 && s.length > 0 && (i += s[m - 1]);
        let S = a.substring(m, m + 1), f = r.filter((N) => N.y == X(i));
        if (f && f.length)
          f[0].text += S;
        else {
          let N = { x: X(t), y: X(i), text: S };
          r.push(N);
        }
      }
    }
  }
  return r;
}, Qe = function(e) {
  return e && e.indexOf("/") === 0 && (e = e.replace("/", "")), e;
}, z1 = function(e) {
  return !e && typeof e != "string" ? "" : e.substring(e.lastIndexOf(".") + 1);
};
let Q1 = /&\w+;|&#(x?[0-9a-fA-F]+);/g, J1 = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&nbsp;": " ",
  "&quot;": '"',
  "&copy;": "",
  "&apos;": "'"
  // Add more
};
const Y1 = function(e) {
  return e = e ?? this.toString(), typeof e != "string" ? e : e.replace(
    Q1,
    function(t, i) {
      var r = J1[t];
      if (r == null)
        if (i) {
          const c = /^x/i.test(i) ? parseInt(i.slice(1), 16) : parseInt(i, 10);
          r = Number.isFinite(c) ? String.fromCodePoint(c == 160 ? 32 : c) : t;
        } else
          r = t;
      return r;
    }
  );
}, Z1 = function(e) {
  return e = Y1(e), typeof e != "string" ? e : e.replace(/\\0x([0-9a-fA-F]{4,6})/g, function(t, i) {
    const r = parseInt(i, 16);
    return Number.isFinite(r) ? String.fromCodePoint(r == 160 ? 32 : r) : t;
  });
};
let Je = {
  楷体: "楷体, KaiTi, Kai, simkai",
  kaiti: "楷体, KaiTi, Kai, simkai",
  Kai: "楷体, KaiTi, Kai",
  simsun: "SimSun, simsun, Songti SC",
  宋体: "SimSun, simsun, Songti SC",
  黑体: "SimHei, STHeiti, simhei",
  仿宋: "FangSong, STFangsong, simfang",
  小标宋体: "sSun",
  方正小标宋_gbk: "sSun",
  仿宋_gb2312: "FangSong, STFangsong, simfang",
  楷体_gb2312: "楷体, KaiTi, Kai, simkai",
  couriernew: "Courier New",
  "courier new": "Courier New"
};
const et = function(e) {
  Je[e.toLowerCase()] && (e = Je[e.toLowerCase()]);
  for (let t of Object.keys(Je))
    if (e.toLowerCase().indexOf(t.toLowerCase()) != -1)
      return Je[t];
  return e;
}, ve = function(e) {
  if (e) {
    let t = e.split(" ");
    return {
      x: parseFloat(t[0]),
      y: parseFloat(t[1]),
      w: parseFloat(t[2]),
      h: parseFloat(t[3])
    };
  } else
    return null;
}, n1 = function(e) {
  return e.split(" ");
}, Fe = function(e) {
  if (e) {
    if (e.indexOf("#") !== -1)
      return e = e.replace(/#/g, ""), e = e.replace(/ /g, ""), e = "#" + e.toString(), e;
    let t = e.split(" ");
    return `rgb(${t[0]}, ${t[1]}, ${t[2]})`;
  } else
    return "rgb(0, 0, 0)";
}, Me = function(e) {
  return {
    x: X(e.x),
    y: X(e.y),
    w: X(e.w),
    h: X(e.h)
  };
}, tt = function(e, t, i) {
  const r = i[Object.keys(i)[0]].json["ofd:Area"];
  let c;
  if (r) {
    const a = r["ofd:PhysicalBox"];
    if (a)
      c = a;
    else {
      const m = r["ofd:ApplicationBox"];
      if (m)
        c = m;
      else {
        const S = r["ofd:ContentBox"];
        S && (c = S);
      }
    }
  } else {
    let a = t["ofd:CommonData"]["ofd:PageArea"];
    const m = a["ofd:PhysicalBox"];
    if (m)
      c = m;
    else {
      const S = a["ofd:ApplicationBox"];
      if (S)
        c = S;
      else {
        const f = a["ofd:ContentBox"];
        f && (c = f);
      }
    }
  }
  let o = c.split(" ");
  const s = ((e - 10) / parseFloat(o[2])).toFixed(1);
  return U1(s), P1(s), c = ve(c), c = Me(c), c;
}, it = function(e, t) {
  const i = t[Object.keys(t)[0]].json["ofd:Area"];
  let r;
  if (i) {
    const c = i["ofd:PhysicalBox"];
    if (c)
      r = c;
    else {
      const o = i["ofd:ApplicationBox"];
      if (o)
        r = o;
      else {
        const s = i["ofd:ContentBox"];
        s && (r = s);
      }
    }
  } else {
    let c = e["ofd:CommonData"]["ofd:PageArea"];
    const o = c["ofd:PhysicalBox"];
    if (o)
      r = o;
    else {
      const s = c["ofd:ApplicationBox"];
      if (s)
        r = s;
      else {
        const a = c["ofd:ContentBox"];
        a && (r = a);
      }
    }
  }
  return r = ve(r), r = Me(r), r;
}, a1 = function(e, t, i) {
  let r = i?.fillColor ?? null, c = i?.strokeColor ?? null, o = i?.lineWith;
  if (!t || !e || !e[t])
    return { fillColor: r, strokeColor: c, lineWith: o };
  let s = t;
  return e[s].relative && (s = e[s].relative, e[s] && e[s].FillColor && (r = Fe(e[s].FillColor)), e[s] && e[s].StrokeColor && (c = Fe(e[s].StrokeColor)), e[s] && e[s].LineWidth && (o = X(e[s].LineWidth)), s = t), e[s].FillColor && (r = Fe(e[s].FillColor)), e[s].StrokeColor && (c = Fe(e[s].StrokeColor)), e[s].LineWidth && (o = X(e[s].LineWidth)), { fillColor: r, strokeColor: c, lineWith: o };
}, S1 = function(e, t, i, r, c, o) {
  let s = [];
  const a = e[t["@_TemplateID"]].json["ofd:Content"]["ofd:Layer"];
  s = s.concat(a);
  for (let m of s)
    m && je(i, r, c, o, m, !1);
}, x1 = function(e, t, i, r, c, o) {
  const s = Object.keys(t)[0], a = t[s].json["ofd:Template"];
  Array.isArray(a) ? a.forEach((f) => {
    f && S1(i, f, e, r, c, o);
  }) : a && S1(i, a, e, r, c, o);
  const m = t[s]?.json?.["ofd:Content"]?.["ofd:Layer"];
  let S = [];
  S = S.concat(m);
  for (let f of S)
    f && je(e, r, c, o, f, !1);
  if (t[s].stamp) {
    for (const f of t[s].stamp)
      if (f.type === "ofd")
        ct(e, f.obj.pages, f.obj.tpls, !0, f.stamp.stampAnnot, f.obj.fontResObj, f.obj.drawParamResObj, f.obj.multiMediaResObj, f.stamp.sealObj.SES_Signature, f.stamp.signedInfo);
      else if (f.type === "png") {
        let N = Me(f.obj.boundary);
        const B = Array.isArray(f.stamp.stampAnnot) ? f.stamp.stampAnnot[0].pfIndex : f.stamp.stampAnnot.pfIndex;
        let O = M1(e.style.width, e.style.height, f.obj.img, N, f.obj.clip, !0, f.stamp.sealObj.SES_Signature, f.stamp.signedInfo, B);
        e.appendChild(O);
      }
  }
  if (t[s].annotation)
    for (const f of t[s].annotation)
      rt(e, f, r, c, o);
}, rt = function(e, t, i, r, c) {
  let o = document.createElement("div");
  o.setAttribute("style", `overflow: hidden;z-index:${t.pfIndex};position:relative;`);
  let s = t.appearance?.["@_Boundary"];
  if (s) {
    let m = Me(ve(s));
    o.setAttribute("style", `overflow: hidden;z-index:${t.pfIndex};position:absolute; left: ${m.x}px; top: ${m.y}px; width: ${m.w}px; height: ${m.h}px`);
  }
  const a = t.appearance;
  je(o, i, r, c, a, !1), e.appendChild(o);
}, ct = function(e, t, i, r, c, o, s, a, m, S) {
  for (const f of t) {
    const N = Object.keys(f)[0];
    let B = { x: 0, y: 0, w: 0, h: 0 };
    c && (B = c.boundary);
    let O = Me(B), G = document.createElement("div");
    G.setAttribute("name", "seal_img_div"), G.setAttribute("style", `cursor: pointer; overflow: hidden; position:absolute; left: ${O.x}px; top: ${O.y}px; width: ${O.w}px; height: ${O.h}px`), G.setAttribute("data-ses-signature", `${JSON.stringify(m || {})}`), G.setAttribute("data-signed-info", `${JSON.stringify(S || {})}`);
    const ie = f[N].json["ofd:Template"];
    if (ie) {
      const q = i[ie["@_TemplateID"]].json["ofd:Content"]["ofd:Layer"];
      let y = [];
      y = y.concat(q);
      for (let x of y)
        x && je(G, o, s, a, x, r);
    }
    const ae = f[N].json["ofd:Content"]["ofd:Layer"];
    let de = [];
    de = de.concat(ae);
    for (let q of de)
      q && je(G, o, s, a, q, r);
    e.appendChild(G);
  }
}, je = function(e, t, i, r, c, o) {
  const s = a1(i, c?.["@_DrawParam"], {
    fillColor: null,
    strokeColor: null,
    lineWith: X(0.353)
  });
  let a = s.fillColor, m = s.strokeColor, S = s.lineWith;
  const f = c?.["ofd:ImageObject"];
  let N = [];
  N = N.concat(f);
  for (const q of N)
    if (q) {
      let y = nt(e.style.width, e.style.height, r, q);
      e.appendChild(y);
    }
  const B = c?.["ofd:PathObject"];
  let O = [];
  O = O.concat(B);
  for (const q of O)
    if (q) {
      let y = ft(i, q, a, m, S, o);
      e.appendChild(y);
    }
  const G = c?.["ofd:TextObject"];
  let ie = [];
  ie = ie.concat(G);
  for (const q of ie)
    if (q) {
      let y = pt(i, t, q, a, m);
      e.appendChild(y);
    }
  const ae = c?.["ofd:PageBlock"];
  let de = [];
  de = de.concat(ae);
  for (const q of de)
    q && je(e, t, i, r, q, o);
}, st = function(e) {
  if (!e)
    return null;
  const t = String(e).trim().split(/\s+/).map(Number);
  return t.length === 6 && t.every((i) => Number.isFinite(i)) ? t : null;
}, ot = function(e) {
  const t = ve(e["@_Boundary"]), i = Me(t), r = st(e["@_CTM"]);
  if (!r)
    return { boundary: i, matrix: null };
  const [c, o, s, a, m, S] = r;
  return Math.abs(o) < 1e-6 && Math.abs(s) < 1e-6 ? { boundary: Me({
    x: t.x + Math.min(m, m + c),
    y: t.y + Math.min(S, S + a),
    w: Math.abs(c),
    h: Math.abs(a)
  }), matrix: null } : {
    boundary: i,
    matrix: [c, o, s, a, t.x + m, t.y + S]
  };
}, nt = function(e, t, i, r) {
  const { boundary: c, matrix: o } = ot(r), s = r["@_ResourceID"], a = i ? i[s] : null;
  if (!a || typeof a != "object")
    return dt(c, r.pfIndex);
  if (a.format === "gbig2") {
    const m = a.img, S = a.width, f = a.height;
    return lt(m, S, f, c, r.pfIndex);
  } else return o ? at(a.img, o, r.pfIndex) : M1(e, t, a.img, c, !1, !1, null, null, r.pfIndex);
}, at = function(e, t, i) {
  const [r, c, o, s, a, m] = t, S = X(1);
  let f = document.createElement("img");
  return f.src = e, f.setAttribute("width", `${S}`), f.setAttribute("height", `${S}`), f.setAttribute("style", `position:absolute;left:0;top:0;transform-origin:0 0;transform:matrix(${r}, ${c}, ${o}, ${s}, ${X(a)}, ${X(m)});z-index:${i}`), f;
}, dt = function(e, t) {
  let i = document.createElement("div");
  return i.setAttribute("style", `overflow: hidden; position: absolute; left: ${e.x}px; top: ${e.y}px; width: ${e.w}px; height: ${e.h}px;z-index: ${t}`), i;
}, lt = function(e, t, i, r, c) {
  const o = new Uint8ClampedArray(4 * t * i);
  for (var s = 0; s < e.length; s++)
    o[4 * s] = e[s], o[4 * s + 1] = e[s], o[4 * s + 2] = e[s], o[4 * s + 3] = 255;
  let a = new ImageData(o, t, i), m = document.createElement("canvas");
  return m.width = t, m.height = i, m.getContext("2d").putImageData(a, 0, 0), m.setAttribute("style", `left: ${r.x}px; top: ${r.y}px; width: ${r.w}px; height: ${r.h}px;z-index: ${c}`), m.style.position = "absolute", m;
}, M1 = function(e, t, i, r, c, o, s, a, m) {
  let S = document.createElement("div");
  o && (S.setAttribute("name", "seal_img_div"), S.setAttribute("data-ses-signature", `${JSON.stringify(s || {})}`), S.setAttribute("data-signed-info", `${JSON.stringify(a || {})}`));
  let f = document.createElement("img");
  f.src = i, f.setAttribute("width", "100%"), f.setAttribute("height", "100%"), S.appendChild(f);
  let N = "";
  return c && (c = Me(c), N = `clip: rect(${c.y}px, ${c.w + c.x}px, ${c.h + c.y}px, ${c.x}px)`), S.setAttribute("style", `cursor: pointer; overflow: hidden; position: absolute; left: ${r.x}px; top: ${r.y}px; width: ${r.w}px; height: ${r.h}px; ${N};z-index: ${m}`), S;
}, pt = function(e, t, i, r, c) {
  let o = 1, s = ve(i["@_Boundary"]);
  s = Me(s);
  const a = i["@_CTM"], m = i["@_HScale"], S = i["@_Font"], f = i["@_Weight"], N = X(parseFloat(i["@_Size"]));
  let B = [];
  B = B.concat(i["ofd:TextCode"]);
  const O = $1(B);
  let G = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  G.setAttribute("version", "1.1");
  const ie = a1(e, i["@_DrawParam"], {
    fillColor: r,
    strokeColor: c
  });
  r = ie.fillColor, c = ie.strokeColor;
  const ae = i["ofd:FillColor"];
  if (ae) {
    r = Fe(ae["@_Value"]);
    let w = ae["@_Alpha"];
    w && (o = w > 1 ? w / 255 : w);
  }
  for (const w of O)
    if (w && !isNaN(w.x)) {
      let P = document.createElementNS("http://www.w3.org/2000/svg", "text");
      if (P.setAttribute("x", w.x), P.setAttribute("y", w.y), P.textContent = w.text, a) {
        const W = n1(a);
        P.setAttribute("transform", `matrix(${W[0]} ${W[1]} ${W[2]} ${W[3]} ${X(W[4])} ${X(W[5])})`);
      }
      m && P.setAttribute("transform", `matrix(${m}, 0, 0, 1, ${(1 - m) * w.x}, 0)`);
      const R = r || c || "rgb(0, 0, 0)";
      P.setAttribute("fill", R), P.setAttribute("fill-opacity", o), P.setAttribute("style", `font-weight: ${f};font-size:${N}px;font-family: ${et(t[S])};color:${R};`), G.appendChild(P);
    }
  let de = s.w, q = s.h, y = s.x, x = s.y;
  return G.setAttribute("style", `overflow:visible;position:absolute;width:${de}px;height:${q}px;left:${y}px;top:${x}px;z-index:${i.pfIndex}`), G;
}, w1 = function(e) {
  let t = "";
  for (const i of e)
    i.type === "M" ? t += `M${i.x} ${i.y} ` : i.type === "L" ? t += `L${i.x} ${i.y} ` : i.type === "Q" ? t += `Q${i.x1} ${i.y1} ${i.x2} ${i.y2} ` : i.type === "B" ? t += `C${i.x1} ${i.y1} ${i.x2} ${i.y2} ${i.x3} ${i.y3} ` : i.type === "C" && (t += "Z");
  return t;
}, ut = function(e, t) {
  const i = t?.["ofd:Path"], r = i?.["ofd:AbbreviatedData"];
  if (!i || !r)
    return;
  const c = E1(D1(r)), o = document.createElementNS("http://www.w3.org/2000/svg", "path");
  o.setAttribute("d", w1(c));
  const s = i["@_CTM"];
  if (s) {
    const a = n1(s);
    o.setAttribute("transform", `matrix(${a[0]} ${a[1]} ${a[2]} ${a[3]} ${X(a[4])} ${X(a[5])})`);
  }
  e.appendChild(o);
}, mt = function(e, t, i) {
  const r = i?.["ofd:Clip"];
  if (!r)
    return t;
  let c = [];
  c = c.concat(r);
  let o = null, s = t, a = 0;
  for (const m of c) {
    const S = m?.["ofd:Area"];
    if (!m || !S)
      continue;
    o || (o = document.createElementNS("http://www.w3.org/2000/svg", "defs"), e.appendChild(o));
    const f = document.createElementNS("http://www.w3.org/2000/svg", "clipPath"), N = `ofd-clip-${a++}-${Math.random().toString(36).slice(2, 8)}`;
    f.setAttribute("id", N);
    let B = [];
    B = B.concat(S);
    for (const G of B)
      G && ut(f, G);
    o.appendChild(f);
    const O = document.createElementNS("http://www.w3.org/2000/svg", "g");
    O.setAttribute("clip-path", `url(#${N})`), O.appendChild(s), s = O;
  }
  return s;
}, ft = function(e, t, i, r, c, o) {
  let s = ve(t["@_Boundary"]);
  s = Me(s);
  let a = t["@_LineWidth"];
  const m = t["ofd:AbbreviatedData"], S = E1(D1(m)), f = t["@_CTM"];
  let N = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  N.setAttribute("version", "1.1");
  let B = document.createElementNS("http://www.w3.org/2000/svg", "path");
  a && (c = X(a));
  const O = t["@_DrawParam"];
  O && (a = e[O]?.LineWidth, a && (c = X(a)));
  const G = a1(e, O, {
    fillColor: i,
    strokeColor: r
  });
  if (i = G.fillColor, r = G.strokeColor, f) {
    const R = n1(f);
    B.setAttribute("transform", `matrix(${R[0]} ${R[1]} ${R[2]} ${R[3]} ${X(R[4])} ${X(R[5])})`);
  }
  let ie = "";
  const ae = t["ofd:StrokeColor"];
  ae && (r = Fe(ae["@_Value"]));
  let de = "fill: none;";
  const q = t["ofd:FillColor"];
  q && (i = Fe(q["@_Value"])), c > 0 && !r && (r = i, r || (r = "rgb(0, 0, 0)")), ie = `stroke:${r};stroke-width:${c}px;`, t["@_Stroke"] == "false" && (ie = ""), t["@_Fill"] != "false" && (de = `fill:${o ? "none" : i || "none"};`), B.setAttribute("style", `${ie};${de}`), B.setAttribute("d", w1(S)), N.appendChild(mt(N, B, t["ofd:Clips"]));
  let y = o ? s.w : Math.ceil(s.w), x = o ? s.h : Math.ceil(s.h), w = s.x, P = s.y;
  return N.setAttribute("style", `overflow:visible;position:absolute;width:${y}px;height:${x}px;left:${w}px;top:${P}px;z-index:${t.pfIndex}`), N;
}, St = async function(...e) {
  let t;
  for (let i = 0; i < e.length; i += 1)
    t = await e[i].call(this, t);
  return t;
}, N1 = St;
var h1 = {}, g1;
function ht() {
  return g1 || (g1 = 1, globalThis._pdfjsCompatibilityChecked || (globalThis._pdfjsCompatibilityChecked = !0)), h1;
}
ht();
function gt(e) {
  throw new Error(e);
}
function C1(e, t, i) {
  return Object.defineProperty(e, t, {
    value: i,
    enumerable: !0,
    configurable: !0,
    writable: !1
  }), i;
}
const Ct = (function() {
  function t(i) {
    this.constructor === t && gt("Cannot initialize BaseException."), this.message = i, this.name = this.constructor.name;
  }
  return t.prototype = new Error(), t.constructor = t, t;
})();
function r1(e) {
  return e <= 0 ? 0 : Math.ceil(Math.log2(e));
}
function Ke(e, t) {
  return e[t] << 24 >> 24;
}
function Oe(e, t) {
  return e[t] << 8 | e[t + 1];
}
function ee(e, t) {
  return (e[t] << 24 | e[t + 1] << 16 | e[t + 2] << 8 | e[t + 3]) >>> 0;
}
const yt = [
  { qe: 22017, nmps: 1, nlps: 1, switchFlag: 1 },
  { qe: 13313, nmps: 2, nlps: 6, switchFlag: 0 },
  { qe: 6145, nmps: 3, nlps: 9, switchFlag: 0 },
  { qe: 2753, nmps: 4, nlps: 12, switchFlag: 0 },
  { qe: 1313, nmps: 5, nlps: 29, switchFlag: 0 },
  { qe: 545, nmps: 38, nlps: 33, switchFlag: 0 },
  { qe: 22017, nmps: 7, nlps: 6, switchFlag: 1 },
  { qe: 21505, nmps: 8, nlps: 14, switchFlag: 0 },
  { qe: 18433, nmps: 9, nlps: 14, switchFlag: 0 },
  { qe: 14337, nmps: 10, nlps: 14, switchFlag: 0 },
  { qe: 12289, nmps: 11, nlps: 17, switchFlag: 0 },
  { qe: 9217, nmps: 12, nlps: 18, switchFlag: 0 },
  { qe: 7169, nmps: 13, nlps: 20, switchFlag: 0 },
  { qe: 5633, nmps: 29, nlps: 21, switchFlag: 0 },
  { qe: 22017, nmps: 15, nlps: 14, switchFlag: 1 },
  { qe: 21505, nmps: 16, nlps: 14, switchFlag: 0 },
  { qe: 20737, nmps: 17, nlps: 15, switchFlag: 0 },
  { qe: 18433, nmps: 18, nlps: 16, switchFlag: 0 },
  { qe: 14337, nmps: 19, nlps: 17, switchFlag: 0 },
  { qe: 13313, nmps: 20, nlps: 18, switchFlag: 0 },
  { qe: 12289, nmps: 21, nlps: 19, switchFlag: 0 },
  { qe: 10241, nmps: 22, nlps: 19, switchFlag: 0 },
  { qe: 9217, nmps: 23, nlps: 20, switchFlag: 0 },
  { qe: 8705, nmps: 24, nlps: 21, switchFlag: 0 },
  { qe: 7169, nmps: 25, nlps: 22, switchFlag: 0 },
  { qe: 6145, nmps: 26, nlps: 23, switchFlag: 0 },
  { qe: 5633, nmps: 27, nlps: 24, switchFlag: 0 },
  { qe: 5121, nmps: 28, nlps: 25, switchFlag: 0 },
  { qe: 4609, nmps: 29, nlps: 26, switchFlag: 0 },
  { qe: 4353, nmps: 30, nlps: 27, switchFlag: 0 },
  { qe: 2753, nmps: 31, nlps: 28, switchFlag: 0 },
  { qe: 2497, nmps: 32, nlps: 29, switchFlag: 0 },
  { qe: 2209, nmps: 33, nlps: 30, switchFlag: 0 },
  { qe: 1313, nmps: 34, nlps: 31, switchFlag: 0 },
  { qe: 1089, nmps: 35, nlps: 32, switchFlag: 0 },
  { qe: 673, nmps: 36, nlps: 33, switchFlag: 0 },
  { qe: 545, nmps: 37, nlps: 34, switchFlag: 0 },
  { qe: 321, nmps: 38, nlps: 35, switchFlag: 0 },
  { qe: 273, nmps: 39, nlps: 36, switchFlag: 0 },
  { qe: 133, nmps: 40, nlps: 37, switchFlag: 0 },
  { qe: 73, nmps: 41, nlps: 38, switchFlag: 0 },
  { qe: 37, nmps: 42, nlps: 39, switchFlag: 0 },
  { qe: 21, nmps: 43, nlps: 40, switchFlag: 0 },
  { qe: 9, nmps: 44, nlps: 41, switchFlag: 0 },
  { qe: 5, nmps: 45, nlps: 42, switchFlag: 0 },
  { qe: 1, nmps: 45, nlps: 43, switchFlag: 0 },
  { qe: 22017, nmps: 46, nlps: 46, switchFlag: 0 }
];
class bt {
  // C.3.5 Initialisation of the decoder (INITDEC)
  constructor(t, i, r) {
    this.data = t, this.bp = i, this.dataEnd = r, this.chigh = t[i], this.clow = 0, this.byteIn(), this.chigh = this.chigh << 7 & 65535 | this.clow >> 9 & 127, this.clow = this.clow << 7 & 65535, this.ct -= 7, this.a = 32768;
  }
  // C.3.4 Compressed data input (BYTEIN)
  byteIn() {
    const t = this.data;
    let i = this.bp;
    t[i] === 255 ? t[i + 1] > 143 ? (this.clow += 65280, this.ct = 8) : (i++, this.clow += t[i] << 9, this.ct = 7, this.bp = i) : (i++, this.clow += i < this.dataEnd ? t[i] << 8 : 65280, this.ct = 8, this.bp = i), this.clow > 65535 && (this.chigh += this.clow >> 16, this.clow &= 65535);
  }
  // C.3.2 Decoding a decision (DECODE)
  readBit(t, i) {
    let r = t[i] >> 1, c = t[i] & 1;
    const o = yt[r], s = o.qe;
    let a, m = this.a - s;
    if (this.chigh < s)
      m < s ? (m = s, a = c, r = o.nmps) : (m = s, a = 1 ^ c, o.switchFlag === 1 && (c = a), r = o.nlps);
    else {
      if (this.chigh -= s, (m & 32768) !== 0)
        return this.a = m, c;
      m < s ? (a = 1 ^ c, o.switchFlag === 1 && (c = a), r = o.nlps) : (a = c, r = o.nmps);
    }
    do
      this.ct === 0 && this.byteIn(), m <<= 1, this.chigh = this.chigh << 1 & 65535 | this.clow >> 15 & 1, this.clow = this.clow << 1 & 65535, this.ct--;
    while ((m & 32768) === 0);
    return this.a = m, t[i] = r << 1 | c, a;
  }
}
const It = (function() {
  const B = [
    [-1, -1],
    [-1, -1],
    // 000000x
    [7, 8],
    // 0000010
    [7, 7],
    // 0000011
    [6, 6],
    [6, 6],
    // 000010x
    [6, 5],
    [6, 5],
    // 000011x
    [4, 0],
    [4, 0],
    // 0001xxx
    [4, 0],
    [4, 0],
    [4, 0],
    [4, 0],
    [4, 0],
    [4, 0],
    [3, 1],
    [3, 1],
    // 001xxxx
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 4],
    [3, 4],
    // 010xxxx
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 3],
    [3, 3],
    // 011xxxx
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 3],
    [1, 2],
    [1, 2],
    // 1xxxxxx
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2]
  ], O = [
    [-1, -1],
    // 00000
    [12, -2],
    // 00001
    [-1, -1],
    [-1, -1],
    // 0001x
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 001xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 010xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 011xx
    [11, 1792],
    [11, 1792],
    // 1000x
    [12, 1984],
    // 10010
    [12, 2048],
    // 10011
    [12, 2112],
    // 10100
    [12, 2176],
    // 10101
    [12, 2240],
    // 10110
    [12, 2304],
    // 10111
    [11, 1856],
    [11, 1856],
    // 1100x
    [11, 1920],
    [11, 1920],
    // 1101x
    [12, 2368],
    // 11100
    [12, 2432],
    // 11101
    [12, 2496],
    // 11110
    [12, 2560]
    // 11111
  ], G = [
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 0000000xx
    [8, 29],
    [8, 29],
    // 00000010x
    [8, 30],
    [8, 30],
    // 00000011x
    [8, 45],
    [8, 45],
    // 00000100x
    [8, 46],
    [8, 46],
    // 00000101x
    [7, 22],
    [7, 22],
    [7, 22],
    [7, 22],
    // 0000011xx
    [7, 23],
    [7, 23],
    [7, 23],
    [7, 23],
    // 0000100xx
    [8, 47],
    [8, 47],
    // 00001010x
    [8, 48],
    [8, 48],
    // 00001011x
    [6, 13],
    [6, 13],
    [6, 13],
    [6, 13],
    // 000011xxx
    [6, 13],
    [6, 13],
    [6, 13],
    [6, 13],
    [7, 20],
    [7, 20],
    [7, 20],
    [7, 20],
    // 0001000xx
    [8, 33],
    [8, 33],
    // 00010010x
    [8, 34],
    [8, 34],
    // 00010011x
    [8, 35],
    [8, 35],
    // 00010100x
    [8, 36],
    [8, 36],
    // 00010101x
    [8, 37],
    [8, 37],
    // 00010110x
    [8, 38],
    [8, 38],
    // 00010111x
    [7, 19],
    [7, 19],
    [7, 19],
    [7, 19],
    // 0001100xx
    [8, 31],
    [8, 31],
    // 00011010x
    [8, 32],
    [8, 32],
    // 00011011x
    [6, 1],
    [6, 1],
    [6, 1],
    [6, 1],
    // 000111xxx
    [6, 1],
    [6, 1],
    [6, 1],
    [6, 1],
    [6, 12],
    [6, 12],
    [6, 12],
    [6, 12],
    // 001000xxx
    [6, 12],
    [6, 12],
    [6, 12],
    [6, 12],
    [8, 53],
    [8, 53],
    // 00100100x
    [8, 54],
    [8, 54],
    // 00100101x
    [7, 26],
    [7, 26],
    [7, 26],
    [7, 26],
    // 0010011xx
    [8, 39],
    [8, 39],
    // 00101000x
    [8, 40],
    [8, 40],
    // 00101001x
    [8, 41],
    [8, 41],
    // 00101010x
    [8, 42],
    [8, 42],
    // 00101011x
    [8, 43],
    [8, 43],
    // 00101100x
    [8, 44],
    [8, 44],
    // 00101101x
    [7, 21],
    [7, 21],
    [7, 21],
    [7, 21],
    // 0010111xx
    [7, 28],
    [7, 28],
    [7, 28],
    [7, 28],
    // 0011000xx
    [8, 61],
    [8, 61],
    // 00110010x
    [8, 62],
    [8, 62],
    // 00110011x
    [8, 63],
    [8, 63],
    // 00110100x
    [8, 0],
    [8, 0],
    // 00110101x
    [8, 320],
    [8, 320],
    // 00110110x
    [8, 384],
    [8, 384],
    // 00110111x
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    // 00111xxxx
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 10],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    // 01000xxxx
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [5, 11],
    [7, 27],
    [7, 27],
    [7, 27],
    [7, 27],
    // 0100100xx
    [8, 59],
    [8, 59],
    // 01001010x
    [8, 60],
    [8, 60],
    // 01001011x
    [9, 1472],
    // 010011000
    [9, 1536],
    // 010011001
    [9, 1600],
    // 010011010
    [9, 1728],
    // 010011011
    [7, 18],
    [7, 18],
    [7, 18],
    [7, 18],
    // 0100111xx
    [7, 24],
    [7, 24],
    [7, 24],
    [7, 24],
    // 0101000xx
    [8, 49],
    [8, 49],
    // 01010010x
    [8, 50],
    [8, 50],
    // 01010011x
    [8, 51],
    [8, 51],
    // 01010100x
    [8, 52],
    [8, 52],
    // 01010101x
    [7, 25],
    [7, 25],
    [7, 25],
    [7, 25],
    // 0101011xx
    [8, 55],
    [8, 55],
    // 01011000x
    [8, 56],
    [8, 56],
    // 01011001x
    [8, 57],
    [8, 57],
    // 01011010x
    [8, 58],
    [8, 58],
    // 01011011x
    [6, 192],
    [6, 192],
    [6, 192],
    [6, 192],
    // 010111xxx
    [6, 192],
    [6, 192],
    [6, 192],
    [6, 192],
    [6, 1664],
    [6, 1664],
    [6, 1664],
    [6, 1664],
    // 011000xxx
    [6, 1664],
    [6, 1664],
    [6, 1664],
    [6, 1664],
    [8, 448],
    [8, 448],
    // 01100100x
    [8, 512],
    [8, 512],
    // 01100101x
    [9, 704],
    // 011001100
    [9, 768],
    // 011001101
    [8, 640],
    [8, 640],
    // 01100111x
    [8, 576],
    [8, 576],
    // 01101000x
    [9, 832],
    // 011010010
    [9, 896],
    // 011010011
    [9, 960],
    // 011010100
    [9, 1024],
    // 011010101
    [9, 1088],
    // 011010110
    [9, 1152],
    // 011010111
    [9, 1216],
    // 011011000
    [9, 1280],
    // 011011001
    [9, 1344],
    // 011011010
    [9, 1408],
    // 011011011
    [7, 256],
    [7, 256],
    [7, 256],
    [7, 256],
    // 0110111xx
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    // 0111xxxxx
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 2],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    // 1000xxxxx
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    // 10010xxxx
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 128],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    // 10011xxxx
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 8],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    // 10100xxxx
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [5, 9],
    [6, 16],
    [6, 16],
    [6, 16],
    [6, 16],
    // 101010xxx
    [6, 16],
    [6, 16],
    [6, 16],
    [6, 16],
    [6, 17],
    [6, 17],
    [6, 17],
    [6, 17],
    // 101011xxx
    [6, 17],
    [6, 17],
    [6, 17],
    [6, 17],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    // 1011xxxxx
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    // 1100xxxxx
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    [6, 14],
    [6, 14],
    [6, 14],
    [6, 14],
    // 110100xxx
    [6, 14],
    [6, 14],
    [6, 14],
    [6, 14],
    [6, 15],
    [6, 15],
    [6, 15],
    [6, 15],
    // 110101xxx
    [6, 15],
    [6, 15],
    [6, 15],
    [6, 15],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    // 11011xxxx
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [5, 64],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    // 1110xxxxx
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    // 1111xxxxx
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7],
    [4, 7]
  ], ie = [
    [-1, -1],
    [-1, -1],
    // 000000000000x
    [12, -2],
    [12, -2],
    // 000000000001x
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000001xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000010xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000011xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000100xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000101xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000110xx
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 00000000111xx
    [11, 1792],
    [11, 1792],
    [11, 1792],
    [11, 1792],
    // 00000001000xx
    [12, 1984],
    [12, 1984],
    // 000000010010x
    [12, 2048],
    [12, 2048],
    // 000000010011x
    [12, 2112],
    [12, 2112],
    // 000000010100x
    [12, 2176],
    [12, 2176],
    // 000000010101x
    [12, 2240],
    [12, 2240],
    // 000000010110x
    [12, 2304],
    [12, 2304],
    // 000000010111x
    [11, 1856],
    [11, 1856],
    [11, 1856],
    [11, 1856],
    // 00000001100xx
    [11, 1920],
    [11, 1920],
    [11, 1920],
    [11, 1920],
    // 00000001101xx
    [12, 2368],
    [12, 2368],
    // 000000011100x
    [12, 2432],
    [12, 2432],
    // 000000011101x
    [12, 2496],
    [12, 2496],
    // 000000011110x
    [12, 2560],
    [12, 2560],
    // 000000011111x
    [10, 18],
    [10, 18],
    [10, 18],
    [10, 18],
    // 0000001000xxx
    [10, 18],
    [10, 18],
    [10, 18],
    [10, 18],
    [12, 52],
    [12, 52],
    // 000000100100x
    [13, 640],
    // 0000001001010
    [13, 704],
    // 0000001001011
    [13, 768],
    // 0000001001100
    [13, 832],
    // 0000001001101
    [12, 55],
    [12, 55],
    // 000000100111x
    [12, 56],
    [12, 56],
    // 000000101000x
    [13, 1280],
    // 0000001010010
    [13, 1344],
    // 0000001010011
    [13, 1408],
    // 0000001010100
    [13, 1472],
    // 0000001010101
    [12, 59],
    [12, 59],
    // 000000101011x
    [12, 60],
    [12, 60],
    // 000000101100x
    [13, 1536],
    // 0000001011010
    [13, 1600],
    // 0000001011011
    [11, 24],
    [11, 24],
    [11, 24],
    [11, 24],
    // 00000010111xx
    [11, 25],
    [11, 25],
    [11, 25],
    [11, 25],
    // 00000011000xx
    [13, 1664],
    // 0000001100100
    [13, 1728],
    // 0000001100101
    [12, 320],
    [12, 320],
    // 000000110011x
    [12, 384],
    [12, 384],
    // 000000110100x
    [12, 448],
    [12, 448],
    // 000000110101x
    [13, 512],
    // 0000001101100
    [13, 576],
    // 0000001101101
    [12, 53],
    [12, 53],
    // 000000110111x
    [12, 54],
    [12, 54],
    // 000000111000x
    [13, 896],
    // 0000001110010
    [13, 960],
    // 0000001110011
    [13, 1024],
    // 0000001110100
    [13, 1088],
    // 0000001110101
    [13, 1152],
    // 0000001110110
    [13, 1216],
    // 0000001110111
    [10, 64],
    [10, 64],
    [10, 64],
    [10, 64],
    // 0000001111xxx
    [10, 64],
    [10, 64],
    [10, 64],
    [10, 64]
  ], ae = [
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    // 00000100xxxx
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [8, 13],
    [11, 23],
    [11, 23],
    // 00000101000x
    [12, 50],
    // 000001010010
    [12, 51],
    // 000001010011
    [12, 44],
    // 000001010100
    [12, 45],
    // 000001010101
    [12, 46],
    // 000001010110
    [12, 47],
    // 000001010111
    [12, 57],
    // 000001011000
    [12, 58],
    // 000001011001
    [12, 61],
    // 000001011010
    [12, 256],
    // 000001011011
    [10, 16],
    [10, 16],
    [10, 16],
    [10, 16],
    // 0000010111xx
    [10, 17],
    [10, 17],
    [10, 17],
    [10, 17],
    // 0000011000xx
    [12, 48],
    // 000001100100
    [12, 49],
    // 000001100101
    [12, 62],
    // 000001100110
    [12, 63],
    // 000001100111
    [12, 30],
    // 000001101000
    [12, 31],
    // 000001101001
    [12, 32],
    // 000001101010
    [12, 33],
    // 000001101011
    [12, 40],
    // 000001101100
    [12, 41],
    // 000001101101
    [11, 22],
    [11, 22],
    // 00000110111x
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    // 00000111xxxx
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [8, 14],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    // 0000100xxxxx
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 10],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    // 0000101xxxxx
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [7, 11],
    [9, 15],
    [9, 15],
    [9, 15],
    [9, 15],
    // 000011000xxx
    [9, 15],
    [9, 15],
    [9, 15],
    [9, 15],
    [12, 128],
    // 000011001000
    [12, 192],
    // 000011001001
    [12, 26],
    // 000011001010
    [12, 27],
    // 000011001011
    [12, 28],
    // 000011001100
    [12, 29],
    // 000011001101
    [11, 19],
    [11, 19],
    // 00001100111x
    [11, 20],
    [11, 20],
    // 00001101000x
    [12, 34],
    // 000011010010
    [12, 35],
    // 000011010011
    [12, 36],
    // 000011010100
    [12, 37],
    // 000011010101
    [12, 38],
    // 000011010110
    [12, 39],
    // 000011010111
    [11, 21],
    [11, 21],
    // 00001101100x
    [12, 42],
    // 000011011010
    [12, 43],
    // 000011011011
    [10, 0],
    [10, 0],
    [10, 0],
    [10, 0],
    // 0000110111xx
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    // 0000111xxxxx
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12],
    [7, 12]
  ], de = [
    [-1, -1],
    [-1, -1],
    [-1, -1],
    [-1, -1],
    // 0000xx
    [6, 9],
    // 000100
    [6, 8],
    // 000101
    [5, 7],
    [5, 7],
    // 00011x
    [4, 6],
    [4, 6],
    [4, 6],
    [4, 6],
    // 0010xx
    [4, 5],
    [4, 5],
    [4, 5],
    [4, 5],
    // 0011xx
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    // 010xxx
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 1],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    // 011xxx
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    // 10xxxx
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    // 11xxxx
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2]
  ];
  function q(y, x = {}) {
    if (!y || typeof y.next != "function")
      throw new Error('CCITTFaxDecoder - invalid "source" parameter.');
    this.source = y, this.eof = !1, this.encoding = x.K || 0, this.eoline = x.EndOfLine || !1, this.byteAlign = x.EncodedByteAlign || !1, this.columns = x.Columns || 1728, this.rows = x.Rows || 0;
    let w = x.EndOfBlock;
    w == null && (w = !0), this.eoblock = w, this.black = x.BlackIs1 || !1, this.codingLine = new Uint32Array(this.columns + 1), this.refLine = new Uint32Array(this.columns + 2), this.codingLine[0] = this.columns, this.codingPos = 0, this.row = 0, this.nextLine2D = this.encoding < 0, this.inputBits = 0, this.inputBuf = 0, this.outputBits = 0, this.rowsDone = !1;
    let P;
    for (; (P = this._lookBits(12)) === 0; )
      this._eatBits(1);
    P === 1 && this._eatBits(12), this.encoding > 0 && (this.nextLine2D = !this._lookBits(1), this._eatBits(1));
  }
  return q.prototype = {
    readNextChar() {
      if (this.eof)
        return -1;
      const y = this.refLine, x = this.codingLine, w = this.columns;
      let P, R, W, J;
      if (this.outputBits === 0) {
        if (this.rowsDone && (this.eof = !0), this.eof)
          return -1;
        this.err = !1;
        let V, Ge, he;
        if (this.nextLine2D) {
          for (J = 0; x[J] < w; ++J)
            y[J] = x[J];
          for (y[J++] = w, y[J] = w, x[0] = 0, this.codingPos = 0, P = 0, R = 0; x[this.codingPos] < w; )
            switch (V = this._getTwoDimCode(), V) {
              case 0:
                this._addPixels(y[P + 1], R), y[P + 1] < w && (P += 2);
                break;
              case 1:
                if (V = Ge = 0, R) {
                  do
                    V += he = this._getBlackCode();
                  while (he >= 64);
                  do
                    Ge += he = this._getWhiteCode();
                  while (he >= 64);
                } else {
                  do
                    V += he = this._getWhiteCode();
                  while (he >= 64);
                  do
                    Ge += he = this._getBlackCode();
                  while (he >= 64);
                }
                for (this._addPixels(
                  x[this.codingPos] + V,
                  R
                ), x[this.codingPos] < w && this._addPixels(
                  x[this.codingPos] + Ge,
                  R ^ 1
                ); y[P] <= x[this.codingPos] && y[P] < w; )
                  P += 2;
                break;
              case 7:
                if (this._addPixels(y[P] + 3, R), R ^= 1, x[this.codingPos] < w)
                  for (++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case 5:
                if (this._addPixels(y[P] + 2, R), R ^= 1, x[this.codingPos] < w)
                  for (++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case 3:
                if (this._addPixels(y[P] + 1, R), R ^= 1, x[this.codingPos] < w)
                  for (++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case 2:
                if (this._addPixels(y[P], R), R ^= 1, x[this.codingPos] < w)
                  for (++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case 8:
                if (this._addPixelsNeg(y[P] - 3, R), R ^= 1, x[this.codingPos] < w)
                  for (P > 0 ? --P : ++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case 6:
                if (this._addPixelsNeg(y[P] - 2, R), R ^= 1, x[this.codingPos] < w)
                  for (P > 0 ? --P : ++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case 4:
                if (this._addPixelsNeg(y[P] - 1, R), R ^= 1, x[this.codingPos] < w)
                  for (P > 0 ? --P : ++P; y[P] <= x[this.codingPos] && y[P] < w; )
                    P += 2;
                break;
              case -1:
                this._addPixels(w, 0), this.eof = !0;
                break;
              default:
                this._addPixels(w, 0), this.err = !0;
            }
        } else
          for (x[0] = 0, this.codingPos = 0, R = 0; x[this.codingPos] < w; ) {
            if (V = 0, R)
              do
                V += he = this._getBlackCode();
              while (he >= 64);
            else
              do
                V += he = this._getWhiteCode();
              while (he >= 64);
            this._addPixels(x[this.codingPos] + V, R), R ^= 1;
          }
        let De = !1;
        if (this.byteAlign && (this.inputBits &= -8), !this.eoblock && this.row === this.rows - 1)
          this.rowsDone = !0;
        else {
          if (V = this._lookBits(12), this.eoline)
            for (; V !== -1 && V !== 1; )
              this._eatBits(1), V = this._lookBits(12);
          else
            for (; V === 0; )
              this._eatBits(1), V = this._lookBits(12);
          V === 1 ? (this._eatBits(12), De = !0) : V === -1 && (this.eof = !0);
        }
        if (!this.eof && this.encoding > 0 && !this.rowsDone && (this.nextLine2D = !this._lookBits(1), this._eatBits(1)), this.eoblock && De && this.byteAlign) {
          if (V = this._lookBits(12), V === 1) {
            if (this._eatBits(12), this.encoding > 0 && (this._lookBits(1), this._eatBits(1)), this.encoding >= 0)
              for (J = 0; J < 4; ++J)
                V = this._lookBits(12), this._eatBits(12), this.encoding > 0 && (this._lookBits(1), this._eatBits(1));
            this.eof = !0;
          }
        } else if (this.err && this.eoline) {
          for (; ; ) {
            if (V = this._lookBits(13), V === -1)
              return this.eof = !0, -1;
            if (V >> 1 === 1)
              break;
            this._eatBits(1);
          }
          this._eatBits(12), this.encoding > 0 && (this._eatBits(1), this.nextLine2D = !(V & 1));
        }
        x[0] > 0 ? this.outputBits = x[this.codingPos = 0] : this.outputBits = x[this.codingPos = 1], this.row++;
      }
      let me;
      if (this.outputBits >= 8)
        me = this.codingPos & 1 ? 0 : 255, this.outputBits -= 8, this.outputBits === 0 && x[this.codingPos] < w && (this.codingPos++, this.outputBits = x[this.codingPos] - x[this.codingPos - 1]);
      else {
        W = 8, me = 0;
        do
          this.outputBits > W ? (me <<= W, this.codingPos & 1 || (me |= 255 >> 8 - W), this.outputBits -= W, W = 0) : (me <<= this.outputBits, this.codingPos & 1 || (me |= 255 >> 8 - this.outputBits), W -= this.outputBits, this.outputBits = 0, x[this.codingPos] < w ? (this.codingPos++, this.outputBits = x[this.codingPos] - x[this.codingPos - 1]) : W > 0 && (me <<= W, W = 0));
        while (W);
      }
      return this.black && (me ^= 255), me;
    },
    /**
     * @private
     */
    _addPixels(y, x) {
      const w = this.codingLine;
      let P = this.codingPos;
      y > w[P] && (y > this.columns && (this.err = !0, y = this.columns), P & 1 ^ x && ++P, w[P] = y), this.codingPos = P;
    },
    /**
     * @private
     */
    _addPixelsNeg(y, x) {
      const w = this.codingLine;
      let P = this.codingPos;
      if (y > w[P])
        y > this.columns && (this.err = !0, y = this.columns), P & 1 ^ x && ++P, w[P] = y;
      else if (y < w[P]) {
        for (y < 0 && (this.err = !0, y = 0); P > 0 && y < w[P - 1]; )
          --P;
        w[P] = y;
      }
      this.codingPos = P;
    },
    /**
     * This function returns the code found from the table.
     * The start and end parameters set the boundaries for searching the table.
     * The limit parameter is optional. Function returns an array with three
     * values. The first array element indicates whether a valid code is being
     * returned. The second array element is the actual code. The third array
     * element indicates whether EOF was reached.
     * @private
     */
    _findTableCode(y, x, w, P) {
      const R = P || 0;
      for (let W = y; W <= x; ++W) {
        let J = this._lookBits(W);
        if (J === -1)
          return [!0, 1, !1];
        if (W < x && (J <<= x - W), !R || J >= R) {
          const me = w[J - R];
          if (me[0] === W)
            return this._eatBits(W), [!0, me[1], !0];
        }
      }
      return [!1, 0, !1];
    },
    /**
     * @private
     */
    _getTwoDimCode() {
      let y = 0, x;
      if (this.eoblock) {
        if (y = this._lookBits(7), x = B[y], x && x[0] > 0)
          return this._eatBits(x[0]), x[1];
      } else {
        const w = this._findTableCode(1, 7, B);
        if (w[0] && w[2])
          return w[1];
      }
      return -1;
    },
    /**
     * @private
     */
    _getWhiteCode() {
      let y = 0, x;
      if (this.eoblock) {
        if (y = this._lookBits(12), y === -1)
          return 1;
        if (y >> 5 === 0 ? x = O[y] : x = G[y >> 3], x[0] > 0)
          return this._eatBits(x[0]), x[1];
      } else {
        let w = this._findTableCode(1, 9, G);
        if (w[0] || (w = this._findTableCode(11, 12, O), w[0]))
          return w[1];
      }
      return this._eatBits(1), 1;
    },
    /**
     * @private
     */
    _getBlackCode() {
      let y, x;
      if (this.eoblock) {
        if (y = this._lookBits(13), y === -1)
          return 1;
        if (y >> 7 === 0 ? x = ie[y] : y >> 9 === 0 && y >> 7 !== 0 ? x = ae[(y >> 1) - 64] : x = de[y >> 7], x[0] > 0)
          return this._eatBits(x[0]), x[1];
      } else {
        let w = this._findTableCode(2, 6, de);
        if (w[0] || (w = this._findTableCode(7, 12, ae, 64), w[0]) || (w = this._findTableCode(10, 13, ie), w[0]))
          return w[1];
      }
      return this._eatBits(1), 1;
    },
    /**
     * @private
     */
    _lookBits(y) {
      let x;
      for (; this.inputBits < y; ) {
        if ((x = this.source.next()) === -1)
          return this.inputBits === 0 ? -1 : this.inputBuf << y - this.inputBits & 65535 >> 16 - y;
        this.inputBuf = this.inputBuf << 8 | x, this.inputBits += 8;
      }
      return this.inputBuf >> this.inputBits - y & 65535 >> 16 - y;
    },
    /**
     * @private
     */
    _eatBits(y) {
      (this.inputBits -= y) < 0 && (this.inputBits = 0);
    }
  }, q;
})();
class Q extends Ct {
  constructor(t) {
    super(`JBIG2 error: ${t}`);
  }
}
var At = (function() {
  function t() {
  }
  t.prototype = {
    getContexts(n) {
      return n in this ? this[n] : this[n] = new Int8Array(65536);
    }
  };
  function i(n, p, d) {
    this.data = n, this.start = p, this.end = d;
  }
  i.prototype = {
    get decoder() {
      var n = new bt(this.data, this.start, this.end);
      return C1(this, "decoder", n);
    },
    get contextCache() {
      var n = new t();
      return C1(this, "contextCache", n);
    }
  };
  function r(n, p, d) {
    var u = n.getContexts(p), l = 1;
    function h(D) {
      for (var b = 0, T = 0; T < D; T++) {
        var E = d.readBit(u, l);
        l = l < 256 ? l << 1 | E : (l << 1 | E) & 511 | 256, b = b << 1 | E;
      }
      return b >>> 0;
    }
    var g = h(1), A = h(1) ? h(1) ? h(1) ? h(1) ? h(1) ? h(32) + 4436 : h(12) + 340 : h(8) + 84 : h(6) + 20 : h(4) + 4 : h(2);
    return g === 0 ? A : A > 0 ? -A : null;
  }
  function c(n, p, d) {
    for (var u = n.getContexts("IAID"), l = 1, h = 0; h < d; h++) {
      var g = p.readBit(u, l);
      l = l << 1 | g;
    }
    return d < 31 ? l & (1 << d) - 1 : l & 2147483647;
  }
  var o = [
    "SymbolDictionary",
    null,
    null,
    null,
    "IntermediateTextRegion",
    null,
    "ImmediateTextRegion",
    "ImmediateLosslessTextRegion",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "PatternDictionary",
    null,
    null,
    null,
    "IntermediateHalftoneRegion",
    null,
    "ImmediateHalftoneRegion",
    "ImmediateLosslessHalftoneRegion",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "IntermediateGenericRegion",
    null,
    "ImmediateGenericRegion",
    "ImmediateLosslessGenericRegion",
    "IntermediateGenericRefinementRegion",
    null,
    "ImmediateGenericRefinementRegion",
    "ImmediateLosslessGenericRefinementRegion",
    null,
    null,
    null,
    null,
    "PageInformation",
    "EndOfPage",
    "EndOfStripe",
    "EndOfFile",
    "Profiles",
    "Tables",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "Extension"
  ], s = [
    [
      { x: -1, y: -2 },
      { x: 0, y: -2 },
      { x: 1, y: -2 },
      { x: -2, y: -1 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: 2, y: -1 },
      { x: -4, y: 0 },
      { x: -3, y: 0 },
      { x: -2, y: 0 },
      { x: -1, y: 0 }
    ],
    [
      { x: -1, y: -2 },
      { x: 0, y: -2 },
      { x: 1, y: -2 },
      { x: 2, y: -2 },
      { x: -2, y: -1 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: 2, y: -1 },
      { x: -3, y: 0 },
      { x: -2, y: 0 },
      { x: -1, y: 0 }
    ],
    [
      { x: -1, y: -2 },
      { x: 0, y: -2 },
      { x: 1, y: -2 },
      { x: -2, y: -1 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -2, y: 0 },
      { x: -1, y: 0 }
    ],
    [
      { x: -3, y: -1 },
      { x: -2, y: -1 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -4, y: 0 },
      { x: -3, y: 0 },
      { x: -2, y: 0 },
      { x: -1, y: 0 }
    ]
  ], a = [
    {
      coding: [
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: -1, y: 0 }
      ],
      reference: [
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
      ]
    },
    {
      coding: [
        { x: -1, y: -1 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: -1, y: 0 }
      ],
      reference: [
        { x: 0, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
      ]
    }
  ], m = [
    39717,
    // 10011 0110010 0101
    1941,
    // 0011 110010 101
    229,
    // 001 11001 01
    405
    // 011001 0101
  ];
  function S(n, p, d) {
    var u = d.decoder, l = d.contextCache.getContexts("GB"), h, g, A, D, b, T, E, C = [], I = 31735;
    for (g = 0; g < p; g++)
      for (b = C[g] = new Uint8Array(n), T = g < 1 ? b : C[g - 1], E = g < 2 ? b : C[g - 2], h = E[0] << 13 | E[1] << 12 | E[2] << 11 | T[0] << 7 | T[1] << 6 | T[2] << 5 | T[3] << 4, A = 0; A < n; A++)
        b[A] = D = u.readBit(l, h), h = (h & I) << 1 | (A + 3 < n ? E[A + 3] << 11 : 0) | (A + 4 < n ? T[A + 4] << 4 : 0) | D;
    return C;
  }
  function f(n, p, d, u, l, h, g, A) {
    if (n) {
      const Ce = new Le(
        A.data,
        A.start,
        A.end
      );
      return i1(Ce, p, d, !1);
    }
    if (u === 0 && !l && g.length === 4 && g[0].x === 3 && g[0].y === -1 && g[1].x === -3 && g[1].y === -1 && g[2].x === 2 && g[2].y === -2 && g[3].x === -2 && g[3].y === -2)
      return S(p, d, A);
    var D = s[u].concat(g);
    D.sort(function(Ce, z) {
      return Ce.y - z.y || Ce.x - z.x;
    });
    var b = D.length, T = new Int8Array(b), E = new Int8Array(b), C = [], I = 0, v = 0, k = 0, F = 0, K, M;
    for (M = 0; M < b; M++)
      T[M] = D[M].x, E[M] = D[M].y, v = Math.min(v, D[M].x), k = Math.max(k, D[M].x), F = Math.min(F, D[M].y), M < b - 1 && D[M].y === D[M + 1].y && D[M].x === D[M + 1].x - 1 ? I |= 1 << b - 1 - M : C.push(M);
    var U = C.length, H = new Int8Array(U), _ = new Int8Array(U), j = new Uint16Array(U);
    for (K = 0; K < U; K++)
      M = C[K], H[K] = D[M].x, _[K] = D[M].y, j[K] = 1 << b - 1 - M;
    for (var L = -v, re = -F, le = p - k, fe = m[u], te = new Uint8Array(p), Y = [], se = A.decoder, Ie = A.contextCache.getContexts("GB"), Ee = 0, ce, pe, Z, $ = 0, oe, ye, ge = 0; ge < d; ge++) {
      if (l) {
        var Ae = se.readBit(Ie, fe);
        if (Ee ^= Ae, Ee) {
          Y.push(te);
          continue;
        }
      }
      for (te = new Uint8Array(te), Y.push(te), ce = 0; ce < p; ce++) {
        if (ce >= L && ce < le && ge >= re)
          for ($ = $ << 1 & I, M = 0; M < U; M++)
            pe = ge + _[M], Z = ce + H[M], oe = Y[pe][Z], oe && (oe = j[M], $ |= oe);
        else
          for ($ = 0, ye = b - 1, M = 0; M < b; M++, ye--)
            Z = ce + T[M], Z >= 0 && Z < p && (pe = ge + E[M], pe >= 0 && (oe = Y[pe][Z], oe && ($ |= oe << ye)));
        var we = se.readBit(Ie, $);
        te[ce] = we;
      }
    }
    return Y;
  }
  function N(n, p, d, u, l, h, g, A, D) {
    var b = a[d].coding;
    d === 0 && (b = b.concat([A[0]]));
    var T = b.length, E = new Int32Array(T), C = new Int32Array(T), I;
    for (I = 0; I < T; I++)
      E[I] = b[I].x, C[I] = b[I].y;
    var v = a[d].reference;
    d === 0 && (v = v.concat([A[1]]));
    var k = v.length, F = new Int32Array(k), K = new Int32Array(k);
    for (I = 0; I < k; I++)
      F[I] = v[I].x, K[I] = v[I].y;
    for (var M = u[0].length, U = u.length, H = [], _ = D.decoder, j = D.contextCache.getContexts("GR"), L = 0; L < p; L++) {
      var re = new Uint8Array(n);
      H.push(re);
      for (var le = 0; le < n; le++) {
        var fe, te, Y = 0;
        for (I = 0; I < T; I++)
          fe = L + C[I], te = le + E[I], fe < 0 || te < 0 || te >= n ? Y <<= 1 : Y = Y << 1 | H[fe][te];
        for (I = 0; I < k; I++)
          fe = L + K[I] - h, te = le + F[I] - l, fe < 0 || fe >= U || te < 0 || te >= M ? Y <<= 1 : Y = Y << 1 | u[fe][te];
        var se = _.readBit(j, Y);
        re[le] = se;
      }
    }
    return H;
  }
  function B(n, p, d, u, l, h, g, A, D, b, T, E) {
    if (n && p)
      throw new Q("symbol refinement with Huffman is not supported");
    var C = [], I = 0, v = r1(d.length + u), k = T.decoder, F = T.contextCache;
    let K, M;
    for (n && (K = De(1), M = [], v = Math.max(v, 1)); C.length < u; ) {
      var U = n ? h.tableDeltaHeight.decode(E) : r(F, "IADH", k);
      I += U;
      let $ = 0, oe = 0;
      const ye = n ? M.length : 0;
      for (; ; ) {
        var H = n ? h.tableDeltaWidth.decode(E) : r(F, "IADW", k);
        if (H === null)
          break;
        $ += H, oe += $;
        var _;
        if (p) {
          var j = r(F, "IAAI", k);
          if (j > 1)
            _ = O(
              n,
              p,
              $,
              I,
              0,
              j,
              1,
              // strip size
              d.concat(C),
              v,
              0,
              // transposed
              0,
              // ds offset
              1,
              // top left 7.4.3.1.1
              0,
              // OR operator
              h,
              D,
              b,
              T,
              0,
              E
            );
          else {
            var L = c(F, k, v), re = r(F, "IARDX", k), le = r(F, "IARDY", k), fe = L < d.length ? d[L] : C[L - d.length];
            _ = N(
              $,
              I,
              D,
              fe,
              re,
              le,
              !1,
              b,
              T
            );
          }
          C.push(_);
        } else n ? M.push($) : (_ = f(
          !1,
          $,
          I,
          g,
          !1,
          null,
          A,
          T
        ), C.push(_));
      }
      if (n && !p) {
        const ge = h.tableBitmapSize.decode(E);
        E.byteAlign();
        let Ae;
        if (ge === 0)
          Ae = H1(
            E,
            oe,
            I
          );
        else {
          const Ce = E.end, z = E.position + ge;
          E.end = z, Ae = i1(
            E,
            oe,
            I,
            !1
          ), E.end = Ce, E.position = z;
        }
        const we = M.length;
        if (ye === we - 1)
          C.push(Ae);
        else {
          let Ce, z, ne = 0, Pe, $e, Ve;
          for (Ce = ye; Ce < we; Ce++) {
            for ($e = M[Ce], Pe = ne + $e, Ve = [], z = 0; z < I; z++)
              Ve.push(Ae[z].subarray(ne, Pe));
            C.push(Ve), ne = Pe;
          }
        }
      }
    }
    for (var te = [], Y = [], se = !1, Ie = d.length + u; Y.length < Ie; ) {
      for (var Ee = n ? K.decode(E) : r(F, "IAEX", k); Ee--; )
        Y.push(se);
      se = !se;
    }
    for (var ce = 0, pe = d.length; ce < pe; ce++)
      Y[ce] && te.push(d[ce]);
    for (var Z = 0; Z < u; ce++, Z++)
      Y[ce] && te.push(C[Z]);
    return te;
  }
  function O(n, p, d, u, l, h, g, A, D, b, T, E, C, I, v, k, F, K, M) {
    if (n && p)
      throw new Q("refinement with Huffman is not supported");
    var U = [], H, _;
    for (H = 0; H < u; H++) {
      if (_ = new Uint8Array(d), l)
        for (var j = 0; j < d; j++)
          _[j] = l;
      U.push(_);
    }
    var L = F.decoder, re = F.contextCache, le = n ? -I.tableDeltaT.decode(M) : -r(re, "IADT", L), fe = 0;
    for (H = 0; H < h; ) {
      var te = n ? I.tableDeltaT.decode(M) : r(re, "IADT", L);
      le += te;
      var Y = n ? I.tableFirstS.decode(M) : r(re, "IAFS", L);
      fe += Y;
      var se = fe;
      do {
        let m1 = 0;
        g > 1 && (m1 = n ? M.readBits(K) : r(re, "IAIT", L));
        var Ie = g * le + m1, Ee = n ? I.symbolIDTable.decode(M) : c(re, L, D), ce = p && (n ? M.readBit() : r(re, "IARI", L)), pe = A[Ee], Z = pe[0].length, $ = pe.length;
        if (ce) {
          var oe = r(re, "IARDW", L), ye = r(re, "IARDH", L), ge = r(re, "IARDX", L), Ae = r(re, "IARDY", L);
          Z += oe, $ += ye, pe = N(
            Z,
            $,
            v,
            pe,
            (oe >> 1) + ge,
            (ye >> 1) + Ae,
            !1,
            k,
            F
          );
        }
        var we = Ie - (E & 1 ? 0 : $ - 1), Ce = se - (E & 2 ? Z - 1 : 0), z, ne, Pe;
        if (b) {
          for (z = 0; z < $; z++)
            if (_ = U[Ce + z], !!_) {
              Pe = pe[z];
              var $e = Math.min(d - we, Z);
              switch (C) {
                case 0:
                  for (ne = 0; ne < $e; ne++)
                    _[we + ne] |= Pe[ne];
                  break;
                case 2:
                  for (ne = 0; ne < $e; ne++)
                    _[we + ne] ^= Pe[ne];
                  break;
                default:
                  throw new Q(
                    `operator ${C} is not supported`
                  );
              }
            }
          se += $ - 1;
        } else {
          for (ne = 0; ne < $; ne++)
            if (_ = U[we + ne], !!_)
              switch (Pe = pe[ne], C) {
                case 0:
                  for (z = 0; z < Z; z++)
                    _[Ce + z] |= Pe[z];
                  break;
                case 2:
                  for (z = 0; z < Z; z++)
                    _[Ce + z] ^= Pe[z];
                  break;
                default:
                  throw new Q(
                    `operator ${C} is not supported`
                  );
              }
          se += Z - 1;
        }
        H++;
        var Ve = n ? I.tableDeltaS.decode(M) : r(re, "IADS", L);
        if (Ve === null)
          break;
        se += Ve + T;
      } while (!0);
    }
    return U;
  }
  function G(n, p, d, u, l, h) {
    const g = [];
    n || (g.push({
      x: -p,
      y: 0
    }), l === 0 && (g.push({
      x: -3,
      y: -1
    }), g.push({
      x: 2,
      y: -2
    }), g.push({
      x: -2,
      y: -2
    })));
    const A = (u + 1) * p, D = f(
      n,
      A,
      d,
      l,
      !1,
      null,
      g,
      h
    ), b = [];
    for (let T = 0; T <= u; T++) {
      const E = [], C = p * T, I = C + p;
      for (let v = 0; v < d; v++)
        E.push(D[v].subarray(C, I));
      b.push(E);
    }
    return b;
  }
  function ie(n, p, d, u, l, h, g, A, D, b, T, E, C, I, v) {
    if (g)
      throw new Q("skip is not supported");
    if (A !== 0)
      throw new Q(
        "operator " + A + " is not supported in halftone region"
      );
    const F = [];
    let K, M, U;
    for (K = 0; K < l; K++) {
      if (U = new Uint8Array(u), h)
        for (M = 0; M < u; M++)
          U[M] = h;
      F.push(U);
    }
    const H = p.length, _ = p[0], j = _[0].length, L = _.length, re = r1(H), le = [];
    n || (le.push({
      x: d <= 1 ? 3 : 2,
      y: -1
    }), d === 0 && (le.push({
      x: -3,
      y: -1
    }), le.push({
      x: 2,
      y: -2
    }), le.push({
      x: -2,
      y: -2
    })));
    const fe = [];
    let te, Y;
    for (n && (te = new Le(
      v.data,
      v.start,
      v.end
    )), K = re - 1; K >= 0; K--)
      n ? Y = i1(te, D, b, !0) : Y = f(
        !1,
        D,
        b,
        d,
        !1,
        null,
        le,
        v
      ), fe[K] = Y;
    let se, Ie, Ee, ce, pe, Z, $, oe, ye;
    for (se = 0; se < b; se++)
      for (Ie = 0; Ie < D; Ie++) {
        for (Ee = 0, ce = 0, M = re - 1; M >= 0; M--)
          Ee = fe[M][se][Ie] ^ Ee, ce |= Ee << M;
        if (pe = p[ce], Z = T + se * I + Ie * C >> 8, $ = E + se * C - Ie * I >> 8, Z >= 0 && Z + j <= u && $ >= 0 && $ + L <= l)
          for (K = 0; K < L; K++)
            for (ye = F[$ + K], oe = pe[K], M = 0; M < j; M++)
              ye[Z + M] |= oe[M];
        else {
          let ge, Ae;
          for (K = 0; K < L; K++)
            if (Ae = $ + K, !(Ae < 0 || Ae >= l))
              for (ye = F[Ae], oe = pe[K], M = 0; M < j; M++)
                ge = Z + M, ge >= 0 && ge < u && (ye[ge] |= oe[M]);
        }
      }
    return F;
  }
  function ae(n, p) {
    var d = {};
    d.number = ee(n, p);
    var u = n[p + 4], l = u & 63;
    if (!o[l])
      throw new Q("invalid segment type: " + l);
    d.type = l, d.typeName = o[l], d.deferredNonRetain = !!(u & 128);
    var h = !!(u & 64), g = n[p + 5], A = g >> 5 & 7, D = [g & 31], b = p + 6;
    if (g === 7) {
      A = ee(n, b - 1) & 536870911, b += 3;
      var T = A + 7 >> 3;
      for (D[0] = n[b++]; --T > 0; )
        D.push(n[b++]);
    } else if (g === 5 || g === 6)
      throw new Q("invalid referred-to flags");
    d.retainBits = D;
    let E = 4;
    d.number <= 256 ? E = 1 : d.number <= 65536 && (E = 2);
    var C = [], I, v;
    for (I = 0; I < A; I++) {
      let _;
      E === 1 ? _ = n[b] : E === 2 ? _ = Oe(n, b) : _ = ee(n, b), C.push(_), b += E;
    }
    if (d.referredTo = C, h ? (d.pageAssociation = ee(n, b), b += 4) : d.pageAssociation = n[b++], d.length = ee(n, b), b += 4, d.length === 4294967295)
      if (l === 38) {
        var k = q(n, b), F = n[b + y], K = !!(F & 1), M = 6, U = new Uint8Array(M);
        for (K || (U[0] = 255, U[1] = 172), U[2] = k.height >>> 24 & 255, U[3] = k.height >> 16 & 255, U[4] = k.height >> 8 & 255, U[5] = k.height & 255, I = b, v = n.length; I < v; I++) {
          for (var H = 0; H < M && U[H] === n[I + H]; )
            H++;
          if (H === M) {
            d.length = I + M;
            break;
          }
        }
        if (d.length === 4294967295)
          throw new Q("segment end was not found");
      } else
        throw new Q("invalid unknown segment length");
    return d.headerEnd = b, d;
  }
  function de(n, p, d, u) {
    for (var l = [], h = d; h < u; ) {
      var g = ae(p, h);
      h = g.headerEnd;
      var A = {
        header: g,
        data: p
      };
      if (n.randomAccess || (A.start = h, h += g.length, A.end = h), l.push(A), g.type === 51)
        break;
    }
    if (n.randomAccess)
      for (var D = 0, b = l.length; D < b; D++)
        l[D].start = h, h += l[D].header.length, l[D].end = h;
    return l;
  }
  function q(n, p) {
    return {
      width: ee(n, p),
      height: ee(n, p + 4),
      x: ee(n, p + 8),
      y: ee(n, p + 12),
      combinationOperator: n[p + 16] & 7
    };
  }
  var y = 17;
  function x(n, p) {
    var d = n.header, u = n.data, l = n.start, h = n.end, g, A, D, b;
    switch (d.type) {
      case 0:
        var T = {}, E = Oe(u, l);
        if (T.huffman = !!(E & 1), T.refinement = !!(E & 2), T.huffmanDHSelector = E >> 2 & 3, T.huffmanDWSelector = E >> 4 & 3, T.bitmapSizeSelector = E >> 6 & 1, T.aggregationInstancesSelector = E >> 7 & 1, T.bitmapCodingContextUsed = !!(E & 256), T.bitmapCodingContextRetained = !!(E & 512), T.template = E >> 10 & 3, T.refinementTemplate = E >> 12 & 1, l += 2, !T.huffman) {
          for (b = T.template === 0 ? 4 : 1, A = [], D = 0; D < b; D++)
            A.push({
              x: Ke(u, l),
              y: Ke(u, l + 1)
            }), l += 2;
          T.at = A;
        }
        if (T.refinement && !T.refinementTemplate) {
          for (A = [], D = 0; D < 2; D++)
            A.push({
              x: Ke(u, l),
              y: Ke(u, l + 1)
            }), l += 2;
          T.refinementAt = A;
        }
        T.numberOfExportedSymbols = ee(u, l), l += 4, T.numberOfNewSymbols = ee(u, l), l += 4, g = [
          T,
          d.number,
          d.referredTo,
          u,
          l,
          h
        ];
        break;
      case 6:
      // ImmediateTextRegion
      case 7:
        var C = {};
        C.info = q(u, l), l += y;
        var I = Oe(u, l);
        if (l += 2, C.huffman = !!(I & 1), C.refinement = !!(I & 2), C.logStripSize = I >> 2 & 3, C.stripSize = 1 << C.logStripSize, C.referenceCorner = I >> 4 & 3, C.transposed = !!(I & 64), C.combinationOperator = I >> 7 & 3, C.defaultPixelValue = I >> 9 & 1, C.dsOffset = I << 17 >> 27, C.refinementTemplate = I >> 15 & 1, C.huffman) {
          var v = Oe(u, l);
          l += 2, C.huffmanFS = v & 3, C.huffmanDS = v >> 2 & 3, C.huffmanDT = v >> 4 & 3, C.huffmanRefinementDW = v >> 6 & 3, C.huffmanRefinementDH = v >> 8 & 3, C.huffmanRefinementDX = v >> 10 & 3, C.huffmanRefinementDY = v >> 12 & 3, C.huffmanRefinementSizeSelector = !!(v & 16384);
        }
        if (C.refinement && !C.refinementTemplate) {
          for (A = [], D = 0; D < 2; D++)
            A.push({
              x: Ke(u, l),
              y: Ke(u, l + 1)
            }), l += 2;
          C.refinementAt = A;
        }
        C.numberOfSymbolInstances = ee(u, l), l += 4, g = [C, d.referredTo, u, l, h];
        break;
      case 16:
        const H = {}, _ = u[l++];
        H.mmr = !!(_ & 1), H.template = _ >> 1 & 3, H.patternWidth = u[l++], H.patternHeight = u[l++], H.maxPatternIndex = ee(u, l), l += 4, g = [H, d.number, u, l, h];
        break;
      case 22:
      // ImmediateHalftoneRegion
      case 23:
        const j = {};
        j.info = q(u, l), l += y;
        const L = u[l++];
        j.mmr = !!(L & 1), j.template = L >> 1 & 3, j.enableSkip = !!(L & 8), j.combinationOperator = L >> 4 & 7, j.defaultPixelValue = L >> 7 & 1, j.gridWidth = ee(u, l), l += 4, j.gridHeight = ee(u, l), l += 4, j.gridOffsetX = ee(u, l) & 4294967295, l += 4, j.gridOffsetY = ee(u, l) & 4294967295, l += 4, j.gridVectorX = Oe(u, l), l += 2, j.gridVectorY = Oe(u, l), l += 2, g = [j, d.referredTo, u, l, h];
        break;
      case 38:
      // ImmediateGenericRegion
      case 39:
        var k = {};
        k.info = q(u, l), l += y;
        var F = u[l++];
        if (k.mmr = !!(F & 1), k.template = F >> 1 & 3, k.prediction = !!(F & 8), !k.mmr) {
          for (b = k.template === 0 ? 4 : 1, A = [], D = 0; D < b; D++)
            A.push({
              x: Ke(u, l),
              y: Ke(u, l + 1)
            }), l += 2;
          k.at = A;
        }
        g = [k, u, l, h];
        break;
      case 48:
        var K = {
          width: ee(u, l),
          height: ee(u, l + 4),
          resolutionX: ee(u, l + 8),
          resolutionY: ee(u, l + 12)
        };
        K.height === 4294967295 && delete K.height;
        var M = u[l + 16];
        Oe(u, l + 17), K.lossless = !!(M & 1), K.refinement = !!(M & 2), K.defaultPixelValue = M >> 2 & 1, K.combinationOperator = M >> 3 & 3, K.requiresBuffer = !!(M & 32), K.combinationOperatorOverride = !!(M & 64), g = [K];
        break;
      case 49:
        break;
      case 50:
        break;
      case 51:
        break;
      case 53:
        g = [d.number, u, l, h];
        break;
      case 62:
        break;
      default:
        throw new Q(
          `segment type ${d.typeName}(${d.type}) is not implemented`
        );
    }
    var U = "on" + d.typeName;
    U in p && p[U].apply(p, g);
  }
  function w(n, p) {
    for (var d = 0, u = n.length; d < u; d++)
      x(n[d], p);
  }
  function P(n) {
    for (var p = new W(), d = 0, u = n.length; d < u; d++) {
      var l = n[d], h = de({}, l.data, l.start, l.end);
      w(h, p);
    }
    return p.buffer;
  }
  function R(n) {
    const p = n.length;
    let d = 0;
    if (n[d] !== 151 || n[d + 1] !== 74 || n[d + 2] !== 66 || n[d + 3] !== 50 || n[d + 4] !== 13 || n[d + 5] !== 10 || n[d + 6] !== 26 || n[d + 7] !== 10)
      throw new Q("parseJbig2 - invalid header.");
    const u = /* @__PURE__ */ Object.create(null);
    d += 8;
    const l = n[d++];
    u.randomAccess = !(l & 1), l & 2 || (u.numberOfPages = ee(n, d), d += 4);
    const h = de(u, n, d, p), g = new W();
    w(h, g);
    const { width: A, height: D } = g.currentPageInfo, b = g.buffer, T = new Uint8ClampedArray(A * D);
    let E = 0, C = 0;
    for (let I = 0; I < D; I++) {
      let v = 0, k;
      for (let F = 0; F < A; F++)
        v || (v = 128, k = b[C++]), T[E++] = k & v ? 0 : 255, v >>= 1;
    }
    return { imgData: T, width: A, height: D };
  }
  function W() {
  }
  W.prototype = {
    onPageInformation: function(p) {
      this.currentPageInfo = p;
      var d = p.width + 7 >> 3, u = new Uint8ClampedArray(d * p.height);
      if (p.defaultPixelValue)
        for (var l = 0, h = u.length; l < h; l++)
          u[l] = 255;
      this.buffer = u;
    },
    drawBitmap: function(p, d) {
      var u = this.currentPageInfo, l = p.width, h = p.height, g = u.width + 7 >> 3, A = u.combinationOperatorOverride ? p.combinationOperator : u.combinationOperator, D = this.buffer, b = 128 >> (p.x & 7), T = p.y * g + (p.x >> 3), E, C, I, v;
      switch (A) {
        case 0:
          for (E = 0; E < h; E++) {
            for (I = b, v = T, C = 0; C < l; C++)
              d[E][C] && (D[v] |= I), I >>= 1, I || (I = 128, v++);
            T += g;
          }
          break;
        case 2:
          for (E = 0; E < h; E++) {
            for (I = b, v = T, C = 0; C < l; C++)
              d[E][C] && (D[v] ^= I), I >>= 1, I || (I = 128, v++);
            T += g;
          }
          break;
        default:
          throw new Q(
            `operator ${A} is not supported`
          );
      }
    },
    onImmediateGenericRegion: function(p, d, u, l) {
      var h = p.info, g = new i(d, u, l), A = f(
        p.mmr,
        h.width,
        h.height,
        p.template,
        p.prediction,
        null,
        p.at,
        g
      );
      this.drawBitmap(h, A);
    },
    onImmediateLosslessGenericRegion: function() {
      this.onImmediateGenericRegion.apply(this, arguments);
    },
    onSymbolDictionary: function(p, d, u, l, h, g) {
      let A, D;
      p.huffman && (A = V1(
        p,
        u,
        this.customTables
      ), D = new Le(l, h, g));
      var b = this.symbols;
      b || (this.symbols = b = {});
      for (var T = [], E = 0, C = u.length; E < C; E++) {
        const v = b[u[E]];
        v && (T = T.concat(v));
      }
      var I = new i(l, h, g);
      b[d] = B(
        p.huffman,
        p.refinement,
        T,
        p.numberOfNewSymbols,
        p.numberOfExportedSymbols,
        A,
        p.template,
        p.at,
        p.refinementTemplate,
        p.refinementAt,
        I,
        D
      );
    },
    onImmediateTextRegion: function(p, d, u, l, h) {
      var g = p.info;
      let A, D;
      for (var b = this.symbols, T = [], E = 0, C = d.length; E < C; E++) {
        const F = b[d[E]];
        F && (T = T.concat(F));
      }
      var I = r1(T.length);
      p.huffman && (D = new Le(u, l, h), A = L1(
        p,
        d,
        this.customTables,
        T.length,
        D
      ));
      var v = new i(u, l, h), k = O(
        p.huffman,
        p.refinement,
        g.width,
        g.height,
        p.defaultPixelValue,
        p.numberOfSymbolInstances,
        p.stripSize,
        T,
        I,
        p.transposed,
        p.dsOffset,
        p.referenceCorner,
        p.combinationOperator,
        A,
        p.refinementTemplate,
        p.refinementAt,
        v,
        p.logStripSize,
        D
      );
      this.drawBitmap(g, k);
    },
    onImmediateLosslessTextRegion: function() {
      this.onImmediateTextRegion.apply(this, arguments);
    },
    onPatternDictionary(n, p, d, u, l) {
      let h = this.patterns;
      h || (this.patterns = h = {});
      const g = new i(d, u, l);
      h[p] = G(
        n.mmr,
        n.patternWidth,
        n.patternHeight,
        n.maxPatternIndex,
        n.template,
        g
      );
    },
    onImmediateHalftoneRegion(n, p, d, u, l) {
      const h = this.patterns[p[0]], g = n.info, A = new i(d, u, l), D = ie(
        n.mmr,
        h,
        n.template,
        g.width,
        g.height,
        n.defaultPixelValue,
        n.enableSkip,
        n.combinationOperator,
        n.gridWidth,
        n.gridHeight,
        n.gridOffsetX,
        n.gridOffsetY,
        n.gridVectorX,
        n.gridVectorY,
        A
      );
      this.drawBitmap(g, D);
    },
    onImmediateLosslessHalftoneRegion() {
      this.onImmediateHalftoneRegion.apply(this, arguments);
    },
    onTables(n, p, d, u) {
      let l = this.customTables;
      l || (this.customTables = l = {}), l[n] = Ge(p, d, u);
    }
  };
  function J(n) {
    n.length === 2 ? (this.isOOB = !0, this.rangeLow = 0, this.prefixLength = n[0], this.rangeLength = 0, this.prefixCode = n[1], this.isLowerRange = !1) : (this.isOOB = !1, this.rangeLow = n[0], this.prefixLength = n[1], this.rangeLength = n[2], this.prefixCode = n[3], this.isLowerRange = n[4] === "lower");
  }
  function me(n) {
    this.children = [], n ? (this.isLeaf = !0, this.rangeLength = n.rangeLength, this.rangeLow = n.rangeLow, this.isLowerRange = n.isLowerRange, this.isOOB = n.isOOB) : this.isLeaf = !1;
  }
  me.prototype = {
    buildTree(n, p) {
      const d = n.prefixCode >> p & 1;
      if (p <= 0)
        this.children[d] = new me(n);
      else {
        let u = this.children[d];
        u || (this.children[d] = u = new me(null)), u.buildTree(n, p - 1);
      }
    },
    decodeNode(n) {
      if (this.isLeaf) {
        if (this.isOOB)
          return null;
        const d = n.readBits(this.rangeLength);
        return this.rangeLow + (this.isLowerRange ? -d : d);
      }
      const p = this.children[n.readBit()];
      if (!p)
        throw new Q("invalid Huffman data");
      return p.decodeNode(n);
    }
  };
  function V(n, p) {
    p || this.assignPrefixCodes(n), this.rootNode = new me(null);
    for (let d = 0, u = n.length; d < u; d++) {
      const l = n[d];
      l.prefixLength > 0 && this.rootNode.buildTree(l, l.prefixLength - 1);
    }
  }
  V.prototype = {
    decode(n) {
      return this.rootNode.decodeNode(n);
    },
    assignPrefixCodes(n) {
      const p = n.length;
      let d = 0;
      for (let b = 0; b < p; b++)
        d = Math.max(d, n[b].prefixLength);
      const u = new Uint32Array(d + 1);
      for (let b = 0; b < p; b++)
        u[n[b].prefixLength]++;
      let l = 1, h = 0, g, A, D;
      for (u[0] = 0; l <= d; ) {
        for (h = h + u[l - 1] << 1, g = h, A = 0; A < p; )
          D = n[A], D.prefixLength === l && (D.prefixCode = g, g++), A++;
        l++;
      }
    }
  };
  function Ge(n, p, d) {
    const u = n[p], l = ee(n, p + 1) & 4294967295, h = ee(n, p + 5) & 4294967295, g = new Le(n, p + 9, d), A = (u >> 1 & 7) + 1, D = (u >> 4 & 7) + 1, b = [];
    let T, E, C = l;
    do
      T = g.readBits(A), E = g.readBits(D), b.push(
        new J([C, T, E, 0])
      ), C += 1 << E;
    while (C < h);
    return T = g.readBits(A), b.push(
      new J([l - 1, T, 32, 0, "lower"])
    ), T = g.readBits(A), b.push(new J([h, T, 32, 0])), u & 1 && (T = g.readBits(A), b.push(new J([T, 0]))), new V(b, !1);
  }
  const he = {};
  function De(n) {
    let p = he[n];
    if (p)
      return p;
    let d;
    switch (n) {
      case 1:
        d = [
          [0, 1, 4, 0],
          [16, 2, 8, 2],
          [272, 3, 16, 6],
          [65808, 3, 32, 7]
          // upper
        ];
        break;
      case 2:
        d = [
          [0, 1, 0, 0],
          [1, 2, 0, 2],
          [2, 3, 0, 6],
          [3, 4, 3, 14],
          [11, 5, 6, 30],
          [75, 6, 32, 62],
          // upper
          [6, 63]
          // OOB
        ];
        break;
      case 3:
        d = [
          [-256, 8, 8, 254],
          [0, 1, 0, 0],
          [1, 2, 0, 2],
          [2, 3, 0, 6],
          [3, 4, 3, 14],
          [11, 5, 6, 30],
          [-257, 8, 32, 255, "lower"],
          [75, 7, 32, 126],
          // upper
          [6, 62]
          // OOB
        ];
        break;
      case 4:
        d = [
          [1, 1, 0, 0],
          [2, 2, 0, 2],
          [3, 3, 0, 6],
          [4, 4, 3, 14],
          [12, 5, 6, 30],
          [76, 5, 32, 31]
          // upper
        ];
        break;
      case 5:
        d = [
          [-255, 7, 8, 126],
          [1, 1, 0, 0],
          [2, 2, 0, 2],
          [3, 3, 0, 6],
          [4, 4, 3, 14],
          [12, 5, 6, 30],
          [-256, 7, 32, 127, "lower"],
          [76, 6, 32, 62]
          // upper
        ];
        break;
      case 6:
        d = [
          [-2048, 5, 10, 28],
          [-1024, 4, 9, 8],
          [-512, 4, 8, 9],
          [-256, 4, 7, 10],
          [-128, 5, 6, 29],
          [-64, 5, 5, 30],
          [-32, 4, 5, 11],
          [0, 2, 7, 0],
          [128, 3, 7, 2],
          [256, 3, 8, 3],
          [512, 4, 9, 12],
          [1024, 4, 10, 13],
          [-2049, 6, 32, 62, "lower"],
          [2048, 6, 32, 63]
          // upper
        ];
        break;
      case 7:
        d = [
          [-1024, 4, 9, 8],
          [-512, 3, 8, 0],
          [-256, 4, 7, 9],
          [-128, 5, 6, 26],
          [-64, 5, 5, 27],
          [-32, 4, 5, 10],
          [0, 4, 5, 11],
          [32, 5, 5, 28],
          [64, 5, 6, 29],
          [128, 4, 7, 12],
          [256, 3, 8, 1],
          [512, 3, 9, 2],
          [1024, 3, 10, 3],
          [-1025, 5, 32, 30, "lower"],
          [2048, 5, 32, 31]
          // upper
        ];
        break;
      case 8:
        d = [
          [-15, 8, 3, 252],
          [-7, 9, 1, 508],
          [-5, 8, 1, 253],
          [-3, 9, 0, 509],
          [-2, 7, 0, 124],
          [-1, 4, 0, 10],
          [0, 2, 1, 0],
          [2, 5, 0, 26],
          [3, 6, 0, 58],
          [4, 3, 4, 4],
          [20, 6, 1, 59],
          [22, 4, 4, 11],
          [38, 4, 5, 12],
          [70, 5, 6, 27],
          [134, 5, 7, 28],
          [262, 6, 7, 60],
          [390, 7, 8, 125],
          [646, 6, 10, 61],
          [-16, 9, 32, 510, "lower"],
          [1670, 9, 32, 511],
          // upper
          [2, 1]
          // OOB
        ];
        break;
      case 9:
        d = [
          [-31, 8, 4, 252],
          [-15, 9, 2, 508],
          [-11, 8, 2, 253],
          [-7, 9, 1, 509],
          [-5, 7, 1, 124],
          [-3, 4, 1, 10],
          [-1, 3, 1, 2],
          [1, 3, 1, 3],
          [3, 5, 1, 26],
          [5, 6, 1, 58],
          [7, 3, 5, 4],
          [39, 6, 2, 59],
          [43, 4, 5, 11],
          [75, 4, 6, 12],
          [139, 5, 7, 27],
          [267, 5, 8, 28],
          [523, 6, 8, 60],
          [779, 7, 9, 125],
          [1291, 6, 11, 61],
          [-32, 9, 32, 510, "lower"],
          [3339, 9, 32, 511],
          // upper
          [2, 0]
          // OOB
        ];
        break;
      case 10:
        d = [
          [-21, 7, 4, 122],
          [-5, 8, 0, 252],
          [-4, 7, 0, 123],
          [-3, 5, 0, 24],
          [-2, 2, 2, 0],
          [2, 5, 0, 25],
          [3, 6, 0, 54],
          [4, 7, 0, 124],
          [5, 8, 0, 253],
          [6, 2, 6, 1],
          [70, 5, 5, 26],
          [102, 6, 5, 55],
          [134, 6, 6, 56],
          [198, 6, 7, 57],
          [326, 6, 8, 58],
          [582, 6, 9, 59],
          [1094, 6, 10, 60],
          [2118, 7, 11, 125],
          [-22, 8, 32, 254, "lower"],
          [4166, 8, 32, 255],
          // upper
          [2, 2]
          // OOB
        ];
        break;
      case 11:
        d = [
          [1, 1, 0, 0],
          [2, 2, 1, 2],
          [4, 4, 0, 12],
          [5, 4, 1, 13],
          [7, 5, 1, 28],
          [9, 5, 2, 29],
          [13, 6, 2, 60],
          [17, 7, 2, 122],
          [21, 7, 3, 123],
          [29, 7, 4, 124],
          [45, 7, 5, 125],
          [77, 7, 6, 126],
          [141, 7, 32, 127]
          // upper
        ];
        break;
      case 12:
        d = [
          [1, 1, 0, 0],
          [2, 2, 0, 2],
          [3, 3, 1, 6],
          [5, 5, 0, 28],
          [6, 5, 1, 29],
          [8, 6, 1, 60],
          [10, 7, 0, 122],
          [11, 7, 1, 123],
          [13, 7, 2, 124],
          [17, 7, 3, 125],
          [25, 7, 4, 126],
          [41, 8, 5, 254],
          [73, 8, 32, 255]
          // upper
        ];
        break;
      case 13:
        d = [
          [1, 1, 0, 0],
          [2, 3, 0, 4],
          [3, 4, 0, 12],
          [4, 5, 0, 28],
          [5, 4, 1, 13],
          [7, 3, 3, 5],
          [15, 6, 1, 58],
          [17, 6, 2, 59],
          [21, 6, 3, 60],
          [29, 6, 4, 61],
          [45, 6, 5, 62],
          [77, 7, 6, 126],
          [141, 7, 32, 127]
          // upper
        ];
        break;
      case 14:
        d = [
          [-2, 3, 0, 4],
          [-1, 3, 0, 5],
          [0, 1, 0, 0],
          [1, 3, 0, 6],
          [2, 3, 0, 7]
        ];
        break;
      case 15:
        d = [
          [-24, 7, 4, 124],
          [-8, 6, 2, 60],
          [-4, 5, 1, 28],
          [-2, 4, 0, 12],
          [-1, 3, 0, 4],
          [0, 1, 0, 0],
          [1, 3, 0, 5],
          [2, 4, 0, 13],
          [3, 5, 1, 29],
          [5, 6, 2, 61],
          [9, 7, 4, 125],
          [-25, 7, 32, 126, "lower"],
          [25, 7, 32, 127]
          // upper
        ];
        break;
      default:
        throw new Q(`standard table B.${n} does not exist`);
    }
    for (let u = 0, l = d.length; u < l; u++)
      d[u] = new J(d[u]);
    return p = new V(d, !0), he[n] = p, p;
  }
  function Le(n, p, d) {
    this.data = n, this.start = p, this.end = d, this.position = p, this.shift = -1, this.currentByte = 0;
  }
  Le.prototype = {
    readBit() {
      if (this.shift < 0) {
        if (this.position >= this.end)
          throw new Q("end of data while reading bit");
        this.currentByte = this.data[this.position++], this.shift = 7;
      }
      const n = this.currentByte >> this.shift & 1;
      return this.shift--, n;
    },
    readBits(n) {
      let p = 0, d;
      for (d = n - 1; d >= 0; d--)
        p |= this.readBit() << d;
      return p;
    },
    byteAlign() {
      this.shift = -1;
    },
    next() {
      return this.position >= this.end ? -1 : this.data[this.position++];
    }
  };
  function ke(n, p, d) {
    let u = 0;
    for (let l = 0, h = p.length; l < h; l++) {
      const g = d[p[l]];
      if (g) {
        if (n === u)
          return g;
        u++;
      }
    }
    throw new Q("can't find custom Huffman table");
  }
  function L1(n, p, d, u, l) {
    const h = [];
    for (let C = 0; C <= 34; C++) {
      const I = l.readBits(4);
      h.push(new J([C, I, 0, 0]));
    }
    const g = new V(h, !1);
    h.length = 0;
    for (let C = 0; C < u; ) {
      const I = g.decode(l);
      if (I >= 32) {
        let v, k, F;
        switch (I) {
          case 32:
            if (C === 0)
              throw new Q("no previous value in symbol ID table");
            k = l.readBits(2) + 3, v = h[C - 1].prefixLength;
            break;
          case 33:
            k = l.readBits(3) + 3, v = 0;
            break;
          case 34:
            k = l.readBits(7) + 11, v = 0;
            break;
          default:
            throw new Q("invalid code length in symbol ID table");
        }
        for (F = 0; F < k; F++)
          h.push(new J([C, v, 0, 0])), C++;
      } else
        h.push(new J([C, I, 0, 0])), C++;
    }
    l.byteAlign();
    const A = new V(h, !1);
    let D = 0, b, T, E;
    switch (n.huffmanFS) {
      case 0:
      case 1:
        b = De(n.huffmanFS + 6);
        break;
      case 3:
        b = ke(
          D,
          p,
          d
        ), D++;
        break;
      default:
        throw new Q("invalid Huffman FS selector");
    }
    switch (n.huffmanDS) {
      case 0:
      case 1:
      case 2:
        T = De(n.huffmanDS + 8);
        break;
      case 3:
        T = ke(
          D,
          p,
          d
        ), D++;
        break;
      default:
        throw new Q("invalid Huffman DS selector");
    }
    switch (n.huffmanDT) {
      case 0:
      case 1:
      case 2:
        E = De(n.huffmanDT + 11);
        break;
      case 3:
        E = ke(
          D,
          p,
          d
        ), D++;
        break;
      default:
        throw new Q("invalid Huffman DT selector");
    }
    if (n.refinement)
      throw new Q("refinement with Huffman is not supported");
    return {
      symbolIDTable: A,
      tableFirstS: b,
      tableDeltaS: T,
      tableDeltaT: E
    };
  }
  function V1(n, p, d) {
    let u = 0, l, h;
    switch (n.huffmanDHSelector) {
      case 0:
      case 1:
        l = De(n.huffmanDHSelector + 4);
        break;
      case 3:
        l = ke(
          u,
          p,
          d
        ), u++;
        break;
      default:
        throw new Q("invalid Huffman DH selector");
    }
    switch (n.huffmanDWSelector) {
      case 0:
      case 1:
        h = De(n.huffmanDWSelector + 2);
        break;
      case 3:
        h = ke(
          u,
          p,
          d
        ), u++;
        break;
      default:
        throw new Q("invalid Huffman DW selector");
    }
    let g, A;
    return n.bitmapSizeSelector ? (g = ke(
      u,
      p,
      d
    ), u++) : g = De(1), n.aggregationInstancesSelector ? A = ke(
      u,
      p,
      d
    ) : A = De(1), {
      tableDeltaHeight: l,
      tableDeltaWidth: h,
      tableBitmapSize: g,
      tableAggregateInstances: A
    };
  }
  function H1(n, p, d) {
    const u = [];
    for (let l = 0; l < d; l++) {
      const h = new Uint8Array(p);
      u.push(h);
      for (let g = 0; g < p; g++)
        h[g] = n.readBit();
      n.byteAlign();
    }
    return u;
  }
  function i1(n, p, d, u) {
    const l = {
      K: -1,
      Columns: p,
      Rows: d,
      BlackIs1: !0,
      EndOfBlock: u
    }, h = new It(n, l), g = [];
    let A, D = !1;
    for (let b = 0; b < d; b++) {
      const T = new Uint8Array(p);
      g.push(T);
      let E = -1;
      for (let C = 0; C < p; C++)
        E < 0 && (A = h.readNextChar(), A === -1 && (A = 0, D = !0), E = 7), T[C] = A >> E & 1, E--;
    }
    if (u && !D)
      for (let T = 0; T < 5 && h.readNextChar() !== -1; T++)
        ;
    return g;
  }
  function u1() {
  }
  return u1.prototype = {
    parseChunks(n) {
      return P(n);
    },
    parse(n) {
      const { imgData: p, width: d, height: u } = R(n);
      return this.width = d, this.height = u, p;
    }
  }, u1;
})(), v1 = {}, He, y1 = typeof Uint8Array == "function";
v1.decode = function(e) {
  var t = typeof e == "string", i;
  if (He === void 0) {
    var r = "0123456789ABCDEF", c = ` \f
\r	 \u2028\u2029`;
    for (He = [], i = 0; i < 16; ++i)
      He[r.charCodeAt(i)] = i;
    for (r = r.toLowerCase(), i = 10; i < 16; ++i)
      He[r.charCodeAt(i)] = i;
    for (i = 0; i < c.length; ++i)
      He[c.charCodeAt(i)] = -1;
  }
  var o = y1 ? new Uint8Array(e.length >> 1) : [], s = 0, a = 0, m = 0;
  for (i = 0; i < e.length; ++i) {
    var S = t ? e.charCodeAt(i) : e[i];
    if (S = He[S], S != -1) {
      if (S === void 0)
        throw "Illegal character at offset " + i;
      s |= S, ++a >= 2 ? (o[m++] = s, s = 0, a = 0) : s <<= 4;
    }
  }
  if (a)
    throw "Hex encoding incomplete: 4 bits missing";
  return y1 && o.length > m && (o = o.subarray(0, m)), o;
};
var Xe = {}, Ne, b1 = typeof Uint8Array == "function";
Xe.decode = function(e) {
  var t = typeof e == "string", i;
  if (Ne === void 0) {
    var r = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", c = `= \f
\r	 \u2028\u2029`;
    for (Ne = [], i = 0; i < 64; ++i)
      Ne[r.charCodeAt(i)] = i;
    for (i = 0; i < c.length; ++i)
      Ne[c.charCodeAt(i)] = -1;
    Ne[45] = Ne[43], Ne[95] = Ne[47];
  }
  var o = b1 ? new Uint8Array(e.length * 3 >> 2) : [], s = 0, a = 0, m = 0;
  for (i = 0; i < e.length; ++i) {
    var S = t ? e.charCodeAt(i) : e[i];
    if (S == 61)
      break;
    if (S = Ne[S], S != -1) {
      if (S === void 0)
        throw "Illegal character at offset " + i;
      s |= S, ++a >= 4 ? (o[m++] = s >> 16, o[m++] = s >> 8 & 255, o[m++] = s & 255, s = 0, a = 0) : s <<= 6;
    }
  }
  switch (a) {
    case 1:
      throw "Base64 encoding incomplete: at least 2 bits missing";
    case 2:
      o[m++] = s >> 10;
      break;
    case 3:
      o[m++] = s >> 16, o[m++] = s >> 8 & 255;
      break;
  }
  return b1 && o.length > m && (o = o.subarray(0, m)), o;
};
Xe.pretty = function(e) {
  return e.length % 4 > 0 && (e = (e + "===").slice(0, e.length + e.length % 4)), e = e.replace(/-/g, "+").replace(/_/g, "/"), e.replace(/(.{80})/g, `$1
`);
};
Xe.re = /-----BEGIN [^-]+-----([A-Za-z0-9+/=\s]+)-----END [^-]+-----|begin-base64[^\n]+\n([A-Za-z0-9+/=\s]+)====/;
Xe.unarmor = function(e) {
  var t = Xe.re.exec(e);
  if (t)
    if (t[1])
      e = t[1];
    else if (t[2])
      e = t[2];
    else
      throw "RegExp out of sync";
  return Xe.decode(e);
};
var qe = 1e13;
function xe(e) {
  this.buf = [+e || 0];
}
xe.prototype.mulAdd = function(e, t) {
  var i = this.buf, r = i.length, c, o;
  for (c = 0; c < r; ++c)
    o = i[c] * e + t, o < qe ? t = 0 : (t = 0 | o / qe, o -= t * qe), i[c] = o;
  t > 0 && (i[c] = t);
};
xe.prototype.sub = function(e) {
  var t = this.buf, i = t.length, r, c;
  for (r = 0; r < i; ++r)
    c = t[r] - e, c < 0 ? (c += qe, e = 1) : e = 0, t[r] = c;
  for (; t[t.length - 1] === 0; )
    t.pop();
};
xe.prototype.toString = function(e) {
  if ((e || 10) != 10)
    throw "only base 10 is supported";
  for (var t = this.buf, i = t[t.length - 1].toString(), r = t.length - 2; r >= 0; --r)
    i += (qe + t[r]).toString().substring(1);
  return i;
};
xe.prototype.valueOf = function() {
  for (var e = this.buf, t = 0, i = e.length - 1; i >= 0; --i)
    t = t * qe + e[i];
  return t;
};
xe.prototype.simplify = function() {
  var e = this.buf;
  return e.length == 1 ? e[0] : this;
};
const I1 = {
  "0.2.262.1.10": { d: "Telesec", c: "Deutsche Telekom" },
  "0.2.262.1.10.0": { d: "extension", c: "Telesec" },
  "0.2.262.1.10.1": { d: "mechanism", c: "Telesec" },
  "0.2.262.1.10.1.0": { d: "authentication", c: "Telesec mechanism" },
  "0.2.262.1.10.1.0.1": { d: "passwordAuthentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.2": { d: "protectedPasswordAuthentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.3": { d: "oneWayX509Authentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.4": { d: "twoWayX509Authentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.5": { d: "threeWayX509Authentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.6": { d: "oneWayISO9798Authentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.7": { d: "twoWayISO9798Authentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.0.8": { d: "telekomAuthentication", c: "Telesec authentication" },
  "0.2.262.1.10.1.1": { d: "signature", c: "Telesec mechanism" },
  "0.2.262.1.10.1.1.1": { d: "md4WithRSAAndISO9697", c: "Telesec mechanism" },
  "0.2.262.1.10.1.1.2": { d: "md4WithRSAAndTelesecSignatureStandard", c: "Telesec mechanism" },
  "0.2.262.1.10.1.1.3": { d: "md5WithRSAAndISO9697", c: "Telesec mechanism" },
  "0.2.262.1.10.1.1.4": { d: "md5WithRSAAndTelesecSignatureStandard", c: "Telesec mechanism" },
  "0.2.262.1.10.1.1.5": { d: "ripemd160WithRSAAndTelekomSignatureStandard", c: "Telesec mechanism" },
  "0.2.262.1.10.1.1.9": { d: "hbciRsaSignature", c: "Telesec signature" },
  "0.2.262.1.10.1.2": { d: "encryption", c: "Telesec mechanism" },
  "0.2.262.1.10.1.2.0": { d: "none", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.1": { d: "rsaTelesec", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.2": { d: "des", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.2.1": { d: "desECB", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.2.2": { d: "desCBC", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.2.3": { d: "desOFB", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.2.4": { d: "desCFB8", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.2.5": { d: "desCFB64", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.3": { d: "des3", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.3.1": { d: "des3ECB", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.3.2": { d: "des3CBC", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.3.3": { d: "des3OFB", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.3.4": { d: "des3CFB8", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.3.5": { d: "des3CFB64", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.4": { d: "magenta", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.5": { d: "idea", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.5.1": { d: "ideaECB", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.5.2": { d: "ideaCBC", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.5.3": { d: "ideaOFB", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.5.4": { d: "ideaCFB8", c: "Telesec encryption" },
  "0.2.262.1.10.1.2.5.5": { d: "ideaCFB64", c: "Telesec encryption" },
  "0.2.262.1.10.1.3": { d: "oneWayFunction", c: "Telesec mechanism" },
  "0.2.262.1.10.1.3.1": { d: "md4", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.2": { d: "md5", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.3": { d: "sqModNX509", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.4": { d: "sqModNISO", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.5": { d: "ripemd128", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.6": { d: "hashUsingBlockCipher", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.7": { d: "mac", c: "Telesec one-way function" },
  "0.2.262.1.10.1.3.8": { d: "ripemd160", c: "Telesec one-way function" },
  "0.2.262.1.10.1.4": { d: "fecFunction", c: "Telesec mechanism" },
  "0.2.262.1.10.1.4.1": { d: "reedSolomon", c: "Telesec mechanism" },
  "0.2.262.1.10.2": { d: "module", c: "Telesec" },
  "0.2.262.1.10.2.0": { d: "algorithms", c: "Telesec module" },
  "0.2.262.1.10.2.1": { d: "attributeTypes", c: "Telesec module" },
  "0.2.262.1.10.2.2": { d: "certificateTypes", c: "Telesec module" },
  "0.2.262.1.10.2.3": { d: "messageTypes", c: "Telesec module" },
  "0.2.262.1.10.2.4": { d: "plProtocol", c: "Telesec module" },
  "0.2.262.1.10.2.5": { d: "smeAndComponentsOfSme", c: "Telesec module" },
  "0.2.262.1.10.2.6": { d: "fec", c: "Telesec module" },
  "0.2.262.1.10.2.7": { d: "usefulDefinitions", c: "Telesec module" },
  "0.2.262.1.10.2.8": { d: "stefiles", c: "Telesec module" },
  "0.2.262.1.10.2.9": { d: "sadmib", c: "Telesec module" },
  "0.2.262.1.10.2.10": { d: "electronicOrder", c: "Telesec module" },
  "0.2.262.1.10.2.11": { d: "telesecTtpAsymmetricApplication", c: "Telesec module" },
  "0.2.262.1.10.2.12": { d: "telesecTtpBasisApplication", c: "Telesec module" },
  "0.2.262.1.10.2.13": { d: "telesecTtpMessages", c: "Telesec module" },
  "0.2.262.1.10.2.14": { d: "telesecTtpTimeStampApplication", c: "Telesec module" },
  "0.2.262.1.10.3": { d: "objectClass", c: "Telesec" },
  "0.2.262.1.10.3.0": { d: "telesecOtherName", c: "Telesec object class" },
  "0.2.262.1.10.3.1": { d: "directory", c: "Telesec object class" },
  "0.2.262.1.10.3.2": { d: "directoryType", c: "Telesec object class" },
  "0.2.262.1.10.3.3": { d: "directoryGroup", c: "Telesec object class" },
  "0.2.262.1.10.3.4": { d: "directoryUser", c: "Telesec object class" },
  "0.2.262.1.10.3.5": { d: "symmetricKeyEntry", c: "Telesec object class" },
  "0.2.262.1.10.4": { d: "package", c: "Telesec" },
  "0.2.262.1.10.5": { d: "parameter", c: "Telesec" },
  "0.2.262.1.10.6": { d: "nameBinding", c: "Telesec" },
  "0.2.262.1.10.7": { d: "attribute", c: "Telesec" },
  "0.2.262.1.10.7.0": { d: "applicationGroupIdentifier", c: "Telesec attribute" },
  "0.2.262.1.10.7.1": { d: "certificateType", c: "Telesec attribute" },
  "0.2.262.1.10.7.2": { d: "telesecCertificate", c: "Telesec attribute" },
  "0.2.262.1.10.7.3": { d: "certificateNumber", c: "Telesec attribute" },
  "0.2.262.1.10.7.4": { d: "certificateRevocationList", c: "Telesec attribute" },
  "0.2.262.1.10.7.5": { d: "creationDate", c: "Telesec attribute" },
  "0.2.262.1.10.7.6": { d: "issuer", c: "Telesec attribute" },
  "0.2.262.1.10.7.7": { d: "namingAuthority", c: "Telesec attribute" },
  "0.2.262.1.10.7.8": { d: "publicKeyDirectory", c: "Telesec attribute" },
  "0.2.262.1.10.7.9": { d: "securityDomain", c: "Telesec attribute" },
  "0.2.262.1.10.7.10": { d: "subject", c: "Telesec attribute" },
  "0.2.262.1.10.7.11": { d: "timeOfRevocation", c: "Telesec attribute" },
  "0.2.262.1.10.7.12": { d: "userGroupReference", c: "Telesec attribute" },
  "0.2.262.1.10.7.13": { d: "validity", c: "Telesec attribute" },
  "0.2.262.1.10.7.14": { d: "zert93", c: "Telesec attribute" },
  "0.2.262.1.10.7.15": { d: "securityMessEnv", c: "Telesec attribute" },
  "0.2.262.1.10.7.16": { d: "anonymizedPublicKeyDirectory", c: "Telesec attribute" },
  "0.2.262.1.10.7.17": { d: "telesecGivenName", c: "Telesec attribute" },
  "0.2.262.1.10.7.18": { d: "nameAdditions", c: "Telesec attribute" },
  "0.2.262.1.10.7.19": { d: "telesecPostalCode", c: "Telesec attribute" },
  "0.2.262.1.10.7.20": { d: "nameDistinguisher", c: "Telesec attribute" },
  "0.2.262.1.10.7.21": { d: "telesecCertificateList", c: "Telesec attribute" },
  "0.2.262.1.10.7.22": { d: "teletrustCertificateList", c: "Telesec attribute" },
  "0.2.262.1.10.7.23": { d: "x509CertificateList", c: "Telesec attribute" },
  "0.2.262.1.10.7.24": { d: "timeOfIssue", c: "Telesec attribute" },
  "0.2.262.1.10.7.25": { d: "physicalCardNumber", c: "Telesec attribute" },
  "0.2.262.1.10.7.26": { d: "fileType", c: "Telesec attribute" },
  "0.2.262.1.10.7.27": { d: "ctlFileIsArchive", c: "Telesec attribute" },
  "0.2.262.1.10.7.28": { d: "emailAddress", c: "Telesec attribute" },
  "0.2.262.1.10.7.29": { d: "certificateTemplateList", c: "Telesec attribute" },
  "0.2.262.1.10.7.30": { d: "directoryName", c: "Telesec attribute" },
  "0.2.262.1.10.7.31": { d: "directoryTypeName", c: "Telesec attribute" },
  "0.2.262.1.10.7.32": { d: "directoryGroupName", c: "Telesec attribute" },
  "0.2.262.1.10.7.33": { d: "directoryUserName", c: "Telesec attribute" },
  "0.2.262.1.10.7.34": { d: "revocationFlag", c: "Telesec attribute" },
  "0.2.262.1.10.7.35": { d: "symmetricKeyEntryName", c: "Telesec attribute" },
  "0.2.262.1.10.7.36": { d: "glNumber", c: "Telesec attribute" },
  "0.2.262.1.10.7.37": { d: "goNumber", c: "Telesec attribute" },
  "0.2.262.1.10.7.38": { d: "gKeyData", c: "Telesec attribute" },
  "0.2.262.1.10.7.39": { d: "zKeyData", c: "Telesec attribute" },
  "0.2.262.1.10.7.40": { d: "ktKeyData", c: "Telesec attribute" },
  "0.2.262.1.10.7.41": { d: "ktKeyNumber", c: "Telesec attribute" },
  "0.2.262.1.10.7.51": { d: "timeOfRevocationGen", c: "Telesec attribute" },
  "0.2.262.1.10.7.52": { d: "liabilityText", c: "Telesec attribute" },
  "0.2.262.1.10.8": { d: "attributeGroup", c: "Telesec" },
  "0.2.262.1.10.9": { d: "action", c: "Telesec" },
  "0.2.262.1.10.10": { d: "notification", c: "Telesec" },
  "0.2.262.1.10.11": { d: "snmp-mibs", c: "Telesec" },
  "0.2.262.1.10.11.1": { d: "securityApplication", c: "Telesec SNMP MIBs" },
  "0.2.262.1.10.12": { d: "certAndCrlExtensionDefinitions", c: "Telesec" },
  "0.2.262.1.10.12.0": { d: "liabilityLimitationFlag", c: "Telesec cert/CRL extension" },
  "0.2.262.1.10.12.1": { d: "telesecCertIdExt", c: "Telesec cert/CRL extension" },
  "0.2.262.1.10.12.2": { d: "Telesec policyIdentifier", c: "Telesec cert/CRL extension" },
  "0.2.262.1.10.12.3": { d: "telesecPolicyQualifierID", c: "Telesec cert/CRL extension" },
  "0.2.262.1.10.12.4": { d: "telesecCRLFilteredExt", c: "Telesec cert/CRL extension" },
  "0.2.262.1.10.12.5": { d: "telesecCRLFilterExt", c: "Telesec cert/CRL extension" },
  "0.2.262.1.10.12.6": { d: "telesecNamingAuthorityExt", c: "Telesec cert/CRL extension" },
  "0.4.0.127.0.7": { d: "bsi", c: "BSI TR-03110/TR-03111" },
  "0.4.0.127.0.7.1": { d: "bsiEcc", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1": { d: "bsifieldType", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.1": { d: "bsiPrimeField", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2": { d: "bsiCharacteristicTwoField", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2.2": { d: "bsiECTLVKeyFormat", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2.2.1": { d: "bsiECTLVPublicKey", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2.3": { d: "bsiCharacteristicTwoBasis", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2.3.1": { d: "bsiGnBasis", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2.3.2": { d: "bsiTpBasis", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.2.3.3": { d: "bsiPpBasis", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1": { d: "bsiEcdsaSignatures", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1.1": { d: "bsiEcdsaWithSHA1", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1.2": { d: "bsiEcdsaWithSHA224", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1.3": { d: "bsiEcdsaWithSHA256", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1.4": { d: "bsiEcdsaWithSHA384", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1.5": { d: "bsiEcdsaWithSHA512", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.4.1.6": { d: "bsiEcdsaWithRIPEMD160", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1": { d: "bsiEckaEgX963KDF", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1.1": { d: "bsiEckaEgX963KDFWithSHA1", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1.2": { d: "bsiEckaEgX963KDFWithSHA224", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1.3": { d: "bsiEckaEgX963KDFWithSHA256", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1.4": { d: "bsiEckaEgX963KDFWithSHA384", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1.5": { d: "bsiEckaEgX963KDFWithSHA512", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.1.6": { d: "bsiEckaEgX963KDFWithRIPEMD160", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.2": { d: "bsiEckaEgSessionKDF", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.2.1": { d: "bsiEckaEgSessionKDFWith3DES", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.2.2": { d: "bsiEckaEgSessionKDFWithAES128", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.2.3": { d: "bsiEckaEgSessionKDFWithAES192", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.1.2.4": { d: "bsiEckaEgSessionKDFWithAES256", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2": { d: "bsiEckaDH", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1": { d: "bsiEckaDHX963KDF", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1.1": { d: "bsiEckaDHX963KDFWithSHA1", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1.2": { d: "bsiEckaDHX963KDFWithSHA224", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1.3": { d: "bsiEckaDHX963KDFWithSHA256", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1.4": { d: "bsiEckaDHX963KDFWithSHA384", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1.5": { d: "bsiEckaDHX963KDFWithSHA512", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.1.6": { d: "bsiEckaDHX963KDFWithRIPEMD160", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.2": { d: "bsiEckaDHSessionKDF", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.2.1": { d: "bsiEckaDHSessionKDFWith3DES", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.2.2": { d: "bsiEckaDHSessionKDFWithAES128", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.2.3": { d: "bsiEckaDHSessionKDFWithAES192", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.1.5.2.2.4": { d: "bsiEckaDHSessionKDFWithAES256", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.2": { d: "bsiEcKeyType", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.2.1": { d: "bsiEcPublicKey", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.5.1": { d: "bsiKaeg", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.5.1.1": { d: "bsiKaegWithX963KDF", c: "BSI TR-03111" },
  "0.4.0.127.0.7.1.5.1.2": { d: "bsiKaegWith3DESKDF", c: "BSI TR-03111" },
  "0.4.0.127.0.7.2.2.1": { d: "bsiPK", c: "BSI TR-03110. Formerly known as bsiCA, now moved to ...2.2.3.x" },
  "0.4.0.127.0.7.2.2.1.1": { d: "bsiPK_DH", c: "BSI TR-03110. Formerly known as bsiCA_DH, now moved to ...2.2.3.x" },
  "0.4.0.127.0.7.2.2.1.2": { d: "bsiPK_ECDH", c: "BSI TR-03110. Formerly known as bsiCA_ECDH, now moved to ...2.2.3.x" },
  "0.4.0.127.0.7.2.2.2": { d: "bsiTA", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1": { d: "bsiTA_RSA", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1.1": { d: "bsiTA_RSAv1_5_SHA1", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1.2": { d: "bsiTA_RSAv1_5_SHA256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1.3": { d: "bsiTA_RSAPSS_SHA1", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1.4": { d: "bsiTA_RSAPSS_SHA256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1.5": { d: "bsiTA_RSAv1_5_SHA512", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.1.6": { d: "bsiTA_RSAPSS_SHA512", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.2": { d: "bsiTA_ECDSA", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.2.1": { d: "bsiTA_ECDSA_SHA1", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.2.2": { d: "bsiTA_ECDSA_SHA224", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.2.3": { d: "bsiTA_ECDSA_SHA256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.2.4": { d: "bsiTA_ECDSA_SHA384", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.2.2.5": { d: "bsiTA_ECDSA_SHA512", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3": { d: "bsiCA", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.1": { d: "bsiCA_DH", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.1.1": { d: "bsiCA_DH_3DES_CBC_CBC", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.1.2": { d: "bsiCA_DH_AES_CBC_CMAC_128", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.1.3": { d: "bsiCA_DH_AES_CBC_CMAC_192", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.1.4": { d: "bsiCA_DH_AES_CBC_CMAC_256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.2": { d: "bsiCA_ECDH", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.2.1": { d: "bsiCA_ECDH_3DES_CBC_CBC", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.2.2": { d: "bsiCA_ECDH_AES_CBC_CMAC_128", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.2.3": { d: "bsiCA_ECDH_AES_CBC_CMAC_192", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.3.2.4": { d: "bsiCA_ECDH_AES_CBC_CMAC_256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4": { d: "bsiPACE", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.1": { d: "bsiPACE_DH_GM", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.1.1": { d: "bsiPACE_DH_GM_3DES_CBC_CBC", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.1.2": { d: "bsiPACE_DH_GM_AES_CBC_CMAC_128", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.1.3": { d: "bsiPACE_DH_GM_AES_CBC_CMAC_192", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.1.4": { d: "bsiPACE_DH_GM_AES_CBC_CMAC_256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.2": { d: "bsiPACE_ECDH_GM", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.2.1": { d: "bsiPACE_ECDH_GM_3DES_CBC_CBC", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.2.2": { d: "bsiPACE_ECDH_GM_AES_CBC_CMAC_128", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.2.3": { d: "bsiPACE_ECDH_GM_AES_CBC_CMAC_192", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.2.4": { d: "bsiPACE_ECDH_GM_AES_CBC_CMAC_256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.3": { d: "bsiPACE_DH_IM", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.3.1": { d: "bsiPACE_DH_IM_3DES_CBC_CBC", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.3.2": { d: "bsiPACE_DH_IM_AES_CBC_CMAC_128", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.3.3": { d: "bsiPACE_DH_IM_AES_CBC_CMAC_192", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.3.4": { d: "bsiPACE_DH_IM_AES_CBC_CMAC_256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.4": { d: "bsiPACE_ECDH_IM", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.4.1": { d: "bsiPACE_ECDH_IM_3DES_CBC_CBC", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.4.2": { d: "bsiPACE_ECDH_IM_AES_CBC_CMAC_128", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.4.3": { d: "bsiPACE_ECDH_IM_AES_CBC_CMAC_192", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.4.4.4": { d: "bsiPACE_ECDH_IM_AES_CBC_CMAC_256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5": { d: "bsiRI", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.1": { d: "bsiRI_DH", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.1.1": { d: "bsiRI_DH_SHA1", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.1.2": { d: "bsiRI_DH_SHA224", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.1.3": { d: "bsiRI_DH_SHA256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.1.4": { d: "bsiRI_DH_SHA384", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.1.5": { d: "bsiRI_DH_SHA512", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.2": { d: "bsiRI_ECDH", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.2.1": { d: "bsiRI_ECDH_SHA1", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.2.2": { d: "bsiRI_ECDH_SHA224", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.2.3": { d: "bsiRI_ECDH_SHA256", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.2.4": { d: "bsiRI_ECDH_SHA384", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.5.2.5": { d: "bsiRI_ECDH_SHA512", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.6": { d: "bsiCardInfo", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.7": { d: "bsiEidSecurity", c: "BSI TR-03110" },
  "0.4.0.127.0.7.2.2.8": { d: "bsiPT", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.2": { d: "bsiEACRoles", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.2.1": { d: "bsiEACRolesIS", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.2.2": { d: "bsiEACRolesAT", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.2.3": { d: "bsiEACRolesST", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.3": { d: "bsiTAv2ce", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.3.1": { d: "bsiTAv2ceDescription", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.3.1.1": { d: "bsiTAv2ceDescriptionPlainText", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.3.1.2": { d: "bsiTAv2ceDescriptionIA5String", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.3.1.3": { d: "bsiTAv2ceDescriptionOctetString", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.3.2": { d: "bsiTAv2ceTerminalSector", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.4": { d: "bsiAuxData", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.4.1": { d: "bsiAuxDataBirthday", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.4.2": { d: "bsiAuxDataExpireDate", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.4.3": { d: "bsiAuxDataCommunityID", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5": { d: "bsiDefectList", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.1": { d: "bsiDefectAuthDefect", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.1.1": { d: "bsiDefectCertRevoked", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.1.2": { d: "bsiDefectCertReplaced", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.1.3": { d: "bsiDefectChipAuthKeyRevoked", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.1.4": { d: "bsiDefectActiveAuthKeyRevoked", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.2": { d: "bsiDefectEPassportDefect", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.2.1": { d: "bsiDefectEPassportDGMalformed", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.2.2": { d: "bsiDefectSODInvalid", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.3": { d: "bsiDefectEIDDefect", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.3.1": { d: "bsiDefectEIDDGMalformed", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.3.2": { d: "bsiDefectEIDIntegrity", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.4": { d: "bsiDefectDocumentDefect", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.4.1": { d: "bsiDefectCardSecurityMalformed", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.4.2": { d: "bsiDefectChipSecurityMalformed", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.5.4.3": { d: "bsiDefectPowerDownReq", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.1.6": { d: "bsiListContentDescription", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.2.1": { d: "bsiSecurityObject", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.2.2": { d: "bsiBlackList", c: "BSI TR-03110" },
  "0.4.0.127.0.7.3.4.2.2": { d: "bsiSignedUpdateDeviceAdmin", c: "BSI TR-03109" },
  "0.4.0.127.0.7.4.1.1.1": { d: "bsiCertReqMsgs", c: "BSI TR-03109" },
  "0.4.0.127.0.7.4.1.1.2": { d: "bsiCertReqMsgswithOuterSignature", c: "BSI TR-03109" },
  "0.4.0.127.0.7.4.1.1.3": { d: "bsiAuthorizedCertReqMsgs", c: "BSI TR-03109" },
  "0.4.0.127.0.7.4.1.2.2": { d: "bsiSignedRevReqs", c: "BSI TR-03109" },
  "0.4.0.1862": { d: "etsiQcsProfile", c: "ETSI TS 101 862 qualified certificates" },
  "0.4.0.1862.1": { d: "etsiQcs", c: "ETSI TS 101 862 qualified certificates" },
  "0.4.0.1862.1.1": { d: "etsiQcsCompliance", c: "ETSI TS 101 862 qualified certificates" },
  "0.4.0.1862.1.2": { d: "etsiQcsLimitValue", c: "ETSI TS 101 862 qualified certificates" },
  "0.4.0.1862.1.3": { d: "etsiQcsRetentionPeriod", c: "ETSI TS 101 862 qualified certificates" },
  "0.4.0.1862.1.4": { d: "etsiQcsQcSSCD", c: "ETSI TS 101 862 qualified certificates" },
  "0.9.2342.19200300.100.1.1": { d: "userID", c: "Some oddball X.500 attribute collection" },
  "0.9.2342.19200300.100.1.3": { d: "rfc822Mailbox", c: "Some oddball X.500 attribute collection" },
  "0.9.2342.19200300.100.1.25": { d: "domainComponent", c: "Men are from Mars, this OID is from Pluto" },
  "1.0.10118.3.0.49": { d: "ripemd160", c: "ISO 10118-3 hash function" },
  "1.0.10118.3.0.50": { d: "ripemd128", c: "ISO 10118-3 hash function" },
  "1.0.10118.3.0.55": { d: "whirlpool", c: "ISO 10118-3 hash function" },
  "1.0.18033.2": { d: "iso18033-2", c: "ISO 18033-2" },
  "1.0.18033.2.2": { d: "kem", c: "ISO 18033-2 algorithms" },
  "1.0.18033.2.2.4": { d: "kemRSA", c: "ISO 18033-2 KEM algorithms" },
  "1.2.36.1.3.1.1.1": { d: "qgpki", c: "Queensland Government PKI" },
  "1.2.36.1.3.1.1.1.1": { d: "qgpkiPolicies", c: "QGPKI policies" },
  "1.2.36.1.3.1.1.1.1.1": { d: "qgpkiMedIntermedCA", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.1.1": { d: "qgpkiMedIntermedIndividual", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.1.2": { d: "qgpkiMedIntermedDeviceControl", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.1.3": { d: "qgpkiMedIntermedDevice", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.1.4": { d: "qgpkiMedIntermedAuthorisedParty", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.1.5": { d: "qgpkiMedIntermedDeviceSystem", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2": { d: "qgpkiMedIssuingCA", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.1": { d: "qgpkiMedIssuingIndividual", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.2": { d: "qgpkiMedIssuingDeviceControl", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.3": { d: "qgpkiMedIssuingDevice", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.4": { d: "qgpkiMedIssuingAuthorisedParty", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.5": { d: "qgpkiMedIssuingClientAuth", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.6": { d: "qgpkiMedIssuingServerAuth", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.7": { d: "qgpkiMedIssuingDataProt", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.2.8": { d: "qgpkiMedIssuingTokenAuth", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.3": { d: "qgpkiBasicIntermedCA", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.3.1": { d: "qgpkiBasicIntermedDeviceSystem", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.4": { d: "qgpkiBasicIssuingCA", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.4.1": { d: "qgpkiBasicIssuingClientAuth", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.4.2": { d: "qgpkiBasicIssuingServerAuth", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.1.4.3": { d: "qgpkiBasicIssuingDataSigning", c: "QGPKI policy" },
  "1.2.36.1.3.1.1.1.2": { d: "qgpkiAssuranceLevel", c: "QGPKI assurance level" },
  "1.2.36.1.3.1.1.1.2.1": { d: "qgpkiAssuranceRudimentary", c: "QGPKI assurance level" },
  "1.2.36.1.3.1.1.1.2.2": { d: "qgpkiAssuranceBasic", c: "QGPKI assurance level" },
  "1.2.36.1.3.1.1.1.2.3": { d: "qgpkiAssuranceMedium", c: "QGPKI assurance level" },
  "1.2.36.1.3.1.1.1.2.4": { d: "qgpkiAssuranceHigh", c: "QGPKI assurance level" },
  "1.2.36.1.3.1.1.1.3": { d: "qgpkiCertFunction", c: "QGPKI policies" },
  "1.2.36.1.3.1.1.1.3.1": { d: "qgpkiFunctionIndividual", c: "QGPKI policies" },
  "1.2.36.1.3.1.1.1.3.2": { d: "qgpkiFunctionDevice", c: "QGPKI policies" },
  "1.2.36.1.3.1.1.1.3.3": { d: "qgpkiFunctionAuthorisedParty", c: "QGPKI policies" },
  "1.2.36.1.3.1.1.1.3.4": { d: "qgpkiFunctionDeviceControl", c: "QGPKI policies" },
  "1.2.36.1.3.1.2": { d: "qpspki", c: "Queensland Police PKI" },
  "1.2.36.1.3.1.2.1": { d: "qpspkiPolicies", c: "Queensland Police PKI" },
  "1.2.36.1.3.1.2.1.2": { d: "qpspkiPolicyBasic", c: "Queensland Police PKI" },
  "1.2.36.1.3.1.2.1.3": { d: "qpspkiPolicyMedium", c: "Queensland Police PKI" },
  "1.2.36.1.3.1.2.1.4": { d: "qpspkiPolicyHigh", c: "Queensland Police PKI" },
  "1.2.36.1.3.1.3.2": { d: "qtmrpki", c: "Queensland Transport PKI" },
  "1.2.36.1.3.1.3.2.1": { d: "qtmrpkiPolicies", c: "Queensland Transport PKI" },
  "1.2.36.1.3.1.3.2.2": { d: "qtmrpkiPurpose", c: "Queensland Transport PKI" },
  "1.2.36.1.3.1.3.2.2.1": { d: "qtmrpkiIndividual", c: "Queensland Transport PKI purpose" },
  "1.2.36.1.3.1.3.2.2.2": { d: "qtmrpkiDeviceControl", c: "Queensland Transport PKI purpose" },
  "1.2.36.1.3.1.3.2.2.3": { d: "qtmrpkiDevice", c: "Queensland Transport PKI purpose" },
  "1.2.36.1.3.1.3.2.2.4": { d: "qtmrpkiAuthorisedParty", c: "Queensland Transport PKI purpose" },
  "1.2.36.1.3.1.3.2.2.5": { d: "qtmrpkiDeviceSystem", c: "Queensland Transport PKI purpose" },
  "1.2.36.1.3.1.3.2.3": { d: "qtmrpkiDevice", c: "Queensland Transport PKI" },
  "1.2.36.1.3.1.3.2.3.1": { d: "qtmrpkiDriverLicense", c: "Queensland Transport PKI device" },
  "1.2.36.1.3.1.3.2.3.2": { d: "qtmrpkiIndustryAuthority", c: "Queensland Transport PKI device" },
  "1.2.36.1.3.1.3.2.3.3": { d: "qtmrpkiMarineLicense", c: "Queensland Transport PKI device" },
  "1.2.36.1.3.1.3.2.3.4": { d: "qtmrpkiAdultProofOfAge", c: "Queensland Transport PKI device" },
  "1.2.36.1.3.1.3.2.3.5": { d: "qtmrpkiSam", c: "Queensland Transport PKI device" },
  "1.2.36.1.3.1.3.2.4": { d: "qtmrpkiAuthorisedParty", c: "Queensland Transport PKI" },
  "1.2.36.1.3.1.3.2.4.1": { d: "qtmrpkiTransportInspector", c: "Queensland Transport PKI authorised party" },
  "1.2.36.1.3.1.3.2.4.2": { d: "qtmrpkiPoliceOfficer", c: "Queensland Transport PKI authorised party" },
  "1.2.36.1.3.1.3.2.4.3": { d: "qtmrpkiSystem", c: "Queensland Transport PKI authorised party" },
  "1.2.36.1.3.1.3.2.4.4": { d: "qtmrpkiLiquorLicensingInspector", c: "Queensland Transport PKI authorised party" },
  "1.2.36.1.3.1.3.2.4.5": { d: "qtmrpkiMarineEnforcementOfficer", c: "Queensland Transport PKI authorised party" },
  "1.2.36.1.333.1": { d: "australianBusinessNumber", c: "Australian Government corporate taxpayer ID" },
  "1.2.36.68980861.1.1.2": { d: "signetPersonal", c: "Signet CA" },
  "1.2.36.68980861.1.1.3": { d: "signetBusiness", c: "Signet CA" },
  "1.2.36.68980861.1.1.4": { d: "signetLegal", c: "Signet CA" },
  "1.2.36.68980861.1.1.10": { d: "signetPilot", c: "Signet CA" },
  "1.2.36.68980861.1.1.11": { d: "signetIntraNet", c: "Signet CA" },
  "1.2.36.68980861.1.1.20": { d: "signetPolicy", c: "Signet CA" },
  "1.2.36.75878867.1.100.1.1": { d: "certificatesAustraliaPolicy", c: "Certificates Australia CA" },
  "1.2.156.10197.1": { d: "gmtCryptographicAlgorithm", c: "China GM Standards Committee" },
  "1.2.156.10197.1.100": { d: "gmtBlockCipher", c: "China GM Standards Committee" },
  "1.2.156.10197.1.102": { d: "sm1Cipher", c: "China GM Standards Committee" },
  "1.2.156.10197.1.103": { d: "ssf33Cipher", c: "China GM Standards Committee" },
  "1.2.156.10197.1.104": { d: "sm4Cipher", c: "China GM Standards Committee" },
  "1.2.156.10197.1.200": { d: "gmtStreamCipher", c: "China GM Standards Committee" },
  "1.2.156.10197.1.201": { d: "zucCipher", c: "China GM Standards Committee" },
  "1.2.156.10197.1.300": { d: "gmtPublicKeyCryptography", c: "China GM Standards Committee" },
  "1.2.156.10197.1.301": { d: "sm2ECC", c: "China GM Standards Committee" },
  "1.2.156.10197.1.301.1": { d: "sm2-1DigitalSignature", c: "China GM Standards Committee" },
  "1.2.156.10197.1.301.2": { d: "sm2-2KeyExchange", c: "China GM Standards Committee" },
  "1.2.156.10197.1.301.3": { d: "sm2-3PublicKeyEncryption", c: "China GM Standards Committee" },
  "1.2.156.10197.1.302": { d: "gmtSM9IBE", c: "China GM Standards Committee" },
  "1.2.156.10197.1.302.1": { d: "sm9-1DigitalSignature", c: "China GM Standards Committee" },
  "1.2.156.10197.1.302.2": { d: "sm9-2KeyExchange", c: "China GM Standards Committee" },
  "1.2.156.10197.1.302.3": { d: "sm9-3PublicKeyEncryption", c: "China GM Standards Committee" },
  "1.2.156.10197.1.400": { d: "gmtHashAlgorithm", c: "China GM Standards Committee" },
  "1.2.156.10197.1.401": { d: "sm3Hash", c: "China GM Standards Committee" },
  "1.2.156.10197.1.401.1": { d: "sm3HashWithoutKey", c: "China GM Standards Committee" },
  "1.2.156.10197.1.401.2": { d: "sm3HashWithKey", c: "China GM Standards Committee" },
  "1.2.156.10197.1.500": { d: "gmtDigestSigning", c: "China GM Standards Committee" },
  "1.2.156.10197.1.501": { d: "sm2withSM3", c: "China GM Standards Committee" },
  "1.2.156.10197.1.504": { d: "rsaWithSM3", c: "China GM Standards Committee" },
  "1.2.156.10197.4.3": { d: "gmtCertificateAuthority", c: "China GM Standards Committee" },
  "1.2.156.10197.6": { d: "gmtStandardClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1": { d: "gmtFoundationClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.1": { d: "gmtAlgorithmClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.1.1": { d: "zucStandard", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.1.2": { d: "sm4Standard", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.1.3": { d: "sm2Standard", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.1.4": { d: "sm3Standard", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.2": { d: "gmtIDClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.2.1": { d: "gmtCryptoID", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.3": { d: "gmtOperationModes", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.4": { d: "gmtSecurityMechanism", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.4.1": { d: "gmtSM2Specification", c: "China GM Standards Committee" },
  "1.2.156.10197.6.1.4.2": { d: "gmtSM2CryptographicMessageSyntax", c: "China GM Standards Committee" },
  "1.2.156.10197.6.2": { d: "gmtDeviceClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.3": { d: "gmtServiceClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.4": { d: "gmtInfrastructure", c: "China GM Standards Committee" },
  "1.2.156.10197.6.5": { d: "gmtTestingClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.5.1": { d: "gmtRandomTestingClass", c: "China GM Standards Committee" },
  "1.2.156.10197.6.6": { d: "gmtManagementClass", c: "China GM Standards Committee" },
  "1.2.392.200011.61.1.1.1": { d: "mitsubishiSecurityAlgorithm", c: "Mitsubishi security algorithm" },
  "1.2.392.200011.61.1.1.1.1": { d: "misty1-cbc", c: "Mitsubishi security algorithm" },
  "1.2.410.200004.1": { d: "kisaAlgorithm", c: "KISA algorithm" },
  "1.2.410.200004.1.1": { d: "kcdsa", c: "Korean DSA" },
  "1.2.410.200004.1.2": { d: "has160", c: "Korean hash algorithm" },
  "1.2.410.200004.1.3": { d: "seedECB", c: "Korean SEED algorithm, ECB mode" },
  "1.2.410.200004.1.4": { d: "seedCBC", c: "Korean SEED algorithm, CBC mode" },
  "1.2.410.200004.1.5": { d: "seedOFB", c: "Korean SEED algorithm, OFB mode" },
  "1.2.410.200004.1.6": { d: "seedCFB", c: "Korean SEED algorithm, CFB mode" },
  "1.2.410.200004.1.7": { d: "seedMAC", c: "Korean SEED algorithm, MAC mode" },
  "1.2.410.200004.1.8": { d: "kcdsaWithHAS160", c: "Korean signature algorithm" },
  "1.2.410.200004.1.9": { d: "kcdsaWithSHA1", c: "Korean signature algorithm" },
  "1.2.410.200004.1.10": { d: "pbeWithHAS160AndSEED-ECB", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.11": { d: "pbeWithHAS160AndSEED-CBC", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.12": { d: "pbeWithHAS160AndSEED-CFB", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.13": { d: "pbeWithHAS160AndSEED-OFB", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.14": { d: "pbeWithSHA1AndSEED-ECB", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.15": { d: "pbeWithSHA1AndSEED-CBC", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.16": { d: "pbeWithSHA1AndSEED-CFB", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.17": { d: "pbeWithSHA1AndSEED-OFB", c: "Korean SEED algorithm, PBE key derivation" },
  "1.2.410.200004.1.20": { d: "rsaWithHAS160", c: "Korean signature algorithm" },
  "1.2.410.200004.1.21": { d: "kcdsa1", c: "Korean DSA" },
  "1.2.410.200004.2": { d: "npkiCP", c: "KISA NPKI certificate policies" },
  "1.2.410.200004.2.1": { d: "npkiSignaturePolicy", c: "KISA NPKI certificate policies" },
  "1.2.410.200004.3": { d: "npkiKP", c: "KISA NPKI key usage" },
  "1.2.410.200004.4": { d: "npkiAT", c: "KISA NPKI attribute" },
  "1.2.410.200004.5": { d: "npkiLCA", c: "KISA NPKI licensed CA" },
  "1.2.410.200004.5.1": { d: "npkiSignKorea", c: "KISA NPKI licensed CA" },
  "1.2.410.200004.5.2": { d: "npkiSignGate", c: "KISA NPKI licensed CA" },
  "1.2.410.200004.5.3": { d: "npkiNcaSign", c: "KISA NPKI licensed CA" },
  "1.2.410.200004.6": { d: "npkiON", c: "KISA NPKI otherName" },
  "1.2.410.200004.7": { d: "npkiAPP", c: "KISA NPKI application" },
  "1.2.410.200004.7.1": { d: "npkiSMIME", c: "KISA NPKI application" },
  "1.2.410.200004.7.1.1": { d: "npkiSMIMEAlgo", c: "KISA NPKI application" },
  "1.2.410.200004.7.1.1.1": { d: "npkiCmsSEEDWrap", c: "KISA NPKI application" },
  "1.2.410.200004.10": { d: "npki", c: "KISA NPKI" },
  "1.2.410.200004.10.1": { d: "npkiAttribute", c: "KISA NPKI attribute" },
  "1.2.410.200004.10.1.1": { d: "npkiIdentifyData", c: "KISA NPKI attribute" },
  "1.2.410.200004.10.1.1.1": { d: "npkiVID", c: "KISA NPKI attribute" },
  "1.2.410.200004.10.1.1.2": { d: "npkiEncryptedVID", c: "KISA NPKI attribute" },
  "1.2.410.200004.10.1.1.3": { d: "npkiRandomNum", c: "KISA NPKI attribute" },
  "1.2.410.200004.10.1.1.4": { d: "npkiVID", c: "KISA NPKI attribute" },
  "1.2.410.200046.1.1": { d: "aria1AlgorithmModes", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.1": { d: "aria128-ecb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.2": { d: "aria128-cbc", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.3": { d: "aria128-cfb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.4": { d: "aria128-ofb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.5": { d: "aria128-ctr", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.6": { d: "aria192-ecb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.7": { d: "aria192-cbc", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.8": { d: "aria192-cfb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.9": { d: "aria192-ofb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.10": { d: "aria192-ctr", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.11": { d: "aria256-ecb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.12": { d: "aria256-cbc", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.13": { d: "aria256-cfb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.14": { d: "aria256-ofb", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.15": { d: "aria256-ctr", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.21": { d: "aria128-cmac", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.22": { d: "aria192-cmac", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.23": { d: "aria256-cmac", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.31": { d: "aria128-ocb2", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.32": { d: "aria192-ocb2", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.33": { d: "aria256-ocb2", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.34": { d: "aria128-gcm", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.35": { d: "aria192-gcm", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.36": { d: "aria256-gcm", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.37": { d: "aria128-ccm", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.38": { d: "aria192-ccm", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.39": { d: "aria256-ccm", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.40": { d: "aria128-keywrap", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.41": { d: "aria192-keywrap", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.42": { d: "aria256-keywrap", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.43": { d: "aria128-keywrapWithPad", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.44": { d: "aria192-keywrapWithPad", c: "ARIA algorithm modes" },
  "1.2.410.200046.1.1.45": { d: "aria256-keywrapWithPad", c: "ARIA algorithm modes" },
  "1.2.643.2.2.3": { d: "gostSignature", c: "GOST R 34.10-2001 + GOST R 34.11-94 signature" },
  "1.2.643.2.2.4": { d: "gost94Signature", c: "GOST R 34.10-94 + GOST R 34.11-94 signature. Obsoleted by GOST R 34.10-2001", w: !0 },
  "1.2.643.2.2.19": { d: "gostPublicKey", c: "GOST R 34.10-2001 (ECC) public key" },
  "1.2.643.2.2.20": { d: "gost94PublicKey", c: "GOST R 34.10-94 public key. Obsoleted by GOST R 34.10-2001", w: !0 },
  "1.2.643.2.2.21": { d: "gostCipher", c: "GOST 28147-89 (symmetric key block cipher)" },
  "1.2.643.2.2.31.0": { d: "testCipherParams", c: "Test params for GOST 28147-89" },
  "1.2.643.2.2.31.1": { d: "cryptoProCipherA", c: "CryptoPro params A (default, variant 'Verba-O') for GOST 28147-89" },
  "1.2.643.2.2.31.2": { d: "cryptoProCipherB", c: "CryptoPro params B (variant 1) for GOST 28147-89" },
  "1.2.643.2.2.31.3": { d: "cryptoProCipherC", c: "CryptoPro params C (variant 2) for GOST 28147-89" },
  "1.2.643.2.2.31.4": { d: "cryptoProCipherD", c: "CryptoPro params D (variant 3) for GOST 28147-89" },
  "1.2.643.2.2.31.5": { d: "oscar11Cipher", c: "Oscar-1.1 params for GOST 28147-89" },
  "1.2.643.2.2.31.6": { d: "oscar10Cipher", c: "Oscar-1.0 params for GOST 28147-89" },
  "1.2.643.2.2.31.7": { d: "ric1Cipher", c: "RIC-1 params for GOST 28147-89" },
  "1.2.643.2.2.31.12": { d: "tc26CipherA", c: "TC26 params 2 for GOST 28147-89" },
  "1.2.643.2.2.31.13": { d: "tc26CipherB", c: "TC26 params 1 for GOST 28147-89" },
  "1.2.643.2.2.31.14": { d: "tc26CipherC", c: "TC26 params 3 for GOST 28147-89" },
  "1.2.643.2.2.31.15": { d: "tc26CipherD", c: "TC26 params 4 for GOST 28147-89" },
  "1.2.643.2.2.31.16": { d: "tc26CipherE", c: "TC26 params 5 for GOST 28147-89" },
  "1.2.643.2.2.31.17": { d: "tc26CipherF", c: "TC26 params 6 for GOST 28147-89" },
  "1.2.643.7.1.2.5.1.1": { d: "tc26CipherZ", c: "TC26 params Z for GOST 28147-89" },
  "1.2.643.2.2.9": { d: "gostDigest", c: "GOST R 34.11-94 digest" },
  "1.2.643.2.2.30.0": { d: "testDigestParams", c: "Test params for GOST R 34.11-94" },
  "1.2.643.2.2.30.1": { d: "cryptoProDigestA", c: "CryptoPro digest params A (default, variant 'Verba-O') for GOST R 34.11-94" },
  "1.2.643.2.2.30.2": { d: "cryptoProDigestB", c: "CryptoPro digest params B (variant 1) for GOST R 34.11-94" },
  "1.2.643.2.2.30.3": { d: "cryptoProDigestC", c: "CryptoPro digest params C (variant 2) for GOST R 34.11-94" },
  "1.2.643.2.2.30.4": { d: "cryptoProDigestD", c: "CryptoPro digest params D (variant 3) for GOST R 34.11-94" },
  "1.2.643.2.2.32.2": { d: "cryptoPro94SignA", c: "CryptoPro sign params A (default, variant 'Verba-O') for GOST R 34.10-94" },
  "1.2.643.2.2.32.3": { d: "cryptoPro94SignB", c: "CryptoPro sign params B (variant 1) for GOST R 34.10-94" },
  "1.2.643.2.2.32.4": { d: "cryptoPro94SignC", c: "CryptoPro sign params C (variant 2) for GOST R 34.10-94" },
  "1.2.643.2.2.32.5": { d: "cryptoPro94SignD", c: "CryptoPro sign params D (variant 3) for GOST R 34.10-94" },
  "1.2.643.2.2.33.1": { d: "cryptoPro94SignXA", c: "CryptoPro sign params XA (variant 1) for GOST R 34.10-94" },
  "1.2.643.2.2.33.2": { d: "cryptoPro94SignXB", c: "CryptoPro sign params XB (variant 2) for GOST R 34.10-94" },
  "1.2.643.2.2.33.3": { d: "cryptoPro94SignXC", c: "CryptoPro sign params XC (variant 3) for GOST R 34.10-94" },
  "1.2.643.2.2.35.0": { d: "testSignParams", c: "Test elliptic curve for GOST R 34.10-2001" },
  "1.2.643.2.2.35.1": { d: "cryptoProSignA", c: "CryptoPro ell.curve A for GOST R 34.10-2001" },
  "1.2.643.2.2.35.2": { d: "cryptoProSignB", c: "CryptoPro ell.curve B for GOST R 34.10-2001" },
  "1.2.643.2.2.35.3": { d: "cryptoProSignC", c: "CryptoPro ell.curve C for GOST R 34.10-2001" },
  "1.2.643.2.2.36.0": { d: "cryptoProSignXA", c: "CryptoPro ell.curve XA for GOST R 34.10-2001" },
  "1.2.643.2.2.36.1": { d: "cryptoProSignXB", c: "CryptoPro ell.curve XB for GOST R 34.10-2001" },
  "1.2.643.7.1.2.1.1.1": { d: "cryptoPro2012Sign256A", c: "CryptoPro ell.curve A for GOST R 34.10-2012 256 bit" },
  "1.2.643.7.1.2.1.2.1": { d: "cryptoPro2012Sign512A", c: "CryptoPro ell.curve A (default) for GOST R 34.10-2012 512 bit" },
  "1.2.643.7.1.2.1.2.2": { d: "cryptoPro2012Sign512B", c: "CryptoPro ell.curve B for GOST R 34.10-2012 512 bit" },
  "1.2.643.7.1.2.1.2.3": { d: "cryptoPro2012Sign512C", c: "CryptoPro ell.curve C for GOST R 34.10-2012 512 bit" },
  "1.2.643.2.2.14.0": { d: "nullMeshing", c: "Do not mesh state of GOST 28147-89 cipher" },
  "1.2.643.2.2.14.1": { d: "cryptoProMeshing", c: "CryptoPro meshing of state of GOST 28147-89 cipher" },
  "1.2.643.2.2.10": { d: "hmacGost", c: "HMAC with GOST R 34.11-94" },
  "1.2.643.2.2.13.0": { d: "gostWrap", c: "Wrap key using GOST 28147-89 key" },
  "1.2.643.2.2.13.1": { d: "cryptoProWrap", c: "Wrap key using diversified GOST 28147-89 key" },
  "1.2.643.2.2.96": { d: "cryptoProECDHWrap", c: "Wrap key using ECC DH on GOST R 34.10-2001 keys (VKO)" },
  "1.2.643.7.1.1.1.1": { d: "gost2012PublicKey256", c: "GOST R 34.10-2012 256 bit public key" },
  "1.2.643.7.1.1.1.2": { d: "gost2012PublicKey512", c: "GOST R 34.10-2012 512 bit public key" },
  "1.2.643.7.1.1.2.2": { d: "gost2012Digest256", c: "GOST R 34.11-2012 256 bit digest" },
  "1.2.643.7.1.1.2.3": { d: "gost2012Digest512", c: "GOST R 34.11-2012 512 bit digest" },
  "1.2.643.7.1.1.3.2": { d: "gost2012Signature256", c: "GOST R 34.10-2012 256 bit signature" },
  "1.2.643.7.1.1.3.3": { d: "gost2012Signature512", c: "GOST R 34.10-2012 512 bit signature" },
  "1.2.643.7.1.1.6.1": { d: "cryptoProECDH256", c: "CryptoPro ECC DH algorithm for GOST R 34.10-2012 256 bit key" },
  "1.2.643.7.1.1.6.2": { d: "cryptoProECDH512", c: "CryptoPro ECC DH algorithm for GOST R 34.10-2012 512 bit key" },
  "1.2.752.34.1": { d: "seis-cp", c: "SEIS Project" },
  "1.2.752.34.1.1": { d: "SEIS high-assurance policyIdentifier", c: "SEIS Project certificate policies" },
  "1.2.752.34.1.2": { d: "SEIS GAK policyIdentifier", c: "SEIS Project certificate policies" },
  "1.2.752.34.2": { d: "SEIS pe", c: "SEIS Project" },
  "1.2.752.34.3": { d: "SEIS at", c: "SEIS Project" },
  "1.2.752.34.3.1": { d: "SEIS at-personalIdentifier", c: "SEIS Project attribute" },
  "1.2.840.10040.1": { d: "module", c: "ANSI X9.57" },
  "1.2.840.10040.1.1": { d: "x9f1-cert-mgmt", c: "ANSI X9.57 module" },
  "1.2.840.10040.2": { d: "holdinstruction", c: "ANSI X9.57" },
  "1.2.840.10040.2.1": { d: "holdinstruction-none", c: "ANSI X9.57 hold instruction" },
  "1.2.840.10040.2.2": { d: "callissuer", c: "ANSI X9.57 hold instruction" },
  "1.2.840.10040.2.3": { d: "reject", c: "ANSI X9.57 hold instruction" },
  "1.2.840.10040.2.4": { d: "pickupToken", c: "ANSI X9.57 hold instruction" },
  "1.2.840.10040.3": { d: "attribute", c: "ANSI X9.57" },
  "1.2.840.10040.3.1": { d: "countersignature", c: "ANSI X9.57 attribute" },
  "1.2.840.10040.3.2": { d: "attribute-cert", c: "ANSI X9.57 attribute" },
  "1.2.840.10040.4": { d: "algorithm", c: "ANSI X9.57" },
  "1.2.840.10040.4.1": { d: "dsa", c: "ANSI X9.57 algorithm" },
  "1.2.840.10040.4.2": { d: "dsa-match", c: "ANSI X9.57 algorithm" },
  "1.2.840.10040.4.3": { d: "dsaWithSha1", c: "ANSI X9.57 algorithm" },
  "1.2.840.10045.1": { d: "fieldType", c: "ANSI X9.62. This OID is also assigned as ecdsa-with-SHA1" },
  "1.2.840.10045.1.1": { d: "prime-field", c: "ANSI X9.62 field type" },
  "1.2.840.10045.1.2": { d: "characteristic-two-field", c: "ANSI X9.62 field type" },
  "1.2.840.10045.1.2.3": { d: "characteristic-two-basis", c: "ANSI X9.62 field type" },
  "1.2.840.10045.1.2.3.1": { d: "onBasis", c: "ANSI X9.62 field basis" },
  "1.2.840.10045.1.2.3.2": { d: "tpBasis", c: "ANSI X9.62 field basis" },
  "1.2.840.10045.1.2.3.3": { d: "ppBasis", c: "ANSI X9.62 field basis" },
  "1.2.840.10045.2": { d: "publicKeyType", c: "ANSI X9.62" },
  "1.2.840.10045.2.1": { d: "ecPublicKey", c: "ANSI X9.62 public key type" },
  "1.2.840.10045.3.0.1": { d: "c2pnb163v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.2": { d: "c2pnb163v2", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.3": { d: "c2pnb163v3", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.5": { d: "c2tnb191v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.6": { d: "c2tnb191v2", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.7": { d: "c2tnb191v3", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.10": { d: "c2pnb208w1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.11": { d: "c2tnb239v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.12": { d: "c2tnb239v2", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.13": { d: "c2tnb239v3", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.16": { d: "c2pnb272w1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.18": { d: "c2tnb359v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.19": { d: "c2pnb368w1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.0.20": { d: "c2tnb431r1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.1": { d: "prime192v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.2": { d: "prime192v2", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.3": { d: "prime192v3", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.4": { d: "prime239v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.5": { d: "prime239v2", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.6": { d: "prime239v3", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.3.1.7": { d: "prime256v1", c: "ANSI X9.62 named elliptic curve" },
  "1.2.840.10045.4.1": { d: "ecdsaWithSHA1", c: "ANSI X9.62 ECDSA algorithm with SHA1" },
  "1.2.840.10045.4.2": { d: "ecdsaWithRecommended", c: "ANSI X9.62 ECDSA algorithm with Recommended" },
  "1.2.840.10045.4.3": { d: "ecdsaWithSpecified", c: "ANSI X9.62 ECDSA algorithm with Specified" },
  "1.2.840.10045.4.3.1": { d: "ecdsaWithSHA224", c: "ANSI X9.62 ECDSA algorithm with SHA224" },
  "1.2.840.10045.4.3.2": { d: "ecdsaWithSHA256", c: "ANSI X9.62 ECDSA algorithm with SHA256" },
  "1.2.840.10045.4.3.3": { d: "ecdsaWithSHA384", c: "ANSI X9.62 ECDSA algorithm with SHA384" },
  "1.2.840.10045.4.3.4": { d: "ecdsaWithSHA512", c: "ANSI X9.62 ECDSA algorithm with SHA512" },
  "1.2.840.10046.1": { d: "fieldType", c: "ANSI X9.42" },
  "1.2.840.10046.1.1": { d: "gf-prime", c: "ANSI X9.42 field type" },
  "1.2.840.10046.2": { d: "numberType", c: "ANSI X9.42" },
  "1.2.840.10046.2.1": { d: "dhPublicKey", c: "ANSI X9.42 number type" },
  "1.2.840.10046.3": { d: "scheme", c: "ANSI X9.42" },
  "1.2.840.10046.3.1": { d: "dhStatic", c: "ANSI X9.42 scheme" },
  "1.2.840.10046.3.2": { d: "dhEphem", c: "ANSI X9.42 scheme" },
  "1.2.840.10046.3.3": { d: "dhHybrid1", c: "ANSI X9.42 scheme" },
  "1.2.840.10046.3.4": { d: "dhHybrid2", c: "ANSI X9.42 scheme" },
  "1.2.840.10046.3.5": { d: "mqv2", c: "ANSI X9.42 scheme" },
  "1.2.840.10046.3.6": { d: "mqv1", c: "ANSI X9.42 scheme" },
  "1.2.840.10065.2.2": { d: "?", c: "ASTM 31.20" },
  "1.2.840.10065.2.3": { d: "healthcareLicense", c: "ASTM 31.20" },
  "1.2.840.10065.2.3.1.1": { d: "license?", c: "ASTM 31.20 healthcare license type" },
  "1.2.840.10070": { d: "iec62351", c: "IEC 62351" },
  "1.2.840.10070.8": { d: "iec62351_8", c: "IEC 62351-8" },
  "1.2.840.10070.8.1": { d: "iecUserRoles", c: "IEC 62351-8" },
  "1.2.840.113533.7": { d: "nsn", c: "" },
  "1.2.840.113533.7.65": { d: "nsn-ce", c: "" },
  "1.2.840.113533.7.65.0": { d: "entrustVersInfo", c: "Nortel Secure Networks ce" },
  "1.2.840.113533.7.66": { d: "nsn-alg", c: "" },
  "1.2.840.113533.7.66.3": { d: "cast3CBC", c: "Nortel Secure Networks alg" },
  "1.2.840.113533.7.66.10": { d: "cast5CBC", c: "Nortel Secure Networks alg" },
  "1.2.840.113533.7.66.11": { d: "cast5MAC", c: "Nortel Secure Networks alg" },
  "1.2.840.113533.7.66.12": { d: "pbeWithMD5AndCAST5-CBC", c: "Nortel Secure Networks alg" },
  "1.2.840.113533.7.66.13": { d: "passwordBasedMac", c: "Nortel Secure Networks alg" },
  "1.2.840.113533.7.67": { d: "nsn-oc", c: "" },
  "1.2.840.113533.7.67.0": { d: "entrustUser", c: "Nortel Secure Networks oc" },
  "1.2.840.113533.7.68": { d: "nsn-at", c: "" },
  "1.2.840.113533.7.68.0": { d: "entrustCAInfo", c: "Nortel Secure Networks at" },
  "1.2.840.113533.7.68.10": { d: "attributeCertificate", c: "Nortel Secure Networks at" },
  "1.2.840.113549.1.1": { d: "pkcs-1", c: "" },
  "1.2.840.113549.1.1.1": { d: "rsaEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.2": { d: "md2WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.3": { d: "md4WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.4": { d: "md5WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.5": { d: "sha1WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.7": { d: "rsaOAEP", c: "PKCS #1" },
  "1.2.840.113549.1.1.8": { d: "pkcs1-MGF", c: "PKCS #1" },
  "1.2.840.113549.1.1.9": { d: "rsaOAEP-pSpecified", c: "PKCS #1" },
  "1.2.840.113549.1.1.10": { d: "rsaPSS", c: "PKCS #1" },
  "1.2.840.113549.1.1.11": { d: "sha256WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.12": { d: "sha384WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.13": { d: "sha512WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.14": { d: "sha224WithRSAEncryption", c: "PKCS #1" },
  "1.2.840.113549.1.1.6": { d: "rsaOAEPEncryptionSET", c: "PKCS #1. This OID may also be assigned as ripemd160WithRSAEncryption" },
  "1.2.840.113549.1.2": { d: "bsafeRsaEncr", c: "Obsolete BSAFE OID", w: !0 },
  "1.2.840.113549.1.3": { d: "pkcs-3", c: "" },
  "1.2.840.113549.1.3.1": { d: "dhKeyAgreement", c: "PKCS #3" },
  "1.2.840.113549.1.5": { d: "pkcs-5", c: "" },
  "1.2.840.113549.1.5.1": { d: "pbeWithMD2AndDES-CBC", c: "PKCS #5" },
  "1.2.840.113549.1.5.3": { d: "pbeWithMD5AndDES-CBC", c: "PKCS #5" },
  "1.2.840.113549.1.5.4": { d: "pbeWithMD2AndRC2-CBC", c: "PKCS #5" },
  "1.2.840.113549.1.5.6": { d: "pbeWithMD5AndRC2-CBC", c: "PKCS #5" },
  "1.2.840.113549.1.5.9": { d: "pbeWithMD5AndXOR", c: "PKCS #5, used in BSAFE only", w: !0 },
  "1.2.840.113549.1.5.10": { d: "pbeWithSHAAndDES-CBC", c: "PKCS #5" },
  "1.2.840.113549.1.5.12": { d: "pkcs5PBKDF2", c: "PKCS #5 v2.0" },
  "1.2.840.113549.1.5.13": { d: "pkcs5PBES2", c: "PKCS #5 v2.0" },
  "1.2.840.113549.1.5.14": { d: "pkcs5PBMAC1", c: "PKCS #5 v2.0" },
  "1.2.840.113549.1.7": { d: "pkcs-7", c: "" },
  "1.2.840.113549.1.7.1": { d: "data", c: "PKCS #7" },
  "1.2.840.113549.1.7.2": { d: "signedData", c: "PKCS #7" },
  "1.2.840.113549.1.7.3": { d: "envelopedData", c: "PKCS #7" },
  "1.2.840.113549.1.7.4": { d: "signedAndEnvelopedData", c: "PKCS #7" },
  "1.2.840.113549.1.7.5": { d: "digestedData", c: "PKCS #7" },
  "1.2.840.113549.1.7.6": { d: "encryptedData", c: "PKCS #7" },
  "1.2.840.113549.1.7.7": { d: "dataWithAttributes", c: "PKCS #7 experimental", w: !0 },
  "1.2.840.113549.1.7.8": { d: "encryptedPrivateKeyInfo", c: "PKCS #7 experimental", w: !0 },
  "1.2.840.113549.1.9": { d: "pkcs-9", c: "" },
  "1.2.840.113549.1.9.1": { d: "emailAddress", c: "PKCS #9. Deprecated, use an altName extension instead" },
  "1.2.840.113549.1.9.2": { d: "unstructuredName", c: "PKCS #9" },
  "1.2.840.113549.1.9.3": { d: "contentType", c: "PKCS #9" },
  "1.2.840.113549.1.9.4": { d: "messageDigest", c: "PKCS #9" },
  "1.2.840.113549.1.9.5": { d: "signingTime", c: "PKCS #9" },
  "1.2.840.113549.1.9.6": { d: "countersignature", c: "PKCS #9" },
  "1.2.840.113549.1.9.7": { d: "challengePassword", c: "PKCS #9" },
  "1.2.840.113549.1.9.8": { d: "unstructuredAddress", c: "PKCS #9" },
  "1.2.840.113549.1.9.9": { d: "extendedCertificateAttributes", c: "PKCS #9" },
  "1.2.840.113549.1.9.10": { d: "issuerAndSerialNumber", c: "PKCS #9 experimental", w: !0 },
  "1.2.840.113549.1.9.11": { d: "passwordCheck", c: "PKCS #9 experimental", w: !0 },
  "1.2.840.113549.1.9.12": { d: "publicKey", c: "PKCS #9 experimental", w: !0 },
  "1.2.840.113549.1.9.13": { d: "signingDescription", c: "PKCS #9" },
  "1.2.840.113549.1.9.14": { d: "extensionRequest", c: "PKCS #9 via CRMF" },
  "1.2.840.113549.1.9.15": { d: "sMIMECapabilities", c: "PKCS #9. This OID was formerly assigned as symmetricCapabilities, then reassigned as SMIMECapabilities, then renamed to the current name" },
  "1.2.840.113549.1.9.15.1": { d: "preferSignedData", c: "sMIMECapabilities" },
  "1.2.840.113549.1.9.15.2": { d: "canNotDecryptAny", c: "sMIMECapabilities" },
  "1.2.840.113549.1.9.15.3": { d: "receiptRequest", c: "sMIMECapabilities. Deprecated, use (1 2 840 113549 1 9 16 2 1) instead", w: !0 },
  "1.2.840.113549.1.9.15.4": { d: "receipt", c: "sMIMECapabilities. Deprecated, use (1 2 840 113549 1 9 16 1 1) instead", w: !0 },
  "1.2.840.113549.1.9.15.5": { d: "contentHints", c: "sMIMECapabilities. Deprecated, use (1 2 840 113549 1 9 16 2 4) instead", w: !0 },
  "1.2.840.113549.1.9.15.6": { d: "mlExpansionHistory", c: "sMIMECapabilities. Deprecated, use (1 2 840 113549 1 9 16 2 3) instead", w: !0 },
  "1.2.840.113549.1.9.16": { d: "id-sMIME", c: "PKCS #9" },
  "1.2.840.113549.1.9.16.0": { d: "id-mod", c: "id-sMIME" },
  "1.2.840.113549.1.9.16.0.1": { d: "id-mod-cms", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.2": { d: "id-mod-ess", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.3": { d: "id-mod-oid", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.4": { d: "id-mod-msg-v3", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.5": { d: "id-mod-ets-eSignature-88", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.6": { d: "id-mod-ets-eSignature-97", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.7": { d: "id-mod-ets-eSigPolicy-88", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.0.8": { d: "id-mod-ets-eSigPolicy-88", c: "S/MIME Modules" },
  "1.2.840.113549.1.9.16.1": { d: "contentType", c: "S/MIME" },
  "1.2.840.113549.1.9.16.1.1": { d: "receipt", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.2": { d: "authData", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.3": { d: "publishCert", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.4": { d: "tSTInfo", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.5": { d: "tDTInfo", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.6": { d: "contentInfo", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.7": { d: "dVCSRequestData", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.8": { d: "dVCSResponseData", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.9": { d: "compressedData", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.10": { d: "scvpCertValRequest", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.11": { d: "scvpCertValResponse", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.12": { d: "scvpValPolRequest", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.13": { d: "scvpValPolResponse", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.14": { d: "attrCertEncAttrs", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.15": { d: "tSReq", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.16": { d: "firmwarePackage", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.17": { d: "firmwareLoadReceipt", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.18": { d: "firmwareLoadError", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.19": { d: "contentCollection", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.20": { d: "contentWithAttrs", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.21": { d: "encKeyWithID", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.22": { d: "encPEPSI", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.23": { d: "authEnvelopedData", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.24": { d: "routeOriginAttest", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.25": { d: "symmetricKeyPackage", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.26": { d: "rpkiManifest", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.27": { d: "asciiTextWithCRLF", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.28": { d: "xml", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.29": { d: "pdf", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.30": { d: "postscript", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.31": { d: "timestampedData", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.32": { d: "asAdjacencyAttest", c: "S/MIME Content Types", w: !0 },
  "1.2.840.113549.1.9.16.1.33": { d: "rpkiTrustAnchor", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.1.34": { d: "trustAnchorList", c: "S/MIME Content Types" },
  "1.2.840.113549.1.9.16.2": { d: "authenticatedAttributes", c: "S/MIME" },
  "1.2.840.113549.1.9.16.2.1": { d: "receiptRequest", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.2": { d: "securityLabel", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.3": { d: "mlExpandHistory", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.4": { d: "contentHint", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.5": { d: "msgSigDigest", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.6": { d: "encapContentType", c: "S/MIME Authenticated Attributes.  Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.2.7": { d: "contentIdentifier", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.8": { d: "macValue", c: "S/MIME Authenticated Attributes.  Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.2.9": { d: "equivalentLabels", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.10": { d: "contentReference", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.11": { d: "encrypKeyPref", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.12": { d: "signingCertificate", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.13": { d: "smimeEncryptCerts", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.14": { d: "timeStampToken", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.15": { d: "sigPolicyId", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.16": { d: "commitmentType", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.17": { d: "signerLocation", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.18": { d: "signerAttr", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.19": { d: "otherSigCert", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.20": { d: "contentTimestamp", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.21": { d: "certificateRefs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.22": { d: "revocationRefs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.23": { d: "certValues", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.24": { d: "revocationValues", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.25": { d: "escTimeStamp", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.26": { d: "certCRLTimestamp", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.27": { d: "archiveTimeStamp", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.28": { d: "signatureType", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.29": { d: "dvcsDvc", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.30": { d: "cekReference", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.31": { d: "maxCEKDecrypts", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.32": { d: "kekDerivationAlg", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.33": { d: "intendedRecipients", c: "S/MIME Authenticated Attributes.  Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.2.34": { d: "cmcUnsignedData", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.35": { d: "fwPackageID", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.36": { d: "fwTargetHardwareIDs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.37": { d: "fwDecryptKeyID", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.38": { d: "fwImplCryptAlgs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.39": { d: "fwWrappedFirmwareKey", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.40": { d: "fwCommunityIdentifiers", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.41": { d: "fwPkgMessageDigest", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.42": { d: "fwPackageInfo", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.43": { d: "fwImplCompressAlgs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.44": { d: "etsAttrCertificateRefs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.45": { d: "etsAttrRevocationRefs", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.46": { d: "binarySigningTime", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.47": { d: "signingCertificateV2", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.48": { d: "etsArchiveTimeStampV2", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.49": { d: "erInternal", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.50": { d: "erExternal", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.2.51": { d: "multipleSignatures", c: "S/MIME Authenticated Attributes" },
  "1.2.840.113549.1.9.16.3.1": { d: "esDHwith3DES", c: "S/MIME Algorithms. Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.3.2": { d: "esDHwithRC2", c: "S/MIME Algorithms. Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.3.3": { d: "3desWrap", c: "S/MIME Algorithms. Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.3.4": { d: "rc2Wrap", c: "S/MIME Algorithms. Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.3.5": { d: "esDH", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.6": { d: "cms3DESwrap", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.7": { d: "cmsRC2wrap", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.8": { d: "zlib", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.9": { d: "pwriKEK", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.10": { d: "ssDH", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.11": { d: "hmacWith3DESwrap", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.12": { d: "hmacWithAESwrap", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.13": { d: "md5XorExperiment", c: "S/MIME Algorithms.  Experimental", w: !0 },
  "1.2.840.113549.1.9.16.3.14": { d: "rsaKEM", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.15": { d: "authEnc128", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.16": { d: "authEnc256", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.17": { d: "hssLmsHashSig", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.18": { d: "chaCha20Poly1305", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.19": { d: "ecdhHKDF-SHA256", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.20": { d: "ecdhHKDF-SHA384", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.21": { d: "ecdhHKDF-SHA512", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.22": { d: "aesSIV-CMAC-256", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.23": { d: "aesSIV-CMAC-384", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.24": { d: "aesSIV-CMAC-512", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.25": { d: "aesSIV-CMAC-wrap256", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.26": { d: "aesSIV-CMAC-wrap384", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.27": { d: "aesSIV-CMAC-wrap512", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.28": { d: "hkdfWithSha256", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.29": { d: "hkdfWithSha384", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.3.30": { d: "hkdfWithSha512", c: "S/MIME Algorithms" },
  "1.2.840.113549.1.9.16.4.1": { d: "certDist-ldap", c: "S/MIME Certificate Distribution" },
  "1.2.840.113549.1.9.16.5.1": { d: "sigPolicyQualifier-spuri x", c: "S/MIME Signature Policy Qualifiers" },
  "1.2.840.113549.1.9.16.5.2": { d: "sigPolicyQualifier-spUserNotice", c: "S/MIME Signature Policy Qualifiers" },
  "1.2.840.113549.1.9.16.6.1": { d: "proofOfOrigin", c: "S/MIME Commitment Type Identifiers" },
  "1.2.840.113549.1.9.16.6.2": { d: "proofOfReceipt", c: "S/MIME Commitment Type Identifiers" },
  "1.2.840.113549.1.9.16.6.3": { d: "proofOfDelivery", c: "S/MIME Commitment Type Identifiers" },
  "1.2.840.113549.1.9.16.6.4": { d: "proofOfSender", c: "S/MIME Commitment Type Identifiers" },
  "1.2.840.113549.1.9.16.6.5": { d: "proofOfApproval", c: "S/MIME Commitment Type Identifiers" },
  "1.2.840.113549.1.9.16.6.6": { d: "proofOfCreation", c: "S/MIME Commitment Type Identifiers" },
  "1.2.840.113549.1.9.16.8.1": { d: "glUseKEK", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.2": { d: "glDelete", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.3": { d: "glAddMember", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.4": { d: "glDeleteMember", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.5": { d: "glRekey", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.6": { d: "glAddOwner", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.7": { d: "glRemoveOwner", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.8": { d: "glkCompromise", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.9": { d: "glkRefresh", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.10": { d: "glFailInfo", c: "S/MIME Symmetric Key Distribution Attributes.  Obsolete", w: !0 },
  "1.2.840.113549.1.9.16.8.11": { d: "glaQueryRequest", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.12": { d: "glaQueryResponse", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.13": { d: "glProvideCert", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.14": { d: "glUpdateCert", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.8.15": { d: "glKey", c: "S/MIME Symmetric Key Distribution Attributes" },
  "1.2.840.113549.1.9.16.9": { d: "signatureTypeIdentifier", c: "S/MIME" },
  "1.2.840.113549.1.9.16.9.1": { d: "originatorSig", c: "S/MIME Signature Type Identifier" },
  "1.2.840.113549.1.9.16.9.2": { d: "domainSig", c: "S/MIME Signature Type Identifier" },
  "1.2.840.113549.1.9.16.9.3": { d: "additionalAttributesSig", c: "S/MIME Signature Type Identifier" },
  "1.2.840.113549.1.9.16.9.4": { d: "reviewSig", c: "S/MIME Signature Type Identifier" },
  "1.2.840.113549.1.9.16.11": { d: "capabilities", c: "S/MIME" },
  "1.2.840.113549.1.9.16.11.1": { d: "preferBinaryInside", c: "S/MIME Capability" },
  "1.2.840.113549.1.9.16.12": { d: "pskcAttributes", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.1": { d: "pskcManufacturer", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.2": { d: "pskcSerialNo", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.3": { d: "pskcModel", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.4": { d: "pskcIssueno", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.5": { d: "pskcDevicebinding", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.6": { d: "pskcDevicestartdate", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.7": { d: "pskcDeviceexpirydate", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.8": { d: "pskcModuleid", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.9": { d: "pskcKeyid", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.10": { d: "pskcAlgorithm", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.11": { d: "pskcIssuer", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.12": { d: "pskcKeyprofileid", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.13": { d: "pskcKeyreference", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.14": { d: "pskcFriendlyname", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.15": { d: "pskcAlgorithmparams", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.16": { d: "pskcCounter", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.17": { d: "pskcTime", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.18": { d: "pskcTimeinterval", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.19": { d: "pskcTimedrift", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.20": { d: "pskcValuemac", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.21": { d: "pskcKeystartdate", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.22": { d: "pskcKeyexpirydate", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.23": { d: "pskcNooftransactions", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.24": { d: "pskcKeyusages", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.25": { d: "pskcPinpolicy", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.26": { d: "pskcDeviceuserid", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.16.12.27": { d: "pskcKeyuserid", c: "S/MIME Portable Symmetric Key Container Attributes" },
  "1.2.840.113549.1.9.20": { d: "friendlyName (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.21": { d: "localKeyID (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.22": { d: "certTypes (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.22.1": { d: "x509Certificate (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.22.2": { d: "sdsiCertificate (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.23": { d: "crlTypes (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.23.1": { d: "x509Crl (for PKCS #12)", c: "PKCS #9 via PKCS #12" },
  "1.2.840.113549.1.9.24": { d: "pkcs9objectClass", c: "PKCS #9/RFC 2985" },
  "1.2.840.113549.1.9.25": { d: "pkcs9attributes", c: "PKCS #9/RFC 2985" },
  "1.2.840.113549.1.9.25.1": { d: "pkcs15Token", c: "PKCS #9/RFC 2985 attribute" },
  "1.2.840.113549.1.9.25.2": { d: "encryptedPrivateKeyInfo", c: "PKCS #9/RFC 2985 attribute" },
  "1.2.840.113549.1.9.25.3": { d: "randomNonce", c: "PKCS #9/RFC 2985 attribute" },
  "1.2.840.113549.1.9.25.4": { d: "sequenceNumber", c: "PKCS #9/RFC 2985 attribute" },
  "1.2.840.113549.1.9.25.5": { d: "pkcs7PDU", c: "PKCS #9/RFC 2985 attribute" },
  "1.2.840.113549.1.9.26": { d: "pkcs9syntax", c: "PKCS #9/RFC 2985" },
  "1.2.840.113549.1.9.27": { d: "pkcs9matchingRules", c: "PKCS #9/RFC 2985" },
  "1.2.840.113549.1.9.52": { d: "cmsAlgorithmProtection", c: "RFC 6211" },
  "1.2.840.113549.1.12": { d: "pkcs-12", c: "" },
  "1.2.840.113549.1.12.1": { d: "pkcs-12-PbeIds", c: "This OID was formerly assigned as PKCS #12 modeID" },
  "1.2.840.113549.1.12.1.1": { d: "pbeWithSHAAnd128BitRC4", c: "PKCS #12 PbeIds. This OID was formerly assigned as pkcs-12-OfflineTransportMode" },
  "1.2.840.113549.1.12.1.2": { d: "pbeWithSHAAnd40BitRC4", c: "PKCS #12 PbeIds. This OID was formerly assigned as pkcs-12-OnlineTransportMode" },
  "1.2.840.113549.1.12.1.3": { d: "pbeWithSHAAnd3-KeyTripleDES-CBC", c: "PKCS #12 PbeIds" },
  "1.2.840.113549.1.12.1.4": { d: "pbeWithSHAAnd2-KeyTripleDES-CBC", c: "PKCS #12 PbeIds" },
  "1.2.840.113549.1.12.1.5": { d: "pbeWithSHAAnd128BitRC2-CBC", c: "PKCS #12 PbeIds" },
  "1.2.840.113549.1.12.1.6": { d: "pbeWithSHAAnd40BitRC2-CBC", c: "PKCS #12 PbeIds" },
  "1.2.840.113549.1.12.2": { d: "pkcs-12-ESPVKID", c: "Deprecated", w: !0 },
  "1.2.840.113549.1.12.2.1": { d: "pkcs-12-PKCS8KeyShrouding", c: "PKCS #12 ESPVKID. Deprecated, use (1 2 840 113549 1 12 3 5) instead", w: !0 },
  "1.2.840.113549.1.12.3": { d: "pkcs-12-BagIds", c: "" },
  "1.2.840.113549.1.12.3.1": { d: "pkcs-12-keyBagId", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.3.2": { d: "pkcs-12-certAndCRLBagId", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.3.3": { d: "pkcs-12-secretBagId", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.3.4": { d: "pkcs-12-safeContentsId", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.3.5": { d: "pkcs-12-pkcs-8ShroudedKeyBagId", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.4": { d: "pkcs-12-CertBagID", c: "Deprecated", w: !0 },
  "1.2.840.113549.1.12.4.1": { d: "pkcs-12-X509CertCRLBagID", c: "PKCS #12 CertBagID. This OID was formerly assigned as pkcs-12-X509CertCRLBag" },
  "1.2.840.113549.1.12.4.2": { d: "pkcs-12-SDSICertBagID", c: "PKCS #12 CertBagID. This OID was formerly assigned as pkcs-12-SDSICertBag" },
  "1.2.840.113549.1.12.5": { d: "pkcs-12-OID", c: "", w: !0 },
  "1.2.840.113549.1.12.5.1": { d: "pkcs-12-PBEID", c: "PKCS #12 OID. Deprecated, use the partially compatible (1 2 840 113549 1 12 1) OIDs instead", w: !0 },
  "1.2.840.113549.1.12.5.1.1": { d: "pkcs-12-PBEWithSha1And128BitRC4", c: "PKCS #12 OID PBEID. Deprecated, use (1 2 840 113549 1 12 1 1) instead", w: !0 },
  "1.2.840.113549.1.12.5.1.2": { d: "pkcs-12-PBEWithSha1And40BitRC4", c: "PKCS #12 OID PBEID. Deprecated, use (1 2 840 113549 1 12 1 2) instead", w: !0 },
  "1.2.840.113549.1.12.5.1.3": { d: "pkcs-12-PBEWithSha1AndTripleDESCBC", c: "PKCS #12 OID PBEID. Deprecated, use the incompatible but similar (1 2 840 113549 1 12 1 3) or (1 2 840 113549 1 12 1 4) instead", w: !0 },
  "1.2.840.113549.1.12.5.1.4": { d: "pkcs-12-PBEWithSha1And128BitRC2CBC", c: "PKCS #12 OID PBEID. Deprecated, use (1 2 840 113549 1 12 1 5) instead", w: !0 },
  "1.2.840.113549.1.12.5.1.5": { d: "pkcs-12-PBEWithSha1And40BitRC2CBC", c: "PKCS #12 OID PBEID. Deprecated, use (1 2 840 113549 1 12 1 6) instead", w: !0 },
  "1.2.840.113549.1.12.5.1.6": { d: "pkcs-12-PBEWithSha1AndRC4", c: "PKCS #12 OID PBEID. Deprecated, use the incompatible but similar (1 2 840 113549 1 12 1 1) or (1 2 840 113549 1 12 1 2) instead", w: !0 },
  "1.2.840.113549.1.12.5.1.7": { d: "pkcs-12-PBEWithSha1AndRC2CBC", c: "PKCS #12 OID PBEID. Deprecated, use the incompatible but similar (1 2 840 113549 1 12 1 5) or (1 2 840 113549 1 12 1 6) instead", w: !0 },
  "1.2.840.113549.1.12.5.2": { d: "pkcs-12-EnvelopingID", c: "PKCS #12 OID. Deprecated, use the conventional PKCS #1 OIDs instead" },
  "1.2.840.113549.1.12.5.2.1": { d: "pkcs-12-RSAEncryptionWith128BitRC4", c: "PKCS #12 OID EnvelopingID. Deprecated, use the conventional PKCS #1 OIDs instead", w: !0 },
  "1.2.840.113549.1.12.5.2.2": { d: "pkcs-12-RSAEncryptionWith40BitRC4", c: "PKCS #12 OID EnvelopingID. Deprecated, use the conventional PKCS #1 OIDs instead", w: !0 },
  "1.2.840.113549.1.12.5.2.3": { d: "pkcs-12-RSAEncryptionWithTripleDES", c: "PKCS #12 OID EnvelopingID. Deprecated, use the conventional PKCS #1 OIDs instead", w: !0 },
  "1.2.840.113549.1.12.5.3": { d: "pkcs-12-SignatureID", c: "PKCS #12 OID EnvelopingID. Deprecated, use the conventional PKCS #1 OIDs instead", w: !0 },
  "1.2.840.113549.1.12.5.3.1": { d: "pkcs-12-RSASignatureWithSHA1Digest", c: "PKCS #12 OID SignatureID. Deprecated, use the conventional PKCS #1 OIDs instead", w: !0 },
  "1.2.840.113549.1.12.10": { d: "pkcs-12Version1", c: "" },
  "1.2.840.113549.1.12.10.1": { d: "pkcs-12BadIds", c: "" },
  "1.2.840.113549.1.12.10.1.1": { d: "pkcs-12-keyBag", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.10.1.2": { d: "pkcs-12-pkcs-8ShroudedKeyBag", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.10.1.3": { d: "pkcs-12-certBag", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.10.1.4": { d: "pkcs-12-crlBag", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.10.1.5": { d: "pkcs-12-secretBag", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.12.10.1.6": { d: "pkcs-12-safeContentsBag", c: "PKCS #12 BagIds" },
  "1.2.840.113549.1.15.1": { d: "pkcs15modules", c: "PKCS #15" },
  "1.2.840.113549.1.15.2": { d: "pkcs15attributes", c: "PKCS #15" },
  "1.2.840.113549.1.15.3": { d: "pkcs15contentType", c: "PKCS #15" },
  "1.2.840.113549.1.15.3.1": { d: "pkcs15content", c: "PKCS #15 content type" },
  "1.2.840.113549.2": { d: "digestAlgorithm", c: "" },
  "1.2.840.113549.2.2": { d: "md2", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.4": { d: "md4", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.5": { d: "md5", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.7": { d: "hmacWithSHA1", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.8": { d: "hmacWithSHA224", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.9": { d: "hmacWithSHA256", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.10": { d: "hmacWithSHA384", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.2.11": { d: "hmacWithSHA512", c: "RSADSI digestAlgorithm" },
  "1.2.840.113549.3": { d: "encryptionAlgorithm", c: "" },
  "1.2.840.113549.3.2": { d: "rc2CBC", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.3": { d: "rc2ECB", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.4": { d: "rc4", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.5": { d: "rc4WithMAC", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.6": { d: "desx-CBC", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.7": { d: "des-EDE3-CBC", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.8": { d: "rc5CBC", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.9": { d: "rc5-CBCPad", c: "RSADSI encryptionAlgorithm" },
  "1.2.840.113549.3.10": { d: "desCDMF", c: "RSADSI encryptionAlgorithm. Formerly called CDMFCBCPad" },
  "1.2.840.114021.1.6.1": { d: "Identrus unknown policyIdentifier", c: "Identrus" },
  "1.2.840.114021.4.1": { d: "identrusOCSP", c: "Identrus" },
  "1.2.840.113556.1.2.241": { d: "deliveryMechanism", c: "Microsoft Exchange Server - attribute" },
  "1.2.840.113556.1.2.281": { d: "ntSecurityDescriptor", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.3.0": { d: "site-Addressing", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.3.13": { d: "classSchema", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.3.14": { d: "attributeSchema", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.3.17": { d: "mailbox-Agent", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.3.22": { d: "mailbox", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.3.23": { d: "container", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.3.46": { d: "mailRecipient", c: "Microsoft Exchange Server - object class" },
  "1.2.840.113556.1.4.145": { d: "revision", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1327": { d: "pKIDefaultKeySpec", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1328": { d: "pKIKeyUsage", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1329": { d: "pKIMaxIssuingDepth", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1330": { d: "pKICriticalExtensions", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1331": { d: "pKIExpirationPeriod", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1332": { d: "pKIOverlapPeriod", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1333": { d: "pKIExtendedKeyUsage", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1334": { d: "pKIDefaultCSPs", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1335": { d: "pKIEnrollmentAccess", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1429": { d: "msPKI-RA-Signature", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1430": { d: "msPKI-Enrollment-Flag", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1431": { d: "msPKI-Private-Key-Flag", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1432": { d: "msPKI-Certificate-Name-Flag", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1433": { d: "msPKI-Minimal-Key-Size", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1434": { d: "msPKI-Template-Schema-Version", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1435": { d: "msPKI-Template-Minor-Revision", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1436": { d: "msPKI-Cert-Template-OID", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1437": { d: "msPKI-Supersede-Templates", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1438": { d: "msPKI-RA-Policies", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1439": { d: "msPKI-Certificate-Policy", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1674": { d: "msPKI-Certificate-Application-Policy", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.1.4.1675": { d: "msPKI-RA-Application-Policies", c: "Microsoft Cert Template - attribute" },
  "1.2.840.113556.4.3": { d: "microsoftExcel", c: "Microsoft" },
  "1.2.840.113556.4.4": { d: "titledWithOID", c: "Microsoft" },
  "1.2.840.113556.4.5": { d: "microsoftPowerPoint", c: "Microsoft" },
  "1.2.840.113583.1": { d: "adobeAcrobat", c: "Adobe Acrobat" },
  "1.2.840.113583.1.1": { d: "acrobatSecurity", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.1": { d: "pdfPassword", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.2": { d: "pdfDefaultSigningCredential", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.3": { d: "pdfDefaultEncryptionCredential", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.4": { d: "pdfPasswordTimeout", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.5": { d: "pdfAuthenticDocumentsTrust", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.6": { d: "pdfDynamicContentTrust", c: "Adobe Acrobat security", w: !0 },
  "1.2.840.113583.1.1.7": { d: "pdfUbiquityTrust", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.8": { d: "pdfRevocationInfoArchival", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.9": { d: "pdfX509Extension", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.9.1": { d: "pdfTimeStamp", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.9.2": { d: "pdfArchiveRevInfo", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.1.10": { d: "pdfPPLKLiteCredential", c: "Adobe Acrobat security" },
  "1.2.840.113583.1.2": { d: "acrobatCPS", c: "Adobe Acrobat CPS" },
  "1.2.840.113583.1.2.1": { d: "pdfAuthenticDocumentsCPS", c: "Adobe Acrobat CPS" },
  "1.2.840.113583.1.2.2": { d: "pdfTestCPS", c: "Adobe Acrobat CPS" },
  "1.2.840.113583.1.2.3": { d: "pdfUbiquityCPS", c: "Adobe Acrobat CPS" },
  "1.2.840.113583.1.2.4": { d: "pdfAdhocCPS", c: "Adobe Acrobat CPS" },
  "1.2.840.113583.1.7": { d: "acrobatUbiquity", c: "Adobe Acrobat ubiquity" },
  "1.2.840.113583.1.7.1": { d: "pdfUbiquitySubRights", c: "Adobe Acrobat ubiquity" },
  "1.2.840.113583.1.9": { d: "acrobatExtension", c: "Adobe Acrobat X.509 extension" },
  "1.2.840.113628.114.1.7": { d: "adobePKCS7", c: "Adobe" },
  "1.2.840.113635.100": { d: "appleDataSecurity", c: "Apple" },
  "1.2.840.113635.100.1": { d: "appleTrustPolicy", c: "Apple" },
  "1.2.840.113635.100.1.1": { d: "appleISignTP", c: "Apple trust policy" },
  "1.2.840.113635.100.1.2": { d: "appleX509Basic", c: "Apple trust policy" },
  "1.2.840.113635.100.1.3": { d: "appleSSLPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.4": { d: "appleLocalCertGenPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.5": { d: "appleCSRGenPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.6": { d: "appleCRLPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.7": { d: "appleOCSPPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.8": { d: "appleSMIMEPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.9": { d: "appleEAPPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.10": { d: "appleSWUpdateSigningPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.11": { d: "appleIPSecPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.12": { d: "appleIChatPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.13": { d: "appleResourceSignPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.14": { d: "applePKINITClientPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.15": { d: "applePKINITServerPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.16": { d: "appleCodeSigningPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.1.17": { d: "applePackageSigningPolicy", c: "Apple trust policy" },
  "1.2.840.113635.100.2": { d: "appleSecurityAlgorithm", c: "Apple" },
  "1.2.840.113635.100.2.1": { d: "appleFEE", c: "Apple security algorithm" },
  "1.2.840.113635.100.2.2": { d: "appleASC", c: "Apple security algorithm" },
  "1.2.840.113635.100.2.3": { d: "appleFEE_MD5", c: "Apple security algorithm" },
  "1.2.840.113635.100.2.4": { d: "appleFEE_SHA1", c: "Apple security algorithm" },
  "1.2.840.113635.100.2.5": { d: "appleFEED", c: "Apple security algorithm" },
  "1.2.840.113635.100.2.6": { d: "appleFEEDEXP", c: "Apple security algorithm" },
  "1.2.840.113635.100.2.7": { d: "appleECDSA", c: "Apple security algorithm" },
  "1.2.840.113635.100.3": { d: "appleDotMacCertificate", c: "Apple" },
  "1.2.840.113635.100.3.1": { d: "appleDotMacCertificateRequest", c: "Apple dotMac certificate" },
  "1.2.840.113635.100.3.2": { d: "appleDotMacCertificateExtension", c: "Apple dotMac certificate" },
  "1.2.840.113635.100.3.3": { d: "appleDotMacCertificateRequestValues", c: "Apple dotMac certificate" },
  "1.2.840.113635.100.4": { d: "appleExtendedKeyUsage", c: "Apple" },
  "1.2.840.113635.100.4.1": { d: "appleCodeSigning", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.1.1": { d: "appleCodeSigningDevelopment", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.1.2": { d: "appleSoftwareUpdateSigning", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.1.3": { d: "appleCodeSigningThirdParty", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.1.4": { d: "appleResourceSigning", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.2": { d: "appleIChatSigning", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.3": { d: "appleIChatEncryption", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.4": { d: "appleSystemIdentity", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.5": { d: "appleCryptoEnv", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.5.1": { d: "appleCryptoProductionEnv", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.5.2": { d: "appleCryptoMaintenanceEnv", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.5.3": { d: "appleCryptoTestEnv", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.5.4": { d: "appleCryptoDevelopmentEnv", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.6": { d: "appleCryptoQoS", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.6.1": { d: "appleCryptoTier0QoS", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.6.2": { d: "appleCryptoTier1QoS", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.6.3": { d: "appleCryptoTier2QoS", c: "Apple extended key usage" },
  "1.2.840.113635.100.4.6.4": { d: "appleCryptoTier3QoS", c: "Apple extended key usage" },
  "1.2.840.113635.100.5": { d: "appleCertificatePolicies", c: "Apple" },
  "1.2.840.113635.100.5.1": { d: "appleCertificatePolicyID", c: "Apple" },
  "1.2.840.113635.100.5.2": { d: "appleDotMacCertificatePolicyID", c: "Apple" },
  "1.2.840.113635.100.5.3": { d: "appleADCCertificatePolicyID", c: "Apple" },
  "1.2.840.113635.100.6": { d: "appleCertificateExtensions", c: "Apple" },
  "1.2.840.113635.100.6.1": { d: "appleCertificateExtensionCodeSigning", c: "Apple certificate extension" },
  "1.2.840.113635.100.6.1.1": { d: "appleCertificateExtensionAppleSigning", c: "Apple certificate extension" },
  "1.2.840.113635.100.6.1.2": { d: "appleCertificateExtensionADCDeveloperSigning", c: "Apple certificate extension" },
  "1.2.840.113635.100.6.1.3": { d: "appleCertificateExtensionADCAppleSigning", c: "Apple certificate extension" },
  "1.3.6.1.4.1.311.2.1.4": { d: "spcIndirectDataContext", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.10": { d: "spcAgencyInfo", c: "Microsoft code signing. Also known as policyLink" },
  "1.3.6.1.4.1.311.2.1.11": { d: "spcStatementType", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.12": { d: "spcSpOpusInfo", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.14": { d: "certReqExtensions", c: "Microsoft" },
  "1.3.6.1.4.1.311.2.1.15": { d: "spcPEImageData", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.18": { d: "spcRawFileData", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.19": { d: "spcStructuredStorageData", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.20": { d: "spcJavaClassData (type 1)", c: 'Microsoft code signing. Formerly "link extension" aka "glue extension"' },
  "1.3.6.1.4.1.311.2.1.21": { d: "individualCodeSigning", c: "Microsoft" },
  "1.3.6.1.4.1.311.2.1.22": { d: "commercialCodeSigning", c: "Microsoft" },
  "1.3.6.1.4.1.311.2.1.25": { d: "spcLink (type 2)", c: 'Microsoft code signing. Also known as "glue extension"' },
  "1.3.6.1.4.1.311.2.1.26": { d: "spcMinimalCriteriaInfo", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.27": { d: "spcFinancialCriteriaInfo", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.28": { d: "spcLink (type 3)", c: 'Microsoft code signing.  Also known as "glue extension"' },
  "1.3.6.1.4.1.311.2.1.29": { d: "spcHashInfoObjID", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.1.30": { d: "spcSipInfoObjID", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.2.2": { d: "ctl", c: "Microsoft CTL" },
  "1.3.6.1.4.1.311.2.2.1": { d: "ctlTrustedCodesigningCAList", c: "Microsoft CTL" },
  "1.3.6.1.4.1.311.2.2.2": { d: "ctlTrustedClientAuthCAList", c: "Microsoft CTL" },
  "1.3.6.1.4.1.311.2.2.3": { d: "ctlTrustedServerAuthCAList", c: "Microsoft CTL" },
  "1.3.6.1.4.1.311.3.2.1": { d: "timestampRequest", c: "Microsoft code signing" },
  "1.3.6.1.4.1.311.10.1": { d: "certTrustList", c: "Microsoft contentType" },
  "1.3.6.1.4.1.311.10.1.1": { d: "sortedCtl", c: "Microsoft contentType" },
  "1.3.6.1.4.1.311.10.2": { d: "nextUpdateLocation", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.3.1": { d: "certTrustListSigning", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.2": { d: "timeStampSigning", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.3": { d: "serverGatedCrypto", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.3.1": { d: "serialized", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.3.4": { d: "encryptedFileSystem", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.5": { d: "whqlCrypto", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.6": { d: "nt5Crypto", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.7": { d: "oemWHQLCrypto", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.8": { d: "embeddedNTCrypto", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.9": { d: "rootListSigner", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.10": { d: "qualifiedSubordination", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.11": { d: "keyRecovery", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.12": { d: "documentSigning", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.13": { d: "lifetimeSigning", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.14": { d: "mobileDeviceSoftware", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.15": { d: "smartDisplay", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.16": { d: "cspSignature", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.3.4.1": { d: "efsRecovery", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.4.1": { d: "yesnoTrustAttr", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.10.5.1": { d: "drm", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.5.2": { d: "drmIndividualization", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.6.1": { d: "licenses", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.6.2": { d: "licenseServer", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.10.7.1": { d: "keyidRdn", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.10.8.1": { d: "removeCertificate", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.10.9.1": { d: "crossCertDistPoints", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.10.10.1": { d: "cmcAddAttributes", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.11": { d: "certPropIdPrefix", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.11.4": { d: "certMd5HashPropId", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.11.20": { d: "certKeyIdentifierPropId", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.11.28": { d: "certIssuerSerialNumberMd5HashPropId", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.11.29": { d: "certSubjectNameMd5HashPropId", c: "Microsoft" },
  "1.3.6.1.4.1.311.10.12.1": { d: "anyApplicationPolicy", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.12": { d: "catalog", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.12.1.1": { d: "catalogList", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.12.1.2": { d: "catalogListMember", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.12.2.1": { d: "catalogNameValueObjID", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.12.2.2": { d: "catalogMemberInfoObjID", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.13.1": { d: "renewalCertificate", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.13.2.1": { d: "enrolmentNameValuePair", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.13.2.2": { d: "enrolmentCSP", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.13.2.3": { d: "osVersion", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.16.4": { d: "microsoftRecipientInfo", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.17.1": { d: "pkcs12KeyProviderNameAttr", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.17.2": { d: "localMachineKeyset", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.17.3": { d: "pkcs12ExtendedAttributes", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.20.1": { d: "autoEnrollCtlUsage", c: "Microsoft" },
  "1.3.6.1.4.1.311.20.2": { d: "enrollCerttypeExtension", c: "Microsoft CAPICOM certificate template, V1" },
  "1.3.6.1.4.1.311.20.2.1": { d: "enrollmentAgent", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.20.2.2": { d: "smartcardLogon", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.20.2.3": { d: "universalPrincipalName", c: "Microsoft UPN" },
  "1.3.6.1.4.1.311.20.3": { d: "certManifold", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.1": { d: "cAKeyCertIndexPair", c: "Microsoft attribute.  Also known as certsrvCaVersion" },
  "1.3.6.1.4.1.311.21.2": { d: "certSrvPreviousCertHash", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.3": { d: "crlVirtualBase", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.4": { d: "crlNextPublish", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.5": { d: "caExchange", c: "Microsoft extended key usage", w: !0 },
  "1.3.6.1.4.1.311.21.6": { d: "keyRecovery", c: "Microsoft extended key usage", w: !0 },
  "1.3.6.1.4.1.311.21.7": { d: "certificateTemplate", c: "Microsoft CAPICOM certificate template, V2" },
  "1.3.6.1.4.1.311.21.9": { d: "rdnDummySigner", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.10": { d: "applicationCertPolicies", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.11": { d: "applicationPolicyMappings", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.12": { d: "applicationPolicyConstraints", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.13": { d: "archivedKey", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.21.14": { d: "crlSelfCDP", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.15": { d: "requireCertChainPolicy", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.16": { d: "archivedKeyCertHash", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.17": { d: "issuedCertHash", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.19": { d: "dsEmailReplication", c: "Microsoft" },
  "1.3.6.1.4.1.311.21.20": { d: "requestClientInfo", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.21.21": { d: "encryptedKeyHash", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.21.22": { d: "certsrvCrossCaVersion", c: "Microsoft" },
  "1.3.6.1.4.1.311.25.1": { d: "ntdsReplication", c: "Microsoft" },
  "1.3.6.1.4.1.311.31.1": { d: "productUpdate", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.47.1.1": { d: "systemHealth", c: "Microsoft extended key usage" },
  "1.3.6.1.4.1.311.47.1.3": { d: "systemHealthLoophole", c: "Microsoft extended key usage" },
  "1.3.6.1.4.1.311.60.1.1": { d: "rootProgramFlags", c: "Microsoft policy attribute" },
  "1.3.6.1.4.1.311.61.1.1": { d: "kernelModeCodeSigning", c: "Microsoft enhanced key usage" },
  "1.3.6.1.4.1.311.60.2.1.1": { d: "jurisdictionOfIncorporationL", c: "Microsoft (???)" },
  "1.3.6.1.4.1.311.60.2.1.2": { d: "jurisdictionOfIncorporationSP", c: "Microsoft (???)" },
  "1.3.6.1.4.1.311.60.2.1.3": { d: "jurisdictionOfIncorporationC", c: "Microsoft (???)" },
  "1.3.6.1.4.1.311.88": { d: "capiCom", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.88.1": { d: "capiComVersion", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.88.2": { d: "capiComAttribute", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.88.2.1": { d: "capiComDocumentName", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.88.2.2": { d: "capiComDocumentDescription", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.88.3": { d: "capiComEncryptedData", c: "Microsoft attribute" },
  "1.3.6.1.4.1.311.88.3.1": { d: "capiComEncryptedContent", c: "Microsoft attribute" },
  "1.3.6.1.4.1.188.7.1.1": { d: "ascom", c: "Ascom Systech" },
  "1.3.6.1.4.1.188.7.1.1.1": { d: "ideaECB", c: "Ascom Systech" },
  "1.3.6.1.4.1.188.7.1.1.2": { d: "ideaCBC", c: "Ascom Systech" },
  "1.3.6.1.4.1.188.7.1.1.3": { d: "ideaCFB", c: "Ascom Systech" },
  "1.3.6.1.4.1.188.7.1.1.4": { d: "ideaOFB", c: "Ascom Systech" },
  "1.3.6.1.4.1.2428.10.1.1": { d: "UNINETT policyIdentifier", c: "UNINETT PCA" },
  "1.3.6.1.4.1.2712.10": { d: "ICE-TEL policyIdentifier", c: "ICE-TEL CA" },
  "1.3.6.1.4.1.2786.1.1.1": { d: "ICE-TEL Italian policyIdentifier", c: "ICE-TEL CA policy" },
  "1.3.6.1.4.1.3029.1.1.1": { d: "blowfishECB", c: "cryptlib encryption algorithm" },
  "1.3.6.1.4.1.3029.1.1.2": { d: "blowfishCBC", c: "cryptlib encryption algorithm" },
  "1.3.6.1.4.1.3029.1.1.3": { d: "blowfishCFB", c: "cryptlib encryption algorithm" },
  "1.3.6.1.4.1.3029.1.1.4": { d: "blowfishOFB", c: "cryptlib encryption algorithm" },
  "1.3.6.1.4.1.3029.1.2.1": { d: "elgamal", c: "cryptlib public-key algorithm" },
  "1.3.6.1.4.1.3029.1.2.1.1": { d: "elgamalWithSHA-1", c: "cryptlib public-key algorithm" },
  "1.3.6.1.4.1.3029.1.2.1.2": { d: "elgamalWithRIPEMD-160", c: "cryptlib public-key algorithm" },
  "1.3.6.1.4.1.3029.3.1.1": { d: "cryptlibPresenceCheck", c: "cryptlib attribute type" },
  "1.3.6.1.4.1.3029.3.1.2": { d: "pkiBoot", c: "cryptlib attribute type" },
  "1.3.6.1.4.1.3029.3.1.4": { d: "crlExtReason", c: "cryptlib attribute type" },
  "1.3.6.1.4.1.3029.3.1.5": { d: "keyFeatures", c: "cryptlib attribute type" },
  "1.3.6.1.4.1.3029.4.1": { d: "cryptlibContent", c: "cryptlib" },
  "1.3.6.1.4.1.3029.4.1.1": { d: "cryptlibConfigData", c: "cryptlib content type" },
  "1.3.6.1.4.1.3029.4.1.2": { d: "cryptlibUserIndex", c: "cryptlib content type" },
  "1.3.6.1.4.1.3029.4.1.3": { d: "cryptlibUserInfo", c: "cryptlib content type" },
  "1.3.6.1.4.1.3029.4.1.4": { d: "rtcsRequest", c: "cryptlib content type" },
  "1.3.6.1.4.1.3029.4.1.5": { d: "rtcsResponse", c: "cryptlib content type" },
  "1.3.6.1.4.1.3029.4.1.6": { d: "rtcsResponseExt", c: "cryptlib content type" },
  "1.3.6.1.4.1.3029.42.11172.1": { d: "mpeg-1", c: "cryptlib special MPEG-of-cat OID" },
  "1.3.6.1.4.1.3029.54.11940.54": { d: 'TSA policy "Anything that arrives, we sign"', c: "cryptlib TSA policy" },
  "1.3.6.1.4.1.3029.88.89.90.90.89": { d: "xYZZY policyIdentifier", c: "cryptlib certificate policy" },
  "1.3.6.1.4.1.3401.8.1.1": { d: "pgpExtension", c: "PGP key information" },
  "1.3.6.1.4.1.3576.7": { d: "eciaAscX12Edi", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.7.1": { d: "plainEDImessage", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.7.2": { d: "signedEDImessage", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.7.5": { d: "integrityEDImessage", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.7.65": { d: "iaReceiptMessage", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.7.97": { d: "iaStatusMessage", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.8": { d: "eciaEdifact", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.3576.9": { d: "eciaNonEdi", c: "TMN EDI for Interactive Agents" },
  "1.3.6.1.4.1.4146": { d: "Globalsign", c: "Globalsign" },
  "1.3.6.1.4.1.4146.1": { d: "globalsignPolicy", c: "Globalsign" },
  "1.3.6.1.4.1.4146.1.10": { d: "globalsignDVPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.20": { d: "globalsignOVPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.30": { d: "globalsignTSAPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.40": { d: "globalsignClientCertPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.50": { d: "globalsignCodeSignPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.60": { d: "globalsignRootSignPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.70": { d: "globalsignTrustedRootPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.80": { d: "globalsignEDIClientPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.81": { d: "globalsignEDIServerPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.90": { d: "globalsignTPMRootPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.4146.1.95": { d: "globalsignOCSPPolicy", c: "Globalsign policy" },
  "1.3.6.1.4.1.5309.1": { d: "edelWebPolicy", c: "EdelWeb policy" },
  "1.3.6.1.4.1.5309.1.2": { d: "edelWebCustomerPolicy", c: "EdelWeb policy" },
  "1.3.6.1.4.1.5309.1.2.1": { d: "edelWebClepsydrePolicy", c: "EdelWeb policy" },
  "1.3.6.1.4.1.5309.1.2.2": { d: "edelWebExperimentalTSAPolicy", c: "EdelWeb policy" },
  "1.3.6.1.4.1.5309.1.2.3": { d: "edelWebOpenEvidenceTSAPolicy", c: "EdelWeb policy" },
  "1.3.6.1.4.1.5472": { d: "timeproof", c: "enterprise" },
  "1.3.6.1.4.1.5472.1": { d: "tss", c: "timeproof" },
  "1.3.6.1.4.1.5472.1.1": { d: "tss80", c: "timeproof TSS" },
  "1.3.6.1.4.1.5472.1.2": { d: "tss380", c: "timeproof TSS" },
  "1.3.6.1.4.1.5472.1.3": { d: "tss400", c: "timeproof TSS" },
  "1.3.6.1.4.1.5770.0.3": { d: "secondaryPractices", c: "MEDePass" },
  "1.3.6.1.4.1.5770.0.4": { d: "physicianIdentifiers", c: "MEDePass" },
  "1.3.6.1.4.1.6449.1.2.1.3.1": { d: "comodoPolicy", c: "Comodo CA" },
  "1.3.6.1.4.1.6449.1.2.2.15": { d: "wotrustPolicy", c: "WoTrust (Comodo) CA" },
  "1.3.6.1.4.1.6449.1.3.5.2": { d: "comodoCertifiedDeliveryService", c: "Comodo CA" },
  "1.3.6.1.4.1.6449.2.1.1": { d: "comodoTimestampingPolicy", c: "Comodo CA" },
  "1.3.6.1.4.1.8301.3.5.1": { d: "validityModelChain", c: "TU Darmstadt ValidityModel" },
  "1.3.6.1.4.1.8301.3.5.2": { d: "validityModelShell", c: "ValidityModel" },
  "1.3.6.1.4.1.8231.1": { d: "rolUnicoNacional", c: "Chilean Government national unique roll number" },
  "1.3.6.1.4.1.11591": { d: "gnu", c: "GNU Project (see http://www.gnupg.org/oids.html)" },
  "1.3.6.1.4.1.11591.1": { d: "gnuRadius", c: "GNU Radius" },
  "1.3.6.1.4.1.11591.3": { d: "gnuRadar", c: "GNU Radar" },
  "1.3.6.1.4.1.11591.4.11": { d: "scrypt", c: "GNU Generic Security Service" },
  "1.3.6.1.4.1.11591.12": { d: "gnuDigestAlgorithm", c: "GNU digest algorithm" },
  "1.3.6.1.4.1.11591.12.2": { d: "tiger", c: "GNU digest algorithm" },
  "1.3.6.1.4.1.11591.13": { d: "gnuEncryptionAlgorithm", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2": { d: "serpent", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.1": { d: "serpent128_ECB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.2": { d: "serpent128_CBC", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.3": { d: "serpent128_OFB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.4": { d: "serpent128_CFB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.21": { d: "serpent192_ECB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.22": { d: "serpent192_CBC", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.23": { d: "serpent192_OFB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.24": { d: "serpent192_CFB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.41": { d: "serpent256_ECB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.42": { d: "serpent256_CBC", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.43": { d: "serpent256_OFB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.13.2.44": { d: "serpent256_CFB", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.15.1": { d: "curve25519", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.15.2": { d: "curve448", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.15.3": { d: "curve25519ph", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.11591.15.4": { d: "curve448ph", c: "GNU encryption algorithm" },
  "1.3.6.1.4.1.16334.509.1.1": { d: "Northrop Grumman extKeyUsage?", c: "Northrop Grumman extended key usage" },
  "1.3.6.1.4.1.16334.509.2.1": { d: "ngcClass1", c: "Northrop Grumman policy" },
  "1.3.6.1.4.1.16334.509.2.2": { d: "ngcClass2", c: "Northrop Grumman policy" },
  "1.3.6.1.4.1.16334.509.2.3": { d: "ngcClass3", c: "Northrop Grumman policy" },
  "1.3.6.1.4.1.23629.1.4.2.1.1": { d: "safenetUsageLimit", c: "SafeNet" },
  "1.3.6.1.4.1.23629.1.4.2.1.2": { d: "safenetEndDate", c: "SafeNet" },
  "1.3.6.1.4.1.23629.1.4.2.1.3": { d: "safenetStartDate", c: "SafeNet" },
  "1.3.6.1.4.1.23629.1.4.2.1.4": { d: "safenetAdminCert", c: "SafeNet" },
  "1.3.6.1.4.1.23629.1.4.2.2.1": { d: "safenetKeyDigest", c: "SafeNet" },
  "1.3.6.1.5.2.3.1": { d: "authData", c: "Kerberos" },
  "1.3.6.1.5.2.3.2": { d: "dHKeyData", c: "Kerberos" },
  "1.3.6.1.5.2.3.3": { d: "rkeyData", c: "Kerberos" },
  "1.3.6.1.5.2.3.4": { d: "keyPurposeClientAuth", c: "Kerberos" },
  "1.3.6.1.5.2.3.5": { d: "keyPurposeKdc", c: "Kerberos" },
  "1.3.6.1.5.2.3.6": { d: "kdf", c: "Kerberos" },
  "1.3.6.1.5.5.7": { d: "pkix", c: "" },
  "1.3.6.1.5.5.7.0.12": { d: "attributeCert", c: "PKIX" },
  "1.3.6.1.5.5.7.1": { d: "privateExtension", c: "PKIX" },
  "1.3.6.1.5.5.7.1.1": { d: "authorityInfoAccess", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.2": { d: "biometricInfo", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.3": { d: "qcStatements", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.4": { d: "acAuditIdentity", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.5": { d: "acTargeting", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.6": { d: "acAaControls", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.7": { d: "ipAddrBlocks", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.8": { d: "autonomousSysIds", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.9": { d: "routerIdentifier", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.10": { d: "acProxying", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.11": { d: "subjectInfoAccess", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.12": { d: "logoType", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.13": { d: "wlanSSID", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.14": { d: "proxyCertInfo", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.15": { d: "acPolicies", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.16": { d: "certificateWarranty", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.18": { d: "cmsContentConstraints", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.19": { d: "otherCerts", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.20": { d: "wrappedApexContinKey", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.21": { d: "clearanceConstraints", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.22": { d: "skiSemantics", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.23": { d: "noSecrecyAfforded", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.24": { d: "tlsFeature", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.25": { d: "manufacturerUsageDescription", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.26": { d: "tnAuthList", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.27": { d: "jwtClaimConstraints", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.28": { d: "ipAddrBlocksV2", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.29": { d: "autonomousSysIdsV2", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.30": { d: "manufacturerUsageDescriptionSigner", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.1.31": { d: "acmeIdentifier", c: "PKIX private extension" },
  "1.3.6.1.5.5.7.2": { d: "policyQualifierIds", c: "PKIX" },
  "1.3.6.1.5.5.7.2.1": { d: "cps", c: "PKIX policy qualifier" },
  "1.3.6.1.5.5.7.2.2": { d: "unotice", c: "PKIX policy qualifier" },
  "1.3.6.1.5.5.7.2.3": { d: "textNotice", c: "PKIX policy qualifier" },
  "1.3.6.1.5.5.7.3": { d: "keyPurpose", c: "PKIX" },
  "1.3.6.1.5.5.7.3.1": { d: "serverAuth", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.2": { d: "clientAuth", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.3": { d: "codeSigning", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.4": { d: "emailProtection", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.5": { d: "ipsecEndSystem", c: "PKIX key purpose", w: !0 },
  "1.3.6.1.5.5.7.3.6": { d: "ipsecTunnel", c: "PKIX key purpose", w: !0 },
  "1.3.6.1.5.5.7.3.7": { d: "ipsecUser", c: "PKIX key purpose", w: !0 },
  "1.3.6.1.5.5.7.3.8": { d: "timeStamping", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.9": { d: "ocspSigning", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.10": { d: "dvcs", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.11": { d: "sbgpCertAAServerAuth", c: "PKIX key purpose", w: !0 },
  "1.3.6.1.5.5.7.3.12": { d: "scvpResponder", c: "PKIX key purpose", w: !0 },
  "1.3.6.1.5.5.7.3.13": { d: "eapOverPPP", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.14": { d: "eapOverLAN", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.15": { d: "scvpServer", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.16": { d: "scvpClient", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.17": { d: "ipsecIKE", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.18": { d: "capwapAC", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.19": { d: "capwapWTP", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.20": { d: "sipDomain", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.21": { d: "secureShellClient", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.22": { d: "secureShellServer", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.23": { d: "sendRouter", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.24": { d: "sendProxiedRouter", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.25": { d: "sendOwner", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.26": { d: "sendProxiedOwner", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.27": { d: "cmcCA", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.28": { d: "cmcRA", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.29": { d: "cmcArchive", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.3.30": { d: "bgpsecRouter", c: "PKIX key purpose" },
  "1.3.6.1.5.5.7.4": { d: "cmpInformationTypes", c: "PKIX" },
  "1.3.6.1.5.5.7.4.1": { d: "caProtEncCert", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.2": { d: "signKeyPairTypes", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.3": { d: "encKeyPairTypes", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.4": { d: "preferredSymmAlg", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.5": { d: "caKeyUpdateInfo", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.6": { d: "currentCRL", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.7": { d: "unsupportedOIDs", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.10": { d: "keyPairParamReq", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.11": { d: "keyPairParamRep", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.12": { d: "revPassphrase", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.13": { d: "implicitConfirm", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.14": { d: "confirmWaitTime", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.15": { d: "origPKIMessage", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.4.16": { d: "suppLangTags", c: "PKIX CMP information" },
  "1.3.6.1.5.5.7.5": { d: "crmfRegistration", c: "PKIX" },
  "1.3.6.1.5.5.7.5.1": { d: "regCtrl", c: "PKIX CRMF registration" },
  "1.3.6.1.5.5.7.5.1.1": { d: "regToken", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.2": { d: "authenticator", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.3": { d: "pkiPublicationInfo", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.4": { d: "pkiArchiveOptions", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.5": { d: "oldCertID", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.6": { d: "protocolEncrKey", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.7": { d: "altCertTemplate", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.1.8": { d: "wtlsTemplate", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.2": { d: "utf8Pairs", c: "PKIX CRMF registration" },
  "1.3.6.1.5.5.7.5.2.1": { d: "utf8Pairs", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.5.2.2": { d: "certReq", c: "PKIX CRMF registration control" },
  "1.3.6.1.5.5.7.6": { d: "algorithms", c: "PKIX" },
  "1.3.6.1.5.5.7.6.1": { d: "des40", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.2": { d: "noSignature", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.3": { d: "dhSigHmacSha1", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.4": { d: "dhPop", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.5": { d: "dhPopSha224", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.6": { d: "dhPopSha256", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.7": { d: "dhPopSha384", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.8": { d: "dhPopSha512", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.15": { d: "dhPopStaticSha224HmacSha224", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.16": { d: "dhPopStaticSha256HmacSha256", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.17": { d: "dhPopStaticSha384HmacSha384", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.18": { d: "dhPopStaticSha512HmacSha512", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.25": { d: "ecdhPopStaticSha224HmacSha224", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.26": { d: "ecdhPopStaticSha256HmacSha256", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.27": { d: "ecdhPopStaticSha384HmacSha384", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.6.28": { d: "ecdhPopStaticSha512HmacSha512", c: "PKIX algorithm" },
  "1.3.6.1.5.5.7.7": { d: "cmcControls", c: "PKIX" },
  "1.3.6.1.5.5.7.8": { d: "otherNames", c: "PKIX" },
  "1.3.6.1.5.5.7.8.1": { d: "personalData", c: "PKIX other name" },
  "1.3.6.1.5.5.7.8.2": { d: "userGroup", c: "PKIX other name" },
  "1.3.6.1.5.5.7.8.5": { d: "xmppAddr", c: "PKIX other name" },
  "1.3.6.1.5.5.7.9": { d: "personalData", c: "PKIX qualified certificates" },
  "1.3.6.1.5.5.7.9.1": { d: "dateOfBirth", c: "PKIX personal data" },
  "1.3.6.1.5.5.7.9.2": { d: "placeOfBirth", c: "PKIX personal data" },
  "1.3.6.1.5.5.7.9.3": { d: "gender", c: "PKIX personal data" },
  "1.3.6.1.5.5.7.9.4": { d: "countryOfCitizenship", c: "PKIX personal data" },
  "1.3.6.1.5.5.7.9.5": { d: "countryOfResidence", c: "PKIX personal data" },
  "1.3.6.1.5.5.7.10": { d: "attributeCertificate", c: "PKIX" },
  "1.3.6.1.5.5.7.10.1": { d: "authenticationInfo", c: "PKIX attribute certificate extension" },
  "1.3.6.1.5.5.7.10.2": { d: "accessIdentity", c: "PKIX attribute certificate extension" },
  "1.3.6.1.5.5.7.10.3": { d: "chargingIdentity", c: "PKIX attribute certificate extension" },
  "1.3.6.1.5.5.7.10.4": { d: "group", c: "PKIX attribute certificate extension" },
  "1.3.6.1.5.5.7.10.5": { d: "role", c: "PKIX attribute certificate extension" },
  "1.3.6.1.5.5.7.10.6": { d: "wlanSSID", c: "PKIX attribute-certificate extension" },
  "1.3.6.1.5.5.7.11": { d: "personalData", c: "PKIX qualified certificates" },
  "1.3.6.1.5.5.7.11.1": { d: "pkixQCSyntax-v1", c: "PKIX qualified certificates" },
  "1.3.6.1.5.5.7.14.2": { d: "resourceCertificatePolicy", c: "PKIX policies" },
  "1.3.6.1.5.5.7.20": { d: "logo", c: "PKIX qualified certificates" },
  "1.3.6.1.5.5.7.20.1": { d: "logoLoyalty", c: "PKIX" },
  "1.3.6.1.5.5.7.20.2": { d: "logoBackground", c: "PKIX" },
  "1.3.6.1.5.5.7.48.1": { d: "ocsp", c: "PKIX" },
  "1.3.6.1.5.5.7.48.1.1": { d: "ocspBasic", c: "OCSP" },
  "1.3.6.1.5.5.7.48.1.2": { d: "ocspNonce", c: "OCSP" },
  "1.3.6.1.5.5.7.48.1.3": { d: "ocspCRL", c: "OCSP" },
  "1.3.6.1.5.5.7.48.1.4": { d: "ocspResponse", c: "OCSP" },
  "1.3.6.1.5.5.7.48.1.5": { d: "ocspNoCheck", c: "OCSP" },
  "1.3.6.1.5.5.7.48.1.6": { d: "ocspArchiveCutoff", c: "OCSP" },
  "1.3.6.1.5.5.7.48.1.7": { d: "ocspServiceLocator", c: "OCSP" },
  "1.3.6.1.5.5.7.48.2": { d: "caIssuers", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.7.48.3": { d: "timeStamping", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.7.48.4": { d: "dvcs", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.7.48.5": { d: "caRepository", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.7.48.7": { d: "signedObjectRepository", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.7.48.10": { d: "rpkiManifest", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.7.48.11": { d: "signedObject", c: "PKIX subject/authority info access descriptor" },
  "1.3.6.1.5.5.8.1.1": { d: "hmacMD5", c: "ISAKMP HMAC algorithm" },
  "1.3.6.1.5.5.8.1.2": { d: "hmacSHA", c: "ISAKMP HMAC algorithm" },
  "1.3.6.1.5.5.8.1.3": { d: "hmacTiger", c: "ISAKMP HMAC algorithm" },
  "1.3.6.1.5.5.8.2.2": { d: "iKEIntermediate", c: "IKE ???" },
  "1.3.12.2.1011.7.1": { d: "decEncryptionAlgorithm", c: "DASS algorithm" },
  "1.3.12.2.1011.7.1.2": { d: "decDEA", c: "DASS encryption algorithm" },
  "1.3.12.2.1011.7.2": { d: "decHashAlgorithm", c: "DASS algorithm" },
  "1.3.12.2.1011.7.2.1": { d: "decMD2", c: "DASS hash algorithm" },
  "1.3.12.2.1011.7.2.2": { d: "decMD4", c: "DASS hash algorithm" },
  "1.3.12.2.1011.7.3": { d: "decSignatureAlgorithm", c: "DASS algorithm" },
  "1.3.12.2.1011.7.3.1": { d: "decMD2withRSA", c: "DASS signature algorithm" },
  "1.3.12.2.1011.7.3.2": { d: "decMD4withRSA", c: "DASS signature algorithm" },
  "1.3.12.2.1011.7.3.3": { d: "decDEAMAC", c: "DASS signature algorithm" },
  "1.3.14.2.26.5": { d: "sha", c: "Unsure about this OID" },
  "1.3.14.3.2.1.1": { d: "rsa", c: "X.509. Unsure about this OID" },
  "1.3.14.3.2.2": { d: "md4WitRSA", c: "Oddball OIW OID" },
  "1.3.14.3.2.3": { d: "md5WithRSA", c: "Oddball OIW OID" },
  "1.3.14.3.2.4": { d: "md4WithRSAEncryption", c: "Oddball OIW OID" },
  "1.3.14.3.2.2.1": { d: "sqmod-N", c: "X.509. Deprecated", w: !0 },
  "1.3.14.3.2.3.1": { d: "sqmod-NwithRSA", c: "X.509. Deprecated", w: !0 },
  "1.3.14.3.2.6": { d: "desECB", c: "" },
  "1.3.14.3.2.7": { d: "desCBC", c: "" },
  "1.3.14.3.2.8": { d: "desOFB", c: "" },
  "1.3.14.3.2.9": { d: "desCFB", c: "" },
  "1.3.14.3.2.10": { d: "desMAC", c: "" },
  "1.3.14.3.2.11": { d: "rsaSignature", c: "ISO 9796-2, also X9.31 Part 1" },
  "1.3.14.3.2.12": { d: "dsa", c: "OIW?, supposedly from an incomplete version of SDN.701 (doesn't match final SDN.701)", w: !0 },
  "1.3.14.3.2.13": { d: "dsaWithSHA", c: "Oddball OIW OID.  Incorrectly used by JDK 1.1 in place of (1 3 14 3 2 27)", w: !0 },
  "1.3.14.3.2.14": { d: "mdc2WithRSASignature", c: "Oddball OIW OID using 9796-2 padding rules" },
  "1.3.14.3.2.15": { d: "shaWithRSASignature", c: "Oddball OIW OID using 9796-2 padding rules" },
  "1.3.14.3.2.16": { d: "dhWithCommonModulus", c: "Oddball OIW OID. Deprecated, use a plain DH OID instead", w: !0 },
  "1.3.14.3.2.17": { d: "desEDE", c: "Oddball OIW OID. Mode is ECB" },
  "1.3.14.3.2.18": { d: "sha", c: "Oddball OIW OID" },
  "1.3.14.3.2.19": { d: "mdc-2", c: "Oddball OIW OID, DES-based hash, planned for X9.31 Part 2" },
  "1.3.14.3.2.20": { d: "dsaCommon", c: "Oddball OIW OID.  Deprecated, use a plain DSA OID instead", w: !0 },
  "1.3.14.3.2.21": { d: "dsaCommonWithSHA", c: "Oddball OIW OID.  Deprecated, use a plain dsaWithSHA OID instead", w: !0 },
  "1.3.14.3.2.22": { d: "rsaKeyTransport", c: "Oddball OIW OID" },
  "1.3.14.3.2.23": { d: "keyed-hash-seal", c: "Oddball OIW OID" },
  "1.3.14.3.2.24": { d: "md2WithRSASignature", c: "Oddball OIW OID using 9796-2 padding rules" },
  "1.3.14.3.2.25": { d: "md5WithRSASignature", c: "Oddball OIW OID using 9796-2 padding rules" },
  "1.3.14.3.2.26": { d: "sha1", c: "OIW" },
  "1.3.14.3.2.27": { d: "dsaWithSHA1", c: "OIW. This OID may also be assigned as ripemd-160" },
  "1.3.14.3.2.28": { d: "dsaWithCommonSHA1", c: "OIW" },
  "1.3.14.3.2.29": { d: "sha-1WithRSAEncryption", c: "Oddball OIW OID" },
  "1.3.14.3.3.1": { d: "simple-strong-auth-mechanism", c: "Oddball OIW OID" },
  "1.3.14.7.2.1.1": { d: "ElGamal", c: "Unsure about this OID" },
  "1.3.14.7.2.3.1": { d: "md2WithRSA", c: "Unsure about this OID" },
  "1.3.14.7.2.3.2": { d: "md2WithElGamal", c: "Unsure about this OID" },
  "1.3.36.1": { d: "document", c: "Teletrust document" },
  "1.3.36.1.1": { d: "finalVersion", c: "Teletrust document" },
  "1.3.36.1.2": { d: "draft", c: "Teletrust document" },
  "1.3.36.2": { d: "sio", c: "Teletrust sio" },
  "1.3.36.2.1": { d: "sedu", c: "Teletrust sio" },
  "1.3.36.3": { d: "algorithm", c: "Teletrust algorithm" },
  "1.3.36.3.1": { d: "encryptionAlgorithm", c: "Teletrust algorithm" },
  "1.3.36.3.1.1": { d: "des", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.1.1": { d: "desECB_pad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.1.1.1": { d: "desECB_ISOpad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.1.2.1": { d: "desCBC_pad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.1.2.1.1": { d: "desCBC_ISOpad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.3": { d: "des_3", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.3.1.1": { d: "des_3ECB_pad", c: "Teletrust encryption algorithm. EDE triple DES" },
  "1.3.36.3.1.3.1.1.1": { d: "des_3ECB_ISOpad", c: "Teletrust encryption algorithm. EDE triple DES" },
  "1.3.36.3.1.3.2.1": { d: "des_3CBC_pad", c: "Teletrust encryption algorithm. EDE triple DES" },
  "1.3.36.3.1.3.2.1.1": { d: "des_3CBC_ISOpad", c: "Teletrust encryption algorithm. EDE triple DES" },
  "1.3.36.3.1.2": { d: "idea", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.1": { d: "ideaECB", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.1.1": { d: "ideaECB_pad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.1.1.1": { d: "ideaECB_ISOpad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.2": { d: "ideaCBC", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.2.1": { d: "ideaCBC_pad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.2.1.1": { d: "ideaCBC_ISOpad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.3": { d: "ideaOFB", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.2.4": { d: "ideaCFB", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.4": { d: "rsaEncryption", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.4.512.17": { d: "rsaEncryptionWithlmod512expe17", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.5": { d: "bsi-1", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.5.1": { d: "bsi_1ECB_pad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.5.2": { d: "bsi_1CBC_pad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.1.5.2.1": { d: "bsi_1CBC_PEMpad", c: "Teletrust encryption algorithm" },
  "1.3.36.3.2": { d: "hashAlgorithm", c: "Teletrust algorithm" },
  "1.3.36.3.2.1": { d: "ripemd160", c: "Teletrust hash algorithm" },
  "1.3.36.3.2.2": { d: "ripemd128", c: "Teletrust hash algorithm" },
  "1.3.36.3.2.3": { d: "ripemd256", c: "Teletrust hash algorithm" },
  "1.3.36.3.2.4": { d: "mdc2singleLength", c: "Teletrust hash algorithm" },
  "1.3.36.3.2.5": { d: "mdc2doubleLength", c: "Teletrust hash algorithm" },
  "1.3.36.3.3": { d: "signatureAlgorithm", c: "Teletrust algorithm" },
  "1.3.36.3.3.1": { d: "rsaSignature", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.1.1": { d: "rsaSignatureWithsha1", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.1.1.1024.11": { d: "rsaSignatureWithsha1_l1024_l11", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.1.2": { d: "rsaSignatureWithripemd160", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.1.2.1024.11": { d: "rsaSignatureWithripemd160_l1024_l11", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.1.3": { d: "rsaSignatureWithrimpemd128", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.1.4": { d: "rsaSignatureWithrimpemd256", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.2": { d: "ecsieSign", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.2.1": { d: "ecsieSignWithsha1", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.2.2": { d: "ecsieSignWithripemd160", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.2.3": { d: "ecsieSignWithmd2", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.2.4": { d: "ecsieSignWithmd5", c: "Teletrust signature algorithm" },
  "1.3.36.3.3.2.8.1.1.1": { d: "brainpoolP160r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.2": { d: "brainpoolP160t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.3": { d: "brainpoolP192r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.4": { d: "brainpoolP192t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.5": { d: "brainpoolP224r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.6": { d: "brainpoolP224t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.7": { d: "brainpoolP256r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.8": { d: "brainpoolP256t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.9": { d: "brainpoolP320r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.10": { d: "brainpoolP320t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.11": { d: "brainpoolP384r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.12": { d: "brainpoolP384t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.13": { d: "brainpoolP512r1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.3.2.8.1.1.14": { d: "brainpoolP512t1", c: "ECC Brainpool Standard Curves and Curve Generation" },
  "1.3.36.3.4": { d: "signatureScheme", c: "Teletrust algorithm" },
  "1.3.36.3.4.1": { d: "sigS_ISO9796-1", c: "Teletrust signature scheme" },
  "1.3.36.3.4.2": { d: "sigS_ISO9796-2", c: "Teletrust signature scheme" },
  "1.3.36.3.4.2.1": { d: "sigS_ISO9796-2Withred", c: "Teletrust signature scheme. Unsure what this is supposed to be" },
  "1.3.36.3.4.2.2": { d: "sigS_ISO9796-2Withrsa", c: "Teletrust signature scheme. Unsure what this is supposed to be" },
  "1.3.36.3.4.2.3": { d: "sigS_ISO9796-2Withrnd", c: "Teletrust signature scheme. 9796-2 with random number in padding field" },
  "1.3.36.4": { d: "attribute", c: "Teletrust attribute" },
  "1.3.36.5": { d: "policy", c: "Teletrust policy" },
  "1.3.36.6": { d: "api", c: "Teletrust API" },
  "1.3.36.6.1": { d: "manufacturer-specific_api", c: "Teletrust API" },
  "1.3.36.6.1.1": { d: "utimaco-api", c: "Teletrust API" },
  "1.3.36.6.2": { d: "functionality-specific_api", c: "Teletrust API" },
  "1.3.36.7": { d: "keymgmnt", c: "Teletrust key management" },
  "1.3.36.7.1": { d: "keyagree", c: "Teletrust key management" },
  "1.3.36.7.1.1": { d: "bsiPKE", c: "Teletrust key management" },
  "1.3.36.7.2": { d: "keytrans", c: "Teletrust key management" },
  "1.3.36.7.2.1": { d: "encISO9796-2Withrsa", c: "Teletrust key management. 9796-2 with key stored in hash field" },
  "1.3.36.8.1.1": { d: "Teletrust SigGConform policyIdentifier", c: "Teletrust policy" },
  "1.3.36.8.2.1": { d: "directoryService", c: "Teletrust extended key usage" },
  "1.3.36.8.3.1": { d: "dateOfCertGen", c: "Teletrust attribute" },
  "1.3.36.8.3.2": { d: "procuration", c: "Teletrust attribute" },
  "1.3.36.8.3.3": { d: "admission", c: "Teletrust attribute" },
  "1.3.36.8.3.4": { d: "monetaryLimit", c: "Teletrust attribute" },
  "1.3.36.8.3.5": { d: "declarationOfMajority", c: "Teletrust attribute" },
  "1.3.36.8.3.6": { d: "integratedCircuitCardSerialNumber", c: "Teletrust attribute" },
  "1.3.36.8.3.7": { d: "pKReference", c: "Teletrust attribute" },
  "1.3.36.8.3.8": { d: "restriction", c: "Teletrust attribute" },
  "1.3.36.8.3.9": { d: "retrieveIfAllowed", c: "Teletrust attribute" },
  "1.3.36.8.3.10": { d: "requestedCertificate", c: "Teletrust attribute" },
  "1.3.36.8.3.11": { d: "namingAuthorities", c: "Teletrust attribute" },
  "1.3.36.8.3.11.1": { d: "rechtWirtschaftSteuern", c: "Teletrust naming authorities" },
  "1.3.36.8.3.11.1.1": { d: "rechtsanwaeltin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.2": { d: "rechtsanwalt", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.3": { d: "rechtsBeistand", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.4": { d: "steuerBeraterin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.5": { d: "steuerBerater", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.6": { d: "steuerBevollmaechtigte", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.7": { d: "steuerBevollmaechtigter", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.8": { d: "notarin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.9": { d: "notar", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.10": { d: "notarVertreterin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.11": { d: "notarVertreter", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.12": { d: "notariatsVerwalterin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.13": { d: "notariatsVerwalter", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.14": { d: "wirtschaftsPrueferin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.15": { d: "wirtschaftsPruefer", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.16": { d: "vereidigteBuchprueferin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.17": { d: "vereidigterBuchpruefer", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.18": { d: "patentAnwaeltin", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.11.1.19": { d: "patentAnwalt", c: "Teletrust ProfessionInfo" },
  "1.3.36.8.3.12": { d: "certInDirSince", c: "Teletrust OCSP attribute (obsolete)", w: !0 },
  "1.3.36.8.3.13": { d: "certHash", c: "Teletrust OCSP attribute" },
  "1.3.36.8.3.14": { d: "nameAtBirth", c: "Teletrust attribute" },
  "1.3.36.8.3.15": { d: "additionalInformation", c: "Teletrust attribute" },
  "1.3.36.8.4.1": { d: "personalData", c: "Teletrust OtherName attribute" },
  "1.3.36.8.4.8": { d: "restriction", c: "Teletrust attribute certificate attribute" },
  "1.3.36.8.5.1.1.1": { d: "rsaIndicateSHA1", c: "Teletrust signature algorithm" },
  "1.3.36.8.5.1.1.2": { d: "rsaIndicateRIPEMD160", c: "Teletrust signature algorithm" },
  "1.3.36.8.5.1.1.3": { d: "rsaWithSHA1", c: "Teletrust signature algorithm" },
  "1.3.36.8.5.1.1.4": { d: "rsaWithRIPEMD160", c: "Teletrust signature algorithm" },
  "1.3.36.8.5.1.2.1": { d: "dsaExtended", c: "Teletrust signature algorithm" },
  "1.3.36.8.5.1.2.2": { d: "dsaWithRIPEMD160", c: "Teletrust signature algorithm" },
  "1.3.36.8.6.1": { d: "cert", c: "Teletrust signature attributes" },
  "1.3.36.8.6.2": { d: "certRef", c: "Teletrust signature attributes" },
  "1.3.36.8.6.3": { d: "attrCert", c: "Teletrust signature attributes" },
  "1.3.36.8.6.4": { d: "attrRef", c: "Teletrust signature attributes" },
  "1.3.36.8.6.5": { d: "fileName", c: "Teletrust signature attributes" },
  "1.3.36.8.6.6": { d: "storageTime", c: "Teletrust signature attributes" },
  "1.3.36.8.6.7": { d: "fileSize", c: "Teletrust signature attributes" },
  "1.3.36.8.6.8": { d: "location", c: "Teletrust signature attributes" },
  "1.3.36.8.6.9": { d: "sigNumber", c: "Teletrust signature attributes" },
  "1.3.36.8.6.10": { d: "autoGen", c: "Teletrust signature attributes" },
  "1.3.36.8.7.1.1": { d: "ptAdobeILL", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.2": { d: "ptAmiPro", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.3": { d: "ptAutoCAD", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.4": { d: "ptBinary", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.5": { d: "ptBMP", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.6": { d: "ptCGM", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.7": { d: "ptCorelCRT", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.8": { d: "ptCorelDRW", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.9": { d: "ptCorelEXC", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.10": { d: "ptCorelPHT", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.11": { d: "ptDraw", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.12": { d: "ptDVI", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.13": { d: "ptEPS", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.14": { d: "ptExcel", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.15": { d: "ptGEM", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.16": { d: "ptGIF", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.17": { d: "ptHPGL", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.18": { d: "ptJPEG", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.19": { d: "ptKodak", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.20": { d: "ptLaTeX", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.21": { d: "ptLotus", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.22": { d: "ptLotusPIC", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.23": { d: "ptMacPICT", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.24": { d: "ptMacWord", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.25": { d: "ptMSWfD", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.26": { d: "ptMSWord", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.27": { d: "ptMSWord2", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.28": { d: "ptMSWord6", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.29": { d: "ptMSWord8", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.30": { d: "ptPDF", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.31": { d: "ptPIF", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.32": { d: "ptPostscript", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.33": { d: "ptRTF", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.34": { d: "ptSCITEX", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.35": { d: "ptTAR", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.36": { d: "ptTarga", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.37": { d: "ptTeX", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.38": { d: "ptText", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.39": { d: "ptTIFF", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.40": { d: "ptTIFF-FC", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.41": { d: "ptUID", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.42": { d: "ptUUEncode", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.43": { d: "ptWMF", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.44": { d: "ptWordPerfect", c: "Teletrust presentation types" },
  "1.3.36.8.7.1.45": { d: "ptWPGrph", c: "Teletrust presentation types" },
  "1.3.101.1.4": { d: "thawte-ce", c: "Thawte" },
  "1.3.101.1.4.1": { d: "strongExtranet", c: "Thawte certificate extension" },
  "1.3.101.110": { d: "curveX25519", c: "ECDH 25519 key agreement algorithm" },
  "1.3.101.111": { d: "curveX448", c: "ECDH 448 key agreement algorithm" },
  "1.3.101.112": { d: "curveEd25519", c: "EdDSA 25519 signature algorithm" },
  "1.3.101.113": { d: "curveEd448", c: "EdDSA 448 signature algorithm" },
  "1.3.101.114": { d: "curveEd25519ph", c: "EdDSA 25519 pre-hash signature algorithm" },
  "1.3.101.115": { d: "curveEd448ph", c: "EdDSA 448 pre-hash signature algorithm" },
  "1.3.132.0.1": { d: "sect163k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.2": { d: "sect163r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.3": { d: "sect239k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.4": { d: "sect113r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.5": { d: "sect113r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.6": { d: "secp112r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.7": { d: "secp112r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.8": { d: "secp160r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.9": { d: "secp160k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.10": { d: "secp256k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.15": { d: "sect163r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.16": { d: "sect283k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.17": { d: "sect283r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.22": { d: "sect131r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.23": { d: "sect131r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.24": { d: "sect193r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.25": { d: "sect193r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.26": { d: "sect233k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.27": { d: "sect233r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.28": { d: "secp128r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.29": { d: "secp128r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.30": { d: "secp160r2", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.31": { d: "secp192k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.32": { d: "secp224k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.33": { d: "secp224r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.34": { d: "secp384r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.35": { d: "secp521r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.36": { d: "sect409k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.37": { d: "sect409r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.38": { d: "sect571k1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.0.39": { d: "sect571r1", c: "SECG (Certicom) named elliptic curve" },
  "1.3.132.1.11.1": { d: "ecdhX963KDF-SHA256", c: "SECG (Certicom) elliptic curve key agreement" },
  "1.3.132.1.11.2": { d: "ecdhX963KDF-SHA384", c: "SECG (Certicom) elliptic curve key agreement" },
  "1.3.132.1.11.3": { d: "ecdhX963KDF-SHA512", c: "SECG (Certicom) elliptic curve key agreement" },
  "1.3.133.16.840.9.44": { d: "x944", c: "X9.44" },
  "1.3.133.16.840.9.44.1": { d: "x944Components", c: "X9.44" },
  "1.3.133.16.840.9.44.1.1": { d: "x944Kdf2", c: "X9.44" },
  "1.3.133.16.840.9.44.1.2": { d: "x944Kdf3", c: "X9.44" },
  "1.3.133.16.840.9.84": { d: "x984", c: "X9.84" },
  "1.3.133.16.840.9.84.0": { d: "x984Module", c: "X9.84" },
  "1.3.133.16.840.9.84.0.1": { d: "x984Biometrics", c: "X9.84 Module" },
  "1.3.133.16.840.9.84.0.2": { d: "x984CMS", c: "X9.84 Module" },
  "1.3.133.16.840.9.84.0.3": { d: "x984Identifiers", c: "X9.84 Module" },
  "1.3.133.16.840.9.84.1": { d: "x984Biometric", c: "X9.84" },
  "1.3.133.16.840.9.84.1.0": { d: "biometricUnknownType", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.1": { d: "biometricBodyOdor", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.2": { d: "biometricDNA", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.3": { d: "biometricEarShape", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.4": { d: "biometricFacialFeatures", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.5": { d: "biometricFingerImage", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.6": { d: "biometricFingerGeometry", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.7": { d: "biometricHandGeometry", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.8": { d: "biometricIrisFeatures", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.9": { d: "biometricKeystrokeDynamics", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.10": { d: "biometricPalm", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.11": { d: "biometricRetina", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.12": { d: "biometricSignature", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.13": { d: "biometricSpeechPattern", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.14": { d: "biometricThermalImage", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.15": { d: "biometricVeinPattern", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.16": { d: "biometricThermalFaceImage", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.17": { d: "biometricThermalHandImage", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.18": { d: "biometricLipMovement", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.1.19": { d: "biometricGait", c: "X9.84 Biometric" },
  "1.3.133.16.840.9.84.3": { d: "x984MatchingMethod", c: "X9.84" },
  "1.3.133.16.840.9.84.4": { d: "x984FormatOwner", c: "X9.84" },
  "1.3.133.16.840.9.84.4.0": { d: "x984CbeffOwner", c: "X9.84 Format Owner" },
  "1.3.133.16.840.9.84.4.1": { d: "x984IbiaOwner", c: "X9.84 Format Owner" },
  "1.3.133.16.840.9.84.4.1.1": { d: "ibiaOwnerSAFLINK", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.2": { d: "ibiaOwnerBioscrypt", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.3": { d: "ibiaOwnerVisionics", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.4": { d: "ibiaOwnerInfineonTechnologiesAG", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.5": { d: "ibiaOwnerIridianTechnologies", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.6": { d: "ibiaOwnerVeridicom", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.7": { d: "ibiaOwnerCyberSIGN", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.8": { d: "ibiaOwnereCryp", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.9": { d: "ibiaOwnerFingerprintCardsAB", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.10": { d: "ibiaOwnerSecuGen", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.11": { d: "ibiaOwnerPreciseBiometric", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.12": { d: "ibiaOwnerIdentix", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.13": { d: "ibiaOwnerDERMALOG", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.14": { d: "ibiaOwnerLOGICO", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.15": { d: "ibiaOwnerNIST", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.16": { d: "ibiaOwnerA3Vision", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.17": { d: "ibiaOwnerNEC", c: "X9.84 IBIA Format Owner" },
  "1.3.133.16.840.9.84.4.1.18": { d: "ibiaOwnerSTMicroelectronics", c: "X9.84 IBIA Format Owner" },
  "2.5.4.0": { d: "objectClass", c: "X.520 DN component" },
  "2.5.4.1": { d: "aliasedEntryName", c: "X.520 DN component" },
  "2.5.4.2": { d: "knowledgeInformation", c: "X.520 DN component" },
  "2.5.4.3": { d: "commonName", c: "X.520 DN component" },
  "2.5.4.4": { d: "surname", c: "X.520 DN component" },
  "2.5.4.5": { d: "serialNumber", c: "X.520 DN component" },
  "2.5.4.6": { d: "countryName", c: "X.520 DN component" },
  "2.5.4.7": { d: "localityName", c: "X.520 DN component" },
  "2.5.4.7.1": { d: "collectiveLocalityName", c: "X.520 DN component" },
  "2.5.4.8": { d: "stateOrProvinceName", c: "X.520 DN component" },
  "2.5.4.8.1": { d: "collectiveStateOrProvinceName", c: "X.520 DN component" },
  "2.5.4.9": { d: "streetAddress", c: "X.520 DN component" },
  "2.5.4.9.1": { d: "collectiveStreetAddress", c: "X.520 DN component" },
  "2.5.4.10": { d: "organizationName", c: "X.520 DN component" },
  "2.5.4.10.1": { d: "collectiveOrganizationName", c: "X.520 DN component" },
  "2.5.4.11": { d: "organizationalUnitName", c: "X.520 DN component" },
  "2.5.4.11.1": { d: "collectiveOrganizationalUnitName", c: "X.520 DN component" },
  "2.5.4.12": { d: "title", c: "X.520 DN component" },
  "2.5.4.13": { d: "description", c: "X.520 DN component" },
  "2.5.4.14": { d: "searchGuide", c: "X.520 DN component" },
  "2.5.4.15": { d: "businessCategory", c: "X.520 DN component" },
  "2.5.4.16": { d: "postalAddress", c: "X.520 DN component" },
  "2.5.4.16.1": { d: "collectivePostalAddress", c: "X.520 DN component" },
  "2.5.4.17": { d: "postalCode", c: "X.520 DN component" },
  "2.5.4.17.1": { d: "collectivePostalCode", c: "X.520 DN component" },
  "2.5.4.18": { d: "postOfficeBox", c: "X.520 DN component" },
  "2.5.4.18.1": { d: "collectivePostOfficeBox", c: "X.520 DN component" },
  "2.5.4.19": { d: "physicalDeliveryOfficeName", c: "X.520 DN component" },
  "2.5.4.19.1": { d: "collectivePhysicalDeliveryOfficeName", c: "X.520 DN component" },
  "2.5.4.20": { d: "telephoneNumber", c: "X.520 DN component" },
  "2.5.4.20.1": { d: "collectiveTelephoneNumber", c: "X.520 DN component" },
  "2.5.4.21": { d: "telexNumber", c: "X.520 DN component" },
  "2.5.4.21.1": { d: "collectiveTelexNumber", c: "X.520 DN component" },
  "2.5.4.22": { d: "teletexTerminalIdentifier", c: "X.520 DN component" },
  "2.5.4.22.1": { d: "collectiveTeletexTerminalIdentifier", c: "X.520 DN component" },
  "2.5.4.23": { d: "facsimileTelephoneNumber", c: "X.520 DN component" },
  "2.5.4.23.1": { d: "collectiveFacsimileTelephoneNumber", c: "X.520 DN component" },
  "2.5.4.24": { d: "x121Address", c: "X.520 DN component" },
  "2.5.4.25": { d: "internationalISDNNumber", c: "X.520 DN component" },
  "2.5.4.25.1": { d: "collectiveInternationalISDNNumber", c: "X.520 DN component" },
  "2.5.4.26": { d: "registeredAddress", c: "X.520 DN component" },
  "2.5.4.27": { d: "destinationIndicator", c: "X.520 DN component" },
  "2.5.4.28": { d: "preferredDeliveryMehtod", c: "X.520 DN component" },
  "2.5.4.29": { d: "presentationAddress", c: "X.520 DN component" },
  "2.5.4.30": { d: "supportedApplicationContext", c: "X.520 DN component" },
  "2.5.4.31": { d: "member", c: "X.520 DN component" },
  "2.5.4.32": { d: "owner", c: "X.520 DN component" },
  "2.5.4.33": { d: "roleOccupant", c: "X.520 DN component" },
  "2.5.4.34": { d: "seeAlso", c: "X.520 DN component" },
  "2.5.4.35": { d: "userPassword", c: "X.520 DN component" },
  "2.5.4.36": { d: "userCertificate", c: "X.520 DN component" },
  "2.5.4.37": { d: "caCertificate", c: "X.520 DN component" },
  "2.5.4.38": { d: "authorityRevocationList", c: "X.520 DN component" },
  "2.5.4.39": { d: "certificateRevocationList", c: "X.520 DN component" },
  "2.5.4.40": { d: "crossCertificatePair", c: "X.520 DN component" },
  "2.5.4.41": { d: "name", c: "X.520 DN component" },
  "2.5.4.42": { d: "givenName", c: "X.520 DN component" },
  "2.5.4.43": { d: "initials", c: "X.520 DN component" },
  "2.5.4.44": { d: "generationQualifier", c: "X.520 DN component" },
  "2.5.4.45": { d: "uniqueIdentifier", c: "X.520 DN component" },
  "2.5.4.46": { d: "dnQualifier", c: "X.520 DN component" },
  "2.5.4.47": { d: "enhancedSearchGuide", c: "X.520 DN component" },
  "2.5.4.48": { d: "protocolInformation", c: "X.520 DN component" },
  "2.5.4.49": { d: "distinguishedName", c: "X.520 DN component" },
  "2.5.4.50": { d: "uniqueMember", c: "X.520 DN component" },
  "2.5.4.51": { d: "houseIdentifier", c: "X.520 DN component" },
  "2.5.4.52": { d: "supportedAlgorithms", c: "X.520 DN component" },
  "2.5.4.53": { d: "deltaRevocationList", c: "X.520 DN component" },
  "2.5.4.54": { d: "dmdName", c: "X.520 DN component" },
  "2.5.4.55": { d: "clearance", c: "X.520 DN component" },
  "2.5.4.56": { d: "defaultDirQop", c: "X.520 DN component" },
  "2.5.4.57": { d: "attributeIntegrityInfo", c: "X.520 DN component" },
  "2.5.4.58": { d: "attributeCertificate", c: "X.520 DN component" },
  "2.5.4.59": { d: "attributeCertificateRevocationList", c: "X.520 DN component" },
  "2.5.4.60": { d: "confKeyInfo", c: "X.520 DN component" },
  "2.5.4.61": { d: "aACertificate", c: "X.520 DN component" },
  "2.5.4.62": { d: "attributeDescriptorCertificate", c: "X.520 DN component" },
  "2.5.4.63": { d: "attributeAuthorityRevocationList", c: "X.520 DN component" },
  "2.5.4.64": { d: "familyInformation", c: "X.520 DN component" },
  "2.5.4.65": { d: "pseudonym", c: "X.520 DN component" },
  "2.5.4.66": { d: "communicationsService", c: "X.520 DN component" },
  "2.5.4.67": { d: "communicationsNetwork", c: "X.520 DN component" },
  "2.5.4.68": { d: "certificationPracticeStmt", c: "X.520 DN component" },
  "2.5.4.69": { d: "certificatePolicy", c: "X.520 DN component" },
  "2.5.4.70": { d: "pkiPath", c: "X.520 DN component" },
  "2.5.4.71": { d: "privPolicy", c: "X.520 DN component" },
  "2.5.4.72": { d: "role", c: "X.520 DN component" },
  "2.5.4.73": { d: "delegationPath", c: "X.520 DN component" },
  "2.5.4.74": { d: "protPrivPolicy", c: "X.520 DN component" },
  "2.5.4.75": { d: "xMLPrivilegeInfo", c: "X.520 DN component" },
  "2.5.4.76": { d: "xmlPrivPolicy", c: "X.520 DN component" },
  "2.5.4.82": { d: "permission", c: "X.520 DN component" },
  "2.5.6.0": { d: "top", c: "X.520 objectClass" },
  "2.5.6.1": { d: "alias", c: "X.520 objectClass" },
  "2.5.6.2": { d: "country", c: "X.520 objectClass" },
  "2.5.6.3": { d: "locality", c: "X.520 objectClass" },
  "2.5.6.4": { d: "organization", c: "X.520 objectClass" },
  "2.5.6.5": { d: "organizationalUnit", c: "X.520 objectClass" },
  "2.5.6.6": { d: "person", c: "X.520 objectClass" },
  "2.5.6.7": { d: "organizationalPerson", c: "X.520 objectClass" },
  "2.5.6.8": { d: "organizationalRole", c: "X.520 objectClass" },
  "2.5.6.9": { d: "groupOfNames", c: "X.520 objectClass" },
  "2.5.6.10": { d: "residentialPerson", c: "X.520 objectClass" },
  "2.5.6.11": { d: "applicationProcess", c: "X.520 objectClass" },
  "2.5.6.12": { d: "applicationEntity", c: "X.520 objectClass" },
  "2.5.6.13": { d: "dSA", c: "X.520 objectClass" },
  "2.5.6.14": { d: "device", c: "X.520 objectClass" },
  "2.5.6.15": { d: "strongAuthenticationUser", c: "X.520 objectClass" },
  "2.5.6.16": { d: "certificateAuthority", c: "X.520 objectClass" },
  "2.5.6.17": { d: "groupOfUniqueNames", c: "X.520 objectClass" },
  "2.5.6.21": { d: "pkiUser", c: "X.520 objectClass" },
  "2.5.6.22": { d: "pkiCA", c: "X.520 objectClass" },
  "2.5.8.1.1": { d: "rsa", c: "X.500 algorithms.  Ambiguous, since no padding rules specified", w: !0 },
  "2.5.29.1": { d: "authorityKeyIdentifier", c: "X.509 extension.  Deprecated, use 2 5 29 35 instead", w: !0 },
  "2.5.29.2": { d: "keyAttributes", c: "X.509 extension.  Obsolete, use keyUsage/extKeyUsage instead", w: !0 },
  "2.5.29.3": { d: "certificatePolicies", c: "X.509 extension.  Deprecated, use 2 5 29 32 instead", w: !0 },
  "2.5.29.4": { d: "keyUsageRestriction", c: "X.509 extension.  Obsolete, use keyUsage/extKeyUsage instead", w: !0 },
  "2.5.29.5": { d: "policyMapping", c: "X.509 extension.  Deprecated, use 2 5 29 33 instead", w: !0 },
  "2.5.29.6": { d: "subtreesConstraint", c: "X.509 extension.  Obsolete, use nameConstraints instead", w: !0 },
  "2.5.29.7": { d: "subjectAltName", c: "X.509 extension.  Deprecated, use 2 5 29 17 instead", w: !0 },
  "2.5.29.8": { d: "issuerAltName", c: "X.509 extension.  Deprecated, use 2 5 29 18 instead", w: !0 },
  "2.5.29.9": { d: "subjectDirectoryAttributes", c: "X.509 extension" },
  "2.5.29.10": { d: "basicConstraints", c: "X.509 extension.  Deprecated, use 2 5 29 19 instead", w: !0 },
  "2.5.29.11": { d: "nameConstraints", c: "X.509 extension.  Deprecated, use 2 5 29 30 instead", w: !0 },
  "2.5.29.12": { d: "policyConstraints", c: "X.509 extension.  Deprecated, use 2 5 29 36 instead", w: !0 },
  "2.5.29.13": { d: "basicConstraints", c: "X.509 extension.  Deprecated, use 2 5 29 19 instead", w: !0 },
  "2.5.29.14": { d: "subjectKeyIdentifier", c: "X.509 extension" },
  "2.5.29.15": { d: "keyUsage", c: "X.509 extension" },
  "2.5.29.16": { d: "privateKeyUsagePeriod", c: "X.509 extension" },
  "2.5.29.17": { d: "subjectAltName", c: "X.509 extension" },
  "2.5.29.18": { d: "issuerAltName", c: "X.509 extension" },
  "2.5.29.19": { d: "basicConstraints", c: "X.509 extension" },
  "2.5.29.20": { d: "cRLNumber", c: "X.509 extension" },
  "2.5.29.21": { d: "cRLReason", c: "X.509 extension" },
  "2.5.29.22": { d: "expirationDate", c: "X.509 extension.  Deprecated, alternative OID uncertain", w: !0 },
  "2.5.29.23": { d: "instructionCode", c: "X.509 extension" },
  "2.5.29.24": { d: "invalidityDate", c: "X.509 extension" },
  "2.5.29.25": { d: "cRLDistributionPoints", c: "X.509 extension.  Deprecated, use 2 5 29 31 instead", w: !0 },
  "2.5.29.26": { d: "issuingDistributionPoint", c: "X.509 extension.  Deprecated, use 2 5 29 28 instead", w: !0 },
  "2.5.29.27": { d: "deltaCRLIndicator", c: "X.509 extension" },
  "2.5.29.28": { d: "issuingDistributionPoint", c: "X.509 extension" },
  "2.5.29.29": { d: "certificateIssuer", c: "X.509 extension" },
  "2.5.29.30": { d: "nameConstraints", c: "X.509 extension" },
  "2.5.29.31": { d: "cRLDistributionPoints", c: "X.509 extension" },
  "2.5.29.32": { d: "certificatePolicies", c: "X.509 extension" },
  "2.5.29.32.0": { d: "anyPolicy", c: "X.509 certificate policy" },
  "2.5.29.33": { d: "policyMappings", c: "X.509 extension" },
  "2.5.29.34": { d: "policyConstraints", c: "X.509 extension.  Deprecated, use 2 5 29 36 instead", w: !0 },
  "2.5.29.35": { d: "authorityKeyIdentifier", c: "X.509 extension" },
  "2.5.29.36": { d: "policyConstraints", c: "X.509 extension" },
  "2.5.29.37": { d: "extKeyUsage", c: "X.509 extension" },
  "2.5.29.37.0": { d: "anyExtendedKeyUsage", c: "X.509 extended key usage" },
  "2.5.29.38": { d: "authorityAttributeIdentifier", c: "X.509 extension" },
  "2.5.29.39": { d: "roleSpecCertIdentifier", c: "X.509 extension" },
  "2.5.29.40": { d: "cRLStreamIdentifier", c: "X.509 extension" },
  "2.5.29.41": { d: "basicAttConstraints", c: "X.509 extension" },
  "2.5.29.42": { d: "delegatedNameConstraints", c: "X.509 extension" },
  "2.5.29.43": { d: "timeSpecification", c: "X.509 extension" },
  "2.5.29.44": { d: "cRLScope", c: "X.509 extension" },
  "2.5.29.45": { d: "statusReferrals", c: "X.509 extension" },
  "2.5.29.46": { d: "freshestCRL", c: "X.509 extension" },
  "2.5.29.47": { d: "orderedList", c: "X.509 extension" },
  "2.5.29.48": { d: "attributeDescriptor", c: "X.509 extension" },
  "2.5.29.49": { d: "userNotice", c: "X.509 extension" },
  "2.5.29.50": { d: "sOAIdentifier", c: "X.509 extension" },
  "2.5.29.51": { d: "baseUpdateTime", c: "X.509 extension" },
  "2.5.29.52": { d: "acceptableCertPolicies", c: "X.509 extension" },
  "2.5.29.53": { d: "deltaInfo", c: "X.509 extension" },
  "2.5.29.54": { d: "inhibitAnyPolicy", c: "X.509 extension" },
  "2.5.29.55": { d: "targetInformation", c: "X.509 extension" },
  "2.5.29.56": { d: "noRevAvail", c: "X.509 extension" },
  "2.5.29.57": { d: "acceptablePrivilegePolicies", c: "X.509 extension" },
  "2.5.29.58": { d: "toBeRevoked", c: "X.509 extension" },
  "2.5.29.59": { d: "revokedGroups", c: "X.509 extension" },
  "2.5.29.60": { d: "expiredCertsOnCRL", c: "X.509 extension" },
  "2.5.29.61": { d: "indirectIssuer", c: "X.509 extension" },
  "2.5.29.62": { d: "noAssertion", c: "X.509 extension" },
  "2.5.29.63": { d: "aAissuingDistributionPoint", c: "X.509 extension" },
  "2.5.29.64": { d: "issuedOnBehalfOf", c: "X.509 extension" },
  "2.5.29.65": { d: "singleUse", c: "X.509 extension" },
  "2.5.29.66": { d: "groupAC", c: "X.509 extension" },
  "2.5.29.67": { d: "allowedAttAss", c: "X.509 extension" },
  "2.5.29.68": { d: "attributeMappings", c: "X.509 extension" },
  "2.5.29.69": { d: "holderNameConstraints", c: "X.509 extension" },
  "2.16.724.1.2.2.4.1": { d: "personalDataInfo", c: "Spanish Government PKI?" },
  "2.16.840.1.101.2.1.1.1": { d: "sdnsSignatureAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.2": { d: "fortezzaSignatureAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicSignatureAlgorithm, this OID is better known as dsaWithSHA-1." },
  "2.16.840.1.101.2.1.1.3": { d: "sdnsConfidentialityAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.4": { d: "fortezzaConfidentialityAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicConfidentialityAlgorithm" },
  "2.16.840.1.101.2.1.1.5": { d: "sdnsIntegrityAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.6": { d: "fortezzaIntegrityAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicIntegrityAlgorithm" },
  "2.16.840.1.101.2.1.1.7": { d: "sdnsTokenProtectionAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.8": { d: "fortezzaTokenProtectionAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly know as mosaicTokenProtectionAlgorithm" },
  "2.16.840.1.101.2.1.1.9": { d: "sdnsKeyManagementAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.10": { d: "fortezzaKeyManagementAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicKeyManagementAlgorithm" },
  "2.16.840.1.101.2.1.1.11": { d: "sdnsKMandSigAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.12": { d: "fortezzaKMandSigAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicKMandSigAlgorithm" },
  "2.16.840.1.101.2.1.1.13": { d: "suiteASignatureAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.14": { d: "suiteAConfidentialityAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.15": { d: "suiteAIntegrityAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.16": { d: "suiteATokenProtectionAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.17": { d: "suiteAKeyManagementAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.18": { d: "suiteAKMandSigAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.19": { d: "fortezzaUpdatedSigAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicUpdatedSigAlgorithm" },
  "2.16.840.1.101.2.1.1.20": { d: "fortezzaKMandUpdSigAlgorithms", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicKMandUpdSigAlgorithms" },
  "2.16.840.1.101.2.1.1.21": { d: "fortezzaUpdatedIntegAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicUpdatedIntegAlgorithm" },
  "2.16.840.1.101.2.1.1.22": { d: "keyExchangeAlgorithm", c: "SDN.700 INFOSEC algorithms.  Formerly known as mosaicKeyEncryptionAlgorithm" },
  "2.16.840.1.101.2.1.1.23": { d: "fortezzaWrap80Algorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.1.24": { d: "kEAKeyEncryptionAlgorithm", c: "SDN.700 INFOSEC algorithms" },
  "2.16.840.1.101.2.1.2.1": { d: "rfc822MessageFormat", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.2": { d: "emptyContent", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.3": { d: "cspContentType", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.42": { d: "mspRev3ContentType", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.48": { d: "mspContentType", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.49": { d: "mspRekeyAgentProtocol", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.50": { d: "mspMMP", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.66": { d: "mspRev3-1ContentType", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.72": { d: "forwardedMSPMessageBodyPart", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.73": { d: "mspForwardedMessageParameters", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.74": { d: "forwardedCSPMsgBodyPart", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.75": { d: "cspForwardedMessageParameters", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.76": { d: "mspMMP2", c: "SDN.700 INFOSEC format" },
  "2.16.840.1.101.2.1.2.78.2": { d: "encryptedKeyPackage", c: "SDN.700 INFOSEC format and RFC 6032" },
  "2.16.840.1.101.2.1.2.78.3": { d: "keyPackageReceipt", c: "SDN.700 INFOSEC format and RFC 7191" },
  "2.16.840.1.101.2.1.2.78.6": { d: "keyPackageError", c: "SDN.700 INFOSEC format and RFC 7191" },
  "2.16.840.1.101.2.1.3.1": { d: "sdnsSecurityPolicy", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.2": { d: "sdnsPRBAC", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.3": { d: "mosaicPRBAC", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.10": { d: "siSecurityPolicy", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.10.0": { d: "siNASP", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.1": { d: "siELCO", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.2": { d: "siTK", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.3": { d: "siDSAP", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.4": { d: "siSSSS", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.5": { d: "siDNASP", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.6": { d: "siBYEMAN", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.7": { d: "siREL-US", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.8": { d: "siREL-AUS", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.9": { d: "siREL-CAN", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.10": { d: "siREL_UK", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.11": { d: "siREL-NZ", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.10.12": { d: "siGeneric", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.11": { d: "genser", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.11.0": { d: "genserNations", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.11.1": { d: "genserComsec", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.11.2": { d: "genserAcquisition", c: "SDN.700 INFOSEC policy (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.3.11.3": { d: "genserSecurityCategories", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.11.3.0": { d: "genserTagSetName", c: "SDN.700 INFOSEC GENSER policy" },
  "2.16.840.1.101.2.1.3.12": { d: "defaultSecurityPolicy", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.13": { d: "capcoMarkings", c: "SDN.700 INFOSEC policy" },
  "2.16.840.1.101.2.1.3.13.0": { d: "capcoSecurityCategories", c: "SDN.700 INFOSEC policy CAPCO markings" },
  "2.16.840.1.101.2.1.3.13.0.1": { d: "capcoTagSetName1", c: "SDN.700 INFOSEC policy CAPCO markings" },
  "2.16.840.1.101.2.1.3.13.0.2": { d: "capcoTagSetName2", c: "SDN.700 INFOSEC policy CAPCO markings" },
  "2.16.840.1.101.2.1.3.13.0.3": { d: "capcoTagSetName3", c: "SDN.700 INFOSEC policy CAPCO markings" },
  "2.16.840.1.101.2.1.3.13.0.4": { d: "capcoTagSetName4", c: "SDN.700 INFOSEC policy CAPCO markings" },
  "2.16.840.1.101.2.1.5.1": { d: "sdnsKeyManagementCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.2": { d: "sdnsUserSignatureCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.3": { d: "sdnsKMandSigCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.4": { d: "fortezzaKeyManagementCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.5": { d: "fortezzaKMandSigCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.6": { d: "fortezzaUserSignatureCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.7": { d: "fortezzaCASignatureCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.8": { d: "sdnsCASignatureCertificate", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.10": { d: "auxiliaryVector", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.11": { d: "mlReceiptPolicy", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.12": { d: "mlMembership", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.13": { d: "mlAdministrators", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.14": { d: "alid", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.20": { d: "janUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.21": { d: "febUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.22": { d: "marUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.23": { d: "aprUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.24": { d: "mayUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.25": { d: "junUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.26": { d: "julUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.27": { d: "augUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.28": { d: "sepUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.29": { d: "octUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.30": { d: "novUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.31": { d: "decUKMs", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.40": { d: "metaSDNSckl", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.41": { d: "sdnsCKL", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.42": { d: "metaSDNSsignatureCKL", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.43": { d: "sdnsSignatureCKL", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.44": { d: "sdnsCertificateRevocationList", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.45": { d: "fortezzaCertificateRevocationList", c: "SDN.700 INFOSEC attributes (superseded)", w: !0 },
  "2.16.840.1.101.2.1.5.46": { d: "fortezzaCKL", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.47": { d: "alExemptedAddressProcessor", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.48": { d: "guard", c: "SDN.700 INFOSEC attributes (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.5.49": { d: "algorithmsSupported", c: "SDN.700 INFOSEC attributes (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.5.50": { d: "suiteAKeyManagementCertificate", c: "SDN.700 INFOSEC attributes (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.5.51": { d: "suiteAKMandSigCertificate", c: "SDN.700 INFOSEC attributes (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.5.52": { d: "suiteAUserSignatureCertificate", c: "SDN.700 INFOSEC attributes (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.5.53": { d: "prbacInfo", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.54": { d: "prbacCAConstraints", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.55": { d: "sigOrKMPrivileges", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.56": { d: "commPrivileges", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.57": { d: "labeledAttribute", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.58": { d: "policyInformationFile", c: "SDN.700 INFOSEC attributes (obsolete)", w: !0 },
  "2.16.840.1.101.2.1.5.59": { d: "secPolicyInformationFile", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.60": { d: "cAClearanceConstraint", c: "SDN.700 INFOSEC attributes" },
  "2.16.840.1.101.2.1.5.65": { d: "keyPkgIdAndReceiptReq", c: "SDN.700 INFOSEC attributes and RFC 7191" },
  "2.16.840.1.101.2.1.5.66": { d: "contentDecryptKeyID", c: "SDN.700 INFOSEC attributes and RFC 6032" },
  "2.16.840.1.101.2.1.5.70": { d: "kpCrlPointers", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.5.71": { d: "kpKeyProvinceV2", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.5.72": { d: "kpManifest", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.7.1": { d: "cspExtns", c: "SDN.700 INFOSEC extensions" },
  "2.16.840.1.101.2.1.7.1.0": { d: "cspCsExtn", c: "SDN.700 INFOSEC extensions" },
  "2.16.840.1.101.2.1.8.1": { d: "mISSISecurityCategories", c: "SDN.700 INFOSEC security category" },
  "2.16.840.1.101.2.1.8.2": { d: "standardSecurityLabelPrivileges", c: "SDN.700 INFOSEC security category" },
  "2.16.840.1.101.2.1.8.3.1": { d: "enumeratedPermissiveAttrs", c: "SDN.700 INFOSEC security category from RFC 7906" },
  "2.16.840.1.101.2.1.8.3.3": { d: "informativeAttrs", c: "SDN.700 INFOSEC security category from RFC 7906" },
  "2.16.840.1.101.2.1.8.3.4": { d: "enumeratedRestrictiveAttrs", c: "SDN.700 INFOSEC security category from RFC 7906" },
  "2.16.840.1.101.2.1.10.1": { d: "sigPrivileges", c: "SDN.700 INFOSEC privileges" },
  "2.16.840.1.101.2.1.10.2": { d: "kmPrivileges", c: "SDN.700 INFOSEC privileges" },
  "2.16.840.1.101.2.1.10.3": { d: "namedTagSetPrivilege", c: "SDN.700 INFOSEC privileges" },
  "2.16.840.1.101.2.1.11.1": { d: "ukDemo", c: "SDN.700 INFOSEC certificate policy" },
  "2.16.840.1.101.2.1.11.2": { d: "usDODClass2", c: "SDN.700 INFOSEC certificate policy" },
  "2.16.840.1.101.2.1.11.3": { d: "usMediumPilot", c: "SDN.700 INFOSEC certificate policy" },
  "2.16.840.1.101.2.1.11.4": { d: "usDODClass4", c: "SDN.700 INFOSEC certificate policy" },
  "2.16.840.1.101.2.1.11.5": { d: "usDODClass3", c: "SDN.700 INFOSEC certificate policy" },
  "2.16.840.1.101.2.1.11.6": { d: "usDODClass5", c: "SDN.700 INFOSEC certificate policy" },
  "2.16.840.1.101.2.1.12.0": { d: "testSecurityPolicy", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.1": { d: "tsp1", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.1.0": { d: "tsp1SecurityCategories", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.1.0.0": { d: "tsp1TagSetZero", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.1.0.1": { d: "tsp1TagSetOne", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.1.0.2": { d: "tsp1TagSetTwo", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.2": { d: "tsp2", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.2.0": { d: "tsp2SecurityCategories", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.2.0.0": { d: "tsp2TagSetZero", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.2.0.1": { d: "tsp2TagSetOne", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.2.0.2": { d: "tsp2TagSetTwo", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.3": { d: "kafka", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.3.0": { d: "kafkaSecurityCategories", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.3.0.1": { d: "kafkaTagSetName1", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.3.0.2": { d: "kafkaTagSetName2", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.0.3.0.3": { d: "kafkaTagSetName3", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.12.1.1": { d: "tcp1", c: "SDN.700 INFOSEC test objects" },
  "2.16.840.1.101.2.1.13.1": { d: "kmaKeyAlgorithm", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.3": { d: "kmaTSECNomenclature", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.5": { d: "kmaKeyDistPeriod", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.6": { d: "kmaKeyValidityPeriod", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.7": { d: "kmaKeyDuration", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.11": { d: "kmaSplitID", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.12": { d: "kmaKeyPkgType", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.13": { d: "kmaKeyPurpose", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.14": { d: "kmaKeyUse", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.15": { d: "kmaTransportKey", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.16": { d: "kmaKeyPkgReceiversV2", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.19": { d: "kmaOtherCertFormats", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.20": { d: "kmaUsefulCerts", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.21": { d: "kmaKeyWrapAlgorithm", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.13.22": { d: "kmaSigUsageV3", c: "SDN.700 INFOSEC attributes and RFC 7906" },
  "2.16.840.1.101.2.1.16.0": { d: "dn", c: "SDN.700 INFOSEC attributes and RFC 7191" },
  "2.16.840.1.101.2.1.22": { d: "errorCodes", c: "RFC 7906 key attribute error codes" },
  "2.16.840.1.101.2.1.22.1": { d: "missingKeyType", c: "RFC 7906 key attribute error codes" },
  "2.16.840.1.101.2.1.22.2": { d: "privacyMarkTooLong", c: "RFC 7906 key attribute error codes" },
  "2.16.840.1.101.2.1.22.3": { d: "unrecognizedSecurityPolicy", c: "RFC 7906 key attribute error codes" },
  "2.16.840.1.101.3.1": { d: "slabel", c: "CSOR GAK", w: !0 },
  "2.16.840.1.101.3.2": { d: "pki", c: "NIST", w: !0 },
  "2.16.840.1.101.3.2.1": { d: "NIST policyIdentifier", c: "NIST policies", w: !0 },
  "2.16.840.1.101.3.2.1.3.1": { d: "fbcaRudimentaryPolicy", c: "Federal Bridge CA Policy" },
  "2.16.840.1.101.3.2.1.3.2": { d: "fbcaBasicPolicy", c: "Federal Bridge CA Policy" },
  "2.16.840.1.101.3.2.1.3.3": { d: "fbcaMediumPolicy", c: "Federal Bridge CA Policy" },
  "2.16.840.1.101.3.2.1.3.4": { d: "fbcaHighPolicy", c: "Federal Bridge CA Policy" },
  "2.16.840.1.101.3.2.1.48.1": { d: "nistTestPolicy1", c: "NIST PKITS policies" },
  "2.16.840.1.101.3.2.1.48.2": { d: "nistTestPolicy2", c: "NIST PKITS policies" },
  "2.16.840.1.101.3.2.1.48.3": { d: "nistTestPolicy3", c: "NIST PKITS policies" },
  "2.16.840.1.101.3.2.1.48.4": { d: "nistTestPolicy4", c: "NIST PKITS policies" },
  "2.16.840.1.101.3.2.1.48.5": { d: "nistTestPolicy5", c: "NIST PKITS policies" },
  "2.16.840.1.101.3.2.1.48.6": { d: "nistTestPolicy6", c: "NIST PKITS policies" },
  "2.16.840.1.101.3.2.2": { d: "gak", c: "CSOR GAK extended key usage", w: !0 },
  "2.16.840.1.101.3.2.2.1": { d: "kRAKey", c: "CSOR GAK extended key usage", w: !0 },
  "2.16.840.1.101.3.2.3": { d: "extensions", c: "CSOR GAK extensions", w: !0 },
  "2.16.840.1.101.3.2.3.1": { d: "kRTechnique", c: "CSOR GAK extensions", w: !0 },
  "2.16.840.1.101.3.2.3.2": { d: "kRecoveryCapable", c: "CSOR GAK extensions", w: !0 },
  "2.16.840.1.101.3.2.3.3": { d: "kR", c: "CSOR GAK extensions", w: !0 },
  "2.16.840.1.101.3.2.4": { d: "keyRecoverySchemes", c: "CSOR GAK", w: !0 },
  "2.16.840.1.101.3.2.5": { d: "krapola", c: "CSOR GAK", w: !0 },
  "2.16.840.1.101.3.3": { d: "arpa", c: "CSOR GAK", w: !0 },
  "2.16.840.1.101.3.4": { d: "nistAlgorithm", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1": { d: "aes", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.1": { d: "aes128-ECB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.2": { d: "aes128-CBC", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.3": { d: "aes128-OFB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.4": { d: "aes128-CFB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.5": { d: "aes128-wrap", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.6": { d: "aes128-GCM", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.7": { d: "aes128-CCM", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.8": { d: "aes128-wrap-pad", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.21": { d: "aes192-ECB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.22": { d: "aes192-CBC", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.23": { d: "aes192-OFB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.24": { d: "aes192-CFB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.25": { d: "aes192-wrap", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.26": { d: "aes192-GCM", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.27": { d: "aes192-CCM", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.28": { d: "aes192-wrap-pad", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.41": { d: "aes256-ECB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.42": { d: "aes256-CBC", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.43": { d: "aes256-OFB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.44": { d: "aes256-CFB", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.45": { d: "aes256-wrap", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.46": { d: "aes256-GCM", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.47": { d: "aes256-CCM", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.1.48": { d: "aes256-wrap-pad", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2": { d: "hashAlgos", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.1": { d: "sha-256", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.2": { d: "sha-384", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.3": { d: "sha-512", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.4": { d: "sha-224", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.11": { d: "shake128", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.12": { d: "shake256", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.17": { d: "shake128len", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.18": { d: "shake256len", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.19": { d: "kmacShake128", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.2.20": { d: "kmacShake256", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.3.1": { d: "dsaWithSha224", c: "NIST Algorithm" },
  "2.16.840.1.101.3.4.3.2": { d: "dsaWithSha256", c: "NIST Algorithm" },
  "2.16.840.1.113719.1.2.8": { d: "novellAlgorithm", c: "Novell" },
  "2.16.840.1.113719.1.2.8.22": { d: "desCbcIV8", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.23": { d: "desCbcPadIV8", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.24": { d: "desEDE2CbcIV8", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.25": { d: "desEDE2CbcPadIV8", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.26": { d: "desEDE3CbcIV8", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.27": { d: "desEDE3CbcPadIV8", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.28": { d: "rc5CbcPad", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.29": { d: "md2WithRSAEncryptionBSafe1", c: "Novell signature algorithm" },
  "2.16.840.1.113719.1.2.8.30": { d: "md5WithRSAEncryptionBSafe1", c: "Novell signature algorithm" },
  "2.16.840.1.113719.1.2.8.31": { d: "sha1WithRSAEncryptionBSafe1", c: "Novell signature algorithm" },
  "2.16.840.1.113719.1.2.8.32": { d: "lmDigest", c: "Novell digest algorithm" },
  "2.16.840.1.113719.1.2.8.40": { d: "md2", c: "Novell digest algorithm" },
  "2.16.840.1.113719.1.2.8.50": { d: "md5", c: "Novell digest algorithm" },
  "2.16.840.1.113719.1.2.8.51": { d: "ikeHmacWithSHA1-RSA", c: "Novell signature algorithm" },
  "2.16.840.1.113719.1.2.8.52": { d: "ikeHmacWithMD5-RSA", c: "Novell signature algorithm" },
  "2.16.840.1.113719.1.2.8.69": { d: "rc2CbcPad", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.82": { d: "sha-1", c: "Novell digest algorithm" },
  "2.16.840.1.113719.1.2.8.92": { d: "rc2BSafe1Cbc", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.95": { d: "md4", c: "Novell digest algorithm" },
  "2.16.840.1.113719.1.2.8.130": { d: "md4Packet", c: "Novell keyed hash" },
  "2.16.840.1.113719.1.2.8.131": { d: "rsaEncryptionBsafe1", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.132": { d: "nwPassword", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.2.8.133": { d: "novellObfuscate-1", c: "Novell encryption algorithm" },
  "2.16.840.1.113719.1.9": { d: "pki", c: "Novell" },
  "2.16.840.1.113719.1.9.4": { d: "pkiAttributeType", c: "Novell PKI" },
  "2.16.840.1.113719.1.9.4.1": { d: "securityAttributes", c: "Novell PKI attribute type" },
  "2.16.840.1.113719.1.9.4.2": { d: "relianceLimit", c: "Novell PKI attribute type" },
  "2.16.840.1.113730.1": { d: "cert-extension", c: "Netscape" },
  "2.16.840.1.113730.1.1": { d: "netscape-cert-type", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.2": { d: "netscape-base-url", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.3": { d: "netscape-revocation-url", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.4": { d: "netscape-ca-revocation-url", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.7": { d: "netscape-cert-renewal-url", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.8": { d: "netscape-ca-policy-url", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.9": { d: "HomePage-url", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.10": { d: "EntityLogo", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.11": { d: "UserPicture", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.12": { d: "netscape-ssl-server-name", c: "Netscape certificate extension" },
  "2.16.840.1.113730.1.13": { d: "netscape-comment", c: "Netscape certificate extension" },
  "2.16.840.1.113730.2": { d: "data-type", c: "Netscape" },
  "2.16.840.1.113730.2.1": { d: "dataGIF", c: "Netscape data type" },
  "2.16.840.1.113730.2.2": { d: "dataJPEG", c: "Netscape data type" },
  "2.16.840.1.113730.2.3": { d: "dataURL", c: "Netscape data type" },
  "2.16.840.1.113730.2.4": { d: "dataHTML", c: "Netscape data type" },
  "2.16.840.1.113730.2.5": { d: "certSequence", c: "Netscape data type" },
  "2.16.840.1.113730.2.6": { d: "certURL", c: "Netscape certificate extension" },
  "2.16.840.1.113730.3": { d: "directory", c: "Netscape" },
  "2.16.840.1.113730.3.1": { d: "ldapDefinitions", c: "Netscape directory" },
  "2.16.840.1.113730.3.1.1": { d: "carLicense", c: "Netscape LDAP definitions" },
  "2.16.840.1.113730.3.1.2": { d: "departmentNumber", c: "Netscape LDAP definitions" },
  "2.16.840.1.113730.3.1.3": { d: "employeeNumber", c: "Netscape LDAP definitions" },
  "2.16.840.1.113730.3.1.4": { d: "employeeType", c: "Netscape LDAP definitions" },
  "2.16.840.1.113730.3.1.216": { d: "userPKCS12", c: "Netscape LDAP definitions" },
  "2.16.840.1.113730.3.2.2": { d: "inetOrgPerson", c: "Netscape LDAP definitions" },
  "2.16.840.1.113730.4.1": { d: "serverGatedCrypto", c: "Netscape" },
  "2.16.840.1.113733.1.6.3": { d: "verisignCZAG", c: "Verisign extension" },
  "2.16.840.1.113733.1.6.6": { d: "verisignInBox", c: "Verisign extension" },
  "2.16.840.1.113733.1.6.11": { d: "verisignOnsiteJurisdictionHash", c: "Verisign extension" },
  "2.16.840.1.113733.1.6.13": { d: "Unknown Verisign VPN extension", c: "Verisign extension" },
  "2.16.840.1.113733.1.6.15": { d: "verisignServerID", c: "Verisign extension" },
  "2.16.840.1.113733.1.7.1.1": { d: "verisignCertPolicies95Qualifier1", c: "Verisign policy" },
  "2.16.840.1.113733.1.7.1.1.1": { d: "verisignCPSv1notice", c: "Verisign policy (obsolete)" },
  "2.16.840.1.113733.1.7.1.1.2": { d: "verisignCPSv1nsi", c: "Verisign policy (obsolete)" },
  "2.16.840.1.113733.1.8.1": { d: "verisignISSStrongCrypto", c: "Verisign" },
  "2.16.840.1.113733.1": { d: "pki", c: "Verisign extension" },
  "2.16.840.1.113733.1.9": { d: "pkcs7Attribute", c: "Verisign PKI extension" },
  "2.16.840.1.113733.1.9.2": { d: "messageType", c: "Verisign PKCS #7 attribute" },
  "2.16.840.1.113733.1.9.3": { d: "pkiStatus", c: "Verisign PKCS #7 attribute" },
  "2.16.840.1.113733.1.9.4": { d: "failInfo", c: "Verisign PKCS #7 attribute" },
  "2.16.840.1.113733.1.9.5": { d: "senderNonce", c: "Verisign PKCS #7 attribute" },
  "2.16.840.1.113733.1.9.6": { d: "recipientNonce", c: "Verisign PKCS #7 attribute" },
  "2.16.840.1.113733.1.9.7": { d: "transID", c: "Verisign PKCS #7 attribute" },
  "2.16.840.1.113733.1.9.8": { d: "extensionReq", c: "Verisign PKCS #7 attribute.  Use PKCS #9 extensionRequest instead", w: !0 },
  "2.16.840.1.113741.2": { d: "intelCDSA", c: "Intel CDSA" },
  "2.16.840.1.114412.1": { d: "digiCertNonEVCerts", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.1": { d: "digiCertOVCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.2": { d: "digiCertDVCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.11": { d: "digiCertFederatedDeviceCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.3.0.1": { d: "digiCertGlobalCAPolicy", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.3.0.2": { d: "digiCertHighAssuranceEVCAPolicy", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.3.0.3": { d: "digiCertGlobalRootCAPolicy", c: "Digicert CA policy" },
  "2.16.840.1.114412.1.3.0.4": { d: "digiCertAssuredIDRootCAPolicy", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.2": { d: "digiCertEVCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.3": { d: "digiCertObjectSigningCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.3.1": { d: "digiCertCodeSigningCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.3.2": { d: "digiCertEVCodeSigningCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.3.11": { d: "digiCertKernelCodeSigningCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.3.21": { d: "digiCertDocumentSigningCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4": { d: "digiCertClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.1.1": { d: "digiCertLevel1PersonalClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.1.2": { d: "digiCertLevel1EnterpriseClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.2": { d: "digiCertLevel2ClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.3.1": { d: "digiCertLevel3USClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.3.2": { d: "digiCertLevel3CBPClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.4.1": { d: "digiCertLevel4USClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.4.2": { d: "digiCertLevel4CBPClientCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.5.1": { d: "digiCertPIVHardwareCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.5.2": { d: "digiCertPIVCardAuthCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.2.4.5.3": { d: "digiCertPIVContentSigningCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.4.31": { d: "digiCertGridClassicCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.4.31.5": { d: "digiCertGridIntegratedCert", c: "Digicert CA policy" },
  "2.16.840.1.114412.31.4.31.1": { d: "digiCertGridHostCert", c: "Digicert CA policy" },
  "2.23.42.0": { d: "contentType", c: "SET" },
  "2.23.42.0.0": { d: "panData", c: "SET contentType" },
  "2.23.42.0.1": { d: "panToken", c: "SET contentType" },
  "2.23.42.0.2": { d: "panOnly", c: "SET contentType" },
  "2.23.42.1": { d: "msgExt", c: "SET" },
  "2.23.42.2": { d: "field", c: "SET" },
  "2.23.42.2.0": { d: "fullName", c: "SET field" },
  "2.23.42.2.1": { d: "givenName", c: "SET field" },
  "2.23.42.2.2": { d: "familyName", c: "SET field" },
  "2.23.42.2.3": { d: "birthFamilyName", c: "SET field" },
  "2.23.42.2.4": { d: "placeName", c: "SET field" },
  "2.23.42.2.5": { d: "identificationNumber", c: "SET field" },
  "2.23.42.2.6": { d: "month", c: "SET field" },
  "2.23.42.2.7": { d: "date", c: "SET field" },
  "2.23.42.2.8": { d: "address", c: "SET field" },
  "2.23.42.2.9": { d: "telephone", c: "SET field" },
  "2.23.42.2.10": { d: "amount", c: "SET field" },
  "2.23.42.2.11": { d: "accountNumber", c: "SET field" },
  "2.23.42.2.12": { d: "passPhrase", c: "SET field" },
  "2.23.42.3": { d: "attribute", c: "SET" },
  "2.23.42.3.0": { d: "cert", c: "SET attribute" },
  "2.23.42.3.0.0": { d: "rootKeyThumb", c: "SET cert attribute" },
  "2.23.42.3.0.1": { d: "additionalPolicy", c: "SET cert attribute" },
  "2.23.42.4": { d: "algorithm", c: "SET" },
  "2.23.42.5": { d: "policy", c: "SET" },
  "2.23.42.5.0": { d: "root", c: "SET policy" },
  "2.23.42.6": { d: "module", c: "SET" },
  "2.23.42.7": { d: "certExt", c: "SET" },
  "2.23.42.7.0": { d: "hashedRootKey", c: "SET cert extension" },
  "2.23.42.7.1": { d: "certificateType", c: "SET cert extension" },
  "2.23.42.7.2": { d: "merchantData", c: "SET cert extension" },
  "2.23.42.7.3": { d: "cardCertRequired", c: "SET cert extension" },
  "2.23.42.7.4": { d: "tunneling", c: "SET cert extension" },
  "2.23.42.7.5": { d: "setExtensions", c: "SET cert extension" },
  "2.23.42.7.6": { d: "setQualifier", c: "SET cert extension" },
  "2.23.42.8": { d: "brand", c: "SET" },
  "2.23.42.8.1": { d: "IATA-ATA", c: "SET brand" },
  "2.23.42.8.4": { d: "VISA", c: "SET brand" },
  "2.23.42.8.5": { d: "MasterCard", c: "SET brand" },
  "2.23.42.8.30": { d: "Diners", c: "SET brand" },
  "2.23.42.8.34": { d: "AmericanExpress", c: "SET brand" },
  "2.23.42.8.6011": { d: "Novus", c: "SET brand" },
  "2.23.42.9": { d: "vendor", c: "SET" },
  "2.23.42.9.0": { d: "GlobeSet", c: "SET vendor" },
  "2.23.42.9.1": { d: "IBM", c: "SET vendor" },
  "2.23.42.9.2": { d: "CyberCash", c: "SET vendor" },
  "2.23.42.9.3": { d: "Terisa", c: "SET vendor" },
  "2.23.42.9.4": { d: "RSADSI", c: "SET vendor" },
  "2.23.42.9.5": { d: "VeriFone", c: "SET vendor" },
  "2.23.42.9.6": { d: "TrinTech", c: "SET vendor" },
  "2.23.42.9.7": { d: "BankGate", c: "SET vendor" },
  "2.23.42.9.8": { d: "GTE", c: "SET vendor" },
  "2.23.42.9.9": { d: "CompuSource", c: "SET vendor" },
  "2.23.42.9.10": { d: "Griffin", c: "SET vendor" },
  "2.23.42.9.11": { d: "Certicom", c: "SET vendor" },
  "2.23.42.9.12": { d: "OSS", c: "SET vendor" },
  "2.23.42.9.13": { d: "TenthMountain", c: "SET vendor" },
  "2.23.42.9.14": { d: "Antares", c: "SET vendor" },
  "2.23.42.9.15": { d: "ECC", c: "SET vendor" },
  "2.23.42.9.16": { d: "Maithean", c: "SET vendor" },
  "2.23.42.9.17": { d: "Netscape", c: "SET vendor" },
  "2.23.42.9.18": { d: "Verisign", c: "SET vendor" },
  "2.23.42.9.19": { d: "BlueMoney", c: "SET vendor" },
  "2.23.42.9.20": { d: "Lacerte", c: "SET vendor" },
  "2.23.42.9.21": { d: "Fujitsu", c: "SET vendor" },
  "2.23.42.9.22": { d: "eLab", c: "SET vendor" },
  "2.23.42.9.23": { d: "Entrust", c: "SET vendor" },
  "2.23.42.9.24": { d: "VIAnet", c: "SET vendor" },
  "2.23.42.9.25": { d: "III", c: "SET vendor" },
  "2.23.42.9.26": { d: "OpenMarket", c: "SET vendor" },
  "2.23.42.9.27": { d: "Lexem", c: "SET vendor" },
  "2.23.42.9.28": { d: "Intertrader", c: "SET vendor" },
  "2.23.42.9.29": { d: "Persimmon", c: "SET vendor" },
  "2.23.42.9.30": { d: "NABLE", c: "SET vendor" },
  "2.23.42.9.31": { d: "espace-net", c: "SET vendor" },
  "2.23.42.9.32": { d: "Hitachi", c: "SET vendor" },
  "2.23.42.9.33": { d: "Microsoft", c: "SET vendor" },
  "2.23.42.9.34": { d: "NEC", c: "SET vendor" },
  "2.23.42.9.35": { d: "Mitsubishi", c: "SET vendor" },
  "2.23.42.9.36": { d: "NCR", c: "SET vendor" },
  "2.23.42.9.37": { d: "e-COMM", c: "SET vendor" },
  "2.23.42.9.38": { d: "Gemplus", c: "SET vendor" },
  "2.23.42.10": { d: "national", c: "SET" },
  "2.23.42.10.392": { d: "Japan", c: "SET national" },
  "2.23.43.1.4": { d: "wTLS-ECC", c: "WAP WTLS" },
  "2.23.43.1.4.1": { d: "wTLS-ECC-curve1", c: "WAP WTLS" },
  "2.23.43.1.4.6": { d: "wTLS-ECC-curve6", c: "WAP WTLS" },
  "2.23.43.1.4.8": { d: "wTLS-ECC-curve8", c: "WAP WTLS" },
  "2.23.43.1.4.9": { d: "wTLS-ECC-curve9", c: "WAP WTLS" },
  "2.23.133": { d: "tCPA", c: "TCPA" },
  "2.23.133.1": { d: "tcpaSpecVersion", c: "TCPA" },
  "2.23.133.2": { d: "tcpaAttribute", c: "TCPA" },
  "2.23.133.2.1": { d: "tcpaTpmManufacturer", c: "TCPA Attribute" },
  "2.23.133.2.2": { d: "tcpaTpmModel", c: "TCPA Attribute" },
  "2.23.133.2.3": { d: "tcpaTpmVersion", c: "TCPA Attribute" },
  "2.23.133.2.4": { d: "tcpaPlatformManufacturer", c: "TCPA Attribute" },
  "2.23.133.2.5": { d: "tcpaPlatformModel", c: "TCPA Attribute" },
  "2.23.133.2.6": { d: "tcpaPlatformVersion", c: "TCPA Attribute" },
  "2.23.133.2.7": { d: "tcpaComponentManufacturer", c: "TCPA Attribute" },
  "2.23.133.2.8": { d: "tcpaComponentModel", c: "TCPA Attribute" },
  "2.23.133.2.9": { d: "tcpaComponentVersion", c: "TCPA Attribute" },
  "2.23.133.2.10": { d: "tcpaSecurityQualities", c: "TCPA Attribute" },
  "2.23.133.2.11": { d: "tcpaTpmProtectionProfile", c: "TCPA Attribute" },
  "2.23.133.2.12": { d: "tcpaTpmSecurityTarget", c: "TCPA Attribute" },
  "2.23.133.2.13": { d: "tcpaFoundationProtectionProfile", c: "TCPA Attribute" },
  "2.23.133.2.14": { d: "tcpaFoundationSecurityTarget", c: "TCPA Attribute" },
  "2.23.133.2.15": { d: "tcpaTpmIdLabel", c: "TCPA Attribute" },
  "2.23.133.3": { d: "tcpaProtocol", c: "TCPA" },
  "2.23.133.3.1": { d: "tcpaPrttTpmIdProtocol", c: "TCPA Protocol" },
  "2.23.134.1.4.2.1": { d: "postSignumRootQCA", c: "PostSignum CA" },
  "2.23.134.1.2.2.3": { d: "postSignumPublicCA", c: "PostSignum CA" },
  "2.23.134.1.2.1.8.210": { d: "postSignumCommercialServerPolicy", c: "PostSignum CA" },
  "2.23.136.1.1.1": { d: "mRTDSignatureData", c: "ICAO MRTD" },
  "2.54.1775.2": { d: "hashedRootKey", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "2.54.1775.3": { d: "certificateType", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "2.54.1775.4": { d: "merchantData", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "2.54.1775.5": { d: "cardCertRequired", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "2.54.1775.6": { d: "tunneling", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "2.54.1775.7": { d: "setQualifier", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "2.54.1775.99": { d: "setData", c: "SET.  Deprecated, use (2 23 42 7 0) instead", w: !0 },
  "1.2.40.0.17.1.22": { d: "A-Trust EV policy", c: "A-Trust CA Root" },
  "1.3.6.1.4.1.34697.2.1": { d: "AffirmTrust EV policy", c: "AffirmTrust Commercial" },
  "1.3.6.1.4.1.34697.2.2": { d: "AffirmTrust EV policy", c: "AffirmTrust Networking" },
  "1.3.6.1.4.1.34697.2.3": { d: "AffirmTrust EV policy", c: "AffirmTrust Premium" },
  "1.3.6.1.4.1.34697.2.4": { d: "AffirmTrust EV policy", c: "AffirmTrust Premium ECC" },
  "2.16.578.1.26.1.3.3": { d: "BuyPass EV policy", c: "BuyPass Class 3 EV" },
  "1.3.6.1.4.1.17326.10.14.2.1.2": { d: "Camerfirma EV policy", c: "Camerfirma CA Root" },
  "1.3.6.1.4.1.17326.10.8.12.1.2": { d: "Camerfirma EV policy", c: "Camerfirma CA Root" },
  "1.3.6.1.4.1.22234.2.5.2.3.1": { d: "CertPlus EV policy", c: "CertPlus Class 2 Primary CA (formerly Keynectis)" },
  "1.3.6.1.4.1.6449.1.2.1.5.1": { d: "Comodo EV policy", c: "COMODO Certification Authority" },
  "1.3.6.1.4.1.6334.1.100.1": { d: "Cybertrust EV policy", c: "Cybertrust Global Root (now Verizon Business)" },
  "1.3.6.1.4.1.4788.2.202.1": { d: "D-TRUST EV policy", c: "D-TRUST Root Class 3 CA 2 EV 2009" },
  "2.16.840.1.114412.2.1": { d: "DigiCert EV policy", c: "DigiCert High Assurance EV Root CA" },
  "2.16.528.1.1001.1.1.1.12.6.1.1.1": { d: "DigiNotar EV policy", c: "DigiNotar Root CA" },
  "2.16.840.1.114028.10.1.2": { d: "Entrust EV policy", c: "Entrust Root Certification Authority" },
  "1.3.6.1.4.1.14370.1.6": { d: "GeoTrust EV policy", c: "GeoTrust Primary Certification Authority (formerly Equifax)" },
  "1.3.6.1.4.1.4146.1.1": { d: "GlobalSign EV policy", c: "GlobalSign" },
  "2.16.840.1.114413.1.7.23.3": { d: "GoDaddy EV policy", c: "GoDaddy Class 2 Certification Authority (formerly ValiCert)" },
  "1.3.6.1.4.1.14777.6.1.1": { d: "Izenpe EV policy", c: "Certificado de Servidor Seguro SSL EV" },
  "1.3.6.1.4.1.14777.6.1.2": { d: "Izenpe EV policy", c: "Certificado de Sede Electronica EV" },
  "1.3.6.1.4.1.782.1.2.1.8.1": { d: "Network Solutions EV policy", c: "Network Solutions Certificate Authority" },
  "1.3.6.1.4.1.8024.0.2.100.1.2": { d: "QuoVadis EV policy", c: "QuoVadis Root CA 2" },
  "1.2.392.200091.100.721.1": { d: "Security Communication (SECOM) EV policy", c: "Security Communication RootCA1" },
  "2.16.840.1.114414.1.7.23.3": { d: "Starfield EV policy", c: "Starfield Class 2 Certification Authority" },
  "1.3.6.1.4.1.23223.1.1.1": { d: "StartCom EV policy", c: "StartCom Certification Authority" },
  "2.16.756.1.89.1.2.1.1": { d: "SwissSign EV policy", c: "SwissSign Gold CA - G2" },
  "1.3.6.1.4.1.7879.13.24.1": { d: "T-TeleSec EV policy", c: "T-TeleSec GlobalRoot Class 3" },
  "2.16.840.1.113733.1.7.48.1": { d: "Thawte EV policy", c: "Thawte Premium Server CA" },
  "2.16.840.1.114404.1.1.2.4.1": { d: "TrustWave EV policy", c: "TrustWave CA, formerly SecureTrust, before that XRamp" },
  "1.3.6.1.4.1.40869.1.1.22.3": { d: "TWCA EV policy", c: "TWCA Root Certification Authority" },
  "2.16.840.1.113733.1.7.23.6": { d: "VeriSign EV policy", c: "VeriSign Class 3 Public Primary Certification Authority" },
  "2.16.840.1.114171.500.9": { d: "Wells Fargo EV policy", c: "Wells Fargo WellsSecure Public Root Certificate Authority" },
  END: ""
};
var B1 = "…", Tt = /^(\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])(?:([0-5]\d)(?:([0-5]\d)(?:[.,](\d{1,3}))?)?)?(Z|[-+](?:[0]\d|1[0-2])([0-5]\d)?)?$/, Dt = /^(\d\d\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])(?:([0-5]\d)(?:([0-5]\d)(?:[.,](\d{1,3}))?)?)?(Z|[-+](?:[0]\d|1[0-2])([0-5]\d)?)?$/;
function ze(e, t) {
  return e.length > t && (e = e.substring(0, t) + B1), e;
}
function ue(e, t) {
  e instanceof ue ? (this.enc = e.enc, this.pos = e.pos) : (this.enc = e, this.pos = t);
}
ue.prototype.get = function(e) {
  if (e === void 0 && (e = this.pos++), e >= this.enc.length)
    throw "Requesting byte offset " + e + " on a stream of length " + this.enc.length;
  return typeof this.enc == "string" ? this.enc.charCodeAt(e) : this.enc[e];
};
ue.prototype.hexDigits = "0123456789ABCDEF";
ue.prototype.hexByte = function(e) {
  return this.hexDigits.charAt(e >> 4 & 15) + this.hexDigits.charAt(e & 15);
};
ue.prototype.hexDump = function(e, t, i) {
  for (var r = "", c = e; c < t; ++c)
    if (r += this.hexByte(this.get(c)), i !== !0)
      switch (c & 15) {
        case 7:
          r += "  ";
          break;
        case 15:
          r += `
`;
          break;
        default:
          r += " ";
      }
  return r;
};
var Re = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
ue.prototype.b64Dump = function(e, t) {
  var i = (t - e) % 3, r = "", c, o;
  for (c = e; c + 2 < t; c += 3)
    o = this.get(c) << 16 | this.get(c + 1) << 8 | this.get(c + 2), r += Re.charAt(o >> 18 & 63), r += Re.charAt(o >> 12 & 63), r += Re.charAt(o >> 6 & 63), r += Re.charAt(o & 63);
  return i > 0 && (o = this.get(c) << 16, i > 1 && (o |= this.get(c + 1) << 8), r += Re.charAt(o >> 18 & 63), r += Re.charAt(o >> 12 & 63), i == 2 && (r += Re.charAt(o >> 6 & 63))), r;
};
ue.prototype.isASCII = function(e, t) {
  for (var i = e; i < t; ++i) {
    var r = this.get(i);
    if (r < 32 || r > 176)
      return !1;
  }
  return !0;
};
ue.prototype.parseStringISO = function(e, t) {
  for (var i = "", r = e; r < t; ++r)
    i += String.fromCharCode(this.get(r));
  return i;
};
ue.prototype.parseStringUTF = function(e, t) {
  function i(a) {
    if (a < 128 || a >= 192)
      throw new Error("Invalid UTF-8 continuation byte: " + a);
    return a & 63;
  }
  function r(a) {
    if (a < 65536)
      throw new Error("UTF-8 overlong encoding, codepoint encoded in 4 bytes: " + a);
    return a -= 65536, String.fromCharCode((a >> 10) + 55296, (a & 1023) + 56320);
  }
  for (var c = "", o = e; o < t; ) {
    var s = this.get(o++);
    if (s < 128)
      c += String.fromCharCode(s);
    else {
      if (s < 192)
        throw new Error("Invalid UTF-8 starting byte: " + s);
      if (s < 224)
        c += String.fromCharCode((s & 31) << 6 | i(this.get(o++)));
      else if (s < 240)
        c += String.fromCharCode((s & 15) << 12 | i(this.get(o++)) << 6 | i(this.get(o++)));
      else if (s < 248)
        c += r((s & 7) << 18 | i(this.get(o++)) << 12 | i(this.get(o++)) << 6 | i(this.get(o++)));
      else
        throw new Error("Invalid UTF-8 starting byte (since 2003 it is restricted to 4 bytes): " + s);
    }
  }
  return c;
};
ue.prototype.parseStringBMP = function(e, t) {
  for (var i = "", r, c, o = e; o < t; )
    r = this.get(o++), c = this.get(o++), i += String.fromCharCode(r << 8 | c);
  return i;
};
ue.prototype.parseTime = function(e, t, i) {
  var r = this.parseStringISO(e, t), c = (i ? Tt : Dt).exec(r);
  return c ? (i && (c[1] = +c[1], c[1] += c[1] < 70 ? 2e3 : 1900), r = c[1] + "-" + c[2] + "-" + c[3] + " " + c[4], c[5] && (r += ":" + c[5], c[6] && (r += ":" + c[6], c[7] && (r += "." + c[7]))), c[8] && (r += " UTC", c[8] != "Z" && (r += c[8], c[9] && (r += ":" + c[9]))), r) : "Unrecognized time: " + r;
};
ue.prototype.parseInteger = function(e, t) {
  for (var i = this.get(e), r = i > 127, c = r ? 255 : 0, o, s = ""; i == c && ++e < t; )
    i = this.get(e);
  if (o = t - e, o === 0)
    return r ? "-1" : "0";
  if (o > 4) {
    for (s = i, o <<= 3; ((s ^ c) & 128) == 0; )
      s <<= 1, --o;
    s = "(" + o + ` bit)
`;
  }
  r && (i = i - 256);
  for (var a = new xe(i), m = e + 1; m < t; ++m)
    a.mulAdd(256, this.get(m));
  return s + a.toString();
};
ue.prototype.parseBitString = function(e, t, i) {
  var r = this.get(e);
  if (r > 7)
    throw "Invalid BitString with unusedBits=" + r;
  for (var c = (t - e - 1 << 3) - r, o = "", s = e + 1; s < t; ++s) {
    for (var a = this.get(s), m = s == t - 1 ? r : 0, S = 7; S >= m; --S)
      o += a >> S & 1 ? "1" : "0";
    o.length > i && (o = ze(o, i));
  }
  return { size: c, str: o };
};
ue.prototype.parseOctetString = function(e, t, i) {
  var r = t - e, c;
  try {
    c = this.parseStringUTF(e, t);
    var o;
    for (s = 0; s < c.length; ++s)
      if (o = c.charCodeAt(s), o < 32 && o != 9 && o != 10 && o != 13)
        throw new Error("Unprintable character at index " + s + " (code " + c.charCodeAt(s) + ")");
    return { size: r, str: c };
  } catch {
  }
  i /= 2, r > i && (t = e + i), c = "";
  for (var s = e; s < t; ++s)
    c += this.hexByte(this.get(s));
  return r > i && (c += B1), { size: r, str: c };
};
ue.prototype.parseOID = function(e, t, i) {
  for (var r = "", c = new xe(), o = 0, s = e; s < t; ++s) {
    var a = this.get(s);
    if (c.mulAdd(128, a & 127), o += 7, !(a & 128)) {
      if (r === "")
        if (c = c.simplify(), c instanceof xe)
          c.sub(80), r = "2." + c.toString();
        else {
          var m = c < 80 ? c < 40 ? 0 : 1 : 2;
          r = m + "." + (c - m * 40);
        }
      else
        r += "." + c.toString();
      if (r.length > i)
        return ze(r, i);
      c = new xe(), o = 0;
    }
  }
  if (o > 0 && (r += ".incomplete"), typeof I1 == "object") {
    var S = I1[r];
    S && (S.d && (r += `
` + S.d), S.c && (r += `
` + S.c), S.w && (r += `
(warning!)`));
  }
  return r;
};
function Se(e, t, i, r, c, o) {
  if (!(r instanceof t1)) throw "Invalid tag value.";
  this.stream = e, this.header = t, this.length = i, this.tag = r, this.tagLen = c, this.sub = o;
}
Se.prototype.typeName = function() {
  switch (this.tag.tagClass) {
    case 0:
      switch (this.tag.tagNumber) {
        case 0:
          return "EOC";
        case 1:
          return "BOOLEAN";
        case 2:
          return "INTEGER";
        case 3:
          return "BIT_STRING";
        case 4:
          return "OCTET_STRING";
        case 5:
          return "NULL";
        case 6:
          return "OBJECT_IDENTIFIER";
        case 7:
          return "ObjectDescriptor";
        case 8:
          return "EXTERNAL";
        case 9:
          return "REAL";
        case 10:
          return "ENUMERATED";
        case 11:
          return "EMBEDDED_PDV";
        case 12:
          return "UTF8String";
        case 16:
          return "SEQUENCE";
        case 17:
          return "SET";
        case 18:
          return "NumericString";
        case 19:
          return "PrintableString";
        // ASCII subset
        case 20:
          return "TeletexString";
        // aka T61String
        case 21:
          return "VideotexString";
        case 22:
          return "IA5String";
        // ASCII
        case 23:
          return "UTCTime";
        case 24:
          return "GeneralizedTime";
        case 25:
          return "GraphicString";
        case 26:
          return "VisibleString";
        // ASCII subset
        case 27:
          return "GeneralString";
        case 28:
          return "UniversalString";
        case 30:
          return "BMPString";
      }
      return "Universal_" + this.tag.tagNumber.toString();
    case 1:
      return "Application_" + this.tag.tagNumber.toString();
    case 2:
      return "[" + this.tag.tagNumber.toString() + "]";
    // Context
    case 3:
      return "Private_" + this.tag.tagNumber.toString();
  }
};
function s1(e, t, i) {
  var r = !1;
  if (e.sub && e.sub.forEach(function(o) {
    (o.tag.tagClass != e.tag.tagClass || o.tag.tagNumber != e.tag.tagNumber) && (r = !0);
  }), !e.sub || r)
    return e.stream[t](e.posContent(), e.posContent() + Math.abs(e.length), i);
  var c = { size: 0, str: "" };
  return e.sub.forEach(function(o) {
    var s = s1(o, t, i - c.str.length);
    c.size += s.size, c.str += s.str;
  }), c;
}
Se.prototype.content = function(e) {
  if (this.tag === void 0)
    return null;
  e === void 0 && (e = 1 / 0);
  var t = this.posContent(), i = Math.abs(this.length);
  if (!this.tag.isUniversal()) {
    if (this.sub !== null)
      return "(" + this.sub.length + " elem)";
    var r = this.stream.parseOctetString(t, t + i, e);
    return "(" + r.size + ` byte)
` + r.str;
  }
  switch (this.tag.tagNumber) {
    case 1:
      return this.stream.get(t) === 0 ? "false" : "true";
    case 2:
      return this.stream.parseInteger(t, t + i);
    case 3:
      var c = s1(this, "parseBitString", e);
      return "(" + c.size + ` bit)
` + c.str;
    case 4:
      return c = s1(this, "parseOctetString", e), "(" + c.size + ` byte)
` + c.str;
    //case 0x05: // NULL
    case 6:
      return this.stream.parseOID(t, t + i, e);
    //case 0x07: // ObjectDescriptor
    //case 0x08: // EXTERNAL
    //case 0x09: // REAL
    case 10:
      return this.stream.parseInteger(t, t + i);
    //case 0x0B: // EMBEDDED_PDV
    case 16:
    // SEQUENCE
    case 17:
      return this.sub !== null ? "(" + this.sub.length + " elem)" : "(no elem)";
    case 12:
      return ze(this.stream.parseStringUTF(t, t + i), e);
    case 18:
    // NumericString
    case 19:
    // PrintableString
    case 20:
    // TeletexString
    case 21:
    // VideotexString
    case 22:
    // IA5String
    case 26:
    // VisibleString
    case 27:
      return ze(this.stream.parseStringISO(t, t + i), e);
    case 30:
      return ze(this.stream.parseStringBMP(t, t + i), e);
    case 23:
    // UTCTime
    case 24:
      return this.stream.parseTime(t, t + i, this.tag.tagNumber == 23);
  }
  return null;
};
Se.prototype.toString = function() {
  return this.typeName() + "@" + this.stream.pos + "[header:" + this.header + ",length:" + this.length + ",sub:" + (this.sub === null ? "null" : this.sub.length) + "]";
};
Se.prototype.toPrettyString = function(e) {
  e === void 0 && (e = "");
  var t = e + this.typeName() + " @" + this.stream.pos;
  this.length >= 0 && (t += "+"), t += this.length, this.tag.tagConstructed ? t += " (constructed)" : this.tag.isUniversal() && (this.tag.tagNumber == 3 || this.tag.tagNumber == 4) && this.sub !== null && (t += " (encapsulates)");
  var i = this.content();
  if (i && (t += ": " + i.replace(/\n/g, "|")), t += `
`, this.sub !== null) {
    e += "  ";
    for (var r = 0, c = this.sub.length; r < c; ++r)
      t += this.sub[r].toPrettyString(e);
  }
  return t;
};
Se.prototype.posStart = function() {
  return this.stream.pos;
};
Se.prototype.posContent = function() {
  return this.stream.pos + this.header;
};
Se.prototype.posEnd = function() {
  return this.stream.pos + this.header + Math.abs(this.length);
};
Se.prototype.posLen = function() {
  return this.stream.pos + this.tagLen;
};
Se.prototype.toHexString = function() {
  return this.stream.hexDump(this.posStart(), this.posEnd(), !0);
};
Se.prototype.toB64String = function() {
  return this.stream.b64Dump(this.posStart(), this.posEnd());
};
Se.decodeLength = function(e) {
  var t = e.get(), i = t & 127;
  if (i == t)
    return i;
  if (i === 0)
    return null;
  if (i > 6)
    throw "Length over 48 bits not supported at position " + (e.pos - 1);
  t = 0;
  for (var r = 0; r < i; ++r)
    t = t * 256 + e.get();
  return t;
};
function t1(e) {
  var t = e.get();
  if (this.tagClass = t >> 6, this.tagConstructed = (t & 32) !== 0, this.tagNumber = t & 31, this.tagNumber == 31) {
    var i = new xe();
    do
      t = e.get(), i.mulAdd(128, t & 127);
    while (t & 128);
    this.tagNumber = i.simplify();
  }
}
t1.prototype.isUniversal = function() {
  return this.tagClass === 0;
};
t1.prototype.isEOC = function() {
  return this.tagClass === 0 && this.tagNumber === 0;
};
Se.decode = function(e, t) {
  e instanceof ue || (e = new ue(e, t || 0));
  var i = new ue(e), r = new t1(e), c = e.pos - i.pos, o = Se.decodeLength(e), s = e.pos, a = s - i.pos, m = null, S = function() {
    if (m = [], o !== null) {
      var N = s + o;
      if (N > e.enc.length)
        throw "Container at offset " + s + " has a length of " + o + ", which is past the end of the stream";
      for (; e.pos < N; )
        m[m.length] = Se.decode(e);
      if (e.pos != N)
        throw "Content size is not correct for container at offset " + s;
    } else
      try {
        for (; ; ) {
          var B = Se.decode(e);
          if (B.tag.isEOC())
            break;
          m[m.length] = B;
        }
        o = s - e.pos;
      } catch (O) {
        throw "Exception while decoding undefined length content at offset " + s + ": " + O;
      }
  };
  if (r.tagConstructed)
    S();
  else if (r.isUniversal() && (r.tagNumber == 3 || r.tagNumber == 4))
    try {
      if (r.tagNumber == 3 && e.get() != 0)
        throw "BIT STRINGs with unused bits cannot encapsulate.";
      S();
      for (var f = 0; f < m.length; ++f)
        if (m[f].tag.isEOC())
          throw "EOC is not supposed to be actual content.";
    } catch {
      m = null;
    }
  if (m === null) {
    if (o === null)
      throw "We can't skip over an invalid tag with undefined length at offset " + s;
    e.pos = s + Math.abs(o);
  }
  return new Se(i, a, o, r, c, m);
};
const Et = /^\s*(?:[0-9A-Fa-f][0-9A-Fa-f]\s*)+$/, d1 = (e) => e && typeof e == "object" && "default" in e ? e.default : e, Pt = d1(v1), xt = d1(Xe), Mt = d1(Se), wt = async function(e, t, i) {
  const r = typeof i == "function" ? i(e, t) : e.files[t];
  if (!r)
    return {};
  try {
    const c = await r.async("base64");
    return Nt(c);
  } catch (c) {
    return console.warn("[ofd] parseSesSignature failed", t, c), {};
  }
}, Nt = function(e) {
  try {
    const t = Et.test(e) ? Pt.decode(e) : xt.unarmor(e);
    return vt(t);
  } catch (t) {
    return console.warn("[ofd] decode SES signature text failed", t), {};
  }
}, vt = function(e, t) {
  t = t || 0;
  try {
    const i = Kt(e, t), r = i?.toSign?.eseal?.esealInfo?.picture;
    if (!r?.data?.byte?.length)
      return {};
    const c = (r.type?.str || r.type || "").toString().toLowerCase();
    return {
      ofdArray: r.data.byte,
      type: c,
      // 预览只保留轻量元数据，避免把 DER/证书二进制塞进 DOM data-*。
      SES_Signature: {
        realVersion: i.realVersion,
        displayOnly: !0,
        pictureType: c,
        pictureWidth: r.width,
        pictureHeight: r.height,
        sealName: i.toSign?.eseal?.esealInfo?.property?.name
      },
      verifyRet: !0
    };
  } catch (i) {
    return console.warn("[ofd] decode SES signature failed", i), {};
  }
}, Bt = function(e) {
  return e = String(e || "").replace("Unrecognized time: ", ""), e = e.replace("Z", ""), e = e.substr(0, 1) < "5" ? "20" + e : "19" + e, e;
}, Ye = function(e) {
  return e ? e.stream.parseStringUTF(e.stream.pos + e.header, e.stream.pos + e.header + e.length) : "";
}, Ze = function(e) {
  if (e)
    return e.stream.parseInteger(e.stream.pos + e.header, e.stream.pos + e.header + e.length);
}, A1 = function(e) {
  return e ? e.stream.enc.subarray(e.stream.pos + e.header, e.stream.pos + e.header + e.length) : new Uint8Array(0);
}, c1 = function(e, t) {
  if (!e)
    return "";
  const i = e.stream.parseTime(e.stream.pos + e.header, e.stream.pos + e.header + e.length, t);
  return Bt(i);
}, Kt = function(e, t) {
  t = t || 0;
  const i = Mt.decode(e, t);
  let r;
  try {
    const c = c1(i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[3]), o = c1(i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[4]), s = c1(i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[5]), a = i.sub[0]?.sub[1]?.sub[0]?.sub[3];
    r = {
      realVersion: 1,
      toSign: {
        eseal: {
          esealInfo: {
            property: {
              name: Ye(i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[1]),
              createDate: c,
              validStart: o,
              validEnd: s
            },
            picture: {
              type: Ye(a?.sub[0]),
              data: { byte: A1(a?.sub[1]) },
              width: Ze(a?.sub[2]),
              height: Ze(a?.sub[3])
            }
          }
        }
      }
    };
  } catch {
    try {
      const o = i.sub[0]?.sub[1]?.sub[0]?.sub[3];
      r = {
        realVersion: 4,
        toSign: {
          eseal: {
            esealInfo: {
              property: {
                name: Ye(i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[1]),
                createDate: i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[4]?.stream.parseTime(
                  i.sub[0].sub[1].sub[0].sub[2].sub[4].stream.pos + i.sub[0].sub[1].sub[0].sub[2].sub[4].header,
                  i.sub[0].sub[1].sub[0].sub[2].sub[4].stream.pos + i.sub[0].sub[1].sub[0].sub[2].sub[4].header + i.sub[0].sub[1].sub[0].sub[2].sub[4].length
                ),
                validStart: i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[5]?.stream.parseTime(
                  i.sub[0].sub[1].sub[0].sub[2].sub[5].stream.pos + i.sub[0].sub[1].sub[0].sub[2].sub[5].header,
                  i.sub[0].sub[1].sub[0].sub[2].sub[5].stream.pos + i.sub[0].sub[1].sub[0].sub[2].sub[5].header + i.sub[0].sub[1].sub[0].sub[2].sub[5].length
                ),
                validEnd: i.sub[0]?.sub[1]?.sub[0]?.sub[2]?.sub[6]?.stream.parseTime(
                  i.sub[0].sub[1].sub[0].sub[2].sub[6].stream.pos + i.sub[0].sub[1].sub[0].sub[2].sub[6].header,
                  i.sub[0].sub[1].sub[0].sub[2].sub[6].stream.pos + i.sub[0].sub[1].sub[0].sub[2].sub[6].header + i.sub[0].sub[1].sub[0].sub[2].sub[6].length
                )
              },
              picture: {
                type: Ye(o?.sub[0]),
                data: { byte: A1(o?.sub[1]) },
                width: Ze(o?.sub[2]),
                height: Ze(o?.sub[3])
              }
            }
          }
        }
      };
    } catch (o) {
      console.warn("[ofd] unsupported SES signature structure", o), r = {};
    }
  }
  return r;
}, kt = () => {
  globalThis.global || (globalThis.global = globalThis), globalThis.xmlParseFlag = 0;
}, Ot = function(e, t, i) {
  if (Object.prototype.hasOwnProperty.call(e, t)) {
    e[t] = Array.isArray(e[t]) ? e[t].concat(i) : [e[t], i];
    return;
  }
  e[t] = i;
}, K1 = function(e, t, i) {
  const r = t.attributeNamePrefix ?? "@_", c = {};
  if (t.ignoreAttributes !== !0)
    for (const a of Array.from(e.attributes || []))
      c[`${r}${a.name}`] = a.value;
  const o = [];
  for (const a of Array.from(e.childNodes || [])) {
    if (a.nodeType === 1) {
      const m = i ? i.next++ : void 0, S = K1(a, t, i);
      S && typeof S == "object" && m !== void 0 && (S.pfIndex = m), Ot(c, a.nodeName, S);
      continue;
    }
    (a.nodeType === 3 || a.nodeType === 4) && o.push(a.nodeValue || "");
  }
  const s = o.join("").trim();
  if (s) {
    if (Object.keys(c).length === 0)
      return s;
    c["#text"] = s;
  }
  return c;
}, Rt = function(e) {
  return String(e || "").replace(/^\uFEFF/, "").replace(/^\u00EF\u00BB\u00BF/, "");
}, Ft = function(e, t = {}) {
  const i = globalThis.DOMParser;
  if (typeof i != "function")
    throw new Error("OFD XML parser requires DOMParser in the current runtime");
  const r = new i().parseFromString(Rt(e), "application/xml"), c = r.getElementsByTagName("parsererror")[0];
  if (c)
    throw new Error(c.textContent || "OFD XML parse failed");
  const o = r.documentElement;
  return o ? {
    [o.nodeName]: K1(o, t, { next: 0 })
  } : {};
}, o1 = function(e) {
  return e ? Array.isArray(e) ? e : [e] : [];
}, l1 = function(e, t) {
  let i = [];
  for (const r of o1(e))
    r && (i = i.concat(o1(r[t])));
  return i;
}, T1 = /* @__PURE__ */ new WeakMap(), be = function(e) {
  if (!e)
    return "";
  let t = String(e).replace(/\\/g, "/").trim();
  try {
    t = decodeURIComponent(t);
  } catch {
  }
  t = t.replace(/^\/+/, "").replace(/^\.\//, "").replace(/\/+/g, "/");
  const i = [];
  for (const r of t.split("/"))
    if (!(!r || r === ".")) {
      if (r === "..") {
        i.pop();
        continue;
      }
      i.push(r);
    }
  return i.join("/");
}, _e = function(...e) {
  return be(e.filter(Boolean).join("/"));
}, Ue = function(e, t) {
  const i = be(e), r = be(t);
  return i === r || i.startsWith(`${r}/`);
}, Te = function(e, t) {
  const i = o1(t).map(be).filter(Boolean);
  for (const c of i)
    if (e.files[c])
      return e.files[c];
  let r = T1.get(e);
  if (!r) {
    r = /* @__PURE__ */ new Map();
    for (const c of Object.keys(e.files))
      r.set(be(c).toLowerCase(), e.files[c]);
    T1.set(e, r);
  }
  for (const c of i) {
    const o = r.get(c.toLowerCase());
    if (o)
      return o;
  }
  return null;
}, p1 = function(e, t) {
  const i = be(e);
  return !i || Ue(i, t) ? i : _e(t, i);
}, Xt = function(e, t, i) {
  const r = be(e), c = be(t), o = [r];
  c && !Ue(r, c) && o.push(_e(c, r));
  const s = [];
  for (const a of o)
    s.push(a), a && !Ue(a, i) && s.push(_e(i, a));
  return [...new Set(s.filter(Boolean))];
}, _t = function(e) {
  const t = e.toLowerCase();
  return t === "jpg" || t === "jpeg" ? "image/jpeg" : t === "gif" ? "image/gif" : t === "bmp" ? "image/bmp" : t === "webp" ? "image/webp" : "image/png";
}, k1 = function(e) {
  return new Promise((t, i) => {
    W1.loadAsync(e).then(function(r) {
      t(r);
    }, function(r) {
      i(r);
    });
  });
}, O1 = async function(e) {
  const i = (await Be(e, "OFD.xml")).json["ofd:OFD"]["ofd:DocBody"];
  let r = [];
  return r = r.concat(i), [e, r];
}, R1 = async function([e, t]) {
  let i = [];
  for (let r of t)
    if (r) {
      let c = await Vt(e, r);
      c = await Ht(c), c = await qt(c), c = await Ut(c), c = await jt(c), c = await $t(c), i.push(c);
    }
  return i;
}, Gt = function(e) {
  let i = "";
  for (let r = 0; r < e.length; r += 32768) {
    const c = e.subarray(r, r + 32768);
    i += String.fromCharCode.apply(null, c);
  }
  return btoa(i);
}, Lt = function(e) {
  const t = String(e || "").toLowerCase();
  return t === "jpg" || t === "jpeg" ? "image/jpeg" : t === "gif" ? "image/gif" : t === "bmp" ? "image/bmp" : "image/png";
}, Vt = async function(e, t) {
  let i = t["ofd:DocRoot"];
  i = be(Qe(i));
  const r = i.split("/")[0], c = t["ofd:Signatures"], o = await zt(e, c, r);
  let s = {};
  for (const a of o)
    if (a.sealObj && Object.keys(a.sealObj).length > 0) {
      if (a.sealObj.type === "ofd")
        try {
          const m = await Jt(a);
          let S = [];
          S = S.concat(a.stampAnnot);
          for (const f of S)
            if (f) {
              f.boundary = ve(f["@_Boundary"]), f.pageRef = f["@_PageRef"];
              for (let N of m)
                s[f["@_PageRef"]] || (s[f["@_PageRef"]] = []), s[f["@_PageRef"]].push({
                  type: "ofd",
                  obj: N,
                  stamp: { ...a, stampAnnot: f }
                });
            }
        } catch (m) {
          console.warn("[ofd] nested OFD seal parse failed", m);
        }
      else if (a.sealObj.ofdArray?.length) {
        let S = `data:${Lt(a.sealObj.type)};base64,` + Gt(a.sealObj.ofdArray), f = [];
        f = f.concat(a.stampAnnot);
        for (const N of f)
          if (N) {
            const B = { img: S, pageId: N["@_PageRef"], boundary: ve(N["@_Boundary"]), clip: ve(N["@_Clip"]) };
            s[N["@_PageRef"]] || (s[N["@_PageRef"]] = []), s[N["@_PageRef"]].push({ type: "png", obj: B, stamp: a });
          }
      }
    }
  return [e, r, i, s];
}, Ht = async function([e, t, i, r]) {
  const o = (await Be(e, i)).json["ofd:Document"];
  let s = o["ofd:Annotations"], a = [], m;
  s && (s.indexOf("/") !== -1 && (m = s.substring(0, s.indexOf("/"))), s.indexOf(t) === -1 && (s = `${t}/${s}`), Te(e, s) && (s = await Be(e, s), a = a.concat(s.json["ofd:Annotations"]["ofd:Page"])));
  const S = await Wt(m, a, t, e);
  return [e, t, o, r, S];
}, Wt = async function(e, t, i, r) {
  let c = {};
  for (let o of t) {
    if (!o)
      continue;
    const s = o["@_PageID"];
    let a = o["ofd:FileLoc"];
    if (a && (a = be(Qe(a)), e && a.indexOf(e) === -1 && (a = `${e}/${a}`), a.indexOf(i) === -1 && (a = `${i}/${a}`), Te(r, a))) {
      const m = await Be(r, a);
      let S = [];
      S = S.concat(m.json["ofd:PageAnnot"]["ofd:Annot"]), c[s] || (c[s] = []);
      for (let f of S) {
        if (!f)
          continue;
        const N = f["@_Type"], B = f["@_Visible"] ? f["@_Visible"] : !0, O = f["ofd:Appearance"];
        let G = { type: N, appearance: O, visible: B };
        c[s].push(G);
      }
    }
  }
  return c;
}, qt = async function([e, t, i, r, c]) {
  let o = i["ofd:CommonData"]["ofd:DocumentRes"], s = {}, a = {}, m = {};
  if (o && (o = p1(o, t), Te(e, o))) {
    const f = (await Be(e, o)).json["ofd:Res"];
    s = await F1(f), a = await X1(f), m = await _1(e, f, t);
  }
  return [e, t, i, r, c, s, a, m];
}, Ut = async function([e, t, i, r, c, o, s, a]) {
  let m = i["ofd:CommonData"]["ofd:PublicRes"];
  if (m && (m = p1(m, t), Te(e, m))) {
    const f = (await Be(e, m)).json["ofd:Res"];
    let N = await F1(f);
    o = Object.assign(o, N);
    let B = await X1(f);
    s = Object.assign(s, B);
    let O = await _1(e, f, t);
    a = Object.assign(a, O);
  }
  return [e, t, i, r, c, o, s, a];
}, jt = async function([e, t, i, r, c, o, s, a]) {
  let m = i["ofd:CommonData"]["ofd:TemplatePage"], S = [];
  S = S.concat(m);
  let f = {};
  for (const N of S)
    if (N) {
      let B = await G1(e, N, t);
      f[Object.keys(B)[0]] = B[Object.keys(B)[0]];
    }
  return [e, t, i, r, c, f, o, s, a];
}, $t = async function([e, t, i, r, c, o, s, a, m]) {
  let S = i["ofd:Pages"]["ofd:Page"], f = [];
  f = f.concat(S);
  let N = [];
  for (const B of f)
    if (B) {
      let O = await G1(e, B, t);
      const G = Object.keys(O)[0], ie = r[G];
      ie && (O[G].stamp = ie);
      const ae = c[G];
      ae && (O[G].annotation = ae), N.push(O);
    }
  return {
    doc: t,
    document: i,
    pages: N,
    tpls: o,
    stampAnnot: r,
    fontResObj: s,
    drawParamResObj: a,
    multiMediaResObj: m
  };
}, F1 = async function(e) {
  const t = e["ofd:Fonts"];
  let i = {};
  if (t) {
    let r = l1(t, "ofd:Font");
    for (const c of r)
      c && (c["@_FamilyName"] ? i[c["@_ID"]] = c["@_FamilyName"] : i[c["@_ID"]] = c["@_FontName"]);
  }
  return i;
}, X1 = async function(e) {
  const t = e["ofd:DrawParams"];
  let i = {};
  if (t) {
    let r = l1(t, "ofd:DrawParam");
    for (const c of r)
      c && (i[c["@_ID"]] = {
        LineWidth: c["@_LineWidth"],
        FillColor: c["ofd:FillColor"] ? c["ofd:FillColor"]["@_Value"] : "",
        StrokeColor: c["ofd:StrokeColor"] ? c["ofd:StrokeColor"]["@_Value"] : "",
        relative: c["@_Relative"]
      });
  }
  return i;
}, _1 = async function(e, t, i) {
  const r = t["ofd:MultiMedias"];
  let c = {};
  if (r) {
    let o = l1(r, "ofd:MultiMedia");
    for (const s of o)
      if (s && s["ofd:MediaFile"]) {
        const a = Xt(s["ofd:MediaFile"], t["@_BaseLoc"], i), m = Te(e, a) ? a : null;
        if ((s["@_Type"] ? s["@_Type"].toLowerCase() : "") === "image") {
          const f = s["@_Format"], N = z1(a[0]);
          if (f && (f.toLowerCase() === "gbig2" || f.toLowerCase() === "jb2") || N && (N.toLowerCase() === "jb2" || N.toLowerCase() === "gbig2")) {
            const B = await Yt(e, a);
            B && (c[s["@_ID"]] = B);
          } else {
            const B = f || N || "png", O = await Zt(e, a, _t(B));
            O && (c[s["@_ID"]] = { img: O, format: B.toLowerCase() });
          }
        } else
          c[s["@_ID"]] = m ? m[0] : a[0];
      }
  }
  return c;
}, G1 = async function(e, t, i) {
  let r = t["@_BaseLoc"];
  r = p1(r, i);
  const c = await Be(e, r);
  let o = {};
  return o[t["@_ID"]] = { json: c.json["ofd:Page"], xml: c.xml }, o;
}, zt = async function(e, t, i) {
  let r = [];
  if (!t)
    return r;
  try {
    let c = be(Qe(t));
    if (Ue(c, i) || (c = _e(i, c)), !Te(e, c))
      return r;
    let s = (await Be(e, c)).json["ofd:Signatures"]["ofd:Signature"], a = [];
    a = a.concat(s);
    for (const m of a)
      if (m)
        try {
          let S = be(Qe(m["@_BaseLoc"])), f = m["@_ID"];
          S && S.indexOf("Signs") === -1 && !Ue(S, i) && (S = _e("Signs", S)), Ue(S, i) || (S = _e(i, S));
          const N = await Qt(e, S, f);
          N && r.push(N);
        } catch (S) {
          console.warn("[ofd] signature entry parse failed", m?.["@_ID"], S);
        }
  } catch (c) {
    console.warn("[ofd] signatures.xml parse failed", c);
  }
  return r;
}, Qt = async function(e, t, i) {
  const r = await Be(e, t);
  let c = r.json["ofd:Signature"]["ofd:SignedValue"];
  if (c == null)
    return null;
  if (c = be(Qe(String(c))), Te(e, c) || (c = _e(t.substring(0, t.lastIndexOf("/")), c)), !Te(e, c))
    return console.warn("[ofd] SignedValue not found", c), null;
  let o = await wt(e, c, Te);
  if (!o || !Object.keys(o).length)
    return null;
  const s = r.json["ofd:Signature"]["ofd:SignedInfo"] || {};
  return {
    stampAnnot: s["ofd:StampAnnot"],
    sealObj: o,
    signedInfo: {
      signatureID: i,
      VerifyRet: o.verifyRet,
      Provider: s["ofd:Provider"],
      SignatureMethod: s["ofd:SignatureMethod"],
      SignatureDateTime: s["ofd:SignatureDateTime"]
    }
  };
}, Jt = function(e) {
  return new Promise((t, i) => {
    N1.call(this, async () => await k1(e.sealObj.ofdArray), O1, R1).then((r) => {
      t(r);
    }).catch((r) => {
      i(r);
    });
  });
}, Be = async function(e, t) {
  return new Promise((i, r) => {
    const c = Te(e, t);
    if (!c) {
      r(new Error(`OFD XML resource not found: ${be(t)}`));
      return;
    }
    c.async("string").then(function(o) {
      kt();
      let a = Ft(o, {
        attributeNamePrefix: "@_",
        ignoreAttributes: !1
      });
      i({ xml: o, json: a });
    }, function(s) {
      r(s);
    });
  });
}, Yt = async function(e, t) {
  return new Promise((i, r) => {
    const c = Te(e, t);
    if (!c) {
      i(null);
      return;
    }
    c.async("uint8array").then(function(o) {
      let s = new At();
      const a = s.parse(o);
      i({ img: a, width: s.width, height: s.height, format: "gbig2" });
    }, function(s) {
      r(s);
    });
  });
}, Zt = async function(e, t, i = "image/png") {
  return new Promise((r, c) => {
    const o = Te(e, t);
    if (!o) {
      r(null);
      return;
    }
    o.async("base64").then(function(s) {
      const a = `data:${i};base64,` + s;
      r(a);
    }, function(a) {
      c(a);
    });
  });
}, ii = function(e) {
  e.ofd instanceof File || e.ofd instanceof Blob || e.ofd instanceof ArrayBuffer ? ei(e) : e.fail?.(new Error("OFD 预览只接收 File、Blob 或 ArrayBuffer 数据"));
}, ei = function(e) {
  N1.call(this, async () => await k1(e.ofd), O1, R1).then((t) => {
    e.success && e.success(t);
  }).catch((t) => {
    console.log(t), e.fail && e.fail(t);
  });
}, ri = function(e, t) {
  let i = [];
  if (!t)
    return i;
  for (const r of t.pages) {
    let c = tt(e, t.document, r);
    const o = Object.keys(r)[0];
    let s = document.createElement("div");
    s.id = o, s.setAttribute("style", `margin-bottom: 20px;position: relative;width:${c.w}px;height:${c.h}px;background: white;overflow:hidden;`), x1(s, r, t.tpls, t.fontResObj, t.drawParamResObj, t.multiMediaResObj), i.push(s);
  }
  return i;
}, ci = function(e) {
  let t = [];
  if (!e)
    return t;
  for (const i of e.pages) {
    let r = it(e.document, i);
    const c = Object.keys(i)[0];
    let o = document.createElement("div");
    o.id = c, o.setAttribute("style", `margin-bottom: 20px;position: relative;width:${r.w}px;height:${r.h}px;background: white;overflow:hidden;`), x1(o, i, e.tpls, e.fontResObj, e.drawParamResObj, e.multiMediaResObj), t.push(o);
  }
  return t;
}, si = function(e) {
  return e?.arr, !1;
}, oi = function(e) {
  P1(e);
}, ni = function() {
  return j1();
};
export {
  tt as calPageBox,
  it as calPageBoxScale,
  si as digestCheck,
  ni as getPageScale,
  ii as parseOfdDocument,
  ri as renderOfd,
  ci as renderOfdByScale,
  x1 as renderPage,
  oi as setPageScale
};
