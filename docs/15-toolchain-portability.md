# 15 · 工具链清单与可移植性分析（六角色 harness 迁移必读）

> 2026-09-06 整理。回答四个问题：迁移到新项目要额外装什么？各有什么功能与影响？装不上时治理降级到什么程度？能否迁到 Kimi Code 上的 AITrader / 其他 Windows 电脑？
> 原则先行：**本 harness 的治理主干是"约定+工件"（宪法/角色纪律/docs 结构/git 流程），物理防线与记忆层是增强**——工具缺失只会逐层降级，不会让治理归零。

## 1. 工具清单（按层）

| 层 | 工具 | 安装形态 | 功能 | 缺失时的影响 |
|---|---|---|---|---|
| 宿主 | **ZCode 桌面版** | 每机安装+登录 | 体系宿主：Agent 派发/子代理/七事件 hooks/MCP/技能 | **致命**——无宿主无体系 |
| 运行时 | **Node.js ≥20**（现 v25） | 每机安装 | 三正式 hooks（guard/inject/report）运行时；sync-harness/变体生成器 | **重伤**——物理防线全灭：写入隔离退化为纪律+人抽查，记忆注入与分支双态提醒失效；管线本体（角色/spec/审查/QA）仍可跑 |
| 运行时 | **Python 3.13** | 每机安装 | hindsight 四 hook 脚本运行时 | hindsight 层死（见下） |
| 编排 | **git + git-worktree-runner（gtr）** | git 每机；gtr 用户域二进制+全局 alias | worktree 纪律操作面（一票一 worktree） | 中轻——可退化为手敲 `git worktree add/list/remove`，可用但繁琐易错；guard 阻断主检出写入的前提（worktree 内合法写）不变 |
| 团队记忆 | **uv + basic-memory**（v0.22.1 已钉） | `uv tool install`；项目 MCP `uvx basic-memory mcp --project X` | 六角色结构化流转记忆（decisions/qa/合并结论）；memory/ 随 git 入库 | 中度——planner 失去团队记忆召回；证据链仍在 git docs（可审计），管线照跑 |
| 个体记忆 | **hindsight 全家**：hindsight-api 服务 + pg0 内嵌 PG + NSSM + bge-m3/bge-reranker 本地模型 + z.ai key（glm-5.3-flash）+ hindsight-zcode | 用户域服务化（安装脚本 v4）+ 模型下载（GB 级）+ API key | 跨会话个体经验 retain/recall；知识 bank 检索；N7 同步层的目标库 | 中度——个体记忆与语义检索缺失；团队侧（basic-memory+docs+Obsidian 直读）不受影响 |
| 知识飞轮 | **Obsidian + vault**；**hindsight-obsidian-sync**（npm 官方包 0.2.1） | Obsidian 每机；CLI `npm i -g` | 人主导的知识定稿区/工作区；vault→bank 增量同步（2026-09-06 起每单归档触发） | 轻度——planner 走 Obsidian 直读（已两轮实证）或仅靠 git 工件；飞轮少一环 |
| 技能 | **mattpocock/skills**（~/.agents/skills） | git 克隆用户域 | 角色 Anchors 方法论（grill-with-docs/to-spec/to-tickets/tdd/code-review/diagnosing-bugs） | 中度——角色方法论降级为角色文件内 SOP（仍在），规划/审查质量预期下降 |
| 分发 | **sync-harness.mjs**（本仓库） | 随仓库，node 运行 | 角色/hooks 源/审计技能/路由表 → 用户域一键分发 + 漂移体检 | 轻度——退化为手工 cp（07 手册有手动替代）；漂移风险回归（N11 立项动机） |

**降级总结**：致命仅"ZCode+git"两件；Node 决定治理是"物理强制"还是"纪律约束"；记忆三层（basic-memory/hindsight/Obsidian）逐层可缺；**最小治理集 = ZCode + git + Node + uv/basic-memory + gtr + sync**（宪法/角色/docs 结构纯文件零依赖）。

## 2. 迁移 AITrader（Kimi Code）适配性

结论：**治理核心适合迁移，ZCode 增强层建议缓行**。分机制对照：

| 机制 | Kimi Code 侧现状 | 迁移动作 |
|---|---|---|
| 六角色子代理 | AITrader 已有四角色基座（v1.2 实战验证，本仓库的移植源头） | 补 **red-teamer + archiver** 两个新角色（按 02 §3 frontmatter 映射改写：whenToUse/tools 语义、无 model 字段）+ 宪法 5a/4b 条款 |
| 三正式 hooks | 源码当初就为双工具写的（`path ?? file_path` 双读，guard 注释明示 Kimi 用 path） | 按 Kimi 原生 hooks 注册机制重挂；**C1/C2/C3 是 ZCode 实测结论，Kimi 侧行为（快照时机/优先级/事件集——Kimi 有 SubagentStop）需重验** |
| basic-memory | MCP 标准，双工具可用 | 项目 config 换 Kimi 的 MCP 注册形态 |
| hindsight-zcode | ZCode 专用插件，Kimi 侧无对应（hindsight 是否有 kimi 集成未证实，勿臆断） | **缓行**——AITrader 上个体记忆层暂缺，治理主干不受损 |
| OPT-2 rerun 变体 | ZCode model 字段机制 | 按 Kimi 子代理模型指定约定重做，或先不启用（修复轮用原角色） |
| N7 同步层 | 依赖 hindsight bank | 随 hindsight 缓行；vault 直读可用 |
| gtr/docs 结构/宪法/spec 三段链 | 工具无关 | 原样迁移 |

通道遵循 00-index 既定原则：规范以本仓库为准、AITrader 人工同步跟进、互不自动覆盖。迁移成本估计：角色改写+hooks 重挂+重验约半天；收益：AITrader 获得 red-teamer 门禁与 archiver 沉淀闭环两大新增能力。

## 3. 其他 Windows 电脑安装评估

**可平移（有标准安装器/纯文件）**：git、Node、Python、uv、Obsidian、npm 包（hindsight-obsidian-sync）、uv 工具（basic-memory/hindsight-zcode）；项目侧全套（AGENTS/config/docs）纯文件；sync-harness 用 homedir() 探测，跨机通用。

**每机必须重做的本地化**：
1. ZCode 安装+登录（角色/hooks/config 依赖其目录结构）；
2. gtr 安装与全局 alias（**来源已考证 2026-09-06：github.com/coderabbitai/git-worktree-runner**，获取命令见 16 §3 阶段二清单）；
3. **hindsight 全套**：旧版 v4 曾硬编码用户路径（公开发布的 v5 已参数化：参数文件 + USERPROFILE 推导）；模型重新下载（ModelScope，GB 级）；pg0 的 Known-Folders junction 修复每台重做一次；服务环境必配 `PYTHONUTF8=1`（中文 Windows GBK 坑每台必现）；
4. z.ai API key（付费 plan，自备）；
5. Obsidian vault 内容自行同步（个人数据，不在本体系内）。

**不随机器迁移、但可再生的数据**：`~/.pg0`（hindsight bank 数据——bank 是缓存，可由 vault + git 工件经 reconcile/retain 重建，这正是单向同步设计的优点）；项目 memory/（已随 git 走，clone 即得）。

**时长估算**：最小治理集约 30–45 分钟；全套含 hindsight 服务+模型下载 1–3 小时（视网速）。

**已知 Windows 坑（脚本与 08 文档已带自检）**：findstr 含空格必须 /c:、taskkill 进程名白名单、提权脚本先只读预演、Git Bash 反斜杠坍缩（payload 一律文件中转）、PowerShell 用 `| Out-Null` 非 `>nul`、NSSM 崩溃测试杀子进程非包装器。ARM64 实证可跑（本机即 ARM64）；x64 无额外风险。

## 4. 一句话结论

治理主干轻装（ZCode+git+Node+uv+gtr，半小时级）；物理防线取决于 Node；记忆与飞轮三层皆可降级运行；AITrader 可迁六角色治理核心（半天级改写+重验），hindsight 系增强建议缓行；他机安装的主要工程量集中在 hindsight 服务参数化与模型下载，其余是标准安装器流程。
