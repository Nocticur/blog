import { isFriendImageUrl } from "./friend-data.mjs";
import {
	type FriendStatusReport,
	friendCheckedTime,
	friendStatusFor,
	friendStatusLabel,
} from "./friend-editor";

export function applyFriendStatusReport(
	root: ParentNode,
	report: FriendStatusReport,
): void {
	for (const card of root.querySelectorAll<HTMLElement>("[data-friend-url]")) {
		const status = friendStatusFor(report, card.dataset.friendUrl || "");
		const badge = card.querySelector<HTMLElement>("[data-friend-status]");
		if (badge) {
			badge.textContent = friendStatusLabel(status);
			badge.dataset.status = status?.status || "unknown";
			badge.title = status?.checkedAt
				? "最后检测：" + friendCheckedTime(status.checkedAt)
				: "等待后台自动检测";
		}
		const time = card.querySelector<HTMLElement>("[data-friend-check-time]");
		if (time)
			time.textContent = status?.checkedAt
				? friendCheckedTime(status.checkedAt)
				: "";
		if (card.dataset.friendManualImage === "true") continue;
		const image = status?.screenshotUrl;
		if (!image || !/^https?:\/\//i.test(image) || !isFriendImageUrl(image))
			continue;
		const cover = card.querySelector<HTMLElement>("[data-friend-cover]");
		const img = cover?.querySelector<HTMLImageElement>("img");
		if (!cover || !img) continue;
		if (img.getAttribute("src") !== image) {
			delete cover.dataset.coverBound;
			cover.classList.remove("is-error", "is-loading");
			img.src = image;
		}
		cover.hidden = false;
		card.dataset.friendImage = image;
		card.classList.add("friend-card--with-image");
	}
}

export async function loadFriendStatuses(
	root: ParentNode = document,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	try {
		const response = await fetcher("/api/friend-status", { signal });
		if (!response.ok) return;
		const report = await response.json();
		if (signal?.aborted || !Array.isArray(report?.results)) return;
		applyFriendStatusReport(root, report);
	} catch {
		/* The original cards remain available without the report. */
	}
}
