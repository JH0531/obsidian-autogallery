(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = globalThis.__AG_ARGS__;
  const args = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {});
  const note = args.note ?? "07-宽度路由.md";
  const heading = args.heading ?? "1:1 与 9:16";
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(app.vault.getAbstractFileByPath(note));
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await sleep(2200);
  if (leaf.view.getMode() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(2000); }
  const pv = () => leaf.view.containerEl.querySelector(".markdown-preview-view");
  let headingY = null;
  for (let y = 0; y <= pv().scrollHeight; y += 300) {
    pv().scrollTop = y;
    await sleep(160);
    const h = [...pv().querySelectorAll(".el-h2")].find((x) => x.textContent.includes(heading));
    if (h) {
      pv().scrollTop = y + (h.getBoundingClientRect().top - pv().getBoundingClientRect().top) - 30;
      await sleep(700);
      headingY = Math.round(h.getBoundingClientRect().top - pv().getBoundingClientRect().top);
      break;
    }
  }
  if (headingY === null) return JSON.stringify({ error: "heading not attached" });
  const sizer = pv().querySelector(".markdown-preview-sizer");
  const box = pv().getBoundingClientRect();
  const kids = [...sizer.children];
  const start = kids.findIndex((el) => /el-h2/.test(String(el.className)) && el.textContent.includes(heading));
  const rows = kids.slice(start, start + 6).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 16),
      float: cs.float, clear: cs.clear,
      top: Math.round(r.top - box.top), left: Math.round(r.left - box.left),
      w: Math.round(r.width), h: Math.round(r.height)
    };
  });
  return JSON.stringify({ note, heading, scroll: Math.round(pv().scrollTop), rows }, null, 1);
})()
