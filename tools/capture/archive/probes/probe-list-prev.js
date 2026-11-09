(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.activeLeaf;
  const file = leaf?.view?.file?.path;
  if (leaf?.view?.getMode?.() !== "preview") { app.commands.executeCommandById("markdown:toggle-preview"); await sleep(1800); }
  const pv = leaf.view.containerEl.querySelector(".markdown-preview-view");
  if (!pv) return JSON.stringify({ error: "no preview", file, mode: leaf.view.getMode?.() });
  let found = false;
  for (let y = 0; y <= pv.scrollHeight; y += 250) {
    pv.scrollTop = y;
    await sleep(150);
    if ([...pv.querySelectorAll(".el-h2")].some((x) => x.textContent.includes("列表"))) { found = true; break; }
  }
  if (!found) return JSON.stringify({ error: "no heading", file, h: Math.round(pv.scrollHeight), kids: pv.querySelector(".markdown-preview-sizer")?.children.length });
  await sleep(500);
  const items = [...pv.querySelectorAll("li")].filter((el) => el.querySelector("img")).slice(0, 2);
  return JSON.stringify({ file, items: items.map((li) => [...li.querySelectorAll("img")].map((i) => {
    const r = i.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left) };
  })) }, null, 1);
})()
