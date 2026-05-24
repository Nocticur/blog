# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 常用命令

| 用途 | 命令 |
|---|---|
| 开发服务器 (localhost:4321) | `pnpm dev` |
| 构建到 `./dist/` | `pnpm build`（依次执行：图标生成 → astro build → pagefind） |
| 预览构建产物 | `pnpm preview` |
| 类型检查 | `pnpm check`（astro check）或 `pnpm type-check`（tsc --noEmit） |
| 格式化代码 | `pnpm format`（biome format --write ./src） |
| Lint + 自动修复 | `pnpm lint`（biome check --write ./src） |
| 新建博客文章 | `pnpm new-post <filename>` |
| 重新生成图标 | `pnpm icons` |
| 执行任意 astro CLI | `pnpm astro ...` |

强制使用 pnpm（通过 `preinstall` 脚本限制）。要求 Node.js ≥ 22，pnpm ≥ 9。

## 技术栈

**核心**：Astro 6.x（SSG 静态站点）、Svelte 5、Tailwind CSS 4、TypeScript。Biome 负责格式化/Lint，Swup 处理页面过渡动画，Pagefind 提供客户端搜索。

## 架构概览

### 内容系统

博客文章存放在 `src/content/posts/`，支持 `.md`/`.mdx` 格式，通过 Astro content collections 加载（定义在 `src/content.config.ts`）。Frontmatter 字段：`title`、`published`、`draft`、`tags`、`category`、`pinned`、`comment`、`password` 等。`spec` 集合（`src/content/spec/`）用于特殊页面内容（关于、友链、留言板）。

### 布局系统

- `src/layouts/Layout.astro` — 基础布局：`<html>`、`<head>`、全局样式、分析代码、favicon、壁纸设置、Swup 容器。
- `src/layouts/MainGridLayout.astro` — 继承 Layout，添加侧边栏栅格系统（Navbar、SideBar、响应式布局），大多数页面使用此布局。

### 侧边栏组件系统

完全通过 `src/config/sidebarConfig.ts` 配置。支持 `left`/`right`/`both` 位置。每个侧边栏包含有序的组件列表（`profile`、`announcement`、`music`、`categories`、`tags`、`stats`、`calendar`、`sidebarToc`、`advertisement`），每个组件可独立开关，并可配置在文章页/非文章页的显示。另有 `mobileBottomComponents` 列表用于移动端（<768px）。

关键文件：`src/components/widget/`（侧边栏组件）、`src/components/layout/SideBar.astro`（渲染逻辑）。

### 组件目录结构

- `src/components/layout/` — 结构性组件：Navbar、Footer、SideBar、PostCard、PostPage、CategoryBar、DropdownMenu
- `src/components/widget/` — 侧边栏组件：Profile、Announcement、Music、Calendar、Categories、Tags、SiteStats、Advertisement
- `src/components/features/` — 可选功能：Live2DWidget、SpineModel、MusicPlayer、SakuraEffect、EncryptedPost、TypewriterText
- `src/components/controls/` — 交互控件：Search、FloatingTOC、LightDarkSwitch、DisplaySettings、WallpaperSwitch、BackToTop
- `src/components/common/` — 通用组件：Pagination、CoverImage、WidgetLayout、FloatingButton、Icon、ImageWrapper
- `src/components/misc/` — License、RecommendedPost、SharePoster
- `src/components/analytics/` — GoogleAnalytics、UmamiAnalytics、MicrosoftClarity、La51Analytics
- `src/components/comment/` — 评论系统集成

### 配置系统

所有配置集中在 `src/config/`，通过 `@/config`（barrel 文件 `index.ts` 统一导出）导入。核心配置文件 `siteConfig.ts` 控制语言（顶部 `SITE_LANG`）、主题色、壁纸模式、页面开关、文章列表布局（list/grid/masonry）、分页、分析、图片优化、字体等。

修改 `rehypeCallouts.theme` 或 `plantumlConfig` 后需要重启开发服务器。

### Markdown 插件流水线

定义在 `astro.config.mjs`。**Remark 插件**（解析阶段，按顺序）：remarkMath → remarkReadingTime → remarkImageGrid → remarkExcerpt → remarkDirective → remarkSectionize → parseDirectiveNode → remarkMermaid → remarkPlantuml。**Rehype 插件**（HTML 转换阶段）：rehypeKatex → rehypeCallouts → rehypeSlug → rehypeMermaid → rehypePlantuml → rehypeFigure → rehypeExternalLinks → rehypeEmailProtection → rehypeComponents（处理 `::github` 指令）→ rehypeAutolinkHeadings。

自定义插件位于 `src/plugins/`，其中 `remark-directive-rehype.js` 负责将 `::directive` 节点转换为 rehype 节点。

### 国际化 (i18n)

翻译键定义在 `src/i18n/i18nKey.ts`（const enum）。语言文件在 `src/i18n/languages/`（zh_CN、zh_TW、en、ja、ru）。使用 `i18n(key)` 函数（来自 `src/i18n/translation.ts`），它读取 `siteConfig.lang` 并按 zh_CN → en 顺序回退。

### 样式系统

- Tailwind CSS v4 + `@tailwindcss/vite` 插件
- 全局样式：`src/styles/main.css`，Stylus 变量：`src/styles/variables.styl`
- PostCSS 流水线（`postcss.config.mjs`）：postcss-import → postcss-nesting
- 主题色通过 `Layout.astro` 中从 `siteConfig.themeColor.hue` 生成的 CSS 自定义属性设置

### 路径别名 (tsconfig.json)

`@components/*` → `src/components/*`、`@assets/*` → `src/assets/*`、`@constants/*` → `src/constants/*`、`@utils/*` → `src/utils/*`、`@i18n/*` → `src/i18n/*`、`@layouts/*` → `src/layouts/*`、`@/*` → `src/*`

### 关键工具函数

- `src/utils/setting-utils.ts` — 管理显示设置（主题、壁纸、布局模式），持久化到 localStorage
- `src/utils/navigation-utils.ts` — 统一导航函数 `navigateToPage()`，处理外部链接/锚点/Swup SPA/降级；全局可用 `window.navigateToPage`
- `src/utils/toc-utils.ts` — 目录生成（TOCManager 类，SidebarTOC 和 FloatingDock TOC 共用）
- `src/utils/responsive-utils.ts` — 侧边栏栅格类、响应式断点
- `src/utils/content-utils.ts` — 文章排序、过滤、分页
- `src/utils/image-utils.ts` — 图片格式、质量、referrer 策略
- `src/utils/url-utils.ts` — URL 处理工具（`url()`、`getPostUrlBySlug()`、`getTagUrl()` 等）

### 页面导航系统（Swup）

使用 `@swup/astro@1.8.0`（swup v4）做 SPA 页面切换。配置在 `astro.config.mjs`，关键选项：`theme: false`（自定义 CSS 过渡）、`animationClass: "transition-swup-"`（避免与 Tailwind `transition-*` 冲突）、`cache: true`、`preload: true`。

**Swup 容器**（`MainGridLayout.astro`）：`#swup-container`（主内容）、`#left-sidebar-dynamic`、`#right-sidebar-dynamic`（占位，满足多容器协议）。Navbar、SideBar、FloatingDock 等在容器**之外**，SPA 切换时保持不变。

**过渡动画**：`src/styles/transition.css` 定义 `.transition-swup-main`（进入：opacity+translateY 350ms）和 `.transition-swup-leaving`（离开：250ms）。自定义 `is-page-transitioning` 类（Layout.astro 管理）覆盖整个过渡期 + 400ms 缓冲，供 `waves.css`/`layout-styles.css`/`navbar.css` 抑制视觉闪烁。

**程序化导航**：统一使用 `navigateToPage(url)`（`src/utils/navigation-utils.ts`），全局可用 `window.navigateToPage`（Layout.astro 注册）。禁止用 `window.location.href` 做内部导航（会导致整页刷新）。组件生命周期文档见 `docs/navigation-lifecycle.md`。

**组件重新初始化模式**：Swup 容器外的组件需监听事件来更新状态。推荐使用 `astro:page-load`（由 @swup/astro 桥接触发，每次导航触发一次）。避免同时监听 `swup:contentReplaced` + `swup:content:replace` + `swup:page:view`（同一次导航会触发多次）。`data-swup-ignore-script` 标记的脚本不随 Swup 重执行（用于 Analytics、MusicManager 等持久脚本）。

**`document.startViewTransition()`** 仅用于主题切换（`setting-utils.ts`），与 Swup 页面过渡无关。

### Biome 配置

格式化使用 tab 缩进、双引号。Svelte/Astro/Vue 文件放宽 lint 规则（允许 `let`、未使用变量等）。CI 中通过 `biome ci ./src --reporter=github` 检查。`src/constants/icons.ts` 被排除在 biome 检查之外（自动生成文件）。

### 构建注意事项

- `pnpm build` 三步流程：图标生成脚本 → `astro build` → `pagefind --site dist`
- Vite 构建会移除 `console.log` 和 `debugger`（esbuild `drop` 选项）
- 图片优化仅对 `src/` 目录下的图片生效，`public/` 目录的图片不会被 Astro 优化
- `generateOgImages: true` 构建很慢，默认关闭
- CI 在 push/PR 到 master 时运行 biome 检查
