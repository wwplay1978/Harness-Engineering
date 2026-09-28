# 21 · 六角色 Harness 机制的记忆管理分析（长期 / 短期 / 参数 三视角）

> 定位：整理对象 = **六角色 harness 机制**——规范仓 docs/templates 定义、面向六宿主（ZCode + claude-code/kimi-code/codex/opencode/pi-agent）的记忆体系；**不是**某台机器或某个项目（如本仓、ZCode 宿主）的实现细节。机制契约面向所列宿主；各宿主 adapter 的可用性以 docs/18 的验证等级为准（五宿主装机实测未做）。
> 写作：2026-09-28；同日 v2 修订——首版把「ZCode 内建记忆」计入长期记忆载体、以本机部署为主体，与"安装到无 ZCode 宿主的机器"情形不符；本版改为机制层 / 宿主适配层 / 落地实例三层口径（§0），ZCode 内建记忆移入宿主附加层（§0.2）。
> 同日 v3 修订（外部对抗审查回灌，报告存档 [reviews/codex-identity-audit-2026-09-28.md](reviews/codex-identity-audit-2026-09-28.md)）：①补判定原则——"源码住在规范仓"不等于机制层，按运行时行为判定（§0.3）；②inject-memory 现实现（`.zcode` marker / ZCode 输出 schema）归宿主适配层，机制层只保留行为契约（§0.1/§2.2/§6）；③hindsight 端口改为部署默认值口径（§3.1）；④修正与 03 的权威链表述（03 含首宿主历史口径，身份判定以本文 §0 为准）。
> 公开副本注（随发布批同步）：文内 `docs/reviews/`、`docs/changes/`、`memory/` 等内部工件引用与 §7 本机实例附录为私有开发仓/单机内容，公开仓不含对应文件。
> 本文是**分析与总览层**——机制细节以 03（四层设计）/19（参数出宪）/02（流水线分工）/15–18（可移植性与宿主适配）为准（**03 含首宿主历史口径，其身份判定以本文 §0 为准**，见 §8），本文给结论与指针。

## 0. 对象界定：机制层 / 宿主适配层 / 落地实例

### 0.1 三层区分

| 层 | 是什么 | 本机制中的例 |
|---|---|---|
| **机制层**（本文主体） | 规范仓定义的组件与规则，宿主无关：纯文件 + 标准工具（git/Node/uv/Python），装到任何宿主都成立 | 宪法、两级配置中心、六角色卡 + rerun 变体、**三正式 hooks 行为契约**（guard 白名单语义 / inject 注入纪律 / report 双态提醒——现实现属宿主适配层，见 §0.3）、basic-memory、hindsight、Obsidian 知识飞轮、git 工件结构（docs/specs…） |
| **宿主适配层** | 机制组件在具体宿主的接线形态与降级路径（docs/16/18 判级） | hooks 事件注册形态×5、MCP 注册形态、无事件面/无 MCP 宿主的开工必检降级、**ZCode 内建记忆（宿主附加层）** |
| **落地实例** | 某台机器 × 某宿主的一次部署样例，只作证据不作定义 | 本机 ZCode 部署（§7 附录） |

### 0.2 修订声明：ZCode 内建记忆移出机制层

03 号设计文档写作时以 ZCode 为首宿主，把 ZCode 内建项目记忆（`~/.zcode/cli/memories/`）列为中期层组件之一、定位"零依赖兜底"。按机制口径这是**宿主附加层**，理由：

1. 它是 ZCode 宿主自带功能，机制安装到 claude-code/kimi-code/codex/opencode/pi-agent 时**该层不存在**；
2. 机制自身可移植的个体记忆组件是 **hindsight**（本地服务 + HTTP API，与宿主解耦）——无 ZCode 宿主的安装由它独立承担中期个体记忆；
3. hindsight 亦缺省时按降级矩阵（docs/15 §1）运行：个体记忆与语义检索缺失，**团队侧（basic-memory + git 工件 + Obsidian 直读）不受影响**——证明机制的记忆主干不依赖任何宿主附加层。

### 0.3 判定原则（v3 补，来自外部对抗审查）

**"源码/模板住在规范仓"不能判定它属于机制层**——必须按运行时行为判定：其输入、路径、事件、输出 schema、配置在目标宿主上是否仍成立（16 §2 适配纪律同款口径：marker 与 MCP 注册路径在异宿主下的落点=适配器职责）。据此每个条目可打两个正交标签：

- **陈述对象**：A 机制规则 / A-host 宿主适配 / B 开发仓项目记录 / Instance 落地实例；
- **成熟度**：invariant（跨项目跨宿主不变）/ portable-contract（行为契约可移植，实现需 adapter）/ host-bound（现实现绑定单一宿主）/ instance-only（单机事实）/ unverified（装机未验证）。

例：inject-memory 的**行为契约**（按项目注入团队近况、节流、fail-open）= A + portable-contract；其**现实现 .mjs**（`.zcode/memory-project` marker、ZCode 严格 JSON 输出 schema、`zcode-memo-` 节流前缀）= host-bound——marker 缺失时静默退出，非 ZCode 现场若无人建 marker 即**假绿失效**（安装无报错但注入从未发生）。

## 1. 全景总表（机制视角：三类 × 四环节）

| 记忆类 | 机制载体 | 抽取（怎么进来） | 存储（住哪） | 管理（怎么治理） | 检索复用（怎么回去） |
|---|---|---|---|---|---|
| 短期 | 宿主会话上下文（机制只定义**注入**，不定义存储） | 三通道：inject 行为契约注入团队近况（现实现 host-bound，§0.3）+ hindsight recall 注入个体经验 + 角色开工必检条款 | 宿主自管（易失） | 节流 + 体积上限 + fail-open + 零打扰 | 注入即在窗口内；离场靠 retain 与工件落盘转长期 |
| 长期·个体语义 | hindsight | 每轮对话 retain：LLM 抽取事实入库（接线=宿主集成层，无集成的宿主显式调用） | 本地服务 + 内嵌 pg0；bank 按项目自动派生 | bank 隔离、Control Plane 抽查、季度修剪 | recall 自动注入（宿主集成）；knowledge bank 经 MCP 显式 recall/reflect |
| 长期·团队流转 | basic-memory | 角色按棒次写入；archiver 归档 SOP 第 2 步（合并结论）为铁律 | 项目根 `memory/` markdown（frontmatter+permalink+tags），随项目 git | 显式 `--project` 隔离、slug 锚定、里程碑深扫修剪 | inject hook 会话首注入近 7 天；MCP 工具显式查 |
| 长期·过程资产 | git 工件 | 流水线各阶段自然产出（spec/diff 快照/审查/QA/metrics/changes） | 项目 git `docs/specs|tickets|reviews|changes|audits` + `metrics.md` | 修订号链、changes 三段链、guard 白名单 | 文档地图渐进披露按需读；下游票 `--from` 续作；度量滚动复盘 |
| 长期·人类知识 | Obsidian vault | archiver 每单写工作区草稿 + 触发 reconcile；人整理归位定稿区（知识飞轮） | vault 三区：定稿区（只能人写）+ 工作区（agent 可写，四类子目录） | 信任分级（folder 标签=未整理）、单向同步、永不做第二事实源 | planner 开工必检定稿页+工作区两处；Obsidian 直读或 knowledge bank 检索 |
| 参数 | 宪法 + 两级配置中心 + 模型路由 + 角色文件 | 安装期问答生成（人复核=人授权）；升级期从旧宪法抽参；运行期 attempt 回写 ticket 记录 | 机器级独立目录、项目根 `harness.config.md`、规范仓模板（唯一源） | 只能人改红线、恒等比对 + schema 校验、修订记录表、hash 快照、fail-loud | 角色"用前必读"；改配置角色零改动生效；sync --apply 分发 |

（变更记忆 Spec Deltas 是长期记忆里的过渡态，单票生命周期，见 §3.5。）

## 2. 短期记忆（会话工作记忆——机制定义的是注入纪律）

### 2.1 载体：宿主会话上下文

机制**不定义短期存储**：会话上下文及其压缩（如 ZCode 的 compaction）是各宿主自有机制。机制关心的是三件事：**往这个窗口注入什么、何时注入、注入多少**——以及会话结束时哪些内容必须已经离场落盘。

### 2.2 机制的三个注入通道

| 通道 | 层级 | 规则（宿主无关部分） |
|---|---|---|
| ① inject-memory（三正式 hook 之一） | 行为契约=机制层；**现实现=宿主适配层（host-bound）** | 契约：会话首条用户消息注入 basic-memory 该项目近 7 天活动摘要（截断）、标记文件判项目、按 session 节流、超时 fail-open。现实现 `templates/hooks/inject-memory.mjs` 硬编码 `<项目>/.zcode/memory-project` marker、ZCode 严格 JSON 输出 schema 与 `zcode-memo-` 节流前缀——非 ZCode 宿主复用该文件时，marker 创建与输出 schema 改写是**适配器职责**（16 §2 适配纪律），当前未闭合（五宿主装机实测未做）；marker 缺失即静默跳过=假绿失效风险（§0.3） |
| ② hindsight recall | 机制定义内容与预算，接线在宿主集成层 | 每条用户消息按当前 prompt 语义检索项目 bank，注入 `<hindsight_memories>` 块（token 预算、超时、fail-open 均有纪律）；ZCode 有官方插件自动接线，其他宿主是否有官方集成未在本仓判级文档核验（docs/15 §2 对 Kimi 明示"未证实，勿臆断"）——无集成的宿主该通道缺失或显式调用补位 |
| ③ 开工必检条款（角色卡提示词层） | 机制层（纯文本零依赖） | planner 开工前必检 vault 定稿项目页 + 工作区近期草稿两处内容源；basic-memory 近况。这是**无 hooks 事件面/无 MCP 宿主的保底通道**（pi-agent 定论路径），在有事件面的宿主上是第三重保险 |

另：三正式 hook 中的 report-worktrees 也向会话注入（"待归档"提醒），但那是流程状态信号（归档闭环的物理消警），不属记忆检索——见 §3.4 飞轮。

### 2.3 离场路径（短期 → 长期）

- **retain**：hindsight 宿主集成把整轮 prompt+response 配对送抽取（ZCode 实现为 Stop hook + prompt 暂存配对，因该宿主 Stop payload 只带 assistant 回复——实现细节属宿主适配层）；无集成宿主=显式调用或该层缺失（降级矩阵已容纳）。
- **工件落盘**：spec、diff 快照、审查报告、QA 结论、metrics 行由各角色在流水线中**直接写项目 git**——不依赖会话存活、不依赖宿主。这是机制最硬的离场保证：哪怕记忆设施全缺，过程资产仍在 git。

### 2.4 纪律（跨宿主不变）

节流（inject 每会话一次）；体积上限（recall token 预算 / 注入截断，超限收紧配置）；**fail-open**（记忆设施不可达静默放行，绝不阻塞编码会话）；零打扰（非团队项目两通道自动静默）。

## 3. 长期记忆（跨会话持久层，机制四载体 + 过渡态）

### 3.0 边界总纲（一个家原则）

**可审查的团队决策 → git 工件 / basic-memory；个体跨会话经验 → hindsight；人类知识（是什么/为什么）→ Obsidian。同一信息只允许一个"家"，其余位置只放引用。**（03 §1，宪法"记忆与知识库"节同款条款，随宪法全宿主恒等分发）

### 3.1 hindsight（个体语义记忆——机制唯一可移植的个体记忆组件）

- **存储**：本地自包含服务（API + Control Plane + 内嵌 pg0；端点由安装配置决定——默认部署常用 8888/9999，实数见 §7 实例附录）+ 本地检索模型；用户域部署，与宿主解耦、与项目 git 解耦（bank 数据是**可再生缓存**：可由 vault + git 工件经 reconcile/retain 重建，docs/15 §3——单向同步设计的优点）。
- **bank 派生**：按 git 项目自动派生（宿主集成前缀 + 项目名；ZCode 实测形态 `zcode::<项目>`），**禁手工建 bank**（宪法条款）；`knowledge` bank 承载 Obsidian 单向同步（§3.4）。
- **抽取**：retain（LLM 抽取事实、去重、合并成带证据链的 observations）——recall 只读 world/experience 两型。
- **管理**：bank mission 固定抽取焦点；Control Plane 人工抽查；季度修剪与注入体积监控（03 §5 Phase 3 制度）；抽取 LLM 走云端点是部署权衡（知情声明，非本地方案）。
- **检索复用**：① 自动——宿主集成每条消息 recall 注入；② 显式——knowledge bank 每 bank 一个 MCP 端点注册进项目 MCP 配置（各宿主注册形态不同，机制只约定端点与用途），planner/reviewer 按需 recall/reflect，回答带引用回源 Obsidian 笔记。

### 3.2 basic-memory（六角色团队结构化流转记忆）

- **存储**：每项目一个 markdown 目录（项目根 `memory/`，guard 白名单含 `/memory/`，**随项目 git 版本化**——clone 即得，跨机零迁移）；frontmatter title/type/permalink/tags；版本钉 0.22.1；MCP 以 `uvx basic-memory mcp --project <名>` 接入（MCP 标准协议，多宿主可用；pi-agent 无 MCP，见 §6）。
- **抽取**：按棒次写入——planner 决策、developer 实现备注、QA 结论（02 号"共享记忆流转"，AITrader 双 ticket 实测沿用）；**archiver 归档 SOP 第 2 步**写合并结论（ticket slug、合并 hash、reviewer/QA 结论摘要、遗留风险）；废弃工单记废弃决策。
- **管理**：所有调用**显式 `--project`**（项目隔离铁律）；命名锚定英文 slug + 中文正文；里程碑/季度由 docs-architect 深扫修剪（archiver 只做每单轻量归档）。
- **检索复用**：① 自动——inject hook 会话首注入近 7 天活动；② 显式——角色经 MCP 工具查询；③ 无 MCP 宿主——开工必检条款兜底。

### 3.3 git 工件（可审查过程资产——零依赖的最长记忆）

- **存储**：项目 git——`docs/specs/`（规格+修订号链）、`docs/tickets/`（票据台账+运行记录）、`docs/reviews/`（diff 快照/审查报告/premerge 工件）、`docs/changes/`（变更隔离）、`docs/audits/`（harness-audit）、`docs/metrics.md`（度量）。纯文件零依赖，**最小治理集的底座**（docs/15：宪法/角色/docs 结构零依赖）。
- **抽取**：流水线各阶段的**自然产出**（非事后回忆）：planner 写 spec、developer 产 diff 快照、reviewer/QA 产报告、archiver 代录 metrics 行与归档提交。
- **管理**：spec 头部修订号链（r1/r2…）；**changes 三段链**（QA/reviewer 发现 spec-gap → `docs/changes/<slug>.md` 隔离 → planner 升版归档并删条目），长期滞留=流程缺陷；guard 白名单物理限定写入面（三形态同源：.mjs exit 2 / opencode 插件 throw / pi 扩展 block，白名单逐字相同）。
- **检索复用**：宪法"文档地图"渐进披露按需读取；下游 ticket 从上游 spec `--from` 续作；指标复盘滚动消费（13 号）；ticket 运行记录同时是模型升级 attempt 计数的宿主（§4.2）。

### 3.4 Obsidian 知识库（人类知识唯一事实源）与知识飞轮

- **存储**：vault（机器配置 `vault_root`）三区：**定稿区**（`zone_final_project` 项目库 + `zone_final_common` 知识库，**只能人写，AI 永不直接写**）与**工作区**（`zone_workspace`/`agent_segment`，archiver 可写，四类子目录：工单沉淀/决策速记/环境怪癖/调研笔记）。分区名不是硬编码——全部来自两级配置（§4），这是参数化的直接收益。
- **抽取（知识飞轮，两级流转，执行者=archiver+人）**：**工单级**——archiver 归档 SOP 第 5 步把"本单可沉淀知识"写草稿进工作区（文件头必含来源 slug、spec 修订号、合并 hash、日期），**随即触发一次 `hindsight-obsidian-sync reconcile`**（官方 CLI，按需增量：内容哈希跳过未变、删除自动修剪、自动打标 vault:/folder:/日期）使草稿当单即可被检索；**整理级**——人主导（可派 docs-architect 协助）把草稿去重提炼归位定稿区并删原稿（同步自动修剪 bank）。
- **管理**：信任分级——定稿区可直接引用，工作区（folder 标签以 `zone_workspace` 前缀）=未整理草稿、结论须验证；**铁律：Hindsight 永不做第二事实源**（发现知识错误回 Obsidian 改，同步自动纠正）；同步**单向 vault → bank**；不用 `--watch` 常驻。
- **检索复用**：planner **开工前必检两处**（定稿区本项目页=定论 + 工作区近期草稿=最新鲜）；通道两条：Obsidian 直读（零依赖、两轮实证的降级路径），或 knowledge bank 检索（带引用回源）。

**飞轮闭环**：工单 → 工作区草稿（即时可检索）→ 人工整理定稿 → 下个工单的 recall 注入。合并后的 report-worktrees"待归档"提醒与 archiver 第 8 步分支清理构成飞轮的物理闭环信号。

### 3.5 变更记忆（Spec Deltas——长短之间的过渡态）

`docs/changes/<slug>.md` 生命周期=单 ticket：QA/reviewer 发现 spec-gap 当场写入（reviewer 无 Write 时由 main agent 代写）→ 合并后 planner 产出升版正文并删除 changes 条目。终态归宿永远是 git 工件的 spec 修订史——changes 只是隔离区，防止"做票"与"改 spec 正文"互相污染。

## 4. 参数记忆（harness 自我配置记忆，spec 19 v3）

### 4.1 组成（四件，全部宿主无关设计）

| 件 | 内容 | 宿主无关性的体现 |
|---|---|---|
| 宪法 AGENTS.md | **零参数不变式**：流水线、红线、记忆边界、语言约定 | 全项目**全宿主**逐字节恒等（模板原样 cp 零渲染）；Codex/OpenCode 等宿主原生可读 |
| 两级配置中心 | 机器级 `common.config.md`（vault_root、三区名 zone_*、harness_repo）+ `<host>.config.md`（agent_segment，每宿主一份）；项目级 `harness.config.md`（project_name、one_liner、tech_stack、build_cmd/test_cmd、dir_brief、checkpoint_every、auto_push_remote、project_segment） | 项目级配置**不进宿主专属目录**（明确不进 `.zcode/`，spec 19 §3.1 有意决策）；级联：项目级 > 宿主级 > 共享级 > 内置默认 |
| 模型路由表 models.config.json | defaults=inherit；escalation 规则——developer 首败（attempt≥2）升 developer-rerun、复审 r≥2 升 code-reviewer-rerun、复测升 qa-tester-rerun，attempts>4 停自动升级转人工 | 路由**结构**是机制；模型 ID 形态是宿主参数（ZCode 形如 `builtin:<provider>/<Model>`，其他宿主按其子代理模型指定约定改写或先不启用——docs/15 §2） |
| 角色文件 | 六角色卡 + 3 个 -rerun 变体（生成器从 base 物化）；分区等字面量已参数化（读配置定位） | 源=`templates/agents/` 单一来源；五宿主由 build-adapters.mjs 物化各自形态（md/toml/prompts），内容同源 |

### 4.2 抽取（参数从哪来）

- **安装期**：S1/S5 问答生成机器级两文件 + 项目级配置（安装窗口豁免：agent 生成 + 人复核 = 人授权；修订记录表首行 `init`）。
- **升级期**：在装项目从旧宪法快照人工抽参数落值（换版手册四阶段，spec 19 §6）。
- **运行期回写**：escalation 的 attempt 计数记在 **ticket 文件运行记录**（宿主=git 工件，非配置文件）；人工修订配置时修订记录表**只追加**一行。

### 4.3 管理（治理最严的一类）

- **红线两阶段**：安装窗口内 agent 可写配置；验收通过即入"**只能人改**"红线——项目级由 guard 物理拦截（项目根路径不在白名单），机器级由条文约束（agent 只备料建议 diff，人执行）；hooks/守护注册永远人手（适配包三纪律之一）。
- **sync --check 双治理**：宪法 normalize（统一 LF + strip BOM）后**逐字节恒等比对**（任何差异=宪法漂移，零歧义）；配置 schema 校验 + 关键路径可达；在册项目非空而机器配置缺失 → [FAIL]；hash 变而修订记录末行未变 → [WARN]（快照 `~/.zcode/harness-config-state.json`，兼作误删恢复副本）。
- **fail-loud**：配置缺失或字段非法时角色停下报告，不臆造路径不猜默认值（宪法条款）。
- **单一事实来源**：参数唯一住所=配置，默认值唯一住所=配置模板示例行。

### 4.4 检索复用

角色运行时"**用前必读**"（宪法"项目参数"节一行指引）；planner/archiver 以配置值定位 vault 分区，角色卡零分区字面量——**改配置即生效，角色零改动**（AC2 验证）；模型路由是 main agent 的派发约定（无自动执行器）；check-env / sync 消费配置做体检；分发走 sync --apply（勿手改部署副本）。

## 5. 跨类公共卫生制度（机制条款，随宪法/文档全宿主分发）

| 制度 | 内容 | 来源 |
|---|---|---|
| 一个家原则 | 同一信息只允许一个"家"，其余位置只放引用 | 03 §1 / 宪法 |
| 信任分级 | 定稿区可直接引用；工作区 folder 标签=未整理信号，结论须验证 | 宪法 / 03 §4 |
| 隔离 | hindsight bank 按项目自动派生禁手工建；basic-memory 显式 --project | 宪法 / 03 |
| 密钥红线 | 密钥不入库——git / 记忆 / spec 均否 | 宪法红线 |
| 平行记忆树禁令（D6） | harness 管辖项目禁用 codex-memory 家族任何执行，记忆一律走本机制通道 | 宪法（2026-09-14） |
| 季度修剪 | harness-audit 打分 + Control Plane 抽查 + 归档过期记忆 + 注入体积监控 | 00 维护约定 / 03 §5 Phase 3 |
| 语言约定 | 自然语言层中文（记忆条目正文），机器标识层英文（slug/permalink/路径） | 宪法 / 02 §7 |
| fail-open | 记忆设施故障不阻塞编码会话（hook 静默跳过） | 03 R4 |
| 降级容纳 | 记忆三层（basic-memory/hindsight/Obsidian sync）逐层可缺，git 工件与宪法零依赖兜底 | docs/15 §1 |

## 6. 宿主适配层：记忆面按宿主能力分级

机制组件装到具体宿主时的接线与降级（判级依据 docs/18；适配包 `templates/adapters/`）：

| 宿主 | inject 注入（团队近况） | hindsight 自动 recall/retain | basic-memory / knowledge MCP | 降级路径 |
|---|---|---|---|---|
| ZCode | 三正式 hooks 用户级注册（实测在役；**现源 .mjs 即本宿主的 host-bound 实现**，§0.3） | 官方插件 hindsight-zcode（recall/retain/session 三脚本） | 双 MCP 注册（实测在役） | —（本机制首宿主） |
| claude-code | 复用三正式 .mjs（hooks-settings-snippet，人手注册） | 该宿主官方集成未在本仓判级文档核验——装机按 probe-first 纪律实测，勿臆断 | MCP 支持 | 事件面缺失则降级开工必检 |
| kimi-code | 复用三正式 .mjs（config.toml 注册；事件集差异如 SubagentStop 需重验） | hindsight 是否有该宿主集成**未证实，勿臆断**（docs/15 §2 明示）→ 缓行 | MCP（AITrader 实测在用） | 个体记忆层暂缺，治理主干不受损 |
| codex | 复用三正式 .mjs（hooks.json；官方自注"护栏非完全强制边界"） | 待核（同上纪律） | config.toml 实证 | 同上 |
| opencode | guard 已插件化；**inject 等价事件面未核验**（docs/18 观察项） | 待核 | 支持（细节待核） | 注入降级开工必检 |
| pi-agent | 无 UserPromptSubmit 等价事件面 | 无（无 MCP 面，见右） | **官方明示无内置 MCP** | **记忆面=开工必检条款 + Obsidian 直读**（docs/18 定论）；单代理角色卡降级、rerun 变体无 |

> 注（v3）：claude-code/kimi-code/codex 行的"复用三正式 .mjs"指 wiring 形态；所复用的现源是 host-bound 实现（§0.3）——marker 创建与输出 schema 在这些宿主的落点属适配器职责（16 §2 适配纪律原文："项目侧 marker 与 MCP 注册路径在异宿主下的落点是适配器职责，注入验证会暴露此类差异"），闭合以 docs/18 装机实测为准。

**ZCode 附加层声明**：ZCode 宿主另有两样本机制不依赖的宿主自带能力——内建项目记忆（`~/.zcode/cli/memories/`，03 §3 定位"零依赖兜底"）与会话 compaction。它们在 ZCode 现场是增益，但**不计入机制组成**（§0.2）；整理或评估机制能力时不得把它们算作机制层。

## 7. 落地实例附录（本机 ZCode 部署，2026-09-28 实测——仅为样例，非机制组成）

| 设施 | 状态 |
|---|---|
| hindsight 服务 | 运行中（:8888/:9999）；bank_missions 在册 11 个项目 bank；zcode::AITrader2 fact_count=3982、knowledge fact_count=1897 |
| hindsight 宿主集成 | `~/.zcode/hooks/hindsight/scripts/`（session_start/recall/retain）+ settings（budget=mid、≤1024 token、每轮 retain、中文抽取 mission） |
| basic-memory | 0.22.1；7 个项目命名空间；`memory/decisions/` 实例在档（redteam-p0-edge 合并结论） |
| 流转 hooks | guard/inject/report 三正式 hook + hindsight 三脚本，用户级注册；本仓 `.zcode/memory-project` 标记在位 |
| 配置中心 | `~/.agents/Harness-Configuration/`：common（vault_root、三区 50/60/70）+ zcode（agent_segment=10-ZCODE） |
| Obsidian vault | 三区实存；工作区四子目录在位；项目段 AITrader2/web2api 在位 |

## 8. 已知边界与遗留（如实）

- 五宿主适配包**装机实测未做**（adapters README 诚实边界：首装实测随 N19 kickoff 执行）——§6 表中"待核"项回灌 docs/18。
- hindsight 抽取 LLM 走云端点=会话内容出本机的知情权衡（03 R2）；真本地方案（ollama/lmstudio）质量未实测。
- Memory Defense（PII/密钥脱敏）仍为规划项；注入体积监控尚未制度化（Phase 3），现值=hooks 静态配置。
- 03 号原文仍以 ZCode 首宿主视角把内建记忆写进中期层——本文 §0.2 已按机制口径修正表述；外部审查同点此为 P1-2（01/03/04 总纲层仍含首宿主口径），**身份判定一律以本文 §0 为准**，三篇待后续修订同步。
- 外部对抗审查（2026-09-28，存档 `docs/reviews/codex-identity-audit-2026-09-28.md`）处置跟踪——D1/D2/D3/D6 及 D4 源头分层经用户批准于同日实施：README 公开身份与 00/12 导航身份分类（D1）、07/17 安装入口宿主范围声明（D3）、16 §4 降级矩阵 v3 重述（D2：降级全落装配层、宪法正文不改）、models.config 路由×绑定分层 + 生成器双格式兼容 + inject-memory 归层注释（D4）均已落地。**仍开放**：inject-memory 的 per-host 变体拆分待 N19 装机阶段（五宿主输出 schema 未实测，按勿臆断纪律不预写）。本仓治理模型口径（审查 P1-8/D5）已于 2026-09-28 经用户裁决收口为**限定 dogfood**（规范类变更走流水线、日常小修直提——19 §11 已重写、metrics.md 首行已加定位注）。
- 本机 `~/.basic-memory/config.json` 存在 `null` 项目名（历史残留，无消费），可择机清理。

## 参考文档

- [03-memory-hindsight-obsidian.md](03-memory-hindsight-obsidian.md)——四层记忆总设计与 hindsight/Obsidian 集成细节（**含首宿主历史口径**——如 ZCode 内建记忆列中期层；身份判定以本文 §0 为准）
- [19-constitution-config-split.md](19-constitution-config-split.md)——参数出宪与两级配置中心（参数记忆的体系来源）
- [02-team-core.md](02-team-core.md)——六角色流水线与 basic-memory 流转分工
- [15-toolchain-portability.md](15-toolchain-portability.md)——工具链降级矩阵（记忆三层逐层可缺、最小治理集）
- [16-host-agnostic-installer.md](16-host-agnostic-installer.md) / [18-host-adapters.md](18-host-adapters.md)——宿主无关化与五宿主判级（§6 依据）
- `templates/agents/archiver.md`——归档八步 SOP（长期记忆抽取的执行规程）
- `templates/hooks/inject-memory.mjs`、`templates/adapters/`——注入钩子与五宿主接线
