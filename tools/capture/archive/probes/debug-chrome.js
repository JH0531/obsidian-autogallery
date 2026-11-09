(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const leaf = app.workspace.activeLeaf?.view?.containerEl;
  const lr = leaf?.getBoundingClientRect();
  return JSON.stringify({
    window: { w: window.innerWidth, h: window.innerHeight },
    leaf: lr ? { x: Math.round(lr.x), y: Math.round(lr.y), w: Math.round(lr.width), h: Math.round(lr.height) } : null,
    parts: [
      pick(".workspace-tab-header-container"),
      pick(".view-header"),
      pick(".status-bar"),
      pick(".workspace-ribbon"),
      pick(".markdown-preview-view"),
      pick(".markdown-preview-sizer")
    ]
  });
})()
