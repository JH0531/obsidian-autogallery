import { updateImageAnnotation } from "./annotations.js";

/**
 * Every layout annotation the plugin can write. Clearing them returns the
 * image to automatic routing while keeping the caption and the link intact.
 */
export const IMAGE_LAYOUT_RESET = Object.freeze({
  layout: null,
  side: null,
  width: null,
  gap: null,
  crop: null,
  // A hand-written row split describes which pictures share a row, and the
  // reset is about to change the ratios that split was written for. Clearing
  // the layout without it would leave a grid that no longer matches anything.
  rows: null,
  group: null,
  // Restoring the default layout also puts the image back under automatic
  // routing: a released (excluded) image would otherwise ignore the reset,
  // and an isolated one would stay outside its gallery.
  isolate: null,
  exclude: null
});

export function resetImageLayout(line) {
  return updateImageAnnotation(line, IMAGE_LAYOUT_RESET);
}

/**
 * Reset every image line in the active document as one undoable transaction.
 * Returns the number of changed lines.
 */
export function resetDocumentImageLayout(editor) {
  const changes = [];
  // Use the editor's own line model: manual offsets drift when the file uses
  // CRLF or the view normalises line endings differently from getValue().
  for (let index = 0; index < editor.lineCount(); index += 1) {
    const line = editor.getLine(index);
    if (!line.includes("![") || !line.includes("]")) continue;
    const updated = resetImageLayout(line);
    if (!updated || updated === line) continue;
    changes.push({
      from: { line: index, ch: 0 },
      to: { line: index, ch: line.length },
      text: updated
    });
  }
  if (!changes.length) return 0;
  editor.transaction({ changes });
  return changes.length;
}
