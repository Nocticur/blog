# Firefly-Mod

> 基于 [Firefly](https://github.com/CuteLeaf/Firefly) 的个人博客魔改版 `V2.2.2`

![Node.js >= 22](https://img.shields.io/badge/node.js-%3E%3D22-brightgreen)
![pnpm >= 9](https://img.shields.io/badge/pnpm-%3E%3D9-blue)
![Astro](https://img.shields.io/badge/Astro-6.x-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)

<img alt="博客预览" src="./docs/images/image.webp" />

## 项目概述

Firefly-Mod 是从 [Firefly](https://github.com/CuteLeaf/Firefly) 分支出的个性化魔改版本，已脱离原分支独立演进。基于 Astro 6.x SSG 静态站点生成，搭配 Svelte 5 组件和 Tailwind CSS 4 样式系统，构建为纯静态博客。

核心特性：双侧边栏组件化布局、上下班状态感知、Live2D/Spine 看板娘、相册系统、收藏 API、Waline/Twikoo/Giscus/Artalk/Disqus 多评论系统支持、Swup 页面过渡动画、Pagefind 客户端全文搜索、基于 Cloudflare Vectorize 的 AI 语义搜索（RAG）、留言板、日历页面、首页作品百叶窗、文章分享海报、密码加密文章。

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Astro (SSG) | 6.x |
| UI 组件 | Svelte | 5.x |
| 样式 | Tailwind CSS | 4.x |
| 类型 | TypeScript | 5.x |
| 格式化/Lint | Biome | 2.x |
| 页面过渡 | Swup | — |
| 全文搜索 | Pagefind | 1.x |
| 包管理 | pnpm | ≥ 9 |
| 运行时 | Node.js | ≥ 22 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器 (localhost:4321)
pnpm dev

# 构建生产产物到 ./dist/
pnpm build

# 预览构建产物
pnpm preview

# 类型检查
pnpm type-check

# 重新生成图标
pnpm icons

# 构建/更新 AI 搜索向量索引（增量）
pnpm build-index

# 强制全量重建 AI 搜索向量索引
pnpm build-index -- --force

# 登录 Cloudflare（部署 Workers 前）
npx wrangler login

# 部署到 Cloudflare
npx wrangler deploy
```

构建流程为三步：图标生成 → `astro build` → `pagefind --site dist`。

## 常用命令

| 用途 | 命令 |
|------|------|
| 开发服务器 | `pnpm dev` |
| 构建 | `pnpm build` |
| 预览构建产物 | `pnpm preview` |
| Astro 类型检查 | `pnpm check` |
| TypeScript 类型检查 | `pnpm type-check` |
| 格式化代码 | `pnpm format` |
| Lint + 自动修复 | `pnpm lint` |
| 新建博客文章 | `pnpm new-post <filename>` |
| 重新生成图标 | `pnpm icons` |
| 构建/更新 AI 向量索引 | `pnpm build-index` |

强制使用 pnpm（`preinstall` 脚本限制）。

## 配置系统

所有配置集中在 `src/config/`，通过 `@/config`（barrel 文件 `index.ts` 统一导出）导入。

| 配置文件 | 职责 |
|----------|------|
| `siteConfig.ts` | 核心配置：语言、主题色、壁纸模式、页面开关、文章列表布局、分页、分析、图片优化、字体 |
| `sidebarConfig.ts` | 侧边栏布局与组件配置 |
| `navBarConfig.ts` | 导航栏链接与搜索配置（根据页面开关动态生成） |
| `profileConfig.ts` | 头像、昵称、签名、社交链接 |
| `commentConfig.ts` | 评论系统配置（Waline/Twikoo/Giscus/Artalk/Disqus） |
| `musicConfig.ts` | 音乐播放器配置（Meting API / 本地音乐） |
| `pioConfig.ts` | Live2D / Spine 看板娘配置 |
| `fontConfig.ts` | 自定义字体配置 |
| `galleryConfig.ts` | 相册配置 |
| `friendsConfig.ts` | 友链配置 |
| `sponsorConfig.ts` | 赞助页配置 |
| `calendarConfig.ts` | 日历页面配置 |
| `homePortfolioShutterConfig.ts` | 首页作品百叶窗配置 |
| `skillsConfig.ts` | 技能标签配置 |
| `backgroundWallpaper.ts` | 壁纸配置 |
| `adConfig.ts` | 广告栏配置 |
| `announcementConfig.ts` | 公告栏配置 |
| `licenseConfig.ts` | 文章许可证配置 |
| `footerConfig.ts` | 页脚配置 |
| `coverImageConfig.ts` | 封面图配置 |
| `expressiveCodeConfig.ts` | 代码块渲染配置 |
| `plantumlConfig.ts` | PlantUML 配置 |
| `collectionsApiConfig.ts` | 收藏 API 配置 |
| `aiSearchConfig.ts` | AI 搜索配置（模型、Embedding、向量索引） |

### Markdown 插件流水线

定义在 `astro.config.mjs`。

**Remark 插件**（解析阶段，按顺序）：remarkMath → remarkReadingTime → remarkImageGrid → remarkExcerpt → remarkDirective → remarkSectionize → parseDirectiveNode → remarkMermaid → remarkPlantuml

**Rehype 插件**（HTML 转换阶段）：rehypeKatex → rehypeCallouts → rehypeSlug → rehypeMermaid → rehypePlantuml → rehypeFigure → rehypeExternalLinks → rehypeEmailProtection → rehypeComponents → rehypeAutolinkHeadings

自定义插件位于 `src/plugins/`。

## CI/CD 工作流

| 工作流 | 触发条件 | 说明 |
|--------|----------|------|
| `ci.yml` | push/PR 到 master | Astro 类型检查 + Biome Lint 代码质量检查 |
| `cron-check.yml` | 每日 08:00 + 手动触发 | 友链可达性巡检，使用 Playwright 逐个访问，异常自动创建 Issue 报告 |
| `friend-link-checker.yml` | Issue 创建/评论 | 通过 Issue 自动处理友链申请，提取信息并提交 PR |
| `claude.yml` | Issue/PR 评论、Issue 创建、PR Review | 提及 `@claude` 时触发 AI 响应 |
| `claude-review.yml` | PR 创建/更新 | 自动进行 AI 代码审查 |

注意：建议在 GitHub 仓库设置中关闭邮箱订阅，避免 CI 工作流频繁触发邮件通知。

## 部署清单

粗略编写了一下部署清单，包括以下内容：
如果有缺失的，请在 Issue 中报告。

| 检查项 | 说明 |
|--------|------|
| 托管平台 | 支持任何静态托管：Cloudflare Pages、Vercel、Netlify、GitHub Pages、Nginx 等 |
| 评论服务 | 若启用评论，需自行部署对应后端（Waline / Twikoo / Artalk 等） |
| KV 存储 | 若启用留言板，需配置 KV 存储空间 |
| 统计服务 | 站点访问统计通过 Umami 获取（`siteConfig.ts` 中配置 `analytics.umamiAnalytics`，Worker 中配置 `UMAMI_TOKEN` Secret） |
| AI 搜索 | 需 Cloudflare Vectorize 索引；构建索引需 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`；LLM/Embedding 默认走 Workers AI，也可在 `aiSearchConfig.ts` 中配置第三方 API（如魔搭社区）并设置 `AI_API_KEY` |
| 图床（可选）| 项目没引用图床，无需配置，但是我建议配置一个图床，用于存储文章中的图片 |

### Cloudflare Pages 部署方案

本项目原生支持 Cloudflare Pages 部署，并提供 Workers 脚本用于 AI 搜索功能。

#### 1. 连接 Git 仓库自动构建

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages → 创建项目
2. 选择「连接到 Git」，授权 GitHub/GitLab 仓库
3. 构建设置：
   - **构建命令**：`pnpm build`
   - **构建输出目录**：`dist`
4. 点击「保存并部署」，首次构建约 2-5 分钟
5. 添加 Pages 环境变量（Dashboard → Workers & Pages → Settings → Variables and Secrets）：
   - **AI_API_KEY**：第三方 LLM/Embedding API 密钥（默认魔搭社区）。若完全使用 Cloudflare Workers AI，则无需配置。
   - 如需 Umami 统计，添加 **UMAMI_TOKEN** Secret。
6. 配置 KV 存储（用于留言板等 Worker 状态数据）：
   - 登录 Cloudflare Dashboard → KV → 创建命名空间
   - 使用 `wrangler kv namespace create "VISITOR_KV"` 创建，并在 `wrangler.toml` 中同步 `id`
7. 设置好后重启 Pages，等待部署成功。
8. 创建 AI 搜索向量索引：
   - 索引名称需与 `src/config/aiSearchConfig.ts` 中的 `indexName` 一致（默认 `blog-ai-search`）
   - 使用 wrangler 创建：`wrangler vectorize create --name blog-ai-search --dimensions 1024 --metric cosine`

### 你需要更改的配置文件

- `src/config/aiSearchConfig.ts`：AI 搜索配置（模型、Embedding、向量索引）
- `src/config/commentConfig.ts`：评论系统配置（更换地址）
- `src/config/profileConfig.ts`：首页信息：头像、昵称、签名、社交链接
- `src/config/siteConfig.ts`：网站配置：上下班时间、网站设置、页面开关、Umami 统计、导航栏配置
- `wrangler.toml`：Cloudflare KV / Vectorize / AI 绑定配置

下方可选配置文件

- `src/config/musicConfig.ts`：音乐播放器配置（Meting API / 本地音乐）
- `src/config/pioConfig.ts`：Live2D / Spine 看板娘配置
- `src/config/fontConfig.ts`：自定义字体配置
- `src/config/collectionsApiConfig.ts`：收藏 API 配置
- `src/config/announcementConfig.ts`：公告栏配置
- `src/config/friendsConfig.ts`：友链配置
- `src/config/galleryConfig.ts`：相册配置
- `src/config/calendarConfig.ts`：日历页面配置
- `src/config/sponsorConfig.ts`：赞助页配置
- `src/config/coverImageConfig.ts`：封面图配置
- `src/config/homePortfolioShutterConfig.ts`：首页作品百叶窗配置
- `src/config/skillsConfig.ts`：技能标签配置
- `src/config/backgroundWallpaper.ts`：背景壁纸配置

## 文章存储位置

- `src/content/posts/`：Markdown / MDX 文章存储目录，文章内格式必须包含
  - 标题：`title: 文章标题`
  - 发布日期：`published: 2023-01-01`
  - 分类：`category: 分类`
  - 标签：`tags: [标签1, 标签2]`
- 常用可选 frontmatter：
  - 更新日期：`updated: 2023-01-02`
  - 描述：`description: 文章描述`（未填写时默认取正文第一段作为摘要）
  - 草稿：`draft: true`
  - 置顶：`pinned: true`
  - 封面图：`image: /assets/images/cover.webp`
  - 密码：`password: 你的密码`（配合 `passwordHint` 使用）
  - 作者、转载链接、许可证等：`author`, `sourceLink`, `licenseName`, `licenseUrl`

- `src/content/spec/`：特殊页面内容目录，包含关于、友链、留言板、隐私政策等页面

## 相册存储位置

- `public/gallery/`：相册图片存储目录，子目录名需与 `src/config/galleryConfig.ts` 中的相册 `id` 对应
- 每个相册目录下放图片，可手动放置 `cover.*` 作为封面；无封面时默认使用第一张图片

## Live2D / Spine 模型存储位置

- `public/pio/models/live2d/`：Live2D 模型存储目录
- `public/pio/models/spine/`：Spine 模型存储目录

## Live2D 版权声明

Live2D 模型作者为 B 站用户 [木果阿木果](https://space.bilibili.com/886695)，使用需遵守以下规则：

- 使用前必须征得作者同意
- 必须标明作者信息和来源地址
- 模型设计版权归属库洛
- 模型可用于鸣潮相关视频和直播（需标注来源）
- 禁止商用盈利，禁止二次上传转载引流

## 灵感项目

- [fuwari](https://github.com/saicaca/fuwari)
- [hexo-theme-shoka](https://github.com/amehime/hexo-theme-shoka)
- [astro-koharu](https://github.com/cosZone/astro-koharu)
- [Mizuki](https://github.com/matsuzaka-yuki/Mizuki)

## 许可协议

最初 Fork 自 [saicaca/fuwari](https://github.com/saicaca/fuwari)。

**版权声明：**

- Copyright (c) 2024 [saicaca](https://github.com/saicaca) - [fuwari](https://github.com/saicaca/fuwari)
- Copyright (c) 2025 [CuteLeaf](https://github.com/CuteLeaf) - [Firefly](https://github.com/CuteLeaf/Firefly)

根据 MIT 开源协议，可自由使用、修改、分发代码，但需保留上述版权声明。
