// pre-merge-check.mjs — 自治流水线合并门控断言（spec 20 §3-4，v3 新增）
// 用法：node pre-merge-check.mjs <项目根> <slug> [--no-log]
//   在合并 feat/<slug> 前运行：全部门绿 exit 0（并落盘 docs/reviews/<slug>-premerge.log），
//   任一红 exit 1（活合并场景下 log 同样落盘——失败证据也是审计工件）。
// 断言（全部机器可判定；自由文本依赖链为软门+机器辅助，见 §4 依赖项）：
//   A. spec/tickets 零偷改：git diff main...feat/<slug> -- docs/specs/ docs/tickets/ 为空
//   B. main 直提白名单：自上一 merge commit 起的 main 直提逐条对照
//      （chore: archive* / docs: spec* / docs: agents* / 尾注 committed on user authorization）
//   C. 分支唯一且未合并：feat/<slug> 存在、HEAD ≠ main、尚未在 main（--no-ff 单分支语义）
//   D. 上游依赖机器辅助：ticket 文件声明的依赖 slug——其 feat 分支已删（合并惯例）或已入 main
//   P. auto-push 双保险（spec 20 §4）：项目配置 auto_push_remote 缺省=不自动 push；配置时解析
//      其 remote URL 对照内置公开仓禁止列表——命中即红（公开仓/发布流程永不自动 push）
//   E. 输出落盘 docs/reviews/<slug>-premerge.log（archiver 归档复核的依据，spec 20 §3-6）
//      ——副作用面收口（spec 20 §3-6 r8）：落盘是条件副作用而非无条件副作用——
//        仅活合并场景（门 C 判定在位且未合并）才写目标仓；已合并/分支已删 slug 的回归验证
//        判定仅 stdout（防诊断性运行覆写 git 内已归档证据）；--no-log 任何场景零写盘；
//        项目根不存在/非 git 仓直接 exit 2（防手误路径就地建目录）。
// 注意：本脚本只做判定，不执行合并、不 push——push 白名单见项目配置 auto_push_remote（无键=不自动 push）。
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const noLog = process.argv.includes('--no-log');
const [P, slug] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!P || !slug) { console.error('用法：node pre-merge-check.mjs <项目根> <slug> [--no-log]'); process.exit(2); }
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error(`slug 非法（仅小写字母/数字/连字符，防工件路径逃逸）：${slug}`); process.exit(2); }
if (slug.length > 64) { console.error(`slug 超长（${slug.length} 字符，上限 64）`); process.exit(2); }
try {
  if (execFileSync('git', ['-C', P, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).trim() !== 'true') throw new Error('not a work tree');
} catch (e) { console.error(`项目根不可用（不存在或非 git 仓，拒绝执行防就地建目录）：${P}`); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', P, ...a], { encoding: 'utf8' }).trim();
const lines = [];
const log = m => { lines.push(m); console.log(m); };
let fail = 0;
const gate = (name, ok, detail) => { log(`${ok ? '[PASS]' : (fail++, '[FAIL]')} 门${name} ${detail}`); };

// A. spec/tickets 零偷改
try {
  const d = git('diff', `main...feat/${slug}`, '--', 'docs/specs/', 'docs/tickets/');
  gate('A spec/tickets 零偷改', d === '', d === '' ? 'diff 为空' : `票内改动 spec/tickets（先行提交或还原）：\n${d.split('\n').slice(0, 8).join('\n')}`);
} catch (e) { gate('A', false, `git 不可用或分支不存在：${e.message.split('\n')[0]}`); }

// B. main 直提白名单（时间窗=自上一 merge commit 起）
try {
  const win = git('log', 'main', '--oneline', '--no-merges', 'HEAD..main').split('\n').filter(Boolean);
  // 时间窗取 main 上最近一次 merge 之后：用 ^.. 不可靠时回退 HEAD..main 全量对照
  let since = '';
  try { since = git('log', 'main', '--merges', '-1', '--format=%H'); } catch {}
  const scope = since ? git('log', `${since}..main`, '--oneline', '--no-merges') : win.join('\n');
  // 授权直提哈希集：--grep 同时搜 subject 与 body（死条款修复 2026-09-15：--oneline 行只含
  // hash+subject，正文尾注的原子串匹配恒不命中；改为按整条 commit message 匹配后收集哈希集判定）
  let authed = new Set();
  try {
    authed = new Set(git('log', `${since || 'HEAD'}..main`, '--no-merges', '-E',
      '--format=%h',
      '--grep=committed on user authorization [0-9]{4}-[0-9]{2}-[0-9]{2}'
    ).split('\n').filter(Boolean));
  } catch {}
  const bad = scope.split('\n').filter(Boolean).filter(l => {
    const s = l.replace(/^[0-9a-f]+ /, ''); // --oneline 行带短 hash 前缀；白名单正则锚定行首，须先剥离再判
    if (/^chore: archive/.test(s)) return false;
    if (/^docs: spec /.test(s)) return false;
    if (/^docs: agents/.test(s)) return false;
    if (authed.has(l.split(' ')[0])) return false;
    return true;
  });
  gate('B main 直提白名单', bad.length === 0, bad.length ? `非白名单直提：\n${bad.join('\n')}` : `${scope.split('\n').filter(Boolean).length} 条均在白名单（窗口自 ${since.slice(0, 7) || 'HEAD..main'}）`);
} catch (e) { gate('B', false, `时间窗读取失败：${e.message.split('\n')[0]}`); }

// C. 分支唯一且未合并
let live = false; // 活合并场景标记（门 E 落盘条件，spec 20 §3-6 r8）：分支在位且未合并=真实门禁运行
try {
  const br = git('branch', '--list', `feat/${slug}`);
  const merged = git('branch', '--merged', 'main', '--list', `feat/${slug}`);
  live = br !== '' && merged === '';
  gate('C 分支唯一未合并', live, br === '' ? `feat/${slug} 不存在` : merged !== '' ? '已在 main（重复合并）' : '在位且未合并');
} catch (e) { gate('C', false, e.message.split('\n')[0]); }

// D. 上游依赖机器辅助（tickets 自由文本的软门；结构化后升硬门）
try {
  const tf = join(P, 'docs', 'tickets', `${slug}.md`);
  const depLine = existsSync(tf) ? (readFileSync(tf, 'utf8').match(/依赖[：:]\s*(.+)/)?.[1] ?? '') : '';
  const ups = depLine.split(/[，,、\s]+/).map(s => s.replace(/^feat\//, '').replace(/[*`]/g, '')).filter(s => /^[a-z0-9][a-z0-9-]{2,}$/.test(s) && s !== slug && s !== '无');
  if (!ups.length) gate('D 上游依赖', true, 'ticket 未声明依赖（或为无）——INFO 跳过');
  else {
    const pend = ups.filter(u => {
      const br = git('branch', '--list', `feat/${u}`);
      if (br === '') return false;                                  // 分支已删=按合并惯例视为已合并
      const anc = execFileSync('git', ['-C', P, 'merge-base', '--is-ancestor', `feat/${u}`, 'main']).status === 0;
      return !anc;                                                  // 分支仍在且未入 main=挂起
    });
    gate('D 上游依赖', pend.length === 0, pend.length ? `上游未入 main 且分支仍在：${pend.join(', ')}` : `${ups.join(', ')} 已入 main（或分支已删）`);
  }
} catch (e) { gate('D', true, `依赖解析跳过（${e.message.split('\n')[0]}）——软门，main agent 会话内判定记入本工件`); }

// P. auto-push 双保险（spec 20 §4）：auto_push_remote 缺省=不自动 push；配置时解析 remote URL 对照公开仓禁止列表
const BLOCKED = ['github.com/wwplay1978/harness-engineering']; // 已知公开仓（Harness-Engineering 发布仓）——永不自动 push
try {
  const cfgPath = join(P, 'harness.config.md');
  const m = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8').match(/^\|\s*auto_push_remote\s*\|\s*([^|]*?)\s*\|/m) : null;
  const val = m ? m[1].trim() : '';
  if (!val || val === '（无）' || val === '无') gate('P auto-push 双保险', true, '项目未配置 auto_push_remote（默认不自动 push，spec 20 §4）');
  else {
    const url = /:\/\//.test(val) || val.startsWith('git@') ? val : git('remote', 'get-url', val); // remote 名不存在时 git 报错 → 下方 catch 红
    const norm = url.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^git@/, '').replace(/\.git\/?$/, '').replace(':', '/');
    const hit = BLOCKED.some(b => norm.includes(b));
    const shown = url.replace(/:\/\/[^@\/]+@/, '://***@'); // 凭据脱敏（对抗审查 P1-1）：userinfo 不得随 detail 入 premerge.log 归档进 git，val 同律
    const valShown = val.replace(/:\/\/[^@\/]+@/, '://***@');
    gate('P auto-push 双保险', !hit, hit ? `auto_push_remote（${valShown}）→ ${shown} 命中公开仓禁止列表（spec 20 §4：公开仓永不自动 push）` : `auto_push_remote（${valShown}）→ ${shown}，不在禁止列表`);
  }
} catch (e) { gate('P auto-push 双保险', false, `配置解析失败（remote 不存在或 git 异常）：${e.message.split('\n')[0]}`); }

// E. 落盘工件（archiver 复核依据）——条件副作用（spec 20 §3-6 r8）：
//    仅活合并场景（门 C 判定在位且未合并）且未指定 --no-log 时才写目标仓；
//    诊断性运行（已合并/分支已删 slug 回归、--no-log）判定仅 stdout，不覆写已归档证据。
const skip = noLog ? '--no-log 指定' : !live ? '门 C 未确认活合并场景（分支不存在/已在 main/判定失败）——防覆写已归档证据' : '';
if (skip) {
  console.log(`\n[E] 工件不落盘（${skip}）：判定仅 stdout`);
} else {
  try {
    const outDir = join(P, 'docs', 'reviews');
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const body = `# pre-merge 断言 · ${slug}\n- 时间：${stamp}\n- 项目：${P}\n- 分支：feat/${slug}\n- 判定：${fail === 0 ? 'PASS（gates green——可 auto-merge，commit 尾注引用本工件）' : 'FAIL（停链报告，不得合并）'}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
    writeFileSync(join(outDir, `${slug}-premerge.log`), body);
    console.log(`\n[E] 工件落盘：docs/reviews/${slug}-premerge.log（archiver 归档复核依据）`);
  } catch (e) { gate('E 工件落盘', false, `写盘失败（${e.message.split('\n')[0]}）`); } // P3 受控呈现：写失败改 [FAIL] 行不裸崩；fail++ 保 exit 仍非 0
}
process.exit(fail === 0 ? 0 : 1);
