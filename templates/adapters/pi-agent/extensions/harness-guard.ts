// harness-guard.ts — pi 写入隔离扩展（六角色 guard 的 pi 形态，docs/18 §6）
// 阻断语义（官方文档 extensions.md）：pi.on("tool_call") 处理器返回 { block: true, reason } 即拒止该工具调用；
// 路径保护是官方列明的扩展场景。逻辑与 templates/hooks/guard-worktree.mjs 同源；
// 含自防御条款（2026-09-07）：无论 cwd，保护各宿主 hooks 执行位与注册文件（SHIELD 表）。
// 放置：~/.pi/agent/extensions/harness-guard.ts（全局）或 <项目>/.pi/extensions/（项目受信后加载）。
// 装机验证项：input 路径字段名（官方示例为 event.input.command，写路径字段以探针确认为准）；
//            ctx.cwd 字段名（取不到时回退 process.cwd()，等价"会话从主检出启动"假设）。
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const norm = (s) => (s ?? '').split(BS).join('/').toLowerCase();
// 白名单与 .mjs 同源；不含 AGENTS.md（宪法只能人改）、不含 .pi/（扩展注册，人负责——防自毁防线）
const ALLOW = ['/docs/', '/memory/', '/context.md', '/templates/'];
// 自防御条款与 .mjs 同源（homedir() 运行时计算，禁硬编码机器绝对路径）
const SHIELD = [
  '/.zcode/hooks/harness/', '/.zcode/cli/config.json',
  '/.claude/hooks/harness/', '/.claude/settings.json',
  '/.kimi-code/hooks/harness/', '/.kimi-code/config.toml',
  '/.codex/hooks/harness/', '/.codex/hooks.json', '/.codex/config.toml',
].map((r) => norm(join(homedir(), r)));
// pi 内置工具小写（read/bash/edit/write）；如出现第三写入工具（如 patch 类），装机时补入本集
const WRITERS = new Set(['write', 'edit']);
const MSG = '[写入隔离] 禁止直接修改主检出。请按场景执行：' + NL +
  '  首次开工:   git gtr new feat/<slug> --from main' + NL +
  '  修复轮/QA:  cd "$(git gtr go <slug>)"' + NL +
  '然后在 worktree 目录内工作（git worktree list 查看路径）。';
const SHIELD_MSG = '[写入隔离] 受保护路径（hooks 执行位/注册文件）——hooks 机制只能人修改' + NL +
  '（docs/05 §3；如需变更请人直接编辑，Agent 无合法需求）。';

export default function harnessGuard(pi) {
  pi.on('tool_call', async (event, ctx) => {
    if (!WRITERS.has(event.toolName)) return;
    const raw = event.input?.path ?? event.input?.file_path;
    const root = norm(ctx?.cwd ?? process.cwd());
    if (!raw || !root) return; // 无路径可判 → fail-open（与 .mjs 同语义）
    const abs = raw[0] === '/' || raw[1] === ':' ? raw : resolve(root, raw);
    const file = norm(abs);
    // 自防御在 root 前缀判断之前（受保护路径都在仓库外，放后面永不生效）
    if (SHIELD.some((s) => file.startsWith(s))) return { block: true, reason: SHIELD_MSG };
    // 必须 root + '/'：startsWith(root) 会把兄弟目录 <repo>-worktrees 误判为主检出
    if (!file.startsWith(root + '/')) return;
    const rel = file.slice(root.length);
    if (ALLOW.some((a) => rel.startsWith(a))) return;
    return { block: true, reason: MSG };
  });
}
