# Claude Code 适配包（docs/18 §2）

把六角色 harness 装到 Claude Code（本机实证 v2.1.220 在位）。判级证据汇总见 `docs/18-host-adapters.md`。

## 本包内容

| 文件 | 作用 |
|---|---|
| `hooks-settings-snippet.json` | 三正式 hooks（guard/inject/report）注册粘贴块，并入 `~/.claude/settings.json` |
| `../build-adapters.mjs` 产物 `dist/claude-code/agents/*.md` | 六角色子代理文件，放置 `~/.claude/agents/` |

## 已证实 / 待验证

- ✅ 在位实测：v2.1.220；`~/.claude/agents/`（空目录在位）；settings.json 仅 env 段。
- ✅ 同族 schema（ZCode 即 Claude Code 系产物：PreToolUse/UserPromptSubmit、exit 2 阻断、matcher 形态一致）。
- ⚠️ 装机验证项：`disallowedTools` 键物理生效性（Claude Code 文档主推 `tools` 正向清单；未知键有静默忽略风险——planner 的禁 Edit/Bash 需实测确认，guard 为兜底物理防线）。**若实测被忽略的既定对策**：planner 变体改物化 `tools` 正向清单（Read/Grep/Glob/Skill 等穷举），不改 guard。
- ⚠️ 装机验证项：hooks 注册优先级（用户级/项目级覆盖关系，对齐 C2 类行为重验，四步④）。

## 安装步骤（agent 可代做 vs 人闸）

1. 【agent】`node templates/adapters/build-adapters.mjs` → 复制 `dist/claude-code/agents/*.md` 到 `~/.claude/agents/`。
2. 【人闸】把 `hooks-settings-snippet.json` 的 `hooks` 键并入 `~/.claude/settings.json`（已有 hooks 按事件合并）；`__HARNESS__` 替换为 harness 仓库绝对路径（正斜杠）。
3. 【agent】payload 探针：临时把 guard 命令换成 `node __HARNESS__/templates/hooks/probe-payload.mjs`，在会话里做一次 Write，确认 stdin JSON 含 `cwd`、`tool_input.file_path`（guard 双读 file_path/path，理论上零改动），换回 guard。

## 装机验证（对齐 07 第 6 步三项 + 宿主特有）

- guard 阻断主检出写入并提示 gtr 三选一；大小写混合路径仍被阻断。
- AGENTS.md 写入被阻断。
- `~/.claude/agents/planner.md` 放置后新会话，planner 出现在子代理清单；派发与最后一条消息回收成立。
- planner 调 Edit/Bash 被拒（disallowedTools 实测；若被忽略→记入 08 附录并评估 permission 类替代键）。
- 记忆注入与分支提醒出现在新会话首条消息。
