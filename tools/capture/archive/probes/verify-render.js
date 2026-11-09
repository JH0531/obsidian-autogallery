(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const open = async (name) => {
    const file = app.vault.getAbstractFileByPath(name);
    if (!file) return null;
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const state = leaf.getViewState();
    state.state = state.state ?? {};
    state.state.mode = "preview";
    await leaf.setViewState(state);
    await wait(900);
    return leaf.view.containerEl;
  };

  // The reading view virtualises blocks outside the viewport, so a single
  // query only sees the first screenful. Scroll the whole note and remember
  // every element that ever appeared.
  const collect = async (container) => {
    const view = container.querySelector(".markdown-preview-view");
    const seenImages = new Set();
    const seenCells = new Map();
    const height = () => view.scrollHeight;
    for (let y = 0; y <= height(); y += 420) {
      view.scrollTop = y;
      await wait(70);
      for (const img of view.querySelectorAll("img")) seenImages.add(img);
      for (const el of view.querySelectorAll("[data-ag-row]")) {
        if (!seenCells.has(el)) seenCells.set(el, JSON.parse(el.getAttribute("data-ag-row")));
      }
    }
    view.scrollTop = 0;
    await wait(400);
    const stamps = [...seenCells.values()];
    return {
      images: seenImages.size,
      cells: stamps.length,
      rows: stamps.filter((stamp) => stamp.last).length,
      captions: view.querySelectorAll(".ag-caption").length,
      overflow: view.scrollWidth - view.clientWidth,
      widths: [...seenCells.keys()].map((el) => Math.round(el.getBoundingClientRect().width)).filter((w) => w > 0)
    };
  };

  const out = {};
  for (const name of [
    "README.md",
    "02-图片参数速查.md",
    "04-画廊分行与混合比例.md",
    "05-行高上限与孤儿图片.md",
    "06-单图比例与浮动绕排.md",
    "11-嵌套作用域.md",
    "13-Frontmatter路由.md"
  ]) {
    const container = await open(name);
    out[name] = container ? await collect(container) : "missing";
  }

  // Route check: the same 1:1 calibration image as a single block, once under
  // the auto profile and once under wide (via frontmatter album: trip).
  const measure = async (name, alt) => {
    const container = await open(name);
    const view = container.querySelector(".markdown-preview-view");
    for (let y = 0; y <= view.scrollHeight; y += 300) {
      view.scrollTop = y;
      await wait(80);
      const img = [...view.querySelectorAll("img")].find((el) => el.getAttribute("alt") === alt);
      if (img) {
        const block = img.closest("[data-ag-row]") ?? img.closest(".el-p") ?? img;
        const rect = block.getBoundingClientRect();
        if (rect.width > 0) return { width: Math.round(rect.width), column: view.clientWidth };
      }
    }
    return null;
  };
  out.route = {
    wide1x1: await measure("13-Frontmatter路由.md", "方图"),
    auto1x1: await measure("06-单图比例与浮动绕排.md", "1:1"),
    album: (() => {
      try {
        const cache = app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("13-Frontmatter路由.md"));
        return cache?.frontmatter?.album ?? null;
      } catch (e) { return null; }
    })()
  };
  return JSON.stringify(out);
})()
