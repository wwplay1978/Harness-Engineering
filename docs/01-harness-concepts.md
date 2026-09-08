# 01 · Harness Engineering 理念与总体架构

> 来源：OpenAI《Harness Engineering: Leveraging Codex in an Agent-First World》（2026-02）
> 原文：https://openai.com/index/harness-engineering/

## 1. 核心理念

**Agent = Model + Harness。** 模型能力由厂商决定，团队可控的只有 Harness（脚手架/工程化外壳）——包括上下文怎么给、工具怎么配、流程怎么编排、质量怎么验、出错怎么恢复。Harness Engineering 就是把"好代码"的标准从人脑写进系统，让 AI 在约束下自主干活。

文章给出的实证基线：3–7 人团队 + 完整 Harness，维护 100 万+ 行代码、周均 1,500 个 PR，效率约 10 倍。

**Vibe Coding 的三个致命问题**（不建 Harness 的代价）：

1. **架构失守**——AI 只见局部，全局一致性崩坏；
2. **上下文淹没**——代码库超出模型窗口，关键信息被稀释；
3. **可维护性丧失**——人无法审查 AI 产出，知识沉淀断裂。

## 2. 六大支柱与我们的组件映射

文章定义了 Harness 的六大能力支柱。下表是本体系的落地映射（安装域遵循总约定：工具/技能/插件装用户域，规范文档进本仓库）：

| 支柱 | 理念要点 | 本体系组件 | 所在域 |
|---|---|---|---|
| ① 上下文管理 | 渐进披露：AGENTS.md ≈100 行索引，知识按需加载（Skills），变更隔离（spec deltas） | 双层 AGENTS.md（用户域九原则 + 工作区索引模板）；ZCode Skills 按需加载；`docs/changes/` 变更隔离 | 用户域 / 项目 |
| ② 工具系统 | MCP 连接外部世界，Skills 封装专业知识，知识库注入业务上下文 | MCP：hindsight（记忆）、basic-memory（团队记忆）；Skills：mattpocock 规划纪律 + 自建 harness-audit；知识库：Obsidian vault | 用户域 |
| ③ 执行编排与多 Agent | "3+1 Phase"：Plan → Code → Deliver → Archive；四类角色（Planner/Generator/Evaluator/Archiver） | 六角色流水线：planner/developer/code-reviewer/qa-tester（AITrader 移植）+ archiver 沉淀官（补齐 Archive 位）+ red-teamer 对抗审查官（合并前最后门禁，2026-09-03 定案，见 02 §5b/10 文档） | 用户域（角色）+ 项目（约定） |
| ④ 状态与记忆 | 短期=会话、中期=Memories、长期=Git 规格文件、变更记忆=Spec Deltas | 四层记忆架构：会话上下文 / ZCode 内建记忆 + hindsight / git 工件 + Obsidian / `docs/changes/`（见 03 文档） | 混合 |
| ⑤ 评估与观测 | 四级门禁 L1 语法 → L2 逻辑 → L3 规范 → L4 架构；度量闭环 | L1–L4 门禁表 + harness-audit 自检 skill + 度量指标（见 04 文档） | 项目 + 用户域 |
| ⑥ 约束与恢复 | 三级约束（硬红线 Rules / 软约束 Skills / 安全策略）；git 与 spec deltas 兜底 | 红线清单 + guard hooks（PreToolUse 物理阻断）+ 恢复预案（见 05 文档） | 用户域（hooks）+ 项目 |

## 3. 总体架构（五层视图）

```
┌─────────────────────────────────────────────────────────────────┐
│ 输入层：用户需求（自然语言） / Obsidian 知识库（人的知识源）        │
├─────────────────────────────────────────────────────────────────┤
│ 工作台层（ZCode 客户端）                                          │
│   配置中心：AGENTS.md(双层) · Rules(红线) · Skills · Commands      │
│             Subagents(六角色+3 rerun 变体) · MCP 配置 · Hooks(7 事件)          │
│   模式引擎：Plan 模式(先思后写) / Agent 模式(半自动编排)           │
│   Agent 核心：GLM 主模型 + Agent 工具（派发/回收子代理）           │
├─────────────────────────────────────────────────────────────────┤
│ 记忆与知识层                                                      │
│   短期：会话上下文(compaction)                                     │
│   中期：ZCode 内建项目记忆 + hindsight 语义记忆(跨会话/跨工具)      │
│   长期：git 工件(docs/specs|tickets|reviews) + Obsidian 知识库     │
│   团队：basic-memory(结构化决策，随 git 走)                        │
├─────────────────────────────────────────────────────────────────┤
│ MCP 层：hindsight(recall/retain/reflect) · basic-memory · 按需扩展 │
├─────────────────────────────────────────────────────────────────┤
│ 输出与度量层：worktree 分支产出 · L1–L4 门禁 · hook 日志           │
│   hindsight Prometheus/Control Plane · docs/metrics.md 度量       │
└─────────────────────────────────────────────────────────────────┘
        ↑ 反馈闭环：度量 → 规范修订(本仓库) → 分发 → 再度量
```

## 4. 规范三层与事实来源

| 层 | 内容 | 文件位置 | 谁能改 |
|---|---|---|---|
| User Rules | 九项工程原则（宪法） | `~/.zcode/AGENTS.md` | 人 |
| Team Rules | 本仓库全部规范 + 模板 | `<REPO>\`（harness 规范仓库 clone 根，标准落位 `~/.agents/Harness-Engineering`） | 人（经本仓库） |
| Project Rules | 工作区流水线约定 | 目标项目 `AGENTS.md`（模板生成） | 人（guard 阻断 Agent 改写） |

文章的 team-harness 仓库模式：规范唯一来源 + 同步分发。本仓库即扮演该角色——**任何规范修改先改这里，再按迁移手册分发**，禁止直接在业务项目里改规范再回传。

## 5. 工作流："3+1 Phase" 与六角色的对齐

文章的执行编排是 Plan → Code → Deliver → Archive（+ 归档沉淀），角色分工 Planner/Generator/Evaluator/Archiver。本体系以前四棒对齐已实测的 AITrader 四角色，新增第五角色 archiver（沉淀官）补齐 Archive 位、第六角色 red-teamer（对抗审查官）作合并前最后门禁：

| Phase（文章） | 本体系对应 | 质量门禁 |
|---|---|---|
| Plan | planner：spec + tickets（`docs/specs/`、`docs/tickets/`） | 需求追问完成、验收标准可判定 |
| Code | developer：worktree 隔离实现 + TDD + 自测 | 自测绿 + spec 对照表 |
| Deliver | code-reviewer（门禁1）→ qa-tester（门禁2）→ reviewer 增量快审 → red-teamer 对抗审查（第六角色，full/fast/skip 定级） | pass/request changes 双门禁 + 5a 定级对抗 + 人做合并决策 |
| Archive | archiver（沉淀官，第五角色）：合并结论入记忆、归档提交、知识草稿写 Obsidian 工作区（70-工作区/10-ZCODE）、metrics 代录、worktree 清理 | 归档七步 SOP 全部有证据（角色文件交付物清单） |

## 6. 反模式清单（红线级警惕）

| # | 反模式 | 本体系对策 |
|---|---|---|
| 1 | 万能巨型 Prompt | AGENTS.md ≤100 行索引 + Skills 按需加载 |
| 2 | 跳过规划直接写码 | 先 Spec 后 Code 是红线；planner 派发前置 |
| 3 | Rules 一次写下永不维护 | 季度 harness-audit + 规范随度量迭代 |
| 4 | MCP 疯狂接入 | 只接三件套（hindsight/basic-memory/项目必需），每个 MCP 必须回答"解决什么问题" |
| 5 | Skill 大而全 | Skill 原子化：一个 Skill 一个场景 |
| 6 | AI 输出直接上线不 review | L4 门禁：人 + reviewer 双审，合并决策永远是人 |
| 7 | 聊天记录当文档 | 工件落 git（specs/tickets/reviews），经验落记忆与知识库 |
| 8 | 一次 PR 改所有 | 一 ticket 一 worktree 一分支（feat/slug），串行依赖链 |

## 7. 与宪法层（九项原则）的对齐

用户域 `~/.zcode/AGENTS.md` 的九项原则是本体系的前置约束，关键映射：

- 思先于码（原则1）→ Plan Phase 强制、需求模糊必追问；
- 简单优先（原则2）→ 反模式 4/5、MCP/Skill 克制接入；
- 外科手术式修改（原则3）→ worktree 隔离 + diff 快照审阅；
- 目标驱动（原则4）→ 每 Phase 有可验证完成标准（验证清单制度）；
- 冲突不平均（原则5）→ 规范以本仓库为唯一来源，旧约定显式废弃；
- 测试验证意图（原则6）→ developer/QA 的"假红检查"、增量快审；
- 检查点（原则7）→ Archive Phase + checkpoint 纪律；
- 大声失败（原则8）→ 验证清单不勾不宣称完成；P0 未验证项显式标注；
- 独立评审（原则9）→ code-reviewer 无作者视角 + 对抗性审查制度（AITrader 四轮审查模式的延续）。
