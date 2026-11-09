import { Modal, Notice, Setting, loadPdfJs } from "obsidian";
import { t } from "./i18n.js";
import { MARGIN_PRESET_OPTIONS, PDF_PAGE_SIZE_NAMES, pageSizePx } from "./print-geometry.js";
import { orphanLinesFor } from "./pdf-style.js";
import { fallbackToNative, resolvePdfRuntime } from "./pdf-session.js";

const RELAYOUT_DEBOUNCE_MS = 200;
const PERSIST_DEBOUNCE_MS = 400;
const PAGE_RENDER_MS = 15000;
/** CSS pixels per inch: the unit of every geometry value handed to printToPDF. */
const CSS_PX_PER_INCH = 96;

const EXPORT_CSS = `
.ag-pdf-export-modal { --dialog-width: min(1180px, 94vw); --dialog-max-width: min(1180px, 94vw); }
.modal.ag-pdf-export-modal { width: min(1180px, 94vw); max-width: min(1180px, 94vw); }
.ag-pdf-export-modal .modal-content { padding-top: 8px; }
.ag-pdf-export { display: flex; flex-direction: column; height: min(74vh, 760px); }
.ag-pdf-export h2 { margin: 0 0 10px; }
.ag-pdf-export__body { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 18px; }
.ag-pdf-export__aside { display: flex; flex-direction: column; min-height: 0; padding-right: 10px; border-right: 1px solid var(--background-modifier-border); }
.ag-pdf-export__config { flex: 1; min-height: 0; overflow-y: auto; }
.ag-pdf-export__config h4 { margin: 16px 0 2px; font-size: var(--font-ui-smaller); letter-spacing: .04em; color: var(--text-muted); }
.ag-pdf-export__config h4:first-child { margin-top: 0; }
.ag-pdf-export__config .setting-item { padding: 7px 0; border-top: none; }
.ag-pdf-export__config .setting-item-name { font-size: var(--font-ui-small); }
.ag-pdf-export__config .setting-item-description { font-size: var(--font-ui-smaller); }
.ag-pdf-export__margins { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; padding: 6px 0 4px; }
.ag-pdf-export__margins label { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-ui-smaller); color: var(--text-muted); }
.ag-pdf-export__margins input { width: 100%; }
/* One action rail under the settings column: two rows, both split evenly, so
   every control in the dialog sits on the same side and the preview keeps the
   full height. */
.ag-pdf-export__rail { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 10px; margin-top: 8px; border-top: 1px solid var(--background-modifier-border); }
.ag-pdf-export__rail button { width: 100%; }
.ag-pdf-export__rail button.is-active { background: var(--interactive-accent); border-color: transparent; color: var(--text-on-accent); }
.ag-pdf-export__preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 6px; }
.ag-pdf-export__stage { position: relative; flex: 1; min-height: 0; overflow: auto; padding: 16px; border-radius: var(--radius-m); background: var(--background-secondary); }
/* The sheet is the paper. It stays light in every theme because the exported
   PDF is printed in the light theme; sizing it from the paper size and the
   configured margins is what makes the preview show the real page box. */
.ag-pdf-export__sheet { position: relative; margin: 0 auto; background: #fff; border: 1px solid rgba(0, 0, 0, .18); box-shadow: 0 2px 14px rgba(0, 0, 0, .38); }
body.theme-dark .ag-pdf-export__sheet { border-color: rgba(255, 255, 255, .28); box-shadow: 0 2px 18px rgba(0, 0, 0, .65); }
/* The owned root is hidden only while it is a body child; inside the modal it
   would otherwise stretch to the pane and lose the paper content width. */
.ag-pdf-export__sheet > .print { position: absolute; left: 0; top: 0; margin: 0; padding: 0; transform-origin: top left; background: #fff; width: var(--ag-print-width, 700px) !important; max-width: var(--ag-print-width, 700px) !important; }
.ag-pdf-export__pages { display: none; flex-direction: column; align-items: center; gap: 16px; }
.ag-pdf-export__page { position: relative; background: #fff; box-shadow: 0 1px 8px rgba(0, 0, 0, .3); }
.ag-pdf-export__page canvas { display: block; }
.ag-pdf-export__page-no { position: absolute; right: 6px; bottom: 4px; font-size: 10px; color: rgba(0, 0, 0, .45); }
/* One line under the preview, on the preview's own centre. */
.ag-pdf-export__status { flex: 0 0 auto; min-width: 0; text-align: center; font-size: var(--font-ui-smaller); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/**
 * Export configuration surface. It owns the print tree only while displaying
 * it: every layout and pagination pass moves the tree back to `body` first,
 * because a `transform: scale()` ancestor invalidates every
 * `getBoundingClientRect()` measurement the renderer and the paginator make.
 */
export class PdfExportModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.file = options.file;
    this.session = options.session;
    this.persist = options.persist;
    this.onClosed = options.onClosed;
    this.documentRef = app?.workspace?.containerEl?.ownerDocument ?? globalThis.document;

    const base = this.session?.settings ?? {};
    this.prefs = {
      ...base,
      pdfExport: { ...(base.pdfExport ?? {}) },
      pdfPagination: { ...(base.pdfPagination ?? {}) }
    };

    this.mode = this.prefs.pdfExport?.previewMode === "pages" ? "pages" : "layout";
    // Heading breaks are the dialog's own override: the saved pair is only the
    // starting point, and nothing the reader changes here is written back.
    this.headingBreak = {
      enabled: this.prefs.pdfPagination?.headingBreakEnabled === true,
      level: Number(this.prefs.pdfPagination?.headingBreakLevel) || 2
    };
    this.scale = 1;
    this.busy = false;
    this.closed = false;
    this.failed = false;
    this.relayoutTimer = null;
    this.persistTimer = null;
    this.scaleTimer = null;
    this.relayoutRunning = false;
    this.relayoutPending = false;
    this.pageState = "idle";
    this.pageKey = "";
    this.tempPath = null;
    this.pdfDoc = null;
    this.observer = null;
    this.pageScale = 1;

    this.prepared = new Promise((resolve, reject) => {
      this.resolvePrepared = resolve;
      this.rejectPrepared = reject;
    });
    this.prepared.catch(() => {});
  }

  onOpen() {
    this.modalEl.addClass("ag-pdf-export-modal");
    this.modalEl.style.setProperty("--dialog-width", "min(1180px, 94vw)");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("style", { text: EXPORT_CSS });

    const root = contentEl.createDiv({ cls: "ag-pdf-export" });
    root.createEl("h2", { text: t("导出 PDF") });
    const body = root.createDiv({ cls: "ag-pdf-export__body" });
    const aside = body.createDiv({ cls: "ag-pdf-export__aside" });
    this.configEl = aside.createDiv({ cls: "ag-pdf-export__config" });
    // Every action lives in one rail under the settings column: the preview owns
    // the full height, and nothing scrolls out of reach.
    const rail = aside.createDiv({ cls: "ag-pdf-export__rail" });
    this.layoutBtn = rail.createEl("button", { text: t("版式预览"), cls: "ag-pdf-export__mode" });
    this.pagesBtn = rail.createEl("button", { text: t("分页预览"), cls: "ag-pdf-export__mode" });
    this.layoutBtn.addEventListener("click", () => this.showLayout());
    this.pagesBtn.addEventListener("click", () => this.showPages());
    this.cancelBtn = rail.createEl("button", { text: t("取消") });
    this.cancelBtn.addEventListener("click", () => this.close());
    this.exportBtn = rail.createEl("button", { text: t("导出 PDF"), cls: "mod-cta" });
    this.exportBtn.addEventListener("click", () => this.runExport());
    this.nativeBtn = rail.createEl("button", { text: t("使用 Obsidian 原生导出"), cls: "mod-warning" });
    this.nativeBtn.style.display = "none";
    // The fallback is a rare extra row; let it use the whole rail width.
    this.nativeBtn.style.gridColumn = "1 / -1";
    this.nativeBtn.addEventListener("click", () => this.runNativeFallback());
    this.syncModeButtons();

    const preview = body.createDiv({ cls: "ag-pdf-export__preview" });
    this.stageEl = preview.createDiv({ cls: "ag-pdf-export__stage" });
    this.sheetEl = this.stageEl.createDiv({ cls: "ag-pdf-export__sheet" });
    this.pagesEl = this.stageEl.createDiv({ cls: "ag-pdf-export__pages" });
    // The status is a thin strip under the preview, centred on the preview axis.
    this.statusEl = preview.createDiv({ cls: "ag-pdf-export__status", text: t("正在准备预览…") });

    this.renderConfig();
    // Deferred for the same reason as the crop modal: resizing the sheet from
    // inside the observer callback changes the observed box in the same
    // delivery and Chromium logs an undelivered-notification loop.
    this.observer = new ResizeObserver(() => this.scheduleScale());
    this.observer.observe(this.stageEl);
    this.runPrepare();
  }

  onClose() {
    this.closed = true;
    // Anyone waiting for the first paint must stop waiting: the tree is about
    // to be torn down and can never become previewable.
    this.resolvePrepared?.(false);
    clearTimeout(this.relayoutTimer);
    clearTimeout(this.persistTimer);
    clearTimeout(this.scaleTimer);
    this.relayoutTimer = null;
    this.persistTimer = null;
    this.scaleTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    this.disposePdf();
    this.session?.destroy();
    this.contentEl.empty();
    this.onClosed?.();
  }

  close() {
    // Tearing the print tree down mid-print yields an empty or half-rendered
    // PDF, and the reply would resolve against a tree that no longer exists.
    if (this.busy) {
      new Notice(t("正在处理，请稍候。"));
      return;
    }
    super.close();
  }

  /* ---------------------------------------------------------------- layout */

  renderConfig() {
    const container = this.configEl;
    if (!container) return;
    const scroll = container.scrollTop;
    container.empty();
    const pdf = this.prefs.pdfExport;

    container.createEl("h4", { text: t("页面") });
    new Setting(container)
      .setName(t("纸张"))
      .setDesc(t("跟随 Obsidian 时使用原生导出设置中的纸张。"))
      .addDropdown((dropdown) => {
        dropdown.addOption("inherit", t("跟随 Obsidian"));
        for (const name of PDF_PAGE_SIZE_NAMES) dropdown.addOption(name, name);
        dropdown.setValue(pdf.pageSize ?? "inherit");
        dropdown.onChange((value) => this.patchExport({ pageSize: value }));
      });
    new Setting(container)
      .setName(t("方向"))
      .addDropdown((dropdown) => {
        dropdown.addOption("inherit", t("跟随 Obsidian"));
        dropdown.addOption("portrait", t("纵向"));
        dropdown.addOption("landscape", t("横向"));
        dropdown.setValue(pdf.orientation ?? "inherit");
        dropdown.onChange((value) => this.patchExport({ orientation: value }));
      });
    new Setting(container)
      .setName(t("页边距"))
      .addDropdown((dropdown) => {
        dropdown.addOption("inherit", t("跟随 Obsidian"));
        dropdown.addOption("preset", t("预设"));
        dropdown.addOption("custom", t("自定义"));
        dropdown.setValue(pdf.marginMode ?? "inherit");
        dropdown.onChange((value) => {
          this.patchExport({ marginMode: value });
          this.renderConfig();
        });
      });
    if (pdf.marginMode === "preset") {
      new Setting(container)
        .setName(t("边距预设"))
        .addDropdown((dropdown) => {
          for (const [value, label] of MARGIN_PRESET_OPTIONS.map(([v, l]) => [v, t(l)])) dropdown.addOption(value, label);
          dropdown.setValue(pdf.marginPreset ?? "narrow");
          dropdown.onChange((value) => this.patchExport({ marginPreset: value }));
        });
    }
    if (pdf.marginMode === "preset" || pdf.marginMode === "custom") {
      new Setting(container)
        .setName(t("奇偶页不同"))
        .setDesc(t("内侧 / 外侧分别设置；奇数页内侧在左，偶数页内侧在右。"))
        .addToggle((toggle) => toggle.setValue(pdf.mirrorMargins === true)
          .onChange((value) => {
            this.patchExport({ mirrorMargins: value });
            this.renderConfig();
          }));
    }
    if (pdf.mirrorMargins === true && (pdf.marginMode === "preset" || pdf.marginMode === "custom")) {
      const mirror = container.createDiv({ cls: "ag-pdf-export__margins" });
      for (const [key, label] of [["innerMarginMm", t("内侧（mm）")], ["outerMarginMm", t("外侧（mm）")]]) {
        const field = mirror.createEl("label");
        field.createSpan({ text: label });
        const input = field.createEl("input", { attr: { type: "number", min: "0", max: "80", step: "1" } });
        input.value = String(Math.round(Number(pdf[key] ?? (key === "innerMarginMm" ? 20 : 12))));
        input.addEventListener("change", () => {
          const value = Math.max(0, Math.min(80, Number(input.value) || 0));
          this.patchExport({ [key]: value });
        });
      }
    }
    if (pdf.marginMode === "custom") {
      const grid = container.createDiv({ cls: "ag-pdf-export__margins" });
      for (const [key, label] of [["top", t("上（mm）")], ["right", t("右（mm）")], ["bottom", t("下（mm）")], ["left", t("左（mm）")]]) {
        const field = grid.createEl("label");
        field.createSpan({ text: label });
        const input = field.createEl("input", { attr: { type: "number", min: "0", max: "50", step: "1" } });
        input.value = String(Math.round(Number(pdf.marginMm?.[key] ?? 12)));
        input.addEventListener("change", () => {
          const value = Math.max(0, Math.min(50, Number(input.value) || 0));
          // Read the live object: the sibling fields were closed over the
          // snapshot taken when this panel was built, and reusing it would
          // silently drop the other three margins edited since.
          this.patchExport({
            marginMm: { ...(this.prefs.pdfExport.marginMm ?? {}), [key]: value }
          });
        });
      }
    }
    new Setting(container)
      .setName(t("缩放"))
      .setDesc(t("留空时跟随 Obsidian 原生导出设置。"))
      .addText((text) => {
        text.setPlaceholder(t("跟随 Obsidian"));
        text.setValue(pdf.scalePercent === "inherit" ? "" : String(pdf.scalePercent ?? ""));
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "200";
        text.inputEl.step = "1";
        text.inputEl.addEventListener("change", () => {
          const raw = text.inputEl.value.trim();
          const value = raw ? Math.max(10, Math.min(200, Math.round(Number(raw) || 100))) : "inherit";
          this.patchExport({ scalePercent: value });
        });
      });
    new Setting(container)
      .setName(t("包含笔记标题"))
      .addToggle((toggle) => toggle.setValue(pdf.includeTitle === true)
        .onChange((value) => this.patchExport({ includeTitle: value })));
    const pageNumber = pdf.pageNumber ?? { enabled: true, band: "footer", align: "center" };
    // Two selects edit the same object; reading it live keeps the second change
    // from restoring the first one from this render's snapshot.
    const livePageNumber = () => this.prefs.pdfExport.pageNumber ?? pageNumber;
    new Setting(container)
      .setName(t("页码"))
      .setDesc(t("页码随真实打印生成，只在分页预览与导出结果中显示。"))
      .addToggle((toggle) => toggle.setValue(pageNumber.enabled !== false)
        .onChange((value) => {
          this.patchExport({ pageNumber: { ...livePageNumber(), enabled: value } });
          this.renderConfig();
        }));
    if (pageNumber.enabled !== false) {
      new Setting(container)
        .setName(t("页码位置"))
        .addDropdown((dropdown) => {
          dropdown.addOption("header", t("页眉"));
          dropdown.addOption("footer", t("页尾"));
          dropdown.setValue(pageNumber.band ?? "footer");
          dropdown.onChange((value) => this.patchExport({ pageNumber: { ...livePageNumber(), band: value } }));
        });
      new Setting(container)
        .setName(t("页码对齐"))
        .addDropdown((dropdown) => {
          dropdown.addOption("left", t("居左"));
          dropdown.addOption("center", t("居中"));
          dropdown.addOption("right", t("居右"));
          dropdown.setValue(pageNumber.align ?? "center");
          dropdown.onChange((value) => this.patchExport({ pageNumber: { ...livePageNumber(), align: value } }));
        });
    }

    container.createEl("h4", { text: t("分页优化") });
    const pagination = this.prefs.pdfPagination ?? {};
    new Setting(container)
      .setName(t("标题分页"))
      .setDesc(t("符合等级的标题另起一页；等级默认继承设置页，改动只对本次导出生效。"))
      .addToggle((toggle) => toggle.setValue(this.headingBreak.enabled)
        .onChange((value) => {
          this.headingBreak.enabled = value;
          this.renderConfig();
          this.scheduleRelayout();
        }));
    if (this.headingBreak.enabled) {
      new Setting(container)
        .setName(t("标题分页等级"))
        .setDesc(t("仅影响本次导出。"))
        .addDropdown((dropdown) => {
          for (const level of [1, 2, 3, 4, 5, 6]) dropdown.addOption(String(level), t("{level} 级及更高级", { level }));
          dropdown.setValue(String(this.headingBreak.level));
          dropdown.onChange((value) => {
            this.headingBreak.level = Number(value) || 2;
            this.scheduleRelayout();
          });
        });
    }
    new Setting(container)
      .setName(t("孤行控制"))
      .setDesc(t("关闭后沿用 Obsidian 原生的 2 行孤行策略。"))
      .addToggle((toggle) => toggle.setValue(pagination.orphanControlEnabled !== false)
        .onChange((value) => this.patchPagination({ orphanControlEnabled: value })));
    new Setting(container)
      .setName(t("图片分页优化"))
      .setDesc(t("压缩单图高度以避免整页空白。"))
      .addToggle((toggle) => toggle.setValue(pagination.imageOptimizationEnabled !== false)
        .onChange((value) => this.patchPagination({ imageOptimizationEnabled: value })));

    container.createEl("h4", { text: t("导出") });
    new Setting(container)
      .setName(t("导出后打开文件"))
      .addToggle((toggle) => toggle.setValue(pdf.openAfterExport === true)
        .onChange((value) => this.patchExport({ openAfterExport: value })));

    container.scrollTop = scroll;
  }

  /** Snapshot handed to the print session: the dialog's own edits, never saved. */
  effectivePrefs() {
    return {
      ...this.prefs,
      pdfPagination: {
        ...this.prefs.pdfPagination,
        headingBreakEnabled: this.headingBreak.enabled,
        headingBreakLevel: this.headingBreak.level
      }
    };
  }

  patchExport(patch) {
    this.prefs.pdfExport = { ...this.prefs.pdfExport, ...patch };
    this.scheduleRelayout();
  }

  patchPagination(patch) {
    this.prefs.pdfPagination = { ...this.prefs.pdfPagination, ...patch };
    this.scheduleRelayout();
  }

  scheduleRelayout() {
    clearTimeout(this.relayoutTimer);
    // A timer, not rAF: Obsidian pauses animation frames while the window is
    // hidden, and the preview must still settle when the reader comes back.
    this.relayoutTimer = setTimeout(() => {
      this.relayoutTimer = null;
      this.runRelayout();
    }, RELAYOUT_DEBOUNCE_MS);
    this.schedulePersist();
  }

  async runRelayout() {
    if (this.closed || !this.session?.ready) return;
    // Pagination and page rendering own the tree; re-laying it out underneath
    // them would empty the canvas list mid-render.
    if (this.busy) {
      this.relayoutPending = true;
      return;
    }
    if (this.relayoutRunning) {
      this.relayoutPending = true;
      return;
    }
    this.relayoutRunning = true;
    try {
      this.session.ensureBodyPosition();
      this.session.relayout(this.effectivePrefs());
      this.session.mountTo(this.sheetEl);
      // The page canvases belong to the previous geometry; keeping them would
      // show breaks that no longer match the document.
      const keepPages = this.mode === "pages";
      this.disposePdf();
      if (!keepPages) {
        this.mode = "layout";
        this.pagesEl.style.display = "none";
        this.sheetEl.style.display = "";
      }
      this.syncModeButtons();
      this.applyScale();
      this.setStatus("");
      // A setting change must not drop the reader out of the paginated view:
      // when they are looking at pages, the new geometry is paginated again.
      if (keepPages) await this.showPages();
    } catch (error) {
      this.setStatus(t("预览失败：{error}", { error: error?.message ?? error }));
    } finally {
      this.relayoutRunning = false;
      if (this.relayoutPending) {
        this.relayoutPending = false;
        this.runRelayout();
      }
    }
  }

  async runPrepare() {
    try {
      await this.session.prepare();
      if (this.closed) {
        this.resolvePrepared(false);
        return;
      }
      // A setting can be touched while the render is still running; the first
      // decoration used the session's snapshot, so replay the current prefs.
      this.session.relayout(this.effectivePrefs());
      this.session.mountTo(this.sheetEl);
      this.applyScale();
      this.syncModeButtons();
      this.setStatus("");
      this.resolvePrepared(true);
      // Paginated preview costs a full print round trip, so it only starts on
      // open when the reader made it the default. The promise above already
      // resolved: the dialog is usable while the pages render.
      if (this.mode === "pages") void this.showPages();
    } catch (error) {
      // A cancelled modal is not a failure: the reader closed it, and firing
      // the native fallback there would open a second exporter behind them.
      if (this.closed) {
        this.resolvePrepared(false);
        return;
      }
      this.setStatus(t("预览失败：{error}", { error: error?.message ?? error }));
      this.rejectPrepared(error);
    }
  }

  /* --------------------------------------------------------------- preview */

  scheduleScale() {
    if (this.scaleTimer !== null) return;
    this.scaleTimer = setTimeout(() => {
      this.scaleTimer = null;
      if (!this.closed) this.applyScale();
    }, 0);
  }

  applyScale() {
    if (!this.stageEl || !this.sheetEl || !this.session?.geometry) return;
    if (this.mode === "pages") {
      this.fitPages();
      return;
    }
    const geometry = this.session.geometry;
    const paper = pageSizePx(geometry);
    const available = Math.max(80, (this.stageEl.clientWidth || 0) - 32);
    const zoom = Math.min(1, Math.max(0.15, available / paper.width));
    // Chromium prints the laid-out page at `geometry.scale`, so the content has
    // to be shown at layout-scale × print-scale to end up the size it will have
    // on paper. Margins are physical: they only carry the preview zoom.
    const contentScale = zoom * (Number(geometry.scale) || 1);
    const margins = geometry.marginsIn ?? {};
    const marginTop = (Number(margins.top) || 0) * CSS_PX_PER_INCH * zoom;
    const marginLeft = (Number(margins.left) || 0) * CSS_PX_PER_INCH * zoom;
    const marginBottom = (Number(margins.bottom) || 0) * CSS_PX_PER_INCH * zoom;
    this.scale = contentScale;
    this.sheetEl.style.width = `${paper.width * zoom}px`;
    this.sheetEl.style.height = `${marginTop + this.session.measureHeight() * contentScale + marginBottom}px`;
    const root = this.session.root;
    if (root) {
      root.style.left = `${marginLeft}px`;
      root.style.top = `${marginTop}px`;
      root.style.transform = `scale(${contentScale})`;
    }
  }

  fitPages() {
    const geometry = this.session?.geometry;
    if (!geometry || !this.pagesEl) return;
    const paper = pageSizePx(geometry);
    const available = Math.max(80, (this.stageEl?.clientWidth || 0) - 32);
    const scale = Math.min(1, Math.max(0.15, available / paper.width));
    this.pageScale = scale;
    for (const canvas of this.pagesEl.querySelectorAll("canvas")) {
      canvas.style.width = `${paper.width * scale}px`;
      canvas.style.height = `${paper.height * scale}px`;
    }
  }

  showLayout() {
    if (this.busy) return;
    this.mode = "layout";
    if (this.pagesEl) this.pagesEl.style.display = "none";
    if (this.sheetEl) this.sheetEl.style.display = "";
    this.syncModeButtons();
    this.applyScale();
    this.setStatus("");
  }

  async showPages() {
    if (this.busy || !this.session?.ready) return;
    // Selecting the mode twice must not toggle back: the two buttons are
    // explicit selections, not one switch.
    if (this.mode === "pages" && this.pageState === "ready") {
      this.syncModeButtons();
      this.applyScale();
      this.setStatus("");
      return;
    }
    const key = this.pageCacheKey();
    if (this.pageState === "ready" && this.pageKey === key) {
      this.mode = "pages";
      this.pagesEl.style.display = "flex";
      this.sheetEl.style.display = "none";
      this.syncModeButtons();
      this.fitPages();
      this.setStatus("");
      return;
    }
    this.setBusy(true, t("正在生成分页预览…"));
    try {
      this.session.ensureBodyPosition();
      this.session.paginate();
      const temp = await this.session.printToTemp();
      this.session.unpaginate();
      this.session.mountTo(this.sheetEl);
      this.applyScale();
      this.disposePdf();
      this.tempPath = temp;
      this.pagesEl.empty();
      await this.renderPdf(temp);
      this.pageKey = key;
      this.pageState = "ready";
      this.mode = "pages";
      this.pagesEl.style.display = "flex";
      this.sheetEl.style.display = "none";
      this.fitPages();
      this.syncModeButtons();
      this.setStatus("");
    } catch (error) {
      this.pageState = "failed";
      this.mode = "layout";
      console.error("[AutoGallery] page preview failed", error);
      if (this.pagesEl) this.pagesEl.style.display = "none";
      if (this.sheetEl) this.sheetEl.style.display = "";
      // A failed print leaves the tree on `body`, where it is off-screen.
      // Put it back so the layout preview keeps working.
      this.session.mountTo(this.sheetEl);
      this.applyScale();
      this.syncModeButtons();
      this.setStatus(t("分页预览失败：{error}", { error: error?.message ?? error }));
    } finally {
      this.session.unpaginate();
      this.setBusy(false);
      this.drainRelayout();
    }
  }

  syncModeButtons() {
    this.layoutBtn?.classList.toggle("is-active", this.mode === "layout");
    this.pagesBtn?.classList.toggle("is-active", this.mode === "pages");
  }

  async renderPdf(path) {
    const runtime = resolvePdfRuntime();
    if (!runtime) throw new Error(t("当前环境不支持分页预览"));
    const pdfjsLib = await loadPdfJs();
    const data = await runtime.fs.promises.readFile(path);
    const doc = await pdfjsLib.getDocument({ data }).promise;
    this.pdfDoc = doc;
    const geometry = this.session.geometry;
    const paper = pageSizePx(geometry);
    const available = Math.max(80, (this.stageEl?.clientWidth || 0) - 32);
    const scale = Math.min(1, Math.max(0.15, available / paper.width));
    this.pageScale = scale;
    const dpr = Math.min(2, this.documentRef?.defaultView?.devicePixelRatio || 1);
    // pdf.js lays out in points (1/72"), while `paper` is in CSS pixels
    // (1/96"). Rendering at `scale*dpr` and displaying at `paper*scale` would
    // stretch every page by 4/3, so the point scale carries the conversion.
    const pointScale = scale * dpr * (96 / 72);
    for (let index = 1; index <= doc.numPages; index += 1) {
      if (this.closed) return;
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: pointScale });
      const wrapper = this.pagesEl.createDiv({ cls: "ag-pdf-export__page" });
      const canvas = wrapper.createEl("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${paper.width * scale}px`;
      canvas.style.height = `${paper.height * scale}px`;
      wrapper.createDiv({ cls: "ag-pdf-export__page-no", text: `${index} / ${doc.numPages}` });
      const task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      // pdf.js yields between render chunks on an animation frame. A window
      // that is minimised or occluded never runs one, so the task would stay
      // pending forever and the dialog would look hung.
      const finished = await Promise.race([
        task.promise.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), PAGE_RENDER_MS))
      ]);
      if (!finished) {
        try { task.cancel(); } catch { /* already settled */ }
        throw new Error(t("第 {index} 页渲染超时（窗口可能处于后台）", { index }));
      }
    }
  }

  pageCacheKey() {
    const geometry = this.session?.geometry ?? {};
    const pagination = this.prefs.pdfPagination ?? {};
    return [
      this.file?.path ?? "",
      Math.round(geometry.contentWidthPx ?? 0),
      Math.round(geometry.contentHeightPx ?? 0),
      geometry.scale ?? 1,
      JSON.stringify(geometry.marginsIn ?? {}),
      orphanLinesFor(this.prefs),
      this.prefs.pdfExport?.includeTitle === true ? 1 : 0,
      this.headingBreak.enabled ? 1 : 0,
      this.headingBreak.level,
      pagination.imageOptimizationEnabled !== false ? 1 : 0,
      pagination.imageShrinkPriority ?? "",
      pagination.singleImageMaxShrink ?? "",
      pagination.lineHeightMaxShrink ?? "",
      pagination.orphanControlEnabled !== false ? 1 : 0,
      pagination.orphanMaxLines ?? "",
      // The float policy changes whether a picture and its prose are bound
      // together, so it changes the printed pages. Without it here, switching
      // the setting and previewing again served the previous PDF.
      this.prefs.floatSpaceMode ?? "ordered"
    ].join("|");
  }

  /* ---------------------------------------------------------------- export */

  async runExport() {
    if (this.busy) return;
    let target = null;
    try {
      target = await this.session.pickTarget();
    } catch (error) {
      new Notice(t("无法打开保存对话框：{error}", { error: error?.message ?? error }));
      return;
    }
    // Cancelling the save dialog must leave the modal untouched: no print, no
    // temporary file, and the preview keeps its state.
    if (!target) return;

    this.setBusy(true, t("正在导出…"));
    let succeeded = false;
    try {
      this.session.ensureBodyPosition();
      this.session.paginate();
      await this.session.printToFile(target);
      new Notice(t("已导出 PDF：{target}", { target }));
      await this.flushPersist();
      if (this.prefs.pdfExport?.openAfterExport === true) this.session.openPath(target);
      succeeded = true;
    } catch (error) {
      this.failed = true;
      this.setStatus(t("导出失败：{error}", { error: error?.message ?? error }));
      new Notice(t("AutoGallery 导出失败：{error}", { error: error?.message ?? error }));
      if (this.nativeBtn) this.nativeBtn.style.display = "";
      // The tree is off-screen on `body` after a failed print; put it back so
      // the reader can adjust the settings and retry.
      this.session.mountTo(this.sheetEl);
      this.applyScale();
    } finally {
      this.session.unpaginate();
      this.setBusy(false);
      this.drainRelayout();
    }
    if (succeeded) {
      this.busy = false;
      super.close();
    }
  }

  runNativeFallback() {
    const message = this.statusEl?.textContent || t("导出失败");
    this.busy = false;
    // Closing first tears the print tree down, exactly like the exporter's
    // fallback: the native exporter builds its own `.print` element.
    super.close();
    fallbackToNative(this.app, new Error(message));
  }

  /* -------------------------------------------------------------- plumbing */

  setBusy(value, message) {
    this.busy = value;
    if (message) this.setStatus(message);
    for (const button of [this.layoutBtn, this.pagesBtn, this.cancelBtn, this.exportBtn, this.nativeBtn]) {
      if (button) button.disabled = value;
    }
  }

  setStatus(text) {
    this.statusText = text ?? "";
    if (!this.statusEl) return;
    this.statusEl.textContent = this.statusText || this.idleStatus();
  }

  /** What the status line says when no operation owns it. */
  idleStatus() {
    if (this.mode !== "pages") {
      const hint = t("在左侧切换到分页预览模式计算页数，可通过设置配置默认预览模式");
      // The page number is printed by Chromium outside this tree, so the layout
      // preview can never show it; say so instead of letting it look missing.
      return this.prefs.pdfExport?.pageNumber?.enabled !== false ? `${t("页码只在分页预览与导出中显示；")}${hint}` : hint;
    }
    const pages = this.pdfDoc?.numPages;
    return pages ? t("共 {pages} 页", { pages }) : "";
  }

  drainRelayout() {
    if (!this.relayoutPending || this.closed) return;
    this.relayoutPending = false;
    this.runRelayout();
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  async flushPersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    try {
      await this.persist?.(this.prefs);
    } catch (error) {
      console.error("[AutoGallery] could not persist PDF settings", error);
    }
  }

  disposePdf() {
    const doc = this.pdfDoc;
    this.pdfDoc = null;
    try { doc?.destroy?.(); } catch { /* already gone */ }
    this.pagesEl?.empty?.();
    this.pageState = "idle";
    this.pageKey = "";
    this.deleteTemp();
  }

  deleteTemp() {
    const target = this.tempPath;
    this.tempPath = null;
    if (!target) return;
    const fs = resolvePdfRuntime()?.fs;
    try { fs?.promises?.unlink(target).catch(() => {}); } catch { /* best effort */ }
  }
}
