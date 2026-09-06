# 07 · 项目迁移手册：新项目启用本 Harness 体系

> **⚠️ 架构修订（2026-09-02，P0-3 实测结论 C2）**：hooks 一律部署在**用户级** `~/.zcode/cli/config.json`（同一事件用户级/项目级并存时项目级被覆盖丢弃——实测结论，见 08 文档 C2）。guard 防跨项目泄漏靠脚本白名单设计（非团队项目静默放行）。因此：**第 0 步含用户级 hooks 一次性部署；项目级 `.zcode/config.json` 只承载 MCP**。逐项目重复的只剩：目录结构、AGENTS.md、marker、basic-memory 登记。

> 作用域设计（沿用 AITrader 验证过的模式）：**软件与全局机制一次安装（用户域），项目机制按项目复制**。
> 以下命令在 ZCode 终端（Git Bash）执行；每个代码块自带变量声明、可独立执行；块内只有 `NEW=` 一行需要改（占位用「改成新项目目录名」中文写法——**不用尖括号**，`<` 在 bash 是重定向符）。

## 第 -1 步：环境检测（新电脑 / 新宿主必跑；已就绪机器可跳过）

```bash
# 首次：把本仓库 clone 到本机（下文所有 HARNESS= 均指向它；已 clone 过可跳过）
git clone https://github.com/wwplay1978/Harness-Engineering.git /c/Forex/Project/Harness-Engineering

cd /c/Forex/Project/Harness-Engineering
cmd //c templates\\installer\\check-env.cmd    # 可选参数：--project <目标项目根> --vault <vault路径>
# 或（node 已在 PATH 时直接）：node templates/installer/check-env.mjs --vault <vault路径> --project <项目根>
```

零依赖引导（缺 node 会停在第一步并给安装指引）→ 深探运行时/宿主/hindsight/记忆组件/vault/项目结构 → 产出 `env-config.json`（profile 分级 full/core-plus/minimal + 按 docs/16 §4 适配矩阵生成的适配建议）与 `hindsight-params.cmd`（安装参数，不含 key）。**hindsight 安装一律用参数化脚本 v5，先 `--rehearse` 只读预演**：

```bash
cmd //c "...\templates\installer\install-hindsight-service.cmd" --rehearse hindsight-params.cmd   # 预演（无需提权）
# 确认后在管理员终端去掉 --rehearse 正式安装
```

宿主无关化设计与完整适配矩阵见 docs/16（ZCode 只是首个已适配宿主；Claude Code / Kimi Code / PI agent 按 16 §2 四步适配）。**推荐路径**：把 docs/17 §3 的 kickoff 提示词复制给目标机的 AI agent，由它按人机分工协议代跑本手册全流程（agent 执行一切可执行项，人工仅处理提权/GUI/登录/key 四类）。

## 第 0 步：用户域一次性安装（全局，只做一次）

| 组件 | 动作 | 状态（2026-09-02 盘点） |
|---|---|---|
| git + git-worktree-runner | `git config --global alias.gtr '!/c/Users/<you>/git-worktree-runner/bin/git-gtr'` | ✅ 已在位（AITrader 实施） |
| uv + basic-memory | `uv tool install basic-memory`（当前 v0.22.1；项目 config 模板已钉 `basic-memory@0.22.1` 防跨机漂移） | ✅ 已在位 |
| mattpocock/skills | `~/.agents/skills/`（ZCode 与 Kimi 共扫） | ✅ 已在位 |
| 六角色子代理（四角色移植 + archiver + red-teamer；3 个 *-rerun 变体由生成器物化） | `node templates/tools/sync-harness.mjs --apply` 一键分发（手动替代：cp `templates/agents/*.md` → `~/.zcode/agents/`） | ✅ 已部署，sync 体检全绿（2026-09-05 起 sync 自动化，N11） |
| **三正式 hooks 部署用户级**（guard/inject/report → `~/.zcode/cli/config.json`，与 hindsight 四 hook 并列；config 模板见 `templates/user-config-hooks-template.json`） | 写入隔离 + 团队记忆注入 + 分支双态提醒（全项目通用，白名单防泄漏） | ✅ 2026-09-02 已部署（随新会话武装） |
| hindsight 服务 | 按 06 文档 P0-1 结论部署（用户域全局服务） | ✅ OPT-1 收官（NSSM 服务化：崩溃自启/10MB 日志轮转/开机自启全实证） |
| hindsight-zcode 集成 | `uv tool install hindsight-zcode` + `hindsight-zcode install`（安装器在 Git Bash 下有 MSYS 反斜杠 bug，config 写入需手工兜底——见 08 §P0-2） | ✅ 三 hooks（session_start/recall/retain）已注册用户级 config（安装器崩溃后手工注册，08 实证） |
| harness-audit skill | 源=`templates/skills/harness-audit/SKILL.md`（sync 分发到 `~/.agents/skills/`） | ✅ 已装并首跑基线 93/A（2026-09-05，web2api） |
| Obsidian 同步 CLI（hindsight-obsidian-sync） | 官方 npm 包 `@vectorize-io/hindsight-obsidian`（v0.2.1）；命令要点：`--include` **可重复单值**（逗号形态无效）、reconcile 后事实抽取由服务后台异步完成（详见 03 §4.2 首跑注记） | ✅ 2026-09-06 已装并首跑（+50 文档入 knowledge bank） |

## 第 1 步：复制团队机制目录到新项目

```bash
HARNESS=/c/Forex/Project/Harness-Engineering   # 本仓库 clone 位（下同；克隆到别处则全部同步替换）
NEW=/c/Forex/project/改成新项目目录名   # ← 本块唯一需要改的行（改完再整段粘贴）
if [ ! -d "$NEW" ]; then echo "⚠️ 目录不存在：$NEW（全新项目先：mkdir -p \"$NEW\" && cd \"$NEW\" && git init -b main）"; exit 1; fi
cd "$NEW" && git rev-parse --git-dir >/dev/null 2>&1 || { echo "⚠️ 请先 git init（全新项目：git init -b main）"; exit 1; }
git rev-parse --verify main >/dev/null 2>&1 || { echo "⚠️ 默认分支必须为 main（全部 --from main / --merged main 约定依赖它）"; exit 1; }
mkdir -p .zcode docs/specs docs/tickets docs/reviews docs/changes
cp "$HARNESS/templates/zcode-config-template.json" .zcode/config.json
# 注（2026-09-06 C2 对齐）：hooks 不复制到项目——hooks 一律用户级（第 0 步），项目级同事件被覆盖丢弃；
# 三正式脚本由用户级 config 直接执行 harness 仓库内副本（$HARNESS/.zcode/hooks/，人工自 templates/hooks/ 同步——见第 0 步），项目无需任何 hook 文件
ls .zcode/ docs/ && echo OK
```

## 第 2 步：生成工作区 AGENTS.md（索引式，≤100 行）

```bash
HARNESS=/c/Forex/Project/Harness-Engineering   # 与第 1 步保持一致
NEW=/c/Forex/project/改成新项目目录名   # ← 与第 1 步保持一致
cp "$HARNESS/templates/AGENTS-template.md" "$NEW/AGENTS.md"
# 然后人工编辑：填项目名、技术栈、构建/测试命令、目录约定（10 分钟）
grep -c "团队流水线" "$NEW/AGENTS.md"   # 预期输出 1
grep -c "committed on user authorization" "$NEW/AGENTS.md"   # 预期输出 1（r4 人授权直提留痕条款随模板落地，2026-09-06 起）
```

注意：**AGENTS.md 之后只能人改**（guard 阻断 Agent 改写，流水线宪法）。

## 第 3 步：配置 .zcode/config.json（仅 MCP；hooks 已上收用户级）

> C2 结论：项目级 config **不再放 hooks**（会被用户级同事件覆盖，且 hooks 本就该全局一次）。项目 config 只承载本项目专属 MCP。

模板 `templates/zcode-config-template.json` 即纯 MCP 版：basic-memory（需把 `--project` 参数改成新项目名）；hindsight knowledge bank MCP（`http://localhost:8888/mcp/knowledge/`）Phase 2 起按 03 文档 2.4 节追加。**另需创建 marker 文件**（inject-memory 依赖，第 4 步一并完成）。

```bash
NEW=/c/Forex/project/改成新项目目录名   # ← 与前面步骤保持一致
PROJ=$(basename "$NEW" | tr 'A-Z' 'a-z')
sed -i "s/PROJECTNAME/$PROJ/g" "$NEW/.zcode/config.json"
grep "$PROJ" "$NEW/.zcode/config.json"   # ⚠️ 必须看到含新项目名的输出——sed 未匹配也返回 0，只能 grep 验证
```

## 第 4 步：登记记忆库（basic-memory，六角色团队记忆）

```bash
NEW=/c/Forex/project/改成新项目目录名   # ← 与前面步骤保持一致
PROJ=$(basename "$NEW" | tr 'A-Z' 'a-z')
cd "$NEW" && mkdir -p memory && basic-memory project add "$PROJ" "$(cygpath -m "$NEW/memory")" && basic-memory project list | tail -3
echo "$PROJ" > "$NEW/.zcode/memory-project"   # inject-memory hook 的项目名标记（缺失则注入 hook 静默失效）
# 预期 'added successfully'；军规：所有记忆调用显式 --project PROJ（null 空库兜底已在位）
```

hindsight 侧（Phase 2 起）：确认 `HINDSIGHT_DYNAMIC_BANK_ID=true` 生效即可——bank 按项目自动派生，无需逐项目登记。

## 第 5 步：git 入库

```bash
NEW=/c/Forex/project/改成新项目目录名   # ← 与前面步骤保持一致
cd "$NEW" && git add .zcode docs AGENTS.md memory && \
git commit -m "feat: harness engineering mechanism (from Harness-Engineering templates)" && git status --short
# 预期：提交成功，status 无输出
```

## 第 6 步：三项快速验证

```bash
NEW=/c/Forex/project/改成新项目目录名   # ← 与前面步骤保持一致
PROJ=$(basename "$NEW" | tr 'A-Z' 'a-z')   # 本块自足声明（每块可独立执行）
# ① gtr 自检（必绿）
cd "$NEW" && git gtr doctor | tail -3
# ② guard 模拟触发（预期：阻断提示 + exit=2；脚本用用户级注册的 harness 仓库执行位副本；
#    cwd 必须用 Windows 形态 cygpath -m）
HARNESS=/c/Forex/Project/Harness-Engineering   # 与第 1 步保持一致
echo "{\"cwd\":\"$(cygpath -m "$NEW")\",\"tool_input\":{\"path\":\"src/x.js\"}}" | node "$HARNESS/.zcode/hooks/guard-worktree.mjs"; echo "exit=$?"
# ③ 记忆注入验证：先造数据再测——空库输出为空无法区分"正常"与"hook 失效"（防假绿）
basic-memory tool write-note --title "verify-01" --folder decisions "迁移验证条目" --project "$PROJ" >/dev/null 2>&1
echo "{\"session_id\":\"verify-01\",\"cwd\":\"$(cygpath -m "$NEW")\"}" | node "$HARNESS/.zcode/hooks/inject-memory.mjs" | grep -q "$PROJ\|verify-01\|团队记忆" && echo "③ 注入 OK" || echo "③ ⚠️ 注入无输出：检查 .zcode/memory-project 与脚本字段（P0-3）"
```

①②③ 必须全绿（②③ 依赖第 0 步用户级 hooks 已部署——2026-09-02 起即在位）。全部就位后，在项目目录**新开会话**即可使用（角色文件、hooks、MCP 均启动时加载；ZCode 子代理定义改动也需新会话生效）。

## 规范修订后的再分发（N11 自动化，2026-09-05 起）

角色/技能/生成器/路由表修订合入本仓库后，一条命令分发到用户域（新项目接入前也建议先跑 `--check` 体检）：

```bash
node /c/Forex/Project/Harness-Engineering/templates/tools/sync-harness.mjs          # 只读体检（有漂移 exit 1）
node /c/Forex/Project/Harness-Engineering/templates/tools/sync-harness.mjs --apply  # 同步自动集到用户域
```

- **自动集**：六角色 base、harness-audit 技能、变体生成器、models.config.json——源=templates/（git 版本化），用户域均为部署副本
- **hooks 执行位（`<repo>/.zcode/hooks/`）只报告、永不代写**：AI 可改 templates 源（guard 白名单内），若脚本自动传播即等于 AI 可换掉运行中的 guard 自毁防线——该路径人工 cp（脚本打印现成命令）
- 用户级 config.json 三正式注册与项目结构（AGENTS/文档目录/模板基线对照）随跑随报，同样只报告
- **新项目接入后**：把项目根路径加入脚本 `PROJECTS` 常量（一行），此后该项目的结构盘点随跑随报
- **--apply 会覆盖部署副本**（无备份）：部署副本手改会被无声覆盖——正确姿势=只改 templates/ 源头；拿不准先跑 `--check` 看 DRIFT 清单
- 角色/路由表变更后按提示重跑 `generate-role-variants.mjs` 重铸 rerun 变体，并**新开会话**生效（C1 快照）

## 作用域速查表

| 事项 | 位置 | 何时做 |
|---|---|---|
| 软件/插件/技能/角色文件 | 用户域（`~/.zcode/`、`~/.agents/`、uv tools、npm -g） | 一次 |
| hindsight 服务 + Obsidian 同步 | 用户域全局服务 | 一次（Phase 2） |
| AGENTS.md / .zcode/config.json / docs/ 结构 / memory/ | 目标项目 | 每项目（本手册六步） |
| 规范修订 | 本仓库（REPO，即 Harness-Engineering clone）→ `sync-harness.mjs --apply` 再分发（hooks 执行位人工，见上节） | 变更时 |

## 最小可用变体

只想要"写入隔离 + 六角色但暂缓自动化 hooks"的项目：执行第 0 步（角色文件 + gtr）+ 第 1/2 步 + 第 3 步的 config 模板裁剪版（只留 MCP 段，hooks 段整段删除）+ 第 5/6 步即可；hooks、记忆与知识库能力随后随时补。

## 已知余项（接受，不阻塞）

- reviewer 输入白名单与 QA 文件边界为软约束（抽查制，两次突破升级为 hook 强制）——继承 AITrader 附 3。
- ZCode 工作区级子代理暂不支持（Beta 仅用户域），角色文件全局共享——若未来支持项目级，迁回项目域并更新本手册。
- hindsight worktree 派生一致性待 P0-2 实测；不一致则退化为静态 bankId 写入项目 config。
