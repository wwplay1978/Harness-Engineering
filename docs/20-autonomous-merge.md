# 20 · 设计确认后自治流水线（自动提交/推送/合并）

> 状态：spec 草案 r5（2026-09-10），与 19 号 spec 并行立项；**宪法级修订——§2 红线修订表述已获用户确认（2026-09-10）=修订授权**；宪法模板落法与 19 的 T1（零参数化重写）**同一次替换完成**，在装项目按 19 §6 阶段 2.3 一次换版到位。r2/r3：主会话两轮自查修复；r4：方案红队前置门 §2.5；**r5：独立盲审修复（red-teamer@volces2 执行——首答被无关文本污染、追问后交出完整报告；其"须重大修订"总判定经核验下调为"修 P1 后可执行"：将"spec 已写实现未动"计为 P0 属误判——C2/C3/A4 即 T1–T3 待办票；真缺陷= Bash 盲区×自治链（§2 新增闭合条款）+软门自证收紧（§3）+push 白名单键（§4）等，均已修）**。
> 一句话：人闸从"每票合并"集中到"需求/设计确认 + 终验收"两端，中间链路的 git 提交、推送、合并在质量门全绿时自动进行——服务长时运行任务（过夜跑 ticket 链）。

## 1. 背景与动机

- 用户裁决（2026-09-10）：项目需求及设计确认阶段之后应尽量减少人工干预和操作，每项任务完成后的 git 提交、推送和合并应自动进行。
- 现状瓶颈：现行流水线每票合并都是人闸（AGENTS-template 流水线第 6 步"全部通过后由**人**执行合并"）——长任务中 ticket 链在合并点反复停摆等人。
- 业界对应：CI/CD 的 auto-merge on green checks、batch approval——质量门机器可判定且全绿时自动合入，人审集中在设计端与终验端。

## 2. 人闸重排（宪法影响，核心修订）

现行红线"合并决策永远是人"修订为**两端人闸 + 中间自治**：

| 阶段 | 人闸 | 内容 |
|---|---|---|
| 设计门（人） | ✔ 保留 | spec r1 确认、需求裁决、范围变更——不变 |
| 执行链（自动） | ✘ 撤除 | developer → review → QA → red-team → 合并 → 归档 → 下一票，全程自动（§3–§4） |
| 终验收门（人） | ✔ 保留 | 链结束/中断时人工验收 checkpoint 报告 |

**永久人闸清单（任何自动化模式下永不撤除）**：宪法修订（AGENTS.md / docs: agents* 类提交）、key 与凭据、提权操作、宿主 hooks 注册、**对外发布（公开仓 push 与发布流程）**、删除性/破坏性操作、red-team 安全/数据 P0 阻断处置。

**票类型过滤（r7 显式化）**：宪法修订/hooks 注册/对外发布类票（docs: agents*、发布、hooks 配置变更）**永不进入自治链**，强制人工链——main agent 派发前按票类型分流，误入即流程事故。

**Bash 盲区与自治链（r5，盲审 P0-4/P0-5 闭合）**：guard 只挂 Write|Edit|ApplyPatch、不拦 Bash 写入（05 §3 已知盲区）——自治链去除人审合并后此盲区威胁面扩大，显式闭合：① **红线延伸**：main agent 以 Bash 写主检出白名单外路径、两级 harness 配置、AGENTS.md = 流程事故（与 Write/Edit 面同罪，审计同权）；② **既有补偿的自动化形态**：pre-merge 断言的"main 直提白名单对照"正是 05 §3 Bash 盲区补偿①的机器化——Bash 绕过 guard 的直提会以非白名单 commit 显形并被断言拒绝；③ 机器配置（不入项目 git）的 Bash 篡改由 sync hash 快照检测（改而未记 [WARN]，19 §3.4）；④ Bash 命令模式 hook（拦写主检出模式）维持 Phase 2 加固项定位——auto-merge 落地**不依赖**其完成，但落地后该 hook 提升优先级。

### 2.5 方案红队前置门（r4，用户裁决）

现行 red-teamer 只在合并前攻实现（流水线 5a 步）——方案不可靠时 developer/code-reviewer/qa-tester 全链跑完才暴露，返工杠杆最差。本门把对抗审查**前置到方案层**：

- **时序**：planner 产出 spec r1 → **方案红队攻击**（自动环节，不增加人闸）→ planner 吸收 P0/P1 修订升版（r1→r2，修订说明列吸收项，沿用三段链修订号语义）→ **人终确认**（spec + 攻击报告 + 修订对照一并看）→ tickets 拆解 → 自治链启动。人可选先做 5 分钟方向粗筛（时间盒对冲既有惯例）；终确认即设计门本体——与 §2 两端人闸嵌合。**派发主语=main agent**（r5 澄清：与流水线所有角色同构；red-teamer 零派发——子代理不可再派子代理，多路并行由 main agent 编排，见角色文件约束节）。
- **定级**：planner 对每个 spec 标 `spec-redteam: full / fast / skip`——**默认 full**（派 red-teamer 子代理攻方案：隐含假设/遗漏依赖/边界/一致性/规格完备性"能否直接开工"）；fast=main agent 按攻击清单自查；skip=琐碎修正票（纯文案/单行修复）。架构级/新机制/跨模块 spec **强制 full**。
- **输出**：`docs/reviews/<slug>-spec-redteam.md`（P0–P3 分级 + 证据 + 修复建议）；P0/P1 必须吸收后方可终确认；P2/P3 可挂起留档。
- **与合并前红队的分工**（5a 步不变）：方案红队攻"方案可靠性"（假设/遗漏/一致性），合并前红队攻"实现与方案的偏差 + 实现层风险"（边界/并发/安全/性能）——两次攻击面刻意错开，防同面重复放行。
- **成本与重试**：自治链内的自动环节；同一 spec 的红队 attempt≥2 换攻击面重攻（盲审换面原则），>2 转人工；不为 red-teamer 造 rerun 变体（简单优先，模型路由不扩）。
- **有效性判据**（对齐 red-teamer 既有判据）：首单至少产出 1 条 planner 与人粗筛均未覆盖的有证据风险；连续 3 单零产出 → 降级为按需角色并回检定级是否过松。

宪法条文落法：红线"合并决策永远是人"改为"**合并须质量门全绿；门全绿可自动执行（留 auto-merge 痕迹），门不全绿必须人**"——把"人"从执行者改为规则制定者与例外裁决者。

## 3. 自动合并门（gates，全部机器可判定）

1. code-reviewer **pass** 报告落盘在档（`docs/reviews/<slug>-r<n>-review.md`，非转述）。
2. QA **pass** + 测试增量快审 **pass**（`<slug>-tests-review.md`）。
3. red-team 定级非阻断：full/fast 出报告且无 P0 返工令；skip 级别限琐碎票（planner 定级，规则不变）。
4. **pre-merge 断言脚本全绿**（新增 `templates/tools/pre-merge-check.mjs`，自动合并前必跑）：
   - `git diff main...feat/<slug> -- docs/specs/ docs/tickets/` 为空（spec/tickets 未被票内偷改）；
   - 本单时间窗 main 直提白名单逐条对照（chore: archive* / docs: spec* / docs: agents* 三类 + 第四类 authorization 尾注）——**时间窗锚点（r3 定义）：自上一 merge commit（`git log --merges -1 --format=%H`）以来的 main 直提**；
   - 合并对象唯一：--no-ff、只合 feat/<slug> 一个分支；
   - 依赖链：上游 ticket 已在 main——**软门 + 机器辅助**（r5 收紧，防执行者-受益者同体自证）：pre-merge 脚本对 tickets 声明的上游做两项机器检查——上游 `feat/<upstream>` 分支已不存在（合并即删的惯例）**或** `git merge-base --is-ancestor <上游合并基> main` 判定已入 main；无法机器判定的自由文本部分才由 main agent 判定并记入 premerge 工件；tickets 依赖字段结构化后升硬门。
5. attempt 计数未超限（单角色 >4 转人工——既有 OPT-2 规则保留，自治链同样受辖）。
6. **gates 证据落盘与复核（r7 新增）**：pre-merge 断言输出落盘 `docs/reviews/<slug>-premerge.log`，auto-merge commit message 引用该工件；**archiver 归档 SOP 复核**"premerge 工件在档且 PASS、与 auto-merge 痕迹一一对应"，不一致=流程事故——防 main agent 跳过脚本直 merge 的"自述绿"（执行者与受益者同一主体的制衡）。

## 4. 自动提交与推送

- **提交**：现行已大多自动（spec 入 main、developer/QA 的分支提交、archiver 归档提交）——本票无变化，仅明确化。
- **合并**：gates 全绿 → main agent 执行 `git merge --no-ff feat/<slug>`，commit message 尾注 `auto-merge: gates green <gate 摘要>`（审计痕迹，人事后可 grep 全量复核）。
- **推送**：**自动 push 白名单键（r5，盲审 P2-4）**：项目级配置须含人显式配置的 `auto_push_remote`（默认**无此键=不自动 push**，自治链只本地合并留痕）——键值=允许自动 push 的 remote 名/URL；另 pre-merge 脚本内置已知公开仓 URL **禁止列表**（Harness-Engineering 发布仓等）作双保险；**公开仓/发布流程永不自动 push**（08 发布纪律与机器锚点扫描照旧人执）。

## 5. 暂停、检查点与回退

- **失败即停**：任一 gate 红 / 测试失败 / 脚本异常 → 停链 + 报告（**不自动 revert**——自动回退本身是二次风险源，回退属终验收门的人工决策）。
- **检查点**：每 K 票（默认 3，项目级 harness.config.md 可覆盖 `checkpoint_every`）产 checkpoint 摘要：已完成票清单/当前状态/风险与异常/下一票预告——**由 main agent 编排产出**（r5 明确主体：计数锚=上一 checkpoint 后已归档票数，非 archiver 职责）；**落盘 `docs/checkpoints/<日期>-<序号>.md`（r3 补：白名单区可写、随 git 版本化，终验收门的人只看这组文件即可复盘整条链）**。
- **硬停点**：人随时叫停；red-team P0；attempt>4；同一 ticket 连续 2 轮失败（r7 措辞精确化，防错误累积循环）。
- **恢复**：人工处置 + 验收后重启链。

## 6. 决策点

| # | 决策 | 推荐 |
|---|---|---|
| E1 | 检查点间隔 K | 3 票（项目配置可覆盖） |
| E2 | 自动 push 范围 | 仅项目私有 origin；fork/公开仓一律人手 |
| E3 | 试行场 | AITrader2 重建（N19 长任务实测）先行，试行期 checkpoint 加密为每 2 票 |

## 7. 变更清单

| # | 对象 | 变更 |
|---|---|---|
| A1 | templates/AGENTS-template.md | 红线行与流水线第 6 步按 §2 改写（宪法修订，人已确认 2026-09-10）——**并入 19 号 spec C1 的零参数化重写，同一次模板替换、在装项目同一次换版（19 §6 阶段 2.3），避免二次替换** |
| A2 | docs/05-guardrails-recovery.md | §3 人闸节重排为两端人闸表 + 永久人闸清单 |
| A3 | templates/agents/archiver.md | 归档 SOP 衔接自动合并（归档触发不再含等人合并语义）；**SOP 新增明确步骤：复核 premerge 工件在档且 PASS、与 auto-merge 痕迹一一对应（r5 点名，不一致即阻断并报流程事故）** |
| A4 | templates/tools/pre-merge-check.mjs（新） | §3-4 断言脚本；输出落盘 `docs/reviews/<slug>-premerge.log`（§3-6 证据链，archiver 复核依据） |
| A5 | docs/17 / 07 | 安装流程中流水线描述同步 |
| A6 | README（双语） | 自治模式说明 |
| A7 | 项目级 harness.config.md schema（19 号 spec 联动） | 增可选键 `checkpoint_every` + `auto_push_remote`（无人配置=不自动 push，§4） |
| A8 | templates/AGENTS-template.md（流水线第 1 步后增 1b 步：方案红队门 + spec-redteam 定级）+ templates/agents/red-teamer.md（两段职责：方案门/合并门）+ templates/agents/planner.md（定级与修订循环） | **并入 T1 的 v3 模板重写一次带上**（宪法与角色同版替换、零额外升级成本——19 §6 升级手册无须改步） |

## 8. 验收标准

- AC-E1 试行链 ≥3 票零人工干预走通，checkpoint 产出，auto-merge 痕迹与 premerge 工件一一对应齐全。
- AC-E2 注入 review request-changes → 停链报告，未合并。
- AC-E3 注入 red-team P0 返工令 → 阻断生效（不合并、转人工）。
- AC-E4 pre-merge 断言注入违例（票内偷改 spec）→ 拒绝合并。
- AC-E5 自动链尝试 push 公开仓 → 被人闸条款拦截（测试桩验证）。
- AC-E6 方案红队门实弹（r4）：沙盒项目一票 spec 红队跑通（full 定级、`<slug>-spec-redteam.md` 落盘、planner 吸收修订循环、终确认语义=设计门）；skip/fast 定级各验一例。

## 9. 与 19 号 spec 的关系

19 改"参数的住所"（明言不动流水线）；20 改"流水线的人闸分布"。相互独立、可并行实施；唯一交点=A7 的 `checkpoint_every` 键落 19 的项目级 schema。20 不放松 19 的任何配置红线（配置"只能人改"属永久人闸清单的宪法同族，不受自治模式影响——auto-merge 只作用于代码与工件合并）。
