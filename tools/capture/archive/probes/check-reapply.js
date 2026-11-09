(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode) ?? app.workspace.getLeaf(false);
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800); }
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  const r = () => leaf.view.previewMode.renderer;
  pv().scrollTop = 632;
  await sleep(1200);
  const l = r().getScroll();
  const before = { scroll: Math.round(pv().scrollTop), line: l };
  r().applyScroll(l);
  await sleep(500);
  const same = { scroll: Math.round(pv().scrollTop), h: Math.round(pv().scrollHeight) };
  // What does a line 4 higher give?
  r().applyScroll(l + 4);
  await sleep(400);
  const plus4 = Math.round(pv().scrollTop);
  r().applyScroll(l);
  await sleep(400);
  return JSON.stringify({ before, afterSameLine: same, plus4, rightAfterPlus4: Math.round(pv().scrollTop) }, null, 1);
})()
