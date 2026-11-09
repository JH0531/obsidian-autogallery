(async () => {
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode?.() === "source");
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const rows = lines.slice(idx, idx + 4).map((l) => ({
    text: l.textContent.trim().slice(0, 10),
    cls: String(l.className),
    inline: l.getAttribute("style")
  }));
  return JSON.stringify(rows, null, 1);
})()
