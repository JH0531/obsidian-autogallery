import { normalizedTop } from "./crop-geometry.js";

const PARAMETER_PREFIX = "ag:";
// Parameters this build no longer understands. They are not re-emitted, so a
// rewrite cleans a note instead of preserving a dead option forever.
const RETIRED_KEYS = new Set(["fit", "focus", "top"]);
const VALID_LAYOUTS = new Set(["auto", "gallery", "float", "center"]);
const VALID_SIDES = new Set(["left", "right", "center", "centre"]);
export function parseImageAnnotation(value = "") {
  // Obsidian keeps a Markdown table's escaped pipes in a cell's embed alt, so
  // the alias arrives as `\|ag:crop=2:1\|ag:top=...`. Restore the separators
  // before splitting; otherwise every parameter is glued into the caption.
  const raw = String(value ?? "");
  const tableEscaped = raw.trimStart().startsWith("\\|");
  const fields = splitFields(tableEscaped ? raw.replace(/\\\|/g, "|") : raw).flatMap((field) => (
    field.trim().toLowerCase().startsWith(PARAMETER_PREFIX) ? field.split("|") : [field]
  ));
  const firstField = (fields.shift() ?? "").trim();
  // `![[image|ag:crop=16:9]]` is a parameter list without a caption. Treating
  // the first field as a caption made every such link silently lose its
  // settings - and inside a Markdown table the pipe is escaped, so the target
  // never reaches this function and the alias arrives alone.
  const firstIsParameter = firstField.toLowerCase().startsWith(PARAMETER_PREFIX);
  if (firstIsParameter) fields.unshift(firstField);
  const decodedCaption = decodeCaption(firstField);
  const caption = firstIsParameter
    ? ""
    : decodedCaption.quoted || !isNativeImageSize(decodedCaption.value)
      ? decodedCaption.value
      : "";
  const params = {};
  const extras = [];
  let pendingTop = null;
  let pendingTopToken = "";

  for (const field of fields) {
    const token = field.trim();
    if (!token.toLowerCase().startsWith(PARAMETER_PREFIX)) continue;
    const separator = token.indexOf("=", PARAMETER_PREFIX.length);
    if (separator < 0) {
      const flag = token.slice(PARAMETER_PREFIX.length).trim().toLowerCase();
      if (flag === "exclude") params.exclude = true;
      else if (flag === "isolate") params.isolate = true;
      else if (flag === "group") params.group = 1;
      else extras.push(token);
      continue;
    }
    const key = token.slice(PARAMETER_PREFIX.length, separator).trim().toLowerCase();
    const raw = token.slice(separator + 1).trim();
    if (!key || !raw) continue;

    let handled = false;
    if (key === "exclude") { params.exclude = raw.toLowerCase() !== "false"; handled = true; }
    else if (key === "isolate") { params.isolate = raw.toLowerCase() !== "false"; handled = true; }
    else if (key === "group") {
      // A row binding needs an identity: two adjacent bound rows must stay two
      // rows, and a boolean flag cannot tell them apart - a maximal run of
      // `true` would swallow both. The value groups the members of one row.
      if (raw.toLowerCase() === "false") { params.group = false; handled = true; }
      else {
        const id = Number.parseInt(raw, 10);
        if (Number.isFinite(id) && id > 0) { params.group = id; handled = true; }
      }
    }
    else if (key === "layout") {
      const value = raw.toLowerCase();
      if (VALID_LAYOUTS.has(value)) { params.layout = value; handled = true; }
    }
    else if (key === "side") {
      const value = raw.toLowerCase();
      if (VALID_SIDES.has(value)) { params.side = value === "centre" ? "center" : value; handled = true; }
    }
    else if (key === "width") {
      const width = parsePercent(raw);
      if (width !== null) { params.width = width; handled = true; }
    }
    else if (key === "gap") {
      const gap = parsePixels(raw);
      if (gap !== null) { params.gap = gap; handled = true; }
    }
    else if (key === "crop") {
      const crop = parseCrop(raw);
      if (crop) { params.crop = crop; handled = true; }
    }
    else if (key === "rows") {
      // Row counts for the whole gallery. Only the run's first image carries
      // them; every other member ignores the key.
      const rows = parseRows(raw);
      if (rows) { params.rows = rows; handled = true; }
    }
    else if (key === "top") {
      // The top edge may be written before the ratio it belongs to; keep it
      // aside and attach it once the whole parameter list is known.
      const top = parseTop(raw);
      if (top) { pendingTop = top; pendingTopToken = token; handled = true; }
    }

    // Keep a token the parser could not interpret verbatim. Dropping it would
    // turn an unreadable value into silent data loss on the next rewrite.
    if (!handled) extras.push(token);
  }

  // The top edge only makes sense together with the ratio that derives the
  // frame's height. Without one the token is kept verbatim for a later rewrite.
  if (pendingTop) {
    if (params.crop) params.crop = { ...params.crop, top: pendingTop };
    else extras.push(pendingTopToken);
  }
  if (extras.length) params.extras = extras;
  return { caption, params };
}

/**
 * Obsidian writes the link target into an embed's `alt` when a wiki link has
 * no alias. That is a file name, not a caption: reading it as one gives every
 * plain `![[image.png]]` a caption repeating its own name, and it also makes
 * the DOM identity diverge from the source record, which is what the gallery
 * cursor matches on.
 */
export function normalizeEmbedAlt(alt, target) {
  const value = String(alt ?? "");
  if (!value) return "";
  const link = String(target ?? "");
  if (!link) return value;
  const base = link.split("/").pop() ?? link;
  const stem = base.replace(/\.[^.]+$/, "");
  if (value === link || value === base || value === stem) return "";
  return value;
}

/** The embed's own link target, decoded and trimmed. */
export function readEmbedTarget(image) {
  const embed = image?.closest?.(".image-embed, .internal-embed");
  const raw = embed?.getAttribute?.("src") ?? image?.getAttribute?.("src") ?? "";
  try { return decodeURIComponent(String(raw)).trim(); }
  catch { return String(raw).trim(); }
}

export function readImageAnnotation(image) {
  const embed = image?.closest?.(".image-embed, .internal-embed");
  const candidates = [
    image?.getAttribute?.("alt"),
    embed?.getAttribute?.("alt"),
    embed?.getAttribute?.("aria-label")
  ].filter((value) => typeof value === "string");
  const chosen = candidates.find((value) => value.includes("ag:") || value.includes("|"))
    ?? candidates[0]
    ?? "";
  return parseImageAnnotation(normalizeEmbedAlt(chosen, readEmbedTarget(image)));
}

export function replaceImageAnnotation(line, caption, params) {
  const wiki = /!\[\[([^\]]+)\]\]/.exec(line);
  if (wiki) {
    // A table row escapes every pipe inside its cell, including the ones that
    // separate the target from the parameters. Split the unescaped form, then
    // restore the escapes so the row stays valid Markdown.
    const tableRow = /^\s*\|/.test(line);
    const escaped = tableRow && wiki[1].includes("\\|");
    const alias = escaped ? wiki[1].replace(/\\\|/g, "|") : wiki[1];
    const fields = splitFields(alias);
    const target = fields.shift() ?? "";
    const annotation = formatImageAnnotation(caption, params);
    const rebuilt = annotation ? `${target}|${annotation}` : target;
    const replacement = `![[${escaped ? rebuilt.replace(/\|/g, "\\|") : rebuilt}]]`;
    return line.slice(0, wiki.index) + replacement + line.slice(wiki.index + wiki[0].length);
  }

  const markdown = findMarkdownImage(line);
  if (markdown) {
    const annotation = formatImageAnnotation(caption, params);
    const replacement = `![${annotation}](${markdown.target})`;
    return line.slice(0, markdown.start) + replacement + line.slice(markdown.end);
  }
  return null;
}

function findMarkdownImage(line) {
  const start = line.indexOf("![");
  if (start < 0) return null;
  let closeAlt = -1;
  for (let index = start + 2; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === "]") {
      closeAlt = index;
      break;
    }
  }
  if (closeAlt < 0 || line[closeAlt + 1] !== "(") return null;

  let depth = 1;
  let closeTarget = -1;
  for (let index = closeAlt + 2; index < line.length; index += 1) {
    if (line[index] === "\\") {
      index += 1;
      continue;
    }
    if (line[index] === "(") depth += 1;
    if (line[index] === ")" && --depth === 0) {
      closeTarget = index;
      break;
    }
  }
  if (closeTarget < 0) return null;
  return {
    start,
    end: closeTarget + 1,
    target: line.slice(closeAlt + 2, closeTarget)
  };
}

export function formatImageAnnotation(caption = "", params = {}) {
  // An empty caption must contribute no field at all. Emitting one produced
  // `![[a.png||ag:crop=1.5:1]]`: the link then carries a second alias starting
  // with a pipe, which Obsidian treats as display text.
  const trimmedCaption = caption.trim();
  const fields = trimmedCaption ? [escapeField(trimmedCaption)] : [];
  const emitted = new Set();
  const emit = (key, token) => { fields.push(token); emitted.add(key); };
  // Structural flags are emitted first and must always survive a rewrite.
  // Losing `ag:isolate` silently rejoins the image into the next gallery, and
  // losing `ag:exclude` makes an opted-out image render again.
  if (params.isolate === true) emit("isolate", "ag:isolate");
  if (params.exclude === true) emit("exclude", "ag:exclude");
  // Structural, like the two above: it changes which pictures share a row, so
  // it has to sit ahead of every rendering parameter. Id 1 is the default row,
  // written bare so a hand-written flag stays one token.
  if (Number.isFinite(params.group) && params.group > 0) {
    emit("group", params.group === 1 ? "ag:group" : `ag:group=${Math.round(params.group)}`);
  }
  if (VALID_LAYOUTS.has(params.layout)) emit("layout", `ag:layout=${params.layout}`);
  if (VALID_SIDES.has(params.side)) emit("side", `ag:side=${params.side}`);
  if (Number.isFinite(params.width)) emit("width", `ag:width=${Math.round(params.width)}%`);
  if (Number.isFinite(params.gap)) emit("gap", `ag:gap=${Math.round(params.gap)}px`);
  if (Array.isArray(params.rows) && params.rows.length) emit("rows", `ag:rows=${params.rows.join(",")}`);
  if (params.crop) {
    emit("crop", `ag:crop=${trimNumber(params.crop.w)}:${trimNumber(params.crop.h)}`);
    const top = params.crop.top;
    if (top) emit("top", `ag:top=${trimNumber(top.x1)}:${trimNumber(top.x2)}:${trimNumber(top.y)}`);
  }

  // Parameters this version does not understand are re-emitted verbatim, so
  // editing one value through the arrows never deletes the rest. Walk backwards
  // to keep the last occurrence of a duplicated key, matching parse order.
  const extras = Array.isArray(params.extras) ? params.extras : [];
  const trailing = [];
  for (let index = extras.length - 1; index >= 0; index -= 1) {
    const token = String(extras[index] ?? "").trim();
    const key = annotationKey(token);
    if (!key || emitted.has(key) || RETIRED_KEYS.has(key)) continue;
    emitted.add(key);
    trailing.unshift(token);
  }
  fields.push(...trailing);
  return fields.join("|");
}

function annotationKey(token) {
  const text = String(token ?? "").trim();
  if (!text.toLowerCase().startsWith(PARAMETER_PREFIX)) return "";
  const body = text.slice(PARAMETER_PREFIX.length);
  const separator = body.indexOf("=");
  return (separator < 0 ? body : body.slice(0, separator)).trim().toLowerCase();
}

/** Read the annotation of the first image reference on a source line. */
export function extractImageAnnotation(line) {
  const wiki = /!\[\[([^\]]+)\]\]/.exec(line);
  if (wiki) {
    // Table rows escape their pipe separators; parse the logical alias and
    // drop the link target so only the parameter list reaches the parser.
    const tableRow = /^\s*\|/.test(line);
    const alias = tableRow ? wiki[1].replace(/\\\|/g, "|") : wiki[1];
    return parseImageAnnotation(alias.split("|").slice(1).join("|"));
  }
  const markdown = /!\[([^\]]*)\]\(/.exec(line);
  return markdown ? parseImageAnnotation(markdown[1]) : null;
}

/**
 * Merge a parameter patch into the image's existing annotation. Used by the
 * drag-to-resize handle so a width gesture cannot drop a caption or crop.
 * Passing `caption` replaces the caption without discarding the parameters
 * the patch does not mention.
 */
export function updateImageAnnotation(line, patch = {}, caption = undefined) {
  const current = extractImageAnnotation(line);
  if (!current) return null;
  const params = { ...current.params, ...patch };
  for (const key of Object.keys(params)) {
    if (params[key] === null || params[key] === undefined) delete params[key];
  }
  return replaceImageAnnotation(line, caption === undefined ? current.caption : caption, params);
}

function splitFields(value) {
  const fields = [];
  let current = "";
  let escaped = false;
  for (const character of String(value)) {
    if (escaped) {
      // Keep escaped quote markers until caption parsing decides whether the
      // outer quote pair is syntax or literal caption text.
      current += character === '"' || character === "'" ? `\\${character}` : character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  fields.push(current);
  return fields;
}

function escapeField(value) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function parsePercent(value) {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (!match) return null;
  const percent = Number(match[1]);
  // 100% is a valid width: a full-bleed image keeps its alignment parameters
  // for later resizing even though it renders centred while it fills the
  // column. Below 10% the annotation would be a typo, not a layout choice.
  return percent >= 10 && percent <= 100 ? percent : null;
}

function parsePixels(value) {
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value);
  if (!match) return null;
  const pixels = Number(match[1]);
  return pixels >= 0 && pixels <= 80 ? pixels : null;
}

/** `W:H` establishes a fixed crop box; the ratio is bounded so a typo cannot
 * collapse an image to a sliver. */
function parseCrop(value) {
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(value).trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0) || width > 50 || height > 50) return null;
  const ratio = width / height;
  return ratio >= 0.1 && ratio <= 10 ? { w: width, h: height } : null;
}

/**
 * `3,2` — how many images each gallery row holds.
 *
 * A hand-written prefix for the row packer: it describes the rows from the
 * run's first image onward, and the packer routes whatever it leaves over.
 * Values are plain counts; a count that runs past the last picture is
 * truncated, and a list that stops early leaves the rest to automatic routing.
 * Nothing writes this parameter on the reader's behalf - it only ever comes
 * from the note.
 */
function parseRows(value) {
  const parts = String(value).split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 30) return null;
  const rows = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const count = Number(part);
    if (!Number.isFinite(count) || count < 1 || count > 15) return null;
    rows.push(count);
  }
  return rows;
}

/**
 * `x1:x2:y` — the crop frame's top edge, in percent of the picture's own width
 * and height. The height comes from the ratio, so the top edge only needs its
 * two ends and its vertical position. Out-of-range values are clamped instead
 * of rejected: a hand-written `top` should still render, just inside the frame.
 */
function parseTop(value) {
  const parts = String(value).trim().split(":").map((part) => Number(part.trim()));
  if (parts.length !== 3) return null;
  const [rawX1, rawX2, rawY] = parts;
  if (![rawX1, rawX2, rawY].every((number) => Number.isFinite(number))) return null;
  const top = normalizedTop({ x1: rawX1, x2: rawX2, y: rawY });
  if (!top) return null;
  const round = (number) => Math.round(number * 100) / 100;
  return { x1: round(top.x1), x2: round(top.x2), y: round(top.y) };
}

function trimNumber(value) {
  return String(Math.round(Number(value) * 1000) / 1000);
}

function isNativeImageSize(value) {
  return /^\d+(?:x\d+)?$/i.test(value);
}

function decodeCaption(value) {
  const text = String(value).trim();
  const quote = text[0];
  const quoted = (quote === '"' || quote === "'")
    && text.endsWith(quote)
    && !text.startsWith(`\\${quote}`)
    && !text.endsWith(`\\${quote}`);
  const content = quoted ? text.slice(1, -1) : text;
  return { value: content.replace(/\\(["'])/g, "$1"), quoted };
}
