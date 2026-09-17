import {
	clearUserSessionCookie,
	createUserSessionCookie,
	readUserSessionCookie,
} from "./mail-user-session.js";

// 普通用户可注册的公开域名白名单；mourn.top 仅管理员可创建，
// 但已创建的该域邮箱使用地址密码正常登录，登录侧不限域名。
export const MAIL_PUBLIC_DOMAINS = ["nocticur.eu.cc", "noctis.eu.cc", "caelus.eu.cc"];
export const MAIL_ALL_DOMAINS = [...MAIL_PUBLIC_DOMAINS, "mourn.top"];
export const MAIL_ADMIN_DEFAULT_DOMAIN = "mourn.top";

const DEFAULT_UPSTREAM_ORIGIN = "https://apimail.noctis.eu.cc";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ADDRESS_MIN_LENGTH = 3;
const ADDRESS_MAX_LENGTH = 30;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 64;
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 注册与登录的服务端限流（进程内存级，节点重启或多实例时为尽力而为）
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const registerAttempts = new Map();
const loginFailures = new Map();

function upstreamOrigin(env) {
	const value = typeof env?.MAIL_UPSTREAM_ORIGIN === "string" ? env.MAIL_UPSTREAM_ORIGIN.trim() : "";
	return value || DEFAULT_UPSTREAM_ORIGIN;
}

function sessionSecret(env) {
	const value =
		(typeof env?.MAIL_USER_SESSION_SECRET === "string" && env.MAIL_USER_SESSION_SECRET) ||
		(typeof env?.MAIL_ADMIN_SESSION_SECRET === "string" && env.MAIL_ADMIN_SESSION_SECRET) ||
		"";
	return value;
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

function clientKey(request) {
	const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
	return forwarded.split(",")[0].trim() || "unknown";
}

function windowEntry(map, key, windowMs) {
	const current = map.get(key);
	if (!current || Date.now() - current.startedAt >= windowMs) {
		map.delete(key);
		return null;
	}
	return current;
}

function registerRateLimitResponse(request) {
	const key = clientKey(request);
	const current = windowEntry(registerAttempts, key, REGISTER_WINDOW_MS);
	if (current && current.count >= REGISTER_LIMIT) {
		const retryAfter = Math.max(1, Math.ceil((REGISTER_WINDOW_MS - (Date.now() - current.startedAt)) / 1000));
		return jsonResponse({ error: "注册尝试过于频繁，请稍后再试" }, 429, { "retry-after": String(retryAfter) });
	}
	return null;
}

function recordRegisterAttempt(request) {
	const key = clientKey(request);
	const current = windowEntry(registerAttempts, key, REGISTER_WINDOW_MS);
	if (current) current.count += 1;
	else registerAttempts.set(key, { count: 1, startedAt: Date.now() });
}

function loginRateLimitResponse(request, email) {
	const key = `${clientKey(request)}:${email}`;
	const current = windowEntry(loginFailures, key, LOGIN_FAILURE_WINDOW_MS);
	if (current && current.count >= LOGIN_FAILURE_LIMIT) {
		const retryAfter = Math.max(1, Math.ceil((LOGIN_FAILURE_WINDOW_MS - (Date.now() - current.startedAt)) / 1000));
		return jsonResponse({ error: "登录失败次数过多，请稍后再试" }, 429, { "retry-after": String(retryAfter) });
	}
	return null;
}

function recordLoginFailure(request, email) {
	const key = `${clientKey(request)}:${email}`;
	const current = windowEntry(loginFailures, key, LOGIN_FAILURE_WINDOW_MS);
	if (current) current.count += 1;
	else loginFailures.set(key, { count: 1, startedAt: Date.now() });
}

function clearLoginFailures(request, email) {
	loginFailures.delete(`${clientKey(request)}:${email}`);
}

function upstreamMessage(body, fallback) {
	if (body && typeof body === "object") {
		if (typeof body.message === "string" && body.message) return body.message;
		if (typeof body.error === "string" && body.error) return body.error;
	}
	return typeof body === "string" && body ? body : fallback;
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

function isChallenge(response) {
	return response.headers.get("cf-mitigated") === "challenge";
}

function upstreamHeaders(env, extra = {}) {
	const origin = upstreamOrigin(env);
	return new Headers({
		accept: "application/json",
		"x-lang": "zh-CN",
		origin,
		referer: `${origin}/`,
		...extra,
	});
}

// 原子注册：邮箱地址与密码凭据在同一条 INSERT 中写入，唯一约束保证
// 重名返回冲突且绝不覆盖已有邮箱，也不存在"只有地址没有密码"的中间状态。
// 优先使用同账号 D1 绑定（MAIL_DB），否则回退 D1 HTTP API。
async function insertAddressRow(env, name, passwordHash, sourceMeta) {
	const sql = "INSERT INTO address (name, password, source_meta) VALUES (?, ?, ?)";
	if (env?.MAIL_DB && typeof env.MAIL_DB.prepare === "function") {
		try {
			await env.MAIL_DB.prepare(sql).bind(name, passwordHash, sourceMeta).run();
			return { ok: true };
		} catch (error) {
			return { ok: false, conflict: /UNIQUE/i.test(String(error?.message ?? "")) };
		}
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID;
	const databaseId = env?.CLOUDFLARE_D1_DATABASE_ID;
	const apiToken = env?.CLOUDFLARE_D1_API_TOKEN;
	if (!accountId || !databaseId || !apiToken) {
		return { ok: false, misconfigured: true };
	}
	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
			{
				method: "POST",
				headers: new Headers({
					authorization: `Bearer ${apiToken}`,
					"content-type": "application/json",
				}),
				body: JSON.stringify({ sql, params: [name, passwordHash, sourceMeta] }),
			},
		);
		const body = await readUpstreamJson(response);
		if (!response.ok || body.body?.success !== true) {
			const message = Array.isArray(body.body?.errors) ? String(body.body.errors[0]?.message ?? "") : "";
			return { ok: false, conflict: /UNIQUE/i.test(message), invalidToken: response.status === 401 || response.status === 403 };
		}
		return { ok: true };
	} catch {
		return { ok: false, network: true };
	}
}

async function handleRegister(request, env) {
	if (!requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
	const limited = registerRateLimitResponse(request);
	if (limited) return limited;
	const body = await readJsonBody(request);
	const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
	const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	if (!name || !domain || !password) {
		return jsonResponse({ error: "请填写邮箱前缀、域名和密码" }, 400);
	}
	if (!NAME_PATTERN.test(name) || name.length < ADDRESS_MIN_LENGTH || name.length > ADDRESS_MAX_LENGTH) {
		return jsonResponse(
			{ error: `邮箱前缀需为 ${ADDRESS_MIN_LENGTH}-${ADDRESS_MAX_LENGTH} 位小写字母、数字或 . _ -，并以字母或数字开头结尾` },
			400,
		);
	}
	if (!MAIL_PUBLIC_DOMAINS.includes(domain)) {
		return jsonResponse({ error: "该域名不支持注册" }, 403);
	}
	if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
		return jsonResponse({ error: `密码长度需在 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位之间` }, 400);
	}

	recordRegisterAttempt(request);
	const address = `${name}@${domain}`;
	const sourceMeta = clientKey(request);
	const result = await insertAddressRow(env, address, await sha256Hex(password), sourceMeta);
	if (result.conflict) return jsonResponse({ error: "该邮箱地址已被注册，请换一个前缀或域名" }, 409);
	if (result.misconfigured) {
		return jsonResponse({ error: "注册服务未配置（缺少 D1 凭据），请联系站点管理员" }, 500);
	}
	if (result.invalidToken) {
		return jsonResponse({ error: "注册服务凭据无效，请联系站点管理员" }, 500);
	}
	if (!result.ok) {
		return jsonResponse({ error: "暂时无法完成注册，请稍后再试" }, 502);
	}
	return jsonResponse({ address }, 201);
}

async function handleLogin(request, env) {
	if (!requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
	const body = await readJsonBody(request);
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body.password === "string" ? body.password : "";
	if (!email || !password) return jsonResponse({ error: "请输入完整的邮箱地址和密码" }, 400);
	if (!EMAIL_PATTERN.test(email)) return jsonResponse({ error: "邮箱地址格式无效" }, 400);
	const limited = loginRateLimitResponse(request, email);
	if (limited) return limited;

	let response;
	try {
		response = await fetch(new URL("/api/address_login", upstreamOrigin(env)), {
			method: "POST",
			headers: upstreamHeaders(env, { "content-type": "application/json" }),
			body: JSON.stringify({ email, password: await sha256Hex(password) }),
		});
	} catch {
		return jsonResponse({ error: "无法连接邮箱服务，请稍后重试" }, 502);
	}
	if (isChallenge(response)) {
		return jsonResponse({ error: "邮箱服务需要安全验证，暂时无法登录。请稍后重试。", code: "UPSTREAM_CHALLENGE" }, 502);
	}
	const login = await readUpstreamJson(response);
	if (!response.ok || !login.body?.jwt) {
		recordLoginFailure(request, email);
		const status = response.status;
		if (status === 401 || status === 400 || status === 404) {
			return jsonResponse({ error: "邮箱地址或密码错误" }, 401);
		}
		if (status === 403) {
			return jsonResponse(
				{ error: upstreamMessage(login.body, "邮箱密码登录未启用，请联系站点管理员") },
				403,
			);
		}
		if (status === 429) {
			const retryAfter = response.headers.get("retry-after") ?? undefined;
			return jsonResponse(
				{ error: upstreamMessage(login.body, "操作过于频繁，请稍后再试") },
				429,
				retryAfter ? { "retry-after": retryAfter } : {},
			);
		}
		return jsonResponse({ error: upstreamMessage(login.body, "邮箱服务暂时不可用，请稍后再试") }, 502);
	}

	clearLoginFailures(request, email);
	const secret = sessionSecret(env);
	if (!secret) return jsonResponse({ error: "会话密钥未配置，请联系站点管理员" }, 500);
	const session = {
		address: String(login.body.address || email),
		jwt: String(login.body.jwt),
		expiresAt: Date.now() + SESSION_TTL_MS,
	};
	const cookie = await createUserSessionCookie(session, secret);
	return jsonResponse({ profile: { address: session.address } }, 200, { "set-cookie": cookie });
}

// 会话续期：距过期不足 1 小时时重签 Cookie，滚动保持 7 天有效期
function shouldRefreshSession(session) {
	return session.expiresAt - Date.now() < SESSION_TTL_MS - 60 * 60 * 1000;
}

async function getSession(request, env) {
	const secret = sessionSecret(env);
	if (!secret) return jsonResponse({ error: "会话密钥未配置" }, 500);
	const session = await readUserSessionCookie(request.headers.get("cookie"), secret);
	if (!session) return jsonResponse({ error: "登录状态已过期，请重新登录" }, 401);
	const headers = {};
	if (shouldRefreshSession(session)) {
		headers["set-cookie"] = await createUserSessionCookie(
			{ ...session, expiresAt: Date.now() + SESSION_TTL_MS },
			secret,
		);
	}
	return jsonResponse({ profile: { address: session.address } }, 200, headers);
}

async function requireSession(request, env) {
	const secret = sessionSecret(env);
	if (!secret) return { response: jsonResponse({ error: "会话密钥未配置" }, 500) };
	const session = await readUserSessionCookie(request.headers.get("cookie"), secret);
	if (!session) return { response: jsonResponse({ error: "登录状态已过期，请重新登录" }, 401) };
	if (shouldRefreshSession(session)) {
		session.expiresAt = Date.now() + SESSION_TTL_MS;
		return {
			session,
			refreshCookie: await createUserSessionCookie(session, secret),
		};
	}
	return { session };
}

// 邮件操作代理：上游令牌只保存在服务端会话中，不暴露给浏览器
async function proxyMailUpstream(request, env, session, upstreamPath, options = {}) {
	let response;
	try {
		response = await fetch(new URL(upstreamPath, upstreamOrigin(env)), {
			method: options.method || request.method,
			headers: upstreamHeaders(env, {
				authorization: `Bearer ${session.jwt}`,
				...(options.body !== undefined ? { "content-type": "application/json" } : {}),
			}),
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
		});
	} catch {
		return jsonResponse({ error: "无法连接邮箱服务，请检查网络后重试" }, 502);
	}
	const headers = {};
	const refreshCookie = options.refreshCookie;
	if (refreshCookie) headers["set-cookie"] = refreshCookie;

	if (isChallenge(response)) {
		return jsonResponse(
			{ error: "邮箱服务需要安全验证，暂时无法加载。请稍后重试。", code: "UPSTREAM_CHALLENGE" },
			502,
			headers,
		);
	}
	const { body, text } = await readUpstreamJson(response);
	if (!response.ok) {
		return jsonResponse(
			{ error: upstreamMessage(body, "邮箱服务暂时不可用，请稍后再试") },
			response.status,
			headers,
		);
	}
	if (body === null || typeof body === "string") {
		return jsonResponse({ error: "邮箱服务返回了无效的数据。", code: "INVALID_RESPONSE" }, 502, headers);
	}
	return jsonResponse(body, response.status, headers);
}

const MAIL_ID_PATTERN = /^\d+$/;

export async function handleMailAuth(request, env) {
	const { pathname, search } = new URL(request.url);
	const suffix = pathname.slice("/api/mail-auth".length).replace(/\/+$/, "") || "/";
	const method = request.method.toUpperCase();

	if (suffix === "/config" && method === "GET") {
		return jsonResponse({
			// 注册仅开放三个公开后缀；登录（含管理员登录）接受全部四个
			domains: MAIL_PUBLIC_DOMAINS,
			loginDomains: MAIL_ALL_DOMAINS,
			addressMinLength: ADDRESS_MIN_LENGTH,
			addressMaxLength: ADDRESS_MAX_LENGTH,
			passwordMinLength: PASSWORD_MIN_LENGTH,
		});
	}
	if (suffix === "/register" && method === "POST") return handleRegister(request, env);
	if (suffix === "/login" && method === "POST") return handleLogin(request, env);
	if (suffix === "/logout" && method === "POST") {
		if (!requestOriginAllowed(request)) return jsonResponse({ error: "非法请求来源" }, 403);
		return jsonResponse({ success: true }, 200, { "set-cookie": clearUserSessionCookie() });
	}
	if (suffix === "/session" && method === "GET") return getSession(request, env);

	// 以下均为登录后的邮件操作
	if (!["GET", "PATCH", "DELETE"].includes(method)) {
		return jsonResponse({ error: "请求方法不支持" }, 405);
	}
	if (method !== "GET" && !requestOriginAllowed(request)) {
		return jsonResponse({ error: "非法请求来源" }, 403);
	}
	const context = await requireSession(request, env);
	if (context.response) return context.response;
	const session = context.session;
	const refreshCookie = context.refreshCookie;

	if (suffix === "/mails" && method === "GET") {
		return proxyMailUpstream(request, env, session, `/api/parsed_mails${search}`, { refreshCookie });
	}
	if (suffix === "/inbox" && method === "DELETE") {
		return proxyMailUpstream(request, env, session, "/api/clear_inbox", { refreshCookie });
	}
	const mailMatch = suffix.match(/^\/mails\/([^/]+)(?:\/read)?$/);
	if (mailMatch && MAIL_ID_PATTERN.test(mailMatch[1])) {
		const id = mailMatch[1];
		if (method === "GET") {
			return proxyMailUpstream(request, env, session, `/api/parsed_mail/${id}`, { refreshCookie });
		}
		if (suffix.endsWith("/read")) {
			return proxyMailUpstream(request, env, session, `/api/mails/${id}/read`, {
				method: "PATCH",
				body: { isUnread: false },
				refreshCookie,
			});
		}
		return proxyMailUpstream(request, env, session, `/api/mails/${id}`, { method: "DELETE", refreshCookie });
	}
	return jsonResponse({ error: "接口不存在" }, 404);
}
