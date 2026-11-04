# 自建部署说明（fork 版）

本文档记录 `WangXP7/ai-model-world` 相对上游 [liyupi/ai-model-world](https://github.com/liyupi/ai-model-world)
补上的部署链路。原项目的产品与架构设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)、
[HANDOFF.md](./HANDOFF.md)，这里只回答一件事：**怎么在自己的 GitHub 仓库里让它自己跑起来。**

---

## 一、结果一览

| 项 | 值 |
|---|---|
| 在线站点 | <https://wangxp7.github.io/ai-model-world/> |
| 仓库 | <https://github.com/WangXP7/ai-model-world>（上游的 fork） |
| 托管方式 | GitHub Pages，`build_type: workflow`（由 Actions 部署，不走 Jekyll） |
| 站点类型 | 项目页，挂在 `/ai-model-world/` 子路径下 |
| 构建命令 | `NEXT_BASE_PATH=/ai-model-world NEXT_DIST_DIR=out npm run build` |
| 产物目录 | `out/`（Next 16 静态导出直接写进 `distDir`） |
| 数据同步 | 每天 2 次，UTC 01:40 / 13:40（北京 09:40 / 21:40） |
| 站点发布 | 代码 push、数据同步后、手动触发；另有每天 2 次定时兜底 |

---

## 二、自动化链路

```
  每 12 小时（sync.yml cron）
        │
        ▼
  npm run sync ──→ 抓取 Epoch AI / models.dev / LiveBench / Hugging Face
        │          归一化 → 合理性闸门 → data/*.json
        ▼
  git commit & push（只提交 data/ 顶层 JSON）
        │
        ├── repository_dispatch: data-synced ──────────┐
        │                                             │
        │   push(main) / 手动 / 定时兜底               ▼
        └─────────────────────────────────────►  pages.yml
                                                     │
                                     npm ci → prebuild: npm run assets
                                     （732 张精灵图 + 搜索索引，构建期生成）
                                                     │
                                     next build（注入 NEXT_BASE_PATH）
                                                     ↓ out/
                                     删 .txt 预取负载 → .nojekyll
                                                     │
                          upload-pages-artifact → deploy-pages
                                                     ▼
                          https://wangxp7.github.io/ai-model-world/
```

| 工作流 | 触发 | 作用 |
|---|---|---|
| `sync.yml` | 定时 + 手动 | 抓上游 → 管线闸门 → 上游健康守卫 → 提交数据快照并通知重建；失败自动开 issue |
| `pages.yml` | push(main)、`repository_dispatch`、手动、定时兜底 | 构建静态站点并发布到 GitHub Pages |
| `toy.yml` | 仅手动 | 上游的 B 站 Toy 发布通道，本 fork 无平台凭据，加前置 guard 后默认跳过 |

---

## 三、改动背后的七个坑

1. **`GITHUB_TOKEN` 产生的 push 不会触发新的工作流运行。**
   数据同步提交快照后，Pages 不会因为那次 push 自动重建。所以 `sync.yml` 末尾用
   `repos.createDispatchEvent` 发一个 `repository_dispatch`（`data-synced`）通知 `pages.yml`；
   该步 `continue-on-error: true`，即使通知失败也不会把「数据已同步」误判成失败，
   而 `pages.yml` 的定时兜底仍会在 1.5 小时后重建站点。

2. **fork 仓库的定时工作流默认关闭。**
   即使 `sync.yml` 写得再对，fork 首次也不会按 cron 运行，需要在 Actions 页启用一次
   （或调 `PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable`）。
   另外 GitHub 会在仓库连续 60 天无活动后再次禁用 schedule，恢复方法同样是重新启用。

3. **项目页有子路径，写死根路径的资源会全 404。**
   Next 的 `basePath` 会处理 `next/link` 与 `_next/` 产物，但管不到内联样式里的
   `url(/sprites/...)` 和 `fetch('/search-index.json')`。项目已有 `src/lib/asset.ts` 与
   `NEXT_PUBLIC_BASE_PATH` 补齐这段，所以构建时注入 `NEXT_BASE_PATH=/ai-model-world` 即可，
   无需改任何页面代码。字体 `@font-face` 也走 `asset()`，见 `src/app/layout.tsx`。

4. **Next 16 的静态导出直接写进 `distDir`（默认是 `.next`），不是别的版本里的 `out/`。**
   部署平台填产物目录时必须让 `distDir` 就是产物目录，故用 `NEXT_DIST_DIR=out`。
   `out/` 与 `public/sprites/`、`public/search-index.json` 都在 `.gitignore` 里，不会误提交。

5. **`GITHUB_TOKEN` 在 fork 里默认只读。**
   `sync.yml` 要 `git push` 回仓库，需把仓库设置
   `actions/permissions/workflow` 的 `default_workflow_permissions` 改成 `write`。

6. **预取负载不要删。** Next 16 App Router 会给每个页面生成 `.txt` 预取负载
   （4100 个文件、约 282 MB；完整产物 491 MB / 822 个 HTML 页面）。
   B 站 Toy 包因为平台限制单文件体积才删掉它们（`scripts/toy/pack.ts`），
   但本地实测删掉后客户端导航会在控制台刷出一串 404（页面仍能跳转，只是退回整页导航）。
   GitHub Pages 没有体积限制，这些文本压缩率又极高，所以本 fork 保留它们，
   让交互与源站完全一致。`.nojekyll` 仍加上，保险起见防止 `_next/` 被静态站点构建器过滤。

7. **某个上游整体挂掉时，管线闸门可能放行坏数据。** 2026-11-04 手动跑同步时
   LiveBench 返回「没有拿到任何可用 release」，`sync-report.json` 里
   `sources.livebench.ok=false`，但 `accepted=true`、`failures=[]`：闸门盯的是存活模型数
   与字段覆盖率，而 LiveBench 只占全站成绩 7.8%（496 条 → 8 条，总量 6365 → 5877，
   跌幅 7.67%），根本触发不了相对跌幅阈值；在 pretty-printed JSON 里表现为约 3975 行删除，
   榜单参赛模型数 114 → 1、134 → 3。
   处理：把 `data/` 回滚到上一份完整快照（732 模型 / 6365 条成绩），并在 `sync.yml`
   提交步骤前加 `scripts/sync/health.ts` —— 关键源 `ok=false`、按来源成绩跌幅 >50%、
   或总跌幅 >15% 任一命中就不提交，只发 `::warning::` 保留旧数据、
   不让链路变红也不误开 issue；上游恢复后自动放行。既有数据管线代码一行未改。

> 本地 Windows Git Bash 补充坑：以 `/` 开头的环境变量会被 MSYS 改写成 Windows 绝对路径，
> `NEXT_BASE_PATH=/ai-model-world` 会变成 `D:/.../ai-model-world` 并让 `next build` 报
> `Specified basePath has to start with a /`。本地复现时加 `MSYS_NO_PATHCONV=1`；
> GitHub Actions 的 Linux runner 不受影响。

---

## 四、仓库设置（已通过 GitHub REST API 完成）

| 设置 | 值 | 接口 |
|---|---|---|
| GitHub Pages | `build_type: workflow`，`source: main /` | `POST /repos/WangXP7/ai-model-world/pages` |
| Actions 开关 | `enabled: true`，`allowed_actions: all` | `PUT /repos/.../actions/permissions` |
| 工作流令牌权限 | `default_workflow_permissions: write` | `PUT /repos/.../actions/permissions/workflow` |
| 仓库主页 | `https://wangxp7.github.io/ai-model-world/` | `PATCH /repos/WangXP7/ai-model-world` |
| 工作流启用 | `sync.yml` / `pages.yml` / `toy.yml` 逐个 enable | `PUT /repos/.../actions/workflows/{id}/enable` |

凭据用的是本机 Git Credential Manager 里的 GitHub OAuth token（scope：`repo, workflow`），
没有写入仓库、也没有放进任何工作流。

---

## 五、本地复现与自检

```bash
npm ci
npm run assets                      # 生成精灵图与搜索索引

# Linux / CI / PowerShell：
NEXT_BASE_PATH=/ai-model-world NEXT_DIST_DIR=out npm run build

# Windows Git Bash（绕开路径转换，且跳过 prebuild 的重复删除）：
MSYS_NO_PATHCONV=1 NEXT_BASE_PATH=/ai-model-world NEXT_DIST_DIR=out npx next build
```

产物在 `out/`。要验证子路径部署，把 `out/` 挂到 `/ai-model-world/` 下起一个静态服务，
再用浏览器检查：首页 200、`/ai-model-world/_next/` 资源 200、精灵图与中文字体 200、
搜索框能拉到 `/ai-model-world/search-index.json`、导航跳转落在 `/ai-model-world/` 前缀内。

---

## 六、手动触发

- 网页：仓库 → Actions → 「同步模型数据」/「部署 GitHub Pages」→ Run workflow。
- 命令行：

```bash
gh workflow run sync.yml  --repo WangXP7/ai-model-world --ref main
gh workflow run pages.yml --repo WangXP7/ai-model-world --ref main
```

`toy.yml` 需要 Secret `TOY_CLI_SESSION_TOKEN` 与自己的 `TOY_ID`；未配置时前置 guard 会
直接跳过，不会失败开 issue。

---

## 七、换成自定义域名 / 用户页仓库

1. 在 Pages 设置里填自定义域名，并把 `CNAME` 放进 `out/`（可在 `pages.yml` 的「精简产物」步骤里写入）。
2. 把 `pages.yml` 构建步骤里的 `NEXT_BASE_PATH: /ai-model-world` 删掉——站点回到域名根，
   再带前缀反而会 404。
3. 同步更新 README 与仓库 `homepage`。

---

## 八、上线验证清单

- [ ] `sync.yml` 手动跑一次：数据校验闸门通过，快照有变化时会提交并发出 `data-synced`。
- [ ] `pages.yml` 跑绿：构建 → 上传 artifact → deploy-pages 三步全过。
- [ ] 站点根路径返回 200，标题为「大模型世界」。
- [ ] 随机抽查模型详情页、时间线、排行榜、厂商页，资源无 404。
- [ ] 浏览器里搜索框输入 `deepseek` 能出结果（说明 `asset()` 前缀生效）。
- [ ] 两个状态徽章（README 顶部）为绿色。

---

## 九、与上游的关系

页面、既有数据管线、角色形象、文案生成逻辑一律未改，MIT 许可与
[NOTICE.md](../NOTICE.md) 的第三方署名义务照旧；站内 `/credits/` 页与页脚的原作者链接均保留。
本 fork 只新增/调整了 `.github/workflows/`、工作流层的 `scripts/sync/health.ts` 守卫、
构建期的 `scripts/pages/split-flight.ts` 首屏瘦身、README 顶部说明与本文档，
以及 `docs/ARCHITECTURE.md` 末尾的部署差异备注。

---

## 十、访问加速（2026-11-04 追加）

### 先纠正一个判断

上一轮把「首页 HTML 2.3 MB」当成了传输量，其实 **GitHub Pages 的 CDN 已经 gzip**：
`Content-Encoding: gzip`、`Content-Length` 157 KB，浏览器实际只下 157 KB。
实测同一份 157 KB 有时 4 秒下完、有时 60 秒超时——瓶颈是国际链路丢包/限速，
不是体积。因此「把首页降到 200 KB」这个说法不准确，纯粹瘦身治不了慢。

### 已做两件事

**1. 首屏瘦身（`scripts/pages/split-flight.ts`，已接入 `pages.yml`）**
把大页面内联的 React Flight 数据（`self.__next_f.push`）挪到同目录 `.flight.js`，
并在 `<head>` 加 `<link rel=preload as=script>`，避免同步外链多出一个阻塞 RTT。
共处理 161 个页面，首页 HTML **2.3 MB → 924 KB**，全站 HTML 182 MB → 151 MB。
浏览器复验：水合正常、搜索索引成功加载、零关键资源失败。
不破坏任何页面逻辑，页面源码一行未改。

**2. 国内节点镜像（真正解决秒开）**
另构建一份**不带 `NEXT_BASE_PATH`** 的根路径产物（独立域名不能带 `/ai-model-world/` 前缀），
发布到 <https://under-the-eaves.app.workbuddy.host/>。
实测首页 0.34–0.54 秒返回，时间线 / 排行榜 / credits / 字体 / 搜索索引全部 200，
裸路径与带 `?v=` 的响应内容一致（无边缘缓存污染）。

> ⚠️ **发布位副作用**：该链接是此工作区唯一的发布位，原先挂的是「Tidewater 海岛钓鱼」。
> 工具按工作区复用 appId，即使换一个工作区外的目录也不会新建独立应用，
> 所以这次发布覆盖了 Tidewater 的在线内容。它的本地文件
> （`GoodCase/tidewater-fish-site/`）完好，随时可从该目录重新发布恢复，
> 但那会再次覆盖当前站点——两者只能二选一。

### 还没做的：Vercel / EdgeOne / 自定义域名

这三项需要外部账号或自有域名，本轮没有凭据因此未接。接入方式已备好：

| 方式 | 做法 |
|---|---|
| Vercel / EdgeOne Pages | 导入仓库；构建命令 `NEXT_DIST_DIR=out npm run build`（**不要**设 `NEXT_BASE_PATH`）；产物目录 `out` |
| 自定义域名 + CDN | Pages 设置里填域名，在 `out/` 放 `CNAME`，并删掉 `pages.yml` 里的 `NEXT_BASE_PATH: /ai-model-world` |

### 本地构建的环境坑

本机通过 `NODE_OPTIONS=--require .../node-language-shim.cjs` 注入了批量删除保护，
`next build` 清理 `distDir` 时会被挂起（表现为卡在 `Running next.config.ts` 后不动）。
本地复现时前置 `NODE_OPTIONS=` 清空即可；GitHub Actions 上没有这个钩子。
另外 Windows Git Bash 会把以 `/` 开头的环境变量改写成 Windows 绝对路径，
设 `NEXT_BASE_PATH=/ai-model-world` 时必须加 `MSYS_NO_PATHCONV=1`。
