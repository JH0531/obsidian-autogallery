// Chinese overrides for the few ASCII keys whose Chinese form differs from the
// raw key. Every other string uses the Chinese text as its own key, so it needs
// no entry here (t() falls back to the key itself in zh mode).
export default {
  // The language setting label: bilingual in Chinese so it stays findable
  // regardless of the user's literacy, but collapses to the plain target
  // language once another language is active.
  "settings.language": "语言 / Language",
  // ASCII-keyed confirm buttons (fall back to the key in zh mode if absent).
  "confirm.cancel": "取消",
  "confirm.ok": "确认"
};
