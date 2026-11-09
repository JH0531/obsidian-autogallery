#!/usr/bin/env node
// Emit the PlanWeave package draft for the showcase audit.
//
// The draft is generated, not hand-written, so re-running after an audit change
// cannot leave a stale task behind. It writes only a package-shaped directory;
// `planweave package import` is what touches the active workspace.
//
//   node tools/docs/plan-package.mjs [--out .planweave-draft/showcase-audit-v1]
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = option("--out") ?? join(ROOT, ".planweave-draft", "showcase-audit-v1");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const CONTEXT = `工作目录：F:/Originality Space/Codes/obsidian_autogallery（插件仓）与 F:/Originality Space/Codes/obsidian_autogallery_docs（文档站）。

先读这三份，不要凭记忆改文案：
- audit/facts.json — 从源码生成的设置、参数、命令、素材事实。
- audit/claims.json — 每条断言的来源行、现状、期望与代码证据。
- audit/findings.md — 已分级的结论，含「误报与已验证正确」一节。

铁律：
1. 代码 > 实验 > 规格 > 文档。改之前先在 claims.json 找到对应记录与 evidence。
2. 不改 src/、plugin.js、main.js；本轮只改展示与工具。
3. 不写近似数（「约一半」「差不多」）；所有数字必须能在 facts.json 找到 key。
4. 任何 never/always/only 必须有代码分支或实验记录，否则改成条件句。
5. 中英文必须逐节对应；改完跑 npm run check:docs，不能让新的 finding 出现。
`;

const TASKS = [
  {
    id: "T-001",
    title: "事实基线与校验工具",
    goal: "把「展示是否与代码一致」变成可执行检查：facts.json、claims.json、check.mjs 三件套可复跑。",
    acceptance: [
      "node tools/docs/facts.mjs 生成 audit/facts.json，40 个设置项每条有 labels/default/range/source。",
      "node tools/docs/claims.mjs 生成 audit/claims.json，覆盖 README、demo、specifications、docs 中英与 figures.json。",
      "node tools/docs/check.mjs 在已知错误上退出码 1，并写出 audit/check-report.md。",
      "package.json 存在 check:docs 脚本，串联三者。"
    ],
    blocks: [
      impl("B-001", "事实抽取器", "实现 tools/docs/facts.mjs：用 esbuild 打包 src/defaults.js 并执行，用 -1e9/+1e9 哨兵反推数值范围；校验设置标签仍在 settings-tab.js 与 en-settings.js 中存在。", []),
      impl("B-002", "断言抽取器", "实现 tools/docs/claims.mjs：逐行扫描 86 个展示面 + 45 条 figures desc，抽取数值、绝对化、ag: 参数、图 id、媒体引用；对设置表数值、未知参数、未知图 id、缺失媒体、禁用短语自动裁定。", ["B-001"]),
      impl("B-003", "门禁脚本", "实现 tools/docs/check.mjs：八项检查（台账错误、图 id、图文件、figures 页面、中英平行、媒体、零图覆盖、事实新鲜度），输出 audit/check-report.md，失败退出 1。", ["B-002"]),
      review("R-001", "审查工具可复跑性", ["B-001", "B-002", "B-003"], "三项命令均可重复执行且输出稳定；facts 每条有 source；check 的失败项能在 claims 中找到对应记录。")
    ]
  },
  {
    id: "T-002",
    title: "裁定与分级",
    goal: "把 21 条机器判定与其余 P1 候选逐条裁定，记录误报，冻结 findings.md。",
    acceptance: [
      "audit/findings.md 含 P0/P1/误报三节，每条有展示侧与代码侧位置。",
      "claims.json 中所有 wrong 记录都有 expected 与 evidence。",
      "需要实验的条目在 audit/experiments/ 有记录，或明确标 needs-experiment。",
      "已确认的误报（120/205/296、16:9 60% 居中、isolate=false、ag:top）在 findings 中标注「不要改」。"
    ],
    blocks: [
      impl("B-001", "机器裁定复核", "逐条复核 claims.json 的 21 条 wrong、unknown-figure、missing-media；对每条打开源文件确认上下文，排除断章取义。", []),
      impl("B-002", "人工裁定与误报", "复核 P1 候选（1140/1122、306/297、约一半、25/26 页、poster 格式、路由开关、英文链接与参数集、spec 内部矛盾）；把误报写入 findings 的「不要改」一节。", ["B-001"]),
      review("R-001", "审查裁定证据", ["B-001", "B-002"], "每条 P0 都能用两个文件位置复现；没有把「看起来不对」写成结论；误报有验证过程。")
    ]
  },
  {
    id: "T-003",
    title: "修复中文文档站",
    goal: "26 页中文文档的 P0 全部改正，P1 补齐关键规则与边界。",
    acceptance: [
      "docs/export/pagination.md 的行距上限为 10%，画廊行为三段式表述。",
      "docs/annotations/dialog.md 为五项；docs/guide/install.md 与 index.md 不再出现 styles.css。",
      "docs/reference/settings.md 的原生导出拦截描述改为 CSS 级效果。",
      "docs/index.md 与 pitfalls 不再引用不存在的 90% 旧文档。",
      "npm run check:docs 的中文段 finding 归零。"
    ],
    blocks: [
      impl("B-001", "P0 改正", "按 findings 第 1 节逐条修改中文页：分页、对话框、安装、设置页、pitfalls、宽度页。", []),
      impl("B-002", "P1 补全", "补浮动规则与双门槛、补分页执行顺序与「它不做什么」、修 1140→1122 与 306→297、把「约一半」改「约四成」、补零图页的 textOnly 理由。", ["B-001"]),
      review("R-001", "审查中文页", ["B-001", "B-002"], "每个数字能在 audit/facts.json 找到 key；每处修改在 findings 有条目；没有为了「更完整」新增无法证伪的断言。")
    ]
  },
  {
    id: "T-004",
    title: "同步英文文档站",
    goal: "26 页英文与中文逐节对应，修掉英文独立分叉。",
    acceptance: [
      "docs/en/index.md 的 /reference/settings 链接补 /en 前缀（两处）。",
      "docs/en/guide/quick-start.md 与中文页的「三个参数」一致，并补 3 个媒体块。",
      "docs/en/guide/install.md 的「stores nothing outside your vault」改为条件句。",
      "中英 ^## 数量与图序完全一致；check:docs 的 zh-en-parity 通过。"
    ],
    blocks: [
      impl("B-001", "英文同步", "先改中文页，再逐节翻译；英文独立断言（安装 2 文件、链接、参数集、库外声明）按代码事实重写。", []),
      review("R-001", "审查中英平行", ["B-001"], "check:docs 的 zh-en-parity 无失败；英文页没有比中文页多出或少掉一节；媒体引用与中文一致。")
    ]
  },
  {
    id: "T-005",
    title: "修复 README",
    goal: "中英 README 的 PDF 段落与绝对化断言与代码一致。",
    acceptance: [
      "README-ZH.md:16 为五类手柄；:82 写明对齐会记录宽度；:83 改为条件句；:126 区分两条失败路径。",
      "README-ZH.md 与 README.md 的 PDF 小节段数一致、行数差 ≤2。",
      "README 不再出现「只改对齐」「自动回退」两种错误说法。"
    ],
    blocks: [
      impl("B-001", "中文 README", "按 findings 修 P0 第 3/4/5/10 条；补浮动双门槛与浮动空间策略一句；保持三段式 PDF 叙事。", []),
      impl("B-002", "英文 README", "逐段镜像中文修订，保留既有术语（floatMax / mobileBreakpoint / float space）。", ["B-001"]),
      review("R-001", "审查 README", ["B-001", "B-002"], "中英段数一致；每条修订对应 findings 条目；没有引入新的近似数。")
    ]
  },
  {
    id: "T-006",
    title: "修复 demo 展示笔记",
    goal: "23 篇 demo 的数值与绝对化断言正确，17/18 章重写并补复现步骤。",
    acceptance: [
      "demo/06 为五类手柄；demo/13 为五项；demo/18 为三段式。",
      "demo/05 的 1140 改为 1122；demo/07 的 306 改为 297、40% 改为 39%。",
      "demo/19 删除路由「启用开关」；demo/21 删除 90% 旧文档叙事。",
      "demo/17 与 18 补「自己复现」步骤；grep 不再命中四条规则/不参与单图压缩。"
    ],
    blocks: [
      impl("B-001", "P0/P1 逐篇修正", "按 findings 修 23 篇中的数值、绝对化、功能存在性断言；不改叙事结构。", []),
      impl("B-002", "17/18 章重写", "17 章补作用域说明；18 章改为五条规则 + 执行顺序 + 能做到/做不到 + 复现步骤。", ["B-001"]),
      review("R-001", "审查 demo", ["B-001", "B-002"], "每篇的示例数字可由公式或图片比例复算；没有新增与 specs 冲突的规则；标题锚点保持稳定。")
    ]
  },
  {
    id: "T-007",
    title: "修复规格与素材台账",
    goal: "specifications 与代码一致；figures.json 的 desc、页面、noteEn、defer 正确。",
    acceptance: [
      "specifications/pdf-pagination.md:18 与 validation.md:108 改为三段式。",
      "layout-core.md:29 明确「打包器缺省 3，渲染器传设置值 5」。",
      "live-preview.md:705 删除，保留 :780 的图注缝中点描述。",
      "figures.json 的 templates/transfer 改为 templates/import；25 页改 26；poster meta 与实际一致；15 条缺图标 defer。"
    ],
    blocks: [
      impl("B-001", "规格校正", "修 8 份规范中的事实错误与内部矛盾；数值改为指向 audit/facts.json 的 key。", []),
      impl("B-002", "素材台账", "改 figures.json 的 desc/页面/noteEn/defer；重跑 build-manifest 与 audit.mjs。", ["B-001"]),
      review("R-001", "审查规格与台账", ["B-001", "B-002"], "spec 不再与 src 冲突；figures 的 page 全部存在于站点；defer 有理由且 audit 可见。")
    ]
  },
  {
    id: "T-008",
    title: "分页专题素材",
    goal: "产出 AG-S19-01..05 中英各一套，并用机械断言证明差异。",
    acceptance: [
      "tools/capture/pdf-stills.mjs 可复跑：导出→pdftoppm→magick→WebP，断言失败不写文件。",
      "10 个 WebP 均为 1500 宽、≤1.2MB，路径符合 media/<lang>/any/stills/。",
      "每张图的 off/on 差异有页号、图片数或页数差断言，不靠肉眼。",
      "文档站分页页与 README 引用这些图，尺寸与 alt 正确。"
    ],
    blocks: [
      impl("B-001", "采集工具链", "实现 lib/pdf-settings、lib/pdf-pages、lib/pdf-board 与 pdf-stills；夹具入库；设置快照与 finally 还原。", []),
      impl("B-002", "产出 10 张图", "用默认 15% 上限、单变量隔离，跑 zh/en 两轮；每图先过断言再写盘。", ["B-001"]),
      impl("B-003", "接入页面", "docs/export/pagination.md 与 en 版按节插 fig；README 插 AG-S19-01。", ["B-002"]),
      review("R-001", "审查素材与引用", ["B-001", "B-002", "B-003"], "manifest-check 通过；每图断言日志留档；页面引用的尺寸与文件一致。")
    ]
  },
  {
    id: "T-009",
    title: "收口验证",
    goal: "四条命令全绿，交付报告逐条对应验收。",
    acceptance: [
      "npm run check:docs 退出 0。",
      "node tools/capture/manifest-check.mjs 退出 0。",
      "在 obsidian_autogallery_docs 运行 npm run docs:build 通过。",
      "npm run check:demo 通过；git status --short src/ plugin.js main.js 为空。",
      "audit/REPORT.md 列出改动文件、验证输出与剩余 defer 项。"
    ],
    blocks: [
      impl("B-001", "跑全套校验", "依次运行四条命令，把输出与失败修复记录写入 audit/REPORT.md。", []),
      review("R-001", "终审", ["B-001"], "验收清单逐条有命令输出；没有未解释的失败；defer 项有理由与下一轮入口。")
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
    title: "AutoGallery 展示体系审计与修复",
    description: "用代码事实源审计 README、demo、docs 中英与 specifications，修 P0/P1，补分页对照图，最后统一验证。"
  },
  execution: {
    defaultExecutor: "manual",
    parallel: { enabled: false, maxConcurrent: 1 }
  },
  review: { maxFeedbackCycles: 1, completionPolicy: "strict" },
  nodes,
  edges: [
    { from: "T-002", to: "T-001", type: "depends_on" },
    { from: "T-003", to: "T-002", type: "depends_on" },
    { from: "T-004", to: "T-003", type: "depends_on" },
    { from: "T-005", to: "T-002", type: "depends_on" },
    { from: "T-006", to: "T-002", type: "depends_on" },
    { from: "T-007", to: "T-002", type: "depends_on" },
    { from: "T-008", to: "T-004", type: "depends_on" },
    { from: "T-008", to: "T-007", type: "depends_on" },
    { from: "T-009", to: "T-004", type: "depends_on" },
    { from: "T-009", to: "T-005", type: "depends_on" },
    { from: "T-009", to: "T-006", type: "depends_on" },
    { from: "T-009", to: "T-008", type: "depends_on" }
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
