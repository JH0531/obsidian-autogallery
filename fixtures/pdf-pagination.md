---
role: fixture
tags: [autogallery, pdf, fixture]
---

# Pagination fixture

> This note exists only to produce PDF pagination stills: the content is deliberately placed near page boundaries to compare heading pagination, image optimisation and orphan control.

## Section 1 — body copy

Pagination works on blocks, not characters. A paragraph stays whole while it fits and moves whole when it does not; it only splits inside when the paragraph is longer than a page. That rule explains why the same paragraph lands on different pages in the pairs below.

Images and gallery rows are rigid blocks: a row of three cells never splits into two lines, while a single portrait image may shrink to the page foot. Both are handled by the pagination step table, in the order heading break, image compression, orphan control.

## Section 2 — gallery row

If the row of three images below lands at the page foot, turning optimisation off pushes the whole row to the next page and leaves the tail blank; turning it on shrinks the row until it sits on the foot.

![Fjord](assets/photo/01-fjord.jpg)
![Falls](assets/photo/05-falls.jpg)
![Ridge](assets/photo/04-road.jpg)

All three cells shrink by the same factor and keep their column ratios — the main difference between a row and a single image.

## Section 3 — single portrait

A single portrait is handled differently: it may shrink within the allowed cap so it can sit on the page foot without moving. The cap is set by Max image shrink; past it the image moves whole.

![Castle](assets/photo/10-castle.jpg)

Once the image moves, the prose after it follows, so the pair changes position together in the two versions.

## Section 4 — heading pagination

Heading pagination carries a heading to the next page when it lands at the foot and its body does not fit, so a heading is never stranded alone at the bottom.

### Level four behaves the same

The rule applies at or above the configured level; headings below it do not force a break.

## Section 5 — orphan control

Orphan control handles the last line of a paragraph: if only one line would land on the next page, it pulls one more line across so the page does not open with a lonely short line.

The final layout is a stable state after several rounds: each round applies one kind of correction, then measures again, until no new correction appears. That is why two versions often differ in more than one place — one move shifts everything after it.
