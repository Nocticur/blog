import test from "node:test";
import assert from "node:assert/strict";
import {
	groupTimelineCommits,
	normalizePlace,
	parseFeedItems,
	sortDynamicEntries,
} from "../src/utils/feature-data.ts";

test("parseFeedItems extracts RSS items and removes duplicate links", () => {
	const xml = `<?xml version="1.0"?><rss><channel>
		<item><title>First</title><link>https://example.com/a</link><pubDate>Tue, 01 Jan 2026 00:00:00 GMT</pubDate><description>Hello</description></item>
		<item><title>Duplicate</title><link>https://example.com/a</link><pubDate>Wed, 02 Jan 2026 00:00:00 GMT</pubDate></item>
	</channel></rss>`;
	assert.deepEqual(parseFeedItems(xml), [{
		title: "First",
		link: "https://example.com/a",
		date: "2026-01-01",
		description: "Hello",
	}]);
});

test("sortDynamicEntries orders pinned and recent entries", () => {
	const entries = [
		{ id: "old", data: { published: new Date("2026-01-01"), pinned: false } },
		{ id: "pinned", data: { published: new Date("2025-01-01"), pinned: true } },
		{ id: "new", data: { published: new Date("2026-02-01"), pinned: false } },
	];
	assert.deepEqual(sortDynamicEntries(entries).map((entry) => entry.id), ["pinned", "new", "old"]);
});

test("normalizePlace preserves coordinates and supplies safe defaults", () => {
	assert.deepEqual(normalizePlace({ city: "Shanghai", lat: 31.2, lng: 121.5 }), {
		name: "Shanghai",
		lat: 31.2,
		lng: 121.5,
		description: "",
		photos: [],
	});
});

test("groupTimelineCommits groups commits by month", () => {
	assert.deepEqual(groupTimelineCommits([
		{ hash: "a", subject: "A", date: "2026-02-03" },
		{ hash: "b", subject: "B", date: "2026-01-01" },
		{ hash: "c", subject: "C", date: "2026-02-20" },
	]), [
		{ month: "2026-02", commits: [
			{ hash: "c", subject: "C", date: "2026-02-20" },
			{ hash: "a", subject: "A", date: "2026-02-03" },
		] },
		{ month: "2026-01", commits: [{ hash: "b", subject: "B", date: "2026-01-01" }] },
	]);
});
