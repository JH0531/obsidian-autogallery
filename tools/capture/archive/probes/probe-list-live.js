(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.getMode?.() === "source");
  if (!leaf) return "no source leaf";
  const scroller = leaf.view.containerEl.querySelector(".cm-scroller");
  const lines = [...leaf.view.containerEl.querySelectorAll(".cm-line")];
  const pick = lines.filter((l) => /ratio-(3x2|1x1|4x3)\.svg/.test(l.innerHTML));
  const rows = pick.map((l) => {
    const r = l.getBoundingClientRect();
    const img = l.querySelector("img");
    const ir = img?.getBoundingClientRect();
    const cs = getComputedStyle(l);
    return {
      text: l.textContent.trim().slice(0, 12),
      cls: String(l.className).slice(0, 40),
      top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
      style: (l.getAttribute("style") || "").slice(0, 140),
      imgW: img ? Math.round(ir.width) : null,
      imgH: img ? Math.round(ir.height) : null,
      imgLeft: img ? Math.round(ir.left) : null,
      imgStyle: img ? (img.getAttribute("style") || "").slice(0, 120) : null,
      display: cs.display, float: cs.float, width: cs.width, marginLeft: cs.marginLeft
    };
  });
  // The list item that owns them.
  const first = pick[0];
  let holder = first?.parentElement;
  const chain = [];
  for (let i = 0; i < 4 && holder; i++) {
    const r = holder.getBoundingClientRect();
    chain.push({ tag: holder.tagName, cls: String(holder.className).slice(0, 40), left: Math.round(r.left), w: Math.round(r.width), pad: getComputedStyle(holder).paddingLeft });
    holder = holder.parentElement;
  }
  return JSON.stringify({ scroll: Math.round(scroller?.scrollTop ?? -1), rows, chain }, null, 1);
})()
