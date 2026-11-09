(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const notes = ["05-行高上限与孤儿.md", "08-浮动与绕排.md", "12-嵌套作用域.md", "17-PDF导出.md"].filter((p) => app.vault.getAbstractFileByPath(p));
  const leaf = app.workspace.getLeaf(false);
  const out = [];
  const topText = (pv) => {
    const box = pv.getBoundingClientRect();
    for (const el of pv.querySelector(".markdown-preview-sizer").children) {
      if (el.getBoundingClientRect().bottom > box.top + 4) return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 18);
    }
    return null;
  };
  for (const note of notes) {
    await leaf.openFile(app.vault.getAbstractFileByPath(note));
    app.workspace.setActiveLeaf(leaf, { focus: false });
    await sleep(2200);
    if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(2000); }
    const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
    pv().scrollTop = Math.round((pv().scrollHeight - pv().clientHeight) * 0.55);
    await sleep(1500);
    const before = { scroll: Math.round(pv().scrollTop), top: topText(pv()) };
    app.commands.executeCommandById("markdown:toggle-preview");
    await sleep(1800);
    const srcScroll = Math.round(leaf.view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? -1);
    const srcLine = leaf.view.currentMode?.getScroll?.();
    app.commands.executeCommandById("markdown:toggle-preview");
    await sleep(1500);
    const after = { scroll: Math.round(pv().scrollTop), top: topText(pv()) };
    out.push({ note, before, srcScroll, srcLine: Number.isFinite(srcLine) ? Math.round(srcLine) : String(srcLine), after, same: before.top === after.top });
  }
  return JSON.stringify(out, null, 1);
})()
