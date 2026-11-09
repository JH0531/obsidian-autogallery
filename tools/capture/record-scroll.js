(async () => {
  // Record a composed page as one continuous scroll. The result is the hero /
  // poster asset: the reader sees the plugin's complete effect in context,
  // instead of a before/after comparison.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = "AG-V00-01";
  const note = "00-效果总览.md";
  const durationMs = 7600;
  const targetOffset = 0; // 0 = start at the very top

  const file = app.vault.getAbstractFileByPath(note);
  if (!file) return `missing note ${note}`;
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const state = leaf.getViewState();
  state.state = state.state ?? {};
  state.state.mode = "preview";
  await leaf.setViewState(state);
  await sleep(1200);
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


  const container = leaf.view.containerEl;
  const view = container.querySelector(".markdown-preview-view");
  view.scrollTop = targetOffset;
  await sleep(600);

  const start = view.scrollTop;
  // The document grows while images decode; recompute the end every frame so
  // the animation does not reach the bottom early and sit still.
  const distance = () => Math.max(0, view.scrollHeight - view.clientHeight - start);

  const ew = window.electronWindow;
  if (!ew?.webContents?.capturePage) return "no capturePage";
  const dir = `.cache/frames/${id}`;
  try { await app.vault.adapter.mkdir(dir); } catch (e) {}
  try {
    const existing = await app.vault.adapter.list(dir);
    for (const child of existing.files ?? []) await app.vault.adapter.remove(child);
  } catch (e) {}

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const stamps = [];
  const started = performance.now();
  let index = 0;
  // 250ms of stillness at both ends so the loop does not start mid-motion.
  const hold = 250;
  while (true) {
    const elapsed = performance.now() - started;
    const t = Math.max(0, Math.min(1, (elapsed - hold) / durationMs));
    view.scrollTop = Math.round(start + distance() * ease(t));
    await sleep(60);
    const image = await ew.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 800 });
    await app.vault.adapter.writeBinary(`${dir}/f${String(index).padStart(4, "0")}.png`, image.toPNG());
    stamps.push(Math.round(performance.now() - started));
    index += 1;
    if (t >= 1 && elapsed > durationMs + hold * 2) break;
    if (index > 300) break;
  }
  // capturePage is slower than the nominal rate; record the real one so the
  // encoder does not play the scroll at double speed.
  const realFps = index > 1 ? (index - 1) / ((stamps.at(-1) - stamps[0]) / 1000) : 10;
  await app.vault.adapter.write(`${dir}/meta.json`, JSON.stringify({ id, fps: Number(realFps.toFixed(2)), frames: index, stamps, distance: distance() }));
  if (!ui.recording) document.body.classList.remove("ag-recording");
  if (!ui.left) { try { ws.leftSplit?.expand?.(); } catch (e) {} }
  if (!ui.right) { try { ws.rightSplit?.expand?.(); } catch (e) {} }
  return JSON.stringify(, distance: distance(), durationMs: stamps.at(-1) });
})()
