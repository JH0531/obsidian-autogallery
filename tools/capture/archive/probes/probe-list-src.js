(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode) ?? app.workspace.getLeaf(false);
  if (leaf.view.getMode() !== "source") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1600); }
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const cells = [lines[idx + 1], lines[idx + 2]].map((l) => {
    const e = l.querySelector(".image-embed, .internal-embed");
    const r = e.getBoundingClientRect();
    const lr = l.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left - lr.left), top: Math.round(r.top - lr.top), lineH: Math.round(lr.height), pad: getComputedStyle(l).paddingInlineStart };
  });
  return JSON.stringify({ cells, lineW: Math.round(lines[idx + 1].getBoundingClientRect().width) }, null, 1);
})()
