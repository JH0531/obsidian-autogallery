(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = globalThis.__AG_ARGS__;
  const args = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  const note = args.note ?? "12-嵌套作用域.md";
  const heading = args.heading ?? "列表：同项可并排，绝不跨项";
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode) ?? app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath(note));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(1800);
  if (leaf.view.getMode() !== "source") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800); }
  const lines = leaf.view.editor.getValue().split("\n");
  const line = lines.findIndex((l) => l.includes(heading.slice(0, 6)));
  leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, false);
  await sleep(900);
  return `${leaf.view.getMode()} line ${line + 1} scroll ${Math.round(leaf.view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? -1)}`;
})()
