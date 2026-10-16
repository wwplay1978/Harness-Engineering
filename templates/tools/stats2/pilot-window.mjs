// stats2/pilot-window.mjs — PILOT 采集窗口参数化单源（pilot-window-parameterization）
// 五冻结点统一自 --from/--until 派生（缺省=九月窗，行为字节级不变——验收①）：
//   cmd-bundle PILOT 常量 / inWindow 正则 / bundle_id 窗 token + cmd-native 同款三面。
// 规则钉死（票面 r2 承接快门裁决）：
//   - 窗 token=from 的 UTC 年月（单 token 派生规则——P1-2）；
//   - 票面日期窗判定=年份无关解析（(\d{4})-(\d{2})-(\d{2}) 捕获+Date.parse 窗判定——P1-3：
//     禁「随 until 年份派生正则」，该选项对跨年窗重引入静默漏冻）；
//   - 越界 fail-loud（P2-2）：判定时钟=--clock 注入值 ?? 运行时刻；非 RFC3339/from≥until/until 晚于时钟 → USAGE 拒收；
//   - 谓词串双时格式（P3-3）：bounds 全秒形 / interval+谓词省秒形（秒位非 00 时保全秒形——照实记录窗界）。
// 本模块零依赖（纯函数）——contract-validator 跨字段层与本生成器共用 shortWindowForm（双格式单源）。
export const DEFAULT_PILOT_WINDOW = Object.freeze({ from: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z' });

/** RFC3339 UTC 规范形（秒位必填、Z 后缀、无分数秒、无偏移）——解钉后 VR-S25 语义约束同源。 */
export const RFC3339_UTC_CANON_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** 省秒形（分位精度）：秒位=00 时省略秒段（'…T00:00:00Z'→'…T00:00Z'）；非 00 保全秒形（窗界照实）。 */
export function shortWindowForm(iso) {
  return typeof iso === 'string' ? iso.replace(/:00Z$/, 'Z') : iso;
}

/**
 * 解析+校验窗口 flags（USAGE 面；clockIso=判定时钟字符串——调用方传 `--clock ?? 运行时刻`）。
 * 返回 { from, until }（缺省=九月窗）或 { error }（拒收理由）。顺序：成对律→规范形→from<until→until≤时钟。
 */
export function parseWindowFlags(flags, clockIso) {
  const hasFrom = flags.from !== undefined, hasUntil = flags.until !== undefined;
  if (!hasFrom && !hasUntil) return { from: DEFAULT_PILOT_WINDOW.from, until: DEFAULT_PILOT_WINDOW.until };
  if (hasFrom !== hasUntil) return { error: '--from/--until 须成对提供（缺省=九月窗；单边指定=用法错）' };
  for (const [name, v] of [['--from', flags.from], ['--until', flags.until]]) {
    if (typeof v !== 'string' || !RFC3339_UTC_CANON_RE.test(v) || !Number.isFinite(Date.parse(v))) {
      return { error: `${name} 须 RFC3339 UTC 规范形（YYYY-MM-DDTHH:MM:SSZ，秒位必填 Z 后缀，禁偏移写法）；实得 ${JSON.stringify(v)}` };
    }
  }
  if (Date.parse(flags.from) >= Date.parse(flags.until)) {
    return { error: `窗口非法：--from(${flags.from}) ≥ --until(${flags.until})——半开区间须 from < until` };
  }
  const clockMs = Date.parse(clockIso);
  if (!(Number.isFinite(clockMs) && Date.parse(flags.until) <= clockMs)) {
    return { error: `--until(${flags.until}) 晚于当前时钟（${clockIso}）——未来窗无意义，拒收（判定时钟=--clock ?? 运行时刻）` };
  }
  return { from: flags.from, until: flags.until };
}

/**
 * 自窗口派生全部冻结面（生成器单源；输入须已过 parseWindowFlags 规范形校验）。
 * token=from 的 UTC 年月（canonical 形下字符串切片=精确派生）。
 */
export function deriveWindow({ from = DEFAULT_PILOT_WINDOW.from, until = DEFAULT_PILOT_WINDOW.until } = {}) {
  const interval = `[${shortWindowForm(from)}, ${shortWindowForm(until)})`;
  return {
    from, until, fromMs: Date.parse(from), untilMs: Date.parse(until),
    token: from.slice(0, 4) + from.slice(5, 7),
    bounds: `半开 [${from}, ${until})`,
    interval,
    sqlitePredicate: `model_usage.started_at ∈ ${interval}`,
    metadataPredicate: `project 判定（cwd/workspaceRoot 归属 AITrader2，规范化 project_id 匹配）AND createdAt ∈ ${interval}`,
    kimiPredicate: `project 判定（session_index.jsonl workDir 归属 AITrader2，规范化 project_id 匹配）AND 会话时间判定（首条 allowlist 行时戳 ∈ ${interval}；行时戳不可得时以文件 mtime 近似并在 time_field 注记 mtime-approx）`,
    codexPredicate: `project 判定（rollout session_meta.payload.cwd 归属 AITrader2，规范化 project_id 匹配）AND 会话时间判定（session_meta 首行时戳 ∈ ${interval}；时戳不可得时以文件 mtime 近似并在 time_field 注记 mtime-approx）`,
  };
}

/** 票面正文日期窗判定（cmd-bundle freezeTicketsReviews）：年份无关解析+Date.parse 窗判定（P1-3 钉死）。 */
export function bodyDateInWindow(body, { fromMs, untilMs }) {
  for (const m of body.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (Number.isFinite(t) && t >= fromMs && t < untilMs) return true;
  }
  return false;
}
