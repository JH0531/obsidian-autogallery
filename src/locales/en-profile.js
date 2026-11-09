// English map for profile-io.js and profile-rules.js. Key = the Chinese source
// string (verbatim); value = English. Keys not present here fall back to the
// raw Chinese in English mode.
export default {
  // --- profile-io.js (parseProfileModule) ---
  "外挂配置必须导出 profile 对象或对象数组": "External profile must export a profile object or an array of objects",
  "外挂配置不是有效的 JavaScript 对象或数组": "External profile is not a valid JavaScript object or array",
  "外挂配置不包含任何模板": "External profile contains no templates",
  "第 {n} 个模板无效：{message}": "Template {n} is invalid: {message}",

  // --- profile-rules.js (validateProfile) ---
  "外挂配置必须是 profile 对象或对象数组": "External profile must be a profile object or an array of objects",
  "外挂配置缺少有效的 id": "External profile is missing a valid id",
  "外挂配置缺少有效的 name": "External profile is missing a valid name",
  "floatAlignment 必须是 alternate、left 或 right": "floatAlignment must be alternate, left, or right",
  "rules 必须是 auto 或规则数组": "rules must be 'auto' or an array of rules",
  "rules 中包含无效的 ratioRange、width 或布局值": "rules contains an invalid ratioRange, width, or layout value"
};
