// templates/tools/b3-redact-check.mjs — B3 脱敏检测器（独立可复用工具；docs/22 §6 + stats-4 票面交付物 3/D7）
// 用法：node b3-redact-check.mjs <工件路径…>
// 输出：stdout JSON {files:[{path,hits:[{pattern,excerpt_sha8}]}], total_hits}（files=有命中的文件，argv 序）
// 退出码：0 无命中 / 1 有命中 / 2 用法错（缺参/路径不存在/不可读/**非 utf8 可解码形态**——P2-3：
//   UTF-16LE/BE BOM 探测命中 → exit 2，检测器读不了的形态不得报干净）
// 检测族（票面 P2-4/P2-6 冻结+红队修复轮二 P2-2 扩族）：字面盘符/根路径形+大小写不敏感+分隔符变体
//   （C:\Users\、c:\users\、C:/Users/、混合分隔符——驱动器族统一标签 'C:\Users\'；/home/、/Users/
//   大小写不敏感）+ 真实用户名子串；~/ 展开形=白名单合法形，不入检测族。
// 合成 demo 形白名单（release-round-6 修复轮契约修订，planner 裁决登记）：检测意图=真实身份泄漏——
//   `C:/Users/demo`、`/home/demo` 系契约 fixture 约定合成形（票面授权保留）。路径段级判定：根族命中后
//   下一段恰为 demo（完整段含串尾，大小写不敏感）则不计 hit。demo=路径段白名单非用户名白名单——
//   真实用户名子串族不变（demo 旁出现真实用户名照常命中）。
// 真实用户名探测源=os.userInfo().username 进程内取值——不落盘不入日志；输出只承载命中计数与
// excerpt_sha8（命中片段 sha256 前 8 位）；用户名族 pattern 位输出标签 'real-username-substring'
// （禁明文用户名出现在本工具输出）。测试注入面=env B3_REDACT_PROBE_USERNAME（fixture 值证有牙，
// 非真实用户名；本 env 仅测试消费——生产调用不设置时恒走 os.userInfo()）。
// 发布票复用面（验收⑪）：本 CLI 形态/JSON 输出/退出码契约为冻结面；生产调用契约=相对名+cwd
// （path 位=argv 原样回显——绝对路径会携带用户档案路径成分，见 docs/changes/stats-4-d2-m2-operational.md §三）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';

const USAGE = '用法：node b3-redact-check.mjs <工件路径…>\n退出码：0 无命中 / 1 有命中 / 2 用法错（含非 utf8 可解码形态）';

// 驱动器族（P2-2）：c: + 分隔符 + users + 分隔符，大小写不敏感、正/反斜杠及混合分隔符均命中；
// 统一标签=规范形 'C:\Users\'（标签非用户身份面——可安全明示）
const DRIVE_LABEL = 'C:\\Users\\';
const DRIVE_RE = /c:[\\/]+users[\\/]+/gi;
// posix 根族：大小写不敏感（/HOME/、/users/ 等同命中）；标签=规范形
const POSIX_FAMILIES = [
  { label: '/home/', re: /\/home\//gi },
  { label: '/Users/', re: /\/users\//gi },
];
const USERNAME_LABEL = 'real-username-substring';
// 合成 demo 段判定：根族命中区间之后紧跟完整 demo 段（demo 后是路径分隔符/换行/文本结束），
// 大小写不敏感——行尾 demo（多行工件）同为完整段；demo.txt/demox 等非完整段不豁免
const DEMO_SEGMENT_RE = /^demo(?:[\\/]|[\r\n]|$)/i;

function probeUsername() {
  const injected = process.env.B3_REDACT_PROBE_USERNAME;
  if (injected !== undefined) return String(injected);
  try { return String(userInfo().username ?? ''); } catch { return ''; }
}

const sha8Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);

function scanFile(path, username) {
  const buf = readFileSync(path);
  // P2-3：BOM 探测——UTF-16LE/BE 非 utf8 可解码形态（PowerShell `>` 重定向典型产物）→ 用法族 fail-loud
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    console.error(`ENCODING_UNSUPPORTED：${path} 为 UTF-16LE（BOM FF FE）——检测器读不了的形态不得报干净（转存 UTF-8 后复检）\n${USAGE}`);
    process.exit(2);
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    console.error(`ENCODING_UNSUPPORTED：${path} 为 UTF-16BE（BOM FE FF）——检测器读不了的形态不得报干净（转存 UTF-8 后复检）\n${USAGE}`);
    process.exit(2);
  }
  const text = buf.toString('utf8');
  const hits = [];
  // 驱动器族先行（更特异）：记录覆盖区间——posix /Users/ 族在同区间不重复计（C:/Users/ 一处命中一次）
  const covered = [];
  for (const m of text.matchAll(DRIVE_RE)) {
    if (DEMO_SEGMENT_RE.test(text.slice(m.index + m[0].length))) continue;   // 合成 demo 段——白名单不计
    hits.push({ pattern: DRIVE_LABEL, excerpt_sha8: sha8Hex(m[0]) });
    covered.push([m.index, m.index + m[0].length]);
  }
  for (const fam of POSIX_FAMILIES) {
    for (const m of text.matchAll(fam.re)) {
      const inDrive = covered.some(([s, e]) => m.index >= s && m.index < e);
      if (inDrive) continue;   // 驱动器形已计（避免同位置双计）
      if (DEMO_SEGMENT_RE.test(text.slice(m.index + m[0].length))) continue; // 合成 demo 段——白名单不计
      hits.push({ pattern: fam.label, excerpt_sha8: sha8Hex(m[0]) });
    }
  }
  if (username.length >= 2) {
    const lower = text.toLowerCase();
    const needle = username.toLowerCase();
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) {
      // excerpt=原文命中片段（大小写保真）——仅以哈希出仓
      hits.push({ pattern: USERNAME_LABEL, excerpt_sha8: sha8Hex(text.slice(i, i + needle.length)) });
    }
  }
  return hits;
}

const args = process.argv.slice(2);
if (args.length === 0) { console.error(USAGE); process.exit(2); }
const username = probeUsername();
const files = [];
let total = 0;
for (const p of args) {
  if (!existsSync(p) || !statSync(p).isFile()) { console.error(`路径不存在或非文件：${p}\n${USAGE}`); process.exit(2); }
  let hits;
  try { hits = scanFile(p, username); }
  catch (e) { console.error(`不可读：${p}（${e.message}）\n${USAGE}`); process.exit(2); }
  if (hits.length > 0) { files.push({ path: p, hits }); total += hits.length; }
}
console.log(JSON.stringify({ files, total_hits: total }));
process.exit(total > 0 ? 1 : 0);
