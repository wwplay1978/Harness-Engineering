// stats2/project.mjs — bundle → 事件投影（collect 与 rebuild --from-source 共用的双源投影单源）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeOwnedTempDir } from './store.mjs';
import { openReadOnly, withReadonlyDbCopy, selectModelUsageWindow, selectSessions, schemaFingerprint, toIsoUtc, ZCODE_ADAPTER_ID, ZCODE_ADAPTER_TYPE } from './zcode-source.mjs';

export const MECH_ROLES = new Set(['planner', 'developer', 'code-reviewer', 'qa-tester', 'red-teamer', 'archiver']);
/**
 * §5.3 known_enum_values·role 维 v1（版本化白名单；宿主实测面）：
 * 机制六角色（±-rerun）+ 已知宿主内建非机制 agent（主会话 agent/Explore/judge/general-purpose/documents:*）。
 * 白名单外值=unknown（schema 漂移探测面）；已知非机制值归 other（known=true，不计 unknown 占比）。
 * v1 清单来源：docs/22 §2.1 I: 分布 + pilot bundle 2026-10-08 全量 GROUP BY agent 实测。
 */
export const KNOWN_OTHER_AGENTS = new Set([
  'agent',            // 主交互会话（model_usage.agent='zcode-agent'，非派发角色）
  'explore', 'judge', 'general-purpose', 'documents:visual-judge',
]);
export const ROLE_ENUM_VERSION = 'zcode-agent-enum-v1';
export const SOURCE_STATUS_ENUM = new Set(['completed', 'error', 'cancelled', 'running']);
export const META_STATUS_ENUM = new Set(['completed', 'failed', 'running']);
export const UNCLASSIFIED = { attempt_kind: 'unknown', trigger_stage: 'unknown', classifier_version: 'unclassified-v0' };
export const COLLECTOR_VERSION = 'harness-stats-0.2.0';

/** 角色规范化（§2.3/§2.1）：去 zcode- 前缀；-rerun 拆变体；机制六角色白名单外——已知内建归 other（known），
 *  版本化白名单外值归 other（unknown，计 §5.3 分维占比）。 */
export function normalizeAgent(raw) {
  const v = String(raw ?? '').replace(/^zcode-/, '');
  if (v.endsWith('-rerun')) {
    const base = v.slice(0, -'-rerun'.length);
    if (MECH_ROLES.has(base)) return { role: base, variant: 'rerun', known: true };
  }
  if (MECH_ROLES.has(v)) return { role: v, variant: '', known: true };
  if (KNOWN_OTHER_AGENTS.has(v) || KNOWN_OTHER_AGENTS.has(v.toLowerCase())) return { role: 'other', variant: '', known: true };
  return { role: 'other', variant: '', known: false };
}
export function normalizeModel(raw) {
  const v = String(raw ?? '').trim();
  return { model: v.toLowerCase(), known: v.length > 0 };
}

/** ④ 会话路径过滤：.venv 排除 + 项目注册表白名单（多基面；path 缺失→保留，无法判定不武断排除）。 */
export function projectPathAllowed(sessionRow, bases) {
  const p = sessionRow?.path;
  if (typeof p !== 'string' || p.trim() === '') return true;
  const n = p.replaceAll('\\', '/').toLowerCase();
  const venv = n.includes('/.venv/') || n.endsWith('/.venv') || n.endsWith('/.venv/');
  if (venv) return false;
  return bases.some(b => n === b || n.startsWith(b + '/') || n.startsWith(b + '-worktrees'));
}

/** 归因：DIRECT=cwd 命中 <proj>-worktrees/feat-<slug>（多基面）；CANDIDATE=项目吻合无 slug（永不入票级）。 */
export function attributeDispatch(cwd, bases) {
  const n = String(cwd ?? '').replaceAll('\\', '/').toLowerCase();
  const m = /feat-([a-z0-9][a-z0-9-]*)\/?$/.exec(n);
  if (m && bases.some(b => n.startsWith(b + '-worktrees'))) {
    return { attribution: 'DIRECT', ticket_slug: m[1] };
  }
  return { attribution: 'CANDIDATE', ticket_slug: null };
}

/** sqlite status → 规范态（state-mapping §2.1）。 */
export function mapUsageState(status) {
  switch (status) {
    case 'completed': return 'terminal_completed';
    case 'error': return 'terminal_failed';
    case 'cancelled': return 'terminal_cancelled';
    case 'running': return 'observed_running';
    default: return 'unknown';
  }
}

/** 每会话「最后终态 usage 行」映射（M-note 重判依据）：session_id → {status, completed_at(ISO), id}。
 *  P2-10：单一实现源（collect/verify 共用）；同 completed_at 以 (completed_at, id) 复合序 tie-break
 *  （旧行为=保留先遇行——同时间冲突不确定，现确定性取 id 字典序大者）。 */
export function buildSessionTerminalMap(usageRows) {
  const m = new Map();
  for (const r of usageRows) {
    const s = String(r.status ?? '');
    if (s !== 'completed' && s !== 'error' && s !== 'cancelled') continue;
    const done = toIsoUtc(r.completed_at);
    if (done == null) continue;
    const prev = m.get(r.session_id);
    const id = String(r.id ?? '');
    if (!prev || done > prev.completed_at
      || (done === prev.completed_at && id > String(prev.id ?? ''))) {
      m.set(r.session_id, { status: s, completed_at: done, id });
    }
  }
  return m;
}

/**
 * state-mapping.md M1-M9（72h 宽限、stale_orphan/missing_child 二分，gap-2 冻结判据）。
 * M-note 重判（裁决②=双侧同判）：running + childInSource 且 child 已有终态 usage 行 → 以源终态为准重判
 * （M1/M3 同款判据；completed_at 取 child 最后终态行 completed_at）；rejudged=true 供双面一致性差异计数。
 * 返回 {state, rejudged, completed_at?}——completed_at 仅重判分支携带（非重判分支由调用方按 metadata completedAt 取）。
 */
export function mapMetadataState(meta, { childInSource, childHasToken, nowMs, childTerminal = null }) {
  const status = String(meta.status ?? '');
  if (status === 'completed' || status === 'failed') {
    if (!childInSource) return { state: 'missing_child', rejudged: false };
    return { state: status === 'completed' ? 'terminal_completed' : 'terminal_failed', rejudged: false };
  }
  if (status === 'running') {
    if (childInSource && childTerminal) {
      return { state: mapUsageState(childTerminal.status), rejudged: true, completed_at: childTerminal.completed_at };
    }
    if (childInSource) return { state: 'observed_running', rejudged: false };
    const ageMs = nowMs - Date.parse(meta.createdAt);
    if (Number.isFinite(ageMs) && ageMs <= 72 * 3600_000) return { state: 'observed_running', rejudged: false };
    return { state: childHasToken ? 'unknown' : 'stale_orphan', rejudged: false };
  }
  return { state: 'unknown', rejudged: false };
}

const routeAnchor = () => ({
  effective_model: 'unknown', route_hash: 'unknown', repo_models_config_hash: 'unknown',
  local_override_hash: 'unknown', generated_role_card_hash: 'unknown',
  host_version: 'unknown', collector_version: COLLECTOR_VERSION,
});

/** 卡锚键（P2-3）：role 含 variant——与 cmd-bundle freezeRouteAnchors 卡键同形（键粒度单源语义）。 */
const cardKeyOf = (role, variant) => (variant ? `${role}-${variant}` : role);

/** effective_model 载荷守卫投影（effective-model r2；P2-2/P2-3 门裁定）：两级缺席同判 'unknown'
 *  （冻结面缺席=历史 bundle 存量不误升；字段缺席=载荷不在场）；守卫形沿 P3-2 先例
 *  （typeof==='string' ∧ trim 非空 → normalizeModel 值）——空串/空白/非串不产生非 unknown 真值
 *  （有效域=非空规范化串 ∪ {'unknown'}——防 verify 反转假通过）。 */
function effectiveModelFor(freeze, meta) {
  if (!freeze) return 'unknown';   // 两级缺席之一：冻结面缺席（历史 bundle）
  const modelId = meta?.profileSnapshot?.modelSelection?.modelId;
  return (typeof modelId === 'string' && modelId.trim() !== '') ? normalizeModel(modelId).model : 'unknown';
}

/** route_anchor 投影（route-anchor-collection r2）：七字段自 bundle 冻结面（manifest.route_anchor_freeze）填充——
 *  五真源（repo/local/卡映射/route_hash/host_version）+collector_version 既有。冻结面缺席（历史 bundle）→ 既有 unknown 桩面
 *  （存量兼容④：九月窗 dispatch 桩值不误升——翻转点由 report 侧双侧 verified 判据消解）。
 *  锚载体=投影直填不入 bundle_id（P2-4）；卡映射键缺席='absent'（P2-2：确定不在场）。
 *  effective_model 真值化（effective-model-materialization r2）：dispatch 级取该 dispatch 自身
 *  metadata.profileSnapshot.modelSelection.modelId（冻结面=bundle metadata 载荷直读，与 host_version 探针同形
 *  ——非 manifest 冻结面新顶层；不走卡级映射——卡级=role 桌面态 vs dispatch 级=该次派发声明；
 *  P2-1 语义=profile 派发时点声明模型，运行时 fallback/override 不可观——守卫见 effectiveModelFor）。 */
function routeAnchorFor(freeze, role, variant, meta = null) {
  if (!freeze) return routeAnchor();
  return {
    effective_model: effectiveModelFor(freeze, meta),
    route_hash: freeze.route_hash,
    repo_models_config_hash: freeze.repo_models_config_hash,   // P1-4：承载文件内容 hash（anchor-hash-field-rename 后事件面与冻结面同名直填）
    local_override_hash: freeze.local_override_hash,
    generated_role_card_hash: freeze.role_card_hashes?.[cardKeyOf(role, variant)] ?? 'absent',
    host_version: freeze.host_version,
    collector_version: COLLECTOR_VERSION,
  };
}

/**
 * bundle 全量投影（rev=1 形态；revision/upsert 由 collect 侧叠加）。
 * 项目归属基面=projects.json 注册表别名（bundle 创建时登记；project_id 仅身份键，非路径前缀）。
 * onDbChunk（P0-2）：bundle sqlite 副本分块复制间回调——collect 传入锁心跳刷新（长复制全程心跳）。
 * @returns {{events, dim, fingerprint, manifest, emitUsage, metas}} dim=三维独立 unknown 探针分子分母
 */
export function projectBundleEvents({ storeRoot, bundleId, sid, nowIso, nowMs, onDbChunk = null }) {
  const bundleDir = join(storeRoot, 'snapshots', bundleId);
  const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
  const projNorm = String(manifest.project_id);
  // 注册表别名 → 归属基面（无注册记录时回退 project_id 本身——恰不中任何路径，宽限不武断）
  let bases = [projNorm];
  const projectsJson = join(storeRoot, 'projects.json');
  if (existsSync(projectsJson)) {
    try {
      const reg = JSON.parse(readFileSync(projectsJson, 'utf8'));
      const p = (reg.projects ?? []).find(x => x.project_id === projNorm);
      if (p && Array.isArray(p.aliases) && p.aliases.length > 0) bases = p.aliases.map(a => String(a).replaceAll('\\', '/').toLowerCase().replace(/\/+$/, ''));
    } catch { /* 注册表损坏 → 回退基面 */ }
  }
  // P0-1 零写入语义：bundle sqlite 一律经 TEMP 封闭副本消费（ro 直开 WAL 库会在 bundle 目录新建
  // -shm/-wal 边车——2026-10-08 复审实锤；本函数为 collect/rebuild 的 bundle 读取单源）。
  const bundleDb = join(bundleDir, 'db.sqlite');
  let fingerprint, sessions, usageRows, observedMaxId;
  withReadonlyDbCopy(bundleDb, () => makeOwnedTempDir(storeRoot, 'dbcopy'), (dbCopy) => {
    const ro = openReadOnly(dbCopy);
    try { fingerprint = schemaFingerprint(ro); }
    finally { ro.close(); }
    const ro2 = openReadOnly(dbCopy);
    try {
      sessions = selectSessions(ro2);
      usageRows = selectModelUsageWindow(ro2, { fromMs: Date.parse(manifest.time_range.from), untilMs: Date.parse(manifest.time_range.until) });
    } finally { ro2.close(); }
    // ⑨ audit 侧车观测面：副本 MAX(model_usage.id)（字符串主键，字典序最大=确定性观测；回退检测输入）
    const roMax = openReadOnly(dbCopy);
    try { observedMaxId = String(roMax.prepare('SELECT MAX(id) AS m FROM model_usage').get().m ?? ''); }
    finally { roMax.close(); }
  }, { onChunk: onDbChunk });

  const sessionById = new Map(sessions.map(s => [s.id, s]));
  const usageBySession = new Map();
  for (const r of usageRows) {
    if (!usageBySession.has(r.session_id)) usageBySession.set(r.session_id, []);
    usageBySession.get(r.session_id).push(r);
  }
  const sessionTerminal = buildSessionTerminalMap(usageRows);   // M-note 重判依据（窗口内最后终态 usage 行）
  const metas = manifest.metadata_corpus.eligible_files
    .map(f => ({ rel: f.relative_path, meta: JSON.parse(readFileSync(join(bundleDir, 'metadata', f.relative_path), 'utf8')) }));
  const metaByChild = new Map();
  for (const m of metas) if (m.meta.childSessionId) metaByChild.set(m.meta.childSessionId, m);

  const emitUsage = usageRows.filter(r => projectPathAllowed(sessionById.get(r.session_id), bases));
  const dim = { model: { unknown: 0, total: 0 }, status: { unknown: 0, total: 0 }, role: { unknown: 0, total: 0 } };
  for (const r of emitUsage) {
    dim.model.total++; if (!normalizeModel(r.model_id).known) dim.model.unknown++;
    dim.status.total++; if (!SOURCE_STATUS_ENUM.has(String(r.status))) dim.status.unknown++;
    dim.role.total++; if (!normalizeAgent(r.agent).known) dim.role.unknown++;
  }
  for (const m of metas) {
    dim.role.total++; if (!normalizeAgent(m.meta.profileId).known) dim.role.unknown++;
    dim.status.total++; if (!META_STATUS_ENUM.has(String(m.meta.status))) dim.status.unknown++;
  }

  const events = [];
  const inconsistencies = [];   // M-note：metadata×session 双面不一致（重判）留痕（§5.2 双面校验注记面，不入七类冻结差异）
  for (const m of metas) {
    const meta = m.meta;
    const childInSource = meta.childSessionId ? sessionById.has(meta.childSessionId) : false;
    const childHasToken = meta.childSessionId ? usageBySession.has(meta.childSessionId) : false;
    const childTerminal = (childInSource && meta.childSessionId) ? sessionTerminal.get(meta.childSessionId) ?? null : null;
    const verdict = mapMetadataState(meta, { childInSource, childHasToken, nowMs, childTerminal });
    const state = verdict.state;
    if (verdict.rejudged) inconsistencies.push({ entity: m.rel, declared: 'running', source_terminal: childTerminal.status });
    const { role, variant } = normalizeAgent(meta.profileId);
    const { attribution, ticket_slug } = attributeDispatch(meta.cwd, bases);
    const createdAt = toIsoUtc(Date.parse(meta.createdAt));
    // 终态 completed_at：重判分支取 child 最后终态行；声明终态分支取 metadata completedAt；
    // 非终态（observed_running/stale_orphan/unknown）恒 null（VR-F06）。
    const completedAt = verdict.rejudged ? verdict.completed_at
      : (state === 'observed_running' || state === 'stale_orphan' || state === 'unknown') ? null
        : toIsoUtc(Date.parse(meta.completedAt));
    events.push({
      schema_version: 'v1', event_kind: 'dispatch', event_id: '', entity_id: `${sid}:${ZCODE_ADAPTER_ID}:${m.rel}`,
      source_instance_id: sid, adapter_id: ZCODE_ADAPTER_ID, adapter_type: ZCODE_ADAPTER_TYPE,
      source_primary_key: m.rel, collected_at: nowIso, source_revision: 1,
      role, variant, project_id: projNorm, ticket_slug, attribution, state,
      // VR-F31（attribution-explicit-closure r2）：child 会话标识直取——report 侧 EXPLICIT join 键；
      // mutable-row contentKey schema 驱动（追加自动翻转内容键→存量实体首次 collect revision+1，其后幂等）；
      // 红队修复轮 P3-2：守卫对齐 cmd-bundle 形（typeof==='string' && truthy——空串两 collector 同形 null）
      child_session_id: (typeof meta.childSessionId === 'string' && meta.childSessionId) ? meta.childSessionId : null,
      created_at: createdAt, completed_at: completedAt,
      wall_clock_ms: completedAt != null ? Date.parse(completedAt) - Date.parse(createdAt) : null,
      attempt_kind: UNCLASSIFIED.attempt_kind, trigger_stage: UNCLASSIFIED.trigger_stage,
      secondary_cause: '', classifier_version: UNCLASSIFIED.classifier_version,
      route_anchor: routeAnchorFor(manifest.route_anchor_freeze ?? null, role, variant, meta),
    });
  }
  for (const r of emitUsage) {
    const state = mapUsageState(String(r.status));
    const parent = metaByChild.get(r.session_id);
    const nm = normalizeModel(r.model_id);
    events.push({
      schema_version: 'v1', event_kind: 'model-request', event_id: '', entity_id: `${sid}:${ZCODE_ADAPTER_ID}:model_usage/${r.id}`,
      source_instance_id: sid, adapter_id: ZCODE_ADAPTER_ID, adapter_type: ZCODE_ADAPTER_TYPE,
      source_primary_key: `model_usage/${r.id}`, collected_at: nowIso, source_revision: 1,
      parent_entity_id: parent ? `${sid}:${ZCODE_ADAPTER_ID}:${parent.rel}` : null,
      model: nm.model, model_original: String(r.model_id), status: String(r.status), state,
      started_at: toIsoUtc(r.started_at),
      duration_ms: (state === 'terminal_completed' || state === 'terminal_failed') ? (r.duration_ms ?? null) : null,
      time_to_first_token_ms: r.time_to_first_token_ms ?? null,
      retry_count: r.retry_count ?? 0,
      usage: {
        input: r.input_tokens ?? null, output: r.output_tokens ?? null, reasoning: r.reasoning_tokens ?? null,
        cache_read: r.cache_read_input_tokens ?? null, cache_write: r.cache_creation_input_tokens ?? null,
      },
    });
  }
  return {
    events, dim, fingerprint, manifest, emitUsage: emitUsage.length, metas: metas.length,
    inconsistencies, observed_max_id: observedMaxId,
  };
}
