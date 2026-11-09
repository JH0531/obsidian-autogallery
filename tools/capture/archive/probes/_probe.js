(async () => {
  const path = "10-参数速查.md";
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return "file missing in vault index";
  const text = await app.vault.cachedRead(file);
  const fresh = text.includes("隔离与排除");
  const lines = text.split("\n").filter((l) => l.startsWith("## ")).join(" / ");
  const list = app.vault.getMarkdownFiles().map((f) => f.path).sort();
  return JSON.stringify({
    cached: fresh,
    firstLine: text.split("\n").find((l) => l.startsWith("# ")),
    sections: lines.slice(0, 160),
    mdCount: list.length,
    head: list.slice(0, 6)
  });
})()
