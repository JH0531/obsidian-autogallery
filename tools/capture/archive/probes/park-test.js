(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath("ag-test-boundary.md"));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2000);
  if (leaf.view.getMode?.() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800); }
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  for (let y = 0; y <= pv.scrollHeight; y += 250) {
    pv.scrollTop = y;
    await sleep(140);
    const h = [...pv.querySelectorAll(".el-h2")].find((x) => x.textContent.includes("表格后再起"));
    if (h) { pv.scrollTop = y + (h.getBoundingClientRect().top - pv.getBoundingClientRect().top) - 30; await sleep(600); return "ok"; }
  }
  return "no heading";
})()
