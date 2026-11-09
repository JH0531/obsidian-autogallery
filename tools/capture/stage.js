(async () => {
  const nextFrame = (count = 3) => new Promise((resolve) => {
    let left = count;
    const step = () => (left -= 1) <= 0 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  });
  const ew = window.electronWindow;
  if (!ew) return "no-electron-window";
  const web = ew.webContents ?? ew;
  try { ew.setAlwaysOnTop?.(true); } catch (e) {}
  try { (web.setZoomFactor ?? ew.setZoomFactor)?.call(web, 1); } catch (e) {}
  try { ew.setContentSize?.(1200, 800); } catch (e) {}
  try { ew.show?.(); } catch (e) {}
  try { ew.focus?.(); } catch (e) {}
  await nextFrame(4);
  const bounds = ew.getContentBounds?.() ?? ew.getBounds?.() ?? null;
  const dpr = window.devicePixelRatio;
  const hidden = document.hidden;
  const zoom = (web.getZoomFactor ?? ew.getZoomFactor)?.call(web) ?? null;
  // Window managers may add a 1px frame; accept a 2px tolerance.
  const ok = !hidden && bounds
    && Math.abs(bounds.width - 1200) <= 2
    && Math.abs(bounds.height - 800) <= 2;
  return JSON.stringify({ ok, bounds, dpr, hidden, zoom });
})()
