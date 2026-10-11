// stats2/store.mjs — 事件仓根：布局 / ACL preflight / config 原子首启 / projects 注册表 /
// 排它锁（E1 三字段）/ TEMP 专用父目录与启动清扫（P1-5 所有权协议）
// 依据：docs/22 §5.1（布局+ACL 创建时校验）、§5.7（source_instance_id/project_id 稳定身份）、
//       §6（ACL 不满足 exit≠0）、§5.4-6 E1（锁三字段）；审查报告 P0-5/P1-4/P1-5。
//
// ACL 判定矩阵（票面：Windows/Linux 权限判定矩阵，UNVERIFIED 项待 fixture 证据）：
// | 平台     | 判定机制                                  | 证据状态                         |
// | Windows  | PowerShell Get-Acl SDDL 解析：allow-ACE   | VERIFIED（fixture：icacls 授    |
// |          | 主体 ⊆ 允许集（见下）；探针不可执行 →     | Users 组全权 → preflight 拒绝） |
// |          | ACL_UNVERIFIABLE fail-closed              |                                  |
// | Linux    | stat.mode 的 group/other 位（& 0o077）   | UNVERIFIED（实现+fixture 在档， |
// |          | 须为 0                                    | 本机无 Linux 环境，证据待补）    |
// Windows 允许集=当前用户 SID + SYSTEM(SY/S-1-5-18) + Administrators(BA/S-1-5-32-544)
//   + CreatorOwner(CO/S-1-3-0) + app-container/能力 SID（S-1-15-2-*/S-1-15-3-*——Windows 对
//   用户档案目录的 OS 默认只读授权，系沙箱化应用身份而非交互主体；排除它们将令任何档案位目录
//   （含真实 ~/.agents）一律不可用）。拒绝任何其他主体——尤其 BUILTIN\Users(S-1-5-32-545)、
//   Everyone(S-1-1-0)、Guests、异用户 S-1-5-21-*。
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, writeSync, unlinkSync,
  renameSync, openSync, closeSync, fsyncSync, statSync, rmSync, lstatSync, realpathSync, chmodSync,
} from 'node:fs';
import { join, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureDir, writeJson, readJson, rfc3339, uuidv4, fsyncDir, COLLECTOR_VERSION } from './util.mjs';

export const STORE_DIRS = ['events', 'reports', 'snapshots', 'cursors', 'locks', 'quarantine', 'tmp'];
export const TMP_PREFIX = 'hstats-';
export const LOCK_STALE_MS = 120_000;   // 心跳超 120s（无 oracle 时）视为 stale
export const LOCK_HEARTBEAT_FRESH_MS = 120_000;
/** 统一排它锁名（P0-2：collect/rebuild/compact/prune 四命令共用——§5.4-8/E4）。 */
export const MUTATION_LOCK = 'store-mutation';

// ── ACL/加固子进程沙盒（P0-3，2026-10-08 复审实锤）─────────────────────
// 根因：PowerShell 子进程未设 cwd/env——启动器（WinRT 缓存初始化等）以父进程 cwd 解析
// %SystemDrive% 字面量相对路径，在两个 git 检出创建了 `%SystemDrive%/ProgramData/.../Caches/*.db`。
// 修复：受控 cwd（os.tmpdir 专用子目录）+ 显式 env 白名单——任何相对路径落物被圈进沙盒目录，
// 白名单外环境变量（含 ProgramData/USERPROFILE 等）不再透传。
const SPAWN_ENV_KEYS = ['SystemRoot', 'windir', 'PATH', 'PATHEXT', 'TEMP', 'TMP'];
function sandboxedSpawnOpts() {
  const cwd = join(tmpdir(), 'hstats-spawn');
  mkdirSync(cwd, { recursive: true });
  const env = {};
  for (const k of SPAWN_ENV_KEYS) { const v = process.env[k]; if (v !== undefined) env[k] = v; }
  return { encoding: 'utf8', timeout: 30_000, cwd, env };
}

/** 本进程唯一起始令牌（E1 复用判定/TEMP 所有权共用；进程生命周期内恒定）。 */
export const PROCESS_START_TOKEN = randomUUID();

// ── ACL preflight（Windows SDDL / Linux mode） ────────────────────
function windowsAclVerdicts(paths) {
  // 单次 PowerShell 调用批量取 SDDL（每路径一次 Get-Acl；输出 PATH:…/SDDL:… 成对行）
  const quoted = paths.map(p => `'${String(p).replaceAll("'", "''")}'`);
  const ps =
    `$ErrorActionPreference='Stop';` +
    `'SID=' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;` +
    `@(${quoted.join(',')}) | ForEach-Object { 'PATH=' + $_; 'SDDL=' + (Get-Acl -LiteralPath $_).Sddl }`;
  let r;
  try {
    r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], sandboxedSpawnOpts());
  } catch (e) {
    return paths.map(p => ({ path: p, ok: false, reason: `ACL_UNVERIFIABLE：PowerShell 探针不可执行（${e.message}）` }));
  }
  if (r.status !== 0 || !r.stdout) {
    return paths.map(p => ({ path: p, ok: false, reason: `ACL_UNVERIFIABLE：PowerShell 探针失败（${(r.stderr || r.error || '').toString().slice(0, 200)}）` }));
  }
  const sid = /^SID=(S-[\d-]+)\s*$/m.exec(r.stdout)?.[1];
  if (!sid) return paths.map(p => ({ path: p, ok: false, reason: 'ACL_UNVERIFIABLE：探针输出缺当前用户 SID（fail-closed）' }));
  const allowed = principal =>
    principal === sid || ['SY', 'BA', 'CO', 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-0'].includes(principal)
    || principal.startsWith('S-1-15-2-') || principal.startsWith('S-1-15-3-');
  const byPath = new Map(paths.map(p => [p, { path: p, ok: true }]));
  const blocks = r.stdout.split(/^PATH=/m).slice(1);
  for (const b of blocks) {
    const path = b.split(/\r?\n/)[0].trim();
    const sddl = /^SDDL=(.*)$/m.exec(b)?.[1];
    if (!sddl) { byPath.set(path, { path, ok: false, reason: 'ACL_UNVERIFIABLE：SDDL 不可解析（fail-closed）' }); continue; }
    // 只审 allow-ACE（ace_type=A）的主体；deny-ACE 属收紧方向不阻断
    const wide = [];
    for (const m of sddl.matchAll(/\(A;[^()]*?;;;([^()]*)\)/g)) {
      const principal = m[1].trim();
      if (principal === '') continue;               // 空主体=特定对象 ACE，无通用授权面
      if (!allowed(principal)) wide.push(principal);
    }
    byPath.set(path, wide.length
      ? { path, ok: false, reason: `ACL_PREFLIGHT_FAIL：${path} 存在宽授权主体 ${wide.join(', ')}（允许集=当前用户/SYSTEM/Administrators/CreatorOwner/app-container）` }
      : { path, ok: true });
  }
  return paths.map(p => byPath.get(p) ?? { path: p, ok: false, reason: `ACL_UNVERIFIABLE：探针未覆盖 ${p}（fail-closed）` });
}

function linuxAclVerdict(path) {
  const mode = statSync(path).mode;
  if (mode & 0o077) return { ok: false, reason: `ACL_PREFLIGHT_FAIL：${path} group/other 权限位非零（mode=${(mode & 0o777).toString(8)}）——UNVERIFIED 矩阵项的 Linux 实现面` };
  return { ok: true };
}

/** 批量 ACL 判定（任何持久化写入前调用；不满足即由调用方 exit≠0）。 */
export function aclPreflightBatch(paths) {
  if (process.platform === 'win32') {
    const exists2 = paths.filter(existsSync);
    const verdicts = windowsAclVerdicts(exists2);
    const byPath = new Map(verdicts.map(v => [v.path, v]));
    return paths.map(p => byPath.get(p) ?? { path: p, ok: true, note: '不存在——创建后复核' });
  }
  return paths.map(p => existsSync(p) ? linuxAclVerdict(p) : { path: p, ok: true, note: '不存在——创建后复核' });
}

export function aclPreflight(path) { return aclPreflightBatch([path])[0]; }

/** 新建目录的创建时加固（§5.1「目录创建时校验仅当前用户可访问」的执行面）：
 *  Windows=断继承+显式 DACL（当前用户/SYSTEM/Administrators 各 F，OI|CI）；Linux=chmod 0700。
 *  只作用于本工具新建的目录；已存在目录一律不动（宽权限=拒绝，见 preflight）。 */
export function hardenNewDir(path) {
  if (process.platform === 'win32') {
    const ps =
      `$ErrorActionPreference='Stop';` +
      `$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;` +
      `$acl=Get-Acl -LiteralPath '${String(path).replaceAll("'", "''")}';` +
      `$acl.SetAccessRuleProtection($true,$false);` +
      `$sid=New-Object System.Security.Principal.SecurityIdentifier($me);` +
      `$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));` +
      `foreach($n in @('NT AUTHORITY\\SYSTEM','BUILTIN\\Administrators')){` +
      `$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($n,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))};` +
      `Set-Acl -LiteralPath '${String(path).replaceAll("'", "''")}' $acl`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { ...sandboxedSpawnOpts(), timeout: 20_000 });
    if (r.status !== 0) return { ok: false, reason: `ACL_HARDEN_FAIL：新建目录 DACL 加固失败（${String(r.stderr || r.error || '').slice(0, 160)}）` };
    return { ok: true };
  }
  try { chmodSync(path, 0o700); return { ok: true }; }
  catch (e) { return { ok: false, reason: `ACL_HARDEN_FAIL：chmod 0700 失败（${e.message}）` }; }
}

/** 全仓 preflight（全路径单批探针）：第一遍只判已存在路径（零新增拒绝面）；
 *  第二遍建缺失路径（仓根新建即加固断继承）后单批复核。 */
export function ensureStoreLayout(root) {
  const checks = [];
  const subDirs = () => STORE_DIRS.map(d => join(root, d));
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
    const h = hardenNewDir(root);
    checks.push({ path: root, ...h });
    if (!h.ok) return checks;
  } else {
    // 第一遍：已存在路径单批判定——任一宽权限即拒绝，此时零新增文件（已存在目录不改动：只拒绝）
    const existing = [root, ...subDirs()].filter(existsSync);
    for (const v of aclPreflightBatch(existing)) {
      checks.push(v);
      if (!v.ok) return checks;
    }
  }
  // 第二遍：创建缺失子目录（继承仓根 DACL；recursive+双检=并发首启安全）后单批复核
  const created = [];
  for (const p of subDirs()) {
    if (!existsSync(p)) { mkdirSync(p, { recursive: true }); created.push(p); }
  }
  if (created.length > 0) {
    for (const v of aclPreflightBatch(created)) {
      checks.push(v);
      if (!v.ok) return checks;   // 首个失败即止——不再判定后续
    }
  }
  return checks;
}

// ── config.json：source_instance_id 原子首启 ──────────────────────
export function configPath(root) { return join(root, 'config.json'); }
export function projectsPath(root) { return join(root, 'projects.json'); }

function validUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v); }

function readConfigIfValid(root) {
  const p = configPath(root);
  if (!existsSync(p)) return null;
  try {
    const cfg = readJson(p);
    return validUuid(cfg.source_instance_id) ? cfg : null;
  } catch { return null; }
}

/**
 * 幂等首启：已存在→读；否则在 init 排它锁内 原子写（tmp+fsync+rename）。
 * 并发首启：后到者等待锁内完成方写出的 config（唯一 UUID）；注入 UUID 仅在首建时生效。
 * @returns {{config: object, created: boolean}}
 */
export function ensureConfig(root, { injectedId = null, nowIso } = {}) {
  const existing = readConfigIfValid(root);
  if (existing) return { config: existing, created: false };
  const lockPath = join(root, 'locks', 'init.lock');
  withExclusiveLock(lockPath, () => {
    const again = readConfigIfValid(root);
    if (again) return again;   // 双检：锁内他方已完成
    const cfg = {
      schema_version: 1,
      source_instance_id: (injectedId && validUuid(injectedId)) ? injectedId : uuidv4(),
      created_at: nowIso ?? rfc3339(),
      collector_version: COLLECTOR_VERSION,
    };
    writeJson(configPath(root), cfg);
    return cfg;
  }, { pollFor: 'config' });
  const final = readConfigIfValid(root);
  if (!final) throw new Error('config.json 首启失败（锁协议后仍不可读）');
  return { config: final, created: !existing };
}

// ── 排它锁（§5.4-6 E1：PID+心跳时间+process-start token 三字段） ──
export function lockRecord(root, name) {
  return {
    pid: process.pid,
    heartbeat_at: rfc3339(),
    process_start_token: PROCESS_START_TOKEN,
  };
}

/** stale 打破成功后的己锁复读延迟（P2-4 四审对称收口）：并发 stale 打破者 B 的
 *  「unlink 本方新锁→重建己锁」竞态半窗（本方读 stale 记录与 B 覆写之间）由此收口——
 *  短延迟后复读，token 不符=他人已重建→本方弃锁。延迟窗外的残余（复读后才被覆写）
 *  由首个 guardedRefreshHeartbeat 所有权校验兜底（防御纵深，非零窗承诺）。测试可注入更大值。 */
export const LOCK_REREAD_DELAY_MS = 50;

export function acquireLock(root, name, { livenessOracle = null, startTokenOracle = null, nowMs = Date.now(), rereadDelayMs = LOCK_REREAD_DELAY_MS } = {}) {
  const lockPath = join(root, 'locks', `${name}.lock`);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 同 fd 写入（审查 P2-12）：O_EXCL 创建即在 fd 上写记录——消除「空锁文件被并发方读为损坏→误判 stale」窗口
      const fd = openSync(lockPath, 'wx');
      try { writeSync(fd, JSON.stringify(lockRecord(root, name), null, 2) + '\n', 0, 'utf8'); }
      finally { closeSync(fd); }
      if (attempt > 0) {
        // P2-4（四审）对称收口：stale 打破路径上并发打破者 B 可能在本方 create 之后
        // unlink 本方新锁并重建 B 锁（refreshHeartbeat 的写后复读只覆盖本方写之后的半窗，
        // 不覆盖「B 建立在本方读与写之间」的覆写半窗）→ 短延迟复读己锁：token 不符/不可读
        // = 他人已重建 → 本方弃锁中止（releaseLock 对异 token 恒 no-op——不误删他方锁）。
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, rereadDelayMs);
        let mine = null;
        try { mine = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* 不可读=不可判定所有权 */ }
        if (!mine || typeof mine !== 'object' || mine.process_start_token !== PROCESS_START_TOKEN) {
          releaseLock(root, name);
          return { held: false, lockPath, reason: 'LOCK_RACE_LOST：stale 打破后复读发现锁已非本进程（并发打破者已重建己锁）——本方弃锁（P2-4 对称收口；至多一写者）' };
        }
      }
      return { held: true, lockPath, staleBroken: attempt > 0 };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // 锁存在 → 判 stale（E1：oracle 优先；无 oracle=心跳新鲜度 + kill-0 存活探测）
      let rec = null;
      try { rec = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { /* 损坏锁视作 stale */ }
      const decision = staleDecision(rec, { livenessOracle, startTokenOracle, nowMs });
      if (!decision.stale) return { held: false, lockPath, reason: decision.reason, record: rec };
      try { unlinkSync(lockPath); } catch { /* 竞态：他方已清 */ }
    }
  }
  return { held: false, lockPath, reason: '锁反复 stale 未能量产接管（重试上限）' };
}

function staleDecision(rec, { livenessOracle, startTokenOracle, nowMs }) {
  if (!rec || typeof rec !== 'object' || !rec.process_start_token || !rec.heartbeat_at) {
    return { stale: true, reason: '锁记录缺失三字段要素（损坏/陈旧格式）' };
  }
  const pidAlive = livenessOracle ? livenessOracle.alive === true : nativePidAlive(rec.pid);
  let tokenMatch = true;
  if (startTokenOracle) {
    tokenMatch = String(startTokenOracle.token) === String(rec.process_start_token);
  }
  // oracle 在场=权威判定（E1 契约：fixture 代行，不做年龄推断）；无 oracle=心跳新鲜度+kill-0
  if (livenessOracle) {
    if (!pidAlive) return { stale: true, reason: `E1:dead——oracle 判 PID ${rec.pid} 不存活` };
    if (!tokenMatch) return { stale: true, reason: `E1:reuse——PID ${rec.pid} 存活但 process-start token 不匹配（复用）` };
    return { stale: false, reason: `锁活跃（oracle：PID 存活+token 匹配）` };
  }
  if (!pidAlive) return { stale: true, reason: `E1:dead——PID ${rec.pid} 不存活（kill-0 探测）` };
  const age = nowMs - Date.parse(rec.heartbeat_at);
  if (Number.isFinite(age) && age > LOCK_STALE_MS) return { stale: true, reason: `心跳超时（${Math.round(age / 1000)}s > ${LOCK_STALE_MS / 1000}s）` };
  return { stale: false, reason: `锁活跃（pid=${rec.pid}，心跳新鲜）` };
}

function nativePidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** 持锁方周期刷心跳（P1-4：分块处理间调用——长任务不因超 120s 被误判 stale）。nowIso 供测试注入。
 *  P0-2（2026-10-09 三审）所有权校验：刷写前读锁记录并核对 process_start_token===本进程——
 *  不匹配（已被接管）/锁文件缺失/记录不可读 ⇒ **不覆写锁**，返回 {ok:false, reason}；
 *  调用方（guardedRefreshHeartbeat/各命令）据此立即中止当前工作（安全退出非零、不提交）。
 *  写后复读复核：若复核 token 非本进程（写与复核的微窗内被他方接管），同样报 not-ok——
 *  残余微竞态（read-check-write 非原子）在此收口为 fail-loud 而非静默双写。 */
export function refreshHeartbeat(root, name, { nowIso } = {}) {
  const lockPath = join(root, 'locks', `${name}.lock`);
  let rec = null;
  try { rec = JSON.parse(readFileSync(lockPath, 'utf8')); }
  catch { return { ok: false, reason: '锁文件不存在或记录不可读（可能已被接管/移除）——不覆写' }; }
  if (!rec || typeof rec !== 'object' || rec.process_start_token !== PROCESS_START_TOKEN) {
    const holder = rec && typeof rec.process_start_token === 'string' ? String(rec.process_start_token).slice(0, 8) : 'unknown';
    return { ok: false, reason: `锁已被接管（持有 token=${holder}… ≠ 本进程）——不覆写、须立即中止（至多一写者）` };
  }
  const next = lockRecord(root, name);
  if (nowIso) next.heartbeat_at = nowIso;
  writeJson(lockPath, next);
  try {
    const verify = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!verify || verify.process_start_token !== PROCESS_START_TOKEN) {
      return { ok: false, reason: '写后复核发现锁记录已非本进程（刷新窗内被接管）——不覆写、须立即中止' };
    }
  } catch { return { ok: false, reason: '写后复核锁记录不可读——须立即中止' }; }
  return { ok: true };
}

/** 锁被接管（心跳刷新失败）——调用方须立即中止：不覆写锁、不提交、安全退出非零（P0-2）。 */
export class LockTakeoverError extends Error {}

/** 守卫形心跳刷新（P0-2 全程心跳配套）：not-ok 即抛 LockTakeoverError——
 *  collect/rebuild/compact/prune 在长相位间/提交前统一经此刷新；异常由命令层转 exit≠0。 */
export function guardedRefreshHeartbeat(root, name, opts = {}) {
  const r = refreshHeartbeat(root, name, opts);
  if (!r.ok) throw new LockTakeoverError(`LOCK_TAKEOVER：${r.reason}（P0-2 所有权校验）`);
  return true;
}

/** 释放锁——仅所有者（process_start_token 匹配）可释放（P1-4）：
 *  非所有者锁/损坏锁一律不动（他方持有或状态不可判定；stale 打破由 acquireLock 协议承担）。
 *  @returns {boolean} 是否实际删除了本进程持有的锁文件 */
export function releaseLock(root, name) {
  const lockPath = join(root, 'locks', `${name}.lock`);
  let rec = null;
  try { rec = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { return false; /* 不存在或不可判定：不删 */ }
  if (!rec || typeof rec !== 'object' || rec.process_start_token !== PROCESS_START_TOKEN) return false;
  try { unlinkSync(lockPath); return true; } catch { return false; }
}

/** init 锁内执行 fn；fn 抛错传播。pollFor 模式：拿不到锁时轮询 config.json 出现（并发首启收敛）。 */
function withExclusiveLock(lockPath, fn, { pollFor } = {}) {
  const rootDir = dirname(lockPath);
  try {
    const fd = openSync(lockPath, 'wx');
    closeSync(fd);
    try { return fn(); } finally { try { unlinkSync(lockPath); } catch { /* 竞态豁免 */ } }
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  // 锁被他方持有 → 轮询等待产物出现（上限 10s；超时后按 stale 打破重试一轮）
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (pollFor === 'config' && readConfigIfValid(rootDir)) return null;
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } catch { /* 非 worker 环境兜底 */ }
  }
  try { unlinkSync(lockPath); } catch { /* 仍在：下一轮 O_EXCL 失败再走 stale 判定 */ }
  const fd = openSync(lockPath, 'wx');
  closeSync(fd);
  try { return fn(); } finally { try { unlinkSync(lockPath); } catch { /* 竞态豁免 */ } }
}

// ── projects.json：注册表（project_id 稳定身份；路径仅别名） ───────
export function normalizePathKey(p) {
  return String(p).replaceAll('\\', '/').replaceAll('/', '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * 注册/改名：按 project_id 或已登记别名匹配——路径大小写/斜杠/移位不换身份，仅追加别名史；
 * 新项目方新建实体。返回更新后的 projects.json 对象。
 */
export function registerProject(root, displayName, projectPath, { nowIso } = {}) {
  const ppath = projectsPath(root);
  let data = existsSync(ppath) ? readJson(ppath) : { schema_version: 1, projects: [] };
  if (!Array.isArray(data.projects)) data.projects = [];
  const pid = displayName.toLowerCase();
  const norm = normalizePathKey(projectPath);
  let proj = data.projects.find(p => p.project_id === pid) ?? data.projects.find(p => (p.aliases ?? []).includes(norm));
  const at = nowIso ?? rfc3339();
  if (!proj) {
    proj = {
      project_id: pid,
      display_name: displayName,
      active: true,
      registered_at: at,
      aliases: [norm],
      alias_history: [{ path: projectPath, normalized: norm, recorded_at: at }],
    };
    data.projects.push(proj);
  } else {
    // 别名史记录原始形态（大小写/斜杠照录）；规范化键去重（同键不同写法=同一路径）
    if (!(proj.aliases ?? []).includes(norm)) proj.aliases.push(norm);
    if (!(proj.alias_history ?? []).some(h => h.path === projectPath)) {
      proj.alias_history.push({ path: projectPath, normalized: norm, recorded_at: at });
    }
  }
  writeJson(ppath, data);
  return data;
}

// ── TEMP 专用父目录 + 启动清扫（P1-5：所有权/containment/reparse 防护） ──
export function tmpRoot(root) { return join(root, 'tmp'); }

/** 创建受管 TEMP 目录：专用父目录下固定前缀 + OWNER.json（创建时间+process-start token+pid）。 */
export function makeOwnedTempDir(root, purpose = 'work') {
  const parent = ensureDir(tmpRoot(root));
  for (;;) {
    const dir = join(parent, `${TMP_PREFIX}${purpose}-${randomUUID().slice(0, 8)}`);
    if (!existsSync(dir)) {
      mkdirSync(dir);
      writeJson(join(dir, 'OWNER.json'), {
        process_start_token: PROCESS_START_TOKEN,
        pid: process.pid,
        created_at: rfc3339(),
        purpose,
      });
      return dir;
    }
  }
}

function activeLockTokens(root, { nowMs = Date.now() } = {}) {
  const tokens = new Set([PROCESS_START_TOKEN]);
  const locksDir = join(root, 'locks');
  if (!existsSync(locksDir)) return tokens;
  for (const f of readdirSync(locksDir)) {
    if (!f.endsWith('.lock')) continue;
    try {
      const rec = JSON.parse(readFileSync(join(locksDir, f), 'utf8'));
      if (!rec.heartbeat_at) continue;
      if (nowMs - Date.parse(rec.heartbeat_at) < LOCK_HEARTBEAT_FRESH_MS) tokens.add(String(rec.process_start_token));
    } catch { /* 损坏锁记录不计活跃 */ }
  }
  return tokens;
}

/**
 * 启动清扫：只碰专用父目录内本工具前缀（hstats-*）目录；
 * - 无 OWNER/异 token 且无活跃锁 → 陈旧 → 删（先做绝对路径 containment + reparse/symlink 防护）
 * - 活跃 token（本进程或新鲜心跳锁持有）→ 不删
 * - 非 hstats- 前缀相邻目录 → 永不触碰
 * 返回报告行数组（调用方打印）；单目录删除失败仅报告不阻断。
 */
export function sweepTempDirs(root, { nowMs = Date.now() } = {}) {
  const reports = [];
  const parent = tmpRoot(root);
  if (!existsSync(parent)) return reports;
  const parentReal = realpathSync(parent);
  const active = activeLockTokens(root, { nowMs });
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const dir = join(parent, name);
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) { reports.push(`TEMP-SWEEP-SKIP ${name}：reparse/symlink 防护——不跟随不删除`); continue; }
    let rec = null;
    try { rec = JSON.parse(readFileSync(join(dir, 'OWNER.json'), 'utf8')); } catch { /* 无/坏 owner */ }
    if (rec?.process_start_token && active.has(String(rec.process_start_token))) {
      reports.push(`TEMP-SWEEP-KEEP ${name}：token 活跃（owner 进程在运行）`);
      continue;
    }
    // containment：realpath 必须仍在专用父目录内（防越界删除）
    let real;
    try { real = realpathSync(dir); } catch { reports.push(`TEMP-SWEEP-SKIP ${name}：realpath 解析失败（防护性跳过）`); continue; }
    if (!(real === parentReal || real.startsWith(parentReal + sep))) {
      reports.push(`TEMP-SWEEP-SKIP ${name}：绝对路径越出专用父目录（containment 拒绝删除）`);
      continue;
    }
    if (!rec && Date.now() - st.mtimeMs < 60_000) { reports.push(`TEMP-SWEEP-KEEP ${name}：无 OWNER 且新鲜（他进程中途创建，宽限）`); continue; }
    try { rmSync(dir, { recursive: true, force: true }); reports.push(`TEMP-SWEEP-REMOVED ${name}${rec ? `（token=${String(rec.process_start_token).slice(0, 8)}… 无活跃锁）` : '（无 OWNER 陈旧目录）'}`); }
    catch (e) { reports.push(`TEMP-SWEEP-FAIL ${name}：${e.message}（下轮启动重试）`); }
  }
  return reports;
}
