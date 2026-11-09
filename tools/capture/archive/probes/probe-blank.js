(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.activeLeaf;
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  const sizer = pv.querySelector(".markdown-preview-sizer");
  const r = leaf.view.previewMode?.renderer;
  const before = {
    kids: sizer.children.length,
    sections: r?.sections?.length ?? -1,
    text: r ? (r.text === r.lastText) : null,
    h: Math.round(pv.scrollHeight),
    childHtml: sizer.children[0]?.outerHTML?.slice(0, 120) ?? null
  };
  // Nudge the virtualiser: a scroll usually rebuilds the window.
  pv.scrollTop = 200; await sleep(400);
  const after1 = { kids: sizer.children.length, h: Math.round(pv.scrollHeight), sections: r?.sections?.length ?? -1 };
  pv.scrollTop = 0; await sleep(400);
  const after2 = { kids: sizer.children.length, h: Math.round(pv.scrollHeight) };
  // Ask the plugin for a fresh pass.
  leaf.view.containerEl.dispatchEvent(new CustomEvent("ag-refresh"));
  await sleep(900);
  const after3 = { kids: sizer.children.length, h: Math.round(pv.scrollHeight) };
  return JSON.stringify({ before, after1, after2, after3 }, null, 1);
})()
