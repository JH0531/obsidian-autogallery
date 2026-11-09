import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField } from "obsidian";
import { parseImageAnnotation, readImageAnnotation } from "./annotations.js";
import { calculateFloatLayout, calculateGalleryRows } from "./layout.js";
import config from "./config.json";
import { resolveProfileRule } from "./profile-rules.js";
import { countFloatImagesBefore } from "./float-order.js";
import { findImageLineGroups, IMAGE_LINE, readListImageLayout } from "./image-runs.js";
import { cropRegion, effectiveCropRatio, fallbackFocus, supportsViewBox, viewBoxValue } from "./crop-geometry.js";
import { imageMetric, imageMetricKey, rememberImageMetric } from "./image-metrics.js";
import { clearEmbedActionsPlacement, placeEmbedActions } from "./embed-actions.js";
import { onImageSizeResolved, primeNoteImageSizes } from "./image-sizes.js";
import { gestureGeometry } from "./gesture-state.js";

const setLayoutEffect = StateEffect.define();

export function createAutoGalleryEditorExtension(getSettings = () => ({}), { app = null } = {}) {
  const decorations = StateField.define({
    create(state) { return buildDecorations(state, new Map()); },
    update(value, transaction) {
      // A gallery gesture previews the geometry it is producing in the same
      // `style` attribute this field owns, but the field must still rebuild:
      // a value returned here is not mapped for the editor, so the line
      // decorations would keep their old document positions. After one commit
      // the rebuilt lines lose their image class, one natural-size picture fills
      // the viewport, and the gallery never forms again - the note stays broken
      // until it is reopened. The live preview is preserved by the overlay
      // `buildDecorations` paints (see gesture-state.js), not by skipping the
      // rebuild.
      if (transaction.docChanged) gestureGeometry.map(transaction.changes);
      // Keep mapped styles during a transaction so gallery rows do not flash
      // while CodeMirror rebuilds the DOM. buildDecorations below only applies
      // a style to a line that is still an image line; changed prose therefore
      // cannot inherit an old image width.
      let layouts = readLayoutStyles(value, transaction.startState);
      // Decoration styles are keyed by document position. An edit above an
      // image shifts every later line, so the cached keys must move with the
      // text; otherwise the first pass after a typo paints a line with a
      // neighbouring image's width. Associate to the left: an annotation
      // rewrite replaces the whole line and starts exactly at its key, and the
      // line's start is the start of the replacement, not its end.
      if (transaction.docChanged) {
        const mapped = new Map();
        for (const [position, style] of layouts) mapped.set(transaction.changes.mapPos(position, -1), style);
        layouts = mapped;
      }
      for (const effect of transaction.effects) {
        if (effect.is(setLayoutEffect)) {
          layouts = new Map(layouts);
          for (const [position, style] of effect.value) {
            if (style === null) layouts.delete(position);
            else layouts.set(position, style);
          }
        }
      }
      const modeChanged = isLivePreview(transaction.startState) !== isLivePreview(transaction.state);
      return transaction.docChanged || modeChanged || transaction.effects.some((effect) => effect.is(setLayoutEffect))
        ? buildDecorations(transaction.state, layouts)
        : value;
    },
    provide(field) { return EditorView.decorations.from(field); }
  });

  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.app = app;
      this.frame = null;
      this.frameTimer = null;
      this.loadTimer = null;
      this.retryTimer = null;
      this.scrollRevision = 0;
      this.docDirty = false;
      // Monotonic counter of passes that actually published geometry.
      this.publishSerial = 0;
      this.lastWidth = null;
      this.mutationPause = false;
      this.mutationRefreshPending = false;
      // Guard against re-entering a layout pass. `ag-layout-changed` is
      // dispatched synchronously, so a listener that calls back into the
      // extension would otherwise run a pass while CodeMirror is still
      // publishing the decorations of the previous one.
      this.applying = false;
      // Positions of the lines Obsidian currently shows as revealed source.
      // Revealing an embed is a selection change, so it never reaches
      // update(); comparing this signature is what lets the observer take the
      // layout over before the browser paints.
      this.lastRevealSignature = "";
      this.reveals = [];
      this.layoutStyles = new Map();
      // List pictures cannot publish their geometry through a line decoration:
      // writing the `style` attribute of a `.cm-line` replaces the list
      // indentation the editor put there, which moves the marker and every
      // following cell. Their geometry is applied to the line element itself
      // after each pass instead, where it coexists with that indentation.
      this.listStyles = new Map();
      // Image ratios read from file headers, so the first layout pass already
      // knows every cell's size. Without it a gallery whose bitmaps have not
      // decoded yet paints once at natural width and then snaps into its row.
      this.needsPrime = true;
      this.primeTimer = null;
      // Content width used by the pass that produced `reveals`. A revealed
      // row changes the document height, which can add or remove the
      // scrollbar and therefore change the content width on the next pass.
      // Locking it keeps that feedback out of the correction pass.
      this.passWidth = 0;
      this.observer = new MutationObserver((mutations) => {
        const layoutNode = (node) => node.nodeType === Node.ELEMENT_NODE
          && (node.matches?.("img, .internal-embed, .image-embed, .ag-cm-caption, .cm-widgetBuffer")
            || node.querySelector?.("img, .internal-embed, .image-embed, .ag-cm-caption"));
        const revealNode = (node) => node.nodeType === Node.ELEMENT_NODE
          && (node.matches?.(".cm-image-reveal-tooltip, .cm-image-reveal-gap")
            || node.querySelector?.(".cm-image-reveal-tooltip, .cm-image-reveal-gap"));
        const changed = (test) => mutations.some((mutation) => (
          [...mutation.addedNodes, ...mutation.removedNodes].some(test)
        ));
        const relevant = changed(layoutNode);
        const revealChanged = changed(revealNode);
        if (!relevant && !revealChanged) return;
        // Records produced by our own dispatch must not re-enter the immediate
        // path, or a single reveal would run several synchronous passes.
        if (this.mutationPause) {
          this.mutationRefreshPending = true;
          return;
        }
        // Obsidian virtualises lines as the reader scrolls. A line rendered
        // this way would be painted once at its natural width before the next
        // animation frame applies the gallery layout. Observer callbacks run
        // before paint, so laying it out here removes that first flash.
        // The same applies to entering or leaving a reveal: the source line
        // still carries the gallery cell's fixed width, and the floating
        // preview is inserted at its native size.
        if (revealChanged
          || this.currentRevealSignature() !== this.lastRevealSignature
          || this.needsImmediateLayout()) {
          this.cancelFrame();
          this.applyLayout();
          return;
        }
        this.sync();
      });
      this.onScroll = () => {
        this.scrollRevision += 1;
        // A pass here re-measures every image on the page. While an embed is
        // being edited only its floating preview has to follow the scroller;
        // lines that scroll into view are laid out by `viewportChanged`.
        if (this.reveals.length) applyRevealLayout(this.view, this.reveals);
      };
      this.onImageLoad = (event) => {
        if (event.target?.tagName !== "IMG") return;
        if (this.loadTimer !== null) clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => {
          this.loadTimer = null;
          this.sync();
        }, 80);
      };
      view.dom.addEventListener("load", this.onImageLoad, true);
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      // The handle layer writes whole-line replacements. A document change
      // rebuilds the decorations from the *previous* geometry, so the row keeps
      // its old height until a pass publishes a difference. This event asks for
      // that pass unconditionally instead of relying on the diff cache.
      this.onLayoutInvalid = () => {
        this.docDirty = true;
        this.layoutStyles.clear();
        const serial = this.publishSerial;
        this.sync();
        // A pass can be swallowed: a second edit cancels the scheduled frame,
        // or the run is waiting for an image size. If nothing was published,
        // ask once more after the frame had its chance - otherwise the row
        // keeps the geometry of the annotation the reader just changed, and
        // the pictures overlap their neighbours until something else reflows.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!this.view?.dom?.isConnected) return;
            if (this.publishSerial !== serial) return;
            this.docDirty = true;
            this.layoutStyles.clear();
            this.sync();
          });
        });
      };
      view.dom.addEventListener("ag-layout-invalid", this.onLayoutInvalid);
      // A settings save does not modify the document, so no transaction reaches
      // this extension and the gallery would keep the geometry of the old
      // values until the next scroll. Drop the style cache and run a pass; the
      // reading view already refreshes through `scheduleRefresh`.
      this.onSettingsChanged = () => {
        this.docDirty = true;
        this.layoutStyles.clear();
        this.sync();
      };
      view.dom.ownerDocument?.defaultView?.addEventListener("ag-settings-changed", this.onSettingsChanged);
      this.observer.observe(view.dom, { childList: true, subtree: true });
      // A probe that could only run asynchronously (mobile, or an unreadable
      // header) lands after the first pass. Re-sync once it does, so the row is
      // corrected in one step instead of once per decoded bitmap.
      this.unwatchSizes = onImageSizeResolved(() => {
        if (this.primeTimer !== null) return;
        this.primeTimer = setTimeout(() => { this.primeTimer = null; this.sync(); }, 60);
      });
      this.primeSizes();
      this.sync();
      this.retryTimer = setTimeout(() => { this.retryTimer = null; this.sync(); }, 300);
    }

    /**
     * Seed the note's image ratios from the image file headers.
     *
     * The layout pass cannot size a gallery cell without its aspect ratio, and
     * Obsidian only reports `naturalWidth` after the bitmap decodes. Reading
     * the ratio from the file header is what turns the first pass into the
     * final one: the row is published before the pictures arrive instead of
     * after the last of them loads.
     */
    primeSizes() {
      if (!this.app) return;
      let path = "";
      try { path = this.view.state.field(editorInfoField, false)?.file?.path || ""; } catch { path = ""; }
      // The editor exists before Obsidian attaches its file field; leaving
      // `needsPrime` set lets the next pass try again.
      if (!path) return;
      this.needsPrime = false;
      primeNoteImageSizes(this.app, path, this.view.state.doc.toString());
    }

    update(update) {
      const modeChanged = isLivePreview(update.startState) !== isLivePreview(update.state);
      if (update.docChanged) {
        this.docDirty = true;
        // The style cache is keyed by document position. An edit that changes a
        // line's length shifts every later key, and a stale key makes the next
        // pass compare a line against its neighbour's geometry - or miss the
        // change entirely. The decoration field already maps its copy; this one
        // has to follow it.
        if (this.layoutStyles.size) {
          const mapped = new Map();
          for (const [position, style] of this.layoutStyles) {
            mapped.set(update.changes.mapPos(position, 1), style);
          }
          this.layoutStyles = mapped;
        }
      }
      // A leaf can be re-pointed at another note without being rebuilt. The
      // primed ratios belong to the old note then, so they are dropped before
      // the next pass sizes the new one.
      if (this.filePathOf(update.startState) !== this.filePathOf(update.state)) this.needsPrime = true;
      // Cursor movement must remain a pure editor operation. Dispatching a
      // layout effect during selection changes can make Obsidian leave the
      // source line editing state while the user is selecting text.
      if (modeChanged || update.docChanged || update.viewportChanged || update.geometryChanged) this.sync();
    }

    filePathOf(state) {
      try { return state.field(editorInfoField, false)?.file?.path || ""; } catch { return ""; }
    }

    sync() {
      // A width drag writes --ag-embed-width directly on the embed while the
      // pointer is down. Recomputing from source during that gesture would
      // snap the preview back to the committed width on every frame.
      if (this.view.dom.classList.contains("ag-resizing")) {
        // A gesture that outlived its pointerup (plugin reload, lost window)
        // would otherwise block every pass for the rest of the session.
        if (this.view.dom.dataset.agResizing === "1") return;
        this.view.dom.classList.remove("ag-resizing");
      }
      if (this.view.dom.classList.contains("ag-flipping")) return;
      this.cancelFrame();
      if (this.loadTimer !== null) {
        clearTimeout(this.loadTimer);
        this.loadTimer = null;
      }
      if (!isLivePreview(this.view.state)) {
        if (this.retryTimer !== null) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.layoutStyles.clear();
        this.listStyles.clear();
        this.lastRevealSignature = "";
        this.reveals = [];
        clearPluginWidgetStyles(this.view.dom);
        return;
      }
      // Obsidian renders every table cell in its own nested CodeMirror
      // instance. Laying that instance out as a document gives the image the
      // cell's shrink-to-fit width, which in turn collapses the table column:
      // the crop became a 28px thumbnail. The table cell owns the geometry, so
      // this editor only publishes the crop rectangle itself.
      if (this.view.dom.closest?.(".table-cell-wrapper")) {
        this.cancelFrame();
        if (this.retryTimer !== null) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.layoutStyles.clear();
        this.listStyles.clear();
        this.lastRevealSignature = "";
        this.reveals = [];
        clearPluginWidgetStyles(this.view.dom);
        decorateTableImages(this.view);
        return;
      }
      const run = () => this.applyLayout();
      this.frame = requestAnimationFrame(() => {
        if (this.frameTimer !== null) {
          clearTimeout(this.frameTimer);
          this.frameTimer = null;
        }
        this.frame = null;
        run();
      });
      // requestAnimationFrame is paused while the window is hidden. A timer
      // fallback keeps the layout applied for background windows.
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null;
        if (this.frame === null) return;
        cancelAnimationFrame(this.frame);
        this.frame = null;
        run();
      }, 200);
    }

    cancelFrame() {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
        this.frame = null;
      }
      if (this.frameTimer !== null) {
        clearTimeout(this.frameTimer);
        this.frameTimer = null;
      }
    }

    /**
     * Positions of the image lines Obsidian currently renders as revealed
     * source. A reveal is a selection change, so it never reaches update();
     * this signature is the only signal that the editing state moved.
     */
    currentRevealSignature() {
      const parts = [];
      for (const line of this.view.dom.querySelectorAll(".cm-line.ag-cm-image-line")) {
        if (!isRevealedImageLine(line)) continue;
        const position = linePosition(this.view, line);
        if (position >= 0) parts.push(position);
      }
      return parts.join(",");
    }

    applyLayout() {
      if (this.applying) return;
      // A gesture owns the geometry until it commits. `sync()` already refuses
      // to schedule a pass while `.ag-resizing` is set, but the observer path
      // enters here directly; publishing the last committed geometry mid-drag
      // would end the preview under the pointer.
      if (this.view.dom.dataset.agResizing === "1") return;
      this.applying = true;
      // Record the reveal state this pass was built from. Every early return
      // in layoutPass then leaves the observer's comparison in sync with the
      // DOM, so the next real reveal change is never mistaken for "no change"
      // and deferred to an animation frame.
      this.lastRevealSignature = this.currentRevealSignature();
      this.passWidth = 0;
      try {
        let published = true;
        // A revealed row is placed from the code line's height, which is only
        // exact once its block style is applied. The correction runs in this
        // same task, so the browser never paints the intermediate row, and it
        // may only follow a pass that actually published a change.
        for (let pass = 0; pass < 2 && published; pass += 1) {
          const result = this.layoutPass(pass === 0 ? 0 : this.passWidth, pass === 0);
          if (result.width) this.passWidth = result.width;
          published = result.published;
          if (!result.mismatch) break;
        }
      } finally {
        this.applying = false;
      }
      // Tables are rendered by Obsidian as widgets, outside any `.cm-line`
      // that this extension lays out. Their pictures still carry crop
      // annotations, so publish the crop rectangle directly on the image.
      decorateTableImages(this.view);
      // The reserved preview area and Obsidian's floating preview are not part
      // of the decoration map, so they are written directly after the line
      // styles have been published. A scroll only re-runs this part.
      applyListGeometry(this.view, this.listStyles);
      applyRevealLayout(this.view, this.reveals);
    }

    /**
     * Apply caption geometry from the published layout map.
     *
     * A caption is a decoration widget inside the image line, so its own
     * inline margins are what place it under the picture. Those margins come
     * from the line's `--ag-caption-margin-start/end`, but the layout pass
     * computes a new style map *before* CodeMirror publishes it. Positioning
     * only before the publish therefore always lags one pass behind: an image
     * that switches from centred to floated keeps `margin-inline: auto`, and
     * a static document never runs a second pass to correct it. This method is
     * called on both sides of the publish so the caption can never disagree
     * with the picture it belongs to.
     */
    syncCaptionGeometry(settings = getSettings(this.view)) {
      for (const line of this.view.dom.querySelectorAll(".cm-line.ag-cm-image-line")) {
        // A missing file has no picture to caption, and the notice replaces it.
        if (line.querySelector(":scope > .internal-embed.mod-empty-attachment")) {
          for (const caption of line.querySelectorAll(".ag-cm-caption")) {
            caption.style.setProperty("display", "none", "important");
          }
          continue;
        }
        // A list picture publishes its width on the embed and keeps its own
        // caption alignment, so the list pass below is the authority there.
        // Re-positioning it here would fall back to the variable the line does
        // not carry and centre the caption across the whole item column.
        if (line.classList.contains("ag-cm-list-line")) continue;
        const style = this.layoutStyles.get(linePosition(this.view, line)) || {};
        // A gallery cell is identified by the row it belongs to, not by a class
        // that may only be applied later in the same pass.
        const gallery = Boolean(style["--ag-row-height"]) || line.classList.contains("ag-cm-gallery-line");
        positionCaptionWidgets(line, null, settings, style, gallery);
        // A revealed source line already contains the caption text, so the
        // widget would duplicate it and add its gap to the code line's height.
        if (isRevealedImageLine(line)) {
          for (const caption of line.querySelectorAll(".ag-cm-caption")) {
            caption.style.setProperty("display", "none", "important");
          }
        }
      }
    }

    layoutPass(widthLock, captureAnchor) {
      const settings = getSettings(this.view);
      // The ratios have to be in place before the styles are collected: a
      // gallery member that is not rendered yet can only keep its slot in the
      // row when its size is known, and the row width must be final on the
      // first pass rather than corrected once the cell scrolls in.
      if (this.needsPrime) this.primeSizes();
      const { styles: nextStyles, reveals, width, listStyles, listPending, pending } = collectVisibleLayoutStyles(
        this.view, settings, this.lastWidth ?? 0, widthLock
      );
      this.listStyles = listStyles ?? new Map();
      // A list item's indentation is written by the editor after its line has
      // been rendered; the row it produces is measured against that column, so
      // the pass that ran too early asks for a new one.
      if ((listPending || pending) && this.retryTimer === null) {
        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.sync(); }, 120);
      }
      const result = { published: false, mismatch: false, width: width || 0 };
      // Caption widgets may be inserted after the image line decoration has
      // already been laid out. Reapply their final inline geometry on every
      // pass, including passes where a gallery is waiting for image loads.
      this.syncCaptionGeometry(settings);
      this.reveals = reveals;
      // A flow picture that has not been laid out yet may simply be waiting for
      // its bitmap; retry once. A list picture is not part of this map at all,
      // so including it here kept a note of list galleries retrying forever.
      if (!nextStyles.size
        && this.view.dom.querySelector(".ag-cm-image-line:not(.ag-cm-list-line) img:not(.cm-widgetBuffer)")) {
        if (this.retryTimer === null) this.retryTimer = setTimeout(() => { this.retryTimer = null; this.sync(); }, 300);
      }
      const changes = [];
      for (const [position, style] of nextStyles) {
        if (!sameStyle(this.layoutStyles.get(position), style)) {
          this.layoutStyles.set(position, style);
          changes.push([position, style]);
        }
      }
      const docChanged = this.docDirty;
      this.docDirty = false;
      const contentWidth = this.view.contentDOM.clientWidth;
      // Only remember a width that can actually be laid out. A hidden or
      // unmeasured editor reports 1px, which would poison the fallback used
      // for lines that are outside the measured viewport.
      const measurable = contentWidth >= 40;
      const widthChanged = this.lastWidth !== null && measurable && Math.abs(this.lastWidth - contentWidth) > 1;
      if (measurable) this.lastWidth = contentWidth;
      // Keep styles for image lines that merely left the rendered viewport.
      // Dropping them makes the line re-render at its natural width when it
      // scrolls back, which is the main source of the viewport jump. Only a
      // document edit or a container resize may invalidate a cached entry.
      for (const position of [...this.layoutStyles.keys()]) {
        if (nextStyles.has(position)) continue;
        if (!docChanged && !widthChanged && isImagePosition(this.view.state.doc, position)) continue;
        this.layoutStyles.delete(position);
        changes.push([position, null]);
      }
      if (changes.length) {
        const scrollRevision = this.scrollRevision;
        const anchor = captureAnchor ? this.captureScrollAnchor() : null;
        // Decoration effects rebuild Obsidian's image widgets. Ignore the
        // resulting childList records so our own update cannot schedule a
        // second layout pass and flash the gallery.
        this.mutationPause = true;
        // The committed geometry is about to land. Its effect must outrank the
        // gesture preview, but the preview positions stay known until the
        // dispatch has rebuilt the decorations - otherwise they would be read
        // back as published styles.
        gestureGeometry.beginPublish();
        try {
          this.view.dispatch({ effects: setLayoutEffect.of(changes) });
        } finally {
          gestureGeometry.release();
        }
        // The caption reads the freshly published custom properties, so it has
        // to be repositioned in this same task. Waiting for another pass would
        // leave a stale `margin-inline` on every static document.
        this.syncCaptionGeometry(settings);
        // Layout decorations change line geometry without changing the
        // document. Ask CodeMirror to rebuild its coordinate map so
        // posAtCoords/coordsAtPos and arrow-key navigation follow the
        // compressed gallery layout immediately.
        this.view.requestMeasure();
        // Controls (alignment arrows) read the computed float, so they must
        // refresh after the decoration has published the new width.
        this.view.dom.dispatchEvent(new CustomEvent("ag-layout-changed"));
        // Applying the final width after a lazy image load changes line
        // geometry. Keep the reading position anchored to the first visible
        // line unless the user scrolled during this layout transaction.
        // Restoring in this task matters: a restore scheduled for the next
        // frame lets the browser paint the shifted geometry once and then
        // correct it, which reads as a second, backwards jump.
        if (anchor) this.restoreScrollAnchor(anchor);
        requestAnimationFrame(() => {
          if (!this.view) return;
          this.view.requestMeasure();
          if (anchor && this.scrollRevision === scrollRevision) this.restoreScrollAnchor(anchor);
        });
        setTimeout(() => {
          this.mutationPause = false;
          if (this.mutationRefreshPending) {
            this.mutationRefreshPending = false;
            this.sync();
          }
        }, 0);
      }
      result.published = changes.length > 0;
      if (result.published) this.publishSerial += 1;
      // A revealed row is laid out from the code line's height, which is only
      // exact once the block style has been applied. Compare the settled text
      // height with the one this pass used; the row's own reserved padding is
      // part of the line box, so it must be subtracted rather than compared
      // against the code height directly.
      result.mismatch = result.published && reveals.some(revealHeightMismatch);
      return result;
    }

    /**
     * True when an image line just rendered without its final width and the
     * size it needs is already known. Those lines would otherwise be painted
     * once at their natural size, which is the visible jump while scrolling.
     */
    needsImmediateLayout() {
      for (const line of this.view.dom.querySelectorAll(".cm-line.ag-cm-image-line")) {
        if (line.classList.contains("ag-cm-list-line")) {
          // A list line always carries the editor's indentation, so its style
          // attribute says nothing about this pass. Its geometry lives on the
          // embed, which is what tells a laid-out picture from a fresh one.
          const embed = line.querySelector(".image-embed, .internal-embed");
          // A missing file has no width to publish and never will; asking for
          // one would keep the synchronous path busy on every single measure.
          if (!embed || embed.classList.contains("mod-empty-attachment")) continue;
          if (!embed.style.getPropertyValue("--ag-embed-width")) return true;
          continue;
        }
        if (line.getAttribute("style")) continue;
        // Only lines this plugin actually lays out. An image without the
        // embed wrapper never receives a width, so it must not keep the
        // synchronous path busy.
        if (!line.querySelector(".image-embed, .internal-embed")) continue;
        const image = line.querySelector("img:not(.cm-widgetBuffer)");
        if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return true;
        if (imageMetric(metricKeyForLine(this.view, line))) return true;
      }
      return false;
    }

    /**
     * Anchor the reading position to the first line under the viewport top.
     * Height changes above the viewport then move `scrollTop` by the same
     * amount instead of shifting what the reader is looking at.
     */
    captureScrollAnchor() {
      const scroller = this.view.scrollDOM;
      const top = scroller.getBoundingClientRect().top;
      let element = null;
      for (const line of this.view.dom.querySelectorAll(".cm-line")) {
        const rect = line.getBoundingClientRect();
        if (rect.bottom > top + 1) {
          element = line;
          break;
        }
      }
      return {
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
        element,
        offset: element ? element.getBoundingClientRect().top : 0
      };
    }

    restoreScrollAnchor(anchor) {
      const scroller = this.view.scrollDOM;
      if (anchor.element?.isConnected) {
        const delta = anchor.element.getBoundingClientRect().top - anchor.offset;
        if (Math.abs(delta) > 0.5 && Math.abs(delta) < scroller.clientHeight) {
          scroller.scrollTop += delta;
          return;
        }
      }
      if (Math.abs(scroller.scrollTop - anchor.scrollTop) > 1) scroller.scrollTop = anchor.scrollTop;
      if (Math.abs(scroller.scrollLeft - anchor.scrollLeft) > 1) scroller.scrollLeft = anchor.scrollLeft;
    }

    destroy() {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      if (this.frameTimer !== null) clearTimeout(this.frameTimer);
      if (this.loadTimer !== null) clearTimeout(this.loadTimer);
      if (this.retryTimer !== null) clearTimeout(this.retryTimer);
      if (this.primeTimer !== null) clearTimeout(this.primeTimer);
      this.unwatchSizes?.();
      this.observer.disconnect();
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.view.dom.removeEventListener("load", this.onImageLoad, true);
      this.view.dom.removeEventListener("ag-layout-invalid", this.onLayoutInvalid);
      this.view.dom.ownerDocument?.defaultView?.removeEventListener("ag-settings-changed", this.onSettingsChanged);
    }
  });

  const theme = EditorView.baseTheme({
    ".cm-line.ag-cm-image-line": {
      whiteSpace: "normal !important",
      minWidth: "0"
    },
    // A list item owns the indentation column its marker hangs in. Its
    // pictures must stay in the inline flow - a block box would push the
    // marker onto a line of its own above every image - and one line never
    // wraps: the indent plus a full-column picture is exactly the line box.
    ".cm-line.ag-cm-list-line": {
      whiteSpace: "nowrap !important",
      // Absolute row cells are anchored to their own line, and a list line is
      // the only box the plugin is allowed to position against.
      position: "relative"
    },
    // A row's following cells are moved onto the row's top edge from the layout
    // pass, which is the only place that knows a picture's real size.
    //
    // The line collapses to zero height so the row is as tall as its first cell
    // only. That is done with zero line height rather than `height: 0`: a block
    // whose declared height disagrees with its content makes CodeMirror rebuild
    // the row on every measure, which is the flicker. The indent node must stay
    // in the flow - hiding it made the editor drop the line's indentation, and
    // the row then started one indent to the left of the item's text.
    ".cm-line.ag-cm-list-cell": {
      lineHeight: "0 !important",
      minHeight: "0 !important",
      overflow: "visible"
    },
    // A cell with no embed at all is being edited: the picture is replaced by
    // its source, so the line has to show that text with a normal line height.
    ".cm-line.ag-cm-list-cell:not(:has(> .internal-embed))": {
      lineHeight: "normal !important"
    },
    ".cm-line.ag-cm-list-cell .internal-embed, .cm-line.ag-cm-list-cell .image-embed": {
      position: "absolute !important",
      left: "0",
      top: "0"
    },
    // A cell without a picture - a broken link, an attachment that failed to
    // load - has no geometry to place. It goes back to the normal flow so its
    // notice occupies the line box; absolutely positioned it covered the source
    // line as soon as the reader clicked into it.
    // A list item never wraps, which would clip a long link path in the notice
    // Obsidian puts in place of a missing file. A line without a picture is not
    // a picture line: let its notice wrap and take the height it needs.
    ".cm-line.ag-cm-list-line:has(> .internal-embed.mod-empty-attachment)": {
      whiteSpace: "normal !important",
      lineHeight: "normal !important"
    },
    // A caption describes a picture. When the file is gone there is nothing to
    // describe, and its reserved box only pushed the notice away from the line
    // it belongs to.
    ".cm-line.ag-cm-image-line:has(> .internal-embed.mod-empty-attachment) .ag-cm-caption": {
      display: "none !important"
    },
    ".cm-line.ag-cm-list-cell:has(> .internal-embed.mod-empty-attachment)": {
      lineHeight: "normal !important"
    },
    ".cm-line.ag-cm-list-cell:has(> .internal-embed.mod-empty-attachment) > .internal-embed": {
      position: "relative !important",
      left: "auto !important",
      top: "auto !important"
    },
    ".cm-line.ag-cm-image-line.ag-cm-list-line .internal-embed, .cm-line.ag-cm-image-line.ag-cm-list-line .image-embed": {
      display: "inline-block !important",
      float: "none !important",
      verticalAlign: "top",
      // Positioning a centred or right-aligned picture must not move the
      // marker, so the shift is applied to the picture alone.
      transform: "translate(var(--ag-list-shift-x, 0px), 0px)"
    },
    // A row cell is moved as a whole, caption included, from the layout pass.
    ".cm-line.ag-cm-image-line.ag-cm-list-line.ag-cm-gallery-line": {
      overflow: "visible"
    },
    ".cm-line.ag-cm-image-line .internal-embed, .cm-line.ag-cm-image-line .image-embed": {
      display: "block !important",
      boxSizing: "border-box",
      position: "relative",
      float: "var(--ag-embed-float, none)",
      width: "var(--ag-embed-width, 100%)",
      maxWidth: "var(--ag-embed-max-width, 100%)",
      marginBlockStart: "0 !important",
      marginBlockEnd: "0 !important",
      padding: "0 !important",
      marginInline: "var(--ag-embed-margin, 0px)",
      marginInlineStart: "var(--ag-embed-gap-start, var(--ag-embed-margin, 0px))",
      marginInlineEnd: "var(--ag-embed-gap-end, var(--ag-embed-margin, 0px))"
    },
    ".cm-line.ag-cm-image-line .image-embed .embed-actions, .cm-line.ag-cm-image-line .internal-embed .embed-actions": {
      position: "absolute !important",
      insetInlineEnd: "8px !important",
      insetInlineStart: "auto !important",
      right: "8px !important",
      left: "auto !important",
      maxWidth: "100%",
      boxSizing: "border-box"
    },
    // A gallery cell that cannot host the horizontal bar stacks the same
    // controls instead of spilling them over its neighbour. `nowrap` and
    // fixed-width items cannot shrink, so a clamped container only hides the
    // overflow in its own box - the items keep their width and paint, and take
    // pointer events, on top of the next cell.
    ".cm-line.ag-cm-image-line .image-embed .embed-actions.ag-actions-compact, .cm-line.ag-cm-image-line .internal-embed .embed-actions.ag-actions-compact": {
      flexDirection: "column !important",
      top: "8px !important",
      bottom: "auto !important",
      right: "8px !important",
      left: "auto !important",
      insetInlineEnd: "8px !important",
      insetInlineStart: "auto !important",
      width: "max-content !important",
      maxWidth: "none !important",
      height: "auto !important"
    },
    // The smallest rail: same stack, tighter inset and 24px controls. Used
    // when the cell is narrower than a full rail plus its gutter.
    ".cm-line.ag-cm-image-line .image-embed .embed-actions.ag-actions-compact-small, .cm-line.ag-cm-image-line .internal-embed .embed-actions.ag-actions-compact-small": {
      flexDirection: "column !important",
      top: "2px !important",
      bottom: "auto !important",
      right: "2px !important",
      left: "auto !important",
      insetInlineEnd: "2px !important",
      insetInlineStart: "auto !important",
      width: "max-content !important",
      maxWidth: "none !important",
      height: "auto !important"
    },
    ".cm-line.ag-cm-image-line .image-embed .embed-actions.ag-actions-compact-small > *, .cm-line.ag-cm-image-line .internal-embed .embed-actions.ag-actions-compact-small > *": {
      width: "24px !important",
      minWidth: "24px !important",
      // 16px icon plus 4px on each side keeps the target square.
      padding: "4px !important"
    },
    // No rail fits. Hiding is the only placement that cannot steal a
    // neighbour's hover; a bar that leaves the cell would answer for the wrong
    // image.
    ".cm-line.ag-cm-image-line .image-embed .embed-actions.ag-actions-hidden, .cm-line.ag-cm-image-line .internal-embed .embed-actions.ag-actions-hidden": {
      display: "none !important"
    },
    ".cm-line.ag-cm-image-line .image-embed .image-wrapper, .cm-line.ag-cm-image-line .internal-embed .image-wrapper": {
      display: "block !important",
      position: "relative !important",
      boxSizing: "border-box",
      // The parent embed already owns the computed width. The wrapper must
      // fill that cell rather than apply the percentage a second time.
      width: "100% !important",
      maxWidth: "100% !important",
      marginInlineStart: "0 !important",
      marginInlineEnd: "0 !important"
    },
    // Before a lazy image has a calculated AutoGallery width, keep Obsidian's
    // intrinsic inline-flex sizing. A block at 100% width makes a very tall
    // portrait image occupy the whole viewport before the next measure pass,
    // which causes scroll jumps when the final width is applied.
    ".cm-line.ag-cm-image-line:not([style]) .internal-embed, .cm-line.ag-cm-image-line:not([style]) .image-embed": {
      display: "inline-flex !important",
      width: "fit-content !important",
      maxWidth: "100% !important",
      float: "none !important",
      marginInline: "0 !important"
    },
    ".cm-line.ag-cm-image-line:not([style]) .image-embed .image-wrapper, .cm-line.ag-cm-image-line:not([style]) .internal-embed .image-wrapper": {
      display: "flex !important",
      width: "auto !important",
      maxWidth: "100% !important"
    },
    ".cm-line.ag-cm-image-line br": { display: "none !important" },
    ".cm-line.ag-cm-image-line img": {
      display: "block !important",
      width: "100% !important",
      maxWidth: "100% !important",
      height: "var(--ag-img-height, auto) !important",
      aspectRatio: "var(--ag-img-aspect, auto)",
      objectPosition: "var(--ag-img-focus, 50% 50%)",
      objectViewBox: "var(--ag-img-view-box, none)",
      margin: "0 auto !important",
      objectFit: "var(--ag-img-fit, contain)"
    },
    // Obsidian renders each table cell in a nested CodeMirror instance whose
    // document is just the cell's inline content. That instance carries this
    // extension too, and its `.cm-line` is not a document line: the image must
    // keep the table's sizing, never `width: 100%` of a shrink-to-fit cell.
    // Inline crop styles are published by `decorateTableImages` and win over
    // these resets because they are `!important` declarations on the element.
    ".table-cell-wrapper .cm-line.ag-cm-image-line": {
      whiteSpace: "normal !important",
      width: "auto !important",
      minWidth: "0 !important",
      verticalAlign: "top !important"
    },
    ".table-cell-wrapper .cm-line.ag-cm-image-line .internal-embed, .table-cell-wrapper .cm-line.ag-cm-image-line .image-embed": {
      // Block, not inline-flex: a 200px-tall inline box on a 24px source line
      // sits on the baseline and grows upwards over the line being edited.
      display: "block !important",
      float: "none !important",
      clear: "none !important",
      width: "fit-content !important",
      maxWidth: "none !important",
      margin: "0 !important",
      padding: "0 !important",
      verticalAlign: "top !important"
    },
    // While a cell is edited Obsidian shows the source line and floats the
    // picture preview above it. This extension positions that preview for
    // normal image lines, but a nested cell editor deliberately skips the
    // layout pass, so the unanchored preview covered the line being edited.
    // The cell shows source only while focused; the picture returns when the
    // cell loses focus and the table renders again.
    ".table-cell-wrapper .cm-image-reveal-tooltip, .table-cell-wrapper .cm-image-reveal-gap": {
      display: "none !important",
      height: "0 !important",
      margin: "0 !important",
      padding: "0 !important"
    },
    ".table-cell-wrapper .cm-line.ag-cm-image-line .image-wrapper": {
      display: "block !important",
      width: "auto !important",
      maxWidth: "none !important"
    },
    ".table-cell-wrapper .cm-line.ag-cm-image-line img": {
      display: "block !important",
      width: "auto !important",
      maxWidth: "none !important",
      height: "auto !important",
      aspectRatio: "auto !important",
      objectFit: "fill !important",
      objectPosition: "50% 50% !important",
      objectViewBox: "none !important",
      margin: "0 !important"
    },
    // The rendered table embed is a bare inline `<span>` around the picture.
    // Without a positioned box of its own, Obsidian's `.embed-actions` (which
    // this extension now creates for table images) anchors to the editor and
    // lands far away from the picture; the span must also shrink-wrap the
    // bitmap so its box - and therefore the hit area - is the picture.
    ".table-cell-wrapper .image-embed, .table-cell-wrapper .internal-embed": {
      position: "relative !important",
      display: "inline-block !important",
      width: "fit-content !important",
      maxWidth: "100% !important",
      verticalAlign: "top !important"
    },
    ".table-cell-wrapper .image-embed .image-wrapper, .table-cell-wrapper .internal-embed .image-wrapper": {
      display: "block !important",
      width: "fit-content !important",
      maxWidth: "100% !important"
    },
    // Obsidian's source-view placeholder is an inline image buffer. It is
    // deliberately excluded from measurement above, so it must also be
    // removed from layout or its inline box leaves a phantom vertical gap.
    ".cm-line.ag-cm-image-line img.cm-widgetBuffer": {
      display: "none !important",
      width: "0 !important",
      height: "0 !important",
      margin: "0 !important",
      padding: "0 !important"
    },
    ".cm-line.ag-cm-image-line .ag-cm-caption": {
      display: "block",
      width: "var(--ag-embed-width, 100%)",
      maxWidth: "100%",
      // Caption widgets can be direct children of .cm-line. Padding, rather
      // than margin, reliably contributes to the line box beside floated
      // embeds and avoids margin-collapse differences between widget shapes.
      marginTop: "0 !important",
      marginBottom: "0",
      padding: "0",
      lineHeight: "normal",
      verticalAlign: "top",
      marginInlineStart: "var(--ag-caption-margin-start, var(--ag-embed-margin, auto))",
      marginInlineEnd: "var(--ag-caption-margin-end, var(--ag-embed-margin, auto))",
      textAlign: "center",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      boxSizing: "border-box",
      clear: "both"
    },
    ".cm-line.ag-cm-image-line .cm-widgetBuffer:has(.ag-cm-caption)": {
      display: "block",
      width: "100%",
      height: "auto",
      margin: "0",
      padding: "0",
      lineHeight: "normal"
    },
    // Some Obsidian versions wrap the caption widget in a plain div instead
    // of a .cm-widgetBuffer. The wrapper must not duplicate captionGap.
    ".cm-line.ag-cm-image-line :is(div, span):has(> .ag-cm-caption)": {
      display: "flow-root !important",
      marginBlockStart: "0 !important",
      marginBlockEnd: "0 !important",
      paddingBlockStart: "0 !important",
      paddingBlockEnd: "0 !important"
    },
    ".cm-line.ag-cm-gallery-line": { verticalAlign: "top" },
    // Column boundaries and the row-height bar sit in the gutters around a
    // cell, so the cell itself must never clip them.
    ".cm-line.ag-cm-gallery-line .internal-embed, .cm-line.ag-cm-gallery-line .image-embed": {
      overflow: "visible"
    },
    // Obsidian's corner resizes one picture's width. A gallery cell's width
    // comes from the row packing, so the handle cannot do anything - hide it
    // rather than leave a control that silently does nothing.
    ".cm-line.ag-cm-gallery-line .image-resize-corner, .cm-line.ag-cm-gallery-line .image-resize-handle": {
      display: "none !important"
    },
    // While an embed's source is shown, Obsidian moves the embed into
    // `.cm-image-reveal-tooltip` and the plugin sizes the tooltip to the width
    // the image had. The embed itself stays `inline-flex`, so it shrink-wraps
    // to the image's intrinsic width: an image narrower than that width is
    // then rendered at its natural size against the box's left edge, which
    // reads as the image shrinking and losing its alignment as soon as the
    // edit state starts. The tooltip box owns the width, so every level below
    // it must fill that box rather than measure the bitmap.
    ".cm-image-reveal-tooltip .image-embed, .cm-image-reveal-tooltip .internal-embed": {
      display: "block !important",
      width: "100% !important",
      maxWidth: "100% !important",
      float: "none !important"
    },
    ".cm-image-reveal-tooltip .image-embed .image-wrapper, .cm-image-reveal-tooltip .internal-embed .image-wrapper": {
      display: "block !important",
      width: "100% !important",
      maxWidth: "100% !important"
    },
    // The preview box is placed by the plugin, but the editor keeps writing
    // `style.left`/`style.top` on its own measure and scroll passes. Assigning
    // through `element.style` replaces the declaration *and* its `!important`
    // priority, so an inline anchor loses on the very next frame and the
    // preview jumps back to the editor's position. Geometry therefore lives in
    // this rule, which outranks any inline declaration, and the values arrive
    // through custom properties the editor never writes.
    ".cm-image-reveal-tooltip.ag-reveal-anchored": {
      left: "var(--ag-reveal-left) !important",
      top: "var(--ag-reveal-top) !important",
      width: "var(--ag-reveal-width) !important",
      // Drop the popover chrome and the height the editor derives from the
      // embed's old box, otherwise the image is clipped or floats above the
      // reserved area. `overflow` must stay visible so the accent ring drawn
      // two pixels outside the preview image is not cut off.
      height: "auto !important",
      lineHeight: "0 !important",
      fontSize: "0 !important",
      padding: "0 !important",
      margin: "0 !important",
      transform: "none !important",
      background: "transparent !important",
      border: "none !important",
      borderRadius: "0 !important",
      boxShadow: "none !important",
      pointerEvents: "none !important",
      overflow: "visible !important",
      outline: "none !important"
    }
  });
  return [decorations, plugin, theme];
}

function readLayoutStyles(decorations, state) {
  const layouts = new Map();
  const notePath = state.field(editorInfoField, false)?.file?.path || "";
  decorations.between(0, state.doc.length, (from, _to, decoration) => {
    const styleText = decoration.spec.attributes?.style;
    if (!styleText) return;
    // A line the gesture is previewing carries live geometry in its `style`
    // attribute. Read the published value captured when the gesture started
    // instead; treating the preview as published would make it permanent for a
    // line the committed pass does not re-emit.
    const published = gestureGeometry.publishedStyle(notePath, from, styleText);
    if (!published) return;
    const style = parseStyleText(published);
    if (Object.keys(style).length) layouts.set(from, style);
  });
  return layouts;
}

function isLivePreview(state) {
  try { return state.field(editorLivePreviewField, false) === true; }
  catch { return false; }
}

function clearPluginWidgetStyles(root) {
  clearEmbedActionsPlacement(root);
  clearListGeometry(root);
  for (const caption of root.querySelectorAll(".ag-cm-caption")) caption.removeAttribute("style");
  // A revealed image is Obsidian's own state. Drop only what the plugin added,
  // so disabling it while the source is shown keeps the native preview usable.
  for (const gap of root.querySelectorAll(".cm-image-reveal-gap")) {
    for (const property of ["float", "clear", "width", "margin", "padding", "box-sizing"]) {
      gap.style.removeProperty(property);
    }
  }
  for (const tooltip of root.querySelectorAll(".cm-image-reveal-tooltip")) {
    tooltip.classList.remove("ag-reveal-anchored");
    for (const property of [
      "transform", "left", "top", "width", "height", "line-height", "font-size", "padding",
      "margin", "background", "border", "border-radius", "box-shadow", "pointer-events",
      "overflow", "outline", "outline-offset",
      "--ag-reveal-left", "--ag-reveal-top", "--ag-reveal-width"
    ]) tooltip.style.removeProperty(property);
    for (const image of tooltip.querySelectorAll("img")) {
      for (const property of [
        "width", "max-width", "height", "object-fit", "object-position", "outline", "outline-offset"
      ]) image.style.removeProperty(property);
    }
  }
}

/**
 * Geometry a list line cannot carry in a decoration.
 *
 * Publishing `style` through a line decoration replaces the whole inline style
 * of the line, and that is where the editor keeps a list item's indentation:
 * the marker jumps to the left edge and every following line loses the column
 * the row was measured against. The values are therefore written on the
 * element itself, which leaves the editor's own declarations alone.
 */
const listStyleProperties = new WeakMap();

function applyListGeometry(view, listStyles) {
  if (!listStyles?.size) return;
  for (const { element, style } of listStyles.values()) {
    if (!element?.isConnected) continue;
    const applied = listStyleProperties.get(element) ?? [];
    const next = [];
    for (const [property, value] of Object.entries(style)) {
      if (value === undefined || value === null || value === "") continue;
      next.push(property);
      if (element.style.getPropertyValue(property) !== value
        || element.style.getPropertyPriority(property) !== "important") {
        element.style.setProperty(property, value, "important");
      }
    }
    // A cell that stopped being a row member must not keep the row's height
    // or its slot.
    for (const property of applied) {
      if (!next.includes(property)) element.style.removeProperty(property);
    }
    listStyleProperties.set(element, next);
  }
  // These pictures publish nothing through the decoration map, so the controls
  // would never hear that a picture changed size or left its row.
  view?.dom?.dispatchEvent(new CustomEvent("ag-layout-changed"));
}

function clearListGeometry(root) {
  const selector = ".ag-cm-list-line .internal-embed, .ag-cm-list-line .image-embed, .ag-cm-list-line .ag-cm-caption";
  for (const element of root?.querySelectorAll?.(selector) ?? []) {
    for (const property of listStyleProperties.get(element) ?? []) element.style.removeProperty(property);
    listStyleProperties.delete(element);
  }
}

function buildDecorations(state, layouts) {
  if (!isLivePreview(state)) return Decoration.none;
  const builder = new RangeSetBuilder();
  const lineClasses = new Map();
  const source = state.doc.toString();
  // Pictures that belong to a list item. They are image lines of the note but
  // not standalone ones: the marker and the item's indentation own their
  // horizontal placement, and a second picture of the same item forms the row
  // the reading view draws. Resolve them first so the standalone grouping
  // below cannot claim a continuation line for the column-wide layout.
  const listLayout = readListImageLayout(source);
  for (const rawGroup of findImageLineGroups(source)) {
    const group = rawGroup.filter((lineNumber) => !listLayout.has(lineNumber));
    if (!group.length) continue;
    const gallery = group.length > 1;
    for (const lineNumber of group) {
      const line = state.doc.line(lineNumber);
      const annotation = parseAnnotationFromSourceLine(line.text);
      if (annotation.params.exclude) continue;
      lineClasses.set(lineNumber, gallery ? "ag-cm-image-line ag-cm-gallery-line" : "ag-cm-image-line");
    }
    if (gallery) {
      for (let lineNumber = group[0]; lineNumber <= group[group.length - 1]; lineNumber += 1) {
        const line = state.doc.line(lineNumber);
        if (line.text.trim() === "") lineClasses.set(lineNumber, "ag-cm-gallery-gap");
      }
      let clearLine = group[group.length - 1] + 1;
      if (clearLine <= state.doc.lines) lineClasses.set(clearLine, "ag-cm-gallery-clear");
    }
  }
  for (const [lineNumber, info] of listLayout) {
    const line = state.doc.line(lineNumber);
    const annotation = parseAnnotationFromSourceLine(line.text);
    if (annotation.params.exclude) continue;
    // The run id is part of the class because the layout pass groups the
    // rendered lines by it: two neighbouring items - or a picture isolated out
    // of its row - must never share a row.
    const classes = ["ag-cm-image-line", "ag-cm-list-line", `ag-cm-list-run-${info.runId}`];
    if (info.first === false) classes.push("ag-cm-list-cont");
    if (info.gallery) classes.push("ag-cm-gallery-line");
    // A row's following cells are moved onto the row's top edge; the first one
    // stays in the flow and is the only member that gives the row a height.
    if (info.cell) classes.push("ag-cm-list-cell");
    lineClasses.set(lineNumber, classes.join(" "));
  }
  const entries = [...lineClasses.entries()].sort(([a], [b]) => a - b);
  // A gallery gesture caches the exact inline style it is painting for each
  // dragged line. Painting that cache here is what makes the preview survive a
  // rebuild: re-applying the *published* geometry on the commit transaction is
  // the flash visible when the pointer is released.
  const notePath = state.field(editorInfoField, false)?.file?.path || "";
  for (const [lineNumber, className] of entries) {
    const line = state.doc.line(lineNumber);
    const style = className.includes("ag-cm-image-line")
      ? layouts.get(line.from)
      : className === "ag-cm-gallery-gap" ? { display: "none" }
        : className === "ag-cm-gallery-clear" ? { clear: "both" } : null;
    const attributes = { class: className };
    const liveStyle = gestureGeometry.styleAt(notePath, line.from);
    if (liveStyle) attributes.style = liveStyle;
    else if (style && Object.keys(style).length) attributes.style = styleToText(style);
    builder.add(line.from, line.from, Decoration.line({ attributes }));
    const annotation = parseAnnotationFromSourceLine(line.text);
    if (annotation.caption) {
      builder.add(line.to, line.to, Decoration.widget({ widget: new CaptionWidget(annotation.caption), side: 1 }));
    }
  }
  return builder.finish();
}

/**
 * Publish a crop as CSS variables. The view box selects the exact source
 * rectangle, so the frame ratio and the box ratio agree and no fit switch is
 * needed. A build without `object-view-box` keeps the legacy cover/position
 * fallback, which is exact for a maximal frame and approximate otherwise.
 */
function applyCropStyle(style, crop, natural) {
  const ratio = effectiveCropRatio(crop, natural);
  if (!ratio) return { viewBox: null };
  style["--ag-img-aspect"] = `${Math.round(ratio * 10000) / 10000}`;
  if (!natural) return { viewBox: null };
  const region = cropRegion(crop, natural);
  if (!region) return { viewBox: null };
  if (supportsViewBox()) {
    const value = viewBoxValue(region, natural);
    if (value) {
      style["--ag-img-view-box"] = value;
      return { viewBox: value };
    }
  }
  style["--ag-img-fit"] = "cover";
  const point = fallbackFocus(region, natural, ratio);
  if (point) style["--ag-img-focus"] = `${point.x}% ${point.y}%`;
  return { viewBox: null };
}

/**
 * Publish a crop for a picture inside a table cell. Tables are rendered by
 * Obsidian as a widget (MarkdownRenderer output) or as nested cell editors,
 * neither of which is a `.cm-line` this extension lays out. The crop therefore
 * has to size the bitmap itself: the largest box of the crop ratio that still
 * fits the source, then `object-view-box` selects the region inside it.
 */
function decorateTableImages(view) {
  const inCellEditor = Boolean(view.dom.closest?.(".table-cell-wrapper"));
  const images = view.dom.querySelectorAll(inCellEditor ? "img" : "td img, th img");
  for (const image of images) {
    if (image.classList.contains("cm-widgetBuffer")) continue;
    const annotation = readImageAnnotation(image);
    const crop = annotation.params.crop;
    const owned = image.dataset.agTableCrop === "true";
    // A cell being edited moves the picture into a floating reveal preview.
    // That preview is hidden inside a table cell (see the base theme); sizing
    // it here would only leave an oversized box behind the source line.
    if (image.closest(".cm-image-reveal-tooltip")) {
      if (owned) clearTableCrop(image);
      continue;
    }
    // A table rendered inside a callout is part of the callout, which is left
    // entirely to Obsidian.
    if (image.closest(".callout")) {
      if (owned) clearTableCrop(image);
      continue;
    }
    if (annotation.params.exclude || !crop) {
      if (owned) clearTableCrop(image);
      continue;
    }
    const natural = tableImageNatural(view, image);
    const ratio = natural ? effectiveCropRatio(crop, natural) : null;
    const region = natural ? cropRegion(crop, natural) : null;
    if (!natural || !ratio || !region) {
      if (owned) clearTableCrop(image);
      continue;
    }
    // Largest crop-ratio box inside the bitmap: a square crop of a landscape
    // picture stays 200px wide instead of being stretched back to 400px.
    const width = Math.max(1, Math.min(natural.width, natural.height * ratio));
    const height = width / ratio;
    image.dataset.agTableCrop = "true";
    image.style.setProperty("display", "block", "important");
    image.style.setProperty("width", `${width}px`, "important");
    image.style.setProperty("height", `${height}px`, "important");
    image.style.setProperty("max-width", "none", "important");
    if (supportsViewBox()) {
      const value = viewBoxValue(region, natural);
      if (value) {
        image.style.setProperty("object-view-box", value, "important");
        image.style.removeProperty("object-position");
        image.style.setProperty("object-fit", "fill", "important");
        continue;
      }
    }
    image.style.removeProperty("object-view-box");
    image.style.setProperty("object-fit", "cover", "important");
    const point = fallbackFocus(region, natural, ratio);
    if (point) image.style.setProperty("object-position", `${point.x}% ${point.y}%`, "important");
  }
  // The picture's box decides the line height. CodeMirror caches those heights;
  // without a fresh measure the next line is placed against the old box and
  // the bitmap paints over the source line being edited.
  view.requestMeasure?.();
}

const TABLE_CROP_PROPERTIES = [
  "display", "width", "height", "max-width", "object-fit", "object-position", "object-view-box"
];

function clearTableCrop(image) {
  for (const property of TABLE_CROP_PROPERTIES) image.style.removeProperty(property);
  delete image.dataset.agTableCrop;
}

function tableImageNatural(view, image) {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  let notePath = "";
  try { notePath = view.state.field(editorInfoField, false)?.file?.path || ""; } catch { notePath = ""; }
  const embed = image.closest(".image-embed, .internal-embed");
  const link = embed?.getAttribute?.("src") || image.getAttribute("src") || "";
  const key = link ? imageMetricKey(notePath, link) : "";
  return key ? imageMetric(key) : null;
}

/**
 * Source-side gallery index for the current document. The groups come from the
 * same helper the decorations are built with, so a row is packed from the note
 * rather than from whichever of its lines CodeMirror happens to render.
 */
const galleryIndexCache = new WeakMap();

function sourceGalleryIndex(state) {
  const cached = galleryIndexCache.get(state.doc);
  if (cached) return cached;
  const byLine = new Map();
  const all = new Set();
  for (const group of findImageLineGroups(state.doc.toString())) {
    for (const number of group) {
      byLine.set(number, group);
      all.add(number);
    }
  }
  const index = { byLine, all };
  galleryIndexCache.set(state.doc, index);
  return index;
}

function notePathForView(view) {
  try { return view.state.field(editorInfoField, false)?.file?.path || ""; } catch { return ""; }
}

/**
 * The gallery run a rendered group belongs to, completed with the members that
 * are not rendered right now.
 *
 * A row is one visual unit, but its cells are separate document lines that
 * CodeMirror renders independently. Packing only the rendered subset gives a
 * two-cell row for a three-image gallery, and the third cell re-packs the row
 * the moment it scrolls in — the gallery visibly changes width while the
 * reader is looking at it. The source run plus the primed image sizes describe
 * the whole row, so the widths are final from the first pass.
 *
 * A member whose ratio is unknown would be packed as a 1:1 placeholder and
 * change every other cell, so the rendered subset is returned unchanged; the
 * row is completed on a later pass.
 */
function gallerySlots(view, group, sizeFor) {
  const slots = group.map((line) => ({
    line,
    lineNumber: lineNumberForDOM(view, line),
    size: sizeFor(line),
    params: annotationParamsForLine(view, line)
  }));
  const index = sourceGalleryIndex(view.state);
  const first = slots[0]?.lineNumber;
  const sourceGroup = Number.isInteger(first) ? index.byLine.get(first) : null;
  if (!sourceGroup || sourceGroup.length <= slots.length) return slots;
  const present = new Set(slots.map((slot) => slot.lineNumber));
  const missing = sourceGroup.filter((number) => !present.has(number));
  if (!missing.length) return slots;
  const notePath = notePathForView(view);
  const extras = [];
  for (const number of missing) {
    const text = view.state.doc.line(number).text;
    const params = parseAnnotationFromSourceLine(text).params;
    const link = linkFromSourceLine(text);
    const size = link ? imageMetric(imageMetricKey(notePath, link)) : null;
    if (!size) return slots;
    extras.push({ line: null, lineNumber: number, size, params });
  }
  return [...slots, ...extras].sort((a, b) => a.lineNumber - b.lineNumber);
}

/** True when the source line after a gallery run is another image line. */
function isImageLineAfterGroup(view, slot) {
  if (!slot || !Number.isInteger(slot.lineNumber)) return false;
  return sourceGalleryIndex(view.state).all.has(slot.lineNumber + 1);
}

function collectVisibleLayoutStyles(view, settings, fallbackWidth = 0, widthLock = 0) {
  const lines = [...view.dom.querySelectorAll(".cm-line")];
  // A nested table-cell editor has its own `.cm-line`s. They are not document
  // lines, cannot carry a position in this view's document, and must never
  // contribute a width to the section layout.
  const imageLines = lines.filter((line) => line.classList.contains("ag-cm-image-line")
    && !line.closest(".table-cell-wrapper"));
  // List pictures are laid out against their item's content column, never the
  // section's: the marker and the indent are not available width. They also
  // never float - an item's box has to stay tall enough to hold them.
  const listLines = imageLines.filter((line) => line.classList.contains("ag-cm-list-line"));
  const flowLines = imageLines.filter((line) => !line.classList.contains("ag-cm-list-line"));
  const layouts = new Map();
  const listStyles = new Map();
  const reveals = [];
  collectIndividualStyles(flowLines.filter((line) => !line.classList.contains("ag-cm-gallery-line")), view, settings, layouts, fallbackWidth, reveals, widthLock);
  clearImagesAfterGallery(flowLines.filter((line) => !line.classList.contains("ag-cm-gallery-line")), view, layouts);
  const listPending = collectListStyles(listLines, view, settings, listStyles, reveals, fallbackWidth, widthLock).pending;

  const galleryLines = flowLines.filter((line) => line.classList.contains("ag-cm-gallery-line"));
  if (!galleryLines.length) return { styles: layouts, reveals, width: 0, listStyles, listPending, pending: false };

  const container = galleryContainerWidth(galleryLines, view, fallbackWidth, widthLock);
  if (!container) return { styles: layouts, reveals, width: 0, listStyles, listPending, pending: true };
  const gap = Number(settings.galleryGap ?? 12);
  const galleryControl = settings.galleryControl ?? "both";
  const maxPerRow = galleryControl === "height" ? 15 : Math.min(15, Math.max(2, Number(settings.galleryMaxPerRow ?? settings.maxImagesPerRow ?? 5)));
  const minGalleryHeight = galleryControl === "count" ? 0 : Math.max(0, Number(settings.galleryMinHeight ?? 100));
  // Cap on the height a lone gallery cell may occupy at full column width.
  // Beyond it the cell stops being a gallery member and takes the isolated
  // single-image layout instead. 0 disables the rule.
  const orphanMaxHeight = Math.max(0, Number(settings.galleryOrphanMaxHeight ?? config.gallery?.orphanMaxHeight ?? 400));
  let pendingGallery = false;
  let group = [];
  // Gap lines only belong to a group that was actually laid out. Hiding the
  // separator of a gallery that is still waiting for its ratios would take the
  // blank line's height away from a document that is not a row yet.
  let groupGaps = [];
  const hiddenGaps = new Set();
  const flush = () => {
    if (!group.length) { groupGaps = []; return; }
    // Never lay out a partial gallery. A lazy image temporarily reports zero
    // dimensions; using the remaining images changes widths and visibly flips
    // the row when that image finishes loading.
    const sizeFor = (line) => naturalSizeForLine(view, line, line.querySelector("img:not(.cm-widgetBuffer)"));
    const ready = group.every((line) => sizeFor(line) !== null);
    // One unmeasured gallery must not hold the whole note back: every other
    // line already knows its geometry and can be published now. The pending
    // group keeps whatever style it had and is retried when its ratio lands.
    if (!ready) { pendingGallery = true; group = []; groupGaps = []; return; }
    for (const gapLine of groupGaps) hiddenGaps.add(gapLine);
    // The row is packed from the source run, not from the lines CodeMirror
    // happens to have rendered. A member that is still outside the viewport
    // would otherwise be missing from the row, and the row would be packed at
    // two cells and then re-packed at three once it scrolls in — which reads as
    // the gallery resizing itself for no reason.
    const slots = gallerySlots(view, group, sizeFor);
    // A tall cell renders on its own while the rest of its row is still
    // outside CodeMirror's rendered range: the un-laid-out picture occupies
    // its natural height, which pushes every later cell past the viewport. The
    // row must therefore be packed from the source group on this first pass;
    // waiting for a second rendered cell means waiting until the reader has
    // scrolled past the whole picture, and the row then snaps into place.
    // A lone rendered cell is only usable when it is the group's first cell:
    // that line is what carries the row's height in CodeMirror's height map.
    // A later cell rendered on its own (a jump into the middle of a row) keeps
    // waiting for the first one, but is not retried: a viewport change will
    // bring that line in.
    if (slots.length < 2) {
      // A lone rendered cell whose row cannot be completed from the source
      // run would take the whole column on its own, so it keeps its previous
      // geometry instead. No retry: a missing ratio arrives through the size
      // probe, which asks for a pass of its own.
      group = [];
      groupGaps = [];
      return;
    }
    if (group.length === 1 && !slots[0].line) {
      group = [];
      groupGaps = [];
      return;
    }
    // Distance from the group's first row to the position where a block-level
    // line would be placed. Gallery cells are floats, so they never advance
    // the block flow; only a single-image row (a real block) does. A revealed
    // cell needs that offset to sit on its own row's top edge.
    let consumed = 0;
    let flowOffset = 0;
    // The same packer the reading view calls. The greedy loop that used to live
    // here split rows differently from `calculateGalleryRows`, so one note
    // looked different depending on which view happened to be open.
    const ratioInputs = slots.map((slot) => {
      const crop = slot.params?.crop;
      if (crop) {
        // The reading view feeds the *effective* ratio - the one the frame is
        // actually drawn with. Using the declared pair here made a crop whose
        // requested height did not fit below its top edge pack at a different
        // size in the two views.
        const ratio = effectiveCropRatio(crop, slot.size) ?? crop.w / crop.h;
        return { naturalWidth: ratio * 1000, naturalHeight: 1000, group: Number(slot.params?.group) > 0 ? Number(slot.params.group) : 0 };
      }
      return slot.size
        ? { naturalWidth: slot.size.width, naturalHeight: slot.size.height, group: Number(slot.params?.group) > 0 ? Number(slot.params.group) : 0 }
        : { naturalWidth: 1, naturalHeight: 1, group: Number(slot.params?.group) > 0 ? Number(slot.params.group) : 0 };
    });
    const packedRows = calculateGalleryRows(ratioInputs, container, {
      maxPerRow,
      minHeight: minGalleryHeight,
      gap,
      maxHeight: Number(settings.galleryMaxHeight ?? 0),
      rows: slots[0]?.params?.rows
    });
    if (!packedRows.length) { pendingGallery = true; group = []; return; }
    const containerWidth = container;
    let cursor = 0;
    for (const packedRow of packedRows) {
      const row = slots.slice(cursor, cursor + packedRow.items.length);
      cursor += row.length;
      if (!row.length) continue;
      const rowHeight = packedRow.height;
      // Every row but the last reserves the configured gap below itself. The
      // caption box already ends at the row's bottom edge, so without it a
      // caption touches the next row and a row without captions touches the
      // next image outright. The last row normally keeps the document's own
      // spacing — but only prose actually provides that spacing. An image line
      // that follows the gallery (an isolated member is the ordinary case)
      // has every vertical margin zeroed, so the last row has to own the gap
      // or the two pictures end up flush.
      const trailingGap = isImageLineAfterGroup(view, slots[slots.length - 1]) ? gap : 0;
      const rowGap = cursor >= slots.length ? trailingGap : gap;
      const rowTop = consumed;
      const revealedIndex = row.findIndex((slot) => slot.line && isRevealedImageLine(slot.line));
      const codeHeight = revealedIndex >= 0 ? revealedCodeHeight(row[revealedIndex].line, containerWidth) : 0;
      const codeOffset = revealedIndex >= 0 ? Math.max(0, rowTop - flowOffset) : 0;
      // A caption wraps at the cell width, so it has to be placed at that width
      // before it is measured. Measure every cell of the row and keep the
      // tallest: one caption that runs onto a second line must push the row
      // down, not overlap the row below it.
      const cellWidths = row.map((_slot, index) => (
        row.length === 1 ? containerWidth : packedRow.items[index].width
      ));
      row.forEach((slot, index) => {
        if (!slot.line || index === revealedIndex) return;
        positionCaptionWidgets(slot.line, cellWidths[index], settings, {}, true);
      });
      // A revealed cell hides its caption, so its row no longer reserves the
      // caption's box either.
      const rowCaptionHeight = revealedIndex === 0 ? 0 : rowCaptionBox(row, settings, revealedIndex);
      if (row.length === 1) {
        const slot = row[0];
        const line = slot.line;
        const crop = slot.params?.crop;
        const single = slot.size;
        // A lone cell spans the whole column, so its height follows the ratio
        // the reader actually sees. Reading the natural ratio here made a
        // cropped band render as the uncropped portrait it came from, which is
        // why `ag:crop` looked ignored whenever the image ended up alone.
        const ratio = crop
          ? (effectiveCropRatio(crop, single) ?? crop.w / crop.h)
          : single ? single.width / single.height : 0;
        const fullHeight = ratio > 0 ? containerWidth / ratio : 0;
        // The only member of the row is virtualised out. It still owns the
        // row's space, so the flow that follows starts at the right offset.
        if (!line) {
          consumed += fullHeight + rowGap;
          flowOffset = consumed;
          continue;
        }
        // A lone cell that would be much taller than a screenful no longer
        // reads as part of the gallery. It keeps an automatically routed width
        // but is forced onto the centred axis: a gallery is a grid, and a lone
        // cell that floats leaves the next line's text wrapping beside it,
        // which in Live Preview runs straight into the image's action bar.
        if (orphanMaxHeight > 0 && fullHeight > orphanMaxHeight && revealedIndex !== 0) {
          collectIndividualStyles([line], view, settings, layouts, containerWidth, reveals, widthLock, containerWidth, true);
          const isolated = layouts.get(linePosition(view, line));
          const isolatedWidth = Number.parseFloat(isolated?.["--ag-embed-width"]);
          const isolatedHeight = Number.isFinite(isolatedWidth) && ratio > 0
            ? isolatedWidth / ratio
            : fullHeight;
          if (isolated && rowGap > 0) isolated["padding-bottom"] = `${rowGap}px`;
          consumed += isolatedHeight + rowGap;
          flowOffset = consumed;
          continue;
        }
        const singleHeight = ratio > 0 ? containerWidth / ratio : 0;
        const style = {
          display: "block", width: "100%", "max-width": "100%", clear: "both",
          // A lone cell is still a gallery member: it keeps its slot in the run
          // so the reorder buttons can move it back into a row. It publishes
          // the same row geometry as a multi-image row, with itself as the row.
          "--ag-row-height": `${singleHeight}px`,
          "--ag-row-box": `${singleHeight + rowCaptionHeight}px`,
          "--ag-row-width": `${containerWidth}px`,
          "--ag-row-content": `${containerWidth}px`,
          "--ag-row-inset": "0px",
          "--ag-row-natural-height": `${singleHeight}px`,
          "--ag-row-offset": "0px"
        };
        const cropStyle = crop ? applyCropStyle(style, crop, single) : null;
        if (!crop && single) {
          style["--ag-img-aspect"] = `${single.width} / ${single.height}`;
        }
        if (rowGap > 0) style["padding-bottom"] = `${rowGap}px`;
        if (revealedIndex === 0) {
          // A single-image row is already a block: it only has to give up its
          // reserved height so the code text defines it, and move below the
          // rows that precede it.
          delete style["padding-bottom"];
          Object.assign(style, { float: "none", height: "auto", clear: "none", "margin-top": `${codeOffset}px` });
          reveals.push({
            line, width: containerWidth, align: 0, height: singleHeight,
            outline: true, floatGap: false, gapWidth: null, gapHeight: singleHeight,
            crop: Boolean(crop), viewBox: cropStyle?.viewBox ?? null
          });
        }
        layouts.set(linePosition(view, line), style);
        consumed += revealedIndex === 0
          ? codeHeight + singleHeight + rowGap
          : singleHeight + rowCaptionHeight + rowGap;
        flowOffset = consumed;
        continue;
      }
      if (row.length < 2) continue;
      const widths = packedRow.items.map((item) => item.width);
      // Height the row occupies below its top edge. A revealed row reserves it
      // on the code line instead of on the cells, so the cells can keep a zero
      // height in CodeMirror's height map.
      const rowBoxHeight = rowHeight + rowCaptionHeight + rowGap;
      row.forEach((slot, index) => {
        const line = slot.line;
        const imageWidth = widths[index];
        // Distance from the row's left edge to this cell's own left edge. The
        // row-height bar is drawn from the row's left edge, not the cell's, so
        // it needs the offset even when it happens to be hosted mid-row.
        const rowOffset = row.slice(0, index).reduce((sum, _previous, previousIndex) => (
          sum + widths[previousIndex] + gap
        ), 0);
        // A cell CodeMirror has not rendered keeps its slot in the row but has
        // no line to write to. It receives the same style when it renders,
        // because the row it belongs to is packed from the source.
        if (!line) return;
        if (index !== revealedIndex) positionEmbedActions(line);
        // The row's vertical height belongs to the last source line, not the
        // first. CodeMirror stacks line heights in document order, so a line's
        // block top is the sum of every earlier height: giving the height to
        // the first cell puts the other cells at the row's *bottom* in the
        // height map, and they are only rendered once the reader scrolls to
        // that bottom edge — the last picture of a gallery stayed invisible
        // while the gallery was in plain sight. With the height on the last
        // cell every cell starts at the row's top edge and the whole row
        // renders at once.
        //
        // The cells are blocks, not floats. A float only reserves a horizontal
        // slot through its vertical extent, so a row of zero-height floats
        // would collapse onto one x and paint over itself; the slot has to be
        // stated instead of inferred, which `margin-left` does exactly.
        const style = {
          display: "block", float: "none", "vertical-align": "top", "box-sizing": "border-box",
          width: `${imageWidth + (index < row.length - 1 ? gap : 0)}px`, "max-width": "100%",
          "--ag-embed-width": `${imageWidth}px`,
          "--ag-caption-gap": `${captionGap(settings, true)}px`,
          // Published for the interactive handles. They must not measure the
          // DOM to place themselves: a cell that does not own the row height is
          // zero height, so `height: 100%` inside it collapses and a measured
          // rect reports the overflow, not the cell.
          "--ag-row-height": `${rowHeight}px`,
          "--ag-row-box": `${rowHeight + rowCaptionHeight}px`,
          "--ag-row-width": `${containerWidth}px`,
          // A capped row is narrower than the column and centred. The band is
          // published separately so `--ag-row-offset` keeps its original,
          // band-relative meaning that the handles rely on.
          "--ag-row-content": `${packedRow.width}px`,
          "--ag-row-inset": `${packedRow.offset}px`,
          "--ag-row-natural-height": `${packedRow.naturalHeight}px`,
          "--ag-row-offset": `${rowOffset}px`,
          "margin-left": `${packedRow.offset + rowOffset}px`,
          height: index === row.length - 1 ? `${rowHeight + rowCaptionHeight + rowGap}px` : "0px",
          "min-height": "0px",
          overflow: "visible",
          "padding-right": index === row.length - 1 ? "0" : `${gap}px`, "white-space": "normal",
          clear: index === 0 ? "both" : "none"
        };
        const cellParams = slot.params ?? {};
        let cropStyle = null;
        if (cellParams.crop) {
          // The cell already has the crop ratio; the image gets the row height
          // and the view box paints exactly the requested source rectangle.
          style["--ag-img-height"] = `${rowHeight}px`;
          cropStyle = applyCropStyle(style, cellParams.crop, slot.size);
        }
        if (revealedIndex >= 0) {
          if (index === revealedIndex) {
            // The edited cell becomes a normal block that spans the column so
            // its Markdown stays readable. Its bottom padding reserves the
            // row's own height: the block then covers the whole row in
            // CodeMirror's height map, which stacks line heights in document
            // order and cannot express "the code line sits above the cells
            // that precede it".
            Object.assign(style, {
              float: "none", width: "100%", "max-width": "100%", height: "auto",
              "min-height": "0px", clear: "none", "padding-right": "0", "margin-left": "0px",
              "padding-bottom": `${rowBoxHeight}px`,
              overflow: "visible", transform: "none", "margin-top": `${codeOffset}px`
            });
            reveals.push({
              line, width: imageWidth, align: 0, height: rowHeight,
              codeHeight,
              offsetX: packedRow.offset + row.slice(0, index).reduce((sum, _previous, previousIndex) => (
                sum + widths[previousIndex] + gap
              ), 0),
              outline: true, floatGap: true,
              gapWidth: imageWidth + (index < row.length - 1 ? gap : 0),
              gapHeight: rowHeight + (index === 0 ? rowGap : 0),
              crop: Boolean(cellParams.crop),
              viewBox: cropStyle?.viewBox ?? null
            });
          } else {
            // The other cells keep a zero height so the height map stays
            // monotonic. Their `margin-left` already puts them on the row's
            // slot; cells after the edited one are laid out below the code
            // line's reserved height, so they are pulled back up by the same
            // amount.
            const shiftY = index < revealedIndex ? codeHeight : -rowBoxHeight;
            Object.assign(style, {
              height: "0px",
              "margin-top": "0px",
              transform: shiftY ? `translateY(${shiftY}px)` : "none"
            });
          }
        }
        positionCaptionWidgets(line, imageWidth, settings, style, true);
        layouts.set(linePosition(view, line), style);
      });
      consumed += (revealedIndex >= 0 ? codeHeight : 0) + rowHeight + rowCaptionHeight + rowGap;
    }
    group = [];
    groupGaps = [];
  };

  for (const line of lines) {
    if (line.classList.contains("ag-cm-gallery-line")) {
      if (!group.length) group.push(line);
      else {
        const previousPosition = lineNumberForDOM(view, group[group.length - 1]);
        const currentPosition = lineNumberForDOM(view, line);
        // CodeMirror may place widget buffers between visual lines. Group by
        // document positions instead of DOM sibling identity; one blank line
        // is the gallery separator accepted by findImageLineGroups().
        const between = lines.filter((candidate) => {
          const number = lineNumberForDOM(view, candidate);
          return number > previousPosition && number < currentPosition;
        });
        const separatedOnlyByGaps = between.every((candidate) => candidate.classList.contains("ag-cm-gallery-gap"));
        if (previousPosition >= 0 && currentPosition > previousPosition && separatedOnlyByGaps) {
          group.push(line);
          groupGaps.push(...between);
        } else { flush(); group.push(line); }
      }
    } else if (!line.classList.contains("ag-cm-gallery-gap")) {
      flush();
    }
  }
  flush();
  for (const line of hiddenGaps) {
    if (!line.isConnected) continue;
    layouts.set(linePosition(view, line), { display: "none" });
  }
  return { styles: layouts, reveals, width: container, listStyles, listPending, pending: pendingGallery };
}

/**
 * Width used to lay out gallery rows. Only the stable content column may be
 * measured: a gallery line has already been sized to a row cell by the
 * previous pass, so feeding its own width back into the calculation makes
 * every pass compute a narrower row. That oscillation is visible as a
 * flickering gallery, so line widths are deliberately excluded.
 *
 * A line that is still outside the measured viewport reports a 1px width;
 * publishing a row computed from it would collapse the gallery, so 0 is
 * returned to keep the previous layout.
 */
function galleryContainerWidth(lines, view, fallbackWidth = 0, widthLock = 0) {
  const candidates = [];
  for (const line of lines) candidates.push(line.parentElement?.clientWidth || 0);
  candidates.push(view.dom.querySelector(".cm-content")?.clientWidth || 0, view.contentDOM.clientWidth || 0, fallbackWidth || 0);
  for (const width of candidates) {
    const resolved = resolveContainerWidth(width, widthLock);
    if (resolved >= 40) return resolved;
  }
  return 0;
}

/**
 * Keep the width a correction pass was started with. Reserving the revealed
 * row changes the document height, which can add or remove the scrollbar and
 * therefore the content width; feeding that back into the row calculation
 * gives two layouts that keep flipping each other. Anything within a
 * scrollbar's width of the locked value is treated as the same column.
 */
function resolveContainerWidth(measured, widthLock = 0) {
  if (!(widthLock >= 40)) return measured;
  if (!(measured >= 40)) return widthLock;
  return Math.abs(measured - widthLock) > 8 ? measured : widthLock;
}

/**
 * A gallery row is a stack of zero-height floats: only its first cell owns the
 * row height, so the line after the gallery is still at the row's top edge. The
 * `ag-cm-gallery-clear` marker normally covers that, but it is written on the
 * line right after the group — and when that line is another image (an isolated
 * member is the ordinary case) the later group claims the line and the marker
 * disappears. The image then floats into the row above it.
 */
function clearImagesAfterGallery(lines, view, layouts) {
  for (const line of lines) {
    let node = line.previousElementSibling;
    while (node && (node.classList.contains("ag-cm-gallery-gap") || node.classList.contains("ag-cm-gallery-clear"))) {
      node = node.previousElementSibling;
    }
    if (!node?.classList?.contains("ag-cm-gallery-line")) continue;
    const style = layouts.get(linePosition(view, line));
    if (style && !style.clear) style.clear = "both";
  }
}

function collectIndividualStyles(lines, view, settings, layouts, fallbackWidth = 0, reveals = [], widthLock = 0, widthOverride = 0, forceCenter = false) {
  for (const line of lines) {
    // contentDOM can report 1px while a virtualized line is outside the
    // active editor viewport. Use the rendered line/content width first so
    // percentages and float widths do not become values such as 0.61px.
    // A gallery cell that dropped out of its row must use the column width the
    // row was measured against, not its own (already sized) cell width.
    let containerWidth = widthOverride
      || line.clientWidth
      || line.parentElement?.clientWidth
      || line.closest?.(".cm-content")?.clientWidth
      || view.contentDOM.clientWidth
      || 1;
    // Fall back to the last trustworthy content width instead of publishing a
    // degenerate width that the next pass would immediately correct.
    if (containerWidth < 40 && fallbackWidth >= 40) containerWidth = fallbackWidth;
    containerWidth = resolveContainerWidth(containerWidth, widthLock);
    if (containerWidth < 40) continue;
    // While Obsidian reveals an embed's source the image lives in a floating
    // preview and the line only holds text. Its layout is still needed: the
    // preview must keep the width the image had, and the line must span the
    // column instead of the image's route width.
    const revealed = isRevealedImageLine(line);
    const image = line.querySelector("img:not(.cm-widgetBuffer)");
    if (image) image.loading = "eager";
    const embed = line.querySelector(".image-embed, .internal-embed");
    if (!embed && !revealed) continue;
    // Reuse the size measured for this image earlier in the note. A line that
    // scrolls back into the viewport then keeps the geometry it already had
    // instead of rendering at its natural size until the bitmap decodes.
    const natural = naturalSizeForLine(view, line, image);
    if (!natural) continue;
    if (!revealed) positionEmbedActions(line);
    const source = sourceLineForDOM(view, line) || embed?.getAttribute("alt") || image?.getAttribute("alt") || "";
    const { params } = parseAnnotationFromSourceLine(source.includes("![") || source.includes("![[") ? source : `![${source}](image)`);
    const style = { display: "block", width: "100%", "--ag-caption-gap": `${Number(settings.captionGap ?? 6)}px` };
    const crop = params.crop;
    const cropStyle = crop ? applyCropStyle(style, crop, natural) : null;
    if (!crop) {
      // Reserve the final height from the measured ratio (or the cached one).
      // A lazy bitmap then decodes into a box that is already the right size
      // instead of growing the line and pushing the viewport.
      style["--ag-img-aspect"] = `${natural.width} / ${natural.height}`;
    }
    // Keep explicit widths numeric while resolving the route. Appending `px`
    // here and again when publishing the CSS variable produces invalid values
    // such as `350pxpx`, which makes a manual width look like auto routing.
    const explicitWidth = Number.isFinite(params.width) ? containerWidth * params.width / 100 : null;
    const centerRequested = forceCenter || params.layout === "center" || params.side === "center";
    const shouldAutoRoute = !params.layout || params.layout === "auto";
    const shouldFloat = params.layout === "float" || shouldAutoRoute
      || params.side === "left" || params.side === "right";
    // Routing follows the ratio the reader actually sees, which is the crop
    // ratio when one is requested.
    const cropRatio = crop ? effectiveCropRatio(crop, natural) : null;
    const routedImage = cropRatio ? { naturalWidth: cropRatio * 1000, naturalHeight: 1000 } : natural;
    const ratio = cropRatio ?? natural.width / natural.height;
    const profileRule = shouldAutoRoute && explicitWidth === null ? resolveProfileRule(settings.profile, ratio) : null;
    const ruleWidth = profileRule?.width != null ? containerWidth * profileRule.width : null;
    const floatMax = Math.max(0, Math.min(1, Number(settings.floatMax ?? config.widthRatio.floatMax * 100) / 100));
    const ruleSide = profileRule?.side === "left" || profileRule?.side === "right" ? profileRule.side : null;
    const alignment = params.side ? null : profileRule?.floatAlignment;
    const routeSide = params.side ?? ruleSide ?? chooseAutoSide(view, line, settings.profile, alignment);
    // Width and alignment are independent: compute the automatic width even
    // for centered images, otherwise `ag:layout=center` always fills the line.
    const autoLayout = containerWidth > 0
      ? calculateFloatLayout(routedImage, containerWidth, {
        center: settings.widthControl?.medianRatio,
        qLeft: gainToExponent(settings.widthControl?.gain, config.widthRatio.qLeft),
        qRight: gainToExponent(settings.widthControl?.gain, config.widthRatio.qRight),
        maxWidthRatio: floatMax,
        side: routeSide
      })
      : null;
    let route;
    if (explicitWidth !== null) route = { mode: "float", width: explicitWidth, side: routeSide };
    else if (profileRule?.layout === "fixed") route = { mode: "center", width: ruleWidth ?? containerWidth, side: routeSide };
    else if (profileRule?.layout === "float" && ruleWidth) route = { mode: "float", width: ruleWidth, side: routeSide };
    else if (profileRule?.layout === "auto" && ruleWidth) route = { mode: ruleWidth / containerWidth <= floatMax ? "float" : "center", width: ruleWidth, side: routeSide };
    else route = autoLayout ?? { mode: "float", width: Math.min(containerWidth * 0.48, 360), side: routeSide };

    // A manually requested float is honoured at whatever width the reader
    // chose; `floatMax` only governs widths the plugin computes. Without this
    // the next render silently undoes a drag or an arrow click.
    const explicitAlign = params.layout === "float"
      || params.side === "left" || params.side === "right";
    if (explicitAlign && explicitWidth === null && containerWidth > 0
      && route.width > containerWidth * floatMax) {
      route = { ...route, width: containerWidth * floatMax };
    }

    // Text may wrap only beside a left/right aligned image that is narrower
    // than the float threshold, unless floating was requested explicitly. The
    // comparison is inclusive so an image exactly at `floatMax` still floats;
    // a strict `<` makes that boundary unreachable. An explicit percentage is
    // compared as declared so a sub-pixel column change cannot flip the layout.
    const floatRatio = explicitWidth !== null && Number.isFinite(params.width)
      ? params.width / 100
      : route.width / containerWidth;
    const canFloat = !centerRequested
      && !(containerWidth > 0 && route.width >= containerWidth - 0.5)
      && shouldFloat
      && containerWidth > Number(settings.mobileBreakpoint ?? 600)
      && route.width > 0
      && (explicitAlign || floatRatio <= floatMax + 1e-6);
    if (revealed) {
      // The code line spans the column, so it no longer describes the image's
      // own box. Drop every width and the reserved height: the text decides
      // the height, and Obsidian's reserved gap below keeps the space the
      // preview needs.
      layouts.set(linePosition(view, line), {
        display: "block", width: "100%", "max-width": "100%", height: "auto", clear: "both",
        "--ag-caption-gap": `${Number(settings.captionGap ?? 6)}px`
      });
      const width = route.width > 0 ? route.width : containerWidth;
      const height = ratio > 0 ? width / ratio : 0;
      const align = canFloat && routeSide === "right" ? containerWidth - width
        : canFloat && routeSide === "left" ? 0
          : (containerWidth - width) / 2;
      reveals.push({
        line, width, align, height, outline: false,
        floatGap: false, gapWidth: null, gapHeight: height,
        crop: Boolean(crop),
        viewBox: cropStyle?.viewBox ?? null
      });
      continue;
    }
    if (!canFloat) {
      Object.assign(style, {
        "--ag-embed-float": "none",
        "--ag-embed-width": `${route.width > 0 ? route.width : containerWidth}px`,
        "--ag-embed-max-width": "100%", "--ag-embed-margin": "0 auto",
        "--ag-embed-gap-start": "auto", "--ag-embed-gap-end": "auto",
        "--ag-caption-margin-start": "auto", "--ag-caption-margin-end": "auto",
        clear: "both"
      });
      reserveImageLineBottom(view, line, settings, style);
      layouts.set(linePosition(view, line), style);
      positionCaptionWidgets(line, null, settings, style);
      continue;
    }
    const side = routeSide;
    const gap = `${params.gap ?? settings.textGap ?? 16}px`;
    Object.assign(style, {
      "--ag-embed-float": side, "--ag-embed-width": `${route.width}px`,
      "--ag-embed-max-width": "100%", "--ag-embed-gap-start": side === "right" ? gap : "0px",
      "--ag-embed-gap-end": side === "left" ? gap : "0px",
      "--ag-caption-margin-start": side === "right" ? "auto" : "0px",
      "--ag-caption-margin-end": side === "left" ? "auto" : "0px"
    });
    style["--ag-embed-width"] = `${route.width}px`;
    // Live Preview positions the picture with a CSS float, but the reader is
    // editing: wrapped text runs underneath the image's action bar and the
    // column shifts as soon as the image is aligned differently. A block image
    // gives its line a real height; a float gives it none, so the height has to
    // be reserved here or the next line paints over the picture. The bottom gap
    // follows the block rule — skipped only when a blank source line already
    // separates. Real wrapping stays a reading-view behaviour.
    //
    // Because the full height is reserved, a float never reaches past its own
    // line: editing is therefore always `ordered` (document order), whatever
    // `floatSpaceMode` says. Sharing a band would need the reservation gone,
    // and that is the overlap the reservation exists to prevent.
    const floatHeight = ratio > 0 ? route.width / ratio : 0;
    if (floatHeight > 0) {
      const lineNumber = lineNumberForDOM(view, line);
      const separated = lineNumber > 0 && lineNumber < view.state.doc.lines
        && view.state.doc.line(lineNumber + 1).text.trim() === "";
      const gapValue = separated ? "0px" : imageBottomGap(settings);
      style.height = `calc(${floatHeight + captionBoxHeight(line, settings)}px + ${gapValue})`;
    }
    layouts.set(linePosition(view, line), style);
    positionCaptionWidgets(line, null, settings, style);
  }
}

const LIST_RUN_CLASS = /(?:^|\s)ag-cm-list-run-(\d+)(?:\s|$)/;

/** The run (row or lone picture) a rendered list line belongs to. */
function listRunKey(line) {
  const match = LIST_RUN_CLASS.exec(line.className || "");
  return match ? match[1] : "";
}

/** Left edge of a list line's content box, in pixels from the line's own. */
function listLineIndent(line) {
  const value = Number.parseFloat(getComputedStyle(line).paddingInlineStart);
  return Number.isFinite(value) ? value : 0;
}

/** Nesting depth of a list line, or 0 for a line the editor does not see as one. */
function listDepth(line) {
  const match = /(?:^|\s)HyperMD-list-line-(\d+)(?:\s|$)/.exec(String(line.className || ""));
  return match ? Number(match[1]) : 0;
}

/**
 * The content column of the list item a line belongs to.
 *
 * A line whose content is a decorated picture has no inline text left for the
 * editor to measure, and it then derives the indentation from the line box
 * itself: the whole content offset of the sheet (359px in a 760px column
 * instead of 23px). That number is not a rounding error — the row is laid out
 * inside it, so the pictures end up in a narrow strip on the far right and the
 * item looks broken. Only list-sized values are trusted; anything larger is
 * replaced by the indentation of the nearest line at the same depth that still
 * has text to measure, which is the item column the marker hangs from.
 */
function listItemIndent(line) {
  const own = listLineIndent(line);
  const ownWidth = line.clientWidth || 0;
  const limit = (width) => Math.max(48, width * 0.25);
  if (own > 0 && own <= limit(ownWidth)) return own;
  const depth = listDepth(line);
  for (let node = line.previousElementSibling; node; node = node.previousElementSibling) {
    if (!/(?:^|\s)HyperMD-list-line(?:\s|$)/.test(String(node.className || ""))) continue;
    if (listDepth(node) !== depth) continue;
    const pad = listLineIndent(node);
    if (pad > 0 && pad <= limit(node.clientWidth || 0)) return pad;
  }
  return own > 0 && own <= limit(ownWidth) ? own : 0;
}

/**
 * Lay out the pictures of a list item.
 *
 * A list line already owns its indentation: the marker hangs in the padding
 * and a picture's inline start is the item's content column. The picture
 * therefore stays `inline-block` instead of becoming a block - a block box
 * breaks the inline flow and paints the marker on a line of its own above
 * every image. A row of pictures cannot use floats either, because the cells
 * live in separate block lines: the first cell keeps the item's own line and
 * every following cell is placed on the row's top edge with an absolute slot
 * measured against the item's content column.
 *
 * The geometry is written on the embed, never on the line. The editor rewrites
 * a list line's inline style on every measure - it derives the indentation from
 * what the line contains - so a line-level style would either be dropped or
 * take the item's indentation with it.
 */
function collectListStyles(lines, view, settings, listStyles, reveals, fallbackWidth = 0, widthLock = 0) {
  if (!lines.length) return { pending: false };
  let pending = false;
  const groups = new Map();
  for (const line of lines) {
    const key = listRunKey(line);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  for (const groupLines of groups.values()) {
    const column = groupLines[0].parentElement?.clientWidth
      || view.contentDOM.clientWidth
      || fallbackWidth;
    const available = resolveContainerWidth(column, widthLock);
    if (!(available >= 40)) continue;
    const indents = groupLines.map(listItemIndent);
    // Only the item's own first line knows the content column: it is the line
    // that carries the marker. A continuation line's padding is recalculated
    // by the editor from whatever inline content it happens to hold, so it can
    // read as a completely different column and must not be used here.
    const markerIndex = groupLines.findIndex((line) => !line.classList.contains("ag-cm-list-cont"));
    // A picture on a continuation line of an item whose first line is prose has
    // no marker line of its own; its own indentation is the item column then.
    const origin = markerIndex >= 0 ? indents[markerIndex] : Math.max(0, ...indents);
    // The editor writes the indentation after the line is rendered. A pass
    // that runs before it measures a zero column and would publish a row the
    // width of the whole sheet, so it is retried instead.
    if (!(origin > 0) && markerIndex >= 0) {
      pending = true;
      continue;
    }
    const container = available - origin;
    if (!(container >= 40)) continue;
    const entries = [];
    let ready = true;
    for (const [index, line] of groupLines.entries()) {
      const image = line.querySelector("img:not(.cm-widgetBuffer)");
      if (image && image.loading !== "eager") image.loading = "eager";
      const natural = naturalSizeForLine(view, line, image);
      if (!natural) { ready = false; break; }
      entries.push({
        line,
        indent: indents[index],
        natural,
        params: annotationParamsForLine(view, line),
        revealed: isRevealedImageLine(line)
      });
    }
    // While a member of the row is being edited the row cannot keep its cell
    // geometry: the source line has no picture. The group falls back to
    // separate pictures for that pass and becomes a row again afterwards.
    const gallery = entries.length > 1 && entries.every((entry) => !entry.revealed);
    if (gallery) {
      collectListGallery(entries, settings, listStyles, container, origin);
      continue;
    }
    for (const entry of entries) {
      collectListImage(entry, view, settings, listStyles, reveals, container);
    }
  }
  return { pending };
}

/** Width a list picture occupies, including its explicit and profile routes. */
function listRouteWidth(params, settings, container, ratio, routingImage) {
  const explicitWidth = Number.isFinite(params.width) ? container * params.width / 100 : null;
  const autoRoute = !params.layout || params.layout === "auto";
  const profileRule = autoRoute && explicitWidth === null ? resolveProfileRule(settings.profile, ratio) : null;
  const ruleWidth = profileRule?.width != null ? container * profileRule.width : null;
  const floatMax = Math.max(0, Math.min(1, Number(settings.floatMax ?? config.widthRatio.floatMax * 100) / 100));
  let width = explicitWidth ?? ruleWidth;
  if (!(width > 0)) {
    width = calculateFloatLayout(routingImage, container, {
      center: settings.widthControl?.medianRatio,
      qLeft: gainToExponent(settings.widthControl?.gain, config.widthRatio.qLeft),
      qRight: gainToExponent(settings.widthControl?.gain, config.widthRatio.qRight),
      maxWidthRatio: floatMax,
      side: "left"
    }).width;
  }
  // A picture that asked to float still cannot take the whole item column;
  // the same cap applies in the reading view. `floatMax` only governs widths
  // the plugin computes, never an explicit `ag:width`.
  const explicitAlign = params.layout === "float" || params.side === "left" || params.side === "right";
  if (explicitAlign && explicitWidth === null && container > 0 && width > container * floatMax) {
    width = container * floatMax;
  }
  return width > 0 ? Math.min(width, container) : container;
}

/**
 * One picture of a list item: a block of the item's own axis, left aligned by
 * default. `ag:layout=center` and `ag:side` choose the side, never a text-wrap
 * side, and the width is the routed one - the full column is only used when
 * no route applies.
 *
 * The geometry is written on the embed, never on the line: the editor rewrites
 * a list line's inline style on every measure, which would drop the values (and
 * taking the style attribute over would drop the item's indentation instead).
 */
function collectListImage(entry, view, settings, listStyles, reveals, container) {
  const { line, params, natural } = entry;
  const crop = params.crop;
  const cropRatio = crop ? effectiveCropRatio(crop, natural) : null;
  const ratio = cropRatio ?? natural.width / natural.height;
  const routingImage = cropRatio ? { naturalWidth: cropRatio * 1000, naturalHeight: 1000 } : natural;
  const width = listRouteWidth(params, settings, container, ratio, routingImage);
  const centerRequested = params.layout === "center" || params.side === "center";
  const align = centerRequested ? "center" : params.side === "right" ? "right" : "left";
  const shift = align === "left" ? 0 : align === "right" ? container - width : (container - width) / 2;
  const style = {
    "--ag-caption-gap": `${Number(settings.captionGap ?? 6)}px`,
    "--ag-embed-float": "none",
    "--ag-embed-width": `${width}px`,
    "--ag-embed-max-width": "100%",
    "--ag-embed-gap-start": "0px",
    "--ag-embed-gap-end": "0px",
    "--ag-caption-margin-start": align === "left" ? "0px" : "auto",
    "--ag-caption-margin-end": align === "right" ? "0px" : "auto"
  };
  if (!crop) style["--ag-img-aspect"] = `${natural.width} / ${natural.height}`;
  const cropStyle = crop ? applyCropStyle(style, crop, natural) : null;
  // A row cell laid out on its own again - the row is broken while a
  // neighbour is being edited - must give up the absolute slot it had, or it
  // stays pinned to the top-left corner of its zero-height line.
  if (line.classList.contains("ag-cm-gallery-line")) {
    style.position = "static";
    style.left = "auto";
    style.top = "auto";
  }
  // The shift belongs to the picture, not to the line: the marker must stay
  // where the editor drew it.
  if (shift > 0.5) style["--ag-list-shift-x"] = `${shift}px`;
  const lineNumber = lineNumberForDOM(view, line);
  if (entry.revealed) {
    const height = ratio > 0 ? width / ratio : 0;
    reveals.push({
      line, width, align: entry.indent + shift, height, outline: false,
      floatGap: false, gapWidth: null, gapHeight: height,
      crop: Boolean(crop), viewBox: cropStyle?.viewBox ?? null
    });
    return;
  }
  const embed = line.querySelector(".image-embed, .internal-embed");
  if (!embed) return;
  // A list item owns the spacing between its pictures and the next item. A
  // blank source line already provides it. The gap belongs to the picture (or
  // to the caption below it) because the line's own style is not ours.
  const nextText = lineNumber > 0 && lineNumber < view.state.doc.lines
    ? view.state.doc.line(lineNumber + 1).text : "";
  if (nextText.trim() !== "" && captionBoxHeight(line, settings) <= 0) {
    style["margin-block-end"] = imageBottomGap(settings);
  }
  positionEmbedActions(line);
  positionCaptionWidgets(line, width, settings, style);
  listStyles.set(embed, { element: embed, style });
}

/**
 * A row of pictures inside one list item. The packer is the same one the
 * reading view uses, so a note keeps its rows when the reader switches views.
 * Only the first cell owns the row's height; the following cells are zero
 * height and moved onto their slot, which keeps the block flow after the item
 * at the row's bottom edge.
 */
function collectListGallery(entries, settings, listStyles, container, origin) {
  const gap = Math.max(0, Number(settings.galleryGap ?? 12));
  const control = settings.galleryControl ?? "both";
  const maxPerRow = control === "height"
    ? 15
    : Math.min(15, Math.max(2, Number(settings.galleryMaxPerRow ?? settings.maxImagesPerRow ?? 5)));
  const minHeight = control === "count" ? 0 : Math.max(0, Number(settings.galleryMinHeight ?? 100));
  const ratioInputs = entries.map((entry) => {
    const crop = entry.params?.crop;
    if (crop) {
      const ratio = effectiveCropRatio(crop, entry.natural) ?? crop.w / crop.h;
      return { naturalWidth: ratio * 1000, naturalHeight: 1000, group: Number(entry.params?.group) > 0 ? Number(entry.params.group) : 0 };
    }
    return {
      naturalWidth: entry.natural.width,
      naturalHeight: entry.natural.height,
      group: Number(entry.params?.group) > 0 ? Number(entry.params.group) : 0
    };
  });
  const rows = calculateGalleryRows(ratioInputs, container, {
    maxPerRow,
    minHeight,
    gap,
    maxHeight: Number(settings.galleryMaxHeight ?? 0),
    rows: entries[0]?.params?.rows
  });
  if (!rows.length) return;
  let cursor = 0;
  for (const row of rows) {
    const cells = entries.slice(cursor, cursor + row.items.length);
    cursor += cells.length;
    if (!cells.length) continue;
    const isLast = cursor >= entries.length;
    // A caption wraps at the cell width, so every cell has to be placed at that
    // width before it is measured; the row then reserves the tallest one. The
    // captions of a row are left-aligned on their own cell: the item column is
    // wider than any single picture, and centring them there pushed the text
    // off the picture it belongs to.
    cells.forEach((entry, index) => {
      const cellWidth = row.items[index]?.width;
      if (cellWidth > 0) {
        positionCaptionWidgets(entry.line, cellWidth, settings, {
          "--ag-caption-margin-start": "0px",
          "--ag-caption-margin-end": "auto"
        });
      }
    });
    const caption = cells.reduce((height, entry) => (
      Math.max(height, captionBoxHeight(entry.line, settings))
    ), 0);
    const rowGap = isLast ? 0 : gap;
    // Height the row occupies below its top edge. The first cell is an
    // inline-block, so this is also the height its line takes in the flow;
    // every following cell is placed back on this box.
    const rowBox = row.height + caption + rowGap;
    for (const [index, entry] of cells.entries()) {
      const embed = entry.line.querySelector(".image-embed, .internal-embed");
      if (!embed) continue;
      const width = row.items[index].width;
      const offsetX = row.offset + row.items.slice(0, index)
        .reduce((sum, previous) => sum + previous.width + gap, 0);
      const style = {
        "--ag-caption-gap": `${Number(settings.captionGap ?? 6)}px`,
        "--ag-embed-float": "none",
        "--ag-embed-width": `${width}px`,
        "--ag-embed-max-width": "none",
        "--ag-embed-gap-start": "0px",
        "--ag-embed-gap-end": "0px",
        "--ag-caption-margin-start": "0px",
        "--ag-caption-margin-end": "auto",
        "--ag-img-height": `${row.height}px`,
        // The gallery handles read a row's geometry from the cell. They cannot
        // read it from a list line - the editor owns that element's inline
        // style - so the same values are published on the embed, which is where
        // the list layout already writes everything else.
        "--ag-row-height": `${row.height}px`,
        "--ag-row-box": `${rowBox}px`,
        "--ag-row-width": `${container}px`,
        "--ag-row-content": `${container}px`,
        "--ag-row-natural-height": `${row.height}px`,
        "--ag-row-offset": `${offsetX}px`,
        "--ag-row-inset": "0px"
      };
      if (entry.params?.crop) applyCropStyle(style, entry.params.crop, entry.natural);
      if (index > 0) {
        // The continuation line starts where the row ends; its picture is
        // placed back on the row's own top edge, at its own slot. An absolutely
        // positioned box is offset from the line's padding edge, so the item's
        // content column has to be added to the slot position.
        style.left = `${origin + offsetX}px`;
        style.top = `${-rowBox}px`;
      }
      positionEmbedActions(entry.line);
      positionCaptionWidgets(entry.line, width, settings, style);
      if (index > 0) positionListCaption(entry.line, origin + offsetX, row.height - rowBox);
      else if (rowGap > 0) style["margin-block-end"] = `${rowGap}px`;
      listStyles.set(embed, { element: embed, style });
    }
  }
}

/**
 * A caption under an absolutely positioned row cell: the widget host is
 * dissolved so the caption can be anchored to the line, which is the only
 * positioned box such a cell owns.
 */
function positionListCaption(line, left, top) {
  for (const caption of line.querySelectorAll(".ag-cm-caption")) {
    const host = caption.parentElement;
    if (host && host !== line) host.style.setProperty("display", "contents", "important");
    caption.style.setProperty("position", "absolute", "important");
    caption.style.setProperty("left", `${left}px`, "important");
    caption.style.setProperty("top", `${top}px`, "important");
    caption.style.setProperty("margin", "0", "important");
    // The line it is anchored to collapses its line height so the row keeps the
    // first cell's height; the caption must not inherit that collapse.
    caption.style.setProperty("line-height", "normal", "important");
  }
}

/**
 * Reserve the space between a block image's caption and the next block. A
 * CodeMirror line ends at its content, so the caption sits flush against the
 * following line; a blank line in the source used to provide that gap. When
 * the author did not leave one, the line owns the gap itself.
 *
 * The gap is padding, not a height. A published `height` froze the line box at
 * the width the last pass measured: dragging the corner handle resized the
 * picture inside a box that never moved, so the text directly below it only
 * jumped on release (a blank line or a float hid the problem — the float's
 * text wraps live, and a blank line carries the spacing on its own). Padding
 * adds the same space while the line keeps the height its own content, picture
 * plus caption, gives it.
 */
function reserveImageLineBottom(view, line, settings, style) {
  const lineNumber = lineNumberForDOM(view, line);
  if (lineNumber < 1 || lineNumber >= view.state.doc.lines) return;
  // A blank line already separates this image from what follows it.
  if (view.state.doc.line(lineNumber + 1).text.trim() === "") return;
  style["padding-bottom"] = imageBottomGap(settings);
}

/**
 * Space between a block image (caption included) and the next block. Zero
 * means "follow the theme", matching the reading view, so the two views keep
 * the same rhythm when the reader has not set an explicit value.
 */
function imageBottomGap(settings) {
  const configured = Number(settings.imageBottomGap ?? 0);
  return configured > 0 ? `${configured}px` : "var(--p-spacing, 16px)";
}

/**
 * Vertical seam a gallery leaves between the picture and its caption.
 *
 * The row-height bar floats in this seam. Six pixels - the single-image gap -
 * leaves a 4px bar exactly one pixel of air on each side, which reads as a
 * border on the picture rather than a handle between picture and caption.
 */
const GALLERY_CAPTION_GAP = 12;

function captionGap(settings, gallery = false) {
  const base = Number(settings.captionGap ?? 6);
  return gallery ? Math.max(GALLERY_CAPTION_GAP, base) : base;
}

/**
 * Height a cell reserves for its caption. The widget's own height is used when
 * it is rendered; otherwise the text line plus the configured gap is assumed,
 * which is what the caption widget always occupies. A wrapped caption returns
 * its full multi-line height, and that is the value the row must reserve.
 */
function captionBoxHeight(line, settings, gallery = false) {
  const caption = line?.querySelector?.(".ag-cm-caption");
  if (!caption) return 0;
  return Math.max(20 + captionGap(settings, gallery), caption.getBoundingClientRect?.().height || 0);
}

/**
 * Tallest caption box in a row.
 *
 * A row is a grid: every cell shares one caption band, so the measure has to be
 * the tallest member. Reading only the first cell let a longer neighbour wrap
 * onto a second line and paint over the row below. `skipIndex` is the revealed
 * cell, whose caption is hidden.
 */
function rowCaptionBox(row, settings, skipIndex = -1) {
  let height = 0;
  row.forEach((slot, index) => {
    if (index === skipIndex) return;
    height = Math.max(height, captionBoxHeight(slot.line, settings, true));
  });
  return height;
}

/**
 * Source markup Obsidian leaves in the line while an embed is revealed. It is
 * not the same for both image syntaxes: `![alt](path)` renders
 * `.cm-formatting-image`/`.cm-image`, while `![[name]]` renders
 * `.cm-formatting-embed`/`.cm-hmd-embed`. Detecting only one of them makes the
 * takeover work for a gallery written one way and silently do nothing for the
 * other, so match the whole family rather than a single syntax's nodes.
 */
const REVEALED_SOURCE_SELECTOR = [
  ".cm-formatting-image", ".cm-image",
  ".cm-formatting-embed", ".cm-hmd-embed", ".cm-formatting-link"
].join(", ");

/**
 * True when Obsidian has revealed the Markdown source of an image embed
 * because the cursor sits inside it. The embed then lives in a floating
 * preview and the line holds text only. Obsidian reserves the preview's space
 * with a `.cm-image-reveal-gap` sibling; that marker is the reliable signal,
 * because a line whose widget has not been rendered yet also has no embed.
 */
function isRevealedImageLine(line) {
  if (!line?.classList?.contains("ag-cm-image-line")) return false;
  if (line.querySelector(".image-embed, .internal-embed")) return false;
  if (line.nextElementSibling?.classList?.contains("cm-image-reveal-gap")) return true;
  // Obsidian sizes that gap from the line's previous height, so a gallery cell
  // that was laid out with a zero height never gets one - which is every cell
  // after the first in a revealed row. Fall back to the source markup instead
  // of to the gap. A line whose widget has not been rendered yet carries no
  // source spans either, so this cannot mistake it for a reveal.
  if (!line.querySelector(REVEALED_SOURCE_SELECTOR)) return false;
  // Source spans alone still do not prove a reveal: only the preview Obsidian
  // creates for a revealed embed, or the cursor resting on the line, does.
  const root = line.closest(".cm-editor");
  return Boolean(root?.querySelector(".cm-image-reveal-tooltip")) || line.classList.contains("cm-active");
}

const revealedHeightCache = new WeakMap();

/**
 * Height the revealed Markdown line occupies once it spans the whole column.
 * After the block style is published the line's own height is the exact
 * answer. On the first pass the line still carries a gallery cell's fixed
 * width and height, so the natural height is measured with the block style
 * temporarily applied and the previous inline style is restored before the
 * real layout is published. The result depends only on the column width and
 * the text, never on the height it produces, so it cannot restart the measure
 * loop.
 */
function revealedCodeHeight(line, containerWidth) {
  if (isRevealedStyleApplied(line)) {
    // The revealed block reserves the rest of the row with bottom padding, so
    // only the text part of its box is the code height.
    const rect = line.getBoundingClientRect();
    const reserved = parseFloat(line.style.getPropertyValue("padding-bottom")) || 0;
    return Math.max(0, rect.height - reserved);
  }
  const key = `${Math.round(containerWidth)}|${line.textContent}`;
  const cached = revealedHeightCache.get(line);
  if (cached && cached.key === key) return cached.height;
  const previous = line.getAttribute("style");
  for (const [property, value] of Object.entries({
    float: "none", width: "100%", "max-width": "100%", height: "auto",
    "margin-top": "0px", transform: "none", "padding-right": "0px",
    // `clear` keeps the block out of the row's floats while it is measured:
    // beside a floated neighbour its line boxes would be shortened to the
    // remaining width and report a far taller line than the published style.
    clear: "both",
    // The freshly revealed line can still carry Obsidian's `pre-wrap`, which
    // wraps the Markdown at different places than the published style.
    "white-space": "normal"
  })) line.style.setProperty(property, value, "important");
  const height = line.getBoundingClientRect().height;
  if (previous === null) line.removeAttribute("style");
  else line.setAttribute("style", previous);
  revealedHeightCache.set(line, { key, height });
  return height;
}

/** True once the revealed block style is the one currently applied. */
function isRevealedStyleApplied(line) {
  const style = line?.style;
  if (!style) return false;
  return style.getPropertyValue("float") === "none" && style.getPropertyValue("height") === "auto";
}

/**
 * True when the revealed line settled on a different code height than the one
 * the pass was built from. The line box deliberately includes the padding that
 * reserves the rest of the row, so that padding must be subtracted first:
 * comparing the whole box against `codeHeight` would report the row height as
 * a mismatch on every pass and restart the layout forever.
 */
function revealHeightMismatch(reveal) {
  if (reveal.codeHeight == null) return false;
  const reserved = parseFloat(reveal.line.style.getPropertyValue("padding-bottom")) || 0;
  const height = reveal.line.getBoundingClientRect().height - reserved;
  return height > 0 && Math.abs(height - reveal.codeHeight) >= 0.5;
}

/**
 * Style Obsidian's reserved preview area and the floating preview itself.
 *
 * The preview is an absolutely positioned tooltip anchored to the embed's old
 * position, which no longer matches once the source line spans the column. It
 * is moved onto the reserved area with an incremental transform, so the
 * tooltip keeps following Obsidian's own scroll updates instead of fighting
 * them, and its image is scaled to the width the plugin gave the embed so the
 * preview never jumps to the native size.
 */
function applyRevealLayout(view, reveals) {
  if (!reveals?.length) return;
  const first = reveals[0];
  const gaps = reveals.map((reveal) => {
    const gap = reveal.line.nextElementSibling;
    return gap?.classList?.contains("cm-image-reveal-gap") ? gap : null;
  });
  const tooltip = view.dom.querySelector(".cm-image-reveal-tooltip");
  // Read every box before writing anything: the writes below change the
  // layout, so interleaving them would force a style recalculation per image.
  // This also runs on scroll, where it is the only work a frame does.
  const editorRect = view.dom.getBoundingClientRect();
  const lineRect = first.line.getBoundingClientRect();
  const gapRect = !first.floatGap && gaps[0] ? gaps[0].getBoundingClientRect() : null;
  reveals.forEach((reveal, index) => {
    const gap = gaps[index];
    if (!gap) return;
    if (reveal.floatGap) {
      // A revealed gallery row reserves its own height on the code line, so
      // Obsidian's spacer would add a second, empty band below it.
      gap.style.setProperty("display", "none", "important");
      return;
    }
    // A block image keeps the full-width spacer Obsidian created for it.
    gap.style.setProperty("display", "block", "important");
    gap.style.setProperty("float", "none", "important");
    gap.style.setProperty("clear", "none", "important");
    gap.style.setProperty("width", "100%", "important");
    gap.style.setProperty("height", `${Math.max(1, reveal.gapHeight)}px`, "important");
    gap.style.setProperty("margin", "0", "important");
    gap.style.setProperty("padding", "0", "important");
    gap.style.setProperty("box-sizing", "border-box", "important");
  });
  if (!tooltip) return;
  styleRevealPreview(tooltip, first);
  // The preview is placed from the image's own alignment, never from
  // Obsidian's reserved gap: that gap is sized and positioned by the editor,
  // so anchoring to it makes the preview follow a box the plugin does not own.
  // `offsetX` is the gallery cell's column offset, `align` is the same offset
  // the normal layout gives a single image, so both start exactly where the
  // image was before the edit state began.
  const anchorLeft = lineRect.left + (first.offsetX ?? first.align ?? 0);
  // A gallery code line reserves the rest of its row with bottom padding, so
  // the preview starts one code height below its top edge, not at its bottom.
  // Without a spacer a block image simply uses the reserved area below.
  const anchorTop = gapRect ? gapRect.top : lineRect.top + (first.codeHeight ?? lineRect.height);
  // Publish the geometry as custom properties and let the static rule that
  // targets `ag-reveal-anchored` own `left`/`top`/`width`. Writing them inline
  // is not enough: Obsidian's tooltip manager re-anchors the preview on every
  // scroll and measure with `style.left = ...`, which replaces the declaration
  // together with its `!important` priority, so the preview snaps back to the
  // editor's own position. A rule with `!important` outranks any inline
  // declaration, and the custom properties are names the editor never writes.
  tooltip.classList.add("ag-reveal-anchored");
  tooltip.style.setProperty("--ag-reveal-left", `${anchorLeft - editorRect.left}px`);
  tooltip.style.setProperty("--ag-reveal-top", `${anchorTop - editorRect.top}px`);
  tooltip.style.setProperty("--ag-reveal-width", `${Math.max(1, Number(first.width) || 1)}px`);
}

function styleRevealPreview(tooltip, reveal) {
  // The tooltip box is owned by the `ag-reveal-anchored` rule; only the
  // preview content is styled here.
  tooltip.style.setProperty("outline-offset", "0", "important");
  const image = tooltip.querySelector("img");
  if (!image) return;
  image.style.setProperty("width", "100%", "important");
  image.style.setProperty("max-width", "100%", "important");
  // A gallery cell is one of several images in the row, so the edited one
  // needs a marker that survives the code line being drawn above the row.
  // The ring belongs to the image: an outline follows the element's own
  // `border-radius`, so the marker keeps Obsidian's rounded corners instead
  // of boxing a rounded image. It still sits *outside* the box, because an
  // inset ring is painted with the background and the image would cover it.
  image.style.setProperty("outline", reveal.outline ? "2px solid var(--interactive-accent)" : "none", "important");
  image.style.setProperty("outline-offset", reveal.outline ? "2px" : "0", "important");
  if (reveal.crop) {
    image.style.setProperty("height", `${Math.max(1, reveal.height)}px`, "important");
    if (reveal.viewBox) {
      image.style.setProperty("object-view-box", reveal.viewBox, "important");
      image.style.setProperty("object-fit", "fill", "important");
      image.style.removeProperty("object-position");
    } else {
      image.style.removeProperty("object-view-box");
      image.style.setProperty("object-fit", "cover", "important");
      image.style.setProperty("object-position", "50% 50%", "important");
    }
  } else {
    image.style.removeProperty("object-view-box");
    image.style.setProperty("height", "auto", "important");
    image.style.setProperty("object-fit", "contain", "important");
  }
}

function positionCaptionWidgets(line, cellWidth, settings, layoutStyle = {}, gallery = false) {
  const captions = line.querySelectorAll?.(".ag-cm-caption") ?? [];
  if (!captions.length) return;
  // A missing file has no picture for the caption to describe; the notice takes
  // the line and the caption must not reserve a box under it.
  if (line.querySelector(":scope > .internal-embed.mod-empty-attachment")) return;
  // A list picture publishes its width on the embed, because the editor
  // rewrites a list line's inline style. A caption is a child of the line, so
  // the variable is not inherited there: falling back to `var()` made the
  // caption span the whole item column instead of the picture, and its centred
  // text ended up outside the picture's axis.
  const published = line.querySelector(".image-embed, .internal-embed")
    ?.style.getPropertyValue("--ag-embed-width")?.trim();
  const width = cellWidth > 0
    ? `${cellWidth}px`
    : published || "var(--ag-embed-width, 100%)";
  const computed = line.ownerDocument?.defaultView?.getComputedStyle(line);
  const start = layoutStyle["--ag-caption-margin-start"]
    || computed?.getPropertyValue("--ag-caption-margin-start")?.trim() || "auto";
  const end = layoutStyle["--ag-caption-margin-end"]
    || computed?.getPropertyValue("--ag-caption-margin-end")?.trim() || "auto";
  for (const caption of captions) {
    const widgetHost = caption.parentElement;
    if (widgetHost && widgetHost !== line) {
      widgetHost.style.setProperty("display", "block", "important");
      widgetHost.style.setProperty("width", width, "important");
      widgetHost.style.setProperty("height", "auto", "important");
      widgetHost.style.setProperty("margin", "0", "important");
      // The wrapper shrink-wraps the picture, so it has to be placed on the
      // same axis as the caption. Leaving it at the line's left edge pins a
      // centred or right-floated caption to the left margin.
      widgetHost.style.setProperty("margin-inline", `${start} ${end}`, "important");
      widgetHost.style.setProperty("padding", "0", "important");
      widgetHost.style.setProperty("vertical-align", "top", "important");
    }
    caption.style.setProperty("display", "block", "important");
    caption.style.setProperty("width", width, "important");
    caption.style.setProperty("max-width", "100%", "important");
    caption.style.setProperty("margin-top", "0", "important");
    caption.style.setProperty("margin-bottom", "0", "important");
    // One shorthand, not two longhands: the browser serialises a matching
    // pair back into `margin-inline`, and a serialised pair left over from an
    // earlier pass outranks the line's fresh custom properties.
    caption.style.setProperty("margin-inline", `${start} ${end}`, "important");
    caption.style.setProperty("padding", "0", "important");
    caption.style.setProperty("padding-top", `${captionGap(settings, gallery)}px`, "important");
    caption.style.setProperty("box-sizing", "border-box", "important");
    caption.style.setProperty("text-align", "center", "important");
  }
}

function positionEmbedActions(line) {
  // Gallery cells are packed edge to edge, so a bar moved outside one lands on
  // its neighbour and answers that neighbour's hover. They keep the bar inside
  // and degrade along their own axes instead (see placeEmbedActions). A cell
  // carries up to four controls once crop is offered inside a gallery, which is
  // exactly why the degradation ladder has to run on every pass.
  const allowOutside = !line.classList.contains("ag-cm-gallery-line");
  for (const embed of line.querySelectorAll?.(".image-embed, .internal-embed") ?? []) {
    placeEmbedActions(embed, { allowOutside });
  }
}

function linePosition(view, line) {
  try { return view.state.doc.lineAt(view.posAtDOM(line, 0)).from; }
  catch { return -1; }
}

/**
 * True when a cached layout still belongs to an image line of the current
 * document. Positions cached for a line that became prose must be dropped;
 * positions that merely left the rendered viewport are kept so the line is
 * laid out again at its final width when it scrolls back.
 */
function isImagePosition(doc, position) {
  if (!doc || !Number.isFinite(position) || position < 0 || position > doc.length) return false;
  try {
    return IMAGE_LINE.test(doc.lineAt(position).text);
  } catch {
    return false;
  }
}

function lineNumberForDOM(view, line) {
  try { return view.state.doc.lineAt(view.posAtDOM(line, 0)).number; }
  catch { return -1; }
}

function sourceLineForDOM(view, line) {
  const position = linePosition(view, line);
  return position < 0 ? "" : view.state.doc.lineAt(position).text;
}

/** Annotation parameters for a rendered image line. Falls back to the embed's
 * alt attribute when the DOM line cannot be mapped back to a source line. */
function annotationParamsForLine(view, line) {
  const embed = line.querySelector(".image-embed, .internal-embed");
  const source = sourceLineForDOM(view, line) || embed?.getAttribute("alt") || "";
  if (!source) return {};
  const expression = source.includes("![") || source.includes("![[") ? source : `![${source}](image)`;
  return parseAnnotationFromSourceLine(expression).params;
}

function linkFromSourceLine(text) {
  const wiki = /!\[\[([^\]]+)\]\]/.exec(text);
  if (wiki) return wiki[1].split("|")[0].split("#")[0].trim();
  const markdown = /!\[[^\]]*\]\(([^)\s]+)/.exec(text);
  if (markdown) return markdown[1].trim();
  return "";
}

/** Cache key for the image on a rendered line, scoped to the open note. */
function metricKeyForLine(view, line) {
  let notePath = "";
  try { notePath = view.state.field(editorInfoField, false)?.file?.path || ""; } catch { notePath = ""; }
  const source = sourceLineForDOM(view, line);
  const link = (source ? linkFromSourceLine(source) : "")
    || line.querySelector("img:not(.cm-widgetBuffer)")?.getAttribute("src") || "";
  return link ? imageMetricKey(notePath, link) : "";
}

/**
 * Natural size of the image on a line. A loaded image is measured and stored;
 * an image that has not decoded yet reuses the size measured earlier in this
 * note, so a line that is virtualised back into the viewport gets its final
 * geometry on the first paint instead of waiting for the bitmap.
 */
function naturalSizeForLine(view, line, image) {
  const key = metricKeyForLine(view, line);
  if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    rememberImageMetric(key, image.naturalWidth, image.naturalHeight);
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return key ? imageMetric(key) : null;
}

function gainToExponent(value, base) {
  const normalized = Math.max(0, Math.min(100, Number(value ?? 50))) / 100;
  const neutral = Math.max(1.0001, Number(base) || 1.5);
  if (normalized <= 0.5) return 0.1 + (neutral - 0.1) * normalized * 2;
  return neutral + (3.5 - neutral) * (normalized - 0.5) * 2;
}

function chooseAutoSide(view, line, profile, preferredAlignment = null) {
  const alignment = preferredAlignment ?? profile?.floatAlignment ?? "alternate";
  if (alignment === "left" || alignment === "right") return alignment;
  const currentLine = lineNumberForDOM(view, line);
  const imageIndex = countFloatImagesBefore(view.state.doc.toString(), currentLine);
  return imageIndex % 2 === 0 ? "left" : "right";
}

export function parseAnnotationFromSourceLine(source) {
  const markdown = /!\[([^\]]*)\]\(/.exec(source);
  if (markdown) return parseImageAnnotation(markdown[1]);
  const wiki = /!\[\[([^\]]+)\]\]/.exec(source);
  if (wiki) return parseImageAnnotation(wiki[1].split("|").slice(1).join("|"));
  return { caption: "", params: {} };
}

class CaptionWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const element = document.createElement("span");
    element.className = "ag-cm-caption";
    element.textContent = this.text;
    return element;
  }
  ignoreEvent() { return true; }
}

function sameStyle(first, second) {
  if (!first) return false;
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return firstKeys.length === secondKeys.length && secondKeys.every((key) => first[key] === second[key]);
}

function styleToText(style) {
  return Object.entries(style).map(([property, value]) => `${property}: ${value} !important`).join("; ");
}

function parseStyleText(text) {
  return Object.fromEntries(String(text).split(";").map((item) => {
    const separator = item.indexOf(":");
    return separator < 0 ? ["", ""] : [item.slice(0, separator).trim(), item.slice(separator + 1).replace(/\s*!important\s*$/, "").trim()];
  }).filter(([key]) => key));
}
