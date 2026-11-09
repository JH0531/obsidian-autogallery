(async () => {
  // Abort every measurement/capture loop still running inside this renderer.
  //
  // A CLI call that times out leaves its async function alive: the process that
  // issued it is gone but the loop keeps opening notes and scrolling. Both
  // audit-sections.js and shoot.js check `__AG_RUN__` each iteration, so
  // changing it here makes them return at the next tick and restore the UI
  // through their `finally` block.
  globalThis.__AG_RUN__ = `aborted-${Date.now()}`;
  await new Promise((r) => setTimeout(r, 600));
  const ws = app.workspace;
  document.body.classList.remove("ag-recording");
  try { ws.leftSplit?.expand?.(); } catch (e) {}
  try { ws.rightSplit?.expand?.(); } catch (e) {}
  return JSON.stringify({ aborted: true, left: !ws.leftSplit?.collapsed, right: !ws.rightSplit?.collapsed });
})()
