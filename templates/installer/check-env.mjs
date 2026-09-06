// check-env.mjs — 阶段一环境检测器（只读，不改任何系统状态）
// 产出（当前目录）：env-config.json（检测+分级+适配建议）、hindsight-params.cmd（安装参数，不含 key）
// 用法：node check-env.mjs [--vault <vault路径>] [--project <项目根>]
// 设计：Zcode_T1/docs/16-host-agnostic-installer.md（三段式：检测→安装→适配）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const args = process.argv.slice(2);
const argOf = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

// 产出目录：CWD 在任何 git 工作树内时自动改写 %TEMP%\harness-install（防把运行产物卷进仓库提交）
let OUTDIR = process.cwd();
{
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000 });
  if (r.status === 0 && (r.stdout || '').trim()) {
    OUTDIR = join(HOME, 'AppData', 'Local', 'Temp', 'harness-install');
    mkdirSync(OUTDIR, { recursive: true });
    console.log(`[注意] 当前目录位于 git 工作树内（${(r.stdout || '').trim()}）——产物改写到 ${OUTDIR}\n`);
  }
}

// ── 小工具 ─────────────────────────────────────────────
const run = (cmd, cmdArgs, opts = {}) => {
  try { return spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 15000, ...opts }); }
  catch { return { status: 1, stdout: '', stderr: '' }; }
};
// Windows：npm/全局 CLI 是 .cmd 壳，须经 cmd /c 调用
const runCmdShim = (name, cmdArgs = []) => run('cmd', ['/c', name, ...cmdArgs]);
const ver = r => (r.stdout || '').trim().split('\n')[0].trim();
const ok = c => ({ ok: !!c });
const out = { generatedAt: new Date().toISOString(), host: { home: HOME } };

console.log('== 阶段一：环境检测（只读）==\n');

// ── 1) 运行时 ───────────────────────────────────────────
const rt = {};
for (const t of ['git', 'node', 'python', 'uv']) {
  const r = run(t, ['--version']);
  rt[t] = { ...ok(r.status === 0), version: r.status === 0 ? ver(r) : null };
  console.log(`[运行时] ${t.padEnd(7)} ${rt[t].ok ? '✓ ' + rt[t].version : '✗ 未安装'}`);
}
const npmLs = runCmdShim('npm', ['-v']);
rt.npm = { ...ok(npmLs.status === 0), version: npmLs.status === 0 ? ver(npmLs) : null };
out.runtimes = rt;

// ── 2) 宿主（AI coding 工具）────────────────────────────
const HOST_CANDIDATES = [
  { name: 'zcode', dirs: [join(HOME, '.zcode')], config: join(HOME, '.zcode', 'cli', 'config.json'), adapted: '已适配（六票实证，C1/C2/C3 结论见 08）' },
  { name: 'claude-code', dirs: [join(HOME, '.claude'), join(HOME, '.claude.json')], config: join(HOME, '.claude', 'settings.json'), adapted: '未适配（同族 schema，按 docs/16 §2 四步重验）' },
  { name: 'kimi-code', dirs: [join(HOME, '.kimi-code'), join(HOME, '.kimicode')], config: null, adapted: '未适配（AITrader 基座实证，frontmatter 见 02 §3）' },
  { name: 'codex', dirs: [join(HOME, '.codex')], config: join(HOME, '.codex', 'config.toml'), adapted: '未适配（hooks 面以 sandbox/approval 为主，guard 需重设计，见 16 §2）' },
  { name: 'opencode', dirs: [join(HOME, '.config', 'opencode'), join(HOME, '.opencode')], config: null, adapted: '未适配（agents/权限模型与阻断语义待核验，见 16 §2）' },
  { name: 'pi-agent', dirs: [join(HOME, '.pi')], config: null, adapted: '未证实——按 docs/16 §2 矩阵自查后四步' },
  { name: 'deepseek-harness', dirs: [], config: null, adapted: '未适配（框架型宿主不驻留用户目录，探测恒"未发现"属预期；适配=打包为其插件，见 16 §2）' },
];
out.hosts = [];
for (const h of HOST_CANDIDATES) {
  const present = h.dirs.some(d => existsSync(d));
  const cfg = h.config ? existsSync(h.config) : null;
  out.hosts.push({ name: h.name, present, configPresent: cfg, adapted: h.adapted });
  console.log(`[宿主]   ${h.name.padEnd(12)} ${present ? '✓ 在位' + (cfg === false ? '（config 未初始化）' : '') : '— 未发现'}  适配态：${h.adapted}`);
}
const adaptedHost = out.hosts.find(h => h.present && h.name === 'zcode');

// ── 3) hindsight 服务 ───────────────────────────────────
let hindsight = { reachable: false, service: false, exe: false };
try {
  const r = await fetch('http://localhost:8888/health', { signal: AbortSignal.timeout(3000) });
  hindsight.reachable = r.ok;
} catch {}
const scR = run('sc', ['query', 'hindsight']);
hindsight.service = /RUNNING|STOPPED|START_PENDING/i.test(scR.stdout || '');
const exePath = join(HOME, 'AppData', 'Roaming', 'uv', 'tools', 'hindsight-api', 'Scripts', 'hindsight-api.exe');
hindsight.exe = existsSync(exePath);
console.log(`[组件]   hindsight   API ${hindsight.reachable ? '✓ 200' : '✗ 不可达'} | 服务 ${hindsight.service ? '✓' : '✗'} | 程序 ${hindsight.exe ? '✓' : '✗'}`);
out.components = { hindsight };

// hindsight hooks 注册态（用户级 zcode config；仅已适配宿主 zcode 在位时探测）
let hindsightHooks = 0, formalHooks = 0, hooksProbed = false;
if (adaptedHost && existsSync(join(HOME, '.zcode', 'cli', 'config.json'))) {
  try {
    const c = JSON.parse(readFileSync(join(HOME, '.zcode', 'cli', 'config.json'), 'utf8'));
    for (const ev of Object.values(c?.hooks?.events ?? {}))
      for (const g of ev) for (const h of g.hooks ?? []) {
        if (/hindsight/i.test(h.command)) hindsightHooks++;
        if (/guard-worktree|inject-memory|report-worktrees/.test(h.command)) formalHooks++;
      }
    hooksProbed = true;
  } catch {}
}
console.log(`[hooks]  正式三件 ${hooksProbed ? formalHooks + '/3' : '（宿主未适配，注册位待定）'} | hindsight ${hindsightHooks}/3`);

// ── 4) 团队记忆 / 编排 / 技能 / 同步 CLI ────────────────
const uvList = run('uv', ['tool', 'list']).stdout || '';
const bm = uvList.match(/basic-memory v([\d.]+)/);
out.components.basicMemory = { ...ok(!!bm), version: bm ? bm[1] : null };
const gtr = run('git', ['config', '--global', 'alias.gtr']);
out.components.gtr = ok(gtr.status === 0 && (gtr.stdout || '').trim() !== '');
const syncHelp = runCmdShim('hindsight-obsidian-sync', ['--help']);
out.components.obsidianSync = ok(syncHelp.status === 0);
const ANCHORS = ['grill-with-docs', 'to-spec', 'to-tickets', 'tdd', 'code-review', 'diagnosing-bugs'];
const skillsDir = join(HOME, '.agents', 'skills');
out.components.skills = { ...ok(ANCHORS.every(a => existsSync(join(skillsDir, a)))), dir: skillsDir };
const rolesDir = join(HOME, '.zcode', 'agents');
if (existsSync(rolesDir)) {
  const list = run('cmd', ['/c', 'dir', '/b', rolesDir + '\\*.md']).stdout.split('\r\n').filter(x => x.endsWith('.md'));
  out.components.roles = { base: list.filter(f => !f.includes('rerun')).length, rerun: list.filter(f => f.includes('rerun')).length };
} else out.components.roles = { base: 0, rerun: 0 };
console.log(`[组件]   basic-memory ${out.components.basicMemory.ok ? '✓ v' + out.components.basicMemory.version : '✗'} | gtr ${out.components.gtr.ok ? '✓' : '✗'} | sync CLI ${out.components.obsidianSync.ok ? '✓' : '✗'}`);
console.log(`[组件]   skills ${out.components.skills.ok ? '✓ 6 锚点齐' : '✗ 缺锚点'} | 角色 base ${out.components.roles.base}/6 rerun ${out.components.roles.rerun}/3`);

// ── 5) Obsidian vault（三区语义）────────────────────────
const vaultArg = argOf('--vault');
const vaultPath = vaultArg || join(HOME, 'Documents', 'MyObsidian');
const zones = ['30-知识库/50-ZCODE', '50-项目库/30-ZCODE', '70-工作区/10-ZCODE'].map(z => ({ zone: z, exists: existsSync(join(vaultPath, ...z.split('/'))) }));
out.components.obsidian = { vaultPath, exists: existsSync(vaultPath), zones };
console.log(`[组件]   Obsidian vault ${out.components.obsidian.exists ? '✓ ' + vaultPath : '✗ ' + vaultPath + '（可用 --vault 指定）'}`);
out.hooks = { formalRegistered: formalHooks, hindsightRegistered: hindsightHooks };

// ── 6) 目标项目（可选）──────────────────────────────────
const projArg = argOf('--project');
if (projArg) {
  const P = { path: projArg, agents: existsSync(join(projArg, 'AGENTS.md')), mcp: existsSync(join(projArg, '.zcode', 'config.json')), marker: existsSync(join(projArg, '.zcode', 'memory-project')) };
  for (const d of ['specs', 'tickets', 'reviews', 'changes']) P['docs_' + d] = existsSync(join(projArg, 'docs', d));
  out.project = P;
  console.log(`[项目]   ${projArg}: AGENTS ${P.agents ? '✓' : '✗'} | MCP ${P.mcp ? '✓' : '✗'} | marker ${P.marker ? '✓' : '✗'} | docs 四目录 ${['specs','tickets','reviews','changes'].filter(d => P['docs_' + d]).length}/4`);
}

// ── 7) profile 分级 + 适配建议（docs/16 §4 矩阵）────────
const C = out.components;
const profile =
  rt.node.ok && formalHooks === 3 && C.basicMemory.ok && C.hindsight.reachable && C.obsidian.exists && C.obsidianSync.ok ? 'full' :
  rt.node.ok && C.basicMemory.ok ? 'core-plus' : 'minimal';
const adaptation = [];
if (!rt.node.ok) adaptation.push('Node 缺失：宪法写入隔离改纪律条款；三 hooks 不注册；合并前白名单对照升为主防线（16 §4）');
if (rt.node.ok && hooksProbed && formalHooks < 3) adaptation.push(`物理防线不完整：三正式 hooks 仅注册 ${formalHooks}/3（guard 写入隔离/inject 记忆注入/report 分支提醒缺 ${3 - formalHooks} 项）——补齐或接受纪律降级（16 §4）`);
else if (rt.node.ok && !hooksProbed) adaptation.push('hooks 注册态未探测（无已适配宿主 zcode）：异宿主下 guard/inject/report 的注册位待适配器确定（16 §2 ②），当前按纪律约束运行');
if (!C.hindsight.reachable) adaptation.push('hindsight 缺失：宪法"个体记忆"行删；recall/retain/session hooks 不注册；检索=Obsidian 直读+basic-memory');
if (!C.obsidian.exists) adaptation.push('vault 缺失：知识库节降级为 git docs 唯一知识源；archiver SOP 第 4 步跳过 Obsidian 草稿');
else if (!C.obsidianSync.ok) adaptation.push('sync CLI 缺失：archiver 第 4 步只写草稿并记"reconcile 未执行"');
if (!C.basicMemory.ok) adaptation.push('basic-memory 缺失：MCP 段裁剪；inject hook 不注册；记忆交付物改记 docs/');
if (!C.gtr.ok) adaptation.push('gtr 缺失：宪法 worktree 命令改原生 git worktree 三件套');
if (!C.skills.ok) adaptation.push('skills 缺失：角色 Anchors 降级为角色文件内 SOP（建议安装）');
if (!adaptedHost) adaptation.push('未发现已适配宿主：按 docs/16 §2 四步完成宿主适配后再启用流水线');
out.profile = profile;
out.adaptation = adaptation;

// ── 8) 产出参数文件（不含任何 key）──────────────────────
const py = rt.python.ok ? 'python' : 'py';
out.params = {
  home: HOME, hindsightDir: join(HOME, '.hindsight'),
  nssm: join(HOME, '.hindsight', 'bin', 'nssm.exe'),
  exe: exePath, logDir: join(HOME, '.hindsight', 'logs'),
  modelsDir: join(HOME, '.hindsight', 'models'),
  pythonLauncher: py,
  llmBaseUrl: 'https://api.z.ai/api/coding/paas/v4', llmModel: 'glm-5.3-flash',
  apiPort: 8888, vaultPath,
  keySources: '环境变量(ZAI_API_KEY/ZHIPU_API_KEY) > HKCU\\Environment > 安装时交互输入（永不落盘）',
};
const paramsCmd = [
  '@echo off',
  'REM 由 check-env.mjs 生成（阶段一产出）——仅路径类参数，不含任何 key。安装脚本运行时读取。',
  `set "HSDIR=${out.params.hindsightDir}"`,
  `set "NSSM=${out.params.nssm}"`,
  `set "HINDSIGHT_EXE=${out.params.exe}"`,
  `set "LOGDIR=${out.params.logDir}"`,
  `set "MODELS_DIR=${out.params.modelsDir}"`,
  `set "LLM_BASE_URL=${out.params.llmBaseUrl}"`,
  `set "LLM_MODEL=${out.params.llmModel}"`,
  `set "API_PORT=${out.params.apiPort}"`,
  `set "PYTHON_UTF8=1"`,
].join('\r\n') + '\r\n';
writeFileSync(join(OUTDIR, 'hindsight-params.cmd'), paramsCmd);
writeFileSync(join(OUTDIR, 'env-config.json'), JSON.stringify(out, null, 2) + '\n');

// 阶段三交付物：适配清单（人可读，对照 docs/16 §4 矩阵逐条落地）
const planLines = [
  '# adaptation-plan（阶段三适配清单）',
  '',
  '- 生成：check-env.mjs ' + out.generatedAt,
  '- profile：**' + profile + '**',
  '- 用法：按下面清单逐条核对该机宪法条款 / hooks 注册集 / MCP 段 / archiver SOP 步骤的开关；矩阵依据 docs/16 §4，降级语义 docs/15 §1。',
  '',
  '## 待适配项（缺失组件 → 工作流改动）',
  ...(adaptation.length ? adaptation.map((a, i) => `${i + 1}. ${a}`) : ['无——全组件在位，按全量配置（full profile）运行，无需任何降级改动。']),
  '',
  '## 已在位组件（勿降级）',
  `- 物理防线（guard 三 hooks）：${hooksProbed ? (formalHooks === 3 ? '✓ 注册齐 3/3' : formalHooks + '/3（缺失，注意补齐）') : '未探测（无已适配宿主，注册位待适配器确定）'}`,
  `- 团队记忆 basic-memory：${C.basicMemory.ok ? '✓ v' + C.basicMemory.version : '✗'}`,
  `- 个体记忆 hindsight：${C.hindsight.reachable ? '✓ 服务在跑' : '✗'}`,
  `- Obsidian vault：${C.obsidian.exists ? '✓ ' + C.obsidian.vaultPath : '✗'}`,
  `- vault→bank 同步 CLI：${C.obsidianSync.ok ? '✓' : '✗'}`,
  `- 角色文件：base ${out.components.roles.base}/6 · rerun ${out.components.roles.rerun}/3`,
  '',
  '## 该机安装参数（同步于 hindsight-params.cmd；key 不在其中，安装时另行读取）',
  ...Object.entries({ HSDIR: out.params.hindsightDir, MODELS_DIR: out.params.modelsDir, API_PORT: out.params.apiPort, LLM_BASE_URL: out.params.llmBaseUrl, LLM_MODEL: out.params.llmModel }).map(([k, v]) => `- ${k} = ${v}`),
];
writeFileSync(join(OUTDIR, 'adaptation-plan.md'), planLines.join('\n') + '\n');

console.log('\n== 结果 ==');
console.log('profile:', profile, '（判级条件与待适配项见 adaptation-plan.md，不在此重复描述，避免文字与判定逻辑脱节）');
console.log('待适配项:', adaptation.length ? adaptation.length + ' 条（详见 adaptation-plan.md）' : '无——全组件与物理防线在位');
console.log(`已产出: env-config.json / hindsight-params.cmd / adaptation-plan.md → ${OUTDIR}`);
console.log('下一步: 按 docs/16 §3 阶段二安装（hindsight 用 install-hindsight-service.cmd --rehearse 先预演）');
