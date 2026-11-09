# winapp 摄取层

用 Windows 原生输入注入驱动 Obsidian，替代原先「只能人工录制」的镜头。
所有结论都是在 1.14.5 + winapp 0.7.1 + PowerToys 0.102 上实测的，不是照文档抄的。

## 一句话结论

**输入用 winapp，定位用 AutoHotkey，录屏用 ffmpeg gdigrab。**

三条都是被实测逼出来的，不是偏好：

| 需求 | 结论 | 证据 |
| --- | --- | --- |
| 点坐标 | winapp `ui drag x,y x,y`（0.7.1 的 `click` 只收 UIA 选择器） | `probe-report.json` P0-03b 10/10 |
| 悬停 | AutoHotkey `MouseMove`（winapp `hover` 只收 UIA 选择器；Chromium 只暴露 4 个节点） | P0-04 `:hover=true` |
| 录屏 | ffmpeg gdigrab `-draw_mouse 1`（winapp `record --capture-screen` 不含光标） | P0-07a 光标白像素 0 / P0-07b 113 |
| 点击强调 | PowerToys MouseHighlighter，`winapp send-keys "win+shift+h" --allow-system-keys` 开关 | 两条通道都能抓到红色圆环 |

## 环境陷阱（每条都真的踩过）

1. **注入命令不带 `-w` 会静默失败。** 没有目标窗口时 `drag` / `send-keys` 打印成功、退出码 0，屏幕上一动不动。所有注入调用必须带 `-w <HWND>`。
2. **AutoHotkey v2 的 Mouse 默认用客户区坐标。** 不写 `CoordMode "Mouse","Screen"`，移到物理 (1293,628) 实际落在相对于窗口原点的位置，悬停全部落空，而且看起来「像坐标算错了」。
3. **winapp record 的 screen DC 不含光标。** 它含 PowerToys 的叠加层，唯独不含硬件光标——所以录出来的指针强调只剩一个圆圈。
4. **必须先置前。** 目标不在前台时注入无效果；`ui drag` 不会报 `foreground_not_target` 就默默成功。
5. **进程随发起它的调用结束被回收。** Obsidian 由 `.tools/ensure-obsidian.sh` 在常驻后台任务里拉起，不要在前台调用里启动。
6. **libx264 要求偶数尺寸。** 窗口是 1530×1019，gdigrab 必须抓 1530×1018。

## 坐标

三套坐标，别混：

- `css`：`getBoundingClientRect()` 的视口坐标，页面内一律用它。
- `image`：winapp 截图里的像素（截图 0,0 = 窗口 0,0）。
- `screen`：物理屏幕像素，winapp 的 `--at`/`drag` 端点用这个。

`calibrate.mjs` 注入 4 个色块 → 截图 → 求质心 → 最小二乘拟合 `css → image`，再加窗口原点得到 `screen`。
本机实测 `scale = 1.2504 / 1.25`，残差 `0px`，屏幕原点 `542.48,227.5`（窗口 534,228，DPR 1.25）。

窗口移动、缩放变化、连点失败两次都会触发重标定；跨屏直接拒绝。

## 命令

```bash
node .tools/winapp/calibrate.mjs            # 标定，写 .cache/winapp/state/calib.json
node .tools/winapp/probe.mjs                # 能力矩阵，写 .cache/winapp/probe-report.json
```

退出码：`0` 全绿 / `2` 有门禁项失败 / `1` 标定失败。

## 文件

| 文件 | 职责 |
| --- | --- |
| `env.mjs` | 路径、端口、AHK 路径、workflow id |
| `window.mjs` | 解析并缓存 HWND 与窗口物理矩形（60s TTL） |
| `cdp.mjs` | 渲染进程求值（`node:http` 直连，绕开 HTTP_PROXY） |
| `rect.mjs` | 标定读写、`cssToScreen`、`rectOf`、`hitTestAt` |
| `ui.mjs` | `hoverCss` / `clickCss` / `doubleClickCss` / `dragCss` / `sendKeys` / `screenshot` |
| `record.mjs` | gdigrab 与 winapp record 两条通道、单帧抓取、帧分析 |
| `calibrate.mjs` | 色块标定 |
| `probe.mjs` | Phase 0 矩阵 |
| `pointer.ahk` | 指针移动、修饰键按住/松开 |

## 已知做不到的事

- **拖拽中按住 Shift/Alt**：winapp 的 `drag` 没有修饰键参数。用 `pointer.ahk down Shift` → `drag` → `up Shift` 补，`finally` 里必须 `allup`，否则修饰键会卡住。
- **系统级保存/打开对话框**：Electron 没有可用的 UIA 名称，只能截图、不能可靠点击。PDF 镜头里永不点「导出」。
- **跨显示器或被遮挡的窗口**：screen DC 直接抓到别人的窗口，靠 `probe` 的尺寸与角落校验拦住。

## 场景层（lib/scene.mjs 与 scenes/）的实测行为

`lib/scene.mjs` 是所有场景共享的骨架（开窗、取景、标定、编码、回收），`scenes/<ID>.mjs`
只写动作与断言。这些是场景层量出来的，不是注入层的问题，但一样会咬人：

- **设置是独立顶层窗口。** `app.setting.open()` 之后出现第二个 CDP target（`about:blank`），
  主窗口的 `eval` 看不到它。按 URL 选主窗口（`app://obsidian.md`），设置窗口按标题
  （`设置` / `Settings`）找 target 和 HWND。它不报告屏幕坐标，`gdigrab` 定不了位——
  录它的视频走 `startWinappRecord`（窗口级，无指针），截图走 `ui screenshot -w`。
- **强制移除模态会破坏插件状态。** `remove()` 跳过 Obsidian 的清理，PDF 对话框的会话
  对象悬空，下一次 `executeCommandById` 静默不打开；`reloadPlugin()` 可恢复。
  正常路径永远是点「取消」。
- **别的进程的置顶窗口会盖在画面上。** 屏幕通道（gdigrab）抓的是屏幕；窗口级通道
  （`ui screenshot -w`）只返回目标窗口，UI 静帧一律走后者。
- **面板类 UI 是异步长高的。** 命令面板、裁剪预览都要等「元素就位」再取景
  （结果行数 ≥ N、`img.naturalWidth > 0`），否则裁到半成品。
- **CJK 文本输入。** `send-keys` 走键击，没有 IME 输不进中文；用 `insertText`，
  并先把旧值清掉——设置实例跨运行保留上次的搜索词。
