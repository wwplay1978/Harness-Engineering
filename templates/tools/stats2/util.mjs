// stats2/util.mjs — 公共件：canonical JSON / SHA-256 / 原子写 / fsync / RFC3339 / UUID
// 依据：docs/22 §5.4-4（提交链 fsync 纪律）、§5.5-④（cursor checksum canonical 口径=键递归字典序无空白）
// 零第三方依赖（node: 标准库）。
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, openSync, closeSync, renameSync, mkdirSync, fsyncSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const COLLECTOR_VERSION = 'harness-stats-0.2.0';

/** canonical JSON：键递归字典序、无空白（gap-3 冻结口径，cursor checksum 与聚合 SHA 复用）。 */
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

export const sha256Hex = data => createHash('sha256').update(data).digest('hex');
export const sha256File = path => sha256Hex(readFileSync(path));

export function fsyncDir(dir) {
  const fd = openSync(dir, 'r');            // Windows 上目录不可 fsync——以打开+close 尽力（平台差异注记）
  try { try { fsyncSync(fd); } catch { /* Win32 目录 fsync 不支持：ENOTSUP/EPERM 属平台常态 */ } }
  finally { closeSync(fd); }
}

/** 原子写：临时文件（同目录）→ fsync → rename 覆盖 → 父目录 fsync。Windows fsync 需写模式 fd。 */
export function atomicWriteFile(path, content) {
  const tmp = `${path}.tmp-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, content, 'utf8');
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

export function writeJson(path, obj) { atomicWriteFile(path, JSON.stringify(obj, null, 2) + '\n'); }

export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

/** RFC3339 UTC 规范形（秒位必填，Z 后缀；VR-S14 字形）。 */
export function rfc3339(ms = Date.now()) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseRfc3339(s) {
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new Error(`非法 RFC3339 时间戳：${s}`);
  return ms;
}

export const uuidv4 = () => randomUUID();

export function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

/** semver 比较：a≥b 返回 true（只取 major.minor.patch 前缀，忽略后缀）。 */
export function semverGte(a, b) {
  const pa = String(a).replace(/^[^0-9]*/, '').split(/[.-]/).map(Number);
  const pb = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
