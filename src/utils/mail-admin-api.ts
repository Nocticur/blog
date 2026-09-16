export type MailAdminProfile = {
	email: string;
	userId: number;
	role: string;
};

export type MailAdminList<T> = {
	results: T[];
	count: number;
};

export class MailAdminError extends Error {
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "MailAdminError";
		this.status = status;
	}
}

const MAX_ERROR_TEXT = 300;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

// 只接受纯文本业务错误信息；HTML 错误页、带标签或超长的正文一律不展示
function cleanErrorText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text || text.length > MAX_ERROR_TEXT) return null;
	if (/[<>]/.test(text) || text.includes("\uFFFD")) return null;
	return text;
}

function extractUpstreamError(payload: unknown): string | null {
	if (!isPlainObject(payload)) {
		return cleanErrorText(payload);
	}
	if (typeof payload.error === "string") return cleanErrorText(payload.error);
	if (typeof payload.message === "string") {
		return cleanErrorText(payload.message);
	}
	// error/message 为嵌套对象（如网关的结构化 404）时不属于业务错误信息，
	// 交给调用方按“失败模块 + HTTP 状态”生成提示
	return null;
}

async function request<T>(
	path: string,
	options: { method?: string; body?: unknown; module?: string } = {},
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`/api/mail-admin${path}`, {
			method: options.method || (options.body === undefined ? "GET" : "POST"),
			credentials: "same-origin",
			headers: {
				accept: "application/json",
				...(options.body === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			body:
				options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	} catch {
		throw new MailAdminError(
			`${options.module ?? "管理"}请求发送失败，请检查网络后重试。`,
		);
	}
	const text = await response.text();
	let payload: unknown = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		payload = text;
	}
	if (!response.ok) {
		const upstreamError = extractUpstreamError(payload);
		const message =
			upstreamError ??
			(options.module
				? `${options.module}加载失败（HTTP ${response.status}）`
				: `管理请求失败（HTTP ${response.status}）`);
		throw new MailAdminError(message, response.status);
	}
	return payload as T;
}

// 成功响应也必须是 JSON 对象：空正文、HTML 或结构异常一律拒绝，
// 由调用方按模块显示“加载失败”，避免把无效数据当作真实计数或开关状态。
export function parseJsonObject(
	payload: unknown,
	moduleLabel: string,
): Record<string, unknown> {
	if (!isPlainObject(payload)) {
		throw new MailAdminError(
			`${moduleLabel}返回了无法解析的数据，已拒绝使用。`,
			200,
		);
	}
	return payload;
}

export function getAdminSession() {
	return request<{ profile: MailAdminProfile }>("/session", {
		module: "会话",
	});
}

export function loginAdmin(email: string, password: string) {
	return request<{ profile: MailAdminProfile }>("/login", {
		method: "POST",
		body: { email, password },
	});
}

export function bootstrapAdmin(
	adminPassword: string,
	email: string,
	password: string,
) {
	return request<{ profile: MailAdminProfile }>("/bootstrap", {
		method: "POST",
		body: { adminPassword, email, password },
	});
}

export function logoutAdmin() {
	return request<{ success: boolean }>("/logout", { method: "POST" });
}

export function adminRequest<T = unknown>(
	path: string,
	options: { method?: string; body?: unknown; module?: string } = {},
) {
	if (!path.startsWith("/admin/")) {
		throw new Error("管理接口路径无效");
	}
	return request<T>(path, options);
}
