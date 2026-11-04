/**
 * 把大页面里内联的 React Flight（self.__next_f.push）数据挪到同目录的外部 JS。
 *
 * 与 scripts/toy/pack.ts 的 externalizeFlight 同源，但针对 GitHub Pages 做了两处调整：
 *   1) src 用相对当前文档的 `./xxx.flight.js`，不依赖 Toy 包里的 `<base>`，
 *      因此带 /ai-model-world/ 前缀的项目页和独立域名的根路径都能用；
 *   2) 在 <head> 补一条 <link rel=preload as=script>，让浏览器在解析 HTML 的
 *      同时就开始下载 flight.js。否则同步 <script src> 会多出一个整 RTT，
 *      反而把首屏拖慢（HTML 变小省下的时间还不够还这个债）。
 *
 * 内联块按原顺序合并，外部脚本放在第一块的位置（同步执行），与逐段内联的时序一致；
 * 中间若夹着别的脚本，React 只在 hydration 时消费 __next_f 数组，Toy 的
 * `toy:verify` 已用真实浏览器验证过这种合并方式不破坏水合与页内交互。
 *
 * 只处理超过 BUDGET 的页面，小页面保持原样，免得平白多出几百个文件。
 *
 * 用法：npx tsx scripts/pages/split-flight.ts <产物目录>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) throw new Error('用法：npx tsx scripts/pages/split-flight.ts <产物目录>');

const BUDGET = 256 * 1024;
const FLIGHT_SCRIPT = /<script>(\(?self\.__next_f[\s\S]*?)<\/script>/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let pages = 0;
let beforeBytes = 0;
let afterBytes = 0;
let skipped = 0;

for (const file of walk(ROOT)) {
  if (!file.endsWith('.html')) continue;
  const html = readFileSync(file, 'utf8');
  const size = Buffer.byteLength(html);
  if (size <= BUDGET) {
    skipped += 1;
    continue;
  }

  const parts: string[] = [];
  let first = -1;
  const stripped = html.replace(
    FLIGHT_SCRIPT,
    (_match: string, body: string, offset: number) => {
      if (first < 0) first = offset;
      parts.push(body);
      return first === offset ? '\u0000FLIGHT\u0000' : '';
    },
  );
  if (parts.length === 0) {
    skipped += 1;
    continue;
  }

  const name = `${basename(file, '.html')}.flight.js`;
  const src = `./${name}`;
  writeFileSync(join(dirname(file), name), `${parts.join(';\n')};\n`);

  let next = stripped.replace('\u0000FLIGHT\u0000', `<script src="${src}"></script>`);
  next = next.replace('<head>', `<head><link rel="preload" as="script" href="${src}"/>`);
  writeFileSync(file, next);

  pages += 1;
  beforeBytes += size;
  afterBytes += Buffer.byteLength(next);
}

console.log(
  `内联数据外置：${pages} 个页面，HTML ${(beforeBytes / 1048576).toFixed(1)} MB → ` +
    `${(afterBytes / 1048576).toFixed(1)} MB；另有 ${skipped} 个小页面保持原样`,
);
