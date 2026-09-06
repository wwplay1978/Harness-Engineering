# 18 · 宿主适配包：五宿主接入实现（N18 交付）

> 2026-09-06 交付。范围：五个已核验宿主（**claude-code / kimi-code / codex / opencode / pi-agent**）的
> 角色文件物化器、guard/hooks 粘贴块、逐宿主 README 与装机验证清单。判级证据回填 16 §2。
> **诚实边界：适配包已产出 ≠ 已适配**——装机实测（16 §2 四步①–④完整走完）未做，五宿主在 check-env
> 仍报"未适配"；首装实测随 N19 执行，结论按 08 附录口径回灌本文与矩阵。
> 文内"08 附录"等编号为**内部档案锚点**（06/08–14 不随公开版发布，见 00 公开版说明）——公开读者按本文 + docs/16 §2 即够，无需 08。

## 0. 五机制终判表（本机证据，2026-09-06）

证据级别：**实证**=本机命令/文件/配置实测；**文档**=官方文档（当日读档）；**待装机**=留待 N19 现场验证。

| 宿主（本机版本） | 派发/子代理 | 可阻断防线 | MCP | 技能 | 角色文件落点 |
|---|---|---|---|---|---|
| **claude-code** (2.1.220) | ✅ 同族 subagents（`~/.claude/agents/`，文档+同族 lineage） | ✅ 同族 hooks：settings.json、PreToolUse、exit 2（文档+lineage；注册/优先级待装机） | ✅ | ✅ | `~/.claude/agents/*.md` |
| **kimi-code** (0.41.0) | ✅ 实证（AITrader v1.2）+文档（`~/.kimi-code/agents/`、`~/.agents/agents/`） | ✅ 实证（本机 config.toml `[[hooks]]` PreToolUse+matcher；exit 2 为 guard 机制源头） | ✅ | ✅ 文档实证共扫 `~/.agents/skills/` | `~/.kimi-code/agents/*.md` |
| **codex** (0.153.4) | ⚠️ 形态=第三方指南口径（官方 agents/multi-agent 页当日 404 未证实；multi_agent 特性开关 stable=true 为本机实证）——`~/.codex/agents/*.toml` + spawn_agent | ✅ 文档（`~/.codex/hooks.json`，PreToolUse 阻断 apply_patch/Edit/Write；官方自注"护栏非完全强制边界"） | ✅ config.toml 实证 | ✅ AGENTS.md + prompts 实证 | `~/.codex/agents/*.toml`（+prompts 降级卡） |
| **opencode** (1.18.29) | ✅ 文档+本机 GSD 样本（agents/ 目录、`mode: subagent`、@mention 派发） | ✅ 文档（插件 `tool.execute.before` throw 即阻断；本机插件样本证实加载形态） | ✅ | ✅ AGENTS.md | `~/.config/opencode/agents/*.md` |
| **pi-agent** (0.85.1) | ❌ 无原生子代理（官方 README 明示）→ **单代理角色卡降级** | ✅ 文档（扩展 `pi.on("tool_call")` → `{block:true}`；路径保护为官方场景） | 未证实（N18 未核验） | ✅ 文档实证共扫 `~/.agents/skills/` | `~/.pi/agent/prompts/*.md`（/命令 角色卡） |

## 1. 共享设计与纪律

### 1.1 资产清单（templates/adapters/）

```
adapters/
├── build-adapters.mjs            # 物化器：templates/agents/*.md → dist/<host>/（36 份产物：6 角色 × 5 宿主，codex 双形态）
├── claude-code/   hooks-settings-snippet.json
├── kimi-code/     hooks-config-toml-snippet.toml
├── codex/         hooks-user-hooks.json
├── opencode/      plugins/harness-guard.js
├── pi-agent/      extensions/harness-guard.ts
└── <各宿主>/README.md             # 安装步骤（agent/人闸分工）+ 装机验证清单
```

产物映射：claude-code/kimi-code/opencode → `agents/*.md`；codex → `agents/*.toml` + `prompts/*.md`（降级卡）；pi-agent → `prompts/*.md`。物化器对每份产物做写后回读断言（防假绿），未知 frontmatter 键大声告警。

### 1.2 guard 三形态（同源逻辑，三种宿主机制）

| 形态 | 宿主 | 阻断语义 | 载体 |
|---|---|---|---|
| stdin/exit 2（原版） | claude-code / kimi-code / codex | exit 2 + stderr gtr 指引 | 复用 `templates/hooks/guard-worktree.mjs`（Zcode_T1 `.zcode/hooks/` 执行位） |
| 插件 throw | opencode | `tool.execute.before` 内 `throw new Error` | `adapters/opencode/plugins/harness-guard.js` |
| 扩展 block | pi-agent | `pi.on("tool_call")` 返回 `{block:true, reason}` | `adapters/pi-agent/extensions/harness-guard.ts` |

白名单（`/docs/`、`/memory/`、`/context.md`、`/templates/`）、`root + '/'` 前缀判定（防兄弟 worktree 目录误判）、fail-open 语义、AGENTS.md 与宿主配置目录不可写（防自毁防线）逐字保持。

### 1.3 三条纪律

1. **hooks/守护注册永远人手**（05 §3 人闸）：各粘贴块由人工写入宿主配置，agent 只准备并指导——即使人口头同意也不代写。
2. **probe-first**：各宿主 payload 字段名是装机最大变数。注册真 guard 前一律先用 `templates/hooks/probe-payload.mjs` 探针确认 stdin/事件字段（guard 双读 file_path/path，理论上零改动，但 codex apply_patch 的 tool_input 形态必须实测）。
3. **`__HARNESS__` 占位符**：粘贴块中 harness 仓库绝对路径（正斜杠）由装机时替换；不写死任何机器路径。

## 2. claude-code（docs/16 §2 回填：未适配 → 适配包已产出）

- **已证实**：v2.1.220 在位；`~/.claude/agents/` 空目录在位；settings.json 仅 env 段（**内含后端 token——适配产物绝不携带**）。ZCode 即 Claude Code 系 lineage，hooks/subagents 同族。
- **装机验证重点**：`disallowedTools` 物理生效性（官方主推 `tools` 正向清单，未知键有静默忽略风险——planner 禁 Edit/Bash 需实测，guard 兜底）；hooks 注册优先级（C2 类重验）。
- **产物**：settings.json 粘贴块（matcher `Write|Edit|ApplyPatch`）+ `dist/claude-code/agents/*.md`。

## 3. kimi-code（判级最稳：机制源头 + 官方文档双实证）

- **已证实**：本机 config.toml 既有 `[[hooks]]` 实例（PreToolUse + matcher "Write|Edit"，AITrader guard-worktree）——事件名/matcher/TOML 形态在位实证；官方文档 agents 目录与 frontmatter 键全表（name/description/whenToUse/override/tools/disallowedTools/subagents）；**model 键不支持**（与未知键一并忽略）；技能扫 `~/.agents/skills/`。
- **降级项**：rerun 变体（model 钉住）不物化——重跑路由改会话 `-m` 指定模型。
- **产物**：config.toml 粘贴块 + `dist/kimi-code/agents/*.md`；`kimi doctor` 可校验配置。

## 4. codex（判级改写最大：从"sandbox 降级"升级为"完整 hooks 宿主"）

- **判级改写依据**（16 §2 旧判级"无 PreToolUse 型阻断"作废）：官方 hooks 文档——`~/.codex/hooks.json`（用户级）+ `<repo>/.codex/hooks.json`（项目级）双层加载；事件族与 Claude Code 同型（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/SubagentStart/Stop…）；**apply_patch 触发 PreToolUse**（matcher 认 `apply_patch`/`Edit`/`Write`，输入 tool_name 报 `apply_patch`）；阻断三形态（`permissionDecision:"deny"` / `{"decision":"block"}` / exit 2+stderr）。本机 `[features] hooks = true`、`multi_agent = true`（stable，features list 实测）。
- **诚实边界**：官方自注"部分专用工具路径可退出默认 hook 路径——hooks 属护栏（guardrail）而非完全强制边界"，验收话术按护栏口径；托管工具（如 WebSearch）不触发 PreToolUse。
- **角色形态**（⚠️ 来源=第三方指南 morphllm/proflead/firecrawl + 上游 issue 讨论；官方 agents/multi-agent 文档页当日 404，键名以装机实测为准）：`~/.codex/agents/*.toml`（name/description/instructions；multi_agent spawn_agent 派发）为主，`~/.codex/prompts/*.md` 单会话角色卡为降级备选。项目级自定义角色对 spawn_agent 不可见（上游 #14579）→ 一律用户级；schema 暴露跨平台不一致（#26828）→ 异常走 prompts 卡。
- **装机验证重点**：**payload 探针必做**——apply_patch 的 `tool_input` 是否含逐文件路径；若只含整块 patch 文本，guard 需加 codex 字段分支后才能绿（预期装机工作，非阻塞）。
- **环境修复备注**：本机原安装损坏（npm 未按 ARM64 解析出 win32-x64 依赖报错）；`npm install -g @openai/codex@latest` 重装拉到 codex-win32-arm64 原生包后 0.153.4 正常。

## 5. opencode（从"未证实"升级为"文档+样本双实证"）

- **已证实**：全局 agents 目录 `~/.config/opencode/agents/`（复数）+ 项目 `.opencode/agents/`；frontmatter = description(必填)/mode(`primary`|`subagent`|`all`)/model/temperature/permission，文件名即 agent 名；派发 = description 自动派发或 `@name` 显式；插件阻断 = `tool.execute.before` 内 throw；插件目录 `~/.config/opencode/plugins/` 启动自动加载（本机 GSD 框架 33 个 agent 文件 + 插件样本同构印证）。
- **降级项**：`disallowedTools` 不存在——只读角色"禁写"纵深降级为 guard（物理主防线）+ 纪律；`tools` 键官方标 deprecated（`permission` 键替代为装机验证项）；UserPromptSubmit 等价事件未核验——记忆注入/分支提醒降级为"角色文件开工必检条款"。
- **产物**：`plugins/harness-guard.js`（write/edit/patch 三名集合，args 路径字段三读兜底）+ `dist/opencode/agents/*.md`。

## 6. pi-agent（从"全未证实"升级为"结构性降级适配"）

- **已证实**：npm 包 `@earendil-works/pi-coding-agent` 0.85.1（pi.dev）；官方 README 明示 **"skips features like sub agents and plan mode"**——无原生子代理为产品设计而非缺陷；扩展可阻断工具调用（`tool_call` 事件 `{block:true}`，路径保护为官方场景）；技能实现 Agent Skills 标准且**共扫 `~/.agents/skills/`**（与 ZCode/Kimi 零成本共享，Anchors 不降级）；原生加载 AGENTS.md；提示词模板 `~/.pi/agent/prompts/*.md` 文件名即 `/命令`。
- **降级语义表**（对齐 16 §4 思路）：子代理隔离→单会话顺序换卡（重活拆多会话接力，即 07 回退模式）；并行派发→无；rerun 变体→无（同模型）；**写入隔离→扩展 block（等价物理防线，无降级）**；MCP/记忆面未核验→缺省"开工必检条款 + Obsidian 直读"。
- **产物**：`extensions/harness-guard.ts`（write/edit 两名集合）+ `dist/pi-agent/prompts/*.md`；扩展落位 `~/.pi/agent/extensions/`（全局）或受信项目 `.pi/extensions/`。

## 7. check-env 探测升级（N18 连带修正）

- 宿主探测改双通道：`dirs` 文件系统 + `cli` PATH 探测（win32 `where` / unix `which`），任一命中即"在位"。动机是今天的一对实测教训：**pi CLI 在位但配置目录未生成 → 漏报**（首装当天未跑过 CLI）；**opencode 配置目录在位但 CLI 已不在 PATH → 虚报**。
- 五宿主 `adapted` 文案统一改写为"适配包已产出 + docs/18 §n 指针"，消除"未证实/需重设计"类过时判级。

## 8. N19 衔接（首装实测将闭合的项）

1. 五宿主 payload 探针结果 → guard 字段映射确认/微调（codex apply_patch 形态是唯一预期需要改代码的项）。
2. claude-code `disallowedTools` 物理生效性 → 决定是否补 permission 类替代键。
3. codex `~/.codex/agents/*.toml` spawn_agent 暴露一致性 → 决定主/降级形态定级。
4. opencode permission 键替代 tools、记忆注入等价事件面。
5. pi tool_call 路径字段名、ctx.cwd、MCP 面。
6. 全部结论按 08 附录口径回灌本文与 16 §2 矩阵，五宿主判级从"适配包已产出"迁到"已适配（装机日期）"。

## 9. 证据来源（2026-09-06 读档）

- 本机实测：`claude --version` / `kimi --version` / `codex features list` / `opencode --version` / `pi --help`；`~/.kimi-code/config.toml` 既有 hooks 实例；`~/.config/opencode/{agents,plugins}` GSD 样本；codex 官方包平台依赖（npm view optionalDependencies）。
- 官方文档：Claude Code（同族 lineage + settings/hooks schema）；Kimi Code `llms-full.txt`（agents/skills 目录与 frontmatter 全表）；Codex `learn.chatgpt.com/docs/hooks`（hooks.json/事件/阻断/工具覆盖表）+ config-reference（multi_agent 工具族，搜索摘要口径）+ 上游 issues #14579/#26828；**codex agents/*.toml 形态=第三方指南（morphllm/proflead/firecrawl），官方页 404 未证实**；OpenCode `opencode.ai/docs/plugins`（throw 阻断）与 `/docs/agents`（目录/frontmatter/派发）；pi 官方文档（npm 包内 docs/：extensions.md、skills.md、prompt-templates.md）。
