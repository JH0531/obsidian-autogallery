import { editorInfoField, getLanguage, Modal, Notice, Plugin, Setting } from "obsidian";
import { updateImageAnnotation, extractImageAnnotation } from "./src/annotations.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "./src/defaults.js";
import { renderAutoGallery, resetFloatIndices, measureImage } from "./src/renderer.js";
import { resolveRoute } from "./src/routes.js";
import { AutoGallerySettingTab } from "./src/settings-tab.js";
import { parseProfileModule, serializeProfileModule } from "./src/profile-io.js";
import { createAutoGalleryEditorExtension } from "./src/editor-extension.js";
import { createImageResizeExtension } from "./src/editor-resize.js";
import { createPdfExportIntegration } from "./src/pdf-integration.js";
import { createPdfExporter } from "./src/pdf-export.js";
import { invalidateLightThemeCache } from "./src/print-theme.js";
import { ConfirmModal } from "./src/confirm-modal.js";
import { resetDocumentImageLayout, IMAGE_LAYOUT_RESET } from "./src/reset-images.js";
import { pruneImageMetrics } from "./src/image-metrics.js";
import { imageIdentityFromDOM } from "./src/image-runs.js";
import {
  hydrateImageSizes,
  markImageSizesDirty,
  onImageSizeResolved,
  primeNoteImageSizes,
  serializeImageSizes,
  takeImageSizesDirty
} from "./src/image-sizes.js";
import { registerImageActionIcons } from "./src/icons.js";
import { t, initI18n } from "./src/i18n.js";

/**
 * Reading-view sections at or below these limits stay fully attached instead
 * of being virtualised.
 *
 * A gallery row is split into one block per picture, and those blocks are
 * inline-block siblings. The virtualiser can attach only part of a row; the
 * remaining cells then reflow into a different line arrangement, Obsidian
 * re-measures the row against that arrangement and the document height moves
 * by the difference while the reader scrolls — the jump seen on image-heavy
 * notes. Attaching the whole note removes the failure mode entirely. The cost
 * is bounded: a note this size is only a few screens of blocks, which Obsidian
 * would attach almost entirely anyway.
 */
const FULL_RENDER_SECTIONS = 160;
const FULL_RENDER_HEIGHT = 60000;

export default class AutoGalleryPlugin extends Plugin {
  async onload() {
    // The image action bar asks for `link-2-off`, which this Obsidian build's
    // Lucide set does not include. Registering it must happen before the
    // editor extension paints its first bar.
    registerImageActionIcons();
    this.previewStates = new Map();
    // Renderers whose `updateVirtualDisplay` carries the bottom-padding
    // compensation. Restored on unload so a disabled plugin leaves Obsidian's
    // own method and min-height behind.
    this.patchedRenderers = new Set();
    // Last mode seen per leaf, and the source line the reader was on in each
    // note's reading view. A mode toggle replaces the view object, so neither
    // can be read back from the view itself once it is gone.
    this.leafModes = new Map();
    this.previewLines = new Map();
    this.sourceLines = new Map();
    this.carriedLines = new Map();
    this.refreshTimer = null;
    this.stopping = false;
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(await this.loadData()) });
    // Image dimensions read from file headers are persisted next to the
    // plugin so the second open of a note is laid out from cache without
    // touching the image files at all.
    await this.loadImageSizeCache();
    this.unwatchImageSizes = onImageSizeResolved(() => this.scheduleRefresh());
    this.register(() => this.unwatchImageSizes?.());
    initI18n(this.settings.language, () => getLanguage());
    this.pdfIntegration = createPdfExportIntegration({ app: this.app, getSettings: () => this.settings });
    this.pdfExporter = createPdfExporter({
      app: this.app,
      getSettings: () => this.settings,
      savePrefs: (prefs) => this.savePdfPrefs(prefs)
    });
    this.addSettingTab(new AutoGallerySettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("css-change", () => {
      invalidateLightThemeCache();
      // A theme or snippet change can alter the gaps and widths galleries
      // were packed with, and none of the staleness signals (column width,
      // image identity, natural size) would notice. Repaint every live
      // section instead of leaving the old grid in place.
      for (const [section, state] of this.previewStates) {
        if (section.isConnected) this.renderPreviewSection(section, state.profile, state);
      }
    }));
    // Postprocessors also receive detached paragraphs. Never decorate those:
    // Obsidian later inserts them under .el-p, causing nested width ownership.
    this.registerMarkdownPostProcessor((element, context) => {
      // Markdown postprocessors also run inside Obsidian's hidden PDF print
      // document. Pass that real DOM through so pagination can run there;
      // the main-window observer cannot see the print document.
      this.pdfIntegration?.processPostProcessor(element, context);
      this.scheduleRefresh();
    });
    this.registerEditorExtension(createAutoGalleryEditorExtension((view) => this.settingsForEditor(view), { app: this.app }));
    this.registerEditorExtension(createImageResizeExtension({
      app: this.app,
      getSettings: (view) => this.settingsForEditor(view),
      setCropRatioPreset: (value) => {
        if (this.settings.cropRatioPreset === value) return;
        this.settings.cropRatioPreset = value;
        void this.saveSettings();
      }
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRefresh(true)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh(true)));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    // Measured image geometry is kept while its note is open so a line that
    // scrolls back into the viewport keeps its size. Release it for notes
    // that no longer have a leaf.
    const pruneLater = () => setTimeout(() => this.pruneImageMetricsForClosedNotes(), 800);
    this.registerEvent(this.app.workspace.on("file-open", pruneLater));
    this.registerEvent(this.app.workspace.on("active-leaf-change", pruneLater));
    this.registerEvent(this.app.workspace.on("layout-change", pruneLater));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh(true)));
    this.registerInterval(setInterval(() => this.refreshViews(), 350));
    this.registerInterval(setInterval(() => this.flushImageSizeCache(), 4000));
    this.app.workspace.onLayoutReady(() => this.scheduleRefresh(true));
    this.register(() => {
      this.stopping = true;
      pruneImageMetrics(new Set());
      clearTimeout(this.refreshTimer);
      for (const section of this.previewStates.keys()) this.disposePreviewSection(section);
      for (const renderer of [...this.patchedRenderers]) {
        this.releasePreviewWindow(renderer);
        this.restorePreviewMinHeight(renderer);
      }
      this.patchedRenderers.clear();
      this.pdfIntegration?.dispose();
      this.pdfExporter?.dispose();
      void this.flushImageSizeCache();
    });
    this.addCommand({ id: "set-image-annotation", name: t("设置图片说明与布局"), editorCallback: (editor) => new ImageAnnotationModal(this.app, editor).open() });
    this.addCommand({ id: "clear-image-annotation", name: t("清除图片说明与布局"), editorCallback: (editor) => updateCurrentImageLine(editor, "", IMAGE_LAYOUT_RESET) });
    this.addCommand({
      id: "reset-document-image-layout",
      name: t("恢复文档默认图片样式"),
      editorCallback: (editor) => {
        new ConfirmModal(this.app, {
          title: t("恢复文档默认图片样式"),
          message: t("将清除当前文档中所有图片的宽度、对齐、裁剪与间距参数，恢复到插件的自动路由。此操作可通过撤销还原。"),
          confirmText: t("恢复"),
          onConfirm: () => {
            const count = resetDocumentImageLayout(editor);
            new Notice(count ? t("已恢复 {count} 张图片的自动布局。", { count }) : t("当前文档没有需要恢复的图片。"));
          }
        }).open();
      }
    });
    this.addCommand({
      id: "export-pdf",
      name: t("导出 PDF (AutoGallery)"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const available = Boolean(file && file.extension === "md" && this.pdfExporter?.isAvailable());
        if (checking) return available;
        if (!available) return false;
        this.pdfExporter.exportFile(file).catch((error) => new Notice(t("导出失败：{error}", { error: error?.message ?? error })));
        return true;
      }
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!this.pdfExporter?.isAvailable() || !file || file.extension !== "md") return;
      menu.addItem((item) => item
        .setTitle(t("导出 PDF (AutoGallery)"))
        .setIcon("file-down")
        .onClick(() => { this.pdfExporter.exportFile(file).catch((error) => new Notice(t("导出失败：{error}", { error: error?.message ?? error }))); }));
    }));
  }

  scheduleRefresh(force = false) {
    if (this.stopping) return;
    this.forceRefresh ||= force;
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const refresh = this.forceRefresh;
      this.forceRefresh = false;
      this.refreshViews(refresh);
    }, 50);
  }

  /**
   * Where header-read image sizes are kept between sessions. It lives beside
   * the plugin rather than in `data.json` so a settings write never has to
   * carry (or rewrite) a few hundred image entries.
   */
  imageSizeCachePath() {
    const id = this.manifest?.id ?? "obsidian-autogallery";
    const dir = this.manifest?.dir ?? `${this.app.vault.configDir}/plugins/${id}`;
    return `${dir}/image-sizes.json`;
  }

  async loadImageSizeCache() {
    try {
      const adapter = this.app.vault.adapter;
      const path = this.imageSizeCachePath();
      if (adapter.exists && !(await adapter.exists(path))) return;
      hydrateImageSizes(JSON.parse(await adapter.read(path)));
    } catch {
      // A missing or unreadable cache only costs one header read per image.
    }
  }

  async flushImageSizeCache() {
    if (!takeImageSizesDirty()) return;
    try {
      const adapter = this.app.vault.adapter;
      const path = this.imageSizeCachePath();
      const dir = path.slice(0, path.lastIndexOf("/"));
      if (adapter.mkdir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(path, JSON.stringify(serializeImageSizes()));
    } catch {
      // Retried on the next tick; the sizes are already in memory.
      markImageSizesDirty();
    }
  }

  /**
   * Release measured image geometry for notes that no longer hold a leaf.
   * The cache is only useful while its note stays open; keeping it longer
   * would let a stale size outlive a replaced image file.
   */
  pruneImageMetricsForClosedNotes() {
    if (this.stopping) return;
    const openPaths = new Set();
    this.app.workspace.iterateAllLeaves?.((leaf) => {
      const path = leaf?.view?.file?.path;
      if (path) openPaths.add(path);
    });
    // A leaf that is still restoring can report no file. Keep the active note
    // so switching tabs never drops the geometry the reader just measured.
    const active = this.app.workspace.getActiveFile()?.path;
    if (active) openPaths.add(active);
    pruneImageMetrics(openPaths);
  }

  refreshViews(force = false) {
    if (this.stopping) return;
    const live = new Set();
    const seen = new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      // During Obsidian view replacement a markdown leaf can temporarily
      // expose a placeholder object without the MarkdownView API.
      if (!view || typeof view.getMode !== "function" || !view.containerEl) continue;
      seen.add(leaf);
      if (force) view.containerEl.dispatchEvent(new CustomEvent("ag-refresh"));
      const mode = view.getMode();
      const was = this.leafModes.get(leaf);
      this.leafModes.set(leaf, mode);
      // Toggling modes replaces the view object, and the replacement does not
      // reliably inherit the reading position: the editor can open at the top
      // of a note the reader was halfway through. Carry the line across here
      // rather than depending on which internal path Obsidian took.
      if (was === "preview" && mode === "source") this.carryLineToEditor(leaf, view);
      if (mode === "source") this.trackSourceScroll(view);
      if (was === "source" && mode === "preview") this.replaySourceLine(view);
      if (mode !== "preview" || !view.file) continue;
      const frontmatter = this.app.metadataCache.getFileCache(view.file)?.frontmatter;
      const profileId = resolveRoute(frontmatter, this.settings.routes);
      const profile = this.settings.profiles.find((item) => item.id === profileId)
        ?? this.settings.profiles.find((item) => item.id === "auto");
      for (const section of view.containerEl.querySelectorAll(".markdown-preview-section")) {
        if (!section.isConnected || !section.clientWidth) continue;
        // A nested markdown embed has its own file/parameters; do not bind it
        // to the containing note's lifecycle or render it a second time.
        if (section.parentElement?.closest(".markdown-preview-section")) continue;
        live.add(section);
        const previous = this.previewStates.get(section);
        if (force || previous?.sourcePath !== view.file.path || previous?.profile !== profile) {
          this.disposePreviewSection(section);
        }
        this.watchPreviewSection(section, profile, view.file.path, frontmatter, view);
      }
    }
    for (const section of this.previewStates.keys()) {
      if (!live.has(section)) this.disposePreviewSection(section);
    }
    // A closed leaf must not keep its last mode: the workspace can hand the
    // same object back for a different note, and a stale "preview" entry would
    // look like a mode switch.
    for (const leaf of [...this.leafModes.keys()]) {
      if (!seen.has(leaf)) this.leafModes.delete(leaf);
    }
  }

  disposePreviewSection(section) {
    const state = this.previewStates.get(section);
    if (!state) return;
    state.observer.disconnect();
    section.removeEventListener("load", state.onLoad, true);
    if (state.onScroll) previewScroller(section)?.removeEventListener("scroll", state.onScroll);
    state.resizeObserver?.disconnect();
    if (state.anchorFrame) cancelAnimationFrame(state.anchorFrame);
    clearTimeout(state.timer);
    this.clearPreviewBlocks(section);
    state.cleanup?.();
    resetFloatIndices(section);
    this.previewStates.delete(section);
  }

  watchPreviewSection(section, profile, sourcePath = "", frontmatter = null, view = null) {
    let state = this.previewStates.get(section);
    if (!state) {
      // The note's own text is needed before the first decoration pass, not
      // only after the vault read resolves: it is the only place where the
      // image reference targets still exist, and reading their headers up
      // front is what lets the first pass lay every gallery out at its final
      // size instead of collapsing the section in waves as bitmaps decode.
      const initialText = readViewText(view, sourcePath);
      state = {
        cleanup: null, timer: null, rendering: false, observer: null, profile, sourcePath, frontmatter,
        images: [], known: new Map(), width: 0, sourceText: initialText, sourceLoading: false,
        primedText: null,
        // A new state means the reading view was just built: either the reader
        // switched in from the editor, or the note was opened. Its scroll was
        // restored before any block had the plugin's size, so the first pass
        // has to place the view again.
        view, fresh: true
      };
      // Decorate inside the observer callback (a microtask that runs before
      // paint) rather than on a later timer. A block that Obsidian just
      // virtualised in would otherwise be painted at natural size for a frame
      // and then collapse into its gallery rows, which is the large visible
      // jump while scrolling.
      const refresh = () => {
        if (state.rendering || this.previewStates.get(section) !== state) return;
        // Obsidian rebuilds a section with new blocks before their embeds
        // exist. Decorating that partial DOM gives the surviving blocks their
        // final size while the missing embeds still contribute nothing, so the
        // section height drops and the scroller clamps. Wait for the rebuilt
        // images to arrive, but do not wait forever: a note edited down to
        // fewer images would otherwise never be decorated again.
        if (this.previewSectionRebuilding(section, state)) {
          if (!state.timer) {
            state.timer = setTimeout(() => {
              state.timer = null;
              if (this.previewStates.get(section) !== state || state.rendering) return;
              if (this.previewSectionStale(section, state)) this.renderPreviewSection(section, state.profile, state);
            }, 400);
          }
          return;
        }
        clearTimeout(state.timer);
        state.timer = null;
        if (!this.previewSectionStale(section, state)) return;
        this.renderPreviewSection(section, state.profile, state);
      };
      // Only a structural change needs a new decoration pass. Re-running the
      // whole section on every recorded mutation makes the document height
      // oscillate while the reader scrolls, which is visible as the view
      // jumping; unrelated attribute/widget mutations are ignored.
      state.observer = new MutationObserver(refresh);
      state.onLoad = (event) => {
        if (event.target?.tagName !== "IMG") return;
        refresh();
        // A decode that matches the size the pass already used needs no new
        // decoration, but the block's cached height may still have been taken
        // while the picture was empty. Correcting it here keeps the spacer the
        // virtualiser reserves for a detached block equal to the block.
        if (!state.rendering && !this.previewSectionStale(section, state)) this.syncPreviewGeometry(section);
      };
      section.addEventListener("load", state.onLoad, true);
      // Keep a reading anchor up to date while the reader scrolls. Obsidian can
      // rebuild blocks above the viewport without notifying the plugin first;
      // by the time a render starts the layout has already moved, so the only
      // way to measure that shift is against a position captured before it.
      state.anchor = null;
      state.anchorFrame = null;
      state.onScroll = () => {
        if (state.anchorFrame !== null) return;
        state.anchorFrame = requestAnimationFrame(() => {
          state.anchorFrame = null;
          if (state.rendering) return;
          state.anchor = captureScrollAnchor(section);
          this.rememberPreviewLine(section, state);
        });
      };
      const scroller = previewScroller(section);
      scroller?.addEventListener("scroll", state.onScroll, { passive: true });
      // Obsidian can also rebuild the section on its own, outside a plugin
      // pass. Watching the section height catches those reflows while the
      // reader is parked; a normal scroll never fires a size change.
      state.resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
          if (state.rendering) return;
          this.applyAnchorShift(state.anchor, section);
        })
        : null;
      state.resizeObserver?.observe(section);
      this.previewStates.set(section, state);
      // The virtualiser's min-height must include the half-viewport bottom
      // padding before the first scroll, or the document height moves as the
      // first gallery rows attach.
      this.ensurePreviewMinHeight(this.previewRenderer(section));
      this.loadPreviewSource(section, state);
      return;
    }
    if (this.previewSectionRebuilding(section, state)) {
      // A rebuild normally finishes before the next polling pass. If it does
      // not (the note really has fewer images now), force one render so the
      // section cannot stay undecorated forever.
      if (!state.timer) {
        state.timer = setTimeout(() => {
          state.timer = null;
          if (this.previewStates.get(section) !== state || state.rendering) return;
          if (this.previewSectionStale(section, state)) this.renderPreviewSection(section, state.profile, state);
        }, 400);
      }
      return;
    }
    if (this.previewSectionStale(section, state)) this.renderPreviewSection(section, profile, state);
  }

  /**
   * True while Obsidian is replacing the section's blocks. The reading view's
   * virtualiser only attaches/detaches blocks it already knows; those images
   * are a subset of the ones the last render decorated. New images that the
   * plugin has never seen mean Obsidian is rebuilding the section, and until
   * the rebuild has produced all of them a layout pass would size a
   * half-built section and make the scroller jump.
   */
  previewSectionRebuilding(section, state) {
    if (!state.images.length) return false;
    const images = [...section.querySelectorAll("img")];
    if (!images.length) return false;
    const known = new Set(state.images);
    if (images.every((image) => known.has(image))) return false;
    return images.length < state.images.length;
  }

  /** Renderer that owns this preview section, for block registration. */
  previewRenderer(section) {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const renderer = leaf.view?.previewMode?.renderer;
      if (renderer?.sizerEl === section) return renderer;
    }
    return null;
  }

  /**
   * Keep the reading view's bottom padding inside the virtualiser's height.
   *
   * Obsidian gives the preview sizer half a viewport of `padding-bottom` but
   * writes the virtualiser's `min-height` as the sum of the section heights
   * alone. The sizer's box is therefore
   * `max(total, attached content + padding)`: as blocks attach and detach while
   * the reader scrolls, the attached content crosses that padding and the
   * document height moves by up to half a viewport. A note whose pictures
   * collapse into gallery rows attaches much more content at some positions
   * than at others, which turns that drift into the visible jump while
   * scrolling (and a matching snap when the reader scrolls back).
   *
   * Raise the min-height by the same padding after every virtualiser update.
   * The document height is then the model total plus the intended scroll room
   * at every scroll position, so attaching blocks only replaces reserved space.
   */
  ensurePreviewMinHeight(renderer) {
    if (!renderer?.sizerEl || typeof renderer.updateVirtualDisplay !== "function") return;
    for (const known of [...this.patchedRenderers]) {
      if (!known.sizerEl?.isConnected) this.patchedRenderers.delete(known);
    }
    if (renderer.__agMinHeightPatched) return;
    const original = renderer.updateVirtualDisplay;
    const plugin = this;
    const patched = function patchedUpdateVirtualDisplay(...args) {
      // Drop the compensation first so a pass that leaves `min-height`
      // untouched cannot have the padding added a second time.
      plugin.dropPreviewMinHeightCompensation(renderer);
      let result;
      try {
        result = original.apply(renderer, args);
      } finally {
        plugin.compensatePreviewBottomPadding(renderer);
      }
      return result;
    };
    renderer.__agMinHeightOriginal = original;
    renderer.__agMinHeightPatched = patched;
    renderer.updateVirtualDisplay = patched;
    this.patchedRenderers.add(renderer);
    this.compensatePreviewBottomPadding(renderer);
  }

  dropPreviewMinHeightCompensation(renderer) {
    const sizer = renderer?.sizerEl;
    const applied = Number(renderer?.__agMinHeightPad) || 0;
    if (sizer && applied > 0) {
      const min = Number.parseFloat(sizer.style.minHeight);
      if (Number.isFinite(min) && min > applied) sizer.style.minHeight = `${min - applied}px`;
    }
    if (renderer) renderer.__agMinHeightPad = 0;
  }

  compensatePreviewBottomPadding(renderer) {
    const sizer = renderer?.sizerEl;
    if (!sizer) return;
    const viewport = Number(renderer.viewportHeight)
      || Number(sizer.parentElement?.clientHeight)
      || 0;
    const padding = renderer.addBottomPadding && viewport > 0 ? Math.round(viewport / 2) : 0;
    if (!(padding > 0)) return;
    const min = Number.parseFloat(sizer.style.minHeight);
    if (!(min > 0)) return;
    sizer.style.minHeight = `${min + padding}px`;
    renderer.__agMinHeightPad = padding;
  }

  restorePreviewMinHeight(renderer) {
    if (!renderer) return;
    this.dropPreviewMinHeightCompensation(renderer);
    if (renderer.__agMinHeightOriginal) renderer.updateVirtualDisplay = renderer.__agMinHeightOriginal;
    delete renderer.__agMinHeightOriginal;
    delete renderer.__agMinHeightPatched;
    delete renderer.__agMinHeightPad;
  }

  /**
   * Drop the descriptors the plugin added for its split blocks. They must not
   * survive a cleanup: their elements are about to leave the DOM, and the
   * virtualiser would re-insert the empty shells on the next scroll.
   */
  clearPreviewBlocks(section) {
    const renderer = this.previewRenderer(section);
    if (!renderer?.sections) return;
    renderer.sections = renderer.sections.filter((item) => !item.agSplit);
  }

  /**
   * Keep the view's own scroll line current.
   *
   * A mode toggle does not ask the reading view where it is: Obsidian hands
   * `view.scroll` — a *source line* — to the view it is about to build. That
   * field is only written by `syncScroll`, which a plain toggle does not call,
   * so it keeps whatever line the view had when it was created and the editor
   * opens at line 0. Writing the line the reader is actually on, as they
   * scroll, makes the toggle carry the paragraph across.
   */
  rememberPreviewLine(section, state) {
    const view = state?.view;
    if (!view || view.getMode?.() !== "preview") return;
    const line = this.previewRenderer(section)?.getScroll?.();
    if (!Number.isFinite(line)) return;
    view.scroll = line;
    const path = state.sourcePath ?? view.file?.path;
    if (path) this.previewLines.set(path, line);
  }

  /**
   * Put the editor on the paragraph the reader was looking at.
   *
   * The reading view reports a source line; `scrollIntoView` centres the line,
   * so the check afterwards tolerates a couple of lines. If the editor is
   * already there — Obsidian carried the position itself — nothing is written.
   */
  carryLineToEditor(leaf, view) {
    const line = this.previewLines.get(view.file?.path);
    if (!Number.isFinite(line) || line < 1) return;
    const place = (attemptsLeft) => {
      const current = leaf.view;
      if (!current || current.getMode?.() !== "source" || current.file?.path !== view.file?.path) return;
      const at = current.currentMode?.getScroll?.();
      if (Number.isFinite(at) && Math.abs(at - line) < 2) return;
      const scroller = current.containerEl.querySelector(".cm-scroller");
      const cm = current.editor?.cm;
      if (!scroller || !cm?.lineBlockAt) {
        if (attemptsLeft > 0) setTimeout(() => place(attemptsLeft - 1), 80);
        return;
      }
      const doc = cm.state.doc;
      const lineNo = Math.min(doc.lines, Math.max(1, Math.floor(line) + 1));
      // `scrollIntoView` centres the line, which moves the paragraph the reader
      // was reading to the middle of the screen. Writing the block's own offset
      // keeps it at the top, so the line the editor reports matches the one the
      // reading view reported.
      scroller.scrollTop = cm.lineBlockAt(doc.line(lineNo).from).top;
      // Remember what the editor reports for the line just placed. The editor
      // rounds to whole lines, so this value is only a reference: as long as it
      // still matches, the reader has not scrolled here and the reading view can
      // be put back on the exact (fractional) line it came from.
      const path = view.file?.path;
      setTimeout(() => {
        const settled = current.currentMode?.getScroll?.();
        if (Number.isFinite(settled) && path) this.carriedLines.set(path, settled);
      }, 150);
    };
    // The editor mounts after the layout change that announced the switch.
    requestAnimationFrame(() => place(3));
  }

  /**
   * Follow the editor's scroll so the line is current when the reader switches
   * back. One listener per editor view; it goes away with the view's DOM.
   */
  trackSourceScroll(view) {
    const scroller = view.containerEl?.querySelector(".cm-scroller");
    if (!scroller || scroller.dataset.agTracked === "true") return;
    scroller.dataset.agTracked = "true";
    const record = () => {
      const line = view.currentMode?.getScroll?.();
      const path = view.file?.path;
      if (Number.isFinite(line) && path) this.sourceLines.set(path, line);
    };
    scroller.addEventListener("scroll", record, { passive: true });
    record();
  }

  /**
   * Put the reading view back where the editor was. Obsidian hides and shows
   * the two modes rather than rebuilding them, so the section keeps its state
   * (and its heights) and no pass is scheduled by itself. One is forced here,
   * and the pass applies the line once every block has its final height.
   */
  replaySourceLine(view) {
    const path = view.file?.path;
    const source = this.sourceLines.get(path);
    if (!Number.isFinite(source)) return;
    // Untouched editor: return to the exact line the reading view left from,
    // which is fractional and lands on the same pixel. Once the reader scrolls
    // here, the editor's own line is the newer intent.
    const carried = this.carriedLines.get(path);
    const exact = this.previewLines.get(path);
    const untouched = Number.isFinite(carried) && Number.isFinite(exact) && Math.abs(source - carried) < 2;
    const line = untouched ? exact : source;
    for (const section of view.containerEl.querySelectorAll(".markdown-preview-section")) {
      if (section.parentElement?.closest(".markdown-preview-section")) continue;
      const state = this.previewStates.get(section);
      if (!state) continue;
      state.replayLine = line;
      this.renderPreviewSection(section, state.profile, state);
    }
  }

  /**
   * Put the reading view on a source line, and keep it there while the layout
   * settles.
   *
   * `applyScroll` divides each block's height by its line count, so the offset
   * it produces is only right once every block has been measured. At the end of
   * a decoration pass that is still not true: the virtualiser applies the
   * heights it was handed one frame later, and the same line then sits a
   * hundred pixels lower. Replaying on the next frames — but only while the
   * reader has not scrolled — lands on the line rather than near it.
   */
  replayLine(section, line) {
    const renderer = this.previewRenderer(section);
    if (typeof renderer?.applyScroll !== "function") return;
    const scroller = previewScroller(section);
    const apply = () => {
      if (!section.isConnected || !scroller?.isConnected) return;
      try {
        renderer.applyScroll(line);
      } catch {
        // An older renderer: the anchor-based position above stays.
      }
    };
    apply();
    const settled = scroller?.scrollTop ?? 0;
    requestAnimationFrame(() => {
      if (!scroller?.isConnected || Math.abs(scroller.scrollTop - settled) > 8) return;
      apply();
    });
    const later = scroller?.scrollTop ?? 0;
    setTimeout(() => {
      if (!scroller?.isConnected || Math.abs(scroller.scrollTop - later) > 8) return;
      apply();
    }, 220);
  }

  /**
   * Give the split blocks a share of the source lines of the block they were
   * cut from.
   *
   * Obsidian maps a scroll offset to a source line by walking `renderer.sections`
   * and dividing each block's height by its `lines`. A split block is a fragment,
   * so it has no line count of its own: leaving it undefined made that walk
   * produce NaN (switching to source opened the note at line 0), and leaving it
   * at zero made the line total fall short of the document, so every later line
   * resolved to a position past the end and the reading view jumped to the
   * bottom. Sharing the original count by height keeps the sum unchanged while
   * letting the walk interpolate inside a fragment.
   */
  distributeSplitLines(section) {
    const renderer = this.previewRenderer(section);
    const items = renderer?.sections;
    if (!items?.length) return;
    for (let i = 0; i < items.length; i++) {
      const owner = items[i];
      if (owner.agSplit) continue;
      let end = i + 1;
      while (end < items.length && items[end].agSplit) end += 1;
      if (end === i + 1) continue;
      const run = items.slice(i, end);
      if (run.some((item) => !item.el?.isConnected)) continue;
      // Remember the untouched value: the pass runs again and again, and
      // re-sharing an already shared count would drain the owner a little more
      // every time.
      if (owner.agLines === undefined) owner.agLines = Number(owner.lines) || 0;
      const total = owner.agLines;
      const heights = run.map((item) => Math.max(0, Number(item.height) || 0));
      const sum = heights.reduce((a, b) => a + b, 0);
      if (sum <= 0) continue;
      let given = 0;
      run.forEach((item, index) => {
        const share = index === run.length - 1
          ? total - given
          : Math.round((total * heights[index]) / sum);
        item.lines = Math.max(0, share);
        given += item.lines;
      });
    }
  }

  /**
   * Teach the reading view's virtual renderer about the blocks the plugin
   * created. `updateVirtualDisplay` keeps exactly the blocks listed in
   * `renderer.sections` and detaches everything else as unknown content; a
   * split block missing from that list is removed as soon as it scrolls out
   * of range, which collapsed the section height and made the view jump.
   */
  registerPreviewBlocks(section) {
    const renderer = this.previewRenderer(section);
    if (!renderer?.sections) return;
    // A previous registration for a block that no longer belongs to this
    // section is stale; keep only what is still a direct child.
    renderer.sections = renderer.sections.filter((item) => !item.agSplit || item.el?.parentElement === section);
    const known = new Set(renderer.sections.map((item) => item.el));
    const blocks = [...section.children].filter((block) => block.dataset?.agSplit === "true" && !known.has(block));
    // Insert from the last block backwards: each splice keeps the indices of
    // the blocks before it valid.
    for (const block of blocks.reverse()) this.registerPreviewBlock(renderer, section, block);
  }

  registerPreviewBlock(renderer, section, block) {
    const descriptor = {
      el: block,
      height: 0,
      computed: false,
      rendered: true,
      shown: true,
      // A split block is a fragment of a block that is already in the list, so
      // it owns none of the source lines: the original descriptor still counts
      // them all. Zero keeps Obsidian's line arithmetic finite — a missing
      // `lines` turned its preview-to-source mapping into NaN, and the editor
      // then opened the note at line 0 instead of where the reader was.
      lines: 0,
      // A split block is ordinary content: it belongs to the heading section
      // above it, and a collapsed heading must hide it like its siblings.
      level: 7,
      headingCollapsed: false,
      agSplit: true,
      resetCompute() { this.computed = false; }
    };
    const indexOf = new Map(renderer.sections.map((item, index) => [item.el, index]));
    let at = -1;
    for (let node = block.previousElementSibling; node; node = node.previousElementSibling) {
      if (indexOf.has(node)) { at = indexOf.get(node); break; }
    }
    if (at < 0) {
      for (let node = block.nextElementSibling; node; node = node.nextElementSibling) {
        if (indexOf.has(node)) { at = indexOf.get(node) - 1; break; }
      }
    }
    renderer.sections.splice(at + 1, 0, descriptor);
    // Measure now so the virtual window and the pusher space already account
    // for this block on the first scroll, before it is ever kept in range.
    try { renderer.measureSection(descriptor); } catch { /* not in view yet */ }
  }

  /**
   * Re-measure the blocks this pass rewrote and hand the result back to the
   * reading view's virtualiser. Obsidian caches one height per block and uses
   * it to place the spacer that stands in for the detached window. A block is
   * measured when the virtualiser attaches it — *before* this plugin turns a
   * full-width image, or a paragraph holding six of them, into a packed row.
   * The stale (much larger) height then stays in the model until that block is
   * measured again, so the surplus space is reserved and released later while
   * the reader scrolls past it: the jump seen around a gallery section.
   *
   * Measuring here, in the same task as the rewrite, keeps the model equal to
   * the DOM. The refresh call is what makes the corrected values take effect
   * without waiting for the next scroll; it restores the scroll offset it
   * captured on entry, and `restoreScrollAnchor` then puts the visible block
   * back where the reader left it.
   */
  syncPreviewGeometry(section, { update = true } = {}) {
    const renderer = this.previewRenderer(section);
    if (!renderer?.sections || typeof renderer.measureSection !== "function") return false;
    // A renderer created before the plugin started watching this view has not
    // been patched yet; the first pass is the last chance to add the bottom
    // padding to its min-height before the reader scrolls.
    this.ensurePreviewMinHeight(renderer);
    // A hidden leaf reports zero for every box, so both the measurement and the
    // virtualiser's recomputation would be meaningless (and would detach the
    // whole section). Nothing is visible to correct while the tab is in the
    // background; Obsidian lays the section out again when it is shown.
    const preview = previewScroller(section);
    if (!preview || preview.clientHeight < 1) return false;
    let changed = false;
    const assign = (item, height) => {
      if (Math.abs(item.height - height) > 0.5 || !item.computed) changed = true;
      item.height = height;
      item.computed = true;
    };
    for (const item of renderer.sections) {
      const block = item.el;
      if (!block || block.parentElement !== section) continue;
      // A gallery cell carries its row assignment as a stamp written by the
      // decoration pass. Trust it over any measurement: mid-row cells own no
      // height (their next sibling sits on the same row), and the row's last
      // attached cell owns the row height plus the gap that follows the row.
      // The stamped value stays correct however many siblings the virtualiser
      // has detached, which a fresh sibling-distance measurement would not.
      const stamp = readGalleryRowStamp(block);
      if (stamp) {
        // The row's last cell owns the row height plus the gap to the next
        // row. A gallery may also end with a trailing margin before the next
        // picture (the renderer writes `margin-block-end` there); that margin
        // is part of Obsidian's distance-to-next definition, so leaving it out
        // made every block after that point sit 12px lower than the model and
        // the document drift by the same amount while scrolling.
        let height = stamp.last ? stamp.height + stamp.gap : 0;
        if (stamp.last) {
          const style = block.ownerDocument?.defaultView?.getComputedStyle?.(block);
          height += parseFloat(style?.marginBottom ?? "0") || 0;
        }
        assign(item, Math.max(0, height));
        continue;
      }
      // The block's own box is the fallback whenever the distance to the next
      // sibling cannot be read: that sibling is virtualised out, or the block
      // is not rendered yet. It is also the part of a row this block still
      // contributes on its own.
      const measureBox = () => {
        const rect = block.getBoundingClientRect();
        const style = block.ownerDocument?.defaultView?.getComputedStyle?.(block);
        const margin = parseFloat(style?.marginBottom ?? "0") || 0;
        assign(item, Math.max(0, rect.height + margin));
      };
      const next = block.nextElementSibling;
      if (next && next.parentElement === section) {
        // Obsidian's own definition: a block owns the distance to its next
        // sibling. A gallery cell that shares its row with a neighbour
        // therefore reports zero, and only the row's last cell carries the
        // whole row height — which is exactly how the spacer has to count it.
        const cached = { height: item.height, computed: item.computed };
        item.computed = false;
        try {
          renderer.measureSection(item);
        } catch {
          Object.assign(item, cached);
        }
        if (item.computed) {
          if (Math.abs(item.height - cached.height) > 0.5 || !cached.computed) changed = true;
          item.height = Math.max(0, item.height);
          continue;
        }
      }
      // The next sibling is virtualised out, so the distance-to-next definition
      // cannot be reproduced. A height that was already taken that way stays:
      // replacing it with the block's own box would drop (or add) the collapsed
      // margin between the two, and that difference is exactly the drift that
      // made the document height move while the reader scrolled.
      if (item.computed && Number(item.height) > 0) continue;
      measureBox();
    }
    // Re-running the virtualiser moves blocks in and out of the window, which
    // is exactly the churn a scroll must not see. It is therefore only called
    // when a cached height actually moved; a pass that changed nothing leaves
    // the current window alone.
    if (update && changed) {
      try {
        renderer.updateVirtualDisplay();
      } catch {
        // Not available in every build; the next scroll recomputes it anyway.
      }
    }
    return changed;
  }

  /**
   * True when the rendered section no longer matches what the plugin drew:
   * the column resized, a block was rebuilt without the plugin's markers,
   * an image identity appeared that the last render never recorded, or an
   * image decoded to a different natural size than the render sized it with.
   * The reading view attaching or detaching blocks while scrolling is none of
   * those: the cells keep their stamps and the row packing is read from the
   * source, so a scroll by itself never makes a section stale.
   */
  previewSectionStale(section, state) {
    if (!state.cleanup) return true;
    // A hidden leaf reports 0; treating that as a resize would re-render on
    // every observer callback. Only a measured width may invalidate a render.
    const width = section.clientWidth;
    if (width > 0 && Math.abs(width - state.width) > 1) return true;
    // Obsidian can move an existing <img> into a freshly built wrapper while
    // scrolling back. The new block carries none of the plugin's markers, so
    // it would stay at its natural size until the polling pass repainted it —
    // a visible jump.
    for (const block of section.children) {
      if (!block.querySelector("img")) continue;
      if (block.hasAttribute("data-ag-layout") || block.hasAttribute("data-ag-skip")) continue;
      return true;
    }
    // Compare by identity (link target + occurrence), never by element or by
    // how many images are attached right now. A block the virtualiser
    // detached and later re-inserted keeps its markers and its identity, so
    // scrolling alone is not a change.
    const occurrences = new Map();
    for (const image of section.querySelectorAll("img")) {
      const identity = imageIdentityFromDOM(image);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      const known = state.known.get(`${identity}#${occurrence}`);
      if (!known) return true;
      // A picture that decoded after the render pass reports a natural size
      // the layout did not use; sizing it now is the one legitimate reflow.
      if (image.complete && image.naturalWidth > 0
        && (image.naturalWidth !== known.width || image.naturalHeight !== known.height)) return true;
    }
    return false;
  }

  /**
   * Seed the note's image sizes from the file headers. Called immediately
   * before the decoration pass so the pass has every ratio it needs; on a
   * warm cache it is a handful of map lookups.
   */
  primePreviewSizes(state) {
    if (state.sourceText === null || !state.sourcePath) return;
    if (state.primedText === state.sourceText) return;
    primeNoteImageSizes(this.app, state.sourcePath, state.sourceText);
    state.primedText = state.sourceText;
  }

  async loadPreviewSource(section, state) {
    if (state.sourceLoading || state.sourceText !== null || !state.sourcePath) return;
    state.sourceLoading = true;
    try {
      const file = this.app.vault.getAbstractFileByPath(state.sourcePath);
      state.sourceText = file && !file.children ? await this.app.vault.read(file) : "";
    } catch {
      state.sourceText = "";
    } finally {
      state.sourceLoading = false;
      if (this.previewStates.get(section) === state) this.renderPreviewSection(section, state.profile, state);
    }
  }

  renderPreviewSection(section, profile, state) {
    if (!section.isConnected || state.rendering || this.previewStates.get(section) !== state) return;
    // Without the note's text there is no way to group the gallery runs or to
    // look their image sizes up, so a pass would only decorate the pictures
    // that happen to have decoded and leave the rest at natural size — the
    // first wave of the collapse. The vault read that fills it in renders as
    // soon as it resolves.
    if (state.sourceText === null) {
      void this.loadPreviewSource(section, state);
      return;
    }
    state.rendering = true;
    clearTimeout(state.timer);
    state.timer = null;
    // Obsidian may already have rebuilt blocks above the viewport before this
    // pass runs. Correct that residual shift against the anchor captured while
    // scrolling, otherwise the correction below only measures changes made by
    // the plugin itself and the reader sees the earlier shift.
    this.applyAnchorShift(state.anchor, section);
    const scroll = captureScrollAnchor(section);
    state.observer?.disconnect();
    // Every block has to be decorated at least once, even the ones far outside
    // the viewport. A block the plugin never saw keeps the natural height
    // Obsidian measured for it — a six-image paragraph reserves several
    // thousand pixels — and that phantom space is released the moment the
    // reader scrolls onto it. Widening the virtual window for the duration of
    // the pass decorates and measures them all, so the spacer never has to be
    // corrected afterwards.
    const restoreWindow = this.expandRenderWindow(section);
    try {
      // Descriptors point at blocks that are about to be removed by the
      // cleanup; leaving them registered would make the virtualiser re-insert
      // empty shells after the next scroll.
      this.clearPreviewBlocks(section);
      state.cleanup?.();
      state.cleanup = null;
      // Prime the per-note metric cache from the image file headers before the
      // decoration pass. Without it every gallery whose bitmap has not decoded
      // yet is skipped, and the section collapses in one wave per image load.
      this.primePreviewSizes(state);
      state.cleanup = renderAutoGallery(section, { ...this.settingsForRender(profile), sourceText: state.sourceText, sourcePath: state.sourcePath });
      this.registerPreviewBlocks(section);
      this.syncPreviewGeometry(section);
      // Heights are final now, so the line budget of each split run can be
      // shared out. Obsidian reads it back when it converts between the two
      // view modes.
      this.distributeSplitLines(section);
      state.images = [...section.querySelectorAll("img")];
      // Record every attached image by identity and natural size. The
      // staleness check compares against this map, so a block that only left
      // and re-entered the virtual window is recognised as unchanged. The size
      // comes from `measureImage`, which falls back to the primed metric: a
      // block that was laid out from a header-read size must not look stale
      // the moment its bitmap finally decodes to that same size.
      state.known.clear();
      const occurrences = new Map();
      for (const image of state.images) {
        const identity = imageIdentityFromDOM(image);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        const measured = measureImage(image, state.sourcePath);
        state.known.set(`${identity}#${occurrence}`, {
          width: measured?.width ?? 0,
          height: measured?.height ?? 0
        });
      }
    } finally {
      state.rendering = false;
      // Restoring the window lets the virtualiser detach the extra blocks
      // again. Their heights are already recorded, so the spacer keeps the
      // document at the decorated size.
      restoreWindow?.();
      // Recorded after the window is restored: a widened window makes the
      // document taller, which adds a scrollbar and narrows the column. Using
      // that width as the reference would make the next pass see a resize and
      // decorate the whole section a second time.
      state.width = section.clientWidth;
      if (section.isConnected) state.observer?.observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "alt", "width", "height"] });
      restoreScrollAnchor(scroll);
      // A reading view that was just built was also scrolled before any block
      // had its final height: Obsidian turned the target source line into a
      // pixel offset using blocks at their natural size, which for a note with
      // pictures is several thousand pixels too far, so the view landed at the
      // end of the document and stayed there. The line it meant is kept on the
      // view itself; replaying it now that every block is decorated puts the
      // reader back on the content they were reading.
      if (state.fresh) {
        state.fresh = false;
        const line = state.view?.scroll;
        if (Number.isFinite(line) && line > 0) this.replayLine(section, line);
      }
      // A mode switch lands here: the editor was the mode in use, so its line
      // outranks whatever the rebuilt reading view restored for itself.
      if (Number.isFinite(state.replayLine)) {
        const line = state.replayLine;
        state.replayLine = null;
        this.replayLine(section, line);
      }
      if (section.isConnected) {
        state.anchor = captureScrollAnchor(section);
        // The pass just changed heights, so the line under the viewport may
        // differ from the one the scroll handler recorded.
        this.rememberPreviewLine(section, state);
      }
    }
  }

  /**
   * Widen the reading view's virtual window to the whole section for the
   * duration of one decoration pass, and return the function that restores it.
   *
   * Obsidian only attaches the blocks near the viewport. Every other block is
   * represented in the spacer by the height it was measured at, which for a
   * block the plugin has not decorated yet is its natural, full-width height.
   * Reserving that height and then releasing it when the reader scrolls onto
   * the block is what makes the view jump, so the block has to be decorated
   * while it is still attached — which means attaching it.
   *
   * A note that fits the full-render limits keeps the window expanded after
   * the pass. Virtualisation cannot split one of its gallery rows, so no
   * attach/detach can reflow a row or change the document height while the
   * reader scrolls. Larger notes keep the ordinary window and are decorated
   * progressively as the reader reaches each part.
   */
  expandRenderWindow(section) {
    const renderer = this.previewRenderer(section);
    if (!renderer?.sections || typeof renderer.updateVirtualDisplay !== "function") return null;
    const preview = previewScroller(section);
    if (!preview || preview.clientHeight < 1) return null;
    const total = renderer.sections.reduce((sum, item) => sum + (Number(item.height) || 0), 0);
    const holdable = renderer.sections.length <= FULL_RENDER_SECTIONS && total <= FULL_RENDER_HEIGHT;
    // A note that has grown past the limits must return to the ordinary window;
    // otherwise the expanded value would keep attaching every block forever.
    if (renderer.__agHeldWindow && !holdable) {
      renderer.renderExtra = renderer.__agBaseRenderExtra ?? 1;
      delete renderer.__agHeldWindow;
      delete renderer.__agBaseRenderExtra;
      try {
        renderer.updateVirtualDisplay();
      } catch {
        // The next scroll recomputes the window anyway.
      }
    }
    if (renderer.sections.length > 600) return null;
    if (total > 120000) return null;
    const previous = renderer.renderExtra;
    const expanded = total + (Number(renderer.viewportHeight) || preview.clientHeight) * 2;
    if (Number(previous) >= expanded) return null;
    renderer.renderExtra = expanded;
    try {
      renderer.updateVirtualDisplay();
    } catch {
      renderer.renderExtra = previous;
      return null;
    }
    if (holdable) {
      if (!renderer.__agHeldWindow) renderer.__agBaseRenderExtra = previous;
      renderer.__agHeldWindow = true;
      return null;
    }
    return () => {
      renderer.renderExtra = previous;
      try {
        renderer.updateVirtualDisplay();
      } catch {
        // The next scroll recomputes the window anyway.
      }
    };
  }

  /** Return a held reading-view window to Obsidian's own virtualisation. */
  releasePreviewWindow(renderer) {
    if (!renderer?.__agHeldWindow) return;
    renderer.renderExtra = renderer.__agBaseRenderExtra ?? 1;
    delete renderer.__agHeldWindow;
    delete renderer.__agBaseRenderExtra;
    try {
      renderer.updateVirtualDisplay();
    } catch {
      // The next scroll recomputes the window anyway.
    }
  }

  /**
   * Put the block that was under the viewport top back where the reader left
   * it. The expected screen position accounts for scrolling since the anchor
   * was captured, so a normal scroll never triggers a correction. When
   * Obsidian replaced the block itself, its text is used to find the rebuilt
   * equivalent — the shift that happens on such a replacement is exactly the
   * one a node-identity anchor cannot see.
   */
  applyAnchorShift(anchor, section) {
    const scroller = anchor?.scroller;
    if (!scroller?.isConnected) return;
    // The anchor is refreshed on the next animation frame after a scroll. If
    // the viewport has already moved, the reader owns the position now and a
    // correction computed from the old offset would drag the view backwards.
    if (Math.abs(scroller.scrollTop - anchor.top) > 24) return;
    const target = resolveAnchorElement(anchor, section);
    if (!target) return;
    const expected = anchor.offset - (scroller.scrollTop - anchor.top);
    const actual = target.getBoundingClientRect().top;
    const shift = actual - expected;
    if (!Number.isFinite(shift) || Math.abs(shift) < 1 || Math.abs(shift) > scroller.clientHeight) return;
    scroller.scrollTop += shift;
  }

  settingsForRender(profile) {
    return { ...this.settings, profile };
  }

  settingsForEditor(view) {
    let file = null;
    try { file = view.state.field(editorInfoField, false)?.file ?? null; }
    catch { /* The editor may be initializing before Obsidian attaches its file field. */ }
    const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
    const profileId = resolveRoute(frontmatter, this.settings.routes);
    const profile = this.settings.profiles.find((item) => item.id === profileId)
      ?? this.settings.profiles.find((item) => item.id === "auto");
    return this.settingsForRender(profile);
  }

  async saveSettings({ refresh = true } = {}) {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    // The export modal writes on every adjustment; re-rendering every open
    // view for a paper-size change would make the preview dialog unusable.
    if (refresh) {
      this.pdfIntegration?.refresh();
      this.scheduleRefresh(true);
    }
    // Live Preview controls are owned by an editor extension; a settings save
    // does not change the document, so it needs an explicit resync signal.
    window.dispatchEvent(new CustomEvent("ag-settings-changed"));
  }

  /** Persist the export dialog's own knobs without a full view refresh. */
  async savePdfPrefs(prefs) {
    if (prefs?.pdfExport) this.settings.pdfExport = { ...prefs.pdfExport };
    if (prefs?.pdfPagination) this.settings.pdfPagination = { ...prefs.pdfPagination };
    await this.saveSettings({ refresh: false });
  }

  async exportProfile(profile) {
    await saveExternalProfileFile(`${profile.id || "profile"}.js`, serializeProfileModule(profile));
  }

  async importProfiles(path) {
    const file = this.app.vault.getAbstractFileByPath(path.trim());
    if (!file || file.children) throw new Error(t("找不到配置文件：{path}", { path }));
    const value = parseProfileModule(await this.app.vault.read(file), { allowMissingId: true, fileName: file.name });
    await this.applyImportedProfiles(value, path);
  }

  async importProfileText(fileName, text) {
    const value = parseProfileModule(text, { allowMissingId: true, fileName });
    await this.applyImportedProfiles(value, fileName);
  }

  /**
   * Merge imported profiles into settings. Same-id entries are replaced,
   * entries the file does not mention are kept, and the built-in `auto`
   * profile can never be overwritten. The caller has already parsed and
   * validated the whole file, so settings are never partially updated.
   */
  async applyImportedProfiles(value, sourceName) {
    const imported = (Array.isArray(value) ? value : [value]).filter(Boolean);
    const fallbackId = String(sourceName).split(/[\\/]/).pop().replace(/\.(?:js|json)$/i, "").trim().replace(/\s+/g, "-") || `profile-${Date.now()}`;
    let skippedAuto = 0;
    const resolved = [];
    imported.forEach((profile, index) => {
      const id = profile.id || (index === 0 ? fallbackId : `${fallbackId}-${index + 1}`);
      if (id === "auto") {
        skippedAuto += 1;
        return;
      }
      resolved.push({ ...profile, id, name: profile.name || id, floatAlignment: profile.floatAlignment || "alternate" });
    });
    if (!resolved.length) {
      new Notice(skippedAuto ? t("未导入任何模板；内置 auto 已保留（跳过 {skippedAuto} 条）", { skippedAuto }) : t("没有可导入的布局模板"));
      return;
    }
    const byId = new Map(this.settings.profiles.map((profile) => [profile.id, profile]));
    let added = 0;
    let updated = 0;
    for (const profile of resolved) {
      if (byId.has(profile.id)) updated += 1;
      else added += 1;
      byId.set(profile.id, profile);
    }
    this.settings.profiles = [...byId.values()];
    await this.saveSettings();
    const parts = [];
    if (added) parts.push(t("新增 {added}", { added }));
    if (updated) parts.push(t("更新 {updated}", { updated }));
    const autoNote = skippedAuto ? t("；内置 auto 已保留（跳过 {skippedAuto} 条）", { skippedAuto }) : "";
    new Notice(t("已导入布局模板：{list}{autoNote}", { list: parts.join("、"), autoNote }));
  }

  async exportAllProfiles() {
    await saveExternalProfileFile("autogallery-profiles.js", serializeProfileModule(this.settings.profiles));
  }
}

async function saveExternalProfileFile(suggestedName, content) {
  let lastError = null;
  if (typeof globalThis.showSaveFilePicker === "function") {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName,
        types: [{ description: "AutoGallery profile", accept: { "text/javascript": [".js"], "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      new Notice(t("已导出外挂配置：{name}", { name: handle.name || suggestedName }));
      return true;
    } catch (error) {
      // Obsidian may expose the API but reject it because the renderer is not
      // allowed to use a browser file handle. Continue with Electron below.
      if (error?.name === "AbortError") return false;
      lastError = error;
    }
  }
  const nodeRequire = globalThis.require ?? globalThis.window?.require;
  try {
    const electron = nodeRequire?.("electron");
    const remote = electron?.remote ?? nodeRequire?.("@electron/remote");
    const dialog = remote?.dialog ?? electron?.dialog;
    if (dialog?.showSaveDialog) {
      const options = {
        defaultPath: suggestedName,
        filters: [{ name: "JavaScript", extensions: ["js"] }]
      };
      let result;
      try {
        result = await dialog.showSaveDialog(options);
      } catch (error) {
        // Older Electron remote versions require the BrowserWindow argument.
        const currentWindow = remote?.getCurrentWindow?.();
        if (!currentWindow) throw error;
        result = await dialog.showSaveDialog(currentWindow, options);
      }
      if (result?.canceled || !result?.filePath) return false;
      const fs = nodeRequire?.("fs") ?? remote?.require?.("fs");
      if (!fs?.promises?.writeFile) throw new Error(t("无法访问文件系统"));
      await fs.promises.writeFile(result.filePath, content, "utf8");
      new Notice(t("已导出外挂配置：{path}", { path: result.filePath }));
      return true;
    }
  } catch (error) {
    lastError = error;
  }
  try {
    // Browser download is the final fallback for restricted renderers. Attach
    // the anchor to the document so Chromium accepts the synthetic click.
    const blob = new Blob([content], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.style.display = "none";
    document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    new Notice(t("已下载外挂配置：{name}", { name: suggestedName }));
    return true;
  } catch (error) {
    lastError = error;
  }
  throw lastError ?? new Error(t("当前环境不支持保存文件"));
}

function previewScroller(section) {
  return section.closest(".markdown-preview-view")
    ?? section.closest(".workspace-leaf-content")?.querySelector?.(".markdown-preview-view")
    ?? section.parentElement
    ?? null;
}

/**
 * The note's Markdown, read synchronously from the view that owns the section.
 * The first decoration pass needs the reference targets, and the vault read is
 * asynchronous — waiting for it costs a second pass over the whole section,
 * which is visible as the document collapsing twice.
 */
function readViewText(view, sourcePath) {
  if (!view || !sourcePath) return null;
  try {
    if (typeof view.getViewData !== "function") return null;
    const text = view.getViewData();
    return typeof text === "string" ? text : null;
  } catch {
    // A view that Obsidian is currently replacing cannot answer.
    return null;
  }
}

/**
 * Row assignment a gallery cell was stamped with, or null for a block that
 * is not (or no longer) part of a gallery. A malformed stamp is ignored: the
 * block then falls back to an ordinary measurement.
 */
function readGalleryRowStamp(block) {
  const raw = block?.getAttribute?.("data-ag-row");
  if (!raw) return null;
  try {
    const stamp = JSON.parse(raw);
    if (!Number.isFinite(stamp.height) || !Number.isFinite(stamp.gap)) return null;
    return { height: stamp.height, gap: stamp.gap, last: stamp.last === true };
  } catch {
    return null;
  }
}

function captureScrollAnchor(section) {
  const scroller = previewScroller(section);
  if (!scroller || typeof scroller.scrollTop !== "number") return null;
  const viewTop = scroller.getBoundingClientRect().top;
  const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  // Anchor to the first block under the viewport top instead of a raw scroll
  // offset. Decorating a section changes the height of blocks above the
  // viewport, so restoring `scrollTop` alone leaves the reader looking at
  // shifted content.
  let element = null;
  for (const child of section.children) {
    const rect = child.getBoundingClientRect();
    if (rect.bottom > viewTop + 1) { element = child; break; }
  }
  const anchor = {
    scroller,
    section,
    top: scroller.scrollTop,
    height: scroller.scrollHeight,
    atBottom: distanceFromBottom <= 16,
    element,
    text: element ? (element.textContent || "").trim().slice(0, 24) : "",
    index: element ? [...section.children].indexOf(element) : -1,
    offset: element ? element.getBoundingClientRect().top : 0
  };
  return anchor;
}

/**
 * The block an anchor points at. Obsidian rebuilds blocks (and the plugin's own
 * cleanup removes and re-creates the split ones), so the captured node is often
 * gone by the time the pass ends. The block's own text is then the only thing
 * that still identifies what the reader was looking at; several paragraphs can
 * share a prefix, so the candidate closest to the original index wins.
 */
function resolveAnchorElement(anchor, section) {
  if (anchor?.element?.isConnected) return anchor.element;
  const root = section ?? anchor?.section;
  if (!anchor?.text || !root) return null;
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  [...root.children].forEach((block, index) => {
    if (!(block.textContent || "").trim().startsWith(anchor.text)) return;
    const distance = Math.abs(index - anchor.index);
    if (distance >= bestDistance) return;
    bestDistance = distance;
    best = block;
  });
  return best;
}

function restoreScrollAnchor(anchor) {
  if (!anchor?.scroller?.isConnected) return;
  const { scroller } = anchor;
  // A decoration pass can shorten the document by more than a screen: the
  // reading view is rebuilt with the pictures at natural size and only then
  // collapses into gallery rows. Chromium's scroll anchoring follows that
  // collapse, so the offset after the pass is not the reader's any more — it is
  // the reshaping. Only a height change can move the offset like that, which is
  // what separates this from the jitter the guards below reject.
  const reflowed = Math.abs(scroller.scrollHeight - (Number(anchor.height) || scroller.scrollHeight)) > scroller.clientHeight;
  // Chromium's own scroll anchoring is enabled in the reading view. When the
  // anchored block is still connected it has already kept the block in place,
  // so the measured delta is zero and the plugin must not write `scrollTop`
  // again: doing so undoes the browser's correction and is what made the view
  // snap back while scrolling. The delta is only applied when the block really
  // moved (anchoring disabled, or a transient clamp), and the raw offset is
  // only used once the block was replaced together with the section.
  const align = () => {
    if (!scroller.isConnected) return;
    const target = resolveAnchorElement(anchor);
    if (target) {
      // A render can start from Obsidian's own scroll handler, so the capture
      // may predate a real scroll. Never correct against a stale viewport.
      if (!reflowed && Math.abs(scroller.scrollTop - anchor.top) > 24) return;
      const delta = target.getBoundingClientRect().top - anchor.offset;
      if (Math.abs(delta) > 0.5 && (reflowed || Math.abs(delta) < scroller.clientHeight)) scroller.scrollTop += delta;
      return;
    }
    const targetTop = anchor.atBottom
      ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      : anchor.top;
    if (Math.abs(scroller.scrollTop - targetTop) > 1) scroller.scrollTop = targetTop;
  };
  // The synchronous pass is authoritative: capture and restore happen in one
  // task, so the offset cannot belong to a newer user scroll.
  align();
  const settled = scroller.scrollTop;
  // A late reflow (image decode) may need a second correction, but only while
  // the reader has not scrolled since — their position is the newer intent.
  requestAnimationFrame(() => {
    if (!scroller.isConnected) return;
    if (Math.abs(scroller.scrollTop - settled) > 1) return;
    align();
  });
}

function waitForImageLoad(section) {
  const images = [...section.querySelectorAll("img")].filter((image) => !image.classList.contains("cm-widgetBuffer") && image.getAttribute("aria-hidden") !== "true");
  if (!images.length) return Promise.resolve();
  return Promise.all(images.map((image) => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        image.removeEventListener("load", finish);
        image.removeEventListener("error", finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 1500);
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    });
  }));
}

class ImageAnnotationModal extends Modal {
  constructor(app, editor) { super(app); this.editor = editor; }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: t("图片说明与布局") });
    const line = this.editor.getLine(this.editor.getCursor().line);
    const current = extractImageAnnotation(line) ?? { caption: "", params: {} };
    const caption = makeField(contentEl, t("图片说明"), current.caption);
    const layout = makeSelect(contentEl, t("布局"), ["auto", "gallery", "float", "center"], current.params.layout ?? "auto");
    const side = makeSelect(contentEl, t("浮动方向"), ["left", "right", "center"], current.params.side ?? "left");
    const width = makeField(contentEl, t("栏宽百分比"), current.params.width ? String(current.params.width) : "");
    const gap = makeField(contentEl, t("间距像素"), current.params.gap ? String(current.params.gap) : "");
    new Setting(contentEl).addButton((button) => button.setButtonText(t("应用")).setCta().onClick(() => {
      // Patch, never replace: a caption edit must keep `ag:isolate`,
      // `ag:crop` and every other parameter the form does not show.
      const patch = {
        layout: layout.value,
        side: side.value,
        width: width.value.trim() ? Number(width.value) : null,
        gap: gap.value.trim() ? Number(gap.value) : null
      };
      updateCurrentImageLine(this.editor, caption.value, patch);
      this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

function makeField(container, label, value) {
  let input;
  new Setting(container).setName(label).addText((text) => { input = text.inputEl; text.setValue(value); });
  return input;
}

function makeSelect(container, label, values, selected) {
  let select;
  new Setting(container).setName(label).addDropdown((dropdown) => {
    values.forEach((value) => dropdown.addOption(value, value));
    dropdown.setValue(selected);
    select = dropdown.selectEl;
  });
  return select;
}

function updateCurrentImageLine(editor, caption, params) {
  const original = editor.getLine(editor.getCursor().line);
  const updated = updateImageAnnotation(original, params, caption);
  if (updated === null) { new Notice(t("当前行没有可识别的 Markdown 或 Wiki 图片。")); return; }
  const line = editor.getCursor().line;
  editor.replaceRange(updated, { line, ch: 0 }, { line, ch: original.length });
}
