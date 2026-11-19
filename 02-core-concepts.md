---
chapter: 0
order: 2
role: demo
tags: [autogallery, concepts]
---

# Five core concepts

> Every behaviour of the plugin follows from these five rules. Once you have them, you can answer most "why didn't it take effect?" questions yourself.

## Grouping reads the source, not the screen

The plugin reads **the lines the images occupy in the source text**, not the rendered DOM. So scrolling, zooming or switching views never changes who belongs to which group.

Reading view collapses blank lines, so the gaps on screen all look the same; but 0, 1 or 2 blank lines are three different things in the source, and the third form is already the limit. Count blank lines when judging grouping, don't rely on visual whitespace.

## Two or more consecutive images are always a gallery

As soon as a group holds two or more images, they enter the gallery: one shared row height, column widths distributed by ratio. At that point **the per-image `ag:layout`, `ag:width` and `ag:side` are all ignored** — a row is a single unit.

To control one image on its own, first move it out of the group: break the group with body text or a heading, or write `ag:isolate`.

## A single image's width is computed from its ratio

With no parameters at all, a single image's column-width percentage is a piecewise power function of its ratio: a square image gets about four tenths (39%), a landscape image nearly fills the column, and a portrait image keeps only about three tenths. Two breakpoints decide "centred or floating" and "float left or right" respectively.

Three knobs shift the whole curve: "Width gain" and "Median ratio" on the settings page, plus template rules.

## The closer a declaration is to the image, the higher its priority

From lowest to highest:

1. Global parameters on the settings page (`floatMax`, `mobileBreakpoint`, etc.)
2. The current template's rules
3. The item fixed by the image's own `ag:` parameter

So no matter how wide the template is, an image with `ag:width=40%` stays at 40%. Conversely, templates can only affect images that have no parameters written and are laid out as auto.

## The container decides what is possible

The same image, placed in body text, a list item, a table cell or a callout, supports progressively fewer features:

| Container | Width/float | Gallery | Crop | Handles |
| --- | --- | --- | --- | --- |
| Body text | Yes | Yes | Yes | Yes |
| List item | Block layout, width allowed | Side by side within the item | Yes | No |
| Table cell | No | No | Yes | Live Preview action buttons only |
| Callout | No | No | No | No |

This is not an oversight but a deliberate choice: the more complex the container, the less geometry can be adjusted safely. Details in [[12-nested-scopes]].

## Next

- Grouping and breaking in detail: [[03-grouping]]
- How width is computed: [[07-width-routing]]
- Full parameter table: [[10-parameter-reference]]

---

Previous · [[01-quick-start]] ｜ [[README|Contents]] ｜ Next · [[03-grouping]]
