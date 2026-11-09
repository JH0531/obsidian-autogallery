import { addIcon } from "obsidian";

/**
 * Obsidian 1.10 ships a Lucide build that predates `link-2-off` (the release
 * renamed `unlink-2`/`link-2-off` around each other). `setIcon` is silent for
 * an unknown id — it produces an empty `<svg>` and the button becomes a blank
 * square — so the glyph is registered into the icon registry at load time.
 *
 * Two details of `addIcon` differ from the built-in Lucide set:
 *
 * 1. Registered content is drawn in a `0 0 100 100` view box, while built-ins
 *    keep `0 0 24 24`. Lucide geometry is authored for 24×24, so it has to be
 *    scaled by 100/24 or it collapses into a ~5px speck in the corner.
 * 2. Obsidian copies the whole presentation set (`fill="none"`,
 *    `stroke="currentColor"`, caps, joins) onto the `<svg>` for built-in icons,
 *    but for `addIcon` it only writes `viewBox` and `class`. Without those
 *    attributes the paths fall back to `fill: black; stroke: none` and render
 *    as solid blobs, so the group carries them explicitly.
 */
const LINK_2_OFF_SCALE = 100 / 24;

const LINK_2_OFF = [
  `<g transform="scale(${LINK_2_OFF_SCALE.toFixed(7)})"`
    + ' fill="none" stroke="currentColor" stroke-width="2"'
    + ' stroke-linecap="round" stroke-linejoin="round">',
  '<path d="M9 17H7A5 5 0 0 1 7 7"/>',
  '<path d="M15 7h2a5 5 0 0 1 4 8"/>',
  '<line x1="8" x2="12" y1="12" y2="12"/>',
  '<line x1="2" x2="22" y1="2" y2="22"/>',
  "</g>"
].join("");

let registered = false;

/** Idempotent; safe to call on every plugin load. */
export function registerImageActionIcons() {
  if (registered) return;
  registered = true;
  try {
    addIcon("link-2-off", LINK_2_OFF);
  } catch {
    // Very old Obsidian builds without the icon registry: the button falls
    // back to `unlink` through ICON_FALLBACKS.
  }
}
