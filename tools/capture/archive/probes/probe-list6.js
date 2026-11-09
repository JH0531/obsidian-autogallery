(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode?.() === "source");
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const targets = [lines[idx + 1], lines[idx + 2]];
  for (const l of targets) {
    l.style.paddingInlineStart = "23px";
    l.style.textIndent = "-23px";
  }
  const rows = [];
  for (let i = 0; i < 6; i++) {
    await sleep(200);
    rows.push(targets.map((l) => getComputedStyle(l).paddingInlineStart));
  }
  const embeds = targets.map((l) => {
    const e = l.querySelector(".image-embed, .internal-embed");
    const r = e?.getBoundingClientRect();
    return e ? { left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), style: (e.getAttribute("style") || "").slice(0, 120) } : null;
  });
  return JSON.stringify({ rows, embeds }, null, 1);
})()
