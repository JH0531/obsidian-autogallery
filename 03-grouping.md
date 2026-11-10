---
chapter: 1
order: 3
role: demo
tags: [autogallery, gallery]
---

# Grouping rules

> Images may be separated by at most two blank lines; the third blank line, any line of body text or any heading ends the current gallery.

## Zero blank lines

![A](assets/ratio/ratio-3x2.svg)
![B](assets/ratio/ratio-4x3.svg)
![C](assets/ratio/ratio-1x1.svg)

Three lines written back to back become one row of three cells.

## One blank line

![D](assets/ratio/ratio-3x2.svg)

![E](assets/ratio/ratio-4x3.svg)

![F](assets/ratio/ratio-1x1.svg)

Reading view discards blank lines, so no gap is visible on screen; the plugin reads the **source text** and still treats them as one group.

## Two blank lines

![G](assets/ratio/ratio-3x2.svg)


![H](assets/ratio/ratio-4x3.svg)


![I](assets/ratio/ratio-1x1.svg)

Still one group — two blank lines is the limit.

## Three blank lines

![J](assets/ratio/ratio-3x2.svg)



![K](assets/ratio/ratio-4x3.svg)


![L](assets/ratio/ratio-1x1.svg)

The third blank line ends the group, so this becomes two groups: J on a row of its own, K and L side by side.

## Broken by body text

![M](assets/ratio/ratio-3x2.svg)

This line of body text separates the image above from the image below.

![N](assets/ratio/ratio-1x1.svg)

As soon as one non-empty line of text is inserted in between, the gallery ends, regardless of how many blank lines there are.

## Broken by a heading

### Subheading

![O](assets/ratio/ratio-4x3.svg)

A heading is a structural boundary too: it takes no part in image grouping and is not pulled into the row above.

## Related

- Row splitting and mixed ratios: [[04-row-splitting]]
- The difference between `ag:isolate` and `ag:exclude`: [[10-parameter-reference]]

---

Previous · [[02-core-concepts]] ｜ [[README|Contents]] ｜ Next · [[04-row-splitting]]
