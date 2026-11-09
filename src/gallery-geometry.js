/**
 * Gallery resizing maths.
 *
 * A gallery cell's width is not stored anywhere: the row packer derives it from
 * the frame ratio and the shared row height.
 *
 *   rowHeight = (containerWidth - gap * (n - 1)) / sum(ratios)
 *   cellWidth = rowHeight * ratio
 *
 * so reallocating width between two cells is the same operation as rewriting
 * their `ag:crop` ratios. Keeping the pair's ratio sum constant therefore keeps
 * the row height unchanged, which is what makes the drag local: the other cells
 * in the row never move.
 *
 * `regionForRatio` is the whole of the crop policy. It grows the frame into the
 * unused part of the picture before it takes anything away, and only crops
 * symmetrically once that margin is gone.
 */
import { cropRegion, effectiveCropRatio, regionCoversImage } from "./crop-geometry.js";

// The annotation grammar rejects a ratio outside this range, so a drag must
// never produce one: the crop would be dropped on the next parse and the cell
// would snap back to its natural shape.
const MIN_RATIO = 0.1;
const MAX_RATIO = 10;
const RATIO_PRECISION = 1000;

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function naturalRatio(natural) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  return width > 0 && height > 0 ? width / height : null;
}

/** Ratio the cell is actually drawn with: the crop if there is one, else the picture's own. */
export function cellRatio(params, natural) {
  if (params?.crop) {
    const ratio = effectiveCropRatio(params.crop, natural);
    if (ratio) return ratio;
  }
  return naturalRatio(natural);
}

/** Source rectangle the cell shows. An uncropped picture is its own frame. */
export function frameRegion(params, natural) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  if (!(width > 0 && height > 0)) return null;
  if (params?.crop) {
    const region = cropRegion(params.crop, natural);
    if (region) return region;
  }
  return { x: 0, y: 0, width, height };
}

/**
 * Largest frame of `ratio` reachable from `region` without losing picture.
 *
 * Narrower frame (the cell shrank): keep the current width and grow the frame
 * vertically. The growth is centred, and once one edge reaches the picture
 * border the frame keeps growing from the other edge instead - that is the
 * "slide the centre, keep consuming the margin" step. Only when the frame
 * already spans the full height does the width start to shrink, symmetrically.
 *
 * Wider frame: the same two steps, swapped.
 */
export function regionForRatio(region, natural, ratio) {
  const sourceWidth = Number(natural?.width);
  const sourceHeight = Number(natural?.height);
  const target = clamp(ratio, MIN_RATIO, MAX_RATIO);
  if (!(sourceWidth > 0 && sourceHeight > 0) || !region) return null;
  if (!(region.width > 0 && region.height > 0)) return null;

  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const current = region.width / region.height;

  if (target <= current) {
    const width = region.width;
    const height = width / target;
    if (height <= sourceHeight) {
      return {
        x: region.x,
        y: clamp(centerY - height / 2, 0, sourceHeight - height),
        width,
        height
      };
    }
    // The frame cannot get taller: it now spans the picture and the only way
    // left is to take width away from both sides.
    const nextWidth = sourceHeight * target;
    return {
      x: clamp(centerX - nextWidth / 2, 0, sourceWidth - nextWidth),
      y: 0,
      width: nextWidth,
      height: sourceHeight
    };
  }

  const height = region.height;
  const width = target * height;
  if (width <= sourceWidth) {
    return {
      x: clamp(centerX - width / 2, 0, sourceWidth - width),
      y: region.y,
      width,
      height
    };
  }
  const nextHeight = sourceWidth / target;
  return {
    x: 0,
    y: clamp(centerY - nextHeight / 2, 0, sourceHeight - nextHeight),
    width: sourceWidth,
    height: nextHeight
  };
}

/**
 * Annotation patch that makes a cell show a frame of `ratio`.
 *
 * Returns `{ crop: null }` when the frame covers the whole picture, so a cell
 * dragged back to its natural shape stops carrying a crop at all.
 *
 * The top edge is rounded *outwards* and the declared ratio is derived from the
 * rounded rectangle. `effectiveCropRatio` widens a ratio whose frame does not
 * fit below its top edge; rounding inwards would trigger that and the cell
 * would render slightly wider than the drag asked for.
 */
export function cropPatchForRatio(params, natural, ratio) {
  const sourceWidth = Number(natural?.width);
  const sourceHeight = Number(natural?.height);
  const target = Number(ratio);
  if (!(sourceWidth > 0 && sourceHeight > 0) || !Number.isFinite(target)) return null;
  const start = frameRegion(params, natural);
  if (!start) return null;
  const region = regionForRatio(start, natural, target);
  if (!region) return null;
  if (regionCoversImage(region, natural)) return { crop: null };

  const top = topFromRegion(region, natural);
  if (!top) return null;
  const frameWidth = ((top.x2 - top.x1) / 100) * sourceWidth;
  const declared = frameWidth / region.height;
  if (!(declared >= MIN_RATIO && declared <= MAX_RATIO)) return null;
  return { crop: { w: roundRatio(declared), h: 1, top } };
}

/** `ag:top` form of a region, rounded outwards so the frame never clips. */
export function topFromRegion(region, natural) {
  const sourceWidth = Number(natural?.width);
  const sourceHeight = Number(natural?.height);
  if (!(sourceWidth > 0 && sourceHeight > 0) || !region) return null;
  const x1 = clamp(floor2((region.x / sourceWidth) * 100), 0, 100);
  const x2 = clamp(ceil2(((region.x + region.width) / sourceWidth) * 100), 0, 100);
  const y = clamp(floor2((region.y / sourceHeight) * 100), 0, 100);
  if (!(x2 - x1 > 0.1)) return null;
  return { x1, x2, y };
}

/**
 * Narrow a frame by `factor`, keeping its vertical extent and its centre.
 *
 * This is the third crop strategy: unlike `cropPatchForRatio`, which grows the
 * frame into the margins before taking anything away, this one is asked for by
 * a row that must give up width - the pictures keep their height and lose the
 * same fraction on both sides.
 */
export function cropShrinkWidth(params, natural, factor) {
  const sourceWidth = Number(natural?.width);
  const sourceHeight = Number(natural?.height);
  const scale = clamp(Number(factor), 0.01, 1);
  if (!(sourceWidth > 0 && sourceHeight > 0)) return null;
  const start = frameRegion(params, natural);
  if (!start || !(start.width > 0) || !(start.height > 0)) return null;
  const width = start.width * scale;
  const region = {
    x: start.x + (start.width - width) / 2,
    y: start.y,
    width,
    height: start.height
  };
  if (regionCoversImage(region, natural)) return { crop: null };
  const top = topFromRegion(region, natural);
  if (!top) return null;
  const frameWidth = ((top.x2 - top.x1) / 100) * sourceWidth;
  const declared = frameWidth / region.height;
  if (!(declared >= MIN_RATIO && declared <= MAX_RATIO)) return null;
  return { crop: { w: roundRatio(declared), h: 1, top } };
}

/**
 * How much every existing cell must give up so a row of `n + 1` pictures lands
 * exactly on `targetHeight`.
 *
 * With `r_i' = (1 - kappa) r_i` for the existing cells and the incoming ratio
 * untouched, the row height is `available / ((1 - kappa) S + r_in)`. Setting
 * that to the target and solving gives `kappa = 1 - (available / target - r_in) / S`.
 *
 * The result is the same *fraction* for every existing cell, so a wide picture
 * gives up more pixels than a narrow one while both lose the same proportion.
 * When kappa has to be clamped, the incoming picture absorbs the remainder by
 * being narrowed itself; `null` means it cannot, and the merge must be refused
 * rather than producing a sliver.
 */
export function mergeShrinkPlan({
  available,
  targetHeight,
  existingRatios = [],
  incomingRatio,
  maxCrop = 0.5,
  minWidth = 1
} = {}) {
  const area = Number(available);
  const target = Number(targetHeight);
  const incoming = Number(incomingRatio);
  const sum = existingRatios.reduce((total, ratio) => total + (Number(ratio) > 0 ? Number(ratio) : 0), 0);
  if (!(area > 0) || !(target > 0) || !(incoming > 0) || !(sum > 0)) return null;

  const wanted = 1 - (area / target - incoming) / sum;
  if (!(wanted > 0)) return { kappa: 0, incomingRatio: incoming };

  const narrowest = Math.min(...existingRatios.map((ratio) => Number(ratio) || Infinity));
  const floorFromWidth = narrowest > 0 && Number.isFinite(narrowest)
    ? 1 - minWidth / (target * narrowest)
    : 0;
  const kappa = clamp(Math.min(wanted, Math.max(0, Number(maxCrop) || 0), Math.max(0, floorFromWidth)), 0, 0.95);

  const incomingWidth = area - target * (1 - kappa) * sum;
  if (!(incomingWidth >= minWidth)) return null;
  return { kappa, incomingRatio: Math.min(incoming, incomingWidth / target) };
}

/**
 * Move one boundary by `delta`, keeping the pair's total width.
 *
 * `minWidth` is a hard floor for either side; when the pair is too narrow to
 * honour it the two cells split the space evenly instead of inverting.
 */
export function resizePair(widths, index, delta, minWidth = 1) {
  const left = Number(widths?.[index]);
  const right = Number(widths?.[index + 1]);
  if (!(left > 0) || !(right > 0)) return [...(widths ?? [])];
  const total = left + right;
  const floor = Math.min(Math.max(1, Number(minWidth) || 0), total / 2);
  const nextLeft = Math.min(total - floor, Math.max(floor, left + delta));
  const next = [...widths];
  next[index] = nextLeft;
  next[index + 1] = total - nextLeft;
  return next;
}

/**
 * Narrowest a cell may become. Two limits apply at once:
 * the requested share of the column, and the smallest ratio the `ag:crop`
 * grammar can express at the current row height.
 */
export function minimumCellWidth(containerWidth, rowHeight, minRatio) {
  const share = Math.max(0, Number(containerWidth) || 0) * (Number(minRatio) || 0);
  const grammar = Math.max(0, Number(rowHeight) || 0) * MIN_RATIO;
  return Math.max(1, share, grammar);
}

/** Row height a set of ratios produces in a container. */
export function rowHeightFor(containerWidth, gap, count, ratioSum) {
  const available = Number(containerWidth) - Math.max(0, Number(gap) || 0) * Math.max(0, count - 1);
  const sum = Number(ratioSum);
  return available > 0 && sum > 0 ? available / sum : 0;
}

/**
 * Factor that turns every ratio in a row so the row reaches `targetHeight`.
 * Widths are unchanged by construction: scaling all ratios by k divides the
 * height by k and multiplies each cell width by k * (1/k).
 */
export function heightScaleFactor(currentHeight, targetHeight) {
  const current = Number(currentHeight);
  const target = Number(targetHeight);
  if (!(current > 0) || !(target > 0)) return 1;
  return current / target;
}

function roundRatio(value) {
  return Math.round(value * RATIO_PRECISION) / RATIO_PRECISION;
}

function floor2(value) {
  return Math.floor(value * 100) / 100;
}

function ceil2(value) {
  return Math.ceil(value * 100) / 100;
}

export { MIN_RATIO, MAX_RATIO };
