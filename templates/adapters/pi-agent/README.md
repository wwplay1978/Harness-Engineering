# Pi Agent 适配包（docs/18 §6）

把六角色 harness 装到 pi（本机实证 @earendil-works/pi-coding-agent 0.85.1，npm 全局）。
**结构性降级声明：pi 无原生子代理**（官方 README："skips features like sub agents and plan mode"）——六角色以"单代理角色卡"形态适配，流水线语义从"派发隔离"降级为"角色纪律顺序执行"；写入隔离物理防线不降级（扩展 guard）。

## 本包内容

| 文件 | 作用 |
|---|---|
| `extensions/harness-guard.ts` | 写入隔离扩展（`pi.on("tool_call")` 返回 `{ block: true }` 阻断），放置 `~/.pi/agent/extensions/` |
| `../build-adapters.mjs` 产物 `dist/pi-agent/prompts/*.md` | 六角色角色卡，放置 `~/.pi/agent/prompts/`（文件名即 `/命令`） |

## 已证实 / 待验证

- ✅ 官方文档 extensions.md：扩展可"Block or modify tool calls"；示例即 `pi.on("tool_call", ...)` + `return { block: true, reason }`；路径保护（block writes to `.env` 等）是官方列明场景。
- ✅ 技能：pi 实现 Agent Skills 标准，扫 `~/.pi/agent/skills/` **与 `~/.agents/skills/`**（与 ZCode/Kimi 共享，零成本）+ 项目 `.pi/skills/`、`.agents/skills/`。
- ✅ 上下文：原生发现并加载 AGENTS.md / CLAUDE.md（`--no-context-files` 才关闭）。
- ✅ 提示词模板：全局 `~/.pi/agent/prompts/*.md`，文件名即 `/命令`，frontmatter 仅 `description`（+可选 argument-hint）。
- ⚠️ 装机验证项：tool_call 事件里 write/edit 的路径字段名（官方示例只见 `event.input.command`）；`ctx.cwd` 字段名；`bash` 工具的写路径是否需要单独拦（当前与 .mjs 同口径：只拦写文件工具）。
- ⚠️ MCP/记忆面：pi 的 MCP 支持未在 N18 核验（文档集中 extensions/providers/packages）——basic-memory/hindsight 接入列为装机验证项；缺省降级为"角色文件开工必检条款 + Obsidian 直读"。

## 安装步骤

1. 【agent】`node templates/adapters/build-adapters.mjs` → 复制 `dist/pi-agent/prompts/*.md` 到 `~/.pi/agent/prompts/`；复制 `extensions/harness-guard.ts` 到 `~/.pi/agent/extensions/`。
2. 【agent】payload 探针：在 harness-guard.ts 的 `return { block: true ... }` 前临时加 `console.error(JSON.stringify(event.input))`，会话里触发一次写入，回读确认字段名后还原。
3. 【人闸】确认扩展文件落位（pi 启动自动发现，受信目录；非 config 写入）。

## 装机验证

- guard 拦下主检出写入（reason 含 gtr 指引）；docs/ 白名单放行。
- `/planner` 角色卡载入，单会话内按卡内纪律执行（流程为顺序角色扮演，非隔离上下文——已知降级）。
- AGENTS.md 被加载；`~/.agents/skills/` 技能可被发现（Anchors 不降级）。

## 降级语义记录（对齐 docs/16 §4 矩阵思路）

| 机制 | ZCode 形态 | pi 形态 | 影响 |
|---|---|---|---|
| 子代理隔离 | 每角色独立上下文 | 单会话顺序换卡 | 上下文污染风险↑——重活建议拆多会话接力（07 回退模式） |
| 并行派发 | 只读角色可并行 | 无 | 工期↑ |
| rerun 变体 | 模型钉住 | 无对应机制 | 重跑路由降级为同模型 |
| 写入隔离 | hook exit 2 | 扩展 block | **等价物理防线**（无降级） |
