---
chapter: 3
order: 11
role: demo
tags: [autogallery, crop]
---

# Cropping

> `ag:crop=W:H` sets the frame's aspect ratio, `ag:top=x1:x2:y` sets where the frame falls on the original image; when you would rather not write coordinates by hand, use the crop dialog.

## Uncropped

![Original](assets/photo/05-falls.jpg)

The original is 16:9 and shown in full.

## Cropped to a square

![Square|ag:crop=1:1|ag:top=25:75:2](assets/photo/05-falls.jpg)

`ag:crop=1:1` turns the frame into a square; `ag:top=25:75:2` takes the region from 25% to 75% horizontally, starting 2% down vertically. Only one vertical number is written, because the height already follows from the ratio.

## Taking any sub-region

![Top-left quarter|ag:crop=24:17|ag:top=0:50:0](assets/ratio/ratio-4x3.svg)

![Square right of centre|ag:crop=1:1|ag:top=40:80:20](assets/ratio/ratio-4x3.svg)

The first takes a patch in the top-left corner, the second a square right of centre. When parameters go out of range the plugin clamps them to the picture; reversed endpoints are swapped automatically too, so you never get a blank image.

## Crop dialog

![Waterfall square|ag:crop=1:1|ag:top=25:75:2](assets/photo/05-falls.jpg)

When you would rather not work out coordinates, hover the image and click the scissors icon. The one above is the result after saving in the dialog — it writes only the two parameters `ag:crop` and `ag:top`.

| Action | Effect |
| --- | --- |
| Drag an edge | Moves only that edge; the other three stay put |
| Drag a corner | Moves the two adjacent edges together |
| `Shift` + drag | Locks the current ratio |
| `Alt` + drag | Scales symmetrically about the centre |
| Wheel | Zooms the editing view (1–4×); does not change the crop result |
| Ratio dropdown | Free / Current ratio / 1:1 / 4:3 / 3:2 / 16:9 / 9:16 / 3:4 / 2:3 |
| Save | Writes `ag:crop` and `ag:top` |
| Clear crop | Removes both parameters and restores the full picture |
| Reset framing | Pulls the frame back to the whole image only; does not close the dialog |

"Current ratio" only appears while no preset is locked; reopening keeps the ratio chosen last time. When the frame covers the whole image, saving writes no parameters at all — this avoids recording "not cropped" as "cropped but equal to the original", which would lock the ratio.

When there are unsaved changes, clicking empty space, pressing `Esc` or clicking Cancel first asks "Discard changes?".

The dialog itself opens in **Live Preview**; Reading view has no entry point.

## Cropping changes width routing

After cropping to a square, the plugin uses the **cropped ratio**, not the original image's ratio: a 16:9 wide image cropped to 1:1 narrows from near full column to about half and re-decides whether to float. Cropping therefore changes not only the picture content but also its place on the page — this is expected.

If the crop frame would push the image's bottom edge past the original, the plugin **relaxes the frame** instead of cutting content away: better a little extra picture than chopping off the edge the reader wanted.

## Related

- Parameter syntax: [[10-parameter-reference]]
- Only `ag:crop` takes effect in tables: [[12-nested-scopes]]
- Width curve: [[07-width-routing]]

---

Previous · [[10-parameter-reference]] | [[README|Contents]] | Next · [[12-nested-scopes]]
