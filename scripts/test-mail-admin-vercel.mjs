import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import handler from "../api/mail-admin/[[...path]].js";
import { createSessionCookie } from "../worker/mail-admin-session.js";

const SECRET = "test-mail-admin-session-secret-0123456789";

function createReq({
	method = "GET",
	url = "/api/mail-admin/session",
	headers = {},
	body,
} = {}) {
	return { method, url, headers, body };
}

function createRes() {
	const res = {
		statusCode: 0,
		headers: {},
		text: "",
		status(code) {
			this.statusCode = code;
			return this;
		},
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
		},
		json(data) {
			this.text = JSON.stringify(data);
			return this;
		},
		end(chunk) {
			this.text = chunk ? Buffer.from(chunk).toString("utf8") : "";
		},
	};
	return res;
}

function mockAdminUpstream(responses) {
	const calls = [];
	mock.method(globalThis, "fetch", async (url, init) => {
		const target = new URL(String(url));
		calls.push({ url: target, init });
		if (target.pathname === "/user_api/settings") {
			assert.equal(init.method, "GET");
			assert.equal(init.body, undefined);
			return Response.json({
				is_admin: true,
				access_token: "fresh-access-token",
				user_email: "admin@example.com",
				user_id: 1,
				user_role: { role: "master" },
			});
		}
		const match = responses.find((item) => item.path === target.pathname);
		if (!match) throw new Error(`unexpected upstream call: ${target.pathname}`);
		return new Response(match.body ?? JSON.stringify(match.json ?? {}), {
			status: match.status ?? 200,
			headers: match.headers ?? { "content-type": "application/json" },
		});
	});
	return calls;
}

afterEach(() => {
	mock.restoreAll();
	process.env.MAIL_ADMIN_SESSION_SECRET = SECRET;
});

process.env.MAIL_ADMIN_SESSION_SECRET = SECRET;

test("missing session secret fails fast with 500", async () => {
	delete process.env.MAIL_ADMIN_SESSION_SECRET;
	const res = createRes();
	await handler(createReq(), res);
	assert.equal(res.statusCode, 500);
	assert.deepEqual(JSON.parse(res.text), {
		error: "MAIL_ADMIN_SESSION_SECRET 未配置",
	});
});

test("multi-segment admin paths reach the worker through the rewrite suffix", async () => {
	const cookie = await createSessionCookie(
		{
			userToken: "user-token",
			accessToken: "access-token",
			email: "admin@example.com",
			userId: 1,
			role: "master",
			expiresAt: Date.now() + 60_000,
		},
		SECRET,
	);
	// vercel.json 将 /api/mail-admin/admin/statistics 重写为
	// /api/mail-admin/[[...path]]?...path=admin/statistics&__suffix=admin/statistics；
	// 运行时无论是否把 pathname 还原，__suffix 都能恢复原始路径
	const calls = mockAdminUpstream([
		{ path: "/admin/statistics", json: { mailCount: 7 } },
	]);
	const res = createRes();
	await handler(
		createReq({
			url: "/api/mail-admin?__suffix=admin/statistics&limit=5&offset=0",
			headers: { cookie, accept: "application/json" },
		}),
		res,
	);
	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.text), { mailCount: 7 });
	const adminCall = calls.find(
		(call) => call.url.pathname === "/admin/statistics",
	);
	assert.ok(adminCall, "expected an upstream /admin/statistics call");
	assert.equal(adminCall.url.search, "?limit=5&offset=0");
	assert.equal(
		adminCall.init.headers.get("x-user-access-token"),
		"fresh-access-token",
	);
	assert.equal(adminCall.init.body, undefined);
});

test("runtime-reconstructed deep pathnames pass through unchanged", async () => {
	const cookie = await createSessionCookie(
		{
			userToken: "user-token",
			accessToken: "access-token",
			email: "admin@example.com",
			userId: 1,
			role: "master",
			expiresAt: Date.now() + 60_000,
		},
		SECRET,
	);
	const calls = mockAdminUpstream([
		{ path: "/admin/worker/configs", json: { ENABLE_USER_CREATE_EMAIL: true } },
	]);
	const res = createRes();
	await handler(
		createReq({
			url: "/api/mail-admin/admin/worker/configs",
			headers: { cookie, accept: "application/json" },
		}),
		res,
	);
	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.text), { ENABLE_USER_CREATE_EMAIL: true });
	assert.equal(
		calls.some((call) => call.url.pathname === "/admin/worker/configs"),
		true,
	);
});

test("admin writes keep their method and body after the rewrite", async () => {
	const cookie = await createSessionCookie(
		{
			userToken: "user-token",
			accessToken: "access-token",
			email: "admin@example.com",
			userId: 1,
			role: "master",
			expiresAt: Date.now() + 60_000,
		},
		SECRET,
	);
	mockAdminUpstream([
		{ path: "/admin/business_settings", json: { success: true } },
	]);
	const body = JSON.stringify({ allowRegistration: true });
	const res = createRes();
	await handler(
		createReq({
			method: "POST",
			url: "/api/mail-admin?__suffix=admin/business_settings",
			headers: {
				cookie,
				origin: "https://localhost",
				"content-type": "application/json",
			},
			body,
		}),
		res,
	);
	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.text), { success: true });
});

test("upstream status, body and headers are forwarded to the client", async () => {
	const cookie = await createSessionCookie(
		{
			userToken: "user-token",
			accessToken: "access-token",
			email: "admin@example.com",
			userId: 1,
			role: "master",
			expiresAt: Date.now() + 60_000,
		},
		SECRET,
	);
	mockAdminUpstream([
		{
			path: "/admin/statistics",
			status: 503,
			json: { error: "数据库暂时不可用" },
			headers: {
				"content-type": "application/json; charset=utf-8",
				"x-upstream-marker": "yes",
			},
		},
	]);
	const res = createRes();
	await handler(
		createReq({
			url: "/api/mail-admin?__suffix=admin/statistics",
			headers: { cookie, accept: "application/json" },
		}),
		res,
	);
	assert.equal(res.statusCode, 503);
	assert.deepEqual(JSON.parse(res.text), { error: "数据库暂时不可用" });
	assert.equal(res.headers["x-upstream-marker"], "yes");
	assert.equal(res.headers["cache-control"], "no-store");
});
