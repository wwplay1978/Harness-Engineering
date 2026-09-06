# 00 · 文档索引（本仓库导航唯一来源）

> 本文件是本仓库的**导航唯一事实来源**。**公开版说明**：本仓库为能力迁移精选发布版——docs/06/08–14（历史路线图/P0 实测日志/优化与审计过程记录/memory 笔记）属内部工程档案未随发布；文中引用这些编号处（C1–C3、08 §P0-2 等）为内部档案锚点，不影响使用。另含固定泛化差异：内部仓库名与机器路径统一写作 REPO/本仓库（REPO 默认建议 `C:\Harness-Engineering`，即本仓 clone 位），安装类命令一律给可直接运行形态（07 第 0 步表的"✅ 已在位/已部署"状态列为首发机器历史快照，读者机器以实际执行结果为准）。（2026-09-03 起从根 README 迁入——README 仅保留入口指针，从而新增文档不再需要人工改根级宪法文件；本文件在 guard 白名单 `/docs/` 内）。
> 建立日期：2026-09-02 ｜ 索引迁移：2026-09-03

## 一句话体系

**Agent = Model + Harness。** 模型不可控，Harness 可控——把"好代码"标准写进系统里，让 AI 在约束下自己干活；流水的工具，铁打的规范。
理念来源：OpenAI《Harness Engineering: Leveraging Codex in an Agent-First World》（[原文](https://openai.com/index/harness-engineering/)）

## 文档导航

| 文档 | 内容 | 对应能力支柱 |
|---|---|---|
| [01-harness-concepts.md](01-harness-concepts.md) | 理念提炼、总体架构、组件映射表、规范分层 | 全部（总纲） |
| [02-team-core.md](02-team-core.md) | 六角色流水线的 ZCode 移植方案（团队核心：四角色移植 + archiver 与 red-teamer 新增） | 任务编排与多 Agent 协作 |
| [03-memory-hindsight-obsidian.md](03-memory-hindsight-obsidian.md) | 四层记忆架构、hindsight 整合评估、Obsidian 知识库 | 状态与记忆 |
| [04-eval-observability.md](04-eval-observability.md) | L1–L4 质量门禁、harness-audit 自检、度量指标 | 评估与观测 |
| [05-guardrails-recovery.md](05-guardrails-recovery.md) | 红线清单、guard hooks 移植、恢复预案 | 约束与恢复 |
| [06-roadmap.md](06-roadmap.md) | 历史路线图（已被 12 取代，保留存档） | 落地 |
| [07-migration-playbook.md](07-migration-playbook.md) | 新项目启用清单（复制 + 配置六步） | 落地 |
| [08-p0-field-log.md](08-p0-field-log.md) | P0 实测记录（✅ 全绿，含 C1–C3 架构结论） | 落地证据 |
| [09-optimization-plan.md](09-optimization-plan.md) | 优化方案：服务化 / 分级模型 / 红队角色（含风险分级） | Phase 1.5 议程 |
| [10-role-architecture-analysis.md](10-role-architecture-analysis.md) | 红队角色架构论证（结论：第六角色独立、QA 后合并前，full/fast/skip 定级） | 架构决策记录 |
| [11-opt2-implementation.md](11-opt2-implementation.md) | OPT-2 分级模型实施记录（✅ 全绿） | 实施记录 |
| [12-status-roadmap.md](12-status-roadmap.md) | **项目状态与路线（活文档，当前权威快照）** | 状态与下一步 |
| [13-metrics-review-1.md](13-metrics-review-1.md) | 指标复盘（滚动·每 5 票；红队 3/3 零重叠固化） | 度量闭环 |
| [14-gap-analysis.md](14-gap-analysis.md) | 双文对照差距分析（22 项：16✅/6⚠️/2 缺口；采纳 N11/N12） | 对照与决策记录 |
| [15-toolchain-portability.md](15-toolchain-portability.md) | 工具链清单与可移植性（缺失降级矩阵/AITrader 适配/跨机安装） | 迁移必读 |
| [16-host-agnostic-installer.md](16-host-agnostic-installer.md) | 宿主无关化与三段式安装器（检测→安装→适配；installer/ 工具） | 迁移必读 |
| [17-agent-assisted-install.md](17-agent-assisted-install.md) | Agent 辅助安装方案（目标机 agent 提示词：人机分工协议+八步骨架） | 迁移必读 |
| [18-host-adapters.md](18-host-adapters.md) | 五宿主适配包（claude-code/kimi-code/codex/opencode/pi-agent 判级证据+适配产物+装机验证清单） | 迁移必读 |

## 模板（迁移时复制）

| 模板 | 用途 | 目标位置 |
|---|---|---|
| [../templates/AGENTS-template.md](../templates/AGENTS-template.md) | 工作区 AGENTS.md（≈100 行索引式） | 目标项目根 `AGENTS.md` |
| [../templates/zcode-config-template.json](../templates/zcode-config-template.json) | 工作区 .zcode/config.json（纯 MCP；hooks 已上收用户级，C2 结论） | 目标项目 `.zcode/config.json` |
| [../templates/user-config-hooks-template.json](../templates/user-config-hooks-template.json) | 用户级 hooks 注册形态（guard/inject/report 三正式脚本） | `~/.zcode/cli/config.json`（参考） |
| [../templates/agents/](../templates/agents/) | 六个角色子代理文件（ZCode 格式：四角色移植 + archiver + red-teamer；另 3 个 *-rerun 变体由生成器物化） | `~/.zcode/agents/`（用户域，全局一次；sync-harness.mjs --apply 分发） |
| [../templates/hooks/](../templates/hooks/) | guard/inject/report 三正式 hook 脚本（含真实 schema 适配） | 用户级 hooks 目录（参考部署形态） |
| [../templates/adapters/](../templates/adapters/) | 五宿主适配包（物化器 + hooks 粘贴块 + opencode/pi guard 移植；docs/18） | 逐宿主见 templates/adapters/<host>/README.md |

## 作用域约定（重要）

- **用户域安装（全局一次）**：工具（uv、hindsight、basic-memory）、技能（`~/.agents/skills/`）、插件（hindsight-zcode）、六个 hook（`~/.zcode/cli/config.json`）、六个角色子代理文件 + 3 个 *-rerun 变体（`~/.zcode/agents/`，sync-harness.mjs 分发）。
- **本仓库（规范与模板）**：所有规范 md 与配置模板随 git 版本化，是唯一事实来源；改规范先改这里，再分发。
- **业务项目（按需复制）**：`AGENTS.md`、`.zcode/config.json`（仅 MCP）、`docs/` 子目录约定——迁移手册六步完成。

## 与既有资产的关系

- **AITrader 四角色团队（Kimi Code）**：AITrader 是另一个独立项目目录，跑在 Kimi Code CLI 上。本仓库把它的机制（角色文件、guard hooks、流水线约定）**提炼成 ZCode 模板**，但**不迁移、不改造 AITrader 本身**——该项目继续在 Kimi Code 上运行。两边是"同一套规范的两个运行现场"：规范修订以本仓库为准；AITrader 是否跟进由人决定、人工同步，两边互不自动覆盖。
- **用户域 AGENTS.md（九项原则）**：体系的"宪法层"（User Rules），本仓库所有规范不得与之冲突。

## 维护约定

- **新增文档**：在 `docs/` 建文件 → 在本文件导航表加一行 → 提交。不再涉及根 README（人改频率归零）。
- 规范变更 → 改本仓库文档 → 提交 → 按迁移手册同步到目标项目。
- 每季度跑一次 harness-audit（见 04 文档）给体系打分，S/A/B/C/D 分级驱动改进。
