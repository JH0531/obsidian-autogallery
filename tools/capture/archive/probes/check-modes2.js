(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = app.vault.getAbstractFileByPath("03-分组规则.md");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  await sleep(1200);
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  const cmd = async (id) => { app.commands.executeCommandById(id); await sleep(1700); };
  const headY = () => {
    const v = pv();
    if (!v) return null;
    const h = [...v.querySelectorAll(".el-h2")].find((x) => /正文断组/.test(x.textContent));
    return h ? Math.round(h.getBoundingClientRect().top - v.getBoundingClientRect().top) : null;
  };
  if (leaf.view.getMode() !== "preview") await cmd("markdown:toggle-preview");
  for (let y = 0; y <= pv().scrollHeight; y += 300) {
    pv().scrollTop = y;
    await sleep(150);
    if (headY() !== null) { pv().scrollTop = y + headY() - 80; await sleep(600); break; }
  }

  const rounds = [];
  for (let i = 0; i < 3; i++) {
    const from = headY();
    const fromScroll = Math.round(pv().scrollTop);
    await cmd("markdown:toggle-preview");
    const sourceTop = Math.round(leaf.view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? -1);
    await cmd("markdown:toggle-preview");
    await sleep(900);
    rounds.push({ from, fromScroll, to: headY(), toScroll: Math.round(pv().scrollTop), h: Math.round(pv().scrollHeight), sourceTop });
  }

  // Park deeper, away from the heading, and check the round trip lands there.
  const deep = Math.min(pv().scrollHeight - pv().clientHeight - 4, 2600);
  pv().scrollTop = deep;
  await sleep(700);
  const deepTop = Math.round(pv().scrollTop);
  await cmd("markdown:toggle-preview");
  const deepSource = Math.round(leaf.view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? -1);
  await cmd("markdown:toggle-preview");
  await sleep(900);
  return JSON.stringify({ rounds, deep: { from: deepTop, source: deepSource, back: Math.round(pv().scrollTop) } }, null, 1);
})()
