// stats2/cmd-verify.mjs — pilot verify（⑩⑫⑦；P1-6 最小输出 allowlist；P0-4 契约消费面）
// 三方对账：bundle tickets/<slug>.md 运行记录行 × 仓内 DIRECT developer dispatch × developer/developer-rerun 变体序列；
// 七类差异（parser.mjs 冻结谓词）；差异率 >5% → fail-loud exit≠0；
// ⑦ 第三恒等：dispatch 聚合 role|status == manifest.role_status_counts == bundle 内 eligible 重算；
// 默认输出 allowlist：project_id / ticket_slug / 匿名 source key / 差异类别；--include-paths 显式开启路径面。
// P0-1：bundle sqlite 只读消费一律经 TEMP 封闭副本（ro 直开 WAL 库会新建 -shm/-wal 边车）。
// P1-8：参数 bundle ↔ audit 侧车 ↔ 当前 generation 三方绑定核对，不一致 exit≠0。
// P2-13：⑩ orphan_dispatch 差异附五级归因分布上下文；--write-pilot-report 产出 §5.8 pilot 评估报告工件（reports/ 白名单位）。
// stats-4 扩展：--live-tickets 活仓只读重读+orphan drift 机制（D4/P1-5/P2-1/P2-2）——watermark=
//   reports/verify-watermark-<bundle8>-<gen8>.json（append 永存禁清理）；行级 orphan 率>5% 与票级差异率>5%
//   任一超阈 fail-loud（⑨④）；drift 报告（逐票新增/消失行 SHA）独立输出不判 fail；⑥ ACL 异常 → exit 65。
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStoreLayout, makeOwnedTempDir } from './store.mjs';
import { openReadOnly, withReadonlyDbCopy } from './zcode-source.mjs';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { parseTicketRunLog, diffTicket, sha8 } from './parser.mjs';
import { mapMetadataState, normalizeAgent, buildSessionTerminalMap } from './project.mjs';
import { parseLiveTickets, extractLiveRows } from './cmd-phase4.mjs';
import { rfc3339, atomicWriteFile } from './util.mjs';

const ATTRIBUTION_LEVELS = ['EXPLICIT', 'DIRECT', 'CANDIDATE', 'MANUAL_RECONCILED', 'UNATTRIBUTED'];
const ORPHAN_RATE_THRESHOLD = 0.05;

/** 活仓重读（只读——drift 检测本体，票面红线明文豁免）：repo/slug/line/row_sha256 行集（developer 系）。 */
function readLiveRows(sources) {
  const rows = [];
  for (const { repo, dir } of sources) {
    if (!existsSync(dir)) { console.error(`LIVE_DIR_NOT_FOUND：${dir}（活仓 tickets 目录——只读）`); return null; }
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
      const slug = f.replace(/\.md$/, '');
      for (const r of extractLiveRows(readFileSync(join(dir, f), 'utf8'))) {
        if (!r.is_dev_family) continue;
        rows.push({ repo, slug, line: r.line, row_sha256: r.row_sha256 });
      }
    }
  }
  rows.sort((a, b) => a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.line - b.line);
  return rows;
}

/** orphan drift 三态（⑨）：首跑 created / 同 watermark identical / 演进 evolved（不覆写 watermark）。
 *  行级 orphan 率=新增行（watermark 外的活仓行——未入仓面）/当前重读 dev 行总数；drift 本身不判 fail。 */
function orphanDrift(storeRoot, manifest, gen, sources) {
  const liveRows = readLiveRows(sources);
  if (liveRows === null) return { error: EXIT.FAIL };
  const wmName = `verify-watermark-${sha8(manifest.bundle_id)}-${String(gen).padStart(8, '0')}.json`;
  const wmPath = join(storeRoot, 'reports', wmName);
  const key = r => `${r.repo}/${r.slug}#L${r.line}:${r.row_sha256}`;
  const liveSet = new Set(liveRows.map(key));
  let justCreated = false;
  if (!existsSync(wmPath)) {
    justCreated = true;
    mkdirSync(join(storeRoot, 'reports'), { recursive: true });
    const artifact = {
      artifact_kind: 'verify-watermark',
      spec_anchor: 'stats-4 票面交付物 2（D4/P1-5：活仓行集水印——bundle8+gen8 键，P1-8 三方绑定；append 永存禁清理）',
      bundle_id: manifest.bundle_id, generation: gen,
      row_count: liveRows.length, rows: liveRows,
      written_at: rfc3339(),
    };
    // P2-1（复审）：原子写（tmp+fsync+rename）——rename 前崩溃=文件不存在=下轮 created 态重建（语义不变），
    // 消除 append 永存工件的撕裂自锁面（半写 JSON 会以 WATERMARK_CORRUPT 永久卡死该键位）
    atomicWriteFile(wmPath, JSON.stringify(artifact, null, 2) + '\n');
  }
  let wm;
  try { wm = JSON.parse(readFileSync(wmPath, 'utf8')); }
  catch (e) { console.error(`WATERMARK_CORRUPT：reports/${wmName} 不可解析（${e.message}）——fail-loud 不静默重建`); return { error: EXIT.FAIL }; }
  if (wm?.artifact_kind !== 'verify-watermark' || !Array.isArray(wm.rows)) {
    console.error('WATERMARK_CORRUPT：工件非 verify-watermark 形态（artifact_kind/rows 缺失）——fail-loud');
    return { error: EXIT.FAIL };
  }
  const wmSet = new Set(wm.rows.map(key));
  const state = justCreated ? 'created'
    : wmSet.size === liveSet.size && [...liveSet].every(k => wmSet.has(k)) ? 'identical' : 'evolved';
  const added = liveRows.filter(r => !wmSet.has(key(r)));
  const removed = wm.rows.filter(r => !liveSet.has(key(r)));
  const orphanRate = liveRows.length > 0 ? +(added.length / liveRows.length).toFixed(4) : 0;
  return {
    drift: {
      watermark: `reports/${wmName}`,
      watermark_state: state,
      live_dev_rows: liveRows.length,
      watermark_rows: wm.rows.length,
      added_rows: added,
      removed_rows: removed,
      orphan_rows: added.length,
      orphan_rate: orphanRate,
      threshold: ORPHAN_RATE_THRESHOLD,
      note: '行级 orphan 率=新增行（watermark 外的活仓 dev 行——未入仓面）/当前重读 dev 行总数；drift 本身不判 fail（演进=正常活仓面）；watermark append 永存（同键演进不覆写）',
    },
  };
}

export async function cmdVerify(opts) {
  const { storeRoot, flags } = opts;
  if (!flags.bundle) { console.error('verify 须 --bundle <id>'); return EXIT.USAGE; }
  const includePaths = flags['include-paths'] === true;
  const writeReport = flags['write-pilot-report'] === true;
  // stats-4 D4：--live-tickets（活仓只读重读——drift 检测本体；沿 heldout-live-sample 先例）
  let liveSources = null;
  if (flags['live-tickets'] !== undefined) {
    const { sources, error } = parseLiveTickets(flags['live-tickets']);
    if (error) { console.error(`USAGE：${error}`); return EXIT.USAGE; }
    liveSources = sources;
  }
  const checks = ensureStoreLayout(storeRoot);
  const aclFail = checks.find(c => !c.ok);
  if (aclFail) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }   // stats-4 ⑥/D8
  const bundleDir = join(storeRoot, 'snapshots', String(flags.bundle));
  if (!existsSync(join(bundleDir, 'manifest.json'))) { console.error(`BUNDLE_NOT_FOUND：${bundleDir}`); return EXIT.FAIL; }
  const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));

  // 仓内 dispatch 事件（当前世代语料）
  const gen = EE.currentGeneration(storeRoot);
  const genDir = EE.genDirOf(storeRoot, gen);
  const { events } = EE.loadCorpus(genDir);

  // ── P1-8：参数 bundle ↔ audit 侧车 ↔ 当前 generation 三方绑定（不一致=语料与对账基准脱钩，exit≠0）──
  // P0-3（2026-10-09 三审）精确严格化：
  //   - corpus/cursor 非空 ⇒ audit 必须**存在**（整缺=零轴绑定逃逸=红）；
  //   - legacy=**精确**旧键集 {row_count,max_id,fingerprint,bundle_id,updated_at} 且类型全有效——
  //     降级为 bundle_id 单轴核对+明确降级标记（[BINDING-NOTE] legacy）；
  //   - 伪 legacy（额外缺键/多余键/类型错/混合形态）一律红（旧「两键同缺即 legacy」宽松判定已废）。
  const corpusEmpty = events.length === 0 && !existsSync(EE.cursorPath(storeRoot));
  const aud = EE.loadAudit(storeRoot);
  if (aud.audit) {
    const cls = EE.classifyAudit(aud.audit);
    if (cls.kind === 'invalid') {
      console.error(`AUDIT_INVALID：audit 侧车非精确 legacy 亦非合法新格式（${cls.reasons.join('；')}）——伪 legacy 一律红（P0-3）`);
      return EXIT.FAIL;
    }
    if (cls.kind === 'legacy') {
      // 精确 legacy：loadAudit 的「缺新格式键」problems 是预期形态（不作 corrupt 论）——单轴核对+降级标记
      console.log('[BINDING-NOTE] audit 侧车为精确 legacy 形态（恰 {row_count,max_id,fingerprint,bundle_id,updated_at} 五键）——绑定核对降级为 bundle_id 单轴；migrate-audit 可升级');
      if (typeof aud.audit.bundle_id === 'string' && aud.audit.bundle_id !== manifest.bundle_id) {
        console.error(`BINDING_FAIL：audit（legacy）bundle=${aud.audit.bundle_id} ≠ 本次对账面 bundle=${manifest.bundle_id}——语料非该 bundle 产物，拒绝对账（P1-8 单轴）`);
        return EXIT.FAIL;
      }
    } else {
      // current：全轴核对（checksum 已由 loadAudit 判；此处字段/checksum 问题=corrupt；bundle_id + generation）
      if (aud.problems) {
        console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——fail-loud（P1-8）`);
        return EXIT.FAIL;
      }
      if (aud.audit.bundle_id !== manifest.bundle_id) {
        console.error(`BINDING_FAIL：audit 侧车绑定（bundle=${aud.audit.bundle_id}, generation=${aud.audit.generation}）≠ 本次对账面（bundle=${manifest.bundle_id}, generation=${gen}）——语料非该 bundle/世代产物，拒绝对账（P1-8）`);
        return EXIT.FAIL;
      }
      if (aud.audit.generation !== gen) {
        console.error(`BINDING_FAIL：audit 侧车 generation=${aud.audit.generation} ≠ 当前世代 ${gen}——语料与对账面脱钩（P1-8）`);
        return EXIT.FAIL;
      }
    }
  } else {
    if (aud.problems) {
      console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——fail-loud（P1-8）`);
      return EXIT.FAIL;
    }
    if (!corpusEmpty) {
      console.error('AUDIT_MISSING：events 语料/cursor 非空而 audit 侧车缺失（cursors/zcode-sqlite.audit.json）——零轴绑定=红（P0-3）');
      return EXIT.FAIL;
    }
  }

  const dispatches = events.filter(e => e.event_kind === 'dispatch' && e.attribution === 'DIRECT' && e.role === 'developer');
  const bySlug = new Map();
  for (const e of dispatches) {
    if (!bySlug.has(e.ticket_slug)) bySlug.set(e.ticket_slug, []);
    bySlug.get(e.ticket_slug).push(e);
  }

  // 参与对账票集 = ∪(有 developer 行的票, 有 DIRECT developer dispatch 的票)
  const ticketSlugs = readdirSync(join(bundleDir, 'tickets')).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  const participating = new Set();
  const rowCache = new Map();
  for (const slug of ticketSlugs) {
    const rows = parseTicketRunLog(readFileSync(join(bundleDir, 'tickets', `${slug}.md`), 'utf8'));
    rowCache.set(slug, rows);
    if (rows.some(r => r.is_developer)) participating.add(slug);
  }
  for (const slug of bySlug.keys()) participating.add(slug);

  const differences = [];
  for (const slug of [...participating].sort()) {
    differences.push(...diffTicket(slug, rowCache.get(slug) ?? [], bySlug.get(slug) ?? [], { sha8 }));
  }
  const ratio = participating.size > 0 ? new Set(differences.map(d => d.ticket_slug)).size / participating.size : 0;

  // ── ⑦ 三恒等（第一重=manifest 声明 vs bundle eligible 重算（源 status 域）；
  //     第二重=manifest 声明 vs bundle 数据按 state 映射投影（state 域）；
  //     第三重=collect 后 dispatch 聚合（逐实体最新 revision，key=role+variant 复合|state）vs 同一 state 域投影。
  //     dispatch 事件不携带源 status（schema 冻结），故聚合域取状态机 state——bundle 侧以同一 M1-M9 映射投影对齐。）──
  // P0-1：sqlite 面（session/model_usage）经 TEMP 封闭副本只读消费——bundle 目录零新增文件（机械验收=前后树摘要恒等）
  const fromMs = Date.parse(manifest.time_range.from), untilMs = Date.parse(manifest.time_range.until);
  let sessionIds, windowUsage;
  withReadonlyDbCopy(join(bundleDir, 'db.sqlite'), () => makeOwnedTempDir(storeRoot, 'verify-dbcopy'), (dbCopy) => {
    const ro = openReadOnly(dbCopy);
    try {
      sessionIds = new Set(ro.prepare('SELECT id FROM session').all().map(r => String(r.id)));
      // token 判定与 collect 同窗（§5.8 窗口谓词）：childHasToken=窗口内 model_usage 行存在
      windowUsage = ro.prepare('SELECT id, session_id, status, completed_at FROM model_usage WHERE started_at >= ? AND started_at < ?').all(fromMs, untilMs);
    } finally { ro.close(); }
  });
  const usageSessions = new Set(windowUsage.map(r => String(r.session_id)));
  // ⑦ 时钟统一（审查 P2-6）：bundle 侧投影基准=cursor.updated_at（collect 判定同时钟——cursor=collect 提交点产物）；
  // cursor 缺失（未 collect 过）回退 manifest.created_at
  const cursorFile = join(storeRoot, 'cursors', 'zcode-sqlite.json');
  let clockMs = Date.parse(manifest.created_at);
  if (existsSync(cursorFile)) {
    try { clockMs = Date.parse(JSON.parse(readFileSync(cursorFile, 'utf8')).updated_at) || clockMs; } catch { /* 回退 */ }
  }
  // M-note 重判依据（裁决②=双侧同判）：窗口内每会话最后终态 usage 行——P2-10 与 collect 同一实现源
  // （project.buildSessionTerminalMap；同 completed_at 以 (completed_at, id) 复合序确定性 tie-break）
  const sessionTerminal = buildSessionTerminalMap(windowUsage);

  const recomputeAgg = {};        // 第一重（源 status 域）
  const stateProjection = {};     // 第二/三重（state 域）
  for (const f of manifest.metadata_corpus.eligible_files) {
    const meta = JSON.parse(readFileSync(join(bundleDir, 'metadata', f.relative_path), 'utf8'));
    const status = String(meta.status ?? '');
    // role 键与 dispatch 聚合同源（normalizeAgent：已知内建归 other、-rerun 拆变体后复合）
    const na = normalizeAgent(meta.profileId);
    const role = na.role + (na.variant ? '-' + na.variant : '');
    recomputeAgg[`${String(meta.profileId ?? '').replace(/^zcode-/, '')}|${status}`] = (recomputeAgg[`${String(meta.profileId ?? '').replace(/^zcode-/, '')}|${status}`] ?? 0) + 1;
    const childInSource = meta.childSessionId ? sessionIds.has(String(meta.childSessionId)) : false;
    const verdict = mapMetadataState(meta, {
      childInSource,
      childHasToken: meta.childSessionId ? usageSessions.has(String(meta.childSessionId)) : false,
      nowMs: clockMs,
      childTerminal: childInSource && meta.childSessionId ? sessionTerminal.get(String(meta.childSessionId)) ?? null : null,
    });
    stateProjection[`${role}|${verdict.state}`] = (stateProjection[`${role}|${verdict.state}`] ?? 0) + 1;
  }
  const dispatchAgg = {};         // 第三重：逐实体最新 revision（revision 链去重；key=role+variant 复合|state）
  const latest = new Map();
  for (const e of events) {
    if (e.event_kind !== 'dispatch') continue;
    const prev = latest.get(e.entity_id);
    if (!prev || e.source_revision > prev.source_revision) latest.set(e.entity_id, e);
  }
  for (const e of latest.values()) {
    const k = `${e.role}${e.variant ? '-' + e.variant : ''}|${e.state}`;
    dispatchAgg[k] = (dispatchAgg[k] ?? 0) + 1;
  }
  const canonAgg = a => JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]]));
  const manifestAgg = manifest.metadata_corpus.role_status_counts;
  const identity = {
    manifest_vs_bundle_recompute: canonAgg(recomputeAgg) === canonAgg(manifestAgg),
    manifest_state_projection_vs_dispatch_aggregate: canonAgg(stateProjection) === canonAgg(dispatchAgg),
    dispatch_entities: latest.size, eligible_files: manifest.metadata_corpus.eligible_files.length,
  };
  const identityOk = identity.manifest_vs_bundle_recompute && identity.manifest_state_projection_vs_dispatch_aggregate
    && identity.dispatch_entities === identity.eligible_files;

  // ── P2-13：orphan_dispatch 上下文（⑩ fail-loud 维持；附每票 orphan 的五级归因分布）──
  // 逐实体最新 revision 的 dispatch 按 ticket_slug × attribution 聚合——读者可判 orphan 究竟
  // 「该 slug 无任何 dispatch」还是「有 dispatch 但归因不在 DIRECT」。
  const latestDispatches = [...latest.values()];
  const slugAttribution = new Map();   // slug → {attribution: count}
  for (const e of latestDispatches) {
    if (e.ticket_slug == null) continue;
    const m = slugAttribution.get(e.ticket_slug) ?? Object.fromEntries(ATTRIBUTION_LEVELS.map(l => [l, 0]));
    m[e.attribution] = (m[e.attribution] ?? 0) + 1;
    slugAttribution.set(e.ticket_slug, m);
  }
  const corpusAttribution = Object.fromEntries(ATTRIBUTION_LEVELS.map(l => [l, 0]));
  for (const e of latestDispatches) corpusAttribution[e.attribution] = (corpusAttribution[e.attribution] ?? 0) + 1;
  const orphanSlugs = [...new Set(differences.filter(d => d.class === 'orphan_dispatch').map(d => d.ticket_slug))].sort();
  const orphanContext = orphanSlugs.map(slug => ({
    ticket_slug: slug,
    dispatch_counts_by_attribution: slugAttribution.get(slug) ?? Object.fromEntries(ATTRIBUTION_LEVELS.map(l => [l, 0])),
  }));

  // ── 输出（默认 allowlist；--include-paths 显式开启路径面——原始未遮蔽 cwd/票据路径，审查 P2-10）──
  // 路径解析：有 DIRECT dispatch → 该票首个 dispatch 实体的 bundle metadata cwd 原值；
  // 无 dispatch（orphan 类）→ 项目仓 docs/tickets 原始路径（projects.json 别名史首录原值）。
  const rawPathFor = (slug) => {
    const ds = bySlug.get(slug);
    if (ds && ds.length > 0) {
      const pk = ds[0].source_primary_key;
      const mp = join(bundleDir, 'metadata', pk);
      if (existsSync(mp)) {
        try { return String(JSON.parse(readFileSync(mp, 'utf8')).cwd ?? ''); } catch { /* 落空走票据路径 */ }
      }
    }
    try {
      const reg = JSON.parse(readFileSync(join(storeRoot, 'projects.json'), 'utf8'));
      const p = (reg.projects ?? []).find(x => x.project_id === manifest.project_id);
      const base = p?.alias_history?.[0]?.path ?? p?.aliases?.[0] ?? '';
      return join(base, 'docs', 'tickets', `${slug}.md`);
    } catch { return `docs/tickets/${slug}.md`; }
  };
  // ── stats-4 D4：orphan drift（--live-tickets 在场时——watermark 三态+行级率；drift 不判 fail）──
  let driftSection = null;
  if (liveSources) {
    const d = orphanDrift(storeRoot, manifest, gen, liveSources);
    if (d.error) return d.error;
    driftSection = d.drift;
  }
  const out = {
    command: 'verify', bundle_id: manifest.bundle_id, project_id: manifest.project_id,
    tickets_participating: participating.size, tickets_with_differences: new Set(differences.map(d => d.ticket_slug)).size,
    difference_rate: +ratio.toFixed(4), threshold: 0.05,
    differences: differences.map(d => includePaths
      ? { class: d.class, ticket_slug: d.ticket_slug, project_id: manifest.project_id, source_key: d.source_key, path: rawPathFor(d.ticket_slug) }
      : { class: d.class, ticket_slug: d.ticket_slug, project_id: manifest.project_id, source_key: d.source_key }),
    ...(driftSection ? { orphan_drift: driftSection } : {}),
    orphan_dispatch_context: orphanContext.length ? orphanContext : undefined,
    corpus_dispatch_attribution_distribution: corpusAttribution,
    role_status_identity: identity,
    include_paths: includePaths === true ? 'enabled（原始路径未遮蔽——显式开启）' : undefined,
  };
  console.log(JSON.stringify(out, null, 2));

  // ── P2-13：§5.8 pilot 评估报告工件（reports/ 白名单位；在 fail-loud 返回前产出——⑩ 红也留档）──
  if (writeReport) {
    const report = buildPilotReport({ manifest, latestDispatches, participating, differences, ratio, orphanContext, corpusAttribution, generation: gen });
    const reportPath = join(storeRoot, 'reports', `pilot-eval-${manifest.bundle_id}.json`);
    const { writeJson } = await import('./util.mjs');
    writeJson(reportPath, report);
    console.log(`[PILOT-REPORT] 已写入 ${reportPath}`);
  }

  if (!identityOk) {
    console.error(`IDENTITY_FAIL：role_status_counts 三恒等不成立（${JSON.stringify(identity)}）——⑦ fail-loud`);
    return EXIT.FAIL;
  }
  if (ratio > 0.05) {
    console.error(`CONSISTENCY_FAIL：差异率 ${ratio.toFixed(4)} > 5%（${out.tickets_with_differences}/${participating.size} 票）——M2 fail-loud（22 §5.2）`);
    return EXIT.FAIL;
  }
  if (driftSection && driftSection.orphan_rate > ORPHAN_RATE_THRESHOLD) {
    console.error(`ORPHAN_RATE_FAIL：行级 orphan 率 ${driftSection.orphan_rate} > ${ORPHAN_RATE_THRESHOLD}（${driftSection.orphan_rows}/${driftSection.live_dev_rows} 行——活仓新增行未入仓面超阈）——stats-4 ④ fail-loud（双率任一超阈）`);
    return EXIT.FAIL;
  }
  return EXIT.OK;
}

/** §5.8 pilot 评估报告（产物面：eligible repair episode 数、分类三率、五级归因分布、orphan 归因缺口说明）。
 *  stats-2 无 attempt 分类器（全部 dispatch=unclassified-v0/unknown）——episode 计数与 wrong_label_rate
 *  按 §2.2-11 协议归 stats-3 分类器接入后回填；本工件如实记 NOT_IDENTIFIABLE 与可机械计算面。
 *  effective-model-materialization r2（P1-1 哑弹双闸门修）：routeAnchorAvailable 的 effective_model 子条件
 *  =modelSelection 载荷在场判定（`!== 'unknown'` 判据维持——真值化后语义可达，不再结构性恒 unknown）；
 *  attempt_kind 子闸仍结构性拦截（归 stats-3 分类器票）——导出供组合用例直调（门裁定 P1-1(a)）。 */
export function buildPilotReport({ manifest, latestDispatches, participating, differences, ratio, orphanContext, corpusAttribution, generation }) {
  const total = latestDispatches.length;
  const routeAnchorAvailable = (e) => {
    const a = e.route_anchor;
    return Boolean(a && typeof a === 'object'
      && a.effective_model !== 'unknown' && a.route_hash !== 'unknown' && a.repo_models_config_hash !== 'unknown');
  };
  const eligible = latestDispatches.filter(e =>
    e.attempt_kind === 'quality_rework'
    && ['EXPLICIT', 'DIRECT', 'MANUAL_RECONCILED'].includes(e.attribution)
    && String(e.state ?? '').startsWith('terminal_')
    && routeAnchorAvailable(e));
  const unknownCount = latestDispatches.filter(e => e.attempt_kind === 'unknown').length;
  const compoundCount = latestDispatches.filter(e => e.attempt_kind === 'compound_unparseable').length;
  return {
    artifact_kind: 'pilot-evaluation-report',
    spec_anchor: 'docs/22 §5.8 产物面（eligible repair episode 数/分类三率（§2.2-11）/五级归因分布）',
    bundle_id: manifest.bundle_id,
    project_id: manifest.project_id,
    generation,
    eligible_repair_episodes: {
      count: eligible.length,
      criteria: 'attempt_kind=quality_rework ∧ attribution∈{EXPLICIT,DIRECT,MANUAL_RECONCILED} ∧ 终态 ∧ 路由锚可得（§5.8——三条件拆分独立评；effective_model 子条件=modelSelection 载荷在场判定〔effective-model r2〕）',
      dispatch_entities_total: total,
      not_identifiable: total - eligible.length,
      basis: '哑弹双闸门诊断（effective-model r2）：effective_model 子闸已随真值化可达（载荷在场≠unknown——routeAnchorAvailable 判据维持）；attempt_kind 子闸仍结构性拦截——stats-2 dispatch 恒 attempt_kind=unknown/classifier_version=unclassified-v0（attempt 分类器归 stats-3）→ 分类器接入前 episode 计数结构性为 0，全部实体计 NOT_IDENTIFIABLE',
    },
    classification_rates: {
      unknown_rate: total > 0 ? +(unknownCount / total).toFixed(4) : null,
      compound_rate: total > 0 ? +(compoundCount / total).toFixed(4) : null,
      wrong_label_rate: null,
      note: '§2.2-11 三率协议（held_out_acceptance_set ≥20 例）归 stats-3 ⑤⑥——stats-2 无分类器与 held-out 集，wrong_label_rate 无计算面记 null；unknown/compound 两率为 unclassified-v0 下的机械值',
    },
    attribution_distribution: corpusAttribution,
    ticket_consistency: {
      tickets_participating: participating.size,
      tickets_with_differences: new Set(differences.map(d => d.ticket_slug)).size,
      difference_rate: +ratio.toFixed(4),
      difference_classes: Object.fromEntries([...new Set(differences.map(d => d.class))].sort().map(c => [c, differences.filter(d => d.class === c).length])),
    },
    orphan_attribution_gap: {
      orphan_tickets: orphanContext,
      explanation: 'orphan_dispatch 差异源于 D7\' childSessionId 字段落地前的历史会话：metadata 无法建立 child 关联，cwd 归因谓词未命中 worktree 路径 → DIRECT 派发缺失——属已知归因缺口（非数据损坏）；dispatch_counts_by_attribution 佐证该 slug 是否存在非 DIRECT 级 dispatch',
    },
  };
}
