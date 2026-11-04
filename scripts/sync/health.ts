/**
 * 上游健康守卫（工作流层，不改数据管线）。
 *
 * 2026-11-04 LiveBench 整体失效（"没有拿到任何可用 release"），管线仍给出
 * accepted=true / failures=[]，却把 496 条 LiveBench 成绩删到只剩 8 条
 * （在 pretty-printed JSON 里表现为约 3975 行删除），榜单参赛数 114 → 1。
 * 数据管线自己的闸门盯的是「存活模型数」和「字段覆盖率」：LiveBench 只占
 * 全站成绩的 7.8%，总跌幅 7.67% 根本触发不了相对跌幅阈值，所以必须在工作流层补判据。
 *
 * 三条判据，命中任一就不提交，让仓库保留上一份完整数据：
 *   ① 关键源（epoch.ai / models.dev / livebench）任一 ok=false
 *   ② 按 source 分组比较成绩数，某个来源跌幅超过 50%（覆盖源没标失败但数据缺失）
 *   ③ 成绩总数跌幅超过 15%
 * 只发 ::warning:: 并跳过提交，不让整条同步链路变红、也不误开 issue；
 * 上游恢复后自动放行，不需要人工干预。Hugging Face 只影响参数量/许可证，仅告警。
 *
 * 输出 healthy=true/false 到 GITHUB_OUTPUT，供 workflow 的提交步骤做 if 判断。
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MAX_TOTAL_DROP = 0.15;
const MAX_SOURCE_DROP = 0.5;
const MIN_SOURCE_SAMPLE = 20;
const BLOCKING_SOURCES = ['epoch.ai', 'models.dev', 'livebench'];
const WARNING_SOURCES = ['huggingface'];
const REPORT_PATH = process.env.SYNC_REPORT ?? 'data/sync-report.json';

type Score = { source?: string };
type Snapshot = { models?: { coding?: Score[]; scores?: Score[] }[] };
type SourceCounts = Record<string, number>;

/** 按 source 统计成绩条目，这样单一上游失效不会被全站总量稀释掉 */
function countBySource(s: Snapshot): SourceCounts {
  const out: SourceCounts = {};
  for (const m of s.models ?? []) {
    for (const score of [...(m.coding ?? []), ...(m.scores ?? [])]) {
      const key = score.source ?? 'unknown';
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}

function sum(counts: SourceCounts): number {
  let n = 0;
  for (const v of Object.values(counts)) n += v;
  return n;
}

const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
const failedCritical = BLOCKING_SOURCES.filter((k) => report.sources?.[k]?.ok === false);
for (const k of WARNING_SOURCES) {
  if (report.sources?.[k]?.ok === false) {
    console.log(`::warning::上游源 ${k} 本次抓取失败（不阻断提交）：${String(report.sources[k].note ?? '').slice(0, 160)}`);
  }
}

let before: SourceCounts = {};
let after: SourceCounts = {};
let compareError = '';
try {
  const previous: Snapshot = JSON.parse(
    execSync('git show HEAD:data/models.json', {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  const next: Snapshot = JSON.parse(readFileSync('data/models.json', 'utf8'));
  before = countBySource(previous);
  after = countBySource(next);
} catch (err) {
  // 拿不到历史快照时不猜，跳过跌幅判据（首次部署、浅克隆都可能没有 HEAD 版本）
  compareError = String(err);
}

const reasons: string[] = [];
if (failedCritical.length) reasons.push(`关键上游抓取失败：${failedCritical.join(', ')}`);
if (compareError) {
  console.log(`::notice::无法与历史快照比较，本次跳过跌幅判据：${compareError.slice(0, 160)}`);
} else {
  const b = sum(before);
  const a = sum(after);
  const drop = b > 0 ? (b - a) / b : 0;
  if (drop > MAX_TOTAL_DROP) {
    reasons.push(`成绩总数 ${b} → ${a}（-${(drop * 100).toFixed(1)}%，阈值 ${MAX_TOTAL_DROP * 100}%）`);
  }
  for (const [key, n] of Object.entries(before)) {
    const m = after[key] ?? 0;
    if (n >= MIN_SOURCE_SAMPLE && (n - m) / n > MAX_SOURCE_DROP) {
      reasons.push(`来源 ${key} 的成绩 ${n} → ${m}（-${(((n - m) / n) * 100).toFixed(1)}%）`);
    }
  }
  console.log(`成绩总数 ${b} → ${a}；按来源：${JSON.stringify(after)}`);
}

const healthy = reasons.length === 0;
if (healthy) {
  console.log('上游健康，可以提交快照');
} else {
  for (const r of reasons) {
    console.log(`::warning::${r}；本次快照不提交，保留仓库中的完整旧快照`);
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `healthy=${healthy}\n`);
} else {
  console.log(`healthy=${healthy}`);
}
