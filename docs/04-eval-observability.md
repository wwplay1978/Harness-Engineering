# 04 · 评估与观测：L1–L4 门禁、harness-audit 自检与度量闭环

> 原则：AI 输出不经验证不算完成（宪法层原则 4/8 的落地）；"跑通了"必须有证据。

## 1. 四级质量门禁（L1–L4）

继承 Harness 文章支柱五的分级思想，接入六角色流水线：

| 级别 | 检什么 | 谁执行 | 工具/命令 | 时点 |
|---|---|---|---|---|
| **L1 语法** | 能构建、能 lint | developer 自测（自动） | 项目构建命令 + linter（如 `ruff` / `tsc`） | 每 commit 前 |
| **L2 逻辑** | 单元/集成测试绿 | developer 自测 → qa-tester 验收 | 测试框架；"假红检查"纪律（失败必须因正确原因） | developer 交付前 + QA 验收 |
| **L3 规范符合** | 流水线约定是否被遵守 | code-reviewer + **harness-audit skill** | Standards 轴审查（Fowler 坏味道基线、密钥泄露一票否决、spec 防篡改检查） | 合并前门禁 1 |
| **L4 架构与人审** | 设计合理性、合并决策合规 | **人**（架构裁决与门不全绿合并）+ reviewer 辅助；gates 全绿 auto-merge 留痕 | diff 快照审阅 + spec 对照表 + 合并前检查（`git diff main...feat/slug -- docs/specs/ docs/tickets/` 应为空） | 门不全绿必须人；gates 全绿可自动执行（宪法/hooks/发布/key/提权/破坏性等永久人闸恒人工——spec 20 §2/§3） |

要点（继承 AITrader 实测结论）：

- reviewer 双轴 = Standards 轴（L3）+ Spec 轴（忠实实现验收标准，无多无少）；QA 测试增量另有轻量快审（只审测试质量，不重审实现）。快审可折叠进最近一次复审报告（独立章节 + metrics 注明"折叠"——2026-09-05 审计回灌，web2api ticket B 实践）。
- 每份审查报告必须注明锚点 commit、基准分支、spec 修订号——可追溯性是观测的一部分。
- 验证清单制度：每个 Phase 收尾跑清单（见 02 §6 移植重验清单与 06 文档 P0 判定标准），不勾不宣称完成。

## 2. harness-audit：规范的可执行版本

Harness 文章的核心工艺之一——"Skill 就是规范的可执行版本"。本体系定义 `harness-audit` skill（装于用户域 `~/.agents/skills/harness-audit/`，ZCode 与 Kimi 共享扫描），对目标项目按七维度打分：

| 维度 | 权重 | 检查要点 |
|---|---|---|
| AGENTS.md 质量 | 15% | ≤100 行索引式、双层结构、无事实本体堆积 |
| Rules/红线 | 20% | 红线清单齐全、guard hooks 在位且实测阻断、AGENTS.md 不可被 Agent 改写 |
| Skills/知识分层 | 15% | 技能原子化、按需加载、无巨型 prompt |
| MCP/工具 | 10% | 只有三件套 + 项目必需项、每个能回答"解决什么问题" |
| Plan/SDD 流程 | 15% | docs/specs|tickets|reviews|changes 目录约定、spec 修订号、slug 命名锚定 |
| 工程规范 | 15% | L1/L2 门禁命令可跑、测试绿、commit message 英文 |
| 记忆与归档 | 10% | 记忆条目有家、hindsight bank 隔离正确、归档闭环（含知识回写） |

- **评级**：S（≥95）/ A（≥85）/ B（≥70）/ C（≥55）/ D（<55）；C 以下出 P0–P3 优先级整改建议清单。
- **频率**：新项目接入时跑一次（定基线）；此后每季度一次；重大规范变更后加跑。
- **产出**：报告落目标项目 `docs/audits/YYYY-MM-DD-audit.md`，分数趋势进 `docs/metrics.md`。

## 3. 观测点清单（哪里看发生了什么）

| 观测点 | 位置 | 看什么 |
|---|---|---|
| ZCode hook 执行日志 | ZCode 日志（官方称含 fired/timeout/blocked、耗时、stderr 预览——具体字段以 P0-3 实测日志格式为准） | guard 阻断是否生效、hindsight hooks 是否 fail-open |
| hindsight 指标 | `:8888` Prometheus 端点 | retain/recall 速率、延迟、bank 容量 |
| hindsight Control Plane | `:9999` Web UI | 记忆内容抽查（投毒/过时检测）、bank 隔离确认 |
| ZCode 内建记忆 | `~/.zcode/cli/memories/projects/<id>/MEMORY.md` | 兜底层是否被滥用（应轻量） |
| git 审计轨迹 | `docs/reviews/` 快照、spec 修订号、合并记录 | 每单的完整证据链 |
| 会话恢复 | ZCode `ReadSessionContext`（#sess 交接）+ handoff skill | 断点续作能力 |

## 4. 度量指标（轻量启动，不建仪表盘）

每个启用项目维护 `docs/metrics.md`，按工单行级记录（archiver 在归档 SOP 第 5 步代录，人抽查）：

| 指标 | 定义 | 目标方向 |
|---|---|---|
| 一次通过率 | reviewer 首轮即 pass 的工单占比 | ↑ |
| 返工轮次 | 每单 request-changes 轮数均值 | ↓ |
| QA 缺陷密度 | 每单 QA 抓出的缺陷数（区分真缺陷/spec-gap） | 观察 |
| 记忆命中 | 会话中 hindsight 注入被实际引用的次数（人工抽查） | ↑ |
| audit 分数趋势 | 季度 harness-audit 总分 | ↑ |
| 归档闭环率 | 完成记忆回写 + 知识回写的工单占比 | →100% |

度量纪律：**指标驱动规范修订**（反馈闭环的最后一段）——连续两个季度某指标无改善，对应规范要么改要么废，不留摆设指标。
