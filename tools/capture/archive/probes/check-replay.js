(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath("17-PDF导出.md"));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2200);
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(2000); }
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  globalThis.__agReplay = [];
  pv().scrollTop = 632;
  await sleep(1200);
  const before = { scroll: Math.round(pv().scrollTop), line: leaf.view.previewMode.renderer.getScroll() };
  app.commands.executeCommandById("markdown:toggle-preview");
  await sleep(1600);
  app.commands.executeCommandById("markdown:toggle-preview");
  await sleep(1500);
  return JSON.stringify({ before, after: Math.round(pv().scrollTop), replay: globalThis.__agReplay }, null, 1);
})()
