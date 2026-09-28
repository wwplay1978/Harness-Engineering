// OPT-2 变体生成器：路由表 → 物化 rerun 变体角色到 ~/.zcode/agents/
// 路由表读取 ~/.zcode/models.config.json（部署副本；唯一事实来源=harness 规范仓库（REPO）/templates/models.config.json，经 sync-harness.mjs --apply 分发——改配置改源头，勿改部署副本）
// 2026-09-28 D4 分层：模型绑定住 model_bindings.zcode（routing=宿主无关机制层，本生成器不消费）；兼容旧顶层格式（部署副本未升级期间防 FAIL）
// 2026-09-28 models-local-binding：机器级覆盖 ~/.zcode/models.config.local.json 深合并于部署 config 之上
// （defaults/variants 逐键覆盖，local > 部署 config）——个人订阅 provider ID 与菜单级 pin 住用户域，不进公开模板
// 约定：变体文件是编译产物勿手改（重跑本脚本覆盖）；defaults 非 inherit 时同步写 base 的 model 字段
// 自检：每步正向断言（写后回读验证），失败大声退出 —— 绝不无条件成功 echo
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const Z = join(homedir(), '.zcode');
const CFG = join(Z, 'models.config.json');
const AGENTS = join(Z, 'agents');

const die = m => { console.error('[FAIL] ' + m); process.exit(1); };
if (!existsSync(CFG)) die('config not found: ' + CFG);
const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
// 分层格式：绑定在 model_bindings.zcode；旧格式（顶层 defaults/variants）兼容读取
let zc = cfg.model_bindings?.zcode ?? cfg;
// 机器级覆盖：local 文件深合并（defaults 逐键；variants 逐 variant 再逐字段——model-only 覆盖不丢 base），local 优先；损坏即 fail-loud
const LOCAL = join(Z, 'models.config.local.json');
if (existsSync(LOCAL)) {
  let lraw;
  try { lraw = JSON.parse(readFileSync(LOCAL, 'utf8')); }
  catch (e) { die('local binding override invalid JSON: ' + e.message); }
  const lz = lraw.model_bindings?.zcode ?? {};
  zc = {
    defaults: { ...(zc.defaults ?? {}), ...(lz.defaults ?? {}) },
    variants: Object.fromEntries([
      ...Object.entries(zc.variants ?? {}),
      ...Object.entries(lz.variants ?? {}).map(([id, lv]) => [id, { ...(zc.variants?.[id] ?? {}), ...lv }])
    ])
  };
  console.log('[OK] local binding override applied: ' + LOCAL);
}
for (const [id, v] of Object.entries(zc.variants ?? {})) {
  if (typeof v?.base !== 'string' || typeof v?.model !== 'string') {
    die('variant invalid (need base+model strings): ' + id + ' → ' + JSON.stringify(v));
  }
}
mkdirSync(AGENTS, { recursive: true });

const rewriteFrontmatter = (src, { name, descPrefix, model }) => {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) die('frontmatter not found in base file');
  let fm = m[1];
  fm = fm.replace(/^name:\s*.*$/m, 'name: ' + name);
  fm = fm.replace(/^description:\s*"(.*)"$/m, (s, d) => 'description: "' + descPrefix + d + '"');
  if (fm.includes('description:') && !/^description:.*"/m.test(fm)) {
    fm = fm.replace(/^description:\s*(.*)$/m, (s, d) => 'description: "' + descPrefix + d + '"');
  }
  if (model) {
    if (/^model:\s*.*$/m.test(fm)) fm = fm.replace(/^model:\s*.*$/m, 'model: ' + model);
    else fm = 'model: ' + model + '\n' + fm;
  } else {
    fm = fm.replace(/^model:\s*.*\r?\n?/m, '');
  }
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---/, '---\n' + fm + '\n---');
};

let changed = 0;
for (const [vid, v] of Object.entries(zc.variants ?? {})) {
  const base = join(AGENTS, v.base + '.md');
  if (!existsSync(base)) die('base role missing: ' + base);
  let out = rewriteFrontmatter(readFileSync(base, 'utf8'), {
    name: vid,
    descPrefix: '[重跑专用-修复轮/复审/复测] ',
    model: v.model
  });
  const dest = join(AGENTS, vid + '.md');
  // 保留既有变体文件的额外 frontmatter 字段（菜单级 thoughtLevel/color 等——重物化从 base 出发会丢）。
  // 键级块合并（2026-09-28 gen-variant-dedup 修复）：只追加"重生物 fm 中不存在"的顶层键，按块（键+缩进续行）整体搬运；
  // 目标文件自身含重复键时取首块——因此本生成器重跑即可清洗历史重复键（幂等）
  if (existsSync(dest)) {
    const dm = readFileSync(dest, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (dm) {
      const fmKeys = new Set(out.match(/^---\n([\s\S]*?)\n---/)[1].split(/\r?\n/)
        .map(l => l.match(/^([A-Za-z_][\w-]*):/)).filter(Boolean).map(m => m[1]));
      const blocks = []; let cur = null;
      for (const line of dm[1].split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][\w-]*):/);
        if (m) { cur = { key: m[1], lines: [line] }; blocks.push(cur); }
        else if (cur && line.trim()) cur.lines.push(line);
      }
      const seen = new Set();
      const extras = blocks
        .filter(b => !fmKeys.has(b.key) && !seen.has(b.key) && (seen.add(b.key), true))
        .map(b => b.lines.join('\n')).join('\n');
      if (extras) out = out.replace(/^---\n([\s\S]*?)\n---/, (s, fm) => '---\n' + fm + '\n' + extras + '\n---');
    }
  }
  writeFileSync(dest, out);
  // 正向断言：回读验证 name/model 确已写入（防假绿）
  const back = readFileSync(dest, 'utf8');
  if (!new RegExp('^name:\\s*' + vid + '$', 'm').test(back)) die(vid + ': name not written');
  if (!new RegExp('^model:\\s*' + v.model.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$', 'm').test(back)) die(vid + ': model not written');
  // 顶层键唯一性断言（gen-variant-dedup：重复键=解释器相关行为，视为生成失败）
  const keyLines = (back.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]).split(/\r?\n/)
    .map(l => l.match(/^([A-Za-z_][\w-]*):/)).filter(Boolean).map(m => m[1]);
  const dups = [...new Set(keyLines.filter((k, i) => keyLines.indexOf(k) !== i))];
  if (dups.length) die(vid + ': duplicate frontmatter keys: ' + dups.join(','));
  console.log('[OK] ' + vid + ' <- ' + v.base + ' (model: ' + v.model + ')');
  changed++;
}

// defaults：inherit 时确保 base 无 model 字段；非 inherit 时写入
for (const [role, mv] of Object.entries(zc.defaults ?? {})) {
  const f = join(AGENTS, role + '.md');
  if (!existsSync(f)) { console.log('[WARN] default role missing (skip): ' + role); continue; }
  const src = readFileSync(f, 'utf8');
  if (mv === 'inherit') {
    if (/^model:/m.test(src)) {
      writeFileSync(f, src.replace(/^model:\s*.*\r?\n?/m, ''));
      console.log('[OK] ' + role + ': model field removed (inherit)');
    }
  } else {
    const out = rewriteFrontmatter(src, { name: role, descPrefix: '', model: mv });
    writeFileSync(f, out);
    console.log('[OK] ' + role + ': model pinned to ' + mv);
  }
}

if (changed === 0) die('no variants generated - check model_bindings.zcode.variants');
console.log('\nDone: ' + changed + ' variant(s). 新开会话后生效（C1：子代理定义启动时快照）。');
