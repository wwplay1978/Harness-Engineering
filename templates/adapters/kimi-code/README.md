# Kimi Code 适配包（docs/18 §3）

把六角色 harness 装到 Kimi Code（本机实证 v0.41.0 在位）。AITrader 四角色 v1.2 即 Kimi 原生实证（docs/02）。

## 本包内容

| 文件 | 作用 |
|---|---|
| `hooks-config-toml-snippet.toml` | 三正式 hooks 注册粘贴块，追加到 `~/.kimi-code/config.toml` |
| `../build-adapters.mjs` 产物 `dist/kimi-code/agents/*.md` | 六角色 agent 档案，放置 `~/.kimi-code/agents/`（或跨工具共享 `~/.agents/agents/`） |

## 已证实（本机 + 官方文档）

- ✅ 本机 config.toml 已有 `[[hooks]]` 实例（PreToolUse + matcher "Write|Edit"，AITrader guard）——事件名/matcher/阻断在位实证。**合并时注意去重**：本机 AITrader 期遗留的 `[[hooks]]`（相对路径命令，仅 AITrader 项目内可用）与新粘贴块并存会双重触发——按事件比对，旧条目若与本三件职责重叠则删除或注释。
- ✅✅ hooks 官方页全证（2026-09-07）：[[hooks]] 仅许 event/matcher/command/timeout 四字段（多余字段整份拒载——本粘贴块恰合规）；可阻断事件集=PreToolUse/Stop/UserPromptSubmit（恰为三正式所需）；exit 2=阻断且 stderr 即理由、其余非零/超时=fail-open；UserPromptSubmit stdout 注入上下文——inject/report 机制官方级确认。
- ✅ 官方文档：agent 目录 = `~/.kimi-code/agents/`、`~/.agents/agents/`（跨工具共享）+ 项目级；frontmatter = name/description(必填)/whenToUse/tools/disallowedTools/subagents；**model 键不支持（同未知键一并忽略）**。
- ✅ 技能：扫 `~/.agents/skills/`（与 ZCode 共享，零成本）。
- ⚠️ 装机验证项：C1/C2 类行为（会话快照、注册优先级）按四步④重验。

## 安装步骤

1. 【agent】`node templates/adapters/build-adapters.mjs` → 复制 `dist/kimi-code/agents/*.md` 到 `~/.kimi-code/agents/`。
2. 【agent 准备 + 人闸执行】**部署执行位**：人工把 REPO `templates/hooks/` 三个 .mjs 复制到 `~/.kimi-code/hooks/harness/`（用户域，2026-09-07 起不指向任何仓库目录）；**注册**：`hooks-config-toml-snippet.toml` 追加到 `~/.kimi-code/config.toml` 尾部，三处 `__HOME__` 替换为展开后的用户主目录绝对路径（正斜杠，如 `C:/Users/you`；禁用 `~` 字面量——命令串不展开 tilde）。
3. 【agent】可用 `kimi doctor` 校验 config 合法性；payload 探针同 claude-code 步骤 3（Kimi 路径字段为 `tool_input.path`，guard 已双读）。

## 装机验证

- guard 阻断主检出写入（Kimi 是 guard 机制源头，预期直接绿）。
- `kimi --agent planner` 档案加载；主会话按 description 派发子代理成立。
- rerun 路由降级说明：agent 档案不支持 model 键，重跑专用变体改用 `kimi -m <模型>` 会话级指定。
- 记忆注入/分支提醒（UserPromptSubmit）正常注入。
