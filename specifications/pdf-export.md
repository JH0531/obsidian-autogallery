# PDF Export Pipeline and Dialog

The plugin's own exporter (`src/pdf-export.js`), the print tree it owns
(`src/pdf-session.js`), the export dialog (`src/pdf-export-modal.js`), print
geometry (`src/print-geometry.js`) and print styles (`src/pdf-style.js`,
`src/print-theme.js`).

Read this before changing the export pipeline, the print stylesheet or the
dialog's measurement and pagination flow.

## PDF Export Pipeline

The plugin owns a PDF exporter (`src/pdf-export.js`). Obsidian's native exporter
renders into a hidden popup whose viewport is zero until print layout, so every
geometry-driven decision degenerates there. The plugin's exporter renders the
same document into a `.print` element inside the main window instead, then
prints that window through Obsidian's private `print-to-pdf` channel.

- The print root must be a **direct child of `body`** and carry
  `data-ag-pdf-owner="plugin"`. Obsidian's core CSS hides every other body child
  under `@media print`; the owner marker is also how `pdf-integration.js` avoids
  decorating the tree a second time.
- The **page canvas is white**. Chromium paints the root element's background
  across the whole printable area, and the app's root carries
  `--background-primary` — a dark colour in a dark theme. Printing without a
  reset therefore put a dark rectangle behind every page while the layout
  preview (which paints its own white sheet) looked correct. `PRINT_BASE_CSS`
  pins `html`, `body` and the print root to `#ffffff` inside `@media print`;
  never rely on the modal's `.ag-pdf-export__sheet > .print { background }`
  rule, which no longer applies once the tree is moved to `body` for printing.
- A pagination measure clone also carries the `.print` class. The "an export is
  already running" guard must skip `[data-ag-pdf-measure-sandbox]`, or a clone
  left behind by an interrupted run blocks every later export.
- Page geometry comes from the options handed to `printToPDF`
  (`src/print-geometry.js`), never from a paper-size table. A CSS pixel is 1/96
  inch and the layout viewport is `(paper - margins) / scale`, so `scale` must be
  divided out.
- `.print .markdown-preview-view` must keep `padding: 0` and `margin: 0`.
  Otherwise the theme's file padding shrinks the content box below the width the
  gallery layout was computed for, and the last gallery cell wraps.
- The first block's top margin and the last block's bottom margin collapse
  through the view and displace the whole document. Both are zeroed so the view
  box equals the content box and `contentTop` is exact.
- Print CSS is composed once by `composePdfStyle`. Do not assign
  `style.textContent` from a second fragment; that is how the `orphans`/`widows`
  declaration was previously lost. Plugin orphan control uses `1/1`; disabling
  it keeps Chromium's `2/2`.
- `printToPDF` replies unconditionally, so the output file is the only success
  signal: check size and the `%PDF` header, and fall back to
  `workspace:export-pdf` on timeout or invalid output.
- Never replace the native `workspace:export-pdf` command id. The plugin adds its
  own command and `file-menu` entry.
- Page numbers are Chromium's, not ours: `toPrintOptions` enables
  `displayHeaderFooter` and passes a one-line template with
  `span.pageNumber`/`span.totalPages`. Do not try to draw them in the print tree
  - the document is one continuous flow with no page boxes, and anything placed
  outside the content box either starts an extra page or is dropped.
  - The frame that receives the template is **page-sized** in this Electron
    build, so the template pins itself to the matching page edge
    (`top:0`/`bottom:0`) and takes the margin's own height. `inset:0` puts the
    text 2 mm from the paper edge instead of in the margin - that mistake shipped
    once and was caught only by reading the printed coordinates.
  - The band is part of the margin, so `resolvePrintGeometry` raises that side to
    11 mm when a number is enabled; the clamp also reaches `margins` (Chromium
    sizes the band from it) and the layout preview, which then shows the reserved
    space honestly. `resolvePdfLayout` passes `pageNumbers: false` because the
    native exporter draws nothing there.
  - Templates live outside Obsidian's stylesheet: font size, family and colour
    must be inline (the host document sets `font-size: 0`). The family is copied
    from the rendered `.markdown-preview-view`, quoted with single quotes so it
    cannot terminate the double-quoted `style` attribute.

## PDF Export Dialog

`src/pdf-session.js` owns the print tree; `src/pdf-export-modal.js` owns the
dialog that shows and configures it. `src/pdf-export.js` is only an entry
point. The old pipeline picked a save path first and then rendered, so the
reader committed to a file before seeing the page geometry.

- Every measurement must run while the tree is a **direct child of `body` and
  unscaled**. The modal displays it inside a `transform: scale()` wrapper, and
  `snapFloatToLineGrid` and `optimizePdfPagination` both compare
  `getBoundingClientRect()` with computed line-height. `ensureBodyPosition()`
  removes the preview transform for exactly that reason; never move the tree
  into the dialog and then lay it out or paginate there.
- `appendChild` moves the tree, it never clones. One tree, one owner: the
  dialog mounts it, the exporter prints it, and `destroy()` takes it down.
- `composePdfStyle` stays the single writer of the print stylesheet. A second
  `textContent` assignment loses `orphans`/`widows`.
- Re-layout order is fixed: `ensureBodyPosition` → `unpaginate` → `renderCleanup`
  → `resetFloatIndices` → recompute `resolvePrintGeometry` →
  rewrite `--ag-print-width` and the stylesheet → `renderAutoGallery`. The
  renderer snapshots the styles it overwrites, so pagination must be rolled
  back *before* the cleanup or it "restores" paginated values.
- `print-to-pdf` prints the whole window through one IPC channel. Preview
  prints and export prints are serialised by `withPrintLock`; a second
  concurrent print would settle the first promise and write the same document
  twice. `document.title` becomes the PDF title, so it is only changed inside
  the lock and always restored.
- Layout passes cannot run while a page preview is rendering: emptying the
  canvas list mid-render detaches the canvas pdf.js is drawing into and the
  render task never settles. `runRelayout` defers instead of racing.
- The layout preview is deliberately not paginated. Page boundaries come from
  the on-demand page preview, which prints a temporary PDF and renders it with
  `loadPdfJs`. Drawing estimated breaks on the layout preview would be a second
  pagination model.
- pdf.js viewports are in points (1/72"), while paper geometry is in CSS
  pixels (1/96"). The render scale must carry the 96/72 factor, or every page
  image is stretched by 4/3.
- A cancelled save dialog keeps the dialog open and prints nothing: the save
  path is requested after the settings are settled, not before rendering.
- Export failure keeps the dialog open with an explicit "use Obsidian's native
  export" button. Falling back automatically would open a second save dialog
  on top of the one the reader is already looking at.
- Neither the dialog nor the crop modal may lay anything out inside a
  `ResizeObserver` callback; resize the observed box from a zero-delay timer
  instead, or Chromium logs an undelivered-notification loop on every open.
