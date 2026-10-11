# stats-1 · held-out 分类器验收协议（attempt 分类器质量门，契约冻结）

> 依据：docs/22 v4 §2.2-10（分类质量双门）与 §2.2-11（数据集隔离——防循环验证）；消费方=stats-3 ⑤（数据集隔离验收：36 例回归集逐例绿不计 precision；held-out ≥20 例新抽过双门）。分类学本体（七值 attempt_kind/判定协议九步/词典）归 22 §2.2，本文件只冻结**验收协议**。

## 1. 数据集隔离（两组，禁交叉）

| 数据集 | 构成 | 用途 | 禁项 |
|---|---|---|---|
| `development_regression_set` | 终审 20 例 + 第四轮 held-out 16 例 = **36 例**（构成冻结，v4 §2.2-11） | 逐例回归防退化（分类器或词典改动后 36/36 须绿） | **不计入 precision 验收**——已参与词典/规则制定的样本，循环验证面 |
| `held_out_acceptance_set` | 本协议冻结后**新抽 ≥20 例**（抽样框=在档票据运行记录行，抽样规则登记于分类器版本仓库） | 质量门验收（双门+三率） | **样本不得参与词典/规则制定**（制定者不见样本内容；违反即数据集污染、验收作废） |

隔离纪律：两集合样本清单随 classifier_version 版本化存档；held-out 样本一经人工标注入集即锁定，不得因结果不佳剔换（剔换=重新抽 + 重跑全部门 + 版本号递增）。

## 2. 分类质量双门（22 §2.2-10 逐字语义冻结）

设 held-out 集规模 n，`unknown`、`wrong_label`、`compound_unparseable` 为三类不可接受结果计数：

1. **合计门**：`(unknown + wrong_label + compound_unparseable) / n > 30%` → 产出降级标记 `HISTORICAL_CLASSIFICATION_LOW_COVERAGE`，趋势报告标注「已识别下限」（M4 趋势照常出，但不得用于结论性判读）；
2. **错误门**：`wrong_label / n > 10%` → **分类器 fail（红）**——exit≠0，阻断以该 classifier_version 产出的派生事件入 M2 分子分母（历史派生只进 audit/history 的既有规则不变）。

判读依据（v4 第四轮 held-out 实证）：unknown 18.75% + 确定性/粒度错误 12.5% = 31.25% 合计触门而 unknown 单看低于 30%——**只看 unknown 会放走高置信错误**，故错误门独立于合计门。

## 3. 三率报告口径

| 率 | 定义 | 报告位 |
|---|---|---|
| `unknown_rate` | unknown / n | 分类质量报告 + pilot 评估报告（22 §5.8 产物） |
| `wrong_label_rate` | wrong_label / n | 同上（错误门输入） |
| `compound_rate` | compound_unparseable / n | 同上 |

分母恒=held_out_acceptance_set 规模 n（36 例回归集永不入分母）；三率随 classifier_version、样本清单 SHA、标注人/时间戳一起落报告工件（机器可复算前提）。

## 4. 验收流程（stats-3 ⑤ 联动）

1. 抽样：冻结后新抽 ≥20 例 → 样本清单锁定存档；
2. 标注：人工 golden 标注（attempt_kind + trigger_stage + 依据原文行），标注者不得为词典制定者；
3. 运行：分类器对样本盲判（输出带 classifier_version）；
4. 判门：双门 + 三率（§2-3）；
5. 回归：development_regression_set 36 例逐例对照 v4 基线——任何一例翻红即回归失败（与双门独立报告）；
6. 落账：分类器版本入事件（dispatch.classifier_version / derived.derivation_revision 链，22 §2.2-9）；人工更正走 MANUAL_RECONCILED observation 派生（origin=manual，M2 selection manual＞auto），不改写原事件。

## 5. 判定边界示例（锚定 22 §2.2 协议，非穷举）

- attempt 列 `r1/r2` → 预处理规范化为序号 1/2（§2.2-1）——36 例回归集含 3 例此形态（v4 §10 核对点④）；
- 序号==1 且明示环境零产出 → infrastructure_retry（条件式 initial，§2.2-3）——回归集 1 例；
- 单行多 episode 合写 → compound_unparseable（§2.2-6，粒度修复归票面重录）——回归集 1 例；
- 含否定短语（「非返工/非缺陷/时序」）邻接「修复/重跑」→ 不得因邻近词误判（§2.2-4 词典否定短语约束）。
