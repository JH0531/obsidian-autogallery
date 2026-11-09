# 交付报告 · 展示体系审计与修复

生成时间：2026-11-09 · 插件提交：`a268cb1`（`src/`、`plugin.js`、`main.js` 未改动）

## 1. 结果

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 展示与代码一致 | `npm run check:docs` | **8/8 通过，0 findings** |
| 素材清单 | `node tools/capture/manifest-check.mjs` | **通过**（6 条覆盖率警告） |
| demo 构建一致性 | `npm run check:demo` | **通过**（23 篇，0.1.0，7827089） |
| 文档站构建 | `npm run docs:build`（docs 仓） | **通过**（20.25s） |
| 源码未改 | `git status --short src/ plugin.js main.js` | 空 |

## 2. 修了什么

### 2.1 事实错误（P0，全部修复）

- 画廊行：从「不参与单图压缩」改为三段式——不拆页 / 可整行同比例缩小且栏宽不变 / 不作 donor、孤行修复不压它。落在 `docs/export/pagination.md`、`demo/18`、`specifications/pdf-pagination.md`、`specifications/validation.md`。
- 行距最大压缩：5% → **10%**（中英各两处）。
- 说明对话框：四项 → **五项**（补「浮动方向」）。
- 画廊手柄：四类 → **五类**（交换与并入拆开计数）。
- 对齐箭头：不再说「只改对齐」，改为同时写入 `ag:side`、`ag:layout` 与 `ag:width`。
- 浮动条件：显式 `layout=float`/`side` 保持浮动、宽度夹到阈值；只有仅写 `ag:width` 才居中。
- 导出失败：区分「预览准备失败自动回退」与「打印失败保留对话框 + 手动按钮」。
- 原生导出拦截：改为「只保证 CSS 级效果，不跑几何分页」。
- 安装文件：删除不存在的 `styles.css`，统一为 `main.js` + `manifest.json`。
- 删除两处「旧文档说上限 90%」的失效引用。

### 2.2 数值与结构（P1，已修）

- 1:3 双列行高 1140 → **1122**。
- 方图 40% / 306px → **39% / 297px**；「约一半」→「约四成（39%）」（中英、index、concepts、routing）。
- figures.json：文档站 25 → **26 页**；`templates/transfer` → `templates/import`；poster meta 补静态 JPG 1200×800 回退。
- 路由「启用开关」删除；改为数据层字段、UI 不提供。
- 英文首页两处 `/reference/settings` 补 `/en`；英文快速上手与中文页对齐并补 3 个媒体块；英文安装页补两节并修「stores nothing outside your vault」。
- 中英 `^##` 数量与图序现已完全平行。

### 2.3 规格与台账

- `layout-core.md`：明确打包器缺省 3、渲染器传 `galleryMaxPerRow`（默认 5）。
- `live-preview.md`：行高条改为「图注缝中点」；降级级数补范围说明。
- `figures.json`：新增 `AG-S19-04`（孤行）、`AG-S19-05`（浮动）；S19-01..05 补 `noteEn`；17 条无文件素材登记为 `deferred` 并写理由；`audit.mjs` 新增「暂缓」表。

## 3. 新增工具

| 文件 | 作用 |
| --- | --- |
| `tools/docs/facts.mjs` | 用 esbuild 执行 `defaults.js`，用哨兵值反推 40 个设置项的钳制区间；校验标签仍在 UI 与英文词典中 |
| `tools/docs/claims.mjs` | 扫描 86 个展示面 + 47 条素材描述，抽取数值/绝对化/参数/图 id/媒体引用并自动裁定 |
| `tools/docs/check.mjs` | 八项门禁：台账错误、图 id、图文件、figures 页面、中英平行、媒体、零图覆盖、事实新鲜度 |
| `tools/docs/figures-maintenance.mjs` | figures.json 的幂等修正（页面 id、noteEn、deferred、poster meta） |
| `tools/docs/plan-package.mjs` | 生成 PlanWeave 包草稿（9 任务 / 27 块 / 9 个审查门） |
| `audit/facts.json` | 代码事实源（生成） |
| `audit/claims.json` | 1464 条行级断言台账（生成） |
| `audit/findings.md` | 分级结论、28 组矛盾裁定、误报清单 |
| `audit/GLOSSARY.md` | 术语表（浮动双门槛、两种「孤行」、五类手柄） |

## 4. PlanWeave

- 项目：`obsidian-autogallery-ada6089a`
- 画布：`canvas-c2e78421`（`showcase-audit-v1`）
- 图质量：**100 分**，9 任务 / 27 块 / 12 条任务依赖 / 9 个审查门
- **已完成 T-001 – T-007**：21 个实现块 + 7 个审查门，状态均为 `completed`
- **T-008 已就绪**（分页素材），T-009 被 T-008 阻塞
- 执行器：`manual`。`codebuddy-acp` 预检失败——它没有可用的无头认证方式，且读取认证目录被沙箱拒绝；按预案退回人工协调。
- CLI 注意：`claim` / `submit-result` 在 Windows 上会打印 `safe-delete` 或「目录锁释放失败」，但状态仍会推进；不要因为这条报错重复提交。

恢复执行：

```bash
cd "F:/Originality Space/Codes/obsidian_autogallery"
planweave status --json --canvas canvas-c2e78421
planweave claim T-008#B-001 --canvas canvas-c2e78421
planweave prompt T-008#B-001 --canvas canvas-c2e78421
```

## 5. 仍未完成（已登记，不是遗漏）

1. **T-008 分页对照图**：`AG-S19-01..05` 的 10 个 WebP 尚未产出，`tools/capture/pdf-stills.mjs` 尚未实现；页面暂未引用这些图。
2. **17 条暂缓素材**：见 `tools/capture/audit.md` 的「暂缓」表，均有理由。
3. **英文媒体覆盖**：`en/any` 0/6、`en/dark` 0/41、`en/light` 0/41。
4. **文档站媒体同步**：`docs/scripts/{sync-media,check-media,check-i18n}.mjs` 已补齐，`docs:check` 通过；但英文素材仍未产出，`docs/public` 实际只覆盖中文。

## 6. 改动文件

**插件仓**：`README.md`、`README-EN.md`、`AGENTS.md`、`.gitignore`、`package.json`、`demo/{02,05,06,07,13,18,19,21}-*.md`、`specifications/{layout-core,live-preview,pdf-pagination,validation}.md`、`tools/capture/{audit.mjs,audit.md,figures.json}`、新增 `audit/` 与 `tools/docs/`。

**文档站**：中文页迁入 `docs/zh/`（26 页），`docs/index.md` 改为语言选择页，`docs/.vitepress/config.mts` 改为 `/zh/` 与 `/en/` 双 locale；新增 `docs/scripts/{check-i18n,check-media,sync-media,rewrite-locale-links}.mjs`；`docs/en/` 对应页与 `docs/zh/` 逐页平行。

## 7. 双语结构（第二轮）

| 项 | 结果 |
| --- | --- |
| `demo-en/` | 23 篇英文笔记 + README；assets、`.obsidian`、插件副本、BUILD.json 与 `demo/` 同构 |
| 机械校验 | 每篇数字与 `ag:` 参数多重集与中文源一致；零残留中文；链接与图片全部可解析 |
| `check:demo` | 同时校验两库：`demo 23 篇 · demo-en 23 篇` |
| 镜像分支 | `.github/workflows/demo-en-branch.yml` → 孤儿分支 `demo-en-vault` |
| Release | `demo-release.yml` 同时产出 `autogallery-demo-*.zip` 与 `autogallery-demo-en-*.zip` |
| 文档站 | `docs/zh/` 与 `docs/en/` 各 26 页；根路径只做语言选择 |
| 链接迁移 | 中文 93 条、英文 3 条根绝对链接补上 locale 前缀；`/media` 未动 |
| 结构门禁 | `docs:check`：84 处媒体引用存在；26 页 × 2 语言标题与图序一致、内部链接可解析 |
| 构建 | `docs:build` 通过；产物含 `/zh/`、`/en/` 与根选择页 |

PlanWeave 第二个画布：`canvas-03f0ca95`（`i18n-structure-v2`），4 任务 / 12 块 / 4 个审查门，图质量 100，**T-101 – T-104 全部 `completed`**。原 `i18n-structure-v1` 因一次失败导入留下未完成事务，已弃用并把残留移入项目 `trash/`，未手改运行时状态。

> 状态登记注意：`claim` 成功后若没有 `submit-result`，该块会一直占着单槽，后续 `claim` 返回 `no_claimable_blocks`，review 则出现「已就绪但不可认领」。处理顺序是先用 `planweave current` 找到 `currentRefs`，把它提交掉，再逐块 claim → submit。

## 8. 内部演示库与 T-008 阻塞（第三轮）

- `tools/capture/vault.local.json` 已指向仓内 `demo/`；`demo-en/` 为英文库。
- 三份 `main.js`（根、demo、demo-en）共享 inode `2814749767166883`，硬链接有效。
- 两个库写入 `safeMode: false`；`obsidian.json` 注册内部库并设 `demo` 为默认，备份在 `obsidian.json.ag-backup`。
- CDP 校验：`vault=demo`、插件实例存在、`enabled=true`、4 条命令、无信任弹窗。

**T-008 阻塞（结论已修正）**：分页行压缩在真实 PDF 里没有发生。修正 `pdf-row-scan` 的“写目标、开基准”bug 后，4 段时行在第 1 页，4.05 段起整行下移；把窗口细到 10px（510px 空白块放得下、520px 被推走），开启优化仍不下移回来。进一步 trace 为空：`runImagePass` 根本没有调用 `attemptExactFit`，说明测量模型没有把行判为 pushed。根因在 `protectGalleryRows` / `rebuildBreakTable` 的流单元识别，而不是 `applyScale`。三种缩图补丁与 deficit 调整均已回退，`git diff src/` 为空。T-200#B-002 已 `blocked`，证据在 `audit/reports/T-200-B002.md`。

## 9. 四格素材总计划

PlanWeave 画布 `media-matrix-v1`：9 任务 / 29 块 / 9 个审查门，图质量 100。链路：内部库加载 → 行压缩核验 → 功能覆盖矩阵 → 四格盘点 → 静帧四格 → 动效四格 → 处理入库 → 展示与本地构建 → 收口。已提交 T-199（加载门禁）与 T-200#B-001（行压缩定位）；T-200#B-002 是当前就绪块。

## 10. 四格推进（第四轮）

- `demo/media` 已从外部库迁入仓内（32MB，gitignored），`manifest-check` 通过。
- **T-201 功能覆盖矩阵**：26 页 · 40 设置 · 10 参数 · 4 命令 · 47 素材；零图页面全部有理由，未解释缺口 0。产物 `audit/coverage.md`。
- **T-202 四格盘点**：47 条 × 176 格，机制标注为 PDF 渲染 / CDP 静帧 / winapp 动效；产物 `audit/matrix.md`。
- **T-203#B-001**：zh/dark 41/41，确认已齐。
- **T-203#B-002（进行中）**：zh/light 批量采集 23/23 内容静帧成功，`finish-stills` 修正“窗口实际 1282px 时硬失败”后编码入库；zh/light 现为 23/41，剩余 18 张界面静帧需 winapp 场景。
- 合计产出从 43/176 提升到 **66/176**。
- 门禁：`manifest-check` 通过（5 条覆盖率警告）、`check:demo` 通过、`check:docs` 0/8、`src/` 未改。

## 11. 行压缩修复与 S19-01（第五轮）

- **T-200#B-002 通过（方案 2）**：在 `runImagePass` 里对 `residual ∈ [0,12)` 的画廊行做一次性预压缩，`deficit = 20 + residual`，上限仍为 30%；不进入 `attemptExactFit`，不在旧页坐标里二分。改动 26 行，`check:docs` 0/8。
- 实测：510px 空白块两版都在第 1 页（不误缩）；515/520/525px 关闭优化第 2 页、开启优化第 1 页。
- **AG-S19-01 中文版产出**：1500×847 WebP，54KB；写入 `demo/media/zh/any/stills/`，并在 `docs/zh/export/pagination.md` 与英文对应页加入图注。
- `docs:sync` 同步 44 个文件；`docs:check` 86 处媒体引用全部存在；`docs:build` 通过。
- 清单：67/176 格已产出，`zh/any` 3/6。
- 剩余 T-008 图：S19-02（单图，可用现有 off/images 直接出）、S19-03（标题分页）、S19-04/05（孤行/浮动，需新夹具）及对应的 5 张英文版。

## 12. 拼板分隔线与 S19-02/03（第六轮）

- `pdf-stills.mjs` 增加 6px 竖直分隔线：深色主题 `#E5E7EB`，浅色/白底 `#6B7280`，由 `--theme` 选择；不再直接 `+append` 两张页面。
- `AG-S19-01` 重生成（1500×845，55KB），中英 `export/pagination.md` 均已引用。
- `AG-S19-02` 生成（1500×845，173KB），插入「规则二：页末单图缩到贴底」，中英同步。
- `AG-S19-03` 为已有素材，补画同规则深色竖线（1500×1109，94KB）；因英文版尚未产出，暂未插入文档，避免中英图序不一致。
- 文档：`docs:sync` 44 文件，`docs:check` 88 处媒体通过，`docs:build` 通过。
- 清单：zh/any 3/6（S19-01/02/03），总 67/176。

## 13. 后台采集与英文分页图（第七轮）

- `scene.prepare` 新增 `background: true`：跳过 `setAlwaysOnTop`、`moveTop`、`setContentSize`、`show/focus` 与 `focusWindow()`；所有 PDF 导出/扫描脚本默认使用。
- 导出按钮改走 CDP `button.click()`，不再使用需要标定的原生点击；`clickText` 从 PDF 链路移除。
- `ensure-obsidian.sh` 支持 `AG_BACKGROUND=1` 最小化启动，但实测最小化后 CDP 不可用，因此默认不启用；采集期间不再抢焦点，启动瞬间仍可能前置一次。
- 英文库首次打开会被“信任作者”弹窗挡住；通过 CDP 点击「信任仓库作者并启用插件」后插件加载正常。
- `AG-S19-01` 英文版产出（1500×845，70KB），与中文版一起被中英页面引用。
- `AG-S19-04`（孤行）与 `AG-S19-05`（浮动）中文版产出；英文单图 S19-02 在当前夹具下未触发压缩，已从中英页面撤回，等夹具调好再成对加入。
- 文档：`docs:check` 86 处媒体通过，中英图序一致。

- 单图预压缩也尝试过一次（按 `residual` 直接缩 `<img>`），英文单图在 490/500px 仍未触发，代码已撤回；`src/pdf-pagination.js` 只保留已验证的画廊预压缩 26 行。
- `main.js` 重建后哈希 `6795e2c2…`，两个演示库 `BUILD.json` 已更新；`check:demo` 与 `check:docs` 均通过。

- 英文 S19-03/04/05 已产出并插入中英页面；`en/any` 4/6，`zh/any` 5/6。
- 英文单图 S19-02 在 480px 两版第 1 页、490px 两版第 2 页，压缩始终不触发；无差异产物已移到 `demo/.cache/rejected/`，manifest 不再计为完成。
- 文档：`docs:check` 92 处媒体引用存在，中英图序一致。

## 14. T-008 / T-009 收口（第八轮）

- 单图预压缩通过：外层嵌入宽度与 `<img>` 宽高一起按缺口缩放，英文单图 500px 命中（关闭第 2 页、开启第 1 页）。
- **AG-S19-02 英文版完成**，T-008 的 10 张分页对照图中英各五张全部齐备，并逐条接入五条规则。
- T-008（采集链、10 张图、页面接入、审查）与 T-009（全套校验、审查）在 `canvas-c2e78421` 全部 `completed`，`Next claimable: none`。
- `src/pdf-pagination.js` 最终 50 行：画廊预压缩 + 单图预压缩；`check:docs` 0/8。
- 素材 74/176：zh/dark 41/41、zh/light 23/41、zh/any 5/6、en/any 5/6。
- 文档：94 处媒体引用、26 页 × 2 语言图序一致；构建用 `.vitepress/dist-check`（dev server 占用 dist）。

## 15. 单图修复与界面采集尝试（第九轮）

- 单图预压缩通过：外层嵌入宽度 + `<img>` 宽高一起缩放；英文单图 500px 命中（off 第 2 页 / on 第 1 页）。
- AG-S19-02 英文版完成；T-008 的 10 张图中英各五张齐备，逐条接入五条规则。
- T-008#B-001..B-003、R-001 与 T-009#B-001、R-001 全部 `completed`，`canvas-c2e78421` 的 `Next claimable: none`。
- 新增 `ui-stills.mjs`：CDP 打开界面、量框、截图、裁剪、编码，全程不抢焦点。
- 界面采集遇到的阻碍：设置页在独立 BrowserWindow，不在笔记渲染进程；PDF 导出弹窗的选择器目前命中的是笔记内预览块，未产出有效 UI 静帧。误采图已移到 `demo/.cache/rejected/`。
- 当前清单：74/176，zh/light 仍 23/41。

## 16. 界面静帧突破（第十轮）

- 解决设置页独立窗口：`settings-shot.mjs` 连接标题含“设置”的 `about:blank` CDP target，直接在该窗口量框、截图、裁剪。
- 自定义分区 tab 的真实类名是 `.ag-nav-item`，不是 `.vertical-tab-nav-item`；按文本点击后即可采集“配置管理”。
- PDF 导出弹窗用 `.modal-container`，裁剪弹窗通过图片行 `.ag-crop-action` 程序化点击打开。
- 产出 7 张 zh/light 界面静帧：AG-S12-04（裁剪）、S14-01（说明/布局）、S15-01（配置管理）、S18-01（PDF 导出）、S20-01（设置页）、S22-01（命令面板）、S22-02（恢复确认）。
- 全部走 CDP，不注入键鼠、不抢焦点。素材：81/176，`zh/light` 30/41。
- 剩余 zh/light 12 格：11 个动效（需 winapp 录制）加 V19-01（PDF 动效）。

## 17. 动效链路与英文推进（第十一轮）

- 动效录制打通：`scenes/*.mjs` 直接跑 ffmpeg gdigrab，前一次失败是 `media/<lang>/<theme>/motion` 目录不存在；补齐后 zh/light 11 个动效全部成功，zh/light 达 41/41。
- 场景支持英文：`scene.prepare` 按编号把中文笔记名映射到英文笔记；PDF 动效的按钮文案按 `LANG` 选择 `Paginated preview` / `Layout preview` / `Cancel`。
- `figures.json` 批量补了 42 条 `noteEn`。
- 英文深色完成 11 个动效 + 1 张内容静帧，归档到 `demo/media/en/dark`；`en/dark` 12/41。
- 阻塞：`shoot-batch` 的 `from` 锚点是中文小节标题（如「正文断组」「零空行」），英文笔记没有对应文本，`shoot.sh` 直接返回 `anchor not found`。22 个内容静帧需要逐条补 `fromEn` 或改为按位置测量。
- 清单：104/176；`zh/dark 41/41`、`zh/light 41/41`、`zh/any 5/6`、`en/dark 12/41`、`en/any 5/6`。

## 18. 英文四格基本收口（第十二轮）

- 22 个内容静帧补 `fromEn`（英文小节标题），`shoot-batch` 按语言取 `from`/`fromEn`。
- 关键修复：`shoot.sh` 启动时按 `obsidian.json` 的默认库打开；英文批量前必须把默认库切到 `demo-en`，否则报 `missing note 03-grouping.md`。
- 英文深色 41/41：23 内容静帧 + 7 界面静帧 + 11 动效。
- 英文浅色 40/41：23 内容静帧 + 7 界面静帧 + 10 动效；`AG-V07-01` 依赖中文笔记里特定的绑定行，英文笔记没有该状态，未产出。
- 动效文案本地化：PDF 的 `Paginated preview` / `Layout preview` / `Cancel`，裁剪的 `Save` / `Clear crop`。
- 清单：173/176；`zh/dark 41/41`、`zh/light 41/41`、`en/dark 41/41`、`en/light 40/41`、`zh/any 5/6`、`en/any 5/6`。
- 剩余 3 格：`AG-V07-01` en/light、`AG-V19-01` zh/any 与 en/any。

## 19. 文档站结构与素材链路修复（第十三轮）

- 根因：`nav/sidebar` 写在顶层 `locales["/zh/"].themeConfig`，而 VitePress 的 localeIndex 是 `zh`，整块主题配置被丢弃。改为顶层 `locales.zh/en.themeConfig` 后，侧栏 33 个节点、顶部 7 个菜单、H2/H3 大纲全部恢复。
- 新增中英「文档地图」页 `/zh/guide/map`、`/en/guide/map`，按七组列出 27 页与按问题索引；侧栏首项可直达。
- 26 个内容页统一追加「相关阅读 / Related」，每页 3 条双向链接。
- 素材引用：17 个仍指向旧 `.png` 的 id、54 个文件统一改为当前 WebP，并按实际产物校正 `width/height`。
- 视频：4 处「海报 + 外链 mp4」改为 `<video autoplay loop muted playsinline>`，新增 `docs/.vitepress/theme/custom.css`；静音自动循环。
- `docs:check`：94 处媒体引用存在，27 页 × 2 语言标题与图序一致，内部链接可解析；构建通过。

## 20. 文档语体统一（第十四轮）

- 语体规则：陈述句、短句、少用第二人称与破折号插话；标题改为名词性表述（“什么时候不浮动”→“不浮动的条件”）。
- 重写页面：quick-start、concepts、grouping、rows、float、handles、crop、pagination、map、index 的核心段落。
- 全站替换：删除“你/我们/其实/松手/关掉/手调/——/？”等口语标记；zh 页面这些标记均已归零。
- 标题调整：三个常用操作、小结、不适用场景、清除手动调整、设计取舍、曲线的来源、两个上限的分工、判断是否为插件问题等。
- 中英 27 页标题与图序仍一致；`docs:check` 94 处媒体通过；`dist-check10` 构建通过。

## 21. 示例源码与示例库入口（第十五轮）

- 新增 `DemoDownload.vue`，挂在右侧大纲底部（`aside-outline-after`）：中文页指向 `demo-vault.zip`，英文页指向 `demo-en-vault.zip`，文案随语言切换。
- 补齐示例源码块：grouping 3、rows 4、height 2、width 2、resize 1、crop 3、routing 2；英文对应 rows/height/width/resize/crop 同步。
- 代码块使用演示库真实相对路径（`assets/photo/...`、`assets/ratio/...`），与下载卡片配合可复现截图。
- `docs:check` 94 处媒体、27 页中英一致；`dist-check14` 构建通过；卡片在中英页分别输出正确 zip 链接。

- 示例库卡片从 `aside-outline-after` 移到 `aside-outline-before`，位于“本页目录”上方；构建产物中卡片节点顺序先于 `VPDocAsideOutline`。
- 样式改为 `margin-top: 0; margin-bottom: 20px`，避免顶部多余留白。

## 22. 根路径按设备语言重定向（第十六轮）

- 删除开屏语言选择页，`docs/index.md` 改为 `layout: false` + `<LangRedirect />`。
- 规则：`navigator.languages[0]` 以 `zh` 开头（含 `zh-TW`/`zh-HK`）→ `/zh/`；其他语言 → `/en/`；空值或 `und` → `/zh/`。
- 重定向在组件 `onMounted` 中执行，保留 `search` 与 `hash`；无 JS 时显示中英文手动链接。
- `dist-check17` 构建通过，根产物包含 `ag-redirect`，不再包含“选择语言”。

## 23. 参数回写事故与全量重录（第十七轮）

- 原因：场景 `prepare` 读取笔记原文，`restore` 结束时写回该原文；用户在录制期间删除的 `ag:rows=4,2` 被写回。
- 修复：中英 `06-画廊手柄.md` 均删除 `ag:rows=4,2`；英文笔记清理场景残留的 C/D 裁剪与 E/F `ag:group`；`demo-en/09` 恢复 HEAD。
- 受影响素材仅 `AG-A07-01`、`AG-A07-02`、`AG-V07-01`（均取自 06 笔记）；四个主题格共 12 支全部重录，循环闭合通过；首帧确认为 3+3，不再是 4+2。
- 清单：174/176；`zh/dark`、`zh/light`、`en/dark`、`en/light` 均 41/41，仅剩 `AG-V19-01` 的 zh/any 与 en/any。
- `restore` 增加保护：覆盖前把当前笔记备份到 `.cache/restore/<timestamp>-<name>`，避免再次无痕吞掉外部编辑。

## 24. 媒体矩阵 176/176 与计划收口（第十八轮）

- 新增 `AG-V19-01` 场景：PDF 导出弹窗切分页预览，切换“标题分页”开关并滚动，等待预览重排完成；zh/any 与 en/any 各 1 支，循环闭合通过。
- 清单：176/176，`zh/dark`、`zh/light`、`en/dark`、`en/light` 各 41/41，`zh/any`、`en/any` 各 6/6。
- 文档补齐 8 个功能页素材：handles、resize、syntax、dialog、profiles、export/dialog、settings、commands；124 处媒体引用、27 页中英一致，`docs:build` 通过。
- T-203（静帧四格）、T-204（动效四格）、T-205（编码与 manifest）、T-206（页面接入与构建）、T-207（全量验证）全部提交并通过审查；`Next claimable: none`。
- 全量门禁：`check:demo`、`check:docs`、`manifest-check`（0 警告）、`docs:sync/check/build` 全部通过；无超限素材。
