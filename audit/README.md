# Audit ledger

这份目录让「展示是否与代码一致」变成可执行检查，而不是一次性校对。

| 文件 | 来源 | 是否手改 |
| --- | --- | --- |
| `facts.json` | `node tools/docs/facts.mjs` 从源码生成 | 否 |
| `claims.json` | `node tools/docs/claims.mjs` 从展示面抽取 | 否 |
| `findings.md` | 人工裁定，引用双侧证据 | 是 |
| `check-report.md` | `node tools/docs/check.mjs` 生成 | 否 |
| `GLOSSARY.md` | 术语表 | 是 |

```bash
npm run check:docs        # 重新生成 + 校验；有错误时退出码 1
node tools/docs/facts.mjs # 只重建事实源
node tools/docs/claims.mjs
node tools/docs/check.mjs --json
```

## 判定规则

- 代码 > 实验 > 规格 > 文档。代码与文档冲突时以代码为准；代码本身有歧义时先做实验，结果记在 `claims.json` 的 `needs-experiment`。
- `claims.json` 的 `status`：`wrong`（被代码证伪）、`ok`（数值与事实一致）、`unknown-figure`、`unknown-param`、`missing-media`、`retired-param`、`unverified`（需人工或实验）。
- `check.mjs` 的失败项才是门禁；`unverified` 不阻塞，但必须在 `findings.md` 有去向。

## 不做什么

- 不替代 `manifest-check.mjs`（素材规格）与 `npm run check:demo`（demo 构建一致性）。
- 不检查文风、不翻译、不重写段落；它只回答「这句话与代码是否一致」。
