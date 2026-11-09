(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode) ?? app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath("12-嵌套作用域.md"));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(400);
  if (leaf.view.getMode() !== "source") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(600); }
  const sample = () => {
    const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
    const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
    if (idx < 0) return null;
    return [1, 2].map((k) => {
      const l = lines[idx + k];
      if (!l) return null;
      const cs = getComputedStyle(l);
      return { pad: cs.paddingInlineStart, cls: String(l.className).replace(/(^|\s)cm-line\s*/, " ").slice(0, 26) };
    });
  };
  const rows = [];
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    rows.push({ t: i * 150, s: sample() });
  }
  return JSON.stringify(rows, null, 0);
})()
