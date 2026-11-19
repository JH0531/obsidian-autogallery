---
chapter: 2
order: 9
role: demo
tags: [autogallery, resize, align]
---

# Resize, align and reset

> For a single image, use Obsidian's native bottom-right badge to change the width and the arrows on either side of the image to change alignment; both write the result back to `ag:width` / `ag:side`.

![Castle|ag:width=46%|ag:side=right](assets/photo/10-castle.jpg)

## Dragging the badge

Move the pointer to the image's bottom-right corner, wait for the native resize badge, then drag: the image scales proportionally, and on release `ag:width` is written and the current alignment is pinned. Double-click the badge to clear `ag:width` and return to automatic width, while keeping `ag:side`.

One drag produces a single undo step; while dragging, the caption widens along with the image, so you never get the image resized but the caption left behind.

## Alignment arrows

On the free side of an image, `‹` / `›` arrows appear: the left arrow aligns left, the right arrow aligns right; a centred image gets one on each side. A click writes both `ag:side` and the current width — otherwise, once the image narrows, automatic routing could pull it back to the centre.

A full-column image shows no arrows: there is no room left to move it. If the image is too wide for the arrows to fit in the empty space, they are drawn inside the image and appear only on hover.

## When it does not apply

- Gallery cells: a cell's width is decided by the whole row, so the badge is suppressed; to change column width, drag the divider — see [[06-gallery-handles]].
- Images inside list items: no badge and no arrows; `ag:width` has to be written by hand.
- Table cells: width is decided by the table, and only `ag:crop` is honoured.

## Related

- Width curve and float threshold: [[07-width-routing]]
- The settings `resizeEnabled` / `alignButtonsEnabled` switch both sets of controls off entirely

---

Previous · [[08-float-and-wrap]] ｜ [[README|Contents]] ｜ Next · [[10-parameter-reference]]
