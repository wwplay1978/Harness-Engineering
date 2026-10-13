# B9 closure matrix 判据冻结件

> **版本**：v1.1（2026-10-13 · release-round-7 · 脚注级增补零判据变更）。
> **身份**：stats-5 交付物 4（P1-3 两步走）第一步——实现前入库、先于 b9-matrix 子命令；机判唯一依据。
> **上游**：docs/22 §7 B9 行（七子项全范围）；docs/00-index :61 B9 原文；docs/13 :38（单仓口径）；22 :309（主从扩展）。
> **修订纪律**：本文件判据冻结后，b9-matrix 机判语义只随本文件修订而变（版本递增记于文末）；实现代码不得自行解释判据。
> **范围红线**：B9 行删除归发布票（消费本工件）；matrix 只 flag 不执行任何触发义务。

## 1. 七子项判据（票面逐字）

- **③ 计数域**=**本仓 metrics.md 行**（13 号 :38 单仓口径）。
- **④ 无行票**=**不入计数域但入 drift 对账**（事件仓 merged 票集−metrics 行集≠∅→子项红+缺行清单）。
- **⑤ 修复票**=**照常计票+更正注关联**（已裁）。
- **⑥ 唯一计数源**=**前向判据**（stats-5 合并日后新 metrics 行须含 stats report 工件引用〔--out 工件名/时戳——引用即合规，数字列仍可手写〕；历史行祖父豁免，豁免截止=本票合并日）。
- **⑦ 第 10 票复盘**=**机判替代口径**（计数域跨越 10 后 30 日内 docs/13 是否出现新复盘节；当前事实=15 行已越阈且无复盘 #3→⑦**上线即红如实公示**——触发义务在体系，matrix 只 flag 不执行）。
- **双源仲裁**：metrics.md vs 事件仓不一致→**事件仓为准判定+差异列 drift 报告项**（22 :309 主从扩展）。
- **①②**（injectAgentsMd/skills 锚点包）**只登记 02/16 权威面现状不代核**。

## 2. 机判操作化（判据 ID=测试追溯锚）

### CRIT-1 / CRIT-2（①② 登记态）

- ①=injectAgentsMd 待核：权威面=docs/02 §1 状态注（归属 02）；②=skills 锚点包来源待核：权威面=docs/16 §3（归属 16）。
- matrix 输出恒 `adjudication=external`（登记权威面指针，不出红绿判定——代核=越权）。

### CRIT-3（③ 计数域）

- 计数域=项目仓 `docs/metrics.md` 表体行数；行识别=以 `| ` 起且日期列匹配 `^\d{4}-\d{2}-\d{2}$` 的表行。
- metrics.md 缺席/不可解析=③红（计数域不可复算），非命令失败。

### CRIT-4（④ 无行票 drift）

- 事件仓 merged 票集=terminal_completed developer（含 developer-rerun）派发所在 ticket_slug 全集（事件仓 generation 快照读，与 report 同口径）。
- 缺行清单=merged 票集−metrics 行集；≠∅→④红+清单；∅→④绿。

### CRIT-5（⑤ 修复票）

- 规则已裁：修复票照常计票（独立行）+以更正注与原票关联。机判面=规则冻结在场（本文件）；行文合规性由归档流程承载，matrix 不逐行核文。

### CRIT-6（⑥ 前向判据）

- 豁免截止（forward_cutoff）=项目仓 git 内 `^merge: ticket stats-5` 最新 merge commit 的 committer 时戳；缺席（本票未合并）→全部行祖父豁免→⑥绿（注记截止未定）。
- 合规引用形态=metrics 行文本内含 report --out 工件名（正则 `reports/\d{4}-W\d{2}/[^\s|]+\.json`）；引用即合规，数字列手写与否不判。
- 日期列 > cutoff 的行须含合规引用；违例清单≠∅→⑥红+清单；否则绿（历史行不计）。
- **脚注（v1.1）unknown 第三态**：⑥ git 执行失败≠零匹配——执行失败=判据不可机判的保守第三态 unknown（非绿非红，永不假绿）；零匹配=未合并→全行祖父豁免照旧。cmd-b9matrix 已实装（`stats5MergeCutoff` 分态取数）。

### CRIT-7（⑦ 第 10 票复盘）

- 越阈判定=计数域行数 >10；越阈时刻=第 10 行日期列；义务窗=越阈时刻+30 日。
- 复盘节识别=docs/13 内含 `复盘 #3`（或更高序号）节题且节题内日期（`(\d{4}-\d{2}-\d{2})`）≤义务窗末日。
- 行数 ≤10→绿（未越阈无义务）；越阈且节在场且及时→绿；越阈而无节/迟节→红（如实公示——触发义务在体系，matrix 只 flag）。

### CRIT-ARBITRATION（双源仲裁）

- 两源对票集/行集不一致时：判定面=事件仓（merged 票集为准）；全部差异列入输出 `dual_source_arbitration.drift`（metrics-only 行=「行在档无事件面」类 drift，不单独红项——④红仅由缺行方向触发）。

## 3. 输出契约

- 子命令 `b9-matrix`：stdout=canonical JSON 体（七子项红绿+证据+drift+overall；体禁时钟依赖字段）；`--out`=落 `<storeRoot>/reports/b9-closure-matrix-<ISO>Z.json`（ISO=生成时刻——文件名承载，append 禁覆写）。
- 红项在场不改变退出码（exit 0——matrix 是判断工件非门禁；B9 删行决策归发布票消费本工件）。
- **脚注（v1.1）旧无锚工件处置（世代锚面）**：工件体含 generation 世代锚（merged 票集证据定着于生成时当前代——prune 引用保护消费面）。prune fail-loud=有意裁决；append 禁覆写下旧无锚 b9 工件须手工退役（重跑生成带锚件+退役旧件——生产仓当前无 pre-fix 工件=场景理论）。

## 修订记录

| 日期 | 版本 | 修订 |
|---|---|---|
| 2026-10-12 | 1.0 | stats-5 首冻（票面 r2 交付物 4 逐字判据+机判操作化 CRIT-1..7/ARBITRATION） |
| 2026-10-13 | 1.1 | release-round-7 脚注级增补零判据变更：CRIT-6 补 unknown 第三态脚注（⑥ git 执行失败≠零匹配——保守永不假绿，cmd-b9matrix 已实装）；§3 补世代锚/旧无锚工件处置脚注（prune fail-loud=有意裁决+append 禁覆写下旧件手工退役） |
