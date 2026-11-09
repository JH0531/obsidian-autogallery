# 贡献指南（Contributing Guide）

> **语言 / Language**：本文档为中文版。英文版见 [CONTRIBUTING-EN.md](CONTRIBUTING-EN.md)。
> 项目文档：[README.md](README.md)（中文） · [README-EN.md](README-EN.md)（English）

AutoGallery 是一个 Obsidian 图片排版插件：在不重写 Markdown 图片引用、不破坏正文编辑能力的前提下，统一处理 caption、自动栏宽、gallery、文字环绕与分页，并提供一条与阅读视图排版一致的 PDF 导出管线。

本文件面向**人类贡献者与自动化 Agent**，说明如何在这个仓库里安全地改动代码。
技术细节的权威来源是 [`AGENTS.md`](AGENTS.md)（仓库级规则与索引）及其
[`specifications/`](specifications/) 目录（按主题拆分的详细规则），本文件不重复它们，只给出
「改什么 → 怎么验证 → 怎么提交」的完整路径。

---

## 1. 环境准备

| 项目 | 要求 |
| --- | --- |
| Node.js | **≥ 18**（esbuild 0.25 的下限；开发环境实测使用 22.x）。仓库未声明 `engines` 字段 |
| 包管理器 | npm（`package-lock.json` 已入库，请勿切换到 yarn/pnpm） |
| 运行时 | Obsidian ≥ 1.5.0（见 `manifest.json` 的 `minAppVersion`） |

```bash
npm install
```

常用脚本（仅两个，定义在 `package.json`）：

```bash
npm run dev      # 开发构建，带 inline sourcemap，不压缩
npm run build    # 生产构建，压缩，输出 main.js
```

> **注意**：仓库当前**没有** `test` 脚本，也没有引入 Vitest / jsdom。
> `npm test` 会直接报 `Missing script: "test"`。静态检查用 `npm run build` 和 `git diff --check`。

---

## 2. 仓库结构与模块职责

```
plugin.js          插件入口：注册命令、设置页、postprocessor、editor extension
src/               全部实现代码（32 个 JS 模块 + config.json + locales/ 共 9 个语言文件）
main.js            构建产物，已入库，随源码一同提交
manifest.json      插件清单（id / version / minAppVersion）
esbuild.config.mjs 打包配置（cjs、target es2018、platform browser）
```

`src/` 内部按职责分层，改动前先确认落点，避免把逻辑塞进已经臃肿的文件：

| 层 | 模块 | 职责 |
| --- | --- | --- |
| 纯计算 | `layout.js`、`image-runs.js`、`crop-geometry.js`、`gallery-geometry.js`、`profile-rules.js`、`float-order.js`、`print-geometry.js` | 无 DOM 依赖，可独立推理与复用 |
| 解析/序列化 | `annotations.js`（`ag:` 参数读写）、`profile-io.js`（profile 导入导出）、`routes.js`（frontmatter 路由） | 纯字符串/对象处理 |
| 阅读视图 | `renderer.js`、`embed-actions.js`、`image-metrics.js`、`image-sizes.js`、`reset-images.js` | 基于 `registerMarkdownPostProcessor` 的排版；`image-sizes.js` 从文件头读出未解码图片的尺寸 |
| 实时预览 | `editor-extension.js`（CodeMirror 6 扩展）、`editor-resize.js`（拖拽调宽）、`gallery-handles.js`（画廊手柄）、`gesture-state.js`（手势期间的几何预接管） | 基于 `StateField` / `ViewPlugin` / line decoration |
| PDF | `pdf-export.js`（入口）、`pdf-session.js`（打印树）、`pdf-export-modal.js`（对话框）、`pdf-pagination.js`（分页模型）、`pdf-style.js`（样式合成）、`pdf-integration.js`（与 Obsidian 原生导出共存） | 独立于原生导出的一条管线 |
| UI | `settings-tab.js`、`crop-modal.js`、`confirm-modal.js`、`icons.js`、`i18n.js`、`print-theme.js`（浅色主题缓存） | 设置页、裁剪弹窗、图标注册、双语 |
| 配置 | `defaults.js`（默认设置与归一化）、`config.json`（可调常量） | — |

### 单一实现原则（最重要的一条）

同一个规则**只能有一处实现**，阅读视图与实时预览必须共用：

| 规则 | 唯一实现位置 |
| --- | --- |
| 哪些源码行构成一个 gallery | `src/image-runs.js` |
| 行如何切分/分组（`groupImageRecords`、`findImageLineGroups`） | `src/image-runs.js` |
| gallery 排版计算 | `src/layout.js` 的 `calculateGalleryRows`（唯一排版算法） |
| 单图宽度/浮动计算 | `src/layout.js` 的 `calculateFloatLayout` / `calculateWidthRatio` |
| 裁剪几何（框、viewBox、比例） | `src/crop-geometry.js` |
| 画廊手势的几何换算（栏宽↔画幅比例、行高缩放） | `src/gallery-geometry.js` |
| 打印样式合成 | `src/pdf-style.js` 的 `composePdfStyle` |
| 栏宽增益、浮动阈值等常量 | `src/config.json`（**不要**在代码里硬编码第二份） |

历史上多次线上问题都源于「阅读视图和实时预览各写了一份」：同一篇笔记在编辑器里
渲染成 3+1、在预览里渲染成 2+2。发现类似分歧时，正确做法是抽到共享模块，
而不是在两边各打一个补丁。

---

## 3. 代码规范

### 3.1 基本风格

仓库未配置 formatter / linter，因此**保持与邻近代码一致**：

- 两空格缩进；语句结尾带分号；字符串用双引号。
- ESM 模块语法（`import` / `export`），无 TypeScript。
- `camelCase` 变量与函数，`PascalCase` 类，`kebab-case` 命令 id 与 CSS 类名。
- 优先写小的具名函数与显式对象属性，避免匿名大闭包。
- 注释解释**为什么**，不复述代码在做什么。仓库现有注释密度较高，是刻意为之。
- 浏览器 API 与 Obsidian API 只出现在本来就拥有它们的那一层（纯计算模块不要碰 `document`）。

### 3.2 CSS 与 DOM 命名

- 类名统一 `ag-` 前缀：`.ag-caption`、`.ag-cm-gallery-line`、`.ag-pdf-row`、`.ag-align-action`。
- 自定义属性统一 `--ag-` 前缀：`--ag-embed-width`、`--ag-img-aspect`、`--ag-caption-gap`、
  `--ag-print-width`、`--ag-reveal-left/top/width`。
- **数据标记**用 `data-ag-*`：`data-ag-skip`、`data-ag-pdf-owner="plugin"`、`data-ag-mixed`、
  `data-ag-pdf-break-before`。
- 尺寸类名 `ag-actions-compact` / `ag-actions-compact-small` 等降级形态必须由样式表类提供，
  不能用内联 `!important` 实现——Obsidian 会用自己的 `element.style` 写入覆盖它。

### 3.3 国际化

`src/i18n.js` 的规则比较特殊，改动前务必理解：

- **key 就是中文原文**：`t("恢复默认")`。中文界面下未命中字典时直接回落到 key 本身。
- `src/locales/en-*.js` 把中文 key 映射为英文，按 UI 域拆分为
  `common / settings / pdf / crop / editor / profile / print / confirm`。
- `src/locales/zh.js` 只存放 **ASCII key**（如 `settings.language`、`confirm.ok`）的中文覆盖，
  因为这类 key 的中文形式与 key 本身不同。
- 占位符写法：`t("第 {n} 个模板无效：{message}", { n, message })`。
- `LANGS` 是 `t()` 真正能渲染的语言（`["zh", "en"]`）；`FOLLOW`（`"follow"`）是**伪语言**，
  表示「跟随 Obsidian」。它在运行时解析为真实语言：宿主语言以 `zh` 开头 → 中文，
  否则是 `en` → 英文，其余语言回落英文。`FOLLOW` 是默认值，
  `normalizeSettings` 的白名单是 `[FOLLOW, ...LANGS]`。
- 因此**新增界面文案不要依赖运行时的语言切换**：字符串在加载期被 `t()` 冻结的模块级常量
  （例如 `SETTINGS_SECTIONS`）在切换语言后不会更新。设置页的分区导航已改为保存
  `labelKey` / `hintKey` 并在渲染时调用 `t()`——新增类似的模块级 UI 常量时照此办理。

新增 UI 文案的正确流程：写 `t("中文原文")` → 在对应的 `en-*.js` 里补英文映射。
**不要**新建英文 key 体系，也不要把中文原文换成拼音或英文。

---

<a id="architecture"></a>

## 4. 核心架构约束（改动前必读）

以下每条都对应一类线上缺陷。它们在 `AGENTS.md` 与 `specifications/` 中有完整推导，这里给出压缩版。

### 4.1 宽度只施加在「外层 Markdown 块」

居中或 gallery 图片的显式百分比（`ag:width`）只写到外层块；嵌套的
`.image-embed` / `.internal-embed` 必须是 `width: 100%`。两层都写同一个百分比时，
Obsidian 会把 60% 渲染成「60% 的 60%」。

### 4.2 嵌套容器有明确归属

一张图片**恰好属于一个**布局作用域：最近的 `td/th`、`li`、`.callout`，否则是所在 section。
`readImageBlock` 必须按归属过滤，否则整个 callout 会被打包成一个 gallery 单元格而缩成几百像素。

- **callout**：只声明归属、**永不装饰**。Live Preview 里 callout 是不透明块，写进去的几何无法编辑还原。
- **列表项**：绝不与邻居组成 gallery（标记列会让跨项行不可读）。项内图片按内容盒宽度路由，
  单图走**左**对齐且**不浮动**（浮动不被 `display: list-item` 包含，会溢出到下一项）。
- **表格单元格**：不施加任何插件宽度或对齐，只应用 `ag:crop` 与 `ag:exclude`。
  单元格内联 `width: 100% !important` 会与 Obsidian 自身的尺寸计算打架，导致列被压成缩略图。

### 4.3 百分比宽度与浮动判定

- `floatMax` 只决定**自动**宽度是否浮动，不能把分段幂函数算出的宽度替换成 `100%`；
  超过阈值应按计算宽度居中。
- 比较显式 `ag:width` 与 `floatMax` 时用**声明的百分比**，不要用实测列宽推导出的比值，
  否则亚像素抖动会让图片在浮动/居中之间反复横跳。
- 阈值是**闭区间上界**：恰好等于 `floatMax` 的自动宽度图片会浮动，与 `calculateFloatLayout` 一致。
- 手动 `ag:width` + `ag:side` 的组合按用户给的宽度浮动，不受阈值限制。
- 居中图片永远不能带 CSS `float` 值。

### 4.4 滚动稳定性

- Live Preview 不得让文字绕排在图片旁（浮动不给行提供高度，下一行会画到图片上）。
  浮动分支需要显式预留 `图片高 + caption + 下间距`。
- 每个 rAF 调度的排版 pass 都要有 `setTimeout`（约 200ms）兜底：窗口隐藏时 rAF 会暂停。
- 滚动不触发全量排版 pass；进入视口的行通过 `viewportChanged` 处理。
- 阅读视图的滚动锚定到**视口顶部第一个块**，而不是裸 `scrollTop` 偏移；
  Chromium 自带的滚动锚定已生效时不得再写 `scrollTop`。

### 4.5 裁剪

- 只有显式 `ag:crop=W:H` 才裁剪，没有单独的 fill 开关。
- 有效比例是 `max(声明比例, 顶边宽 / 可用高)`：手写参数不会让画框越界，
  只会被**放宽**。所有消费方必须用 `effectiveCropRatio`，而不是 `crop.w / crop.h`。
- 裁剪弹窗**绝不写图片文件**，也**绝不**给祖先加 `overflow: hidden`。
- 弹窗不得滚动；滚轮是缩放手势，保存/取消行必须始终可达。

### 4.6 PDF 导出

- 打印树必须是 `<body>` 的**直接子元素**并带 `data-ag-pdf-owner="plugin"`；
  Obsidian 的 `@media print` 会隐藏 body 的其他子元素。
- 页面几何来自 `toPrintOptions` 的实际参数，不来自纸张尺寸表；`scale` 必须除掉。
- 插件的孤行控制用 `orphans: 1 / widows: 1`；原生导出会应用自己的 2/2。
- `composePdfStyle` 是打印样式的**唯一写入者**，第二次赋值 `textContent` 会丢掉孤行声明。
- 重排顺序固定：`ensureBodyPosition` → `unpaginate` → `renderCleanup` → `resetFloatIndices`
  → 重算几何 → 重写样式表 → `renderAutoGallery`。
- 绝不替换原生 `workspace:export-pdf` 命令 id；插件另加自己的命令与 `file-menu` 条目。
- 预览打印与导出打印必须经 `withPrintLock` 串行化。

### 4.7 兼容性红线

- `auto` 是内置兜底 profile：**不可删除、不可重命名、不会被导入覆盖**。
- profile 导入是覆盖式更新：同 id 替换，未提及的保持不变；**任何一条无效则整份拒绝**，
  不写入部分配置。
- 停用插件后必须还原 Obsidian 原生的图片标记与样式。
- `ag:exclude` 的图片保留原样；`ag:isolate` 切断前后分组。

### 4.8 渲染管线速览

- 阅读视图用 `registerMarkdownPostProcessor` 接管 Obsidian 已生成的 section，只修改现有块的样式与 caption，不搬移正文节点；section 记录源文件路径，清理与重排期间暂停 MutationObserver。
- 文件切换、活动叶/标签、视图布局、设置保存与插件重载都会触发刷新；刷新释放旧 section 的清理函数并重置交替浮动索引，只安排刷新，不直接处理可能仍处于 detached 状态的段落。
- 刷新保存阅读视图的滚动锚点；若刷新前位于底部，则在当前布局帧完成后按新文档高度一次性定位到底部。
- 实时阅览使用 CodeMirror 6 的 `StateField`、`ViewPlugin` 与 line decorations；图片行保持原生 `.cm-line`，样式通过单一 decoration transaction 应用，几何变化后调用 `EditorView.requestMeasure()`；离开视口或切换文件时清除，Source 模式恢复原生布局。
- gallery 行宽按原始宽高比分配：`rowHeight = (containerWidth - gap * (count - 1)) / sum(aspectRatios)`，`imageWidth = rowHeight * aspectRatio`。
- 单图默认参数在 `src/config.json` 中维护：中心比例 `1.5`、左幂 `2.0`、右幂 `1.5`、输出范围 `[0.2, 1]`；设置页的「栏宽增益」与「中位比例」会覆盖这些默认值。

---

## 5. 验证流程（无自动化测试）

本仓库**明确禁止**引入 Vitest / jsdom / `tests/` 目录或任何测试依赖，
也不允许为「便于测试」而复制一份生产逻辑。验证只能发生在真实 Obsidian Vault 里。

```bash
# 1. 构建并部署到测试 Vault
npm run build
cp main.js manifest.json <VAULT>/.obsidian/plugins/obsidian-autogallery/

# 2. 重载插件
obsidian vault=test plugin:reload id=obsidian-autogallery

# 3. 打开目标笔记，执行命令，观察日志
obsidian vault=test open file="<VAULT>/<你的笔记>.md"
obsidian vault=test dev:errors
obsidian vault=test dev:dom selector='.ag-caption' total
obsidian vault=test dev:dom selector='.cm-line.ag-cm-gallery-line' total
```

### 验证中的已知陷阱

- **`plugin:reload` 不保证加载新构建**。上一个构建的 promise 若仍挂起（常见原因是一个
  没人回答的原生保存对话框），旧模块会留在内存里，重载却报告成功。
  必须确认新代码真的生效，例如检查新构建独有的导出符号：
  ```bash
  obsidian vault=test eval code="typeof app.plugins.plugins['obsidian-autogallery'].savePdfPrefs"
  ```
  仍是旧形态时用 `obsidian vault=test restart`。
- **`dev:dom` / `dev:screenshot` 在窗口最小化时可能返回空**（`document.hidden === true`）。
  这时改用 `eval` 断言计算后的几何：单元格宽度、`getComputedStyle` 的具体值，
  而不是去比对像素。
- **PDF 变更**必须在真实 Vault 里用 `workspace:export-pdf` 命令验证。
  原生导出的保存对话框可能在 Chromium 准备打印文档时仍处于打开状态——
  保持插件的临时样式存活到 `afterprint` 或有界的清理计时器触发，
  不要替换原生保存流程，也不要在 CLI 验证期间强行把焦点抢到对话框上。
- **诊断代码要清理**。定位问题期间可以用生产日志或临时提示，修复后必须移除。
- 静态检查：`npm run build` 与 `git diff --check`。

---

## 6. 提交规范

### 6.1 分支

- `main` 是基线分支，不要直接在上面做实验。
- 工作分支命名建议：`feature/<简述>`、`fix/<简述>`、`chore/<简述>`。
- 开始任何编码前先执行 `git status --short`。若工作区有未提交改动，
  先 `git stash push -u -m "agent checkpoint"` 保存，再开始不相关的工作。

### 6.2 Commit message

历史提交使用**简短祈使句**，可带 scope，偶尔也有中文描述：

```
renderer: fix gallery width
pdf: keep a fitting heading block on its page
i18n: 加入中英双语适配与语言设置
docs: log pagination fit fixes
```

约定：

- 主题行用英文祈使句、小写、以动词开头；scope 用模块名（`renderer` / `pdf` / `editor` / `i18n` / `docs`）。
- 主题行 ≤ 72 字符。必要时在正文补充「为什么」，尤其是布局与 PDF 相关的改动。
- `docs:` 前缀用于纯文档提交（如本文件）。
- **构建产物随源码一起提交**：修改 `src/` 或 `plugin.js` 后执行 `npm run build`，
  并把 `main.js` 加入同一次提交——仓库已跟踪 `main.js`，只提交源码会让安装包与代码不一致。

### 6.3 Pull Request

PR 描述需要回答：

1. **用户可见的行为变化**是什么（不是「重构了 X 模块」）。
2. **验证命令清单**：实际执行过的 `npm run build`、CLI 命令、以及在哪个 Vault、哪篇笔记上验证。
3. **DOM / 截图证据**：涉及设置页或任何 UI 改动的 PR 必须附上。
   `dev:dom` 的断言输出是可接受的证据形式。
4. **是否需要 Vault 重载或配置迁移**：新增设置项时说明旧配置如何被 `normalizeSettings` 归一化。
5. **是否触及双视图一致性**：若改动了排版逻辑，说明阅读视图与实时预览是否都验证过。

---

## 7. 常见坑位速查

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 同一篇笔记两个视图排版不同 | 各视图各写了一份分组/排版逻辑 | 抽到 `image-runs.js` / `layout.js` 共用 |
| 图片被渲染成「60% 的 60%」 | 内外两层都写了同一个百分比 | 只在外层块写百分比，内层 `width: 100%` |
| 表格列被压成缩略图 | 单元格内联 `width: 100% !important` | 单元格内不施加插件宽度 |
| 整个 callout 缩成几百像素 | `readImageBlock` 未按归属过滤 | 按最近 `td/th`/`li`/`.callout` 过滤 |
| 笔记打开后毫无样式 | `applyLayout` 内抛 `ReferenceError`，pass 中断 | 重载插件，确认 `dev:errors` 为空且 gallery 行带 `style` 属性 |
| 编辑器里滚动时视口抖动 / 点击错行 | 行几何变化后未刷新 CodeMirror 坐标映射 | 派发后调用 `EditorView.requestMeasure()` |
| 窗口最小化后笔记无样式 | rAF 在隐藏窗口暂停 | 每个 rAF pass 配 `setTimeout` 兜底 |
| 图片周围出现空白行 | `img.cm-widgetBuffer` 占位节点未隐藏 | 隐藏该占位节点 |
| PDF 末页只剩一行 | 孤行控制参数与原生冲突 | 插件侧用 `orphans: 1 / widows: 1` |
| PDF 页面尺寸偏差 4/3 | pdf.js 用 point，纸张几何用 CSS pixel | 渲染缩放需带 96/72 系数 |
| 重载后行为仍是旧的 | 旧构建的 promise 挂起，旧模块驻留内存 | 用新符号 `eval` 确认，必要时 `vault=test restart` |

---

## 8. 明确不做的事

- ❌ 不新增 `tests/` 目录、Vitest/jsdom 依赖或第二份生产逻辑副本。
- ❌ 不引入 formatter / linter 去重排既有代码（会带来巨大的无关 diff）。
- ❌ 不替换 Obsidian 原生导出流程（插件另开一条管线，见 4.6）。
- ❌ 不改写用户笔记中的图片引用语法（除用户主动拖拽 / 点按产生的 `ag:` 参数写入）。
- ❌ 不让内置 `auto` profile 可被删除、重命名或被导入覆盖。
- ❌ 不在 `AGENTS.md` / `specifications/` 之外另建一份平行规则文档——规则改动直接改对应文件。

---

## 9. 许可证

本项目采用 [GPL-3.0-or-later](LICENSE)。

提交贡献即表示你同意该贡献以 GPL-3.0-or-later 授权发布。
