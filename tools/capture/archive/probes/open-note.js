(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = globalThis.__AG_ARGS__;
  const args = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  const p = args.note ?? "03-分组规则.md";
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath(p));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2200);
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(2000); }
  return leaf.view.file?.path;
})()
