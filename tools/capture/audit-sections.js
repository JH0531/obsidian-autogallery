(async () => {
  // Measure every h2/h3 section as an element envelope: from the heading's top
  // to the bottom of the last block that belongs to it.
  //
  // Reading view virtualises, so the measurement walks the document and merges
  // what it sees; images decode lazily, so a warm-up pass runs first. Every loop
  // carries both a supersede check and a deadline: a caller that disappears must
  // not leave this function scrolling the app for minutes.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function args() {
    try {
      return JSON.parse(globalThis.__AG_ARGS__ || "{}");
    } catch (e) {
      return {};
    }
  }
  const headingLevel = (el) => {
    const match = /(?:^|\s)el-h([1-6])(?:\s|$)/.exec(String(el.className));
    return match ? Number(match[1]) : null;
  };
  const out = {};

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  globalThis.__AG_RUN__ = runId;
  const superseded = () => globalThis.__AG_RUN__ !== runId;

  // Measure at the same column width the capture uses. With the sidebars open a
  // 1:1 image is ~600px wide, with them collapsed ~760px — a 160px difference
  // that made every measured bottom shorter than the real capture.
  const workspace = app.workspace;
  const uiState = {
    recording: document.body.classList.contains("ag-recording"),
    left: Boolean(workspace.leftSplit?.collapsed),
    right: Boolean(workspace.rightSplit?.collapsed)
  };
  document.body.classList.add("ag-recording");
  try { workspace.leftSplit?.collapse?.(); } catch (e) {}
  try { workspace.rightSplit?.collapse?.(); } catch (e) {}
  await sleep(320);

  try {
    for (const name of args().list ?? []) {
      if (superseded()) return JSON.stringify({ aborted: true, reason: "superseded" });

      // Per-note budget: one stuck note must not hold the batch open.
      const noteDeadline = Date.now() + 45000;
      const expired = () => superseded() || Date.now() > noteDeadline;

      const file = app.vault.getAbstractFileByPath(name);
      if (!file) { out[name] = "missing"; continue; }
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      const state = leaf.getViewState();
      state.state = state.state ?? {};
      state.state.mode = "preview";
      await leaf.setViewState(state);
      await sleep(800);

      const view = leaf.view.containerEl.querySelector(".markdown-preview-view");
      if (!view) { out[name] = "no preview view"; continue; }

      // Warm-up: images decode lazily, so a block measured before its bitmap
      // loads reports zero height.
      for (let y = 0; y <= view.scrollHeight; y += 400) {
        if (expired()) return JSON.stringify({ aborted: true, reason: "deadline" });
        view.scrollTop = y;
        await sleep(150);
      }
      view.scrollTop = 0;
      await sleep(450);

      const total = view.scrollHeight;
      const blocks = new Map();

      for (let y = 0; y <= total; y += 240) {
        if (expired()) return JSON.stringify({ aborted: true, reason: "deadline" });
        view.scrollTop = y;
        await sleep(80);
        const sizer = view.querySelector(".markdown-preview-sizer");
        if (!sizer) continue;
        // Position relative to the sizer, not via scrollTop: the two move
        // together, so this stays stable while a scroll is still settling.
        const sizerTop = sizer.getBoundingClientRect().top;
        for (const el of sizer.children) {
          const rect = el.getBoundingClientRect();
          if (rect.height < 1) continue;
          const top = Math.round(rect.top - sizerTop);
          const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
          const key = `${top}|${el.tagName}|${text}`;
          if (blocks.has(key)) continue;
          blocks.set(key, {
            level: headingLevel(el),
            text,
            top,
            bottom: Math.round(rect.bottom - sizerTop)
          });
        }
      }
      view.scrollTop = 0;
      await sleep(120);

      const ordered = [...blocks.values()].sort((a, b) => a.top - b.top);
      // A heading is seen at several scroll positions. Images decoded along the
      // way push everything below them down, so the later (larger) offset is the
      // true one — taking the smallest put headings above their own content.
      const headingByText = new Map();
      for (const block of ordered) {
        if (!block.level) continue;
        const key = `${block.level}|${block.text}`;
        const previous = headingByText.get(key);
        if (!previous || block.top > previous.top) headingByText.set(key, block);
      }
      const headings = [...headingByText.values()].sort((a, b) => a.top - b.top);
      const docEnd = ordered.length ? Math.max(...ordered.map((b) => b.bottom)) : 0;

      const sections = headings.map((heading, index) => {
        let end = docEnd;
        for (let j = index + 1; j < headings.length; j += 1) {
          if (headings[j].level <= heading.level) { end = headings[j].top; break; }
        }
        // A block that starts inside the section belongs to it, even if its box
        // was measured before its image finished decoding.
        const inside = ordered.filter((b) => b !== heading && b.top >= heading.top && b.top < end);
        const lastBottom = inside.length ? Math.max(...inside.map((b) => b.bottom)) : heading.bottom;
        return {
          text: heading.text,
          level: heading.level,
          start: heading.top,
          bottom: heading.bottom,
          lastBottom,
          extent: Math.max(0, lastBottom - heading.top)
        };
      });

      out[name] = { docEnd, blocks: ordered.length, sections };
    }
  } finally {
    if (!uiState.recording) document.body.classList.remove("ag-recording");
    if (!uiState.left) { try { workspace.leftSplit?.expand?.(); } catch (e) {} }
    if (!uiState.right) { try { workspace.rightSplit?.expand?.(); } catch (e) {} }
  }
  return JSON.stringify(out);
})()
