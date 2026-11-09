(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const note = "12-嵌套作用域.md";
  await app.plugins.disablePlugin("obsidian-autogallery");
  await sleep(1200);
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode) ?? app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath(note));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(1600);
  if (leaf.view.getMode() !== "source") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1600); }
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const rows = lines.slice(Math.max(0, idx - 1), idx + 4).map((l) => {
    const cs = getComputedStyle(l);
    return { text: l.textContent.trim().slice(0, 14), cls: String(l.className).slice(0, 30), pad: cs.paddingInlineStart, indent: cs.textIndent };
  });
  await app.plugins.enablePlugin("obsidian-autogallery");
  await sleep(800);
  return JSON.stringify({ plugin: "off", rows }, null, 1);
})()
