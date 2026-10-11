// stats2/contract-validator.mjs — stats-1 契约三层验证器（结构 VR-Sxx / 跨字段 VR-Fxx / 跨事件 VR-Xxx）
// 自 templates/tools/harness-stats.mjs 原位抽出（stats-2 P1-1：生产 collect 产物须过同一 validator——单源不复刻）。
// 行为零改动：validate-schema 套件与单文件行为由本模块承载，harness-stats.mjs 仅做 CLI 壳。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

const STATS_DIR = join(import.meta.dirname, '..', '..', 'stats'); // stats2/ → templates/stats/

// ── schema 装载 ───────────────────────────────────────────────────
const loadJson = p => JSON.parse(readFileSync(p, 'utf8'));
const EVENT_SCHEMA = loadJson(join(STATS_DIR, 'event-schema-v1.json'));
const MANIFEST_SCHEMAS = {
  'segment-manifest': loadJson(join(STATS_DIR, 'manifest-schemas', 'segment-manifest-v1.json')),
  'bundle-manifest': loadJson(join(STATS_DIR, 'manifest-schemas', 'bundle-manifest-v1.json')),
  'report-manifest': loadJson(join(STATS_DIR, 'manifest-schemas', 'report-manifest-v1.json')),
  'cursor-state': loadJson(join(STATS_DIR, 'manifest-schemas', 'cursor-state-v1.json')),
  'pilot-bundle': loadJson(join(STATS_DIR, 'pilot-bundle-schema.json')),
  // stats-3 阶段一新增（附件 A / 裁决⑧）
  'reconcile-input': loadJson(join(STATS_DIR, 'manifest-schemas', 'reconcile-input-v1.json')),
  'native-corpus': loadJson(join(STATS_DIR, 'manifest-schemas', 'native-corpus-v1.json')),
};
const COMMON_REQUIRED = Object.keys(EVENT_SCHEMA.common_properties);

// VR-S14 语义范围（2026-10-07 审查轮收紧，traceability.md H6 登记）：pattern 只验字形（曾放过 2026-13-45T99:99:99Z
// 且 Date.parse→NaN 令 VR-F07 守卫跳过），此处追加历法范围：月 01-12、日 01-按月天数（闰年 2 月 29）、时 00-23、分/秒 00-59
function timestampSemanticError(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (!m) return null; // 字形未过 pattern 的已由结构层先行报错
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12) return `月 ${m[2]} 越界（须 01-12）`;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (Number(m[3]) < 1 || Number(m[3]) > dim) return `日 ${m[3]} 越界（${m[2]} 月须 01-${dim}）`;
  if (Number(m[4]) > 23) return `时 ${m[4]} 越界（须 00-23）`;
  if (Number(m[5]) > 59) return `分 ${m[5]} 越界（须 00-59）`;
  if (Number(m[6]) > 59) return `秒 ${m[6]} 越界（须 00-59）`;
  return null;
}

// ── ① 结构层：最小 JSON Schema 子集校验器 ─────────────────────────
function validateNode(value, schema, pointer, errors, objRule) {
  const rule = schema.rule ?? objRule ?? 'VR-SCHEMA';
  const fail = msg => errors.push({ rule, pointer, message: msg });
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;
  if (types) {
    const ok = types.some(t =>
      t === 'null' ? value === null
      : t === 'string' ? typeof value === 'string'
      : t === 'integer' ? Number.isInteger(value)
      : t === 'boolean' ? typeof value === 'boolean'
      : t === 'object' ? (value !== null && typeof value === 'object' && !Array.isArray(value))
      : t === 'array' ? Array.isArray(value) : false);
    if (!ok) return fail(`类型 ${JSON.stringify(value?.constructor?.name ?? value)} 不符 ${JSON.stringify(schema.type)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) return fail(`值 ${JSON.stringify(value)} 不在枚举 {${schema.enum.join('|')}}`);
  if (schema.const !== undefined && value !== schema.const) return fail(`值 ${JSON.stringify(value)} ≠ 常量 ${JSON.stringify(schema.const)}`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return fail(`值 ${JSON.stringify(value)} 不匹配 ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) return fail(`长度 ${value.length} < ${schema.minLength}`);
    if (rule === 'VR-S14') {
      const sem = timestampSemanticError(value);
      if (sem) return fail(`时间戳语义越界：${JSON.stringify(value)}（${sem}；VR-S14=字形+语义）`);
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) return fail(`值 ${value} < 下限 ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return fail(`元素数 ${value.length} < ${schema.minItems}`);
    if (schema.items) value.forEach((el, i) => validateNode(el, schema.items, `${pointer}/${i}`, errors, rule));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push({ rule, pointer: schema.properties?.[req] ? `${pointer}/${req}` : pointer, message: `缺必填字段 ${req}` });
    }
    if (schema.properties) {
      // stats-3 阶段一：递归传播本帧生效 rule（旧=透传顶层 objRule，载荷内部违规会上浮到外层规则——
      // allowlist 冻结后须由容器自身 rule（VR-S29/VR-S30 等）承接内部字段违规）
      for (const [k, v] of Object.entries(value)) {
        if (schema.additionalProperties === false && !(k in schema.properties)) {
          errors.push({ rule, pointer: `${pointer}/${k}`, message: `多余字段 ${k}（allowlist 外）` }); continue;
        }
        if (k in schema.properties) validateNode(v, schema.properties[k], `${pointer}/${k}`, errors, rule);
      }
    }
  }
}

// 事件结构验证：按 event_kind 判别合并公共字段与类型 schema；observation 再按 subtype 二级判别
function structuralEvent(event, idx, errors) {
  const p = `/events/${idx}`;
  validateNode(event.event_kind, EVENT_SCHEMA.common_properties.event_kind, `${p}/event_kind`, errors, 'VR-S03');
  if (event.event_kind !== 'dispatch' && event.event_kind !== 'model-request' && event.event_kind !== 'observation') return;
  const kindSchema = EVENT_SCHEMA.event_schemas[event.event_kind];
  let merged = {
    rule: kindSchema.rule,
    required: [...COMMON_REQUIRED, ...kindSchema.required],
    properties: { ...EVENT_SCHEMA.common_properties, ...kindSchema.properties },
    additionalProperties: false,
    type: 'object',
  };
  if (event.event_kind === 'observation' && event.observation_subtype && kindSchema.subschemas[event.observation_subtype]) {
    const sub = kindSchema.subschemas[event.observation_subtype];
    merged = {
      rule: sub.rule,
      required: [...merged.required, ...sub.required],
      properties: { ...merged.properties, ...sub.properties },
      additionalProperties: false,
      type: 'object',
    };
  }
  validateNode(event, merged, p, errors, merged.rule);
}

function structural(fixture, errors) {
  const kind = fixture.fixture_kind;
  if (kind === 'event-corpus') {
    validateNode(fixture, EVENT_SCHEMA.fixture_envelope, '', errors, 'VR-S28');
    (fixture.events ?? []).forEach((e, i) => structuralEvent(e, i, errors));
    return;
  }
  const schema = MANIFEST_SCHEMAS[kind];
  if (!schema) { errors.push({ rule: 'VR-S28', pointer: '/fixture_kind', message: `未知 fixture_kind：${JSON.stringify(kind)}` }); return; }
  validateNode(kind, schema.fixture_envelope.properties.fixture_kind, '/fixture_kind', errors, 'VR-S28');
  const { fixture_kind: _fk, description: _d, ...payload } = fixture;
  validateNode(payload, schema.manifest, '', errors, schema.manifest.rule);
}

// ── ② 跨字段层 ───────────────────────────────────────────────────
const canon = v => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');

function crossField(fixture, errors) {
  if (fixture.fixture_kind === 'event-corpus') {
    (fixture.events ?? []).forEach((e, i) => crossFieldEvent(e, `/events/${i}`, errors));
    return;
  }
  if (fixture.fixture_kind === 'cursor-state') {
    const { fixture_kind: _fk, description: _d, payload_sha256, ...body } = fixture;
    if (typeof payload_sha256 === 'string' && sha256(canon(body)) !== payload_sha256) {
      errors.push({ rule: 'VR-S23', pointer: '/payload_sha256', message: 'cursor 校验和与载荷不符（E2c 坏校验形态）' });
    }
    return;
  }
  if (fixture.fixture_kind === 'native-corpus') {
    // VR-F13（stats-3 阶段一，裁决⑧）：kimi/codex 两源节 eligible 计数自洽
    // （eligible_count ≤ total_scanned 且 = eligible_files 长度——与 VR-F10 bundle 同纪律）
    for (const src of ['kimi', 'codex']) {
      const s = fixture[src];
      if (s && Array.isArray(s.eligible_files) && Number.isInteger(s.eligible_count) && Number.isInteger(s.total_scanned)) {
        if (!(s.eligible_count <= s.total_scanned && s.eligible_count === s.eligible_files.length)) {
          errors.push({ rule: 'VR-F13', pointer: `/${src}/eligible_count`, message: `${src} 源 eligible 计数不自洽：eligible_count=${s.eligible_count}、eligible_files=${s.eligible_files.length}、total_scanned=${s.total_scanned}` });
        }
      }
    }
    return;
  }
  if (fixture.fixture_kind === 'bundle-manifest' || fixture.fixture_kind === 'pilot-bundle') {
    const mc = fixture.metadata_corpus;
    if (mc && Array.isArray(mc.eligible_files) && Number.isInteger(mc.eligible_count) && Number.isInteger(mc.total_scanned)) {
      if (!(mc.eligible_count <= mc.total_scanned && mc.eligible_count === mc.eligible_files.length)) {
        errors.push({ rule: 'VR-F10', pointer: '/metadata_corpus/eligible_count', message: `eligible 计数不自洽：eligible_count=${mc.eligible_count}、eligible_files=${mc.eligible_files.length}、total_scanned=${mc.total_scanned}` });
      }
    }
    // VR-F12 role_status_counts 聚合自洽（stats-2 阶段一契约批新增，审查 P0-1）：
    // 键=规范化 `role|status`（单一 | 分隔）、按字典序排列；值=整数 ≥1；Σ值=eligible_count（三恒等第一重的 manifest 声明面）
    if (mc && mc.role_status_counts != null && typeof mc.role_status_counts === 'object' && !Array.isArray(mc.role_status_counts)) {
      const rsc = mc.role_status_counts;
      const keys = Object.keys(rsc);
      const problems = [];
      for (const k of keys) {
        if (!/^[^|\s]+\|[^|\s]+$/.test(k)) problems.push(`键 ${JSON.stringify(k)} 不符规范化 role|status 形（单一 | 分隔）`);
        const v = rsc[k];
        if (!Number.isInteger(v) || v < 1) problems.push(`键 ${JSON.stringify(k)} 值 ${JSON.stringify(v)} 非整数或 <1`);
      }
      const sorted = [...keys].sort();
      for (let i = 0; i < keys.length; i++) if (keys[i] !== sorted[i]) { problems.push('键未按字典序排列（canonical 排序=SHA 可复现前提）'); break; }
      if (Number.isInteger(mc.eligible_count)) {
        const sum = keys.reduce((a, k) => a + rsc[k], 0);
        if (sum !== mc.eligible_count) problems.push(`Σ role_status_counts=${sum} ≠ eligible_count=${mc.eligible_count}（三恒等第一重：manifest 声明聚合须与 eligible 计数恒等）`);
      }
      if (problems.length) errors.push({ rule: 'VR-F12', pointer: '/metadata_corpus/role_status_counts', message: problems.join('；') });
    }
  }
}

function crossFieldEvent(e, p, errors) {
  const fail = (rule, pointer, message) => errors.push({ rule, pointer: p + pointer, message });
  // VR-F01 身份公式：entity_id = source_instance_id : adapter_id : source_primary_key（分隔符=本票 schema 细化）
  if (typeof e.entity_id === 'string' && typeof e.source_instance_id === 'string' && typeof e.adapter_id === 'string' && typeof e.source_primary_key === 'string'
      && e.entity_id !== `${e.source_instance_id}:${e.adapter_id}:${e.source_primary_key}`) {
    fail('VR-F01', '/entity_id', 'entity_id ≠ source_instance_id:adapter_id:source_primary_key');
  }
  const revKinds = e.event_kind === 'dispatch' || e.event_kind === 'model-request';
  // VR-F02 dispatch/model-request：event_id = entity_id : source_revision
  if (revKinds && Number.isInteger(e.source_revision) && e.event_id !== `${e.entity_id}:${e.source_revision}`) {
    fail('VR-F02', '/event_id', `event_id ≠ entity_id:source_revision（source_revision=${e.source_revision}）`);
  }
  // VR-F03 ticket_snapshot：event_id = entity_id : obs : source_hash8
  if (e.event_kind === 'observation' && e.observation_subtype === 'ticket_snapshot' && typeof e.source_hash8 === 'string'
      && e.event_id !== `${e.entity_id}:obs:${e.source_hash8}`) {
    fail('VR-F03', '/event_id', 'event_id ≠ entity_id:obs:source_hash8');
  }
  // VR-F04 derived：event_id = entity_id : drv : derivation_revision
  if (e.event_kind === 'observation' && e.observation_subtype === 'derived' && Number.isInteger(e.derivation_revision)
      && e.event_id !== `${e.entity_id}:drv:${e.derivation_revision}`) {
    fail('VR-F04', '/event_id', 'event_id ≠ entity_id:drv:derivation_revision');
  }
  // VR-F05 append-only：source_revision 恒 1
  if (revKinds && e.adapter_type === 'append-only' && e.source_revision !== 1) {
    fail('VR-F05', '/source_revision', `append-only 行 source_revision=${e.source_revision}，恒 1 之外非法`);
  }
  // VR-F06 终态字段约束
  if (e.event_kind === 'dispatch' && typeof e.state === 'string') {
    if (['terminal_completed', 'terminal_failed', 'terminal_cancelled', 'missing_child'].includes(e.state)) {
      if (e.completed_at == null || e.wall_clock_ms == null) fail('VR-F06', '/completed_at', `state=${e.state} 而 completed_at/wall_clock_ms 须双非 null`);
    } else if (e.state === 'observed_running' || e.state === 'stale_orphan') {
      if (e.completed_at != null || e.wall_clock_ms != null) fail('VR-F06', '/completed_at', `state=${e.state} 而 completed_at/wall_clock_ms 须双 null（stale_orphan 不计墙钟）`);
    }
  }
  // VR-F07 墙钟公式（解析失败已被 S14 拦下，此处守护跳过）
  if (e.event_kind === 'dispatch' && typeof e.completed_at === 'string' && typeof e.created_at === 'string') {
    const done = Date.parse(e.completed_at), start = Date.parse(e.created_at);
    if (Number.isFinite(done) && Number.isFinite(start) && e.wall_clock_ms !== done - start) {
      fail('VR-F07', '/wall_clock_ms', `wall_clock_ms=${e.wall_clock_ms} ≠ ms(completed_at)−ms(created_at)=${done - start}`);
    }
  }
  // VR-F08 归因上三级 ⇒ ticket_slug 非 null（CANDIDATE 永不入票级的结构面）
  if (e.event_kind === 'dispatch' && ['EXPLICIT', 'DIRECT', 'MANUAL_RECONCILED'].includes(e.attribution) && e.ticket_slug == null) {
    fail('VR-F08', '/ticket_slug', `attribution=${e.attribution} 须携带 ticket_slug`);
  }
  // VR-F09 terminal_completed/failed ⇒ token/duration 已原地补写（缺路 N/A 仅适用 reasoning/cache）
  // stats-3 阶段二适用面细化（裁决⑥配套，O-34 注记）：duration_ms 子句=adapter_type=mutable-row 专属
  // （锚=§5.4-1「源行 running→terminal 原地补写」mutable-row 协议；append-only 行 ingest 即终态、
  // duration 不可观=null 合法）；usage.input/output 子句全 adapter 通用（计量行无 usage=不构成事件）。
  if (e.event_kind === 'model-request' && ['terminal_completed', 'terminal_failed'].includes(e.state)
    && e.usage && typeof e.usage === 'object') {
    const missing = [];
    if (e.usage.input == null) missing.push('usage.input');
    if (e.usage.output == null) missing.push('usage.output');
    if (e.duration_ms == null && e.adapter_type === 'mutable-row') missing.push('duration_ms');
    if (missing.length) {
      fail('VR-F09', '/usage', `state=${e.state} 而 ${missing.join('/')} 须非空（运行→终态原地补写；duration 子句适用 mutable-row）`);
    }
  }
  // VR-F11 组合 sanity（gap-6② 裁 A，22 §2.2 判定协议第 3 条组合注记）：attempt_kind=initial ⇒ trigger_stage=unknown
  // guard（冻结）：仅当 attempt_kind 与 trigger_stage 均为各自合法 enum 值时执行——非法枚举值（如 neg-VR-S10 的 deploy）
  // 已由结构层 VR-S09/VR-S10 报错，此处不再叠加，防双命中破坏「每负例恰中一条规则」纪律
  if (e.event_kind === 'dispatch') {
    const kindOk = typeof e.attempt_kind === 'string' && EVENT_SCHEMA.event_schemas.dispatch.properties.attempt_kind.enum.includes(e.attempt_kind);
    const stageOk = typeof e.trigger_stage === 'string' && EVENT_SCHEMA.event_schemas.dispatch.properties.trigger_stage.enum.includes(e.trigger_stage);
    if (kindOk && stageOk && e.attempt_kind === 'initial' && e.trigger_stage !== 'unknown') {
      fail('VR-F11', '/trigger_stage', `attempt_kind=initial 而 trigger_stage=${e.trigger_stage}（initial ⇒ trigger_stage=unknown，其余组合不设约束）`);
    }
  }
}

// ── ③ 跨事件层（corpus 级） ──────────────────────────────────────
function crossEvent(fixture, errors) {
  if (fixture.fixture_kind !== 'event-corpus' || !Array.isArray(fixture.events)) return;
  const seen = new Map(); // event_id -> 次数
  const dispatchEntities = new Set();
  const lastRev = new Map(); // entity_id -> 最近 source_revision（dispatch/mr 链）
  const lastDrv = new Map(); // entity_id -> 最近 derivation_revision
  for (let i = 0; i < fixture.events.length; i++) {
    const e = fixture.events[i], p = `/events/${i}`;
    if (typeof e.event_id === 'string') seen.set(e.event_id, (seen.get(e.event_id) ?? 0) + 1);
    if (e.event_kind === 'dispatch' && typeof e.entity_id === 'string') dispatchEntities.add(e.entity_id);
  }
  for (const [id, n] of seen) if (n > 1) {
    errors.push({ rule: 'VR-X01', pointer: '/events', message: `event_id 重复 ${n} 次：${id}` });
  }
  for (let i = 0; i < fixture.events.length; i++) {
    const e = fixture.events[i], p = `/events/${i}`;
    const revKinds = e.event_kind === 'dispatch' || e.event_kind === 'model-request';
    if (revKinds && Number.isInteger(e.source_revision) && typeof e.entity_id === 'string') {
      const prev = lastRev.get(e.entity_id);
      if (prev !== undefined && e.source_revision <= prev) {
        errors.push({ rule: 'VR-X02', pointer: `${p}/source_revision`, message: `实体 ${e.entity_id} 的 source_revision 非严格递增（${prev} → ${e.source_revision}；running→terminal=同实体新 revision 不换键）` });
      }
      lastRev.set(e.entity_id, e.source_revision);
    }
    if (e.event_kind === 'model-request' && typeof e.parent_entity_id === 'string' && !dispatchEntities.has(e.parent_entity_id)) {
      errors.push({ rule: 'VR-X03', pointer: `${p}/parent_entity_id`, message: `归派发悬空：${e.parent_entity_id} 在本 corpus 无对应 dispatch 实体` });
    }
    if (e.event_kind === 'observation' && e.observation_subtype === 'derived' && Number.isInteger(e.derivation_revision) && typeof e.entity_id === 'string') {
      const prev = lastDrv.get(e.entity_id);
      if (prev !== undefined && e.derivation_revision <= prev) {
        errors.push({ rule: 'VR-X04', pointer: `${p}/derivation_revision`, message: `实体 ${e.entity_id} 的 derivation_revision 非严格递增（${prev} → ${e.derivation_revision}）` });
      }
      lastDrv.set(e.entity_id, e.derivation_revision);
    }
  }
}

// ── fixture 验证入口（三层） ──────────────────────────────────────
function validateFixture(fixture) {
  const errors = [];
  structural(fixture, errors);
  crossField(fixture, errors);
  crossEvent(fixture, errors);
  return errors;
}

// ── 套件模式：正例绿 + 负例恰中 + 义务对账 ────────────────────────
const RULE_RE = /VR-[SFX]\d{2}/;
function runSuite(statsDir) {
  let bad = 0;
  const posDir = join(statsDir, 'fixtures', 'positive');
  const negDir = join(statsDir, 'fixtures', 'negative');
  const posFiles = readdirSync(posDir).filter(f => f.endsWith('.json')).sort();
  const negFiles = readdirSync(negDir).filter(f => f.endsWith('.json')).sort();

  console.log('-- 正例（fixtures/positive）--');
  for (const f of posFiles) {
    let fixture;
    try { fixture = loadJson(join(posDir, f)); }
    catch { bad++; console.log(`[FAIL] ${f}（JSON 解析失败）`); continue; }
    const errs = validateFixture(fixture);
    if (errs.length === 0) console.log(`[PASS] ${f}`);
    else { bad++; console.log(`[FAIL] ${f}`); errs.forEach(e => console.log(`       ${e.rule} ${e.pointer} — ${e.message}`)); }
  }
  console.log('-- 负例（fixtures/negative；每件须恰中文件名编码的规则）--');
  for (const f of negFiles) {
    const expected = basename(f).match(/^neg-(VR-[SFX]\d{2})-/)?.[1];
    let fixture;
    try { fixture = loadJson(join(negDir, f)); }
    catch { bad++; console.log(`[FAIL] ${f}（JSON 解析失败）`); continue; }
    const errs = validateFixture(fixture);
    const got = [...new Set(errs.map(e => e.rule))];
    if (expected && errs.length > 0 && got.length === 1 && got[0] === expected) console.log(`[PASS] ${f} → 恰中 ${expected}`);
    else { bad++; console.log(`[FAIL] ${f}（期望 ${expected ?? '（文件名未编码规则）'}，实得 [${got.join(', ')}]）`); errs.forEach(e => console.log(`       ${e.rule} ${e.pointer} — ${e.message}`)); }
  }

  console.log('-- 义务覆盖对账（obligations.md × fixtures）--');
  const rows = readFileSync(join(statsDir, 'obligations.md'), 'utf8').split('\n')
    .filter(l => /^\| O-\d{2} \|/.test(l))
    .map(l => l.split('|').map(c => c.trim()));
  if (rows.length === 0) { bad++; console.log('[FAIL] obligations.md 未解析到任何 O-xx 行'); }
  const seenRules = new Set(); const negRefs = new Map(); const posRefs = new Set();
  for (const cells of rows) {
    const [, id, , , , , rule, posCell, negCell] = cells;   // cells[0]=行首空段：[1]=O-xx [6]=rule [7]=pos [8]=neg
    const problems = [];
    if (!RULE_RE.test(rule)) problems.push(`规则 ID 非法：${rule}`);
    if (seenRules.has(rule)) problems.push(`规则 ${rule} 重复出现在多条义务`);
    seenRules.add(rule);
    for (const stem of (posCell ?? '').split(/[,，]/).map(s => s.trim()).filter(Boolean)) {
      posRefs.add(stem);
      if (!posFiles.includes(`${stem}.json`)) problems.push(`正 fixture 缺失：${stem}`);
    }
    for (const stem of (negCell ?? '').split(/[,，]/).map(s => s.trim()).filter(Boolean)) {
      const prev = negRefs.get(stem);
      if (prev) problems.push(`负 fixture ${stem} 被多条义务引用（${prev} 与 ${id}）`);
      negRefs.set(stem, id);
      if (!negFiles.includes(`${stem}.json`)) problems.push(`负 fixture 缺失：${stem}`);
      else if (basename(stem).match(/^(neg-(VR-[SFX]\d{2}))-/)?.[2] !== rule) problems.push(`负 fixture ${stem} 编码规则 ≠ ${rule}`);
    }
    if (!posCell) problems.push('正 fixture 列为空');
    if (!negCell) problems.push('负 fixture 列为空');
    if (problems.length) { bad++; console.log(`[FAIL] ${id}（${rule}）：${problems.join('；')}`); }
    else console.log(`[PASS] ${id} → ${rule}（正 ${posCell.split(/[,，]/).length} / 负 ${negCell.split(/[,，]/).length}）`);
  }
  for (const f of negFiles) if (!negRefs.has(f.replace(/\.json$/, ''))) { bad++; console.log(`[FAIL] 孤儿负例（无义务行引用）：${f}`); }
  for (const f of posFiles) if (!posRefs.has(f.replace(/\.json$/, ''))) { bad++; console.log(`[FAIL] 孤儿正例（无义务行引用）：${f}`); }

  console.log(`\n摘要：正例 ${posFiles.length} 件；负例 ${negFiles.length} 件；义务 ${rows.length} 条；${bad === 0 ? '全绿' : `红 ${bad} 项`}`);
  return bad;
}


export { validateFixture, runSuite, loadJson, canon, sha256 };

// ── P1-7：revision 投影键=schema 驱动（禁手写清单——本票冻结 schema 为唯一单源）──
// 排除面=身份公式成员（VR-F01）与采集元数据：schema_version/event_kind/event_id/entity_id/
// source_instance_id/adapter_id/adapter_type/source_primary_key/source_revision/collected_at——
// collected_at=采集时间戳非源内容（① 幂等 no-op 的前提：二次采集同源不因采集时刻不同而虚增 revision）。
// stats-3 裁决③（阶段一批）：route_anchor.collector_version 并入排除面——采集器版本升级不虚增
// revision（① no-op 语义优先；义务=O-27 修订留痕）。承载=REVISION_EXCLUDED_NESTED（嵌套排除位）。
const REVISION_EXCLUDED = new Set([
  'schema_version', 'event_kind', 'event_id', 'entity_id', 'source_instance_id',
  'adapter_id', 'adapter_type', 'source_primary_key', 'source_revision', 'collected_at',
]);
/** 嵌套排除位：字段路径 → 该对象内被排除的子字段（裁决③：collector_version 不入投影）。 */
const REVISION_EXCLUDED_NESTED = { route_anchor: new Set(['collector_version']) };
/** 返回 event_kind 的 revision 投影字段清单（common+子 schema 属性 − 排除面，字典序稳定）。 */
export function revisionProjectionFields(kind) {
  const s = EVENT_SCHEMA.event_schemas[kind];
  if (!s) throw new Error(`未知 event_kind：${kind}`);
  return [...Object.keys(EVENT_SCHEMA.common_properties), ...Object.keys(s.properties)]
    .filter(f => !REVISION_EXCLUDED.has(f)).sort();
}

/** P2-9（三审）：revision 投影内容键单源——collect 的 contentKey 与单变量敏感性测试共用同一实现。
 *  逐字段单变（如仅 created_at、仅 project_id）必须翻转此键（真隔离；wall_clock_ms 伴变不得掩盖缺项）。
 *  裁决③（stats-3 阶段一）：route_anchor 携带嵌套排除面——collector_version 变化不翻转内容键。 */
export function projectionContentKey(event) {
  const fields = revisionProjectionFields(event.event_kind);
  return canon(Object.fromEntries(fields.map(f => {
    const nested = REVISION_EXCLUDED_NESTED[f];
    if (nested && event[f] && typeof event[f] === 'object' && !Array.isArray(event[f])) {
      return [f, Object.fromEntries(Object.keys(event[f]).sort().filter(k => !nested.has(k)).map(k => [k, event[f][k]]))];
    }
    return [f, event[f]];
  })));
}