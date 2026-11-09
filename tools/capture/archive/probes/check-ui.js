(async () => {
  const ew = window.electronWindow;
  const image = await ew.webContents.capturePage();
  await app.vault.adapter.writeBinary(".tools/out/ui-check.png", image.toPNG());
  const ws = app.workspace;
  const names = [];
  ws.iterateAllLeaves((leaf) => names.push({ type: leaf.view?.getViewType?.(), width: Math.round(leaf.width ?? 0) }));
  return JSON.stringify({
    recording: document.body.classList.contains("ag-recording"),
    left: !ws.leftSplit?.collapsed,
    right: !ws.rightSplit?.collapsed,
    leaves: names,
    size: image.getSize()
  });
})()
