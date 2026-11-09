export function resolveRoute(frontmatter, routes = []) {
  for (const route of routes) {
    if (route.enabled === false) continue;
    if (!route.key?.trim() || !route.value?.trim()) continue;
    const actual = frontmatter?.[route.key];
    if (actual !== undefined && actual !== null && String(actual).trim() === route.value) {
      return route.profile;
    }
  }
  return "auto";
}

export function resolveRunMode(images, profile = "auto") {
  const explicitModes = images
    .map((image) => image.annotation.params.layout)
    .filter((mode) => mode && mode !== "auto");

  if (explicitModes.length) {
    if (explicitModes.every((mode) => mode === "gallery")) return "gallery";
    if (explicitModes.every((mode) => mode === "center")) return "center";
    return "individual";
  }

  if (images.some(({ annotation }) => annotation.params.width || annotation.params.side)) {
    return "individual";
  }

  // Legacy mode values are accepted for old callers, but current profiles
  // deliberately do not select a rendering mode: auto performs structural routing.
  const mode = typeof profile === "object" ? profile.mode : profile;
  if (mode === "gallery") return images.length > 1 ? "gallery" : "individual";
  if (mode === "center") return "center";
  if (mode === "float" || mode === "individual" || mode === "question") return "individual";
  return images.length > 1 ? "gallery" : "individual";
}
