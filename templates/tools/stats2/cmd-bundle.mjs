// stats2/cmd-bundle.mjs — `bundle create-zcode-pilot`：冻结 pilot bundle 制作（§5.8；唯一真实源接触位）
// 流程（P1-9 时序复位 2026-10-08：全部源侧证据+红线判定在 staging 内完成、全绿才 rename 落位）：
//   版本守卫(cli 层) → TEMP 清扫 → 布局+ACL → config/projects →
//   源侧零写入证据·前（db 文件+db 目录/agents 树 rel→{sha,size,mtime} 快照）→
//   【P0-1 三审重构 2026-10-09：源快照纯文件复制协议——永不打开活源 SQLite】
//   复制前源摘要快照 → 磁盘空间预检 → 分块复制 db+(-wal) 到受管 TEMP staging →
//   复制后重算源摘要（任一变化→丢弃副本+有界重试≥3，仍不稳 fail-loud"源不稳定"）→
//   TEMP 副本内：checkpoint 自包含 → quick_check 完整性 → 行数观测 →
//   metadata eligible 谓词扫描 + eligible 物理拷贝（TEMP 中转）→ tickets/reviews 窗口内冻结+canonical SHA →
//   git HEAD → role_status_counts → manifest（经同一 contract-validator 校验，写入 staging）→
//   源侧零写入证据·后（staging 内判定：db 目录全树 rel→{sha,size,mtime} 字节恒等——P0-1 无白名单无归因通道）→
//   staging 自包含核验（无 wal/shm 残留）→ evidence 写入 staging → 物理精确集断言（staging）→
//   原子 rename 入 snapshots/ → 落位后二道复核 → TEMP try/finally 删。
//   reused（同 id 已存在）：真全目录核验（全树精确集+逐文件字节 / manifest 过同一 validator 且
//   除 created_at 外 canonical 相等 / evidence 结构合法 / 根目录额外文件=红）后复用——不写任何文件。
//   data_version 归因机制已随直开路径**退役**（活源不再经 SQLite 打开，无观测面；零写入判定=全树字节恒等，
//   无放行通道——2026-10-09 三审裁决，见 judgeZeroWrite）。
// bundle_id=内容寻址（pilot-<project>-<yyyymm>-<sha8 内容摘要>）：同内容幂等复用，内容变更新 id。
import { existsSync, readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ensureStoreLayout, sweepTempDirs, ensureConfig, registerProject, makeOwnedTempDir } from './store.mjs';
import { sha256Hex, sha256File, writeJson, rfc3339, canon, fsyncDir } from './util.mjs';
import { snapshotCopySource, observedModelUsageCount, quickCheckOk } from './zcode-source.mjs';
import { validateFixture } from './contract-validator.mjs';
import { EXIT } from './cli.mjs';

// §5.8 冻结边界常量（与 pilot-bundle-schema.json VR-S25/VR-S26 同源）
const PILOT = {
  from: '2026-09-01T00:00:00Z',
  until: '2026-10-01T00:00:00Z',
  sqliteTimeField: 'model_usage.started_at',
  metadataTimeField: 'createdAt',
  bounds: '半开 [2026-09-01T00:00:00Z, 2026-10-01T00:00:00Z)',
  metadataPredicate: 'project 判定（cwd/workspaceRoot 归属 AITrader2，规范化 project_id 匹配）AND createdAt ∈ [2026-09-01T00:00Z, 2026-10-01T00:00Z)',
  sqlitePredicate: 'model_usage.started_at ∈ [2026-09-01T00:00Z, 2026-10-01T00:00Z)',
  metadataInterval: '[2026-09-01T00:00Z, 2026-10-01T00:00Z)',
};
const FROM_MS = Date.parse(PILOT.from), UNTIL_MS = Date.parse(PILOT.until);

/** project 归属判定（冻结）：规范化 cwd = 项目根 ∨ 根/… 前缀 ∨ 根-worktrees… 前缀。 */
export function projectBelongs(normCwd, projNorm) {
  return normCwd === projNorm
    || normCwd.startsWith(projNorm + '/')
    || normCwd.startsWith(projNorm + '-worktrees')
    || normCwd.startsWith(projNorm + '\\');
}
const normPath = p => String(p).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** agents 树摘要（逐文件 rel→{sha,size_bytes,mtime_ms}——零写入证据面；P0-1 三审：含 size 全量原子）。 */
function treeDigest(rootDir) {
  const entries = {};
  if (!existsSync(rootDir)) return { entries, digest: sha256Hex(canon({})) };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else entries[relative(rootDir, p).replaceAll('\\', '/')] = {
        sha: sha256File(p), size: statSync(p).size, mtime: Math.trunc(statSync(p).mtimeMs),
      };
    }
  };
  walk(rootDir);
  return { entries, digest: sha256Hex(canon(entries)) };
}

/**
 * db 目录零写入判定（P0-1 三审重构 2026-10-09；纯函数供单测）：
 * - **全树 rel→{sha,size,mtime} 字节恒等**（替换旧文件名集合比较——既有边车 hash/mtime 变化漏检面）；
 * - added/removed = 前后文件集差；changed = 同名文件任一原子（sha/size/mtime）变化；
 * - 任一差异即红：本工具对源零 SQLite 打开（纯文件复制协议），目录树任何变化都非本工具所为，
 *   亦无归因放行通道（data_version 机制随直开路径退役）。
 */
export function judgeDbDirEvidence(beforeTree, afterTree) {
  const b = beforeTree.entries ?? {};
  const a = afterTree.entries ?? {};
  const beforeKeys = new Set(Object.keys(b));
  const afterKeys = new Set(Object.keys(a));
  const added = [...afterKeys].filter(k => !beforeKeys.has(k));
  const removed = [...beforeKeys].filter(k => !afterKeys.has(k));
  const changed = [...beforeKeys].filter(k => afterKeys.has(k) && canon(b[k]) !== canon(a[k]));
  const equal = added.length === 0 && removed.length === 0 && changed.length === 0;
  return { added, removed, changed, equal, ok: equal };
}

function toRfc3339Z(s) {
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** metadata eligible 谓词执行（§5.8 原文语义）：返回扫描结果与排除聚合。 */
export function scanMetadataCorpus(agentsRoot, projNorm) {
  const eligible = [], excluded = [];
  const bump = (reason) => { const e = excluded.find(x => x.reason === reason); if (e) e.count++; else excluded.push({ reason, count: 1 }); };
  let total = 0;
  if (existsSync(agentsRoot)) {
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (e.name !== 'metadata.json') continue;
        total++;
        let meta;
        try { meta = JSON.parse(readFileSync(p, 'utf8')); } catch { bump('解析失败（非法 JSON）'); continue; }
        const cwd = meta.cwd ?? meta.workspaceRoot;
        const created = toRfc3339Z(String(meta.createdAt ?? ''));
        if (typeof cwd !== 'string' || !projectBelongs(normPath(cwd), projNorm)) { bump('project 判定不中（cwd/workspaceRoot 非本项目）'); continue; }
        if (created === null) { bump('解析失败（createdAt 不可解析）'); continue; }
        const cMs = Date.parse(created);
        if (!(cMs >= FROM_MS && cMs < UNTIL_MS)) { bump('createdAt 区间外'); continue; }
        eligible.push({
          relative_path: relative(agentsRoot, p).replaceAll('\\', '/'),
          sha256: sha256File(p),
          size_bytes: statSync(p).size,
          created_at: created,
          child_session_id: (typeof meta.childSessionId === 'string' && meta.childSessionId) ? meta.childSessionId : null,
          _role: normalizeRole(meta.profileId),
          _status: String(meta.status ?? ''),
        });
      }
    };
    walk(agentsRoot);
  }
  eligible.sort((a, b) => a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0);
  return { total_scanned: total, eligible, excluded };
}

/** 规范化 role：去 zcode- 前缀（§2.3）；-rerun 变体归位由 collect 承担（此处聚合原角色面）。 */
export function normalizeRole(profileId) {
  return String(profileId ?? '').replace(/^zcode-/, '');
}

/** role_status_counts：键=规范化 `role|status` 字典序、值=count≥1（VR-F12 契约面）。 */
export function aggregateRoleStatus(eligible) {
  const m = new Map();
  for (const f of eligible) {
    const k = `${f._role}|${f._status}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1));
}

/** tickets/reviews 窗口内冻结：slug 清单（票面内容含窗口内日期）+ canonical 聚合 SHA（输入与顺序冻结）。 */
export function freezeTicketsReviews(projectDir) {
  const ticketsDir = join(projectDir, 'docs', 'tickets');
  const reviewsDir = join(projectDir, 'docs', 'reviews');
  if (!existsSync(ticketsDir)) throw new Error(`项目仓缺 docs/tickets：${ticketsDir}`);
  const inWindow = (body) => {
    for (const m of body.matchAll(/2026-(\d{2})-(\d{2})/g)) {
      const t = Date.parse(`${m[0]}T00:00:00Z`);
      if (t >= FROM_MS && t < UNTIL_MS) return true;
    }
    return false;
  };
  const slugs = [];
  for (const f of readdirSync(ticketsDir).filter(x => x.endsWith('.md')).sort()) {
    if (inWindow(readFileSync(join(ticketsDir, f), 'utf8'))) slugs.push(f.replace(/\.md$/, ''));
  }
  const reviewFiles = existsSync(reviewsDir)
    ? readdirSync(reviewsDir).filter(f => slugs.some(s => f.startsWith(s + '-') || f.startsWith(s + '.'))).sort()
    : [];
  // canonical 输入（顺序冻结）：[["ticket",slug,sha]…按 slug 序] ++ [["review",name,sha]…按 name 序]
  const canonical = [
    ...slugs.map(s => ['ticket', s, sha256File(join(ticketsDir, s + '.md'))]),
    ...reviewFiles.map(f => ['review', f, sha256File(join(reviewsDir, f))]),
  ];
  return { slugs, reviewFiles, ticketsDir, reviewsDir, sha256: sha256Hex(canon(canonical)) };
}

function gitHead(projectDir) {
  const r = spawnSync('git', ['-C', projectDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git HEAD 取得失败（${projectDir} 非 git 仓或 git 不可用）：${String(r.stderr).slice(0, 120)}`);
  return String(r.stdout).trim();
}

/** 副本自包含化：checkpoint(TRUNCATE) 将 WAL 并回主文件，随后删 -wal/-shm 边车（副本=本工具私有文件）。 */
function checkpointSelfcontained(copyPath) {
  const c = new DatabaseSync(copyPath);   // rw 打开（受管 TEMP 副本）以执行 checkpoint
  try { c.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } finally { c.close(); }
  for (const suffix of ['-wal', '-shm']) {
    const p = copyPath + suffix;
    if (existsSync(p)) rmSync(p, { force: true });
  }
}

export async function cmdBundle(opts) {
  const { storeRoot, zcodeHome, projectDir, injectedInstanceId, clock, flags } = opts;
  const sub = opts.rest[1];
  if (sub !== 'create-zcode-pilot') { console.error('用法：bundle create-zcode-pilot [--project-name <名>]（全局参数见 help）'); return EXIT.USAGE; }
  if (!projectDir) { console.error('bundle create-zcode-pilot 需要 --project-dir（消费项目仓根）'); return EXIT.USAGE; }
  if (clock) console.log(`[AUDIT] --clock=${clock}（bundle 模式；created_at/observed_at 冻结于该时钟——P2-1 使用必记）`);
  const nowIso = clock ?? rfc3339();

  // 仓布局+ACL（任何持久化写入前）→ TEMP 清扫 → 身份
  const checks = ensureStoreLayout(storeRoot);
  const failed = checks.find(c => !c.ok);
  if (failed) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }
  for (const line of sweepTempDirs(storeRoot)) console.log(`[TEMP] ${line}`);
  ensureConfig(storeRoot, { injectedId: injectedInstanceId, nowIso });
  const projectName = String(flags['project-name'] ?? basename(projectDir));
  const projNorm = normPath(projectDir);
  registerProject(storeRoot, projectName, projectDir, { nowIso });
  const projectId = projectName.toLowerCase();

  // ── 源路径与零写入证据·前 ────────────────────────────────────────
  const dbPath = join(zcodeHome, 'cli', 'db', 'db.sqlite');
  const agentsRoot = join(zcodeHome, 'cli', 'agents');
  if (!existsSync(dbPath)) { console.error(`SOURCE_UNAVAILABLE：活库不存在 ${dbPath}`); return EXIT.FAIL; }
  const before = {
    db_dir: treeDigest(dirname(dbPath)),   // db 目录全树快照（P0-1 三审：{sha,size,mtime} 全原子字节恒等）
    agents_dir: treeDigest(agentsRoot),
  };

  const tempDir = makeOwnedTempDir(storeRoot, 'bundle');
  let exitCode = EXIT.OK;
  let result = null;
  let buildError = null;
  try {
    result = await buildBundle({ storeRoot, tempDir, dbPath, agentsRoot, projectDir, projectId, projNorm, nowIso, before });
  } catch (e) {
    buildError = e;
  } finally {
    // TEMP 私有中转 try/finally 删；删除失败 → exit≠0（§5.4-7；P1-6 对齐：TEMP 删除失败必传播）
    try { rmSync(tempDir, { recursive: true, force: true }); }
    catch (e) { console.error(`TEMP-DELETE-FAIL：${tempDir}：${e.message}（exit≠0；下次启动扫描清理）`); exitCode = exitCode === EXIT.OK ? EXIT.FAIL : exitCode; }
  }
  if (buildError) {
    console.error(`[BUNDLE-FAIL] ${buildError.message}`);
    return buildError.code === 'UNSUPPORTED_SOURCE' ? EXIT.UNSUPPORTED_SOURCE : EXIT.FAIL;
  }
  if (!result.ok) return EXIT.FAIL;   // 零写入红线（证据与违反详情已打印；未落位=TEMP 随删）

  // 源侧证据判定（P1-9：判定已在 staging 内完成、全绿才 rename；此处仅报告面）
  const { verdicts } = result;
  console.log(JSON.stringify({
    command: 'bundle create-zcode-pilot',
    bundle_id: result.bundleId,
    reused: result.reused,
    snapshot_dir: join('snapshots', result.bundleId),
    eligible_count: result.eligibleCount,
    total_scanned: result.totalScanned,
    role_status_counts: result.roleStatusCounts,
    sqlite_row_count: result.rowCount,
    source_copy_attempts: result.copyAttempts,
    zero_write: { db_dir: verdicts.dbDirEqual, agents_dir: verdicts.agentsEqual },
    evidence_artifact: result.reused ? 'preserved（reused 运行不覆写既有 evidence/manifest——P1-9）' : 'written',
  }, null, 2));
  return exitCode === EXIT.OK ? EXIT.OK : exitCode;
}

/** 组装零写入证据并判定（P0-1 三审：db 目录全树 {sha,size,mtime} 字节恒等；data_version 归因机制退役）。 */
function judgeZeroWrite(before, after, copyProtocol) {
  const agentsEqual = before.agents_dir.digest === after.agents_dir.digest;
  const dbDirVerdict = judgeDbDirEvidence(before.db_dir, after.db_dir);
  const evidence = {
    recorded_at: rfc3339(),
    policy: '源侧零 SQLite 打开（P0-1 三审纯文件复制协议：snapshotCopySource 分块复制 db+(-wal) 至受管 TEMP，复制前后源摘要恒等有界重试）；零写入判定=db 目录与 agents 目录全树 rel→{sha256,size,mtime} 前后字节恒等（任何新增/消失/同名文件原子变化一律红——无白名单无归因通道；data_version 机制随直开路径退役 2026-10-09）',
    source_access: { protocol: 'pure-file-copy', sqlite_opens_on_source: 0, ...copyProtocol },
    db_dir: {
      file_count_before: Object.keys(before.db_dir.entries).length,
      file_count_after: Object.keys(after.db_dir.entries).length,
      digest_before: before.db_dir.digest, digest_after: after.db_dir.digest,
      files_added: dbDirVerdict.added, files_removed: dbDirVerdict.removed, files_changed: dbDirVerdict.changed,
      equal: dbDirVerdict.equal,
    },
    agents_dir: { file_count: Object.keys(before.agents_dir.entries).length, digest_before: before.agents_dir.digest, digest_after: after.agents_dir.digest, equal: agentsEqual },
  };
  const problems = [];
  if (!agentsEqual) problems.push('ZERO-WRITE-VIOLATION：agents/ 树在制作窗口内变化（digest 不等）——红线索报');
  if (!dbDirVerdict.ok) {
    const detail = [
      dbDirVerdict.added.length ? `added=[${dbDirVerdict.added.join(',')}]` : '',
      dbDirVerdict.removed.length ? `removed=[${dbDirVerdict.removed.join(',')}]` : '',
      dbDirVerdict.changed.length ? `changed=[${dbDirVerdict.changed.join(',')}]` : '',
    ].filter(Boolean).join('；');
    problems.push(`ZERO-WRITE-VIOLATION：db 目录全树字节恒等不成立（${detail || 'digest 不等'}）——任何新增/消失/同名文件 sha/size/mtime 变化一律红（P0-1 三审：无白名单无归因通道）`);
  }
  return { evidence, problems, verdicts: { agentsEqual, dbDirEqual: dbDirVerdict.equal } };
}

async function buildBundle({ storeRoot, tempDir, dbPath, agentsRoot, projectDir, projectId, projNorm, nowIso, before }) {
  // 1)【P0-1 三审】源快照纯文件复制协议——永不打开活源 SQLite：
  //    复制前快照→磁盘预检→分块复制→复制后重算（变化→丢弃重试≥3→仍不稳 fail-loud"源不稳定"）
  const staging = join(tempDir, 'bundle');
  mkdirSync(staging, { recursive: true });
  const copy = snapshotCopySource(dbPath, staging);
  const copyPath = copy.copyPath;
  // 2) 受管 TEMP 副本内：quick_check 完整性 → 行数观测 → checkpoint 自包含（末位执行——
  //    WAL 形态副本的任何 SQLite 打开（含 ro）都会在 staging 产边车，故全部读操作先于自包含化；
  //    checkpoint 后至 rename 前不再打开副本 → 终产物零边车）
  const roCopy = new DatabaseSync(copyPath, { readOnly: true });
  let rowCount;
  try {
    if (!quickCheckOk(roCopy)) throw new Error('COPY_INTEGRITY_FAIL：TEMP 副本 PRAGMA quick_check 未返回 ok（复制完整性红线）');
    rowCount = observedModelUsageCount(roCopy);
  } finally { roCopy.close(); }
  checkpointSelfcontained(copyPath);
  const copySha = sha256File(copyPath);
  const fin = await finishBundle({ staging, copySha, rowCount, agentsRoot, projectDir, projectId, projNorm, nowIso, storeRoot });
  // ── P1-9：源侧证据+红线判定全部在 staging 内完成（此刻源接触已尽）→ 全绿才 rename ──
  const after = {
    db_dir: treeDigest(dirname(dbPath)),
    agents_dir: treeDigest(agentsRoot),
  };
  const copyProtocol = {
    attempts: copy.attempts,
    source_snapshot_at_stable_copy: copy.sourceSnapshot,
    dest: '受管 TEMP staging（副本）',
  };
  const { evidence, problems, verdicts } = judgeZeroWrite(before, after, copyProtocol);
  if (problems.length) { for (const p of problems) console.error(p); return { ok: false, ...fin, copyAttempts: copy.attempts }; }
  if (fin.reused) {
    // P1-9：reused 运行零覆写——不写 evidence/manifest/任何文件；判定结果仅报告（原工件保全）
    return { ok: true, reused: true, evidence, verdicts, bundleId: fin.bundleId, eligibleCount: fin.eligibleCount, totalScanned: fin.totalScanned, roleStatusCounts: fin.roleStatusCounts, rowCount: fin.rowCount, copyAttempts: copy.attempts };
  }
  // 终产物自包含核验（P0-1 配套）：checkpoint 后 staging 内不得存在 wal/shm/journal 残留
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(join(fin.staging, `db.sqlite${suffix}`))) {
      throw new Error(`SELFCONTAINED_FAIL：staging 副本存在边车残留 db.sqlite${suffix}（checkpoint 后核验）`);
    }
  }
  writeJson(join(fin.staging, 'source-zero-write-evidence.json'), evidence);
  // 物理精确集（rename 前，对 staging 判定——红则整中转废弃、snapshots/ 零新增）
  assertPhysicalExactSet(fin.staging, fin.manifest);
  fsyncDir(fin.staging);
  renameSync(fin.staging, fin.finalDir);
  fsyncDir(join(storeRoot, 'snapshots'));
  assertPhysicalExactSet(fin.finalDir, fin.manifest);   // 落位后二道复核（rename 传输完整性）
  return { ok: true, reused: false, evidence, verdicts, bundleId: fin.bundleId, eligibleCount: fin.eligibleCount, totalScanned: fin.totalScanned, roleStatusCounts: fin.roleStatusCounts, rowCount: fin.rowCount, copyAttempts: copy.attempts };
}

/** 物理精确集断言（P0-7）：metadata/ 相对路径集合恰等于 eligible_files；逐文件 hash/size 恒等。 */
function assertPhysicalExactSet(dir, manifest) {
  const physSet = new Set(listFilesDeep(join(dir, 'metadata')));
  const wantSet = new Set(manifest.metadata_corpus.eligible_files.map(f => f.relative_path));
  if (physSet.size !== wantSet.size || [...wantSet].some(p => !physSet.has(p))) {
    const extra = [...physSet].filter(p => !wantSet.has(p));
    throw new Error(`物理精确集违例：metadata=${physSet.size} 件 ≠ eligible=${wantSet.size} 件${extra.length ? `（多余：${extra.join(',')}）` : ''}`);
  }
  for (const f of manifest.metadata_corpus.eligible_files) {
    const p = join(dir, 'metadata', f.relative_path);
    if (sha256File(p) !== f.sha256 || statSync(p).size !== f.size_bytes) throw new Error(`物理精确集 hash/size 失配：${f.relative_path}`);
  }
}

/** evidence 结构合法性（P1-4 reused 核验面）：可解析 JSON 对象 + 必备区段（db_dir/agents_dir/policy）。
 *  返回 problems 数组（空=合法）。 */
export function checkEvidenceStructure(evd) {
  const problems = [];
  if (!evd || typeof evd !== 'object' || Array.isArray(evd)) return ['evidence 非对象'];
  if (typeof evd.recorded_at !== 'string' || evd.recorded_at.length === 0) problems.push('evidence 缺 recorded_at');
  if (typeof evd.policy !== 'string' || evd.policy.length === 0) problems.push('evidence 缺 policy');
  for (const sec of ['db_dir', 'agents_dir']) {
    if (!evd[sec] || typeof evd[sec] !== 'object' || Array.isArray(evd[sec])) problems.push(`evidence 缺 ${sec} 区段`);
    else if (!('equal' in evd[sec])) problems.push(`evidence.${sec} 缺 equal 判定`);
  }
  return problems;
}

/** reused 真全目录核验（P1-4 三审加固 2026-10-09）：
 *  ①全树精确集+逐文件字节核验（db/metadata/tickets/reviews/manifest/evidence——根目录额外文件即红）；
 *  ②既有 manifest 过同一 contract-validator；且与本次 staging manifest **除 created_at 外 canonical 相等**；
 *  ③evidence 工件存在且结构合法；④同 bundle_id。不写任何文件（created_at 差异容忍——内容寻址输入不含它）。 */
function verifyReusedBundle(finalDir, staging, manifest, copySha) {
  const problems = [];
  const existing = JSON.parse(readFileSync(join(finalDir, 'manifest.json'), 'utf8'));
  if (existing.bundle_id !== manifest.bundle_id) problems.push(`幂等冲突：目录 ${manifest.bundle_id} 内 manifest id=${existing.bundle_id}`);
  // ②既有 manifest 过同一 validator（篡改=红——role_status_counts/evidence 等任何面）
  for (const e of validateFixture({ fixture_kind: 'pilot-bundle', ...existing })) {
    problems.push(`既有 manifest 契约违规：${e.rule} ${e.pointer}——${e.message}`);
  }
  // ②canonical 相等（内容面恒等；运行时钟面排除——created_at=制作时刻、observed_at=行数观测时刻，
  //   两者均为本次运行 --clock 依赖的时间戳，非内容寻址输入；其余全部字段 canonical 必须相等）
  const { created_at: _ce, ...existingBody } = existing;
  const { sqlite_copy: { observed_at: _oe }, ...existingRest } = existingBody;
  const { created_at: _cs, ...stagingBody } = manifest;
  const { sqlite_copy: { observed_at: _os }, ...stagingRest } = stagingBody;
  if (canon(existingRest) !== canon(stagingRest)) problems.push('reused 核验失败：既有 manifest 与本次 staging manifest 内容面 canonical 不等（漂移；时钟面 created_at/observed_at 除外）');
  // ④db 副本字节恒等
  if (sha256File(join(finalDir, 'db.sqlite')) !== copySha) problems.push('reused 核验失败：既有 db.sqlite hash ≠ 本次内容寻址输入');
  // ①全树精确集：期望=staging 全树 ∪ {manifest.json, source-zero-write-evidence.json}
  const expected = new Set([
    'manifest.json', 'source-zero-write-evidence.json', 'db.sqlite',
    ...listFilesDeep(staging).map(p => p),
  ]);
  const actual = listFilesDeep(finalDir);
  for (const f of actual) if (!expected.has(f)) problems.push(`reused 核验失败：既有目录含期望外文件 ${f}（rogue=红——P1-4）`);
  for (const f of expected) if (!actual.includes(f)) problems.push(`reused 核验失败：既有目录缺文件 ${f}`);
  // ①逐文件字节核验（staging 内同名文件）
  for (const f of listFilesDeep(staging)) {
    if (sha256File(join(staging, f)) !== sha256File(join(finalDir, f))) problems.push(`reused 核验失败：${f} 字节不等`);
  }
  // ③evidence 结构合法
  let evd = null;
  try { evd = JSON.parse(readFileSync(join(finalDir, 'source-zero-write-evidence.json'), 'utf8')); }
  catch { problems.push('reused 核验失败：source-zero-write-evidence.json 不可解析'); }
  if (evd) problems.push(...checkEvidenceStructure(evd).map(m => `reused 核验失败：${m}`));
  if (problems.length) throw new Error(`REUSED_VERIFY_FAIL：\n  ${problems.join('\n  ')}`);
}

async function finishBundle({ staging, copySha, rowCount, agentsRoot, projectDir, projectId, projNorm, nowIso, storeRoot }) {
  // 3) metadata corpus 扫描（eligible 谓词）+ 物理拷贝
  const corpus = scanMetadataCorpus(agentsRoot, projNorm);
  const rsc = aggregateRoleStatus(corpus.eligible);
  const rscSum = Object.values(rsc).reduce((a, b) => a + b, 0);
  if (rscSum !== corpus.eligible.length) throw new Error(`role_status_counts 合计 ${rscSum} ≠ eligible ${corpus.eligible.length}`);
  for (const f of corpus.eligible) {
    const dst = join(staging, 'metadata', f.relative_path);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(agentsRoot, f.relative_path), dst);
    if (sha256File(dst) !== f.sha256) throw new Error(`metadata 拷贝 hash 失配：${f.relative_path}`);
  }

  // 4) tickets/reviews 冻结 + 物理拷贝
  const tr = freezeTicketsReviews(projectDir);
  for (const s of tr.slugs) {
    const dst = join(staging, 'tickets', s + '.md');
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(tr.ticketsDir, s + '.md'), dst);
  }
  for (const f of tr.reviewFiles) {
    const dst = join(staging, 'reviews', f);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(tr.reviewsDir, f), dst);
  }

  // 5) git HEAD + bundle_id（内容寻址：sqlite 副本 SHA + eligible 文件集摘要 + tickets/reviews SHA + git HEAD）
  const head = gitHead(projectDir);
  const idInput = canon({
    sqlite: copySha,
    metadata: corpus.eligible.map(f => [f.relative_path, f.sha256]),
    tickets_reviews: tr.sha256,
    git_head: head,
  });
  const idSha8 = sha256Hex(idInput).slice(0, 8);
  const bundleId = `pilot-${projectId}-202609-${idSha8}`;

  const manifest = {
    manifest_kind: 'pilot-bundle',
    bundle_id: bundleId,
    created_at: nowIso,
    project_id: projectId,
    time_range: {
      sqlite_time_field: PILOT.sqliteTimeField,
      metadata_time_field: PILOT.metadataTimeField,
      from: PILOT.from,
      until: PILOT.until,
      bounds: PILOT.bounds,
    },
    sqlite_copy: {
      sha256: copySha,
      row_count: rowCount,
      observed_at: nowIso,
      eligible_predicate: PILOT.sqlitePredicate,
    },
    metadata_corpus: {
      corpus_root: agentsRoot.replaceAll('\\', '/'),
      total_scanned: corpus.total_scanned,
      eligible_count: corpus.eligible.length,
      excluded: corpus.excluded.sort((a, b) => a.reason < b.reason ? -1 : 1),
      project_field: 'cwd/workspaceRoot',
      project_normalized: projectId,
      time_field: PILOT.metadataTimeField,
      time_interval: PILOT.metadataInterval,
      eligible_predicate: PILOT.metadataPredicate,
      role_status_counts: rsc,
      eligible_files: corpus.eligible.map(({ _role, _status, ...rest }) => rest),
    },
    tickets_reviews: {
      slug_list: tr.slugs,
      tickets_dir: 'docs/tickets',
      reviews_dir: 'docs/reviews',
      sha256: tr.sha256,
    },
    git_head: head,
  };

  // 6) manifest 过同一 contract-validator（P1-1：生产产物无法绕过 validator）
  const errs = validateFixture({ fixture_kind: 'pilot-bundle', description: 'bundle create 产物', ...manifest });
  if (errs.length) throw new Error(`manifest 契约验证失败：\n${errs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);

  // 7) 幂等（P1-9）：snapshots/<id> 已存在（内容寻址同 id）→ 真全目录核验后复用——**不写任何文件**
  //    （不覆写 manifest/evidence/metadata；created_at 差异容忍：内容寻址输入不含它）
  const finalDir = join(storeRoot, 'snapshots', bundleId);
  if (existsSync(finalDir)) {
    verifyReusedBundle(finalDir, staging, manifest, copySha);
    return { bundleId, manifest, staging, finalDir, reused: true, eligibleCount: corpus.eligible.length, totalScanned: corpus.total_scanned, roleStatusCounts: rsc, rowCount };
  }

  // 8) manifest 写入 staging（rename 与全部判定见 buildBundle——P1-9 时序：全绿才落位）
  writeJson(join(staging, 'manifest.json'), manifest);
  return { bundleId, manifest, staging, finalDir, reused: false, eligibleCount: corpus.eligible.length, totalScanned: corpus.total_scanned, roleStatusCounts: rsc, rowCount };
}

function listFilesDeep(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(relative(dir, p).replaceAll('\\', '/'));
    }
  };
  walk(dir);
  return out;
}
