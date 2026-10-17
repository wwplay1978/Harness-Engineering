# stats-1 · traceability matrix（§9 全约束零漂移证明 + 受控命名判定，契约冻结）

> 依据：docs/22 v4 @4c4d242 §9（行 328-343：D1'–D10' 裁决 + 硬约束清单——逐条验收映射=stats-1 交付的 traceability matrix）；§8 各票引用本文件。行号锚定同 obligations.md。
> 本文件承载票面交付物⑧（§9 全约束→后续票 traceability matrix + D1'–D10' 逐条落文）与⑨（schema 上下位五条逐项验收条目）+ 验收 5 的受控命名判定清单。
> 计数同步（2026-10-08 stats-2 阶段一契约修订原子批）：义务 39→**41**（新增 O-40=VR-F11 组合 sanity、O-41=VR-F12 role_status_counts）、负例 40→**42**（neg-VR-F11/neg-VR-F12）、正例 8 不变；docs/22 gap-6② 组合注记与契约面同提交（P0-3 裁决）。
> 字段同步（2026-10-12 stats-5 票级 merge 观察面批）：bundle manifest 可选字段 ticket_merges 扩（pilot-bundle-schema/manifest-schemas/bundle-manifest-v1/native-corpus-v1 三 schema 同步，additive 可选——create-zcode-pilot 逐 slug+create-native-corpus 通用扫描两制作面；义务/正负例计数不变）。
> 计数不变登记（2026-10-13 pilot-window-parameterization 窗口参数化批）：VR-S25/VR-S26 窗值 const 解钉为语义约束（schema+validator 跨字段）+两负例重锚（测语义非字面）——正 18/负 56/义务 48 计数零变更（重锚在位、无增删）。
> 计数不变登记（2026-10-13 pilot-window-parameterization r3 修复轮）：VR-S32 窗值 const 解钉为语义约束（native-corpus-v1.json schema+validator 跨字段——O-45 同步修订留痕；与 VR-S25/S26 同型，实现轮呈报、协调方裁定随票解钉）——正 18/负 56/义务 48 计数零变更（负例 neg-VR-S32-native-corpus-required 测缺 codex 必填节、窗字面自洽无需重锚、无增删）。
> 计数同步（2026-10-15 merge-anchor-materialization r2 批——追加方案门终判 (a)，docs/changes/merge-anchor-materialization.md）：observation subtype 增 `merge_anchor`（O-49=VR-S34 载荷恰三字段 allowlist+VR-S04 枚举扩；门裁定=22:204 subtype 枚举非封闭集，22 正文零改动）+O-28（VR-F03）扩 merge_anchor event_id 公式支（复用 `:obs:` hash 模式，hash8=sha256(canon({merge_oid,merge_ts}))——门 P1-1(ii)）——义务 48→**49**、正例 18→**19**（pos-16-merge-anchor-payload）、负例 56→**60**（VR-S34×3+VR-F03 merge_anchor×1）。
> 字段同步（2026-10-15 route-anchor-collection r2 批——追加方案门五 P1 全吸收，kimi-rac-gate-2026-10-15）：bundle manifest 可选字段 `route_anchor_freeze` 扩（pilot-bundle-schema/manifest-schemas/bundle-manifest-v1 两 schema 同步——zcode pilot bundle manifest 形状双定义位；native-corpus-v1 不适用〔kimi/codex 无 dispatch 源型〕，additive 可选——历史 bundle 无字段兼容，collect 投影遇缺=既有 unknown 桩面；不入 bundle_id 内容寻址〔P2-4〕；义务/正负例计数不变）。event-schema route_anchor 七字段零改动（P1-5：effective_model 恒 'unknown'——字段既有承载）。

## 1. D1'–D10' 决策落文矩阵（§9 行 330-341 逐条）

| # | 决策（裁决摘要） | stats-1 冻结位 | 实现/验收票 |
|---|---|---|---|
| D1' | usage-vector first·五路（input/output/reasoning/cache-read/cache-write 分列；禁默认跨模型求和单值；$ 后置） | event-schema usage 五键恰集（VR-S17）+ fixtures pos-01/02（缺路=null 不补零） | stats-3 ②（Kimi→五路映射 fixture，reasoning=N/A 断言）；stats-6a（$ 估算，订阅模型 N/A 标注） |
| D2' | 事件仓 `~/.agents/harness-stats/`（子目录 §5.1）；工具分发位 `~/.agents/Harness-Engineering/templates/tools/` | （目录布局非 schema 面——manifest 四层目录语义冻结于 manifest-schemas/ 注释） | stats-2（仓落成+SYNC 接线归后续发布票） |
| D3' | 五级置信度；EXPLICIT＞DIRECT＞MANUAL_RECONCILED；CANDIDATE 永不入票级 | attribution 枚举（VR-S11）+ 上三级⇒ticket_slug 非空（VR-F08） | stats-3 ④（golden set precision/coverage + CANDIDATE 零入票级断言） |
| D4' | bounded pilot 先行（边界 §5.8 冻结）。**修订留痕（pilot-window-parameterization，2026-10-13：窗口参数化裁决——上游裁决=本票承接）**：窗值 const 解钉为语义约束（--from/--until 参数化、缺省九月窗生成值同原冻结字面） | pilot-bundle-schema.json（时段半开语义约束 VR-S25：RFC3339 规范形+from<until+bounds/time_interval 照实派生 + eligible 谓词按窗照实 VR-S26） | stats-2（pilot 冻结执行+⑦恒等+⑫引用计数）；pilot-window-parameterization（五冻结点参数化+契约解钉） |
| D5' | stats-2=ZCode adapter pilot；Kimi/Codex 原生面=stats-3；首期不宣称 portable 完成 | （分期声明非 schema 面） | stats-2 / stats-3 票面 |
| D6' | 默认不出本机+默认脱敏；多机聚合=stats-6c 另批 | （隐私红线由 allowlist 承载：schema 字段全量=计量元数据，无正文/消息/代码字段） | stats-4 ⑤（B3 脱敏检测零命中）；stats-6c（blocked，D6' 扩批前） |
| D7' | 运行记录行补 childSessionId——独立 dogfood 票 | （不阻塞 stats-1…5；pilot 可低置信跑，§5.2 行 230 注记） | dogfood 票（独立，非 stats-N） |
| D8' | stats-6 拆 6a/6b/6c 独立验收 | （拆票声明非 schema 面） | stats-6a/6b/6c 票面 |
| D9' | Node ≥22.16（TEMP 封闭副本只读打开=node:sqlite 消费面基线）+ 纯文件复制协议+三方摘要恒等（copy==before==after）。**修订留痕（snapshot-aba-hardening，2026-10-12 改裁）**：原裁 Online Backup 因零写入红线退役 | 本票环境断言：validate-schema 仅 node: 标准库（fs/crypto/path），禁 node:sqlite（不触源）——工具头注已冻结 | stats-2 改裁 2026-10-12+snapshot-aba-hardening 三方恒等收口；B5 check-env 版本校验联动 |
| D10' | 历史 metrics 不做任何映射；三仓旧列存档；重算以事件仓为准 | （口径权威=docs/04 §4，非本票 schema 面） | stats-4 ③（三 pass 分列输出）+ docs/04 注记（已随 v3 存档） |

## 2. §9 硬约束清单（行 343 十五项）→ 冻结位与后续票

| # | 硬约束（行 343 逐项） | stats-1 冻结位 | 实现/验收票 |
|---|---|---|---|
| H1 | 三层身份公式×三类 revision | obligations O-26–O-30（VR-F01-F05：entity 三元/dispatch·mr=entity:revision/obs=…:obs:hash8/derived=…:drv:revision/append-only 恒 1） | stats-2 ①②（collect×2 恒等+running→terminal 不重计） |
| H2 | M2 derivation 读取语义（policy 钉定+最新有效+人工优先+历史仅 audit） | event-schema derived.derivation_origin {auto,manual}（VR-S08 注记：manual＞auto 载体）+ report-manifest.derivation_selection_policy 必记（VR-S21） | stats-4 ①③（canonical 重跑恒等+三 pass 分列）；历史派生禁入 M2=M2 计算面 |
| H3 | 唯一 commit point + F/E 清单与注入契约 | failpoint-contract.md（提交链坐标系+API 全参数+预期表+canonical 口径） | stats-2 ⑥（F1–F6 含 F6a/b、E1–E4 含 E2a-d 逐项收敛） |
| H4 | 版本探针 fail-loud（分维度 unknown>5% 默认阈） | （adapter 行为契约=22 §5.3，schema 侧承载 adapter_type/known_enum_values 声明位） | stats-2 ③（删列/版本越界/分维 unknown>5%/fingerprint 变化各一 fixture→exit≠0+cursor 冻结+零写入） |
| H5 | 状态机七态+源映射+计数细则+双面一致性 fail-loud | state-mapping.md（映射表 M1-M9+互斥判据+计数细则+迁移图）+ O-12/O-31/O-32 | stats-2 ⑧⑩（每态 ≥1 fixture+逐行断言；双面七类差异超阈 fail-loud） |
| H6 | UTC + iso_week_year | O-14（VR-S14：RFC3339 Z 规范形**+语义范围**——2026-10-07 审查轮收紧：字形过后追加月 01-12/日按月天数/时 00-23/分/秒 00-59 判定，负例 neg-VR-S14-timestamp-semantic）+ report-manifest.timezone 必记 | stats-4 ⑧（UTC/ISO 跨年周桶 fixture） |
| H7 | 字段 allowlist + forbidden 负例 | schema additionalProperties=false 全覆盖（多余字段即拒，VR-S05…S24 各必带集） | stats-2 ⑪（forbidden 字段负例：allowlist 拒绝且不落事件） |
| H8 | 四层 manifest 分层与 bundle 引用计数 | manifest-schemas/ 四件（分层禁合并：各 manifest_kind 独立 schema） | stats-2 ⑫（被 report 引用 bundle 经 prune 后仍在）+ stats-4 ⑦（并发矩阵） |
| H9 | retention 永久 + compaction 水位 | failpoint-contract.md E4（segment_end_cursor≤compaction_watermark 才可删） | stats-2 ⑥-E4；retention 默认永久=仓配置面（stats-2） |
| H10 | 源回退检测（行数/max-id 回退即 fail loud） | （采集行为契约=22 §5.4-3；cursor schema 承载 terminal_cursor 复合推进位） | stats-2 ⑨（回退 fixture→fail loud） |
| H11 | 排它锁 + generation 快照读 | failpoint-contract.md E1（锁三字段）+ E3（generation-N 协议）+ E4（report 固定 generation 快照） | stats-2 ⑥-E1/E3；stats-4 ⑦（report/collect/compaction 并发矩阵） |
| H12 | report stdout 默认（--out 仅白名单 reports/） | report-manifest-v1.json 注记（report 输出契约=22 §5.6） | stats-4 ②（默认 stdout 零落盘+--out 白名单） |
| H13 | pilot bundle eligible 谓词。**修订留痕（pilot-window-parameterization，2026-10-13：窗口参数化裁决）**：谓词原文 const→按窗生成照实记录 | pilot-bundle-schema.json（谓词按窗照实 VR-S26+时段语义约束 VR-S25+eligible 计数自洽 VR-F10） | stats-2 ④⑦（.venv 排除/大小写归一；eligible 总数与聚合恒等）；pilot-window-parameterization（解钉+负例重锚恰中） |
| H14 | 分类质量双门 + 数据集隔离 | classifier-acceptance.md（36 例回归集/held-out ≥20 新抽/合计>30% 降级+wrong>10% fail/三率口径） | stats-3 ⑤（双门+隔离验收） |
| H15 | schema 上下位五条 | 本文件 §3（逐项验收条目） | 持续约束（每张 stats 票 review 门） |

## 3. schema 上下位五条逐项验收条目（§5.2 行 234 ①–⑤；票面交付物⑨）

| 条 | 正文语义 | 验收条目（本票执行结果） | 判定 |
|---|---|---|---|
| ① | 22 正文=规范上位面 | 本票全部交付物以正文行号锚定（obligations.md 表/各 schema spec_anchor）；feat 分支对 docs/22（及 00/04/13、docs/tickets/）diff 为空——验收 7 命令复核 | 过（验收 7 证据） |
| ② | schema 只能细化、不得改写正文语义 | 细化裁决全部登记挂起：分隔符细化（gap-1）/判据冻结（gap-2）/checksum 字段（gap-3）/载荷 allowlist 延后（gap-4）/审查轮 spec 存疑三件（gap-5）/E4 segment 引用保护+组合注记（gap-6）——见 docs/changes/stats-1-gap-*.md，零静默吸收 | 过（6 件（gap-1..6）记录在档） |
| ③ | 正文每条 MUST 均须有 obligation 条目（O-xx 六列） | obligations.md 41 条 O-xx（O-01…O-39=stats-1 @4168cad 冻结；O-40/O-41=stats-2 阶段一契约批 2026-10-08，规范行/事件类型/JSON Pointer/required/nullability/validator rule/正负 fixture ID 六列齐备）；对账契约四条 | 过（验收 4 对账 41/41） |
| ④ | schema 新增影响指标、隐私或事件身份的字段→回方案门，不得实现票内自由扩张 | 本票新增字段审计：信封键（fixture_kind/description=验证器管道键，非事件字段）；payload_sha256（cursor 完整性载体，E2c 可判的前提——不触指标/隐私/身份公式，gap-3 挂起）；derivation_origin（正文行 221「manual＞auto」的直接承载，非新语义）；open_set/committed_segments（正文 §5.4-2/④层语义的结构化）——**无影响指标/隐私/事件身份的新增** | 过（无回方案门项） |
| ⑤ | 正/负 fixture 覆盖全部 obligation（每负例对应 validator rule），非任取三例 | 41 义务 × 正 8/负 42 全覆盖；每负例恰中其文件名编码规则（套件断言报出集合=单例）；双向对账（负例引用恰一义务、正例无孤儿）。VR-S14 收紧后双负例（字形/语义各一，同规则多负例逐件恰中判定不变） | 过（套件全绿证据） |

## 4. 受控命名判定清单（票面验收 5；22 §8 stats-1 行「受控命名检查」）

**断言 A：指标分层标题恰 M1–M4。** 命令 `grep -oE '\*\*M[0-9] [^*]+\*\*' docs/22-effectiveness-statistics.md` → 恰四行：`**M1 运行计量**`/`**M2 质量计量**`/`**M3 流动计量**`/`**M4 趋势与摩擦**`（§4 表首列）；无 M5+ 层、无弃用层名入标题。正文 M-记号他处出现（M1×6/M2×11/M3×3/M4×7）均为引用非标题。判定：**过**。

**断言 B：弃用层名（正则 `L[1-4]`）在 docs/22 仅限五处白名单语境（§0/§4/§7/§8/附录）。** 逐处判定（token 实例 6 个=区间短语 3 处，各含首尾两 token）：

| 行 | § 归属 | 语境 | 白名单判定 |
|---|---|---|---|
| 158 | §4（表格上方注记） | 「v0 曾用…与 04 号质量门禁撞名，v1 起统计层一律 M1–M4」——弃用声明本身 | §4 ∈ 白名单 → 合法 |
| 319 | §8（stats-1 票面行） | 验收条款原文「出现仅限五处白名单语境…附判定清单」——本清单的规范来源 | §8 ∈ 白名单 → 合法 |
| 361 | 附录（v3→v4 变更映射） | R5 行「白名单五处（纳入 §4 合法说明）」——变更史记录 | 附录 ∈ 白名单 → 合法 |

§0 与 §7 当前零出现（白名单语境允许 0..n 处）。判定：**过**（3 处短语全部落入白名单 §4/§8/附录，无越界）。

**断言 C：`templates/stats/` 与 `harness-stats.mjs` 全文弃用层名出现=0。** 命令 `grep -rE 'L[1-4]' templates/stats/ templates/tools/harness-stats.mjs | wc -l` → `0`（本清单以正则形 `L[1-4]` 指称该名，不落字面）。判定：**过**。

## 5. 零漂移复核命令（QA/reviewer 可直接重跑）

```bash
# 验收 5（受控命名）
grep -oE '\*\*M[0-9] [^*]+\*\*' docs/22-effectiveness-statistics.md
grep -nE 'L[1-4]' docs/22-effectiveness-statistics.md        # 期望仅 158/319/361 行
grep -rE 'L[1-4]' templates/stats/ templates/tools/harness-stats.mjs | wc -l   # 期望 0
# 验收 7（正文零改动）
git diff main -- docs/22-effectiveness-statistics.md docs/00-index.md docs/04-eval-observability.md docs/13-metrics-review-1.md docs/tickets/
# 验收 2/3/4（套件）
node templates/tools/harness-stats.mjs validate-schema templates/stats
```
