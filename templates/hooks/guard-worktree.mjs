// PreToolUse 守卫：禁止直接写主检出（文档与配置目录除外）
// ── ZCode 真实 payload schema（2026-09-02 实测，见 docs/08-p0-field-log.md）──
// 顶层扁平字段：hook_event_name / session_id / cwd / tool_name / tool_input /
//              permission_mode / transcript_path（另有 camelCase 重复形态，勿依赖）
// 路径字段：tool_input.file_path（ZCode）——注意 Kimi 是 tool_input.path，两工具不同！
//          本脚本按 file_path ?? path 双读，ZCode 优先
//          file_path 为绝对路径 Windows 反斜杠形态；仍保留相对路径兜底
// Edit 的 tool_input 含完整 old_string/new_string（payload 很大，勿整体落盘）
// matcher 必须为 "Write|Edit|ApplyPatch"（实测 Edit 命中；ApplyPatch 冗余防御）
// 假设：会话从主检出目录启动，p.cwd 即主检出根。
// 在 worktree 内启动会话时本守卫语义失效——但此时写 worktree 本就合法，无风险。
import { resolve } from 'node:path';
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const p = JSON.parse(input);
    const norm = s => (s ?? '').split(BS).join('/').toLowerCase();
    const root = norm(p.cwd);
    // ZCode 实测字段为 file_path；path 为 Kimi 兼容兜底
    const raw = p.tool_input?.file_path ?? p.tool_input?.path;
    if (!raw || !root) process.exit(0);
    const abs = raw[0] === '/' || raw[1] === ':' ? raw : resolve(root, raw);
    const file = norm(abs);
    // 必须 root + '/'：startsWith(root) 会把兄弟目录 <repo>-worktrees 误判为主检出
    if (!file.startsWith(root + '/')) process.exit(0);          // 不在主检出内 → 放行
    const rel = file.slice(root.length);
    // 白名单：docs/（工件）、memory/（basic-memory 库）、context.md（planner 产出）、
    // templates/（本仓库规范工作区——仅 harness 仓库自身需要；业务项目根罕见 templates/，风险低）
    // 注意：不含 AGENTS.md（流水线宪法只能人改）、不含 .zcode/（hook 注册与脚本，人负责——
    // 否则 Agent 可关闭 guard 自毁体系，威胁模型见 docs/05 §3）
    const allow = ['/docs/', '/memory/', '/context.md', '/templates/'];
    if (allow.some(a => rel.startsWith(a))) process.exit(0);
    const msg = '[写入隔离] 禁止直接修改主检出。请按场景执行：' + NL +
      '  首次开工:   git gtr new feat/<slug> --from main' + NL +
      '  修复轮/QA:  cd "$(git gtr go <slug>)"' + NL +
      '然后在 worktree 目录内工作（git worktree list 查看路径）。';
    console.error(msg);
    process.exit(2);                       // 阻断（ZCode exit 2 = deny，官方文档确认）
  } catch { process.exit(0); }                              // fail-open
});
