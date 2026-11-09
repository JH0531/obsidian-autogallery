(async () => {
  const rows = [];
  app.workspace.iterateAllLeaves((leaf) => {
    const v = leaf.view;
    const pv = v?.containerEl?.querySelector?.(".markdown-preview-view");
    const r = v?.previewMode?.renderer;
    rows.push({
      type: v?.getViewType?.() ?? "?",
      file: v?.file?.path ?? null,
      mode: v?.getMode?.() ?? null,
      connected: !!v?.containerEl?.isConnected,
      w: v?.containerEl ? Math.round(v.containerEl.clientWidth) : -1,
      h: v?.containerEl ? Math.round(v.containerEl.clientHeight) : -1,
      kids: pv ? pv.querySelector(".markdown-preview-sizer").children.length : -1,
      sections: r?.sections?.length ?? -1,
      active: leaf === app.workspace.activeLeaf
    });
  });
  return JSON.stringify(rows, null, 1);
})()
