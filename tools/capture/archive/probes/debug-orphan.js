(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = app.vault.getAbstractFileByPath("05-行高上限与孤儿图片.md");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  await wait(900);
  const view = leaf.view.containerEl.querySelector(".markdown-preview-view");
  view.scrollTop = 900;
  await wait(500);
  const images = [...view.querySelectorAll("img")];
  return JSON.stringify(images.map((img) => {
    const block = img.closest("[data-ag-row]") ?? img.closest(".el-p") ?? img;
    const style = block.getAttribute("style") ?? "";
    return {
      alt: (img.getAttribute("alt") ?? "").slice(0, 14),
      blockTag: block.tagName,
      layout: block.getAttribute("data-ag-layout"),
      stamp: block.getAttribute("data-ag-row"),
      style: style.slice(0, 160),
      w: Math.round(block.getBoundingClientRect().width),
      parentLayout: block.parentElement?.getAttribute?.("data-ag-layout") ?? null,
      parentStamp: block.parentElement?.getAttribute?.("data-ag-row") ?? null
    };
  }));
})()
