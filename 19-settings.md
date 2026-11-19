---
chapter: 6
order: 19
role: demo
tags: [autogallery, settings]
---

# Settings Page Tour

> The settings page has seven sections; the table of contents stays pinned to the top and highlights as you scroll. The last cell is search: type to jump, and the layout reflows the moment you change a value.

![Square image](assets/photo/06-cloud.jpg)

This image changes with the settings: move "Width gain" from 50 to 70 and the single image gets wider overall. Every setting takes effect immediately; no need to reopen the note.

## The seven sections

| Section | Contains |
| --- | --- |
| Basic settings | Caption spacing, image bottom margin, body-to-image spacing, mobile breakpoint |
| Gallery | Maximum images per row, minimum row height, maximum row height, orphan limit, gallery gap, view control mode |
| Column width | Column width gain, median ratio, maximum effective width for floats, drag-to-resize toggle, alignment arrow toggle |
| PDF export | Paper, margins, scale, page numbers, heading pagination, image pagination optimisation, orphan control |
| Float cut-off | Six structure types: headings, code blocks, math blocks, images, tables, quotes |
| Configuration management | Template list, import/export, sample profile notes |
| Routing | Key, value, template, with move up and move down; the enabled state is a data-layer field only, with no toggle in the UI |

## Contents and search

The table of contents is fixed at the top and highlights the current section as you scroll. Click the search icon in the last cell to expand the find bar: after you type a keyword the matches get an outline, and "current / total" shows on the right; `Enter` jumps to the next one, `Shift+Enter` goes back to the previous one. When nothing matches it shows "No results" and switches to the error colour.

Section headings count as matches themselves, so searching "gallery" first lands on the whole section, not on a single row.

## Numeric fields

All numeric settings share one appearance: a fixed-width input, right-aligned numbers, and the unit inside the box (px / mm / % / images). The ↺ on the right restores that one item to its default; it affects only that item and does not reset the whole section.

Dropdowns and the inputs in the template table do not follow this rule — they need more available width.

## Language

Language has three states: follow Obsidian, Chinese, English. When "follow" is selected, interface languages other than Chinese or English fall back to English. After switching, the whole settings page and the command wording update immediately; no restart is needed.

## Related

- Templates and rules: [[14-layout-templates]]
- Routing: [[16-routing]]

---

Previous · [[18-pdf-pagination]] ｜ [[README|Contents]] ｜ Next · [[20-commands-and-undo]]
