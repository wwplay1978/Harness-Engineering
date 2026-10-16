// stats2/cmd-native.mjs — stats-3 阶段二：原生面命令（bundle create-native-corpus + collect --corpus）
// 真实源接触纪律（票面红线 1 + 裁决⑧）：create-native-corpus=唯一真实源接触位（JSONL 纯读+零写入证据
// 全树字节恒等，沿 stats-2 P0-1 形态）；collect --corpus 只消费冻结 corpus。
import { existsSync, readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { ensureStoreLayout, sweepTempDirs, ensureConfig, registerProject, acquireLock, releaseLock, guardedRefreshHeartbeat, LockTakeoverError, MUTATION_LOCK, makeOwnedTempDir } from './store.mjs';
import { sha256Hex, sha256File, writeJson, rfc3339, canon, fsyncDir, atomicWriteFile } from './util.mjs';
import { validateFixture, projectionContentKey } from './contract-validator.mjs';
import { EXIT } from './cli.mjs';
import * as EE from './events-engine.mjs';
import {
  KIMI_ADAPTER_ID, CODEX_ADAPTER_ID, NATIVE_CORPUS_SUPPORTED,
  projectKimiCorpus, projectCodexCorpus, loadCorpusManifest, verifyCorpusIntegrity,
  loadNativeAudit, writeNativeAudit, nativeAuditPath, sectionFilesDigest,
  KIMI_TYPE_ALLOWLIST, readJsonlLines, rowTimestamp, toIsoDay,
} from './native-source.mjs';
import { scanAllTicketMerges } from './cmd-bundle.mjs';

// 冻结边界（pilot-window-parameterization：常量→缺省值派生——五冻结点统一自 --from/--until 派生，
// 单源=pilot-window.mjs；缺省=九月窗行为字节级不变）
import { parseWindowFlags, deriveWindow } from './pilot-window.mjs';
const DEFAULT_WIN = deriveWindow();
const normPath = p => String(p).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

function projectBelongs(normCwd, projNorm) {
  return normCwd === projNorm || normCwd.startsWith(projNorm + '/') || normCwd.startsWith(projNorm + '-worktrees') || normCwd.startsWith(projNorm + '\\');
}

/** 有界重试读哈希（活源锁文件 EBUSY/EPERM——2026-10-09 真实源冻结实录）：
 *  3 次退避后仍不可读 → marker=`unreadable-<code>`（摘要面如实记录；eligible 扫描侧记排除）。 */
function hashFileResilient(p, { retries = 3, baseDelayMs = 200 } = {}) {
  for (let i = 0; ; i++) {
    try { return { sha: sha256File(p) }; }
    catch (e) {
      if ((e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') && i < retries) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, baseDelayMs * 2 ** i);
        continue;
      }
      if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') return { marker: `unreadable-${e.code}` };
      throw e;
    }
  }
}

/** 全树摘要（零写入证据面；stats-2 P0-1 同形态：rel→{sha,size,mtime} 字节恒等）。
 *  Windows reparse/junction 防护：目录性以 statSync（跟随）判定——dirent.isDirectory() 对
 *  junction 报 false 而 readFileSync 报 EISDIR（真实源 2026-10-09 冻结实录）；悬空链接记 link-broken；
 *  持续锁文件记 unreadable-* marker（marker 前后恒等=证据稳定；状态翻转=摘要变化=红线索报）。 */
function treeDigest(rootDir) {
  const entries = {};
  if (!existsSync(rootDir)) return { entries, digest: sha256Hex(canon({})) };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      let st = null;
      try { st = statSync(p); } catch { st = null; }
      if (st?.isDirectory()) { walk(p); continue; }
      const rel = relative(rootDir, p).replaceAll('\\', '/');
      if (st == null) { entries[rel] = { sha: 'link-broken', size: 0, mtime: 0 }; continue; }
      const h = hashFileResilient(p);
      entries[rel] = h.marker
        ? { sha: h.marker, size: st.size, mtime: Math.trunc(st.mtimeMs) }
        : { sha: h.sha, size: st.size, mtime: Math.trunc(st.mtimeMs) };
    }
  };
  walk(rootDir);
  return { entries, digest: sha256Hex(canon(entries)) };
}

function walkFiles(rootDir, predicate) {
  const out = [];
  if (!existsSync(rootDir)) return out;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      let isDir = e.isDirectory();
      if (!isDir) { try { isDir = statSync(p).isDirectory(); } catch { /* 悬空链接按文件面跳过 */ } }
      if (isDir) walk(p);
      else if (predicate(e.name)) out.push(p);
    }
  };
  walk(rootDir);
  return out;
}

/** Kimi 全局 session_index 装载（真实源实测 2026-10-09 冻结工段：~/.kimi-code/session_index.jsonl
 *  单文件，逐行 {sessionId, sessionDir, workDir}；会话目录级 join=会话身份→workDir）。
 *  收集根下全部 session_index.jsonl（未来分片形态兼容）合并为 sessionId/sessionDir→workDir 双索引。 */
export function loadKimiSessionIndex(kimiRoot) {
  const bySessionDir = new Map();
  const bySessionId = new Map();
  for (const idx of walkFiles(kimiRoot, n => n === 'session_index.jsonl')) {
    for (const line of readFileSync(idx, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const j = JSON.parse(line);
        const wd = j.workDir ?? j.work_dir ?? j.cwd ?? j.payload?.workDir;
        if (typeof wd !== 'string' || wd === '') continue;
        if (typeof j.sessionDir === 'string' && j.sessionDir !== '') bySessionDir.set(normPath(j.sessionDir), wd);
        if (typeof j.sessionId === 'string' && j.sessionId !== '') bySessionId.set(j.sessionId, wd);
      } catch { /* 行损坏跳过 */ }
    }
  }
  return { bySessionDir, bySessionId };
}

/** wire.jsonl → workDir（会话目录级 join）：自 wire 所在目录逐级上溯查 sessionDir 索引
 *  （真实形态=sessions/<ws>/session_<uuid>/agents/main/wire.jsonl 三层；容忍任意深度）；
 *  路径不中时以 session_<uuid> 段查 sessionId 索引兜底。 */
function kimiWorkDirFor(wireAbs, kimiRoot, index) {
  let dir = dirname(wireAbs);
  for (;;) {
    const n = normPath(dir);
    const hit = index.bySessionDir.get(n);
    if (hit) return hit;
    if (n === kimiRoot || !n.startsWith(kimiRoot + '/')) break;   // 出源即止（规范化形态比较）
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const m = /session_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(wireAbs).replaceAll('\\', '/'));
  if (m) return index.bySessionId.get(`session_${m[1]}`) ?? null;
  return null;
}

/** Kimi wire.jsonl 会话时间：首条 allowlist 行时戳；不可得→null（调用方落 mtime 近似）。 */
function kimiFirstAllowableTs(absPath) {
  const lines = readJsonlLines(absPath, '', { allowlistTypes: KIMI_TYPE_ALLOWLIST });
  for (const { row } of lines) {
    const ts = rowTimestamp(row);
    if (ts) return ts;
  }
  return null;
}

const inWindow = (ms, win) => ms >= win.fromMs && ms < win.untilMs;

/** eligible 谓词执行（裁决⑧；窗=pilot-window 派生对象，缺省=九月窗）：project 判定（workDir→注册表）AND 会话时间判定（首行时戳；mtime 近似注记）。 */
export function scanKimi(kimiRoot, projNorm, win = DEFAULT_WIN) {
  const eligible = [], excluded = [];
  const index = loadKimiSessionIndex(kimiRoot);   // 全局索引会话级 join（真实源形态）
  const bump = (reason) => { const e = excluded.find(x => x.reason === reason); if (e) e.count++; else excluded.push({ reason, count: 1 }); };
  const files = walkFiles(kimiRoot, n => n === 'wire.jsonl');
  let approx = 0;
  for (const abs of files) {
    const rel = relative(kimiRoot, abs).replaceAll('\\', '/');
    const h = hashFileResilient(abs);
    if (h.marker) { bump(`读取失败（${h.marker}——活源锁文件）`); continue; }
    const wd = kimiWorkDirFor(abs, kimiRoot, index);
    if (wd == null || !projectBelongs(normPath(wd), projNorm)) { bump('project 判定不中（session_index workDir 缺失或非本项目）'); continue; }
    let first = kimiFirstAllowableTs(abs);
    let timeField = '首条 allowlist 行时戳';
    let last = null;
    if (first == null) {
      const mtime = Math.trunc(statSync(abs).mtimeMs);
      first = toIsoDay(mtime); last = first; timeField = 'mtime-approx（行时戳不可得，以文件 mtime 近似）'; approx++;
      if (!inWindow(mtime, win)) { bump('会话时间判定不中（mtime 近似）'); continue; }
    } else {
      if (!inWindow(Date.parse(first), win)) { bump('会话时间判定不中（首条 allowlist 行时戳区间外）'); continue; }
      // last=文件内最后一条 allowlist 行时戳
      const lines = readJsonlLines(abs, '', { allowlistTypes: KIMI_TYPE_ALLOWLIST });
      for (let i = lines.length - 1; i >= 0; i--) { const ts = rowTimestamp(lines[i].row); if (ts) { last = ts; break; } }
    }
    const st = statSync(abs);
    eligible.push({
      relative_path: rel, sha256: h.sha, size_bytes: st.size, mtime_ms: Math.trunc(st.mtimeMs),
      workdir: wd.replaceAll('\\', '/'), session_first_at: first, session_last_at: last,
      _time_field: timeField,
    });
  }
  eligible.sort((a, b) => a.relative_path < b.relative_path ? -1 : 1);
  return { total_scanned: files.length, eligible, excluded, approx, time_field: approx > 0 ? '首条 allowlist 行时戳（部分会话 mtime-approx——见逐文件注记）' : '首条 allowlist 行时戳' };
}

/** Codex eligible 谓词执行（窗=pilot-window 派生对象，缺省=九月窗）：session_meta.payload.cwd 归属 AND 首行时戳窗。 */
export function scanCodex(sessionsRoot, projNorm, win = DEFAULT_WIN) {
  const eligible = [], excluded = [];
  const bump = (reason) => { const e = excluded.find(x => x.reason === reason); if (e) e.count++; else excluded.push({ reason, count: 1 }); };
  const files = walkFiles(sessionsRoot, n => n.endsWith('.jsonl'));
  let approx = 0;
  for (const abs of files) {
    const rel = relative(sessionsRoot, abs).replaceAll('\\', '/');
    const h = hashFileResilient(abs);
    if (h.marker) { bump(`读取失败（${h.marker}——活源锁文件）`); continue; }
    let cwd = null, first = null, last = null;
    for (const { row, parseError } of readJsonlLines(abs, rel)) {
      if (parseError || !row) continue;
      if (String(row.type ?? '') === 'session_meta') {
        cwd = row.payload?.cwd ?? row.payload?.workspaceRoot ?? cwd;
        const ts = rowTimestamp(row);
        if (ts && first == null) first = ts;
      }
      const ts = rowTimestamp(row);
      if (ts) last = ts;
    }
    let timeField = 'session_meta 首行时戳';
    if (cwd == null || !projectBelongs(normPath(cwd), projNorm)) { bump('project 判定不中（session_meta cwd 缺失或非本项目）'); continue; }
    if (first == null) {
      const mtime = Math.trunc(statSync(abs).mtimeMs);
      first = toIsoDay(mtime); last = first; timeField = 'mtime-approx（时戳不可得，以文件 mtime 近似）'; approx++;
      if (!inWindow(mtime, win)) { bump('会话时间判定不中（mtime 近似）'); continue; }
    } else if (!inWindow(Date.parse(first), win)) {
      bump('会话时间判定不中（首行时戳区间外）'); continue;
    }
    const st = statSync(abs);
    eligible.push({
      relative_path: rel, sha256: h.sha, size_bytes: st.size, mtime_ms: Math.trunc(st.mtimeMs),
      workdir: cwd.replaceAll('\\', '/'), session_first_at: first, session_last_at: last,
      _time_field: timeField,
    });
  }
  eligible.sort((a, b) => a.relative_path < b.relative_path ? -1 : 1);
  return { total_scanned: files.length, eligible, excluded, approx, time_field: approx > 0 ? 'session_meta 首行时戳（部分会话 mtime-approx——见逐文件注记）' : 'session_meta 首行时戳' };
}

const stripInternal = ({ _time_field, ...rest }) => rest;

/** `bundle create-native-corpus`：真实源一次性冻结（唯一接触位）。 */
export async function cmdBundleNativeCorpus(opts) {
  const { storeRoot, projectDir, injectedInstanceId, clock, flags } = opts;
  if (!projectDir) { console.error('bundle create-native-corpus 需要 --project-dir（消费项目仓根——workDir→project 归属基面）'); return EXIT.USAGE; }
  const kimiHome = flags['kimi-home'] ?? join(homedir(), '.kimi-code');
  const codexHome = flags['codex-home'] ?? join(homedir(), '.codex');
  if (clock) console.log(`[AUDIT] --clock=${clock}（native corpus 冻结；created_at/observed_at 冻结于该时钟——P2-1 使用必记）`);
  const nowIso = clock ?? rfc3339();
  // 窗口参数（pilot-window-parameterization：--from/--until 可选缺省九月窗；越界三拒收先于任何持久化写入——零副作用）
  const winParsed = parseWindowFlags(flags, nowIso);
  if (winParsed.error) { console.error(`USAGE（窗口）：${winParsed.error}`); return EXIT.USAGE; }
  const win = deriveWindow(winParsed);

  const checks = ensureStoreLayout(storeRoot);
  const failed = checks.find(c => !c.ok);
  if (failed) { for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason}`); return EXIT.ACL; }
  for (const line of sweepTempDirs(storeRoot)) console.log(`[TEMP] ${line}`);
  ensureConfig(storeRoot, { injectedId: injectedInstanceId, nowIso });
  const projectName = String(flags['project-name'] ?? basename(projectDir));
  const projNorm = normPath(projectDir);
  registerProject(storeRoot, projectName, projectDir, { nowIso });
  const projectId = projectName.toLowerCase();

  const kimiRoot = normPath(kimiHome);
  const sessionsRoot = join(codexHome, 'sessions');
  if (!existsSync(kimiHome) && !existsSync(codexHome)) {
    console.error(`SOURCE_UNAVAILABLE：双源均不存在（${kimiHome} / ${codexHome}）`); return EXIT.FAIL;
  }

  const tempDir = makeOwnedTempDir(storeRoot, 'nativecorpus');
  let exitCode = EXIT.OK;
  let buildError = null;
  let result = null;
  // 活源稳定性（stats-2 SOURCE_UNSTABLE 同形态）：宿主进程在冻结窗内写源（22 §2.1「活库增长属预期」）
  // → 零写入证据 digest 不恒等 → 丢弃 staging 有界重试；持续不稳 → fail-loud（静默期重试）。
  const maxAttempts = 3;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await buildNativeCorpus({ storeRoot, tempDir, attempt, kimiHome, codexHome, projectDir, projectId, projNorm, nowIso, win });
      } catch (e) { buildError = e; break; }
      if (result.ok) break;
      if (attempt < maxAttempts) console.error(`[NATIVE-CORPUS-RETRY] 源在冻结窗口内变化（第 ${attempt}/${maxAttempts} 次）——丢弃 staging 重试`);
    }
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); }
    catch (e) { console.error(`TEMP-DELETE-FAIL：${basename(tempDir)}：${e.code ?? e.message}（exit≠0；下次启动扫描清理）`); exitCode = exitCode === EXIT.OK ? EXIT.FAIL : exitCode; }
  }
  if (buildError) {
    console.error(`[NATIVE-CORPUS-FAIL] ${buildError.message}`);
    return buildError.code === 'UNSUPPORTED_SOURCE' ? EXIT.UNSUPPORTED_SOURCE : EXIT.FAIL;
  }
  if (!result.ok) {
    console.error('SOURCE_UNSTABLE：双源在冻结窗口内持续变化（3 次尝试零写入 digest 均不恒等——宿主进程活跃写入）——稍后源静默时重试');
    return EXIT.FAIL;
  }
  console.log(JSON.stringify({
    command: 'bundle create-native-corpus',
    corpus_id: result.corpusId, reused: result.reused,
    kimi: { total_scanned: result.kimi.total_scanned, eligible_count: result.kimi.eligible.length, excluded: result.kimi.excluded, mtime_approx: result.kimi.approx },
    codex: { total_scanned: result.codex.total_scanned, eligible_count: result.codex.eligible.length, excluded: result.codex.excluded, mtime_approx: result.codex.approx },
    zero_write: result.zeroWrite,
    evidence_artifact: result.reused ? 'preserved（reused 运行不覆写）' : 'written',
  }, null, 2));
  return exitCode === EXIT.OK ? EXIT.OK : exitCode;
}

async function buildNativeCorpus({ storeRoot, tempDir, attempt, kimiHome, codexHome, projectDir, projectId, projNorm, nowIso, win }) {
  // 零写入证据·前（证据域=本工段实际读取面——kimi=全树；codex=sessions 子树。作用域声明见 evidence.policy：
  // ~/.codex 根下 logs_2.sqlite{-wal,-shm} 为 Codex 后台 daemon 持续写入面（2026-10-09 12s 对照窗实测，
  // 本工具未运行仍变化）——不在本工段读取面内，逐秒变化令全树 digest 恒等结构性不可达成；stats-3-gap-4）
  const before = { kimi: treeDigest(kimiHome), codex: treeDigest(join(codexHome, 'sessions')) };
  const staging = join(tempDir, `corpus-${attempt}`);
  mkdirSync(staging, { recursive: true });
  const kimi = scanKimi(kimiHome, projNorm, win);
  const codex = scanCodex(join(codexHome, 'sessions'), projNorm, win);
  // eligible 物理拷贝（TEMP 中转）
  for (const f of kimi.eligible) {
    const dst = join(staging, 'kimi', f.relative_path);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(kimiHome, f.relative_path), dst);
    if (sha256File(dst) !== f.sha256) throw new Error(`kimi 拷贝 hash 失配：${f.relative_path}`);
  }
  for (const f of codex.eligible) {
    const dst = join(staging, 'codex', f.relative_path);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(codexHome, 'sessions', f.relative_path), dst);
    if (sha256File(dst) !== f.sha256) throw new Error(`codex 拷贝 hash 失配：${f.relative_path}`);
  }
  const idInput = canon({
    kimi: kimi.eligible.map(f => [f.relative_path, f.sha256]),
    codex: codex.eligible.map(f => [f.relative_path, f.sha256]),
    window: [win.from, win.until],
  });
  // 窗 token=from 的 UTC 年月（单 token 派生规则——pilot-window-parameterization P1-2；缺省 202609 同形）
  const corpusId = `native-${projectId}-${win.token}-${sha256Hex(idInput).slice(0, 8)}`;
  // stats-5 M3 取数面：票级 merge 观察（项目仓 git 面）。git 面不可得（非 git 仓/git 不可用）→
  // 空清单+stdout 注记如实（native corpus 契约不因 merge 观察强制 git 依赖——观察面缺席≠冻结失败）
  let nativeTicketMerges = [];
  try { nativeTicketMerges = scanAllTicketMerges(projectDir); }
  catch (e) { console.log(`[STATS5] ticket merge 观察不可得（${String(e.message).split('\n')[0]}）——manifest.ticket_merges=[]（n/a 如实）`); }
  const manifest = {
    manifest_kind: 'native-corpus', corpus_id: corpusId,
    created_at: nowIso, observed_at: nowIso, project_id: projectId,
    time_range: { from: win.from, until: win.until, bounds: win.bounds },
    kimi: {
      adapter_id: KIMI_ADAPTER_ID, adapter_type: 'append-only',
      source_root: String(kimiHome).replaceAll('\\', '/'),
      total_scanned: kimi.total_scanned, eligible_count: kimi.eligible.length,
      excluded: kimi.excluded.sort((a, b) => a.reason < b.reason ? -1 : 1),
      workdir_field: 'session_index.jsonl workDir（会话目录级 join）',
      time_field: kimi.time_field, time_interval: win.interval,
      eligible_predicate: win.kimiPredicate,
      eligible_files: kimi.eligible.map(stripInternal),
    },
    codex: {
      adapter_id: CODEX_ADAPTER_ID, adapter_type: 'append-only',
      source_root: join(codexHome, 'sessions').replaceAll('\\', '/'),
      total_scanned: codex.total_scanned, eligible_count: codex.eligible.length,
      excluded: codex.excluded.sort((a, b) => a.reason < b.reason ? -1 : 1),
      workdir_field: 'rollout session_meta.payload.cwd',
      time_field: codex.time_field, time_interval: win.interval,
      eligible_predicate: win.codexPredicate,
      eligible_files: codex.eligible.map(stripInternal),
    },
    // stats-5 M3 取数面（P1-1(a)）：票级 dogfood merge 观察（通用扫描——全史 `merge: ticket ` subject 解析；
    // 可选字段 additive，历史 corpus 无字段兼容；reused 运行零覆写沿既有语义；git 面缺席=空清单如实）
    ticket_merges: nativeTicketMerges,
  };
  const errs = validateFixture({ fixture_kind: 'native-corpus', ...manifest });
  if (errs.length) throw new Error(`native-corpus manifest 契约验证失败：\n${errs.map(e => `  ${e.rule} ${e.pointer}——${e.message}`).join('\n')}`);

  // 零写入证据·后（staging 内判定，全绿才 rename——P1-9 时序同款；证据域=读取面，见 before 注记）
  const after = { kimi: treeDigest(kimiHome), codex: treeDigest(join(codexHome, 'sessions')) };
  const kimiEqual = before.kimi.digest === after.kimi.digest;
  const codexEqual = before.codex.digest === after.codex.digest;
  const evidence = {
    recorded_at: rfc3339(),
    policy: '真实源一次性冻结接触（裁决⑧）：JSONL 纯读（readFileSync/逐行 JSON.parse）+物理 copyFileSync 出源，零 SQLite 打开；零写入判定=证据域（=本工段实际读取面）rel→{sha256,size,mtime} 前后字节恒等，读取面内无白名单无归因通道（stats-2 P0-1 同形态）。证据域声明：kimi=~/.kimi-code 全树（corpus 读取面=全树）；codex=~/.codex/sessions 子树（corpus 读取面仅 sessions/**/*.jsonl）——~/.codex 根下 logs_2.sqlite{-wal,-shm} 为 Codex 后台 daemon 持续写入面（2026-10-09 冻结工段 12s 对照窗实测：本工具未运行仍持续变化；不在读取面内、本工具结构性不可能写入——sqlite_opens_on_source=0），作用域收窄=stats-3-gap-4 上报项',
    source_access: { protocol: 'jsonl-pure-read+copy-out', sqlite_opens_on_source: 0, writes_on_source: 0 },
    evidence_scope: { kimi: '~/.kimi-code（全树）', codex: '~/.codex/sessions（子树）', out_of_scope_note: '~/.codex/logs_2.sqlite{,-wal,-shm}=宿主 daemon 活动面（对照窗实测持续变化，非本工段接触面）' },
    kimi_dir: { file_count: Object.keys(after.kimi.entries).length, digest_before: before.kimi.digest, digest_after: after.kimi.digest, equal: kimiEqual },
    codex_sessions: { file_count: Object.keys(after.codex.entries).length, digest_before: before.codex.digest, digest_after: after.codex.digest, equal: codexEqual },
  };
  const problems = [];
  if (!kimiEqual) problems.push('ZERO-WRITE-VIOLATION：~/.kimi-code 树在冻结窗口内变化（digest 不等）——红线条报');
  if (!codexEqual) problems.push('ZERO-WRITE-VIOLATION：~/.codex/sessions 读取面在冻结窗口内变化（digest 不等）——红线条报');
  if (problems.length) { for (const p of problems) console.error(p); return { ok: false, corpusId }; }

  const finalDir = join(storeRoot, 'snapshots', corpusId);
  if (existsSync(finalDir)) {
    // reused：manifest 过 validator+evidence 在场+逐文件 hash 抽核 → 复用零写入
    const existing = JSON.parse(readFileSync(join(finalDir, 'manifest.json'), 'utf8'));
    const eerrs = validateFixture({ fixture_kind: 'native-corpus', ...existing });
    if (eerrs.length) throw new Error(`REUSED_VERIFY_FAIL：既有 manifest 契约违规：${eerrs.map(e => e.rule).join(',')}`);
    if (!existsSync(join(finalDir, 'source-zero-write-evidence.json'))) throw new Error('REUSED_VERIFY_FAIL：evidence 工件缺失');
    for (const [sub, section] of [['kimi', manifest.kimi], ['codex', manifest.codex]]) {
      for (const f of section.eligible_files) {
        if (sha256File(join(finalDir, sub, f.relative_path)) !== f.sha256) throw new Error(`REUSED_VERIFY_FAIL：${sub}/${f.relative_path} 字节不等`);
      }
    }
    return { ok: true, reused: true, corpusId, kimi, codex, zeroWrite: { kimi_tree: kimiEqual, codex_sessions_tree: codexEqual } };
  }
  writeJson(join(staging, 'manifest.json'), manifest);
  writeJson(join(staging, 'source-zero-write-evidence.json'), evidence);
  fsyncDir(staging);
  renameSync(staging, finalDir);
  fsyncDir(join(storeRoot, 'snapshots'));
  return { ok: true, reused: false, corpusId, kimi, codex, zeroWrite: { kimi_tree: kimiEqual, codex_sessions_tree: codexEqual } };
}

// ── collect --corpus：冻结原生 corpus 上的增量采集 ─────────────────
export async function cmdNativeCollect(opts) {
  const { storeRoot, flags, clock } = opts;
  const corpusArg = flags.corpus;
  if (!corpusArg || typeof corpusArg !== 'string') { console.error('collect 需要 --corpus <corpus_id>（原生面）或 --bundle <id>（zcode 面）'); return EXIT.USAGE; }
  // failpoint 注入面收口：F/E 钩子由 zcode collect 承载（共享提交链引擎已全量注入验收）；
  // 原生面未接注入钩——显式拒收防「合法字面被静默不触发」（P3-6 同族防线）
  if (flags.failpoint !== undefined) {
    console.error('USAGE（failpoint）：native collect（--corpus）不承载 failpoint 注入——F/E 注入面=zcode collect（共享提交链引擎）');
    return EXIT.USAGE;
  }
  if (clock) console.log(`[AUDIT] --clock=${clock}（native collect；时间基准冻结于该时钟）`);
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
    return await nativeCollectInner({ storeRoot, sid, corpusArg, nowIso, flags });
  } catch (e) {
    if (e instanceof LockTakeoverError) { console.error(`${e.message}——native collect 立即中止`); return EXIT.FAIL; }
    throw e;
  } finally {
    releaseLock(storeRoot, MUTATION_LOCK);
  }
}

async function nativeCollectInner({ storeRoot, sid, corpusArg, nowIso, flags }) {
  const { manifest, dir, error } = loadCorpusManifest(storeRoot, corpusArg);
  if (error) { console.error(error); return EXIT.FAIL; }

  // ③ 版本越界探针（native-corpus 契约版本支持区间 [1,1]）
  const versionProbe = typeof flags['corpus-version-probe'] === 'string' ? Number(flags['corpus-version-probe']) : 1;
  if (!(versionProbe >= NATIVE_CORPUS_SUPPORTED[0] && versionProbe <= NATIVE_CORPUS_SUPPORTED[1])) {
    console.error(`UNSUPPORTED_SOURCE：native-corpus 契约版本越界（observed=${versionProbe}，supported=${NATIVE_CORPUS_SUPPORTED[0]}..${NATIVE_CORPUS_SUPPORTED[1]})——cursor 冻结、零写入`);
    return EXIT.UNSUPPORTED_SOURCE;
  }

  const quarantineDir = join(storeRoot, 'quarantine');
  const rec = EE.recoverPending(storeRoot, quarantineDir);
  for (const q of rec.quarantined) console.log(`[RECOVERY] partial segment → quarantine：${q.from}`);

  const results = [];
  const adapters = [
    { id: KIMI_ADAPTER_ID, section: manifest.kimi, sub: 'kimi', project: () => projectKimiCorpus(dir, manifest.kimi, sid, nowIso) },
    { id: CODEX_ADAPTER_ID, section: manifest.codex, sub: 'codex', project: () => projectCodexCorpus(dir, manifest.codex, sid, nowIso) },
  ];
  for (const ad of adapters) {
    const r = await collectOneAdapter({ storeRoot, sid, manifest, dir, ad, nowIso, quarantineDir, flags });
    if (typeof r === 'number') return r;   // fail-loud 透传退出码
    results.push(r);
  }
  console.log(JSON.stringify({ command: 'collect --corpus', corpus_id: manifest.corpus_id, adapters: results.map(x => x.summary), codex_join: results.find(x => x.join) ?.join ?? null }, null, 2));
  return EXIT.OK;
}

async function collectOneAdapter({ storeRoot, sid, manifest, dir, ad, nowIso, quarantineDir, flags }) {
  // 裁决⑦ 文件 size/hash 回退检测（截断/轮转/重写）→ fail-loud 零写入
  const integrity = verifyCorpusIntegrity(dir, ad.section, ad.sub);
  if (integrity.length) {
    console.error(`SOURCE_REGRESSION：corpus 文件 size/hash 回退（${ad.id}）——${integrity.join('；')}——fail-loud（裁决⑦；cursor 冻结、零写入）`);
    return EXIT.FAIL;
  }
  // native audit 侧车（⑨ 同族）：损坏 fail-loud；corpus 切换=高水位重置基线
  const aud = loadNativeAudit(storeRoot, ad.id);
  if (aud.problems) { console.error(`AUDIT_CORRUPT：${aud.problems.join('；')}——fail-loud（native 侧车完整性）`); return EXIT.FAIL; }
  const prevAudit = aud.audit;
  let corpusSwitch = false;
  if (prevAudit && prevAudit.corpus_id !== manifest.corpus_id) {
    corpusSwitch = true;
    console.log(`[AUDIT] corpus 切换（${ad.id}）：${prevAudit.corpus_id} → ${manifest.corpus_id}——高水位重置（全量重扫+event_id dedupe 幂等）`);
  }
  // 投影（缺必需字段→UNSUPPORTED_SOURCE）
  let proj;
  try { proj = ad.project(); }
  catch (e) {
    if (e.code === 'UNSUPPORTED_SOURCE') { console.error(e.message); return EXIT.UNSUPPORTED_SOURCE; }
    throw e;
  }
  // ③ model 维 unknown 超阈（>5%）
  const d = proj.dim.model;
  if (d.total > 0 && d.unknown / d.total > 0.05) {
    console.error(`UNSUPPORTED_SOURCE：model 维 unknown ${d.unknown}/${d.total}=${(d.unknown / d.total * 100).toFixed(1)}% >5%（${ad.id}）——cursor 冻结、零写入`);
    return EXIT.UNSUPPORTED_SOURCE;
  }
  // fingerprint 跨轮漂移（同 corpus 下行形态漂移）
  if (prevAudit && !corpusSwitch && typeof prevAudit.fingerprint === 'string' && prevAudit.fingerprint !== proj.fingerprint) {
    console.error(`UNSUPPORTED_SOURCE：schema fingerprint 跨轮漂移（${ad.id}）——cursor 冻结、零写入`);
    return EXIT.UNSUPPORTED_SOURCE;
  }

  const genDir = EE.genDirOf(storeRoot, EE.currentGeneration(storeRoot));
  const corpus = EE.loadCorpus(genDir, { adapterId: ad.id });
  let { cursor, corrupted, subtype } = EE.loadCursor(storeRoot, ad.id);
  if (corrupted) {
    const rb = EE.rebuildCursorFromSegments(storeRoot, sid, { nowIso, adapterId: ad.id });
    cursor = rb.cursor;
    writeJson(EE.cursorPath(storeRoot, ad.id), cursor);
    mkdirSync(quarantineDir, { recursive: true });
    writeJson(join(quarantineDir, `e2-rebuild-${ad.id}-${Date.now()}.json`), { detected: subtype, rebuilt_from_segments: rb.rebuiltFrom, rebuilt_at: nowIso });
    console.log(`[RECOVERY] ${ad.id} cursor ${subtype} 损坏→已从 segment manifests 重建（${rb.rebuiltFrom} 段）`);
  }
  // P1-8 同族：语料/cursor 在而 audit 缺失 → fail-loud
  if (!prevAudit && (corpus.events.length > 0 || cursor != null)) {
    console.error(`AUDIT_MISSING：${ad.id} 语料/cursor 已存在而 native audit 缺失（cursors/${ad.id}.audit.json）——fail-loud（拒绝静默重建基线）`);
    return EXIT.FAIL;
  }
  if (corpusSwitch) cursor = null;   // 高水位重置（dedupe 幂等收敛）

  // dedupe/upsert（append-only rev=1；contentKey 不变→no-op）
  const state0 = EE.entityState(corpus.events);
  const newEvents = [];
  let fresh = 0, unchanged = 0;
  for (const e of proj.events) {
    const prev = state0.get(e.entity_id);
    if (!prev) { e.source_revision = 1; fresh++; newEvents.push(e); continue; }
    if (projectionContentKey(prev.latest) === projectionContentKey(e)) { unchanged++; continue; }
    // append-only 行不可变：同实体内容变化=源漂移（截断/重写面）——integrity 已挡；此处防御性拒绝
    console.error(`SOURCE_REGRESSION：append-only 实体内容漂移（${e.entity_id}）——行不可变契约破坏`);
    return EXIT.FAIL;
  }
  for (const e of newEvents) e.event_id = `${e.entity_id}:${e.source_revision}`;

  const observed = {
    corpus_id: manifest.corpus_id, files_digest: sectionFilesDigest(ad.section),
    file_count: ad.section.eligible_files.length, fingerprint: proj.fingerprint,
    generation: EE.currentGeneration(storeRoot), updated_at: nowIso,
  };
  const cursorCommitted = new Set(cursor?.committed_segments ?? []);
  const pendingSegments = corpus.segments.filter(s => !cursorCommitted.has(s.file.replace(/\.jsonl$/, '')));
  if (newEvents.length === 0 && pendingSegments.length === 0) {
    writeNativeAudit(storeRoot, ad.id, observed);
    return { summary: { adapter: ad.id, noop: true, events_total: corpus.events.length, anomalies: proj.anomalies.length } };
  }

  // 高水位（裁决⑦：id=relpath#line 字典序全序；completed_at=该行事件时戳）
  let terminal = cursor?.terminal_cursor ?? { completed_at: null, id: null };
  for (const e of newEvents) {
    const cand = { completed_at: e.started_at, id: e.source_primary_key };
    if (EE.cursorAfter(terminal, cand, ad.id)) terminal = cand;
  }
  for (const s of pendingSegments) {
    const ca = s.manifest.cursor_after;
    if (ca && EE.cursorAfter(terminal, ca, ad.id)) terminal = { completed_at: ca.completed_at, id: ca.id };
  }
  const committed = [...(cursor?.committed_segments ?? []), ...corpus.segments.map(s => s.file.replace(/\.jsonl$/, ''))]
    .filter((v, i, a) => a.indexOf(v) === i);

  if (newEvents.length === 0) {
    // 纯收敛：cursor 原子重写（唯一提交点语义）
    const conv = EE.makeCursor({
      sourceInstanceId: sid, terminalCursor: terminal, scanLowerBound: manifest.time_range.from,
      openSet: [], committedSegments: committed, nowIso, adapterId: ad.id,
    });
    atomicWriteFile(EE.cursorPath(storeRoot, ad.id), JSON.stringify(conv, null, 2) + '\n');
    writeNativeAudit(storeRoot, ad.id, observed);
    return { summary: { adapter: ad.id, convergence_adopted_segments: pendingSegments.map(s => s.file.replace(/\.jsonl$/, '')), events_new: 0 } };
  }

  const nextSeq = EE.nextSegmentSeq(genDir);
  const newSegId = `seg-${String(nextSeq).padStart(4, '0')}`;
  const newCursor = EE.makeCursor({
    sourceInstanceId: sid, terminalCursor: terminal, scanLowerBound: manifest.time_range.from,
    openSet: [], committedSegments: [...committed, newSegId], nowIso, adapterId: ad.id,
  });
  const prebuilt = EE.buildSegmentManifest({ seq: nextSeq, events: newEvents, cursor: newCursor, nowIso, adapterId: ad.id });
  const mergedEvents = [...corpus.events, ...newEvents];
  const preErrs = [
    ...validateFixture({ fixture_kind: 'event-corpus', events: mergedEvents }),
    ...validateFixture({ fixture_kind: 'cursor-state', ...newCursor }),
    ...validateFixture({ fixture_kind: 'segment-manifest', ...prebuilt.manifest }),
  ];
  if (preErrs.length) {
    console.error(`PRODUCTION_VALIDATION_FAIL（pre-commit，零提交零 cursor 写）：\n${preErrs.map(e => `  ${e.rule} ${e.pointer} — ${e.message}`).join('\n')}`);
    return EXIT.FAIL;
  }
  const seg = await EE.commitSegment(storeRoot, { events: newEvents, cursor: newCursor, nowIso, explicitSeq: nextSeq, prebuilt, adapterId: ad.id });
  writeNativeAudit(storeRoot, ad.id, observed);
  return {
    summary: {
      adapter: ad.id, segment: seg.segId, segment_sha256: seg.sha256,
      events_new: newEvents.length, events_total: mergedEvents.length,
      terminal_cursor: newCursor.terminal_cursor,
      unknown_ratio: d.total ? +(d.unknown / d.total).toFixed(4) : 0,
      anomalies: proj.anomalies.length,
    },
    join: proj.joinMap ? { join_map: proj.joinMap, unattributed_children: proj.unattributedChildren } : null,
  };
}
