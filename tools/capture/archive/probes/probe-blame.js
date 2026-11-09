(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.activeLeaf;
  const probe = () => {
    const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
    return { kids: pv ? pv.querySelector(".markdown-preview-sizer").children.length : -1, sections: leaf.view.previewMode?.renderer?.sections?.length ?? -1, last: String(leaf.view.previewMode?.renderer?.lastText).slice(0, 8) };
  };
  const out = { start: probe() };
  await app.plugins.disablePlugin("obsidian-autogallery");
  await sleep(1200);
  await leaf.setViewState(leaf.getViewState());
  await sleep(1800);
  out.pluginOff = probe();
  await app.plugins.enablePlugin("obsidian-autogallery");
  await sleep(1500);
  out.pluginOn = probe();
  return JSON.stringify(out, null, 1);
})()
