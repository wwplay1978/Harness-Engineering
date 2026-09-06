# Harness Engineering

[English](README.md) | 中文

**Agent = Model + Harness（智能体 = 模型 + 驾驭）。** 模型每季度都在换，你的工程标准不该跟着换。Harness Engineering 把"好代码"从模型的属性变成**系统的属性**——围绕任意 AI coding 智能体，构建一套可版本化、可度量、自我改进的 Harness（驾驭）。

> **核心哲学：人类掌舵，智能体执行。**

本仓库是一套**经真实项目验证的、宿主无关的 Harness Engineering 规范 + 安装器工具包**：六角色智能体流水线（planner → developer → code-reviewer → qa-tester → red-teamer → archiver）、物理级写入隔离防线、三层记忆（basic-memory / hindsight / Obsidian）、可执行的审计规范，以及三段式安装器（检测 → 安装 → 适配）——全程可由 AI 智能体代跑，人只处理提权、GUI 安装、凭据与决策四类事项。

> 试点实证：6 张工单端到端闭环、QA 实现缺陷 0、红队对抗命中与 review+QA 零重叠、独立 harness-audit 审计基线 93/100（A）。

---

## 为什么 AI Coding 要做 Harness Engineering？

AI coding 对个人很好用——一旦到团队（或第二台机器、或下一个季度）就崩：

- 每人自维护一套提示词与项目规则，不可继承、不可审计；人一走，"AI 经验"跟着走。
- 质量是模型当天的心情。模型升级会悄悄改变行为，没有任何一道门说"这算完成"。
- 同样的坑反复踩：聊天记录当文档、"看着对"当评审、嗓门大的提示词说了算。

Harness Engineering 的应对（呼应 OpenAI 的智能体优先实地报告，见[参考文献](#参考文献)）：把 AI 当成**可被规则约束、可被度量反馈的工程单元**，用你拥有的 Harness（驾驭）控制它——

- 模型不可控，Harness 可控；
- 规则、技能与工具访问活在**版本化仓库**里，不在谁的聊天窗口里；
- 每个变更走 Spec → Code → Review → QA → 对抗审查 → **人合并** → 归档，证据全部落盘。

## 什么是 Harness Engineering？

Harness（驾驭）是 LLM 与"可治理的高效编码"之间的工程层，六大支柱：

| 支柱 | 本项目的落地 |
|---|---|
| 上下文 | 索引式宪法（AGENTS.md ≤100 行）、spec 先行的文档树（`specs/tickets/reviews/changes`） |
| 工具 | Rules → Skills → MCP 三层能力栈；按角色工具白名单（reviewer 只读、planner 禁写） |
| 编排 | 六角色流水线 + 修复轮的模型路由与 rerun 变体 |
| 记忆 | 团队记忆（basic-memory，随 git）· 个体记忆（hindsight）· 人主导知识库（Obsidian） |
| 评估 | L1–L4 质量门禁、度量台账、`harness-audit` 七维可执行审计规范 |
| 约束 | 物理写入隔离 hooks、main 直提白名单、宪法只能人改 |

工作流过 **Plan → Code → Deliver → Archive（+ 知识沉淀）**——"+1" 的归档阶段把过程资产变成可检索的团队知识。

## 如何做 Harness Engineering？

流水线全貌（详见 [`docs/02`](docs/02-team-core.md)）：

```
planner ─▶ developer ─▶ code-reviewer ─▶ qa-tester ─▶ reviewer（增量快审）
   │           ▲             │ pass             │
   │           └─ 修复轮 ────┘                  ▼
   │                                          red-teamer（full/fast/skip 定级）
   │                                           │
   └── spec 升版环 ◀── changes/ ◀── 【人：合并决策】
                                               │
                                          archiver（七步 SOP：记忆、ticket 状态、
                                          Obsidian 草稿+reconcile、度量含±行数、
                                          worktree 清理）
```

核心纪律：

1. **先 Spec 后代码**。无票不开工。spec 缺口走 `changes/` 三段链，由 planner 回灌升版（r1→rN）。
2. **物理隔离**。一票一 worktree；PreToolUse hook 阻断对主检出白名单外路径的写入（`exit 2`）。宪法（AGENTS.md）设计上只能人改。
3. **对抗门禁**。合并前 red-teamer 专攻 review+QA 双漏的问题（边界/并发/数据/失败级联/隐含假设/安全/性能），按票定级 full/fast/skip。
4. **修复路由**。attempt ≥2 起改派钉强模型的 rerun 变体；累计 >4 轮升级人工。
5. **归档也是核心要素不容妥协**。每票收尾必做：合并结论入记忆、Obsidian 知识草稿、度量（含 ±行数）、分支清理——喂给下一票的知识飞轮。

### 快速开始

推荐路径：让 AI 智能体代跑整个安装（一切可执行项由它做，人只处理提权/GUI/凭据/决策）——kickoff 提示词与人工准备清单在 [`docs/17`](docs/17-agent-assisted-install.md)。手动路径：环境探测 → 参数化安装 → 适配，见 [`docs/16`](docs/16-host-agnostic-installer.md) 与 [`docs/07`](docs/07-migration-playbook.md)。

```bash
git clone https://github.com/wwplay1978/Harness-Engineering.git
node templates/installer/check-env.mjs          # 只读探测：profile + 适配清单
templates/installer/install-hindsight-service.cmd --rehearse   # 正式安装前先预演
```

## 架构规划与优势设计

```
Harness-Engineering/
├── docs/        可复用规范层（理念、六角色、记忆、评估、约束、迁移手册、
│                工具链可移植性、宿主无关安装器、agent 辅助安装）——
│                docs/06/08–14 为内部工程档案，刻意不随发布
├── templates/
│   ├── agents/            六个角色文件（+3 个由工具物化的 rerun 变体）
│   ├── hooks/             guard / inject-memory / report-worktrees（payload 双读）
│   ├── installer/         check-env 探测 · 参数化 NSSM 服务安装器（v5，
│   │                      --rehearse）· pg0 junction 修复（v3）
│   ├── tools/             sync-harness 分发器 · 角色变体生成器
│   ├── skills/            harness-audit 可执行审计规范
│   ├── AGENTS-template.md 宪法骨架（含 commit 白名单）
│   ├── models.config.json 分级模型路由表
│   └── *.json             用户级 hooks 模板 · 项目 MCP 模板
```

值得抄走的设计决策：

- **契约级宿主无关**。治理内核是"约定 + 工件"（宪法、角色纪律、文档树、git 流程）——任何具备派发/子代理/可阻断 hooks/MCP/技能五项机制的宿主都能承载。ZCode 是首个完整实证的适配；主流宿主——Claude Code、Kimi Code、Codex、OpenCode、Pi Agent——按文档化的四步适配纪律接入（[`docs/16 §2`](docs/16-host-agnostic-installer.md)）；五宿主的适配包已就绪，见 [`templates/adapters/`](templates/adapters/)（[`docs/18`](docs/18-host-adapters.md)），装机实测为首装步骤。
- **单一事实来源 + 一条命令分发**。`templates/` 为权威源；`sync-harness.mjs --apply` 分发到用户域并体检漂移（它**刻意不写** hooks 执行位——AI 不能换掉正在运行的 guard）。
- **优雅降级**。每个组件都可选，缺失即按文档化矩阵降级：full / core-plus / minimal 三档 profile；探测脚本自动分级并产出 `adaptation-plan.md`。
- **安全护栏内建**。API key 永不落盘、不进智能体会话；提权脚本必须先 `--rehearse` 干跑；hooks 注册与宪法永久人手；安装器产物自动重定向出 git 工作树。
- **Windows 运维淬炼**。批处理 ASCII-only（ANSI 代码页怪癖）、`chcp 65001` 兜非 ASCII 用户名、服务环境 UTF-8（GBK 崩溃教训）、进程名白名单杀进程、模型目录 `config.json` 哨兵。

## 度量与持续优化

- **逐票度量台账**（`docs/04`）：attempts、审查轮次、QA 轮次、QA 缺陷、一次通过率、测试数、±行数——archiver 代录、滚动复盘。
- **`harness-audit`**：七维百分制可执行审计（宪法质量/规则与强制/技能分层/工具/SDD 流程/工程门禁/记忆与归档），S/A/B/C/D 评级 + P0–P3 整改——季度跑 + 重大规范变更后加跑。试点基线：93/A。
- **有牙齿的门禁**：早期工单一次通过 ≠100% 是**健康信号**——说明 reviewer/QA 在真实拦截；严重度应随票次衰减（试点：P1 → P2/P3）。
- **反馈环**：spec-gap `changes/` 链（当日升版）、审计发现回灌规范、对抗审查重叠率追踪（试点：红队命中与 review+QA 零重叠）。
- **知识飞轮**：工单 → 工作区草稿（vault→bank reconcile 后即时可检索）→ 人工整理入定稿区 → 下一票 recall 注入。三层闭环。

## 参考文献

- [Harness Engineering: Leveraging Codex in an Agent-First World](https://openai.com/index/harness-engineering/)（OpenAI）——智能体优先的实地报告：为期五个月的实验，人做 harness engineer（驾驭工程师）、智能体写代码
- [hindsight (vectorize.io)](https://github.com/vectorize-io/hindsight) · [basic-memory](https://github.com/basicmachines-co/basic-memory) · [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner)——关键开源组件

## 许可证

[MIT](LICENSE)
