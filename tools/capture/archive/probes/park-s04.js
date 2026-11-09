(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.activeLeaf;
  const mode = leaf.view.getMode();
  if (mode === "source") {
    const lines = leaf.view.editor.getValue().split("\n");
    const line = lines.findIndex((l) => /^##\s*正文断组/.test(l));
    leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, false);
    await sleep(500);
    return "source at line " + (line + 1);
  }
  const v = leaf.view.containerEl.querySelector(".markdown-preview-view");
  for (let y = 0; y <= v.scrollHeight; y += 300) {
    v.scrollTop = y;
    await sleep(140);
    const h = [...v.querySelectorAll(".el-h2")].find((x) => /正文断组/.test(x.textContent));
    if (h) {
      v.scrollTop = y + (h.getBoundingClientRect().top - v.getBoundingClientRect().top) - 24;
      await sleep(500);
      return "preview at " + Math.round(v.scrollTop);
    }
  }
  return "heading not found";
})()
