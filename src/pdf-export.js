import { Notice } from "obsidian";
import { t } from "./i18n.js";
import { invalidateLightThemeCache } from "./print-theme.js";
import { PdfPrintSession, fallbackToNative, isPdfRuntimeAvailable } from "./pdf-session.js";
import { PdfExportModal } from "./pdf-export-modal.js";

/**
 * Export entry point. The old pipeline picked a save path first and rendered
 * afterwards, which left the reader with no way to check the page geometry
 * before committing to a file. The modal now owns both: it renders into the
 * plugin's real print tree, lets the reader adjust paper/margins/scale against
 * a live preview, and only asks for a destination when the reader exports.
 */
export function createPdfExporter({ app, getSettings, savePrefs, onClosed } = {}) {
  let current = null;

  return { isAvailable, exportFile, dispose };

  function isAvailable() {
    return isPdfRuntimeAvailable();
  }

  async function exportFile(file) {
    if (!file || file.extension !== "md") return { ok: false, reason: "unsupported" };
    if (!isAvailable()) {
      new Notice(t("当前环境不支持 PDF 导出，需要桌面版 Obsidian。"));
      return { ok: false, reason: "unsupported" };
    }
    // Two export trees in one window would each be a `body > .print`, and the
    // print IPC channel is shared, so the first reply would settle both.
    if (current) {
      new Notice(t("已有 PDF 导出窗口打开。"));
      return { ok: false, reason: "busy" };
    }
    const documentRef = app?.workspace?.containerEl?.ownerDocument ?? globalThis.document;
    // A pagination run keeps an off-screen clone of the tree on `body`. It is
    // removed with the run, but an interrupted one (a reload, a thrown error)
    // can leave it behind; counting it as "an export in progress" would then
    // block every later export until the window is restarted.
    if (documentRef.body?.querySelector(":scope > .print:not([data-ag-pdf-measure-sandbox])")) {
      new Notice(t("上一次导出尚未结束，请稍后再试。"));
      return { ok: false, reason: "busy" };
    }

    const session = new PdfPrintSession({
      app,
      getSettings,
      file,
      native: app?.vault?.getConfig?.("pdfExportSettings") ?? {}
    });
    const modal = new PdfExportModal(app, {
      file,
      session,
      persist: (prefs) => savePrefs?.(prefs),
      onClosed: () => {
        if (current?.modal === modal) current = null;
        onClosed?.();
      }
    });
    current = { session, modal };
    modal.open();

    try {
      const ready = await modal.prepared;
      // `false` means the reader closed the dialog while it was still
      // rendering; that is a cancellation, not an error.
      if (ready === false || modal.closed) return { ok: false, reason: "cancelled" };
    } catch (error) {
      // The modal cannot show a preview, so it is useless to the reader; fall
      // back the way the previous implementation did.
      current = null;
      modal.close();
      session.destroy();
      await fallbackToNative(app, error);
      return { ok: false, reason: "failed", error };
    }
    return { ok: true, pending: true };
  }

  function dispose() {
    invalidateLightThemeCache();
  }
}
