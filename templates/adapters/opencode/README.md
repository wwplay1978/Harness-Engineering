# OpenCode 适配包（docs/18 §5）

把六角色 harness 装到 OpenCode（本机重装后实证 1.18.29，ARM64 原生包）。

## 本包内容

| 文件 | 作用 |
|---|---|
| `plugins/harness-guard.js` | 写入隔离插件（`tool.execute.before` 内 throw 阻断），放置 `~/.config/opencode/plugins/` |
| `../build-adapters.mjs` 产物 `dist/opencode/agents/*.md` | 六角色 agent（frontmatter：description + `mode: subagent`），放置 `~/.config/opencode/agents/` |

## 已证实 / 待验证

- ✅ 官方文档 agents 页：全局目录 `~/.config/opencode/agents/`（复数）、项目 `.opencode/agents/`；frontmatter = description(必填)/mode(`primary`|`subagent`|`all`)/model/temperature/permission；文件名即 agent 名；派发=主代理按 description 自动派发或 `@name` 显式派发。
- ✅ 官方文档 plugins 页：阻断=在 `tool.execute.before` 中 `throw new Error(...)`；插件目录 `~/.config/opencode/plugins/`（全局，启动自动加载）——本机现有 GSD 框架的 agents/hooks/plugins 三目录样本与此一致（2026-04 安装实证）。CLI 实测 `opencode agent list/create` 在位。
- ✅ skills 层实测在位（2026-09-07 CLI：`opencode debug skill` 子命令；本机空载未配技能）——目录配置方式待装机；配通后五棒技能锚点可不再降级。
- ⚠️ `tools` 键官方标注 deprecated（倾向 `permission` 键）；本包仍物化 `tools` 正向清单（只读角色），`permission` 键替代方案为装机验证项。
- ⚠️ `disallowedTools` 不存在——code-reviewer/red-teamer 的"禁写"纵深降级为 guard + 纪律（guard 是物理主防线，语义不变）。
- ⚠️ 装机验证项：write/edit/patch 工具名与 args 路径字段名（`filePath` vs `path`——guard 已三读兜底，仍需探针确认）。

## 安装步骤

1. 【agent】`node templates/adapters/build-adapters.mjs` → 复制 `dist/opencode/agents/*.md` 到 `~/.config/opencode/agents/`；复制 `plugins/harness-guard.js` 到 `~/.config/opencode/plugins/`。
2. 【agent】payload 探针：在 harness-guard.js 的 throw 前临时加 `console.error(JSON.stringify({ tool: input.tool, args: Object.keys(output.args ?? {}) }))`，会话里触发一次写入，回读确认字段名后还原。
3. 【人闸】确认插件文件落位即可（opencode 启动自动加载；本步骤属"注册位置确认"，非 config 写入）。

## 装机验证

- guard 拦下主检出写入（错误信息含 gtr 指引）；docs/ 白名单放行。
- `@planner` 显式派发成立；主代理可按 description 自动派发 code-reviewer。
- AGENTS.md 被 pi/opencode 原生发现（AGENTS.md 是跨宿主宪法，OpenCode 支持 context files）。
- 记忆注入/分支提醒：opencode 事件面（UserPromptSubmit 等价事件）未在 N18 核验——列为装机验证项，缺省降级为"不注入、靠角色文件内开工必检条款"。
