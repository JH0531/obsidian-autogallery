(() => {
  const view = document.querySelector(".markdown-preview-view");
  const chain = [];
  let node = view;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    chain.push({
      cls: String(node.className).slice(0, 40),
      clientH: node.clientHeight,
      scrollH: node.scrollHeight,
      scrollTop: node.scrollTop,
      overflowY: style.overflowY
    });
    node = node.parentElement;
  }
  return JSON.stringify(chain);
})()
