import { t } from "./i18n.js";

const RANGE_PATTERN = /^([[(])\s*((?:\d+(?:\.\d+)?|\.\d+))\s*,\s*((?:\d+(?:\.\d+)?|\.\d+))\s*(\]|\))$/;
const ALLOWED_FUNCTIONS = /Math\.(?:log|abs|min|max|pow|floor|ceil|round)/g;
const VALID_LAYOUTS = new Set(["auto", "float", "fixed", "center"]);
const VALID_ALIGNMENTS = new Set(["alternate", "left", "right"]);

export function parseRatioRange(value) {
  const match = RANGE_PATTERN.exec(String(value ?? "").trim());
  if (!match) return null;
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return { start, end, includeStart: match[1] === "[", includeEnd: match[4] === "]" };
}

export function ratioInRange(ratio, range) {
  if (!range) return false;
  const lower = range.includeStart ? ratio >= range.start : ratio > range.start;
  const upper = range.includeEnd ? ratio <= range.end : ratio < range.end;
  return lower && upper;
}

export function evaluateRuleWidth(value, ratio) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const expression = String(value ?? "").trim();
  const sanitized = expression.replace(ALLOWED_FUNCTIONS, "").replace(/\br\b/gi, "");
  if (!expression || !/^[0-9\s+*/().,_-]+$/.test(sanitized)) return null;
  try {
    const result = Function("r", `"use strict"; return (${expression});`)(ratio);
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function resolveProfileRule(profile, ratio) {
  const rules = profile?.rules;
  if (!Array.isArray(rules) || !Number.isFinite(ratio)) return null;
  for (const source of rules) {
    if (!source || typeof source !== "object") continue;
    const range = parseRatioRange(source.ratioRange);
    if (!ratioInRange(ratio, range)) continue;
    const width = source.width == null ? null : evaluateRuleWidth(source.width, ratio);
    if (source.width != null && (width === null || width <= 0)) continue;
    return {
      width: width === null ? null : Math.min(1, Math.max(0.01, width)),
      layout: source.layout === "fixed" ? "fixed" : source.layout === "center" ? "fixed" : source.layout || "auto",
      // `null` means "not specified": the renderer then falls back to the
      // template-level floatAlignment instead of forcing alternation.
      floatAlignment: VALID_ALIGNMENTS.has(source.floatAlignment) ? source.floatAlignment : null,
      side: source.side === "left" || source.side === "right" ? source.side : "auto"
    };
  }
  return null;
}

export function normalizeProfileRules(rules) {
  if (rules === "auto" || rules === undefined || rules === null) return "auto";
  if (!Array.isArray(rules) || rules.length === 0) return "auto";
  return rules.map((rule) => normalizeProfileRule(rule)).filter(Boolean);
}

export function normalizeProfileRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const range = parseRatioRange(rule.ratioRange);
  if (!range) return null;
  const layout = rule.layout === "fixed" || rule.layout === "center" ? "fixed" : rule.layout;
  if (!VALID_LAYOUTS.has(layout)) return null;
  if (rule.floatAlignment !== undefined && !VALID_ALIGNMENTS.has(rule.floatAlignment)) return null;
  if (rule.side !== undefined && !["auto", "left", "right"].includes(rule.side)) return null;
  if (rule.width !== undefined && evaluateRuleWidth(rule.width, (range.start + range.end) / 2) === null) return null;
  return {
    ratioRange: formatRatioRange(range),
    ...(rule.width === undefined ? {} : { width: typeof rule.width === "number" ? rule.width : String(rule.width).trim() }),
    layout,
    // Keep an omitted alignment omitted: it inherits the template-level
    // value at render time, which is what the settings panel promises.
    ...(rule.floatAlignment === undefined ? {} : { floatAlignment: rule.floatAlignment }),
    side: rule.side ?? "auto"
  };
}

export function validateProfile(profile, { allowMissingId = false } = {}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error(t("外挂配置必须是 profile 对象或对象数组"));
  const id = typeof profile.id === "string" ? profile.id.trim() : "";
  const name = profile.name === undefined ? id : String(profile.name).trim();
  if (!allowMissingId && !id) throw new Error(t("外挂配置缺少有效的 id"));
  if (!name) throw new Error(t("外挂配置缺少有效的 name"));
  if (profile.floatAlignment !== undefined && !VALID_ALIGNMENTS.has(profile.floatAlignment)) throw new Error(t("floatAlignment 必须是 alternate、left 或 right"));
  const rules = profile.rules ?? (profile.mode ?? "auto");
  if (rules !== "auto" && !Array.isArray(rules)) throw new Error(t("rules 必须是 auto 或规则数组"));
  const normalizedRules = normalizeProfileRules(rules);
  if (Array.isArray(rules) && rules.length > 0 && normalizedRules.length !== rules.length) throw new Error(t("rules 中包含无效的 ratioRange、width 或布局值"));
  return { id, name, floatAlignment: profile.floatAlignment ?? "alternate", rules: normalizedRules };
}

function formatRatioRange(range) {
  return `${range.includeStart ? "[" : "("}${range.start},${range.end}${range.includeEnd ? "]" : ")"}`;
}
