/**
 * Paper geometry is derived from the exact options handed to
 * webContents.printToPDF. Chromium lays out CSS against the printable box, so
 * a CSS pixel is always 1/96 inch and a print `scale` of 90% enlarges the
 * available layout width instead of shrinking the paper.
 */

const CSS_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const DEFAULT_MARGIN_IN = 10 / MM_PER_INCH; // Chromium's 1cm default.

/**
 * A page number is printed by Chromium's own header/footer template, which
 * lives in the page margin. With a margin of zero that band is empty and the
 * number is clipped away, so the band it needs is reserved here - the same
 * "0.5 cm safe line" rule the rest of the export follows, rounded up to what an
 * 8 pt line actually needs.
 */
const PAGE_NUMBER_BAND_IN = 11 / MM_PER_INCH;
const PAGE_NUMBER_FONT_PT = 8;
const PAGE_NUMBER_SAFE_INSET_MM = 5;
const PAGE_NUMBER_GAP_MM = 2;
const DEFAULT_FONT_FAMILY = "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif";

const PAGE_SIZES_IN = Object.freeze({
  A3: [297 / MM_PER_INCH, 420 / MM_PER_INCH],
  A4: [210 / MM_PER_INCH, 297 / MM_PER_INCH],
  A5: [148 / MM_PER_INCH, 210 / MM_PER_INCH],
  Legal: [8.5, 14],
  Letter: [8.5, 11],
  Tabloid: [11, 17]
});

export const PDF_PAGE_SIZE_NAMES = Object.freeze(Object.keys(PAGE_SIZES_IN));

/**
 * Margin presets in millimetres, matching the familiar Word presets. `moderate`
 * keeps Word's asymmetric horizontal/vertical pair, which is why the values are
 * per side rather than a single number.
 */
export const MARGIN_PRESETS = Object.freeze({
  none: { label: "无（四边 0）", top: 0, right: 0, bottom: 0, left: 0 },
  narrow: { label: "窄（四边 12.7 mm）", top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { label: "适中（上下 25.4 / 左右 19 mm）", top: 25.4, right: 19, bottom: 25.4, left: 19 },
  wide: { label: "宽（上下 25.4 / 左右 50.8 mm）", top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 }
});

export const MARGIN_PRESET_OPTIONS = Object.freeze(
  Object.entries(MARGIN_PRESETS).map(([value, preset]) => [value, preset.label])
);

export function resolvePrintGeometry(settings = {}, nativeSettings = {}, options = {}) {
  const config = settings?.pdfExport && typeof settings.pdfExport === "object" ? settings.pdfExport : {};
  const native = nativeSettings && typeof nativeSettings === "object" ? nativeSettings : {};
  const sizeOverride = PAGE_SIZES_IN[config.pageSize] ?? null;
  const size = sizeOverride ?? PAGE_SIZES_IN[native.pageSize] ?? PAGE_SIZES_IN.A4;
  const orientation = ["portrait", "landscape"].includes(config.orientation)
    ? config.orientation
    : native.landscape === true ? "landscape" : "portrait";
  const landscape = orientation === "landscape";
  const pageWidthIn = landscape ? size[1] : size[0];
  const pageHeightIn = landscape ? size[0] : size[1];
  const marginsIn = resolveMargins(config, native);
  const pageNumber = resolvePageNumber(config);
  // The native exporter draws no furniture of ours, so it must not pay for the
  // band either; only this plugin's own print call reserves it.
  if (pageNumber.enabled && options.pageNumbers !== false) {
    // The band is part of the margin, so widening it shrinks the content box on
    // that side. Doing it here - once - keeps the layout width, the preview and
    // the print call on the same numbers.
    if (pageNumber.band === "header") marginsIn.top = Math.max(marginsIn.top, PAGE_NUMBER_BAND_IN);
    else marginsIn.bottom = Math.max(marginsIn.bottom, PAGE_NUMBER_BAND_IN);
  }
  const scale = resolveScale(config, native);
  // `scale` multiplies the laid-out page, so the layout viewport is wider than
  // the physical printable box by exactly that factor. Mirrored margins make
  // the two sides differ, but the printable box is the same on every page:
  // inner + outer, whichever side each one lands on.
  const horizontalIn = marginsIn.mirror
    ? marginsIn.inner + marginsIn.outer
    : marginsIn.left + marginsIn.right;
  const printableWidthPx = (pageWidthIn - horizontalIn) * CSS_PX_PER_INCH / scale;
  const printableHeightPx = (pageHeightIn - marginsIn.top - marginsIn.bottom) * CSS_PX_PER_INCH / scale;
  return {
    pageWidthIn,
    pageHeightIn,
    marginsIn,
    scale,
    landscape,
    mirrorMargins: marginsIn.mirror === true,
    contentWidthPx: Math.max(1, printableWidthPx),
    contentHeightPx: Math.max(1, printableHeightPx),
    includeTitle: config.includeTitle === true,
    pageNumber,
    fontFamily: normalizeFontFamily(options.fontFamily)
  };
}

/**
 * Physical paper box in CSS pixels. Only the preview needs it: it is the scale
 * reference for the page images, never part of a layout decision.
 */
export function pageSizePx(geometry) {
  return {
    width: Math.max(1, Number(geometry?.pageWidthIn) * CSS_PX_PER_INCH),
    height: Math.max(1, Number(geometry?.pageHeightIn) * CSS_PX_PER_INCH)
  };
}

export function toPrintOptions(geometry) {
  const options = {
    pageSize: { width: geometry.pageWidthIn, height: geometry.pageHeightIn },
    // Orientation is already encoded in the width/height pair. Passing both
    // would let Chromium swap the page a second time.
    landscape: false,
    margins: printMargins(geometry),
    printBackground: true,
    displayHeaderFooter: geometry.pageNumber?.enabled === true,
    preferCSSPageSize: false,
    scale: geometry.scale
  };
  if (options.displayHeaderFooter) {
    // Only one of the two bands carries text; the other stays an empty string.
    // Both must be real strings or Chromium prints its default date/title pair.
    const template = pageNumberTemplate(geometry);
    options.headerTemplate = geometry.pageNumber.band === "header" ? template : "<span></span>";
    options.footerTemplate = geometry.pageNumber.band === "footer" ? template : "<span></span>";
  }
  return options;
}

export function resolvePageNumber(config) {
  const source = config?.pageNumber && typeof config.pageNumber === "object" ? config.pageNumber : {};
  return {
    enabled: source.enabled === true,
    band: source.band === "header" ? "header" : "footer",
    align: ["left", "center", "right"].includes(source.align) ? source.align : "center"
  };
}

/**
 * Chromium injects this markup into the header/footer document, where Obsidian's
 * stylesheet does not exist: every property it needs (including the font size,
 * which the host document sets to 0) has to be inline. The frame that receives
 * it is the full page in this Electron build (a band-sized frame would put the
 * text 2 mm from the paper edge instead of in the margin), so the box is pinned
 * to the page edge and given the margin's own height. Anchoring to the matching
 * edge keeps it correct either way. The text hugs the content - the bottom of a
 * header band, the top of a footer band - so it never drifts into the paper edge.
 */
function pageNumberTemplate(geometry) {
  const { band, align } = geometry.pageNumber;
  const margins = geometry.marginsIn ?? {};
  const horizontal = geometry.mirrorMargins
    ? Math.min(Number(margins.inner) || 0, Number(margins.outer) || 0)
    : Math.max(0, Math.min(Number(margins.left) || 0, Number(margins.right) || 0));
  const inset = Math.max(PAGE_NUMBER_SAFE_INSET_MM, horizontal * MM_PER_INCH);
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  const bandHeightMm = (Number(band === "header" ? margins.top : margins.bottom) || 0) * MM_PER_INCH;
  const style = [
    "position:fixed",
    "left:0",
    "right:0",
    band === "header" ? "top:0" : "bottom:0",
    `height:${bandHeightMm.toFixed(2)}mm`,
    "display:flex",
    "align-items:" + (band === "header" ? "flex-end" : "flex-start"),
    "justify-content:" + justify,
    `padding:${band === "header" ? "0" : `${PAGE_NUMBER_GAP_MM}mm`} ${inset.toFixed(2)}mm ${band === "header" ? `${PAGE_NUMBER_GAP_MM}mm` : "0"}`,
    "box-sizing:border-box",
    `font-family:${geometry.fontFamily}`,
    `font-size:${PAGE_NUMBER_FONT_PT}pt`,
    "line-height:1.2",
    "color:#555",
    "-webkit-print-color-adjust:exact"
  ].join(";");
  return `<div style="${style}"><span class="pageNumber"></span>/<span class="totalPages"></span></div>`;
}

/**
 * Mirrored margins cannot be expressed in `printToPDF`'s single margin box, so
 * they are drawn by the `@page :left/:right` rules `pdf-style` emits: the print
 * call must leave the margins empty for those rules to apply, and the layout
 * width already accounts for inner + outer. Chromium sizes the header/footer
 * band from these values, though, so an enabled page number keeps the vertical
 * pair - without it the band is zero and the number is clipped.
 */
function printMargins(geometry) {
  const margins = geometry.marginsIn ?? {};
  if (geometry.mirrorMargins) {
    if (geometry.pageNumber?.enabled !== true) return { top: 0, right: 0, bottom: 0, left: 0 };
    return { top: margins.top ?? 0, right: 0, bottom: margins.bottom ?? 0, left: 0 };
  }
  return { top: margins.top ?? 0, right: margins.right ?? 0, bottom: margins.bottom ?? 0, left: margins.left ?? 0 };
}

function normalizeFontFamily(value) {
  // The family goes into a double-quoted `style` attribute, so names are quoted
  // with single quotes and any quote of either kind is dropped from the source.
  const text = typeof value === "string" ? value.replace(/["'\\]/g, "").trim() : "";
  if (!text) return DEFAULT_FONT_FAMILY;
  const names = text.split(",").map((name) => name.trim()).filter(Boolean);
  return names.length ? names.map((name) => `'${name}'`).join(", ") : DEFAULT_FONT_FAMILY;
}

function resolveMargins(config, native) {
  if (config.marginMode === "preset") {
    const preset = MARGIN_PRESETS[config.marginPreset] ?? MARGIN_PRESETS.narrow;
    const base = {
      top: preset.top / MM_PER_INCH,
      right: preset.right / MM_PER_INCH,
      bottom: preset.bottom / MM_PER_INCH,
      left: preset.left / MM_PER_INCH
    };
    return withMirror(base, config);
  }
  if (config.marginMode === "custom") {
    const mm = config.marginMm && typeof config.marginMm === "object" ? config.marginMm : {};
    const base = {
      top: clampInches(mm.top),
      right: clampInches(mm.right),
      bottom: clampInches(mm.bottom),
      left: clampInches(mm.left)
    };
    return withMirror(base, config);
  }
  // Obsidian stores the export margin as an enum string. Its exporter maps 1
  // and 2 to explicit zero margins; every other value keeps Chromium's default.
  const marginType = String(native.margin ?? "0");
  const value = marginType === "1" || marginType === "2" ? 0 : DEFAULT_MARGIN_IN;
  const base = { top: value, right: value, bottom: value, left: value };
  return withMirror(base, config);
}

/** Mirroring replaces the horizontal pair with inner/outer; the vertical pair
 * still comes from the selected preset or custom values. */
function withMirror(base, config) {
  if (config.mirrorMargins !== true) return { ...base, mirror: false };
  const inner = clampInches(config.innerMarginMm);
  const outer = clampInches(config.outerMarginMm);
  return { top: base.top, bottom: base.bottom, left: inner, right: outer, inner, outer, mirror: true };
}

function resolveScale(config, native) {
  const override = Number(config.scalePercent);
  const percent = Number.isFinite(override) && override > 0 ? override : Number(native.downscalePercent);
  const value = Number.isFinite(percent) && percent > 0 ? percent / 100 : 1;
  return Math.min(2, Math.max(0.1, value));
}

function clampInches(value) {
  const mm = Number(value);
  const safe = Number.isFinite(mm) ? Math.min(80, Math.max(0, mm)) : 12;
  return safe / MM_PER_INCH;
}
