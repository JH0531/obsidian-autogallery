(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = globalThis.__AG_ARGS__;
  const args = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  const path = args.note ?? "08-浮动与绕排.md";
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath(path));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2200);
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(2000); }
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  pv().scrollTop = Math.round((pv().scrollHeight - pv().clientHeight) * 0.55);
  await sleep(1400);
  const rows = [{ step: "start", scroll: Math.round(pv().scrollTop) }];
  for (let i = 0; i < 4; i++) {
    app.commands.executeCommandById("markdown:toggle-preview");
    await sleep(1600);
    const line = leaf.view.currentMode?.getScroll?.();
    rows.push({ step: "src" + i, line: Number.isFinite(line) ? Math.round(line) : String(line) });
    app.commands.executeCommandById("markdown:toggle-preview");
    await sleep(1500);
    rows.push({ step: "back" + i, scroll: Math.round(pv().scrollTop) });
  }
  return JSON.stringify({ note: path, rows }, null, 1);
})()
