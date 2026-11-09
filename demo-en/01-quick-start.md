---
chapter: 0
order: 1
role: demo
tags: [autogallery, gallery]
---

# Quick start

> Install the plugin and a few consecutive image lines turn into a row of equal-height gallery images — without changing a single character of the Markdown file.

![Fjord](assets/photo/01-fjord.jpg)
![Ridge](assets/photo/02-ridge.jpg)
![Valley](assets/photo/03-valley.jpg)

These three images have native ratios of 3:2, 3:4 and 4:3. Without the plugin they stack vertically at their original sizes, each a different width; with the plugin on, all three cells share one row height, column widths are distributed by each ratio, top and bottom edges line up, and no image is stretched or has its corners cropped.

## Add two more

![Mountain road](assets/photo/04-road.jpg)
![Castle](assets/photo/10-castle.jpg)

With two side by side, the row height is about one third of the column width — taller than with three, so the detail is clearer. Count, ratios and column width together determine the row height; you never specify a number.

## The syntax

```markdown
![Fjord](assets/photo/01-fjord.jpg)
![Ridge](assets/photo/02-ridge.jpg)
![Valley](assets/photo/03-valley.jpg)
```

Three lines written back to back is all it takes — no blank lines, no parameters. Image spacing, Gallery max height and the maximum number of images per row are all tuned in one place on the settings page.

## Next

- To understand why the layout comes out this way, start with [[02-core-concepts]].
- To pull an image out of its row, see [[03-grouping]]; to control how many images go on each row, see [[04-row-splitting]].

---

Previous · — ｜ [[README|Contents]] ｜ Next · [[02-core-concepts]]
