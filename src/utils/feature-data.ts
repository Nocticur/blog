export type FeedItem = {
	title: string;
	link: string;
	date: string;
	description: string;
};

function decodeEntities(value: string): string {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

function tagValue(block: string, tag: string): string {
	const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
	return match ? decodeEntities(match[1]) : "";
}

function toDate(value: string): string {
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export function parseFeedItems(xml: string): FeedItem[] {
	const blocks = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].map((match) => match[1]);
	const seen = new Set<string>();
	const items: FeedItem[] = [];
	for (const block of blocks) {
		const title = tagValue(block, "title");
		const linkTag = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
		const link = decodeEntities(linkTag?.[1] || tagValue(block, "link"));
		const date = toDate(tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated"));
		const description = tagValue(block, "description") || tagValue(block, "summary") || tagValue(block, "content");
		if (!title || !link || seen.has(link)) continue;
		seen.add(link);
		items.push({ title, link, date, description: description.replace(/<[^>]+>/g, "").trim() });
	}
	return items;
}

export function sortDynamicEntries<T extends { data: { published: Date | string; pinned?: boolean } }>(entries: T[]): T[] {
	return [...entries].sort((a, b) => {
		if (Boolean(a.data.pinned) !== Boolean(b.data.pinned)) return a.data.pinned ? -1 : 1;
		return new Date(b.data.published).getTime() - new Date(a.data.published).getTime();
	});
}

export type NormalizedPlace = {
	name: string;
	lat: number | null;
	lng: number | null;
	description: string;
	photos: string[];
};

export function normalizePlace(input: { name?: string; province?: string; city?: string; lat?: number; lng?: number; experience?: string; photos?: string[] }): NormalizedPlace {
	const name = input.name || [input.province, input.city].filter(Boolean).join(" · ") || "未命名地点";
	return {
		name,
		lat: typeof input.lat === "number" && Number.isFinite(input.lat) ? input.lat : null,
		lng: typeof input.lng === "number" && Number.isFinite(input.lng) ? input.lng : null,
		description: input.experience || "",
		photos: Array.isArray(input.photos) ? input.photos.filter((photo): photo is string => typeof photo === "string" && photo.length > 0) : [],
	};
}

export type TimelineCommit = { hash: string; subject: string; date: string };

export function groupTimelineCommits(commits: TimelineCommit[]): { month: string; commits: TimelineCommit[] }[] {
	const groups = new Map<string, TimelineCommit[]>();
	for (const commit of commits) {
		const month = commit.date.slice(0, 7);
		const group = groups.get(month) || [];
		group.push(commit);
		groups.set(month, group);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([month, group]) => ({ month, commits: group.sort((a, b) => b.date.localeCompare(a.date)) }));
}
