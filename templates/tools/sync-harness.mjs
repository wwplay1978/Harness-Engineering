// sync-harness.mjs — N11 规范分发自动化（REPO templates/ → 用户域部署位）
// 用法：
//   node templates/tools/sync-harness.mjs            默认 --check：只读报告（有漂移 exit 1）
//   node templates/tools/sync-harness.mjs --apply    同步【自动集】到用户域（写后回读校验）
// 设计要点（docs/14 缺口 A，2026-09-05；2026-09-07 落点修补）：
//   - 单一事实来源 = 本仓库 templates/；用户域文件均为部署副本
//   - hooks 脚本执行位 = 用户域 ~/.zcode/hooks/harness/（config.json 注册路径；2026-09-07 起
//     不再指向任何仓库目录）**只报告、永不代写**：AI 可改 templates 源（guard 白名单内），若
//     脚本自动传播即等于 AI 可换掉运行中的 guard 自毁防线——该路径必须过人手（docs/05 §3；
//     运行中的执行位另受 guard 自防御条款物理保护）
//   - rerun 变体（*-rerun.md）是 generate-role-variants.mjs 的编译产物：不入清单、不删除
//   - 用户级 config.json / 项目 AGENTS.md 同为只报告（前者混有 hindsight 等非本仓库内容，
//     后者是人工宪法）
//   - 项目盘点清单外置 ~/.zcode/harness-projects.json（机器本地数据不进模板）：缺失自动
//     建空清单并告警；损坏降级跳过并提示——均不计静默绿
//   - 尾段机器锚点扫描 = 投产消费面 tripwire（templates/ + docs/07/16/17/18；历史记录类
//     文档不入扫描面），命中即计入漂移由人判定
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const repo = join(import.meta.dirname, '..', '..');   // templates/tools/ → 仓库根
const HOME = homedir();
const SELF = join(repo, 'templates', 'tools', 'sync-harness.mjs');
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

// 2) hooks 执行位（config.json 实际执行用户域部署位；仓库内执行位已于 2026-09-07 退役）
console.log('\n-- hooks 执行位（用户域 ~/.zcode/hooks/harness/；只报告，人工同步）--');
for (const h of HOOKS) {
  const srcAbs = join(repo, 'templates', 'hooks', `${h}.mjs`);   // 绝对路径——脚本可从任意 cwd 运行
  const dst = join(HOME, '.zcode', 'hooks', 'harness', `${h}.mjs`);
  if (read(srcAbs) === read(dst)) { console.log(`[SAME]  ${h}.mjs`); continue; }
  drift++;
  console.log(read(dst) === null
    ? `[MISS]  ${h}.mjs 执行位不存在：${dst}`
    : `[DRIFT] ${h}.mjs：templates 源 ≠ 执行位`);
  console.log(`        人工执行（勿让 AI 代跑）：cp "${srcAbs}" "${dst.replace(/\//g, '\\')}"`);
}

// 3) 用户级 config.json 三正式注册核对（模板 __HOME__ 按 homedir 展开后精确比对；
//    hindsight 条目由其安装器管理，不入比对）
console.log('\n-- 用户级 hooks 注册（~/.zcode/cli/config.json；只报告）--');
try {
  const tplRaw = read(join(repo, 'templates/user-config-hooks-template.json'))
    .replace(/__HOME__/g, HOME.split('\\').join('/'));
  const tpl = JSON.parse(tplRaw);
  const live = JSON.parse(read(join(HOME, '.zcode', 'cli', 'config.json')));
  const liveCmds = new Set();
  for (const ev of Object.values(live?.hooks?.events ?? {}))
    for (const grp of ev) for (const hk of grp.hooks ?? []) liveCmds.add(hk.command);
  for (const ev of Object.values(tpl.hooks.events))
    for (const grp of ev) for (const hk of grp.hooks ?? []) {
      if (liveCmds.has(hk.command)) console.log(`[OK]   已注册 ${hk.statusMessage ?? hk.command}`);
      else { console.log(`[MISS] 注册缺失/路径不符：期望 ${hk.command}`); drift++; }
      const m = hk.command.match(/"([^"]+\.mjs)"/);              // 顺带断言脚本文件在位
      if (m && !existsSync(m[1])) { console.log(`[MISS] 脚本不存在：${m[1]}`); drift++; }
    }
} catch (e) { console.log(`[WARN] config 比对失败：${e.message}`); drift++; }

// 4) 项目盘点（结构在位 + AGENTS 模板基线对照；只报告；清单外置见文件头说明）
const projFile = join(HOME, '.zcode', 'harness-projects.json');
let PROJECTS = [];
if (!existsSync(projFile)) {
  PROJECTS = [];                                                 // 机器本地数据不入模板——首跑建空清单，人自行补
  writeFileSync(projFile, JSON.stringify(PROJECTS, null, 2) + '\n');
  console.log(`\n[WARN] 项目清单缺失，已创建空清单 → ${projFile}（把项目根路径加入数组后重跑，如 ["C:/project/<name>"]）`);
} else {
  try { PROJECTS = JSON.parse(readFileSync(projFile, 'utf8')); } catch { PROJECTS = null; }
  if (!Array.isArray(PROJECTS)) {
    console.log(`\n[WARN] ${projFile} 缺失或不是 JSON 数组——项目盘点本轮跳过（人工修复，不计静默绿）`);
    drift++; PROJECTS = [];
  }
}
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
    // 模板基线读 AGENTS-template 头部 constitution-affecting-baseline 标记（仅宪法相关变更时人工更新；
    // 渲染机制类/新装默认类改动不触发——按 git 提交日比会把它们误标为各项目"未吸收更新"，AITrader2 首装实证 2026-09-08）；
    // 标记缺失回退 git 日期（宁可误报不可漏报）
    const tplM = readFileSync(join(repo, 'templates', 'AGENTS-template.md'), 'utf8')
      .match(/constitution-affecting-baseline:\s*(\d{4}-\d{2}-\d{2})/);
    const tplDate = tplM ? tplM[1] : gitAt(repo, 'templates/AGENTS-template.md');
    const agDate = gitAt(P, 'AGENTS.md');
    const src = tplM ? '标记' : 'git 回退';
    if (tplDate > agDate) { console.log(`[REVIEW] 宪法基线 ${tplDate}（${src}）晚于项目宪法定稿 ${agDate}——模板有未吸收的宪法级更新，人工对照`); drift++; }
    else console.log(`[OK]   宪法定稿 ${agDate} ≥ 模板基线 ${tplDate}（${src}）`);
  } catch { console.log('[WARN] 模板基线比对失败（git 不可用？）'); }
}

// 5) 机器锚点扫描（投产消费面 tripwire；本文件自排除；命中计入漂移由人判定）
//    模式经 new RegExp 拼接构造——正则字面量本身含个人串，会随公开仓外流（08 教训）
console.log('\n-- 机器锚点扫描（templates/**（除 dist）+ docs/07/16/17/18；只报告）--');
const ANCHORS = [
  new RegExp('mark' + 'liu', 'i'),
  /\/c\/users/i,
  new RegExp('c:/for' + 'ex', 'i'),
  new RegExp('c:\\\\for' + 'ex', 'i'),
  new RegExp('zcode' + '_t1', 'i'),
];
const scanFiles = [];
const walk = d => {
  for (const e of readdirSync(d)) {
    const f = join(d, e);
    if (statSync(f).isDirectory()) { if (e !== 'dist' && e !== 'node_modules') walk(f); }
    else if (f !== SELF) scanFiles.push(f);
  }
};
walk(join(repo, 'templates'));
for (const d of ['docs/07-migration-playbook.md', 'docs/16-host-agnostic-installer.md', 'docs/17-agent-assisted-install.md', 'docs/18-host-adapters.md'])
  scanFiles.push(join(repo, d));
let anchors = 0;
for (const f of scanFiles) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((ln, i) => {
    if (ANCHORS.some(re => re.test(ln))) {
      anchors++;
      console.log(`[ANCHOR] ${relative(repo, f)}:${i + 1}: ${ln.trim().slice(0, 110)}`);
    }
  });
}
if (anchors) { drift += anchors; console.log(`共 ${anchors} 处候选——逐条人工判定（历史示例合法提及可豁免）`); }
else console.log('[OK]   消费面零机器锚点');

// 尾声
if (apply && rolesOrModelsChanged)
  console.log('\n⚠️ 角色/路由表已更新：node ~/.zcode/tools/generate-role-variants.mjs 重铸变体，然后新开会话生效（C1 快照）。');
if (apply && applied) console.log(`已同步 ${applied} 项。`);
console.log(drift === 0
  ? '\n✔ 全部一致（自动集 + hooks 执行位 + 注册 + 项目结构 + 锚点扫描）'
  : `\n✘ 待处理 ${drift} 项${apply ? '（剩余均为人工项：hooks 执行位 / 注册 / 项目结构 / 锚点）' : '（--apply 可同步自动集部分）'}`);
process.exit(drift === 0 ? 0 : 1);
