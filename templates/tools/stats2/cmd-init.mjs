// stats2/cmd-init.mjs — init 子命令：TEMP 启动清扫 → 布局+ACL preflight → config 原子首启 → 项目注册
// 顺序红线：任何持久化写入（config/projects/segment）之前完成 ACL preflight（§6、审查 P1-4）。
import { existsSync } from 'node:fs';
import { ensureStoreLayout, sweepTempDirs, ensureConfig, registerProject, configPath, projectsPath } from './store.mjs';
import { readJson, writeJson } from './util.mjs';
import { EXIT } from './cli.mjs';

export function cmdInit(opts) {
  const { storeRoot, injectedInstanceId, clock, flags } = opts;
  const out = { command: 'init', store_root: storeRoot };
  if (clock) console.log(`[AUDIT] --clock=${clock}（init 模式；config created_at/TEMP 清扫时间基准/项目注册时间冻结于该时钟——P2-1/P2-11 使用必记）`);

  // 1) 布局+ACL（含根不存在时的父目录前置判定）；任何不满足 → exit≠0，此前零数据写入
  const checks = ensureStoreLayout(storeRoot);
  out.acl_checks = checks.length;
  const failed = checks.find(c => !c.ok);
  if (failed) {
    for (const c of checks) if (!c.ok) console.error(`[ACL] ${c.reason ?? c.path}`);
    return EXIT.ACL;
  }

  // 2) TEMP 启动清扫（陈旧 hstats-* 目录；相邻非本工具目录不碰；活跃 token 不删）
  const sweep = sweepTempDirs(storeRoot, clock ? { nowMs: Date.parse(clock) } : {});
  for (const line of sweep) console.log(`[TEMP] ${line}`);

  // 3) config 原子首启（并发唯一；注入仅首建生效）
  const { config, created } = ensureConfig(storeRoot, { injectedId: injectedInstanceId, nowIso: clock ?? undefined });
  out.source_instance_id = config.source_instance_id;
  out.config_created = created;

  // 3b) projects.json 空注册表落位（文件位存在性=布局一部分）
  if (!existsSync(projectsPath(storeRoot))) {
    writeJson(projectsPath(storeRoot), { schema_version: 1, projects: [] });
  }

  // 4) 项目注册（可选）
  if (flags['register-project']) {
    if (!flags['project-path']) { console.error('--register-project 须与 --project-path 同用'); return EXIT.USAGE; }
    const data = registerProject(storeRoot, String(flags['register-project']), String(flags['project-path']), { nowIso: clock ?? undefined });
    out.registered_project = data.projects.find(p => p.display_name === flags['register-project'] || p.project_id === String(flags['register-project']).toLowerCase())?.project_id ?? null;
  }

  console.log(JSON.stringify(out, null, 2));
  return EXIT.OK;
}
