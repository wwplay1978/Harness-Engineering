// ZCode hook payload 探测脚本（P0-3 专用，验证后删除）
// 用途：把每次 hook 收到的 payload 原样落盘，确认 ZCode 实际 schema
// （路径字段是 path 还是 file_path、相对/绝对形态、cwd 正反斜杠形态）
// 注册方式：目标项目 .zcode/config.json -> hooks.enabled true ->
//   hooks.events.PreToolUse -> matcher "Write|Edit|ApplyPatch" -> command 本脚本
// 探测期日志：%TEMP%\zcode-hook-payload.log
// 写系统临时目录（绝对路径），不依赖 hook 进程 cwd（零反斜杠写法）
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    appendFileSync(join(tmpdir(), 'zcode-hook-payload.log'),
      '[' + new Date().toISOString() + '] ' + input + '\n');
  } catch { /* fail-open */ }
  process.exit(0);   // 永远放行，只记录
});
