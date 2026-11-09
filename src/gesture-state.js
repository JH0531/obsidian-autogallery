/**
 * Geometry a gallery gesture is painting right now.
 *
 * A pointer gesture previews by writing the same declarations the layout pass
 * publishes, into the same `style` attribute the line decoration owns.
 * CodeMirror re-applies a line's decoration attributes whenever it rebuilds the
 * line, and it rebuilds the decoration set on every document change. Both put
 * the *published* geometry back: during the drag the row snaps away from the
 * pointer, and on release the row flashes back to its old size for the frames
 * between the commit and the pass that publishes the new geometry.
 *
 * The preview is therefore cached here as the whole inline style of each dragged
 * line. `buildDecorations` paints that cache in place of the published map while
 * the gesture owns the geometry, so any rebuild - a re-rendered line, the commit
 * transaction itself - reproduces exactly what the pointer is showing. The cache
 * is dropped by the pass that publishes the committed geometry, with a watchdog
 * that asks for a re-layout if that pass is swallowed.
 *
 * The cache stores `cssText` rather than a property map on purpose: the preview
 * is the merge of the published declarations and the live ones, and the line
 * element is the only place that merge exists.
 */
export const gestureGeometry = {
  active: false,
  /** True between the commit dispatch and its completion (see `beginPublish`). */
  publishing: false,
  timer: 0,
  /** Note the gesture belongs to, so another pane cannot inherit the preview. */
  path: "",
  styles: new Map(),
  /** Published style each dragged line had before the gesture started. */
  published: new Map(),

  /** A pointer gesture took the geometry. */
  hold(path = "", baseline = []) {
    this.active = true;
    this.publishing = false;
    this.path = path || "";
    this.styles.clear();
    this.published = new Map(baseline);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
  },

  /** Cache the inline style a dragged line is currently showing. */
  capture(position, cssText) {
    if (!Number.isFinite(position) || position < 0) return;
    if (typeof cssText !== "string") return;
    this.styles.set(position, cssText);
  },

  /** Preview style for a line, or `null` when it is not part of the gesture. */
  styleAt(path, position) {
    if (!this.active || this.publishing) return null;
    if ((path || "") !== this.path) return null;
    return this.styles.get(position) ?? null;
  },

  /**
   * Published style text for a line the gesture is previewing.
   *
   * The line's `style` attribute holds the live preview, so it can no longer be
   * read as published geometry. The value captured at `hold` is the last style
   * the layout pass wrote, which is exactly what the decoration would have
   * carried had the gesture never started.
   */
  publishedStyle(path, position, current) {
    if (!this.active) return current;
    if ((path || "") !== this.path) return current;
    return this.published.has(position) ? this.published.get(position) : current;
  },

  /**
   * The pass that publishes the committed geometry is about to dispatch.
   *
   * Its effect carries the new styles, so the overlay must stop winning; the
   * preview positions stay known until the dispatch completes, which is what
   * keeps `readLayoutStyles` from mistaking them for published values.
   */
  beginPublish() {
    this.publishing = true;
  },

  /**
   * Move the cached positions through a document change.
   *
   * A line start maps with `assoc = -1`: a commit replaces whole image lines,
   * and the start of the replaced range is the start of the new line. `assoc =
   * 1` would put the key at the end of the rewritten text.
   */
  map(changes) {
    if (!this.active || !changes) return;
    const remap = (source) => {
      if (!source.size) return source;
      const mapped = new Map();
      for (const [position, value] of source) {
        mapped.set(changes.mapPos(position, -1), value);
      }
      return mapped;
    };
    this.styles = remap(this.styles);
    // The baseline moves with the document too: it is compared against
    // decoration positions from the *new* state during the publish dispatch.
    this.published = remap(this.published);
  },

  /** The gesture ended without an edit: hand the geometry back at once. */
  release() {
    this.active = false;
    this.publishing = false;
    this.path = "";
    this.styles.clear();
    this.published.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
  },

  /**
   * The gesture committed an edit. Keep the preview until the layout pass that
   * publishes the new geometry runs; if it never does, clear the cache and ask
   * for a re-layout rather than leaving a preview nothing can replace.
   */
  releaseAfterPublish(delay = 1500, onExpire = null) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.release();
      onExpire?.();
    }, delay);
  }
};
