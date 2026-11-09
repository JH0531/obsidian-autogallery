# 素材摄取工具链

生成文档站的静帧与动效。**代码在仓库，产物在演示库**：工具随插件版本化，演示库只是一个可替换的输出目标。

```
仓库 tools/capture/          ← 代码、镜头清单、审计表
演示库 (AG_VAULT)/           ← media/、.cache/、插件基线
```

## 文档分工

| 文件 | 回答什么 |
| --- | --- |
| 本文件 | 工具链结构、命令、产物规格 |
| [`recording.md`](recording.md) | 录制规则与注意事项（踩过的坑都在这里） |
| [`audit.md`](audit.md) | 页面 ↔ 素材映射、版本矩阵、缺口与重叠（由脚本生成） |
| [`winapp/README.md`](winapp/README.md) | 原生输入注入层的契约与失效模式 |

## 演示库从哪来

按顺序取第一条命中的：环境变量 `AG_VAULT` → `tools/capture/vault.local.json`（格式见 `vault.example.json`）。
两者都没有就直接报错，没有「猜一个合理路径」的兜底——猜错会把素材写进别的库。

## 两条链路

| 链路 | 机制 | 入口 |
| --- | --- | --- |
| 内容静帧 | CDP 在渲染进程里截图，按小节高度取景 | `shoot-batch.mjs` → `finish-stills.mjs` |
| 动效 / 界面交互 | Windows 原生输入注入 + 录屏，脚本在 `winapp/scenes/` | `node tools/capture/winapp/scenes/<ID>.mjs` |

界面交互为什么必须走注入：UIA 在 Obsidian 里只有四个节点，CDP 合成事件造不出真实的 `:hover`，
而拖拽需要按住按钮穿过中间状态。这两件事只有真实输入能给。

## 产物规格

| 类型 | 尺寸 | 编码 | 上限 |
| --- | --- | --- | --- |
| 静帧 | 1500 宽（元素类裁到元素再放大） | WebP q85（`webp:method=6`，剥离元数据） | 1.2 MB |
| 动效 | 1200×800 | H.264 / CRF 23 / preset slower / 30fps / faststart / 无音轨 | 6 MB |
| poster | 与视频同宽 | WebP q85 | 250 KB |

静帧不用 PNG：同一批画面实测，扁平界面 WebP 是 PNG 的 16–21%，照片内容 WebP q82 是 JPEG 的 48–60%，
而 q85 在 1500 宽下文字仍然锐利。超过 1.2 MB 的帧由 `finish-stills.mjs` 自动降到 q70 重编，
而不是换一种容器——双格式曾经让清单和站点各认一半文件。

动效不用 APNG：站点用 `<video loop>` 播放，APNG 唯一的优势（无控件自动播放）用不上，
而它的逐帧调色板在照片内容上要 2–5 MB/段。实测同样内容 MP4 是 APNG 的 1/6 到 1/10。

整窗录制左右各裁 15 个物理像素再缩放，理由是窗口区域边缘会带进不属于页面的像素。

对比拼板（两张页面并排）必须在中间留 6px 分隔线，否则会被读成一张连续跨页。深色主题用浅线 `#E5E7EB`，浅色或白底用深线 `#6B7280`；`pdf-stills.mjs` 统一按 `--theme` 选择颜色并生成这条线，后处理不要再手动拼两张图。

## 版本矩阵

每条素材都有 **2 语言 × 2 主题 = 4 个版本**。画面里有界面文案，语言就是画面的一部分；
主题改变的是背景与文字配色，一张深色截图放进浅色页面就是错的。

**版本由目录承载，文件名不带后缀**：

```
media/<lang>/<theme>/stills/<ID>.webp
media/<lang>/<theme>/motion/<ID>.mp4
media/<lang>/<theme>/posters/<P-ID>.webp
```

`lang ∈ {zh, en}`，`theme ∈ {dark, light}`，两者的取值由 `figures.json` 的 `matrix` 声明，
`lib/media.mjs` 是唯一把它们拼成路径的地方。同一个编号在四格里是同一个字符串，
站点只按路径取变体，不需要解析文件名。

内容静帧也按语言分开：画面里的标题、图注和正文都是文案，英文版要用英文笔记重拍。
英文笔记尚未就位时 `figures.json` 缺 `noteEn`，`shoot-batch --lang en` 会直接拒绝，而不是把中文画面挂到英文目录下。

## 目录

```
tools/capture/
  README.md / recording.md / audit.md / figures.md   文档
  figures.json      镜头清单：编号、页面、锚点、媒介、取景说明、版本矩阵
  baseline.json     插件 24 键基线，拍摄前校验漂移
  lib/vault.mjs     演示库解析（唯一入口）
  lib/media.mjs     版本矩阵与交付路径（唯一入口）
  lib/theme.mjs     主题切换（走 CDP，作用于笔记窗口）
  theme.js          主题切换的页内片段
  out/              测量中间产物（gitignored）
  winapp/           原生输入注入层
    lib/scene.mjs     场景公共层：开窗、取景、标定、编码、回收
    scenes/<ID>.mjs   一个镜头一个文件，只写动作与断言
    run-ui.mjs        按语言与主题批量重跑界面类镜头
    calibrate.mjs     色块标定（css ↔ 物理像素）
    probe.mjs         能力矩阵，验证环境仍然可用
  archive/probes/   一次性诊断脚本，仅作历史参考
```

## 常用命令

```bash
# 环境自检
node tools/capture/winapp/calibrate.mjs
node tools/capture/winapp/probe.mjs

# 内容静帧（默认 zh/dark；--theme light 拍浅色，--lang en 需要英文笔记）
bash   tools/capture/run.sh stage.js
node   tools/capture/shoot-batch.mjs --only AG-S04-01 --force
node   tools/capture/shoot-batch.mjs --theme light
node   tools/capture/finish-stills.mjs

# 动效与界面
node tools/capture/winapp/scenes/AG-A07-01.mjs
node tools/capture/winapp/run-ui.mjs zh                    # 界面镜头，中文深色
node tools/capture/winapp/run-ui.mjs zh --theme light      # 同一批，中文浅色
node tools/capture/winapp/run-ui.mjs en --theme dark       # 英文深色

# 清单与审计
node tools/capture/build-manifest.mjs
node tools/capture/manifest-check.mjs
node tools/capture/audit.mjs
```

## 改一条素材要动哪里

1. `figures.json`：编号、页面、锚点、媒介、`desc`（这张图回答什么问题）。
2. 若是交互或动效，写 `winapp/scenes/<ID>.mjs`。
3. 跑 `build-manifest.mjs` 登记，`manifest-check.mjs` 验收，`audit.mjs` 刷新映射表。
4. 页面里引用 `/media/<lang>/<theme>/stills/<ID>.webp` 或 `/media/<lang>/<theme>/motion/<ID>.mp4`。

四格各自产出到哪一步只看 `media/manifest.json`：一条素材在 zh/dark 有文件、其余三格没有，
状态就是 `●○○○ 1/4`，不会因为一格完成就显示「已完成」。
