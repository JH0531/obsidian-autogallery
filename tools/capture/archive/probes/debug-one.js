(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const file = app.vault.getAbstractFileByPath("04-画廊分行与混合比例.md");
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  const state = leaf.getViewState();
  state.state = state.state ?? {};
  state.state.mode = "preview";
  await leaf.setViewState(state);
  await wait(1500);
  const view = leaf.view;
  const container = view.containerEl;
  const sections = [...container.querySelectorAll(".markdown-preview-section")];
  const active = container.querySelector(".markdown-preview-section");
  const info = sections.map((section) => ({
    connected: section.isConnected,
    children: section.children.length,
    images: section.querySelectorAll("img").length,
    layouts: section.querySelectorAll("[data-ag-layout]").length,
    rows: section.querySelectorAll("[data-ag-row]").length,
    width: section.clientWidth,
    previews: section.querySelectorAll(".markdown-preview-view").length,
    classes: [...section.children].slice(0, 4).map((el) => el.className)
  }));
  return JSON.stringify({
    mode: view.getMode(),
    file: app.workspace.getActiveFile()?.path,
    sectionCount: sections.length,
    info,
    firstChildText: (active?.children?.[0]?.textContent ?? "").slice(0, 40),
    allViews: [...container.querySelectorAll(".markdown-preview-view")].length,
    hidden: document.hidden
  });
})()
