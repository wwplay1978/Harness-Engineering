// build-adapters.mjs — 六角色模板 → 五宿主适配文件物化器（N18，docs/18-host-adapters.md）
// 用法：node templates/adapters/build-adapters.mjs [--out <目录>]
// 产物：默认 templates/adapters/dist/（git 忽略）——
//   claude-code/agents/*.md   kimi-code/agents/*.md   codex/{agents/*.toml,prompts/*.md}
//   opencode/agents/*.md      pi-agent/prompts/*.md
// 纪律：只物化角色文件；hooks/守护注册永远人手（05 §3 人闸），粘贴块在各宿主子目录 README。
// 自检：每份产物写后回读正向断言；未知 frontmatter 键大声告警（防静默丢失）。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS = resolvePath(HERE, '..', 'agents');
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? resolvePath(process.argv[i + 1]) : join(HERE, 'dist');
})();

const die = m => { console.error('[FAIL] ' + m); process.exit(1); };
if (!existsSync(AGENTS)) die('角色模板目录缺失: ' + AGENTS);

// ── 极简 frontmatter 解析（只认 templates/agents 实际使用的键）──────────
function parseRole(file) {
  const src = readFileSync(join(AGENTS, file), 'utf8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) die(file + ': frontmatter 缺失');
  const fm = { name: '', description: '', tools: [], disallowedTools: [] };
  const unknown = [];
  let cur = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (cur && /^\s*-\s+/.test(line)) { fm[cur].push(line.replace(/^\s*-\s+/, '').trim()); continue; }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, raw] = kv;
    if (k === 'tools' || k === 'disallowedTools') {
      cur = k;
      if (raw) fm[k] = raw.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    } else {
      cur = null;
      if (k in fm) fm[k] = raw.replace(/^["']|["']$/g, '');
      else { unknown.push(k); }
    }
  }
  if (!fm.name || !fm.description) die(file + ': name/description 缺失');
  if (unknown.length) console.log(`[WARN] ${file}: 未知 frontmatter 键被丢弃: ${unknown.join(', ')}`);
  return { fm, body: src.slice(m[0].length).trimStart() };
}

const yamlList = (k, arr) => k + ':\n' + arr.map(t => '  - ' + t).join('\n') + '\n';
const q = s => { if (s.includes('"')) die('description 含双引号，YAML 再引出需转义（当前模板约定不含）'); return '"' + s + '"'; };

// ── 各宿主物化规则（判级依据见 docs/18 §2–§6）─────────────────────────
const yamlAgentHosts = {
  // 同族 schema：name/description/tools/disallowedTools 全保留（disallowedTools 生效性为装机验证项）
  'claude-code': {
    dir: 'agents',
    note: '> 适配说明（claude-code，docs/18 §2）：放置 ~/.claude/agents/，新会话生效；写入隔离由 PreToolUse guard 粘贴块（templates/adapters/claude-code/）承担；disallowedTools 的物理生效性是装机验证项；正文内 ZCode 专有措辞为模板原文，物理强制形态以本说明为准。\n\n',
    emit: fm => `---\nname: ${fm.name}\ndescription: ${q(fm.description)}\n` +
      (fm.tools.length ? yamlList('tools', fm.tools) : '') +
      (fm.disallowedTools.length ? yamlList('disallowedTools', fm.disallowedTools) : '') + '---\n\n',
  },
  // Kimi 契约官方文档实证：name/description/whenToUse/tools/disallowedTools；model 键不支持（忽略）
  'kimi-code': {
    dir: 'agents',
    note: '> 适配说明（kimi-code，docs/18 §3）：放置 ~/.kimi-code/agents/ 或跨工具共享 ~/.agents/agents/；agent frontmatter 不支持 model 键——rerun 重跑路由改由会话 -m 指定模型；hooks 注册于 ~/.kimi-code/config.toml（粘贴块见 templates/adapters/kimi-code/）；正文内 ZCode 专有措辞为模板原文，物理强制形态以本说明为准。\n\n',
    emit: fm => `---\nname: ${fm.name}\ndescription: ${q(fm.description)}\n` +
      (fm.tools.length ? yamlList('tools', fm.tools) : '') +
      (fm.disallowedTools.length ? yamlList('disallowedTools', fm.disallowedTools) : '') + '---\n\n',
  },
  // OpenCode：description 必填 + mode: subagent；tools 键已标 deprecated（保留但装机验证 permission 键替代方案）
  'opencode': {
    dir: 'agents',
    note: '> 适配说明（opencode，docs/18 §5）：放置 ~/.config/opencode/agents/（文件名即 agent 名）；主代理按 description 自动派发或 @name 显式派发；写入隔离由插件 guard（templates/adapters/opencode/plugins/harness-guard.js）承担；disallowedTools 键 opencode 不支持——只读角色的纵深防线降级为 guard + 纪律（permission 键替代方案为装机验证项）；正文内 ZCode 专有措辞为模板原文，物理强制形态以本说明为准。\n\n',
    emit: (fm, file) => `---\ndescription: ${q(fm.description)}\nmode: subagent\n` +
      (fm.tools.length ? yamlList('tools', fm.tools) : '') + '---\n\n',
    // opencode 文件名即 agent 名，frontmatter 无 name 键——断言改用 mode 行
    assert: () => /^mode: subagent$/m,
  },
};

function buildCodex(a) {
  // 主形态：~/.codex/agents/<name>.toml（multi_agent spawn_agent；项目级定义有已知 bug——用用户级）
  if (a.body.includes("'''")) die(a.file + ': 正文含 \'\'\'，TOML 字面量串无法承载');
  const toml = `# 由六角色模板物化（docs/18 §4）。放置 ~/.codex/agents/（用户级）。\n` +
    `# 前提：features.multi_agent 开启（本机 0.153.4 实测 stable=true）；spawn_agent 暴露一致性为装机验证项（上游 #26828）。\n` +
    `name = "${a.fm.name}"\ndescription = ${JSON.stringify(a.fm.description)}\n` +
    `instructions = '''\n> 适配说明（codex）：以 spawn_agent(role="${a.fm.name}") 派发；写入隔离由 ~/.codex/hooks.json 的 PreToolUse（matcher 含 apply_patch）承担；本机实测未见工具禁用键——只读纪律为软约束+guard 兜底；正文内 ZCode 专有措辞为模板原文，以本说明为准。\n\n${a.body}'''\n`;
  // 降级备选：~/.codex/prompts/<name>.md（单会话角色卡，/name 调用——agents.toml 暴露异常时的兜底）
  const prompt = `---\ndescription: ${q(a.fm.description)}\n---\n\n` +
    `> 适配说明（codex prompts 形态，docs/18 §4）：单会话角色卡——本轮全程以「${a.fm.name}」角色纪律执行；写入隔离由 ~/.codex/hooks.json guard 承担。\n\n${a.body}`;
  return [
    [join('codex', 'agents', a.fm.name + '.toml'), toml, new RegExp('^name = "' + a.fm.name + '"$', 'm')],
    [join('codex', 'prompts', a.fm.name + '.md'), prompt, /适配说明（codex prompts 形态/],
  ];
}

const HOSTS = {
  ...yamlAgentHosts,
  codex: { build: buildCodex },
  // pi：无原生子代理（官方 README 明示）——单代理角色卡，prompts 目录 /name 调用
  'pi-agent': {
    dir: 'prompts',
    note: `> 适配说明（pi-agent，docs/18 §6）：pi 无原生子代理——本文件是单代理角色卡，放置 ~/.pi/agent/prompts/ 后调用（文件名即命令，如 /planner），本轮全程遵守该角色纪律；写入隔离由扩展 guard（templates/adapters/pi-agent/extensions/harness-guard.ts）承担；技能层 pi 与本体系共享 ~/.agents/skills/；正文内 ZCode 专有措辞为模板原文，物理强制形态以本说明为准。\n\n`,
    emit: fm => `---\ndescription: ${q(fm.description)}\n---\n\n`,
    // pi 无 name 键概念：文件名即命令名，断言用 description
  },
};

// ── 物化 ───────────────────────────────────────────────────────────────
const files = readdirSync(AGENTS).filter(f => f.endsWith('.md'));
if (!files.length) die('templates/agents/ 下没有 .md 角色文件');
let count = 0;
for (const f of files) {
  const a = { file: f, ...parseRole(f) };
  for (const [host, h] of Object.entries(HOSTS)) {
    if (h.build) {
      for (const [rel, content, assertion] of h.build(a)) writeOut(rel, content, assertion);
      continue;
    }
    const rel = join(host, h.dir, (host === 'pi-agent' ? f.replace(/\.md$/, '') : a.fm.name) + '.md');
    const assertion = h.assert ? h.assert(a)
      : host === 'pi-agent' ? /^description: /m
      : new RegExp('^name: ' + a.fm.name + '$', 'm');
    writeOut(rel, h.emit(a.fm) + h.note + a.body, assertion);
  }
}
function writeOut(rel, content, assertion) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content, 'utf8');
  const back = readFileSync(dest, 'utf8');
  if (!back.length) die(rel + ': 空产物');
  if (assertion && !assertion.test(back)) die(rel + ': 回读断言失败（防假绿）');
  count++;
  console.log('[OK] dist/' + rel.split('\\').join('/'));
}
console.log(`\nDone: ${count} 份产物 → ${OUT}`);
console.log('NEXT：hooks/守护注册一律人工粘贴（05 §3 人闸）——各宿主粘贴块与装机验证清单见 templates/adapters/<host>/README.md 与 docs/18。');
