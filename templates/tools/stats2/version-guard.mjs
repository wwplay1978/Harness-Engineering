// stats2/version-guard.mjs — Node ≥22.16 启动 fail-loud（P2-2；docs/22 §5.1 D9' 运行时契约）
// 22.15.x 在访问源/创建目录前 exit≠0；22.16.0=最低绿线。探针可注入（--node-version-probe <ver>）供单测。
import { semverGte } from './util.mjs';

export const NODE_MIN = '22.16.0';
export const EXIT_NODE_VERSION = 64;

/**
 * @param {string|null} probe 注入的版本串（测试用）；null=process.versions.node
 * @returns {{ok:boolean, actual:string, min:string}} 判定结果；调用方在 ok=false 时打印并 exit(64)
 */
export function checkNodeVersion(probe = null) {
  const actual = probe ?? process.versions.node;
  return { ok: semverGte(actual, NODE_MIN), actual, min: NODE_MIN };
}

export function nodeVersionFailMessage(r) {
  return `NODE_VERSION_UNSATISFIED：当前 Node ${r.actual} < 最低要求 ${r.min}（docs/22 §5.1 D9'：node:sqlite Online Backup API 22.16.0 引入）——拒绝启动，未访问任何源、未创建任何目录`;
}
