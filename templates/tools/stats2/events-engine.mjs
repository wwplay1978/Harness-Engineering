// stats2/events-engine.mjs — 事件仓段/游标/世代引擎（docs/22 §5.4 提交链 + §5.5 四层 manifest 的读写面）
// 布局：events/CURRENT=世代号；events/gen-NNNN/seg-NNNN.jsonl + seg-NNNN.manifest.json（多 adapter 共享世代目录，
//       segment manifest.adapter_id 判属——stats-3 阶段二泛化，zcode-sqlite 默认参数向后兼容）；
//       cursors/<adapter>.json（schema=cursor-state-v1，canonical checksum）+ <adapter>.audit.json（回退检测侧车）。
// stats-3 裁决⑦：append-only 源游标 id=relpath#line、全序=文件相对路径字典序→行号（cursorOrderKey 承载）。
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync, mkdirSync, rmSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sha256Hex, canon, writeJson, atomicWriteFile, fsyncDir } from './util.mjs';

export const ADAPTER_ID = 'zcode-sqlite';
export const CURSOR_KIND = 'cursor-state';

/** stats-3 阶段二/三：append-only adapter 注册（游标排序语义=裁决⑦ 字典序 id；open_set 恒空——裁决⑥）。 */
export const APPEND_ONLY_ADAPTERS = new Set(['kimi-wire', 'codex-sessions', 'ticket-miner', 'manual-reconcile']);

export function eventsRoot(storeRoot) { return join(storeRoot, 'events'); }
export function genDirOf(storeRoot, n) { return join(eventsRoot(storeRoot), `gen-${String(n).padStart(4, '0')}`); }
export function currentGeneration(storeRoot) {
  const p = join(eventsRoot(storeRoot), 'CURRENT');
  if (!existsSync(p)) return 1;
  const n = parseInt(readFileSync(p, 'utf8').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
export function switchGeneration(storeRoot, n) {   // 原子切代指针（E3：写 tmp→rename）
  const p = join(eventsRoot(storeRoot), 'CURRENT');
  atomicWriteFile(p, String(n) + '\n');
}
export function ensureGenerationDir(storeRoot, n) {
  const d = genDirOf(storeRoot, n);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  const pointer = join(eventsRoot(storeRoot), 'CURRENT');
  if (!existsSync(pointer)) atomicWriteFile(pointer, '1\n');   // 首用初始化世代指针
  return d;
}

export function cursorPath(storeRoot, adapterId = ADAPTER_ID) { return join(storeRoot, 'cursors', `${adapterId}.json`); }
export function auditPath(storeRoot, adapterId = ADAPTER_ID) { return join(storeRoot, 'cursors', `${adapterId}.audit.json`); }

// ── audit 侧车（⑨ 回退检测输入；P1-8 加固：payload checksum+必填字段+bundle/generation 绑定）──
export const AUDIT_REQUIRED_FIELDS = ['row_count', 'max_id', 'fingerprint', 'bundle_id', 'generation', 'updated_at', 'payload_sha256'];
/** checksum 口径=去本字段后键递归字典序无空白 JSON 的 SHA-256（stats-1-gap-3 canonical 同源）。 */
export function auditChecksum(body) {
  const { payload_sha256: _drop, ...rest } = body;
  return sha256Hex(canon(rest));
}
export function writeAudit(storeRoot, observed) {
  writeJson(auditPath(storeRoot), { ...observed, payload_sha256: auditChecksum(observed) });
}
/** 读 audit 侧车：缺失={audit:null}；损坏/字段缺={audit, problems[]}（调用方 fail-loud）。 */
export function loadAudit(storeRoot) {
  const p = auditPath(storeRoot);
  if (!existsSync(p)) return { audit: null };
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch { return { audit: null, problems: ['audit 侧车不可解析（截断/非 JSON）'] }; }
  const problems = [];
  for (const f of AUDIT_REQUIRED_FIELDS) if (!j || typeof j !== 'object' || !(f in j)) problems.push(`audit 侧车缺必填字段 ${f}`);
  if (!problems.length && (typeof j.payload_sha256 !== 'string' || auditChecksum(j) !== j.payload_sha256)) {
    problems.push('audit 侧车 payload_sha256 与载荷不符（被改动/截断——E2c 同型判定）');
  }
  return problems.length ? { audit: j, problems } : { audit: j };
}

// ── audit 形态精确分类（P0-3，2026-10-09 三审：verify/validate/migrate-audit 共用单源）──
// legacy=**精确**旧键集 {row_count,max_id,fingerprint,bundle_id,updated_at} 且类型全有效（2026-10-08 加固前产物）；
// 伪 legacy（额外缺键/多余键/类型错/与新格式混合）一律 invalid——旧「仅查 payload_sha256/generation 两键同缺」
// 的宽松判定曾令伪 legacy 放行、audit 整缺放行（零轴绑定逃逸），此收口。
export const AUDIT_LEGACY_FIELDS = ['row_count', 'max_id', 'fingerprint', 'bundle_id', 'updated_at'];
/** @returns {{kind:'missing'}|{kind:'legacy'}|{kind:'current'}|{kind:'invalid', reasons:string[]}} */
export function classifyAudit(j) {
  if (j == null || typeof j !== 'object' || Array.isArray(j)) return { kind: 'missing' };
  const keys = Object.keys(j);
  const has = f => keys.includes(f);
  const typeOk = {
    row_count: Number.isInteger(j.row_count) && j.row_count >= 0,
    max_id: typeof j.max_id === 'string',
    fingerprint: typeof j.fingerprint === 'string',
    bundle_id: typeof j.bundle_id === 'string' && j.bundle_id.length > 0,
    updated_at: typeof j.updated_at === 'string' && j.updated_at.length > 0,
    generation: Number.isInteger(j.generation) && j.generation >= 1,
    payload_sha256: typeof j.payload_sha256 === 'string',
  };
  const legacyExact = keys.length === AUDIT_LEGACY_FIELDS.length
    && AUDIT_LEGACY_FIELDS.every(f => keys.includes(f));
  if (legacyExact) {
    const bad = AUDIT_LEGACY_FIELDS.filter(f => !typeOk[f]);
    if (bad.length === 0) return { kind: 'legacy' };
    return { kind: 'invalid', reasons: [`legacy 键集但类型无效：${bad.join(',')}`] };
  }
  // 新格式判定：七必填键全在场（额外扩展键允许；checksum 由 loadAudit 判）
  if (AUDIT_REQUIRED_FIELDS.every(has)) {
    const bad = AUDIT_REQUIRED_FIELDS.filter(f => !typeOk[f]);
    if (bad.length === 0) return { kind: 'current' };
    return { kind: 'invalid', reasons: [`新格式键集但类型无效：${bad.join(',')}`] };
  }
  const missing = AUDIT_REQUIRED_FIELDS.filter(f => !has(f));
  const extra = keys.filter(k => !AUDIT_REQUIRED_FIELDS.includes(k) && !AUDIT_LEGACY_FIELDS.includes(k));
  const reasons = [];
  if (missing.length && missing.length < AUDIT_REQUIRED_FIELDS.length) reasons.push(`部分缺新格式键：${missing.join(',')}`);
  if (!keys.includes('payload_sha256') && keys.includes('generation')) reasons.push('混合形态：有 generation 无 payload_sha256');
  if (extra.length) reasons.push(`多余键：${extra.join(',')}`);
  return { kind: 'invalid', reasons: reasons.length ? reasons : [`键集既非精确 legacy 亦非新格式：${keys.join(',')}`] };
}

export function listSegmentFiles(genDir) {
  if (!existsSync(genDir)) return [];
  return readdirSync(genDir).filter(f => f.endsWith('.jsonl')).sort();
}
export function segmentManifestPath(genDir, segFile) { return join(genDir, segFile.replace(/\.jsonl$/, '.manifest.json')); }

/** 读取世代内事件（按 segment 文件名序=seq 序；行序即写入序）。跳过无 manifest 的 partial（调用方另行 quarantine）。
 *  stats-3 阶段二：adapterId 在场时只装载该 adapter 的 segments（多 adapter 共享世代目录的判属过滤）。 */
export function loadCorpus(genDir, { adapterId = null } = {}) {
  const events = [];
  const segments = [];
  if (!existsSync(genDir)) return { events, segments };
  for (const f of listSegmentFiles(genDir)) {
    const mpath = segmentManifestPath(genDir, f);
    if (!existsSync(mpath)) continue;   // partial：不入 corpus（恢复流程处理）
    const manifest = JSON.parse(readFileSync(mpath, 'utf8'));
    if (adapterId && manifest.adapter_id !== adapterId) continue;
    const lines = readFileSync(join(genDir, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) events.push(JSON.parse(line));
    segments.push({ file: f, manifest });
  }
  return { events, segments };
}

/** 实体状态表：entity_id → {maxRev, latest}（latest=最高 revision 事件）。 */
export function entityState(events) {
  const m = new Map();
  for (const e of events) {
    if (e.event_kind !== 'dispatch' && e.event_kind !== 'model-request') continue;
    const prev = m.get(e.entity_id);
    if (!prev || e.source_revision > prev.maxRev) m.set(e.entity_id, { maxRev: e.source_revision, latest: e });
  }
  return m;
}

// ── cursor（四层 manifest 第④层；canonical checksum=去 payload_sha256 后键递归字典序无空白 JSON 的 SHA-256）──
export function cursorChecksum(body) { return sha256Hex(canon(body)); }

/** 裁决⑦ 游标推进序：append-only adapter=（relpath#line 字典序）；mutable-row=（completed_at,id）复合序。
 *  返回 true 当 b 严格晚于 a（a 为 null=空基线）。 */
export function cursorAfter(a, b, adapterId = ADAPTER_ID) {
  if (b == null || (b.completed_at == null && (b.id == null || b.id === ''))) return false;
  if (a == null || (a.completed_at == null && (a.id == null || a.id === ''))) return true;
  if (APPEND_ONLY_ADAPTERS.has(adapterId)) return String(b.id) > String(a.id);
  return b.completed_at > a.completed_at
    || (b.completed_at === a.completed_at && String(b.id) > String(a.id));
}

export function makeCursor({ sourceInstanceId, terminalCursor, scanLowerBound, openSet, committedSegments, nowIso, adapterId = ADAPTER_ID }) {
  const body = {
    manifest_kind: CURSOR_KIND,
    adapter_id: adapterId,
    source_instance_id: sourceInstanceId,
    updated_at: nowIso,
    terminal_cursor: terminalCursor,
    scan_lower_bound: scanLowerBound,
    open_set: openSet,
    committed_segments: committedSegments,
  };
  return { ...body, payload_sha256: cursorChecksum(body) };
}

/** 读 cursor；四型损坏（E2a-d）返回 {corrupted, subtype}。不存在 → {cursor:null}。 */
export function loadCursor(storeRoot, adapterId = ADAPTER_ID) {
  const p = cursorPath(storeRoot, adapterId);
  if (!existsSync(p)) return { cursor: null };
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) { return { cursor: null, corrupted: true, subtype: 'read-fail' }; }
  if (raw.trim() === '') return { cursor: null, corrupted: true, subtype: 'E2a' };
  let j;
  try { j = JSON.parse(raw); } catch { return { cursor: null, corrupted: true, subtype: 'E2b' }; }
  const { payload_sha256, ...body } = j;
  if (typeof payload_sha256 !== 'string' || cursorChecksum(body) !== payload_sha256) return { cursor: j, corrupted: true, subtype: 'E2c' };
  const genDir = genDirOf(storeRoot, currentGeneration(storeRoot));
  if (Array.isArray(j.committed_segments) && j.committed_segments.some(s => !existsSync(segmentManifestPath(genDir, `${s}.jsonl`)) && !existsSync(join(genDir, `${s}.jsonl`)))) {
    return { cursor: j, corrupted: true, subtype: 'E2d' };
  }
  return { cursor: j };
}

/** E2 重建：从世代内该 adapter 的 closed segment manifests 重建 cursor（append-only=最大 id 字典序推进；
 *  mutable-row=最大 (completed_at,id)；open_set：append-only 恒空（裁决⑥ ingest 即终态），mutable-row=最新事件非终态实体集）。 */
export function rebuildCursorFromSegments(storeRoot, sourceInstanceId, { nowIso, adapterId = ADAPTER_ID }) {
  const genDir = genDirOf(storeRoot, currentGeneration(storeRoot));
  const { events, segments } = loadCorpus(genDir, { adapterId });
  let terminal = { completed_at: null, id: null };
  for (const s of segments) {
    const ca = s.manifest.cursor_after;
    if (!ca || (ca.completed_at == null && (ca.id == null || ca.id === ''))) continue;
    if (cursorAfter(terminal, ca, adapterId)) terminal = { completed_at: ca.completed_at, id: ca.id };
  }
  let openSet = [];
  if (!APPEND_ONLY_ADAPTERS.has(adapterId)) {
    const state = entityState(events);
    for (const [eid, st] of state) if (!String(st.latest.state ?? '').startsWith('terminal_')) openSet.push(eid);
    openSet.sort();
  }
  const cursor = makeCursor({
    sourceInstanceId,
    terminalCursor: terminal,
    scanLowerBound: null,
    openSet: openSet,
    committedSegments: segments.map(s => s.file.replace(/\.jsonl$/, '')),
    nowIso,
    adapterId,
  });
  return { cursor, rebuiltFrom: segments.length };
}

export const TERMINAL_STATES = new Set(['terminal_completed', 'terminal_failed', 'terminal_cancelled']);

// ── 提交链（§5.4-4：唯一 commit point=cursor rename；fsync 顺序冻结）──
/** segment manifest 纯构造（P1-5 抽出）：内容串/SHA/cursor_after 与写入面同源唯一——
 *  collect 在唯一提交点前预构造预验证，commitSegment 消费同一对象（无二次构造漂移）。
 *  stats-3 阶段二：adapterId 参数化（manifest.adapter_id 判属）；append-only 段 cursor_after=最大
 *  source_primary_key（=relpath#line）字典序——裁决⑦ 全序（completed_at 取该行事件时戳）。 */
export function buildSegmentManifest({ seq, events, cursor, nowIso, adapterId = ADAPTER_ID }) {
  const segId = `seg-${String(seq).padStart(4, '0')}`;
  const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  let cursorAfterVal = { completed_at: null, id: null };
  if (APPEND_ONLY_ADAPTERS.has(adapterId)) {
    for (const e of events) {
      const id = e.source_primary_key;
      if (typeof id !== 'string' || id === '') continue;
      const cand = { completed_at: e.started_at ?? null, id };
      if (cursorAfter(cursorAfterVal, cand, adapterId)) cursorAfterVal = cand;
    }
  } else {
    // terminal cursor 位=本段事件中 terminal 行的最大 (completed_at, id)
    for (const e of events) {
      if (!TERMINAL_STATES.has(e.state) && e.state !== 'missing_child') continue;
      const ca = e.completed_at ?? null;
      const id = e.entity_id;
      if (ca == null) continue;
      if (cursorAfterVal.completed_at == null || ca > cursorAfterVal.completed_at
        || (ca === cursorAfterVal.completed_at && String(id) > String(cursorAfterVal.id))) cursorAfterVal = { completed_at: ca, id };
    }
  }
  const manifest = {
    manifest_kind: 'segment-manifest',
    segment_seq: seq,
    segment_id: segId,
    adapter_id: adapterId,
    source_instance_id: cursor.source_instance_id,
    closed: true,
    event_count: events.length,
    sha256: sha256Hex(content),
    cursor_after: cursorAfterVal,
    written_at: nowIso,
  };
  return { manifest, content, segId };
}

/** 写 segment+manifest+cursor 完整提交链。hooks 由 failpoints 传入（无 failpoint 时全 null 直通）。
 *  explicitSeq：cursor 须含本段 id——调用方以 nextSegmentSeq 预计算（cursor 在段写入前构造）。
 *  prebuilt（P1-5）：调用方预构造并预验证过的 {manifest, content}——此处仅作 sha 一致性防御复核后原样消费。
 *  adapterId（stats-3 阶段二）：cursor 文件按 adapter 分位（cursors/<adapter>.json）。 */
export async function commitSegment(storeRoot, { events, cursor, nowIso, hooks = {}, explicitSeq = null, prebuilt = null, adapterId = ADAPTER_ID }) {
  const gen = currentGeneration(storeRoot);
  const genDir = ensureGenerationDir(storeRoot, gen);
  const seq = explicitSeq ?? nextSegmentSeq(genDir);
  const built = prebuilt ?? buildSegmentManifest({ seq, events, cursor, nowIso, adapterId });
  if (built.manifest.sha256 !== sha256Hex(built.content) || built.manifest.event_count !== events.length) {
    throw new Error('SEGMENT_PREBUILD_MISMATCH：预构造 manifest 与事件内容不一致（防御复核）');
  }
  const segId = built.manifest.segment_id;
  const segPath = join(genDir, `${segId}.jsonl`);
  const content = built.content;

  if (hooks.F1) hooks.F1();   // segment.tmp 写前：终态=零写入

  const tmpPath = segPath + '.tmp';
  if (hooks.F2) {   // 截断终态：写一半即崩
    writeFileSync(tmpPath, content.slice(0, Math.floor(content.length / 2)), 'utf8');
    hooks.F2();
  }
  writeFileSync(tmpPath, content, 'utf8');
  const fd = openSync(tmpPath, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmpPath, segPath);

  if (hooks.F3) hooks.F3();   // segment rename 后 manifest 前：终态=正式 segment 在、manifest 缺

  const manifest = built.manifest;
  const mpath = segmentManifestPath(genDir, `${segId}.jsonl`);
  writeJson(mpath, manifest);

  if (hooks.F4) hooks.F4();   // manifest fsync 后 cursor tmp 写前

  const cPath = cursorPath(storeRoot, adapterId);
  const cTmp = cPath + '.tmp';
  writeFileSync(cTmp, JSON.stringify(cursor, null, 2) + '\n', 'utf8');
  const cfd = openSync(cTmp, 'r+'); try { fsyncSync(cfd); } finally { closeSync(cfd); }

  if (hooks.F5) hooks.F5();   // cursor tmp fsync 后 rename 前：终态=cursor.tmp 残留

  // F6b 终态=「rename 丢失」：rename 已执行后回滚到 rename 前的旧 cursor（无旧 cursor=文件不存在）
  let prevCursorBytes = null;
  if (existsSync(cPath)) prevCursorBytes = readFileSync(cPath, 'utf8');
  renameSync(cTmp, cPath);

  if (hooks.F6a) hooks.F6a();   // rename 持久化保留终态
  if (hooks.F6b) {              // rename 丢失终态（=F4 等价：旧 cursor 仍在、不含本段）
    if (prevCursorBytes === null) unlinkSync(cPath);
    else writeFileSync(cPath, prevCursorBytes, 'utf8');
    hooks.F6b();
  }
  fsyncDir(dirname(cPath));
  return { segId, seq, manifestPath: mpath, sha256: manifest.sha256, eventCount: events.length };
}

export function nextSegmentSeq(genDir) {
  const files = listSegmentFiles(genDir);
  if (files.length === 0) return 1;
  const last = files[files.length - 1].match(/seg-(\d{4})\.jsonl/);
  return (last ? parseInt(last[1], 10) : 0) + 1;
}

/** 恢复扫描：无 manifest 的 partial segment（含 F2 截断终态的 *.jsonl.tmp——重命名前崩溃残留）→ quarantine/ 移走留痕。 */
export function recoverPending(storeRoot, quarantineDir) {
  const gen = currentGeneration(storeRoot);
  const genDir = genDirOf(storeRoot, gen);
  const quarantined = [];
  if (!existsSync(genDir)) return { quarantined, uncommitted: [] };
  mkdirSync(quarantineDir, { recursive: true });
  for (const f of listSegmentFiles(genDir)) {
    const mpath = segmentManifestPath(genDir, f);
    const full = join(genDir, f);
    if (!existsSync(mpath)) {
      const dest = join(quarantineDir, `${f}.${Date.now()}.partial`);
      renameSync(full, dest);
      quarantined.push({ from: f, to: dest });
    }
  }
  // 重命名前崩溃的 .tmp（F2 截断终态）：一律 partial → quarantine（未被 rename=不可信）
  for (const t of readdirSync(genDir).filter(x => x.endsWith('.jsonl.tmp'))) {
    const dest = join(quarantineDir, `${t}.${Date.now()}.partial`);
    renameSync(join(genDir, t), dest);
    quarantined.push({ from: t, to: dest });
  }
  return { quarantined, uncommitted: [] };
}
