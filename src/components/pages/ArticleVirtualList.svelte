<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { coverImageConfig } from "@/config";

type ArticleListView = "list" | "grid";

type ArticleListTag = {
	name: string;
	url: string;
};

export type ArticleListPost = {
	id: string;
	title: string;
	url: string;
	publishedIso: string;
	publishedText: string;
	category: string;
	categoryUrl: string;
	tags: ArticleListTag[];
	description: string;
	imageUrl: string;
	imageApiUrls: string[];
	imageReferrerPolicy: string;
	pinned: boolean;
	password: boolean;
};

interface Props {
	posts: ArticleListPost[];
	defaultView?: ArticleListView;
	postsPerPage?: number;
}

let { posts, defaultView = "list", postsPerPage = 9 }: Props = $props();

let containerRef = $state<HTMLElement | null>(null);
let view = $state<ArticleListView>("list");
let gridColumnCount = $state(3);
let currentPage = $state(1);
let loadedImages = $state<Record<string, boolean>>({});

const showLoadingSkeleton =
	coverImageConfig.randomCoverImage.showLoading ?? true;

const categoryColorPalette = [
	"#fbbf24",
	"#fb7185",
	"#34d399",
	"#60a5fa",
	"#a78bfa",
	"#f472b6",
	"#2dd4bf",
	"#fb923c",
	"#22d3ee",
	"#818cf8",
	"#e879f9",
	"#a3e635",
	"#f87171",
	"#a78bfa",
	"#06b6d4",
	"#f59e0b",
	"#f43f5e",
	"#10b981",
];

const categoryColors = $derived.by(() => {
	const map = new Map<string, string>();
	const cats = [...new Set(posts.map((p) => p.category).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b, "zh-CN"),
	);
	for (let i = 0; i < cats.length; i++) {
		map.set(cats[i], categoryColorPalette[i % categoryColorPalette.length]);
	}
	return map;
});

function getCategoryColor(name: string): string {
	const color = categoryColors.get(name);
	return color ? `color: ${color}` : "";
}

const gridBreakpointMedium = 960;
const gridBreakpointSmall = 640;

const totalPages = $derived(
	Math.max(1, Math.ceil(posts.length / postsPerPage)),
);
const paginatedPosts = $derived(
	posts.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage),
);

// Svelte 5 derived property to distribute posts into columns for masonry layout
const columns = $derived(
	(() => {
		const cols = Array.from({ length: gridColumnCount }, () => []);
		paginatedPosts.forEach((post, idx) => {
			const colIdx = idx % gridColumnCount;
			cols[colIdx].push({
				post,
				index: (currentPage - 1) * postsPerPage + idx,
			});
		});
		return cols;
	})(),
);

function isArticleListView(
	value: string | null | undefined,
): value is ArticleListView {
	return value === "list" || value === "grid";
}

function syncViewFromStorage() {
	if (typeof localStorage === "undefined") return;
	const savedView = localStorage.getItem("postListLayout");
	if (isArticleListView(savedView)) {
		view = savedView;
	}
}

function getGridColumnCount() {
	if (typeof window === "undefined") return 3;
	const width = containerRef?.clientWidth || window.innerWidth;
	if (width < gridBreakpointSmall) return 1;
	if (width < gridBreakpointMedium) return 2;
	return 3;
}

function updateGridColumns() {
	if (typeof window === "undefined") return;
	gridColumnCount = view === "grid" ? getGridColumnCount() : 1;
}

function handleLayoutChange(event: Event) {
	const layout = (event as CustomEvent<{ layout?: string }>).detail?.layout;
	if (!isArticleListView(layout) || layout === view) return;
	view = layout;
	updateGridColumns();
}

function goToPage(page: number) {
	const nextPage = Math.max(1, Math.min(totalPages, page));
	if (nextPage === currentPage) return;

	if (containerRef) {
		window.scrollTo(
			0,
			Math.max(0, window.scrollY + containerRef.getBoundingClientRect().top),
		);
	}

	requestAnimationFrame(() => {
		currentPage = nextPage;
	});
}

function handleDetailImageError(event: Event, apiUrls: string[]) {
	const image = event.currentTarget as HTMLImageElement;
	const nextIndex = Number(image.dataset.apiIndex || "0") + 1;

	if (nextIndex < apiUrls.length) {
		image.dataset.apiIndex = String(nextIndex);
		image.src = apiUrls[nextIndex];
		return;
	}

	image.closest(".article-detail-card__cover")?.classList.add("is-hidden");
}

function generatePageNumbers(
	current: number,
	total: number,
): (number | string)[] {
	const delta = 2;
	const rangeWithDots: (number | string)[] = [];

	if (total <= 7) {
		for (let i = 1; i <= total; i++) rangeWithDots.push(i);
		return rangeWithDots;
	}

	const left = Math.max(2, current - delta);
	const right = Math.min(total - 1, current + delta);

	rangeWithDots.push(1);
	if (left > 2) rangeWithDots.push("...");
	for (let i = left; i <= right; i++) rangeWithDots.push(i);
	if (right < total - 1) rangeWithDots.push("...");
	if (total > 1) rangeWithDots.push(total);

	return rangeWithDots;
}

const pageNumbers = $derived(generatePageNumbers(currentPage, totalPages));

onMount(() => {
	view = defaultView;
	syncViewFromStorage();
	updateGridColumns();

	window.addEventListener("resize", updateGridColumns);
	window.addEventListener("layoutChange", handleLayoutChange);
	document.addEventListener("astro:page-load", updateGridColumns);

	return () => {
		window.removeEventListener("resize", updateGridColumns);
		window.removeEventListener("layoutChange", handleLayoutChange);
		document.removeEventListener("astro:page-load", updateGridColumns);
	};
});

$effect(() => {
	view;
	posts;
	if (typeof window !== "undefined") updateGridColumns();
});
</script>

{#if posts.length === 0}
	<div class="article-list-empty">
		<span class="article-list-empty__title">暂无文章</span>
		<span class="article-list-empty__meta">新的内容会显示在这里。</span>
	</div>
{:else}
	<div
		class="article-list-virtual"
		data-view={view}
		bind:this={containerRef}
		style={`--article-list-grid-columns: ${gridColumnCount};`}
	>
		<div class="article-list-view" hidden={view !== "grid"}>
			<div
				class="article-list-masonry"
				style="--cols: {gridColumnCount};"
				aria-label="文章卡片列表"
			>
				{#each columns as column}
					<div class="article-list-masonry__col">
						{#each column as entry (entry.post.id)}
							{@const post = entry.post}
							{@const isPinned = post.pinned}
							<a
								href={post.url}
								class="article-grid-card"
								class:is-pinned={isPinned}
								aria-label={`查看文章：${post.title}`}
							>
								<!-- 上方图片区域 (2/3) -->
								{#if post.imageUrl}
									<div class="article-grid-card__image-wrapper" class:skeleton-shimmer={showLoadingSkeleton && !loadedImages[post.id]}>
										<img
											class="article-grid-card__image"
											class:is-loaded={loadedImages[post.id]}
											src={post.imageUrl}
											alt={`文章配图：${post.title}`}
											loading="lazy"
											decoding="async"
											data-api-index="0"
											referrerpolicy={post.imageReferrerPolicy || undefined}
											onload={(event) => {
												loadedImages[post.id] = true;
												try {
													const img = event.currentTarget as HTMLImageElement;
													sessionStorage.setItem(`cover_img_${post.id}`, img.currentSrc || img.src);
												} catch {}
											}}
											onerror={(event) => handleDetailImageError(event, post.imageApiUrls)}
										/>
										<div class="article-grid-card__gradient-overlay"></div>
										{#if isPinned}
											<span class="article-grid-card__pinned-badge article-grid-card__pinned-badge--corner">
												<Icon icon="material-symbols:pinboard" size="sm" />
												<span>{i18n(I18nKey.pinned)}</span>
											</span>
										{/if}
									</div>
								{/if}

								<!-- 下方内容区域 (1/3) -->
								<div class="article-grid-card__content">
									<!-- 第一层：标题层 -->
									<div class="article-grid-card__layer-1">
										<h3 class="article-grid-card__title">
											{post.title}
											{#if post.password}
												<span class="article-grid-card__lock" aria-label="加密文章">
													<Icon icon="material-symbols:lock-outline" size="sm" />
												</span>
											{/if}
										</h3>
									</div>

									<!-- 第二层：日期 -->
									<div class="article-grid-card__layer-2">
										<span class="article-grid-card__meta-item">
											<Icon icon="material-symbols:calendar-month-rounded" size="sm" />
											<time datetime={post.publishedIso}>{post.publishedText}</time>
										</span>
									</div>

									<!-- 第三层：分类 + 标签（参考归档页面设计，无图标） -->
									<div class="article-grid-card__layer-3">
										<span class="ag-category" style={getCategoryColor(post.category)}>
											#{post.category}
										</span>
										{#if post.tags.length > 0}
											<span class="ag-meta-gap" aria-hidden="true"></span>
											{#each post.tags.slice(0, 2) as tag, i (tag.name)}
												{#if i > 0}
													<span class="ag-meta-divider" aria-hidden="true">/</span>
												{/if}
												<span class="ag-tag">{tag.name}</span>
											{/each}
											{#if post.tags.length > 2}
												<span class="ag-tag-more" aria-hidden="true">+{post.tags.length - 2}</span>
											{/if}
										{/if}
									</div>
								</div>
							</a>
						{/each}
					</div>
				{/each}
			</div>
		</div>

		<div class="article-list-view" hidden={view !== "list"}>
			<div class="article-list-vertical" aria-label="文章列表">
				{#each paginatedPosts as post, index (post.id)}
					{@const isPinned = post.pinned}
					<article
						class="article-list-row-card"
						class:is-pinned={isPinned}
						data-post-id={post.id}
					>
						<!-- Background Image wrapper (right 2/3) -->
						{#if post.imageUrl}
							<div
								class="article-list-row-card__bg-wrapper"
								class:skeleton-shimmer={showLoadingSkeleton && !loadedImages[post.id]}
							>
								<img
									class="article-list-row-card__bg-image"
									class:is-loaded={loadedImages[post.id]}
									src={post.imageUrl}
									alt={`文章配图：${post.title}`}
									loading="lazy"
									decoding="async"
									data-api-index="0"
									referrerpolicy={post.imageReferrerPolicy || undefined}
									onload={(event) => {
										loadedImages[post.id] = true;
												try {
													const img = event.currentTarget as HTMLImageElement;
													sessionStorage.setItem(`cover_img_${post.id}`, img.currentSrc || img.src);
												} catch {}
											}}
											onerror={(event) => handleDetailImageError(event, post.imageApiUrls)}
								/>
								<div class="article-list-row-card__gradient-overlay"></div>
							</div>
						{/if}

						<!-- Card Content Button -->
						<a
							href={post.url}
							class="article-list-row-card__content"
							aria-label={`查看文章：${post.title}`}
						>
							<!-- 第一层：置顶标识 + 标题 -->
							<div class="article-list-row-card__layer-1">
								{#if isPinned}
									<span class="article-list-row-card__pinned-badge" aria-label="置顶文章">
										<Icon icon="material-symbols:pinboard" size="sm" />
										<span>{i18n(I18nKey.pinned)}</span>
									</span>
								{/if}
								<h3 class="article-list-row-card__title">
									{post.title}
									{#if post.password}
										<span class="article-list-row-card__lock" aria-label="加密文章">
											<Icon icon="material-symbols:lock-outline" size="sm" />
										</span>
									{/if}
								</h3>
							</div>

							<!-- 第二层：分类 + 日期 + 标签 -->
							<div class="article-list-row-card__layer-2">
								<span class="al-category" style={getCategoryColor(post.category)}>
									#{post.category}
								</span>
								<span class="article-list-row-card__meta-item">
									<Icon icon="material-symbols:calendar-month-rounded" size="sm" />
									<time datetime={post.publishedIso}>{post.publishedText}</time>
								</span>
								{#if post.tags.length > 0}
									{#each post.tags.slice(0, 3) as tag, i (tag.name)}
										{#if i > 0}
											<span class="al-meta-divider" aria-hidden="true">/</span>
										{/if}
										<span class="al-tag">{tag.name}</span>
									{/each}
									{#if post.tags.length > 3}
										<span class="al-tag-more" aria-hidden="true">+{post.tags.length - 3}</span>
									{/if}
								{/if}
							</div>

							<!-- 第三层：简介 -->
							<div class="article-list-row-card__layer-3">
								<p class="article-list-row-card__description">
									{post.description}
								</p>
							</div>
						</a>
					</article>
				{/each}
			</div>
		</div>
	</div>

	{#if totalPages > 1}
		<div class="article-list-pagination">
			<div class="article-list-pagination__inner">
				<button
					type="button"
					class="article-list-pagination__btn"
					disabled={currentPage === 1}
					aria-label="上一页"
					onclick={() => goToPage(currentPage - 1)}
				>
					<Icon icon="material-symbols:chevron-left-rounded" class="text-[1.75rem]" />
				</button>

				<div class="article-list-pagination__pages">
					{#each pageNumbers as pageItem (pageItem)}
						{#if pageItem === "..."}
							<span class="article-list-pagination__dots">
								<Icon icon="material-symbols:more-horiz" />
							</span>
						{:else}
							<button
								type="button"
								class="article-list-pagination__page"
								class:is-active={pageItem === currentPage}
								aria-current={pageItem === currentPage ? "page" : undefined}
								onclick={() => goToPage(pageItem as number)}
							>
								{pageItem}
							</button>
						{/if}
					{/each}
				</div>

				<button
					type="button"
					class="article-list-pagination__btn"
					disabled={currentPage === totalPages}
					aria-label="下一页"
					onclick={() => goToPage(currentPage + 1)}
				>
					<Icon icon="material-symbols:chevron-right-rounded" class="text-[1.75rem]" />
				</button>
			</div>
		</div>
	{/if}
{/if}
