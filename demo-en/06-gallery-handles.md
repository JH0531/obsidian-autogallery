---
chapter: 1
order: 6
role: demo
tags: [autogallery, gallery, handles]
---

# Gallery handles

> Hovering a gallery row reveals five kinds of handle. Every drag only rewrites `ag:crop` and `ag:group`; no pixel coordinates are ever saved, and `ag:rows` is never written for you.

![A](assets/photo/01-fjord.jpg)
![B](assets/photo/02-ridge.jpg)
![C](assets/photo/03-valley.jpg)
![D](assets/photo/04-road.jpg)
![E](assets/photo/05-falls.jpg)
![F](assets/photo/10-castle.jpg)

## The five handles

| Handle | Position | Effect | Parameter written back |
| --- | --- | --- | --- |
| Divider | Between two cells | Adjacent cells trade width, one gaining what the other loses, with the row height unchanged | `ag:crop` on both cells |
| Row bar | Below the row, in the caption gap | The whole row grows taller or shorter, column proportions unchanged | `ag:crop` on every cell |
| Swap | Left and right edges of a cell | Swaps places with the neighbouring image | Swaps the two source lines |
| Merge into adjacent row | Row start / row end | Moves this image into the previous or next row | Rewrites `ag:group` and clears the stale `ag:rows` |
| Link button | Bottom-right corner of a cell | Locks the whole row so auto-packing no longer splits or merges it | Writes the same id to `ag:group` on every cell |

One drag is one commit and one undo step; press Esc to cancel and return to the state before the drag. The controls degrade automatically as a cell narrows: two trays → collapsed tray → vertical stack → hidden, and they never overlap in any of those states.

## Locking a row

![G|ag:group=1](assets/ratio/ratio-4x3.svg)
![H|ag:group=1](assets/ratio/ratio-1x1.svg)
![I|ag:group=2](assets/ratio/ratio-3x2.svg)
![J|ag:group=2](assets/ratio/ratio-16x9.svg)

Consecutive images sharing an id lock into one row; if two adjacent rows use the same id they are swallowed into a single row, so distinct positive integers are required. Once locked, auto-packing neither pulls other images in nor splits the row apart.

## Parameters only, file structure untouched

After dragging one column, the only thing added to the source is that cell's own crop parameters:

```markdown
![A|ag:crop=1.42:1|ag:top=0:100:18](assets/photo/01-fjord.jpg)
```

No pixel widths, no inline styles. Change the theme, the font size or the window width and the same set of ratios is recomputed.

Dragging never writes `ag:rows` for you either: row splitting only ever comes from hand-written values, and once a row binding is removed the group falls back to automatic routing. To fix the members of a row, use the link button in the bottom-right corner to write `ag:group`.

## Related

- What the parameters mean: [[10-parameter-reference]]
- Crop geometry: [[11-cropping]]
- Resizing and aligning a single image: [[09-resize-and-align]]

---

Previous · [[05-row-height-and-orphans]] ｜ [[README|Contents]] ｜ Next · [[07-width-routing]]
