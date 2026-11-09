import config from "./config.json";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
/** Structures that end a float, so they also end the prose bound to it. */
const FLOAT_ZONE_BOUNDARY = "h1, h2, h3, h4, h5, h6, .el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6, pre, .el-pre, table, .el-table, blockquote, .el-blockquote, .callout, .math-block, mjx-container";
const GENERATED_SELECTOR = "style, .ag-caption[data-ag-owned='true'], [data-ag-generated='true']";
const FIT_TOLERANCE = Object.freeze({
  residual: 0.25,
  shrink: 0.002,
  maxDonors: 4,
  minWidth: 24,
  minHeight: 16,
  searchSteps: 5,
  backProbes: [0.85, 0.65],
  linePasses: 3
});

// Measured mismatch between the measure clone and Chromium's print layout at
// the page bottom: a row at bottom 1036 reads as fitting (page bottom 1043)
// but Chromium still pushes it. Pre-compression triggers inside this window
// and aims to leave a real margin, not merely reach the mathematical edge.
const PAGE_EDGE_TRIGGER = 12;
const PAGE_EDGE_TARGET = 20;

/**
 * Apply the pagination pass to a rendered print tree. All writes are tracked
 * and the returned cleanup restores the print tree to its pre-pagination DOM.
 */
export function optimizePdfPagination(root, options = {}) {
  if (!root?.querySelectorAll) return () => {};
  const settings = options.settings ?? {};
  const pagination = settings.pdfPagination ?? {};
  const tuning = { ...config.pdfPagination, ...(options.config ?? {}) };
  const view = root.querySelector(".markdown-preview-view") ?? root;
  const pageHeight = Number(options.pageHeight);
  if (!(pageHeight > 0)) return () => {};
  // Gallery rows must move as one unit. Wrapping happens before the measure
  // clone so both the printed tree and its clone share the same structure.
  const rowWrappers = [];
  protectGalleryRows(root, rowWrappers);
  // A float plus the prose beside it. Built after the gallery rows (their
  // grouping reads the parent's children) and before the measure clone, which
  // maps nodes by document order — inserting a wrapper afterwards would shift
  // that mapping and make every geometry lookup point at the wrong node.
  // Only `ordered` binds the two: `share` is the mode where prose is allowed to
  // fill whatever space is free, so the pair must stay breakable. Where the
  // pictures themselves land is decided earlier, by `floatBreaks.image`, and is
  // the same in both modes.
  const floatZones = [];
  if (settings.floatSpaceMode !== "share") protectFloatZones(root, floatZones);
  // Always build a print-width measurement clone when the caller supplies a
  // measurement document. The source preview is already laid out at the
  // editor width, so only creating a clone for a zero-sized root makes normal
  // exports use the wrong page geometry.
  const sandbox = createMeasureSandbox(root, options.measureDocument, options.pageWidth);
  const epsilon = Math.max(0.1, Number(tuning.geometryEpsilon) || 1);
  const changes = [];
  const changedElements = { attributes: new WeakMap(), styles: new WeakSet() };
  const cleanups = [];
  const state = {
    root, view, pageHeight, contentTop: 0, epsilon, tuning, pagination, changes, changedElements,
    measureMap: sandbox?.map ?? null,
    imageBaselines: new WeakMap(), lineHeightBaselines: new WeakMap(), imageFailures: new WeakSet(), imageOptimized: new WeakSet(),
    imageOptimizedPage: new WeakMap(),
    rowWrappers, floatZones,
    breakTable: null,
    breakVersion: -1,
    modelVersion: 0
  };
  // Pagination is measured against the print-width clone when one exists.
  // The live preview can be much wider than the selected paper and its screen
  // coordinates are unrelated to the clone's coordinates. Keeping the
  // caller's screen `contentTop` in that case shifts every page index by an
  // arbitrary offset and prevents image/orphan passes from ever matching.
  if (sandbox?.map) {
    const measuredView = sandbox.map.get(view) ?? view;
    const measuredStyle = measuredView.ownerDocument?.defaultView?.getComputedStyle?.(measuredView);
    const paddingTop = parseCssPixels(measuredStyle?.paddingTop);
    state.contentTop = rect(measuredView).top + paddingTop;
  } else {
    state.contentTop = Number.isFinite(Number(options.contentTop))
      ? Number(options.contentTop)
      : rectOf(state, view).top;
  }

  const rememberAttribute = (element, name) => {
    if (!element) return;
    let names = changedElements.attributes.get(element);
    if (!names) {
      names = new Set();
      changedElements.attributes.set(element, names);
    }
    if (names.has(name)) return;
    names.add(name);
    if (name === "data-ag-pdf-break-before") state.modelVersion += 1;
    const original = element.getAttribute(name);
    const restore = () => {
      if (original === null) element.removeAttribute(name);
      else element.setAttribute(name, original);
    };
    restore.element = element;
    restore.attrName = name;
    restore.kind = "attribute";
    changes.push(restore);
  };
  const rememberStyle = (element) => {
    if (!element || changedElements.styles.has(element)) return;
    changedElements.styles.add(element);
    const original = element.getAttribute("style");
    const restore = () => {
      if (original === null) element.removeAttribute("style");
      else element.setAttribute("style", original);
      // Every write is mirrored into the measurement clone, so a rollback has
      // to mirror the restore too. `rectOf` prefers the clone once it exists,
      // and a stale shrunken width there silently poisons every later page
      // number — the failure looks like "compression sometimes does nothing".
      // The clone root is skipped: its style carries the sandbox positioning.
      const measured = state.measureMap?.get(element);
      if (measured && element !== root) {
        if (original === null) measured.removeAttribute("style");
        else measured.setAttribute("style", original);
      }
    };
    restore.element = element;
    restore.kind = "style";
    changes.push(restore);
  };
  state.rememberAttribute = rememberAttribute;
  state.rememberStyle = rememberStyle;

  // Containment has to be decided from measured geometry, so it runs after the
  // clone exists; the wrapper structure itself was built before it.
  prepareFloatZones(state);

  try {
    const maxPasses = Math.max(1, Math.min(8, Number(tuning.maxPasses) || 4));
    for (let pass = 0; pass < maxPasses; pass += 1) {
      runHeadingPass(state, pagination, pass > 0);
      flush(root, state);
      runImagePass(state);
      flush(root, state);
      runHeadingPass(state, pagination, true);
      flush(root, state);
      runOrphanPass(state);
    }
  } catch (error) {
    // Pagination is an enhancement. A geometry failure must never block PDF
    // generation; the caller still receives a cleanup for partial writes.
    options.onError?.(error);
  }

  cleanups.push(...changes);
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    // Unwrap only after style/attribute restoration so the renderer cleanup
    // still sees the nodes under their original parent. Zones go first: a zone
    // can hold a gallery row's parent, never the row itself, but unwrapping
    // outermost-first keeps the parent chain valid throughout either way.
    for (const { wrapper, parent, nodes } of [...floatZones].reverse()) {
      for (const node of nodes) parent.insertBefore(node, wrapper);
      wrapper.remove();
    }
    for (const { wrapper, parent, nodes } of rowWrappers.reverse()) {
      for (const node of nodes) parent.insertBefore(node, wrapper);
      wrapper.remove();
    }
    sandbox?.remove();
  };
}

export function collectHeadingBlocks(root, level = 2) {
  const headings = [...root.querySelectorAll?.(HEADING_SELECTOR) ?? []]
    .filter((heading) => !heading.closest?.(GENERATED_SELECTOR))
    .filter((heading) => Number(heading.tagName.slice(1)) <= level);
  const blocks = [];
  for (const heading of headings) {
    const scope = heading.closest?.(".markdown-preview-section")
      ?? heading.closest?.(".markdown-preview-view")
      ?? root;
    const host = directChild(scope, heading) ?? heading;
    const previous = blocks.at(-1);
    if (previous && previous.scope === scope && isAdjacentHeadingBlock(scope, previous, host)) previous.headings.push(heading);
    else blocks.push({ first: heading, host, scope, headings: [heading] });
  }
  return blocks;
}

function runHeadingPass(state, pagination, repeat = false) {
  const mandatoryBreaks = pagination?.headingBreakEnabled === true && !repeat;
  // A disabled section-break option only disables forced breaks before the
  // selected heading levels. Page-end heading protection always remains on.
  // Run that protection after image compression so a successful image fit
  // can keep the heading on its current page, while a rolled-back fit moves
  // the heading together with its following image.
  if (!mandatoryBreaks && !repeat) return;
  const level = mandatoryBreaks
    ? Math.min(6, Math.max(1, Number(pagination.headingBreakLevel) || 2))
    : 6;
  for (const block of collectHeadingBlocks(state.root, level)) {
    if (!hasSubstantiveContentAfter(state.root, block)) continue;
    const firstRect = rectOf(state, block.first);
    const following = nextSubstantiveNode(state.root, block);
    if (!mandatoryBreaks && following && hasImageOptimization(state, following)) continue;
    // Obsidian creates the print window with `hide=true`. Its document has a
    // zero viewport until Chromium enters print layout, so geometry-based
    // title checks cannot run there. Keep each eligible heading block with
    // the first substantive unit after it using print CSS; Chromium ignores
    // this protection when the following unit is taller than a page.
    if (!(firstRect.height > 0 || firstRect.top > 0)) {
      // A continuous heading block owns one break point. Marking each heading
      // independently creates a blank page between h1/h2 (or h2/h3) pairs.
      const firstHost = directChild(block.scope, block.first) ?? block.first;
      state.rememberAttribute(firstHost, "data-ag-pdf-heading-block");
      state.rememberStyle(firstHost);
      firstHost.dataset.agPdfHeadingBlock = "true";
      firstHost.style.setProperty("break-after", "avoid-page", "important");
      firstHost.style.setProperty("page-break-after", "avoid", "important");
      if (mandatoryBreaks && hasSubstantiveContentBefore(state.root, block)) {
        state.rememberAttribute(firstHost, "data-ag-pdf-break-before");
        firstHost.dataset.agPdfBreakBefore = "true";
        firstHost.style.setProperty("break-before", "page", "important");
        firstHost.style.setProperty("page-break-before", "always", "important");
      }
      for (const heading of block.headings.slice(1)) {
        const memberHost = directChild(block.scope, heading) ?? heading;
        state.rememberAttribute(memberHost, "data-ag-pdf-heading-member");
        memberHost.dataset.agPdfHeadingMember = "true";
      }
      const followingHost = directChild(block.scope, following) ?? following;
      state.rememberAttribute(followingHost, "data-ag-pdf-heading-following");
      state.rememberStyle(followingHost);
      followingHost.dataset.agPdfHeadingFollowing = "true";
      followingHost.style.setProperty("break-before", "avoid-page", "important");
      followingHost.style.setProperty("page-break-before", "avoid", "important");
      continue;
    }
    // Every eligible heading block is a pagination point. The page-start check
    // below avoids a blank page when Chromium has already placed the block at
    // the top of a page. A following image is handled by the image pass first;
    // its passive-break fallback can defer this marker until compression has
    // either succeeded or been rolled back.
    if (!following) continue;
    const needsBreak = mandatoryBreaks
      ? headingNeedsBreak(state, block, following)
      : headingAtPageEnd(state, block, following);
    if (!needsBreak) continue;
    const offset = offsetOf(state, firstRect.top - state.contentTop);
    if (offset <= state.epsilon || (repeat && block.first.dataset.agPdfBreakBefore === "true")) continue;
    if (!mandatoryBreaks && isPassivePageBreak(state, block, following) && !hasImageFailure(state, following)) continue;
    state.rememberAttribute(block.first, "data-ag-pdf-break-before");
    state.rememberStyle(block.first);
    block.first.dataset.agPdfBreakBefore = "true";
    block.first.style.setProperty("break-before", "page", "important");
    block.first.style.setProperty("page-break-before", "always", "important");
    if (block.host && block.host !== block.first) {
      state.rememberAttribute(block.host, "data-ag-pdf-break-before");
      state.rememberStyle(block.host);
      block.host.dataset.agPdfBreakBefore = "true";
      block.host.style.setProperty("break-before", "page", "important");
      block.host.style.setProperty("page-break-before", "always", "important");
    }
    for (const heading of block.headings.slice(1)) {
      state.rememberAttribute(heading, "data-ag-pdf-heading-member");
      heading.dataset.agPdfHeadingMember = "true";
    }
  }
}

function runImagePass(state) {
  if (state.pagination?.imageOptimizationEnabled === false) return;
  const limits = readFitLimits(state);
  const units = collectImageUnits(state.root, state);
  if (!units.length) return;
  for (const target of units) {
    // A gallery row is one rigid unit: every cell must shrink by the same
    // factor, or the tallest cell keeps the row at its old height.
    const anchor = unitAnchor(state, target);
    if (!(anchor.height > 0) || anchor.height >= state.pageHeight - state.epsilon) {
      state.imageFailures.add(target.element);
      continue;
    }
    // The page the image would occupy if its own natural page break did not
    // exist. `pageIndex` includes that break, so it always reports the page
    // after the one we are trying to fit into.
    const window = pageWindow(state, anchor.flow);
    const residual = window.pageBottom - anchor.bottom;
    // Pre-compression: a gallery row that sits within the measured edge
    // mismatch is scaled *before* the final pagination, instead of searching
    // inside a page break Chromium has already decided. The scale is derived
    // from the residual, applied once, and never rolled back: the print tree
    // then paginates with the smaller pictures from the start.
    if (target.gallery && residual > -state.epsilon && residual < PAGE_EDGE_TRIGGER) {
      const plan = buildShrinkPlan(state, target);
      if (plan?.images?.length && plan.imageHeight > 0) {
        const deficit = PAGE_EDGE_TARGET + Math.max(0, residual);
        const shrink = Math.min(limits.maxImageShrink, deficit / plan.imageHeight + 0.002);
        if (shrink > 0) {
          applyScale(state, plan, shrink);
          state.imageOptimized.add(target.element);
          state.imageOptimizedPage.set(target.element, pageIndex(anchor, state));
          flush(state.root, state);
          continue;
        }
      }
    }
    // Single image: the embed owns the layout width, so shrinking only the
    // <img> leaves the block size unchanged. Scale the embed and the picture
    // together before the final pagination.
    if (!target.gallery && residual < PAGE_EDGE_TRIGGER) {
      const plan = buildShrinkPlan(state, target);
      const entry = plan?.entries?.[0];
      const image = entry?.element?.querySelector?.("img");
      const box = image ? rectOf(state, image) : null;
      const overflow = Math.max(0, -residual);
      if (entry && box?.height > 0 && overflow < limits.maxImageShrink * box.height) {
        const shrink = Math.min(limits.maxImageShrink, (PAGE_EDGE_TARGET + overflow) / box.height + 0.002);
        if (shrink > 0) {
          state.rememberStyle(entry.element);
          setStyle(state, entry.element, "width", `${entry.width * (1 - shrink)}px`, "important");
          state.rememberStyle(image);
          setStyle(state, image, "width", `${box.width * (1 - shrink)}px`, "important");
          setStyle(state, image, "height", `${box.height * (1 - shrink)}px`, "important");
          state.imageOptimized.add(target.element);
          state.imageOptimizedPage.set(target.element, pageIndex(anchor, state));
          flush(state.root, state);
          continue;
        }
      }
    }
    // Only overflow justifies compression. `pageIndex` reports the page the
    // unit prints on, which is already the next one when a previous forced
    // break moved it - that is not a fit failure.
    const pushed = residual < -state.epsilon;
    if (!pushed) continue;
    if (window.available < limits.fitPad + limits.minHeight) {
      state.imageFailures.add(target.element);
      continue;
    }
    // The budget counts per fit event, and an event stays solved: re-running
    // the pass for a heading that moved must not shrink the same picture a
    // second time for a page it already fits. A changed page means the fit is
    // no longer valid, so that case goes through again.
    if (state.imageOptimized.has(target.element)
      && state.imageOptimizedPage.get(target.element) === pageIndex(anchor, state)) continue;
    if (attemptExactFit(state, target, window.page, limits)) {
      state.imageOptimized.add(target.element);
      state.imageOptimizedPage.set(target.element, pageIndex(unitAnchor(state, target), state));
    } else {
      state.imageFailures.add(target.element);
    }
  }
}

function readFitLimits(state) {
  const pagination = state.pagination ?? {};
  return {
    maxImageShrink: Math.max(0, Math.min(0.5, Number(pagination.singleImageMaxShrink ?? state.tuning.singleImageMaxShrink))),
    maxLineShrink: Math.max(0, Math.min(0.2, Number(pagination.lineHeightMaxShrink ?? state.tuning.lineHeightMaxShrink))),
    priority: pagination.imageShrinkPriority === "line" ? "line" : "image",
    fitPad: state.epsilon + 1,
    residualTol: FIT_TOLERANCE.residual,
    minWidth: FIT_TOLERANCE.minWidth,
    minHeight: FIT_TOLERANCE.minHeight,
    maxDonors: FIT_TOLERANCE.maxDonors
  };
}

/**
 * Shift contributed only by flow units strictly before `flow`. The table entry
 * for a unit already includes that unit's own natural page break, so using
 * `shiftAt` here would report a full page of free space for an image that was
 * pushed to the next page.
 */
function shiftBefore(state, flow) {
  ensureModel(state);
  const table = state.breakTable ?? [];
  const limit = flow - state.epsilon;
  let low = 0;
  let high = table.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (table[middle].flow < limit) {
      result = table[middle].shift;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

/** The page a unit would occupy if its own natural break did not exist. */
function pageWindow(state, flow) {
  const height = state.pageHeight;
  const shift = shiftBefore(state, flow);
  const offset = positiveModulo(flow + shift, height);
  const page = Math.max(0, Math.floor((flow + shift + state.epsilon) / height));
  return {
    page,
    offset,
    available: height - offset,
    pageBottom: state.contentTop + (page + 1) * height - shift
  };
}

function unitAnchor(state, unit) {
  const measured = unitImageBounds(state, unit);
  // `floated` used to be published here and never read; the float's own extent
  // is what the model needs, and `unitImageBounds` already measures the picture
  // box rather than the (possibly much taller) wrapped prose.
  return {
    top: measured.top,
    bottom: measured.bottom,
    height: measured.height,
    flow: measured.top - state.contentTop
  };
}

/** For a paragraph that mixes an image and prose, only the image box (with its
 * caption) is the fitting target. Measuring the whole paragraph would count
 * prose that is allowed to continue on the next page. */
function unitImageBounds(state, unit) {
  const nodes = imageShrinkNodes(unit);
  const mixed = nodes.length > 0 && nodes[0] !== unit.element;
  if (!mixed) return measureImageUnit(unit.element, state, unit.elements);
  const rects = [];
  for (const node of nodes) {
    rects.push(rectOf(state, node));
    for (const child of node.querySelectorAll?.(".ag-caption, img") ?? []) rects.push(rectOf(state, child));
  }
  const usable = rects.filter((value) => value.width > 0 || value.height > 0);
  if (!usable.length) return rectOf(state, unit.element);
  const top = Math.min(...usable.map((value) => value.top));
  const bottom = Math.max(...usable.map((value) => value.bottom));
  return { top, bottom, height: Math.max(0, bottom - top) };
}

/** A text line plus its top margin: the smallest unit that could follow. */
function lineBudget(state, unit) {
  const view = unit.element?.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(unit.element);
  let lineHeight = Number.parseFloat(style?.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    const fontSize = Number.parseFloat(style?.fontSize);
    lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.5 : 24;
  }
  const next = unit.element?.nextElementSibling;
  const margin = Number.parseFloat(next ? view?.getComputedStyle?.(next)?.marginTop : 0) || 0;
  return Math.max(1, lineHeight + margin);
}

function isFloated(state, element) {
  const view = element?.ownerDocument?.defaultView;
  const value = view?.getComputedStyle?.(element)?.float;
  return value === "left" || value === "right";
}

/** Baseline widths captured from the current tree, so a scale is absolute for
 * this attempt and relative for a donor measured right before it is shrunk. */
function buildShrinkPlan(state, unit) {
  const nodes = imageShrinkNodes(unit);
  const entries = [];
  for (const element of nodes) {
    if (!element) continue;
    const width = rectOf(state, element).width;
    if (width > 0) entries.push({ element, width });
  }
  if (!entries.length) return null;
  const layout = rectOf(state, entries[0].element);
  const image = unit.element.matches?.("img") ? unit.element : unit.element.querySelector?.("img");
  const imageRect = image ? rectOf(state, image) : null;
  const slope = imageRect && layout.width > 0 ? imageRect.height / layout.width : 0;
  // A row is as wide as all its cells together, not as wide as its first cell.
  // The first cell of a capped row can be a small fraction of the column, and
  // treating that fraction as the row width made the min-width bound swallow
  // the whole shrink budget, so the row was never compressed and the page pass
  // gave up on it.
  const rowWidth = entries.reduce((total, entry) => total + entry.width, 0);
  const width = unit.gallery && rowWidth > 0 ? rowWidth : layout.width;
  // Shrinking a row's cells shrinks the row by the row's own height, which can
  // be taller than any single image (a portrait cell next to a landscape one).
  const measuredHeight = Number(unit.height) > 0
    ? Number(unit.height)
    : rectOf(state, unit.element.parentElement ?? unit.element).height;
  const imageHeight = entries.length > 1
    ? Math.max(imageRect?.height ?? 0, measuredHeight)
    : imageRect?.height ?? 0;
  // A gallery cell sizes its image with an explicit height, so narrowing the
  // cell only crops it. The images themselves are what has to shrink.
  const images = [];
  if (unit.gallery) {
    for (const { element } of entries) {
      for (const image of element.querySelectorAll?.("img") ?? []) {
        const box = rectOf(state, image);
        if (box.width > 0 && box.height > 0) images.push({ element: image, width: box.width, height: box.height });
      }
    }
  }
  return { entries, width, imageHeight, slope, images };
}

function applyScale(state, plan, shrink) {
  const scale = Math.max(0, Math.min(1, 1 - shrink));
  if (plan.images?.length) {
    // A gallery row keeps its column slots: only the pictures inside get
    // smaller (they are centred), so the grid stays aligned with the text.
    for (const { element, width, height } of plan.images) {
      state.rememberStyle(element);
      setStyle(state, element, "width", `${width * scale}px`, "important");
      setStyle(state, element, "height", `${height * scale}px`, "important");
    }
    return;
  }
  for (const { element, width } of plan.entries) {
    state.rememberStyle(element);
    setStyle(state, element, "width", `${width * scale}px`, "important");
    if (element.matches?.(".image-embed, .internal-embed")) {
      for (const image of element.querySelectorAll("img")) {
        state.rememberStyle(image);
        setStyle(state, image, "width", "100%", "important");
      }
    }
  }
}

function currentFit(state, target, limits) {
  const measured = measureImageUnit(target.element, state, target.elements);
  const window = pageWindow(state, measured.top - state.contentTop);
  return {
    page: window.page,
    bottom: measured.bottom,
    pageBottom: window.pageBottom,
    shortfall: measured.bottom - (window.pageBottom - limits.fitPad)
  };
}

/**
 * Shrink the target image by the smallest factor that makes its bottom land on
 * the previous page's bottom edge. If its own cap is exhausted, preceding
 * images or the line height make up the difference.
 */
function attemptExactFit(state, target, candidatePage, limits) {
  const mark = state.changes.length;
  const plan = buildShrinkPlan(state, target);
  if (!plan || !(plan.slope > 0) || !(plan.imageHeight > 0)) return false;
  try {
    const shrinkMax = Math.min(
      limits.maxImageShrink,
      Math.max(0, 1 - limits.minWidth / plan.width),
      Math.max(0, 1 - limits.minHeight / plan.imageHeight)
    );
    if (!(shrinkMax > 0)) return false;

    const measure = () => {
      const measured = measureImageUnit(target.element, state, target.elements);
      const window = pageWindow(state, measured.top - state.contentTop);
      return {
        bottom: measured.bottom,
        page: window.page,
        pageBottom: window.pageBottom
      };
    };
    const fitsAt = (shrink) => {
      applyScale(state, plan, shrink);
      flush(state.root, state);
      const check = measure();
      return check.page <= candidatePage && check.bottom <= check.pageBottom - limits.fitPad;
    };

    const first = measure();
    const deficit = first.bottom - (first.pageBottom - limits.fitPad);
    if (deficit <= limits.residualTol) return false;

    // A target whose bottom does not follow its width cannot be fitted by
    // searching: a gallery cell with a fixed pixel height, or a block whose
    // height is owned by something else, would otherwise burn five probes and
    // still land on a half-shrunk state. Probe once at the cap and give up if
    // the geometry did not move at all.
    const before = measure();
    applyScale(state, plan, shrinkMax);
    flush(state.root, state);
    const probe = measure();
    applyScale(state, plan, 0);
    flush(state.root, state);
    if (before.bottom - probe.bottom < 0.5) {
      rollbackTo(state, mark);
      flush(state.root, state);
      return false;
    }

    // Shrinking by `s` removes `s * imageHeight` of occupied height.
    let high = Math.min(shrinkMax, Math.max(0, deficit / plan.imageHeight));
    if (!fitsAt(high)) {
      if (!fitsAt(shrinkMax)) {
        rollbackTo(state, mark);
        flush(state.root, state);
        return false;
      }
      high = shrinkMax;
    }
    let low = 0;
    for (let step = 0; step < FIT_TOLERANCE.searchSteps && high - low > FIT_TOLERANCE.shrink; step += 1) {
      const middle = (low + high) / 2;
      if (fitsAt(middle)) high = middle;
      else low = middle;
    }
    // Caption reflow can make "fits" non-monotonic; prefer a smaller shrink
    // that still fits instead of accepting the first boundary found.
    for (const ratio of FIT_TOLERANCE.backProbes) {
      const probe = high * ratio;
      if (probe <= FIT_TOLERANCE.shrink) continue;
      if (fitsAt(probe)) {
        high = probe;
        break;
      }
    }
    applyScale(state, plan, high);
    flush(state.root, state);

    let check = currentFit(state, target, limits);
    if (check.page > candidatePage || check.shortfall > limits.residualTol) {
      const stages = limits.priority === "line" ? ["line", "donors"] : ["donors", "line"];
      for (const stage of stages) {
        if (currentFit(state, target, limits).shortfall <= limits.residualTol) break;
        if (stage === "donors") tryDonors(state, target, candidatePage, limits);
        else tryLineShrink(state, target, candidatePage, limits);
      }
      check = currentFit(state, target, limits);
    }

    const budget = lineBudget(state, target);
    const residual = check.pageBottom - check.bottom;
    // Landing on an earlier page is still a valid fit; the "leave room for no
    // text line" requirement only applies to the page we targeted.
    const ok = check.page < candidatePage
      || (check.page === candidatePage
        && residual >= -limits.residualTol
        && residual < budget);
    if (!ok) {
      rollbackTo(state, mark);
      flush(state.root, state);
      return false;
    }
    return true;
  } catch (error) {
    rollbackTo(state, mark);
    flush(state.root, state);
    throw error;
  }
}

function tryDonors(state, target, candidatePage, limits) {
  const targetTop = rectOf(state, target.element).top;
  const donors = collectImageUnits(state.root, state)
    .filter((unit) => unit !== target
      && !unit.gallery
      && !unit.element.closest?.(".ag-pdf-row")
      && rectOf(state, unit.element).top < targetTop - state.epsilon
      && pageIndex(unit, state) === candidatePage)
    .map((unit) => ({ unit, plan: buildShrinkPlan(state, unit) }))
    .filter((item) => item.plan && item.plan.slope > 0 && item.plan.imageHeight > 0)
    .filter((item) => !isFloated(state, item.unit.element))
    .sort((a, b) => b.plan.imageHeight - a.plan.imageHeight)
    .slice(0, limits.maxDonors);
  for (const { plan } of donors) {
    const check = currentFit(state, target, limits);
    if (check.shortfall <= limits.residualTol) return true;
    const shrink = Math.min(limits.maxImageShrink, check.shortfall / plan.imageHeight);
    if (!(shrink > 0)) continue;
    applyScale(state, plan, shrink);
    flush(state.root, state);
  }
  return currentFit(state, target, limits).shortfall <= limits.residualTol;
}

function tryLineShrink(state, target, candidatePage, limits) {
  for (let pass = 0; pass < FIT_TOLERANCE.linePasses; pass += 1) {
    const check = currentFit(state, target, limits);
    if (check.shortfall <= limits.residualTol) return true;
    const elements = textElementsOnPage(state.root, candidatePage, state);
    if (!elements.length) return false;
    let total = 0;
    const usable = [];
    for (const element of elements) {
      const height = rectOf(state, element).height;
      if (height > 0) {
        total += height;
        usable.push(element);
      }
    }
    if (!(total > 0)) return false;
    const requested = Math.min(limits.maxLineShrink, check.shortfall / total);
    if (!(requested > 0)) return false;
    for (const element of usable) {
      let base = state.lineHeightBaselines.get(element);
      if (!Number.isFinite(base)) {
        base = computedLineHeight(element);
        state.lineHeightBaselines.set(element, base);
      }
      if (!(base > 0)) continue;
      const view = element.ownerDocument?.defaultView;
      const current = Number.parseFloat(view?.getComputedStyle?.(element)?.lineHeight) || base;
      const applied = Math.max(0, 1 - current / base);
      const next = Math.min(limits.maxLineShrink, applied + requested);
      state.rememberStyle(element);
      setStyle(state, element, "line-height", `${base * (1 - next)}px`, "important");
    }
    flush(state.root, state);
  }
  return currentFit(state, target, limits).shortfall <= limits.residualTol;
}

function shrinkImagesUntilFits(state, candidates, target, candidatePage, maximum) {
  if (!(maximum > 0)) return false;
  const original = candidates.map((unit) => {
    const nodes = imageShrinkNodes(unit);
    return { unit, nodes: nodes.map((element) => {
      let width = state.imageBaselines.get(element);
      if (!Number.isFinite(width)) {
        width = rectOf(state, element).width;
        state.imageBaselines.set(element, width);
      }
      return { element, width };
    }) };
  });
  for (let step = 0.01; step <= maximum + 0.0001; step += 0.01) {
    for (const item of original) {
      for (const node of item.nodes) {
        if (!(node.width > 0)) continue;
        state.rememberStyle(node.element);
        setStyle(state, node.element, "width", `${node.width * (1 - step)}px`, "important");
        if (node.element.matches?.(".image-embed, .internal-embed")) {
          for (const image of node.element.querySelectorAll("img")) {
            state.rememberStyle(image);
            setStyle(state, image, "width", "100%", "important");
          }
        }
      }
    }
    flush(state.root, state);
    if (fitsBefore(state, target, candidatePage)) return true;
  }
  return false;
}

function shrinkTextUntilFits(state, page, target, maximum, textTarget = false) {
  const elements = textElementsOnPage(state.root, page, state);
  if (!elements.length || !(maximum > 0)) return false;
  const originals = elements.map((element) => {
    let lineHeight = state.lineHeightBaselines.get(element);
    if (!Number.isFinite(lineHeight)) {
      lineHeight = computedLineHeight(element);
      state.lineHeightBaselines.set(element, lineHeight);
    }
    return { element, lineHeight };
  }).filter((item) => item.lineHeight > 0);
  for (let step = 0.02; step <= maximum + 0.0001; step += 0.02) {
    for (const item of originals) {
      state.rememberStyle(item.element);
      setStyle(state, item.element, "line-height", `${item.lineHeight * (1 - step)}px`, "important");
    }
    flush(state.root, state);
    if (textTarget ? textLineFitsBefore(state, target, page) : fitsBefore(state, target, page)) return true;
  }
  return false;
}

function runOrphanPass(state) {
  if (state.pagination?.orphanControlEnabled === false) return;
  const maxLines = Math.max(1, Math.min(5, Number(state.pagination?.orphanMaxLines) || 2));
  // Every successful repair moves content and changes page membership, so
  // re-measure between repairs instead of trusting a single snapshot.
  for (let round = 0; round < 3; round += 1) {
    if (!repairOneOrphan(state, maxLines)) return;
  }
}

function repairOneOrphan(state, maxLines) {
  const lines = textLines(state.root, state);
  if (lines.length < 2) return false;
  const pages = new Map();
  for (const line of lines) {
    const list = pages.get(line.page);
    if (list) list.push(line); else pages.set(line.page, [line]);
  }
  const order = [...pages.keys()].sort((a, b) => a - b);
  const lastPage = order.at(-1);
  const targets = [];
  if (lastPage >= 1 && pages.get(lastPage).length <= maxLines) {
    targets.push({ page: lastPage, count: pages.get(lastPage).length, fallback: true });
  }
  for (const page of order) {
    if (page < 1 || page === lastPage) continue;
    if (pages.get(page).length !== 1) continue;
    // A heading break deliberately opened this page; pulling its first line
    // back would undo the requested section break.
    const head = pages.get(page)[0];
    if (head.element.closest?.('[data-ag-pdf-break-before="true"]')) continue;
    targets.push({ page, count: 1, fallback: false });
  }
  for (const target of targets) {
    if (shrinkPageBefore(state, target)) return true;
  }
  return false;
}

function shrinkPageBefore(state, { page, count, fallback }) {
  const head = textLines(state.root, state).filter((line) => line.page === page).slice(0, count);
  if (!head.length) return false;
  const target = head.at(-1);
  const pagination = state.pagination ?? {};
  const maxImageShrink = Math.max(0, Math.min(0.5, Number(pagination.singleImageMaxShrink ?? state.tuning.singleImageMaxShrink)));
  const maxLineShrink = Math.max(0, Math.min(0.2, Number(pagination.lineHeightMaxShrink ?? state.tuning.lineHeightMaxShrink)));
  const priority = pagination.imageShrinkPriority === "line" ? "line" : "image";
  const candidates = collectImageUnits(state.root, state).filter((unit) => !unit.gallery
    && !unit.element.closest?.(".ag-pdf-row")
    && pageIndex(unit, state) === page - 1);
  const mark = state.changes.length;
  const tryImage = () => candidates.length && shrinkImagesUntilFits(state, candidates, target, page - 1, maxImageShrink);
  const tryText = () => shrinkTextUntilFits(state, page - 1, target, maxLineShrink, true);
  if (priority === "line" ? tryText() || tryImage() : tryImage() || tryText()) return true;
  rollbackTo(state, mark);
  if (!fallback) return false;
  // Last resort for the final page: drop the surviving line's outer margins.
  const host = directChild(state.view, target.element);
  for (const element of new Set([target.element, host].filter(Boolean))) {
    state.rememberStyle(element);
    setStyle(state, element, "margin-block-start", "0px", "important");
    setStyle(state, element, "margin-block-end", "0px", "important");
  }
  flush(state.root, state);
  if (textLineFitsBefore(state, target, page - 1)) return true;
  rollbackTo(state, mark);
  return false;
}

/**
 * CSS cannot promise that a row of inline-block siblings stays on one page.
 * Wrapping each visual row in a block makes `break-inside: avoid-page`
 * effective. Cells keep their explicit pixel widths, so wrapping does not
 * reflow them.
 */
function protectGalleryRows(root, out) {
  // A zero-height root means no usable geometry (Obsidian's hidden popup).
  // Grouping by top would then merge every gallery cell into one row.
  if (!(rect(root).height > 0)) return;
  const nodes = [...root.querySelectorAll?.('[data-ag-layout="gallery"]') ?? []]
    .filter((element) => element.isConnected && !element.closest?.(".ag-pdf-row"))
    // Keep only the outermost gallery node of each cell; the image embed can
    // carry the same marker as its block.
    .filter((element) => !element.parentElement?.closest?.('[data-ag-layout="gallery"]'));
  const byParent = new Map();
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent) continue;
    const list = byParent.get(parent);
    if (list) list.push(node);
    else byParent.set(parent, [node]);
  }
  for (const [parent, list] of byParent) {
    const rows = [];
    for (const node of list) {
      const top = Math.round(rect(node).top);
      const current = rows.at(-1);
      if (current && Math.abs(current.top - top) <= 1) current.nodes.push(node);
      else rows.push({ top, nodes: [node] });
    }
    for (const row of rows) {
      if (row.nodes.length < 2) continue;
      const ordered = [...parent.children].filter((child) => row.nodes.includes(child));
      if (ordered.length < 2) continue;
      const wrapper = parent.ownerDocument.createElement("div");
      wrapper.className = "ag-pdf-row";
      wrapper.dataset.agPdfRow = "true";
      parent.insertBefore(wrapper, ordered[0]);
      for (const node of ordered) wrapper.appendChild(node);
      out.push({ wrapper, parent, nodes: ordered });
    }
  }
}

/**
 * A float owns the prose that wraps beside it, and that pair has to cross a
 * page boundary as one thing: otherwise Chromium keeps the picture on this page
 * while its text starts on the next (or the reverse), and the reader sees a
 * half-empty column. `protectFloatZones` builds the pair; whether the pair is
 * actually unbreakable is decided later, from measured geometry.
 *
 * The structure has to exist before the measure clone, because the clone maps
 * nodes by document order. Only attributes and CSS are written afterwards.
 */
function protectFloatZones(root, out) {
  const view = root.querySelector?.(".markdown-preview-view") ?? root;
  const sections = [...view.querySelectorAll?.(".markdown-preview-section") ?? []]
    .filter((section) => !section.parentElement?.closest?.(".markdown-preview-section"));
  const scopes = sections.length ? sections : [view];
  for (const scope of scopes) {
    const children = [...scope.children];
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index];
      if (!isFloatUnit(node)) continue;
      const zone = [node];
      let cursor = index + 1;
      while (cursor < children.length && !startsFloatZone(children[cursor])) {
        zone.push(children[cursor]);
        cursor += 1;
      }
      // A picture with nothing beside it needs no zone: its own height already
      // describes what a page break can move.
      if (zone.length < 2) continue;
      const wrapper = scope.ownerDocument.createElement("div");
      wrapper.className = "ag-float-zone";
      scope.insertBefore(wrapper, node);
      for (const child of zone) wrapper.appendChild(child);
      out.push({ wrapper, parent: scope, nodes: zone });
      index = cursor - 1;
    }
  }
}

/** Does this block own a floated picture (itself, or an inline embed)? */
function isFloatUnit(node) {
  if (node.matches?.('[data-ag-layout="float"]')) return true;
  return Boolean(node.querySelector?.('[data-ag-layout="float"]'));
}

/**
 * A sibling that must not be pulled into the previous picture's zone. Hard
 * coded on purpose: this is the HTML the zone needs to be correct, not the
 * reader's `floatBreaks` preference. Honouring that preference here would let a
 * disabled "picture" break swallow a whole gallery into one zone.
 */
function startsFloatZone(node) {
  if (node.matches?.(".ag-pdf-row")) return true;
  if (node.matches?.(FLOAT_ZONE_BOUNDARY) || node.querySelector?.(FLOAT_ZONE_BOUNDARY)) return true;
  // Any other picture owns a band of its own, floated or centred.
  if (node.matches?.("[data-ag-layout]") || node.querySelector?.("[data-ag-layout]")) return true;
  if (node.querySelector?.("img, .image-embed, .internal-embed")) return true;
  return false;
}

/**
 * Decide which zones may be treated as unbreakable.
 *
 * `display: flow-root` changes geometry, so it is applied first, measured, and
 * then withdrawn where the pair does not fit. A zone is atomic only when the
 * prose it binds ends inside the picture's own height and the picture fits a
 * page: otherwise the trailing prose must keep splitting at line boundaries,
 * which is the natural result the reader expects from a long paragraph.
 */
function prepareFloatZones(state) {
  if (!state.floatZones.length) return;
  const probes = [];
  for (const { wrapper } of state.floatZones) {
    const floated = floatedNodeOf(state, wrapper);
    if (!floated) continue;
    probes.push({ wrapper, floated });
    markFloatZone(state, wrapper, true);
  }
  if (!probes.length) return;
  flush(state.root, state);
  for (const probe of probes) {
    const band = rectOf(state, probe.floated);
    const bandBlock = directChild(probe.wrapper, probe.floated) ?? probe.floated;
    // A picture block is floated itself, so it owns no prose and is skipped.
    // A paragraph that floats an inline picture is the opposite case: the
    // picture escapes the paragraph box, so the block's own bottom *is* the
    // wrapped prose's bottom.
    const blockIsFloat = isFloated(state, bandBlock);
    let proseBottom = 0;
    for (const child of probe.wrapper.children) {
      if (blockIsFloat && child === bandBlock) continue;
      proseBottom = Math.max(proseBottom, rectOf(state, child).bottom);
    }
    // The picture has to cover the prose, and the picture itself has to fit a
    // page. Anything else would make `avoid-page` push the whole zone to a new
    // page and still overflow it.
    const covered = proseBottom <= band.bottom + state.epsilon;
    const fitsOnePage = band.height > 0 && band.height <= state.pageHeight - state.epsilon;
    if (!covered || !fitsOnePage) markFloatZone(state, probe.wrapper, false);
  }
  flush(state.root, state);
}

/** First node inside `root` that actually computes to a left/right float. */
function floatedNodeOf(state, root) {
  for (const node of [root, ...root.querySelectorAll?.('[data-ag-layout="float"]') ?? []]) {
    if (isFloated(state, node)) return node;
  }
  return null;
}

function markFloatZone(state, wrapper, on) {
  for (const node of [wrapper, state.measureMap?.get(wrapper)].filter(Boolean)) {
    if (on) node.dataset.agFloatZoneAtomic = "true";
    else delete node.dataset.agFloatZoneAtomic;
  }
}

/** Outermost floated nodes under `root` (the block and its embed share a mark). */
function floatNodesOf(root) {
  const nodes = [];
  if (root.matches?.('[data-ag-layout="float"]')) nodes.push(root);
  for (const node of root.querySelectorAll?.('[data-ag-layout="float"]') ?? []) {
    if (!node.parentElement?.closest?.('[data-ag-layout="float"]')) nodes.push(node);
  }
  return nodes;
}

/**
 * Height a unit would contribute if a page boundary pushed its float down. A
 * float is out of flow, so the next block starts at the float's own top and the
 * usual "distance to the next unit" arithmetic reports zero.
 */
function floatedExtent(state, unit, top) {
  let extent = 0;
  for (const node of floatNodesOf(unit)) {
    const box = rectOf(state, node);
    if (!(box.height > 0)) continue;
    extent = Math.max(extent, box.top + box.height - top);
  }
  return extent;
}

export function collectImageUnits(root, state = null) {
  const marked = [...root.querySelectorAll?.("[data-ag-layout]") ?? []]
    .filter((element) => !element.parentElement?.closest?.("[data-ag-layout]"));
  const elements = marked.length ? marked : [...root.querySelectorAll?.(".image-embed, .internal-embed") ?? []];
  const units = elements.map((element) => {
    const gallery = element.getAttribute("data-ag-layout") === "gallery";
    const nodes = [element, ...element.querySelectorAll?.("span, .image-embed, .internal-embed, .ag-caption, img") ?? []];
    const bounds = nodes.map((node) => rectOf(state, node)).filter((value) => value.width > 0 || value.height > 0);
    const top = bounds.length ? Math.min(...bounds.map((value) => value.top)) : rectOf(state, element).top;
    const bottom = bounds.length ? Math.max(...bounds.map((value) => value.bottom)) : rectOf(state, element).bottom;
    return { element, gallery, top, bottom, height: Math.max(0, bottom - top) };
  }).filter((unit) => unit.height > 0 || rectOf(state, unit.element).width > 0);
  const grouped = [];
  for (const unit of units) {
    const previous = grouped.at(-1);
    if (previous?.gallery && unit.gallery && Math.abs(previous.top - unit.top) <= 1) {
      previous.elements.push(unit.element);
      previous.top = Math.min(previous.top, unit.top);
      previous.bottom = Math.max(previous.bottom, unit.bottom);
      previous.height = previous.bottom - previous.top;
      continue;
    }
    grouped.push({ ...unit, elements: [unit.element] });
  }
  return grouped;
}

function fitsBefore(state, target, candidatePage) {
  if (!target) return false;
  if (target.textNode) return textLineFitsBefore(state, target, candidatePage);
  const measured = measureImageUnit(target.element, state, target.elements);
  return measured.height > 0
    && pageIndex(measured, state) <= candidatePage
    && unitOverflow(measured, state) <= state.epsilon;
}

function textElementsOnPage(root, page, state) {
  return [...root.querySelectorAll("p, li, td, th, tr")].filter((element) => {
    if (element.closest("[data-ag-layout=gallery]")) return false;
    return pageIndex({ top: rectOf(state, element).top }, state) === page;
  });
}

function previousContentPage(unit, state) {
  // Without `.markdown-preview-section` wrappers the view itself owns the
  // block granularity. Using the print root here would return the view for
  // every unit and make "moved to the next page" undetectable.
  const scope = unit.element.closest?.(".markdown-preview-section") ?? state.view ?? state.root;
  const host = directChild(scope, unit.element) ?? unit.element;
  let previous = host.previousElementSibling;
  while (previous) {
    if (previous.matches?.(GENERATED_SELECTOR)) {
      previous = previous.previousElementSibling;
      continue;
    }
    const value = rectOf(state, previous);
    if (value.height > 0 && (isSubstantive(previous) || previous.matches?.("[data-ag-layout]"))) {
      return pageIndex({ top: Math.max(value.top, value.bottom - state.epsilon) }, state);
    }
    previous = previous.previousElementSibling;
  }
  return null;
}

function textLines(root, state) {
  const byLine = new Map();
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let textNode;
  while ((textNode = walker.nextNode())) {
    if (!textNode.nodeValue?.trim()) continue;
    const owner = textNode.parentElement?.closest?.("p, li, td, th, tr");
    if (!owner || owner.closest("[data-ag-layout], h1, h2, h3, h4, h5, h6, .ag-caption")) continue;
    const measuredNode = state.measureMap?.get(textNode) ?? textNode;
    const range = measuredNode.ownerDocument.createRange();
    range.selectNodeContents(measuredNode);
    const fragments = [...range.getClientRects?.() ?? []];
    fragments.forEach((fragment, fragmentIndex) => {
      const top = Number(fragment.top) || 0;
      const height = Number(fragment.height) || 0;
      if (!(height > 0)) return;
      const page = pageOf(state, top - state.contentTop);
      const key = `${page}:${Math.round(top)}`;
      const existing = byLine.get(key);
      if (existing) {
        existing.owners.add(owner);
        return;
      }
      byLine.set(key, { element: owner, textNode, fragmentIndex, top, height, page, owners: new Set([owner]) });
    });
    range.detach?.();
  }
  return [...byLine.values()].sort((a, b) => a.top - b.top);
}

function textLineFitsBefore(state, target, page) {
  const measuredNode = state.measureMap?.get(target.textNode) ?? target.textNode;
  if (!measuredNode?.isConnected) return false;
  const range = measuredNode.ownerDocument.createRange();
  range.selectNodeContents(measuredNode);
  const fragments = [...range.getClientRects?.() ?? []];
  range.detach?.();
  const fragment = fragments[Math.min(target.fragmentIndex, fragments.length - 1)];
  if (!fragment) return false;
  // Convert the screen position into the paginated flow before comparing it
  // with a page boundary.
  const shift = shiftAt(state, fragment.top - state.contentTop);
  const pageTop = state.contentTop + page * state.pageHeight - shift;
  const pageBottom = pageTop + state.pageHeight;
  return fragment.top >= pageTop - state.epsilon
    && fragment.bottom <= pageBottom - state.epsilon;
}

function imageShrinkNodes(unit) {
  // Every cell has to move by the same factor, otherwise the row would keep its
  // tallest cell and not get any shorter.
  if (unit.gallery && Array.isArray(unit.elements) && unit.elements.length > 1) return unit.elements;
  const outer = unit.element;
  if (!outer?.querySelectorAll) return [outer];
  const embeds = [...outer.querySelectorAll(".image-embed, .internal-embed")]
    .filter((element) => element.querySelector("img"));
  if (outer.matches?.(".image-embed, .internal-embed")) return [outer];
  const clone = outer.cloneNode(true);
  clone.querySelectorAll?.(".image-embed, .internal-embed, img, .ag-caption").forEach((node) => node.remove());
  // Mixed paragraphs size the embed itself; image-only blocks size the outer
  // block so its float participates in normal document flow. Never shrink
  // both levels, which compounds the requested percentage.
  return clone.textContent?.trim() ? embeds : [outer];
}

function hasSubstantiveContentAfter(root, block) {
  const scope = block.scope ?? root;
  const start = blockLastHost(block);
  let node = start?.nextElementSibling;
  while (node) {
    if (isSubstantive(node)) return true;
    node = node.nextElementSibling;
  }
  return false;
}

function nextSubstantiveNode(root, block) {
  const scope = block.scope ?? root;
  const start = blockLastHost(block);
  let node = start?.nextElementSibling;
  while (node) {
    if (isSubstantive(node)) return node;
    node = node.nextElementSibling;
  }
  return null;
}

function blockLastHost(block) {
  const lastHeading = block?.headings?.at(-1) ?? block?.first;
  return directChild(block?.scope, lastHeading) ?? block?.host ?? lastHeading;
}

function isSubstantive(element) {
  if (!element || element.matches?.(GENERATED_SELECTOR)) return false;
  if (element.matches?.(HEADING_SELECTOR)) return true;
  const clone = element.cloneNode?.(true);
  clone?.querySelectorAll?.(GENERATED_SELECTOR).forEach((node) => node.remove());
  clone?.querySelectorAll?.("br").forEach((node) => node.remove());
  return Boolean(clone?.textContent?.trim() || clone?.querySelector?.("img, table, pre, blockquote, .image-embed, .internal-embed"));
}

function isPassivePageBreak(state, block, following) {
  const heading = rectOf(state, block.first);
  const content = rectOf(state, following);
  if (!(heading.height > 0 && content.height > 0)) return false;
  const imageLike = following.matches?.("[data-ag-layout], .image-embed, .internal-embed")
    || Boolean(following.querySelector?.("[data-ag-layout], .image-embed, .internal-embed, img"));
  if (!imageLike) return false;
  const imageUnit = measureImageUnit(following, state);
  return unitOverflow(imageUnit, state) > state.epsilon;
}

function headingNeedsBreak(state, block, following) {
  // The first heading owns the break for a continuous heading block. Use the
  // block's last heading when measuring the available space: a title can be
  // followed by content that still has the same page index in the unprinted
  // DOM, while the title and that content together overflow the real page.
  const first = rectOf(state, block.first);
  const last = rectOf(state, block.headings.at(-1) ?? block.first);
  const headingTop = Math.min(first.top, last.top);
  const headingBottom = Math.max(first.bottom, last.bottom);
  const headingPage = pageIndex({ top: headingTop }, state);
  const content = following.matches?.("[data-ag-layout], .image-embed, .internal-embed")
    || following.querySelector?.("[data-ag-layout], .image-embed, .internal-embed, img")
    ? measureImageUnit(following, state)
    : flowRect(state, following);
  const contentPage = pageIndex(content, state);
  if (contentPage > headingPage) return true;
  if (following.matches?.("[data-ag-layout], .image-embed, .internal-embed")
    || following.querySelector?.("[data-ag-layout], .image-embed, .internal-embed, img")) {
    return true;
  }
  return true;
}

function headingAtPageEnd(state, block, following) {
  const first = rectOf(state, block.first);
  const last = rectOf(state, block.headings.at(-1) ?? block.first);
  if (!(first.height > 0 || last.height > 0)) return false;
  const headingBottom = Math.max(first.bottom, last.bottom);
  const headingPage = pageIndex({ top: Math.min(first.top, last.top) }, state);
  const content = following.matches?.("[data-ag-layout], .image-embed, .internal-embed")
    || following.querySelector?.("[data-ag-layout], .image-embed, .internal-embed, img")
    ? measureImageUnit(following, state)
    : flowRect(state, following);
  // `pageIndex` answers "where does it print", which is already the next page
  // for a unit that was pushed whole. What matters here is whether it *could*
  // have stayed: an overflowing unit is the case the heading has to follow.
  if (unitOverflow(content, state) > state.epsilon) return true;
  const contentPage = fitPageOf(state, content);
  if (contentPage > headingPage) return true;
  // The page bottom moves up by the cumulative break shift above this heading.
  const shift = shiftAt(state, Math.max(0, headingBottom - state.contentTop));
  const pageBottom = state.contentTop + (headingPage + 1) * state.pageHeight - shift;
  return headingBottom >= pageBottom - state.epsilon;
}

function hasSubstantiveContentBefore(root, block) {
  const scope = block.scope ?? root;
  const start = directChild(scope, block.first) ?? block.host;
  let node = start?.previousElementSibling;
  while (node) {
    if (isSubstantive(node)) return true;
    node = node.previousElementSibling;
  }
  return false;
}

function hasImageFailure(state, element) {
  if (state.imageFailures.has(element)) return true;
  return Boolean([...element.querySelectorAll?.("[data-ag-layout], .image-embed, .internal-embed") ?? []]
    .some((node) => state.imageFailures.has(node)));
}

function hasImageOptimization(state, element) {
  if (state.imageOptimized.has(element)) return true;
  return Boolean([...element.querySelectorAll?.("[data-ag-layout], .image-embed, .internal-embed") ?? []]
    .some((node) => state.imageOptimized.has(node)));
}

function unitOverflow(unit, state) {
  const top = Number(unit?.top) || 0;
  const height = Number(unit?.height) || 0;
  if (!(height > 0)) return 0;
  const offset = offsetBefore(state, top - state.contentTop);
  if (offset <= state.epsilon) return Math.max(0, height - state.pageHeight);
  return Math.max(0, offset + height - state.pageHeight);
}

function measureImageUnit(element, state = null, elements = null) {
  // A gallery row is several sibling cells that must be treated as one box: its
  // height is the tallest cell, not the first one's.
  const roots = elements?.length ? elements : [element];
  const nodes = [];
  for (const root of roots) {
    nodes.push(root, ...root.querySelectorAll?.("span, .image-embed, .internal-embed, .ag-caption, img") ?? []);
  }
  const bounds = nodes.map((node) => rectOf(state, node)).filter((value) => value.width > 0 || value.height > 0);
  const top = bounds.length ? Math.min(...bounds.map((value) => value.top)) : rectOf(state, element).top;
  const bottom = bounds.length ? Math.max(...bounds.map((value) => value.bottom)) : rectOf(state, element).bottom;
  return { element, top, bottom, height: Math.max(0, bottom - top) };
}

function flowRect(state, element) {
  const nodes = [element, ...element.querySelectorAll?.("*:not(style)") ?? []];
  const bounds = nodes.map((node) => rectOf(state, node)).filter((value) => value.width > 0 || value.height > 0);
  if (!bounds.length) return rectOf(state, element);
  return {
    top: Math.min(...bounds.map((value) => value.top)),
    bottom: Math.max(...bounds.map((value) => value.bottom)),
    width: Math.max(...bounds.map((value) => value.width)),
    height: Math.max(0, Math.max(...bounds.map((value) => value.bottom)) - Math.min(...bounds.map((value) => value.top)))
  };
}

function directChild(root, element) {
  let node = element;
  while (node?.parentElement && node.parentElement !== root) node = node.parentElement;
  return node?.parentElement === root ? node : null;
}

function isAdjacentHeadingBlock(scope, previous, host) {
  const previousIndex = [...scope.children].indexOf(previous.host);
  const hostIndex = [...scope.children].indexOf(host);
  if (previousIndex < 0 || hostIndex < 0 || hostIndex < previousIndex) return false;
  if (hostIndex === previousIndex) return !isSubstantiveOutsideHeading(host, previous.headings.at(-1));
  for (let index = previousIndex + 1; index < hostIndex; index += 1) {
    if (isSubstantive(scope.children[index])) return false;
  }
  return [...host.querySelectorAll?.(HEADING_SELECTOR) ?? []].every((heading) => !isSubstantiveOutsideHeading(host, heading));
}

function isSubstantiveOutsideHeading(host, heading) {
  const clone = host.cloneNode(true);
  clone.querySelectorAll(HEADING_SELECTOR).forEach((node) => node.remove());
  return Boolean(clone.textContent?.trim() || clone.querySelector?.("img, table, pre, blockquote"));
}

/**
 * Screen layout is one continuous column, but the printed document is split by
 * forced and natural page breaks that push everything below them down. The
 * break table is the step function mapping a screen Y to that cumulative push.
 */
function rebuildBreakTable(state) {
  const units = flowUnits(state);
  const table = [];
  let shift = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const box = rectOf(state, unit);
    const flow = box.top - state.contentTop;
    if (unit.dataset?.agPdfBreakBefore === "true") {
      const remaining = positiveModulo(flow + shift, state.pageHeight);
      if (remaining > state.epsilon) shift += state.pageHeight - remaining;
    }
    const next = units[index + 1];
    let height = next
      ? Math.max(0, rectOf(state, next).top - box.top)
      : Math.max(0, box.bottom - box.top);
    // A float is out of flow, so the next block starts at the float's own top
    // and the subtraction above reports zero: the table then never records that
    // the picture was pushed to the next page, and every page number after it
    // is wrong. Use the picture's own extent — the only thing a page break can
    // move — and let the wrapped prose keep splitting at line boundaries.
    if (height <= state.epsilon) {
      const floated = floatedExtent(state, unit, box.top);
      if (floated > 0) height = floated;
    }
    const remaining = state.pageHeight - positiveModulo(flow + shift, state.pageHeight);
    // Only an unbreakable unit is pushed whole to the next page. A paragraph
    // splits at a line boundary instead, so assuming it moves wastes the lines
    // that still fit and shifts every later page index by that much.
    if (isAtomicFlowUnit(unit)
      && height > remaining + state.epsilon
      && height <= state.pageHeight + state.epsilon) {
      shift += remaining;
    }
    table.push({ flow, shift });
  }
  state.breakTable = table;
  state.breakVersion = state.modelVersion;
}

function ensureModel(state) {
  if (state.breakVersion === state.modelVersion) return;
  rebuildBreakTable(state);
}

function flowUnits(state) {
  const scopes = [...state.root.querySelectorAll?.(".markdown-preview-section") ?? []]
    .filter((section) => !section.parentElement?.closest?.(".markdown-preview-section"));
  const units = [];
  for (const scope of scopes) {
    for (const child of scope.children) if (isFlowUnit(child)) units.push(child);
  }
  if (!units.length && state.view?.children) {
    for (const child of state.view.children) if (isFlowUnit(child)) units.push(child);
  }
  return units;
}

/** A unit that cannot be divided by a page break: it moves whole or splits
 * mid-content (images, rows, tables, code). Prose may continue on the next
 * page, so it must not shift the model. */
function isAtomicFlowUnit(unit) {
  if (!unit?.matches) return false;
  // A zone that was measured and found contained is atomic by construction:
  // its own clone still holds the prose, so the generic rule below would call
  // it breakable and the model would never move it as one piece.
  if (unit.matches(".ag-float-zone")) return unit.dataset?.agFloatZoneAtomic === "true";
  if (unit.matches(".ag-pdf-row, table, .el-table, pre, blockquote, .callout")) return true;
  if (unit.querySelector?.("table, pre, .math-block, mjx-container")) return true;
  const heading = unit.matches(".ag-pdf-block")
    ? unit.firstElementChild?.matches?.("h1, h2, h3, h4, h5, h6") === true
    : unit.matches("h1, h2, h3, h4, h5, h6");
  const media = unit.querySelector?.("img, [data-ag-layout], .image-embed, .internal-embed");
  if (!media) return Boolean(heading);
  const clone = unit.cloneNode(true);
  clone.querySelectorAll?.(".image-embed, .internal-embed, img, .ag-caption, [data-ag-generated='true']")
    .forEach((node) => node.remove());
  clone.querySelectorAll?.("br").forEach((node) => node.remove());
  return !clone.textContent?.trim();
}

function isFlowUnit(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.matches?.("style, [data-ag-generated='true'], .ag-caption")) return false;
  return true;
}

function shiftAt(state, flow) {
  ensureModel(state);
  const table = state.breakTable ?? [];
  let low = 0;
  let high = table.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (table[middle].flow <= flow) {
      result = table[middle].shift;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function pageOf(state, flow) {
  const shifted = flow + shiftAt(state, flow);
  return Math.max(0, Math.floor((shifted + state.epsilon) / state.pageHeight));
}

function offsetOf(state, flow) {
  return positiveModulo(flow + shiftAt(state, flow), state.pageHeight);
}

/**
 * Offset of a unit inside the page it *would* occupy if it fitted. `offsetOf`
 * adds the unit's own natural break, which puts every overflowing unit at
 * offset 0 and makes it look like it starts a page - so any check that asks
 * "does this fit?" has to use the shift of the units before it.
 */
function offsetBefore(state, flow) {
  return positiveModulo(flow + shiftBefore(state, flow), state.pageHeight);
}

/** Page a unit would print on if its own natural break did not exist. */
function fitPageOf(state, value) {
  const top = Number(value.top ?? value.bottom ?? 0);
  return Math.max(0, Math.floor((top - state.contentTop + shiftBefore(state, top - state.contentTop) + state.epsilon) / state.pageHeight));
}

function pageIndex(value, state) {
  const top = Number(value.top ?? value.bottom ?? 0);
  return pageOf(state, top - state.contentTop);
}

function positiveModulo(value, divisor) {
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

function computedLineHeight(element) {
  const value = element.ownerDocument?.defaultView?.getComputedStyle?.(element)?.lineHeight;
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const font = Number.parseFloat(element.ownerDocument?.defaultView?.getComputedStyle?.(element)?.fontSize);
  return Number.isFinite(font) ? font * 1.2 : 0;
}

// The measure-sandbox branch reads the view's padding from computed styles.
function parseCssPixels(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function rect(element) {  const value = element?.getBoundingClientRect?.();
  return {
    top: Number(value?.top) || 0,
    bottom: Number(value?.bottom) || Number(value?.top) || 0,
    width: Number(value?.width) || 0,
    height: Number(value?.height) || 0
  };
}

function flush(root, state = null) {
  // Geometry changed; the break table recorded against the previous layout is
  // no longer valid.
  if (state) state.modelVersion += 1;
  root?.getBoundingClientRect?.();
  root?.ownerDocument?.defaultView?.getComputedStyle?.(root);
  const measuredRoot = state?.measureMap?.get(root);
  measuredRoot?.getBoundingClientRect?.();
  measuredRoot?.ownerDocument?.defaultView?.getComputedStyle?.(measuredRoot);
}

function setStyle(state, element, property, value, priority = "") {
  element?.style?.setProperty(property, value, priority);
  state.measureMap?.get(element)?.style?.setProperty(property, value, priority);
}

function rectOf(state, element) {
  const actual = rect(element);
  const measured = state?.measureMap?.get(element);
  // Once a print clone exists it is the authoritative geometry. Falling back
  // to the visible preview here silently mixes editor-width and paper-width
  // measurements, so a unit can never be recognised as having moved to the
  // next page after it is resized.
  if (measured) return rect(measured);
  return actual;
}

function createMeasureSandbox(root, measureDocument, pageWidth) {
  if (!measureDocument?.body || !(Number(pageWidth) > 0)) return null;
  let clone;
  try {
    clone = root.cloneNode(true);
    clone.dataset.agPdfMeasureSandbox = "true";
    clone.style.setProperty("position", "absolute", "important");
    clone.style.setProperty("left", "-100000px", "important");
    clone.style.setProperty("top", "0", "important");
    clone.style.setProperty("display", "block", "important");
    clone.style.setProperty("visibility", "hidden", "important");
    clone.style.setProperty("pointer-events", "none", "important");
    clone.style.setProperty("width", `${Number(pageWidth)}px`, "important");
    clone.style.setProperty("max-width", `${Number(pageWidth)}px`, "important");
    clone.style.setProperty("height", "auto", "important");
    clone.style.setProperty("overflow", "visible", "important");
    measureDocument.body.appendChild(clone);
    const originals = [root, ...root.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    const map = new WeakMap();
    const length = Math.min(originals.length, copies.length);
    for (let index = 0; index < length; index += 1) map.set(originals[index], copies[index]);
    // Text line measurements (used by orphan control) are performed through
    // Range#getClientRects. Map text nodes by document order as well; mapping
    // only elements leaves those ranges attached to the screen preview.
    const originalWalker = root.ownerDocument?.createTreeWalker?.(root, 4);
    const copyWalker = clone.ownerDocument?.createTreeWalker?.(clone, 4);
    if (originalWalker && copyWalker) {
      let originalText = originalWalker.nextNode();
      let copyText = copyWalker.nextNode();
      while (originalText && copyText) {
        map.set(originalText, copyText);
        originalText = originalWalker.nextNode();
        copyText = copyWalker.nextNode();
      }
    }
    return { map, remove: () => clone.remove() };
  } catch {
    clone?.remove?.();
    return null;
  }
}

function rollbackTo(state, mark) {
  const pending = state.changes.splice(mark);
  for (const cleanup of pending.reverse()) {
    cleanup();
    if (cleanup.kind === "style") state.changedElements.styles.delete(cleanup.element);
    if (cleanup.kind === "attribute") {
      const names = state.changedElements.attributes.get(cleanup.element);
      names?.delete(cleanup.attrName);
      if (names?.size === 0) state.changedElements.attributes.delete(cleanup.element);
    }
  }
}

