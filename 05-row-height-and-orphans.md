---
chapter: 1
order: 5
role: demo
tags: [autogallery, gallery, orphan]
---

# Row height cap and orphans

> A row does not grow without limit: past **Gallery max height** the whole row is scaled down proportionally. And if an image alone on its row is still too tall when filling the column, it leaves the gallery and becomes a centred single image.

## Row height cap

![Tall strip, left](assets/ratio/ratio-1x3.svg)
![Tall strip, right](assets/ratio/ratio-1x3.svg)

Two 1:3 strips side by side would need a row height of 1122px to fill a 760px column. Past the 600 cap, the whole row is scaled down proportionally and centred horizontally: the height stops at 600, each cell is 200px wide, nothing is cropped and the proportions hold — the row simply no longer fills the column. The cap comes from the setting `galleryMaxHeight` (default 600).

Change the cap and the row height of the same group changes at once — the quickest way to tell whether the cap is what is in play.

## Orphan images

![Fjord|ag:rows=5,1](assets/photo/01-fjord.jpg)
![Snow ridge](assets/photo/02-ridge.jpg)
![Valley](assets/photo/03-valley.jpg)
![Mountain road](assets/photo/04-road.jpg)
![Waterfall](assets/photo/05-falls.jpg)
![1:3 strip](assets/ratio/ratio-1x3.svg)

`ag:rows=5,1` fixes this group as "five plus one". When the last 1:3 image sits alone on its row, its height at full column width works out to 2280px — far above the 400px cap — so it **leaves the gallery** and is centred at its automatic width; otherwise a reader would have to scroll three screens to get through one image.

The rule only applies to a **single-image row**: with two or more images on a row the row height is decided jointly, and the orphan check never fires. The threshold is `galleryOrphanMaxHeight`; set it to `0` to switch the rule off.

## Three settings compared

| `galleryOrphanMaxHeight` | How the 1:3 strip behaves |
| --- | --- |
| `400` (default) | Leaves the gallery, centred, width narrowed in proportion (image above) |
| `0` | Stays in the gallery, fills the column, height about 2280px |
| `1200` | Still a gallery cell as long as the full-column height does not exceed 1200 |

The deciding measure is the **rendered full-column height**, not the image's pixel height; the same image may trip the orphan rule in a narrow window and not in a wide one.

## Related

- Row splitting: [[04-row-splitting]]
- Single-image width routing: [[07-width-routing]]

---

Previous · [[04-row-splitting]] ｜ [[README|Contents]] ｜ Next · [[06-gallery-handles]]
