// stats2/cmd-lifecycle.mjs — 仓生命周期命令（审查 P0-2；docs/22 §5.4-5/§5.5）
//   validate             ：cursor checksum/segment SHA/事件语料三层 validator/committed 悬空/audit 一致性 全检
//   rebuild --from-source：E3 世代协议——gen-N+1 全量重建（project.mjs 单源）→校验→原子切代指针→旧代保留
//   compact              ：E4 水位+引用保护（排它锁；被 report manifest segment_shas 引用段不并入；新世代切换）
//   prune                ：bundle 引用计数保留（⑫：被 report 引用不删；未引用保最近 3 份）+旧代清理
//   migrate-audit        ：显式维护——legacy audit（精确五键）核验一致后升级七字段新格式+[AUDIT-MIGRATED] 留痕
// P0-2（三审）：全部命令的复制/投影/校验全程经 guardedRefreshHeartbeat 刷心跳；锁被接管即中止（非零退出）。
// P1-7/P1-8（三审）：validate/compact 纳入 audit 一致性；prune 先完整建立并验证引用集再进删除阶段。
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureStoreLayout, acquireLock, releaseLock, guardedRefreshHeartbeat, LockTakeoverError, MUTATION_LOCK } from './store.mjs';
import { rfc3339, writeJson } from './util.mjs';
import { validateFixture } from './contract-validator.mjs';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import { parseFailpoint, requireFailpointMode, shouldFire, crashExit, FailpointUsageError, failpointCarrierError } from './failpoints.mjs';
import { projectBundleEvents } from './project.mjs';

/** failpoint API 面校验（P1-6：mode 必填且仅 once；非法形=usage-error）。返回解析结果或 null。 */
function parseFailpointFlags(flags) {
  try {
    requireFailpointMode(flags);
    return { fp: parseFailpoint(typeof flags.failpoint === 'string' ? flags.failpoint : null) };
  } catch (e) {
    if (e instanceof FailpointUsageError) return { usageError: e.message };
    throw e;
  }
}

/** E3/E4 崩溃残留治理：目标新代目录已存在而代指针未切 → 整目录废弃重写（未提交内容可弃；P1-6 E4 通道配套）。 */
function discardCrashLeftover(storeRoot, next) {
  const dir = EE.genDirOf(storeRoot, next);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  return EE.ensureGenerationDir(storeRoot, next);
}

function readCursorOrNone(storeRoot) {
  const p = EE.cursorPath(storeRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// ── stats-4 红队修复轮二 P1-1①/P2-4：引用集工件扫描（递归+解析红线收窄）──
/** reports/ 递归全子目录收集 *.json（含周桶 <iso-week>/ 内 manifest/report 体）——相对名序确定性。
 *  stats-4 report --out 历史序列落 reports/<iso-week-year>-W<ww>/，顶层-only 扫描令周桶 manifest
 *  逃逸 compact/prune 引用保护（P1-1 红队实锤）。 */
function listReportArtifacts(reportsDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith('.json')) out.push({ rel: `${rel}${e.name}`, abs: join(dir, e.name) });
    }
  };
  walk(reportsDir, '');
  return out;
}

/** 引用承载形态族（**文件名级**识别）：report manifest（*.manifest.json）与 pilot-eval 评估工件
 *  （pilot-eval-*.json）。双重防线：①族内解析失败仍 fail-loud（引用面不可判定）；②族内解析成功但
 *  承载 kind 缺失/不匹配 → fail-loud（票 C P0-3：修复前 kind 不匹配即静默跳过——伪装改名/半写工件
 *  可令保护集悄悄漏掉该文件的引用贡献；引用承载族文件名=保留名，工件须自证身份）。
 *  P2-4 裁断：族外形态（verify-watermark/report 体等非引用承载面）解析异常 → WARN 不锁死维护命令
 *  （append 永存工件累积损坏不得令 compact/prune 永久红）。裁断理由：fail-loud 在此是保守绊线而非
 *  保护本体——保护来自「可解析工件的引用集贡献」，损坏工件无论红线与否都不贡献引用；伪装改名绕过
 *  绊线不削弱保护，仅放弃对已损坏文件的挡停（其引用本就不可判定且不因挡停而恢复）。
 *  内容级识别与文件名族的现行关系（票 C 对齐）：族内文件 kind 匹配是内容识别的**前置门槛**
 *  （kind≠族身份=引用面不可判定红线）；族外形态按内容识别（可解析且携带 report-manifest/
 *  pilot-evaluation-report 内容的照常入引用集——多保护一份无害）。 */
const MANIFEST_JSON_NAME_RE = /\.manifest\.json$/;
const PILOT_EVAL_NAME_RE = /(^|\/)pilot-eval-[^/]*\.json$/;
const REFERENCE_BEARING_FAMILY = [PILOT_EVAL_NAME_RE, MANIFEST_JSON_NAME_RE];
const isReferenceBearingName = (rel) => REFERENCE_BEARING_FAMILY.some(re => re.test(rel));

/** 票 C P0-3（E4 kind fail-loud）：引用承载族 kind 门槛检查——族内命中而 kind 缺失/不匹配 →
 *  refProblems（调用方 compact/prune 在任何变更前 fail-loud）。 */
function referenceKindProblems(rel, j) {
  const problems = [];
  if (MANIFEST_JSON_NAME_RE.test(rel) && j?.manifest_kind !== 'report-manifest') {
    problems.push(`report manifest kind 失配：${rel}（manifest_kind=${JSON.stringify(j?.manifest_kind ?? null)} ≠ report-manifest）——引用承载族文件须承载 report-manifest kind（P0-3）`);
  }
  if (PILOT_EVAL_NAME_RE.test(rel) && j?.artifact_kind !== 'pilot-evaluation-report') {
    problems.push(`pilot-eval 工件 kind 失配：${rel}（artifact_kind=${JSON.stringify(j?.artifact_kind ?? null)} ≠ pilot-evaluation-report）——引用承载族文件须承载 pilot-evaluation-report kind（P0-3）`);
  }
  return problems;
}

// stats-5 红队修复轮三 P2-3：b9-closure-matrix 工件世代锚识别（文件名级——P3-5 钉死自动生成名）。
// 仅 prune 消费其 generation（旧代清理保护面）；compact 无世代删除面——不入共享
// REFERENCE_BEARING_FAMILY（P2-4 收窄原则：红线仅施于「对本文令有引用贡献的形态」）。
const B9_MATRIX_NAME_RE = /(^|\/)b9-closure-matrix-[^/]*\.json$/;
const isB9MatrixName = (rel) => B9_MATRIX_NAME_RE.test(rel);

// ── P1-7（三审）：audit 一致性检查（validate 记 problems；compact/migrate 复用判定） ──
/** 语料是否非空（events 或 cursor 在场）——audit 必须存在的门槛条件。 */
function corpusNonEmpty(storeRoot, events, cursor) {
  return (events?.length ?? 0) > 0 || cursor != null;
}
/**
 * audit 侧车核对（P1-7）：返回 problems 数组（空=一致）。
 * - 缺失：语料非空 ⇒ AUDIT_MISSING；
 * - 不可解析 / 伪 legacy（classifyAudit invalid）⇒ 红；
 * - 精确 legacy（五键全类型有效）⇒ 记降级态 problems（validate 报告面；compact 切代前 fail-loud）；
 * - current：checksum（loadAudit）+ bundle_id 工件在场 + generation===当前世代。
 */
function auditConsistencyProblems(storeRoot, { events = null, gen } = {}) {
  const problems = [];
  const cursor = readCursorOrNone(storeRoot);
  const aud = EE.loadAudit(storeRoot);
  if (!aud.audit) {
    if (aud.problems) { problems.push(`audit 侧车不可解析（${aud.problems.join('；')}）`); return problems; }
    const { events: evs } = events == null ? EE.loadCorpus(EE.genDirOf(storeRoot, gen)) : { events };
    if (corpusNonEmpty(storeRoot, events ?? evs, cursor)) {
      problems.push('AUDIT_MISSING：events 语料/cursor 非空而 audit 侧车缺失（cursors/zcode-sqlite.audit.json）——回退检测/绑定面失守（P1-7）');
    }
    return problems;
  }
  const cls = EE.classifyAudit(aud.audit);
  if (cls.kind === 'invalid') { problems.push(`audit 侧车形态非法（${cls.reasons.join('；')}）——伪 legacy 一律红（P0-3）`); return problems; }
  if (cls.kind === 'legacy') {
    // 精确 legacy：loadAudit 的「缺新格式键」problems 是预期形态（不作 corrupt 论）——记降级态
    problems.push('audit 侧车为精确 legacy 形态（缺 payload_sha256/generation）——⑨ 完整性/绑定降级态；migrate-audit 可升级（P1-7）');
    return problems;
  }
  if (aud.problems) { problems.push(`audit 侧车损坏（${aud.problems.join('；')}）`); return problems; }
  if (aud.audit.generation !== gen) problems.push(`audit generation=${aud.audit.generation} ≠ 当前世代 ${gen}（P1-8 绑定面）`);
  if (!existsSync(join(storeRoot, 'snapshots', String(aud.audit.bundle_id), 'manifest.json'))) {
    problems.push(`audit bundle_id=${aud.audit.bundle_id} 在 snapshots/ 无对应工件（P1-8 绑定面）`);
  }
  return problems;
}

/** validate：全仓一致性校验（退出码 0/1）。 */
export function cmdValidate(opts) {
  const { storeRoot } = opts;
  ensureStoreLayout(storeRoot);
  const problems = [];
  const gen = EE.currentGeneration(storeRoot);
  const genDir = EE.genDirOf(storeRoot, gen);
  const { events, segments } = EE.loadCorpus(genDir);

  for (const s of segments) {
    const body = readFileSync(join(genDir, s.file), 'utf8');
    if (createHash('sha256').update(body, 'utf8').digest('hex') !== s.manifest.sha256) problems.push(`segment SHA 失配：${s.file}`);
    const lines = body.split('\n').filter(Boolean);
    if (lines.length !== s.manifest.event_count) problems.push(`segment event_count 失配：${s.file}（manifest=${s.manifest.event_count} 实际=${lines.length}）`);
    for (const e of validateFixture({ fixture_kind: 'segment-manifest', ...s.manifest })) problems.push(`segment manifest 契约违规：${s.file}：${e.rule} ${e.pointer}——${e.message}`);
  }
  if (events.length > 0) {
    for (const e of validateFixture({ fixture_kind: 'event-corpus', events })) problems.push(`事件语料契约违规：${e.rule} ${e.pointer}——${e.message}`);
  }
  const cursor = readCursorOrNone(storeRoot);
  if (cursor) {
    for (const e of validateFixture({ fixture_kind: 'cursor-state', ...cursor })) problems.push(`cursor 契约违规：${e.rule} ${e.pointer}——${e.message}`);
    for (const s of cursor.committed_segments ?? []) {
      if (!segments.some(x => x.file === `${s}.jsonl`)) problems.push(`cursor committed 悬空：${s}（E2d 形态）`);
    }
  } else if (events.length > 0) {
    problems.push('语料非空而 cursor 缺失');
  }
  // P1-7（三审）：audit 侧车纳入 validate——缺失/损坏/伪 legacy/legacy 降级/绑定不一致均入 problems（非空）
  problems.push(...auditConsistencyProblems(storeRoot, { events, gen }));
  const gens = existsSync(EE.eventsRoot(storeRoot)) ? readdirSync(EE.eventsRoot(storeRoot)).filter(d => /^gen-\d{4}$/.test(d)).sort() : [];
  const out = { command: 'validate', generation: gen, generations: gens, segments: segments.length, events: events.length, problems };
  console.log(JSON.stringify(out, null, 2));
  if (problems.length) { console.error(`VALIDATE_FAIL：${problems.length} 项问题`); return EXIT.FAIL; }
  return EXIT.OK;
}

/** rebuild --from-source --bundle <id>：E3 世代协议全量重建。--failpoint E3=中途崩溃（指针未切）。 */
export async function cmdRebuild(opts) {
  const { storeRoot, flags, clock, injectedInstanceId } = opts;
  if (!flags['from-source']) { console.error('rebuild 须 --from-source'); return EXIT.USAGE; }
  if (!flags.bundle) { console.error('rebuild 须 --bundle <id>'); return EXIT.USAGE; }
  const fpv = parseFailpointFlags(flags);
  if (fpv.usageError) { console.error(`USAGE（failpoint）：${fpv.usageError}`); return EXIT.USAGE; }
  const fp = fpv.fp;
  // P3-6（四审）：承载表防线（CLI 入口已收口；此处覆盖直接调用面）——rebuild 仅承载 E3
  const rebuildCarrierErr = failpointCarrierError('rebuild', fp);
  if (rebuildCarrierErr) { console.error(`USAGE（failpoint）：${rebuildCarrierErr}`); return EXIT.USAGE; }
  if (clock) console.log(`[AUDIT] --clock=${clock}（rebuild 模式；segment manifest/cursor 时间戳冻结于该时钟——P2-1 使用必记）`);
  ensureStoreLayout(storeRoot);
  const lockName = MUTATION_LOCK;   // 与 collect 同一排它锁（§5.4-8/E4）
  const lock = acquireLock(storeRoot, lockName);
  if (!lock.held) { console.error(`LOCK_HELD：${lock.reason}`); return EXIT.FAIL; }
  try {
    const nowIso = clock ?? rfc3339();
    const nowMs = clock ? Date.parse(clock) : Date.now();
    const heartbeat = () => guardedRefreshHeartbeat(storeRoot, lockName);
    const { config } = await import('./store.mjs').then(m => m.ensureConfig(storeRoot, { injectedId: injectedInstanceId, nowIso }));
    const gen = EE.currentGeneration(storeRoot);
    const next = gen + 1;
    const newDir = discardCrashLeftover(storeRoot, next);

    // P0-2：投影全程心跳（分块复制块间+相位间）
    const proj = projectBundleEvents({ storeRoot, bundleId: String(flags.bundle), sid: config.source_instance_id, nowIso, nowMs, onDbChunk: heartbeat });
    heartbeat();
    for (const e of proj.events) if (!e.event_id) e.event_id = `${e.entity_id}:${e.source_revision}`;
    const sorted = [...proj.events].sort((a, b) => a.event_id < b.event_id ? -1 : 1);   // event_id 赋值后单次 canonical 排序
    heartbeat();   // P1-4/P0-2：投影后/写入前刷心跳
    const segId = 'seg-0001';
    const content = sorted.map(e => JSON.stringify(e)).join('\n') + '\n';
    const sha = createHash('sha256').update(content, 'utf8').digest('hex');
    writeFileSync(join(newDir, `${segId}.jsonl`), content, 'utf8');
    writeJson(join(newDir, `${segId}.manifest.json`), {
      manifest_kind: 'segment-manifest', segment_seq: 1, segment_id: segId,
      adapter_id: EE.ADAPTER_ID, source_instance_id: config.source_instance_id,
      closed: true, event_count: sorted.length, sha256: sha,
      cursor_after: maxTerminalCursor(sorted), written_at: nowIso,
    });

    // E3 failpoint：新代已写、代指针未切 → 崩溃（旧代完整可读=读侧无感）
    const fpStateDir = String(flags['failpoint-state'] ?? join(storeRoot, 'quarantine', 'failpoint-state'));
    if (fp && fp.id === 'E3' && shouldFire(fp, fpStateDir)) {
      crashExit(fp, fpStateDir, `gen-${next} 已写、代指针未切——旧代 gen-${gen} 完整可回退`);
    }

    // 校验新代 → 原子切代指针 → cursor 重建
    const ev2 = EE.loadCorpus(newDir).events;
    const errs = validateFixture({ fixture_kind: 'event-corpus', events: ev2 });
    if (errs.length) {
      rmSync(newDir, { recursive: true, force: true });
      console.error(`REBUILD_VALIDATION_FAIL：新代未过 validator，已废弃（指针未切）\n${errs.map(e => `  ${e.rule} ${e.pointer}`).join('\n')}`);
      return EXIT.FAIL;
    }
    EE.switchGeneration(storeRoot, next);
    const rb = EE.rebuildCursorFromSegments(storeRoot, config.source_instance_id, { nowIso });
    writeJson(EE.cursorPath(storeRoot), rb.cursor);
    // P1-8：rebuild 后 audit 随新代重写（bundle↔audit↔generation 绑定保持一致——verify 核对面）
    EE.writeAudit(storeRoot, {
      row_count: proj.manifest.sqlite_copy.row_count, max_id: proj.observed_max_id,
      fingerprint: proj.fingerprint, bundle_id: proj.manifest.bundle_id,
      generation: next, updated_at: nowIso,
    });
    console.log(JSON.stringify({ command: 'rebuild --from-source', from_bundle: flags.bundle, generation_before: gen, generation_after: next, events: ev2.length, old_generation_kept: `gen-${String(gen).padStart(4, '0')}` }, null, 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——rebuild 立即中止（至多一写者；代指针未切）`); return EXIT.FAIL; }
    throw e;
  } finally { releaseLock(storeRoot, lockName); }
}

function maxTerminalCursor(events) {
  let t = { completed_at: null, id: null };
  for (const e of events) {
    if (e.completed_at == null) continue;
    if (t.completed_at == null || e.completed_at > t.completed_at
      || (e.completed_at === t.completed_at && String(e.entity_id) > String(t.id))) t = { completed_at: e.completed_at, id: e.entity_id };
  }
  return t;
}

/** compact [--watermark <RFC3339>]：E4 水位+引用保护。新世代=引用段+水位上段原样迁移 + 水位下未引用段合并。
 *  P1-6/E4 子型（三审）：--failpoint E4:pre-switch --failpoint-mode once =压实中途崩溃（新代段已写、代指针未切）。 */
export async function cmdCompact(opts) {
  const { storeRoot, flags, clock } = opts;
  const fpv = parseFailpointFlags(flags);
  if (fpv.usageError) { console.error(`USAGE（failpoint）：${fpv.usageError}`); return EXIT.USAGE; }
  const fp = fpv.fp;
  // P3-6（四审）：承载表防线（CLI 入口已收口；此处覆盖直接调用面）——compact 仅承载 E4:pre-switch
  const compactCarrierErr = failpointCarrierError('compact', fp);
  if (compactCarrierErr) { console.error(`USAGE（failpoint）：${compactCarrierErr}`); return EXIT.USAGE; }
  if (clock) console.log(`[AUDIT] --clock=${clock}（compact 模式；segment manifest/cursor 时间戳冻结于该时钟——P2-1 使用必记）`);
  const nowIso = clock ?? rfc3339();
  ensureStoreLayout(storeRoot);
  const lockName = MUTATION_LOCK;   // 与 collect 同一排它锁（§5.4-8/E4）
  const lock = acquireLock(storeRoot, lockName);
  if (!lock.held) { console.error(`LOCK_HELD：${lock.reason}`); return EXIT.FAIL; }
  try {
    const gen = EE.currentGeneration(storeRoot);
    const genDir = EE.genDirOf(storeRoot, gen);
    const { segments, events } = EE.loadCorpus(genDir);
    const cursor = readCursorOrNone(storeRoot);
    // P1-7（三审）：audit 缺失/损坏/伪 legacy/legacy 降级 → 切代前 fail-loud（压实后旧代清理会放大于不可判定状态）
    const auditProblems = auditConsistencyProblems(storeRoot, { events, gen });
    if (auditProblems.length) {
      console.error(`COMPACT_AUDIT_FAIL：\n  ${auditProblems.join('\n  ')}——切代前 fail-loud（P1-7；先 migrate-audit/修复 audit 再压实）`);
      return EXIT.FAIL;
    }
    // P3-7（四审）：空仓（无 audit 且无 cursor）no-op 拒收——继续执行会「写 cursor 而不产 audit」，
    // 令后续 validate 恒 AUDIT_MISSING 红（结构性死态）；空仓无可压实对象，fail-loud 优于伪装成功
    if (!EE.loadAudit(storeRoot).audit && !cursor) {
      console.error('COMPACT_EMPTY_REPO：空仓（无 audit 且无 cursor/语料）无可压实对象——拒收（继续将写 cursor 而不产 audit，后续 validate 恒 AUDIT_MISSING）');
      return EXIT.FAIL;
    }
    const watermark = typeof flags.watermark === 'string' ? flags.watermark : (cursor?.terminal_cursor?.completed_at ?? null);
    if (!watermark) { console.error('COMPACT_NO_WATERMARK：无 --watermark 且 cursor 无 terminal 位'); return EXIT.FAIL; }
    // 引用保护集：reports/ 递归全子目录（含周桶）全部 report manifest 的 segment_shas（E4：被删集=水位下集合−引用保护集）
    // P1（四审）：与 prune 引用集同标准——识别形态解析失败/report-manifest schema 违规 ⇒ COMPACT_REFERENCE_FAIL
    // 切代前 fail-loud（旧实现静默吞损坏 report ⇒ 引用保护面不可判定下照常压实，保护承诺失守）。
    // stats-4 红队修复轮二 P1-1①：顶层 readdirSync → 递归（周桶 manifest 纳入）；P2-4：族外形态解析异常 WARN 不锁死。
    const protectedShas = new Set();
    const refProblems = [];
    const reportsDir = join(storeRoot, 'reports');
    if (existsSync(reportsDir)) {
      for (const art of listReportArtifacts(reportsDir)) {
        let j;
        try { j = JSON.parse(readFileSync(art.abs, 'utf8')); }
        catch (e) {
          if (isReferenceBearingName(art.rel)) refProblems.push(`report 工件解析失败：${art.rel}（${e.message}）——引用保护集不可判定`);
          else console.error(`[WARN] reports/${art.rel} 解析失败（非引用承载形态族——不入引用集不锁死维护命令；P2-4 收窄）：${e.message}`);
          continue;
        }
        // 票 C P0-3：引用承载族 kind 门槛——解析成功而 kind 缺失/不匹配 → fail-loud（禁静默跳过）
        refProblems.push(...referenceKindProblems(art.rel, j));
        if (j && j.manifest_kind === 'report-manifest') {
          // report manifest：schema 不过=引用面不可信 → fail-loud（禁静默跳过；与 prune 同款实现）
          const errs = validateFixture({ fixture_kind: 'report-manifest', ...j });
          if (errs.length) {
            refProblems.push(`report manifest 契约违规：${art.rel}：${errs.map(e => `${e.rule} ${e.pointer}——${e.message}`).join('；')}`);
            continue;
          }
          for (const s of j.segment_shas ?? []) protectedShas.add(s);
        }
        // stats-3 裁决①（2026-10-09）：pilot-eval 评估工件 bundle_id 并入引用集——
        // 可解析但 bundle_id 缺失/非字符串 = 引用面不可判定 → 同红线 fail-loud（与 prune 同标准）；
        // compact 侧无 bundle/世代删除面，此处为引用集建立纪律的对称收口（bundle 保护实效面=prune）。
        if (j && j.artifact_kind === 'pilot-evaluation-report') {
          if (typeof j.bundle_id !== 'string' || j.bundle_id === '') {
            refProblems.push(`pilot-eval 工件缺 bundle_id：${art.rel}——引用面不可判定（stats-3 裁决①）`);
          }
        }
        // 其他非 report-manifest 形态不入引用集：与 prune §5.5-② 保留语义对齐
      }
    }
    if (refProblems.length) {
      console.error(`COMPACT_REFERENCE_FAIL：\n  ${refProblems.join('\n  ')}——引用保护集建立失败，切代前 fail-loud（与 prune PRUNE_REFERENCE_FAIL 同标准）`);
      return EXIT.FAIL;
    }
    const next = gen + 1;
    const newDir = discardCrashLeftover(storeRoot, next);
    const heartbeat = () => guardedRefreshHeartbeat(storeRoot, lockName);
    heartbeat();   // P1-4/P0-2：压实处理窗刷心跳
    const loadSeg = (s) => readFileSync(join(genDir, s.file), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    // 输出段序=原段 seq 序（合并段取其成员最小 seq）——按实体 revision 单调性保持序（VR-X02 语料序前提）
    // P2-3（四审）：verbatim 段（引用保护/水位上）不 loadSeg——逐字节拷贝迁移（见下方写循环）
    const outputs = [];
    const mergedSources = [];
    let mergedMinSeq = Infinity;
    const mergedEvents = [];
    for (const s of segments) {
      const end = s.manifest.cursor_after?.completed_at ?? null;
      const under = end != null && end <= watermark;
      const referenced = protectedShas.has(s.manifest.sha256);
      if (under && !referenced) {
        mergedSources.push(s.file);
        mergedEvents.push(...loadSeg(s));
        mergedMinSeq = Math.min(mergedMinSeq, s.manifest.segment_seq);
      } else {
        outputs.push({ key: s.manifest.segment_seq, reason: referenced ? 'referenced-by-report' : 'above-watermark', file: s.file, manifest: s.manifest });
      }
    }
    if (mergedEvents.length > 0) outputs.push({ key: mergedMinSeq, reason: 'merged', file: null, events: mergedEvents });
    outputs.sort((a, b) => a.key - b.key);
    let seq = 0;
    // 合并段=新内容（canonical 重写+事件序重排为语义一部分）；verbatim 段走 copySeg（字节迁移）
    const writeSeg = (evs) => {
      seq++;
      const segId = `seg-${String(seq).padStart(4, '0')}`;
      const sorted = [...evs].sort((a, b) => a.event_id < b.event_id ? -1 : 1);
      const content = sorted.map(e => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(join(newDir, `${segId}.jsonl`), content, 'utf8');
      writeJson(join(newDir, `${segId}.manifest.json`), {
        manifest_kind: 'segment-manifest', segment_seq: seq, segment_id: segId,
        adapter_id: EE.ADAPTER_ID, source_instance_id: cursor?.source_instance_id ?? sorted[0]?.source_instance_id ?? '',
        closed: true, event_count: sorted.length, sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        cursor_after: maxTerminalCursor(sorted), written_at: nowIso,
      });
      heartbeat();   // P1-4/P0-2：逐段写入间刷心跳
      return segId;
    };
    // P2-3（四审）：verbatim 段=**逐字节拷贝**（copyFileSync——不 parse 不重序列化）。旧实现经
    // loadSeg 逐行 JSON.parse+stringify 重写，非本工具 canonical 写出的段（如外部迁移/历史版本产物）
    // 经 compact 后 sha 静默漂移——report segment_shas 引用保护失效。字节拷贝后以原段 manifest sha
    // **写后断言**：不符（源段字节与 manifest 本就不符/拷贝损坏）⇒ COMPACT_COPY_FAIL 废弃新代不切代。
    const copySeg = (o) => {
      seq++;
      const segId = `seg-${String(seq).padStart(4, '0')}`;
      copyFileSync(join(genDir, o.file), join(newDir, `${segId}.jsonl`));
      const copiedSha = createHash('sha256').update(readFileSync(join(newDir, `${segId}.jsonl`))).digest('hex');
      if (copiedSha !== o.manifest.sha256) {
        rmSync(newDir, { recursive: true, force: true });
        console.error(`COMPACT_COPY_FAIL：verbatim 段 ${o.file} 拷贝后 sha=${copiedSha.slice(0, 12)}… ≠ 原 manifest sha=${String(o.manifest.sha256).slice(0, 12)}…（源段字节与其 manifest 不一致或拷贝损坏）——新代已废弃，不切代（P2-3）`);
        return null;
      }
      // manifest 所需字段照搬原值（sha256/event_count/cursor_after/written_at…原样）；仅 seq/id 按新代段序重编
      writeJson(join(newDir, `${segId}.manifest.json`), { ...o.manifest, segment_seq: seq, segment_id: segId });
      heartbeat();
      return segId;
    };
    const keptVerbatim = [];
    let compactedSeg = null;
    for (const o of outputs) {
      if (o.reason === 'merged') { compactedSeg = writeSeg(o.events); continue; }
      const newSeg = copySeg(o);
      if (newSeg === null) return EXIT.FAIL;
      keptVerbatim.push({ file: o.file, newSeg, reason: o.reason });
    }
    // E4:pre-switch failpoint（P1-6/三审）：新代段已写、代指针未切 → 崩溃（等价持久化终态；旧代完整可读=读侧无感）
    const fpStateDir = String(flags['failpoint-state'] ?? join(storeRoot, 'quarantine', 'failpoint-state'));
    if (fp && fp.id === 'E4' && shouldFire(fp, fpStateDir)) {
      crashExit(fp, fpStateDir, `gen-${next} 段已写、代指针未切——旧代 gen-${gen} 完整可读`);
    }
    EE.switchGeneration(storeRoot, next);
    // cursor 随新世代重建（committed=新世代段集；E4 与 E3 同一的「切换后重建」语义——否则 committed 悬空）
    const sid = cursor?.source_instance_id ?? mergedEvents[0]?.source_instance_id ?? '';
    const rb = EE.rebuildCursorFromSegments(storeRoot, sid, { nowIso });
    writeJson(EE.cursorPath(storeRoot), rb.cursor);
    // P1-8：audit 的 generation 绑定随代切换推进（内容面不变；verify 核对面保持一致）
    const aud = EE.loadAudit(storeRoot);
    if (aud.audit && !aud.problems) {
      EE.writeAudit(storeRoot, { ...aud.audit, generation: next, updated_at: nowIso });
    }
    console.log(JSON.stringify({
      command: 'compact', watermark, generation_before: gen, generation_after: next,
      segments_kept_verbatim: keptVerbatim, segments_merged: mergedSources, compacted_segment: compactedSeg,
      protected_by_reference: segments.filter(s => protectedShas.has(s.manifest.sha256)).map(s => s.file),
      rule: '被删集=水位下集合−引用保护集（E4；report 读世代快照）',
    }, null, 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——compact 立即中止（至多一写者；代指针未切）`); return EXIT.FAIL; }
    throw e;
  } finally { releaseLock(storeRoot, lockName); }
}

/** prune：bundle 引用计数保留（⑫）+旧代清理（保留 current 与其前一代）。P0-2：纳入统一排它锁。
 *  P1-8（三审）：**先完整建立并验证引用集**——任何 report manifest 解析失败/schema 不过在**第一项删除前**
 *  fail-loud（引用集残缺下删除=误删被引用 bundle 的逃逸通道）。 */
export function cmdPrune(opts) {
  const { storeRoot } = opts;
  ensureStoreLayout(storeRoot);
  const lockName = MUTATION_LOCK;   // P0-2：prune 同为仓变更命令——与 collect/rebuild/compact 同一排它锁
  const lock = acquireLock(storeRoot, lockName);
  if (!lock.held) { console.error(`LOCK_HELD：${lock.reason}`); return EXIT.FAIL; }
  try {
    const heartbeat = () => guardedRefreshHeartbeat(storeRoot, lockName);
    // ── 阶段一（P1-8）：完整建立并验证引用集（零删除窗）──
    const referenced = new Set();
    const pilotEvalGenerations = new Set();   // stats-3 裁决①：pilot-eval 工件世代锚（防清理旧代令评估工件 events 面失锚）
    const reportManifestGenerations = new Set();   // stats-4 红队修复轮二 P1-1③：report manifest 世代锚（同标准旁增面）
    const b9MatrixGenerations = new Set();   // stats-5 红队修复轮三 P2-3：b9-closure-matrix 工件世代锚（同款旁增面）
    const refProblems = [];
    let phase1Heartbeats = 0;   // QA 修复轮（P2-2 确定性化）：阶段一心跳计数入输出——时序无关断言替代 mtime 轮询
    const reportsDir = join(storeRoot, 'reports');
    if (existsSync(reportsDir)) {
      // stats-4 红队修复轮二 P1-1①：递归全子目录（周桶 manifest 纳入——顶层-only 令其 bundle/世代引用逃逸）；
      // P2-4：解析红线收窄——族外形态解析异常 WARN 不锁死（append 永存 verify-watermark 等不得永久红维护命令）
      for (const art of listReportArtifacts(reportsDir)) {
        heartbeat();   // P2-2（四审）：引用集建立循环逐 report 刷心跳——大仓下首个心跳不再滞后到删除循环（>120s 接管窗）
        phase1Heartbeats++;
        let j;
        try { j = JSON.parse(readFileSync(art.abs, 'utf8')); }
        catch (e) {
          if (isReferenceBearingName(art.rel)) refProblems.push(`report 工件解析失败：${art.rel}（${e.message}）——引用集不可判定（P1-8）`);
          else if (isB9MatrixName(art.rel)) refProblems.push(`b9-closure-matrix 工件解析失败：${art.rel}（${e.message}）——世代引用面不可判定（stats-5 P2-3）`);
          else console.error(`[WARN] reports/${art.rel} 解析失败（非引用承载形态族——不入引用集不锁死维护命令；P2-4 收窄）：${e.message}`);
          continue;
        }
        // 票 C P0-3：引用承载族 kind 门槛——解析成功而 kind 缺失/不匹配 → fail-loud（禁静默跳过）
        refProblems.push(...referenceKindProblems(art.rel, j));
        if (j && j.manifest_kind === 'report-manifest') {
          // report manifest：schema 不过=引用面不可信 → fail-loud（禁静默跳过）
          const errs = validateFixture({ fixture_kind: 'report-manifest', ...j });
          if (errs.length) {
            refProblems.push(`report manifest 契约违规：${art.rel}：${errs.map(e => `${e.rule} ${e.pointer}——${e.message}`).join('；')}`);
            continue;
          }
          referenced.add(j.bundle_id);
          if (Number.isInteger(j.generation)) reportManifestGenerations.add(j.generation);   // 世代锚（P1-1③）
        }
        // stats-3 裁决①（2026-10-09）：pilot-eval 评估工件（artifact_kind 面）bundle_id 并入引用集——
        // 修复「pilot-eval 失锚」（bundle 被 prune 按未引用清理 → 评估工件证据基悬空）；
        // 可解析但 bundle_id 缺失/非字符串 = 引用面不可判定 → 同红线 fail-loud（P1-8 同标准）。
        if (j && j.artifact_kind === 'pilot-evaluation-report') {
          if (typeof j.bundle_id !== 'string' || j.bundle_id === '') {
            refProblems.push(`pilot-eval 工件缺 bundle_id：${art.rel}——引用面不可判定（stats-3 裁决①）`);
          } else {
            referenced.add(j.bundle_id);
            if (Number.isInteger(j.generation)) pilotEvalGenerations.add(j.generation);   // 世代锚一并保护（评估工件 generation 引用面）
          }
        }
        // stats-5 红队修复轮三 P2-3：b9-closure-matrix 工件（文件名级识别——P3-5 钉死名）读语料
        // （merged 票集）定着于其生成世代，prune 清理该代=发布票验时效的证据基失锚；读 generation 入
        // 保护集（与 reportManifestGenerations 同款）。可解析但 generation 缺失/非整数=世代引用面
        // 不可判定 → 同红线 fail-loud（pilot-eval bundle_id 同标准；静默跳过=保护承诺失守）。
        if (isB9MatrixName(art.rel)) {
          if (!Number.isInteger(j?.generation)) {
            refProblems.push(`b9-closure-matrix 工件缺 generation：${art.rel}——世代引用面不可判定（stats-5 P2-3）`);
          } else {
            b9MatrixGenerations.add(j.generation);
          }
        }
        // 其他非 report-manifest 形态不入引用集：§5.5-② 保留语义
        // 只锚定 report manifest 与 pilot-eval 工件的 bundle_id 引用；可解析性仍受上面解析失败红线条约束。
      }
    }
    // P2-1（四审）：audit 绑定 bundle 并入引用集——prune 删掉 audit.bundle_id 对应 bundle 会令
    // validate/compact 恒红（audit 绑定面双红锁死，仅 migrate-audit 亦无法自救）；audit 可解析载入
    // 且 bundle_id 为非空字符串即计入保护（checksum/形态完整性红线条归 validate/collect/migrate 面，
    // prune 不新增判定——多保护一份 bundle 无害，漏保护即结构性死态）。
    {
      const aud = EE.loadAudit(storeRoot);
      if (aud.audit && typeof aud.audit.bundle_id === 'string' && aud.audit.bundle_id !== '') {
        referenced.add(aud.audit.bundle_id);
      }
    }
    if (refProblems.length) {
      console.error(`PRUNE_REFERENCE_FAIL：\n  ${refProblems.join('\n  ')}——引用集建立失败，第一项删除前 fail-loud（P1-8）`);
      return EXIT.FAIL;
    }
    // ── 阶段二：删除（引用集已验证完整）──
    const removed = [];
    const snapsDir = join(storeRoot, 'snapshots');
    let protectedBundles = [];
    if (existsSync(snapsDir)) {
      const entries = readdirSync(snapsDir).filter(d => existsSync(join(snapsDir, d, 'manifest.json')));
      const withCreated = entries.map(id => ({ id, created: JSON.parse(readFileSync(join(snapsDir, id, 'manifest.json'), 'utf8')).created_at }))
        .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? -1 : 1));
      protectedBundles = withCreated.filter(x => referenced.has(x.id)).map(x => x.id);
      const unreferenced = withCreated.filter(x => !referenced.has(x.id));
      for (const x of unreferenced.slice(3)) {   // 未引用保最近 3 份
        rmSync(join(snapsDir, x.id), { recursive: true, force: true });
        heartbeat();   // P1-4/P0-2：删除作业间刷心跳
        removed.push(x.id);
      }
    }
    const gensRoot = EE.eventsRoot(storeRoot);
    if (existsSync(gensRoot)) {
      const cur = EE.currentGeneration(storeRoot);
      for (const g of readdirSync(gensRoot).filter(d => /^gen-\d{4}$/.test(d))) {
        const n = parseInt(g.slice(4), 10);
        // stats-3 裁决①：pilot-eval 工件世代锚保护的旧代不清理（评估工件 generation 引用不失锚）；
        // stats-4 红队修复轮二 P1-1③：report manifest 世代锚同标准旁增（manifest segment_shas 引用不失锚）；
        // stats-5 红队修复轮三 P2-3：b9-closure-matrix 世代锚同款旁增（工件证据代不失锚）
        if (n < cur - 1 && !pilotEvalGenerations.has(n) && !reportManifestGenerations.has(n) && !b9MatrixGenerations.has(n)) { rmSync(join(gensRoot, g), { recursive: true, force: true }); heartbeat(); removed.push(g); }
      }
    }
    console.log(JSON.stringify({ command: 'prune', phase1_heartbeats: phase1Heartbeats, bundles_referenced_protected: protectedBundles, bundles_removed: removed.filter(x => !x.startsWith('gen-')), generations_removed: removed.filter(x => x.startsWith('gen-')) }, null, 2));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——prune 立即中止（至多一写者）`); return EXIT.FAIL; }
    throw e;
  } finally { releaseLock(storeRoot, lockName); }
}

/** migrate-audit（三审新增，显式维护命令）：legacy audit（精确五键）核验一致后升级七字段新格式。
 *  - 精确 legacy 且 corpus/cursor 一致（generation=当前世代、bundle 工件在场）→ 升级 + [AUDIT-MIGRATED] 留痕；
 *  - 已是合法新格式 → 幂等 no-op exit 0；空仓无 audit → no-op exit 0；
 *  - 伪 legacy/损坏/不一致 → exit≠0 拒绝。真实仓迁移须人工显式执行（本命令不自动触发）。 */
export function cmdMigrateAudit(opts) {
  const { storeRoot } = opts;
  ensureStoreLayout(storeRoot);
  const lockName = MUTATION_LOCK;   // cursors/ 变更=仓变更——同一排它锁
  const lock = acquireLock(storeRoot, lockName);
  if (!lock.held) { console.error(`LOCK_HELD：${lock.reason}`); return EXIT.FAIL; }
  try {
    const gen = EE.currentGeneration(storeRoot);
    const genDir = EE.genDirOf(storeRoot, gen);
    const { events } = EE.loadCorpus(genDir);
    const cursor = readCursorOrNone(storeRoot);
    const aud = EE.loadAudit(storeRoot);
    if (!aud.audit) {
      if (aud.problems) { console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——拒绝迁移（migrate-audit 不修复不可解析工件）`); return EXIT.FAIL; }
      if (corpusNonEmpty(storeRoot, events, cursor)) {
        console.error('AUDIT_MISSING：语料非空而 audit 缺失——迁移无从核验（P0-3），拒绝');
        return EXIT.FAIL;
      }
      console.log(JSON.stringify({ command: 'migrate-audit', migrated: false, note: '空仓（无语料/cursor/audit）——无需迁移' }, null, 2));
      return EXIT.OK;
    }
    const cls = EE.classifyAudit(aud.audit);
    if (cls.kind === 'invalid') {
      console.error(`AUDIT_INVALID：audit 侧车非精确 legacy 亦非合法新格式（${cls.reasons.join('；')}）——伪 legacy 拒绝迁移（P0-3）`);
      return EXIT.FAIL;
    }
    if (cls.kind === 'legacy') {
      // 精确 legacy：corpus/cursor 一致性核验 → 升级（loadAudit 的「缺新格式键」problems 是预期形态，不作 corrupt 论）
      const problems = [];
      if (!corpusNonEmpty(storeRoot, events, cursor)) problems.push('语料/cursor 为空而存在 legacy audit——迁移无从核验');
      if (!existsSync(join(storeRoot, 'snapshots', String(aud.audit.bundle_id), 'manifest.json'))) problems.push(`bundle_id=${aud.audit.bundle_id} 在 snapshots/ 无对应工件`);
      if (problems.length) {
        console.error(`AUDIT_MIGRATE_INCONSISTENT：\n  ${problems.join('\n  ')}——corpus/cursor 一致性不成立，拒绝迁移`);
        return EXIT.FAIL;
      }
      const nowIso = rfc3339();
      const migrated = {
        row_count: aud.audit.row_count,
        max_id: aud.audit.max_id,
        fingerprint: aud.audit.fingerprint,
        bundle_id: aud.audit.bundle_id,
        generation: gen,
        updated_at: aud.audit.updated_at,   // 保留 legacy 观测时刻（迁移不改观测面）
        audit_migration: { migrated_at: nowIso, from: 'legacy-audit-five-field', tool: 'migrate-audit', generation_at_migration: gen },
      };
      EE.writeAudit(storeRoot, migrated);
      console.log('[AUDIT-MIGRATED] legacy（精确五键）→ 七字段新格式：+generation（=当前世代）+payload_sha256+audit_migration 留痕');
      console.log(JSON.stringify({ command: 'migrate-audit', migrated: true, bundle_id: migrated.bundle_id, generation: gen, preserved_updated_at: migrated.updated_at }, null, 2));
      return EXIT.OK;
    }
    // current：checksum/字段面损坏拒绝；合法即幂等 no-op
    if (aud.problems) { console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——拒绝迁移`); return EXIT.FAIL; }
    console.log(JSON.stringify({ command: 'migrate-audit', migrated: false, note: '已是七字段新格式（幂等 no-op）' }, null, 2));
    return EXIT.OK;
  } finally { releaseLock(storeRoot, lockName); }
}
