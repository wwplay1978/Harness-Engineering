// sync-harness.mjs — N11 规范分发自动化（Zcode_T1 templates/ → 用户域部署位）
// 用法：
//   node templates/tools/sync-harness.mjs            默认 --check：只读报告（有漂移 exit 1）
//   node templates/tools/sync-harness.mjs --apply    同步【自动集】到用户域（写后回读校验）
// 设计要点（docs/14 缺口 A，2026-09-05）：
//   - 单一事实来源 = 本仓库 templates/；用户域文件均为部署副本
//   - hooks 脚本执行位 = <repo>/.zcode/hooks/（config.json 注册路径）**只报告、永不代写**：
//     AI 可改 templates 源（guard 白名单内），若脚本自动传播即等于 AI 可换掉运行中的
//     guard 自毁防线——该路径必须过人手（威胁模型 docs/05 §3）
//   - rerun 变体（*-rerun.md）是 generate-role-variants.mjs 的编译产物：不入清单、不删除
//   - 用户级 config.json / 项目 AGENTS.md 同为只报告（前者混有 hindsight 等非本仓库内容，
//     后者是人工宪法）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const repo = join(import.meta.dirname, '..', '..');   // templates/tools/ → 仓库根
const HOME = homedir();
const apply = process.argv.includes('--apply');
const read = f => (existsSync(f) ? readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : null);

// ── 自动集（--apply 可写）──────────────────────────────────────────
const BASE_ROLES = ['planner', 'developer', 'code-reviewer', 'qa-tester', 'archiver', 'red-teamer'];
const SYNC = [
  ...BASE_ROLES.map(r => ({
    src: `templates/agents/${r}.md`, dst: join(HOME, '.zcode', 'agents', `${r}.md`), why: '角色定义',
  })),
  { src: 'templates/skills/harness-audit/SKILL.md', dst: join(HOME, '.agents', 'skills', 'harness-audit', 'SKILL.md'), why: '审计技能' },
  { src: 'templates/tools/generate-role-variants.mjs', dst: join(HOME, '.zcode', 'tools', 'generate-role-variants.mjs'), why: '变体生成器' },
  { src: 'templates/models.config.json', dst: join(HOME, '.zcode', 'models.config.json'), why: 'OPT-2 路由表' },
];

// ── hooks 执行位（只报告）+ 三正式注册（只报告）──────────────────
const HOOKS = ['guard-worktree', 'inject-memory', 'report-worktrees'];
const PROJECTS = ['C:/Forex/Project/web2api'];

let drift = 0, applied = 0, rolesOrModelsChanged = false;
console.log(apply ? '== APPLY（写入用户域）==' : '== CHECK（默认只读；--apply 才写入）==');
console.log(`repo = ${repo}\n`);

// 1) 自动集
console.log('-- 自动集（角色/技能/生成器/路由表）--');
for (const it of SYNC) {
  const srcAbs = join(repo, it.src);
  const s = read(srcAbs);
  if (s === null) { console.log(`[MISS-SRC] ${it.src} 仓库缺源头——先补齐再同步`); drift++; continue; }
  if (s === read(it.dst)) { console.log(`[SAME]    ${it.src}`); continue; }
  if (!apply) { console.log(`[DRIFT]   ${it.src} → ${it.dst}（${it.why}）`); drift++; continue; }
  mkdirSync(dirname(it.dst), { recursive: true });
  writeFileSync(it.dst, readFileSync(srcAbs));                  // 原字节写入，保留源 EOL
  if (read(it.dst) !== s) { console.error(`[FAIL] 写后校验不一致：${it.dst}`); process.exit(1); }
  console.log(`[APPLIED] ${it.src} → ${it.dst}`);
  applied++; drift++;
  if (it.src.startsWith('templates/agents/') || it.src === 'templates/models.config.json') rolesOrModelsChanged = true;
}

// 2) hooks 执行位（config.json 实际执行 <repo>/.zcode/hooks/）
console.log('\n-- hooks 执行位（.zcode/hooks/；只报告，人工同步）--');
for (const h of HOOKS) {
  const src = `templates/hooks/${h}.mjs`;
  const dst = join(repo, '.zcode', 'hooks', `${h}.mjs`);
  if (read(src) === read(dst)) { console.log(`[SAME]  ${h}.mjs`); continue; }
  drift++;
  console.log(`[DRIFT] ${h}.mjs：templates 源 ≠ 执行位（人工执行，勿让 AI 代跑）：`);
  console.log(`        cp "${src}" "${dst.replace(/\//g, '\\')}" && git add -A && git commit -m "chore: sync executed hook ${h} from templates"`);
}

// 3) 用户级 config.json 三正式注册核对（命令串粒度；hindsight 条目由其安装器管理）
console.log('\n-- 用户级 hooks 注册（~/.zcode/cli/config.json；只报告）--');
try {
  const tpl = JSON.parse(read(join(repo, 'templates/user-config-hooks-template.json')));
  const live = JSON.parse(read(join(HOME, '.zcode', 'cli', 'config.json')));
  const liveCmds = new Set();
  for (const ev of Object.values(live?.hooks?.events ?? {}))
    for (const grp of ev) for (const hk of grp.hooks ?? []) liveCmds.add(hk.command);
  for (const ev of Object.values(tpl.hooks.events))
    for (const grp of ev) for (const hk of grp.hooks ?? []) {
      if (liveCmds.has(hk.command)) console.log(`[OK]   已注册 ${hk.statusMessage ?? hk.command}`);
      else { console.log(`[MISS] 注册缺失：${hk.command}`); drift++; }
      const m = hk.command.match(/"([^"]+\.mjs)"/);              // 顺带断言脚本文件在位
      if (m && !existsSync(m[1])) { console.log(`[MISS] 脚本不存在：${m[1]}`); drift++; }
    }
} catch (e) { console.log(`[WARN] config 比对失败：${e.message}`); drift++; }

// 4) 项目盘点（结构在位 + AGENTS 模板基线对照；只报告）
for (const P of PROJECTS) {
  console.log(`\n-- 项目盘点：${P}（只报告）--`);
  for (const rel of ['AGENTS.md', '.zcode/config.json', '.zcode/memory-project', 'docs/specs', 'docs/tickets', 'docs/reviews']) {
    const ok = existsSync(join(P, rel));
    console.log(`${ok ? '[OK]  ' : '[MISS]'} ${rel}`);
    if (!ok) drift++;
  }
  console.log(`${existsSync(join(P, 'docs/changes')) ? '[OK]  ' : '[INFO]'} docs/changes（瞬态：三段链消费后清空，缺失不计漂移）`);
  try {
    const gitAt = (cwd, f) => execFileSync('git', ['-C', cwd, 'log', '-1', '--format=%ad', '--date=short', '--', f], { encoding: 'utf8' }).trim();
    const tplDate = gitAt(repo, 'templates/AGENTS-template.md');
    const agDate = gitAt(P, 'AGENTS.md');
    if (tplDate > agDate) { console.log(`[REVIEW] AGENTS 模板基线 ${tplDate} 晚于项目宪法定稿 ${agDate}——模板有未吸收更新，人工对照`); drift++; }
    else console.log(`[OK]   宪法定稿 ${agDate} ≥ 模板基线 ${tplDate}`);
  } catch { console.log('[WARN] 模板基线比对失败（git 不可用？）'); }
}

// 尾声
if (apply && rolesOrModelsChanged)
  console.log('\n⚠️ 角色/路由表已更新：node ~/.zcode/tools/generate-role-variants.mjs 重铸变体，然后新开会话生效（C1 快照）。');
if (apply && applied) console.log(`已同步 ${applied} 项。`);
console.log(drift === 0
  ? '\n✔ 全部一致（自动集 + hooks 执行位 + 注册 + 项目结构）'
  : `\n✘ 待处理 ${drift} 项${apply ? '（剩余均为人工项：hooks 执行位 / 注册 / 项目结构）' : '（--apply 可同步自动集部分）'}`);
process.exit(drift === 0 ? 0 : 1);
