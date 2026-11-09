import { normalizeEmbedAlt, parseImageAnnotation } from "./annotations.js";

/** A source line that holds nothing but one image reference. */
export const IMAGE_LINE = /^\s*(?:!\[[^\]]*\]\([^\n)]*\)|!\[\[[^\]]+\]\])\s*$/;

/**
 * A gallery may span at most this many blank lines. One blank line is the
 * ordinary separator between image lines; three or more means the author
 * started a new visual group, so the gallery must stop there.
 */
export const MAX_GALLERY_BLANK_LINES = 2;

/**
 * Lines that belong to a fenced code block, one-based, fence lines included.
 *
 * A fence is literal text: `![x](y)` inside it is a code sample that the
 * reading view prints as-is and Live Preview renders as source, so it must
 * never be counted as a picture. The scanner is deliberately minimal - an
 * opening run of three or more backticks or tildes and a closing run of the
 * same character at least as long - because that is exactly the fence the
 * Markdown parser accepts. An indented four-space block is not treated as code:
 * inside a list that indentation is a continuation line, and list pictures are
 * recognised there.
 */
export function readCodeBlockLines(text) {
  const lines = String(text ?? "").split("\n");
  const inside = new Set();
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      inside.add(index + 1);
      if (new RegExp(`^\\s*\\${fence.char}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) continue;
    // A backtick "fence" whose info string holds a backtick is an inline code
    // span that happens to start a line, not a block.
    if (open[1][0] === "`" && open[2].includes("`")) continue;
    fence = { char: open[1][0], length: open[1].length };
    inside.add(index + 1);
  }
  return inside;
}

/**
 * Read every standalone image line of a note together with the blank lines
 * that precede it. Reading view drops blank paragraphs from its DOM, so the
 * source is the only place where the gallery separator count is still
 * available; Live Preview needs the same rule and must not implement a second
 * copy of it.
 */
export function readSourceImages(text) {
  const records = [];
  const code = readCodeBlockLines(text);
  let blank = 0;
  let blocked = false;
  for (const [index, line] of String(text ?? "").split("\n").entries()) {
    // Code is text, not a block of pictures: it neither adds a picture nor
    // lets a gallery run continue across it.
    if (code.has(index + 1)) {
      blocked = true;
      blank = 0;
      continue;
    }
    if (IMAGE_LINE.test(line)) {
      const parsed = parseSourceImage(line);
      records.push({
        // Position in this array. The reading view uses it to relate a rendered
        // block back to the source group it belongs to, so a gallery can be
        // packed from the full run even while some of its blocks are
        // virtualised out.
        index: records.length,
        lineNumber: index + 1,
        target: parsed.target,
        identity: parsed.identity,
        params: parsed.params,
        // The first image of a note has no preceding image to be separated
        // from; report zero so callers never have to special-case it.
        blankBefore: records.length ? blank : 0,
        blockedBefore: records.length ? blocked : false
      });
      blank = 0;
      blocked = false;
      continue;
    }
    if (!line.trim()) {
      blank += 1;
      continue;
    }
    // Prose, headings, callouts and every other block end a gallery run even
    // when no blank line was written between the image and the text.
    blocked = true;
    blank = 0;
  }
  return records;
}

/**
 * Split source image records into gallery runs. `ag:isolate` and `ag:exclude`
 * are structural: an isolated image is always alone, and an excluded one is
 * never rendered, so neither may join a run in either direction.
 */
export function groupImageRecords(records = []) {
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  for (const record of records) {
    const previous = current[current.length - 1] ?? null;
    const breaks = !previous
      || record.params?.exclude === true
      || record.params?.isolate === true
      || record.blankBefore > MAX_GALLERY_BLANK_LINES
      || record.blockedBefore === true
      || previous.params?.isolate === true
      || previous.params?.exclude === true;
    if (breaks) flush();
    if (record.params?.exclude === true) continue;
    current.push(record);
  }
  flush();
  return groups;
}

/** Gallery line numbers for the Live Preview decorations. */
export function findImageLineGroups(text) {
  return groupImageRecords(readSourceImages(text)).map((group) => group.map((record) => record.lineNumber));
}

/** A list item marker: bullets and ordered markers, with the marker width. */
const LIST_MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
/** Content of a list item that is nothing but one image reference. */
const IMAGE_ONLY_CONTENT = /^(?:!\[[^\]]*\]\([^\n)]*\)|!\[\[[^\]]+\]\])\s*$/;

/**
 * Live Preview renders every list item on its own `.cm-line`, and a second
 * picture of the same item becomes an indented continuation line. Both are
 * image lines in the note but neither matches `IMAGE_LINE`, which is why list
 * pictures used to be skipped entirely - or, worse, an indented continuation
 * was mistaken for a standalone image and took the whole column.
 *
 * The reading view groups pictures per list item and per paragraph; this
 * function reproduces that decision from the source so the editor can do the
 * same. A blank line or a new item starts another run, exactly like the
 * reading view's block walk, and `ag:isolate` pulls one picture out of the
 * row it would otherwise join.
 */
export function readListImageLayout(text) {
  const source = String(text ?? "").split("\n");
  const code = readCodeBlockLines(text);
  const entries = [];
  // Open list items, innermost last. `contentColumn` is the column where the
  // item's own content begins, which is the indent a continuation must reach.
  const stack = [];
  let itemId = 0;
  source.forEach((raw, index) => {
    // A blank line does not end a list item, it only ends a paragraph.
    if (!raw.trim()) return;
    // A fence inside an item is code: its lines are not item content, and
    // skipping them leaves the item open for the text that follows.
    if (code.has(index + 1)) return;
    const marker = LIST_MARKER.exec(raw);
    if (marker) {
      const indent = marker[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      itemId += 1;
      stack.push({
        indent,
        contentColumn: indent + marker[2].length + marker[3].length,
        itemId
      });
      if (IMAGE_ONLY_CONTENT.test(marker[4].trim())) {
        entries.push({ lineNumber: index + 1, itemId, first: true, params: parseSourceImage(marker[4]).params });
      }
      return;
    }
    const indent = /^[ \t]*/.exec(raw)[0].length;
    // A line shallower than the innermost item continues an outer item - or
    // ends the list when no item is shallow enough.
    while (stack.length && indent < stack[stack.length - 1].contentColumn) stack.pop();
    if (!stack.length || !IMAGE_ONLY_CONTENT.test(raw.trim())) return;
    entries.push({
      lineNumber: index + 1,
      itemId: stack[stack.length - 1].itemId,
      first: false,
      params: parseSourceImage(raw).params
    });
  });

  const layout = new Map();
  let run = [];
  // A run is the unit the editor lays out: the lines that share one row (or
  // one lone picture). The editor groups rendered lines by it, so an isolated
  // picture must not end up in the run of its former neighbours.
  let runId = 0;
  const flushRun = () => {
    if (!run.length) return;
    let group = [];
    const flushGroup = () => {
      if (!group.length) return;
      const gallery = group.length > 1;
      runId += 1;
      // `cell` marks the cells a row moves onto its top edge. It is a property
      // of the group, not of the item: a picture on a continuation line of an
      // item that starts with prose is still the row's first cell, and it has
      // to stay in the flow to give the row its height.
      group.forEach((entry, index) => {
        layout.set(entry.lineNumber, {
          itemId: entry.itemId, first: entry.first, gallery, cell: gallery && index > 0, runId
        });
      });
      group = [];
    };
    for (const entry of run) {
      // Structural flags never join a row in either direction: an isolated
      // picture is always alone, an excluded one is not rendered at all.
      if (entry.params?.isolate || entry.params?.exclude) {
        flushGroup();
        runId += 1;
        layout.set(entry.lineNumber, {
          itemId: entry.itemId, first: entry.first, gallery: false, cell: false, runId
        });
        continue;
      }
      group.push(entry);
    }
    flushGroup();
    run = [];
  };
  for (const entry of entries) {
    const previous = run[run.length - 1];
    // Consecutive lines of the same item share a paragraph; anything else is a
    // new block, so the two must not share a gallery row.
    if (previous && previous.itemId === entry.itemId && entry.lineNumber === previous.lineNumber + 1) {
      run.push(entry);
    } else {
      flushRun();
      run = [entry];
    }
  }
  flushRun();
  return layout;
}

export function parseSourceImage(source) {
  const wiki = /!\[\[([^\]]+)\]\]/.exec(source);
  if (wiki) {
    const parts = wiki[1].split("|");
    const target = normalizeTarget(parts.shift());
    const caption = parts.join("|");
    return { target, identity: `${target}|${caption}`, params: parseImageAnnotation(caption).params };
  }
  const markdown = /!\[([^\]]*)\]\(([^\n)]*)\)/.exec(source);
  if (markdown) {
    const target = normalizeTarget(markdown[2]);
    const caption = markdown[1];
    return { target, identity: `${target}|${caption}`, params: parseImageAnnotation(caption).params };
  }
  return { target: "", identity: "|", params: {} };
}

/**
 * The link target of a rendered embed, normalised the same way as the source
 * record. Used to remember an image's natural size per file rather than per
 * `<img>` element, which is what lets a gallery reserve the right cell widths
 * before every one of its blocks has been attached by the virtualiser.
 */
export function readEmbedTarget(image) {
  const embed = image?.closest?.(".image-embed, .internal-embed");
  return normalizeTarget(embed?.getAttribute?.("src") ?? image?.getAttribute?.("src") ?? "");
}

/** Match a rendered embed back to the source record that produced it. */
export function imageIdentityFromDOM(image) {
  const embed = image?.closest?.(".image-embed, .internal-embed");
  const target = normalizeTarget(embed?.getAttribute?.("src") ?? image?.getAttribute?.("src") ?? "");
  // The DOM `alt` is the alias, except for a wiki link without one, where
  // Obsidian fills in the link target. Normalise it the same way the annotation
  // reader does, or every unannotated embed misses its source record and loses
  // the blank-line information the gallery grouping depends on.
  const caption = normalizeEmbedAlt(embed?.getAttribute?.("alt") ?? image?.getAttribute?.("alt") ?? "", target);
  return `${target}|${caption}`;
}

export function normalizeTarget(value) {
  try { return decodeURIComponent(String(value ?? "")).trim(); }
  catch { return String(value ?? "").trim(); }
}
