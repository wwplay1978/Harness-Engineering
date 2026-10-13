# 周桶窗口混票归属规则（冻结件）

> **身份**：stats-5 交付物 6（验收④）——实现前冻结、先于周趋势实现入库；周趋势/周桶归属机判唯一依据。
> **上游**：docs/22 §4 M4 周趋势行+§5.7（UTC/iso_week_year）；report ⑧ ISO 跨年周桶先例（thursday 法）；票面 P2-2 裁定/P2-3 映射。
> **修订纪律**：规则冻结后，周桶归属语义只随本文件修订而变；实现代码与测试以规则 ID（WB-*）追溯。

## 1. 规则正文（票面逐字）

- **WB-1** 票归属周=merge 周桶（无 merge 锚=首次派发周桶 fallback）。
- **WB-2** 同窗多票=各自计入（票级非行级聚合）。
- **WB-3** 跨窗票（派发窗≠merge 窗）=归属 merge 窗。
- **WB-4** 首末 partial 周标注。
- **WB-5** --since/--until 只作用事件面（merge 锚与票级归属不受时窗截断）。
- **WB-6** 实现按冻结文执行（规则 ID 入测试追溯）。

## 2. 机判操作化

### WB-1 归属锚

- merge 锚=票级 merge commit committer 时戳（bundle manifest `ticket_merges` 观察面经 mine 物化的派生层锚）。
- **当前生产态（stats-5 呈报）**：merge 锚物化面停该子面呈报（事件 schema 枚举/载荷 allowlist 冻结，承载需 schema 变更——回方案门）；锚面缺席期间全部票按 fallback（首次派发周桶）归属，report 输出 `attribution_basis=first-dispatch-fallback` 如实披露。
- 周桶函数=report ⑧ 同源 ISO 周桶（thursday 法：week-year=该周周四所在年；UTC 钉死——TZ 变体不影响归属）。

### WB-4 partial 周判定

- 周序列首桶 partial ⟺ 序列最小主时戳 > 该周周一 00:00:00Z；末桶 partial ⟺ 序列最大主时戳 < 该周日 24:00:00Z（即周末日终）；中段桶恒非 partial。

### WB-5 时窗作用面

- --since/--until 过滤仅作用于事件面（dispatch/model-request/observation 主时戳——report 既有行为）。
- 票级归属锚（merge 锚或 fallback 首次派发时戳）取自未截断面：时窗外首次派发的票仍按其真实归属周计数（不入任何窗内桶时不显示，不入窗内桶≠被改判）。

## 修订记录

| 日期 | 版本 | 修订 |
|---|---|---|
| 2026-10-12 | 1.0 | stats-5 首冻（票面 r2 交付物 6 逐字规则 WB-1..6+操作化；WB-1 呈报注记=merge 锚物化面停摆期 fallback 披露） |
