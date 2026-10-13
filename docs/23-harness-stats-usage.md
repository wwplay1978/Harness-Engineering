# harness-stats 使用指南（效能统计系统·使用者手册）

> 读者：消费项目使用者（AITrader2/web2api 等已装六角色 harness 的项目）。版本：round-7（2026-10-13）。规范全文见 [22-effectiveness-statistics.md](22-effectiveness-statistics.md)（设计者视角）；本册只讲怎么用。
> 工具位置：规范仓标准位 `~/.agents/Harness-Engineering/templates/tools/harness-stats.mjs`（本机标准位已随 round-6 就位；其他机器 `git pull` 公开仓即得）。**零项目级安装**——工具与事件仓全在机器级，按需调用。

## 1. 前置

- Node.js ≥ 22.16（`node -v` 核对；零第三方依赖，仅 node 标准库）；
- 事件仓：`~/.agents/harness-stats/`（缺省路径，本地数据零上传；首次使用 `init` 建立）；
- 数据源（采集时读取，只读）：ZCode `~/.zcode/cli/`、Kimi `~/.kimi-code/`、Codex `~/.codex/`。

## 2. 五分钟上手

```powershell
$T = "$HOME\.agents\Harness-Engineering\templates\tools\harness-stats.mjs"

# ① 首次：建仓（已存在则幂等跳过）
node $T init

# ② 冻结采集快照（ZCode 派发面；--project-dir 指向消费项目仓根）
node $T bundle create-zcode-pilot --project-dir C:\path\to\<你的项目>

# ③ 采集入仓 → 挖矿物化
node $T collect --bundle <上一步输出的 bundle id>
node $T mine --bundle <bundle id>

# ④ 看报告
node $T report              # 终端表
node $T report --json       # canonical JSON（同快照重跑字节恒等，可存档复算）
```

Kimi/Codex 原生面：`bundle create-native-corpus`（参数同形）→ `collect --corpus <id>`。

## 3. 命令速查

| 命令 | 用途 |
|---|---|
| `init` | 建立事件仓（幂等） |
| `bundle create-zcode-pilot --project-dir <根>` | 冻结 ZCode 派发面快照（唯一真实源接触位，只读） |
| `bundle create-native-corpus --project-dir <根>` | 冻结 Kimi/Codex 原生面快照 |
| `collect --bundle/--corpus <id>` | 快照采集入仓（append 语义） |
| `mine --bundle <id>` | 物化派生层（attempt 分类等） |
| `reconcile --input <文件>` | 人工归因回灌（内容寻址归档） |
| `validate` | 双面一致性校验 |
| `verify --bundle <id>` | 票据×派发三方对账（含 orphan drift；差异率>5% exit≠0） |
| `report` | M1–M4 报告（本册 §4） |
| `b9-matrix --project-dir <根> [--out]` | B9 关闭矩阵七子项机判报告（判据冻结件为唯一依据，红项不改退出码；`--out` 不带值——工件自动命名 `b9-closure-matrix-<ISO>Z.json` 落事件仓 `reports/`，append 禁覆写） |
| `compact` / `prune` | 段合并 / 旧代清理（引用保护在役——report 引用的段永不被删） |
| `rebuild --from-source --bundle <id>` | 自源重建 |
| `migrate-audit` | 存量审计迁移 |
| `validate-schema <路径>` | 契约 fixture 三层验证（开发面） |

全局参数：`--store-root <dir>`（缺省 `~/.agents/harness-stats`）、`--since/--until <RFC3339-UTC>`（report 时间窗）、`--project <id>`（report 项目过滤，可重复）。退出码：0 成功 / 1 fail-loud / 2 用法 / 60 UNSUPPORTED_SOURCE / 64 版本不足 / 65 ACL。

## 4. report 输出解读

真实样例（本机 2026-10-12；[M3]/[M4] 行=沙盒合成仓实跑 2026-10-13——同门红态）：

```
report（all-store）generation=1 closed_segments=8 events=19815 watermark=2026-10-10T01:48:33Z
[M1] 派发 498（失败 16，失败率 0.0325）墙钟 439789000ms 模型时长 522784496ms retry 760
[M2] 分类质量门 red（版本差） auto 面 blocked-classifier-gate-red
[M2] 人工归因子集 entities=23 tickets=4
[M3] 周期时间 blocked（merge 锚物化面停该子面呈报——详见 --json reason）· agent/空闲 active 17400000ms / idle 36000000ms（estimation）
[M4] 周趋势 2026-W38 █*  2026-W39 █*
[M4] 返工成本占比 blocked（门红态分子源受阻——非 0） · 邻接拒绝 blocked（门红态分子源受阻——非 0）
[M4] 路由对照 NOT_ENOUGH_CHANGE_POINTS（verified 0/8 派发全锚 0——锚缺失统计见 --json）
```

- **[M1] 运行计量**：完整可用——派发次数/失败率/累计墙钟/模型时长/retry（按模型五路分列见 --json）。
- **[M2] 质量计量=三层门红态**：`分类质量门 red` 行=attempt 分类器验收门状态（数据源=最近一次 held-out 终判工件；`（版本差）`=工件版本落后当前词典）。门红期间：**auto 面指标显示 `blocked-classifier-gate-red`（数字不出）**——这是诚实标注而非故障：分类数字需待滚动重验批双门通过后解锁；**人工归因子集照常出数**（人工核定的归因不受分类器门影响）。
- `--json` 体含全部分母/分子与 manifest 所需信息（可复算）；`--out <相对名>` 落盘到 `~/.agents/harness-stats/reports/<ISO 周桶>/`（白名单路径外拒绝；append 禁覆写）。

## 5. 消费项目接入

- **前提已在**：项目 AGENTS.md 宪法 4a 条款（2026-10-12 已分发）令流水线票的运行记录行自动记执行会话标识——新票照常走六角色流水线即可，无需额外配置；
- 采集时 `--project-dir` 指向项目仓根（票据/评审/git HEAD 来源）；
- 项目票面运行记录形制：`角色/变体 | attempt | 结果 | 日期 | 备注 | 执行会话标识`（末列由 main agent 代录）。

## 6. B3 脱敏检测器

对外共享工件（发布/传仓）前：

```powershell
cd <工件所在目录>
node "$HOME\.agents\Harness-Engineering\templates\tools\b3-redact-check.mjs" 文件1 文件2 …
```

退出码：0=干净 / 1=有命中（输出 JSON：逐文件 pattern+excerpt_sha8，零明文）/ 2=用法错或编码不支持（UTF-16 等「读不了的形态不报干净」）。检测族：Windows 盘符用户路径、POSIX 根路径、当前真实用户名子串；合成 `demo` 路径段白名单。**调用契约=相对名+cwd**（绝对路径回显会携带本机路径成分）。

## 7. 数据与隐私

事件仓纯本地（`~/.agents/harness-stats`，零上传零遥测）；采集只读快照冻结；report 默认 stdout 零落盘；对外共享前用 B3 门。

## 8. 已知边界（2026-10-13）

- M2 auto 面数字：滚动重验批双门通过前维持 blocked（预计随后续票台账行累积触发）；
- M3（流动）/M4（趋势）：M3 流动/M4 趋势已交付（stats-5）——M3-1 ticket cycle time 停摆子面 blocked（merge 锚物化面归后续票）；路由对照恒 NOT_ENOUGH_CHANGE_POINTS（锚采集面归后续票——诚实态非缺陷）；
- `heldout-*`/`pilot-report` 子命令：分类器开发/验收面，非使用者面。

## 9. 排障

- `退出码 64`：Node 版本 <22.16（升级后重试）；
- 中文乱码：PowerShell 先 `$OutputEncoding=[Text.Encoding]::UTF8; chcp 65001`；
- Windows 编码工件被 B3 拒（exit 2 UTF-16）：转存 UTF-8 后再检；
- 报告数字与预期不符：先 `validate`（双面一致性）再 `verify`（三方对账），fail-loud 会指出差异面。
