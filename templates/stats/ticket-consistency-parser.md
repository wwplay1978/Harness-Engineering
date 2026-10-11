# stats-2 · ticket-consistency-parser 契约（结构列+显式声明短语；冻结）

> 依据：docs/tickets/stats-2.md 阶段四（审查 P0-4 裁决）；docs/22 §2.2-1/2（预处理规范化/信号优先级①层）与 §5.2（双面一致性七类差异）。
> 消费方：`harness-stats.mjs verify`（stats-2）；**stats-3 票据/git miner 与 attempt 分类器必须复用本解析器，不得重写**（P0-4）。
> 分期边界：本契约只解析**结构列与显式声明**，为 verify 对账供数；**不做文本词典推断**（词典推断=stats-3 分类器 §2.2-4）。stats-2 dispatch 未分类固定值：`attempt_kind=unknown`、`trigger_stage=unknown`、`classifier_version="unclassified-v0"`。
> **v2 扩展（classifier-v2 票 2026-10-11，gap-7① 回灌）**：§1 attempt 列规范化规则三件套（§1.1）+执行会话标识新列（D7' 消费面，§1.2）；§2 冻结三类声明与 §3 七类谓词**零改动**（diffTicket 消费 attempt_no——规范化扩面改善七类判定输入，谓词本身不动）。

## 1. 输入与结构列（v2 起六列；其他列忽略）

输入=消费项目 `docs/tickets/<slug>.md` 的「运行记录」小节表格行（pilot 经 bundle `tickets/<slug>.md` 冻结件读取）。

| 列 | 规范化规则（冻结） |
|---|---|
| attempt | **v2 规则三件套（§1.1，gap-7①）**：模式类主规则（`r?数字+尾部括号/连字符限定语`→序号提取+限定语剥离）+枚举例外表（F-n 系→attempt>1 结构语义）+剥离白名单（实义子任务名不剥离）；v1 冻结形（`r<n>`/`R<n>`/纯数字→n；空串→不作结构信号）不变 |
| 角色/role | 精确匹配 developer / developer-rerun（大小写不敏感）；其他角色列值照录不计入 developer 对账；**列名三别名：`角色`/`角色/变体`（D7' 宪法 4a 列集规范名——阶段三预检 ① 增补，2026-10-11）/`role`** |
| 结果/result | 照录（本契约不据此分类；仅作差异输出的匿名附注） |
| 日期/date | `YYYY-MM-DD` 解析；pilot 窗口谓词 [2026-09-01, 2026-10-01) 由 verify 侧判定 |
| 备注/note | 仅做 §2 显式声明短语枚举匹配；无枚举命中 → 无声明 |
| 执行会话标识（v2 新列，D7' 消费） | 列名匹配 `执行会话标识`（**末位列**——D7' 列集规范；值禁含 `\|` 与换行，含则照录不解析）；判据全文见 §1.2 |

### 1.1 attempt 列规范化 v2（规则三件套+误提取负例清单冻结——gap-7①，活仓限定后缀形态）

**模式类主规则**：`r?<数字（1–3 位）>+尾部限定语`（尾部括号形 `r2（修复轮）`/`r1（**离线部**）` 或尾部连字符形 `3-追加`）→ **序号提取**（`attempt_no`=数字）+**限定语剥离**（`attempt_qualifier`=限定语照录，`**`/反引号包裹剥离）。多限定语叠加（如 `r2（修复轮）（追加）`）不适用模式类 → **不作结构信号**（attempt_no=null、无段序标记——诚实降级不猜）。

**无序号限定后缀**：非空且**无数字成分**（如 `live`）→ `attempt_no=null`+**段序标记**（`segment_marker=true`）；含数字成分但不适用模式类的形态（日期形 `2026-09-20`/叠加形）不作段序标记（防误标）；段序上下文（首段=initial/后续段=staged_delivery）由消费方经全表 developer 系行的段序计数提供（classifier-dictionary §3），parser 只产标记。

**枚举例外表**：`F-<n>` 系（findings 编号，如 `F-1 修复轮`）→ `attempt_no=null`+`attempt_findings_no=n`+`attempt_gt1=true`（**attempt>1 结构语义**——F-n 为 findings 编号非 attempt 序号，行=针对该 finding 的修复轮）。

**剥离白名单（实义子任务名不剥离）**：限定语命中白名单（冻结枚举：`离线部`/`harness`/`v3 离线面`/`窗口后机判`——限定语为实义子任务名时，序号照常提取但限定语保留为 `attempt_subtask` 段标识，不并入序号语义丢弃；白名单扩充=词典 minor 版递增）；白名单外限定语（`修复轮`/`追加`/`修复`/`红队修复轮` 等轮次标记）=纯限定语，剥离后仅记 `attempt_qualifier`。

**误提取负例清单（票面形态冻结枚举——验收面）**：

| 票面形态（冻结） | attempt_no | 附加标记 |
|---|---|---|
| `r1（**离线部**）` | 1 | qualifier=`离线部`（白名单→subtask） |
| `r2（修复轮）` | 2 | qualifier=`修复轮`（纯限定语） |
| `F-1 修复轮` | null | findings_no=1；attempt_gt1=true |
| `live` | null | segment_marker=true（段序上下文消费方供；仅无数字成分形态） |
| `r3（追加）` | 3 | qualifier=`追加`（纯限定语） |
| `r1` / `2` / `1`（v1 冻结形） | n | — |
| `1+2` / `r1+r2`（复合形，D6 面） | null | attempt_compound（v1 冻结） |
| 空串 / `—` / `-`（D7' 非适用占位） | null | 不作结构信号（v1 冻结+阶段三预检 ②——`—` 不得判段序标记） |

守卫：模式类/枚举例外表序号域=1–3 位数字（attempt 序号实际域；`2026-09-20` 日期形/超域序号不适用模式类——防日期误提取，且不作段序标记；纯数字/`r<n>` v1 冻结形序号域不设界——零改动）。

**2.1.0 追加条款（classifier-v2.1 票 2026-10-11 r2——追加式，既有行文零改写；stats-2 复用面零漂移以 `node --test tests/stats2/` 全绿为证）**：

1. **骨架事件文本兜底（①c）**：**表级**骨架形态（整表无 attempt/备注结构列——列名判定与列序无关；行级空串不触发）时，事件列（`事件`/`event`）交付语义形 `交付轮 attempt=<n>`（n=1–3 位）→ `attempt_no=n`（追加字段 `attempt_from_event`=命中原文留痕；`attempt_raw` 照录空）。**提取限交付语义形**（字面前缀制）——引用形（`修复 attempt=n`/`针对 attempt=n`）不命中=**显式排除**（误提取负例验收：`修复 attempt=3 收口`/`针对 attempt=2 的补录说明` → attempt_no=null）；骨架表列序变体（如 `锚|日期|角色|事件`）同提取。
2. **段序标记白名单（②）**：无序号限定后缀入段序标记须命中**段名白名单**（冻结枚举：`live`——登记=classifier-dictionary §3；本条款收窄上文「无序号限定后缀→段序标记」的开放面：白名单外垃圾值〔`TBC`/`待定`/`n/a`/`TBD` 等〕**不作段序标记、无任何结构信号**——免疫开放垃圾值）。段名增补=词典变更+版本递增（同剥离白名单纪律）。

### 1.2 执行会话标识列判据（D7' 消费面，宿主中立——判据全文）

D7'（宪法 4a 增补）列集规范：角色/变体、attempt、结果、日期、备注、**执行会话标识（末位列）**。**列名三别名（修复轮 P3-2 冻结，2026-10-11——以实现为准入契约，禁删防破台账面）：`执行会话标识`（D7' 规范名）/`会话标识`（缩形）/`childSessionId`（宿主技术名——表头经 parser 小写化为 `childsessionid` 键）**。宿主提供派发级会话标识则必录（ZCode=childSessionId，获取=派发回收 agentId 经 `agents/*/agent_*/metadata.json` 内 agentId 字段反查）；不提供的宿主记 `host:n/a`。解析四分支：

| 值形态 | 解析输出 | 归因语义（22 §2.3 接缝） |
|---|---|---|
| 真实会话标识（`sess_…` 等非 `host:` 前缀非空值；`—`/`-`/空除外） | `session_id` 照录 | EXPLICIT 归因锚成立（行含真实 childSessionId） |
| `host:n/a` | `session_id=null`+`session_host_na=true` | **该行归因上限 DIRECT、不升 EXPLICIT**——行有会话标识列值但为 `host:n/a` 时=有列无锚：EXPLICIT 判据（行含真实 childSessionId）不成立，归因按下限 DIRECT 处理，不得因列值在场升 EXPLICIT |
| 其他 `host:<x>`（如 `host:kimi-session_…`） | `session_id=null`+`session_host_marker` 照录 | 宿主标记形态（非 ZCode childSessionId 形态）——同归因上限 DIRECT（EXPLICIT 判据=真实 childSessionId 在场） |
| `—`/`-`/空 | 无标识记录（`session_id=null`） | 归因不受此列影响（回落既有五级判据） |

## 2. 显式声明短语枚举（冻结；源自 22 §2.2 信号优先级①层——原文明示原因）

**匹配列=仅 note/备注列**（结果列照录不参与——§1 冻结；防结果措辞误触发声明）。子串匹配，大小写不敏感。

| 短语（子串匹配，大小写不敏感） | 声明类型 |
|---|---|
| 网络中断 / 限流 / provider unavailable / 环境事件 / 断电续跑 | `infra_failure_declared` |
| 非返工 / 非缺陷 / 时序 | `non_rework_declared` |
| 多 attempt 合写 | `multi_attempt_declared` |

**禁止**：本契约不加载 §2.2-4 词典的任何 quality_rework/evidence_refresh 推断短语——出现"修复/重跑"等词不产生任何声明（stats-3 分类器职责）。

## 3. 七类差异·逐条精确谓词（verify ⑩；差异率超阈默认 5% → fail-loud exit≠0）

设 `rows(slug)` = 该票运行记录行的结构列解析结果集（按文档行序）；`dispatch(slug)` = 事件仓内 `attribution=DIRECT ∧ ticket_slug=slug ∧ role=developer`（含 variant base/rerun）的 dispatch 事件集合。

| # | 差异类 | 精确谓词 |
|---|---|---|
| D1 | missing ticket row | 存在 dispatch(slug) 事件，而 `rows(slug)` 中无任何 role∈{developer, developer-rerun} 的行 |
| D2 | orphan dispatch | `rows(slug)` 含 developer(±rerun) 行，而 dispatch(slug) 为空集 |
| D3 | duplicate attempt | `rows(slug)` 内两行的规范化 attempt 序号 n 相等（同 developer 面） |
| D4 | non-monotonic attempt | `rows(slug)`（developer 面，按行序）规范化序号序列非严格递增 |
| D5 | attempt=1-but-infra-failure | 某行 attempt 序号==1 **且** 该行备注命中 `infra_failure_declared` 短语枚举 |
| D6 | one-row-multi-attempt | 某行 attempt 列为复合形（`<n1>+<n2>`/`r<n1>+r<n2>`，`+／＋` 连接）**或** 命中 `multi_attempt_declared` |
| D7 | variant-kind 冲突 | dispatch(slug) 事件 variant 集 ≠ rows(slug) 角色列蕴含的 variant 集（developer-rerun ⇒ rerun；developer ⇒ base） |

差异率 = 有 ≥1 差异的票数 ÷ 参与对账票数（= ∪(有 developer 行的票, 有 DIRECT developer dispatch 的票)）；`> 0.05` → verify exit≠0（M2 fail-loud，§5.2）。

## 4. stats-2 固定值与 stats-3 复用边界

- dispatch 三未分类字段恒 `unknown / unknown / unclassified-v0`（collect 侧已冻结）；本解析器不产出 attempt_kind。
- stats-3 复用面：本文件 §1–§3 全部规则与实现模块 `stats2/parser.mjs`；扩展（词典/分类）只能在其上**追加派生层**，不得改写结构列规范化与七类谓词。**v2 例外（classifier-v2 票批准面）**：§1 attempt 规范化与执行会话标识列=本契约批准修订（§1.1/§1.2）——七类谓词（§3）与冻结三类声明（§2）仍零改动。
- 输出脱敏：verify 默认输出 allowlist=project_id / ticket_slug / 匿名 source key（dispatch entity_id 的 SHA-8）/ 差异类别；路径与用户名形内容仅 `--include-paths` 开启（stats-4 ⑤ 做完整 B3 回归）。
