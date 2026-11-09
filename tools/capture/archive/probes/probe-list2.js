(async () => {
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode?.() === "source");
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const out = lines.slice(Math.max(0, idx - 1), idx + 5).map((l) => {
    const r = l.getBoundingClientRect();
    const cs = getComputedStyle(l);
    return {
      text: l.textContent.trim().slice(0, 16),
      cls: String(l.className).replace(/cm-line\s*/, "").slice(0, 44),
      left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
      pad: cs.paddingInlineStart, indent: cs.textIndent,
      inline: (l.getAttribute("style") || "").slice(0, 100)
    };
  });
  return JSON.stringify({ idx, out }, null, 1);
})()
