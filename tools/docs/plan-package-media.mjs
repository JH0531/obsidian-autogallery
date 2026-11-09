#!/usr/bin/env node
// Emit the PlanWeave package for the four-cell media + full showcase build.
//
//   node tools/docs/plan-package-media.mjs [--out .planweave-draft/media-matrix-v1]
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = option("--out") ?? join(ROOT, ".planweave-draft", "media-matrix-v1");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const CONTEXT = `项目：F:/Originality Space/Codes/obsidian_autogallery（插件 + demo/ + demo-en/）与 F:/Originality Space/Codes/obsidian_autogallery_docs（文档站）。

采集前提（已确认）：
- 演示库就在仓内：demo/（中文）、demo-en/（英文）；不再使用外部 vault。
- demo/.obsidian/plugins/obsidian-autogallery/main.js 与根 main.js 是硬链接，demo-en 同。
- tools/capture/vault.local.json 已指向 demo/。
- 启动 Obsidian 必须与采集脚本在同一次调用内完成（进程会被回收）：
  AG_OPEN_VAULT="F:\\Originality Space\\Codes\\obsidian_autogallery\\demo" bash tools/capture/ensure-obsidian.sh
- 产物规格：静帧 1500 宽 WebP q85 ≤1.2MB；动效 1200×800 H.264 CRF23 ≤6MB；poster WebP ≤250KB。
- 路径唯一规则：media/<lang>/<theme>/<kind>/<id>.<ext>，由 lib/media.mjs 生成。

铁律：
1. 不改 src/、plugin.js、main.js，除非任务明确要求并附复现。
2. 每个镜头必须先在渲染器里断言，再写文件；断言失败不写。
3. 一个编号在四个格子里是同一个字符串，语言与主题只由目录承载。
4. 文档站中文 docs/zh、英文 docs/en，必须逐页平行；docs:check 必须为 0。
5. 内部库首次打开要「信任作者并启用第三方插件」；safeMode=false 与 community-plugins.json 已写入，但拍摄前仍要用 CDP 校验 app.plugins.plugins["obsidian-autogallery"] 存在。
6. 发现代码 bug 时，在对应任务下动态新增 fix 块并修复，不要另起平行计划或绕过断言。
`;

const TASKS = [
  {
    id: "T-199",
    title: "内部库启动与插件加载",
    goal: "确认 demo/ 与 demo-en/ 打开后 AutoGallery 真的被加载，而不是停在「信任作者」提示。",
    acceptance: [
      "两个库的 .obsidian/app.json 均为 safeMode=false，community-plugins.json 含 obsidian-autogallery。",
      "CDP 检查 app.plugins.plugins[\"obsidian-autogallery\"] 存在，命令已注册。",
      "若出现信任提示，脚本能识别并明确失败，而不是继续拍到空白页。"
    ],
    blocks: [
      impl("B-001", "加载校验", "启动内部库后用 CDP 检查插件实例、命令与设置；缺信任时输出明确错误。", []),
      review("R-001", "审查加载门禁", ["B-001"], "两个库都通过；检查不依赖人工点击；失败信息能直接指向信任提示。")
    ]
  },
  {
    id: "T-200",
    title: "核验画廊行压缩",
    goal: "确认 PDF 分页的「整行同比例缩小」是否真的生效；不生效就修代码或改文档，再继续出图。",
    acceptance: [
      "用 demo/fixtures/pdf-pagination-row.md 复现：关闭优化整行下移、开启优化整行缩小留在页内。",
      "若无法复现，定位到 collectImageUnits / attemptExactFit 的具体分支并记录证据。",
      "结论落到 audit/findings.md：代码修复，或把文档改成实际行为。"
    ],
    blocks: [
      impl("B-001", "复现与定位", "用内部 demo 跑 pdf-row-scan 的细分填充；在 PDF 打印树里检查 .ag-pdf-row 是否被识别为 gallery 单元、plan.images 是否非空。", []),
      impl("B-002", "修复或改文档", "若行压缩分支不可达，修 src/pdf-pagination.js；若设计上不支持，改 docs/zh、docs/en、README 与 demo/18 的相应表述。", ["B-001"]),
      review("R-001", "审查结论", ["B-001", "B-002"], "有可复现的 off/on 对照或明确的代码证据；文档与代码一致；check:docs 为 0。")
    ]
  },
  {
    id: "T-201",
    title: "功能覆盖矩阵",
    goal: "把插件当前所有功能、设置、命令、参数映射到文档页与素材编号，找出文档尚未覆盖的功能。",
    acceptance: [
      "生成 audit/coverage.md：功能 → 文档页 → 图 id → 四格状态。",
      "设置 40 项、命令 4 条、ag 参数 10 个、核心行为全部有落点。",
      "没有文档页的功能单列为缺口，给出补写或补图建议。"
    ],
    blocks: [
      impl("B-001", "生成功能清单", "从 audit/facts.json、settings-tab、commands、annotations 生成功能清单，按模块分组。", []),
      impl("B-002", "对照文档与素材", "把功能清单映射到 docs/zh 26 页与 figures.json 47 条；标出无文档、无图、只有中文的项。", ["B-001"]),
      review("R-001", "审查覆盖矩阵", ["B-001", "B-002"], "每个设置/命令/参数都有落点；缺口有证据；矩阵可作为后续拍摄的输入。")
    ]
  },
  {
    id: "T-202",
    title: "四格盘点与补拍计划",
    goal: "把 47 条素材 × 4 格（zh/en × dark/light）的现状与拍摄方式列清楚。",
    acceptance: [
      "生成 audit/matrix.md：每条素材的 4 格状态（已产出/待拍/暂缓）。",
      "每个待拍项标注机制：CDP 静帧、winapp 动效、PDF 渲染。",
      "英文内容帧必须有 noteEn 或英文笔记，否则不得排入英文格。"
    ],
    blocks: [
      impl("B-001", "生成四格现状", "从 figures.json 与 media/manifest.json 生成矩阵，统计每格缺口。", []),
      impl("B-002", "排定拍摄方式", "按 kind 与 media 给每个缺口指定入口脚本；英文内容帧检查 noteEn。", ["B-001"]),
      review("R-001", "审查计划", ["B-001", "B-002"], "矩阵数字与 manifest-check 一致；每个缺口有可执行入口；没有把中文画面排进英文格。")
    ]
  },
  {
    id: "T-203",
    title: "静帧四格拍摄",
    goal: "补齐所有 still 素材的 zh/en × dark/light 四格。",
    acceptance: [
      "zh/dark、zh/light、en/dark、en/light 四格分别跑 shoot-batch + finish-stills。",
      "每张 1500 宽 WebP ≤1.2MB；内容帧使用对应语言笔记。",
      "manifest 中四格状态与文件一致。"
    ],
    blocks: [
      impl("B-001", "zh/dark", "补齐中文深色静帧；先跑 audit 确认缺口，再按 note 分组拍摄。", []),
      impl("B-002", "zh/light", "切浅色主题，重拍同一批镜头；主题由 CDP 切换，不要后期调色。", ["B-001"]),
      impl("B-003", "en/dark", "用 demo-en 的英文笔记与英文界面重拍；缺 noteEn 的项先补映射。", ["B-001"]),
      impl("B-004", "en/light", "英文浅色；确认界面文案与主题同时正确。", ["B-003"]),
      review("R-001", "审查四格静帧", ["B-001", "B-002", "B-003", "B-004"], "四格齐全；尺寸/字节/格式合规；没有中文画面落在 en；manifest-check 通过。")
    ]
  },
  {
    id: "T-204",
    title: "动效四格拍摄",
    goal: "补齐所有 motion 素材的 zh/en × dark/light 四格。",
    acceptance: [
      "每个动效 1200×800、H.264 CRF23、≤6MB、无音轨、faststart。",
      "手势类走 winapp 注入，界面类走场景脚本；每段先断言再写盘。",
      "poster 与视频同源，≤250KB。"
    ],
    blocks: [
      impl("B-001", "zh/dark", "补齐中文深色动效；按场景文件逐个录制。", []),
      impl("B-002", "zh/light", "中文浅色重录。", ["B-001"]),
      impl("B-003", "en/dark", "英文深色重录，界面文案切英文。", ["B-001"]),
      impl("B-004", "en/light", "英文浅色重录。", ["B-003"]),
      review("R-001", "审查四格动效", ["B-001", "B-002", "B-003", "B-004"], "四格齐全；编码参数与体积合规；poster 存在；没有中文界面落在 en。")
    ]
  },
  {
    id: "T-205",
    title: "处理与入库",
    goal: "统一编码、裁剪、命名与 manifest，确保素材可被站点直接消费。",
    acceptance: [
      "所有 WebP/MP4 符合规格；文件名不带语言/主题后缀。",
      "build-manifest 重建 47×4 条目；manifest-check 0 错误。",
      "audit.md 的矩阵与暂缓表更新。"
    ],
    blocks: [
      impl("B-001", "编码与命名", "对四格产物统一编码；剔除超限帧；检查路径只由 lib/media.mjs 生成。", []),
      impl("B-002", "manifest 与审计", "重建 manifest，跑 audit，更新暂缓项。", ["B-001"]),
      review("R-001", "审查入库", ["B-001", "B-002"], "manifest 与文件一致；没有孤儿文件；audit 可复跑。")
    ]
  },
  {
    id: "T-206",
    title: "展示与本地构建",
    goal: "让文档覆盖所有功能，页面引用四格素材，本地构建通过但不上线。",
    acceptance: [
      "docs/zh 与 docs/en 每个功能页都有对应图示或明确的 textOnly 理由。",
      "页面按语言引用 /media 变体；不再出现中文图挂在英文页。",
      "docs:sync、docs:check、docs:build 全部通过；不做部署。"
    ],
    blocks: [
      impl("B-001", "页面引用与图注", "按 T-201 的矩阵给页面补图与图注；中英同步。", []),
      impl("B-002", "同步与构建", "AG_VAULT=demo npm run docs:sync；docs:check；docs:build。", ["B-001"]),
      review("R-001", "审查展示", ["B-001", "B-002"], "每页有图或 textOnly 理由；docs:check 0；构建通过；没有部署动作。")
    ]
  },
  {
    id: "T-207",
    title: "收口验证",
    goal: "四条门禁全绿，交付报告记录四格覆盖与剩余暂缓。",
    acceptance: [
      "check:demo、check:docs、docs:check、docs:build 全部通过。",
      "47 条素材 × 4 格的状态在 audit/matrix.md 可查。",
      "src/ 未改动；未上线。"
    ],
    blocks: [
      impl("B-001", "全量验证", "依次跑四条命令，把输出与剩余暂缓写入 audit/REPORT.md。", []),
      review("R-001", "终审", ["B-001"], "验收逐条有输出；剩余项有理由；没有线上部署。")
    ]
  }
];

function impl(id, title, body, depends_on) {
  return { id, type: "implementation", title, body, depends_on };
}

function review(id, title, depends_on, passCriteria) {
  return { id, type: "review", title, depends_on, passCriteria };
}

const nodes = TASKS.map((task) => ({
  id: task.id,
  type: "task",
  title: task.title,
  prompt: `nodes/${task.id}/prompt.md`,
  acceptance: task.acceptance,
  blocks: task.blocks.map((block) => {
    const base = {
      id: block.id,
      type: block.type,
      title: block.title,
      prompt: `nodes/${task.id}/blocks/${block.id}.prompt.md`,
      depends_on: block.depends_on ?? []
    };
    if (block.type === "review") {
      base.review = {
        required: true,
        maxFeedbackCycles: 1,
        triggerCondition: "after_required_work_completed",
        passCriteria: block.passCriteria,
        hook: null
      };
    }
    return base;
  })
}));

const manifest = {
  version: "plan-package/v1",
  project: {
    title: "AutoGallery 四格素材与全量展示",
    description: "核验分页行压缩，盘点并补齐 zh/en × dark/light 四格素材，最后本地构建文档站且不上线。"
  },
  execution: {
    defaultExecutor: "manual",
    parallel: { enabled: false, maxConcurrent: 1 }
  },
  review: { maxFeedbackCycles: 1, completionPolicy: "strict" },
  nodes,
  edges: [
    { from: "T-200", to: "T-199", type: "depends_on" },
    { from: "T-201", to: "T-200", type: "depends_on" },
    { from: "T-202", to: "T-201", type: "depends_on" },
    { from: "T-203", to: "T-202", type: "depends_on" },
    { from: "T-204", to: "T-203", type: "depends_on" },
    { from: "T-205", to: "T-204", type: "depends_on" },
    { from: "T-206", to: "T-205", type: "depends_on" },
    { from: "T-207", to: "T-206", type: "depends_on" }
  ]
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "nodes"), { recursive: true });
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

for (const task of TASKS) {
  mkdirSync(join(OUT, "nodes", task.id, "blocks"), { recursive: true });
  writeFileSync(join(OUT, "nodes", task.id, "prompt.md"), [
    `# ${task.id} ${task.title}`,
    "",
    `目标：${task.goal}`,
    "",
    "## 验收",
    ...task.acceptance.map((item) => `- ${item}`),
    "",
    "## 上下文",
    CONTEXT
  ].join("\n"), "utf8");

  for (const block of task.blocks) {
    writeFileSync(
      join(OUT, "nodes", task.id, "blocks", `${block.id}.prompt.md`),
      [
        `# ${task.id}#${block.id} ${block.title}`,
        "",
        block.body,
        "",
        "## 完成条件",
        block.type === "review"
          ? `通过标准：${block.passCriteria}`
          : "改动落盘；相关命令退出码符合预期；在报告里列出改动文件与验证命令输出。",
        "",
        "## 上下文",
        CONTEXT
      ].join("\n"),
      "utf8"
    );
  }
}

console.log(JSON.stringify({ draft: OUT, tasks: TASKS.length, blocks: TASKS.reduce((total, task) => total + task.blocks.length, 0) }, null, 2));
