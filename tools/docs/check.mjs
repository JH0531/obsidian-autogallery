#!/usr/bin/env node
// The gate that keeps the showcase honest.
//
//   node tools/docs/check.mjs [--report audit/check-report.md] [--json]
//
// It reads the code-derived facts, the claim ledger, and the live files. A
// failure is a fact, not a style opinion: either a claim contradicts the code,
// a referenced figure has no file, or the two languages stopped being mirrors.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DOCS = resolve(ROOT, "../obsidian_autogallery_docs");
const REPORT = option("--report") ?? join(ROOT, "audit", "check-report.md");
const AS_JSON = process.argv.includes("--json");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const facts = JSON.parse(readFileSync(join(ROOT, "audit", "facts.json"), "utf8"));
const ledger = JSON.parse(readFileSync(join(ROOT, "audit", "claims.json"), "utf8"));
const figures = JSON.parse(readFileSync(join(ROOT, "tools", "capture", "figures.json"), "utf8"));

const results = [];
function check(id, title, run) {
  try {
    const outcome = run();
    results.push({ id, title, status: outcome.failures?.length ? "fail" : "pass", ...outcome });
  } catch (error) {
    results.push({ id, title, status: "fail", failures: [{ message: error.message }], notes: [] });
  }
}

function fail(message, detail = {}) {
  return { message, ...detail };
}

// 1 — the ledger's own verdicts.
check("facts-errors", "断言台账中无被代码证伪的条目", () => {
  const wrong = ledger.claims.filter((claim) => claim.status === "wrong");
  return {
    failures: wrong.map((claim) => fail(`${claim.surface}:${claim.line} — ${claim.expected}`, {
      surface: claim.surface,
      line: claim.line,
      text: claim.text,
      evidence: claim.evidence,
      severity: claim.severity
    })),
    notes: [`共 ${ledger.claims.length} 条断言，${wrong.length} 条判为错误。`]
  };
});

// 2 — every figure id referenced by a page resolves to a declared figure or poster.
check("figure-ids", "页面引用的图 id 均已声明", () => {
  const known = new Set([...facts.figures.ids, ...(facts.figures.posters ?? [])]);
  const failures = [];
  for (const claim of ledger.claims) {
    for (const id of claim.figures ?? []) {
      if (!known.has(id)) failures.push(fail(`${claim.surface}:${claim.line} 引用了未声明的 ${id}`));
    }
  }
  return { failures, notes: [`声明素材 ${facts.figures.total} 条，海报 ${(facts.figures.posters ?? []).length} 条。`] };
});

// 3 — a figure referenced by a page must have a file somewhere we ship.
check("figure-files", "被引用的素材有实际文件", () => {
  const referenced = new Set(ledger.claims.flatMap((claim) => claim.figures ?? []));
  const failures = [];
  for (const id of referenced) {
    if (!figureFile(id)) failures.push(fail(`${id} 被页面引用，但 docs/public 与演示库都没有文件`));
  }
  return { failures, notes: [`被引用 ${referenced.size} 个 id。`] };
});

function figureFile(id) {
  const families = ["stills", "motion", "posters"];
  for (const family of families) {
    const dir = join(DOCS, "docs", "public", "media", family);
    if (existsSync(dir) && readdirSync(dir).some((name) => name.startsWith(`${id}.`))) return true;
  }
  const vault = vaultRoot();
  if (vault) {
    for (const lang of ["zh", "en"]) {
      for (const theme of ["any", "dark", "light"]) {
        for (const family of ["stills", "motion", "posters"]) {
          const dir = join(vault, "media", lang, theme, family);
          if (existsSync(dir) && readdirSync(dir).some((name) => name.startsWith(`${id}.`))) return true;
        }
      }
    }
  }
  return false;
}

function vaultRoot() {
  const local = join(ROOT, "tools", "capture", "vault.local.json");
  if (!existsSync(local)) return null;
  try {
    const config = JSON.parse(readFileSync(local, "utf8"));
    return config.vault ?? config.path ?? null;
  } catch {
    return null;
  }
}

// 4 — figures.json must point at pages that exist on the site.
check("figure-pages", "figures.json 的 page 均存在于文档站", () => {
  const pages = new Set(docsSlugs());
  const failures = [];
  for (const item of figures.items) {
    if (!pages.has(item.page)) failures.push(fail(`${item.id} 指向不存在的页面 ${item.page}`));
  }
  return { failures, notes: [`文档站页面 ${pages.size} 个。`] };
});

function docsSlugs() {
  const out = [];
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith(".md")) {
        const name = entry.name.replace(/\.md$/, "");
        out.push(name === "index" ? (prefix || "index") : (prefix ? `${prefix}/${name}` : name));
      }
    }
  };
  walk(join(DOCS, "docs", "zh"), "");
  return out;
}

// 5 — the two languages must keep the same section skeleton and figure order.
check("zh-en-parity", "中英页面结构与图序平行", () => {
  const failures = [];
  const zhDir = join(DOCS, "docs", "zh");
  const enDir = join(DOCS, "docs", "en");
  for (const zh of markdownFiles(zhDir, true)) {
    const rel = relative(zhDir, zh).replace(/\\/g, "/");
    const en = join(enDir, rel);
    if (!existsSync(en)) {
      failures.push(fail(`英文缺页：docs/en/${rel}`));
      continue;
    }
    const zhHeads = headings(readFileSync(zh, "utf8"));
    const enHeads = headings(readFileSync(en, "utf8"));
    if (zhHeads.length !== enHeads.length) {
      failures.push(fail(`${rel}：中文 ${zhHeads.length} 个二级标题，英文 ${enHeads.length} 个`));
    }
    const zhFigures = figureIdsOf(readFileSync(zh, "utf8"));
    const enFigures = figureIdsOf(readFileSync(en, "utf8"));
    if (zhFigures.join(",") !== enFigures.join(",")) {
      failures.push(fail(`${rel}：图序不一致 [${zhFigures.join(", ")}] vs [${enFigures.join(", ")}]`));
    }
  }
  return { failures, notes: [`检查 ${markdownFiles(zhDir, true).length} 页。`] };
});

function markdownFiles(dir, skipEn = false) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipEn && entry.name === "en") continue;
        walk(join(current, entry.name));
      } else if (entry.name.endsWith(".md")) {
        out.push(join(current, entry.name));
      }
    }
  };
  walk(dir);
  return out;
}

function headings(text) {
  return text.split(/\r?\n/).filter((line) => /^##\s+/.test(line));
}

function figureIdsOf(text) {
  return [...text.matchAll(/\bAG-[SAVP]\d{2}-\d{2}[ab]?\b/g)].map((match) => match[0]);
}

// 6 — media references must resolve inside docs/public.
check("media", "媒体引用均可解析", () => {
  const failures = [];
  for (const claim of ledger.claims) {
    for (const ref of claim.media ?? []) {
      const clean = ref.split(/[)"'\s]/)[0].replace(/^\/media\//, "");
      if (!existsSync(join(DOCS, "docs", "public", "media", clean))) {
        failures.push(fail(`${claim.surface}:${claim.line} 引用 ${ref}，文件不存在`));
      }
    }
  }
  return { failures, notes: [] };
});

// 7 — coverage: how many pages still have no figure at all.
check("figure-coverage", "零图页面有登记（textOnly 或计划）", () => {
  const textOnly = new Set((figures.textOnly ?? []).map((item) => item.page));
  const failures = [];
  const notes = [];
  let zero = 0;
  for (const file of markdownFiles(join(DOCS, "docs", "zh"), true)) {
    const rel = relative(join(DOCS, "docs", "zh"), file).replace(/\\/g, "/");
    const slug = rel.replace(/\.md$/, "");
    const text = readFileSync(file, "utf8");
    if (/\/media\//.test(text)) continue;
    zero += 1;
    if (textOnly.has(slug)) continue;
    notes.push(`零图且未登记：${slug}`);
  }
  return { failures, notes: [`零图页面 ${zero} 个。`, ...notes] };
});

// 8 — the fact table must describe the current commit.
check("facts-freshness", "事实表与当前提交一致", () => {
  let head = null;
  try {
    head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return { failures: [], notes: ["无法读取 git HEAD，跳过。"] };
  }
  return {
    failures: facts.plugin.commit && facts.plugin.commit !== head
      ? [fail(`facts.json 记录 ${facts.plugin.commit}，当前 ${head}；重跑 node tools/docs/facts.mjs`)]
      : [],
    notes: [`当前 ${head}。`]
  };
});

const failures = results.flatMap((result) => result.failures.map((entry) => ({ ...entry, check: result.id })));
const summary = {
  checks: results.length,
  failed: results.filter((result) => result.status === "fail").length,
  failures: failures.length,
  pass: results.filter((result) => result.status === "pass").length
};

const lines = [
  "# Showcase claim check",
  "",
  `Generated ${new Date().toISOString()} · commit ${facts.plugin.commit ?? "unknown"}`,
  "",
  `**${summary.failed} / ${summary.checks} checks failed · ${summary.failures} findings**`,
  "",
  "| Check | Status | Findings |",
  "| --- | --- | --- |",
  ...results.map((result) => `| ${result.title} (\`${result.id}\`) | ${result.status === "pass" ? "PASS" : "FAIL"} | ${result.failures.length} |`),
  ""
];

for (const result of results) {
  lines.push(`## ${result.title}`, "");
  if (result.notes?.length) lines.push(...result.notes.map((note) => `- ${note}`), "");
  if (!result.failures.length) {
    lines.push("无失败项。", "");
    continue;
  }
  lines.push("| 位置 | 问题 | 证据 |", "| --- | --- | --- |");
  for (const entry of result.failures.slice(0, 80)) {
    const where = entry.surface ? `${entry.surface}:${entry.line}` : "—";
    lines.push(`| ${where} | ${escapeCell(entry.message)} | ${escapeCell(entry.evidence ?? "—")} |`);
  }
  if (result.failures.length > 80) lines.push("", `（另有 ${result.failures.length - 80} 条未列出）`);
  lines.push("");
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `${lines.join("\n")}\n`, "utf8");

const payload = { ok: summary.failed === 0, summary, report: REPORT, results: results.map(({ failures: list, ...rest }) => ({ ...rest, failures: list.length })) };
if (AS_JSON) console.log(JSON.stringify(payload, null, 2));
else console.log(`${summary.failed}/${summary.checks} checks failed, ${summary.failures} findings → ${REPORT}`);

process.exit(summary.failed === 0 ? 0 : 1);
