# Nested Scope Rules

Layout ownership for images nested in a callout, a list item or a table cell,
plus the `ag:` parameter parsing that only applies inside table rows.

Read this before changing `SCOPE_SELECTOR`, `readImageBlock`,
`renderNestedScopes` or the table-cell branches of the editor extension.

Nested container rules (callout / list / table):

- An image belongs to exactly one layout scope: the nearest ancestor among
  `td/th`, `li`, `.callout`, otherwise the section. `readImageBlock` must filter
  by that owner, or a whole callout is packed as one gallery cell and shrinks to
  a few hundred pixels. `renderNestedScopes` decorates each scope after the
  section pass; the ownership test makes the order irrelevant.
- A **callout is claimed but never decorated**. Obsidian renders a callout as an
  opaque block in Live Preview, so any geometry the plugin wrote inside one
  could not be edited back. `.callout` is in `SCOPE_SELECTOR` only to stop its
  pictures from falling through to the section pass; `renderNestedScopes` skips
  every scope inside a callout (including nested lists and tables) and
  `renderFlow` marks the callout block `data-ag-skip`. Live Preview mirrors
  this: `syncControls`, `syncTableImageActions` and `decorateTableImages` skip
  anything under `.callout`.
- List items never join a gallery with a neighbour, whatever the blank lines
  say: the marker column makes a cross-item row unreadable. Inside one item,
  images that share a paragraph (the source used a line break) are a gallery
  with `cellOnEmbed`, so the `li` stays a list item and only the embeds become
  cells; width is the item's content box, which already excludes the marker.
  A single image is routed against that same width and defaults to the **left**
  block axis (`alignAsBlock`). It must not float: a float is not contained by
  `display: list-item`, so the picture overflows into the next item's box.
  `ag:side`/`ag:layout=center` still choose the axis, they just never wrap.
- A table cell never receives a plugin width or alignment. The cell already
  decides how much room a picture has, and an inline `width: 100% !important`
  there fights Obsidian's own sizing: the picture rescaled whenever the cell
  reflowed (hover, selection), which is what made table images collapse. Only
  `ag:crop` and `ag:exclude` apply; the crop sets a height derived from the
  width Obsidian chose and leaves that width untouched. No captions in cells.
- Live Preview renders a table as a widget and, when a cell is being edited, as
  a nested CodeMirror instance whose `.cm-line` is *not* a document line. The
  editor extension must skip its whole layout pass inside
  `.table-cell-wrapper`; otherwise the image takes `width: 100%` of a
  shrink-to-fit cell, which collapses the column to a thumbnail. The base theme
  resets those line rules inside a table cell, and `decorateTableImages`
  publishes the crop directly on the `<img>` as inline `!important` styles: the
  largest box of the crop ratio that fits the bitmap, plus `object-view-box`.
  Those inline declarations are what override the reset.
- Obsidian does not create an `.embed-actions` bar for MarkdownRenderer table
  images. `syncTableImageActions` creates one and drives it from the table's
  source row: `posAtDOM(table)` gives the header line, the separator adds one,
  and the embed's `<tr>` index selects the row. Only a visible embed may own a
  bar — a cell editor keeps a hidden rendered copy, and a bar there would leave
  the visible picture without controls. `resolveActionTarget` must resolve a
  table embed through `tableImageTarget` before consulting `.cm-line`: the cell
  editor's line belongs to a nested document, so `posAtDOM` on the outer view
  is the only correct anchor.
- While a table cell is edited, the image embed must be `display: block` with
  `vertical-align: top`. A tall inline-flex box on a 24px source line sits on
  the baseline and grows upwards over the line being edited, which is what
  covered the code line. The reveal tooltip and gap are hidden inside a table
  cell (the nested editor runs no reveal layout), and `decorateTableImages`
  calls `view.requestMeasure()` because the picture's box changes the cached
  line height.
- A block that owns a nested scope is marked `data-ag-skip` so the staleness
  check does not schedule a render for a block it deliberately leaves alone.
- `ag:exclude` on its own keeps its paragraph intact. When it shares the
  paragraph with routed images the block is still decorated for the routed
  references; the excluded one keeps its native embed and the block itself is
  never restructured in the reading view.
- `![[image|ag:crop=16:9]]` is a parameter list without a caption. The parser
  must treat a first field that starts with `ag:` as parameters, because a
  Markdown table escapes the pipe and the alias arrives as the whole value.
- Inside a Markdown table every pipe in an image alias is written as `\|`.
  `extractImageAnnotation` and `replaceImageAnnotation` must unescape the
  separators, parse/format the logical alias, and re-escape the result; a raw
  `split("|")` sees `\|` as a literal and glues every parameter into the
  caption. `parseImageAnnotation` handles a cell alt that starts with `\|` the
  same way. Only table rows (`^\s*\|`) take this path: a plain caption may
  legitimately contain an escaped pipe.
