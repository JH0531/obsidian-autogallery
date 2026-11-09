/**
 * Natural pixel size of images, keyed by `notePath\0link`.
 *
 * Obsidian virtualises Live Preview and loads bitmaps lazily. A line rendered
 * before its image arrives has no intrinsic ratio, so the plugin cannot reserve
 * the final height and the viewport jumps when the bitmap lands. Remembering
 * the measured size lets the next render size the line before the pixels are
 * available. Entries are scoped to the note and pruned when it closes.
 */
const metrics = new Map();

/**
 * Link-keyed entries live in the same map so pruning stays a single walk. The
 * prefix separates them from the `notePath\0src` keys: a link key names the
 * file a note references, not the resolved resource URL, and survives the
 * element being detached by the reading view's virtualiser.
 */
const LINK_PREFIX = "link\u0000";

export function imageMetricKey(notePath, link) {
  return `${notePath || ""}\u0000${link || ""}`;
}

export function imageMetric(key) {
  return metrics.get(key) ?? null;
}

export function rememberImageMetric(key, width, height) {
  remember(key, width, height);
}

export function linkMetricKey(notePath, target) {
  return `${LINK_PREFIX}${notePath || ""}\u0000${target || ""}`;
}

export function linkMetric(key) {
  return metrics.get(key) ?? null;
}

export function rememberLinkMetric(key, width, height) {
  remember(key, width, height);
}

function remember(key, width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!key || !(w > 0 && h > 0)) return;
  const previous = metrics.get(key);
  if (previous && Math.abs(previous.width - w) < 0.5 && Math.abs(previous.height - h) < 0.5) return;
  metrics.set(key, { width: w, height: h });
}

/** Drop entries whose note is no longer open. */
export function pruneImageMetrics(openPaths) {
  for (const key of [...metrics.keys()]) {
    const body = key.startsWith(LINK_PREFIX) ? key.slice(LINK_PREFIX.length) : key;
    const separator = body.indexOf("\u0000");
    const path = separator < 0 ? "" : body.slice(0, separator);
    if (!openPaths.has(path)) metrics.delete(key);
  }
}
