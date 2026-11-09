# 录制手册（内部）

对外笔记不出现任何拍摄指令；所有操作步骤、镜头编号与注意事项集中在这里。
**镜头清单的唯一事实源是 `tools/capture/figures.json`**，实际产物状态以演示库
`media/manifest.json` 为准，两者汇总成 [`audit.md`](audit.md)（由 `audit.mjs` 生成，不要手改，
更不要在本文件维护第二份镜头表——上一版就是这样漂移的）。

工具链在插件仓库的 `tools/capture/`，演示库只作为目标目录。演示库路径由 `AG_VAULT`
环境变量或 `tools/capture/vault.local.json` 指定，缺失直接报错而不是猜。
入口与文件分工见 [`README.md`](README.md)。

## 编号规则

`AG-<媒介><页序号>-<序号>`

| 段 | 取值 | 说明 |
| --- | --- | --- |
| 媒介 | `S` 静帧 / `A` 手势动效 / `V` 流程动效 | **A 与 V 都输出 MP4**，字母只区分镜头性质，不区分容器 |
| 页序号 | `00`–`23` | **= 笔记 order + 1**；例外：order 20 → 22、order 21 → 23（21 曾被废弃方案占用） |
| 序号 | `01` 起连续 | 同一页同一媒介内不跳号 |

编号里没有语言和主题：两者由目录承载（`media/<lang>/<theme>/<kind>/`），同一编号在四格里是同一个字符串。
把 `-zh`、`-dark` 写进文件名会让路径变成唯一的事实源，改名即断链。

旧编号全部废弃不重用；`figures.json` 的 `retired` 列表记录废弃原因，
其中与在用编号撞号的条目已标注 `reusedBy`。

## 一轮录制的标准流程

```bash
# 0. 前置：窗口 1200×800 内容区、dpr 1.25、前台可见
bash tools/capture/run.sh stage.js

# 1. 内容静帧：测量 → 拍摄 → 拼接收边（默认 zh/dark，--theme light 拍浅色）
node tools/capture/plan-stills.mjs
node tools/capture/shoot-batch.mjs --only AG-S04-01 --force
node tools/capture/shoot-batch.mjs --theme light
node tools/capture/finish-stills.mjs

# 2. 动效与界面：一个镜头一个场景文件
node tools/capture/winapp/scenes/AG-A07-01.mjs
node tools/capture/winapp/run-ui.mjs zh                 # 界面类批量（12 条），中文深色
node tools/capture/winapp/run-ui.mjs en --theme light   # 同一批，英文浅色

# 3. 登记与校验
node tools/capture/build-manifest.mjs
node tools/capture/manifest-check.mjs
node tools/capture/audit.mjs
```

录制前必须满足：

1. `node tools/capture/reset-baseline.mjs --check` 通过（24 键基线未被改动）。
2. `.obsidian/plugins/obsidian-autogallery/main.js` 与插件仓库 HEAD 一致；`plugin:reload`
   不可信，用 `eval` 读 `manifest.version` 与 `settings` 键数确认。
3. 系统缩放 100%，Obsidian 缩放 1.0，`showInlineTitle=false` 已生效（否则双标题）。

## 录制注意事项

以下每一条都来自一次真实的失败，固化在这里避免重蹈。

### 节奏与循环

1. **手势镜头一律做成循环**：动作 → 停 300ms → 反向动作 → 停 300ms。首尾几何相同，
   `<video loop>` 才不会跳。结束时把指针停回起始位置——末帧悬停状态不同，循环同样合不拢。
2. **「复原」必须回到同一状态，而不是清空状态**。例：拖角标放大后要拖回原宽，
   不能用双击（双击清除 `ag:width`，那是另一个状态）。对齐箭头会同时写入宽度，
   这类镜头允许首尾帧不完全一致，但要在场景注释里写明原因。
3. **每条循环产出后跑 `loopCloses()`**：抽首末帧比对，不一致的要在场景里说明为什么可接受。

### 取景与编码

4. 整窗动效固定 1200×800，**左右各裁 15 物理像素**再缩放（窗口区域边缘带进过不属于页面的像素）。
5. 界面类静帧**裁到元素本身**再放大到 1500 宽；一个 700px 的面板塞进整窗画面是不可读的。
6. 悬停定位（`centerOf`）**只在元素真的出画面时才滚动**。每次都 `scrollIntoView`
   会在拍摄中途把笔记挪走。
7. 拖拽会触发编辑器自动滚动：**动作镜头不要用固定裁剪框**，按整窗交付。

### 界面状态

8. 隐藏界面元素的样式元素**每次运行都重写内容**。它在页面里跨运行存活，
   「不存在才创建」会让新规则永远不生效。
9. 模态一律走「取消」按钮正常关闭。**直接 `remove()` 节点会跳过 Obsidian 的清理**，
   遮罩残留、插件内部状态悬空（PDF 对话框之后打不开），需要 `reloadPlugin()` 才能恢复。
10. 手势会写回笔记（`ag:crop`、`ag:width`、`ag:side`、`ag:group`）：**开拍前快照源文件，
    `finally` 里回写**，失败的运行不能把脏状态留给下一条。
11. 设置页是**独立顶层窗口**：单独的 CDP target（`about:blank`）+ 按 HWND 的窗口级截图。
    它不报告屏幕坐标，`gdigrab` 定不了位；录制它的视频用窗口级 record（代价：画面无指针）。

### 输入细节

12. `.embed-actions` 的按钮在溢出层里，**`elementFromPoint` 判不中**，即使可见。
    按元素矩形直接点击，并带重试。
13. 裁剪手柄贴在取景框边角：**抓取点向内缩 6 CSS px，按下前停 90ms**，
    否则手势被当成点击边框。
14. 对齐箭头**离手即收**，每次点击前要重新悬停；当前对齐状态由「存在哪两个箭头」反推，
    不要假定起始侧。
15. 中文输入不能走 `send-keys`（无 IME）：用 `insertText`；搜索框跨运行保留旧值，
    **先清空再输入**。
16. `ui scroll --wheel` 在本版本返回码 1，滚动用页面内 rAF 缓动代替。

### 进程

17. Obsidian 必须由**后台常驻任务**托管，否则随发起调用一起被回收；
    会话中断后要用 `taskkill //IM Obsidian.exe //F` 清干净再由 `ensure-obsidian.sh` 拉起。

### 取景与循环（第二轮补）

18. **模态框是主体时，画幅先满足它。** 曾为了避开下一节标题把画幅压到 615px，结果切掉了
    裁剪对话框的按钮行——读者要看的是控件，标题被对话框挡住根本看不见。先保证主体完整，
    再谈排除相邻内容。
19. **裁切框从 DOM 量，不要写死。** 编辑器的滚动位置在每次运行之间会变（笔记重开后 offset
    差过 80px），写死的 y 会在某一次把表格截进画面。取 `rows` / `elements` 的包围盒再算裁切。
20. **循环比对用平均差异，不是逐字节。** 首帧是 I 帧、末帧是 P 帧，x264 的噪声本来就不同；
    照片内容的逐字节比较必然失败。`loopCloses` 现在返回 `{ exact, mean, pass }`，阈值 1%，
    真实的版面跳动在 8–20%。
21. **`restore()` 必须同时写编辑器缓冲区。** 只写文件时，打开的笔记会把内存里的脏内容再存
    回去——探测脚本因此把 `ag:group` 留在了笔记里，之后所有「干净笔记」的假设全部失效。
22. **原生 tooltip 隐藏不掉。** 它由 `title` 属性触发、由系统绘制，页面 CSS 管不着。录制前
    `removeAttribute("title")`，且**每次布局重建后要重新清**（手柄是重建出来的）。
23. **录制器启动有延迟。** 用 `mark()` 的时间裁片头会切掉开场；设置窗口的录制延迟接近 1 秒。
    从固定的小偏移（0.25s）起裁，或直接整段交付。
24. **行底横条会触发重排。** 第一行加高会让打包器把下一张图拉进来（实测 3 格变 4 格），
    回拖时行高与指针不再一一对应，循环合不拢。演示高度变化用**最后一行**：它没有可拉进来的图。
25. **APNG 的体积只由帧数决定。** 照片内容约 100–140 KB/帧，调色板和压缩级别只能动 10–20%。
    1000×600、318 帧实测 45 MB；降到 800×480/12fps 仍 13.6 MB。要小就只能减帧或减画布，
    减帧的代价是滚动变卡，所以海报一律「一屏 + 10fps + 尾部停 1s」。

## 中止与残留

采集脚本是运行在渲染进程里的 async 函数。**CDP 超时只结束调用方，页内函数还在跑**——
它会继续开笔记、滚动预热，看起来像 Obsidian 卡住。症状：`body` 带 `ag-recording`、
侧栏折叠、文件隔几秒换一篇、`scrollTop` 一直在变。

```powershell
# 一次看清 node / bash 的父子关系
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'shoot|cdp-eval' } |
  ForEach-Object { "" + $_.Name + " pid=" + $_.ProcessId + " ppid=" + $_.ParentProcessId + " :: " + $_.CommandLine }
```

从**最外层**用 `taskkill //PID <ppid> //T //F` 连子树终止。四道保护已内置：
页内硬超时（`shoot.js` 75s）、run token（`__AG_RUN__`）、CDP 兜底（`terminateExecution`）、
批量单张超时（100s）。界面若停在录制态，`bash tools/capture/run.sh tools/capture/restore-ui.js`。

### 三个环境坑

1. **代理会拦 127.0.0.1。** `HTTP_PROXY` 生效时连 CDP 报 `ECONNREFUSED`，像 Obsidian 没运行。
   `cdp-eval.mjs` 已改 `node:http` 直连。
2. **进程随发起它的调用一起结束。** 跨调用交互必须用后台常驻任务托管应用。
3. **`Obsidian.com` 失败时退出码仍是 0。** 统一走 `tools/capture/cli.sh`，它把那句报错判成失败。

## 取景参数

| 项 | 值 |
| --- | --- |
| 内容区 | 1200×800（dpr 1.25 → 采集 1500×1000） |
| 主题 | 深色 / 浅色各一遍，同一套参数 |
| 静帧 | 1500 宽 WebP q85，≤1.2 MB，超限降 q70 重编 |
| 动效 | 1200×800 / 30fps / CRF 23 / ≤6 MB / 无音轨 / faststart |
| 静帧高度 | ≤360 补背景；360–1700 精确裁；>1700 多屏拼接 |

## 主题切换

`app.vault.setConfig("theme", "obsidian" | "moonstone")` 原地改配色，不重载页面，所以一轮里可以连续拍两格。
判定是否生效看 `<body>` 上的 `theme-dark` / `theme-light`：类先翻、工作区后重绘，`theme.js` 在类变化后再等 280ms。
静帧上下的呼吸位取页面背景色（`getComputedStyle(document.body).backgroundColor`），
**浅色格不能用深色常量**——`AG-S07-01` 曾把 `0x1e1e1e` 写死在合成命令里。

语言与主题互不影响：语言在 `localStorage` 里，切换要重载；主题在 `appearance.json` 里，切换不重载。
先切语言、再切主题，重载不会把主题打回去。

## 临时态

`node tools/capture/preset.mjs <name>`，录完立刻 `preset.mjs baseline`：

| 预设 | 用途 |
| --- | --- |
| `en` / `zh` | 界面语言 |
| `pdf-split` | 标题分页演示 |
| `orphan-0` / `orphan-1200` | 孤儿规则开/放宽 |
