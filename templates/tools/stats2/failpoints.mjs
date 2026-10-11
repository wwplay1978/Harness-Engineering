// stats2/failpoints.mjs — F/E named failpoint 注入引擎（stats-1 failpoint-contract.md 冻结契约的实现面）
// 注入方式=等价持久化终态注入（终态声明，非过程模拟）：F 系=摆出崩溃后文件系统终态后 exit 70；
// E1:alive=不抢锁 exit 1；E1:dead/reuse=oracle 判定打破接管正常完成；E2a-d=损坏 cursor 后正常采集（重建收敛 exit 0）；
// E3=rebuild 中途崩溃（代指针未切，旧代完整）；E4=compaction 水位+引用保护交叉。
// once 语义：--failpoint-state 目录内标记文件记录已触发，重跑不带 --failpoint 不再触发。
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canon, sha256Hex } from './util.mjs';

export const CRASH_EXIT = 70;

// P1-6（2026-10-08 复审）对齐 failpoint-contract.md §2 冻结 API 面：
//   裸 F6 非法（契约只有 F6a/F6b 拆分形）；E2 子型仅 a-d。
// P2-10/E4 子型（2026-10-09 三审）：**裸 E1 非法**（契约 E1 注入位=锁竞争形态，子型 alive|dead|reuse 必填）；
//   E4 注入位=**E4:pre-switch**（压实新代段已写、代指针未切的等价终态——E4 主型为契约语义矩阵，非注入）。
const FP_RE = /^(F[1-5]|F6a|F6b|E2[abcd]|E3)$/;
const E1_SUB_RE = /^E1:(alive|dead|reuse)$/;
const E4_SUB_RE = /^E4:(pre-switch)$/;

export class FailpointUsageError extends Error {}

/** 解析 --failpoint 值：返回 {id, sub} 或 null。合法形：F1..F5|F6a|F6b|E1:alive|E1:dead|E1:reuse|E2a..d|E3|E4:pre-switch */
export function parseFailpoint(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (s === 'E1') {
    throw new FailpointUsageError('非法 failpoint：E1（裸 E1 拒绝——子型必填：E1:alive|E1:dead|E1:reuse，failpoint-contract.md §2/E1 锁记录形态冻结）');
  }
  if (s === 'E4') {
    throw new FailpointUsageError('非法 failpoint：E4（E4 主型=契约语义矩阵非注入；注入位=E4:pre-switch——压实新代段已写、代指针未切终态）');
  }
  let m = E4_SUB_RE.exec(s);
  if (m) return { id: 'E4', sub: 'pre-switch', raw };
  m = E1_SUB_RE.exec(s);
  if (m) return { id: 'E1', sub: m[1], raw };
  if (!FP_RE.test(s)) {
    throw new FailpointUsageError(`非法 failpoint：${raw}（契约形=F1..F5|F6a|F6b|E1:alive|E1:dead|E1:reuse|E2a..d|E3|E4:pre-switch——裸 F6/E1/E4 非法）`);
  }
  return { id: s, sub: null, raw };
}

/** P1-6：--failpoint 在场时 --failpoint-mode 必填且仅 once（failpoint-contract.md §2 全参数冻结）。 */
export function requireFailpointMode(flags) {
  if (typeof flags.failpoint !== 'string') return;
  if (flags['failpoint-mode'] !== 'once') {
    throw new FailpointUsageError(`--failpoint 须伴 --failpoint-mode once（failpoint-contract.md §2 冻结 API；实得 --failpoint-mode=${JSON.stringify(flags['failpoint-mode'])}）`);
  }
}

// P3-6（四审）：failpoint 命令承载表——合法字面若不由该命令承载=usage-error。
// 消除「接受但静默不触发」面（如 rebuild --failpoint F1 / collect --failpoint E3 曾被解析接受却永不触发）；
// 表=契约注入位的命令归属（failpoint-contract.md §2/§3/§4：F 系+E1/E2→collect、E3→rebuild、E4:pre-switch→compact）。
const FP_CARRIERS = {
  collect: { accept: fp => /^(F[1-5]|F6a|F6b|E1|E2[abcd])$/.test(fp.id), label: 'F1–F5|F6a|F6b|E1:alive|E1:dead|E1:reuse|E2a–E2d' },
  rebuild: { accept: fp => fp.id === 'E3', label: 'E3' },
  compact: { accept: fp => fp.id === 'E4' && fp.sub === 'pre-switch', label: 'E4:pre-switch' },
};

/** P3-6：承载表校验——返回 usage-error 消息或 null（fp=null 恒 null；非承载命令带 fp 一律拒收）。 */
export function failpointCarrierError(command, fp) {
  if (!fp) return null;
  const c = FP_CARRIERS[command];
  if (!c) return `命令 ${command} 不承载任何 failpoint（承载命令=collect/rebuild/compact——failpoint-contract.md §2）`;
  if (!c.accept(fp)) {
    return `failpoint ${fp.raw} 不由 ${command} 承载（${command} 仅承载 ${c.label}——承载表外合法字面亦拒收，防「接受但静默不触发」；failpoint-contract.md §2）`;
  }
  return null;
}

/** once 语义：state 目录标记。返回 True=本次应触发。
 *  P1-6：F/E 全系统一 once（契约 §2 注释「failpoint-state 记录已触发标记后自动失效」无 E 系豁免——
 *  E 注入为终态准备，once 标记在其终态摆出后写入，与 F 系语义同构）。 */
export function shouldFire(fp, stateDir) {
  if (!fp) return false;
  mkdirSync(stateDir, { recursive: true });
  const mark = join(stateDir, `${fp.id}${fp.sub ? '-' + fp.sub : ''}.fired`);
  if (existsSync(mark)) return false;
  return true;
}
export function markFired(fp, stateDir) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, `${fp.id}${fp.sub ? '-' + fp.sub : ''}.fired`), `${new Date().toISOString()}\n`, 'utf8');
}

/** E1 oracle fixture 装载：--process-liveness-oracle <file>（{alive:bool[,pid]}）；--process-start-token <file>（{token}）。 */
export function loadOracles(flags) {
  let liveness = null, startToken = null;
  if (flags['process-liveness-oracle']) {
    liveness = JSON.parse(readFileSync(String(flags['process-liveness-oracle']), 'utf8'));
  }
  if (flags['process-start-token']) {
    startToken = JSON.parse(readFileSync(String(flags['process-start-token']), 'utf8'));
  }
  return { liveness, startToken };
}

/** E2 四型 cursor 终态注入（在 collect 正常运行前摆出损坏形态）。 */
export function injectCursorCorruption(sub, cursorPath) {
  switch (sub) {
    case 'a': writeFileSync(cursorPath, '', 'utf8'); return 'E2a：cursor 置空';
    case 'b': truncateToHalf(cursorPath); return 'E2b：cursor JSON 截断';
    case 'c': breakChecksum(cursorPath); return 'E2c：payload_sha256 与载荷不符';
    case 'd': dangleCommitted(cursorPath); return 'E2d：committed_segments 指向不存在 segment';
    default: throw new Error(`E2 子型非法：${sub}`);
  }
}

function truncateToHalf(p) {
  const s = readFileSync(p, 'utf8');
  writeFileSync(p, s.slice(0, Math.floor(s.length / 2)), 'utf8');
}
function breakChecksum(p) {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  j.payload_sha256 = j.payload_sha256.slice(0, 62) + (j.payload_sha256.endsWith('00') ? '11' : '00');
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
}
function dangleCommitted(p) {
  // E2d：committed_segments 指向不存在 segment——改后**重算 payload_sha256**（否则校验和先红=恒报 E2c，审查 P2-5）
  const j = JSON.parse(readFileSync(p, 'utf8'));
  j.committed_segments = [...(j.committed_segments ?? []), 'seg-9999'];
  const { payload_sha256: _drop, ...body } = j;
  j.payload_sha256 = sha256Hex(canon(body));   // canonical=去本字段后键递归字典序无空白 JSON（gap-3 口径）
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
}

/** F 系终态摆出后退出（由 collect 提交链各钩位调用）。 */
export function crashExit(fp, stateDir, note) {
  markFired(fp, stateDir);
  console.log(`CRASH_INJECTED：${fp.raw}${note ? `——${note}` : ''}（终态已摆出，exit 70）`);
  process.exit(CRASH_EXIT);
}
