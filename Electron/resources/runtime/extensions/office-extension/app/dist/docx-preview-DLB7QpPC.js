import { e as je } from "./index-DK4k06Xx.js";
const Fe = (Ue = je, Ie = { "./comments/comments-extended-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.CommentsExtendedPart = void 0;
  const d = N("../common/part"), h = N("../utils");
  class P extends d.Part {
    constructor(s, v) {
      super(s, v), this.comments = [];
    }
    parseXml(s) {
      const v = this._package.xmlParser;
      for (let S of v.elements(s, "commentEx")) this.comments.push({ paraId: v.attr(S, "paraId"), paraIdParent: v.attr(S, "paraIdParent"), done: v.boolAttr(S, "done") });
      this.commentMap = (0, h.keyBy)(this.comments, (S) => S.paraId);
    }
  }
  b.CommentsExtendedPart = P;
}, "./comments/comments-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.CommentsPart = void 0;
  const d = N("../common/part"), h = N("../utils");
  class P extends d.Part {
    constructor(s, v, S) {
      super(s, v), this._documentParser = S;
    }
    parseXml(s) {
      this.comments = this._documentParser.parseComments(s), this.commentMap = (0, h.keyBy)(this.comments, (v) => v.id);
    }
  }
  b.CommentsPart = P;
}, "./comments/elements": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.WmlCommentRangeEnd = b.WmlCommentRangeStart = b.WmlCommentReference = b.WmlComment = void 0;
  const d = N("../document/dom");
  class h extends d.OpenXmlElementBase {
    constructor() {
      super(...arguments), this.type = d.DomType.Comment;
    }
  }
  b.WmlComment = h;
  class P extends d.OpenXmlElementBase {
    constructor(S) {
      super(), this.id = S, this.type = d.DomType.CommentReference;
    }
  }
  b.WmlCommentReference = P;
  class k extends d.OpenXmlElementBase {
    constructor(S) {
      super(), this.id = S, this.type = d.DomType.CommentRangeStart;
    }
  }
  b.WmlCommentRangeStart = k;
  class s extends d.OpenXmlElementBase {
    constructor(S) {
      super(), this.id = S, this.type = d.DomType.CommentRangeEnd;
    }
  }
  b.WmlCommentRangeEnd = s;
}, "./common/content-types": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseContentTypes = function(d, h) {
    return h.elements(d).map((P) => ({ extension: h.attr(P, "Extension"), partName: h.attr(P, "PartName"), contentType: h.attr(P, "ContentType") }));
  };
}, "./common/open-xml-package": function(N, Z, b) {
  var d = this && this.__importDefault || function(R) {
    return R && R.__esModule ? R : { default: R };
  };
  Object.defineProperty(b, "__esModule", { value: !0 }), b.OpenXmlPackage = void 0;
  const h = d(N("jszip")), P = N("../parser/xml-parser"), k = N("../utils"), s = N("./relationship"), v = N("./content-types");
  class S {
    constructor($, F) {
      this._zip = $, this.options = F, this.xmlParser = new P.XmlParser();
    }
    get($) {
      const F = (function(e) {
        return e.startsWith("/") ? e.substr(1) : e;
      })($);
      return this._zip.files[F] ?? this._zip.files[F.replace(/\//g, "\\")];
    }
    update($, F) {
      this._zip.file($, F);
    }
    static async load($, F) {
      const e = await h.default.loadAsync($);
      return new S(e, F);
    }
    save($ = "blob") {
      return this._zip.generateAsync({ type: $ });
    }
    load($, F = "string") {
      return this.get($)?.async(F) ?? Promise.resolve(null);
    }
    async loadRelationships($ = null) {
      let F = "_rels/.rels";
      if ($ != null) {
        const [t, a] = (0, k.splitPath)($);
        F = `${t}_rels/${a}.rels`;
      }
      const e = await this.load(F);
      return e ? (0, s.parseRelationships)(M(this.parseXmlDocument(e)), this.xmlParser) : null;
    }
    async loadContentTypes() {
      const $ = await this.load("[Content_Types].xml");
      return $ ? (0, v.parseContentTypes)(M(this.parseXmlDocument($)), this.xmlParser) : [];
    }
    parseXmlDocument($) {
      return (0, P.parseXmlString)($, this.options.trimXmlDeclaration);
    }
  }
  function M(R) {
    return R.firstElementChild ?? R.documentElement;
  }
  b.OpenXmlPackage = S;
}, "./common/part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.Part = void 0;
  const d = N("../parser/xml-parser");
  b.Part = class {
    constructor(h, P) {
      this._package = h, this.path = P;
    }
    async load() {
      this.rels = await this._package.loadRelationships(this.path);
      const h = await this._package.load(this.path), P = this._package.parseXmlDocument(h);
      this._package.options.keepOrigin && (this._xmlDocument = P), this.parseXml(P.firstElementChild ?? P.documentElement);
    }
    save() {
      this._package.update(this.path, (0, d.serializeXmlString)(this._xmlDocument));
    }
    parseXml(h) {
    }
  };
}, "./common/relationship": function(N, Z, b) {
  var d;
  Object.defineProperty(b, "__esModule", { value: !0 }), b.RelationshipTypes = void 0, b.parseRelationships = function(h, P) {
    return P.elements(h).map((k) => ({ id: P.attr(k, "Id"), type: P.attr(k, "Type"), target: P.attr(k, "Target"), targetMode: P.attr(k, "TargetMode") }));
  }, (function(h) {
    h.OfficeDocument = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", h.FontTable = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable", h.Image = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", h.Numbering = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", h.Styles = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", h.StylesWithEffects = "http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects", h.Theme = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", h.Settings = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings", h.WebSettings = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings", h.Hyperlink = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", h.Footnotes = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", h.Endnotes = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes", h.Footer = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", h.Header = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", h.ExtendedProperties = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", h.CoreProperties = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", h.CustomProperties = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/custom-properties", h.Comments = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments", h.CommentsExtended = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", h.AltChunk = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk", h.Chart = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart", h.ChartUserShapes = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes", h.DiagramData = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData", h.DiagramLayout = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout", h.DiagramQuickStyle = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle", h.DiagramColors = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors", h.Ink = "http://schemas.microsoft.com/office/2007/relationships/ink", h.ContentPart = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/contentPart";
  })(d || (b.RelationshipTypes = d = {}));
}, "./dark-mode-color": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.DEFAULT_DARK_MODE_BASE_L = void 0, b.getDarkModeColor = M, b.applyDarkModeToStyle = function(t, a) {
    if (!t) return t;
    let n = t;
    for (const c in t) {
      const l = t[c];
      if (typeof l != "string" || !l) continue;
      let m;
      R.has(c) || c.startsWith("--") && c.endsWith("-color") ? m = M(l, a) : $.has(c) && (m = e(l, a)), m !== void 0 && m !== l && (n === t && (n = { ...t }), n[c] = m);
    }
    return n;
  }, b.DEFAULT_DARK_MODE_BASE_L = 21.247;
  const d = Math.pow(6 / 29, 3);
  function h(t) {
    return t > 0.04045 ? Math.pow((t + 0.055) / 1.055, 2.4) : t / 12.92;
  }
  function P(t) {
    const a = t > 31308e-7 ? 1.055 * Math.pow(t, 0.4166666666666667) - 0.055 : 12.92 * t;
    return Math.min(Math.max(0, a), 1);
  }
  const k = { black: [0, 0, 0], blue: [0, 0, 255], cyan: [0, 255, 255], darkblue: [0, 0, 139], darkcyan: [0, 139, 139], darkgray: [169, 169, 169], darkgrey: [169, 169, 169], darkgreen: [0, 100, 0], darkmagenta: [139, 0, 139], darkred: [139, 0, 0], darkyellow: [128, 128, 0], green: [0, 128, 0], gray: [128, 128, 128], grey: [128, 128, 128], lightgray: [211, 211, 211], lightgrey: [211, 211, 211], magenta: [255, 0, 255], red: [255, 0, 0], white: [255, 255, 255], yellow: [255, 255, 0] };
  function s(t) {
    return Math.min(255, Math.max(0, t));
  }
  const v = /* @__PURE__ */ new Map(), S = /^var\(\s*(--[\w-]+)\s*,\s*([\s\S]+)\)$/i;
  function M(t, a = b.DEFAULT_DARK_MODE_BASE_L) {
    if (!t) return t;
    const n = t.trim(), c = n.toLowerCase();
    if (c.startsWith("var(")) {
      const w = S.exec(n);
      if (!w) return t;
      const L = w[2].trim(), I = M(L, a);
      return I === L ? t : `var(${w[1]}, ${I})`;
    }
    if ((function(w) {
      return w === "" || w === "none" || w === "transparent" || w === "inherit" || w === "initial" || w === "unset" || w === "currentcolor" || w.startsWith("var(") || w.startsWith("color-mix(") || w.startsWith("url(") || w.startsWith("linear-gradient(") || w.startsWith("radial-gradient(") || w.startsWith("conic-gradient(");
    })(c)) return t;
    const l = `${a}|${n}`, m = v.get(l);
    if (m !== void 0) return m;
    const f = (function(w) {
      const L = w.trim();
      if (L.startsWith("#")) {
        const D = L.slice(1);
        if (D.length === 3 || D.length === 4) {
          const Q = parseInt(D[0] + D[0], 16), X = parseInt(D[1] + D[1], 16), A = parseInt(D[2] + D[2], 16), B = D.length === 4 ? parseInt(D[3] + D[3], 16) / 255 : 1;
          return Number.isNaN(Q) || Number.isNaN(X) || Number.isNaN(A) ? null : { r: Q, g: X, b: A, a: B };
        }
        if (D.length === 6 || D.length === 8) {
          const Q = parseInt(D.slice(0, 2), 16), X = parseInt(D.slice(2, 4), 16), A = parseInt(D.slice(4, 6), 16), B = D.length === 8 ? parseInt(D.slice(6, 8), 16) / 255 : 1;
          return Number.isNaN(Q) || Number.isNaN(X) || Number.isNaN(A) ? null : { r: Q, g: X, b: A, a: B };
        }
        return null;
      }
      const I = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(L);
      if (I) return { r: s(parseFloat(I[1])), g: s(parseFloat(I[2])), b: s(parseFloat(I[3])), a: I[4] !== void 0 ? parseFloat(I[4]) : 1 };
      const Y = k[L.toLowerCase()];
      return Y ? { r: Y[0], g: Y[1], b: Y[2], a: 1 } : null;
    })(n);
    if (!f || f.a === 0) return v.set(l, t), t;
    const [i, r, o] = (function(w, L, I) {
      const Y = h(w / 255), D = h(L / 255), Q = h(I / 255);
      let X = 100 * (0.4124564 * Y + 0.3575761 * D + 0.1804375 * Q) / 95.047, A = 100 * (0.2126729 * Y + 0.7151522 * D + 0.072175 * Q) / 100, B = 100 * (0.0193339 * Y + 0.119192 * D + 0.9503041 * Q) / 108.883;
      const _ = (G) => G > d ? Math.cbrt(G) : 7.787 * G + 16 / 116;
      return X = _(X), A = _(A), B = _(B), [116 * A - 16, 500 * (X - A), 200 * (A - B)];
    })(f.r, f.g, f.b), u = (100 - a) / 100 * (100 - i) + a, [y, p, g] = (function(w, L, I) {
      const Y = (w + 16) / 116, D = Y - I / 200, Q = (ae) => ae * ae * ae > d ? ae * ae * ae : (ae - 16 / 116) / 7.787, X = 95.047 * Q(Y + L / 500) / 100, A = 100 * Q(Y) / 100, B = 108.883 * Q(D) / 100, _ = P(3.2404542 * X + -1.5371385 * A + -0.4985314 * B), G = P(-0.969266 * X + 1.8760108 * A + 0.041556 * B), re = P(0.0556434 * X + -0.2040259 * A + 1.0572252 * B);
      return [Math.round(255 * _), Math.round(255 * G), Math.round(255 * re)];
    })(u, r, o), T = f.a >= 1 ? `rgb(${y}, ${p}, ${g})` : `rgba(${y}, ${p}, ${g}, ${Math.round(1e3 * f.a) / 1e3})`;
    return v.set(l, T), T;
  }
  const R = /* @__PURE__ */ new Set(["color", "background-color", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color", "caret-color", "column-rule-color", "fill", "stroke"]), $ = /* @__PURE__ */ new Set(["border", "border-top", "border-right", "border-bottom", "border-left", "outline", "column-rule"]), F = /(var\([^)]*\)|rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*$/;
  function e(t, a) {
    return t && t.replace(F, (n) => M(n, a));
  }
}, "./document/bookmarks": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseBookmarkStart = function(h, P) {
    return { type: d.DomType.BookmarkStart, id: P.attr(h, "id"), name: P.attr(h, "name"), colFirst: P.intAttr(h, "colFirst"), colLast: P.intAttr(h, "colLast") };
  }, b.parseBookmarkEnd = function(h, P) {
    return { type: d.DomType.BookmarkEnd, id: P.attr(h, "id") };
  };
  const d = N("./dom");
}, "./document/border": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseBorder = h, b.parseBorders = function(P, k) {
    var s = {};
    for (let v of k.elements(P)) switch (v.localName) {
      case "left":
        s.left = h(v, k);
        break;
      case "top":
        s.top = h(v, k);
        break;
      case "right":
        s.right = h(v, k);
        break;
      case "bottom":
        s.bottom = h(v, k);
    }
    return s;
  };
  const d = N("./common");
  function h(P, k) {
    return { type: k.attr(P, "val"), color: k.attr(P, "color"), size: k.lengthAttr(P, "sz", d.LengthUsage.Border), offset: k.lengthAttr(P, "space", d.LengthUsage.Point), frame: k.boolAttr(P, "frame"), shadow: k.boolAttr(P, "shadow") };
  }
}, "./document/common": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.LengthUsage = b.ns = void 0, b.convertLength = function(h, P = b.LengthUsage.Dxa) {
    if (h == null || h === "" || /.+(p[xt]|[%])$/i.test(h)) return h;
    var k = parseFloat(h);
    if (Number.isNaN(k)) return null;
    var s = k * P.mul;
    return P.min != null && P.max != null && (s = (0, d.clamp)(s, P.min, P.max)), `${s.toFixed(2)}${P.unit}`;
  }, b.convertBoolean = function(h, P = !1) {
    switch (h) {
      case "1":
      case "on":
      case "true":
        return !0;
      case "0":
      case "off":
      case "false":
        return !1;
      default:
        return P;
    }
  }, b.convertPercentage = function(h) {
    return h ? parseInt(h) / 100 : null;
  }, b.parseCommonProperty = function(h, P, k) {
    if (h.namespaceURI != b.ns.wordml) return !1;
    switch (h.localName) {
      case "color":
        P.color = k.attr(h, "val");
        break;
      case "sz":
        P.fontSize = k.lengthAttr(h, "val", b.LengthUsage.FontSize);
        break;
      case "szCs":
        P.fontSize ?? (P.fontSize = k.lengthAttr(h, "val", b.LengthUsage.FontSize));
        break;
      default:
        return !1;
    }
    return !0;
  };
  const d = N("../utils");
  b.ns = { wordml: "http://schemas.openxmlformats.org/wordprocessingml/2006/main", drawingml: "http://schemas.openxmlformats.org/drawingml/2006/main", picture: "http://schemas.openxmlformats.org/drawingml/2006/picture", wordprocessingCanvas: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas", wordprocessingGroup: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup", wordprocessingShape: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape", chart: "http://schemas.openxmlformats.org/drawingml/2006/chart", diagram: "http://schemas.openxmlformats.org/drawingml/2006/diagram", relationship: "http://schemas.openxmlformats.org/officeDocument/2006/relationships", drawing2014: "http://schemas.microsoft.com/office/drawing/2014/main", ink2010: "http://schemas.microsoft.com/office/2010/ink", word2010: "http://schemas.microsoft.com/office/word/2010/wordml", compatibility: "http://schemas.openxmlformats.org/markup-compatibility/2006", math: "http://schemas.openxmlformats.org/officeDocument/2006/math" }, b.LengthUsage = { Dxa: { mul: 0.05, unit: "pt" }, SignedDxa: { mul: 0.05, unit: "pt" }, Emu: { mul: 1 / 12700, unit: "pt" }, FontSize: { mul: 0.5, unit: "pt" }, SignedHalfPoint: { mul: 0.5, unit: "pt" }, Border: { mul: 0.125, unit: "pt", min: 0.25, max: 12 }, Point: { mul: 1, unit: "pt" }, Percent: { mul: 0.02, unit: "%" }, LineHeight: { mul: 1 / 240, unit: "" }, VmlEmu: { mul: 1 / 12700, unit: "" } };
}, "./document/document-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.DocumentPart = void 0;
  const d = N("../common/part");
  class h extends d.Part {
    constructor(k, s, v) {
      super(k, s), this._documentParser = v;
    }
    parseXml(k) {
      this.body = this._documentParser.parseDocumentFile(k);
    }
  }
  b.DocumentPart = h;
}, "./document/document": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 });
}, "./document/dom": function(N, Z, b) {
  var d;
  Object.defineProperty(b, "__esModule", { value: !0 }), b.OpenXmlElementBase = b.DomType = void 0, (function(h) {
    h.Document = "document", h.Paragraph = "paragraph", h.Run = "run", h.Break = "break", h.NoBreakHyphen = "noBreakHyphen", h.Table = "table", h.Row = "row", h.Cell = "cell", h.Hyperlink = "hyperlink", h.SmartTag = "smartTag", h.Drawing = "drawing", h.Image = "image", h.Text = "text", h.Tab = "tab", h.PositionalTab = "positionalTab", h.SoftHyphen = "softHyphen", h.Symbol = "symbol", h.BookmarkStart = "bookmarkStart", h.BookmarkEnd = "bookmarkEnd", h.Footer = "footer", h.Header = "header", h.FootnoteReference = "footnoteReference", h.EndnoteReference = "endnoteReference", h.Footnote = "footnote", h.Endnote = "endnote", h.SimpleField = "simpleField", h.ComplexField = "complexField", h.Instruction = "instruction", h.VmlPicture = "vmlPicture", h.MmlMath = "mmlMath", h.Shape = "shape", h.MmlMathParagraph = "mmlMathParagraph", h.MmlFraction = "mmlFraction", h.MmlFunction = "mmlFunction", h.MmlFunctionName = "mmlFunctionName", h.MmlNumerator = "mmlNumerator", h.MmlDenominator = "mmlDenominator", h.MmlRadical = "mmlRadical", h.MmlBase = "mmlBase", h.MmlDegree = "mmlDegree", h.MmlSuperscript = "mmlSuperscript", h.MmlSubscript = "mmlSubscript", h.MmlPreSubSuper = "mmlPreSubSuper", h.MmlSubArgument = "mmlSubArgument", h.MmlSuperArgument = "mmlSuperArgument", h.MmlNary = "mmlNary", h.MmlDelimiter = "mmlDelimiter", h.MmlRun = "mmlRun", h.MmlEquationArray = "mmlEquationArray", h.MmlLimit = "mmlLimit", h.MmlLimitLower = "mmlLimitLower", h.MmlLimitUpper = "mmlLimitUpper", h.MmlSubSuperscript = "mmlSubSuperscript", h.MmlPhantom = "mmlPhantom", h.MmlBorderBox = "mmlBorderBox", h.MmlAccent = "mmlAccent", h.MmlMatrix = "mmlMatrix", h.MmlMatrixRow = "mmlMatrixRow", h.MmlBox = "mmlBox", h.MmlBar = "mmlBar", h.MmlGroupChar = "mmlGroupChar", h.VmlElement = "vmlElement", h.Chart = "chart", h.SmartArt = "smartArt", h.Ink = "ink", h.Ruby = "ruby", h.RubyBase = "rubyBase", h.RubyText = "rubyText", h.Inserted = "inserted", h.Deleted = "deleted", h.DeletedText = "deletedText", h.Comment = "comment", h.CommentReference = "commentReference", h.CommentRangeStart = "commentRangeStart", h.CommentRangeEnd = "commentRangeEnd", h.AltChunk = "altChunk";
  })(d || (b.DomType = d = {})), b.OpenXmlElementBase = class {
    constructor() {
      this.children = [], this.cssStyle = {};
    }
  };
}, "./document/fields": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 });
}, "./document/line-spacing": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseLineSpacing = function(d, h) {
    return { before: h.lengthAttr(d, "before"), after: h.lengthAttr(d, "after"), line: h.intAttr(d, "line"), lineRule: h.attr(d, "lineRule") };
  };
}, "./document/paragraph": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseParagraphProperties = function(M, R) {
    let $ = {};
    for (let F of R.elements(M)) s(F, $, R);
    return $;
  }, b.parseParagraphProperty = s, b.parseTabs = v, b.parseNumbering = S;
  const d = N("./common"), h = N("./section"), P = N("./line-spacing"), k = N("./run");
  function s(M, R, $) {
    if (M.namespaceURI != d.ns.wordml) return !1;
    if ((0, d.parseCommonProperty)(M, R, $)) return !0;
    switch (M.localName) {
      case "tabs":
        R.tabs = v(M, $);
        break;
      case "sectPr":
        R.sectionProps = (0, h.parseSectionProperties)(M, $);
        break;
      case "numPr":
        R.numbering = S(M, $);
        break;
      case "spacing":
        return R.lineSpacing = (0, P.parseLineSpacing)(M, $), !1;
      case "textAlignment":
        return R.textAlignment = $.attr(M, "val"), !1;
      case "keepLines":
        R.keepLines = $.boolAttr(M, "val", !0);
        break;
      case "keepNext":
        R.keepNext = $.boolAttr(M, "val", !0);
        break;
      case "pageBreakBefore":
        R.pageBreakBefore = $.boolAttr(M, "val", !0);
        break;
      case "widowControl":
        R.widowControl = $.boolAttr(M, "val", !0);
        break;
      case "outlineLvl":
        R.outlineLevel = $.intAttr(M, "val");
        break;
      case "pStyle":
        R.styleName = $.attr(M, "val");
        break;
      case "rPr":
        R.runProps = (0, k.parseRunProperties)(M, $);
        break;
      default:
        return !1;
    }
    return !0;
  }
  function v(M, R) {
    return R.elements(M, "tab").map(($) => ({ position: R.lengthAttr($, "pos"), leader: R.attr($, "leader"), style: R.attr($, "val") }));
  }
  function S(M, R) {
    var $ = {};
    for (let F of R.elements(M)) switch (F.localName) {
      case "numId":
        $.id = R.attr(F, "val");
        break;
      case "ilvl":
        $.level = R.intAttr(F, "val");
    }
    return $;
  }
}, "./document/run": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseRunProperties = function(P, k) {
    let s = {};
    for (let v of k.elements(P)) h(v, s, k);
    return s;
  }, b.parseRunProperty = h;
  const d = N("./common");
  function h(P, k, s) {
    return !!(0, d.parseCommonProperty)(P, k, s);
  }
}, "./document/section": function(N, Z, b) {
  var d = this && this.__importDefault || function(F) {
    return F && F.__esModule ? F : { default: F };
  };
  Object.defineProperty(b, "__esModule", { value: !0 }), b.SectionType = void 0, b.isSectionPageBreak = function(F) {
    return F == null || F === s.NextPage || F === s.EvenPage || F === s.OddPage;
  }, b.isSectionColumnBreak = function(F) {
    return F === s.NextColumn;
  }, b.parseSectionProperties = function(F = null, e = h.default) {
    const t = F ? e.element(F, "pgSz") : null, a = t ? e.attr(t, "orient") : null, n = (function(m = null) {
      const f = m === "landscape";
      return { width: (0, k.convertLength)(f ? v.height : v.width), height: (0, k.convertLength)(f ? v.width : v.height), orientation: m };
    })(a), c = { top: (0, k.convertLength)(v.marginTop), right: (0, k.convertLength)(v.marginRight), bottom: (0, k.convertLength)(v.marginBottom), left: (0, k.convertLength)(v.marginLeft), header: (0, k.convertLength)(v.header), footer: (0, k.convertLength)(v.footer), gutter: (0, k.convertLength)(v.gutter) };
    var l = { pageSize: n, pageMargins: c };
    if (!F) return l;
    for (let m of e.elements(F)) switch (m.localName) {
      case "pgSz":
        l.pageSize = { width: e.lengthAttr(m, "w") ?? n.width, height: e.lengthAttr(m, "h") ?? n.height, orientation: a };
        break;
      case "type":
        l.type = e.attr(m, "val");
        break;
      case "pgMar":
        l.pageMargins = { left: e.lengthAttr(m, "left") ?? c.left, right: e.lengthAttr(m, "right") ?? c.right, top: e.lengthAttr(m, "top") ?? c.top, bottom: e.lengthAttr(m, "bottom") ?? c.bottom, header: e.lengthAttr(m, "header") ?? c.header, footer: e.lengthAttr(m, "footer") ?? c.footer, gutter: e.lengthAttr(m, "gutter") ?? c.gutter };
        break;
      case "cols":
        l.columns = S(m, e);
        break;
      case "headerReference":
        (l.headerRefs ?? (l.headerRefs = [])).push($(m, e));
        break;
      case "footerReference":
        (l.footerRefs ?? (l.footerRefs = [])).push($(m, e));
        break;
      case "titlePg":
        l.titlePage = e.boolAttr(m, "val", !0);
        break;
      case "pgBorders":
        l.pageBorders = (0, P.parseBorders)(m, e);
        break;
      case "pgNumType":
        l.pageNumber = M(m, e);
        break;
      case "docGrid":
        l.docGrid = R(m, e);
    }
    return l;
  };
  const h = d(N("../parser/xml-parser")), P = N("./border"), k = N("./common");
  var s;
  (function(F) {
    F.Continuous = "continuous", F.NextPage = "nextPage", F.NextColumn = "nextColumn", F.EvenPage = "evenPage", F.OddPage = "oddPage";
  })(s || (b.SectionType = s = {}));
  const v = { width: "11906", height: "16838", marginTop: "1440", marginRight: "1440", marginBottom: "1440", marginLeft: "1440", header: "720", footer: "720", gutter: "0" };
  function S(F, e) {
    return { numberOfColumns: e.intAttr(F, "num"), space: e.lengthAttr(F, "space"), separator: e.boolAttr(F, "sep"), equalWidth: e.boolAttr(F, "equalWidth", !0), columns: e.elements(F, "col").map((t) => ({ width: e.lengthAttr(t, "w"), space: e.lengthAttr(t, "space") })) };
  }
  function M(F, e) {
    return { chapSep: e.attr(F, "chapSep"), chapStyle: e.attr(F, "chapStyle"), format: e.attr(F, "fmt"), start: e.intAttr(F, "start") };
  }
  function R(F, e) {
    const t = e.intAttr(F, "charSpace", null), a = t == null ? null : t / 4096;
    return { type: e.attr(F, "type"), linePitch: e.lengthAttr(F, "linePitch"), charSpace: a == null ? null : `${a.toFixed(4)}pt`, charSpaceRaw: t };
  }
  function $(F, e) {
    return { id: e.attr(F, "id"), type: e.attr(F, "type") };
  }
}, "./document/style": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 });
}, "./document-parser": function(N, Z, b) {
  var d = this && this.__importDefault || function(i) {
    return i && i.__esModule ? i : { default: i };
  };
  Object.defineProperty(b, "__esModule", { value: !0 }), b.DocumentParser = b.autos = void 0;
  const h = N("./document/dom"), P = N("./document/paragraph"), k = N("./document/section"), s = d(N("./parser/xml-parser")), v = N("./document/run"), S = N("./document/bookmarks"), M = N("./document/common"), R = N("./vml/vml"), $ = N("./comments/elements"), F = N("./utils"), e = N("./theme/theme");
  b.autos = { shd: "inherit", color: "var(--docx-auto-color, black)", borderColor: "var(--docx-auto-color, black)", highlight: "transparent" };
  const t = [M.ns.wordprocessingShape, M.ns.wordprocessingCanvas, M.ns.wordprocessingGroup, M.ns.drawingml, M.ns.picture], a = { oMath: h.DomType.MmlMath, oMathPara: h.DomType.MmlMathParagraph, f: h.DomType.MmlFraction, func: h.DomType.MmlFunction, fName: h.DomType.MmlFunctionName, num: h.DomType.MmlNumerator, den: h.DomType.MmlDenominator, rad: h.DomType.MmlRadical, deg: h.DomType.MmlDegree, e: h.DomType.MmlBase, sSup: h.DomType.MmlSuperscript, sSub: h.DomType.MmlSubscript, sPre: h.DomType.MmlPreSubSuper, sup: h.DomType.MmlSuperArgument, sub: h.DomType.MmlSubArgument, d: h.DomType.MmlDelimiter, nary: h.DomType.MmlNary, eqArr: h.DomType.MmlEquationArray, lim: h.DomType.MmlLimit, limLow: h.DomType.MmlLimitLower, limUpp: h.DomType.MmlLimitUpper, sSubSup: h.DomType.MmlSubSuperscript, phant: h.DomType.MmlPhantom, borderBox: h.DomType.MmlBorderBox, acc: h.DomType.MmlAccent, m: h.DomType.MmlMatrix, mr: h.DomType.MmlMatrixRow, box: h.DomType.MmlBox, bar: h.DomType.MmlBar, groupChr: h.DomType.MmlGroupChar };
  b.DocumentParser = class {
    constructor(i) {
      this.options = { ignoreWidth: !1, debug: !1, hideWebHiddenContent: !1, ...i };
    }
    parseNotes(i, r, o) {
      var u = [];
      for (let y of s.default.elements(i, r)) {
        const p = new o();
        p.id = s.default.attr(y, "id"), p.noteType = s.default.attr(y, "type"), p.children = this.parseBodyElements(y), u.push(p);
      }
      return u;
    }
    parseComments(i) {
      var r = [];
      for (let o of s.default.elements(i, "comment")) {
        const u = new $.WmlComment();
        u.id = s.default.attr(o, "id"), u.author = s.default.attr(o, "author"), u.initials = s.default.attr(o, "initials"), u.date = s.default.attr(o, "date"), u.children = this.parseBodyElements(o), r.push(u);
      }
      return r;
    }
    parseDocumentFile(i) {
      var r = s.default.element(i, "body"), o = s.default.element(i, "background"), u = s.default.element(r, "sectPr");
      return { type: h.DomType.Document, children: this.parseBodyElements(r), props: (0, k.parseSectionProperties)(u, s.default), cssStyle: o ? this.parseBackground(o) : {} };
    }
    parseBackground(i) {
      var r = {}, o = m.colorAttr(i, "color", null, b.autos.shd);
      return o && (r["background-color"] = o), r;
    }
    parseBodyElements(i) {
      var r = [];
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "p":
          r.push(this.parseParagraph(o));
          break;
        case "altChunk":
          r.push(this.parseAltChunk(o));
          break;
        case "tbl":
          r.push(this.parseTable(o));
          break;
        case "sdt":
          r.push(...this.parseSdt(o, (u) => this.parseBodyElements(u)));
      }
      return r;
    }
    parseStylesFile(i) {
      var r = [];
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "style":
          r.push(this.parseStyle(o));
          break;
        case "docDefaults":
          r.push(this.parseDefaultStyles(o));
      }
      return r;
    }
    parseDefaultStyles(i) {
      var r = { id: null, name: null, target: null, basedOn: null, styles: [] };
      for (const y of s.default.elements(i)) switch (y.localName) {
        case "rPrDefault":
          var o = s.default.element(y, "rPr");
          o && r.styles.push({ target: "span", values: this.parseDefaultProperties(o, {}) });
          break;
        case "pPrDefault":
          var u = s.default.element(y, "pPr");
          u && r.styles.push({ target: "p", values: this.parseDefaultProperties(u, {}) });
      }
      return r;
    }
    parseStyle(i) {
      var r = { id: s.default.attr(i, "styleId"), isDefault: s.default.boolAttr(i, "default"), name: null, target: null, basedOn: null, styles: [], linked: null };
      switch (s.default.attr(i, "type")) {
        case "paragraph":
          r.target = "p";
          break;
        case "table":
          r.target = "table";
          break;
        case "character":
          r.target = "span";
      }
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "basedOn":
          r.basedOn = s.default.attr(o, "val");
          break;
        case "name":
          r.name = s.default.attr(o, "val");
          break;
        case "link":
          r.linked = s.default.attr(o, "val");
          break;
        case "next":
          r.next = s.default.attr(o, "val");
          break;
        case "aliases":
          r.aliases = s.default.attr(o, "val").split(",");
          break;
        case "pPr":
          r.styles.push({ target: "p", values: this.parseDefaultProperties(o, {}) }), r.paragraphProps = (0, P.parseParagraphProperties)(o, s.default);
          break;
        case "rPr":
          r.styles.push({ target: "span", values: this.parseDefaultProperties(o, {}) }), r.runProps = (0, v.parseRunProperties)(o, s.default);
          break;
        case "tblPr":
        case "tcPr":
          r.styles.push({ target: "td", values: this.parseDefaultProperties(o, {}) });
          break;
        case "tblStylePr":
          for (let u of this.parseTableStyle(o)) r.styles.push(u);
          break;
        case "rsid":
        case "qFormat":
        case "hidden":
        case "semiHidden":
        case "unhideWhenUsed":
        case "autoRedefine":
        case "uiPriority":
          break;
        default:
          this.options.debug && console.warn(`DOCX: Unknown style element: ${o.localName}`);
      }
      return r;
    }
    parseTableStyle(i) {
      var r = [], o = "", u = "";
      switch (s.default.attr(i, "type")) {
        case "firstRow":
          u = ".first-row", o = "tr.first-row td";
          break;
        case "lastRow":
          u = ".last-row", o = "tr.last-row td";
          break;
        case "firstCol":
          u = ".first-col", o = "td.first-col";
          break;
        case "lastCol":
          u = ".last-col", o = "td.last-col";
          break;
        case "band1Vert":
          u = ":not(.no-vband)", o = "td.odd-col";
          break;
        case "band2Vert":
          u = ":not(.no-vband)", o = "td.even-col";
          break;
        case "band1Horz":
          u = ":not(.no-hband)", o = "tr.odd-row";
          break;
        case "band2Horz":
          u = ":not(.no-hband)", o = "tr.even-row";
          break;
        default:
          return [];
      }
      for (const y of s.default.elements(i)) switch (y.localName) {
        case "pPr":
          r.push({ target: `${o} p`, mod: u, values: this.parseDefaultProperties(y, {}) });
          break;
        case "rPr":
          r.push({ target: `${o} span`, mod: u, values: this.parseDefaultProperties(y, {}) });
          break;
        case "tblPr":
        case "tcPr":
          r.push({ target: o, mod: u, values: this.parseDefaultProperties(y, {}) });
      }
      return r;
    }
    parseNumberingFile(i) {
      const r = [], o = [], u = {}, y = [], p = [];
      for (const g of s.default.elements(i)) switch (g.localName) {
        case "numPicBullet":
          o.push(this.parseNumberingPicBullet(g));
          break;
        case "abstractNum":
          y.push(g);
          break;
        case "num":
          p.push(g);
      }
      for (const g of y) u[s.default.attr(g, "abstractNumId")] = this.parseAbstractNumbering(g, o);
      for (const g of p) {
        const T = s.default.attr(g, "numId"), w = (u[s.default.elementAttr(g, "abstractNumId", "val")] ?? []).map((L) => this.cloneNumberingLevel(L, T));
        for (const L of s.default.elements(g, "lvlOverride")) {
          const I = s.default.intAttr(L, "ilvl"), Y = s.default.element(L, "lvl"), D = s.default.element(L, "startOverride");
          let Q = w.find((X) => X.level == I);
          if (Y) {
            Q = this.parseNumberingLevel(T, Y, o);
            const X = w.findIndex((A) => A.level == I);
            X >= 0 ? w[X] = Q : w.push(Q);
          }
          D && Q && (Q.start = s.default.intAttr(D, "val", Q.start));
        }
        r.push(...w);
      }
      return r;
    }
    cloneNumberingLevel(i, r) {
      return { ...i, id: r, pStyle: { ...i.pStyle }, rStyle: { ...i.rStyle }, bullet: i.bullet ? { ...i.bullet } : null };
    }
    parseNumberingPicBullet(i) {
      const r = s.default.intAttr(i, "numPicBulletId"), o = s.default.element(i, "pict"), u = o && s.default.element(o, "shape"), y = u && s.default.element(u, "imagedata");
      if (y) return { id: r, src: s.default.attr(y, "id"), style: s.default.attr(u, "style") };
      const p = s.default.element(i, "drawing"), g = p ? this.findDescendant(p, "blip") : null;
      if (g) {
        const T = p ? this.findDescendant(p, "extent") : null, w = [];
        if (T) {
          const L = s.default.lengthAttr(T, "cx", M.LengthUsage.Emu), I = s.default.lengthAttr(T, "cy", M.LengthUsage.Emu);
          L && w.push(`width:${L};`), I && w.push(`height:${I};`);
        }
        return { id: r, src: s.default.attr(g, "embed") ?? s.default.attr(g, "link"), style: w.join("") || void 0 };
      }
      return null;
    }
    parseAbstractNumbering(i, r) {
      var o = [], u = s.default.attr(i, "abstractNumId");
      for (const y of s.default.elements(i)) y.localName === "lvl" && o.push(this.parseNumberingLevel(u, y, r));
      return o;
    }
    parseNumberingLevel(i, r, o) {
      var u = { id: i, level: s.default.intAttr(r, "ilvl"), start: 1, pStyleName: void 0, pStyle: {}, rStyle: {}, suff: "tab" };
      for (const p of s.default.elements(r)) switch (p.localName) {
        case "start":
          u.start = s.default.intAttr(p, "val");
          break;
        case "pPr":
          this.parseDefaultProperties(p, u.pStyle);
          break;
        case "rPr":
          this.parseDefaultProperties(p, u.rStyle);
          break;
        case "lvlPicBulletId":
          var y = s.default.intAttr(p, "val");
          u.bullet = o.find((g) => g?.id == y);
          break;
        case "lvlText":
          u.levelText = s.default.attr(p, "val");
          break;
        case "pStyle":
          u.pStyleName = s.default.attr(p, "val");
          break;
        case "numFmt":
          u.format = s.default.attr(p, "val");
          break;
        case "lvlRestart":
          u.restart = s.default.intAttr(p, "val");
          break;
        case "suff":
          u.suff = s.default.attr(p, "val");
      }
      return u;
    }
    parseSdt(i, r) {
      const o = s.default.element(i, "sdtContent");
      return o ? r(o) : [];
    }
    parseInserted(i, r) {
      return { type: h.DomType.Inserted, children: r(i)?.children ?? [] };
    }
    parseDeleted(i, r) {
      return { type: h.DomType.Deleted, children: r(i)?.children ?? [] };
    }
    parseAltChunk(i) {
      return { type: h.DomType.AltChunk, children: [], id: s.default.attr(i, "id") };
    }
    parseParagraph(i) {
      var r = { type: h.DomType.Paragraph, children: [] };
      for (let o of s.default.elements(i)) switch (o.localName) {
        case "pPr":
          this.parseParagraphProperties(o, r);
          break;
        case "r":
          r.children.push(this.parseRun(o, r));
          break;
        case "hyperlink":
          r.children.push(this.parseHyperlink(o, r));
          break;
        case "smartTag":
          r.children.push(this.parseSmartTag(o, r));
          break;
        case "bookmarkStart":
          r.children.push((0, S.parseBookmarkStart)(o, s.default));
          break;
        case "bookmarkEnd":
          r.children.push((0, S.parseBookmarkEnd)(o, s.default));
          break;
        case "commentRangeStart":
          r.children.push(new $.WmlCommentRangeStart(s.default.attr(o, "id")));
          break;
        case "commentRangeEnd":
          r.children.push(new $.WmlCommentRangeEnd(s.default.attr(o, "id")));
          break;
        case "oMath":
        case "oMathPara": {
          const u = this.parseMathElement(o);
          u && r.children.push(u);
          break;
        }
        case "sdt":
          r.children.push(...this.parseSdt(o, (u) => this.parseParagraph(u).children));
          break;
        case "ins":
          r.children.push(this.parseInserted(o, (u) => this.parseParagraph(u)));
          break;
        case "del":
          r.children.push(this.parseDeleted(o, (u) => this.parseParagraph(u)));
      }
      return r;
    }
    parseParagraphProperties(i, r) {
      this.parseDefaultProperties(i, r.cssStyle = {}, null, (o) => {
        if (o.localName == "rPr") {
          s.default.element(o, "del") && (r.props = { ...r.props ?? {}, deletedParagraphMark: !0 });
          const u = r.cssStyle["background-color"];
          return this.parseDefaultProperties(o, r.cssStyle), u == null ? delete r.cssStyle["background-color"] : r.cssStyle["background-color"] = u, (0, P.parseParagraphProperty)(o, r, s.default), !0;
        }
        if ((0, P.parseParagraphProperty)(o, r, s.default)) return !0;
        switch (o.localName) {
          case "pStyle":
            r.styleName = s.default.attr(o, "val");
            break;
          case "cnfStyle":
            r.className = f.classNameOfCnfStyle(o);
            break;
          case "framePr":
            this.parseFrame(o, r);
            break;
          default:
            return !1;
        }
        return !0;
      });
    }
    parseFrame(i, r) {
      s.default.attr(i, "dropCap") == "drop" && (r.cssStyle.float = "left");
    }
    parseHyperlink(i, r) {
      var o = { type: h.DomType.Hyperlink, parent: r, children: [] };
      o.anchor = s.default.attr(i, "anchor"), o.id = s.default.attr(i, "id");
      for (const u of s.default.elements(i)) u.localName === "r" && o.children.push(this.parseRun(u, o));
      return o;
    }
    parseSmartTag(i, r) {
      var o = { type: h.DomType.SmartTag, parent: r, children: [] }, u = s.default.attr(i, "uri"), y = s.default.attr(i, "element");
      u && (o.uri = u), y && (o.element = y);
      for (const p of s.default.elements(i)) switch (p.localName) {
        case "r":
          o.children.push(this.parseRun(p, o));
          break;
        case "smartTag":
          o.children.push(this.parseSmartTag(p, o));
      }
      return o;
    }
    parseSimpleField(i, r) {
      const o = { type: h.DomType.SimpleField, parent: r, children: [], instruction: s.default.attr(i, "instr"), lock: s.default.boolAttr(i, "lock", !1), dirty: s.default.boolAttr(i, "dirty", !1) };
      for (const u of s.default.elements(i)) switch (u.localName) {
        case "r":
          o.children.push(this.parseRun(u, o));
          break;
        case "hyperlink":
          o.children.push(this.parseHyperlink(u, o));
          break;
        case "smartTag":
          o.children.push(this.parseSmartTag(u, o));
          break;
        case "bookmarkStart":
          o.children.push((0, S.parseBookmarkStart)(u, s.default));
          break;
        case "bookmarkEnd":
          o.children.push((0, S.parseBookmarkEnd)(u, s.default));
          break;
        case "commentRangeStart":
          o.children.push(new $.WmlCommentRangeStart(s.default.attr(u, "id")));
          break;
        case "commentRangeEnd":
          o.children.push(new $.WmlCommentRangeEnd(s.default.attr(u, "id")));
          break;
        case "sdt":
          o.children.push(...this.parseSdt(u, (y) => this.parseParagraph(y).children));
          break;
        case "ins":
          o.children.push(this.parseInserted(u, (y) => this.parseParagraph(y)));
          break;
        case "del":
          o.children.push(this.parseDeleted(u, (y) => this.parseParagraph(y)));
      }
      return o;
    }
    parseRun(i, r) {
      var o = { type: h.DomType.Run, parent: r, children: [] };
      for (let u of s.default.elements(i)) if (u = this.checkAlternateContent(u), u) switch (u.localName) {
        case "t":
          o.children.push({ type: h.DomType.Text, text: u.textContent });
          break;
        case "delText":
          o.children.push({ type: h.DomType.DeletedText, text: u.textContent });
          break;
        case "commentReference":
          o.children.push(new $.WmlCommentReference(s.default.attr(u, "id")));
          break;
        case "fldSimple":
          o.children.push(this.parseSimpleField(u, o));
          break;
        case "instrText":
          o.fieldRun = !0, o.children.push({ type: h.DomType.Instruction, text: u.textContent });
          break;
        case "fldChar":
          o.fieldRun = !0, o.children.push({ type: h.DomType.ComplexField, charType: s.default.attr(u, "fldCharType"), lock: s.default.boolAttr(u, "lock", !1), dirty: s.default.boolAttr(u, "dirty", !1) });
          break;
        case "noBreakHyphen":
          o.children.push({ type: h.DomType.NoBreakHyphen });
          break;
        case "softHyphen":
          o.children.push({ type: h.DomType.SoftHyphen });
          break;
        case "cr":
          o.children.push({ type: h.DomType.Break, break: "line" });
          break;
        case "ptab":
          o.children.push({ type: h.DomType.PositionalTab });
          break;
        case "br":
          o.children.push({ type: h.DomType.Break, break: s.default.attr(u, "type") || "textWrapping" });
          break;
        case "lastRenderedPageBreak":
          o.children.push({ type: h.DomType.Break, break: "lastRenderedPageBreak" });
          break;
        case "sym":
          o.children.push({ type: h.DomType.Symbol, font: (0, F.encloseFontFamily)(s.default.attr(u, "font")), char: s.default.hexAttr(u, "char") });
          break;
        case "tab":
          o.children.push({ type: h.DomType.Tab });
          break;
        case "footnoteReference":
          o.children.push({ type: h.DomType.FootnoteReference, id: s.default.attr(u, "id") });
          break;
        case "endnoteReference":
          o.children.push({ type: h.DomType.EndnoteReference, id: s.default.attr(u, "id") });
          break;
        case "drawing":
          let y = this.parseDrawing(u);
          y && o.children.push(y);
          break;
        case "pict":
        case "object":
          o.children.push(this.parseVmlPicture(u));
          break;
        case "ruby":
          o.children.push(this.parseRuby(u));
          break;
        case "rPr":
          this.parseRunProperties(u, o);
      }
      return o;
    }
    parseRuby(i) {
      const r = { type: h.DomType.Ruby, children: [] };
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "rubyPr":
          for (const u of s.default.elements(o)) u.localName === "rubyAlign" && (r.align = s.default.attr(u, "val"));
          break;
        case "rt":
          r.children.push(this.parseRubyContent(o, h.DomType.RubyText));
          break;
        case "rubyBase":
          r.children.push(this.parseRubyContent(o, h.DomType.RubyBase));
      }
      return r;
    }
    parseRubyContent(i, r) {
      const o = { type: r, children: [] };
      for (const u of s.default.elements(i)) if (u.localName == "r") o.children.push(this.parseRun(u, o));
      else if (r == h.DomType.RubyText && u.localName == "rPr") {
        const y = s.default.element(u, "hps"), p = y ? s.default.intAttr(y, "val", null) : null;
        p != null && (o.cssStyle = { ...o.cssStyle ?? {}, fontSize: p / 2 + "pt" });
      }
      return o;
    }
    parseMathElement(i) {
      const r = `${i.localName}Pr`, o = { type: a[i.localName], children: [] };
      let u = !1;
      const y = (p) => {
        if (a[p.localName]) {
          const T = this.parseMathElement(p);
          T ? (T.parent = o, o.children.push(T)) : u = !0;
        } else if (p.localName == "r") {
          var g = this.parseRun(p, o);
          g.type = h.DomType.MmlRun, o.children.push(g);
        } else if (p.localName == r) o.props = this.parseMathProperies(p);
        else if (p.localName == "ins") for (const T of s.default.elements(p)) y(T);
        else if (p.localName == "del") if (this.options.renderChanges) for (const T of s.default.elements(p)) y(T);
        else u = !0;
      };
      for (const p of s.default.elements(i)) y(p);
      return u && !this.hasVisibleMathContent(o) ? null : o;
    }
    hasVisibleMathContent(i) {
      for (const r of i.children ?? []) {
        switch (r.type) {
          case h.DomType.Text:
            if (r.text?.length) return !0;
            break;
          case h.DomType.DeletedText:
            if (this.options.renderChanges && r.text?.length) return !0;
            break;
          case h.DomType.Symbol:
          case h.DomType.Tab:
          case h.DomType.PositionalTab:
          case h.DomType.NoBreakHyphen:
          case h.DomType.Break:
            return !0;
        }
        if (this.hasVisibleMathContent(r)) return !0;
      }
      return !1;
    }
    parseMathProperies(i) {
      const r = {};
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "chr":
          r.char = s.default.attr(o, "val");
          break;
        case "vertJc":
          r.verticalJustification = s.default.attr(o, "val");
          break;
        case "pos":
          r.position = s.default.attr(o, "val");
          break;
        case "degHide":
          r.hideDegree = s.default.boolAttr(o, "val");
          break;
        case "begChr":
          r.beginChar = s.default.attr(o, "val");
          break;
        case "endChr":
          r.endChar = s.default.attr(o, "val");
          break;
        case "limLoc":
          r.limitLocation = s.default.attr(o, "val");
          break;
        case "grow":
          r.grow = s.default.boolAttr(o, "val");
          break;
        case "sepChr":
          r.separatorChar = s.default.attr(o, "val");
      }
      return r;
    }
    parseRunProperties(i, r) {
      this.parseDefaultProperties(i, r.cssStyle = {}, null, (o) => {
        switch (o.localName) {
          case "rStyle":
            r.styleName = s.default.attr(o, "val");
            break;
          case "vertAlign":
            r.verticalAlign = f.valueOfVertAlign(o, !0);
            break;
          default:
            return !1;
        }
        return !0;
      });
    }
    parseVmlPicture(i) {
      const r = { type: h.DomType.VmlPicture, children: [] };
      for (const o of s.default.elements(i)) {
        const u = (0, R.parseVmlElement)(o, this);
        u && r.children.push(u);
      }
      return r;
    }
    checkAlternateContent(i) {
      if (i.localName != "AlternateContent") return i;
      for (const o of s.default.elements(i).filter((u) => u.localName == "Choice")) {
        const u = (s.default.attr(o, "Requires") ?? "").split(/\s+/).filter(Boolean);
        if (u.length > 0 && u.every((y) => t.includes(i.lookupNamespaceURI(y)))) {
          const y = s.default.elements(o)[0];
          if (y) return y;
        }
      }
      const r = s.default.element(i, "Fallback");
      return r ? s.default.elements(r)[0] : null;
    }
    parseDrawing(i) {
      for (var r of s.default.elements(i)) switch (r.localName) {
        case "inline":
        case "anchor":
          return this.parseDrawingWrapper(r);
      }
    }
    parseDrawingWrapper(i) {
      var r, o, u, y, p, g, T, w, L, I, Y, D = { type: h.DomType.Drawing, children: [], cssStyle: {}, props: {} }, Q = i.localName == "anchor";
      const X = { left: s.default.lengthAttr(i, "distL", M.LengthUsage.Emu), top: s.default.lengthAttr(i, "distT", M.LengthUsage.Emu), right: s.default.lengthAttr(i, "distR", M.LengthUsage.Emu), bottom: s.default.lengthAttr(i, "distB", M.LengthUsage.Emu) }, A = (C, E) => {
        E && (D.cssStyle[C] = f.addSize(D.cssStyle[C], E));
      };
      let B = null, _ = null, G = null, re = s.default.boolAttr(i, "simplePos", !1), ae = s.default.boolAttr(i, "behindDoc", !1), de = s.default.intAttr(i, "relativeHeight", null);
      de != null && (D.cssStyle["z-index"] = `${Math.max(1, Math.round(de / 1e3))}`), ae && (D.cssStyle["z-index"] = "0");
      let se = { relative: "page", align: "left", offset: "0" }, oe = { relative: "page", align: "top", offset: "0" }, fe = !1, ge = !1, Ce = !1;
      for (var K of s.default.elements(i)) switch (K.localName) {
        case "simplePos":
          re && (se.offset = s.default.lengthAttr(K, "x", M.LengthUsage.Emu), oe.offset = s.default.lengthAttr(K, "y", M.LengthUsage.Emu), ge = se.offset != null, Ce = oe.offset != null);
          break;
        case "extent":
          D.cssStyle.width = s.default.lengthAttr(K, "cx", M.LengthUsage.Emu), D.cssStyle.height = s.default.lengthAttr(K, "cy", M.LengthUsage.Emu);
          break;
        case "effectExtent":
          A("margin-left", s.default.lengthAttr(K, "l", M.LengthUsage.Emu)), A("margin-top", s.default.lengthAttr(K, "t", M.LengthUsage.Emu)), A("margin-right", s.default.lengthAttr(K, "r", M.LengthUsage.Emu)), A("margin-bottom", s.default.lengthAttr(K, "b", M.LengthUsage.Emu));
          break;
        case "docPr":
          D.props.title = s.default.attr(K, "title") ?? s.default.attr(K, "name"), D.props.alt = s.default.attr(K, "descr") ?? D.props.title;
          break;
        case "positionH":
        case "positionV":
          if (!re) {
            let C = K.localName == "positionH", E = C ? se : oe;
            var we = s.default.element(K, "align"), Se = s.default.element(K, "posOffset");
            E.relative = s.default.attr(K, "relativeFrom") ?? E.relative, we && (E.align = we.textContent, C && (fe = !0)), Se && (E.offset = (0, M.convertLength)(Se.textContent, M.LengthUsage.Emu), C ? ge = E.offset != null : Ce = E.offset != null);
          }
          break;
        case "wrapTopAndBottom":
          B = "wrapTopAndBottom";
          break;
        case "wrapNone":
          B = "wrapNone";
          break;
        case "wrapSquare":
          B = "wrapSquare", _ = s.default.attr(K, "wrapText");
          break;
        case "wrapTight":
          B = "wrapTight", _ = s.default.attr(K, "wrapText"), G = this.parseWrapPolygon(K);
          break;
        case "wrapThrough":
          B = "wrapThrough", _ = s.default.attr(K, "wrapText"), G = this.parseWrapPolygon(K);
          break;
        case "graphic":
          var he = this.parseGraphic(K);
          he && (he.type == h.DomType.Image ? ((r = he).alt ?? (r.alt = D.props.alt), (o = he).title ?? (o.title = D.props.title)) : he.type == h.DomType.Shape ? ((u = he).alt ?? (u.alt = D.props.alt), (y = he).title ?? (y.title = D.props.title)) : he.type == h.DomType.Chart ? ((p = he).alt ?? (p.alt = D.props.alt), (g = he).title ?? (g.title = D.props.title)) : he.type == h.DomType.SmartArt ? ((T = he).alt ?? (T.alt = D.props.alt), (w = he).title ?? (w.title = D.props.title)) : he.type == h.DomType.Ink && ((L = he).alt ?? (L.alt = D.props.alt), (I = he).title ?? (I.title = D.props.title)), D.children.push(he));
      }
      D.props.anchorPosition = { horizontal: { ...se }, vertical: { ...oe }, wrapType: B, layoutInCell: s.default.boolAttr(i, "layoutInCell", !0), simplePos: re }, B != "wrapNone" && (A("margin-left", X.left), A("margin-top", X.top), A("margin-right", X.right), A("margin-bottom", X.bottom));
      const x = () => {
        switch (se.align) {
          case "center":
            D.cssStyle["margin-left"] = "auto", D.cssStyle["margin-right"] = "auto";
            break;
          case "right":
            D.cssStyle["margin-left"] = "auto";
        }
      };
      return B == "wrapTopAndBottom" ? (D.cssStyle.display = "block", D.cssStyle.clear = "both", fe ? x() : ge && se.offset && (D.cssStyle["margin-inline-start"] = f.addSize(D.cssStyle["margin-inline-start"], se.offset)), Ce && oe.offset && (D.cssStyle["margin-top"] = f.addSize(D.cssStyle["margin-top"], oe.offset))) : B == "wrapNone" ? (D.cssStyle.display = "block", D.cssStyle.position = Q ? "absolute" : "relative", se.offset && (D.cssStyle.left = se.offset), oe.offset && (D.cssStyle.top = oe.offset)) : B == "wrapSquare" || B == "wrapTight" || B == "wrapThrough" ? (G && (D.cssStyle["shape-outside"] = G, (Y = D.cssStyle)["clip-path"] ?? (Y["clip-path"] = G)), _ == "left" ? D.cssStyle.float = "right" : _ == "right" ? D.cssStyle.float = "left" : se.align == "left" || se.align == "right" ? D.cssStyle.float = se.align : (D.cssStyle.display = "block", x())) : !Q || se.align != "left" && se.align != "right" ? D.cssStyle["vertical-align"] = "text-bottom" : D.cssStyle.float = se.align, D;
    }
    parseWrapPolygon(i) {
      const r = s.default.element(i, "wrapPolygon");
      if (!r) return null;
      const o = [], u = (y) => {
        const p = s.default.lengthAttr(y, "x", M.LengthUsage.Emu), g = s.default.lengthAttr(y, "y", M.LengthUsage.Emu);
        p && g && o.push(`${p} ${g}`);
      };
      for (const y of s.default.elements(r)) y.localName != "start" && y.localName != "lineTo" || u(y);
      return o.length >= 3 ? `polygon(${o.join(", ")})` : null;
    }
    parseGraphic(i) {
      var r = s.default.element(i, "graphicData");
      if (!r) return null;
      for (let u of s.default.elements(r)) switch (u.localName) {
        case "pic":
          return this.parsePicture(u);
        case "wpc":
        case "wgp":
        case "grpSp":
          return this.parseDrawingContainer(u);
        case "wsp":
        case "sp":
        case "cxnSp":
          return this.parseWordprocessingShape(u);
        case "chart":
          return this.parseChartReference(u);
        case "relIds":
        case "diagram":
          return this.parseSmartArtReference(u);
        case "contentPart":
        case "ink":
          return this.parseInkReference(u);
      }
      const o = this.findDescendant(r, "contentPart");
      return o ? this.parseInkReference(o) : null;
    }
    parseDrawingContainer(i, r) {
      const o = { type: h.DomType.Shape, children: [], cssStyle: { display: "inline-block", position: "relative", width: "100%", height: "100%", overflow: "visible", "box-sizing": "border-box" }, props: { dmlContainer: !0 } }, u = this.parseDmlGroupTransform(i, r);
      for (const y of s.default.elements(i)) switch (y.localName) {
        case "wsp":
        case "sp":
        case "cxnSp":
          const p = this.parseDmlPositionedShape(y, u);
          p && o.children.push(p);
          break;
        case "pic":
          const g = this.parseDmlPositionedPicture(y, u);
          g && o.children.push(g);
          break;
        case "grpSp":
        case "wgp":
          const T = this.parseDrawingContainer(y, u);
          T && o.children.push(T);
      }
      return o;
    }
    parseDmlGroupTransform(i, r) {
      const o = s.default.element(i, "grpSpPr"), u = o ? s.default.element(o, "xfrm") : s.default.element(i, "xfrm"), y = u ? s.default.element(u, "off") : null, p = u ? s.default.element(u, "ext") : null, g = u ? s.default.element(u, "chOff") : null, T = u ? s.default.element(u, "chExt") : null, w = p ? s.default.floatAttr(p, "cx", null) : null, L = p ? s.default.floatAttr(p, "cy", null) : null, I = T ? s.default.floatAttr(T, "cx", null) : null, Y = T ? s.default.floatAttr(T, "cy", null) : null, D = r?.scaleX ?? 1, Q = r?.scaleY ?? 1, X = y ? s.default.floatAttr(y, "x", 0) : 0, A = y ? s.default.floatAttr(y, "y", 0) : 0;
      return { originX: r ? r.originX + (X - r.offsetX) * D : 0, originY: r ? r.originY + (A - r.offsetY) * Q : 0, offsetX: g ? s.default.floatAttr(g, "x", 0) : 0, offsetY: g ? s.default.floatAttr(g, "y", 0) : 0, scaleX: D * (w && I ? w / I : 1), scaleY: Q * (L && Y ? L / Y : 1) };
    }
    parseDmlPositionedPicture(i, r) {
      const o = this.parsePicture(i), u = s.default.element(i, "spPr");
      if (!o || !u) return o;
      const y = this.parseDmlShapeBounds(u, r);
      return o.cssStyle.position = "absolute", o.cssStyle.left = this.pt(y.left), o.cssStyle.top = this.pt(y.top), o.cssStyle.width = this.pt(y.width), o.cssStyle.height = this.pt(y.height), o;
    }
    parseDmlPositionedShape(i, r) {
      const o = s.default.element(i, "spPr");
      if (!o) return null;
      const u = this.parseDmlShapeBounds(o, r), y = [];
      let p = null, g = !1;
      for (const X of s.default.elements(i)) switch (X.localName) {
        case "txbx":
        case "textBox":
          g = !0;
          for (const A of s.default.elements(X, "txbxContent")) y.push(...this.parseBodyElements(A));
          break;
        case "bodyPr":
          p = X;
      }
      p ?? (p = s.default.element(i, "bodyPr"));
      const T = { position: "absolute", left: this.pt(u.left), top: this.pt(u.top), width: this.pt(u.width), height: this.pt(u.height), "box-sizing": "border-box", overflow: "hidden" }, w = s.default.element(i, "cNvPr"), L = s.default.element(o, "custGeom"), I = s.default.element(o, "prstGeom"), Y = this.parseDmlFillStyle(o), D = this.parseDmlLineStyle(s.default.element(o, "ln"));
      if (L) {
        const X = this.parseDmlCustomGeometry(L);
        return { type: h.DomType.Shape, children: [], cssStyle: { ...T, overflow: "visible" }, props: { dmlSvg: !0, viewBox: X?.viewBox ?? "0 0 1 1", pathD: X?.d ?? "", fill: Y.fill ?? "none", stroke: D.stroke ?? "none", strokeWidth: D.strokeWidth ?? "0", strokeDasharray: D.strokeDasharray }, title: w ? s.default.attr(w, "title") ?? s.default.attr(w, "name") : null, alt: w ? s.default.attr(w, "descr") : null };
      }
      Y.backgroundColor && (T["background-color"] = Y.backgroundColor), Y.backgroundImage && (T["background-image"] = Y.backgroundImage), D.stroke && D.stroke != "none" ? T.border = `${D.strokeWidth || "0.75pt"} ${D.borderType || "solid"} ${D.stroke}` : T.border = "none";
      const Q = g ? this.parseDmlTextBoxProperties(p) : null;
      return { type: h.DomType.Shape, children: y, cssStyle: T, props: { dmlShape: !0, presetGeometry: I ? s.default.attr(I, "prst") : null, ...Q }, title: w ? s.default.attr(w, "title") ?? s.default.attr(w, "name") : null, alt: w ? s.default.attr(w, "descr") : null };
    }
    parseDmlShapeBounds(i, r) {
      const o = s.default.element(i, "xfrm"), u = o ? s.default.element(o, "off") : null, y = o ? s.default.element(o, "ext") : null, p = r?.scaleX ?? 1, g = r?.scaleY ?? 1, T = r?.offsetX ?? 0, w = r?.offsetY ?? 0, L = r?.originX ?? 0, I = r?.originY ?? 0, Y = u ? s.default.floatAttr(u, "x", 0) : 0, D = u ? s.default.floatAttr(u, "y", 0) : 0, Q = y ? s.default.floatAttr(y, "cx", 0) : 0, X = y ? s.default.floatAttr(y, "cy", 0) : 0;
      return { left: this.emuToPt(L + (Y - T) * p), top: this.emuToPt(I + (D - w) * g), width: Math.max(0, this.emuToPt(Q * p)), height: Math.max(0, this.emuToPt(X * g)) };
    }
    parseDmlFillStyle(i) {
      if (s.default.element(i, "noFill")) return { fill: "none", backgroundColor: "transparent" };
      const r = s.default.element(i, "solidFill");
      if (r) {
        const u = this.parseDmlColor(r) ?? "transparent";
        return { fill: u, backgroundColor: u };
      }
      const o = s.default.element(i, "pattFill");
      if (o) {
        const u = this.parseDmlColor(s.default.element(o, "fgClr")) ?? "currentColor", y = this.parseDmlColor(s.default.element(o, "bgClr")) ?? "transparent", p = s.default.attr(o, "prst");
        return { fill: y, backgroundColor: y, backgroundImage: `repeating-linear-gradient(${p && p.toLowerCase().includes("horz") ? "0deg" : "90deg"}, ${u} 0, ${u} 0.75pt, ${y} 0.75pt, ${y} 3pt)` };
      }
      return { fill: "none", backgroundColor: "transparent" };
    }
    parseDmlLineStyle(i) {
      if (!i || s.default.element(i, "noFill")) return { stroke: "none", strokeWidth: "0", borderType: "none" };
      const r = this.parseDmlColor(s.default.element(i, "solidFill")) ?? "black", o = s.default.attr(i, "w") ? this.pt(this.emuToPt(s.default.floatAttr(i, "w", 0))) : "0.75pt", u = s.default.elementAttr(i, "prstDash", "val");
      let y = null, p = "solid";
      return u && u != "solid" && (p = "dashed", y = u == "dot" ? "1 2" : "4 3"), { stroke: r, strokeWidth: o, borderType: p, strokeDasharray: y };
    }
    parseDmlCustomGeometry(i) {
      const r = s.default.element(i, "pathLst"), o = r ? s.default.elements(r, "path") : [];
      let u = "", y = 1, p = 1;
      for (const g of o) {
        const T = s.default.floatAttr(g, "w", y), w = s.default.floatAttr(g, "h", p);
        y = Math.max(y, T || 1), p = Math.max(p, w || 1), u += this.parseDmlPathData(g, T || 1, w || 1);
      }
      return { d: u.trim(), viewBox: `0 0 ${y} ${p}` };
    }
    parseDmlPathData(i, r, o) {
      const u = [], y = (p) => {
        const g = s.default.element(p, "pt");
        return g ? `${this.dmlCoord(s.default.attr(g, "x"), r, o)} ${this.dmlCoord(s.default.attr(g, "y"), r, o)}` : "0 0";
      };
      for (const p of s.default.elements(i)) switch (p.localName) {
        case "moveTo":
          u.push(`M ${y(p)}`);
          break;
        case "lnTo":
          u.push(`L ${y(p)}`);
          break;
        case "cubicBezTo":
          const g = s.default.elements(p, "pt").map((w) => `${this.dmlCoord(s.default.attr(w, "x"), r, o)} ${this.dmlCoord(s.default.attr(w, "y"), r, o)}`);
          g.length == 3 && u.push(`C ${g.join(" ")}`);
          break;
        case "quadBezTo":
          const T = s.default.elements(p, "pt").map((w) => `${this.dmlCoord(s.default.attr(w, "x"), r, o)} ${this.dmlCoord(s.default.attr(w, "y"), r, o)}`);
          T.length == 2 && u.push(`Q ${T.join(" ")}`);
          break;
        case "close":
          u.push("Z");
      }
      return u.join(" ") + " ";
    }
    dmlCoord(i, r, o) {
      if (i == "w" || i == "r") return r;
      if (i == "h" || i == "b") return o;
      if (i == "l" || i == "t") return 0;
      const u = parseFloat(i);
      return Number.isFinite(u) ? u : 0;
    }
    dmlVerticalAlign(i) {
      switch (i ? s.default.attr(i, "anchor") : null) {
        case "ctr":
          return "center";
        case "b":
          return "flex-end";
        default:
          return "flex-start";
      }
    }
    applyDmlTextInsets(i, r) {
      if (!i) return;
      const o = { lIns: "padding-left", tIns: "padding-top", rIns: "padding-right", bIns: "padding-bottom" };
      for (const [u, y] of Object.entries(o)) {
        const p = s.default.attr(i, u);
        p != null && (r[y] = this.pt(this.emuToPt(parseFloat(p))));
      }
    }
    parseDmlTextBoxProperties(i) {
      const r = {};
      return this.applyDmlTextInsets(i, r), { dmlTextBox: !0, textInsets: r, textVerticalAlign: this.dmlVerticalAlign(i) };
    }
    emuToPt(i) {
      return (Number.isFinite(i) ? i : 0) / 12700;
    }
    pt(i) {
      return Math.round(100 * i) / 100 + "pt";
    }
    parseChartReference(i) {
      return { type: h.DomType.Chart, id: s.default.attr(i, "id"), cssStyle: { width: "100%", height: "100%" } };
    }
    parseSmartArtReference(i) {
      const r = i.localName == "relIds" ? i : this.findDescendant(i, "relIds");
      return { type: h.DomType.SmartArt, dataId: r ? s.default.attr(r, "dm") : s.default.attr(i, "dm"), layoutId: r ? s.default.attr(r, "lo") : s.default.attr(i, "lo"), styleId: r ? s.default.attr(r, "qs") : s.default.attr(i, "qs"), colorId: r ? s.default.attr(r, "cs") : s.default.attr(i, "cs"), cssStyle: { width: "100%", height: "100%" } };
    }
    parseInkReference(i) {
      return { type: h.DomType.Ink, id: s.default.attr(i, "id"), cssStyle: { width: "100%", height: "100%" } };
    }
    parseGraphicPlaceholder(i) {
      return { type: h.DomType.Shape, children: [{ type: h.DomType.Text, text: `[${i}]` }], cssStyle: { display: "inline-flex", "align-items": "center", "justify-content": "center", border: "1px solid #999", "background-color": "#f8f8f8", color: "#555", "min-width": "2in", "min-height": "1in" } };
    }
    parseWordprocessingShape(i) {
      const r = { type: h.DomType.Shape, children: [], cssStyle: { display: "inline-block", position: "relative", "box-sizing": "border-box", overflow: "hidden" } }, o = this.findDescendant(i, "cNvPr");
      let u = null, y = !1;
      o && (r.title = s.default.attr(o, "title") ?? s.default.attr(o, "name"), r.alt = s.default.attr(o, "descr") ?? r.title);
      for (const p of s.default.elements(i)) switch (p.localName) {
        case "spPr":
          this.parseDmlShapeProperties(p, r.cssStyle);
          break;
        case "txbx":
        case "textBox":
          y = !0;
          for (const g of s.default.elements(p, "txbxContent")) r.children.push(...this.parseBodyElements(g));
          break;
        case "bodyPr":
          u = p;
      }
      return y && (r.props = { ...r.props ?? {}, ...this.parseDmlTextBoxProperties(u) }), r;
    }
    parseDmlShapeProperties(i, r) {
      const o = s.default.element(i, "xfrm");
      if (o) for (const g of s.default.elements(o)) g.localName === "ext" && (r.width = s.default.lengthAttr(g, "cx", M.LengthUsage.Emu), r.height = s.default.lengthAttr(g, "cy", M.LengthUsage.Emu));
      const u = s.default.element(i, "solidFill"), y = s.default.element(i, "noFill"), p = s.default.element(i, "ln");
      if (u ? r["background-color"] = this.parseDmlColor(u) ?? r["background-color"] : y && (r["background-color"] = "transparent"), p && s.default.element(p, "noFill")) r.border = "none";
      else if (p) {
        const g = this.parseDmlColor(s.default.element(p, "solidFill")) ?? "black", T = s.default.lengthAttr(p, "w", M.LengthUsage.Emu) ?? "1px", w = s.default.elementAttr(p, "prstDash", "val"), L = w && w != "solid" ? "dashed" : "solid";
        r.border = `${T} ${L} ${g}`;
      }
    }
    parseDmlColor(i) {
      if (!i) return null;
      const r = s.default.element(i, "srgbClr"), o = s.default.element(i, "schemeClr"), u = s.default.element(i, "prstClr"), y = s.default.element(i, "sysClr");
      if (r) return this.applyDmlColorTransforms(r, `#${s.default.attr(r, "val")}`);
      if (o) {
        const p = this.resolveDmlSchemeColor(s.default.attr(o, "val")), g = this.dmlSchemeColorFallback(p);
        return this.applyDmlColorTransforms(o, `var(--docx-${p}-color${g ? `, ${g}` : ""})`);
      }
      return y ? this.applyDmlColorTransforms(y, `#${s.default.attr(y, "lastClr") ?? s.default.attr(y, "val")}`) : u ? this.applyDmlColorTransforms(u, s.default.attr(u, "val")) : null;
    }
    resolveDmlSchemeColor(i) {
      switch (i) {
        case "bg1":
          return "lt1";
        case "tx1":
          return "dk1";
        case "bg2":
          return "lt2";
        case "tx2":
          return "dk2";
        default:
          return i;
      }
    }
    dmlSchemeColorFallback(i) {
      return l(i);
    }
    applyDmlColorTransforms(i, r) {
      const o = s.default.elementAttr(i, "lumMod", "val"), u = s.default.elementAttr(i, "lumOff", "val");
      if (o != null) {
        const y = Math.max(0, Math.min(100, parseFloat(o) / 1e3));
        Number.isFinite(y) && y < 100 && (r = `color-mix(in srgb, ${r} ${y}%, black)`);
      }
      if (u != null) {
        const y = Math.max(0, Math.min(100, parseFloat(u) / 1e3));
        Number.isFinite(y) && y > 0 && (r = `color-mix(in srgb, ${r} ${100 - y}%, white)`);
      }
      return r;
    }
    findDescendant(i, r) {
      for (const o of s.default.elements(i)) {
        if (o.localName == r) return o;
        const u = this.findDescendant(o, r);
        if (u) return u;
      }
      return null;
    }
    parsePicture(i) {
      var r = { type: h.DomType.Image, src: "", cssStyle: {} }, o = s.default.element(i, "blipFill"), u = o ? s.default.element(o, "blip") : null, y = o ? s.default.element(o, "srcRect") : null;
      r.src = u ? s.default.attr(u, "embed") ?? s.default.attr(u, "link") : "";
      const p = this.findDescendant(i, "cNvPr");
      p && (r.title = s.default.attr(p, "title") ?? s.default.attr(p, "name"), r.alt = s.default.attr(p, "descr") ?? r.title), y && (r.srcRect = [s.default.intAttr(y, "l", 0) / 1e5, s.default.intAttr(y, "t", 0) / 1e5, s.default.intAttr(y, "r", 0) / 1e5, s.default.intAttr(y, "b", 0) / 1e5]);
      var g = s.default.element(i, "spPr"), T = g ? s.default.element(g, "xfrm") : null, w = [];
      if (r.cssStyle.display = "block", r.cssStyle.position = "relative", r.cssStyle["object-fit"] = "contain", T) for (var L of (r.rotation = s.default.intAttr(T, "rot", 0) / 6e4, s.default.boolAttr(T, "flipH", !1) && w.push("scaleX(-1)"), s.default.boolAttr(T, "flipV", !1) && w.push("scaleY(-1)"), s.default.elements(T))) L.localName === "ext" && (r.cssStyle.width = s.default.lengthAttr(L, "cx", M.LengthUsage.Emu), r.cssStyle.height = s.default.lengthAttr(L, "cy", M.LengthUsage.Emu));
      return w.length > 0 && (r.cssStyle.transform = w.join(" ")), r.cssStyle.width || (r.cssStyle.width = "100%"), r.cssStyle.height || (r.cssStyle.height = "100%"), r;
    }
    parseTable(i) {
      var r = { type: h.DomType.Table, children: [] };
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "tr":
          r.children.push(this.parseTableRow(o));
          break;
        case "tblGrid":
          r.columns = this.parseTableColumns(o);
          break;
        case "tblPr":
          this.parseTableProperties(o, r);
      }
      return r;
    }
    parseTableColumns(i) {
      var r = [];
      for (const o of s.default.elements(i)) o.localName === "gridCol" && r.push({ width: s.default.lengthAttr(o, "w") });
      return r;
    }
    parseTableProperties(i, r) {
      r.cssStyle = {}, r.cellStyle = {};
      let o = null;
      switch (this.parseDefaultProperties(i, r.cssStyle, r.cellStyle, (u) => {
        switch (u.localName) {
          case "tblStyle":
            r.styleName = s.default.attr(u, "val");
            break;
          case "tblLook":
            r.className = f.classNameOftblLook(u);
            break;
          case "tblInd":
            o = this.parseTableIndentation(u);
            break;
          case "tblpPr":
            this.parseTablePosition(u, r);
            break;
          case "tblStyleColBandSize":
            r.colBandSize = s.default.intAttr(u, "val");
            break;
          case "tblStyleRowBandSize":
            r.rowBandSize = s.default.intAttr(u, "val");
            break;
          case "hidden":
            r.cssStyle.display = "none";
            break;
          default:
            return !1;
        }
        return !0;
      }), r.cssStyle["text-align"]) {
        case "center":
          delete r.cssStyle["text-align"], r.cssStyle["margin-left"] = "auto", r.cssStyle["margin-right"] = "auto";
          break;
        case "right":
          delete r.cssStyle["text-align"], r.cssStyle["margin-left"] = "auto";
          break;
        default:
          delete r.cssStyle["text-align"], o && (r.cssStyle["margin-inline-start"] = f.addSize(r.cssStyle["margin-inline-start"], o));
      }
    }
    parseTableIndentation(i) {
      const r = s.default.attr(i, "type");
      return r == "pct" || r == "auto" ? null : s.default.lengthAttr(i, "w", M.LengthUsage.SignedDxa);
    }
    parseTablePosition(i, r) {
      var o = s.default.lengthAttr(i, "topFromText"), u = s.default.lengthAttr(i, "bottomFromText"), y = s.default.lengthAttr(i, "rightFromText"), p = s.default.lengthAttr(i, "leftFromText");
      r.cssStyle.float = "left", r.cssStyle["margin-bottom"] = f.addSize(r.cssStyle["margin-bottom"], u), r.cssStyle["margin-left"] = f.addSize(r.cssStyle["margin-left"], p), r.cssStyle["margin-right"] = f.addSize(r.cssStyle["margin-right"], y), r.cssStyle["margin-top"] = f.addSize(r.cssStyle["margin-top"], o);
    }
    parseTableRow(i) {
      var r = { type: h.DomType.Row, children: [] };
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "tc":
          r.children.push(this.parseTableCell(o));
          break;
        case "trPr":
        case "tblPrEx":
          this.parseTableRowProperties(o, r);
      }
      return r.children = this.normalizeHorizontalMerges(r.children), r;
    }
    normalizeHorizontalMerges(i) {
      const r = [];
      for (let o = 0; o < i.length; o++) {
        const u = i[o];
        if (u.horizontalMerge != "restart") {
          r.push(u);
          continue;
        }
        let y = u.span ?? 1, p = o + 1;
        for (; p < i.length && i[p].horizontalMerge == "continue"; ) y += i[p].span ?? 1, p++;
        p > o + 1 && (u.span = y, o = p - 1), r.push(u);
      }
      return r;
    }
    parseTableRowProperties(i, r) {
      const o = {};
      r.cssStyle = this.parseDefaultProperties(i, o, null, (u) => {
        switch (u.localName) {
          case "cnfStyle":
            r.className = f.classNameOfCnfStyle(u);
            break;
          case "tblHeader":
            r.isHeader = s.default.boolAttr(u, "val");
            break;
          case "gridBefore":
            r.gridBefore = s.default.intAttr(u, "val");
            break;
          case "gridAfter":
            r.gridAfter = s.default.intAttr(u, "val");
            break;
          case "cantSplit":
            s.default.boolAttr(u, "val", !0) && (o["break-inside"] = "avoid");
            break;
          default:
            return !1;
        }
        return !0;
      });
    }
    parseTableCell(i) {
      var r = { type: h.DomType.Cell, children: [] };
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "tbl":
          r.children.push(this.parseTable(o));
          break;
        case "p":
          r.children.push(this.parseParagraph(o));
          break;
        case "tcPr":
          this.parseTableCellProperties(o, r);
      }
      return r;
    }
    parseTableCellProperties(i, r) {
      r.cssStyle = this.parseDefaultProperties(i, {}, null, (o) => {
        switch (o.localName) {
          case "gridSpan":
            r.span = s.default.intAttr(o, "val", null);
            break;
          case "hMerge":
            r.horizontalMerge = s.default.attr(o, "val") ?? "continue";
            break;
          case "vMerge":
            r.verticalMerge = s.default.attr(o, "val") ?? "continue";
            break;
          case "cnfStyle":
            r.className = f.classNameOfCnfStyle(o);
            break;
          default:
            return !1;
        }
        return !0;
      }), this.parseTableCellVerticalText(i, r);
    }
    parseTableCellVerticalText(i, r) {
      const o = { btLr: { writingMode: "vertical-rl", transform: "rotate(180deg)" }, lrTb: { writingMode: "vertical-lr", transform: "none" }, tbRl: { writingMode: "vertical-rl", transform: "none" } };
      for (const u of s.default.elements(i)) if (u.localName === "textDirection") {
        const y = o[s.default.attr(u, "val")] || { writingMode: "horizontal-tb" };
        r.cssStyle["writing-mode"] = y.writingMode, r.cssStyle.transform = y.transform;
      }
    }
    parseDefaultProperties(i, r = null, o = null, u = null) {
      r = r || {};
      const y = s.default.element(i, "lang"), p = { latin: y ? s.default.attr(y, "val") : "", eastAsia: y ? s.default.attr(y, "eastAsia") : "", bidi: y ? s.default.attr(y, "bidi") : "" };
      for (const g of s.default.elements(i)) if (!u?.(g)) switch (g.localName) {
        case "jc":
          r["text-align"] = f.valueOfJc(g);
          break;
        case "textAlignment":
          r["vertical-align"] = f.valueOfTextAlignment(g);
          break;
        case "color":
          r.color = m.colorAttr(g, "val", null, b.autos.color);
          break;
        case "sz":
          r["font-size"] = r["min-height"] = s.default.lengthAttr(g, "val", M.LengthUsage.FontSize);
          break;
        case "szCs":
          r["font-size"] ?? (r["font-size"] = s.default.lengthAttr(g, "val", M.LengthUsage.FontSize)), r["min-height"] ?? (r["min-height"] = r["font-size"]);
          break;
        case "shd":
          r["background-color"] = m.colorAttr(g, "fill", null, b.autos.shd);
          break;
        case "highlight":
          r["background-color"] = m.colorAttr(g, "val", null, b.autos.highlight);
          break;
        case "vertAlign":
          r["vertical-align"] = f.valueOfVertAlign(g);
          break;
        case "position":
          r["vertical-align"] = s.default.lengthAttr(g, "val", M.LengthUsage.SignedHalfPoint);
          break;
        case "scale":
          r["font-stretch"] = `${s.default.intAttr(g, "val", 100)}%`;
          break;
        case "tcW":
          if (this.options.ignoreWidth) break;
        case "tblW":
          r.width = f.valueOfSize(g, "w");
          break;
        case "trHeight":
          this.parseTrHeight(g, r);
          break;
        case "strike":
          r["text-decoration"] = s.default.boolAttr(g, "val", !0) ? "line-through" : "none";
          break;
        case "dstrike":
          s.default.boolAttr(g, "val", !0) ? (r["text-decoration-line"] = "line-through", r["text-decoration-style"] = "double") : r["text-decoration"] = "none";
          break;
        case "b":
          r["font-weight"] = s.default.boolAttr(g, "val", !0) ? "bold" : "normal";
          break;
        case "i":
          r["font-style"] = s.default.boolAttr(g, "val", !0) ? "italic" : "normal";
          break;
        case "bCs":
          r["--docx-bidi-font-weight"] = s.default.boolAttr(g, "val", !0) ? "bold" : "normal", r.direction == "rtl" && (r["font-weight"] = r["--docx-bidi-font-weight"]);
          break;
        case "iCs":
          r["--docx-bidi-font-style"] = s.default.boolAttr(g, "val", !0) ? "italic" : "normal", r.direction == "rtl" && (r["font-style"] = r["--docx-bidi-font-style"]);
          break;
        case "caps":
          r["text-transform"] = s.default.boolAttr(g, "val", !0) ? "uppercase" : "none";
          break;
        case "smallCaps":
          r["font-variant"] = s.default.boolAttr(g, "val", !0) ? "small-caps" : "none";
          break;
        case "rtl":
          s.default.boolAttr(g, "val", !0) && (r.direction = "rtl", r["unicode-bidi"] = "embed", r["--docx-bidi-font-weight"] && (r["font-weight"] = r["--docx-bidi-font-weight"]), r["--docx-bidi-font-style"] && (r["font-style"] = r["--docx-bidi-font-style"]));
          break;
        case "outline":
          s.default.boolAttr(g, "val", !0) && (r["-webkit-text-stroke"] = "0.5px currentColor");
          break;
        case "shadow":
          s.default.boolAttr(g, "val", !0) && (r["text-shadow"] = "1px 1px 0 currentColor");
          break;
        case "emboss":
          s.default.boolAttr(g, "val", !0) && (r["text-shadow"] = "-1px -1px 0 rgba(255,255,255,.75), 1px 1px 0 rgba(0,0,0,.35)");
          break;
        case "imprint":
          s.default.boolAttr(g, "val", !0) && (r["text-shadow"] = "1px 1px 0 rgba(255,255,255,.75), -1px -1px 0 rgba(0,0,0,.35)");
          break;
        case "em":
          r["text-emphasis-style"] = f.valueOfEmphasisMark(g);
          break;
        case "u":
          this.parseUnderline(g, r);
          break;
        case "ind":
        case "tblInd":
          this.parseIndentation(g, r);
          break;
        case "rFonts":
          this.parseFont(g, r, p);
          break;
        case "tblBorders":
          this.parseBorderProperties(g, o || r);
          break;
        case "tblCellSpacing":
          r["border-spacing"] = f.valueOfMargin(g), r["border-collapse"] = "separate";
          break;
        case "pBdr":
          this.parseBorderProperties(g, r);
          break;
        case "bdr":
          r.border = f.valueOfBorder(g);
          break;
        case "tcBorders":
          this.parseBorderProperties(g, r);
          break;
        case "vanish":
          s.default.boolAttr(g, "val", !0) && (r.display = "none");
          break;
        case "kern":
          r["font-kerning"] = s.default.intAttr(g, "val", 0) > 0 ? "normal" : "none";
          break;
        case "noWrap":
          r["white-space"] = s.default.boolAttr(g, "val", !0) ? "nowrap" : "normal";
          break;
        case "snapToGrid":
          r["--docx-snap-to-grid"] = s.default.boolAttr(g, "val", !0) ? "1" : "0";
          break;
        case "fitText":
          this.parseFitText(g, r);
          break;
        case "eastAsianLayout":
          this.parseEastAsianLayout(g, r);
          break;
        case "tblCellMar":
        case "tcMar":
          this.parseMarginProperties(g, o || r);
          break;
        case "tblLayout":
          r["table-layout"] = f.valueOfTblLayout(g);
          break;
        case "vAlign":
          r["vertical-align"] = f.valueOfTextAlignment(g);
          break;
        case "spacing":
          i.localName == "pPr" ? this.parseSpacing(g, r) : i.localName == "rPr" && (r["letter-spacing"] = s.default.lengthAttr(g, "val", M.LengthUsage.SignedDxa));
          break;
        case "wordWrap":
          s.default.boolAttr(g, "val") && (r["overflow-wrap"] = "break-word");
          break;
        case "suppressAutoHyphens":
          r.hyphens = s.default.boolAttr(g, "val", !0) ? "none" : "auto";
          break;
        case "lang":
          r.$lang = s.default.attr(g, "val"), r["$lang-eastAsia"] = s.default.attr(g, "eastAsia"), r["$lang-bidi"] = s.default.attr(g, "bidi");
          break;
        case "rtl":
        case "bidi":
          s.default.boolAttr(g, "val", !0) && (r.direction = "rtl");
          break;
        case "pageBreakBefore":
          s.default.boolAttr(g, "val", !0) && (r["break-before"] = "page");
          break;
        case "keepLines":
          s.default.boolAttr(g, "val", !0) && (r["break-inside"] = "avoid");
          break;
        case "keepNext":
          s.default.boolAttr(g, "val", !0) && (r["break-after"] = "avoid");
          break;
        case "widowControl":
          s.default.boolAttr(g, "val", !0) && (r.orphans = "2", r.widows = "2");
          break;
        case "webHidden":
          this.options.hideWebHiddenContent && s.default.boolAttr(g, "val", !0) && (r.display = "none");
          break;
        case "specVanish":
          s.default.boolAttr(g, "val", !0) && (r.display = "none");
          break;
        case "tabs":
        case "outlineLvl":
        case "contextualSpacing":
        case "tblStyleColBandSize":
        case "tblStyleRowBandSize":
        case "suppressLineNumbers":
        case "noProof":
          break;
        default:
          this.options.debug && console.warn(`DOCX: Unknown document element: ${i.localName}.${g.localName}`);
      }
      return r;
    }
    parseFitText(i, r) {
      const o = s.default.lengthAttr(i, "val");
      o && (r.display = "inline-block", r.width = o, r["text-align"] = "justify", r["text-align-last"] = "justify");
    }
    parseEastAsianLayout(i, r) {
      s.default.boolAttr(i, "combine", !1) && (r["text-combine-upright"] = "all"), s.default.boolAttr(i, "vert", !1) && (r["writing-mode"] = "vertical-rl"), s.default.boolAttr(i, "vertCompress", !1) && (r["font-stretch"] = "condensed");
    }
    parseUnderline(i, r) {
      var o = s.default.attr(i, "val");
      if (o != null) {
        switch (o) {
          case "dash":
          case "dashDotDotHeavy":
          case "dashDotHeavy":
          case "dashedHeavy":
          case "dashLong":
          case "dashLongHeavy":
          case "dotDash":
          case "dotDotDash":
            r["text-decoration"] = "underline dashed";
            break;
          case "dotted":
          case "dottedHeavy":
            r["text-decoration"] = "underline dotted";
            break;
          case "double":
            r["text-decoration"] = "underline double";
            break;
          case "single":
          case "thick":
          case "words":
            r["text-decoration"] = "underline";
            break;
          case "wave":
          case "wavyDouble":
          case "wavyHeavy":
            r["text-decoration"] = "underline wavy";
            break;
          case "none":
            r["text-decoration"] = "none";
        }
        var u = m.colorAttr(i, "color");
        u && (r["text-decoration-color"] = u);
      }
    }
    parseFont(i, r, o = {}) {
      var u = s.default.attr(i, "ascii"), y = s.default.attr(i, "hAnsi"), p = s.default.attr(i, "eastAsia"), g = s.default.attr(i, "cs"), T = f.themeValue(i, "asciiTheme"), w = f.themeValue(i, "hAnsiTheme"), L = this.scriptThemeFontValue(f.themeValue(i, "eastAsiaTheme"), o.eastAsia), I = this.scriptThemeFontValue(f.themeValue(i, "cstheme") ?? f.themeValue(i, "csTheme"), o.bidi);
      const Y = (0, e.themeScriptForLanguage)(o.eastAsia), D = (X, A = "") => (0, F.isEastAsianFontFamily)(X) ? (0, F.eastAsianFontFamilyStack)(X, A) : [(0, F.encloseFontFamily)(X)];
      var Q = [u, y].filter((X) => X).flatMap((X) => D(X, Y));
      if (Q.push(...[T, w].filter((X) => X).map((X) => X.startsWith("var(") ? X : (0, F.encloseFontFamily)(X))), p && Q.push(...(0, F.eastAsianFontFamilyStack)(p, Y)), L && Q.push(L.startsWith("var(") ? L : (0, F.encloseFontFamily)(L)), g && Q.push(...D(g, (0, e.themeScriptForLanguage)(o.bidi))), I && Q.push(I.startsWith("var(") ? I : (0, F.encloseFontFamily)(I)), Q.length > 0) {
        const X = (r["font-family"] ?? "").split(",").map((A) => A.trim()).filter((A) => A);
        r["font-family"] = [.../* @__PURE__ */ new Set([...X, ...Q])].join(", ");
      }
    }
    scriptThemeFontValue(i, r) {
      if (!i) return i;
      const o = (0, e.themeScriptForLanguage)(r), u = /^var\((--docx-(?:major|minor)(?:EastAsia|Bidi|Cs)-font)\)$/.exec(i);
      return o && u ? `var(${u[1]}-${o}, ${i})` : i;
    }
    parseIndentation(i, r) {
      var o = s.default.lengthAttr(i, "firstLine"), u = s.default.lengthAttr(i, "hanging"), y = s.default.lengthAttr(i, "left"), p = s.default.lengthAttr(i, "start"), g = s.default.lengthAttr(i, "right"), T = s.default.lengthAttr(i, "end");
      o && (r["text-indent"] = o, r["--docx-text-indent"] = o), u && (r["text-indent"] = `-${u}`, r["--docx-text-indent"] = `-${u}`, r["--docx-hanging-indent"] = u), (y || p) && (r["margin-inline-start"] = y || p, r["--docx-margin-inline-start"] = y || p), (g || T) && (r["margin-inline-end"] = g || T, r["--docx-margin-inline-end"] = g || T);
    }
    parseSpacing(i, r) {
      var o = s.default.lengthAttr(i, "before"), u = s.default.lengthAttr(i, "after"), y = s.default.intAttr(i, "beforeLines", null), p = s.default.intAttr(i, "afterLines", null), g = s.default.boolAttr(i, "beforeAutospacing", !1), T = s.default.boolAttr(i, "afterAutospacing", !1), w = s.default.intAttr(i, "line", null), L = s.default.attr(i, "lineRule");
      if (g ? r["margin-top"] = "auto" : y != null ? r["margin-top"] = `${(y / 100).toFixed(2)}em` : o && (r["margin-top"] = o), T ? r["margin-bottom"] = "auto" : p != null ? r["margin-bottom"] = `${(p / 100).toFixed(2)}em` : u && (r["margin-bottom"] = u), w !== null) switch (L ?? "auto") {
        case "auto":
        default:
          r["line-height"] = `${(w / 240).toFixed(2)}`;
          break;
        case "atLeast":
          r["line-height"] = `max(1.2em, ${(w / 20).toFixed(2)}pt)`, r["min-height"] = `max(1.2em, ${(w / 20).toFixed(2)}pt)`;
          break;
        case "exact":
        case "exactly":
          r["line-height"] = r["min-height"] = `${(w / 20).toFixed(2)}pt`;
      }
    }
    parseMarginProperties(i, r) {
      for (const o of s.default.elements(i)) switch (o.localName) {
        case "left":
        case "start":
          r["padding-left"] = f.valueOfMargin(o);
          break;
        case "right":
        case "end":
          r["padding-right"] = f.valueOfMargin(o);
          break;
        case "top":
          r["padding-top"] = f.valueOfMargin(o);
          break;
        case "bottom":
          r["padding-bottom"] = f.valueOfMargin(o);
      }
    }
    parseTrHeight(i, r) {
      s.default.attr(i, "hRule"), r.height = s.default.lengthAttr(i, "val");
    }
    parseBorderProperties(i, r) {
      for (const o of s.default.elements(i)) {
        const u = f.valueOfBorder(o);
        switch (o.localName) {
          case "start":
          case "left":
            r["border-left"] = u;
            break;
          case "end":
          case "right":
            r["border-right"] = u;
            break;
          case "top":
            r["border-top"] = u;
            break;
          case "bottom":
            r["border-bottom"] = u;
            break;
          case "insideH":
            r["border-top"] ?? (r["border-top"] = u), r["border-bottom"] ?? (r["border-bottom"] = u);
            break;
          case "insideV":
            r["border-left"] ?? (r["border-left"] = u), r["border-right"] ?? (r["border-right"] = u);
        }
      }
    }
  };
  const n = ["black", "blue", "cyan", "darkBlue", "darkCyan", "darkGray", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "green", "lightGray", "magenta", "none", "red", "white", "yellow"], c = { dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2", text1: "dk1", background1: "lt1", text2: "dk2", background2: "lt2", hyperlink: "hlink", followedHyperlink: "folHlink" };
  function l(i) {
    switch (i) {
      case "dk1":
        return "#000000";
      case "lt1":
        return "#FFFFFF";
      case "dk2":
        return "#44546A";
      case "lt2":
        return "#E7E6E6";
      case "accent1":
        return "#4472C4";
      case "accent2":
        return "#ED7D31";
      case "accent3":
        return "#A5A5A5";
      case "accent4":
        return "#FFC000";
      case "accent5":
        return "#5B9BD5";
      case "accent6":
        return "#70AD47";
      case "hlink":
        return "#0563C1";
      case "folHlink":
        return "#954F72";
      default:
        return null;
    }
  }
  class m {
    static colorAttr(r, o, u = null, y = b.autos.color) {
      var p = s.default.attr(r, o);
      if (p) return p == "auto" ? y : n.includes(p) ? p : `#${p}`;
      var g, T = s.default.attr(r, "themeColor");
      if (T) {
        const w = c[g = T] ?? g, L = l(w);
        return `var(--docx-${w}-color${L ? `, ${L}` : ""})`;
      }
      return u;
    }
  }
  class f {
    static themeValue(r, o) {
      var u = s.default.attr(r, o);
      return u ? `var(--docx-${u}-font)` : null;
    }
    static valueOfSize(r, o) {
      var u = M.LengthUsage.Dxa;
      switch (s.default.attr(r, "type")) {
        case "dxa":
          break;
        case "pct":
          u = M.LengthUsage.Percent;
          break;
        case "auto":
          return "auto";
      }
      return s.default.lengthAttr(r, o, u);
    }
    static valueOfMargin(r) {
      return s.default.lengthAttr(r, "w");
    }
    static valueOfBorder(r) {
      var o = f.parseBorderType(s.default.attr(r, "val"));
      if (o == "none") return "none";
      var u = m.colorAttr(r, "color", b.autos.borderColor, b.autos.borderColor);
      return `${s.default.lengthAttr(r, "sz", M.LengthUsage.Border) ?? "1pt"} ${o} ${u == "auto" ? b.autos.borderColor : u}`;
    }
    static parseBorderType(r) {
      switch (r) {
        case "single":
        case "dashDotStroked":
        case "thick":
        case "thickThinLargeGap":
        case "thickThinMediumGap":
        case "thickThinSmallGap":
        case "thinThickLargeGap":
        case "thinThickMediumGap":
        case "thinThickSmallGap":
        case "thinThickThinLargeGap":
        case "thinThickThinMediumGap":
        case "thinThickThinSmallGap":
        case "threeDEmboss":
        case "threeDEngrave":
        case "wave":
          return "solid";
        case "dashed":
        case "dashSmallGap":
          return "dashed";
        case "dotDash":
        case "dotDotDash":
        case "dotted":
          return "dotted";
        case "double":
        case "doubleWave":
        case "triple":
          return "double";
        case "inset":
          return "inset";
        case "nil":
        case "none":
          return "none";
        case "outset":
          return "outset";
      }
      return "solid";
    }
    static valueOfTblLayout(r) {
      return (s.default.attr(r, "type") ?? s.default.attr(r, "val")) == "fixed" ? "fixed" : "auto";
    }
    static classNameOfCnfStyle(r) {
      const o = s.default.attr(r, "val");
      return ["first-row", "last-row", "first-col", "last-col", "odd-col", "even-col", "odd-row", "even-row", "ne-cell", "nw-cell", "se-cell", "sw-cell"].filter((u, y) => o[y] == "1").join(" ");
    }
    static valueOfJc(r) {
      var o = s.default.attr(r, "val");
      switch (o) {
        case "start":
        case "left":
          return "left";
        case "center":
          return "center";
        case "end":
        case "right":
          return "right";
        case "both":
          return "justify";
      }
      return o;
    }
    static valueOfVertAlign(r, o = !1) {
      var u = s.default.attr(r, "val");
      switch (u) {
        case "subscript":
          return "sub";
        case "superscript":
          return o ? "sup" : "super";
      }
      return o ? null : u;
    }
    static valueOfEmphasisMark(r) {
      switch (s.default.attr(r, "val")) {
        case "none":
          return "none";
        case "comma":
          return '"﹐"';
        case "circle":
          return "circle";
        default:
          return "dot";
      }
    }
    static valueOfTextAlignment(r) {
      var o = s.default.attr(r, "val");
      switch (o) {
        case "auto":
        case "baseline":
          return "baseline";
        case "top":
          return "top";
        case "center":
          return "middle";
        case "bottom":
          return "bottom";
      }
      return o;
    }
    static addSize(r, o) {
      return r && r != "0.00pt" && r != "0px" ? o && o != "0.00pt" && o != "0px" ? `calc(${r} + ${o})` : r : o;
    }
    static classNameOftblLook(r) {
      const o = s.default.hexAttr(r, "val", 0);
      let u = "";
      return (s.default.boolAttr(r, "firstRow") || 32 & o) && (u += " first-row"), (s.default.boolAttr(r, "lastRow") || 64 & o) && (u += " last-row"), (s.default.boolAttr(r, "firstColumn") || 128 & o) && (u += " first-col"), (s.default.boolAttr(r, "lastColumn") || 256 & o) && (u += " last-col"), (s.default.boolAttr(r, "noHBand") || 512 & o) && (u += " no-hband"), (s.default.boolAttr(r, "noVBand") || 1024 & o) && (u += " no-vband"), u.trim();
    }
  }
}, "./document-props/core-props-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.CorePropsPart = void 0;
  const d = N("../common/part"), h = N("./core-props");
  class P extends d.Part {
    parseXml(s) {
      this.props = (0, h.parseCoreProps)(s, this._package.xmlParser);
    }
  }
  b.CorePropsPart = P;
}, "./document-props/core-props": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseCoreProps = function(d, h) {
    const P = {};
    for (let k of h.elements(d)) switch (k.localName) {
      case "title":
        P.title = k.textContent;
        break;
      case "description":
        P.description = k.textContent;
        break;
      case "subject":
        P.subject = k.textContent;
        break;
      case "creator":
        P.creator = k.textContent;
        break;
      case "keywords":
        P.keywords = k.textContent;
        break;
      case "language":
        P.language = k.textContent;
        break;
      case "lastModifiedBy":
        P.lastModifiedBy = k.textContent;
        break;
      case "revision":
        k.textContent && (P.revision = parseInt(k.textContent));
    }
    return P;
  };
}, "./document-props/custom-props-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.CustomPropsPart = void 0;
  const d = N("../common/part"), h = N("./custom-props");
  class P extends d.Part {
    parseXml(s) {
      this.props = (0, h.parseCustomProps)(s, this._package.xmlParser);
    }
  }
  b.CustomPropsPart = P;
}, "./document-props/custom-props": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseCustomProps = function(d, h) {
    return h.elements(d, "property").map((P) => {
      const k = P.firstChild;
      return { formatId: h.attr(P, "fmtid"), name: h.attr(P, "name"), type: k.nodeName, value: k.textContent };
    });
  };
}, "./document-props/extended-props-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.ExtendedPropsPart = void 0;
  const d = N("../common/part"), h = N("./extended-props");
  class P extends d.Part {
    parseXml(s) {
      this.props = (0, h.parseExtendedProps)(s, this._package.xmlParser);
    }
  }
  b.ExtendedPropsPart = P;
}, "./document-props/extended-props": function(N, Z, b) {
  function d(h) {
    if (h !== void 0) return parseInt(h);
  }
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseExtendedProps = function(h, P) {
    const k = {};
    for (let s of P.elements(h)) switch (s.localName) {
      case "Template":
        k.template = s.textContent;
        break;
      case "Pages":
        k.pages = d(s.textContent);
        break;
      case "Words":
        k.words = d(s.textContent);
        break;
      case "Characters":
        k.characters = d(s.textContent);
        break;
      case "Application":
        k.application = s.textContent;
        break;
      case "Lines":
        k.lines = d(s.textContent);
        break;
      case "Paragraphs":
        k.paragraphs = d(s.textContent);
        break;
      case "Company":
        k.company = s.textContent;
        break;
      case "AppVersion":
        k.appVersion = s.textContent;
    }
    return k;
  };
}, "./docx-preview-worker": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 });
  const d = N("./word-document"), h = N("./document-parser"), P = N("./input-validation"), k = self;
  function s(v, S, M = {}) {
    k.postMessage({ id: v, type: S, ...M });
  }
  k.onmessage = async (v) => {
    const S = v.data;
    if (!S || S.type !== "parse") return;
    const M = S.id;
    try {
      const R = { ...S.options, useWorker: !1, h: void 0, progress: void 0 };
      (0, P.assertNonEmptyDocxInput)(S.data), s(M, "progress", { current: 1, total: 3, message: "Loading package relationships" });
      const $ = await d.WordDocument.load(S.data, new h.DocumentParser(R), R);
      s(M, "progress", { current: 2, total: 3, message: "Serializing parsed document model" });
      const F = await $.createSnapshot();
      s(M, "progress", { current: 3, total: 3, message: "Worker parse complete" }), s(M, "parsed", { snapshot: F });
    } catch (R) {
      s(M, "error", { error: { message: R?.message ?? `${R}`, stack: R?.stack } });
    }
  };
}, "./docx-preview": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.defaultOptions = void 0, b.parseAsync = S, b.renderDocument = R, b.renderAsync = async function(r, o, u, y) {
    const p = { ...b.defaultOptions, ...y };
    (0, s.assertViewerLicense)("docx", p.licenseToken);
    const g = await S(r, p), T = await R(g, p);
    u ?? (u = o), u.innerHTML = "", o.innerHTML = "";
    let w = 0;
    for (let I of T) (I.nodeName === "STYLE" ? u : o).appendChild(I), w++, p.renderYieldEveryMs > 0 && w % 8 == 0 && await i();
    (function(I) {
      const Y = $.get(I);
      Y && I.removeEventListener("click", Y);
      const D = (Q) => {
        const X = Q;
        if (X.defaultPrevented || X.button != 0 || X.metaKey || X.ctrlKey || X.shiftKey || X.altKey) return;
        const A = X.target;
        if (!(A instanceof Element)) return;
        const B = A.closest('a[href^="#"]');
        if (!B || !I.contains(B)) return;
        const _ = B.getAttribute("href");
        if (!_ || _ == "#") return;
        let G = _.substring(1);
        try {
          G = decodeURIComponent(G);
        } catch {
          return;
        }
        const re = Array.from(I.querySelectorAll("[id]")).find((ae) => ae.id == G);
        re && (X.preventDefault(), re.scrollIntoView({ block: "start", inline: "nearest" }));
      };
      I.addEventListener("click", D), $.set(I, D);
    })(o), n(o, p.className), l(o, p.className);
    let L = null;
    return p.awaitLayout && (p.progress?.({ phase: "layout", message: "Measuring rendered pages" }), L = await a(o, p), l(o, p.className)), p.progress?.({ phase: "done", current: L?.pageCount, total: L?.pageCount, message: "DOCX render complete" }), g;
  }, b.parseAsyncInWorker = t, b.awaitRenderedLayout = a, b.collectLayoutSnapshot = c, b.syncNumberingMarkerStyles = l, b.yieldToBrowser = i;
  const d = N("./word-document"), h = N("./document-parser"), P = N("./html-renderer"), k = N("./html"), s = N("./license-gate"), v = N("./input-validation");
  function S(r, o) {
    const u = { ...b.defaultOptions, ...o };
    return (0, s.assertViewerLicense)("docx", u.licenseToken), (0, v.assertNonEmptyDocxInput)(r), (function(y) {
      return !(!y.useWorker || !y.workerUrl || typeof Worker > "u");
    })(u) ? t(r, u).catch((y) => {
      if (!u.workerFallback) throw y;
      u.debug && console.warn("docx-preview: worker parsing failed; falling back to main thread", y);
      const p = { ...u, useWorker: !1 };
      return M(r, p);
    }) : M(r, u);
  }
  function M(r, o) {
    return (0, v.assertNonEmptyDocxInput)(r), o.progress?.({ phase: "parse", message: "Parsing DOCX on main thread" }), d.WordDocument.load(r, new h.DocumentParser(o), o);
  }
  async function R(r, o) {
    const u = { ...b.defaultOptions, ...o };
    return (0, s.assertViewerLicense)("docx", u.licenseToken), await new P.HtmlRenderer().render(r, u);
  }
  b.defaultOptions = { ignoreHeight: !1, ignoreWidth: !1, fixedPageHeight: !0, ignoreFonts: !1, breakPages: !0, strictWordCompatibility: !0, paginationTolerance: 2, maxDynamicPaginationPasses: 1e3, awaitLayout: !0, useWorker: !0, workerUrl: void 0, workerJsZipUrl: void 0, workerFallback: !0, workerTimeout: 12e4, renderPageBatchSize: 2, renderYieldEveryMs: 16, progress: void 0, preserveComplexFieldResults: !0, updatePageReferences: !1, hideWebHiddenContent: !1, darkMode: !1, debug: !1, experimental: !1, className: "docx", inWrapper: !0, hideWrapperOnPrint: !1, trimXmlDeclaration: !0, ignoreLastRenderedPageBreak: !1, renderHeaders: !0, renderFooters: !0, renderFootnotes: !0, renderEndnotes: !0, useBase64URL: !1, renderChanges: !1, renderComments: !1, renderAltChunks: !0, h: k.h };
  const $ = /* @__PURE__ */ new WeakMap();
  function F(r) {
    const { h: o, progress: u, licenseToken: y, ...p } = r;
    return { ...p, useWorker: !1 };
  }
  let e = 0;
  function t(r, o) {
    const u = { ...b.defaultOptions, ...o };
    return (0, s.assertViewerLicense)("docx", u.licenseToken), (0, v.assertNonEmptyDocxInput)(r), u.workerUrl && typeof Worker < "u" ? (u.progress?.({ phase: "worker", message: "Starting DOCX parse worker" }), new Promise((y, p) => {
      const g = ++e, T = new Worker(u.workerUrl);
      let w = !1, L = null;
      const I = () => {
        w = !0, L && clearTimeout(L), T.terminate();
      };
      u.workerTimeout > 0 && (L = setTimeout(() => {
        w || (I(), p(new Error(`docx-preview worker timed out after ${u.workerTimeout}ms`)));
      }, u.workerTimeout)), T.onerror = (Y) => {
        w || (I(), p(new Error(Y.message || "docx-preview worker error")));
      }, T.onmessage = (Y) => {
        const D = Y.data ?? {};
        if (D.id === g || D.type === "ready") if (D.type !== "progress") {
          if (D.type === "parsed") return I(), u.progress?.({ phase: "worker", message: "Worker parse complete" }), void y(d.WordDocument.fromSnapshot(D.snapshot, u));
          if (D.type === "error") {
            I();
            const Q = new Error(D.error?.message ?? "docx-preview worker parse failed");
            Q.stack = D.error?.stack, p(Q);
          }
        } else u.progress?.({ phase: "worker", current: D.current, total: D.total, message: D.message });
      }, T.postMessage({ type: "parse", id: g, data: r, options: F(u), jsZipUrl: u.workerJsZipUrl });
    })) : M(r, { ...u, useWorker: !1 });
  }
  async function a(r, o) {
    const u = { ...b.defaultOptions, ...o };
    await (async function(p) {
      const g = Array.from(p.querySelectorAll("img"));
      await Promise.allSettled(g.map((T) => T.complete ? Promise.resolve() : new Promise((w) => {
        T.addEventListener("load", w, { once: !0 }), T.addEventListener("error", w, { once: !0 });
      })));
    })(r), document.fonts?.ready && await document.fonts.ready;
    const y = r.querySelector(`.${u.className}-wrapper`);
    if (u.breakPages && u.fixedPageHeight && !u.ignoreHeight && y) {
      const p = Math.max(2, u.maxDynamicPaginationPasses ?? 120);
      for (let g = 0; g < p && (await i(), y.dataset.docxPaginated !== "true") && (y.dataset.docxPaginating === "true" || y.dataset.docxPaginationScheduled === "true"); g++) ;
    }
    return await i(), n(r, u.className), c(r, u);
  }
  function n(r, o) {
    const u = Array.from(r.querySelectorAll('[data-docx-anchor-context="paragraph"]'));
    for (const y of u) {
      const p = y.closest(`section.${o}`);
      if (!p) continue;
      const g = p.getBoundingClientRect(), T = y.getBoundingClientRect();
      y.style.setProperty("--docx-paragraph-page-offset-top", T.top - g.top + "px"), y.style.setProperty("--docx-paragraph-page-offset-left", T.left - g.left + "px");
    }
  }
  function c(r, o) {
    const u = { ...b.defaultOptions, ...o }, y = Array.from(r.querySelectorAll(`section.${u.className}`)).map((p, g) => {
      const T = Array.from(p.querySelectorAll("[data-docx-field-instr]")), w = Array.from(p.querySelectorAll("img")).filter((I) => !I.complete || I.naturalWidth === 0).length, L = p.clientHeight > 0 && p.scrollHeight > p.clientHeight + (u.paginationTolerance ?? 2);
      return { index: g + 1, section: p.dataset.docxSection ?? "", pageNumber: parseInt(p.dataset.docxPageNumber ?? `${g + 1}`, 10), sectionPageNumber: parseInt(p.dataset.docxSectionPageNumber ?? "1", 10), width: p.clientWidth, height: p.clientHeight, scrollHeight: p.scrollHeight, overflow: L, textLength: p.textContent?.length ?? 0, anchors: Array.from(p.querySelectorAll("[id]")).map((I) => I.id).filter(Boolean), fields: T.map((I) => ({ instruction: I.dataset.docxFieldInstr ?? "", value: I.textContent ?? "" })), floats: p.querySelectorAll('[data-docx-float="true"]').length, unresolvedMedia: w };
    });
    return { pageCount: y.length, overflowPages: y.filter((p) => p.overflow).map((p) => p.index), unresolvedMedia: y.reduce((p, g) => p + g.unresolvedMedia, 0), textLength: y.reduce((p, g) => p + g.textLength, 0), fields: y.flatMap((p) => p.fields), floats: y.reduce((p, g) => p + g.floats, 0), pages: y };
  }
  function l(r, o = "docx") {
    if (!r || typeof getComputedStyle != "function") return;
    const u = Array.from(r.querySelectorAll("p")), y = `${o}-num-`;
    for (const p of u) {
      if (!p.className?.includes(y)) continue;
      const g = getComputedStyle(p, "::before");
      if (!g.content || g.content == "none" || g.content == "normal") continue;
      const T = m(p);
      if (!T || T == p) continue;
      const w = getComputedStyle(T);
      f(p, "--docx-marker-font-family", w.fontFamily), f(p, "--docx-marker-font-size", w.fontSize), f(p, "--docx-marker-font-style", w.fontStyle), f(p, "--docx-marker-font-weight", w.fontWeight);
    }
  }
  function m(r) {
    const o = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (; o.nextNode(); ) {
      const u = o.currentNode;
      if (!u.nodeValue?.trim()) continue;
      const y = u.parentElement;
      if (!y || y == r) return r;
      const p = getComputedStyle(y);
      if (p.display != "none" && p.visibility != "hidden") return y;
    }
    return null;
  }
  function f(r, o, u) {
    u && r.style.setProperty(o, u);
  }
  function i() {
    return new Promise((r) => {
      const o = globalThis;
      typeof o.requestIdleCallback == "function" ? o.requestIdleCallback(() => r(), { timeout: 32 }) : typeof o.requestAnimationFrame == "function" ? o.requestAnimationFrame(() => r()) : setTimeout(r, 0);
    });
  }
}, "./font-table/font-table": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.FontTablePart = void 0;
  const d = N("../common/part"), h = N("./fonts");
  class P extends d.Part {
    parseXml(s) {
      this.fonts = (0, h.parseFonts)(s, this._package.xmlParser);
    }
  }
  b.FontTablePart = P;
}, "./font-table/fonts": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseFonts = function(k, s) {
    return s.elements(k).map((v) => h(v, s));
  }, b.parseFont = h, b.parseEmbedFontRef = P;
  const d = { embedRegular: "regular", embedBold: "bold", embedItalic: "italic", embedBoldItalic: "boldItalic" };
  function h(k, s) {
    let v = { name: s.attr(k, "name"), embedFontRefs: [] };
    for (let S of s.elements(k)) switch (S.localName) {
      case "family":
        v.family = s.attr(S, "val");
        break;
      case "altName":
        v.altName = s.attr(S, "val");
        break;
      case "embedRegular":
      case "embedBold":
      case "embedItalic":
      case "embedBoldItalic":
        v.embedFontRefs.push(P(S, s));
    }
    return v;
  }
  function P(k, s) {
    return { id: s.attr(k, "id"), key: s.attr(k, "fontKey"), type: d[k.localName] };
  }
}, "./header-footer/elements": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.WmlFooter = b.WmlHeader = void 0;
  const d = N("../document/dom");
  class h extends d.OpenXmlElementBase {
    constructor() {
      super(...arguments), this.type = d.DomType.Header;
    }
  }
  b.WmlHeader = h;
  class P extends d.OpenXmlElementBase {
    constructor() {
      super(...arguments), this.type = d.DomType.Footer;
    }
  }
  b.WmlFooter = P;
}, "./header-footer/parts": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.FooterPart = b.HeaderPart = b.BaseHeaderFooterPart = void 0;
  const d = N("../common/part"), h = N("./elements");
  class P extends d.Part {
    constructor(s, v, S) {
      super(s, v), this._documentParser = S;
    }
    parseXml(s) {
      this.rootElement = this.createRootElement(), this.rootElement.children = this._documentParser.parseBodyElements(s);
    }
  }
  b.BaseHeaderFooterPart = P, b.HeaderPart = class extends P {
    createRootElement() {
      return new h.WmlHeader();
    }
  }, b.FooterPart = class extends P {
    createRootElement() {
      return new h.WmlFooter();
    }
  };
}, "./html-renderer": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.HtmlRenderer = void 0;
  const d = N("./document/dom"), h = N("./utils"), P = N("./javascript"), k = N("./document/section"), s = N("./dark-mode-color"), v = N("./theme/theme"), S = N("./html"), M = N("./parser/xml-parser");
  function R(e) {
    return e >= "0" && e <= "9";
  }
  function $(e) {
    if (!e) return !1;
    const t = e.charCodeAt(0);
    return t >= 65 && t <= 90 || t >= 97 && t <= 122 || t >= 913 && t <= 1023 || t >= 119808 && t <= 120831;
  }
  function F(e) {
    return "()+-−=<>≤≥≈≠×÷*/·∙∑Σ∏∫√∞∂∇,.;:[]{}|‖!′″→←↔⇒⇔∈∉⊂⊃⊆⊇∧∨¬".includes(e);
  }
  b.HtmlRenderer = class {
    constructor() {
      this.className = "docx", this.styleMap = {}, this.currentPart = null, this.currentSectionProps = null, this.currentPageNumber = 1, this.currentSectionNumber = 1, this.currentSectionPageNumber = 1, this.totalPages = 1, this.sectionPageCount = 1, this.tableVerticalMerges = [], this.currentVerticalMerge = null, this.tableCellPositions = [], this.currentCellPosition = null, this.currentTableRow = null, this.footnoteMap = {}, this.endnoteMap = {}, this.currentEndnoteIds = [], this.usedHederFooterParts = [], this.currentTabs = [], this.currentParagraph = null, this.currentParagraphTabIndex = 0, this.currentParagraphTabCount = 0, this.commentMap = {}, this.bookmarkTextMap = {}, this.bookmarkIdToName = {}, this.tocEntries = [], this.fieldSeqCounters = {}, this.fieldSetValues = {}, this.headingIndex = 0, this.tasks = [], this.postRenderTasks = [], this.h = S.h, this.darkModeVarNames = /* @__PURE__ */ new Map(), this.darkModePrintReset = {};
    }
    async render(e, t) {
      this.document = e, this.options = t, this.className = t.className, this.rootSelector = t.inWrapper ? `.${this.className}-wrapper` : ":root", this.h = t.h ?? S.h, this.styleMap = null, this.tasks = [], this.postRenderTasks = [], this.currentTabs = [], this.fieldSeqCounters = {}, this.fieldSetValues = {}, this.headingIndex = 0, this.darkModeVarNames = /* @__PURE__ */ new Map(), this.darkModePrintReset = {}, this.options.renderComments && globalThis.Highlight && (this.commentHighlight = new Highlight());
      const a = [...this.renderDefaultStyle()];
      e.themePart && a.push(...this.renderTheme(e.themePart)), e.stylesPart != null && (this.styleMap = this.processStyles(e.stylesPart.styles), a.push(...this.renderStyles(e.stylesPart.styles))), e.numberingPart && (this.prodessNumberings(e.numberingPart.domNumberings), a.push(...await this.renderNumbering(e.numberingPart.domNumberings))), e.footnotesPart && (this.footnoteMap = (0, h.keyBy)(e.footnotesPart.notes, (c) => c.id)), e.endnotesPart && (this.endnoteMap = (0, h.keyBy)(e.endnotesPart.notes, (c) => c.id)), e.settingsPart && (this.defaultTabSize = e.settingsPart.settings?.defaultTabStop), !t.ignoreFonts && e.fontTablePart && a.push(...await this.renderFontTable(e.fontTablePart));
      var n = await this.renderSections(e.documentPart.body);
      if (this.options.inWrapper) {
        const c = this.renderWrapper(n);
        a.push(c), this.shouldRunDynamicPagination() && this.scheduleDynamicPagination(c);
      } else a.push(...n);
      return a.push(...this.renderDarkModePrintReset()), this.commentHighlight && t.renderComments && CSS.highlights.set(`${this.className}-comments`, this.commentHighlight), await Promise.allSettled(this.tasks), this.postRenderTasks.forEach((c) => c()), this.refreshTabStops(), a;
    }
    renderTheme(e) {
      const t = {}, a = e.theme?.fontScheme, n = this.documentThemeLanguages();
      a && (a.majorFont && (t["--docx-majorHAnsi-font"] = this.themeFontFamily(a.majorFont, "latin", n.latin), t["--docx-majorEastAsia-font"] = this.themeFontFamily(a.majorFont, "eastAsia", n.eastAsia), t["--docx-majorBidi-font"] = this.themeFontFamily(a.majorFont, "complexScript", n.bidi), t["--docx-majorCs-font"] = t["--docx-majorBidi-font"], this.addThemeScriptFontVariables(t, "major", a.majorFont)), a.minorFont && (t["--docx-minorHAnsi-font"] = this.themeFontFamily(a.minorFont, "latin", n.latin), t["--docx-minorEastAsia-font"] = this.themeFontFamily(a.minorFont, "eastAsia", n.eastAsia), t["--docx-minorBidi-font"] = this.themeFontFamily(a.minorFont, "complexScript", n.bidi), t["--docx-minorCs-font"] = t["--docx-minorBidi-font"], this.addThemeScriptFontVariables(t, "minor", a.minorFont)));
      const c = e.theme?.colorScheme, l = [];
      if (c) for (let [f, i] of Object.entries(c.colors)) {
        const r = `--docx-${f}-color`;
        t[r] = `#${i}`, l.push(r);
      }
      let m = this.styleToString(`.${this.className}`, t);
      if (this.options.darkMode && l.length) {
        const f = l.map((i) => `  ${i}: ${t[i]};\r
`).join("");
        m += `@media print {\r
.${this.className} {\r
${f}}\r
}\r
`;
      }
      return [this.h({ tagName: "#comment", children: ["docxjs document theme values"] }), this.h({ tagName: "style", children: [m] })];
    }
    documentThemeLanguages() {
      const e = { latin: "", eastAsia: "", bidi: "" }, t = (this.document.stylesPart?.styles ?? []).filter((n) => n.id == null || n.isDefault && n.target == "span").flatMap((n) => n.styles ?? []).find((n) => n.target == "span"), a = t?.values ?? {};
      return e.latin = a.$lang ?? "", e.eastAsia = a["$lang-eastAsia"] ?? e.latin, e.bidi = a["$lang-bidi"] ?? e.latin, e;
    }
    addThemeScriptFontVariables(e, t, a) {
      const n = /* @__PURE__ */ new Set(["Hans", "Hant", "Jpan", "Hang"]);
      for (const c of Object.keys(a.scriptTypefaces ?? {})) {
        const l = n.has(c) ? "eastAsia" : "complexScript", m = this.themeFontFamily(a, l, "", c);
        e[`--docx-${t}EastAsia-font-${c}`] = m, e[`--docx-${t}Bidi-font-${c}`] = m, e[`--docx-${t}Cs-font-${c}`] = m;
      }
    }
    themeFontFamily(e, t, a, n = "") {
      const c = t == "latin" ? e.latinTypeface : t == "eastAsia" ? e.eaTypeface : e.csTypeface, l = n || (0, v.themeScriptForLanguage)(a), m = l ? e.scriptTypefaces?.[l] : "", f = c?.trim() || m?.trim() || e.latinTypeface?.trim();
      if (!f) return t == "eastAsia" ? "sans-serif" : "serif";
      const i = [(0, h.encloseFontFamily)(f)];
      return t == "eastAsia" && i.push(...(0, h.eastAsianFontFamilyStack)(f, l).slice(1)), [...new Set(i)].join(", ");
    }
    async renderFontTable(e) {
      const t = [];
      for (let a of e.fonts) for (let n of a.embedFontRefs) try {
        const c = await this.document.loadFont(n.id, n.key), l = { "font-family": (0, h.encloseFontFamily)(a.name), src: `url(${c})` };
        n.type != "bold" && n.type != "boldItalic" || (l["font-weight"] = "bold"), n.type != "italic" && n.type != "boldItalic" || (l["font-style"] = "italic"), t.push(this.h({ tagName: "#comment", children: [`docxjs ${a.name} font`] })), t.push(this.h({ tagName: "style", children: [this.styleToString("@font-face", l)] }));
      } catch {
        this.options.debug && console.warn(`Can't load font with id ${n.id} and key ${n.key}`);
      }
      return t;
    }
    processStyleName(e) {
      return e ? `${this.className}_${(0, h.escapeClassName)(e)}` : this.className;
    }
    processStyles(e) {
      const t = (0, h.keyBy)(e.filter((n) => n.id != null), (n) => n.id);
      for (const n of e.filter((c) => c.basedOn)) {
        var a = t[n.basedOn];
        if (a) {
          n.paragraphProps = (0, h.mergeDeep)({}, a.paragraphProps, n.paragraphProps), n.runProps = (0, h.mergeDeep)({}, a.runProps, n.runProps);
          for (const c of a.styles) {
            const l = n.styles.find((m) => m.target == c.target);
            l ? this.copyStyleProperties(c.values, l.values) : n.styles.push({ ...c, values: { ...c.values } });
          }
        } else this.options.debug && console.warn(`Can't find base style ${n.basedOn}`);
      }
      for (let n of e) n.cssName = this.processStyleName(n.id);
      return t;
    }
    prodessNumberings(e) {
      for (let t of e.filter((a) => a.pStyleName)) {
        const a = this.findStyle(t.pStyleName);
        a?.paragraphProps?.numbering && (a.paragraphProps.numbering.level = t.level);
      }
    }
    processElement(e) {
      if (e && e.children) for (var t of e.children) t.parent = e, t.type == d.DomType.Table ? this.processTable(t) : this.processElement(t);
    }
    processTable(e) {
      const t = e.children ?? [];
      let a = e.columns?.length ?? 0;
      for (const l of t) {
        let m = l.gridBefore ?? 0;
        for (const f of l.children ?? []) m += f.span ?? 1;
        a = Math.max(a, m + (l.gridAfter ?? 0));
      }
      const n = Math.max(e.rowBandSize ?? 1, 1), c = Math.max(e.colBandSize ?? 1, 1);
      t.forEach((l, m) => {
        m == 0 && this.appendClassName(l, "first-row"), m == t.length - 1 && this.appendClassName(l, "last-row"), this.appendClassName(l, Math.floor(m / n) % 2 == 0 ? "odd-row" : "even-row");
        let f = l.gridBefore ?? 0;
        for (const i of l.children ?? []) {
          i.cssStyle = this.copyStyleProperties(e.cellStyle, i.cssStyle, ["border-left", "border-right", "border-top", "border-bottom", "padding-left", "padding-right", "padding-top", "padding-bottom"]);
          const r = i.span ?? 1, o = f + r - 1;
          f == 0 && this.appendClassName(i, "first-col"), a > 0 && o >= a - 1 && this.appendClassName(i, "last-col"), this.appendClassName(i, Math.floor(f / c) % 2 == 0 ? "odd-col" : "even-col"), this.processElement(i), f += r;
        }
      });
    }
    collectDocumentMetadata(e) {
      this.bookmarkTextMap = {}, this.bookmarkIdToName = {}, this.tocEntries = [];
      const t = {}, a = (n) => {
        if (n.type != d.DomType.Deleted || this.options.renderChanges) {
          switch (n.type) {
            case d.DomType.BookmarkStart: {
              const c = n;
              c.id && c.name && (this.bookmarkIdToName[c.id] = c.name, t[c.id] = []);
              break;
            }
            case d.DomType.BookmarkEnd: {
              const c = n, l = this.bookmarkIdToName[c.id];
              l && t[c.id] && (this.bookmarkTextMap[l] = t[c.id].join("").trim(), delete t[c.id]);
              break;
            }
            case d.DomType.Text:
              for (const c of Object.keys(t)) t[c].push(n.text ?? "");
              break;
            case d.DomType.DeletedText:
              if (this.options.renderChanges) for (const c of Object.keys(t)) t[c].push(n.text ?? "");
          }
          for (const c of n.children ?? []) a(c);
        }
      };
      for (const n of e.children ?? []) a(n);
      for (const [n, c] of Object.entries(t)) {
        const l = this.bookmarkIdToName[n];
        l && (this.bookmarkTextMap[l] = c.join("").trim());
      }
      for (const n of e.children ?? []) this.collectTocEntries(n);
    }
    collectTocEntries(e) {
      if (e.type != d.DomType.Deleted || this.options.renderChanges) {
        if (e.type == d.DomType.Paragraph) {
          const t = e, a = this.findStyle(t.styleName), n = this.extractText(t).trim();
          let c = t.outlineLevel ?? a?.paragraphProps?.outlineLevel;
          if (c == null && t.styleName) {
            const l = /heading(\d+)|(?:^|[-_ ])h(\d+)$/i.exec(t.styleName);
            l && (c = parseInt(l[1] ?? l[2], 10) - 1);
          }
          if (n && c != null && c >= 0 && c < 9) {
            const l = this.findFirstBookmark(t), m = l?.name && !l.name.startsWith("_") ? l.name : `${this.className}-heading-${++this.headingIndex}`;
            t.props = { ...t.props ?? {}, anchorId: m }, this.tocEntries.push({ level: c + 1, text: n, id: m });
          }
        }
        for (const t of e.children ?? []) this.collectTocEntries(t);
      }
    }
    findFirstBookmark(e) {
      if (e.type == d.DomType.BookmarkStart) return e;
      for (const t of e.children ?? []) {
        const a = this.findFirstBookmark(t);
        if (a) return a;
      }
      return null;
    }
    extractText(e) {
      switch (e.type) {
        case d.DomType.Text:
          return e.text ?? "";
        case d.DomType.DeletedText:
          return this.options.renderChanges ? e.text ?? "" : "";
        case d.DomType.Deleted:
          return this.options.renderChanges ? (e.children ?? []).map((t) => this.extractText(t)).join("") : "";
        case d.DomType.Inserted:
          return (e.children ?? []).map((t) => this.extractText(t)).join("");
        case d.DomType.Tab:
        case d.DomType.PositionalTab:
          return "	";
        case d.DomType.NoBreakHyphen:
          return "‑";
        case d.DomType.SoftHyphen:
          return "";
        case d.DomType.Break:
          return `
`;
        case d.DomType.Instruction:
        case d.DomType.ComplexField:
          return "";
      }
      return (e.children ?? []).map((t) => this.extractText(t)).join("");
    }
    appendClassName(e, t) {
      e.className = (0, S.cx)(e.className, t);
    }
    copyStyleProperties(e, t, a = null) {
      if (!e) return t;
      for (var n of (t == null && (t = {}), a == null && (a = Object.getOwnPropertyNames(e)), a)) e.hasOwnProperty(n) && !t.hasOwnProperty(n) && (t[n] = e[n]);
      return t;
    }
    createPageElement(e, t, a) {
      const n = { ...a };
      let c = null, l = null;
      if (t) {
        if (t.pageMargins && (n.paddingLeft = this.addSize(t.pageMargins.left, t.pageMargins.gutter), n.paddingRight = t.pageMargins.right, n.paddingTop = t.pageMargins.top, n.paddingBottom = t.pageMargins.bottom), t.pageSize) {
          let f = t.pageSize.width, i = t.pageSize.height;
          if (t.pageSize.orientation == "landscape") {
            const r = this.parseCssLengthValue(f), o = this.parseCssLengthValue(i);
            r != null && o != null && r < o && ([f, i] = [i, f]);
          }
          c = f, l = i, this.options.ignoreWidth || (n.width = f), (!this.options.ignoreHeight || !this.options.breakPages) && (n.minHeight = i, !this.options.ignoreHeight && this.options.breakPages && this.options.fixedPageHeight && (n.height = i));
        }
        t.pageBorders && (this.applyPageBorder(n, "top", t.pageBorders.top), this.applyPageBorder(n, "right", t.pageBorders.right), this.applyPageBorder(n, "bottom", t.pageBorders.bottom), this.applyPageBorder(n, "left", t.pageBorders.left));
      }
      const m = this.h({ tagName: "section", className: e, style: n });
      return n.paddingLeft && this.setCssStyle(m, "--docx-page-padding-left", n.paddingLeft), n.paddingTop && this.setCssStyle(m, "--docx-page-padding-top", n.paddingTop), c && this.setCssStyle(m, "--docx-page-width", c), l && this.setCssStyle(m, "--docx-page-height", l), m;
    }
    addSize(e, t) {
      return e ? t && t != "0.00pt" && t != "0px" ? `calc(${e} + ${t})` : e : t;
    }
    parseCssLengthValue(e) {
      if (!e) return null;
      const t = /^(-?\d+(?:\.\d+)?)/.exec(e);
      return t ? parseFloat(t[1]) : null;
    }
    applyPageBorder(e, t, a) {
      if (!a) return;
      const n = this.borderTypeToCss(a.type);
      e[`border-${t}`] = n == "none" ? "none" : `${a.size ?? "1px"} ${n} ${this.borderColor(a.color)}`;
    }
    borderTypeToCss(e) {
      switch (e) {
        case "nil":
        case "none":
          return "none";
        case "double":
        case "triple":
          return "double";
        case "dashed":
        case "dashSmallGap":
          return "dashed";
        case "dotted":
        case "dotDash":
        case "dotDotDash":
          return "dotted";
      }
      return "solid";
    }
    borderColor(e) {
      return e && e != "auto" ? /^[0-9a-f]{6}$/i.test(e) ? `#${e}` : e : "var(--docx-auto-color, black)";
    }
    createSectionContent(e) {
      const t = {}, a = e.columns?.numberOfColumns ?? e.columns?.columns?.length, n = e.docGrid?.type == "linesAndChars" || e.docGrid?.type == "snapToChars";
      return e.docGrid && (e.docGrid.linePitch && (t["--docx-doc-grid-line-pitch"] = e.docGrid.linePitch), n && e.docGrid.charSpace && (t.letterSpacing = e.docGrid.charSpace)), this.document.settingsPart?.settings?.kinsoku && (t.lineBreak = "strict", t.wordBreak = "keep-all"), this.document.settingsPart?.settings?.overflowPunctuation && (t.hangingPunctuation = "allow-end"), this.document.settingsPart?.settings?.topLinePunctuation && (t["text-spacing-trim"] = "space-start"), (this.document.settingsPart?.settings?.autoSpaceDE || this.document.settingsPart?.settings?.autoSpaceDN) && (t["text-autospace"] = [this.document.settingsPart?.settings?.autoSpaceDE ? "ideograph-alpha" : null, this.document.settingsPart?.settings?.autoSpaceDN ? "ideograph-numeric" : null].filter(Boolean).join(" ")), e.columns && a && (t.columnCount = `${a}`, t.columnGap = e.columns.space, !e.columns.equalWidth && e.columns.columns?.length > 0 && (t.columnWidth = e.columns.columns[0].width, t.columnGap = e.columns.columns[0].space ?? t.columnGap), e.columns.separator && (t.columnRule = "1px solid black")), this.h({ tagName: "article", style: t });
    }
    async renderSections(e) {
      const t = [];
      this.processElement(e), this.collectDocumentMetadata(e);
      const a = this.splitBySection(e.children, e.props), n = this.groupByPageBreaks(a);
      let c = null, l = 0, m = 0;
      const f = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map(), u = (p) => {
        if (!r.has(p)) {
          const g = ++m;
          r.set(p, `${this.className}-section-${g}`), o.set(p, g);
        }
      };
      for (const p of n) {
        const g = p[0].sectProps;
        u(g), f.set(g, (f.get(g) ?? 0) + 1);
      }
      this.totalPages = n.length;
      for (let p = 0, g = n.length; p < g; p++) {
        this.currentFootnoteIds = [];
        let T = n[p][0].sectProps;
        u(T);
        const w = c != T;
        l = w && T?.pageNumber?.start != null ? T.pageNumber.start : l + 1, this.currentPageNumber = l, this.currentSectionNumber = o.get(T) ?? 1, this.currentSectionProps = T, this.currentSectionPageNumber = (i.get(T) ?? 0) + 1, this.sectionPageCount = f.get(T) ?? 1, i.set(T, this.currentSectionPageNumber);
        const L = this.createPageElement(this.className, T, e.cssStyle);
        L.dataset.docxSection = r.get(T), L.dataset.docxSectionNumber = `${this.currentSectionNumber}`, L.dataset.docxSectionPageNumber = `${this.currentSectionPageNumber}`, L.dataset.docxSectionPageCount = `${this.sectionPageCount}`, L.dataset.docxPageNumber = `${l}`, w && T?.pageNumber?.start != null && (L.dataset.docxPageStart = `${T.pageNumber.start}`), this.options.renderHeaders && this.renderHeaderFooter(T.headerRefs, T, l, w, L);
        for (const I of n[p]) {
          this.currentSectionProps = I.sectProps;
          var y = this.createSectionContent(I.sectProps);
          I.columnBreak && (y.style.breakBefore = "column"), this.renderElements(I.elements, y), L.appendChild(y), T = I.sectProps;
        }
        if (this.options.renderFootnotes) {
          const I = this.renderNotes(this.currentFootnoteIds, this.footnoteMap, this.document.footnotesPart);
          I && L.appendChild(I);
        }
        if (this.options.renderEndnotes && p == g - 1) {
          const I = this.renderNotes(this.currentEndnoteIds, this.endnoteMap, this.document.endnotesPart);
          I && L.appendChild(I);
        }
        this.currentSectionProps = T, this.options.renderFooters && this.renderHeaderFooter(T.footerRefs, T, l, w, L), t.push(L), await this.yieldDuringRender(p + 1, g), c = T;
      }
      return t;
    }
    renderHeaderFooter(e, t, a, n, c) {
      if (!e) return;
      const l = !!this.document.settingsPart?.settings?.evenAndOddHeaders, m = e.find((r) => r.type == "default");
      var f = (t.titlePage && n ? e.find((r) => r.type == "first") : null) ?? (l && a % 2 == 0 ? e.find((r) => r.type == "even") : null) ?? m, i = f && this.document.findPartByRelId(f.id, this.document.documentPart);
      if (i?.rootElement) {
        this.currentPart = i, this.usedHederFooterParts.includes(i.path) || (this.processElement(i.rootElement), this.usedHederFooterParts.push(i.path));
        const [r] = this.renderElements([i.rootElement], c);
        t?.pageMargins && (i.rootElement.type === d.DomType.Header ? (r.style.marginTop = `calc(${t.pageMargins.header} - ${t.pageMargins.top})`, r.style.minHeight = `calc(${t.pageMargins.top} - ${t.pageMargins.header})`) : i.rootElement.type === d.DomType.Footer && (r.style.marginBottom = `calc(${t.pageMargins.footer} - ${t.pageMargins.bottom})`, r.style.minHeight = `calc(${t.pageMargins.bottom} - ${t.pageMargins.footer})`)), this.currentPart = null;
      } else i && this.options.debug && console.warn(`docx-preview: skipping ${i.path} because its parsed root element is missing`);
    }
    isPageBreakElement(e) {
      return e.type == d.DomType.Break && (e.break == "lastRenderedPageBreak" ? !this.options.ignoreLastRenderedPageBreak : e.break == "page");
    }
    isPageBreakSection(e, t) {
      return !(!e || !t || e.pageSize?.orientation == t.pageSize?.orientation && e.pageSize?.width == t.pageSize?.width && e.pageSize?.height == t.pageSize?.height);
    }
    splitBySection(e, t) {
      let a = { sectProps: null, elements: [], pageBreak: !1, columnBreak: !1, startsAfterExplicitPageBreak: !1 }, n = [a];
      const c = (m = !1, f = !1, i = !1) => {
        if (a.elements.length == 0 && a.sectProps == null) return a.pageBreak || (a.pageBreak = m), void (a.columnBreak || (a.columnBreak = f));
        a.pageBreak || (a.pageBreak = m), a.columnBreak || (a.columnBreak = f), a = { sectProps: null, elements: [], pageBreak: !1, columnBreak: !1, startsAfterExplicitPageBreak: i }, n.push(a);
      };
      for (let m of e) {
        if (m.type != d.DomType.Paragraph) {
          if (m.type == d.DomType.Table) for (const u of this.splitTableByPageBreaks(m)) u.table.children?.length && a.elements.push(u.table), u.breakAfter && c(!0, !1, !0);
          else a.elements.push(m);
          continue;
        }
        const f = m, i = this.findStyle(f.styleName), r = f.pageBreakBefore ?? i?.paragraphProps?.pageBreakBefore;
        this.options.breakPages && r && a.elements.length > 0 && c(!0, !1, !0);
        const o = this.splitParagraphByPageBreaks(f);
        for (const u of o) a.elements.push(u.paragraph), u.breakAfter && c(!0, !1, !0);
        f.sectionProps && (a.sectProps = f.sectionProps, c((0, k.isSectionPageBreak)(f.sectionProps.type), (0, k.isSectionColumnBreak)(f.sectionProps.type)));
      }
      if (n = n.filter((m) => m.elements.length > 0), n.length == 0) return [{ sectProps: t, elements: [], pageBreak: !1, columnBreak: !1 }];
      let l = null;
      for (let m = n.length - 1; m >= 0; m--) n[m].sectProps == null ? n[m].sectProps = l ?? t : l = n[m].sectProps;
      return n;
    }
    hasPageBreakElement(e) {
      return !!this.isPageBreakElement(e) || (e.children?.some((t) => this.hasPageBreakElement(t)) ?? !1);
    }
    splitTableByPageBreaks(e) {
      if (!this.options.breakPages || !e.children?.length) return [{ table: e, breakAfter: !1 }];
      if (!e.children.some((m) => this.hasPageBreakElement(m))) return [{ table: e, breakAfter: !1 }];
      const t = e.children, a = [];
      for (const m of t) {
        if (!m.isHeader) break;
        a.push(m);
      }
      const n = [];
      let c = [];
      const l = (m) => {
        if (c.length == 0 && n.length > 0) return;
        const f = n.length > 0;
        let i = c;
        f && a.length > 0 && !c.some((r) => r.isHeader) && (i = [...a, ...c]), n.push({ table: { ...e, children: i }, breakAfter: m }), c = [];
      };
      for (const m of t) c.push(m), this.hasPageBreakElement(m) && l(!0);
      return l(!1), n.length > 0 ? n : [{ table: e, breakAfter: !1 }];
    }
    splitElementByPageBreaks(e) {
      if (this.isPageBreakElement(e)) return [{ breakAfter: !0 }];
      if (!e.children?.length) return [{ element: e }];
      const t = [];
      let a = { ...e, children: [] };
      const n = () => {
        a.children.length > 0 && t.push({ element: a }), a = { ...e, children: [] };
      };
      for (const c of e.children) for (const l of this.splitElementByPageBreaks(c)) l.element && a.children.push(l.element), l.breakAfter && (n(), t.push({ breakAfter: !0 }));
      return n(), t.length > 0 ? t : [{ element: e }];
    }
    splitParagraphByPageBreaks(e) {
      if (!this.options.breakPages || !e.children?.length) return [{ paragraph: e, breakAfter: !1 }];
      const t = [];
      let a = { ...e, children: [] };
      const n = (l) => {
        (a.children.length > 0 || t.length == 0) && t.push({ paragraph: a, breakAfter: l }), a = { ...e, sectionProps: null, children: [] };
      };
      for (const l of e.children) for (const m of this.splitElementByPageBreaks(l)) m.element && a.children.push(m.element), m.breakAfter && n(!0);
      (a.children.length > 0 || t.length == 0) && t.push({ paragraph: a, breakAfter: !1 });
      const c = t[t.length - 1]?.paragraph;
      for (const l of t) l.paragraph != c && (l.paragraph.sectionProps = null);
      return t;
    }
    styleValuesForTarget(e, t) {
      return e?.styles?.find((a) => a.target == t)?.values;
    }
    styleValue(e, t, a) {
      return this.styleValuesForTarget(e, t)?.[a];
    }
    effectiveParagraphCssValue(e, t, a) {
      return e.cssStyle?.[a] ?? this.styleValue(t, "p", a);
    }
    isInsideTableCell(e) {
      for (let t = e.parent; t; t = t.parent) if (t.type == d.DomType.Cell) return !0;
      return !1;
    }
    paragraphUsesDocumentGrid(e, t) {
      if (!this.currentSectionProps?.docGrid?.linePitch || this.isInsideTableCell(e) && !this.document.settingsPart?.settings?.adjustLineHeightInTable) return !1;
      const n = this.effectiveParagraphCssValue(e, t, "--docx-snap-to-grid");
      return n == null || !/^(0|false|off)$/i.test(n);
    }
    setCssStyle(e, t, a) {
      const n = e.style;
      typeof n.setProperty == "function" ? n.setProperty(t, a) : n[t] = a;
    }
    applyDocumentGridLinePitch(e, t, a) {
      if (!this.paragraphUsesDocumentGrid(e, t) || this.effectiveParagraphCssValue(e, t, "line-height")) return;
      const n = this.currentSectionProps.docGrid.linePitch, c = this.effectiveParagraphCssValue(e, t, "min-height");
      if (!c) return void this.setCssStyle(a, "min-height", n);
      const l = this.parseCssLengthValue(c), m = this.parseCssLengthValue(n);
      l != null && m != null ? l < m && this.setCssStyle(a, "min-height", n) : this.setCssStyle(a, "min-height", `max(${c}, ${n})`);
    }
    groupByPageBreaks(e) {
      let t = [], a = null;
      const n = [t];
      for (let l of e) a && (a.pageBreak || this.isPageBreakSection(a.sectProps, l.sectProps)) && (t = [], n.push(t)), t.push(l), a = l;
      const c = n.filter((l) => l.length > 0).filter((l) => l[0]?.startsAfterExplicitPageBreak || l.some((m) => m.sectProps?.headerRefs?.length > 0 || m.sectProps?.footerRefs?.length > 0 || m.elements.some((f) => this.hasPageModelContent(f))));
      return c.length > 0 ? c : n.filter((l) => l.length > 0).slice(0, 1);
    }
    hasPageModelContent(e) {
      if (!e) return !1;
      switch (e.type) {
        case d.DomType.Text:
        case d.DomType.DeletedText:
          return !!e.text?.trim();
        case d.DomType.Break:
        case d.DomType.Symbol:
        case d.DomType.Drawing:
        case d.DomType.Image:
        case d.DomType.Table:
        case d.DomType.VmlPicture:
        case d.DomType.VmlElement:
        case d.DomType.MmlMath:
        case d.DomType.MmlMathParagraph:
        case d.DomType.Shape:
        case d.DomType.Chart:
        case d.DomType.SmartArt:
        case d.DomType.Ink:
        case d.DomType.AltChunk:
        case d.DomType.FootnoteReference:
        case d.DomType.EndnoteReference:
          return !0;
      }
      return e.children?.some((t) => this.hasPageModelContent(t)) ?? !1;
    }
    async yieldDuringRender(e, t) {
      const a = this.options.renderPageBatchSize ?? 0;
      this.options.progress && this.options.progress({ phase: "render", current: e, total: t, message: `Rendered ${e}/${t} logical pages` }), a > 0 && e % a == 0 && await this.yieldToBrowser();
    }
    async yieldToBrowser() {
      (this.options.renderYieldEveryMs ?? 0) <= 0 || await new Promise((e) => {
        const t = globalThis;
        typeof t.requestIdleCallback == "function" ? t.requestIdleCallback(() => e(), { timeout: Math.max(1, this.options.renderYieldEveryMs ?? 16) }) : typeof t.requestAnimationFrame == "function" ? t.requestAnimationFrame(() => e()) : setTimeout(e, 0);
      });
    }
    renderWrapper(e) {
      return this.h({ tagName: "div", className: this.className + "-wrapper", children: e });
    }
    shouldRunDynamicPagination() {
      return !(!this.options.breakPages || !this.options.fixedPageHeight || this.options.ignoreHeight || typeof document > "u" || typeof requestAnimationFrame != "function");
    }
    scheduleDynamicPagination(e) {
      if (!e || e.dataset.docxPaginated == "true" || e.dataset.docxPaginating == "true" || e.dataset.docxPaginationScheduled == "true") return;
      e.dataset.docxPaginationScheduled = "true";
      const t = () => {
        (document.fonts?.ready ?? Promise.resolve()).finally(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => this.performDynamicPagination(e)));
        });
      }, a = () => {
        e && e.dataset.docxPaginated != "true" && e.dataset.docxPaginating != "true" && (e.isConnected ? t() : setTimeout(a, 0));
      };
      a();
    }
    async performDynamicPagination(e) {
      if (!e || e.dataset.docxPaginated == "true" || e.dataset.docxPaginating == "true") return;
      if (!e.isConnected) return void setTimeout(() => this.performDynamicPagination(e), 0);
      delete e.dataset.docxPaginationScheduled, e.dataset.docxPaginating = "true";
      const t = Array.from(e.querySelectorAll(":scope > section." + this.className)), a = this.options.maxDynamicPaginationPasses ?? 1e3;
      let n = 0;
      for (let c = 0; c < t.length; c++) {
        const l = t[c];
        for (c % 2 == 0 && await this.yieldToBrowser(); this.isPageOverflowing(l) && n++ < a; ) {
          const m = Array.from(l.querySelectorAll(":scope > article"));
          if (!m.some((o) => o.children.length > 0)) break;
          const f = this.createContinuationPage(l), i = Array.from(f.querySelectorAll(":scope > article"));
          let r = !1;
          for (let o = m.length - 1; o >= 0 && this.isPageOverflowing(l); o--) {
            const u = m[o], y = i[o];
            let p = 0;
            if (y) {
              for (; this.isPageOverflowing(l) && u.lastElementChild && p++ < 500; ) if (p % 20 == 0 && await this.yieldToBrowser(), u.children.length > 1) {
                let g = this.pickPaginationChunk(u);
                if (g.length == 0) break;
                if (g.length >= u.children.length) {
                  if (this.splitOverflowBlock(u.lastElementChild, l, y)) {
                    r = !0;
                    continue;
                  }
                  g = [u.lastElementChild];
                }
                for (let T = g.length - 1; T >= 0; T--) y.prepend(g[T]), r = !0;
              } else {
                if (!this.splitOverflowBlock(u.lastElementChild, l, y)) break;
                r = !0;
              }
              if (o > 0 && this.isPageOverflowing(l)) for (; u.lastElementChild; ) y.prepend(u.lastElementChild), r = !0;
            }
          }
          if (!r) {
            f.remove();
            break;
          }
          t.splice(c + 1, 0, f);
        }
      }
      this.cleanupEmptyNumberedParagraphs(e), this.removeEmptyDynamicPages(e), this.updateDynamicFieldPages(e), delete e.dataset.docxPaginating, e.dataset.docxPaginated = "true";
    }
    pickPaginationChunk(e) {
      const t = Array.from(e.children);
      if (t.length == 0) return [];
      let a = t.length - 1;
      for (; a > 0 && this.isKeepWithNext(t[a - 1]); ) a--;
      return t.slice(a);
    }
    isKeepWithNext(e) {
      if (e.dataset.docxKeepNext == "true") return !0;
      const t = getComputedStyle(e);
      return t.breakAfter == "avoid" || t.pageBreakAfter == "avoid";
    }
    isPageOverflowing(e) {
      const t = this.options.paginationTolerance ?? 2;
      if (e.clientHeight <= 0) return !1;
      const a = e.getBoundingClientRect();
      let n = a.top;
      for (const c of Array.from(e.children)) {
        const l = c.getBoundingClientRect();
        if (n = Math.max(n, l.bottom), c.tagName.toLowerCase() == "article") for (const m of Array.from(c.children)) {
          const f = m.getBoundingClientRect();
          n = Math.max(n, f.bottom);
        }
      }
      return n > a.bottom + t;
    }
    createContinuationPage(e) {
      const t = e.cloneNode(!0);
      t.dataset.docxDynamicPage = "true", t.removeAttribute("id");
      for (const a of Array.from(t.querySelectorAll(":scope > article"))) a.textContent = "";
      return e.after(t), t;
    }
    splitOverflowBlock(e, t, a) {
      if (!e || e.dataset.docxKeepLines == "true") return !1;
      const n = getComputedStyle(e);
      if (n.breakInside == "avoid" || n.pageBreakInside == "avoid") return !1;
      switch (e.tagName.toLowerCase()) {
        case "p":
          return this.splitParagraphBlock(e, t, a);
        case "table":
          return this.splitTableBlock(e, t, a);
      }
      return !1;
    }
    splitParagraphBlock(e, t, a) {
      if (!e.hasChildNodes()) return !1;
      const n = this.cloneBlockShell(e);
      n.dataset.docxContinued = "true", a.prepend(n);
      let c = !1, l = 0;
      for (; this.isPageOverflowing(t) && e.hasChildNodes() && l++ < 1e3 && this.moveTailInlineNode(e, n, t); ) c = !0, this.removeEmptyInlineContainers(e);
      return c ? (e.hasChildNodes() ? this.options.strictWordCompatibility && e.dataset.docxWidowControl == "true" && this.rebalanceWidowOrphan(e, n, t) : e.remove(), !0) : (n.remove(), !1);
    }
    splitTableBlock(e, t, a) {
      const n = this.tableContentRows(e);
      if (n.length <= 1) return !1;
      const c = this.cloneBlockShell(e);
      c.dataset.docxContinued = "true";
      for (const f of Array.from(e.children)) f.tagName?.toLowerCase() == "colgroup" && c.appendChild(f.cloneNode(!0));
      for (const f of n.filter((i) => i.dataset.docxRepeatHeader == "true")) {
        const i = f.cloneNode(!0);
        i.dataset.docxRepeatedHeader = "true", c.appendChild(i);
      }
      a.prepend(c);
      let l = !1, m = 0;
      for (; this.isPageOverflowing(t) && this.tableContentRows(e).length > 1 && m++ < 500; ) {
        const f = this.tableContentRows(e).filter((r) => r.dataset.docxRepeatedHeader != "true"), i = f[f.length - 1];
        if (!i) break;
        c.insertBefore(i, this.firstMovedTableRow(c)), l = !0;
      }
      return !!l || (c.remove(), !1);
    }
    cloneBlockShell(e) {
      const t = e.cloneNode(!1);
      return t.removeAttribute("id"), t;
    }
    tableContentRows(e) {
      return Array.from(e.querySelectorAll(":scope > tr, :scope > tbody > tr"));
    }
    firstMovedTableRow(e) {
      return this.tableContentRows(e).find((t) => t.dataset.docxRepeatedHeader != "true") ?? null;
    }
    moveTailInlineNode(e, t, a) {
      const n = e.lastChild;
      if (!n) return !1;
      if (n.nodeType == Node.TEXT_NODE) return this.moveTextTail(n, t, a);
      if (n instanceof Element && n.childNodes.length > 0 && n.tagName?.toLowerCase() != "br") {
        const c = n.cloneNode(!1);
        c.removeAttribute("id"), t.prepend(c);
        const l = this.moveTailInlineNode(n, c, a);
        return n.hasChildNodes() || n.remove(), c.hasChildNodes() || c.remove(), l;
      }
      return t.prepend(n), !0;
    }
    moveTextTail(e, t, a) {
      const n = e.data ?? "";
      if (!n) return !1;
      const c = document.createTextNode("");
      if (t.prepend(c), n.length == 1) return c.data = n, e.remove(), !0;
      let l = 1, m = n.length, f = n.length;
      for (; l <= m; ) {
        const i = Math.floor((l + m) / 2);
        e.data = n.substring(0, n.length - i), c.data = n.substring(n.length - i), this.isPageOverflowing(a) ? l = i + 1 : (f = i, m = i - 1);
      }
      return f = this.adjustSplitToWordBoundary(n, f), e.data = n.substring(0, n.length - f), c.data = n.substring(n.length - f), e.data || e.remove(), !0;
    }
    adjustSplitToWordBoundary(e, t) {
      if (t <= 1 || t >= e.length) return t;
      const a = e.length - t, n = e.lastIndexOf(" ", a);
      return n > 0 && a - n < 32 ? e.length - n - 1 : t;
    }
    removeEmptyInlineContainers(e) {
      for (const t of Array.from(e.childNodes)) t instanceof HTMLElement && (this.removeEmptyInlineContainers(t), t.hasChildNodes() || /^(br|img|svg|math)$/i.test(t.tagName) || t.remove());
    }
    cleanupEmptyNumberedParagraphs(e) {
      const t = `p[class*="${this.className}-num-"]`;
      for (const a of Array.from(e.querySelectorAll(t))) {
        if (this.hasVisiblePaginationContent(a) || !a.id && !a.querySelector("[id], a[name]")) continue;
        const n = this.findNextVisiblePaginationBlock(e, a);
        n && this.moveAnchorsToBlock(a, n), a.remove();
      }
    }
    removeEmptyDynamicPages(e) {
      const t = Array.from(e.querySelectorAll(`:scope > section.${this.className}[data-docx-dynamic-page="true"]`));
      for (const a of t) {
        const n = Array.from(a.querySelectorAll(":scope > article")), c = n.some((l) => Array.from(l.children).some((m) => this.hasVisiblePaginationContent(m)));
        n.length > 0 && !c && a.remove();
      }
    }
    findNextVisiblePaginationBlock(e, t) {
      const a = Array.from(e.querySelectorAll("article p, article table, article figure, article img, article svg, article math"));
      for (let n = a.indexOf(t) + 1; n < a.length; n++) {
        const c = a[n];
        if (this.hasVisiblePaginationContent(c)) return c;
      }
      return null;
    }
    hasVisiblePaginationContent(e) {
      return (e.textContent ?? "").replace(/\s+/g, "").length > 0 || !!e.querySelector("br,img,svg,math,object,canvas,video,table");
    }
    moveAnchorsToBlock(e, t) {
      const a = Array.from(e.querySelectorAll("[id], a[name]"));
      e.id && !t.id && (t.id = e.id);
      for (let n = a.length - 1; n >= 0; n--) {
        const c = a[n];
        c.id && t.querySelector(`#${CSS.escape(c.id)}`) || t.prepend(c);
      }
    }
    rebalanceWidowOrphan(e, t, a) {
      const n = this.visualLineCount(e), c = this.visualLineCount(t);
      if (n >= 2 && c >= 2) return;
      if (n < 2 && e.parentElement && t.hasChildNodes()) return t.prepend(...Array.from(e.childNodes)), void e.remove();
      let l = 0;
      for (; this.visualLineCount(t) < 2 && e.hasChildNodes() && l++ < 20 && !this.isPageOverflowing(a) && this.moveTailInlineNode(e, t, a); ) ;
    }
    visualLineCount(e) {
      try {
        const t = document.createRange();
        t.selectNodeContents(e);
        const a = Array.from(t.getClientRects());
        t.detach?.();
        const n = new Set(a.map((c) => Math.round(c.top)));
        return Math.max(n.size, 1);
      } catch {
        return 1;
      }
    }
    updateDynamicFieldPages(e) {
      const t = Array.from(e.querySelectorAll(":scope > section." + this.className)), a = {}, n = {}, c = {}, l = [], m = [];
      let f = 0, i = "";
      for (const r of t) {
        const o = r.dataset.docxSection ?? "";
        n[o] = (n[o] ?? 0) + 1;
      }
      if (t.forEach((r, o) => {
        const u = r.dataset.docxSection ?? "";
        if (u != i) {
          const y = r.dataset.docxPageStart != null ? parseInt(r.dataset.docxPageStart, 10) : null;
          f = Number.isFinite(y) ? y : f + 1, c[u] = 1, i = u;
        } else f++, c[u] = (c[u] ?? 0) + 1;
        r.dataset.docxPageNumber = `${f}`, r.dataset.docxSectionPageNumber = `${c[u]}`, r.dataset.docxSectionPageCount = `${n[u] ?? 1}`, l[o] = f, m[o] = c[u];
        for (const y of Array.from(r.querySelectorAll("[id]"))) y.id && a[y.id] == null && (a[y.id] = f);
      }), t.forEach((r, o) => {
        const u = r.dataset.docxSection ?? "";
        for (const y of Array.from(r.querySelectorAll("[data-docx-field-instr]"))) {
          const p = this.evaluateDynamicField(y.dataset.docxFieldInstr, l[o] ?? o + 1, t.length, a, n[u] ?? 1, m[o] ?? 1, parseInt(r.dataset.docxSectionNumber ?? "1", 10));
          p != null && (y.textContent = p);
        }
      }), this.options.updatePageReferences) for (const r of Array.from(e.querySelectorAll("[data-docx-page-ref]"))) {
        const o = r.dataset.docxPageRef;
        r.textContent = `${a[o] ?? 1}`;
      }
    }
    evaluateDynamicField(e, t, a, n, c = a, l = t, m = 1) {
      const f = this.tokenizeFieldInstruction((e ?? "").replace(/\s+/g, " ").trim()), i = f[0]?.replace(/^=/, "").toUpperCase();
      let r = null;
      switch (i) {
        case "PAGE":
          r = this.formatFieldNumber(t, this.fieldFormatSwitchToNumFormat(this.fieldSwitch(f, "\\*") ?? this.currentSectionProps?.pageNumber?.format));
          break;
        case "NUMPAGES":
          r = this.formatFieldNumber(a, this.fieldFormatSwitchToNumFormat(this.fieldSwitch(f, "\\*") ?? this.currentSectionProps?.pageNumber?.format));
          break;
        case "SECTIONPAGES":
          r = this.formatFieldNumber(c, this.fieldFormatSwitchToNumFormat(this.fieldSwitch(f, "\\*") ?? this.currentSectionProps?.pageNumber?.format));
          break;
        case "SECTION":
          r = this.formatFieldNumber(m, this.fieldFormatSwitchToNumFormat(this.fieldSwitch(f, "\\*") ?? "decimal"));
          break;
        case "PAGEREF": {
          if (!this.options.updatePageReferences) return null;
          const o = this.firstFieldArgument(f);
          r = o ? `${n[o] ?? 1}` : "";
          break;
        }
      }
      return r == null ? null : this.applyFieldFormatting(r, e);
    }
    renderDefaultStyle() {
      var e = this.className;
      const t = !!this.options.darkMode, a = t ? "#242424" : "gray", n = t ? (0, s.getDarkModeColor)("white") : "white", c = t ? (0, s.getDarkModeColor)("black") : "black";
      var l = `
.${e}-wrapper { background: ${a}; padding: 30px; padding-bottom: 0px; display: flex; flex-flow: column; align-items: center; }
.${e}-wrapper>section.${e} { background: ${n}; box-shadow: ${t ? "0 0 10px rgba(0, 0, 0, 0.8)" : "0 0 10px rgba(0, 0, 0, 0.5)"}; margin-bottom: 30px;${t ? " outline: 1px solid rgba(255, 255, 255, 0.15); outline-offset: -1px;" : ""} }`;
      this.options.hideWrapperOnPrint && (l = `@media not print { ${l} }`);
      var m = `${l}
.${e} { --docx-auto-color: ${c}; color: var(--docx-auto-color); font-size: 10.5pt; hyphens: auto; text-underline-position: from-font; font-kerning: normal; font-variant-ligatures: common-ligatures contextual; text-rendering: optimizeLegibility; line-break: auto; }
section.${e} { box-sizing: border-box; display: flex; flex-flow: column nowrap; position: relative; overflow: visible; isolation: isolate; }
section.${e}>article { z-index: 1; }
section.${e}>article:last-of-type { margin-bottom: auto; }
section.${e}>footer { z-index: 1; }
.${e} [data-docx-continued="true"] { margin-top: 0 !important; }
.${e} tr[data-docx-repeat-header="true"], .${e} tr[data-docx-repeated-header="true"] { break-after: avoid; }
.${e} table { border-collapse: collapse; }
.${e} table td, .${e} table th { vertical-align: top; overflow-wrap: anywhere; }
.${e} p { margin: 0pt; min-height: 1em; }
.${e} span { white-space: pre-wrap; overflow-wrap: break-word; font-feature-settings: "kern" 1; }
.${e} table span { overflow-wrap: anywhere; }
.${e} .${e}-float-wrap { shape-margin: 0.15in; }
.${e} .${e}-field { white-space: pre-wrap; }
.${e} .${e}-tab-stop { display: inline-block; min-width: 1em; white-space: nowrap; line-height: 1; }
.${e} .${e}-tab-stop[data-docx-tab-leader="dot"], .${e} .${e}-tab-stop[data-docx-tab-leader="middleDot"] { min-width: 2em; border-bottom: 1px dotted currentColor; height: .85em; transform: translateY(-.18em); }
.${e} .${e}-tab-stop[data-docx-tab-leader="hyphen"], .${e} .${e}-tab-stop[data-docx-tab-leader="heavy"], .${e} .${e}-tab-stop[data-docx-tab-leader="underscore"] { min-width: 2em; border-bottom: 1px solid currentColor; height: .85em; transform: translateY(-.18em); }
.${e} .${e}-tab-leader-paragraph > a, .${e} .${e}-tab-leader-paragraph > .${e}-tab-leader-line, .${e} .${e}-tab-leader-line { display: inline-flex; align-items: baseline; width: calc(100% - var(--docx-text-indent, 0pt)); color: inherit !important; text-decoration: none !important; box-sizing: border-box; max-width: none; text-indent: 0; }
.${e} .${e}-tab-leader-paragraph > a, .${e} .${e}-tab-leader-paragraph > a * { color: inherit !important; text-decoration: none !important; }
.${e} .${e}-toc-paragraph a, .${e} .${e}-toc-paragraph a * { color: inherit !important; text-decoration: none !important; }
.${e} .${e}-toc-paragraph.${e}-tab-leader-paragraph[class*="${e}-num-"] { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: .35em; align-items: baseline; list-style-position: outside; list-style-type: none; text-indent: 0 !important; }
.${e} .${e}-toc-paragraph.${e}-tab-leader-paragraph[class*="${e}-num-"]::before { grid-column: 1; grid-row: 1; white-space: pre; margin-inline-end: 0; }
.${e} .${e}-toc-paragraph.${e}-tab-leader-paragraph[class*="${e}-num-"] > a { grid-column: 2; grid-row: 1; display: inline-flex; flex: 1 1 auto; width: auto; min-width: 0; max-width: 100%; }
.${e} .${e}-tab-leader-title { flex: 0 1 auto; min-width: 0; }
.${e} .${e}-tab-leader-page { flex: 0 0 auto; white-space: nowrap; text-align: right; }
.${e} .${e}-tab-leader-fill, .${e} .${e}-tab-leader-paragraph > a > .${e}-tab-stop[data-docx-tab-leader="dot"], .${e} .${e}-tab-leader-paragraph > a > .${e}-tab-stop[data-docx-tab-leader="middleDot"], .${e} .${e}-tab-leader-paragraph > .${e}-tab-stop[data-docx-tab-leader="dot"], .${e} .${e}-tab-leader-paragraph > .${e}-tab-stop[data-docx-tab-leader="middleDot"] { flex: 1 1 auto; width: auto; margin: 0 .2em; }
.${e} .${e}-literal-leader-line > .${e}-tab-leader-title { flex: 0 0 auto; white-space: nowrap; }
.${e} .${e}-toc { display: table; width: 100%; }
.${e} .${e}-toc-entry { display: table-row; }
.${e} .${e}-toc-title, .${e} .${e}-toc-page { display: table-cell; }
.${e} .${e}-toc-title { border-bottom: 1px dotted currentColor; }
.${e} .${e}-toc-page { text-align: right; width: 3em; }
.${e} math { font-family: Cambria Math, STIX Two Math, Latin Modern Math, serif; }
.${e} ruby { ruby-position: over; }
.${e} rt { font-size: 0.5em; line-height: 1; }
.${e} .${e}-chart, .${e} .${e}-smartart, .${e} .${e}-ink { min-width: 2in; min-height: 1in; }
.${e} a { color: inherit; text-decoration: inherit; }
.${e} svg { fill: transparent; }
@media print { .${e}-wrapper { background: transparent; padding: 0; display: block; } .${e}-wrapper>section.${e}, section.${e} { background: white; margin: 0 auto; box-shadow: none; outline: none; break-after: page; page-break-after: always; } .${e} { --docx-auto-color: black; color: black; } }
`;
      return this.options.renderComments && (m += `
.${e}-comment-ref { cursor: default; }
.${e}-comment-popover { display: none; z-index: 1000; padding: 0.5rem; background: ${n}; position: absolute; box-shadow: 0 0 0.25rem rgba(0, 0, 0, 0.25); width: 30ch; }
.${e}-comment-ref:hover~.${e}-comment-popover { display: block; }
.${e}-comment-author,.${e}-comment-date { font-size: 0.875rem; color: ${t ? (0, s.getDarkModeColor)("#888888") : "#888"}; }
`), [this.h({ tagName: "#comment", children: ["docxjs library predefined styles"] }), this.h({ tagName: "style", children: [m] })];
    }
    async renderNumbering(e) {
      var t = "", a = [];
      const n = /* @__PURE__ */ new Map(), c = new Map(e.map((r) => [`${r.id}:${r.level}`, this.numFormatToCssValue(r.format)])), l = (r, o) => {
        const u = n.get(r) ?? [];
        u.push(o), n.set(r, u);
      };
      for (var m of e) {
        var f = this.numberingSelector(m.id, m.level), i = "none";
        if (m.bullet) {
          let r = `--${this.className}-${m.bullet.src}`.toLowerCase();
          t += this.styleToString(`${f}:before`, { content: "' '", display: "inline-block", background: `var(${r})` }, m.bullet.style);
          try {
            const o = await this.document.loadNumberingImage(m.bullet.src);
            t += `${this.rootSelector} { ${r}: url(${o}) }`;
          } catch {
            this.options.debug && console.warn(`Can't load numbering image with src ${m.bullet.src}`);
          }
        } else if (m.levelText) {
          let r = this.numberingCounter(m.id, m.level);
          const o = r + " " + (m.start - 1), u = this.numberingRestartLevel(m);
          u != null && l(this.numberingSelector(m.id, u), o), a.push(o);
          const y = this.normalizeNumberingLevelText(m.levelText, m.format, m.rStyle), p = this.numberingMarkerRunStyle(m.rStyle, y.normalized);
          t += this.styleToString(`${f}:before`, { content: this.levelTextToContent(y.text, m.suff, m.id, this.numFormatToCssValue(m.format), c), "counter-increment": r, "font-family": "var(--docx-marker-font-family, inherit)", "font-size": "var(--docx-marker-font-size, inherit)", "font-style": "var(--docx-marker-font-style, inherit)", "font-weight": "var(--docx-marker-font-weight, inherit)", ...p });
        } else i = this.numFormatToCssValue(m.format);
        t += this.styleToString(f, { display: "list-item", "list-style-position": "inside", "list-style-type": i, ...m.pStyle });
      }
      for (const [r, o] of n) t += this.styleToString(r, { "counter-set": o.join(" ") });
      return a.length > 0 && (t += this.styleToString(this.rootSelector, { "counter-reset": a.join(" ") })), [this.h({ tagName: "#comment", children: ["docxjs document numbering styles"] }), this.h({ tagName: "style", children: [t] })];
    }
    renderStyles(e) {
      var t = "";
      const a = this.styleMap, n = (0, h.keyBy)(e.filter((f) => f.isDefault), (f) => f.target);
      for (const f of e) {
        var c = f.styles;
        if (f.linked) {
          var l = f.linked && a[f.linked];
          l ? c = c.concat(l.styles) : this.options.debug && console.warn(`Can't find linked style ${f.linked}`);
        }
        for (const i of c) {
          var m = `${f.target ?? ""}.${f.cssName}${i.mod ?? ""}`;
          f.target != i.target && (m += ` ${i.target}`), m = this.scopeDocumentStyleSelector(m), n[f.target] == f && (m = `.${this.className} ${f.target}, ` + m), t += this.styleToString(m, i.values);
        }
      }
      return [this.h({ tagName: "#comment", children: ["docxjs document styles"] }), this.h({ tagName: "style", children: [t] })];
    }
    renderNotes(e, t, a) {
      var n = e.map((c) => t[c]).filter((c) => c);
      if (n.length > 0) {
        const c = this.currentPart;
        this.currentPart = a ?? c;
        const l = this.renderElements(n);
        return this.currentPart = c, this.h({ tagName: "ol", children: l });
      }
    }
    renderElement(e) {
      switch (e.type) {
        case d.DomType.Paragraph:
          return this.renderParagraph(e);
        case d.DomType.BookmarkStart:
          return this.renderBookmarkStart(e);
        case d.DomType.BookmarkEnd:
          return null;
        case d.DomType.Run:
          return this.renderRun(e);
        case d.DomType.Table:
          return this.renderTable(e);
        case d.DomType.Row:
          return this.renderTableRow(e);
        case d.DomType.Cell:
          return this.renderTableCell(e);
        case d.DomType.Hyperlink:
          return this.renderHyperlink(e);
        case d.DomType.SmartTag:
          return this.renderSmartTag(e);
        case d.DomType.Drawing:
          return this.renderDrawing(e);
        case d.DomType.Image:
          return this.renderImage(e);
        case d.DomType.Shape:
          return this.renderShape(e);
        case d.DomType.Chart:
          return this.renderChart(e);
        case d.DomType.SmartArt:
          return this.renderSmartArt(e);
        case d.DomType.Ink:
          return this.renderInk(e);
        case d.DomType.SimpleField:
          return this.renderSimpleField(e);
        case d.DomType.Instruction:
        case d.DomType.ComplexField:
          return null;
        case d.DomType.Text:
          return this.renderText(e);
        case d.DomType.DeletedText:
          return this.renderDeletedText(e);
        case d.DomType.Tab:
          return this.renderTab(e);
        case d.DomType.Symbol:
          return this.renderSymbol(e);
        case d.DomType.Break:
          return this.renderBreak(e);
        case d.DomType.Footer:
          return this.renderContainer(e, "footer");
        case d.DomType.Header:
          return this.renderContainer(e, "header");
        case d.DomType.Footnote:
        case d.DomType.Endnote:
          return this.renderContainer(e, "li");
        case d.DomType.FootnoteReference:
          return this.renderFootnoteReference(e);
        case d.DomType.EndnoteReference:
          return this.renderEndnoteReference(e);
        case d.DomType.NoBreakHyphen:
          return this.h("‑");
        case d.DomType.SoftHyphen:
          return this.h("­");
        case d.DomType.PositionalTab:
          return this.renderTab(e);
        case d.DomType.Ruby:
          return this.renderRuby(e);
        case d.DomType.RubyBase:
          return this.renderContainer(e, "span");
        case d.DomType.RubyText:
          return this.toHTML(e, S.ns.html, "rt");
        case d.DomType.VmlPicture:
          return this.renderVmlPicture(e);
        case d.DomType.VmlElement:
          return this.renderVmlElement(e);
        case d.DomType.MmlMath:
          return this.renderContainerNS(e, S.ns.mathML, "math", { xmlns: S.ns.mathML });
        case d.DomType.MmlMathParagraph:
          return this.renderMmlMathParagraph(e);
        case d.DomType.MmlFraction:
          return this.renderContainerNS(e, S.ns.mathML, "mfrac");
        case d.DomType.MmlBase:
          return this.renderContainerNS(e, S.ns.mathML, e.parent?.type == d.DomType.MmlMatrixRow ? "mtd" : "mrow");
        case d.DomType.MmlNumerator:
        case d.DomType.MmlDenominator:
        case d.DomType.MmlFunction:
        case d.DomType.MmlLimit:
        case d.DomType.MmlBox:
          return this.renderContainerNS(e, S.ns.mathML, "mrow");
        case d.DomType.MmlGroupChar:
          return this.renderMmlGroupChar(e);
        case d.DomType.MmlLimitLower:
          return this.renderContainerNS(e, S.ns.mathML, "munder");
        case d.DomType.MmlLimitUpper:
          return this.renderContainerNS(e, S.ns.mathML, "mover");
        case d.DomType.MmlSubSuperscript:
          return this.renderContainerNS(e, S.ns.mathML, "msubsup");
        case d.DomType.MmlPhantom:
          return this.renderMmlPhantom(e);
        case d.DomType.MmlBorderBox:
          return this.renderContainerNS(e, S.ns.mathML, "menclose");
        case d.DomType.MmlAccent:
          return this.renderMmlAccent(e);
        case d.DomType.MmlMatrix:
          return this.renderContainerNS(e, S.ns.mathML, "mtable");
        case d.DomType.MmlMatrixRow:
          return this.renderContainerNS(e, S.ns.mathML, "mtr");
        case d.DomType.MmlRadical:
          return this.renderMmlRadical(e);
        case d.DomType.MmlSuperscript:
          return this.renderContainerNS(e, S.ns.mathML, "msup");
        case d.DomType.MmlSubscript:
          return this.renderContainerNS(e, S.ns.mathML, "msub");
        case d.DomType.MmlDegree:
        case d.DomType.MmlSuperArgument:
        case d.DomType.MmlSubArgument:
          return this.renderContainerNS(e, S.ns.mathML, "mrow");
        case d.DomType.MmlFunctionName:
          return this.renderContainerNS(e, S.ns.mathML, "mi");
        case d.DomType.MmlDelimiter:
          return this.renderMmlDelimiter(e);
        case d.DomType.MmlRun:
          return this.renderMmlRun(e);
        case d.DomType.MmlNary:
          return this.renderMmlNary(e);
        case d.DomType.MmlPreSubSuper:
          return this.renderMmlPreSubSuper(e);
        case d.DomType.MmlBar:
          return this.renderMmlBar(e);
        case d.DomType.MmlEquationArray:
          return this.renderMllList(e);
        case d.DomType.Inserted:
          return this.renderInserted(e);
        case d.DomType.Deleted:
          return this.renderDeleted(e);
        case d.DomType.CommentRangeStart:
          return this.renderCommentRangeStart(e);
        case d.DomType.CommentRangeEnd:
          return this.renderCommentRangeEnd(e);
        case d.DomType.CommentReference:
          return this.renderCommentReference(e);
        case d.DomType.AltChunk:
          return this.renderAltChunk(e);
      }
      return null;
    }
    renderElements(e, t) {
      if (e == null) return null;
      const a = [];
      for (let n = 0; n < e.length; n++) {
        const c = this.tryRenderComplexField(e, n);
        c ? (a.push(...(0, h.asArray)(c.node).filter((l) => l != null)), n = c.nextIndex - 1) : a.push(...(0, h.asArray)(this.renderElement(e[n])).filter((l) => l != null));
      }
      return t && a.forEach((n) => t.appendChild((0, h.isString)(n) ? document.createTextNode(n) : n)), a;
    }
    tryRenderComplexField(e, t) {
      if (!this.hasFieldChar(e[t], "begin")) return null;
      let a = 0, n = !1, c = "";
      const l = [];
      for (let m = t; m < e.length; m++) {
        const f = e[m], i = f.type == d.DomType.Run ? { ...f, fieldRun: !1, children: [] } : null;
        if (f.type == d.DomType.Run) {
          for (const r of f.children ?? []) {
            if (r.type == d.DomType.ComplexField) {
              const o = r;
              if (o.charType == "begin") a++;
              else if (o.charType == "separate" && a == 1) n = !0;
              else if (o.charType == "end" && (a--, a == 0)) return i.children.length > 0 && l.push(i), { node: this.renderSimpleField({ type: d.DomType.SimpleField, instruction: c, lock: !1, dirty: !1, children: l }), nextIndex: m + 1 };
              continue;
            }
            n || a != 1 || r.type != d.DomType.Instruction ? n && a > 0 && i.children.push(r) : c += r.text ?? "";
          }
          i.children.length > 0 && l.push(i);
        } else n && a > 0 && l.push(f);
      }
      return null;
    }
    hasFieldChar(e, t) {
      return e.type == d.DomType.Run && e.children?.some((a) => a.type == d.DomType.ComplexField && a.charType == t);
    }
    renderContainer(e, t) {
      return this.h({ tagName: t, children: this.renderElements(e.children) });
    }
    renderContainerNS(e, t, a, n) {
      return this.h({ ns: t, tagName: a, children: this.renderElements(e.children), ...n });
    }
    effectiveParagraphTabs(e, t) {
      if (!e?.length) return t;
      if (!t?.length) return e;
      const a = [...t];
      for (const n of e) {
        const c = this.parseCssLengthValue(n.position), l = a.findIndex((m) => this.parseCssLengthValue(m.position) == c);
        l >= 0 ? a[l] = n : a.push(n);
      }
      return a.sort((n, c) => (this.parseCssLengthValue(n.position) ?? 0) - (this.parseCssLengthValue(c.position) ?? 0));
    }
    countParagraphTabs(e) {
      let t = 0;
      const a = (n) => {
        n.type != d.DomType.Tab && n.type != d.DomType.PositionalTab || t++;
        for (const c of n.children ?? []) a(c);
      };
      return a(e), t;
    }
    isLeaderTabStop(e) {
      return !!e?.leader && e.leader != "none" && e.style != "clear";
    }
    resolveRenderedTabStop(e, t, a) {
      if (!e?.length) return null;
      const n = e[Math.min(t, Math.max(e.length - 1, 0))], c = [...e].reverse().find((i) => this.isLeaderTabStop(i)), l = this.findStyle(this.currentParagraph?.styleName), m = this.isTocParagraphStyle(this.currentParagraph?.styleName, l), f = !!c && !!(this.currentParagraph?.numbering ?? l?.paragraphProps?.numbering) && m;
      return c ? a <= 1 ? m || f ? c : n : t >= a - 1 ? c : this.isLeaderTabStop(n) ? e.slice(0, Math.min(t + 1, e.length)).reverse().find((i) => !this.isLeaderTabStop(i) && i.style != "clear") ?? e.find((i) => !this.isLeaderTabStop(i) && i.style != "clear") ?? null : n : n;
    }
    renderParagraph(e) {
      const t = this.findStyle(e.styleName);
      e.tabs = this.effectiveParagraphTabs(e.tabs, t?.paragraphProps?.tabs);
      const a = this.currentParagraph, n = this.currentParagraphTabIndex, c = this.currentParagraphTabCount;
      this.currentParagraph = e, this.currentParagraphTabIndex = 0, this.currentParagraphTabCount = this.countParagraphTabs(e);
      const l = this.renderElements(e.children), m = e.props?.deletedParagraphMark && !this.options.renderChanges;
      if (m && !this.hasRenderedContent(l)) return this.currentParagraph = a, this.currentParagraphTabIndex = n, this.currentParagraphTabCount = c, null;
      if (m) return this.currentParagraph = a, this.currentParagraphTabIndex = n, this.currentParagraphTabCount = c, l;
      var f = this.toHTML(e, S.ns.html, "p", this.wrapTabLeaderChildren(l, !0));
      const i = this.effectiveParagraphCssValue(e, t, "--docx-snap-to-grid");
      /^(0|false|off)$/i.test(i ?? "") && (f.style.letterSpacing = "normal"), this.currentParagraph = a, this.currentParagraphTabIndex = n, this.currentParagraphTabCount = c;
      const r = e.numbering ?? t?.paragraphProps?.numbering;
      r && f.classList.add(this.numberingClass(r.id, r.level));
      const o = t?.paragraphProps;
      (e.pageBreakBefore ?? o?.pageBreakBefore) && (f.style.breakBefore = "page", f.dataset.docxPageBreakBefore = "true"), (e.keepLines ?? o?.keepLines) && (f.style.breakInside = "avoid", f.dataset.docxKeepLines = "true"), (e.keepNext ?? o?.keepNext) && (f.style.breakAfter = "avoid", f.dataset.docxKeepNext = "true"), (e.widowControl ?? o?.widowControl) && (f.style.orphans = "2", f.style.widows = "2", f.dataset.docxWidowControl = "true"), this.applyDocumentGridLinePitch(e, t, f);
      const u = e.tabs?.find((y) => this.isLeaderTabStop(y));
      return u && (f.classList.add(`${this.className}-tab-leader-paragraph`), f.dataset.docxHasTabLeader = "true", f.dataset.docxTabLeader = u.leader, f.dataset.docxTabAlign = u.style), this.isTocParagraphStyle(e.styleName, t) && (f.classList.add(`${this.className}-toc-paragraph`), f.dataset.docxTocEntry = "true"), this.hasParagraphRelativeAnchor(e) && (f.style.position && f.style.position != "static" || (f.style.position = "relative"), f.dataset.docxAnchorContext = "paragraph", this.compensatePageRelativeAnchors(f)), e.props?.anchorId && (f.id = e.props.anchorId, f.setAttribute("id", e.props.anchorId)), f;
    }
    compensatePageRelativeAnchors(e) {
      const t = (a) => {
        for (const n of Array.from(a.children ?? [])) {
          const c = n;
          c.dataset?.docxAnchorVertical == "page" && c.style?.top && (c.style.top = `calc(${c.style.top} - var(--docx-paragraph-page-offset-top, var(--docx-page-padding-top, 0pt)))`), c.dataset?.docxAnchorHorizontal == "page" && c.style?.left && (c.style.left = `calc(${c.style.left} - var(--docx-paragraph-page-offset-left, var(--docx-page-padding-left, 0pt)))`), t(c);
        }
      };
      t(e);
    }
    hasParagraphRelativeAnchor(e) {
      for (const t of e.children ?? []) {
        if ((t.type == d.DomType.Drawing || t.type == d.DomType.VmlElement) && t.cssStyle?.position == "absolute") {
          const a = t.props?.anchorPosition, n = a?.vertical?.relative, c = a?.horizontal?.relative;
          if (n == "paragraph" || n == "line" || n == "character" || c == "character") return !0;
        }
        if (this.hasParagraphRelativeAnchor(t)) return !0;
      }
      return !1;
    }
    renderHyperlink(e) {
      const t = this.renderElements(e.children), a = this.toH(e, S.ns.html, "a", this.wrapTabLeaderChildren(t));
      if (a.href = "", e.id) {
        const n = this.currentPart ?? this.document.documentPart, c = n?.rels?.find((l) => l.id == e.id && l.targetMode === "External");
        a.href = c?.target ?? a.href;
      }
      return !a.href && e.anchor && (a.href += `#${e.anchor}`), this.h(a);
    }
    wrapTabLeaderChildren(e, t = !1) {
      if (!e?.length || e.some((f) => this.hasCssClass(f, `${this.className}-tab-leader-title`))) return e;
      let a = -1;
      for (let f = e.length - 1; f >= 0; f--) if (this.isTabLeaderNode(e[f])) {
        a = f;
        break;
      }
      if (a < 0) return this.wrapLiteralLeaderChildren(e, t) ?? e;
      const n = e.slice(0, a), c = e[a], l = e.slice(a + 1);
      this.addCssClass(c, `${this.className}-tab-leader-fill`);
      const m = [this.h({ tagName: "span", className: `${this.className}-tab-leader-title`, children: n }), c, this.h({ tagName: "span", className: `${this.className}-tab-leader-page`, children: l })];
      return t ? [this.h({ tagName: "span", className: `${this.className}-tab-leader-line`, children: m })] : m;
    }
    wrapLiteralLeaderChildren(e, t = !1) {
      const a = this.findLastTextualNodeIndex(e);
      if (a < 0) return null;
      const n = e[a], c = this.nodeTextContent(n), l = /^(.*?)([.\u2026\u00b7\u2022\u2027\u2219\u22c5]{6,})(\s*[0-9０-９IVXLCDMivxlcdm]+)\s*$/.exec(c);
      if (!l) return null;
      const [, m, f, i] = l, r = e.slice(0, a), o = e.slice(a + 1), u = [...r];
      m && u.push(this.cloneTextNodeWithText(n, m));
      const y = this.h({ tagName: "span", className: `${this.tabStopClass()} ${this.className}-tab-leader-fill`, children: [" "], style: this.nodeStyleObject(n) });
      y.dataset.docxTab = "true", y.dataset.docxTabLeader = this.literalLeaderKind(f), y.dataset.docxLiteralLeader = "true";
      const p = [this.h({ tagName: "span", className: `${this.className}-tab-leader-title`, children: u }), y, this.h({ tagName: "span", className: `${this.className}-tab-leader-page`, children: [this.cloneTextNodeWithText(n, i.trim()), ...o] })];
      return t ? [this.h({ tagName: "span", className: `${this.className}-tab-leader-line ${this.className}-literal-leader-line`, children: p })] : p;
    }
    findLastTextualNodeIndex(e) {
      for (let t = e.length - 1; t >= 0; t--) if (this.nodeTextContent(e[t]).trim()) return t;
      return -1;
    }
    literalLeaderKind(e) {
      return /^[.\u2026]+$/.test(e) ? "dot" : "middleDot";
    }
    cloneTextNodeWithText(e, t) {
      return this.nodeElementName(e) ? this.h({ tagName: this.nodeElementName(e), className: this.nodeClassName(e), style: this.nodeStyleObject(e), children: [t] }) : this.h({ tagName: "span", children: [t] });
    }
    nodeElementName(e) {
      const t = e, a = t?.tagName ?? t?.nodeName;
      return a && !String(a).startsWith("#") ? String(a).toLowerCase() : "";
    }
    nodeStyleObject(e) {
      const t = e?.style, a = {};
      if (!t) return a;
      if (typeof t.length == "number" && typeof t.getPropertyValue == "function") for (let n = 0; n < t.length; n++) {
        const c = t.item(n), l = t.getPropertyValue(c);
        l && (a[c] = l);
      }
      else for (const [n, c] of Object.entries(t)) c != null && c !== "" && (a[n] = String(c));
      return a;
    }
    nodeTextContent(e) {
      const t = e;
      return t ? typeof t.textContent == "string" ? t.textContent : typeof t.text == "string" ? t.text : Array.from(t.children ?? t.childNodes ?? []).map((a) => this.nodeTextContent(a)).join("") : "";
    }
    isTabLeaderNode(e) {
      const t = this.nodeDatasetValue(e, "docxTabLeader");
      return this.hasCssClass(e, this.tabStopClass()) && !!t && t != "none";
    }
    nodeDatasetValue(e, t) {
      const a = e, n = a?.dataset?.[t];
      if (n != null) return String(n);
      const c = "data-" + t.replace(/[A-Z]/g, (l) => "-" + l.toLowerCase());
      return typeof a?.getAttribute == "function" ? a.getAttribute(c) : a?.attributes?.[c];
    }
    hasCssClass(e, t) {
      const a = e;
      return !(!a || !t) && (typeof a.classList?.contains == "function" ? a.classList.contains(t) : this.nodeClassName(a).split(/\s+/).includes(t));
    }
    addCssClass(e, t) {
      const a = e;
      if (!a || !t || this.hasCssClass(e, t)) return;
      if (typeof a.classList?.add == "function") return void a.classList.add(t);
      const n = (0, S.cx)(this.nodeClassName(a), t);
      typeof a.setAttribute == "function" ? a.setAttribute("class", n) : (a.attributes ?? (a.attributes = {}), a.attributes.class = n);
    }
    nodeClassName(e) {
      return typeof e?.className == "string" ? e.className : typeof e?.className?.baseVal == "string" ? e.className.baseVal : typeof e?.getAttribute == "function" ? e.getAttribute("class") ?? "" : e?.attributes?.class ?? "";
    }
    renderSmartTag(e) {
      return this.renderContainer(e, "span");
    }
    renderCommentRangeStart(e) {
      if (!this.options.renderComments) return null;
      const t = new Range();
      this.commentHighlight?.add(t);
      const a = this.h({ tagName: "#comment", children: [`start of comment #${e.id}`] });
      return this.later(() => t.setStart(a, 0)), this.commentMap[e.id] = t, a;
    }
    renderCommentRangeEnd(e) {
      if (!this.options.renderComments) return null;
      const t = this.commentMap[e.id], a = this.h({ tagName: "#comment", children: [`end of comment #${e.id}`] });
      return this.later(() => t?.setEnd(a, 0)), a;
    }
    renderCommentReference(e) {
      if (!this.options.renderComments) return null;
      var t = this.document.commentsPart?.commentMap[e.id];
      if (!t) return null;
      const a = this.h({ tagName: "span", className: `${this.className}-comment-ref`, children: ["💬"] }), n = this.h({ tagName: "div", className: `${this.className}-comment-popover`, children: [this.h({ tagName: "div", className: `${this.className}-comment-author`, children: [t.author] }), this.h({ tagName: "div", className: `${this.className}-comment-date`, children: [new Date(t.date).toLocaleString()] }), ...this.renderElements(t.children)] });
      return this.h({ tagName: "#fragment", children: [this.h({ tagName: "#comment", children: [`comment #${t.id} by ${t.author} on ${t.date}`] }), a, n] });
    }
    renderAltChunk(e) {
      if (!this.options.renderAltChunks) return null;
      var t = this.h({ tagName: "iframe", sandbox: "", referrerPolicy: "no-referrer", loading: "lazy" });
      return this.tasks.push(this.document.loadAltChunk(e.id, this.currentPart).then((a) => {
        t.srcdoc = a;
      })), t;
    }
    renderDrawing(e) {
      e.cssStyle?.["shape-outside"] && (e.className = (0, S.cx)(e.className, `${this.className}-float-wrap`));
      var t = this.toHTML(e, S.ns.html, "div");
      (e.cssStyle?.float || e.cssStyle?.position == "absolute") && (t.dataset.docxFloat = "true");
      const a = e.props?.anchorPosition;
      return a?.vertical?.relative && (t.dataset.docxAnchorVertical = a.vertical.relative), a?.horizontal?.relative && (t.dataset.docxAnchorHorizontal = a.horizontal.relative), t.style.display || (t.style.display = "inline-block"), t.style.position || (t.style.position = "relative"), t.style.textIndent = "0px", t;
    }
    renderImage(e) {
      let t = this.toHTML(e, S.ns.html, "img", []), a = e.cssStyle?.transform;
      if (e.alt && (t.alt = e.alt), e.title && (t.title = e.title), e.srcRect && e.srcRect.some((f) => f != 0)) {
        var [n, c, l, m] = e.srcRect;
        a = `${a ?? ""} scale(${1 / (1 - n - l)}, ${1 / (1 - c - m)})`, t.style.clipPath = `inset(${(100 * c).toFixed(2)}% ${(100 * l).toFixed(2)}% ${(100 * m).toFixed(2)}% ${(100 * n).toFixed(2)}%)`, t.style.transformOrigin = "top left";
      }
      return e.rotation && (a = `rotate(${e.rotation}deg) ${a ?? ""}`), t.style.transform = a?.trim(), this.document && e.src && this.tasks.push(this.document.loadDocumentImage(e.src, this.currentPart).then((f) => {
        t.src = f, f && t.setAttribute("src", f);
      })), t;
    }
    renderShape(e) {
      if (e.props?.dmlSvg) return this.renderDmlSvgShape(e);
      const t = e.props?.dmlTextBox ? [this.renderDmlTextBox(e)] : null, a = this.toHTML(e, S.ns.html, "div", t);
      return a.style.display || (a.style.display = "inline-block"), e.title && (a.title = e.title), e.alt && (a.setAttribute("role", "img"), a.setAttribute("aria-label", e.alt)), a;
    }
    renderDmlTextBox(e) {
      return this.h({ tagName: "div", className: `${this.className}-shape-textbox`, style: { "box-sizing": "border-box", display: "flex", "flex-direction": "column", "justify-content": e.props?.textVerticalAlign ?? "flex-start", "align-items": "stretch", width: "100%", height: "100%", overflow: "hidden", ...e.props?.textInsets ?? {} }, children: this.renderElements(e.children) });
    }
    renderDmlSvgShape(e) {
      const t = this.createSvgElement("svg", { style: e.cssStyle }), a = e.props ?? {};
      t.setAttribute("viewBox", a.viewBox ?? "0 0 1 1"), t.setAttribute("preserveAspectRatio", "none"), t.setAttribute("focusable", "false"), e.title && t.appendChild(this.createSvgElement("title", null, [e.title])), e.alt && (t.setAttribute("role", "img"), t.setAttribute("aria-label", e.alt));
      const n = this.createSvgElement("path");
      return n.setAttribute("d", a.pathD ?? ""), n.setAttribute("fill", this.darkenColorAttr(a.fill ?? "none")), n.setAttribute("stroke", this.darkenColorAttr(a.stroke ?? "none")), n.setAttribute("stroke-width", a.strokeWidth ?? "0"), n.setAttribute("stroke-linejoin", "round"), n.setAttribute("stroke-linecap", "round"), a.strokeDasharray && n.setAttribute("stroke-dasharray", a.strokeDasharray), t.appendChild(n), t;
    }
    renderChart(e) {
      const t = this.toHTML(e, S.ns.html, "div", []);
      if (t.className = (0, S.cx)(t.className, `${this.className}-chart`), e.title && (t.title = e.title), e.alt && (t.setAttribute("role", "img"), t.setAttribute("aria-label", e.alt)), t.appendChild(this.renderGraphicLoading("Chart")), e.id) {
        const a = this.currentPart;
        this.tasks.push(this.document.loadRelationshipXml(e.id, a).then((n) => {
          t.textContent = "", t.appendChild(n ? this.renderChartSvg(n) : this.renderGraphicLoading("Chart"));
        }).catch(() => {
          t.textContent = "", t.appendChild(this.renderGraphicLoading("Chart"));
        }));
      }
      return t;
    }
    renderSmartArt(e) {
      const t = this.toHTML(e, S.ns.html, "div", []);
      if (t.className = (0, S.cx)(t.className, `${this.className}-smartart`), e.title && (t.title = e.title), e.alt && (t.setAttribute("role", "img"), t.setAttribute("aria-label", e.alt)), t.appendChild(this.renderGraphicLoading("SmartArt")), e.dataId) {
        const a = this.currentPart;
        this.tasks.push(this.document.loadRelationshipXml(e.dataId, a).then((n) => {
          t.textContent = "", t.appendChild(n ? this.renderSmartArtSvg(n) : this.renderGraphicLoading("SmartArt"));
        }).catch(() => {
          t.textContent = "", t.appendChild(this.renderGraphicLoading("SmartArt"));
        }));
      }
      return t;
    }
    renderInk(e) {
      const t = this.toHTML(e, S.ns.html, "div", []);
      if (t.className = (0, S.cx)(t.className, `${this.className}-ink`), e.title && (t.title = e.title), e.alt && (t.setAttribute("role", "img"), t.setAttribute("aria-label", e.alt)), t.appendChild(this.renderGraphicLoading("Ink")), e.id) {
        const a = this.currentPart;
        this.tasks.push(this.document.loadRelationshipText(e.id, a).then((n) => {
          if (t.textContent = "", n?.trim().startsWith("<")) try {
            return void t.appendChild(this.renderInkSvg((0, M.parseXmlString)(n, !0)));
          } catch {
          }
          return this.document.loadRelationshipBlobUrl(e.id, a).then((c) => {
            t.textContent = "", c ? t.appendChild(this.h({ tagName: "img", src: c, alt: e.alt ?? "Ink", style: { width: "100%", height: "100%", objectFit: "contain" } })) : t.appendChild(this.renderGraphicLoading("Ink"));
          });
        }).catch(() => {
          t.textContent = "", t.appendChild(this.renderGraphicLoading("Ink"));
        }));
      }
      return t;
    }
    renderGraphicLoading(e) {
      return this.h({ tagName: "span", style: { display: "inline-flex", "align-items": "center", "justify-content": "center", width: "100%", height: "100%", "min-width": "2in", "min-height": "1in", border: "1px solid currentColor" }, children: [`[${e}]`] });
    }
    renderChartSvg(e) {
      const t = e.documentElement, a = this.detectChartType(t), n = this.parseChartSeries(t, a), c = this.createSvgElement("svg", { style: { width: "100%", height: "100%", display: "block" } });
      c.setAttribute("viewBox", "0 0 640 360"), c.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const l = this.extractChartTitle(t);
      if (l && c.appendChild(this.svgText(l, 320, 24, "middle", "14px", "bold")), n.length == 0 || n.every((m) => m.values.length == 0)) return c.appendChild(this.svgText("Chart", 320, 180, "middle", "18px")), c;
      switch (a) {
        case "pieChart":
        case "doughnutChart":
          this.drawPieChart(c, n[0]);
          break;
        case "lineChart":
        case "scatterChart":
        case "areaChart":
          this.drawLineChart(c, n, a == "areaChart");
          break;
        default:
          this.drawBarChart(c, n);
      }
      return c;
    }
    detectChartType(e) {
      return ["barChart", "bar3DChart", "lineChart", "pieChart", "doughnutChart", "areaChart", "scatterChart", "ofPieChart", "radarChart"].find((t) => this.firstByLocal(e, t)) ?? "barChart";
    }
    parseChartSeries(e, t) {
      const a = this.firstByLocal(e, t) ?? e;
      return this.elementsByLocal(a, "ser").map((n, c) => {
        const l = this.firstByLocal(n, "tx"), m = this.firstByLocal(n, "cat") ?? this.firstByLocal(n, "xVal"), f = this.firstByLocal(n, "val") ?? this.firstByLocal(n, "yVal"), i = this.chartCacheValues(m), r = this.chartCacheValues(f).map((o) => parseFloat(o)).filter((o) => !Number.isNaN(o));
        return { name: this.chartText(l) || `Series ${c + 1}`, categories: i.length > 0 ? i : r.map((o, u) => `${u + 1}`), values: r };
      });
    }
    chartCacheValues(e) {
      return e ? this.elementsByLocal(e, "pt").map((t) => ({ index: parseInt(t.getAttribute("idx") ?? "0", 10), value: this.firstByLocal(t, "v")?.textContent ?? "" })).sort((t, a) => t.index - a.index).map((t) => t.value) : [];
    }
    chartText(e) {
      if (!e) return "";
      const t = this.chartCacheValues(e);
      return t.length > 0 ? t.join(" ") : this.elementsByLocal(e, "t").map((a) => a.textContent).filter(Boolean).join(" ").trim() || (this.firstByLocal(e, "v")?.textContent?.trim() ?? "");
    }
    extractChartTitle(e) {
      const t = this.firstByLocal(e, "title");
      return this.chartText(t);
    }
    drawBarChart(e, t) {
      const n = t[0]?.categories ?? [], c = Math.max(1, ...t.flatMap((f) => f.values)), l = 540 / Math.max(n.length, 1), m = l / Math.max(t.length + 1, 2);
      e.appendChild(this.svgLine(60, 300, 600, 300)), e.appendChild(this.svgLine(60, 300, 60, 70)), t.forEach((f, i) => {
        f.values.forEach((r, o) => {
          const u = Math.max(0, r / c * 230), y = this.createSvgElement("rect");
          y.setAttribute("x", "" + (60 + o * l + i * m + 0.2 * m)), y.setAttribute("y", "" + (300 - u)), y.setAttribute("width", "" + 0.8 * m), y.setAttribute("height", `${u}`), y.style.fill = this.chartColor(i), e.appendChild(y);
        });
      }), n.slice(0, 12).forEach((f, i) => {
        e.appendChild(this.svgText(f, 60 + i * l + l / 2, 318, "middle", "10px"));
      }), this.drawBottomLegend(e, t.map((f) => f.name), 335);
    }
    drawLineChart(e, t, a = !1) {
      const c = Math.max(1, ...t.flatMap((f) => f.values)), l = Math.max(...t.map((f) => f.values.length), 1), m = 540 / Math.max(l - 1, 1);
      e.appendChild(this.svgLine(60, 300, 600, 300)), e.appendChild(this.svgLine(60, 300, 60, 70)), t.forEach((f, i) => {
        const r = f.values.map((u, y) => [60 + y * m, 300 - u / c * 230]), o = this.createSvgElement("path");
        if (o.setAttribute("d", r.map((u, y) => `${y == 0 ? "M" : "L"}${u[0]},${u[1]}`).join(" ")), o.style.stroke = this.chartColor(i), o.style.strokeWidth = "2", o.style.fill = "none", e.appendChild(o), a && r.length > 1) {
          const u = this.createSvgElement("path");
          u.setAttribute("d", `${r.map((y, p) => `${p == 0 ? "M" : "L"}${y[0]},${y[1]}`).join(" ")} L${r[r.length - 1][0]},300 L${r[0][0]},300 Z`), u.style.fill = this.chartColor(i), u.style.opacity = "0.25", e.appendChild(u);
        }
        for (const [u, y] of r) {
          const p = this.createSvgElement("circle");
          p.setAttribute("cx", `${u}`), p.setAttribute("cy", `${y}`), p.setAttribute("r", "3"), p.style.fill = this.chartColor(i), e.appendChild(p);
        }
      }), (t[0]?.categories ?? []).slice(0, 12).forEach((f, i) => {
        e.appendChild(this.svgText(f, 60 + i * m, 318, "middle", "10px"));
      }), this.drawBottomLegend(e, t.map((f) => f.name), 335);
    }
    drawPieChart(e, t) {
      const a = t.values, n = t.categories, c = a.reduce((m, f) => m + Math.max(0, f), 0) || 1;
      let l = -90;
      a.forEach((m, f) => {
        const i = Math.max(0, m) / c * 360, r = this.createSvgElement("path");
        r.setAttribute("d", this.pieSlicePath(300, 180, 110, l, l + i)), r.style.fill = this.chartColor(f), e.appendChild(r), this.drawLegend(e, n[f] ?? `${f + 1}`, f, 450, 90 + 22 * f), l += i;
      });
    }
    pieSlicePath(e, t, a, n, c) {
      const l = this.polar(e, t, a, c), m = this.polar(e, t, a, n), f = c - n <= 180 ? "0" : "1";
      return `M${e},${t} L${l.x},${l.y} A${a},${a} 0 ${f},0 ${m.x},${m.y} Z`;
    }
    polar(e, t, a, n) {
      const c = (n - 90) * Math.PI / 180;
      return { x: e + a * Math.cos(c), y: t + a * Math.sin(c) };
    }
    drawLegend(e, t, a, n, c) {
      const l = this.createSvgElement("rect");
      l.setAttribute("x", `${n}`), l.setAttribute("y", "" + (c - 10)), l.setAttribute("width", "10"), l.setAttribute("height", "10"), l.style.fill = this.chartColor(a), e.appendChild(l), e.appendChild(this.svgText(t, n + 14, c, "start", "10px"));
    }
    drawBottomLegend(e, t, a) {
      if (t.length == 0) return;
      const n = t.map((f) => 14 + this.chartLegendTextWidth(f)), c = n.reduce((f, i) => f + i, 0) + 18 * Math.max(0, t.length - 1), l = this.createSvgElement("g");
      l.setAttribute("data-docx-chart-legend", "bottom"), l.setAttribute("transform", `translate(${Math.max(0, (640 - c) / 2)}, 0)`);
      let m = 0;
      t.forEach((f, i) => {
        this.drawLegend(l, f, i, m, a), m += n[i] + 18;
      }), e.appendChild(l);
    }
    chartLegendTextWidth(e) {
      return Array.from(e).reduce((t, a) => /\s/.test(a) ? t + 3 : t + ((a.codePointAt(0) ?? 0) > 255 ? 10 : 6), 0);
    }
    chartColor(e) {
      return `hsl(${47 * e % 360}, 65%, 48%)`;
    }
    renderSmartArtSvg(e) {
      const t = e.documentElement, a = this.elementsByLocal(t, "pt").map((i) => ({ id: i.getAttribute("modelId"), type: i.getAttribute("type"), text: this.elementsByLocal(i, "t").map((r) => r.textContent).filter(Boolean).join(" ").trim() })).filter((i) => i.id && i.text && i.type != "doc"), n = this.elementsByLocal(t, "cxn").map((i) => ({ src: i.getAttribute("srcId"), dst: i.getAttribute("destId") })).filter((i) => i.src && i.dst && a.some((r) => r.id == i.src) && a.some((r) => r.id == i.dst)), c = this.createSvgElement("svg", { style: { width: "100%", height: "100%", display: "block" } });
      if (c.setAttribute("viewBox", "0 0 640 360"), c.setAttribute("preserveAspectRatio", "xMidYMid meet"), a.length == 0) return c.appendChild(this.svgText("SmartArt", 320, 180, "middle", "18px")), c;
      const l = this.layoutDiagramNodes(a, n), m = {}, f = Math.min(90, 260 / Math.max(l.length, 1));
      l.forEach((i, r) => {
        const o = 55 + r * f, u = 560 / Math.max(i.length, 1);
        i.forEach((y, p) => {
          m[y.id] = { x: 40 + u * p + Math.max(0, u - 140) / 2, y: o };
        });
      });
      for (const i of n) {
        const r = m[i.src], o = m[i.dst];
        r && o && c.appendChild(this.svgLine(r.x + 70, r.y + 44, o.x + 70, o.y));
      }
      return a.forEach((i, r) => {
        const o = m[i.id];
        if (!o) return;
        const u = this.createSvgElement("rect");
        u.setAttribute("x", `${o.x}`), u.setAttribute("y", `${o.y}`), u.setAttribute("width", "140"), u.setAttribute("height", "44"), u.setAttribute("rx", "8"), u.style.fill = this.chartColor(r), u.style.opacity = "0.18", u.style.stroke = this.chartColor(r), c.appendChild(u), c.appendChild(this.svgText(i.text, o.x + 70, o.y + 27, "middle", "11px"));
      }), c;
    }
    layoutDiagramNodes(e, t) {
      const a = new Map(e.map((f) => [f.id, 0]));
      t.forEach((f) => a.set(f.dst, (a.get(f.dst) ?? 0) + 1));
      let n = e.filter((f) => (a.get(f.id) ?? 0) == 0);
      const c = /* @__PURE__ */ new Set(), l = [];
      for (n.length == 0 && (n = e.slice(0, 1)); n.length > 0; ) {
        l.push(n), n.forEach((i) => c.add(i.id));
        const f = t.filter((i) => n.some((r) => r.id == i.src)).map((i) => i.dst).filter((i) => !c.has(i));
        n = [...new Set(f)].map((i) => e.find((r) => r.id == i)).filter(Boolean);
      }
      const m = e.filter((f) => !c.has(f.id));
      return m.length > 0 && l.push(m), l;
    }
    renderInkSvg(e) {
      const t = this.createSvgElement("svg", { style: { width: "100%", height: "100%", display: "block" } });
      t.setAttribute("viewBox", "0 0 640 360"), t.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const a = this.elementsByLocal(e.documentElement, "trace").map((y) => this.inkTraceToPoints(y.textContent)), n = this.elementsByLocal(e.documentElement, "path").map((y) => y.getAttribute("d")).filter(Boolean);
      if (a.length == 0 && n.length == 0) return t.appendChild(this.svgText("Ink", 320, 180, "middle", "18px")), t;
      const c = a.flat(), l = Math.min(...c.map((y) => y[0]), 0), m = Math.min(...c.map((y) => y[1]), 0), f = Math.max(...c.map((y) => y[0]), 640), i = Math.max(...c.map((y) => y[1]), 360), r = Math.min(600 / Math.max(f - l, 1), 320 / Math.max(i - m, 1)), o = 20 - l * r, u = 20 - m * r;
      for (const y of a) {
        if (y.length < 2) continue;
        const p = this.createSvgElement("path");
        p.setAttribute("d", y.map((g, T) => `${T == 0 ? "M" : "L"}${g[0] * r + o},${g[1] * r + u}`).join(" ")), p.style.fill = "none", p.style.stroke = "currentColor", p.style.strokeWidth = "2", p.style.strokeLinecap = "round", p.style.strokeLinejoin = "round", t.appendChild(p);
      }
      for (const y of n) {
        const p = this.createSvgElement("path");
        p.setAttribute("d", y), p.style.fill = "none", p.style.stroke = "currentColor", p.style.strokeWidth = "2", t.appendChild(p);
      }
      return t;
    }
    inkTraceToPoints(e) {
      const t = (e ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [], a = [];
      for (let n = 0; n + 1 < t.length; n += 2) a.push([t[n], t[n + 1]]);
      return a;
    }
    svgLine(e, t, a, n) {
      const c = this.createSvgElement("line");
      return c.setAttribute("x1", `${e}`), c.setAttribute("y1", `${t}`), c.setAttribute("x2", `${a}`), c.setAttribute("y2", `${n}`), c.style.stroke = "currentColor", c.style.strokeWidth = "1", c;
    }
    svgText(e, t, a, n = "start", c = "12px", l = null) {
      const m = this.createSvgElement("text");
      return m.setAttribute("x", `${t}`), m.setAttribute("y", `${a}`), m.setAttribute("text-anchor", n), m.style.fill = "currentColor", m.style.fontSize = c, l && (m.style.fontWeight = l), m.appendChild(document.createTextNode(e)), m;
    }
    elementsByLocal(e, t) {
      const a = e.documentElement ?? e;
      return Array.from(a.getElementsByTagName("*")).filter((n) => n.localName == t);
    }
    firstByLocal(e, t) {
      return this.elementsByLocal(e, t)[0] ?? null;
    }
    renderSimpleField(e) {
      const t = this.evaluateFieldNode(e);
      return t === void 0 ? this.renderElements(e.children ?? []) : t == null ? null : (0, h.isString)(t) ? this.renderFieldText(t, e.instruction) : t;
    }
    renderFieldText(e, t) {
      const a = this.h({ tagName: "span", className: `${this.className}-field`, children: [e] });
      return t && (a.dataset.docxFieldInstr = t), a;
    }
    evaluateFieldNode(e) {
      const t = (e.instruction ?? "").replace(/\s+/g, " ").trim();
      if (!t) return;
      if (t.startsWith("=")) {
        const c = this.evaluateFormula(t.substring(1));
        return c == null ? void 0 : this.applyFieldFormatting(`${c}`, t);
      }
      const a = this.tokenizeFieldInstruction(t), n = a[0]?.replace(/^=/, "").toUpperCase();
      if (!this.shouldPreserveStoredFieldResult(n, e)) switch (n) {
        case "PAGE":
          return this.applyFieldFormatting(this.formatFieldNumber(this.currentPageNumber, this.currentSectionProps?.pageNumber?.format), t);
        case "NUMPAGES":
          return this.applyFieldFormatting(this.formatFieldNumber(this.totalPages, this.currentSectionProps?.pageNumber?.format), t);
        case "SECTIONPAGES":
          return this.applyFieldFormatting(this.formatFieldNumber(this.sectionPageCount, this.currentSectionProps?.pageNumber?.format), t);
        case "SECTION":
          return this.applyFieldFormatting(this.formatFieldNumber(this.currentSectionNumber, "decimal"), t);
        case "DATE":
        case "TIME":
        case "CREATEDATE":
        case "SAVEDATE":
        case "PRINTDATE":
          return this.applyFieldFormatting(this.evaluateDateField(a, n), t);
        case "AUTHOR":
          return this.applyFieldFormatting(this.document.corePropsPart?.props?.creator ?? "", t);
        case "TITLE":
          return this.applyFieldFormatting(this.document.corePropsPart?.props?.title ?? "", t);
        case "SUBJECT":
          return this.applyFieldFormatting(this.document.corePropsPart?.props?.subject ?? "", t);
        case "KEYWORDS":
          return this.applyFieldFormatting(this.document.corePropsPart?.props?.keywords ?? "", t);
        case "NUMWORDS":
          return this.applyFieldFormatting(`${this.document.extendedPropsPart?.props?.words ?? ""}`, t);
        case "NUMCHARS":
          return this.applyFieldFormatting(`${this.document.extendedPropsPart?.props?.characters ?? ""}`, t);
        case "FILENAME":
          return this.applyFieldFormatting(this.document.documentPart?.path?.split("/").pop() ?? "", t);
        case "DOCPROPERTY":
          return this.applyFieldFormatting(this.evaluateDocPropertyField(a), t);
        case "DOCVARIABLE":
          return this.applyFieldFormatting(this.evaluateDocVariableField(a), t);
        case "MERGEFIELD":
          return;
        case "SET":
          return this.evaluateSetField(a), null;
        case "QUOTE":
          return this.applyFieldFormatting(a.slice(1).map((c) => this.resolveFieldValue(c)).join(""), t);
        case "HYPERLINK":
          return this.renderHyperlinkField(a, e);
        case "IF":
          return this.applyFieldFormatting(this.evaluateIfField(a), t);
        case "REF":
        case "STYLEREF":
        case "NOTEREF":
          return this.applyFieldFormatting(this.evaluateRefField(a), t);
        case "PAGEREF":
          return this.applyFieldFormatting(this.evaluatePageRefField(a), t);
        case "SEQ":
          return this.applyFieldFormatting(this.evaluateSeqField(a), t);
        case "LISTNUM":
          return this.applyFieldFormatting(this.evaluateListNumField(a), t);
        case "TC":
        case "XE":
          return null;
        case "TOC":
          return this.renderTocField(a);
        case "SYMBOL":
          return this.evaluateSymbolField(a);
      }
    }
    shouldPreserveStoredFieldResult(e, t) {
      if (!this.options.preserveComplexFieldResults || !t.children?.length) return !1;
      switch (e) {
        case "PAGE":
        case "NUMPAGES":
        case "SECTIONPAGES":
        case "SECTION":
          return !1;
        case "PAGEREF":
          return !this.options.updatePageReferences;
        case "TOC":
        case "REF":
        case "STYLEREF":
        case "NOTEREF":
        case "SEQ":
        case "LISTNUM":
        case "IF":
        case "DOCVARIABLE":
        case "MERGEFIELD":
          return !0;
      }
      return !1;
    }
    tokenizeFieldInstruction(e) {
      const t = [];
      let a = "", n = null, c = !1;
      for (const l of e) c ? (a += l, c = !1) : l != "\\" ? l != '"' && l != "'" ? !/\s/.test(l) || n ? a += l : a && (t.push(a), a = "") : n == l ? (n = null, t.push(a), a = "") : n ? a += l : (a.trim() && t.push(a.trim()), a = "", n = l) : n ? c = !0 : (a && (t.push(a), a = ""), a = "\\");
      return a && t.push(a), t;
    }
    fieldSwitch(e, t) {
      const a = t.toLowerCase(), n = e.findIndex((c) => c.toLowerCase() == a);
      return n >= 0 ? e[n + 1] : null;
    }
    hasFieldSwitch(e, t) {
      const a = t.toLowerCase();
      return e.some((n) => n.toLowerCase() == a);
    }
    firstFieldArgument(e, t = 1) {
      for (let a = t; a < e.length; a++) {
        if (!e[a]?.startsWith("\\")) return e[a];
        a++;
      }
      return null;
    }
    evaluateDateField(e, t) {
      const a = this.fieldSwitch(e, "\\@"), n = /* @__PURE__ */ new Date();
      return a ? this.formatFieldDate(n, a) : t == "TIME" ? n.toLocaleTimeString() : n.toLocaleDateString();
    }
    formatFieldDate(e, t) {
      const a = (r, o = 2) => `${r}`.padStart(o, "0"), n = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], c = n.map((r) => r.substring(0, 3)), l = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], m = l.map((r) => r.substring(0, 3)), f = [[/yyyy/g, `${e.getFullYear()}`], [/yy/g, a(e.getFullYear() % 100)], [/MMMM/g, n[e.getMonth()]], [/MMM/g, c[e.getMonth()]], [/MM/g, a(e.getMonth() + 1)], [/M/g, `${e.getMonth() + 1}`], [/dddd/g, l[e.getDay()]], [/ddd/g, m[e.getDay()]], [/dd/g, a(e.getDate())], [/d/g, `${e.getDate()}`], [/HH/g, a(e.getHours())], [/H/g, `${e.getHours()}`], [/hh/g, a((e.getHours() + 11) % 12 + 1)], [/h/g, "" + ((e.getHours() + 11) % 12 + 1)], [/mm/g, a(e.getMinutes())], [/m/g, `${e.getMinutes()}`], [/ss/g, a(e.getSeconds())], [/s/g, `${e.getSeconds()}`], [/AM\/PM/g, e.getHours() < 12 ? "AM" : "PM"], [/am\/pm/g, e.getHours() < 12 ? "am" : "pm"]];
      let i = t;
      for (const [r, o] of f) i = i.replace(r, o);
      return i;
    }
    evaluateDocPropertyField(e) {
      const t = this.firstFieldArgument(e)?.toLowerCase();
      if (!t) return "";
      const a = { ...this.document.corePropsPart?.props ?? {}, ...this.document.extendedPropsPart?.props ?? {} };
      for (const [n, c] of Object.entries(a)) if (n.toLowerCase() == t) return c == null ? "" : `${c}`;
      return "";
    }
    evaluateSetField(e) {
      const t = this.firstFieldArgument(e);
      if (!t) return;
      const a = e.slice(e.indexOf(t) + 1).filter((n) => !n.startsWith("\\")).map((n) => this.resolveFieldValue(n)).join(" ");
      this.fieldSetValues[t] = a;
    }
    evaluateDocVariableField(e) {
      const t = this.firstFieldArgument(e);
      return t ? this.fieldSetValues[t] ?? "" : "";
    }
    renderHyperlinkField(e, t) {
      const a = this.fieldSwitch(e, "\\l"), n = this.firstFieldArgument(e) ?? "", c = a ? `${n}#${a}` : n, l = this.h({ tagName: "a", href: c, children: this.renderElements(t.children ?? []) });
      return l.textContent || (l.textContent = c || a), l;
    }
    evaluateIfField(e) {
      const t = ["<>", ">=", "<=", "=", ">", "<"], a = e.findIndex((g, T) => T > 0 && t.includes(g));
      if (a < 0) return "";
      const n = this.resolveFieldValue(e.slice(1, a).join(" ")), c = e[a], l = this.resolveFieldValue(e[a + 1] ?? ""), m = e[a + 2] ?? "", f = e[a + 3] ?? "", i = parseFloat(n), r = parseFloat(l), o = !Number.isNaN(i) && !Number.isNaN(r), u = o ? i : n, y = o ? r : l;
      let p = !1;
      switch (c) {
        case "=":
          p = u == y;
          break;
        case "<>":
          p = u != y;
          break;
        case ">":
          p = u > y;
          break;
        case "<":
          p = u < y;
          break;
        case ">=":
          p = u >= y;
          break;
        case "<=":
          p = u <= y;
      }
      return this.resolveFieldValue(p ? m : f);
    }
    resolveFieldValue(e) {
      const t = (e ?? "").trim();
      if (/^[-+]?\d+(?:\.\d+)?$/.test(t)) return t;
      if (this.bookmarkTextMap.hasOwnProperty(t)) return this.bookmarkTextMap[t];
      if (this.fieldSetValues.hasOwnProperty(t)) return this.fieldSetValues[t];
      if (t.startsWith("=")) {
        const n = this.evaluateFormula(t.substring(1));
        return n == null ? "" : `${n}`;
      }
      const a = this.tokenizeFieldInstruction(t)[0]?.toUpperCase();
      if (["PAGE", "NUMPAGES", "SECTIONPAGES", "SECTION", "DATE", "TIME", "AUTHOR", "TITLE", "SUBJECT", "KEYWORDS", "REF", "PAGEREF", "SEQ", "DOCPROPERTY"].includes(a)) {
        const n = this.evaluateFieldNode({ type: d.DomType.SimpleField, instruction: t, lock: !1, dirty: !1, children: [] });
        if ((0, h.isString)(n)) return n;
      }
      return t;
    }
    evaluateRefField(e) {
      const t = this.firstFieldArgument(e);
      return t ? this.bookmarkTextMap[t] ?? this.fieldSetValues[t] ?? "" : "";
    }
    evaluatePageRefField(e) {
      const t = this.firstFieldArgument(e);
      return t ? `${this.bookmarkTextMap[t] != null ? Math.max(this.currentPageNumber, 1) : 1}` : "";
    }
    evaluateSeqField(e) {
      const t = this.firstFieldArgument(e);
      if (!t || this.hasFieldSwitch(e, "\\h")) return "";
      const a = this.fieldSwitch(e, "\\r"), n = this.hasFieldSwitch(e, "\\c");
      a != null ? this.fieldSeqCounters[t] = parseInt(a, 10) || 0 : n || (this.fieldSeqCounters[t] = (this.fieldSeqCounters[t] ?? 0) + 1);
      const c = this.fieldSwitch(e, "\\*") ?? "decimal";
      return this.formatFieldNumber(this.fieldSeqCounters[t] ?? 0, this.fieldFormatSwitchToNumFormat(c));
    }
    evaluateListNumField(e) {
      const t = this.firstFieldArgument(e) ?? "LISTNUM";
      this.fieldSeqCounters[t] = (this.fieldSeqCounters[t] ?? 0) + 1;
      const a = this.fieldSwitch(e, "*") ?? "decimal";
      return this.formatFieldNumber(this.fieldSeqCounters[t], this.fieldFormatSwitchToNumFormat(a));
    }
    renderTocField(e) {
      let t = 1, a = 9;
      const n = this.fieldSwitch(e, "\\o");
      if (n) {
        const l = /(\d+)\s*-\s*(\d+)/.exec(n);
        l && (t = parseInt(l[1], 10), a = parseInt(l[2], 10));
      }
      const c = this.tocEntries.filter((l) => l.level >= t && l.level <= a).map((l) => {
        const m = this.h({ tagName: "span", className: `${this.className}-toc-page`, children: ["1"] });
        return m.dataset.docxPageRef = l.id, this.h({ tagName: "div", className: `${this.className}-toc-entry ${this.className}-toc-level-${l.level}`, children: [this.h({ tagName: "a", className: `${this.className}-toc-title`, href: `#${l.id}`, children: [l.text] }), m] });
      });
      return this.h({ tagName: "div", className: `${this.className}-toc`, children: c });
    }
    evaluateSymbolField(e) {
      const t = parseInt(e[1], 10);
      return Number.isFinite(t) ? String.fromCharCode(t) : "";
    }
    evaluateFormula(e) {
      const t = e.replace(/,/g, "").trim();
      if (!/^[0-9+\-*/().\s]+$/.test(t)) return null;
      try {
        const a = Function(`"use strict"; return (${t});`)();
        return Number.isFinite(a) ? a : null;
      } catch {
        return null;
      }
    }
    applyFieldFormatting(e, t) {
      const a = this.tokenizeFieldInstruction(t);
      let n = e ?? "";
      const c = this.fieldSwitch(a, "\\*"), l = c?.toUpperCase(), m = this.fieldSwitch(a, "\\#");
      if (m) {
        const f = parseFloat(n);
        Number.isNaN(f) || (n = this.formatNumberPicture(f, m));
      }
      switch (l) {
        case "UPPER":
          n = n.toUpperCase();
          break;
        case "LOWER":
          n = n.toLowerCase();
          break;
        case "FIRSTCAP":
          n = n.substring(0, 1).toUpperCase() + n.substring(1).toLowerCase();
          break;
        case "CAPS":
          n = n.replace(/\b\w/g, (f) => f.toUpperCase());
          break;
        case "ROMAN": {
          const f = parseInt(n, 10);
          Number.isNaN(f) || (n = c == "roman" ? this.toRoman(f).toLowerCase() : this.toRoman(f).toUpperCase());
          break;
        }
        case "ALPHABETIC": {
          const f = parseInt(n, 10);
          Number.isNaN(f) || (n = c == "alphabetic" ? this.toLetters(f).toLowerCase() : this.toLetters(f).toUpperCase());
          break;
        }
      }
      return n;
    }
    formatNumberPicture(e, t) {
      const a = t.indexOf("."), n = a >= 0 ? t.length - a - 1 : 0;
      let c = e.toFixed(n);
      if (t.includes(",")) {
        const [l, m] = c.split(".");
        c = l.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (m != null ? `.${m}` : "");
      }
      return c;
    }
    fieldFormatSwitchToNumFormat(e) {
      if (e == "roman") return "lowerRoman";
      if (e == "alphabetic") return "lowerLetter";
      switch (e?.toUpperCase()) {
        case "ROMAN":
          return "upperRoman";
        case "ALPHABETIC":
          return "upperLetter";
        default:
          return "decimal";
      }
    }
    formatFieldNumber(e, t) {
      switch (t) {
        case "upperRoman":
          return this.toRoman(e).toUpperCase();
        case "lowerRoman":
          return this.toRoman(e).toLowerCase();
        case "upperLetter":
          return this.toLetters(e).toUpperCase();
        case "lowerLetter":
          return this.toLetters(e).toLowerCase();
        case "decimalZero":
          return e < 10 ? `0${e}` : `${e}`;
        default:
          return `${e}`;
      }
    }
    toRoman(e) {
      const t = [[1e3, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
      let a = Math.max(Math.floor(e), 0), n = "";
      for (const [c, l] of t) for (; a >= c; ) n += l, a -= c;
      return n || `${e}`;
    }
    toLetters(e) {
      let t = Math.max(Math.floor(e), 1), a = "";
      for (; t > 0; ) t--, a = String.fromCharCode(65 + t % 26) + a, t = Math.floor(t / 26);
      return a;
    }
    renderRuby(e) {
      const t = e.children?.find((l) => l.type == d.DomType.RubyBase), a = e.children?.find((l) => l.type == d.DomType.RubyText), n = [...t ? this.renderElements(t.children) : [], ...a ? (0, h.asArray)(this.renderElement(a)).filter((l) => l != null) : []], c = this.h({ tagName: "ruby", children: n });
      return e.align && (c.style.rubyAlign = e.align), c;
    }
    hasRenderedContent(e) {
      for (const t of e ?? []) {
        if (!t) continue;
        const a = t, n = a.nodeType, c = String(a.localName ?? a.tagName ?? a.nodeName ?? "").toLowerCase();
        if (n == 3 || c == "#text") {
          if ((a.textContent ?? a.text ?? a.data ?? "").length) return !0;
          continue;
        }
        if (["br", "img", "svg", "math", "table"].includes(c) || (a.textContent ?? "").length) return !0;
        const l = Array.from(a.childNodes ?? a.children ?? []);
        if (l.length && this.hasRenderedContent(l)) return !0;
      }
      return !1;
    }
    renderText(e) {
      return this.h(this.applyCjkLineBreakGuards(e.text));
    }
    applyCjkLineBreakGuards(e) {
      if (!e || !this.document.settingsPart?.settings?.kinsoku) return e;
      const t = this.document.settingsPart.settings.noLineBreaksBefore ?? `!),.:;?]}¢°·'"†‡›℃∶、。々〉》」』】〕〗〙〛〜゠ァィゥェォッャュョヮ・ー－？！％，．：；゛゜ヽヾゝゞー`, a = this.document.settingsPart.settings.noLineBreaksAfter ?? `([{$£¥'"“‘〈《「『【〔〖〘〚`;
      let n = "";
      for (const c of e) t.includes(c) && (n += "⁠"), n += c, a.includes(c) && (n += "⁠");
      return n;
    }
    renderDeletedText(e) {
      return this.options.renderChanges ? this.renderText(e) : null;
    }
    renderBreak(e) {
      switch (e.break) {
        case "textWrapping":
        case "line":
          return this.h({ tagName: "br" });
        case "column":
          return this.h({ tagName: "span", style: { breakAfter: "column" } });
        case "page":
          return this.options.breakPages ? null : this.h({ tagName: "span", style: { breakAfter: "page" } });
        case "lastRenderedPageBreak":
          return this.options.breakPages || this.options.ignoreLastRenderedPageBreak ? null : this.h({ tagName: "span", style: { breakAfter: "page" } });
      }
      return null;
    }
    renderInserted(e) {
      return this.options.renderChanges ? this.renderContainer(e, "ins") : this.renderElements(e.children);
    }
    renderDeleted(e) {
      return this.options.renderChanges ? this.renderContainer(e, "del") : null;
    }
    renderSymbol(e) {
      return this.h({ tagName: "span", children: [String.fromCharCode(e.char)], style: { fontFamily: e.font } });
    }
    renderFootnoteReference(e) {
      return this.currentFootnoteIds.push(e.id), this.h({ tagName: "sup", children: [`${this.currentFootnoteIds.length}`] });
    }
    renderEndnoteReference(e) {
      return this.currentEndnoteIds.push(e.id), this.h({ tagName: "sup", children: [`${this.currentEndnoteIds.length}`] });
    }
    renderTab(e) {
      const t = this.currentParagraph ?? (function(f, i) {
        for (var r = f.parent; r != null && r.type != i; ) r = r.parent;
        return r;
      })(e, d.DomType.Paragraph), a = t?.tabs ?? [], n = a.filter((f) => f?.style != "clear"), c = this.currentParagraphTabIndex++, l = this.resolveRenderedTabStop(n, c, this.currentParagraphTabCount);
      var m = this.h({ tagName: "span", className: this.tabStopClass(), children: [" "] });
      return m.dataset.docxTab = "true", l && (m.dataset.docxTabAlign = l.style ?? "left", m.dataset.docxTabLeader = l.leader ?? "none", l.position && (m.dataset.docxTabPos = l.position)), this.options.experimental && this.currentTabs.push({ stops: a, span: m }), m;
    }
    renderBookmarkStart(e) {
      const t = this.h({ tagName: "span" });
      return e.name && (t.id = e.name, t.setAttribute("id", e.name)), t;
    }
    renderRun(e) {
      const t = e.fieldRun ? e.children?.filter((m) => m.type != d.DomType.Instruction && m.type != d.DomType.ComplexField) : e.children;
      if (e.fieldRun && (!t || t.length == 0)) return null;
      let a = this.renderElements(t);
      if (e.verticalAlign && (a = [this.h({ tagName: e.verticalAlign, children: this.renderElements(t) })]), !e.verticalAlign && t?.length == 1 && (t[0].type == d.DomType.Tab || t[0].type == d.DomType.PositionalTab) && a?.length == 1) {
        const m = a[0];
        return e.cssStyle && Object.assign(m.style, e.cssStyle), e.className && m.classList.add(e.className), m;
      }
      const n = this.toHTML(e, S.ns.html, "span", a), c = this.findStyle(e.styleName), l = e.cssStyle?.["--docx-snap-to-grid"] ?? this.styleValue(c, "span", "--docx-snap-to-grid");
      if (/^(0|false|off)$/i.test(l ?? "")) n.style.letterSpacing = "normal";
      else if (/^(1|true|on)$/i.test(l ?? "")) {
        const m = this.currentSectionProps?.docGrid;
        m?.type != "linesAndChars" && m?.type != "snapToChars" || !m.charSpace || (n.style.letterSpacing = m.charSpace);
      }
      return e.id && (n.id = e.id), n;
    }
    renderTable(e) {
      e.columns?.length && !e.cssStyle?.["table-layout"] && (e.cssStyle ?? (e.cssStyle = {}), e.cssStyle["table-layout"] = "fixed"), this.tableCellPositions.push(this.currentCellPosition), this.tableVerticalMerges.push(this.currentVerticalMerge), this.currentVerticalMerge = {}, this.currentCellPosition = { col: 0, row: 0 };
      const t = [];
      return e.columns && t.push(this.renderTableColumns(e.columns)), t.push(...this.renderElements(e.children)), this.currentVerticalMerge = this.tableVerticalMerges.pop(), this.currentCellPosition = this.tableCellPositions.pop(), this.toHTML(e, S.ns.html, "table", t);
    }
    renderTableColumns(e) {
      const t = e.map((a) => this.h({ tagName: "col", style: { width: a.width } }));
      return this.h({ tagName: "colgroup", children: t });
    }
    renderTableRow(e) {
      this.currentCellPosition.col = 0;
      const t = [], a = this.currentTableRow;
      this.currentTableRow = e, e.gridBefore && t.push(this.renderTableCellPlaceholder(e.gridBefore)), t.push(...this.renderElements(e.children)), e.gridAfter && t.push(this.renderTableCellPlaceholder(e.gridAfter)), this.currentTableRow = a, this.currentCellPosition.row++;
      const n = this.toHTML(e, S.ns.html, "tr", t);
      return e.isHeader && (n.dataset.docxRepeatHeader = "true"), n;
    }
    renderTableCellPlaceholder(e) {
      return this.h({ tagName: "td", colSpan: e, style: { border: "none" } });
    }
    renderTableCell(e) {
      const t = this.currentTableRow?.isHeader ? "th" : "td";
      let a = this.toHTML(e, S.ns.html, t);
      const n = this.currentCellPosition.col;
      return e.verticalMerge ? e.verticalMerge == "restart" ? (this.currentVerticalMerge[n] = a, a.rowSpan = 1) : this.currentVerticalMerge[n] && (this.currentVerticalMerge[n].rowSpan += 1, a.style.display = "none") : this.currentVerticalMerge[n] = null, e.span && (a.colSpan = e.span), this.currentCellPosition.col += a.colSpan, a;
    }
    renderVmlPicture(e) {
      return this.renderContainer(e, "div");
    }
    vmlLengthInPoints(e) {
      if (e == null) return null;
      const t = String(e).trim(), a = parseFloat(t);
      return !Number.isFinite(a) || t.endsWith("%") ? null : /px$/i.test(t) ? 0.75 * a : /in$/i.test(t) ? 72 * a : /cm$/i.test(t) ? 72 * a / 2.54 : /mm$/i.test(t) ? 72 * a / 25.4 : /pc$/i.test(t) ? 12 * a : a;
    }
    vmlRenderContext(e) {
      const t = (0, h.parseCssRules)(e.cssStyleText), [a, n] = e.coordOrigin ?? [0, 0], [c, l] = e.coordSize ?? [0, 0], m = this.vmlLengthInPoints(t.width) ?? (Math.abs(c) || 1), f = this.vmlLengthInPoints(t.height) ?? (Math.abs(l) || 1);
      return { originX: a, originY: n, scaleX: m / (Math.abs(c) || m), scaleY: f / (Math.abs(l) || f), width: m, height: f };
    }
    vmlMappedValue(e, t, a, n) {
      if (e == null) return 0;
      const c = String(e).trim(), l = parseFloat(c);
      if (!Number.isFinite(l)) return 0;
      if (/[a-z%]/i.test(c)) return this.vmlLengthInPoints(c) ?? 0;
      const m = a == "x" ? t.scaleX : t.scaleY, f = a == "x" ? t.originX : t.originY;
      return n ? l * m : (l - f) * m;
    }
    vmlBounds(e, t, a) {
      if (a) return a;
      const n = (0, h.parseCssRules)(e.cssStyleText), c = n.width == null ? t.width : this.vmlMappedValue(n.width, t, "x", !0), l = n.height == null ? t.height : this.vmlMappedValue(n.height, t, "y", !0);
      return { x: n.left == null ? 0 : this.vmlMappedValue(n.left, t, "x", !1), y: n.top == null ? 0 : this.vmlMappedValue(n.top, t, "y", !1), width: c, height: l };
    }
    vmlCombinedLength(e, t) {
      if (!e) return t;
      if (!t) return e;
      const a = this.vmlLengthInPoints(e), n = this.vmlLengthInPoints(t);
      return a != null && n != null ? `${a + n}pt` : `calc(${e} + ${t})`;
    }
    vmlRootStyle(e) {
      const t = (0, h.parseCssRules)(e.cssStyleText), a = {}, n = ["position", "display", "left", "top", "right", "bottom", "margin-left", "margin-top", "width", "height", "z-index", "opacity", "visibility", "overflow"];
      for (const c of n) t[c] != null && (a[c] = t[c]);
      return t["mso-position-horizontal-relative"] == "page" && (a.left = this.vmlCombinedLength(a.left, a["margin-left"]), delete a["margin-left"]), t["mso-position-vertical-relative"] == "page" && (a.top = this.vmlCombinedLength(a.top, a["margin-top"]), delete a["margin-top"]), a.display ?? (a.display = "block"), a.overflow = "visible", a["pointer-events"] = "none", a;
    }
    applyVmlAttributes(e, t, a = /* @__PURE__ */ new Set()) {
      for (const [n, c] of Object.entries(t ?? {})) a.has(n) || e.setAttribute(n, n == "fill" || n == "stroke" ? this.darkenColorAttr(c) : c);
    }
    loadVmlImage(e, t) {
      e.imageHref?.id && this.tasks.push(this.document?.loadDocumentImage(e.imageHref.id, this.currentPart).then((a) => {
        a && t.setAttribute("href", a);
      }));
    }
    renderVmlElement(e) {
      const t = this.vmlRenderContext(e), a = this.createSvgElement("svg", { style: this.vmlRootStyle(e) });
      if (a.setAttribute("viewBox", `0 0 ${t.width} ${t.height}`), a.setAttribute("preserveAspectRatio", "none"), a.setAttribute("focusable", "false"), e.cssStyle?.position == "absolute") {
        a.dataset.docxFloat = "true";
        const n = e.props?.anchorPosition;
        n?.horizontal?.relative && (a.dataset.docxAnchorHorizontal = n.horizontal.relative), n?.vertical?.relative && (a.dataset.docxAnchorVertical = n.vertical.relative);
      }
      if (e.isGroup) {
        const n = this.createSvgElement("g");
        for (const c of e.children ?? []) if (c.type == d.DomType.VmlElement) n.appendChild(this.renderVmlChildElement(c, t));
        else for (const l of (0, h.asArray)(this.renderElement(c)).filter((m) => m != null)) n.appendChild((0, h.isString)(l) ? document.createTextNode(l) : l);
        a.appendChild(n);
      } else a.appendChild(this.renderVmlChildElement(e, t, { x: 0, y: 0, width: t.width, height: t.height }));
      return a;
    }
    renderVmlChildElement(e, t, a) {
      const n = this.vmlBounds(e, t, a);
      let c;
      switch (e.tagName) {
        case "image": {
          const l = this.createSvgElement("svg");
          l.setAttribute("x", `${n.x}`), l.setAttribute("y", `${n.y}`), l.setAttribute("width", `${n.width}`), l.setAttribute("height", `${n.height}`), l.setAttribute("viewBox", "0 0 100 100"), l.setAttribute("preserveAspectRatio", "none"), l.setAttribute("overflow", "hidden");
          const m = this.createSvgElement("image");
          this.applyVmlAttributes(m, e.attrs), m.setAttribute("x", e.attrs.x ?? "0"), m.setAttribute("y", e.attrs.y ?? "0"), m.setAttribute("width", e.attrs.width ?? "100%"), m.setAttribute("height", e.attrs.height ?? "100%"), this.loadVmlImage(e, m), l.appendChild(m), c = l;
          break;
        }
        case "line": {
          const l = this.createSvgElement("line"), m = e.attrs.x1 == null ? n.x : this.vmlMappedValue(e.attrs.x1, t, "x", !1), f = e.attrs.y1 == null ? n.y : this.vmlMappedValue(e.attrs.y1, t, "y", !1), i = e.attrs.x2 == null ? n.x + n.width : this.vmlMappedValue(e.attrs.x2, t, "x", !1), r = e.attrs.y2 == null ? n.y + n.height : this.vmlMappedValue(e.attrs.y2, t, "y", !1);
          l.setAttribute("x1", `${m}`), l.setAttribute("y1", `${f}`), l.setAttribute("x2", `${i}`), l.setAttribute("y2", `${r}`), this.applyVmlAttributes(l, e.attrs, /* @__PURE__ */ new Set(["x1", "y1", "x2", "y2"])), e.attrs.stroke || l.setAttribute("stroke", "currentColor"), c = l;
          break;
        }
        case "path": {
          const l = this.createSvgElement("path");
          this.applyVmlAttributes(l, e.attrs, /* @__PURE__ */ new Set(["d"])), l.setAttribute("d", e.attrs.d ?? ""), l.setAttribute("transform", `matrix(${t.scaleX} 0 0 ${t.scaleY} ${-t.originX * t.scaleX} ${-t.originY * t.scaleY})`), c = l;
          break;
        }
        case "rect": {
          const l = this.createSvgElement("rect");
          l.setAttribute("x", `${n.x}`), l.setAttribute("y", `${n.y}`), l.setAttribute("width", `${n.width}`), l.setAttribute("height", `${n.height}`), this.applyVmlAttributes(l, e.attrs, /* @__PURE__ */ new Set(["x", "y", "width", "height"])), c = l;
          break;
        }
        case "ellipse": {
          const l = this.createSvgElement("ellipse");
          l.setAttribute("cx", `${n.x + n.width / 2}`), l.setAttribute("cy", `${n.y + n.height / 2}`), l.setAttribute("rx", "" + n.width / 2), l.setAttribute("ry", "" + n.height / 2), this.applyVmlAttributes(l, e.attrs, /* @__PURE__ */ new Set(["cx", "cy", "rx", "ry"])), c = l;
          break;
        }
        case "foreignObject": {
          const l = this.createSvgElement("foreignObject");
          l.setAttribute("x", `${n.x}`), l.setAttribute("y", `${n.y}`), l.setAttribute("width", `${n.width}`), l.setAttribute("height", `${n.height}`), l.setAttribute("overflow", "hidden");
          const m = this.createElement("div", { style: { width: "100%", height: "100%", overflow: "hidden", boxSizing: "border-box" } });
          m.setAttribute("xmlns", S.ns.html);
          for (const f of e.children ?? []) for (const i of (0, h.asArray)(this.renderElement(f)).filter((r) => r != null)) m.appendChild((0, h.isString)(i) ? document.createTextNode(i) : i);
          l.appendChild(m), c = l;
          break;
        }
        default:
          c = this.createSvgElement("g");
      }
      if (e.tagName != "foreignObject") for (const l of e.children ?? []) if (l.type == d.DomType.VmlElement) c.appendChild(this.renderVmlChildElement(l, t, n));
      else for (const m of (0, h.asArray)(this.renderElement(l)).filter((f) => f != null)) c.appendChild((0, h.isString)(m) ? document.createTextNode(m) : m);
      return c;
    }
    renderMmlMathParagraph(e) {
      const t = this.renderElements(e.children);
      for (const a of t) a?.localName == "math" && a.setAttribute("display", "block");
      return this.h({ tagName: "div", className: `${this.className}-math-paragraph`, style: { textAlign: "center" }, children: t });
    }
    renderMmlPhantom(e) {
      return this.renderContainerNS(e, S.ns.mathML, "mphantom");
    }
    renderMmlAccent(e) {
      const t = e.children?.find((c) => c.type == d.DomType.MmlBase), a = this.createMathMLElement("mo", null, [e.props?.char ?? "^"]), n = t ? (0, h.asArray)(this.renderElement(t)).filter((c) => c != null) : [];
      return this.createMathMLElement("mover", null, [...n, a]);
    }
    renderMmlRadical(e) {
      const t = e.children.find((n) => n.type == d.DomType.MmlBase);
      if (e.props?.hideDegree) return this.createMathMLElement("msqrt", null, this.renderElements([t]));
      const a = e.children.find((n) => n.type == d.DomType.MmlDegree);
      return this.createMathMLElement("mroot", null, this.renderElements([t, a]));
    }
    renderMmlDelimiter(e) {
      const t = [], a = e.props?.beginChar, n = e.props?.endChar;
      return a !== "" && t.push(this.createMathMLElement("mo", null, [a ?? "("])), t.push(...this.renderElements(e.children)), n !== "" && t.push(this.createMathMLElement("mo", null, [n ?? ")"])), this.createMathMLElement("mrow", null, t);
    }
    renderMmlNary(e) {
      const t = [], a = (0, h.keyBy)(e.children, (i) => i.type), n = a[d.DomType.MmlSuperArgument], c = a[d.DomType.MmlSubArgument], l = n ? this.createMathMLElement("mrow", null, this.renderElements(n.children)) : null, m = c ? this.createMathMLElement("mrow", null, this.renderElements(c.children)) : null, f = this.createMathMLElement("mo", null, [e.props?.char ?? "∫"]);
      return l && m ? t.push(this.createMathMLElement("munderover", null, [f, m, l])) : l ? t.push(this.createMathMLElement("mover", null, [f, l])) : m ? t.push(this.createMathMLElement("munder", null, [f, m])) : t.push(f), a[d.DomType.MmlBase] && t.push(...this.renderElements(a[d.DomType.MmlBase].children)), this.createMathMLElement("mrow", null, t);
    }
    renderMmlPreSubSuper(e) {
      const t = [], a = (0, h.keyBy)(e.children, (i) => i.type), n = a[d.DomType.MmlSuperArgument], c = a[d.DomType.MmlSubArgument], l = this.createMathMLElement("mrow", null, n ? this.renderElements(n.children) : []), m = this.createMathMLElement("mrow", null, c ? this.renderElements(c.children) : []), f = this.createMathMLElement("mrow", null, []);
      return t.push(this.createMathMLElement("msubsup", null, [f, m, l])), a[d.DomType.MmlBase] && t.push(...this.renderElements(a[d.DomType.MmlBase].children)), this.createMathMLElement("mrow", null, t);
    }
    renderMmlGroupChar(e) {
      const t = e.props?.verticalJustification === "bot" ? "munder" : "mover", a = this.createMathMLElement("mrow", null, this.renderElements(e.children)), n = this.createMathMLElement("mo", null, [e.props?.char ?? "⏞"]);
      return this.createMathMLElement(t, null, [a, n]);
    }
    renderMmlBar(e) {
      const t = {};
      switch (e.props.position) {
        case "top":
          t.textDecoration = "overline";
          break;
        case "bottom":
          t.textDecoration = "underline";
      }
      return this.renderContainerNS(e, S.ns.mathML, "mrow", { style: t });
    }
    renderMmlRun(e) {
      const t = this.extractMathRunText(e);
      if (t != null) {
        const a = this.renderMathTextTokens(t, e.cssStyle);
        return a.length ? a : null;
      }
      return this.renderContainerNS(e, S.ns.mathML, "mrow");
    }
    extractMathRunText(e) {
      let t = "";
      for (const a of e.children ?? []) switch (a.type) {
        case d.DomType.Text:
          t += a.text ?? "";
          break;
        case d.DomType.DeletedText:
          this.options.renderChanges && (t += a.text ?? "");
          break;
        case d.DomType.Symbol:
          t += String.fromCharCode(a.char);
          break;
        case d.DomType.Tab:
          t += " ";
          break;
        case d.DomType.NoBreakHyphen:
          t += "‑";
          break;
        case d.DomType.SoftHyphen:
          break;
        default:
          return null;
      }
      return t;
    }
    renderMathTextTokens(e, t) {
      const a = [];
      let n = 0;
      for (; n < e.length; ) {
        const c = e[n];
        if (/\s/.test(c)) {
          let l = n + 1;
          for (; l < e.length && /\s/.test(e[l]); ) l++;
          a.push(this.createMathMLElement("mspace", { width: 0.25 * Math.max(1, l - n) + "em" })), n = l;
          continue;
        }
        if (R(c)) {
          let l = n + 1;
          for (; l < e.length && (R(e[l]) || e[l] == "."); ) l++;
          a.push(this.createMathToken("mn", e.substring(n, l), t)), n = l;
          continue;
        }
        if ($(c)) {
          let l = n + 1;
          for (; l < e.length && $(e[l]); ) l++;
          a.push(this.createMathToken("mi", e.substring(n, l), t)), n = l;
          continue;
        }
        F(c) ? a.push(this.createMathToken("mo", c, t)) : a.push(this.createMathToken("mtext", c, t)), n++;
      }
      return a;
    }
    createMathToken(e, t, a) {
      return this.createMathMLElement(e, a ? { style: a } : null, [t]);
    }
    renderMllList(e) {
      const t = this.renderElements(e.children).map((a) => this.createMathMLElement("mtr", null, [this.createMathMLElement("mtd", null, [a])]));
      return this.toHTML(e, S.ns.mathML, "mtable", t);
    }
    toH(e, t, a, n = null) {
      const { $lang: c, "$lang-eastAsia": l, "$lang-bidi": m, ...f } = e.cssStyle ?? {};
      return { ns: t, tagName: a, className: (0, S.cx)(e.className, e.styleName && this.processStyleName(e.styleName)), lang: c, style: this.darkenStyle(f), children: n ?? this.renderElements(e.children) };
    }
    darkenStyle(e) {
      if (!this.options.darkMode) return e;
      const t = (0, s.applyDarkModeToStyle)(e);
      if (t === e) return e;
      const a = { ...t };
      for (const n in t) {
        if (n.startsWith("--")) continue;
        const c = e[n], l = t[n];
        l === c || typeof l != "string" || l.toLowerCase().includes("var(") || (a[n] = this.wrapForPrint(c, l));
      }
      return a;
    }
    darkenColorAttr(e) {
      if (!this.options.darkMode) return e;
      const t = (0, s.getDarkModeColor)(e);
      return t === e || t.toLowerCase().includes("var(") ? t : this.wrapForPrint(e, t);
    }
    wrapForPrint(e, t) {
      let a = this.darkModeVarNames.get(e);
      return a || (a = `--docx-dm-${this.darkModeVarNames.size}`, this.darkModeVarNames.set(e, a), this.darkModePrintReset[a] = e), `var(${a}, ${t})`;
    }
    renderDarkModePrintReset() {
      const e = Object.entries(this.darkModePrintReset);
      if (!this.options.darkMode || e.length === 0) return [];
      const t = e.map(([n, c]) => `  ${n}: ${c};\r
`).join(""), a = `@media print {\r
.${this.className} {\r
${t}}\r
}\r
`;
      return [this.h({ tagName: "style", children: [a] })];
    }
    toHTML(e, t, a, n = null) {
      return this.h(this.toH(e, t, a, n));
    }
    findStyle(e) {
      return e && this.styleMap?.[e];
    }
    isTocParagraphStyle(e, t) {
      return [e, t?.id, t?.name, t?.cssName, ...t?.aliases ?? []].filter(Boolean).map((a) => String(a).replace(/[\s_-]+/g, "").toLowerCase()).some((a) => /^toc[1-9]$/.test(a));
    }
    numberingClass(e, t) {
      return `${this.className}-num-${e}-${t}`;
    }
    numberingSelector(e, t) {
      return `.${this.className} p.${this.numberingClass(e, t)}`;
    }
    tabStopClass() {
      return `${this.className}-tab-stop`;
    }
    scopeDocumentStyleSelector(e) {
      const t = e.trim();
      return !t || t.startsWith(`.${this.className}`) || t.startsWith(`section.${this.className}`) || t.startsWith(`.${this.className}-wrapper`) ? e : `.${this.className} ${e}`;
    }
    styleToString(e, t, a = null) {
      let n = `${e} {\r
`;
      const c = this.darkenStyle(t);
      for (const l in c) l.startsWith("$") || (n += `  ${l}: ${c[l]};\r
`);
      return a && (n += a), n + `}\r
`;
    }
    numberingCounter(e, t) {
      return `${this.className}-num-${e}-${t}`;
    }
    numberingRestartLevel(e) {
      if (e.level <= 0) return null;
      if (e.restart == null) return e.level - 1;
      if (e.restart == 0) return null;
      const t = e.restart - 1;
      return t >= 0 && t < e.level ? t : null;
    }
    numberingMarkerRunStyle(e, t) {
      if (!e) return e;
      const a = { ...e };
      return t && delete a["font-family"], a;
    }
    normalizeNumberingLevelText(e, t, a) {
      if (t != "bullet" || !e) return { text: e, normalized: !1 };
      const n = (a?.["font-family"] ?? "").toLowerCase();
      let c = !1, l = null;
      if (n.includes("wingdings")) l = this.wingdingsBulletMap();
      else {
        if (!n.includes("symbol")) return { text: e, normalized: !1 };
        l = this.symbolBulletMap();
      }
      let m = "";
      for (const f of e) {
        const i = l[f.charCodeAt(0)];
        i ? (m += i, c = !0) : m += f;
      }
      return { text: m, normalized: c };
    }
    symbolBulletMap() {
      return { 183: "•", 8226: "•", 61623: "•" };
    }
    wingdingsBulletMap() {
      return { 61548: "●", 61550: "■", 61557: "◆", 61598: "·", 61599: "•", 61600: "▪", 61601: "○", 61604: "◉", 61605: "◎", 61607: "▪", 61608: "◻", 61656: "➢", 61672: "➔", 61690: "▫", 61691: "✗", 61692: "✓", 61693: "☒", 61694: "☑" };
    }
    levelTextToContent(e, t, a, n, c) {
      const l = [];
      let m = 0;
      for (const r of e.matchAll(/%\d+/g)) {
        r.index > m && l.push(`"${this.escapeCssString(e.substring(m, r.index))}"`);
        let o = parseInt(r[0].substring(1), 10) - 1;
        const u = c?.get(`${a}:${o}`) ?? n ?? "decimal";
        l.push(`counter(${this.numberingCounter(a, o)}, ${u})`), m = r.index + r[0].length;
      }
      const f = e.substring(m);
      f && l.push(`"${this.escapeCssString(f)}"`);
      const i = this.numberingSuffixToCssContent(t);
      return i && l.push(i), l.length > 0 ? l.join(" ") : '""';
    }
    numberingSuffixToCssContent(e) {
      switch (e || "tab") {
        case "nothing":
          return "";
        case "space":
          return '"\\000020"';
        default:
          return '"\\000009"';
      }
    }
    escapeCssString(e) {
      return e.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\A ");
    }
    numFormatToCssValue(e) {
      return { none: "none", bullet: "disc", decimal: "decimal", lowerLetter: "lower-alpha", upperLetter: "upper-alpha", lowerRoman: "lower-roman", upperRoman: "upper-roman", decimalZero: "decimal-leading-zero", aiueo: "katakana", aiueoFullWidth: "katakana", chineseCounting: "simp-chinese-informal", chineseCountingThousand: "simp-chinese-informal", chineseLegalSimplified: "simp-chinese-formal", chosung: "hangul-consonant", ideographDigital: "cjk-ideographic", ideographTraditional: "cjk-heavenly-stem", ideographLegalTraditional: "trad-chinese-formal", ideographZodiac: "cjk-earthly-branch", iroha: "katakana-iroha", irohaFullWidth: "katakana-iroha", japaneseCounting: "japanese-informal", japaneseDigitalTenThousand: "cjk-decimal", japaneseLegal: "japanese-formal", thaiNumbers: "thai", koreanCounting: "korean-hangul-formal", koreanDigital: "korean-hangul-formal", koreanDigital2: "korean-hanja-informal", hebrew1: "hebrew", hebrew2: "hebrew", hindiNumbers: "devanagari", ganada: "hangul", taiwaneseCounting: "cjk-ideographic", taiwaneseCountingThousand: "cjk-ideographic", taiwaneseDigital: "cjk-decimal" }[e] ?? e ?? "decimal";
    }
    refreshTabStops() {
      this.options.experimental && setTimeout(() => {
        const e = (0, P.computePixelToPoint)();
        for (let t of this.currentTabs) (0, P.updateTabStop)(t.span, t.stops, this.defaultTabSize, e);
      }, 500);
    }
    createElementNS(e, t, a, n) {
      return this.h({ ns: e, tagName: t, children: n, ...a });
    }
    createElement(e, t, a) {
      return this.createElementNS(S.ns.html, e, t, a);
    }
    createMathMLElement(e, t, a) {
      return this.createElementNS(S.ns.mathML, e, t, a);
    }
    createSvgElement(e, t, a) {
      return this.createElementNS(S.ns.svg, e, t, a);
    }
    later(e) {
      this.postRenderTasks.push(e);
    }
  };
}, "./html": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.ns = void 0, b.h = function P(k) {
    if ((0, d.isString)(k)) return document.createTextNode(k);
    if (k instanceof Node) return k;
    const { ns: s, tagName: v, className: S, style: M, children: R, ...$ } = k;
    if (v === "#fragment") return document.createDocumentFragment();
    if (v === "#comment") return document.createComment(R[0]);
    const F = s ? document.createElementNS(s, v) : document.createElement(v);
    if (S && F.setAttribute("class", S), M) if ((0, d.isString)(M)) F.setAttribute("style", M);
    else for (const [e, t] of Object.entries(M)) t != null && (e.startsWith("--") || e.includes("-") ? F.style.setProperty(e, t) : F.style[e] = t);
    if ($) for (const [e, t] of Object.entries($)) t !== void 0 && (F[e] = t);
    return R && R.forEach((e) => F.appendChild(P(e))), F;
  }, b.cx = function(...P) {
    return P.filter(Boolean).join(" ");
  };
  const d = N("./utils");
  var h;
  (function(P) {
    P.html = "http://www.w3.org/1999/xhtml", P.svg = "http://www.w3.org/2000/svg", P.mathML = "http://www.w3.org/1998/Math/MathML";
  })(h || (b.ns = h = {}));
}, "./input-validation": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.EMPTY_DOCX_ERROR_MESSAGE = void 0, b.assertNonEmptyDocxInput = function(d) {
    if ((function(h) {
      return h == null ? 0 : typeof Blob < "u" && h instanceof Blob ? h.size : typeof ArrayBuffer < "u" && (h instanceof ArrayBuffer || ArrayBuffer.isView(h)) ? h.byteLength : typeof h.size == "number" ? h.size : typeof h.byteLength == "number" ? h.byteLength : typeof h.length == "number" ? h.length : null;
    })(d) === 0) throw new Error(b.EMPTY_DOCX_ERROR_MESSAGE);
  }, b.EMPTY_DOCX_ERROR_MESSAGE = "文件为空或尚未保存，无法作为 Word 文档打开。请在 WPS/Word 中保存后重新上传。";
}, "./javascript": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.computePixelToPoint = function(v = document.body) {
    const S = document.createElement("div");
    S.style.width = "100pt", v.appendChild(S);
    const M = 100 / S.offsetWidth;
    return v.removeChild(S), M;
  }, b.updateTabStop = function(v, S, M, R = 0.75) {
    const $ = v.closest("p");
    if (!$) return;
    const F = v.getBoundingClientRect(), e = $.getBoundingClientRect(), t = getComputedStyle($), a = k(t.marginInlineStart || t.marginLeft), n = k(t.marginInlineEnd || t.marginRight), c = k(t.textIndent), l = S?.length > 0 ? S.map((L) => ({ pos: s(L.position), leader: L.leader, style: L.style })).sort((L, I) => L.pos - I.pos) : [d], m = a * R, f = l.some((L) => Math.abs(L.pos - m) <= P);
    c < -P && m > P && !f && (l.push({ ...d, pos: m }), l.sort((L, I) => L.pos - I.pos));
    const i = l[l.length - 1], r = (e.width + a + n) * R, o = Number.isFinite(s(M)) ? s(M) : 36;
    let u = i.pos + o;
    if (u < r) for (; u < r && l.length < h; u += o) l.push({ ...d, pos: u });
    const y = e.left - a, p = (F.left - y) * R, g = l.find((L) => L.style != "clear" && L.pos > p);
    if (g == null) return;
    let T = 1;
    if (g.style == "right" || g.style == "center") {
      const L = Array.from($.querySelectorAll(`.${v.className}`)), I = L.indexOf(v) + 1, Y = document.createRange();
      Y.setStart(v, 1), I < L.length ? Y.setEndBefore(L[I]) : Y.setEndAfter($);
      const D = g.style == "center" ? 0.5 : 1, Q = Y.getBoundingClientRect(), X = Q.left + D * Q.width - y;
      T = g.pos - X * R;
    } else T = g.pos - p;
    const w = Math.max(Number.isFinite(T) ? T : 0, 0);
    switch (v.innerHTML = "&nbsp;", v.style.display = "inline-block", v.style.width = `${w.toFixed(2)}pt`, v.style.minWidth = "0pt", v.style.lineHeight = "1", v.style.whiteSpace = "nowrap", v.style.wordSpacing = "normal", v.style.textDecoration = "none", v.style.borderBottom = "", v.style.height = "", v.style.transform = "", g.leader) {
      case "dot":
      case "middleDot":
        v.style.borderBottom = "1px dotted currentColor", v.style.height = ".85em", v.style.transform = "translateY(-.18em)";
        break;
      case "hyphen":
      case "heavy":
      case "underscore":
        v.style.borderBottom = "1px solid currentColor", v.style.height = ".85em", v.style.transform = "translateY(-.18em)";
    }
  };
  const d = { pos: 0, leader: "none", style: "left" }, h = 50, P = 0.1;
  function k(v) {
    const S = parseFloat(v);
    return Number.isFinite(S) ? S : 0;
  }
  function s(v) {
    return parseFloat(v);
  }
}, "./length": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.Length = void 0;
  const d = N("./utils");
  class h {
    constructor(k, s) {
      this.value = k, this.type = s;
    }
    static parse(k) {
      const s = parseFloat(k), v = /p[tx]$/i.exec(k)?.[0];
      return new h(s, v);
    }
    static from(k) {
      return (0, d.isString)(k) ? h.parse(k) : k instanceof h ? k : null;
    }
    add(k) {
      if (k.type !== this.type) throw new Error("Can't do math on different types");
      return new h(this.value + k.value, this.type);
    }
    mul(k) {
      return new h(this.value * k, this.type);
    }
    valueOf() {
      return this.value;
    }
    toString() {
      return `${this.value.toFixed(2)}${this.type ?? ""}`;
    }
  }
  b.Length = h;
}, "./license-gate": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.assertViewerLicense = function(d, h) {
  };
}, "./metafile/emf-to-svg": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.isEmfBinary = k, b.convertEmfToSvgDataUrl = function(x, C) {
    const E = s(x, C);
    return E ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(E)}` : null;
  }, b.convertEmfToSvg = s;
  const d = { HEADER: 1, POLYBEZIER: 2, POLYGON: 3, POLYLINE: 4, POLYBEZIERTO: 5, POLYLINETO: 6, POLYPOLYLINE: 7, POLYPOLYGON: 8, SETWINDOWEXTEX: 9, SETWINDOWORGEX: 10, SETVIEWPORTEXTEX: 11, SETVIEWPORTORGEX: 12, EOF: 14, SETPIXELV: 15, SETBKMODE: 18, SETPOLYFILLMODE: 19, SETTEXTALIGN: 22, SETTEXTCOLOR: 24, SETBKCOLOR: 25, MOVETOEX: 27, SCALEVIEWPORTEXTEX: 31, SCALEWINDOWEXTEX: 32, SAVEDC: 33, RESTOREDC: 34, SETWORLDTRANSFORM: 35, MODIFYWORLDTRANSFORM: 36, SELECTOBJECT: 37, CREATEPEN: 38, CREATEBRUSHINDIRECT: 39, DELETEOBJECT: 40, ELLIPSE: 42, RECTANGLE: 43, ROUNDRECT: 44, ARC: 45, CHORD: 46, PIE: 47, LINETO: 54, ARCTO: 55, POLYDRAW: 56, BEGINPATH: 59, ENDPATH: 60, CLOSEFIGURE: 61, FILLPATH: 62, STROKEANDFILLPATH: 63, STROKEPATH: 64, BITBLT: 76, STRETCHBLT: 77, STRETCHDIBITS: 81, EXTCREATEFONTINDIRECTW: 82, EXTTEXTOUTA: 83, EXTTEXTOUTW: 84, POLYBEZIER16: 85, POLYGON16: 86, POLYLINE16: 87, POLYBEZIERTO16: 88, POLYLINETO16: 89, POLYPOLYLINE16: 90, POLYPOLYGON16: 91, POLYDRAW16: 92, EXTCREATEPEN: 95, POLYTEXTOUTA: 96, POLYTEXTOUTW: 97, SMALLTEXTOUT: 108, ALPHABLEND: 114, TRANSPARENTBLT: 116 }, h = { 0: { type: "brush", color: "#ffffff" }, 1: { type: "brush", color: "#c0c0c0" }, 2: { type: "brush", color: "#808080" }, 3: { type: "brush", color: "#404040" }, 4: { type: "brush", color: "#000000" }, 5: { type: "brush", color: "none", nullBrush: !0 }, 6: { type: "pen", color: "#ffffff", width: 1 }, 7: { type: "pen", color: "#000000", width: 1 }, 8: { type: "pen", color: "none", width: 0, nullPen: !0 }, 18: { type: "brush", color: "#ffffff" }, 19: { type: "pen", color: "#000000", width: 1 } }, P = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 };
  function k(x) {
    if (!x || x.length < 48) return !1;
    const C = $(x);
    return C.getUint32(0, !0) == d.HEADER && C.getUint32(40, !0) == 1179469088;
  }
  function s(x, C = {}) {
    if (!k(x)) return null;
    const E = $(x), W = E.getUint32(4, !0), U = F(E, 8), j = F(E, 24), J = E.byteLength >= 52 ? E.getUint32(48, !0) : 0, V = Math.max(1, U.right - U.left), z = Math.max(1, U.bottom - U.top), ne = Math.max(1, j.right - j.left) / 100, q = Math.max(1, j.bottom - j.top) / 100, O = { world: R(P), windowOrg: { x: 0, y: 0 }, windowExt: null, viewportOrg: { x: 0, y: 0 }, viewportExt: null, pen: { type: "pen", color: "#000000", width: 1 }, brush: { type: "brush", color: "#ffffff", nullBrush: !0 }, font: null, textColor: "#000000", bkColor: "#ffffff", bkMode: 1, polyFillMode: 1, textAlign: 0, currentPoint: { x: 0, y: 0 } }, le = [], ee = {}, me = [];
    let H = Math.max(8, W || 108), ke = 1, Pe = "", be = !1, Ne = 0;
    const Ae = C.maxRecords ?? Math.max(1e4, J + 100), Ee = C.maxShapes ?? 5e4, ce = (ue) => {
      !ue || Ne >= Ee || (me.push(ue), Ne++);
    }, Te = (ue) => {
      ue && (Pe += (Pe ? " " : "") + ue);
    };
    for (; H + 8 <= E.byteLength && ke++ <= Ae; ) {
      const ue = E.getUint32(H, !0), ve = E.getUint32(H + 4, !0);
      if (ve < 8 || H + ve > E.byteLength) break;
      switch (ue) {
        case d.EOF:
          H += ve, ke = Ae + 1;
          break;
        case d.SETWINDOWEXTEX:
          O.windowExt = t(E, H + 8);
          break;
        case d.SETWINDOWORGEX:
          O.windowOrg = e(E, H + 8);
          break;
        case d.SETVIEWPORTEXTEX:
          O.viewportExt = t(E, H + 8);
          break;
        case d.SETVIEWPORTORGEX:
          O.viewportOrg = e(E, H + 8);
          break;
        case d.SCALEWINDOWEXTEX:
          O.windowExt && (O.windowExt = f(E, H, O.windowExt));
          break;
        case d.SCALEVIEWPORTEXTEX:
          O.viewportExt && (O.viewportExt = f(E, H, O.viewportExt));
          break;
        case d.SETWORLDTRANSFORM:
          O.world = n(E, H + 8);
          break;
        case d.MODIFYWORLDTRANSFORM: {
          const te = n(E, H + 8), ie = E.getUint32(H + 32, !0);
          ie == 1 ? O.world = R(P) : ie == 2 ? O.world = c(te, O.world) : ie == 3 ? O.world = c(O.world, te) : ie == 4 && (O.world = te);
          break;
        }
        case d.SAVEDC:
          le.push(v(O));
          break;
        case d.RESTOREDC: {
          const te = E.getInt32(H + 8, !0);
          if (te < 0) for (let ie = 0; ie < Math.min(-te, le.length); ie++) Object.assign(O, le.pop());
          else if (te > 0 && te <= le.length) {
            const ie = le[te - 1];
            le.length = te - 1, Object.assign(O, v(ie));
          }
          break;
        }
        case d.SETBKMODE:
          O.bkMode = E.getUint32(H + 8, !0);
          break;
        case d.SETPOLYFILLMODE:
          O.polyFillMode = E.getUint32(H + 8, !0);
          break;
        case d.SETTEXTALIGN:
          O.textAlign = E.getUint32(H + 8, !0);
          break;
        case d.SETTEXTCOLOR:
          O.textColor = i(E.getUint32(H + 8, !0));
          break;
        case d.SETBKCOLOR:
          O.bkColor = i(E.getUint32(H + 8, !0));
          break;
        case d.CREATEPEN: {
          const te = E.getUint32(H + 8, !0), ie = E.getUint32(H + 12, !0), Me = Math.abs(E.getInt32(H + 16, !0)), Le = i(E.getUint32(H + 24, !0));
          ee[te] = { type: "pen", color: Le, width: Me || 1, nullPen: (15 & ie) == 5 };
          break;
        }
        case d.EXTCREATEPEN: {
          const te = E.getUint32(H + 8, !0), ie = E.getUint32(H + 28, !0), Me = Math.abs(E.getInt32(H + 32, !0)), Le = E.getUint32(H + 36, !0), $e = i(E.getUint32(H + 40, !0));
          ee[te] = { type: "pen", color: $e, width: Me || 1, nullPen: (15 & ie) == 5 || Le == 1 };
          break;
        }
        case d.CREATEBRUSHINDIRECT: {
          const te = E.getUint32(H + 8, !0), ie = E.getUint32(H + 12, !0), Me = i(E.getUint32(H + 16, !0));
          ee[te] = { type: "brush", color: Me, nullBrush: ie == 1 };
          break;
        }
        case d.EXTCREATEFONTINDIRECTW:
          ee[E.getUint32(H + 8, !0)] = A(E, H + 12, ve - 12);
          break;
        case d.SELECTOBJECT: {
          const te = E.getUint32(H + 8, !0), ie = 2147483648 & te ? h[2147483647 & te] : ee[te];
          ie?.type == "pen" ? O.pen = S(ie) : ie?.type == "brush" ? O.brush = M(ie) : ie?.type == "font" && (O.font = { ...ie });
          break;
        }
        case d.DELETEOBJECT:
          delete ee[E.getUint32(H + 8, !0)];
          break;
        case d.BEGINPATH:
          be = !0, Pe = "";
          break;
        case d.ENDPATH:
          be = !1;
          break;
        case d.CLOSEFIGURE:
          Te("Z");
          break;
        case d.MOVETOEX: {
          const te = l(O, e(E, H + 8));
          O.currentPoint = te, be && Te(`M ${o(te.x)} ${o(te.y)}`);
          break;
        }
        case d.LINETO: {
          const te = l(O, e(E, H + 8));
          be ? Te(`L ${o(te.x)} ${o(te.y)}`) : ce(`<path d="M ${o(O.currentPoint.x)} ${o(O.currentPoint.y)} L ${o(te.x)} ${o(te.y)}" ${y(O, !1, !0)}/>`), O.currentPoint = te;
          break;
        }
        case d.POLYLINE:
        case d.POLYGON:
          T(E, H, ue == d.POLYGON, !1, be, O, Te, ce);
          break;
        case d.POLYLINETO:
          T(E, H, !1, !0, be, O, Te, ce);
          break;
        case d.POLYLINE16:
        case d.POLYGON16:
          g(E, H, ue == d.POLYGON16, !1, be, O, Te, ce);
          break;
        case d.POLYLINETO16:
          g(E, H, !1, !0, be, O, Te, ce);
          break;
        case d.POLYBEZIER:
          L(E, H, !1, !1, be, O, Te, ce);
          break;
        case d.POLYBEZIERTO:
          L(E, H, !1, !0, be, O, Te, ce);
          break;
        case d.POLYBEZIER16:
          L(E, H, !0, !1, be, O, Te, ce);
          break;
        case d.POLYBEZIERTO16:
          L(E, H, !0, !0, be, O, Te, ce);
          break;
        case d.POLYPOLYLINE:
        case d.POLYPOLYGON:
          I(E, H, ue == d.POLYPOLYGON, !1, be, O, Te, ce);
          break;
        case d.POLYPOLYLINE16:
        case d.POLYPOLYGON16:
          I(E, H, ue == d.POLYPOLYGON16, !0, be, O, Te, ce);
          break;
        case d.POLYDRAW:
          Y(E, H, !1, be, O, Te, ce);
          break;
        case d.POLYDRAW16:
          Y(E, H, !0, be, O, Te, ce);
          break;
        case d.RECTANGLE:
          D(E, H, O, ce, !1);
          break;
        case d.ELLIPSE:
          Q(E, H, O, ce);
          break;
        case d.ROUNDRECT:
          D(E, H, O, ce, !0);
          break;
        case d.ARC:
        case d.ARCTO:
        case d.CHORD:
        case d.PIE:
          X(E, H, ue, be, O, Te, ce);
          break;
        case d.FILLPATH:
          p(Pe, O, ce, !0, !1), Pe = "";
          break;
        case d.STROKEPATH:
          p(Pe, O, ce, !1, !0), Pe = "";
          break;
        case d.STROKEANDFILLPATH:
          p(Pe, O, ce, !0, !0), Pe = "";
          break;
        case d.EXTTEXTOUTA:
        case d.EXTTEXTOUTW:
          B(E, H, ve, O, ce, ue == d.EXTTEXTOUTW);
          break;
        case d.POLYTEXTOUTA:
        case d.POLYTEXTOUTW:
          _(E, H, ve, O, ce, ue == d.POLYTEXTOUTW);
          break;
        case d.SMALLTEXTOUT:
          G(E, H, ve, O, ce);
          break;
        case d.SETPIXELV:
          fe(E, H, O, ce);
          break;
        case d.BITBLT:
        case d.STRETCHBLT:
        case d.STRETCHDIBITS:
        case d.ALPHABLEND:
        case d.TRANSPARENTBLT:
          ge(E, H, ve, ue, O, ce);
      }
      H += ve;
    }
    if (Pe && p(Pe, O, ce, !0, !0), !me.length) {
      const ue = (function(ve, te) {
        const ie = (function($e) {
          const Be = (function(pe) {
            const xe = [137, 80, 78, 71, 13, 10, 26, 10];
            for (let ye = 0; ye + xe.length + 12 <= pe.length; ye++) {
              if (!Ce(pe, xe, ye)) continue;
              let De = ye + 8;
              for (; De + 12 <= pe.length; ) {
                const He = K(pe, De), We = String.fromCharCode(pe[De + 4], pe[De + 5], pe[De + 6], pe[De + 7]);
                if (De += 12 + He, De > pe.length) break;
                if (We == "IEND") return pe.subarray(ye, De);
              }
            }
            return null;
          })($e);
          if (Be) return `data:image/png;base64,${he(Be)}`;
          const Re = (function(pe) {
            for (let xe = 0; xe + 4 < pe.length; xe++) if (pe[xe] == 255 && pe[xe + 1] == 216 && pe[xe + 2] == 255) {
              for (let ye = xe + 4; ye + 1 < pe.length; ye++) if (pe[ye] == 255 && pe[ye + 1] == 217) return pe.subarray(xe, ye + 2);
            }
            return null;
          })($e);
          if (Re) return `data:image/jpeg;base64,${he(Re)}`;
          const Oe = (function(pe) {
            for (let xe = 0; xe + 14 < pe.length; xe++) {
              if (pe[xe] != 66 || pe[xe + 1] != 77) continue;
              const ye = we(pe, xe + 2);
              if (ye > 14 && xe + ye <= pe.length) return pe.subarray(xe, xe + ye);
            }
            return null;
          })($e);
          return Oe ? `data:image/bmp;base64,${he(Oe)}` : null;
        })(ve);
        if (!ie) return [];
        const Me = Math.max(1, te.right - te.left), Le = Math.max(1, te.bottom - te.top);
        return [`<image x="${o(te.left)}" y="${o(te.top)}" width="${o(Me)}" height="${o(Le)}" href="${ie}" preserveAspectRatio="xMidYMid meet"/>`];
      })(x, U);
      ue.length && me.push(...ue);
    }
    return me.length ? `<svg xmlns="http://www.w3.org/2000/svg" width="${o(ne)}mm" height="${o(q)}mm" viewBox="${o(U.left)} ${o(U.top)} ${o(V)} ${o(z)}" preserveAspectRatio="xMidYMid meet" data-docx-metafile="emf">${me.join("")}</svg>` : (function(ue, ve, te, ie, Me) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${o(ie)}mm" height="${o(Me)}mm" viewBox="${o(te.left)} ${o(te.top)} ${o(ue)} ${o(ve)}" preserveAspectRatio="xMidYMid meet" data-docx-metafile="emf"><rect x="${o(te.left)}" y="${o(te.top)}" width="${o(ue)}" height="${o(ve)}" fill="none" stroke="#999" stroke-width="1"/><text x="${o(te.left + ue / 2)}" y="${o(te.top + ve / 2)}" text-anchor="middle" font-size="12" fill="#666">${u("Unsupported EMF image")}</text></svg>`;
    })(V, z, U, ne, q);
  }
  function v(x) {
    return { world: R(x.world), windowOrg: { ...x.windowOrg }, windowExt: x.windowExt ? { ...x.windowExt } : null, viewportOrg: { ...x.viewportOrg }, viewportExt: x.viewportExt ? { ...x.viewportExt } : null, pen: S(x.pen), brush: M(x.brush), font: x.font ? { ...x.font } : null, textColor: x.textColor, bkColor: x.bkColor, bkMode: x.bkMode, polyFillMode: x.polyFillMode, textAlign: x.textAlign, currentPoint: { ...x.currentPoint } };
  }
  function S(x) {
    return { ...x };
  }
  function M(x) {
    return { ...x };
  }
  function R(x) {
    return { ...x };
  }
  function $(x) {
    return new DataView(x.buffer, x.byteOffset, x.byteLength);
  }
  function F(x, C) {
    return { left: x.getInt32(C, !0), top: x.getInt32(C + 4, !0), right: x.getInt32(C + 8, !0), bottom: x.getInt32(C + 12, !0) };
  }
  function e(x, C) {
    return { x: x.getInt32(C, !0), y: x.getInt32(C + 4, !0) };
  }
  function t(x, C) {
    return e(x, C);
  }
  function a(x, C) {
    return { x: x.getInt16(C, !0), y: x.getInt16(C + 2, !0) };
  }
  function n(x, C) {
    return { m11: x.getFloat32(C, !0), m12: x.getFloat32(C + 4, !0), m21: x.getFloat32(C + 8, !0), m22: x.getFloat32(C + 12, !0), dx: x.getFloat32(C + 16, !0), dy: x.getFloat32(C + 20, !0) };
  }
  function c(x, C) {
    return { m11: x.m11 * C.m11 + x.m12 * C.m21, m12: x.m11 * C.m12 + x.m12 * C.m22, m21: x.m21 * C.m11 + x.m22 * C.m21, m22: x.m21 * C.m12 + x.m22 * C.m22, dx: x.dx * C.m11 + x.dy * C.m21 + C.dx, dy: x.dx * C.m12 + x.dy * C.m22 + C.dy };
  }
  function l(x, C) {
    const E = x.world;
    let W = C.x * E.m11 + C.y * E.m21 + E.dx, U = C.x * E.m12 + C.y * E.m22 + E.dy;
    return x.windowExt && x.viewportExt && x.windowExt.x && x.windowExt.y && (W = (W - x.windowOrg.x) * x.viewportExt.x / x.windowExt.x + x.viewportOrg.x, U = (U - x.windowOrg.y) * x.viewportExt.y / x.windowExt.y + x.viewportOrg.y), { x: W, y: U };
  }
  function m(x) {
    let C = Math.hypot(x.world.m11, x.world.m12), E = Math.hypot(x.world.m21, x.world.m22);
    x.windowExt && x.viewportExt && x.windowExt.x && x.windowExt.y && (C *= Math.abs(x.viewportExt.x / x.windowExt.x), E *= Math.abs(x.viewportExt.y / x.windowExt.y));
    const W = (C + E) / 2;
    return Number.isFinite(W) && W > 0 ? W : 1;
  }
  function f(x, C, E) {
    const W = x.getInt32(C + 8, !0), U = x.getInt32(C + 12, !0), j = x.getInt32(C + 16, !0), J = x.getInt32(C + 20, !0);
    return { x: U ? E.x * W / U : E.x, y: J ? E.y * j / J : E.y };
  }
  function i(x) {
    const C = x >> 8 & 255, E = x >> 16 & 255;
    return `#${r(255 & x)}${r(C)}${r(E)}`;
  }
  function r(x) {
    return Math.max(0, Math.min(255, 0 | x)).toString(16).padStart(2, "0");
  }
  function o(x) {
    return Number.isFinite(x) ? "" + Math.round(1e3 * x) / 1e3 : "0";
  }
  function u(x) {
    return `${x ?? ""}`.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function y(x, C, E) {
    const W = [];
    if (C && !x.brush.nullBrush ? (W.push(`fill="${x.brush.color}"`), W.push(`fill-rule="${x.polyFillMode == 2 ? "nonzero" : "evenodd"}"`)) : W.push('fill="none"'), E && !x.pen.nullPen) {
      const U = m(x), j = x.pen.width == 0 ? 1 : Math.max(0.35, x.pen.width * U);
      W.push(`stroke="${x.pen.color}"`), W.push(`stroke-width="${o(j)}"`), W.push('stroke-linecap="square"'), W.push('stroke-linejoin="miter"');
    } else W.push('stroke="none"');
    return W.join(" ");
  }
  function p(x, C, E, W, U) {
    x && E(`<path d="${x}" ${y(C, W, U)}/>`);
  }
  function g(x, C, E, W, U, j, J, V) {
    const z = x.getUint32(C + 24, !0);
    if (!z || C + 28 + 4 * z > x.byteLength) return;
    const ne = [];
    for (let q = 0; q < z; q++) ne.push(l(j, a(x, C + 28 + 4 * q)));
    w(ne, E, W, U, j, J, V);
  }
  function T(x, C, E, W, U, j, J, V) {
    const z = x.getUint32(C + 24, !0);
    if (!z || C + 28 + 8 * z > x.byteLength) return;
    const ne = [];
    for (let q = 0; q < z; q++) ne.push(l(j, e(x, C + 28 + 8 * q)));
    w(ne, E, W, U, j, J, V);
  }
  function w(x, C, E, W, U, j, J) {
    if (!x.length) return;
    let V = W && E ? "" : E ? `M ${o(U.currentPoint.x)} ${o(U.currentPoint.y)}` : `M ${o(x[0].x)} ${o(x[0].y)}`;
    for (let z = E ? 0 : 1; z < x.length; z++) V += ` L ${o(x[z].x)} ${o(x[z].y)}`;
    C && (V += " Z"), U.currentPoint = x[x.length - 1], W ? j(V.trim()) : J(`<path d="${V.trim()}" ${y(U, C, !0)}/>`);
  }
  function L(x, C, E, W, U, j, J, V) {
    const z = x.getUint32(C + 24, !0), ne = E ? 4 : 8;
    if (!z || C + 28 + z * ne > x.byteLength) return;
    const q = [];
    for (let ee = 0; ee < z; ee++) {
      const me = E ? a(x, C + 28 + ee * ne) : e(x, C + 28 + ee * ne);
      q.push(l(j, me));
    }
    let O = U && W ? "" : W ? `M ${o(j.currentPoint.x)} ${o(j.currentPoint.y)}` : `M ${o(q[0].x)} ${o(q[0].y)}`, le = W ? j.currentPoint : q[0];
    for (let ee = W ? 0 : 1; ee + 2 < q.length; ee += 3) {
      const me = q[ee], H = q[ee + 1], ke = q[ee + 2];
      O += ` C ${o(me.x)} ${o(me.y)} ${o(H.x)} ${o(H.y)} ${o(ke.x)} ${o(ke.y)}`, le = ke;
    }
    j.currentPoint = le, U ? J(O.trim()) : V(`<path d="${O.trim()}" ${y(j, !1, !0)}/>`);
  }
  function I(x, C, E, W, U, j, J, V) {
    const z = x.getUint32(C + 24, !0), ne = x.getUint32(C + 28, !0), q = C + 32, O = q + 4 * z, le = W ? 4 : 8;
    if (!z || !ne || O + ne * le > x.byteLength) return;
    let ee = 0;
    for (let me = 0; me < z; me++) {
      const H = x.getUint32(q + 4 * me, !0);
      if (!H || ee + H > ne) break;
      const ke = [];
      for (let Pe = 0; Pe < H; Pe++) {
        const be = O + (ee + Pe) * le, Ne = W ? a(x, be) : e(x, be);
        ke.push(l(j, Ne));
      }
      w(ke, E, !1, U, j, J, V), ee += H;
    }
  }
  function Y(x, C, E, W, U, j, J) {
    const V = x.getUint32(C + 24, !0), z = E ? 4 : 8, ne = C + 28, q = ne + V * z;
    if (!V || q + V > x.byteLength) return;
    const O = [];
    for (let me = 0; me < V; me++) {
      const H = ne + me * z, ke = E ? a(x, H) : e(x, H);
      O.push(l(U, ke));
    }
    let le = "", ee = 0;
    for (; ee < V; ) {
      const me = x.getUint8(q + ee), H = 6 & me;
      H == 6 ? (le += ` M ${o(O[ee].x)} ${o(O[ee].y)}`, U.currentPoint = O[ee], ee++) : H == 2 ? (le += ` L ${o(O[ee].x)} ${o(O[ee].y)}`, U.currentPoint = O[ee], ee++) : H == 4 && ee + 2 < V ? (le += ` C ${o(O[ee].x)} ${o(O[ee].y)} ${o(O[ee + 1].x)} ${o(O[ee + 1].y)} ${o(O[ee + 2].x)} ${o(O[ee + 2].y)}`, U.currentPoint = O[ee + 2], ee += 3) : ee++, 1 & me && (le += " Z");
    }
    le = le.trim(), le && (W ? j(le) : J(`<path d="${le}" ${y(U, !1, !0)}/>`));
  }
  function D(x, C, E, W, U) {
    const j = F(x, C + 8), J = l(E, { x: j.left, y: j.top }), V = l(E, { x: j.right, y: j.bottom }), z = Math.min(J.x, V.x), ne = Math.min(J.y, V.y), q = Math.abs(V.x - J.x), O = Math.abs(V.y - J.y), le = U ? ` rx="${o(Math.min(q, O) / 8)}" ry="${o(Math.min(q, O) / 8)}"` : "";
    W(`<rect x="${o(z)}" y="${o(ne)}" width="${o(q)}" height="${o(O)}"${le} ${y(E, !0, !0)}/>`);
  }
  function Q(x, C, E, W) {
    const U = F(x, C + 8), j = l(E, { x: U.left, y: U.top }), J = l(E, { x: U.right, y: U.bottom }), V = (j.x + J.x) / 2, z = (j.y + J.y) / 2, ne = Math.abs(J.x - j.x) / 2, q = Math.abs(J.y - j.y) / 2;
    W(`<ellipse cx="${o(V)}" cy="${o(z)}" rx="${o(ne)}" ry="${o(q)}" ${y(E, !0, !0)}/>`);
  }
  function X(x, C, E, W, U, j, J) {
    const V = F(x, C + 8), z = e(x, C + 24), ne = e(x, C + 32), q = (V.left + V.right) / 2, O = (V.top + V.bottom) / 2, le = Math.abs(V.right - V.left) / 2, ee = Math.abs(V.bottom - V.top) / 2;
    if (!le || !ee) return;
    const me = Math.atan2(z.y - O, z.x - q);
    let H = Math.atan2(ne.y - O, ne.x - q), ke = H - me;
    ke <= 0 && (ke += 2 * Math.PI);
    const Pe = ke > Math.PI ? 1 : 0, be = l(U, { x: q + Math.cos(me) * le, y: O + Math.sin(me) * ee }), Ne = l(U, { x: q + Math.cos(H) * le, y: O + Math.sin(H) * ee }), Ae = l(U, { x: q, y: O }), Ee = l(U, { x: q + le, y: O }), ce = l(U, { x: q, y: O + ee }), Te = Math.max(0.01, Math.abs(Ee.x - Ae.x) || Math.abs(ce.x - Ae.x)), ue = Math.max(0.01, Math.abs(ce.y - Ae.y) || Math.abs(Ee.y - Ae.y)), ve = `A ${o(Te)} ${o(ue)} 0 ${Pe} 1 ${o(Ne.x)} ${o(Ne.y)}`;
    let te = `M ${o(be.x)} ${o(be.y)} ${ve}`, ie = !1;
    E == d.CHORD ? (te += " Z", ie = !0) : E == d.PIE && (te += ` L ${o(Ae.x)} ${o(Ae.y)} Z`, ie = !0), E == d.ARCTO && (U.currentPoint = Ne), W ? j(te) : J(`<path d="${te}" ${y(U, ie, !0)}/>`);
  }
  function A(x, C, E) {
    const W = E >= 4 ? x.getInt32(C, !0) : 12, U = E >= 20 ? x.getInt32(C + 16, !0) : 400, j = E >= 21 && x.getUint8(C + 20) != 0, J = E >= 22 && x.getUint8(C + 21) != 0;
    let V = "";
    const z = C + 28, ne = Math.max(0, Math.min(64, E - 28));
    for (let q = 0; q + 1 < ne; q += 2) {
      const O = x.getUint16(z + q, !0);
      if (!O) break;
      V += String.fromCharCode(O);
    }
    return { type: "font", family: V, size: Math.abs(W) || 12, weight: U, italic: j, underline: J };
  }
  function B(x, C, E, W, U, j) {
    if (E < 76) return;
    const J = l(W, e(x, C + 36)), V = x.getUint32(C + 44, !0), z = x.getUint32(C + 48, !0);
    !V || z <= 0 || z + V * (j ? 2 : 1) > E || oe(j ? re(x, C + z, V) : ae(new Uint8Array(x.buffer, x.byteOffset + C + z, V)), J, W, U);
  }
  function _(x, C, E, W, U, j) {
    if (E < 40) return;
    const J = x.getUint32(C + 36, !0);
    let V = C + 40;
    for (let z = 0; z < J && V + 40 <= C + E; z++, V += 40) {
      const ne = l(W, e(x, V)), q = x.getUint32(V + 8, !0), O = x.getUint32(V + 12, !0);
      !q || !O || O + q * (j ? 2 : 1) > E || oe(j ? re(x, C + O, q) : ae(new Uint8Array(x.buffer, x.byteOffset + C + O, q)), ne, W, U);
    }
  }
  function G(x, C, E, W, U) {
    if (E < 36) return;
    const j = l(W, e(x, C + 8)), J = x.getUint32(C + 16, !0), V = 512 & x.getUint32(C + 20, !0) ? 40 : 28;
    !J || V + J > E || oe(ae(new Uint8Array(x.buffer, x.byteOffset + C + V, J)), j, W, U);
  }
  function re(x, C, E) {
    let W = "";
    for (let U = 0; U < E; U++) {
      const j = x.getUint16(C + 2 * U, !0);
      j && (W += String.fromCharCode(j));
    }
    return W;
  }
  function ae(x) {
    if (!x.length) return "";
    const C = globalThis.TextDecoder;
    if (C) try {
      return new C("gb18030").decode(x).replace(/\0+$/g, "");
    } catch {
      try {
        return new C("windows-1252").decode(x).replace(/\0+$/g, "");
      } catch {
      }
    }
    let E = "";
    for (const W of x) W && (E += String.fromCharCode(W));
    return E;
  }
  function de(x) {
    const C = 6 & x.textAlign;
    return C == 6 ? 'text-anchor="middle"' : C == 2 ? 'text-anchor="end"' : "";
  }
  function se(x) {
    const C = 24 & x.textAlign;
    return C == 0 ? 'dominant-baseline="text-before-edge"' : C == 8 ? 'dominant-baseline="text-after-edge"' : "";
  }
  function oe(x, C, E, W) {
    x && W(`<text ${(function(U, j) {
      const J = U.font, V = Math.max(1, (J?.size ?? 12) * m(U));
      return [`x="${o(j.x)}"`, `y="${o(j.y)}"`, `fill="${U.textColor}"`, `font-size="${o(V)}"`, J?.family ? `font-family="${u(J.family)}"` : "", J?.weight ? `font-weight="${J.weight >= 600 ? "bold" : "normal"}"` : "", J?.italic ? 'font-style="italic"' : "", J?.underline ? 'text-decoration="underline"' : "", de(U), se(U)].filter(Boolean).join(" ");
    })(E, C)}>${u(x)}</text>`);
  }
  function fe(x, C, E, W) {
    if (C + 20 > x.byteLength) return;
    const U = l(E, e(x, C + 8)), j = i(x.getUint32(C + 16, !0));
    W(`<rect x="${o(U.x)}" y="${o(U.y)}" width="1" height="1" fill="${j}" stroke="none"/>`);
  }
  function ge(x, C, E, W, U, j) {
    let J = 0, V = 0, z = 0, ne = 0, q = 0, O = 0, le = 0, ee = 0;
    if (W == d.STRETCHDIBITS) {
      if (E < 80) return;
      J = x.getInt32(C + 24, !0), V = x.getInt32(C + 28, !0), q = x.getUint32(C + 48, !0), O = x.getUint32(C + 52, !0), le = x.getUint32(C + 56, !0), ee = x.getUint32(C + 60, !0), z = x.getInt32(C + 72, !0), ne = x.getInt32(C + 76, !0);
    } else {
      if (E < 100) return;
      J = x.getInt32(C + 24, !0), V = x.getInt32(C + 28, !0), z = x.getInt32(C + 32, !0), ne = x.getInt32(C + 36, !0), q = x.getUint32(C + 84, !0), O = x.getUint32(C + 88, !0), le = x.getUint32(C + 92, !0), ee = x.getUint32(C + 96, !0);
    }
    if (!q || !O || !le || !ee || q + O > E || le + ee > E) return;
    const me = (function(Ee, ce, Te, ue, ve, te) {
      const ie = ce + Te, Me = ce + ve;
      if (ue < 4 || ie + ue > Ee.byteLength || Me + te > Ee.byteLength) return null;
      const Le = Ee.getUint32(ie, !0) >= 40 && ue >= 20 ? Ee.getUint32(ie + 16, !0) : 0, $e = new Uint8Array(Ee.buffer, Ee.byteOffset + Me, te);
      if (Le == 4) return `data:image/jpeg;base64,${he($e)}`;
      if (Le == 5) return `data:image/png;base64,${he($e)}`;
      const Be = new Uint8Array(ue + te);
      return Be.set(new Uint8Array(Ee.buffer, Ee.byteOffset + ie, ue), 0), Be.set($e, ue), (function(Re, Oe) {
        if (!Re?.length || Oe <= 0 || Oe > Re.length) return null;
        const pe = 14 + Re.length, xe = 14 + Oe, ye = new Uint8Array(pe);
        return ye[0] = 66, ye[1] = 77, Se(ye, 2, pe), Se(ye, 10, xe), ye.set(Re, 14), `data:image/bmp;base64,${he(ye)}`;
      })(Be, ue);
    })(x, C, q, O, le, ee);
    if (!me) return;
    const H = l(U, { x: J, y: V }), ke = l(U, { x: J + z, y: V + ne }), Pe = Math.min(H.x, ke.x), be = Math.min(H.y, ke.y), Ne = Math.abs(ke.x - H.x), Ae = Math.abs(ke.y - H.y);
    j(`<image x="${o(Pe)}" y="${o(be)}" width="${o(Ne)}" height="${o(Ae)}" href="${me}" preserveAspectRatio="none"/>`);
  }
  function Ce(x, C, E) {
    for (let W = 0; W < C.length; W++) if (x[E + W] != C[W]) return !1;
    return !0;
  }
  function K(x, C) {
    return (x[C] << 24 | x[C + 1] << 16 | x[C + 2] << 8 | x[C + 3]) >>> 0;
  }
  function we(x, C) {
    return (x[C] | x[C + 1] << 8 | x[C + 2] << 16 | x[C + 3] << 24) >>> 0;
  }
  function Se(x, C, E) {
    x[C] = 255 & E, x[C + 1] = E >> 8 & 255, x[C + 2] = E >> 16 & 255, x[C + 3] = E >> 24 & 255;
  }
  function he(x) {
    let C = "";
    for (let W = 0; W < x.length; W += 32768) C += String.fromCharCode(...x.subarray(W, W + 32768));
    if (typeof btoa == "function") return btoa(C);
    const E = globalThis.Buffer;
    return E ? E.from(x).toString("base64") : C;
  }
}, "./metafile/wmf-to-svg": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.isWmfBinary = k, b.convertWmfToSvgDataUrl = function(A, B) {
    const _ = s(A, B);
    return _ ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(_)}` : null;
  }, b.convertWmfToSvg = s;
  const d = 2596720087, h = { EOF: 0, SETBKMODE: 258, SETBKCOLOR: 513, SETTEXTCOLOR: 521, SETTEXTALIGN: 302, SETWINDOWORG: 523, SETWINDOWEXT: 524, SETVIEWPORTORG: 525, SETVIEWPORTEXT: 526, MOVETO: 532, LINETO: 531, POLYLINE: 805, POLYGON: 804, RECTANGLE: 1051, ELLIPSE: 1048, CREATEPENINDIRECT: 762, CREATEBRUSHINDIRECT: 764, CREATEFONTINDIRECT: 763, SELECTOBJECT: 301, DELETEOBJECT: 496, TEXTOUT: 1313, EXTTEXTOUT: 2610 }, P = { 0: { type: "brush", color: "#ffffff" }, 1: { type: "brush", color: "#c0c0c0" }, 2: { type: "brush", color: "#808080" }, 3: { type: "brush", color: "#404040" }, 4: { type: "brush", color: "#000000" }, 5: { type: "brush", color: "none", nullBrush: !0 }, 6: { type: "pen", color: "#ffffff", width: 1 }, 7: { type: "pen", color: "#000000", width: 1 }, 8: { type: "pen", color: "none", width: 0, nullPen: !0 }, 18: { type: "brush", color: "#ffffff" }, 19: { type: "pen", color: "#000000", width: 1 } };
  function k(A) {
    if (!A || A.length < 22) return !1;
    const B = Y(A);
    return B.getUint32(0, !0) == d || A.length >= 18 && B.getUint16(0, !0) == 1 && B.getUint16(2, !0) == 9;
  }
  function s(A, B = {}) {
    if (!k(A)) return null;
    const _ = Y(A);
    let G = 0, re = { left: 0, top: 0, right: 1e3, bottom: 1e3 }, ae = 100, de = 100;
    if (_.getUint32(0, !0) == d && _.byteLength >= 22) {
      re = { left: _.getInt16(6, !0), top: _.getInt16(8, !0), right: _.getInt16(10, !0), bottom: _.getInt16(12, !0) };
      const j = Math.max(1, _.getUint16(14, !0) || 1440);
      ae = Math.max(1, re.right - re.left) / j * 25.4, de = Math.max(1, re.bottom - re.top) / j * 25.4, G = 22;
    }
    if (G + 18 > _.byteLength) return null;
    const se = _.getUint32(G + 6, !0), oe = Math.max(1, _.getUint16(G + 10, !0) || 16), fe = se > 0 ? 2 * se : _.byteLength;
    G += 18;
    const ge = Math.max(1, re.right - re.left), Ce = Math.max(1, re.bottom - re.top), K = (function(j) {
      return { windowOrg: { x: j.left, y: j.top }, windowExt: { x: Math.max(1, j.right - j.left), y: Math.max(1, j.bottom - j.top) }, viewportOrg: { x: 0, y: 0 }, viewportExt: null, currentPoint: { x: 0, y: 0 }, pen: { type: "pen", color: "#000000", width: 1 }, brush: { type: "brush", color: "#ffffff", nullBrush: !0 }, font: { type: "font", family: "Times New Roman", size: 12, weight: 400, italic: !1, underline: !1, strike: !1, charset: 0 }, textColor: "#000000", bkColor: "#ffffff", bkMode: 1, textAlign: 0 };
    })(re), we = new Array(oe).fill(null), Se = [];
    let he = 0, x = 0;
    const C = B.maxRecords ?? 1e4, E = B.maxShapes ?? 5e4, W = Math.min(_.byteLength, fe), U = (j) => {
      !j || he >= E || (Se.push(j), he++);
    };
    for (; G + 6 <= W && x++ < C; ) {
      const j = _.getUint32(G, !0), J = _.getUint16(G + 4, !0), V = G + 2 * j;
      if (j < 3 || V > _.byteLength) break;
      const z = G + 6;
      switch (J) {
        case h.EOF:
          G = W;
          break;
        case h.SETBKMODE:
          K.bkMode = g(_, z);
          break;
        case h.SETBKCOLOR:
          K.bkColor = L(T(_, z));
          break;
        case h.SETTEXTCOLOR:
          K.textColor = L(T(_, z));
          break;
        case h.SETTEXTALIGN:
          K.textAlign = p(_, z);
          break;
        case h.SETWINDOWORG:
          K.windowOrg = u(_, z);
          break;
        case h.SETWINDOWEXT:
          K.windowExt = u(_, z), ae && de || (ae = Math.max(1, Math.abs(K.windowExt.x)) / 100, de = Math.max(1, Math.abs(K.windowExt.y)) / 100);
          break;
        case h.SETVIEWPORTORG:
          K.viewportOrg = u(_, z);
          break;
        case h.SETVIEWPORTEXT:
          K.viewportExt = u(_, z);
          break;
        case h.CREATEPENINDIRECT:
          f(we, R(_, z, V));
          break;
        case h.CREATEBRUSHINDIRECT:
          f(we, $(_, z, V));
          break;
        case h.CREATEFONTINDIRECT:
          f(we, F(_, z, V));
          break;
        case h.SELECTOBJECT: {
          const ne = p(_, z), q = ne >= 32768 ? P[32767 & ne] : we[ne];
          q?.type == "pen" ? K.pen = { ...q } : q?.type == "brush" ? K.brush = { ...q } : q?.type == "font" && (K.font = { ...q });
          break;
        }
        case h.DELETEOBJECT: {
          const ne = p(_, z);
          ne < we.length && (we[ne] = null);
          break;
        }
        case h.MOVETO:
          K.currentPoint = v(K, u(_, z));
          break;
        case h.LINETO: {
          const ne = v(K, u(_, z));
          U(`<path d="M ${D(K.currentPoint.x)} ${D(K.currentPoint.y)} L ${D(ne.x)} ${D(ne.y)}" ${r(K)}/>`), K.currentPoint = ne;
          break;
        }
        case h.POLYLINE:
        case h.POLYGON:
          e(_, z, V, J == h.POLYGON, K, U);
          break;
        case h.RECTANGLE:
          t(_, z, K, U, !1);
          break;
        case h.ELLIPSE:
          t(_, z, K, U, !0);
          break;
        case h.TEXTOUT:
          a(_, z, V, K, U);
          break;
        case h.EXTTEXTOUT:
          n(_, z, V, K, U);
      }
      G = V;
    }
    return Se.length ? `<svg xmlns="http://www.w3.org/2000/svg" width="${D(ae)}mm" height="${D(de)}mm" viewBox="${D(re.left)} ${D(re.top)} ${D(ge)} ${D(Ce)}" preserveAspectRatio="xMidYMid meet" data-docx-metafile="wmf">${Se.join("")}</svg>` : (function(j, J, V, z, ne) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${D(z)}mm" height="${D(ne)}mm" viewBox="${D(V.left)} ${D(V.top)} ${D(j)} ${D(J)}" preserveAspectRatio="xMidYMid meet" data-docx-metafile="wmf"><rect x="${D(V.left)}" y="${D(V.top)}" width="${D(j)}" height="${D(J)}" fill="none" stroke="#999" stroke-width="1"/><text x="${D(V.left + j / 2)}" y="${D(V.top + J / 2)}" text-anchor="middle" font-size="12" fill="#666">${Q("Unsupported WMF image")}</text></svg>`;
    })(ge, Ce, re, ae, de);
  }
  function v(A, B) {
    const _ = A.viewportExt ?? A.windowExt, G = M(_.x, A.windowExt.x), re = M(_.y, A.windowExt.y);
    return { x: A.viewportOrg.x + (B.x - A.windowOrg.x) * G, y: A.viewportOrg.y + (B.y - A.windowOrg.y) * re };
  }
  function S(A, B) {
    const _ = A.viewportExt ?? A.windowExt;
    return Math.abs(B * M(_.x, A.windowExt.x));
  }
  function M(A, B) {
    return B ? A / B : 1;
  }
  function R(A, B, _) {
    const G = p(A, B), re = B + 4 < _ ? Math.abs(g(A, B + 2)) : 1, ae = B + 6 < _ ? Math.abs(g(A, B + 4)) : 0;
    return { type: "pen", color: B + 10 <= _ ? L(T(A, B + 6)) : "#000000", width: Math.max(1, re, ae), nullPen: (15 & G) == 5 };
  }
  function $(A, B, _) {
    const G = p(A, B);
    return { type: "brush", color: B + 6 <= _ ? L(T(A, B + 2)) : "#ffffff", nullBrush: G == 1 || G == 5 };
  }
  function F(A, B, _) {
    const G = g(A, B), re = g(A, B + 2), ae = g(A, B + 8) || 400, de = y(A, B + 10) != 0, se = y(A, B + 11) != 0, oe = y(A, B + 12) != 0, fe = y(A, B + 13);
    return { type: "font", family: (Ce = (function(K, we, Se) {
      let he = "";
      for (let x = 0; x < Se && we + x < K.byteLength; x++) {
        const C = K.getUint8(we + x);
        if (C == 0) break;
        he += String.fromCharCode(C);
      }
      return he;
    })(A, B + 18, Math.max(0, Math.min(32, _ - B - 18))), (Ce ?? "").replace(/[^\x20-\x7e]/g, "").trim() || "Times New Roman"), size: Math.max(1, Math.abs(G || re || 12)), weight: ae, italic: de, underline: se, strike: oe, charset: fe };
    var Ce;
  }
  function e(A, B, _, G, re, ae) {
    const de = p(A, B);
    let se = B + 2;
    const oe = [];
    for (let fe = 0; fe < de && se + 4 <= _; fe++, se += 4) oe.push(v(re, { x: g(A, se), y: g(A, se + 2) }));
    oe.length && (ae(`<path d="${oe.map((fe, ge) => `${ge == 0 ? "M" : "L"} ${D(fe.x)} ${D(fe.y)}`).join(" ") + (G ? " Z" : "")}" ${G ? i(re) : r(re)}/>`), re.currentPoint = oe[oe.length - 1]);
  }
  function t(A, B, _, G, re) {
    const ae = v(_, u(A, B)), de = v(_, u(A, B + 4)), se = Math.min(de.x, ae.x), oe = Math.min(de.y, ae.y), fe = Math.abs(ae.x - de.x), ge = Math.abs(ae.y - de.y);
    G(re ? `<ellipse cx="${D(se + fe / 2)}" cy="${D(oe + ge / 2)}" rx="${D(fe / 2)}" ry="${D(ge / 2)}" ${i(_)}/>` : `<rect x="${D(se)}" y="${D(oe)}" width="${D(fe)}" height="${D(ge)}" ${i(_)}/>`);
  }
  function a(A, B, _, G, re) {
    const ae = p(A, B), de = B + 2, se = de + ae + ae % 2;
    if (se + 4 > _) return;
    const oe = o(A, de, ae, G.font.charset), fe = g(A, se);
    m(oe, c(G, { x: g(A, se + 2), y: fe }), null, G, re), l(oe, null, G);
  }
  function n(A, B, _, G, re) {
    const ae = g(A, B), de = g(A, B + 2), se = p(A, B + 4);
    let oe = B + 8;
    if (6 & p(A, B + 6) && (oe += 8), oe + se > _) return;
    const fe = o(A, oe, se, G.font.charset);
    oe += se + se % 2;
    const ge = [];
    for (; oe + 2 <= _ && ge.length < se; ) ge.push(g(A, oe)), oe += 2;
    m(fe, c(G, { x: de, y: ae }), ge.length ? ge : null, G, re), l(fe, ge.length ? ge : null, G);
  }
  function c(A, B) {
    return 1 & A.textAlign ? { ...A.currentPoint } : v(A, B);
  }
  function l(A, B, _) {
    if (!(1 & _.textAlign)) return;
    const G = B?.length ? B.reduce((re, ae) => re + ae, 0) : A.length * _.font.size * 0.5;
    _.currentPoint = { x: _.currentPoint.x + S(_, G), y: _.currentPoint.y };
  }
  function m(A, B, _, G, re) {
    if (!A) return;
    const ae = G.font, de = Math.max(1, (function(K, we) {
      const Se = K.viewportExt ?? K.windowExt;
      return Math.abs(we * M(Se.y, K.windowExt.y));
    })(G, ae.size)), se = [`font-family:${w(ae.family)}`, `font-size:${D(de)}px`, `font-weight:${ae.weight >= 600 ? "700" : ae.weight}`, "font-style:" + (ae.italic ? "italic" : "normal")], oe = [];
    ae.underline && oe.push("underline"), ae.strike && oe.push("line-through"), oe.length && se.push(`text-decoration:${oe.join(" ")}`);
    const fe = [`x="${D(B.x)}"`, `y="${D(B.y)}"`, `fill="${X(G.textColor)}"`, `style="${X(se.join(";"))}"`, `dominant-baseline="${24 & ~G.textAlign ? "text-before-edge" : "alphabetic"}"`, (ge = G.textAlign, 6 & ge ? 'text-anchor="end"' : 2 & ge ? 'text-anchor="middle"' : "")].filter(Boolean).join(" ");
    var ge;
    if (!_ || _.length == 0) return void re(`<text ${fe}>${Q(A)}</text>`);
    let Ce = B.x;
    re(`<text ${fe}>${Array.from(A).map((K, we) => {
      const Se = `<tspan x="${D(Ce)}">${Q(K)}</tspan>`;
      return Ce += S(G, _[we] ?? 0), Se;
    }).join("")}</text>`);
  }
  function f(A, B) {
    let _ = A.findIndex((G) => G == null);
    _ < 0 ? A.push(B) : A[_] = B;
  }
  function i(A) {
    return `${(function(B) {
      return B.brush?.nullBrush ? 'fill="none"' : `fill="${X(B.brush?.color ?? "#ffffff")}"`;
    })(A)} ${r(A)}`;
  }
  function r(A) {
    return A.pen?.nullPen ? 'stroke="none"' : `fill="none" stroke="${X(A.pen?.color ?? "#000000")}" stroke-width="${D(Math.max(0.5, S(A, A.pen?.width ?? 1)))}"`;
  }
  function o(A, B, _, G) {
    const re = new Uint8Array(A.buffer, A.byteOffset + B, Math.max(0, Math.min(_, A.byteLength - B))), ae = G == 2 ? "symbol" : G == 134 ? "gb18030" : "windows-1252";
    try {
      return new TextDecoder(ae).decode(re).replace(/\0+$/g, "");
    } catch {
      let de = "";
      for (const se of re) de += String.fromCharCode(se);
      return de.replace(/\0+$/g, "");
    }
  }
  function u(A, B) {
    return { y: g(A, B), x: g(A, B + 2) };
  }
  function y(A, B) {
    return B < A.byteLength ? A.getUint8(B) : 0;
  }
  function p(A, B) {
    return B + 2 <= A.byteLength ? A.getUint16(B, !0) : 0;
  }
  function g(A, B) {
    return B + 2 <= A.byteLength ? A.getInt16(B, !0) : 0;
  }
  function T(A, B) {
    return B + 4 <= A.byteLength ? A.getUint32(B, !0) : 0;
  }
  function w(A) {
    const B = (A || "Times New Roman").replace(/["\\]/g, "");
    return /[\s,]/.test(B) ? `"${B}"` : B;
  }
  function L(A) {
    const B = A >> 8 & 255, _ = A >> 16 & 255;
    return `#${I(255 & A)}${I(B)}${I(_)}`;
  }
  function I(A) {
    return Math.max(0, Math.min(255, A)).toString(16).padStart(2, "0");
  }
  function Y(A) {
    return new DataView(A.buffer, A.byteOffset, A.byteLength);
  }
  function D(A) {
    return Number.isFinite(A) ? `${Math.round(1e3 * A) / 1e3}` : "0";
  }
  function Q(A) {
    return String(A ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function X(A) {
    return Q(A).replace(/"/g, "&quot;");
  }
}, "./notes/elements": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.WmlEndnote = b.WmlFootnote = b.WmlBaseNote = void 0;
  const d = N("../document/dom");
  class h {
  }
  b.WmlBaseNote = h, b.WmlFootnote = class extends h {
    constructor() {
      super(...arguments), this.type = d.DomType.Footnote;
    }
  }, b.WmlEndnote = class extends h {
    constructor() {
      super(...arguments), this.type = d.DomType.Endnote;
    }
  };
}, "./notes/parts": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.EndnotesPart = b.FootnotesPart = b.BaseNotePart = void 0;
  const d = N("../common/part"), h = N("./elements");
  class P extends d.Part {
    constructor(s, v, S) {
      super(s, v), this._documentParser = S;
    }
  }
  b.BaseNotePart = P, b.FootnotesPart = class extends P {
    constructor(k, s, v) {
      super(k, s, v);
    }
    parseXml(k) {
      this.notes = this._documentParser.parseNotes(k, "footnote", h.WmlFootnote);
    }
  }, b.EndnotesPart = class extends P {
    constructor(k, s, v) {
      super(k, s, v);
    }
    parseXml(k) {
      this.notes = this._documentParser.parseNotes(k, "endnote", h.WmlEndnote);
    }
  };
}, "./numbering/numbering-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.NumberingPart = void 0;
  const d = N("../common/part"), h = N("./numbering");
  class P extends d.Part {
    constructor(s, v, S) {
      super(s, v), this._documentParser = S;
    }
    parseXml(s) {
      Object.assign(this, (0, h.parseNumberingPart)(s, this._package.xmlParser)), this.domNumberings = this._documentParser.parseNumberingFile(s);
    }
  }
  b.NumberingPart = P;
}, "./numbering/numbering": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseNumberingPart = function(R, $) {
    let F = { numberings: [], abstractNumberings: [], bulletPictures: [] };
    for (let e of $.elements(R)) switch (e.localName) {
      case "num":
        F.numberings.push(P(e, $));
        break;
      case "abstractNum":
        F.abstractNumberings.push(k(e, $));
        break;
      case "numPicBullet":
        F.bulletPictures.push(S(e, $));
    }
    return F;
  }, b.parseNumbering = P, b.parseAbstractNumbering = k, b.parseNumberingLevel = s, b.parseNumberingLevelOverrride = v, b.parseNumberingBulletPicture = S;
  const d = N("../document/paragraph"), h = N("../document/run");
  function P(R, $) {
    let F = { id: $.attr(R, "numId"), overrides: [] };
    for (let e of $.elements(R)) switch (e.localName) {
      case "abstractNumId":
        F.abstractId = $.attr(e, "val");
        break;
      case "lvlOverride":
        F.overrides.push(v(e, $));
    }
    return F;
  }
  function k(R, $) {
    let F = { id: $.attr(R, "abstractNumId"), levels: [] };
    for (let e of $.elements(R)) switch (e.localName) {
      case "name":
        F.name = $.attr(e, "val");
        break;
      case "multiLevelType":
        F.multiLevelType = $.attr(e, "val");
        break;
      case "numStyleLink":
        F.numberingStyleLink = $.attr(e, "val");
        break;
      case "styleLink":
        F.styleLink = $.attr(e, "val");
        break;
      case "lvl":
        F.levels.push(s(e, $));
    }
    return F;
  }
  function s(R, $) {
    let F = { level: $.intAttr(R, "ilvl") };
    for (let e of $.elements(R)) switch (e.localName) {
      case "start":
        F.start = $.attr(e, "val");
        break;
      case "lvlRestart":
        F.restart = $.intAttr(e, "val");
        break;
      case "numFmt":
        F.format = $.attr(e, "val");
        break;
      case "lvlText":
        F.text = $.attr(e, "val");
        break;
      case "lvlJc":
        F.justification = $.attr(e, "val");
        break;
      case "lvlPicBulletId":
        F.bulletPictureId = $.attr(e, "val");
        break;
      case "pStyle":
        F.paragraphStyle = $.attr(e, "val");
        break;
      case "pPr":
        F.paragraphProps = (0, d.parseParagraphProperties)(e, $);
        break;
      case "rPr":
        F.runProps = (0, h.parseRunProperties)(e, $);
    }
    return F;
  }
  function v(R, $) {
    let F = { level: $.intAttr(R, "ilvl") };
    for (let e of $.elements(R)) switch (e.localName) {
      case "startOverride":
        F.start = $.intAttr(e, "val");
        break;
      case "lvl":
        F.numberingLevel = s(e, $);
    }
    return F;
  }
  function S(R, $) {
    var F = $.attr(R, "numPicBulletId"), e = $.element(R, "pict"), t = e && $.element(e, "shape"), a = t && $.element(t, "imagedata");
    if (a) return { id: F, referenceId: $.attr(a, "id"), style: $.attr(t, "style") };
    var n = $.element(R, "drawing"), c = n && M(n, "blip", $);
    return c ? { id: F, referenceId: $.attr(c, "embed") ?? $.attr(c, "link"), style: null } : null;
  }
  function M(R, $, F) {
    for (const e of F.elements(R)) {
      if (e.localName == $) return e;
      const t = M(e, $, F);
      if (t) return t;
    }
    return null;
  }
}, "./parser/xml-parser": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.XmlParser = void 0, b.parseXmlString = function(k, s = !1) {
    var v;
    s && (k = k.replace(/<[?].*[?]>/, "")), k = (v = k).charCodeAt(0) === 65279 ? v.substring(1) : v;
    const S = new DOMParser().parseFromString(k, "application/xml"), M = (R = S, R.getElementsByTagName("parsererror")[0]?.textContent);
    var R;
    if (M) throw new Error(M);
    return S;
  }, b.serializeXmlString = function(k) {
    return new XMLSerializer().serializeToString(k);
  };
  const d = N("../document/common");
  class h {
    elements(s, v = null) {
      const S = [];
      for (let M = 0, R = s.childNodes.length; M < R; M++) {
        let $ = s.childNodes.item(M);
        $.nodeType != 1 || v != null && $.localName != v || S.push($);
      }
      return S;
    }
    element(s, v) {
      for (let S = 0, M = s.childNodes.length; S < M; S++) {
        let R = s.childNodes.item(S);
        if (R.nodeType == 1 && R.localName == v) return R;
      }
      return null;
    }
    elementAttr(s, v, S) {
      var M = this.element(s, v);
      return M ? this.attr(M, S) : void 0;
    }
    attrs(s) {
      return Array.from(s.attributes);
    }
    attr(s, v) {
      for (let S = 0, M = s.attributes.length; S < M; S++) {
        let R = s.attributes.item(S);
        if (R.localName == v) return R.value;
      }
      return null;
    }
    intAttr(s, v, S = null) {
      var M = this.attr(s, v);
      return M != null && M !== "" ? parseInt(M, 10) : S;
    }
    hexAttr(s, v, S = null) {
      var M = this.attr(s, v);
      return M != null && M !== "" ? parseInt(M, 16) : S;
    }
    floatAttr(s, v, S = null) {
      var M = this.attr(s, v);
      return M != null && M !== "" ? parseFloat(M) : S;
    }
    boolAttr(s, v, S = null) {
      return (0, d.convertBoolean)(this.attr(s, v), S);
    }
    lengthAttr(s, v, S = d.LengthUsage.Dxa) {
      return (0, d.convertLength)(this.attr(s, v), S);
    }
  }
  b.XmlParser = h;
  const P = new h();
  b.default = P;
}, "./settings/settings-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.SettingsPart = void 0;
  const d = N("../common/part"), h = N("./settings");
  class P extends d.Part {
    constructor(s, v) {
      super(s, v);
    }
    parseXml(s) {
      this.settings = (0, h.parseSettings)(s, this._package.xmlParser);
    }
  }
  b.SettingsPart = P;
}, "./settings/settings": function(N, Z, b) {
  function d(h, P) {
    var k = { defaultNoteIds: [] };
    for (let s of P.elements(h)) switch (s.localName) {
      case "numFmt":
        k.nummeringFormat = P.attr(s, "val");
        break;
      case "footnote":
      case "endnote":
        k.defaultNoteIds.push(P.attr(s, "id"));
    }
    return k;
  }
  Object.defineProperty(b, "__esModule", { value: !0 }), b.parseSettings = function(h, P) {
    var k = {};
    for (let s of P.elements(h)) switch (s.localName) {
      case "defaultTabStop":
        k.defaultTabStop = P.lengthAttr(s, "val");
        break;
      case "footnotePr":
        k.footnoteProps = d(s, P);
        break;
      case "endnotePr":
        k.endnoteProps = d(s, P);
        break;
      case "autoHyphenation":
        k.autoHyphenation = P.boolAttr(s, "val");
        break;
      case "kinsoku":
        k.kinsoku = P.boolAttr(s, "val", !0);
        break;
      case "overflowPunct":
        k.overflowPunctuation = P.boolAttr(s, "val", !0);
        break;
      case "topLinePunct":
        k.topLinePunctuation = P.boolAttr(s, "val", !0);
        break;
      case "autoSpaceDE":
        k.autoSpaceDE = P.boolAttr(s, "val", !0);
        break;
      case "autoSpaceDN":
        k.autoSpaceDN = P.boolAttr(s, "val", !0);
        break;
      case "noLineBreaksAfter":
        k.noLineBreaksAfter = P.attr(s, "val") || s.textContent || "";
        break;
      case "noLineBreaksBefore":
        k.noLineBreaksBefore = P.attr(s, "val") || s.textContent || "";
        break;
      case "evenAndOddHeaders":
        k.evenAndOddHeaders = P.boolAttr(s, "val", !0);
        break;
      case "splitPgBreakAndParaMark":
        k.splitPageBreakAndParagraphMark = P.boolAttr(s, "val", !0);
        break;
      case "compat":
        for (const v of P.elements(s)) v.localName == "adjustLineHeightInTable" && (k.adjustLineHeightInTable = P.boolAttr(v, "val", !0));
    }
    return k;
  }, b.parseNoteProperties = d;
}, "./styles/styles-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.StylesPart = void 0;
  const d = N("../common/part");
  class h extends d.Part {
    constructor(k, s, v) {
      super(k, s), this._documentParser = v;
    }
    parseXml(k) {
      this.styles = this._documentParser.parseStylesFile(k);
    }
  }
  b.StylesPart = h;
}, "./theme/theme-part": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.ThemePart = void 0;
  const d = N("../common/part"), h = N("./theme");
  class P extends d.Part {
    constructor(s, v) {
      super(s, v);
    }
    parseXml(s) {
      this.theme = (0, h.parseTheme)(s, this._package.xmlParser);
    }
  }
  b.ThemePart = P;
}, "./theme/theme": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.DmlTheme = void 0, b.themeScriptForLanguage = function(s) {
    const v = String(s ?? "").trim().replace(/_/g, "-").toLowerCase(), S = v.split("-")[0];
    return S == "zh" ? /(?:^|-)hant(?:-|$)|-(?:tw|hk|mo)(?:-|$)/.test(v) ? "Hant" : "Hans" : { ja: "Jpan", ko: "Hang", ar: "Arab", fa: "Arab", ur: "Arab", he: "Hebr", yi: "Hebr", th: "Thai", vi: "Viet", hi: "Deva", bn: "Beng", gu: "Gujr", kn: "Knda", pa: "Guru", ta: "Taml", te: "Telu", ml: "Mlym", or: "Orya", si: "Sinh", km: "Khmr", lo: "Laoo", my: "Mymr", mn: "Mong" }[S] ?? "";
  }, b.parseTheme = function(s, v) {
    var S = new d(), M = v.element(s, "themeElements");
    for (let R of v.elements(M)) switch (R.localName) {
      case "clrScheme":
        S.colorScheme = h(R, v);
        break;
      case "fontScheme":
        S.fontScheme = P(R, v);
    }
    return S;
  }, b.parseColorScheme = h, b.parseFontScheme = P, b.parseFontInfo = k;
  class d {
  }
  function h(s, v) {
    var S = { name: v.attr(s, "name"), colors: {} };
    for (let $ of v.elements(s)) {
      var M = v.element($, "srgbClr"), R = v.element($, "sysClr");
      M ? S.colors[$.localName] = v.attr(M, "val") : R && (S.colors[$.localName] = v.attr(R, "lastClr"));
    }
    return S;
  }
  function P(s, v) {
    var S = { name: v.attr(s, "name") };
    for (let M of v.elements(s)) switch (M.localName) {
      case "majorFont":
        S.majorFont = k(M, v);
        break;
      case "minorFont":
        S.minorFont = k(M, v);
    }
    return S;
  }
  function k(s, v) {
    const S = {};
    for (const M of v.elements(s).filter((R) => R.localName == "font")) {
      const R = v.attr(M, "script"), $ = v.attr(M, "typeface");
      R && $ && (S[R] = $);
    }
    return { latinTypeface: v.elementAttr(s, "latin", "typeface"), eaTypeface: v.elementAttr(s, "ea", "typeface"), csTypeface: v.elementAttr(s, "cs", "typeface"), scriptTypefaces: S };
  }
  b.DmlTheme = d;
}, "./utils": function(N, Z, b) {
  function d(P) {
    return /^[^"'].*\s.*[^"']$/.test(P) ? `'${P}'` : P;
  }
  function h(P) {
    return P && typeof P == "object" && !Array.isArray(P);
  }
  Object.defineProperty(b, "__esModule", { value: !0 }), b.escapeClassName = function(P) {
    return P?.replace(/[ .]+/g, "-").replace(/[&]+/g, "and").toLowerCase();
  }, b.encloseFontFamily = d, b.isEastAsianFontFamily = function(P) {
    const k = String(P ?? "").normalize("NFKC").toLowerCase();
    return /simsun|nsimsun|宋体|宋體|songti|mincho|明朝|明體|mingliu|pmingliu|batang|명조|kaiti|楷体|楷體|stkaiti|simhei|黑体|黑體|heiti|dengxian|等线|等線|yahei|ゴシック|(?:^|\s)(?:ms|yu)\s+p?gothic|meiryo|メイリオ|malgun|맑은/.test(k);
  }, b.eastAsianFontFamilyStack = function(P, k = "") {
    const s = String(P ?? "").trim();
    if (!s) return [];
    const v = s.normalize("NFKC").toLowerCase(), S = /mincho|明朝|ゴシック|(?:^|\s)(?:ms|yu)\s+p?gothic|meiryo|メイリオ/.test(v), M = ["Hans", "Hant", "Jpan", "Hang"].includes(k) ? k : S ? "Jpan" : k, R = [d(s)], $ = /simsun|nsimsun|宋体|宋體|songti|mincho|明朝|明體|mingliu|pmingliu|batang|명조/.test(v), F = /kaiti|楷体|楷體|stkaiti|kai/.test(v), e = /simhei|黑体|黑體|heiti|dengxian|等线|等線|yahei|gothic|ゴシック|malgun|맑은/.test(v);
    return $ ? M == "Hant" ? R.push("'Songti TC'", "'Microsoft JhengHei'", "'Noto Serif CJK TC'", "serif") : M == "Jpan" ? R.push("'Yu Mincho'", "'Hiragino Mincho ProN'", "'Noto Serif CJK JP'", "serif") : M == "Hang" ? R.push("Batang", "AppleMyungjo", "'Noto Serif CJK KR'", "serif") : R.push("'Songti SC'", "'Noto Serif CJK SC'", "serif") : F ? R.push("'Kaiti SC'", "STKaiti", "'Noto Serif CJK SC'", "serif") : e ? M == "Hant" ? R.push("'Microsoft JhengHei'", "'PingFang TC'", "'Noto Sans CJK TC'", "sans-serif") : M == "Jpan" ? R.push("'Yu Gothic'", "Meiryo", "'Noto Sans CJK JP'", "sans-serif") : M == "Hang" ? R.push("'Malgun Gothic'", "'Apple SD Gothic Neo'", "'Noto Sans CJK KR'", "sans-serif") : R.push("'Microsoft YaHei'", "'PingFang SC'", "'Noto Sans CJK SC'", "sans-serif") : M == "Hant" ? R.push("'PingFang TC'", "'Noto Sans CJK TC'", "sans-serif") : M == "Jpan" ? R.push("'Yu Gothic'", "Meiryo", "'Noto Sans CJK JP'", "sans-serif") : M == "Hang" ? R.push("'Apple SD Gothic Neo'", "'Noto Sans CJK KR'", "sans-serif") : R.push("'PingFang SC'", "'Noto Sans CJK SC'", "sans-serif"), [...new Set(R)];
  }, b.splitPath = function(P) {
    let k = P.lastIndexOf("/") + 1;
    return [k == 0 ? "" : P.substring(0, k), k == 0 ? P : P.substring(k)];
  }, b.resolvePath = function(P, k) {
    try {
      const s = "http://docx/";
      return new URL(P, s + k).toString().substring(s.length);
    } catch {
      return `${k}${P}`;
    }
  }, b.keyBy = function(P, k) {
    return P.reduce((s, v) => (s[k(v)] = v, s), {});
  }, b.blobToBase64 = function(P) {
    return new Promise((k, s) => {
      const v = new FileReader();
      v.onloadend = () => k(v.result), v.onerror = () => s(), v.readAsDataURL(P);
    });
  }, b.isObject = h, b.isString = function(P) {
    return typeof P == "string" || P instanceof String;
  }, b.mergeDeep = function P(k, ...s) {
    if (!s.length) return k;
    const v = s.shift();
    if (h(k) && h(v)) for (const S in v) h(v[S]) ? P(k[S] ?? (k[S] = {}), v[S]) : k[S] = v[S];
    return P(k, ...s);
  }, b.parseCssRules = function(P) {
    const k = {};
    for (const s of (P ?? "").split(";")) {
      const v = s.indexOf(":");
      if (v <= 0) continue;
      const S = s.substring(0, v).trim(), M = s.substring(v + 1).trim();
      S && (k[S] = M);
    }
    return k;
  }, b.formatCssRules = function(P) {
    return Object.entries(P ?? {}).map(([k, s]) => `${k}: ${s}`).join(";");
  }, b.asArray = function(P) {
    return Array.isArray(P) ? P : [P];
  }, b.clamp = function(P, k, s) {
    return k > P ? k : s < P ? s : P;
  };
}, "./vml/vml": function(N, Z, b) {
  var d = this && this.__importDefault || function(n) {
    return n && n.__esModule ? n : { default: n };
  };
  Object.defineProperty(b, "__esModule", { value: !0 }), b.VmlElement = void 0, b.parseVmlElement = function n(c, l) {
    var m = new v();
    switch (c.localName) {
      case "group":
        m.tagName = "g", m.isGroup = !0;
        break;
      case "rect":
        m.tagName = "rect", Object.assign(m.attrs, { width: "100%", height: "100%" });
        break;
      case "oval":
        m.tagName = "ellipse", Object.assign(m.attrs, { cx: "50%", cy: "50%", rx: "50%", ry: "50%" });
        break;
      case "line":
        m.tagName = "line";
        break;
      case "shape":
        m.tagName = "g";
        break;
      case "textbox":
        m.tagName = "foreignObject", Object.assign(m.attrs, { width: "100%", height: "100%" });
        break;
      default:
        return null;
    }
    for (const f of k.default.attrs(c)) switch (f.localName) {
      case "style":
        m.cssStyleText = f.value, m.cssStyle = (0, s.parseCssRules)(f.value);
        break;
      case "coordorigin":
        m.coordOrigin = t(f.value);
        break;
      case "coordsize":
        m.coordSize = t(f.value);
        break;
      case "fillcolor":
        m.attrs.fill = f.value;
        break;
      case "strokecolor":
        m.attrs.stroke = f.value;
        break;
      case "strokeweight":
        m.attrs["stroke-width"] = (0, h.convertLength)(f.value, h.LengthUsage.Point) ?? f.value;
        break;
      case "filled":
        f.value != "f" && f.value != "false" || (m.attrs.fill = "none");
        break;
      case "stroked":
        f.value != "f" && f.value != "false" || (m.attrs.stroke = "none");
        break;
      case "path":
        m.tagName = "path", m.attrs.d = a(f.value);
        break;
      case "from":
        const [i, r] = e(f.value);
        Object.assign(m.attrs, { x1: i, y1: r });
        break;
      case "to":
        const [o, u] = e(f.value);
        Object.assign(m.attrs, { x2: o, y2: u });
    }
    for (const f of k.default.elements(c)) switch (f.localName) {
      case "stroke":
        Object.assign(m.attrs, $(f));
        break;
      case "fill":
        Object.assign(m.attrs, F(f));
        break;
      case "imagedata":
        const i = k.default.attr(f, "id") ?? k.default.attr(f, "relid") ?? k.default.attr(f, "pict");
        i && (m.tagName = "image", Object.assign(m.attrs, S(f)), m.imageHref = { id: i, title: k.default.attr(f, "title") });
        break;
      case "txbxContent":
        m.children.push(...l.parseBodyElements(f));
        break;
      default:
        const r = n(f, l);
        r && m.children.push(r);
    }
    return m.cssStyle?.position == "absolute" && (m.props = { anchorPosition: { horizontal: { relative: m.cssStyle["mso-position-horizontal-relative"] ?? "paragraph" }, vertical: { relative: m.cssStyle["mso-position-vertical-relative"] ?? "paragraph" } } }), m;
  };
  const h = N("../document/common"), P = N("../document/dom"), k = d(N("../parser/xml-parser")), s = N("../utils");
  class v extends P.OpenXmlElementBase {
    constructor() {
      super(...arguments), this.type = P.DomType.VmlElement, this.attrs = {};
    }
  }
  function S(n) {
    const c = M(k.default.attr(n, "cropleft")), l = M(k.default.attr(n, "croptop")), m = M(k.default.attr(n, "cropright")), f = M(k.default.attr(n, "cropbottom")), i = Math.max(1e-4, 1 - c - m), r = Math.max(1e-4, 1 - l - f), o = { x: R(-c / i), y: R(-l / r), width: R(1 / i), height: R(1 / r) };
    return (c || l || m || f) && (o.preserveAspectRatio = "none"), o;
  }
  function M(n) {
    if (!n) return 0;
    const c = String(n).trim();
    if (!c) return 0;
    let l;
    return l = /^-?\d+(\.\d+)?f$/i.test(c) ? parseFloat(c.slice(0, -1)) / 65536 : c.endsWith("%") ? parseFloat(c) / 100 : parseFloat(c), Number.isFinite(l) ? Math.max(0, Math.min(0.9999, l)) : 0;
  }
  function R(n) {
    return Math.round(1e5 * n) / 1e3 + "%";
  }
  function $(n) {
    const c = {}, l = k.default.attr(n, "color"), m = k.default.attr(n, "weight"), f = k.default.attr(n, "on");
    return f == "f" || f == "false" ? c.stroke = "none" : l && (c.stroke = l), c["stroke-width"] = m ? (0, h.convertLength)(m, h.LengthUsage.Point) ?? m : "1px", c;
  }
  function F(n) {
    const c = {}, l = k.default.attr(n, "color") ?? k.default.attr(n, "color2"), m = k.default.attr(n, "on"), f = k.default.attr(n, "opacity");
    return m == "f" || m == "false" ? c.fill = "none" : l && (c.fill = l), f && (c["fill-opacity"] = f.endsWith("%") ? "" + parseFloat(f) / 100 : f), c;
  }
  function e(n) {
    return n.split(",");
  }
  function t(n) {
    const [c, l] = e(n).map((m) => parseFloat(m));
    return [Number.isFinite(c) ? c : 0, Number.isFinite(l) ? l : 0];
  }
  function a(n) {
    return n.replace(/([mlxe])|([-\d]+)|([,])/g, (c) => /[-\d]/.test(c) || /[ml,]/.test(c) ? c : "");
  }
  b.VmlElement = v;
}, "./word-document": function(N, Z, b) {
  Object.defineProperty(b, "__esModule", { value: !0 }), b.WordDocument = void 0, b.deobfuscate = u;
  const d = N("./common/relationship"), h = N("./font-table/font-table"), P = N("./common/open-xml-package"), k = N("./document/document-part"), s = N("./utils"), v = N("./numbering/numbering-part"), S = N("./styles/styles-part"), M = N("./header-footer/parts"), R = N("./document-props/extended-props-part"), $ = N("./document-props/core-props-part"), F = N("./theme/theme-part"), e = N("./notes/parts"), t = N("./settings/settings-part"), a = N("./document-props/custom-props-part"), n = N("./comments/comments-part"), c = N("./comments/comments-extended-part"), l = N("./parser/xml-parser"), m = N("./metafile/emf-to-svg"), f = N("./metafile/wmf-to-svg"), i = [{ type: d.RelationshipTypes.OfficeDocument, target: "word/document.xml" }, { type: d.RelationshipTypes.ExtendedProperties, target: "docProps/app.xml" }, { type: d.RelationshipTypes.CoreProperties, target: "docProps/core.xml" }, { type: d.RelationshipTypes.CustomProperties, target: "docProps/custom.xml" }];
  class r {
    constructor() {
      this.parts = [], this.partsMap = {}, this.contentTypes = [], this._snapshotAssetDataUrls = null, this._snapshotTextParts = null;
    }
    static fromSnapshot(p, g) {
      const T = new r();
      T._options = g, T.rels = p.rels ?? [], T.contentTypes = p.contentTypes ?? [], T.parts = [], T.partsMap = {}, T._snapshotAssetDataUrls = p.assetDataUrls ?? {}, T._snapshotTextParts = p.textParts ?? {}, T._package = { load: (w) => Promise.resolve(T._snapshotTextParts?.[o(w)] ?? null), parseXmlDocument: (w) => (0, l.parseXmlString)(w, g?.trimXmlDeclaration ?? !0), get: (w) => T._snapshotTextParts?.[o(w)] != null ? {} : null };
      for (const w of p.parts ?? []) {
        const L = T.restoreSnapshotPart(w);
        L && (T.parts.push(L), T.partsMap[L.path] = L);
      }
      return T;
    }
    static async load(p, g, T) {
      var w = new r();
      return w._options = T, w._parser = g, w._package = await P.OpenXmlPackage.load(p, T), w.rels = await w._package.loadRelationships(), w.contentTypes = await w._package.loadContentTypes(), await Promise.all(i.map((L) => {
        const I = w.rels.find((Y) => Y.type === L.type) ?? L;
        return w.loadRelationshipPart(I.target, I.type);
      })), w;
    }
    restoreSnapshotPart(p) {
      const g = { path: p.path, rels: p.rels ?? [] };
      switch (Object.assign(g, p.data ?? {}), p.kind) {
        case "document":
          this.documentPart = g;
          break;
        case "fontTable":
          this.fontTablePart = g;
          break;
        case "numbering":
          this.numberingPart = g;
          break;
        case "styles":
          this.stylesPart = g;
          break;
        case "theme":
          this.themePart = g;
          break;
        case "footnotes":
          this.footnotesPart = g;
          break;
        case "endnotes":
          this.endnotesPart = g;
          break;
        case "coreProps":
          this.corePropsPart = g;
          break;
        case "extendedProps":
          this.extendedPropsPart = g;
          break;
        case "settings":
          this.settingsPart = g;
          break;
        case "comments":
          g.commentMap = (0, s.keyBy)(g.comments ?? [], (T) => T.id), this.commentsPart = g;
          break;
        case "commentsExtended":
          g.commentMap = (0, s.keyBy)(g.comments ?? [], (T) => T.paraId), this.commentsExtendedPart = g;
      }
      return g;
    }
    async createSnapshot() {
      const p = { rels: this.rels ?? [], contentTypes: this.contentTypes ?? [], parts: this.parts.map((g) => this.snapshotPart(g)).filter(Boolean), assetDataUrls: {}, textParts: {} };
      return await this.preloadSnapshotRelationshipTargets(p), p;
    }
    snapshotPart(p) {
      const g = p;
      let T = "part", w = {};
      if (p === this.documentPart) T = "document", w = { body: g.body };
      else if (p === this.fontTablePart) T = "fontTable", w = { fonts: g.fonts };
      else if (p === this.numberingPart) T = "numbering", w = { numberings: g.numberings, abstractNumberings: g.abstractNumberings, bulletPictures: g.bulletPictures, domNumberings: g.domNumberings };
      else if (p === this.stylesPart) T = "styles", w = { styles: g.styles };
      else if (p === this.themePart) T = "theme", w = { theme: g.theme };
      else if (p === this.footnotesPart) T = "footnotes", w = { notes: g.notes };
      else if (p === this.endnotesPart) T = "endnotes", w = { notes: g.notes };
      else if (p === this.corePropsPart) T = "coreProps", w = { props: g.props };
      else if (p === this.extendedPropsPart) T = "extendedProps", w = { props: g.props };
      else if (p === this.settingsPart) T = "settings", w = { settings: g.settings };
      else if (p === this.commentsPart) T = "comments", w = { comments: g.comments };
      else if (p === this.commentsExtendedPart) T = "commentsExtended", w = { comments: g.comments };
      else {
        if (!g.rootElement) return null;
        T = g.rootElement.type === "header" ? "header" : "footer", w = { rootElement: g.rootElement };
      }
      return { kind: T, path: p.path, rels: p.rels ?? [], data: w };
    }
    async preloadSnapshotRelationshipTargets(p) {
      const g = /* @__PURE__ */ new Set(), T = (w) => {
        for (const L of w?.rels ?? []) {
          if (!L || L.targetMode === "External") continue;
          const I = o(this.resolveRelationshipTarget(w, L));
          I && !g.has(I) && g.add(I);
        }
      };
      for (const w of this.parts) T(w);
      for (const w of g) {
        if (this.partsMap[w]) continue;
        const L = w.toLowerCase(), I = /\.(xml|rels|html?|txt)$/i.test(L);
        try {
          if (I) {
            const Y = await this._package.load(w, "string");
            Y != null && (p.textParts[w] = Y);
          } else {
            const Y = await this.loadPackageAssetDataUrl(w);
            Y && (p.assetDataUrls[w] = Y);
          }
        } catch (Y) {
          this._options?.debug && console.warn(`docx-preview: unable to preload relationship target ${w}`, Y);
        }
      }
    }
    blobWithContentType(p, g) {
      if (!p) return null;
      if (g) {
        const T = this.contentTypes.find((w) => w.partName === g || w.extension && g.endsWith(`.${w.extension}`));
        return T ? new Blob([p], { type: T.contentType }) : p;
      }
      return p;
    }
    save(p = "blob") {
      return this._package.save(p);
    }
    async loadRelationshipPart(p, g) {
      if (this.partsMap[p]) return this.partsMap[p];
      if (!this._package.get(p)) return null;
      let T = null;
      switch (g) {
        case d.RelationshipTypes.OfficeDocument:
          this.documentPart = T = new k.DocumentPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.FontTable:
          this.fontTablePart = T = new h.FontTablePart(this._package, p);
          break;
        case d.RelationshipTypes.Numbering:
          this.numberingPart = T = new v.NumberingPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.Styles:
          this.stylesPart = T = new S.StylesPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.Theme:
          this.themePart = T = new F.ThemePart(this._package, p);
          break;
        case d.RelationshipTypes.Footnotes:
          this.footnotesPart = T = new e.FootnotesPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.Endnotes:
          this.endnotesPart = T = new e.EndnotesPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.Footer:
          T = new M.FooterPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.Header:
          T = new M.HeaderPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.CoreProperties:
          this.corePropsPart = T = new $.CorePropsPart(this._package, p);
          break;
        case d.RelationshipTypes.ExtendedProperties:
          this.extendedPropsPart = T = new R.ExtendedPropsPart(this._package, p);
          break;
        case d.RelationshipTypes.CustomProperties:
          T = new a.CustomPropsPart(this._package, p);
          break;
        case d.RelationshipTypes.Settings:
          this.settingsPart = T = new t.SettingsPart(this._package, p);
          break;
        case d.RelationshipTypes.Comments:
          this.commentsPart = T = new n.CommentsPart(this._package, p, this._parser);
          break;
        case d.RelationshipTypes.CommentsExtended:
          this.commentsExtendedPart = T = new c.CommentsExtendedPart(this._package, p);
      }
      if (T == null) return Promise.resolve(null);
      if (this.partsMap[p] = T, this.parts.push(T), await T.load(), T.rels?.length > 0) {
        const [w] = (0, s.splitPath)(T.path);
        await Promise.all(T.rels.filter((L) => L.targetMode !== "External").map((L) => this.loadRelationshipPart((0, s.resolvePath)(L.target, w), L.type)));
      }
      return T;
    }
    async loadRelationshipXml(p, g) {
      const T = g ?? this.documentPart, w = this.getRelById(T, p);
      if (!w || w.targetMode === "External") return null;
      const L = o(this.resolveRelationshipTarget(T, w)), I = L ? this._snapshotTextParts?.[L] ?? await this._package.load(L, "string") : null;
      return I ? this._package.parseXmlDocument(I) : null;
    }
    async loadRelationshipText(p, g) {
      const T = g ?? this.documentPart, w = this.getRelById(T, p);
      if (!w || w.targetMode === "External") return null;
      const L = o(this.resolveRelationshipTarget(T, w));
      return L ? Promise.resolve(this._snapshotTextParts?.[L] ?? this._package.load(L, "string")) : Promise.resolve(null);
    }
    async loadRelationshipBlobUrl(p, g) {
      const T = g ?? this.documentPart, w = this.getRelById(T, p);
      if (!w) return null;
      if (w.targetMode === "External") return w.target;
      const L = o(this.resolveRelationshipTarget(T, w));
      return L ? this.loadPackageAssetUrl(L) : null;
    }
    async loadDocumentImage(p, g) {
      const T = g ?? this.documentPart, w = this.getRelById(T, p);
      if (!w) return null;
      if (w.targetMode === "External") return w.target;
      const L = o(this.resolveRelationshipTarget(T, w));
      return L ? this.loadPackageAssetUrl(L) : null;
    }
    async loadNumberingImage(p) {
      const g = o(this.getPathById(this.numberingPart, p));
      return g ? this.loadPackageAssetUrl(g) : null;
    }
    async loadFont(p, g) {
      const T = o(this.getPathById(this.fontTablePart, p));
      if (!T) return null;
      if (this._snapshotAssetDataUrls?.[T]) return this._snapshotAssetDataUrls[T];
      const w = await this._package.load(T, "uint8array");
      return w && this.blobToURL(new Blob([u(w, g)]), T);
    }
    async loadAltChunk(p, g) {
      const T = g ?? this.documentPart, w = this.getRelById(T, p);
      if (!w || w.targetMode === "External") return Promise.resolve(null);
      const L = o(this.resolveRelationshipTarget(T, w));
      return L ? Promise.resolve(this._snapshotTextParts?.[L] ?? this._package.load(L, "string")) : Promise.resolve(null);
    }
    blobToURL(p, g) {
      return p ? (p = this.blobWithContentType(p, g), this._options.useBase64URL ? (0, s.blobToBase64)(p) : URL.createObjectURL(p)) : null;
    }
    async loadPackageAssetUrl(p) {
      const g = o(p);
      if (!g) return null;
      if (this._snapshotAssetDataUrls?.[g]) return this._snapshotAssetDataUrls[g];
      if (this.isConvertibleMetafileAsset(g)) {
        const T = await this._package.load(g, "uint8array");
        return T ? this.convertMetafileAsset(T, g) || this.blobToURL(new Blob([T], { type: this.contentTypeForPath(g) || this.defaultMetafileContentType(g) }), g) : null;
      }
      return this.blobToURL(await this._package.load(g, "blob"), g);
    }
    async loadPackageAssetDataUrl(p) {
      const g = o(p);
      if (!g) return null;
      if (this.isConvertibleMetafileAsset(g)) {
        const L = await this._package.load(g, "uint8array");
        if (!L) return null;
        const I = this.convertMetafileAsset(L, g);
        if (I) return I;
        const Y = L ? new Blob([L], { type: this.contentTypeForPath(g) || this.defaultMetafileContentType(g) }) : null;
        return Y ? (0, s.blobToBase64)(Y) : null;
      }
      const T = await this._package.load(g, "blob"), w = this.blobWithContentType(T, g);
      return w ? (0, s.blobToBase64)(w) : null;
    }
    convertMetafileAsset(p, g) {
      if (!p) return null;
      try {
        if ((0, m.isEmfBinary)(p)) return (0, m.convertEmfToSvgDataUrl)(p);
        if ((0, f.isWmfBinary)(p)) return (0, f.convertWmfToSvgDataUrl)(p);
      } catch (T) {
        return this._options?.debug && console.warn(`docx-preview: unable to convert metafile asset ${g}`, T), null;
      }
      return null;
    }
    isConvertibleMetafileAsset(p) {
      const g = this.contentTypeForPath(p).toLowerCase();
      return /\.(emf|wmf)$/i.test(p ?? "") || g == "image/x-emf" || g == "image/emf" || g == "image/x-wmf" || g == "image/wmf";
    }
    defaultMetafileContentType(p) {
      return /\.wmf$/i.test(p ?? "") ? "image/x-wmf" : "image/x-emf";
    }
    contentTypeForPath(p) {
      const g = o(p ?? "").toLowerCase();
      for (const I of this.contentTypes ?? []) if (I.partName && o(I.partName).toLowerCase() == g) return I.contentType ?? "";
      const T = /\.([^.\/]+)$/.exec(g), w = T?.[1] ?? "";
      return w ? (this.contentTypes ?? []).find((I) => I.extension?.toLowerCase() == w)?.contentType ?? "" : "";
    }
    findPartByRelId(p, g = null) {
      var T = this.getRelById(g, p);
      const w = T && T.targetMode !== "External" ? this.resolveRelationshipTarget(g, T) : null;
      return w ? this.partsMap[w] : null;
    }
    getRelById(p, g) {
      return (p?.rels ?? this.rels ?? []).find((T) => T.id == g);
    }
    getPathById(p, g) {
      const T = this.getRelById(p, g);
      return T && T.targetMode !== "External" ? this.resolveRelationshipTarget(p, T) : null;
    }
    resolveRelationshipTarget(p, g) {
      const [T] = p ? (0, s.splitPath)(p.path) : [""];
      return o((0, s.resolvePath)(g.target, T));
    }
  }
  function o(y) {
    return y && y.startsWith("/") ? y.substring(1) : y;
  }
  function u(y, p) {
    const g = p.replace(/{|}|-/g, ""), T = new Array(16);
    for (let w = 0; w < 16; w++) T[16 - w - 1] = parseInt(g.substring(2 * w, 2 * w + 2), 16);
    for (let w = 0; w < 32; w++) y[w] = y[w] ^ T[w % 16];
    return y;
  }
  b.WordDocument = r;
} }, _e = {}, (function N(Z, b) {
  var d = (function(P, k) {
    if (P === "jszip") return "jszip";
    if (P[0] === ".") {
      var s = (function(v) {
        for (var S = v.split("/"), M = [], R = 0; R < S.length; R++) {
          var $ = S[R];
          $ && $ !== "." && ($ === ".." ? M.pop() : M.push($));
        }
        return "./" + M.join("/");
      })(k.substring(0, k.lastIndexOf("/") + 1) + P);
      if (Ie[s]) return s;
      if (Ie[s + "/index"]) return s + "/index";
    }
    if (Ie[P]) return P;
    throw new Error("Cannot resolve module " + P + " from " + k);
  })(Z, b || "./docx-preview");
  if (d === "jszip") return Ue;
  if (_e[d]) return _e[d].exports;
  var h = { exports: {} };
  return _e[d] = h, Ie[d](function(P) {
    return N(P, d);
  }, h, h.exports), h.exports;
})("./docx-preview", "./docx-preview"));
var Ue, Ie, _e;
const ze = Fe.defaultOptions, Xe = Fe.parseAsync, Ge = Fe.parseAsyncInWorker, Ye = Fe.renderDocument, qe = Fe.renderAsync, Ke = Fe.awaitRenderedLayout, Je = Fe.collectLayoutSnapshot, Ze = Fe.yieldToBrowser;
export {
  Ke as awaitRenderedLayout,
  Je as collectLayoutSnapshot,
  Fe as default,
  ze as defaultOptions,
  Xe as parseAsync,
  Ge as parseAsyncInWorker,
  qe as renderAsync,
  Ye as renderDocument,
  Ze as yieldToBrowser
};
