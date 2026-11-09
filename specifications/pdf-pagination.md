# PDF Pagination Model

The step table that converts screen Y into a paginated flow, forced and natural
page breaks, orphan repair and single-image compression.

Read this before changing `src/pdf-pagination.js` or the compression rules that
run during export.

- The screen layout is one continuous column; forced and natural page breaks
  push everything below them. `pdf-pagination.js` builds a step table of
  cumulative shifts and converts screen Y to a paginated flow before computing
  page numbers, overflow, or heading position. Do not reintroduce a bare
  `modulo(top - contentTop, pageHeight)` page index.
- Invalidate the table after writing `data-ag-pdf-break-before`, after every
  geometry flush, and after wrapping gallery rows.
- Gallery rows are wrapped in `.ag-pdf-row` with `break-inside: avoid-page`.
  Unwrap them in reverse order and before the reading renderer's cleanup runs.
  A row never splits. As a fit target it may shrink as one unit: every picture
  inside its cell shrinks by the same factor while the column slots and widths
  stay fixed. A row is never used as a donor for another fit, and orphan repair
  never compresses one.
- Orphan repair targets the last page (up to `orphanMaxLines`) and any middle
  page whose head is a single line, but must skip a page opened by a deliberate
  heading break.
- Image compression must fit a single target exactly: measure the space left on
  the previous page with the shift of the units **before** it (`shiftBefore`),
  never with `shiftAt`, whose entry already contains the target's own natural
  break. Shrink the target itself first and only fall back to preceding images
  or line height when its cap is exhausted. Do not shrink every image on the
  page by the same step.
- The target must land with `0 <= residual < one text line`. A larger residual
  means the following prose would rejoin the page, which is the reported defect.
- A paragraph that mixes an image and prose is marked `data-ag-mixed="true"`,
  excluded from `break-inside: avoid`, and split so the trailing prose becomes a
  sibling block. Without that split Chromium cannot break after the image and
  pushes the whole paragraph to the next page. The split prose block must not
  carry `data-ag-generated`, because the pagination flow model skips generated
  nodes. The reading view performs the same split; its blocks are registered
  with `renderer.sections` (see the reading-view rules above).
- Compression is atomic: record `state.changes.length`, and on any failure call
  `rollbackTo` **and** `flush` so the break table matches the restored geometry.

- `buildShrinkPlan` measures a gallery row as the sum of its cells, not as its
  first cell. A row narrower than the column (a capped row, or one whose first
  cell is simply small) otherwise reports a tiny width, and
  `1 - minWidth / plan.width` collapses the whole shrink budget to zero, so the
  row is never compressed and the page pass abandons it.
- The row height comes from the measured unit when available. The previous
  "parent element height" fallback reports the section container for a capped
  row, which makes the linear "shrink removes `s * height`" model wrong.

- A float is out of flow: the next unit starts at the float's own top, so the
  "distance to the next unit" height is zero and the break table never records
  that the picture was pushed to the next page. When that height is zero, use
  the picture's own extent (`floatedExtent`). The prose that wraps beside it
  keeps the ordinary treatment: a paragraph splits at a line boundary.
- A picture is never cut in half at a page edge. `[data-ag-layout="float"]`
  carries `break-inside: avoid-page`; a float that does not fit moves whole.
- `floatSpaceMode: "ordered"` binds each float to the prose beside it in an
  `.ag-float-zone`. This is the prose half of the float rules only: the picture
  sequence is placed by the renderer from `floatBreaks.image` and is identical
  in both modes. Build the wrapper after `protectGalleryRows` and before
  `createMeasureSandbox`: the clone maps nodes by document order, and inserting
  a wrapper afterwards silently points every geometry lookup at the wrong node.
  Unwrap zones before rows, and only after the style/attribute restore.
- Containment is decided from geometry, never from the DOM alone. A zone is
  marked atomic only when the prose ends inside the picture's height and the
  picture fits one page; then it gets `flow-root` (so its box owns the float)
  and `avoid-page`. Otherwise it keeps no `flow-root` and the trailing prose
  continues on the next page — a long paragraph must never drag the whole
  column onto a new page just because a picture started it.
- The fit anchor is always the picture's bottom (`floatBottom`), never the band
  the wrapped prose occupies. Prose that runs past the picture may continue on
  the next page; that is the natural result and matches how prose already
  splits. `isAtomicFlowUnit` must read the zone marker explicitly — the generic
  "clone and look for text" rule classifies every zone as breakable.
- Compression is budgeted per fit event: one overflowing page, one budget. The
  affected set is the target plus the pictures this event pushes; pictures on
  other pages are never touched. A fit that is still valid on a later pass (the
  page did not change) is not shrunk again.
- A rollback must restore the measurement clone as well as the printed tree.
  `rectOf` prefers the clone once it exists, so a stale shrunken width there
  poisons every page number computed afterwards.
