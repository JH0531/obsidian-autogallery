/**
 * Crop geometry shared by both views, the crop modal and the PDF path.
 *
 * A crop is the frame ratio plus the normalized top edge of the frame:
 *
 *   ag:crop=16:9|ag:top=10:70:5
 *
 * `top` holds `x1:x2:y` in percent of the picture's own width and height, so
 * the same annotation survives a re-export at another resolution. The top edge
 * gives the frame's horizontal extent and vertical position; the ratio derives
 * its height.
 *
 * A hand-written annotation can ask for more height than the picture has left
 * below `y`. Rather than clipping the frame (which would silently move the top
 * edge) or letting it overflow the bitmap, the ratio is widened to the largest
 * one that still fits. That keeps the requested top edge exactly and makes the
 * visible result independent of which dimension was mistyped:
 *
 *   image 1:1, `ag:crop=1:1|ag:top=0:100:50`  ->  effective ratio 2:1
 */

export function cropAspectRatio(crop) {
  const width = Number(crop?.w);
  const height = Number(crop?.h);
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * Ratio the frame is actually drawn with. With a top edge the available height
 * below it caps how tall the frame may be; the returned ratio is never smaller
 * than that cap, so `width / ratio` always fits inside the picture.
 */
export function effectiveCropRatio(crop, natural) {
  const declared = cropAspectRatio(crop);
  if (!declared) return null;
  const sourceWidth = Number(natural?.width);
  const sourceHeight = Number(natural?.height);
  const top = crop?.top;
  if (!top || !(sourceWidth > 0 && sourceHeight > 0)) return declared;
  const topEdge = normalizedTop(top);
  if (!topEdge) return declared;
  const width = ((topEdge.x2 - topEdge.x1) / 100) * sourceWidth;
  const available = sourceHeight - (topEdge.y / 100) * sourceHeight;
  if (!(width > 0) || !(available > 0.5)) return declared;
  return Math.max(declared, width / available);
}

/** Source rectangle the reader asked to see, in pixels of the natural image. */
export function cropRegion(crop, natural) {
  const sourceWidth = Number(natural?.width);
  const sourceHeight = Number(natural?.height);
  const ratio = effectiveCropRatio(crop, natural);
  if (!(sourceWidth > 0 && sourceHeight > 0) || !ratio) return null;

  const top = normalizedTop(crop?.top);
  if (top) {
    const x = (top.x1 / 100) * sourceWidth;
    const y = (top.y / 100) * sourceHeight;
    const width = ((top.x2 - top.x1) / 100) * sourceWidth;
    // A top edge pinned to the very bottom leaves no picture below it. Treat
    // that as an unusable position and use the default centred frame instead of
    // painting a zero-height strip.
    if (width > 0 && sourceHeight - y > 0.5) {
      return { x, y, width, height: width / ratio };
    }
  }

  // A ratio without a usable top edge is the largest frame of that ratio,
  // centred.
  const width = Math.min(sourceWidth, sourceHeight * ratio);
  const height = width / ratio;
  return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height };
}

/** Clamp and order a hand-written top edge; null when there is nothing to read. */
export function normalizedTop(top) {
  if (!top) return null;
  const x1 = clamp(Number(top.x1), 0, 100);
  const x2 = clamp(Number(top.x2), 0, 100);
  const y = clamp(Number(top.y), 0, 100);
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  // A zero-width frame cannot paint anything; give it the smallest edge the
  // grammar can express instead of dropping the crop entirely.
  if (right - left < 0.1) {
    return left >= 99.9
      ? { x1: 99.9, x2: 100, y }
      : { x1: left, x2: Math.min(100, left + 0.1), y };
  }
  return { x1: left, x2: right, y };
}

/**
 * CSS `object-view-box` value for a region. Insets are resolved against the
 * element's natural size, so pixels are stable regardless of the display size.
 */
export function viewBoxValue(region, natural) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  if (!(width > 0 && height > 0) || !region) return null;
  if (!(region.width > 0 && region.height > 0)) return null;
  const left = clamp(region.x, 0, width);
  const top = clamp(region.y, 0, height);
  const right = clamp(width - region.x - region.width, 0, width);
  const bottom = clamp(height - region.y - region.height, 0, height);
  return `inset(${round2(top)}px ${round2(right)}px ${round2(bottom)}px ${round2(left)}px)`;
}

/** Region back to the stored `x1:x2:y` form, in percent of each axis. */
export function regionToTop(region, natural) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  if (!(width > 0 && height > 0) || !region) return null;
  if (!(region.width > 0.5 && region.height > 0.5)) return null;
  const x1 = round2(clamp((region.x / width) * 100, 0, 100));
  const x2 = round2(clamp(((region.x + region.width) / width) * 100, 0, 100));
  const y = round2(clamp((region.y / height) * 100, 0, 100));
  if (!(x2 > x1)) return null;
  return { x1, x2, y };
}

/** True when the frame covers the whole picture, i.e. there is nothing to crop. */
export function regionCoversImage(region, natural) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  if (!(width > 0 && height > 0) || !region) return false;
  const tolerance = 0.001;
  return region.x <= width * tolerance
    && region.y <= height * tolerance
    && region.x + region.width >= width * (1 - tolerance)
    && region.y + region.height >= height * (1 - tolerance);
}

/**
 * Best `object-position` for a build without `object-view-box`. Covers only
 * the largest frame of the ratio, so it is an approximation of a free region.
 */
export function fallbackFocus(region, natural, ratio) {
  const width = Number(natural?.width);
  const height = Number(natural?.height);
  if (!(width > 0 && height > 0) || !ratio || !region) return null;
  const maxWidth = Math.min(width, height * ratio);
  const maxHeight = maxWidth / ratio;
  const slackX = width - maxWidth;
  const slackY = height - maxHeight;
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  return {
    x: round1(slackX > 0.5 ? clamp01((centerX - maxWidth / 2) / slackX) * 100 : 50),
    y: round1(slackY > 0.5 ? clamp01((centerY - maxHeight / 2) / slackY) * 100 : 50)
  };
}

let viewBoxSupport;

/** `object-view-box` is Chromium 104+; the PDF preview uses the same engine. */
export function supportsViewBox() {
  if (viewBoxSupport === undefined) {
    viewBoxSupport = typeof CSS !== "undefined" && typeof CSS.supports === "function"
      ? CSS.supports("object-view-box", "inset(0px)")
      : false;
  }
  return viewBoxSupport;
}

/** Reduce a ratio to the smallest `W:H` pair the annotation grammar accepts. */
export function ratioToPair(ratio, maxSide = 24) {
  const raw = Number(ratio);
  if (!Number.isFinite(raw) || raw <= 0) return { w: 1, h: 1 };
  // The annotation grammar accepts 0.1..10 only; a wider frame would be
  // silently dropped on the next parse.
  const value = Math.min(10, Math.max(0.1, raw));
  let best = { w: 1, h: 1, error: Number.POSITIVE_INFINITY };
  for (let height = 1; height <= maxSide; height += 1) {
    const width = Math.round(value * height);
    if (width < 1 || width > maxSide) continue;
    const error = Math.abs(value - width / height);
    if (error < best.error - 1e-9) best = { w: width, h: height, error };
  }
  return { w: best.w, h: best.h };
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(1, Math.max(0, number));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
