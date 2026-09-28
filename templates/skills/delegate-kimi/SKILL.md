---
name: delegate-kimi
description: 把白名单只读治理角色（planner/red-teamer）委派给本机 Kimi Code 订阅执行：kimi -p 无头模式 + --agent 角色档案 + 显式 -m 订阅别名，跑完从 stdout 回收完整报告；落盘仍由 main agent 代写。含环境事实校验清单、密钥防线与哨兵验收（2026-09-23 实弹审查修订版）。
---

# delegate-kimi：委派只读角色给 Kimi Code（走订阅，不走 API）

**为什么**：planner / red-teamer 的推理改吃 Kimi Code 订阅（`kimi-code/*` 模型别名），
替代 ZCode 侧 API 路由（`~/.zcode/agents/*.md` frontmatter `model:` 指向 API 提供商，按 token 计费）。
机制 = 本机 Kimi Code CLI 的 `-p` 非交互模式：加载角色档案跑完任务，最终回复打到 stdout，调用方回收。
角色只交文本、main agent 代写落盘的流水线契约**不变**。

**前置**：本机已装 Kimi Code CLI（`kimi doctor` 全绿）且订阅已登录（`kimi login`）。
未装/未登录的机器上冒烟必红——此时禁用本技能，planner/red-teamer 直接走 ZCode API 路由即可。

## 角色白名单（硬边界）

当前仅两个只读角色：`planner`、`red-teamer`（档案在 `~/.kimi-code/agents/`）。
**白名单无物理强制**：六档案全部在场、`--agent` 接受任意档案名，守约靠本技能自律 + guard 部分兜底（见规则 6）。
扩大白名单（含任何写类/执行类角色）须用户显式裁决；裁决时必须计入 **Bash 执行面无兜底** 这一项。

## 标准调用形态

```
kimi -p "<短指令：指向已落盘的输入文件；要求报告末行哨兵>" --agent <角色名> -m kimi-code/<别名>
```

- **参数顺序铁律（2.0.1 实证）**：`-p` 的提示词必须紧跟其后作为取值。写成
  `kimi -p --agent <角色> … "<提示词>"` 时 `<角色>` 会被解析成子命令直接报错
  `unknown command '<角色>'`（官方文档示例顺序在本机恰好踩坑）。
- 默认 text 输出：stdout 末段即完整报告，干净直接。
- 审计时加 `--output-format stream-json`：thinking 不在内、工具进度走 stderr；末行
  `session.resume_hint` 带 session_id，可 `kimi -r <session_id>` 续会话做聚焦复验
  （red-teamer 修复轮复验、planner 阶段 B/C 接力不必重喂上下文）。**复验须同 cwd**——会话按 cwd 目录哈希存储（实证）。
- **模型命中核对（首选）**：`~/.kimi-code/sessions/wd_*/<session_id>/agents/main/wire.jsonl`
  的 `profile.bind.modelAlias`（2026-09-23 实证可靠，优于 grep `"model"`）。
- cwd=项目根；需跨目录读文件时加 `--add-dir <dir>`。

## 硬规则

1. **必须显式 `-m kimi-code/<别名>`，禁省略**。别名写错=启动即硬报错
   `Model ... is not configured in config.toml`（实证）；**漏写=静默落 default_model——唯一静默路径**，
   等同未经用户点名换模型、归因留痕写错。环境事实会漂移：default_model 与订阅别名清单以
   `~/.kimi-code/config.toml` 实时读数为准（2026-09-23 读数：`default_model = "kimi-code/k3-256k"`、
   别名 k3 / k3-256k / kimi-for-coding / kimi-for-coding-highspeed），冒烟门逐项核对、不靠记忆。换别名须用户点名。
2. **提示词瘦身**：长内容（spec/diff/评审与 QA 报告/changes）一律先落文件，`-p` 提示词只含
   文件路径与任务指令；禁内联多行正文（MSYS 引号/反斜杠坍缩 + argv 体积上限前科）。
3. **超时策略**：预计 8 分钟内→同步调用（Bash timeout 上限 600000ms）；更长→后台任务跑、
   stdout 重定向到文件，完成后回收；不留无人认领的后台进程。**被超时杀掉=按 fail loud 处理**，
   已收到的部分 stdout 不得当作完整报告。
4. **验收**：stdout 末段=角色完整报告且**末行哨兵 `— 报告完 —` 在位**（提示词中明确要求该哨兵）。
   空输出、缺哨兵、明显截断=fail loud 如实上报，不伪造、不裁剪冒充完整。
5. **冒烟门**：首次使用或环境变更（kimi 升级、config.toml 改动、档案重装）后先过三步：
   ① 环境事实清单：config.toml 实读 default_model、三条 `[[hooks]]` 注册未注释、白名单档案在位；
   ② 最小冒烟：`kimi -p "委派机制冒烟：不要读取任何文件、不要调用任何工具，仅原样回复 DELEGATE-OK" --agent red-teamer -m kimi-code/k3`；
   ③ 核对本次会话 wire.jsonl 的 modelAlias。全过再派正事。
6. **治理边界（实机语义，2026-09-23 装机+实弹审查修订）**：
   - kimi 进程不受 ZCode 侧 hooks（pre-merge-check 等）管辖。
   - **委派角色输入不纯**：除调用方喂的文件外，UserPromptSubmit 钩子会注入团队记忆（inject-memory），
     并加载用户级 `~/.kimi-code/AGENTS.md`——均不在调用方控制内。是否接受其影响 planner/red-teamer 产出
     （或为无头委派会话跳过注入）属 harness 设计裁决，须用户定夺，本技能不自行决定。
   - **guard hook 非全局写禁**：实语义=写入隔离守卫（主检出禁写；白名单 `/docs/ /memory/ /context.md /templates/`
     放行；主检出之外一律放行）+ SHIELD 自防御（hooks 执行位/注册文件全局禁写，实证有效）+ 异常 fail-open。
   - **Bash 执行面无任何兜底**（`default_permission_mode = "auto"`，无头下命令自动批准）——
     只读角色档案的 tools 白名单是当前唯一物理防线；planner 档案补禁 Write 之前，其只读性存在物理缺口（待裁决项）。
   - 委派中若从 stream-json/stderr 发现白名单角色出现写类 tool call → 立即终止并如实报告。
7. **输入可信与密钥防线**：委派输入文件须为内部可信产物；含外部/不可信内容（外部 QA 报告、
   外部数据衍生的 diff 等）时先 sanitize 或取得用户裁决再委派。角色持 Read 可达全盘敏感文件
   （`~/.kimi-code/config.toml` 明文 API key 实证可读）——提示词须明示
   "禁读 `~/.kimi-code/` 及其他凭据/配置文件、禁在报告中引用任何密钥或凭据材料"；
   main agent 代写落盘前对报告 grep 密钥模式（如 `ark-`、`sk-` 前缀），命中即扣留报告并上报，不落盘。
8. **留痕**：代写落盘时标注执行位与实际命中模型（取自 wire.jsonl `profile.bind.modelAlias`，
   如"执行位=kimi-code 订阅 kimi-code/k3，经 delegate-kimi"）。订阅为 fair-use 配额、与交互会话共用；
   限速/配额异常如实报告。

## 失败与回退

- 命令报错/超时/空输出/缺哨兵 → 按规则 4 上报，不重试掩盖；**单次任务会话内**连败两次停止委派并报告。
- 订阅配额或限速异常 → 报告后由用户裁决：等待、换 `kimi-code/*` 别名，或回退 ZCode API 路由
  （`~/.zcode/agents/*.md` frontmatter `model:` 字段原样保留，随时可切回）。
