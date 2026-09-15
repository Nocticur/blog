import type {
	MailAttachment,
	MailDetail,
	MailListResponse,
	MailMessage,
	MailSession,
} from "@/types/mail";

const MAIL_API_BASE_URL = "/api";
type MailRequestOptions = {
	path: string;
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	body?: unknown;
	token?: string;
	signal?: AbortSignal;
};

export class MailApiError extends Error {
	readonly status?: number;
	readonly code?: string;

	constructor(message: string, status?: number, code?: string) {
		super(message);
		this.name = "MailApiError";
		this.status = status;
		this.code = code;
	}
}

function normalizeMailMessage(value: unknown, index: number): MailMessage {
	if (!value || typeof value !== "object") {
		return { id: `mail-${index + 1}` };
	}

	const mail = value as Record<string, unknown>;
	const id =
		typeof mail.id === "string" || typeof mail.id === "number"
			? String(mail.id)
			: `mail-${index + 1}`;

	return {
		id,
		subject: typeof mail.subject === "string" ? mail.subject : undefined,
		sender: typeof mail.sender === "string" ? mail.sender : undefined,
		address: typeof mail.address === "string" ? mail.address : undefined,
		created_at:
			typeof mail.created_at === "string" || typeof mail.created_at === "number"
				? mail.created_at
				: undefined,
		is_unread:
			typeof mail.is_unread === "boolean"
				? mail.is_unread
				: mail.is_unread === 0 || mail.is_unread === 1
					? mail.is_unread === 1
					: undefined,
		metadata: mail.metadata,
	};
}

function normalizeAttachment(value: unknown): MailAttachment | null {
	if (!value || typeof value !== "object") return null;
	const attachment = value as Record<string, unknown>;
	return {
		filename:
			typeof attachment.filename === "string" ? attachment.filename : undefined,
		mimeType:
			typeof attachment.mimeType === "string"
				? attachment.mimeType
				: typeof attachment.content_type === "string"
					? attachment.content_type
					: undefined,
		disposition:
			typeof attachment.disposition === "string"
				? attachment.disposition
				: undefined,
		size: typeof attachment.size === "number" ? attachment.size : undefined,
	};
}

async function request<T>({
	path,
	method = "GET",
	body,
	token,
	signal,
}: MailRequestOptions): Promise<T> {
	const headers = new Headers({
		accept: "application/json",
		"x-lang": "zh-CN",
	});

	if (token) headers.set("authorization", `Bearer ${token}`);
	if (body !== undefined) headers.set("content-type", "application/json");

	let response: Response;
	try {
		response = await fetch(`${MAIL_API_BASE_URL}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error;
		throw new MailApiError("无法连接邮箱服务，请检查网络后重试。");
	}

	if (response.headers.get("cf-mitigated") === "challenge") {
		throw new MailApiError(
			"邮箱服务需要安全验证，暂时无法连接。请稍后重试或联系站点管理员。",
			response.status,
			"UPSTREAM_CHALLENGE",
		);
	}
	if (response.headers.get("content-type")?.includes("text/html")) {
		throw new MailApiError(
			"邮箱服务返回了网页，暂时无法加载邮件。请稍后重试或联系站点管理员。",
			502,
			"INVALID_RESPONSE",
		);
	}
	const rawBody = await response.text();
	let parsedBody: unknown = null;
	if (rawBody) {
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			if (response.ok) {
				throw new MailApiError(
					"邮箱服务返回了无效的数据。",
					502,
					"INVALID_RESPONSE",
				);
			}
			parsedBody = rawBody;
		}
	}

	if (!response.ok) {
		let message = "邮箱服务返回错误。";
		let code: string | undefined;
		if (parsedBody && typeof parsedBody === "object") {
			const responseBody = parsedBody as Record<string, unknown>;
			if (typeof responseBody.message === "string" && responseBody.message) {
				message = responseBody.message;
			} else if (typeof responseBody.error === "string" && responseBody.error) {
				message = responseBody.error;
			}
			if (
				typeof responseBody.code === "string" ||
				typeof responseBody.code === "number"
			) {
				code = String(responseBody.code);
			}
		} else if (typeof parsedBody === "string" && parsedBody) {
			message = parsedBody;
		}
		throw new MailApiError(message, response.status, code);
	}

	return parsedBody as T;
}

export async function createMailbox(
	domain?: string,
	signal?: AbortSignal,
): Promise<MailSession> {
	const body = domain ? { domain } : {};
	const response = await request<Partial<MailSession>>({
		path: "/new_address",
		method: "POST",
		body,
		signal,
	});

	if (
		!response ||
		typeof response.address !== "string" ||
		typeof response.jwt !== "string" ||
		!response.address.trim() ||
		!response.jwt.trim()
	) {
		throw new MailApiError("邮箱服务返回了无效的邮箱会话。", 502);
	}
	return { address: response.address, jwt: response.jwt };
}

export async function getMailboxMessages(
	token: string,
	signal?: AbortSignal,
): Promise<MailListResponse> {
	const response = await request<Partial<MailListResponse>>({
		path: "/parsed_mails?limit=30&offset=0",
		token,
		signal,
	});

	if (!response || !Array.isArray(response.results)) {
		throw new MailApiError(
			"邮箱服务返回了无效的邮件列表。",
			502,
			"INVALID_RESPONSE",
		);
	}
	const results = response.results;
	return {
		results: results.map(normalizeMailMessage),
		count: typeof response.count === "number" ? response.count : results.length,
	};
}

export async function getMailMessage(
	id: string,
	token: string,
	signal?: AbortSignal,
): Promise<MailDetail> {
	const detail = await request<MailDetail>({
		path: `/parsed_mail/${encodeURIComponent(id)}`,
		token,
		signal,
	});
	if (!detail) throw new MailApiError("这封邮件已不存在，请刷新收件箱。", 404);

	return {
		sender: typeof detail.sender === "string" ? detail.sender : undefined,
		subject: typeof detail.subject === "string" ? detail.subject : undefined,
		text: typeof detail.text === "string" ? detail.text : undefined,
		html: typeof detail.html === "string" ? detail.html : undefined,
		attachments: Array.isArray(detail.attachments)
			? detail.attachments
					.map(normalizeAttachment)
					.filter((item): item is MailAttachment => item !== null)
			: [],
	};
}

export async function markMailRead(id: string, token: string): Promise<void> {
	await request({
		path: `/mails/${encodeURIComponent(id)}/read`,
		method: "PATCH",
		body: { isUnread: false },
		token,
	});
}

export async function deleteMailMessage(
	id: string,
	token: string,
): Promise<void> {
	await request({
		path: `/mails/${encodeURIComponent(id)}`,
		method: "DELETE",
		token,
	});
}

export async function clearMailbox(token: string): Promise<void> {
	await request({
		path: "/clear_inbox",
		method: "DELETE",
		token,
	});
}

export async function deleteMailbox(token: string): Promise<void> {
	await request({
		path: "/delete_address",
		method: "DELETE",
		token,
	});
}
