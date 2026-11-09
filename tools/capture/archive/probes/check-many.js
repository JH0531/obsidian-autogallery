(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const notes = ["05-行高上限与孤儿.md", "08-浮动与绕排.md", "12-嵌套作用域.md", "17-PDF导出.md"].filter((p) => app.vault.getAbstractFileByPath(p));
  const cmd = async (id) => { app.commands.executeCommandById(id); await sleep(1600); };
  const leaf = app.workspace.getLeaf(false);
  const out = [];
  for (const note of notes) {
    await leaf.openFile(app.vault.getAbstractFileByPath(note));
    await sleep(2200);
    if (leaf.view.getMode() !== "preview") await cmd("markdown:toggle-preview");
    const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
    const target = Math.round((pv().scrollHeight - pv().clientHeight) * 0.55);
    pv().scrollTop = target;
    await sleep(1400);
    const before = Math.round(pv().scrollTop);
    const sections = leaf.view.previewMode?.renderer?.sections?.length ?? -1;
    await cmd("markdown:toggle-preview");
    const src = Math.round(leaf.view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? -1);
    await cmd("markdown:toggle-preview");
    await sleep(1200);
    const after = Math.round(pv().scrollTop);
    out.push({ note, sections, before, src, after, drift: after - before, max: Math.round(pv().scrollHeight - pv().clientHeight) });
  }
  return JSON.stringify(out, null, 1);
})()
