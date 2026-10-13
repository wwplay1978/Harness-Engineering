# stats-1 · held-out 分类器验收协议（attempt 分类器质量门，契约冻结）

> 依据：docs/22 v4 §2.2-10（分类质量双门）与 §2.2-11（数据集隔离——防循环验证）；消费方=stats-3 ⑤（数据集隔离验收：38 例回归集逐例绿不计 precision；held-out ≥20 例新抽过双门）。分类学本体（七值 attempt_kind/判定协议九步/词典）归 22 §2.2，本文件只冻结**验收协议**。
> 版化：**v1.1**（2026-10-12 · classifier-contract-consolidation）——回归集 36→38 例收编（增补 C 系 2 例〔1.0.1/1.0.2，#37/#38〕）+§1 滚动重验协议段收编（classifier-v2 裁决 D 条款+classifier-v2.1 r4 冻结口径）；v1.0=4b511b6（2026-10-07 stats-1 契约冻结）；§2 双门段零改动（阈值 30%/10% 不变）。

## 1. 数据集隔离（两组，禁交叉）

| 数据集 | 构成 | 用途 | 禁项 |
|---|---|---|---|
| `development_regression_set` | 终审 20 例（A 系）+ 第四轮 held-out 16 例（B 系）+ 增补 C 系 2 例（1.0.1/1.0.2，#37/#38）= **38 例**（构成冻结，可增不可改；v4 §2.2-11，v1.1 收编） | 逐例回归防退化（分类器或词典改动后 38/38 须绿） | **不计入 precision 验收**——已参与词典/规则制定的样本，循环验证面 |
| `held_out_acceptance_set` | 本协议冻结后**新抽 ≥20 例**（抽样框=在档票据运行记录行，抽样规则登记于分类器版本仓库） | 质量门验收（双门+三率） | **样本不得参与词典/规则制定**（制定者不见样本内容；违反即数据集污染、验收作废） |

隔离纪律：两集合样本清单随 classifier_version 版本化存档；held-out 样本一经人工标注入集即锁定，不得因结果不佳剔换（剔换=重新抽 + 重跑全部门 + 版本号递增）。

**滚动重验协议（v1.1 收编——classifier-v2 裁决 D 条款+classifier-v2.1 r4 冻结口径，引用式收编）**：`held_out_acceptance_set` 的「新抽 ≥20 例」保持为**初始验收语义**（v4 冻结，不废止）；自 classifier 2.0.0 起增**滚动重验形态**=census 密封集——活仓框普查密封、烧毁不可复用。

- **触发**：排除后净新行累积 **≥10**（计数工具面=heldout-live 采集脚本 dry-run 报数后净增），四子句（classifier-v2.1 r4）：①**行级排除**——行 SHA ∉ fixtures-36∪burned18∪census19（fixtures-36=38 例回归集测试文件名沿袭，命名不回改）；②**票级排除**——词典参与票（词典制定参与票=fixtures-36 provenance 反查+版本历史）整票行不计入不密封，**计数与密封同一排除面**（防自举污染）；③**initial 行计入**；④**dispatch 前工具面实算并声明口径**；
- **burned 集累积扩容**：随每轮滚动重验的密封行集增量并入、永不回收（18 例〔ab366ec5〕→ +census 19 例 → 后续每轮并入——语义引词典 §5〔classifier-dictionary.md:123〕，本文件不重写）；
- **census19 非泛化声明**：census 19 例面绿不构成泛化证据（该集参与 v2.1 设计）；泛化证据唯一来源=未来滚动重验批双门（引词典 §5〔classifier-dictionary.md:125〕）；
- **流程五步**：dry-run 预检（新源异质形态前置暴露，不计密封；含 **RT- 命名空间专项**——枚举全部 basis 含「RT- 命名空间」的例+命中形上下文，planner 目检后方可密封）→ 新框密封 → 当前版分类 → planner 独立复核（人工检查点）→ 双门终判。

**终判语义（沿 classifier-v2.1 r4 全口径引用式收编）**：**绿=M2 质量门转绿+gap-7+classifier-v2 档闭合；红=再挂起呈人裁（不降门；二次红的人裁路径含扩源授权/人工词典审校轮/分类学重裁，不限于再三挂起）**。

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

分母恒=held_out_acceptance_set 规模 n（38 例回归集永不入分母）；三率随 classifier_version、样本清单 SHA、标注人/时间戳一起落报告工件（机器可复算前提）。

## 4. 验收流程（stats-3 ⑤ 联动）

1. 抽样：冻结后新抽 ≥20 例 → 样本清单锁定存档；
2. 标注：人工 golden 标注（attempt_kind + trigger_stage + 依据原文行），标注者不得为词典制定者；
3. 运行：分类器对样本盲判（输出带 classifier_version）；
4. 判门：双门 + 三率（§2-3）；
5. 回归：development_regression_set 38 例逐例对照 v4 基线——任何一例翻红即回归失败（与双门独立报告）；
6. 落账：分类器版本入事件（dispatch.classifier_version / derived.derivation_revision 链，22 §2.2-9）；人工更正走 MANUAL_RECONCILED observation 派生（origin=manual，M2 selection manual＞auto），不改写原事件。

滚动重验批：触发/排除面/流程五步/终判语义均按 §1 滚动重验协议执行（引用，不重复定义）——双门终判绿，方为泛化证据。

## 5. 判定边界示例（锚定 22 §2.2 协议，非穷举）

- attempt 列 `r1/r2` → 预处理规范化为序号 1/2（§2.2-1）——36 例回归集含 3 例此形态（v4 §10 核对点④）（现 38 例）；
- 序号==1 且明示环境零产出 → infrastructure_retry（条件式 initial，§2.2-3）——回归集 1 例；
- 单行多 episode 合写 → compound_unparseable（§2.2-6，粒度修复归票面重录）——回归集 1 例；
- 含否定短语（「非返工/非缺陷/时序」）邻接「修复/重跑」→ 不得因邻近词误判（§2.2-4 词典否定短语约束）；
- **2.0.0 判例锚**（语义级变更——major）：secondary_cause 扩枚举 `+{upstream_sync, staged_delivery}`（裁决 A——上游合并驱动复跑 H09/分段新交付 H16）+新短语族四支（upstream_sync/staged_delivery/user_directed〔H17〕/qa_face〔H15〕）——翻转旧例=回归红逐例呈 planner 裁、禁静默改 expected（引词典 §0 版本历史 2.0.0 措辞，不重写）；
- **2.1.0 判例锚**（修复项——minor）：user 触发族增 `请立刻修正`/`「选A」裁定` 字面子串两形（census19 H03/H11 实测原文，引号字符=实测「」）+upstream_sync 族收敛冻结四复合形（裸「复跑」删除）+finding-ID 锚提取面与 RT- 命名空间 fallback（H19）+骨架事件文本兜底（H08）（引词典 §0 版本历史 2.1.0 措辞，不重写）。
