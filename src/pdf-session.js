import { Component, MarkdownRenderer, Notice, Platform } from "obsidian";
import { t } from "./i18n.js";
import { renderAutoGallery, resetFloatIndices } from "./renderer.js";
import { optimizePdfPagination } from "./pdf-pagination.js";
import { resolveRoute } from "./routes.js";
import { resolvePrintGeometry, toPrintOptions } from "./print-geometry.js";
import { composePdfStyle, orphanLinesFor } from "./pdf-style.js";
import { buildLightThemePatch } from "./print-theme.js";

const OWNER = "plugin";
const IMAGE_WAIT_MS = 5000;

let runtime = null;
// `print-to-pdf` prints the whole window through one shared IPC channel. A
// preview render and an export must never overlap: the second reply would
// resolve the first promise and both files would contain the same document.
let printQueue = Promise.resolve();

/**
 * Obsidian's native exporter prints from a hidden popup whose viewport is zero
 * until print layout, so every geometry-driven decision degenerates there.
 * This session renders the same document into a `.print` element inside the
 * main window, where measurement is real, and prints that window through
 * Obsidian's own print IPC.
 *
 * Every measurement in here is only valid while the tree is a direct child of
 * `body` and carries no scaling ancestor. The export modal moves the tree into
 * a `transform: scale()` wrapper to display it, so all layout and pagination
 * passes call `ensureBodyPosition()` first.
 */
export class PdfPrintSession {
  constructor({ app, getSettings, file, native } = {}) {
    this.app = app;
    this.getSettings = getSettings;
    this.file = file;
    this.native = native && typeof native === "object" ? native : {};
    this.settings = getSettings?.() ?? {};
    this.documentRef = app?.workspace?.containerEl?.ownerDocument ?? globalThis.document;

    this.geometry = null;
    this.root = null;
    this.stage = null;
    this.style = null;
    this.component = null;
    this.sourceText = "";
    this.titleBlock = null;
    this.renderCleanup = null;
    this.paginationCleanup = null;
    this.ready = false;
  }

  /** Build, render and decorate once. Repeating the call is a no-op. */
  async prepare() {
    if (this.ready) return this;
    try {
      this.buildPrintTree();
      await this.renderContent();
      await this.waitForReady();
      this.decorate();
      this.ready = true;
      return this;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  /** Move the tree back to `body`: the only position where measurement is valid. */
  ensureBodyPosition() {
    const body = this.documentRef?.body;
    if (!body || !this.root) return;
    // The preview wrapper scales the tree with a CSS transform. It must be gone
    // before anything measures or prints, otherwise every rect is off by the
    // preview scale and the PDF comes out scaled down.
    this.root.style.removeProperty("transform");
    if (this.root.parentElement !== body) body.appendChild(this.root);
  }

  /** Display the tree inside the modal. `appendChild` moves, it never clones. */
  mountTo(hostEl) {
    if (!hostEl || !this.root) return;
    hostEl.appendChild(this.root);
  }

  /**
   * Re-run layout for new print settings. The Markdown rendering is reused; only
   * the print geometry CSS and the image decoration are rebuilt.
   */
  relayout(settings) {
    if (settings) this.settings = settings;
    if (!this.ready) return;
    // Order matters. Pagination writes inline styles the renderer snapshots, so
    // it has to be rolled back before the renderer cleanup runs; otherwise the
    // cleanup "restores" the paginated values and every later pass inherits them.
    this.ensureBodyPosition();
    this.unpaginate();
    try { this.renderCleanup?.(); } catch { /* detached tree */ }
    this.renderCleanup = null;
    try { resetFloatIndices(this.stage); } catch { /* detached tree */ }
    this.geometry = this.resolveGeometry();
    this.root.style.setProperty("--ag-print-width", `${this.geometry.contentWidthPx}px`);
    this.writePrintStyle();
    // The title participates in layout (it is the first block), so it must be
    // in place before the renderer measures anything.
    this.setIncludeTitle(this.settings?.pdfExport?.includeTitle === true);
    this.decorate();
  }

  /**
   * The page number is printed by Chromium, outside this document, so its font
   * has to be copied in. Reading it from the rendered stage keeps the number on
   * the same typeface as the note instead of Chromium's serif default.
   */
  resolveGeometry() {
    const family = this.stage
      ? this.documentRef?.defaultView?.getComputedStyle?.(this.stage)?.fontFamily
      : "";
    return resolvePrintGeometry(this.settings, this.native, { fontFamily: family });
  }

  /**
   * The title lives outside the Markdown tree, so it can be toggled without a
   * second `MarkdownRenderer` pass. It keeps its own block wrapper because
   * `wrapTopLevelBlocks` already ran.
   */
  setIncludeTitle(include) {
    if (!this.stage || !this.titleBlock) return;
    if (include) {
      if (this.titleBlock.parentElement !== this.stage) {
        this.stage.insertBefore(this.titleBlock, this.stage.firstChild);
      }
      return;
    }
    this.titleBlock.remove();
  }

  /** Pagination is destructive; call `unpaginate()` to restore the screen tree. */
  paginate() {
    if (this.paginationCleanup) return;
    if (!this.root || !this.geometry) return;
    this.ensureBodyPosition();
    const contentWidth = Math.max(1, this.stage.clientWidth || this.geometry.contentWidthPx);
    const contentTop = this.stage.getBoundingClientRect?.().top ?? 0;
    this.paginationCleanup = optimizePdfPagination(this.root, {
      pageWidth: contentWidth,
      pageHeight: this.geometry.contentHeightPx,
      contentTop,
      settings: this.settings
    });
  }

  unpaginate() {
    if (!this.paginationCleanup) return;
    try { this.paginationCleanup(); } catch { /* keep unwinding */ }
    this.paginationCleanup = null;
  }

  /** Unscaled layout height of the print root. Layout values ignore `transform`. */
  measureHeight() {
    return Math.max(0, this.root?.offsetHeight || this.root?.scrollHeight || 0);
  }

  async pickTarget() {
    const electron = resolvePdfRuntime();
    if (!electron) throw new Error(t("当前环境不支持 PDF 导出"));
    const basePath = this.app?.vault?.adapter?.getBasePath?.() ?? this.app?.vault?.adapter?.basePath ?? "";
    const folder = this.file?.parent?.path && this.file.parent.path !== "/" ? this.file.parent.path : "";
    const defaultPath = basePath
      ? electron.path.join(basePath, ...folder.split("/").filter(Boolean), `${this.file.basename}.pdf`)
      : `${this.file?.basename ?? "note"}.pdf`;
    const result = await electron.dialog.showSaveDialog({
      title: t("导出 PDF（AutoGallery）"),
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"]
    });
    if (result?.canceled || !result?.filePath) return null;
    return result.filePath;
  }

  async printToFile(target) {
    const electron = resolvePdfRuntime();
    if (!electron) throw new Error(t("当前环境不支持 PDF 导出"));
    this.ensureBodyPosition();
    await withPrintLock(async () => {
      const previousTitle = this.documentRef?.title;
      try {
        // Chromium takes the PDF title from `document.title`; the window title
        // also names the vault and the app, which reads badly in a reader.
        if (this.documentRef) this.documentRef.title = this.file?.basename ?? previousTitle;
        await printToPdf(electron, this.geometry, target, this.settings);
        await verifyOutput(electron.fs, target);
      } finally {
        if (this.documentRef && previousTitle !== undefined) this.documentRef.title = previousTitle;
      }
    });
  }

  /** Print into a throwaway file the caller owns and must delete. */
  async printToTemp() {
    const electron = resolvePdfRuntime();
    if (!electron) throw new Error(t("当前环境不支持 PDF 导出"));
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `autogallery-preview-${stamp}.pdf`;
    const dir = electron.os?.tmpdir?.() ?? "";
    const target = dir ? electron.path.join(dir, name) : name;
    await this.printToFile(target);
    return target;
  }

  openPath(target) {
    const shell = resolvePdfRuntime()?.shell;
    if (!shell?.openPath) return false;
    try {
      shell.openPath(target);
      return true;
    } catch {
      return false;
    }
  }

  destroy() {
    this.unpaginate();
    try { this.renderCleanup?.(); } catch { /* keep unwinding */ }
    this.renderCleanup = null;
    try { resetFloatIndices(this.stage); } catch { /* detached tree */ }
    this.style?.remove();
    this.root?.remove();
    try { this.component?.unload(); } catch { /* already unloaded */ }
    this.root = null;
    this.stage = null;
    this.style = null;
    this.component = null;
    this.titleBlock = null;
    this.ready = false;
  }

  buildPrintTree() {
    const documentRef = this.documentRef;
    this.geometry = this.resolveGeometry();
    const root = documentRef.createElement("div");
    root.className = "print theme-light";
    root.dataset.agPdfOwner = OWNER;
    root.style.setProperty("--ag-print-width", `${this.geometry.contentWidthPx}px`);
    const stage = documentRef.createElement("div");
    stage.className = "markdown-preview-view markdown-rendered";
    root.appendChild(stage);
    const style = documentRef.createElement("style");
    style.dataset.agPrintStyle = "true";
    documentRef.head.appendChild(style);
    documentRef.body.appendChild(root);
    const component = new Component();
    component.load();
    this.root = root;
    this.stage = stage;
    this.style = style;
    this.component = component;
    // Only now is the stage part of the document, which is the one moment the
    // text font can be read; the page-number template needs it.
    this.geometry = this.resolveGeometry();
    root.style.setProperty("--ag-print-width", `${this.geometry.contentWidthPx}px`);
    this.writePrintStyle();
  }

  /**
   * The single writer of the plugin's print stylesheet. Splitting this into two
   * assignments silently drops the `orphans`/`widows` declaration, because the
   * second write replaces the whole `textContent`.
   */
  writePrintStyle() {
    if (!this.style) return;
    this.style.textContent = [
      composePdfStyle({
        viewWidth: this.geometry?.contentWidthPx ?? 0,
        orphanLines: orphanLinesFor(this.settings),
        owned: true,
        safeModal: true,
        pageMargins: this.geometry?.mirrorMargins ? this.geometry.marginsIn : null
      }),
      buildLightThemePatch(this.documentRef)
    ].filter(Boolean).join("\n");
  }

  async renderContent() {
    const text = await this.app.vault.cachedRead(this.file);
    this.sourceText = text;
    await MarkdownRenderer.render(this.app, text, this.stage, this.file.path, this.component);
    // Some versions resolve the render promise before postprocessors settle.
    // When the note references images but none exist yet, run the documented
    // postprocess pass once instead of exporting empty blocks.
    if (expectsMedia(text) && !this.stage.querySelector(".image-embed, .internal-embed, img")) {
      await MarkdownRenderer.postProcess(this.app, this.stage, this.file.path, this.component);
    }
    const frontmatter = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? null;
    applyCssClasses(this.stage, frontmatter);
    wrapTopLevelBlocks(this.stage);
    trimTrailingEmptyBlocks(this.stage);
    this.titleBlock = this.createTitleBlock();
    this.setIncludeTitle(this.settings?.pdfExport?.includeTitle === true);
  }

  createTitleBlock() {
    const wrapper = this.documentRef.createElement("div");
    wrapper.className = "ag-pdf-block";
    const title = this.documentRef.createElement("h1");
    title.className = "ag-pdf-title";
    title.textContent = this.file?.basename ?? "";
    wrapper.appendChild(title);
    return wrapper;
  }

  decorate() {
    const frontmatter = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? null;
    const profileId = resolveRoute(frontmatter, this.settings.routes);
    const profile = this.settings.profiles?.find((item) => item.id === profileId)
      ?? this.settings.profiles?.find((item) => item.id === "auto");
    // Measure the real content box. Theme rules can still contribute padding
    // or a scrollbar, and using the nominal paper width then overflows rows.
    const contentWidth = Math.max(1, this.stage.clientWidth || this.geometry.contentWidthPx);
    this.renderCleanup = renderAutoGallery(this.stage, {
      ...this.settings,
      profile,
      sourceText: this.sourceText,
      layoutWidth: contentWidth,
      // Paper, not a phone: decide floating by the room left beside the
      // picture and keep the reading view's breakpoint out of the export.
      printLayout: true,
      floatIndexRoot: this.stage
    });
  }

  async waitForReady() {
    const images = [...this.stage.querySelectorAll("img")];
    await Promise.all(images.map((image) => waitForImage(image)));
    try {
      // A pending font load must not block the export forever.
      await Promise.race([
        this.documentRef.fonts?.ready ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]);
    } catch {
      /* Font loading is best effort. */
    }
    await nextFrame(this.documentRef);
    await nextFrame(this.documentRef);
  }
}

export function resolvePdfRuntime() {
  if (runtime) return runtime;
  const requireFn = globalThis.require ?? globalThis.window?.require;
  if (typeof requireFn !== "function") return null;
  try {
    const electron = requireFn("electron");
    const ipcRenderer = electron?.ipcRenderer ?? globalThis.window?.electron?.ipcRenderer;
    const remote = electron?.remote ?? safeRequire(requireFn, "@electron/remote");
    // `remote` left the default Electron build a long time ago; Obsidian keeps
    // a copy behind its own preload in some releases only.
    const dialog = remote?.dialog ?? electron?.dialog ?? globalThis.window?.electron?.remote?.dialog;
    const fs = requireFn("fs");
    const path = requireFn("path");
    const os = safeRequire(requireFn, "os");
    const shell = remote?.shell ?? electron?.shell ?? globalThis.window?.electron?.remote?.shell;
    if (!ipcRenderer || !dialog?.showSaveDialog || !fs?.promises || !path?.join) return null;
    runtime = { ipcRenderer, dialog, fs, path, os, shell };
  } catch {
    return null;
  }
  return runtime;
}

export function isPdfRuntimeAvailable() {
  return Platform.isDesktopApp === true && Boolean(resolvePdfRuntime());
}

/** Serialises every `print-to-pdf` round trip in this window. */
export function withPrintLock(task) {
  const run = printQueue.then(() => task());
  printQueue = run.catch(() => {});
  return run;
}

export async function fallbackToNative(app, error) {
  console.error("[AutoGallery] PDF export failed", error);
  new Notice(t("AutoGallery 导出失败：{error}，已回退到 Obsidian 原生导出。", { error: error?.message ?? error }));
  try {
    app?.commands?.executeCommandById("workspace:export-pdf");
  } catch (fallbackError) {
    console.error("[AutoGallery] native PDF fallback failed", fallbackError);
    new Notice(t("原生导出也不可用，请检查 Obsidian 版本。"));
  }
}

function safeRequire(requireFn, id) {
  try { return requireFn(id); } catch { return null; }
}

function printToPdf(electron, geometry, target, settings) {
  const options = { ...toPrintOptions(geometry), filepath: target };
  const timeoutMs = Math.max(5000, Number(settings?.pdfExport?.timeoutMs) || 60000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      electron.ipcRenderer.removeListener("print-to-pdf", onReply);
      if (error) reject(error); else resolve();
    };
    const onReply = () => finish(null);
    const timer = setTimeout(() => finish(new Error(t("打印超时"))), timeoutMs);
    electron.ipcRenderer.once("print-to-pdf", onReply);
    try {
      electron.ipcRenderer.send("print-to-pdf", options);
    } catch (error) {
      finish(error);
    }
  });
}

async function verifyOutput(fs, target) {
  // The main-process handler replies unconditionally, so the file itself is
  // the only trustworthy success signal.
  const stat = await fs.promises.stat(target);
  if (!(stat.size > 1024)) throw new Error(t("生成的 PDF 为空"));
  const handle = await fs.promises.open(target, "r");
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    if (header.toString("latin1") !== "%PDF") throw new Error(t("生成的文件不是 PDF"));
  } finally {
    await handle.close();
  }
}

function wrapTopLevelBlocks(stage) {
  const documentRef = stage.ownerDocument;
  for (const node of [...stage.children]) {
    if (node.nodeType !== 1 || node.tagName === "HR") continue;
    if (node.classList?.contains("ag-pdf-block")) continue;
    const wrapper = documentRef.createElement("div");
    wrapper.className = "ag-pdf-block";
    stage.insertBefore(wrapper, node);
    wrapper.appendChild(node);
  }
}

/**
 * Markdown rendering can leave an empty block after the final newline. Its line
 * box plus paragraph margin is enough to spill onto a blank last page.
 */
function trimTrailingEmptyBlocks(stage) {
  let node = stage.lastElementChild;
  while (node) {
    const hasMedia = node.querySelector?.("img, table, pre, blockquote, .internal-embed, .image-embed, .math-block, mjx-container");
    if (node.textContent.trim() || hasMedia) return;
    const previous = node.previousElementSibling;
    node.remove();
    node = previous;
  }
}

function applyCssClasses(stage, frontmatter) {
  const classes = frontmatter?.cssclasses;
  const list = Array.isArray(classes) ? classes : typeof classes === "string" ? classes.split(/\s+/) : [];
  for (const name of list) {
    if (name && !stage.classList.contains(name)) stage.classList.add(name);
  }
}

function expectsMedia(text) {
  return /!\[\[/.test(text) || /!\[[^\]]*\]\(/.test(text);
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) {
    if (!image.decode) return Promise.resolve();
    // `decode()` can stay pending forever for an off-screen detached image.
    return Promise.race([
      image.decode().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
  }
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
    const timer = setTimeout(finish, IMAGE_WAIT_MS);
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  });
}

function nextFrame(documentRef) {
  const view = documentRef?.defaultView;
  if (!view?.requestAnimationFrame) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    view.requestAnimationFrame(finish);
    // An occluded or minimized Electron window throttles rAF indefinitely.
    // The export must still proceed; a timer is a sufficient layout barrier.
    setTimeout(finish, 120);
  });
}
