# 02 · 团队核心：六角色流水线的 ZCode 移植方案（四角色移植 + archiver 与 red-teamer 新增）

> 资产来源：AITrader 四角色团队（Kimi Code，v1.2，2026-08-30 真实工单验证通过）
> 原方案：`C:\Forex\Project\AITrader\docs\team\kimi-code-agent-team-plan.md`
> 本文只讲**移植到 ZCode 的差异与动作**；角色行为规范、流水线逻辑、验证制度全部原样继承，不重述。

## 1. 为什么四角色是团队核心

四角色流水线（planner → developer → code-reviewer → qa-tester → 增量快审 → 人合并）已在外汇换算 CLI 双 ticket 真实工单上端到端验证：写入隔离、共享记忆流转、spec 防篡改、依赖链、增量快审全部实测通过。它实现了 Harness 文章 "3+1 Phase" 的 Plan / Code / Deliver 三个阶段（对齐表见 01 文档第 5 节），是本体系已验证的最重资产——**不重造，只移植**。

唯一缺口：文章的四类角色分工是 Planner / Generator / Evaluator / **Archiver**，AITrader 只覆盖前三类，Archive 阶段（归档提交、记忆回写、知识沉淀、清理）由 main agent 隐式兼任——无角色文件、无交付物清单、不可审查。本体系将其显式化为**第五角色 archiver（沉淀官）**，见第 5 节；至此与文章分工一一对齐。

## 2. 移植映射总表（Kimi Code → ZCode）

| 机制 | AITrader（Kimi Code） | ZCode 移植目标 | 差异与动作 |
|---|---|---|---|
| 角色文件 | `.kimi-code/agents/*.md`（项目级） | `~/.zcode/agents/*.md`（**仅用户域，Beta 无项目级**） | ① 位置变了：模板存本仓库 `templates/agents/`，一次性复制到用户域；② frontmatter 键名 camelCase（见第 3 节）；③ 硬约定仍必须写进角色文件本身（ZCode 子代理默认注入 AGENTS.md，`injectAgentsMd: true`，比 Kimi 好——但按 Phase 2 教训仍不依赖它） |
| 角色派发 | Agent 工具 `subagent_type=<角色名>`，实测成立 | ZCode Agent 工具同样支持 `subagent_type`；也可用 `@角色名` 显式引用 | **P0-4 实测**：派发、回收最后一条消息、后台运行三件事 |
| 约束差异 | — | ZCode 子代理默认注入工作区 AGENTS.md（`injectAgentsMd: true`，官方文档；键名待 P0-4 实测） | 比 Kimi 的子代理完全隔离好——但按 Phase 2 教训，硬约定仍必须写进角色文件本身，不依赖注入 |
| 工具禁用 | frontmatter `disallowedTools`（实测物理生效） | 同名键 `disallowedTools`（camelCase，字段存在） | **P0-4 实测**：planner 禁 Edit/Bash、reviewer 禁 Write/Edit/Bash 是否物理生效 |
| 写入隔离 hook | `guard-worktree.mjs` 挂 PreToolUse（Kimi config.toml 注册） | 同脚本挂 ZCode `PreToolUse`，注册进**用户级** `~/.zcode/cli/config.json` → `hooks.events`（2026-09-02 C2 起；执行位 `~/.zcode/hooks/harness/` 2026-09-07 上收用户域），且必须 `hooks.enabled: true` | ① payload schema（Kimi 实测 `tool_input.path`，ZCode 实测 `tool_input.file_path`，脚本双读）；② matcher 必须覆盖 ApplyPatch 调用——`Write\|Edit` 已覆盖，**加写 `\|ApplyPatch` 为防御冗余**（P0-3 实测 Edit 命中）；③ exit 2 阻断语义 ZCode 官方文档确认支持 |
| 记忆注入 hook | `inject-memory.mjs` 挂 UserPromptSubmit，session_id 节流 | 同事件挂 ZCode `UserPromptSubmit`，stdout 走严格 JSON（`additionalContext` 字段）注入上下文 | ① ZCode stdout 解析为严格 JSON schema（多键即校验失败）——脚本输出必须包成 `{"additionalContext":"..."}`；② **marker 机制必须同步移植**：Kimi 版靠 `<项目>/.kimi-code/memory-project` 标记文件读项目名（缺失则静默退出、永不注入）——移植版改为 `.zcode/memory-project` 并在迁移手册创建；tmp 节流标记前缀 `kimi-memo-injected-` 改 `zcode-memo-injected-`；③ 原脚本用 `process.cwd()` 定位 marker，ZCode hook 进程 cwd 未验证——脚本优先读 payload 的 cwd 字段（P0-3 探测） |
| 未合并分支提醒 hook | `report-worktrees.mjs` 挂 UserPromptSubmit | 同事件移植并**扩展双态**（qa 独立分支特例已废除，只扫 feat/*）：`--no-merged` 的 feat 分支 → 提醒合并待决：活跃链路按质量门继续推进（gates 全绿 auto-merge 留痕），门不全绿、链路停滞或拟废弃由人裁决（废弃归档仍须人明确授权后 archiver branch -D + 废弃流程）；已 `--merged main` 仍存留的 feat 分支 → **提醒派 archiver 归档**（"已合并但未清理" = 待归档信号；archiver SOP 第 8 步删分支后提醒自动消失，即归档闭环）；历史遗留 qa/* 分支仅提示人工清理，不构成流程状态 | ① 输出格式适配 ZCode 严格 JSON（同 inject）；② 脚本扩展在 AITrader 版基础上加一段 `git branch --merged main` 检查，Phase 1 随三件套一起移植 |
| hook 注册位置 | 用户级 `~/.kimi-code/config.toml` | **用户级** `~/.zcode/cli/config.json`（2026-09-02 C2 实测：同事件用户级/项目级并存时项目级被覆盖丢弃；全项目一次部署）；**执行位同在用户域** `~/.zcode/hooks/harness/`（2026-09-07 上收，不指向仓库目录）——注册文件与执行位均在仓库外，Agent 的写入防护靠 **guard 自防御条款**（SHIELD 表无论 cwd 一律阻断，详见 05 §3） | 注册模板见 `templates/user-config-hooks-template.json`（`__HOME__` 替换为展开后的用户主目录）；项目级 `.zcode/config.json` 只承载 MCP（`templates/zcode-config-template.json`） |
| basic-memory MCP | 项目级 `.kimi-code/mcp.json`（`mcpServers` 键） | 项目级 `.zcode/config.json` → `mcp.servers`（嵌套键；`.agents/mcp.json` 的 `mcpServers` 为兼容回退） | 键结构不同，见模板；ZCode 所有作用域 MCP 自动连接（无 Kimi 的 trust folder 手动步骤） |
| worktree 隔离 | `git gtr`（git 别名注册，跨 session 稳定） | 原样复用（机制与 CLI 无关） | 无动作；`git config --global alias.gtr ...` 已在位 |
| 规划纪律 | mattpocock/skills @ `~/.agents/skills/` | 原样复用——**ZCode 与 Kimi 扫描同一目录** | 无动作（零成本双工具共享，这是选 `~/.agents/skills` 做技能主场的直接收益） |
| 流水线约定 | 项目 `AGENTS.md`（guard 阻断 Agent 改写） | 同样写进目标项目 `AGENTS.md`（本仓库模板已含） | 无差异 |

## 3. 角色文件 frontmatter 差异（Kimi → ZCode）

| Kimi 字段 | ZCode 字段 | 说明 |
|---|---|---|
| `name` / `description` | 同名 | 均必填；缺失时 ZCode **有诊断提示**（官方文档说法，实际表现以 P0-4 实测为准；Kimi 是静默拒收）；description 仍用中文描述 + 英文技能名锚点，含冒号的值加双引号（YAML 铁律沿用） |
| `whenToUse` | 无此键（不识别则忽略） | 并入 description 语义 |
| `tools` / `disallowedTools` | 同名（camelCase 一致） | ZCode 中自定义 tools 列表为穷举，MCP 工具须写全名 `mcp__<server>__<tool>`，通配符无效（官方文档；P0-4 复核） |
| — | `model` / `thoughtLevel` / `maxTurns` / `injectAgentsMd` / `mcpServers` / `color` | ZCode 新增可选键；v1 不用（planner/reviewer 未来可试 thoughtLevel 提升审查质量，记入 Phase 3 优化项） |
| `Anchors:` 在 description 内 | 同 | 沿用 AITrader 的锚点关键词模式 |

六个角色的 ZCode 版文件已写好：`templates/agents/{planner,developer,code-reviewer,qa-tester,archiver,red-teamer}.md`（前四个继承 AITrader v1.2 定稿，仅改 frontmatter 与编排说明；archiver 见第 5 节、red-teamer 见 5b 节；另三个 `*-rerun` 变体由 `templates/tools/generate-role-variants.mjs` 从 base 物化，编译产物勿手改）。

## 4. 编排模式

- **主模式：半自动编排**（已在 Kimi 实测成立，ZCode 待 P0-4 确认）——主会话通过 Agent 工具以 `subagent_type=<角色名>` 派发，回收最后一条消息作为交付物；main agent 是纯编排者，Archive 阶段派发第五角色 archiver 执行（见第 5 节）。
- **回退模式：人肉接力**——若 ZCode 派发能力有变，各角色独立会话依次启动，输入包（spec 路径 / diff 快照路径 / 审查结论）从上一棒交付物复制，流水线逻辑不变。
- **并行纪律**（原样继承）：只读调研类可并行多派；写代码类必须一任务一 worktree；子代理不能再派子代理（ZCode 限制，与 Kimi 相同）。
- **按需角色**：security-auditor / error-detective / docs-architect / performance-engineer 四个备用角色，Phase 2 按需移植（模板暂不含，从 AITrader `.kimi-code/agents/` 复制改 frontmatter 即可）。其中 docs-architect 与 archiver 的分工见第 5 节边界表。

## 5. 第五角色 archiver（沉淀官）：补齐文章的 Archive 位

**为什么新增而不是继续让 main agent 兼任**：① 与文章 Planner/Generator/Evaluator/Archiver 四类分工一一对齐；② 归档是纪律活（顺序错一步就留脏数据——AITrader 两次实测教训），独立、空闲的子代理上下文比忙碌的编排者更稳；③ 本体系新增的沉淀职责（Obsidian 工作区草稿、metrics 代录、记忆卫生）需要专属 Owner；④ 有角色文件就有交付物清单，归档质量变得可验证、可审计（04 文档"归档闭环率"指标有了责任人）。

**职责边界**：

| 维度 | archiver（沉淀官） | 其他角色/人 |
|---|---|---|
| 做什么 | 工单收尾八步 SOP（见角色文件 `templates/agents/archiver.md`） | planner 管 spec 正文与修订；developer 管代码；reviewer/QA/red-teamer 管质量门结论；**合并按质量门规则**：符合自治链票型且 gates 全绿时，由 main agent 按既定规则 auto-merge；门不全绿、永久人闸票和例外事项由人裁决 |
| 不做什么 | 零业务代码、零质量判断、不改 spec 正文（只允许更新 ticket 状态字段）、不合并分支 | — |
| 物理约束 | 无工具禁用（需要 Bash/Edit/Write 执行提交与清理）；主检出写入被 guard 白名单限定在 `docs/` 等目录，业务代码物理碰不到 | reviewer 只读（tools 正向清单）；planner 禁 Edit/Bash |
| 触发时机 | 合并完成后（auto-merge 与人执行合并两径皆同），main agent 携 ticket slug + 合并 commit hash 派发 | developer 的修复轮触发不了它（request changes 退回 developer，不走归档） |
| vs docs-architect（按需角色） | **每工单**的轻量归档（日常、流水线常驻） | docs-architect 做**里程碑/季度**的深度整理（basic-memory 修剪、文档体系重构、工作区草稿批量归位协助）——日常与深扫互补，不重叠 |

角色文件：`templates/agents/archiver.md`（含完整边界/约束级别标注/SOP 顺序/交付物清单；Phase 1 真实工单验证）。

**归档阶段的 hooks 自动化**：report-worktrees hook 扩展为双态提醒——存在已合并未清理的 feat 分支时，每条用户消息注入"待归档"提醒，推动 main agent 派 archiver；archiver 清理分支后提醒自动消失（闭环信号）。两个边界必须知道：① **hook 只提醒、不执行**——hook 不决定合并、不执行归档、不新增审批门；合并按质量门规则，合并完成后 main agent 派 archiver；② **事件唯一选项是 UserPromptSubmit**——ZCode 官方仅七事件，**不含 SubagentStop**（Kimi 版靠它做 subagent 完成提醒，ZCode 没有这个事件；且 Kimi 已实测 SubagentStop 的 stdout 不注入主会话）。后人照 Kimi 版"优化"回 SubagentStop 即失效。另注：分支清理≠归档完成（人可手动删分支绕过提醒），故 04 文档"归档闭环率"指标是第二道信号。

## 5b. 第六角色 red-teamer（对抗审查官）：合并前最后门禁

2026-09-03 对"并入 reviewer / 前移 QA / 维持独立"做了三方证据论证（全文见 10 文档，结论=**维持独立、位置在 QA 后合并前**）。要点：

- **定级条款（宪法 5a）**：planner 立项时定 `red-team: full / fast / skip`；full 可两路并行（实证路+安全部署路，模型可异构）；fast=code-reviewer 追加攻击清单；skip=琐碎票。安全/数据类 P0 强制返工阻断（人可覆写留痕）
- **七攻击面**（边界/并发/数据/失败级联/隐含假设/安全/性能），只读零派发；与 code-reviewer 分工=reviewer 对照 spec 查"做没做对"，红队攻击"还会怎么坏"
- **实战**：三票 full 命中零重叠（发现均在 review+QA 盲区）；OPT-3 交付件=角色文件 + 定级条款 + 宪法模板 5a（`templates/agents/red-teamer.md`、AGENTS-template）

## 6. 移植后必须重验的清单（P0-4 / Phase 1 验证项）

- [ ] `~/.zcode/agents/planner.md` 放置后新开会话，planner 出现在可派发清单（Settings → Subagents 可见）
- [ ] Agent 工具 `subagent_type=planner` 派发成功，最后一条消息可回收
- [ ] planner 调用 Edit/Bash 被拒（disallowedTools 物理生效）
- [ ] code-reviewer 派发态暴露 Read/Grep/Glob/Skill，且能实际调用 code-review 技能（与 06 P0-4④ 同口径）
- [ ] guard hook 阻断主检出写入并提示 gtr 三选一命令（P0-3 探测后校准的脚本）
- [ ] 大小写混合路径仍被阻断（`.toLowerCase()` 归一化保留）
- [ ] AGENTS.md 写入被阻断（流水线宪法只能人改）
- [ ] basic-memory MCP 自动连接，`mcp__basic-memory__*` 工具可见，`--project` 命名空间正确
- [ ] 真实小工单走完六角色全流程（复刻 Test04 双 ticket 验证的最小版本 + archiver 归档八步）
- [ ] 归档提醒闭环：构造已合并未清理的 feat 分支 → 下条用户消息出现"待归档"提醒 →
      派 archiver 归档 → 分支清理后提醒消失

## 7. 语言与命名约定（原样继承）

**spec 粒度变体（2026-09-05 审计回灌）**：单票单 spec 或总 spec+分 ticket（如 web2api peer-practice-adoption r1-r6 承载四票）皆合法，粒度由 planner 定；修订号链与 changes 三段链义务不变。

自然语言层中文（角色沟通、spec、审查报告、QA 结论、记忆库），机器标识层英文（代码、路径、分支名 `feat/<slug>`、技能名、commit message）。一切命名锚定 ticket 英文 slug：分支、diff 快照（`<slug>-r<n>.diff`）、QA 报告、记忆条目、Obsidian 工作区草稿；**hindsight bank 例外**——按项目自动派生（见 03 §2.4），勿手工建 bank，条目内容注明来源 slug。
