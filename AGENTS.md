# Repository Guidelines

Obsidian plugin (JavaScript) that lays out Markdown images into galleries, floats
and crops without rewriting the note. Entry point: [`plugin.js`](plugin.js);
implementation modules live in `src/`.

## How to use this repository's rules

`AGENTS.md` holds only the rules that apply to **every** change. Detailed,
topic-specific rules live in [`specifications/`](specifications/) and are loaded
on demand — read only the file that covers the area you are touching.
[`specifications/README.md`](specifications/README.md) is the index.

| Specification | Covers | Read it when you touch |
| --- | --- | --- |
| [`specifications/layout-core.md`](specifications/layout-core.md) | gallery formation, row packing, float geometry, width routing | `layout.js`, `routes.js`, `image-runs.js`, `float-order.js`, `src/config.json` |
| [`specifications/reading-view.md`](specifications/reading-view.md) | block splitting, section registration, virtualisation, scroll restoration | the preview renderer in `renderer.js`, `registerPreviewBlocks` in `plugin.js` |
| [`specifications/live-preview.md`](specifications/live-preview.md) | CodeMirror rows, reveal takeover, caption widgets, action bar, gallery handles, scroll stability | `editor-extension.js`, `embed-actions.js`, `image-metrics.js`, `gallery-handles.js` |
| [`specifications/nested-scopes.md`](specifications/nested-scopes.md) | callout / list / table ownership, table-only `ag:` parsing | `SCOPE_SELECTOR`, `readImageBlock`, `renderNestedScopes` |
| [`specifications/crop-resize.md`](specifications/crop-resize.md) | `ag:crop` / `ag:top`, crop dialog, drag resize, alignment arrows, frame policy for column drags | `crop-modal.js`, `crop-geometry.js`, `gallery-geometry.js`, `editor-resize.js` |
| [`specifications/pdf-export.md`](specifications/pdf-export.md) | exporter, print tree, export dialog, print geometry and styles | `pdf-export.js`, `pdf-session.js`, `pdf-export-modal.js`, `print-geometry.js`, `pdf-style.js` |
| [`specifications/pdf-pagination.md`](specifications/pdf-pagination.md) | page-break step table, orphan repair, single-image compression | `pdf-pagination.js` |
| [`specifications/validation.md`](specifications/validation.md) | app launch and lifetime, CLI exit-code trap, reload caveats, DOM assertions, PDF validation steps | any manual verification pass |

## Project Structure & Module Organization

`plugin.js` is the entry point (plugin class, commands, preview-block
registration, scroll anchoring). `src/` holds one module per concern:

- `renderer.js` — reading-view gallery rendering; `layout.js` — row packing and float width maths; `routes.js` — frontmatter routing and run mode.
- `image-runs.js` — the source-level image sequence: which image lines form one gallery, how blank lines separate them, and how a rendered embed maps back to its source line. Both views and the PDF path must use it.
- `gallery-geometry.js` / `gallery-handles.js` / `gesture-state.js` — column, row-height and reorder gestures. The geometry module is pure maths (frame policy, pair redistribution, minimum widths); the handle module owns the DOM, the pointer gestures and the single-transaction commits; `gesture-state.js` holds the geometry a drag is painting so decoration rebuilds keep showing it until the commit publishes.
- `annotations.js` — parses and writes `ag:` image parameters.
- `editor-extension.js` — Live Preview CodeMirror extension; `embed-actions.js` — action-bar placement; `image-metrics.js` — per-note image size cache; `image-sizes.js` — pixel size read from image file headers, so a gallery is laid out before its bitmaps decode.
- `crop-geometry.js` / `crop-modal.js` — crop maths and dialog; `editor-resize.js` — width drag gesture; `reset-images.js` — per-image and per-document reset.
- `pdf-export.js`, `pdf-session.js`, `pdf-export-modal.js`, `pdf-integration.js`, `pdf-pagination.js`, `print-geometry.js`, `pdf-style.js`, `print-theme.js` — the PDF pipeline.
- `settings-tab.js` — Obsidian settings UI; `defaults.js` and `config.json` — normalised settings and tunable layout constants; `profile-rules.js` / `profile-io.js` — profile rules and import/export; `i18n.js` + `src/locales/` — translations; `icons.js` — icon registry.

The repository contains only production plugin code; do not add a `tests/` tree or a duplicate test implementation. Root files include the plugin manifest and esbuild configuration.

`audit/` is the documentation claim ledger, not shipped code: `facts.json` is generated from the source, `claims.json` from every showcase surface, and `findings.md` records the adjudicated errors. `npm run check:docs` regenerates the first two and fails when a claim contradicts the code. Do not hand-edit `facts.json` or `claims.json`.

`demo/` is the bundled Chinese Obsidian vault and `demo-en/` its English mirror; both ship with each release. Each carries its own copy of the built plugin, a `BUILD.json` provenance stamp and the example notes; screenshots, videos and capture tooling stay out of both. `scripts/check-demo.mjs` fails when either copy drifts from the root `main.js`, when a vault is missing an asset directory, or when the English vault still contains Chinese body text.

## Capture Toolchain (`tools/capture/`)

The documentation site's stills, animations and videos are produced by scripts in
`tools/capture/`. They live here, not in a vault: the code is versioned with the
plugin, and the demo vault is only a target directory.

- **The vault path is configuration, not a constant.** `tools/capture/lib/vault.mjs`
  resolves `AG_VAULT`, then `tools/capture/vault.local.json`. There is no guessed
  fallback; a missing config fails loudly instead of writing into the wrong vault.
- **Two lanes, two mechanisms.** Content stills go through CDP `capturePage`
  (`shoot-batch.mjs`); motion and interface interaction — gestures, modals,
  hover states, drags — through Windows input injection plus screen recording,
  one scene file per figure (`tools/capture/winapp/scenes/`).
- **The figure list is the single source of truth.** `tools/capture/figures.json`
  says what should exist (with a per-figure `desc` stating the question the frame
  answers); the vault manifest says what does; `tools/capture/audit.mjs`
  regenerates the mapping table from both. Never keep a second hand-written list.
- **Delivery paths carry the variant.** Every asset exists in four cells —
  `media/<lang>/<theme>/<kind>/<id>.<ext>` — and the file name never encodes the
  language or the theme. `tools/capture/lib/media.mjs` is the only place that
  builds those paths; stills are WebP, never PNG or JPEG.
- **Never assert on pixels you did not just produce.** Every capture path either
  verifies with a DOM/CSS assertion in the renderer or refuses to write a file.
- `tools/capture/README.md` maps the files and the delivery spec;
  `tools/capture/recording.md` holds the operational rules and the
  recorded-pitfalls list; `tools/capture/winapp/README.md` records the measured
  behaviour of the injection and scene layers.


## Build and Development Commands

Run these commands from the repository root:

```powershell
npm install         # install dependencies
npm run dev         # produce a development build with source maps
npm run build       # produce the production main.js bundle
npm run check:demo  # verify demo/ and demo-en/ carry the same build as main.js
```

`npm run check:demo` is a static check: run it after every `npm run build`, before committing `demo/`, and before tagging a release. The bundle workflow rejects a demo vault whose plugin copy differs from the root build.

After `npm run build`, copy `main.js` and `manifest.json` into the target Vault's `.obsidian/plugins/obsidian-autogallery/` directory, reload the plugin with Obsidian CLI, and exercise the real command or view in the target Vault. See [`specifications/validation.md`](specifications/validation.md) for reload caveats and the assertions to use.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and double-quoted strings, matching the existing source. Prefer small named functions and explicit object properties. Use `camelCase` for variables/functions, `PascalCase` for classes, and descriptive kebab-case IDs for commands or profiles. Keep browser and Obsidian APIs isolated to the modules that already own them. No formatter or linter is configured, so keep changes consistent with nearby code.

## Validation Guidelines

Do not add, restore, or maintain Vitest/jsdom tests, test fixtures, `tests/`, or duplicate production logic. Validate behavior in a real Obsidian Vault with the installed Obsidian CLI: reload the plugin, open the target Markdown file, execute the relevant Obsidian command, and inspect the resulting view or exported artifact. Use production logging or temporary notices only when needed for diagnosis, and remove diagnostic output after the issue is fixed. `npm run build` and `git diff --check` remain valid static checks.

`plugin:reload` is not a guarantee: a previous build whose promise is still pending keeps its module in memory, so the reload reports success while the old code keeps running. Confirm the loaded build before trusting a test. Details and the DOM/geometry assertions are in [`specifications/validation.md`](specifications/validation.md).

## Obsidian Runtime: Launch, CLI and the Debug Port

Validation runs against a live app, so these facts apply to every change. All
were measured on Obsidian 1.14.5 (Windows) rather than inferred; when one of
them changes, change it here and in `specifications/validation.md`.

- **A process started inside a tool call dies when that call ends.** Launch and
  use the app within the same call. To keep it alive across calls, host it in a
  long-running background task — no launch flag detaches it on its own.
- **The debug port has to be passed at launch.** `--remote-debugging-port=9333`
  works on 1.14.5; the app does not exit because of it. An instance already
  running without the flag cannot acquire it later — starting the executable
  again only focuses the existing window and exits.
- **`Obsidian.com` returns exit code 0 when it fails.** It prints
  `The CLI is unable to find Obsidian.`, `Vault not found.` or `Error: ...` and
  still reports success. Never branch on `$?` for a CLI call: match the output
  text, or the caller will read an empty result as valid data.
- **An empty CLI result usually means the app was not running**, not that the
  vault holds no data. Check the process before debugging the command.
- **Screenshots need a visible window.** A minimised or background window has
  `document.hidden === true`; pixel capture comes back blank while `eval` and
  computed geometry still work. Assert on computed values, not pixels.
- **`HTTP_PROXY` also intercepts loopback.** `fetch("http://127.0.0.1:9333")`
  then fails with `ECONNREFUSED`, which is indistinguishable from "Obsidian is
  not running". Use `node:http` with `NO_PROXY`/`no_proxy` set for `127.0.0.1`.

Prefer the DevTools port for anything that must return a value (it echoes the
snippet's result verbatim); use the CLI for file, command and plugin operations,
where its structured output is the point. Procedures, error signatures and
recovery steps: [`specifications/validation.md`](specifications/validation.md).

### Keep one instance alive for a debugging session

A rebuild does need a fresh process — `plugin:reload` keeps the old module while
a previous build's promise is pending. But a *probe* does not, and relaunching
per attempt costs a build, a cold start, a stolen window focus and a lost scroll
position each time.

- Host the app in one long-running background task (`ensure-obsidian.sh && sleep
  3600`) for the whole session. Every probe then runs against the same
  instance, in the same state, within seconds.
- Batch the work around a rebuild: finish the edits, build once, restart once,
  then run every check in that session. Do not restart to "try again" — if a
  probe disagrees with itself, the probe is the problem, not the process.
- Five or more launches in a row is a signal that the loop is wrong: the
  question being asked can almost always be answered by a probe on the running
  instance.

### Reading-view probes must attach what they measure

The reading view virtualises. `renderer.sections` is legitimately empty right
after a view is created, and `sizer.children` only holds the blocks near the
viewport, so a probe that reads them once and prints "0 sections" is describing
its own timing, not a defect.

- Walk the scroller in steps (`scrollTop += clientHeight * 0.8`) to attach every
  section before measuring, then come back. A block that never attaches was
  never looked at.
- Pin the leaf: `getLeavesOfType("markdown").find(...)` happily returns another
  note. Open the file, then `setActiveLeaf(leaf)`, then read from that leaf.
- In-page snippets receive the args file as a **string** in `__AG_ARGS__`; parse
  it. A script whose args field is missing (for example `list` in
  `audit-sections.js`) returns `{}` and looks like "no data" rather than "no
  input".
- Measure the same thing before and after a change with the same probe. A
  screenshot only proves pixels when the window is visible.
- A preview showing one `.markdown-preview-pusher` and `renderer.sections === 0`
  with `renderer.lastText === null` is a **dead renderer**, not a layout result:
  the view has its text but never rendered it, `setViewState` and reopening the
  tab do not revive it, and it reproduces with the plugin disabled. Restart the
  app; do not go looking for a plugin bug in that state.

## Commit & Pull Request Guidelines

Existing commits use short imperative summaries, including occasional Chinese descriptions (for example, `update`). Keep new subjects concise and action-oriented; include a scope when useful, such as `renderer: fix gallery width`. Pull requests should explain the user-visible behavior, list validation commands, and include screenshots or DOM evidence for settings/UI changes. Mention any required Vault reload or migration step.

## Configuration & Compatibility

Keep `auto` as the built-in fallback profile. Treat `src/config.json` as the source for tunable width-ratio constants. Preserve cleanup behavior so disabling the plugin restores Obsidian's original image markup and styles.

For centered or gallery images, apply an explicit requested percentage to the
outer Markdown block only; nested `.image-embed`/`.internal-embed` elements
must use `width: 100%`. Never apply the same percentage to both nested levels,
because Obsidian then renders (for example) `60%` as `60% of 60%`. Add a DOM
regression assertion for the outer block width whenever changing renderer
layout selection.

An image belongs to exactly one layout scope: the nearest ancestor among
`td/th`, `li`, `.callout`, otherwise the section. A callout is claimed but
never decorated. A table cell never receives a plugin width or alignment.
Full rules: [`specifications/nested-scopes.md`](specifications/nested-scopes.md).

## Git Workflow for Agents

At the start of any coding session, run `git status --short`. If the working
tree contains uncommitted changes, preserve them with `git stash push -u -m
"agent checkpoint"` before starting unrelated work. Never maintain duplicate
production logic in tests. Modify the main source under `src/` or the plugin
entry point directly, then validate it through the real Obsidian CLI and target
Vault. This project explicitly forbids automated test-code dependencies for
feature validation.

When a rule changes, update it in the matching `specifications/` file (or in
this file if it is a repository-wide rule) — do not add a parallel rules
document.
