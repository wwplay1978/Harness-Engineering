# 00 · 文档索引（本仓库导航唯一来源）

> 本文件是 Zcode_T1 harness 仓库的**导航唯一事实来源**（2026-09-03 起从根 README 迁入——README 仅保留入口指针，从而新增文档不再需要人工改根级宪法文件；本文件在 guard 白名单 `/docs/` 内）。
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
| [12-status-roadmap.md](12-status-roadmap.md) | 项目状态与路线（**历史快照 2026-09-13**——缺 19–21 落地后内容；当前状态以本索引与 git log 为准） | 项目档案 |
| [13-metrics-review-1.md](13-metrics-review-1.md) | 指标复盘（滚动·每 5 票；红队 3/3 零重叠固化） | 度量闭环 |
| [14-gap-analysis.md](14-gap-analysis.md) | 双文对照差距分析（22 项：16✅/6⚠️/2 缺口；采纳 N11/N12） | 对照与决策记录 |
| [15-toolchain-portability.md](15-toolchain-portability.md) | 工具链清单与可移植性（缺失降级矩阵/AITrader 适配/跨机安装） | 迁移必读 |
| [16-host-agnostic-installer.md](16-host-agnostic-installer.md) | 宿主无关化与三段式安装器（检测→安装→适配；installer/ 工具） | 迁移必读 |
| [17-agent-assisted-install.md](17-agent-assisted-install.md) | Agent 辅助安装方案（目标机 agent 提示词：人机分工协议+八步骨架） | 迁移必读 |
| [18-host-adapters.md](18-host-adapters.md) | 五宿主适配包（claude-code/kimi-code/codex/opencode/pi-agent 判级证据+适配产物+装机验证清单） | 迁移必读 |
| [19-constitution-config-split.md](19-constitution-config-split.md) | 宪法与配置分离 v3（零参数宪法+三级配置中心+四阶段在装项目升级手册——已裁决 D1/通用默认合一 50/60/70） | v3 实施 |
| [20-autonomous-merge.md](20-autonomous-merge.md) | 自治流水线（两端人闸+gates 全绿 auto-merge+方案红队前置门 §2.5——红线修订已获确认） | v3 实施 |
| [21-memory-system-analysis.md](21-memory-system-analysis.md) | 记忆管理机制分析（机制层视角：长期/短期/参数三视角 × 抽取/管理/存储/检索四环节 + 五宿主记忆面分级；ZCode 内建记忆移入宿主附加层） | 状态与记忆 |

## 文档身份分类（2026-09-28 起，导航表的前置滤镜）

同仓 ≠ 同类。本仓文档分四种身份（判别口径与判定原则见 [21 号 §0](21-memory-system-analysis.md)）：

| 身份 | 含义 | 本仓文档 |
|---|---|---|
| **A 机制规范** | 约束消费项目的规则，随分发生效 | 01、02、03、04、05、07、16、17、18、19、20、21（各篇含少量首宿主/本机实例段落，以各篇口径声明与 21 §0 判定为准） |
| **A-host 宿主适配** | 单宿主接线形态与判级（verified / unverified） | 18 主体 + `templates/adapters/<host>/README.md` |
| **B 项目档案** | 本仓自身建设记录（快照/存档） | 06（历史路线）、08（P0 实测）、09、10、11、12（2026-09-13 快照）、13、14 |
| **工件** | 本仓工单过程资产，非机制组件 | `docs/changes/`、`docs/reviews/`、`docs/metrics.md` |

## 挂起与后续票（backlog，完成即删行）

| # | 事项 | 来源 |
|---|---|---|
| B1 | **门 B 白名单 × 开发仓 dogfood 模型适配**：pre-merge-check.mjs 门 B 的 main 直提白名单是消费项目口径（chore: archive* / docs: spec* / docs: agents* / 授权尾注），与 19 §11 限定 dogfood 的"日常小修直提"并存会让每张 dogfood 票撞历史红（首例 models-local-binding：门 B 红系 09-23 批+09-28 处置批历史直提，人闸合并留痕）。方向：门 B 识别 dogfood 语义（小修类直提放行+留痕）或并入第四类授权尾注惯例。**二轮审查 P1-3 增强：票内须给出机器可执行裁判方案（独立门 B profile / 直提强制授权尾注 / 显式分类标签文件三选一），禁止仅凭"历史红"文字放行——须固定起止 commit 与逐提交分类** | merge 3553d3a 留痕 + basic-memory 遗留风险（2026-09-28） |
| B2 | **五宿主 per-host inject-memory 变体**（联动 N19 装机实测）：现源 host-bound（`.zcode` marker / ZCode JSON schema），per-host 文件须装机实测后由适配器物化，未实测宿主输出 schema 勿臆造 | Codex 审查 P0-4 处置余项（21 §0.3/§8） |
| B3 | **公开发布 manifest 与内部↔公开对账门**：机器可判定的 A 类发布清单 + SHA 对账 + A 类合并后自动产生"待发布"项；并入公开路径脱敏检测（`C:\Users\<真实用户名>` 等形态，二轮 P2-4——公开仓 03/15 仍含真实路径）。**当前待发布**：models-local-binding+gen-variant-dedup 两票的 A 类变更（generator/models.config/21/05/19/00） | 二轮审查 P1-4/P2-4（2026-09-28） |
| B4 | **bank 重建演练 runbook**：git 工件→项目 bank 的批量 retain 路径（输入清单/顺序/幂等/核验查询）在 docs/05 落 runbook 并做一次隔离 bank 演练；不可行则把"可再生"声明降为"部分可再生" | 二轮审查 P1-5 |
| B5 | **运行时版本支持矩阵 + check-env 版本校验**：Node/Python/basic-memory 最低版本与已知不兼容范围进 docs/15；check-env 从"能跑"升级为版本校验 | 二轮审查 P1-6 |
| B6 | **hindsight 写侧健康探针 + Control Plane 核正**：临时 bank 哨兵 retain→recall→清理的非破坏探针（/health 测不出 GLM 写侧失效）；:9999 本机未监听——必要性核正（21 §7 已勘误） | 二轮审查 P1-7 |
| B7 | **sync-harness 真只读模式**：--check 现状写 harness-projects.json / harness-config-state.json 与"默认只读"自述不符——改内存计算+显式 --refresh-state | 二轮审查 P1-8 |
| B8 | **current-state 面**：机器可生成的轻量状态报告（内部 HEAD/公开 HEAD/待发布差异/部署模板 hash/local 备份态/backlog/复盘票号），补"00+git log 答不了部署与发布状态"的缺口 | 二轮审查 P1-10 |
| B9 | **散落待核项收编**：injectAgentsMd 待核（02 状态注）、skills 锚点包获取来源待核（16 §3）、13 号"每 5 票"计数域定义（单仓/全体系、无 metrics 行的票怎么计） | 二轮审查 P2-1/P2-2 |
| B10 | **archiver 卡清理命令回灌**：SOP 第 8 步补现场实证形态——`git gtr rm <branch> --delete-branch --yes` + 残留核验（worktree list / branch --list）+ 已合并分支 `git branch -d` 补删 + 逐步退出码入归档证据（角色卡模板变更，走 dogfood 票） | 二轮审查 P1-9（两单归档现场适配未回灌） |

（Codex 身份审查的其余开放项以 [21 号 §8](21-memory-system-analysis.md) 为准跟踪。）

## 模板（迁移时复制）

| 模板 | 用途 | 目标位置 |
|---|---|---|
| [../templates/AGENTS-template.md](../templates/AGENTS-template.md) | 工作区宪法（v3 零参数、全项目全宿主恒等——原样 cp 零渲染） | 目标项目根 `AGENTS.md` |
| [../templates/harness-common-template.md](../templates/harness-common-template.md) | 机器级共享配置（vault 根/三区名/规范仓路径；末尾修订记录表） | `~/.agents/Harness-Configuration/common.config.md`（每机一次） |
| [../templates/harness-host-template.md](../templates/harness-host-template.md) | 机器级宿主配置（agent_segment 完整段名） | `~/.agents/Harness-Configuration/<host>.config.md`（每宿主一份） |
| [../templates/harness-project-template.md](../templates/harness-project-template.md) | 项目级配置（快照/项目段/checkpoint_every/auto_push_remote） | 目标项目根 `harness.config.md` |
| [../templates/zcode-config-template.json](../templates/zcode-config-template.json) | 工作区 .zcode/config.json（纯 MCP；hooks 已上收用户级，C2 结论） | 目标项目 `.zcode/config.json` |
| [../templates/user-config-hooks-template.json](../templates/user-config-hooks-template.json) | 用户级 hooks 注册形态（guard/inject/report 三正式脚本） | `~/.zcode/cli/config.json`（参考） |
| [../templates/agents/](../templates/agents/) | 六个角色子代理文件（ZCode 格式：四角色移植 + archiver + red-teamer；另 3 个 *-rerun 变体由生成器物化） | `~/.zcode/agents/`（用户域，全局一次；sync-harness.mjs --apply 分发） |
| [../templates/hooks/](../templates/hooks/) | guard/inject/report 三正式 hook 脚本（含真实 schema 适配） | 用户级 hooks 目录（参考部署形态） |
| [../templates/adapters/](../templates/adapters/) | 五宿主适配包（物化器 + hooks 粘贴块 + opencode/pi guard 移植；docs/18） | 逐宿主见 templates/adapters/<host>/README.md |

## 作用域约定（重要）

- **用户域安装（全局一次）**：工具（uv、hindsight、basic-memory）、技能（`~/.agents/skills/`）、插件（hindsight-zcode）、六个 hook（`~/.zcode/cli/config.json`）、六个角色子代理文件 + 3 个 *-rerun 变体（`~/.zcode/agents/`，sync-harness.mjs 分发）。
- **本仓库（规范与模板）**：机制规范（A 类）与项目档案（B 类）md 及全部模板随 git 版本化；**机制规范以本仓为唯一事实来源——改规范先改这里，再分发**（B 类档案与工件不参与分发）。
- **业务项目（按需复制）**：`AGENTS.md`、`.zcode/config.json`（仅 MCP）、`docs/` 子目录约定——迁移手册六步完成。

## 与既有资产的关系

- **AITrader 四角色团队（Kimi Code）**：AITrader 是独立项目目录（`C:\Forex\Project\AITrader`），跑在另一款工具 Kimi Code CLI 上。本仓库把它的机制（角色文件、guard hooks、流水线约定）**提炼成 ZCode 模板**，但**不迁移、不改造 AITrader 本身**——该项目继续在 Kimi Code 上运行。两边是"同一套规范的两个运行现场"：规范修订以本仓库为准；AITrader 是否跟进由人决定、人工同步，两边互不自动覆盖。
- **用户域 AGENTS.md（九项原则）**：体系的"宪法层"（User Rules），本仓库所有规范不得与之冲突。

## 维护约定

- **新增文档**：在 `docs/` 建文件 → 在本文件导航表加一行 → 提交。不再涉及根 README（人改频率归零）。
- 规范变更 → 改本仓库文档 → 提交 → 按迁移手册同步到目标项目。
- 每季度跑一次 harness-audit（见 04 文档）给体系打分，S/A/B/C/D 分级驱动改进。
