// templates/tools/privacy-fullscan.mjs — 全量公开面 B3 扫描（public-repo-privacy-purge 票交付物 2；验收②④）
// 用法：node privacy-fullscan.mjs（cwd=仓根，零参数——扫描面票面冻结）
// 扫描面：templates/ 全树 + docs/ 可公开子集 12 文件（00/02/03/04/07/15/16/17/20/21/22/23）；
//   docs 非公开面（05/06/08-14/changes/reviews/tickets/metrics/memory 等）不在扫描面（票面红线）。
// 输出：stdout JSON {scanned_files, files, exempted, total_hits, total_exempted}——files=有真实命中的文件
//   （path=相对 posix 路位，输出零绝对路径=零用户档案路径成分，b3 契约同款纪律）；exempted=豁免登记面
//   （逐次出现：path+pattern+excerpt_sha8+reason——段级合成形白名单+文件级检测器工件登记，保持可复核）。
// 退出码：0 全量零命中 / 1 有命中 / 2 用法错（templates/ 缺失、12 公开文档任一缺失、不可读、
//   非 utf8 可解码形态——检测器读不了的形态/面不完整不得报干净，fail-loud）。
// 检测族=B3 冻结族（templates/tools/b3-redact-check.mjs 同源）：字面盘符/根路径形（c:\Users\、C:/Users/、
//   混合分隔符，大小写不敏感；/home/、/Users/ 大小写不敏感）+ 真实用户名子串；~/ 展开形=白名单合法形。
// 豁免登记面（全部计入 exempted 输出——保持可复核，非静默）：
//   - 段级合成形白名单：demo 段（B3 契约 fixture 约定，完整段边界）；you 段（适配器安装指引示例形
//     C:/Users/you——第二人称合成代词，完整段边界）；尖括号占位符段 `<你的用户名>`/`<真实用户名>`/
//     `<Chinese name>` 等（仓内既有占位符约定——`<`/`>` 为 Windows 文件名非法字符，全角包裹完整段
//     不可能是真实身份段；段内不含尖括号/路径分隔符）；
//   - 文件级检测器工件登记：b3-redact-check.mjs（B3 检测器源码——模式字面量必然自含）、
//     sync-harness.mjs（机器锚点扫描检测器源码）、privacy-fullscan.mjs（本脚本自扫描）。
// 真实用户名探测源=os.userInfo().username 进程内取值——不落盘不入日志；测试注入面=env
//   B3_REDACT_PROBE_USERNAME（fixture 值证有牙，非真实用户名）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';

const USAGE = '用法：node privacy-fullscan.mjs（cwd=仓根，零参数）\n退出码：0 全量零命中 / 1 有命中 / 2 用法错（扫描面不完整/不可读/非 utf8 可解码形态）';

// 公开面 12 文档（票面冻结清单）
const PUBLIC_DOCS = [
  'docs/00-index.md', 'docs/02-team-core.md', 'docs/03-memory-hindsight-obsidian.md',
  'docs/04-eval-observability.md', 'docs/07-migration-playbook.md', 'docs/15-toolchain-portability.md',
  'docs/16-host-agnostic-installer.md', 'docs/17-agent-assisted-install.md', 'docs/20-autonomous-merge.md',
  'docs/21-memory-system-analysis.md', 'docs/22-effectiveness-statistics.md', 'docs/23-harness-stats-usage.md',
];

// —— B3 冻结族（b3-redact-check.mjs 同源复刻，标签/语义零漂移）——
const DRIVE_LABEL = 'C:\\Users\\';
const DRIVE_RE = /c:[\\/]+users[\\/]+/gi;
const POSIX_FAMILIES = [
  { label: '/home/', re: /\/home\//gi },
  { label: '/Users/', re: /\/users\//gi },
];
const USERNAME_LABEL = 'real-username-substring';
const DEMO_SEGMENT_RE = /^demo(?:[\\/]|[\r\n]|$)/i;
// 段级合成形扩展（全量面登记豁免——非 B3 冻结面变更：demo 系 B3 契约继承；you/尖括号=本票登记面）
// you 段尾界=分隔符/行尾/文末/非用户名续字符（[0-9A-Za-z_.-] 外——适配器指引散文形 `C:/Users/you；`
// `C:/Users/you\`；` 的实弹尾界；you2/you-x/you.d 等续字符形仍命中——防真段前缀伪装）
const YOU_SEGMENT_RE = /^you(?=[\\/]|\r|\n|$|[^0-9A-Za-z_.-])/i;
// 尖括号占位符段：`<` 起 `>` 止的完整段（段内无尖括号/分隔符/换行）——`<`/`>` 为 Windows 文件名非法
// 字符，不可能构成真实身份段；`>` 后无论何字符（路径分隔/行尾/反引号等文本边界）均视为段已完结
const PLACEHOLDER_SEGMENT_RE = /^<[^<>\/\\\r\n]+>/;

// 文件级豁免登记面（检测器工件源码——检测模式字面量/标签必然自含；豁免仍逐次登记进 exempted 可复核）
const FILE_EXEMPTIONS = new Map([
  ['templates/tools/b3-redact-check.mjs', 'registry:b3-detector-source（B3 检测器源码——模式字面量必然自含，票面已知豁免）'],
  ['templates/tools/sync-harness.mjs', 'registry:anchor-scanner-source（机器锚点扫描检测器源码——模式字面量必然自含）'],
  ['templates/tools/privacy-fullscan.mjs', 'registry:fullscan-self-source（本脚本源码——检测族字面量自含，自扫描豁免）'],
]);

function probeUsername() {
  const injected = process.env.B3_REDACT_PROBE_USERNAME;
  if (injected !== undefined) return String(injected);
  try { return String(userInfo().username ?? ''); } catch { return ''; }
}

const sha8Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 8);

function failLoud(msg) { console.error(`${msg}\n${USAGE}`); process.exit(2); }

// 解码闸（B3 同款三闸）：读不了的形态不得报干净
function decodeOrDie(rel, buf) {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) failLoud(`ENCODING_UNSUPPORTED：${rel} 为 UTF-16LE（BOM FF FE）——转存 UTF-8 后复检`);
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) failLoud(`ENCODING_UNSUPPORTED：${rel} 为 UTF-16BE（BOM FE FF）——转存 UTF-8 后复检`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { failLoud(`ENCODING_UNSUPPORTED：${rel} 非 UTF-8 可解码形态（严格解码失败：${e.message}）——转存 UTF-8 后复检`); }
  if (buf.includes(0)) failLoud(`ENCODING_UNSUPPORTED：${rel} 含 NUL(0x00) 字节（BOM-less UTF-16/32 或二进制形态）`);
  return text;
}

// 扫描面解析：templates 全树（收集后排序=确定性）+12 公开文档；面不完整=用法族 fail-loud
function resolveFace() {
  if (!existsSync('templates') || !statSync('templates').isDirectory()) failLoud('扫描面不完整：templates/ 目录缺失（cwd=仓根契约）');
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`;
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk('templates');
  files.sort();
  for (const d of PUBLIC_DOCS) {
    if (!existsSync(d) || !statSync(d).isFile()) failLoud(`扫描面不完整：公开文档缺失（${d}）——面不完整不得报干净`);
    files.push(d);
  }
  return files;
}

// 段级合成形判定：根族命中区间之后紧跟完整合成段（demo/you 完整段边界；尖括号占位符段）→ 豁免登记
function syntheticReason(after) {
  if (DEMO_SEGMENT_RE.test(after)) return 'synthetic:demo-segment（B3 契约 fixture 约定合成形）';
  if (YOU_SEGMENT_RE.test(after)) return 'synthetic:you-segment（适配器指引示例合成形）';
  if (PLACEHOLDER_SEGMENT_RE.test(after)) return 'synthetic:angle-placeholder-segment（仓内占位符约定合成形）';
  return null;
}

// 单文件扫描：返回 {hits, exempted}（B3 族判定+豁免分类——豁免逐次登记，非静默）
function scanText(rel, text, username) {
  const hits = [];
  const exempted = [];
  const registryReason = FILE_EXEMPTIONS.get(rel);
  const classify = (label, m, after) => {
    const syn = syntheticReason(after);
    if (syn) { exempted.push({ pattern: label, excerpt_sha8: sha8Hex(m[0]), reason: syn }); return false; }
    if (registryReason) { exempted.push({ pattern: label, excerpt_sha8: sha8Hex(m[0]), reason: registryReason }); return false; }
    hits.push({ pattern: label, excerpt_sha8: sha8Hex(m[0]) });
    return true;
  };
  const covered = [];
  for (const m of text.matchAll(DRIVE_RE)) {
    classify(DRIVE_LABEL, m, text.slice(m.index + m[0].length));
    covered.push([m.index, m.index + m[0].length]);   // 命中/豁免均计已处理——posix 孪生区间不重复登记
  }
  for (const fam of POSIX_FAMILIES) {
    for (const m of text.matchAll(fam.re)) {
      const inDrive = covered.some(([s, e]) => m.index >= s && m.index < e);
      if (inDrive) continue;   // 驱动器形已计（同位置不双计）
      classify(fam.label, m, text.slice(m.index + m[0].length));
    }
  }
  if (username.length >= 2) {
    const lower = text.toLowerCase();
    const needle = username.toLowerCase();
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) {
      const record = { pattern: USERNAME_LABEL, excerpt_sha8: sha8Hex(text.slice(i, i + needle.length)) };
      if (registryReason) exempted.push({ ...record, reason: registryReason });
      else hits.push(record);
    }
  }
  return { hits, exempted };
}

const args = process.argv.slice(2);
if (args.length > 0) failLoud(`零参数契约（收到 ${args.length} 个参数）`);
const username = probeUsername();
const face = resolveFace();
const files = [];
const exemptedAll = [];
let total = 0;
for (const rel of face) {
  let buf;
  try { buf = readFileSync(rel); }
  catch (e) { failLoud(`不可读：${rel}（${e.message}）`); }
  const text = decodeOrDie(rel, buf);
  const { hits, exempted } = scanText(rel, text, username);
  if (hits.length > 0) { files.push({ path: rel, hits }); total += hits.length; }
  for (const ex of exempted) exemptedAll.push({ path: rel, ...ex });
}
console.log(JSON.stringify({ scanned_files: face.length, files, exempted: exemptedAll, total_hits: total, total_exempted: exemptedAll.length }));
process.exit(total > 0 ? 1 : 0);
