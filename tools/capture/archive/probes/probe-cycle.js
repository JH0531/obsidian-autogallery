(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  const trap = (e) => errors.push(String(e.message ?? e.reason?.message ?? e).slice(0, 200));
  window.addEventListener("error", trap);
  window.addEventListener("unhandledrejection", trap);

  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath("07-宽度路由.md"));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2200);
  if (leaf.view.getMode?.() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(2000); }
  const snap = (tag) => {
    const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
    const r = leaf.view.previewMode?.renderer;
    return { tag, mode: leaf.view.getMode?.(), kids: pv ? pv.querySelector(".markdown-preview-sizer").children.length : -1, sections: r?.sections?.length ?? -1, last: String(r?.lastText).slice(0, 6) };
  };
  const out = [snap("opened")];
  for (let i = 0; i < 4; i++) {
    app.commands.executeCommandById("markdown:toggle-preview");
    await sleep(1500);
    out.push(snap("src" + i));
    app.commands.executeCommandById("markdown:toggle-preview");
    await sleep(1800);
    out.push(snap("prev" + i));
  }
  window.removeEventListener("error", trap);
  window.removeEventListener("unhandledrejection", trap);
  return JSON.stringify({ out, errors }, null, 1);
})()
