---
chapter: 6
order: 20
role: demo
tags: [autogallery, command]
---

# Commands and undo

> The plugin registers four commands and one file menu item; every write is a single transaction, undone in one step with `Ctrl/Cmd+Z`.

![Snow ridge|ag:width=40%|ag:side=left](assets/photo/02-ridge.jpg)

## Four commands

| Command | What it does | Notes |
| --- | --- | --- |
| Set image caption and layout | Opens a dialog for caption, layout, side, width, gap | Only these fields change; every other parameter is kept as-is |
| Clear image caption and layout | Clears the caption and removes all layout parameters | Also clears `ag:isolate` / `ag:exclude` / `ag:rows` / `ag:group` |
| Restore document default image style | Resets the whole document after a confirmation, then reports how many images were restored | Single transaction, one-step undo |
| Export PDF (AutoGallery) | Opens the export dialog | Only on desktop, and only when the current file is Markdown |

The file list context menu also has an "Export PDF (AutoGallery)" entry with the same effect as the fourth command.

## Three steps behind one command

1. Read the current image line and parse the existing parameters;
2. Change only the keys involved this time, and write the rest back in their original key order;
3. Commit through a single editor transaction, so the undo stack shows only one step.

The write-back order is fixed (`isolate → exclude → group → layout → side → width → gap → rows → crop → top`), so dragging a width once never pushes hand-written crop parameters somewhere else, and a reordering never produces an extra diff.

## Related

- Parameter meanings: [[10-parameter-reference]]
- Reset vs. restore: [[21-pitfalls]]

---

Previous · [[19-settings]] ｜ [[README|Contents]] ｜ Next · [[21-pitfalls]]
