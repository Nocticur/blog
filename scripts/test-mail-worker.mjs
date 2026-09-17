import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import worker from "../worker/index.js";
import { createUserSessionCookie } from "../worker/mail-user-session.js";
import { createSessionCookie } from "../worker/mail-admin-session.js";

afterEach(() => mock.restoreAll());

const SECRET = "test-mail-user-session-secret-0123456789abcdef";
const UPSTREAM = "https://apimail.noctis.eu.cc";
const D1_URL = "https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/query";

const assets = {
	ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

const ADMIN_SECRET = "test-mail-admin-session-secret-0123456789";

function authEnv(extra = {}) {
	return {
		MAIL_USER_SESSION_SECRET: SECRET,
		MAIL_ADMIN_SESSION_SECRET: ADMIN_SECRET,
		MAIL_UPSTREAM_ORIGIN: UPSTREAM,
		CLOUDFLARE_ACCOUNT_ID: "acc",
		CLOUDFLARE_D1_DATABASE_ID: "db",
		CLOUDFLARE_D1_API_TOKEN: "token",
		...assets,
		...extra,
	};
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function originHeaders(origin = "https://blog.example.com") {
	return { origin, "content-type": "application/json" };
}

async function sessionCookie(address = "reader@nocticur.eu.cc", jwt = "user-jwt") {
	return createUserSessionCookie({ address, jwt, expiresAt: Date.now() + 3600_000 }, SECRET);
}

function mockD1Insert(overrides = {}) {
	return mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), D1_URL);
		assert.equal(init.headers.get("authorization"), "Bearer token");
		const payload = JSON.parse(init.body);
		assert.match(payload.sql, /INSERT INTO address/);
		return Response.json(
			{
				success: overrides.success ?? true,
				errors: overrides.errors ?? [],
				results: [],
			},
			{ status: overrides.status ?? 200 },
		);
	});
}

// 模拟 Cloudflare 封禁页（服务器侧请求被 WAF 拦截时返回的 HTML）
const CF_BLOCK_PAGE =
	'<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n<html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><p>You are unable to access apimail.noctis.eu.cc</p><p>Performance & security by Cloudflare</p></body></html>\n';

async function postLogin(body, headers = originHeaders()) {
	return worker.fetch(new Request("https://blog.example.com/api/mail-auth/login", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	}), authEnv());
}

test("mail auth config separates register allowlist from login domains", async () => {
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/config"),
		authEnv(),
	);
	const body = await response.json();
	assert.deepEqual(body.domains, ["nocticur.eu.cc", "noctis.eu.cc", "caelus.eu.cc"]);
	assert.deepEqual(body.loginDomains, [
		"nocticur.eu.cc",
		"noctis.eu.cc",
		"caelus.eu.cc",
		"mourn.top",
	]);
	assert.ok(body.addressMinLength >= 1);
	assert.ok(body.passwordMinLength >= 8);
});

test("admin creation config requires a verified admin session", async () => {
	const unauthenticated = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/admin/config"),
		authEnv(),
	);
	assert.equal(unauthenticated.status, 401);

	const cookie = await createSessionCookie(
		{
			userToken: "user-token",
			accessToken: "access-token",
			email: "admin@mourn.top",
			userId: 1,
			role: "master",
			expiresAt: Date.now() + 3600_000,
		},
		ADMIN_SECRET,
	);
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), `${UPSTREAM}/user_api/settings`);
		assert.equal(init.headers.get("x-user-token"), "user-token");
		return Response.json({
			is_admin: true,
			access_token: "access-token",
			user_email: "admin@mourn.top",
			user_id: 1,
			user_role: { role: "master" },
		});
	});
	const ok = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/admin/config", {
			headers: { cookie },
		}),
		authEnv(),
	);
	assert.equal(upstream.mock.callCount(), 1);
	assert.equal(ok.status, 200);
	const body = await ok.json();
	assert.deepEqual(body.domains, [
		"nocticur.eu.cc",
		"noctis.eu.cc",
		"caelus.eu.cc",
		"mourn.top",
	]);
	assert.equal(body.defaultDomain, "mourn.top");

	mock.method(globalThis, "fetch", async () =>
		Response.json({ is_admin: false }),
	);
	const nonAdmin = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/admin/config", {
			headers: { cookie },
		}),
		authEnv(),
	);
	assert.equal(nonAdmin.status, 403);
});

test("register inserts address and password atomically via D1 HTTP API", async () => {
	const d1 = mockD1Insert();
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ name: "Reader", domain: "nocticur.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(response.status, 201);
	const body = await response.json();
	assert.equal(body.address, "reader@nocticur.eu.cc");
	const payload = JSON.parse(d1.mock.calls[0].arguments[1].body);
	assert.deepEqual(payload.params, ["reader@nocticur.eu.cc", sha256("strong-pass-1"), "unknown"]);
});

test("register rejects domains outside the public allowlist without touching D1", async () => {
	const d1 = mockD1Insert();
	for (const [domain, expected] of [
		["mourn.top", 403],
		["nocticur.eu.cc.evil.com", 403],
		["", 400],
	]) {
		const response = await worker.fetch(
			new Request("https://blog.example.com/api/mail-auth/register", {
				method: "POST",
				headers: originHeaders(),
				body: JSON.stringify({ name: "reader", domain, password: "strong-pass-1" }),
			}),
			authEnv(),
		);
		assert.equal(response.status, expected);
	}
	assert.equal(d1.mock.callCount(), 0);
});

test("register maps the D1 unique violation to a conflict", async () => {
	mockD1Insert({
		success: false,
		errors: [{ code: 7500, message: "failed to execute SQL: UNIQUE constraint failed: address.name" }],
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ name: "reader", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(response.status, 409);
	const body = await response.json();
	assert.equal(body.error, "该邮箱地址已被注册，请换一个前缀或域名");
	assert.equal(body.code, "ADDRESS_CONFLICT");
});

test("register reports invalid D1 credentials distinctly", async () => {
	mockD1Insert({ status: 401 });
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: { ...originHeaders(), "x-forwarded-for": "198.51.100.20" },
			body: JSON.stringify({ name: "reader", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(response.status, 500);
	assert.equal((await response.json()).code, "REGISTER_CREDENTIALS_INVALID");
});

test("register reports D1 network failures separately from configuration issues", async () => {
	mock.method(globalThis, "fetch", async () => {
		throw new TypeError("fetch failed");
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: { ...originHeaders(), "x-forwarded-for": "198.51.100.21" },
			body: JSON.stringify({ name: "reader", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(response.status, 502);
	assert.equal((await response.json()).code, "REGISTER_UNAVAILABLE");
});

test("register uses the D1 binding when available", async () => {
	let boundArgs = null;
	const binding = {
		prepare: (sql) => ({
			bind: (...args) => {
				boundArgs = { sql, args };
				return { run: async () => ({ success: true }) };
			},
		}),
	};
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ name: "bound", domain: "caelus.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv({ MAIL_DB: binding }),
	);
	assert.equal(response.status, 201);
	assert.match(boundArgs.sql, /INSERT INTO address/);
	assert.deepEqual(boundArgs.args, ["bound@caelus.eu.cc", sha256("strong-pass-1"), "unknown"]);
});

test("register reports a missing D1 configuration as a server error", async () => {
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ name: "reader", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		{ ...assets },
	);
	assert.equal(response.status, 500);
	assert.equal((await response.json()).code, "REGISTER_NOT_CONFIGURED");
});

test("register rejects cross-origin writes and invalid payloads", async () => {
	const crossOrigin = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders("https://evil.example"),
			body: JSON.stringify({ name: "reader", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(crossOrigin.status, 403);

	const badName = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ name: "a", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(badName.status, 400);

	const badPassword = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ name: "reader", domain: "noctis.eu.cc", password: "short" }),
		}),
		authEnv(),
	);
	assert.equal(badPassword.status, 400);
});

test("register is rate limited per client IP after five attempts", async () => {
	const ip = "203.0.113.77";
	const headers = { ...originHeaders(), "x-forwarded-for": ip };
	let response;
	for (let i = 0; i < 5; i += 1) {
		response = await worker.fetch(
			new Request("https://blog.example.com/api/mail-auth/register", {
				method: "POST",
				headers,
				body: JSON.stringify({ name: `rate${i}`, domain: "noctis.eu.cc", password: "strong-pass-1" }),
			}),
			// 没有 D1 配置会返回 500，但仍计为一次尝试
			{ ...assets },
		);
		assert.equal(response.status, 500);
	}
	// 第六次尝试被限流拦截
	response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/register", {
			method: "POST",
			headers,
			body: JSON.stringify({ name: "rate6", domain: "noctis.eu.cc", password: "strong-pass-1" }),
		}),
		authEnv(),
	);
	assert.equal(response.status, 429);
	assert.ok(response.headers.get("retry-after"));
});

test("login proxies address password login and stores the token only in a cookie", async () => {
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), `${UPSTREAM}/api/address_login`);
		assert.equal(init.headers.get("origin"), UPSTREAM);
		assert.equal(init.headers.get("x-lang"), "zh-CN");
		assert.equal(init.headers.get("cookie"), null);
		const payload = JSON.parse(init.body);
		assert.equal(payload.email, "reader@nocticur.eu.cc");
		assert.equal(payload.password, sha256("my-password"));
		return Response.json({ jwt: "issued-jwt", address: "reader@nocticur.eu.cc" });
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/login", {
			method: "POST",
			headers: originHeaders(),
			body: JSON.stringify({ email: "reader@nocticur.eu.cc", password: "my-password" }),
		}),
		authEnv(),
	);
	assert.equal(upstream.mock.callCount(), 1);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.deepEqual(body.profile, { address: "reader@nocticur.eu.cc" });
	const setCookie = response.headers.get("set-cookie");
	assert.match(setCookie, /^mail_user_session=/);
	assert.match(setCookie, /HttpOnly/);
	assert.match(setCookie, /Max-Age=604800/);
	assert.ok(!setCookie.includes("issued-jwt"));
});

test("login normalizes credentials errors and reports disabled login with a code", async () => {
	mock.method(globalThis, "fetch", async () =>
		new Response(JSON.stringify({ message: "密码错误" }), { status: 401 }),
	);
	const bad = await postLogin({ email: "reader@nocticur.eu.cc", password: "wrong" });
	assert.equal(bad.status, 401);
	assert.equal((await bad.json()).error, "邮箱地址或密码错误");

	// 上游 403（纯文本 "Password login is disabled"）→ 固定中文提示 + 错误码，不透传英文原文
	mock.method(globalThis, "fetch", async () =>
		new Response("Password login is disabled", {
			status: 403,
			headers: { "content-type": "text/plain; charset=UTF-8" },
		}),
	);
	const disabled = await postLogin({ email: "reader@nocticur.eu.cc", password: "wrong" });
	assert.equal(disabled.status, 403);
	const disabledBody = await disabled.json();
	assert.equal(disabledBody.error, "邮箱密码登录未启用，请联系站点管理员。");
	assert.equal(disabledBody.code, "UPSTREAM_LOGIN_DISABLED");
});

test("upstream block pages become controlled errors and never count as wrong passwords", async () => {
	const headers = { ...originHeaders(), "x-forwarded-for": "198.51.100.10" };
	let upstreamCalls = 0;
	mock.method(globalThis, "fetch", async () => {
		upstreamCalls += 1;
		return new Response(CF_BLOCK_PAGE, {
			status: 403,
			headers: { "content-type": "text/html; charset=UTF-8" },
		});
	});
	// 连续 6 次仍能触达上游：封禁页不计入登录失败限流（超过 5 次会触发 429）
	for (let i = 0; i < 6; i += 1) {
		const response = await postLogin(
			{ email: "blocked@nocticur.eu.cc", password: "whatever" },
			headers,
		);
		assert.equal(response.status, 502);
		const body = await response.json();
		assert.equal(body.code, "UPSTREAM_BLOCKED");
		assert.equal(body.error, "邮箱服务被安全策略拦截，暂时无法登录，请稍后重试。");
		assert.ok(!body.error.includes("<"), "error must not contain HTML");
	}
	assert.equal(upstreamCalls, 6);
});

test("login challenge responses stay upstream failures without counting", async () => {
	const headers = { ...originHeaders(), "x-forwarded-for": "198.51.100.11" };
	let upstreamCalls = 0;
	mock.method(globalThis, "fetch", async () => {
		upstreamCalls += 1;
		return new Response("<html>Just a moment...</html>", {
			status: 403,
			headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
		});
	});
	for (let i = 0; i < 6; i += 1) {
		const response = await postLogin(
			{ email: "challenge@nocticur.eu.cc", password: "whatever" },
			headers,
		);
		assert.equal(response.status, 502);
		assert.equal((await response.json()).code, "UPSTREAM_CHALLENGE");
	}
	assert.equal(upstreamCalls, 6);
});

test("abnormal upstream payloads map to controlled errors without counting", async () => {
	const headers = { ...originHeaders(), "x-forwarded-for": "198.51.100.12" };
	// 2xx 却缺少 jwt
	mock.method(globalThis, "fetch", async () => Response.json({ hello: "world" }));
	const odd = await postLogin({ email: "odd@nocticur.eu.cc", password: "whatever" }, headers);
	assert.equal(odd.status, 502);
	assert.equal((await odd.json()).code, "INVALID_RESPONSE");

	// 5xx JSON：上游故障不计失败次数，6 次全部触达上游
	let upstreamCalls = 0;
	mock.method(globalThis, "fetch", async () => {
		upstreamCalls += 1;
		return Response.json({ error: "upstream exploded" }, { status: 500 });
	});
	for (let i = 0; i < 6; i += 1) {
		const response = await postLogin(
			{ email: "flaky@nocticur.eu.cc", password: "whatever" },
			headers,
		);
		assert.equal(response.status, 502);
		const body = await response.json();
		assert.equal(body.code, "UPSTREAM_UNAVAILABLE");
		assert.ok(!body.error.includes("exploded"), "upstream text must not leak");
	}
	assert.equal(upstreamCalls, 6);
});

test("json errors containing html fragments are not treated as block pages", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ message: "<html>quoted content</html>" }, { status: 500 }),
	);
	const response = await postLogin(
		{ email: "jsonish@nocticur.eu.cc", password: "whatever" },
		{ ...originHeaders(), "x-forwarded-for": "198.51.100.14" },
	);
	assert.equal(response.status, 502);
	const body = await response.json();
	assert.equal(body.code, "UPSTREAM_UNAVAILABLE");
	assert.ok(!body.error.includes("<"), "upstream text must not leak");
});

test("repeated wrong passwords still hit the login failure limit", async () => {
	const headers = { ...originHeaders(), "x-forwarded-for": "198.51.100.13" };
	mock.method(globalThis, "fetch", async () =>
		new Response(JSON.stringify({ message: "Wrong password" }), { status: 401 }),
	);
	for (let i = 0; i < 5; i += 1) {
		const response = await postLogin(
			{ email: "locked@nocticur.eu.cc", password: "wrong" },
			headers,
		);
		assert.equal(response.status, 401);
	}
	const limited = await postLogin(
		{ email: "locked@nocticur.eu.cc", password: "wrong" },
		headers,
	);
	assert.equal(limited.status, 429);
	assert.ok(limited.headers.get("retry-after"));
});

test("session endpoint validates the encrypted cookie and stays cheap", async () => {
	const cookie = await sessionCookie();
	const ok = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/session", {
			headers: { cookie },
		}),
		authEnv(),
	);
	assert.equal(ok.status, 200);
	assert.deepEqual((await ok.json()).profile, { address: "reader@nocticur.eu.cc" });

	const missing = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/session"),
		authEnv(),
	);
	assert.equal(missing.status, 401);
});

test("mail proxies inject the session token and normalize upstream failures", async () => {
	const cookie = await sessionCookie("reader@nocticur.eu.cc", "user-jwt");
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), `${UPSTREAM}/api/parsed_mails?limit=30&offset=0`);
		assert.equal(init.headers.get("authorization"), "Bearer user-jwt");
		assert.equal(init.headers.get("cookie"), null);
		return Response.json({ results: [{ id: 1, subject: "你好", is_unread: 1 }], count: 1 });
	});
	const ok = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/mails?limit=30&offset=0", {
			headers: { cookie },
		}),
		authEnv(),
	);
	assert.equal(upstream.mock.callCount(), 1);
	assert.equal(ok.status, 200);
	assert.deepEqual((await ok.json()).results[0].subject, "你好");

	mock.method(globalThis, "fetch", async () =>
		new Response("<html>Just a moment...</html>", {
			status: 403,
			headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
		}),
	);
	const challenged = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/mails", { headers: { cookie } }),
		authEnv(),
	);
	assert.equal(challenged.status, 502);
	assert.equal((await challenged.json()).code, "UPSTREAM_CHALLENGE");

	const expired = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/mails"),
		authEnv(),
	);
	assert.equal(expired.status, 401);
});

test("mail proxies replace upstream block pages with controlled errors", async () => {
	const cookie = await sessionCookie("blocked@nocticur.eu.cc", "user-jwt");
	mock.method(globalThis, "fetch", async () =>
		new Response(CF_BLOCK_PAGE, {
			status: 403,
			headers: { "content-type": "text/html; charset=UTF-8" },
		}),
	);
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/mails?limit=30&offset=0", {
			headers: { cookie },
		}),
		authEnv(),
	);
	assert.equal(response.status, 502);
	const body = await response.json();
	assert.equal(body.code, "UPSTREAM_BLOCKED");
	assert.ok(!body.error.includes("<"), "error must not contain HTML");
});

test("mail writes require a same-origin request", async () => {
	const cookie = await sessionCookie();
	let upstreamCalls = 0;
	mock.method(globalThis, "fetch", async () => {
		upstreamCalls += 1;
		return Response.json({ success: true });
	});
	const crossOrigin = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/inbox", {
			method: "DELETE",
			headers: { cookie, origin: "https://evil.example" },
		}),
		authEnv(),
	);
	assert.equal(crossOrigin.status, 403);
	assert.equal(upstreamCalls, 0);

	const sameOrigin = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/inbox", {
			method: "DELETE",
			headers: { cookie, origin: "https://blog.example.com" },
		}),
		authEnv(),
	);
	assert.equal(sameOrigin.status, 200);
	assert.equal(upstreamCalls, 1);
});

test("logout clears the user session cookie", async () => {
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-auth/logout", {
			method: "POST",
			headers: originHeaders(),
		}),
		authEnv(),
	);
	assert.equal(response.status, 200);
	assert.match(response.headers.get("set-cookie"), /^mail_user_session=;/);
	assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("legacy mailbox proxy routes are gone and fall back to assets", async () => {
	const upstream = mock.method(globalThis, "fetch", async () => Response.json({}));
	const env = { ASSETS: { fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`) } };
	for (const path of ["/api/new_address", "/api/parsed_mails", "/api/mails/1", "/api/delete_address"]) {
		const response = await worker.fetch(new Request(`https://blog.example.com${path}`), env);
		assert.equal(await response.text(), `asset:${path}`);
	}
	assert.equal(upstream.mock.callCount(), 0);
});
