(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const notes = app.vault.getMarkdownFiles()
    .map((f) => f.path)
    .filter((p) => !/^(AG-|README)/.test(p) && !p.includes("/"))
    .sort();
  const leaf = app.workspace.getLeaf(false);
  const out = [];
  for (const note of notes) {
    await leaf.openFile(app.vault.getAbstractFileByPath(note));
    app.workspace.setActiveLeaf(leaf, { focus: false });
    await sleep(900);
    if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1400); }
    const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
    const sizer = pv.querySelector(".markdown-preview-sizer");
    // Walk the document so every section is decorated at least once.
    const step = Math.max(300, Math.round(pv.clientHeight * 0.8));
    for (let y = 0; y <= pv.scrollHeight; y += step) { pv.scrollTop = y; await sleep(120); }
    pv.scrollTop = 0;
    await sleep(500);
    let heading = "";
    const hits = [];
    for (const el of sizer.children) {
      const cls = String(el.className);
      if (/el-h2/.test(cls)) heading = el.textContent.trim().slice(0, 14);
      const cs = getComputedStyle(el);
      if (cs.float === "none") continue;
      const next = el.nextElementSibling;
      if (!next) continue;
      const ncs = getComputedStyle(next);
      if (ncs.float !== "none") continue;
      if (!/el-p|el-div|el-blockquote/.test(String(next.className))) continue;
      const r = el.getBoundingClientRect();
      const nr = next.getBoundingClientRect();
      // The paragraph's box always spans the column; what matters is where its
      // first line sits. A wrapped paragraph starts at the float's top; one that
      // dropped below starts at (or under) its bottom.
      if (nr.top >= r.bottom - 4) {
        hits.push({ heading, float: cs.float, w: Math.round(r.width), gap: Math.round(nr.top - r.bottom), text: next.textContent.trim().slice(0, 22) });
      }
    }
    if (hits.length) out.push({ note, hits });
  }
  return JSON.stringify(out, null, 1);
})()
