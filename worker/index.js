import {
	clearSessionCookie,
	createSessionCookie,
	readSessionCookie,
} from "./mail-admin-session.js";

const MAIL_API_ORIGIN = "https://apimail.noctis.eu.cc";
const MAIL_API_PATH =
	/^\/api\/(?:new_address|parsed_mails|parsed_mail\/[^/]+|mails\/[^/]+(?:\/read)?|clear_inbox|delete_address)$/;
const MAIL_ADMIN_PATH = /^\/api\/mail-admin(?:\/|$)/;
const ADMIN_ROLE = "master";
let bootstrapInFlight = null;
const loginFailures = new Map();
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

const FORWARDED_REQUEST_HEADERS = new Set([
	"accept",
	"accept-language",
	"authorization",
	"content-type",
	"x-custom-auth",
	"x-lang",
]);

function proxyRequestHeaders(request) {
	const headers = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	headers.set("origin", MAIL_API_ORIGIN);
	headers.set("referer", `${MAIL_API_ORIGIN}/`);
	return headers;
}

function proxyResponseHeaders(response) {
	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	headers.delete("set-cookie");
	headers.set("cache-control", "no-store");
	return headers;
}

function emptyServiceWorkerResponse() {
	return new Response("", {
		status: 200,
		headers: {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

function jsonResponse(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...headers,
		},
	});
}

function requestOriginAllowed(request) {
	const origin = request.headers.get("origin");
	return origin === new URL(request.url).origin;
}

async function readJsonBody(request) {
	try {
		const body = await request.json();
		return body && typeof body === "object" && !Array.isArray(body) ? body : {};
	} catch {
		return {};
	}
}

async function sha256Hex(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function upstreamRequest(pathname, request, options = {}) {
	const targetUrl = new URL(MAIL_API_ORIGIN);
	targetUrl.pathname = pathname;
	if (options.search) targetUrl.search = options.search;
	const headers = new Headers(options.headers || {});
	headers.set("origin", MAIL_API_ORIGIN);
	headers.set("referer", MAIL_API_ORIGIN + "/");
	const init = {
		method: options.method || request.method,
		headers,
		redirect: "follow",
	};
	if (options.body !== undefined) init.body = JSON.stringify(options.body);
	else if (!["GET", "HEAD"].includes(init.method.toUpperCase()) && request.body) init.body = await request.arrayBuffer();
	return fetch(targetUrl, init);
}

async function readUpstreamJson(response) {
	const text = await response.text();
	let body = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	return { body, text };
}

function upstreamMessage(body, fallback) {
	if (body && typeof body === "object") {
		if (typeof body.message === "string" && body.message) return body.message;
		if (typeof body.error === "string" && body.error) return body.error;
	}
	return typeof body === "string" && body ? body : fallback;
}

function loginAttemptKey(request, email) {
	const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
	return `${forwarded.split(",")[0].trim()}:${email}`;
}

function loginRateLimitResponse(request, email) {
	const key = loginAttemptKey(request, email);
	const current = loginFailures.get(key);
	if (!current || Date.now() - current.startedAt >= LOGIN_FAILURE_WINDOW_MS) {
		loginFailures.delete(key);
		return null;
	}
	if (current.count >= LOGIN_FAILURE_LIMIT) {
		const retryAfter = Math.max(1, Math.ceil((LOGIN_FAILURE_WINDOW_MS - (Date.now() - current.startedAt)) / 1000));
		return jsonResponse({ error: "登录失败次数过多，请稍后再试" }, 429, { "retry-after": String(retryAfter) });
	}
	return null;
}

function recordLoginFailure(request, email) {
	const key = loginAttemptKey(request, email);
	const current = loginFailures.get(key);
	if (!current || Date.now() - current.startedAt >= LOGIN_FAILURE_WINDOW_MS) {
		loginFailures.set(key, { count: 1, startedAt: Date.now() });
		return;
	}
	current.count += 1;
}

function clearLoginFailures(request, email) {
	loginFailures.delete(loginAttemptKey(request, email));
}

async function finishAdminLogin(email, password, env, request) {
	const limited = loginRateLimitResponse(request, email);
	if (limited) return limited;
	const loginResponse = await upstreamRequest("/user_api/login", request, {
		method: "POST",
		body: { email, password: await sha256Hex(password) },
		headers: { "content-type": "application/json", accept: "application/json" },
	});
	const login = await readUpstreamJson(loginResponse);
	if (!loginResponse.ok || !login.body?.jwt) {
		recordLoginFailure(request, email);
		return jsonResponse(
			{ error: upstreamMessage(login.body, "邮箱或密码错误") },
			loginResponse.status === 401 || loginResponse.status === 400 ? 401 : 502,
		);
	}

	const userToken = String(login.body.jwt);
	const settingsResponse = await upstreamRequest("/user_api/settings", request, {
		method: "GET",
		headers: { accept: "application/json", "x-user-token": userToken },
	});
	const settings = await readUpstreamJson(settingsResponse);
	if (!settingsResponse.ok) {
		return jsonResponse(
			{ error: upstreamMessage(settings.body, "无法读取管理员身份") },
			settingsResponse.status,
		);
	}
	if (settings.body?.is_admin !== true || typeof settings.body?.access_token !== "string") {
		return jsonResponse({ error: "该账号没有管理员权限" }, 403);
	}
	clearLoginFailures(request, email);

	const session = {
		userToken,
		accessToken: settings.body.access_token,
		email: String(settings.body.user_email || email),
		userId: Number(settings.body.user_id || 0),
		role: String(settings.body.user_role?.role || ADMIN_ROLE),
		expiresAt: Date.now() + 60 * 60 * 1000,
	};
	const cookie = await createSessionCookie(session, env.MAIL_ADMIN_SESSION_SECRET);
	return jsonResponse(
		{ profile: { email: session.email, userId: session.userId, role: session.role } },
		200,
		{ "set-cookie": cookie },
	);
}

async function getAdminContext(request, env) {
	const session = await readSessionCookie(
		request.headers.get("cookie"),
		env.MAIL_ADMIN_SESSION_SECRET,
	);
	if (!session) return { response: jsonResponse({ error: "管理员会话已过期" }, 401) };

	const settingsResponse = await upstreamRequest("/user_api/settings", request, {
		method: "GET",
		headers: { accept: "application/json", "x-user-token": session.userToken },
	});
	const settings = await readUpstreamJson(settingsResponse);
	if (!settingsResponse.ok || settings.body?.is_admin !== true) {
		return {
			response: jsonResponse(
				{ error: settingsResponse.ok ? "管理员权限已撤销" : upstreamMessage(settings.body, "管理员会话已失效") },
				settingsResponse.ok ? 403 : 401,
				{ "set-cookie": clearSessionCookie() },
			),
		};
	}
	if (typeof settings.body?.access_token !== "string") {
		return { response: jsonResponse({ error: "管理员访问令牌无效" }, 401, { "set-cookie": clearSessionCookie() }) };
	}
	const refreshed = {
		...session,
		accessToken: settings.body.access_token,
		email: String(settings.body.user_email || session.email),
		userId: Number(settings.body.user_id || session.userId),
		role: String(settings.body.user_role?.role || session.role),
		expiresAt: Date.now() + 60 * 60 * 1000,
	};
	return {
		session: refreshed,
		refreshCookie: await createSessionCookie(refreshed, env.MAIL_ADMIN_SESSION_SECRET),
	};
}

async function handleBootstrap(request, env) {
	if (!requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
	if (bootstrapInFlight) return bootstrapInFlight;
	bootstrapInFlight = (async () => {
		const body = await readJsonBody(request);
		const adminPassword = typeof body.adminPassword === "string" ? body.adminPassword : "";
		const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
		const password = typeof body.password === "string" ? body.password : "";
		if (!adminPassword || !email || !password) return jsonResponse({ error: "请填写管理员口令、邮箱和密码" }, 400);
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
			return jsonResponse({ error: "邮箱格式无效或密码少于 6 位" }, 400);
		}
		const limited = loginRateLimitResponse(request, email);
		if (limited) return limited;

		const created = await upstreamRequest("/admin/bootstrap", request, {
			method: "POST",
			body: { email, password: await sha256Hex(password) },
			headers: { accept: "application/json", "content-type": "application/json", "x-admin-auth": adminPassword },
		});
		const createdBody = await readUpstreamJson(created);
		if (!created.ok) {
			if (created.status === 401 || created.status === 403) recordLoginFailure(request, email);
			return jsonResponse({ error: upstreamMessage(createdBody.body, "创建管理员账号失败") }, created.status === 401 ? 401 : created.status);
		}
		const login = await finishAdminLogin(email, password, env, request);
		return login.ok ? login : jsonResponse({ error: "账号已创建，请返回登录" }, 502);
	})();
	try {
		return await bootstrapInFlight;
	} finally {
		bootstrapInFlight = null;
	}
}

async function handleMailAdmin(request, env) {
	const { pathname, search } = new URL(request.url);
	const suffix = pathname.slice("/api/mail-admin".length);
	if (pathname === "/api/mail-admin/login" && request.method === "POST") {
		if (!requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
		const body = await readJsonBody(request);
		const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
		const password = typeof body.password === "string" ? body.password : "";
		if (!email || !password) return jsonResponse({ error: "请输入邮箱和密码" }, 400);
		return finishAdminLogin(email, password, env, request);
	}
	if (pathname === "/api/mail-admin/bootstrap" && request.method === "POST") return handleBootstrap(request, env);
	if (pathname === "/api/mail-admin/logout" && request.method === "POST") {
		if (!requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
		return jsonResponse({ success: true }, 200, { "set-cookie": clearSessionCookie() });
	}
	if (pathname === "/api/mail-admin/session" && request.method === "GET") {
		const context = await getAdminContext(request, env);
		if (context.response) return context.response;
		return jsonResponse(
			{ profile: { email: context.session.email, userId: context.session.userId, role: context.session.role } },
			200,
			{ "set-cookie": context.refreshCookie },
		);
	}
	if (suffix.startsWith("/admin/") && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
		if (request.method !== "GET" && !requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
		const context = await getAdminContext(request, env);
		if (context.response) return context.response;
		const headers = new Headers();
		for (const name of ["accept", "content-type", "x-lang"]) {
			const value = request.headers.get(name);
			if (value) headers.set(name, value);
		}
		headers.set("x-user-access-token", context.session.accessToken);
		const upstream = await upstreamRequest(suffix, request, { search: search.slice(1), headers });
		const responseHeaders = proxyResponseHeaders(upstream);
		responseHeaders.set("set-cookie", context.refreshCookie);
		return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
	}
	return jsonResponse({ error: "管理接口不存在" }, 404);
}

async function proxyMailApi(request) {
	const requestUrl = new URL(request.url);
	const targetUrl = new URL(MAIL_API_ORIGIN);
	const pathname = requestUrl.pathname;
	targetUrl.pathname = pathname || "/";
	targetUrl.search = requestUrl.search;

	const method = request.method.toUpperCase();
	const init = {
		method,
		headers: proxyRequestHeaders(request),
		redirect: "follow",
	};
	if (method !== "GET" && method !== "HEAD") init.body = request.body;

	const response = await fetch(targetUrl, init);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: proxyResponseHeaders(response),
	});
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

		if (pathname === "/registerSW.js" || pathname === "/sw.js") {
			return emptyServiceWorkerResponse();
		}

		if (MAIL_ADMIN_PATH.test(pathname)) {
			return handleMailAdmin(request, env);
		}

		if (MAIL_API_PATH.test(pathname)) {
			return proxyMailApi(request);
		}

		return env.ASSETS.fetch(request);
	},
};
