---
chapter: 5
order: 17
role: demo
tags: [autogallery, pdf]
---

# PDF Export Dialog

> Run "Export PDF (AutoGallery)" from the command palette: page size and margins on the left, real layout on the right; one write to disk once you confirm.

![Fjord](assets/photo/01-fjord.jpg)
![Valley](assets/photo/03-valley.jpg)

What gets exported is a **re-layout for the paper size**, not a screen capture stuffed into A4. So gallery rows, float wrapping and caption widths are all recomputed for the text-block width.

## Two previews

| Mode | Behaviour | Use |
| --- | --- | --- |
| Layout preview (default) | One continuous long page, scaled to the real paper width | Quickly check font size, column width, captions |
| Paginated preview | Really prints a temporary PDF, then renders it page by page | Confirm page boundaries, orphans, cross-page behaviour |

Layout preview **does not paginate**: you see one continuous run of content. To judge "will this row be split across two pages", you must switch to paginated preview. Paginated preview waits for an actual print to finish, so long documents are noticeably slower.

## What you can adjust

| Item | Values |
| --- | --- |
| Paper | Follow Obsidian / A3 / A4 / A5 / Legal / Letter / Tabloid, portrait or landscape |
| Margins | Follow / None / Narrow (12.7mm) / Moderate / Wide / Custom per side |
| Mirror odd/even pages | Different inner and outer margins; on odd pages the inner side is on the left |
| Scale | 10%–200%, blank follows the default |
| Include note title | Inserts the note name before the body |
| Page numbers | On / off, header or footer, left / centre / right |
| Heading pagination | Which heading level starts a new page |
| Image pagination optimisation | Shrink a lone image at the page end to sit flush, or carry the whole image to the next page |
| Orphan control | When only a few lines are left on the last page, pull them back to the previous page |

Page numbers consume margin: with numbers in the footer, leave at least 11mm of bottom margin, otherwise they get clipped.

If the export fails, the plugin falls back to Obsidian's native export and closes this dialog first, so two save dialogs never appear at the same time.

## Related

- Pagination details: [[18-pdf-pagination]]
- Where print styles differ from on-screen layout: [[07-width-routing]]

---

Previous · [[16-routing]] ｜ [[README|Contents]] ｜ Next · [[18-pdf-pagination]]
