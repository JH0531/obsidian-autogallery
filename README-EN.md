# AutoGallery

> **Language**: This document is the English version. The Chinese version is [README.md](README.md).
> Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese) · [CONTRIBUTING-EN.md](CONTRIBUTING-EN.md) (English)

## Purpose

AutoGallery is an Obsidian image-layout plugin. Its goal is to handle captions, automatic column widths, galleries, text wrapping and pagination in a unified way — without rewriting Markdown image references or breaking the ability to edit body text. It also ships a PDF export pipeline that lays out consistently with the reading view. It supports both the reading view and Live Preview, and keeps Obsidian's native image links editable and recoverable.

## Features

- `auto` is the global default route and takes effect without any YAML frontmatter.
- A single image gets its column width computed from its aspect ratio. The ratio is clamped to `[0.2, 5]` and then mapped onto `[0.2, 1]` through a piecewise power function. When the automatic width exceeds the float threshold, the image is centred at the computed width instead of falling back to the full column width; the default gain comes from `qLeft`/`qRight` in `src/config.json`.
- Automatically floated images get a boundary refinement after the aspect-ratio calculation, using the real image, caption and text line heights, to reduce the extra whitespace at the tail of the float area. A manual `ag:width` is never rewritten.
- Consecutive images are packed into a gallery. The maximum number of side-by-side images is 15 (default 5), with minimum and maximum row heights, an orphan-height limit and an image gap; the vertical gap inherits Obsidian's native paragraph margin.
- Gallery rows carry five handles: a bar under the row for its height, dividers between cells for column widths, buttons on each cell for swapping with a neighbour, buttons at the row's first/last cell for merging into the neighbouring row, and a link button in the corner that locks or releases the row. Every gesture rewrites frame ratios (`ag:crop`) or the row binding (`ag:group`) — never pixel geometry, and never `ag:rows` — and commits once on release as a single undo step.
- A single image can be centred automatically or floated left/right. A float is terminated by a heading, code block, math block, image, table, or quote/callout.
- Captions always stay inside the image cell and are aligned with it.
- `ag:exclude` hands the image entirely back to Obsidian's native rendering; `ag:isolate` removes an image from its gallery and cuts the grouping before and after it.
- The reading view supports frontmatter routing plus importable/exportable layout profiles. The built-in `auto` profile cannot be deleted, cannot be renamed, and is never overwritten by an import.
- The settings tab is split into Basics / Gallery / Width / PDF / Float cutoff / Profiles / Routes, with a sticky index that highlights the current section while scrolling. The last index cell opens a find row: typing matches settings immediately, Enter or the arrow keys step through the results, and a saved setting re-lays out both Live Preview and the reading view at once.
- Optional image cropping: without crop parameters the full image is shown. The crop frame is positioned by an aspect ratio together with normalised top-edge coordinates, so any rectangular region of the picture can be selected precisely.
- Live Preview uses Obsidian's native bottom-right resize handle to change the width, scaling proportionally and writing back `ag:width`; double-clicking the handle restores the automatic width. A resize pins the current alignment, so a centred image does not jump to one side when it becomes narrower.
- A constant arrow sits on the free side of an image; clicking it writes `ag:side`. A centred image shows one arrow on each side.
- The image action bar offers a "free crop" entry point: a full-image preview where each handle moves only the edge it points at, Shift locks the ratio, Alt scales symmetrically from the centre, and saving writes only annotation parameters.
- A dedicated PDF export pipeline: renders in the main Obsidian window at the real paper size, measures and paginates. Column widths, floats, galleries, heading pagination and orphan control all apply. It offers whole-page and paginated previews, margin presets, mirrored odd/even margins, and headers, footers and page numbers.

## Usage

### Image parameters

Parameters are written into the image description field:

```markdown
![Cover|ag:side=centre|ag:width=61%](assets/cover.jpg)
![Example|ag:layout=float|ag:side=right|ag:width=40%|ag:gap=12px](assets/example.png)
![Standalone image|ag:isolate](assets/one.png)
![Native image|ag:exclude](assets/native.png)
```

Supported parameters:

| Parameter | Values | Effect |
| --- | --- | --- |
| `ag:layout` | `auto`, `gallery`, `float`, `center` | Override the automatic layout |
| `ag:side` | `left`, `right`, `center`/`centre` | Set the direction; `center` never floats |
| `ag:width` | `10%`-`100%` | Set the width of the image or float cell; `100%` means full column, centred |
| `ag:gap` | `0`-`80px` | Gap between a floated image and the body text; it does not change gallery cell gaps (use the "gallery gap" setting) |
| `ag:crop` | `W:H` | Aspect ratio of the crop frame |
| `ag:top` | `x1:x2:y` (0-100) | Crop frame's top edge: left and right endpoints plus vertical position |
| `ag:exclude` | flag | Exclude the image from all plugin handling |
| `ag:isolate` | flag | Break the gallery grouping before and after |
| `ag:rows` | `3,2` | Hand-written row split: how many images each row holds from the group's first image; the rest is routed |
| `ag:group` | flag / positive integer | Lock a whole row together; the bare flag means `1`, and adjacent bound rows need different ids |

### Galleries

Adjacent image lines (with no body text in between) are laid out as one row. When an image row and its caption live in the same paragraph, the plugin first splits the paragraph into per-image blocks, then allocates cell widths from the row height and each image's ratio — so two images right after "Caption:" still end up side by side. The reading view registers these split blocks with Obsidian's virtual renderer, so scrolling does not jump because a block was removed as unknown content.

The row split and the row binding live in the source too. `ag:rows=3,2`, written on the group's first image, describes the opening rows: counts are consumed in order, the last one is truncated at the end of the group, and whatever follows is packed automatically — so `ag:rows=2,3` on six pictures is "two, three, one (routed)", `ag:rows=4,3,1` on six is "four, two (truncated)", and `ag:rows=2` on six is "two, then route four". The parameter can never lose a picture, and only a person writes it: no gesture injects it, and releasing a binding returns the group to automatic routing. A hand-written split deliberately skips the minimum height and is not bound by the maximum per row (that limit governs automatic packing only). `ag:group` binds consecutive images into one row: members share an id, adjacent bound rows need different ids, a bound row is never merged or split by the packer, and a run longer than the maximum per row falls back to packing. `ag:group` is written and cleared by the link button, and hand-editing works the same way.

At most two completely blank source lines may separate consecutive images within a gallery; a third blank line ends the current gallery. The first existing blank line after a gallery is kept as an editable `.cm-line` with its float cleared, so the following body text starts below the gallery. Ordinary text, a heading or any other structure also ends an image group. Captions belong in the image parameters — ordinary body text is never guessed to be a caption.

### Cropping

Cropping is off by default. `ag:crop` locks the frame's aspect ratio, and `ag:top` gives the position of the frame's top edge: `x1`, `x2` and `y` are normalised values in 0-100, where `x1`/`x2` are the left and right endpoints of the top edge (relative to the image width) and `y` is the top edge's height (relative to the image height). The top edge fixes the horizontal range and the vertical position, and the height follows from the ratio, so any rectangular region of the picture can be expressed.

```markdown
![[image.png|caption|ag:crop=16:9]]                  <!-- the largest frame of this ratio, centred -->
![[image.png|caption|ag:crop=24:17|ag:top=0:50:0]]   <!-- the top-left quarter -->
![[image.png|caption|ag:crop=1:1|ag:top=40:80:20]]   <!-- a square region right of centre -->
```

Hand-written parameters that are out of range are silently corrected: `x1`/`x2`/`y` beyond 0-100 are clamped, and reversed endpoints are swapped automatically. If, given the top edge's width and the remaining height, the ratio of `ag:crop` would push the bottom edge of the frame past the bottom of the image, the ratio is relaxed to the largest value that still fits; the top edge position and horizontal range stay as written. For example, `ag:crop=1:1|ag:top=0:100:50` on a 1:1 image renders at 2:1.

The crop ratio participates in column-width routing: the plugin recomputes the display width and the float decision from the ratio (not from the original image ratio), so cropping a wide image into a square narrows it automatically and re-decides whether text wraps around it. Rendering uses `object-view-box` (older engines fall back to `object-fit` plus `object-position`) together with `aspect-ratio`, and never adds `overflow: hidden` to an ancestor; cropping inside table cells works as well.

### Interaction

- **Resize**: dragging Obsidian's native bottom-right handle changes the width, and the height follows the original ratio (or the crop frame). On release the width is written to `ag:width`, one drag equals one undo step. Double-clicking the handle clears `ag:width` and returns to the automatic width.
- **Gallery handles**: hovering a gallery row reveals vertical dividers between pictures and a horizontal bar along the pictures' bottom edge. Dragging a divider rewrites the `ag:crop` of the two neighbouring cells; their ratio sum stays constant, so the row height and the rest of the row are untouched. Dragging the bar rescales the whole row and rewrites every cell's `ag:crop` for the new height, up to the "gallery max height" ceiling. The buttons on each cell's left and right swap the picture with its previous or next neighbour, or merge it into the neighbouring row when it sits at either end (the source line order is rewritten). The link button in the corner locks the row as `ag:group` and releases it again; a locked row is never split or merged by the packer. Every drag previews live, writes once on release as a single undo step, and Esc cancels back to the pre-drag geometry.
- **Alignment**: an arrow sits permanently on the free side of an image, vertically centred. A left-aligned image shows only `[>]` on its right, clicking it returns the image to the centre; a right-aligned image shows only `[<]` on its left, likewise returning to the centre; a centred image has one arrow on each side, clicking one moves it to the left or to the right. Switching writes `ag:side`, `ag:layout` and the current width as `ag:width` in the same transaction; later column changes then affect this image only.
- **Float conditions**: body text wraps only beside a left- or right-aligned image whose actual width ratio is at or below the "maximum float width". A centred image never floats, no matter how narrow it is; an explicit `ag:layout=float` or `ag:side` keeps floating and merely clamps the width to that threshold, while an `ag:width` on its own beyond the threshold degrades to centred.
- **Restore**: after "zoom / edit / crop" the image action bar also offers a restore button that clears the image's width, alignment, crop and gap parameters, returning it to automatic routing. The "restore default image style" command in the command palette resets every image in the current document, asks for confirmation first, and the whole reset takes a single undo step.
- **Free crop**: hover an image and click the crop icon in the action bar. The dialog always fits the original image size, the crop frame is confined within the image bounds and can be pulled to all four edges; the wheel zooms the canvas (editing view only, it does not change the crop result). The ratio dropdown remembers the last choice: if the last one was a free ratio it stays free, and if a preset was picked it stays locked to that preset; the "current ratio W:H" entry only appears while no preset is locked. A plain drag of a handle moves only the edge under the pointer (a corner moves its two adjacent edges), Shift scales by the current ratio, Alt scales symmetrically from the centre; dragging the image pans the framing. Saving writes `ag:crop` and `ag:top`. Clicking empty space, pressing Esc or cancelling closes the dialog, and unsaved changes trigger a confirmation first.

### Layout profiles and routing

In the reading view, frontmatter routing hands a note to a layout profile: routes are matched against frontmatter keys and values in list order, and an unmatched note falls back to `auto`; layout parameters written in an image's annotation take priority over the profile. A profile matches the image's aspect ratio against the ranges in `rules` and decides the image's width, layout and float direction. The settings tab can edit each profile's name and float direction; the built-in `auto` is always kept and cannot be renamed.

Profiles can be imported into or exported from the settings tab as JavaScript profile files (plain JSON works too). Exporting opens the system save dialog (it no longer forces a write into the Vault); the configuration only affects runtime layout and never modifies note sources.

**Scope and merge rules of import/export**: the configuration file contains only layout profiles (`profiles`). PDF and page-number settings, margins and paper, frontmatter routing, gallery and gap settings — none of the global parameters are included. An import updates in place: profiles with the same id are replaced, profiles not mentioned in the file stay as they are, and the built-in `auto` is never overwritten. If any single profile in the file is invalid, the whole import is rejected and nothing is written. The `id` may be omitted, in which case the plugin uses the file name; an empty `rules` array means `auto`.

### Gallery settings

"Gallery view control" in the settings tab can limit by the number of side-by-side images and the row height together, by the count alone, or by the height alone; the numeric inputs that do not participate are disabled. The gallery settings cover:

- Minimum height `0-200px` (default `100`) — the lowest a multi-image row may go;
- Maximum height `120-1200px` (default `600`) — the highest a multi-image row may go, and the ceiling the row's bottom bar can be dragged to; a taller row is scaled down as a whole and centred, never cropped;
- Orphan image max height `0-1200px` (default `400`, `0` disables the rule) — a lone image whose full-column height exceeds this leaves the gallery and takes the centred single-image layout; it applies to Live Preview and the reading view alike;
- Maximum images per row `2-15` (default `5`) and image gap `0-80px` (default `12`).

The vertical gallery gap inherits Obsidian's native paragraph margin, and every gallery item yields its own bottom margin so gaps do not stack across wrapper layers.

### Settings tab

The top of the settings tab is a sticky section index: Basics, Gallery, Width, PDF, Float cutoff, Profiles, Routes. Clicking a cell jumps to that section, and scrolling highlights the current one; the index keeps working when the pane narrows and the cells wrap.

The last cell of the index is Search: click it to open the find row, click again to close it. Typing matches a setting's name and description (a section heading is a target too, so "PDF" lands at the start of that section); matches get an outline and the jump zone shows "current / total". `Enter` or `↓` goes to the next match, `Shift+Enter` or `↑` to the previous one, wrapping at both ends, and the highlighted "Search" button on the right is the mouse equivalent of Enter. With no match the row shows "No results" and both the input and the jump zone turn to the error colour.

Idle, the row shows only the input and the "Search" button: the input runs all the way to the button across a single gap, and the button always occupies the width of the index's last cell, aligned with the cell above. As soon as a query has results, the jump zone opens to the left of the button while the input gives up exactly that width, and clearing the query plays the same motion backwards. The button never moves or changes width.

Saving a setting re-lays out immediately: both Live Preview and the reading view drop the cached layout and recompute, with no scrolling, reopening or plugin reload needed.

Every numeric setting shares one input width: the number is right-aligned and its unit (`px`, `mm`, `%`, `s`, img) is pinned inside the box on the right. Dropdowns and the inputs inside the Profiles and Routes tables are excluded from this rule.

### PDF export

Export the current note with the "Export PDF (AutoGallery)" command or from the file context menu. The export renders the body into a temporary `.print` container inside the main window, derives the layoutable width and height from the final print parameters, waits for images and fonts to be ready, then runs the same layout and pagination as the reading view before producing the PDF through Obsidian's print channel.

Obsidian's native export is not used for this: it renders in a hidden popup whose viewport is zero before print layout, so every geometry-based pagination decision degenerates. The plugin still intercepts the native export (the "also apply in Obsidian's native PDF export" setting) as a fallback, but that fallback only guarantees CSS-level layout results.

The export window offers two previews: "whole-page preview" shows the reading-view layout continuously, while "paginated preview" shows real print pagination, so changes to page numbers, margins and heading pagination can be checked immediately. The settings tab configures the default preview mode.

The settings tab and the export window can override paper, orientation, margins, scale, heading pagination and the timeout; choosing "follow Obsidian" reads the native export settings. Margins directly determine the usable content width and can follow Obsidian, use a preset (none / narrow / medium / wide, matching the Word presets) or take custom millimetre values; the preset and custom modes can enable mirrored margins for odd and even pages (inner and outer set separately, with the inner margin on the left for odd pages and on the right for even pages). The export result is checked with a file header. A failure while preparing the preview falls back to the native export automatically; a print timeout or an invalid artefact keeps the dialog open and offers a "use Obsidian's native export" button that must be confirmed manually.

Page numbers are on by default and can be turned off; the position is either header or footer, and the alignment is left, centre or right. Page numbers are generated by Chromium's print header/footer template during real printing and show "current page / total pages". They follow the rendering view's font and appear only in the paginated preview and in the export result — they are never written into the note.

A gallery row never splits: the whole row stays on this page or moves to the next; when it must fit, every cell shrinks by the same factor with column widths unchanged, and past the cap the row moves whole. When an image does not fit at the end of a page, the plugin computes the difference between the bottom edge of the target image (including its caption) and the bottom of the previous page, and shrinks only that image to the smallest ratio that makes it sit flush against the bottom. Other images on the page are not affected and no extra page break is inserted. The shrink limit is configurable in the settings tab; beyond the limit the image keeps its original size and stays on the next page, so it is never left "half shrunk". Body text sharing a paragraph with an image is split into an independent block, so once the image sits flush at the bottom the text naturally continues on the next page. Heading pagination changes made inside the export window apply to that export only and inherit the settings tab's switches and level by default.

## Implementation notes

The reading view observes Obsidian's generated Markdown sections through `registerMarkdownPostProcessor` and only modifies the styles and captions of existing blocks — it never moves body nodes. Each section records its source file path, so switching files in the same tab cleans up the old layout. The section pauses its MutationObserver during cleanup and rearrangement to avoid recursive rendering.

A reading section is taken over by the connected top-level `.markdown-preview-section` element. File opening, active leaf/tab changes, view layout changes, settings writes and plugin reloads all trigger a refresh; a refresh releases the old section's cleanup functions and resets the alternating float index so that images, parameters and direction sequences are never inherited across files. The Markdown postprocessor only schedules a refresh and never handles paragraphs that may still be detached.

A refresh preserves the reading view's scroll anchor. If the reader was at the bottom of the content before the refresh, the view is repositioned to the new bottom in one step once the new layout frame completes, so image loading or layout recalculation never pushes the view up or causes a slight bounce.

Live Preview uses CodeMirror 6's `StateField`, `ViewPlugin` and line decorations. Image lines keep their native `.cm-line`, and ordinary text lines never receive image width styles. A single image reuses the reading view's ratio routing, float threshold and profile alignment; beyond the float threshold it is centred at the computed width. Galleries are grouped by document line position, allowing CodeMirror widget buffers and blank lines in between; the layout is recomputed only once every image in the group has loaded, and the previous frame is kept during loading to prevent flicker. Layout styles are applied through a single decoration transaction, and `EditorView.requestMeasure()` is called after a geometry change to update the coordinate mapping; effects are cleared when the view leaves the viewport or the file changes. The plugin only takes over the editor in Obsidian's Live Preview mode; Source mode restores native images and source layout.

Live Preview's caption widget clears the default vertical placeholder of the image embed and the widget buffer, keeping only the "image-to-caption gap". The caption uses the image cell's actual width, and gallery cells do not add the image gap to the caption width.

An intercepted image line hides Obsidian's inline `img.cm-widgetBuffer` placeholder that it uses for source editing. That node takes no part in the image size calculation, but its native inline box otherwise creates extra vertical whitespace; hiding the placeholder removes neither the real image nor source editing.

Live Preview's image action bar (`.embed-actions`) is anchored to a single image embed and fixed to the right edge of that image's column width, instead of being positioned relative to the whole editor line. The native `.image-wrapper` fills the computed image cell so the inline-flex box cannot recompute the column width. Table images have no native Obsidian action bar, so the plugin adds the same top-right bar (crop / exclude / restore) for visible table images; while a cell is being edited only the source line is shown, and the image preview does not cover the reference line being edited.

When Live Preview computes a column width it prefers the width of the currently rendered line and its `.cm-content`, because a virtualised editor's `contentDOM.clientWidth=1` turns a percentage width into a sub-pixel value.

Gallery rows use the following formula to distribute widths by original aspect ratio:

```text
rowHeight = (containerWidth - gap * (count - 1)) / sum(aspectRatios)
imageWidth = rowHeight * aspectRatio
```

The find row in the settings tab does not copy the index grid: it writes the measured width of the index's last cell into `--ag-nav-cell`. The search button uses that width and shares the index's right edge, the input takes the rest while idle, and the jump zone animates from `0` to that width while the input absorbs the difference through flex — so opening and closing never push the button. A `ResizeObserver` re-measures when the index changes size.

The default parameters for a single image's column width live in `src/config.json`: centre ratio `1.5`, left exponent `2.0`, right exponent `1.5`, output range `[0.2, 1]`. The settings tab's "column width gain" and "median ratio" override these defaults.

## Development and deployment

```powershell
npm install
npm run build
```

The build writes `main.js` to the repository root. Copy `main.js` and `manifest.json` into the target Vault's `.obsidian/plugins/obsidian-autogallery/`, then reload the plugin. The repository has no test script (`npm test` fails with `Missing script: "test"`); use `npm run build` and `git diff --check` as the static checks and verify at runtime in a real Vault.

Verify at runtime with the Obsidian CLI:

```powershell
obsidian vault=test plugin:reload id=obsidian-autogallery
obsidian vault=test dev:errors
obsidian vault=test dev:dom selector='.ag-caption' total
obsidian vault=test dev:dom selector='.cm-line.ag-cm-gallery-line' total
```

After the plugin is disabled, Obsidian renders image links natively again; the plugin's runtime styles and captions are cleaned up.

For the full development workflow, code conventions, architectural constraints and the pull request checklist, see [CONTRIBUTING-EN.md](CONTRIBUTING-EN.md) (English) or [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese).

## Credits

The following projects inspired the approach:

- [Adjustable Media](https://github.com/Yi-luo-hua/obsidian-adjustable-media) — ideas around layout blocks and media typesetting.
- [Better Export PDF](https://github.com/l1xnan/obsidian-better-export-pdf) — PDF export preview, headers and footers, and page-number templates.

## License

This project is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later). See [LICENSE](LICENSE) for the full terms.
