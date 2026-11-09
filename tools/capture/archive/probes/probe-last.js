(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.activeLeaf;
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  const sizer = pv.querySelector(".markdown-preview-sizer");
  let target = null;
  for (let y = 0; y <= pv.scrollHeight; y += 250) {
    pv.scrollTop = y;
    await sleep(140);
    const h = [...pv.querySelectorAll(".el-h2")].find((x) => x.textContent.includes("表格后再起"));
    if (h) { pv.scrollTop = y + (h.getBoundingClientRect().top - pv.getBoundingClientRect().top) - 40; target = h; break; }
  }
  if (!target) return JSON.stringify({ error: "no heading" });
  await sleep(800);
  const box = pv.getBoundingClientRect();
  const kids = [...sizer.children];
  const start = kids.findIndex((el) => /el-h2/.test(String(el.className)) && el.textContent.includes("表格后再起"));
  return JSON.stringify(kids.slice(start, start + 6).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { cls: String(el.className).split(/\s+/).find((c) => /^el-/.test(c)), float: cs.float, clear: cs.clear, top: Math.round(r.top - box.top), left: Math.round(r.left - box.left), w: Math.round(r.width), h: Math.round(r.height), text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 14) };
  }), null, 1);
})()
