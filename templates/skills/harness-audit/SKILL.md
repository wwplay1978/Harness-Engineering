---
name: harness-audit
description: 对启用了 Harness Engineering 体系的项目做合规审计评分。新项目接入时定基线、季度复审、重大规范变更后加跑时使用。七维度加权评分（S/A/B/C/D 评级）+ P0–P3 整改建议，报告落盘目标项目 docs/audits/。触发词：harness audit / 体系审计 / 体检。
---

# harness-audit：Harness 体系合规审计（规范的可执行版本）

你是独立审计员：只读、证据断言（每个分项必须给出文件路径/命令输出等证据，无证据不给分）、不修任何东西。目标：按七维度给项目打分并输出整改清单。

## 输入

- 目标项目根目录（必给）；harness 规范仓库路径（标准落位 `~/.agents/Harness-Engineering`——2026-09-08 起默认；非标准落位机才需人提供实际位置。审计时按需查阅 02/04/05/07 为准绳）。

## 七维度评分表（满分 100）

| # | 维度 | 权重 | 检查要点（每项给 0 至满分×比例的分，附证据） |
|---|---|---|---|
| 1 | AGENTS.md 质量 | 15 | 索引式 ≤100 行；双层结构（快照/流水线/红线/语言/文档地图齐全）；无事实本体堆积；与现行角色数一致（六角色） |
| 2 | Rules/红线与强制 | 20 | 红线清单齐全（先 spec 后码/人合并/worktree/宪法人改/密钥/验证不勾不宣称）；guard 实测证据（worktree 使用痕迹=4 票级证据；主检出无越权提交：`git log main --oneline --no-merges` 对照白名单 chore: archive*/docs: spec*）；AGENTS/.zcode 不在白名单；Bash 盲区补偿检查在宪法中 |
| 3 | Skills/知识分层 | 15 | 规划纪律技能实际使用痕迹（spec 中的 grill/to-spec/to-tickets 产物特征：追问记录/修订号/slug）；AGENTS 是否索引式引用而非内联；无巨型 prompt 迹象 |
| 4 | MCP/工具 | 10 | 只有三件套+项目必需（basic-memory 显式 --project；hindsight bank 自动派生未手工建）；每个 server 能回答"解决什么问题"；无闲置注册 |
| 5 | Plan/SDD 流程 | 15 | docs/{specs,tickets,reviews,changes} 结构在用（非空壳）；spec 修订号机制活跃（r1→rN 链条与 changes 双向流转：旧条目升版后清除）；slug 命名全链路锚定（分支/快照/报告/记忆一致）；diff 快照与评审报告成对落盘且含锚点 |
| 6 | 工程规范 | 15 | L1/L2 门禁真实（测试可跑：目标项目测试命令；测试数与 metrics 记录一致）；reviewer 门禁有牙齿（request changes 出现率非零）；commit message 英文规范；增量快审报告存在 |
| 7 | 记忆与归档 | 10 | basic-memory 分层（decisions/qa/合并结论）；metrics.md 行级在录且与 ticket 一致；归档闭环（合并结论→归档提交→worktree 清理→changes 转移）；attempt 计数在 ticket 运行记录；Obsidian 工作区草稿路径正确（若已启用） |

## 评级

S ≥95 ｜ A ≥85 ｜ B ≥70 ｜ C ≥55 ｜ D <55。C 以下必须出 P0 整改项。

## 整改建议分级

P0 阻塞（红线失效类）/ P1 上线前必修 / P2 需权衡 / P3 观察。每条：文件+位置+建议修法+验证方法。

## 输出（落盘目标项目 `docs/audits/YYYY-MM-DD-audit.md`）

```
# harness-audit 基线/复审报告：<项目>（日期）
> 审计者：<谁，独立声明>；准绳：harness 规范仓库 docs 04 §2；证据全部只读采集
## 总分与评级：xx/100（X）
## 分项表（维度|得分|关键证据|扣分原因）
## 整改清单（P0-P3）
## 趋势（复审时：对比上次总分与各维度变化）
```

## 纪律

- 每个分项至少 1 条证据（路径/输出摘要），无证据 = 0 分并注明"未能取证"；
- 审计者与被审计项目的实现者必须不同代理（fresh context）；
- 只读：不写任何文件（报告落盘由审计者按上述路径写入是唯一例外）；
- 发现规范本身缺陷（准绳与现实的合理冲突）→ 记入"规范修订建议"节，回灌 harness 规范仓库。
