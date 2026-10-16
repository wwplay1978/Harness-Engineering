// stats2/zcode-source.mjs — ZCode 双源 adapter：sqlite 面（model_usage/session）
// 纪律（docs/22 §5.3 + 票面红线 1）：
//   - **永不打开活源 SQLite**（P0-1 重构 2026-10-09 三审：bundle 制作改纯文件复制协议——
//     snapshotCopySource；旧「ro 打开+Online Backup」直开路径已废弃退役，源侧只剩只读文件系统操作）；
//   - 只读消费（collect/verify/rebuild 读 bundle sqlite）一律经 TEMP 封闭副本（withReadonlyDbCopy）；
//   - 显式 SELECT 列清单（allowlist），禁 SELECT *、禁 error_message/raw_usage_json/provider_metadata_json；
//   - fallback/重试仅限锁类错误白名单（SQLITE_BUSY=5 / SQLITE_LOCKED=6）——schema/权限错不吞、立即 fail-loud。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, rmSync, statSync, openSync, readSync, writeSync, closeSync, statfsSync,
} from 'node:fs';
import { join, basename } from 'node:path';

export const ZCODE_ADAPTER_ID = 'zcode-sqlite';
export const ZCODE_ADAPTER_TYPE = 'mutable-row';

/** §5.3 SELECT allowlist（列名=真实源实测：cache_creation_input_tokens/cache_read_input_tokens；
 *  时间列=epoch 毫秒整型；id=字符串主键。真实源另有 error_message/raw_usage_json/provider_metadata_json
 *  等禁取列——本清单即排除面，禁 SELECT *）。 */
export const MODEL_USAGE_COLUMNS = [
  'id', 'session_id', 'agent', 'model_id', 'duration_ms', 'time_to_first_token_ms',
  'input_tokens', 'output_tokens', 'reasoning_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens',
  'retry_count', 'status', 'started_at', 'completed_at',
];
/** session 必需列（真实源实测：时间=time_created epoch 毫秒；无 started_at/ended_at 列）。 */
export const SESSION_COLUMNS = ['id', 'parent_id', 'path', 'task_type', 'time_created'];

/** 锁类错误白名单（冻结）：仅此类允许重试/回退；其余（schema/权限/cantopen…）立即 fail-loud。 */
export function isLockClassError(e) {
  return Boolean(e && (e.errcode === 5 || e.errcode === 6
    || /database is locked|database table is locked/i.test(String(e.message ?? ''))));
}

/**
 * 只读打开（busy 重试）：白名单错误按退避重试；非白名单立即抛出。
 * 活源上不再调用（P0-1 重构后仅打开受管 TEMP 副本）；保留供副本消费路径。
 * @returns {DatabaseSync}
 */
export function openReadOnly(dbPath, { retries = 5, baseDelayMs = 100 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return new DatabaseSync(dbPath, { readOnly: true });
    } catch (e) {
      lastErr = e;
      if (!isLockClassError(e)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

// ── P0-1 零写入语义（2026-10-08 复审实锤 → 2026-10-09 三审重构）────────
// 根因：node:sqlite DatabaseSync readOnly:true 在 WAL 库上仍创建 -shm/-wal 边车且 close 后残留；
// 旧 bundle 制作经 ro 直开活源 → 静默 WAL 源首跑自造边车（零写入违例）→ 第二跑"洗白"。
// 重构：bundle 制作改**纯文件复制协议**（snapshotCopySource）——源侧零 SQLite 打开，
// 任何边车/写入在本工具侧结构性不可能；不稳窗口由「三方摘要恒等」（copy==before==after，P0-1 ABA 收紧 2026-10-12）有界重试收敛。
const COPY_CHUNK_BYTES = 64 * 1024 * 1024;   // 分块复制粒度（长复制内部分块间可刷锁心跳——P0-2）

/** 单文件摘要观测（{sha256,size_bytes,mtime_ms}——复制稳定性与零写入证据的共用原子）。 */
export function fileSnapshot(p) {
  const st = statSync(p);
  return { sha256: createHash('sha256').update(readFileBytes(p)).digest('hex'), size_bytes: st.size, mtime_ms: Math.trunc(st.mtimeMs) };
}
function readFileBytes(p) {
  const chunks = [];
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
  } finally { closeSync(fd); }
  return Buffer.concat(chunks);
}

/** 分块复制（P0-2：长复制分块间回调 onChunk——锁持有方借以周期刷心跳）；写失败/短写 fail-loud（全写断言——P2-1）；fsync 归调用方/终产物协议面（本函数不含 fsyncSync）。
 *  snapshot-aba-hardening 交付物 2：副本摘要**流式随算**（incremental sha256 随每块写盘更新）——
 *  省一次全读且哈希计算天然落在心跳窗口内（既有 3 遍全读的心跳缺口不因该票放大）；
 *  返回 {sha256,size_bytes}=本次落盘字节的摘要观测（供 snapshotCopySource 三方恒等比对）。 */
export function copyFileChunked(src, dst, { onChunk = null, chunkBytes = COPY_CHUNK_BYTES } = {}) {
  const st = statSync(src);
  const inFd = openSync(src, 'r');
  const outFd = openSync(dst, 'w');
  const hash = createHash('sha256');
  try {
    const buf = Buffer.alloc(Math.min(chunkBytes, Math.max(st.size, 1)));
    let copied = 0;
    for (;;) {
      const n = readSync(inFd, buf, 0, buf.length, null);
      if (n <= 0) break;
      const w = writeSync(outFd, buf, 0, n);   // P2-1：短写 fail-loud——否则 hash 算的是读缓冲而非落盘字节，恒等证据可为假
      if (w !== n) throw new Error(`短写：${basename(src)} 期望写入 ${n} 实得 ${w}`);
      hash.update(buf.subarray(0, n));
      copied += n;
      if (onChunk) onChunk(copied, st.size);
    }
    if (copied !== st.size) throw Object.assign(
      new Error(`复制字节数不符：${basename(src)} 期望 ${st.size} 实得 ${copied}`),
      { code: 'COPY_SIZE_DRIFT' },   // stats-hygiene-2 交付物 1：源字节层面漂移标记——snapshotCopySource 捕获按「源不稳」重试
    );
    return { sha256: hash.digest('hex'), size_bytes: copied };
  } finally {
    closeSync(inFd); closeSync(outFd);
  }
}

/** 磁盘空间预检（受管 TEMP 目标）：可用空间须 ≥ 需求×2（余量因子）；statfs 不可用则跳过（预检面注记）。 */
function ensureDiskSpace(destDir, neededBytes) {
  try {
    const s = statfsSync(destDir);
    const free = Number(s.bsize) * Number(s.bavail);
    if (free < neededBytes * 2) {
      throw Object.assign(
        new Error(`DISK_SPACE：受管 TEMP 可用空间不足（free=${free} 需求（含余量）=${neededBytes * 2}——${destDir}）`),
        { code: 'DISK_SPACE' },
      );
    }
  } catch (e) {
    if (e.code === 'DISK_SPACE') throw e;
    /* statfs 不可用（平台/文件系统限制）：预检跳过，复制自身的错仍会 fail-loud */
  }
}

/**
 * 源快照复制协议（P0-1 三审重构核心；bundle 制作的唯一源 sqlite 接触位——纯文件复制，零 SQLite 打开）：
 *   ①对 db.sqlite+存在的 -wal 计 {sha256,size,mtime} 快照 → ②磁盘空间预检 → 复制到受管 TEMP
 *   （含既有 -wal 伴随物——WAL 内容未并回时缺它即丢已提交事务）→ ③复制后重算源摘要+副本摘要（流式随算），
 *   三方恒等 copy==before==after（逐文件 sha256+size_bytes；mtime 不参与副本比对）不满足
 *   → 丢弃副本+有界重试（maxAttempts≥3）；仍不稳 → fail-loud「源不稳定」（无退避=有意设计——方向保守失败）
 *   → ④返回稳定副本路径+本次观测快照+副本摘要（checkpoint/integrity/行数由调用方在 TEMP 副本上执行）。
 * onBeforeCopy(attempt)：before 快照后、首次读源前的注入位（仅测试 fixture 使用——构造 ABA：写 B 态库后由 onAfterCopy 写回 A）。
 * onAfterCopy(attempt)：复制完成与稳定性判定之间的注入位（仅测试 fixture 使用——模拟复制窗内源变化）。
 * chunkBytes 透传 copyFileChunked（测试可缩块造多块窗口）。
 * @returns {{copyPath: string, attempts: number, sourceSnapshot: object, copyDigests: object}}
 *   copyDigests=副本逐文件 {sha256,size_bytes}，本函数内部 pre-checkpoint 计算并随返回值带出（与源可比）；
 *   与 manifest.sqlite 的 post-checkpoint copySha 设计即不等：前者=快照一致性证据，后者=终产物内容寻址。
 */
export function snapshotCopySource(dbPath, destDir, { maxAttempts = 3, onBeforeCopy = null, onAfterCopy = null, onChunk = null, chunkBytes = COPY_CHUNK_BYTES } = {}) {
  const walPath = `${dbPath}-wal`;
  const files = [dbPath, walPath];
  const snap = () => Object.fromEntries(files.filter(existsSync).map(p => [basename(p), fileSnapshot(p)]));
  const needed = files.filter(existsSync).reduce((a, p) => a + statSync(p).size, 0);
  ensureDiskSpace(destDir, needed);
  const copyPath = join(destDir, 'db.sqlite');
  let driftCause = null;   // stats-hygiene-2 交付物 1：末次 byte-guard 漂移错误（cause 链保留期望/实得字节）
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const before = snap();
    if (onBeforeCopy) onBeforeCopy(attempt);   // 注入位（仅测试 fixture）：before 快照后、首次读源前——ABA 注入窗（snapshot-aba-hardening 交付物 4）
    let dbCopy, walCopy = null;
    try {
      dbCopy = copyFileChunked(dbPath, copyPath, { onChunk, chunkBytes });
      const copyWal = `${copyPath}-wal`;
      if (existsSync(walPath)) walCopy = copyFileChunked(walPath, copyWal, { onChunk, chunkBytes });
      else rmSync(copyWal, { force: true });   // 上次尝试的残留副本边车不得混入本次
    } catch (e) {
      // stats-hygiene-2 交付物 1（byte-guard 重试语义——2026-10-13 实测发现：1.1GB 活源活动期
      // BUNDLE-FAIL「复制字节数不符」直接抛出未入重试环）：copyFileChunked 的 copied!==st.size
      // （复制窗内源字节层面漂移——增长/收缩）与三方摘要不等同步判「源不稳」——丢弃该次尝试+
      // 计入有界重试（耗尽→SOURCE_UNSTABLE fail-loud；期望/实得字节经 cause 链保留）。
      // 其他错误（短写/IO/磁盘）不吞——立即 fail-loud（P2-1 全写断言面不因本环弱化）。
      if (e.code !== 'COPY_SIZE_DRIFT') throw e;
      driftCause = e;
      rmSync(copyPath, { force: true });
      rmSync(`${copyPath}-wal`, { force: true });
      continue;
    }
    if (onAfterCopy) onAfterCopy(attempt);
    const after = snap();
    const copyDigests = { [basename(dbPath)]: { sha256: dbCopy.sha256, size_bytes: dbCopy.size_bytes } };   // 副本摘要=流式随算（pre-checkpoint 字节）
    if (walCopy) copyDigests[basename(walPath)] = { sha256: walCopy.sha256, size_bytes: walCopy.size_bytes };
    // 三方摘要恒等（snapshot-aba-hardening 交付物 1）：逐文件（db+在场 -wal）
    // copy.{sha256,size_bytes} == before.{sha256,size_bytes} == after.{sha256,size_bytes}
    // （mtime 不参与副本比对——副本 mtime 恒异于源；源侧 before/after 观测仍含 mtime 不变）。
    // ABA（源在复制窗内 A→B→A）下 copy=B 而 before==after==A → 检出丢弃重试
    // （旧协议仅比源侧 before==after——接受 B 副本而证据声明 A=伪一致）。
    // P3-9（四审，Kimi P3-1）残余风险评估=已评估不处置：「写后摘要比对」是毫秒级窗口上的观测，
    // after 快照与 return 之间源仍可变化（TOCTOU 残余）——无写者协作的文件复制协议无法归零该窗。
    // 不处置依据：①副本完整性由步骤④ PRAGMA quick_check 在 TEMP 副本上独立核验（截断/页损坏 fail-loud）；
    // ②（撤回，snapshot-aba-hardening）原论据「漂移只影响取到哪一刻的源，不产生伪一致」被 ABA 反例推翻
    //   ——源 A→B→A 时旧协议接受 B 副本而证据声明 A；三方摘要恒等后该论据不再需要；
    // ③活源高频写入场景本就应以静默期制作 bundle（票面使用前提）。归零须源侧写者协作，超出本工具边界。
    if (canonEq(before, after) && digestsEq(copyDigests, before)) return { copyPath, attempts: attempt, sourceSnapshot: before, copyDigests };
    // 源在复制窗内变化或副本≠源（ABA/撕裂）→ 副本不可信：丢弃后重试
    rmSync(copyPath, { force: true });
    rmSync(`${copyPath}-wal`, { force: true });
  }
  throw Object.assign(
    new Error(`SOURCE_UNSTABLE：源在复制窗口内持续变化（${maxAttempts} 次尝试均未取得稳定副本——摘要不等或字节漂移〔byte-guard〕）——稍后源静默时重试（P0-1 纯文件复制协议）`),
    { code: 'SOURCE_UNSTABLE', ...(driftCause ? { cause: driftCause } : {}) },
  );
}
function canonEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }   // 快照对象=固定键集，JSON 序即 canonical
/** 副本摘要 vs 源快照的逐文件恒等（snapshot-aba-hardening 交付物 1）：仅比 {sha256,size_bytes}
 *  ——mtime 不参与副本比对（副本 mtime 恒异于源）；键集不等（-wal 出现/消失于复制窗）亦判不稳。 */
function digestsEq(copyDigests, before) {
  const keys = Object.keys(before);
  return keys.length === Object.keys(copyDigests).length
    && keys.every(k => copyDigests[k] != null && copyDigests[k].sha256 === before[k].sha256
      && copyDigests[k].size_bytes === before[k].size_bytes);
}

/** 复制 db 文件（连同既有 -wal 伴随物——WAL 内容未并回时缺它即丢已提交事务）到目标目录，返回副本路径。 */
export function copyDbIntoDir(dbPath, destDir, { onChunk = null } = {}) {
  const copy = join(destDir, `dbcopy-${process.pid}-${Math.random().toString(36).slice(2, 10)}.sqlite`);
  copyFileChunked(dbPath, copy, { onChunk });
  const wal = `${dbPath}-wal`;
  if (existsSync(wal)) copyFileChunked(wal, `${copy}-wal`, { onChunk });   // -shm 不复制：SQLite 从 wal 重建
  return copy;
}

/** 只读消费封闭副本：makeTempDir() 须为受管 TEMP 目录（仓内 makeOwnedTempDir——启动清扫兜底）；
 *  fn(copyPath) 内的一切打开（含多次）只触碰 TEMP 副本；finally 恒删。
 *  P1-6（2026-10-09 三审）：TEMP 删除失败**向上抛**（残留目录匿名标识=basename，不泄路径）→
 *  调用方 exit≠0；受管 TEMP 目录的最终回收归启动清扫（恢复路径，不改判——对齐 cmd-bundle 既有形态）。
 *  onChunk：分块复制间回调（P0-2 锁心跳注入位）。 */
export function withReadonlyDbCopy(dbPath, makeTempDir, fn, { onChunk = null } = {}) {
  const dir = makeTempDir();
  let fnError = null;
  let result;
  try {
    result = fn(copyDbIntoDir(dbPath, dir, { onChunk }));
  } catch (e) { fnError = e; }
  try { rmSync(dir, { recursive: true, force: true }); }
  catch (e) {
    // P1-6：删除失败向上抛（exit≠0）；fn 已有错时以 cause 链接保留原始错误（不被 finally 吞掉）。
    // P3-5（四审）：错误信息只携带 basename+e.code——e.message（EBUSY/EPERM 等）内嵌**绝对路径**
    // （含用户名/沙盒路径），曾击穿「残留匿名标识」目标；code 保留分类面，路径面归启动清扫现场。
    const tempErr = Object.assign(
      new Error(`TEMP-DELETE-FAIL：受管 TEMP 目录删除失败（残留匿名标识=${basename(dir)}；code=${e.code ?? 'UNKNOWN'}；退出非零，启动清扫将回收——P1-6）`),
      { cause: fnError ?? e },
    );
    throw fnError ? Object.assign(fnError, { cause: tempErr }) : tempErr;
  }
  if (fnError) throw fnError;
  return result;
}

/** model_usage 观测行数（活库数字必附 observed_at——调用方记录）。 */
export function observedModelUsageCount(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM model_usage').get().c;
}

/** 副本完整性核验（P0-1 协议步骤④）：PRAGMA quick_check 须返回 'ok'（截断/页损坏副本 fail-loud）。 */
export function quickCheckOk(db) {
  const rows = db.prepare('PRAGMA quick_check').all();
  return rows.length === 1 && rows[0].quick_check === 'ok';
}

/** schema fingerprint：必需列集合探测（PRAGMA table_info）→ sha256(canonical 列集)。缺表/缺列→UNSUPPORTED_SOURCE。 */
export function schemaFingerprint(db) {
  const probe = {};
  for (const t of ['model_usage', 'session']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).sort();
    if (cols.length === 0) throw Object.assign(new Error(`UNSUPPORTED_SOURCE：源缺表 ${t}（必需列探测失败）`), { code: 'UNSUPPORTED_SOURCE' });
    const missing = (t === 'model_usage' ? MODEL_USAGE_COLUMNS : SESSION_COLUMNS).filter(c => !cols.includes(c));
    if (missing.length) throw Object.assign(new Error(`UNSUPPORTED_SOURCE：${t} 缺必需列 ${missing.join(',')}（探测列=${cols.join(',')}）`), { code: 'UNSUPPORTED_SOURCE' });
    probe[t] = cols;
  }
  return createHash('sha256').update(JSON.stringify(probe)).digest('hex');
}

/** 窗口内 model_usage 行（显式列清单；started_at=epoch 毫秒整型，窗口谓词按数值半开区间；
 *  排序=（completed_at,id）复合游标推进序——terminal 在前按 completed_at 升序，非 terminal 殿后）。 */
export function selectModelUsageWindow(db, { fromMs, untilMs }) {
  const cols = MODEL_USAGE_COLUMNS.join(', ');
  return db.prepare(
    `SELECT ${cols} FROM model_usage WHERE started_at >= ? AND started_at < ? ORDER BY (completed_at IS NULL), completed_at, id`,
  ).all(fromMs, untilMs);
}

/** session 表全量投影（显式列清单；childInSource 判据与 project 归属面）。 */
export function selectSessions(db) {
  return db.prepare(`SELECT ${SESSION_COLUMNS.join(', ')} FROM session`).all();
}

/** 源时间统一规范化：epoch 毫秒整型 / ISO 字符串 → RFC3339 UTC 规范形（秒位，Z 后缀）；null 透传。
 *  防御注记：本源实测时间列恒为 epoch **毫秒**（13 位，2026-10-08 pilot 探测）；若未来宿主改存
 *  epoch 秒（10 位），13 位阈值判定会将其按 ISO 解析失败路径返回 null → 落入 unknown 计量面（fail-loud 可见），
 *  不会被误标为 1970 年毫秒——这是刻意的保守失败方向，宿主版本升级时须重探。 */
export function toIsoUtc(v) {
  if (v == null) return null;
  if (Number.isFinite(Number(v)) && (Number.isInteger(v) || /^\d{13,}$/.test(String(v)))) {
    return new Date(Number(v)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
