(async () => {
  const wait = (frame = 3) => new Promise((resolve) => {
    let left = frame;
    const step = () => (left -= 1) <= 0 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  });
  const ws = app.workspace;
  // One markdown leaf only, in reading view.
  const leaves = [];
  ws.iterateAllLeaves((leaf) => leaves.push(leaf));
  let keep = leaves.find((leaf) => leaf.view?.getViewType?.() === "markdown") ?? null;
  for (const leaf of leaves) {
    if (leaf === keep) continue;
    try { leaf.detach(); } catch (e) { /* sidebar leaves */ }
  }
  const file = app.vault.getAbstractFileByPath("README.md");
  if (!keep) keep = ws.getLeaf(false);
  if (file) {
    await keep.openFile(file);
    const state = keep.getViewState();
    state.state = state.state ?? {};
    state.state.mode = "preview";
    await keep.setViewState(state);
  }
  await wait();
  try { ws.leftSplit?.collapse?.(); } catch (e) {}
  try { ws.rightSplit?.collapse?.(); } catch (e) {}
  await wait();

  // Drop history entries whose file no longer exists (renamed notes, temp
  // frames). `lastOpenFiles` is a recency list, not a reference, but a stale
  // entry makes the next launch report a missing file.
  let before = 0;
  let after = 0;
  try {
    const current = Array.isArray(ws.lastOpenFiles) ? ws.lastOpenFiles : [];
    before = current.length;
    const kept = current.filter((path) => app.vault.getAbstractFileByPath(path));
    ws.lastOpenFiles = kept;
    after = kept.length;
  } catch (e) {
    return `lastOpenFiles 不可写：${e.message}`;
  }

  if (typeof ws.requestSaveLayout === "function") ws.requestSaveLayout();
  else if (typeof ws.saveLayout === "function") ws.saveLayout();
  await wait(6);
  return JSON.stringify({
    file: ws.getActiveFile()?.path ?? null,
    mode: ws.activeLeaf?.view?.getMode?.() ?? null,
    left: Boolean(ws.leftSplit?.collapsed),
    right: Boolean(ws.rightSplit?.collapsed),
    historyBefore: before,
    historyAfter: after
  });
})()
