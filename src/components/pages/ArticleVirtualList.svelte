<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";

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

let { posts, defaultView = "list", postsPerPage = 10 }: Props = $props();

let containerRef = $state<HTMLElement | null>(null);
let view = $state<ArticleListView>("list");
let selectedIndex = $state(0);
let displayedIndex = $state(0);
let phase = $state<"idle" | "leaving" | "entering">("idle");
let gridColumnCount = $state(2);
let currentPage = $state(1);

const gridBreakpoint = 720;
const fadeDuration = 200;

const totalPages = $derived(
	Math.max(1, Math.ceil(posts.length / postsPerPage)),
);
const paginatedPosts = $derived(
	posts.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage),
);
const displayedPost = $derived(posts[displayedIndex] ?? posts[0]);
const gridRows = $derived(
	Array.from(
		{ length: Math.ceil(paginatedPosts.length / Math.max(1, gridColumnCount)) },
		(_, rowOffset) =>
			paginatedPosts
				.slice(rowOffset * gridColumnCount, (rowOffset + 1) * gridColumnCount)
				.map((post, offset) => ({
					post,
					index:
						(currentPage - 1) * postsPerPage +
						rowOffset * gridColumnCount +
						offset,
				})),
	),
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
	if (typeof window === "undefined") return 2;
	const width = containerRef?.clientWidth || window.innerWidth;
	return width < gridBreakpoint ? 1 : 2;
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

function startTransition() {
	if (phase !== "idle") return;
	if (selectedIndex === displayedIndex) return;
	phase = "leaving";
	setTimeout(() => {
		displayedIndex = selectedIndex;
		phase = "entering";
		setTimeout(() => {
			phase = "idle";
			if (selectedIndex !== displayedIndex) {
				startTransition();
			}
		}, fadeDuration);
	}, fadeDuration);
}

function selectPost(index: number) {
	selectedIndex = index;
}

function selectPostWithTransition(index: number) {
	if (index === selectedIndex) return;
	selectedIndex = index;
	startTransition();
}

function goToPage(page: number) {
	currentPage = Math.max(1, Math.min(totalPages, page));
	selectedIndex = (currentPage - 1) * postsPerPage;
	if (containerRef) {
		containerRef.scrollIntoView({ behavior: "smooth", block: "start" });
	}
	startTransition();
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
		{#if view === "grid"}
			<div class="article-list-grid" aria-label="文章卡片列表">
				{#each gridRows as row, rowOffset (`grid-row-${currentPage}-${rowOffset}`)}
					<div class="article-list-grid__row">
						{#each row as entry (entry.post.id)}
							<a
								href={entry.post.url}
								class="post-card-wrapper article-list-card"
								class:is-selected={entry.index === selectedIndex}
								data-post-id={entry.post.id}
								aria-label={`查看文章：${entry.post.title}`}
								onmouseenter={() => selectPost(entry.index)}
								onfocus={() => selectPost(entry.index)}
							>
								<span class="post-card-title article-list-card__title">
									<span class="article-list-card__title-text">
										{entry.post.title}
									</span>
									{#if entry.post.password}
										<span class="article-list-card__lock" aria-label="加密文章">
											<Icon icon="material-symbols:lock-outline" size="lg" />
										</span>
									{/if}
								</span>

								<span class="article-list-card__meta">
									{#if entry.post.pinned}
										<span class="article-list-card__pinned-badge"><Icon icon="material-symbols:pinboard" />{i18n(I18nKey.pinned)}</span>
									{/if}
									<span class="article-list-card__meta-item">
										<Icon icon="material-symbols:calendar-month-rounded" size="lg" />
										<time datetime={entry.post.publishedIso}>
											{entry.post.publishedText}
										</time>
									</span>
									<span class="article-list-card__meta-item">
										<Icon icon="material-symbols:book-2-outline-rounded" size="lg" />
										<span>{entry.post.category}</span>
									</span>
								</span>

								<span class="article-list-card__description">
									{entry.post.description}
								</span>

								<span class="article-list-card__tags" aria-label="标签集合">
									{#if entry.post.tags.length > 0}
										{#each entry.post.tags as tag (tag.name)}
											<span class="post-tag-square article-list-card__tag">
												#{tag.name}
											</span>
										{/each}
									{:else}
										<span class="article-list-card__no-tags">#无标签</span>
									{/if}
								</span>

								<span class="post-card-arrow article-list-card__arrow" aria-hidden="true">
									<Icon icon="material-symbols:arrow-outward-rounded" size="2xl" />
								</span>
							</a>
						{/each}
					</div>
				{/each}
			</div>
		{:else}
			<div class="article-list-virtual__left" aria-label="文章列表">
				{#each paginatedPosts as post, index (post.id)}
					<article
						class="article-list-row"
						class:is-active={(currentPage - 1) * postsPerPage + index === selectedIndex}
						data-post-id={post.id}
					>
						<button
							type="button"
							class="article-list-row__button"
							aria-pressed={(currentPage - 1) * postsPerPage + index === selectedIndex}
							onclick={() => selectPostWithTransition((currentPage - 1) * postsPerPage + index)}
						>
							<span class="article-list-row__title">
									{post.title}
								</span>
							<span class="article-list-row__meta">
									{#if post.pinned}
										<span class="article-list-row__pinned-badge">{i18n(I18nKey.pinned)}</span>
									{/if}
									<span class="article-list-row__meta-item article-list-row__meta-item--date">
										<time datetime={post.publishedIso}>{post.publishedText}</time>
									</span>
									<span class="article-list-row__meta-item article-list-row__meta-item--category">
										<span>{post.category}</span>
									</span>
								</span>
							<span class="article-list-row__tags">
								{#if post.tags.length > 0}
									{#each post.tags.slice(0, 3) as tag (tag.name)}
										<span class="article-list-row__tag">
											#{tag.name}
										</span>
									{/each}
									{#if post.tags.length > 3}
										<span class="article-list-row__tags-more" aria-label={`还有 ${post.tags.length - 3} 个标签`}>
											+{post.tags.length - 3}
										</span>
									{/if}
								{:else}
									<span class="article-list-row__no-tags">#无标签</span>
								{/if}
							</span>
						</button>
					</article>
				{/each}
			</div>

			<aside class="article-list-virtual__right" aria-live="polite">
				<a
					href={displayedPost.url}
					class="post-card-wrapper article-detail-card"
					class:is-leaving={phase === "leaving"}
					class:is-entering={phase === "entering"}
					aria-label={`查看文章：${displayedPost.title}`}
				>
					<div class="article-detail-card__heading">
						<span class="article-detail-card__title">
							<span class="article-detail-card__title-text">
									{displayedPost.title}
								</span>
						</span>
						{#if displayedPost.password}
							<span class="article-detail-card__lock" aria-label="加密文章">
								<Icon icon="material-symbols:lock-outline" size="xl" />
							</span>
						{/if}
					</div>

					<div class="article-detail-card__meta">
						{#if displayedPost.pinned}
							<span class="article-detail-card__pinned-badge"><Icon icon="material-symbols:pinboard" />{i18n(I18nKey.pinned)}</span>
						{/if}
						<span class="article-detail-card__meta-item">
							<Icon icon="material-symbols:calendar-month-rounded" size="lg" />
							<time class="article-detail-card__time" datetime={displayedPost.publishedIso}>
								{displayedPost.publishedText}
							</time>
						</span>
						<span class="article-detail-card__meta-item">
							<Icon icon="material-symbols:book-2-outline-rounded" size="lg" />
							<span class="article-detail-card__category">{displayedPost.category}</span>
						</span>
					</div>

					<div class="article-detail-card__tags" aria-label="标签集合">
						{#if displayedPost.tags.length > 0}
							{#each displayedPost.tags as tag (tag.name)}
								<span class="post-tag-square article-detail-card__tag">
									#{tag.name}
								</span>
							{/each}
						{:else}
							<span class="article-detail-card__no-tags">#无标签</span>
						{/if}
					</div>

					<span class="article-detail-card__description">
						{displayedPost.description}
					</span>

					{#if displayedPost.imageUrl}
						{#key displayedPost.id}
							<span class="article-detail-card__cover">
								<img
									class="article-detail-card__image"
									src={displayedPost.imageUrl}
									alt={`文章配图：${displayedPost.title}`}
									loading="lazy"
									decoding="async"
									data-api-index="0"
									referrerpolicy={displayedPost.imageReferrerPolicy || undefined}
									onerror={(event) =>
										handleDetailImageError(event, displayedPost.imageApiUrls)}
								/>
							</span>
						{/key}
					{/if}

					<span class="post-card-arrow article-detail-card__arrow" aria-hidden="true">
						<Icon icon="material-symbols:arrow-outward-rounded" size="2xl" />
					</span>
				</a>
			</aside>
		{/if}
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
