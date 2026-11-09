(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath("ag-test-list.md"));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(1800);
  if (leaf.view.getMode?.() !== "source") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1600); }
  const lines = leaf.view.editor.getValue().split("\n");
  const line = lines.findIndex((l) => l.includes("# 列表变体"));
  leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, false);
  await sleep(900);
  const cells = [...leaf.view.containerEl.querySelectorAll(".cm-line")]
    .filter((l) => l.querySelector(".internal-embed"))
    .map((l) => {
      const e = l.querySelector(".internal-embed");
      const r = e.getBoundingClientRect();
      const lr = l.getBoundingClientRect();
      return { left: Math.round(r.left - lr.left), top: Math.round(r.top - lr.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
  return JSON.stringify(cells);
})()
