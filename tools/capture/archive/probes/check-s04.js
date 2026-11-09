(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = app.vault.getAbstractFileByPath("03-分组规则.md");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  await sleep(900);
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  const cmd = async (id) => { app.commands.executeCommandById(id); await sleep(1700); };

  if (leaf.view.getMode() !== "preview") await cmd("markdown:toggle-preview");
  const headBox = () => {
    const v = pv();
    const h = [...v.querySelectorAll(".el-h2")].find((x) => /正文断组/.test(x.textContent));
    return h ? Math.round(h.getBoundingClientRect().top - v.getBoundingClientRect().top) : null;
  };
  let headingY = null;
  for (let y = 0; y <= pv().scrollHeight; y += 300) {
    pv().scrollTop = y;
    await sleep(150);
    if (headBox() !== null) {
      pv().scrollTop = y + headBox() - 80;
      await sleep(600);
      headingY = headBox();
      break;
    }
  }
  if (headingY === null) return JSON.stringify({ error: "heading never attached" });
  const before = { scroll: Math.round(pv().scrollTop), headingY, h: Math.round(pv().scrollHeight) };

  // Geometry of the split section, in the same pass.
  const sizer = pv().querySelector(".markdown-preview-sizer");
  const box = pv().getBoundingClientRect();
  const kids = [...sizer.children];
  const start = kids.findIndex((el) => /el-h2/.test(String(el.className)) && /正文断组/.test(el.textContent));
  const rows = kids.slice(start, start + 6).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 12),
      float: cs.float,
      clear: cs.clear,
      top: Math.round(r.top - box.top),
      left: Math.round(r.left - box.left),
      w: Math.round(r.width),
      h: Math.round(r.height)
    };
  });

  await cmd("markdown:toggle-preview");
  const src = Math.round(leaf.view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? -1);
  await cmd("markdown:toggle-preview");
  await sleep(1400);
  const back = { scroll: Math.round(pv().scrollTop), headingY: headBox(), h: Math.round(pv().scrollHeight) };

  return JSON.stringify({ before, src, back, drift: back.headingY === null ? null : back.headingY - headingY, rows }, null, 1);
})()
