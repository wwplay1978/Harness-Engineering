// OPT-2 变体生成器：路由表 → 物化 rerun 变体角色到 ~/.zcode/agents/
// 路由表读取 ~/.zcode/models.config.json（部署副本；唯一事实来源=REPO/templates/models.config.json，经 sync-harness.mjs --apply 分发——改配置改源头，勿改部署副本）
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
for (const [vid, v] of Object.entries(cfg.variants ?? {})) {
  const base = join(AGENTS, v.base + '.md');
  if (!existsSync(base)) die('base role missing: ' + base);
  const out = rewriteFrontmatter(readFileSync(base, 'utf8'), {
    name: vid,
    descPrefix: '[重跑专用-修复轮/复审/复测] ',
    model: v.model
  });
  const dest = join(AGENTS, vid + '.md');
  writeFileSync(dest, out);
  // 正向断言：回读验证 name/model 确已写入（防假绿）
  const back = readFileSync(dest, 'utf8');
  if (!new RegExp('^name:\\s*' + vid + '$', 'm').test(back)) die(vid + ': name not written');
  if (!new RegExp('^model:\\s*' + v.model.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$', 'm').test(back)) die(vid + ': model not written');
  console.log('[OK] ' + vid + ' <- ' + v.base + ' (model: ' + v.model + ')');
  changed++;
}

// defaults：inherit 时确保 base 无 model 字段；非 inherit 时写入
for (const [role, mv] of Object.entries(cfg.defaults ?? {})) {
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

if (changed === 0) die('no variants generated - check config.variants');
console.log('\nDone: ' + changed + ' variant(s). 新开会话后生效（C1：子代理定义启动时快照）。');
