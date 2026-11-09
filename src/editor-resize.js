import { EditorView, ViewPlugin } from "@codemirror/view";
import { Notice, editorLivePreviewField, setIcon } from "obsidian";
import { extractImageAnnotation, updateImageAnnotation } from "./annotations.js";
import { CropModal } from "./crop-modal.js";
import { clearEmbedActionsPlacement, placeEmbedActions } from "./embed-actions.js";
import { IMAGE_LAYOUT_RESET } from "./reset-images.js";
import { t } from "./i18n.js";
import {
  applyCropToLine,
  clearGalleryHandles,
  galleryHandleTheme,
  resetGalleryCellAt,
  syncGalleryHandles
} from "./gallery-handles.js";

const MIN_PERCENT = 10;
const MAX_PERCENT = 100;
const DRAG_THRESHOLD = 3;
const RESIZING_CLASS = "ag-resizing";
const ALIGN_CLASS = "ag-align-action";
const FALLBACK_CLASS = "ag-resize-fallback";
const NATIVE_CORNER = ".image-resize-corner";
const EMBED_SELECTOR = ".image-embed, .internal-embed";
const ALIGN_GAP = 34;
// Width ratio at which the gutter beside the image is considered gone and the
// alignment arrows move inside the picture.
const ALIGN_INSET_RATIO = 0.85;
const IMAGE_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])?\s*(?:!\[[^\]]*\]\([^\n)]*\)|!\[\[[^\]]+\]\])\s*$/;
// The bar reads zoom, edit, crop, isolate, exclude, reset. The first two are
// Obsidian's own; the rest are appended in this order. Which of them appear is
// decided per image: exclude never applies inside a gallery, and crop/isolation
// are also dropped while `ag:exclude` is set.
const IMAGE_ACTION_ORDER = ["ag-crop-action", "ag-isolate-action", "ag-exclude-action", "ag-reset-action"];
const actionHandlers = new WeakMap();
// Icon names move between Lucide releases. Try the requested glyph first, then
// the historical aliases, so the button never ends up with an empty `<svg>`
// (which renders as a blank clickable square).
const ICON_FALLBACKS = {
  // Obsidian 1.10 ships Lucide without `link-2-off`; `unlink` is the closest
  // glyph (a chain cut by a slash), `unlink-2` its separated-halves variant.
  "link-2-off": ["link-2-off", "unlink", "unlink-2"],
  "circle-slash": ["circle-slash", "ban"]
};

let activeGesture = null;

/**
 * Live Preview image controls:
 * - Obsidian's native bottom-right corner drives the width drag; the plugin
 *   intercepts it in the capture phase because the built-in handler rewrites
 *   the whole image link on release and would destroy `ag:` parameters.
 * - A double click on the corner clears `ag:width` and returns to auto width.
 * - Always-visible arrows on the free side write `ag:side`.
 * - Width commits pin the alignment that is currently rendered, otherwise the
 *   auto router would re-float a centered image as soon as it gets narrower.
 */
export function createImageResizeExtension({ app = null, getSettings = () => ({}), setCropRatioPreset = null } = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.frame = null;
      this.frameTimer = null;
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(view.dom, { childList: true, subtree: true });
      this.onPointerDown = (event) => {
        if (event.button !== 0) return;
        const corner = event.target?.closest?.(NATIVE_CORNER);
        if (!corner) return;
        handleNativePointerDown(view, corner, event, getSettings(view));
      };
      this.onDoubleClick = (event) => {
        const corner = event.target?.closest?.(NATIVE_CORNER);
        if (!corner) return;
        handleNativeDoubleClick(view, corner, event, getSettings(view));
      };
      view.dom.addEventListener("pointerdown", this.onPointerDown, true);
      view.dom.addEventListener("dblclick", this.onDoubleClick, true);
      // Settings can hide the controls without touching the document.
      this.onSettingsChanged = () => this.schedule();
      view.dom.ownerDocument?.defaultView?.addEventListener("ag-settings-changed", this.onSettingsChanged);
      this.onLayoutChanged = () => this.schedule();
      view.dom.addEventListener("ag-layout-changed", this.onLayoutChanged);
      this.schedule();
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
    }

    schedule() {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        if (this.frameTimer !== null) {
          clearTimeout(this.frameTimer);
          this.frameTimer = null;
        }
        this.frame = null;
        syncControls(this.view, getSettings, app, setCropRatioPreset);
      });
      // rAF is paused while the window is hidden; keep the controls in sync.
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null;
        if (this.frame === null) return;
        cancelAnimationFrame(this.frame);
        this.frame = null;
        syncControls(this.view, getSettings, app, setCropRatioPreset);
      }, 200);
    }

    destroy() {
      this.observer.disconnect();
      this.view.dom.removeEventListener("pointerdown", this.onPointerDown, true);
      this.view.dom.removeEventListener("dblclick", this.onDoubleClick, true);
      this.view.dom.ownerDocument?.defaultView?.removeEventListener("ag-settings-changed", this.onSettingsChanged);
      this.view.dom.removeEventListener("ag-layout-changed", this.onLayoutChanged);
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      if (this.frameTimer !== null) clearTimeout(this.frameTimer);
      removeControls(this.view.dom);
      clearGalleryHandles(this.view.dom);
    }
  });

  const theme = EditorView.baseTheme({
    ...galleryHandleTheme,
    ".cm-line.ag-cm-image-line .ag-align-action": {
      position: "absolute",
      top: "50%",
      transform: "translateY(-50%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "26px",
      height: "26px",
      padding: "0",
      borderRadius: "6px",
      background: "var(--background-primary)",
      border: "1px solid var(--background-modifier-border)",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
      color: "var(--text-muted)",
      opacity: "0.85",
      pointerEvents: "auto",
      zIndex: "4"
    },
    ".cm-line.ag-cm-image-line .ag-align-action:hover": {
      opacity: "1",
      color: "var(--text-normal)",
      background: "var(--background-modifier-hover)"
    },
    // Obsidian pins the embed bar once the picture was clicked (`is-selected`)
    // and disables its hover reveal outright for a picture it measured as small
    // (`no-hover-actions`) - the class is added from a single early
    // `offsetWidth` read, so a picture the plugin later sizes correctly can
    // still carry it. Either way the bar would wait for a click while every
    // other control on the picture (the alignment arrows, a gallery cell's
    // reorder and merge buttons) follows the pointer. A managed picture is one
    // control group, so its bar must appear and disappear with the hover
    // instead of staying pinned after one click.
    ".cm-line.ag-cm-image-line .image-embed .embed-actions, .cm-line.ag-cm-image-line .internal-embed .embed-actions": {
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 120ms ease"
    },
    ".cm-line.ag-cm-image-line .image-embed:hover .embed-actions, .cm-line.ag-cm-image-line .internal-embed:hover .embed-actions, .cm-line.ag-cm-image-line .image-embed:focus-within .embed-actions, .cm-line.ag-cm-image-line .internal-embed:focus-within .embed-actions": {
      opacity: "1",
      pointerEvents: "auto"
    },
    // Obsidian paints `clickable-icon` with `--icon-color`, which is the muted
    // text colour; the embed bar next to these buttons uses `--text-normal`.
    // Without this override crop/exclude look greyed out beside zoom and edit.
    ".embed-actions > .ag-crop-action, .embed-actions > .ag-isolate-action, .embed-actions > .ag-exclude-action, .embed-actions > .ag-reset-action": {
      color: "var(--text-normal)"
    },
    ".embed-actions > .ag-isolate-action[data-ag-active=\"true\"], .embed-actions > .ag-exclude-action[data-ag-active=\"true\"]": {
      color: "var(--text-accent)"
    },
    ".cm-line.ag-cm-image-line .ag-align-action[data-side=\"left\"]": {
      left: `-${ALIGN_GAP}px`
    },
    ".cm-line.ag-cm-image-line .ag-align-action[data-side=\"right\"]": {
      right: `-${ALIGN_GAP}px`
    },
    ".cm-line.ag-cm-image-line .ag-align-action[data-inset=\"true\"][data-side=\"left\"]": {
      left: "6px"
    },
    ".cm-line.ag-cm-image-line .ag-align-action[data-inset=\"true\"][data-side=\"right\"]": {
      right: "6px"
    },
    // Inset arrows sit on top of the picture, so they must not stay visible.
    // Mirror the edit area at the top-right: reveal while the pointer is over
    // the image (or the controls hold focus), hide otherwise.
    ".cm-line.ag-cm-image-line .ag-align-action[data-inset=\"true\"]": {
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity 120ms ease"
    },
    // Once revealed the button sits on the artwork, so it borrows the exact
    // treatment of Obsidian's own embed action bar in the top-right corner:
    // the primary surface at 80% with a backdrop blur. Opaque
    // `--background-primary` reads as a black block on a picture, while a
    // partially transparent white would leave the icon illegible. The `color`
    // mix degrades to that opaque surface when the browser cannot parse it.
    ".cm-line.ag-cm-image-line .image-embed:hover .ag-align-action[data-inset=\"true\"], .cm-line.ag-cm-image-line .internal-embed:hover .ag-align-action[data-inset=\"true\"], .cm-line.ag-cm-image-line .image-embed:focus-within .ag-align-action[data-inset=\"true\"], .cm-line.ag-cm-image-line .internal-embed:focus-within .ag-align-action[data-inset=\"true\"]": {
      opacity: "1",
      pointerEvents: "auto",
      backgroundColor: "color-mix(in srgb, var(--background-primary) 80%, transparent)",
      backdropFilter: "blur(6px) saturate(1.5) brightness(1.15)",
      borderColor: "transparent",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05), 0 0 6px rgba(0, 0, 0, 0.05)",
      color: "var(--text-normal)"
    },
    ".cm-line.ag-cm-image-line .image-embed:hover .ag-align-action[data-inset=\"true\"]:hover, .cm-line.ag-cm-image-line .internal-embed:hover .ag-align-action[data-inset=\"true\"]:hover": {
      opacity: "1",
      // Layer the standard hover wash *over* the glass surface instead of
      // replacing it: a translucent hover colour alone would drop the 80%
      // backing and let a light picture swallow the icon.
      backgroundImage: "linear-gradient(var(--background-modifier-hover), var(--background-modifier-hover))",
      color: "var(--text-normal)"
    },
    // Only used when Obsidian did not render its own corner (older builds or
    // platforms where the native resizer is absent).
    ".cm-line.ag-cm-image-line .ag-resize-fallback": {
      position: "absolute",
      right: "6px",
      bottom: "6px",
      width: "10px",
      height: "10px",
      borderBottom: "var(--icon-stroke) solid var(--text-muted)",
      borderRight: "var(--icon-stroke) solid var(--text-muted)",
      borderBottomRightRadius: "4px",
      cursor: "nwse-resize",
      opacity: "0.55",
      pointerEvents: "auto",
      zIndex: "3"
    },
    "&.ag-resizing, &.ag-resizing *": {
      userSelect: "none !important",
      cursor: "ew-resize !important"
    }
  });

  return [plugin, theme];
}

function syncControls(view, getSettings, app, setCropRatioPreset) {
  const settings = getSettings?.(view) ?? {};
  if (!isLivePreview(view.state)) {
    removeControls(view.dom);
    return;
  }
  // A table cell editor is a nested CodeMirror whose document is just the
  // cell's content. Its `.cm-line` cannot be mapped back to the note, so the
  // outer editor owns the table's controls (`syncTableImageActions`).
  if (view.dom.closest?.(".table-cell-wrapper")) return;
  const resizeEnabled = settings?.resizeEnabled !== false;
  const alignEnabled = settings?.alignButtonsEnabled !== false;
  for (const line of view.dom.querySelectorAll(".cm-line")) {
    const embed = line.querySelector(EMBED_SELECTOR);
    if (!embed) continue;
    // Callout content stays native. Obsidian renders a callout as one opaque
    // block that cannot be live-edited, so controls written inside it would
    // offer edits the reader cannot reproduce while writing.
    if (embed.closest(".callout")) continue;
    const managed = line.classList.contains("ag-cm-image-line");
    const gallery = managed && line.classList.contains("ag-cm-gallery-line");
    // An image that just opted out of the layout keeps Obsidian's own styling,
    // so the arrows and the fallback corner must go with the takeover.
    if (!managed || gallery) removeLineControls(line);
    if (managed && !gallery) {
      syncFallbackCorner(view, line, embed, resizeEnabled, settings);
      if (alignEnabled) syncAlignActions(view, line, embed, settings);
      else removeAlignActions(embed);
    }
    syncImageActions(view, line, embed, gallery, app, getSettings, setCropRatioPreset);
  }
  for (const button of view.dom.querySelectorAll(".ag-crop-action, .ag-isolate-action, .ag-exclude-action, .ag-reset-action")) {
    if (!button.closest(".embed-actions")) button.remove();
  }
  // Tables are rendered by Obsidian's MarkdownRenderer, outside the `.cm-line`
  // pipeline above. Their pictures still carry crop/exclude annotations, so
  // they need the same controls and their own source-row resolution.
  syncTableImageActions(view, app, getSettings, setCropRatioPreset);
  // Column, row-height and reorder handles are placed from the geometry the
  // layout pass published, so this must run after that pass has written it.
  syncGalleryHandles(view, settings);
}

/**
 * Crop, isolate, exclude and reset live in Obsidian's own embed action bar.
 * Isolate only makes sense for a gallery member (or for an image that is
 * already isolated), exclude never applies inside a gallery, and while the
 * image is excluded every layout control is inert — only the exclude toggle
 * stays so the release can be undone. Crop applies everywhere it is not
 * excluded: a gallery row re-packs from the cropped ratio.
 */
function syncImageActions(view, line, embed, gallery, app, getSettings, setCropRatioPreset) {
  // Wiki embeds also cover notes, PDFs and canvases; those share the same bar
  // but must not receive image-only controls.
  if (!embed.classList.contains("image-embed") && !embed.querySelector("img")) return;
  const actions = embed.querySelector(":scope > .embed-actions") ?? embed.querySelector(".embed-actions");
  if (!actions) return;
  const source = sourceTextForLine(view, line);
  applyImageActions(
    view, embed, actions, gallery,
    IMAGE_LINE.test(source) ? extractImageAnnotation(source) : null,
    app, getSettings, setCropRatioPreset
  );
}

/**
 * Table images never get Obsidian's own embed action bar: the table is
 * MarkdownRenderer output, not a `.cm-line` widget. Build the bar and drive it
 * from the table's source row. The rendered block has no line element, so
 * `posAtDOM(table)` is the only stable anchor back into the document; the row
 * index then selects the line that owns this cell.
 */
function syncTableImageActions(view, app, getSettings, setCropRatioPreset) {
  for (const embed of view.dom.querySelectorAll(".table-wrapper .image-embed, .table-wrapper .internal-embed")) {
    if (!embed.classList.contains("image-embed") && !embed.querySelector("img")) continue;
    if (!embed.querySelector("img:not(.cm-widgetBuffer)")) continue;
    // A table rendered inside a callout belongs to the callout, which stays
    // entirely native.
    if (embed.closest(".callout")) continue;
    // A table keeps a hidden rendered copy while a cell is edited. A bar there
    // would be invisible, and creating it would leave the visible picture
    // without controls.
    if (!(embed.getBoundingClientRect().width > 0)) continue;
    const actions = ensureEmbedActionBar(embed);
    if (!actions) continue;
    const target = tableImageTarget(embed);
    const annotation = target
      ? extractImageAnnotation(target.view.state.doc.lineAt(target.position).text)
      : null;
    applyImageActions(
      view, embed, actions, false, annotation,
      app, getSettings, setCropRatioPreset, true
    );
  }
}

/** Create a bar for an embed that Obsidian rendered without one. */
function ensureEmbedActionBar(embed) {
  let actions = embed.querySelector(":scope > .embed-actions") ?? embed.querySelector(".embed-actions");
  if (!actions) {
    actions = embed.createDiv({ cls: "embed-actions" });
    actions.dataset.agTableOwned = "true";
  }
  return actions;
}

function applyImageActions(view, embed, actions, gallery, annotation, app, getSettings, setCropRatioPreset, insideOnly = false) {
  if (!annotation) {
    for (const name of IMAGE_ACTION_ORDER) removeImageAction(actions, name);
    if (actions.dataset.agTableOwned === "true" && !actions.children.length) actions.remove();
    // A line can stop being an image (or stop being excluded); returning the
    // bar to its native inset keeps a stale outside placement from lingering.
    placeEmbedActions(embed, { allowOutside: false });
    return;
  }
  const params = annotation.params ?? {};
  const excluded = params.exclude === true;
  const isolated = params.isolate === true;

  if (excluded) {
    removeImageAction(actions, "ag-crop-action");
    removeImageAction(actions, "ag-reset-action");
  } else {
    if (app) {
      ensureImageAction(actions, "ag-crop-action", "crop", t("自由剪裁"), false, (target) => {
        openCrop(app, view, target, getSettings, setCropRatioPreset);
      });
    } else {
      removeImageAction(actions, "ag-crop-action");
    }
    // Cropping is a display parameter, so a gallery cell needs it as much as a
    // single image: the row re-packs from the new ratio. Reset is shared too,
    // but a gallery cell owns no layout annotation - what it releases is the
    // crop a drag wrote, plus a hand-written row split that no longer describes
    // the run once its ratios changed.
    if (gallery) {
      ensureImageAction(actions, "ag-reset-action", "rotate-ccw", t("恢复初始状态"), false, (target) => {
        resetGalleryCellAt(view, target, getSettings?.(view) ?? {});
      });
    } else {
      ensureImageAction(actions, "ag-reset-action", "rotate-ccw", t("恢复自动布局"), false, (target) => {
        updateLine(view, target, IMAGE_LAYOUT_RESET);
      });
    }
  }

  if (excluded || !(gallery || isolated)) removeImageAction(actions, "ag-isolate-action");
  else {
    ensureImageAction(actions, "ag-isolate-action", "link-2-off",
      isolated ? t("取消隔离，回到画廊") : t("从画廊中隔离"), isolated,
      (target) => toggleImageFlag(view, target, "isolate"));
  }

  if (gallery) removeImageAction(actions, "ag-exclude-action");
  else {
    ensureImageAction(actions, "ag-exclude-action", "circle-slash",
      excluded ? t("恢复自动布局接管") : t("排除自动布局，恢复原生样式"), excluded,
      (target) => toggleImageFlag(view, target, "exclude"));
  }

  orderImageActions(actions);
  // Six controls do not fit a narrow picture; the bar then moves into the
  // gutter on the image's free side. Gallery cells and table cells keep the
  // bar inside their own box so it cannot answer for a neighbour.
  placeEmbedActions(embed, { allowOutside: !gallery && !insideOnly });
}

function toggleImageFlag(view, target, key) {
  const params = extractImageAnnotation(sourceTextForTarget(view, target))?.params ?? {};
  updateLine(view, target, { [key]: params[key] ? null : true });
}

function sourceTextForTarget(view, target) {
  if (target && typeof target === "object" && Number.isFinite(target.position)) {
    const actionView = target.view ?? view;
    return actionView.state.doc.lineAt(target.position).text;
  }
  return sourceTextForLine(view, target);
}

/**
 * Map a table embed back to the source line that owns its cell. `posAtDOM` on
 * the table returns the widget's first source line; header rows come first,
 * then one separator line, then one line per body row. Fall back to scanning
 * the table's own lines for the image if a build reports a different anchor.
 */
function tableImageTarget(embed) {
  const table = embed.closest("table");
  if (!table) return null;
  const view = outerEditorViewFor(embed, table);
  if (!view) return null;
  let start = -1;
  try { start = view.posAtDOM(table); } catch { return null; }
  if (!(start >= 0)) return null;
  const first = view.state.doc.lineAt(start);
  const rows = [...table.querySelectorAll("tr")];
  const rowIndex = Math.max(0, rows.indexOf(embed.closest("tr")));
  const scanEnd = Math.min(view.state.doc.lines, first.number + rows.length + 2);
  const link = embed.getAttribute("src") || embed.querySelector("img")?.getAttribute("src") || "";
  const imageLine = (line) => /!\[/.test(line.text) && line.text.includes("|");
  const guess = first.number + (rowIndex > 0 ? rowIndex + 1 : 0);
  if (guess <= scanEnd && imageLine(view.state.doc.line(guess))) {
    return { view, position: view.state.doc.line(guess).from, embed };
  }
  for (let number = first.number; number <= scanEnd; number += 1) {
    const line = view.state.doc.line(number);
    if (imageLine(line) && (!link || line.text.includes(link))) {
      return { view, position: line.from, embed };
    }
  }
  return null;
}

/** Nearest CodeMirror whose content actually contains the table. */
function outerEditorViewFor(node, table) {
  let editor = node.closest?.(".cm-editor") ?? null;
  while (editor) {
    const view = EditorView.findFromDOM(editor);
    if (view?.contentDOM?.contains(table)) return view;
    editor = editor.parentElement?.closest?.(".cm-editor") ?? null;
  }
  return null;
}

/** Resolve the document target for a control at click time. */
function resolveActionTarget(button) {
  const embed = button.closest?.(EMBED_SELECTOR);
  // Table pictures - rendered or inside a cell editor - resolve through the
  // table's source row. A cell editor has a `.cm-line` of its own, but that
  // line belongs to a nested document, not to the note.
  if (embed?.closest("table")) {
    const target = tableImageTarget(embed);
    if (target) return target;
  }
  const line = button.closest?.(".cm-line");
  if (line) return line;
  return embed ? tableImageTarget(embed) : null;
}

function ensureImageAction(actions, className, icon, label, active, activate) {
  let button = actions.querySelector(`:scope > .${className}`);
  if (!button) {
    button = actions.ownerDocument.createElement("button");
    button.className = `clickable-icon ${className}`;
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Resolve the target from the event: the widget may have been
      // re-rendered since this button was injected, and a table image has no
      // `.cm-line` to read.
      const target = resolveActionTarget(button);
      const handler = actionHandlers.get(button);
      if (target && handler) handler(target);
    });
    actions.appendChild(button);
  }
  // Re-render the glyph when the requested icon changed, so reloading the
  // plugin is not required after an icon rename.
  if (button.dataset.agIconKey !== icon) applyIcon(button, icon);
  actionHandlers.set(button, activate);
  const activeValue = active ? "true" : "false";
  // Attribute writes are cheap but not free, and this runs on every animation
  // frame while scrolling; only touch the DOM when the state really moved.
  if (button.dataset.agActive !== activeValue) button.dataset.agActive = activeValue;
  if (className === "ag-isolate-action" || className === "ag-exclude-action") {
    if (button.getAttribute("aria-pressed") !== activeValue) button.setAttribute("aria-pressed", activeValue);
  }
  if (button.getAttribute("aria-label") !== label) {
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
}

function removeImageAction(actions, className) {
  actions.querySelector(`:scope > .${className}`)?.remove();
}

/**
 * Obsidian renames Lucide glyphs between releases (`link-2-off` became
 * `unlink-2`, for example) and `setIcon` silently renders nothing for an
 * unknown name. Try the requested name, then its aliases, and remember which
 * one stuck so the sync loop does not re-render the SVG on every frame.
 */
function applyIcon(button, icon) {
  const applied = (ICON_FALLBACKS[icon] ?? [icon]).find((candidate) => {
    setIcon(button, candidate);
    return button.querySelector("svg")?.childElementCount > 0;
  });
  button.dataset.agIcon = applied ?? "";
  button.dataset.agIconKey = icon;
}

function orderImageActions(actions) {
  const present = IMAGE_ACTION_ORDER
    .map((name) => actions.querySelector(`:scope > .${name}`))
    .filter(Boolean);
  const rendered = [...actions.children]
    .filter((child) => IMAGE_ACTION_ORDER.some((name) => child.classList.contains(name)));
  if (present.length === rendered.length && present.every((button, index) => button === rendered[index])) return;
  // Appending in order also moves existing nodes; the native zoom and edit
  // buttons always stay ahead of the plugin's controls.
  for (const button of present) actions.appendChild(button);
}

function syncFallbackCorner(view, line, embed, enabled, settings) {
  const native = embed.querySelector(`:scope > ${NATIVE_CORNER}`);
  const fallback = embed.querySelector(`:scope > .${FALLBACK_CLASS}`);
  if (native || !enabled) {
    fallback?.remove();
    return;
  }
  if (fallback) return;
  const corner = line.ownerDocument.createElement("span");
  corner.className = FALLBACK_CLASS;
  corner.setAttribute("aria-hidden", "true");
  corner.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activeGesture) return;
    event.preventDefault();
    event.stopPropagation();
    const liveLine = corner.closest(".cm-line");
    const liveEmbed = corner.closest(EMBED_SELECTOR);
    if (!liveLine || !liveEmbed) return;
    beginResize(view, liveLine, liveEmbed, event);
  });
  embed.appendChild(corner);
}

function syncAlignActions(view, line, embed, settings) {
  const computed = embed.ownerDocument?.defaultView?.getComputedStyle?.(embed);
  const floatSide = computed?.float;
  // A list picture never floats - its item's box has to stay tall enough to
  // hold it - so `float` is always `none` there and says nothing about the
  // alignment. The annotation is the only honest source: `ag:layout=center`
  // and `ag:side` decide which edge the block sits on. Reading `float` here is
  // what made every list picture look centred and offer both arrows, including
  // the arrow towards the side it already sat on.
  const list = line.classList.contains("ag-cm-list-line");
  const listAlign = list ? listAlignmentForLine(view, line) : null;
  const lineWidth = lineContentWidth(line);
  const embedWidth = embed.getBoundingClientRect?.().width ?? 0;
  // A full-bleed image has nothing to align: every side renders the same, so
  // the controls would be dead. The alignment parameters are left untouched in
  // the note and apply again as soon as the reader narrows the image.
  if (lineWidth > 0 && embedWidth >= lineWidth - 1) {
    removeAlignActions(embed);
    return;
  }
  // Arrows only offer the positions the picture is not already in. A left
  // picture keeps the way back to the centre, a right one the same on its own
  // side, and a centred one both edges. A centred picture may be full width;
  // the click handler narrows it to a floatable width instead of leaving a
  // dead button.
  const sides = list
    ? listAlign === "left" ? ["right"] : listAlign === "right" ? ["left"] : ["left", "right"]
    : floatSide === "left"
      ? ["right"]
      : floatSide === "right"
        ? ["left"]
        : ["left", "right"];
  const backToCenter = list ? listAlign !== "center" : floatSide === "left" || floatSide === "right";
  // Arrows sit in the gutter beside the image. When the image is wide enough
  // that the gutter is gone — a full-width centred picture, or a float the
  // reader widened past the threshold — place them inside the image instead.
  // Inset arrows are hover-only, so covering a corner costs nothing.
  const inset = lineWidth > 0
    && (embedWidth + ALIGN_GAP + 6 > lineWidth || embedWidth / lineWidth >= ALIGN_INSET_RATIO);
  const existing = [...embed.querySelectorAll(`:scope > .${ALIGN_CLASS}`)];
  const key = `${sides.join(",") || "none"}|${inset ? 1 : 0}|${backToCenter ? "center" : "side"}`;
  if (embed.dataset.agAlign === key && existing.length === sides.length) return;
  for (const button of existing) button.remove();
  embed.dataset.agAlign = key;
  for (const side of sides) {
    const button = line.ownerDocument.createElement("button");
    // A picture already on an edge only offers the way back to the centre; a
    // centred one offers both sides.
    const label = backToCenter
      ? t("居中")
      : side === "left" ? t("靠左") : t("靠右");
    button.className = `clickable-icon ${ALIGN_CLASS}`;
    button.dataset.side = side;
    button.dataset.inset = inset ? "true" : "false";
    button.setAttribute("contenteditable", "false");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    setIcon(button, side === "left" ? "chevron-left" : "chevron-right");
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const liveLine = event.currentTarget?.closest?.(".cm-line");
      const liveEmbed = event.currentTarget?.closest?.(EMBED_SELECTOR);
      if (!liveLine || !liveEmbed) return;
      let patch;
      if (liveLine.classList.contains("ag-cm-list-line")) {
        // `layout=float` is meaningless inside a list item: the picture is a
        // block on the item's axis. Record the side alone, and clear the flag
        // a previous top-level float may have left behind.
        const liveAlign = listAlignmentForLine(view, liveLine);
        patch = liveAlign === "center"
          ? { side, layout: null }
          : { layout: "center", side: null };
      } else {
        const liveSide = liveEmbed.ownerDocument?.defaultView?.getComputedStyle?.(liveEmbed)?.float;
        patch = liveSide === "left" || liveSide === "right"
          ? { layout: "center", side: null }
          : { side, layout: "float" };
      }
      // Each alignment used to compute its own automatic width, so switching
      // sides changed the picture's size and left nothing in the note to
      // explain why. Freeze the width that is on screen as a manual parameter:
      // the click becomes a recorded decision and later renders keep the size.
      const current = extractImageAnnotation(sourceTextForLine(view, liveLine))?.params ?? {};
      if (!Number.isFinite(current.width)) {
        const containerWidth = lineContentWidth(liveLine)
          || liveLine.parentElement?.clientWidth
          || 0;
        const embedWidth = liveEmbed.getBoundingClientRect?.().width ?? 0;
        if (containerWidth > 0 && embedWidth > 0) {
          patch.width = clampPercent(embedWidth / containerWidth * 100);
        }
      }
      updateLine(view, liveLine, patch);
    });
    embed.appendChild(button);
  }
}

function removeAlignActions(embed) {
  for (const button of embed.querySelectorAll?.(`:scope > .${ALIGN_CLASS}`) ?? []) button.remove();
  delete embed.dataset.agAlign;
}

function openCrop(app, view, target, getSettings, setCropRatioPreset) {
  const descriptor = target && typeof target === "object" && Number.isFinite(target.position) ? target : null;
  const actionView = descriptor?.view ?? view;
  const line = descriptor ? null : target;
  // Read settings at click time: the button outlives many sync passes and a
  // captured snapshot would keep the old remembered crop ratio.
  const settings = getSettings?.(actionView) ?? {};
  const embed = descriptor?.embed ?? line?.querySelector(EMBED_SELECTOR);
  const image = embed?.querySelector("img:not(.cm-widgetBuffer)")
    ?? line?.querySelector("img:not(.cm-widgetBuffer)");
  let position = descriptor?.position ?? -1;
  if (!(position >= 0)) {
    try { position = actionView.posAtDOM(line, 0); } catch { return; }
  }
  if (!(position >= 0)) return;
  const text = actionView.state.doc.lineAt(position).text;
  const link = linkTargetFromText(text) || embed?.getAttribute("alt") || "";
  const src = image?.currentSrc || image?.src || resolveImageSource(app, link);
  if (!src) {
    new Notice(t("无法定位这张图片，暂时不能剪裁。"));
    return;
  }
  const annotation = extractImageAnnotation(text);
  const apply = (patch) => {
    // Re-read the line at commit time; the modal can stay open across edits.
    // A bound gallery row cannot push a picture out to make room, so the write
    // goes through the layer that can rebalance the rest of the row.
    applyCropToLine(actionView, { position }, patch, settings);
  };
  new CropModal(app, {
    src,
    title: imageName(link),
    ratioPreset: settings?.cropRatioPreset ?? "free",
    onRatioChange: (value) => setCropRatioPreset?.(value),
    crop: annotation?.params?.crop ?? null,
    onSave: ({ crop }) => apply({ crop }),
    onReset: () => apply({ crop: null })
  }).open();
}

function resolveImageSource(app, link) {
  if (!app || !link) return "";
  const sourcePath = app.workspace?.getActiveFile?.()?.path ?? "";
  const file = app.metadataCache?.getFirstLinkpathDest?.(link, sourcePath);
  if (!file) return "";
  try {
    return app.vault.adapter.getResourcePath(file.path);
  } catch {
    return "";
  }
}

function imageName(link) {
  const text = String(link ?? "").trim();
  if (!text) return "";
  const parts = text.split("/");
  return parts[parts.length - 1] || text;
}

function linkTargetFromText(text) {
  if (!text) return "";
  const wiki = /!\[\[([^\]|#]+)/.exec(text);
  if (wiki) return wiki[1].trim();
  const markdown = /!\[[^\]]*\]\(\s*<?([^)>\s]+)/.exec(text);
  if (!markdown) return "";
  try {
    return decodeURIComponent(markdown[1]);
  } catch {
    return markdown[1];
  }
}

function sourceTextForLine(view, line) {
  let position = -1;
  try {
    position = view.posAtDOM(line, 0);
  } catch {
    return "";
  }
  return position < 0 ? "" : view.state.doc.lineAt(position).text;
}

/**
 * Width a picture is laid out against. A list item's line is padded by the
 * indentation its marker hangs in, and the layout pass measures the item's
 * content column, so a drag or an alignment click has to use the same number
 * or the committed percentage is wrong by the indent.
 */
function lineContentWidth(line) {
  if (!line) return 0;
  const indent = line.classList?.contains("ag-cm-list-line")
    ? Number.parseFloat(getComputedStyle(line).paddingInlineStart) || 0
    : 0;
  return Math.max(0, (line.clientWidth || 0) - indent);
}

/**
 * Alignment a list picture is drawn with: `left` unless the annotation asks
 * for the centre or the right edge. A list picture is a block on the item's
 * axis, never a float, so `getComputedStyle(embed).float` cannot answer this.
 */
function listAlignmentForLine(view, line) {
  if (!line?.classList?.contains("ag-cm-list-line")) return null;
  const params = extractImageAnnotation(sourceTextForLine(view, line))?.params ?? {};
  if (params.layout === "center" || params.side === "center") return "center";
  return params.side === "right" ? "right" : "left";
}

function handleNativePointerDown(view, corner, event, settings) {
  const line = corner.closest(".cm-line.ag-cm-image-line");
  const embed = corner.closest(EMBED_SELECTOR);
  if (!line || !embed) return;
  // Obsidian's handler writes the width back into the image link and would
  // overwrite `ag:` parameters. Always swallow it, even when our own resize is
  // disabled.
  event.preventDefault();
  event.stopPropagation();
  // Gallery widths come from row packing; a manual width would break the row.
  if (line.classList.contains("ag-cm-gallery-line")) return;
  if (settings?.resizeEnabled === false || activeGesture) return;
  beginResize(view, line, embed, event);
}

function handleNativeDoubleClick(view, corner, event, settings) {
  const line = corner.closest(".cm-line.ag-cm-image-line");
  if (!line) return;
  // The native double click strips the size from the link, which would also
  // strip an ag: annotation. Replace it with an explicit width reset.
  event.preventDefault();
  event.stopPropagation();
  if (line.classList.contains("ag-cm-gallery-line")) return;
  if (settings?.resizeEnabled === false) return;
  updateLine(view, line, { width: null });
}

function beginResize(view, line, embed, event) {
  const rect = embed.getBoundingClientRect();
  const startWidth = rect.width;
  const startHeight = rect.height;
  const containerWidth = lineContentWidth(line)
    || line.parentElement?.clientWidth
    || line.closest?.(".cm-content")?.clientWidth
    || 0;
  if (!(startWidth > 0 && containerWidth > 0)) return;
  const aspect = startHeight > 0 ? startWidth / startHeight : 1;
  // Pin the alignment the reader currently sees. Reading it once keeps a
  // mid-drag reflow from changing the committed side. A list picture has no
  // float to read, so its annotation answers instead.
  const side = listAlignmentForLine(view, line)
    ?? embed.ownerDocument?.defaultView?.getComputedStyle?.(embed)?.float
    ?? "none";

  const documentRef = view.dom.ownerDocument;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const originalVar = embed.style.getPropertyValue("--ag-embed-width");
  const originalPriority = embed.style.getPropertyPriority("--ag-embed-width");
  // A floated image is capped at the float threshold. Without lifting that cap
  // the pointer stops moving the edge at the threshold and the gesture looks
  // stuck until release. The committed width is written on release anyway, so
  // the preview may follow the pointer across the whole column.
  const originalMaxWidth = embed.style.getPropertyValue("--ag-embed-max-width");
  const originalMaxWidthPriority = embed.style.getPropertyPriority("--ag-embed-max-width");
  embed.style.setProperty("--ag-embed-max-width", "100%", "important");
  let percent = clampPercent(startWidth / containerWidth * 100);
  let moved = false;
  let finished = false;

  event.preventDefault();
  event.stopPropagation();
  try {
    embed.setPointerCapture(pointerId);
  } catch {
    /* Pointer capture is an optimization. */
  }
  view.dom.dataset.agResizing = "1";
  view.dom.classList.add(RESIZING_CLASS);
  activeGesture = { kind: "resize", view, line };

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    // A mouse can be released outside the window without a pointerup.
    if (moveEvent.pointerType === "mouse" && moveEvent.buttons === 0) {
      finish(false);
      return;
    }
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    // Follow the diagonal corner handle: horizontal travel drives the width,
    // vertical travel is translated through the current aspect ratio.
    const delta = Math.abs(dx) >= Math.abs(dy * aspect) ? dx : dy * aspect;
    if (!moved && Math.abs(delta) < DRAG_THRESHOLD) return;
    moved = true;
    const width = Math.min(containerWidth, Math.max(40, startWidth + delta));
    percent = clampPercent(width / containerWidth * 100);
    embed.style.setProperty("--ag-embed-width", `${width}px`, "important");
    // The caption is a widget in the line, not a child of the embed: it reads
    // `--ag-embed-width` from the line, which the drag does not touch. Painting
    // it here keeps the caption's edges on the picture's edges while the
    // pointer moves, instead of snapping after the commit.
    applyCaptionWidth(line, width);
    moveEvent.preventDefault();
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (keyEvent) => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    finish(false);
  };
  const onSelectStart = (selectEvent) => selectEvent.preventDefault();
  const onDragStart = (dragEvent) => dragEvent.preventDefault();

  documentRef.addEventListener("pointermove", onMove, true);
  documentRef.addEventListener("pointerup", onUp, true);
  documentRef.addEventListener("pointercancel", onCancel, true);
  documentRef.addEventListener("keydown", onKey, true);
  documentRef.addEventListener("selectstart", onSelectStart, true);
  documentRef.addEventListener("dragstart", onDragStart, true);
  embed.addEventListener("lostpointercapture", onCancel, { once: true });

  function finish(commit) {
    if (finished) return;
    finished = true;
    documentRef.removeEventListener("pointermove", onMove, true);
    documentRef.removeEventListener("pointerup", onUp, true);
    documentRef.removeEventListener("pointercancel", onCancel, true);
    documentRef.removeEventListener("keydown", onKey, true);
    documentRef.removeEventListener("selectstart", onSelectStart, true);
    documentRef.removeEventListener("dragstart", onDragStart, true);
    embed.removeEventListener("lostpointercapture", onCancel);
    delete view.dom.dataset.agResizing;
    view.dom.classList.remove(RESIZING_CLASS);
    activeGesture = null;
    try {
      if (embed.hasPointerCapture?.(pointerId)) embed.releasePointerCapture(pointerId);
    } catch {
      /* The embed may already be detached. */
    }
    if (!commit || !moved) {
      restoreWidth();
      return;
    }
    // Leave the preview value in place until the decoration re-applies the
    // committed width, then hand ownership back to the layout pass.
    writeWidth(view, line, percent, side);
    clearAfterLayout(view, line, embed);
    swallowNextClick(documentRef);
  }

  function restoreWidth() {
    if (originalVar) embed.style.setProperty("--ag-embed-width", originalVar, originalPriority || "");
    else embed.style.removeProperty("--ag-embed-width");
    if (originalMaxWidth) embed.style.setProperty("--ag-embed-max-width", originalMaxWidth, originalMaxWidthPriority || "");
    else embed.style.removeProperty("--ag-embed-max-width");
    // Hand the caption back to the published width as well; the next pass
    // rewrites the same variable form, so this only covers the cancelled drag.
    resetCaptionWidth(line);
  }
}

/**
 * Width a caption is painted with while its picture is being dragged.
 *
 * `positionCaptionWidgets` normally expresses this as `var(--ag-embed-width)`.
 * During a width drag the live width lives on the embed, which the caption does
 * not inherit from, so the value is written in pixels for the duration of the
 * gesture. The layout pass restores the variable form on its next run.
 */
function applyCaptionWidth(line, width) {
  for (const caption of line?.querySelectorAll?.(".ag-cm-caption") ?? []) {
    paintCaptionWidth(caption, `${width}px`);
  }
}

function resetCaptionWidth(line) {
  for (const caption of line?.querySelectorAll?.(".ag-cm-caption") ?? []) {
    paintCaptionWidth(caption, "var(--ag-embed-width, 100%)");
  }
}

function paintCaptionWidth(caption, value) {
  const host = caption.parentElement;
  if (host && !host.classList?.contains("cm-line")) {
    host.style.setProperty("width", value, "important");
  }
  caption.style.setProperty("width", value, "important");
}

/**
 * Pin the rendered alignment together with the width. Without this the auto
 * router treats an explicit width as a float request and a centered image
 * jumps to the side as soon as it is resized.
 *
 * The side is kept even when the committed width exceeds `floatMax`: the width
 * came from a deliberate gesture, and manual parameters outrank automatic
 * routing. `floatMax` only governs widths the plugin computes on its own.
 */
function alignmentPatch(side) {
  if (side === "left" || side === "right") return { side, layout: "float" };
  return { layout: "center", side: null };
}

function writeWidth(view, line, percent, side) {
  // A list picture is aligned as a block, so `layout=float` would be a
  // parameter the layout ignores. Record the edge it was drawn on instead, and
  // clear a float flag that followed the picture in from a top-level block.
  if (line?.classList?.contains("ag-cm-list-line")) {
    const align = side === "right" || side === "left" || side === "center" ? side : "left";
    updateLine(view, line, {
      width: percent,
      ...(align === "center" ? { layout: "center", side: null } : { side: align === "left" ? null : align, layout: null })
    });
    return;
  }
  updateLine(view, line, { width: percent, ...alignmentPatch(side) });
}

function updateLine(view, target, patch) {
  const descriptor = target && typeof target === "object" && Number.isFinite(target.position) ? target : null;
  const actionView = descriptor?.view ?? view;
  let position = descriptor?.position ?? -1;
  if (!(position >= 0)) {
    try {
      position = actionView.posAtDOM(target, 0);
    } catch {
      return;
    }
  }
  if (!(position >= 0)) return;
  const docLine = actionView.state.doc.lineAt(position);
  const updated = updateImageAnnotation(docLine.text, patch);
  if (!updated || updated === docLine.text) return;
  actionView.dispatch({ changes: { from: docLine.from, to: docLine.to, insert: updated } });
  // A width or float change alters line geometry without changing the document
  // length in a way CodeMirror can infer, so rebuild the coordinate map.
  actionView.requestMeasure();
  requestAnimationFrame(() => actionView.requestMeasure());
}

function clearAfterLayout(view, line, embed) {
  let attempts = 0;
  const clear = () => {
    if (!embed.isConnected || attempts++ > 30) return;
    // Wait until the decoration has published the committed width on the line;
    // removing the inline value earlier would flash the fallback width.
    if (!line.style.getPropertyValue("--ag-embed-width")) {
      requestAnimationFrame(clear);
      return;
    }
    embed.style.removeProperty("--ag-embed-width");
    view.requestMeasure();
  };
  requestAnimationFrame(clear);
}

function swallowNextClick(documentRef) {
  const swallow = (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
  };
  documentRef.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => documentRef.removeEventListener("click", swallow, { capture: true }), 300);
}

function removeLineControls(line) {
  for (const element of line.querySelectorAll?.(`.${ALIGN_CLASS}, .${FALLBACK_CLASS}`) ?? []) {
    element.remove();
  }
  for (const embed of line.querySelectorAll?.(EMBED_SELECTOR) ?? []) delete embed.dataset.agAlign;
}

function removeControls(root) {
  for (const element of root.querySelectorAll?.(`.${ALIGN_CLASS}, .${FALLBACK_CLASS}`) ?? []) {
    element.remove();
  }
  for (const embed of root.querySelectorAll?.(EMBED_SELECTOR) ?? []) delete embed.dataset.agAlign;
  for (const button of root.querySelectorAll?.(".ag-crop-action, .ag-isolate-action, .ag-exclude-action, .ag-reset-action") ?? []) button.remove();
  clearEmbedActionsPlacement(root);
}

function clampPercent(value) {
  const percent = Math.round(Number(value) || 0);
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, percent));
}

function isLivePreview(state) {
  try {
    return state.field(editorLivePreviewField, false) === true;
  } catch {
    return false;
  }
}
