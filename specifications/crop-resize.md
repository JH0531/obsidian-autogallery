# Cropping, Drag Resize and Alignment Controls

Optional cropping (`ag:crop` / `ag:top`), the crop dialog
(`src/crop-modal.js`, `src/crop-geometry.js`), width drag resize
(`src/editor-resize.js`), alignment arrows and the action bar contents.

Read this before changing crop geometry, the crop modal, the resize gesture or
the alignment controls.

- Cropping is opt-in at one level only: `ag:crop=W:H` plus `ag:top=x1:x2:y`.
  There is no fill switch; the fill mode follows from the crop region. Never
  crop without an explicit `ag:crop`.
- A crop is a source rectangle, not a maximal frame slid inside the picture. Both
  views paint it with `object-view-box` built from `crop-geometry.js`; the frame
  ratio then equals the box ratio, so `object-fit` decides nothing and must not
  be toggled per image. The insets are pixels of the natural size, which is the
  reference box the spec resolves against.
- `object-view-box` needs Chromium 104+. Keep the cover/`object-position`
  fallback for older builds; it approximates a free region from its centre.
- The effective ratio is `max(declared, topWidth / availableHeight)`: a
  hand-written crop that would overflow the picture below its top edge is
  widened, never clipped, and the top edge stays exactly where it was written.
  Every consumer (routing, packing, box ratio, table height) must use
  `effectiveCropRatio`, not `crop.w / crop.h`.
- The crop dialog must never scroll. The wheel over the crop stage is the zoom
  gesture, so a dialog taller than the viewport can only be scrolled through
  the few pixels outside the stage, and the save/cancel row becomes
  unreachable. Both the stylesheet and `initLayout` derive the stage height
  from the same budget (`STAGE_MAX_HEIGHT` against
  `88vh - STAGE_CHROME_HEIGHT`), and `initLayout`'s inline height must stay
  inside that budget rather than reinstating a larger cap of its own.
- Drag resize writes the markdown line once on pointer-up through
  `updateImageAnnotation`. Dragging only updates `--ag-embed-width` on the
  embed. `editor-extension.js` must early-return from `sync()` while
  `.ag-resizing` is present, or the decoration pass overwrites the live preview.
- A width drag also paints the **caption** width. The caption is a widget in
  the line, not a child of the embed, so the `--ag-embed-width` written on the
  embed never reaches it and the caption stayed at the committed column while
  the picture moved. `applyCaptionWidth` writes the live pixel width on the
  caption and its widget host for the duration of the drag;
  `resetCaptionWidth` restores the `var(--ag-embed-width, 100%)` form on cancel,
  and the next layout pass rewrites it after a commit.
- Width resize is owned by Obsidian's native `.image-resize-corner`. Intercept
  its `pointerdown` and `dblclick` in the capture phase on the editor root and
  stop propagation: the built-in handler rewrites the whole image link on
  release and can destroy `ag:` parameters. Double click clears `ag:width`.
- A width commit must pin the alignment that is currently rendered: write
  `ag:layout=center` for a centered image and `ag:side` plus `ag:layout=float`
  for a floated one. Without that the auto router re-floats a narrower centered
  image. A **list picture** is aligned as a block and never floats, so its drag
  records `ag:side` (or `ag:layout=center`) and must not write
  `ag:layout=float`: reading `getComputedStyle(embed).float` there always yields
  `none` and would silently centre the picture.
- Gallery lines never receive a width gesture. Their native corner is blocked
  but ignored, because a manual width would break the packed row.
- Alignment arrows follow the alignment the picture is actually drawn with: a
  left (or left-floated) image shows only the arrow back to the centre, a right
  one the same on its side, a centred image both edges. A list picture never
  floats, so its state comes from `ag:layout=center`/`ag:side`, not from
  `float`; reading `float` made every list picture look centred and offered the
  arrow towards the side it already sat on.
- Width and alignment are independent. Every image without `ag:width` or a
  profile width gets the piecewise automatic width, including
  `ag:layout=center`; centering must never fall back to 100% just because the
  image is not floating.
- Text may wrap only beside a left/right aligned image whose displayed width
  ratio is at or below `floatMax` — but only for widths the plugin computes.
  Manual parameters outrank routing: an explicit `ag:width` together with
  `ag:side`/`ag:layout=float` floats at exactly that width, whatever it is, and
  a width committed by a drag or an arrow click must never be recomputed on the
  next pass. `floatMax` caps an explicit float that has no stored width (the
  image floats at the cap instead of degrading to centered), and it still
  decides plain automatic routing. Alignment arrows never clamp or rewrite an
  existing width.
- An alignment arrow on an image that has no `ag:width` must record the width
  currently on screen as `ag:width` in the same transaction. Without that, each
  alignment recomputes its own automatic width (centred vs floated) and the
  picture changes size every time the reader switches sides, with nothing in
  the note explaining why. The recorded value is a manual parameter, so it then
  outranks routing like any other hand-set width.
- `ag:width` accepts 10–100%. A full-bleed image (100%, or any width that
  reaches the column) always renders centred, whatever `ag:side` says, and the
  alignment arrows are not drawn at all — every side would render identically.
  The stored alignment must survive: narrowing the image later applies it again.
- Inset alignment arrows (the ones drawn inside the picture because the gutter
  is gone) are hover-only: reveal them while the pointer is over the image or
  the control has focus, hide them otherwise. External arrows stay visible.
  A float the reader widened past `ALIGN_INSET_RATIO` uses the inset form even
  though it shows a single arrow. A revealed inset arrow must reuse the
  top-right embed action bar's surface: the primary background at 80% with the
  same backdrop blur, radius and shadow. A fully opaque
  `--background-primary` turns into a black block on the artwork, while
  lowering the element opacity lets the picture show through the icon.
- Routing uses the ratio the reader sees: `cropAspectRatio(crop)` must replace
  the natural ratio in every `calculateFloatLayout` call, so cropping re-routes
  the width and the float decision.
- Per-image "reset" clears every layout annotation but keeps the caption.
  The document command must reset all image lines in one
  `editor.transaction({ changes })`. Obsidian's wrapper expects
  `{ from: {line, ch}, to: {line, ch}, text }`; offsets or `insert` throw.
- Alignment arrows and the crop button are re-checked on every layout pass and
  hide when their settings are disabled.
- `ag:top=x1:x2:y` is the crop frame's top edge in percent of the image's own
  width and height. Values are clamped to 0-100 and the endpoints are ordered,
  so a hand-written edge never escapes the bitmap. `cropRegion` /
  `viewBoxValue` / `regionToTop` in `crop-geometry.js` are the single geometry
  source shared by the crop modal and all renderers.
- The crop modal is display-only. It must never write the image file, never add
  `overflow: hidden` to an ancestor, and must confirm before discarding unsaved
  changes. Its action button is injected into `.embed-actions` idempotently and
  re-checked on every layout pass.
- The bar reads zoom, edit, crop, isolate, exclude, reset. Isolate is offered
  only for a gallery member or an image that already carries `ag:isolate`;
  exclude is never offered inside a gallery. Crop is offered everywhere the
  image is not excluded, including gallery cells: cropping changes the ratio
  the row is packed from, so the row re-flows. Reset stays out of the gallery —
  a cell has no layout of its own, and the crop dialog's own "清除剪裁" is the
  undo path. While `ag:exclude` is set every
  layout control disappears except the exclude toggle, so the release stays
  reversible; the other parameters remain in the note but are ignored. Reset
  clears `isolate`/`exclude` too, otherwise it would be a no-op on a released
  image.
- These buttons inherit `clickable-icon`, whose colour is the muted text
  colour. Force `color: var(--text-normal)` so crop/exclude/reset match the
  native zoom and edit icons, and use `--text-accent` for an active
  isolate/exclude.
- `setIcon` renders nothing for a glyph this Obsidian build does not ship, and
  the failure is silent: the button becomes a blank square. Register the icons
  the UI depends on with `addIcon` at load time (`src/icons.js`) and keep the
  fallback list (`link-2-off` → `unlink` → `unlink-2`) for hosts without an
  icon registry; assert the generated `<svg>` has children before treating the
  icon as applied.
- A registered icon is drawn in a `0 0 100 100` view box, while Obsidian's own
  Lucide icons keep their native `0 0 24 24`. Lucide markup therefore has to be
  wrapped in `<g transform="scale(100/24)">`; registered as-is it occupies a
  ~20×20 corner of the box and reads as a blank button even though the SVG has
  children. Check the rendered `getBBox`, not the child count, when verifying.
- `addIcon` only writes `viewBox` and `class` onto the generated `<svg>`. Built-in
  icons carry `fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"`, so registered markup must
  repeat them (on the wrapping `<g>`) or every path inherits
  `fill: black; stroke: none` and the icon renders as a solid blob.
- The crop modal shows the whole image (`contain`, fitted to the stage). The
  frame owns its own x/y and never recentres on its own: an ordinary drag moves
  only the edge under the pointer (a corner moves its two adjacent edges), Alt
  moves both opposite edges around the centre, and Shift scales with the ratio
  the gesture started from. The frame must be able to reach the image edges
  exactly, so clamp to the image rect only, never to a fraction of the stage.
- The ratio dropdown remembers the last choice (`settings.cropRatioPreset`)
  across modals and restarts. Order: free, an optional "current W:H" entry
  (only while the remembered choice is free/current and the saved ratio is not
  a preset), then the presets. A remembered preset must stay selected even when
  the image currently carries another ratio.
- The ratio dropdown must reflect the ratio actually in force. When an existing
  `ag:crop` matches no preset, add a "current" option; selecting "free" must
  really unlock the frame.
- The modal initialises after the stage has a real size. Use a
  `ResizeObserver` (plus a timer backstop): the first frame frequently reports
  a zero-sized stage and a one-shot initialiser leaves a 2px frame.
- Wheel zoom is display-only: scale the image and the frame together around the
  stage centre, never mutate the stored crop geometry, and divide pointer
  deltas by the zoom factor.

## Crop policy for gallery drags

- A gallery drag changes a cell's frame ratio, so it has to choose a new source
  rectangle. The rule, implemented once in `src/gallery-geometry.js`:
  grow the frame into the unused part of the picture before taking anything
  away. A narrower frame keeps its width and grows vertically, centred; once one
  edge reaches the picture border the frame keeps growing from the other edge;
  only when it spans the full height does the width shrink, symmetrically. A
  wider frame applies the same two steps to the other axis. An uncropped picture
  starts from the full frame, so it immediately crops on the axis it must lose.

- Write the frame back with `ag:top` rounded *outwards* and derive `ag:crop`
  from the rounded rectangle. `effectiveCropRatio` widens a ratio whose frame
  does not fit below its top edge; rounding inwards would trigger that and the
  cell would render wider than the drag asked for.

- A frame that covers the whole picture is written as `crop: null`, not as
  `ag:crop` equal to the natural ratio. Dragging a cell back to its own shape
  must release the annotation instead of pinning it.

- Per-cell reset clears `crop` and, for the run's first line, `ag:rows`. The
  split was written for the ratios the run had; keeping it after releasing
  those ratios leaves the run in a grid nothing describes.

## Horizontal shrinking (forced merge)

- A bound row that gains a picture cannot push one out, so the row must reach
  `galleryMinHeight` by cropping instead. This uses a third strategy:
  `cropShrinkWidth` keeps the frame's vertical extent and centre and multiplies
  its width by a factor. It is the only strategy that is asked for by width
  rather than by ratio.
- The factor is shared: with `S` the sum of the existing ratios, `r_in` the
  incoming one and `A` the available width, `kappa = 1 - (A / minHeight - r_in) / S`.
  Every existing frame becomes `(1 - kappa) r_i`, so a wide picture gives up more
  pixels than a narrow one at the same proportional cost. The incoming picture
  keeps its ratio, which is what makes the widths sum back to `A`.
- `kappa` is clamped by `config.gallery.mergeMaxCrop` and by the smallest cell
  width the grammar can express. Whatever the clamp withholds is taken from the
  incoming picture instead; if that would reduce it below the minimum, the merge
  is refused rather than producing a sliver.
- The same rebalance runs when a bound row's picture is re-cropped later
  (`applyCropToLine`). It is deliberately hooked to the write, not to render or
  to a document listener, so it cannot oscillate with the layout pass.

- A drag preview must never write its crop onto the `<img>`. The properties
  (`--ag-img-view-box`, `-fit`, `-aspect`, `-height`) are published on the
  **line** and inherited by the bitmap. An inline copy on the image is
  `!important`, survives the decoration's republish, and pins the picture to the
  last dragged crop: after a row-height drag, resetting a cell then leaves the
  picture at the dragged size while the row shrinks - the overlap / gap the
  reader sees as "the view did not refresh". `clearImagePaint` removes copies an
  older build left behind.

- Every gallery preview write is idempotent (`setIfChanged`). The repair
  observer described in `live-preview.md` re-runs the paint on any style
  mutation; an unconditional write would re-notify it and the two would loop.
