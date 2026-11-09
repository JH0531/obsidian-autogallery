# Live Preview Rules

CodeMirror editor behaviour: gallery rows in the editing surface, the reveal
takeover while an embed is being edited, caption widgets, the embed action bar
and scroll stability.

Read this before touching `editor-extension.js`, `embed-actions.js`,
`image-metrics.js` or anything that decorates a `.cm-line`.

- A list item's pictures live on separate `.cm-line`s: the item's own line when
  it starts with an image, an indented continuation line for every further
  picture. Only the row's **first** cell stays in the flow and gives the row its
  height; the following cells carry `ag-cm-list-cell` and are moved onto the
  row's top edge by the layout pass. The mark comes from the source grouping
  (`readListImageLayout().cell`), not from the item: when an item starts with
  prose every picture is a continuation line, and keying the absolute placement
  off that made the first picture leave its item and the second one jump above
  the row.

- A cell collapses with `line-height: 0`, never with `height: 0`. A block whose
  declared height disagrees with its content makes CodeMirror rebuild the line
  on every measure - the gallery then flickers and re-runs its layout forever.
  The indentation node must stay in the flow for the same reason it must stay
  visible: hiding it makes the editor drop the line's `padding-inline-start`,
  and the row starts one indent to the left of the item text.

- The row's column must come from a **trusted** line, never from the decorated
  line's own padding. A line whose content is a decorated picture has no inline
  text left to measure, and the editor then derives `padding-inline-start` from
  the line box itself: the whole content offset of the sheet (359px in a 760px
  column) instead of the item's 23px. Reading that back as the item column laid
  the row out in a 401px strip on the far right — pictures split across the
  width, the item looking broken. `listItemIndent` only trusts list-sized
  values (up to a quarter of the line) and otherwise walks back to the nearest
  line at the same nesting depth that still has text, which is the column the
  marker hangs from. Correcting the line's own padding does not help: the
  editor rewrites it on the next measure.

- A cell with no picture (`mod-empty-attachment`, i.e. a broken link) has no
  geometry. It keeps `position: relative` and a normal line height so the
  "找不到…" notice occupies the line box; absolutely positioned it covered the
  source line as soon as that line was edited. Its caption is hidden: the file
  is gone, and the reserved caption box only pushed the notice away from its
  own line.

- A list caption publishes its width on the **embed**, because the editor
  rewrites a list line's inline style on every measure. `positionCaptionWidgets`
  therefore has to read `--ag-embed-width` from the embed when it is called
  without a cell width; falling back to `var(--ag-embed-width, 100%)` on the
  line made the caption span the whole item column and centre its text off the
  picture.

- The `ag-cm-gallery-clear` marker is written on the line after a group, so an
  image line that follows the gallery claims that line for itself and the
  marker never lands. Live Preview must therefore give any image line whose
  previous sibling is a gallery line an explicit `clear: both`; without it the
  isolated picture floats into the row above it.






- Live Preview must never let text wrap beside an image. A float gives its line
  no height, so the next line paints over the picture and runs under its action
  bar. The float branch reserves `image height + caption + bottom gap` on the
  line (gap skipped when a blank source line already separates) and keeps
  `--ag-embed-float` only so the action bar and the arrows still know which
  side is free. Real wrapping is a reading-view behaviour.













































































































- Live Preview keeps the document's own blank lines between an image and the
  next block; only blank lines *inside* a gallery are hidden
  (`ag-cm-gallery-gap`). Never hide the blank lines after a single image and
  never pad the line to fake the gap: changing a line's height during
  CodeMirror's measurement pass restarts the measure loop and shifts the
  viewport while the reader edits.

- A block (non-floated) image line whose *next source line is not blank* must
  reserve the gap itself, because a CodeMirror line ends at its caption and
  would otherwise sit flush against the following row. Reserve it with
  `padding-bottom: imageBottomGap`, never with a `height`:
  a published height froze the line box at the width the last layout pass
  measured, so dragging the corner handle resized the picture inside a box that
  never moved and the text directly below it only jumped on release. (A blank
  line or a float hid the bug — the blank line carries the spacing itself and
  the float's text wraps live.) Padding adds the same space while the line keeps
  the height its own content gives it, picture plus caption, so the flow follows
  the drag frame by frame. `imageBottomGap` of `0` follows
  `var(--p-spacing, 16px)`, matching the reading view. A blank line already
  provides the separation, so the line must not add its own. A **floated** image
  keeps the explicit `height: calc(<image height> + <caption> + gap)`: its
  picture is out of flow, so nothing else would reserve the box.

- Live Preview gallery rows must reserve `galleryGap` below themselves, added
  to the explicit row height on the first cell (or `padding-bottom` for a
  single-image row). Without it a captioned row ends exactly at the caption's
  bottom edge and a caption-less row touches the next image. Every row except
  the last one of a group reserves the gap; the last row keeps the document's
  own spacing to whatever follows the gallery. The height is computed from the
  measured image ratios, so this does not feed back into the measurement pass.

- Editing an image's Markdown is Obsidian's own reveal state: the line holds
  the source text and the embed moves into an absolutely positioned
  `.cm-image-reveal-tooltip`, with a `.cm-image-reveal-gap` sibling reserving
  the space it used to occupy. The plugin must keep controlling that state, so
  a revealed line is always published as `display:block; width:100%;
  height:auto` with no route width and no reserved height. Never let the line
  keep a gallery cell's fixed width or height: the code then wraps inside a
  narrow column and the preview jumps to the image's native size.

- `isRevealedImageLine` must treat a missing embed plus the reveal gap as the
  primary signal. Obsidian derives that gap from the line's previous height, so
  a zero-height gallery cell (every cell after the first in a row) gets none;
  the source spans the line still renders are the fallback, confirmed by the
  presence of `.cm-image-reveal-tooltip` or by the line being `.cm-active`. A
  line whose widget has simply not been rendered yet renders no source spans
  either, so it can never be mistaken for a reveal.

- The source markup differs per image syntax: `![alt](path)` leaves
  `.cm-formatting-image` / `.cm-image`, while `![[name]]` leaves
  `.cm-formatting-embed` / `.cm-hmd-embed` / `.cm-formatting-link`. Match the
  whole family (`REVEALED_SOURCE_SELECTOR`), never one syntax's class: keying
  on `.cm-formatting-image` alone made the takeover work for a Markdown gallery
  and silently do nothing for a wiki-embed one, which then kept the cell's fixed
  width — the source line wrapped inside the image column and the preview was
  never anchored.

- A revealed gallery cell spans the column above its row, and the rest of the
  row moves down as one unit. CodeMirror builds its height map by stacking line
  heights in *document* order, so the code line cannot simply be given a
  smaller top offset than the cells that precede it: the map would place it
  below them and `posAtCoords` would send every click to the previous line.
  Publish the row instead as: the code line is a full-width block whose
  `padding-bottom` equals the row's own height, and every other cell keeps
  `height: 0` and is moved into its slot with
  `transform: translateY(<shiftY>px)` (cells before the edited one shift down by
  the code height, cells after it shift up by the row height because they are
  laid out below the code line's reserved box). The horizontal slot is the
  `margin-left` the cell already carries; it is not part of the shift.

- The `margin-top` that puts the code line on its row's top edge is
  `rowTop - flowOffset`, because floats never advance the block flow while a
  single-image row (a block) does.

- The height of a revealed line is only final after its block style is applied,
  so the first measurement can differ (a floated neighbour shortens its line
  boxes, and Obsidian's `pre-wrap` wraps the Markdown differently). Measure with
  `clear: both` and `white-space: normal`, and read the code height as the box
  height minus the reserved `padding-bottom`.

- The correction that follows that first measurement must compare like with
  like: the settled height is `rect.height - padding-bottom`, because the line
  box deliberately includes the padding that reserves the rest of the row.
  Comparing the whole box against `codeHeight` reports the row height as a
  mismatch on every pass and restarts the layout forever. Skip reveals without
  a `codeHeight` (a single-image reveal reserves nothing).

- Run the correction inside the same task as the pass that published the row,
  and only when that pass actually dispatched a change. A correction scheduled
  for the next frame lets the browser paint the intermediate row and then move
  it again, which reads as an up/down shake. A pass that published nothing can
  never need correction, which is what terminates the loop.

- The scroll anchor must be restored in the task that dispatched the
  decorations. Deferring it to `requestAnimationFrame` paints the shifted
  geometry first and then scrolls it back, which is the second half of the same
  shake.

- Revealing an embed is a selection change, so `update()` never sees it and
  `needsImmediateLayout()` skips a line that already carries a style. The
  MutationObserver must therefore own the takeover: watch the reveal signature
  (the set of revealed line positions) plus insertions of
  `.cm-image-reveal-tooltip` / `.cm-image-reveal-gap`, and run a full pass
  synchronously in the callback. Observer callbacks run before paint, so the
  first frame already shows the block layout and the constrained preview.
  Refresh the stored signature at the entry of every pass so early returns
  cannot leave it stale, and keep the mutation-pause check before the signature
  comparison.

- Scrolling must not run a full layout pass. While an embed is being edited only
  the preview anchor changes; lines that scroll into view are laid out through
  `viewportChanged`. A pass per scroll frame re-measures every image and makes
  the editor feel heavy.

- A revealed row's reserved height depends on the content width, and the
  document height decides whether the scrollbar exists, which changes that
  width. Lock the width a correction pass was started with and only accept a
  measured difference larger than a scrollbar (8px).

- The reveal preview is anchored against the editor box. The horizontal anchor
  is the line's own left edge plus the offset the plugin gave the image
  (`offsetX` for a gallery cell, `align` for a single image), never Obsidian's
  reveal gap: that gap is sized and positioned by the editor, so anchoring to
  it makes the preview follow a box the plugin does not own. The horizontal
  offset is already part of the anchor; never add `align` a second time when
  writing `left`. For a gallery cell the vertical anchor is the code line's top
  plus the code height at the cell's column offset, because the code line's box
  also covers the row below it.

- The preview geometry must be published as custom properties
  (`--ag-reveal-left/top/width`) plus the `ag-reveal-anchored` class, never as
  inline `left`/`top`/`width`. Obsidian's tooltip manager re-anchors the
  preview on every measure and scroll with `element.style.left = ...`, and
  assigning through `element.style` replaces the declaration **and its
  `!important` priority**. An inline anchor therefore loses on the next frame:
  the preview jumps to the editor's position on entry and again on every
  scroll, which is exactly the "starts left-aligned while editing" symptom.
  The static rule that targets `.cm-image-reveal-tooltip.ag-reveal-anchored`
  outranks any inline declaration, and the editor never writes custom
  properties. Keep the class off until the first write so a tooltip the plugin
  has not laid out yet still positions natively.

- The reveal tooltip owns the preview width, so every level below it must fill
  that width: the embed Obsidian moved into the tooltip stays `inline-flex` and
  otherwise shrink-wraps to the image's intrinsic size. An image narrower than
  the width the plugin gave it then renders at its natural pixel size against
  the box's left edge, which reads as the image shrinking *and* losing its
  alignment the moment the edit state starts. Force
  `.cm-image-reveal-tooltip .image-embed` and its `.image-wrapper` to
  `display:block; width:100%`; the image then keeps the geometry it had before
  the reveal.

- The reveal preview must keep the width the plugin gave the image, drop the
  tooltip's popover chrome, hide the caption widget (its text is already in the
  code line) and stay non-interactive. Move it onto the reserved area with an
  incremental `transform` rather than overwriting `top`/`left`, so it keeps
  following Obsidian's own scroll updates.

- The gallery editing marker is drawn as an `outline` on the preview **image**,
  not on the tooltip: the code line no longer sits beside the image it belongs
  to, so the edited cell needs a marker that survives the row being drawn
  above it. An outline follows the element's own `border-radius`, so the ring
  keeps Obsidian's `--image-radius` instead of boxing a rounded image; the
  tooltip stays at `border-radius: 0` and must not clip the ring
  (`overflow: visible`). A single-image reveal gets no ring.

- Live Preview caption widgets must reset image embed block margins/padding and
  the caption widget buffer's line box. Caption width must use the exact image
  cell width (`--ag-embed-width`), including gallery cells with inter-image
  gap space; never size a caption from the full gallery row.

- In intercepted image lines, hide Obsidian's `img.cm-widgetBuffer` placeholder
  with `display: none !important`; it is excluded from measurements but its
  native inline box otherwise creates phantom vertical whitespace.

- The direct wrapper around a Live Preview caption widget must have zero bottom
  margin and padding. Only `.ag-cm-caption` owns the configured caption gap;
  Obsidian may use either `.cm-widgetBuffer` or a plain `div` wrapper. Establish
  `flow-root` on that wrapper so the caption's top margin cannot collapse
  outside it and appear as a duplicate bottom gap.

- Live Preview `.ag-cm-caption` owns the configured caption gap via
  `margin-top: var(--ag-caption-gap) !important`; its wrapper remains zero
  margin/padding so the gap is applied exactly once.

- Caption horizontal alignment is written as the `margin-inline` shorthand
  (`<start> <end>`), never as two longhands: the browser re-serialises a
  matching pair into the shorthand, and that serialised pair survives a
  later style change and outranks the line's fresh custom properties.

- Caption geometry must be applied on **both** sides of the decoration
  publish. The layout pass computes a new style map before CodeMirror applies
  it, so positioning only beforehand always lags one pass; on a static
  document no second pass arrives and a switch from centred to floated (or
  back) leaves the caption at the old margin permanently. `layoutPass` calls
  `syncCaptionGeometry()` before the dispatch and again right after it.

- Live Preview `.embed-actions` must be positioned relative to the individual
  image embed (`position: relative` on the embed, absolute actions at its
  right edge), never relative to the full CodeMirror line. The native
  `.image-wrapper` inline-flex must be overridden to a block filling the
  already-sized embed; otherwise percentage widths are compounded or ignored.

- When the action bar and its 8px insets no longer fit inside the picture, move
  it into the gutter instead of wrapping the buttons: a left float keeps its
  bar on the right, a right float on the left, and a centred image defaults to
  the right. Place the bar flush (`100%`) and clear the embed's `max-width` cap;
  a gap would break the hover chain, because the bar is only revealed while its
  embed is hovered.

- Obsidian pins the bar once the picture is selected (`is-selected`) and it
  suppresses the hover reveal for an embed it measured as small
  (`no-hover-actions`). That class comes from a single early `offsetWidth` read,
  so a picture the plugin sizes correctly afterwards still carries it. Every
  managed image line is one control group: `.ag-cm-image-line` hides its
  `.embed-actions` and reveals them on the embed's `:hover` / `:focus-within`,
  gallery cell or not, so the bar never waits for a click. The reveal rule has
  to outrank the `no-hover-actions` pair; the compiled theme class supplies the
  extra specificity for that.

- Gallery cells never move the bar outside, and never let it overflow their own
  box. Cells are packed edge to edge, and `.embed-actions` keeps
  `pointer-events: auto` while hidden, so a bar that spills answers for the
  wrong image: the pointer is over picture B while the click lands on picture
  A's button. A `max-width: 100%` clamp does not help either - the container
  shrinks but its three fixed-width items still paint and hit-test outside it.
  Degrade along the cell's own axes instead: horizontal bar, then a vertical
  rail of the same controls, then a rail with 24px controls, and only if none
  of them fit, hide the bar. A hidden bar is recoverable (clicking the image
  reveals the source); an overflowing one silently steals a neighbour's hover.

- Measure the bar's intrinsic width only while it still lays itself out
  horizontally. A compact bar reports the rail's width, so measuring it there
  would make the next pass believe the horizontal bar fits again and flip
  between the two layouts. The rail is viable only because a gallery row shares
  one height: a narrow cell is a tall cell.

- In the compact modes the geometry must come from a stylesheet class, not from
  inline `!important`: an inline declaration loses to the editor's own
  `element.style` writes, and here it also has to override the base rule that
  pins the bar to the right edge.

- Never use `view.contentDOM.clientWidth` as the sole Live Preview width source:
  virtualized/inactive editors can report `1px`. Resolve width from the
  rendered `.cm-line`, its parent, or `.cm-content` before applying percentage
  widths or positioning embed actions.

- Live Preview must run the same automatic single-image route as reading view
  for unannotated images. Feed its measured line width and natural image ratio
  into `calculateFloatLayout`, then publish the result through
  `--ag-embed-width`; a wrapper width of `100%` is only valid inside that
  already-sized embed and must not be the route itself.

- Keep Live Preview's route inputs aligned with reading view: use
  `src/config.json` `qLeft`, `qRight`, and `floatMax`, and pass frontmatter
  profile alignment from `editorInfoField`. When the result is `center` because
  it exceeds the float threshold, preserve `route.width`; never substitute
  `100%`. Explicit `ag:side=left/right` selects the float side but does not
  disable automatic ratio sizing.

- Any Live Preview geometry change that can affect later text hit-testing must
  retain source `.cm-line` positions and call `EditorView.requestMeasure()`
  after the decoration transaction. Do not wrap, move, or synthesize source
  lines to implement float text flow.

- Apply CodeMirror image decorations only while Obsidian's
  `editorLivePreviewField` is true. In Source mode, return no image/caption
  decorations and clear plugin-added inline action positioning; switching
  modes must rebuild the StateField decorations so no prior Live Preview style
  survives.

- Keep Live Preview embed action buttons inset `8px` from the image's right
  edge for visual breathing room; preserve the same value in both physical and
  logical right-position properties.

- Obsidian may rewrite action positioning after widget creation. Reapply the
  `8px` physical/logical right offset as inline `!important` during every
  visible-line layout pass, including gallery rows.

- Static CodeMirror theme rules are not authoritative for Obsidian widgets:
  Obsidian can add inline styles or rebuild the widget after the theme is
  applied. For `embed-actions` and `.ag-cm-caption`, reapply final geometry as
  inline `!important` values during each visible-line layout pass; do not rely
  on a selector alone.

- A caption's margin only affects layout when its CodeMirror widget host is a
  block. Style the direct caption host as `display:block`, width-matched,
  zero-margin/padding, and let `.ag-cm-caption` own the configured top gap;
  styling the span alone can create a visual offset without increasing the
  image line's occupied height.

- In the common DOM shape where `.ag-cm-caption` is a direct child of
  `.cm-line`, use `padding-top` for the configured image-caption gap and keep
  `margin-top: 0`; margin behavior beside floated embeds is not guaranteed to
  expand the CodeMirror line box.

- When writing caption inline styles, set the shorthand `padding` before
  `padding-top`; reversing that order silently resets the configured gap.
  Resolve caption inline-start/end from the same layout style object before
  dispatch, because computed custom properties may still contain the previous
  frame's alignment.

- Refresh timers must guard partially initialized Markdown leaves: check that
  `view.getMode` is a function and `containerEl` exists before using the view.
  Obsidian/CLI can expose placeholder views during reload and otherwise turn a
  harmless refresh tick into a repeated runtime error.








- Live Preview captions are CodeMirror widgets outside the image embed; keep
  dedicated caption alignment variables and do not let selection/viewport
  recalculation replace the editable source-line DOM.

- On CodeMirror document changes, preserve mapped decorations during the
  transaction to prevent gallery flashes, but apply a style only when the new
  line is still an image line. Recompute visible image styles from the new DOM;
  native Live Preview keeps text lines as full-width editable blocks.

- Live Preview layout must be applied through one CodeMirror decoration effect.
  Do not also mutate `.cm-line` inline styles while collecting geometry. Each
  sync must emit removal effects for positions that disappeared, otherwise a
  view switch can reuse stale widths on newly-created widgets.

- Live Preview scroll stability rests on four cooperating rules: keep
  decoration styles for image lines that merely left the rendered viewport
  (only a document edit or a real container resize may drop them); remember
  each image's natural size per open note (`src/image-metrics.js`) and reuse
  it while the bitmap has not decoded, publishing `--ag-img-aspect` so the
  final height is reserved before the pixels arrive; never compute from a
  degenerate container width, since a virtualised line reports 1px, and fall
  back to the last trustworthy content width instead; and when a freshly
  virtualised line renders without a style while its size is already known,
  lay it out inside the MutationObserver callback, which runs before paint,
  rather than on the next animation frame.

- The gallery container width must come from the stable content column
  (`.cm-content` / `contentDOM`), never from a gallery `.cm-line`. The plugin
  has already sized that line to a row cell, so measuring it feeds the row
  back into itself: the next pass computes a narrower row, the pass after that
  recomputes at the content width, and the gallery visibly flickers between
  two row layouts.

- Every helper called from the Live Preview layout pass must exist. A single
  `ReferenceError` inside `applyLayout` aborts the pass before the decoration
  effect is dispatched, so no image receives a width and each later sync
  re-throws — the note looks unstyled while the code appears to run. After
  touching that module, reload the plugin, open the note and confirm the
  `dev:errors` buffer stays empty and gallery lines carry a `style` attribute.

- Release the per-note image geometry cache once its note no longer holds a
  leaf (file-open / active-leaf-change / layout-change, debounced, plus plugin
  unload). Always keep the active file: a restoring leaf can report no file.










- Live Preview gallery grouping must use CodeMirror document line positions,
  allowing gallery-gap lines, rather than relying on DOM sibling identity;
  widget buffers can sit between otherwise adjacent image lines.

- CodeMirror treats each `.cm-line` as a block row even when a decoration
  reports `display:inline-block`; Live Preview gallery cells therefore share a
  row by geometry the plugin publishes itself (see the ruled paragraph below)
  instead of by the browser's inline flow. Hide gallery-gap line decorations
  with an explicit `display:none` style. Keep `clear: both` on the first real
  source line of a row so a preceding floating image cannot narrow it; preserve
  that line's `.cm-line` and document position, and never insert a synthetic
  DOM/source line, because that breaks CodeMirror's direct editing mapping.

- A gallery cell is a *block* with an explicit `margin-left`, not a float. Two
  consequences decide the whole layout:

  **The slot has to be stated.** A float reserves its horizontal slot only
  through its vertical extent, and every cell but one is deliberately zero
  height — so a row of zero-height floats collapses onto a single `x` and the
  pictures paint over each other. `margin-left` = row inset + the widths and
  gutters in front of the cell gives each cell its slot without relying on the
  float band.

  **The row height belongs to the last cell.** CodeMirror stacks line heights
  in document order, so a line's block top is the sum of every earlier height.
  With the height on the first cell the remaining cells are placed at the row's
  *bottom* in that map and are only rendered once the reader scrolls to that
  bottom edge: the last picture of a gallery stayed invisible while the gallery
  itself was in plain sight, and the row then snapped into place. Putting the
  row's `height` on the last source line puts every cell of the row on the same
  block top, so the row renders — and is hit-tested — as one unit. Every other
  cell keeps `height: 0` with `overflow: visible`; their content overflows the
  zero-height box, which is what paints them.

- Because a cell no longer floats, a revealed cell cannot be recognised by
  `float: none` any more. The mark is its own `height: auto` (the code line is
  the only cell without a published fixed height).

- When layout decorations change rendered line geometry without changing the
  document (gallery row compaction, float widths, hidden separator lines), call
  `EditorView.requestMeasure()` after dispatch and once on the next animation
  frame. This refreshes CodeMirror's coordinate map so pointer hit-testing and
  arrow-key navigation use the new visual positions while document positions
  and editable source lines remain unchanged.

- `requestAnimationFrame` is paused while the Obsidian window is hidden. Every
  rAF-scheduled layout pass needs a `setTimeout` backstop (around 200ms) or the
  note opens unstyled in a background window. After a layout transaction,
  dispatch `ag-layout-changed` on the editor DOM so controls that read computed
  float/width (alignment arrows) refresh.

- Caption widgets can be inserted after the image decoration transaction (and
  during the mutation-suppression window). Observe caption/widget-buffer
  insertions and reapply caption geometry on the next stable sync; do not rely
  on the initial image pass or theme CSS alone for `padding-top`.

- Live Preview gallery grouping permits at most two completely blank source
  lines between consecutive image references. A third blank line terminates
  the group. When a group ends on a blank line, decorate that existing blank
  `.cm-line` with `clear: both` and keep it visible; never hide it or create a
  synthetic line, so the blank space pushes following editable content below
  the floated gallery without breaking CodeMirror mapping.

- A fenced code block is literal text. `![x](y)` inside ``` or ~~~ fences is a
  sample of Markdown, not a picture: decorating it gave the code block image
  widths and a caption under every line, while the reader was looking at raw
  source. `readCodeBlockLines` (`src/image-runs.js`) marks every line of a
  fence — including a fence that is never closed — and both source readers skip
  them: the picture is never recorded, and the code block also breaks a gallery
  run in either direction. Only backtick/tilde fences count; four-space
  indentation is list continuation, where pictures are real.

- The layout pass needs each image's aspect ratio before it runs, and
  `naturalWidth` only exists after decode. `primeSizes` reads the ratios from
  the image file headers (`src/image-sizes.js`) at construction and whenever the
  editor is pointed at another note, and `layoutPass` retries while the file
  field is still missing. Without it a gallery paints once at natural width and
  snaps into its row only when the last visible bitmap lands.

- One gallery whose ratios are still unknown must not discard the whole style
  map. Every other line already knows its geometry; suppressing them all makes
  the note look undecorated until that one image loads. The pending group keeps
  its previous style, the rest is published, and a retry is scheduled.

- Gallery rows are packed from the source run, not from the lines CodeMirror
  happens to render. A member outside the viewport would otherwise be missing
  from the row, and the row would be packed at two cells and re-packed at three
  when it scrolls in — the gallery visibly changes width while the reader is
  looking at it. `gallerySlots` completes the rendered group with the missing
  source lines and their primed ratios; a member whose ratio is unknown fails
  closed to the rendered subset rather than being packed as a square.

- A gallery whose first cell is taller than the remaining viewport has to be
  laid out even when that cell is the only one CodeMirror has rendered. The
  un-laid-out picture occupies its natural height, which pushes every later
  cell past `viewport.to`; waiting for a second rendered cell therefore
  deadlocks — the row only forms after the reader has scrolled past the whole
  picture, and then snaps to its packed height. `flush` packs the source group
  from one rendered cell too, provided that cell is the group's **first** slot:
  only that line carries the row's height in CodeMirror's height map. A later
  cell rendered on its own waits for the first one without a retry.

## Gallery handles

- The layout pass publishes `--ag-row-height`, `--ag-row-box`, `--ag-row-width`
  and `--ag-row-offset` on every gallery cell. Handles are positioned from those
  values, never from `getBoundingClientRect`: a cell after the first one is a
  zero-height float whose rect reports the row, and `height: 100%` inside it
  collapses to zero. The same values survive virtualisation, so a handle still
  knows its slot when a neighbouring cell is outside the rendered window.

- Handles are appended to the cell's own embed, the layer that already hosts the
  alignment arrows and Obsidian's action bar. Never add nodes to `.cm-line`:
  CodeMirror owns that element's children, and the line decoration rewrites its
  whole `style` attribute on every pass.

- A divider is only interactive when the next rendered cell is contiguous with
  it (`offset == cell.offset + cell.width + gap`); the row-height bar only when
  the rendered cells close the row. A partially virtualised row must not offer a
  gesture that would rewrite half of it.

- A row with a revealed cell publishes no handles: the revealed cell becomes a
  full-width block (`float: none`), so the row is no longer a grid. The layout
  pass writes `float: none` only for that state, which is the signal to test.

- Gestures preview through CSS custom properties and commit once on release.
  `.ag-resizing` freezes the layout pass for the duration, so the decoration
  cannot rewrite the style attribute mid-drag. On commit the decoration takes
  the preview over wholesale - do not restore a pre-drag snapshot afterwards, or
  the old geometry lands on top of the new one.

- A gesture writes crop ratios, never the row split. `ag:rows` is hand-authored:
  a column or height drag used to pin the split it produced, and releasing a
  binding used to pin the one it was showing, which left notes carrying a
  `ag:rows` nobody wrote. Both writes are gone. An unbound run therefore
  re-enters automatic routing after a gesture - that is the documented state of
  a gallery without annotations - and a row whose members must not move is bound
  with `ag:group` (the link button), which no gesture rewrites.

- Reordering exchanges the *text* of two adjacent image lines, not their
  positions. The picture then inherits the other slot's separation from its
  neighbours, which is what moves it into the previous or next row. Hide the
  button when `blockedBefore` records prose between the two lines; a picture
  must never jump across a paragraph. `ag:rows` travels with the run's first
  line, so a swap that moves that line hands the annotation to whichever line
  now occupies the slot.

## Row band, ceiling and control placement

- A cell publishes `--ag-row-content` (the band the cells occupy) and
  `--ag-row-inset` (its left inset) beside `--ag-row-width`, which stays the
  column width. A capped row is narrower than the column, and overloading
  `--ag-row-width` would break every `Math.abs(offset) < 0.5` test that
  identifies a row's first cell. `--ag-row-natural-height` carries the uncapped
  height the ratios were produced by.
- `isLast` compares `offset + width` against `--ag-row-content`. Comparing
  against the column width makes a capped row's last cell never look last, and
  the row then gets no handles at all.
- The height bar rides the middle of the picture-to-caption gap
  (`height + captionGap / 2 - HOT_ZONE / 2`), so it sits above the caption
  instead of below it, and never on the picture's own bottom edge.
- Each bar reveals on its own hover and only itself. The reorder/merge/link
  buttons are one control group: they follow the cell's hover, and while a row
  is bound the delegated `pointerover` handler marks the whole row so every
  link button shows at once. A pointer over a bar clears that mark and adds
  none: reaching for the seam between two pictures is not hovering either
  picture, and the row-wide reveal must not answer for it.
- Order/merge controls degrade in up to five steps (a narrow cell stops at
  four and skips `horizontal`, see below), and the native bar always wins:
  beside a horizontal bar (`row`); one line of trays centred in the band the bar
  and the link leave free (`horizontal`); a single left-aligned column in the
  rail's lane (`column`); both groups folded into one tray (`fold`); hidden. A
  short, wide cell has no vertical room for a tray above and below its centre
  line but plenty of room sideways, and dropping the controls there was the
  common "the reorder buttons are missing" case. The horizontal line is centred
  on the picture's own centre line - not pinned under the bar - and its
  right-hand tray is reversed, so a swap stays on the inside and a merge on the
  outside. A side that offers both a swap and a merge stacks them vertically
  (swap above, merge below). A lone cell with both neighbours produces four
  controls.

- A list gallery gets the reorder and link controls but not the two drag
  handles. Its geometry is published on the **embed** (`--ag-row-*`): the editor
  rewrites a list line's inline style on every measure, and both drags preview
  through that line style. `collectRows` therefore reads those rows from the
  embed and groups them by `ag-cm-list-run-*` instead of an offset of zero.
  `documentIndex` folds the item's own marker line (`- ![](a)`) into the same
  ordered record list - the standalone reader skips it, and without it swapping
  the two pictures of an item finds no neighbour at all.

- `data-ag-handle-key` records what the handles were built *from*; it is not
  proof that they still exist. The cleanup pass deletes handles from any cell it
  could not measure (a row half outside the viewport), and Obsidian empties an
  embed when the picture finishes loading - both leave the dataset behind, and
  trusting it stranded the cell without controls until the geometry changed.
  `data-ag-handle-count` holds how many direct children the build added; a
  mismatch forces a rebuild. Handle helpers must stay defined and reachable:
  the whole layer is created lazily from one function, so a single missing
  helper removes every control on every cell.

- Gallery controls must borrow Obsidian's own metrics, not approximate them.
  A native embed-action button is 28x24 with 4px/6px padding, a 4px radius, no
  fill, no border and no shadow, and it reads `--text-normal` inside the bar
  (not `--icon-color`, which is the muted tone). Its tray is 6px/2px/2px
  radius/padding/gap over `color-mix(in srgb, var(--background-primary) 80%,
  transparent)` with `blur(6px) saturate(1.5) brightness(1.15)` and the two
  faint shadows, inset 8px from the picture edge. A boxed button inside a tray
  is the tell that a control was drawn separately: the surface belongs to the
  tray, the button only owns its hover wash and icon colour.

- A narrow cell narrows through **four** states, never skipping one. Two trays
  side by side either run into the native rail or into each other, so the
  buttons carry their original edge (`data-ag-edge`) and the fold is reversible:
  widening the cell splits them again.

  | mode | fits when | looks like |
  | --- | --- | --- |
  | `row` | `2*32 + 16 + rail + 6` | left tray · right tray · native rail (three columns) |
  | `fold` | `32 + 16 + rail` | folded tray at the left · native rail (two columns) |
  | `column` | band between bar and link | folded tray in the rail's lane, centred between them |
  | `hidden` | - | nothing |

  Dropping `fold` makes the controls teleport from the two edges straight into
  the rail's lane the moment three columns stop fitting. The folded tray in
  `column` mode uses the rail's own lane (8px inset, the same x as the bar and
  the link); if the band cannot hold it plus a gap on both sides, the controls
  are hidden, and if the cell is shorter still the link is hidden too. Overlap
  is never the fallback. `orderControlLayout` is the pure function that decides
  this - keep it pure so the four answers stay testable.

- The bar's height comes from the placement cache (`railHeight` / `barHeight` in
  `embedActionMetrics`), not from the live box: the bar is `display: none` until
  the cell is hovered, and reading 0 there would let the controls sit exactly
  where the bar is about to appear. A cache miss is rebuilt from the bar's item
  count rather than read as "no bar".

- The row-height bar rides **the middle of the picture-to-caption gap**, not the
  picture's bottom edge (`top = rowHeight + captionGap/2 - HOT_ZONE/2`). On the
  bottom edge it reads as a border of the image; the column divider already
  floats in its seam, and the two bars must look like the same control.
  During the drag the bar follows the pointer: it is the thing being held, so
  waiting for the commit to reposition it feels like the gesture is stuck.

- Gestures capture the pointer (`setPointerCapture`). A release outside the
  window never reaches the document otherwise, and the stale `activeGesture`
  silently refuses every later drag for the rest of the session.

- A crop drag must not depend on the bitmap having decoded. `naturalSize` reads
  `img.naturalWidth`, which is 0 until the picture arrives; the commit then
  computes no crop and throws the edit away, so a cropped cell near the top of a
  freshly opened note "cannot be dragged". Fall back to the metric cache
  (`imageMetric(imageMetricKey(notePath, link))`), which the header probe fills
  when the note opens.

- A geometry pass can be swallowed (a second edit cancels its frame, a gallery
  waits for a size). `ag-layout-invalid` therefore records `publishSerial` and,
  if no pass published within two frames, clears the style cache and asks once
  more. Without it the row keeps the geometry of the annotation the reader just
  changed and the pictures overlap their neighbours.

- Both handle bars use a two-tone line: a 4px muted rail with a brighter core
  of the **same 4px thickness**, rounded to a 2px capsule like the rail. Only
  the length stays short (28px). A thinner
  core has to be centred with half-pixel maths and lands blurred on fractional
  display scales; matching the thickness makes the two boxes share their edges
  exactly, so the segment can never drift off the rail.
- Both bars live inside the cell they belong to, so hovering one also hovers
  that embed and would reveal the cell's reorder, link and native action
  buttons. One shared rule covers the height bar and the column divider:
  `:has(> <bar>:hover)` and `:has(> <bar>.is-active)` suppress every other
  overlay in that cell, so a bar's activation is its own state and is never
  shared with the buttons. `is-active` keeps the claim for the whole drag, when
  the pointer can leave the 12px hot zone. `style-mod` splits a rule key on
  every comma - including one inside `:has()` or `:is()` - so the states are
  expanded into separate top-level selectors (`barOwned`), never written as a
  selector list inside the pseudo-class. `.ag-resizing` suppresses every
  overlay for the duration of a gesture too, with `!important` on
  `pointer-events`: the reveal rules are equally specific, and an invisible
  overlay that still accepts the pointer swallows the drag.

- A `baseTheme` selector that targets the **editor element itself** must be
  written `&.ag-resizing`, never `.cm-editor.ag-resizing`. CodeMirror compiles
  a selector without `&` to `.ͼ1 <selector>`, i.e. a *descendant* requiring a
  nested `.cm-editor`; the theme class is on the editor, so the rule never
  matched. That made both the `.ag-resizing` overlay suppression and the
  drag-time `user-select: none` silently dead. Any selector that starts at the
  editor root uses `&`.

- The release ends by rebuilding the row's handles, which replaces the bar
  under the pointer; the browser drops that bar's `:hover` for the rebuild
  frames, the cell's embed becomes the hovered element, and its overlays fade
  in until the new bar lands. `ag-gesture-settling` carries the overlay
  suppression across that window (`holdOverlays`, 320 ms, measured rebuild is
  ~30 ms) and is removed afterwards. The held set includes Obsidian's native
  top-right bar for gallery cells: while the bar is missing from the DOM no
  `:has()` rule can answer for it. Once the settle window ends the bar's own
  hover state takes over, so a pointer still resting on the bar keeps every
  button down instead of fading them in 320 ms later.

- A gallery gesture owns the line attributes, but it must **not** stop the
  decoration field from rebuilding. CodeMirror re-applies a line's decoration
  attributes whenever it rebuilds the line, and a value returned unchanged from
  a `StateField`'s `update` is not mapped for the editor: after one commit the
  rebuilt lines kept their old document positions, lost their image class, and a
  single natural-size picture filled the viewport - the gallery never formed
  again until the note was reopened. The preview is therefore cached and
  **pre-taken**: `trackGesture` stores each dragged line's `cssText` (the merge
  of published and live declarations), and `buildDecorations` paints that cache
  instead of the published map while the gesture is active. `readLayoutStyles`
  reads the baseline captured at `gestureGeometry.hold` for those lines, so a
  preview can never be mistaken for published geometry and become sticky. Any
  rebuild - a re-rendered line, the commit transaction itself - reproduces the
  preview, which is what removes the flash on release. The mutation observer in
  `trackGesture` still repairs a same-element style wipe, and every preview write
  goes through `setIfChanged` so the repair cannot ping-pong. `beginPublish()`
  makes the publish effect outrank the preview, `release()` clears the cache
  after that dispatch, and a watchdog re-runs `ag-layout-invalid` if the pass
  never lands.

- No layout pass may run mid-gesture. `sync()` refuses to schedule one while
  `.ag-resizing` is set, but the section observer enters `applyLayout` directly;
  publishing the last committed geometry there would end the preview under the
  pointer. `applyLayout` checks `dataset.agResizing` for the same reason.

- A height drag republishes `--ag-row-height`, `--ag-row-box` and
  `--ag-row-natural-height` every frame, plus `--ag-row-content` /
  `--ag-row-inset` once the row is back under the ceiling. Growing only the
  line's own `height` leaves the divider and the row box at the old geometry,
  so the row visibly grows behind its own controls. `requestMeasure()` follows
  each frame so the caption and the lines below move with the picture.

- A gallery caption leaves a **12px** seam (`GALLERY_CAPTION_GAP`, never less
  than the configured `captionGap`), and `captionBoxHeight` /
  `positionCaptionWidgets` read the same value. The row-height bar floats in
  that seam; in the 6px single-image gap a 4px bar has one pixel of air on each
  side and reads as a border on the picture. A row without a caption has no
  seam, so its bar is centred on the picture's bottom edge instead.

- The caption band a row reserves is measured at the cell width the caption
  will actually be drawn with, and it is the **tallest** caption of the row -
  not the first cell's. A caption wraps at that width; measuring before
  `positionCaptionWidgets` applied it (or reading only cell 0) let a two-line
  caption paint over the next row. `rowCaptionBox` runs after every cell's
  caption has been positioned; `captionBoxHeight` returns the full multi-line
  height, with `20px + gap` only as the floor for a caption that is not
  rendered at all.

- A gallery step must never write `--ag-embed-width` or the crop properties onto
  the `<img>`. The decoration republishes the line's style as a whole, so an
  inline copy on the bitmap outlives it and pins the picture to the last dragged
  frame; `clearImagePaint` removes copies an older build left behind.

- A height drag keeps every column where it is. `width = height * ratio`, and
  the frame ratio is being scaled by `natural / target` for this very height, so
  the product is `natural * ratio` - the width the row already had. The preview
  must apply that factor to the widths it paints: with plain `target * ratio`
  the cells widen as the pointer moves down and the row zooms instead of
  cropping. The commit uses the same factor, so the released row lands exactly
  where the preview showed it.
- A row sitting on the height ceiling cannot grow. A downward drag leaves the
  clamp unchanged, and repainting anyway would uncap it to the full column
  width without the reader asking for it - only a real change in the target
  paints, and a zero-delta release writes nothing.
