/**
 * Every print rule is composed in one place. The previous implementation wrote
 * the style element twice with different fragments, and the second write
 * silently dropped the orphans/widows declaration while it was measuring.
 */

const OWNED_ROOT_CSS = `
@media screen {
  body > .print[data-ag-pdf-owner="plugin"] {
    position: fixed !important;
    left: -100000px !important;
    top: 0 !important;
    display: block !important;
    visibility: hidden !important;
    pointer-events: none !important;
    margin: 0 !important;
    padding: 0 !important;
    width: var(--ag-print-width, 700px) !important;
    max-width: var(--ag-print-width, 700px) !important;
    height: auto !important;
    overflow: visible !important;
  }
}
@media print {
  body > .print[data-ag-pdf-owner="plugin"] {
    position: static !important;
    left: auto !important;
    top: auto !important;
    visibility: visible !important;
    width: auto !important;
    max-width: none !important;
  }
}`;

export const PRINT_BASE_CSS = `
.print .markdown-preview-view {
  height: auto !important;
  overflow: visible !important;
  /* Print margins come from printToPDF. Keeping the theme's file padding as
     well would add an unconfigured second margin and shrink the content box
     below the width the gallery layout was computed for. */
  padding: 0 !important;
  margin: 0 !important;
}
/* The first block's top margin collapses through the view and shifts the whole
   document down, which desynchronises page 1 from the pagination model. The
   last block's bottom margin does the same at the tail. */
.print > .markdown-preview-view > :first-child,
.print > .markdown-preview-view > :first-child > :first-child { margin-top: 0 !important; }
.print > .markdown-preview-view > :last-child,
.print > .markdown-preview-view > :last-child > :last-child { margin-bottom: 0 !important; }
.print [data-ag-layout="center"]:not([data-ag-mixed="true"]) { break-inside: avoid-page !important; page-break-inside: avoid !important; }
.print [data-ag-layout="gallery"] { break-inside: auto; }
/* A picture is never cut in half at a page edge. A float that does not fit
   moves to the next page whole; the prose beside it either follows (ordered,
   inside a zone) or keeps filling this page (share), but the picture itself
   stays rectangular. */
.print [data-ag-layout="float"] { break-inside: avoid-page !important; page-break-inside: avoid !important; }
/* A float plus the prose that wraps beside it. "flow-root" makes the zone the
   block that owns the float, so its box height is the height the picture
   actually occupies — the pagination model can finally see it — and a later
   sibling can no longer lay its lines into the band this zone used. The
   avoid-page rule only applies once the zone is known to fit a page; a zone
   taller than the page must keep splitting at line boundaries. */
.print .ag-float-zone[data-ag-float-zone-atomic="true"] {
  display: flow-root;
  break-inside: avoid-page !important;
  page-break-inside: avoid !important;
}
.print .ag-pdf-row { break-inside: avoid-page !important; page-break-inside: avoid !important; }
.print .ag-caption { break-inside: avoid-page !important; page-break-inside: avoid !important; }
.print [data-ag-pdf-break-before="true"] { break-before: page !important; page-break-before: always !important; }
.print [data-ag-pdf-heading-block="true"] { break-after: avoid-page !important; page-break-after: avoid !important; }
.print [data-ag-pdf-heading-following="true"] { break-before: avoid-page !important; page-break-before: avoid !important; }
.print [data-ag-pdf-heading-member="true"] { break-inside: avoid-page !important; }
.print tr { break-inside: avoid-page; }
@media print {
  /* Chromium paints the root element's background across the whole printable
     area. The app's root carries the theme colour, so printing from a dark
     theme put a dark rectangle behind every page — the reading pane looked
     right, the PDF did not. The canvas of a document is white paper. */
  html, body { background: #ffffff !important; }
  body { margin: 0 !important; padding: 0 !important; }
  body > .print { margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #ffffff !important; }
}`;

export function orphanLinesFor(settings) {
  return settings?.pdfPagination?.orphanControlEnabled === false ? 2 : 1;
}

export function printWidthStyle(viewWidth) {
  const width = `${viewWidth}px`;
  // A bare `.print > section` tree has no view element. Constrain both shapes;
  // otherwise the layout is measured at paper width but rendered at viewport
  // width and every gallery row overflows.
  return `.print > .markdown-preview-view, .print > section { width: ${width} !important; max-width: ${width} !important; box-sizing: border-box !important; }`;
}

export function composePdfStyle({ viewWidth = 0, orphanLines = 1, owned = false, safeModal = false, pageMargins = null } = {}) {
  const parts = [PRINT_BASE_CSS];
  if (Number(viewWidth) > 0) parts.push(printWidthStyle(viewWidth));
  // Keep this declaration in the same string as the rest of the rules. Writing
  // it once during setup and then replacing textContent during render was the
  // reason Obsidian's native widows handling kept winning.
  parts.push(`.print p, .print li { orphans: ${orphanLines}; widows: ${orphanLines}; }`);
  if (owned) parts.push(OWNED_ROOT_CSS);
  if (pageMargins) parts.push(mirrorPageStyle(pageMargins));
  // Printing is a whole-window operation. Obsidian already hides every body
  // child that is not `.print`, but the export modal is opened on purpose and
  // must never reach the page if a host release changes that rule.
  if (safeModal) parts.push("@media print { body > .modal-container { display: none !important; } }");
  return parts.join("\n");
}

/**
 * Mirrored margins: `printToPDF` takes one margin box for every page, so an
 * inner/outer pair can only be drawn by the page-margin rules. Odd (right-hand)
 * pages keep the binding edge on their left, even (left-hand) pages on their
 * right; the layout width already reserves inner + outer, so the content box is
 * identical on both and only its horizontal position moves.
 */
export function mirrorPageStyle(margins) {
  const mm = (value) => `${(Math.max(0, Number(value) || 0) * 25.4).toFixed(2)}mm`;
  const top = mm(margins.top);
  const bottom = mm(margins.bottom);
  const inner = mm(margins.inner);
  const outer = mm(margins.outer);
  return [
    `@page :right { margin: ${top} ${outer} ${bottom} ${inner}; }`,
    `@page :left { margin: ${top} ${inner} ${bottom} ${outer}; }`
  ].join("\n");
}
