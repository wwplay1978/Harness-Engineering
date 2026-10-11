# stats-3 · host feature matrix（Kimi/Codex 原生 adapter 宿主特征矩阵，版化冻结）

> 依据：docs/22 §5.3（adapter 声明：adapter_id/adapter_type/source_version/supported_version_range/schema_fingerprint/known_enum_values/unknown 计量）+ stats-3 票面阶段二（全格 VERIFIED/UNVERIFIED；**关键格（五路映射/状态映射/join）须 VERIFIED 或带断言降级路径**；Codex token_count 累计语义专列格+折算 fixture）+ 方案门 P3-2（"全格 UNVERIFIED 也算全格"的放行口径已修）。
> 证据位：tests/stats3/native-adapter.test.mjs（合成 fixture 面）；真实源形状格=冻结接触实证（snapshots/<corpus_id>/manifest.json + source-zero-write-evidence.json）。
> 版本：matrix-v1（2026-10-09 阶段二冻结；真实 corpus 冻结后回填真实形状格）。

## 1. Kimi（adapter_id=kimi-wire）

| 格 | 值 | 状态 | 证据 |
|---|---|---|---|
| adapter_type | append-only | VERIFIED | VR-F05 恒 1 断言（幂等测试） |
| source_version / supported_version_range | native-corpus 契约 v1 / [1,1] | VERIFIED | ③ 版本越界探针（--corpus-version-probe 2→exit 60） |
| schema fingerprint | usage.record 必需 {model, usage}；行 type 集合 canonical SHA | VERIFIED | ③ 缺必需字段探针（exit 60） |
| type allowlist（§5.3） | type∈{usage.record, step.end, profile.bind, metadata} 外跳过 | VERIFIED | 五路映射测试（message 行不成事件） |
| **五路映射（关键格）** | input=inputOther/output=output/**reasoning=null（N/A 断言）**/cache_read=inputCacheRead/cache_write=inputCacheCreation | **VERIFIED** | 五路映射测试逐值断言+pos-13 契约 fixture |
| **状态映射（关键格）** | usage.record→terminal_completed；辅行不成事件；时戳不可解析→unknown | **VERIFIED** | A9 测试+state-mapping §2.3 逐行断言 |
| workDir→project 归因 | session_index.jsonl workDir→注册表基面（会话目录级 join） | VERIFIED | 冻结测试（非本项目排除） |
| 行时戳字段 | 容忍链 timestamp/time/createdAt/created_at/ts（顶层或 payload 内）→不可得 mtime-approx | VERIFIED（真实源见 §4） | 冻结测试 mtime_approx 计数 |
| 游标（裁决⑦） | id=relpath#line；字典序→行号全序；size/hash 回退 fail-loud | VERIFIED | 幂等测试+③ 探针组 hash 回退 |
| UNSUPPORTED_SOURCE 探针 | model 维 unknown>5%+缺必需字段+版本越界+文件回退（独立） | VERIFIED | ③ 探针组 |
| **role/status 维（§5.3 三类枚举）** | **N/A**（裁决⑤：原生面无角色面——不产 dispatch、无 agent 名；status 维=行 type 承载于事件 status 字段，无枚举白名单面） | N/A（显式声明） | 本行=矩阵声明（无测试对象） |
| usage.record 行级时间戳真实字段名 | 见 §4 真实冻结回填 | VERIFIED（冻结后） | corpus manifest time_field |
| duration 可观测性 | 不可观（usage.record 无时长字段）→duration_ms=null（O-34 细化） | VERIFIED | pos-13+O-34 注记 |

## 2. Codex（adapter_id=codex-sessions）

| 格 | 值 | 状态 | 证据 |
|---|---|---|---|
| adapter_type | append-only | VERIFIED | 同上 |
| source_version / supported_version_range | native-corpus 契约 v1 / [1,1] | VERIFIED | ③ 探针 |
| schema fingerprint | token_count 必需 {payload.info.total_token_usage}；session_meta 必需 {payload.cwd}；turn_context 模型名 | VERIFIED | ③ 探针（token_count 缺字段 exit 60） |
| **token_count 累计语义（P2-1 专列格）** | total_token_usage=会话内**累计快照**（22 §2.1 字段名）→逐请求增量=**相邻行差分**；负增量（计数重置）→该路记 0+anomaly 留痕 | **VERIFIED（折算 fixture）** | 累计折算测试（500→800 折算 300，不重复计数）；真实面=§4 冻结差分核对 |
| **五路映射（关键格）** | input=input/output=output/reasoning=reasoning/cache_read=cached/cache_write=cache_write | **VERIFIED** | 累计折算测试逐值断言 |
| **状态映射（关键格）** | token_count→terminal_completed；辅行不成事件；时戳不可解析→unknown | **VERIFIED** | A9 测试+state-mapping §2.4 |
| **spawn_agent 父子 join（关键格）** | 子 rollout session_meta 父引用（parent_id/parent_session_id/parentRolloutId 容忍链）命中本 corpus 会话身份→join 可得（join_map 归因留痕）；悬空/缺失→unattributed（子成本标 unknown 不入角色桶）；事件 parent_entity_id 恒 null（裁决⑤+VR-X03） | **VERIFIED（双路径断言）** | join 双路径测试（可得+不可得）；真实源父引用字段名=§4 冻结回填 |
| workDir→project 归因 | session_meta.payload.cwd→注册表基面 | VERIFIED | 冻结测试 |
| model 名承载 | turn_context.payload.model（缺失→model 维 unknown 计量） | VERIFIED | ③ model unknown 探针（1/4>5%→60） |
| 游标（裁决⑦） | 同 Kimi | VERIFIED | 同 Kimi |
| 真实源行字段名/时戳 | 见 §4 | VERIFIED（冻结后） | corpus manifest |

## 3. zcode-sqlite（stats-2 面不变，对照行）

adapter_type=mutable-row；五路=源列直取；状态映射=state-mapping §2.1/§2.2——全部 VERIFIED（stats-2 验收⑧，tests/stats2/collect.test.mjs）。stats-3 增量面：多 adapter 共享世代目录判属过滤（loadCorpus {adapterId}）——VERIFIED（E2 重建测试"跨 adapter 段不串味"）。

## 4. 真实源冻结回填（2026-10-09 一次性接触，corpus=native-aitrader2-202609-95c5017e；台账见完工报告）

| 项 | Kimi | Codex |
|---|---|---|
| 行时戳字段实测 | `time`（epoch ms；metadata 行=`created_at` epoch ms）——rowTimestamp 容忍链命中 | `timestamp`（ISO 字符串，行顶层）——容忍链命中 |
| session_index/会话身份 | **全局单文件** `~/.kimi-code/session_index.jsonl`，逐行 {sessionId, sessionDir, workDir}——会话目录级 join（逐目录索引形态不成立，2026-10-09 实测修正） | session_meta.payload.{id/session_id, cwd, timestamp, thread_source} |
| 计量行形态 | `usage.record`={type, agentId, model, usage, usageScope, time}（usage 四字段=22 §2.1 采样档）；**pilot eligible 集内 0 行 usage.record**（唯一窗内会话=中止于 llm.request 前）——真实五路逐值验证待后续 corpus，本格证据=合成 fixture VERIFIED | **现行形态=`token_usage_record`**：payload.usage{input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens}=**逐请求直取**（无累计语义，不差分）；22 §2.1 记档的 `token_count`+info.total_token_usage 累计形态保留为 legacy 双形态（差分 fixture VERIFIED） |
| 累计差分实证 | — | 真实集=逐请求直取（差分不适用）；legacy 差分逻辑=合成 fixture VERIFIED（500→800 折算 300） |
| 父引用/子会话 | —（Kimi 无子代理面） | eligible 27 会话全为 thread_source=user（**pilot 窗内无 spawn_agent 子会话**——join 机制=合成双路径 fixture VERIFIED；真实子会话面待后续 corpus） |
| 模型名承载 | usage.record.model（会话级 profile.bind.modelAlias 备查） | turn_context.payload.model（实测 'gpt-5.6-sol'） |
| 真实采集结果 | events=0（诚实 no-op；中止会话无计量行） | **events=991**（27 会话；seg-0002 SHA c71a1831…；unknown_ratio=0） |
| 冻结工件 | snapshots/native-aitrader2-202609-95c5017e/manifest.json+source-zero-write-evidence.json | 同左 |

## 5. 降级路径声明（关键格 P3-2 口径）

- join 不可得路径：unattributed children 清单随 collect 输出（不标 role/不并入父成本桶）——**断言降级**而非静默；
- 时戳不可得路径：mtime-approx 注记（manifest time_field）+事件 state 沿 K1/C1（session_first_at 兜底）——K3 仅在全部兜底缺失时触发；
- 无已知 SKIP 项（Windows/Linux 同形态；纯文件系统/JSON 解析无平台分支）。
