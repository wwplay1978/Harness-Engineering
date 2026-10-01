# 22 · 效能统计系统（跨项目遥测 × 效能度量，v4）

> 定位：为六角色 harness 增加机制层统计能力——在所有在册项目上自动回答三问：**每类角色实际用了什么模型、累计跑了多久；质量性返工（quality rework）花了多少（次数/时长/token）；两者随时间的变化趋势**。产出服务于 OPT-2 路由反馈（docs/09/11）、13 号指标复盘门与"内部摩擦成本"核算。
> 身份与状态：**A 类机制规范 · 已采纳（v4；2026-10-01 转正——§10 聚焦确认通过：六项核对点全过、36 例回归集 36/36 绿，P3 备注已补 stats-2 ⑫ 收口）**。审查链：v0 首轮「须重大修订」(P0×4) → v1 二轮「修 P1 后可采纳」(P1×9) → v2 终审「需再修」(P1×4) → v3 第四轮全面轮「需再修」(P1×7/P2×2，held-out 实弹，报告 reviews/codex-22-v3-fullaudit-2026-10-01.md（私有仓存档）) → v4 回灌其 R1–R7 最小残余清单（变更映射见附录）。前序报告：reviews/codex-22-proposal-audit-2026-09-30.md（私有仓存档）、reviews/codex-22-v1-reaudit-2026-09-30.md（私有仓存档）、reviews/codex-22-v2-final-2026-09-30.md（私有仓存档）。D1'–D10' 已获用户批准（§9）；v4 修订与转正经用户 2026-10-01 批准。
> 分层口径（沿 21 §0.3）：指标体系/事件仓 schema/采集协议=机制层 portable-contract；各宿主采集器（含版本探针）=宿主适配层 host-bound；本机数字=落地实例（I:，谓词与快照口径见 §2.4）。
> 写作：2026-09-30 v0→v1→v2 → 2026-10-01 v3→v4（R1–R7 回灌）。修订记录只追加。

## 0. 设计立场（四轮审查确认）

**不新增 hook、不建常驻服务、不写任何项目仓**——「宿主本地日志离线挖矿（面一）+ 票据/git 工件挖掘（面二）」双面采集，聚合为一个用户域事件仓 + 一条报告 CLI（`harness-stats.mjs`）。

四轮审查确认"攻击不动"并保留：离线挖矿；用户域单仓；双面分工；实际模型取运行时真值；墙钟与模型请求时长分口径；cache token 分路；默认不出本机；五路 vector；Node ≥22.16 原生备份；M1–M4；路由锚与历史降级；D10' 不迁移。修复链：首轮四 P0（更名/分类学/upsert 协议/路由锚）→ 二轮九 P1（三层身份/crash 协议/备份链/判定协议/pilot 边界/三仓注记/B9 七子项/上下位/五路）→ 终审四 P1（revision 三类/F–E 重整/bundle/initial 规则）→ 第四轮七 P1（**身份公式闭合+M2 读取语义、attempt 协议条件化+分类质量门+数据集隔离、failpoint 注入契约、metadata 谓词、stats-1 契约化、三面零漂移、状态映射**——本版收敛）。

## 1. 目标与非目标

**目标**

- G1 角色画像：每角色（含 rerun 变体）× 项目 × 日期：派发次数、实际模型、累计墙钟时长、模型请求时长、token **五路**（input/output/reasoning/cache-read/cache-write 分列，D1'）、retry/失败计数；
- G2 返工计量：每票据 attempt 分布（按 attempt_kind 分类）、质量性返工次数与花费（时长+token）；体系级返工率与返工成本占比趋势；
- G3 反馈闭环：为 OPT-2 路由变更提供**可证实变更点**的前后对照数据（锚点 §5.2；历史只做描述性 model-mix）；为 13 号复盘门提供机器可复算数据源；
- G4 跨项目：以项目注册表为域（§5.7），一台机器一份事件仓。

**非目标**

- 不监控人、不做绩效考核（§3.6 度量纪律）；
- 不做实时面板/常驻服务（Langfuse 类部署形态不采纳，§3.2）；
- 不采集消息正文、工具输出、代码内容、错误正文——只取计量元数据（字段 allowlist，§5.3）；
- 不写入任何项目仓与 hooks 执行位（门 A/门 B 语义零接触；report 默认 stdout，§5.6）。

## 2. 数据源实证（2026-09-30 本机三轮取数；谓词与快照口径见 §2.4）

### 2.1 面一：宿主计量面（自动、全量、可回填）

| 源 | 路径 | 关键字段 | 实测结论 |
|---|---|---|---|
| **ZCode sqlite**（主力） | `~/.zcode/cli/db/db.sqlite` | `model_usage(session_id, agent, model_id, duration_ms, time_to_first_token_ms, input/output/reasoning/cache_creation/cache_read_tokens, retry_count, status, started_at, completed_at)`；`session(id, parent_id, path, task_type, time_*)` | I: `agent` 列直接承载角色名（`zcode-planner/developer/developer-rerun/code-reviewer-rerun/qa-tester-rerun/red-teamer/archiver`+非机制角色），角色×模型×时长×token 一张表出全；`parent_id` 区分主/子会话；**行内状态机 running→terminal 原地补写 token 而 started_at 不变**（§5.4 协议前提；**mutable-row adapter 原型**，§5.2） |
| ZCode 子代理派发记录 | `~/.zcode/cli/agents/<sess>/agent_*/metadata.json` | `profileId, childSessionId, status, createdAt, completedAt, cwd` | I: 599 份（completed 569/failed 25/running 5）；profileId 分布 planner 100 / code-reviewer 103 / red-teamer 86 / developer 82 / archiver 65 / qa-tester 62 / developer-rerun 33 / code-reviewer-rerun 30 / qa-tester-rerun 11（另非机制 27、**stale running 孤儿 5**——childSessionId 不在 session 表、无 token，§5.2 状态机）。派发级墙钟=createdAt→completedAt；`model_usage.duration_ms` 是模型请求时长，两口径都报 |
| Codex rollout | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `session_meta.payload.cwd`；`token_count.payload.info.total_token_usage{input/cached/cache_write/output/reasoning/total}`；模型名在 `turn_context` | I: 318 份@首轮 → 321 份@2026-09-30T23:57:14+08:00（活库增长）；字段完整；**已检出 `spawn_agent` 调用**——子代理能力存在，父子 rollout 身份/角色/token join **UNVERIFIED**（stats-3 探明，不可得则子代理成本标 unknown）。**append-only adapter 原型**（行不可变，§5.2） |
| Kimi Code | `~/.kimi-code/` | `wire.jsonl` 的 `usage.record{model, usage{inputOther, output, inputCacheRead, inputCacheCreation}}`；`session_index.jsonl(workDir)`；`profile.bind(modelAlias)` | I: 230 份 wire.jsonl 中 173 份含 usage.record、共 5,225 条——usage 四字段可得，**映射入五路 vector（reasoning=N/A）**；wire.jsonl 同文件混有消息体→type allowlist 强制（§5.3）；`state.json` 只作会话包络上界。**append-only adapter 原型** |
| ZCode rollout 原始 IO | `~/.zcode/cli/rollout/model-io-sess_*.jsonl` | `model.modelId, durationMs, headers.x-zcode-agent` | 备用校验源（对账），日常采集不读（体积） |

**宿主 ≠ 模型提供方**（二轮确认）：本机 planner/red-teamer 是 **ZCode 子代理调用 kimi-k3 模型**，token 已在 ZCode `model_usage`（I: zcode-planner×kimi-k3 792 请求、zcode-red-teamer×kimi-k3 1,177 请求）——G1 首期六角色无缺角；Kimi 面解决的是原生 Kimi Code 会话。

**已知噪声**（I:）：`session.path` 含 `.venv` 内会话（AITrader2 pyeventbt 46 条）——按项目注册表白名单过滤；模型 ID 大小写分裂（`GLM-5.3-Flash`/`glm-5.3-flash`）——归一化合并、保留原值备查；`model_usage.agent` 含非机制角色——六角色+rerun 白名单过滤，其余归 `other` 并计 unknown 占比（§5.3 阈值）。

### 2.2 面二：流程工件面（票据级质量计量）+ attempt 判定协议

| 源 | 内容 | 实测结论 |
|---|---|---|
| 消费项目 `docs/tickets/<slug>.md` | "运行记录"小节：attempt 列（**数字或 `r<n>` 形态**——I: phase1-fill-rerun-window/reactive-runner 等票确实写 `r1/r2`）、角色/变体列、结果、日期、备注 | attempt 列是主要结构信号但**并非处处数字**（§2.2 预处理） |
| 消费项目 `docs/reviews/` | `<slug>-r<n>-review.md`+`.diff`、`-qa*.md`、`-redteam.md`、`-premerge.log` | I: AITrader2 496 件、web2api 42 件。**`r<n>` 只是复审修订号（review_revision），不得推断 developer attempt**——反例实测：har-redact-url-substring 票 attempt 1 网络中断零产出/attempt 2 完成、reviews 仅 r1；phase1-fill-observe-window 有 qa-r3…r8、codex-round2/3 等 20+ 文件 |
| `docs/metrics.md`（三仓） | archiver 代录台账 | 人读摘要保留（§7 主从）；**三仓旧"一次通过"列口径互异且未冻结定义，不做自动迁移**（D10'，04 号注记） |
| git（消费项目） | merge commit、archive commit、`--shortstat` | 票周期时间线骨架 |

**attempt 分类学**（事件 schema 承载）：

```text
attempt_kind: initial | quality_rework | infrastructure_retry | cancellation_retry | evidence_refresh | unknown | compound_unparseable
trigger_stage: reviewer | qa | red_team | premerge | environment | user | unknown
```

**判定协议**（v4 重排：预处理 → 统一优先级 → 条件式 initial → 词典 → 排除 → 质量门 → 数据集隔离）：

1. **预处理规范化**：attempt 列值 `r<n>`/`R<n>` → attempt 序号 n；非数值且无 r 前缀 → 不作结构信号；
2. **信号优先级（统一序，全文唯一）**：① 运行记录**显式原因声明**（原文明示原因短语，含"网络中断零产出""非返工"等）＞② 结构信号（规范化后的 attempt 序号、`-rerun` 变体名+拒因工件）＞③ 文本词典推导 ＞④ unknown；同级信号冲突时以高级别为准；
3. **initial 条件式**：attempt 序号==1 **且**无环境零产出/取消声明 → initial；attempt 序号==1 且明示环境零产出 → infrastructure_retry（反例即正例：har-redact-url-substring 的 attempt 1）；
4. **文本词典**（仅低级别信号缺失时；**含否定短语"非返工/非缺陷/时序"时不得因邻近出现"修复/重跑"误判**）：

   | 词典示例 | 归类 |
   |---|---|
   | 修复轮 / request changes / RC / findings 修复 / 窄修 / minimal-fix / 合并前修 / P1-P2 修复 / 复审后修 | quality_rework |
   | 网络中断 / 限流 / provider unavailable / 环境事件 / 断电续跑 | infrastructure_retry |
   | 证据补录 / 证据刷新 / 重新物化 / hash 对账 / 快审折叠 | evidence_refresh |
   | spec 数值阻断 / spec 修订轮 / 用户裁决驱动修订 | quality_rework（trigger_stage=premerge 或 user，备注标注 spec 面） |
   | 契约收口级微修 / 非缺陷微修 / docstring 修正 | quality_rework（secondary 标 non_defect） |

5. **排除规则（不产生新 attempt，记"同 attempt 附注"）**：窗口时序 / 授权窗节奏执行 / 两阶段票面执行时序 / 断点续跑＝同 attempt / 自愈 / 伪红重跑 / dev 轮内自修（amend）不另增 attempt；
6. **聚合行规则**：单行覆盖多 episode（如"初始实现+review 修复+redteam 修复"合写一行）→ **拒绝单标签分类**，标 `compound_unparseable`（进 golden set 作负例；粒度修复归票面重录，不归分类器猜）；
7. **多因并存**：单值主因（触发该次重派的第一拒因，按时间序）+ `secondary_cause` 字段，不折叠；
8. **人工更正**=MANUAL_RECONCILED observation 事件（带归因者/依据/源 hash，§2.3），不改写原事件；
9. **分类器版本**（`classifier_version`）入事件；历史不自动重分类——重分类=新 `derivation_revision` 的派生观察事件（§5.2）；
10. **分类质量门（v4 改）**：某时段**不可接受结果合计（unknown+wrong_label+compound_unparseable 占比）＞30%** → `HISTORICAL_CLASSIFICATION_LOW_COVERAGE`，趋势标"已识别下限"；**wrong_label 单独 ＞10% → 分类器 fail（红）**——只看 unknown 会放走高置信错误（第四轮 held-out 实证：unknown 18.75%+确定性错误/粒度错误 12.5%=31.25% 合计触门而 unknown 单看低于 30%）；
11. **数据集隔离（防循环验证）**：`development_regression_set`（终审 20 例+第四轮 held-out 16 例=36 例，只做逐例回归防退化，**不计入 precision 验收**）；`held_out_acceptance_set`（本协议冻结后新抽 ≥20 例，样本不得参与词典/规则制定，报告 unknown_rate/wrong_label_rate/compound_rate 三率）。

### 2.3 归因键与置信度（五级）

| 级 | 判定 | 消费权限 |
|---|---|---|
| **EXPLICIT** | 票据运行记录行含 childSessionId（D7' 增强后） | 全指标 |
| **DIRECT** | 派发 cwd 命中 `<项目>-worktrees/feat-<slug>`（I: 当前实例符合，n=1，不作"稳定"宣称） | 全指标 |
| **CANDIDATE** | 仅日期/项目吻合（I: AITrader2 单日最多 13 票并列） | **永不入票级 M2/M3 统计**，只输出候选清单 |
| **MANUAL_RECONCILED** | 人工判定，记录归因者/时间/依据/源 hash | 全指标（含归因元数据） |
| **UNATTRIBUTED** | 以上皆非 | 只进体系级（非票级）聚合 |

优先级 EXPLICIT ＞ DIRECT ＞ MANUAL_RECONCILED；CANDIDATE 永不自动升级。其余键：role=`model_usage.agent` 去 `zcode-` 前缀；run=metadata.json `agentId`（childSessionId 关联 token）；project 见 §5.7。

### 2.4 I: 数字谓词与快照口径（三轮实测锚定）

| I: 声明 | 谓词 | observed_at | 口径注记 |
|---|---|---|---|
| model_usage 27,350→27,357→**27,366**（→27,387@四轮复核，持续增长属预期） | `SELECT COUNT(*)` 全表 | v0 上午 / 首轮午后 / 二轮 2026-09-30T14:19:58+08:00 / 四轮 2026-09-30T16:30Z | 活库单调增长自洽；**活库数字必附 observed_at** |
| 子会话 17,858 | `JOIN session … WHERE parent_id IS NOT NULL` | 三轮恒等 | — |
| DB status 分布 completed 27,244 / error 104 / cancelled 18（四轮复核 27,262/106/19） | `GROUP BY status` | 2026-09-30T14:19:58+08:00 / 16:30Z | 数据事实不替代协议对未来异常行的定义 |
| planner/red-teamer×kimi-k3 = 792 / 1,177 | `WHERE agent IN (…) AND lower(model_id)='kimi-k3'` 计数 | 2026-09-30T14:19:58+08:00（四轮复核恒等） | 大小写不敏感谓词 |
| 大小写分裂 1,640/1,272 | 子会话谓词 + 按 model_id 分组 | v0 上午 | 仅子会话限定；全表 2,665/1,574 |
| GLM-5.3 computed_total≈1.37B | 子会话+大写 ID 限定 | v0 上午 | 归一后 1.40B、全表 4.25B（cache 大头印证五路必要性） |
| 派发 599；completed 569/failed 25/running 5 | metadata.json 全量解析 | 2026-09-30T14:20:36+08:00 | 含非机制 27 与 stale 孤儿 5（=5 条 code-reviewer-rerun/running，childSessionId 皆不在 session 表） |
| Codex rollout 318 → **321** | sessions/ 递归计数 | 首轮 → 2026-09-30T23:57:14+08:00 | 活库增长照实双录 |
| Kimi 230 份 wire / 173 含 usage.record / 5,225 条 | 按 type 过滤 | 首轮复核轮 | — |
| `.venv` 噪声 46 | `session.path LIKE '%.venv%'` 计数 | v0 上午——**历史近似快照**（ro 复测失败未重取，见下行） | AITrader2 pyeventbt |
| ro 直连失败 | python `mode=ro` URI | **两次**：v0 会话；2026-09-30T23:57:14+08:00（同型 `OperationalError`） | **间歇性现象实录**（疑与在用写入/WAL 锁窗口相关）——§5.4 双路径实证必要；今后取证一律落工件 |
| attempt 列 rN 形态 | 票据运行记录 attempt 列抽查 | 2026-10-01（四轮 held-out） | phase1-fill-rerun-window/reactive-runner 等写 `r1/r2`——§2.2 预处理规范化的依据 |
| worktree 形态 | `git worktree list` | v0 | 当前实例符合约定（n=1 活跃副 worktree，不作"稳定"宣称） |

**数字纪律**：实例数字只作可行性证据；一切验收用**冻结快照 fixture**（stats-1 契约票定义 bundle schema，stats-2 产出），I: 数字不作为 golden count、票面不写死活库常数。

## 3. 业界调研与吸收（GitHub 与公开研究）

### 3.1 ccusage（github.com/ryoppippi/ccusage）

纯离线 CLI：读 18 款编码 CLI 本地日志（含 ZCode sqlite、Codex sessions、Kimi）出 token/成本报表。吸收：离线架构（基座）；项目别名（→§5.7 注册表）；token-first（→D1' usage-vector）；day×model 分维；JSON 输出分层。改造：LiteLLM 定价快照（后置 stats-6a，锁 revision+版本化）。规避：订阅模型强行折算 $。

### 3.2 Langfuse / Arize Phoenix

trace→span→generation 模型。吸收：两层事件结构（派发≈trace、模型请求≈generation）与 generation 级 usage 字段。不采纳：常驻服务；AgentOps/Helicone 等 SaaS 同判。

### 3.3 OTel GenAI 语义约定

`gen_ai.request.model`、`gen_ai.usage.input_tokens/output_tokens`（演进中，锁版本）。吸收命名对齐，不引入 SDK。

### 3.4 DORA 四键——指标框架映射

| DORA | 本系统 | 来源 |
|---|---|---|
| 部署频率 | 吞吐：merged 票/周 | git |
| 交付周期 | ticket cycle time | 面一+git |
| 变更失败率 | **质量性**返工率（attempt_kind 过滤后） | 面一+面二 |
| MTTR | 修复轮时长（quality_rework 派发墙钟+其复审/复测） | 面一 |

吸收"速度与稳定同向"判读纪律：一次通过率与 cycle time 应同向改善，背离=口径有问题。

### 3.5 SPACE——维度完整性

效率流维度"人闸等待"须与 agent 时长分桶（票周期=agent 活动墙钟+空闲两桶，空闲标估算）。

### 3.6 METR——度量纪律

随机对照研究发现开发者主观提速预期与实测完成时间可能显著背离（预期提速、实测反慢）。三条纪律：指标可机器复算（事件仓重算一致）；样本量随报（n<10 只列不判）；**指标用于改 harness，不考核人**。

### 3.7 gsd-stats（本机先例）

读 git+状态文件的一次性统计。吸收"零依赖读工件"取向；跨项目计量为本系统新增面。

**吸收汇总**：采纳=离线架构/项目注册表/usage-vector/两层事件/DORA 映射/人机分桶/度量纪律；改造=定价快照后置、trace 简化两层；不采纳=常驻观测服务、OTel SDK、订阅模型折算、实时面板。

## 4. 指标体系 M1–M4（定义权威归 04 号）

> v0 曾用 L1–L4 与 04 号质量门禁撞名，v1 起统计层一律 **M1–M4**；三个 pass 口径已在 04 号 §4 冻结命名，本文只引用。

| 层 | 指标 | 公式/口径 | 来源 | 偏差注记 |
|---|---|---|---|---|
| **M1 运行计量** | 派发次数 | count(派发事件) by role×variant×project×day | 面一 | 只含 ZCode 派发；Kimi/Codex 原生面 stats-3 起 |
| | 实际模型 | model_usage.model_id（归一化） | 面一 | 与路由意图对照=漂移检测，差异单列 |
| | 累计墙钟 | Σ(completedAt−createdAt) | 面一 | 并行派发重叠→墙钟与串行两口径 |
| | 模型时长 | Σ(duration_ms) | 面一 | — |
| | token 五路 | Σ input/output/reasoning/cache-read/cache-write 分列 | 面一 | 禁跨模型求和单值（D1'）；宿主缺路=N/A 不补零 |
| | retry/失败 | Σ retry_count；terminal_failed 计数 | 面一 | — |
| **M2 质量计量** | pass·reviewer-first / pass·pipeline-clean / pass·no-quality-rework | 定义见 04 §4（分母=merged 票） | 面一+面二 | 三指标分列输出，禁合并；历史以事件仓重算为准（D10' 不迁移） |
| | 质量性返工率（票级） | 含 ≥1 次 quality_rework 的 merged 票占比；分母=terminal_completed+terminal_failed 派发所在票（cancelled 单列不入分母） | 面一+面二 | infra_retry 排除；两源互校偏差披露 |
| | 返工花费 | quality_rework attempt 及其后续复审/复测派发的墙钟+token | 面一 join 面二 | 归因置信度随数披露（§2.3）；消费派生版本=报告钉定 policy 下最新有效（§5.2） |
| | attempt 分布 | 票 × max attempt 直方图（attempt_kind 分色；rN 已预处理规范化；compound_unparseable 单列不入分布；触 4 轮上限单列） | 面二 | 代录缺行回退面一推数并标注 |
| | QA 缺陷密度 | 沿 metrics.md 口径 | 面二 | 不改口径 |
| | 分类质量门 | unknown+wrong_label+compound 合计＞30% 触降级；wrong_label＞10% 分类器 fail | 事件仓 | §2.2 协议 10 |
| **M3 流动计量** | ticket cycle time | merge commit − 首次派发 | 面一+git | — |
| | agent/空闲分桶 | 票周期内 agent 活动墙钟 vs 其余 | 面一时间线 | 空闲含人闸+排队，估算标注 |
| **M4 趋势与摩擦** | 周趋势 | M1/M2 按 ISO 周分桶（UTC 存储、报表显式时区+iso_week_year，§5.7） | 事件仓 | — |
| | 返工成本占比 | Σ quality_rework token / Σ 全部 token | 面一 | — |
| | 邻接拒绝 | dev→review 拒、review→dev 修、QA 拒转移计数（质量性拒因含 reviewer/qa/red_team/premerge 四 trigger_stage） | 面二 | — |
| | 路由变更对照 | 仅对 **verified 变更点**（§5.2 锚齐全）输出；不足 2 点输出 `NOT_ENOUGH_CHANGE_POINTS` | 面一+锚 | 历史无锚数据只做描述性 model-mix |

报表口径：终端表 + `--json`；一屏摘要=角色×模型×月度矩阵 / 质量性返工票列表 / 周趋势文本 sparkline。

## 5. 架构

```
[ZCode db.sqlite]──┐                                  ┌─ report：默认 stdout（表/markdown/json）
[Codex sessions]───┤ collect（只读+增量协议 §5.4）─→ 事件仓 ─→ --out 仅白名单 reports/
[Kimi .kimi-code]──┤        ~/.agents/harness-stats/  ├─ verify：两源对账偏差清单
[票/reviews/git]───┘   events/ reports/ snapshots/    └─ validate / rebuild --from-source
                       cursors/ locks/ quarantine/
```

### 5.1 组件与位置

- 工具：`templates/tools/harness-stats.mjs`，分发位 **`~/.agents/Harness-Engineering/templates/tools/`**（机制层，与 pre-merge-check 同位，SYNC 数组加一行）；
- **运行时契约（D9'）**：**Node ≥22.16**——依赖原生 `node:sqlite`（22.5.0 引入）及其 `backup()` Online Backup API（22.16.0 加入），零第三方依赖；check-env 补该工具版本下限校验（B5 票联动项）；
- 数据/配置位：`~/.agents/harness-stats/{events, reports, snapshots, cursors, locks, quarantine, config.json, projects.json}`；目录创建时校验仅当前用户可访问（ACL，§6）；
- ZCode `~/.zcode/harness-projects.json` = **registry adapter 输入之一**（导入机制层 `projects.json`），不是机制层全局注册表；
- 采集开关（`stats_enabled` 等）入三级配置 host 层（19 号既有机制，不另发明配置面）。

### 5.2 事件模型（身份公式闭合；正式 schema=stats-1 契约票交付，上下位规则见本节末）

两层 + 观测层：**dispatch event**（派发）→ **model-request event**（模型请求，N:1 归派发）；**observation event**（票据工件快照与派生重算观察，subtype 必填：`ticket_snapshot` / `derived`）。

**身份公式（v4 逐类闭合）**：

```text
entity_id = source_instance_id + adapter_id + source_primary_key
  # source_primary_key 生成：sqlite=表内主键；append-only JSONL=文件相对路径+行号（文件不可变故行号稳定）

dispatch / model-request：
  event_id = entity_id + ':' + source_revision
  # mutable-row：allowlist 内容/状态变化递增；append-only：恒 1

observation（subtype 必填）：
  ticket_snapshot：event_id = entity_id + ':obs:' + source_hash8（源文件内容 hash 短码）
  derived：        event_id = entity_id + ':drv:' + derivation_revision
                   # derivation_revision 单调递增，携带 classifier_version；不冒充 source_revision
```

**M2/报表读取语义（v4 新增，报表可复算的前提）**：report manifest 钉定 `classifier_version` 与 derivation selection policy；默认=每 observation 实体取该 policy 下**最新有效 derivation**；人工更正=更高优先级派生（manual ＞ auto）；历史派生全部保留但**只进 audit/history 模式，禁入 M2 分子分母**；report manifest 必记 classifier version / selection policy / revision watermark。

- **dispatch / model-request**：按 `entity_id` upsert（最新版快照）+ 保留 source_revision 链（历史修订不可变）——running→terminal 是同实体新 source_revision，不换键、不丢史；
- **observation**：天然 event-sourced，按 `event_id` 追加，源 hash 链，不做不可追溯覆盖。

dispatch 必带：role/variant、project_id、归因级（§2.3）、状态机值、墙钟、attempt_kind/trigger_stage+secondary_cause、`classifier_version`、路由锚组。

**状态机与源状态映射（v4 补）**：规范七态 `observed_running / terminal_completed / terminal_failed / terminal_cancelled / stale_orphan / missing_child / unknown`。源→规范映射表（stats-1 契约票交付冻结）：sqlite `completed/error/cancelled`→对应 terminal 态；metadata `completed/failed/running`→对应态；`missing_child`（定义：childSessionId 引用不存在于源，**无论时长**——引用完整性错误）与 `stale_orphan`（定义：running 且超 72h 无 child 会话与 token，**时钟字段=collect 时刻 UTC，测试经 `--clock` 注入**）互斥。**计数细则**：stale_orphan 计派发、不计失败、不计墙钟；missing_child 计入失败率；terminal_cancelled 单列、不入失败率与 rerun 分母；unknown 只计数不入任何率；rerun 率分母=terminal_completed+terminal_failed。

**双面一致性校验（v4 补）**：verify 输出票据 developer-attempt 行 vs 归因派发事件 vs developer/developer-rerun 变体序列三方对账（missing ticket row / orphan dispatch / duplicate attempt / non-monotonic attempt / attempt=1-but-infra-failure / one-row-multi-attempt / variant-kind 冲突）；差异率超阈（默认 5%）→ M2 **fail-loud**，不得静默"回退面一推数"（面一可见派发、不可判 attempt 序号与拒因）。D7' childSessionId 未落地前 pilot 可跑，但低置信 join 不得当已闭合的票级成本归因。

**路由锚组**：`effective_model, route_hash, repo_models_config_commit, local_override_hash, generated_role_card_hash, host_version, collector_version`——自首个 collect 起记录；历史无锚数据 `route_version=unknown`，只做描述性分组，**不得声称为路由决策前后对照**。

**schema 上下位规则**：① 22 正文=规范上位面；② stats-1 契约票产出的正式 schema 只能细化、不得改写正文语义；③ 正文每条 MUST 均须有 obligation 条目（编号 O-xx：规范行/事件类型/JSON Pointer/validator rule/正负 fixture ID——义务清单为 stats-1 交付物）；④ schema 新增影响指标、隐私或事件身份的字段→回方案门重审，不得在实现票内自由扩张；⑤ 正/负 fixture 须覆盖**全部** obligation（每负例对应 validator rule），非任取三例。

### 5.3 源适配器契约

每个 adapter 声明：`adapter_id, adapter_type(mutable-row|append-only), source_version, supported_version_range, schema_fingerprint（必需列集合，探测自 sqlite_master/文件结构）, known_enum_values（agent/role + model + status 三类枚举白名单，版本化）, unknown_count/ratio（分维度计量）`。

行为铁律：必需列缺失、**版本超范围**、任一维度 unknown 占比超阈（默认 5%，分维度判定）→ **`UNSUPPORTED_SOURCE`：exit≠0 + cursor 冻结 + 零写入**。

字段纪律：**显式 allowlist，禁 `SELECT *`**——排除 `error_message/raw_usage_json/provider_metadata_json` 等含正文/元数据风险列（forbidden 字段负例验收=stats-2 ⑪）；Kimi 只取 `type ∈ {usage.record, step.end, profile.bind, metadata}` 行。

### 5.4 增量采集与一致性协议（F/E 两类 crash fixture + 注入契约）

1. **upsert 语义**：事件按 `entity_id` upsert、revision 链追加（§5.2）——源行 running→terminal 原地补写（started_at 不变、无 updated_at），纯时间游标必漏；
2. **开放集**：已见非 terminal 的 `entity_id` 入 open-set，每轮重读直至 terminal；
3. **复合游标**：terminal 行按 `(completed_at, id)` 推进；`started_at` 仅作扫描下界；**源行数/max-id 回退即 fail loud**（stats-2 ⑨ fixture）；
4. **提交链与唯一 commit point**：segment 以临时文件写入（`segment.tmp`）→ 数据 fsync → **rename 为正式 segment** → segment manifest（closed 判定）写+fsync → cursor 临时文件写+fsync → **cursor 原子 rename（=唯一提交点）** → 父目录 fsync。fsync 顺序即上述顺序；power-loss 与进程 crash 按同一保证等级（fsync 纪律覆盖）；
5. **恢复规则**：cursor rename 前崩溃→下轮扫描 segment manifest 中已 closed 但 cursor 未含的 segment=待提交（重放幂等收敛）；无 manifest 的 segment（含未 rename 的 .tmp）=partial→quarantine；cursor 损坏（E2 四型）→从 segment manifests 重建（取最大已提交序）；stale lock→见 E1；`validate`/`rebuild --from-source` 支持仓级重建；
6. **crash 验收清单（F1–F6+E1–E4，等价持久化终态注入）**——power-loss 以"每个 fsync/rename 后可观察到的等价持久化终态"枚举注入（终态注入声明，非过程模拟）：

   - **F1** segment.tmp 写前；**F2** segment.tmp 截断；**F3** segment rename 后 manifest 前；**F4** segment manifest fsync 后 cursor tmp 写前；**F5** cursor tmp fsync 后 rename 前；**F6** cursor rename 后父目录 fsync 前——**拆 F6a（rename 持久化保留）/F6b（rename 丢失）双终态**；
   - **E1** stale lock / PID 复用：lock 记录=`PID+心跳时间+process-start token`（v4 补 token，使复用判定可测）；fixture 注入 process-liveness/process-start oracle，非等待真实复用；**E2** cursor 损坏四型分别编号断言：E2a 空 / E2b 截断 JSON / E2c 坏校验 / E2d 指向不存在 segment；**E3** rebuild 中途——rebuild 协议：写入 `generation-N` 新目录→校验→**原子切换代指针**→旧代保留至 validate 通过后清理（"中途"崩溃=旧代完整可回退）；**E4** compaction 交叉——compaction 取同一排它锁；report 固定 generation 快照（读代指针指向的 manifest）；旧 segment 仅当 **`segment_end_cursor ≤ compaction_watermark`** 才可删；
   - **注入契约（stats-1 契约票冻结，v4 定要求）**：named failpoint API（`--failpoint <F1..F6|E1..E4[:sub]> --failpoint-mode once --failpoint-state <dir> --clock <frozen> --process-liveness-oracle <fixture> --process-start-token <fixture>`）；每 failpoint 冻结：注入点（动作前/后）、一次触发语义、预期退出码、注入后应存在文件、重跑后 canonical event/segment/cursor 预期；平台不支持项=**SKIP 留痕**（非绿非红，验收清单注明 Windows/Linux 支持矩阵）；
7. **一致快照**：优先 ro 事务直连（含 timeout 重试）；回退 **`node:sqlite.backup()`（Online Backup API，D9'）**——ro 直连间歇性失败已两次实录（§2.4），双路径为必备；副本入随机私有 TEMP 子目录，try/finally 删除，**删除失败→exit≠0 + 下次启动扫描清理**；
8. **并发**：单机排它锁（locks/）；report 只读 closed segments（经 generation 快照）；report/collect/compaction 并发矩阵=stats-4 ⑦。

### 5.5 事件仓生命周期与 manifest 分层（v4 分层）

**四层 manifest（v4 显式分层，禁实现合并）**：

| 层 | 名称 | 用途 | 生命周期 |
|---|---|---|---|
| ① | **segment manifest** | events/ 内每 segment 的 closed 判定+SHA（恢复与 cursor 重建的依据） | 随 segment 永久（compaction 按 E4 水位） |
| ② | **bundle manifest** | `snapshots/<bundle_id>/manifest.json`——冻结四源（字段=§5.8 全集） | **被 report 引用的 bundle 不删（引用计数）；未被引用的保留最近 3 份** |
| ③ | **report manifest** | 引用 `bundle_id` + classifier_version + derivation selection policy + revision watermark + 事件 segment SHA + 时区/参数 | 随 report 文件永久 |
| ④ | cursor 状态 | cursors/——可从 ① 重建（E2） | 唯一提交点产物 |

retention 默认**永久保留**（计量元数据 ≈300B/请求行，年十万行≈30MB）+ 手动 compaction（E4 协议）；仓损坏→quarantine 后 `rebuild --from-source`（幂等，E3 generation 协议）。

### 5.6 report 输出契约

默认 **stdout 零落盘**；`--out` 为显式副作用，路径仅允许 `~/.agents/harness-stats/reports/`；历史序列 `reports/<iso-week-year>-W<ww>/<generated_at>-<manifest_sha8>.md`（跨年周归 ISO week-year，UTC/跨年 fixture=stats-4 ⑧）；report manifest 字段=§5.5-③。

### 5.7 身份与时区

`project_id` 为稳定身份（路径仅别名，改名/移路径不换身份）；注册表含 active/inactive 与别名史；**`source_instance_id`：首启生成（UUIDv4）持久化于 `~/.agents/harness-stats/config.json`，重装=新实例，多机合并按 (source_instance_id, entity_id) 去重**；事件存 **UTC**，报表显式时区（默认本地）+ `iso_week_year`；collect 检测源行数/max-id 回退即 fail loud（§5.4-3）；多机合并前置 clock-skew 报告。

### 5.8 bounded pilot（D4'，边界冻结 + 多源 bundle）

| 维度 | 边界 |
|---|---|
| 项目 | AITrader2（project_id 冻结入 bundle manifest） |
| 时段 | 2026-09-01T00:00Z 至 2026-10-01T00:00Z（**UTC 半开区间**；SQLite 侧时间字段=model_usage.started_at，metadata 侧=createdAt，均在 manifest 声明） |
| 源 | **pilot bundle（多源冻结，manifest=§5.5-②）**：①SQLite Online Backup 整库副本（SHA+行数+observed_at+eligible 范围谓词原文）②metadata corpus（见下）③docs/tickets 与 docs/reviews（pilot 时段在档票 slug 清单+目录+hash）④git HEAD |
| **metadata eligible 谓词（v4 冻结）** | `project 判定（cwd/workspaceRoot 归属 AITrader2，规范化 project_id 匹配）AND createdAt ∈ [2026-09-01T00:00Z, 2026-10-01T00:00Z)`；manifest 记：corpus root / 全量扫描数 / eligible 数 / 排除数+原因聚合 / project 判定字段与规范化值 / 时间字段与区间原文 / 逐 eligible 文件（相对路径+hash+size+createdAt+childSessionId）——**全机 599 份不得整批冻结** |
| 数据面 | 整库快照中匹配冻结范围谓词的全部 **eligible rows**；metadata 按 eligible 谓词清单冻结 |
| 事件保留 | 保留（进正式事件仓） |
| 产物 | pilot 评估报告：eligible repair episode 数、分类三率（§2.2-11）、五级归因分布——据此再裁全量回填 |

eligible repair episode 定义：attempt_kind=quality_rework + 归因∈{EXPLICIT, DIRECT, MANUAL_RECONCILED} + 终态 + 路由锚可得；不满足可识别性输出 `NOT_IDENTIFIABLE`。聚合恒等验收只对 eligible rows 判定。

## 6. 隐私与安全边界

- 只采 allowlist 计量元数据（§5.3）；不读 hindsight 配置面（其 NSSM 注册表含明文 KEY——采集器硬编码排除）；
- 报表**默认脱敏**：真实用户名/根路径打码；`--include-paths` 显式开启；"本机"≠无泄露；B3 脱敏检测入 stats-4 验收；
- **目录 ACL 不满足→exit≠0 fail-loud**；TEMP 副本协议与删除失败处置见 §5.4-7；
- 数据出本机（多机聚合/公开引用）= stats-6c 另批（D6'），未批前 blocked。

## 7. 与既有面的收编关系

| 既有面 | 关系 |
|---|---|
| docs/04 指标定义表 | 04=**定义权威**（三 pass 命名+分母已冻结）；**三仓旧"一次通过"列不做自动迁移**（D10'：口径互异且未冻结——本仓=按本票归因门项判定（非本票历史红项不改判）、web2api=首轮审查 pass 且 QA 无条件通过、AITrader2=全质量链零返工；历史 pass 以事件仓回填按三定义重算，旧列存档） |
| docs/13 复盘门 | 数据源切事件仓（机器可复算）；"每 5 票"触发判定机器化；13 号已加新旧命名对齐注记（2026-10-01 随 v3） |
| docs/metrics.md 台账（三仓） | 主从：事件仓=机器计数唯一源；metrics.md=人读摘要（行引 stats 快照） |
| B8 current-state | 部分覆盖，重叠部分 stats 供数 |
| B9 | **closure matrix=七子项全范围**（00 索引 B9 原文）：①injectAgentsMd 待核（02 状态注核对，归属 02）②skills 锚点包来源待核（16 §3，归属 16）③每 5 票计数域 ④无 metrics 行计票 ⑤修复票计票 ⑥唯一计数源 ⑦第 10 票复盘触发者与时机；③–⑦由 stats 定义并机判，①② stats 只登记闭合状态不代核；**七项全绿才删 B9 行** |
| archiver 卡 | SOP metrics 代录改引 stats 快照；新增"季度效能报告"步骤（角色卡变更走 dogfood 票+变体重铸链） |
| OPT-2 路由 | M4 路由对照=反馈闭环；路由锚自上线记录（§5.2） |
| 宪法 4a 步 | D7'：运行记录行补 childSessionId——独立 dogfood 票，不阻塞 stats-1…5 |
| B5 check-env | D9' 版本校验（Node ≥22.16）登记为该票联动项 |

## 8. 分期工单（验收全部机械化）

| 票 | 内容 | 验收标准（机械可判） |
|---|---|---|
| stats-1 | **契约冻结票（schema/contract freeze）——本票不实现生产 collect、不进入 stats-2** | 交付物九件：①**obligation inventory**（正文 MUST 逐条编号 O-xx：规范行/事件类型/JSON Pointer/required/nullability/validator rule/正负 fixture ID）②事件/游标/segment/四层 manifest schema（§5.5）③`validate-schema`：三层验证（JSON Schema 结构+跨字段+跨事件：身份唯一性/revision 单调/终态字段约束）④**状态映射表**（sqlite/metadata 源状态→七态，含 missing_child vs stale_orphan 判据）⑤**F/E failpoint 注入契约**（§5.4-6 全参数+每 failpoint 预期表+F6a/b、E2a-d 子型+平台 SKIP 矩阵）⑥pilot bundle schema 与过滤谓词（§5.8 含 metadata eligible）⑦held-out 分类器验收协议（§2.2-11 数据集隔离）⑧**§9 全约束→后续票 traceability matrix**（零漂移证明）⑨schema 上下位五条逐项验收条目。验收：正/负 fixture 全绿（每负例对应 validator rule 且 exit≠0）；受控命名检查：指标分层标题恰 M1–M4（正则断言），`L1–L4` 出现仅限**五处白名单语境**（§0/§4/§7/本条/附录）附判定清单；§9 裁决逐条落文 |
| stats-2 | ZCode adapter **bounded pilot**（§5.8 边界内，冻结 bundle 上开发） | ①同 bundle collect×2 → 事件数与 segment SHA 恒等；②running→terminal fixture：二次 collect 后 token/duration 非空且不重计；③unknown source 面：删列+**版本越界+model/status/role 分维 unknown>5%+schema fingerprint 变化**各一 fixture → 皆 exit≠0+cursor 冻结+零写入；④`.venv` 排除与大小写归一 fixture；⑤TEMP 残留=0（删除失败→exit≠0+启动清扫）；⑥F1–F6（含 F6a/b）+E1–E4（含 E2a-d）按契约注入逐项收敛；⑦bundle manifest 内 eligible metadata 总数与 role×status 聚合，collect 前后恒等（不写活库常数）；⑧状态机每值 ≥1 fixture（含 missing_child/stale_orphan+72h `--clock` 注入）+状态映射表逐行断言；⑨源行数/max-id 回退 fixture→fail loud；⑩双面一致性对账（§5.2）输出七类差异，超阈 fail-loud；⑪forbidden 字段负例（allowlist 拒绝且不落事件）；⑫bundle 引用计数保留 fixture（被 report 引用的 bundle 经 prune/清理尝试后仍在，§5.5-②——聚焦确认 P3 备注 2026-10-01 收口） |
| stats-3 | Kimi/Codex adapter + 票据/git miner + join + attempt 分类器（§2.2 协议实现） | ①host feature matrix 全格 VERIFIED/UNVERIFIED（含 adapter_type）；②Kimi usage→五路映射 fixture（reasoning=N/A 断言）；③Codex 父子 join：可得则归因，不可得→子代理成本标 unknown 不入角色桶；④归因 golden set（≥20 派发人工标注）出 precision/coverage；CANDIDATE 零入票级指标断言；⑤**分类器数据集隔离**：development_regression_set（36 例）逐例回归全绿不计 precision；held_out_acceptance_set（≥20 例新抽、与词典制定隔离）报告三率且过 §2.2-10 双门；classifier_version+derivation_revision 落事件断言；⑥AITrader2 pilot 时段票五级归因分布+三率报告 |
| stats-4 | report/verify 子命令 | ①同快照重跑 report → canonical JSON 字节恒等；②默认 stdout 零落盘；--out 仅白名单；③三 pass 指标分列输出；④verify 偏差超阈 exit≠0；⑤B3 脱敏检测对 report 产物零命中；⑥ACL 异常目录→exit≠0；⑦report/collect/compaction generation 并发矩阵 fixture；⑧UTC/ISO 跨年周桶 fixture（年末周归 week-year 断言） |
| stats-5 | M3–M4 + 路由对照 + archiver 卡改版 + B9 销账 | ①仅 verified 变更点出对照，不足 2 点输出 NOT_ENOUGH_CHANGE_POINTS（exit 0）；②每个对照点带 repo commit/local hash/卡 hash；③B9 七子项 matrix 全绿后删行（①②闭合证明由 02/16 权威面出具）；④窗口混票剔除规则实现前冻结入 spec 附录 |
| stats-6a（可选） | $ 估算 | LiteLLM 快照锁 revision+版本化；订阅模型 N/A 标注 fixture；跨模型合计列强制禁用 |
| stats-6b（可选） | diagrams 趋势图 | 沿用本仓 diagrams 管线约束（图源 docs/diagrams、产物公开仓） |
| stats-6c（blocked） | 多机聚合 | D6' 扩批前 blocked；前置=host identity/clock-skew/去重协议票 |

## 9. 决策记录（均已获用户批准；批准记录=2026-09-30/10-01 Zcode_T1 会话用户显式指令"批准"×3、"同意推荐，不做任何映射"）

| # | 决策 | 裁决 |
|---|---|---|
| D1' | 计量口径 | **usage-vector first·五路**：input/output/reasoning/cache-read/cache-write 分列；禁默认跨模型求和单值；$ 估算后置 stats-6a |
| D2' | 位置 | 事件仓 `~/.agents/harness-stats/`（子目录 §5.1）；工具分发位 `~/.agents/Harness-Engineering/templates/tools/` |
| D3' | 归因 | 五级置信度；EXPLICIT ＞ DIRECT ＞ MANUAL_RECONCILED；CANDIDATE 永不入票级指标 |
| D4' | 回填 | bounded pilot 先行（边界 §5.8 冻结），pilot 评估后再裁全量 |
| D5' | 分期 | stats-2=ZCode adapter pilot；Kimi/Codex 原生面=stats-3；首期不宣称 portable system 完成 |
| D6' | 出域 | 默认不出本机 + 默认脱敏；多机聚合=stats-6c 另批 |
| D7' | 运行记录增强 | 采纳 childSessionId 入运行记录行——独立 dogfood 票，不阻塞 stats-1…5 |
| D8' | stats-6 拆票 | 6a/6b/6c 独立验收，6c 在 D6' 扩批前 blocked |
| D9' | SQLite 备份实现路径 | **Node ≥22.16 + 原生 `node:sqlite.backup()`**（零第三方依赖；check-env 版本校验=B5 联动） |
| D10' | 历史 metrics 迁移 | **不做任何映射**：三仓旧列口径注记存档；历史 pass 以事件仓回填按 04 三定义重算为准 |

**规范内定硬约束**（冻结于 §5 正文；逐条验收映射=stats-1 交付的 traceability matrix，§8 各票引用）：三层身份公式×三类 revision、M2 derivation 读取语义（policy 钉定+最新有效+人工优先+历史仅 audit）、唯一 commit point+F/E 清单与注入契约、版本探针 fail-loud（分维度）、状态机七态+源映射+计数细则+双面一致性 fail-loud、UTC+iso_week_year、字段 allowlist+forbidden 负例、四层 manifest 分层与 bundle 引用计数、retention 永久+compaction 水位、源回退检测、排它锁+generation 快照读、report stdout 默认、pilot bundle eligible 谓词、分类质量双门+数据集隔离、schema 上下位五条。

## 10. 聚焦确认记录（2026-10-01 已完成，通过）

六项核对点全过：①§5.2 身份公式三类闭合+M2 读取语义；②§5.4 F/E 子型（F6a/b、E2a-d）+注入契约+E1 锁 token+E4 水位语义；③§5.5 四层 manifest 分层与 §5.8 metadata eligible 谓词；④§2.2 协议重排——**36 例回归集逐例复跑 36/36 绿**（四轮 held-out 暴露的 5 处不可接受结果全部由 v4 规则正确处理：3×rN 预处理规范化、1×条件式 initial、1×聚合行 compound_unparseable）；⑤§8 stats-1 契约票九交付物与 R6 新验收条目落位；⑥§2.4 observed_at 复核（含第四轮新增行）。唯一 P3 备注（retention/bundle 引用计数无独立验收）已补 **stats-2 ⑫** 收口。同日用户批准转正；后续=stats-1 契约冻结票（§8）。确认锚点：docs/22 v4 SHA-256=`41f60c38…8991` @2026-10-01T01:04+08:00。

## 附：变更映射

**v0→v1→v2→v3**（首轮 P0×4 / 二轮 P1×9 / 终审 P1×4）映射见 git 历史各版本文末，不再重复。

**v3→v4（第四轮 R1–R7）**：

| 第四轮发现 | v4 落点 |
|---|---|
| R1/P1-1 身份公式与 M2 读取语义 | §5.2 身份公式逐类闭合（含 source_primary_key 生成规则、observation subtype、derivation_revision 单调）+ M2 读取语义段（policy/最新有效/人工优先/历史仅 audit） |
| R2/P1-2 attempt 协议 | §2.2 重排：预处理 rN 规范化（§2.4 增证据行）、统一优先级序（消除规则 1/5 冲突）、initial 条件式（反例正例化）、聚合行 compound_unparseable、双门（合计>30% 降级+wrong>10% fail）、数据集隔离（36 例回归集/held-out 新抽） |
| R3/P1-3 failpoint 契约 | §5.4-6：named failpoint API+每 failpoint 预期表要求、F6a/b、E2a-d、E1 锁记录+process-start token、E4 segment_end_cursor≤水位、平台 SKIP 矩阵；stats-1 交付物⑤ |
| R4/P1-4 bundle metadata 谓词 | §5.8 metadata eligible 谓词冻结+manifest 字段全集；§5.5 四层 manifest 分层（P2-1 一并）+bundle 引用计数保留 |
| R5/P1-5 stats-1 粒度 | §8 stats-1 契约票化（九交付物：obligation inventory/三层 validate/状态映射/…）；L1–L4 白名单五处（纳入 §4 合法说明）；schema 上下位逐项验收 |
| R6/P1-6 三面零漂移 | §8 stats-2 ③⑥⑧⑨⑩⑪、stats-4 ⑦⑧ 新验收条目；§9 硬约束→traceability matrix 要求 |
| R7/P2-2/P2 §10 遗漏 | §10 补第六项 observed_at；00-index A 类列表加 22（采纳后生效注记）；04/13 本轮无改动（v3 注记维持） |
| D1 循环验证 | §2.2-11 数据集隔离+stats-3 ⑤ 拆两组 |
| D6 传播面 | §5.2 双面一致性校验（七类差异+超阈 fail-loud） |
| 聚焦确认 P3 备注 | stats-2 ⑫（bundle 引用计数保留 fixture，转正时收口） |
