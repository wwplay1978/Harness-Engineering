# Diagrams（体系图）

风格统一、Light/Dark 双主题的交互式体系图，均为**零依赖单文件 HTML**（下载后双击即开）。

| 文件 | 内容 | 特性 |
|---|---|---|
| [`architecture.html`](architecture.html) | 体系总体架构：人机契约、宿主层、六角色、物理写入隔离、四层记忆、规范反馈环 | 主题切换、缩放平移、搜索聚焦、引导章节 |
| [`pipeline.html`](pipeline.html) | 六角色流水线全貌：一票从立项到归档的完整路径与修复回路 | **Live trace 动画**（一票全流程逐步点亮）、主题切换、引导章节 |
| `architecture-light.png` / `pipeline-light.png` | Light 主题静态预览（README 内嵌用） | — |
| `*.json` | 两张图的源规范（[archify](https://github.com/tt-a1i/archify) 类型化 JSON，可版本化、可再生成） | — |

提示：

- HTML 在 GitHub 上显示为源码；clone 或下载后本地打开即为完整交互版。
- URL 加 `?theme=light`（或 `?theme=dark`）可固定主题，否则跟随系统。
- 修改图表：改 `*.json` 源 → 重新生成 HTML → 二者一起提交（源与产物成对演进）。
