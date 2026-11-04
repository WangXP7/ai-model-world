<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 大模型世界（ai-model-world）— 给接手的 AI

动手之前先读 **`docs/HANDOFF.md`**，它回答「这是什么 / 为什么长这样 / 接着做什么」，
并列出了不可违背的原则（数据诚信、AA 与 LMArena 合规红线、零 AI 依赖）、踩过的 25+ 个坑、
以及产品负责人明确否决过的做法。其余文档：`docs/DESIGN.md`（视觉映射）、`docs/DATA.md`（数据源与仲裁）、
`docs/ARCHITECTURE.md`（系统架构）。

最常见的几件事：

- 用户说「更新数据」→ `npm run sync && npm run sprites`，然后按 HANDOFF 第三节的三项检查清单核对再汇报。
- 改了选拔 / 排名逻辑 → 先跑 `npx tsx scripts/qa/flagship-rules.ts` 看影响面。
- 改了管线 → `npx tsx scripts/sync/selftest.ts`（224 项）+ `npx tsc --noEmit` + `npx eslint src scripts`。
- 改了 UI → 用 Playwright 在 1440 / 390 两个断点截图自查，用户很在意字号与背景是否干扰阅读。
- 生产构建用 `NEXT_DIST_DIR=.next-build npm run build`，别把 dev 的 `.next` 写坏。

全程用中文与用户交流。本仓库是 fork 的自建部署版，站点已上线 GitHub Pages
（<https://wangxp7.github.io/ai-model-world/>），数据同步与发布链路见
`docs/SELF-HOST.md`；改部署相关配置前先读那份文档。
