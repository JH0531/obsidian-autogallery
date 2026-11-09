(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  const trap = (e) => errors.push(String(e.message ?? e.reason?.message ?? e).slice(0, 160));
  window.addEventListener("error", trap);
  window.addEventListener("unhandledrejection", trap);

  const leaf = app.workspace.activeLeaf;
  const sample = (tag) => {
    const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
    const r = leaf.view.previewMode?.renderer;
    return { tag, mode: leaf.view.getMode?.(), kids: pv ? pv.querySelector(".markdown-preview-sizer").children.length : -1, sections: r?.sections?.length ?? -1 };
  };
  const out = [sample("start")];
  await leaf.openFile(app.vault.getAbstractFileByPath("12-嵌套作用域.md"));
  await sleep(1800);
  out.push(sample("after open"));
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800); }
  out.push(sample("preview"));
  app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1600);
  out.push(sample("source"));
  app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800);
  out.push(sample("back to preview"));
  await sleep(800);
  out.push(sample("settled"));
  window.removeEventListener("error", trap);
  window.removeEventListener("unhandledrejection", trap);
  return JSON.stringify({ out, errors }, null, 1);
})()
