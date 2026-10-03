import { XMLParser } from "fast-xml-parser";
export type FeedItem = {
	title: string;
	link: string;
	date: string;
	description: string;
};
const asArray = (value: any): any[] =>
	value ? (Array.isArray(value) ? value : [value]) : [];
const text = (value: any): string =>
	typeof value === "string" ? value : String(value?.["#text"] || "");
export function parseFeedItems(xml: string): FeedItem[] {
	if (xml.length > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
		return [];
	try {
		const doc = new XMLParser({
			ignoreAttributes: false,
			removeNSPrefix: true,
			parseTagValue: false,
		}).parse(xml);
		const entries = asArray(
			doc.rss?.channel?.item || doc.feed?.entry || doc.RDF?.item,
		);
		const seen = new Set<string>();
		const result: FeedItem[] = [];
		for (const entry of entries) {
			const links = asArray(entry.link);
			const alternate =
				links.find((x) => x?.["@_rel"] === "alternate") ||
				links.find((x) => !x?.["@_rel"]);
			const link = text(alternate?.["@_href"] || alternate);
			let url: URL;
			try {
				url = new URL(link);
			} catch {
				continue;
			}
			if (!["http:", "https:"].includes(url.protocol)) continue;
			url.hash = "";
			const title = text(entry.title)
				.replace(/<[^>]+>/g, "")
				.trim();
			if (!title || seen.has(url.href)) continue;
			seen.add(url.href);
			const date = new Date(
				text(entry.pubDate || entry.published || entry.updated),
			);
			result.push({
				title,
				link: url.href,
				date: Number.isFinite(date.getTime())
					? date.toISOString().slice(0, 10)
					: "",
				description: text(entry.description || entry.summary || entry.content)
					.replace(/<[^>]+>/g, "")
					.trim()
					.slice(0, 500),
			});
		}
		return result;
	} catch {
		return [];
	}
}
export function sortDynamicEntries<
	T extends { data: { published: Date | string; pinned?: boolean } },
>(entries: T[]): T[] {
	return [...entries].sort((a, b) => {
		if (Boolean(a.data.pinned) !== Boolean(b.data.pinned))
			return a.data.pinned ? -1 : 1;
		return (
			new Date(b.data.published).getTime() -
			new Date(a.data.published).getTime()
		);
	});
}

export type NormalizedPlace = {
	name: string;
	lat: number | null;
	lng: number | null;
	description: string;
	photos: string[];
};

export function normalizePlace(input: {
	name?: string;
	province?: string;
	city?: string;
	lat?: number;
	lng?: number;
	experience?: string;
	photos?: string[];
}): NormalizedPlace {
	const name =
		input.name ||
		[input.province, input.city].filter(Boolean).join(" · ") ||
		"未命名地点";
	return {
		name,
		lat:
			typeof input.lat === "number" && Number.isFinite(input.lat)
				? input.lat
				: null,
		lng:
			typeof input.lng === "number" && Number.isFinite(input.lng)
				? input.lng
				: null,
		description: input.experience || "",
		photos: Array.isArray(input.photos)
			? input.photos.filter(
					(photo): photo is string =>
						typeof photo === "string" && photo.length > 0,
				)
			: [],
	};
}

export type TimelineCommit = { hash: string; subject: string; date: string };

export function groupTimelineCommits(
	commits: TimelineCommit[],
): { month: string; commits: TimelineCommit[] }[] {
	const groups = new Map<string, TimelineCommit[]>();
	for (const commit of commits) {
		const month = commit.date.slice(0, 7);
		const group = groups.get(month) || [];
		group.push(commit);
		groups.set(month, group);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([month, group]) => ({
			month,
			commits: group.sort((a, b) => b.date.localeCompare(a.date)),
		}));
}
