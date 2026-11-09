import { readImageAnnotation } from "./annotations.js";
import { calculateFloatLayout, calculateGalleryRows, readAspectRatio } from "./layout.js";
import { resolveRunMode } from "./routes.js";
import config from "./config.json";
import { resolveProfileRule } from "./profile-rules.js";
import { buildFloatImageOrder } from "./float-order.js";
import { imageIdentityFromDOM, MAX_GALLERY_BLANK_LINES, readEmbedTarget, readSourceImages, groupImageRecords } from "./image-runs.js";
import { cropRegion, effectiveCropRatio, fallbackFocus, supportsViewBox, viewBoxValue } from "./crop-geometry.js";
import { imageMetric, imageMetricKey, linkMetric, linkMetricKey, rememberImageMetric, rememberLinkMetric } from "./image-metrics.js";

const BOUNDARIES = new Set(["PRE", "TABLE", "UL", "OL", "BLOCKQUOTE", "HR"]);
const HEADING = /^H[1-6]$/;
/**
 * Elements that own the images inside them. A list item and a table cell each
 * lay their pictures out against a different column width, so the renderer
 * treats them as independent flow roots instead of inheriting the section's
 * geometry.
 *
 * `.callout` is listed only to claim its pictures, not to lay them out:
 * Obsidian does not render a callout as an editable block in Live Preview, so
 * any geometry the plugin wrote inside one could never be adjusted by the
 * reader. Everything inside a callout therefore keeps Obsidian's own styling.
 */
const SCOPE_SELECTOR = "td, th, li, .callout";
/**
 * Narrowest column that can still hold a readable line beside a float. Below
 * roughly eleven CJK characters the wrap turns into a ragged strip, so the
 * picture is centred instead. Only the print path uses this: the reading view
 * keeps its own breakpoint, because there the column width is the window's.
 */
const PRINT_MIN_WRAP_COLUMN = 180;
const blockSnapshots = new WeakMap();
const floatIndexStates = new WeakMap();

/** Drop document identity state when Obsidian reuses a preview section for a
 * different file. Without this, alternating floats inherit the old file's
 * sequence until the plugin is restarted. */
export function resetFloatIndices(root) {
  if (root) floatIndexStates.delete(root);
}

export function renderAutoGallery(root, options = {}) {
  if (!root?.children) return () => {};
  // A preview section can be reused while its old postprocessor nodes are
  // detached/reinserted. Clean markers left by an earlier owner before
  // selecting the current block granularity; otherwise an inner <p> and its
  // surrounding .el-p both retain widths and compound them.
  cleanupStaleGenerated(root);
  const cleanups = [];
  const indexRoot = options.floatIndexRoot ?? root;
  const floatState = getFloatIndexState(indexRoot);
  if (options.sourceText && options.resetSourceOrder !== false) floatState.sourceUsed.clear();
  const width = Number.isFinite(options.layoutWidth) && options.layoutWidth > 0
    ? options.layoutWidth
    : root.clientWidth || root.getBoundingClientRect?.().width || 0;
  renderFlow(root, width, options, cleanups, { floatState, sourceText: options.sourceText ?? null, flowScope: null });
  // Nested containers are separate flow roots: a list item packs only what it
  // contains, and a table cell opts out of sizing entirely. Doing this after
  // the section pass lets each image be claimed by exactly one owner (its
  // nearest scope). A callout also claims its pictures, but is deliberately
  // left undecorated.
  renderNestedScopes(root, options, cleanups, { floatState });
  return () => cleanups.reverse().forEach((cleanup) => cleanup());
}

/**
 * Render one flow root. Currently only the section uses this: a list item lays
 * its own pictures out (`renderListScope`), a table cell opts out of sizing,
 * and a callout is excluded entirely. `flowScope` is the element that owns
 * unscoped images; null means the section itself.
 */
function renderFlow(flowRoot, width, options, cleanups, { floatState, sourceText = null, flowScope = null }) {
  if (!flowRoot?.children) return;
  // Two image references on consecutive source lines arrive as one paragraph.
  // Split it so every image owns a block: `ag:isolate` then removes only its
  // own image from the gallery, and the remaining images can still form rows
  // with the blocks below them. The reading view registers these blocks with
  // its virtual renderer (`registerPreviewBlocks` in plugin.js); a block the
  // renderer does not know would be detached while scrolling.
  splitImageBlocks(flowRoot, cleanups, flowScope);
  const children = [...flowRoot.children];
  // Reading view drops blank paragraphs, so "at most two blank lines between
  // gallery images" can only be read from the source text. A source cursor is
  // only available for the section; a list item groups structurally.
  const source = createSourceCursor(sourceText ? readSourceImages(sourceText) : null);
  const groupsByRecord = groupSourceRecords(source.records);
  let index = 0;
  while (index < children.length) {
    const first = readImageBlock(children[index], flowScope);
    if (!first) {
      // A list, table or callout block keeps its images: they belong to a
      // nested scope (a callout's are claimed but never decorated). Mark it so
      // the staleness check does not treat the undecorated block as a render
      // that still has to happen.
      if (children[index].querySelector?.("img") && children[index].querySelector(SCOPE_SELECTOR)) {
        children[index].dataset.agSkip = "true";
      }
      index += 1;
      continue;
    }
    if (first.some(({ annotation }) => annotation.params.exclude)) {
      // Mark the block as deliberately undecorated. Without the marker the
      // "is this section still decorated?" check would treat an opted-out
      // image as a stale block and re-render the section forever.
      children[index].dataset.agSkip = "true";
      source.skip(first);
      index += 1;
      continue;
    }
    const blocks = [children[index]];
    const entries = [...first];
    source.assign(entries);
    const firstHasText = first.some((entry) => entry.hasText);
    const firstIsolate = first.some(({ annotation }) => annotation.params.isolate);
    index += 1;
    while (!firstHasText && !firstIsolate && index < children.length) {
      const current = readImageBlock(children[index], flowScope);
      if (current) {
        if (current.some(({ annotation }) => annotation.params.exclude || annotation.params.isolate)) break;
        if (!canJoinGallery(source.peek(current[0].image))) break;
        blocks.push(children[index]);
        source.assign(current);
        entries.push(...current);
        index += 1;
        // A paragraph can contain an image followed by prose. Keep its image
        // in the current gallery, then stop scanning so later blocks cannot
        // be pulled into the mixed-content paragraph's layout context.
        if (current.some((entry) => entry.hasText)) break;
        continue;
      }
      if (!isBlank(children[index])) break;
      let next = index;
      while (next < children.length && isBlank(children[next])) next += 1;
      const following = next < children.length ? readImageBlock(children[next], flowScope) : null;
      if (!following) break;
      if (following.some(({ annotation }) => annotation.params.exclude || annotation.params.isolate)) break;
      if (!canJoinGallery(source.peek(following[0].image))) break;
      blocks.push(...children.slice(index, next + 1));
      source.assign(following);
      entries.push(...following);
      index = next + 1;
    }
    // Assign indices before filtering unloaded images. The index belongs to
    // document content, not to whichever lazy-loaded nodes happen to be
    // present in this render pass.
    const identityOccurrences = new Map();
    for (const entry of entries) {
      // Include the occurrence number so two references to the same image do
      // not collapse onto one persistent index. Live Preview counts source
      // lines, where those references are distinct positions.
      const identity = imageIdentity(entry.image);
      const occurrence = identityOccurrences.get(identity) ?? 0;
      identityOccurrences.set(identity, occurrence + 1);
      const key = `${identity}#${occurrence}`;
      entry.floatIndex = sourceFloatIndex(floatState, entry.image, sourceText)
        ?? stableFloatIndex(floatState, entry.image, key);
    }
    const usable = entries.filter((entry) => {
      const measured = measureImage(entry.image, options.sourcePath);
      if (!measured) {
        // No ratio yet. Mark the picture so the staleness check does not
        // schedule another pass on every mutation while it is still loading.
        entry.image.dataset.agPending = "true";
        return false;
      }
      delete entry.image.dataset.agPending;
      entry.measured = measured;
      return true;
    });
    if (!usable.length) continue;
    const params = usable.map((entry) => ({ ...entry, params: { ...entry.annotation.params } }));
    // A run of two or more images is a gallery, whatever layout annotations the
    // individual lines carry. Live Preview groups structurally and lays every
    // member out as a cell, so consulting `resolveRunMode` here made the same
    // note render as a row in the editor and as separate floats in the preview.
    //
    // The run is completed from the source before the mode is decided: the
    // reading view detaches blocks outside its window, and packing only the
    // ones that happen to be attached gave a row a different cell count (and
    // therefore different widths) depending on the scroll position.
    const slots = completeGalleryMembers(params, groupsByRecord, options.sourcePath);
    const mode = slots.length > 1 ? "gallery" : resolveRunMode(params, options.profile);
    if (mode === "gallery" && slots.length > 1 && width > 0) {
      decorateGallery(slots, width, options, cleanups);
      hideGallerySeparators(blocks, cleanups);
    }
    else decorateIndividual(params, blocks, width, options, cleanups);
  }
  // Floats are decorated before the blocks below them, so the boundary's own
  // `clear` could not know whether that boundary would become a float itself.
  // Finish the job once every layout has been decided.
  enforceFloatEnds(flowRoot, cleanups, options);
}

/**
 * A float that stops at a boundary which is itself floated does not end the
 * float for the blocks after it: `clear` on a float only pushes that float
 * below its predecessor, while later blocks still start at the pre-float flow
 * position and may overlap it. Clear the first following in-flow block too.
 * Gallery cells are skipped so a packed row is never split into two lines.
 *
 * `floatSpaceMode` decides whether that extra clearance happens at all, and it
 * decides nothing else. With `ordered` the prose after a picture is pinned
 * below the pictures that came before it, so a later paragraph can never move
 * up into the half-column an earlier picture left free. With `share` the
 * reader asked for the opposite: prose fills whatever space is free, so no
 * clearance is written on it.
 *
 * The space between two *pictures* is not this pass's business. Whether two
 * independent pictures stack or may share a band is controlled by the
 * "picture" float stop (`floatBreaks.image`) and is applied where the float is
 * decorated, so the policy can never put a left and a right picture side by
 * side and squeeze the text between them down to a strip.
 */
function enforceFloatEnds(root, cleanups, options = {}) {
  const view = root.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return;
  const ordered = options.floatSpaceMode !== "share";
  const sideOf = (el) => view.getComputedStyle(el).getPropertyValue("float").trim();
  // A paragraph that holds an inline picture floats the embed, not the block,
  // so the block reports `float: none` while the picture still owns a column.
  // The PDF tree adds another level (`<div class="ag-pdf-block"> <p>
  // <span class="image-embed">`), which made every mixed paragraph invisible
  // to this pass — the float was in the document but never in `opened`.
  const floatSideOf = (element) => {
    const own = sideOf(element);
    if (own === "left" || own === "right") return own;
    for (const node of element.querySelectorAll?.('[data-ag-layout="float"]') ?? []) {
      const side = sideOf(node);
      if (side === "left" || side === "right") return side;
    }
    return "none";
  };
  // Sides of the floats already opened above the current block. Those are the
  // ones the following prose has to step past; the boundary float itself must
  // keep wrapping that prose, which is the whole point of floating it.
  const opened = new Set();
  const isHeading = (el) => /(?:^|\s)el-h[1-6](?:\s|$)/.test(String(el.className)) || /^H[1-6]$/.test(el.tagName);
  for (const boundary of [...root.children]) {
    const float = floatSideOf(boundary);
    const endsFloat = boundary.dataset?.agFloatEnd === "true";
    // A block that ends a float is cleared below everything above it, whatever
    // kind of block it is — heading, table, quote, code, math. From there on
    // those floats cannot reach the prose, so a later paragraph must not clear
    // their sides: carrying them made text drop under a picture sections earlier.
    // A boundary that is itself a float is the opposite case: it is below the
    // earlier floats but the prose still has to step past them to wrap beside it.
    if (endsFloat && float === "none") opened.clear();
    // A heading is a section break even when nothing floated above it, so the
    // set never survives one.
    if (isHeading(boundary)) opened.clear();
    if (ordered && endsFloat && float !== "none") {
      let next = boundary.nextElementSibling;
      while (next) {
        if (floatSideOf(next) !== "none") {
          next = next.nextElementSibling;
          continue;
        }
        if (next.dataset?.agLayout === "gallery") {
          next = next.nextElementSibling;
          continue;
        }
        break;
      }
      // The prose after a float has to step past the floats that are still open
      // above this boundary, otherwise its border box starts above them and the
      // text is laid into whatever gap is left over — beside the wrong picture.
      // Clearing only those sides (never the boundary's own) keeps the wrap
      // beside this float while pinning the paragraph below the earlier ones.
      if (next && opened.size) {
        const clear = opened.size > 1 ? "both" : [...opened][0];
        const original = next.getAttribute("style");
        setStyle(next, "clear", clear);
        cleanups.push(() => restoreStyle(next, original));
      }
    }
    if (ordered && float !== "none" && opened.size && sideOf(boundary) === "none") {
      // The picture floats from inside this block (a paragraph that mixes an
      // image and prose), so clearing the picture itself does not move the
      // text: the block has to step past the earlier floats, otherwise its
      // first line is laid beside the wrong picture.
      const clear = opened.size > 1 ? "both" : [...opened][0];
      const original = boundary.getAttribute("style");
      setStyle(boundary, "clear", clear);
      cleanups.push(() => restoreStyle(boundary, original));
    }
    if (float !== "none") opened.add(float);
  }
}

/**
 * Decorate the images of every nested container. Each scope owns exactly the
 * pictures whose nearest scope it is, so the order of this walk only decides
 * which container is measured first, never which one wins an image.
 */
function renderNestedScopes(root, options, cleanups, { floatState }) {
  const scopes = [...root.querySelectorAll(SCOPE_SELECTOR)];
  for (const scope of scopes) {
    if (!scope.isConnected || !scope.querySelector("img")) continue;
    // A callout is opaque to the plugin: its body is not an editable block in
    // Live Preview, so styling it in the reading view would produce a layout
    // the reader can neither reproduce nor adjust while writing. The scope is
    // still matched so the pictures are claimed and never fall through to the
    // section pass.
    if (scope.closest(".callout")) continue;
    if (scope.matches("td, th")) {
      decorateTableCell(scope, cleanups);
      continue;
    }
    // A list item is the only remaining scope kind that lays pictures out.
    const width = contentWidth(scope);
    if (!(width > 0)) continue;
    renderListScope(scope, width, options, cleanups, { floatState });
  }
}

/**
 * List items never share a row with a neighbour: the bullet column makes that
 * ambiguous, and a row that ignores the marker overlap is not something the
 * reader can reason about. Inside one item, images that share a paragraph (the
 * source used a line break, not a blank line) do become a gallery.
 */
function renderListScope(item, width, options, cleanups, { floatState }) {
  const images = [...item.querySelectorAll("img")].filter((image) => isRenderableImage(image) && imageScope(image) === item);
  if (!images.length) return;
  const groups = new Map();
  for (const image of images) {
    const embed = image.closest(".image-embed, .internal-embed");
    const annotation = readImageAnnotation(image);
    if (annotation.params.exclude) continue;
    const box = embed?.parentElement ?? item;
    // `params` is the decoration contract (see `renderFlow`); `annotation`
    // keeps the caption for `ensureCaption`.
    const entry = {
      image,
      block: box,
      order: 0,
      annotation,
      params: { ...annotation.params },
      hasText: false,
      measured: measureImage(image, options.sourcePath)
    };
    if (!entry.measured) continue;
    if (!groups.has(box)) groups.set(box, []);
    groups.get(box).push(entry);
  }
  for (const entries of groups.values()) {
    // A list item's pictures are laid out against the item's own content box:
    // the marker lives outside it, so this is already "column minus indent".
    for (const entry of entries) {
      entry.floatIndex = stableFloatIndex(floatState, entry.image, imageIdentity(entry.image));
    }
    // `ag:isolate` is structural: the picture leaves the row and is laid out
    // on its own. Without it the row wins over every per-image layout
    // parameter, which is what makes a list row behave like any other gallery.
    let run = [];
    const decorateRun = () => {
      if (!run.length) return;
      if (run.length > 1) decorateGallery(run, width, { ...options, cellOnEmbed: true }, cleanups);
      else decorateIndividual(run, [run[0].block], width, { ...options, forceImageEmbed: true, alignAsBlock: true }, cleanups);
      run = [];
    };
    for (const entry of entries) {
      if (entry.annotation?.params?.isolate) {
        decorateRun();
        decorateIndividual([entry], [entry.block], width, { ...options, forceImageEmbed: true, alignAsBlock: true }, cleanups);
        continue;
      }
      run.push(entry);
    }
    decorateRun();
  }
}

/**
 * A table cell never gets a width or an alignment from the plugin: the cell
 * already decides how much room a picture has, and overriding it fought both
 * Obsidian's own sizing and the hover controls inside narrow cells. Only the
 * annotation that changes the picture itself - the crop - is applied.
 */
function decorateTableCell(cell, cleanups) {
  for (const image of cell.querySelectorAll("img")) {
    if (!isRenderableImage(image) || imageScope(image) !== cell) continue;
    const { params } = readImageAnnotation(image);
    if (params.exclude || !params.crop) continue;
    const crop = params.crop;
    // Keep the width Obsidian chose and only give the box a height, so the
    // crop never turns into a width takeover.
    const rect = image.getBoundingClientRect?.();
    const natural = naturalSize(image);
    const baseWidth = rect?.width > 0 ? rect.width : natural?.width ?? 0;
    if (!(baseWidth > 0)) continue;
    const original = snapshotAttribute(image, "style");
    const ratio = effectiveCropRatio(crop, natural) ?? crop.w / crop.h;
    setStyle(image, "height", `${baseWidth / ratio}px`);
    setStyle(image, "aspect-ratio", `${roundRatio(ratio)}`);
    const region = cropRegion(crop, natural);
    applyCropView(image, crop, natural, region, ratio);
    cleanups.push(() => restoreStyle(image, original));
  }
}

/** Natural (CSS pixel) size of a decoded image, or null while it loads. */
function naturalSize(image) {
  const width = Number(image?.naturalWidth);
  const height = Number(image?.naturalHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** `aspect-ratio` accepts a plain number; keep it short and locale neutral. */
function roundRatio(ratio) {
  const value = Number(ratio);
  return Number.isFinite(value) && value > 0 ? String(Math.round(value * 10000) / 10000) : "auto";
}

/**
 * Show exactly the requested source rectangle. `object-view-box` does this
 * natively and the frame ratio then equals the view box ratio, so no
 * `object-fit` toggle is needed at all. A build without it falls back to the
 * largest frame plus `object-position`, which is exact for legacy annotations
 * and an approximation for a free region.
 */
function applyCropView(image, crop, natural, region, ratio = null) {
  if (!region) {
    // A removed crop must not leave the previous view box or fit behind on a
    // reused preview element.
    image.style.removeProperty("object-view-box");
    image.style.removeProperty("object-fit");
    image.style.removeProperty("object-position");
    return;
  }
  if (supportsViewBox()) {
    const value = viewBoxValue(region, natural);
    if (value) {
      setStyle(image, "object-view-box", value);
      image.style.removeProperty("object-fit");
      image.style.removeProperty("object-position");
      return;
    }
  }
  image.style.removeProperty("object-view-box");
  setStyle(image, "object-fit", "cover");
  const focus = fallbackFocus(region, natural, ratio);
  if (focus) setStyle(image, "object-position", `${focus.x}% ${focus.y}%`);
}

function contentWidth(element) {
  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(element);
  const padding = style
    ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    : 0;
  return Math.max(0, (element.clientWidth || 0) - padding);
}

function isRenderableImage(image) {
  return Boolean(image) && !image.classList.contains("cm-widgetBuffer") && image.getAttribute("aria-hidden") !== "true";
}

/** Nearest container that lays out the pictures inside it. */
function imageScope(image) {
  const embed = image?.closest?.(".image-embed, .internal-embed");
  return (embed ?? image)?.closest?.(SCOPE_SELECTOR) ?? null;
}

/**
 * Give every image a block of its own. Markdown keeps consecutive image lines —
 * and any prose written between them — inside one paragraph, but a gallery
 * cell, a float and an isolated image are all laid out per block: the paragraph
 * is the layout unit. A picture that shares its paragraph with prose therefore
 * loses every one of its parameters — `ag:width` lands on the embed, which the
 * mixed paragraph then stretches to the full column, and a run of images can
 * never become a gallery — which is why a note written without blank lines
 * around its images dropped the whole takeover.
 *
 * Splitting into one block per image and one per run of prose reproduces
 * exactly the layout the same note produces when the author writes the blank
 * lines, which is the behaviour both views already agree on.
 */
function splitImageBlocks(root, cleanups, flowScope = null) {
  for (const block of [...root.children]) {
    // `parentElement` rather than `isConnected`: the PDF print tree is built
    // before it is attached to the document, and it needs the same split.
    if (!block.parentElement || block.dataset.agGenerated === "true") continue;
    const entries = readImageBlock(block, flowScope);
    if (!entries?.length) continue;
    // A paragraph whose every reference opted out keeps its shape: `ag:exclude`
    // means "leave this alone", and that includes the text around it. When
    // only some references opted out the split still runs, so the remaining
    // pictures can be routed and the excluded one simply keeps its block.
    if (entries.every(({ annotation }) => annotation.params.exclude)) continue;
    const embeds = entries.map(({ image }) => image.closest(".image-embed, .internal-embed"));
    const container = embeds[0]?.parentElement;
    if (!container || !ownsBlock(block, container)) continue;
    // Only embeds that are direct children of the same paragraph can be cut
    // apart; an embed nested inside another structure keeps its wrapper.
    if (embeds.some((embed) => !embed || embed.parentElement !== container)) continue;
    // One image that already owns its block needs no split.
    if (entries.length === 1 && !entries[0].hasText) continue;
    splitParagraph(block, container, new Set(embeds), cleanups);
  }
}

/**
 * True when `container` is the paragraph that *is* this block: either the block
 * itself, or the single child of the wrapper Obsidian builds around it
 * (`.el-p > p`). A callout or a list owns several paragraphs; cloning its
 * wrapper per image would fabricate a structure the note never had.
 */
function ownsBlock(block, container) {
  if (container === block) return true;
  return block.children.length === 1 && block.children[0] === container;
}

/**
 * Rebuild a paragraph as an alternating sequence of image blocks and prose
 * blocks. The first chunk stays in the original node so its identity — and the
 * section's child index — survives; every later chunk gets a clone of the same
 * wrapper shape, which is what Obsidian itself produces for a blank-line
 * separated note.
 */
function splitParagraph(block, container, embedSet, cleanups) {
  const ordered = [...container.childNodes];
  const chunks = [];
  for (const node of ordered) {
    if (embedSet.has(node)) {
      chunks.push({ nodes: [node], image: node });
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last && !last.image) last.nodes.push(node);
    else chunks.push({ nodes: [node], image: null });
  }
  // Obsidian renders every soft line break inside the paragraph as a `<br>`.
  // Those breaks only separated the neighbours this split now separates with
  // blocks of their own; left at a chunk edge one of them paints an empty
  // first or last line, which reads as a stray blank line above the prose.
  for (const chunk of chunks) trimChunkEdges(chunk.nodes);
  // A blank run between two images is a line break, not a paragraph, so its
  // chunk carries nothing once its edges are trimmed; dropping it keeps the
  // split from adding an empty block — and the spacing that comes with it.
  const kept = chunks.filter((chunk) => chunk.image || !isBlankChunk(chunk.nodes));
  if (kept.length < 2) return;

  while (container.firstChild) container.removeChild(container.firstChild);
  for (const node of kept[0].nodes) container.appendChild(node);
  const created = [];
  let host = block;
  for (const chunk of kept.slice(1)) {
    const next = block.cloneNode(false);
    for (const name of ["style", "data-ag-layout", "data-ag-group", "data-ag-mixed", "data-ag-generated"]) next.removeAttribute(name);
    // The split host is real content for pagination but not an image block of
    // its own until it is decorated; the marker keeps the staleness check from
    // scheduling another pass if the image never loads.
    next.dataset.agSkip = "true";
    // The reading view's virtual renderer only keeps blocks it knows about.
    // This marker is what lets plugin.js register the block instead of letting
    // it be detached as unknown content while scrolling.
    next.dataset.agSplit = "true";
    const target = container === block ? next : container.cloneNode(false);
    if (target !== next) {
      target.removeAttribute("style");
      next.appendChild(target);
    }
    for (const node of chunk.nodes) target.appendChild(node);
    host.after(next);
    host = next;
    created.push(next);
  }
  cleanups.push(() => {
    for (const node of ordered) container.appendChild(node);
    for (const host of created) host.remove();
  });
}

function isBlankChunk(nodes) {
  return nodes.every((node) => node.nodeType === Node.TEXT_NODE
    ? !node.nodeValue.trim()
    : node.nodeName === "BR" || !(node.textContent ?? "").trim());
}

/** Whitespace and line breaks that only exist to divide two inline runs. */
function isChunkFiller(node) {
  if (node.nodeName === "BR") return true;
  return node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim();
}

function trimChunkEdges(nodes) {
  while (nodes.length && isChunkFiller(nodes[0])) nodes.shift();
  while (nodes.length && isChunkFiller(nodes[nodes.length - 1])) nodes.pop();
}

/**
 * Walk the note's image lines in document order and hand each rendered image
 * the source record that produced it. The record carries the blank-line count
 * that separates it from the previous image, which the reading DOM cannot
 * express.
 */
function createSourceCursor(records) {
  if (!records?.length) {
    return { records: [], assign() {}, peek: () => null, skip() {} };
  }
  let index = 0;
  const find = (image) => {
    const identity = imageIdentityFromDOM(image);
    for (let scan = index; scan < records.length; scan += 1) {
      if (records[scan].identity === identity) return scan;
    }
    // An image that is not a standalone source line (an inline reference, or
    // one inside a callout) must not consume a record that belongs to the
    // next real image line.
    return -1;
  };
  const advance = (entries) => {
    for (const entry of entries) {
      const found = find(entry.image);
      if (found < 0) continue;
      index = found + 1;
      // Attach the record itself, not just its blank-line verdict: the gallery
      // packer needs the full source run to lay out cells that are currently
      // virtualised out, and the index is how it locates that run.
      entry.record = records[found];
      entry.recordIndex = found;
    }
  };
  return {
    records,
    assign: advance,
    skip: advance,
    peek(image) {
      const found = find(image);
      return found < 0 ? null : records[found];
    }
  };
}

/**
 * Map every source record to the gallery run it belongs to. A block that is
 * detached can still be placed in its run this way, which is what keeps the
 * row packing identical whether one cell or all of them are attached.
 */
function groupSourceRecords(records) {
  const byRecord = new Map();
  if (!records?.length) return byRecord;
  for (const group of groupImageRecords(records)) {
    for (const record of group) byRecord.set(record.index, group);
  }
  return byRecord;
}

/**
 * A gallery may be separated by at most two blank lines. Without source text
 * the structural rule (adjacent image blocks) is the only signal available.
 */
function canJoinGallery(record) {
  if (!record) return true;
  return record.blankBefore <= MAX_GALLERY_BLANK_LINES && record.blockedBefore !== true;
}

/**
 * Extend a gallery with the members the reading view has virtualised out, so
 * row packing always sees the whole source run.
 *
 * Obsidian keeps only the blocks near the viewport attached. Packing the
 * attached subset made a six-image run render as two cells per row while one
 * row was on screen and three per row once the whole run was visible, which
 * changed every cell's width and moved the document under the reader.
 *
 * The source run is authoritative, but a cell that has never been measured has
 * no ratio, and `calculateGalleryRows` rejects a list containing one. In that
 * case the function fails closed and returns the attached subset: the current
 * layout is preserved rather than guessed, and the run is completed on a later
 * pass once the picture has been seen.
 */
function completeGalleryMembers(entries, groupsByRecord, sourcePath) {
  if (!entries.length || !groupsByRecord?.size) return entries;
  const first = entries[0].recordIndex;
  const last = entries[entries.length - 1].recordIndex;
  // A picture that is not a standalone source line (inline markup, a blockquote)
  // has no record; mixing measured and unrecorded members would misplace cells.
  if (!Number.isInteger(first) || !Number.isInteger(last)) return entries;
  const group = groupsByRecord.get(first);
  if (!group || groupsByRecord.get(last) !== group) return entries;
  const present = new Set(entries.map((entry) => entry.recordIndex));
  const missing = group.filter((record) => !present.has(record.index));
  if (!missing.length) return entries;
  const synthetic = [];
  for (const record of missing) {
    // The same file may be referenced more than once, so the size is looked up
    // by link target rather than by source position.
    const measured = record.target ? linkMetric(linkMetricKey(sourcePath, record.target)) : null;
    if (!measured) return entries;
    synthetic.push({
      image: null,
      block: null,
      order: 0,
      hasText: false,
      detached: true,
      annotation: { caption: "", params: record.params },
      params: { ...record.params },
      measured: { width: measured.width, height: measured.height },
      record,
      recordIndex: record.index
    });
  }
  return [...entries, ...synthetic].sort((a, b) => a.recordIndex - b.recordIndex);
}

function cleanupStaleGenerated(root) {
  for (const element of root.querySelectorAll?.("[data-ag-skip]") ?? []) element.removeAttribute("data-ag-skip");
  for (const element of root.querySelectorAll?.("[data-ag-layout], [data-ag-row]") ?? []) {
    const snapshot = blockSnapshots.get(element);
    if (snapshot?.has("style")) restoreStyle(element, snapshot.get("style"));
    if (snapshot?.has("data-ag-layout")) restoreAttribute(element, "data-ag-layout", snapshot.get("data-ag-layout"));
    else element.removeAttribute("data-ag-layout");
    if (snapshot?.has("data-ag-group")) restoreAttribute(element, "data-ag-group", snapshot.get("data-ag-group"));
    else element.removeAttribute("data-ag-group");
    if (snapshot?.has("data-ag-row")) restoreAttribute(element, "data-ag-row", snapshot.get("data-ag-row"));
    else element.removeAttribute("data-ag-row");
    blockSnapshots.delete(element);
  }
  for (const caption of root.querySelectorAll?.(".ag-caption[data-ag-owned='true']") ?? []) caption.remove();
}

function getFloatIndexState(root) {
  let state = floatIndexStates.get(root);
  if (!state) {
    state = { next: 0, byElement: new WeakMap(), byKey: new Map(), sourceQueues: null, sourceUsed: new Map() };
    floatIndexStates.set(root, state);
  }
  return state;
}

function stableFloatIndex(state, image, key) {
  const existingElement = state.byElement.get(image);
  if (existingElement !== undefined) return existingElement;
  const existingKey = state.byKey.get(key);
  const index = existingKey === undefined ? state.next++ : existingKey;
  state.byElement.set(image, index);
  state.byKey.set(key, index);
  return index;
}

function sourceFloatIndex(state, image, sourceText) {
  if (!sourceText) return null;
  if (!state.sourceQueues) state.sourceQueues = buildFloatImageOrder(sourceText);
  const queue = state.sourceQueues.get(imageIdentityFromDOM(image));
  if (!queue?.length) return null;
  const used = state.sourceUsed.get(imageIdentityFromDOM(image)) ?? 0;
  state.sourceUsed.set(imageIdentityFromDOM(image), used + 1);
  return queue[Math.min(used, queue.length - 1)];
}

function imageIdentity(image) {
  return [image?.getAttribute?.("src") ?? "", image?.getAttribute?.("alt") ?? "", image?.getAttribute?.("data-src") ?? ""].join("|");
}

/**
 * Natural size of an image, falling back to the size measured earlier in this
 * note. Obsidian re-creates preview blocks while scrolling; a block whose
 * bitmap has not decoded yet would otherwise be laid out at its natural
 * (full-width) height and only collapse once the load event fires, which moves
 * the whole document by hundreds of pixels. The cached ratio lets the block be
 * laid out once, at its final size.
 */
export function measureImage(image, sourcePath = "") {
  if (!image) return null;
  // Key on the attribute, not `currentSrc`: a freshly created <img> reports an
  // empty `currentSrc` until its resource is selected, and mixing both forms
  // would look up a different cache entry than the one that was stored.
  const key = imageMetricKey(sourcePath, image.getAttribute?.("src") || image.currentSrc || "");
  const target = readEmbedTarget(image);
  const linkKey = target ? linkMetricKey(sourcePath, target) : "";
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    rememberImageMetric(key, size.width, size.height);
    // Store the same size against the link target. A gallery cell that the
    // virtualiser has detached later can still be given its true ratio, so the
    // row it belongs to keeps the width it had when the whole row was visible.
    if (linkKey) rememberLinkMetric(linkKey, size.width, size.height);
    return size;
  }
  return imageMetric(key) ?? (linkKey ? linkMetric(linkKey) : null);
}

function readImageBlock(block, flowScope = null) {
  if (!block || block.dataset.agGenerated === "true") return null;
  // Only the pictures this block lays out itself. A callout, a list or a table
  // inside the block hands its images to a nested scope; accepting them here
  // was what sized a whole callout as if it were a single gallery cell. A
  // callout scope is claimed but never rendered, so its pictures stop here.
  const images = [...block.querySelectorAll("img")].filter((image) => isRenderableImage(image) && imageScope(image) === flowScope);
  if (!images.length) return null;
  const clone = block.cloneNode(true);
  // Remove the complete embed wrapper when checking for surrounding prose.
  // Obsidian exposes the image alt/caption as text inside `.image-embed`; if
  // only `<img>` is removed, a captioned image is incorrectly treated as a
  // mixed text block and cannot join the gallery.
  clone.querySelectorAll(".image-embed, .internal-embed, img, .ag-caption").forEach((node) => node.remove());
  clone.querySelectorAll("br").forEach((node) => node.remove());
  const annotations = images.map(readImageAnnotation);
  const hasText = Boolean(clone.textContent.trim());
  return images.map((image, order) => ({ image, block, order, annotation: annotations[order], hasText }));
}

function decorateGallery(entries, width, options, cleanups) {
  const control = options.galleryControl ?? "both";
  // A list item lays its gallery out inside its own content box, so the cell
  // must be the embed and never the item: making the `li` an inline-block cell
  // would drag the bullet into the row.
  const cellOnEmbed = options.cellOnEmbed === true;
  // A slot marked `detached` stands for a cell the reading view has virtualised
  // out. It still owns a position in the row — that is what keeps the attached
  // cells at the width they had when the whole row was visible — but it owns no
  // DOM, so every style and spacing decision below skips it.
  const present = entries.filter((entry) => !entry.detached);
  if (!present.length) return;
  // A cropped image occupies its crop ratio, not its natural one. Feed the
  // requested ratio into row packing so the row height and cell count match
  // what will actually be drawn.
  const ratioInputs = entries.map((entry) => {
    const params = entry.params ?? entry.annotation?.params ?? {};
    const crop = params.crop;
    if (crop) {
      const ratio = effectiveCropRatio(crop, entry.measured) ?? crop.w / crop.h;
      return { naturalWidth: ratio * 1000, naturalHeight: 1000, group: Number(params.group) > 0 ? Number(params.group) : 0 };
    }
    const size = entry.measured
      ? { naturalWidth: entry.measured.width, naturalHeight: entry.measured.height }
      : entry.image;
    return { ...size, group: Number(params.group) > 0 ? Number(params.group) : 0 };
  });
  const rows = calculateGalleryRows(ratioInputs, width, {
    maxPerRow: control === "height" ? 15 : options.galleryMaxPerRow ?? options.maxImagesPerRow,
    minHeight: control === "count" ? 0 : options.galleryMinHeight,
    gap: options.galleryGap,
    // Same ceiling as Live Preview. A row of pictures that would be taller than
    // the column is scaled down and centred instead of being cropped, and the
    // three renderers have to agree on where that happens.
    maxHeight: Number(options.galleryMaxHeight ?? 0),
    // A hand-written row split applies here exactly as it does in Live
    // Preview: both views must honour it, or the same note would break its
    // rows differently depending on which one is open.
    rows: entries[0]?.params?.rows ?? entries[0]?.annotation?.params?.rows
  });
  if (!rows.length) return;
  const blockCounts = new Map();
  for (const entry of present) blockCounts.set(entry.block, (blockCounts.get(entry.block) ?? 0) + 1);
  const gap = Math.max(0, Number(options.galleryGap ?? 12));
  const cleared = collapseGalleryWhitespace(present, cleanups);
  let cursor = 0;
  let rowIndex = 0;
  let previousPresent = null;
  for (const row of rows) {
    // The first row keeps the document's own rhythm: the preceding block
    // already contributes its bottom margin. Later rows own an explicit gap so
    // the vertical distance between rows equals the horizontal cell gap.
    const rowGap = rowIndex === 0 ? 0 : gap;
    const rowStart = cursor;
    let lastPresent = -1;
    for (let position = 0; position < row.items.length; position += 1) {
      if (!entries[rowStart + position]?.detached) lastPresent = position;
    }
    // The stamp's gap is the space *after* this row (the next row's top
    // margin), so a cell's stamped height matches Obsidian's own definition
    // of block height: the distance to the next sibling's top edge.
    const trailingGap = rowIndex + 1 < rows.length ? gap : 0;
    let presentBefore = false;
    for (let position = 0; position < row.items.length; position += 1) {
      const entry = entries[cursor];
      const item = row.items[position];
      cursor += 1;
      if (!entry || entry.detached || !entry.block) continue;
      const isLastPresent = position === lastPresent;
      if (row.items.length === 1) {
        // A lone cell is still a gallery cell: it spans the column, exactly the
        // way Live Preview draws it. Auto-routing its width here was what made
        // the two views disagree on every single-image row.
        const loneParams = entry.params ?? {};
        const loneMeasured = entry.measured
          ? { naturalWidth: entry.measured.width, naturalHeight: entry.measured.height }
          : entry.image;
        const loneRatio = (loneParams.crop
          ? effectiveCropRatio(loneParams.crop, loneMeasured)
          : null) ?? readAspectRatio(loneMeasured);
        const fullHeight = loneRatio > 0 ? width / loneRatio : 0;
        const orphanLimit = Math.max(0, Number(options.galleryOrphanMaxHeight ?? config.gallery?.orphanMaxHeight ?? 400));
        if (orphanLimit > 0 && fullHeight > orphanLimit) {
          // Only an orphan that would fill more than a screenful drops out of
          // the grid, and it keeps the auto-routed width on the centred axis.
          decorateIndividual([entry], [entry.block], width, { ...options, forceCenter: true }, cleanups);
        } else {
          decorateEntry(entry, {
            display: cellOnEmbed ? "inline-block" : "block", float: "none", clear: "both", boxSizing: "border-box",
            width: "100%", maxWidth: "100%", marginBlockEnd: "0px"
          }, options, cleanups, "gallery", `${fullHeight}px`, false, cellOnEmbed);
        }
        // A single-image row still belongs to the gallery grid: it takes the
        // same row gap as every other row so the stack stays even.
        applyGalleryRowSpacing(entry.block, rowGap, cleanups);
        stampGalleryRow(entry.block, { row: rowIndex, height: fullHeight, gap: trailingGap, last: true }, cleanups);
        previousPresent = entry;
        presentBefore = true;
        continue;
      }
      // Preview blocks are separate inline-block siblings. Obsidian can leave
      // a whitespace text node between them, which consumes about one space
      // width and can wrap an otherwise exact row. That node is removed above;
      // only a pair that does not share a parent can keep the space, and then
      // the historical 4px allowance still applies. The first cell of a row
      // has no predecessor to leave space behind, so it always spends the full
      // configured gap.
      const sharedBlock = (blockCounts.get(entry.block) ?? 0) > 1;
      const sameParent = Boolean(previousPresent?.block && previousPresent.block.parentElement === entry.block.parentElement);
      const domWhitespace = !presentBefore || cleared.has(entry) || sharedBlock || sameParent ? 0 : 4;
      const inlineGap = Math.max(0, gap - domWhitespace);
      // Keep a 1px slack on the last cell so sub-pixel rounding of the
      // fractional cell widths cannot overflow the row.
      const widthAdjustment = isLastPresent && row.items.length > 1 ? 1 : 0;
      const cellWidth = Math.max(1, item.width - widthAdjustment);
      const firstPresent = !presentBefore;
      const cellStyles = {
        display: "inline-block", float: "none", clear: "none", verticalAlign: "top", boxSizing: "border-box",
        width: `${cellWidth}px`, maxWidth: `${cellWidth}px`,
        // A capped row is narrower than the column. The left margin is the
        // centre offset, and the last cell takes the matching margin back so
        // the line's inline advance still fills the column - without it the
        // next row's first cell would wrap into this one.
        marginInlineStart: firstPresent && row.offset > 0 ? `${row.offset}px` : "0px",
        marginInlineEnd: isLastPresent
          ? (row.offset > 0 ? `${row.offset + widthAdjustment}px` : "0")
          : `${inlineGap}px`,
        // The horizontal and vertical gaps of a gallery are the same value, so
        // a row reads as one grid. The block owns that gap; the native
        // paragraph margin inside the cell is cleared below.
        marginBlockStart: `${rowGap}px`,
        marginBlockEnd: "0px"
      };
      // A list item's gallery keeps its prose inline: the text is part of the
      // item, not a paragraph that can be moved out of it.
      const imageStyles = entry.hasText && !cellOnEmbed
        ? { display: "block", float: "none", clear: "none", width: "100%", maxWidth: "100%", marginBlockEnd: "0px" }
        : cellStyles;
      // When several embeds share one paragraph, the paragraph must remain a
      // full-width container and each embed must own its gallery cell. For
      // separate Obsidian blocks, the outer block remains the cell so the
      // images can sit beside one another in the document flow.
      const useImageEmbedCell = cellOnEmbed || (blockCounts.get(entry.block) ?? 0) > 1;
      decorateEntry(entry, imageStyles, options, cleanups, "gallery", `${row.height}px`, false, useImageEmbedCell);
      if (entry.hasText && !cellOnEmbed) {
        const prose = separateTrailingGalleryProse(entry, cleanups);
        if (prose) setStyle(prose, "clear", "both");
        for (const [property, value] of Object.entries(cellStyles)) setStyle(entry.block, property, value);
      }
      applyGalleryRowSpacing(entry.block, rowGap, cleanups);
      stampGalleryRow(entry.block, { row: rowIndex, height: row.height, gap: trailingGap, last: isLastPresent }, cleanups);
      previousPresent = entry;
      presentBefore = true;
    }
    rowIndex += 1;
  }
  // Prose and headings bring their own top margin, but another image does not:
  // a following float zeroes its top margin, so without this the next image
  // would sit flush against the last row.
  const lastBlock = entries[entries.length - 1]?.block;
  if (lastBlock?.nextElementSibling?.querySelector?.("img")) {
    const original = snapshotAttribute(lastBlock, "style");
    setStyle(lastBlock, "margin-block-end", imageBottomGap(options));
    cleanups.push(() => restoreStyle(lastBlock, original));
  }
}

function collapseGalleryWhitespace(entries, cleanups) {
  const seen = new Set();
  const cleared = new Set();
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    const previousEmbed = previous.image.closest(".image-embed, .internal-embed");
    const currentEmbed = current.image.closest(".image-embed, .internal-embed");
    if (previousEmbed && currentEmbed && previousEmbed.parentElement === currentEmbed.parentElement) {
      if (clearBetween(previousEmbed, currentEmbed, cleanups, seen)) cleared.add(current);
      continue;
    }
    // Cells rendered as separate blocks keep their whitespace at the shared
    // parent level, not inside a paragraph.
    if (previous.block && current.block
      && previous.block !== current.block
      && previous.block.parentElement === current.block.parentElement
      && clearBetween(previous.block, current.block, cleanups, seen)) {
      cleared.add(current);
    }
  }
  return cleared;
}

function clearBetween(from, to, cleanups, seen) {
  let changed = false;
  let node = from.nextSibling;
  while (node && node !== to) {
    if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim() && !seen.has(node)) {
      const original = node.nodeValue;
      node.nodeValue = "";
      seen.add(node);
      changed = true;
      cleanups.push(() => { node.nodeValue = original; });
    }
    node = node.nextSibling;
  }
  return changed;
}

function separateTrailingGalleryProse(entry, cleanups, generated = true) {
  const embed = entry.image.closest(".image-embed, .internal-embed");
  const paragraph = embed?.closest("p");
  const parent = entry.block?.parentElement;
  if (!embed || !paragraph || !parent || !entry.block.contains(paragraph)) return null;

  const trailingNodes = [];
  for (let node = embed.nextSibling; node; node = node.nextSibling) trailingNodes.push(node);
  if (!trailingNodes.some((node) => node.textContent?.trim())) return null;

  const proseBlock = entry.block.cloneNode(false);
  // The clone inherits the image's inline width/float; prose owns none of it.
  proseBlock.removeAttribute("style");
  proseBlock.removeAttribute("data-ag-layout");
  proseBlock.removeAttribute("data-ag-group");
  proseBlock.removeAttribute("data-ag-mixed");
  // A split prose block is real content for pagination, so it must not carry
  // the generated marker that the PDF flow model skips.
  if (generated) {
    proseBlock.dataset.agGenerated = "true";
    // The reading view's virtual renderer must know every sibling the plugin
    // creates; an unknown one is detached while scrolling even though it holds
    // prose that belongs to the note.
    proseBlock.dataset.agSplit = "true";
  }
  const proseParagraph = paragraph.cloneNode(false);
  proseParagraph.removeAttribute("style");
  proseBlock.appendChild(proseParagraph);
  parent.insertBefore(proseBlock, entry.block.nextSibling);
  for (const node of trailingNodes) proseParagraph.appendChild(node);
  setStyle(proseBlock, "display", "block");
  setStyle(proseBlock, "width", "100%");
  setStyle(proseBlock, "max-width", "100%");

  cleanups.push(() => {
    const anchor = embed.nextSibling;
    for (const node of trailingNodes) paragraph.insertBefore(node, anchor);
    proseBlock.remove();
  });
  return proseBlock;
}

/**
 * Give one gallery cell its own vertical spacing. Obsidian wraps every block
 * in `.el-p` and puts a 1em margin on the inner paragraph; left in place that
 * margin sits inside the cell and adds a second, larger gap above the image,
 * which is what made a row look tighter than the gap between rows.
 */
/**
 * Record a cell's row assignment on the block. The reading view's geometry
 * sync reads these stamps: a virtualised block that used to hold a gallery
 * cell reports its stamped row height instead of whatever height the
 * virtualiser happens to have cached, and the last attached cell of a row
 * also carries the gap that follows the row, so a half-visible row keeps
 * its full footprint while scrolling.
 */
function stampGalleryRow(block, stamp, cleanups) {
  if (!block) return;
  const original = snapshotAttribute(block, "data-ag-row");
  block.setAttribute("data-ag-row", JSON.stringify(stamp));
  cleanups.push(() => restoreAttribute(block, "data-ag-row", original));
}

function applyGalleryRowSpacing(block, gap, cleanups) {
  if (!block) return;
  const targets = [block, ...block.querySelectorAll?.("p") ?? []];
  for (const target of new Set(targets)) {
    // `snapshotAttribute` keeps the value from before the first pass touched
    // the element, so repeated cells in one paragraph cannot snapshot the
    // plugin's own inline style as the "original".
    const original = snapshotAttribute(target, "style");
    setStyle(target, "margin-block-start", target === block ? `${gap}px` : "0px");
    setStyle(target, "margin-block-end", "0px");
    cleanups.push(() => restoreStyle(target, original));
  }
}

function decorateIndividual(entries, blocks, width, options, cleanups) {
  for (const entry of entries) {
    const params = entry.params ?? {};
    const explicitWidth = params.width && width ? width * params.width / 100 : null;
    const centerRequested = options.forceCenter === true
      || params.layout === "center" || params.side === "center";
    const autoFloat = !params.layout || params.layout === "auto";
    const measuredImage = entry.measured
      ? { naturalWidth: entry.measured.width, naturalHeight: entry.measured.height }
      : entry.image;
    const cropRatio = params.crop ? effectiveCropRatio(params.crop, measuredImage) : null;
    const ratio = cropRatio ?? readAspectRatio(measuredImage);
    // Routing must follow the ratio the reader actually sees. The natural
    // ratio sizes the column for an uncropped image; a crop box overrides it,
    // and a region that would overflow the picture widens the box instead of
    // being clipped.
    const routingImage = cropRatio
      ? { naturalWidth: cropRatio * 1000, naturalHeight: 1000 }
      : measuredImage;
    const profileRule = autoFloat && !explicitWidth ? resolveProfileRule(options.profile, ratio) : null;
    const ruleWidth = profileRule?.width != null && width > 0 ? width * profileRule.width : null;
    const ruleSide = profileRule?.side === "left" || profileRule?.side === "right" ? profileRule.side : null;
    const maxFloatRatio = Math.max(0, Math.min(1, Number(options.floatMax ?? config.widthRatio.floatMax * 100) / 100));
    const alignment = params.side ? null : profileRule?.floatAlignment;
    const side = params.side === "left" || params.side === "right"
      ? params.side
      : ruleSide ?? chooseFloatSide(options, entry, alignment);

    // Width and alignment are independent. Every image without an explicit or
    // profile width gets the piecewise automatic width, whether it ends up
    // floating or centered, so `ag:layout=center` never jumps to 100%.
    let routeWidth = explicitWidth ?? ruleWidth;
    if (!(routeWidth > 0) && width > 0) {
      routeWidth = calculateFloatLayout(routingImage, width, {
        center: options.widthControl?.medianRatio,
        qLeft: gainToExponent(options.widthControl?.gain, config.widthRatio.qLeft),
        qRight: gainToExponent(options.widthControl?.gain, config.widthRatio.qRight),
        maxWidthRatio: maxFloatRatio,
        side
      }).width;
    }

    // A manually requested float is honoured at whatever width the reader
    // chose. `floatMax` exists to keep *automatic* routing readable; applying
    // it to an explicit `ag:width` would silently undo a drag or an arrow
    // click on the next render, which is exactly the behaviour users report as
    // "my settings keep reverting".
    const explicitAlign = params.layout === "float"
      || params.side === "left" || params.side === "right";
    if (explicitAlign && !explicitWidth && width > 0 && routeWidth > width * maxFloatRatio) {
      // No stored width: an explicit float still cannot occupy the whole
      // column, so cap the computed width instead of degrading to centered.
      routeWidth = width * maxFloatRatio;
    }

    // Text may wrap only beside a left/right aligned image that is narrow
    // enough, unless the reader asked for that alignment explicitly. The
    // comparison is inclusive so an image exactly at `floatMax` still floats.
    // An explicit percentage is compared as declared: deriving it from the
    // measured column would let a sub-pixel change flip the layout between
    // passes, which reflows the document by the image's full height.
    const declaredRatio = Number.isFinite(params.width) ? params.width / 100 : null;
    const floatRatio = declaredRatio ?? (width > 0 ? routeWidth / width : 1);
    // A full-bleed image renders centred whatever its stored alignment says:
    // floating a picture that already fills the column would only change which
    // margin the text cannot use. The alignment parameter stays in the note and
    // applies again once the reader narrows the image.
    const fullBleed = width > 0 && routeWidth >= width - 0.5;
    // A picture inside a list item is a block on the item's own axis, not a
    // float: the item's box has to stay tall enough to hold it, and a float
    // would let the picture overflow into the next item. `ag:side` therefore
    // selects the block's side instead of a wrap side.
    const listDefault = options.alignAsBlock === true;
    // The breakpoint exists to stop a phone-width column from wrapping prose
    // into a two-character strip. On paper the column is a deliberate choice,
    // and the 600px gate switched floating off entirely for A5, wide margins
    // and any scale above ~117% — the export then looked nothing like the note.
    // The print path asks the only question that matters: is there room left
    // beside the picture for a readable line?
    const floatGap = Number(params.gap ?? options.textGap ?? 16) || 0;
    const columnAllowsFloat = options.printLayout === true
      ? width - routeWidth - floatGap >= PRINT_MIN_WRAP_COLUMN
      : width > (options.mobileBreakpoint ?? 600);
    const canFloat = !listDefault
      && !centerRequested
      && !fullBleed
      && profileRule?.layout !== "fixed"
      && (params.layout === "float" || autoFloat || params.side === "left" || params.side === "right")
      && columnAllowsFloat
      && routeWidth > 0
      && (explicitAlign || floatRatio <= maxFloatRatio + 1e-6);
    if (canFloat) {
      const gap = `${params.gap ?? options.textGap ?? 16}px`;
      // Two independent questions, deliberately answered from different
      // settings:
      //
      // - Where the *pictures* go is the "picture" float stop's job. While it
      //   is on, a picture ends the picture above it, so every float clears and
      //   the sequence stacks in one column; turning it off is the only way to
      //   let two pictures share a band. `floatSpaceMode` must not be consulted
      //   here: a left and a right picture on one row leaves a text strip a few
      //   characters wide between them, which nobody asked for by choosing
      //   "share".
      // - Where the *prose* goes is the float-space policy's job, and that is
      //   handled in `enforceFloatEnds`.
      const stacksBelowPrevious = options.floatBreaks?.image !== false;
      // Use physical margins here. Obsidian preview can change writing-mode
      // and logical margins then put the breathing room on the wrong side.
      decorateEntry(entry, { clear: stacksBelowPrevious ? "both" : "none", display: "block", float: side, boxSizing: "border-box", width: `${routeWidth}px`, maxWidth: "100%", marginLeft: side === "right" ? gap : "0px", marginRight: side === "left" ? gap : "0px", marginBlockStart: "0px", marginBlockEnd: `${params.gap ?? options.textGap ?? 16}px`, padding: "0" }, options, cleanups, "float", undefined, !explicitWidth, options.forceImageEmbed === true);
      normalizeFloatAncestors(entry.block, entry.image, cleanups);
      // The boundary search is the same question as the clear above — which
      // blocks end this float — so it reads the same setting, never the policy.
      let boundary = entry.block?.nextElementSibling;
      while (boundary && !isFloatBoundary(boundary, options.floatBreaks)) boundary = boundary.nextElementSibling;
      if (boundary) {
        // Preview uses wrapper nodes such as .el-p/.el-h2. Clear both the
        // wrapper and its concrete boundary element so every Obsidian DOM
        // shape stops the float at the same point.
        const boundaryNodes = [boundary, ...boundary.querySelectorAll?.("h1,h2,h3,h4,h5,h6,pre,.el-pre,.math-block,mjx-container,img,.image-embed,.internal-embed,table,.el-table,blockquote,.callout,.el-blockquote") ?? []];
        for (const node of new Set(boundaryNodes)) {
          const original = node.getAttribute("style");
          setStyle(node, "clear", "both");
          cleanups.push(() => restoreStyle(node, original));
        }
        const originalMarker = boundary.getAttribute("data-ag-float-end");
        boundary.dataset.agFloatEnd = "true";
        cleanups.push(() => {
          if (originalMarker === null) delete boundary.dataset.agFloatEnd;
          else boundary.setAttribute("data-ag-float-end", originalMarker);
        });
      }
      continue;
    }
    if (listDefault) {
      // Left is the default a list item reads in; `ag:side` / `ag:layout`
      // still choose the axis, they just never wrap text.
      const align = centerRequested ? "center" : params.side === "right" ? "right" : "left";
      decorateEntry(entry, {
        display: "block", clear: "none", boxSizing: "border-box",
        width: routeWidth > 0 ? `${routeWidth}px` : `${params.width ?? 100}%`,
        maxWidth: "100%",
        marginInlineStart: align === "left" ? "0px" : "auto",
        marginInlineEnd: align === "right" ? "0px" : "auto",
        marginBlock: `0 ${imageBottomGap(options)}`
      }, options, cleanups, align, undefined, false, options.forceImageEmbed === true);
      continue;
    }
    decorateEntry(entry, {
      display: "block", clear: "both", boxSizing: "border-box",
      width: routeWidth > 0 ? `${routeWidth}px` : `${params.width ?? 100}%`,
      maxWidth: "100%", marginInline: "auto",
      marginBlock: `0 ${imageBottomGap(options)}`
    }, options, cleanups, "center", undefined, false, options.forceImageEmbed === true);
    // Keep the image and the prose that shares its paragraph in separate
    // blocks, otherwise Chromium cannot break between them and pushes the
    // whole paragraph to the next page.
    if (entry.hasText) separateTrailingGalleryProse(entry, cleanups, false);
  }
}

function gainToExponent(value, base) {
  const normalized = Math.max(0, Math.min(100, Number(value ?? 50))) / 100;
  const neutral = Math.max(1.0001, Number(base) || 1.5);
  if (normalized <= 0.5) return 0.1 + (neutral - 0.1) * normalized * 2;
  return neutral + (3.5 - neutral) * (normalized - 0.5) * 2;
}

/**
 * Space between an image block (caption included) and the next block. Zero
 * means "follow the theme": the plugin hides the blank line that used to
 * provide that space, so an image with no bottom gap of its own would sit
 * flush against the following content.
 */
function imageBottomGap(options) {
  const configured = Number(options.imageBottomGap ?? 0);
  return configured > 0 ? `${configured}px` : "var(--p-spacing, 16px)";
}

function chooseFloatSide(options, entry, alignment = null) {
  const mode = alignment ?? options.profile?.floatAlignment ?? "alternate";
  if (mode === "left" || mode === "right") return mode;
  const index = Number(entry.floatIndex ?? entry.order ?? 0);
  return index % 2 === 0 ? "left" : "right";
}

function decorateEntry(entry, styles, options, cleanups, layout, height, snapAutomaticWidth = false, forceImageEmbed = false) {
  const block = entry.block;
  const image = entry.image;
  const imageEmbed = image.closest(".image-embed, .internal-embed");
  // Keep requested widths on one layout level only. Applying the same
  // percentage to both nested levels would compound it (for example, 60% of
  // a 60% embed) in Obsidian's preview DOM.
  // Keep mixed image/text paragraphs intact: sizing the outer <p> would put
  // the paragraph text inside the image's narrow column. An image-only block
  // can use the outer block so its float participates in document flow;
  // mixed blocks must float only the image embed inside the paragraph.
  const layoutElement = imageEmbed && (entry.hasText || forceImageEmbed) ? imageEmbed : block;
  const originalBlockStyle = snapshotAttribute(block, "style");
  const originalImageStyle = snapshotAttribute(image, "style");
  const originalEmbedStyle = imageEmbed && snapshotAttribute(imageEmbed, "style");
  const originalLayout = snapshotAttribute(block, "data-ag-layout");
  const originalGroup = snapshotAttribute(block, "data-ag-group");
  const originalMixed = snapshotAttribute(block, "data-ag-mixed");
  const originalEmbedLayout = imageEmbed && snapshotAttribute(imageEmbed, "data-ag-layout");
  block.dataset.agLayout = layout;
  block.dataset.agGroup = "images";
  // A paragraph that holds an image and prose cannot be an unbreakable print
  // unit: the prose must be allowed to continue on the next page while the
  // image stays on the current one.
  if (entry.hasText) block.dataset.agMixed = "true";
  else block.removeAttribute("data-ag-mixed");
  if (imageEmbed && imageEmbed !== block) imageEmbed.dataset.agLayout = layout;
  if (layoutElement !== block) {
    setStyle(layoutElement, "display", "block");
    setStyle(layoutElement, "width", "100%");
    setStyle(layoutElement, "max-width", "100%");
    setStyle(layoutElement, "margin", "0");
  }
  if (layout === "gallery" || layout === "center" || layout === "left" || layout === "right") {
    // A reused preview wrapper may still carry float/clear from an earlier
    // single-image pass. Reset both layout levels so the new mode owns the
    // complete positioning state.
    setStyle(block, "float", "none");
    setStyle(block, "clear", "none");
    if (imageEmbed && imageEmbed !== block) {
      setStyle(imageEmbed, "float", "none");
      setStyle(imageEmbed, "clear", "none");
    }
  }
  const crop = entry.annotation?.params?.crop ?? null;
  // The view box is expressed in pixels of the *live* natural size, which is
  // the reference box the browser resolves it against; the cached measurement
  // is only a stand-in for a bitmap that has not decoded yet.
  const natural = naturalSize(image) ?? (entry.measured
    ? { width: entry.measured.width, height: entry.measured.height }
    : null);
  const aspect = crop ? effectiveCropRatio(crop, natural) : null;
  const region = aspect ? cropRegion(crop, natural) : null;
  setStyle(layoutElement, "min-width", "0");
  for (const [property, value] of Object.entries(styles)) setStyle(layoutElement, property, value);
  // A paragraph that holds an image and prose keeps the sizing on the embed, so
  // the flow block itself carries no margin and the paragraph runs straight into
  // whatever follows. Centred and floated pictures therefore lost the bottom
  // gap the same picture keeps when it owns its block — visible as the spacing
  // jumping when the reader switches alignment.
  if (entry.hasText && layoutElement !== block && (layout === "center" || layout === "float" || layout === "left" || layout === "right")) {
    setStyle(block, "margin-block-end", imageBottomGap(options));
  }
  setStyle(layoutElement, "overflow", "visible");
  setStyle(image, "display", "block");
  setStyle(image, "width", "100%");
  setStyle(image, "height", aspect ? "auto" : height ?? "auto");
  setStyle(image, "max-width", "100%");
  if (aspect) setStyle(image, "aspect-ratio", `${roundRatio(aspect)}`);
  // Reserve the final box for an image whose bitmap has not decoded yet, so a
  // re-created preview block does not occupy its natural height first.
  else if (entry.measured) setStyle(image, "aspect-ratio", `${entry.measured.width} / ${entry.measured.height}`);
  else image.style.removeProperty("aspect-ratio");
  // The crop is expressed as a source rectangle, so `object-fit` no longer
  // decides anything: the view box already has the frame's ratio. A build
  // without `object-view-box` keeps the legacy fit/position fallback.
  applyCropView(image, crop, natural, region, aspect);
  setStyle(image, "margin", "0 auto");
  if (imageEmbed && imageEmbed !== block && imageEmbed !== layoutElement) {
    setStyle(imageEmbed, "display", "block");
    setStyle(imageEmbed, "width", "100%");
    setStyle(imageEmbed, "max-width", "100%");
    setStyle(imageEmbed, "margin", "0");
  }
  const captionHost = imageEmbed ?? block;
  const caption = ensureCaption(captionHost, entry.annotation.caption, options);
  if (snapAutomaticWidth && layout === "float" && typeof styles.width === "string" && styles.width.endsWith("px")) {
    snapFloatToLineGrid(layoutElement, image, block);
  }
  if (imageEmbed) hideImageLineBreak(imageEmbed, cleanups);
  cleanups.push(() => {
    restoreStyle(block, originalBlockStyle);
    restoreStyle(image, originalImageStyle);
    if (imageEmbed && imageEmbed !== block) restoreStyle(imageEmbed, originalEmbedStyle);
    restoreAttribute(block, "data-ag-layout", originalLayout);
    restoreAttribute(block, "data-ag-group", originalGroup);
    restoreAttribute(block, "data-ag-mixed", originalMixed);
    if (imageEmbed && imageEmbed !== block) restoreAttribute(imageEmbed, "data-ag-layout", originalEmbedLayout);
    if (caption?.dataset.agOwned === "true") caption.remove();
    blockSnapshots.delete(block);
    if (imageEmbed) blockSnapshots.delete(imageEmbed);
  });
}

// A floated image can end a fraction of a text line below the preceding row.
// Snap the occupied height to the nearest line boundary by changing only the
// automatically calculated image width. Explicit ag:width values stay exact.
function snapFloatToLineGrid(layoutElement, image, block) {
  if (!layoutElement?.getBoundingClientRect || !image?.getBoundingClientRect) return;
  const view = layoutElement.ownerDocument?.defaultView;
  const getStyle = view?.getComputedStyle?.bind(view);
  if (!getStyle) return;
  const style = getStyle(block);
  let lineHeight = parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    const fontSize = parseFloat(style.fontSize);
    lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.2 : 0;
  }
  if (!lineHeight) return;
  const blockRect = layoutElement.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  if (!(blockRect.width > 0 && imageRect.height > 0)) return;
  const marginBottom = parseFloat(getStyle(layoutElement).marginBottom) || 0;
  // Use the actual layout-box edges. Image glyph pixels sit above the visual
  // baseline, so using the image's apparent bottom or text pixels as the grid
  // anchor places the correction at the top of a lowercase glyph instead of
  // at a line-box boundary.
  const occupied = blockRect.height + marginBottom;
  const lineCount = occupied / lineHeight;
  const lower = Math.floor(lineCount);
  const fraction = lineCount - lower;
  if (fraction < 0.02 || fraction > 0.98) return;
  const delta = fraction <= 0.5 ? -fraction * lineHeight : (1 - fraction) * lineHeight;
  const targetImageHeight = imageRect.height + delta;
  if (targetImageHeight <= 1) return;
  const targetWidth = blockRect.width * targetImageHeight / imageRect.height;
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) return;
  setStyle(layoutElement, "width", `${targetWidth}px`);
}

function hideGallerySeparators(blocks, cleanups) {
  for (const block of blocks) {
    if (block.querySelector("img, .image-embed, .internal-embed")) continue;
    if (!isBlank(block)) continue;
    const original = block.getAttribute("style");
    setStyle(block, "display", "none");
    cleanups.push(() => restoreStyle(block, original));
  }
}

function hideImageLineBreak(imageEmbed, cleanups) {
  let node = imageEmbed.nextSibling;
  while (node && node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node = node.nextSibling;
  if (node?.nodeName !== "BR") return;
  const original = node.getAttribute("style");
  setStyle(node, "display", "none");
  cleanups.push(() => restoreStyle(node, original));
}

// Obsidian preview adds spacing at more than one wrapper level (for example
// `.el-p > p > span.image-embed`). A float must own that spacing exactly once;
// otherwise the right-float case gets both the wrapper's bottom spacing and
// the inner paragraph's bottom spacing, and its top edge starts below prose.
function normalizeFloatAncestors(block, image, cleanups) {
  if (!block || !image) return;
  let node = image;
  while (node) {
    const current = node;
    const original = current.getAttribute?.("style");
    const properties = current === block
      ? ["margin-block-start", "padding-block-start", "padding-block-end"]
      : ["margin-block-start", "margin-block-end", "padding-block-start", "padding-block-end"];
    for (const property of properties) setStyle(current, property, "0px");
    cleanups.push(() => restoreStyle(current, original));
    if (current === block) break;
    node = current.parentElement;
  }
}

function isFloatBoundary(block, breaks = {}) {
  if (!block) return false;
  const has = (selector) => Boolean(block.matches?.(selector) || block.querySelector?.(selector));
  if (breaks.heading !== false && (HEADING.test(block.tagName) || has("h1, h2, h3, h4, h5, h6, .el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6"))) return true;
  if (breaks.code !== false && has("pre, .el-pre")) return true;
  if (breaks.math !== false && has(".math-block, mjx-container")) return true;
  if (breaks.image !== false && has("img, .image-embed, .internal-embed")) return true;
  if (breaks.table !== false && has("table, .el-table")) return true;
  if (breaks.quote !== false && has("blockquote, .callout, .el-blockquote")) return true;
  return false;
}

function snapshotAttribute(element, name) {
  let snapshot = blockSnapshots.get(element);
  if (!snapshot) { snapshot = new Map(); blockSnapshots.set(element, snapshot); }
  if (!snapshot.has(name)) snapshot.set(name, element.getAttribute(name));
  return snapshot.get(name);
}

function restoreStyle(element, original) {
  if (original === null) element.removeAttribute("style"); else element.setAttribute("style", original);
}

function restoreAttribute(element, name, original) {
  if (original === null) element.removeAttribute(name); else element.setAttribute(name, original);
}

function ensureCaption(block, text, options) {
  const existing = block.querySelector(":scope > .ag-caption");
  if (!text) return existing;
  // The PDF path renders into another document. Creating the node with the
  // block's own document avoids relying on implicit adoption.
  const caption = existing ?? block.ownerDocument.createElement("span");
  caption.className = "ag-caption";
  caption.textContent = text;
  caption.dataset.agOwned = existing ? (caption.dataset.agOwned ?? "false") : "true";
  for (const [property, value] of Object.entries({ display: "block", width: "100%", maxWidth: "100%", marginTop: `${options.captionGap ?? 6}px`, marginInline: "auto", textAlign: "center", whiteSpace: "normal", overflowWrap: "anywhere", boxSizing: "border-box" })) setStyle(caption, property, value);
  if (!existing) block.appendChild(caption);
  return caption;
}

function setStyle(element, property, value) {
  const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  element.style.setProperty(cssProperty, String(value), "important");
}

function isBlank(block) {
  if (!block || block.querySelector("img, .image-embed, .internal-embed")) return false;
  if (BOUNDARIES.has(block.tagName) || HEADING.test(block.tagName)) return false;
  return !block.textContent.trim();
}
