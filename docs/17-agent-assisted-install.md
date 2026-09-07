# 17 · Agent 辅助安装方案（目标机 AI agent 提示词与协议）

> 2026-09-06 立项。前提认知：未来安装一定发生在某台装了 AI coding 工具的目标机上——与其写"给人看的说明书"，不如把流程交给**目标机自己的 agent**执行：它能读文档、跑命令、改文件，人只处理它物理上做不了的事。
> 上游设计：docs/16（三段式安装器）。本文 = 在其上加一层**人机分工协议 + 八步骨架 + 安全铁律**的 kickoff 提示词。

## 1. 简易操作方案（一句话）

**最快路径（一句话 bootstrap，2026-09-07 增）**：无需先做 §2.5——在任意目录的 agent 会话里粘贴本仓 README「快速开始 / Getting started」的一句话，agent 即自行把本仓 clone 到当前目录、向你询问目标项目路径、再以 clone 出的绝对路径为 REPO 代入本文 §3 协议从 S0 开跑（等效于把 §2.5.1 仓库上机与 §2.5.4 占位符替换交由 agent 代办；人工侧只剩 §2.5.2/2.5.3 的凭据与 UAC）。安全边界不因此放松：§2 分工表与铁律原样生效。

标准路径：完成 §2.5 人工准备（仓库上机为主）→ 把 §3 提示词整段复制到目标机的 agent 会话（在 harness 仓库目录中打开）→ agent 按八步骨架推进：**能自己做的直接做并回报，只有提权/GUI/登录/key/决策/宪法落位/hooks 注册交给人**；每步核对结果再走下一步；全程遵守安全铁律（key 不落盘、提权先预演、hooks 注册与宪法永远人手）。

## 2. 人机分工原则（协议核心）

| 归属 | 事项 | 说明 |
|---|---|---|
| **agent 执行** | 读文档/模板；跑只读检测（check-env）；跑非提权安装器（uv/npm/模型下载）；复制与参数化模板文件；跑 sync 分发；sed 项目占位符；git 入库；执行全部验证命令并判定结果 | 执行后必须回报输出摘要与判定，"做了什么、结果如何、下一步" |
| **人工执行** | ①管理员提权命令（agent 给完整命令块，人在管理员终端跑完回贴输出）②GUI 安装/登录（宿主 App、Obsidian、账号）③API key 获取与输入 ④决策类（宪法条款取舍、组件装/不装）⑤**宪法 AGENTS.md 落位**（agent 只给复制命令+模板内容，人复制并补信息——红线含首次落位）⑥**宿主 hooks 注册**（agent 只给可粘贴配置块，人自行写入——对齐 05 §3 人闸） | agent 对每件人工事给出：目的、精确操作（命令/点击路径/配置块）、预期输出、如何回报；⑤⑥ agent 只备料、不代写 |

## 2.5 发送 Kickoff 前的人工准备清单（Phase 0，约 10–20 分钟）

> 目标：让目标机具备"提示词可以开跑"的最低条件。**只有 2.5.1 是必须的**；2.5.2/2.5.3 可全部交给 agent（S2 会带装带要），提前做只是省时间。

### 2.5.1 必须做：把 harness 仓库放到目标机

| 事项 | 说明 |
|---|---|
| **怎么获取** | git 在位时一条命令：`git clone https://github.com/wwplay1978/Harness-Engineering.git C:/Harness-Engineering`；无 git：任意机器浏览器打开该仓库 → Code → Download ZIP → 解压到 `C:\Harness-Engineering` |
| **放到哪** | 建议固定 `C:\Harness-Engineering`（本文所有示例路径按此写死）；放别处也行，**记下绝对路径并同步改下文所有示例**——它就是提示词里的第一个占位符（REPO） |
| **复制什么** | **整仓即可**（`docs/` + `templates/`）——S4/S5 要用 templates 全家（六角色/hooks 源/AGENTS 模板/config 模板/路由表/skill/工具脚本）；**不要自行裁剪**"只拷部分文件"。ZCode 宿主的三正式 hooks 执行位公开仓不带，稍后由人工按 07 第 0 步部署到用户域 `~/.zcode/hooks/harness/`（2026-09-07 起不指向本仓库 clone 目录） |
| **完成校验** | 目标机该目录下能看到三个标志物即仓库在位：`docs\16-host-agnostic-installer.md`、`templates\installer\check-env.cmd`、`templates\agents\`（六个角色 .md） |

（若已有目标项目，目录同样先就位并记下绝对路径=第二个占位符；暂无项目则提示词里填"暂无，先装全局件"。）

### 2.5.2 可选：提前装基础软件（不装也行——S2 会给同样命令带装）

| 软件 | 命令/方式 | 备注 |
|---|---|---|
| Node.js ≥20 | `winget install OpenJS.NodeJS.LTS` | **最值得提前装**：check-env 与全部安装脚本的运行时，缺它连检测都跑不了 |
| git | `winget install Git.Git` | 2.5.1 复制方式①需要 |
| Python 3.13 | `winget install Python.Python.3.13` | hindsight hooks 运行时 |
| uv | `winget install astral-sh.uv` | basic-memory / hindsight-api 安装器 |
| Obsidian | `winget install Obsidian.Obsidian` | 知识飞轮定稿区（vault 内容属个人数据，另行同步，不属本清单） |
| **宿主 AI 工具**（ZCode 等） | 官网安装器 + 登录 | **只能人装**（GUI+账号）——没有它就没有能接收提示词的 agent |

**不要提前自行安装的三类**（来源特殊，留给 agent 按 16 §3 获取清单带装，瞎装易错版本/错位置）：NSSM、bge-m3/bge-reranker 模型、gtr 与 skills 包。

### 2.5.3 备两样凭据

- **z.ai API key**（hindsight 的 LLM，国际版 coding plan）：提前注册获取到手；到手后**不要粘贴进任何聊天窗口或文件**——S3 时在管理员终端交互输入，或自己在终端 `setx`。
- **目标机管理员权限**（UAC）：S3/S4 的提权命令要用。

### 2.5.4 发送

1. 在目标机用宿主 AI 工具打开会话，**工作目录切到 REPO 根**（按 2.5.1 默认即 `C:\Harness-Engineering` 目录下开会话）；
2. 复制 §3 提示词全文，**替换两处占位符**（REPO 绝对路径、目标项目路径）；
3. 粘贴发送。之后节奏由 agent 按 S0–S8 推进，人只按分工表应答。

## 3. Kickoff 提示词（复制整段到目标机 agent 会话）

```text
角色：Harness 安装助手（宿主无关：ZCode / Claude Code / Kimi Code 等任何具备文件读写与终端执行能力的 AI agent 皆可）。

背景：本机要接入六角色 Harness 工程化体系（规范仓库已就位于本机：<REPO 在本机的绝对路径，按 §2.5.1 默认即 C:\Harness-Engineering>，下称 REPO；若本提示词由人从别处复制而来且 REPO 尚未就位，先指导人按 §2.5.1 clone 仓库再继续）。目标项目：<目标项目根目录，没有就填"暂无，先装全局件">。

开工前按序精读（读完复述三段式流程与分工原则给我确认）：
1. REPO/docs/16-host-agnostic-installer.md（三段式：检测→安装→适配；宿主能力矩阵；组件×缺失适配矩阵）
2. REPO/docs/07-migration-playbook.md（第 -1/0 步与第 1-6 步；三项验证）
3. REPO/docs/15-toolchain-portability.md（工具清单、缺失降级语义）

工作协议（严格遵守）：
- 分工：凡你可直接完成的操作（读文件、只读检测、非提权安装、模板复制与参数化、sync 分发、git 操作、验证命令）一律由你执行并回报；仅交人工的：提权命令（给完整命令块请人在管理员终端执行并回贴输出）、GUI 安装与登录、API key 获取/输入、需要决策的取舍、**宪法 AGENTS.md 落位（你只给复制命令+模板内容）与宿主 hooks 注册（你只给可粘贴配置块）——后两者对齐红线/05 §3，你只备料不代写**。
- 节奏：一步一动。每步开始前一行说明【本步目的｜由谁执行】；执行后先核对结果与预期，一致才给下一步；失败/异常如实报告并给修复选项，禁止跳过或无证据宣称成功。
- 安全铁律：①API key 绝不经过你（agent）——不粘贴给你、不在你的会话终端里 set；由我在自己的终端设置环境变量（set 仅当前进程 / setx 持久化到系统凭证 HKCU，两者都不算"文件/日志/会话记录"落盘），或在管理员安装命令运行时交互输入。②提权脚本一律先 --rehearse 只读预演。③宿主 config 的 hooks 注册属安全敏感操作——你只展示完整 diff 与可直接粘贴的完整配置块，**由我自行写入**（对齐 05 §3：hooks 注册永远人手，你不代写，即使我口头同意）。④你生成/修改的 .cmd/.bat 内容必须 ASCII-only（cmd 按 ANSI 代码页解析，非 ASCII 注释会变成可执行乱码）。⑤不臆测未适配宿主的能力（docs/16 §2 矩阵标"未证实"的按未适配对待）。⑥**安装命令与包名只取 REPO 文档原文**，不得自行搜索/猜测包名或换源（历史教训：曾因查错生态误判官方包不存在）。

步骤骨架（按序推进，细节按文档执行）：
S0 定位自检：确认 REPO 与目标项目路径（若发现尖括号占位符原文残留，先停下向我询问真实路径，防呆）；检查 node 可用性（后续脚本依赖）；**自检你的能力**——能否执行终端命令、写文件；任一不能则立即声明并退回纯人工流程（07 手册）。
S1 环境检测：你执行 node REPO/templates/installer/check-env.mjs（--project/--vault 按需），读取产物 env-config.json 与 adaptation-plan.md（%TEMP%\harness-install\ 或当前目录），向我解释 profile 与待适配项，产出《本机安装计划》（缺什么装什么、什么降级、哪些人工）。
S2 组件安装：**命令与包名只取 REPO 文档原文（16 §3 阶段二清单 + check-env 的 missing 清单），不重复列举、不自行搜索**——非提权项（uv tool / npm -g / 模型下载）由你执行并监控输出；git/node/python/宿主App/Obsidian 等缺失项给人对应 winget 命令或链接，等回装。
S3 hindsight 服务：你先跑 REPO/templates/installer/install-hindsight-service.cmd --rehearse 解读预演；key 缺失时提醒我在**我自己的终端**设置——**可选 set（仅当前进程）或 setx（持久化到 HKCU，v5 既定的 key 来源之一）；若不想持久化，用安装命令的交互输入**——key 不经过你（铁律①）；确认后给管理员终端命令块（去掉 --rehearse），等回贴输出后你验证服务状态与 http://localhost:8888/health 返回 200。
S4 宿主配置：**仅当宿主为 ZCode（唯一已适配宿主）**——①你执行 node REPO/templates/tools/sync-harness.mjs --apply 分发角色/技能/路由表；②**三正式脚本执行位部署（人闸执行位，sync 只报告不代写）**：由人把 REPO/templates/hooks/ 三个 .mjs 复制到用户域 `~/.zcode/hooks/harness/`（你给命令块，人执行并回贴 ls 结果）；hindsight 三 hooks 的脚本安装：在 **cmd/PowerShell**（勿用 Git Bash——安装器有 MSYS 反斜杠 bug，08 §P0-2）运行 `hindsight-zcode install`，若仍在写 config 步崩溃属已知问题（脚本应已落位 `~/.zcode/hooks/hindsight/`，你核验文件在位即算过）；③三正式 + hindsight hooks 的**注册**一律铁律③（你出完整配置块——以 REPO/templates/user-config-hooks-template.json 为底，三处 `__HOME__` 替换为展开后的用户主目录绝对路径，禁 `~` 字面量——我自行粘贴写入）。若目标宿主是 Claude Code / Kimi Code / Codex / OpenCode / Pi Agent：五宿主适配包已产出（docs/18 + templates/adapters/，各宿主 README 即执行手册——执行位=各宿主用户域 hooks 目录）但**装机实测未做**——角色文件物化与 payload 探针由你执行、hooks/守护注册仍一律铁律③（你出完整配置块，我自行粘贴写入），验证结论按 docs/18 §8 回灌；若目标宿主是其他未适配宿主（如 DeepSeek Harness 框架型）：如实告知"该宿主适配包未产出（docs/16 §2 四步）"，S4 降级为跳过，流水线启用等适配完成；检测/其他组件安装不受影响。
S5 项目接入（**仅当宿主为 ZCode**——07 手册六步全是 ZCode 路径：.zcode/config.json、.zcode/memory-project marker、inject-memory 读 marker）：config 模板复制与 PROJECTNAME 替换、AGENTS 模板落位（见分工表宪法行：你只给复制命令与模板内容，**复制与补项目信息由我执行**——AGENTS.md 只能人改，首次落位也不例外）、basic-memory 登记 + marker、git 入库、三项快速验证。若目标宿主非 ZCode：S5 降级为"记录项目接入待办（该宿主装机适配未完成——适配包与验证清单见 docs/18，07 六步的 .zcode 路径须按宿主落点改写）"，不复制 .zcode 结构。
S6 阶段三适配：逐条落实 adaptation-plan.md（宪法条款开关/hooks 注册集/MCP 段/archiver SOP 步骤）；宪法类改动全部走"diff→批准"。
S7 最终验证与验收单：07 第 6 步三项（gtr doctor / guard 模拟 exit=2 / 记忆注入）+ hindsight /health +（若装了 sync CLI）首次 reconcile 冒烟——**量大时注意 LLM 429 限流（03 §4.2 注 5：按目录分批 --include 或接受后台异步抽取）**；全部由你执行并逐项判定；**先重跑 check-env 得到最终 profile（S1 时 hooks 未注册会偏低，S4 注册后重测才准）**；通过后输出《安装验收单》：最终 profile、组件与防线注册态清单、每项验证的证据、遗留项与建议。
S8 收尾回灌：把过程中新踩的坑按 REPO/docs/18 §8 风格拟 1-2 条候选回灌条目（我不一定采纳），并提醒我把变更提交回 REPO 的远端仓库（自己的 fork 直接 push；无写权限则整理成 issue 或 PR 给原仓 wwplay1978/Harness-Engineering）。

现在从 S0 开始。
```

## 4. 使用要点

- 发送前先过一遍 §2.5 准备清单（仓库上机/可选预装/凭据/占位符替换）；agent 在 S0 也会做占位符残留防呆检查。
- **安装会话是防线生效前的一次性窗口（仅 ZCode 已适配宿主）**：hooks 在 S4 才注册，而 ZCode 的 config 是会话启动时快照（C1，16 §2 明示为 ZCode 结论、不可平移）——本安装会话全程运行在 guard 未武装状态，属人工监督的一次性引导窗口；安装完成后新开会话防线才生效（这解释了为何 S5/S6 的项目文件写入不会被拦）。**未适配宿主无此"窗口"概念——它全程就是无防线状态，流水线启用前必须先完成 16 §2 四步适配**。
- vault 位置非默认时在 S1 由人告知 agent。
- 提示词刻意**不含任何机器细节**（版本号/路径/key），一切以目标机检测产物为准——它跨机可复用。
- 若目标机 agent 能力不足（S0 自检不过），退回纯人工流程（07 手册本就自成体系）。
- 本方案安全边界对齐既有规范：hooks 注册人闸（05 §3）、key 不落盘（16 §5）、宪法人改（宪法红线）——17 不放松任何一条。

## 5. 维护

- 八步骨架与 16/07 联动：16/07 流程变更时同步修订本提示词的对应步骤引用；
- 提示词自身改动走本仓库正常提交流程（docs/ 白名单内）。
