import type {
	MailAttachment,
	MailAdminDomainConfig,
	MailAuthConfig,
	MailDetail,
	MailListResponse,
	MailMessage,
	MailUserProfile,
} from "@/types/mail";

const MAIL_API_BASE_URL = "/api/mail-auth";
type MailRequestOptions = {
	path: string;
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	body?: unknown;
	signal?: AbortSignal;
};

export class MailApiError extends Error {
	readonly status?: number;
	readonly code?: string;
	readonly retryAfterSeconds?: number;

	constructor(
		message: string,
		status?: number,
		code?: string,
		retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "MailApiError";
		this.status = status;
		this.code = code;
		this.retryAfterSeconds = retryAfterSeconds;
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

// 会话使用同源 HttpOnly Cookie，前端从不接触上游令牌；
// fetch 默认同源携带 Cookie，这里显式声明以保证语义。
async function request<T>({
	path,
	method = "GET",
	body,
	signal,
}: MailRequestOptions): Promise<T> {
	const headers = new Headers({
		accept: "application/json",
	});

	if (body !== undefined) headers.set("content-type", "application/json");

	let response: Response;
	try {
		response = await fetch(`${MAIL_API_BASE_URL}${path}`, {
			method,
			headers,
			credentials: "same-origin",
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
		const retryAfterHeader = response.headers.get("retry-after");
		const retryAfterSeconds = retryAfterHeader
			? Number(retryAfterHeader)
			: undefined;
		throw new MailApiError(
			message,
			response.status,
			code,
			Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
		);
	}

	return parsedBody as T;
}

function validDomainList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	return value.every((domain) => typeof domain === "string" && domain.includes("."))
		? (value as string[])
		: null;
}

export async function getMailAuthConfig(
	signal?: AbortSignal,
): Promise<MailAuthConfig> {
	const response = await request<Partial<MailAuthConfig>>({
		path: "/config",
		signal,
	});
	const domains = validDomainList(response?.domains);
	if (!domains) {
		throw new MailApiError(
			"邮箱服务返回了无效的注册配置。",
			502,
			"INVALID_RESPONSE",
		);
	}
	// 登录侧域名清单缺失时回退注册清单，保证登录表单始终可用
	const loginDomains = validDomainList(response?.loginDomains) ?? domains;
	const intOr = (value: unknown, fallback: number) =>
		typeof value === "number" && Number.isInteger(value) && value > 0
			? value
			: fallback;
	return {
		domains,
		loginDomains,
		addressMinLength: intOr(response?.addressMinLength, 3),
		addressMaxLength: intOr(response?.addressMaxLength, 30),
		passwordMinLength: intOr(response?.passwordMinLength, 8),
	};
}

// 管理员创建（地址 / 用户账号）可用的后缀清单，须凭管理员会话获取
export async function getMailAdminConfig(
	signal?: AbortSignal,
): Promise<MailAdminDomainConfig> {
	const response = await request<Partial<MailAdminDomainConfig>>({
		path: "/admin/config",
		signal,
	});
	const domains = validDomainList(response?.domains);
	if (!domains || !response?.defaultDomain || !domains.includes(response.defaultDomain)) {
		throw new MailApiError(
			"邮箱服务返回了无效的管理员域名配置。",
			502,
			"INVALID_RESPONSE",
		);
	}
	return { domains, defaultDomain: response.defaultDomain };
}

export async function registerMailbox(
	name: string,
	domain: string,
	password: string,
	signal?: AbortSignal,
): Promise<{ address: string }> {
	const response = await request<{ address?: unknown }>({
		path: "/register",
		method: "POST",
		body: { name, domain, password },
		signal,
	});
	if (
		!response ||
		typeof response.address !== "string" ||
		!response.address.trim()
	) {
		throw new MailApiError("注册返回了无效的数据。", 502, "INVALID_RESPONSE");
	}
	return { address: response.address };
}

export async function loginMailbox(
	email: string,
	password: string,
	signal?: AbortSignal,
): Promise<MailUserProfile> {
	const response = await request<{ profile?: Partial<MailUserProfile> }>({
		path: "/login",
		method: "POST",
		body: { email, password },
		signal,
	});
	if (!response?.profile || typeof response.profile.address !== "string") {
		throw new MailApiError("登录返回了无效的数据。", 502, "INVALID_RESPONSE");
	}
	return { address: response.profile.address };
}

export async function getMailSession(
	signal?: AbortSignal,
): Promise<MailUserProfile> {
	const response = await request<{ profile?: Partial<MailUserProfile> }>({
		path: "/session",
		signal,
	});
	if (!response?.profile || typeof response.profile.address !== "string") {
		throw new MailApiError("会话返回了无效的数据。", 502, "INVALID_RESPONSE");
	}
	return { address: response.profile.address };
}

export async function logoutMailbox(): Promise<void> {
	await request({ path: "/logout", method: "POST" });
}

export async function getMailboxMessages(
	signal?: AbortSignal,
): Promise<MailListResponse> {
	const response = await request<Partial<MailListResponse>>({
		path: "/mails?limit=30&offset=0",
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
	signal?: AbortSignal,
): Promise<MailDetail> {
	const detail = await request<MailDetail>({
		path: `/mails/${encodeURIComponent(id)}`,
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

export async function markMailRead(id: string): Promise<void> {
	await request({
		path: `/mails/${encodeURIComponent(id)}/read`,
		method: "PATCH",
		body: { isUnread: false },
	});
}

export async function deleteMailMessage(id: string): Promise<void> {
	await request({
		path: `/mails/${encodeURIComponent(id)}`,
		method: "DELETE",
	});
}

export async function clearMailbox(): Promise<void> {
	await request({
		path: "/inbox",
		method: "DELETE",
	});
}
