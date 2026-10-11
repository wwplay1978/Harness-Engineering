# stats-1 · F/E failpoint 注入契约（增量采集一致性验收，契约冻结）

> 依据：docs/22 v4 §5.4-6（行 251-255：crash 验收清单 F1–F6+E1–E4 + 注入契约——**stats-1 契约票冻结要求**，v4 定）；消费方=stats-2 验收⑥（F1–F6 含 F6a/b、E1–E4 含 E2a-d 按契约注入逐项收敛）。
> 范围声明：本票只冻结契约文本；`harness-stats.mjs` 本票仅含 `validate-schema` 子命令——下列参数面由 stats-2 的 `collect` 子命令承接，不构成本票实现项。
> 修订留痕：2026-10-08 stats-2 复审轮（developer-rerun attempt 3）修订 E3 行——「validate 通过后清理旧代」改「旧代保留至显式 prune（保守清理）」，对齐实现与 prune 现状（保守保留令 E3 回退语义受益）；裁决=裁契约侧，不改 docs/22 正文。
> 修订留痕：2026-10-09 stats-2 三审轮（developer-rerun attempt 4）修订 E4 行拆分——E4 主型=契约语义矩阵（非注入面：compact↔collect 互斥、report 固定 generation、引用段保留、水位上段保留）；原「新代已写指针未切 exit 70」注入通道保留为 **E4:pre-switch** 子型（compact `--failpoint E4:pre-switch`）。同轮 API 收口：**裸 E1 非法**（E1 注入位=锁竞争形态，子型 alive|dead|reuse 必填——`--failpoint E1` 拒绝）；裁决=裁契约侧，不改 docs/22 正文（同 E3 先例）。

## 1. 提交链与注入点坐标系（22 §5.4-4 行 249）

```text
①写 segment.tmp → ②数据 fsync → ③rename 为正式 segment → ④写 segment manifest+fsync
   → ⑤写 cursor 临时文件+fsync → ⑥cursor 原子 rename（=唯一提交点）→ ⑦父目录 fsync
        F1→①前    F2→①中断(截断)    F3→③后④前    F4→④后⑤前
        F5→⑤后⑥前    F6→⑥后⑦前（拆 F6a rename 保留 / F6b rename 丢失）
```

power-loss 与进程 crash 按同一保证等级覆盖（fsync 纪律）；**注入方式=等价持久化终态注入**（终态声明，非过程模拟）：每 failpoint 直接摆出崩溃后可观察到的文件系统终态。

## 2. API（named failpoint，全参数冻结）

```text
node harness-stats.mjs collect \
  --failpoint <F1..F5|F6a|F6b|E1:alive|E1:dead|E1:reuse|E2a..E2d|E3|E4:pre-switch>   # 裸 F6/E1/E4 非法；E4 注入位=pre-switch 子型（2026-10-09 修订）
  --failpoint-mode once               # 一次触发：failpoint-state 记录已触发标记后自动失效
  --failpoint-state <dir>             # 触发标记目录（重跑不带 --failpoint 即不再触发）
  --clock <frozen>                    # 冻结时钟（RFC3339 UTC）——stale_orphan 72h 判定/心跳时间基准
  --process-liveness-oracle <fixture> # E1 专用：PID 存活判定 fixture（alive|dead）
  --process-start-token <fixture>     # E1 专用：进程起始 token fixture（复用判定：PID 活但 token 异=复用）
```

注入触发即进程立即终止，**退出码=70（CRASH_INJECTED）**；fail-loud 类（E1:alive）退出码=1；SKIP 退出码=0 但输出含 `SKIP` 行（见 §5）。

## 3. F 系（segment/cursor 提交链 failpoint）预期表

| id | 注入点 | 注入后应存在文件 | 重跑后 canonical 预期（无 --failpoint） | 恢复类（22 §5.4-5） |
|---|---|---|---|---|
| F1 | segment.tmp 写前 | events/ 无新增（无 .tmp 无 segment） | 正常采集：完整 segment+manifest+cursor；事件数与无注入基线恒等 | 干净重扫 |
| F2 | segment.tmp 写中断（截断终态） | 截断 segment.tmp；无 manifest | .tmp 判 partial→quarantine；同窗口重采集出完整 segment；事件不重计（cursor 未推进过） | partial→quarantine |
| F3 | segment rename 后 manifest 前 | 正式 segment 在、manifest 缺 | 无 manifest 的 segment 判 partial→quarantine；重采集新 segment；事件不重计 | partial→quarantine |
| F4 | manifest fsync 后 cursor tmp 写前 | segment+closed manifest 在；cursor 不含该 segment | 扫描「已 closed 未入 cursor」segment=待提交重放→cursor rename 收敛；事件恰一次（幂等收敛） | 重放收敛 |
| F5 | cursor tmp fsync 后 rename 前 | cursor.tmp 残留；正式 cursor 不含该 segment | 同 F4 终态：重放收敛，cursor.tmp 被覆写；事件恰一次 | 重放收敛 |
| F6a | cursor rename 后父目录 fsync 前（rename 持久化保留） | cursor 已含该 segment（提交点已过） | 不重放（cursor 已含）；canonical event/segment/cursor 与正常完成恒等 | 已提交，无动作 |
| F6b | 同注入点（rename 丢失终态） | segment+manifest 在；cursor 不含该 segment（等价 F4 终态） | 重放收敛（同 F4）；事件恰一次 | 重放收敛 |

## 4. E 系（锁/损坏/重建/压实交叉）预期表

| id | 注入物 | 预期行为 | 重跑后 canonical 预期 |
|---|---|---|---|
| E1:alive | locks/ 记录（见下三字段）+ liveness oracle 报存活且 token 匹配 | **不抢锁**：exit 1 fail-loud、零写入 | 持有者结束后正常采集 |
| E1:dead | 同上，oracle 报 PID 不存活 | 判 stale→打破锁接管，正常完成 exit 0 | canonical 与无注入基线恒等（锁被接管后正常完成） |
| E1:reuse | 同上，PID 存活但 process-start token 不匹配 | 判 PID 复用=stale→打破接管 exit 0 | canonical 与无注入基线恒等（锁被接管后正常完成） |
| E2a | cursor 文件为空 | 启动检测损坏→从 segment manifests 重建（取最大已提交 segment_seq）；重建动作落日志工件；继续 exit 0 | 事件不重计不丢失 |
| E2b | cursor JSON 截断 | 同上 | 同上 |
| E2c | cursor payload_sha256 与载荷不符（schema VR-S23 同型） | 同上 | 同上 |
| E2d | cursor.committed_segments 指向不存在 segment | 同上 | 同上 |
| E3 | rebuild 写 generation-N 目录中途崩溃 | 代指针未切换→旧代完整可读（读侧无感） | 重跑 rebuild：新 generation 校验→原子切换代指针→旧代保留至显式 prune（保守清理——validate 通过不触发自动清理，E3 回退语义受益；2026-10-08 修订） |
| E4 | compaction 与 report/collect 并发窗口（**主型=契约语义矩阵，非注入面**） | compaction 持同一排它锁（互斥）；report 固定 generation 快照；旧 segment 仅当 `segment_end_cursor ≤ compaction_watermark` 才可删 | 被删集=水位下集合−引用保护集（引用保护=bundle 引用计数（22 §5.5-② 正文）+ segment 级 report 引用（契约侧防竞态扩张，stats-1-gap-6 待 planner 裁）） |
| E4:pre-switch | 压实新代段已写、代指针未切（E4 通道的等价持久化终态注入；2026-10-09 修订新增行，原 E4 注入语义保留于此） | 代指针未切→旧代完整可读（读侧无感，E3 同型） | 重跑 compact：崩溃残留代目录废弃重写→校验→原子切代→validate 绿 |

**E1 锁记录三字段（v4 补 token）**：`PID` + `心跳时间（--clock 基准的 RFC3339 UTC）` + `process-start token`（进程唯一起始令牌，使 PID 复用判定可测）。fixture 注入 oracle 而非等待真实复用。
**--clock 心跳基准注记（stats-3 票载裁决②，2026-10-09 契约侧注记）**：锁心跳实现**恒真实钟**（store.mjs lockRecord 不消费 --clock——冻结时钟注入心跳会造成假 stale 判定漂移）；测试等价通道=E1 oracle（liveness/start-token fixture 代行）+ `refreshHeartbeat({nowIso})` 注入位（单元级）。「心跳时间（--clock 基准的）」字样读作「RFC3339 UTC 规范形」；oracle 通道与冻结时钟在可测性上等价。

## 5. 平台 SKIP 留痕矩阵（Windows / Linux）

| failpoint | Windows | Linux | 注 |
|---|---|---|---|
| F1–F6a/b | SUPPORTED | SUPPORTED | 终态注入=纯文件系统终态摆放，无平台依赖 |
| E1:alive/dead/reuse | SUPPORTED | SUPPORTED | oracle fixture 代行判定，不依赖真实信号机制 |
| E2a–E2d | SUPPORTED | SUPPORTED | 文件内容终态 |
| E3 | SUPPORTED | SUPPORTED | 目录+代指针文件切换 |
| E4（语义矩阵） | SUPPORTED | SUPPORTED | 排它锁语义由 locks/ 目录协议承载（非 OS 强制锁） |
| E4:pre-switch | SUPPORTED | SUPPORTED | 目录+代指针文件切换（E3 同型终态） |

**SKIP 规则**：平台无法注入某终态时输出 `SKIP <failpoint> <platform> <原因>` 行并计 0（非绿非红）——当前矩阵无已知 SKIP 项；若未来平台差异（如某文件系统 rename 原子性缺失致 F6a 不可注入）按本规则留痕，验收清单注明。已知非 SKIP 的设计性替代：E1 不做真实 PID 复用等待（oracle 代行=契约设计，非平台缺口）。

## 6. canonical 判定口径（stats-2 验收⑥引用）

1. 事件不重计：重跑后事件仓内每 entity_id 的 revision 链与单次完整采集恒等（无重复 event_id/revision）；
2. segment SHA 恒等：同源快照重采集产出的 segment 内容 SHA-256 逐字节恒等（顺序稳定=按 (completed_at,id) 排序写入）；
3. cursor 收敛：重跑后 cursor 的 terminal_cursor/open_set/committed_segments 与无注入基线恒等；
4. quarantine 留痕：F2/F3 的 partial 均可在 quarantine/ 找到对应工件（不静默丢弃）。
