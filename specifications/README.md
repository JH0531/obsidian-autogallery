# Specifications

Detailed rules for this plugin, split by topic. [`../AGENTS.md`](../AGENTS.md)
holds the repository-wide rules and points here; each file below is loaded only
when the area it covers is being changed.

| File | Scope |
| --- | --- |
| [`layout-core.md`](layout-core.md) | Gallery formation, row packing, float geometry, width routing — shared by both views. |
| [`reading-view.md`](reading-view.md) | Reading-view block splitting, section registration, virtualisation, scroll restoration. |
| [`live-preview.md`](live-preview.md) | CodeMirror behaviour: gallery rows, reveal takeover, caption widgets, action bar, scroll stability. |
| [`nested-scopes.md`](nested-scopes.md) | Callout / list / table ownership, and the `ag:` parsing that only applies in table rows. |
| [`crop-resize.md`](crop-resize.md) | `ag:crop` / `ag:top`, the crop dialog, width drag resize, alignment arrows. |
| [`pdf-export.md`](pdf-export.md) | The exporter, the print tree it owns, the export dialog, print geometry and styles. |
| [`pdf-pagination.md`](pdf-pagination.md) | Page-break step table, orphan repair, single-image compression. |
| [`validation.md`](validation.md) | App launch and lifetime, CLI exit-code trap, reload caveats, DOM/geometry assertions, PDF validation steps. |

## How to use them

- Read the file that covers the code you are changing, and only that file.
- A rule belongs to exactly one file. If a new rule fits none of them, add it
  to the closest match rather than creating a new file for a single rule.
- Repository-wide rules (build, style, validation policy, commits, git
  workflow) stay in `../AGENTS.md`; do not duplicate them here.
- When a rule changes, edit the file that owns it so the two never drift.
