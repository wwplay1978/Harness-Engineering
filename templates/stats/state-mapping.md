# stats-1 · 状态映射表（源状态 → 规范七态 + 计数细则，契约冻结）

> 依据：docs/22 v4 §5.2 行 228（状态机与源状态映射——映射表=stats-1 契约票交付冻结）；源值实测分布见 §2.1/§2.4（I: 数字只作可行性证据，不替代协议对未来异常行的定义）。
> 消费方：stats-2（ZCode adapter 逐行映射断言=验收⑧"状态机每值 ≥1 fixture+映射表逐行断言"）。

## 1. 规范七态

`observed_running / terminal_completed / terminal_failed / terminal_cancelled / stale_orphan / missing_child / unknown`

## 2. 源状态 → 规范态映射表

### 2.1 sqlite `model_usage.status`（model-request 事件）

| 源值 | 规范态 | 备注 |
|---|---|---|
| `completed` | terminal_completed | 终态行 token/duration 已原地补写（VR-F09 前提） |
| `error` | terminal_failed | — |
| `cancelled` | terminal_cancelled | 计数单列（见 §4） |
| 其他/空/未来新值 | unknown | **数据事实不替代协议对未来异常行的定义**（22 §2.4）；unknown 只计数、不入任何率；unknown 占比超阈走 adapter `UNSUPPORTED_SOURCE` 判定（22 §5.3） |

### 2.2 metadata `status`（dispatch 事件；`~/.zcode/cli/agents/<sess>/agent_*/metadata.json`）

前置记号：`childInSource` = 该记录的 childSessionId（非空时）存在于源 session 表。

| # | 源值 | child 引用情形 | 规范态 | 备注 |
|---|---|---|---|---|
| M1 | `completed` | childInSource=true | terminal_completed | completedAt→墙钟 |
| M2 | `completed` | childInSource=false（悬空） | **missing_child** | 引用完整性错误，**无论时长**；计入失败率 |
| M3 | `failed` | childInSource=true | terminal_failed | — |
| M4 | `failed` | childInSource=false（悬空） | **missing_child** | 同 M2 |
| M5 | `running` | child 在源且未终 | observed_running | 入 open-set 每轮重读；**双侧投影义务**：child 已终→按源终态重判（mapMetadataState+childTerminal 单源）须在 collect 侧与 bundle 侧 role_status_counts 投影同款执行（stats-2-gap-2 裁决②回灌 2026-10-10；裁决①②，恒等验收承载） |
| M6 | `running` | child 悬空或缺失，且（collect 时钟 − createdAt）≤ 72h | observed_running | **宽限窗**：child 可能滞后出现；下轮重判 |
| M7 | `running` | child 悬空或缺失，且（collect 时钟 − createdAt）＞ 72h，且无 token | **stale_orphan** | 时钟字段=collect 时刻 UTC，测试经 `--clock` 注入（failpoint-contract.md） |
| M8 | `running` | child 悬空/缺失且＞72h 但**有 token** | unknown | 矛盾形态（token 在而 child 行不在，疑源清理）；照实计数不硬猜 |
| M9 | 其他/空 | — | unknown | 同 2.1 备注 |

注：`running` + child 在源且已终而 metadata 未更新 → 以**源 session/model_usage 侧终态**为准重判（M1/M3 同款判据），metadata 与 session 表不一致记双面一致性差异（22 §5.2 双面校验，stats-2 ⑩）。

### 2.3 Kimi 原生面 `wire.jsonl` 行（model-request 事件；stats-3 阶段一契约批新增——票载裁决⑥，stats-3-gap-2 回灌位）

> **append-only 语义（裁决⑥冻结）**：行不可变、**ingest 即终态映射**（无迁移语义；observed_running 仅 ZCode metadata 面存在；§5.4-2 open-set 不适用——原生面恒空集）。
> **原生面事件形态（裁决⑤）**：仅产 model-request 事件（parent_entity_id=null），不产 dispatch；project 归因=eligible 谓词在 corpus 冻结时执行（workDir→注册表，裁决⑧）；票级/attempt 指标不涉原生面。

| # | 源行形态（type ∈ §5.3 allowlist {usage.record, step.end, profile.bind, metadata}） | 规范态 | 备注 |
|---|---|---|---|
| K1 | `usage.record` 行（usage 四字段在场） | terminal_completed | 计量行已记账=请求完成；行时戳→started_at；duration 不可观=null（O-34 排除面注记：append-only 行无"running→terminal 原地补写"协议——VR-F09 duration 子句适用 mutable-row） |
| K2 | `step.end` / `profile.bind` / `metadata` 行 | 不独立成事件 | 辅行（type allowlist 只决定可读面；profile.bind 供模型别名对账） |
| K3 | 行时间戳不可解析 | unknown | 只计数不入任何率；started_at=epoch-0 显式哨兵（1970-01-01T00:00Z——三级锚全缺的可机械判别标记，禁采集时刻冒充；P3-9 返修） |
| K4 | 其他/未来新 type | 不读（allowlist 外跳过） | §5.3 type allowlist 强制；usage 四字段缺列→UNSUPPORTED_SOURCE（fingerprint 面） |

### 2.4 Codex 原生面 `sessions/**/*.jsonl` 行（model-request 事件；stats-3 阶段一契约批新增——同裁决⑥）

| # | 源行形态 | 规范态 | 备注 |
|---|---|---|---|
| C1 | `token_count` 行（total_token_usage 在场） | terminal_completed | token_count=会话内累计快照（22 §2.1 记档形态）→逐请求增量=相邻行差分（折算 fixture=阶段二；负增量→增量记 0 并留痕） |
| C1b | `token_usage_record` 行（payload.usage{input_tokens,output_tokens} 在场） | terminal_completed | **现行宿主形态（2026-10-09 真实冻结实证，stats-3 阶段二追加行）**：逐请求直取值（OTel 命名族 input/cached_input/cache_write_input/output/reasoning_output_tokens）——无累计语义、不差分 |
| C2 | `turn_context` 行 | 不独立成事件 | 辅行（模型名承载：payload.model） |
| C3 | `session_meta` 行 | 不独立成事件 | 辅行（cwd→project 归属、会话包络） |
| C4 | 行时间戳不可解析 | unknown | 同 K3（含 epoch-0 哨兵承载） |
| C5 | spawn_agent 子 rollout：父子 join 可得 | （子行按 C1 同判） | 归因留痕=collect 输出 join 映射；事件 parent_entity_id 恒 null（裁决⑤+VR-X03 指向 dispatch 的冻结语义） |
| C6 | spawn_agent 子 rollout：join 不可得 | （子行按 C1 同判） | 子代理成本标 unknown 不入角色桶（22 §8 stats-3 ③；断言降级路径） |

**七态适用面注记**：observed_running / stale_orphan / missing_child / terminal_failed / terminal_cancelled 在 append-only 原生面**无产生规则**（行不可变、无 running 中间态、无 child 引用语义、无取消信号——terminal_cancelled 仅 ZCode metadata 面产生）——表中不设行即冻结不适用。

## 3. missing_child vs stale_orphan 互斥判据（冻结）

**正文定义**（22 §5.2 行 228）：missing_child=「childSessionId 引用不存在于源，**无论时长**——引用完整性错误」；stale_orphan=「running 且超 72h 无 child 会话与 token」；两者互斥。

**交叠与裁决**：字面读法下「running+悬空+＞72h」同时满足两定义，互斥不成立；正文自身实证（22 §2.1 行 37：I: 5 例 stale running 孤儿=running+childSessionId 皆不在 session 表）将该形态判归 stale_orphan。故本票冻结判据为**记录自身生命周期claim 维度的二分**：

1. 记录自身已声明终态（status ∈ {completed, failed}）而 childSessionId 悬空 → **missing_child**（"无论时长"限定词作用于本分支：任何时长的终态记录悬空都算，不看 72h）；
2. 记录仍 running：≤72h → observed_running（宽限）；＞72h 且无 child 无 token → **stale_orphan**（时长判据仅存在于本分支，时钟=collect 时刻 UTC）。

两分支按记录 status 互斥不重叠，结构性保证互斥。裁决依据与挂起回灌记录：`docs/changes/stats-1-gap-2.md`。

## 4. 计数细则（22 §5.2 行 228 逐条冻结）

| 细则 | 冻结语义 |
|---|---|
| stale_orphan | **计派发**（进 M1 派发次数分母/分子口径按角色统计）；**不计失败**；**不计墙钟**（schema 承载：completed_at/wall_clock_ms 双 null，VR-F06） |
| missing_child | **计入失败率**（终态声明无法核实按失败面处理） |
| terminal_cancelled | **单列输出**；不入失败率；不入 rerun 分母 |
| unknown | **只计数**（unknown 占比随报），不入任何率 |
| rerun 率分母 | = terminal_completed + terminal_failed（cancelled/missing_child/stale_orphan/unknown 皆不入分母；missing_child 另入失败率分子） |
| 墙钟 | Σ(completedAt−createdAt)（VR-F07 结构承载）；并行派发重叠→墙钟与串行两口径（报表侧，22 §4 M1） |

## 5. 状态迁移（同实体 source_revision 链，不换键不丢史）

```text
observed_running ──(child 终态补写/记录更新)──→ terminal_completed | terminal_failed | terminal_cancelled
observed_running ──(＞72h 无 child 无 token)──→ stale_orphan          # 每轮重判，可随源更新迁移
observed_running ──(记录终态+悬空)──────────→ missing_child          # 同上，源滞后补齐后可迁移
stale_orphan    ──(child 出现并终态)────────→ terminal_*             # 复活路径，新 revision 承载
missing_child   ──(child 出现并终态)────────→ terminal_*
任意 ──(源值不可判)──→ unknown
```

每次迁移=同 entity_id 新 source_revision（append-only 恒 1 除外——append-only 行不可变，无迁移）；历史 revision 全保留（22 §5.2 行 222-223）。

## 6. 对账锚

- 义务：O-12（七态枚举 VR-S12）、O-31（终态字段约束 VR-F06）、O-32（墙钟公式 VR-F07）——见 obligations.md；
- fixtures：pos-03-metadata-lifecycle-states.json 覆盖 M2/M6/M7/terminal_cancelled/unknown 五形态；neg-VR-S12 / neg-VR-F06 / neg-VR-F07 为对应负例；
- stats-2 验收⑧联动：状态机每值 ≥1 fixture + 本表逐行断言（72h 边界经 `--clock` 注入）。
