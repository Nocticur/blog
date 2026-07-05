# 文章详情页左侧「全部文章」目录组件设计文档

> 日期：2026-07-06
> 状态：已对齐，待实施
> 范围：文章详情页（`src/pages/posts/[...slug].astro`）左侧浮动目录组件，桌面端（≥1280px）显示

## 一、背景与目标

### 1.1 当前问题

文章详情页底部存在「相关文章」+「随机文章」组件（`src/components/misc/RecommendedPost.astro`），由 `[...slug].astro` 行 413 调用：

```astro
<RecommendedPost relatedPosts={relatedPosts} currentPostId={entry.id} />
```

其中左栏静态渲染 `relatedPosts`（来自 `getRelatedPosts`），右栏客户端 fetch `/api/allPostMeta.json` 随机抽取 5 篇。该组件功能与右侧浮动 TOC 重叠，且随机文章依赖客户端 fetch 存在首屏闪烁。

### 1.2 目标

1. 删除底部「相关文章」「随机文章」组件及其调用
2. 在文章详情页左侧新增「全部文章」浮动目录组件（镜像右侧 TOC）
   - 一级：分类（手风琴，点击展开/折叠）
   - 二级：文章（点击跳转该文章）
3. 一级目录样式：文件夹图标 + 分类名（单行截断）
4. 二级目录样式：文档图标 + 文章标题（单行截断），当前文章选中高亮
5. 移动端（<1280px）不显示，沿用现有响应式断点
6. 设计风格参考右侧 TOC，遵循 CLAUDE.md 全部规范

### 1.3 决策汇总

| 决策项 | 结论 |
|---|---|
| 放置方式 | 浮动左侧，镜像右 TOC（绝对定位 `left: calc(50% - 32rem - 20rem)`） |
| 数据方案 | SSR 直出（方案 A） |
| 默认展开 | 仅展开当前文章所在分类 |
| 排序 | 组间按最新文章 `published` 降序；组内 `getSortedPosts` 原序（pinned 优先 + published 降序） |
| 置顶 | 组内置顶文章放最前，渲染时加 `.is-pinned` 类区分 |
| 分类图标 | 文件夹 SVG |
| 文章图标 | 文档 SVG |
| 计数 | 显示分类下文章数（`catalog-group__count`） |
| 单行截断 | `text-overflow: ellipsis` + `white-space: nowrap` |
| 响应式 | `<1280px` 完全隐藏（与右 TOC 一致） |
| 跳转 | `navigateToPage()`（禁止 `location.href`） |
| 事件 | 仅 `astro:page-load` 单一事件 |

## 二、架构与数据流

### 2.1 组件位置

新增组件 `ArticleCatalog.astro` 放置于 `#swup-container` 内、`#article-toc-wrapper` 之前，作为 `#article-catalog-wrapper`（镜像右 TOC 命名）。仅在 `isPostPage` 为 true 时渲染。

```
MainGridLayout.astro → #swup-container
├─ #article-catalog-wrapper  ← 新增（浮动左侧，xl:block）
├─ #article-toc-wrapper      （已有，浮动右侧）
├─ #category-bar-wrapper
├─ h1.sr-only
├─ #content-wrapper > <slot />
└─ .footer
```

### 2.2 数据获取

在 `src/pages/posts/[...slug].astro` 顶层（与现有 `relatedPosts` 同位置）新增：

```ts
const catalogGroups = await getCatalogGroups(entry.id);
```

新增工具函数 `getCatalogGroups(currentPostId)` 于 `src/utils/content-utils.ts`：
- 调用 `getSortedPosts()`（已有，pinned 优先 + published 降序）
- 按 `category` 分组（空字符串归入「未分类」组，使用 i18n key `uncategorized`）
- 组间排序：按该组最新文章的 `published` 日期降序（最近有更新的分类排前面）
- 组内排序：保持 `getSortedPosts` 原序（pinned 优先置顶，其余按 published 降序）
- 当前分类不特殊置顶，与其它分类一同按日期排序
- 每组返回 `{ name; count; posts; isCurrent }`（`isCurrent` 仅用于 SSR 标记默认展开，不影响排序）

### 2.3 渲染流程

```
[...slug].astro (SSR)
  ├─ getCatalogGroups(entry.id)  →  catalogGroups: CatalogGroup[]
  └─ <ArticleCatalog groups={catalogGroups} currentPostId={entry.id} />
        └─ 渲染完整 HTML（当前分类默认展开，当前文章 .is-active）
```

### 2.4 Swup 集成

- 组件位于 `#swup-container` 内，随 Swup 容器替换天然同步
- 每次导航后 HTML 自带正确 active 状态（SSR 生成）
- 客户端 JS 仅需在 `astro:page-load` 重新绑定手风琴 toggle 监听（符合 CLAUDE.md 4.4 单事件规范）
- 跳转用 `navigateToPage()`（已有 Swup 桥接，禁止 `location.href`）

### 2.5 性能考量

- `getAllPosts` 已有模块级缓存（`cachedPosts`）
- 100 篇文章分组+渲染 ~1ms，无性能瓶颈
- HTML 增量：~100 篇文章标题列表 gzip 后约 3-5KB，可接受

## 三、组件结构

### 3.1 文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `src/components/misc/ArticleCatalog.astro` | 左侧全部文章目录组件 |
| 新增 | `src/styles/components/article-catalog.css` | 组件样式（BEM 命名） |
| 新增 | 工具函数 `getCatalogGroups` | 于 `src/utils/content-utils.ts` 末尾添加 |
| 新增 | i18n key `allPosts` / `uncategorized` | 于 `src/i18n/i18nKey.ts` + 语言文件 |
| 修改 | `src/pages/posts/[...slug].astro` | 删除 `RecommendedPost` 调用；引入 `ArticleCatalog`；删除 `relatedPosts` 变量 |
| 修改 | `src/layouts/MainGridLayout.astro` | 在 `#article-toc-wrapper` 前渲染 `<ArticleCatalog />`（仅 `isPostPage`） |
| 修改 | `src/styles/main.css` | 第 5 层组件层导入 `article-catalog.css` |
| 删除 | `src/components/misc/RecommendedPost.astro` | 不再使用（若被其他地方引用则保留） |

### 3.2 Props 接口

```ts
interface Props {
  groups: CatalogGroup[];
  currentPostId: string;
  class?: string;
}

interface CatalogGroup {
  name: string;
  count: number;
  posts: PostForList[];
  isCurrent: boolean;
}
```

### 3.3 HTML 结构（BEM 命名）

```html
<div id="article-catalog-wrapper" class="article-catalog-wrapper hidden xl:block">
  <div class="article-catalog-container">
    <div class="article-catalog-header">
      <span class="article-catalog-title">{i18n(I18nKey.allPosts)}</span>
    </div>
    <div class="catalog-scroll-container custom-scrollbar article-catalog-body">
      <nav class="catalog-content">
        {groups.map(group => (
          <div class:list={["catalog-group", { "is-expanded": group.isCurrent }]}>
            <button class="catalog-group__header" type="button"
                    aria-expanded={group.isCurrent}>
              <svg class="catalog-group__icon"><!-- 文件夹图标 --></svg>
              <span class="catalog-group__name" title={group.name}>{group.name}</span>
              <span class="catalog-group__count">{group.count}</span>
              <svg class="catalog-group__chevron"><!-- 展开箭头 --></svg>
            </button>
            <div class="catalog-group__list">
              <ul>
                {group.posts.map(post => (
                  <li>
                    <a class:list={["catalog-item", {
                        "is-active": post.id === currentPostId,
                        "is-pinned": post.data.pinned
                      }]}
                       href={getPostUrlBySlug(post.id)}
                       data-navigate>
                      <svg class="catalog-item__icon"><!-- 文档图标 --></svg>
                      <span class="catalog-item__label" title={post.data.title}>
                        {post.data.title}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </nav>
    </div>
  </div>
</div>
```

### 3.4 BEM 类名映射

| 类名 | Block / Element | 用途 |
|---|---|---|
| `.article-catalog-wrapper` | Block | 浮动外层容器（绝对定位，镜像右 TOC） |
| `.article-catalog-container` | Element | sticky 内层 |
| `.article-catalog-header` | Element | 头部标题区 |
| `.article-catalog-title` | Element | 标题文字 |
| `.article-catalog-body` | Element | 滚动内容区 |
| `.catalog-group` | Block | 单个分类（手风琴项） |
| `.catalog-group__header` | Element | 分类头按钮（含图标+名+计数+箭头） |
| `.catalog-group__icon` | Element | 文件夹图标 |
| `.catalog-group__name` | Element | 分类名（单行截断） |
| `.catalog-group__count` | Element | 文章计数徽章 |
| `.catalog-group__chevron` | Element | 展开箭头（旋转动画） |
| `.catalog-group__list` | Element | 二级文章列表容器（grid 动画） |
| `.catalog-item` | Block | 单篇文章链接项 |
| `.catalog-item__icon` | Element | 文档图标 |
| `.catalog-item__label` | Element | 文章标题（单行截断） |

### 3.5 状态类（kebab-case，无 BEM 前缀）

- `.is-expanded` — 手风琴展开状态（`catalog-group`）
- `.is-active` — 当前文章选中状态（`catalog-item`）
- `.is-pinned` — 置顶文章状态（`catalog-item`）

### 3.6 与右 TOC 的命名对齐

| 右 TOC | 左 Catalog | 说明 |
|---|---|---|
| `article-toc-wrapper` | `article-catalog-wrapper` | 完全镜像 |
| `article-toc-container` | `article-catalog-container` | 完全镜像 |
| `article-toc-header` | `article-catalog-header` | 完全镜像 |
| `article-toc-title` | `article-catalog-title` | 完全镜像 |
| `toc-scroll-container` | `catalog-scroll-container` | 复用 `custom-scrollbar` |
| `toc-content` | `catalog-content` | 复用滚动逻辑 |

### 3.7 i18n 键新增

在 `src/i18n/i18nKey.ts` 新增：
- `allPosts` — "全部文章" / "All Posts"
- `uncategorized` — "未分类" / "Uncategorized"

在 `src/i18n/languages/zh_CN.json` 和 `en.json` 添加对应翻译。

## 四、CSS 样式规范

### 4.1 文件位置

`src/styles/components/article-catalog.css`，在 `main.css` 第 5 层（组件层）导入，位于 `post-card.css` 之后。

### 4.2 浮动定位（镜像右 TOC，参 `grid.css` 行 18-31）

```css
.article-catalog-wrapper {
  position: absolute;
  left: calc(50% - 32rem - 20rem);   /* 镜像右 TOC 的 calc(50% + 32rem) */
  top: 0;
  width: 20rem;
  pointer-events: none;
  z-index: 10;
  transition: transform 0.3s ease;
}
.article-catalog-wrapper:hover { transform: translateX(0.5rem); }
.article-catalog-container {
  position: sticky;
  top: 6rem;
  pointer-events: auto;
  max-height: calc(100vh - 7rem);
}
```

### 4.3 主题变量（强制使用，参 CLAUDE.md 3.5）

```css
.article-catalog-container { background: var(--card-bg); border: 1px solid var(--line-divider); }
.catalog-group__header { color: var(--deep-text); }
.catalog-group__name { color: var(--deep-text); }
.catalog-group__count { background: var(--btn-regular-bg); color: var(--deep-text); }
.catalog-item__label { color: var(--deep-text); }
.catalog-item:hover .catalog-item__label { color: var(--primary); }
.catalog-item.is-active .catalog-item__label { color: var(--primary); font-weight: 600; }
.catalog-group__header:hover { background: var(--btn-regular-bg); }
```

### 4.4 单行截断（关键需求）

```css
.catalog-group__name,
.catalog-item__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;   /* flex 子项截断必需 */
}
```

### 4.5 手风琴动画（grid-template-rows 方案，无 max-height 跳变）

```css
.catalog-group__list {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s ease;
  overflow: hidden;
}
.catalog-group__list > ul { min-height: 0; overflow: hidden; }
.catalog-group.is-expanded .catalog-group__list { grid-template-rows: 1fr; }
.catalog-group__chevron { transition: transform 0.3s ease; }
.catalog-group.is-expanded .catalog-group__chevron { transform: rotate(90deg); }
```

### 4.6 响应式（参 CLAUDE.md 3.6，与右 TOC 一致）

```css
@media (max-width: 1280px) {
  .article-catalog-wrapper { display: none !important; }
}
```

### 4.7 置顶与活动状态

```css
.catalog-item.is-active {
  border-left: 3px solid var(--primary);
  background: var(--btn-regular-bg);
}
.catalog-item.is-pinned .catalog-item__icon { color: var(--primary); }
```

## 五、客户端交互与 Swup 集成

### 5.1 事件规范（参 CLAUDE.md 4.4）

仅使用 `astro:page-load` 单一事件，禁止同时监听 `swup:contentReplaced` / `swup:page:view`。

### 5.2 手风琴交互

`ArticleCatalog.astro` 内 `<script>` 带 `data-swup-ignore-script`（防累积，参 CLAUDE.md 4.6）：
- 在 `astro:page-load` 时通过事件委托为 `.catalog-content` 容器绑定 click 监听
- 点击 `.catalog-group__header` → toggle 父级 `.catalog-group` 的 `.is-expanded` 类 + 更新 `aria-expanded`
- 当前文章所在分类：HTML 天生带 `.is-expanded`，且点击折叠当前分类也允许（用户可自由操作）

### 5.3 平滑跳转（参 CLAUDE.md 4.6 禁止 `location.href`）

- 二级项 `<a>` 使用 `data-navigate` 标记
- 点击 → 调用 `navigateToPage(url)`（已有 Swup 桥接，触发 Swup 过渡）
- 与右 TOC 点击行为一致

### 5.4 当前文章滚动入视

`astro:page-load` 时：
- 找到 `.catalog-item.is-active`
- 调用 `scrollIntoView({ block: 'nearest' })` 让当前文章在容器内可见
- 不强制滚动整个页面（避免影响阅读位置）

### 5.5 对齐逻辑（镜像右 TOC 的 alignTOCCoverImage）

`MainGridLayout.astro` 行 132-156 的 `alignTOCCoverImage()` 把右 TOC 顶部对齐 `#post-container`。新增 `alignCatalogCoverImage()` 同步对齐左侧 catalog，逻辑相同但作用于 `#article-catalog-wrapper`，与 `alignTOCCoverImage` 共享 ResizeObserver 与 `astro:page-load` 时机。

### 5.6 生命周期

- 首次加载：HTML SSR 直出 → `astro:page-load` 绑定事件
- Swup 导航：`#swup-container` 替换 → 新 HTML 自带正确 `.is-active` → `astro:page-load` 重新绑定
- 清理：无需手动清理（旧 DOM 随容器替换移除，事件监听自然失效）

## 六、实施步骤

1. 新增 i18n 键 `allPosts` / `uncategorized` 及中英文翻译
2. 在 `src/utils/content-utils.ts` 末尾新增 `getCatalogGroups` 函数及相关类型
3. 新增 `src/components/misc/ArticleCatalog.astro` 组件
4. 新增 `src/styles/components/article-catalog.css` 样式文件
5. 在 `src/styles/main.css` 组件层导入 `article-catalog.css`
6. 修改 `src/layouts/MainGridLayout.astro`：
   - 在 `#article-toc-wrapper` 前渲染 `<ArticleCatalog />`（仅 `isPostPage`）
   - 新增 `alignCatalogCoverImage()` 与 ResizeObserver 集成
7. 修改 `src/pages/posts/[...slug].astro`：
   - 删除 `relatedPosts` 变量及 `getRelatedPosts` 调用
   - 删除 `<RecommendedPost />` 调用
   - 新增 `catalogGroups` 获取与传参
8. 删除 `src/components/misc/RecommendedPost.astro`（确认无其他引用后）
9. 运行 `pnpm check` + `pnpm lint` 验证

## 七、规范合规检查清单

- [ ] 无内联样式：组件无 `<style>` 块
- [ ] 样式集中：所有 CSS 在 `src/styles/components/article-catalog.css`
- [ ] BEM 命名：类名遵循 BEM 规范
- [ ] 变量使用：颜色使用 `--card-bg`、`--deep-text`、`--line-divider`、`--primary` 等自定义属性
- [ ] Swup 容器：组件在 `#swup-container` 内
- [ ] 事件规范：仅用 `astro:page-load`
- [ ] 程序化导航：使用 `navigateToPage()`
- [ ] 无魔法数字：断点使用 `1280px`（与右 TOC 一致）
- [ ] 主题兼容：使用 CSS 变量支持亮/暗主题
- [ ] 响应式：`<1280px` 完全隐藏
