# 05 · 约束与恢复：三级约束、红线清单与恢复预案

> 原则：约束分三级——能物理强制的绝不靠自觉（宪法层原则的执行面）；恢复永远有下一步。

## 1. 三级约束体系

| 级别 | 机制 | 本体系承载 | 失效后果 |
|---|---|---|---|
| **硬约束（物理强制）** | ZCode hooks（PreToolUse exit 2 阻断）+ 子代理 disallowedTools | guard-worktree（写入隔离）、reviewer 只读、AGENTS.md 防改写 | 直接拦下，**但有已知盲区：guard 只挂 Write\|Edit\|ApplyPatch，不拦 Bash——`echo > src/x.js`、`sed -i` 等 bash 写入可绕过**（AITrader 继承缺口，见 §3 补偿措施；"直接拦下"只对工具型写入成立，不得理解为完备防护） |
| **软约束（提示词承诺）** | 角色文件行为条款 + Skills 纪律 + AGENTS.md 约定 | reviewer 输入白名单（只看 spec+diff）、QA 不改业务代码 | 违规靠抽查发现，升级路径明确 |
| **安全策略（人治红线）** | 红线清单 + 人工门禁 | 合并决策、密钥管理、知识库回写审核 | 违反即流程事故 |

软约束升级规则（继承 AITrader 附 3）：软约束若在抽查中两次被突破，升级为 hook 物理强制（如 reviewer 白名单 → Read 路径 hook）。

## 2. 红线清单（不可越过）

1. **先 Spec 后 Code**——无 spec 不派 developer（小修至少有 ticket 验收标准）。
2. **合并决策永远是人**——任何 Agent 不得 merge 到 main；只合 `feat/<slug>` 一个分支。
3. **AGENTS.md 只能人改**——guard 白名单不含 AGENTS.md；流水线宪法同规（本仓库规范亦然）。唯一豁免=**安装窗口首次落位**（2026-09-08 起：安装助手按问答渲染、人复核即人授权，见 17 §3 S5 与 §4 安装窗口说明；落位后本条即刻恢复，无其他例外）。
4. **一 ticket 一 worktree**——写代码必须在 `git gtr` 隔离工作区，主检出写入被 hook 阻断。
5. **命名锚定 slug**——分支 `feat/<slug>`、快照 `<slug>-r<n>.diff`、bank、记忆条目，全链路可对账。
6. **spec/tickets 防篡改**——worktree 内不得改 `docs/specs/`、`docs/tickets/`；合并前 diff 检查为空（reviewer 一票 blocking）。
7. **密钥不入库**——不进 git、不进记忆系统（hindsight 开 Memory Defense）、不进 spec 明文。
8. **验证不勾不宣称完成**——验证清单是完成定义的一部分。

## 3. guard hooks 移植（Kimi → ZCode 差异）

guard-worktree.mjs 的逻辑（路径归一化 `\\`→`/` + `.toLowerCase()`、`root + '/'` 前缀比较防兄弟目录误判、零反斜杠写法）**原样保留**，白名单按下表调整后移植：

**白名单差异与威胁模型（2026-09-02 对抗性审查裁决；2026-09-07 执行位/注册上收用户域后修订，必须读）：**

| 项 | Kimi 版（AITrader） | ZCode 版（本体系） | 理由 |
|---|---|---|---|
| hook 注册文件 | 用户级 `~/.kimi-code/config.toml`（仓库外） | **用户级** `~/.zcode/cli/config.json`（仓库外；2026-09-02 C2 实测起——同事件用户级/项目级并存时项目级被覆盖丢弃） | C2 前曾用项目内 `.zcode/config.json`（注册文件落进 Agent 可写范围）；C2 后注册上收用户级 |
| 白名单 | `['/docs/', '/.kimi-code/', '/context.md']` | **`['/docs/', '/memory/', '/context.md', '/templates/']`**（templates/ 仅 harness 仓库自身需要，2026-09-06 加） | ① Agent 无合法需求改注册文件或 hooks 脚本（人负责）；② `/memory/` 加入白名单：archiver 需要写 basic-memory 项目记忆库；③ `/context.md` 保留——工作区 AGENTS.md 文档地图可引用项目级 CONTEXT.md（planner 的 grill-with-docs 产出），AITrader 已有先例 |
| **自防御条款（2026-09-07 新增）** | 无（Kimi 注册在仓库外，当时无对等机制） | guard 的 **SHIELD 表**：各宿主 hooks 执行位（`~/.zcode/hooks/harness/` 等）+ 注册文件（`~/.zcode/cli/config.json`、`~/.claude/settings.json`、`~/.kimi-code/config.toml`、`~/.codex/hooks.json` 与 `config.toml`）——无论 cwd，Write/Edit/ApplyPatch 一律 exit 2；路径 `homedir()` 运行时计算（禁硬编码机器路径） | 注册文件与执行位均在仓库外，root 前缀逻辑对它们**不设防**——旧形态下 Agent 可直接改写 config 关闭 hooks（docs/08 回灌的现存漏洞，本条款补上）。检查必须置于 root 前缀判断**之前**，否则被"不在主检出→放行"先吃掉 |
| 配套后果 | — | 用户级注册与 `~/.zcode/hooks/harness/` 执行位**只能人改**；Agent 试图修改（Write/Edit/ApplyPatch 面）被自防御条款拦下——这是设计行为，不是 bug。Bash 盲区沿用下方补偿 | 与 AGENTS.md 同等待遇（流水线宪法类） |

其余三处适配：

| 项 | Kimi（AITrader 实测） | ZCode 移植 | 动作 |
|---|---|---|---|
| payload 字段 | `tool_input.path`（可能是相对路径） | **待 P0-3 探测**（ZCode 为 Claude 系，可能是 `file_path`；脚本按 `path ?? file_path` 双字段兼容即可） | 探测后校准 |
| matcher | `Write\|Edit` | `Write\|Edit\|ApplyPatch`（官方别名方向为 `Write/Edit ← ApplyPatch`，理论上前两个已覆盖；加写 ApplyPatch 为防御冗余，以 P0-3 实测为准） | 改 matcher |
| Bash 盲区补偿 | 无（Kimi 版同样存在） | ① 合并前检查：本单时间窗内 `git log main --oneline --no-merges` 逐条对照下方"main 直接提交白名单"；② Bash 命令模式 hook（拦 `>`/`sed -i` 等写主检出模式）列为 Phase 2 加固项 | AGENTS 模板第 6 步 + 06 Phase 2 |

**main 直接提交白名单**（①的判定标准）：main 上仅允许三类非 merge 提交——`chore: archive*`（archiver 归档提交）、`docs: spec*`（spec/tickets 首次入库与升版）、`docs: agents*`（**宪法/AGENTS 修订**：人授权后由 main agent 代提交，commit message 须注明人授权依据——2026-09-05 审计回灌：无此通道则每次宪法演进都成技术性越权，稀释检查信号）。**第四类例外（2026-09-06 web2api 宪法 r4 首立，模板已随附）**：人在场明确授权的一次性直提，commit message 须尾注 `committed on user authorization <日期>`——无此留痕即按越权计。出现白名单外直接提交即越权。注意不得用固定 `-5` 窗口——多单归档后越权提交会被挤出窗口恒绿；以本 ticket 时间窗为界。
| 注册与阻断 | config.toml + exit 2 实测成立 | 用户级 `~/.zcode/cli/config.json` → `hooks.events.PreToolUse` + `hooks.enabled: true` + exit 2 阻断（官方文档确认语义；执行位=`~/.zcode/hooks/harness/`，2026-09-07 上收用户域） | 用模板配置 |

配套 hooks 一并移植（输出格式适配 ZCode 的严格 JSON stdout schema，见 02 文档映射表）：

- `inject-memory.mjs`（UserPromptSubmit，basic-memory 近 7 天团队记忆注入，session 节流）；
- `report-worktrees.mjs`（UserPromptSubmit，双态提醒，只扫 feat/*：有未合并 feat 分支→提醒人合并决策或走废弃归档；有已合并未清理的 feat 分支→提醒派 archiver 归档；两者皆无时静默。归档闭环的物理信号 = 分支与 worktree 被 archiver 清理；历史遗留 qa/* 分支仅提示人工清理）。

**Windows 工艺纪律全部继承**（AITrader 用真金白银换的教训）：hook 脚本零反斜杠写法；路径比较前归一化 + 小写；模拟测试 payload 的 cwd 用 `cygpath -m` Windows 形态；指令禁用尖括号占位符；新会话生效类配置必须拆两条指令由人开新会话。

## 4. 恢复预案（Residence of last resort）

| 故障场景 | 恢复手段 | 演练时点 |
|---|---|---|
| AI 改坏代码 | worktree 分支丢弃（`git gtr rm --force`）；主检出从未被写（guard 兜底）——git 即快照 | Phase 1 验证项 |
| 会话中断/上下文丢失 | ZCode `ReadSessionContext`（#sess 交接）+ handoff skill（`~/.agents/skills/handoff`）+ `docs/changes/<slug>.md` 变更记忆（未归档的 spec 变更先落这里） | Phase 1 验证项 |
| hindsight 服务宕机 | hooks fail-open（P0-2 必验）→ 退化为 ZCode 内建记忆 + git 工件，编码不中断；服务恢复后自动续用 | P0-2 |
| 记忆被污染/过期 | bank 级处置：Control Plane 删除条目或整 bank 重建（git 工件与 Obsidian 是真源，可承受重建）；定期抽查制度见 04 文档 | Phase 2 |
| spec 被质疑 | spec 修订号机制（r1/r2…）+ `docs/changes/` delta 追溯；reviewer 的"spec 问题"回退通道 | 继承 AITrader，已实测 |
| 规范本身出错 | 本仓库 git 历史回滚；分发后目标项目按迁移手册重同步 | 随本仓库 git init 生效 |
| 误合并 | `git revert` + 合并结论记忆更正 + 工单复盘进知识库 | 按需 |

**Checkpoint 纪律**（宪法层原则 7）：每棒交付物即检查点——planner 的 spec、developer 的分支+commit hash、reviewer 的报告、QA 的结论、归档提交，链条任一环节可从上一检查点重放。
