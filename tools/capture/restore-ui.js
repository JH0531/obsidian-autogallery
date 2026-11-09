(async () => {
  // Leave recording mode: show the normal Obsidian chrome again, open the MOC
  // in reading view and put an outline next to it.
  const wait = (frame = 3) => new Promise((resolve) => {
    let left = frame;
    const step = () => (left -= 1) <= 0 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  });
  const ws = app.workspace;
  document.body.classList.remove("ag-recording");

  try { ws.leftSplit?.expand?.(); } catch (e) {}
  try { ws.rightSplit?.expand?.(); } catch (e) {}

  const file = app.vault.getAbstractFileByPath("README.md");
  if (file) {
    const leaf = ws.getLeaf(false);
    await leaf.openFile(file);
    const state = leaf.getViewState();
    state.state = state.state ?? {};
    state.state.mode = "preview";
    await leaf.setViewState(state);
  }

  try {
    if ((ws.leftSplit?.children?.length ?? 0) === 0) {
      await ws.getLeftLeaf(false).setViewState({ type: "file-explorer" });
    }
  } catch (e) {}
  try {
    await ws.getRightLeaf(false).setViewState({ type: "outline" });
    await ws.getRightLeaf(false).setViewState({ type: "backlink" });
  } catch (e) {}

  await wait(4);
  if (typeof ws.requestSaveLayout === "function") ws.requestSaveLayout();
  return JSON.stringify({
    recording: document.body.classList.contains("ag-recording"),
    left: !ws.leftSplit?.collapsed,
    right: !ws.rightSplit?.collapsed,
    file: ws.getActiveFile()?.path ?? null,
    tabHeader: Boolean(document.querySelector(".workspace-tab-header-container")?.offsetHeight),
    statusBar: Boolean(document.querySelector(".status-bar")?.offsetHeight)
  });
})()
