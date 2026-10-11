// stats2/cli.mjs — stats-2 子命令分发与全局参数
// 命令面（票面 docs/tickets/stats-2.md 冻结）：
//   init [--register-project <名> --project-path <路径>]        仓初始化/项目注册
//   bundle create-zcode-pilot                                    冻结 pilot bundle 制作（唯一真实源接触位）
//   collect --bundle <id>                                        增量采集（§5.4 协议；failpoint API 见 failpoint-contract.md）
//   validate | rebuild --from-source | compact | prune            仓生命周期（审查 P0-2）
//   verify --bundle <id>                                          pilot 对账（⑩⑫ + 默认最小输出 allowlist）
//   report [--project…] [--since/--until] [--json|--out]          常设 M1/M2 报告（stats-4；全仓 closed segments）
// 全局参数：
//   --store-root <dir>       事件仓根（默认 ~/.agents/harness-stats；测试恒注入沙盒）
//   --node-version-probe <ver>  版本探针注入（P2-2 单测；低于 22.16.0 在任何源访问/目录创建前 exit≠0）
//   --clock <RFC3339-UTC>    冻结时钟（P2-11 收口：仅 init/bundle/collect/rebuild/compact 白名单；
//                             RFC3339 UTC 规范形校验；全部使用点记 [AUDIT] 行——validate/verify/prune 拒收）
//   --source-instance-id <uuid> fixture 固定实例身份（仅首启生效；① SHA 可复现前提）
//   --zcode-home <dir>       ZCode 源根（默认 ~/.zcode；仅 bundle create-zcode-pilot 消费）
//   --project-dir <dir>      消费项目仓根（tickets/reviews/git HEAD 来源）
// 退出码契约：0=成功；1=fail-loud（含 E1:alive 锁被持）；2=用法；60=UNSUPPORTED_SOURCE；
//   64=NODE_VERSION_UNSATISFIED；65=ACL_PREFLIGHT_FAIL；70=CRASH_INJECTED（failpoint 契约冻结）。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkNodeVersion, nodeVersionFailMessage, EXIT_NODE_VERSION } from './version-guard.mjs';

export const EXIT = { OK: 0, FAIL: 1, USAGE: 2, UNSUPPORTED_SOURCE: 60, NODE_VERSION: 64, ACL: 65, CRASH: 70 };

export function defaultStoreRoot() { return join(homedir(), '.agents', 'harness-stats'); }

/** P2-11（复审收口）：--clock 命令白名单——仅持久化时间戳的写入命令（bundle/collect/rebuild/init）
 *  与 failpoint 承载命令（compact/E4）可冻结时钟；validate/verify/prune 恒真实钟（verify 的判定钟
 *  统一取 cursor.updated_at，不接受外部注入——审查 P2-6）。 */
const CLOCK_ALLOWED = new Set(['init', 'bundle', 'collect', 'rebuild', 'compact', 'mine', 'reconcile']);
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export { RFC3339_UTC_RE };

/** P2-11：--clock 在场时校验（命令白名单 + RFC3339 UTC 规范形——+00:00 偏移写法拒收）。 */
function clockGate(cmd, flags) {
  if (flags.clock === undefined) return null;
  if (!CLOCK_ALLOWED.has(cmd)) return `--clock 仅限 ${[...CLOCK_ALLOWED].join('/')} 模式（P2-1 使用面）；「${cmd}」不在白名单`;
  if (typeof flags.clock !== 'string' || !RFC3339_UTC_RE.test(flags.clock) || !Number.isFinite(Date.parse(flags.clock))) {
    return `--clock 须 RFC3339 UTC 规范形（YYYY-MM-DDTHH:MM:SS[.fff]Z，Z 后缀）；实得 ${JSON.stringify(flags.clock)}`;
  }
  return null;
}

/** 解析 argv：--key value 成对；布尔开关（--from-source 等）为 true。
 *  multiKeys（stats-4 report --project 可重复）：列入的键重复出现时累进为数组；
 *  未列入的键维持既有 last-wins 语义（重复 --clock 覆盖=冻结行为，零变化）。返回 {_, flags}。 */
export function parseArgs(argv, multiKeys = []) {
  const multi = multiKeys instanceof Set ? multiKeys : new Set(multiKeys);
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = multi.has(key) && key in flags ? [].concat(flags[key], next) : next;
        i++;
      }
      else flags[key] = multi.has(key) && key in flags ? [].concat(flags[key], true) : true;
    } else rest.push(a);
  }
  return { _: rest, flags };
}

const USAGE = `用法：node harness-stats.mjs <子命令> [参数]
子命令：init | bundle create-zcode-pilot | bundle create-native-corpus | collect（--bundle <id> | --corpus <id>）
        | mine | reconcile | validate | rebuild --from-source | compact | prune | verify | migrate-audit
        | heldout-sample | heldout-live-sample | heldout-live-classify | heldout-planner-final | golden-candidates | pilot-report
        | report [--project <id>…] [--since <RFC3339-UTC>] [--until <RFC3339-UTC>] [--json | --out <reports/ 相对名>]
全局：--store-root <dir> --node-version-probe <ver> --clock <RFC3339-UTC> --source-instance-id <uuid>
      --zcode-home <dir> --project-dir <dir> --kimi-home <dir> --codex-home <dir>
退出码：0 成功 / 1 fail-loud / 2 用法 / 60 UNSUPPORTED_SOURCE / 64 版本不足 / 65 ACL / 70 CRASH_INJECTED`;

/**
 * stats-2 入口：返回进程退出码（不自行 process.exit，便于测试内嵌）。
 * 版本守卫最先执行——低于 22.16.0 时未访问任何源、未创建任何目录。
 */
export async function runStats2(argv) {
  const { _: rest, flags } = parseArgs(argv, ['project']);   // multi：--project 可重复（stats-4 report）
  const cmd = rest[0];
  if (!cmd || cmd === 'help' || flags.help) { console.error(USAGE); return EXIT.USAGE; }

  const vr = checkNodeVersion(flags['node-version-probe'] ?? null);
  if (!vr.ok) { console.error(nodeVersionFailMessage(vr)); return EXIT.NODE_VERSION; }

  // P2-11（复审收口）：--clock 白名单+格式校验先于任何命令执行（红=usage-error，零副作用）
  const clockErr = clockGate(cmd, flags);
  if (clockErr) { console.error(`USAGE（--clock）：${clockErr}`); return EXIT.USAGE; }

  // P3-6（四审）：failpoint 承载面收口——--failpoint 在场即在此校验（解析+mode+命令承载表），
  // 红=usage-error 零副作用；消除「合法字面被非承载命令接受但静默不触发」面（承载=collect/rebuild/compact）
  if (flags.failpoint !== undefined) {
    const { parseFailpoint, requireFailpointMode, failpointCarrierError, FailpointUsageError } = await import('./failpoints.mjs');
    try {
      requireFailpointMode(flags);
      const fp = parseFailpoint(typeof flags.failpoint === 'string' ? flags.failpoint : null);
      const carrierErr = failpointCarrierError(cmd, fp);
      if (carrierErr) { console.error(`USAGE（failpoint）：${carrierErr}`); return EXIT.USAGE; }
    } catch (e) {
      if (e instanceof FailpointUsageError) { console.error(`USAGE（failpoint）：${e.message}`); return EXIT.USAGE; }
      throw e;
    }
  }

  const opts = {
    storeRoot: flags['store-root'] ?? defaultStoreRoot(),
    zcodeHome: flags['zcode-home'] ?? join(homedir(), '.zcode'),
    projectDir: flags['project-dir'] ?? null,
    injectedInstanceId: flags['source-instance-id'] ?? null,
    clock: typeof flags.clock === 'string' ? flags.clock : null,
    flags, rest,
  };

  switch (cmd) {
    case 'init': {
      const { cmdInit } = await import('./cmd-init.mjs');
      return cmdInit(opts);
    }
    case 'bundle': {
      // stats-3 阶段二：native corpus 冻结（唯一真实源接触位）分流
      if (rest[1] === 'create-native-corpus') {
        const { cmdBundleNativeCorpus } = await import('./cmd-native.mjs');
        return cmdBundleNativeCorpus(opts);
      }
      const { cmdBundle } = await import('./cmd-bundle.mjs');
      return cmdBundle(opts);
    }
    case 'collect': {
      // stats-3 阶段二：--corpus（原生面）分流；--bundle（zcode 面）沿 stats-2
      if (flags.corpus !== undefined) {
        const { cmdNativeCollect } = await import('./cmd-native.mjs');
        return cmdNativeCollect(opts);
      }
      const { cmdCollect } = await import('./cmd-collect.mjs');
      return cmdCollect(opts);
    }
    case 'validate': {
      const { cmdValidate } = await import('./cmd-lifecycle.mjs');
      return cmdValidate(opts);
    }
    case 'rebuild': {
      const { cmdRebuild } = await import('./cmd-lifecycle.mjs');
      return cmdRebuild(opts);
    }
    case 'compact': {
      const { cmdCompact } = await import('./cmd-lifecycle.mjs');
      return cmdCompact(opts);
    }
    case 'prune': {
      const { cmdPrune } = await import('./cmd-lifecycle.mjs');
      return cmdPrune(opts);
    }
    case 'verify': {
      const { cmdVerify } = await import('./cmd-verify.mjs');
      return cmdVerify(opts);
    }
    case 'mine': {
      const { cmdMine } = await import('./cmd-mine.mjs');
      return cmdMine(opts);
    }
    case 'reconcile': {
      const { cmdReconcile } = await import('./cmd-mine.mjs');
      return cmdReconcile(opts);
    }
    case 'heldout-sample': {
      const { cmdHeldoutSample } = await import('./cmd-phase4.mjs');
      return cmdHeldoutSample(opts);
    }
    case 'heldout-live-sample': {
      const { cmdHeldoutLiveSample } = await import('./cmd-phase4.mjs');
      return cmdHeldoutLiveSample(opts);
    }
    case 'heldout-live-classify': {
      const { cmdHeldoutLiveClassify } = await import('./cmd-phase4.mjs');
      return cmdHeldoutLiveClassify(opts);
    }
    case 'heldout-planner-final': {
      const { cmdHeldoutPlannerFinal } = await import('./cmd-phase4.mjs');
      return cmdHeldoutPlannerFinal(opts);
    }
    case 'golden-candidates': {
      const { cmdGoldenCandidates } = await import('./cmd-phase4.mjs');
      return cmdGoldenCandidates(opts);
    }
    case 'pilot-report': {
      const { cmdPilotReport } = await import('./cmd-phase4.mjs');
      return cmdPilotReport(opts);
    }
    case 'report': {
      const { cmdReport } = await import('./cmd-report.mjs');
      return cmdReport(opts);
    }
    case 'migrate-audit': {
      const { cmdMigrateAudit } = await import('./cmd-lifecycle.mjs');
      return cmdMigrateAudit(opts);
    }
    default:
      console.error(`未知子命令：${cmd}\n${USAGE}`);
      return EXIT.USAGE;
  }
}
