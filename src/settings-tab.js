import { Notice, Platform, PluginSettingTab, Setting, setIcon } from "obsidian";
import { t, setLang, FOLLOW } from "./i18n.js";
import { DEFAULT_SETTINGS } from "./defaults.js";
import { MARGIN_PRESET_OPTIONS, PDF_PAGE_SIZE_NAMES } from "./print-geometry.js";

/**
 * Top navigation for the settings tab. Every entry owns one `<h3>` anchor;
 * the same lucide icon is drawn in the nav cell and in the heading so the two
 * are visually paired.
 */
const SETTINGS_SECTIONS = [
  { id: "ag-sec-basics", icon: "sliders-horizontal", labelKey: "基础", hintKey: "基础设置" },
  { id: "ag-sec-gallery", icon: "images", labelKey: "画廊", hintKey: "画廊设置" },
  { id: "ag-sec-width", icon: "move-horizontal", labelKey: "栏宽", hintKey: "栏宽控制" },
  { id: "ag-sec-pdf", icon: "printer", labelKey: "PDF", hintKey: "PDF 导出" },
  { id: "ag-sec-float", icon: "wrap-text", labelKey: "浮动截止", hintKey: "浮动截止设置" },
  { id: "ag-sec-profiles", icon: "folder-cog", labelKey: "配置管理", hintKey: "配置管理" },
  { id: "ag-sec-routes", icon: "git-branch", labelKey: "路由", hintKey: "Frontmatter 路由" }
].filter((section) => !(Platform.isMobile && section.id === "ag-sec-pdf"));

/** Breathing room between the sticky nav and a section heading it scrolled to. */
const SECTION_GAP = 12;

export class AutoGallerySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.styleEl = null;
    this.sectionSpyCleanup = null;
    this.spyFrame = null;
  }

  hide() {
    this.navResizeObserver?.disconnect();
    this.navResizeObserver = null;
    this.sectionSpyCleanup?.();
    this.sectionSpyCleanup = null;
    super.hide?.();
  }

  display() {
    const { containerEl } = this;
    // Rebuilding the tab resets every scroller on the path to the settings
    // pane. Capture all of them, not just the assumed `.vertical-tab-content`.
    const anchors = captureScrollAnchors(containerEl);
    this.sectionSpyCleanup?.();
    this.sectionSpyCleanup = null;
    // The search input and every match node are about to be discarded with the
    // rest of the pane; dropping the reference keeps a stale query from
    // painting classes into the new tree.
    this.searchState = null;
    this.navResizeObserver?.disconnect();
    this.navResizeObserver = null;
    containerEl.empty();
    this.installLayoutStyles(containerEl);
    // The pane's own top padding keeps a sticky child from reaching the top
    // edge of the scrollport, which leaves a band of scrolling text above the
    // section nav. Move that padding onto the title instead. The original value
    // is captured once, before the inline override exists.
    if (this.panePaddingTop === undefined) {
      const measured = parseFloat(getComputedStyle(containerEl).paddingTop) || 0;
      // A detached pane reports 0; fall back to the stock settings inset so a
      // stale measurement cannot push the title against the window chrome.
      this.panePaddingTop = measured > 0 ? `${measured}px` : "48px";
    }
    containerEl.style.paddingTop = "0px";
    const title = containerEl.createEl("h2", { text: "AutoGallery" });
    title.style.marginTop = this.panePaddingTop;
    this.renderSectionNav(containerEl);

    this.addSectionHeading(containerEl, "ag-sec-basics", "sliders-horizontal", t("基础设置"));
    this.addLanguageSelect(containerEl);
    this.addNumber(t("图片与说明间距"), t("图片和 caption 之间的间距。"), "captionGap", 0, 48, "px");
    this.addNumber(t("图片下边距"), t("图片布局(包括caption)与下方内容的间距。"), "imageBottomGap", 0, 80, "px");
    this.addNumber(t("正文与图片间距"), t("浮动图片和相邻正文之间的间距。"), "textGap", 0, 80, "px");
    this.addNumber(t("移动布局断点"), t("小于此宽度时，单图改为居中块布局。"), "mobileBreakpoint", 320, 1200, "px");

    this.addSectionHeading(containerEl, "ag-sec-gallery", "images", t("画廊设置"));
    this.addGalleryControl();
    this.addGalleryNumber(t("画廊最小高度"), t("多图行的最低高度。"), "galleryMinHeight", 0, 200, "px", "height");
    this.addNumber(t("画廊最大高度"), t("多图行的最高高度。超过时整行等比缩小并居中，纵向永远不裁切；也是行底横条能拖到的上限。"), "galleryMaxHeight", 120, 1200, "px");
    this.addNumber(t("孤儿图片最大高度"), t("独占一行的图片整栏高度超过此值时退出画廊、改为居中单图排版。0 表示不限制；同时作用于实时预览与阅读视图。"), "galleryOrphanMaxHeight", 0, 1200, "px");
    this.addGalleryNumber(t("画廊最大并列"), t("单行最多排列的图片数量。"), "galleryMaxPerRow", 2, 15, "幅", "count");
    this.addNumber(t("画廊图片间距"), t("同一行画廊图片之间的间距。"), "galleryGap", 0, 80, "px");

    this.addSectionHeading(containerEl, "ag-sec-width", "move-horizontal", t("栏宽控制"));
    this.addRangeNumber(t("栏宽增益"), t("控制栏宽随图片比例接近极限的速度。"), "gain");
    this.addRatioNumber(t("中位比例"), t("作为 50% 栏宽中位的图片宽高比。"), "medianRatio");
    this.addPercentNumber(t("浮动最大生效宽度"), t("计算后的图片宽度低于此比例时才产生浮动布局。"), "floatMax");
    new Setting(containerEl)
      .setName(t("实时预览拖拽调宽"))
      .setDesc(t("接管 Obsidian 原生右下角手柄进行等比缩放，抬手后写入 ag:width 并固定当前对齐；双击角标恢复自动宽度。画廊图片不提供该角标，改用行内分隔条与行底横条调整。"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.resizeEnabled !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.resizeEnabled = value;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("显示对齐箭头"))
      .setDesc(t("在实时预览的图片空余一侧常驻显示靠左/靠右按钮，点击写入 ag:side。居中图片两侧各显示一个。"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.alignButtonsEnabled !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.alignButtonsEnabled = value;
          await this.plugin.saveSettings();
        });
      });
    this.renderPdfSection(containerEl);
    this.addSectionHeading(containerEl, "ag-sec-float", "wrap-text", t("浮动截止设置"));
    this.addSelectRow(
      containerEl,
      t("浮动空间策略"),
      t("「按行文顺序对齐」：每张图只影响它后面的正文，后文不会上移填补更早图片留下的空隙。「共享浮动空间」：正文就近填空，可以上移到更早图片留下的空隙里。两者都只改变正文的位置；图片是否分行由「浮动截止 → 图片」决定。三个视图与 PDF 同步。"),
      [["ordered", t("按行文顺序对齐")], ["share", t("共享浮动空间")]],
      this.plugin.settings.floatSpaceMode === "share" ? "share" : "ordered",
      async (value) => {
        this.plugin.settings.floatSpaceMode = value === "share" ? "share" : "ordered";
        await this.plugin.saveSettings();
      }
    );
    containerEl.createEl("p", { text: t("浮动图片遇到启用的结构时停止影响后续内容。") });
    const breakLabels = [
      ["heading", t("标题")], ["code", t("代码块")], ["math", t("数学块")],
      ["image", t("图片")], ["table", t("表格")], ["quote", t("标注/引用")]
    ];
    for (const [key, label] of breakLabels) {
      new Setting(containerEl).setName(label).addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.floatBreaks?.[key] !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.floatBreaks[key] = value;
          await this.plugin.saveSettings();
        });
      });
    }

    this.addSectionHeading(containerEl, "ag-sec-profiles", "folder-cog", t("配置管理"));
    this.renderProfileSchema(containerEl);
    const importSetting = new Setting(containerEl)
      .setName(t("导入配置"))
      .setDesc(t("只导入布局模板：同 id 的模板被覆盖，文件中未提到的模板保持不变，内置 auto 不会被覆盖；任何一条模板无效时整份文件拒绝导入。"));
    const importInput = containerEl.createEl("input", { cls: "ag-profile-import-input", attr: { type: "file", accept: ".js,.json,application/javascript,application/json" } });
    importInput.hidden = true;
    importInput.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      importInput.value = "";
      if (!file) return;
      try {
        const text = typeof file.text === "function" ? await file.text() : await readFileObject(file);
        await this.plugin.importProfileText(file.name, text);
        this.display();
      } catch (error) {
        new Notice(t("导入失败：{error}", { error: error?.message || t("文件格式无效") }));
      }
    });
    importSetting.addButton((button) => button.setButtonText(t("选择文件")).onClick(() => {
      importInput.click();
    }));
    const profileList = containerEl.createDiv({ cls: "ag-profile-list" });
    const header = profileList.createDiv({ cls: "ag-profile-grid ag-list-header" });
    this.addColumnHeader(header, t("模板名称"));
    this.addColumnHeader(header, t("浮动方向"));
    const headerActions = header.createDiv({ cls: "ag-setting-actions" });
    this.addIconButton(headerActions, "arrow-up-from-line", t("导出全部"), false, () => this.plugin.exportAllProfiles());
    for (const [index, profile] of this.plugin.settings.profiles.entries()) {
      this.renderProfile(profileList, profile, index);
    }
    this.addSectionHeading(containerEl, "ag-sec-routes", "git-branch", t("Frontmatter 路由"));
    containerEl.createEl("p", { text: t("按列表顺序匹配 frontmatter 键和值。图片注释中的布局参数优先于路由模板。") });
    const routeList = containerEl.createDiv({ cls: "ag-route-list" });
    const routeHeader = routeList.createDiv({ cls: "ag-route-grid ag-list-header" });
    this.addColumnHeader(routeHeader, t("字段名"));
    this.addColumnHeader(routeHeader, t("字段值"));
    this.addColumnHeader(routeHeader, t("路由模板"));
    routeHeader.createDiv({ cls: "ag-setting-actions" });
    for (const [index, route] of this.plugin.settings.routes.entries()) this.renderRoute(routeList, route, index);
    new Setting(containerEl).addButton((button) => button
      .setButtonText(t("添加路由"))
      .setCta()
      .onClick(async () => {
        this.plugin.settings.routes.push({
          id: `route-${Date.now()}`,
          key: "role",
          value: "",
          profile: "auto",
          enabled: true
        });
        await this.plugin.saveSettings();
        this.display();
      }));
    this.installSectionSpy(containerEl);
    restoreScrollAnchors(anchors);
  }

  /**
   * Language switcher pinned to the top of Basic settings. The globe icon and the
   * bilingual label make it findable even before the user picks a language: in
   * the default Chinese locale it reads "🌐 语言 / Language", and once another
   * language is active the label collapses to that language via t().
   */
  addLanguageSelect(container) {
    const setting = new Setting(container)
      .setName(t("settings.language"))
      .setDesc(t("界面显示语言。"))
      .addDropdown((dropdown) => {
        dropdown.addOption(FOLLOW, t("跟随Obsidian"));
        dropdown.addOption("zh", t("中文(简体)"));
        dropdown.addOption("en", "English");
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value) => {
          this.plugin.settings.language = value;
          setLang(value);
          await this.plugin.saveSettings();
          this.display();
        });
      });
    const icon = setting.nameEl.createSpan({ cls: "ag-lang-flag" });
    icon.style.marginRight = "6px";
    setIcon(icon, "languages");
    setting.nameEl.prepend(icon);
  }

  renderSectionNav(container) {
    // The sticky block owns the section grid and the collapsible find panel, so
    // opening the panel grows the sticky area instead of pushing a second,
    // separately positioned bar into the pane.
    const head = container.createDiv({ cls: "ag-settings-head" });
    const nav = head.createDiv({ cls: "ag-section-nav", attr: { role: "navigation", "aria-label": t("设置目录") } });
    for (const section of SETTINGS_SECTIONS) {
      const item = nav.createEl("button", { cls: "ag-nav-item", attr: { type: "button", title: t(section.hintKey) } });
      item.dataset.target = section.id;
      const iconEl = item.createSpan({ cls: "ag-nav-icon" });
      setIcon(iconEl, section.icon);
      item.createSpan({ cls: "ag-nav-label", text: t(section.labelKey) });
      item.addEventListener("click", () => this.scrollToSection(section.id));
    }
    this.renderSettingSearch(head, nav);
  }

  /**
   * The find control: one nav cell opens the panel, one button runs the search.
   *
   * The cell fills the leftover column of the section grid (the seven sections
   * do not fill the row at every width) and keeps the grid's icon/label shape,
   * so it reads as one more entry rather than a stray control. Opening only
   * reveals the panel; the highlighted 搜索 button inside it is the mouse
   * equivalent of Enter, which is what actually jumps.
   */
  renderSettingSearch(head, nav) {
    const toggle = nav.createEl("button", {
      cls: "ag-nav-item ag-nav-search",
      attr: { type: "button", title: t("搜索设置"), "aria-label": t("搜索设置"), "aria-expanded": "false" }
    });
    const toggleIcon = toggle.createSpan({ cls: "ag-nav-icon" });
    setIcon(toggleIcon, "search");
    toggle.createSpan({ cls: "ag-nav-label", text: t("搜索") });

    const panel = head.createDiv({
      cls: "ag-setting-search",
      attr: { role: "search", "aria-hidden": "true" }
    });
    panel.setAttribute("inert", "");
    const inner = panel.createDiv({ cls: "ag-setting-search-inner" });
    // The border belongs to the field, not to the whole bar: the magnifier is
    // then vertically centred against the text box it belongs to, with the
    // text starting behind it instead of beside a floating glyph.
    const field = inner.createDiv({ cls: "ag-setting-search-field" });
    const icon = field.createSpan({ cls: "ag-setting-search-icon" });
    setIcon(icon, "search");
    const input = field.createEl("input", {
      cls: "ag-setting-search-input",
      attr: { type: "search", placeholder: t("使用回车确认搜索"), "aria-label": t("搜索设置项") }
    });
    const results = inner.createDiv({
      cls: "ag-setting-search-results",
      attr: { role: "group", "aria-label": t("匹配导航") }
    });
    const resultsInner = results.createDiv({ cls: "ag-setting-search-results-inner" });
    const count = resultsInner.createSpan({ cls: "ag-setting-search-count", attr: { "aria-live": "polite" } });
    const previous = resultsInner.createEl("button", {
      cls: "ag-setting-search-button",
      attr: { type: "button", title: t("上一个匹配（Shift+Enter）"), "aria-label": t("上一个匹配") }
    });
    setIcon(previous, "chevron-up");
    const next = resultsInner.createEl("button", {
      cls: "ag-setting-search-button",
      attr: { type: "button", title: t("下一个匹配（Enter）"), "aria-label": t("下一个匹配") }
    });
    setIcon(next, "chevron-down");
    const submit = inner.createEl("button", {
      cls: "ag-setting-search-submit",
      attr: { type: "button", title: t("搜索设置") }
    });
    submit.textContent = t("搜索");

    this.searchState = {
      panel, toggle, input, count, previous, next, submit, results,
      query: "", matches: [], index: -1, open: false
    };
    // The button is one nav cell wide. The pane can still be detached here, so
    // the measuring pass retries a frame later when the cells have no box yet.
    requestAnimationFrame(() => this.syncSearchMetrics());
    this.navResizeObserver?.disconnect();
    this.navResizeObserver = new ResizeObserver(() => this.syncSearchMetrics());
    this.navResizeObserver.observe(nav);

    toggle.addEventListener("click", () => this.toggleSettingSearch());
    input.addEventListener("input", () => this.updateSettingMatches());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.triggerSettingSearch();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        this.updateSettingMatches();
        this.moveSettingMatch(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        this.updateSettingMatches();
        this.moveSettingMatch(-1);
      }
    });
    previous.addEventListener("click", () => this.moveSettingMatch(-1));
    next.addEventListener("click", () => this.moveSettingMatch(1));
    submit.addEventListener("click", () => this.triggerSettingSearch());
    this.syncSettingSearchControls();
  }

  /** Show or hide the find panel; closing it also drops the query and marks. */
  toggleSettingSearch() {
    const state = this.searchState;
    if (!state) return;
    state.open = !state.open;
    state.panel.classList.toggle("is-open", state.open);
    state.toggle.classList.toggle("is-active", state.open);
    state.toggle.setAttribute("aria-expanded", String(state.open));
    state.panel.setAttribute("aria-hidden", String(!state.open));
    if (state.open) {
      state.panel.removeAttribute("inert");
      // The nav has a real box by now; re-measure so the button already sits in
      // its cell on the first frame of the reveal animation.
      this.syncSearchMetrics();
      state.input.focus({ preventScroll: true });
      state.input.select();
      return;
    }
    state.panel.setAttribute("inert", "");
    state.input.value = "";
    state.input.blur();
    this.updateSettingMatches();
  }

  /** Enter and the highlighted 搜索 button do the same thing. */
  triggerSettingSearch() {
    const state = this.searchState;
    if (!state?.open) return;
    if (!state.input.value.trim()) {
      state.input.focus({ preventScroll: true });
      return;
    }
    this.updateSettingMatches();
    this.moveSettingMatch(1);
  }

  /**
   * Recompute the match list. Entries and section headings are read in document
   * order; a heading is itself a jump target, so a query for "PDF" lands on the
   * start of that section instead of matching every field inside it.
   */
  updateSettingMatches() {
    const state = this.searchState;
    if (!state) return;
    const query = state.input.value.trim().toLowerCase();
    if (query !== state.query) {
      for (const item of state.matches) {
        item.classList.remove("ag-setting-match", "ag-setting-match-current");
      }
      state.query = query;
      state.index = -1;
      state.matches = [];
      if (query) {
        for (const element of this.containerEl.querySelectorAll(".ag-section-heading, .setting-item")) {
          if (element.classList.contains("ag-section-heading")) {
            if ((element.textContent ?? "").toLowerCase().includes(query)) state.matches.push(element);
            continue;
          }
          const name = element.querySelector(".setting-item-name")?.textContent ?? "";
          const description = element.querySelector(".setting-item-description")?.textContent ?? "";
          if (`${name} ${description}`.toLowerCase().includes(query)) state.matches.push(element);
        }
        for (const item of state.matches) item.classList.add("ag-setting-match");
      }
      this.syncSettingSearchControls();
    }
  }

  /** Step to the next/previous match, wrapping at both ends like a find bar. */
  moveSettingMatch(step) {
    const state = this.searchState;
    if (!state?.matches.length) return;
    const total = state.matches.length;
    state.index = state.index < 0
      ? (step > 0 ? 0 : total - 1)
      : (state.index + step + total) % total;
    for (const item of state.matches) {
      item.classList.toggle("ag-setting-match-current", item === state.matches[state.index]);
    }
    this.syncSettingSearchControls();
    this.scrollToSetting(state.matches[state.index]);
  }

  syncSettingSearchControls() {
    const state = this.searchState;
    if (!state) return;
    const total = state.matches.length;
    state.count.textContent = total
      ? `${state.index >= 0 ? state.index + 1 : "-"}/${total}`
      : state.query ? t("无结果") : "";
    state.previous.disabled = total === 0;
    state.next.disabled = total === 0;
    // The cluster is absent until the reader types; a query with no match
    // still opens it to show 无结果 (the arrows stay disabled), so a failed
    // search is never silent.
    state.results.classList.toggle("is-visible", Boolean(state.query));
    state.results.classList.toggle("is-empty", Boolean(state.query) && total === 0);
    state.panel.classList.toggle("is-empty", Boolean(state.query) && total === 0);
  }

  /**
   * Measure the nav cell the search button has to match.
   *
   * The button is the row's last element: one nav cell wide, pinned to the
   * pane's right edge. Idle, the field runs right up to it across one gap, so
   * no slot is left empty under the section grid. When the jump tile opens it
   * takes its width back from the field, never from the button.
   *
   * A detached pane reports zero-width cells; in that case measure again on
   * the next frame instead of leaving the row on the fallback width.
   */
  syncSearchMetrics(retry = 2) {
    const nav = this.containerEl.querySelector(".ag-section-nav");
    const inner = this.containerEl.querySelector(".ag-setting-search-inner");
    if (!nav || !inner) return;
    const items = [...nav.querySelectorAll(".ag-nav-item")];
    const cell = items.at(-1)?.getBoundingClientRect().width ?? 0;
    if (cell < 20) {
      if (retry > 0) requestAnimationFrame(() => this.syncSearchMetrics(retry - 1));
      return;
    }
    inner.style.setProperty("--ag-nav-cell", `${cell}px`);
  }

  /** Put a settings entry just under the sticky nav, like a find result. */
  scrollToSetting(element) {
    const scroller = findScrollParent(this.containerEl);
    if (!scroller) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const headHeight = this.containerEl.querySelector(".ag-settings-head")?.offsetHeight ?? 0;
    const delta = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const top = Math.max(0, scroller.scrollTop + delta - headHeight - SECTION_GAP);
    scroller.scrollTo({ top, behavior: "smooth" });
  }
  /**
   * Bring a section heading to rest just under the sticky nav.
   *
   * `scrollIntoView` cannot express that: the pane's `scroll-padding-top` plus
   * a fixed `scroll-margin-top` add up to a gap that neither follows the nav's
   * real height nor stays tight. Scrolling by hand also lets the first section
   * return to the very top instead of hiding the page title.
   */
  scrollToSection(id) {
    const heading = this.containerEl.querySelector(`#${id}`);
    if (!heading) return;
    const scroller = findScrollParent(this.containerEl);
    if (!scroller) {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const headHeight = this.containerEl.querySelector(".ag-settings-head")?.offsetHeight ?? 0;
    const delta = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const first = SETTINGS_SECTIONS[0]?.id === id;
    const top = first ? 0 : Math.max(0, scroller.scrollTop + delta - headHeight - SECTION_GAP);
    scroller.scrollTo({ top, behavior: "smooth" });
    this.setActiveSection(id);
  }

  addSectionHeading(container, id, icon, text) {
    const heading = container.createEl("h3", { cls: "ag-section-heading", attr: { id } });
    const iconEl = heading.createSpan({ cls: "ag-section-icon" });
    setIcon(iconEl, icon);
    heading.createSpan({ cls: "ag-section-text", text });
    return heading;
  }

  setActiveSection(id) {
    const nav = this.containerEl.querySelector(".ag-section-nav");
    if (!nav) return;
    for (const item of nav.querySelectorAll(".ag-nav-item")) {
      // The find toggle shares the nav shape but owns no section; its active
      // state belongs to the panel, not to the scroll spy.
      if (!item.dataset.target) continue;
      const active = item.dataset.target === id;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-current", active ? "true" : "false");
    }
  }

  /**
   * Highlight the section the reader is currently looking at. The settings tab
   * scrolls its own container (`.vertical-tab-content`), not `window`, so the
   * listener has to sit on that element.
   */
  installSectionSpy(container) {
    if (!container.querySelector(".ag-section-heading")) return;
    const scroller = findScrollParent(container);
    const update = () => {
      // The nav can wrap onto a second row in a narrow window, so its height is
      // read live instead of being captured once.
      const headHeight = container.querySelector(".ag-settings-head")?.offsetHeight ?? 0;
      const line = (scroller?.getBoundingClientRect().top ?? 0) + headHeight + SECTION_GAP + 4;
      let current = SETTINGS_SECTIONS[0].id;
      for (const section of SETTINGS_SECTIONS) {
        const heading = container.querySelector(`#${section.id}`);
        if (heading && heading.getBoundingClientRect().top <= line) current = section.id;
      }
      // A section that sits in the last viewport can never reach the line; the
      // bottom of the page is the only honest answer there.
      if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 2) {
        current = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id;
      }
      this.setActiveSection(current);
    };
    const onScroll = () => {
      if (this.spyFrame) return;
      this.spyFrame = requestAnimationFrame(() => {
        this.spyFrame = null;
        update();
      });
    };
    const target = scroller ?? container.ownerDocument;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    this.sectionSpyCleanup = () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (this.spyFrame) cancelAnimationFrame(this.spyFrame);
      this.spyFrame = null;
    };
    update();
  }

  renderPdfSection(container) {
    if (Platform.isMobile) return;
    const pdf = { ...DEFAULT_SETTINGS.pdfExport, ...(this.plugin.settings.pdfExport ?? {}) };
    const pagination = this.plugin.settings.pdfPagination ?? DEFAULT_SETTINGS.pdfPagination;
    const savePdf = async (patch) => {
      this.plugin.settings.pdfExport = { ...this.plugin.settings.pdfExport, ...patch };
      await this.plugin.saveSettings();
    };

    this.addSectionHeading(container, "ag-sec-pdf", "printer", t("PDF 导出（AutoGallery）"));
    container.createEl("p", { text: t("导出在 Obsidian 主窗口中完成渲染、测量与分页，图片尺寸、浮动、画廊与标题分页会完整生效。命令面板与文件右键菜单也可触发。") });

    const available = this.plugin.pdfExporter?.isAvailable() === true;
    new Setting(container)
      .setName(t("导出当前笔记"))
      .setDesc(available ? t("使用 AutoGallery 管线导出。") : t("当前平台不可用，需要桌面版 Obsidian。"))
      .addButton((button) => button
        .setButtonText(t("导出 PDF"))
        .setCta()
        .setDisabled(!available)
        .onClick(() => {
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") {
            new Notice(t("当前没有可导出的 Markdown 笔记。"));
            return;
          }
          this.plugin.pdfExporter?.exportFile(file);
        }));

    this.addSelectRow(container, t("纸张"), t("跟随 Obsidian 时使用原生导出设置中的纸张大小。"),
      [["inherit", t("跟随 Obsidian")], ...PDF_PAGE_SIZE_NAMES.map((name) => [name, name])],
      pdf.pageSize, (value) => savePdf({ pageSize: value }));
    this.addSelectRow(container, t("方向"), t("跟随 Obsidian 时使用原生导出设置中的方向。"),
      [["inherit", t("跟随 Obsidian")], ["portrait", t("纵向")], ["landscape", t("横向")]],
      pdf.orientation, (value) => savePdf({ orientation: value }));
    this.addSelectRow(container, t("页边距"), t("自定义边距以毫米为单位，它直接决定可排版内容的宽度。"),
      [["inherit", t("跟随 Obsidian")], ["preset", t("预设")], ["custom", t("自定义")]],
      pdf.marginMode, async (value) => {
        await savePdf({ marginMode: value });
        this.display();
      });
    if (pdf.marginMode === "preset") {
      this.addSelectRow(container, t("边距预设"), t("与 Word 一致的常用版心，括号内为四边边距。"),
        MARGIN_PRESET_OPTIONS.map(([v, l]) => [v, t(l)]),
        pdf.marginPreset, (value) => savePdf({ marginPreset: value }));
    }
    if (pdf.marginMode === "preset" || pdf.marginMode === "custom") {
      new Setting(container)
        .setName(t("奇偶页不同"))
        .setDesc(t("装订侧（内）与外侧使用不同边距：奇数页内侧在左，偶数页内侧在右。上下边距仍取上面的设置。"))
        .addToggle((toggle) => {
          toggle.setValue(pdf.mirrorMargins === true);
          toggle.onChange(async (value) => {
            await savePdf({ mirrorMargins: value });
            this.display();
          });
        });
    }
    if (pdf.mirrorMargins === true && (pdf.marginMode === "preset" || pdf.marginMode === "custom")) {
      const row = container.createDiv({ cls: "ag-pdf-margin-grid" });
      for (const [key, label] of [["innerMarginMm", "内侧"], ["outerMarginMm", "外侧"]]) {
        const field = row.createDiv({ cls: "ag-setting-field" });
        field.createEl("label", { text: t(label) });
        const input = field.createEl("input", { attr: { type: "number", min: "0", max: "80", step: "1" } });
        input.value = String(Math.round(Number(pdf[key] ?? (key === "innerMarginMm" ? 20 : 12))));
        this.attachUnit(input, "mm");
        input.addEventListener("change", () => savePdf({
          [key]: Math.max(0, Math.min(80, Number(input.value) || 0))
        }));
      }
    }
    if (pdf.marginMode === "custom") {
      const row = container.createDiv({ cls: "ag-pdf-margin-grid" });
      for (const [key, label] of [["top", "上"], ["right", "右"], ["bottom", "下"], ["left", "左"]]) {
        const field = row.createDiv({ cls: "ag-setting-field" });
        field.createEl("label", { text: t(label) });
        const input = field.createEl("input", { attr: { type: "number", min: "0", max: "50", step: "1" } });
        input.value = String(Math.round(Number(pdf.marginMm?.[key] ?? 12)));
        this.attachUnit(input, "mm");
        input.addEventListener("change", () => savePdf({
          marginMm: { ...pdf.marginMm, [key]: Math.max(0, Math.min(50, Number(input.value) || 0)) }
        }));
      }
    }

    new Setting(container)
      .setName(t("缩放"))
      .setDesc(t("百分比；留空时跟随 Obsidian 原生导出设置。"))
      .addText((text) => {
        // No placeholder: the unit already sits in the field, and a long hint
        // would be clipped by it. The description explains that an empty value
        // follows Obsidian.
        text.setValue(pdf.scalePercent === "inherit" ? "" : String(pdf.scalePercent));
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "200";
        text.inputEl.step = "1";
        text.inputEl.addEventListener("change", () => {
          const raw = text.inputEl.value.trim();
          const value = raw ? Math.max(10, Math.min(200, Math.round(Number(raw) || 100))) : "inherit";
          savePdf({ scalePercent: value });
        });
        this.attachUnit(text.inputEl, "%");
      });
    new Setting(container)
      .setName(t("包含笔记标题"))
      .setDesc(t("在文档开头插入笔记名。"))
      .addToggle((toggle) => {
        toggle.setValue(pdf.includeTitle === true);
        toggle.onChange((value) => savePdf({ includeTitle: value }));
      });
    const pageNumber = pdf.pageNumber ?? { enabled: true, band: "footer", align: "center" };
    const livePageNumber = () => ({ ...pageNumber, ...(this.plugin.settings.pdfExport?.pageNumber ?? {}) });
    new Setting(container)
      .setName(t("页码"))
      .setDesc(t("在页边距内印上「当前页/总页数」。页码属于页边距的一部分：放页尾时下边距、放页眉时上边距至少保留 11 mm，否则数字会被裁掉。"))
      .addToggle((toggle) => {
        toggle.setValue(pageNumber.enabled !== false);
        toggle.onChange(async (value) => {
          await savePdf({ pageNumber: { ...pageNumber, enabled: value } });
          this.display();
        });
      });
    if (pageNumber.enabled !== false) {
      this.addSelectRow(container, t("页码位置"), t("页眉在版心上沿外侧，页尾在版心下沿外侧。"),
        [["header", t("页眉")], ["footer", t("页尾")]],
        pageNumber.band, (value) => savePdf({ pageNumber: { ...livePageNumber(), band: value } }));
      this.addSelectRow(container, t("页码对齐"), t("相对于版心左右边界对齐。"),
        [["left", t("居左")], ["center", t("居中")], ["right", t("居右")]],
        pageNumber.align, (value) => savePdf({ pageNumber: { ...livePageNumber(), align: value } }));
    }
    this.addSelectRow(container, t("打印窗口默认视图"),
      t("版式预览直接复用 Obsidian 的排版、连续不分页，打开即可用；分页预览会先真实打印一份临时 PDF 再逐页显示，长文档需要等待分页计算。"),
      [["layout", t("版式预览")], ["pages", t("分页预览")]],
      pdf.previewMode, (value) => savePdf({ previewMode: value }));
    new Setting(container)
      .setName(t("导出超时"))
      .setDesc(t("超过此秒数仍未完成打印时回退到 Obsidian 原生导出。"))
      .addText((text) => {
        text.setValue(String(Math.round((pdf.timeoutMs ?? 60000) / 1000)));
        text.inputEl.type = "number";
        text.inputEl.min = "5";
        text.inputEl.max = "180";
        text.inputEl.step = "5";
        text.inputEl.addEventListener("change", () => savePdf({
          timeoutMs: Math.max(5, Math.min(180, Number(text.inputEl.value) || 60)) * 1000
        }));
        this.attachUnit(text.inputEl, "s");
      });

    container.createEl("h3", { text: t("原生导出拦截") });
    new Setting(container)
      .setName(t("在 Obsidian 原生 PDF 导出中生效"))
      .setDesc(t("原生导出使用隐藏弹窗，没有可测量的视口，分页优化只能部分运行；建议使用上面的 AutoGallery 导出。"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.pdfExportEnabled === true);
        toggle.onChange(async (value) => {
          this.plugin.settings.pdfExportEnabled = value;
          await this.plugin.saveSettings();
        });
      });

    container.createEl("h3", { text: t("PDF 分页优化") });
    new Setting(container)
      .setName(t("默认标题分页导出设置"))
      .setDesc(t("导出窗口的标题分页默认继承此开关与等级；窗口内的临时修改只对当次导出生效。"))
      .addToggle((toggle) => {
        toggle.setValue(pagination.headingBreakEnabled === true);
        toggle.onChange(async (value) => {
          this.plugin.settings.pdfPagination.headingBreakEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    new Setting(container)
      .setName(t("标题分页起始等级"))
      .setDesc(t("选择 h2 时，h1 和 h2 标题参与分页。"))
      .addDropdown((dropdown) => {
        for (let level = 1; level <= 6; level += 1) dropdown.addOption(String(level), `h${level}`);
        dropdown.setValue(String(pagination.headingBreakLevel ?? 2));
        dropdown.setDisabled(pagination.headingBreakEnabled !== true);
        dropdown.onChange(async (value) => {
          this.plugin.settings.pdfPagination.headingBreakLevel = Number(value);
          await this.plugin.saveSettings();
        });
      });
    this.addPdfPaginationControls(container, pagination);
  }

  addSelectRow(container, name, description, options, value, onChange) {
    new Setting(container).setName(name).setDesc(description).addDropdown((dropdown) => {
      for (const [optionValue, label] of options) dropdown.addOption(optionValue, label);
      dropdown.setValue(String(value));
      dropdown.onChange((next) => { onChange(next); });
    });
  }

  addPdfPaginationControls(container, pagination) {
    new Setting(container)
      .setName(t("图片分页优化"))
      .setDesc(t("图片因页末剩余空间不足换页时，按优先级压缩当前页内容以尝试容纳完整图片和说明。"))
      .addToggle((toggle) => {
        toggle.setValue(pagination.imageOptimizationEnabled !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.pdfPagination.imageOptimizationEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    const enabled = pagination.imageOptimizationEnabled !== false;
    new Setting(container)
      .setName(t("图片分页优化优先使用裕度"))
      .setDesc(t("选择优先压缩图片高度还是文本行距。"))
      .addDropdown((dropdown) => {
        dropdown.addOption("image", t("图片高度"));
        dropdown.addOption("line", t("行距"));
        dropdown.setValue(pagination.imageShrinkPriority === "line" ? "line" : "image");
        dropdown.setDisabled(!enabled);
        dropdown.onChange(async (value) => {
          this.plugin.settings.pdfPagination.imageShrinkPriority = value;
          await this.plugin.saveSettings();
        });
      });
    this.addPdfPercent(container, t("图片最大压缩高度"), t("图片最大允许缩小比例。"), "singleImageMaxShrink", 50, enabled);
    this.addPdfPercent(container, t("行距最大压缩高度"), t("文本和表格行高最大允许缩小比例。"), "lineHeightMaxShrink", 20, enabled);
    new Setting(container)
      .setName(t("孤行控制"))
      .setDesc(t("启用 AutoGallery 的压缩孤行控制；关闭时保留 Obsidian 原生孤行处理。"))
      .addToggle((toggle) => {
        toggle.setValue(pagination.orphanControlEnabled !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.pdfPagination.orphanControlEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    new Setting(container)
      .setName(t("末页允许行数"))
      .setDesc(t("末页不超过该行数时，尝试压缩上一页内容把这几行收回去。"))
      .addDropdown((dropdown) => {
        for (let lines = 1; lines <= 5; lines += 1) dropdown.addOption(String(lines), t("{lines} 行", { lines }));
        dropdown.setValue(String(pagination.orphanMaxLines ?? 2));
        dropdown.setDisabled(pagination.orphanControlEnabled === false);
        dropdown.onChange(async (value) => {
          this.plugin.settings.pdfPagination.orphanMaxLines = Number(value);
          await this.plugin.saveSettings();
        });
      });
  }

  addPdfPercent(container, name, description, key, maxPercent, enabled) {
    const setting = new Setting(container).setName(name).setDesc(description);
    const current = Math.round(Math.max(0, Math.min(maxPercent, Number(this.plugin.settings.pdfPagination?.[key] ?? DEFAULT_SETTINGS.pdfPagination[key]) * 100)));
    this.addLinkedSlider(setting, {
      value: current,
      min: 0,
      max: maxPercent,
      disabled: !enabled,
      unit: "%",
      onChange: (value) => {
        this.plugin.settings.pdfPagination[key] = value / 100;
        return this.plugin.saveSettings();
      }
    });
    setting.addButton((button) => {
      button.setTooltip(t("恢复默认")); setIcon(button.buttonEl, "rotate-ccw"); button.setDisabled(!enabled);
      button.onClick(async () => {
        this.plugin.settings.pdfPagination[key] = DEFAULT_SETTINGS.pdfPagination[key];
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  /** A slider and a number field that always mirror each other. */
  addLinkedSlider(setting, { value, min, max, disabled = false, unit = "", onChange }) {
    let sliderRef = null;
    let textRef = null;
    const clamp = (raw) => {
      const number = Number(raw);
      const safe = Number.isFinite(number) ? Math.round(number) : Math.round(Number(value) || min);
      return Math.max(min, Math.min(max, safe));
    };
    const commit = (next) => {
      const clamped = clamp(next);
      Promise.resolve(onChange(clamped)).catch((error) => {
        new Notice(t("保存失败：{error}", { error: error?.message || t("未知错误") }));
      });
    };
    setting.addSlider((slider) => {
      sliderRef = slider;
      slider.setLimits(min, max, 1).setValue(clamp(value)).setDynamicTooltip();
      slider.setDisabled(disabled);
      slider.onChange((raw) => {
        const next = clamp(raw);
        textRef?.setValue(String(next));
        commit(next);
      });
    });
    setting.addText((text) => {
      textRef = text;
      text.setValue(String(clamp(value)));
      text.inputEl.type = "number";
      text.inputEl.min = String(min);
      text.inputEl.max = String(max);
      text.inputEl.step = "1";
      text.inputEl.disabled = disabled;
      this.attachUnit(text.inputEl, unit);
      // Preview on the slider while typing; persist once the field commits.
      text.inputEl.addEventListener("input", () => {
        const raw = Number(text.inputEl.value);
        if (Number.isFinite(raw)) sliderRef?.setValue(clamp(raw));
      });
      text.inputEl.addEventListener("change", () => {
        const next = clamp(text.inputEl.value);
        text.inputEl.value = String(next);
        sliderRef?.setValue(next);
        commit(next);
      });
    });
  }

  installLayoutStyles(container) {
    this.styleEl?.remove();
    this.styleEl = container.createEl("style");
    this.styleEl.textContent = `
      .ag-settings-head { position: sticky; top: 0; z-index: 20; margin: 0 0 4px; padding: 8px 0 10px; background: var(--background-primary); }
      .ag-section-nav { display: grid; grid-template-columns: repeat(auto-fit, minmax(62px, 1fr)); gap: 6px; }
      .ag-nav-item { display: grid; justify-items: center; align-content: center; gap: 5px; height: auto; padding: 8px 4px; border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-secondary); box-shadow: none; color: var(--text-muted); cursor: pointer; }
      .ag-nav-item:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
      .ag-nav-item.is-active { color: var(--text-accent); border-color: var(--background-modifier-border-focus); background: var(--background-secondary-alt); }
      .ag-nav-icon { display: flex; }
      .ag-nav-icon svg { width: 20px; height: 20px; }
      .ag-nav-label { font-size: var(--font-ui-smaller); line-height: 1.1; white-space: nowrap; }
      /* The find panel is one grid track tall when open and collapses to zero
         when closed, so the sticky block grows downwards without a leftover
         gap and both directions animate. */
      .ag-setting-search { display: grid; grid-template-rows: 0fr; opacity: 0; margin-top: 0; transition: grid-template-rows 200ms ease, opacity 160ms ease, margin-top 200ms ease; }
      .ag-setting-search.is-open { grid-template-rows: 1fr; opacity: 1; margin-top: 6px; }
      .ag-setting-search-inner { display: flex; align-items: center; min-height: 0; overflow: hidden; }
      /* The row is the field plus exactly one nav cell for the button. Idle the
         field runs all the way to the button with a single 6px gap, so there is
         no empty slot under the section grid. A query with results opens the
         jump tile between them and the field gives up that width - the button
         keeps its cell and its position the whole time. */
      .ag-setting-search-inner .ag-setting-search-results {
        flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end;
        box-sizing: border-box; width: 0; height: 34px; margin-left: 0;
        overflow: hidden; opacity: 0; border-radius: 8px;
        background: var(--background-secondary-alt);
        box-shadow: inset 0 0 0 1px var(--background-modifier-border);
        transition: width 220ms ease, margin-left 220ms ease, opacity 160ms ease;
      }
      .ag-setting-search-inner .ag-setting-search-results.is-visible { width: var(--ag-nav-cell, 70px); margin-left: 6px; opacity: 1; }
      .ag-setting-search-inner .ag-setting-search-results.is-empty { box-shadow: inset 0 0 0 1px var(--background-modifier-error); }
      /* The controls are right-pinned, so the tile opens leftwards from the
         button and the count unfurls last; clearing the query plays the same
         motion backwards while the field takes the width back. */
      .ag-setting-search-results-inner { flex: 0 0 auto; display: flex; align-items: center; gap: 1px; margin-right: 2px; white-space: nowrap; opacity: 0; transition: opacity 140ms ease; }
      .ag-setting-search-results.is-visible .ag-setting-search-results-inner { opacity: 1; }
      .ag-setting-search-results.is-empty .ag-setting-search-results-inner { flex: 1 1 auto; justify-content: center; }
      .ag-setting-search-field { flex: 1 1 0; display: flex; align-items: center; gap: 6px; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-secondary); }
      .ag-setting-search-field:focus-within { border-color: var(--background-modifier-border-focus); }
      .ag-setting-search.is-empty .ag-setting-search-field { border-color: var(--background-modifier-error); }
      .ag-setting-search-icon { display: flex; flex: 0 0 auto; color: var(--text-muted); }
      .ag-setting-search-icon svg { width: 15px; height: 15px; }
      .ag-setting-search .ag-setting-search-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0; border: none; border-radius: 0; background: transparent; box-shadow: none; font-size: var(--font-ui-small); }
      .ag-setting-search .ag-setting-search-input:focus { border: none; box-shadow: none; }
      .ag-setting-search .ag-setting-search-input::-webkit-search-cancel-button { cursor: pointer; }
      .ag-setting-search-results.is-empty .ag-setting-search-button { display: none; }
      .ag-setting-search-count { flex: 0 0 auto; width: 28px; min-width: 0; color: var(--text-muted); font-size: 10px; letter-spacing: -0.2px; font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; }
      .ag-setting-search-results.is-empty .ag-setting-search-count { width: auto; font-size: var(--font-ui-smaller); letter-spacing: normal; }
      .ag-setting-search .ag-setting-search-button { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 18px; height: 22px; padding: 0; border: none; border-radius: 4px; background: transparent; box-shadow: none; color: var(--text-muted); cursor: pointer; }
      .ag-setting-search .ag-setting-search-button:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
      .ag-setting-search .ag-setting-search-button:disabled { opacity: .35; cursor: default; background: transparent; }
      .ag-setting-search .ag-setting-search-submit { flex: 0 0 var(--ag-nav-cell, 70px); width: var(--ag-nav-cell, 70px); height: 34px; margin-left: 6px; padding: 0; border: none; border-radius: 8px; background: var(--interactive-accent); color: var(--text-on-accent); box-shadow: none; font-size: var(--font-ui-small); font-weight: var(--font-weight-semibold); cursor: pointer; white-space: nowrap; }
      .ag-setting-search .ag-setting-search-submit:hover { background: var(--interactive-accent-hover); color: var(--text-on-accent); }
      .ag-section-heading { display: flex; align-items: center; gap: 8px; }
      .ag-section-icon { display: flex; color: var(--text-muted); }
      .ag-section-icon svg { width: 18px; height: 18px; }
      .ag-route-list, .ag-profile-list { display: grid; align-items: center; column-gap: 8px; row-gap: 10px; width: 100%; margin: 8px 0; }
      .ag-route-list { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
      .ag-profile-list { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) auto; }
      /* One shared grid for the whole list: every row contributes its cells
         directly, so a row without a delete button cannot widen its inputs. */
      .ag-route-list > .ag-route-grid, .ag-profile-list > .ag-profile-grid { display: contents; }
      .ag-list-header > .ag-column-header { width: 100%; min-width: 0; justify-self: stretch; align-self: stretch; }
      .ag-column-header { justify-content: center; }
      .ag-column-header label { display: block; width: 100%; margin: 0; text-align: left; font-weight: var(--font-weight-semibold); line-height: 1.2; }
      .ag-route-grid > .ag-setting-field, .ag-profile-grid > .ag-setting-field { width: 100%; justify-self: stretch; }
      .ag-route-grid > .ag-setting-actions, .ag-profile-grid > .ag-setting-actions { align-self: center; }
      .ag-route-grid > .ag-setting-actions { justify-self: start; }
      .ag-profile-grid > .ag-setting-actions { justify-content: flex-end; justify-self: end; }
      .ag-setting-field { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; }
      .ag-setting-field label { white-space: normal; overflow-wrap: anywhere; }
      .ag-setting-field input, .ag-setting-field select { box-sizing: border-box; display: block; width: 100%; min-width: 0; }
      /* One width for every numeric setting control, with its unit pinned
         inside the box. Obsidian sizes an input to its content, so 48 and 1200
         used to produce different widths down the same column and the unit had
         to live in the description. */
      .ag-setting-input { position: relative; display: flex; flex: 0 0 auto; align-items: center; box-sizing: border-box; width: 72px; }
      .ag-setting-input > input { box-sizing: border-box; width: 100%; height: 30px; padding-right: 8px; text-align: right; }
      /* The real padding is measured per unit in attachUnit; this is only the
         pre-measure fallback so the first frame cannot show the unit on top of
         the digits. */
      .ag-setting-input.has-unit > input { padding-right: 24px; }
      .ag-setting-input > input::-webkit-inner-spin-button,
      .ag-setting-input > input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      .ag-setting-unit { position: absolute; right: 7px; color: var(--text-muted); font-size: var(--font-ui-smaller); line-height: 1; pointer-events: none; }
      .ag-setting-input.is-disabled .ag-setting-unit { opacity: .5; }
      .ag-pdf-margin-grid .ag-setting-input { width: 100%; }
      .ag-setting-actions { display: flex; align-items: center; justify-content: flex-start; gap: 4px; min-height: 32px; }
      .ag-profile-schema { display: grid; gap: 14px; margin: 10px 0 18px; padding: 16px 18px; border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-secondary); font-size: var(--font-ui-small); line-height: 1.5; }
      .ag-profile-schema h4 { margin: 0; font-size: var(--font-ui-medium); font-weight: var(--font-weight-semibold); }
      .ag-profile-schema p { margin: 0; }
      .ag-profile-schema code { padding: 1px 4px; border-radius: 3px; background: var(--background-modifier-hover); color: var(--text-normal); font-size: .92em; }
      .ag-schema-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border); }
      .ag-schema-head-text { display: grid; gap: 4px; min-width: 0; }
      .ag-schema-lede { color: var(--text-muted); }
      .ag-schema-facts { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
      .ag-schema-facts li { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; color: var(--text-muted); }
      .ag-schema-fact-label { color: var(--text-normal); font-weight: var(--font-weight-semibold); }
      .ag-schema-group { position: relative; display: grid; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: hidden; }
      .ag-schema-group-rules::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 2px; background: var(--color-accent); opacity: .5; }
      .ag-schema-group-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 2px 10px; padding: 7px 14px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); }
      .ag-schema-group-title { color: var(--text-normal); font-weight: var(--font-weight-semibold); }
      .ag-schema-group-hint { color: var(--text-faint); font-size: var(--font-ui-smaller); }
      .ag-schema-fields { display: grid; padding: 2px 14px 8px; }
      .ag-schema-field { display: grid; grid-template-columns: minmax(120px, 150px) minmax(0, 1fr); align-items: baseline; gap: 2px 16px; padding: 7px 0; border-top: 1px solid var(--background-modifier-border); }
      .ag-schema-field:first-child { border-top: none; }
      .ag-schema-field-key { display: grid; gap: 2px; min-width: 0; }
      .ag-profile-schema .ag-schema-key { padding: 0; background: none; font-family: var(--font-monospace); font-weight: var(--font-weight-semibold); overflow-wrap: anywhere; }
      .ag-schema-type { color: var(--text-faint); font-family: var(--font-monospace); font-size: .8em; overflow-wrap: anywhere; }
      .ag-schema-value { min-width: 0; color: var(--text-muted); overflow-wrap: anywhere; }
      .ag-schema-notes { display: grid; gap: 4px; margin: 0; padding: 0 14px 12px 26px; color: var(--text-muted); font-size: var(--font-ui-smaller); }
      .ag-schema-notes li { position: relative; list-style: none; }
      .ag-schema-notes li::before { content: "•"; position: absolute; left: -12px; color: var(--color-accent); }
      .ag-schema-code { border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: hidden; }
      .ag-schema-code-head { display: flex; align-items: center; gap: 8px; padding: 3px 6px 3px 14px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); }
      .ag-schema-code-name { color: var(--text-muted); font-family: var(--font-monospace); font-size: .82em; }
      .ag-schema-code-hint { color: var(--text-faint); font-size: var(--font-ui-smaller); }
      .ag-schema-code-head .clickable-icon { margin-left: auto; }
      .ag-schema-example { margin: 0; padding: 12px 14px; border: none; border-radius: 0; background: transparent; box-shadow: none; white-space: pre; overflow-x: auto; tab-size: 2; color: var(--text-normal); font-family: var(--font-monospace); font-size: .82em; line-height: 1.55; }
      .ag-profile-import-input { display: none; }
      .ag-pdf-margin-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 8px 0 12px; }
      @media (max-width: 700px) {
        .ag-route-list, .ag-profile-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ag-pdf-margin-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ag-setting-actions { grid-column: 1 / -1; }
        .ag-section-nav { grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); gap: 4px; }
        .ag-schema-facts li, .ag-schema-field { grid-template-columns: 1fr; gap: 2px; }
      }
    `;
  }

  /**
   * Put a numeric input in a fixed-width field and pin its unit inside it.
   *
   * Obsidian sizes an input to its content, so the same column showed 43px,
   * 50px and 56px boxes depending on the number of digits, and the unit had to
   * be spelled out in the description. One width plus an inline unit keeps the
   * controls aligned and the description free to explain the setting.
   */
  attachUnit(input, unit = "") {
    if (!input) return null;
    const field = document.createElement("div");
    field.className = "ag-setting-input";
    let badge = null;
    if (unit) {
      field.classList.add("has-unit");
      badge = field.createSpan({ cls: "ag-setting-unit", text: unit });
    }
    input.parentElement?.insertBefore(field, input);
    field.insertBefore(input, field.firstChild);
    if (input.disabled) field.classList.add("is-disabled");
    if (badge) {
      // Reserve exactly the unit's width plus a 6px breath. A fixed padding
      // either crowds "mm" or leaves a visible gap after "%", so the offset is
      // measured once the span has a box (and again on the next frame, when a
      // detached pane only reports zero width).
      const fit = () => {
        const width = badge.getBoundingClientRect().width;
        if (width > 0) input.style.paddingRight = `${Math.ceil(width) + 13}px`;
      };
      fit();
      requestAnimationFrame(fit);
    }
    return field;
  }

  addNumber(name, description, key, min, max, unit = "") {
    const setting = new Setting(this.containerEl)
      .setName(name)
      .setDesc(description);
    let input;
    setting.addText((text) => {
      input = text.inputEl;
      text.setValue(String(this.plugin.settings[key]));
    });
    if (!input) return;
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    this.attachUnit(input, unit);
    input.addEventListener("change", async () => {
      this.plugin.settings[key] = Number(input.value);
      await this.plugin.saveSettings();
    });
    setting.addButton((button) => {
      button.setTooltip(t("恢复默认")); setIcon(button.buttonEl, "rotate-ccw");
      button.onClick(async () => { this.plugin.settings[key] = DEFAULT_SETTINGS[key]; await this.plugin.saveSettings(); this.display(); });
    });
  }

  addGalleryControl() {
    const setting = new Setting(this.containerEl)
      .setName(t("画廊视图控制"))
      .setDesc(t("选择影响画廊分行的控制因素。"));
    setting.addDropdown((dropdown) => {
      dropdown.addOption("both", t("并列数量和行高"));
      dropdown.addOption("count", t("并列数量"));
      dropdown.addOption("height", t("行高"));
      dropdown.setValue(this.plugin.settings.galleryControl ?? "both");
      dropdown.onChange(async (value) => {
        this.plugin.settings.galleryControl = value;
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

  addGalleryNumber(name, description, key, min, max, suffix, control) {
    const setting = new Setting(this.containerEl).setName(name).setDesc(description);
    let input;
    setting.addText((text) => {
      input = text.inputEl;
      text.setValue(String(this.plugin.settings[key]));
      input.type = "number";
      input.min = String(min); input.max = String(max); input.step = "1";
      input.disabled = !["both", control].includes(this.plugin.settings.galleryControl ?? "both");
      this.attachUnit(input, suffix === "幅" ? t("幅") : suffix);
      input.addEventListener("change", async () => {
        this.plugin.settings[key] = Math.round(Number(input.value));
        await this.plugin.saveSettings();
      });
    });
    setting.addButton((button) => {
      button.setTooltip(t("恢复默认")); setIcon(button.buttonEl, "rotate-ccw");
      button.onClick(async () => {
        this.plugin.settings[key] = DEFAULT_SETTINGS[key];
        await this.plugin.saveSettings(); this.display();
      });
    });
  }

  addRangeNumber(name, description, key) {
    const setting = new Setting(this.containerEl).setName(name).setDesc(description);
    const value = this.plugin.settings.widthControl?.gain ?? 50;
    this.addLinkedSlider(setting, {
      value,
      min: 0,
      max: 100,
      unit: "%",
      onChange: (next) => {
        this.plugin.settings.widthControl.gain = next;
        return this.plugin.saveSettings();
      }
    });
    setting.addButton((button) => { button.setTooltip(t("恢复默认")); setIcon(button.buttonEl, "rotate-ccw"); button.onClick(async () => { this.plugin.settings.widthControl.gain = DEFAULT_SETTINGS.widthControl.gain; await this.plugin.saveSettings(); this.display(); }); });
  }

  addPercentNumber(name, description, key) {
    const setting = new Setting(this.containerEl).setName(name).setDesc(description);
    const value = Math.max(0, Math.min(100, Math.round(Number(this.plugin.settings[key] ?? DEFAULT_SETTINGS[key]))));
    this.addLinkedSlider(setting, {
      value,
      min: 0,
      max: 100,
      unit: "%",
      onChange: (next) => {
        this.plugin.settings[key] = next;
        return this.plugin.saveSettings();
      }
    });
    setting.addButton((button) => {
      button.setTooltip(t("恢复默认")); setIcon(button.buttonEl, "rotate-ccw");
      button.onClick(async () => { this.plugin.settings[key] = DEFAULT_SETTINGS[key]; await this.plugin.saveSettings(); this.display(); });
    });
  }

  addRatioNumber(name, description, key) {
    const setting = new Setting(this.containerEl).setName(name).setDesc(description);
    setting.addText((text) => {
      text.setValue(String(this.plugin.settings.widthControl?.[key] ?? 1.5));
      text.inputEl.type = "number"; text.inputEl.min = "0.2"; text.inputEl.max = "5"; text.inputEl.step = "0.01";
      this.attachUnit(text.inputEl, "");
      text.inputEl.addEventListener("change", async () => { this.plugin.settings.widthControl[key] = Number(text.inputEl.value); await this.plugin.saveSettings(); });
    });
    setting.addButton((button) => { button.setTooltip(t("恢复默认")); setIcon(button.buttonEl, "rotate-ccw"); button.onClick(async () => { this.plugin.settings.widthControl[key] = DEFAULT_SETTINGS.widthControl[key]; await this.plugin.saveSettings(); this.display(); }); });
  }

  renderRoute(container, route, index) {
    const row = container.createDiv({ cls: "ag-route-grid" });
    const keyField = row.createDiv({ cls: "ag-setting-field" });
    const keyInput = keyField.createEl("input", { attr: { type: "text", placeholder: t("例如 role") } });
    keyInput.value = route.key;
    keyInput.addEventListener("change", () => this.updateRoute(route.id, { key: keyInput.value.trim() }));
    const valueField = row.createDiv({ cls: "ag-setting-field" });
    const valueInput = valueField.createEl("input", { attr: { type: "text", placeholder: t("例如 card") } });
    valueInput.value = route.value;
    valueInput.addEventListener("change", () => this.updateRoute(route.id, { value: valueInput.value.trim() }));
    const profileField = row.createDiv({ cls: "ag-setting-field" });
    const profileSelect = profileField.createEl("select");
    this.plugin.settings.profiles.forEach((profile) => profileSelect.createEl("option", { text: profile.name, attr: { value: profile.id } }));
    profileSelect.value = route.profile;
    profileSelect.addEventListener("change", () => this.updateRoute(route.id, { profile: profileSelect.value }));

    const actions = row.createDiv({ cls: "ag-setting-actions" });
    this.addIconButton(actions, "chevron-up", t("上移规则"), index === 0, () => this.moveRoute(index, -1));
    this.addIconButton(actions, "chevron-down", t("下移规则"), index === this.plugin.settings.routes.length - 1, () => this.moveRoute(index, 1));
    this.addIconButton(actions, "trash-2", t("删除规则"), false, async () => {
      this.plugin.settings.routes = this.plugin.settings.routes.filter((item) => item.id !== route.id);
      await this.plugin.saveSettings();
      this.display();
    });
  }

  addColumnHeader(container, text) {
    const field = container.createDiv({ cls: "ag-setting-field ag-column-header" });
    field.createEl("label", { text });
  }

  renderProfile(container, profile, index) {
    const row = container.createDiv({ cls: "ag-profile-grid" });
    const nameField = row.createDiv({ cls: "ag-setting-field" });
    const nameInput = nameField.createEl("input", { attr: { type: "text", placeholder: t("模板名称") } });
    nameInput.value = profile.name;
    if (profile.id === "auto") {
      // The built-in `auto` template is immutable: it cannot be renamed,
      // deleted, or overwritten by an imported file.
      nameInput.disabled = true;
      nameInput.title = t("内置模板不可重命名");
    } else {
      nameInput.addEventListener("change", () => this.updateProfile(profile.id, { name: nameInput.value.trim() }));
    }
    const directionField = row.createDiv({ cls: "ag-setting-field" });
    const direction = directionField.createEl("select");
    [["alternate", t("左右轮替")], ["left", t("居左")], ["right", t("居右")]].forEach(([value, label]) => direction.createEl("option", { text: label, attr: { value } }));
    direction.value = profile.floatAlignment ?? "alternate";
    direction.addEventListener("change", () => this.updateProfile(profile.id, { floatAlignment: direction.value }));

    const actions = row.createDiv({ cls: "ag-setting-actions" });
    if (profile.id !== "auto") this.addIconButton(actions, "trash-2", t("删除布局模板"), false, async () => {
      const fallback = this.plugin.settings.profiles.find((item) => item.id === "auto")?.id ?? "auto";
      this.plugin.settings.routes = this.plugin.settings.routes.map((route) => route.profile === profile.id
        ? { ...route, profile: fallback }
        : route);
      this.plugin.settings.profiles = this.plugin.settings.profiles.filter((item) => item.id !== profile.id);
      await this.plugin.saveSettings();
      this.display();
    });
    this.addIconButton(actions, "arrow-up-from-line", t("导出配置"), false, () => this.plugin.exportProfile(profile));
  }

  renderProfileSchema(container) {
    const panel = container.createDiv({ cls: "ag-profile-schema" });

    const head = panel.createDiv({ cls: "ag-schema-head" });
    const headText = head.createDiv({ cls: "ag-schema-head-text" });
    headText.createEl("h4", { text: t("Profile 配置说明") });
    appendRichText(
      headText.createEl("p", { cls: "ag-schema-lede" }),
      t("导入 `.js` / `.json` 文件，只增改布局模板。PDF 与页码、页边距与纸张、Frontmatter 路由、画廊与间距均不在此文件中。")
    );

    const facts = panel.createEl("ul", { cls: "ag-schema-facts" });
    for (const [label, text] of [
      [t("覆盖式更新"), t("同 `id` 替换、未提及的保留，内置 `auto` 永不覆盖。")],
      [t("整份校验"), t("任一模板无效时整份文件拒绝导入，设置不会部分写入。")],
      [t("可省略 id"), t("省略时取文件名；`rules` 为空数组时按 `auto` 处理。")]
    ]) {
      const item = facts.createEl("li");
      item.createEl("span", { cls: "ag-schema-fact-label", text: label });
      appendRichText(item.createEl("span"), text);
    }

    this.renderSchemaGroup(panel, {
      title: t("模板字段"),
      hint: t("profile 对象顶层"),
      fields: [
        ["id", "string", t("模板唯一标识。可省略，省略时取文件名；`auto` 保留内置模板，导入时跳过。")],
        ["name", "string", t("设置页显示的名称，省略时取 id。内置 `auto` 名称固定不可改。")],
        ["floatAlignment", "alternate | left | right", t("模板级默认浮动方向，会被规则内的同名设置覆盖。")],
        ["rules", "auto | rule[]", t("`auto` 使用内置路由；数组按顺序匹配，细节见下方规则字段。")]
      ]
    });

    const rules = this.renderSchemaGroup(panel, {
      title: t("rules[] 规则"),
      hint: t("从上到下匹配，第一条命中的规则生效"),
      fields: [
        ["ratioRange", "string", t("图片宽高比区间（宽 ÷ 高），方括号表示包含边界：`[0.5,1]`、`(1,3]`。")],
        ["width", "number | string", t("占内容宽度的比例。常数，或含 `r` 的表达式：`1 - (1 - Math.log(r / 1.5) / Math.log(5 / 1.5)) ** 2`。")],
        ["layout", "auto | float | fixed", t("`auto` 按浮动阈值判断；`float` 强制浮动；`fixed` 固定为居中块。")],
        ["floatAlignment", "alternate | left | right", t("该规则命中的图片使用的浮动方向；省略时沿用模板级设置。")],
        ["side", "auto | left | right", t("浮动时固定在哪一侧；`auto` 由 floatAlignment 决定，图片行内的 `ag:side` 优先级更高。")]
      ]
    });
    rules.classList.add("ag-schema-group-rules");
    const notes = rules.createEl("ul", { cls: "ag-schema-notes" });
    for (const text of [
      t("只对未写 `ag:width`、且 `ag:layout` 为空或 `auto` 的图片生效。"),
      t("规则宽度超过「浮动最大生效宽度」时改按块布局显示，不再浮动。")
    ]) {
      appendRichText(notes.createEl("li"), text);
    }

    const code = panel.createDiv({ cls: "ag-schema-code" });
    const codeHead = code.createDiv({ cls: "ag-schema-code-head" });
    codeHead.createEl("span", { cls: "ag-schema-code-name", text: "my-profile.json" });
    codeHead.createEl("span", { cls: "ag-schema-code-hint", text: t("可直接导入") });
    const copyButton = this.addIconButton(codeHead, "copy", t("复制示例配置"), false, async () => {
      try {
        await copyText(profileSchemaText());
        new Notice(t("示例配置已复制"));
        setIcon(copyButton, "check");
        window.setTimeout(() => setIcon(copyButton, "copy"), 1200);
      } catch {
        new Notice(t("复制失败，请手动选择文本复制"));
      }
    });
    code.createEl("pre", { cls: "ag-schema-example", text: profileSchemaText() });
  }

  renderSchemaGroup(parent, { title, hint, fields }) {
    const group = parent.createDiv({ cls: "ag-schema-group" });
    const groupHead = group.createDiv({ cls: "ag-schema-group-head" });
    groupHead.createEl("span", { cls: "ag-schema-group-title", text: title });
    groupHead.createEl("span", { cls: "ag-schema-group-hint", text: hint });
    const list = group.createDiv({ cls: "ag-schema-fields" });
    for (const [key, type, description] of fields) {
      const row = list.createDiv({ cls: "ag-schema-field" });
      const keyCell = row.createDiv({ cls: "ag-schema-field-key" });
      keyCell.createEl("code", { cls: "ag-schema-key", text: key });
      keyCell.createEl("span", { cls: "ag-schema-type", text: type });
      appendRichText(row.createEl("p", { cls: "ag-schema-value" }), description);
    }
    return group;
  }

  addTextField(container, label, placeholder, value, onChange) {
    const field = container.createDiv({ cls: "ag-setting-field" });
    field.createEl("label", { text: label });
    const input = field.createEl("input", { attr: { type: "text", placeholder } });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value.trim()));
  }

  addNumberField(container, label, placeholder, value, onChange) {
    const field = container.createDiv({ cls: "ag-setting-field" });
    field.createEl("label", { text: label });
    const input = field.createEl("input", { attr: { type: "number", min: "10", max: "90", placeholder } });
    input.value = value ?? "";
    input.addEventListener("change", () => onChange(input.value.trim()));
    this.addIconButton(container, "rotate-ccw", t("恢复默认"), false, () => onChange(""));
  }

  addSelectField(container, label, options, value, onChange) {
    const field = container.createDiv({ cls: "ag-setting-field" });
    field.createEl("label", { text: label });
    const select = field.createEl("select");
    for (const [optionValue, optionLabel] of options) {
      const option = select.createEl("option", { text: optionLabel });
      option.value = optionValue;
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
  }

  addIconButton(container, icon, label, disabled, onClick) {
    const button = container.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("click", () => {
      try {
        const result = onClick();
        if (result && typeof result.catch === "function") {
          result.catch((error) => new Notice(t("操作失败：{label}：{error}", { label, error: error?.message || t("未知错误") })));
        }
      } catch (error) {
        new Notice(t("操作失败：{label}：{error}", { label, error: error?.message || t("未知错误") }));
      }
    });
    return button;
  }

  async updateRoute(id, changes) {
    const route = this.plugin.settings.routes.find((item) => item.id === id);
    if (!route) return;
    Object.assign(route, changes);
    await this.plugin.saveSettings();
  }

  async updateProfile(id, changes) {
    const profile = this.plugin.settings.profiles.find((item) => item.id === id);
    if (!profile) return;
    Object.assign(profile, changes);
    await this.plugin.saveSettings();
  }

  async moveRoute(index, offset) {
    const target = index + offset;
    const routes = this.plugin.settings.routes;
    if (target < 0 || target >= routes.length) return;
    [routes[index], routes[target]] = [routes[target], routes[index]];
    await this.plugin.saveSettings();
    this.display();
  }
}

function profileSchemaText() {
  return `{
  "id": "my-profile",
  "name": "My profile",
  "floatAlignment": "alternate",
  "rules": [
    {
      "ratioRange": "[0,0.8)",
      "width": "0.45",
      "layout": "float",
      "floatAlignment": "right",
      "side": "auto"
    },
    {
      "ratioRange": "[0.8,2.4]",
      "width": "1 - (1 - Math.log(r / 1.5) / Math.log(5 / 1.5)) ** 2",
      "layout": "float",
      "floatAlignment": "alternate",
      "side": "auto"
    },
    {
      "ratioRange": "(2.4,99]",
      "width": "1",
      "layout": "fixed",
      "floatAlignment": "alternate",
      "side": "left"
    }
  ]
}`;
}

/** Render text that contains `backtick` spans as inline code elements. */
function appendRichText(parent, text) {
  for (const part of String(text).split(/(`[^`]+`)/g)) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      parent.createEl("code", { text: part.slice(1, -1) });
    } else {
      parent.appendText(part);
    }
  }
  return parent;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy");
  textarea.remove();
  if (!copied) throw new Error("copy unavailable");
}

function readFileObject(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(t("无法读取文件")));
    reader.readAsText(file);
  });
}

/** Nearest ancestor that actually scrolls, starting with the element itself. */
function findScrollParent(element) {
  for (let node = element; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

function captureScrollAnchors(element) {  const anchors = [];
  for (let node = element; node; node = node.parentElement) {
    if (typeof node.scrollTop === "number" && node.scrollTop > 0) anchors.push({ node, top: node.scrollTop });
  }
  return anchors;
}

function restoreScrollAnchors(anchors) {
  const apply = () => {
    for (const { node, top } of anchors) {
      if (!node?.isConnected) continue;
      if (Math.abs(node.scrollTop - top) > 1) node.scrollTop = top;
    }
  };
  // `empty()` collapses the pane, so the browser clamps scrollTop to 0. Reapply
  // once synchronously and once after layout has settled.
  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 60);
}
