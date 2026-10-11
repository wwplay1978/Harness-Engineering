// stats2/native-source.mjs — Kimi/Codex 原生双 append-only adapter 核心（stats-3 阶段二）
// 纪律（docs/22 §5.3 + 票面红线 1 + 裁决⑤⑥⑦⑧）：
//   - 只消费冻结 native corpus（snapshots/<corpus_id>/）与 fixture——绝不触碰 ~/.kimi-code、~/.codex 活源；
//   - 原生面仅产 model-request 事件（parent_entity_id=null——裁决⑤/VR-X03）；不产 dispatch；
//   - 行 ingest 即终态（裁决⑥ state-mapping §2.3/§2.4）；open_set 恒空；
//   - 游标 id=relpath#line、全序=文件相对路径字典序→行号（裁决⑦）；
//   - 文件 size/hash 与 manifest 不符（截断/轮转/重写）→ SOURCE_REGRESSION fail-loud 零写入；
//   - type allowlist：Kimi 只取 type∈{usage.record, step.end, profile.bind, metadata}（§5.3）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256File, sha256Hex, canon, writeJson } from './util.mjs';
import { validateFixture } from './contract-validator.mjs';
import { auditPath as eeAuditPath } from './events-engine.mjs';

export const KIMI_ADAPTER_ID = 'kimi-wire';
export const CODEX_ADAPTER_ID = 'codex-sessions';
export const NATIVE_ADAPTER_TYPE = 'append-only';
export const NATIVE_CORPUS_SUPPORTED = [1, 1];   // native-corpus 契约版本支持区间

/** §5.3 Kimi type allowlist（冻结）。 */
export const KIMI_TYPE_ALLOWLIST = new Set(['usage.record', 'step.end', 'profile.bind', 'metadata']);
/** Codex 计量/辅行 type 集（之外跳过不读）。双计量形态（2026-10-09 真实冻结实证）：
 *  - `token_usage_record`（现行宿主）：payload.usage=**逐请求直取值**（input_tokens/cached_input_tokens/
 *    cache_write_input_tokens/output_tokens/reasoning_output_tokens——OTel 命名族）；
 *  - `token_count`（22 §2.1 记档形态）：payload.info.total_token_usage=会话内**累计快照**→差分折算。 */
export const CODEX_TYPE_ALLOWLIST = new Set(['session_meta', 'turn_context', 'token_count', 'token_usage_record']);

/** token_usage_record（现行形态）→ 五路直取。 */
export function codexRecordFiveWay(usage) {
  const u = usage ?? {};
  return {
    input: Number.isFinite(u.input_tokens) ? u.input_tokens : null,
    output: Number.isFinite(u.output_tokens) ? u.output_tokens : null,
    reasoning: Number.isFinite(u.reasoning_output_tokens) ? u.reasoning_output_tokens : null,
    cache_read: Number.isFinite(u.cached_input_tokens) ? u.cached_input_tokens : null,
    cache_write: Number.isFinite(u.cache_write_input_tokens) ? u.cache_write_input_tokens : null,
  };
}

// ── 行字段容忍抽取（真实源形态以冻结实证为准；host feature matrix 留 VERIFIED/UNVERIFIED）──
const TS_KEYS = ['timestamp', 'time', 'createdAt', 'created_at', 'ts'];
export function rowTimestamp(row) {
  for (const k of TS_KEYS) {
    const v = row?.[k] ?? row?.payload?.[k];
    if (typeof v === 'string' && v !== '') {
      const ms = Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
      if (Number.isFinite(ms)) return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (typeof v === 'number' && Number.isFinite(v) && v > 1e12) {
      return new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');   // epoch 毫秒
    }
  }
  return null;
}

export function toIsoDay(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** P3-9 返修（显式哨兵选项）：行时戳/会话锚/mtime 三级锚全缺 → started_at=EPOCH_ZERO 哨兵
 *  +state=unknown（schema started_at 必填非空——禁以 Date.now() 采集时刻冒充源时戳；
 *  哨兵=可机械判别的"源时戳不可得"标记，state-mapping K3/C4 注记）。 */
export const STARTED_AT_SENTINEL = '1970-01-01T00:00:00Z';
function startedAtOrSentinel(ts) { return ts ?? STARTED_AT_SENTINEL; }

/** 解析 JSONL 文件为行数组（relPath=语料内相对路径；line=1-based）。allowlistTypes 在场时过滤 type。 */
export function readJsonlLines(absPath, relPath, { allowlistTypes = null } = {}) {
  const out = [];
  const text = readFileSync(absPath, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    let j;
    try { j = JSON.parse(raw); } catch {
      out.push({ relPath, line: i + 1, row: null, parseError: true });
      continue;
    }
    if (allowlistTypes && !allowlistTypes.has(String(j?.type ?? ''))) continue;
    out.push({ relPath, line: i + 1, row: j, parseError: false });
  }
  return out;
}

// ── Kimi wire.jsonl → model-request 投影 ──────────────────────────
/** usage.record 行 → 五路 vector（reasoning 恒 null——宿主缺路 N/A 不补零；VR-S17/O-17）。 */
export function kimiFiveWay(usage) {
  const u = usage ?? {};
  return {
    input: Number.isFinite(u.inputOther) ? u.inputOther : null,
    output: Number.isFinite(u.output) ? u.output : null,
    reasoning: null,   // 票面冻结断言：Kimi 无 reasoning 路（A1-② 断言锚）
    cache_read: Number.isFinite(u.inputCacheRead) ? u.inputCacheRead : null,
    cache_write: Number.isFinite(u.inputCacheCreation) ? u.inputCacheCreation : null,
  };
}

/**
 * Kimi 投影：corpus 目录内 eligible wire.jsonl → model-request 事件数组（rev=1 形态；dedupe 由 collect 叠加）。
 * workDir→project 归因已由 corpus 冻结 eligible 谓词执行（裁决⑧）——本函数只产事件。
 * @returns {{events, dim, fingerprint, anomalies}} dim=model 维 unknown 探针分子分母
 */
export function projectKimiCorpus(corpusRoot, section, sid, nowIso) {
  const events = [];
  const dim = { model: { unknown: 0, total: 0 } };
  const anomalies = [];
  const typeSet = new Set();
  for (const f of section.eligible_files) {
    const abs = join(corpusRoot, 'kimi', f.relative_path);
    const lines = readJsonlLines(abs, f.relative_path, { allowlistTypes: KIMI_TYPE_ALLOWLIST });
    for (const { relPath, line, row, parseError } of lines) {
      if (parseError) { anomalies.push(`${relPath}#${line}: 非法 JSON 行（跳过）`); continue; }
      typeSet.add(String(row.type));
      if (row.type !== 'usage.record') continue;   // 辅行不独立成事件（state-mapping K2）
      const model = String(row.model ?? row.payload?.model ?? '').trim();
      const usage = row.usage ?? row.payload?.usage;
      if (!model || !usage || typeof usage !== 'object') {
        throw Object.assign(new Error(`UNSUPPORTED_SOURCE：kimi 计量行缺必需字段（${relPath}#${line}：usage.record 须 model+usage——fingerprint 面）`), { code: 'UNSUPPORTED_SOURCE' });
      }
      const ts = rowTimestamp(row) ?? f.session_first_at ?? (f.mtime_ms ? toIsoDay(f.mtime_ms) : null);
      const state = ts ? 'terminal_completed' : 'unknown';   // 裁决⑥ K1/K3
      dim.model.total++;
      // P3-11 返修注记：model 在此恒非空（上方 !model 已 UNSUPPORTED_SOURCE fail-loud）——
      // 本行保留为 model 维探针的对称声明面（未来放宽必需字段时即生效），非可达死支。
      events.push({
        schema_version: 'v1', event_kind: 'model-request', event_id: '',
        entity_id: `${sid}:${KIMI_ADAPTER_ID}:${relPath}#${line}`,
        source_instance_id: sid, adapter_id: KIMI_ADAPTER_ID, adapter_type: NATIVE_ADAPTER_TYPE,
        source_primary_key: `${relPath}#${line}`, collected_at: nowIso, source_revision: 1,
        parent_entity_id: null,   // 裁决⑤：原生面无派发
        model: model.toLowerCase(), model_original: model,
        status: String(row.type), state,
        started_at: startedAtOrSentinel(ts),
        duration_ms: null,   // append-only 无原地补写协议——O-34 duration 子句适用 mutable-row
        time_to_first_token_ms: null, retry_count: 0,
        usage: kimiFiveWay(usage),
      });
    }
  }
  events.sort((a, b) => a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0);
  const fingerprint = createHash('sha256').update(canon({ adapter: KIMI_ADAPTER_ID, types: [...typeSet].sort(), required: { 'usage.record': ['model', 'usage'] } })).digest('hex');
  return { events, dim, fingerprint, anomalies };
}

// ── Codex sessions → model-request 投影 ──────────────────────────
/**
 * token_count 累计语义折算（22 §2.1 字段名 total_token_usage=会话内累计快照——P2-1 专列格）：
 * 相邻 token_count 行差分=逐请求增量；负增量（会话计数重置）→ 该路增量记 0+anomaly 留痕。
 * @param usages 逐 token_count 行累计五路快照（文件内行序）
 * @returns {{deltas, anomalies}}
 */
export function codexDeltaConvert(usages) {
  const deltas = [];
  const anomalies = [];
  let prev = null;
  for (const u of usages) {
    if (prev == null) { deltas.push({ ...u }); prev = u; continue; }
    const d = {};
    let negative = false;
    for (const k of ['input', 'output', 'reasoning', 'cache_read', 'cache_write']) {
      const cur = u[k], p = prev[k];
      if (cur == null || p == null) { d[k] = null; continue; }
      if (cur < p) negative = true;
      d[k] = Math.max(0, cur - p);
    }
    if (negative) anomalies.push(`token_count 累计回退（${JSON.stringify({ prev, cur: u })}）→增量记 0`);
    deltas.push(d);
    prev = u;
  }
  return { deltas, anomalies };
}

/**
 * Codex 投影：eligible rollout 文件 → model-request 事件（逐 token_count 行；累计→增量折算）+
 * spawn_agent 父子 join 探测（C5/C6 双路径）。
 * join 信号：子 rollout session_meta 携带父引用（parent_id/parent_session_id/parentRolloutId 任一）
 * 命中本 corpus 内其他 rollout 的会话身份 → join 可得（归因留痕）；否则 unattributed。
 * @returns {{events, dim, fingerprint, joinMap, unattributedChildren, anomalies}}
 */
export function projectCodexCorpus(corpusRoot, section, sid, nowIso) {
  // 第一遍：文件级会话身份与父引用收集
  const fileInfos = [];
  const typeSet = new Set();
  for (const f of section.eligible_files) {
    const abs = join(corpusRoot, 'codex', f.relative_path);
    const lines = readJsonlLines(abs, f.relative_path);   // 不过滤 type：计量/辅行全读
    let cwd = null, selfId = null, parentRef = null, firstTs = null, lastTs = null;
    const tokenRows = [];
    let turnModel = null;
    const fileAnomalies = [];
    for (const { relPath, line, row, parseError } of lines) {
      if (parseError) { fileAnomalies.push(`${relPath}#${line}: 非法 JSON 行（跳过）`); continue; }
      const t = String(row?.type ?? '');
      if (!CODEX_TYPE_ALLOWLIST.has(t)) continue;
      typeSet.add(t);
      const ts = rowTimestamp(row);
      if (ts) { if (firstTs == null) firstTs = ts; lastTs = ts; }
      if (t === 'session_meta') {
        cwd = row.payload?.cwd ?? row.payload?.workspaceRoot ?? cwd;
        selfId = row.payload?.id ?? row.payload?.session_id ?? selfId;
        // spawn_agent join 信号（容忍链）：显式父引用或 thread_source≠user（实证 2026-10-09：eligible 集=全 user 顶层）
        parentRef = row.payload?.parent_thread_id ?? row.payload?.parent_id ?? row.payload?.parent_session_id ?? row.payload?.parentRolloutId
          ?? ((row.payload?.thread_source && row.payload.thread_source !== 'user') ? row.payload.thread_source : null) ?? parentRef;
      } else if (t === 'turn_context') {
        turnModel = row.payload?.model ?? row.model ?? turnModel;
      } else if (t === 'token_count') {
        const u = row.payload?.info?.total_token_usage;
        if (!u || typeof u !== 'object') {
          throw Object.assign(new Error(`UNSUPPORTED_SOURCE：codex 计量行缺必需字段（${f.relative_path}#${line}：token_count 须 payload.info.total_token_usage——fingerprint 面）`), { code: 'UNSUPPORTED_SOURCE' });
        }
        tokenRows.push({ relPath: f.relative_path, line, ts, model: turnModel, cumulative: true, flat: null, usage: u });
      } else if (t === 'token_usage_record') {
        const u = row.payload?.usage;
        if (!u || typeof u !== 'object' || !('input_tokens' in u) || !('output_tokens' in u)) {
          throw Object.assign(new Error(`UNSUPPORTED_SOURCE：codex 计量行缺必需字段（${f.relative_path}#${line}：token_usage_record 须 payload.usage{input_tokens,output_tokens,…}——fingerprint 面）`), { code: 'UNSUPPORTED_SOURCE' });
        }
        tokenRows.push({ relPath: f.relative_path, line, ts, model: turnModel, cumulative: false, flat: codexRecordFiveWay(u), usage: u });
      }
    }
    fileInfos.push({ file: f, cwd, selfId, parentRef, firstTs, lastTs, tokenRows, anomalies: fileAnomalies });
  }
  // join 解析：父引用 → 本 corpus 内 rollout 会话身份
  const idIndex = new Map();
  for (const fi of fileInfos) if (fi.selfId) idIndex.set(String(fi.selfId), fi.file.relative_path);
  const joinMap = [];
  const unattributedChildren = [];
  for (const fi of fileInfos) {
    if (!fi.parentRef) continue;
    const parentPath = idIndex.get(String(fi.parentRef));
    if (parentPath && parentPath !== fi.file.relative_path) joinMap.push({ child: fi.file.relative_path, parent: parentPath, ref: String(fi.parentRef) });
    else unattributedChildren.push(fi.file.relative_path);
  }
  // 第二遍：事件构造（token_count 累计段差分折算；token_usage_record 逐请求直取——实证双形态）
  const events = [];
  const dim = { model: { unknown: 0, total: 0 } };
  const anomalies = [];
  for (const fi of fileInfos) {
    if (fi.tokenRows.length === 0) continue;
    const usages = fi.tokenRows.map(r => r.cumulative
      ? {
        input: Number.isFinite(r.usage.input) ? r.usage.input : null,
        output: Number.isFinite(r.usage.output) ? r.usage.output : null,
        reasoning: Number.isFinite(r.usage.reasoning) ? r.usage.reasoning : null,
        cache_read: Number.isFinite(r.usage.cached) ? r.usage.cached : null,
        cache_write: Number.isFinite(r.usage.cache_write) ? r.usage.cache_write : null,
      }
      : r.flat);
    const final = usages.map(u => ({ ...u }));   // 逐请求直取基线；累计段由 flushRun 覆写为差分
    // 累计段（token_count 形态）差分：连续 cumulative 行序列内逐对差分
    let runStart = -1;
    const flushRun = (end) => {
      if (runStart < 0) return;
      const run = usages.slice(runStart, end);
      const { deltas, anomalies: convAnoms } = codexDeltaConvert(run);
      anomalies.push(...convAnoms);
      for (let k = 0; k < deltas.length; k++) final[runStart + k] = deltas[k];
      runStart = -1;
    };
    for (let i = 0; i <= usages.length; i++) {
      const cum = i < usages.length && fi.tokenRows[i].cumulative;
      if (cum && runStart < 0) runStart = i;
      if (!cum && runStart >= 0) flushRun(i);
    }
    anomalies.push(...fi.anomalies);
    fi.tokenRows.forEach((r, i) => {
      const model = String(r.model ?? '').trim();
      const ts = r.ts ?? fi.firstTs ?? fi.file.session_first_at ?? (fi.file.mtime_ms ? toIsoDay(fi.file.mtime_ms) : null);
      const state = ts ? 'terminal_completed' : 'unknown';
      dim.model.total++;
      if (model === '') dim.model.unknown++;
      events.push({
        schema_version: 'v1', event_kind: 'model-request', event_id: '',
        entity_id: `${sid}:${CODEX_ADAPTER_ID}:${r.relPath}#${r.line}`,
        source_instance_id: sid, adapter_id: CODEX_ADAPTER_ID, adapter_type: NATIVE_ADAPTER_TYPE,
        source_primary_key: `${r.relPath}#${r.line}`, collected_at: nowIso, source_revision: 1,
        parent_entity_id: null,   // 裁决⑤+VR-X03（join 归因留痕走 joinMap，不入事件字段）
        model: model.toLowerCase() || 'unknown', model_original: model || 'unknown',
        status: r.cumulative ? 'token_count' : 'token_usage_record', state,
        started_at: ts ?? toIsoDay(fi.file.mtime_ms ?? Date.now()),
        duration_ms: null, time_to_first_token_ms: null, retry_count: 0,
        usage: final[i],
      });
    });
  }
  events.sort((a, b) => a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0);
  const fingerprint = createHash('sha256').update(canon({ adapter: CODEX_ADAPTER_ID, types: [...typeSet].sort(), required: { token_count: ['payload.info.total_token_usage'], token_usage_record: ['payload.usage.input_tokens', 'payload.usage.output_tokens'], session_meta: ['payload.cwd'], turn_context: ['payload.model'] } })).digest('hex');
  return { events, dim, fingerprint, joinMap, unattributedChildren, anomalies };
}

// ── corpus 完整性与 manifest 装载 ────────────────────────────────
export function loadCorpusManifest(storeRoot, corpusId) {
  const dir = join(storeRoot, 'snapshots', String(corpusId));
  const mpath = join(dir, 'manifest.json');
  if (!existsSync(mpath)) return { error: `CORPUS_NOT_FOUND：${dir}` };
  let manifest;
  try { manifest = JSON.parse(readFileSync(mpath, 'utf8')); }
  catch (e) { return { error: `CORPUS_MANIFEST_UNREADABLE：${e.message}` }; }
  const errs = validateFixture({ fixture_kind: 'native-corpus', ...manifest });
  if (errs.length) return { error: `CORPUS_MANIFEST_INVALID：\n${errs.map(e => `  ${e.rule} ${e.pointer}——${e.message}`).join('\n')}` };
  return { manifest, dir };
}

/** 文件 size/hash 回退检测（裁决⑦ fail-loud）：eligible 文件当前 sha/size 对 manifest 逐件恒等。 */
export function verifyCorpusIntegrity(corpusDir, section, subDir) {
  const problems = [];
  for (const f of section.eligible_files) {
    const abs = join(corpusDir, subDir, f.relative_path);
    if (!existsSync(abs)) { problems.push(`文件缺失（截断/移除面）：${f.relative_path}`); continue; }
    const st = statSync(abs);
    if (st.size !== f.size_bytes) problems.push(`size 回退：${f.relative_path} manifest=${f.size_bytes} 现值=${st.size}`);
    if (sha256File(abs) !== f.sha256) problems.push(`hash 回退（截断/轮转/重写）：${f.relative_path}`);
  }
  return problems;
}

// ── native audit 侧车（⑨ 回退检测输入——corpus 面；zcode sqlite 侧车另形）──
export const NATIVE_AUDIT_REQUIRED = ['corpus_id', 'files_digest', 'file_count', 'generation', 'updated_at', 'payload_sha256'];
export function nativeAuditChecksum(body) {
  const { payload_sha256: _d, ...rest } = body;
  return createHash('sha256').update(canon(rest)).digest('hex');
}
/** P3-10 返修：路径式与 events-engine.auditPath 合一（同式单源——cursors/<adapter>.audit.json）。 */
export function nativeAuditPath(storeRoot, adapterId) { return eeAuditPath(storeRoot, adapterId); }
export function writeNativeAudit(storeRoot, adapterId, observed) {
  writeJson(nativeAuditPath(storeRoot, adapterId), { ...observed, payload_sha256: nativeAuditChecksum(observed) });
}
export function loadNativeAudit(storeRoot, adapterId) {
  const p = nativeAuditPath(storeRoot, adapterId);
  if (!existsSync(p)) return { audit: null };
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); }
  catch { return { audit: null, problems: ['native audit 侧车不可解析（截断/非 JSON）'] }; }
  const problems = [];
  for (const f of NATIVE_AUDIT_REQUIRED) if (!j || typeof j !== 'object' || !(f in j)) problems.push(`native audit 缺必填字段 ${f}`);
  if (!problems.length && (typeof j.payload_sha256 !== 'string' || nativeAuditChecksum(j) !== j.payload_sha256)) {
    problems.push('native audit payload_sha256 与载荷不符（E2c 同型判定）');
  }
  return problems.length ? { audit: j, problems } : { audit: j };
}
/** corpus 源节文件摘要（audit files_digest 输入：[relative_path,sha256] 序列 canonical SHA）。 */
export function sectionFilesDigest(section) {
  return sha256Hex(canon(section.eligible_files.map(f => [f.relative_path, f.sha256])));
}
