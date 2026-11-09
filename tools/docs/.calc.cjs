var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tools/docs/.calc.mjs
var calc_exports = {};
__export(calc_exports, {
  calculateGalleryRows: () => calculateGalleryRows,
  calculateWidthRatio: () => calculateWidthRatio
});
module.exports = __toCommonJS(calc_exports);

// src/config.json
var config_default = {
  widthRatio: {
    rMin: 0.2,
    rMax: 5,
    center: 1.5,
    wMin: 0.2,
    wMid: 0.5,
    wMax: 1,
    qLeft: 2,
    qRight: 1.5,
    floatMax: 0.6
  },
  gallery: {
    orphanMaxHeight: 400,
    minCellWidthRatio: 0.05,
    mergeMaxCrop: 0.5
  },
  pdfPagination: {
    singleImageMaxShrink: 0.15,
    lineHeightMaxShrink: 0.1,
    geometryEpsilon: 1,
    maxPasses: 4
  }
};

// src/layout.js
function calculateGalleryRows(images, containerWidth, options = {}) {
  const maxPerRow = Math.min(15, Math.max(2, Math.round(options.maxPerRow ?? 3)));
  const targetHeight = Math.max(1, options.targetHeight ?? 220);
  const minHeight = Math.max(0, Number(options.minHeight ?? 0));
  const gap = Math.max(0, Number(options.gap ?? 12));
  const ratios = images.map(readAspectRatio);
  if (ratios.some((ratio) => ratio === null)) return [];
  if (!images.length || containerWidth <= 0) return [];
  const declaredCap = Number(options.maxHeight);
  const maxHeight = Number.isFinite(declaredCap) && declaredCap > 0 ? Math.max(declaredCap, minHeight) : 0;
  const context = { containerWidth, gap, minHeight, maxHeight, targetHeight, maxPerRow };
  const locked = normalizeRowCounts(options.rows, images.length);
  if (locked && !cutsBoundSegment(locked, images)) {
    const rows2 = packLockedRows(locked, ratios, context, images);
    if (rows2) return rows2;
  }
  const segments = boundSegments(images, maxPerRow);
  if (segments.length) {
    const packed = packAroundSegments(segments, ratios, context);
    if (packed) return packed;
  }
  const rows = packRange(ratios, 0, images.length, context);
  if (!rows) return [];
  return rows.map((row) => finalizeRow(ratios, row.start, row.count, row.height, context));
}
function calculateWidthRatio(ratio, options = {}) {
  const rMin = options.rMin ?? WIDTH_CONFIG.rMin;
  const rMax = options.rMax ?? WIDTH_CONFIG.rMax;
  const center = Math.min(rMax, Math.max(rMin, options.center ?? WIDTH_CONFIG.center));
  const qLeft = Math.max(1.0001, options.qLeft ?? WIDTH_CONFIG.qLeft);
  const qRight = Math.max(1.0001, options.qRight ?? WIDTH_CONFIG.qRight);
  const value = Math.min(rMax, Math.max(rMin, Number(ratio) || center));
  if (value <= center) {
    const t2 = Math.log(value / center) / Math.log(rMin / center);
    return WIDTH_CONFIG.wMin + (WIDTH_CONFIG.wMid - WIDTH_CONFIG.wMin) * (1 - t2) ** qLeft;
  }
  const t = Math.log(value / center) / Math.log(rMax / center);
  return WIDTH_CONFIG.wMax - (WIDTH_CONFIG.wMax - WIDTH_CONFIG.wMid) * (1 - t) ** qRight;
}
function readAspectRatio(image) {
  const width = Number(image?.naturalWidth ?? image?.width);
  const height = Number(image?.naturalHeight ?? image?.height);
  return width > 0 && height > 0 ? width / height : null;
}
function finalizeRow(ratios, start, count, naturalHeight, context) {
  const { containerWidth, gap, maxHeight } = context;
  const available = containerWidth - gap * (count - 1);
  const ratioSum = sumRatios(ratios, start, count);
  const capped = maxHeight > 0 && count > 1 && naturalHeight > maxHeight + 0.01;
  const scale = capped ? maxHeight / naturalHeight : 1;
  const items = ratios.slice(start, start + count).map((ratio) => ({
    ratio,
    width: available * ratio / ratioSum * scale
  }));
  const width = capped ? items.reduce((total, item) => total + item.width, 0) + gap * (count - 1) : containerWidth;
  return {
    height: capped ? maxHeight : naturalHeight,
    naturalHeight,
    width,
    offset: Math.max(0, (containerWidth - width) / 2),
    capped,
    items
  };
}
function packRange(ratios, from, to, context) {
  const total = to - from;
  if (total <= 0) return [];
  const best = Array(total + 1).fill(null);
  best[total] = { cost: 0, rows: [] };
  for (let start = total - 1; start >= 0; start -= 1) {
    let candidate = null;
    let ratioSum = 0;
    for (let count = 1; count <= context.maxPerRow && start + count <= total; count += 1) {
      ratioSum += ratios[from + start + count - 1];
      const height = (context.containerWidth - context.gap * (count - 1)) / ratioSum;
      if (count > 1 && height < context.minHeight) continue;
      const tail = best[start + count];
      if (!tail) continue;
      const shown = context.maxHeight > 0 ? Math.min(height, context.maxHeight) : height;
      const singletonPenalty = count === 1 && total > 1 ? context.targetHeight * context.targetHeight * 100 : 0;
      const heightPenalty = ((shown - context.targetHeight) / context.targetHeight) ** 2;
      const cost = heightPenalty + singletonPenalty / (context.targetHeight * context.targetHeight) + tail.cost;
      if (!candidate || cost < candidate.cost - 1e-9 || Math.abs(cost - candidate.cost) <= 1e-9 && count > candidate.rows[0].count) {
        candidate = {
          cost,
          rows: [{ start: from + start, count, height }, ...tail.rows]
        };
      }
    }
    best[start] = candidate;
  }
  return best[0] ? best[0].rows : null;
}
function normalizeRowCounts(rows, total) {
  if (!Array.isArray(rows) || !rows.length || !(total > 0)) return null;
  const counts = [];
  let remaining = total;
  for (const value of rows) {
    if (remaining <= 0) break;
    const count = Math.round(Number(value));
    if (!Number.isFinite(count) || count < 1) continue;
    const take = Math.min(count, remaining);
    counts.push(take);
    remaining -= take;
  }
  return counts.length ? counts : null;
}
function cutsBoundSegment(counts, images) {
  let index = 0;
  for (const count of counts) {
    const first = index;
    const last = index + count - 1;
    const head = groupId(images[first]);
    const tail = groupId(images[last]);
    if (head > 0 && groupId(images[first - 1]) === head) return true;
    if (tail > 0 && groupId(images[last + 1]) === tail) return true;
    index += count;
  }
  return false;
}
function groupId(image) {
  const value = Number(image?.group);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function boundSegments(images, maxPerRow) {
  const segments = [];
  let start = -1;
  let id = 0;
  for (let index = 0; index <= images.length; index += 1) {
    const value = index < images.length ? groupId(images[index]) : 0;
    if (start >= 0 && value !== id) {
      const count = index - start;
      if (count <= maxPerRow) segments.push({ start, count });
      start = -1;
    }
    if (value > 0 && start < 0) {
      start = index;
      id = value;
    }
  }
  return segments;
}
function packAroundSegments(segments, ratios, context, from = 0) {
  const rows = [];
  let cursor = from;
  for (const segment of segments) {
    if (segment.start > cursor) {
      const packed = packRange(ratios, cursor, segment.start, context);
      if (!packed) return null;
      rows.push(...packed.map((row) => finalizeRow(ratios, row.start, row.count, row.height, context)));
    }
    const available = context.containerWidth - context.gap * (segment.count - 1);
    const naturalHeight = available / sumRatios(ratios, segment.start, segment.count);
    rows.push(finalizeRow(ratios, segment.start, segment.count, naturalHeight, context));
    cursor = segment.start + segment.count;
  }
  if (cursor < ratios.length) {
    const packed = packRange(ratios, cursor, ratios.length, context);
    if (!packed) return null;
    rows.push(...packed.map((row) => finalizeRow(ratios, row.start, row.count, row.height, context)));
  }
  return rows;
}
function packLockedRows(counts, ratios, context, images) {
  const rows = [];
  let start = 0;
  for (const count of counts) {
    const available = context.containerWidth - context.gap * (count - 1);
    const naturalHeight = available / sumRatios(ratios, start, count);
    rows.push(finalizeRow(ratios, start, count, naturalHeight, context));
    start += count;
  }
  if (start < ratios.length) {
    const segments = boundSegments(images, context.maxPerRow).filter((segment) => segment.start >= start);
    const tail = segments.length ? packAroundSegments(segments, ratios, context, start) : packRange(ratios, start, ratios.length, context)?.map((row) => finalizeRow(ratios, row.start, row.count, row.height, context));
    if (!tail) return null;
    rows.push(...tail);
  }
  return rows;
}
function sumRatios(ratios, start, count) {
  let total = 0;
  for (let index = 0; index < count; index += 1) total += ratios[start + index];
  return total;
}
var WIDTH_CONFIG = config_default.widthRatio;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  calculateGalleryRows,
  calculateWidthRatio
});
