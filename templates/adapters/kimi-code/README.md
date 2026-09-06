# Kimi Code 适配包（docs/18 §3）

把六角色 harness 装到 Kimi Code（本机实证 v0.41.0 在位）。AITrader 四角色 v1.2 即 Kimi 原生实证（docs/02）。

## 本包内容

| 文件 | 作用 |
|---|---|
| `hooks-config-toml-snippet.toml` | 三正式 hooks 注册粘贴块，追加到 `~/.kimi-code/config.toml` |
| `../build-adapters.mjs` 产物 `dist/kimi-code/agents/*.md` | 六角色 agent 档案，放置 `~/.kimi-code/agents/`（或跨工具共享 `~/.agents/agents/`） |

## 已证实（本机 + 官方文档）

- ✅ 本机 config.toml 已有 `[[hooks]]` 实例（PreToolUse + matcher "Write|Edit"，AITrader guard）——事件名/matcher/阻断在位实证。
- ✅ 官方文档：agent 目录 = `~/.kimi-code/agents/`、`~/.agents/agents/`（跨工具共享）+ 项目级；frontmatter = name/description(必填)/whenToUse/tools/disallowedTools/subagents；**model 键不支持（同未知键一并忽略）**。
- ✅ 技能：扫 `~/.agents/skills/`（与 ZCode 共享，零成本）。
- ⚠️ 装机验证项：C1/C2 类行为（会话快照、注册优先级）按四步④重验。

## 安装步骤

1. 【agent】`node templates/adapters/build-adapters.mjs` → 复制 `dist/kimi-code/agents/*.md` 到 `~/.kimi-code/agents/`。
2. 【人闸】把 `hooks-config-toml-snippet.toml` 追加到 `~/.kimi-code/config.toml` 尾部；`__HARNESS__` 替换为 harness 仓库绝对路径（正斜杠）。
3. 【agent】可用 `kimi doctor` 校验 config 合法性；payload 探针同 claude-code 步骤 3（Kimi 路径字段为 `tool_input.path`，guard 已双读）。

## 装机验证

- guard 阻断主检出写入（Kimi 是 guard 机制源头，预期直接绿）。
- `kimi --agent planner` 档案加载；主会话按 description 派发子代理成立。
- rerun 路由降级说明：agent 档案不支持 model 键，重跑专用变体改用 `kimi -m <模型>` 会话级指定。
- 记忆注入/分支提醒（UserPromptSubmit）正常注入。
