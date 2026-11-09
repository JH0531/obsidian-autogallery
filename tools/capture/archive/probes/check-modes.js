(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = app.vault.getAbstractFileByPath("03-分组规则.md");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  await sleep(900);
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  const cm = () => leaf.view.containerEl.querySelector(".cm-scroller");
  const cmd = async (id) => { app.commands.executeCommandById(id); await sleep(1700); };
  const headY = () => {
    const v = pv();
    if (!v) return null;
    const h = [...v.querySelectorAll(".el-h2")].find((x) => /正文断组/.test(x.textContent));
    return h ? Math.round(h.getBoundingClientRect().top - v.getBoundingClientRect().top) : null;
  };
  const firstSourceLine = () => {
    const s = cm();
    if (!s) return null;
    const top = s.getBoundingClientRect().top;
    for (const line of s.querySelectorAll(".cm-line")) {
      const r = line.getBoundingClientRect();
      if (r.bottom > top + 1) return line.textContent.trim().replace(/\s+/g, " ").slice(0, 30);
    }
    return null;
  };

  if (leaf.view.getMode() !== "preview") await cmd("markdown:toggle-preview");
  for (let y = 0; y <= pv().scrollHeight; y += 300) {
    pv().scrollTop = y;
    await sleep(150);
    if (headY() !== null) { pv().scrollTop = y + headY() - 80; await sleep(500); break; }
  }
  const rounds = [];
  for (let i = 0; i < 3; i++) {
    const y0 = headY();
    await cmd("markdown:toggle-preview");
    const sourceLine = firstSourceLine();
    await cmd("markdown:toggle-preview");
    await sleep(900);
    rounds.push({ from: y0, to: headY(), drift: headY() === null ? null : headY() - y0, sourceTopLine: sourceLine });
  }

  // Reverse: park the source on the section heading, then read it in preview.
  await cmd("markdown:toggle-preview");
  const line = leaf.view.editor.getValue().split("\n").findIndex((l) => /^##\s*正文断组/.test(l));
  const view = leaf.view.containerEl.querySelector(".cm-content")?.cmView?.view;
  if (view) {
    const pos = leaf.view.editor.offsetToPos ? null : null;
    const from = view.state.doc.line(line + 1).from;
    const block = view.lineBlockAt(from);
    cm().scrollTop = block.top - 40;
    await sleep(500);
  }
  const srcTop = Math.round(cm().scrollTop);
  const srcLine = firstSourceLine();
  await cmd("markdown:toggle-preview");
  await sleep(900);
  const reverse = { sourceTop: srcTop, sourceTopLine: srcLine, previewHeadingY: headY() };

  return JSON.stringify({ rounds, reverse }, null, 1);
})()
