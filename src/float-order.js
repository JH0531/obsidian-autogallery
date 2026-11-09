import { readSourceImages } from "./image-runs.js";

/** Number of rendered images before `lineNumber`, skipping `ag:exclude`. */
export function countFloatImagesBefore(text, lineNumber) {
  let index = 0;
  for (const record of readSourceImages(text)) {
    if (record.lineNumber >= Math.max(1, lineNumber)) break;
    if (record.params.exclude) continue;
    index += 1;
  }
  return index;
}

/**
 * Persistent float order per image identity. The order is the document order
 * of image lines, so alternating left/right alignment survives preview blocks
 * being re-created while scrolling.
 */
export function buildFloatImageOrder(text) {
  const byIdentity = new Map();
  let index = 0;
  for (const record of readSourceImages(text)) {
    if (record.params.exclude) continue;
    const queue = byIdentity.get(record.identity) ?? [];
    queue.push(index++);
    byIdentity.set(record.identity, queue);
  }
  return byIdentity;
}
