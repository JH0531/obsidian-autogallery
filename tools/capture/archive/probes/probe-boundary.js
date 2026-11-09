(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = globalThis.__AG_ARGS__;
  const args = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  const note = args.note ?? "ag-test-boundary.md";
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath(note));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2000);
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800); }
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  const sizer = pv.querySelector(".markdown-preview-sizer");
  for (let y = 0; y <= pv.scrollHeight; y += Math.round(pv.clientHeight * 0.7)) { pv.scrollTop = y; await sleep(140); }
  pv.scrollTop = 0;
  await sleep(600);
  const box = pv.getBoundingClientRect();
  const rows = [];
  let heading = "";
  for (const el of sizer.children) {
    const cls = String(el.className);
    if (/el-h2/.test(cls)) heading = el.textContent.trim().slice(0, 14);
    if (!/el-p|el-table|el-blockquote|el-pre|el-h2|el-ul|el-ol/.test(cls)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.float === "none" && !/el-h2/.test(cls) && el.textContent.trim() === "" && !el.querySelector("img")) continue;
    rows.push({
      h: heading,
      cls: cls.split(/\s+/).find((c) => /^el-/.test(c)) ?? cls.slice(0, 12),
      float: cs.float, clear: cs.clear,
      top: Math.round(r.top - box.top), left: Math.round(r.left - box.left),
      w: Math.round(r.width), h2: Math.round(r.height),
      text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 14)
    });
  }
  return JSON.stringify(rows, null, 0);
})()
