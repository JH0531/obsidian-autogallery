/**
 * Shared placement for the action bar that floats over an image embed.
 *
 * Obsidian anchors `.embed-actions` inside the picture. With three or more
 * controls the bar is wider than a narrow image, and squeezing it inside the
 * bitmap would either cover the artwork or overflow it. When the bar no longer
 * fits in the picture it moves into the free gutter: a left float keeps its free
 * side on the right, a right float on the left, and a centered image (or one
 * with no float at all) defaults to the right.
 *
 * A gallery cell may not do that. The cells of a row are packed edge to edge,
 * so a bar moved outside one cell lands on its neighbour, and because
 * `.embed-actions` keeps `pointer-events: auto` while hidden the overflow
 * answers for the wrong image: the pointer is over picture B while the click
 * hits picture A's button. A cell therefore degrades inside its own box
 * instead - horizontal bar, vertical rail, smaller rail, and only when none of
 * them fit, no bar at all. The invariant is that the bar never leaves the
 * cell, so a hover can never be attributed to a neighbouring image.
 *
 * The bar is placed flush against the picture edge. `.embed-actions` keeps
 * `pointer-events: auto` while hidden, so crossing the boundary never falls
 * into a dead strip that would hide the bar mid-hover.
 */

const EMBED_SELECTOR = ".image-embed, .internal-embed";
const INSIDE_INSET = "8px";
const OUTSIDE_INSET = "100%";

/** Cell modes. `inside` keeps the bar horizontal; the others are CSS classes. */
const COMPACT_CLASS = "ag-actions-compact";
const COMPACT_SMALL_CLASS = "ag-actions-compact-small";
const HIDDEN_CLASS = "ag-actions-hidden";
const MODE_CLASSES = [COMPACT_CLASS, COMPACT_SMALL_CLASS, HIDDEN_CLASS];

/** Cell inset for the two rail modes, and for the smallest rail. */
const RAIL_INSET = 8;
const TIGHT_INSET = 2;
/** Width one control is reduced to in the smallest rail. */
const SMALL_ITEM = 24;

const PLACEMENT_PROPERTIES = [
  "right", "left", "inset-inline-end", "inset-inline-start", "max-width", "width"
];

function barFor(embed) {
  return embed?.querySelector?.(":scope > .embed-actions")
    ?? embed?.querySelector?.(".embed-actions")
    ?? null;
}

/** Write only values that actually change: a redundant inline write would
 * invalidate style for every image on each animation frame. `null` removes. */
function applyStyles(actions, values) {
  for (const [property, value] of Object.entries(values)) {
    if (value === null) {
      if (actions.style.getPropertyValue(property)) actions.style.removeProperty(property);
      continue;
    }
    if (actions.style.getPropertyValue(property) === value
      && actions.style.getPropertyPriority(property) === "important") continue;
    actions.style.setProperty(property, value, "important");
  }
}

function insideStyles() {
  return {
    right: INSIDE_INSET,
    left: "auto",
    "inset-inline-end": INSIDE_INSET,
    "inset-inline-start": "auto",
    "max-width": null,
    width: null
  };
}

function outsideStyles(side) {
  const anchor = side === "left" ? "right" : "left";
  const opposite = side === "left" ? "left" : "right";
  return {
    [anchor]: OUTSIDE_INSET,
    [opposite]: "auto",
    [`inset-inline-${anchor === "right" ? "end" : "start"}`]: OUTSIDE_INSET,
    [`inset-inline-${opposite === "right" ? "end" : "start"}`]: "auto",
    // The bar is deliberately wider than the picture here; the embed's own
    // `max-width: 100%` would otherwise wrap the buttons into several rows.
    "max-width": "none",
    width: "max-content"
  };
}

/** Drop the inline geometry so the rail rules own it. Inline `!important`
 * outranks a stylesheet `!important`, and the editor rewrites these properties
 * on hover, so the rail must not depend on inline values. */
function clearPlacement(actions) {
  for (const property of PLACEMENT_PROPERTIES) {
    if (actions.style.getPropertyValue(property)) actions.style.removeProperty(property);
  }
  delete actions.dataset.agOutside;
}

/**
 * Intrinsic sizes of the bar, measured only while it still lays itself out
 * horizontally. A compact bar reports the rail's width, so measuring it there
 * would make the next pass believe the horizontal bar fits again and flip
 * between the two layouts.
 */
const measurements = new WeakMap();

function readMeasurements(actions) {
  const settled = MODE_CLASSES.filter((name) => actions.classList.contains(name));
  if (settled.length) {
    const cached = measurements.get(actions);
    if (cached) return cached;
    // A compact bar with no measurement is what a fresh plugin instance finds
    // when the DOM kept its classes. Drop them for the read and put them back,
    // so one reflow fills the cache instead of leaving the bar stuck in a mode
    // nothing can re-evaluate.
    for (const name of settled) actions.classList.remove(name);
  }
  const rect = actions.getBoundingClientRect();
  const style = actions.ownerDocument?.defaultView?.getComputedStyle?.(actions);
  const item = actions.firstElementChild?.getBoundingClientRect();
  if (!(rect.width > 0) || !item || !(item.width > 0) || !style) {
    for (const name of settled) actions.classList.add(name);
    return measurements.get(actions) ?? null;
  }
  const next = {
    width: rect.width,
    itemWidth: item.width,
    itemHeight: item.height,
    count: Math.max(1, actions.children.length),
    gap: parseFloat(style.columnGap || style.gap) || 0,
    padX: (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0),
    padY: (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  };
  measurements.set(actions, next);
  for (const name of settled) actions.classList.add(name);
  return next;
}

function railSize(metrics, itemWidth = metrics.itemWidth) {
  return {
    width: itemWidth + metrics.padX,
    height: metrics.count * metrics.itemHeight + (metrics.count - 1) * metrics.gap + metrics.padY
  };
}

/** @param {"inside"|"compact"|"small"|"hidden"} mode */
function setMode(actions, mode) {
  actions.classList.toggle(COMPACT_CLASS, mode === "compact" || mode === "small");
  actions.classList.toggle(COMPACT_SMALL_CLASS, mode === "small");
  actions.classList.toggle(HIDDEN_CLASS, mode === "hidden");
}

/**
 * Pick the largest placement that fits inside a gallery cell. The cell may be
 * narrow but it is tall - a gallery row shares one height, so a narrow cell is
 * a tall one - which is what makes the vertical rail viable at all.
 */
function placeInsideCell(actions, embed) {
  const rect = embed.getBoundingClientRect?.();
  const width = rect?.width || embed.clientWidth || 0;
  const height = rect?.height || embed.clientHeight || 0;
  const metrics = readMeasurements(actions);
  if (!metrics || width <= 0 || height <= 0) {
    // Nothing measured yet. Keep the bar horizontal for this pass and leave
    // the decision uncached so the next pass evaluates it again.
    setMode(actions, "inside");
    applyStyles(actions, insideStyles());
    return false;
  }
  const rail = railSize(metrics);
  const barHeight = metrics.itemHeight + metrics.padY;
  if (metrics.width + 2 * RAIL_INSET <= width && barHeight + 2 * RAIL_INSET <= height) {
    setMode(actions, "inside");
    applyStyles(actions, insideStyles());
    return true;
  }
  if (rail.width + 2 * RAIL_INSET <= width && rail.height + 2 * RAIL_INSET <= height) {
    setMode(actions, "compact");
    clearPlacement(actions);
    return true;
  }
  const small = railSize(metrics, SMALL_ITEM);
  if (small.width + 2 * TIGHT_INSET <= width && small.height + 2 * TIGHT_INSET <= height) {
    setMode(actions, "small");
    clearPlacement(actions);
    return true;
  }
  // Nothing fits. A bar that escapes the cell is strictly worse than no bar:
  // it would answer for a neighbouring image's hover.
  setMode(actions, "hidden");
  clearPlacement(actions);
  return true;
}

/**
 * @param {Element} embed image embed that owns the bar
 * @param {{ allowOutside?: boolean }} options gallery cells never move outside
 */
export function placeEmbedActions(embed, { allowOutside = true } = {}) {
  const actions = barFor(embed);
  if (!actions) return;

  if (allowOutside) {
    const embedWidth = embed.clientWidth || embed.getBoundingClientRect?.().width || 0;
    const barWidth = embedWidth > 0 ? actions.getBoundingClientRect?.().width ?? 0 : 0;
    // Small tolerance for sub-pixel rounding: a bar that only just fits still
    // sits inside, otherwise every narrow-ish image would flip outside.
    if (embedWidth <= 0 || barWidth <= 0 || barWidth + 16 <= embedWidth) {
      setMode(actions, "inside");
      applyStyles(actions, insideStyles());
      return;
    }
    const view = embed.ownerDocument?.defaultView;
    const float = view?.getComputedStyle?.(embed)?.float ?? "none";
    const outside = float === "right" ? "left" : "right";
    setMode(actions, "inside");
    applyStyles(actions, outsideStyles(outside));
    if (actions.dataset.agOutside !== outside) actions.dataset.agOutside = outside;
    return;
  }

  // Repeat passes are the norm; only re-decide when the cell or the controls
  // actually changed size.
  const rect = embed.getBoundingClientRect?.();
  const width = rect?.width || embed.clientWidth || 0;
  const height = rect?.height || embed.clientHeight || 0;
  const key = `${Math.round(width)}x${Math.round(height)}|${actions.children.length}`;
  if (actions.dataset.agModeKey === key) return;
  // Cache only a real decision: a pass that could not measure must be retried
  // when the bar becomes measurable at the same cell size.
  if (placeInsideCell(actions, embed)) actions.dataset.agModeKey = key;
}

/** Remove the plugin's placement so the bar returns to Obsidian's own state. */
export function clearEmbedActionsPlacement(root) {
  for (const actions of root?.querySelectorAll?.(".embed-actions") ?? []) {
    clearPlacement(actions);
    for (const name of MODE_CLASSES) actions.classList.remove(name);
    delete actions.dataset.agModeKey;
    measurements.delete(actions);
  }
}

/**
 * Report how the bar currently sits, for controls that must stay clear of it.
 *
 * The mode is read from the classes the placement pass already set, and the
 * rail width from the measurement taken while the bar still laid itself out
 * horizontally. Nothing here re-measures or re-decides.
 *
 * @param {Element} embed image embed that owns the bar
 * @returns {{ mode: "inside"|"compact"|"small"|"hidden", railWidth: number,
 *   railHeight: number, barHeight: number, itemWidth: number,
 *   itemHeight: number } | null}
 */
export function embedActionMetrics(embed) {
  const actions = barFor(embed);
  if (!actions) return null;
  const mode = actions.classList.contains(HIDDEN_CLASS)
    ? "hidden"
    : actions.classList.contains(COMPACT_SMALL_CLASS)
      ? "small"
      : actions.classList.contains(COMPACT_CLASS) ? "compact" : "inside";
  const metrics = measurements.get(actions);
  if (!metrics) return { mode, railWidth: 0, railHeight: 0, barHeight: 0, itemWidth: 0, itemHeight: 0 };
  const rail = railSize(metrics, mode === "small" ? SMALL_ITEM : metrics.itemWidth);
  // The heights come from the cached measurements, not from the live element:
  // a bar that is currently display:none still has to describe the space it
  // takes when it appears, or a control placed beside it would overlap it on
  // the first hover.
  return {
    mode,
    railWidth: rail.width,
    railHeight: rail.height,
    barHeight: metrics.itemHeight + metrics.padY,
    itemWidth: metrics.itemWidth,
    itemHeight: metrics.itemHeight
  };
}

export { EMBED_SELECTOR };
