# 07 · 项目迁移手册：新项目启用本 Harness 体系

> **⚠️ 架构修订（2026-09-02，P0-3 实测结论 C2）**：hooks 一律部署在**用户级** `~/.zcode/cli/config.json`（同一事件用户级/项目级并存时项目级被覆盖丢弃——实测结论，见 08 文档 C2）。guard 防跨项目泄漏靠脚本白名单设计（非团队项目静默放行）。因此：**第 0 步含用户级 hooks 一次性部署；项目级 `.zcode/config.json` 只承载 MCP**。逐项目重复的只剩：目录结构、AGENTS.md、marker、basic-memory 登记。
> **⚠️ 执行位修订（2026-09-07，落点修补）**：三正式脚本**执行位同步上收用户域** `~/.zcode/hooks/harness/`（人工自 `templates/hooks/` 复制），不再指向任何仓库目录——仓库锚定执行位会随仓库切分支/改名波及全机（Test05 全新安装暴露，08 有回灌）。guard 另带自防御条款：Agent 写执行位/注册文件无论 cwd 一律阻断（05 §3）。

> 作用域设计（沿用 AITrader 验证过的模式）：**软件与全局机制一次安装（用户域），项目机制按项目复制**。
> 以下命令在 ZCode 终端（Git Bash）执行；每个代码块自带变量声明、可独立执行；块内 **`HARNESS=`（harness 仓库在本机的位置）与 `NEW=`（目标项目目录）两行**按本机实际修改（占位用「改成新项目目录名」中文写法——**不用尖括号**，`<` 在 bash 是重定向符）。

## 第 -1 步：环境检测（新电脑 / 新宿主必跑；已就绪机器可跳过）

```bash
# 在 REPO 根目录执行（HARNESS= 仓库 clone 位；下同）
cmd //c "templates\installer\check-env.cmd" --project <目标项目根>
# 或（node 已在 PATH 时直接）：node templates/installer/check-env.mjs --vault <vault路径> --project <项目根>
```

零依赖引导（缺 node 会停在第一步并给安装指引）→ 深探运行时/宿主/hindsight/记忆组件/vault/项目结构 → 产出 `env-config.json`（profile 分级 full/core-plus/minimal + 按 docs/16 §4 适配矩阵生成的适配建议）与 `hindsight-params.cmd`（安装参数，不含 key）。**hindsight 安装一律用参数化脚本 v5，先 `--rehearse` 只读预演**：

```bash
cmd //c "templates\installer\install-hindsight-service.cmd" --rehearse "%TEMP%\harness-install\hindsight-params.cmd"   # 预演（无需提权；参数文件由 check-env 产出）
# 确认后在管理员终端去掉 --rehearse 正式安装
```

宿主无关化设计与完整适配矩阵见 docs/16（ZCode 只是首个已适配宿主；Claude Code / Kimi Code / PI agent 按 16 §2 四步适配）。**推荐路径**：把 docs/17 §3 的 kickoff 提示词复制给目标机的 AI agent，由它按人机分工协议代跑本手册全流程（agent 执行一切可执行项，人工仅处理提权/GUI/登录/key 四类）。

## 第 0 步：用户域一次性安装（全局，只做一次）

| 组件 | 动作 | 状态（2026-09-02 盘点） |
|---|---|---|
| git + git-worktree-runner | `git config --global alias.gtr '!~/git-worktree-runner/bin/git-gtr'`（gtr 本体按 16 §3 clone 到用户主目录） | ✅ 已在位（AITrader 实施） |
| uv + basic-memory | `uv tool install basic-memory`（当前 v0.22.1；项目 config 模板已钉 `basic-memory@0.22.1` 防跨机漂移） | ✅ 已在位 |
| mattpocock/skills | `~/.agents/skills/`（ZCode 与 Kimi 共扫） | ✅ 已在位 |
| 六角色子代理（四角色移植 + archiver + red-teamer；3 个 *-rerun 变体由生成器物化） | `node templates/tools/sync-harness.mjs --apply` 一键分发（手动替代：cp `templates/agents/*.md` → `~/.zcode/agents/`） | ✅ 已部署，sync 体检全绿（2026-09-05 起 sync 自动化，N11） |
| **三正式 hooks 部署用户级**（**脚本执行位**：人工 cp `templates/hooks/` 三 .mjs → `~/.zcode/hooks/harness/`；**注册**：guard/inject/report → `~/.zcode/cli/config.json`，与 hindsight 四 hook 并列；config 模板见 `templates/user-config-hooks-template.json`，`__HOME__` 替换为展开后的用户主目录绝对路径） | 写入隔离 + 团队记忆注入 + 分支双态提醒（全项目通用，白名单防泄漏；guard 自防御条款保护执行位/注册文件） | ✅ 2026-09-02 部署；2026-09-07 执行位上收用户域 |
| hindsight 服务 | 按 06 文档 P0-1 结论部署（用户域全局服务） | ✅ OPT-1 收官（NSSM 服务化：崩溃自启/10MB 日志轮转/开机自启全实证） |
| hindsight-zcode 集成 | `uv tool install hindsight-zcode` + `hindsight-zcode install`（安装器在 Git Bash 下有 MSYS 反斜杠 bug，config 写入需手工兜底——见 08 §P0-2） | ✅ 三 hooks（session_start/recall/retain）已注册用户级 config（安装器崩溃后手工注册，08 实证） |
| harness-audit skill | 源=`templates/skills/harness-audit/SKILL.md`（sync 分发到 `~/.agents/skills/`） | ✅ 已装并首跑基线 93/A（2026-09-05，web2api） |
| Obsidian 同步 CLI（hindsight-obsidian-sync） | 官方 npm 包 `@vectorize-io/hindsight-obsidian`（v0.2.1）；命令要点：`--include` **可重复单值**（逗号形态无效）、reconcile 后事实抽取由服务后台异步完成（详见 03 §4.2 首跑注记） | ✅ 2026-09-06 已装并首跑（+50 文档入 knowledge bank） |

## 第 1 步：复制团队机制目录到新项目

```bash
HARNESS=~/.agents/Harness-Engineering   # harness 仓库标准位（2026-09-08 起；非标准位按本机实际改）
NEW=C:/project/改成新项目目录名   # ← 本块唯一需要改的行（改完再整段粘贴）
if [ ! -d "$NEW" ]; then echo "⚠️ 目录不存在：$NEW（全新项目先：mkdir -p \"$NEW\" && cd \"$NEW\" && git init -b main）"; exit 1; fi
cd "$NEW" && git rev-parse --git-dir >/dev/null 2>&1 || { echo "⚠️ 请先 git init（全新项目：git init -b main）"; exit 1; }
git symbolic-ref --short HEAD 2>/dev/null | grep -qx main || { echo "⚠️ 默认分支必须为 main（全部 --from main / --merged main 约定依赖它）"; exit 1; }   # symbolic-ref 在 unborn 分支（init -b main 后零提交）也成立；rev-parse --verify main 会误报"Needed a single revision"（08 第 6 条，Test05 首装实测）
mkdir -p .zcode docs/specs docs/tickets docs/reviews docs/changes memory && touch docs/specs/.gitkeep docs/tickets/.gitkeep docs/reviews/.gitkeep docs/changes/.gitkeep memory/.gitkeep   # .gitkeep：git 不追踪空目录，缺它跨机 clone 后五个目录全丢（08 第 6 条）
cp "$HARNESS/templates/zcode-config-template.json" .zcode/config.json
# 注（2026-09-06 C2 对齐 + 2026-09-07 执行位上收）：hooks 不复制到项目——注册（~/.zcode/cli/config.json）
# 与脚本执行位（~/.zcode/hooks/harness/）均在用户域（第 0 步一次性部署），项目级同事件被覆盖丢弃；
# 项目无需任何 hook 文件
ls .zcode/ docs/ && echo OK
```

## 第 2 步：生成两级 harness 配置 + 工作区 AGENTS.md（零参数宪法，v3）

```bash
HARNESS=~/.agents/Harness-Engineering   # harness 仓库标准位（2026-09-08 起；非标准位按本机实际改）
NEW=C:/project/改成新项目目录名   # ← 与第 1 步保持一致
# 优先路径：目标机装有 AI 宿主时走 docs/17 §3 S5 v3「问答写配置+原样 cp 宪法」——agent 探测候选+
# 七问生成两级配置+复制零参数宪法，零手工编辑；以下 cp+人工编辑为纯人工 fallback（无宿主/宿主不可用时）
# ① 项目级配置（参数按项目实际填，模板含全部键与说明）
cp "$HARNESS/templates/harness-project-template.md" "$NEW/harness.config.md"
# ② 宪法：零参数、全项目全宿主恒等——原样复制，不做任何替换（规范仓路径由机器配置 harness_repo 指向）
cp "$HARNESS/templates/AGENTS-template.md" "$NEW/AGENTS.md"
# ③ 机器级配置（每机一次，首装时生成；已有则跳过——目录在 ~/.agents/Harness-Configuration/）
ls "$HOME/.agents/Harness-Configuration/common.config.md" >/dev/null 2>&1 || {
  mkdir -p "$HOME/.agents/Harness-Configuration"
  cp "$HARNESS/templates/harness-common-template.md" "$HOME/.agents/Harness-Configuration/common.config.md"
  cp "$HARNESS/templates/harness-host-template.md" "$HOME/.agents/Harness-Configuration/zcode.config.md"; }
grep -c "团队流水线" "$NEW/AGENTS.md"   # 预期输出 1
grep -c "auto-merge: gates green" "$NEW/AGENTS.md"   # 预期输出 1（v3 合并条款随模板落地）
```

注意：**AGENTS.md 与 harness.config.md（两级）之后只能人改**（guard 阻断 Agent 改写——v3 红线两阶段：安装期可写、装毕即入，见 spec 19 §3.4；机器级配置由条文 + sync 检测约束）。

## 第 3 步：配置 .zcode/config.json（仅 MCP；hooks 已上收用户级）

> C2 结论：项目级 config **不再放 hooks**（会被用户级同事件覆盖，且 hooks 本就该全局一次）。项目 config 只承载本项目专属 MCP。

模板 `templates/zcode-config-template.json` 即纯 MCP 版：basic-memory（需把 `--project` 参数改成新项目名）；hindsight knowledge bank MCP（`http://localhost:8888/mcp/knowledge/`）Phase 2 起按 03 文档 2.4 节追加。**另需创建 marker 文件**（inject-memory 依赖，第 4 步一并完成）。

```bash
NEW=C:/project/改成新项目目录名   # ← 与前面步骤保持一致
PROJ=$(basename "$NEW" | tr 'A-Z' 'a-z')
sed -i "s/PROJECTNAME/$PROJ/g" "$NEW/.zcode/config.json"
grep "$PROJ" "$NEW/.zcode/config.json"   # ⚠️ 必须看到含新项目名的输出——sed 未匹配也返回 0，只能 grep 验证
```

## 第 4 步：登记记忆库（basic-memory，六角色团队记忆）

```bash
NEW=C:/project/改成新项目目录名   # ← 与前面步骤保持一致
PROJ=$(basename "$NEW" | tr 'A-Z' 'a-z')
cd "$NEW" && mkdir -p memory && basic-memory project add "$PROJ" "$(cygpath -m "$NEW/memory")" && basic-memory project list | tail -3
echo "$PROJ" > "$NEW/.zcode/memory-project"   # inject-memory hook 的项目名标记（缺失则注入 hook 静默失效）
# 预期 'added successfully'；军规：所有记忆调用显式 --project PROJ（null 空库兜底已在位）
```

hindsight 侧（Phase 2 起）：确认 `HINDSIGHT_DYNAMIC_BANK_ID=true` 生效即可——bank 按项目自动派生，无需逐项目登记。

## 第 5 步：git 入库

```bash
NEW=C:/project/改成新项目目录名   # ← 与前面步骤保持一致
cd "$NEW" && git add .zcode docs AGENTS.md harness.config.md memory && \
git commit -m "feat: harness engineering mechanism (from harness repo templates)" && git status --short
# 预期：提交成功，status 无输出
```

## 第 6 步：三项快速验证

```bash
NEW=C:/project/改成新项目目录名   # ← 与前面步骤保持一致
PROJ=$(basename "$NEW" | tr 'A-Z' 'a-z')   # 本块自足声明（每块可独立执行）
# ① gtr 自检（必绿）
cd "$NEW" && git gtr doctor | tail -3
# ② guard 模拟触发（预期：阻断提示 + exit=2；脚本用用户域部署位 ~/.zcode/hooks/harness/；
#    cwd 必须用 Windows 形态 cygpath -m）
echo "{\"cwd\":\"$(cygpath -m "$NEW")\",\"tool_input\":{\"path\":\"src/x.js\"}}" | node ~/.zcode/hooks/harness/guard-worktree.mjs; echo "exit=$?"
# ③ 记忆注入验证：先造数据再测——空库输出为空无法区分"正常"与"hook 失效"（防假绿）
#    注（AITrader2 首装实测 2026-09-08）：内容必须走 --content（v0.22.1 拒绝位置参数）；勿加重定向
#    吞错——写入失败会伪装成"注入无输出"；inject-memory 按 session_id 每会话仅注入一次
#    （%TEMP%\zcode-memo-injected-<sid> 标记），复测须换 session_id 或先清该标记
basic-memory tool write-note --title "verify-01" --folder decisions --content "迁移验证条目" --project "$PROJ"
echo "{\"session_id\":\"verify-01\",\"cwd\":\"$(cygpath -m "$NEW")\"}" | node ~/.zcode/hooks/harness/inject-memory.mjs | grep -q "$PROJ\|verify-01\|团队记忆" && echo "③ 注入 OK" || echo "③ ⚠️ 注入无输出：检查 write-note 是否成功（上一行应见 created）、.zcode/memory-project 与脚本字段（P0-3）"
```

①②③ 必须全绿（②③ 依赖第 0 步用户级 hooks 已部署——2026-09-02 起即在位）。全部就位后，在项目目录**新开会话**即可使用（角色文件、hooks、MCP 均启动时加载；ZCode 子代理定义改动也需新会话生效）。

## 规范修订后的再分发（N11 自动化，2026-09-05 起）

角色/技能/生成器/路由表修订合入本仓库后，一条命令分发到用户域（新项目接入前也建议先跑 `--check` 体检）：

```bash
node templates/tools/sync-harness.mjs          # 只读体检（有漂移 exit 1；在 REPO 根执行）
node templates/tools/sync-harness.mjs --apply  # 同步自动集到用户域
```

- **自动集**：六角色 base、harness-audit 技能、变体生成器、models.config.json——源=templates/（git 版本化），用户域均为部署副本
- **hooks 执行位（`~/.zcode/hooks/harness/`）只报告、永不代写**：AI 可改 templates 源（guard 白名单内），若脚本自动传播即等于 AI 可换掉运行中的 guard 自毁防线——该路径人工 cp（脚本打印现成命令）
- 用户级 config.json 三正式注册与项目结构（AGENTS/文档目录/模板基线对照）随跑随报，同样只报告；**模板基线对照（2026-09-08 起）读 AGENTS-template.md 头部 `constitution-affecting-baseline` 标记**——仅当模板变更影响已渲染宪法的实质内容时人工更新该日期（渲染机制类/新装默认类改动不触发；此前按模板 git 提交日比对会把非宪法级改动误标为各项目"未吸收更新"）；盘点发现的归属=各自项目，跨项目发现不构成当前项目的任务
- **新项目接入后**：把项目根路径加入 `~/.zcode/harness-projects.json`（JSON 数组；首跑缺失会自动 seed 本机默认集），此后该项目的结构盘点随跑随报
- **--apply 会覆盖部署副本**（无备份）：部署副本手改会被无声覆盖——正确姿势=只改 templates/ 源头；拿不准先跑 `--check` 看 DRIFT 清单
- 角色/路由表变更后按提示重跑 `generate-role-variants.mjs` 重铸 rerun 变体，并**新开会话**生效（C1 快照）

## 作用域速查表

| 事项 | 位置 | 何时做 |
|---|---|---|
| 软件/插件/技能/角色文件 | 用户域（`~/.zcode/`、`~/.agents/`、uv tools、npm -g） | 一次 |
| hindsight 服务 + Obsidian 同步 | 用户域全局服务 | 一次（Phase 2） |
| AGENTS.md / .zcode/config.json / docs/ 结构 / memory/ | 目标项目 | 每项目（本手册六步） |
| 规范修订 | harness 规范仓库（REPO）→ `sync-harness.mjs --apply` 再分发（hooks 执行位人工 cp 到 `~/.zcode/hooks/harness/`，见上节） | 变更时 |

## 最小可用变体

只想要"写入隔离 + 六角色但暂缓自动化 hooks"的项目：执行第 0 步（角色文件 + gtr）+ 第 1/2 步 + 第 3 步的 config 模板裁剪版（只留 MCP 段，hooks 段整段删除）+ 第 5/6 步即可；hooks、记忆与知识库能力随后随时补。

## 已知余项（接受，不阻塞）

- reviewer 输入白名单与 QA 文件边界为软约束（抽查制，两次突破升级为 hook 强制）——继承 AITrader 附 3。
- ZCode 工作区级子代理暂不支持（Beta 仅用户域），角色文件全局共享——若未来支持项目级，迁回项目域并更新本手册。
- hindsight worktree 派生一致性待 P0-2 实测；不一致则退化为静态 bankId 写入项目 config。
