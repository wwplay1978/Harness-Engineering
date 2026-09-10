# AGENTS.md · 工作区约定（索引层，≤100 行）

> 生成说明（本段随模板恒等保留）：本模板**零参数、全项目全宿主恒等**（spec 19 v3）——安装器在 S5 原样复制到项目根，不做任何替换；一切项目/机器可变参数（项目快照、知识库三区、agent 段、规范仓路径）住在两级 harness 配置：机器级 `~/.agents/Harness-Configuration/`（common.config.md 共享 + `<host>.config.md` 宿主）与项目根 `harness.config.md`（模板见 REPO templates/harness-{common,host,project}-template.md，值由 S5 问答生成）。sync 以本文件为基准做逐字节恒等比对（normalize=统一 LF + strip BOM）——任何差异即宪法漂移；模板任何变更即宪法级变更，走人工修订与发布流程。

## 项目参数

项目名、一句话定位、技术栈、构建/测试命令、目录速览、知识库项目段：见项目根 `harness.config.md`（**人工维护，agent 用前必读**——测试命令等时效字段由人随里程碑更新）。

## 团队流水线（六角色）

planner → developer → code-reviewer → qa-tester → code-reviewer（增量快审）→ red-teamer（对抗审查，合并前最后门禁）→ 【质量门全绿=auto-merge / 门不全绿=人】→ archiver（归档沉淀）

1. 新需求先派 planner（ZCode：subagent_type=planner；其他宿主派发语法见 docs/18）产出 spec（`docs/specs/`）+ tickets（`docs/tickets/`），任何人不得直接写码。main agent 回收交付物后、派 developer 前，把 docs/specs/ 与 docs/tickets/ 提交入 main（commit 如 docs: spec <slug> r1）——未提交的 spec 在 worktree 内不存在，developer 拿不到
1b. **方案红队前置门**（spec 20 §2.5）：planner 对 spec 标 `spec-redteam: full/fast/skip`（默认 full；架构级/新机制/跨模块强制 full；skip 限琐碎修正票）——full=派 red-teamer 攻方案（隐含假设/遗漏依赖/边界/一致性/能否直接开工），报告落盘 `docs/reviews/<slug>-spec-redteam.md`；P0/P1 由 planner 吸收修订升版（r1→r2，修订说明列吸收项），**人终确认**（spec+报告+修订对照）方拆 tickets；fast=main agent 按攻击清单自查；同一 spec 红队 attempt≥2 换攻击面重攻、>2 转人工
2. developer 按场景建/进 worktree（Write/Edit 类写入被 hook 阻断；Bash 盲区见 05 §3），分支名用 ticket slug：一律 `git gtr new feat/<slug> --from main`（串行依赖链：有依赖的 ticket 等上游合并入 main 后开工）；修复轮 `cd "$(git gtr go <slug>)"`，完成后汇报分支
3. main agent 生成 diff 快照（基准一律为 main）：`git diff main...feat/<slug> > docs/reviews/<slug>-r<n>.diff`，派 code-reviewer；**回收审查报告并落盘** `docs/reviews/<slug>-r<n>-review.md`（审查证据链随 git 版本化，不得只留在会话里——反模式 7"聊天记录当文档"）——审查者输入白名单（软约束）：只有 spec 路径 + diff 快照，禁止转述实现过程
4. request changes → developer 修复轮 → 重新生成快照（r<n+1>）→ 复审；pass → qa-tester 验收（默认与 developer 同分支，测试提交到 feat/<slug>）
4b. 修复轮/复审（r>=2）/QA 复测：按路由表（~/.zcode/models.config.json）派 *-rerun 变体（重跑模型）；首跑派原角色；attempt 计数记入 ticket 运行记录（main agent 代录），attempts>4 转人工（见 09 §2）
5a. 合并前对抗性审查：planner 定级 red-team: full / fast / skip。full=派 red-teamer（大票可两路并行：实证+安全，模型可异构）；fast=code-reviewer 追加攻击清单 pass；skip=琐碎票。安全/数据 P0 强制返工阻断（人可覆写留痕）；报告落盘 docs/reviews/<slug>-redteam.md。与 1b 方案红队分工：1b 攻方案可靠性，本步攻实现与方案偏差+实现层风险（边界/并发/安全/性能）
5. QA 提交测试后生成增量快审：`git diff <reviewer通过时commit>...feat/<slug> > docs/reviews/<slug>-tests.diff`，快照文件头写一行锚点（base/head commit hash）；派 code-reviewer 只审测试质量；报告落盘 `<slug>-tests-review.md`
6. **合并：质量门全绿自动执行、门不全绿必须人**（spec 20 §2，2026-09-10 修订；宪法修订/hooks/发布类票永不入自治链，强制人工链）。自动合并前置断言脚本全绿（REPO `templates/tools/pre-merge-check.mjs`：spec/tickets 零偷改、自上一 merge commit 起 main 直提白名单对照、--no-ff 单分支、上游依赖已入 main），输出落盘 `docs/reviews/<slug>-premerge.log`，merge commit 尾注 `auto-merge: gates green <摘要>`；push 仅当项目配置含 `auto_push_remote`（无人配置=不自动 push）；archiver 归档时复核 premerge 工件与 auto-merge 痕迹一致，不一致=流程事故。人执行合并时跑同款断言（--no-ff，只合 feat/<slug> 一个分支）；合并后检查 `git diff main...feat/<slug> -- docs/specs/ docs/tickets/` 应为空；本单时间窗内 `git log main --oneline --no-merges` 逐条对照 main 直提白名单（chore: archive* / docs: spec* / docs: agents*（宪法修订，须注明人授权）三类；例外=人在场明确授权的一次性直提，尾注 `committed on user authorization <日期>`，无此留痕即越权——Bash 盲区补偿）。合并后派 archiver（subagent_type=archiver）执行归档 SOP（见角色文件；铁律：结论笔记先于归档提交）
7. 依赖链：合并严格按 tickets 依赖顺序；并行场景只读调研可多派，写代码一任务一 worktree
8. 命名约定：分支、diff 快照、QA 报告、记忆条目、Obsidian 工作区草稿一律锚定 ticket 英文 slug；hindsight bank 例外——按项目自动派生（见 03 §2.4），勿手工建 bank，条目内容注明来源 slug
9. spec 修订：文件头部维护修订号（r1/r2…）。spec-gap 变更三段链：QA/reviewer 发现 → 落 `docs/changes/<slug>.md`（QA 自己写；reviewer 无 Write，由 main agent 代写）→ 归档后 planner 产出升版正文，main agent 代为落盘提交（docs: spec <slug> r<n+1>）并删对应 changes 条目（planner 禁 Bash/Edit，物理上不能提交）；升版提交先于下游 ticket 的 --from main。changes/ 长期滞留 = 流程缺陷

## 记忆与知识库

- 团队记忆（basic-memory）：决策（decisions/）、实现备注、QA 结论（qa/）、合并结论；所有调用显式 `--project <project_name 小写>`
- 个体记忆（hindsight）：跨会话经验自动 retain/recall；bank 按项目自动隔离，勿手工建 bank
- 知识库（Obsidian）：**vault 根与三区以机器级 harness 配置为准**（common.config.md：vault_root / zone_final_project / zone_final_common / zone_workspace；agent 段=<host>.config.md 的 agent_segment；项目段=项目配置 project_segment，缺省派生式）——定稿知识在通用定稿区与项目定稿区（**只能人写，AI 永不直接写**），进行中未整理知识一律在工作区（按类型：工单沉淀/决策速记/环境怪癖/调研笔记）。planner 开工前必检定稿项目页与工作区两处；**信任分级：定稿区可直接引用，工作区（folder 标签以 zone_workspace 值前缀）为未整理草稿、结论须验证**；archiver 只写工作区
- **fail-loud**：harness 配置缺失或字段非法时，停下报告，不得臆造路径或回退猜测值
- 边界：可审查决策 → git/basic-memory；个体经验 → hindsight；人类知识 → Obsidian

## 红线（违反即流程事故）

先 Spec 后 Code ｜ 合并须质量门全绿（全绿可自动执行留 auto-merge 痕迹、不全绿必须人）｜ 一 ticket 一 worktree ｜ AGENTS.md 与 harness.config.md（两级）只能人改 ｜ 密钥不入库（git/记忆/spec 均否）｜ 验证清单不勾不宣称完成 ｜ Bash 写主检出非白名单路径/两级配置/宪法与 Write/Edit 面同罪（盲区补偿见 05 §3）

## 语言约定

自然语言层中文（spec、审查报告、QA 结论、记忆）；机器标识层英文（代码、路径、分支、技能名、commit message）。

## 文档地图（渐进披露，按需读取）

- 规范总纲与记忆/评估/约束设计：harness 规范仓库 `docs/`——标准位 `~/.agents/Harness-Engineering/docs`（默认；实际路径以机器配置 harness_repo 为准）
- 机器参数：`~/.agents/Harness-Configuration/`（common.config.md 共享 + `<host>.config.md 宿主）
- 本项目工件：`docs/specs/`（规格） `docs/tickets/`（票据） `docs/reviews/`（diff 快照与审查） `docs/changes/`（变更隔离） `docs/audits/`（harness-audit 报告） `docs/metrics.md`（度量）
- `CONTEXT.md`（项目根，planner 的 grill-with-docs 产出，存在时；guard 白名单放行该文件）
