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
//     后者是人工宪法）——v3 起项目宪法与零参数模板做逐字节恒等比对（normalize=LF+strip BOM），
//     日期基线（constitution-affecting-baseline）退役
//   - 项目盘点清单外置 ~/.zcode/harness-projects.json（机器本地数据不进模板）：缺失自动
//     建空清单并告警；损坏降级跳过并提示——均不计静默绿
//   - v3 机器配置检测（spec 19 §3.4）：在册项目非空而 ~/.agents/Harness-Configuration/
//     配置缺失=[FAIL]；hash 快照（~/.zcode/harness-config-state.json，含全文 base64 兼误删
//     恢复）检测"改而未补修订记录"=[WARN]；项目级 harness.config.md 做 schema 必填键校验
//   - 尾段机器锚点扫描 = 投产消费面 tripwire（templates/ + docs/07/16/17/18；历史记录类
//     文档不入扫描面），命中即计入漂移由人判定
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';

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

// 4) 项目盘点（v3：宪法恒等 + 两级配置校验；constitution-affecting-baseline 日期基线退役——
//    零参数制下模板与项目宪法应逐字节恒等，内容比对零歧义；清单外置见文件头说明）
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
const norm = s => (s ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const tplAgents = norm(readFileSync(join(repo, 'templates', 'AGENTS-template.md'), 'utf8'));
const MC_DIR = join(HOME, '.agents', 'Harness-Configuration');
const parseCfg = f => {  // 配置表格解析（spec 19 §3.1 解析约定：表头识别、仅表格内行、三列取二）
  const txt = read(f); if (txt === null) return null;
  const out = {}; let inTable = false;
  for (const ln of txt.split('\n')) {
    if (/^\|\s*键\s*\|\s*值\s*\|\s*说明\s*\|/.test(ln)) { inTable = true; continue; }
    if (!/^\|/.test(ln)) { inTable = false; continue; }
    if (!inTable) continue;
    const m = ln.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/); if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
};
// 4a) 机器配置：在册丢失 FAIL + hash 快照"改而未记"WARN（快照含全文 base64，兼误删恢复副本；spec 19 §3.4）
const stateFile = join(HOME, '.zcode', 'harness-config-state.json');
let state = {}; try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
const { createHash } = await import('node:crypto');
const hashOf = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const lastRev = t => {  // 修订记录表（| 日期 | 变更 | 动机 |）末行首列
  const rows = t.split('\n').filter(l => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
  return rows.length ? rows[rows.length - 1].slice(0, 40).trim() : '';
};
console.log('\n-- 机器配置（~/.agents/Harness-Configuration/）--');
const commonPath = join(MC_DIR, 'common.config.md');
const mcFiles = existsSync(MC_DIR) ? readdirSync(MC_DIR).filter(e => e.endsWith('.config.md')).map(e => join(MC_DIR, e)) : [];
const fleetActive = PROJECTS.length > 0;
if (fleetActive && !mcFiles.length) {
  console.log('[FAIL] 在册项目非空而机器配置全缺（common/host 均无）——按安装 S5 或升级手册阶段 1 生成；快照可恢复：见 ~/.zcode/harness-config-state.json');
  drift++;
}
for (const f of Object.keys(state)) if (state[f]?.tracked && !existsSync(f)) {
  console.log(`[FAIL] 曾在册机器配置缺失：${f}（快照含全文，人工解码恢复——工具只提示不自动写回）`); drift++;
}
if (!mcFiles.length && !fleetActive) console.log('[INFO] 机器配置目录为空（未装机/首装前——正常）');
for (const f of mcFiles) {
  const t = read(f) ?? ''; const h = hashOf(t); const rev = lastRev(t); const prev = state[f];
  const snap = { hash: h, rev, tracked: true, content: Buffer.from(t, 'utf8').toString('base64') };
  if (!prev) console.log(`[INIT]   ${relative(MC_DIR, f)} 首入快照`);
  else if (prev.hash !== h && prev.rev === rev) { console.log(`[WARN]   ${relative(MC_DIR, f)} 内容已改而修订记录末行未变——补记一行（| 日期 | 变更 | 动机 |）`); drift++; }
  state[f] = snap;
}
writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
for (const P of PROJECTS) {
  console.log(`\n-- 项目盘点：${P}（只报告）--`);
  for (const rel of ['AGENTS.md', '.zcode/config.json', '.zcode/memory-project', 'harness.config.md', 'docs/specs', 'docs/tickets', 'docs/reviews']) {
    const ok = existsSync(join(P, rel));
    console.log(`${ok ? '[OK]  ' : '[MISS]'} ${rel}`);
    if (!ok && rel !== 'harness.config.md') drift++;          // harness.config.md 缺失单独判定（旧制项目预期中）
    if (!ok && rel === 'harness.config.md') drift++;          // v3 起必备——计漂移，判级见下
  }
  console.log(`${existsSync(join(P, 'docs/changes')) ? '[OK]  ' : '[INFO]'} docs/changes（瞬态：三段链消费后清空，缺失不计漂移）`);
  const ag = read(join(P, 'AGENTS.md'));
  if (ag !== null) {
    if (norm(ag) === tplAgents) console.log('[OK]   宪法与零参数模板逐字节恒等（LF+BOM 归一后）');
    else if (norm(ag).split('\n')[0] === tplAgents.split('\n')[0]) { console.log('[DRIFT] 宪法首行同源但正文与模板不一致——零参数制下任何差异=宪法漂移，人工对照'); drift++; }
    else { console.log('[MIGRATE] 宪法仍为旧制（span 渲染版）——按 spec 19 §6 阶段 2 升级（先建 harness.config.md 再 cp 新模板）'); }
  }
  const pc = parseCfg(join(P, 'harness.config.md'));
  if (pc === null) console.log('[MISS] harness.config.md 缺失或不可解析（v3 必备，schema 见 spec 19 §3.1——人工生成，agent 勿臆造）');
  else {
    const miss = ['schema', 'project_name'].filter(k => !(k in pc));
    if (miss.length) { console.log(`[FAIL] harness.config.md 缺必填键：${miss.join(', ')}（fail-loud，人工补齐）`); drift++; }
    else console.log(`[OK]   项目配置 schema 在位（project_name=${pc.project_name}）`);
    const mc = parseCfg(commonPath); const vr = mc?.vault_root;
    if (vr) {
      const vp = vr.replace(/^~(?=\/|\\|$)/, HOME);
      if (existsSync(vp)) console.log(`[OK]   vault_root 可达：${vp}`);
      else { console.log(`[WARN] vault_root 不存在：${vp}（三区尚未建立属允许态，报告提示）`); drift++; }
    }
  }
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
  ? '\n✔ 全部一致（自动集 + hooks 执行位 + 注册 + 宪法恒等 + 配置校验 + 锚点扫描）'
  : `\n✘ 待处理 ${drift} 项${apply ? '（剩余均为人工项：hooks 执行位 / 注册 / 项目结构 / 配置 / 锚点）' : '（--apply 可同步自动集部分）'}`);
process.exit(drift === 0 ? 0 : 1);
