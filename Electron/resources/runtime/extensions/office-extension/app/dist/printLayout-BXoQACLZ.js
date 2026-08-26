const n = (t) => !Number.isFinite(t) || t <= 0 ? 0 : Number(t.toFixed(3)), a = (t) => `${n(t)}px`, d = (t) => `${Number((n(t) / 96).toFixed(4))}in`, h = (t) => {
  const i = Number.parseFloat(t);
  return Number.isFinite(i) && i > 0 ? i : 0;
}, p = (t, i = {}) => {
  const o = window.getComputedStyle(t), r = h(o.width) || t.offsetWidth || i.width || t.getBoundingClientRect().width, e = h(o.height) || h(o.minHeight) || t.offsetHeight || i.height || t.getBoundingClientRect().height;
  return {
    width: n(r),
    height: n(e)
  };
}, f = (t, i, o = {}) => {
  const r = a(i.width), e = a(i.height), s = o.heightMode || "fixed";
  t.classList.add("viewer-print-page"), t.style.setProperty("--viewer-print-page-width", r), t.style.setProperty("--viewer-print-page-height", e), t.style.width = r, t.style.maxWidth = "none", t.style.minHeight = e, s === "fixed" ? (t.style.height = e, t.style.overflow = "hidden") : (t.style.height = "auto", t.style.overflow = "visible");
}, w = ({ selector: t, width: i, height: o, heightMode: r = "fixed" }) => {
  const e = a(i), s = a(o), g = r === "fixed" ? `height:${s}!important;min-height:${s}!important;overflow:hidden!important;` : `height:auto!important;min-height:${s}!important;overflow:visible!important;`;
  return `
    @page { size: ${d(i)} ${d(o)}; margin: 0; }
    @media print {
      html, body {
        width: ${e};
        min-width: ${e};
        background: #ffffff !important;
      }
      ${t} {
        width: ${e}!important;
        max-width: none!important;
        ${g}
        margin: 0!important;
        box-shadow: none!important;
        border: 0!important;
        break-after: page;
        page-break-after: always;
      }
      ${t}:last-child {
        break-after: auto;
        page-break-after: auto;
      }
    }
  `;
};
export {
  f as a,
  w as b,
  a as f,
  p as g
};
