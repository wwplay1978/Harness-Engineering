# AGENTS.md ·「改成项目名」工作区约定（索引层，≤100 行）

> 生成说明（安装助手渲染后删除本段）：本模板由安装助手在安装 S5 按**问答渲染**生成为项目根 AGENTS.md（docs/17 §3 S5）——逐项采集「」字段（未提供按各字段括号内默认）、文档地图写入规范仓实际绝对路径。首次落位属**安装窗口一次性豁免**（"AGENTS.md 只能人改"红线网开一面，人复核渲染全文即视为人授权）；落位后红线恢复——此后只能人修改（guard hook 会阻断 Agent 改写）。保持索引式——事实本体放 docs/ 与知识库，这里只放"去哪找"。
> **维护点（2026-09-05 审计回灌）**：角色数变化时须同步本文件标题计数与流水线行（web2api 曾发生"五角色"滞留）；项目快照的测试命令等时效性字段随里程碑更新。

## 项目快照

- 项目：「改成项目名与一句话定位」（默认=目录名；定位可填"待补"）
- 技术栈：「改成语言/框架/包管理器，如 Python 3.12 + uv + pytest」（默认=安装助手探测结果，探测不出填"待补（planner 首个 spec 校正）"）
- 构建命令：「改成如 uv run build」（默认=按技术栈惯例候选，无则"待补（developer 首票确认）"）
- 测试命令：「改成如 uv run pytest -q」（同上）
- 目录速览：「改成核心目录一行图，如 src/（业务） tests/（测试） docs/（工件）」（默认=安装助手按仓库实际结构生成，人确认）

## 团队流水线（六角色，ZCode 版）

planner → developer → code-reviewer → qa-tester → code-reviewer（增量快审）→ red-teamer（对抗审查，合并前最后门禁）→ 【人：合并决策】→ archiver（归档沉淀）

1. 新需求先派 planner（subagent_type=planner）产出 spec（`docs/specs/`）+ tickets（`docs/tickets/`），
   任何人不得直接写码。main agent 回收交付物后、派 developer 前，把 docs/specs/ 与
   docs/tickets/ 提交入 main（commit 如 docs: spec <slug> r1）——未提交的 spec 在
   worktree 内不存在，developer 拿不到
2. developer 按场景建/进 worktree（Write/Edit 类写入被 hook 阻断；Bash 盲区见 05 §3），分支名用 ticket slug：
   一律 `git gtr new feat/<slug> --from main`（串行依赖链：有依赖的 ticket 等上游合并入 main 后开工）；修复轮 `cd "$(git gtr go <slug>)"`，完成后汇报分支
3. main agent 生成 diff 快照（基准一律为 main）：
   `git diff main...feat/<slug> > docs/reviews/<slug>-r<n>.diff`，派 code-reviewer；
   **回收审查报告并落盘** `docs/reviews/<slug>-r<n>-review.md`（审查证据链随 git 版本化，
   不得只留在会话里——反模式 7"聊天记录当文档"）
   —— 审查者输入白名单（软约束）：只有 spec 路径 + diff 快照，禁止转述实现过程
4. request changes → developer 修复轮 → 重新生成快照（r<n+1>）→ 复审；pass → qa-tester 验收（默认与 developer 同分支，测试提交到 feat/<slug>）
4b. 修复轮/复审（r>=2）/QA 复测：按路由表（~/.zcode/models.config.json）派 *-rerun 变体（重跑模型）；
    首跑派原角色；attempt 计数记入 ticket 运行记录（main agent 代录），attempts>4 转人工（见 09 §2）
5a. 合并前对抗性审查：planner 定级 red-team: full / fast / skip。full=派 red-teamer（大票可两路并行：实证+安全，模型可异构）；fast=code-reviewer 追加攻击清单 pass；skip=琐碎票。安全/数据 P0 强制返工阻断（人可覆写留痕）；报告落盘 docs/reviews/<slug>-redteam.md
5. QA 提交测试后生成增量快审：
   `git diff <reviewer通过时commit>...feat/<slug> > docs/reviews/<slug>-tests.diff`，
   **快照文件头写一行锚点（base/head commit hash）**——锚点只存会话里会因
   rebase/中断丢失；派 code-reviewer 只审测试质量；报告落盘 `<slug>-tests-review.md`
6. 全部通过后由**人**执行合并（--no-ff，只合 feat/<slug> 一个分支）；合并前检查：
   `git diff main...feat/<slug> -- docs/specs/ docs/tickets/` 应为空；本单时间窗内
   `git log main --oneline --no-merges` 逐条对照 main 直接提交白名单
   （chore: archive* / docs: spec* / docs: agents*（宪法修订，须注明人授权）三类，见 05 §3）。
   例外：人在场明确授权的一次性直提（第四类），commit message 须尾注
   `committed on user authorization <日期>`，无此留痕即越权（Bash 盲区补偿）。
   合并后派 archiver（subagent_type=archiver）执行归档 SOP 七步（见角色文件；
   铁律：结论笔记先于归档提交；含 ticket 状态更新与 spec 升版交接）
7. 依赖链：合并严格按 tickets 依赖顺序；并行场景只读调研可多派，写代码一任务一 worktree
8. 命名约定：分支、diff 快照、QA 报告、记忆条目、Obsidian 工作区草稿一律锚定 ticket 英文 slug；
   hindsight bank 例外——按项目自动派生（见 03 §2.4），勿手工建 bank，条目内容注明来源 slug
9. spec 修订：文件头部维护修订号（r1/r2…）。spec-gap 变更三段链：QA/reviewer 发现 →
   落 `docs/changes/<slug>.md`（QA 自己写；reviewer 无 Write，由 main agent 代写）→
   归档后 planner 产出升版正文，main agent 代为落盘提交（docs: spec <slug> r<n+1>）并删
   对应 changes 条目（planner 禁 Bash/Edit，物理上不能提交）；升版提交先于下游 ticket 的
   --from main。changes/ 长期滞留 = 流程缺陷

## 记忆与知识库

- 团队记忆（basic-memory）：决策（decisions/）、实现备注、QA 结论（qa/）、合并结论；所有调用显式 `--project <项目名小写>`
- 个体记忆（hindsight）：跨会话经验自动 retain/recall；bank 按项目自动隔离，勿手工建 bank
- 知识库（Obsidian MyObsidian）：定稿知识在 30-知识库/（通用）与 50-项目库/<项目名>/
  （项目），进行中未整理知识一律在 70-工作区/10-ZCODE/（按类型：工单沉淀/决策速记/
  环境怪癖/调研笔记）。planner 开工前必检两处；**信任分级：定稿区可直接引用，
  工作区（folder 标签 70-*）为未整理草稿、结论须验证**；archiver 只写工作区，定稿区只能人改
- 边界：可审查决策 → git/basic-memory；个体经验 → hindsight；人类知识 → Obsidian

## 红线（违反即流程事故）

先 Spec 后 Code ｜ 合并决策永远是人 ｜ 一 ticket 一 worktree ｜ AGENTS.md 只能人改 ｜ 密钥不入库（git/记忆/spec 均否）｜ 验证清单不勾不宣称完成

## 语言约定

自然语言层中文（spec、审查报告、QA 结论、记忆）；机器标识层英文（代码、路径、分支、技能名、commit message）。

## 文档地图（渐进披露，按需读取）

- 规范总纲与记忆/评估/约束设计：harness 规范仓库 `docs/`——标准落位 `~/.agents/Harness-Engineering/docs`（Windows 展开 `%USERPROFILE%\.agents\Harness-Engineering\docs`；2026-09-08 起，全机 AI agent 共用一份。渲染时安装助手写入本机实际绝对路径，非标准落位机以渲染结果为准）
- 本项目工件：`docs/specs/`（规格） `docs/tickets/`（票据） `docs/reviews/`（diff 快照与审查） `docs/changes/`（变更隔离） `docs/audits/`（harness-audit 报告） `docs/metrics.md`（度量）
- `CONTEXT.md`（项目根，planner 的 grill-with-docs 产出，存在时；guard 白名单放行该文件）
