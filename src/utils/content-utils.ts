import { type CollectionEntry, getCollection } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { buildTagGraphData, type TagGraphData } from "@utils/tag-graph-data";
import { getCategoryUrl, getPostUrlBySlug, getTagUrl } from "@utils/url-utils";

let cachedPosts: CollectionEntry<"posts">[] | null = null;

async function getAllPosts(): Promise<CollectionEntry<"posts">[]> {
	if (cachedPosts) return cachedPosts;
	cachedPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});
	return cachedPosts;
}

async function getRawSortedPosts(): Promise<CollectionEntry<"posts">[]> {
	const allBlogPosts = await getAllPosts();

	const sorted = allBlogPosts.sort((a, b) => {
		// 首先按置顶状态排序，置顶文章在前
		if (a.data.pinned && !b.data.pinned) return -1;
		if (!a.data.pinned && b.data.pinned) return 1;

		// 如果置顶状态相同，则按发布日期排序
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

export async function getSortedPosts(): Promise<CollectionEntry<"posts">[]> {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].id;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].id;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}

export type PostForList = {
	id: string;
	data: CollectionEntry<"posts">["data"];
};

export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		id: post.id,
		data: post.data,
	}));

	return sortedPostsList;
}

export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getAllPosts();

	const countMap: { [key: string]: number } = {};
	allBlogPosts.forEach((post) => {
		post.data.tags.forEach((tag) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags by count descending
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return countMap[b] - countMap[a];
	});

	return keys.map((key) => ({ name: key, count: countMap[key] }));
}

export async function getTagGraphData(): Promise<TagGraphData> {
	const allBlogPosts = await getAllPosts();
	const graph = buildTagGraphData(
		allBlogPosts.map((post) => ({
			title: post.data.title,
			url: getPostUrlBySlug(post.id),
			published: post.data.published,
			tags: post.data.tags,
		})),
	);

	return {
		...graph,
		nodes: graph.nodes.map((node) => ({
			...node,
			url: getTagUrl(node.name),
		})),
	};
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(): Promise<Category[]> {
	const allBlogPosts = await getAllPosts();
	const count: { [key: string]: number } = {};
	allBlogPosts.forEach((post) => {
		if (!post.data.category) {
			const ucKey = i18n(I18nKey.uncategorized);
			count[ucKey] = count[ucKey] ? count[ucKey] + 1 : 1;
			return;
		}

		const categoryName =
			typeof post.data.category === "string"
				? post.data.category.trim()
				: String(post.data.category).trim();

		count[categoryName] = count[categoryName] ? count[categoryName] + 1 : 1;
	});

	const lst = Object.keys(count).sort((a, b) => {
		return (
			count[b] - count[a] || a.toLowerCase().localeCompare(b.toLowerCase())
		);
	});

	const ret: Category[] = [];
	for (const c of lst) {
		ret.push({
			name: c,
			count: count[c],
			url: getCategoryUrl(c),
		});
	}
	return ret;
}

export type CatalogGroup = {
	name: string;
	count: number;
	posts: PostForList[];
	isCurrent: boolean;
};

/**
 * 获取按分类分组的全部文章，用于文章详情页左侧目录组件。
 * - 组内排序保持 getSortedPosts 原序（pinned 优先 + published 降序）
 * - 组间按该组最新文章的 published 日期降序
 * - 当前文章所在分类标记 isCurrent=true（用于 SSR 默认展开）
 */
export async function getCatalogGroups(
	currentPostId: string,
): Promise<CatalogGroup[]> {
	const sorted = await getSortedPosts();

	// 找到当前文章，确定其分类键
	const currentPost = sorted.find((p) => p.id === currentPostId);
	const currentCategoryKey =
		currentPost?.data.category?.trim() || i18n(I18nKey.uncategorized);

	// 按分类分组（保持 sorted 原序）
	const groupMap = new Map<string, PostForList[]>();
	for (const post of sorted) {
		const categoryName = post.data.category?.trim();
		const key = categoryName || i18n(I18nKey.uncategorized);
		if (!groupMap.has(key)) groupMap.set(key, []);
		groupMap.get(key)?.push({ id: post.id, data: post.data });
	}

	// 转换为数组
	const groups: CatalogGroup[] = [];
	for (const [name, posts] of groupMap) {
		groups.push({
			name,
			count: posts.length,
			posts,
			isCurrent: name === currentCategoryKey,
		});
	}

	// 组间按最新文章 published 降序（posts[0] 即最新，因 sorted 已按 published 降序）
	groups.sort((a, b) => {
		const aTime = a.posts[0]?.data.published
			? new Date(a.posts[0].data.published).getTime()
			: 0;
		const bTime = b.posts[0]?.data.published
			? new Date(b.posts[0].data.published).getTime()
			: 0;
		return bTime - aTime;
	});

	return groups;
}
