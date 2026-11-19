---
chapter: 4
order: 14
role: demo
tags: [autogallery, profile]
---

# Layout templates

> A template decides "how wide an image of a given ratio is, and whether it floats". The built-in auto is a curve; a custom template replaces it with interval rules.

![Square image|ag:width=60%](assets/photo/06-cloud.jpg)

The image above writes `ag:width` explicitly, so no template affects it — **image parameters always take priority over template rules**. The rest of this page applies only to images "without `ag:width` and with layout auto".

## What three rules look like

This vault ships a `wide` template that shifts every width up one notch:

| Ratio range | Width | Layout |
| --- | --- | --- |
| `[0.75, 1.35]` | 0.68 (68% of the column) | auto |
| `(1.35, 5]` | `0.55 + 0.1 * Math.log(r)` | auto |
| `[0.2, 0.75)` | `Math.max(0.32, 0.3 + 0.2 * r)` | float, left |

The first covers square images, the second uses an expression so a wide image's share grows slowly with the ratio, and the third narrows tall images and allows text to wrap around them.

Whether an interval is closed on the left and open on the right, or the other way round, is decided by the brackets themselves: `[0.75, 1.35]` includes 0.75 and 1.35, `(1.35, 5]` excludes 1.35 but includes 5.

## How rules match

Top to bottom, the first matching rule applies and later ones are not consulted. Broad intervals therefore belong at the end, precise ones at the front.

Each rule has four fields:

| Field | Values | Notes |
| --- | --- | --- |
| `ratioRange` | `[0.5,1]`, `(1,3]` | Image aspect-ratio range (width ÷ height) |
| `width` | a constant or an expression containing `r` | Fraction of the content width |
| `layout` | `auto` / `float` / `fixed` | auto decides by the float threshold; float forces floating; fixed is a centred block |
| `side` | `auto` / `left` / `right` | Float direction; when omitted, the template-level `floatAlignment` is used |

An expression in `width` may only use `r` and `Math.log / abs / min / max / pow / floor / ceil / round`. A bare `min(...)` is rejected as invalid — you must write `Math.min`.

When the width computed by a rule exceeds the "Float max effective width", the image switches to block layout and no longer floats.

## Two limits

- The settings tab can only change a template's name and float direction; **you cannot create a template there, nor edit rules there** — rules can only be written by importing.
- Rules apply only to images "without `ag:width` and with layout auto".

## Related

- How to write a rules file: [[15-import-and-export]]
- Making a template actually take effect: [[16-routing]]
- Parameters of the width curve: [[07-width-routing]]

---

Previous · [[13-dialog-and-reset]] | [[README|Contents]] | Next · [[15-import-and-export]]
