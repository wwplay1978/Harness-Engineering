# adapters/ — 五宿主适配包（N18，2026-09-06）

ZCode 之外五个已核验宿主的接入实现：**claude-code / kimi-code / codex / opencode / pi-agent**。
判级证据、逐宿主已证实/待验证清单、装机验证 runbook 的**唯一权威 = `docs/18-host-adapters.md`**；本目录是可执行资产。

```
adapters/
├── build-adapters.mjs            # 六角色模板 → 五宿主角色文件物化器（产物进 dist/，git 忽略）
├── claude-code/   hooks-settings-snippet.json + README.md
├── kimi-code/     hooks-config-toml-snippet.toml + README.md
├── codex/         hooks-user-hooks.json + README.md          （dist 另产出 agents/*.toml + prompts/*.md）
├── opencode/      plugins/harness-guard.js + README.md       （dist 另产出 agents/*.md）
├── pi-agent/      extensions/harness-guard.ts + README.md    （dist 另产出 prompts/*.md——单代理角色卡降级）
└── dist/          物化产物（生成，不入库）
```

## 用法

```bash
node templates/adapters/build-adapters.mjs              # 物化全部宿主角色文件到 dist/
node templates/adapters/build-adapters.mjs --out <dir>  # 指定输出目录
```

## 三条纪律（与全局铁律同源）

1. **hooks/守护注册永远人手**（05 §3 人闸）：agent 只准备粘贴块并指导，注册写入由人工完成——即使人口头同意也不代写。
2. **guard 三形态同源**：claude-code / kimi-code / codex 复用 `templates/hooks/guard-worktree.mjs`（stdin JSON → exit 2）；opencode = 插件 throw；pi = 扩展 `block: true`。白名单（docs//memory//context.md/templates/）、root+'/' 判定、fail-open 语义逐字保持。
3. **probe-first**：各宿主 payload 字段名是装机最大变数——注册前一律先用 `templates/hooks/probe-payload.mjs` 探针确认 stdin/事件字段，再换真 guard（各 README 有步骤）。

## 装机状态（诚实边界）

适配包已产出 ≠ 已适配。**装机实测（四步①–④完整走完）未做**，五宿主在 check-env 中仍报"未适配"；首装实测随 N19（docs/17 kickoff 流程）执行，实测结论回灌 docs/18 与 docs/16 §2。
