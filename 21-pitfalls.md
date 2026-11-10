---
chapter: 6
order: 21
role: appendix
tags: [autogallery, faq]
---

# Common misreadings

> Sixteen "looks like a bug, actually by design" conclusions. Look up your symptom in the table; the second column is the correct approach.

| # | Symptom | Correct approach |
| --- | --- | --- |
| 1 | Set `ag:gap`, but the spacing between gallery cells didn't change | `ag:gap` only changes the gap between a floated image and the body text; gallery spacing is `galleryGap` on the settings page |
| 2 | Wrote `ag:width` on one image inside a gallery and nothing happened | Two or more consecutive images always form a gallery, so per-image `layout` / `width` / `side` are ignored; for single-image control add `ag:isolate` first or break the run with body text |
| 3 | An image sits alone on a line but still fills the whole column | A single-image row is still a gallery cell and spans the column width; write `ag:width` to narrow it, or rely on the orphan rule |
| 4 | Wrote `ag:top` and it vanished after one parameter change | `ag:top` must coexist with `ag:crop`; without crop, a rewrite drops it |
| 5 | `ag:width` inside a table has no effect | Table cells only honor `ag:crop` and `ag:exclude`; width is decided by the table |
| 6 | Two images in a callout don't sit side by side | Callouts are claimed but not decorated, keeping Obsidian's native styling |
| 7 | Two adjacent images in a list don't form a row | They belong to different list items; side-by-side only happens within the same `li` |
| 8 | In Live Preview, text doesn't wrap around the image | Live Preview doesn't do body-text wrapping; check wrapping in Reading view |
| 9 | Many blank lines between two images, yet they're still side by side | The blank-line limit is 2; the 3rd blank line is what breaks the run. Blank lines are invisible in Reading view, which makes this easy to misjudge |
| 10 | Raised the orphan limit to 1200 and portrait images still jump out | The test is the rendered full-column height, not the original pixel height of the image |
| 11 | `ag:width=95%` works, but you worry about a 90% cap | The valid range is 10%–100%; `100%` means full column, centered, and the parameter is still kept |
| 12 | Wrote `min(0.6, r)` in a template and the rule didn't apply | Expressions only allow `Math.*`; write `Math.min(0.6, r)`. Invalid rules are silently dropped |
| 13 | Wrote `album: Trip` in frontmatter and routing doesn't hit | Routing is an exact string comparison, `Trip` ≠ `trip`; keep keys and values lowercase |
| 14 | Rows specified by `ag:rows` ignore the minimum row height | Hand-written splits deliberately skip `galleryMinHeight`, because the split you wrote is the split you get |
| 15 | A whole gallery row was split across two pages in the PDF | It never splits; if you see a "split", it's usually two gallery rows misread as one—check blank lines and body text |
| 16 | Switching to "Layout preview" shows no pagination | Layout preview is a continuous long page with no pagination; to see page boundaries, switch to "Pagination preview" (which really prints) |

## Two more

- **The settings page can't create templates or edit rules**: it only imports, exports, deletes, and changes names and float side. Rules must be written by importing a `.json` file.
- **Gallery cells have no resize handle in the bottom-right corner**: cell width is decided by the whole row; to change column width, drag the divider between two cells.

## Related

- Full parameter table: [[10-parameter-reference]]
- Gallery grouping: [[03-grouping]]
- Template expressions: [[14-layout-templates]]

---

Previous · [[20-commands-and-undo]] ｜ [[README|Contents]] ｜ Next · [[README|Contents]]
