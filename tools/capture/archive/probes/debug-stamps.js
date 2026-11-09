(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = app.vault.getAbstractFileByPath("04-画廊分行与混合比例.md");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  await wait(1200);
  const container = leaf.view.containerEl;
  const sections = [...container.querySelectorAll(".markdown-preview-section")];
  const cells = [...container.querySelectorAll("[data-ag-row]")];
  return JSON.stringify({
    sections: sections.map((s) => ({ children: s.children.length, images: s.querySelectorAll("img").length })),
    cells: cells.map((el) => ({
      tag: el.tagName,
      cls: String(el.className).slice(0, 28),
      parent: el.parentElement?.className?.toString?.().slice(0, 24),
      row: JSON.parse(el.getAttribute("data-ag-row")).row,
      w: Math.round(el.getBoundingClientRect().width)
    }))
  });
})()
