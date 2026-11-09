(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const args = typeof globalThis.__AG_ARGS__ === "string" ? JSON.parse(globalThis.__AG_ARGS__) : {};
  const file = app.vault.getAbstractFileByPath(args.note);
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const state = leaf.getViewState();
  state.state = state.state ?? {};
  state.state.mode = "preview";
  await leaf.setViewState(state);
  await wait(900);
  const view = leaf.view.containerEl.querySelector(".markdown-preview-view");
  const sizer = view.querySelector(".markdown-preview-sizer");
  const base = sizer.getBoundingClientRect();
  const images = [...view.querySelectorAll("img")].map((img) => {
    const block = img.closest("[data-ag-row]") ?? img.closest(".el-p") ?? img;
    const rect = block.getBoundingClientRect();
    const style = getComputedStyle(block);
    return {
      alt: (img.getAttribute("alt") ?? "").slice(0, 10),
      w: Math.round(rect.width),
      h: Math.round(img.getBoundingClientRect().height),
      left: Math.round(rect.left - base.left),
      float: style.float,
      stamp: block.hasAttribute("data-ag-row")
    };
  });
  return JSON.stringify({ sizerWidth: Math.round(base.width), images });
})()
