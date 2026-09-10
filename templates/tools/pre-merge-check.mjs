// pre-merge-check.mjs — 自治流水线合并门控断言（spec 20 §3-4，v3 新增）
// 用法：node pre-merge-check.mjs <项目根> <slug>
//   在合并 feat/<slug> 前运行：全部门绿 exit 0（并落盘 docs/reviews/<slug>-premerge.log），
//   任一红 exit 1（log 同样落盘——失败证据也是审计工件）。
// 断言（全部机器可判定；自由文本依赖链为软门+机器辅助，见 §4 依赖项）：
//   A. spec/tickets 零偷改：git diff main...feat/<slug> -- docs/specs/ docs/tickets/ 为空
//   B. main 直提白名单：自上一 merge commit 起的 main 直提逐条对照
//      （chore: archive* / docs: spec* / docs: agents* / 尾注 committed on user authorization）
//   C. 分支唯一且未合并：feat/<slug> 存在、HEAD ≠ main、尚未在 main（--no-ff 单分支语义）
//   D. 上游依赖机器辅助：ticket 文件声明的依赖 slug——其 feat 分支已删（合并惯例）或已入 main
//   E. 输出落盘 docs/reviews/<slug>-premerge.log（archiver 归档复核的依据，spec 20 §3-6）
// 注意：本脚本只做判定，不执行合并、不 push——push 白名单见项目配置 auto_push_remote（无键=不自动 push）。
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [P, slug] = process.argv.slice(2);
if (!P || !slug) { console.error('用法：node pre-merge-check.mjs <项目根> <slug>'); process.exit(2); }
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
  const bad = scope.split('\n').filter(Boolean).filter(l => {
    if (/^chore: archive/.test(l)) return false;
    if (/^docs: spec /.test(l)) return false;
    if (/^docs: agents/.test(l)) return false;
    if (/committed on user authorization \d{4}-\d{2}-\d{2}/.test(l)) return false;
    return true;
  });
  gate('B main 直提白名单', bad.length === 0, bad.length ? `非白名单直提：\n${bad.join('\n')}` : `${scope.split('\n').filter(Boolean).length} 条均在白名单（窗口自 ${since.slice(0, 7) || 'HEAD..main'}）`);
} catch (e) { gate('B', false, `时间窗读取失败：${e.message.split('\n')[0]}`); }

// C. 分支唯一且未合并
try {
  const br = git('branch', '--list', `feat/${slug}`);
  const merged = git('branch', '--merged', 'main', '--list', `feat/${slug}`);
  gate('C 分支唯一未合并', br !== '' && merged === '', br === '' ? `feat/${slug} 不存在` : merged !== '' ? '已在 main（重复合并）' : '在位且未合并');
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

// E. 落盘工件（archiver 复核依据）
const outDir = join(P, 'docs', 'reviews');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
const body = `# pre-merge 断言 · ${slug}\n- 时间：${stamp}\n- 项目：${P}\n- 分支：feat/${slug}\n- 判定：${fail === 0 ? 'PASS（gates green——可 auto-merge，commit 尾注引用本工件）' : 'FAIL（停链报告，不得合并）'}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`;
writeFileSync(join(outDir, `${slug}-premerge.log`), body);
console.log(`\n[E] 工件落盘：docs/reviews/${slug}-premerge.log（archiver 归档复核依据）`);
process.exit(fail === 0 ? 0 : 1);
