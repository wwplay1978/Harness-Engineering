// UserPromptSubmit hook：双态分支提醒（归档闭环的物理信号）
// 状态A：有未合并 feat 分支        → 提醒人做合并决策（或走废弃归档）
// 状态B：有已合并未清理的 feat 分支 → 提醒派 archiver 归档（archiver SOP 第7步
//        删分支后本提醒自动消失 = 归档闭环）
// 附加：检测到遗留 qa/* 分支仅提示人工清理（qa 独立分支特例已废除，见 qa-tester.md）
// ── ZCode 适配：cwd 从 payload 读；git -C 指定仓库；输出严格 JSON；fail-open ──
import { execSync } from 'node:child_process';
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const cwd = String(payload.cwd ?? '').split(BS).join('/');
    if (!cwd) process.exit(0);
    const opt = { encoding: 'utf8', timeout: 5000, cwd };
    const run = c => { try { return execSync(c, opt).trim(); } catch { return ''; } };
    const all = run('git branch --format=%(refname:short)');
    if (!all) process.exit(0);                           // 非 git 仓库静默
    const branches = all.split(NL).map(s => s.trim()).filter(Boolean);
    const isMerged = b => { try { execSync('git merge-base --is-ancestor ' + b + ' main', opt); return true; } catch { return false; } };
    const unmergedFeat = branches.filter(b => /^feat\//.test(b) && !isMerged(b));
    const mergedUncleanFeat = branches.filter(b => /^feat\//.test(b) && isMerged(b));
    const legacyQa = branches.filter(b => /^qa\//.test(b));
    const lines = [];
    if (unmergedFeat.length) lines.push('[待合并决策] 以下 feat 分支未合并，请人决策合并或废弃：' + NL +
      unmergedFeat.map(b => '  - ' + b).join(NL));
    if (mergedUncleanFeat.length) lines.push('[待归档] 以下 feat 分支已合并未清理，请派 archiver 执行归档 SOP：' + NL +
      mergedUncleanFeat.map(b => '  - ' + b).join(NL));
    if (legacyQa.length) lines.push('[遗留清理] 检测到 qa/* 分支（特例已废除），请人工确认后清理：' + NL +
      legacyQa.map(b => '  - ' + b).join(NL));
    if (!lines.length) process.exit(0);                  // 全部干净时静默
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join(NL + NL) }
    }));
  } catch { process.exit(0); }                           // fail-open
});
