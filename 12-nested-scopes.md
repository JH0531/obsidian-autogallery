---
chapter: 3
order: 12
role: demo
tags: [autogallery, nested]
---

# Nested scopes

> An image belongs only to the nearest container around it: a list item, a table cell, a callout, and only then the body text. Different containers mean different things the plugin can do.

## Lists: side by side within an item, never across items

- Two images in the same item can sit side by side:
  ![](assets/ratio/ratio-3x2.svg)
  ![](assets/ratio/ratio-1x1.svg)
- A new item is a new row:
  ![](assets/ratio/ratio-4x3.svg)

Single images in a list are left-aligned and laid out as blocks by default; they do not float, and no gallery handles are offered — bullets make the boundary of a "row" ambiguous. Images in different items are never placed side by side, even when they are adjacent in the source.

## Tables: crop and exclude only

| Cell contents | Result |
| --- | --- |
| ![[05-falls.jpg\|Waterfall square\|ag:crop=1:1]] | Applies the crop only; width is still decided by the table |
| ![[03-valley.jpg\|Valley\|ag:exclude]] | Handed entirely to Obsidian |
| Hand-written `ag:width` / `ag:side` | No effect |

Pipes inside a table must be written as `\|`, otherwise the parameters become part of the caption. The plugin's crop uses `object-view-box`; older engines fall back to `object-fit`.

## Callouts: claimed, not decorated

Images inside a callout keep Obsidian's native styling: no side-by-side rows, no caption, no handles at all.

The reason is simple — in Live Preview a callout is not an editable block, so geometry the plugin wrote into it could not be adjusted by the reader; the plugin therefore chooses not to take it over at all. Writing `ag:` parameters inside a callout has no effect and raises no error; it is the only place in this plugin where parameters are silently ignored.

## Capability matrix

| Container | Width/float | Gallery | Crop | Handles |
| --- | --- | --- | --- | --- |
| Body text | Yes | Yes | Yes | Yes |
| List item | Block layout, width allowed | Side by side within an item | Yes | No |
| Table cell | No | No | Yes | Live Preview action buttons only |
| Callout | No | No | No | No |

## Related

- Gallery rules: [[03-grouping]]
- Crop parameters: [[11-cropping]]

---

Previous · [[11-cropping]] | [[README|Contents]] | Next · [[13-dialog-and-reset]]
