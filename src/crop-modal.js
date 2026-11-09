import { Modal, Setting } from "obsidian";
import { t } from "./i18n.js";
import { cropRegion, ratioToPair, regionCoversImage, regionToTop } from "./crop-geometry.js";

const RATIO_OPTIONS = [
  ["1:1", "1 : 1"],
  ["4:3", "4 : 3"],
  ["3:2", "3 : 2"],
  ["16:9", "16 : 9"],
  ["9:16", "9 : 16"],
  ["3:4", "3 : 4"],
  ["2:3", "2 : 3"]
];
const PRESET_VALUES = new Set(RATIO_OPTIONS.map(([value]) => value));
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_FRAME = 32;
const MAX_ZOOM = 4;
const SNAP_RATIOS = [1, 4 / 3, 3 / 2, 16 / 9, 21 / 9, 9 / 16, 2 / 3, 3 / 4];
const SNAP_TOLERANCE = 0.03;
// The wheel over the stage is the zoom gesture, so a dialog taller than the
// viewport leaves its footer reachable only through a strip the reader cannot
// grab. The stage is therefore bounded by what the viewport has left after the
// heading, the hint, the two setting rows and the footer.
const STAGE_MIN_HEIGHT = 150;
const STAGE_MAX_HEIGHT = 460;
const STAGE_CHROME_HEIGHT = 340;

/**
 * Display-only crop editor. It never touches the image file: the frame becomes
 * `ag:crop` (its ratio) plus `ag:top` (the position of its top edge), and both
 * views paint that source rectangle with `object-view-box`.
 *
 * The frame is free: an ordinary drag moves only the edge under the pointer,
 * Alt drags both opposite edges around the centre, and Shift scales the frame
 * while keeping its current ratio.
 */
export class CropModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options;
    this.state = null;
    this.listeners = [];
    this.loadTimer = null;
    this.layoutTimer = null;
    this.layoutRetry = null;
    this.resizeObserver = null;
    this.loadingEl = null;
    this.errorEl = null;
  }

  onOpen() {
    this.modalEl.addClass("ag-crop-modal");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("style", { text: CROP_STYLES });
    const heading = contentEl.createEl("h2", { text: t("自由剪裁") });
    if (this.options.title) heading.createSpan({ cls: "ag-crop-file", text: this.options.title });
    contentEl.createEl("p", {
      cls: "ag-crop-hint",
      text: t("拖动拉杆改变取景：只移动指针所在的那条边（角点带动两条相邻边）；Shift 锁定当前比例缩放，Alt 以中心对称缩放。拖动图片平移取景，滚轮缩放画布。只影响显示，不会修改图片文件。")
    });

    const ratioSetting = new Setting(contentEl).setName(t("画幅比例"));
    const toolbar = new Setting(contentEl);
    toolbar.addButton((button) => button.setButtonText(t("重置取景")).onClick(() => this.resetFrame()));
    toolbar.addButton((button) => button.setButtonText(t("清除剪裁")).setWarning().onClick(() => {
      this.state.discard = true;
      this.options.onReset?.();
      this.close();
    }));

    this.loadingEl = contentEl.createEl("p", { cls: "ag-crop-loading", text: t("正在载入图片…") });
    this.stage = contentEl.createDiv({ cls: "ag-crop-stage" });
    this.imageEl = this.stage.createEl("img", { cls: "ag-crop-image" });
    this.frameEl = this.stage.createDiv({ cls: "ag-crop-frame" });
    for (const handle of HANDLES) {
      this.frameEl.createDiv({ cls: `ag-crop-handle ag-crop-handle-${handle}`, attr: { "data-handle": handle } });
    }
    this.imageEl.alt = "";
    this.imageEl.src = this.options.src;

    const footer = new Setting(contentEl).setClass("ag-crop-footer");
    footer.addButton((button) => button.setButtonText(t("取消")).onClick(() => this.close()));
    footer.addButton((button) => button.setButtonText(t("保存")).setCta().onClick(() => this.save()));

    const initial = this.resolveInitialRatio();
    ratioSetting.addDropdown((dropdown) => {
      // Order: free, the picture's own ratio (only when it is not a preset),
      // then the presets. The remembered choice wins over the picture's ratio.
      dropdown.addOption("free", t("自由比例"));
      if (initial.showCurrent) {
        dropdown.addOption("current", t("当前比例 {w}:{h}", { w: this.options.crop.w, h: this.options.crop.h }));
      }
      for (const [value, label] of RATIO_OPTIONS) dropdown.addOption(value, label);
      dropdown.setValue(initial.selected);
      dropdown.onChange((value) => {
        this.options.onRatioChange?.(value);
        if (value === "current") this.setRatio(initial.currentRatio);
        else this.setRatio(value === "free" ? null : parseRatio(value));
      });
      this.ratioDropdown = dropdown;
    });

    this.state = {
      ready: false,
      dirty: false,
      discard: false,
      confirming: false,
      natural: { width: 0, height: 0 },
      stage: { width: 0, height: 0 },
      image: { x: 0, y: 0, width: 0, height: 0 },
      frame: { x: 0, y: 0, width: 0, height: 0 },
      ratio: initial.ratio,
      initial: null,
      zoom: 1,
      gesture: null
    };

    this.onPointerDown = (event) => this.beginGesture(event);
    this.stage.addEventListener("pointerdown", this.onPointerDown);
    this.onWheel = (event) => this.zoomAt(event);
    this.stage.addEventListener("wheel", this.onWheel, { passive: false });
    this.containerEl.addEventListener("click", (event) => {
      if (event.target === this.containerEl) this.close();
    });

    // The modal animates in and can report a zero-sized stage on the first
    // frame. Retry whenever the stage gets a real size instead of giving up
    // once, which used to leave the crop frame as a 2px border.
    // The retry must not run inside the observer callback: laying the crop
    // frame out there resizes the observed element in the same delivery and
    // Chromium reports an undelivered-notification loop.
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.state || this.state.ready) return;
      if (this.layoutRetry !== null) return;
      this.layoutRetry = setTimeout(() => {
        this.layoutRetry = null;
        if (this.state && !this.state.ready) this.initLayout();
      }, 0);
    });
    this.resizeObserver.observe(this.stage);

    const start = () => this.initLayout();
    if (this.imageEl.complete && this.imageEl.naturalWidth > 0) start();
    else this.imageEl.addEventListener("load", start, { once: true });
    this.imageEl.addEventListener("error", () => this.showLoadError(t("图片无法加载，暂时不能剪裁。")), { once: true });
    // A detached widget can hand us a resource path that never resolves; do not
    // leave the modal in a permanent loading state.
    this.loadTimer = setTimeout(() => this.showLoadError(t("图片载入超时，请关闭后重试。")), 8000);
    this.layoutTimer = setTimeout(() => this.initLayout(), 120);
  }

  showLoadError(message) {
    if (this.state?.ready) return;
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    this.loadingEl?.remove();
    if (this.errorEl) return;
    this.errorEl = this.contentEl.createEl("p", { cls: "ag-crop-error", text: message });
  }

  /**
   * Which ratio option is active on open. The last choice is stored in the
   * plugin settings so a preset (or "free") survives reopening and restarts.
   * "current" only exists when the saved crop ratio is not a preset.
   */
  resolveInitialRatio() {
    const crop = this.options.crop;
    const currentRatio = crop ? crop.w / crop.h : null;
    const currentPreset = currentRatio ? ratioOptionFor(currentRatio) : null;
    const hasCurrent = Boolean(currentRatio && !currentPreset);
    const remembered = this.options.ratioPreset;
    // The "current" entry only exists while the remembered choice is free (or
    // was already "current"). Once a preset is chosen, the menu is just free +
    // presets, so the preset stays active on the next open.
    const showCurrent = hasCurrent && (remembered === "free" || remembered === "current" || remembered == null);
    let selected;
    if (remembered === "free") selected = "free";
    else if (remembered === "current" && showCurrent) selected = "current";
    else if (PRESET_VALUES.has(remembered)) selected = remembered;
    else selected = currentPreset ?? "free";
    const ratio = selected === "free" ? null : selected === "current" ? currentRatio : parseRatio(selected);
    return { selected, ratio, currentRatio, currentPreset, showCurrent };
  }

  initLayout() {
    const state = this.state;
    if (!state || state.ready) return;
    const naturalWidth = this.imageEl.naturalWidth;
    const naturalHeight = this.imageEl.naturalHeight;
    if (!(naturalWidth > 0 && naturalHeight > 0)) return;
    let rect = this.stage.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;

    const view = this.contentEl.ownerDocument?.defaultView;
    // Same budget as the stylesheet, so the inline height written below can
    // never grow the dialog past the viewport.
    const viewportBudget = (view?.innerHeight ?? 800) * 0.88 - STAGE_CHROME_HEIGHT;
    const maxStageHeight = Math.max(STAGE_MIN_HEIGHT, Math.min(STAGE_MAX_HEIGHT, viewportBudget));
    // Size the stage to the image so a wide image does not sit inside a huge
    // empty sheet. The image is then contained: the whole picture stays
    // visible and the crop frame can never leave its border.
    const fitScale = Math.min(rect.width / naturalWidth, maxStageHeight / naturalHeight);
    const displayHeight = naturalHeight * fitScale;
    const targetHeight = Math.max(Math.min(220, maxStageHeight), Math.min(maxStageHeight, displayHeight));
    if (Math.abs(rect.height - targetHeight) > 1) {
      this.stage.style.height = `${targetHeight}px`;
      rect = this.stage.getBoundingClientRect();
    }

    state.natural = { width: naturalWidth, height: naturalHeight };
    state.stage = { width: rect.width, height: rect.height };
    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    state.image = { width, height, x: (rect.width - width) / 2, y: (rect.height - height) / 2 };

    // Reopen on the saved region when there is one, so the frame shows the
    // current crop instead of the whole picture. Without a crop the frame is
    // the largest rectangle of the selected ratio, centred on the stage.
    const saved = this.savedRegion();
    if (saved) {
      const scaleX = width / naturalWidth;
      const scaleY = height / naturalHeight;
      state.frame = {
        x: state.image.x + saved.x * scaleX,
        y: state.image.y + saved.y * scaleY,
        width: saved.width * scaleX,
        height: saved.height * scaleY
      };
      this.constrainFrame();
    } else {
      const ratio = state.ratio;
      let frameWidth = width;
      let frameHeight = height;
      if (ratio) {
        frameWidth = Math.min(width, height * ratio);
        frameHeight = frameWidth / ratio;
      }
      state.frame = {
        x: state.image.x + (width - frameWidth) / 2,
        y: state.image.y + (height - frameHeight) / 2,
        width: frameWidth,
        height: frameHeight
      };
    }
    state.ready = true;
    state.initial = this.computeResult();
    state.dirty = false;
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    if (this.layoutTimer !== null) {
      clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.loadingEl?.remove();
    this.errorEl?.remove();
    this.errorEl = null;
    this.applyLayout();
  }

  /** Source rectangle of the annotation this modal was opened for. */
  savedRegion() {
    const crop = this.options.crop;
    if (!crop) return null;
    return cropRegion(crop, this.state?.natural);
  }

  /** Keep the frame inside the picture without changing its ratio. */
  constrainFrame() {
    const { image, frame } = this.state;
    frame.width = clamp(frame.width, 1, image.width);
    frame.height = clamp(frame.height, 1, image.height);
    frame.x = clamp(frame.x, image.x, image.x + image.width - frame.width);
    frame.y = clamp(frame.y, image.y, image.y + image.height - frame.height);
  }

  /** Keep the picture covering the frame after a pan. */
  constrainImage() {
    const { image, frame } = this.state;
    image.x = clamp(image.x, frame.x + frame.width - image.width, frame.x);
    image.y = clamp(image.y, frame.y + frame.height - image.height, frame.y);
  }

  /**
   * Zoom is display-only: image and frame scale together around the stage
   * centre, so the crop geometry and the saved region do not change.
   */
  applyLayout() {
    const { image, frame, stage } = this.state;
    const zoom = this.state.zoom ?? 1;
    const centerX = stage.width / 2;
    const centerY = stage.height / 2;
    const scaleX = (value) => centerX + (value - centerX) * zoom;
    const scaleY = (value) => centerY + (value - centerY) * zoom;
    Object.assign(this.imageEl.style, {
      left: `${scaleX(image.x)}px`,
      top: `${scaleY(image.y)}px`,
      width: `${image.width * zoom}px`,
      height: `${image.height * zoom}px`
    });
    Object.assign(this.frameEl.style, {
      left: `${scaleX(frame.x)}px`,
      top: `${scaleY(frame.y)}px`,
      width: `${frame.width * zoom}px`,
      height: `${frame.height * zoom}px`
    });
  }

  zoomAt(event) {
    const state = this.state;
    if (!state?.ready) return;
    event.preventDefault();
    const factor = Math.exp(-Number(event.deltaY || 0) * 0.0015);
    const next = Math.min(MAX_ZOOM, Math.max(1, state.zoom * factor));
    if (Math.abs(next - state.zoom) < 0.001) return;
    state.zoom = next;
    this.applyLayout();
  }

  setRatio(ratio) {
    const state = this.state;
    if (!state?.ready) return;
    state.ratio = ratio;
    if (ratio) {
      // Keep the frame centred on its own middle while adopting the ratio.
      const centerX = state.frame.x + state.frame.width / 2;
      const centerY = state.frame.y + state.frame.height / 2;
      let width = Math.min(state.frame.width, state.image.width, state.image.height * ratio);
      let height = width / ratio;
      state.frame = { x: centerX - width / 2, y: centerY - height / 2, width, height };
      this.constrainFrame();
    }
    this.applyLayout();
    this.markDirty();
  }

  resetFrame() {
    const state = this.state;
    if (!state?.ready) return;
    state.ratio = null;
    if (this.ratioDropdown) this.ratioDropdown.setValue("free");
    // Reset means "no crop": the frame covers the whole picture.
    state.frame = { ...state.image };
    this.applyLayout();
    this.markDirty();
  }

  beginGesture(event) {
    const state = this.state;
    if (!state?.ready || event.button !== 0) return;
    const handle = event.target?.getAttribute?.("data-handle");
    event.preventDefault();
    event.stopPropagation();
    state.gesture = {
      pointerId: event.pointerId,
      mode: handle ? "frame" : "pan",
      handle,
      startX: event.clientX,
      startY: event.clientY,
      frame: { ...state.frame },
      image: { ...state.image }
    };
    const documentRef = this.contentEl.ownerDocument;
    const onMove = (moveEvent) => this.moveGesture(moveEvent);
    const onUp = () => this.endGesture();
    this.listeners = [
      [documentRef, "pointermove", onMove, true],
      [documentRef, "pointerup", onUp, true],
      [documentRef, "pointercancel", onUp, true]
    ];
    for (const [target, type, handler, capture] of this.listeners) {
      target.addEventListener(type, handler, capture);
    }
    this.stage.addClass("is-dragging");
  }

  moveGesture(event) {
    const state = this.state;
    const gesture = state?.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - gesture.startX) / (state.zoom || 1);
    const dy = (event.clientY - gesture.startY) / (state.zoom || 1);
    if (gesture.mode === "pan") {
      state.image.x = gesture.image.x + dx;
      state.image.y = gesture.image.y + dy;
      this.constrainImage();
      this.applyLayout();
      this.markDirty();
      return;
    }
    this.resizeFrame(gesture, dx, dy, event);
  }

  /**
   * Resize the frame from one gesture.
   *
   *   plain   only the edges named by the handle move
   *   alt     both opposite edges move, around the frame's centre
   *   shift   the frame scales with its current ratio
   *
   * A locked ratio (the dropdown) always wins; Shift only locks the ratio for
   * the duration of a free gesture.
   */
  resizeFrame(gesture, dx, dy, event) {
    const state = this.state;
    const handle = gesture.handle;
    const start = gesture.frame;
    const movesX = handle.includes("e") || handle.includes("w");
    const movesY = handle.includes("n") || handle.includes("s");
    const alt = event.altKey === true;
    const shift = event.shiftKey === true;
    const locked = state.ratio ?? (shift ? start.width / start.height : null);

    let width = start.width;
    let height = start.height;
    if (movesX) {
      const direction = handle.includes("e") ? 1 : -1;
      width = start.width + direction * dx * (alt ? 2 : 1);
    }
    if (movesY) {
      const direction = handle.includes("s") ? 1 : -1;
      height = start.height + direction * dy * (alt ? 2 : 1);
    }

    if (locked) {
      if (movesX && movesY) {
        // Scale from whichever axis the pointer moved further, so a corner
        // still follows the pointer instead of jumping between two sizes.
        const scaleX = width / start.width;
        const scaleY = height / start.height;
        const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
        width = start.width * scale;
        height = start.height * scale;
      } else if (movesX) {
        height = width / locked;
      } else {
        width = height * locked;
      }
    } else if (movesX && movesY && !alt) {
      // A free corner keeps the old "round to a common ratio" snap.
      const snapped = snapRatio(width / height);
      if (snapped) height = width / snapped;
    }

    width = Math.max(MIN_FRAME, width);
    height = Math.max(MIN_FRAME, height);
    if (locked) {
      if (width / height > locked) width = height * locked;
      else height = width / locked;
    }

    // Anchor on the side that must not move. A handle with no horizontal
    // movement keeps the frame's horizontal centre, which is also where an
    // alt drag grows it from; a shift-locked edge keeps the opposite edge.
    const anchorCenterX = start.x + start.width / 2;
    const anchorCenterY = start.y + start.height / 2;
    const anchorModeX = !movesX || alt ? "center" : handle.includes("e") ? "left" : "right";
    const anchorModeY = !movesY || alt ? "center" : handle.includes("s") ? "top" : "bottom";
    const anchorX = anchorModeX === "center" ? anchorCenterX
      : anchorModeX === "left" ? start.x : start.x + start.width;
    const anchorY = anchorModeY === "center" ? anchorCenterY
      : anchorModeY === "top" ? start.y : start.y + start.height;

    const bounds = state.image;
    const maxWidth = Math.max(1, anchorModeX === "center"
      ? 2 * Math.min(anchorX - bounds.x, bounds.x + bounds.width - anchorX)
      : anchorModeX === "left" ? bounds.x + bounds.width - anchorX : anchorX - bounds.x);
    const maxHeight = Math.max(1, anchorModeY === "center"
      ? 2 * Math.min(anchorY - bounds.y, bounds.y + bounds.height - anchorY)
      : anchorModeY === "top" ? bounds.y + bounds.height - anchorY : anchorY - bounds.y);

    width = Math.min(width, maxWidth);
    height = Math.min(height, maxHeight);
    if (locked) {
      width = Math.min(width, height * locked, maxWidth);
      height = width / locked;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * locked;
      }
    }

    const x = anchorModeX === "center" ? anchorX - width / 2
      : anchorModeX === "left" ? anchorX : anchorX - width;
    const y = anchorModeY === "center" ? anchorY - height / 2
      : anchorModeY === "top" ? anchorY : anchorY - height;

    state.frame = {
      x: clamp(x, bounds.x, bounds.x + bounds.width - width),
      y: clamp(y, bounds.y, bounds.y + bounds.height - height),
      width,
      height
    };
    this.applyLayout();
    this.markDirty();
  }

  endGesture() {
    const documentRef = this.contentEl.ownerDocument;
    for (const [target, type, handler, capture] of this.listeners) {
      target.removeEventListener(type, handler, capture);
    }
    this.listeners = [];
    if (this.state) this.state.gesture = null;
    this.stage?.removeClass("is-dragging");
  }

  markDirty() {
    const state = this.state;
    if (!state) return;
    state.dirty = !sameResult(this.computeResult(), state.initial);
  }

  computeResult() {
    const state = this.state;
    if (!state?.ready) return { crop: null };
    const { image, frame, natural } = state;
    const region = {
      // Convert the visible frame back into source pixels.
      x: ((frame.x - image.x) / image.width) * natural.width,
      y: ((frame.y - image.y) / image.height) * natural.height,
      width: (frame.width / image.width) * natural.width,
      height: (frame.height / image.height) * natural.height
    };
    // A frame covering the whole picture is not a crop; writing one would add
    // an annotation that changes nothing and shadows later re-routing.
    if (regionCoversImage(region, natural)) return { crop: null };
    const top = regionToTop(region, natural);
    if (!top) return { crop: null };
    const pair = ratioToPair(frame.width / frame.height);
    return { crop: { w: pair.w, h: pair.h, top } };
  }

  save() {
    const state = this.state;
    if (!state?.ready) return;
    const result = this.computeResult();
    this.state.discard = true;
    this.options.onSave?.(result);
    this.close();
  }

  close() {
    const state = this.state;
    if (state?.dirty && !state.discard && !state.confirming) {
      state.confirming = true;
      new DiscardModal(this.app, {
        onDiscard: () => {
          state.discard = true;
          this.close();
        },
        onKeep: () => {
          state.confirming = false;
        }
      }).open();
      return;
    }
    this.endGesture();
    super.close();
  }

  onClose() {
    this.endGesture();
    this.stage?.removeEventListener("wheel", this.onWheel);
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    if (this.layoutTimer !== null) {
      clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
    }
    if (this.layoutRetry !== null) {
      clearTimeout(this.layoutRetry);
      this.layoutRetry = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.loadingEl = null;
    this.errorEl = null;
    this.contentEl.empty();
    this.state = null;
  }
}

class DiscardModal extends Modal {
  constructor(app, { onDiscard, onKeep }) {
    super(app);
    this.onDiscard = onDiscard;
    this.onKeep = onKeep;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("放弃未保存的剪裁？") });
    contentEl.createEl("p", { text: t("关闭后本次调整不会写入笔记。") });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t("继续编辑")).onClick(() => {
        this.onKeep?.();
        this.close();
      }))
      .addButton((button) => button.setButtonText(t("放弃更改")).setWarning().onClick(() => {
        this.close();
        this.onDiscard?.();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

function sameResult(current, initial) {
  const a = current?.crop;
  const b = initial?.crop;
  if (!a || !b) return !a && !b;
  if (a.w !== b.w || a.h !== b.h) return false;
  if (!a.top || !b.top) return a.top === b.top;
  return Math.abs(a.top.x1 - b.top.x1) < 0.05
    && Math.abs(a.top.x2 - b.top.x2) < 0.05
    && Math.abs(a.top.y - b.top.y) < 0.05;
}

function snapRatio(value) {
  for (const candidate of SNAP_RATIOS) {
    if (Math.abs(value - candidate) < SNAP_TOLERANCE) return candidate;
  }
  return null;
}

function parseRatio(value) {
  const [width, height] = String(value).split(":").map(Number);
  return width > 0 && height > 0 ? width / height : null;
}

/** Preset option whose ratio matches `ratio`, or null when none is close. */
function ratioOptionFor(ratio) {
  const value = Number(ratio);
  if (!(value > 0)) return null;
  for (const [option] of RATIO_OPTIONS) {
    const candidate = parseRatio(option);
    if (candidate && Math.abs(candidate / value - 1) < 0.01) return option;
  }
  return null;
}

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

const CROP_STYLES = `
.ag-crop-modal { width: min(880px, 92vw); }
.ag-crop-hint { color: var(--text-muted); margin-top: -6px; }
.ag-crop-file { margin-inline-start: 8px; font-size: 0.7em; font-weight: 400; color: var(--text-muted); }
.ag-crop-loading { color: var(--text-muted); margin: 0 0 8px; }
.ag-crop-stage {
  position: relative; width: 100%;
  height: clamp(${STAGE_MIN_HEIGHT}px, calc(88vh - ${STAGE_CHROME_HEIGHT}px), ${STAGE_MAX_HEIGHT}px);
  overflow: hidden; border-radius: 8px; background: var(--background-secondary);
  touch-action: none; cursor: grab;
}
.ag-crop-stage.is-dragging { cursor: grabbing; }
.ag-crop-image { position: absolute; max-width: none; pointer-events: none; user-select: none; }
.ag-crop-frame {
  position: absolute; border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.ag-crop-handle { position: absolute; width: 12px; height: 12px; background: #fff; border-radius: 2px; pointer-events: auto; }
.ag-crop-handle-nw { left: -6px; top: -6px; cursor: nwse-resize; }
.ag-crop-handle-n { left: 50%; top: -6px; margin-left: -6px; cursor: ns-resize; }
.ag-crop-handle-ne { right: -6px; top: -6px; cursor: nesw-resize; }
.ag-crop-handle-e { right: -6px; top: 50%; margin-top: -6px; cursor: ew-resize; }
.ag-crop-handle-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.ag-crop-handle-s { left: 50%; bottom: -6px; margin-left: -6px; cursor: ns-resize; }
.ag-crop-handle-sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
.ag-crop-handle-w { left: -6px; top: 50%; margin-top: -6px; cursor: ew-resize; }
.ag-crop-error { color: var(--text-error); }
`;
