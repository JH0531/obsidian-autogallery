---
chapter: 2
order: 8
role: demo
tags: [autogallery, float]
---

# Float and wrap

> A single image below the width threshold floats to one edge and the body text wraps into the space left over; the float lasts until the next structural boundary.

## Text wrapping

![Mountain road|ag:layout=float|ag:side=right|ag:width=37%](assets/photo/04-road.jpg)

With the image floating right, the body text fills the space left on the left. The wrap only happens in **Reading view**: to keep the editing caret stable, Live Preview never lets text run alongside the image — it reserves the same width but leaves the gap empty. That is also why the same note has different paragraph heights in the two views.

## Where a float ends

A float lives until the next structural boundary. All six structure types end it by default:

| Boundary | Default |
| --- | --- |
| Heading | On |
| Code block | On |
| Math block | On |
| Image | On |
| Table | On |
| Quote / callout | On |

The quote block below is itself a boundary — content after it fills the column again:

> This quote block ends the float above.

Each item can be switched off separately under **Float** in the settings. With one off, a float can cross that kind of structure — but the two blocks then end up squeezed side by side, which is rarely what you want.

## Float space strategy

When two images come one after the other, each with its own passage of prose, whether those passages share the same space is decided by **Float space** in the settings:

| Value | Behaviour |
| --- | --- |
| Follow document order (default) | Each image gets its own vertical band: passage two wraps only around image one, passage three only around image two, and later text never moves up to fill the gap left by image one |
| Share the float space | Prose fills whatever is nearest: passage three can move up into the gap left by image one and wrap around image two first. The images themselves still take one row each |

This setting moves only the **prose**, never the images. Whether two images sit side by side is decided by **Float → Image**: with the switch on, the second image ends the first one's float and the two stack vertically; only with it off can they sit side by side and share a band — and then the strip left for the prose in between is very narrow, which is rarely what you want.

Reading view, Live Preview and PDF all use the same setting. Live Preview produces no wrapping at all — each image row occupies its own height — so there the only remaining difference is whether the images break onto separate rows.

## When an image does not float

Two conditions must both hold: the computed width must not exceed `floatMax` (default 60%), and the current column width must be greater than `mobileBreakpoint` (default 600px). If either fails, the image falls back to a centred block.

PDF export does not use this breakpoint: the paper column width is the reader's deliberate choice, so the exporter instead asks whether a readable line of prose still fits beside the image. That is why, at A5 or with wide margins, an image centred on screen may float in the PDF.

Parameters can also force the outcome: `ag:layout=center` opts out of floating, and `ag:side=center` does the same.

## Related

- How width is computed: [[07-width-routing]]
- Spacing around floated images: [[10-parameter-reference]]

---

Previous · [[07-width-routing]] ｜ [[README|Contents]] ｜ Next · [[09-resize-and-align]]
