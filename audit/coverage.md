# 功能覆盖矩阵

> 由 `node tools/docs/coverage.mjs` 生成。数据来源：`audit/facts.json`（代码事实）、
> `tools/capture/figures.json`（素材登记）与 `docs/zh`（中文文档）。

## 总量

| 项 | 数量 |
| --- | --- |
| 中文页面 | 26 |
| 设置项 | 40 |
| `ag:` 参数 | 10 |
| 命令 | 4 |
| 素材登记 | 47 |

## 页面 × 素材

| 页面 | 二级标题 | 素材数 | 素材 id | 状态 |
| --- | --- | --- | --- | --- |
| `annotations/crop` | 7 | 5 | `AG-S12-01` `AG-S12-02` `AG-S12-03` `AG-S12-04` `AG-A13-01` |  |
| `annotations/dialog` | 5 | 1 | `AG-S14-01` |  |
| `annotations/scopes` | 6 | 2 | `AG-S13-01` `AG-S13-02` |  |
| `annotations/syntax` | 6 | 3 | `AG-S11-01` `AG-S11-02` `AG-S11-03` |  |
| `changelog` | 2 | 0 | — | 版本历史，不需要图 |
| `export/dialog` | 7 | 2 | `AG-S18-01` `AG-V18-01` |  |
| `export/pagination` | 11 | 6 | `AG-S19-01` `AG-S19-02` `AG-S19-03` `AG-S19-05` `AG-S19-04` `AG-V19-01` |  |
| `export/troubleshooting` | 6 | 0 | — | 排查步骤，文字足够 |
| `gallery/grouping` | 7 | 3 | `AG-S04-01` `AG-S04-02` `AG-S04-03` |  |
| `gallery/handles` | 6 | 3 | `AG-A07-01` `AG-A07-02` `AG-V07-01` |  |
| `gallery/height` | 6 | 2 | `AG-S06-01` `AG-S06-02` |  |
| `gallery/rows` | 7 | 4 | `AG-S05-01` `AG-S05-02` `AG-S05-03` `AG-S05-04` |  |
| `guide/concepts` | 7 | 0 | — | 五条概念均为文字陈述，配图只会重复正文 |
| `guide/install` | 6 | 0 | — | 安装步骤，文字足够 |
| `guide/quick-start` | 5 | 3 | `AG-S02-01` `AG-V00-01` `AG-A02-01` |  |
| `index` | 3 | 0 | — | 首页复用 quick-start 的 AG-V00-01 / AG-P00-01，不单独登记 |
| `reference/commands` | 6 | 2 | `AG-S22-01` `AG-S22-02` |  |
| `reference/compatibility` | 6 | 0 | — | 兼容性表格，不需要图 |
| `reference/pitfalls` | 3 | 0 | — | 答疑列表，无稳定视觉对象 |
| `reference/settings` | 11 | 3 | `AG-S20-01` `AG-A20-02` `AG-A20-01` |  |
| `single/float` | 5 | 1 | `AG-S09-01` |  |
| `single/resize` | 6 | 2 | `AG-A10-01` `AG-V10-01` |  |
| `single/width` | 5 | 2 | `AG-S08-01a` `AG-S08-01b` |  |
| `templates/import` | 7 | 0 | — | 规则文件格式，表格与 JSON 示例足够 |
| `templates/profiles` | 7 | 1 | `AG-S15-01` |  |
| `templates/routing` | 6 | 2 | `AG-S17-01` `AG-S17-02` |  |

## 设置项落点

| 页面 | 设置数 | 键 |
| --- | --- | --- |
| `export/dialog` | 23 | `pdfExport.pageSize`、`pdfExport.orientation`、`pdfExport.marginMode`、`pdfExport.marginPreset`、`pdfExport.mirrorMargins`、`pdfExport.innerMarginMm`、`pdfExport.outerMarginMm`、`pdfExport.scalePercent`、`pdfExport.includeTitle`、`pdfExport.pageNumber.enabled`、`pdfExport.pageNumber.band`、`pdfExport.pageNumber.align`、`pdfExport.previewMode`、`pdfExport.timeoutMs`、`pdfExportEnabled`、`pdfPagination.headingBreakEnabled`、`pdfPagination.headingBreakLevel`、`pdfPagination.imageOptimizationEnabled`、`pdfPagination.imageShrinkPriority`、`pdfPagination.singleImageMaxShrink`、`pdfPagination.lineHeightMaxShrink`、`pdfPagination.orphanControlEnabled`、`pdfPagination.orphanMaxLines` |
| `export/pagination` | 1 | `floatSpaceMode` |
| `gallery/handles` | 1 | `mobileBreakpoint` |
| `gallery/height` | 6 | `galleryControl`、`galleryMinHeight`、`galleryMaxHeight`、`galleryOrphanMaxHeight`、`galleryMaxPerRow`、`galleryGap` |
| `reference/settings` | 8 | `language`、`captionGap`、`imageBottomGap`、`textGap`、`widthControl.gain`、`widthControl.medianRatio`、`resizeEnabled`、`alignButtonsEnabled` |
| `single/width` | 1 | `floatMax` |

## 参数

| 参数 | 语法 | 代码位置 |
| --- | --- | --- |
| `ag:layout` | `auto | gallery | float | center` | `src/annotations.js:65-68` |
| `ag:side` | `left | right | center | centre` | `src/annotations.js:69-72` |
| `ag:width` | `10%–100%（必须带 %）` | `src/annotations.js:327-335` |
| `ag:gap` | `0–80（可省略 px）` | `src/annotations.js:337-342` |
| `ag:crop` | `W:H，W/H 各自 1–50，比例 0.1–10` | `src/annotations.js:346-354` |
| `ag:top` | `x1:x2:y，三段，各 0–100；必须与 crop 同时存在` | `src/annotations.js:385-394` |
| `ag:rows` | `逗号分隔，每项 1–15，最多 30 项` | `src/annotations.js:366-377` |
| `ag:group` | `正整数；裸标记等于 1；false 取消` | `src/annotations.js:55-63` |
| `ag:isolate` | `标记，或 =false` | `src/annotations.js:53-54` |
| `ag:exclude` | `标记，或 =false` | `src/annotations.js:53-54` |

## 命令

| id | 标签 | 位置 |
| --- | --- | --- |
| `set-image-annotation` | 设置图片说明与布局 | plugin.js |
| `clear-image-annotation` | 清除图片说明与布局 | plugin.js |
| `reset-document-image-layout` | 恢复文档默认图片样式 | plugin.js |
| `export-pdf` | 导出 PDF (AutoGallery) | plugin.js |

## 缺口

- 无未解释的零图页面。

- 英文素材：`en/any`、`en/dark`、`en/light` 仍为 0，四格拍摄从 T-203 开始。
- 设置项按页面聚合，不保证每个键都在正文出现；逐键核对由 `check:docs` 的设置表断言覆盖。
