(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.activeLeaf;
  const v = leaf.view;
  const r = v.previewMode?.renderer;
  const before = {
    data: v.data === null ? "null" : typeof v.data === "string" ? "len " + v.data.length : String(v.data),
    rendererText: r ? (r.text === undefined ? "undef" : String(r.text).slice(0, 30)) : null,
    rendererLast: r ? (r.lastText === undefined ? "undef" : String(r.lastText).slice(0, 30)) : null,
    sections: r?.sections?.length ?? -1
  };
  // Re-apply the view state: this is what Obsidian does on a tab reload.
  await leaf.setViewState(leaf.getViewState());
  await sleep(1600);
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  const after = {
    mode: leaf.view.getMode?.(),
    kids: pv ? pv.querySelector(".markdown-preview-sizer").children.length : -1,
    sections: leaf.view.previewMode?.renderer?.sections?.length ?? -1,
    data: leaf.view.data === null ? "null" : "len " + String(leaf.view.data).length
  };
  return JSON.stringify({ before, after }, null, 1);
})()
