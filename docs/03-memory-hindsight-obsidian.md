# 03 · 状态与记忆：四层架构、hindsight 整合与 Obsidian 知识库

> 解决的问题：ZCode 的"健忘症"——会话结束即失忆、跨项目经验不流通、知识库与编码过程割裂。

## 1. 记忆四层架构（总设计）

对齐 Harness 文章支柱四（短期/中期/长期/变更记忆），本体系由**五个组件**分工承载，各司其职、互不替代：

| 层 | 组件 | 存放 | 生命周期 | 载荷示例 |
|---|---|---|---|---|
| 短期（会话） | ZCode 会话上下文 + compaction | 会话内 | 会话 | 当前任务的推理链 |
| 中期（个体记忆） | ① ZCode 内建项目记忆（`~/.zcode/cli/memories/projects/<id>/MEMORY.md` 索引 + 单事实文件）② **hindsight**（语义记忆库） | 本机 / 本机服务 | 跨会话、跨工具 | "此项目用 uv 不用 pip"、"上次 decimal.Overflow 的教训" |
| 长期（团队资产） | ① git 工件：`docs/specs|tickets|reviews/` ② **Obsidian 知识库**（人的知识源） ③ basic-memory（六角色团队记忆） | 项目 git / vault / 项目 memory/ | 永久、可审查 | spec 修订史、架构决策、"为什么选 pgvector" |
| 变更记忆（Spec Deltas） | `docs/changes/<slug>.md`（工作中变更先落这里，合并时归档进 spec 并升修订号） | 项目 git | ticket 生命周期 | "R2 议程：QA 的 6 条 spec-gap 观察" |

**边界规则（防五件套互相侵蚀）：**

- **可审查的团队决策 → git 工件 / basic-memory**（随仓库走、可 diff、可回滚）；
- **个体跨会话经验 → hindsight**（语义检索，模糊查询"上次那个坑"靠它）；
- **人类知识（是什么/为什么）→ Obsidian**（唯一事实来源，单向流出到记忆系统）；
- **ZCode 内建记忆 → 轻量项目事实**（零成本，作为 hindsight 未部署时的兜底层）；
- 同一信息只允许一个"家"，其余位置只放引用。

## 2. hindsight 调研结论

### 2.1 是什么

[vectorize-io/hindsight](https://github.com/vectorize-io/hindsight)（MIT，约 22k stars）："会学习的 Agent 记忆"。核心事实：

- **服务架构**：本地自包含服务——API :8888 + Web UI(Control Plane) :9999 + 内嵌 PostgreSQL（pg0），无需外部数据库；可选外部 PG/pgvector 或 Hindsight Cloud（托管）。
- **记忆模型**：世界事实 / 经验 / 观察 / 心智模型，存入隔离的 **bank**；后台自动整理（去重、合并成带证据链的 observations）。
- **检索**：四路混合检索（语义向量 + BM25 + 图 + 时间），倒数排序融合 + 交叉编码器重排——这是它强于"把笔记塞 prompt"的关键。
- **三操作**：`retain`（LLM 抽取事实入库存）、`recall`（检索注入）、`reflect`（深度推理）。
- **依赖**：抽取事实需要一个 LLM 提供方（25+ 家，含 OpenAI 兼容端点与完全本地的 ollama/lmstudio）；可选 PII/密钥脱敏（Memory Defense）、Prometheus 指标、多语言。
- **与 Obsidian 有官方集成**（单向 vault → bank 同步 + 引用溯源，见第 4 节）。

### 2.2 适配性结论：**适合，有条件采纳**（⚠️ 最终以 P0-1/P0-2 实测为准——本结论依据官方文档与集成说明，本机 ARM64 环境未验证）

**匹配点（为什么是它）：**

1. **ZCode 是官方一等集成**（[集成文档](https://hindsight.vectorize.io/sdks/integrations/zcode)）：插件市场一键装（`zcode plugins add-marketplace vectorize-io/hindsight` + `install hindsight-zcode`），或 `pip install hindsight-zcode` CLI 安装。hooks 自动完成"会话开始注入 recall → 每轮对话检索 → 会话结束 retain"闭环，无需 MCP、无需改工作流——**正好补上 ZCode 健忘症**。
2. **与 ZCode 内建记忆互补而非冲突**：官方定位即"补充层"；我们的四层架构给它留的是"中期个体语义记忆"位，不挤占 git 工件与 Obsidian 的长期层。
3. **存储本地优先**（local-first）：服务与数据库可完全本地运行；MIT 许可。
   ⚠️ 如实声明（原则 8）：事实抽取用的 LLM 若配 GLM 云端点（R2 方案），会话内容会出本机——主模型本身已是 GLM，增量暴露等于现状，但这是**权衡选择而非纯本地方案**；要真本地需配 ollama/lmstudio 本地模型（质量待实测）。
4. **bank 隔离机制**契合我们的项目隔离军规：`HINDSIGHT_DYNAMIC_BANK_ID=true` 按项目派生独立 bank，杜绝 AITrader 踩过的"记忆跨项目泄漏"问题重演。

**风险与缓解（每条都有动作）：**

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | **服务器在 Windows ARM64 未官方列明**（文档只写 Windows x86_64 全支持；本机 ARM64、无 docker） | 高（P0-1 验证） | 三级 fallback：① `uv tool install hindsight-api` 直接跑（uv 已在位）→ ② Docker Desktop + ARM64 镜像（官方有 ARM64 full 镜像约 3.7GB）→ ③ `hindsight-api-slim` + 外部 embedding → ④ Hindsight Cloud（数据出境，**须用户拍板**） |
| R2 | 需要 LLM API key 做事实抽取 | 中 | 用 GLM 的 OpenAI 兼容端点（`HINDSIGHT_API_LLM_PROVIDER` + `BASE_URL`）或 Groq；中国网络注意 `HF_ENDPOINT=https://hf-mirror.com`（官方有专门指引） |
| R3 | recall 每轮注入 → 上下文膨胀 | 中 | dynamic bank 限定范围；检索本身是查询相关的（非全量注入）；监控每轮注入块大小，超阈值在 `~/.hindsight/zcode.json` 收紧 |
| R4 | hindsight 故障不能卡死编码会话 | 中 | P0-2 实测停服行为：hooks 必须 fail-open（连不上就静默跳过），否则不采纳 |
| R5 | 与 basic-memory 职责重叠 | 低 | 第 1 节边界规则硬性约定；basic-memory 只服务六角色流水线的结构化流转（planner 决策 → developer 备注 → QA 结论），hindsight 只管个体语义记忆 |
| R6 | 记忆投毒/敏感信息入库 | 低 | 开启 Memory Defense（PII/密钥脱敏）；bank 定期人工抽查（Control Plane UI :9999） |

### 2.3 部署选型（按 P0-1 实测结果定稿）

| 优先级 | 方案 | 命令要点 | 适用 |
|---|---|---|---|
| ① **已采纳（2026-09-02 实测通过）** | 裸机 uv（内嵌 pg0） | `uv tool install hindsight-api`；启动脚本 `~/.hindsight/start-hindsight.cmd`（中文模型本地化 + glm-4-flash；工艺细节与坑见 08 文档） | Windows ARM64 实测可用 |
| ② 次选 | 本地守护进程（coding-agents 专用轻量模式） | `uvx hindsight-embed`（:9077，不自动启动） | 同上，且更贴合 ZCode hooks 场景 |
| ③ 备选 | Docker Desktop + ARM64 镜像 | `docker run ... ghcr.io/vectorize-io/hindsight:latest`（-p 8888/9999，volume 持久化 `.pg0`；官方文档列 ARM64 full 镜像约 3.7GB——体积数字以官方安装页当时版本为准） | 需先装 Docker Desktop |
| ④ 兜底 | Hindsight Cloud | 注册拿 `hsk_` token | 数据出境，须用户明确同意 |

LLM 配置（①–③ 都要）：`HINDSIGHT_API_LLM_PROVIDER` / `HINDSIGHT_API_LLM_API_KEY` / `HINDSIGHT_API_LLM_BASE_URL`（指向 GLM OpenAI 兼容端点）。

### 2.4 ZCode 集成拓扑（目标态）

```
ZCode 会话
 ├─ SessionStart hook：hindsight 可达性检查
 ├─ UserPromptSubmit hook（recall.py）：按当前 prompt 检索 → 以 <hindsight_memories> 块注入
 └─ Stop hook（retain.py）：把本轮 prompt+response 成对入库
      ↓ HTTP
 hindsight 服务（:8888 或 :9077）
 ├─ bank：zcode::<项目>     ← dynamicBankId 按项目隔离（个体经验）
 ├─ bank：knowledge          ← Obsidian 定稿区(30/50) + 工作区(70-工作区/10-ZCODE) 单向同步（第 4 节）
 └─ （可选）bank：obsidian   ← 若走官方插件默认拓扑
安装位置：插件市场装 hindsight-zcode（用户域）→ hooks 落 ~/.zcode/hooks/hindsight/，
注册进 ~/.zcode/cli/config.json（自动置 hooks.enabled），个人配置 ~/.hindsight/zcode.json
```

要点：

- **knowledge bank 的消费方式**：ZCode hooks 只 recall 自己的 bank；知识库检索走**显式通道**——把 hindsight 的 MCP server（`http://localhost:8888/mcp/knowledge/`，每 bank 一个端点）注册进项目 `.zcode/config.json` → `mcp.servers`，planner/reviewer 可按需 `recall`/`reflect` 知识库（带引用溯源到 Obsidian 笔记）。
- **同步运行模式（默认按需，不用 --watch 常驻）**：`--watch` 常驻进程在 Windows 无守护，挂掉后 bank 悄悄陈旧而 recall 仍带"可点击引用"返回过期知识（权威感放大危害）。默认改为**按需 reconcile**：archiver 每单归档触发（SOP 第 4 步）+ 周整理触发；确需实时同步再开 watch，并在 Phase 2 验证项里加"重启后 bank 新鲜度抽查"。中文路径 + 逗号分隔的 `--include` 语法在 Windows 是常见翻车点，同样列入 Phase 2 显式验证。
- **worktree 兼容**：bank 按 git 项目派生时以主检出为准（coding-agents 安装器自称 worktree 感知——官方文档表述、未实测；hindsight-zcode 的 dynamicBankId 需在 P0-2 里用 worktree 实测确认派生一致）。
- **迁移性**：hindsight 是用户域全局服务——新项目零安装，只需确认 bank 派生正确 + 项目 config 注册 knowledge MCP（一行）。

## 3. ZCode 内建记忆的使用约定（当下即可用的兜底层）

- 位置：`~/.zcode/cli/memories/projects/<项目key>/`（`MEMORY.md` 索引 + 单事实一文件，frontmatter 带 type：user/feedback/project/reference）。
- 约定：只存"下次会话还值得知道"的项目事实与用户偏好；hindsight 上线后此层收缩为"零依赖兜底"（hindsight 停服时仍可用）。
- 每个 `MEMORY.md` 索引行必须指回具体文件，索引里不写事实本体。

## 4. Obsidian 知识库设计

### 4.1 现状与目录分工

vault 示例（替换为你自己的路径）：`<your-vault>`，Johnny Decimal 结构：

```
00-Inbox / 10-Outbox / 20-日记 / 30-知识库 / 40-配置库 / 50-项目库 / 70-工作区 / 80-模板 / 90-附件
```

**两级分区约定（重要）**：

| 分区 | 目录 | 性质 | 谁写入 |
|---|---|---|---|
| **定稿区** | `30-知识库/50-ZCODE/`（通用知识）、`50-项目库/30-ZCODE/<项目名>/`（项目知识）——两级 ZCODE 子目录为 2026-09-05 人裁决终版（web2api reconcile 定案） | 整理定稿、高可信 | 只有人（整理归位时） |
| **工作区** | `70-工作区/10-ZCODE/`（按类型分子目录，见下） | 进行中、未整理、草稿 | archiver 起草 + 人随手记 |

工作区子目录按类型划分：

```
70-工作区/10-ZCODE/
├── 工单沉淀/     # 每个工单的教训、模式、遗留观察（archiver 归档 SOP 产出）
├── 决策速记/     # 架构/选型决策的草稿（后续整理成 ADR 进定稿区项目库）
├── 环境怪癖/     # 平台坑速记（Windows ARM64、网络、工具链）
└── 调研笔记/     # 技术调研结论（后续提炼进 30-知识库）
```

定位（Harness 文章支柱二的"知识库注入业务上下文"）：**人的知识唯一事实来源**。AI 只读消费（经 hindsight 同步 + MCP 检索）；AI 产出的沉淀只进工作区，定稿区必须经人整理后写入——不让 AI 直接改可信知识，保持知识库信噪比。

### 4.2 与 hindsight 的单向同步（官方集成）

- 工具：headless CLI（推荐，可自动化）。**状态（2026-09-06）：已安装并首跑 ✅**——官方 npm 包 `@vectorize-io/hindsight-obsidian` v0.2.1（bin=`hindsight-obsidian-sync`；此前"自研未交付"系查错生态的误判，已全库勘误）；首跑 +50 文档入 `knowledge` bank（索引存 `~/.hindsight/obsidian/`）。命令：

```bash
hindsight-obsidian-sync reconcile \
  --vault "<your-vault-path>" \
  --bank knowledge \
  --api-url http://localhost:8888 \
  --include "30-知识库" --include "50-项目库" --include "70-工作区/10-ZCODE"
```

首跑实操注记（2026-09-06）：
1. **`--include` 是可重复单值参数，不是逗号分隔**（逗号形态整串被当一个文件夹名——旧版本文档曾写错，此为设计期预警翻车点的实锤）；
2. **抽取是异步的**：reconcile 只负责上传文档与索引（秒级）；事实抽取（LLM）由 hindsight 服务后台逐文档进行，50 文档约需 30–40 分钟才全部可被 `memories/recall` 检回——文档层即时入索引，检索层等抽取；
3. recall 端点：`POST /v1/default/banks/knowledge/memories/recall`，请求体字段 `query`/`budget`（无 `limit`）；实测 high 档约 24s/次（本地 bge 检索 + 重排），hook/调用方注意超时预算；
4. `knowledge-base/*` 端点（tree/pages/search）是 hindsight 另一套知识库功能，与 obsidian 同步通道无关，勿用作本集成验证。
5. **大批量首跑会触发 LLM 429 限流**（2026-09-06 实证：50 文档一次性涌入，8 条抽取操作 RateLimitError 失败=对应文档缺席检索层）——恢复：`GET /operations?limit=100` 找 failed → 逐条 `POST /operations/{id}/retry`（间隔数秒防再触顶）；大 vault 建议按目录分批 `--include` 错峰。consolidation 慢操作（processing 数十分钟、progress 字段可见进度）属正常，勿误判卡死。

（默认按需执行：archiver 每单归档触发一次 + 周整理触发一次，见 §2.4 运行模式与 archiver SOP 第 4 步；确需实时再开 `--watch` 常驻，并把"重启后 bank 新鲜度抽查"列入验证。）

- 备选：BRAT 装 Obsidian 插件（`vectorize-io/hindsight-obsidian`），适合手动场景；CLI 索引存 `~/.hindsight/obsidian/`（vault 外，不污染 Obsidian Sync）。
- 机制：**单向 vault → bank**；增量 upsert（内容哈希跳过未变）、删除自动修剪；自动打标 `vault:` / `folder:` / 日期，recall 时可按 tag 收窄；回答带**可点击引用**回源笔记。
- 入库范围：定稿区（30/50）+ 工作区（70-工作区/10-ZCODE）都入库——工作区知识是最新鲜的，planner 开工就要能检到；**信任分级靠 folder 标签**（定稿区结论可直接引用，工作区内容需注明"未整理"并以定稿区为准）。排除 20-日记/00-Inbox/10-Outbox/90-附件（隐私与噪声）。
- **铁律：Hindsight 永远不做第二事实源**——发现知识错误回 Obsidian 改，同步自动纠正。

### 4.3 知识飞轮（Archive 阶段的沉淀与整理流）

执行者是第五角色 **archiver（沉淀官，见 02 文档第 5 节）**，两级流转：

1. **工单级（每单）**：人合并后 archiver 把"本单可沉淀知识"写成草稿 →
   `70-工作区/10-ZCODE/工单沉淀/<slug>.md`（文件头含来源工单、spec 修订号、合并 hash，可追溯）→
   随即触发一次 reconcile（archiver SOP 第 4 步），当单即可被 recall。
2. **整理级（人主导，周或里程碑节奏）**：人（可派 docs-architect 协助）把工作区草稿去重、提炼、归位到
   `30-知识库/50-ZCODE/`（通用）或 `50-项目库/30-ZCODE/<项目名>/`（项目特定），原工作区笔记删除（同步自动修剪 bank）——工作区保持"只放未整理"语义。首次全量实转：2026-09-06 web2api 五票沉淀归位（工单索引+环境怪癖两件入定稿区、工作区清零）。

飞轮由此闭合：**工单 → 工作区草稿（即时可检索）→ 人工整理定稿 → 下个工单的 recall 注入**。

### 4.4 项目库页面约定（50-项目库/30-ZCODE/<项目名>/，定稿区）

每个启用本体系的项目一页（或一目录）：`50-项目库/30-ZCODE/<项目名>/`——架构决策记录（ADR 风格）、环境怪癖定稿、与 basic-memory decisions/ 的互相引用。planner 开工前必检**两处内容源**：定稿区本项目页（定稿）+ 70-工作区/10-ZCODE/ 近期未整理笔记（最新鲜）；访问通道两条：Obsidian 直读或 knowledge bank 检索（planner.md 行为校准列的第三处即 knowledge bank 通道，口径一致）。

## 5. 实施顺序（与 06 路线图联动）

1. **当下零成本层**：ZCode 内建记忆约定即刻生效（第 3 节）。
2. **P0-1/P0-2**：hindsight 服务器可行性 spike + ZCode 插件回路实测（判定标准见 06 文档）。
3. **Phase 2**：dynamicBankId 项目隔离、knowledge bank + Obsidian CLI 同步、MCP 注册、Memory Defense 开启。
4. **Phase 3**：记忆卫生制度——季度修剪（Control Plane 抽查 + 归档过期记忆）、注入体积监控、飞轮 SOP 固化。

## 参考链接

- hindsight 主仓库：https://github.com/vectorize-io/hindsight
- ZCode 集成：https://hindsight.vectorize.io/sdks/integrations/zcode
- Obsidian 集成：https://hindsight.vectorize.io/sdks/integrations/obsidian
- 安装与部署（含 Windows/中国网络指引）：https://hindsight.vectorize.io/developer/installation
- 集成总览：https://hindsight.vectorize.io/integrations
