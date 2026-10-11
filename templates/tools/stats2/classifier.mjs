// stats2/classifier.mjs — stats-3 阶段三：attempt 分类器（§2.2 判定协议 11 条实现）
// 工件=templates/stats/classifier-dictionary.md（dictionary_version 2.0.0——classifier-v2 语义级变更；裁决⑨ 派生层）；
// parser 复用=stats2/parser.mjs（结构列+冻结三类声明层——不重写，P0-4）。
// 输出=附件 A derivation 六字段载荷（事件落位由 miner/reconcile 承担）。
import { EXPLICIT_PHRASES } from './parser.mjs';

export const DICTIONARY_VERSION = '2.1.0';
export const CLASSIFIER_VERSION = 'stats3-attempt-2.1.0';

// ── §1 派生层声明族（classifier-dictionary.md 冻结；子串匹配、大小写不敏感、仅 note 列）──
export const QUALITY_REWORK_PHRASES = ['修复轮', 'request changes', 'RC', 'findings 修复', '窄修', 'minimal-fix', '合并前修', 'P1-P2 修复', 'P1/P2 修复', '复审后修', 'review 后修复'];
export const EVIDENCE_REFRESH_PHRASES = ['证据补录', '证据刷新', '重新物化', 'hash 对账', '快审折叠'];
export const CANCELLATION_PHRASES = ['用户取消', '手动取消', '主动取消', 'cancellation'];
export const SPEC_FACE_PHRASES = ['spec 数值阻断', 'spec 修订轮', 'spec 数值修订', '用户裁决驱动修订'];
export const NON_DEFECT_MINOR_PHRASES = ['契约收口级微修', '非缺陷微修', 'docstring 修正'];
/** user 触发族（2.0.0 H17 既有三形；2.1.0 增 census19 实测原文两形——字面子串枚举制，禁模式类；
 *  引号字符=实测「」（U+300C/300D）逐字节精确，「选A」缺「裁定」后缀/『』形态均不命中）。 */
export const USER_DIRECTED_PHRASES = ['用户裁决', '批准驱动', '裁决①②驱动', '请立刻修正', '「选A」裁定'];
/** upstream_sync 标注族（2.1.0 冻结四复合形清单：sync main/复跑三合一/合并驱动复跑/上游合并驱动复跑——
 *  票面②裸「复跑」删除+「上游合并」「驱动复跑」两单形一并移除；仅标 secondary；匹配面=note 列）。 */
export const UPSTREAM_SYNC_PHRASES = ['sync main', '复跑三合一', '合并驱动复跑', '上游合并驱动复跑'];
/** 2.0.0 staged_delivery 标注族（H16：分段新交付——仅标 secondary；匹配面=note 列+角色列限定语）。 */
export const STAGED_DELIVERY_PHRASES = ['执行段', '编排器轮', '分段交付', '合并后新段'];
/** 2.0.0 QA 面族（H15：机判载体缺口修复类——词典层③归类 quality_rework；trigger 不改标）。 */
export const QA_FACE_PHRASES = ['机判载体缺口', '形态缺口修复', '载体缺口修复'];
/** §2.2-5 排除规则短语族（不产生新 attempt——同 attempt 附注）。 */
export const EXCLUSION_PHRASES = ['窗口时序', '授权窗节奏', '两阶段票面执行时序', '两阶段为票面执行时序', '断点续跑', '自愈', '伪红重跑', '轮内自修', 'amend', '当场修复 amend'];
/** §2.2-6 聚合行合写形：初始实现+多 episode 修复链（≥2 个 '+' 连接的多动作行）。 */
export const COMPOUND_PATTERN = /初始实现[^，。;；]*\+[^，。;；]*修复[^，。;；]*\+/;

const lower = s => String(s ?? '').toLowerCase();
/** 短 ASCII 短语（≤3 字符，如 RC）词边界判定（dictionary 1.0.1：防 source/archive/march 子串误命中；
 *  1.0.2 收紧：边界类含数字——rc2/RC2 不命中）；其余短语=子串匹配（大小写不敏感）。
 *  全角 ＲＣ 不命中——ASCII 形态声明（词典 §1 备查注记）。 */
const isShortAscii = p => /^[a-z]+$/i.test(p) && p.length <= 3;
const hit = (note, phrases) => {
  const n = lower(note);
  for (const p of phrases) {
    const q = lower(p);
    if (isShortAscii(p)) {
      const re = new RegExp(`(^|[^a-z0-9])${q}([^a-z0-9]|$)`, 'i');
      if (re.test(n)) return p;
    } else if (n.includes(q)) return p;
  }
  return null;
};

/** 拒因工件蕴含 trigger_stage（结构/词典层的归因面；确定性优先序 red_team＞qa＞reviewer）。 */
export function triggerFromArtifacts(artifacts) {
  const arts = Array.isArray(artifacts) ? artifacts.map(String) : [];
  if (arts.some(a => a.includes('-redteam') || a.includes('redteam'))) return { trigger: 'red_team', basis: '拒因工件（-redteam）' };
  if (arts.some(a => a.includes('-qa') || a.includes('qa-') || a.includes('-qa-'))) return { trigger: 'qa', basis: '拒因工件（-qa）' };
  if (arts.some(a => a.includes('-r') && a.includes('review'))) return { trigger: 'reviewer', basis: '拒因工件（-r<n>-review）' };
  return { trigger: 'unknown', basis: null };
}

/**
 * secondary 标注族（词典 §1 2.0.0）：upstream_sync/staged_delivery——不独立归类，仅标 secondary；
 * 匹配面=note 列+角色列限定语（parser v2 role_qualifier）；优先序 upstream_sync＞staged_delivery。
 */
export function secondaryAnnotation(note, roleQualifier) {
  if (hit(note, UPSTREAM_SYNC_PHRASES) || hit(roleQualifier, UPSTREAM_SYNC_PHRASES)) return 'upstream_sync';
  if (hit(note, STAGED_DELIVERY_PHRASES) || hit(roleQualifier, STAGED_DELIVERY_PHRASES)) return 'staged_delivery';
  return null;
}

const deriv = (attempt_kind, trigger_stage, { secondary = null, level = 'none', matched = null, structural = null } = {}) => ({
  attempt_kind, trigger_stage, secondary_cause: secondary,
  primary_signal_level: level,
  signal_evidence: { matched_phrase: matched, structural_basis: structural },
  decided_at: null,   // 落位时由 miner/reconcile 填（判定时刻）
});

/**
 * §2.2 判定协议（classifier-dictionary.md §3 实现序）。
 * @param row parser.mjs 行对象（attempt_no/attempt_compound/declarations/is_rerun/note…）
 * @param ctx {reviewArtifacts: string[], dispatchState?: string}——dispatchState=面一信号
 *        （terminal_cancelled→cancellation_retry 双入口之一，裁决⑨）
 * @returns derivation 载荷（附件 A 六字段；decided_at 由调用方填）
 */
export function classifyRow(row, ctx = {}) {
  const note = row?.note ?? '';
  const attemptNo = Number.isInteger(row?.attempt_no) ? row.attempt_no : null;
  const declarations = new Set(row?.declarations ?? []);
  const artifacts = ctx.reviewArtifacts ?? [];
  const negRework = declarations.has('non_rework_declared');
  const secAnno = secondaryAnnotation(note, row?.role_qualifier);   // 2.0.0 标注族（upstream_sync/staged_delivery）
  // 2.0.0 trigger fallback（阶段三预检 ③）：工件推断无锚（无 .md 工件名形态——D7' 台账评审行）时，
  // 用锚定拒因行的角色族证据（ctx.triggerHint=rejectionAnchors 产；38 例回归面/burned 对照面不传=行为不变）
  const resolveTrigger = () => {
    const t = triggerFromArtifacts(artifacts);
    if (t.trigger === 'unknown' && ctx.triggerHint) return { trigger: ctx.triggerHint, basis: `拒因行角色族锚（${ctx.triggerHint}）` };
    return t;
  };

  // ② 聚合行（§2.2-6）：复合 attempt 列 ∨ multi_attempt 声明 ∨ 合写形短语族
  // （2.1.0 P3-5：COMPOUND_PATTERN 单次求值——同 note 重复 .test 为重复编译求值浪费）
  const compoundNoteHit = COMPOUND_PATTERN.test(note);
  if (row?.attempt_compound || declarations.has('multi_attempt_declared') || compoundNoteHit) {
    return deriv('compound_unparseable', 'unknown',
      { level: 'explicit', matched: row?.attempt_compound ? row.attempt_raw : (compoundNoteHit ? note : '多 attempt 合写'), structural: '聚合行拒绝单标签（粒度修复归票面重录）' });
  }

  // ① 声明层（§2.2-2 优先级最高；含否定压制——non_rework 压制 quality/refresh 推断族，不压制 infra/cancel；
  // 双文本同现断句消歧（QA P2-2，2.0.0 括注改写）：infra_failure_declared ∧ cancellation_declared 并存时
  // infra 先判——环境零产出事实优先于取消语义，cancellation 分支不再触发）
  // §2.2-5 共存裁决：infra 声明与排除族短语（断点续跑/自愈/伪红重跑…）同现且 attempt>1
  // → 环境事件=同 attempt 附注（不另增 attempt），行归属结构层主因（38 例 A10 冻结行为）
  const exclEarly = hit(note, EXCLUSION_PHRASES);
  const infraSuppressed = declarations.has('infra_failure_declared') && attemptNo !== null && attemptNo > 1 && exclEarly !== null;
  if (declarations.has('infra_failure_declared') && !infraSuppressed) {
    if (attemptNo === 1) {
      return deriv('infrastructure_retry', 'environment',
        { level: 'explicit', matched: EXPLICIT_PHRASES.find(p => lower(note).includes(p.phrase))?.phrase ?? note, structural: 'attempt 序号 1+环境零产出声明（条件式 initial）' });
    }
    return deriv('infrastructure_retry', 'environment', { level: 'explicit', matched: note });
  }
  if (hit(note, CANCELLATION_PHRASES)) {
    return deriv('cancellation_retry', 'user', { level: 'explicit', matched: hit(note, CANCELLATION_PHRASES) });
  }
  // user 触发族（2.0.0 H17+2.1.0 短语扩展）：用户裁决/批准驱动——事实性声明，不受 non_rework 压制；
  // 声明层内序冻结（2.1.0 票面②）：user 触发族先于 spec_face——「用户裁决驱动修订」spec_face 冻结形
  // 含「用户裁决」被本族先行命中，结果同值 user/user_directed（语义等价，序恒等冻结）
  const udPhrase = hit(note, USER_DIRECTED_PHRASES);
  if (udPhrase) {
    return deriv('quality_rework', 'user', { secondary: 'user_directed', level: 'explicit', matched: udPhrase });
  }
  // 特定族先于通用否定（最长匹配特异性，38 例 A20 冻结行为）：non_defect 微修族不受 non_rework 压制
  // ——「非缺陷微修」的 parser 冻结短语「非缺陷」会命中 non_rework_declared，但 §2.2-4 词典行
  // 「非缺陷微修→quality_rework（secondary=non_defect）」为更specific 的匹配面。
  const ndPhrase = hit(note, NON_DEFECT_MINOR_PHRASES);
  if (!negRework || ndPhrase) {
    const specPhrase = hit(note, SPEC_FACE_PHRASES);
    if (specPhrase) {
      const userDriven = lower(specPhrase).includes('用户裁决');
      return deriv('quality_rework', userDriven ? 'user' : 'premerge',
        { secondary: userDriven ? 'user_directed' : 'spec_face', level: 'explicit', matched: specPhrase });
    }
    // quality 族∨non_defect 微修族 → quality_rework；trigger=拒因工件蕴含；secondary=non_defect 微修并存时（38 例 A15/A20 冻结行为；标注族次之）
    const qPhrase = hit(note, QUALITY_REWORK_PHRASES);
    if (qPhrase || ndPhrase) {
      const t = resolveTrigger();
      return deriv('quality_rework', t.trigger,
        { secondary: ndPhrase ? 'non_defect' : secAnno, level: 'explicit', matched: qPhrase ?? ndPhrase, structural: t.basis });
    }
    if (hit(note, EVIDENCE_REFRESH_PHRASES)) {
      return deriv('evidence_refresh', 'unknown', { level: 'explicit', matched: hit(note, EVIDENCE_REFRESH_PHRASES) });
    }
  }

  // 面一双入口（裁决⑨；返修轮协调方裁 2026-10-09：代码序=正确语义）：状态入口**优先于排除层/结构层**
  // （取消终态=事实性入口——贴"面一状态+文本双入口"本意）；文本声明族（①层）仍在状态入口之上。
  if (ctx.dispatchState === 'terminal_cancelled') {
    return deriv('cancellation_retry', 'user', { level: 'structural', structural: '面一终态 terminal_cancelled（双入口之状态入口——先于排除层/结构层）' });
  }

  // 排除层（§2.2-5）：排除族命中且无声明族 → 同 attempt 附注（attempt 1 → initial；否则落结构层）
  const exclusionHit = hit(note, EXCLUSION_PHRASES);
  if (exclusionHit && attemptNo === 1) {
    return deriv('initial', 'unknown', { level: 'explicit', matched: exclusionHit, structural: '排除规则：同 attempt 附注（不另增 attempt）' });
  }

  // ② 结构层（§2.2-3 条件式 initial；§2.2-2 ② attempt 序号/rerun 变体+拒因工件）
  if (attemptNo === 1) {
    return deriv('initial', 'unknown', { level: 'structural', structural: 'attempt 序号 1（无环境零产出/取消声明）' });
  }
  if (attemptNo !== null && attemptNo > 1) {
    const t = resolveTrigger();
    return deriv('quality_rework', t.trigger, { secondary: secAnno, level: 'structural', structural: `attempt 序号 ${attemptNo}${row?.is_rerun ? '+rerun 变体' : ''}`, matched: null });
  }
  if (row?.is_rerun) {
    const t = resolveTrigger();
    return deriv('quality_rework', t.trigger, { secondary: secAnno, level: 'structural', structural: 'rerun 变体' });
  }
  // 2.0.0 F-n 枚举例外（H05）：findings 编号形 → attempt>1 结构语义（非 attempt 序号）
  if (row?.attempt_gt1) {
    const t = resolveTrigger();
    return deriv('quality_rework', t.trigger, { secondary: secAnno, level: 'structural', structural: `F-n findings 修复形态（${row.attempt_raw}）——attempt>1 结构语义` });
  }
  // 2.0.0 段序标记（H07）：无序号限定后缀——首段=initial/后续段=staged_delivery；无段序上下文=unknown（诚实）
  if (row?.segment_marker) {
    if (ctx.segmentOrdinal === 1) {
      return deriv('initial', 'unknown', { level: 'structural', structural: '无序号限定后缀段序标记（首段——新交付段初次交付）' });
    }
    if (Number.isInteger(ctx.segmentOrdinal) && ctx.segmentOrdinal > 1) {
      const t = resolveTrigger();
      return deriv('quality_rework', t.trigger, { secondary: 'staged_delivery', level: 'structural', structural: `无序号限定后缀段序标记（第 ${ctx.segmentOrdinal} 段——后续段=分段交付）` });
    }
    return deriv('unknown', 'unknown', { level: 'none', structural: '段序标记无段序上下文（消费方未提供 segmentOrdinal）' });
  }

  // ③ 词典层（§2.2-4；仅低级别信号缺失时；排除族压制）
  if (!exclusionHit && !negRework) {
    if (hit(note, QUALITY_REWORK_PHRASES)) {
      const t = resolveTrigger();
      return deriv('quality_rework', t.trigger, { secondary: secAnno, level: 'dictionary', matched: hit(note, QUALITY_REWORK_PHRASES) });
    }
    // 2.0.0 QA 面族（H15）：机判载体缺口修复类——无结构信号行归类 quality_rework；trigger 不改标（无锚诚实 unknown）
    if (hit(note, QA_FACE_PHRASES)) {
      const t = resolveTrigger();
      return deriv('quality_rework', t.trigger, { secondary: secAnno, level: 'dictionary', matched: hit(note, QA_FACE_PHRASES) });
    }
    if (hit(note, EVIDENCE_REFRESH_PHRASES)) {
      return deriv('evidence_refresh', 'unknown', { level: 'dictionary', matched: hit(note, EVIDENCE_REFRESH_PHRASES) });
    }
  }

  // ④ 无信号 → unknown
  return deriv('unknown', 'unknown', { level: 'none', structural: negRework ? '否定声明且无 attempt 结构信号' : null });
}
