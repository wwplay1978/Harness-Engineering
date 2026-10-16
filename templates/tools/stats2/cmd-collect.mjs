// stats2/cmd-collect.mjs — collect：冻结 bundle 上的增量采集（docs/22 §5.4 全协议）
// 双源投影单源=project.mjs（与 rebuild --from-source 共用）；本文件承载采集协议面：
// upsert+revision 链 / open-set / 复合游标 (completed_at,id) / 唯一 commit point 提交链 /
// UNSUPPORTED_SOURCE 探针（三维独立+删列+版本越界+fingerprint→exit 60+cursor 冻结+零写入）/
// ⑨ 行数回退 fail-loud（audit 侧车）/ ① 幂等 no-op / F1-F6(a/b)+E1(alive|dead|reuse)+E2(a-d) 注入 /
// 生产产物过同一 contract-validator（P1-1）。
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStoreLayout, sweepTempDirs, ensureConfig, acquireLock, releaseLock, guardedRefreshHeartbeat, LockTakeoverError, MUTATION_LOCK } from './store.mjs';
import { rfc3339, writeJson } from './util.mjs';
import { validateFixture, projectionContentKey } from './contract-validator.mjs';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { parseFailpoint, requireFailpointMode, shouldFire, markFired, injectCursorCorruption, loadOracles, crashExit, FailpointUsageError, failpointCarrierError } from './failpoints.mjs';
import { projectBundleEvents } from './project.mjs';

export async function cmdCollect(opts) {
  const { storeRoot, flags, clock } = opts;
  const bundleArg = flags.bundle;
  if (!bundleArg) { console.error('collect 需要 --bundle <bundle_id>'); return EXIT.USAGE; }
  // P1-6：failpoint API 面校验（mode 必填且仅 once；裸 F6/E1/未知形=usage-error）
  let fp = null;
  try { requireFailpointMode(flags); fp = parseFailpoint(typeof flags.failpoint === 'string' ? flags.failpoint : null); }
  catch (e) { if (e instanceof FailpointUsageError) { console.error(`USAGE（failpoint）：${e.message}`); return EXIT.USAGE; } throw e; }
  // P3-6（四审）：承载表防线（CLI 入口已收口；此处覆盖直接调用面）——collect 仅承载 F 系+E1/E2 子型
  const carrierErr = failpointCarrierError('collect', fp);
  if (carrierErr) { console.error(`USAGE（failpoint）：${carrierErr}`); return EXIT.USAGE; }
  if (clock) console.log(`[AUDIT] --clock=${clock}（collect=bundle 模式；stale_orphan 72h 判定/时间基准冻结于该时钟——P2-1 使用必记）`);
  const nowIso = clock ?? rfc3339();
  const nowMs = clock ? Date.parse(clock) : Date.now();

  const fpStateDir = typeof flags['failpoint-state'] === 'string' ? flags['failpoint-state'] : join(storeRoot, 'quarantine', 'failpoint-state');
  const oracles = loadOracles(flags);

  // 仓布局+ACL（任何持久化写入前）→ TEMP 清扫 → 身份
  const checks = ensureStoreLayout(storeRoot);
  const aclFail = checks.find(c => !c.ok);
  if (aclFail) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }
  for (const line of sweepTempDirs(storeRoot, { nowMs })) console.log(`[TEMP] ${line}`);
  const { config } = ensureConfig(storeRoot, { injectedId: opts.injectedInstanceId, nowIso });
  const sid = config.source_instance_id;

  // E1 锁（三字段；oracle 判 alive/dead/reuse）——与 lifecycle 命令同一排它锁名（22 §5.4-8/E4，审查 P1-1）
  const lockName = MUTATION_LOCK;
  const lock = acquireLock(storeRoot, lockName, { livenessOracle: oracles.liveness ?? null, startTokenOracle: oracles.startToken ?? null });
  if (!lock.held) {
    if (fp && fp.id === 'E1') markFired(fp, fpStateDir);
    console.error(fp && fp.id === 'E1' ? `E1:alive——锁被活跃持有者持有（${lock.reason}）：不抢锁，零写入，exit 1` : `LOCK_HELD：${lock.reason}`);
    return EXIT.FAIL;
  }
  if (fp && fp.id === 'E1') markFired(fp, fpStateDir);   // dead/reuse：已按 oracle 打破接管，正常完成

  // P0-2：复制/投影/校验全程周期心跳——长复制分块间经 guardedRefreshHeartbeat 刷（所有权校验内建）；
  // 被接管（not-ok）即抛 LockTakeoverError → 本命令层转 exit≠0（不覆写锁、不提交、安全退出）
  const heartbeat = () => guardedRefreshHeartbeat(storeRoot, lockName);
  try {
    return await collectInner({ storeRoot, sid, bundleArg, nowIso, nowMs, fp, fpStateDir, flags, lockName, heartbeat });
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——collect 立即中止（至多一写者；未提交任何段/cursor）`); return EXIT.FAIL; }
    throw e;
  } finally {
    releaseLock(storeRoot, lockName);
  }
}

async function collectInner({ storeRoot, sid, bundleArg, nowIso, nowMs, fp, fpStateDir, flags, lockName, heartbeat }) {
  const bundleDir = join(storeRoot, 'snapshots', String(bundleArg));
  if (!existsSync(join(bundleDir, 'manifest.json'))) { console.error(`BUNDLE_NOT_FOUND：${bundleDir}`); return EXIT.FAIL; }

  // E2 注入（子型内联形：--failpoint E2a/E2b/E2c/E2d）：摆出损坏 cursor 终态，随后正常采集（启动检测→重建→继续 exit 0）
  const e2sub = fp && /^E2[abcd]$/.test(fp.id) ? fp.id.slice(2) : null;
  if (e2sub) {
    if (!existsSync(EE.cursorPath(storeRoot))) { console.error('E2 注入前提失败：cursor 不存在（须先完成基线 collect）'); return EXIT.FAIL; }
    console.log(injectCursorCorruption(e2sub, EE.cursorPath(storeRoot)));
    markFired(fp, fpStateDir);
  }

  // ── 恢复：partial→quarantine；cursor 载入（四型损坏→E2 重建，工件落 quarantine/）──
  const quarantineDir = join(storeRoot, 'quarantine');
  const rec = EE.recoverPending(storeRoot, quarantineDir);
  for (const q of rec.quarantined) console.log(`[RECOVERY] partial segment → quarantine：${q.from}`);
  let { cursor, corrupted, subtype } = EE.loadCursor(storeRoot);
  if (corrupted) {
    const rb = EE.rebuildCursorFromSegments(storeRoot, sid, { nowIso });
    cursor = rb.cursor;
    writeJson(EE.cursorPath(storeRoot), cursor);
    mkdirSync(quarantineDir, { recursive: true });
    writeJson(join(quarantineDir, `e2-rebuild-${Date.now()}.json`), { detected: subtype, rebuilt_from_segments: rb.rebuiltFrom, rebuilt_at: nowIso });
    console.log(`[RECOVERY] cursor ${subtype} 损坏→已从 segment manifests 重建（${rb.rebuiltFrom} 段）；工件落 quarantine/`);
  }

  // ── 投影（双源单源 project.mjs；缺列/缺表→UNSUPPORTED_SOURCE）──
  // P0-2：投影内的 bundle sqlite 副本复制为分块复制，块间经 heartbeat 刷心跳（长复制不累积心跳年龄）
  heartbeat();
  let proj;
  try {
    proj = projectBundleEvents({ storeRoot, bundleId: String(bundleArg), sid, nowIso, nowMs, onDbChunk: heartbeat });
  } catch (e) {
    if (e.code === 'UNSUPPORTED_SOURCE') { console.error(e.message); return EXIT.UNSUPPORTED_SOURCE; }
    throw e;
  }
  // 版本越界探针（③）：--bundle-version-probe 注入（默认 1=支持区间 [1,1]）
  const versionProbe = typeof flags['bundle-version-probe'] === 'string' ? Number(flags['bundle-version-probe']) : 1;
  if (!(versionProbe >= 1 && versionProbe <= 1)) {
    console.error(`UNSUPPORTED_SOURCE：bundle 契约版本越界（observed=${versionProbe}，supported=1..1）——cursor 冻结、零写入`);
    return EXIT.UNSUPPORTED_SOURCE;
  }

  // ⑨ 源回退检测（裁决③=audit 侧车补记）：行数与副本 MAX(id) 任一回退 → fail-loud+零写入
  // P1-8 加固：audit 损坏（截断/字段缺/checksum 不符）一律 fail-loud；corpus/cursor 在而 audit 缺失不再静默重建基线
  const auditP = EE.auditPath(storeRoot);
  const aud = EE.loadAudit(storeRoot);
  if (aud.problems) {
    console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——fail-loud（⑨ 侧车完整性，P1-8）`);
    return EXIT.FAIL;
  }
  const prevAudit = aud.audit;
  const observed = {
    row_count: proj.manifest.sqlite_copy.row_count, max_id: proj.observed_max_id,
    fingerprint: proj.fingerprint, bundle_id: proj.manifest.bundle_id,
    generation: EE.currentGeneration(storeRoot), updated_at: nowIso,
  };
  if (prevAudit && Number.isInteger(prevAudit.row_count) && observed.row_count < prevAudit.row_count) {
    if (!flags['accept-regression']) {
      console.error(`SOURCE_REGRESSION：源行数回退（${prevAudit.row_count} → ${observed.row_count}）——fail-loud（22 §5.4-3）`);
      return EXIT.FAIL;
    }
    // stats-hygiene-3：--accept-regression 显式覆写（人工核验宿主留存回收后方可加旗）——行数回退面降警告
    // 继续采集（禁默认：无旗标路径行为字节级不变）；audit 侧车记 accepted_regression 留痕（who/旧新行数/时间戳，
    // 随载荷入 payload_sha256）。旗标仅作用本面：下方 max-id 回退=更深的源损坏信号，恒 fail-loud 不受旗标作用。
    console.error(`[ACCEPT-REGRESSION] SOURCE_REGRESSION：源行数回退（${prevAudit.row_count} → ${observed.row_count}）经 --accept-regression 显式覆写——降警告继续采集（人工核验留存回收前提；audit 留痕 accepted_regression；22 §5.4-3 禁默认 fail-loud 的唯一显式豁免面）`);
    observed.accepted_regression = {
      who: '--accept-regression',
      prior_count: prevAudit.row_count,
      observed_count: observed.row_count,
      at: nowIso,
    };
  }
  if (prevAudit && typeof prevAudit.max_id === 'string' && prevAudit.max_id !== ''
    && String(observed.max_id) < prevAudit.max_id) {
    console.error(`SOURCE_REGRESSION：副本 MAX(model_usage.id) 回退（${prevAudit.max_id} → ${observed.max_id}）——fail-loud（22 §5.4-3，裁决③）`);
    return EXIT.FAIL;
  }
  // ③ fingerprint 跨轮持久比对（裁决配套）：audit 侧车钉定；不一致=schema 漂移 → UNSUPPORTED_SOURCE
  // （cursor 冻结+零写入；涵盖加列型漂移——列集哈希对超集变化敏感）
  if (prevAudit && typeof prevAudit.fingerprint === 'string' && prevAudit.fingerprint !== proj.fingerprint) {
    console.error(`UNSUPPORTED_SOURCE：schema fingerprint 跨轮漂移（${prevAudit.fingerprint.slice(0, 12)} → ${proj.fingerprint.slice(0, 12)}）——cursor 冻结、零写入`);
    return EXIT.UNSUPPORTED_SOURCE;
  }

  // ── 三维独立 unknown 探针（③：任一维 >5% → exit 60+cursor 冻结+零写入）──
  const overThreshold = Object.entries(proj.dim)
    .filter(([, v]) => v.total > 0 && v.unknown / v.total > 0.05)
    .map(([k, v]) => `${k} 维 unknown ${v.unknown}/${v.total}=${(v.unknown / v.total * 100).toFixed(1)}% >5%`);
  if (overThreshold.length) {
    console.error(`UNSUPPORTED_SOURCE：分维 unknown 超阈——${overThreshold.join('；')}；cursor 冻结、零写入`);
    return EXIT.UNSUPPORTED_SOURCE;
  }

  // ── upsert/revision：对照世代内既有实体状态（allowlist 投影不变→不产事件）──
  const genDir = EE.genDirOf(storeRoot, EE.currentGeneration(storeRoot));
  const corpus = EE.loadCorpus(genDir, { adapterId: 'zcode-sqlite' });   // stats-3：多 adapter 共享世代目录——本 adapter 判属过滤
  // P1-8：语料/cursor 已存在而 audit 缺失 → fail-loud（不静默重建 ⑨ 基线——缺失即回退检测面失守）
  if (!prevAudit && (corpus.events.length > 0 || cursor != null)) {
    console.error('AUDIT_MISSING：events 语料/cursor 已存在而 audit 侧车缺失（cursors/zcode-sqlite.audit.json）——fail-loud（P1-8；拒绝静默重建 ⑨ 基线）');
    return EXIT.FAIL;
  }
  heartbeat();   // P1-4/P0-2：分块处理间刷心跳——长任务不因超 120s 被误判 stale；被接管即中止
  const state0 = EE.entityState(corpus.events);
  // P1-7：contentKey=schema 驱动投影（event-schema-v1.json 按 event_kind 生成；禁手写清单）——
  // 单源=contract-validator.projectionContentKey（与单变量敏感性测试共用；覆盖 dispatch 必填的
  // created_at/project_id——旧手写清单漏项→源字段变更漏检为 no-op）；排除面见
  // contract-validator.revisionProjectionFields（身份公式成员+collected_at 采集时间戳非源内容）
  const contentKey = projectionContentKey;
  const newEvents = [];
  let fresh = 0, progressed = 0, unchanged = 0;
  for (const e of proj.events) {
    const prev = state0.get(e.entity_id);
    if (!prev) { e.source_revision = 1; fresh++; newEvents.push(e); continue; }
    if (contentKey(prev.latest) === contentKey(e)) { unchanged++; continue; }
    e.source_revision = prev.maxRev + 1;
    progressed++;
    newEvents.push(e);
  }
  for (const e of newEvents) e.event_id = `${e.entity_id}:${e.source_revision}`;
  newEvents.sort((a, b) => a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0);

  // ① 幂等 no-op 判定（含 F4/F5/F6b 恢复语义）：无新事件**且**无「已 closed 未入 cursor」段
  // → segment/manifest/cursor 全不动（全维度 no-op）；有待提交段 → cursor 重写收敛（重放幂等，事件恰一次）
  const cursorCommitted = new Set(cursor?.committed_segments ?? []);
  const pendingSegments = corpus.segments.filter(s => !cursorCommitted.has(s.file.replace(/\.jsonl$/, '')));
  if (newEvents.length === 0 && pendingSegments.length === 0) {
    EE.writeAudit(storeRoot, observed);
    console.log(JSON.stringify({
      command: 'collect', bundle_id: proj.manifest.bundle_id, noop: true,
      entities_unchanged: unchanged, segments: corpus.segments.length, events_total: corpus.events.length,
    }, null, 2));
    return EXIT.OK;
  }

  const mergedEvents = [...corpus.events, ...newEvents];
  const state1 = EE.entityState(mergedEvents);
  const openSet = [...state1.entries()].filter(([, st]) => !String(st.latest.state ?? '').startsWith('terminal_')).map(([eid]) => eid).sort();
  let terminal = cursor?.terminal_cursor ?? { completed_at: null, id: null };
  for (const e of newEvents) {
    if (e.completed_at == null) continue;
    if (terminal.completed_at == null || e.completed_at > terminal.completed_at
      || (e.completed_at === terminal.completed_at && String(e.entity_id) > String(terminal.id))) {
      terminal = { completed_at: e.completed_at, id: e.entity_id };
    }
  }
  for (const s of pendingSegments) {   // 待提交段的 cursor_after 并入推进位（重放收敛）
    const ca = s.manifest.cursor_after;
    if (ca?.completed_at == null) continue;
    if (terminal.completed_at == null || ca.completed_at > terminal.completed_at
      || (ca.completed_at === terminal.completed_at && String(ca.id ?? '') > String(terminal.id))) {
      terminal = { completed_at: ca.completed_at, id: ca.id };
    }
  }
  const committed = [...(cursor?.committed_segments ?? []), ...corpus.segments.map(s => s.file.replace(/\.jsonl$/, ''))]
    .filter((v, i, a) => a.indexOf(v) === i);
  const convergenceCursor = EE.makeCursor({
    sourceInstanceId: sid, terminalCursor: terminal,
    scanLowerBound: proj.manifest.time_range.from, openSet, committedSegments: committed, nowIso,
  });

  // 纯收敛路径（无新事件、有待提交段）：只走 cursor 原子重写（唯一提交点语义；不含未写出的段 id）
  if (newEvents.length === 0) {
    const { atomicWriteFile } = await import('./util.mjs');
    atomicWriteFile(EE.cursorPath(storeRoot), JSON.stringify(convergenceCursor, null, 2) + '\n');
    EE.writeAudit(storeRoot, observed);
    console.log(JSON.stringify({ command: 'collect', bundle_id: proj.manifest.bundle_id, convergence_adopted_segments: pendingSegments.map(s => s.file.replace(/\.jsonl$/, '')), events_new: 0 }, null, 2));
    return EXIT.OK;
  }

  const nextSeq = EE.nextSegmentSeq(genDir);
  const newSegId = `seg-${String(nextSeq).padStart(4, '0')}`;
  const newCursor = EE.makeCursor({
    sourceInstanceId: sid, terminalCursor: terminal,
    scanLowerBound: proj.manifest.time_range.from, openSet, committedSegments: [...committed, newSegId], nowIso,
  });

  // ── 生产校验前移（审查 P2-11 + P1-5 扩全）：新事件+新 cursor+**segment manifest** 全部在唯一提交点前
  //    预构造预验证（manifest 经 buildSegmentManifest 纯构造——与 commitSegment 写入面同一对象，零漂移）；
  //    红=零提交零 cursor 写（提交后校验保留为二道防线）──
  const prebuilt = EE.buildSegmentManifest({ seq: nextSeq, events: newEvents, cursor: newCursor, nowIso });
  const preErrs = [
    ...validateFixture({ fixture_kind: 'event-corpus', events: mergedEvents }),
    ...validateFixture({ fixture_kind: 'cursor-state', ...newCursor }),
    ...validateFixture({ fixture_kind: 'segment-manifest', ...prebuilt.manifest }),
  ];
  if (preErrs.length) {
    console.error(`PRODUCTION_VALIDATION_FAIL（pre-commit，零提交零 cursor 写）：\n${preErrs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);
    return EXIT.FAIL;
  }

  // ── 提交链（F 钩位=等价持久化终态注入）──
  heartbeat();   // P1-4/P0-2：提交前再刷（投影/校验耗时窗不累积为心跳年龄；被接管即中止、零提交）
  const fire = (fp && shouldFire(fp, fpStateDir)) ? fp : null;
  const hooks = {};
  if (fire) {
    if (fire.id === 'F1') hooks.F1 = () => crashExit(fire, fpStateDir, 'segment.tmp 写前——events/ 零新增');
    if (fire.id === 'F2') hooks.F2 = () => crashExit(fire, fpStateDir, 'segment.tmp 截断终态');
    if (fire.id === 'F3') hooks.F3 = () => crashExit(fire, fpStateDir, 'segment rename 后 manifest 前');
    if (fire.id === 'F4') hooks.F4 = () => crashExit(fire, fpStateDir, 'manifest fsync 后 cursor tmp 写前');
    if (fire.id === 'F5') hooks.F5 = () => crashExit(fire, fpStateDir, 'cursor tmp fsync 后 rename 前');
    if (fire.id === 'F6a') hooks.F6a = () => crashExit(fire, fpStateDir, 'cursor rename 持久化保留（父目录 fsync 前）');
    if (fire.id === 'F6b') hooks.F6b = () => crashExit(fire, fpStateDir, 'cursor rename 丢失终态（=F4 等价）');
  }
  const seg = await EE.commitSegment(storeRoot, { events: newEvents, cursor: newCursor, nowIso, hooks, explicitSeq: nextSeq, prebuilt });
  EE.writeAudit(storeRoot, observed);

  // ── 生产产物过同一 validator（P1-1）：全语料 + 新 segment manifest + cursor ──
  const allErrs = [
    ...validateFixture({ fixture_kind: 'event-corpus', events: mergedEvents }),
    ...validateFixture({ fixture_kind: 'segment-manifest', ...JSON.parse(readFileSync(seg.manifestPath, 'utf8')) }),
    ...validateFixture({ fixture_kind: 'cursor-state', ...newCursor }),
  ];
  if (allErrs.length) {
    console.error(`PRODUCTION_VALIDATION_FAIL：\n${allErrs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);
    return EXIT.FAIL;
  }

  console.log(JSON.stringify({
    command: 'collect', bundle_id: proj.manifest.bundle_id,
    segment: seg.segId, segment_sha256: seg.sha256,
    events_new: newEvents.length, entities_fresh: fresh, entities_progressed: progressed, entities_unchanged: unchanged,
    events_total: mergedEvents.length, open_set: openSet.length,
    terminal_cursor: newCursor.terminal_cursor,
    unknown_ratio: Object.fromEntries(Object.entries(proj.dim).map(([k, v]) => [k, v.total ? +(v.unknown / v.total).toFixed(4) : 0])),
    schema_fingerprint: proj.fingerprint.slice(0, 12),
    metadata_session_inconsistencies: proj.inconsistencies.length,   // M-note 重判留痕（§5.2 双面校验注记面）
  }, null, 2));
  return EXIT.OK;
}
