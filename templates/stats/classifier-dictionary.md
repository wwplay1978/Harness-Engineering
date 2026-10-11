# stats-3 · classifier-dictionary（attempt 分类器词典与声明枚举工件，版化冻结）

> 依据：docs/22 v4 §2.2（判定协议 11 条+分类学）+ stats-3 票载裁决⑨（显式声明层切分：parser 冻结三类声明不动；完整声明枚举（含 quality/refresh/cancellation 短语族+否定短语规则）入分类器派生层、随 classifier_version 版化）+ 附件 A（secondary_cause 枚举/derivation 载荷）；**classifier-v2 票（2026-10-11）裁决 A/B+gap-7 四病因+覆盖矩阵——2.0.0 语义级变更**；**classifier-v2.1 票（2026-10-11 r2）修复项三件（短语族扩展+提取面扩展+parser 骨架兜底）+滚动重验条款——2.1.0 minor**。
> 消费方：`templates/tools/stats2/classifier.mjs`（阶段三）；**38 例回归集=tests/stats3/classifier-36.test.mjs**（P3-2 口径统一：36+2 例集=38 例）。
> 上游纪律：本工件为 §2.2-2 ①句开口枚举"等"的冻结闭合物（stats-3-gap-3）；**任何条目变更=版本递增+38 例回归必跑**（classifier-acceptance §1）；**2.0.0 翻转旧例=回归红→planner 逐例裁翻转语义（回归集可增不可改——classifier-v2 红线 2）**。

## 0. 版化框架与常量冻结

| 项 | 冻结值/规则 |
|---|---|
| `dictionary_version` | `2.1.0`（semver：短语增补/词边界收紧/判定序澄清（回归集不变绿）=patch；规则/枚举变更=minor；删除或语义反转=major——policy 注记随 1.0.1 修订） |
| `classifier_version` | `stats3-attempt-<dictionary_version>`（事件承载值；当前=`stats3-attempt-2.1.0`） |
| **版本对应表**（P3-1 处置） | `classifier_version=stats3-attempt-2.1.0` ↔ 本工件 `dictionary_version=2.1.0`（公式=`stats3-attempt-<dictionary_version>`，代码常量与契约文件恒等断言）；**sealed 工件 fail-loud 钉定此面**：`heldout-live-classify` 消费的 sealed 工件 `classifier_version` ≠ 当前 `CLASSIFIER_VERSION` → fail-loud（密封清单与其分类器版本绑定——版本升级须重新密封，禁跨版本分类） |
| 版本历史 | 1.0.0（2026-10-09 首版冻结）；1.0.1（2026-10-09 返修轮：状态入口序澄清+RC 词边界+例 #37）；1.0.2（2026-10-09 收尾修：RC 数字相邻收紧+例 #38）；**2.0.0（2026-10-11 classifier-v2，语义级变更——major）**：①secondary_cause 扩枚举 `+{upstream_sync, staged_delivery}`（裁决 A——上游合并驱动复跑 H09/分段新交付 H16）；②新短语族四支：`upstream_sync`/`staged_delivery`（secondary 标注族）/`user_directed`（user 触发族，H17）/`qa_face`（QA 面族，H15）；③parser 消费面 v2（ticket-consistency-parser §1.1 规则三件套+§1.2 执行会话标识列——F-n/段序标记新结构信号入 §3 判定序）；④上下文规则层 v2（§2.5：拒因工件收集 attempt↔报告窗口对应+省略号/裸形态词法——gap-7②）；⑤断句澄清（QA P2-2：双文本同现 infra 先判——§3 步 3 括注改写消歧）；**2.1.0（2026-10-11 classifier-v2.1 r2，修复项——minor）**：三工件变更面=①本工件 §1 短语族两行（user 触发族+`请立刻修正`/`「选A」裁定` 字面子串两形〔census19 H03/H11 实测原文，引号字符=实测「」〕；upstream_sync 族收敛冻结四复合形〔裸「复跑」删除+「上游合并」「驱动复跑」单形一并移除〕）+②§2.5-2 finding-ID 锚提取面（角色限定语∪result∪note+大小写归一集合判交——census19 H19）+§2.5-2b RT- 命名空间 fallback（r3 人裁：无锚时 RT-* 形蕴含 triggerHint=red_team——H19 记录件拒因行无 RT-E8 编号、交集锚不可达的承接路径）+③ticket-consistency-parser §1.1 追加式两条款（骨架事件文本兜底〔①c，census19 H08〕+段序标记白名单 `{live}`〔②〕）——parser 变更追加式（stats-2 复用面零漂移）；§3 声明层内序冻结（user 触发族先于 spec_face）+§5 burned-18 叠加机制/计数口径/census19 非泛化声明登记；minor 依据=短语族与提取面扩展（规则/枚举变更、回归集语义收窄非反转） |
| 版本变更接线 | 词典任何条目变化 → dictionary_version 递增 → classifier_version 变化 → 38 例 development_regression_set 逐例回归必跑（红=禁发布该版本；翻转例呈 planner 裁，禁静默改 expected） |
| 派生层归位 | parser（ticket-consistency-parser.md §2）冻结三类声明（infra_failure/non_rework/multi_attempt）**不重写不重复定义**；本工件只在其上追加派生层声明族；分类器实现必须经 `stats2/parser.mjs` 取结构列与三类声明，再读本工件枚举 |
| manual 事件映射 | origin=manual 派生：`primary_signal_level=explicit`（人工声明=最高级信号，与 M2 manual＞auto 同构）、`signal_evidence={matched_phrase:null, structural_basis:<reconcile basis>}`、`decided_at=<reconcile created_at>`；归因者/依据/源 hash 持久记录=reconcile 输入工件归档（仓 snapshots/reconcile/<sha8>/input.json），不入事件载荷（附件 A 切面） |
| 组合纪律 | derivation 载荷生成侧执行 gap-6②：attempt_kind=initial ⇒ trigger_stage=unknown |

## 1. 完整声明枚举（§2.2-2 ①层派生族；仅 note/备注列匹配，子串、大小写不敏感——**secondary 标注族例外：note 列+角色列限定语（role qualifier，括号内限定语）双列匹配，2.0.0 冻结**）

parser 冻结三类（复用，不重定义）：`infra_failure_declared`（网络中断/限流/provider unavailable/环境事件/断电续跑）、`non_rework_declared`（非返工/非缺陷/时序）、`multi_attempt_declared`（多 attempt 合写）。

派生层声明族：

| 短语族（子串匹配，大小写不敏感；**≤3 字符 ASCII 短语=词边界判定**——`(^|[^a-z0-9])RC([^a-z0-9]|$)` 形，1.0.1 防字母相邻子串误命中、1.0.2 收紧数字相邻〔rc2/RC2 不命中〕；**全角 ＲＣ 不命中——ASCII 形态声明**） | 声明类型 | 直接归类 |
|---|---|---|
| 修复轮 / request changes / RC / findings 修复 / 窄修 / minimal-fix / 合并前修 / P1-P2 修复 / P1/P2 修复 / 复审后修 / review 后修复 | `quality_rework_declared` | quality_rework |
| 证据补录 / 证据刷新 / 重新物化 / hash 对账 / 快审折叠 | `evidence_refresh_declared` | evidence_refresh |
| 用户取消 / 手动取消 / 主动取消 / cancellation | `cancellation_declared` | cancellation_retry（trigger_stage=user） |
| spec 数值阻断 / spec 修订轮 / spec 数值修订 / 用户裁决驱动修订 | `spec_face_declared` | quality_rework（trigger_stage=premerge 或 user；secondary_cause=spec_face/user_directed 按短语） |
| 契约收口级微修 / 非缺陷微修 / docstring 修正 | `non_defect_minor_declared` | quality_rework（secondary_cause=non_defect） |
| **用户裁决 / 批准驱动 / 裁决①②驱动 / 请立刻修正 / 「选A」裁定**（2.0.0 新增 user 触发族 H17；**2.1.0 增后两形——census19 H03/H11 实测原文，字面子串枚举制（禁模式类；引号字符=实测「」逐字节精确，『』形态/「选A」缺「裁定」后缀均不命中）**：用户裁决/批准驱动的修复修订） | `user_directed_declared` | quality_rework（trigger_stage=user；secondary_cause=user_directed） |
| **sync main / 复跑三合一 / 合并驱动复跑 / 上游合并驱动复跑**（2.0.0 新增 upstream_sync 族 H09；**2.1.0 清单冻结=四复合形：裸「复跑」删除+「上游合并」「驱动复跑」两单形一并移除（票面②）——H09 原文裸「复跑」形（burned18 对照）随之不命中=已呈裁翻转**；**secondary 标注族**：不独立归类，仅标 secondary_cause=upstream_sync——上游票合并驱动的复跑/适配非缺陷修复非拒因工件触发，attempt_kind 沿结构层语义） | `upstream_sync_declared` | （secondary=upstream_sync） |
| **执行段 / 编排器轮 / 分段交付 / 合并后新段**（2.0.0 新增——staged_delivery 族，H16；**secondary 标注族**：仅标 secondary_cause=staged_delivery——合并后新执行段交付非缺陷修复；匹配面=note 列+**角色列限定语**〔如「developer（执行段编排器轮）」〕） | `staged_delivery_declared` | （secondary=staged_delivery） |
| **机判载体缺口 / 形态缺口修复 / 载体缺口修复**（2.0.0 新增——QA 面族，H15：QA 面发现的机判载体缺口修复类；**词典层族**：仅 ③层无结构信号时归类 quality_rework；trigger 不改标——QA 面发现无工件级拒因锚时诚实 unknown） | `qa_face_declared` | quality_rework（词典层③；trigger 沿工件对应推断） |

**secondary 标注族优先序（2.0.0 冻结）**：多标注族同时命中时按 non_defect＞spec_face/user_directed＞upstream_sync＞staged_delivery（缺陷微修/spec 面为更强特异声明；upstream_sync 先于 staged_delivery——复跑语义含分段可能，反之不必然）。

**否定短语规则**（§2.2-4 词典约束的声明层同构）：同一 note 内命中 `non_rework_declared`（非返工/非缺陷/时序）时，**quality_rework/evidence_refresh 派生族短语不产生声明**（否定短语压制推断族——防"时序修复"误判）；`infra_failure_declared` 与 `cancellation_declared` 不受压制（环境/取消事实与"非返工"并立合法，如"限流击落续作，环境事件非返工"=infrastructure_retry）；**user 触发族与 secondary 标注族不受 non_rework 压制**（"非缺陷微修"同构——用户裁决/上游复跑/分段交付为事实性标注，2.0.0 冻结）。两条特异性裁决（38 例回归冻结行为）：
1. **特定族先于通用否定（最长匹配特异性）**：`non_defect_minor_declared` 不受 non_rework 压制——「非缺陷微修」会命中 parser 冻结短语「非缺陷」触发 non_rework_declared，但词典行「非缺陷微修→quality_rework（secondary=non_defect）」为更 specific 匹配面（A20）；
2. **infra×排除共存**：`infra_failure_declared` 与排除族短语同现且 attempt>1 → 环境事件=同 attempt 附注（§2.2-5），行归属结构层主因 quality_rework（A10「修复；网络中断断点续跑＝同 attempt」）。

## 2. 文本词典（§2.2-4 ③层；仅低级别信号缺失时启用）

与 §1 派生族同源短语集（词典层命中 → primary_signal_level=dictionary；声明层命中 → explicit）。首版词典=§2.2-4 表逐行 + §1 五族——单一短语表双入口（声明层/词典层）由实现层区分匹配时机（声明层在 ①层先判；词典层仅在 ②结构信号也缺失时）。**2.0.0 增补**：QA 面族入词典层（③层无结构信号时 quality_rework）；secondary 标注族双入口同规则（声明/词典层命中均只标 secondary）。

**排除规则短语族**（§2.2-5：不产生新 attempt，记同 attempt 附注；命中时压制词典层 rework/infra/refresh 归类）：

| 短语族 | 语义 |
|---|---|
| 窗口时序 / 授权窗节奏 / 两阶段票面执行时序 / 断点续跑 / 自愈 / 伪红重跑 / 轮内自修 / amend / 当场修复 amend | 同 attempt 附注（不另增 attempt） |

### 2.5 上下文规则层 v2（拒因工件收集——gap-7②，2.0.0 新增；实现=cmd-phase4.mjs）

**收集词法（拒因工件锚集）**：匹配形态三支——①slug 前缀形（`<slug>-r<n>-review.md`/`<slug>-qa*.md`/`<slug>-redteam*.md`，v1 既有）；②**省略号引用形**（`…-redteam.md`/`…-qa.md`——活仓 note 列省略号引用，非 ASCII 前缀 `…`，v1 词法漏收=H01/H12 reviewer 误判病因之一）；③**裸形态**（`redteam-exec.md`/`qa-v3.md` 等无 slug 前缀的 `qa-`/`redteam-` 起首 `.md` 文件名——含 `.md` 后缀才匹配，防 `qa-tester` 角色名误命中）。**QA/redteam 工件入拒因锚集**（v1 仅 review 形稳定命中）。

**attempt↔报告窗口对应（trigger 推断的工件对应关系）**：
1. **窗口锚**（主路径）：目标行 `attempt_no` 为数字且 >1 时，窗口=同表上一 developer 系行与目标行之间的**评审系行**（code-reviewer/qa-tester/red-teamer 前缀，含 rerun 变体；**仅拒因行**——result 含 request changes/request-changes/合并前修；pass/accept/approve/mergeable 行为验证行非拒因行，不入锚）；锚集=窗口内拒因行的拒因工件（trigger 按 classifier 既有优先序 red_team＞qa＞reviewer 自锚集推断）。
2. **finding-ID 锚**（fallback，窗口无拒因行时）：目标行 findings 编号与全表任一**拒因行**的编号重叠 → 该拒因行入锚集（如 H04：行内 P1-1 ↔ 后置 red-teamer(5a) 合并前修行 P1-1——表序非严格事件序，编号对应优先于行序）。**2.1.0 ①b 提取面扩展**：编号提取面=**角色限定语∪result∪note**（parser v2 role_qualifier 入提取面——census19 H19：角色列 `developer（RT-E8 attach 加固）` 编号在限定语）；判交=**大小写不敏感**（提取经 `i` 形态+统一 upper 归一——H19 实测角色列 RT-E8 大写↔拒因行 rt-e8 小写）+**集合交集精确匹配**（继承修复轮 F-1↔F-10 纪律——F-1 ⊄ F-10/RT-E1 ⊄ RT-E10，归一后仍逐 token 精确相等）；**锚仅作用 trigger 推断层**（resolveTrigger hint 路径）——secondary 标注层独立互不压制（角色限定语同时命中 finding-ID 编号与 staged_delivery 短语时两层并存：trigger=锚定族+secondary=标注族）。
2b. **RT- 命名空间 fallback**（2.1.0 r3 人裁增补，H19）：工件锚/交集锚均无时，目标行提取面（角色限定语∪result∪note——与 finding-ID 锚同面）命中 `RT-[A-Za-z0-9]+` 正则命名空间形（大小写不敏感）→ triggerHint=red_team（RT-=红队 findings 编号系的命名空间蕴含）；**序=工件锚/交集锚之后**（已有锚不覆盖）；basis 留痕形=`RT- 命名空间（<命中形>）`；正则形非子串匹配、不做编号比对（不涉 F-1↔F-10 纪律）；**仅作用 trigger 推断层**——secondary 标注层不涉。
3. **无序号行不适用窗口**：`attempt_no=null` 行（F-n 形/段序标记）无 attempt 序位，窗口未定义——仅 finding-ID 锚可锚定；无锚 → trigger 诚实 unknown（H05：F-1 修复轮行内与拒因行无编号重叠 → unknown）。
3b. **trigger 锚定证据双源**（阶段三预检 ③，2026-10-11）：锚定证据=锚行 .md 工件名（主——文件名为具体报告证据）∪ **锚行角色族 fallback**（无 .md 工件名形态——D7' 台账评审行「r1：裸管道符 P1+两处 P2」形态；red-team*→red_team/qa-tester*→qa/code-review*→reviewer，优先序同工件推断）；仅当工件推断无锚（unknown）且角色族在场时 fallback。
4. **消费面边界**：本层仅作用于活仓/held-out 采集面（heldout-live-classify）；bundle miner 面（cmd-mine `reviewArtifactsFor`=冻结 bundle reviews 清单）与 38 例回归面（ctx 直供工件）不受本层改写——v1 冻结面零漂移。

## 3. 信号优先级与条件式（§2.2-2/3 实现序）

```text
classify(row, ctx):
  1 预处理：attempt_no = parser v2 规范化（rN/数字；r?数字+尾部限定语→序号提取；
      F-n 形→attempt_no=null+attempt_gt1；无序号限定后缀→attempt_no=null+segment_marker）
  2 compound 判定：attempt_compound（parser）∨ multi_attempt_declared ∨ note 命中合写形
      （如"初始实现+…修复+…修复"多 episode 合写短语族）→ compound_unparseable（trigger=unknown）
  3 声明层（①）：按 §1 枚举（含否定压制规则；**双文本同现 infra 先判——infra_failure_declared
      ∧ cancellation_declared 并存时 infra_failure 先判**：attempt_no==1 且两声明并存 →
      infrastructure_retry（环境零产出事实优先于取消语义）；user_directed_declared 命中 →
      quality_rework/user/user_directed（先于结构层——用户裁决触发为事实性声明）；
      attempt_no==1 且 infra_failure_declared → infrastructure_retry（条件式 initial，trigger=environment）；
      attempt_no==1 且 cancellation_declared → cancellation_retry（trigger=user）
  3.5 状态入口（面一，1.0.1 序澄清）：dispatch 终态=terminal_cancelled → cancellation_retry（trigger=user）
      ——取消终态=事实性入口，优先于排除层/结构层（贴裁决⑨"面一状态+文本双入口"本意；
      文本声明族（①层）仍在状态入口之上）
  4 排除层（§2.2-5）：排除短语族命中且无声明族命中 → 同 attempt 附注
      （attempt_no==1 → initial；否则维持结构信号判定）
  5 结构层（②）：attempt_no==1 → initial（trigger=unknown）；
      attempt_no>1 ∨ rerun 变体 → quality_rework（trigger=拒因工件锚集蕴含：-r<n>-review→reviewer，
      -qa→qa，-redteam→red_team；无锚→unknown）；
      attempt_gt1（F-n 形）→ quality_rework（同上——attempt>1 结构语义）；
      segment_marker → 段序上下文（ctx.segmentOrdinal）：首段（=1）→ initial；
      后续段（>1）→ quality_rework/secondary=staged_delivery；无段序上下文 → unknown
  5.5 secondary 标注（§1 标注族）：上述各 quality_rework 分支的 secondary 未被 non_defect/spec_face/
      user_directed 占用时，按 §1 标注族优先序标注（upstream_sync/staged_delivery；匹配面=note+角色列限定语）
  6 词典层（③）：仅 1-5 无果时按 §2 词典（含 QA 面族→quality_rework）；排除族压制
  7 无信号 → unknown（trigger=unknown）
  多因并存：主因=按上述序首个触发者；secondary_cause 仅词典/声明行标注（non_defect/spec_face/
      user_directed/upstream_sync/staged_delivery）
```

cancellation_retry 双入口（裁决⑨）：文本 `cancellation_declared`（①层）∨ 面一 `terminal_cancelled` 状态（3.5 步——先于排除层/结构层）；无信号→unknown。§2.2-2 ①句开口"等"由此闭合（gap-3）。

**文本声明×状态入口共存序（回归例 #38，收尾修 F-3 锁定）**：note 命中 `infra_failure_declared` ∧ dispatch 终态=terminal_cancelled → **infrastructure_retry**（声明①层先于 3.5 状态入口——环境事实声明为更高信号级；取消面若另有 `cancellation_declared` 文本则 cancellation_retry 居先）。

**裸 non_rework 声明的归属（2026-10-09 planner 裁，回归例 #37）**：attempt_no>1 且仅命中 `non_rework_declared`（无 infra/cancel 声明、无排除短语）→ non_rework=**压制声明族不直接归类**（现行冻结解读）→ 落结构层 quality_rework（attempt 序号>1 主因）；§2.2-2 ①层措辞张力（"非返工"字面 vs 结构主因）随 gap 回灌批处置。

**双文本同现断句消歧（QA P2-2，2.0.0 括注改写）**：步 3 的 `infra_failure_declared` 与 `cancellation_declared` 判定为**有序判定非并行枚举**——infra 声明先判：两声明同现时 infra_failure_declared 命中即归 infrastructure_retry（trigger=environment），cancellation_declared 不再触发取消分支（环境零产出为主因、取消为其后果形态——「网络中断零产出后取消续作」类行）；仅当 infra 不命中而 cancellation 命中时归 cancellation_retry。38 例回归 C02（infra×terminal_cancelled 状态共存）与 H17 形（user 触发族×无环境面）均为本序的正交面。

**段序标记语义（2.0.0，H07）**：无序号限定后缀行（如 `live`）=新交付段标记——该形态不落入 attempt 数字序（其"序号"在段内语义，非票级 attempt 序）；段序上下文由消费方计算（同表 developer 系行中 segment_marker 形态的序数）：**首个段序标记行=initial**（该段初次交付——「live 窗 A harness 面初次交付」真值口径），**后续段序标记行=quality_rework+secondary=staged_delivery**（后续分段交付）。

**声明层内序冻结（2.1.0 票面②）**：**user 触发族先于 spec_face**（与 2.0.0 实现注释恒等冻结——「用户裁决驱动修订」spec_face 冻结形含「用户裁决」被 user 触发族先行命中，结果同值 user/user_directed，语义等价；序不再悬置）。

**段序标记白名单（2.1.0 票面②，登记位）**：无序号限定后缀入段序标记须命中**段名白名单**（冻结枚举：`live`）——白名单外垃圾值（`TBC`/`待定`/`n/a`/`TBD` 等）不作段序标记（免疫开放垃圾值；判据实现=ticket-consistency-parser §1.1 2.1.0 追加条款 2）。段名增补=词典 minor 版递增。

## 4. secondary_cause 枚举（附件 A 冻结+classifier-v2 裁决 A 扩枚举）

`{non_defect, spec_face, user_directed, upstream_sync, staged_delivery} | null`——单因或无标注=null；映射行=§1 spec_face_declared（spec_face/user_directed）、non_defect_minor_declared（non_defect）、user_directed_declared（user_directed）、upstream_sync_declared（upstream_sync）、staged_delivery_declared（staged_delivery）。schema 面=event-schema VR-S30（O-43）；M2 消费面=22 §4 三行同口径（剔 secondary∈{non_defect, upstream_sync, staged_delivery}——裁决 A，前向生效+趋势断裂声明）。

## 5. 数据集与版本纪律（引用 classifier-acceptance.md）

- development_regression_set（**38 例**=终审 20+第四轮 held-out 16+planner 裁增补 2；P3-2 口径统一）=tests/stats3/classifier-36.test.mjs 逐例回归（不计 precision）；**2.0.0 翻转旧例=回归红→逐例记录呈 planner 裁（对照表+替代例自同源未用行新抽，受密封约束），禁静默改 expected（classifier-v2 红线 2）**；
- **烧毁 18 例对照集**（classifier-v2 红线 3）：stats-3 held-out census 18 例（sealed ab366ec5/planner 终值）作 v2 对照——expected=planner 复核终值工件（只读）；门槛=全绿；**对照集参与 v2 设计，其绿不构成泛化证据——泛化证据仅新 held-out（census 18 例重密封重分类）**；对照红=逐例归因入新框风险清单；
- held_out_acceptance_set 抽样规则登记位=本文件版本（新框=行级排除机械判据：行 SHA ∉ fixtures 38 例 provenance 行集（slug:line）∪ 烧毁 18 例密封集（row_sha256）——classifier-v2 裁决 B；行级隔离稀释明文承认：同票未用行与已用行同风格，终值报告强制披露）；
- 词典/规则制定者不得见 held-out 样本内容（隔离纪律，§2.2-11）；**滚动重验条款（裁决 D）**：新票台账/活仓行累积 ≥10 行 → 触发 v2.1 新批密封重验；
- **burned-18 叠加机制（2.1.0 ②登记）**：烧毁对照集**累积扩容**——18 例（ab366ec5）→ **+census 19 例**（classified aae20992 记录件行集并入烧毁面——该集已参与 v2.1 设计）→ 后续每轮滚动重验批的密封行集并入（增量累积，永不回收）；跨版本复用由 §0 sealed 工件 fail-loud 钉定面把守（classifier_version 不符 → fail-loud，版本升级须重新密封）；
- **滚动重验触发计数口径（classifier-v2.1 票 r2）**：触发=**净新行累积 ≥10**——口径=heldout-live 采集脚本 **dry-run 报数**（新源异质形态前置暴露，不计密封）、经**行级排除判据**（行 SHA ∉ fixtures 38 例 provenance 行集 ∪ 烧毁集〔含 census19 扩容〕）后**净增**；**initial 行计入**；AITrader2 净余量 dispatch 前工具面实算并声明口径；
- **census19 非泛化声明（2.1.0）**：census 19 例面绿**不构成泛化证据**（该集参与 v2.1 设计——沿 classifier-v2 红线 3 措辞）；**泛化证据唯一来源=未来滚动重验批双门**（新框密封+2.1.0 分类+planner 独立复核——见票面滚动重验流程）。
