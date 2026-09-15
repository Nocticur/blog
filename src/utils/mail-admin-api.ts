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

async function request<T>(
	path: string,
	options: { method?: string; body?: unknown } = {},
): Promise<T> {
	const response = await fetch(`/api/mail-admin${path}`, {
		method: options.method || (options.body === undefined ? "GET" : "POST"),
		credentials: "same-origin",
		headers: {
			accept: "application/json",
			...(options.body === undefined
				? {}
				: { "content-type": "application/json" }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	let payload: unknown = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		payload = text;
	}
	if (!response.ok) {
		const body =
			payload && typeof payload === "object"
				? (payload as Record<string, unknown>)
				: null;
		const message =
			(typeof body?.error === "string" && body.error) ||
			(typeof body?.message === "string" && body.message) ||
			(typeof payload === "string" && payload) ||
			"管理请求失败";
		throw new MailAdminError(message, response.status);
	}
	return payload as T;
}

export function getAdminSession() {
	return request<{ profile: MailAdminProfile }>("/session");
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
	options: { method?: string; body?: unknown } = {},
) {
	if (!path.startsWith("/admin/")) {
		throw new Error("管理接口路径无效");
	}
	return request<T>(path, options);
}
