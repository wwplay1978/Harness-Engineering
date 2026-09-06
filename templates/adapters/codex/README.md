# Codex 适配包（docs/18 §4）

把六角色 harness 装到 OpenAI Codex CLI（本机修复后实证 0.153.4，ARM64 原生包）。
2026-09-06 判级改写：Codex 已有完整 hooks 体系（官方文档实证），不再是"仅 sandbox/approval 降级"形态。

## 本包内容

| 文件 | 作用 |
|---|---|
| `hooks-user-hooks.json` | 三正式 hooks 注册粘贴块，写入 `~/.codex/hooks.json`（无则新建，有则按事件合并） |
| `../build-adapters.mjs` 产物 `dist/codex/agents/*.toml` | 六角色自定义 agent（multi_agent spawn_agent 派发），放置 `~/.codex/agents/` |
| `../build-adapters.mjs` 产物 `dist/codex/prompts/*.md` | 降级备选：单会话角色卡（`/角色名` 调用），agents.toml 暴露异常时兜底 |

## 已证实 / 待验证

- ✅ 官方 hooks 文档：`~/.codex/hooks.json`（用户级）+ `<repo>/.codex/hooks.json`（项目级）双层加载；PreToolUse 可阻断，**apply_patch 会触发**（matcher 按 `apply_patch`/`Edit`/`Write` 匹配，输入里 tool_name 报 `apply_patch`）；阻断输出三形态：`permissionDecision:"deny"` / 旧式 `{"decision":"block"}` / exit 2+stderr。
- ✅ 本机 `[features] hooks = true`、`multi_agent = true`（stable，0.153.4 features list 实测）。
- ⚠️ 官方自注边界："部分专用工具路径可退出默认 hook 路径——hooks 属护栏（guardrail）而非完全强制边界"。写入隔离第一道物理防线仍成立，验收话术按护栏口径。
- ⚠️ 装机验证项：guard 的 payload 字段映射（apply_patch 的 `tool_input` 是否含逐文件路径——**先跑探针**；若只有整块 patch 文本，需给 guard 加 codex 分支后才能绿，属预期装机工作）。
- ⚠️ **探针完成前，guard 对 apply_patch 等价零防护**：guard 对无路径可判的 payload 是 fail-open（与 .mjs 同语义）——注册了 hooks.json 不等于防线已生效，完成探针/字段适配前不得按"已部署物理防线"对待。
- ⚠️ 上游已知问题（记录，不阻塞）：项目级 `.codex/config.toml` 自定义角色对 spawn_agent 不可见（#14579）→ 一律放用户级 `~/.codex/agents/`；spawn_agent schema 暴露跨平台不一致（#26828）→ 异常时走 prompts 角色卡降级。

## 安装步骤

1. 【agent】`node templates/adapters/build-adapters.mjs` → 复制 `dist/codex/agents/*.toml` 到 `~/.codex/agents/`（用户级），`dist/codex/prompts/*.md` 到 `~/.codex/prompts/`。
2. 【人闸】`hooks-user-hooks.json` 写入/合并到 `~/.codex/hooks.json`；`__HARNESS__` 替换为 harness 仓库绝对路径（正斜杠）。
3. 【agent】payload 探针（必做）：把 PreToolUse 命令临时换成 `node __HARNESS__/templates/hooks/probe-payload.mjs`，在会话里触发一次 apply_patch 与一次 Bash，回读探针输出确认 `cwd`/路径字段名，再换回 guard 并按需调整字段映射。

## 装机验证

- guard 阻断主检出内 apply_patch 写入（白名单目录 docs/ 等放行）。
- AGENTS.md 写入被阻断。
- `spawn_agent(role="planner")` 可派发（或降级为 prompts 卡单会话跑角色纪律）。
- 记忆注入/分支提醒（UserPromptSubmit）正常。

## 环境修复备注（本机 2026-09-06）

原安装损坏（缺平台二进制 `@openai/codex-win32-x64`——npm 未按 ARM64 解析）；`npm install -g @openai/codex@latest` 重装后拉到 `codex-win32-arm64` 原生包，`codex --version` → codex-cli 0.153.4。目标机若是 ARM64 Windows 且 codex 报 Missing optional dependency，同法重装。
