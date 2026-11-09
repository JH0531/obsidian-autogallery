(async () => {
  // AG-A01-01: same note, plugin off → on. Fully scriptable, so it doubles as
  // the end-to-end smoke test for the motion pipeline.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Fixed target: this recording is a pipeline smoke test, not a parameterised
  // shot, so it must not pick up a stale .ag-args.json from another tool.
  const id = "AG-A01-01";
  const note = "01-从原生排版到画廊.md";
  const fps = 10;
  const holdFrames = 9; // ~1.2s per state; the whole loop must stay under 6s

  const file = app.vault.getAbstractFileByPath(note);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const state = leaf.getViewState();
  state.state = state.state ?? {};
  state.state.mode = "preview";
  await leaf.setViewState(state);
  await sleep(1000);
  // Recording mode: hide chrome and collapse sidebars only while capturing,
  // then put the workspace back exactly as it was.
  const ws = app.workspace;
  const ui = {
    recording: document.body.classList.contains("ag-recording"),
    left: Boolean(ws.leftSplit?.collapsed),
    right: Boolean(ws.rightSplit?.collapsed)
  };
  document.body.classList.add("ag-recording");
  try { ws.leftSplit?.collapse?.(); } catch (e) {}
  try { ws.rightSplit?.collapse?.(); } catch (e) {}
  await sleep(260);


  const ew = window.electronWindow;
  if (!ew?.webContents?.capturePage) return "no capturePage";
  const dir = `.cache/frames/${id}`;
  try { await app.vault.adapter.mkdir(dir); } catch (e) {}
  try {
    const existing = await app.vault.adapter.list(dir);
    for (const child of existing.files ?? []) await app.vault.adapter.remove(child);
  } catch (e) {}

  let index = 0;
  const stamps = [];
  const started = performance.now();
  const shoot = async () => {
    const image = await ew.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 800 });
    await app.vault.adapter.writeBinary(`${dir}/f${String(index).padStart(4, "0")}.png`, image.toPNG());
    stamps.push(Math.round(performance.now() - started));
    index += 1;
    await sleep(60);
  };

  for (let i = 0; i < holdFrames; i += 1) await shoot();          // enabled
  await app.plugins.disablePlugin("obsidian-autogallery");
  await sleep(400);
  for (let i = 0; i < holdFrames; i += 1) await shoot();          // disabled
  await app.plugins.enablePlugin("obsidian-autogallery");
  await sleep(1200);
  for (let i = 0; i < holdFrames; i += 1) await shoot();          // enabled again

  await app.vault.adapter.write(`${dir}/meta.json`, JSON.stringify({ id, fps, frames: index, stamps }));
  if (!ui.recording) document.body.classList.remove("ag-recording");
  if (!ui.left) { try { ws.leftSplit?.expand?.(); } catch (e) {} }
  if (!ui.right) { try { ws.rightSplit?.expand?.(); } catch (e) {} }
  return JSON.stringify(, durationMs: stamps[stamps.length - 1] });
})()
