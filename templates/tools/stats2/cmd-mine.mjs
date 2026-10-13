// stats2/cmd-mine.mjs — stats-3 阶段三：票据 miner + reconcile + 跨源重叠检测
// 纪律：miner 复用 ticket-consistency-parser（parser.mjs——不重写，P0-4）+分类器派生层（classifier.mjs，
// 裁决⑨）；只消费冻结 pilot bundle（tickets/reviews/git_head——红线 1）；观察事件按 event_id 追加
// （§5.2 行 224 event-sourced）；classifier_version+derivation_revision 落事件（§2.2-9）；
// reconcile 归因者/依据/源 hash 持久记录=输入工件内容寻址归档（仓 snapshots/reconcile/<sha8>/input.json）。
import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex, sha256File, writeJson, rfc3339, canon, atomicWriteFile } from './util.mjs';
import { validateFixture, projectionContentKey } from './contract-validator.mjs';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { ensureStoreLayout, sweepTempDirs, ensureConfig, acquireLock, releaseLock, guardedRefreshHeartbeat, LockTakeoverError, MUTATION_LOCK } from './store.mjs';
import { parseTicketRunLog, sha8 } from './parser.mjs';
import { classifyRow, CLASSIFIER_VERSION } from './classifier.mjs';
import { loadNativeAudit, writeNativeAudit, STARTED_AT_SENTINEL } from './native-source.mjs';

export const MINER_ADAPTER_ID = 'ticket-miner';
export const RECONCILE_ADAPTER_ID = 'manual-reconcile';

/** reviews 目录内该 slug 的拒因工件清单（bundle 冻结面；文件名 allowlist=附件 A review_artifacts）。 */
function reviewArtifactsFor(bundleDir, slug, reviewFiles) {
  return reviewFiles.filter(f => f.startsWith(slug + '-') || f.startsWith(slug + '.')).sort();
}

/** bundle 装载与校验。 */
function loadBundle(storeRoot, bundleId) {
  const dir = join(storeRoot, 'snapshots', String(bundleId));
  const mpath = join(dir, 'manifest.json');
  if (!existsSync(mpath)) return { error: `BUNDLE_NOT_FOUND：${dir}` };
  const manifest = JSON.parse(readFileSync(mpath, 'utf8'));
  return { manifest, dir };
}

/** M2 读取语义（§5.2 行 221）：实体 → 最新有效派生，**manual 全局优先于 auto**（人工更正=更高
 *  优先级派生——任意 manual 胜任意 auto；同 origin 内取最大 revision）。历史派生只进 audit——
 *  本函数返回的即 report 消费面。（返修轮 P1 配套：此前仅同 revision 内 manual＞auto，后被更高
 *  revision 的 auto 派生遮蔽人工更正——与 §5.2 优先级语义不符。）
 *  注意：M2 有效值与 revision 基线是两回事——新派生 revision 基线恒取该实体**全 origin 最大**
 *  derivation_revision（见 cmdMine/cmdReconcile 的 maxRev 计算），保证 event_id 全局不碰撞。 */
export function effectiveDerivations(events) {
  const bestAuto = new Map();
  const bestManual = new Map();
  for (const e of events) {
    if (e.event_kind !== 'observation' || e.observation_subtype !== 'derived') continue;
    const bucket = e.derivation_origin === 'manual' ? bestManual : bestAuto;
    const prev = bucket.get(e.entity_id);
    if (!prev || e.derivation_revision > prev.derivation_revision) bucket.set(e.entity_id, e);
  }
  return new Map([...bestAuto, ...bestManual]);   // manual 覆盖同 entity 的 auto
}

/** 实体 → 全 origin 最大 derivation_revision（新派生 revision 基线——未过滤口径，P1 返修）。 */
export function maxDerivationRevision(events) {
  const m = new Map();
  for (const e of events) {
    if (e.event_kind !== 'observation' || e.observation_subtype !== 'derived') continue;
    const prev = m.get(e.entity_id) ?? 0;
    if (e.derivation_revision > prev) m.set(e.entity_id, e.derivation_revision);
  }
  return m;
}

/** 实体 → 最新 auto 派生（mine 幂等 no-op 的同源比较面——auto-vs-auto，manual 更正不参与）。 */
export function latestAutoDerivation(events) {
  return effectiveDerivations(events.filter(e => e.derivation_origin !== 'manual'));
}

/** 行级分类事件载荷（ticket_snapshot + derived auto）。 */
function rowObservations({ manifest, dir, slug, rows, reviewFiles, sid, nowIso }) {
  const ticketText = readFileSync(join(dir, 'tickets', `${slug}.md`), 'utf8');
  const sourceHash8 = sha256Hex(ticketText).slice(0, 8);
  const artifacts = reviewArtifactsFor(dir, slug, reviewFiles);
  const snapshots = [];
  const derivations = [];
  for (const row of rows) {
    const pk = `tickets/${slug}.md#L${row.line}`;
    const entityId = `${sid}:${MINER_ADAPTER_ID}:${pk}`;
    snapshots.push({
      schema_version: 'v1', event_kind: 'observation', event_id: `${entityId}:obs:${sourceHash8}`,
      entity_id: entityId, source_instance_id: sid, adapter_id: MINER_ADAPTER_ID, adapter_type: 'append-only',
      source_primary_key: pk, collected_at: nowIso,
      observation_subtype: 'ticket_snapshot', ticket_slug: slug, source_hash8: sourceHash8,
      snapshot: {
        attempt_column_raw: row.attempt_raw, attempt_no: row.attempt_no, role_column_raw: row.role,
        result_column_raw: row.result, date_column_raw: row.date, note_column_raw: row.note,
        // VR-S33（attribution-explicit-closure r2）：执行会话标识三值直通（parser 原名——P3-1 禁映射）。
        // 存量语义（票面已裁事实）：dedupe=event_id 含票文件 hash——存量快照不自动升级，唯一自然
        // 升级路径=票文件再变更后重 mine（新 hash→新 event）；全量回填不做（VR-F03 冻结）。
        execution_session: { session_id: row.session_id, session_host_na: row.session_host_na, session_host_marker: row.session_host_marker },
        review_artifacts: artifacts,
        source_refs: { tickets_path: `tickets/${slug}.md`, line_range: `${row.line}-${row.line}` },
      },
    });
    if (!row.is_developer) continue;   // attempt 分类面=developer(±rerun) 行
    const d = classifyRow(row, { reviewArtifacts: artifacts });
    d.decided_at = nowIso;
    derivations.push({
      schema_version: 'v1', event_kind: 'observation', event_id: '',
      entity_id: entityId, source_instance_id: sid, adapter_id: MINER_ADAPTER_ID, adapter_type: 'append-only',
      source_primary_key: pk, collected_at: nowIso,
      observation_subtype: 'derived', derivation_revision: 1, classifier_version: CLASSIFIER_VERSION,
      derivation_origin: 'auto', derivation: d,
    });
  }
  return { snapshots, derivations };
}

/** `mine --bundle <id>`：票据面观察事件采集（幂等：同源 hash 快照同 event_id；派生同内容不加 revision）。 */
export async function cmdMine(opts) {
  const { storeRoot, flags, clock } = opts;
  const bundleArg = flags.bundle;
  if (!bundleArg) { console.error('mine 需要 --bundle <pilot_bundle_id>（冻结 tickets/reviews 面）'); return EXIT.USAGE; }
  if (clock) console.log(`[AUDIT] --clock=${clock}（mine；collected_at/decided_at 冻结于该时钟）`);
  const nowIso = clock ?? rfc3339();
  const checks = ensureStoreLayout(storeRoot);
  const aclFail = checks.find(c => !c.ok);
  if (aclFail) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }
  for (const line of sweepTempDirs(storeRoot)) console.log(`[TEMP] ${line}`);
  const { config } = ensureConfig(storeRoot, { injectedId: opts.injectedInstanceId, nowIso });
  const sid = config.source_instance_id;
  const lock = acquireLock(storeRoot, MUTATION_LOCK);
  if (!lock.held) { console.error(`LOCK_HELD：${lock.reason}`); return EXIT.FAIL; }
  try {
    const { manifest, dir, error } = loadBundle(storeRoot, bundleArg);
    if (error) { console.error(error); return EXIT.FAIL; }
    // bundle reviews 目录物化清单（freezeTicketsReviews 只存 sha 聚合——逐文件名从目录重读）
    const reviewNames = existsSync(join(dir, 'reviews')) ? readdirSync(join(dir, 'reviews')).sort() : [];

    // 投影：逐 slug 行级观察事件
    const allSnapshots = [];
    const allDerivations = [];
    for (const slug of manifest.tickets_reviews.slug_list) {
      const rows = parseTicketRunLog(readFileSync(join(dir, 'tickets', `${slug}.md`), 'utf8'));
      const { snapshots, derivations } = rowObservations({ manifest, dir, slug, rows, reviewFiles: reviewNames, sid, nowIso });
      allSnapshots.push(...snapshots);
      allDerivations.push(...derivations);
    }

    // 仓内既有状态（P1 返修：双口径装载）——
    //   修订基线/校验面=未过滤全仓（reconcile 的 manual 段事件携带 ticket-miner 实体面，段判属=manual-reconcile，
    //   adapter 过滤装载会漏掉它们→effD/maxRev 缺位→重算已存在 revision=event_id 全局碰撞）；
    //   段/游标面=adapter 过滤（提交链与 pending 段范围）；snapshot dedupe=adapter 过滤（reconcile 不产 ticket_snapshot）。
    const genDir = EE.genDirOf(storeRoot, EE.currentGeneration(storeRoot));
    const corpus = EE.loadCorpus(genDir, { adapterId: MINER_ADAPTER_ID });
    const allEventsUnfiltered = EE.loadCorpus(genDir).events;
    const existingSnapshotIds = new Set(corpus.events.filter(e => e.observation_subtype === 'ticket_snapshot').map(e => e.event_id));
    const maxRev = maxDerivationRevision(allEventsUnfiltered);
    const latestAuto = latestAutoDerivation(allEventsUnfiltered);
    const newEvents = [];
    let snapNew = 0, snapUnchanged = 0, drvNew = 0, drvUnchanged = 0;
    for (const s of allSnapshots) {
      if (existingSnapshotIds.has(s.event_id)) { snapUnchanged++; continue; }
      snapNew++; newEvents.push(s);
    }
    for (const d of allDerivations) {
      // 幂等 no-op=auto-vs-auto 同源比较（manual 更正不参与比较面——M2 manual 全局优先，不因再 mine 被遮蔽）；
      // 分类内容相等=derivation 去 decided_at（判定时刻非分类内容——异时钟再 mine 不得虚增 revision）
      const classContent = (dv) => { const { decided_at: _t, ...rest } = dv; return canon(rest); };
      const prevAuto = latestAuto.get(d.entity_id);
      if (prevAuto && prevAuto.classifier_version === d.classifier_version
        && classContent(prevAuto.derivation) === classContent(d.derivation)) { drvUnchanged++; continue; }
      d.derivation_revision = (maxRev.get(d.entity_id) ?? 0) + 1;
      d.event_id = `${d.entity_id}:drv:${d.derivation_revision}`;
      drvNew++; newEvents.push(d);
    }
    newEvents.sort((a, b) => a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0);

    // audit（miner 侧车：bundle 面 files_digest=tickets_reviews.sha256）
    const observed = {
      corpus_id: `bundle:${manifest.bundle_id}`, files_digest: manifest.tickets_reviews.sha256,
      file_count: manifest.tickets_reviews.slug_list.length, generation: EE.currentGeneration(storeRoot),
      updated_at: nowIso,
    };
    const aud = loadNativeAudit(storeRoot, MINER_ADAPTER_ID);
    if (aud.problems) { console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——fail-loud`); return EXIT.FAIL; }
    if (!aud.audit && (corpus.events.length > 0 || EE.loadCursor(storeRoot, MINER_ADAPTER_ID).cursor != null)) {
      console.error('AUDIT_MISSING：miner 语料/cursor 已存在而 audit 缺失——fail-loud（P1-8 同族）');
      return EXIT.FAIL;
    }

    if (newEvents.length === 0) {
      writeNativeAudit(storeRoot, MINER_ADAPTER_ID, observed);
      console.log(JSON.stringify({ command: 'mine', bundle_id: manifest.bundle_id, noop: true,
        snapshots_unchanged: snapUnchanged, derivations_unchanged: drvUnchanged, events_total: corpus.events.length }, null, 2));
      return EXIT.OK;
    }

    // 提交链（ticket-miner adapter；游标 id=relpath#line——裁决⑦）
    const prevCursor = EE.loadCursor(storeRoot, MINER_ADAPTER_ID).cursor;
    const cursorCommitted = new Set(prevCursor?.committed_segments ?? []);
    const pendingSegments = corpus.segments.filter(s => !cursorCommitted.has(s.file.replace(/\.jsonl$/, '')));
    let terminal = prevCursor?.terminal_cursor ?? { completed_at: null, id: null };
    for (const e of newEvents) {
      const cand = { completed_at: e.collected_at, id: e.source_primary_key };
      if (EE.cursorAfter(terminal, cand, MINER_ADAPTER_ID)) terminal = cand;
    }
    for (const s of pendingSegments) {
      const ca = s.manifest.cursor_after;
      if (ca && EE.cursorAfter(terminal, ca, MINER_ADAPTER_ID)) terminal = { completed_at: ca.completed_at, id: ca.id };
    }
    const committed = [...(prevCursor?.committed_segments ?? []), ...corpus.segments.map(s => s.file.replace(/\.jsonl$/, ''))]
      .filter((v, i, a) => a.indexOf(v) === i);
    if (pendingSegments.length > 0 && newEvents.every(e => e.observation_subtype === 'ticket_snapshot' && existingSnapshotIds.has(e.event_id))) {
      // 纯收敛
      const conv = EE.makeCursor({ sourceInstanceId: sid, terminalCursor: terminal, scanLowerBound: manifest.time_range.from,
        openSet: [], committedSegments: committed, nowIso, adapterId: MINER_ADAPTER_ID });
      const { atomicWriteFile } = await import('./util.mjs');
      atomicWriteFile(EE.cursorPath(storeRoot, MINER_ADAPTER_ID), JSON.stringify(conv, null, 2) + '\n');
      writeNativeAudit(storeRoot, MINER_ADAPTER_ID, observed);
      console.log(JSON.stringify({ command: 'mine', convergence_adopted_segments: pendingSegments.length, events_new: 0 }, null, 2));
      return EXIT.OK;
    }
    const nextSeq = EE.nextSegmentSeq(genDir);
    const newSegId = `seg-${String(nextSeq).padStart(4, '0')}`;
    const newCursor = EE.makeCursor({ sourceInstanceId: sid, terminalCursor: terminal, scanLowerBound: manifest.time_range.from,
      openSet: [], committedSegments: [...committed, newSegId], nowIso, adapterId: MINER_ADAPTER_ID });
    const prebuilt = EE.buildSegmentManifest({ seq: nextSeq, events: newEvents, cursor: newCursor, nowIso, adapterId: MINER_ADAPTER_ID });
    const mergedEvents = [...corpus.events, ...newEvents];
    const preErrs = [
      ...validateFixture({ fixture_kind: 'event-corpus', events: mergedEvents }),
      ...validateFixture({ fixture_kind: 'cursor-state', ...newCursor }),
      ...validateFixture({ fixture_kind: 'segment-manifest', ...prebuilt.manifest }),
    ];
    if (preErrs.length) {
      console.error(`PRODUCTION_VALIDATION_FAIL（pre-commit）：\n${preErrs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);
      return EXIT.FAIL;
    }
    const seg = await EE.commitSegment(storeRoot, { events: newEvents, cursor: newCursor, nowIso, explicitSeq: nextSeq, prebuilt, adapterId: MINER_ADAPTER_ID });
    writeNativeAudit(storeRoot, MINER_ADAPTER_ID, observed);
    console.log(JSON.stringify({
      command: 'mine', bundle_id: manifest.bundle_id, segment: seg.segId, segment_sha256: seg.sha256,
      snapshots_new: snapNew, snapshots_unchanged: snapUnchanged,
      derivations_new: drvNew, derivations_unchanged: drvUnchanged,
      classifier_version: CLASSIFIER_VERSION, events_total: mergedEvents.length,
      join_note: '派生事件挂行实体（tickets/<slug>.md#L<line>）；dispatch 级有效分类=report 侧按 slug+attempt 序 join（CANDIDATE 零入票级——VR-F08/S11）',
    }, null, 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——mine 立即中止`); return EXIT.FAIL; }
    throw e;
  } finally {
    releaseLock(storeRoot, MUTATION_LOCK);
  }
}

/** `reconcile --input <file>`：人工更正 → origin=manual derived 事件 + 输入工件归档。 */
export async function cmdReconcile(opts) {
  const { storeRoot, flags, clock } = opts;
  const inputFile = flags.input;
  if (!inputFile || typeof inputFile !== 'string') { console.error('reconcile 需要 --input <reconcile 输入文件（附件 A schema）>'); return EXIT.USAGE; }
  if (clock) console.log(`[AUDIT] --clock=${clock}（reconcile；collected_at 冻结于该时钟——decided_at 恒取输入 created_at）`);
  const nowIso = clock ?? rfc3339();
  if (!existsSync(inputFile)) { console.error(`INPUT_NOT_FOUND：${inputFile}`); return EXIT.USAGE; }
  const inputText = readFileSync(inputFile, 'utf8');
  let input;
  try { input = JSON.parse(inputText); }
  catch (e) { console.error(`INPUT_UNPARSEABLE：${e.message}`); return EXIT.USAGE; }
  const errs = validateFixture({ fixture_kind: 'reconcile-input', ...input });
  if (errs.length) {
    console.error(`INPUT_INVALID（附件 A reconcile 输入 schema）：\n${errs.map(e => `  ${e.rule} ${e.pointer}——${e.message}`).join('\n')}`);
    return EXIT.USAGE;
  }

  const checks = ensureStoreLayout(storeRoot);
  const aclFail = checks.find(c => !c.ok);
  if (aclFail) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }
  for (const line of sweepTempDirs(storeRoot)) console.log(`[TEMP] ${line}`);
  const { config } = ensureConfig(storeRoot, { injectedId: opts.injectedInstanceId, nowIso });
  const sid = config.source_instance_id;
  const lock = acquireLock(storeRoot, MUTATION_LOCK);
  if (!lock.held) { console.error(`LOCK_HELD：${lock.reason}`); return EXIT.FAIL; }
  try {
    // 输入工件内容寻址归档（§2.3 记录面：归因者/依据/源 hash 持久记录）
    const sha8v = sha256Hex(inputText).slice(0, 8);
    const archiveDir = join(storeRoot, 'snapshots', 'reconcile', sha8v);
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
      copyFileSync(inputFile, join(archiveDir, 'input.json'));
    }

    // 目标实体当前有效值（携带面：未更正维沿当前有效值）
    const genDir = EE.genDirOf(storeRoot, EE.currentGeneration(storeRoot));
    const allEvents = EE.loadCorpus(genDir).events;
    const effD = effectiveDerivations(allEvents);       // 携带值面（manual 全局优先）
    const maxRevAll = maxDerivationRevision(allEvents); // revision 基线=全 origin 最大（P1 返修：防与更高 auto revision 碰撞）
    const dispatchById = new Map();
    for (const e of allEvents) if (e.event_kind === 'dispatch') dispatchById.set(e.entity_id, e);

    const newEvents = [];
    for (const target of input.target_entity_ids) {
      const prev = effD.get(target);
      const disp = dispatchById.get(target);
      const carriedKind = input.attempt_kind ?? prev?.derivation?.attempt_kind ?? disp?.attempt_kind ?? 'unknown';
      const carriedStage = input.trigger_stage ?? prev?.derivation?.trigger_stage ?? disp?.trigger_stage ?? 'unknown';
      const revision = (maxRevAll.get(target) ?? 0) + 1;
      // 事件身份=目标实体面（VR-F01：adapter 字段承载实体源 adapter——pos-01 冻结模型；
      // manual-reconcile=书写/提交链 adapter，segment manifest 与 cursor 判属用）
      const [inst, targetAdapter, ...rest] = String(target).split(':');
      const pk = rest.join(':');
      newEvents.push({
        schema_version: 'v1', event_kind: 'observation', event_id: `${target}:drv:${revision}`,
        entity_id: target, source_instance_id: sid,
        adapter_id: targetAdapter, adapter_type: EE.APPEND_ONLY_ADAPTERS.has(targetAdapter) ? 'append-only' : 'mutable-row',
        source_primary_key: pk, collected_at: nowIso,
        observation_subtype: 'derived', derivation_revision: revision, classifier_version: CLASSIFIER_VERSION,
        derivation_origin: 'manual',
        derivation: {
          attempt_kind: carriedKind, trigger_stage: carriedStage, secondary_cause: null,
          primary_signal_level: 'explicit',
          signal_evidence: { matched_phrase: null, structural_basis: input.basis },
          decided_at: input.created_at,
        },
      });
    }
    newEvents.sort((a, b) => a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0);

    // 提交（manual-reconcile adapter；输入文件驱动——游标=提交点记录）
    const corpus = EE.loadCorpus(genDir, { adapterId: RECONCILE_ADAPTER_ID });
    const prevCursor = EE.loadCursor(storeRoot, RECONCILE_ADAPTER_ID).cursor;
    const cursorCommitted = new Set(prevCursor?.committed_segments ?? []);
    const pendingSegments = corpus.segments.filter(s => !cursorCommitted.has(s.file.replace(/\.jsonl$/, '')));
    let terminal = prevCursor?.terminal_cursor ?? { completed_at: null, id: null };
    for (const e of newEvents) {
      const cand = { completed_at: e.collected_at, id: `reconcile/${sha8v}/${e.source_primary_key}` };
      if (EE.cursorAfter(terminal, cand, RECONCILE_ADAPTER_ID)) terminal = cand;
    }
    const committed = [...(prevCursor?.committed_segments ?? []), ...corpus.segments.map(s => s.file.replace(/\.jsonl$/, ''))]
      .filter((v, i, a) => a.indexOf(v) === i);
    const observed = {
      corpus_id: `reconcile:${input.ticket_slug}:${sha8v}`, files_digest: sha256Hex(inputText),
      file_count: 1, generation: EE.currentGeneration(storeRoot), updated_at: nowIso,
    };
    const nextSeq = EE.nextSegmentSeq(genDir);
    const newSegId = `seg-${String(nextSeq).padStart(4, '0')}`;
    const newCursor = EE.makeCursor({ sourceInstanceId: sid, terminalCursor: terminal, scanLowerBound: null,
      openSet: [], committedSegments: [...committed, newSegId], nowIso, adapterId: RECONCILE_ADAPTER_ID });
    const prebuilt = EE.buildSegmentManifest({ seq: nextSeq, events: newEvents, cursor: newCursor, nowIso, adapterId: RECONCILE_ADAPTER_ID });
    const mergedEvents = [...corpus.events, ...newEvents];
    const preErrs = [
      ...validateFixture({ fixture_kind: 'event-corpus', events: mergedEvents }),
      ...validateFixture({ fixture_kind: 'cursor-state', ...newCursor }),
      ...validateFixture({ fixture_kind: 'segment-manifest', ...prebuilt.manifest }),
    ];
    if (preErrs.length) {
      console.error(`PRODUCTION_VALIDATION_FAIL（pre-commit，零提交）：\n${preErrs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);
      return EXIT.FAIL;
    }
    const seg = await EE.commitSegment(storeRoot, { events: newEvents, cursor: newCursor, nowIso, explicitSeq: nextSeq, prebuilt, adapterId: RECONCILE_ADAPTER_ID });
    writeNativeAudit(storeRoot, RECONCILE_ADAPTER_ID, observed);
    console.log(JSON.stringify({
      command: 'reconcile', ticket_slug: input.ticket_slug, reconciler: input.reconciler,
      input_archive: `snapshots/reconcile/${sha8v}/input.json`,
      segment: seg.segId, segment_sha256: seg.sha256,
      targets: input.target_entity_ids.length, derivations_manual: newEvents.length,
      attribution_level: input.attribution_level,
    }, null, 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——reconcile 立即中止`); return EXIT.FAIL; }
    throw e;
  } finally {
    releaseLock(storeRoot, MUTATION_LOCK);
  }
}

/** 跨源重叠检测（P2-4 处置：同窗同 project 重叠率——描述性输出，双计面披露非去重动作）。
 *  native 会话区间=[会话首末事件时戳]；zcode dispatch 区间=[created_at,completed_at]；
 *  project 匹配=native corpus project_id（裁决⑧ 谓词产物）vs dispatch.project_id。
 *  @returns {{project_id, native_sessions, overlapping, overlap_rate, overlapping_pairs_sample}} */
export function crossSourceOverlap(storeEvents, { project_id }) {
  const dispatches = storeEvents.filter(e => e.event_kind === 'dispatch' && e.project_id === project_id
    && e.state.startsWith('terminal_') && e.created_at && e.completed_at);
  const byFile = new Map();
  for (const e of storeEvents) {
    if (e.event_kind !== 'model-request' || (e.adapter_id !== 'kimi-wire' && e.adapter_id !== 'codex-sessions')) continue;
    if (e.state === 'unknown' || e.started_at === STARTED_AT_SENTINEL) continue;   // F-4：时戳哨兵/unknown 行无真实会话窗——防假重叠膨胀
    const file = String(e.source_primary_key).split('#')[0];
    const t = e.started_at;
    if (!t) continue;
    const prev = byFile.get(`${e.adapter_id}|${file}`);
    if (!prev) byFile.set(`${e.adapter_id}|${file}`, { adapter: e.adapter_id, file, first: t, last: t });
    else {
      if (t < prev.first) prev.first = t;
      if (t > prev.last) prev.last = t;
    }
  }
  const sessions = [...byFile.values()];
  const overlapping = [];
  for (const s of sessions) {
    const hitD = dispatches.find(d => {
      const ds = d.created_at <= s.last && d.completed_at >= s.first;   // 区间相交
      return ds;
    });
    if (hitD) overlapping.push({ session: `${s.adapter}:${s.file}`, dispatch: hitD.entity_id, window: [s.first, s.last] });
  }
  return {
    project_id,
    native_sessions: sessions.length,
    overlapping: overlapping.length,
    overlap_rate: sessions.length ? +(overlapping.length / sessions.length).toFixed(4) : 0,
    overlapping_pairs_sample: overlapping.slice(0, 20),
    note: '同窗同 project 重叠率（描述性披露：双源记录同一工作的双计面——22 未定义去重动作，stats-4/5 消费面裁）',
  };
}
