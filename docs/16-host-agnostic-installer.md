# 16 · 宿主无关化与三段式安装器设计（去 ZCode 中心化）

> 2026-09-06 立项。用户方向：harness 不应以 ZCode 为核心——任何具备 **Agent 派发、子代理、hooks（可阻断）、MCP、技能** 五项机制的 AI coding 工具（ZCode / Claude Code / Kimi Code / PI agent / …）皆可承载；安装改为三段式：**检测环境并生成参数 → 参数驱动安装 → 按已装组件适配六角色工作流**。

## 1. 去 ZCode 中心化评估：成立

治理主干的本质是**约定 + 工件**（宪法 AGENTS.md、六角色纪律、docs/{specs,tickets,reviews,changes} 结构、git 分支/worktree 流程、commit 白名单）——全部宿主无关、随 git 走。宿主只提供**机制面**（派发/子代理/hooks/MCP/技能）。因此正确的心智模型是：

- **ZCode = 首个完成实证的宿主适配**（六票全链 + C1/C2/C3 实测），不是体系核心；
- 换宿主 = 换"机制适配层"（角色 frontmatter、hooks 注册形态、MCP 配置格式），宪法与工件层零改动；
- 代价：每新增一种宿主需做一次适配重验（见 §2 矩阵的"待验"列）。

## 2. 宿主能力矩阵（harness 五项机制需求）

按宿主成行（⚠️=文档可见但未实测；未证实=无可靠资料，须先自查；**证据级别与逐宿主细节见 docs/18**）：

| 宿主 | 派发/子代理 | 可阻断 hooks | MCP | 技能 | 适配态 |
|---|---|---|---|---|---|
| **ZCode** | ✅ 六角色实证 | ✅ exit 2 实测；注册优先级 C2 实测 | ✅ | ✅ ~/.agents/skills 共扫 | **已适配**（六票实证） |
| **Claude Code** | ✅ subagents 同族（~/.claude/agents/） | ✅ 同族 schema（settings.json hooks；注册/优先级待装机） | ✅ | ✅ | 适配包已产出（adapters/claude-code，装机四步待 N19） |
| **Kimi Code** | ✅ AITrader v1.2 实证 + 官方文档（~/.kimi-code/agents/ 与 ~/.agents/agents/；model 键不支持） | ✅ guard 机制源头；本机 config.toml [[hooks]] 实证；payload=`path`（guard 已双读） | ✅ | ✅ ~/.agents/skills 共扫（文档实证） | 适配包已产出（adapters/kimi-code，装机四步待 N19） |
| **Codex (OpenAI)** | ✅ 官方 subagents 页终判：~/.codex/agents/*.toml（name/description/developer_instructions + sandbox_mode 角色级沙箱；见 18 §4） | ✅ hooks.json 体系官方实证：PreToolUse 阻断 apply_patch/Edit/Write（官方自注：护栏非完全强制边界） | ✅ config.toml | ✅✅ AGENTS.md + prompts + 官方 skills 层（[[skills.config]] 可挂任意目录） | 适配包已产出（adapters/codex，装机四步待 N19） |
| **OpenCode** | ✅ agents/ 目录 + mode: subagent + @mention 派发（本机 GSD 样本 + 官方文档 + CLI 实测） | ✅ 插件 tool.execute.before throw 即阻断（官方文档；本机插件样本印证加载形态） | ✅ | ✅ AGENTS.md + skills 层实测在位（空载，目录配置待装机） | 适配包已产出（adapters/opencode，装机四步待 N19） |
| **Pi Agent** | ❌ 无原生子代理（官方 README 明示）——单代理角色卡降级 | ✅✅ 扩展 tool_call → {block:true}；input.path 字段名经官方示例 protected-paths.ts 实证 | ❌ 官方明示无内置 MCP——记忆面=开工必检条款 + Obsidian 直读（定论） | ✅ Agent Skills 标准 + ~/.agents/skills 共扫 | 适配包已产出（adapters/pi-agent，降级形态，装机四步待 N19） |
| **DeepSeek Harness** | ✅ 框架宣称"一切皆插件"（plugin.json 可声明 agents） | ⚠️ 声明支持 hooks，阻断语义待实测 | ✅ 可声明 mcpServers | ✅ 可声明 skills/commands | 未适配（框架型宿主：适配=把六角色+guard 打包为其插件） |

新宿主一律先查此矩阵——**标 ⚠️/未证实的项就是四步中②③的验证重点**；矩阵未列的宿主（新兴工具）按同一五机制自查后补行入表。

**适配纪律**：新宿主接入 = ①按 02 §3 改写角色 frontmatter；②按其 hooks 文档重挂三正式脚本（guard 源码已双读 path/file_path）；③跑 07 手册第 6 步三项验证（guard 阻断/记忆注入/gtr doctor）——**项目侧 marker（`.zcode/memory-project`）与 MCP 注册路径在异宿主下的落点是适配器职责，③的注入验证会暴露此类差异**；④C1/C2 类行为重验并在 08 附录补记。**未走完①–④前，该宿主按"未适配"对待。**

## 3. 三段式安装流

```
阶段一 检测                阶段二 安装                    阶段三 适配
check-env.cmd/mjs    →    参数化安装脚本            →    按组件在位情况裁剪工作流配置
（零依赖 .cmd 引导）        install-hindsight-service.cmd     宪法条款开关 / hooks 注册集 /
  ↓ 产出                   （读 hindsight-params.cmd，        MCP 段 / archiver SOP 步骤开关
  env-config.json           key 只运行时读取不落盘）
  hindsight-params.cmd      + 标准安装器：git/Node/Python/
  profile 分级              uv/Obsidian/npm 包
  adaptation 建议
```

- **阶段一**：`templates/installer/check-env.cmd`（零依赖引导：查 node，缺失即停在第一步并给安装指引）→ `check-env.mjs`（深探：运行时版本、宿主配置目录、hindsight 服务健康、basic-memory/gtr/skills/角色/vault/同步 CLI、项目结构）→ 产出 `env-config.json`（全量检测结果 + profile 分级 + 适配建议 + 安装参数）、`hindsight-params.cmd`（SET 语句参数文件，**不含任何 key**）与 `adaptation-plan.md`（阶段三的人可读适配清单）。**CWD 位于任何 git 工作树内时产物自动改写 `%TEMP%\harness-install\`，防卷入仓库提交。**
- **阶段二**：hindsight 服务安装 v5 参数化（六处绝对路径与端点全部参数化；key 三级来源：环境变量（ZAI_API_KEY/ZHIPU_API_KEY）> HKCU 注册表 > 安装时交互输入，永不落盘）；其余组件走标准安装器，缺什么装什么（check-env 的 missing 清单即待装清单）：

  ```powershell
  winget install Git.Git OpenJS.NodeJS.LTS Python.Python.3.13 Obsidian.Obsidian astral-sh.uv
  uv tool install basic-memory hindsight-api hindsight-zcode
  npm install -g @vectorize-io/hindsight-obsidian   # vault→bank 同步 CLI（官方包）
  # gtr（来源考证 2026-09-06：github.com/coderabbitai/git-worktree-runner）
  git clone https://github.com/coderabbitai/git-worktree-runner.git "$env:USERPROFILE\git-worktree-runner"
  git config --global alias.gtr '!~/git-worktree-runner/bin/git-gtr'
  ```
  另三项无包管理器，按下方手工获取：

  | 项 | 获取方式 | 校验/备注 |
  |---|---|---|
  | **NSSM** | nssm.cc 官网下载 `nssm.exe`（按机器架构）→ `%HSDIR%\bin\nssm.exe` | **下载后记录 SHA256 入 08**（供应链溯源）；上游长期停更属已知接受项 |
  | **本地模型** | ModelScope 预下载 `bge-m3`、`bge-reranker-base` 到 `%MODELS_DIR%\`（终态约 3.2GB；HF 直连/镜像均不稳，08 P0-1 结论） | **具体命令待补录**——本机当时手动下载、命令未入档（08 只有结论）；候选形态 `modelscope download --model BAAI/bge-m3 --local_dir <目标>`，首装实测后把验证过的命令补回本表；完整性哨兵=目录内 `config.json`；瘦身参照 08（删 onnx/pytorch_model.bin 保 safetensors） |
  | **pg0 junction** | `templates/installer/fix-pg0-junction.cmd`（v3 参数化） | 先 `--rehearse`；需管理员；背景：pg0 走 Known-Folders 无视 env（15 §R 案例） |

  另：**skills 锚点包**（~/.agents/skills）本机为目录拷贝、无 git remote——**获取来源待核验**，首装前确认上游后补记本表；缺它角色 Anchors 降级但不阻断（16 §4）。
  磁盘预算：模型下载态约 3–5GB；安装前确认空间。
- **阶段三**：按 env-config 的 components 布尔值套用 §4 适配矩阵，生成该机的宪法差异说明与 hooks/MCP 注册集。

三段全程可由目标机 AI agent 代跑：人机分工协议与 kickoff 提示词见 docs/17（agent 执行一切可执行项，人工仅处理提权/GUI/登录/key 四类；安全铁律见 17 §3——hooks 注册人闸对齐 05 §3，key 不落盘对齐本文 §5）。

## 4. 组件×缺失→工作流适配矩阵（阶段三的执行表）

| 缺失组件 | 宪法（AGENTS）改动 | 机制改动 | 角色改动 |
|---|---|---|---|
| Node.js | 写入隔离条款改纪律条款（"主检出不写，抽查两次越权即停线"） | 三 hooks 不注册；合并前白名单对照升级为主防线；sync 脚本不可用→手工 cp | 无 |
| hindsight 全家 | "个体记忆"行删除 | recall/retain/session hooks 不注册；知识检索通道=Obsidian 直读 + basic-memory | planner 检索通道说明同步删 |
| Obsidian/vault | 知识库节降级：git docs 为唯一知识源 | 无 | archiver SOP 第 4 步跳过 Obsidian 草稿（归档报告注明） |
| hindsight-obsidian-sync | 无 | reconcile 不执行 | archiver 第 4 步只写草稿、记"reconcile 未执行" |
| basic-memory | "团队记忆"行删除 | MCP 段裁剪；inject hook 不注册 | 记忆类交付物（合并结论条目）改记 docs/ |
| gtr | worktree 命令改原生 `git worktree add/list/remove` 三件套 | guard 提示文案对应调整 | 无 |
| skills 包 | 无 | 无 | 角色 Anchors 降级为角色文件内 SOP（质量预期下调，建议装） |

**profile 分级**（check-env 自动判定）：`full`（**三正式 hooks 3/3 注册齐** + Node + basic-memory + hindsight + Obsidian + sync CLI 全在位）/ `core-plus`（Node + basic-memory 在；hindsight/Obsidian/hooks 有一缺）/ `minimal`（Node 或 basic-memory 缺——物理防线或团队记忆不成立）。**判级以 hooks 注册态为准，不只看组件在位**——装了组件却未注册 guard 的机器不得报 full。降级语义详见 docs/15 §1。

## 5. 安全与工艺铁律（随脚本携带）

- key 永不落盘：参数文件只写路径类参数；key 运行时四级来源读取；
- 破坏性脚本先只读预演：v5 安装脚本带 `--rehearse` 模式（只解析参数并打印将执行的动作）；
- v2 蓝屏教训固化：findstr 含空格必须 `/c:`、taskkill 必须进程名白名单（脚本注释保留原案）；
- 幂等可重跑；提权检查先行。

## 6. 未竟项与实测边界（诚实声明）

- **v5 安装脚本的真实安装路径未在本机执行**（保护在跑的生产服务）——预演模式与参数装载已实测；真实路径为 v4 已验证代码的参数化改写，首次真实使用必须在目标机按"预演 → 正式"纪律完成；模型完整性以目录内 `config.json` 为哨兵（空目录/半下载会在预演与正式路径双双拦截）。
- 五宿主**适配包已产出**（2026-09-06，`templates/adapters/` + docs/18：claude-code / kimi-code / codex / opencode / pi-agent），但**装机实测未做**——16 §2 四步①–④完整走完前仍按"未适配"对待，首装实测随 N19，结论回灌 docs/18 §8；
- pi 无原生子代理为官方明示的产品设计（非未证实项）——已按单代理角色卡降级适配；其无内置 MCP 亦为官方明示（usage.md），记忆面定论=开工必检条款 + Obsidian 直读；
- hindsight 是否有 Kimi 集成仍未证实（15 §2），AITrader 迁移按"hindsight 缓行"处理。
