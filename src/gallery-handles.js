/**
 * Interactive handles for a gallery row.
 *
 * Three gestures live here, and all of them are authored in the same currency:
 * a cell's frame ratio. A cell's width is `rowHeight * ratio`, so dragging a
 * boundary only rewrites the two `ag:crop` values, and dragging the row's
 * bottom bar rewrites all of them. Nothing stores a pixel width - which is why
 * the reading view and the PDF export follow for free.
 *
 * Every gesture previews through CSS custom properties and commits once on
 * release, so a whole drag is one CodeMirror transaction and one undo step.
 */
import { Notice, editorInfoField, setIcon } from "obsidian";
import config from "./config.json";
import { t } from "./i18n.js";
import { extractImageAnnotation, updateImageAnnotation } from "./annotations.js";
import { groupImageRecords, readListImageLayout, readSourceImages } from "./image-runs.js";
import { imageMetric, imageMetricKey } from "./image-metrics.js";
import { embedActionMetrics } from "./embed-actions.js";
import { gestureGeometry } from "./gesture-state.js";
import { effectiveCropRatio, viewBoxValue } from "./crop-geometry.js";
import {
  cellRatio,
  clamp,
  cropPatchForRatio,
  cropShrinkWidth,
  frameRegion,
  heightScaleFactor,
  mergeShrinkPlan,
  minimumCellWidth,
  naturalRatio,
  regionForRatio,
  resizePair
} from "./gallery-geometry.js";

const DIVIDER_CLASS = "ag-gallery-divider";
const HEIGHT_CLASS = "ag-gallery-height";
const ORDER_CLASS = "ag-gallery-order";
const LINK_CLASS = "ag-gallery-link";
const BUTTON_CLASS = "ag-gallery-button";
const HANDLE_SELECTOR = ".ag-gallery-divider, .ag-gallery-height, .ag-gallery-order, .ag-gallery-link";
const ACTIVE_CLASS = "is-active";
const DRAGGING_CLASS = "ag-gallery-dragging";
const RESIZING_CLASS = "ag-resizing";
// A bar owns its own activation. Both bars are direct children of the cell they
// belong to, so hovering one also hovers that embed, and the cell's reorder,
// link and native action buttons would light up while the reader is only
// reaching for the bar. `is-active` carries the same claim through the whole
// drag, so a pointer that leaves the 12px hot zone cannot hand the overlays
// back mid-gesture. Both bars are listed here so the divider and the height bar
// cannot drift apart - the divider originally had no suppression at all.
const BAR_STATES = [
  ".ag-gallery-divider:hover",
  ".ag-gallery-divider.is-active",
  ".ag-gallery-height:hover",
  ".ag-gallery-height.is-active"
];
// Holding the cell overlays hidden across the release. The row's handles are
// rebuilt once the committed geometry is published, which replaces the bar
// under the pointer; the browser drops the bar's `:hover` in that instant, the
// embed becomes the hovered element, and the overlays start fading in until the
// new bar lands and its `:has(…)` suppression applies again. That is the flash
// on release. The native action bar is held too: while the bar is missing from
// the DOM no `:has()` rule can answer for it.
const SETTLING_CLASS = "ag-gesture-settling";
const SETTLE_MS = 320;
const HOT_ZONE = 12;
const DRAG_THRESHOLD = 3;
const DEFAULT_MAX_HEIGHT = 600;
const FLOOR_HEIGHT = 40;
// The native embed-action tray and the buttons inside it, measured from
// Obsidian's own `.embed-actions` / `.clickable-icon` so the plugin's controls
// and the native ones read as one group. Copied values, not approximations.
const TRAY_PAD = 2;
const TRAY_GAP = 2;
const BUTTON_WIDTH = 28;
const BUTTON_HEIGHT = 24;
const CONTROL_INSET = 8;
const CLUSTER_GAP = 6;
// Breathing room between the moved column and the controls above/below it.
const STACK_GAP = 8;
const TRAY_BACKGROUND = "color-mix(in srgb, var(--background-primary) 80%, transparent)";
const TRAY_SHADOW = "0 1px 2px rgba(0, 0, 0, 0.05), 0 0 6px rgba(0, 0, 0, 0.05)";
const TRAY_BLUR = "blur(6px) saturate(1.5) brightness(1.15)";
const PAINTED_PROPERTIES = [
  "height", "width", "transform", "margin-left",
  // Row geometry the height drag republishes. They are not part of the crop
  // preview, so leaving them out of the snapshot left a cancelled drag with the
  // row box of the gesture and no edit in the document to explain it.
  "--ag-row-height", "--ag-row-box", "--ag-row-natural-height", "--ag-row-content", "--ag-row-inset",
  "--ag-embed-width", "--ag-img-aspect", "--ag-img-height",
  "--ag-img-fit", "--ag-img-view-box", "--ag-img-focus"
];

let activeGesture = null;
let documentCache = null;

/**
 * Reconcile the handles with the geometry the layout pass just published.
 *
 * Geometry is read from `--ag-row-*` and `--ag-embed-width` instead of being
 * measured: a cell after the first one is a zero-height float whose rect
 * reports the row, not the cell. Published values also survive virtualisation -
 * the offsets still describe the row when a member is outside the window.
 */
export function syncGalleryHandles(view, settings = {}) {
  if (activeGesture) return;
  installRowHover(view);
  const rows = collectRows(view);
  const wanted = new Set();
  for (const row of rows) {
    for (const cell of row.cells) {
      const binding = rowBindingState(row);
      const key = [
        row.height, row.box, row.content, row.width, cell.offset, cell.width,
        cell.isLast, row.index, row.cells.length, row.gap, cell.group, binding
      ].join("|");
      if (cell.embed.dataset.agHandleKey !== key || !handlesIntact(cell.embed)) {
        clearCellHandles(cell.embed);
        cell.embed.dataset.agHandleKey = key;
        cell.embed.dataset.agHandleCount = String(buildCellHandles(view, row, cell, settings));
      }
      for (const handle of cell.embed.querySelectorAll(HANDLE_SELECTOR)) wanted.add(handle);
      // Placement depends on the bar's mode, which changes without the cell
      // geometry changing, so it is re-evaluated on every pass.
      const rowKey = String(row.cells[0]?.lineNumber ?? 0);
      if (cell.line.dataset.agRowKey !== rowKey) cell.line.dataset.agRowKey = rowKey;
      for (const host of cell.embed.querySelectorAll(`:scope > .${ORDER_CLASS}`)) {
        placeOrderCluster(cell.embed, host);
      }
      // The bar's own height changes without the cell geometry changing, and
      // the link's room depends on it.
      placeLinkButton(cell.embed);
    }
  }
  // A handle whose cell lost its geometry (reveal, re-pack, exclusion) must go.
  for (const handle of view.dom.querySelectorAll(HANDLE_SELECTOR)) {
    if (!wanted.has(handle)) handle.remove();
  }
}

export function clearGalleryHandles(root) {
  if (!root?.querySelectorAll) return;
  for (const handle of root.querySelectorAll(HANDLE_SELECTOR)) handle.remove();
  for (const embed of root.querySelectorAll(".image-embed, .internal-embed")) {
    delete embed.dataset.agHandleKey;
    delete embed.dataset.agHandleCount;
  }
}

/**
 * Release a gallery cell: drop its crop and, with it, the hand-written row
 * split. The split describes the run the old ratios produced; keeping it would
 * leave the gallery in a grid nothing describes any more.
 */
export function resetGalleryCellAt(view, target, settings = {}) {
  let position = target && typeof target === "object" && Number.isFinite(target.position)
    ? target.position
    : -1;
  if (!(position >= 0)) {
    try {
      position = view.posAtDOM(target, 0);
    } catch {
      return;
    }
  }
  if (!(position >= 0)) return;
  const lineNumber = view.state.doc.lineAt(position).number;
  const run = runContext(view, lineNumber, settings);
  const edits = new Map();
  const first = run?.firstLineNumber;
  if (first && first !== lineNumber) {
    pushPatch(edits, lineNumber, { crop: null });
    pushPatch(edits, first, { rows: null });
  } else {
    pushPatch(edits, lineNumber, { crop: null, rows: null });
  }
  // Releasing the crop widens the picture; a bound row has to absorb that
  // width instead of pushing a neighbour out of the row.
  rebalanceBoundRow(run, lineNumber, { crop: null }, settings, edits);
  applyEdits(view, edits);
}

/* ------------------------------------------------------------------- layout */

function collectRows(view) {
  const lines = [...view.dom.querySelectorAll(".cm-line.ag-cm-image-line.ag-cm-gallery-line")];
  const rows = [];
  let current = null;
  let currentRun = "";
  for (const line of lines) {
    if (line.closest(".table-cell-wrapper")) {
      current = null;
      continue;
    }
    // A list gallery publishes the same row geometry as a floating row, but on
    // the embed: the editor rewrites a list line's own inline style on every
    // measure, so nothing written there would survive. The offsets stay
    // item-relative, and a run - not an offset of zero - marks the row's head.
    const isList = line.classList.contains("ag-cm-list-line");
    // A revealed cell becomes a full-width block: the row is no longer a grid.
    // Every cell is a block now, so the mark is the code line's own auto height
    // rather than the float it gave up to show its Markdown.
    if (line.style.height === "auto") {
      current = null;
      currentRun = "";
      continue;
    }
    const embed = line.querySelector(".image-embed, .internal-embed");
    const source = isList ? embed : line;
    const height = source ? readPx(source, "--ag-row-height") : null;
    const offset = source ? readPx(source, "--ag-row-offset") : null;
    // A lone cell spans the row, so it has no own embed width; the row width is
    // the only width that exists.
    const width = source
      ? (readPx(source, "--ag-embed-width") ?? readPx(source, "--ag-row-width"))
      : null;
    if (!(height > 0) || !(width > 0) || offset === null || !embed) {
      current = null;
      currentRun = "";
      continue;
    }
    const run = isList ? (/(?:^|\s)ag-cm-list-run-(\d+)(?:\s|$)/.exec(line.className || "")?.[1] ?? "") : "";
    // A floating row between two list rows ends the list run: the next list
    // row must start its own row even if it happens to reuse the same id.
    if (!isList) currentRun = "";
    const startsRow = isList ? run !== currentRun : Math.abs(offset) < 0.5;
    if (startsRow) {
      currentRun = run;
      const band = readPx(source, "--ag-row-content") || readPx(source, "--ag-row-width") || width;
      current = {
        height,
        box: readPx(source, "--ag-row-box") || height,
        // `width` stays the column; `content` is the band the cells occupy,
        // which is narrower when the row hit the height ceiling.
        width: readPx(source, "--ag-row-width") || width,
        content: band,
        inset: readPx(source, "--ag-row-inset") || 0,
        natural: readPx(source, "--ag-row-natural-height") || height,
        gap: 0,
        index: rows.length,
        list: isList,
        cells: []
      };
      rows.push(current);
    } else if (!current) {
      // The row's first cell is not rendered - it is virtualised out, or the
      // row is partially revealed. A tail without its head cannot be dragged
      // without rewriting a cell nobody can see, so it gets no handles.
      continue;
    }
    const lineNumber = lineNumberFor(view, line);
    const annotation = lineNumber > 0
      ? extractImageAnnotation(view.state.doc.line(lineNumber).text)
      : null;
    const image = embed.querySelector("img:not(.cm-widgetBuffer)");
    clearImagePaint(image);
    current.cells.push({
      line,
      embed,
      image,
      lineNumber,
      params: annotation?.params ?? {},
      natural: naturalSize(embed) ?? cachedNatural(view, lineNumber),
      offset,
      width,
      group: Number(annotation?.params?.group) > 0 ? Number(annotation.params.group) : 0,
      row: current,
      rowHeight: current.height,
      isLast: false
    });
  }
  for (const row of rows) {
    for (const cell of row.cells) {
      cell.isLast = cell.offset + cell.width >= row.content - 1.5;
    }
    // The gutter is the only unknown in the published geometry; recover it from
    // the row itself so a handle never depends on the settings being passed in.
    const second = row.cells[1];
    row.gap = second ? Math.max(0, Math.round(second.offset - row.cells[0].offset - row.cells[0].width)) : 0;
  }
  return rows;
}

function buildCellHandles(view, row, cell, settings) {
  const before = countCellHandles(cell.embed);
  const index = row.cells.indexOf(cell);
  const next = row.cells[index + 1];
  const contiguous = next
    && Math.abs(next.offset - (cell.offset + cell.width + row.gap)) <= 1.5;
  // A list row keeps the packer and the reorder/link controls, but not the two
  // drag handles: a cell is an absolutely positioned box against the item, and
  // both drags republish their preview through the line's own inline style,
  // which the editor overwrites on every measure. Offering a handle that cannot
  // preview its own drag is worse than not offering it.
  if (!row.list) {
    if (contiguous) createDivider(view, row, cell, next);
    if (Math.abs(cell.offset) < 0.5 && rowComplete(row)) createHeightBar(view, row, settings);
  }
  createOrderButtons(view, row, cell, settings);
  createLinkButton(view, row, cell, settings);
  placeLinkButton(cell.embed);
  return countCellHandles(cell.embed) - before;
}

/** Handles this embed owns directly; a nested one belongs to another cell. */
function countCellHandles(embed) {
  let count = 0;
  for (const child of embed?.children ?? []) {
    if (child.classList.contains(DIVIDER_CLASS)
      || child.classList.contains(HEIGHT_CLASS)
      || child.classList.contains(ORDER_CLASS)
      || child.classList.contains(LINK_CLASS)) count += 1;
  }
  return count;
}

/**
 * Whether the embed still holds the handles the last build put there.
 *
 * The key alone is not proof: the cleanup pass removes handles from any cell it
 * could not measure (a row half outside the viewport), and Obsidian rebuilds an
 * embed's contents when the picture finishes loading. Both leave the dataset
 * behind, and trusting it would strand the cell with no controls for the rest of
 * the session.
 */
function handlesIntact(embed) {
  const expected = Number(embed.dataset.agHandleCount);
  if (!Number.isFinite(expected) || expected < 0) return false;
  return countCellHandles(embed) === expected;
}

/**
 * Every cell of the row is rendered and the offsets form a closed chain, so a
 * whole-row rewrite cannot miss a member.
 */
function rowComplete(row) {
  if (row.cells.length < 2) return false;
  const last = row.cells[row.cells.length - 1];
  if (!last.isLast) return false;
  let expected = 0;
  for (const cell of row.cells) {
    if (Math.abs(cell.offset - expected) > 1.5) return false;
    expected = cell.offset + cell.width + row.gap;
  }
  return true;
}

/* ------------------------------------------------------------------ handles */

function createDivider(view, row, cell, next) {
  const handle = document.createElement("div");
  handle.className = `${DIVIDER_CLASS} ${BUTTON_CLASS}`;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", t("调整栏宽"));
  // The cell's padding-right owns the gutter, so the boundary sits half a gap
  // past the embed's own right edge.
  handle.style.right = `${-(row.gap / 2 + HOT_ZONE / 2)}px`;
  handle.append(handleSpan("line", "vertical"), handleSpan("grip", "vertical"));
  handle.addEventListener("pointerdown", (event) => {
    beginColumnDrag(view, row, cell, next, event);
  });
  cell.embed.appendChild(handle);
}

function createHeightBar(view, row, settings) {
  const handle = document.createElement("div");
  handle.className = `${HEIGHT_CLASS} ${BUTTON_CLASS}`;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", t("调整行高"));
  handle.style.top = `${heightBarTop(row, row.height)}px`;
  handle.style.left = "0";
  handle.style.width = `${row.content}px`;
  handle.append(handleSpan("line", "horizontal"), handleSpan("grip", "horizontal"));
  handle.addEventListener("pointerdown", (event) => {
    beginRowHeightDrag(view, row, event, settings, handle);
  });
  row.cells[0].embed.appendChild(handle);
}

/**
 * Where the row-height bar sits vertically.
 *
 * Not on the picture's bottom edge: that makes it read as a border of the
 * image. It is centred in the gap the caption leaves above its text, which is
 * the same "floating in the seam" position the column divider uses.
 */
function heightBarTop(row, height) {
  // No caption means no seam to float in: the row's own bottom edge is the
  // boundary the reader is dragging.
  if (!(row.box - row.height > 0)) return height - HOT_ZONE / 2;
  const gap = readPx(row.cells[0]?.line, "--ag-caption-gap") ?? 12;
  return height + gap / 2 - HOT_ZONE / 2;
}

/** The long bar's decorative line or its brighter centre segment. */
function handleSpan(kind, orientation) {
  const span = document.createElement("span");
  span.className = `ag-gallery-handle-${kind} ag-gallery-handle-${kind}-${orientation}`;
  return span;
}

/**
 * One square control in the cell's overlay.
 *
 * The pointerdown is swallowed so pressing a button never starts the editor's
 * own drag, and the click is stopped as well: these controls sit inside the
 * image embed, and Obsidian would otherwise open the picture behind them.
 */
function orderButton(icon, label, edge, onClick) {
  const button = document.createElement("div");
  button.className = "ag-gallery-order-button";
  // The original edge survives a fold into one column; that is what lets the
  // cluster split again when the cell is widened.
  button.dataset.agEdge = edge;
  button.setAttribute("role", "button");
  button.tabIndex = -1;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  setIcon(button, icon);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

function createOrderButtons(view, row, cell, settings) {
  if (!cell.lineNumber) return;
  const { previous, next } = adjacentImages(view, cell.lineNumber);
  if (!previous && !next) return;
  const index = row.cells.indexOf(cell);
  const atStart = index === 0;
  const atEnd = index === row.cells.length - 1;
  // A half-rendered row cannot answer "is this the last cell": the members
  // after it are simply virtualised out, and offering a merge there would
  // promise to fold the picture into the row it is already in.
  const edgesKnown = rowComplete(row);

  const left = createCluster("left");
  if (previous) {
    left.appendChild(orderButton("chevrons-left", t("与前一张交换"), "left", () => {
      moveImageLine(view, cell.lineNumber, previous.lineNumber, settings);
    }));
    // Merging is a different promise from swapping: the picture joins the
    // neighbouring row instead of trading places, so it only makes sense on the
    // edge that faces that row.
    if (atStart && edgesKnown) {
      left.appendChild(orderButton("arrow-left-from-line", t("向前合并"), "left", () => {
        mergeRowImage(view, cell.lineNumber, -1, settings);
      }));
    }
  }
  const right = createCluster("right");
  if (next) {
    right.appendChild(orderButton("chevrons-right", t("与后一张交换"), "right", () => {
      moveImageLine(view, cell.lineNumber, next.lineNumber, settings);
    }));
    if (atEnd && edgesKnown) {
      right.appendChild(orderButton("arrow-right-from-line", t("向后合并"), "right", () => {
        mergeRowImage(view, cell.lineNumber, 1, settings);
      }));
    }
  }
  if (!left.childElementCount && !right.childElementCount) return;

  const host = document.createElement("div");
  host.className = ORDER_CLASS;
  if (left.childElementCount) host.appendChild(left);
  if (right.childElementCount) host.appendChild(right);
  cell.embed.appendChild(host);
  placeOrderCluster(cell.embed, host);
}

function createCluster(edge) {
  const cluster = document.createElement("div");
  cluster.className = "ag-gallery-cluster";
  cluster.dataset.agEdge = edge;
  return cluster;
}

/**
 * Decide where the order/merge controls go.
 *
 * Three answers, and overlap is never one of them:
 * - `row`: two trays, one per edge, the right one pushed inwards when the bar
 *   is a vertical rail.
 * - `column`: one folded tray in the rail's own lane, centred in the band
 *   between the bar's bottom edge and the link's top edge.
 * - `horizontal`: one line of buttons under the bar. A short, wide cell has no
 *   room for a tray above and below the picture's centre line but plenty of room
 *   to lay the same buttons out sideways, and dropping them there was the
 *   single most common "the reorder buttons are missing" case.
 * - `hidden`: neither fits. A control is dropped before it is allowed to sit
 *   on top of the native bar.
 *
 * Pure geometry, so the three cases can be verified without a live editor.
 *
 * @returns {{ mode: "row"|"fold"|"column"|"horizontal"|"hidden",
 *   horizontalWidth: number, bandTop: number, bandBottom: number,
 *   mergedHeight: number, paddingBottom: number, stripTop: number,
 *   stripHeight: number }}
 */
export function orderControlLayout({
  width = 0,
  height = 0,
  barHeight = 0,
  leftCount = 0,
  rightCount = 0,
  rail = 0
} = {}) {
  const total = leftCount + rightCount;
  const trayWidth = BUTTON_WIDTH + TRAY_PAD * 2;
  const trayHeight = (count) => (count > 0
    ? count * BUTTON_HEIGHT + (count - 1) * TRAY_GAP + TRAY_PAD * 2
    : 0);
  const columns = (leftCount > 0 ? 1 : 0) + (rightCount > 0 ? 1 : 0);
  const tallest = Math.max(trayHeight(leftCount), trayHeight(rightCount));
  // Three columns: the left group, the right group, and the native rail.
  const threeColumnWidth = columns * trayWidth + CONTROL_INSET * 2 + rail
    + Math.max(0, columns - 1) * CLUSTER_GAP;
  // Two columns: the groups folded into one tray, plus the rail beside it.
  // This is the state between "everything fits" and "nothing fits sideways" -
  // dropping it makes the controls jump straight into the rail's own lane,
  // which reads as the buttons teleporting across the picture.
  const twoColumnWidth = trayWidth + CONTROL_INSET * 2 + rail;
  const barBottom = barHeight > 0 ? CONTROL_INSET + barHeight : 0;
  const linkReserve = BUTTON_HEIGHT + TRAY_PAD * 2 + CONTROL_INSET;
  const bandTop = barBottom + STACK_GAP;
  const bandBottom = height - linkReserve - STACK_GAP;
  const mergedHeight = trayHeight(total);
  // A rail is cleared horizontally, so the trays only have to clear a bar that
  // shares their edge, i.e. a bar still laid out horizontally.
  const clearsBar = rail > 0 || barBottom === 0
    || height / 2 - tallest / 2 >= barBottom + STACK_GAP;
  const canRow = width >= threeColumnWidth && clearsBar;
  const canFold = columns > 1 && width >= twoColumnWidth && clearsBar;
  const canMerge = height > 0 && bandBottom - bandTop >= mergedHeight;
  // One line of trays, centred in the band the bar and the link leave free.
  // The band is symmetric about the picture's centre line, so centring inside
  // it also centres the buttons on the picture - which is what the vertical
  // rail does, and a row of controls pinned to the top edge reads as a mistake.
  const stripHeight = BUTTON_HEIGHT + TRAY_PAD * 2;
  const stripWidth = columns * trayWidth + Math.max(0, columns - 1) * CLUSTER_GAP
    + CONTROL_INSET * 2;
  const stripTop = barHeight > 0
    ? bandTop + Math.max(0, (bandBottom - bandTop - stripHeight) / 2)
    : Math.max(CONTROL_INSET, (height - stripHeight) / 2);
  const canHorizontal = total > 0 && width >= stripWidth
    && height > 0 && stripTop + stripHeight <= height - CONTROL_INSET
    && stripTop >= bandTop - 0.5;
  const empty = !(width > 0) || !(height > 0) || total === 0;
  return {
    mode: empty || (!canRow && !canHorizontal && !canFold && !canMerge)
      ? "hidden"
      : canRow ? "row"
        : canHorizontal ? "horizontal"
          : canFold ? "fold" : "column",
    horizontalWidth: threeColumnWidth,
    bandTop,
    bandBottom,
    mergedHeight,
    paddingBottom: linkReserve + STACK_GAP,
    stripTop,
    stripHeight
  };
}

function placeOrderCluster(embed, host) {
  const metrics = embedActionMetrics(embed);
  const width = embed.clientWidth || embed.getBoundingClientRect?.().width || 0;
  const height = embed.clientHeight || embed.getBoundingClientRect?.().height || 0;
  const rail = metrics && metrics.mode !== "inside" && metrics.mode !== "hidden"
    ? Math.round(Number(metrics.railWidth) || 0) + CONTROL_INSET
    : 0;
  const leftCount = host.querySelectorAll(`.ag-gallery-order-button[data-ag-edge="left"]`).length;
  const rightCount = host.querySelectorAll(`.ag-gallery-order-button[data-ag-edge="right"]`).length;
  const plan = orderControlLayout({
    width,
    height,
    // Where the native bar ends. Taken from the placement cache rather than
    // the live box when the bar is display:none, because it still owns that
    // corner the moment the cell is hovered.
    barHeight: nativeBarHeight(embed, metrics),
    leftCount,
    rightCount,
    rail
  });

  host.classList.remove("ag-gallery-order-vertical", "ag-gallery-order-horizontal", "ag-gallery-order-hidden");
  host.style.flexDirection = "";
  host.style.alignItems = "";
  host.style.justifyContent = "";
  host.style.padding = "";
  host.style.insetInlineStart = "";
  host.style.top = "";
  host.style.bottom = "";
  host.style.transform = "";
  for (const cluster of host.children) {
    cluster.style.marginLeft = "";
    cluster.style.marginRight = "";
  }

  if (plan.mode === "hidden") {
    arrangeClusters(host, true);
    host.classList.add("ag-gallery-order-hidden");
    return;
  }

  if (plan.mode === "horizontal") {
    // A line of buttons under the bar, the two groups keeping their own edge so
    // "swap/merge" still reads left-to-right against the picture it acts on.
    arrangeClusters(host, false);
    host.classList.add("ag-gallery-order-horizontal");
    host.style.top = `${Math.round(plan.stripTop)}px`;
    host.style.bottom = "auto";
    host.style.transform = "none";
    host.style.flexDirection = "row";
    host.style.alignItems = "flex-start";
    host.style.justifyContent = "space-between";
    host.style.padding = `0 ${CONTROL_INSET}px`;
    return;
  }

  if (plan.mode === "fold") {
    // Two columns: the folded tray against the left edge, the native rail
    // keeping the right one. This is what a reader sees between "three
    // columns" and "everything in the rail's lane".
    arrangeClusters(host, true);
    host.style.flexDirection = "row";
    host.style.alignItems = "center";
    host.style.justifyContent = "flex-start";
    host.style.padding = `0 ${CONTROL_INSET}px`;
    return;
  }

  if (plan.mode === "row") {
    arrangeClusters(host, false);
    host.style.flexDirection = "row";
    host.style.alignItems = "center";
    host.style.justifyContent = "space-between";
    host.style.padding = `0 ${CONTROL_INSET}px`;
    const right = findCluster(host, "right");
    if (right) {
      if (rail > 0) right.style.marginRight = `${rail}px`;
      else right.style.marginLeft = "auto";
    }
    return;
  }

  // One column, in the rail's lane, centred in the free band left between the
  // bar's bottom edge and the link's top edge.
  arrangeClusters(host, true);
  host.classList.add("ag-gallery-order-vertical");
  host.style.top = "0";
  host.style.bottom = "0";
  host.style.transform = "none";
  host.style.flexDirection = "column";
  host.style.alignItems = "flex-end";
  host.style.justifyContent = "center";
  host.style.padding = `${plan.bandTop}px ${CONTROL_INSET}px ${plan.paddingBottom}px 0`;
}

/**
 * Height the native bar occupies inside the cell, 0 when it is not shown.
 *
 * A laid-out bar is the best source. The placement cache covers the frames
 * where Obsidian has it `display: none` but it still owns that corner as soon
 * as the cell is hovered, and an empty cache is rebuilt from the items the bar
 * holds rather than read as "no bar".
 */
function nativeBarHeight(embed, metrics) {
  const bar = embed?.querySelector?.(":scope > .embed-actions") ?? embed?.querySelector?.(".embed-actions");
  const live = bar ? bar.getBoundingClientRect().height : 0;
  if (live > 0) return live;
  if (!metrics) return 0;
  if (metrics.mode === "hidden") return 0;
  if (metrics.mode === "compact" || metrics.mode === "small") {
    if (metrics.railHeight > 0) return metrics.railHeight;
    const count = bar?.children.length ?? 0;
    return count > 0
      ? count * (metrics.itemHeight || BUTTON_HEIGHT) + (count - 1) * TRAY_GAP + TRAY_PAD * 2
      : 0;
  }
  return metrics.barHeight;
}

function findCluster(host, edge) {
  for (const child of host.children) {
    if (child.classList.contains("ag-gallery-cluster") && child.dataset.agEdge === edge) return child;
  }
  return null;
}

/**
 * Fold the two edge groups into one tray, or split them apart again.
 *
 * The buttons carry their original edge, so the fold is reversible: a cell that
 * is widened again gets its left and right groups back instead of keeping the
 * merged column it needed while it was narrow.
 */
function arrangeClusters(host, merged) {
  const left = findCluster(host, "left");
  const right = findCluster(host, "right");
  if (!left || !right) return;
  if (merged) {
    if (right.parentElement === host) {
      for (const button of [...right.children]) left.appendChild(button);
    }
    right.style.display = "none";
    return;
  }
  right.style.display = "";
  for (const button of [...left.children]) {
    if (button.dataset.agEdge === "right") right.appendChild(button);
  }
}

/**
 * Hide the link when the picture is too short for it to clear the native bar.
 *
 * The link sits at the bottom edge and the bar at the top; once the two would
 * touch, the link is the control that goes. The binding is still reachable from
 * the row's other cells, and an overlapping pair of controls is worse than one
 * fewer affordance.
 */
function placeLinkButton(embed) {
  const link = embed?.querySelector?.(":scope > .ag-gallery-link");
  if (!link) return;
  const barHeight = nativeBarHeight(embed, embedActionMetrics(embed));
  const height = embed.clientHeight || 0;
  const needed = CONTROL_INSET + barHeight + STACK_GAP + (BUTTON_HEIGHT + TRAY_PAD * 2) + CONTROL_INSET;
  link.style.display = height > 0 && barHeight > 0 && height < needed ? "none" : "";
}

/**
 * The corner the native resize handle used to occupy now reports and toggles the
 * row binding. `ag:group` carries an id, so two adjacent bound rows stay two
 * rows; the button offers the three states a reader can be in.
 */
function createLinkButton(view, row, cell, settings) {
  if (!rowComplete(row)) return;
  const state = rowBindingState(row);
  const bound = state === "bound";
  const button = document.createElement("div");
  button.className = `${LINK_CLASS}${bound ? " ag-gallery-link-bound" : ""}${state === "partial" && cell.group > 0 ? " ag-gallery-link-orphan" : ""}`;
  button.setAttribute("role", "button");
  button.tabIndex = -1;
  button.setAttribute("aria-label", bound ? t("解除画廊绑定") : t("锁定画廊行"));
  button.setAttribute("title", bound ? t("解除画廊绑定") : t("锁定画廊行"));
  setIcon(button, "link-2");
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleRowBinding(view, row, state, settings);
  });
  cell.embed.appendChild(button);
}

function rowBindingState(row) {
  const ids = row.cells.map((cell) => (cell.group > 0 ? cell.group : 0));
  const bound = ids.filter((id) => id > 0);
  if (!bound.length) return "free";
  return bound.length === ids.length && bound.every((id) => id === bound[0]) ? "bound" : "partial";
}

function toggleRowBinding(view, row, state, settings) {
  if (!rowComplete(row)) return;
  const edits = new Map();
  if (state === "bound") {
    // Releasing a binding returns the row to automatic routing. Pinning the
    // split here would write an `ag:rows` the reader never asked for, and the
    // gallery would keep a hand-written-looking split it can no longer explain;
    // `ag:rows` is only ever written by a person.
    for (const cell of row.cells) pushPatch(edits, cell.lineNumber, { group: null });
  } else if (state === "partial") {
    for (const cell of row.cells) {
      if (cell.group > 0) pushPatch(edits, cell.lineNumber, { group: null });
    }
  } else {
    // A fresh binding needs an id no neighbouring row already uses.
    const run = runContext(view, row.cells[0].lineNumber, settings);
    const id = nextBindingId(run);
    for (const cell of row.cells) pushPatch(edits, cell.lineNumber, { group: id });
  }
  applyEdits(view, edits);
}

function nextBindingId(run) {
  let max = 0;
  for (const record of run?.records?.values?.() ?? []) {
    const id = Number(record.params?.group);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max + 1;
}

const hoveredViews = new WeakSet();
const settleTimers = new WeakMap();

/**
 * Keep the cell overlays hidden until the released row has been rebuilt.
 *
 * Any gesture, committed or cancelled, ends by removing `.ag-resizing`; the
 * committed geometry then republishes and `syncGalleryHandles` replaces the
 * bar. The pointer was resting on that bar, so replacing it drops the bar's
 * `:hover` for a frame and the embed - now the hovered element - starts
 * showing the cell's reorder/link buttons and its native action bar. Holding the
 * suppression for one short settle window covers the rebuild; afterwards the
 * bar's own `:has(…:hover)` rule takes over again, so the result is the same as
 * if the bar had never moved.
 */
function holdOverlays(view) {
  const dom = view.dom;
  dom.classList.add(SETTLING_CLASS);
  const pending = settleTimers.get(dom);
  if (pending) clearTimeout(pending);
  settleTimers.set(dom, window.setTimeout(() => {
    settleTimers.delete(dom);
    dom.classList.remove(SETTLING_CLASS);
  }, SETTLE_MS));
}

/**
 * A bound row reveals the link button on *every* cell at once, so the reader can
 * see which pictures the binding covers. CSS cannot reach across sibling lines,
 * so the hovered row is marked from a single delegated listener.
 */
function installRowHover(view) {
  if (hoveredViews.has(view)) return;
  hoveredViews.add(view);
  view.dom.addEventListener("pointerover", (event) => {
    for (const element of view.dom.querySelectorAll(".ag-gallery-row-hover")) {
      element.classList.remove("ag-gallery-row-hover");
    }
    // A bar is a control of its own: reaching for it must not light up the
    // row's reorder/link buttons. The bar reveals itself through its own hover,
    // and the row-wide reveal is for the pictures, not for the seams between
    // them. Clearing first also drops the marks when the pointer moves from a
    // cell onto a bar.
    if (event.target?.closest?.(`.${DIVIDER_CLASS}, .${HEIGHT_CLASS}`)) return;
    const line = event.target?.closest?.(".cm-line.ag-gallery-line");
    const key = line?.dataset?.agRowKey;
    if (!key) return;
    for (const element of view.dom.querySelectorAll(`[data-ag-row-key="${key}"]`)) {
      element.classList.add("ag-gallery-row-hover");
    }
  });
}

function clearCellHandles(embed) {
  for (const handle of embed.querySelectorAll(HANDLE_SELECTOR)) {
    if (handle.parentElement === embed) handle.remove();
  }
  delete embed.dataset.agHandleCount;
}

/**
 * Set an inline declaration only when it really differs.
 *
 * A gesture repairs its own preview from a MutationObserver that watches these
 * same declarations. Writing an identical value would notify the observer
 * again and the two would ping-pong forever; comparing first makes every paint
 * idempotent, so a repair that finds nothing to do stays silent.
 */
function setIfChanged(style, property, value) {
  if (!style || style.getPropertyValue(property) === value) return;
  style.setProperty(property, value, "important");
}

/**
 * Cache what the dragged lines are showing so a decoration rebuild can paint it.
 *
 * The gesture writes the preview straight onto the line element, which is the
 * only place the published declarations and the live ones are merged. Reading
 * the resulting `cssText` back is therefore exact, and `buildDecorations`
 * replays it verbatim when CodeMirror rebuilds the row mid-drag or on release.
 */
function rememberPreview(view, cells) {
  if (!gestureGeometry.active) return;
  for (const cell of cells) {
    if (!cell?.line?.isConnected) continue;
    const number = cell.lineNumber || lineNumberFor(view, cell.line);
    if (!number) continue;
    gestureGeometry.capture(view.state.doc.line(number).from, cell.line.style.cssText);
  }
}

function notePathOf(state) {
  try { return state.field(editorInfoField, false)?.file?.path || ""; } catch { return ""; }
}

/* ------------------------------------------------------------------ gestures */

function beginColumnDrag(view, row, cell, next, event) {
  if (event.button !== 0 || activeGesture) return;
  event.preventDefault();
  event.stopPropagation();
  const minRatio = Number(config.gallery?.minCellWidthRatio ?? 0.05);
  const minWidth = minimumCellWidth(row.width, row.height, minRatio);
  const startWidths = [cell.width, next.width];
  const index = row.cells.indexOf(cell);
  // Every cell's width, kept live so the cells after the dragged pair can be
  // re-tiled during the drag.
  const liveWidths = row.cells.map((item) => item.width);
  const snapshot = snapshotStyles(row.cells);
  let widths = [...startWidths];

  const paint = () => {
    paintCellWidth(cell, widths[0], row.gap);
    paintCellWidth(next, widths[1], row.gap);
    liveWidths[index] = widths[0];
    liveWidths[index + 1] = widths[1];
    retileRow(row, liveWidths);
    rememberPreview(view, row.cells);
  };

  trackGesture(view, event, {
    watch: row.cells.map((item) => item.line),
    onRepaint: paint,
    onMove(dx, dy, moveEvent) {
      widths = resizePair(startWidths, 0, dx, minWidth);
      paint();
      view.requestMeasure();
      moveEvent.preventDefault();
    },
    onCommit() {
      const edits = new Map();
      let valid = true;
      [cell, next].forEach((target, index) => {
        const patch = cropPatchForRatio(target.params, target.natural, widths[index] / row.height);
        if (!patch) { valid = false; return; }
        pushPatch(edits, target.lineNumber, patch);
      });
      if (!valid) {
        restoreStyles(snapshot);
        return;
      }
      // The split is not pinned. A drag rewrites two crop ratios, and freezing
      // the rows it happened to produce would write an `ag:rows` nobody asked
      // for - the row the reader wants to keep together is what `ag:group`
      // (the link button) is for. An unbound run re-enters automatic routing,
      // which is the documented behaviour of a gallery without annotations.
      // A committed edit rebuilds the line decorations, which rewrites the
      // whole `style` attribute and takes the preview over. Restoring the
      // snapshot here would put the pre-drag widths back on top of it.
      if (!applyEdits(view, edits)) restoreStyles(snapshot);
    },
    onCancel() {
      restoreStyles(snapshot);
    }
  });
}

/**
 * Republish the row variables a height drag is changing.
 *
 * Growing the line's own `height` is not enough: the divider is sized by
 * `var(--ag-row-height)`, the row box by `var(--ag-row-box)`, and the handles
 * read the same values to place themselves. Leaving them at the geometry of the
 * last pass makes the row grow *behind* its own controls.
 */
function paintRowHeight(row, height, natural, cap) {
  const caption = Math.max(0, row.box - row.height);
  const uncapped = natural <= cap + 0.5;
  for (const cell of row.cells) {
    const style = cell.line.style;
    setIfChanged(style, "--ag-row-height", `${height}px`);
    setIfChanged(style, "--ag-row-box", `${height + caption}px`);
    setIfChanged(style, "--ag-row-natural-height", `${natural}px`);
    if (uncapped) {
      // A capped band is narrower than the column and centred; dragging it back
      // under the ceiling has to restore the full width in the same frame. The
      // cells themselves are re-tiled from the same flag by the caller.
      setIfChanged(style, "--ag-row-content", `${row.width}px`);
      setIfChanged(style, "--ag-row-inset", "0px");
    }
  }
}

/**
 * Put every cell back on its slot.
 *
 * The cells are blocks, and a block that does not own the row's height is zero
 * height: it reserves nothing horizontally and vertically, so the browser has
 * no way to place it. Each cell therefore carries an explicit `margin-left`
 * computed from the widths of the cells in front of it. Changing a width moves
 * the cells behind it, and the drag has to move them in the same frame the
 * pointer does instead of waiting for the next layout pass.
 */
function retileRow(row, widths, inset = row.inset) {
  let offset = Math.max(0, Number(inset) || 0);
  for (let index = 0; index < row.cells.length; index += 1) {
    const line = row.cells[index].line;
    setIfChanged(line.style, "margin-left", `${offset}px`);
    offset += (widths[index] ?? row.cells[index].width) + row.gap;
  }
}

function beginRowHeightDrag(view, row, event, settings, handle) {
  if (event.button !== 0 || activeGesture) return;
  event.preventDefault();
  event.stopPropagation();
  if (!rowComplete(row)) return;

  const configuredMin = settings.galleryControl === "count"
    ? 0
    : Number(settings.galleryMinHeight ?? 100);
  const minHeight = Math.max(FLOOR_HEIGHT, Number.isFinite(configuredMin) ? configuredMin : 0);
  const configuredMax = Number(settings.galleryMaxHeight ?? DEFAULT_MAX_HEIGHT);
  const maxHeight = Math.max(minHeight, configuredMax > 0 ? configuredMax : minHeight);
  const cells = row.cells;
  // A capped row shows `cap` but its ratios were produced by the taller
  // `natural` height. The gesture has to scale from that base, not from what is
  // on screen, or the committed row lands at the wrong size.
  const startNatural = row.natural > 0 ? row.natural : row.height;
  const startShown = Math.min(startNatural, maxHeight);
  const maxTarget = Math.max(minHeight, maxHeight);
  // The row's height lives on the last cell: the height map stacks line
  // heights in document order, so only the last one can be tall without
  // pushing its siblings to the row's bottom edge.
  const heightLine = cells[cells.length - 1]?.line ?? cells[0].line;
  const startLineHeight = Number.parseFloat(cellInlineHeight(heightLine));
  const snapshot = snapshotStyles(cells);
  let height = startShown;

  let painted = false;
  const paint = (target) => {
    // A row sitting on the ceiling cannot grow: a downward drag leaves the
    // clamp where it is, and repainting anyway would uncap it to the column
    // width without the reader asking for it.
    if (!painted && Math.abs(target - startShown) < 0.01) return;
    painted = true;
    // Height and ratio move in opposite directions: a taller row needs smaller
    // frame ratios, which is the same factor the commit uses.
    const factor = heightScaleFactor(startNatural, target);
    // The columns do not move. `width = height * ratio`, and the ratio is
    // being scaled by `natural / height` for this very target, so the product
    // is `natural * ratio` - the width the row already had. Dragging the row
    // taller therefore keeps every column exactly where it is and takes the
    // height out of the frame: margins first, then a horizontal crop. Without
    // the factor the widths grow with the pointer and the row zooms instead of
    // cropping. (A row that was capped is narrower than the column; uncapping
    // it here restores the full width in the same frame, which is the same
    // result the commit produces.)
    const widths = cells.map((cell) => {
      const ratio = cellRatio(cell.params, cell.natural);
      return ratio > 0 ? target * ratio * factor : cell.width;
    });
    cells.forEach((cell, index) => {
      setIfChanged(cell.line.style, "width", `${widths[index] + (cell.isLast ? 0 : row.gap)}px`);
      setIfChanged(cell.line.style, "--ag-embed-width", `${widths[index]}px`);
    });
    for (const cell of cells) paintCellHeight(cell, target, factor);
    // The ratio base, not the displayed height, is what the crops follow: a
    // capped row shows the ceiling but its frames were cut for `natural`.
    const natural = startShown > 0 ? target * (startNatural / startShown) : target;
    paintRowHeight(row, target, natural, maxHeight);
    // Uncapping a row moves every slot back to the column's left edge, so the
    // tiling has to follow the same flag the row variables just took.
    retileRow(row, widths, natural <= maxHeight + 0.5 ? 0 : row.inset);
    // The bar is the control the reader is holding; it has to travel with the
    // pointer instead of waiting for the commit to reposition it.
    if (handle) setIfChanged(handle.style, "top", `${heightBarTop(row, target)}px`);
    // The last cell owns the row's height in the document flow.
    if (Number.isFinite(startLineHeight)) {
      setIfChanged(heightLine.style, "height", `${startLineHeight + (target - row.height)}px`);
    }
    rememberPreview(view, cells);
  };

  trackGesture(view, event, {
    watch: cells.map((cell) => cell.line),
    onRepaint() { paint(height); },
    onMove(dx, dy, moveEvent) {
      height = clamp(startShown + dy, minHeight, maxTarget);
      paint(height);
      // CodeMirror caches line heights. Without a measure the caption and every
      // line below keep their old offsets while the pictures grow.
      view.requestMeasure();
      moveEvent.preventDefault();
    },
    onCommit() {
      // Nothing moved (a drag that only pulled against the ceiling): leave the
      // document alone instead of writing an identical crop.
      if (Math.abs(height - startShown) < 0.5) {
        restoreStyles(snapshot);
        return;
      }
      const scale = heightScaleFactor(startNatural, height);
      const edits = new Map();
      for (const cell of cells) {
        const base = cellRatio(cell.params, cell.natural);
        const patch = base > 0 ? cropPatchForRatio(cell.params, cell.natural, base * scale) : null;
        if (!patch) {
          restoreStyles(snapshot);
          return;
        }
        pushPatch(edits, cell.lineNumber, patch);
      }
      // Same rule as the column drag: the split this height produced is not
      // written back. The run returns to automatic routing, and a row that must
      // keep its members is bound with `ag:group`.
      if (!applyEdits(view, edits)) restoreStyles(snapshot);
    },
    onCancel() {
      restoreStyles(snapshot);
    }
  });
}

/**
 * Own the pointer for one gallery gesture.
 *
 * Listeners live on the document rather than the handle: the pointer regularly
 * leaves an 12px hot zone mid-drag, and releasing outside the window fires no
 * `pointerup` on the element at all. `Escape`, a lost capture and a mouse whose
 * buttons are already up all cancel. The threshold keeps a double click from
 * committing a zero-delta edit.
 *
 * `.ag-resizing` freezes the layout pass for the duration, so the decoration
 * cannot rewrite the geometry under the preview.
 */
function trackGesture(view, event, handlers) {
  const doc = view.dom.ownerDocument ?? document;
  const target = event.currentTarget;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let finished = false;
  // CodeMirror re-applies a line's decoration attributes whenever it rebuilds
  // the line - an empty dispatch is enough - and that restores the *published*
  // geometry, wiping the preview while the handle (which lives on its own
  // element) keeps following the pointer. Rather than fighting for that
  // attribute, watch it: any reset is repaired from the live values before the
  // next frame paints.
  const watched = handlers.watch ?? [];
  const observer = watched.length && typeof MutationObserver === "function"
    ? new MutationObserver(() => {
      if (!finished) handlers.onRepaint?.();
    })
    : null;
  if (observer) {
    for (const element of watched) {
      observer.observe(element, { attributes: true, attributeFilter: ["style"] });
    }
  }

  const stop = () => {
    observer?.disconnect();
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onCancel, true);
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("selectstart", swallow, true);
    doc.removeEventListener("dragstart", swallow, true);
    doc.defaultView?.removeEventListener("blur", onCancel, true);
    activeGesture = null;
    try { target?.releasePointerCapture?.(event.pointerId); } catch { /* already gone */ }
    target?.classList.remove(ACTIVE_CLASS);
    // Take over from `.ag-resizing` before it is removed: the committed pass is
    // about to replace the handle the pointer is resting on, and that rebuild
    // must not light up the first cell's buttons for a frame.
    holdOverlays(view);
    delete view.dom.dataset.agResizing;
    view.dom.classList.remove(RESIZING_CLASS, DRAGGING_CLASS);
    window.setTimeout(swallowNextClick, 0);
  };

  function finish(commit) {
    if (finished) return;
    finished = true;
    stop();
    if (commit && moved) {
      // The geometry stays with the gesture until the pass that publishes the
      // committed values runs. Releasing here would rebuild the rows from the
      // *previous* geometry and the drag would flash backwards on release.
      // If that pass is swallowed the watchdog asks for a fresh one instead of
      // leaving a preview nothing will replace.
      gestureGeometry.releaseAfterPublish(1500, () => {
        if (view.dom?.isConnected) view.dom.dispatchEvent(new CustomEvent("ag-layout-invalid"));
      });
      handlers.onCommit?.();
    } else {
      gestureGeometry.release();
      handlers.onCancel?.();
    }
  }

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    if (moveEvent.pointerType === "mouse" && moveEvent.buttons === 0) {
      finish(false);
      return;
    }
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    moved = true;
    handlers.onMove?.(dx, dy, moveEvent);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (keyEvent) => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    finish(false);
  };
  const swallow = (cancelEvent) => cancelEvent.preventDefault();

  activeGesture = { view };
  // Own the line styles: the preview is cached per line and replayed by the
  // decoration field, so a rebuild during the drag paints what the pointer is
  // showing instead of the last published geometry. The baseline is the style
  // each line had before the drag - the field needs it to tell published
  // geometry apart from the preview it is carrying.
  gestureGeometry.hold(notePathOf(view.state), watched.map((line) => {
    try {
      const position = view.posAtDOM(line, 0);
      return position >= 0 ? [view.state.doc.lineAt(position).from, line.style.cssText] : null;
    } catch {
      return null;
    }
  }).filter(Boolean));
  // Capture the pointer: a release outside the window, over another pane, or
  // after the handle was rebuilt would otherwise never reach the document and
  // leave `activeGesture` set - from then on every drag is silently refused.
  try { target?.setPointerCapture?.(event.pointerId); } catch { /* detached */ }
  // Keep the handle lit while it owns the pointer, even after the cursor has
  // left the hot zone.
  target?.classList.add(ACTIVE_CLASS);
  view.dom.dataset.agResizing = "1";
  view.dom.classList.add(RESIZING_CLASS, DRAGGING_CLASS);
  doc.addEventListener("pointermove", onMove, true);
  doc.addEventListener("pointerup", onUp, true);
  doc.addEventListener("pointercancel", onCancel, true);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("selectstart", swallow, true);
  doc.addEventListener("dragstart", swallow, true);
  // A gesture that loses the window never receives `pointerup`. Cancelling on
  // blur hands the geometry back instead of leaving the decoration frozen.
  doc.defaultView?.addEventListener("blur", onCancel, true);
}

/** Inline height a cell published, if any. */
function cellInlineHeight(line) {
  return line?.style?.getPropertyValue("height") ?? "";
}

/* ------------------------------------------------------------------ reorder */

/**
 * Exchange two adjacent image lines.
 *
 * Swapping the line *text* rather than relocating a line is what makes the move
 * land in the right row: the picture takes the other line's slot and inherits
 * that slot's separation from its neighbours. Pairs separated by prose are
 * filtered out before this runs, so a picture never jumps over a paragraph.
 */
function moveImageLine(view, lineNumber, targetLineNumber, settings = {}) {
  const doc = view.state.doc;
  const source = doc.line(lineNumber);
  const target = doc.line(targetLineNumber);
  const sourceAnnotation = extractImageAnnotation(source.text);
  const targetAnnotation = extractImageAnnotation(target.text);
  if (!sourceAnnotation || !targetAnnotation) return;

  const run = runContext(view, lineNumber, settings);
  if (!run) return;
  const first = run.firstLineNumber;
  // `ag:rows` lives on the run's first line. A swap that moves that line has to
  // hand the annotation to whichever line now occupies its slot.
  const rows = source.number === first
    ? sourceAnnotation.params.rows
    : target.number === first ? targetAnnotation.params.rows : null;

  const sourceText = stripRows(source.text, sourceAnnotation);
  const targetText = stripRows(target.text, targetAnnotation);
  const finalSource = source.number === first && rows ? withRows(targetText, rows) : targetText;
  const finalTarget = target.number === first && rows ? withRows(sourceText, rows) : sourceText;

  const edits = new Map();
  edits.set(source.number, finalSource);
  edits.set(target.number, finalTarget);

  for (const [number, patch] of protectRowHeight(run, lineNumber, targetLineNumber, settings)) {
    pushPatch(edits, number, patch);
  }
  applyEdits(view, edits);
}

function stripRows(text, annotation) {
  if (!annotation?.params?.rows) return text;
  return updateImageAnnotation(text, { rows: null }) ?? text;
}

function withRows(text, rows) {
  return updateImageAnnotation(text, { rows }) ?? text;
}

/**
 * Keep a locked row above `galleryMinHeight` after it received a different
 * picture. The packer cannot help here: an explicit split deliberately skips
 * it. Scaling every ratio in the row by one factor changes the height and
 * leaves the column widths untouched.
 */
function protectRowHeight(run, lineNumber, targetLineNumber, settings) {
  const patches = [];
  if (!run.complete || !run.rowsStored || run.rows.length < 2) return patches;
  const minHeight = Math.max(0, Number(settings.galleryMinHeight ?? 0));
  if (!(minHeight > 0) || !(run.containerWidth > 0)) return patches;

  const sourceRow = run.rows.find((members) => members.includes(lineNumber));
  const targetRow = run.rows.find((members) => members.includes(targetLineNumber));
  if (!sourceRow || !targetRow || sourceRow === targetRow) return patches;

  const ratioOf = (number) => {
    const record = run.records.get(number);
    return record ? cellRatio(record.params, record.natural) : null;
  };
  const leaving = ratioOf(lineNumber);
  const entering = ratioOf(targetLineNumber);
  if (!(leaving > 0) || !(entering > 0)) return patches;

  // After the swap the two slots hold each other's picture, and a crop is
  // relative to the picture it belongs to. Every patch below has to start from
  // the incoming image's frame, not from the one that just left.
  const slotRecord = (number) => (number === lineNumber
    ? run.records.get(targetLineNumber)
    : number === targetLineNumber ? run.records.get(lineNumber) : run.records.get(number));
  const slotRatio = (number) => (number === lineNumber
    ? entering
    : number === targetLineNumber ? leaving : ratioOf(number));

  const additions = [];
  for (const members of [sourceRow, targetRow]) {
    const ratios = members.map(slotRatio);
    // A member whose size is unknown makes the whole computation unusable.
    // Skipping the protection is safe: the row keeps its ratios and simply ends
    // up at whatever height those produce.
    if (ratios.some((ratio) => !(ratio > 0))) return [];
    const sum = ratios.reduce((total, ratio) => total + ratio, 0);
    const available = run.containerWidth - run.gap * (members.length - 1);
    if (!(available > 0) || !(sum > 0)) continue;
    const height = available / sum;
    if (height >= minHeight) continue;
    const scale = height / minHeight;
    for (const number of members) {
      const record = slotRecord(number);
      const patch = cropPatchForRatio(record.params, record.natural, slotRatio(number) * scale);
      if (!patch) return [];
      additions.push([number, patch]);
    }
  }
  patches.push(...additions);
  return patches;
}

/** How many pictures a row may hold; the same rule the packer applies. */
function maxImagesPerRow(settings) {
  const control = settings.galleryControl ?? "both";
  return control === "height"
    ? 15
    : Math.min(15, Math.max(2, Number(settings.galleryMaxPerRow ?? settings.maxImagesPerRow ?? 5)));
}

/**
 * Move one picture into the neighbouring row.
 *
 * This is not a swap. The picture *joins* the row beside it: the source row
 * loses a member and the target row gains one. Nothing is relocated - the line
 * keeps its place and the binding ids decide which pictures share a row - so the
 * change survives the next re-pack instead of being undone by it.
 *
 * When the enlarged row would fall under the minimum height, every existing
 * member gives up the same fraction of its width and the incoming picture takes
 * what is left; if that cannot be done without producing a sliver, the merge is
 * refused rather than half-applied.
 */
function mergeRowImage(view, lineNumber, direction, settings) {
  const run = runContext(view, lineNumber, settings);
  if (!run?.complete) return;
  const sourceRow = run.rows.find((members) => members.includes(lineNumber));
  if (!sourceRow) return;
  const targetRow = run.rows[run.rows.indexOf(sourceRow) + direction];
  if (!targetRow) return;
  if (direction < 0 && sourceRow[0] !== lineNumber) return;
  if (direction > 0 && sourceRow[sourceRow.length - 1] !== lineNumber) return;
  if (targetRow.length >= maxImagesPerRow(settings)) {
    new Notice(t("目标行已满，无法并入。"));
    return;
  }

  const recordOf = (number) => run.records.get(number);
  const incoming = recordOf(lineNumber);
  const incomingRatio = incoming ? cellRatio(incoming.params, incoming.natural) : 0;
  const targetRatios = targetRow.map((number) => {
    const record = recordOf(number);
    return record ? cellRatio(record.params, record.natural) : 0;
  });
  if (!(incomingRatio > 0) || targetRatios.some((ratio) => !(ratio > 0))) return;

  const merged = direction < 0 ? [...targetRow, lineNumber] : [lineNumber, ...targetRow];
  const available = run.containerWidth - run.gap * (merged.length - 1);
  const naturalHeight = available / (targetRatios.reduce((total, ratio) => total + ratio, 0) + incomingRatio);
  const minHeight = Math.max(0, Number(settings.galleryMinHeight ?? 0));

  const edits = new Map();
  const id = nextBindingId(run);
  for (const number of merged) pushPatch(edits, number, { group: id });
  // Whatever is left of the source row becomes a bound row of its own, so the
  // packer cannot pull the remaining pictures back into the merged one.
  for (const number of sourceRow) {
    if (number !== lineNumber) pushPatch(edits, number, { group: id + 1 });
  }
  // The split changed, so a stored one no longer describes this run.
  pushPatch(edits, run.firstLineNumber, { rows: null });

  if (minHeight > 0 && naturalHeight < minHeight) {
    const plan = mergeShrinkPlan({
      available,
      targetHeight: minHeight,
      existingRatios: targetRatios,
      incomingRatio,
      maxCrop: Number(config.gallery?.mergeMaxCrop ?? 0.5),
      minWidth: minimumCellWidth(run.containerWidth, minHeight, Number(config.gallery?.minCellWidthRatio ?? 0.05))
    });
    if (!plan) {
      new Notice(t("这一行放不下更多图片。"));
      return;
    }
    if (plan.kappa > 0) {
      for (const number of targetRow) {
        const record = recordOf(number);
        const patch = cropShrinkWidth(record.params, record.natural, 1 - plan.kappa);
        if (!patch) {
          new Notice(t("这一行放不下更多图片。"));
          return;
        }
        pushPatch(edits, number, patch);
      }
    }
    // A clamped kappa leaves the row taller than planned; the incoming picture
    // absorbs the difference by being narrowed itself.
    if (plan.incomingRatio < incomingRatio - 1e-6) {
      const patch = cropShrinkWidth(incoming.params, incoming.natural, plan.incomingRatio / incomingRatio);
      if (!patch) {
        new Notice(t("这一行放不下更多图片。"));
        return;
      }
      pushPatch(edits, lineNumber, patch);
    }
  }
  applyEdits(view, edits);
}

/**
 * Write a crop for one picture, and let a bound row absorb the width it took.
 *
 * A bound row cannot push a picture out to make room, so the remaining members
 * give up the same proportion of their width. Ordinary rows need nothing: the
 * packer re-splits them. This is the only place a user-initiated crop is
 * written, which keeps the rebalance out of the render path.
 */
export function applyCropToLine(view, target, patch, settings = {}) {
  let position = target && typeof target === "object" && Number.isFinite(target.position)
    ? target.position
    : -1;
  if (!(position >= 0)) {
    try {
      position = view.posAtDOM(target, 0);
    } catch {
      return;
    }
  }
  if (!(position >= 0)) return;
  const lineNumber = view.state.doc.lineAt(position).number;
  const run = runContext(view, lineNumber, settings);
  const edits = new Map();
  pushPatch(edits, lineNumber, patch);
  rebalanceBoundRow(run, lineNumber, patch, settings, edits);
  applyEdits(view, edits);
}

function rebalanceBoundRow(run, lineNumber, patch, settings, edits) {
  if (!run?.complete) return;
  const row = run.rows.find((members) => members.includes(lineNumber));
  if (!row || row.length < 2) return;
  const records = row.map((number) => run.records.get(number));
  if (records.some((record) => !record)) return;
  const ids = records.map((record) => (Number(record.params?.group) > 0 ? Number(record.params.group) : 0));
  if (ids.some((id) => id === 0) || ids.some((id) => id !== ids[0])) return;

  const minHeight = Math.max(0, Number(settings.galleryMinHeight ?? 0));
  if (!(minHeight > 0) || !(run.containerWidth > 0)) return;

  const changedIndex = row.indexOf(lineNumber);
  const changedRatio = ratioAfterPatch(records[changedIndex].params, records[changedIndex].natural, patch);
  if (!(changedRatio > 0)) return;
  const others = records.filter((_, index) => index !== changedIndex);
  const plan = mergeShrinkPlan({
    available: run.containerWidth - run.gap * (row.length - 1),
    targetHeight: minHeight,
    existingRatios: others.map((record) => cellRatio(record.params, record.natural)),
    incomingRatio: changedRatio,
    maxCrop: Number(config.gallery?.mergeMaxCrop ?? 0.5),
    minWidth: minimumCellWidth(run.containerWidth, minHeight, Number(config.gallery?.minCellWidthRatio ?? 0.05))
  });
  if (!plan || !(plan.kappa > 0)) return;
  for (const record of others) {
    const number = row[records.indexOf(record)];
    const shrink = cropShrinkWidth(record.params, record.natural, 1 - plan.kappa);
    if (shrink) pushPatch(edits, number, shrink);
  }
}

function ratioAfterPatch(params, natural, patch) {
  const next = { ...params, ...patch };
  if (patch?.crop === null) return naturalRatio(natural);
  if (next?.crop) return effectiveCropRatio(next.crop, natural) ?? next.crop.w / next.crop.h;
  return naturalRatio(natural);
}

/* ------------------------------------------------------------------ painting */

function paintCellWidth(cell, width, gap) {
  const lineWidth = width + (cell.isLast ? 0 : gap);
  setIfChanged(cell.line.style, "width", `${lineWidth}px`);
  setIfChanged(cell.line.style, "--ag-embed-width", `${width}px`);
  paintCrop(cell, width / cell.rowHeight);
}

function paintCellHeight(cell, height, factor) {
  const base = cellRatio(cell.params, cell.natural);
  if (base > 0) paintCrop(cell, base * factor, height);
}

function paintCrop(cell, ratio, height = cell.rowHeight) {
  const { natural } = cell;
  if (!natural || !(ratio > 0)) return;
  const region = regionForRatio(frameRegion(cell.params, natural), natural, ratio);
  if (!region) return;
  const box = viewBoxValue(region, natural);
  // Paint the *line*, never the bitmap. The line's style is republished as a
  // whole by the decoration on commit, so the preview disappears with it. An
  // inline property on the <img> survives that publish, outranks the line's
  // value, and pins the picture to the last dragged crop - which is what made
  // a reset leave the picture at its cropped size and overlap its neighbours.
  const style = cell.line.style;
  if (box) setIfChanged(style, "--ag-img-view-box", box);
  setIfChanged(style, "--ag-img-fit", "cover");
  setIfChanged(style, "--ag-img-aspect", `${Math.round(ratio * 10000) / 10000}`);
  setIfChanged(style, "--ag-img-height", `${height}px`);
}

/** Crop properties an older build left inline on the bitmap itself. */
const IMAGE_PAINT_PROPERTIES = [
  "--ag-img-view-box", "--ag-img-fit", "--ag-img-aspect", "--ag-img-height"
];

/**
 * Drop crop properties written onto the bitmap by an earlier version.
 *
 * They are `!important` inline declarations, so they win over everything the
 * layout publishes. A picture that still carries them ignores every later crop,
 * reset and row height until the element is recreated.
 */
function clearImagePaint(image) {
  if (!image?.style) return;
  for (const property of IMAGE_PAINT_PROPERTIES) {
    if (image.style.getPropertyValue(property)) image.style.removeProperty(property);
  }
}

/* ------------------------------------------------------------------ plumbing */

/**
 * Record a patch for a line. Several patches can target one line in the same
 * transaction - a merge writes a binding id and clears the run's split on the
 * first line - so they are queued rather than overwritten.
 */
function pushPatch(edits, lineNumber, patch) {
  if (!lineNumber) return;
  const entry = edits.get(lineNumber);
  if (!entry) {
    edits.set(lineNumber, { patches: [patch] });
    return;
  }
  if (typeof entry === "string") {
    edits.set(lineNumber, { patches: [patch], text: entry });
    return;
  }
  entry.patches.push(patch);
}

/** Apply a `lineNumber -> text | { patches, text? }` map as one transaction. */
function applyEdits(view, edits) {
  const doc = view.state.doc;
  const changes = [];
  for (const [number, entry] of edits) {
    const line = doc.line(number);
    let text = typeof entry === "string" ? entry : entry.text ?? line.text;
    if (typeof entry !== "string") {
      for (const patch of entry.patches) text = updateImageAnnotation(text, patch) ?? text;
    }
    if (!text || text === line.text) continue;
    changes.push({ from: line.from, to: line.to, insert: text });
  }
  if (!changes.length) return false;
  view.dispatch({ changes });
  // Ask for a full geometry pass. Without it the row keeps the height the
  // previous layout published until some unrelated edit happens to invalidate
  // the diff cache, which is what made a reset repaint the pictures but leave
  // the surrounding block overlapping.
  view.dom.dispatchEvent(new CustomEvent("ag-layout-invalid"));
  view.requestMeasure();
  requestAnimationFrame(() => view.requestMeasure());
  return true;
}

function snapshotStyles(cells) {
  const snapshot = [];
  for (const cell of cells) {
    for (const element of [cell.line, cell.image]) {
      if (!element?.style) continue;
      for (const property of PAINTED_PROPERTIES) {
        snapshot.push({
          element,
          property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property)
        });
      }
    }
  }
  return snapshot;
}

function restoreStyles(snapshot) {
  for (const entry of snapshot) {
    if (entry.value) entry.element.style.setProperty(entry.property, entry.value, entry.priority || "");
    else entry.element.style.removeProperty(entry.property);
  }
}

function swallowNextClick() {
  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => document.removeEventListener("click", swallow, { capture: true }), 300);
}

/* ------------------------------------------------------------------ source */

/** The gallery that owns `lineNumber`: its records, rows and shared geometry. */
function runContext(view, lineNumber, settings) {
  const { groups } = documentIndex(view);
  const group = groups.find((items) => items.some((item) => item.lineNumber === lineNumber));
  if (!group) return null;

  const rendered = new Map();
  for (const line of view.dom.querySelectorAll(".cm-line.ag-cm-image-line")) {
    const number = lineNumberFor(view, line);
    if (number > 0) rendered.set(number, line);
  }

  const rows = [];
  const details = new Map();
  let complete = true;
  let current = null;
  for (const item of group) {
    const line = rendered.get(item.lineNumber);
    const natural = (line ? naturalSize(line.querySelector(".image-embed, .internal-embed")) : null)
      ?? cachedNatural(view, item.lineNumber);
    if (!natural) complete = false;
    details.set(item.lineNumber, { params: item.params, natural });
    const source = geometrySource(line);
    const offset = source ? readPx(source, "--ag-row-offset") : null;
    if (offset === null) { complete = false; continue; }
    if (!current || Math.abs(offset) < 0.5) {
      current = [];
      rows.push(current);
    }
    current.push(item.lineNumber);
  }
  if (!rows.length) return null;

  const storedRows = group[0].params?.rows;
  // The stored split covers the run when its counts reach or pass the image
  // count; the last count is truncated to what is left, so `4,3,1` on six
  // pictures is a complete split. A shorter list describes only a prefix and
  // leaves the tail to automatic routing.
  const rowsStored = Array.isArray(storedRows)
    && storedRows.some((count) => Number(count) > 0)
    && storedRows.reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0) >= group.length;
  const firstLine = rendered.get(group[0].lineNumber);
  const configuredGap = Number(settings?.galleryGap);
  return {
    records: details,
    rows,
    complete,
    rowsStored,
    firstLineNumber: group[0].lineNumber,
    containerWidth: firstLine ? readPx(geometrySource(firstLine), "--ag-row-width") : 0,
    gap: Number.isFinite(configuredGap) && configuredGap >= 0
      ? configuredGap
      : (inferredGap(rendered) || 12),
    settings
  };
}

/**
 * The element that carries a line's published row geometry.
 *
 * A floating row writes `--ag-row-*` on the line. A list row cannot: the editor
 * rewrites that element's inline style on every measure, so the list layout
 * publishes the same values on the embed instead.
 */
function geometrySource(line) {
  if (!line?.classList) return null;
  return line.classList.contains("ag-cm-list-line")
    ? line.querySelector(".image-embed, .internal-embed")
    : line;
}

/** Gutter width from the published offsets, for contexts without settings. */
function inferredGap(rendered) {
  for (const line of rendered.values()) {
    const source = geometrySource(line);
    const offset = readPx(source, "--ag-row-offset");
    const width = readPx(source, "--ag-embed-width");
    if (offset === null || width === null || Math.abs(offset) < 0.5) continue;
    return Math.max(0, Math.round(offset - width));
  }
  return 0;
}

/** Previous and next image line that are genuinely adjacent in the source. */
function adjacentImages(view, lineNumber) {
  const { records } = documentIndex(view);
  const index = records.findIndex((item) => item.lineNumber === lineNumber);
  if (index < 0) return { previous: null, next: null };
  const previous = records[index - 1] ?? null;
  const next = records[index + 1] ?? null;
  const blockedBefore = records[index]?.blockedBefore === true;
  const blockedAfter = next?.blockedBefore === true;
  return {
    previous: previous && !blockedBefore ? previous : null,
    next: next && !blockedAfter ? next : null
  };
}

function documentIndex(view) {
  if (documentCache && documentCache.view === view && documentCache.doc === view.state.doc) {
    return documentCache;
  }
  const text = view.state.doc.toString();
  const records = readSourceImages(text);
  // A list item may start with the picture itself (`- ![](a)`). That line holds
  // a marker, so the standalone-image reader skips it, and without it the
  // handles see no neighbour: swapping the two pictures of an item silently
  // does nothing and no merge is ever offered. The list reader already knows
  // which lines those are, so they are folded into the same ordered list.
  const listLayout = readListImageLayout(text);
  if (listLayout.size) {
    const known = new Set(records.map((record) => record.lineNumber));
    const extra = [];
    let previous = null;
    for (const [lineNumber, info] of [...listLayout.entries()].sort(([a], [b]) => a - b)) {
      const sameItem = previous
        && previous.itemId === info.itemId
        && previous.lineNumber + 1 === lineNumber;
      if (!known.has(lineNumber)) {
        extra.push({
          index: 0,
          lineNumber,
          target: "",
          identity: "",
          params: info.params ?? {},
          blankBefore: 0,
          blockedBefore: !sameItem
        });
      }
      previous = { itemId: info.itemId, lineNumber };
    }
    if (extra.length) {
      records.push(...extra);
      records.sort((a, b) => a.lineNumber - b.lineNumber);
      records.forEach((record, index) => {
        record.index = index;
        // The standalone reader never saw the marker line, so it treated the
        // item's own line as prose and marked the next picture as blocked -
        // which split one row into two single-image groups. Two picture lines
        // that are adjacent in the source are one paragraph, whatever syntax
        // they use.
        const previous = records[index - 1];
        if (previous && record.lineNumber === previous.lineNumber + 1) {
          record.blockedBefore = false;
          record.blankBefore = 0;
        }
      });
    }
  }
  documentCache = { view, doc: view.state.doc, records, groups: groupImageRecords(records) };
  return documentCache;
}

function lineNumberFor(view, line) {
  try {
    const position = view.posAtDOM(line, 0);
    return position >= 0 ? view.state.doc.lineAt(position).number : 0;
  } catch {
    return 0;
  }
}

/**
 * Size remembered for this line's picture, even when the bitmap has not
 * decoded yet.
 *
 * A cropped cell cannot be re-framed without its source dimensions: the drag
 * would preview, then throw the edit away on release because the maths had no
 * pixels to work with. The metric cache is primed from the file header when the
 * note opens, so it is the one source that is already there on the first paint.
 */
function cachedNatural(view, lineNumber) {
  if (!(lineNumber > 0)) return null;
  try {
    const text = view.state.doc.line(lineNumber).text;
    const link = linkFromText(text);
    if (!link) return null;
    const notePath = view.state.field(editorInfoField, false)?.file?.path || "";
    const size = imageMetric(imageMetricKey(notePath, link));
    return size && size.width > 0 && size.height > 0
      ? { width: size.width, height: size.height }
      : null;
  } catch {
    return null;
  }
}

/** Embed target of a source line, in the form the metric cache keys on. */
function linkFromText(text) {
  const wiki = /!\[\[([^\]]+)\]\]/.exec(text);
  if (wiki) return wiki[1].split("|")[0].split("#")[0].trim();
  const markdown = /!\[[^\]]*\]\(([^)\s]+)/.exec(text);
  return markdown ? markdown[1].trim() : "";
}

function naturalSize(embed) {
  const image = embed?.querySelector?.("img:not(.cm-widgetBuffer)");
  const width = Number(image?.naturalWidth);
  const height = Number(image?.naturalHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readPx(element, property) {
  const value = Number.parseFloat(element?.style?.getPropertyValue(property) ?? "");
  return Number.isFinite(value) ? value : null;
}

/**
 * Selectors for "the cell whose bar owns the pointer, its `suffixes` hidden".
 *
 * Written out one state at a time because `style-mod` splits a rule key on
 * every comma - including a comma inside `:has()` or `:is()`. A selector list
 * inside the pseudo-class would be cut in half and the whole rule dropped, so
 * the expansion happens here and the generated key holds top-level commas only.
 */
function barOwned(prefixes, suffixes) {
  const out = [];
  for (const prefix of prefixes) {
    for (const bar of BAR_STATES) {
      for (const suffix of suffixes) out.push(`${prefix}:has(> ${bar}) ${suffix}`);
    }
  }
  return out.join(", ");
}

/**
 * Stylesheet for the handles. Kept beside the gestures so the geometry and the
 * thing it draws cannot drift apart.
 *
 * A bar reveals itself and only itself: the hot zone is invisible until the
 * pointer is on it, and hovering one boundary must not light up the row's
 * height bar or the neighbouring boundary.
 */
export const galleryHandleTheme = {
  ".ag-gallery-button": {
    position: "absolute",
    zIndex: "3",
    opacity: "0",
    transition: "opacity 120ms ease",
    // Touch devices must drag the handle, not scroll the note.
    touchAction: "none"
  },
  ".ag-gallery-divider:hover, .ag-gallery-height:hover, .ag-gallery-divider.is-active, .ag-gallery-height.is-active": {
    opacity: "1"
  },
  ".ag-gallery-divider": {
    top: "0",
    height: "var(--ag-row-height)",
    width: `${HOT_ZONE}px`,
    cursor: "col-resize"
  },
  // Straddles the picture's bottom edge, which puts it above the caption
  // instead of below it.
  ".ag-gallery-height": {
    height: `${HOT_ZONE}px`,
    cursor: "ns-resize"
  },
  // The long line is the affordance. The short segment sits *inside* it and is
  // one shade brighter (darker in the light theme), so the bar reads as a
  // groove rather than a control.
  ".ag-gallery-handle-line": {
    position: "absolute",
    display: "block",
    background: "var(--background-modifier-border)"
  },
  ".ag-gallery-handle-line-vertical": {
    top: "0",
    bottom: "0",
    left: "50%",
    width: "4px",
    marginLeft: "-2px",
    borderRadius: "2px"
  },
  ".ag-gallery-handle-line-horizontal": {
    left: "0",
    right: "0",
    top: "50%",
    height: "4px",
    marginTop: "-2px",
    borderRadius: "2px"
  },
  ".ag-gallery-handle-grip": {
    position: "absolute",
    display: "block",
    background: "var(--text-faint)",
    // A capsule, like the rail itself: half the 4px thickness on every corner.
    borderRadius: "2px"
  },
  // The centre segment keeps its short length but takes the **full thickness**
  // of the rail. A 2px core inside a 4px rail has to be centred with half-pixel
  // maths and lands blurred on fractional display scales; matching the
  // thickness makes both boxes share their edges exactly. It is the length that
  // stays short, not the width.
  ".ag-gallery-handle-grip-vertical": {
    top: "50%",
    left: "50%",
    width: "4px",
    height: "28px",
    marginTop: "-14px",
    marginLeft: "-2px"
  },
  ".ag-gallery-handle-grip-horizontal": {
    top: "50%",
    left: "50%",
    width: "28px",
    height: "4px",
    marginTop: "-2px",
    marginLeft: "-14px"
  },
  ".ag-gallery-order": {
    position: "absolute",
    top: "50%",
    left: "0",
    right: "0",
    display: "flex",
    justifyContent: "space-between",
    transform: "translateY(-50%)",
    pointerEvents: "none",
    zIndex: "3"
  },
  ".ag-gallery-order-hidden": {
    display: "none !important"
  },
  // A short cell lays its trays out sideways. The right-hand group is reversed:
  // its first child is "swap", and a row-reversed tray keeps the swap button on
  // the inside (against the picture's edge) with "merge" outside it, matching
  // the vertical tray's ordering.
  ".ag-gallery-order-horizontal .ag-gallery-cluster": {
    flexDirection: "row"
  },
  ".ag-gallery-order-horizontal .ag-gallery-cluster[data-ag-edge=\"right\"]": {
    flexDirection: "row-reverse"
  },
  // One edge's controls. The pair shares a tray, exactly like the bar Obsidian
  // floats over an embed: 2px padding, 2px gap, an 80% primary surface with the
  // same blur, radius and two faint shadows. A different surface is what makes
  // a plugin control read as a foreign widget beside the native ones.
  ".ag-gallery-cluster": {
    display: "flex",
    flexDirection: "column",
    gap: `${TRAY_GAP}px`,
    padding: `${TRAY_PAD}px`,
    borderRadius: "6px",
    background: TRAY_BACKGROUND,
    boxShadow: TRAY_SHADOW,
    backdropFilter: TRAY_BLUR,
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 120ms ease"
  },
  ".image-embed:hover .ag-gallery-cluster, .internal-embed:hover .ag-gallery-cluster, .image-embed:focus-within .ag-gallery-cluster, .internal-embed:focus-within .ag-gallery-cluster, .cm-line.ag-gallery-row-hover .ag-gallery-cluster": {
    opacity: "1",
    pointerEvents: "auto"
  },
  // A bar reveals itself and only itself. It lives inside the cell it belongs
  // to, so its hover also hovers that embed and would reveal the cell's
  // reorder/link buttons and Obsidian's action bar. While a bar is hovered or
  // held, every other overlay in that cell stays down: the bar's activation is
  // its own state and is never shared with the buttons.
  [barOwned([".image-embed", ".internal-embed"], [".ag-gallery-cluster", ".ag-gallery-link"])]: {
    opacity: "0 !important",
    pointerEvents: "none !important"
  },
  [barOwned([".cm-line.ag-cm-gallery-line .image-embed", ".cm-line.ag-cm-gallery-line .internal-embed"], [".embed-actions"])]: {
    opacity: "0 !important",
    pointerEvents: "none !important"
  },
  // …and while any gallery gesture owns the pointer, none of the overlays may
  // flicker back as the pointer leaves the handle. `!important` is required on
  // `pointer-events` as well: the reveal rules are equally specific, and an
  // invisible overlay that still accepts the pointer swallows the drag.
  "&.ag-resizing .ag-gallery-cluster, &.ag-resizing .ag-gallery-link, &.ag-resizing .cm-line.ag-cm-gallery-line .embed-actions": {
    opacity: "0 !important",
    pointerEvents: "none !important"
  },
  // The release rebuilds the row's handles, which briefly takes the bar out
  // from under the pointer. `ag-gesture-settling` carries the suppression
  // across that window so the cell's buttons never fade in and out.
  "&.ag-gesture-settling .ag-gallery-cluster, &.ag-gesture-settling .ag-gallery-link, &.ag-gesture-settling .cm-line.ag-cm-gallery-line .embed-actions": {
    opacity: "0 !important",
    pointerEvents: "none !important"
  },
  // A native `clickable-icon`: 28x24 with 4px/6px padding and a 4px radius,
  // transparent until hovered. The tray supplies the contrast, so the button
  // itself carries no fill, border or shadow - a boxed button inside a tray is
  // what made the two sets look unrelated.
  ".ag-gallery-order-button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: `${BUTTON_WIDTH}px`,
    height: `${BUTTON_HEIGHT}px`,
    padding: "4px 6px",
    borderRadius: "4px",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    color: "var(--text-normal)",
    cursor: "pointer"
  },
  ".ag-gallery-order-button:hover": {
    background: "var(--background-modifier-hover)",
    color: "var(--text-normal)"
  },
  // The link sits in the corner the native resize handle used to occupy. It is
  // its own one-button tray, so a cluster of one and a cluster of two have the
  // same surface, radius and inset.
  ".ag-gallery-link": {
    position: "absolute",
    right: `${CONTROL_INSET}px`,
    bottom: `${CONTROL_INSET}px`,
    zIndex: "4",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: `${BUTTON_WIDTH + TRAY_PAD * 2}px`,
    height: `${BUTTON_HEIGHT + TRAY_PAD * 2}px`,
    // A native button sits 2px inside the tray and 6px inside itself: 8px
    // horizontally, 6px vertically from the tray's outer edge.
    padding: "6px 8px",
    borderRadius: "6px",
    background: TRAY_BACKGROUND,
    boxShadow: TRAY_SHADOW,
    backdropFilter: TRAY_BLUR,
    color: "var(--text-normal)",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 120ms ease"
  },
  ".ag-gallery-link:hover": {
    // Layer the hover wash over the tray instead of replacing it, or the 80%
    // backing disappears and a bright picture swallows the icon.
    backgroundImage: "linear-gradient(var(--background-modifier-hover), var(--background-modifier-hover))"
  },
  ".image-embed:hover .ag-gallery-link, .internal-embed:hover .ag-gallery-link, .image-embed:focus-within .ag-gallery-link, .internal-embed:focus-within .ag-gallery-link, .cm-line.ag-gallery-row-hover .ag-gallery-link": {
    opacity: "1",
    pointerEvents: "auto"
  },
  // This cell carries the flag but its row is not bound: show the control in
  // its activated form so the stray annotation is visible before it is cleared.
  // Same pair Obsidian uses for `clickable-icon.is-active`: the active icon
  // colour over the active-hover wash, laid over the tray instead of replacing
  // it so the surface does not drop out from under the glyph.
  ".ag-gallery-link-orphan": {
    color: "var(--icon-color-active)",
    backgroundImage: "linear-gradient(var(--background-modifier-active-hover), var(--background-modifier-active-hover))"
  },
  ".ag-gallery-link-bound": {
    color: "var(--icon-color-active)",
    backgroundImage: "linear-gradient(var(--background-modifier-active-hover), var(--background-modifier-active-hover))"
  },
  "&.ag-gallery-dragging, &.ag-gallery-dragging *": {
    userSelect: "none !important"
  }
};
