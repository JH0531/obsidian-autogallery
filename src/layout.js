export function calculateGalleryRows(images, containerWidth, options = {}) {
  const maxPerRow = Math.min(15, Math.max(2, Math.round(options.maxPerRow ?? 3)));
  const targetHeight = Math.max(1, options.targetHeight ?? 220);
  const minHeight = Math.max(0, Number(options.minHeight ?? 0));
  const gap = Math.max(0, Number(options.gap ?? 12));
  const ratios = images.map(readAspectRatio);
  if (ratios.some((ratio) => ratio === null)) return [];
  if (!images.length || containerWidth <= 0) return [];

  // A ceiling on the visible height. It never crops: the whole row is scaled
  // down and centred, which keeps every frame's ratio. Raising it to at least
  // `minHeight` matters - a cap below the minimum would make the two
  // constraints unsatisfiable and the packer would try to split the row away.
  const declaredCap = Number(options.maxHeight);
  const maxHeight = Number.isFinite(declaredCap) && declaredCap > 0
    ? Math.max(declaredCap, minHeight)
    : 0;
  const context = { containerWidth, gap, minHeight, maxHeight, targetHeight, maxPerRow };

  // `ag:rows` is a hand-written prefix: it describes the rows from the run's
  // first image onward, and the packer routes whatever it leaves over. Honouring
  // it is what keeps the reading view, Live Preview and the PDF export on one
  // split; a stale list can only describe fewer rows than the run has, never
  // drop a picture.
  const locked = normalizeRowCounts(options.rows, images.length);
  if (locked && !cutsBoundSegment(locked, images)) {
    const rows = packLockedRows(locked, ratios, context, images);
    if (rows) return rows;
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

export function calculateFloatLayout(image, containerWidth, options = {}) {
  const ratio = readAspectRatio(image);
  if (ratio === null || containerWidth <= 0) return { mode: "center", width: containerWidth };
  // Preserve the historical helper contract for callers that omit options.
  // Renderer calls the configured piecewise algorithm with explicit options.
  if (Object.keys(options).length === 0) {
    const candidateWidth = ratio * 230;
    const candidateRatio = candidateWidth / containerWidth;
    if (candidateRatio < 0.28 || candidateRatio > 0.48) return { mode: "center", width: containerWidth, ratio };
    return { mode: "float", side: "left", width: candidateWidth, ratio };
  }
  if (options.targetHeight !== undefined || options.minWidthRatio !== undefined) {
    const candidateWidth = ratio * (options.targetHeight ?? 230);
    const candidateRatio = candidateWidth / containerWidth;
    const minRatio = options.minWidthRatio ?? 0.28;
    const maxRatio = options.maxWidthRatio ?? 0.48;
    if (candidateRatio < minRatio || candidateRatio > maxRatio) return { mode: "center", width: containerWidth, ratio };
    return { mode: "float", side: options.side ?? "left", width: candidateWidth, ratio };
  }
  const widthRatio = calculateWidthRatio(ratio, options);
  const maxRatio = options.maxWidthRatio ?? WIDTH_CONFIG.floatMax ?? 0.6;
  const candidateWidth = containerWidth * widthRatio;
  const candidateRatio = widthRatio;

  if (candidateRatio > maxRatio) {
    return { mode: "center", width: candidateWidth, ratio };
  }
  return { mode: "float", side: options.side ?? "left", width: candidateWidth, ratio };
}

export function calculateWidthRatio(ratio, options = {}) {
  const rMin = options.rMin ?? WIDTH_CONFIG.rMin;
  const rMax = options.rMax ?? WIDTH_CONFIG.rMax;
  const center = Math.min(rMax, Math.max(rMin, options.center ?? WIDTH_CONFIG.center));
  const qLeft = Math.max(1.0001, options.qLeft ?? WIDTH_CONFIG.qLeft);
  const qRight = Math.max(1.0001, options.qRight ?? WIDTH_CONFIG.qRight);
  const value = Math.min(rMax, Math.max(rMin, Number(ratio) || center));
  if (value <= center) {
    const t = Math.log(value / center) / Math.log(rMin / center);
    return WIDTH_CONFIG.wMin + (WIDTH_CONFIG.wMid - WIDTH_CONFIG.wMin) * ((1 - t) ** qLeft);
  }
  const t = Math.log(value / center) / Math.log(rMax / center);
  return WIDTH_CONFIG.wMax - (WIDTH_CONFIG.wMax - WIDTH_CONFIG.wMid) * ((1 - t) ** qRight);
}

export function readAspectRatio(image) {
  const width = Number(image?.naturalWidth ?? image?.width);
  const height = Number(image?.naturalHeight ?? image?.height);
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * Turn one decided row into its published form.
 *
 * A row taller than `maxHeight` keeps its ratios and scales every width by the
 * same factor: the pictures get smaller, the row keeps its aspect, and nothing
 * is cropped. The content band is then narrower than the column and centred,
 * which is why the row also reports its own width and left inset.
 */
function finalizeRow(ratios, start, count, naturalHeight, context) {
  const { containerWidth, gap, maxHeight } = context;
  const available = containerWidth - gap * (count - 1);
  const ratioSum = sumRatios(ratios, start, count);
  // A lone cell is handled by the isolated-image rule in both renderers; the
  // ceiling is about keeping a *row* of pictures readable as a row.
  const capped = maxHeight > 0 && count > 1 && naturalHeight > maxHeight + 0.01;
  const scale = capped ? maxHeight / naturalHeight : 1;
  const items = ratios.slice(start, start + count).map((ratio) => ({
    ratio,
    width: available * ratio / ratioSum * scale
  }));
  // Gaps do not scale, so the exact content width is `scale * available`
  // plus the untouched gutters - not `scale * containerWidth`.
  const width = capped
    ? items.reduce((total, item) => total + item.width, 0) + gap * (count - 1)
    : containerWidth;
  return {
    height: capped ? maxHeight : naturalHeight,
    naturalHeight,
    width,
    offset: Math.max(0, (containerWidth - width) / 2),
    capped,
    items
  };
}

/**
 * The dynamic program, restricted to a contiguous range.
 *
 * Ranges are what let bound rows act as barriers: the gaps before, between and
 * after them are packed independently, and a bound row is emitted as-is.
 */
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
      // Score what the reader will actually see. A capped row looks the same
      // whatever pushed it over the ceiling, so splitting it further buys
      // nothing - and the tie-break below then prefers the fuller row, which
      // makes the content band wider.
      const shown = context.maxHeight > 0 ? Math.min(height, context.maxHeight) : height;
      const singletonPenalty = count === 1 && total > 1 ? context.targetHeight * context.targetHeight * 100 : 0;
      const heightPenalty = ((shown - context.targetHeight) / context.targetHeight) ** 2;
      const cost = heightPenalty + singletonPenalty / (context.targetHeight * context.targetHeight) + tail.cost;
      if (!candidate || cost < candidate.cost - 1e-9
        || (Math.abs(cost - candidate.cost) <= 1e-9 && count > candidate.rows[0].count)) {
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

/**
 * `ag:rows` as a usable row split, or null when it describes nothing.
 *
 * The list is a prefix, not a full description of the run: it starts at the
 * run's first image and each count is taken in order. A count that runs past
 * the last image is truncated to what is left - `4,3,1` on six pictures is
 * `4,2` - and the images after the list are packed by the dynamic program like
 * any other gallery. A stale list therefore cannot lose a picture; at worst it
 * describes fewer rows than the run has.
 */
function normalizeRowCounts(rows, total) {
  if (!Array.isArray(rows) || !rows.length || !(total > 0)) return null;
  const counts = [];
  let remaining = total;
  for (const value of rows) {
    if (remaining <= 0) break;
    const count = Math.round(Number(value));
    // A meaningless entry ("0") is skipped rather than invalidating the list:
    // the counts before and after it still describe rows the author wrote.
    if (!Number.isFinite(count) || count < 1) continue;
    const take = Math.min(count, remaining);
    counts.push(take);
    remaining -= take;
  }
  return counts.length ? counts : null;
}

/**
 * True when the stored split would cut through a bound row.
 *
 * A bound row promises that its membership never changes, so a split that puts
 * half of it in one row and half in the next has to lose. The split is kept in
 * the note: other rows in the same run may still need it.
 */
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

/**
 * Maximal runs of images sharing one binding id, longest ones dropped (a run
 * longer than `maxPerRow` cannot be a single row).
 */
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

/**
 * Rows in document order: free gaps packed by the program, bound rows as-is.
 *
 * `from` is where the range starts. An `ag:rows` prefix uses it to pack only
 * the tail the split left over, without re-emitting the locked rows in front.
 */
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

/**
 * Build the rows an explicit split names, then pack whatever it left over.
 *
 * A locked row fixes its members and their relative widths, not an unlimited
 * height; the tail is ordinary automatic routing. `ag:rows=2` on six pictures
 * is "two here, then route the other four", which is what makes a partial or
 * stale list safe to honour instead of ignoring. The tail still honours
 * `ag:group`: a binding is a promise the split never made, so the fallback
 * packs around those rows instead of re-splitting them.
 */
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
    // A bound run that straddles `start` was already rejected by
    // `cutsBoundSegment`, so every segment left here lies inside the tail.
    const segments = boundSegments(images, context.maxPerRow).filter((segment) => segment.start >= start);
    const tail = segments.length
      ? packAroundSegments(segments, ratios, context, start)
      : packRange(ratios, start, ratios.length, context)
        ?.map((row) => finalizeRow(ratios, row.start, row.count, row.height, context));
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

import config from "./config.json";

const WIDTH_CONFIG = config.widthRatio;
