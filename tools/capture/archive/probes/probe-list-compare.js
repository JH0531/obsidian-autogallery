(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode) ?? app.workspace.getLeaf(false);
  const out = {};
  // Source mode: the two cells of the first list item.
  if (leaf.view.getMode() !== "source") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1600); }
  let lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  let idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const srcCells = [lines[idx + 1], lines[idx + 2]].map((l) => {
    const e = l.querySelector(".image-embed, .internal-embed");
    const r = e?.getBoundingClientRect();
    const lr = l.getBoundingClientRect();
    return e ? { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left - lr.left), top: Math.round(r.top - lr.top) } : null;
  });
  out.source = { cells: srcCells, lineIndent: getComputedStyle(lines[idx + 1]).paddingInlineStart };
  // Reading view: the same two pictures.
  app.commands.executeCommandById("markdown:toggle-preview");
  await sleep(1800);
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  for (let y = 0; y <= pv.scrollHeight; y += 300) {
    pv.scrollTop = y;
    await sleep(120);
    if ([...pv.querySelectorAll(".el-h2")].some((h) => h.textContent.includes("列表"))) break;
  }
  await sleep(400);
  const heads = [...pv.querySelectorAll(".el-h2")];
  const h = heads.find((x) => x.textContent.includes("列表"));
  pv.scrollTop += h.getBoundingClientRect().top - pv.getBoundingClientRect().top - 20;
  await sleep(600);
  const boxes = [...pv.querySelectorAll(".el-p, .el-li, li")].filter((el) => el.querySelector("img"));
  out.preview = boxes.slice(0, 3).map((el) => {
    const imgs = [...el.querySelectorAll("img")].map((i) => {
      const r = i.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left) };
    });
    return { cls: String(el.className).slice(0, 14), imgs };
  });
  return JSON.stringify(out, null, 1);
})()
