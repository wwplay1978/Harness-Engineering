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
| **claude-code** (2.1.220) | ✅ 同族 subagents（`~/.claude/agents/`；CLI 实测 `--agent`/`--agents <json>`） | ✅ 同族 hooks：settings.json、PreToolUse、exit 2（文档+lineage；注册/优先级待装机） | ✅ | ✅ 自有技能层（`~/.claude/skills/`，**不共扫 ~/.agents/skills**；subagent 可声明 `skills` 字段全文预载——官方文档） | `~/.claude/agents/*.md` |
| **kimi-code** (0.41.0) | ✅ 实证（AITrader v1.2）+文档（`~/.kimi-code/agents/`、`~/.agents/agents/`） | ✅✅ hooks 官方页全证（2026-09-07）：[[hooks]] 仅 event/matcher/command/timeout 四字段、可阻断集=PreToolUse/Stop/UserPromptSubmit、exit 2=阻断（stderr 为理由）、其余非零/超时=fail-open、UserPromptSubmit stdout 注入上下文 | ✅ | ✅ 文档实证共扫 `~/.agents/skills/` | `~/.kimi-code/agents/*.md` |
| **codex** (0.153.4) | ✅ 官方 subagents 页终判（2026-09-07 读档）：`~/.codex/agents/*.toml` 一角色一文件，必填 name/description/**developer_instructions**，可选 model/**sandbox_mode**（角色级物理沙箱）/mcp_servers/skills.config；[agents] 表仅全局设置 | ✅ 文档（`~/.codex/hooks.json`，PreToolUse 阻断 apply_patch/Edit/Write；官方自注"护栏非完全强制边界"） | ✅ config.toml 实证 | ✅✅ AGENTS.md + prompts + **官方 skills 层**（`[[skills.config]]` path+enabled 可挂任意目录） | `~/.codex/agents/*.toml`（+prompts 降级卡） |
| **opencode** (1.18.29) | ✅ 文档+本机 GSD 样本（agents/ 目录、`mode: subagent`、@mention 派发；CLI 实测 `opencode agent list/create`） | ✅ 文档（插件 `tool.execute.before` throw 即阻断；本机插件样本证实加载形态） | ✅ | ✅ AGENTS.md + **skills 层实测在位**（`opencode debug skill` 子命令，本机空载；目录配置待装机） | `~/.config/opencode/agents/*.md` |
| **pi-agent** (0.85.1) | ❌ 无原生子代理（官方 README 明示）→ **单代理角色卡降级** | ✅✅ 扩展 `tool_call` → `{block:true}`：官方示例 protected-paths.ts 即写路径守卫范本，`event.input.path` 字段名官方实证；`ctx.cwd` 官方文档实证 | ❌ 官方明示无内置 MCP（usage.md："intentionally does not include built-in MCP"）——记忆面走角色开工必检条款 + Obsidian 直读 | ✅ 文档实证共扫 `~/.agents/skills/` | `~/.pi/agent/prompts/*.md`（/命令 角色卡） |

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

- **已证实**：v2.1.220 在位；`~/.claude/agents/` 空目录在位；settings.json 仅 env 段（**内含后端 token——适配产物绝不携带**）。ZCode 即 Claude Code 系 lineage，hooks/subagents 同族。CLI 实测：`--agent`/`--agents <json>`/`claude agents`（后台代理）在位。
- **skills 层判定（2026-09-07 官方 skills 页读档）**：个人 `~/.claude/skills/<name>/SKILL.md` + 项目 `.claude/skills/`，**无任意目录配置键**（`CLAUDE_SKILLS_DIR`/`--skills-dir` 不存在；`permissions.additionalDirectories` 官方明确**不**加载技能）；`--add-dir` 可额外加载所加目录内的 `.claude/skills/`（v2.1.257+ 行为，本机 2.1.220 旧版）；**subagent frontmatter 可声明 `skills` 字段=全文预载**。生成器已跟进：claude 角色文件按 Anchors 自动生成 `skills:` 字段——装机时把七技能复制/链接进 `~/.claude/skills/` 即五棒锚点全效（技能缺失时先复制再派发，防告警）。
- **装机验证重点**：`disallowedTools` 物理生效性（官方主推 `tools` 正向清单，未知键有静默忽略风险——planner 禁 Edit/Bash 需实测，guard 兜底）；hooks 注册优先级（C2 类重验）。
- **产物**：settings.json 粘贴块（matcher `Write|Edit|ApplyPatch`）+ `dist/claude-code/agents/*.md`。

## 3. kimi-code（判级最稳：机制源头 + 官方文档双实证）

- **已证实**：本机 config.toml 既有 `[[hooks]]` 实例（PreToolUse + matcher "Write|Edit"，AITrader guard-worktree）——事件名/matcher/TOML 形态在位实证；官方文档 agents 目录与 frontmatter 键全表（name/description/whenToUse/override/tools/disallowedTools/subagents）；**model 键不支持**（与未知键一并忽略）；技能扫 `~/.agents/skills/`。
- **hooks 官方页全证（2026-09-07 读档）**：[[hooks]] **仅许 event/matcher/command/timeout 四字段**（多余字段整份 config 拒载——本仓粘贴块恰为四字段 ✓）；可阻断事件集=**PreToolUse / Stop / UserPromptSubmit**（恰为三正式所需）；exit 0=放行且 stdout 追加进上下文、**exit 2=阻断且 stderr 即理由**、其余非零/超时/崩溃=默认放行（fail-open，与 guard 同语义）；JSON 阻断形态 `hookSpecificOutput.permissionDecision:"deny"` 与 CC 同族；UserPromptSubmit 的 stdout 注入=inject/report 两 hook 的官方级确认。payload 基础字段（hook_event_name/session_id/cwd）官方列名，`tool_input` 内部字段名仍留装机探针（guard 双读已兜）。
- **降级项**：rerun 变体（model 钉住）不物化——重跑路由改会话 `-m` 指定模型。
- **产物**：config.toml 粘贴块 + `dist/kimi-code/agents/*.md`；`kimi doctor` 可校验配置。

## 4. codex（判级改写最大：从"sandbox 降级"升级为"完整 hooks 宿主"）

- **判级改写依据**（16 §2 旧判级"无 PreToolUse 型阻断"作废）：官方 hooks 文档——`~/.codex/hooks.json`（用户级）+ `<repo>/.codex/hooks.json`（项目级）双层加载；事件族与 Claude Code 同型（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/SubagentStart/Stop…）；**apply_patch 触发 PreToolUse**（matcher 认 `apply_patch`/`Edit`/`Write`，输入 tool_name 报 `apply_patch`）；阻断三形态（`permissionDecision:"deny"` / `{"decision":"block"}` / exit 2+stderr）。本机 `[features] hooks = true`、`multi_agent = true`（stable，features list 实测）。
- **诚实边界**：官方自注"部分专用工具路径可退出默认 hook 路径——hooks 属护栏（guardrail）而非完全强制边界"，验收话术按护栏口径；托管工具（如 WebSearch）不触发 PreToolUse。
- **角色形态（2026-09-07 官方 subagents 页终判，第三方指南口径作废）**：`~/.codex/agents/*.toml`（个人级）或 `.codex/agents/`（项目级）一角色一文件；必填 **name / description / developer_instructions**（此前物化的 `instructions` 键名有误——生成器已纠偏重物化）；可选 model / model_reasoning_effort / **sandbox_mode**（角色级物理沙箱——生成器已为 code-reviewer/red-teamer 配 `"read-only"`，只读角色从此有 hooks 之外的第二道物理防线）/ mcp_servers / skills.config；文件名=约定、name 字段=真相；`[agents]` 表在 config.toml 仅承载全局设置（并发/默认子代理模型）。上游 #14579（项目级角色对 spawn_agent 不可见）与 #26828（schema 暴露不一致）保留为装机观察项。
- **skills 官方层（2026-09-07 config-reference 读档）**：`[[skills.config]]` path+enabled 可挂**任意目录**——`~/.agents/skills` 可直接挂载，五棒技能锚点在 codex 不再降级（装机验证项=挂载后 SKILL.md 目录形态兼容性）；技能脚本另有 `approval_policy.granular.skill_approval` 审批闸。
- **装机验证重点**：**payload 探针必做**——apply_patch 的 `tool_input` 是否含逐文件路径；若只含整块 patch 文本，guard 需加 codex 字段分支后才能绿（预期装机工作，非阻塞）。
- **环境修复备注**：本机原安装损坏（npm 未按 ARM64 解析出 win32-x64 依赖报错）；`npm install -g @openai/codex@latest` 重装拉到 codex-win32-arm64 原生包后 0.153.4 正常。

## 5. opencode（从"未证实"升级为"文档+样本双实证"）

- **已证实**：全局 agents 目录 `~/.config/opencode/agents/`（复数）+ 项目 `.opencode/agents/`；frontmatter = description(必填)/mode(`primary`|`subagent`|`all`)/model/temperature/permission，文件名即 agent 名；派发 = description 自动派发或 `@name` 显式；插件阻断 = `tool.execute.before` 内 throw；插件目录 `~/.config/opencode/plugins/` 启动自动加载（本机 GSD 框架 33 个 agent 文件 + 插件样本同构印证）。
- **skills 层实测在位（2026-09-07 CLI）**：`opencode debug skill` 子命令存在（特性在），本机输出为空=空载未配技能；技能目录配置方式待装机（`opencode debug config` 需项目上下文，本机未取到解析结果）。skills 层一旦配通，五棒锚点可不再降级——列装机验证项。
- **降级项**：`disallowedTools` 不存在——只读角色"禁写"纵深降级为 guard（物理主防线）+ 纪律；`tools` 键官方标 deprecated（`permission` 键替代为装机验证项）；UserPromptSubmit 等价事件未核验——记忆注入/分支提醒降级为"角色文件开工必检条款"。
- **产物**：`plugins/harness-guard.js`（write/edit/patch 三名集合，args 路径字段三读兜底）+ `dist/opencode/agents/*.md`。

## 6. pi-agent（从"全未证实"升级为"结构性降级适配"）

- **已证实（2026-09-07 双确认收口）**：官方示例 `examples/extensions/protected-paths.ts` 就是写路径守卫范本——`event.toolName !== "write" && "edit"` + **`event.input.path` 字段名官方实证** + `{block:true, reason}` 返回形态，与本仓 harness-guard.ts 逐点吻合（path 主读法正确）；`ctx.cwd` 为 ExtensionContext 官方文档字段。**MCP 定论**：usage.md 官方明示 "intentionally does not include built-in MCP"——basic-memory/hindsight MCP 面不可用闭案，记忆面走角色开工必检条款 + Obsidian 直读（此前"未证实"销项）。npm 包 `@earendil-works/pi-coding-agent` 0.85.1（pi.dev）；官方 README 明示 **"skips features like sub agents and plan mode"**——无原生子代理为产品设计而非缺陷；技能实现 Agent Skills 标准且**共扫 `~/.agents/skills/`**（Anchors 不降级）；原生加载 AGENTS.md；提示词模板 `~/.pi/agent/prompts/*.md` 文件名即 `/命令`。
- **降级语义表**（对齐 16 §4 思路）：子代理隔离→单会话顺序换卡（重活拆多会话接力，即 07 回退模式）；并行派发→无；rerun 变体→无（同模型）；**写入隔离→扩展 block（等价物理防线，无降级）**；MCP 无内置（官方明示）→记忆面=开工必检条款 + Obsidian 直读（定论，非降级选择）。
- **产物**：`extensions/harness-guard.ts`（write/edit 两名集合）+ `dist/pi-agent/prompts/*.md`；扩展落位 `~/.pi/agent/extensions/`（全局）或受信项目 `.pi/extensions/`。

## 7. check-env 探测升级（N18 连带修正）

- 宿主探测改双通道：`dirs` 文件系统 + `cli` PATH 探测（win32 `where` / unix `which`），任一命中即"在位"。动机是今天的一对实测教训：**pi CLI 在位但配置目录未生成 → 漏报**（首装当天未跑过 CLI）；**opencode 配置目录在位但 CLI 已不在 PATH → 虚报**。
- 五宿主 `adapted` 文案统一改写为"适配包已产出 + docs/18 §n 指针"，消除"未证实/需重设计"类过时判级。

## 8. N19 衔接（首装实测将闭合的项——2026-09-07 双确认后已大幅收窄）

1. codex apply_patch 的 payload 字段映射（guard 需否加 codex 分支）——**唯一预期要改 guard 代码的项**；agents/*.toml 派发冒烟（形态已官方终判，仅剩实跑验证 #26828 暴露一致性）。
2. claude-code `disallowedTools` 物理生效性；skills 复制进 `~/.claude/skills/` 后五棒锚点冒烟。
3. opencode `permission`/`tools` 键、记忆注入等价事件面、skills 目录配置方式。
4. kimi `tool_input` 内部字段名探针（基础字段已官方列名）；AITrader 遗留 hooks 去重后冒烟。
5. pi：`bash` 写路径是否需单独拦；guard 扩展实拦冒烟。
6. 全部结论按 08 附录口径回灌本文与 16 §2 矩阵，五宿主判级从"适配包已产出"迁到"已适配（装机日期）"。

## 9. 证据来源（2026-09-06 首轮 + 2026-09-07 双确认轮）

- 本机实测：`claude --help`（--agent/--agents/--bare 面）/ `kimi doctor`（config 全绿）/ `codex features list` / `opencode --help`+`debug skill`+`agent list` / `pi --help`；`~/.kimi-code/config.toml` 既有 hooks 实例；`~/.config/opencode/{agents,plugins}` GSD 样本；codex 官方包平台依赖（npm view optionalDependencies）。
- 官方文档：**2026-09-07 轮**——Claude Code skills 页（目录/无任意目录键/--add-dir/subagent skills 预载）；Kimi hooks 页（事件全集/四字段严格/exit 2/fail-open/payload 基础 schema）；Codex config-reference + **subagents 页（角色文件终判形态）**；pi 包内官方文档与示例（extensions.md ctx.cwd、examples/extensions/protected-paths.ts、usage.md 无内置 MCP 明示）；OpenCode CLI 实测（debug skill/agent list）。**2026-09-06 轮**——Kimi `llms-full.txt`（agents/skills 目录与 frontmatter 全表）；Codex hooks 页（hooks.json/事件/阻断/工具覆盖表）；OpenCode plugins/agents 页；pi 包内 docs（extensions/skills/prompt-templates）。
