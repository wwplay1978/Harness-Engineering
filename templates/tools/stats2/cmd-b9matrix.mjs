// stats2/cmd-b9matrix.mjs — stats-5 交付物 4：B9 closure matrix 子命令
// 机判唯一依据=templates/stats/b9-closure-criteria.md（判据冻结件——CRIT-1..7/ARBITRATION；
// 先冻结后实现，票面 P1-3 两步走）。输出七子项红绿+证据+双源仲裁 drift+overall；
// ①②只登记 02/16 权威面不代核（adjudication=external）。红项不改变退出码（matrix=判断工件非门禁；
// B9 删行决策归发布票消费本工件——票面红线）。--out 工件名钉死 b9-closure-matrix-<ISO>Z.json
// （P3-5；ISO=生成时刻承载于文件名——体禁时钟依赖字段）。
// 红队修复轮三：P2-2——⑥ 截止取数 git 执行失败与零匹配分态（⑥ unknown 第三态，非绿非红）；
// P2-3——工件体 generation 世代锚（merged 票集证据代；prune 引用保护消费，见 cmd-lifecycle.mjs）。
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { ensureStoreLayout } from './store.mjs';
import { atomicWriteFile, rfc3339 } from './util.mjs';
import { attributionFace, TICKET_FACE } from './cmd-report.mjs';   // attribution-explicit-closure r2：共享归因面第三消费面

const CRITERIA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stats', 'b9-closure-criteria.md');
const MERGE_SUBJECT_RE = /^merge: ticket ([a-z0-9][a-z0-9-]*)/;
const REPORT_REF_RE = /reports\/\d{4}-W\d{2}\/[^\s|]+\.json/;   // CRIT-6 合规引用形态
const REVIEW3_HEADING_RE = /^#+[^\n]*复盘 #([3-9]|[1-9]\d)[^\n]*$/m;   // CRIT-7 复盘节识别（#3 或更高序号——冻结件 :48）

/** metrics.md 表体行解析（CRIT-3：`| ` 起+日期列匹配的表行；slug=第二列非空 token）。 */
export function parseMetricsRows(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^\s|]+)\s*\|/.exec(line);
    if (m) rows.push({ date: m[1], slug: m[2], text: line });
  }
  return rows;
}

/** ⑥ 豁免截止（CRIT-6）：项目仓 `^merge: ticket stats-5` 最新 merge commit committer 时戳。
 *  返回分态（红队修复轮三 P2-2）：{ ok:true, cutoff }（cutoff=null=零匹配=未合并）或
 *  { ok:false, error }（git 执行失败——status≠0/ENOENT；不得与零匹配同路径伪装成「未合并」假绿）。 */
export function stats5MergeCutoff(projectDir) {
  const r = spawnSync('git', ['-C', projectDir, 'log', '--grep', '^merge: ticket stats-5', '--format=%H+%cI+%s', '-n', '4'], { encoding: 'utf8' });
  if (r.status !== 0) {
    const error = r.error ? r.error.message : String(r.stderr || `exit ${r.status}`).trim().slice(0, 300);
    return { ok: false, error };
  }
  for (const line of String(r.stdout).split('\n').map(s => s.trim()).filter(Boolean)) {
    const m = /^([0-9a-f]{40})\+(\S+)\+(.*)$/.exec(line);
    if (!m) continue;
    const subj = MERGE_SUBJECT_RE.exec(m[3].trim());
    if (!subj || subj[1] !== 'stats-5') continue;   // 前缀防撞（stats-5x 不误吞）
    const ms = Date.parse(m[2]);
    if (Number.isFinite(ms)) return { ok: true, cutoff: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') };
  }
  return { ok: true, cutoff: null };
}

/** 事件仓 merged 票集（CRIT-4：terminal_completed developer(±rerun) 派发所在票——与 report 同口径）。
 *  attribution-explicit-closure r2：改消费共享归因面（cmd-report attributionFace 一处实现三处消费）——
 *  票级面只收 EXPLICIT|DIRECT|MANUAL_RECONCILED 且 slug 取 post-join 值（CANDIDATE null 面不入
 *  merged 集；EXPLICIT 升级票按 ledger slug 计入）。 */
function mergedTicketSlugs(storeRoot) {
  const gen = EE.currentGeneration(storeRoot);
  const { events } = EE.loadCorpus(EE.genDirOf(storeRoot, gen));
  const { face } = attributionFace(events);
  const slugs = new Set();
  for (const e of events) {
    if (e.event_kind !== 'dispatch' || (e.role !== 'developer' && e.role !== 'developer-rerun')
      || e.state !== 'terminal_completed') continue;
    const f = face.get(e.entity_id) ?? { attribution: e.attribution, ticket_slug: e.ticket_slug };
    if (TICKET_FACE.has(f.attribution)) slugs.add(f.ticket_slug);
  }
  return [...slugs].sort();
}

const dayMs = 86_400_000;
const addDays = (isoDate, n) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

/** 机判主体（纯函数：判据冻结件 CRIT-1..7/ARBITRATION 的可测核）。
 *  cutoffGitError 非 null=git 执行失败（P2-2）→ ⑥ unknown 第三态：判据不可机判——items 如实输出，
 *  overall 不计 red 亦不得 all_green（非绿非红；≠ 零匹配=未合并→全行祖父豁免的绿）。 */
export function judgeB9({ metricsRows, mergedSlugs, review3Heading, forwardCutoff, cutoffGitError = null }) {
  const metricsSlugs = new Set(metricsRows.map(r => r.slug));
  // CRIT-3 计数域
  const counting_domain = metricsRows.length > 0
    ? { item: '③', state: 'green', evidence: { metrics_rows: metricsRows.length, definition: '本仓 metrics.md 行（13 号 :38 单仓口径）——CRIT-3' } }
    : { item: '③', state: 'red', evidence: { metrics_rows: 0, definition: '计数域不可复算（零行）——CRIT-3' } };
  // CRIT-4 无行票 drift（缺行方向→红；metrics-only 方向→ARBITRATION drift 不红）
  const missing = mergedSlugs.filter(s => !metricsSlugs.has(s));
  const metricsOnly = metricsRows.filter(r => !mergedSlugs.includes(r.slug)).map(r => r.slug);
  const unrowed_tickets_drift = {
    item: '④', state: missing.length === 0 ? 'green' : 'red',
    evidence: { merged_tickets_in_store: mergedSlugs.length, metrics_rows: metricsRows.length, missing_rows: missing },
  };
  // CRIT-5 修复票（已裁——机判面=规则冻结在场）
  const repair_ticket_rule = { item: '⑤', state: 'green', evidence: { rule: '修复票照常计票+更正注关联（已裁）——CRIT-5（判据冻结件在场）' } };
  // CRIT-6 前向判据（P2-2：git 执行失败→unknown——证据基缺席，豁免/违例两向均不可机判）
  let unique_count_source;
  if (cutoffGitError != null) {
    unique_count_source = {
      item: '⑥', state: 'unknown',
      evidence: {
        forward_cutoff: null,
        cutoff_status: 'git-execution-failed',
        git_error: cutoffGitError,
        note: 'git 执行失败——⑥ 判据不可机判（unknown 如实，非绿非红；≠ 零匹配=未合并→全行祖父豁免）',
      },
    };
  } else {
    const post = forwardCutoff === null ? [] : metricsRows.filter(r => r.date > forwardCutoff.slice(0, 10));
    const violating = post.filter(r => !REPORT_REF_RE.test(r.text)).map(r => r.slug);
    unique_count_source = {
      item: '⑥', state: violating.length === 0 ? 'green' : 'red',
      evidence: {
        forward_cutoff: forwardCutoff,
        grandfathered_rows: metricsRows.length - post.length,
        rows_requiring_reference: post.length,
        rows_missing_reference: violating,
        reference_form: 'reports/<ISO 周桶>/<工件名>.json（report --out 工件名——引用即合规，数字列仍可手写）',
      },
    };
  }
  // CRIT-7 第 10 票复盘（机判替代口径——触发义务在体系，matrix 只 flag 不执行）
  let tenth_ticket_review;
  if (metricsRows.length <= 10) {
    tenth_ticket_review = { item: '⑦', state: 'green', evidence: { metrics_rows: metricsRows.length, threshold: 10, crossed_at: null, review_section_found: null, note: '未越阈（≤10 行）——无复盘义务' } };
  } else {
    const crossedAt = metricsRows[9].date;
    const deadline = addDays(crossedAt, 30);
    let found = false, sectionDate = null;
    if (review3Heading) {
      found = true;
      const dm = /(\d{4}-\d{2}-\d{2})/.exec(review3Heading);
      sectionDate = dm ? dm[1] : null;
      if (sectionDate === null || sectionDate > deadline) found = false;   // 无日期/迟节=及时性不可证
    }
    tenth_ticket_review = {
      item: '⑦', state: found ? 'green' : 'red',
      evidence: {
        metrics_rows: metricsRows.length, threshold: 10, crossed_at: crossedAt, deadline,
        review_section_found: found, review_section_date: sectionDate,
        note: '触发义务在体系，matrix 只 flag 不执行（上线即红=如实公示）',
      },
    };
  }
  const items = {
    inject_agents_md: { item: '①', adjudication: 'external', state: 'registered', authority: 'docs/02 §1 状态注（injectAgentsMd 待核——归属 02）', note: 'stats 只登记权威面现状不代核（CRIT-1）' },
    skills_anchor_package: { item: '②', adjudication: 'external', state: 'registered', authority: 'docs/16 §3（skills 锚点包获取来源待核——归属 16）', note: 'stats 只登记权威面现状不代核（CRIT-2）' },
    counting_domain,
    unrowed_tickets_drift,
    repair_ticket_rule,
    unique_count_source,
    tenth_ticket_review,
  };
  const red_items = Object.entries(items).filter(([, x]) => x.adjudication !== 'external' && x.state === 'red').map(([k]) => k);
  const unknown_items = Object.entries(items).filter(([, x]) => x.adjudication !== 'external' && x.state === 'unknown').map(([k]) => k);
  return {
    items,
    dual_source_arbitration: {
      rule: 'metrics.md vs 事件仓不一致→事件仓为准判定+差异列 drift 报告项（22 :309 主从扩展——CRIT-ARBITRATION）',
      drift: metricsOnly.map(slug => ({ type: 'metrics-row-without-store-merge', slug })),
    },
    // P2-2：unknown 不计 red；但在场即 all_green=false（判据不可机判≠全绿——假绿防线）
    overall: { all_green: red_items.length === 0 && unknown_items.length === 0, red_items, unknown_items },
  };
}

export async function cmdB9Matrix(opts) {
  const { storeRoot, flags } = opts;
  const projectDir = flags['project-dir'] ?? null;
  if (!projectDir || typeof projectDir !== 'string') {
    console.error('b9-matrix 需要 --project-dir <项目仓根>（docs/metrics.md+docs/13+git 面——CRIT-3/6/7 计数与截止判据来源）');
    return EXIT.USAGE;
  }
  if (!existsSync(CRITERIA_PATH)) {
    console.error(`B9_CRITERIA_MISSING：判据冻结件缺席 ${CRITERIA_PATH}（机判唯一依据——工具分布破损，fail-loud）`);
    return EXIT.FAIL;
  }
  // metrics.md 缺席=③红非命令失败（冻结件 :28「缺席/不可解析=③红，非命令失败」+:58 红项不改退出码）
  const metricsPath = join(projectDir, 'docs', 'metrics.md');
  if (!existsSync(metricsPath)) console.error(`[STATS5] docs/metrics.md 缺席——③ 计数域不可复算（红项如实，非命令失败）`);
  // 布局+ACL preflight（事件仓读取面）
  const checks = ensureStoreLayout(storeRoot);
  const aclFail = checks.find(c => !c.ok);
  if (aclFail) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }

  const metricsRows = existsSync(metricsPath) ? parseMetricsRows(readFileSync(metricsPath, 'utf8')) : [];   // 缺席→零行→judgeB9 ③红分支
  const doc13Path = join(projectDir, 'docs', '13-metrics-review-1.md');
  const review3Heading = existsSync(doc13Path) ? (REVIEW3_HEADING_RE.exec(readFileSync(doc13Path, 'utf8'))?.[0] ?? null) : null;
  if (!existsSync(doc13Path)) console.error('[STATS5] docs/13 缺席——⑦ 复盘节识别面不可得（按未发现处置，如实）');
  // ⑥ 截止取数分态（P2-2）：git 执行失败≠零匹配——失败→unknown（stderr [STATS5] 注记沿先例）；零匹配→祖父豁免照旧
  const cutoffRes = stats5MergeCutoff(projectDir);
  let forwardCutoff = null;
  let cutoffGitError = null;
  if (cutoffRes.ok) forwardCutoff = cutoffRes.cutoff;
  else {
    cutoffGitError = cutoffRes.error;
    console.error(`[STATS5] git 执行失败——⑥ 判据不可机判（unknown 如实，非绿非红）：${cutoffGitError}`);
  }
  const mergedSlugs = mergedTicketSlugs(storeRoot);

  const judged = judgeB9({ metricsRows, mergedSlugs, review3Heading, forwardCutoff, cutoffGitError });
  const generation = EE.currentGeneration(storeRoot);   // P2-3 世代锚：merged 票集证据定着于生成时当前代
  const body = JSON.stringify({
    command: 'b9-matrix',
    criteria_anchor: 'templates/stats/b9-closure-criteria.md',
    // P2-3（attribution-explicit-closure r2）：口径标签——merged 票集自本票起只收
    // EXPLICIT|DIRECT|MANUAL_RECONCILED（消费共享归因面），与切换前 DIRECT 面判读不可比→标签可见
    attribution_face: 'explicit-direct-manual',
    generation,   // 数据派生=store 当前代（确定性入体不破禁时钟纪律——prune 引用保护消费面，P2-3）
    metrics_source: `${String(projectDir).replaceAll('\\', '/')}/docs/metrics.md`,
    ...judged,
  }, null, 2);

  if (flags.out !== undefined && flags.out !== true) {
    console.error('USAGE：b9-matrix --out 不带值（工件名自动生成 b9-closure-matrix-<ISO>Z.json——P3-5 钉死，不接受自定义名）');
    return EXIT.USAGE;
  }
  if (flags.out === true) {
    // 工件名钉死（P3-5）：b9-closure-matrix-<ISO>Z.json（ISO=生成时刻——文件名承载，体禁时钟字段）
    const iso = rfc3339().replaceAll(':', '-');
    const dir = join(storeRoot, 'reports');
    mkdirSync(dir, { recursive: true });
    const finalPath = join(dir, `b9-closure-matrix-${iso}.json`);
    if (existsSync(finalPath)) { console.error(`OUT_FILE_EXISTS：reports/b9-closure-matrix-${iso}.json 已在场——append 语义禁覆写`); return EXIT.FAIL; }
    atomicWriteFile(finalPath, body + '\n');
    const red = judged.overall.red_items;
    console.log(JSON.stringify({ command: 'b9-matrix', out: `reports/b9-closure-matrix-${iso}.json`, all_green: judged.overall.all_green, red_items: red }, null, 2));
    return EXIT.OK;
  }
  console.log(body);
  return EXIT.OK;
}
