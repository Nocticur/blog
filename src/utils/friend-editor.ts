import { friendUrlKey, normalizeFriendDraft } from "./friend-data.mjs";

export type FriendRow = Record<string, unknown> & {
	title: string;
	desc: string;
	siteurl: string;
	imgurl: string;
	enabled: boolean;
	weight: number;
};

export function saveFriendRow(
	rows: Record<string, unknown>[],
	draft: Record<string, unknown>,
	editingUrl: string | null,
	requireExisting = false,
	baseline: Record<string, unknown> | null = null,
): FriendRow[] {
	const index =
		editingUrl === null
			? -1
			: rows.findIndex(
					(row) => friendUrlKey(String(row.siteurl)) === editingUrl,
				);
	if (requireExisting && index < 0)
		throw new Error("该友链已在仓库中删除或更改，请重新选择要编辑的友链。");
	const changes = baseline
		? Object.fromEntries(
				Object.entries(draft).filter(
					([field, value]) =>
						JSON.stringify(value) !== JSON.stringify(baseline[field]),
				),
			)
		: draft;
	const next = normalizeFriendDraft(
		changes,
		index >= 0 ? rows[index] : undefined,
	) as FriendRow;
	const key = friendUrlKey(next.siteurl);
	if (
		rows.some(
			(row, i) => i !== index && friendUrlKey(String(row.siteurl)) === key,
		)
	)
		throw new Error("这个站点已经添加，请编辑已有友链。");
	const result = rows.map((row) => ({ ...row })) as FriendRow[];
	if (index < 0) result.push(next);
	else result[index] = next;
	return result;
}

export type FriendStatus = {
	title?: string;
	url: string;
	status: "ok" | "restricted" | "error" | "unknown";
	checkedAt?: string | null;
	httpStatus?: number | null;
	latencyMs?: number | null;
	backlink?: "found" | "missing" | "unchecked" | "unknown";
	screenshotUrl?: string | null;
	screenshotAt?: string | null;
};
export type FriendStatusReport = {
	schemaVersion?: number;
	checkedAt?: string | null;
	results: FriendStatus[];
};

export function friendStatusFor(
	report: FriendStatusReport | null,
	siteurl: string,
): FriendStatus | undefined {
	try {
		const key = friendUrlKey(siteurl);
		return report?.results?.find((result) => friendUrlKey(result.url) === key);
	} catch {
		return undefined;
	}
}

export function friendStatusLabel(
	status?: FriendStatus,
	now = Date.now(),
): string {
	if (
		!status ||
		!status.checkedAt ||
		!Number.isFinite(Date.parse(status.checkedAt))
	)
		return "尚未检测";
	if (now - Date.parse(status.checkedAt) > 48 * 60 * 60 * 1000)
		return "检测结果已过期";
	return (
		{
			ok: "访问正常",
			restricted: "检测受限",
			error: "访问异常",
			unknown: "尚未检测",
		}[status.status] || "尚未检测"
	);
}

export function friendCheckedTime(value?: string | null): string {
	if (!value || !Number.isFinite(Date.parse(value))) return "";
	return new Intl.DateTimeFormat("zh-CN", {
		timeZone: "Asia/Shanghai",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(new Date(value));
}
