import type { WalineComment, WalineRootComment } from "@waline/api";
import type {
	GuestbookChatMessage,
	GuestbookEmojiPack,
} from "@/types/guestbook-chat";

const REPLY_MARKER = /^<!--guestbook-reply:(\d+):([^>]*)-->\s*/u;

export function hasGuestbookReplyMarker(value: string): boolean {
	return REPLY_MARKER.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildEmojiAssetURL(
	folder: string,
	item: string,
	type: string,
): string {
	if (/^https?:\/\//u.test(item)) return item;
	const filename = item.endsWith(`.${type}`) ? item : `${item}.${type}`;
	return new URL(filename, `${folder.replace(/\/+$/u, "")}/`).href;
}

async function loadGuestbookEmojiPack(
	source: string,
): Promise<GuestbookEmojiPack> {
	const folder = source.replace(/\/+$/u, "");
	const response = await fetch(`${folder}/info.json`);
	if (!response.ok) throw new Error(`表情包加载失败 (${response.status})`);

	const manifest: unknown = await response.json();
	if (!isRecord(manifest) || !Array.isArray(manifest.items)) {
		throw new Error("表情包配置格式不正确");
	}

	const items = manifest.items.filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
	if (items.length === 0) throw new Error("表情包没有可用内容");

	const type =
		typeof manifest.type === "string" && manifest.type ? manifest.type : "png";
	const prefix = typeof manifest.prefix === "string" ? manifest.prefix : "";
	const iconName =
		typeof manifest.icon === "string" && manifest.icon
			? manifest.icon
			: items[0];

	return {
		name:
			typeof manifest.name === "string" && manifest.name
				? manifest.name
				: "Waline",
		icon: buildEmojiAssetURL(folder, iconName, type),
		items: items.map((item) => ({
			key: `${prefix}${item}`,
			url: buildEmojiAssetURL(folder, item, type),
		})),
	};
}

export async function loadGuestbookEmojiPacks(
	sources: string[],
): Promise<GuestbookEmojiPack[]> {
	const settled = await Promise.allSettled(
		sources.filter(Boolean).map(loadGuestbookEmojiPack),
	);
	const packs = settled.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	if (packs.length === 0) throw new Error("Waline 表情加载失败，请稍后重试");
	return packs;
}

export async function uploadGuestbookImage(
	file: File,
	uploadURL: string,
): Promise<string> {
	if (!uploadURL) throw new Error("图片上传服务未配置");
	const formData = new FormData();
	formData.append("file", file);

	const response = await fetch(uploadURL, {
		method: "POST",
		headers: { Accept: "application/json" },
		body: formData,
	});
	const payload: unknown = await response.json().catch(() => null);
	const data =
		isRecord(payload) && isRecord(payload.data) ? payload.data : null;
	const links = data && isRecord(data.links) ? data.links : null;
	const url =
		(links && typeof links.url === "string" ? links.url : "") ||
		(data && typeof data.url === "string" ? data.url : "") ||
		(isRecord(payload) && typeof payload.url === "string" ? payload.url : "");

	if (!response.ok || !url) {
		const message =
			isRecord(payload) && typeof payload.message === "string"
				? payload.message
				: "图片上传失败，请稍后重试";
		throw new Error(message);
	}

	return url;
}

export function normalizeGuestbookTimestamp(value: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return Date.now();
	return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function decodeReplyNick(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function parseGuestbookMessageBody(raw: string): {
	body: string;
	replyToId?: string;
	replyToNick?: string;
} {
	const match = raw.match(REPLY_MARKER);
	if (!match) return { body: raw.trim() };

	return {
		body: raw.replace(REPLY_MARKER, "").trim(),
		replyToId: match[1],
		replyToNick: decodeReplyNick(match[2]),
	};
}

function htmlToPlainText(value: string): string {
	if (typeof DOMParser === "undefined") return value;
	return (
		new DOMParser()
			.parseFromString(value, "text/html")
			.body.textContent?.trim() ?? ""
	);
}

function normalizeGuestbookLink(
	value: string | null | undefined,
): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}

export function normalizeGuestbookComment(
	comment: WalineComment,
): GuestbookChatMessage {
	const parsed = parseGuestbookMessageBody(
		comment.orig || htmlToPlainText(comment.comment),
	);

	return {
		id: String(comment.objectId),
		objectId: comment.objectId,
		nick: comment.nick || "匿名访客",
		avatar: comment.avatar || "",
		link: normalizeGuestbookLink(comment.link),
		body: parsed.body,
		createdAt: normalizeGuestbookTimestamp(comment.time),
		browser: comment.browser,
		os: comment.os,
		addr: comment.addr,
		label: comment.label,
		isAdmin: comment.type === "administrator",
		replyToId: parsed.replyToId,
		replyToNick: parsed.replyToNick,
		status: comment.status,
	};
}

export function flattenGuestbookComments(
	roots: WalineRootComment[],
): GuestbookChatMessage[] {
	return roots
		.flatMap((root) => [
			normalizeGuestbookComment(root),
			...root.children.map(normalizeGuestbookComment),
		])
		.sort((left, right) => left.createdAt - right.createdAt);
}

export function mergeGuestbookMessages(
	current: GuestbookChatMessage[],
	incoming: GuestbookChatMessage[],
): GuestbookChatMessage[] {
	const localMessages = current.filter((message) => message.localState);
	const serverMessages = new Map(
		current
			.filter((message) => !message.localState)
			.map((message) => [message.id, message]),
	);

	for (const message of incoming) serverMessages.set(message.id, message);

	return [...serverMessages.values(), ...localMessages].sort(
		(left, right) => left.createdAt - right.createdAt,
	);
}

export function buildGuestbookMessageBody(
	content: string,
	target: GuestbookChatMessage | null,
): string {
	if (!target?.objectId) return content;
	const marker = `<!--guestbook-reply:${target.objectId}:${encodeURIComponent(target.nick)}-->`;
	return `${marker}\n@${target.nick} ${content}`;
}

export function getGuestbookErrorMessage(error: unknown): string {
	if (error instanceof DOMException && error.name === "AbortError") return "";
	if (error instanceof Error) {
		const message = error.message;
		if (/failed to fetch|networkerror|network request/iu.test(message)) {
			return "无法连接到留言服务，请检查网络后重试";
		}
		if (/(401|403|unauthorized|forbidden|token|登录)/iu.test(message)) {
			return "登录状态已失效，请重新登录";
		}
		if (/(429|too many|rate limit|频繁)/iu.test(message)) {
			return "操作过于频繁，请稍后再试";
		}
		if (/(required|word|length|content|字数|内容)/iu.test(message)) {
			return "消息内容不符合留言服务要求，请检查后重试";
		}
	}
	return "留言服务暂时不可用，请稍后重试";
}

export function isGuestbookAuthError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/(401|403|unauthorized|forbidden|token|登录)/iu.test(error.message)
	);
}

export function getGuestbookInitials(name: string): string {
	return Array.from(name.trim() || "访")
		.slice(0, 2)
		.join("")
		.toUpperCase();
}
