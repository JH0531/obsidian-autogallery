# Contributing Guide

> **Language**: This document is the English version. The Chinese version is [CONTRIBUTING.md](CONTRIBUTING.md).
> User documentation: [README.md](README.md) (Chinese) · [README-EN.md](README-EN.md) (English)

AutoGallery is an Obsidian image-layout plugin: it handles captions, automatic column widths, galleries, text wrapping and pagination in a unified way without rewriting Markdown image references or breaking the ability to edit body text, and it ships a PDF export pipeline that lays out consistently with the reading view.

This file is for **human contributors and automated agents**. It explains how to change code safely in this repository. The authoritative source for technical detail is [`AGENTS.md`](AGENTS.md) (repository-wide rules and an index) plus the [`specifications/`](specifications/) directory (detailed rules split by topic); this document does not repeat them, but gives the complete path from "what to change" to "how to verify" to "how to submit".

---

## 1. Environment setup

| Item | Requirement |
| --- | --- |
| Node.js | **≥ 18** (esbuild 0.25's floor; the development environment uses 22.x). The repository declares no `engines` field |
| Package manager | npm (`package-lock.json` is committed; do not switch to yarn/pnpm) |
| Runtime | Obsidian ≥ 1.5.0 (see `minAppVersion` in `manifest.json`) |

```bash
npm install
```

The available scripts (only two, defined in `package.json`):

```bash
npm run dev      # development build, inline sourcemap, not minified
npm run build    # production build, minified, writes main.js
```

> **Note**: the repository currently has **no** `test` script and does not pull in Vitest or jsdom.
> `npm test` fails with `Missing script: "test"`. The valid static checks are `npm run build` and `git diff --check`.

---

## 2. Repository layout and module responsibilities

```
plugin.js           plugin entry: registers commands, the settings tab, the postprocessor, editor extensions
src/                all implementation code (32 JS modules + config.json + 9 locale files in locales/)
main.js             build artefact, committed, updated together with the sources
manifest.json       plugin manifest (id / version / minAppVersion)
esbuild.config.mjs  bundler configuration (cjs, target es2018, platform browser)
```

`src/` is layered by responsibility. Locate your change before you write it, so that logic does not
pile up in a file that is already large:

| Layer | Modules | Responsibility |
| --- | --- | --- |
| Pure computation | `layout.js`, `image-runs.js`, `crop-geometry.js`, `gallery-geometry.js`, `profile-rules.js`, `float-order.js`, `print-geometry.js` | No DOM dependency; independently reasoned about and reused |
| Parsing / serialisation | `annotations.js` (`ag:` parameter read/write), `profile-io.js` (profile import/export), `routes.js` (frontmatter routing) | Pure string and object handling |
| Reading view | `renderer.js`, `embed-actions.js`, `image-metrics.js`, `image-sizes.js`, `reset-images.js` | Layout built on `registerMarkdownPostProcessor`; `image-sizes.js` reads undecoded image dimensions from file headers |
| Live Preview | `editor-extension.js` (CodeMirror 6 extension), `editor-resize.js` (drag resize), `gallery-handles.js` (gallery handles), `gesture-state.js` (gesture geometry pre-takeover) | Built on `StateField` / `ViewPlugin` / line decorations |
| PDF | `pdf-export.js` (entry point), `pdf-session.js` (print tree), `pdf-export-modal.js` (dialog), `pdf-pagination.js` (pagination model), `pdf-style.js` (style composition), `pdf-integration.js` (coexistence with the native export) | A pipeline independent of the native exporter |
| UI | `settings-tab.js`, `crop-modal.js`, `confirm-modal.js`, `icons.js`, `i18n.js`, `print-theme.js` (light theme cache) | Settings tab, crop dialog, icon registration, bilingual UI |
| Configuration | `defaults.js` (default settings and normalisation), `config.json` (tunable constants) | — |

### The single-implementation rule (the most important one)

A rule may have **exactly one** implementation, and the reading view and Live Preview must share it:

| Rule | Sole implementation |
| --- | --- |
| Which source lines form one gallery | `src/image-runs.js` |
| How lines are split and grouped (`groupImageRecords`, `findImageLineGroups`) | `src/image-runs.js` |
| Gallery row packing | `calculateGalleryRows` in `src/layout.js` (the only packing algorithm) |
| Single-image width and float calculation | `calculateFloatLayout` / `calculateWidthRatio` in `src/layout.js` |
| Crop geometry (frame, view box, ratio) | `src/crop-geometry.js` |
| Gallery gesture geometry (width to frame ratio, row-height scaling) | `src/gallery-geometry.js` |
| Print stylesheet composition | `composePdfStyle` in `src/pdf-style.js` |
| Column-width gain, float threshold and similar constants | `src/config.json` (**never** hard-code a second copy in code) |

Many of the most visible past defects came from "the reading view and Live Preview each had their own
copy": the same note rendered as 3+1 in the editor and as 2+2 in the preview. When you find such a
divergence, the correct fix is to extract the rule into a shared module — not to patch each side.

---

## 3. Code conventions

### 3.1 Basic style

The repository configures no formatter and no linter, so **stay consistent with the surrounding code**:

- Two-space indentation; semicolons; double-quoted strings.
- ESM module syntax (`import` / `export`); no TypeScript.
- `camelCase` for variables and functions, `PascalCase` for classes, `kebab-case` for command ids and CSS class names.
- Prefer small named functions and explicit object properties over large anonymous closures.
- Comments explain **why**, not what the code does. The existing comment density is deliberate.
- Keep browser and Obsidian APIs inside the layer that already owns them; pure computation modules must not touch `document`.

### 3.2 CSS and DOM naming

- Class names use the `ag-` prefix: `.ag-caption`, `.ag-cm-gallery-line`, `.ag-pdf-row`, `.ag-align-action`.
- Custom properties use the `--ag-` prefix: `--ag-embed-width`, `--ag-img-aspect`, `--ag-caption-gap`,
  `--ag-print-width`, `--ag-reveal-left/top/width`.
- **Data markers** use `data-ag-*`: `data-ag-skip`, `data-ag-pdf-owner="plugin"`, `data-ag-mixed`,
  `data-ag-pdf-break-before`.
- Compact variants such as `ag-actions-compact` / `ag-actions-compact-small` must be delivered by a
  stylesheet class, never by inline `!important` — Obsidian overwrites such declarations with its own
  `element.style` writes.

### 3.3 Internationalisation

The rules in `src/i18n.js` are unusual; understand them before changing anything:

- **The key is the Chinese source string**: `t("恢复默认")`. In the Chinese UI an unmatched key falls
  back to the key itself.
- `src/locales/en-*.js` maps Chinese keys to English, split by UI domain into
  `common / settings / pdf / crop / editor / profile / print / confirm`.
- `src/locales/zh.js` holds Chinese overrides **only for ASCII keys** (such as `settings.language`,
  `confirm.ok`), because their Chinese form differs from the key itself.
- Placeholders are written as `t("第 {n} 个模板无效：{message}", { n, message })`.
- `LANGS` is the set of languages `t()` can actually render (`["zh", "en"]`); `FOLLOW` (`"follow"`) is a
  **pseudo-language** meaning "follow Obsidian". It resolves to a real language at runtime: a host
  language starting with `zh` gives Chinese, `en` gives English, and any other language falls back to
  English. `FOLLOW` is the default, and the whitelist in `normalizeSettings` is `[FOLLOW, ...LANGS]`.
- Therefore **do not rely on runtime language switching for new UI copy**: module-level constants that
  call `t()` at load time (such as `SETTINGS_SECTIONS`) are frozen and will not update when the
  language changes. The settings tab's section navigation was changed to store `labelKey` / `hintKey`
  and call `t()` at render time — follow that pattern for any new module-level UI constant.

The correct flow for new UI copy: write `t("Chinese source text")` → add the English mapping in the
matching `en-*.js` file. **Never** introduce a separate English key system, and never replace the
Chinese source text with pinyin or English.

---

## 4. Core architectural constraints (read before changing anything)

Each rule below corresponds to a class of shipped defect. `AGENTS.md` and `specifications/` contain the full derivation;
this is the condensed version.

### 4.1 Percentages apply to the outer Markdown block only

For centred or gallery images, the explicit percentage (`ag:width`) is written to the outer block; the
nested `.image-embed` / `.internal-embed` must be `width: 100%`. Writing the same percentage at both
levels makes Obsidian render 60% as "60% of 60%".

### 4.2 Nested containers have a strict owner

An image belongs to **exactly one** layout scope: the nearest `td/th`, `li` or `.callout`, otherwise
the enclosing section. `readImageBlock` must filter by that owner, or a whole callout gets packed into
a single gallery cell and shrinks to a few hundred pixels.

- **Callout**: claimed but **never decorated**. In Live Preview a callout is an opaque block, so any
  geometry written inside it could not be edited back.
- **List item**: never joins a gallery with a neighbour (the marker column makes a cross-item row
  unreadable). Images inside one item are routed against the item's content box, and a single image
  uses the **left** block axis and **never floats** (a float is not contained by `display: list-item`
  and overflows into the next item's box).
- **Table cell**: never receives a plugin width or alignment. Only `ag:crop` and `ag:exclude` apply.
  An inline `width: 100% !important` there fights Obsidian's own sizing and collapses the column into
  a thumbnail.

### 4.3 Percentage widths and the float decision

- `floatMax` decides whether an **automatic** width floats; it must never replace the width computed
  by the piecewise power function with `100%`. Beyond the threshold the image is centred at the
  computed width.
- Compare an explicit `ag:width` with `floatMax` using the **declared percentage**, never a ratio
  derived from the measured column width — otherwise sub-pixel jitter flips an image between floating
  and centring on consecutive passes and reflows the document by the image's full height.
- The threshold is an **inclusive** ceiling: an automatic width exactly equal to `floatMax` floats,
  matching `calculateFloatLayout`.
- A manual `ag:width` combined with `ag:side` floats at exactly the width the reader chose, whatever
  it is.
- A centred image must never carry a CSS `float` value.

### 4.4 Scroll stability

- Live Preview must never let text wrap beside an image (a float gives its line no height, so the next
  line paints over the picture). The float branch reserves `image height + caption + bottom gap`.
- Every rAF-scheduled layout pass needs a `setTimeout` backstop (around 200ms): rAF is paused while
  the Obsidian window is hidden.
- Scrolling must not trigger a full layout pass; lines entering the viewport are handled through
  `viewportChanged`.
- The reading view anchors its scroll to the **first block under the viewport top**, not to a raw
  `scrollTop` offset. Chromium's own scroll anchoring is already active, so `scrollTop` must not be
  written again while the anchored block is still connected.

### 4.5 Cropping

- Cropping happens only with an explicit `ag:crop=W:H`; there is no separate fill switch.
- The effective ratio is `max(declared ratio, top width / available height)`: a hand-written parameter
  is **widened**, never clipped. Every consumer must use `effectiveCropRatio`, not `crop.w / crop.h`.
- The crop dialog must never write the image file, and must never add `overflow: hidden` to an
  ancestor.
- The dialog must not scroll: the wheel is the zoom gesture, so the save/cancel row must always stay
  reachable.

### 4.6 PDF export

- The print tree must be a **direct child of `<body>`** carrying `data-ag-pdf-owner="plugin"`;
  Obsidian's `@media print` hides every other body child.
- Page geometry comes from the actual options handed to `toPrintOptions`, not from a paper-size table;
  `scale` must be divided out.
- The plugin's orphan control uses `orphans: 1 / widows: 1`; the native exporter applies its own 2/2.
- `composePdfStyle` is the **only writer** of the print stylesheet; a second `textContent` assignment
  loses the orphan declarations.
- The relayout order is fixed: `ensureBodyPosition` → `unpaginate` → `renderCleanup` →
  `resetFloatIndices` → recompute the geometry → rewrite the stylesheet → `renderAutoGallery`.
- Never replace the native `workspace:export-pdf` command id; the plugin adds its own command and
  `file-menu` entry.
- Preview printing and export printing must be serialised through `withPrintLock`.

### 4.7 Compatibility red lines

- `auto` is the built-in fallback profile: it **cannot be deleted, cannot be renamed, and is never
  overwritten by an import**.
- A profile import updates in place: the same id is replaced, profiles not mentioned stay unchanged,
  and **a single invalid entry rejects the whole file** — nothing is partially written.
- After the plugin is disabled, Obsidian's native image markup and styles must be restored.
- An `ag:exclude` image keeps its native rendering; `ag:isolate` cuts the grouping before and after.

---

## 5. Verification workflow (no automated tests)

This repository **explicitly forbids** introducing Vitest, jsdom, a `tests/` directory or any testing
dependency, and forbids keeping a second copy of production logic "to make it testable". Verification
happens only in a real Obsidian Vault.

```bash
# 1. Build and deploy to the test Vault
npm run build
cp main.js manifest.json <VAULT>/.obsidian/plugins/obsidian-autogallery/

# 2. Reload the plugin
obsidian vault=test plugin:reload id=obsidian-autogallery

# 3. Open the target note, run the command, inspect the log
obsidian vault=test open file="<VAULT>/<your note>.md"
obsidian vault=test dev:errors
obsidian vault=test dev:dom selector='.ag-caption' total
obsidian vault=test dev:dom selector='.cm-line.ag-cm-gallery-line' total
```

### Known traps during verification

- **`plugin:reload` does not guarantee that the new build is loaded**. If the previous build's promise
  is still pending (the usual cause is a native save dialog nobody answered), the old module stays in
  memory while the reload reports success. Always confirm the new code is live, for example by
  checking a symbol only the new build exports:
  ```bash
  obsidian vault=test eval code="typeof app.plugins.plugins['obsidian-autogallery'].savePdfPrefs"
  ```
  If the old shape is still reported, use `obsidian vault=test restart`.
- **`dev:dom` / `dev:screenshot` may return nothing while the window is minimised**
  (`document.hidden === true`). In that case switch to `eval` and assert on computed geometry: cell
  widths and `getComputedStyle` values, rather than on pixels.
- **PDF changes** must be verified in a real Vault with the `workspace:export-pdf` command. The native
  export's save dialog may still be open while Chromium prepares the print document — keep the
  plugin's temporary styles alive until `afterprint` or the bounded cleanup timer fires, never replace
  the native save flow, and never force focus onto the picker during CLI verification.
- **Remove diagnostic code**. Production logging or temporary notices are acceptable while diagnosing,
  but they must be gone once the issue is fixed.
- Static checks: `npm run build` and `git diff --check`.

---

## 6. Submission conventions

### 6.1 Branches

- `main` is the baseline branch; do not experiment on it directly.
- Suggested branch naming: `feature/<summary>`, `fix/<summary>`, `chore/<summary>`.
- Run `git status --short` before starting any coding session. If the working tree contains
  uncommitted changes, preserve them with `git stash push -u -m "agent checkpoint"` before starting
  unrelated work.

### 6.2 Commit messages

Existing commits use **short imperative subjects**, optionally with a scope, and occasionally a Chinese
description:

```
renderer: fix gallery width
pdf: keep a fitting heading block on its page
i18n: 加入中英双语适配与语言设置
docs: log pagination fit fixes
```

Conventions:

- The subject line is an English imperative, lowercase, starting with a verb; the scope is a module name
  (`renderer` / `pdf` / `editor` / `i18n` / `docs`).
- Keep the subject at 72 characters or fewer. Add a body explaining "why" when needed, especially for
  layout and PDF changes.
- Use the `docs:` prefix for documentation-only commits (such as this file).
- **The build artefact is committed alongside the sources**: after changing `src/` or `plugin.js`, run
  `npm run build` and include `main.js` in the same commit — the repository tracks `main.js`, and
  committing sources alone leaves the installed plugin inconsistent with the code.

### 6.3 Pull requests

A PR description must answer:

1. **What user-visible behaviour changed** (not "refactored module X").
2. **The list of verification commands** actually executed: `npm run build`, the CLI commands, and the
   Vault and note they were run against.
3. **DOM or screenshot evidence**: any PR touching the settings tab or other UI must include it. Output
   from a `dev:dom` assertion is acceptable evidence.
4. **Whether a Vault reload or a configuration migration is required**: when adding a setting, explain
   how `normalizeSettings` migrates an old configuration.
5. **Whether dual-view consistency was touched**: if the layout logic changed, state whether both the
   reading view and Live Preview were verified.

---

## 7. Troubleshooting quick reference

| Symptom | Root cause | What to do |
| --- | --- | --- |
| The same note lays out differently in the two views | Each view has its own grouping or packing logic | Extract it into shared `image-runs.js` / `layout.js` |
| An image renders as "60% of 60%" | The same percentage was written at both nesting levels | Write the percentage only on the outer block, `width: 100%` inside |
| A table column collapses into a thumbnail | An inline `width: 100% !important` inside the cell | Never apply a plugin width inside a table cell |
| A whole callout shrinks to a few hundred pixels | `readImageBlock` did not filter by owner | Filter by the nearest `td/th`/`li`/`.callout` |
| The note opens completely unstyled | A `ReferenceError` inside `applyLayout` aborted the pass | Reload the plugin, confirm `dev:errors` is empty and that gallery lines carry a `style` attribute |
| The viewport shakes while scrolling, or clicks hit the wrong line | The line geometry changed without refreshing CodeMirror's coordinate map | Call `EditorView.requestMeasure()` after dispatching the transaction |
| The note is unstyled in a background window | rAF is paused while the window is hidden | Give every rAF pass a `setTimeout` backstop |
| Extra blank lines appear around images | The `img.cm-widgetBuffer` placeholder node is still visible | Hide that placeholder node |
| Only one line remains on the last PDF page | The orphan parameters conflict with the native ones | Use `orphans: 1 / widows: 1` on the plugin side |
| PDF pages are off by a factor of 4/3 | pdf.js works in points, paper geometry in CSS pixels | The render scale must carry the 96/72 factor |
| The reload still behaves like the old build | The previous build's promise is pending and the old module is resident | Confirm with an `eval` on a new symbol, then `vault=test restart` |

---

## 8. Explicitly out of scope

- ❌ No new `tests/` directory, Vitest/jsdom dependency, or duplicate copy of production logic.
- ❌ No formatter / linter introduced to reflow existing code (it produces enormous unrelated diffs).
- ❌ Never replace Obsidian's native export flow (the plugin runs its own pipeline, see 4.6).
- ❌ Never rewrite the image reference syntax in the user's notes (except for the `ag:` parameters
  written on purpose by a drag or a click).
- ❌ The built-in `auto` profile must not become deletable, renameable or import-overridable.
- ❌ Do not create a parallel rules document outside `AGENTS.md` / `specifications/` — rule changes go into the matching file.

---

## 9. License

This project is licensed under [GPL-3.0-or-later](LICENSE).

Submitting a contribution means you agree that it is published under GPL-3.0-or-later.
