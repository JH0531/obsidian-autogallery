# Reading View Rules

Block splitting, preview-section registration, virtualisation, staleness
detection and scroll restoration for the rendered reading view.

Read this before touching the preview renderer in `renderer.js` or the
`registerPreviewBlocks` / `clearPreviewBlocks` path in `plugin.js`.

- The reading view creates one block per image (`splitImageBlocks`), and every
  such block must be registered with the preview renderer before the next
  scroll. Obsidian's `updateVirtualDisplay` keeps exactly the blocks listed in
  `renderer.sections` and detaches every other child; an unregistered split
  block is removed as unknown content, which collapses the section height and
  makes the view jump. `registerPreviewBlocks` in `plugin.js` inserts a section
  descriptor next to the block's DOM neighbours; `clearPreviewBlocks` removes
  them before a cleanup so the virtualiser never re-inserts an empty shell.

- A registered block is an ordinary content section: give it `level: 7` so a
  collapsed heading hides it like its siblings, and let `measureSection` own its
  height. A floated block measures as zero height, which is correct — the
  following text block grows by the wrapped lines, so the flow sum stays right.

- `previewSectionStale` must compare only the images that are currently
  attached: virtualisation detaches whole blocks, and treating their images as
  missing made the plugin re-render on every scroll. `previewSectionRebuilding`
  only waits when *new*, never-decorated images are present and fewer than
  before; a note edited down to fewer images renders after a 400ms fallback.















































































































































































































































































































- Preview post-processing must disconnect its section observer while cleanup
  and decoration run, then reconnect after rendering. Never let captions or
  image widget mutations trigger the renderer recursively.

- A preview section must be rendered once per profile. Repeated Markdown
  post-processor callbacks for the same section must not run cleanup and
  gallery construction again; later DOM/image changes are handled by the
  section observer and image-load polling.

- Obsidian can reuse the same preview section when a file changes in-place in
  one tab. Track the rendered source path and reset cleanup/state whenever it
  changes; `initialized` alone is not a valid cache key.





































- A reading-view section may only be re-decorated when its structure actually
  changed: a rebuilt block, a different image element, a finished image load or
  a new column width. Re-running the whole section on every recorded mutation
  makes the document height oscillate while the reader scrolls, which shows up
  as the view jumping and as `scrollTop` being clamped.

- Reading-view scroll restoration must anchor to the first block under the
  viewport top, not to a raw offset. Chromium's own scroll anchoring is active
  in the reading view, so when the anchored block is still connected the
  browser has already kept it in place: the measured delta is zero and the
  plugin must not write `scrollTop` again. Rewriting the captured offset there
  undoes the browser's correction and is what makes the view snap back and
  refuse to move past a section. Apply the element delta only when the block
  really moved, and use the raw offset only after the block was replaced
  together with the section.

- A decoration pass that shortens the document by more than a viewport is a
  reflow, not a scroll: the reading view is built with the pictures at natural
  height, Chromium follows the collapse, and the offset after the pass is no
  longer the reader's. Both guards above (the 24px staleness check and the
  one-viewport cap on the delta) exist to reject the wrong *user* scroll, so
  they are skipped when `scrollHeight` moved by more than `clientHeight` during
  the pass. Without that exception the view stayed wherever the collapse left
  it, which for a picture-heavy note is hundreds of pixels off.

- A reading view that was just built must have its scroll replayed after the
  first pass. Obsidian converts its remembered source line into a pixel offset
  before the plugin decorates anything, so the target is computed against
  natural image heights and lands past the end of the collapsed document.
  Calling the renderer's `applyScroll(line)` once the blocks are measured puts
  the reader back on that content. The offset must be replayed again on the next
  frame and once more after ~200ms: `applyScroll` divides each block's height by
  its line count, and the virtualiser only applies those heights a frame later,
  so the first replay is computed against stale geometry.

- The position has to be carried across a mode switch by the plugin, not read
  back from the view. Obsidian hides one mode and shows the other, so the
  reading section survives the switch with its state and heights intact and no
  pass (and therefore no replay) is scheduled; whether its own `scroll` field is
  passed along depends on the path the toggle took. Keep two maps instead: the
  fractional line the reading view was on, updated on every scroll, and the line
  the editor is on, updated from the editor's scroll listener. On preview →
  source put the editor on that line by writing the line block's own offset to
  `scrollTop` — `scrollIntoView` centres the line and moves the paragraph to the
  middle of the screen; on source → preview force one pass and replay the line.
  A toggle lands within a line or two of where it started and repeats exactly;
  it does not return to the top.

- Every section descriptor the plugin registers must carry a numeric `lines`.
  Obsidian maps a scroll offset to a source line by dividing each block's
  height by its `lines`, and a split block is a fragment of a block that is
  already in the list. Leaving `lines` undefined turns that arithmetic into
  `NaN` (the editor opens at line 0 on a mode switch); leaving it at zero makes
  the line total fall short of the document, so every later line resolves past
  the end and the reading view jumps to the bottom. `distributeSplitLines`
  shares the owner's count across the run by height, which keeps the sum equal
  to the note's line count.

- Decorating a newly virtualised reading-view block must happen inside the
  MutationObserver callback, which runs before paint. Waiting for a later timer
  paints the block at natural size first and then collapses it into gallery
  rows, which reads as a large jump while scrolling.

- A reading-view pass can only correct the shift it can still see. Obsidian
  rebuilds blocks above the viewport before the plugin is notified, so the
  correction must be measured against an anchor captured while scrolling (the
  block under the viewport top, its screen offset, and a text + index fallback
  for when that block was replaced), not against a snapshot taken when the
  render starts. A `ResizeObserver` on the section catches the remaining
  Obsidian-driven reflows that happen outside a plugin pass.

- Reading-view staleness must also consider the block wrapper, not only the
  image element: Obsidian can move an existing `<img>` into a freshly built
  block, and an identity-only check then waits for the polling pass, leaving
  the block at natural size until it snaps.





- Reading-view ownership is section-scoped. Markdown postprocessors may receive
  detached paragraphs; they must only schedule a refresh, while the plugin
  renders connected top-level `.markdown-preview-section` elements once. Never
  decorate both an inner `<p>` and its surrounding `.el-p`.

- Reading-view layout transitions must explicitly reset mutually exclusive CSS
  properties. In particular, gallery items must set `float: none` and
  `clear: none`; otherwise a previous single-image float can survive on the
  reused wrapper and force gallery items into separate right/left rows.

- Gallery grouping's mixed-content check must remove the entire Obsidian image
  embed wrapper (`.image-embed`/`.internal-embed`) from its cloned block before
  reading text. Removing only `<img>` leaves alt/caption text behind and
  incorrectly prevents captioned images from joining a gallery.

- Reading-view gallery cells are separate `inline-block` siblings and may have
  a whitespace text node between them. Include that node in the gap budget;
  otherwise widths that mathematically equal the section width wrap the last
  image onto a new line and appear to have lost gallery layout.

- Refresh after file-open, active-leaf/tab changes, view/layout changes,
  settings writes, and plugin load/update. Dispose old section state, clean
  generated styles, and reset the float identity map before binding a new
  source path. A stale render must never write into a new file's section.

- Preview refreshes must preserve the scroll anchor. Capture the preview
  scroller before cleanup; restore the previous `scrollTop`, and when the user
  was within a small threshold of the bottom, restore the new bottom instead
  of the old numeric offset. Image height changes must never strand the user
  above the final content.

- A decoration pass must know every image's aspect ratio before it runs. The
  ratio comes from the image file header (`src/image-sizes.js`), not from
  `naturalWidth`, which only exists after the bitmap decodes: a pass that has to
  wait for decode decorates the galleries one image load at a time, and each
  wave collapses the document by the difference between the natural and the
  packed height. A pass without the note's text is skipped entirely and retried
  when the vault read resolves — decorating half a section is worse than
  waiting one task.

- The recorded size of a rendered image (`state.known`) must be the size the
  pass laid it out with, i.e. `measureImage` including its primed fallback, not
  `naturalWidth`. Comparing a primed layout against a zero until the bitmap
  arrives makes every decode look like a resize and schedules another pass.

- Every block has to be decorated at least once, including the ones far outside
  the viewport. The virtualiser reserves each detached block at the height it
  was last measured at, which for an undecorated block is its natural,
  full-width height — a paragraph holding six images reserves several thousand
  pixels and releases them the moment the reader scrolls onto it. `renderExtra`
  is widened for the duration of the pass (`expandRenderWindow`) and restored
  afterwards, so the spacer is built from decorated heights from the start.
  Sections too large to attach at once keep the ordinary window and are
  decorated progressively. A section within `FULL_RENDER_SECTIONS` /
  `FULL_RENDER_HEIGHT` keeps the expanded window after the pass: a gallery row
  is split into one inline-block block per picture, and a window that ends
  inside a row leaves only some cells attached. Those cells reflow into a
  different line arrangement, Obsidian re-measures the row against it and the
  document height moves mid-scroll. Holding the window removes that failure
  mode for the sizes where it matters.

- A cached height that was measured as the distance to the next sibling must
  not be replaced by the block's own box when that sibling is detached. The two
  definitions differ by the collapsed margin between them, and swapping one for
  the other on every attach/detach makes the document height drift while the
  reader scrolls. Keep the measured value; only measure a block that has none.

- `syncPreviewGeometry` must only call `updateVirtualDisplay` when a height
  actually changed. Re-running the virtualiser moves blocks in and out of the
  window, which is the churn a scroll must never see.

- Obsidian writes the virtualiser's `min-height` from the section heights alone
  while the sizer also carries half a viewport of `padding-bottom`
  (`addBottomPadding`). The sizer's box is `max(total, attached + padding)`, so
  the document height moves by up to that padding as blocks attach and detach —
  the visible jump while scrolling an image-heavy note. `ensurePreviewMinHeight`
  wraps `updateVirtualDisplay` and raises `min-height` by the same padding after
  every pass, so the height is the model total plus the intended scroll room at
  every scroll position. A gallery row's stamped last cell must also include
  its `margin-block-end` (the renderer's trailing gap before the next picture);
  without it every block after the gallery sits that much lower than the model.

- The scroll anchor must be able to survive its block being replaced. A render
  removes and re-creates the split blocks, so the captured element is often
  gone; `resolveAnchorElement` falls back to the block's text and original
  index. Restoring the raw offset in that case puts the reader at a position
  that no longer holds the content they were looking at.

- `state.width` must be sampled after the render window has been restored — or
  after it was deliberately held expanded for a full-render note. A widened
  window makes the document taller, adds a scrollbar and narrows the column;
  using a width the next pass will not see again makes that pass treat it as a
  resize and decorate the section a second time.
