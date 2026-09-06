// UserPromptSubmit hook：用户首条消息时注入 basic-memory 近 7 天团队记忆摘要
// ── ZCode 实测适配（2026-09-02，见 docs/08-p0-field-log.md）──
// 1) 输出必须为严格 JSON（多键即校验失败）：仿官方 hindsight 插件格式
//    {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
// 2) 项目名标记文件：<项目>/.zcode/memory-project（迁移手册第 4 步创建；
//    缺失则静默跳过——非团队项目零打扰）
// 3) cwd 从 payload 读（hook 进程 cwd 不可依赖，实测结论）
// 4) 节流：按 session_id 打临时标记，每会话只注入一次
// 5) 零反斜杠写法 + fail-open（任何异常静默放行，绝不阻塞会话）
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const NL = String.fromCharCode(10);
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch { process.exit(0); }
  try {
    const BS = String.fromCharCode(92);
    const cwd = String(payload.cwd ?? process.cwd()).split(BS).join('/');
    const marker = cwd + '/.zcode/memory-project';
    if (!existsSync(marker)) process.exit(0);            // 非团队项目静默跳过
    const proj = readFileSync(marker, 'utf8').trim();
    if (!proj) process.exit(0);
    let sid = String(payload.session_id ?? payload.sessionId ?? 'nosid')
      .replace(/[^a-zA-Z0-9_-]/g, '');
    const flag = join(tmpdir(), 'zcode-memo-injected-' + sid);
    if (existsSync(flag)) process.exit(0);               // 本会话已注入过
    const out = execSync('basic-memory tool recent-activity --timeframe 7d --project ' + proj,
      { encoding: 'utf8', timeout: 8000 }).slice(0, 2000);
    writeFileSync(flag, new Date().toISOString());
    const ctx = '[团队记忆 - 近7天 - ' + proj + ']' + NL + out;
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx }
    }));
  } catch { /* 记忆不可用时静默跳过（fail-open） */ }
  process.exit(0);
});
