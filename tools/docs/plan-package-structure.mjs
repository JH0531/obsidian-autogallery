#!/usr/bin/env node
// Emit the PlanWeave package draft for the bilingual structure work.
//
//   node tools/docs/plan-package-structure.mjs [--out .planweave-draft/i18n-structure-v1]
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = option("--out") ?? join(ROOT, ".planweave-draft", "i18n-structure-v1");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const CONTEXT = `工作目录：F:/Originality Space/Codes/obsidian_autogallery（插件仓 + 两个演示库）与 F:/Originality Space/Codes/obsidian_autogallery_docs（文档站）。

先读：
- AGENTS.md 的 demo 段落与 Build 命令。
- scripts/check-demo.mjs：现在同时校验 demo/ 与 demo-en/。
- 文档站 README 与 docs/.vitepress/config.mts：中文在 docs/zh/（/zh/），英文在 docs/en/（/en/）。

铁律：
1. 中文库 demo/ 是事实源；demo-en/ 只做翻译，不新增或删减示例。
2. 英文库不得残留中文正文；数字、ag: 参数、图片路径必须与中文源逐篇一致。
3. 两个演示库的插件副本都必须与根 main.js 同哈希；BUILD.json 必须同版本。
4. 文档站两侧页面集合、二级标题数量、图序必须一致；docs:check 必须为 0。
5. 不改 src/、plugin.js、main.js。
`;

const TASKS = [
  {
    id: "T-101",
    title: "英文演示库 demo-en",
    goal: "在 demo/ 的平行位置建立完整英文演示库，内容与中文库逐篇对应。",
    acceptance: [
      "demo-en/ 含 23 篇英文笔记与 README，assets、.obsidian、插件副本、BUILD.json 齐全。",
      "每篇的数字与 ag: 参数多重集与中文源完全一致；无残留中文正文。",
      "所有 wikilink 指向 demo-en 内存在的英文文件名；所有图片路径存在。",
      "npm run check:demo 同时报告 demo 与 demo-en 两个库通过。"
    ],
    blocks: [
      impl("B-001", "骨架与配置副本", "复制 demo/ 的 assets、.obsidian、插件副本、BUILD.json 到 demo-en/；清空中文笔记，保留目录结构。", []),
      impl("B-002", "翻译与机械校验", "按文件名映射翻译 23 篇；保留 frontmatter、数字、ag: 参数、图片路径；用脚本比对数字与 ag: 多重集、链接可解析、CJK 为零。", ["B-001"]),
      review("R-001", "审查英文库一致性", ["B-001", "B-002"], "每篇与中文源结构一致；无中文残留；check:demo 通过；未改 assets 内容。")
    ]
  },
  {
    id: "T-102",
    title: "英文分支与双 zip 发布",
    goal: "让英文演示库可以单独下载，并让 release 同时产出中英两个固定包。",
    acceptance: [
      ".github/workflows/demo-en-branch.yml 把 demo-en/ 镜像到孤儿分支 demo-en-vault。",
      "demo-release.yml 同时打包 autogallery-demo-*.zip 与 autogallery-demo-en-*.zip。",
      "两个工作流都先跑 npm run check:demo，且 permissions 只需 contents: write。"
    ],
    blocks: [
      impl("B-001", "英文分支 Action", "新建 demo-en-branch.yml，paths 覆盖 demo-en/**、check-demo.mjs 与本工作流；concurrency 独立。", []),
      impl("B-002", "release 双包", "改 demo-release.yml：先校验两库，再分别 zip，最后把两个资产一起挂到 Release。", ["B-001"]),
      review("R-001", "审查工作流", ["B-001", "B-002"], "分支名、路径过滤、concurrency 与资产命名正确；不会把中文包覆盖成英文包。")
    ]
  },
  {
    id: "T-103",
    title: "文档站 zh/en 平行",
    goal: "中文文档收束到 docs/zh/，与 docs/en/ 平行；根路径只保留语言选择页。",
    acceptance: [
      "docs/zh 与 docs/en 各 26 页，文件路径一一对应。",
      "config.mts 使用 /zh/ 与 /en/ 两个 locale，sidebar 与 nav 链接全部带前缀。",
      "中文页内部链接全部改为 /zh/...；/media 与静态资源不变。",
      "根 docs/index.md 只做语言选择；/zh/ 与 /en/ 均可构建。",
      "npm run docs:check 与 npm run docs:build 均为 0。"
    ],
    blocks: [
      impl("B-001", "迁移与链接前缀", "git mv 中文页到 docs/zh/；用幂等脚本把根绝对链接改为 /zh/...，保留 /media 与静态资源。", []),
      impl("B-002", "locale 配置与根页", "重写 config.mts：/zh/ 与 /en/ 两个 locale，nav/sidebar 全前缀；根 index.md 改为语言选择页。", ["B-001"]),
      impl("B-003", "结构校验脚本", "补 scripts/check-i18n.mjs、check-media.mjs、sync-media.mjs；更新 README 与 package.json，移除不存在的 i18n:stamp。", ["B-002"]),
      review("R-001", "审查站点结构", ["B-001", "B-002", "B-003"], "docs:check 0；docs:build 通过；/zh/ 与 /en/ 页面数相同；无死链。")
    ]
  },
  {
    id: "T-104",
    title: "收口验证",
    goal: "两仓四条命令全绿，并记录新增结构与下载入口。",
    acceptance: [
      "npm run check:demo 通过（两库）。",
      "npm run check:docs 0/8。",
      "文档站 npm run docs:check 与 docs:build 通过。",
      "git status 显示 src/、plugin.js、main.js 未改动。",
      "audit/REPORT.md 增补本次结构变更与下载入口。"
    ],
    blocks: [
      impl("B-001", "全量验证与报告", "依次运行四条命令，把输出与新增路径写入 audit/REPORT.md。", []),
      review("R-001", "终审", ["B-001"], "验收逐条有命令输出；两个演示库各 23 篇；文档站 26 页 × 2 语言。")
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
    title: "AutoGallery 双语结构与下载入口",
    description: "建立 demo-en 英文演示库、镜像分支与双 zip 发布，并把文档站中文收束到 /zh/ 与 /en/ 平行。"
  },
  execution: {
    defaultExecutor: "manual",
    parallel: { enabled: false, maxConcurrent: 1 }
  },
  review: { maxFeedbackCycles: 1, completionPolicy: "strict" },
  nodes,
  edges: [
    { from: "T-102", to: "T-101", type: "depends_on" },
    { from: "T-104", to: "T-102", type: "depends_on" },
    { from: "T-104", to: "T-103", type: "depends_on" }
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
