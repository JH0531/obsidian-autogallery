(async () => {
  // Frame one section: the image is as tall as the section, not as tall as the
  // window. Sections taller than one viewport are captured in chunks and
  // stitched later by finish-stills.mjs.
  //
  // The closing edge is found in the live DOM while capturing, not from a
  // pre-measured height: reading view virtualises its blocks and every decoded
  // image shifts what is below it, so a stored offset is wrong by the time the
  // capture runs. `extentCss` is only an upper bound for notes whose closing
  // heading is the end of the document.
  //
  // Recording mode is applied only for the duration of the capture and always
  // restored, so the vault is left with its normal chrome and sidebars.
  const nextFrame = (n = 3) => new Promise((resolve) => {
    let left = n;
    const step = () => (left -= 1) <= 0 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const args = typeof globalThis.__AG_ARGS__ === "string" ? JSON.parse(globalThis.__AG_ARGS__) : {};
  const { id, note } = args;
  const mode = args.mode ?? "preview";
  // Which cell of the language × theme matrix this take belongs to. Recorded in
  // meta.json so finish-stills writes the frame into the cell it was shot in.
  const lang = args.lang === "en" ? "en" : "zh";
  const theme = args.theme === "light" ? "light" : "dark";
  if (!id || !note) return "missing args";
  const file = app.vault.getAbstractFileByPath(note);
  if (!file) return `missing note ${note}`;
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  if (leaf.view.getMode() !== mode) {
    const state = leaf.getViewState();
    state.state = state.state ?? {};
    state.state.mode = mode;
    await leaf.setViewState(state);
  }
  await nextFrame(6);
  await sleep(700);

  const ws = app.workspace;
  // A newer capture supersedes this one; see the same guard in audit-sections.
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  globalThis.__AG_RUN__ = runId;
  const superseded = () => globalThis.__AG_RUN__ !== runId;
  // Hard stop. A capture that loses its CDP socket has no way to know the caller
  // is gone, so it must be able to finish on its own — otherwise it keeps
  // scrolling the app long after the batch that started it has exited.
  const deadline = Date.now() + 75000;
  const ui = {
    recording: document.body.classList.contains("ag-recording"),
    left: Boolean(ws.leftSplit?.collapsed),
    right: Boolean(ws.rightSplit?.collapsed)
  };
  document.body.classList.add("ag-recording");
  try { ws.leftSplit?.collapse?.(); } catch (e) {}
  try { ws.rightSplit?.collapse?.(); } catch (e) {}
  await sleep(260);

  try {
    const container = leaf.view.containerEl;
    const view = mode === "source"
      ? container.querySelector(".markdown-source-view")
      : container.querySelector(".markdown-preview-view");
    if (!view) return "no view";

    const levelOf = (el) => {
      const match = /(?:^|\s)el-h([1-6])(?:\s|$)/.exec(String(el.className));
      return match ? Number(match[1]) : 0;
    };

    // An empty anchor means "from the top of the document": used by the
    // quick-start still, which frames the opening paragraph and its image row.
    // The closing boundary is the first h2 after the title — level 1 would ask
    // for another h1, and a note has exactly one, so the search would never
    // terminate and the frame would fall back to a stale planned height.
    let level = 2;
    let anchorAbs = 0;
    if (args.anchor) {
      // "行高上限" also matches the H1 "行高上限与孤儿". Prefer an exact match
      // below h1, then any heading below h1, then anything.
      const find = () => {
        const matches = [...container.querySelectorAll("[class*='el-h']")]
          .filter((el) => levelOf(el) > 0 && el.textContent.trim().includes(args.anchor));
        return matches.find((el) => levelOf(el) > 1 && el.textContent.trim() === args.anchor)
          ?? matches.find((el) => levelOf(el) > 1)
          ?? matches[0];
      };

      let heading = find();
      for (let y = 0; !heading && y <= (view.scrollHeight ?? 0); y += 400) {
        view.scrollTop = y;
        await sleep(80);
        heading = find();
      }
      if (!heading) return `anchor not found: ${args.anchor}`;
      level = levelOf(heading);

      heading.scrollIntoView({ block: "start" });
      await sleep(340);
      const lead = Math.round(heading.getBoundingClientRect().top - view.getBoundingClientRect().top);
      if (Math.abs(lead) > 1) {
        view.scrollTop += lead;
        await sleep(260);
      }
      anchorAbs = Math.round(view.scrollTop + heading.getBoundingClientRect().top - view.getBoundingClientRect().top);
    } else {
      view.scrollTop = 0;
      await sleep(280);
    }

    // Absolute position of the first heading at or above `level` that sits after
    // the anchor. Re-read after every scroll: the block may only exist once the
    // virtualised window reaches it.
    const findStop = () => {
      const sizer = view.querySelector(".markdown-preview-sizer");
      if (!sizer) return null;
      const viewTop = view.getBoundingClientRect().top;
      let best = null;
      for (const el of sizer.children) {
        const lv = levelOf(el);
        if (!lv || lv > level) continue;
        const abs = Math.round(view.scrollTop + el.getBoundingClientRect().top - viewTop);
        if (abs > anchorAbs + 40 && (best === null || abs < best)) best = abs;
      }
      return best;
    };

    const viewport = 800;
    const skipTop = Math.max(0, Math.round(args.startCss ?? 0));
    const maxScroll = Math.max(0, view.scrollHeight - view.clientHeight);
    const ew = window.electronWindow;
    if (!ew?.webContents?.capturePage) return "no capturePage";

    // One cache directory per cell: the same figure is captured once per
    // language and theme, and the chunks of one take must never be stitched
    // into another.
    const dir = `.cache/shots/${id}--${lang}-${theme}`;
    try { await app.vault.adapter.mkdir(dir); } catch (e) {}
    try {
      const existing = await app.vault.adapter.list(dir);
      for (const child of existing.files ?? []) await app.vault.adapter.remove(child);
    } catch (e) {}

    // Warm-up: decode every image in the section before the real pass. Without
    // it the first chunk is laid out against smaller placeholders and the stitch
    // lands a line off, which shows up as a half sentence at a seam.
    const warmEnd = Math.min(maxScroll, anchorAbs + (Number(args.extentCss) || 1400) + 480);
    for (let y = anchorAbs; y <= warmEnd; y += 360) {
      if (superseded() || Date.now() > deadline) return "deadline";
      view.scrollTop = y;
      await sleep(180);
    }
    view.scrollTop = anchorAbs;
    await sleep(480);

    let stopAbs = args.extentCss ? anchorAbs + Math.round(args.extentCss) : null;
    const parts = [];
    let lastTop = 0;
    for (let k = 0; k < 14; k += 1) {
      if (superseded() || Date.now() > deadline) return "deadline";
      const desired = Math.min(anchorAbs + k * viewport, maxScroll);
      view.scrollTop = desired;
      await sleep(320);
      await nextFrame(2);
      const at = Math.round(view.scrollTop);

      const found = findStop();
      if (found !== null) {
        // The measured envelope wins: it stops at the last block's bottom and so
        // excludes the next heading's top margin. `findStop` is only a safety
        // net for the case where the envelope is missing or too generous.
        const planned = args.extentCss ? anchorAbs + Math.round(args.extentCss) : null;
        stopAbs = planned === null ? found : Math.min(planned, found);
      }

      const trimTop = k === 0 ? skipTop : 0;
      const available = viewport - trimTop;
      const remaining = stopAbs === null ? available : Math.round(stopAbs - at) - trimTop;
      const height = Math.max(0, Math.min(available, remaining));
      if (height < 8) break;

      const image = await ew.webContents.capturePage({ x: 0, y: 0, width: 1200, height: viewport });
      const name = `p${String(k).padStart(2, "0")}.png`;
      await app.vault.adapter.writeBinary(`${dir}/${name}`, image.toPNG());
      parts.push({ file: name, cropTop: Math.round(trimTop * 1.25), cropHeight: Math.round(height * 1.25) });
      lastTop = at;

      if (stopAbs !== null && stopAbs <= at + available) break;
      if (at >= maxScroll - 2) break;
    }

    if (!parts.length) return "nothing captured";
    const contentCss = parts.reduce((sum, part) => sum + part.cropHeight, 0) / 1.25;

    await app.vault.adapter.write(`${dir}/meta.json`, JSON.stringify({
      id, note, lang, theme,
      anchor: args.anchor ?? null, contentCss: Math.round(contentCss), chunks: parts.length, parts
    }));
    return JSON.stringify({ id, cell: `${lang}/${theme}`, chunks: parts.length, contentCss: Math.round(contentCss), stopAbs, lastTop });
  } finally {
    if (!ui.recording) document.body.classList.remove("ag-recording");
    if (!ui.left) { try { ws.leftSplit?.expand?.(); } catch (e) {} }
    if (!ui.right) { try { ws.rightSplit?.expand?.(); } catch (e) {} }
  }
})()
