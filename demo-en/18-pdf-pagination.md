---
chapter: 5
order: 18
role: demo
tags: [autogallery, pdf, pagination]
---

# PDF Pagination Optimisation

> Five rules decide which page content lands on: gallery rows do not split, a lone image may sit flush, a floated image and its surrounding text move together, a heading may start a new page, and orphan lines on the last page can be pulled back.

This note is deliberately long enough to make page boundaries visible in the paginated preview. Each section below corresponds to one rule.

## Gallery rows do not split

![A](assets/photo/01-fjord.jpg)
![B](assets/photo/02-ridge.jpg)
![C](assets/photo/03-valley.jpg)

A gallery row is one unit: either the whole row stays on this page, or the whole row moves to the next one; you never get "three images on the upper half, two on the lower half".

When it does not fit, the three cells shrink by the **same ratio**, each centred in its fixed slot, with **the column width unchanged**. If it still does not fit at the shrink limit, the whole row moves to the next page. It is never used as a donor to rescue other images on the same page, and orphan repair will not compress it either.

## Bottom-flush compression for a lone image

![](assets/ratio/ratio-9x16.svg)

When half a page is left at the end of a page and a portrait image does not fit as it is, the plugin first tries scaling it down proportionally until it sits exactly flush. The shrink limit defaults to 15% (`singleImageMaxShrink`); beyond that limit the whole image is carried to the next page, so there is never the in-between state of "shrunk halfway and still cut off".

Only this one image shrinks: once the target image has used up its own limit, the plugin then touches other images on the same page (at most 4) or the line spacing, following "Priority margin". Body text in the same paragraph as the image is split into its own block, so once the image sits flush the text naturally starts on the next page.

## How floated images cross pages

At the end of a page, a floated image is handled in three tiers:

1. The image's bottom edge is still within this page — leave it alone; the text keeps wrapping as usual.
2. Almost — shrink the image within this pass's budget (or compress line spacing by priority) until the image's bottom edge is on the page.
3. Still does not fit — the "Float space" setting decides: with shared space the text stays on this page and the image moves after it; with alignment to the text flow order, the image and its paragraph move to the next page as one block.

The decision looks only at the **image's bottom edge**, not at how far the wrapped text runs: when the text is longer than the image, the overflow continues line by line onto the next page, instead of pushing the whole paragraph away with it. The image itself is never cut in half at the page edge.

Binding happens only under "alignment to the text flow order"; "shared float space" does not bind.

## Heading pagination

Once "Heading pagination" is on and the "Heading pagination start level" is set, headings at that level start a new page. In this demo the level is `h2`, so every `##` above may trigger a page break — whether it actually does depends on how much space is left before it.

Even with heading pagination off, a heading that lands in the footer while its body text has to continue is carried to the next page. Two adjacent headings (say h1 immediately followed by h2) count as one heading block and are cut only once, so no blank page is produced.

Pages opened by heading pagination are not modified again by orphan control; the two rules do not stack.

## Orphan control

When only one or two lines are left on the last page, the last few lines of the previous page are moved down with them, avoiding "a page with a single sentence". "Allowed lines on the last page" defaults to 2 and can be set to 1–5 in the settings. When off, Obsidian's native two-line strategy applies.

Images are compressed first (1% per step), then line spacing (2% per step, up to 10%); a single export fixes at most three places.

## How the five rules queue up

1. First cut the forced page boundaries from heading pagination.
2. Then handle gallery rows: move the whole row or shrink the whole row.
3. Then handle a lone image at the page end: shrink it flush.
4. Then protect a heading at the page end: keep the heading on this page if it can be squeezed in.
5. Finally repair orphans: pull back the too-few lines on the last page.

The order cannot be reversed — compressing images after cutting pages would push the already-compressed images down again. Measurements are retaken after each round, for at most 4 rounds by default.

## What it can and cannot do

**Can do**

- Keep a whole gallery row on one page; shrink the whole row by the same ratio when needed, with the column width unchanged.
- Shrink a lone image at the page end flush; roll the whole thing back on failure.
- Move a floated image and its neighbouring text together under "alignment to the text flow order".
- Start a heading on a new page, or protect a footer heading when that is off.
- Pull back 1–2 lines of the last page, possibly reducing the page count by 1.

**Cannot do**

- Will not enlarge images or font sizes just to fill the footer.
- Will not exceed the "maximum image compression height"; at the ceiling it leaves whitespace or moves the whole block.
- Will not rearrange column widths: when shrinking, the three cells keep the same ratio and the slots stay put.
- Will not compress the inside of tables, code blocks or math blocks; they may still break internally when they overflow.
- Will not balance pages: it only handles the last page and intermediate pages with "exactly one line at the top", fixing at most three places.
- Shrinking the width inside a fixed-height container does not make it shorter; the plugin probes once and gives up.
- The native export fallback does not run full pagination; it only guarantees CSS-level rules.

## Reproduce it yourself

1. Open this note and run "Export PDF (AutoGallery)".
2. In the export window, switch to "Paginated preview" and find the first page boundary.
3. Turn off "Image pagination optimisation", switch to "Paginated preview" again, and compare the footer of the same page.
4. Turn on "Heading pagination" and set the start level to h2; watch whether each level-2 heading starts a new page.
5. Change "Allowed lines on the last page" from 2 to 1 or 3, and watch whether the total page count changes.

## Other boundaries

```text
Paper A4 · narrow margins · scale 100% · page numbers footer centre
```

Tables and code blocks are handled as a whole and are not split in the middle:

| Rule | Default | Effect |
| --- | --- | --- |
| Gallery row | Rigid | Move the whole row; shrink the whole row by the same ratio if needed |
| Single image compression | Limit 15% | Sits flush at the page end |
| Line spacing compression | Limit 10% | Only after the target image's limit is used up |
| Heading pagination | Off | By level; page-end protection still applies when off |
| Orphan control | On, 2 lines on the last page | Pulls back orphan lines |

## Related

- Export options: [[17-pdf-export]]
- Gallery rows themselves: [[04-row-splitting]]

---

Previous · [[17-pdf-export]] ｜ [[README|Contents]] ｜ Next · [[19-settings]]
