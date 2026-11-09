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
  leaf.view.containerEl.querySelector(".cm-content")?.dispatchEvent(new CustomEvent("ag-layout-invalid", { bubbles: true }));
  await sleep(1200);
  const embeds = targets.map((l) => {
    const e = l.querySelector(".image-embed, .internal-embed");
    const r = e?.getBoundingClientRect();
    return e ? { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
  });
  return JSON.stringify({ pad: targets.map((l) => getComputedStyle(l).paddingInlineStart), embeds }, null, 1);
})()
