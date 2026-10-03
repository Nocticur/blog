import { dump, load } from "js-yaml";

export function parseRecordSource(source: string): {
	data: Record<string, unknown>;
	body: string;
} {
	if (!source.startsWith("---")) return { data: {}, body: source };
	const match = /^---([^\r\n]*)\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
	if (!match) throw new Error("Frontmatter 格式不完整");
	const language = match[1].trim().toLowerCase();
	if (!["", "yaml", "yml", "json"].includes(language))
		throw new Error("仅支持 YAML 或 JSON 元信息");
	const data: unknown =
		language === "json" ? JSON.parse(match[2]) : load(match[2]);
	if (
		data !== undefined &&
		(data === null || typeof data !== "object" || Array.isArray(data))
	)
		throw new Error("元信息必须为对象");
	return {
		data: (data || {}) as Record<string, unknown>,
		body: source.slice(match[0].length),
	};
}
export function updateRecordFields(
	source: string,
	fields: Record<string, unknown>,
): string {
	const { data, body } = parseRecordSource(source);
	return `---\n${dump({ ...data, ...fields }, { noRefs: true, lineWidth: -1 })}---\n${body}`;
}
export function updateListField(
	source: string,
	index: number,
	key: string,
	value: string | boolean | number,
): string {
	const rows: unknown = JSON.parse(source);
	if (
		!Array.isArray(rows) ||
		!rows[index] ||
		typeof rows[index] !== "object" ||
		["__proto__", "constructor", "prototype"].includes(key)
	)
		throw new Error("列表项无效");
	return JSON.stringify(
		rows.map((row, position) =>
			position === index ? { ...row, [key]: value } : row,
		),
		null,
		2,
	);
}
export function recordDateInput(value: unknown): string {
	return value instanceof Date
		? value.toISOString().slice(0, 10)
		: typeof value === "string"
			? value.slice(0, 10)
			: "";
}
