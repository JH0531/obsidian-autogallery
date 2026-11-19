---
chapter: 3
order: 13
role: demo
tags: [autogallery, dialog, command]
---

# Dialogs and reset

> When you would rather not remember parameters, open the dialog and fill in the form; if you get it wrong, clear it or restore the whole note. Every write is one transaction, one step to undo.

## Image caption dialog

Put the cursor on an image line and run "Set image caption and layout" from the command palette. The dialog has five fields (caption, layout, float direction, column width, gap):

| Field | Parameter written back | Notes |
| --- | --- | --- |
| Image caption | The first non-`ag:` field | This is the caption; no `\|` needed |
| Layout | `ag:layout` | auto / gallery / float / center |
| Column width % | `ag:width` | 10–100; empty means automatic |
| Gap (px) | `ag:gap` | 0–80; applies to floated images only |

The dialog **changes only these four items**; other parameters on the line (crop, row split, isolate) are preserved as written. Parameters are written back in a fixed order (`isolate → exclude → group → layout → side → width → gap → rows → crop → top`), so changing the width once never pushes a hand-written crop parameter into another position, and no extra diff appears because of a changed order.

## Clear and whole-note restore

| Command | Effect | Note |
| --- | --- | --- |
| Clear image caption and layout | Clears the caption and removes all layout parameters | Also clears `ag:isolate`, `ag:exclude`, `ag:rows`, `ag:group` |
| Restore document default image style | Resets the whole note | Asks for confirmation first, then reports how many images were restored |

"Restore" walks every image in the current document, deleting each one's width, alignment, crop and gap, and returns them to the plugin's automatic routing. It does not touch the images themselves or the file structure — it is a single editor transaction, so `Ctrl/Cmd+Z` undoes it as a whole.

When the current document has no parameters to restore, it says "No images in the current document need restoring" and does not create an empty undo step.

## How the two differ

- **Clear** acts only on the line under the cursor, down to a single image.
- **Restore** acts on the whole note — good for "I tried a pile of parameters; let me start over".

## Related

- Parameter meanings: [[10-parameter-reference]]
- Full list of the four commands: [[20-commands-and-undo]]

---

Previous · [[12-nested-scopes]] | [[README|Contents]] | Next · [[14-layout-templates]]
