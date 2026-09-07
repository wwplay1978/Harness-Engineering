// harness-guard.js — opencode 写入隔离插件（六角色 guard 的 opencode 形态，docs/18 §5）
// 阻断语义（官方文档 plugins 页）：tool.execute.before 内 throw Error 即拒绝本次工具调用。
// 逻辑与 templates/hooks/guard-worktree.mjs 同源：主检出内、白名单外的一律拦下并给 gtr 指引；
// 含自防御条款（2026-09-07）：无论 cwd，保护各宿主 hooks 执行位与注册文件（SHIELD 表）。
// 差异：opencode 无 stdin/exit-2 hooks 子系统，走进程内插件事件。
// 放置：~/.config/opencode/plugins/harness-guard.js（全局）或 <项目>/.opencode/plugins/（项目级）。
// 装机验证项：write/edit/patch 工具名集与 args 路径字段名（先跑 templates/hooks/probe-payload.mjs 变体探针）。
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const norm = (s) => (s ?? '').split(BS).join('/').toLowerCase();
// 白名单与 .mjs 同源：docs/ 工件、memory/ 库、context.md、templates/；
// 不含 AGENTS.md（宪法只能人改）、不含 .opencode/（插件注册，人负责——防自毁防线）
const ALLOW = ['/docs/', '/memory/', '/context.md', '/templates/'];
// 自防御条款与 .mjs 同源（homedir() 运行时计算，禁硬编码机器绝对路径）
const SHIELD = [
  '/.zcode/hooks/harness/', '/.zcode/cli/config.json',
  '/.claude/hooks/harness/', '/.claude/settings.json',
  '/.kimi-code/hooks/harness/', '/.kimi-code/config.toml',
  '/.codex/hooks/harness/', '/.codex/hooks.json', '/.codex/config.toml',
].map((r) => norm(join(homedir(), r)));
// opencode 工具名小写；"patch" 为防御性冗余（对齐 .mjs 的 ApplyPatch 冗余）
const WRITERS = new Set(['write', 'edit', 'patch']);
const MSG = '[写入隔离] 禁止直接修改主检出。请按场景执行：' + NL +
  '  首次开工:   git gtr new feat/<slug> --from main' + NL +
  '  修复轮/QA:  cd "$(git gtr go <slug>)"' + NL +
  '然后在 worktree 目录内工作（git worktree list 查看路径）。';
const SHIELD_MSG = '[写入隔离] 受保护路径（hooks 执行位/注册文件）——hooks 机制只能人修改' + NL +
  '（docs/05 §3；如需变更请人直接编辑，Agent 无合法需求）。';

export const HarnessGuardPlugin = async ({ directory, worktree }) => {
  const root = norm(directory ?? worktree ?? process.cwd());
  if (!root) return {};
  return {
    'tool.execute.before': async (input, output) => {
      if (!WRITERS.has(input.tool)) return;
      const raw = output.args?.filePath ?? output.args?.file_path ?? output.args?.path;
      if (!raw) return; // 无路径可判 → fail-open（与 .mjs 同语义）
      const abs = raw[0] === '/' || raw[1] === ':' ? raw : resolve(root, raw);
      const file = norm(abs);
      // 自防御在 root 前缀判断之前（受保护路径都在仓库外，放后面永不生效）
      if (SHIELD.some((s) => file.startsWith(s))) throw new Error(SHIELD_MSG);
      // 必须 root + '/'：startsWith(root) 会把兄弟目录 <repo>-worktrees 误判为主检出
      if (!file.startsWith(root + '/')) return;
      const rel = file.slice(root.length);
      if (ALLOW.some((a) => rel.startsWith(a))) return;
      throw new Error(MSG);
    },
  };
};
