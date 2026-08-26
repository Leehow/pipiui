import { jsx as Xe } from "react/jsx-runtime";
import { forwardRef as po, useRef as Me, useMemo as hr, useEffect as vt, useImperativeHandle as mo, useCallback as fo, Component as vo } from "react";
const wo = "vendor/docx/docx.worker.js", ho = "vendor/docx/jszip.min.js", gr = "0.3.26", go = "vendor/pptx/pptx.worker.js", bo = "vendor/xlsx/sheet.worker.js", yo = "vendor/pdf/pdf.worker.mjs", xo = "vendor/pdf/cmaps/", So = "vendor/pdf/wasm/", Fo = "vendor/pdf/standard_fonts/", Eo = "vendor/pdf/fonts/", Ue = /* @__PURE__ */ Symbol("automatic-file-viewer-asset-base");
let fe = Ue;
const ko = (e) => {
  if (!e)
    return;
  const t = String(e).trim();
  if (t)
    return t.endsWith("/") ? t : `${t}/`;
}, br = (e) => {
  fe = ko(e);
}, Ro = () => {
  fe = Ue;
}, Ao = (e) => e.split("/").filter(Boolean).length, Do = (e, t) => {
  const r = e.split("/").filter(Boolean), o = t.split("/").filter(Boolean), i = [], n = Math.min(r.length, Math.max(0, o.length - 1));
  for (let a = 0; a < n && r[a] === o[a]; a += 1)
    i.push(r[a]);
  return i.length ? `/${i.join("/")}/` : "/";
}, _o = (e, t, r) => {
  try {
    const o = e.src || e.getAttribute("src") || "";
    if (!o)
      return [];
    const i = new URL(o, t), n = i.pathname.match(/^(.*\/)@vite\/client$/i), a = /\/(?:src|node_modules|@fs|@id|@vite)(?:\/|$)/i.test(i.pathname), l = new URL(t), s = l.pathname.endsWith("/") ? l.pathname : `${l.pathname}/`, m = i.pathname.slice(i.pathname.lastIndexOf("/") + 1), w = /^(?:app|index|main|runtime|umi)(?:[.-]|$)/i.test(m), p = /* @__PURE__ */ new Map(), h = (S, P) => {
      const F = new URL(S, i).href, D = new URL(F);
      let R = P + r / 1e4;
      D.origin === l.origin && (R += 8), s.startsWith(D.pathname) && (R += 16 + Ao(D.pathname) / 4), e.type === "module" && (R += 2), w && (R += 2);
      const b = p.get(F);
      (!b || b.score < R) && p.set(F, { url: F, score: R });
    };
    if (n && h(n[1], 12), a)
      return [...p.values()];
    const g = i.pathname.split("/").filter(Boolean).slice(0, -1);
    if ([
      { segments: ["static", "js"], weight: 9 },
      { segments: ["assets", "js"], weight: 9 },
      { segments: ["assets", "chunks"], weight: 8 },
      { segments: ["assets"], weight: 6 },
      { segments: ["static"], weight: 6 },
      { segments: ["js"], weight: 4 }
    ].forEach(({ segments: S, weight: P }) => {
      for (let F = 0; F <= g.length - S.length; F += 1) {
        if (!S.every((b, x) => {
          var I;
          return ((I = g[F + x]) === null || I === void 0 ? void 0 : I.toLowerCase()) === b;
        }))
          continue;
        const R = g.slice(0, F).length ? `/${g.slice(0, F).join("/")}/` : "/";
        h(R, P + S.length);
      }
    }), w) {
      const S = i.pathname.slice(0, i.pathname.lastIndexOf("/") + 1);
      h(S, 3);
    }
    return i.origin === l.origin && h(Do(l.pathname, i.pathname), 8), [...p.values()];
  } catch {
    return [];
  }
}, Wl = (e) => {
  var t;
  const r = e.baseURI || e.URL || "file:///";
  if (fe !== Ue) {
    if (!fe)
      return r;
    try {
      return new URL(fe, r).href;
    } catch {
      return fe;
    }
  }
  return e.querySelector("base[href]") ? r : ((t = Array.from(e.querySelectorAll("script[src]")).flatMap((i, n) => _o(i, r, n)).sort((i, n) => n.score - i.score)[0]) === null || t === void 0 ? void 0 : t.url) || r;
}, To = (e) => {
  if (fe !== Ue)
    return fe;
}, yr = "file:///", ge = (e, t, r = {}) => {
  const o = e ? String(e) : t, i = r.documentBaseUrl || yr, n = !e && fe !== Ue ? fe : void 0, a = r.baseUrl || n, l = a ? a.endsWith("/") ? a : `${a}/` : i, s = a ? new URL(l, i).href : l, m = new URL(o, s).href;
  return r.trimTrailingSlash ? m.replace(/\/+$/, "") : m;
}, Ul = (e, t) => {
  const r = e?.assetBaseUrl ? String(e.assetBaseUrl) : "", o = r ? new URL(r.endsWith("/") ? r : `${r}/`, t || yr).href : t;
  return {
    workerUrl: ge(e?.workerUrl, yo, {
      documentBaseUrl: o
    }),
    cMapUrl: ge(e?.cMapUrl, xo, {
      documentBaseUrl: o
    }),
    wasmUrl: ge(e?.wasmUrl, So, {
      documentBaseUrl: o
    }),
    standardFontDataUrl: ge(e?.standardFontDataUrl, Fo, { documentBaseUrl: o }),
    cjkFontFallbackPath: ge(e?.cjkFontFallbackPath, Eo, { documentBaseUrl: o })
  };
}, Bl = (e, t) => {
  const r = ge(e?.workerUrl, wo, {
    documentBaseUrl: t
  });
  if (e?.workerUrl)
    return r;
  const o = r.includes("?") ? "&" : "?";
  return `${r}${o}file-viewer-docx=${encodeURIComponent(gr)}`;
}, Hl = (e, t) => {
  const r = ge(e?.workerJsZipUrl, ho, { documentBaseUrl: t });
  if (e?.workerJsZipUrl)
    return r;
  const o = r.includes("?") ? "&" : "?";
  return `${r}${o}file-viewer-docx=${encodeURIComponent(gr)}`;
}, Nl = (e, t) => ge(e?.workerUrl, bo, {
  documentBaseUrl: t
}), jl = (e, t) => ge(e?.workerUrl, go, {
  documentBaseUrl: t
}), xr = [
  "zip",
  "zipx",
  "7z",
  "rar",
  "tar",
  "gz",
  "gzip",
  "tgz",
  "bz2",
  "bzip2",
  "tbz",
  "tbz2",
  "xz",
  "txz",
  "lzma",
  "zst",
  "tzst",
  "cab",
  "ar",
  "cpio",
  "iso",
  "xar",
  "lha",
  "lzh",
  "jar",
  "war",
  "ear",
  "apk",
  "cbz",
  "cbr"
], Sr = [
  "glb",
  "gltf",
  "obj",
  "stl",
  "ply",
  "fbx",
  "dae",
  "3ds",
  "3mf",
  "amf",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "kmz",
  "step",
  "stp",
  "iges",
  "igs",
  "ifc",
  "3dm",
  "brep",
  "pcd",
  "wrl",
  "vrml",
  "xyz",
  "vtk",
  "vtp"
], Fr = [
  "txt",
  "json",
  "js",
  "mjs",
  "cjs",
  "css",
  "java",
  "py",
  "html",
  "htm",
  "jsx",
  "ts",
  "tsx",
  "xml",
  "log",
  "vue",
  "yaml",
  "yml",
  "ini",
  "sh",
  "bash",
  "sql",
  "go",
  "rs",
  "php",
  "c",
  "cpp",
  "cc",
  "h",
  "hpp",
  "cs",
  "diff",
  "patch",
  "bundle",
  "bdl",
  "jsonc",
  "json5",
  "ipynb",
  "toml",
  "proto",
  "hcl",
  "tex",
  "gv",
  "http",
  "react",
  "rb",
  "swift",
  "kt"
], Er = [
  "gif",
  "jpg",
  "jpeg",
  "bmp",
  "tiff",
  "tif",
  "png",
  "svg",
  "webp",
  "avif",
  "ico",
  "heic",
  "heif",
  "jxl"
], se = [
  {
    id: "office-word-openxml",
    label: "Word OpenXML",
    category: "office",
    extensions: ["docx", "docm", "dotx", "dotm"],
    async: !0,
    capabilities: { download: !0, print: "adapter", exportHtml: "adapter", zoom: "provider", search: !0 }
  },
  {
    id: "office-word-binary",
    label: "Word Binary",
    category: "office",
    extensions: ["doc", "dot"],
    async: !0,
    capabilities: { download: !0, print: "adapter", exportHtml: "adapter", zoom: "provider", search: !0 }
  },
  {
    id: "office-presentation-binary",
    label: "PowerPoint 97–2003",
    category: "office",
    extensions: ["ppt"],
    async: !0,
    capabilities: { download: !0, print: "adapter", exportHtml: "adapter", zoom: "provider", search: !1 }
  },
  {
    id: "office-presentation",
    label: "PowerPoint OpenXML",
    category: "office",
    extensions: ["pptx", "pptm", "potx", "potm", "ppsx", "ppsm"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "open-document",
    label: "Open Document",
    category: "office",
    extensions: ["rtf", "odt", "odp"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "spreadsheet-openxml",
    label: "Spreadsheet",
    category: "office",
    extensions: ["xlsx", "xltx", "xlsm", "xlsb", "xls", "xlt", "xltm", "csv", "tsv", "ods", "fods", "numbers"],
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !1, zoom: "provider", search: !0 }
  },
  {
    id: "pdf",
    label: "PDF",
    category: "document",
    extensions: ["pdf"],
    async: !0,
    capabilities: { download: !0, print: "adapter", exportHtml: "adapter", zoom: "provider", search: "provider" }
  },
  {
    id: "ofd",
    label: "OFD",
    category: "document",
    extensions: ["ofd"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "typst",
    label: "Typst",
    category: "document",
    extensions: ["typ", "typst"],
    async: !0,
    capabilities: { download: !0, print: "adapter", exportHtml: "adapter", zoom: "provider", search: !0 }
  },
  {
    id: "archive",
    label: "Archive",
    category: "archive",
    extensions: xr,
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !1, zoom: !1, search: !0 }
  },
  {
    id: "email",
    label: "Email",
    category: "email",
    extensions: ["eml", "msg", "mbox"],
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !0, zoom: !1, search: !0 }
  },
  {
    id: "eda",
    label: "EDA",
    category: "eda",
    extensions: ["olb", "dra", "gds", "oas", "oasis"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: !1, search: !0 }
  },
  {
    id: "cad",
    label: "CAD",
    category: "cad",
    extensions: ["dxf", "dwg", "dwf", "dwfx", "xps"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !1 }
  },
  {
    id: "model",
    label: "3D Model",
    category: "model",
    extensions: Sr,
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !1, zoom: "provider", search: !1 }
  },
  {
    id: "geo",
    label: "Geospatial",
    category: "geo",
    extensions: ["geojson", "kml", "gpx", "shp"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "drawing",
    label: "Drawing",
    category: "drawing",
    extensions: ["excalidraw", "drawio", "dio", "mermaid", "mmd", "plantuml", "puml"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "mindmap",
    label: "Mind Map",
    category: "mindmap",
    extensions: ["xmind"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "epub",
    label: "EPUB",
    category: "ebook",
    extensions: ["epub"],
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !0, zoom: !1, search: "provider" }
  },
  {
    id: "umd",
    label: "UMD",
    category: "ebook",
    extensions: ["umd"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !0 }
  },
  {
    id: "image",
    label: "Image",
    category: "image",
    extensions: Er,
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: "provider", search: !1 }
  },
  {
    id: "markdown",
    label: "Markdown",
    category: "markdown",
    extensions: ["md", "markdown"],
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: !1, search: !0 }
  },
  {
    id: "code",
    label: "Code and Text",
    category: "code",
    extensions: Fr,
    async: !0,
    capabilities: { download: !0, print: !0, exportHtml: !0, zoom: !1, search: !0 }
  },
  {
    id: "video",
    label: "Video",
    category: "media",
    extensions: ["mp4", "webm", "m3u8"],
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !1, zoom: !1, search: !1 }
  },
  {
    id: "audio",
    label: "Audio",
    category: "media",
    extensions: ["mp3", "mpeg", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "midi", "mid"],
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !1, zoom: !1, search: !1 }
  },
  {
    id: "data-asset",
    label: "Data Asset",
    category: "asset",
    extensions: ["ttf", "otf", "woff", "woff2", "psd", "ai", "eps", "sqlite", "wasm", "parquet", "avro", "webarchive"],
    async: !0,
    capabilities: { download: !0, print: !1, exportHtml: !0, zoom: !1, search: !0 }
  }
];
Object.freeze(Array.from(new Set(se.flatMap((e) => e.extensions))).sort());
const ye = "preview.bin", ae = (e) => e.trim().replace(/^\./, "").toLowerCase(), Po = (e) => {
  try {
    return decodeURIComponent(e);
  } catch {
    return e;
  }
}, _e = (e) => {
  const t = e.split(/[?#]/)[0] || e, r = t.lastIndexOf(".");
  return r === -1 ? "" : ae(t.slice(r + 1));
}, ke = (e, t = ye) => {
  const r = (e || "").split(/[?#]/)[0].trim();
  if (!r)
    return t;
  const o = Math.max(r.lastIndexOf("/"), r.lastIndexOf("\\"));
  return Po(o === -1 ? r : r.slice(o + 1));
}, zo = (e) => e.file ? "file" : e.buffer ? "buffer" : e.url ? "url" : "empty", kr = (e) => e && "name" in e && typeof e.name == "string" ? e.name : void 0, Io = ({ filename: e, file: t, url: r, fallback: o = "" }) => {
  if (e)
    return ke(e, o);
  const i = kr(t);
  return i ? ke(i, o) : r ? ke(r, o) : o;
}, Ct = (e) => {
  const t = zo(e), r = ke(e.filename || kr(e.file) || e.url, e.type ? `preview.${ae(e.type)}` : ye), o = ae(e.type || _e(r)), i = typeof e.size == "number" ? e.size : e.file ? e.file.size : e.buffer ? e.buffer.byteLength : void 0;
  return {
    kind: t,
    filename: r,
    extension: o,
    url: e.url,
    file: e.file,
    buffer: e.buffer,
    size: i
  };
}, Mt = (e, t = ye) => {
  if (typeof File < "u" && e instanceof File)
    return e;
  const r = ke(t || ye);
  if (typeof Blob < "u" && e instanceof Blob)
    return new File([e], r, { type: e.type });
  if (e instanceof ArrayBuffer)
    return new File([e], r, {});
  throw new Error("Unsupported file source input.");
}, Ot = async (e) => typeof e.arrayBuffer == "function" ? e.arrayBuffer() : new Promise((t, r) => {
  const o = new FileReader();
  o.onload = (i) => {
    var n;
    const a = (n = i.target) === null || n === void 0 ? void 0 : n.result;
    if (a instanceof ArrayBuffer) {
      t(a);
      return;
    }
    r(new Error("Failed to read file as ArrayBuffer."));
  }, o.onerror = (i) => r(i), o.readAsArrayBuffer(e);
}), Vo = {
  docx: ["[content_types].xml", "word/document.xml"],
  docm: ["[content_types].xml", "word/document.xml"],
  dotx: ["[content_types].xml", "word/document.xml"],
  dotm: ["[content_types].xml", "word/document.xml"],
  xlsx: ["[content_types].xml", "xl/workbook.xml"],
  xltx: ["[content_types].xml", "xl/workbook.xml"],
  xlsm: ["[content_types].xml", "xl/workbook.xml"],
  xltm: ["[content_types].xml", "xl/workbook.xml"],
  xlsb: ["[content_types].xml", "xl/workbook.bin"],
  pptx: ["[content_types].xml", "ppt/presentation.xml"],
  pptm: ["[content_types].xml", "ppt/presentation.xml"],
  potx: ["[content_types].xml", "ppt/presentation.xml"],
  potm: ["[content_types].xml", "ppt/presentation.xml"],
  ppsx: ["[content_types].xml", "ppt/presentation.xml"],
  ppsm: ["[content_types].xml", "ppt/presentation.xml"],
  odt: ["content.xml"],
  ods: ["content.xml"],
  odp: ["content.xml"],
  ofd: ["ofd.xml"],
  numbers: ["index/document.iwa"],
  epub: ["meta-inf/container.xml"],
  xps: ["[content_types].xml"],
  dwfx: ["[content_types].xml"]
};
[
  ...Object.keys(Vo)
];
new TextDecoder("utf-8");
const Lo = 1, Co = 1200, Mo = 160, Rr = (e = {}) => {
  var t, r, o;
  const i = Number.isFinite(e.scale) && e.scale ? Number(e.scale) : Lo;
  return {
    scale: i,
    label: e.label || `${Math.round(i * 100)}%`,
    canZoomIn: (t = e.canZoomIn) !== null && t !== void 0 ? t : !1,
    canZoomOut: (r = e.canZoomOut) !== null && r !== void 0 ? r : !1,
    canReset: (o = e.canReset) !== null && o !== void 0 ? o : !1,
    minScale: e.minScale,
    maxScale: e.maxScale
  };
}, Oo = (e) => e === !1 ? { enabled: !1 } : e === !0 || e === void 0 ? {} : e, wt = (e = "") => ({
  query: e,
  total: 0,
  currentIndex: -1,
  current: null,
  matches: []
}), Wo = (e) => e === !1 ? { enabled: !1, collectText: !1 } : e === !0 || e === void 0 ? {} : e, Uo = (e, t) => {
  var r;
  const o = Wo(t);
  if (o.enabled === !1 || o.collectText === !1)
    return [];
  const i = Math.max(200, o.chunkSize || Co), n = Math.max(0, Math.min(i - 1, (r = o.chunkOverlap) !== null && r !== void 0 ? r : Mo)), a = Math.max(0, o.maxTextLength || 0), l = [];
  return e.forEach((s) => {
    const m = a ? s.text.slice(0, a) : s.text;
    if (!m)
      return;
    if (m.length <= i) {
      l.push({
        id: `${s.id}-chunk-1`,
        text: m,
        anchor: s,
        startLine: s.line,
        endLine: s.line
      });
      return;
    }
    let w = 0, p = 1;
    for (; w < m.length; ) {
      const h = m.slice(w, w + i);
      if (l.push({
        id: `${s.id}-chunk-${p}`,
        text: h,
        anchor: s,
        startLine: s.line,
        endLine: s.line
      }), w + i >= m.length)
        break;
      w += i - n, p += 1;
    }
  }), l;
}, Bo = [
  "[data-viewer-anchor-id]",
  ".pdfViewer .page",
  ".docx-wrapper section",
  ".docx p",
  ".docx li",
  ".docx table",
  ".markdown-body h1",
  ".markdown-body h2",
  ".markdown-body h3",
  ".markdown-body h4",
  ".markdown-body h5",
  ".markdown-body h6",
  ".markdown-body p",
  ".markdown-body li",
  ".markdown-body pre",
  ".markdown-body table",
  "article h1",
  "article h2",
  "article h3",
  "article h4",
  "article h5",
  "article h6",
  "article p",
  "article li",
  "article pre",
  "article table",
  "pre code",
  "p",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "table"
].join(","), Ho = [
  ".viewer-actions",
  ".viewer-watermark",
  ".state-panel",
  ".pdf-toolbar",
  ".pdf-nav-pane",
  ".flyfish-search-match"
].join(","), Wt = (e) => typeof CSS < "u" && typeof CSS.escape == "function" ? CSS.escape(e) : e.replace(/["\\]/g, "\\$&"), Ut = (e, t = 160) => {
  const r = e.replace(/\s+/g, " ").trim();
  return r.length > t ? `${r.slice(0, t - 1)}…` : r;
}, No = (e) => {
  const t = e.getBoundingClientRect();
  return t.width > 0 || t.height > 0;
}, jo = (e) => !!e.closest(Ho), $o = (e) => {
  const t = e.closest("[data-page-number], [data-page]"), r = t?.dataset.pageNumber || t?.dataset.page, o = r ? Number.parseInt(r, 10) : Number.NaN;
  return Number.isFinite(o) ? o : void 0;
}, Zo = (e) => e.matches(".pdfViewer .page, [data-page-number], [data-page]") ? "page" : e.matches("p, li, tr, pre, code") ? "line" : "block", Go = (e, t) => {
  let r = e.parentElement;
  for (; r; ) {
    if (t.has(r))
      return !0;
    r = r.parentElement;
  }
  return !1;
}, Bt = (e) => {
  if (!e)
    return [];
  const t = e.getBoundingClientRect(), r = /* @__PURE__ */ new Set(), o = [];
  return Array.from(e.querySelectorAll(Bo)).forEach((n) => {
    if (jo(n) || !No(n))
      return;
    const a = Ut(n.textContent || "", 1e3);
    if (!a || Go(n, r) && !n.matches("p, li, tr, pre, code"))
      return;
    r.add(n);
    const l = n.dataset.viewerAnchorId || `viewer-anchor-${o.length + 1}`;
    n.dataset.viewerAnchorId = l, n.dataset.viewerLine = String(o.length + 1);
    const s = n.getBoundingClientRect();
    o.push({
      id: l,
      index: o.length,
      line: o.length + 1,
      type: Zo(n),
      label: Ut(a, 96),
      text: a,
      page: $o(n),
      top: s.top - t.top + e.scrollTop,
      left: s.left - t.left + e.scrollLeft,
      width: s.width,
      height: s.height
    });
  }), o;
}, qo = (e, t, r) => {
  if (!e)
    return null;
  const o = e.closest("[data-viewer-anchor-id]");
  if (o?.dataset.viewerAnchorId) {
    const s = t.find((m) => m.id === o.dataset.viewerAnchorId);
    if (s)
      return s;
  }
  if (!r)
    return null;
  const i = r.getBoundingClientRect(), a = e.getBoundingClientRect().top - i.top + r.scrollTop;
  let l = null;
  for (const s of t) {
    if (s.top <= a + 1) {
      l = s;
      continue;
    }
    break;
  }
  return l;
}, Xo = (e, t) => {
  if (!e || !t.length)
    return null;
  const r = e.scrollTop + e.clientHeight * 0.42;
  let o = t[0];
  for (const i of t) {
    if (i.top <= r) {
      o = i;
      continue;
    }
    break;
  }
  return o;
}, Ko = (e, t) => {
  if (!e || t === null || t === void 0)
    return !1;
  const r = typeof t == "object" ? `[data-viewer-anchor-id="${Wt(t.id)}"]` : typeof t == "number" ? `[data-viewer-line="${t}"]` : `[data-viewer-anchor-id="${Wt(t)}"]`, o = e.querySelector(r);
  return o ? (o.scrollIntoView({ block: "center", inline: "nearest" }), !0) : typeof t == "object" ? (e.scrollTo({
    top: Math.max(0, t.top - e.clientHeight * 0.18),
    left: Math.max(0, Math.min(t.left, e.scrollWidth - e.clientWidth)),
    behavior: "smooth"
  }), !0) : !1;
}, et = /* @__PURE__ */ new WeakMap(), tt = /* @__PURE__ */ new WeakMap(), rt = /* @__PURE__ */ new WeakMap(), Oe = (e) => !!e && e.nodeType === 1, We = (e, t) => {
  if (!e?.querySelectorAll)
    return [];
  const r = Array.from(e.querySelectorAll(t));
  Oe(e) && e.shadowRoot && r.push(...We(e.shadowRoot, t));
  const o = Array.from(e.querySelectorAll("*"));
  for (const i of o)
    i.shadowRoot && r.push(...We(i.shadowRoot, t));
  return r;
}, $l = (e, t) => {
  et.set(e, t), e.__flyfishViewerSearchProvider = t;
}, Zl = (e) => {
  e && (et.delete(e), delete e.__flyfishViewerSearchProvider);
}, Ht = (e) => {
  if (!e)
    return null;
  const t = Oe(e) ? et.get(e) || e.__flyfishViewerSearchProvider : null;
  if (t)
    return t;
  const r = We(e, "[data-viewer-search-provider]")[0];
  return r && (et.get(r) || r.__flyfishViewerSearchProvider) || null;
}, Gl = (e, t) => {
  tt.set(e, t), e.dataset.viewerZoomProvider = e.dataset.viewerZoomProvider || "custom", e.__flyfishViewerZoomProvider = t;
}, ql = (e) => {
  e && (tt.delete(e), delete e.dataset.viewerZoomProvider, delete e.__flyfishViewerZoomProvider);
}, _t = (e) => {
  if (!e)
    return null;
  const t = Oe(e) ? tt.get(e) || e.__flyfishViewerZoomProvider : null;
  if (t)
    return t;
  const r = We(e, "[data-viewer-zoom-provider]")[0];
  return r && (tt.get(r) || r.__flyfishViewerZoomProvider) || null;
}, Yo = (e, t) => {
  rt.set(e, t), e.dataset.viewerViewStateProvider = e.dataset.viewerViewStateProvider || "custom", e.__flyfishViewerViewStateProvider = t;
}, Jo = (e) => {
  e && (rt.delete(e), delete e.dataset.viewerViewStateProvider, delete e.__flyfishViewerViewStateProvider);
}, Tt = (e) => {
  if (!e)
    return null;
  const t = Oe(e) ? rt.get(e) || e.__flyfishViewerViewStateProvider : null;
  if (t && (!Oe(e) || e.dataset.viewerViewStateProvider !== "generic"))
    return t;
  const r = We(e, "[data-viewer-view-state-provider]"), o = r.find((a) => a.dataset.viewerViewStateProvider !== "generic"), i = r.find((a) => a.dataset.viewerViewStateProvider === "generic"), n = o || i;
  return n ? rt.get(n) || n.__flyfishViewerViewStateProvider || null : t || null;
}, Qo = "[data-viewer-scroll-container], .pdf-wrapper", ei = "div, section, article, pre", ti = ["auto", "scroll", "overlay"], ht = (e) => Math.max(0, e.scrollHeight - e.clientHeight), lt = (e, t = {}) => {
  var r, o;
  const i = (r = t.minScrollRange) !== null && r !== void 0 ? r : 2;
  if (ht(e) <= i)
    return !1;
  const n = (o = e.ownerDocument) === null || o === void 0 ? void 0 : o.defaultView, a = n?.getComputedStyle ? n : typeof window < "u" ? window : void 0;
  if (!a?.getComputedStyle)
    return !1;
  const l = a.getComputedStyle(e), s = l.overflowY || l.overflow;
  return (t.overflowValues || ti).includes(s);
}, Ar = (e, t = {}) => {
  if (!e)
    return null;
  const r = t.preferredSelector || Qo, o = t.candidateSelector || ei, i = e.querySelector(r);
  return i && lt(i, t) ? i : lt(e, t) ? e : Array.from(e.querySelectorAll(o)).filter((a) => lt(a, t)).sort((a, l) => ht(l) - ht(a))[0] || i || e;
}, ri = "flyfish-search-match", Nt = "flyfish-search-match--active", oi = 1e3, ii = [
  "script",
  "style",
  "textarea",
  "input",
  "select",
  "button",
  ".viewer-actions",
  ".viewer-watermark",
  ".state-panel",
  ".pdf-toolbar",
  ".pdf-nav-pane",
  '[aria-hidden="true"]',
  ".flyfish-search-match",
  ".textLayer",
  ".annotationLayer",
  ".xfaLayer",
  "svg",
  "canvas",
  "iframe",
  "video",
  "audio"
].join(","), jt = (e) => ({
  ...e,
  anchor: e.anchor ? { ...e.anchor } : null
}), Dr = (e) => ({
  query: e.query,
  total: e.total,
  currentIndex: e.currentIndex,
  current: e.current ? jt(e.current) : null,
  matches: e.matches.map(jt)
}), _r = (e, t) => {
  const r = Dr(t);
  return e.query = r.query, e.total = r.total, e.currentIndex = r.currentIndex, e.current = r.current, e.matches = r.matches, e;
}, Pt = (e, t) => (e.anchors.value = t.anchors, _r(e.state, t.state), e.state), ni = (e, t) => (t.observe(), Pt(e, t)), ze = async (e, t, r) => (await r(), Pt(e, t)), ai = (e, t) => (t.destroy(), Pt(e, t)), li = (e, t) => ({
  observe() {
    return ni(e, t);
  },
  async refreshAnchors() {
    return await ze(e, t, () => t.refreshAnchors()), e.anchors.value;
  },
  async search(r) {
    return ze(e, t, () => t.search(r));
  },
  async next() {
    return ze(e, t, () => t.next());
  },
  async previous() {
    return ze(e, t, () => t.previous());
  },
  async clear() {
    return ze(e, t, () => t.clear());
  },
  destroy() {
    return ai(e, t);
  }
}), $t = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), si = (e) => e.replace(/\s+/g, " ").trim(), di = (e, t) => {
  const r = t.wholeWord ? `\\b${$t(e)}\\b` : $t(e);
  return new RegExp(r, t.caseSensitive ? "g" : "gi");
}, ci = (e) => e.map(({ element: t, ...r }) => r), ui = (e) => {
  const t = e.parentNode;
  if (t) {
    for (; e.firstChild; )
      t.insertBefore(e.firstChild, e);
    t.removeChild(e), t.normalize();
  }
}, Zt = (e, t) => {
  const r = e.parentElement;
  return !r || r.closest(ii) ? !0 : !t.contains(r) || !e.data.trim();
}, st = (e, t) => {
  const r = e.ownerDocument.defaultView, o = r?.NodeFilter || (typeof NodeFilter < "u" ? NodeFilter : void 0);
  return o ? o[t] : t === "SHOW_TEXT" ? 4 : t === "FILTER_REJECT" ? 2 : 1;
}, pi = (e) => {
  const t = [], r = e.ownerDocument.createTreeWalker(e, st(e, "SHOW_TEXT"), {
    acceptNode(i) {
      return Zt(i, e) ? st(e, "FILTER_REJECT") : st(e, "FILTER_ACCEPT");
    }
  });
  let o = r.nextNode();
  for (; o; )
    Zt(o, e) || t.push(o), o = r.nextNode();
  return t;
}, mi = (e) => {
  var t, r;
  return ((r = (t = e?.ownerDocument) === null || t === void 0 ? void 0 : t.defaultView) === null || r === void 0 ? void 0 : r.MutationObserver) || (typeof MutationObserver < "u" ? MutationObserver : void 0);
}, fi = (e) => {
  var t;
  return ((t = e?.ownerDocument) === null || t === void 0 ? void 0 : t.defaultView) || (typeof window < "u" ? window : void 0);
}, vi = (e) => {
  if (Math.max(0, e.scrollHeight - e.clientHeight) <= 2)
    return !1;
  const r = e.ownerDocument.defaultView || (typeof window < "u" ? window : void 0);
  if (!r?.getComputedStyle)
    return !0;
  const o = r.getComputedStyle(e), i = o.overflowY || o.overflow;
  return ["auto", "scroll", "overlay", "visible"].includes(i);
}, wi = ({ root: e, options: t, waitForDomUpdate: r, preferredScrollContainer: o }) => {
  let i = [], n = [];
  const a = /* @__PURE__ */ new Set(), l = wt();
  let s = null, m = !1, w = null, p = !1;
  const h = () => Oo(t?.()), k = () => {
    const v = ci(n);
    l.total = v.length, l.currentIndex = v.length ? Math.max(0, Math.min(l.currentIndex, v.length - 1)) : -1, l.current = l.currentIndex >= 0 ? v[l.currentIndex] : null, l.matches = v;
  }, g = (v) => _r(l, v), f = () => {
    Array.from(a).forEach(ui), a.clear(), n = [], l.total = 0, l.currentIndex = -1, l.current = null, l.matches = [];
  }, S = async (v, E = l.query) => {
    var u;
    const A = Ht(e());
    if (!A)
      return null;
    f();
    const U = await v(A);
    return g(U || ((u = A.getState) === null || u === void 0 ? void 0 : u.call(A)) || wt(E));
  }, P = () => {
    s?.disconnect(), s = null;
  }, F = (v) => {
    const E = e() || null, u = o?.() || null;
    if (u && (u === v || u.contains(v)))
      return u;
    let A = v.parentElement;
    for (; A; ) {
      if (vi(A))
        return A;
      if (A === E)
        break;
      A = A.parentElement;
    }
    return E;
  }, D = (v) => {
    const E = F(v);
    if (!E) {
      v.scrollIntoView({ block: "center", inline: "nearest" });
      return;
    }
    const u = E.scrollLeft, A = E.getBoundingClientRect(), U = v.getBoundingClientRect(), q = U.top - A.top + E.scrollTop - E.clientHeight / 2 + U.height / 2, X = Math.max(0, E.scrollHeight - E.clientHeight), J = Math.max(0, Math.min(q, X));
    typeof E.scrollTo == "function" ? E.scrollTo({
      top: J,
      left: u,
      behavior: "auto"
    }) : (E.scrollTop = J, E.scrollLeft = u), E.scrollLeft = u;
  }, R = (v, E = !0) => {
    const u = h();
    if (!n.length)
      return k(), l;
    const A = (v % n.length + n.length) % n.length;
    n.forEach((q) => {
      q.element.classList.remove(u.activeClassName || Nt);
    });
    const U = n[A];
    return U.element.classList.add(u.activeClassName || Nt), l.currentIndex = A, k(), E && D(U.element), l;
  }, b = (v, E, u, A) => {
    var U;
    const q = e();
    if (!q)
      return;
    const X = h(), J = v.data;
    let _ = 0, B;
    const pe = v.ownerDocument.createDocumentFragment();
    let G = !1;
    for (E.lastIndex = 0; (B = E.exec(J)) && A.length < u; ) {
      if (!B[0]) {
        E.lastIndex += 1;
        continue;
      }
      B.index > _ && pe.appendChild(v.ownerDocument.createTextNode(J.slice(_, B.index)));
      const K = v.ownerDocument.createElement("mark");
      K.className = X.className || ri, K.textContent = B[0], K.dataset.searchMatchId = `viewer-search-match-${A.length + 1}`, a.add(K), pe.appendChild(K), G = !0;
      const Q = qo(v.parentElement, i, q);
      A.push({
        id: K.dataset.searchMatchId,
        index: A.length,
        text: B[0],
        anchor: Q,
        line: Q?.line,
        page: Q?.page,
        element: K
      }), _ = B.index + B[0].length;
    }
    G && (_ < J.length && pe.appendChild(v.ownerDocument.createTextNode(J.slice(_))), (U = v.parentNode) === null || U === void 0 || U.replaceChild(pe, v));
  }, x = () => {
    P();
    const v = e(), E = mi(v);
    !m || !v || !E || Ht(v) || (s = new E(W), s.observe(v, {
      childList: !0,
      subtree: !0,
      characterData: !0
    }));
  }, I = () => {
    if (!m)
      return;
    const v = fi(e());
    if (v?.setTimeout) {
      v.setTimeout(x, 0);
      return;
    }
    setTimeout(x, 0);
  }, $ = async (v, E = 0) => {
    const u = si(v), A = h();
    l.query = u, P(), p = !0;
    try {
      f();
      const U = e();
      if (!u || A.enabled === !1 || !U) {
        const G = await S((K) => {
          var Q;
          return (Q = K.clear) === null || Q === void 0 ? void 0 : Q.call(K);
        }, u);
        return G || l;
      }
      const q = await S((G) => G.search(u, A), u);
      if (q)
        return q;
      await r?.();
      const X = e();
      if (!X)
        return l;
      i = Bt(X);
      const J = di(u, A), _ = Math.max(1, A.maxMatches || oi), B = [], pe = pi(X);
      for (const G of pe) {
        if (B.length >= _)
          break;
        b(G, J, _, B);
      }
      n = B, k(), B.length && R(E, !0);
    } finally {
      p = !1, I();
    }
    return l;
  }, W = () => {
    var v;
    const E = h();
    !l.query || p || E.enabled === !1 || (w !== null && clearTimeout(w), w = setTimeout(() => {
      w = null, $(l.query, Math.max(0, l.currentIndex));
    }, (v = E.debounce) !== null && v !== void 0 ? v : 180));
  };
  return {
    get anchors() {
      return i;
    },
    state: l,
    getInternalMatches: () => n,
    observe() {
      m = !0, x();
    },
    async refreshAnchors() {
      return await r?.(), i = Bt(e() || null), i;
    },
    search: (v) => $(v, 0),
    next: async () => await S((E) => {
      var u, A;
      return ((u = E.next) === null || u === void 0 ? void 0 : u.call(E)) || ((A = E.getState) === null || A === void 0 ? void 0 : A.call(E));
    }) || R(l.currentIndex + 1),
    previous: async () => await S((E) => {
      var u, A;
      return ((u = E.previous) === null || u === void 0 ? void 0 : u.call(E)) || ((A = E.getState) === null || A === void 0 ? void 0 : A.call(E));
    }) || R(l.currentIndex - 1),
    clear: async () => {
      l.query = "", P(), p = !0;
      try {
        f();
        const v = await S((E) => {
          var u;
          return (u = E.clear) === null || u === void 0 ? void 0 : u.call(E);
        }, "");
        return v || l;
      } finally {
        p = !1, I();
      }
    },
    destroy() {
      m = !1, P(), w !== null && (clearTimeout(w), w = null), f();
    }
  };
}, Tr = (e) => Dr(e), hi = ({ root: e, anchors: t }) => Xo(e || null, t), gi = ({ root: e, searchTarget: t, searchOptions: r, waitForDomUpdate: o, preferredScrollContainer: i, getAiOptions: n, onSearchChange: a, onLocationChange: l }) => {
  let s = null;
  const m = wi({
    root: e,
    options: r,
    waitForDomUpdate: o,
    preferredScrollContainer: () => {
      var p, h;
      return (h = (p = i?.()) !== null && p !== void 0 ? p : s?.getScrollContainer()) !== null && h !== void 0 ? h : null;
    }
  }), w = li(t, m);
  return s = xi({
    root: e,
    searchController: {
      getAnchors: () => t.anchors.value,
      getSearchState: () => t.state,
      observe: w.observe,
      refreshAnchors: w.refreshAnchors,
      search: w.search,
      clear: w.clear,
      next: w.next,
      previous: w.previous
    },
    getAiOptions: n,
    onSearchChange: a,
    onLocationChange: l
  }), {
    ...s,
    destroyDocumentFeatures: w.destroy
  };
}, bi = ({ state: e, onChange: t }) => {
  const r = Tr(e);
  return t?.(r), !0;
}, yi = ({ anchor: e, onChange: t }) => (t?.(e), !0), xi = ({ root: e, searchController: t, getAiOptions: r, onSearchChange: o, onLocationChange: i }) => {
  const n = () => e() || null, a = () => t.getAnchors(), l = () => Tr(t.getSearchState()), s = () => {
    const f = l();
    return bi({
      state: f,
      onChange: o
    }), f;
  }, m = () => hi({
    root: n(),
    anchors: a()
  }), w = () => {
    const f = m();
    return yi({
      anchor: f,
      onChange: i
    }), f;
  }, p = (f) => f?.notify === !1 ? m() : w(), h = async (f) => {
    t.observe();
    const S = await t.refreshAnchors();
    return p(f), S;
  }, k = async (f) => (a().length || await h(f), a()), g = (f, S) => {
    const P = Ko(n(), f);
    return p(S), P;
  };
  return {
    refreshDocumentIndex: h,
    async clearDocumentState() {
      return await t.clear(), l();
    },
    getScrollContainer() {
      return Ar(n());
    },
    async searchDocument(f) {
      return await t.search(f), s();
    },
    async clearDocumentSearch() {
      return await t.clear(), s();
    },
    async nextSearchResult() {
      return await t.next(), w(), s();
    },
    async previousSearchResult() {
      return await t.previous(), w(), s();
    },
    getSearchState: l,
    async collectDocumentAnchors(f) {
      return await h(f), a();
    },
    getCurrentDocumentAnchor: m,
    scrollToLoadedAnchor: g,
    async scrollToAnchor(f, S) {
      return await k(S), g(f, S);
    },
    async scrollToLine(f, S) {
      return await k(S), g(f, S);
    },
    getDocumentTextChunks(f) {
      return Uo(a(), f ?? r?.());
    }
  };
}, Ie = (e) => ({
  scale: e.scale,
  label: e.label,
  canZoomIn: e.canZoomIn,
  canZoomOut: e.canZoomOut,
  canReset: e.canReset,
  minScale: e.minScale,
  maxScale: e.maxScale
}), $e = (e, t) => {
  const r = Rr(t || {});
  return e.scale = r.scale, e.label = r.label, e.canZoomIn = r.canZoomIn, e.canZoomOut = r.canZoomOut, e.canReset = r.canReset, e.minScale = r.minScale, e.maxScale = r.maxScale, e;
}, Xl = () => {
  const e = /* @__PURE__ */ new Set();
  return {
    emit() {
      e.forEach((t) => t());
    },
    subscribe(t) {
      return e.add(t), () => {
        e.delete(t);
      };
    }
  };
}, Si = (e) => {
  var t, r;
  return ((r = (t = e?.ownerDocument) === null || t === void 0 ? void 0 : t.defaultView) === null || r === void 0 ? void 0 : r.MutationObserver) || (typeof MutationObserver < "u" ? MutationObserver : void 0);
}, Fi = ({ root: e, enabled: t, beforeZoom: r, onChange: o }) => {
  let i = null, n = null, a = null, l = !1;
  const s = Rr(), m = () => {
    o?.(Ie(s));
  }, w = () => {
    n?.(), n = null, i = null, $e(s, null);
  }, p = () => {
    var g, f;
    if (t?.() === !1)
      return w(), null;
    const S = _t(e());
    return S !== i && (n?.(), i = S, n = ((g = S?.subscribe) === null || g === void 0 ? void 0 : g.call(S, () => {
      $e(s, S.getState()), l || m();
    })) || null), $e(s, ((f = S?.getState) === null || f === void 0 ? void 0 : f.call(S)) || null), S;
  }, h = () => {
    a?.disconnect(), a = null;
  }, k = async (g, f) => {
    const S = p();
    if (!S || r && await r(g) === !1)
      return Ie(s);
    l = !0;
    try {
      const P = await f(S);
      return $e(s, P || S.getState()), Ie(s);
    } finally {
      l = !1;
    }
  };
  return {
    get provider() {
      return i;
    },
    state: s,
    hasProvider() {
      return !!p();
    },
    refreshProvider: p,
    observe() {
      h();
      const g = e(), f = Si(g);
      if (!g || !f) {
        p();
        return;
      }
      a = new f(() => {
        p();
      }), a.observe(g, {
        childList: !0,
        subtree: !0
      }), p();
    },
    clearProvider: w,
    getState() {
      return Ie(s);
    },
    zoomIn: () => k("zoom-in", (g) => g.zoomIn()),
    zoomOut: () => k("zoom-out", (g) => g.zoomOut()),
    resetZoom: () => k("zoom-reset", (g) => g.resetZoom()),
    destroy() {
      h(), w();
    }
  };
}, Ei = [
  "auto",
  "contain",
  "cover",
  "width",
  "height",
  "actual",
  "scale-down"
], ki = [
  "until-interaction",
  "always",
  "initial"
], gt = "until-interaction", Pr = 0, Ri = 8, Ai = (e) => !!e && typeof e == "object" && !Array.isArray(e), Gt = (e) => typeof e == "string" && Ei.includes(e), Di = (e) => typeof e == "string" && ki.includes(e), qt = (e) => {
  const t = Number(e);
  return Number.isFinite(t) && t > 0 ? t : void 0;
}, _i = (e) => {
  const t = Number(e);
  return Number.isFinite(t) && t > 0 ? t : Pr;
}, Ae = (e) => {
  if (e == null || e === !1)
    return null;
  if (Gt(e))
    return {
      mode: e,
      resize: gt,
      padding: Pr
    };
  if (!Ai(e))
    return null;
  const t = qt(e.minScale), r = qt(e.maxScale), o = t !== void 0 && r !== void 0 && r < t ? t : r;
  return {
    mode: Gt(e.mode) ? e.mode : "auto",
    resize: Di(e.resize) ? e.resize : gt,
    padding: _i(e.padding),
    minScale: t,
    maxScale: o
  };
}, Ti = (e, t, r) => {
  let o = e;
  return Number.isFinite(t) && (o = Math.max(Number(t), o)), Number.isFinite(r) && (o = Math.min(Number(r), o)), o;
}, Pi = ({ mode: e, viewportWidth: t, viewportHeight: r, contentWidth: o, contentHeight: i, minScale: n, maxScale: a }) => {
  if (t <= 0 || r <= 0 || o <= 0 || i <= 0)
    return;
  const l = t / o, s = r / i, m = Math.min(l, s), w = Math.max(l, s), p = (() => {
    switch (e) {
      case "cover":
        return w;
      case "width":
        return l;
      case "height":
        return s;
      case "actual":
        return 1;
      case "scale-down":
        return Math.min(1, m);
      default:
        return m;
    }
  })();
  if (!(!Number.isFinite(p) || p <= 0))
    return Ti(p, n, a);
}, zi = (e) => {
  var t, r;
  if (!e)
    return !1;
  const o = Number((t = e.scale) !== null && t !== void 0 ? t : (r = e.zoom) === null || r === void 0 ? void 0 : r.scale);
  if (Number.isFinite(o) && o > 0 || Number.isFinite(e.page) || Number.isFinite(e.rotation) || e.navigation && Object.keys(e.navigation).length > 0 || e.extra && Object.keys(e.extra).length > 0)
    return !0;
  const i = e.scroll || {};
  return ["top", "left", "topRatio", "leftRatio"].some((n) => {
    const a = i[n];
    return Number.isFinite(a);
  });
}, Ve = (e, t, r = "viewer", o = "none") => ({
  applied: !1,
  mode: e.mode,
  resize: e.resize,
  source: r,
  reason: t,
  provider: o
}), Xt = (e, t, r) => ({
  applied: !!e?.applied,
  mode: e?.mode || t.mode,
  resize: e?.resize || t.resize,
  scale: e?.scale,
  source: e?.source || t.source,
  reason: e?.reason,
  provider: e?.provider || r,
  state: e?.state
}), Ii = (e) => e === "pending" || e === "retry" || e === "image-not-ready" || e === "unmeasurable", Vi = (e) => {
  var t;
  const r = (t = e.getBoundingClientRect) === null || t === void 0 ? void 0 : t.call(e);
  return {
    width: Math.max(0, r?.width || e.clientWidth || 0),
    height: Math.max(0, r?.height || e.clientHeight || 0)
  };
}, Li = ({ root: e, enabled: t, getFit: r = () => {
}, onFit: o }) => {
  let i = null, n = null, a = null, l = !1, s = 0;
  const m = () => {
    var F;
    const D = e();
    return ((F = D?.ownerDocument) === null || F === void 0 ? void 0 : F.defaultView) || (typeof window < "u" ? window : void 0);
  }, w = () => {
    if (n === null)
      return;
    const F = m();
    F?.cancelAnimationFrame && F.cancelAnimationFrame(n), n = null;
  }, p = () => {
    a && clearTimeout(a), a = null;
  }, h = (F, D) => {
    const R = F === void 0 ? r() : F;
    return R != null ? Ae(R) : D === "api" ? Ae("auto") : null;
  }, k = (F, D, R) => {
    s >= Ri || (p(), s += 1, a = setTimeout(() => {
      a = null, g(F, { source: D, reason: R === "api" ? "api" : "retry" });
    }, 32 * s));
  }, g = async (F, D = {}) => {
    const R = D.source || "api", b = D.reason || "api", x = h(F, b);
    if (!x)
      return {
        applied: !1,
        mode: "auto",
        resize: gt,
        source: R,
        reason: "not-configured",
        provider: "none"
      };
    if (t?.() === !1)
      return Ve(x, "disabled", R);
    const I = e();
    if (!I)
      return k(F, R, b), Ve(x, "no-root", R);
    const $ = Vi(I);
    if ($.width <= 0 || $.height <= 0)
      return k(F, R, b), Ve(x, "zero-size", R);
    const W = {
      ...x,
      source: R,
      reason: b,
      viewportWidth: Math.max(0, $.width - x.padding * 2),
      viewportHeight: Math.max(0, $.height - x.padding * 2),
      container: I
    }, v = Tt(I);
    let E = null;
    if (v?.fit) {
      const U = Xt(await v.fit(W), W, "view-state");
      if (U.applied)
        return s = 0, o?.(U), U;
      E = U;
    }
    const u = _t(I);
    if (u?.fit) {
      const U = Xt(await u.fit(W), W, "zoom");
      if (U.applied)
        return s = 0, o?.(U), U;
      E = U;
    }
    const A = Ve(x, v || u ? "unsupported" : "no-provider", R);
    return (A.reason === "no-provider" || Ii(E?.reason)) && k(F, R, b), A;
  }, f = (F = "resize") => {
    const D = Ae(r());
    if (!D || D.resize === "initial" || D.resize === "until-interaction" && l)
      return;
    w();
    const R = m(), b = () => {
      n = null, g(void 0, { source: "viewer", reason: F });
    };
    if (R?.requestAnimationFrame) {
      n = R.requestAnimationFrame(b);
      return;
    }
    n = setTimeout(b, 16);
  }, S = () => {
    w(), i?.disconnect(), i = null;
  };
  return {
    normalize: Ae,
    fit: async (F, D) => (p(), l = !1, g(F, {
      source: D?.source || "api",
      reason: D?.reason || "api"
    })),
    applyInitialFit: async (F = {}) => {
      if (p(), s = 0, l = !1, F.skip) {
        const D = Ae(r()) || Ae("auto");
        return Ve(D, "initial-view-state", "initial");
      }
      return g(void 0, { source: "initial", reason: "initial" });
    },
    scheduleFit: f,
    observe() {
      var F, D;
      S();
      const R = e(), b = ((D = (F = R?.ownerDocument) === null || F === void 0 ? void 0 : F.defaultView) === null || D === void 0 ? void 0 : D.ResizeObserver) || (typeof ResizeObserver < "u" ? ResizeObserver : void 0);
      !R || !b || (i = new b(() => f("resize")), i.observe(R));
    },
    markUserInteraction() {
      l = !0, p();
    },
    resetAutoFit() {
      l = !1, s = 0;
    },
    destroy() {
      S(), p(), s = 0;
    }
  };
}, he = (e) => e ? {
  ...e,
  zoom: e.zoom ? { ...e.zoom } : void 0,
  scroll: e.scroll ? { ...e.scroll } : void 0,
  navigation: e.navigation ? { ...e.navigation } : void 0,
  extra: e.extra ? { ...e.extra } : void 0
} : null, Ci = (e, t = {}) => ({
  state: he(e) || {},
  action: t.action || "init",
  source: t.source || "viewer",
  timestamp: t.timestamp || Date.now()
}), Mi = () => {
  const e = /* @__PURE__ */ new Set();
  return {
    emit(t) {
      e.forEach((r) => r(t));
    },
    subscribe(t) {
      return e.add(t), () => {
        e.delete(t);
      };
    }
  };
}, zr = (e) => {
  var t;
  return ((t = e.ownerDocument) === null || t === void 0 ? void 0 : t.defaultView) || (typeof window < "u" ? window : void 0);
}, dt = (e) => {
  const t = zr(e);
  return new Promise((r) => {
    if (t?.requestAnimationFrame) {
      t.requestAnimationFrame(() => r());
      return;
    }
    setTimeout(r, 16);
  });
}, Oi = (e) => {
  const t = Math.max(0, e.scrollHeight - e.clientHeight), r = Math.max(0, e.scrollWidth - e.clientWidth);
  return {
    top: e.scrollTop || 0,
    left: e.scrollLeft || 0,
    width: e.scrollWidth || 0,
    height: e.scrollHeight || 0,
    clientWidth: e.clientWidth || 0,
    clientHeight: e.clientHeight || 0,
    topRatio: t > 0 ? (e.scrollTop || 0) / t : 0,
    leftRatio: r > 0 ? (e.scrollLeft || 0) / r : 0
  };
}, Kt = (e, t, r) => {
  if (Number.isFinite(e))
    return Number(e);
  if (Number.isFinite(t))
    return Number(t) * r;
}, Wi = ({ host: e, renderer: t, scrollTarget: r }) => {
  var o, i;
  const n = Mi(), a = zr(e);
  let l = !1, s = 0, m = 0, w = null;
  const p = () => typeof r == "function" ? r() || e : r || Ar(e) || e, h = () => _t(e), k = () => {
    var b, x;
    const I = (x = (b = h()) === null || b === void 0 ? void 0 : b.getState) === null || x === void 0 ? void 0 : x.call(b), $ = p();
    return {
      renderer: t,
      scale: I?.scale,
      zoom: I,
      scroll: $ ? Oi($) : void 0
    };
  }, g = (b, x = "viewer") => {
    if (l)
      return k();
    const I = k();
    return n.emit(Ci(I, { action: b, source: x })), I;
  }, f = () => {
    m = Math.max(m, Date.now() + 180);
  }, S = (b) => {
    if (!b)
      return;
    const x = p(), I = Math.max(0, x.scrollHeight - x.clientHeight), $ = Math.max(0, x.scrollWidth - x.clientWidth), W = Kt(b.top, b.topRatio, I), v = Kt(b.left, b.leftRatio, $);
    f(), W !== void 0 && (x.scrollTop = Math.min(Math.max(0, W), I)), v !== void 0 && (x.scrollLeft = Math.min(Math.max(0, v), $));
  }, P = async (b) => {
    var x, I, $, W;
    const v = h();
    if (v?.fit)
      return v.fit(b);
    if (!v?.setZoom)
      return {
        applied: !1,
        mode: b.mode,
        resize: b.resize,
        source: b.source,
        reason: "zoom-provider-unavailable",
        provider: "view-state"
      };
    const E = v.getState(), u = Number(E.scale) > 0 ? Number(E.scale) : 1, A = p(), U = b.viewportWidth || A.clientWidth || e.clientWidth, q = b.viewportHeight || A.clientHeight || e.clientHeight, X = Math.max(A.scrollWidth || 0, e.scrollWidth || 0, ((x = A.getBoundingClientRect) === null || x === void 0 ? void 0 : x.call(A).width) || 0), J = Math.max(A.scrollHeight || 0, e.scrollHeight || 0, ((I = A.getBoundingClientRect) === null || I === void 0 ? void 0 : I.call(A).height) || 0), _ = Pi({
      mode: b.mode,
      viewportWidth: U,
      viewportHeight: q,
      contentWidth: X / u,
      contentHeight: J / u,
      minScale: ($ = b.minScale) !== null && $ !== void 0 ? $ : E.minScale,
      maxScale: (W = b.maxScale) !== null && W !== void 0 ? W : E.maxScale
    });
    if (!_)
      return {
        applied: !1,
        mode: b.mode,
        resize: b.resize,
        source: b.source,
        reason: "unmeasurable",
        provider: "view-state"
      };
    f(), await v.setZoom(_), await dt(e);
    const B = g("fit", b.source);
    return {
      applied: !0,
      mode: b.mode,
      resize: b.resize,
      scale: _,
      source: b.source,
      provider: "view-state",
      state: B
    };
  }, F = () => {
    if (l || Date.now() < m || s)
      return;
    s = (a?.requestAnimationFrame || ((x) => setTimeout(() => x(Date.now()), 16)))(() => {
      s = 0, g("scroll", "user");
    });
  }, D = {
    getState: k,
    async applyState(b, x = {}) {
      var I, $;
      const W = x.source || "api", v = x.action || "restore", E = x.notify !== !1, u = h(), A = Number((I = b.scale) !== null && I !== void 0 ? I : ($ = b.zoom) === null || $ === void 0 ? void 0 : $.scale);
      return f(), Number.isFinite(A) && u?.setZoom && await u.setZoom(A), await dt(e), S(b.scroll), await dt(e), S(b.scroll), E ? g(v, W) : k();
    },
    fit: P,
    subscribe: n.subscribe
  };
  e.dataset.viewerViewStateProvider = "generic", Yo(e, D), (o = e.addEventListener) === null || o === void 0 || o.call(e, "scroll", F, {
    capture: !0,
    passive: !0
  });
  const R = h();
  return w = ((i = R?.subscribe) === null || i === void 0 ? void 0 : i.call(R, () => {
    g("zoom-change", "viewer");
  })) || null, {
    provider: D,
    destroy() {
      var b;
      l = !0, w?.(), w = null, s && a?.cancelAnimationFrame && a.cancelAnimationFrame(s), s = 0, (b = e.removeEventListener) === null || b === void 0 || b.call(e, "scroll", F, !0), Jo(e);
    }
  };
}, Ui = (e) => {
  var t, r;
  return ((r = (t = e?.ownerDocument) === null || t === void 0 ? void 0 : t.defaultView) === null || r === void 0 ? void 0 : r.MutationObserver) || (typeof MutationObserver < "u" ? MutationObserver : void 0);
}, Bi = ({ root: e, enabled: t, onChange: r }) => {
  let o = null, i = null, n = null, a = null;
  const l = () => {
    var h;
    return he(((h = o?.getState) === null || h === void 0 ? void 0 : h.call(o)) || null);
  }, s = (h, k) => (a = he(h), k && a && r?.({
    ...k,
    state: he(k.state) || a
  }), he(a)), m = () => (i?.(), i = null, o = null, s(null)), w = () => {
    var h;
    if (t?.() === !1)
      return m(), null;
    const k = Tt(e());
    return k !== o && (i?.(), o = k, i = ((h = k?.subscribe) === null || h === void 0 ? void 0 : h.call(k, (g) => {
      s(g.state, g);
    })) || null), s(l()), k;
  }, p = () => {
    n?.disconnect(), n = null;
  };
  return {
    get provider() {
      return o;
    },
    get state() {
      return he(a);
    },
    hasProvider() {
      return !!w();
    },
    refreshProvider: w,
    observe() {
      p();
      const h = e(), k = Ui(h);
      if (!h || !k) {
        w();
        return;
      }
      n = new k(() => {
        w();
      }), n.observe(h, {
        childList: !0,
        subtree: !0
      }), w();
    },
    clearProvider: m,
    getState() {
      return w(), he(a);
    },
    async applyState(h, k) {
      const g = w();
      if (!g?.applyState)
        return he(a);
      const f = await g.applyState(h, k);
      return s(f || g.getState()), he(a);
    },
    destroy() {
      p(), m();
    }
  };
}, Ze = (e) => Math.max(0, Math.min(100, e)), Ir = (e) => {
  if (!e)
    return null;
  const t = e.pageIndex;
  if (t !== void 0 && (!Number.isInteger(t) || t < 0))
    return null;
  const r = Ze(Number(e.left) || 0), o = Ze(Number(e.top) || 0), i = Ze(Number(e.width) || 0), n = Ze(Number(e.height) || 0);
  return i <= 0 || n <= 0 ? null : {
    left: r,
    top: o,
    width: Math.min(i, 100 - r),
    height: Math.min(n, 100 - o),
    ...t === void 0 ? {} : { pageIndex: t }
  };
}, Hi = (e) => {
  if (typeof e != "string")
    return "";
  const t = e.trim();
  return /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);/i.test(t) || /^(?:blob:|https?:\/\/|\/|\.\.?\/)/i.test(t) ? t : "";
}, Ni = (e) => {
  const t = Number(e);
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
}, ji = (e) => {
  const t = Number(e);
  return Number.isFinite(t) ? (t % 360 + 360) % 360 : 0;
}, $i = (e) => {
  const t = Ir(e), r = Hi(e?.src);
  return !t || !r ? null : {
    ...t,
    src: r,
    opacity: Ni(e?.opacity),
    rotate: ji(e?.rotate),
    ...typeof e?.alt == "string" && e.alt.trim() ? { alt: e.alt.trim() } : {}
  };
}, nt = (e) => {
  if (!e)
    return null;
  const t = (e.regions || []).map((o) => Ir(o)).filter((o) => !!o), r = (e.stamps || []).map((o) => $i(o)).filter((o) => !!o);
  return !t.length && !r.length ? null : {
    ...t.length ? { regions: t } : {},
    ...r.length ? { stamps: r } : {},
    color: e.color || "#000000"
  };
}, Yt = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), Vr = (e, t = !1) => {
  const r = nt(e);
  if (!r)
    return "";
  const o = r.color || "#000000", i = (r.regions || []).map((l) => `<div class="viewer-export-print-mask-block" style="left:${l.left}%;top:${l.top}%;width:${l.width}%;height:${l.height}%;background:${o};"></div>`).join(""), n = (r.stamps || []).map((l) => {
    var s, m;
    return `<img class="viewer-export-print-stamp" src="${Yt(l.src)}" alt="${Yt(l.alt || "")}" draggable="false" style="left:${l.left}%;top:${l.top}%;width:${l.width}%;height:${l.height}%;opacity:${(s = l.opacity) !== null && s !== void 0 ? s : 1};transform:rotate(${(m = l.rotate) !== null && m !== void 0 ? m : 0}deg);" />`;
  }).join("");
  return `<div class="${t ? "viewer-export-print-mask viewer-export-print-mask--page" : "viewer-export-print-mask"}" aria-hidden="true">${i}${n}</div>`;
}, Zi = `
  .viewer-export-print-mask{position:absolute;inset:0;z-index:15;pointer-events:none;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .viewer-export-print-mask--page{z-index:2147483647;}
  .viewer-export-print-mask-block{position:absolute;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .viewer-export-print-stamp{position:absolute;display:block;object-fit:contain;transform-origin:center center;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  [data-viewer-print-page-index]{position:relative!important;isolation:isolate;}
`, Gi = (e, t) => {
  var r, o;
  const i = nt(t);
  if (!i)
    return e;
  const n = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map();
  return (r = i.regions) === null || r === void 0 || r.forEach((l) => {
    if (l.pageIndex === void 0)
      return;
    const s = n.get(l.pageIndex) || [];
    s.push(l), n.set(l.pageIndex, s);
  }), (o = i.stamps) === null || o === void 0 || o.forEach((l) => {
    if (l.pageIndex === void 0)
      return;
    const s = a.get(l.pageIndex) || [];
    s.push(l), a.set(l.pageIndex, s);
  }), !n.size && !a.size ? e : e.replace(/(<[A-Za-z][^>]*\sdata-viewer-print-page-index=(['"])(\d+)\2[^>]*>)/g, (l, s, m, w) => {
    const p = n.get(Number(w)), h = a.get(Number(w));
    return !p?.length && !h?.length ? l : `${s}${Vr({
      regions: p || [],
      stamps: h || [],
      color: i.color
    }, !0)}`;
  });
}, Lr = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), qi = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #f2f4f7; color: #172033; font-family: Aptos, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { padding: 24px; }
  .viewer-export-shell { position: relative; min-height: calc(100vh - 48px); overflow: visible; background: #f2f4f7; }
  .viewer-export-content { position: relative; z-index: 1; contain: none; width: 100%; min-height: 100%; overflow: visible; }
  .viewer-export-watermark { position: absolute; inset: 0; pointer-events: none; z-index: 20; background-repeat: repeat; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .viewer-export-content .file-render,
  .viewer-export-content .file-viewer,
  .viewer-export-content .viewer-stage,
  .viewer-export-content .content,
  .viewer-export-content .pdf-shell,
  .viewer-export-content .pdf-content,
  .viewer-export-content .pdf-viewport,
  .viewer-export-content .pdf-wrapper,
  .viewer-export-content .docx-fit-viewer,
  .viewer-export-content .docx-wrapper,
  .viewer-export-content .msdoc-stage,
  .viewer-export-content .code-viewer,
  .viewer-export-content .markdown-viewer,
  .viewer-export-content .email-shell,
  .viewer-export-content .archive-shell,
  .viewer-export-content .eda-shell,
  .viewer-export-content .ebook-shell,
  .viewer-export-content .umd-shell,
  .viewer-export-content .drawing-shell,
  .viewer-export-content .audio-shell,
  .viewer-export-content .cad-shell,
  .viewer-export-content .cad-body,
  .viewer-export-content .cad-canvas-wrap,
  .viewer-export-content .dwg-preview-frame {
    position: relative !important;
    inset: auto !important;
    contain: none !important;
    width: 100% !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }
  .viewer-export-content .docx-wrapper {
    display: block !important;
    padding: 0 !important;
    background: transparent !important;
  }
  .viewer-export-content .docx-print-document {
    display: block !important;
    width: fit-content !important;
    max-width: 100% !important;
    height: auto !important;
    overflow: visible !important;
    margin: 0 auto !important;
  }
  .viewer-export-content .docx-page-frame {
    position: relative !important;
    width: var(--viewer-print-page-width, fit-content) !important;
    height: var(--viewer-print-page-height, auto) !important;
    min-height: var(--viewer-print-page-height, 0) !important;
    max-width: 100% !important;
    margin: 0 auto 18px !important;
    overflow: hidden !important;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  .viewer-export-content .msdoc-page {
    position: relative !important;
    width: var(--viewer-print-page-width, 794px) !important;
    min-height: var(--viewer-print-page-height, 1123px) !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 auto 18px !important;
    overflow: visible !important;
    break-after: page;
    page-break-after: always;
  }
  .viewer-export-content .docx-page-frame:last-child,
  .viewer-export-content .msdoc-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .viewer-export-content .docx-page-frame > section.docx {
    position: relative !important;
    top: auto !important;
    left: auto !important;
    width: var(--viewer-print-page-width, auto) !important;
    min-height: var(--viewer-print-page-height, auto) !important;
    max-width: none !important;
    margin: 0 auto !important;
    overflow: visible !important;
    transform: none !important;
    box-shadow: none !important;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .viewer-export-content .msdoc-stage {
    display: block !important;
    padding: 0 !important;
    background: transparent !important;
  }
  .viewer-export-content .msdoc-page > .msdoc-root {
    margin: 0 auto !important;
    box-shadow: none !important;
    overflow: visible !important;
  }
  .viewer-export-content .pdf-toolbar,
  .viewer-export-content .pdf-nav-pane,
  .viewer-export-content .viewer-actions,
  .viewer-export-content .code-toolbar,
  .viewer-export-content .umd-toolbar,
  .viewer-export-content .drawing-toolbar,
  .viewer-export-content .cad-toolbar {
    display: none !important;
  }
  .viewer-export-content .pdf-content,
  .viewer-export-content .pdf-shell--nav-hidden .pdf-content,
  .viewer-export-content .cad-body.without-layers {
    display: block !important;
    grid-template-columns: none !important;
  }
  .viewer-export-content .pdfViewer { padding: 0 !important; }
  .viewer-export-content .pdfViewer .page {
    margin: 0 auto 16px !important;
    border: 0 !important;
    box-shadow: none !important;
    break-after: page;
    page-break-after: always;
  }
  .viewer-export-content .pdfViewer .page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .viewer-export-content .pdf-export-document {
    display: grid;
    justify-items: center;
    gap: 18px;
    padding: 4px 0;
  }
  .viewer-export-content .pdf-export-page {
    width: var(--viewer-print-page-width, auto);
    height: var(--viewer-print-page-height, auto);
    max-width: 100%;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  .viewer-export-content .pdf-export-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .viewer-export-content .pdf-export-page img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .viewer-export-content .pptx-wrapper {
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    overflow: visible !important;
    transform: none !important;
  }
  .viewer-export-content .pptx-wrapper .slide {
    margin: 0 auto 18px !important;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
    box-shadow: none !important;
  }
  .viewer-export-content .pptx-wrapper .slide:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .viewer-export-content .ofd-stage {
    padding: 0 !important;
    overflow: visible !important;
  }
  .viewer-export-content .ofd-page,
  .viewer-export-content .drawing-svg,
  .viewer-export-content .cad-canvas-wrap,
  .viewer-export-content .dwg-preview-frame {
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
    box-shadow: none !important;
  }
  .viewer-export-content .ofd-page:last-child,
  .viewer-export-content .drawing-svg:last-child,
  .viewer-export-content .cad-canvas-wrap:last-child,
  .viewer-export-content .dwg-preview-frame:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .viewer-export-content .code-area {
    overflow: visible !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
  }
  .viewer-export-content .umd-body,
  .viewer-export-content .umd-stage-wrap,
  .viewer-export-content .umd-stage {
    display: block !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }
  .viewer-export-content .umd-toc {
    display: none !important;
  }
  img, canvas, svg, video { max-width: 100%; }
  @media print {
    @page { margin: 12mm; }
    html, body { min-height: auto; background: #ffffff; }
    body { padding: 0; }
    .viewer-export-shell,
    .viewer-export-content {
      min-height: 0;
      overflow: visible;
      background: #ffffff;
    }
    .viewer-export-content .pdf-export-document {
      display: block;
      padding: 0;
    }
    .viewer-export-content .pdf-export-page {
      width: var(--viewer-print-page-width, auto) !important;
      height: var(--viewer-print-page-height, auto) !important;
      max-width: none !important;
      margin: 0;
      overflow: hidden;
      box-shadow: none;
    }
    .viewer-export-content .docx-page-frame {
      width: var(--viewer-print-page-width, auto) !important;
      height: var(--viewer-print-page-height, auto) !important;
      min-height: var(--viewer-print-page-height, 0) !important;
      max-width: none !important;
      margin: 0 !important;
      overflow: hidden !important;
    }
    .viewer-export-content .msdoc-page {
      width: var(--viewer-print-page-width, 794px) !important;
      min-height: var(--viewer-print-page-height, 1123px) !important;
      max-width: none !important;
      margin: 0 !important;
      overflow: visible !important;
    }
    .viewer-export-content .docx-page-frame > section.docx,
    .viewer-export-content .msdoc-page > .msdoc-root {
      width: var(--viewer-print-page-width, 100%) !important;
      max-width: none !important;
      border: 0 !important;
    }
    .viewer-export-content .pptx-wrapper .slide,
    .viewer-export-content .ofd-page,
    .viewer-export-content .drawing-svg,
    .viewer-export-content .cad-canvas-wrap,
    .viewer-export-content .dwg-preview-frame {
      box-shadow: none !important;
    }
  }
`, Xi = () => Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((e) => e instanceof HTMLStyleElement ? `<style>${e.textContent || ""}</style>` : e.href ? `<link rel="stylesheet" href="${Lr(e.href)}" />` : "").filter(Boolean).join(`
`), Jt = ({ contentHtml: e, includeDocumentStyles: t = !0, printStyle: r = "", title: o, watermarkInlineStyle: i = "", mask: n = null }) => {
  var a, l;
  const s = i ? `<div class="viewer-export-watermark" style="${i}"></div>` : "", m = nt(n), w = m ? {
    ...m,
    regions: (a = m.regions) === null || a === void 0 ? void 0 : a.filter((P) => P.pageIndex === void 0),
    stamps: (l = m.stamps) === null || l === void 0 ? void 0 : l.filter((P) => P.pageIndex === void 0)
  } : null, p = Vr(w), h = Gi(e, m), k = t ? Xi() : "", g = r ? `<style data-viewer-print-style>${r}</style>` : "", f = m ? `<style data-viewer-print-mask-style>${Zi}</style>` : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${Lr(o)}</title>
  ${k}
  <style>${qi}</style>
  ${f}
</head>
<body>
  <main class="viewer-export-shell">
    <div class="viewer-export-content">${h}</div>
    ${p}
    ${s}
  </main>
  ${g}
</body>
</html>`;
}, Ce = (e, t) => {
  const r = URL.createObjectURL(e), o = document.createElement("a");
  o.href = r, o.download = t, o.rel = "noopener", document.body.appendChild(o), o.click(), o.remove(), window.setTimeout(() => URL.revokeObjectURL(r), 4e3);
}, Ki = (e, t) => {
  const r = document.createElement("a");
  r.href = e, r.download = t, r.rel = "noopener", r.target = "_blank", document.body.appendChild(r), r.click(), r.remove();
}, Yi = (e, t) => {
  const r = Array.from(e.querySelectorAll("canvas"));
  Array.from(t.querySelectorAll("canvas")).forEach((i, n) => {
    const a = r[n];
    if (a)
      try {
        const l = document.createElement("img");
        l.src = a.toDataURL("image/png"), l.alt = "rendered canvas", l.style.maxWidth = "100%", l.style.display = "block", l.style.margin = "0 auto", i.replaceWith(l);
      } catch {
      }
  });
}, Ji = (e) => new Promise((t) => {
  const r = e || (typeof window < "u" ? window : void 0);
  if (!r || typeof r.requestAnimationFrame != "function") {
    (r?.setTimeout ? r.setTimeout.bind(r) : globalThis.setTimeout.bind(globalThis))(() => t(), 0);
    return;
  }
  const o = r.requestAnimationFrame.bind(r);
  o(() => {
    o(() => t());
  });
}), Qi = async (e) => {
  if (!e || typeof e.querySelectorAll != "function")
    return;
  const t = Array.from(e.querySelectorAll("img"));
  await Promise.all(t.map(async (r) => {
    if (!r.complete) {
      if ("decode" in r)
        try {
          await r.decode();
          return;
        } catch {
        }
      await new Promise((o) => {
        r.addEventListener("load", () => o(), { once: !0 }), r.addEventListener("error", () => o(), { once: !0 });
      });
    }
  }));
}, en = (e, t) => {
  const r = t, o = globalThis.Buffer;
  if (o)
    return `data:${r};base64,${o.from(e).toString("base64")}`;
  let i = "";
  const n = new Uint8Array(e);
  for (let a = 0; a < n.length; a += 1)
    i += String.fromCharCode(n[a]);
  return `data:${r};base64,${btoa(i)}`;
}, tn = async (e) => {
  if (typeof FileReader == "function")
    try {
      return await new Promise((t, r) => {
        const o = new FileReader();
        o.onload = () => t(String(o.result || "")), o.onerror = () => r(o.error || new Error("Failed to read blob")), o.readAsDataURL(e);
      });
    } catch {
    }
  return en(await e.arrayBuffer(), e.type || "application/octet-stream");
}, rn = (e) => {
  const t = e.match(/blob:[^\s"'<>)\\]+/g) || [];
  return Array.from(new Set(t));
}, Qt = async (e) => {
  if (!e.includes("blob:") || typeof fetch != "function")
    return e;
  const t = rn(e);
  if (!t.length)
    return e;
  const r = await Promise.all(t.map(async (i) => {
    try {
      const n = await fetch(i);
      if (!n.ok)
        return null;
      const a = await n.blob(), l = await tn(a);
      return l ? [i, l] : null;
    } catch {
      return null;
    }
  }));
  let o = e;
  for (const i of r) {
    if (!i)
      continue;
    const [n, a] = i;
    o = o.split(n).join(a);
  }
  return o;
}, on = async (e) => {
  const { document: t } = e;
  t.readyState !== "complete" && await new Promise((r) => {
    e.addEventListener("load", () => r(), { once: !0 }), e.setTimeout(() => r(), 1200);
  }), await Promise.all(Array.from(t.images).map(async (r) => {
    if (!r.complete) {
      if ("decode" in r)
        try {
          await r.decode();
          return;
        } catch {
        }
      await new Promise((o) => {
        r.addEventListener("load", () => o(), { once: !0 }), r.addEventListener("error", () => o(), { once: !0 }), e.setTimeout(() => o(), 1500);
      });
    }
  })), await new Promise((r) => {
    e.requestAnimationFrame(() => {
      e.requestAnimationFrame(() => r());
    });
  });
}, er = async (e, t) => t.mode !== "print" || !e?.printStyle ? "" : typeof e.printStyle == "function" ? await e.printStyle(t) : e.printStyle, tr = async (e, t) => {
  var r;
  await ((r = t?.beforeSnapshot) === null || r === void 0 ? void 0 : r.call(t)), await Ji(), await Qi(e);
}, nn = async ({ source: e, mode: t = "export", title: r, adapter: o = null, watermarkInlineStyle: i = "", mask: n = null }) => {
  const a = { mode: t, title: r }, l = o?.toHtml, s = nt(n);
  if (l) {
    await tr(e, o);
    const p = await Qt(await l(a)), h = await er(o, a);
    return Jt({
      contentHtml: p,
      includeDocumentStyles: o.includeDocumentStyles !== !1,
      printStyle: h,
      title: r,
      watermarkInlineStyle: i,
      mask: s
    });
  }
  await tr(e, o);
  const m = e.cloneNode(!0);
  m.querySelectorAll(".viewer-watermark").forEach((p) => p.remove()), Yi(e, m);
  const w = await er(o, a);
  return Jt({
    contentHtml: await Qt(m.innerHTML),
    printStyle: w,
    title: r,
    watermarkInlineStyle: i,
    mask: s
  });
}, an = {
  "toolbar.zoomGroup": "ズーム操作",
  "toolbar.zoomOut": "縮小",
  "toolbar.zoomIn": "拡大",
  "toolbar.zoomReset": "倍率をリセット",
  "toolbar.download": "ダウンロード",
  "toolbar.downloadTitle": "元のファイルをダウンロード",
  "toolbar.print": "印刷",
  "toolbar.printTitle": "レンダリング済みの全内容を印刷",
  "toolbar.printDirect": "直接印刷",
  "toolbar.printMask": "マスク・印章付き印刷",
  "toolbar.printMaskTitle": "機密領域を隠すか印章を追加してから印刷",
  "toolbar.printMaskAdd": "マスクを追加",
  "toolbar.printMaskClear": "クリア",
  "toolbar.printMaskCancel": "キャンセル",
  "toolbar.printMaskConfirm": "印刷を確定",
  "toolbar.printMaskHint": "マスクを描画するか、印章をアップロードして移動・サイズ変更します。",
  "toolbar.printStampUpload": "印章をアップロード",
  "toolbar.printStampRemove": "印章を削除",
  "toolbar.printStampResize": "印章のサイズ変更",
  "toolbar.exportHtml": "HTML",
  "toolbar.exportHtmlTitle": "現在のレンダリング結果を HTML として書き出す",
  "toolbar.search": "検索",
  "toolbar.searchPlaceholder": "ドキュメントを検索",
  "toolbar.searchPrevious": "前の一致",
  "toolbar.searchNext": "次の一致",
  "toolbar.searchClear": "検索をクリア",
  "toolbar.theme": "テーマ",
  "toolbar.themeToLight": "ライトモードに切り替え",
  "toolbar.themeToDark": "ダークモードに切り替え",
  "state.ready.title": "プレビュー完了",
  "state.ready.message": "ファイルのレンダリングが完了しました。",
  "state.empty.title": "ファイルがありません",
  "state.empty.message": "ファイルを選択するか、アクセス可能な URL を指定してプレビューを開始してください。",
  "state.unsupported.install.title": "プレビュー機能の追加が必要です",
  "state.unsupported.install.message": "{extension}は対応表に含まれていますが、このプロジェクトには {rendererLabel} renderer がまだ組み込まれていません。",
  "state.unsupported.install.description": "{presetPackage} をインストールし、options.preset / options.renderers から対応機能を渡してください{rendererTip}。Vite プロジェクトでは @file-viewer/vite-plugin によるインストール済み preset の自動検出も利用できます。",
  "state.unsupported.title": "オンラインプレビューには未対応です",
  "state.unsupported.message": "{extension}はオンラインでプレビューできません。ダウンロードするか、対応形式へ変換してください。",
  "state.unsupported.description": "Office、PDF、OFD、Typst、圧縮ファイル、メール、OLB/DRA、CAD、地理空間データ、3D モデル、Excalidraw、draw.io、EPUB、UMD、Markdown、コード/テキスト、画像、音声/動画、フォント、構造化データ資産のオンラインプレビューに対応しています。",
  "state.error.title": "プレビューに失敗しました",
  "preview.downloading": "ファイルをダウンロードしています...",
  "preview.streamingPdf": "PDF ストリーミングプレビューを準備しています...",
  "preview.reading": "ファイル内容を解析しています...",
  "error.download": "ダウンロードに失敗しました",
  "error.print": "印刷に失敗しました",
  "error.exportHtml": "HTML の書き出しに失敗しました",
  "error.noDownloadSource": "ダウンロード可能な元ファイルがありません",
  "error.noExportContent": "書き出し可能なプレビュー内容がありません",
  "error.printUnavailable": "このファイル形式は文書全体の印刷に対応していません。元ファイルをダウンロードし、ローカルアプリで印刷してください。",
  "error.printWindowBlocked": "ブラウザーによって印刷ウィンドウがブロックされました",
  "error.remoteDownload": "ファイルのダウンロードに失敗しました",
  "error.localRead": "ローカルファイルの読み込みに失敗しました",
  "error.load": "ファイルの読み込みに失敗しました",
  "error.stream": "PDF ストリーミングプレビューの読み込みに失敗しました",
  "error.beforeOperation": "操作前の検証に失敗しました",
  "error.unknown": "不明なエラー",
  "error.blobUnavailable": "現在の実行環境では Blob を利用できないため、ファイル内容を読み込めません。",
  "error.sourceUnsupported": "このファイル入力元には対応していません。",
  "error.fileReadArrayBuffer": "ファイルのバイナリ内容を読み込めませんでした。",
  "error.fileReadDataUrl": "ファイルの Data URL を読み込めませんでした。",
  "error.fileReadText": "ファイルのテキスト内容を読み込めませんでした。",
  "error.imageDataUrlRead": "画像データを読み込めませんでした。",
  "operation.download": "元ファイルをダウンロード",
  "operation.print": "レンダリング済みの全内容を印刷",
  "operation.exportHtml": "レンダリング結果を HTML として書き出す",
  "operation.zoomIn": "プレビューを拡大",
  "operation.zoomOut": "プレビューを縮小",
  "operation.zoomReset": "プレビュー倍率をリセット",
  "pdf.toolbar.toggleNavigation": "ナビゲーションペインを切り替え",
  "pdf.toolbar.previousPage": "前のページ",
  "pdf.toolbar.nextPage": "次のページ",
  "pdf.toolbar.fitWidth": "幅に合わせる",
  "pdf.toolbar.zoomOut": "縮小",
  "pdf.toolbar.zoomIn": "拡大",
  "pdf.toolbar.rotateLeft": "左に回転",
  "pdf.toolbar.rotateRight": "右に回転",
  "pdf.nav.typeLabel": "PDF ナビゲーションの種類",
  "pdf.nav.pagesTab": "ページ",
  "pdf.nav.outlineTab": "目次",
  "pdf.nav.pagesTitle": "ページナビゲーション",
  "pdf.nav.outlineTitle": "目次ナビゲーション",
  "pdf.nav.pageCount": "{count} ページ",
  "pdf.nav.itemCount": "{count} 件",
  "pdf.nav.pageLabel": "{page} ページ",
  "pdf.nav.outlineEmpty": "この PDF には利用可能な目次がありません",
  "pdf.nav.outlineFallbackTitle": "目次 {index}",
  "pdf.thumbnail.alt": "{page} ページのサムネイル",
  "pdf.state.loading": "PDF を読み込んでいます...",
  "pdf.error.browserWindow": "PDF プレビューにはブラウザーウィンドウが必要です",
  "pdf.error.missingSource": "PDF に読み取り可能なデータソースがありません",
  "pdf.error.loadFailed": "PDF の読み込みに失敗しました",
  "pdf.error.notLoaded": "PDF の読み込みがまだ完了していません。しばらくしてから再試行してください。",
  "pdf.error.unloaded": "PDF はアンロードされているため、印刷を続行できません",
  "pdf.error.canvasUnavailable": "このブラウザーでは PDF 印刷用キャンバスを作成できません",
  "pdf.export.pageTitle": "{title} - {page} ページ",
  "spreadsheet.loading.kicker": "Excel ワークブック",
  "spreadsheet.loading.title": "Excel ワークブックを解析しています",
  "spreadsheet.loading.hint": "ワークシート、スタイル、大規模データ用ビューポートを準備しています。",
  "spreadsheet.loading.streaming": "表示範囲のデータを順次読み込んでいます",
  "spreadsheet.tabs.ariaLabel": "ワークシート一覧",
  "spreadsheet.state.parsingWorkbook": "Excel ワークブックを解析しています。しばらくお待ちください...",
  "spreadsheet.state.preparingSheet": "ワークシート内容を準備しています...",
  "spreadsheet.state.preparingSheetNamed": "「{name}」を準備しています...",
  "spreadsheet.state.cachedRows": "{cached} / {total} 行をキャッシュ済み",
  "spreadsheet.state.rows": "全 {rows} 行をビューポートに応じて順次読み込みます",
  "spreadsheet.state.rowsAndColumns": "全 {rows} 行、{cols} 列をビューポートに応じて順次読み込みます",
  "spreadsheet.error.parseFailed": "Excel の解析に失敗しました",
  "spreadsheet.error.workerFailed": "Excel Worker の実行に失敗しました",
  "word.error.invalidDocx": "有効な DOCX/OOXML パッケージではありません。ダウンロードが不完全か、サーバーのエラー応答に置き換わった可能性があります。再アップロードするかファイル元を確認してください。",
  "word.error.missingOdfContent": "ODF ファイルに content.xml がありません。",
  "word.error.odfXmlParseFailed": "ODF XML の解析に失敗しました。",
  "word.title.rtf": "RTF 文書プレビュー",
  "word.title.openDocumentPresentation": "OpenDocument プレゼンテーションプレビュー",
  "word.title.openDocumentText": "OpenDocument 文書プレビュー",
  "word.page.fallback": "{page} ページ",
  "word.page.empty": "このページから抽出できるテキストはありません",
  "word.body": "本文",
  "word.body.empty": "読み取り可能なテキストを抽出できませんでした",
  "ofd.toolbar.pageNavigation": "OFD ページナビゲーション",
  "ofd.toolbar.documentPages": "OFD 文書ページ",
  "ofd.toolbar.previousPage": "前のページ",
  "ofd.toolbar.nextPage": "次のページ",
  "ofd.toolbar.pageStatus": "{total} ページ中 {current} ページ",
  "ofd.toolbar.noPages": "表示可能なページはありません",
  "ofd.state.loading": "OFD を解析しています...",
  "ofd.error.empty": "OFD ファイルにレンダリング可能な文書がありません",
  "ofd.error.parseFailed": "OFD ファイルの解析に失敗しました",
  "presentation.state.loading": "PPTX を解析しています...",
  "presentation.error.title": "PPTX プレビューに失敗しました",
  "presentation.error.parseFailed": "PPTX の解析に失敗しました",
  "presentation.ppt.state.loading": "PowerPoint 97–2003 を解析しています...",
  "presentation.ppt.error.title": "PPT プレビューに失敗しました",
  "presentation.ppt.error.parseFailed": "この PPT ファイルを解析できませんでした。",
  "presentation.ppt.error.assetHint": "@file-viewer/ppt モジュール、pptWasmUrl、application/wasm MIME タイプ、Web Crypto、CSP 設定を確認してください。",
  "archive.error.nestedUnsupported": ".{type} 形式はオンラインでプレビューできません。ダウンロードするか、対応形式へ変換してください。",
  "archive.loading.readingDirectory": "圧縮ファイルのディレクトリを読み込んでいます...",
  "archive.loading.readingDirectoryHint": "大きなファイルは Worker で解析し、メインスレッドのブロックを防ぎます。",
  "archive.search.placeholder": "圧縮ファイル内を絞り込み",
  "archive.sidebar.hide": "ファイル一覧を非表示",
  "archive.sidebar.show": "ファイル一覧を表示",
  "archive.preview.title": "圧縮ファイル内プレビュー",
  "archive.preview.chooseFile": "ファイルを選択してください",
  "archive.preview.downloadFile": "ファイルをダウンロード",
  "archive.error.title": "圧縮ファイルプレビューのお知らせ",
  "archive.stats.summary": "{count} ファイル · {size} · 直接プレビュー可能 {previewable} 件",
  "archive.warning.encrypted": "暗号化された内容を検出しました。正しいパスワードを入力するとプレビューできます。パスワードはこのセッション中だけ libarchive Worker に渡されます。",
  "archive.password.title": "圧縮ファイルのパスワードを入力",
  "archive.password.description": "この圧縮ファイルには暗号化された内容があります。ディレクトリの読み込みや内部ファイルのプレビューを続けるにはパスワードが必要です。",
  "archive.password.placeholder": "圧縮ファイルのパスワード",
  "archive.password.invalid": "パスワードが正しくないか、復号できませんでした。再入力してください。",
  "archive.password.required": "続行するにはパスワードを入力してください。",
  "archive.password.cancel": "キャンセル",
  "archive.password.confirm": "ロックを解除してプレビュー",
  "archive.error.passwordRequired": "パスワード入力がキャンセルされたため、暗号化された圧縮ファイルをプレビューできません。",
  "archive.error.encryptedRequiresWorker": "この圧縮ファイルのオンライン復号プレビューには libarchive Worker/WASM の配布が必要です。",
  "archive.empty.title": "左側のファイルを選択してプレビュー",
  "archive.empty.message": "最初にディレクトリのみを読み取ります。ファイル内容はクリック時にオンデマンドで展開し、容量が許す場合は IndexedDB にキャッシュします。",
  "archive.loading.initializingCandidate": "{label} を初期化しています...",
  "archive.loading.initializingCandidateHint": "サーバーで Worker/WASM が正しく配布されていない場合は、自動的に互換モードへ切り替えます。",
  "archive.error.candidateInitTimeout": "{label} の初期化がタイムアウトしました",
  "archive.error.encryptedCheckTimeout": "{label} の暗号化チェックがタイムアウトしました",
  "archive.loading.directoryReadyHint": "ディレクトリの読み込み後、内部ファイルをクリックするとオンデマンドで展開します。",
  "archive.error.candidateReadTimeout": "{label} のディレクトリ読み込みがタイムアウトしました",
  "archive.loading.workerFallback": "Worker を利用できないため、ZIP/TAR 互換モードへ切り替えています...",
  "archive.loading.workerFallbackHint": "互換モードは追加の静的 Worker を必要とせず、モバイル WebView や一時的なローカルサーバーにも適しています。",
  "archive.notice.workerFallback": "この環境では libarchive Worker を起動できなかったため、ZIP/TAR/GZIP 互換モードへ自動的に切り替えました。RAR、7z などでは vendor/libarchive/worker-bundle.js と libarchive.wasm の配布を推奨します。",
  "archive.error.tooLarge": "圧縮ファイルのサイズ {size} が安全上限 {limit} を超えています。ダウンロードしてローカルで展開してください。",
  "archive.loading.initializingWorker": "圧縮ファイル解析 Worker を初期化しています...",
  "archive.loading.initializingWorkerHint": "大きなファイルは Worker で解析し、メインスレッドのブロックを防ぎます。",
  "archive.error.workerInitFailed": "圧縮ファイル Worker の初期化に失敗しました",
  "archive.error.workerUnsupported": "このブラウザーは Web Worker に対応していません。",
  "archive.error.indexedDbUnavailable": "IndexedDB を利用できません",
  "archive.error.entryTooLarge": "圧縮ファイル内の {name} は {size} で、プレビュー上限 {limit} を超えています。",
  "archive.loading.extracting": "{name} をオンデマンドで展開しています...",
  "archive.loading.rendering": "{name} をレンダリングしています...",
  "archive.loading.exporting": "{name} を書き出しています...",
  "media.audio.title": "音声プレビュー",
  "media.audio.description": "ブラウザー標準プレーヤーで開きます。互換性は現在のブラウザーが対応する音声コーデックに依存します。",
  "media.audio.unsupported": "このブラウザーは音声再生に対応していません。",
  "media.video.title": "動画プレビュー",
  "media.video.unsupported": "このブラウザーはこの動画形式に対応していません。",
  "media.video.hlsHint": "HLS はセグメント読み込みに元の URL を優先します。ローカルの単一ファイルプレイリストを渡す場合は、セグメント URL にブラウザーからアクセスできることを確認してください。",
  "media.midi.title": "MIDI ファイル",
  "media.midi.loading": "MIDI トラックを解析しています...",
  "media.midi.trackHeader": "トラック",
  "media.midi.instrumentHeader": "楽器",
  "media.midi.channelHeader": "チャンネル",
  "media.midi.noteCountHeader": "ノート数",
  "media.midi.durationHeader": "長さ",
  "media.midi.durationStat": "長さ",
  "media.midi.trackStat": "トラック",
  "media.midi.noteStat": "ノート",
  "media.midi.parseFailed": "MIDI の解析に失敗しました",
  "email.mbox.subject": "{filename} · 1 通目",
  "email.mbox.summary": "MBOX から {count} 通のメールを検出しました。現在は 1 通目を表示しています。",
  "email.error.title": "メールプレビューのお知らせ",
  "email.meta.from": "差出人",
  "email.meta.to": "宛先",
  "email.meta.cc": "Cc",
  "email.meta.date": "日時",
  "email.tabs.text": "本文",
  "email.tabs.headers": "ヘッダー",
  "email.attachments.title": "添付ファイル",
  "email.attachments.empty": "添付ファイルはありません",
  "email.attachments.download": "添付ファイルをダウンロード",
  "email.attachments.opening": "添付ファイル {name} を開いています...",
  "email.attachments.nestedUnavailable": "この実行環境では添付ファイルの入れ子プレビューを利用できません。{name} をダウンロードして確認してください。",
  "email.loading.parsing": "メールを解析しています...",
  "data.font.sample": "Flyfish Viewer 日本語プレビュー AaBbCc 1234567890",
  "data.error.fontFaceUnsupported": "このブラウザーは FontFace API に対応していません",
  "data.title.font": "フォントファイルプレビュー",
  "data.title.sqlite": "SQLite データベースプレビュー",
  "data.title.parquet": "Parquet 列指向データプレビュー",
  "data.title.avro": "Avro オブジェクトコンテナプレビュー",
  "data.title.wasm": "WebAssembly モジュールプレビュー",
  "data.title.eps": "EPS ベクターファイル概要",
  "data.title.ai": "Illustrator ファイル概要",
  "data.title.webarchive": "WebArchive 概要プレビュー",
  "data.title.summary": "データ資産概要",
  "data.label.format": "形式",
  "data.label.size": "サイズ",
  "data.label.rendering": "レンダラー",
  "data.label.objects": "オブジェクト",
  "data.label.sampleTable": "サンプルテーブル",
  "data.label.rows": "行",
  "data.label.columns": "列",
  "data.label.sampleRows": "サンプル行",
  "data.label.imports": "インポート",
  "data.label.exports": "エクスポート",
  "data.label.magic": "マジック",
  "data.label.note": "注記",
  "data.label.container": "コンテナ",
  "data.value.schemaRead": "読み込み済み",
  "data.value.schemaUnread": "未読み込み",
  "data.note.aiSummary": "PDF 互換でない AI は安全な概要として表示します。",
  "data.note.postscriptSummary": "PostScript の概要プレビュー",
  "data.note.webarchive": "読み取り可能な断片を安全に抽出します。Web スクリプトは実行しません。",
  "data.image.alt": "資産プレビュー",
  "psd.title": "PSD レイヤープレビュー",
  "psd.action.fit": "全体表示",
  "psd.action.showAll": "すべて表示",
  "psd.action.hideAll": "すべて非表示",
  "psd.layers.title": "レイヤー",
  "psd.layers.redrawable": "再描画可能 {count} 件",
  "psd.layers.empty": "表示可能なレイヤーがありません。合成画像を表示します。",
  "psd.layers.hidden": "非表示",
  "drawing.error.viewerLoadFailed": "diagrams.net viewer の読み込みに失敗しました",
  "drawing.error.excalidrawEmpty": "この Excalidraw ファイルにはプレビュー可能な要素がありません",
  "drawing.error.excalidrawTimeout": "Excalidraw の SVG 書き出しがタイムアウトしたため、rough.js レンダラーへ切り替えます。",
  "drawing.error.drawioParseFailed": "Draw.io XML の解析に失敗しました：{message}",
  "drawing.error.drawioNoModel": "この Draw.io ファイルには直接レンダリング可能な mxGraphModel がありません。",
  "drawing.error.drawioNoElements": "この Draw.io ファイルにはプレビュー可能な要素がありません。",
  "drawing.error.viewerInitFailed": "diagrams.net viewer が正しく初期化されませんでした",
  "drawing.error.drawioTimeout": "diagrams.net 公式 Viewer がタイムアウトしたため、ローカル SVG プレビューへ切り替えます。",
  "drawing.error.svgParseFailed": "SVG の解析に失敗しました",
  "drawing.error.plantumlRenderFailed": "PlantUML SVG のレンダリングに失敗しました：{status}",
  "drawing.title.excalidraw": "Excalidraw SVG プレビュー",
  "drawing.title.mermaid": "Mermaid SVG プレビュー",
  "drawing.title.plantuml": "PlantUML SVG プレビュー",
  "drawing.title.drawio": "Draw.io オフライン SVG プレビュー",
  "drawing.toolbar.zoomOut": "縮小",
  "drawing.toolbar.zoomIn": "拡大",
  "drawing.toolbar.fit": "全体表示",
  "drawing.toolbar.fitWidth": "幅に合わせる",
  "drawing.state.loading": "図面プレビューを読み込んでいます...",
  "text.code.loadingHighlight": "シンタックスハイライトを読み込んでいます...",
  "text.code.indexingLargeFile": "大きなファイルを索引化しています {progress}%",
  "text.code.virtualized": "大きなファイル · 仮想スクロール · ハイライト無効",
  "text.code.firstSegment": "先頭セグメント",
  "text.code.previousSegment": "前のセグメント",
  "text.code.nextSegment": "次のセグメント",
  "text.code.lastSegment": "末尾セグメント",
  "ebook.toc": "目次",
  "ebook.reading": "読書中",
  "ebook.itemCount": "{count} 件",
  "epub.title": "EPUB 電子書籍",
  "epub.previousPage": "前へ",
  "epub.nextPage": "次へ",
  "epub.loading": "EPUB を解析しています...",
  "epub.chapterFallback": "第 {index} 章",
  "epub.renderIncomplete": "EPUB 本文のレンダリングが完了しませんでした。更新して再試行してください。",
  "umd.title": "UMD 電子書籍",
  "umd.previousChapter": "前の章",
  "umd.nextChapter": "次の章",
  "umd.loading": "UMD を解析しています...",
  "umd.emptyContent": "読み取り可能な本文を解析できませんでした",
  "umd.chapterFallback": "第 {index} 章",
  "umd.galleryFallback": "ギャラリー {index}",
  "umd.warningBodyTooShort": "UMD 本文が宣言された長さより短く、不完全な可能性があります",
  "umd.error.unexpectedEnd": "UMD 構造が不完全で、予期せず終了しました",
  "umd.error.invalidFile": "有効な UMD 電子書籍ファイルではありません",
  "typst.summaryRenderer": "Typst WASM レンダラー",
  "typst.pageSummary.empty": "0 ページ",
  "typst.pageSummary.ready": "{count} ページ / {width} x {height} pt",
  "typst.status.compiling": "コンパイル中",
  "typst.status.failed": "コンパイル失敗",
  "typst.status.rendered": "レンダリング済み",
  "typst.loading.title": "Typst を解析しています",
  "typst.loading.hint": "コンパイラーを読み込み、ページプレビューを生成しています...",
  "typst.error.title": "Typst のレンダリングに失敗しました",
  "typst.error.timeout": "Typst WASM / フォントの読み込みまたはコンパイルが {seconds} 秒を超えました",
  "typst.error.timeoutHint": "Typst compiler WASM、renderer WASM、フォントディレクトリのダウンロード速度とキャッシュ戦略を確認してください。低速回線やリージョンをまたぐ配信では options.typst.renderTimeoutMs を増やしてください。",
  "typst.error.assetHint": "Typst にはローカルの compiler / renderer WASM とフォントディレクトリが必要です。file-viewer-copy-assets を実行するか、options.typst.compilerWasmUrl / options.typst.rendererWasmUrl / options.typst.fontAssetsUrl を設定し、サーバーが WASM を application/wasm で返すことを確認してください。",
  "typst.error.svgParseFailed": "Typst SVG の解析に失敗しました",
  "typst.error.wasmLoadFailed": "Typst WASM の読み込みに失敗しました",
  "xmind.toolbar.zoomOut": "縮小",
  "xmind.toolbar.zoomIn": "拡大",
  "xmind.toolbar.fit": "全体表示",
  "xmind.toolbar.fitTitle": "キャンバス全体を表示",
  "xmind.state.loading": "XMind マインドマップを解析しています...",
  "xmind.stats.nodes": "ノード",
  "xmind.stats.depth": "深さ",
  "xmind.stats.theme": "テーマ",
  "xmind.stats.template": "テンプレート",
  "xmind.badge.paused": "一時停止",
  "xmind.badge.collapsed": "折りたたみ",
  "xmind.badge.floating": "フローティング",
  "xmind.badge.summary": "サマリー",
  "xmind.badge.callout": "吹き出し",
  "xmind.imageResource": "画像リソース：{name}",
  "xmind.error.unrecognized": "XMind ファイルを認識できません。ZIP パッケージ内に content.json または content.xml がありません。",
  "xmind.error.noCanvas": "この XMind ファイルにはプレビュー可能なキャンバスがありません",
  "cad.toolbar.fit": "全体表示",
  "cad.toolbar.zoomOut": "縮小",
  "cad.toolbar.zoomIn": "拡大",
  "cad.layers.title": "レイヤー",
  "cad.layers.count": "{count} 件",
  "cad.layers.merged": "{name}（同名レイヤー {count} 件を統合）",
  "cad.inspector.title": "構造",
  "cad.inspector.entities": "エンティティ",
  "cad.inspector.blocks": "ブロック",
  "cad.inspector.pages": "ページ",
  "cad.inspector.drawn": "描画済み",
  "cad.state.loadingViewer": "CAD ビューアーを読み込んでいます...",
  "cad.state.parsing": "CAD を解析しています...",
  "cad.error.parseFailed": "CAD ファイルの解析に失敗しました",
  "image.alt": "画像",
  "image.toolbar.rotation": "画像の回転",
  "image.toolbar.rotateLeft": "画像を左に回転",
  "image.toolbar.rotateRight": "画像を右に回転",
  "image.lightbox.alt": "画像プレビュー",
  "image.lightbox.close": "画像プレビューを閉じる",
  "gitBundle.error.invalid": "有効な Git bundle ファイルではありません。",
  "gitBundle.error.missingPack": "Git bundle ヘッダーの後に PACK データがありません。",
  "gitBundle.notice.delta": "この bundle には delta 圧縮オブジェクトが含まれています。ビューアーは一般的な OFS_DELTA / REF_DELTA をブラウザー内で解決します。ファイルが不足する場合は、bundle が非常に大きい、オブジェクト数が多い、または外部 prerequisite が必要な可能性があります。",
  "gitBundle.title.history": "履歴",
  "gitBundle.title.fileTree": "ファイルツリー",
  "gitBundle.file.choose": "確認するファイルを選択",
  "gitBundle.file.noTree": "この bundle の tree/blob オブジェクトは delta 圧縮されている可能性があり、展開可能なファイルを解析できませんでした。",
  "gitBundle.file.none": "解析済みファイルはありません",
  "gitBundle.history.empty": "commit オブジェクトを解析できませんでした。refs と pack の概要のみ表示します。",
  "gitBundle.toolbar.summary": "{commits} コミット · {files} ファイル",
  "gitBundle.meta.bundle": "Bundle",
  "gitBundle.meta.refs": "Refs",
  "gitBundle.meta.commits": "コミット",
  "gitBundle.meta.objects": "オブジェクト",
  "gitBundle.meta.deltas": "Delta",
  "gitBundle.meta.objectFormat": "オブジェクト形式",
  "gitBundle.meta.objectTypes": "オブジェクト種類",
  "geo.error.unrecognized": "GeoJSON データを認識できません",
  "geo.error.xmlParseFailed": "XML の解析に失敗しました",
  "geo.error.unsupported": ".{type} 地理空間形式には対応していません",
  "geo.title": "地理空間データプレビュー",
  "geo.featureCount": "フィーチャー数",
  "geo.bounds": "範囲",
  "geo.geometryTypes": "ジオメトリ種類",
  "geo.aria": "地理空間 SVG プレビュー",
  "geo.loading": "地理空間データを解析しています...",
  "geo.projection": "座標系",
  "geo.engine": "レンダラー",
  "geo.basemap": "ベースマップ",
  "geo.basemap.offline": "オフライン空ベースマップ",
  "geo.basemap.custom": "カスタムタイル",
  "geo.engine.maplibre": "MapLibre ベクターマップ",
  "geo.engine.svg": "SVG フォールバック",
  "geo.error.projection": "地理座標の変換に失敗しました：{reason}",
  "geo.action.fit": "範囲に合わせる",
  "model.toolbar.fit": "全体表示",
  "model.toolbar.rotate": "回転",
  "model.toolbar.wireframe": "ワイヤーフレーム",
  "model.toolbar.grid": "グリッド",
  "model.toolbar.axes": "軸",
  "model.state.loadingSummary": "モデルを読み込んでいます",
  "model.state.loading": "3D モデルを解析しています...",
  "model.state.loaded": "モデルを読み込みました",
  "model.state.parseFailed": "モデルの解析に失敗しました",
  "model.summary.meshes": "{count} メッシュ",
  "model.summary.points": "{count} 点群",
  "model.error.daeEmpty": "DAE モデルに有効なシーンがありません",
  "model.error.unsupported": ".{type} モデル形式にはまだ対応していません",
  "model.error.parseFailed": "{type} モデルの解析に失敗しました",
  "model.notice.signature": "ファイルシグネチャを検出しました：{signature}。",
  "loading.generic.label": "ファイル内容",
  "loading.generic.hint": "内容構造とプレビューを準備しています。",
  "loading.word.label": "Word 文書",
  "loading.word.hint": "文書構造、テキストスタイル、レイアウトを準備しています。",
  "loading.wordWorker.hint": "Worker で文書構造、テキストスタイル、レイアウトを準備しています。",
  "loading.sheet.label": "Excel ワークブック",
  "loading.sheet.hint": "ワークシート、スタイル、ビューポートデータを準備しています。",
  "loading.csv.label": "表形式データ",
  "loading.csv.hint": "行、列、基本スタイルを準備しています。",
  "loading.presentation.label": "PowerPoint プレゼンテーション",
  "loading.presentation.hint": "スライドレイアウトとメディア内容を構築しています。",
  "loading.pdf.label": "PDF 文書",
  "loading.pdf.hint": "ページ画像、テキストレイヤー、ズーム表示を読み込んでいます。",
  "loading.ofd.label": "OFD レイアウト文書",
  "loading.ofd.hint": "OFD ページとレイアウトオブジェクトを解析しています。",
  "loading.archive.label": "圧縮ファイル",
  "loading.archive.hint": "Worker を起動し、圧縮ファイル内の項目を読み込んでいます。",
  "loading.email.label": "メールファイル",
  "loading.email.hint": "メールヘッダー、本文、添付ファイルを解析しています。",
  "loading.msg.hint": "Outlook メッセージと添付ファイルを解析しています。",
  "loading.eda.label": "EDA ファイル",
  "loading.eda.hint": "EDA コンテナ構造とプロパティを読み込んでいます。",
  "loading.cad.label": "CAD 図面",
  "loading.cad.hint": "CAD レイヤー、ジオメトリ、キャンバス表示を準備しています。",
  "loading.dwg.hint": "Worker で DWG ジオメトリと LibreDWG WASM を読み込んでいます。",
  "loading.dwf.hint": "ネイティブ DWF レンダラーと W2D/W3D グラフィックスを読み込んでいます。",
  "loading.dwfx.hint": "ネイティブ DWFx/XPS レンダラーとページグラフィックスを読み込んでいます。",
  "loading.xps.hint": "ネイティブ XPS レンダラーと埋め込みフォントを読み込んでいます。",
  "loading.drawio.label": "draw.io ダイアグラム",
  "loading.drawio.hint": "図形、コネクター、SVG プレビューを解析しています。",
  "loading.excalidraw.label": "Excalidraw シーン",
  "loading.excalidraw.hint": "手描き要素を解析し、安全な SVG を生成しています。",
  "loading.epub.label": "EPUB 電子書籍",
  "loading.epub.hint": "目次、章リソース、読書ページを解析しています。",
  "loading.umd.label": "UMD 電子書籍",
  "loading.umd.hint": "モバイル電子書籍のメタデータ、目次、圧縮された章を解析しています。",
  "loading.image.label": "画像ファイル",
  "loading.image.hint": "ピクセルをデコードしてプレビューを生成しています。",
  "loading.video.label": "動画ファイル",
  "loading.video.hint": "メディアリソースとプレーヤーを準備しています。",
  "loading.audio.label": "音声ファイル",
  "loading.audio.hint": "音声リソースと再生コントロールを準備しています。"
}, Cr = "zh-CN", bt = "en-US", ln = {
  "toolbar.zoomGroup": "缩放控制",
  "toolbar.zoomOut": "缩小预览",
  "toolbar.zoomIn": "放大预览",
  "toolbar.zoomReset": "还原比例",
  "toolbar.download": "下载",
  "toolbar.downloadTitle": "下载原始文件",
  "toolbar.print": "打印",
  "toolbar.printTitle": "打印完整渲染内容",
  "toolbar.printDirect": "直接打印",
  "toolbar.printMask": "遮罩/盖章打印",
  "toolbar.printMaskTitle": "遮盖敏感区域或上传印章后再打印",
  "toolbar.printMaskAdd": "添加掩膜",
  "toolbar.printMaskClear": "清空",
  "toolbar.printMaskCancel": "取消",
  "toolbar.printMaskConfirm": "确认打印",
  "toolbar.printMaskHint": "绘制遮盖块，或上传印章后拖动和缩放",
  "toolbar.printStampUpload": "上传印章",
  "toolbar.printStampRemove": "删除印章",
  "toolbar.printStampResize": "缩放印章",
  "toolbar.exportHtml": "HTML",
  "toolbar.exportHtmlTitle": "导出当前渲染后的 HTML",
  "toolbar.search": "搜索",
  "toolbar.searchPlaceholder": "搜索文档",
  "toolbar.searchPrevious": "上一个匹配",
  "toolbar.searchNext": "下一个匹配",
  "toolbar.searchClear": "清除搜索",
  "toolbar.theme": "主题",
  "toolbar.themeToLight": "切换为浅色模式",
  "toolbar.themeToDark": "切换为深色模式",
  "state.ready.title": "预览完成",
  "state.ready.message": "文件内容已完成渲染。",
  "state.empty.title": "暂无文件",
  "state.empty.message": "请选择文件或提供可访问的文件地址后开始预览。",
  "state.unsupported.install.title": "需要装配预览能力",
  "state.unsupported.install.message": "{extension} 格式已在支持矩阵中，但当前项目尚未装配 {rendererLabel} renderer。",
  "state.unsupported.install.description": "推荐安装 {presetPackage}，通过 options.preset / options.renderers 注入对应能力{rendererTip}；Vite 项目也可以使用 @file-viewer/vite-plugin 自动发现已安装 preset。",
  "state.unsupported.title": "暂不支持在线预览",
  "state.unsupported.message": "不支持{extension}格式的在线预览，请下载后预览或转换为支持的格式。",
  "state.unsupported.description": "支持 Office、PDF、OFD、Typst、压缩包、邮件、OLB/DRA、CAD、地理数据、3D 模型、Excalidraw、draw.io、EPUB、UMD、Markdown、代码/文本、图片、音视频、字体和数据资产的在线预览",
  "state.error.title": "预览失败",
  "preview.downloading": "正在下载文件资源...",
  "preview.streamingPdf": "正在建立 PDF 流式预览...",
  "preview.reading": "正在解析文件内容...",
  "error.download": "下载失败",
  "error.print": "打印失败",
  "error.exportHtml": "导出 HTML 失败",
  "error.noDownloadSource": "当前没有可下载的源文件",
  "error.noExportContent": "当前没有可导出的预览内容",
  "error.printUnavailable": "当前文件类型不支持完整打印，请下载原文件后在本地应用中打印",
  "error.printWindowBlocked": "浏览器拦截了打印窗口",
  "error.remoteDownload": "文件下载失败",
  "error.localRead": "读取文件异常",
  "error.load": "加载文件异常",
  "error.stream": "加载 PDF 流式预览异常",
  "error.beforeOperation": "操作前置校验失败",
  "error.unknown": "未知错误",
  "error.blobUnavailable": "当前运行环境不支持 Blob，无法读取文件内容。",
  "error.sourceUnsupported": "不支持当前文件来源输入。",
  "error.fileReadArrayBuffer": "读取文件二进制内容失败。",
  "error.fileReadDataUrl": "读取文件 Data URL 失败。",
  "error.fileReadText": "读取文件文本内容失败。",
  "error.imageDataUrlRead": "读取图片数据失败。",
  "operation.download": "下载原始文件",
  "operation.print": "打印完整渲染内容",
  "operation.exportHtml": "导出渲染 HTML",
  "operation.zoomIn": "放大预览",
  "operation.zoomOut": "缩小预览",
  "operation.zoomReset": "还原预览比例",
  "pdf.toolbar.toggleNavigation": "切换导航窗格",
  "pdf.toolbar.previousPage": "上一页",
  "pdf.toolbar.nextPage": "下一页",
  "pdf.toolbar.fitWidth": "适合宽度",
  "pdf.toolbar.zoomOut": "缩小",
  "pdf.toolbar.zoomIn": "放大",
  "pdf.toolbar.rotateLeft": "向左旋转",
  "pdf.toolbar.rotateRight": "向右旋转",
  "pdf.nav.typeLabel": "PDF 导航类型",
  "pdf.nav.pagesTab": "页面",
  "pdf.nav.outlineTab": "目录",
  "pdf.nav.pagesTitle": "页面导航",
  "pdf.nav.outlineTitle": "目录导航",
  "pdf.nav.pageCount": "{count} 页",
  "pdf.nav.itemCount": "{count} 项",
  "pdf.nav.pageLabel": "第 {page} 页",
  "pdf.nav.outlineEmpty": "当前 PDF 没有可用目录",
  "pdf.nav.outlineFallbackTitle": "目录 {index}",
  "pdf.thumbnail.alt": "第 {page} 页缩略图",
  "pdf.state.loading": "正在加载 PDF...",
  "pdf.error.browserWindow": "PDF 预览需要浏览器窗口",
  "pdf.error.missingSource": "PDF 缺少可读取的数据源",
  "pdf.error.loadFailed": "PDF 加载失败",
  "pdf.error.notLoaded": "PDF 尚未加载完成，请稍后再试",
  "pdf.error.unloaded": "PDF 已卸载，无法继续打印",
  "pdf.error.canvasUnavailable": "当前浏览器无法创建 PDF 打印画布",
  "pdf.export.pageTitle": "{title} - 第 {page} 页",
  "spreadsheet.loading.kicker": "Excel 表格",
  "spreadsheet.loading.title": "正在解析 Excel 工作簿",
  "spreadsheet.loading.hint": "正在准备工作表、样式和大数据视口，请稍候。",
  "spreadsheet.loading.streaming": "正在平滑补充可视区数据",
  "spreadsheet.tabs.ariaLabel": "工作表列表",
  "spreadsheet.state.parsingWorkbook": "正在解析 Excel 工作簿，请耐心等待...",
  "spreadsheet.state.preparingSheet": "正在准备工作表内容...",
  "spreadsheet.state.preparingSheetNamed": "正在准备「{name}」...",
  "spreadsheet.state.cachedRows": "已缓存 {cached} / {total} 行",
  "spreadsheet.state.rows": "共 {rows} 行，按视口预取平滑加载",
  "spreadsheet.state.rowsAndColumns": "共 {rows} 行，{cols} 列，按视口预取平滑加载",
  "spreadsheet.error.parseFailed": "Excel 解析失败",
  "spreadsheet.error.workerFailed": "Excel Worker 运行失败",
  "word.error.invalidDocx": "文件不是有效的 DOCX/OOXML 压缩包，可能下载不完整或被服务端错误内容替换，请重新上传或检查文件源。",
  "word.error.missingOdfContent": "ODF 文件缺少 content.xml。",
  "word.error.odfXmlParseFailed": "ODF XML 解析失败。",
  "word.title.rtf": "RTF 文档预览",
  "word.title.openDocumentPresentation": "OpenDocument 演示文稿预览",
  "word.title.openDocumentText": "OpenDocument 文档预览",
  "word.page.fallback": "第 {page} 页",
  "word.page.empty": "该页没有可提取文本",
  "word.body": "正文",
  "word.body.empty": "没有提取到可读文本",
  "ofd.toolbar.pageNavigation": "OFD 分页导航",
  "ofd.toolbar.documentPages": "OFD 文档页面",
  "ofd.toolbar.previousPage": "上一页",
  "ofd.toolbar.nextPage": "下一页",
  "ofd.toolbar.pageStatus": "第 {current} 页，共 {total} 页",
  "ofd.toolbar.noPages": "暂无可用页面",
  "ofd.state.loading": "正在解析 OFD...",
  "ofd.error.empty": "OFD 文件中没有可渲染的文档",
  "ofd.error.parseFailed": "OFD 文件解析失败",
  "presentation.state.loading": "正在解析 PPTX...",
  "presentation.error.title": "PPTX 预览失败",
  "presentation.error.parseFailed": "PPTX 解析失败",
  "presentation.ppt.state.loading": "正在解析 PowerPoint 97–2003...",
  "presentation.ppt.error.title": "PPT 预览失败",
  "presentation.ppt.error.parseFailed": "无法解析这个 PPT 文件。",
  "presentation.ppt.error.assetHint": "请检查 @file-viewer/ppt 模块、pptWasmUrl、application/wasm MIME 类型、Web Crypto 和 CSP 配置。",
  "archive.error.nestedUnsupported": "不支持 .{type} 格式的在线预览，请下载后预览或转换为支持的格式",
  "archive.loading.readingDirectory": "正在读取压缩包目录...",
  "archive.loading.readingDirectoryHint": "大文件会在 Worker 中解析，避免阻塞主线程。",
  "archive.search.placeholder": "筛选压缩包内文件",
  "archive.sidebar.hide": "隐藏压缩包文件列表",
  "archive.sidebar.show": "显示压缩包文件列表",
  "archive.preview.title": "压缩包内预览",
  "archive.preview.chooseFile": "请选择一个文件",
  "archive.preview.downloadFile": "下载文件",
  "archive.error.title": "压缩包预览提示",
  "archive.stats.summary": "{count} 个文件 · {size} · {previewable} 个可直接预览",
  "archive.warning.encrypted": "检测到加密内容，输入正确密码后即可预览；密码仅在当前会话中传递给 libarchive Worker。",
  "archive.password.title": "请输入压缩包密码",
  "archive.password.description": "该压缩包包含加密内容，需要密码才能继续读取目录或预览内部文件。",
  "archive.password.placeholder": "压缩包密码",
  "archive.password.invalid": "密码不正确或无法解密，请重新输入。",
  "archive.password.required": "请输入密码后继续。",
  "archive.password.cancel": "取消",
  "archive.password.confirm": "解锁预览",
  "archive.error.passwordRequired": "已取消输入密码，无法预览加密压缩包。",
  "archive.error.encryptedRequiresWorker": "该压缩包包含加密内容，需要发布 libarchive Worker/WASM 后才能在线解密预览。",
  "archive.empty.title": "选择左侧文件即可预览",
  "archive.empty.message": "压缩包只读取目录；文件内容会在点击后按需解压，并在体积允许时缓存到 IndexedDB。",
  "archive.loading.initializingCandidate": "正在初始化 {label}...",
  "archive.loading.initializingCandidateHint": "如果当前服务器没有正确发布 Worker/WASM，会自动切换兼容模式。",
  "archive.error.candidateInitTimeout": "{label} 初始化超时",
  "archive.error.encryptedCheckTimeout": "{label} 加密检测超时",
  "archive.loading.directoryReadyHint": "目录读取完成后，点击内部文件才会按需解压。",
  "archive.error.candidateReadTimeout": "{label} 读取目录超时",
  "archive.loading.workerFallback": "Worker 不可用，正在切换 ZIP/TAR 兼容模式...",
  "archive.loading.workerFallbackHint": "兼容模式无需额外静态 Worker，适合手机 WebView 或本地临时服务器。",
  "archive.notice.workerFallback": "当前环境的 libarchive Worker 未能启动，已自动切换到 ZIP/TAR/GZIP 兼容模式。RAR、7z 等格式仍建议发布 vendor/libarchive/worker-bundle.js 与 libarchive.wasm。",
  "archive.error.tooLarge": "压缩包体积 {size} 超过安全上限 {limit}，请下载后在本地解压。",
  "archive.loading.initializingWorker": "正在初始化压缩包解析 Worker...",
  "archive.loading.initializingWorkerHint": "大文件会在 Worker 中解析，避免阻塞主线程。",
  "archive.error.workerInitFailed": "压缩包 Worker 初始化失败",
  "archive.error.workerUnsupported": "当前浏览器不支持 Web Worker。",
  "archive.error.indexedDbUnavailable": "IndexedDB 不可用",
  "archive.error.entryTooLarge": "压缩包内文件 {name} 体积 {size} 超过预览上限 {limit}。",
  "archive.loading.extracting": "正在按需解压 {name}...",
  "archive.loading.rendering": "正在渲染 {name}...",
  "archive.loading.exporting": "正在导出 {name}...",
  "media.audio.title": "音频预览",
  "media.audio.description": "使用浏览器原生播放器打开，兼容性取决于当前浏览器支持的音频编码。",
  "media.audio.unsupported": "当前浏览器不支持音频播放。",
  "media.video.title": "视频预览",
  "media.video.unsupported": "当前浏览器不支持该视频格式。",
  "media.video.hlsHint": "HLS 会优先使用原始 URL 加载分片；如果传入的是本地单文件清单，请确保分片地址可被浏览器访问。",
  "media.midi.title": "MIDI 文件",
  "media.midi.loading": "正在解析 MIDI 轨道...",
  "media.midi.trackHeader": "轨道",
  "media.midi.instrumentHeader": "乐器",
  "media.midi.channelHeader": "通道",
  "media.midi.noteCountHeader": "音符数",
  "media.midi.durationHeader": "时长",
  "media.midi.durationStat": "时长",
  "media.midi.trackStat": "轨道",
  "media.midi.noteStat": "音符",
  "media.midi.parseFailed": "MIDI 解析失败",
  "email.mbox.subject": "{filename} · 第 1 封",
  "email.mbox.summary": "MBOX 共识别 {count} 封邮件，当前展示第 1 封。",
  "email.error.title": "邮件预览提示",
  "email.meta.from": "发件人",
  "email.meta.to": "收件人",
  "email.meta.cc": "抄送",
  "email.meta.date": "时间",
  "email.tabs.text": "正文",
  "email.tabs.headers": "头信息",
  "email.attachments.title": "附件",
  "email.attachments.empty": "暂无附件",
  "email.attachments.download": "下载附件",
  "email.attachments.opening": "正在打开附件 {name}...",
  "email.attachments.nestedUnavailable": "当前运行环境未提供附件嵌套预览入口，请下载 {name} 后查看。",
  "email.loading.parsing": "正在解析邮件...",
  "data.font.sample": "Flyfish Viewer 轻量预览 AaBbCc 1234567890",
  "data.error.fontFaceUnsupported": "当前浏览器不支持 FontFace API",
  "data.title.font": "字体文件预览",
  "data.title.sqlite": "SQLite 数据库预览",
  "data.title.parquet": "Parquet 列式数据预览",
  "data.title.avro": "Avro 对象容器预览",
  "data.title.wasm": "WebAssembly 模块预览",
  "data.title.eps": "EPS 矢量文件摘要",
  "data.title.ai": "Illustrator 文件摘要",
  "data.title.webarchive": "WebArchive 摘要预览",
  "data.title.summary": "数据资产摘要",
  "data.label.format": "格式",
  "data.label.size": "大小",
  "data.label.rendering": "渲染方式",
  "data.label.objects": "对象数",
  "data.label.sampleTable": "示例表",
  "data.label.rows": "行数",
  "data.label.columns": "列数",
  "data.label.sampleRows": "示例行",
  "data.label.imports": "导入",
  "data.label.exports": "导出",
  "data.label.magic": "Magic",
  "data.label.note": "说明",
  "data.label.container": "容器",
  "data.value.schemaRead": "已读取",
  "data.value.schemaUnread": "未读取",
  "data.note.aiSummary": "非 PDF-compatible AI 按摘要展示",
  "data.note.postscriptSummary": "PostScript 摘要展示",
  "data.note.webarchive": "安全提取可读片段，不执行网页脚本",
  "data.image.alt": "资产预览",
  "psd.title": "PSD 图层预览",
  "psd.action.fit": "适合",
  "psd.action.showAll": "全显",
  "psd.action.hideAll": "全隐",
  "psd.layers.title": "图层",
  "psd.layers.redrawable": "{count} 可重绘",
  "psd.layers.empty": "未发现可展示图层，使用合成图预览。",
  "psd.layers.hidden": "隐藏",
  "drawing.error.viewerLoadFailed": "diagrams.net viewer 加载失败",
  "drawing.error.excalidrawEmpty": "Excalidraw 文件中没有可预览图元",
  "drawing.error.excalidrawTimeout": "Excalidraw SVG 导出超时，自动切换 rough.js 兼容渲染",
  "drawing.error.drawioParseFailed": "Draw.io XML 解析失败：{message}",
  "drawing.error.drawioNoModel": "当前 Draw.io 文件没有可直接渲染的 mxGraphModel。",
  "drawing.error.drawioNoElements": "当前 Draw.io 文件没有可预览图元。",
  "drawing.error.viewerInitFailed": "diagrams.net viewer 未正确初始化",
  "drawing.error.drawioTimeout": "diagrams.net 官方 Viewer 加载超时，自动切换本地 SVG 预览",
  "drawing.error.svgParseFailed": "SVG 解析失败",
  "drawing.error.plantumlRenderFailed": "PlantUML SVG 渲染失败：{status}",
  "drawing.title.excalidraw": "Excalidraw SVG 预览",
  "drawing.title.mermaid": "Mermaid SVG 预览",
  "drawing.title.plantuml": "PlantUML SVG 预览",
  "drawing.title.drawio": "Draw.io 离线 SVG 预览",
  "drawing.toolbar.zoomOut": "缩小",
  "drawing.toolbar.zoomIn": "放大",
  "drawing.toolbar.fit": "适合",
  "drawing.toolbar.fitWidth": "适合宽度",
  "drawing.state.loading": "正在加载绘图预览...",
  "text.code.loadingHighlight": "正在加载高亮...",
  "text.code.indexingLargeFile": "正在建立大文件索引 {progress}%",
  "text.code.virtualized": "大文件 · 虚拟滚动 · 已关闭高亮",
  "text.code.firstSegment": "首段",
  "text.code.previousSegment": "上一段",
  "text.code.nextSegment": "下一段",
  "text.code.lastSegment": "末段",
  "ebook.toc": "目录",
  "ebook.reading": "阅读中",
  "ebook.itemCount": "{count} 项",
  "epub.title": "EPUB 电子书",
  "epub.previousPage": "上一页",
  "epub.nextPage": "下一页",
  "epub.loading": "正在解析 EPUB...",
  "epub.chapterFallback": "章节 {index}",
  "epub.renderIncomplete": "EPUB 正文渲染未完成，请刷新后重试",
  "umd.title": "UMD 电子书",
  "umd.previousChapter": "上一章",
  "umd.nextChapter": "下一章",
  "umd.loading": "正在解析 UMD...",
  "umd.emptyContent": "未解析到正文内容",
  "umd.chapterFallback": "章节 {index}",
  "umd.galleryFallback": "图集 {index}",
  "umd.warningBodyTooShort": "UMD 正文长度小于声明长度，文件可能不完整",
  "umd.error.unexpectedEnd": "UMD 文件结构不完整，读取时遇到意外结尾",
  "umd.error.invalidFile": "不是有效的 UMD 电子书文件",
  "typst.summaryRenderer": "Typst WASM 渲染器",
  "typst.pageSummary.empty": "0 页",
  "typst.pageSummary.ready": "{count} 页 / {width} x {height} pt",
  "typst.status.compiling": "正在编译",
  "typst.status.failed": "编译失败",
  "typst.status.rendered": "已渲染",
  "typst.loading.title": "正在解析 Typst",
  "typst.loading.hint": "加载编译器并生成页面预览...",
  "typst.error.title": "Typst 渲染失败",
  "typst.error.timeout": "Typst WASM / 字体加载或编译超过 {seconds} 秒",
  "typst.error.timeoutHint": "请检查 Typst compiler WASM、renderer WASM、字体目录的下载速度和缓存策略；弱网或跨境部署可通过 options.typst.renderTimeoutMs 调大浏览器端加载/编译超时。",
  "typst.error.assetHint": "Typst 需要本地 compiler / renderer WASM 和字体目录。请运行 file-viewer-copy-assets，或配置 options.typst.compilerWasmUrl / options.typst.rendererWasmUrl / options.typst.fontAssetsUrl，并确认服务器以 application/wasm 返回 WASM。",
  "typst.error.svgParseFailed": "Typst SVG 解析失败",
  "typst.error.wasmLoadFailed": "Typst WASM 加载失败",
  "xmind.toolbar.zoomOut": "缩小",
  "xmind.toolbar.zoomIn": "放大",
  "xmind.toolbar.fit": "适合",
  "xmind.toolbar.fitTitle": "适配画布",
  "xmind.state.loading": "正在解析 XMind 脑图...",
  "xmind.stats.nodes": "节点",
  "xmind.stats.depth": "层级",
  "xmind.stats.theme": "主题",
  "xmind.stats.template": "模板",
  "xmind.badge.paused": "暂停",
  "xmind.badge.collapsed": "折叠",
  "xmind.badge.floating": "浮动",
  "xmind.badge.summary": "概要",
  "xmind.badge.callout": "标注",
  "xmind.imageResource": "图片资源: {name}",
  "xmind.error.unrecognized": "无法识别 XMind 文件: ZIP 中未找到 content.json 或 content.xml",
  "xmind.error.noCanvas": "XMind 文件中没有可预览的画布",
  "cad.toolbar.fit": "适配",
  "cad.toolbar.zoomOut": "缩小",
  "cad.toolbar.zoomIn": "放大",
  "cad.layers.title": "图层",
  "cad.layers.count": "{count} 项",
  "cad.layers.merged": "{name}（已合并 {count} 个同名图层）",
  "cad.inspector.title": "结构",
  "cad.inspector.entities": "实体",
  "cad.inspector.blocks": "块",
  "cad.inspector.pages": "页面",
  "cad.inspector.drawn": "绘制",
  "cad.state.loadingViewer": "正在加载 CAD 预览器...",
  "cad.state.parsing": "正在解析 CAD...",
  "cad.error.parseFailed": "CAD 文件解析失败",
  "image.alt": "图片",
  "image.toolbar.rotation": "图片旋转",
  "image.toolbar.rotateLeft": "向左旋转图片",
  "image.toolbar.rotateRight": "向右旋转图片",
  "image.lightbox.alt": "图片预览",
  "image.lightbox.close": "关闭图片预览",
  "gitBundle.error.invalid": "当前文件不是标准 Git bundle。",
  "gitBundle.error.missingPack": "Git bundle header 后未找到 PACK 数据。",
  "gitBundle.notice.delta": "当前 bundle 包含 delta 压缩对象。预览器已在浏览器端解析常规 OFS_DELTA / REF_DELTA；若仍有缺失文件，通常是包体过大、对象过多或依赖外部 prerequisite。",
  "gitBundle.title.history": "历史记录",
  "gitBundle.title.fileTree": "文件树",
  "gitBundle.file.choose": "选择文件查看内容",
  "gitBundle.file.noTree": "当前 bundle 的 tree/blob 可能被 delta 压缩，暂未解析到可展开文件。",
  "gitBundle.file.none": "未解析到文件",
  "gitBundle.history.empty": "当前 bundle 未解析到 commit 对象，仅展示 refs 和 pack 摘要。",
  "gitBundle.toolbar.summary": "{commits} commits · {files} files",
  "gitBundle.meta.bundle": "Bundle",
  "gitBundle.meta.refs": "Refs",
  "gitBundle.meta.commits": "Commits",
  "gitBundle.meta.objects": "Objects",
  "gitBundle.meta.deltas": "Deltas",
  "gitBundle.meta.objectFormat": "Object format",
  "gitBundle.meta.objectTypes": "Object types",
  "geo.error.unrecognized": "无法识别的 GeoJSON 数据",
  "geo.error.xmlParseFailed": "XML 解析失败",
  "geo.error.unsupported": "不支持 .{type} 地理格式",
  "geo.title": "地理数据预览",
  "geo.featureCount": "要素数",
  "geo.bounds": "范围",
  "geo.geometryTypes": "几何类型",
  "geo.aria": "地理数据 SVG 预览",
  "geo.loading": "正在解析地理数据...",
  "geo.projection": "坐标系",
  "geo.engine": "渲染引擎",
  "geo.basemap": "底图",
  "geo.basemap.offline": "离线空底图",
  "geo.basemap.custom": "自定义瓦片",
  "geo.engine.maplibre": "MapLibre 矢量地图",
  "geo.engine.svg": "SVG 后备预览",
  "geo.error.projection": "地理坐标转换失败：{reason}",
  "geo.action.fit": "适配范围",
  "model.toolbar.fit": "适配",
  "model.toolbar.rotate": "旋转",
  "model.toolbar.wireframe": "线框",
  "model.toolbar.grid": "网格",
  "model.toolbar.axes": "坐标",
  "model.state.loadingSummary": "正在加载模型",
  "model.state.loading": "正在解析 3D 模型...",
  "model.state.loaded": "模型已加载",
  "model.state.parseFailed": "模型解析失败",
  "model.summary.meshes": "{count} 个网格",
  "model.summary.points": "{count} 个点云",
  "model.error.daeEmpty": "DAE 模型未解析出有效场景",
  "model.error.unsupported": "暂不支持 .{type} 模型格式",
  "model.error.parseFailed": "{type} 模型解析失败",
  "model.notice.signature": "检测到文件签名: {signature}。",
  "loading.generic.label": "文件内容",
  "loading.generic.hint": "正在整理内容结构并生成预览。",
  "loading.word.label": "Word 文档",
  "loading.word.hint": "正在准备分页、文本样式和文档结构。",
  "loading.wordWorker.hint": "正在通过 Worker 准备文档结构、文本样式和分页结果。",
  "loading.sheet.label": "Excel 表格",
  "loading.sheet.hint": "正在准备工作表、样式和可视区数据。",
  "loading.csv.label": "表格数据",
  "loading.csv.hint": "正在准备行列数据和基础样式。",
  "loading.presentation.label": "PPT 演示文稿",
  "loading.presentation.hint": "正在构建幻灯片布局和媒体内容。",
  "loading.pdf.label": "PDF 文档",
  "loading.pdf.hint": "正在载入页面位图、文本层和缩放视图。",
  "loading.ofd.label": "OFD 版式文件",
  "loading.ofd.hint": "正在解析国产版式文档和页面对象。",
  "loading.archive.label": "压缩包",
  "loading.archive.hint": "正在启动 Worker 并读取压缩包目录。",
  "loading.email.label": "邮件文件",
  "loading.email.hint": "正在解析邮件头、正文和附件。",
  "loading.msg.hint": "正在解析 Outlook 邮件和附件。",
  "loading.eda.label": "EDA 文件",
  "loading.eda.hint": "正在读取 EDA 容器结构和可读属性。",
  "loading.cad.label": "CAD 图纸",
  "loading.cad.hint": "正在准备 CAD 图层、几何对象和画布视图。",
  "loading.dwg.hint": "正在通过 Worker 加载 DWG 几何和 LibreDWG WASM。",
  "loading.dwf.hint": "正在加载 DWF native renderer 与 W2D/W3D 图形。",
  "loading.dwfx.hint": "正在加载 DWFx/XPS native renderer 与页面图形。",
  "loading.xps.hint": "正在加载 XPS native renderer 与嵌入字体。",
  "loading.drawio.label": "draw.io 图纸",
  "loading.drawio.hint": "正在解析图元、连线和 SVG 预览。",
  "loading.excalidraw.label": "Excalidraw 图纸",
  "loading.excalidraw.hint": "正在解析手绘图元并生成安全 SVG。",
  "loading.epub.label": "EPUB 电子书",
  "loading.epub.hint": "正在解析目录、章节资源和阅读分页。",
  "loading.umd.label": "UMD 电子书",
  "loading.umd.hint": "正在解析移动电子书结构、目录和压缩正文。",
  "loading.image.label": "图片文件",
  "loading.image.hint": "正在解码像素数据并生成预览。",
  "loading.video.label": "视频文件",
  "loading.video.hint": "正在准备媒体资源和播放组件。",
  "loading.audio.label": "音频文件",
  "loading.audio.hint": "正在准备音频资源和播放控件。"
}, sn = {
  "toolbar.zoomGroup": "Zoom controls",
  "toolbar.zoomOut": "Zoom out",
  "toolbar.zoomIn": "Zoom in",
  "toolbar.zoomReset": "Reset zoom",
  "toolbar.download": "Download",
  "toolbar.downloadTitle": "Download the original file",
  "toolbar.print": "Print",
  "toolbar.printTitle": "Print the complete rendered document",
  "toolbar.printDirect": "Print now",
  "toolbar.printMask": "Mask / stamp & print",
  "toolbar.printMaskTitle": "Cover sensitive areas or add a stamp before printing",
  "toolbar.printMaskAdd": "Add mask",
  "toolbar.printMaskClear": "Clear",
  "toolbar.printMaskCancel": "Cancel",
  "toolbar.printMaskConfirm": "Print",
  "toolbar.printMaskHint": "Draw cover blocks, or upload a stamp and drag or resize it.",
  "toolbar.printStampUpload": "Upload stamp",
  "toolbar.printStampRemove": "Remove stamp",
  "toolbar.printStampResize": "Resize stamp",
  "toolbar.exportHtml": "HTML",
  "toolbar.exportHtmlTitle": "Export the rendered HTML",
  "toolbar.search": "Search",
  "toolbar.searchPlaceholder": "Search document",
  "toolbar.searchPrevious": "Previous match",
  "toolbar.searchNext": "Next match",
  "toolbar.searchClear": "Clear search",
  "toolbar.theme": "Theme",
  "toolbar.themeToLight": "Switch to light mode",
  "toolbar.themeToDark": "Switch to dark mode",
  "state.ready.title": "Preview ready",
  "state.ready.message": "The file has been rendered.",
  "state.empty.title": "No file selected",
  "state.empty.message": "Choose a file or provide an accessible URL to start previewing.",
  "state.unsupported.install.title": "Preview capability required",
  "state.unsupported.install.message": "{extension} is in the supported matrix, but {rendererLabel} renderer is not assembled in this project.",
  "state.unsupported.install.description": "Install {presetPackage} and pass the capability through options.preset / options.renderers{rendererTip}. Vite projects can also use @file-viewer/vite-plugin to auto-discover installed presets.",
  "state.unsupported.title": "Online preview is not supported yet",
  "state.unsupported.message": "{extension} cannot be previewed online. Download it or convert it to a supported format.",
  "state.unsupported.description": "Supports online preview for Office, PDF, OFD, Typst, archives, email, OLB/DRA, CAD, geospatial data, 3D models, Excalidraw, draw.io, EPUB, UMD, Markdown, code/text, images, audio/video, fonts, and structured data assets.",
  "state.error.title": "Preview failed",
  "preview.downloading": "Downloading file resources...",
  "preview.streamingPdf": "Preparing streaming PDF preview...",
  "preview.reading": "Parsing file content...",
  "error.download": "Download failed",
  "error.print": "Print failed",
  "error.exportHtml": "HTML export failed",
  "error.noDownloadSource": "There is no original file source to download.",
  "error.noExportContent": "There is no rendered preview content to export.",
  "error.printUnavailable": "This file type does not support full-document printing. Download the original file and print it locally.",
  "error.printWindowBlocked": "The browser blocked the print window.",
  "error.remoteDownload": "File download failed",
  "error.localRead": "Failed to read local file",
  "error.load": "Failed to load file",
  "error.stream": "Failed to load streaming PDF preview",
  "error.beforeOperation": "Before-operation check failed",
  "error.unknown": "Unknown error",
  "error.blobUnavailable": "Blob is not available in the current execution environment.",
  "error.sourceUnsupported": "Unsupported file source input.",
  "error.fileReadArrayBuffer": "Failed to read the file as an ArrayBuffer.",
  "error.fileReadDataUrl": "Failed to read the file as a data URL.",
  "error.fileReadText": "Failed to read the file as text.",
  "error.imageDataUrlRead": "Unable to read image data URL.",
  "operation.download": "Download original file",
  "operation.print": "Print complete rendered content",
  "operation.exportHtml": "Export rendered HTML",
  "operation.zoomIn": "Zoom in",
  "operation.zoomOut": "Zoom out",
  "operation.zoomReset": "Reset preview zoom",
  "pdf.toolbar.toggleNavigation": "Toggle navigation pane",
  "pdf.toolbar.previousPage": "Previous page",
  "pdf.toolbar.nextPage": "Next page",
  "pdf.toolbar.fitWidth": "Fit to width",
  "pdf.toolbar.zoomOut": "Zoom out",
  "pdf.toolbar.zoomIn": "Zoom in",
  "pdf.toolbar.rotateLeft": "Rotate left",
  "pdf.toolbar.rotateRight": "Rotate right",
  "pdf.nav.typeLabel": "PDF navigation type",
  "pdf.nav.pagesTab": "Pages",
  "pdf.nav.outlineTab": "Outline",
  "pdf.nav.pagesTitle": "Page navigation",
  "pdf.nav.outlineTitle": "Outline navigation",
  "pdf.nav.pageCount": "{count} pages",
  "pdf.nav.itemCount": "{count} items",
  "pdf.nav.pageLabel": "Page {page}",
  "pdf.nav.outlineEmpty": "This PDF has no available outline.",
  "pdf.nav.outlineFallbackTitle": "Outline {index}",
  "pdf.thumbnail.alt": "Page {page} thumbnail",
  "pdf.state.loading": "Loading PDF...",
  "pdf.error.browserWindow": "PDF preview requires a browser window",
  "pdf.error.missingSource": "PDF has no readable data source",
  "pdf.error.loadFailed": "Failed to load PDF",
  "pdf.error.notLoaded": "The PDF is not loaded yet. Please try again later.",
  "pdf.error.unloaded": "The PDF has been unloaded and cannot continue printing.",
  "pdf.error.canvasUnavailable": "This browser cannot create a PDF print canvas.",
  "pdf.export.pageTitle": "{title} - Page {page}",
  "spreadsheet.loading.kicker": "Excel workbook",
  "spreadsheet.loading.title": "Parsing Excel workbook",
  "spreadsheet.loading.hint": "Preparing worksheets, styles, and virtualized viewport data.",
  "spreadsheet.loading.streaming": "Loading visible worksheet data",
  "spreadsheet.tabs.ariaLabel": "Worksheet list",
  "spreadsheet.state.parsingWorkbook": "Parsing the Excel workbook. Please wait...",
  "spreadsheet.state.preparingSheet": "Preparing worksheet content...",
  "spreadsheet.state.preparingSheetNamed": "Preparing “{name}”...",
  "spreadsheet.state.cachedRows": "Cached {cached} / {total} rows",
  "spreadsheet.state.rows": "{rows} rows, loading smoothly by viewport",
  "spreadsheet.state.rowsAndColumns": "{rows} rows, {cols} columns, loading smoothly by viewport",
  "spreadsheet.error.parseFailed": "Failed to parse Excel",
  "spreadsheet.error.workerFailed": "Excel Worker failed",
  "word.error.invalidDocx": "The file is not a valid DOCX/OOXML package. It may be incomplete or replaced by an error response from the server. Upload it again or check the file source.",
  "word.error.missingOdfContent": "The ODF file is missing content.xml.",
  "word.error.odfXmlParseFailed": "Failed to parse ODF XML.",
  "word.title.rtf": "RTF document preview",
  "word.title.openDocumentPresentation": "OpenDocument presentation preview",
  "word.title.openDocumentText": "OpenDocument document preview",
  "word.page.fallback": "Page {page}",
  "word.page.empty": "No extractable text on this page",
  "word.body": "Body",
  "word.body.empty": "No readable text was extracted",
  "ofd.toolbar.pageNavigation": "OFD page navigation",
  "ofd.toolbar.documentPages": "OFD document pages",
  "ofd.toolbar.previousPage": "Previous page",
  "ofd.toolbar.nextPage": "Next page",
  "ofd.toolbar.pageStatus": "Page {current} of {total}",
  "ofd.toolbar.noPages": "No pages available",
  "ofd.state.loading": "Parsing OFD...",
  "ofd.error.empty": "The OFD file has no renderable document.",
  "ofd.error.parseFailed": "Failed to parse OFD file",
  "presentation.state.loading": "Parsing PPTX...",
  "presentation.error.title": "PPTX preview failed",
  "presentation.error.parseFailed": "Failed to parse PPTX",
  "presentation.ppt.state.loading": "Parsing PowerPoint 97–2003...",
  "presentation.ppt.error.title": "PPT preview failed",
  "presentation.ppt.error.parseFailed": "This PPT file could not be parsed.",
  "presentation.ppt.error.assetHint": "Check the @file-viewer/ppt module, pptWasmUrl, application/wasm MIME type, Web Crypto, and CSP settings.",
  "archive.error.nestedUnsupported": ".{type} cannot be previewed online. Download it or convert it to a supported format.",
  "archive.loading.readingDirectory": "Reading archive directory...",
  "archive.loading.readingDirectoryHint": "Large files are parsed in a Worker to keep the main thread responsive.",
  "archive.search.placeholder": "Filter files inside the archive",
  "archive.sidebar.hide": "Hide archive file list",
  "archive.sidebar.show": "Show archive file list",
  "archive.preview.title": "Archive entry preview",
  "archive.preview.chooseFile": "Choose a file",
  "archive.preview.downloadFile": "Download file",
  "archive.error.title": "Archive preview notice",
  "archive.stats.summary": "{count} files · {size} · {previewable} directly previewable",
  "archive.warning.encrypted": "Encrypted content was detected. Enter the correct password to preview it; the password is passed only to the libarchive Worker for this session.",
  "archive.password.title": "Enter archive password",
  "archive.password.description": "This archive contains encrypted content. A password is required to read the directory or preview entries.",
  "archive.password.placeholder": "Archive password",
  "archive.password.invalid": "The password is incorrect or the entry could not be decrypted. Try again.",
  "archive.password.required": "Enter a password to continue.",
  "archive.password.cancel": "Cancel",
  "archive.password.confirm": "Unlock preview",
  "archive.error.passwordRequired": "Password entry was cancelled, so the encrypted archive cannot be previewed.",
  "archive.error.encryptedRequiresWorker": "This archive contains encrypted content and requires the libarchive Worker/WASM assets for online decryption.",
  "archive.empty.title": "Choose a file from the left to preview",
  "archive.empty.message": "The archive directory is read first. File contents are extracted on demand and cached in IndexedDB when size allows.",
  "archive.loading.initializingCandidate": "Initializing {label}...",
  "archive.loading.initializingCandidateHint": "If the server does not publish Worker/WASM assets correctly, the viewer falls back automatically.",
  "archive.error.candidateInitTimeout": "{label} initialization timed out",
  "archive.error.encryptedCheckTimeout": "{label} encryption check timed out",
  "archive.loading.directoryReadyHint": "After the directory is ready, click an entry to extract it on demand.",
  "archive.error.candidateReadTimeout": "{label} directory read timed out",
  "archive.loading.workerFallback": "Worker unavailable. Switching to ZIP/TAR compatibility mode...",
  "archive.loading.workerFallbackHint": "Compatibility mode needs no static Worker and works well in mobile WebViews or temporary local servers.",
  "archive.notice.workerFallback": "The libarchive Worker could not start in this environment, so ZIP/TAR/GZIP compatibility mode is active. RAR, 7z, and similar formats should still publish vendor/libarchive/worker-bundle.js and libarchive.wasm.",
  "archive.error.tooLarge": "Archive size {size} exceeds the safety limit {limit}. Download and extract it locally.",
  "archive.loading.initializingWorker": "Initializing archive parsing Worker...",
  "archive.loading.initializingWorkerHint": "Large files are parsed in a Worker to keep the main thread responsive.",
  "archive.error.workerInitFailed": "Archive Worker initialization failed",
  "archive.error.workerUnsupported": "This browser does not support Web Workers.",
  "archive.error.indexedDbUnavailable": "IndexedDB is unavailable",
  "archive.error.entryTooLarge": "Entry {name} is {size}, exceeding the preview limit {limit}.",
  "archive.loading.extracting": "Extracting {name} on demand...",
  "archive.loading.rendering": "Rendering {name}...",
  "archive.loading.exporting": "Exporting {name}...",
  "media.audio.title": "Audio preview",
  "media.audio.description": "Opened with the browser-native audio player. Codec support depends on the current browser.",
  "media.audio.unsupported": "This browser does not support audio playback.",
  "media.video.title": "Video preview",
  "media.video.unsupported": "This browser does not support this video format.",
  "media.video.hlsHint": "HLS prefers the original URL for segment loading. If the input is a local single-file playlist, make sure segment URLs are reachable by the browser.",
  "media.midi.title": "MIDI file",
  "media.midi.loading": "Parsing MIDI tracks...",
  "media.midi.trackHeader": "Track",
  "media.midi.instrumentHeader": "Instrument",
  "media.midi.channelHeader": "Channel",
  "media.midi.noteCountHeader": "Notes",
  "media.midi.durationHeader": "Duration",
  "media.midi.durationStat": "Duration",
  "media.midi.trackStat": "Tracks",
  "media.midi.noteStat": "Notes",
  "media.midi.parseFailed": "Failed to parse MIDI",
  "email.mbox.subject": "{filename} · message 1",
  "email.mbox.summary": "Detected {count} messages in the MBOX archive. Showing message 1.",
  "email.error.title": "Email preview notice",
  "email.meta.from": "From",
  "email.meta.to": "To",
  "email.meta.cc": "Cc",
  "email.meta.date": "Date",
  "email.tabs.text": "Body",
  "email.tabs.headers": "Headers",
  "email.attachments.title": "Attachments",
  "email.attachments.empty": "No attachments",
  "email.attachments.download": "Download attachment",
  "email.attachments.opening": "Opening attachment {name}...",
  "email.attachments.nestedUnavailable": "Nested attachment preview is not available in this environment. Download {name} to inspect it.",
  "email.loading.parsing": "Parsing email...",
  "data.font.sample": "Flyfish Viewer preview AaBbCc 1234567890",
  "data.error.fontFaceUnsupported": "This browser does not support the FontFace API",
  "data.title.font": "Font file preview",
  "data.title.sqlite": "SQLite database preview",
  "data.title.parquet": "Parquet columnar data preview",
  "data.title.avro": "Avro object container preview",
  "data.title.wasm": "WebAssembly module preview",
  "data.title.eps": "EPS vector file summary",
  "data.title.ai": "Illustrator file summary",
  "data.title.webarchive": "WebArchive summary preview",
  "data.title.summary": "Data asset summary",
  "data.label.format": "Format",
  "data.label.size": "Size",
  "data.label.rendering": "Renderer",
  "data.label.objects": "Objects",
  "data.label.sampleTable": "Sample table",
  "data.label.rows": "Rows",
  "data.label.columns": "Columns",
  "data.label.sampleRows": "Sample rows",
  "data.label.imports": "Imports",
  "data.label.exports": "Exports",
  "data.label.magic": "Magic",
  "data.label.note": "Note",
  "data.label.container": "Container",
  "data.value.schemaRead": "Read",
  "data.value.schemaUnread": "Not read",
  "data.note.aiSummary": "Non PDF-compatible AI is shown as a safe summary.",
  "data.note.postscriptSummary": "PostScript summary preview",
  "data.note.webarchive": "Readable fragments are extracted safely. Web scripts are not executed.",
  "data.image.alt": "Asset preview",
  "psd.title": "PSD layer preview",
  "psd.action.fit": "Fit",
  "psd.action.showAll": "Show all",
  "psd.action.hideAll": "Hide all",
  "psd.layers.title": "Layers",
  "psd.layers.redrawable": "{count} redrawable",
  "psd.layers.empty": "No displayable layers were found. Showing the composite image.",
  "psd.layers.hidden": "hidden",
  "drawing.error.viewerLoadFailed": "Failed to load the diagrams.net viewer",
  "drawing.error.excalidrawEmpty": "This Excalidraw file has no previewable elements",
  "drawing.error.excalidrawTimeout": "Excalidraw SVG export timed out. Falling back to the rough.js renderer.",
  "drawing.error.drawioParseFailed": "Failed to parse Draw.io XML: {message}",
  "drawing.error.drawioNoModel": "This Draw.io file has no directly renderable mxGraphModel.",
  "drawing.error.drawioNoElements": "This Draw.io file has no previewable elements.",
  "drawing.error.viewerInitFailed": "The diagrams.net viewer was not initialized correctly",
  "drawing.error.drawioTimeout": "Official diagrams.net Viewer timed out. Falling back to the local SVG preview.",
  "drawing.error.svgParseFailed": "Failed to parse SVG",
  "drawing.error.plantumlRenderFailed": "Failed to render PlantUML SVG: {status}",
  "drawing.title.excalidraw": "Excalidraw SVG preview",
  "drawing.title.mermaid": "Mermaid SVG preview",
  "drawing.title.plantuml": "PlantUML SVG preview",
  "drawing.title.drawio": "Draw.io offline SVG preview",
  "drawing.toolbar.zoomOut": "Zoom out",
  "drawing.toolbar.zoomIn": "Zoom in",
  "drawing.toolbar.fit": "Fit",
  "drawing.toolbar.fitWidth": "Fit width",
  "drawing.state.loading": "Loading drawing preview...",
  "text.code.loadingHighlight": "Loading syntax highlighting...",
  "text.code.indexingLargeFile": "Indexing large file {progress}%",
  "text.code.virtualized": "Large file · virtual scrolling · highlighting off",
  "text.code.firstSegment": "First segment",
  "text.code.previousSegment": "Previous segment",
  "text.code.nextSegment": "Next segment",
  "text.code.lastSegment": "Last segment",
  "ebook.toc": "Table of contents",
  "ebook.reading": "Reading",
  "ebook.itemCount": "{count} items",
  "epub.title": "EPUB ebook",
  "epub.previousPage": "Previous",
  "epub.nextPage": "Next",
  "epub.loading": "Parsing EPUB...",
  "epub.chapterFallback": "Chapter {index}",
  "epub.renderIncomplete": "EPUB content did not finish rendering. Refresh and try again.",
  "umd.title": "UMD ebook",
  "umd.previousChapter": "Previous chapter",
  "umd.nextChapter": "Next chapter",
  "umd.loading": "Parsing UMD...",
  "umd.emptyContent": "No readable body content was parsed.",
  "umd.chapterFallback": "Chapter {index}",
  "umd.galleryFallback": "Gallery {index}",
  "umd.warningBodyTooShort": "The UMD body is shorter than declared and may be incomplete.",
  "umd.error.unexpectedEnd": "The UMD structure is incomplete and ended unexpectedly.",
  "umd.error.invalidFile": "This is not a valid UMD ebook file.",
  "typst.summaryRenderer": "Typst WASM renderer",
  "typst.pageSummary.empty": "0 pages",
  "typst.pageSummary.ready": "{count} pages / {width} x {height} pt",
  "typst.status.compiling": "Compiling",
  "typst.status.failed": "Compilation failed",
  "typst.status.rendered": "Rendered",
  "typst.loading.title": "Parsing Typst",
  "typst.loading.hint": "Loading the compiler and generating page previews...",
  "typst.error.title": "Typst render failed",
  "typst.error.timeout": "Typst WASM / font loading or compilation exceeded {seconds} seconds",
  "typst.error.timeoutHint": "Check the download speed and cache strategy for the Typst compiler WASM, renderer WASM, and font directory. On weak networks or cross-region deployments, increase options.typst.renderTimeoutMs.",
  "typst.error.assetHint": "Typst requires local compiler / renderer WASM files and a font directory. Run file-viewer-copy-assets, or configure options.typst.compilerWasmUrl / options.typst.rendererWasmUrl / options.typst.fontAssetsUrl, and make sure the server returns WASM with application/wasm.",
  "typst.error.svgParseFailed": "Failed to parse Typst SVG",
  "typst.error.wasmLoadFailed": "Failed to load Typst WASM",
  "xmind.toolbar.zoomOut": "Zoom out",
  "xmind.toolbar.zoomIn": "Zoom in",
  "xmind.toolbar.fit": "Fit",
  "xmind.toolbar.fitTitle": "Fit canvas",
  "xmind.state.loading": "Parsing XMind mind map...",
  "xmind.stats.nodes": "Nodes",
  "xmind.stats.depth": "Depth",
  "xmind.stats.theme": "Theme",
  "xmind.stats.template": "Template",
  "xmind.badge.paused": "Paused",
  "xmind.badge.collapsed": "Collapsed",
  "xmind.badge.floating": "Floating",
  "xmind.badge.summary": "Summary",
  "xmind.badge.callout": "Callout",
  "xmind.imageResource": "Image resource: {name}",
  "xmind.error.unrecognized": "Unrecognized XMind file: content.json or content.xml was not found in the ZIP package.",
  "xmind.error.noCanvas": "This XMind file has no previewable canvas.",
  "cad.toolbar.fit": "Fit",
  "cad.toolbar.zoomOut": "Zoom out",
  "cad.toolbar.zoomIn": "Zoom in",
  "cad.layers.title": "Layers",
  "cad.layers.count": "{count} items",
  "cad.layers.merged": "{name} ({count} merged layers)",
  "cad.inspector.title": "Structure",
  "cad.inspector.entities": "Entities",
  "cad.inspector.blocks": "Blocks",
  "cad.inspector.pages": "Pages",
  "cad.inspector.drawn": "Drawn",
  "cad.state.loadingViewer": "Loading CAD viewer...",
  "cad.state.parsing": "Parsing CAD...",
  "cad.error.parseFailed": "Failed to parse CAD file",
  "image.alt": "Image",
  "image.toolbar.rotation": "Image rotation",
  "image.toolbar.rotateLeft": "Rotate image left",
  "image.toolbar.rotateRight": "Rotate image right",
  "image.lightbox.alt": "Image preview",
  "image.lightbox.close": "Close image preview",
  "gitBundle.error.invalid": "This file is not a valid Git bundle.",
  "gitBundle.error.missingPack": "No PACK data was found after the Git bundle header.",
  "gitBundle.notice.delta": "This bundle contains delta-compressed objects. The viewer resolves common OFS_DELTA / REF_DELTA objects in the browser. Missing files usually indicate a very large bundle, too many objects, or an external prerequisite.",
  "gitBundle.title.history": "History",
  "gitBundle.title.fileTree": "File tree",
  "gitBundle.file.choose": "Select a file to inspect",
  "gitBundle.file.noTree": "The tree/blob objects in this bundle may be delta-compressed, and no expandable files were parsed.",
  "gitBundle.file.none": "No files parsed",
  "gitBundle.history.empty": "No commit objects were parsed. Showing refs and pack summary only.",
  "gitBundle.toolbar.summary": "{commits} commits · {files} files",
  "gitBundle.meta.bundle": "Bundle",
  "gitBundle.meta.refs": "Refs",
  "gitBundle.meta.commits": "Commits",
  "gitBundle.meta.objects": "Objects",
  "gitBundle.meta.deltas": "Deltas",
  "gitBundle.meta.objectFormat": "Object format",
  "gitBundle.meta.objectTypes": "Object types",
  "geo.error.unrecognized": "Unrecognized GeoJSON data",
  "geo.error.xmlParseFailed": "Failed to parse XML",
  "geo.error.unsupported": ".{type} geospatial format is not supported",
  "geo.title": "Geospatial preview",
  "geo.featureCount": "Features",
  "geo.bounds": "Bounds",
  "geo.geometryTypes": "Geometry types",
  "geo.aria": "Geospatial SVG preview",
  "geo.loading": "Parsing geospatial data...",
  "geo.projection": "Projection",
  "geo.engine": "Renderer",
  "geo.basemap": "Basemap",
  "geo.basemap.offline": "Offline empty basemap",
  "geo.basemap.custom": "Custom tiles",
  "geo.engine.maplibre": "MapLibre vector map",
  "geo.engine.svg": "SVG fallback",
  "geo.error.projection": "Geospatial projection failed: {reason}",
  "geo.action.fit": "Fit bounds",
  "model.toolbar.fit": "Fit",
  "model.toolbar.rotate": "Rotate",
  "model.toolbar.wireframe": "Wireframe",
  "model.toolbar.grid": "Grid",
  "model.toolbar.axes": "Axes",
  "model.state.loadingSummary": "Loading model",
  "model.state.loading": "Parsing 3D model...",
  "model.state.loaded": "Model loaded",
  "model.state.parseFailed": "Failed to parse model",
  "model.summary.meshes": "{count} meshes",
  "model.summary.points": "{count} point clouds",
  "model.error.daeEmpty": "The DAE model did not contain a valid scene.",
  "model.error.unsupported": ".{type} model format is not supported yet",
  "model.error.parseFailed": "Failed to parse {type} model",
  "model.notice.signature": "Detected file signature: {signature}.",
  "loading.generic.label": "File content",
  "loading.generic.hint": "Preparing content structure and preview.",
  "loading.word.label": "Word document",
  "loading.word.hint": "Preparing document structure, text styles, and layout.",
  "loading.wordWorker.hint": "Preparing document structure, text styles, and layout in a Worker.",
  "loading.sheet.label": "Excel workbook",
  "loading.sheet.hint": "Preparing worksheets, styles, and viewport data.",
  "loading.csv.label": "Tabular data",
  "loading.csv.hint": "Preparing rows, columns, and basic styling.",
  "loading.presentation.label": "PowerPoint deck",
  "loading.presentation.hint": "Building slide layout and media content.",
  "loading.pdf.label": "PDF document",
  "loading.pdf.hint": "Loading page bitmaps, text layers, and zoom view.",
  "loading.ofd.label": "OFD layout document",
  "loading.ofd.hint": "Parsing OFD pages and layout objects.",
  "loading.archive.label": "Archive",
  "loading.archive.hint": "Starting Worker and reading archive entries.",
  "loading.email.label": "Email file",
  "loading.email.hint": "Parsing message headers, body, and attachments.",
  "loading.msg.hint": "Parsing Outlook message and attachments.",
  "loading.eda.label": "EDA file",
  "loading.eda.hint": "Reading EDA container structure and properties.",
  "loading.cad.label": "CAD drawing",
  "loading.cad.hint": "Preparing CAD layers, geometry, and canvas view.",
  "loading.dwg.hint": "Loading DWG geometry and LibreDWG WASM in a Worker.",
  "loading.dwf.hint": "Loading native DWF renderer and W2D/W3D graphics.",
  "loading.dwfx.hint": "Loading native DWFx/XPS renderer and page graphics.",
  "loading.xps.hint": "Loading native XPS renderer and embedded fonts.",
  "loading.drawio.label": "draw.io diagram",
  "loading.drawio.hint": "Parsing shapes, connectors, and SVG preview.",
  "loading.excalidraw.label": "Excalidraw scene",
  "loading.excalidraw.hint": "Parsing hand-drawn elements and generating safe SVG.",
  "loading.epub.label": "EPUB ebook",
  "loading.epub.hint": "Parsing table of contents, chapter resources, and reading pages.",
  "loading.umd.label": "UMD ebook",
  "loading.umd.hint": "Parsing mobile ebook metadata, table of contents, and compressed chapters.",
  "loading.image.label": "Image file",
  "loading.image.hint": "Decoding pixels and generating preview.",
  "loading.video.label": "Video file",
  "loading.video.hint": "Preparing media resource and player.",
  "loading.audio.label": "Audio file",
  "loading.audio.hint": "Preparing audio resource and playback controls."
}, ct = Object.freeze({
  "zh-CN": ln,
  "en-US": sn,
  "ja-JP": an
}), rr = (e) => {
  const t = String(e || "").trim().replace(/_/g, "-").toLowerCase();
  if (t) {
    if (t === "zh" || t.startsWith("zh-"))
      return "zh-CN";
    if (t === "ja" || t.startsWith("ja-"))
      return "ja-JP";
    if (t === "en" || t.startsWith("en-"))
      return "en-US";
  }
}, dn = () => {
  const e = typeof window < "u" ? window.navigator : void 0;
  return e ? Array.from(new Set([
    ...Array.isArray(e.languages) ? e.languages : [],
    e.language
  ].filter((t) => typeof t == "string" && !!t.trim()))) : [];
}, cn = (e) => {
  if (e && e !== "auto")
    return rr(e) || bt;
  const t = dn();
  for (const r of t) {
    const o = rr(r);
    if (o)
      return o;
  }
  return t.length > 0 ? bt : Cr;
}, un = (e) => {
  var t;
  return ((t = e?.i18n) === null || t === void 0 ? void 0 : t.messages) || e?.messages;
}, zt = (e) => {
  var t;
  return cn(((t = e?.i18n) === null || t === void 0 ? void 0 : t.locale) || e?.locale);
}, pn = (e, t = {}) => e.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (r, o) => {
  const i = t[o];
  return i == null ? "" : String(i);
}), ne = (e, t, r = {}) => {
  const o = zt(e), i = un(e), a = (typeof i == "function" ? i(t, r, o) : i?.[t]) || ct[o][t] || ct[bt][t] || ct[Cr][t];
  return pn(a, r);
}, mn = (e) => (t, r) => ne(e, t, r), ot = "file-viewer-preview", at = "preview", Mr = ye, fn = (e) => e && "name" in e && typeof e.name == "string" ? e.name : "", vn = (e) => e && typeof e.type == "string" ? e.type : "", wn = ({ buffer: e = null, file: t = null, url: r = null, filename: o = null, mimeType: i = null } = {}) => ({
  buffer: e,
  file: t,
  url: r,
  filename: o,
  mimeType: i || vn(t) || null
}), Ke = (e, t = at) => e?.filename || t, hn = (e, t = at) => {
  var r;
  return wn({
    buffer: e?.buffer,
    file: e?.file,
    url: e?.url,
    filename: Ke(e, t),
    mimeType: (r = e?.file) === null || r === void 0 ? void 0 : r.type
  });
}, gn = (e, t = "preview") => e.filename || fn(e.file) || t, Ee = ({ filename: e, source: t, fallback: r = ot }) => e || (t ? gn(t, "") : "") || r, bn = (e) => !!e.buffer || !!e.file || !!e.url, It = async (e, t) => e ? await e(t) : !0, Or = async (e, { source: t, title: r, filename: o, adapter: i = null, watermarkInlineStyle: n, mask: a = null, i18n: l }) => {
  if (!t)
    throw new Error(ne(l, "error.noExportContent"));
  return nn({
    source: t,
    mode: e,
    title: Ee({
      filename: r || o,
      fallback: ot
    }),
    adapter: i,
    watermarkInlineStyle: n,
    mask: e === "print" ? a : null
  });
}, yn = async ({ source: e, filename: t, beforeOperation: r, i18n: o, throwOnMissingSource: i = !0 }) => {
  var n;
  if (!bn(e)) {
    if (i)
      throw new Error(ne(o, "error.noDownloadSource"));
    return !1;
  }
  if (!await It(r, "download"))
    return !1;
  const a = Ee({
    filename: t,
    source: e,
    fallback: Mr
  });
  return e.buffer && (e.buffer.byteLength > 0 || !e.file && !e.url) ? (Ce(new Blob([e.buffer], { type: e.mimeType || ((n = e.file) === null || n === void 0 ? void 0 : n.type) || "application/octet-stream" }), a), !0) : e.file && (e.file.size > 0 || !e.url) ? (Ce(e.file, a), !0) : e.url ? (Ki(e.url, a), !0) : e.file ? (Ce(e.file, a), !0) : (Ce(new Blob([e.buffer], { type: e.mimeType || "application/octet-stream" }), a), !0);
}, xn = async ({ download: e = !0, filename: t, beforeOperation: r, i18n: o, ...i }) => {
  if (!await It(r, "export-html"))
    return "";
  const n = await Or("export", {
    ...i,
    filename: t,
    i18n: o
  });
  if (e !== !1) {
    const a = Ee({
      filename: t || i.title,
      fallback: at
    });
    Ce(new Blob([n], { type: "text/html;charset=utf-8" }), `${a}.rendered.html`);
  }
  return n;
}, Sn = async ({ autoPrint: e = !0, beforeOperation: t, i18n: r, openWindow: o, printAvailable: i = !0, printWindow: n, ...a }) => {
  if (!i)
    throw new Error(ne(r, "error.printUnavailable"));
  if (!await It(t, "print"))
    return !1;
  const l = await Or("print", { ...a, i18n: r }), s = n || o?.() || (typeof window < "u" ? window.open("", "_blank") : null);
  if (!s)
    throw new Error(ne(r, "error.printWindowBlocked"));
  return s.document.open(), s.document.write(l), s.document.close(), s.focus(), await on(s), e !== !1 && s.print(), !0;
}, ut = "__flyfish_file_viewer_auto_renderer_presets__", Be = () => {
  const e = globalThis;
  return e[ut] || (e[ut] = {
    version: 0,
    presets: /* @__PURE__ */ new Map()
  }), e[ut];
}, Fn = (e) => ({
  ...e,
  extensions: e.extensions.map(ae)
}), it = (e = se) => {
  const t = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), o = (i) => {
    const n = Fn(i), a = t.get(n.id);
    a && a.extensions.forEach((l) => {
      var s;
      ((s = r.get(l)) === null || s === void 0 ? void 0 : s.id) === a.id && r.delete(l);
    }), t.set(n.id, n), n.extensions.forEach((l) => {
      const s = r.get(l);
      if (s && s.id !== n.id)
        throw new Error(`File extension "${l}" is already registered by renderer "${s.id}".`);
      r.set(l, n);
    });
  };
  return e.forEach(o), {
    register: o,
    unregister(i) {
      const n = t.get(i);
      return n ? (n.extensions.forEach((a) => {
        var l;
        ((l = r.get(a)) === null || l === void 0 ? void 0 : l.id) === i && r.delete(a);
      }), t.delete(i), !0) : !1;
    },
    getById(i) {
      return t.get(i);
    },
    getByExtension(i) {
      return r.get(ae(i));
    },
    hasExtension(i) {
      return r.has(ae(i));
    },
    list() {
      return Array.from(t.values());
    },
    listExtensions() {
      return Array.from(r.keys()).sort();
    }
  };
}, Wr = (e) => !!e && typeof e == "object" && !Array.isArray(e) && Array.isArray(e.renderers), yt = (e) => e ? Array.isArray(e) ? e.flatMap((t) => yt(t)) : Wr(e) ? yt(e.renderers) : [e] : [], En = (e, t = {}) => t.id ? t.id : t.packageName ? t.packageName : Wr(e) ? e.id : !Array.isArray(e) && e && typeof e == "object" && "id" in e ? String(e.id) : "file-viewer-auto-renderers", kn = (e, t = {}) => {
  const r = Be(), o = En(e, t), i = r.presets.get(o);
  return (i?.input !== e || i.packageName !== t.packageName) && (r.presets.set(o, {
    id: o,
    packageName: t.packageName,
    input: e
  }), r.version += 1), () => {
    Rn(o);
  };
}, Rn = (e) => {
  const t = Be(), r = t.presets.delete(e);
  return r && (t.version += 1), r;
}, An = () => Array.from(Be().presets.values()).map((e) => e.input), Dn = (e) => {
  var t;
  const r = Be(), o = r.presets.get(e);
  if (o)
    return o.input;
  const i = e.startsWith("@file-viewer/preset-") ? e : `@file-viewer/preset-${e}`;
  return (t = Array.from(r.presets.values()).find((n) => n.packageName === i || n.id === i)) === null || t === void 0 ? void 0 : t.input;
}, _n = () => Be().version, xt = (e) => e ? typeof e == "string" ? !0 : Array.isArray(e) ? e.some((t) => xt(t)) : !1 : !1, St = (e) => {
  if (!e)
    return [];
  if (typeof e == "string") {
    const t = Dn(e);
    return t ? [t] : [];
  }
  return Array.isArray(e) ? e.flatMap((t) => St(t)) : [e];
}, Tn = async ({ registry: e, plugins: t, registerHandler: r }) => {
  var o, i, n;
  for (const a of t)
    (o = a.definitions) === null || o === void 0 || o.forEach((l) => {
      e.register(l);
    }), (i = a.handlers) === null || i === void 0 || i.forEach((l) => {
      r?.(l);
    }), await ((n = a.install) === null || n === void 0 ? void 0 : n.call(a, { registry: e, registerHandler: r }));
  return e;
}, Ur = ({ registry: e = it(se), handlers: t, fallbackHandler: r, fallbackKey: o = "error" }) => {
  const i = Array.from(t).reduce((s, m) => (s.set(m.rendererId, m.handler), s), /* @__PURE__ */ new Map()), n = /* @__PURE__ */ new Map(), a = [];
  e.list().forEach((s) => {
    const m = i.get(s.id);
    if (!m) {
      a.push(s.id);
      return;
    }
    s.extensions.forEach((w) => {
      n.set(ae(w), m);
    });
  }), r && o && n.set(ae(o), r);
  const l = (s) => n.get(ae(s));
  return {
    handlersByRendererId: i,
    handlersByExtension: n,
    missingRendererIds: a,
    get: l,
    resolve(s) {
      return l(s) || (o ? l(o) : void 0);
    },
    has(s) {
      return n.has(ae(s));
    },
    listExtensions() {
      return Array.from(n.keys()).sort();
    }
  };
}, Br = Object.freeze({
  download: !1,
  print: !1,
  exportHtml: !1,
  zoom: !1,
  zoomIn: !1,
  zoomOut: !1,
  zoomReset: !1
}), De = (e) => e === !0 || e === "adapter" || e === "provider", Pn = (e, t) => {
  var r, o, i, n, a, l, s, m;
  return e ? {
    ...{
      download: ((r = e.capabilities) === null || r === void 0 ? void 0 : r.download) !== !1,
      print: De((o = e.capabilities) === null || o === void 0 ? void 0 : o.print),
      exportHtml: De((i = e.capabilities) === null || i === void 0 ? void 0 : i.exportHtml),
      zoom: De((n = e.capabilities) === null || n === void 0 ? void 0 : n.zoom),
      zoomIn: De((a = e.capabilities) === null || a === void 0 ? void 0 : a.zoom),
      zoomOut: De((l = e.capabilities) === null || l === void 0 ? void 0 : l.zoom),
      zoomReset: De((s = e.capabilities) === null || s === void 0 ? void 0 : s.zoom)
    },
    ...(m = t?.getAvailability) === null || m === void 0 ? void 0 : m.call(t)
  } : { ...Br };
}, Ft = (e, t) => {
  const r = e.zoom && (t.canZoomIn || t.canZoomOut || t.canReset);
  return {
    ...e,
    zoom: r,
    zoomIn: r && t.canZoomIn,
    zoomOut: r && t.canZoomOut,
    zoomReset: r && t.canReset
  };
}, zn = (e) => ({
  ...Br,
  download: ae(e).length > 0
});
[
  ...Fr,
  ...Er
];
[
  ...xr,
  ...Sr
];
const In = {
  "load-start": "onLoadStart",
  "load-complete": "onLoadComplete",
  "unload-start": "onUnloadStart",
  "unload-complete": "onUnloadComplete"
}, Vn = ["zoom-in", "zoom-out", "zoom-reset"], Ln = {
  canZoomIn: "zoom-in",
  canZoomOut: "zoom-out",
  canReset: "zoom-reset"
}, Cn = [
  "search",
  "zoom",
  "download",
  "print",
  "exportHtml",
  "theme"
], Mn = ({ phase: e, version: t, source: r, filename: o, file: i, url: n, size: a, bufferSize: l, startedAt: s, duration: m, timestamp: w, reason: p }) => {
  var h;
  const k = ke(i?.name || o || n || ""), g = w ?? Date.now();
  return {
    phase: e,
    type: _e(k),
    filename: k,
    source: r,
    url: n,
    file: i || void 0,
    size: (h = a ?? i?.size) !== null && h !== void 0 ? h : l,
    version: t,
    timestamp: g,
    duration: m ?? (e === "load-complete" && typeof s == "number" ? g - s : void 0),
    reason: p
  };
}, Hr = ({ phase: e, source: t, version: r, startedAt: o, timestamp: i, reason: n }) => {
  const a = i ?? Date.now();
  return Mn({
    phase: e,
    filename: t.filename,
    source: t.kind,
    url: t.url,
    file: typeof File < "u" && t.file instanceof File ? t.file : void 0,
    size: t.size,
    version: r,
    timestamp: a,
    duration: e.endsWith("complete") && typeof o == "number" ? a - o : void 0,
    reason: n
  });
}, On = (e, t, r = Date.now(), o) => {
  const { phase: i, ...n } = t;
  return {
    ...n,
    operation: e,
    label: ne(o, {
      download: "operation.download",
      print: "operation.print",
      "export-html": "operation.exportHtml",
      "zoom-in": "operation.zoomIn",
      "zoom-out": "operation.zoomOut",
      "zoom-reset": "operation.zoomReset"
    }[e]),
    timestamp: r
  };
}, Wn = (e) => In[e], Un = async (e, t, r) => {
  const o = t?.[Wn(e.phase)];
  if (o)
    try {
      await o(e);
    } catch (i) {
      r?.(i, e);
    }
}, Bn = (e, t) => {
  const r = e?.toolbar;
  if (!r || typeof r != "object")
    return [e?.beforeOperation];
  const o = t === "download" ? r.beforeDownload : t === "print" ? r.beforePrint : t === "export-html" ? r.beforeExportHtml : void 0;
  return [e?.beforeOperation, r.beforeOperation, o];
}, Et = (e, t) => e?.[t] !== !1, Hn = (e, t) => !e || typeof e != "object" ? !0 : Et(e.permissions, t), Ye = (e, t) => Et(e.items, t) && Et(e.permissions, t), Nn = (e) => {
  if (e === "search" || e === "zoom" || e === "download" || e === "print")
    return e;
  if (e === "exportHtml" || e === "export-html")
    return "exportHtml";
  if (e === "theme")
    return "theme";
}, Je = (e) => {
  const t = [], r = /* @__PURE__ */ new Set(), o = (i) => {
    const n = Nn(i);
    !n || r.has(n) || (r.add(n), t.push(n));
  };
  return Array.isArray(e?.order) && e.order.forEach(o), Cn.forEach(o), t;
}, jn = (e) => Vn.some((t) => Ye(e, t)), $n = async ({ context: e, options: t, onBefore: r, onCancel: o, onError: i }) => {
  r?.(e);
  try {
    if (!Hn(t?.toolbar, e.operation))
      return o?.(e), !1;
    for (const n of Bn(t, e.operation)) {
      if (!n)
        continue;
      if (await n(e) === !1)
        return o?.(e), !1;
    }
  } catch (n) {
    return i?.(n, e), o?.(e), !1;
  }
  return !0;
}, Zn = (e) => {
  const t = e?.toolbar;
  return t === !1 ? {
    download: !1,
    print: !1,
    exportHtml: !1,
    zoom: !1,
    search: !1,
    theme: !1,
    order: Je(void 0)
  } : t && typeof t == "object" ? {
    download: t.download !== !1 && Ye(t, "download"),
    print: t.print !== !1 && Ye(t, "print"),
    exportHtml: t.exportHtml !== !1 && Ye(t, "export-html"),
    zoom: t.zoom !== !1 && jn(t),
    search: t.search !== !1,
    theme: t.theme !== !1,
    order: Je(t),
    items: t.items,
    permissions: t.permissions,
    position: t.position,
    beforeOperation: t.beforeOperation,
    beforeDownload: t.beforeDownload,
    beforePrint: t.beforePrint,
    beforeExportHtml: t.beforeExportHtml
  } : {
    download: !0,
    print: !0,
    exportHtml: !0,
    zoom: !0,
    search: !0,
    theme: !0,
    order: Je(void 0)
  };
}, Gn = (e, t, r = !0) => ({
  download: e.download && t.download,
  print: e.print && t.print,
  exportHtml: e.exportHtml && t.exportHtml,
  zoom: e.zoom && t.zoom,
  search: e.search !== !1 && r,
  theme: e.theme !== !1
}), qn = (e) => !!(e.download || e.print || e.exportHtml || e.zoom || e.search || e.theme), Ge = ({ toolbarDisabled: e = !1, availability: t, zoomState: r, action: o }) => {
  const i = Ln[o], n = i === "zoom-in" ? t.zoomIn : i === "zoom-out" ? t.zoomOut : t.zoomReset;
  return e || !t.zoom || !n || !r[o];
}, Xn = (e, t) => {
  const r = e?.toolbar, o = r && typeof r == "object" ? r.position : "auto";
  return o === "top" || o === "top-center" || o === "bottom-right" ? o : t === "pdf" ? "bottom-right" : "top";
}, Nr = Object.freeze({
  accent: "#5f6f82",
  soft: "rgba(95, 111, 130, 0.12)",
  badge: "DOC",
  label: "文件内容",
  hint: "正在整理内容结构并生成预览。"
}), Kn = (e, t) => {
  const r = ae(e);
  if (r)
    return `.${r}`;
  const o = zt(t);
  return o === "zh-CN" ? "当前文件" : o === "ja-JP" ? "現在のファイル" : "current file";
}, Yn = {
  "office-word-openxml": "@file-viewer/renderer-word",
  "office-word-binary": "@file-viewer/renderer-word",
  "office-presentation-binary": "@file-viewer/renderer-presentation",
  "office-presentation": "@file-viewer/renderer-presentation",
  "open-document": "@file-viewer/renderer-word",
  "spreadsheet-openxml": "@file-viewer/renderer-spreadsheet",
  pdf: "@file-viewer/renderer-pdf",
  ofd: "@file-viewer/renderer-ofd",
  typst: "@file-viewer/renderer-typst",
  archive: "@file-viewer/renderer-archive",
  email: "@file-viewer/renderer-email",
  eda: "@file-viewer/renderer-eda",
  cad: "@file-viewer/renderer-cad",
  model: "@file-viewer/renderer-3d",
  geo: "@file-viewer/renderer-geo",
  drawing: "@file-viewer/renderer-drawing",
  mindmap: "@file-viewer/renderer-mindmap",
  epub: "@file-viewer/renderer-epub",
  umd: "@file-viewer/renderer-epub",
  image: "@file-viewer/renderer-image",
  markdown: "@file-viewer/renderer-text",
  code: "@file-viewer/renderer-text",
  video: "@file-viewer/renderer-media",
  audio: "@file-viewer/renderer-media",
  "data-asset": "@file-viewer/renderer-data"
}, Jn = /* @__PURE__ */ new Set([
  "office-word-openxml",
  "office-word-binary",
  "office-presentation-binary",
  "office-presentation",
  "open-document",
  "spreadsheet-openxml",
  "pdf",
  "ofd"
]), Qn = /* @__PURE__ */ new Set([
  "image",
  "markdown",
  "code",
  "video",
  "audio"
]), ea = /* @__PURE__ */ new Set([
  "typst",
  "archive",
  "eda",
  "cad",
  "model",
  "geo",
  "drawing",
  "mindmap",
  "data-asset"
]), ta = (e) => Jn.has(e.id) ? {
  packageName: "@file-viewer/preset-office",
  vitePreset: "office",
  label: "Office preset"
} : ea.has(e.id) ? {
  packageName: "@file-viewer/preset-engineering",
  vitePreset: "engineering",
  label: "Engineering preset"
} : Qn.has(e.id) ? {
  packageName: "@file-viewer/preset-lite",
  vitePreset: "lite",
  label: "Lite preset"
} : {
  packageName: "@file-viewer/preset-all",
  vitePreset: "all",
  label: "Full preset"
}, ra = (e = "") => {
  const t = ae(e), r = se.find((i) => i.extensions.map(ae).includes(t));
  if (!r)
    return null;
  const o = ta(r);
  return {
    extension: t,
    rendererId: r.id,
    rendererLabel: r.label,
    rendererCategory: r.category,
    rendererPackage: Yn[r.id],
    presetPackage: o.packageName,
    vitePreset: o.vitePreset,
    presetLabel: o.label
  };
}, or = ({ state: e, extension: t = "", title: r, message: o, description: i, theme: n = Nr, recoverable: a }) => ({
  state: e,
  extension: ae(t),
  title: r,
  message: o,
  description: i,
  theme: n,
  recoverable: a
}), jr = (e = "", t = Nr, r) => {
  const o = Kn(e, r), i = ra(e);
  if (i) {
    const n = zt(r), a = i.rendererPackage ? n === "zh-CN" ? `；如果需要极致裁剪，也可以只安装 ${i.rendererPackage}` : n === "ja-JP" ? `；厳密に最小構成へ絞る場合は ${i.rendererPackage} のみをインストールすることもできます` : `; for a strict custom cut, install only ${i.rendererPackage}` : "";
    return or({
      state: "unsupported",
      extension: e,
      title: ne(r, "state.unsupported.install.title"),
      message: ne(r, "state.unsupported.install.message", {
        extension: o,
        rendererLabel: i.rendererLabel
      }),
      description: ne(r, "state.unsupported.install.description", {
        extension: o,
        rendererLabel: i.rendererLabel,
        presetPackage: i.presetPackage,
        vitePreset: i.vitePreset,
        rendererTip: a
      }),
      theme: t,
      recoverable: !0
    });
  }
  return or({
    state: "unsupported",
    extension: e,
    title: ne(r, "state.unsupported.title"),
    message: ne(r, "state.unsupported.message", {
      extension: o
    }),
    description: ne(r, "state.unsupported.description"),
    theme: t,
    recoverable: !0
  });
}, oa = {
  "Blob is not available in the current execution environment.": "error.blobUnavailable",
  "Unsupported file source input.": "error.sourceUnsupported",
  "Failed to read file as ArrayBuffer.": "error.fileReadArrayBuffer",
  "Failed to read file as data URL.": "error.fileReadDataUrl",
  "Failed to read file as text.": "error.fileReadText",
  "Unable to read image data URL.": "error.imageDataUrlRead",
  "文件不是有效的 DOCX/OOXML 压缩包，可能下载不完整或被服务端错误内容替换，请重新上传或检查文件源。": "word.error.invalidDocx",
  "ODF 文件缺少 content.xml": "word.error.missingOdfContent",
  "ODF 文件缺少 content.xml。": "word.error.missingOdfContent",
  "ODF XML 解析失败": "word.error.odfXmlParseFailed",
  "ODF XML 解析失败。": "word.error.odfXmlParseFailed",
  "OFD 文件中没有可渲染的文档": "ofd.error.empty",
  "OFD 文件解析失败": "ofd.error.parseFailed",
  "IndexedDB 不可用": "archive.error.indexedDbUnavailable",
  "Web Worker is not supported by this browser.": "archive.error.workerUnsupported"
}, pt = (e, t) => {
  const r = oa[e.trim()];
  return r ? ne(t, r) : e;
}, ir = (e, t) => {
  try {
    return e[t];
  } catch {
    return;
  }
}, ia = (e, t) => {
  if (e instanceof Error)
    return pt(e.message, t);
  if (typeof e == "string")
    return pt(e, t);
  if (e == null)
    return ne(t, "error.unknown");
  if (typeof e == "object") {
    const o = ir(e, "message");
    if (typeof o == "string" && o.trim())
      return pt(o, t);
    const i = ir(e, "reason");
    if (i !== void 0 && i !== e)
      return ia(i, t);
  }
  const r = String(e);
  return r === "[object Object]" ? ne(t, "error.unknown") : r;
}, Kl = 64 * 1024, na = () => {
  let e = 0, t = null;
  return {
    get version() {
      return e;
    },
    createVersion() {
      return e += 1, t?.abort(), t = null, e;
    },
    isCurrent(r) {
      return r === e;
    },
    createAbortController() {
      return t = typeof AbortController == "function" ? new AbortController() : null, t;
    },
    clearAbortController(r) {
      t === r && (t = null);
    },
    abort() {
      t?.abort(), t = null;
    }
  };
}, aa = (e = na()) => ({
  requestController: e,
  getCurrentVersion: () => e.version,
  isCurrentRequest: (t) => e.isCurrent(t)
}), la = /^[a-z][a-z0-9+.-]*:\/\//i, sa = /^[a-z][a-z0-9+.-]*:/i, da = (e) => {
  const t = e.indexOf("?"), r = e.indexOf("#");
  return t === -1 ? r : r === -1 ? t : Math.min(t, r);
}, ca = (e) => {
  if (!e)
    return e;
  let t = e;
  try {
    t = decodeURIComponent(e);
  } catch {
  }
  return encodeURIComponent(t).replace(/%3A/gi, ":").replace(/%40/gi, "@").replace(/%24/g, "$").replace(/%26/g, "&").replace(/%2B/gi, "+").replace(/%2C/gi, ",").replace(/%3B/gi, ";").replace(/%3D/gi, "=");
}, ua = (e) => e.split("/").map(ca).join("/"), pa = (e) => {
  if (e.startsWith("//")) {
    const r = e.indexOf("/", 2);
    return r === -1 ? { prefix: e, pathname: "" } : { prefix: e.slice(0, r), pathname: e.slice(r) };
  }
  const t = e.match(la);
  if (t) {
    const r = e.indexOf("/", t[0].length);
    return r === -1 ? { prefix: e, pathname: "" } : { prefix: e.slice(0, r), pathname: e.slice(r) };
  }
  return sa.test(e) ? { prefix: e, pathname: "" } : { prefix: "", pathname: e };
}, ma = (e) => {
  const t = e?.trim();
  if (!t)
    return null;
  const r = da(t), o = r === -1 ? t : t.slice(0, r), i = r === -1 ? "" : t.slice(r), { prefix: n, pathname: a } = pa(o);
  return a ? `${n}${ua(a)}${i}` : `${n}${i}`;
}, $r = "file-render", nr = "--file-viewer-render-surface-background", fa = "file-render-host", va = "file-render-shadow-target", wa = (e) => {
  if (typeof e != "string")
    return null;
  const t = e.trim();
  return t && t.toLowerCase() !== "auto" ? t : null;
}, kt = (e, t) => {
  var r;
  if (!e)
    return null;
  const o = wa((r = t?.ui) === null || r === void 0 ? void 0 : r.surfaceBackground);
  return o ? e.style.setProperty(nr, o) : e.style.removeProperty(nr), o;
}, Te = (e) => !e || typeof e != "object" ? !1 : typeof ShadowRoot < "u" && e instanceof ShadowRoot ? !0 : e.nodeType === 11 && !!e.host, ar = (e) => {
  var t;
  return ((t = e?.getRootNode) === null || t === void 0 ? void 0 : t.call(e)) || null;
}, ha = (e) => {
  var t;
  if (!e)
    return null;
  if (Te(e))
    return e;
  const r = (t = e.getRootNode) === null || t === void 0 ? void 0 : t.call(e);
  return Te(r) ? r : null;
}, Zr = (e) => e === "shadow" || e === "scoped" || e === "none" ? e : "auto", ga = (e, t) => {
  const r = Zr(e?.styleIsolation);
  return r === "auto" ? Te(ar(t)) ? "scoped" : "none" : r === "shadow" && Te(ar(t)) ? "scoped" : r;
}, ba = (e, t = {}) => {
  const r = e.ownerDocument.createElement("div");
  return r.className = t.className || $r, r.style.width = "100%", r.style.minWidth = "0", r.style.minHeight = "0", e.appendChild(r), r;
}, ya = (e, t = {}) => {
  const r = ga({
    styleIsolation: t.styleIsolation
  }, e), o = t.className || $r;
  if (r === "shadow" && typeof e.attachShadow == "function") {
    const n = e.ownerDocument.createElement("div");
    n.className = `${fa} ${o}`, n.dataset.fileViewerStyleIsolation = "shadow", n.style.width = "100%", n.style.minWidth = "0", n.style.minHeight = "0";
    const a = n.attachShadow({ mode: "open" }), l = e.ownerDocument.createElement("div");
    return l.className = `${va} ${o}`, l.dataset.fileViewerStyleIsolation = "shadow", l.style.width = "100%", l.style.minWidth = "0", l.style.minHeight = "0", a.appendChild(l), e.appendChild(n), {
      host: n,
      container: l,
      shadowRoot: a,
      styleIsolation: r
    };
  }
  const i = ba(e, { className: o });
  return i.dataset.fileViewerStyleIsolation = r, {
    host: i,
    container: i,
    styleIsolation: r
  };
}, xa = (e, t) => {
  const o = e.ownerDocument.createElement("style");
  return o.textContent = t, e.appendChild(o), o;
}, Sa = (e) => {
  var t, r;
  const o = (r = (t = e.ownerDocument.defaultView) === null || t === void 0 ? void 0 : t.CSSStyleSheet) !== null && r !== void 0 ? r : typeof CSSStyleSheet < "u" ? CSSStyleSheet : void 0;
  return "adoptedStyleSheets" in e && o && typeof o.prototype.replaceSync == "function" ? o : null;
}, Fa = (e, t, r = {}) => {
  const o = ha(e), i = o ? Sa(o) : null;
  if (r.adoptedStyleSheet && o && i) {
    const l = new i();
    return l.replaceSync(t), o.adoptedStyleSheets = [...o.adoptedStyleSheets, l], {
      sheet: l,
      remove() {
        o.adoptedStyleSheets = o.adoptedStyleSheets.filter((s) => s !== l);
      }
    };
  }
  const n = (Te(e), e), a = xa(n, t);
  return {
    node: a,
    remove() {
      a.remove();
    }
  };
}, Ea = (e, t) => t.parentNode !== e ? !1 : (e.removeChild(t), !0), ka = () => ({
  session: null,
  exportAdapter: null,
  thumbnailAdapter: null
}), Se = (e, t) => {
  var r, o, i;
  return "session" in t && (e.session = (r = t.session) !== null && r !== void 0 ? r : null), "exportAdapter" in t && (e.exportAdapter = (o = t.exportAdapter) !== null && o !== void 0 ? o : null), "thumbnailAdapter" in t && (e.thumbnailAdapter = (i = t.thumbnailAdapter) !== null && i !== void 0 ? i : null), e;
}, Ra = (e, t) => ({
  rendered: e,
  destroy: () => t ? t() : Gr(e)
}), Gr = (e) => {
  if (!e || typeof e != "object")
    return;
  const t = e;
  if (typeof t.unmount == "function")
    return t.unmount();
  if (typeof t.$destroy == "function")
    return t.$destroy();
  if (typeof t.destroy == "function")
    return t.destroy();
}, Aa = ({ source: e, surface: t, options: r, signal: o, registerExportAdapter: i, registerThumbnailAdapter: n, renderContext: a }) => ({
  filename: e.filename,
  url: e.url,
  streamUrl: e.url,
  signal: o,
  options: r,
  surface: t,
  registerExportAdapter: i,
  registerThumbnailAdapter: n,
  ...a
}), qr = ({ handler: e, rendererId: t, getTarget: r = (n) => n.surface.container, createContext: o = Aa, destroy: i }) => async (n) => {
  const { source: a } = n;
  if (!a.buffer)
    throw new Error("FileRenderHandler renderer requires an ArrayBuffer source.");
  const l = r(n), s = o(n), m = await e(a.buffer, l, a.extension, s), w = Tt(l), p = w ? null : Wi({
    host: l,
    renderer: t || a.extension
  }), h = w || p?.provider || null;
  return n.options.initialViewState && h?.applyState && await h.applyState(n.options.initialViewState, {
    action: "restore",
    source: "initial"
  }), Ra(m, () => {
    const k = () => i ? i(m, n) : Gr(m);
    try {
      p?.destroy();
    } finally {
      return k();
    }
  });
}, Da = ({ definitions: e = se, handlers: t, getTarget: r, createContext: o, destroy: i }) => {
  const n = it(e), a = Ur({
    registry: n,
    handlers: t
  }), l = n.list().map((s) => {
    const m = a.handlersByRendererId.get(s.id);
    return m ? {
      ...s,
      load: qr({
        handler: m,
        rendererId: s.id,
        getTarget: r,
        createContext: o,
        destroy: i
      })
    } : s;
  });
  return {
    registry: it(l),
    dispatcher: a,
    missingRendererIds: a.missingRendererIds
  };
}, _a = (e) => ({
  $el: e,
  unmount() {
  }
}), Vt = [
  {
    rendererId: "image",
    handler: async (e, t, r, o) => {
      const { default: i } = await import("./image-D7jDPP1U.js");
      return i(e, t, r, o);
    }
  }
], Xr = [
  "image"
], Ta = Vt.filter((e) => Xr.includes(e.rendererId)), Pa = se.filter((e) => Xr.includes(e.id)), za = (e) => e === "none" ? [] : e === "lite" ? Pa : se, Ia = (e) => e === "none" ? [] : e === "lite" ? Ta : Vt, Va = async (e, t, r, o) => {
  const i = jr(r, void 0, o?.options), n = document.createElement("div");
  n.style.textAlign = "center", n.style.marginTop = "80px";
  const a = document.createElement("div");
  if (a.textContent = i.message, n.appendChild(a), i.description) {
    const l = document.createElement("div");
    l.textContent = i.description, n.appendChild(l);
  }
  return t.replaceChildren(n), _a(t);
}, Kr = (e = {}) => {
  const t = e.builtinRenderers || "all", r = Da({
    definitions: za(t),
    handlers: Ia(t)
  });
  return {
    ...r,
    dispatcher: Ur({
      registry: r.registry,
      handlers: Vt,
      fallbackHandler: Va
    })
  };
}, La = Kr(), Ca = La.registry, Rt = (e) => e === "light" || e === "dark" || e === "system" ? e : "system", Yr = () => typeof globalThis.matchMedia == "function" && globalThis.matchMedia("(prefers-color-scheme: dark)").matches, At = (e, t = Yr()) => {
  const r = Rt(e);
  return r === "system" ? t ? "dark" : "light" : r;
}, Ma = (e, t = Yr()) => At(e, t) === "dark" ? "light" : "dark", Oa = (e) => e === "compact" ? "compact" : "comfortable", qe = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), Wa = (e) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(e)}")`, Fe = (e, t, r, o) => {
  const i = typeof e == "number" && Number.isFinite(e) ? e : t;
  return Math.min(o, Math.max(r, i));
}, Ua = (e) => e ? e === !0 ? {
  enabled: !0,
  text: "Flyfish Viewer"
} : e.enabled === !1 || !e.text && !e.image ? null : {
  enabled: !0,
  ...e
} : null, Ba = (e) => {
  const t = Fe(e.gapX, 260, 96, 800), r = Fe(e.gapY, 180, 80, 800), o = Fe(e.width, e.image ? 160 : 220, 32, t), i = Fe(e.height, (e.image, 72), 24, r), n = Fe(e.rotate, -24, -75, 75), a = Fe(e.opacity, 0.18, 0.02, 0.8), l = (t - o) / 2, s = (r - i) / 2, m = t / 2, w = r / 2;
  if (e.image) {
    const f = qe(e.image);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${r}" viewBox="0 0 ${t} ${r}"><g opacity="${a}" transform="rotate(${n} ${m} ${w})"><image href="${f}" x="${l}" y="${s}" width="${o}" height="${i}" preserveAspectRatio="xMidYMid meet"/></g></svg>`;
  }
  const p = qe(e.text || "Flyfish Viewer"), h = Fe(e.fontSize, 20, 10, 72), k = qe(e.color || "#355070"), g = qe(e.fontFamily || "Aptos, 'Segoe UI', sans-serif");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${r}" viewBox="0 0 ${t} ${r}"><g opacity="${a}" transform="rotate(${n} ${m} ${w})"><text x="${m}" y="${w}" text-anchor="middle" dominant-baseline="middle" fill="${k}" font-family="${g}" font-size="${h}" font-weight="700">${p}</text></g></svg>`;
}, Ha = (e) => {
  const t = Ua(e);
  return t ? Wa(Ba(t)) : "";
}, lr = (e) => {
  const t = Ha(e);
  return t ? `position:absolute;inset:0;pointer-events:none;background-image:${t};background-repeat:repeat;z-index:20;` : "";
}, Na = async (e) => {
  const { openFileViewerPrintMaskDesigner: t } = await import("./print-mask-DlvvPno6.js");
  return t(e);
}, Le = async (e, t, r, o, i, n, a) => {
  const l = Date.now(), s = Hr({
    phase: r,
    source: o,
    version: i,
    timestamp: l,
    startedAt: n,
    reason: a
  });
  await Un(s, e.hooks, (m) => {
    throw m;
  }), t?.({ type: r, payload: s });
}, sr = (e, t) => t.rendererMode === "replace" ? it([]) : e.registry ? e.registry : Kr({
  builtinRenderers: t.builtinRenderers
}).registry, dr = (e) => {
  const t = e.autoRenderers;
  return typeof t == "boolean" ? t : t?.enabled !== void 0 ? t.enabled : (e.rendererMode || "extend") !== "replace";
}, ja = (e, t) => {
  if (!e)
    return t.find((i) => i);
  const r = [], o = () => r.splice(0).forEach((i) => i());
  e.signal.addEventListener("abort", o, { once: !0 });
  for (const i of t) {
    if (!i)
      continue;
    if (i.aborted) {
      e.abort(i.reason);
      break;
    }
    const n = () => e.abort(i.reason);
    i.addEventListener("abort", n, { once: !0 }), r.push(() => i.removeEventListener("abort", n));
  }
  return e.signal;
}, $a = (e, t, r) => {
  const o = e.ownerDocument, i = jr(t, void 0, r), n = o.createElement("div");
  n.className = "file-viewer-missing-renderer", n.style.cssText = [
    "display:flex",
    "min-height:260px",
    "height:100%",
    "align-items:center",
    "justify-content:center",
    "padding:32px",
    "box-sizing:border-box",
    "text-align:center",
    "color:#64748b",
    'font:14px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  ].join(";");
  const a = o.createElement("div"), l = o.createElement("strong");
  l.textContent = i.message, l.style.cssText = "display:block;margin-bottom:8px;color:#172033;font-size:16px;";
  const s = o.createElement("p");
  s.textContent = i.description || i.title, s.style.cssText = "max-width:520px;margin:0;", a.append(l, s), n.append(a), e.replaceChildren(n);
}, Za = (e, t = {}) => {
  let r = t.options || {}, o = sr(t, r), i, n, a, l = r.rendererMode || "extend", s = r.builtinRenderers || "all", m = dr(r), w = -1, p = null, h = null, k = null;
  const g = ka(), f = aa(), S = {
    anchors: { value: [] },
    state: wt()
  };
  let P = null, F = !1, D = null, R = null, b = null;
  const x = () => e.ownerDocument.defaultView || (typeof window < "u" ? window : void 0), I = () => {
    if (b === null)
      return;
    const d = x();
    d?.cancelAnimationFrame && d.cancelAnimationFrame(b), b = null;
  }, $ = () => {
    if (b = null, !P || P.parentElement !== e)
      return;
    const d = P.style.display;
    P.style.display = "none";
    const y = Math.max(e.scrollWidth, e.clientWidth), L = Math.max(e.scrollHeight, e.clientHeight);
    P.style.display = d, P.style.width = `${y}px`, P.style.height = `${L}px`;
  }, W = () => {
    if (!P)
      return;
    I();
    const d = x();
    if (d?.requestAnimationFrame) {
      b = d.requestAnimationFrame($);
      return;
    }
    $();
  }, v = () => {
    I(), D?.disconnect(), D = null, R?.disconnect(), R = null;
  }, E = () => {
    v();
    const d = x();
    d?.ResizeObserver && (D = new d.ResizeObserver(() => W()), D.observe(e)), d?.MutationObserver && (R = new d.MutationObserver((y) => {
      y.every((H) => P && (H.target === P || P.contains(H.target))) || W();
    }), R.observe(e, {
      attributes: !0,
      childList: !0,
      subtree: !0
    })), W();
  }, u = () => {
    v(), P?.remove(), P = null, F && (e.style.position = "", F = !1);
  }, A = (d = h) => {
    d && (Ea(e, d), h === d && (h = null));
  }, U = (d = !0) => {
    const y = ya(e, {
      styleIsolation: r.styleIsolation
    }), L = y.host || y.container;
    return d && (L.style.height = "100%", y.container.style.height = "100%"), kt(L, r), h = L, y;
  }, q = async (d, y) => {
    var L;
    try {
      await ((L = d?.destroy) === null || L === void 0 ? void 0 : L.call(d));
    } finally {
      A(y);
    }
  }, X = () => {
    const d = lr(r.watermark);
    if (!d) {
      u();
      return;
    }
    (!P || P.ownerDocument !== e.ownerDocument) && (P = e.ownerDocument.createElement("div"), P.className = "viewer-watermark", P.setAttribute("aria-hidden", "true")), P.style.cssText = d;
    const y = x();
    y?.getComputedStyle && y.getComputedStyle(e).position === "static" && !e.style.position && (e.style.position = "relative", F = !0), P.parentElement !== e && e.appendChild(P), E();
  }, J = async () => {
    const d = r.rendererMode || "extend", y = r.renderers, L = r.preset, H = r.presets, N = r.builtinRenderers || "all", Z = dr(r), be = Z || xt(L) || xt(H) ? _n() : 0;
    if (d === l && y === i && L === n && H === a && N === s && Z === m && be === w)
      return;
    o = sr(t, r), l = d, i = y, n = L, a = H, s = N, m = Z, w = be;
    const me = [];
    Z && me.push(...An()), me.push(...St(L), ...St(H)), y && me.push(y);
    const ve = yt(me);
    if (!ve.length)
      return;
    await Tn({
      registry: o,
      plugins: ve,
      registerHandler: (O) => {
        const V = o.getById(O.rendererId);
        V && o.register({
          ...V,
          load: qr({
            handler: O.handler,
            rendererId: V.id,
            getTarget: (j) => j.surface.container
          })
        });
      }
    });
  }, _ = () => {
    const d = p || Ct({});
    return Hr({
      phase: "load-complete",
      source: d,
      version: f.getCurrentVersion(),
      timestamp: Date.now()
    });
  }, B = async (d) => {
    const y = On(d, _());
    return $n({
      context: y,
      options: r,
      onBefore: (L) => {
        var H;
        (H = t.onEvent) === null || H === void 0 || H.call(t, { type: "operation-before", payload: L });
      },
      onCancel: (L) => {
        var H;
        (H = t.onEvent) === null || H === void 0 || H.call(t, { type: "operation-cancel", payload: L });
      },
      onError(L) {
        throw L;
      }
    });
  }, pe = (d) => typeof d == "string" ? d : lr(r.watermark), G = (d) => {
    const y = d || p?.extension || "", L = o.getByExtension(y), H = z.getState();
    return Ft(L ? Pn(L, g.session) : zn(y), H);
  }, K = () => {
    var d;
    (d = t.onEvent) === null || d === void 0 || d.call(t, {
      type: "operation-availability-change",
      payload: G()
    });
  }, Q = (d = z.getState()) => {
    var y;
    (y = t.onEvent) === null || y === void 0 || y.call(t, {
      type: "zoom-change",
      payload: d
    });
  }, le = (d = z.getState()) => {
    Q(d), K();
  }, He = (d) => {
    var y;
    (y = t.onEvent) === null || y === void 0 || y.call(t, {
      type: "fit-change",
      payload: d
    });
  }, z = Fi({
    root: () => k || e,
    beforeZoom: B,
    onChange: (d) => le(d)
  }), oe = Li({
    root: () => k || e,
    getFit: () => r.fit,
    onFit: (d) => {
      z.refreshProvider(), ee.refreshProvider(), le(), He(d);
    }
  }), ee = Bi({
    root: () => k || e,
    onChange: (d) => {
      var y;
      (d.source === "user" || d.source === "api") && d.action !== "fit" && oe.markUserInteraction(), (y = t.onEvent) === null || y === void 0 || y.call(t, { type: "view-state-change", payload: d });
    }
  }), c = gi({
    root: () => k || e,
    searchTarget: S,
    searchOptions: () => r.search,
    getAiOptions: () => r.ai,
    onSearchChange: (d) => {
      var y;
      (y = t.onEvent) === null || y === void 0 || y.call(t, { type: "search-change", payload: d });
    },
    onLocationChange: (d) => {
      var y;
      (y = t.onEvent) === null || y === void 0 || y.call(t, { type: "location-change", payload: d });
    }
  });
  z.observe(), ee.observe(), oe.observe();
  const C = async (d = "replace") => {
    var y;
    const L = g.session, H = h;
    if (!p && !L && !H)
      return;
    const N = p, Z = Date.now(), T = f.getCurrentVersion();
    N && await Le(r, t.onEvent, "unload-start", N, T, Z, d), await ((y = L?.destroy) === null || y === void 0 ? void 0 : y.call(L)), A(H || void 0), p = null, k = null, Se(g, {
      session: null,
      exportAdapter: null,
      thumbnailAdapter: null
    }), u(), await c.clearDocumentState(), z.clearProvider(), ee.clearProvider(), oe.resetAutoFit(), le(), N && await Le(r, t.onEvent, "unload-complete", N, T, Z, d);
  }, M = {
    container: e,
    async prepare() {
      await J();
    },
    async load(d, y = {}) {
      const L = f.requestController.createVersion(), H = f.requestController.createAbortController(), N = ja(H, [
        t.signal,
        y.signal
      ]);
      if (await C("replace"), await J(), !f.isCurrentRequest(L))
        return null;
      const Z = Ct(d);
      p = Z;
      const T = o.getByExtension(Z.extension), be = Date.now();
      await Le(r, t.onEvent, "load-start", Z, L, be);
      const me = U(T?.id !== "office-presentation" && T?.id !== "office-presentation-binary"), ve = me.container, Re = me.host || ve;
      if (k = ve, !T?.load)
        return $a(ve, Z.extension, r), Se(g, { session: null }), X(), le(), await Le(r, t.onEvent, "load-complete", Z, L, be), null;
      let O;
      try {
        O = await T.load({
          source: Z,
          surface: me,
          options: r,
          signal: N,
          registerExportAdapter: (V) => {
            f.isCurrentRequest(L) && Se(g, { exportAdapter: V });
          },
          registerThumbnailAdapter: (V) => {
            f.isCurrentRequest(L) && Se(g, { thumbnailAdapter: V });
          },
          renderContext: {
            renderPurpose: t.renderPurpose || "preview"
          }
        });
      } catch (V) {
        if (!f.isCurrentRequest(L))
          return A(Re), null;
        throw A(Re), V;
      }
      return f.isCurrentRequest(L) ? (Se(g, { session: O }), X(), z.refreshProvider(), ee.refreshProvider(), await c.refreshDocumentIndex({ notify: !1 }), await oe.applyInitialFit({
        skip: zi(r.initialViewState)
      }), z.refreshProvider(), ee.refreshProvider(), le(), await Le(r, t.onEvent, "load-complete", Z, L, be), O) : (await q(O, Re), null);
    },
    async unload(d = "replace") {
      f.requestController.createVersion(), await C(d);
    },
    async destroy(d = "component-unmount") {
      f.requestController.createVersion(), await C(d), c.destroyDocumentFeatures(), z.destroy(), ee.destroy(), oe.destroy(), u();
    },
    updateOptions(d) {
      const y = r.fit;
      r = {
        ...r,
        ...d
      }, kt(h, r), X(), "fit" in d && d.fit !== y && (oe.resetAutoFit(), oe.scheduleFit("resize"));
    },
    getCapabilities(d) {
      return G(d);
    },
    getRenderer(d) {
      return o.getByExtension(d || p?.extension || "");
    },
    getSource() {
      return p;
    },
    registerExportAdapter(d) {
      Se(g, { exportAdapter: d });
    },
    getExportAdapter() {
      return g.exportAdapter;
    },
    registerThumbnailAdapter(d) {
      Se(g, { thumbnailAdapter: d });
    },
    getThumbnailAdapter() {
      return g.thumbnailAdapter;
    },
    async download(d = {}) {
      const y = hn(p);
      await yn({
        source: y,
        filename: d.filename || Ee({
          source: y,
          fallback: Mr
        }),
        beforeOperation: B
      });
    },
    async exportHtml(d = {}) {
      return xn({
        source: e,
        adapter: g.exportAdapter,
        download: d.download,
        filename: d.filename || Ee({
          filename: Ke(p),
          fallback: at
        }),
        title: d.title || Ee({
          filename: Ke(p),
          fallback: ot
        }),
        watermarkInlineStyle: pe(d.watermarkInlineStyle),
        beforeOperation: B
      });
    },
    async print(d = {}) {
      await Sn({
        source: e,
        adapter: g.exportAdapter,
        autoPrint: d.autoPrint,
        openWindow: d.openWindow,
        printWindow: d.printWindow,
        title: d.title || Ee({
          filename: Ke(p),
          fallback: ot
        }),
        watermarkInlineStyle: pe(d.watermarkInlineStyle),
        mask: d.mask,
        printAvailable: G().print,
        beforeOperation: B
      });
    },
    async printWithMask(d = {}) {
      var y, L, H, N, Z;
      const T = await Na({
        root: e,
        pages: (L = (y = g.exportAdapter) === null || y === void 0 ? void 0 : y.getPrintMaskPages) === null || L === void 0 ? void 0 : L.call(y),
        i18n: r,
        color: (H = d.mask) === null || H === void 0 ? void 0 : H.color,
        initialRegions: (N = d.mask) === null || N === void 0 ? void 0 : N.regions,
        initialStamps: (Z = d.mask) === null || Z === void 0 ? void 0 : Z.stamps
      });
      T?.mask && await M.print({
        ...d,
        mask: T.mask
      });
    },
    async zoomIn() {
      oe.markUserInteraction();
      const d = await z.zoomIn();
      return le(d), d;
    },
    async zoomOut() {
      oe.markUserInteraction();
      const d = await z.zoomOut();
      return le(d), d;
    },
    async resetZoom() {
      oe.markUserInteraction();
      const d = await z.resetZoom();
      return le(d), d;
    },
    async fitToView(d) {
      const y = await oe.fit(d, { source: "api", reason: "api" });
      return z.refreshProvider(), ee.refreshProvider(), le(), y;
    },
    getZoomState() {
      return z.getState();
    },
    getViewState() {
      return ee.getState();
    },
    applyViewState(d, y) {
      return oe.markUserInteraction(), ee.applyState(d, y);
    },
    search(d) {
      return c.searchDocument(d);
    },
    nextSearchResult() {
      return c.nextSearchResult();
    },
    previousSearchResult() {
      return c.previousSearchResult();
    },
    clearSearch() {
      return c.clearDocumentSearch();
    },
    getSearchState() {
      return c.getSearchState();
    },
    collectDocumentAnchors() {
      return c.collectDocumentAnchors({ notify: !1 });
    },
    getCurrentDocumentAnchor() {
      return c.getCurrentDocumentAnchor();
    },
    scrollToDocumentAnchor(d) {
      return c.scrollToLoadedAnchor(d);
    },
    scrollToLine(d) {
      return c.scrollToLine(d);
    },
    getDocumentTextChunks(d) {
      return c.getDocumentTextChunks(d);
    }
  };
  return M;
}, Ga = () => typeof window < "u" && typeof document < "u", mt = (e = {}) => !!(e.url || e.file || e.buffer), ft = (e = {}) => ({
  url: e.url,
  file: e.file,
  buffer: e.buffer,
  filename: e.filename || e.name,
  name: e.name,
  type: e.type,
  size: e.size
}), qa = () => typeof fetch == "function", Xa = async ({ url: e, signal: t }) => {
  if (!qa())
    throw new Error("fetch is not available in the current environment.");
  const r = ma(e) || e, o = await fetch(r, { signal: t });
  if (!o.ok)
    throw new Error(`Failed to fetch file: ${o.status} ${o.statusText}`);
  return o.blob();
}, Jr = (e) => ke(e.filename || e.name || Io({
  file: e.file,
  url: e.url,
  fallback: ye
}), e.type ? `preview.${e.type}` : ye), Ka = async (e, t = {}) => {
  var r, o, i;
  const n = Jr(e), a = e.type || _e(n);
  if (e.buffer)
    return {
      buffer: e.buffer,
      filename: n,
      type: a,
      size: (r = e.size) !== null && r !== void 0 ? r : e.buffer.byteLength,
      url: e.url
    };
  if (e.file) {
    const l = Mt(e.file, n);
    return {
      file: l,
      buffer: await Ot(l),
      filename: l.name || n,
      type: a || _e(l.name),
      size: (o = e.size) !== null && o !== void 0 ? o : l.size,
      url: e.url
    };
  }
  if (e.url) {
    const l = await (t.fetchFile || Xa)({
      url: e.url,
      signal: t.signal,
      source: e
    });
    if (!l)
      throw new Error("Downloaded file is empty.");
    const s = Mt(l, n);
    return {
      file: s,
      buffer: await Ot(s),
      filename: s.name || n,
      type: a || _e(s.name),
      size: (i = e.size) !== null && i !== void 0 ? i : s.size,
      url: e.url
    };
  }
  return {
    filename: n,
    type: a
  };
}, Ya = (e, t) => ({
  load(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.load(r)) !== null && i !== void 0 ? i : Promise.resolve();
  },
  update(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.update(r)) !== null && i !== void 0 ? i : Promise.resolve();
  },
  reload() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.reload()) !== null && o !== void 0 ? o : Promise.resolve();
  },
  destroy() {
    t();
  },
  getController: e,
  getApi() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getApi()) !== null && o !== void 0 ? o : null;
  },
  downloadOriginalFile() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.downloadOriginalFile()) !== null && o !== void 0 ? o : Promise.resolve();
  },
  printRenderedHtml(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.printRenderedHtml(r)) !== null && i !== void 0 ? i : Promise.resolve();
  },
  printWithMask(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.printWithMask(r)) !== null && i !== void 0 ? i : Promise.resolve();
  },
  exportRenderedHtml() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.exportRenderedHtml()) !== null && o !== void 0 ? o : Promise.resolve();
  },
  zoomIn() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.zoomIn()) !== null && o !== void 0 ? o : Promise.resolve(null);
  },
  zoomOut() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.zoomOut()) !== null && o !== void 0 ? o : Promise.resolve(null);
  },
  resetZoom() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.resetZoom()) !== null && o !== void 0 ? o : Promise.resolve(null);
  },
  fitToView(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.fitToView(r)) !== null && i !== void 0 ? i : Promise.resolve(null);
  },
  getViewState() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getViewState()) !== null && o !== void 0 ? o : null;
  },
  applyViewState(r, o) {
    var i, n;
    return (n = (i = e()) === null || i === void 0 ? void 0 : i.applyViewState(r, o)) !== null && n !== void 0 ? n : Promise.resolve(null);
  },
  searchDocument(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.searchDocument(r)) !== null && i !== void 0 ? i : Promise.resolve(null);
  },
  clearDocumentSearch() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.clearDocumentSearch()) !== null && o !== void 0 ? o : Promise.resolve(null);
  },
  nextSearchResult() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.nextSearchResult()) !== null && o !== void 0 ? o : Promise.resolve(null);
  },
  previousSearchResult() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.previousSearchResult()) !== null && o !== void 0 ? o : Promise.resolve(null);
  },
  collectDocumentAnchors() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.collectDocumentAnchors()) !== null && o !== void 0 ? o : Promise.resolve([]);
  },
  scrollToAnchor(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.scrollToAnchor(r)) !== null && i !== void 0 ? i : Promise.resolve(!1);
  },
  scrollToLine(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.scrollToLine(r)) !== null && i !== void 0 ? i : Promise.resolve(!1);
  },
  getDocumentTextChunks() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getDocumentTextChunks()) !== null && o !== void 0 ? o : [];
  },
  getOperationAvailability() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getOperationAvailability()) !== null && o !== void 0 ? o : null;
  },
  getZoomState() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getZoomState()) !== null && o !== void 0 ? o : null;
  },
  getSearchState() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getSearchState()) !== null && o !== void 0 ? o : null;
  },
  getState() {
    var r, o;
    return (o = (r = e()) === null || r === void 0 ? void 0 : r.getState()) !== null && o !== void 0 ? o : null;
  },
  subscribe(r) {
    var o, i;
    return (i = (o = e()) === null || o === void 0 ? void 0 : o.subscribe(r)) !== null && i !== void 0 ? i : (() => {
    });
  }
}), re = async (e, t, r) => e ? t(e) : r, Ja = (e) => !!(e && typeof e == "object" && e.name === "AbortError"), Qa = {
  download: !1,
  print: !1,
  exportHtml: !1,
  zoom: !1,
  zoomIn: !1,
  zoomOut: !1,
  zoomReset: !1
}, el = {
  scale: 1,
  label: "100%",
  canZoomIn: !1,
  canZoomOut: !1,
  canReset: !1
}, cr = /* @__PURE__ */ new WeakMap(), tl = `
:host,.file-viewer-web-shell{display:block;width:100%;height:100%;min-width:0;min-height:0;contain:content;--file-viewer-bg:transparent;--file-viewer-content-bg:transparent;--file-viewer-text:#172033;--file-viewer-muted:#607282;--file-viewer-font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--file-viewer-border:rgba(20,35,53,.08);--file-viewer-toolbar-bg:rgba(255,255,255,.92);--file-viewer-toolbar-border:rgba(20,35,53,.06);--file-viewer-toolbar-shadow:0 18px 44px rgba(15,23,42,.16);--file-viewer-toolbar-radius:999px;--file-viewer-toolbar-gap:6px;--file-viewer-toolbar-min-height:45px;--file-viewer-toolbar-padding:6px 10px;--file-viewer-toolbar-floating-min-height:42px;--file-viewer-toolbar-floating-padding:6px;--file-viewer-toolbar-floating-offset:16px;--file-viewer-group-bg:rgba(20,35,53,.035);--file-viewer-group-border:rgba(20,35,53,.08);--file-viewer-group-gap:2px;--file-viewer-group-padding:2px;--file-viewer-button-color:#40546a;--file-viewer-button-hover-bg:rgba(33,163,102,.1);--file-viewer-button-hover-color:#16774c;--file-viewer-button-disabled-color:#aab5c0;--file-viewer-button-radius:8px;--file-viewer-button-min-width:42px;--file-viewer-button-height:30px;--file-viewer-button-padding:0 10px;--file-viewer-icon-button-size:30px;--file-viewer-zoom-meter-min-width:48px;--file-viewer-zoom-meter-padding:0 8px;--file-viewer-floating-button-min-width:48px;--file-viewer-floating-button-height:32px;--file-viewer-floating-icon-button-size:32px;--file-viewer-floating-zoom-meter-min-width:54px;--file-viewer-search-input-height:30px;--file-viewer-search-input-padding:0 10px;--file-viewer-search-button-min-width:32px;--file-viewer-search-button-padding:0 8px;--file-viewer-search-count-min-width:42px;--file-viewer-floating-search-input-height:32px;--file-viewer-focus-ring:rgba(31,157,103,.22);--file-viewer-z-toolbar:20;--file-viewer-z-floating-toolbar:30}
:host([theme='dark']),.file-viewer-web-shell[data-viewer-theme='dark']{--file-viewer-bg:#0f1720;--file-viewer-content-bg:#111b24;--file-viewer-text:#e5eef8;--file-viewer-muted:#cbd5e1;--file-viewer-border:rgba(148,163,184,.18);--file-viewer-toolbar-bg:rgba(15,23,42,.9);--file-viewer-toolbar-border:rgba(148,163,184,.18);--file-viewer-group-bg:rgba(148,163,184,.1);--file-viewer-group-border:rgba(148,163,184,.16);--file-viewer-button-color:#d7dee8;--file-viewer-button-hover-bg:rgba(45,212,191,.14);--file-viewer-button-hover-color:#5eead4;--file-viewer-button-disabled-color:#64748b;--file-viewer-input-bg:rgba(15,23,42,.78);--file-viewer-input-color:#f8fafc}
.file-viewer-web-shell,.file-viewer-web-shell *,.file-viewer-web-shell *::before,.file-viewer-web-shell *::after{box-sizing:border-box}
.file-viewer-web-shell{position:relative;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--file-viewer-render-surface-background,var(--file-viewer-bg));color:var(--file-viewer-text);font:var(--file-viewer-font);letter-spacing:0;box-sizing:border-box;contain:content}
.file-viewer-web-shell[data-viewer-density="compact"]{--file-viewer-toolbar-gap:3px;--file-viewer-toolbar-min-height:34px;--file-viewer-toolbar-padding:3px 5px;--file-viewer-toolbar-floating-min-height:32px;--file-viewer-toolbar-floating-padding:3px;--file-viewer-toolbar-floating-offset:10px;--file-viewer-group-gap:2px;--file-viewer-group-padding:2px;--file-viewer-button-radius:6px;--file-viewer-button-min-width:34px;--file-viewer-button-height:26px;--file-viewer-button-padding:0 6px;--file-viewer-icon-button-size:26px;--file-viewer-zoom-meter-min-width:42px;--file-viewer-zoom-meter-padding:0 5px;--file-viewer-floating-button-min-width:38px;--file-viewer-floating-button-height:28px;--file-viewer-floating-icon-button-size:28px;--file-viewer-floating-zoom-meter-min-width:46px;--file-viewer-search-input-height:26px;--file-viewer-search-input-padding:0 8px;--file-viewer-search-button-min-width:28px;--file-viewer-search-button-padding:0 6px;--file-viewer-search-count-min-width:36px;--file-viewer-floating-search-input-height:28px}
.file-viewer-web-content{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;background:var(--file-viewer-render-surface-background,var(--file-viewer-content-bg))}
.file-viewer-web-toolbar{flex:0 0 auto;min-height:var(--file-viewer-toolbar-min-height);display:inline-flex;align-items:center;justify-content:flex-end;gap:var(--file-viewer-toolbar-gap);padding:var(--file-viewer-toolbar-padding);border-bottom:1px solid var(--file-viewer-toolbar-border);background:var(--file-viewer-toolbar-bg);box-sizing:border-box;z-index:var(--file-viewer-z-toolbar)}
.file-viewer-web-toolbar[hidden]{display:none!important}
.file-viewer-web-toolbar[data-toolbar-position="top-center"]{justify-content:center}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"]{position:absolute;right:calc(var(--file-viewer-toolbar-floating-offset) + env(safe-area-inset-right,0px));bottom:calc(var(--file-viewer-toolbar-floating-offset) + env(safe-area-inset-bottom,0px));min-height:var(--file-viewer-toolbar-floating-min-height);padding:var(--file-viewer-toolbar-floating-padding);border:1px solid var(--file-viewer-border);border-radius:var(--file-viewer-toolbar-radius);background:var(--file-viewer-toolbar-bg);box-shadow:var(--file-viewer-toolbar-shadow);backdrop-filter:blur(16px);z-index:var(--file-viewer-z-floating-toolbar)}
.file-viewer-web-toolbar-group{display:inline-flex;align-items:center;gap:var(--file-viewer-group-gap);padding:var(--file-viewer-group-padding);border:1px solid var(--file-viewer-group-border);border-radius:var(--file-viewer-toolbar-radius);background:var(--file-viewer-group-bg)}
.file-viewer-web-toolbar button{min-width:var(--file-viewer-button-min-width);height:var(--file-viewer-button-height);padding:var(--file-viewer-button-padding);border:0;border-radius:var(--file-viewer-button-radius);background:transparent;color:var(--file-viewer-button-color);font:inherit;font-size:12px;font-weight:800;line-height:1;letter-spacing:0;white-space:nowrap;cursor:pointer}
.file-viewer-web-toolbar button:hover:not(:disabled){background:var(--file-viewer-button-hover-bg);color:var(--file-viewer-button-hover-color)}
.file-viewer-web-toolbar button:disabled{color:var(--file-viewer-button-disabled-color);cursor:not-allowed}
.file-viewer-web-toolbar .file-viewer-web-icon-button{width:var(--file-viewer-icon-button-size);min-width:var(--file-viewer-icon-button-size);padding:0;display:inline-flex;align-items:center;justify-content:center}
.file-viewer-web-theme-button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.file-viewer-web-toolbar .file-viewer-web-zoom-meter{min-width:var(--file-viewer-zoom-meter-min-width);height:var(--file-viewer-button-height);padding:var(--file-viewer-zoom-meter-padding);display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;color:var(--file-viewer-button-color)}
.file-viewer-web-toolbar .file-viewer-web-zoom-meter--readonly{font-size:12px;font-weight:800;line-height:1;white-space:nowrap}
.file-viewer-web-print-menu{position:relative;display:inline-flex}
.file-viewer-web-print-menu > button{min-width:var(--file-viewer-button-min-width);height:var(--file-viewer-button-height);padding:var(--file-viewer-button-padding);border:0;border-radius:var(--file-viewer-button-radius);background:transparent;color:var(--file-viewer-button-color);font:inherit;font-size:12px;font-weight:800;line-height:1;letter-spacing:0;white-space:nowrap;cursor:pointer}
.file-viewer-web-print-menu > button:hover:not(:disabled){background:var(--file-viewer-button-hover-bg);color:var(--file-viewer-button-hover-color)}
.file-viewer-web-print-menu > button:disabled{color:var(--file-viewer-button-disabled-color);cursor:not-allowed}
.file-viewer-web-print-menu-panel{position:absolute;top:calc(100% + 4px);right:0;z-index:40;min-width:118px;padding:4px;border:1px solid var(--file-viewer-group-border);border-radius:10px;background:var(--file-viewer-toolbar-bg);box-shadow:var(--file-viewer-toolbar-shadow);display:none;flex-direction:column;gap:2px}
.file-viewer-web-print-menu[data-open="true"] .file-viewer-web-print-menu-panel{display:flex}
.file-viewer-web-print-menu-panel button{width:100%;min-width:0;justify-content:flex-start;text-align:left;border-radius:8px}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-print-menu-panel{top:auto;bottom:calc(100% + 6px);z-index:50}
.file-viewer-web-search{gap:4px}
.file-viewer-web-search input{width:clamp(128px,18vw,220px);height:var(--file-viewer-search-input-height);box-sizing:border-box;border:0;border-radius:var(--file-viewer-toolbar-radius);padding:var(--file-viewer-search-input-padding);background:var(--file-viewer-input-bg);color:var(--file-viewer-input-color);font:inherit;font-size:12px;line-height:var(--file-viewer-search-input-height);letter-spacing:0;outline:0}
.file-viewer-web-search input:focus{box-shadow:0 0 0 2px var(--file-viewer-focus-ring)}
.file-viewer-web-search button{min-width:var(--file-viewer-search-button-min-width);height:var(--file-viewer-search-input-height);padding:var(--file-viewer-search-button-padding);border-radius:999px}
.file-viewer-web-search-count{min-width:var(--file-viewer-search-count-min-width);text-align:center;color:var(--file-viewer-muted);font-size:12px;font-weight:800;line-height:var(--file-viewer-search-input-height);white-space:nowrap}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] button{min-width:var(--file-viewer-floating-button-min-width);height:var(--file-viewer-floating-button-height);border-radius:999px}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-icon-button{width:var(--file-viewer-floating-icon-button-size);min-width:var(--file-viewer-floating-icon-button-size)}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-zoom-meter{min-width:var(--file-viewer-floating-zoom-meter-min-width);height:var(--file-viewer-floating-button-height)}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-search button{min-width:var(--file-viewer-search-button-min-width);height:var(--file-viewer-floating-search-input-height)}
.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-search input{height:var(--file-viewer-floating-search-input-height);line-height:var(--file-viewer-floating-search-input-height);width:clamp(120px,18vw,190px)}
.file-viewer-web-shell[data-viewer-theme='dark']{color-scheme:dark;--file-viewer-bg:#0f1720;--file-viewer-content-bg:#111b24;--file-viewer-text:#e5eef8;--file-viewer-muted:#cbd5e1;--file-viewer-border:rgba(148,163,184,.18);--file-viewer-toolbar-bg:rgba(15,23,42,.9);--file-viewer-toolbar-border:rgba(148,163,184,.18);--file-viewer-group-bg:rgba(148,163,184,.1);--file-viewer-group-border:rgba(148,163,184,.16);--file-viewer-button-color:#d7dee8;--file-viewer-button-hover-bg:rgba(45,212,191,.14);--file-viewer-button-hover-color:#5eead4;--file-viewer-button-disabled-color:#64748b;--file-viewer-input-bg:rgba(15,23,42,.78);--file-viewer-input-color:#f8fafc}
@media (prefers-color-scheme:dark){.file-viewer-web-shell[data-viewer-theme='system']{color-scheme:dark;--file-viewer-bg:#0f1720;--file-viewer-content-bg:#111b24;--file-viewer-text:#e5eef8;--file-viewer-muted:#cbd5e1;--file-viewer-border:rgba(148,163,184,.18);--file-viewer-toolbar-bg:rgba(15,23,42,.9);--file-viewer-toolbar-border:rgba(148,163,184,.18);--file-viewer-group-bg:rgba(148,163,184,.1);--file-viewer-group-border:rgba(148,163,184,.16);--file-viewer-button-color:#d7dee8;--file-viewer-button-hover-bg:rgba(45,212,191,.14);--file-viewer-button-hover-color:#5eead4;--file-viewer-button-disabled-color:#64748b;--file-viewer-input-bg:rgba(15,23,42,.78);--file-viewer-input-color:#f8fafc}}
@media (max-width:640px){.file-viewer-web-toolbar{max-width:100%;overflow-x:auto;overflow-y:visible}.file-viewer-web-toolbar[data-toolbar-position="bottom-right"]{max-width:calc(100% - 32px);overflow:visible}.file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-print-menu-panel{left:50%;right:auto;transform:translateX(-50%);min-width:min(148px,calc(100vw - 32px))}.file-viewer-web-search input{width:120px}}
`, ue = (e, ...t) => {
  const r = e.part;
  if (r?.add) {
    r.add(...t);
    return;
  }
  const o = /* @__PURE__ */ new Set([
    ...(e.getAttribute("part") || "").split(/\s+/).filter(Boolean),
    ...t
  ]);
  e.setAttribute("part", [...o].join(" "));
}, ce = (e, t, r, o) => {
  const i = e.createElement("button");
  return i.type = "button", i.className = r, ue(i, "button"), i.textContent = t, i.title = t, i.setAttribute("aria-label", t), i.addEventListener("click", () => {
    o();
  }), i;
}, rl = (e, t, r) => {
  const o = e.createElement("span");
  return o.className = `${r} file-viewer-web-zoom-meter--readonly`, ue(o, "button"), o.textContent = t, o.title = t, o.setAttribute("aria-label", t), o;
}, ol = (e, t) => {
  e.innerHTML = t === "dark" ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>';
}, il = (e, t = {}, r = {}) => {
  var o, i, n, a, l;
  if (!Ga())
    throw new Error("Flyfish File Viewer can only be mounted in a browser DOM environment.");
  const s = e.ownerDocument, m = Zr((o = t.options) === null || o === void 0 ? void 0 : o.styleIsolation), w = m === "auto" || m === "shadow", p = e.shadowRoot, h = cr.get(e), k = !!(p && h === p), g = typeof e.attachShadow == "function" && !e.shadowRoot;
  let f = null, S = e;
  if (w && k && p)
    S = p;
  else if (w && g)
    try {
      S = e.attachShadow({ mode: "open", delegatesFocus: !0 }), cr.set(e, S);
    } catch {
      S = e;
    }
  else if (p && !k)
    if (f = s.createElement("div"), f.dataset.fileViewerMountBoundary = "true", p.appendChild(f), w && typeof f.attachShadow == "function")
      try {
        S = f.attachShadow({ mode: "open", delegatesFocus: !0 });
      } catch {
        S = f;
      }
    else
      S = f;
  else if (!w && k && p) {
    const c = s.createElement("slot");
    c.dataset.fileViewerLightDomSlot = "true", p.replaceChildren(c), S = e;
  }
  S.replaceChildren();
  const P = Fa(S, tl, {
    // Adopt only into a root owned by the viewer. Adopting into an ancestor
    // ShadowRoot would leak toolbar selectors and apply :host rules to the
    // customer's custom element.
    adoptedStyleSheet: Te(S)
  }), F = s.createElement("div");
  F.className = "file-viewer-web-shell", ue(F, "shell");
  const D = s.createElement("div");
  D.className = "file-viewer-web-toolbar", ue(D, "toolbar");
  const R = s.createElement("div");
  R.className = "file-viewer-web-content", ue(R, "content"), R.dataset.viewerScrollContainer = "true", F.append(D, R), S.appendChild(F);
  let b = !1, x = t;
  const I = (a = (n = (i = s.defaultView) === null || i === void 0 ? void 0 : i.matchMedia) === null || n === void 0 ? void 0 : n.call(i, "(prefers-color-scheme: dark)")) !== null && a !== void 0 ? a : null, $ = (c) => I ? At(c, I.matches) : At(c);
  let W = mt(x) ? ft(x) : null, v = null;
  const E = /* @__PURE__ */ new Set(), u = {
    loading: !1,
    ready: !1,
    error: null,
    lastEvent: null,
    lifecycle: null,
    availability: null,
    search: null,
    zoom: null,
    location: null,
    viewState: null
  }, A = () => {
    var c;
    return !((c = u.lifecycle) === null || c === void 0) && c.type ? u.lifecycle.type : W ? _e(Jr(W)) : "";
  }, U = () => u.zoom || z.getZoomState() || el, q = () => Ft(u.availability || z.getCapabilities() || Qa, U()), X = () => ({
    ...u,
    availability: q(),
    search: u.search ? { ...u.search, matches: [...u.search.matches] } : null,
    zoom: u.zoom ? { ...u.zoom } : null,
    location: u.location ? { ...u.location } : null,
    viewState: u.viewState ? {
      ...u.viewState,
      zoom: u.viewState.zoom ? { ...u.viewState.zoom } : void 0,
      scroll: u.viewState.scroll ? { ...u.viewState.scroll } : void 0,
      navigation: u.viewState.navigation ? { ...u.viewState.navigation } : void 0,
      extra: u.viewState.extra ? { ...u.viewState.extra } : void 0
    } : null
  }), J = () => {
    var c, C, M;
    F.dataset.viewerTheme = Rt((c = x.options) === null || c === void 0 ? void 0 : c.theme), F.dataset.viewerDensity = Oa((M = (C = x.options) === null || C === void 0 ? void 0 : C.ui) === null || M === void 0 ? void 0 : M.density), kt(F, x.options);
  };
  let _ = null, B = "";
  const pe = (c, C) => {
    var M;
    if (c.search === !1 || C.search === !1 || !u.ready || u.loading || u.error || R.querySelector(".file-viewer-missing-renderer"))
      return !1;
    const d = z.getRenderer(A());
    return !!(!((M = d?.capabilities) === null || M === void 0) && M.search);
  }, G = () => {
    if (b)
      return;
    J();
    const c = x.options || {}, C = Zn(c), M = q(), d = pe(C, c), y = Gn(C, M, d), L = qn(y), H = Xn(c, A()), N = u.loading || !!u.error, Z = U(), T = mn(c);
    if (D.hidden = !L, D.dataset.toolbarPosition = H, D.replaceChildren(), !L)
      return;
    const be = () => {
      var O, V;
      if (!d)
        return;
      const j = u.search, ie = (O = j?.total) !== null && O !== void 0 ? O : 0, de = ie > 0 ? ((V = j?.currentIndex) !== null && V !== void 0 ? V : -1) + 1 : 0, te = s.createElement("form");
      te.className = "file-viewer-web-toolbar-group file-viewer-web-search", ue(te, "toolbar-group"), te.setAttribute("role", "search"), te.setAttribute("aria-label", T("toolbar.search"));
      const Y = s.createElement("input");
      Y.type = "search", ue(Y, "input"), Y.value = B, Y.placeholder = T("toolbar.searchPlaceholder"), Y.title = T("toolbar.searchPlaceholder"), Y.setAttribute("aria-label", T("toolbar.searchPlaceholder")), Y.disabled = N, Y.addEventListener("input", () => {
        B = Y.value;
      });
      const we = s.createElement("button");
      we.type = "submit", ue(we, "button"), we.textContent = T("toolbar.search"), we.title = T("toolbar.search"), we.setAttribute("aria-label", T("toolbar.search")), we.disabled = N;
      const xe = ce(s, "<", "file-viewer-web-icon-button", () => _?.previousSearchResult());
      xe.title = T("toolbar.searchPrevious"), xe.setAttribute("aria-label", T("toolbar.searchPrevious")), xe.disabled = N || ie < 1;
      const Ne = ce(s, ">", "file-viewer-web-icon-button", () => _?.nextSearchResult());
      Ne.title = T("toolbar.searchNext"), Ne.setAttribute("aria-label", T("toolbar.searchNext")), Ne.disabled = N || ie < 1;
      const je = ce(s, "x", "file-viewer-web-icon-button", async () => {
        B = "", await _?.clearDocumentSearch();
      });
      je.title = T("toolbar.searchClear"), je.setAttribute("aria-label", T("toolbar.searchClear")), je.disabled = N || !B && !j?.query;
      const Pe = s.createElement("span");
      Pe.className = "file-viewer-web-search-count", ue(Pe, "toolbar-status"), Pe.textContent = `${de}/${ie}`, Pe.setAttribute("aria-live", "polite"), te.addEventListener("submit", (uo) => {
        uo.preventDefault(), B = Y.value;
        const Lt = B.trim();
        Lt ? _?.searchDocument(Lt) : _?.clearDocumentSearch();
      }), te.append(Y, we, xe, Ne, je, Pe), D.appendChild(te);
    }, me = () => {
      if (!y.zoom)
        return;
      const O = s.createElement("div");
      if (O.className = "file-viewer-web-toolbar-group", ue(O, "toolbar-group"), O.setAttribute("aria-label", T("toolbar.zoomGroup")), M.zoomOut) {
        const V = ce(s, "-", "file-viewer-web-icon-button", () => _?.zoomOut());
        V.title = T("toolbar.zoomOut"), V.setAttribute("aria-label", T("toolbar.zoomOut")), V.disabled = Ge({
          action: "canZoomOut",
          availability: M,
          toolbarDisabled: N,
          zoomState: Z
        }), O.appendChild(V);
      }
      if (M.zoomReset) {
        const V = ce(s, Z.label, "file-viewer-web-zoom-meter", () => _?.resetZoom());
        V.title = T("toolbar.zoomReset"), V.disabled = Ge({
          action: "canReset",
          availability: M,
          toolbarDisabled: N,
          zoomState: Z
        }), O.appendChild(V);
      } else
        O.appendChild(rl(s, Z.label, "file-viewer-web-zoom-meter"));
      if (M.zoomReset) {
        const V = ce(s, "1:1", "file-viewer-web-icon-button", () => _?.resetZoom());
        V.title = T("toolbar.zoomReset"), V.setAttribute("aria-label", T("toolbar.zoomReset")), V.disabled = Ge({
          action: "canReset",
          availability: M,
          toolbarDisabled: N,
          zoomState: Z
        }), O.appendChild(V);
      }
      if (M.zoomIn) {
        const V = ce(s, "+", "file-viewer-web-icon-button", () => _?.zoomIn());
        V.title = T("toolbar.zoomIn"), V.setAttribute("aria-label", T("toolbar.zoomIn")), V.disabled = Ge({
          action: "canZoomIn",
          availability: M,
          toolbarDisabled: N,
          zoomState: Z
        }), O.appendChild(V);
      }
      O.childElementCount && D.appendChild(O);
    }, ve = (O, V, j, ie) => {
      if (!O)
        return;
      const de = ce(s, V, "", ie);
      de.title = j, de.disabled = N, D.appendChild(de);
    }, Re = () => {
      if (!y.theme)
        return;
      const O = $(c.theme), V = T(O === "dark" ? "toolbar.themeToLight" : "toolbar.themeToDark"), j = ce(s, "", "file-viewer-web-icon-button file-viewer-web-theme-button", async () => {
        var ie;
        const de = z.getViewState(), te = Ma((ie = x.options) === null || ie === void 0 ? void 0 : ie.theme, I?.matches);
        x = {
          ...x,
          options: {
            ...x.options || {},
            theme: te
          }
        }, z.updateOptions({ theme: te }), He({ type: "theme-change", payload: te }), W && await ee(W).catch(() => null) && de && await z.applyViewState(de, {
          action: "restore",
          source: "api"
        });
      });
      ue(j, "theme-toggle"), ol(j, O), j.title = V, j.setAttribute("aria-label", V), j.setAttribute("aria-pressed", String(O === "dark")), j.disabled = N, D.appendChild(j);
    };
    Je(C).forEach((O) => {
      if (O === "search")
        be();
      else if (O === "zoom")
        me();
      else if (O === "download")
        ve(y.download, T("toolbar.download"), T("toolbar.downloadTitle"), () => _?.downloadOriginalFile());
      else if (O === "print") {
        if (!y.print)
          return;
        const V = s.createElement("div");
        V.className = "file-viewer-web-print-menu", ue(V, "toolbar-group");
        const j = ce(s, T("toolbar.print"), "", () => {
          V.dataset.open = V.dataset.open === "true" ? "false" : "true";
        });
        j.title = T("toolbar.printTitle"), j.setAttribute("aria-label", T("toolbar.printTitle")), j.setAttribute("aria-haspopup", "menu"), j.disabled = N;
        const ie = s.createElement("div");
        ie.className = "file-viewer-web-print-menu-panel", ie.setAttribute("role", "menu");
        const de = () => {
          V.dataset.open = "false";
        }, te = ce(s, T("toolbar.printDirect"), "", async () => {
          de(), await _?.printRenderedHtml();
        });
        te.title = T("toolbar.printTitle"), te.setAttribute("role", "menuitem"), te.disabled = N;
        const Y = ce(s, T("toolbar.printMask"), "", async () => {
          de(), await _?.printWithMask();
        });
        Y.title = T("toolbar.printMaskTitle"), Y.setAttribute("role", "menuitem"), Y.disabled = N, ie.append(te, Y), V.append(j, ie), V.addEventListener("focusout", (we) => {
          const xe = we.relatedTarget;
          (!xe || !V.contains(xe)) && de();
        }), D.appendChild(V);
      } else O === "exportHtml" ? ve(y.exportHtml, T("toolbar.exportHtml"), T("toolbar.exportHtmlTitle"), () => _?.exportRenderedHtml()) : O === "theme" && Re();
    });
  };
  let K = null;
  const Q = () => {
    var c;
    Rt((c = x.options) === null || c === void 0 ? void 0 : c.theme) === "system" && (G(), K?.());
  }, le = (c) => {
    var C;
    const M = X();
    G(), (C = x.onStateChange) === null || C === void 0 || C.call(x, M, c), E.forEach((d) => d(M, c));
  }, He = (c) => {
    var C;
    u.lastEvent = c, c.type === "load-start" ? (u.loading = !0, u.ready = !1, u.error = null, u.lifecycle = c.payload, u.search = null, B = "") : c.type === "load-complete" ? (u.loading = !1, u.ready = !0, u.lifecycle = c.payload) : c.type === "unload-start" ? (u.loading = !0, u.ready = !1, u.lifecycle = c.payload) : c.type === "unload-complete" ? (u.loading = !1, u.ready = !1, u.lifecycle = c.payload) : c.type === "operation-availability-change" ? u.availability = c.payload : c.type === "search-change" ? (u.search = c.payload, B = c.payload.query) : c.type === "location-change" ? u.location = c.payload : c.type === "zoom-change" ? u.zoom = c.payload : c.type === "view-state-change" && (u.viewState = c.payload.state), (C = x.onEvent) === null || C === void 0 || C.call(x, c), le(c);
  }, z = Za(R, {
    registry: r.registry,
    options: x.options,
    onEvent: He
  });
  (l = I?.addEventListener) === null || l === void 0 || l.call(I, "change", Q), G();
  const oe = () => {
    v?.abort(), v = null;
  }, ee = async (c) => {
    var C;
    oe(), W = c, v = typeof AbortController < "u" ? new AbortController() : null;
    const M = v;
    try {
      u.loading = !0, u.error = null, le();
      const d = await Ka(c, {
        fetchFile: r.fetchFile,
        signal: M?.signal
      });
      return b || M?.signal.aborted || v !== M ? null : await z.load(d);
    } catch (d) {
      if (Ja(d) && M?.signal.aborted)
        return null;
      throw u.loading = !1, u.ready = !1, u.error = d, le(), (C = r.onError) === null || C === void 0 || C.call(r, d, c), d;
    } finally {
      v === M && (v = null);
    }
  };
  return K = async () => {
    if (!W)
      return;
    const c = z.getViewState();
    await ee(W).catch(() => null) && c && await z.applyViewState(c, {
      action: "restore",
      source: "api"
    });
  }, W && ee(W), _ = {
    container: e,
    async load(c) {
      b || (x = c, z.updateOptions(x.options || {}), G(), mt(x) && await ee(ft(x)));
    },
    async update(c = {}) {
      var C;
      b || (x = {
        ...x,
        ...c,
        options: (C = c.options) !== null && C !== void 0 ? C : x.options
      }, z.updateOptions(x.options || {}), G(), mt(x) ? await ee(ft(x)) : (W = null, await z.load({ filename: ye })));
    },
    async reload() {
      b || W && await ee(W);
    },
    destroy() {
      var c;
      b || (b = !0, oe(), (c = I?.removeEventListener) === null || c === void 0 || c.call(I, "change", Q), z.destroy("component-unmount"), P.remove(), S.replaceChildren(), f?.remove());
    },
    getApi() {
      return z;
    },
    downloadOriginalFile() {
      return re(z, (c) => c.download(), void 0);
    },
    printRenderedHtml(c) {
      return re(z, (C) => C.print(c), void 0);
    },
    printWithMask(c) {
      return re(z, (C) => C.printWithMask(c), void 0);
    },
    exportRenderedHtml() {
      return re(z, (c) => c.exportHtml({ download: !0 }).then(() => {
      }), void 0);
    },
    zoomIn() {
      return re(z, (c) => c.zoomIn(), null);
    },
    zoomOut() {
      return re(z, (c) => c.zoomOut(), null);
    },
    resetZoom() {
      return re(z, (c) => c.resetZoom(), null);
    },
    fitToView(c) {
      return re(z, (C) => C.fitToView(c), null);
    },
    getViewState() {
      return z.getViewState();
    },
    applyViewState(c, C) {
      return re(z, (M) => M.applyViewState(c, C), null);
    },
    searchDocument(c) {
      return re(z, (C) => C.search(c), null);
    },
    clearDocumentSearch() {
      return re(z, (c) => c.clearSearch(), null);
    },
    nextSearchResult() {
      return re(z, (c) => c.nextSearchResult(), null);
    },
    previousSearchResult() {
      return re(z, (c) => c.previousSearchResult(), null);
    },
    collectDocumentAnchors() {
      return re(z, (c) => c.collectDocumentAnchors(), []);
    },
    scrollToAnchor(c) {
      return re(z, (C) => C.scrollToDocumentAnchor(c), !1);
    },
    scrollToLine(c) {
      return re(z, (C) => C.scrollToLine(c), !1);
    },
    getDocumentTextChunks() {
      return z.getDocumentTextChunks();
    },
    getOperationAvailability() {
      return q();
    },
    getZoomState() {
      return z.getZoomState();
    },
    getSearchState() {
      return z.getSearchState();
    },
    getState() {
      return X();
    },
    subscribe(c) {
      return E.add(c), c(X()), () => {
        E.delete(c);
      };
    }
  }, _;
}, nl = {
  width: "100%",
  height: "100%",
  minHeight: 0
}, al = {
  registry: Ca
}, ur = (e, t) => {
  var r;
  (r = e.current) === null || r === void 0 || r.destroy(), e.current = null, t && (t.innerHTML = "");
}, Qr = po((e, t) => {
  const { url: r, file: o, buffer: i, name: n, filename: a, type: l, size: s, options: m, onEvent: w, onStateChange: p, style: h, ...k } = e, g = Me(null), f = Me(null), S = Me(null), P = hr(() => ({
    url: r,
    file: o,
    buffer: i,
    name: n,
    filename: a,
    type: l,
    size: s,
    options: m,
    onEvent: w,
    onStateChange: p
  }), [r, o, i, n, a, l, s, m, w, p]);
  return vt(() => {
    const F = g.current;
    if (!(!F || f.current))
      return S.current = P, f.current = il(F, P, al), () => {
        S.current = null, ur(f, F);
      };
  }, []), vt(() => {
    var F;
    S.current !== P && (S.current = P, (F = f.current) === null || F === void 0 || F.update(P));
  }, [P]), mo(t, () => Ya(() => f.current, () => ur(f, g.current)), []), Xe("div", { ...k, ref: g, style: { ...nl, ...h } });
});
Qr.displayName = "FileViewer";
const eo = se.find((e) => e.id === "ofd");
if (!eo)
  throw new Error("@file-viewer/renderer-ofd could not locate the core OFD renderer definition.");
const pr = eo, ll = (e, t, r, o) => import("./ofd-DCxtqZk-.js").then(({ default: i }) => i(e, t, o)), sl = {
  id: "file-viewer-renderer-ofd",
  label: "Flyfish File Viewer OFD renderer",
  definitions: [pr],
  handlers: [{
    rendererId: pr.id,
    handler: ll
  }]
}, to = se.find((e) => e.id === "pdf");
if (!to)
  throw new Error("@file-viewer/renderer-pdf could not locate the core PDF renderer definition.");
const mr = to, dl = (e, t, r, o) => import("./pdf-BdvCAhYH.js").then(({ default: i }) => i(e, t, o)), cl = {
  id: "file-viewer-renderer-pdf",
  label: "Flyfish File Viewer PDF renderer",
  definitions: [mr],
  handlers: [{
    rendererId: mr.id,
    handler: dl
  }]
}, ro = se.find((e) => e.id === "office-presentation-binary"), oo = se.find((e) => e.id === "office-presentation");
if (!ro || !oo)
  throw new Error("@file-viewer/renderer-presentation could not locate the core presentation renderer definitions.");
const fr = ro, vr = oo, ul = (e, t, r, o) => import("./ppt-APG0sgT5.js").then(({ default: i }) => i(e, t, r, o)), pl = (e, t, r, o) => import("./pptx-BJrLOlak.js").then(({ default: i }) => i(e, t, r, o)), ml = {
  id: "file-viewer-renderer-presentation",
  label: "Flyfish File Viewer presentation renderer",
  definitions: [fr, vr],
  handlers: [
    {
      rendererId: fr.id,
      handler: ul
    },
    {
      rendererId: vr.id,
      handler: pl
    }
  ]
}, io = se.find((e) => e.id === "spreadsheet-openxml");
if (!io)
  throw new Error("@file-viewer/renderer-spreadsheet could not locate the shared Spreadsheet format definition.");
const wr = io, fl = (e, t, r, o) => import("./spreadsheet-Bchvk7X3.js").then((i) => i.s).then(({ default: i }) => i(e, t, r, o)), vl = {
  id: "file-viewer-renderer-spreadsheet",
  label: "Flyfish File Viewer Spreadsheet renderer",
  definitions: [wr],
  handlers: [{
    rendererId: wr.id,
    handler: fl
  }]
}, no = [
  "office-word-openxml",
  "office-word-binary",
  "open-document"
], ao = se.filter((e) => no.includes(e.id));
if (ao.length !== no.length)
  throw new Error("@file-viewer/renderer-word could not locate the shared Word renderer definitions.");
const wl = ao, hl = (e, t, r, o) => import("./wordDocx-BHpjPy3Q.js").then(({ default: i }) => i(e, t, o)), gl = (e) => {
  if (e.byteLength < 2)
    return "binary";
  const t = new Uint8Array(e, 0, 2);
  return t[0] === 80 && t[1] === 75 ? "openxml" : "binary";
}, bl = (e, t, r, o) => gl(e) === "openxml" ? import("./wordDocx-BHpjPy3Q.js").then(({ default: i }) => i(e, t, o)) : import("./wordDoc-CPP7R6f8.js").then(({ default: i }) => i(e, t, o)), yl = (e, t, r, o) => import("./openDocument-DqUOCIyG.js").then(({ default: i }) => i(e, t, r, o)), xl = {
  id: "file-viewer-renderer-word",
  label: "Flyfish File Viewer Word renderer",
  definitions: wl,
  handlers: [
    {
      rendererId: "office-word-openxml",
      handler: hl
    },
    {
      rendererId: "office-word-binary",
      handler: bl
    },
    {
      rendererId: "open-document",
      handler: yl
    }
  ]
}, lo = {
  id: "file-viewer-preset-office",
  label: "Flyfish File Viewer office renderer preset",
  renderers: [cl, xl, vl, ml, sl]
};
kn(lo, {
  id: "office",
  packageName: "@file-viewer/preset-office"
});
const Sl = [".docx", ".xlsx", ".pptx"], Fl = [".docm", ".xlsm", ".pptm"], El = [
  ".doc",
  ".rtf",
  ".odt",
  ".epub",
  ".xls",
  ".xlsb",
  ".ods",
  ".ppt",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".odp"
];
function so(e) {
  const t = e.trim().toLowerCase();
  return t ? t.startsWith(".") ? t : `.${t}` : "";
}
const kl = new Set(Sl), Rl = new Set(Fl), Al = new Set(El);
function Dl(e) {
  const t = so(e);
  return kl.has(t) ? "modern" : Rl.has(t) ? "macro" : (Al.has(t), "best-effort");
}
function _l(e) {
  return so(e).replace(/^\./, "");
}
const Tl = `.document-office-preview{width:100%;height:100%;min-width:0;min-height:360px}
.document-office-preview>.document-file-viewer{display:block;width:100%;height:100%;min-width:0;min-height:0}
.document-file-viewer::part(shell){width:100%;max-width:100%;min-width:0}
.document-file-viewer::part(toolbar){display:flex;width:100%;max-width:100%;min-width:0;box-sizing:border-box;justify-content:space-between;flex-wrap:wrap;overflow-x:auto;overflow-y:hidden}
.document-file-viewer::part(toolbar-group){min-width:0;max-width:100%;flex:0 1 auto}
.document-file-viewer::part(input){width:auto;min-width:0;max-width:100%;flex:1 1 72px}
`, Pl = {
  preset: lo,
  rendererMode: "replace",
  locale: "zh-CN",
  ui: { density: "compact" },
  toolbar: { download: !1, print: !1, exportHtml: !1, theme: !1, position: "top" }
}, Dt = "pipiui-office-extension-style";
function zl() {
  try {
    return new URL(
      /* @vite-ignore */
      "./file-viewer/",
      import.meta.url
    ).href;
  } catch {
    return;
  }
}
function Qe() {
  return To() ?? "";
}
function co(e) {
  e ? br(e) : Ro();
}
function Il() {
  if (typeof document > "u") return;
  const e = document.getElementById(Dt);
  if (e) {
    e.dataset.refcount = String(Number(e.dataset.refcount || "0") + 1);
    return;
  }
  const t = document.createElement("style");
  t.id = Dt, t.textContent = Tl, t.dataset.refcount = "0";
  const r = Qe();
  t.dataset.prevAssetBase = r;
  const o = zl() ?? "";
  t.dataset.installedAssetBase = o;
  try {
    document.head.appendChild(t), o && br(o), t.dataset.installedAssetBase = Qe(), t.dataset.refcount = "1";
  } catch (i) {
    try {
      const n = Qe();
      (n === o || n === (t.dataset.installedAssetBase ?? "")) && co(r);
    } catch {
    }
    try {
      t.remove();
    } catch {
    }
    throw i;
  }
}
function Vl() {
  if (typeof document > "u") return;
  const e = document.getElementById(Dt);
  if (!e) return;
  const t = Math.max(0, Number(e.dataset.refcount || "1") - 1);
  if (t > 0) {
    e.dataset.refcount = String(t);
    return;
  }
  const r = e.dataset.prevAssetBase ?? "", o = e.dataset.installedAssetBase ?? "";
  try {
    Qe() === o && co(r);
  } finally {
    e.remove();
  }
}
class Ll extends vo {
  state = { failed: !1 };
  static getDerivedStateFromError() {
    return { failed: !0 };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function Cl(e) {
  if (!e) return null;
  const t = new Uint8Array(e.byteLength);
  return t.set(e), t.buffer;
}
function Yl(e) {
  vt(() => (Il(), () => Vl()), []);
  const t = Me(!1), r = Me(`${e.document.documentId}:${e.document.revision}`), o = `${e.document.documentId}:${e.document.revision}`;
  r.current !== o && (r.current = o, t.current = !1);
  const i = hr(() => Cl(e.bytes), [e.bytes]), n = Dl(e.document.extension), a = _l(e.document.extension), l = fo(() => {
    t.current || (t.current = !0, e.actions.useGenericFallback());
  }, [e.actions]);
  return i ? /* @__PURE__ */ Xe(
    "div",
    {
      className: "document-office-preview",
      "data-testid": "office-renderer",
      "data-preview-tier": n,
      "data-extension": e.document.extension,
      "data-kind": e.document.documentKind,
      "aria-label": `文档内容 ${e.document.name}`,
      children: /* @__PURE__ */ Xe(
        Ll,
        {
          onError: l,
          children: /* @__PURE__ */ Xe(
            Qr,
            {
              className: "document-file-viewer",
              buffer: i,
              name: e.document.name,
              type: a,
              size: e.document.size,
              options: Pl,
              onStateChange: (s) => {
                s.error && l();
              }
            },
            o
          )
        },
        o
      )
    }
  ) : null;
}
export {
  Yl as A,
  Il as B,
  Vl as C,
  Kl as D,
  Dt as O,
  Xl as a,
  Pi as b,
  mn as c,
  Wl as d,
  ge as e,
  Bl as f,
  Hl as g,
  Rt as h,
  Ir as i,
  $i as j,
  jl as k,
  ha as l,
  zt as m,
  ia as n,
  At as o,
  Nl as p,
  $l as q,
  Gl as r,
  Yo as s,
  Zl as t,
  ql as u,
  Jo as v,
  Ji as w,
  Mi as x,
  Ul as y,
  Ci as z
};
