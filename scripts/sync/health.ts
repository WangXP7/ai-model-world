/**
 * 上游健康守卫（工作流层，不改数据管线）。
 *
 * 数据管线自己的闸门盯的是「存活模型数」和「字段覆盖率相对跌幅」，
 * 但上游某个源整体挂掉时，仍可能出现「accepted=true、failures=[]，
 * 却把一整类成绩静默清空」的情况：2026-11-04 LiveBench 返回
 * "没有拿到任何可用 release"，一次同步删掉了约 3975 条编程成绩，
 * 榜单参赛模型数从 114 掉到 1，闸门照样放行。
 *
 * 这里在提交之前补一道最朴素的判据：把新快照的成绩条目总数
 * （coding[] + scores[]）与仓库里已有的快照比，跌幅超过阈值就不提交，
 * 让仓库继续保留上一份完整数据。只拦跌、不拦涨，上游恢复后自动放行。
 *
 * 输出 healthy=true/false 到 GITHUB_OUTPUT，供 workflow 的提交步骤做 if 判断。
 * 不健康时只发 ::warning:: 并跳过提交，不让整条同步链路变红、也不误开 issue；
 * 详细原因写在 data/sync-report.json 里，照旧上传为 artifact。
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MAX_SCORE_DROP = 0.3;
const CRITICAL_SOURCES = ['epoch.ai', 'models.dev', 'livebench', 'huggingface'];
const REPORT_PATH = process.env.SYNC_REPORT ?? 'data/sync-report.json';

type Snapshot = {
  models?: { coding?: unknown[]; scores?: unknown[] }[];
};

const countScores = (s: Snapshot): number =>
  (s.models ?? []).reduce(
    (n, m) => n + (m.coding?.length ?? 0) + (m.scores?.length ?? 0),
    0,
  );

const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
const failedSources = CRITICAL_SOURCES.filter((k) => report.sources?.[k]?.ok === false);

let before = 0;
let after = 0;
let drop = 0;
let compareError = '';

try {
  const previous: Snapshot = JSON.parse(
    execSync('git show HEAD:data/models.json', {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  const next: Snapshot = JSON.parse(readFileSync('data/models.json', 'utf8'));
  before = countScores(previous);
  after = countScores(next);
  drop = before > 0 ? (before - after) / before : 0;
} catch (err) {
  // 拿不到历史快照时不猜，宁可放行：首次部署或浅克隆都可能没有 HEAD 版本
  compareError = String(err);
}

const reasons: string[] = [];
if (drop > MAX_SCORE_DROP) {
  reasons.push(
    `成绩条目从 ${before} 跌到 ${after}（-${(drop * 100).toFixed(1)}%，阈值 ${MAX_SCORE_DROP * 100}%）`,
  );
}
if (compareError) {
  console.log(`::notice::无法与历史快照比较，本次跳过跌幅判据：${compareError.slice(0, 160)}`);
}
for (const src of failedSources) {
  console.log(`::warning::上游源 ${src} 本次抓取失败：${String(report.sources[src].note ?? '').slice(0, 160)}`);
}

const healthy = reasons.length === 0;
if (healthy) {
  console.log(`上游健康：成绩条目 ${before} → ${after}，可以提交快照`);
} else {
  for (const r of reasons) console.log(`::warning::${r}；本次快照不提交，保留仓库中的完整旧快照`);
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `healthy=${healthy}\n`);
} else {
  console.log(`healthy=${healthy}`);
}
