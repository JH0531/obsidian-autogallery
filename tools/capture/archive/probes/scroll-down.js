(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sc = document.querySelector(".cm-scroller");
  sc.scrollTop += 420;
  await sleep(700);
  return "scroll " + Math.round(sc.scrollTop);
})()
