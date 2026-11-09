import { normalizeProfileRules } from "./profile-rules.js";
import config from "./config.json";
import { MARGIN_PRESETS } from "./print-geometry.js";
import { LANGS, FOLLOW } from "./i18n.js";

export const DEFAULT_PROFILES = Object.freeze([{ id: "auto", name: "auto", floatAlignment: "alternate", rules: "auto" }]);

export const DEFAULT_SETTINGS = Object.freeze({
  galleryGap: 12,
  galleryMinHeight: 100,
  // Ceiling for the row-height bar. It only constrains the gesture: automatic
  // packing still follows the ratios, because clamping it there would leave the
  // row narrower than the column.
  galleryMaxHeight: 600,
  // A lone cell that would fill more than this many pixels leaves the grid and
  // takes the centred single-image layout. 0 disables the rule.
  galleryOrphanMaxHeight: config.gallery.orphanMaxHeight,
  galleryMaxPerRow: 5,
  galleryControl: "both",
  captionGap: 6,
  textGap: 16,
  mobileBreakpoint: 600,
  maxImagesPerRow: 5,
  imageBottomGap: 0,
  resizeEnabled: true,
  alignButtonsEnabled: true,
  cropRatioPreset: "free",
  language: FOLLOW,
  floatMax: Math.round(config.widthRatio.floatMax * 100),
  // Whether the *prose* around floats may fill space an earlier picture left
  // free. `ordered` binds each float to the prose that follows it in the
  // source, so a later paragraph cannot move up into the empty half-column left
  // by an earlier picture. `share` is the old behaviour: prose fills whatever
  // space is free. It never moves the pictures themselves — two floats stack or
  // share a band according to `floatBreaks.image`, because a left and a right
  // picture on one row would squeeze the text between them into a strip.
  floatSpaceMode: "ordered",
  widthControl: { gain: 50, medianRatio: 1.5 },
  floatBreaks: { heading: true, code: true, math: true, image: true, table: true, quote: true },
  profiles: DEFAULT_PROFILES,
  routes: [],
  externalProfilePath: "",
  pdfExportEnabled: true,
  pdfExport: {
    pageSize: "inherit",
    orientation: "inherit",
    marginMode: "inherit",
    marginPreset: "narrow",
    mirrorMargins: false,
    innerMarginMm: 20,
    outerMarginMm: 12,
    marginMm: { top: 12, right: 12, bottom: 12, left: 12 },
    scalePercent: "inherit",
    includeTitle: false,
    openAfterExport: false,
    previewMode: "layout",
    pageNumber: { enabled: true, band: "footer", align: "center" },
    timeoutMs: 60000
  },
  pdfPagination: {
    headingBreakEnabled: false,
    headingBreakLevel: 1,
    imageOptimizationEnabled: true,
    imageShrinkPriority: "image",
    singleImageMaxShrink: config.pdfPagination.singleImageMaxShrink,
    lineHeightMaxShrink: config.pdfPagination.lineHeightMaxShrink,
    orphanControlEnabled: true,
    orphanMaxLines: 2
  }
});

export function normalizeSettings(value = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...value };
  settings.language = [FOLLOW, ...LANGS].includes(settings.language) ? settings.language : FOLLOW;
  settings.galleryMaxPerRow = clampInteger(settings.galleryMaxPerRow ?? settings.maxImagesPerRow, 2, 15, DEFAULT_SETTINGS.galleryMaxPerRow);
  settings.maxImagesPerRow = settings.galleryMaxPerRow;
  settings.galleryControl = ["both", "count", "height"].includes(settings.galleryControl) ? settings.galleryControl : DEFAULT_SETTINGS.galleryControl;
  settings.galleryGap = clampNumber(settings.galleryGap, 0, 80, DEFAULT_SETTINGS.galleryGap);
  settings.galleryMinHeight = clampNumber(settings.galleryMinHeight, 0, 200, DEFAULT_SETTINGS.galleryMinHeight);
  settings.galleryMaxHeight = clampNumber(settings.galleryMaxHeight, 120, 1200, DEFAULT_SETTINGS.galleryMaxHeight);
  settings.galleryOrphanMaxHeight = clampInteger(settings.galleryOrphanMaxHeight, 0, 1200, DEFAULT_SETTINGS.galleryOrphanMaxHeight);
  settings.captionGap = clampNumber(settings.captionGap, 0, 48, DEFAULT_SETTINGS.captionGap);
  settings.textGap = clampNumber(settings.textGap, 0, 80, DEFAULT_SETTINGS.textGap);
  settings.mobileBreakpoint = clampNumber(settings.mobileBreakpoint, 320, 1200, DEFAULT_SETTINGS.mobileBreakpoint);
  settings.imageBottomGap = clampNumber(settings.imageBottomGap, 0, 80, DEFAULT_SETTINGS.imageBottomGap);
  settings.floatMax = clampInteger(settings.floatMax, 0, 100, DEFAULT_SETTINGS.floatMax);
  settings.floatSpaceMode = settings.floatSpaceMode === "share" ? "share" : "ordered";
  // The global cover/contain switch is gone: `object-fit` is derived from the
  // crop itself, so a stored `imageFit` has no reader left on disk.
  delete settings.imageFit;
  settings.resizeEnabled = settings.resizeEnabled !== false;
  settings.alignButtonsEnabled = settings.alignButtonsEnabled !== false;
  settings.cropRatioPreset = typeof settings.cropRatioPreset === "string" ? settings.cropRatioPreset : "free";
  settings.pdfExportEnabled = settings.pdfExportEnabled === true;
  settings.pdfExport = normalizePdfExport(settings.pdfExport);
  settings.pdfPagination = normalizePdfPagination(settings.pdfPagination);
  settings.widthControl = {
    gain: clampInteger(settings.widthControl?.gain, 0, 100, 50),
    medianRatio: clampNumber(settings.widthControl?.medianRatio, 0.2, 5, 1.5)
  };
  settings.floatBreaks = normalizeFloatBreaks(settings.floatBreaks);
  settings.profiles = normalizeProfiles(settings.profiles);
  settings.routes = normalizeRoutes(settings.routes, settings.profiles);
  return settings;
}

function normalizePdfPagination(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    headingBreakEnabled: source.headingBreakEnabled === true,
    headingBreakLevel: clampInteger(source.headingBreakLevel, 1, 6, DEFAULT_SETTINGS.pdfPagination.headingBreakLevel),
    imageOptimizationEnabled: source.imageOptimizationEnabled !== false,
    imageShrinkPriority: source.imageShrinkPriority === "line" ? "line" : "image",
    singleImageMaxShrink: clampNumber(source.singleImageMaxShrink, 0, 0.5, DEFAULT_SETTINGS.pdfPagination.singleImageMaxShrink),
    lineHeightMaxShrink: clampNumber(source.lineHeightMaxShrink, 0, 0.2, DEFAULT_SETTINGS.pdfPagination.lineHeightMaxShrink),
    orphanControlEnabled: source.orphanControlEnabled !== false,
    orphanMaxLines: clampInteger(source.orphanMaxLines, 1, 5, 2)
  };
}

function normalizePdfExport(value) {
  const source = value && typeof value === "object" ? value : {};
  const sizes = new Set(["inherit", "A3", "A4", "A5", "Legal", "Letter", "Tabloid"]);
  const mm = source.marginMm && typeof source.marginMm === "object" ? source.marginMm : {};
  const scale = Number(source.scalePercent);
  return {
    pageSize: sizes.has(source.pageSize) ? source.pageSize : DEFAULT_SETTINGS.pdfExport.pageSize,
    orientation: ["inherit", "portrait", "landscape"].includes(source.orientation) ? source.orientation : "inherit",
    marginMode: ["inherit", "preset", "custom"].includes(source.marginMode) ? source.marginMode : "inherit",
    // `default` was the pre-preset name for Chromium's 1 cm box; anything the
    // table no longer knows lands on the closest preset instead of jumping to
    // Word's 2.54 cm "normal".
    marginPreset: Object.hasOwn(MARGIN_PRESETS, source.marginPreset) ? source.marginPreset : "narrow",
    mirrorMargins: source.mirrorMargins === true,
    innerMarginMm: clampNumber(source.innerMarginMm, 0, 60, DEFAULT_SETTINGS.pdfExport.innerMarginMm),
    outerMarginMm: clampNumber(source.outerMarginMm, 0, 80, DEFAULT_SETTINGS.pdfExport.outerMarginMm),
    marginMm: {
      top: clampNumber(mm.top, 0, 50, 12),
      right: clampNumber(mm.right, 0, 50, 12),
      bottom: clampNumber(mm.bottom, 0, 50, 12),
      left: clampNumber(mm.left, 0, 50, 12)
    },
    scalePercent: Number.isFinite(scale) && scale >= 10 && scale <= 200 ? Math.round(scale) : DEFAULT_SETTINGS.pdfExport.scalePercent,
    includeTitle: source.includeTitle === true,
    openAfterExport: source.openAfterExport === true,
    // `layout` is the cheap continuous preview; `pages` prints a real PDF on
    // open, which is only worth it when the reader asked for it.
    previewMode: source.previewMode === "pages" ? "pages" : "layout",
    pageNumber: normalizePageNumber(source.pageNumber),
    timeoutMs: clampInteger(source.timeoutMs, 5000, 180000, 60000)
  };
}

/**
 * Page numbers are on by default: the export is meant to read as a finished
 * document. Only `false` turns them off, so a missing key keeps them.
 */
function normalizePageNumber(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled !== false,
    band: source.band === "header" ? "header" : "footer",
    align: ["left", "center", "right"].includes(source.align) ? source.align : "center"
  };
}

function normalizeFloatBreaks(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    heading: source.heading !== false,
    code: source.code !== false,
    math: source.math !== false,
    image: source.image !== false,
    table: source.table !== false,
    quote: source.quote !== false
  };
}

function normalizeProfiles(profiles) {
  const source = Array.isArray(profiles) ? profiles : DEFAULT_PROFILES;
  const legacyBuiltIns = new Set(["card", "question", "gallery", "float", "center"]);
  const normalized = source
    .filter((profile) => profile && typeof profile.id === "string" && typeof profile.name === "string")
    .map((profile) => {
      const id = profile.id.trim();
      const normalized = {
        id,
        // The built-in `auto` template keeps its canonical name; only its
        // float alignment stays user-editable.
        name: id === "auto" ? DEFAULT_PROFILES[0].name : profile.name.trim(),
        floatAlignment: ["alternate", "left", "right"].includes(profile.floatAlignment)
          ? profile.floatAlignment
          : profile.side === "right" ? "right" : "alternate"
      };
      normalized.rules = normalizeProfileRules(profile.rules ?? profile.mode ?? "auto");
      if (Array.isArray(normalized.rules) && normalized.rules.length === 0) normalized.rules = "auto";
      return normalized;
    })
    .filter((profile) => profile.id && profile.name && !legacyBuiltIns.has(profile.id));

  if (!normalized.some((profile) => profile.id === "auto")) {
    normalized.unshift({ ...DEFAULT_PROFILES[0] });
  }
  return normalized;
}

function normalizeRoutes(routes, profiles) {
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const source = Array.isArray(routes) ? routes : [];
  const normalized = source
    .filter((route) => route && typeof route.key === "string" && typeof route.value === "string")
    .filter((route) => route.key.trim() || route.value.trim())
    .map((route, index) => ({
      id: typeof route.id === "string" ? route.id : `route-${index + 1}`,
      key: route.key.trim(),
      value: route.value.trim(),
      profile: profileIds.has(route.profile) ? route.profile : "auto",
      enabled: route.enabled !== false
    }));
  // Keep one editable row available in the settings UI, while removing
  // duplicate empty rows left by older versions.
  return normalized.length ? normalized : [{ id: "route-1", key: "", value: "", profile: "auto", enabled: true }];
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}
