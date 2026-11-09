# Core Layout Rules

Gallery formation, row packing, float geometry and width routing. These rules
are shared by the reading view and Live Preview; a bullet that applies to only
one view says so, and the view-specific detail lives in `reading-view.md` or
`live-preview.md`.

Read this before touching `layout.js`, `routes.js`, `image-runs.js`,
`float-order.js`, `renderer.js` or `src/config.json`.

- Grouping is structural in both views: a run of two or more image blocks is a
  gallery, whatever `ag:layout` / `ag:width` / `ag:side` the individual lines
  carry. Consulting `resolveRunMode` for those runs made the same note render
  as one row in Live Preview and as separate floats in the reading view.
  `resolveRunMode` only decides for a single image.

- A lone cell — a row the packer could not pair — is still a gallery cell and
  spans the column. Only when its full-column height exceeds the
  `galleryOrphanMaxHeight` setting (default `config.gallery.orphanMaxHeight`,
  400 px; 0 disables the rule) does it leave the grid, and then it keeps the
  auto-routed width on the centred axis. Auto-routing every single cell was
  what made the two views disagree on every single-image row.





- Keep `resolveRunMode` structural: an unannotated group of two or more loaded
  images must reach `decorateGallery`. The packer's own default is three per
  row; every renderer passes `galleryMaxPerRow` (default 5) instead, and the
  `height` control passes 15.

- Row packing has exactly one implementation: `calculateGalleryRows`. Live
  Preview must call it too. The greedy loop it used before split rows
  differently from the reading view, so one note rendered as 3+1 in the editor
  and 2+2 in the preview.






- A lone gallery cell — the orphan a row packing leaves behind — keeps an
  automatically routed width but is forced onto the centred axis. Centring is
  what makes it stop floating, which is what stops the wrap.

- When a picture shares its paragraph with prose the sizing lands on the
  embed, so the flow block itself has no margin. Centred and floated pictures
  must still give that block `margin-block-end: imageBottomGap`; without it the
  paragraph runs flush into the next block and the spacing jumps whenever the
  reader switches alignment.

- Obsidian fills an embed's `alt` with the link target when a wiki link has no
  alias (`![[图.png]]` → `alt="图.png"`). That is a file name, not a caption:
  `readImageAnnotation` must normalise it away, or every unannotated embed
  grows a caption that repeats its own name. The same normalisation feeds
  `imageIdentityFromDOM`, which matches a rendered embed to its source record;
  a mismatch there silently drops the blank-line information the gallery
  grouping is built on. Both must go through `normalizeEmbedAlt`.

- A gallery row is a stack of zero-height floats except its first cell, so the
  flow position of the line after the gallery is still the row's top edge.
  Anything that turns a gallery member into a float — auto-isolation is the
  ordinary case — must also give that line `clear: both`, or it paints on top
  of the row it was meant to follow.

- The last gallery row owns its bottom gap when the next line is another image
  line: image lines carry no vertical margin, so relying on "the document's own
  spacing" leaves the gallery flush against an isolated image below it.

- Float termination must apply `clear: both` to the Obsidian wrapper and the
  concrete heading/code/math/image/table/callout node. Checking only a child
  selector is insufficient for `.el-*` wrappers.

- The prose after a terminated float must step past the floats that are still
  open *above* that boundary, never past the boundary float itself. Clearing the
  boundary's own side is what pushed the text under the picture instead of
  wrapping beside it. Clearing only the earlier sides keeps the wrap and pins
  the paragraph below them, which is also what stops it from jumping up beside
  the *previous* picture.

- Two separate settings decide two separate things, and they must never be
  swapped. **Where the pictures go** is the "picture" float stop
  (`floatBreaks.image`): while it is on, a picture terminates the picture above
  it, so every float carries `clear: both` and the sequence stacks in one
  column; only with that stop off may two floats share a band. **Where the
  prose goes** is `floatSpaceMode`: `ordered` (default) makes the prose after a
  picture clear the sides that were open *before* it, so a paragraph can never
  move up into the half-column an earlier picture left free; `share` writes no
  such clear and lets the prose fill whatever is free. `share` must not remove
  the float's own `clear` and must not stop pictures from terminating floats —
  a left and a right picture on one row leave a text strip a few characters
  wide, which is not what "share the float space" was asked for. One `clear` is
  never enough: clearing the float only orders the floats against each other,
  and clearing the paragraph only orders the prose, so the two steps are
  separate.
- The ordering pass must see a float that lives *inside* a paragraph. Reading
  only the block's computed `float` reports `none` for a mixed `<p> <span
  class="image-embed" style="float:left">`, and the PDF tree adds another
  wrapper level, so every mixed paragraph was invisible to it.
- `mobileBreakpoint` guards the reading view's window width. The print path
  must not reuse it: it asks whether the room left beside the picture can hold
  a readable line (`width - routeWidth - gap`), because a paper column is a
  deliberate choice and a 600px gate turned floating off for A5, wide margins
  and any scale above about 117%.

- The set of open sides must be reset by **every** float stop, not just by a
  heading. A block that ends a float carries `data-ag-float-end` and has been
  cleared below everything above it — heading, table, blockquote, callout, code
  or math; from there on those floats cannot reach the prose, so carrying their
  sides forward makes a later paragraph clear a side that closed sections ago.
  A boundary that is *itself* a float is the opposite case and must not reset:
  it has dropped below the earlier floats, but the prose still has to step past
  them to wrap beside it. Headings reset as well, because a section break ends
  the flow even when nothing floated above it.

  Measured on 2026-11-07 against table, blockquote and code boundaries: the
  boundary block is cleared by the termination rule either way, so the reset
  changes no geometry there — it is the type-independent form of a rule that
  was written for headings only. Nested scopes (a table or callout inside
  another scope) are not walked by this pass at all.

- Right floats need the gap on the physical left margin; centered images must
  never receive a CSS `float` value and must keep their requested outer width.

- A floated image and caption must own vertical spacing at the outer floated
  block exactly once. Normalize intermediate `p`, `span`, and wrapper
  margin/padding to zero, preserve only the outer block's configured bottom
  gap, and clear the following prose block's top margin/padding. The rule must
  work whether image and prose share a paragraph or are separate wrappers.

- After automatic float width calculation, the reading renderer may snap the
  occupied image/caption height to the nearest text-line boundary. This
  correction must use measured image and line heights, adjust only automatic
  widths, and never alter explicit `ag:width` values or create a second layout
  pass.

- `floatMax` decides whether an automatically sized image floats; it must not
  replace the piecewise-calculated width with `100%`. Images above the float
  threshold should render centered at the calculated width. At neutral gain,
  derive the left/right exponents from `src/config.json` so `qRight` is not
  silently overridden by the settings slider. The threshold is an inclusive
  ceiling: an image exactly at `floatMax` floats, matching
  `calculateFloatLayout`, and it only applies to automatic widths — a manual
  `ag:width` with an explicit side floats at the width the reader chose.

- Never zero the top margin of ordinary prose following a float; native
  paragraph spacing must remain intact.

- A gallery is one grid: the horizontal gap between cells and the vertical gap
  between rows must both be `galleryGap`. Rows after the first own that gap
  through `margin-block-start` on the cell; the first row leaves it at `0` so
  the preceding block's own bottom margin sets the distance into the gallery.

- A row that ends up with a single image spans the whole column, so its height
  follows the ratio the reader actually sees: `ag:crop` wins over the natural
  ratio. Reading the natural ratio there made a cropped banner render as the
  uncropped portrait it came from, which looks exactly like a crop that was
  ignored. The single-row branch must set `--ag-img-aspect` from the crop and
  let `applyCropStyle` publish the view box, the same way
  `collectIndividualStyles` does.

- That single cell is an orphan: it is not part of a grid anymore, so a
  portrait image fills the column and occupies more height than the whole
  viewport. When its full-column height exceeds
  `galleryOrphanMaxHeight` (400 px by default, 0 disables the rule) the orphan
  must drop out of the gallery and take the isolated single-image layout —
  the same path `ag:isolate` uses — instead of being stretched to `width:
  100%`. The check runs on the ratio, not on a measurement, so it cannot feed
  back into the next pass. `collectIndividualStyles` therefore accepts a
  `widthOverride`: a cell that leaves its row must be routed against the
  column width, never against its own already-sized cell width.

- Obsidian's `.el-p` wrapper carries a 1em paragraph margin. Inside a
  multi-image gallery row that margin must be cleared on both ends of the inner
  paragraph, otherwise it sits inside the cell and adds a second, larger gap
  above every row, which is what makes the horizontal gap look too narrow.
  A single-image row keeps its native top margin and only clears the bottom.

- The historical 4px whitespace allowance for inline-block cells only applies
  when the two cells do not share a parent. Cells that share a parent have
  their whitespace text node removed, and the first cell of a row always
  spends the full configured gap.

- A gallery followed by another image (not prose or a heading) owns a bottom
  gap: a following float zeroes its own top margin, so without it the next
  image sits flush against the last row.

















- A gallery may span images that share one paragraph (the split gives each one
  a block) and images in separate paragraphs. `readImageBlock`'s `hasText` only
  decides whether the paragraph's prose stays with the image; it no longer
  disables the gallery. A mixed paragraph still reaches the gallery path
  through a list item (`cellOnEmbed`).

- Reading-view gallery grouping must consult `sourceText` for the separator
  rule: at most `MAX_GALLERY_BLANK_LINES` (2) blank lines may separate images
  in one gallery, and any non-image line ends the run. Reading view drops blank
  paragraphs from the DOM, so adjacency alone cannot enforce the limit. The
  shared implementation lives in `src/image-runs.js`; never reimplement the
  grouping rule per view.























































































































































































































































- Keep image and prose at separate DOM granularities. A paragraph that holds
  prose keeps image width/float on the `.image-embed` only; never constrain the
  parent `<p>` to the image width. An image-only block owns its width so
  document-level floats and clear boundaries still work.

- Alternate float direction must be assigned from a persistent per-section
  identity/index map before lazy images are filtered. Never count only loaded
  or currently visible images, since scrolling and view switches then flip
  left/right assignments.

















































































































- Compare an explicit `ag:width` with `floatMax` as the declared percentage.
  Deriving the ratio from the measured column lets a sub-pixel width change
  flip an image between floating and centered on consecutive passes, which
  reflows the document by the image's full height difference.

## Column widths and the row split

- A gallery cell has no stored width. The packer derives it:
  `rowHeight = (containerWidth - gap * (n - 1)) / sum(ratios)` and
  `cellWidth = rowHeight * ratio`, where `ratio` is `ag:crop` when present and
  the picture's own aspect ratio otherwise. Reallocating width between two cells
  is therefore the same operation as rewriting their crop ratios, and keeping
  the pair's ratio sum constant keeps the row height - which is why a column
  drag never disturbs the other cells in the row.

- `ag:rows=3,2` is a hand-written **prefix** for the row split, written on the
  run's first image: row one takes 3, row two takes 2, and the packer routes
  whatever is left. Counts are consumed in order and the last one is truncated
  at the end of the run - `4,3,1` on six pictures is `4,2` - so a stale list can
  never lose a picture; a short list (`2` on six) hands the tail back to
  automatic routing, and the tail is packed *around* any `ag:group` rows in it.
  Nothing injects this parameter: a gesture writes `ag:crop` (and `ag:group` on
  a merge), never `ag:rows`, and releasing a binding returns the run to the
  packer instead of pinning the split it happened to show. Locked rows
  deliberately skip `minHeight` and may exceed `maxPerRow` - that limit bounds
  automatic packing, and the author asked for this split. Validating inside
  `calculateGalleryRows` is what keeps the reading view, Live Preview and the
  PDF export on the same rows.

- Never store a row height. Height is a function of the ratios and the column
  width, so a stored height would be a second source of truth that goes stale
  the moment a crop changes or the window resizes.

## Row height ceiling

- `calculateGalleryRows` accepts `maxHeight`. A row whose natural height exceeds
  it is **scaled**, never cropped: every cell width and the row height are
  multiplied by `maxHeight / naturalHeight`, which leaves every ratio untouched,
  so the pictures simply render smaller. The ceiling is raised to `minHeight` on
  entry - a cap below the minimum would make the two constraints unsatisfiable.
- A capped row is narrower than the column and centred. Rows therefore report
  `width` (the content band) and `offset` (its left inset) in addition to
  `height`, `naturalHeight` and `capped`. `items[i].width` is already scaled.
  The exact band width is `scale * available + gap * (n - 1)`, not
  `scale * columnWidth`: the gutters do not scale.
- Only rows of two or more pictures are capped. A lone cell keeps the
  `orphanMaxHeight` rule, which takes it out of the grid entirely.
- The dynamic program scores `min(height, maxHeight)`. A row that is capped
  looks the same however far it overshoots, so splitting it further buys
  nothing; the existing tie-break then prefers the fuller row, which widens the
  band. `packLockedRows` applies the same ceiling - a locked split fixes the
  members and their relative widths, not an unlimited height.

## Row binding (`ag:group`)

- `ag:group` carries a positive id (`ag:group` alone means `1`). A maximal run
  of consecutive images sharing one id is a **bound row**: the packer emits it
  as-is and never adds or removes a member. The id is what keeps two adjacent
  bound rows apart - a boolean flag would merge them into one run.
- A stored `ag:rows` split is honoured only when it does not cut a bound run
  (checked at its first and last element). The split is not deleted on conflict:
  it is the author's text, and it applies again once the binding is released.
- Binding takes precedence over the packer's width optimisation: a bound row
  stays at its member count even when a neighbouring row has spare width. That
  is the deliberate break in the "pack as densely as possible" rule.
- A run longer than `maxPerRow` is not a valid bound row; it falls back to the
  packer, mirroring what `normalizeRowCounts` does with an unusable split.
