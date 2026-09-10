# Harness 项目配置（harness.config.md）

> 生成说明：本文件是**本项目参数**的唯一住所——项目名、快照、项目段；由安装助手在 S5① 按七问
> 生成（agent 生成 + 人复核 = 人授权），已武装 guard 机器走降级路径（草稿落 docs/ 白名单区、
> 人执行一条 move）。**安装结束后只能人工修订**（红线；guard 物理拦截 Write/Edit——Bash 写入
> 属流程事故同罪）。测试命令等时效字段由人随里程碑更新，agent 用前必读。
> 级联：common < host < project（低层可被本文件覆盖）。解析约定同 common。
> 随本模板生成的项目根副本文件名=harness.config.md（模板本身留在 REPO，不复制进项目）。

| 键 | 值 | 说明 |
|---|---|---|
| schema | 1 | 配置版本 |
| project_name | （目录名） | 项目名；basic-memory `--project` 按其小写派生 |
| one_liner | 待补 | 一句话定位（planner 首个 spec 校正） |
| tech_stack | 待补 | 技术栈（安装助手探测或"待补（planner 首个 spec 校正）"） |
| build_cmd | 待补 | 构建命令（按技术栈惯例候选或"待补（developer 首票确认）"） |
| test_cmd | 待补 | 测试命令（同上） |
| dir_brief | 待补 | 目录速览一行图（安装助手按仓库结构生成，如 src/（业务） tests/（测试） docs/（工件）） |
| project_segment | （派生式） | 知识库项目段；缺省= `<zone_final_project>/<agent_segment>/<project_name>`，可覆盖 |
| checkpoint_every | 3 | 可选：自治链检查点间隔票数（20 号 spec §5） |
| auto_push_remote | （无） | 可选：允许自动 push 的 remote 名/URL（20 号 §4；**无人配置=不自动 push**） |

## 修订记录（只追加，不改写）

| 日期 | 变更 | 动机 |
|---|---|---|
| （安装日期） | init <project/日期> | 首装生成（agent 生成 + 人复核 = 人授权） |
