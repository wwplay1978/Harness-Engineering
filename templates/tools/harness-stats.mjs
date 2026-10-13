// harness-stats.mjs — 效能统计契约验证器 + 采集工具（docs/22 v4 §8 stats-1/stats-2；票面 docs/tickets/stats-1.md、stats-2.md）
// 用法：
//   node harness-stats.mjs validate-schema <路径>
//     <路径>=fixture 文件 → 单文件三层验证：绿 exit 0；红 exit 1（输出含 VR-* 规则 ID 与 JSON pointer）
//     <路径>=templates/stats 目录（含 obligations.md + fixtures/）→ 套件模式：
//       ① fixtures/positive/*.json 全绿
//       ② fixtures/negative/neg-<RULE>-*.json 每件全红且报出规则集合恰=文件名编码规则（每负例对应恰一条 rule）
//       ③ obligations.md 义务覆盖对账（每 O-xx 正/负 fixture 存在；负例双向闭合；正例无孤儿）
//     <路径>=其他目录 → 目录内 *.json 逐件三层验证，全绿 exit 0，任一红 exit 1
//   node harness-stats.mjs init [stats-2 参数] → 仓初始化/注册（stats-2 阶段二；见 stats2/cli.mjs）
//   stats-2 子命令与退出码契约见 templates/tools/stats2/cli.mjs 头注。
// 红线（stats-1 票面 §0 对 validate-schema 仍有效）：
//   - validate-schema 不触任何真实源（~/.zcode/cli/db/db.sqlite、~/.codex/sessions、~/.kimi-code 等禁读禁写）——fixture 全为自造 JSON 样本；
//   - 零第三方依赖（仅 node: 标准库）；validate-schema 禁 node:sqlite（不触源；stats-2 子命令仅经 bundle/fixture 副本用 node:sqlite）。
// 三层验证（docs/22 §5.2 / §8 stats-1 ③）——验证器实体自本文件抽出至 stats2/contract-validator.mjs
// （stats-2 P1-1：collect 生产产物须过同一 validator，单源不复刻；行为零改动）：
//   ① 结构层 VR-Sxx：自研最小 JSON Schema 子集校验器（schema 节点 rule 注记=违规上报的规则 ID）；
//   ② 跨字段层 VR-Fxx：身份公式/终态字段约束/墙钟公式/token 补写前提/eligible 计数自洽/cursor 校验和/组合 sanity（VR-F11）/role_status_counts（VR-F12）；
//   ③ 跨事件层 VR-Xxx：event_id 唯一 / source_revision 单调 / 归派发解析 / derivation_revision 单调。
// 规则语义与规范锚见 templates/stats/obligations.md（48 条 O-xx——stats-2 阶段一契约批新增 O-40/O-41）。
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateFixture, runSuite, loadJson } from './stats2/contract-validator.mjs';

const USAGE = '用法：node harness-stats.mjs validate-schema <fixture 文件 | templates/stats 目录 | 正例目录>\n      node harness-stats.mjs <init|bundle|collect|validate|rebuild|compact|prune|verify|migrate-audit|report> [stats-2 参数]';

const [sub, target] = process.argv.slice(2);   // argv[0]=node argv[1]=脚本
if (sub !== 'validate-schema') {
  // stats-2 子命令分发（validate-schema 以外的运行时契约面）
  const { runStats2 } = await import('./stats2/cli.mjs');
  process.exit(await runStats2(process.argv.slice(2)));
}
if (!target) { console.error(USAGE); process.exit(2); }
if (!existsSync(target)) { console.error(`路径不存在：${target}`); process.exit(2); }

// ── 目录正例模式 / 单文件模式 ─────────────────────────────────────
if (statSync(target).isDirectory()) {
  const hasSuite = existsSync(join(target, 'obligations.md')) && existsSync(join(target, 'fixtures'));
  if (hasSuite) process.exit(runSuite(target) === 0 ? 0 : 1);
  const files = readdirSync(target).filter(f => f.endsWith('.json')).sort();
  let bad = 0;
  for (const f of files) {
    let fixture;
    try { fixture = loadJson(join(target, f)); }
    catch { bad++; console.log(`[FAIL] ${f}（JSON 解析失败）`); continue; }
    const errs = validateFixture(fixture);
    if (errs.length === 0) console.log(`[PASS] ${f}`);
    else { bad++; console.log(`[FAIL] ${f}`); errs.forEach(e => console.log(`       ${e.rule} ${e.pointer} — ${e.message}`)); }
  }
  console.log(`摘要：${files.length} 件，${bad === 0 ? '全绿' : `红 ${bad} 件`}`);
  process.exit(bad === 0 ? 0 : 1);
}
const errs = validateFixture(loadJson(target));
if (errs.length === 0) { console.log(`[PASS] ${target}`); process.exit(0); }
errs.forEach(e => console.error(`[FAIL] ${e.rule} ${e.pointer} — ${e.message}`));
process.exit(1);
