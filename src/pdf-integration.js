import { renderAutoGallery, resetFloatIndices } from "./renderer.js";
import { resolveRoute } from "./routes.js";
import { optimizePdfPagination } from "./pdf-pagination.js";
import { resolvePrintGeometry } from "./print-geometry.js";
import { composePdfStyle, orphanLinesFor } from "./pdf-style.js";

/**
 * Observe Obsidian's temporary .print tree and reuse the reading renderer in
 * that tree. The public API has no PDF lifecycle hook, so this deliberately
 * confines the integration to the private print DOM contract.
 *
 * This is the fallback path for Obsidian's own exporter. The hidden popup it
 * prints from has no viewport, so geometry-driven pagination cannot run here;
 * the plugin's own export command renders into the main window instead and
 * leaves the tree marked with data-ag-pdf-owner="plugin" for this module to
 * ignore.
 */
export function createPdfExportIntegration({ app, getSettings, document: documentRef = globalThis.document } = {}) {
  const body = documentRef?.body;
  const windowRef = documentRef?.defaultView ?? globalThis.window;
  const MutationObserverClass = documentRef?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (!body || typeof MutationObserverClass !== "function") return { refresh() {}, dispose() {} };

  const states = new Map();
  const documentObservers = new Map();
  let disposed = false;
  const originalOpen = typeof windowRef?.open === "function" ? windowRef.open : null;
  let wrappedOpen = null;

  // Obsidian's built-in exporter renders into a hidden about:blank window,
  // then calls that window's webContents.printToPDF(). Its .print tree is
  // therefore outside the main document observed below. Capture every popup
  // opened while the plugin is alive so the real export DOM is covered too.
  if (originalOpen) {
    wrappedOpen = function (...args) {
      const popup = originalOpen.apply(this, args);
      watchWindow(popup);
      return popup;
    };
    try { windowRef.open = wrappedOpen; } catch { wrappedOpen = null; }
  }

  watchDocument(documentRef);

  const refresh = () => {
    if (disposed) return;
    for (const document of documentObservers.keys()) {
      if (!isEnabled()) {
        for (const root of [...states.keys()]) {
          if (root.ownerDocument === document) disposeRoot(root);
        }
        continue;
      }
      for (const root of document.body?.querySelectorAll?.(".print") ?? []) {
        if (!isOwnedRoot(root)) ensureRoot(root);
      }
    }
    for (const root of states.keys()) {
      if (root.isConnected) ensureRoot(root);
      else scheduleRemoval(root);
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const { observer, document, beforePrint, afterPrint } of documentObservers.values()) {
      observer.disconnect();
      document.removeEventListener?.("beforeprint", beforePrint);
      document.removeEventListener?.("afterprint", afterPrint);
    }
    documentObservers.clear();
    if (wrappedOpen && windowRef?.open === wrappedOpen) {
      try { windowRef.open = originalOpen; } catch { /* read-only host */ }
    }
    for (const root of states.keys()) disposeRoot(root);
    states.clear();
  };

  return { refresh, dispose, processPostProcessor };

  function processPostProcessor(element) {
    if (disposed || !isEnabled() || !element) return;
    const root = findPrintRoot(element);
    if (!root || isOwnedRoot(root) || root.dataset?.agPdfMeasureSandbox === "true") return;
    // The print renderer owns this document. Registering its observer here is
    // essential because it is usually a hidden popup document, not the main
    // Obsidian document passed to this module at startup.
    watchDocument(root.ownerDocument);
    ensureRoot(root, true);
    queueRender(root, states.get(root), 0);
  }

  function watchWindow(popup) {
    if (disposed || !popup) return;
    let popupDocument;
    try { popupDocument = popup.document; } catch { return; }
    if (popupDocument?.body) watchDocument(popupDocument);
    // Electron may expose the WindowProxy before its document is available.
    // Retry briefly so the exporter popup is still observed in that case.
    if (!popupDocument?.body) {
      let attempts = 0;
      const retry = () => {
        if (disposed || attempts++ >= 20) return;
        try {
          const document = popup.document;
          if (document) return watchDocument(document);
        } catch { return; }
        setTimeout(retry, 25);
      };
      setTimeout(retry, 0);
    }
  }

  function watchDocument(document) {
    if (!document?.body || documentObservers.has(document)) return;
    const Observer = document.defaultView?.MutationObserver ?? MutationObserverClass;
    if (typeof Observer !== "function") return;
    const observer = new Observer((mutations) => handleMutations(mutations));
    observer.observe(document.body, { childList: true, subtree: true });
    const beforePrint = () => {
      if (!isEnabled()) return;
      for (const root of document.body?.querySelectorAll?.(".print") ?? []) {
        if (!isOwnedRoot(root)) ensureRoot(root);
      }
      for (const root of states.keys()) {
        if (root.ownerDocument === document && !root.isConnected) ensureRoot(root);
      }
    };
    const afterPrint = () => {
      for (const root of states.keys()) {
        if (root.ownerDocument === document && !root.isConnected) disposeRoot(root);
      }
    };
    document.addEventListener?.("beforeprint", beforePrint);
    document.addEventListener?.("afterprint", afterPrint);
    documentObservers.set(document, { observer, document, beforePrint, afterPrint });
    for (const root of document.body.querySelectorAll?.(".print") ?? []) {
      if (!isOwnedRoot(root)) ensureRoot(root);
    }
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        const root = findPrintRoot(node);
        if (!root) {
          if (node.nodeType === 1 && node.querySelector?.(".print")) {
            for (const printRoot of node.querySelectorAll(".print")) ensureRoot(printRoot);
          }
          continue;
        }
        if (node.nodeType === 1 && node.matches?.(".print")) ensureRoot(root);
        else if (isContentMutation(node)) queueRender(root, states.get(root));
      }
      for (const node of mutation.removedNodes) {
        const root = findPrintRoot(node) ?? (node.nodeType === 1 && node.matches?.(".print") ? node : null);
        if (root) scheduleRemoval(root);
      }
    }
    for (const root of states.keys()) {
      if (root.isConnected && isEnabled()) observeImages(root);
    }
  }

  function isEnabled() {
    return getSettings?.()?.pdfExportEnabled === true;
  }

  function ensureRoot(root, defer = false) {
    if (disposed || !root || isOwnedRoot(root) || root.dataset?.agPdfMeasureSandbox === "true" || !isEnabled()) return;
    let state = states.get(root);
    if (!state) {
      state = { cleanup: null, style: null, timer: null, removalTimer: null, sourcePath: null, sourceText: null, sourceLoading: false, sourceToken: 0, rendering: false, images: new Set() };
      states.set(root, state);
    }
    if (state.removalTimer !== null) {
      clearTimeout(state.removalTimer);
      state.removalTimer = null;
    }
    if (!state.style) {
      state.style = root.ownerDocument.createElement("style");
      state.style.dataset.agPdfStyle = "true";
      state.style.textContent = composePdfStyle({ orphanLines: orphanLinesFor(getSettings?.()) });
      root.appendChild(state.style);
    }
    if (!defer) renderRoot(root, state);
  }

  function renderRoot(root, state) {
    if (state.rendering || !root || isOwnedRoot(root) || !isEnabled()) return;
    state.rendering = true;
    const documentState = documentObservers.get(root.ownerDocument);
    documentState?.observer?.disconnect();
    try {
      state.cleanup?.();
      state.cleanup = null;
      const file = resolveSourceFile(root);
      const filePath = file?.path ?? "";
      if (state.sourcePath && state.sourcePath !== filePath) {
        state.sourceToken += 1;
        state.sourceText = null;
        state.sourceLoading = false;
        state.images.clear();
        resetFloatIndices(root);
      }
      resetFloatIndices(root);
      const sections = collectSections(root);
      if (!sections.length) return;
      const settings = getSettings?.() ?? {};
      const profile = resolveProfile(file, settings);
      const layout = resolvePdfLayout(root, app, settings);
      if (state.style) {
        state.style.textContent = composePdfStyle({
          viewWidth: layout?.viewWidth,
          orphanLines: orphanLinesFor(settings)
        });
      }
      const renderCleanups = [];
      sections.forEach((section, index) => {
        renderCleanups.push(renderAutoGallery(section, {
          ...settings,
          profile,
          sourceText: state.sourceText,
          floatIndexRoot: root,
          layoutWidth: layout?.contentWidth,
          // Paper, not a phone: decide floating by the room left beside the
          // picture and keep the reading view's breakpoint out of the export.
          printLayout: true,
          resetSourceOrder: index === 0
        }));
      });
      const paginationCleanup = optimizePdfPagination(root, {
        pageWidth: layout?.viewWidth,
        pageHeight: layout?.contentHeight,
        contentTop: layout?.contentTop,
        // A print section may belong to a separate hidden BrowserWindow.
        // Clone and measure in that document so its print CSS, fonts and
        // viewport geometry are identical to the DOM being exported.
        measureDocument: root.ownerDocument ?? documentRef,
        settings,
      });
      state.cleanup = () => {
        paginationCleanup?.();
        renderCleanups.reverse().forEach((cleanup) => cleanup?.());
      };
      observeImages(root, () => queueRender(root, state));
      loadSource(file, root, state);
    } finally {
      state.rendering = false;
      documentState?.observer?.observe(root.ownerDocument.body, { childList: true, subtree: true });
    }
  }

  function queueRender(root, state) {
    if (!state || state.timer !== null || !root.isConnected) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (states.get(root) === state) renderRoot(root, state);
    }, 0);
  }

  function observeImages(root, onLoad = () => queueRender(root, states.get(root))) {
    const state = states.get(root);
    if (!state) return;
    for (const image of root.querySelectorAll("img")) {
      if (state.images.has(image)) continue;
      state.images.add(image);
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onLoad, { once: true });
    }
  }

  function loadSource(file, root, state) {
    if (!file || state.sourceLoading || state.sourceText !== null) return;
    state.sourcePath = file.path;
    state.sourceLoading = true;
    const sourceToken = state.sourceToken;
    const read = app?.vault?.cachedRead ?? app?.vault?.read;
    Promise.resolve(typeof read === "function" ? read.call(app.vault, file) : "")
      .then((text) => {
        if (states.get(root) !== state || state.sourceToken !== sourceToken) return;
        state.sourceText = String(text ?? "");
        queueRender(root, state);
      })
      .catch(() => {
        if (states.get(root) === state && state.sourceToken === sourceToken) state.sourceText = "";
      })
      .finally(() => { state.sourceLoading = false; });
  }

  function resolveSourceFile(root) {
    const candidates = [];
    for (const element of [root, root.querySelector?.(".markdown-preview-view")]) {
      if (!element) continue;
      for (const name of ["data-source-path", "data-path", "data-file", "id"]) {
        const value = element.getAttribute?.(name);
        if (value) candidates.push(value);
      }
    }
    for (const path of candidates) {
      const file = app?.vault?.getAbstractFileByPath?.(path);
      if (file && !file.children) return file;
    }
    return app?.workspace?.getActiveFile?.() ?? null;
  }

  function resolveProfile(file, settings) {
    const frontmatter = file ? app?.metadataCache?.getFileCache?.(file)?.frontmatter : null;
    const id = resolveRoute(frontmatter, settings.routes);
    return settings.profiles?.find((profile) => profile.id === id)
      ?? settings.profiles?.find((profile) => profile.id === "auto");
  }

  function scheduleRemoval(root) {
    const state = states.get(root);
    if (!state || state.removalTimer !== null) return;
    state.removalTimer = setTimeout(() => {
      state.removalTimer = null;
      if (!root.isConnected) disposeRoot(root);
    }, 60000);
  }

  function disposeRoot(root) {
    const state = states.get(root);
    if (!state) return;
    clearTimeout(state.timer);
    clearTimeout(state.removalTimer);
    state.cleanup?.();
    state.style?.remove();
    resetFloatIndices(root);
    states.delete(root);
  }
}

export function collectSections(root) {
  const sections = [...root.querySelectorAll?.(".markdown-preview-section") ?? []]
    .filter((section) => !section.parentElement?.closest(".markdown-preview-section"));
  if (sections.length) return sections;
  const view = root.querySelector?.(".markdown-preview-view");
  return view ? [view] : [];
}

/**
 * Obsidian builds the PDF in a popup whose screen viewport is usually wider
 * than the selected paper. Chromium applies the paper width and print margins
 * only during printToPDF, so using clientWidth here makes gallery rows too
 * wide and lets their last cell wrap in the PDF. Resolve the same CSS pixel
 * width ahead of rendering and remove the preview view's own horizontal
 * padding before handing it to the layout algorithms.
 */
export function resolvePdfLayout(root, app, settings = {}) {
  // Obsidian has used both `.markdown-preview-view > section` and a bare
  // `.print > section` tree for its hidden exporter. Pagination must still
  // receive the paper geometry when the view class is omitted.
  const view = root?.querySelector?.(".markdown-preview-view")
    ?? root?.querySelector?.(".markdown-preview-section")
    ?? root;
  if (!view) return null;
  const native = settings.pdfExportSettings
    ?? app?.vault?.getConfig?.("pdfExportSettings")
    ?? {};
  const geometry = resolvePrintGeometry(settings, native, { pageNumbers: false });
  const style = view.ownerDocument?.defaultView?.getComputedStyle?.(view);
  const padding = (parseCssPixels(style?.paddingLeft) || 0) + (parseCssPixels(style?.paddingRight) || 0);
  const verticalPadding = (parseCssPixels(style?.paddingTop) || 0) + (parseCssPixels(style?.paddingBottom) || 0);
  const pageHeight = geometry.contentHeightPx;
  return {
    viewWidth: geometry.contentWidthPx,
    contentWidth: Math.max(1, geometry.contentWidthPx - padding),
    contentHeight: Math.max(1, pageHeight - verticalPadding),
    contentTop: view.getBoundingClientRect?.().top + (parseCssPixels(style?.paddingTop) || 0) || 0
  };
}


function parseCssPixels(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

/** The plugin's own exporter builds a main-window print tree. This observer
 * must never decorate or paginate it a second time. */
function isOwnedRoot(root) {
  return root?.dataset?.agPdfOwner === "plugin";
}

function findPrintRoot(node) {
  if (!node || node.nodeType !== 1) return null;
  if (node.matches?.(".print")) return node;
  return node.closest?.(".print") ?? null;
}

function isContentMutation(node) {
  if (node.nodeType !== 1) return false;
  if (node.matches?.("style, .ag-caption, [data-ag-generated='true']")) return false;
  return Boolean(node.matches?.("img, .image-embed, .internal-embed, .markdown-preview-section, .markdown-preview-view, p, div, figure, table, pre")
    || node.querySelector?.("img, .image-embed, .internal-embed, .markdown-preview-section"));
}
