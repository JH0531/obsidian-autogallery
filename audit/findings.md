# 展示体系审计结论

## 0. 这份文件是什么

`audit/facts.json` 是从代码生成的事实源，`audit/claims.json` 是从展示面抽取的断言台账，本文件是两者的裁定结果。任何一条修改意见都必须能在这里找到双侧证据：展示侧 `文件:行`，代码侧 `文件:行`。

- 事实源：`node tools/docs/facts.mjs`
- 台账：`node tools/docs/claims.mjs`
- 门禁：`npm run check:docs`（当前 **21 条错误 + 5 项结构失败**，退出码 1）

审计覆盖 **86 个页面/文件 + 45 条素材描述**，行级断言 **1421 条**。侦察阶段人工登记的 318 条是抽样；本文件与 `claims.json` 是全量。

---

## 1. P0：被代码直接证伪

| # | 断言 | 位置 | 代码事实 | 修改 |
| --- | --- | --- | --- | --- |
| 1 | 画廊行「**不参与**单图压缩」 | `docs/export/pagination.md:7`、`demo/18-PDF分页.md:20`、`specifications/pdf-pagination.md:18` | `pdf-pagination.js:262-301` 不过滤画廊；`:442-449` 收集格内 `<img>`；`:455-463` 整行同比例缩、栏位不变；`:607` 不作 donor；`:766` 孤行修复不压它 | 改成三段式：不拆页 / 可整行同比例缩 / 不作 donor、不被孤行修复 |
| 2 | 行距最大压缩 **5%** | `docs/export/pagination.md:18,66`、`docs/en/export/pagination.md:18,66` | `config.json:20` = 0.10；`defaults.js:66`；`settings-tab.js:785` 上限 20% | 改 **10%（0–20%）** |
| 3 | 说明对话框「只有**四项**」/ "four fields" | `demo/13:14`、`docs/annotations/dialog.md:7`、`docs/en/annotations/dialog.md:7` | `plugin.js:1497-1501` = 说明/布局/**浮动方向**/栏宽/间距 | 改 **五项**，并补「浮动方向」 |
| 4 | 画廊「**四类**手柄」 | `README.md:16`、`demo/06:10`、`demo/06:19` | `docs/gallery/handles.md:5` 与 changelog 均为五类；代码含列宽、行高、交换/并入、绑定链接、降级状态 | 改 **五类** |
| 5 | 对齐箭头「**只改对齐，不写入宽度**」 | `README.md:82` | `editor-resize.js:979-997` 同事务写入 `ag:width` + `ag:side` + `ag:layout` | 改为「同时记录当前宽度」 |
| 6 | 打印失败「**自动回退**原生导出」 | `README.md:126` | `pdf-export.js:68-76` 仅预览准备失败自动回退；`pdf-export-modal.js:694-702` 打印超时保留对话框 + 手动按钮 | 区分两条失败路径 |
| 7 | 原生导出拦截「**改用本插件管线**」 | `docs/reference/settings.md:64`、`docs/en/reference/settings.md:64` | `pdf-integration.js:7-17`、`pdf-pagination.js:202-228`：隐藏视口为 0，只能 CSS 级 | 改为「只保证 CSS 级效果，不跑几何分页」 |
| 8 | 安装需 `styles.css` | `docs/index.md:62`、`docs/guide/install.md:15` | 仓库根无该文件；`docs/en/guide/install.md:13` 已写 2 文件 | 统一为 `main.js` + `manifest.json` |
| 9 | 「旧文档说上限 **90%**」 | `demo/21:24`、`docs/reference/pitfalls.md:17` | 当前 26 页中文文档不存在任何 90% 表述；合法范围 10%–100%（`annotations.js:327-335`） | 删掉「旧文档」叙事，直接写合法范围 |
| 10 | 显式 `ag:width` 超阈值「**自动降级为居中**」 | `README.md:83` | `renderer.js:1137-1143,1180`：有显式 `layout=float`/`side` 时保持浮动；只有仅写 width 才按 `floatRatio` 判居中 | 改成条件句 |

---

## 2. P1：不完整、数值偏差或结构分叉

| # | 断言 | 位置 | 事实 | 修改 |
| --- | --- | --- | --- | --- |
| 1 | 两张 1:3 并排需 **1140px** | `docs/gallery/height.md:11`、`demo/05:17` | `(760−12)/0.6667 = 1122`；1140 是忽略 gap 的值 | 改 **1122**，并保留「各格 200px 宽」不变 |
| 2 | 方图 **40%（306px）** | `docs/single/width.md:21`、`demo/07:26` | 实调 `calculateWidthRatio(1)` = **39.1% / 297.5px** | 改 **39%（297px）** |
| 3 | 方图「约**一半**」 | `demo/02:26`、`docs/guide/concepts.md:19`、`docs/en/guide/concepts.md:19`、`docs/templates/routing.md:26` | 同上，39% 更接近四成 | 改「约**四成**」 |
| 4 | 文档站 **25 页** | `tools/capture/figures.json:13` | 实测 26 页/语言 | 改 **26** |
| 5 | poster 为 `.apng`、**1000×600** | `figures.json:493` | 站点实际 `AG-P00-01.jpg`、**1200×800** | 以实际产物为准，更新 meta |
| 6 | `templates/transfer` | `figures.json:504` | 实际页面 `templates/import` | 改页面 id |
| 7 | 路由有「启用开关」 | `demo/19:26` | `settings-tab.js:1163-1187` 无此控件；仅数据层 `enabled` 生效 | 删「开关」，改为「数据层字段，UI 不提供」 |
| 8 | 英文首页链接 `/reference/settings` | `docs/en/index.md:14,48` | 缺 `/en` 前缀，落到中文页 | 改 `/en/reference/settings` |
| 9 | 英文快速上手的「三个参数」 | `docs/en/guide/quick-start.md:25-37` | 中文页是 isolate / rows / 拖拽宽度；英文页是 width / side+gap / crop+top，且整页无媒体 | 与中文页逐节对齐；补 3 个媒体块 |
| 10 | 「stores nothing outside your vault」 | `docs/en/guide/install.md:17` | `externalProfilePath` 可指向库外（`defaults.js:42`） | 改为「配置只写入库内，除非你显式设置外部模板路径」 |
| 11 | 默认每行「**at most three**」 | `specifications/layout-core.md:29` | `layout.js:2` 的缺省值是 3，但两处调用都传 `galleryMaxPerRow`（默认 5） | 改为「打包器缺省 3；渲染器传入设置值，默认 5」 |
| 12 | 「Gallery rows **must never** be included」 | `specifications/validation.md:108` | 与 `pdf-pagination.js` 的实际压缩路径相反 | 改为「画廊行可作贴合目标，但不得作为 donor 或孤行修复候选」 |
| 13 | 行高条「straddles 图片底边」 | `specifications/live-preview.md:705` | `gallery-handles.js:393-395`：有图注缝时 `height + gap/2 - HOT_ZONE/2` | 以 `:780` 的「图注缝中点」为准，删除 `:705` 的旧句 |
| 14 | 降级「five steps」 vs 窄格「four states」 | `specifications/live-preview.md:712` vs `:754` | 两处描述不同范围：通用五步含 `horizontal`，窄格四态跳过它 | 补一句范围说明，避免读者以为互相否定 |
| 15 | 模板规则「四个字段」 | `docs/templates/profiles.md:9-14`、`demo/15:20-22` | 实际数据含第五个字段 `floatAlignment` | 补字段说明 |
| 16 | demo 资源 `assets/ratio/*.png` | `docs/gallery/handles.md:45-48`、`docs/annotations/scopes.md:13-16` | 演示库实际为 `.svg` | 改扩展名 |
| 17 | 素材四格与站点平铺不一致 | `figures.json:488` vs `docs/public/media/{stills,motion,posters}` | 站点是 v3 扁平布局；`docs/scripts/` 为空，`docs:sync` 不存在 | 补同步脚本或明确手工复制步骤；`check:docs` 已校验引用存在 |

---

## 3. 误报与已验证正确（不要改）

审计的价值一半在「确认哪些是对的」。以下曾被怀疑，实测为正确：

| 断言 | 验证方式 | 结论 |
| --- | --- | --- |
| 五张每格 **120px**、3+2 得 **205 / 296px** | 按实际图片比例 1.4995 / 0.75 / 1.3333 / 0.75 / 1.7778 复算：`(760−48)/6.1106=116.5`、`(760−24)/3.5828=205.4`、`(760−12)/2.5278=295.9` | **正确**，不要改 |
| 16:9 占 **60%（458px）** 且「正好压在阈值上」 | `calculateWidthRatio(16/9)=60.2%`，`>60` 故居中；再窄一点才浮动 | **正确** |
| `ag:isolate=false` / `ag:exclude=false` | `annotations.js:53-54` 两者都接受 `false` | **支持**，此前「只有 group 认 false」的怀疑不成立 |
| `ag:top` 是否已废弃 | `annotations.js:91-108`：`top` 作为 `crop` 子字段仍解析；`RETIRED_KEYS` 只影响重写时的裸键 | **仍有效**（必须与 `crop` 同时出现） |
| 两张 3:2 并排行高约为栏宽三分之一 | `(760−12)/3=249.3`，249/760=0.328 | **正确** |

---

## 4. 28 组矛盾的裁定

| 组 | 双方 | 裁定 |
| --- | --- | --- |
| C1 浮动阈值含等号 | README/settings「低于」 vs float.md/en「at or below」/spec「inclusive」 | 代码 `renderer.js:1180` 用 `<=`：**含等号**。改 README 与 settings |
| C2 对齐箭头写不写宽度 | README「不写」 vs resize/demo/spec「写」 | 代码写：**README 错** |
| C3 显式宽度超阈值 | README「降级居中」 vs float/spec「仍浮动」 | 有 side/layout 时浮动；仅 width 时居中。**两边都不完整**，改写为条件句 |
| C4 方图 40% vs 一半 | width/demo 40% vs concepts「一半」 | 实测 39.1%：**40% 组接近正确但需改 39%**；「一半」错 |
| C5 对话框四项 vs 五项 | dialog/demo vs commands | 代码五项：**四项错** |
| C6 画廊行是否压缩 | 三处「不参与」 vs figures.json | 代码可压缩：**三处错**，figures 描述方向正确 |
| C7 导入校验 | 「整份拒绝」 vs 「单条丢弃」 | 分两层：规则级丢弃、模板级拒绝。**两边都对，需写明层级** |
| C8 导出去向 | 保存窗口 vs 下载目录 | 三级回退：FilePicker → Electron 对话框 → `<a download>`。**两边都对**，补完整链路 |
| C9 原生拦截语义 | README「只 CSS」 vs settings「改用管线」 | **README 对，settings 错** |
| C9b 失败是否自动回退 | README「自动」 vs spec「不自动」 vs demo「先关窗」 | **spec 对**；README 与 demo 都需改 |
| C10 改设置是否需重开 | README「即时」 vs routing「切换/重开」 | 设置保存会触发刷新（README 对）；模板路由变更的重算时机需实验，标 `needs-experiment` |
| C11 安装文件数 | zh 3 个 vs en 2 个 | **en 对**（2 个），zh 改 |
| C12 行高条位置 | live-preview:705 vs :780 | **:780 对**，删 :705 |
| C13 降级级数 | 5 vs 4 | **范围不同，都成立**；补范围说明 |
| C14 手柄数 | 4 vs 5 | **5 对** |
| C15 1140 vs 1122 | demo/height vs 公式 | **1122 对** |
| C16 五张数字 | demo/rows vs 等比例假设 | **demo 对**（已复算） |
| C17 行距 5% vs 10% | docs vs config | **10% 对** |
| C18 25 vs 26 页 | figures.json vs 实测 | **26 对** |
| C19 templates/transfer | figures vs 站点 | **import 对** |
| C20 媒体目录 | figures meta vs 站点 | **站点扁平布局是现状**；capture 四格是交付规范，两者需同步脚本，不是文案错 |
| C21 poster 格式 | figures meta vs 站点 | **站点 jpg 1200×800 是实际产物**；meta 过期 |
| C22 isolate/exclude=false | docs vs 早期怀疑 | **docs 对** |
| C23 每行 3 vs 5 | spec vs 文档 | **渲染器传 5**；spec 的「at most three」是打包器缺省，需限定语境 |
| C24 en 首页「one row」 | en/index vs rows | 措辞过强：应为「形成行」，不是「全部一行」 |
| C25 demo 资源扩展名 | docs `.png` vs 实际 `.svg` | **`.svg` 对** |
| C26 90% 幽灵 | demo/pitfalls 引用 | **引用对象已不存在**，删叙事 |
| C28 规则字段四个 vs 五个 | profiles/import vs data.json | **实际五个**，补 `floatAlignment` |

---

## 5. 素材与覆盖缺口

| 项 | 数量 | 明细 |
| --- | --- | --- |
| `figures.json` 声明但无文件 | **20 / 45** | `AG-S14-01`、`AG-S15-01`、`AG-S18-01`、`AG-V18-01`、`AG-S19-01/02/03`、`AG-V19-01`、`AG-S20-01`、`AG-A20-01/02`、`AG-S22-01/02`、`AG-S12-04`、`AG-A13-01`、`AG-A07-01/02`、`AG-V07-01`、`AG-A10-01`、`AG-V10-01` |
| 本轮补拍 | **5 × 2 语言** | `AG-S19-01..05`（分页专题） |
| 其余 15 条 | 立项 | 在 `figures.json` 标 `defer` 与理由，`audit.mjs` 渲染 |
| 中文零图页面 | **14 / 26** | `gallery/handles`、`single/resize`、`annotations/syntax`、`annotations/dialog`、`templates/profiles`、`templates/import`、`reference/settings`、`reference/commands`、`reference/compatibility`、`reference/pitfalls`、`export/dialog`、`export/pagination`、`export/troubleshooting`、`changelog` |
| 英文零图页面 | **16 / 26** | 上述 14 页 + `en/index`、`en/guide/quick-start` |
| 有文件无引用 | 4 | `AG-S11-01/02/03.png`、`AG-S13-02.jpg` |
| `noteEn` 缺失 | **45 / 45** | `figures.json:491` 自己规定「无 noteEn 则 en 拒绝拍摄」，但无一条填写 |

---

## 6. 修改顺序

1. **先改事实**：第 1、2 节的条目全部落到源文件；每改一条，`npm run check:docs` 的对应 finding 必须消失。
2. **再补结构**：英文页与中文页对齐；P1 第 9、11、13、14、15 条。
3. **最后补图**：分页 5 图 × 2 语言；其余 15 条标 `defer`。
4. **收口**：`check:docs` 退出 0、`manifest-check` 退出 0、`docs:build` 通过、`check:demo` 通过。
