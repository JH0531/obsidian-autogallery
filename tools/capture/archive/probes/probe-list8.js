(async () => {
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode?.() === "source");
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const idx = lines.findIndex((l) => l.textContent.includes("同一条目里的两张图"));
  const targets = [lines[idx + 1], lines[idx + 2]];
  const info = targets.map((l) => {
    const e = l.querySelector(".image-embed, .internal-embed");
    const cs = getComputedStyle(e);
    return {
      lineCls: String(l.className).slice(0, 60),
      linePos: getComputedStyle(l).position,
      embedCls: String(e.className).slice(0, 40),
      position: cs.position, left: cs.left, top: cs.top, transform: cs.transform,
      offsetLeft: e.offsetLeft, offsetParent: e.offsetParent ? String(e.offsetParent.className).slice(0, 40) : null,
      style: (e.getAttribute("style") || "").slice(0, 260)
    };
  });
  return JSON.stringify(info, null, 1);
})()
