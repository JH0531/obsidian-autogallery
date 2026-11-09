(async () => {
  // Capture a timed frame sequence by polling webContents.capturePage.
  // Args: { id, durationMs, fps, note, anchor }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const args = typeof globalThis.__AG_ARGS__ === "string" ? JSON.parse(globalThis.__AG_ARGS__) : {};
  const { id, note } = args;
  const durationMs = Number(args.durationMs ?? 5000);
  const fps = Number(args.fps ?? 10);
  if (!id || !note) return "missing args";

  const file = app.vault.getAbstractFileByPath(note);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const state = leaf.getViewState();
  state.state = state.state ?? {};
  state.state.mode = "preview";
  await leaf.setViewState(state);
  await sleep(900);
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
  if (args.anchor && view) {
    let heading = null;
    for (let y = 0; !heading && y <= view.scrollHeight; y += 400) {
      view.scrollTop = y;
      await sleep(70);
      heading = [...container.querySelectorAll("h2,h3,h4,h5,h6")]
        .find((el) => el.textContent.trim().includes(args.anchor));
    }
    if (heading) {
      heading.scrollIntoView({ block: "start" });
      await sleep(300);
      const delta = heading.getBoundingClientRect().top - view.getBoundingClientRect().top;
      view.scrollTop += delta;
      await sleep(250);
    }
  }

  const ew = window.electronWindow;
  if (!ew?.webContents?.capturePage) return "no capturePage";
  const dir = `.cache/frames/${id}`;
  try { await app.vault.adapter.mkdir(dir); } catch (e) {}
  // Fresh directory: drop frames from an earlier run.
  try {
    const existing = await app.vault.adapter.list(dir);
    for (const child of existing.files ?? []) await app.vault.adapter.remove(child);
  } catch (e) {}

  const interval = 1000 / fps;
  const stamps = [];
  const started = performance.now();
  let index = 0;
  while (true) {
    const image = await ew.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 800 });
    const buffer = image.toPNG();
    await app.vault.adapter.writeBinary(`${dir}/f${String(index).padStart(4, "0")}.png`, buffer);
    stamps.push(Math.round(performance.now() - started));
    index += 1;
    if (performance.now() - started >= durationMs) break;
    const wait = interval - ((performance.now() - started) % interval);
    if (wait > 0) await sleep(wait);
  }
  await app.vault.adapter.write(`${dir}/meta.json`, JSON.stringify({ id, fps, frames: index, stamps }));
  if (!ui.recording) document.body.classList.remove("ag-recording");
  if (!ui.left) { try { ws.leftSplit?.expand?.(); } catch (e) {} }
  if (!ui.right) { try { ws.rightSplit?.expand?.(); } catch (e) {} }
  return JSON.stringify(, durationMs: stamps[stamps.length - 1], dir });
})()
