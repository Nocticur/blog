/** Shared JSON rules for the editor, repository writes and public announcement views. */
export function normalizeAnnouncements(config) {
	if (config === undefined) return config;
	const normalized = JSON.parse(JSON.stringify(config));
	if (Array.isArray(normalized?.items)) {
		for (const item of normalized.items) {
			if (item && typeof item.link === "string") {
				const link = item.link.trim();
				if (link) item.link = link;
				else delete item.link;
			}
		}
	}
	return normalized;
}

export function sortAnnouncementItems(items) {
	return items
		.map((item, index) => ({ item, index }))
		.sort(
			(a, b) =>
				(Number.isFinite(b.item.sort) ? b.item.sort : 0) -
					(Number.isFinite(a.item.sort) ? a.item.sort : 0) || a.index - b.index,
		)
		.map(({ item }) => item);
}

export function visibleAnnouncements(config) {
	return sortAnnouncementItems(
		(config?.items || []).filter((item) => item.enabled !== false),
	);
}

export function announcementTitle(config) {
	return typeof config?.title === "string" && config.title.trim()
		? config.title.trim()
		: "公告";
}

export function announcementDate(now = new Date()) {
	const date = now instanceof Date ? now : new Date(now);
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	return ["year", "month", "day"]
		.map((type) => parts.find((part) => part.type === type)?.value)
		.join("-");
}

function validDate(value) {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		value.startsWith("0000-")
	)
		return false;
	const time = Date.parse(`${value}T00:00:00.000Z`);
	return (
		Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
	);
}

function validLink(value) {
	if (typeof value !== "string") return false;
	const link = value.trim();
	if (!link) return true;
	if (
		Array.from(link).some(
			(character) =>
				character === "\\" ||
				character.charCodeAt(0) < 32 ||
				character.charCodeAt(0) === 127,
		)
	)
		return false;
	if (link.startsWith("/")) return !link.startsWith("//");
	try {
		return ["http:", "https:"].includes(new URL(link).protocol);
	} catch {
		return false;
	}
}

export function validateAnnouncements(config) {
	if (
		!config ||
		typeof config !== "object" ||
		Array.isArray(config) ||
		typeof config.title !== "string" ||
		typeof config.closable !== "boolean" ||
		!Array.isArray(config.items)
	)
		return "公告设置格式错误";
	for (const [index, item] of config.items.entries()) {
		const label = `第 ${index + 1} 条公告`;
		if (
			!item ||
			typeof item !== "object" ||
			Array.isArray(item) ||
			typeof item.tag !== "string" ||
			!Number.isFinite(item.sort)
		)
			return `${label}格式错误`;
		if (typeof item.title !== "string" || !item.title.trim())
			return `${label}标题不能为空`;
		if (typeof item.content !== "string" || !item.content.trim())
			return `${label}正文不能为空`;
		if (!validDate(item.time)) return `${label}日期必须为有效的 YYYY-MM-DD`;
		if (item.enabled !== undefined && typeof item.enabled !== "boolean")
			return `${label}启用状态必须为布尔值`;
		if (item.link !== undefined && !validLink(item.link))
			return `${label}链接必须为单个 / 开头的站内路径或 HTTP(S) 地址，且不能包含反斜杠`;
	}
	return null;
}
