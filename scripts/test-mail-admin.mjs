import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import worker from "../worker/index.js";
import {
	COOKIE_NAME,
	createSessionCookie,
	readSessionCookie,
} from "../worker/mail-admin-session.js";

const SECRET = "test-mail-admin-session-secret-0123456789";
const assets = { ASSETS: { fetch: async () => new Response("asset") } };

afterEach(() => mock.restoreAll());

test("encrypted admin cookie round trips and rejects tampering", async () => {
	const session = {
		userToken: "user-token",
		accessToken: "access-token",
		email: "admin@example.com",
		userId: 1,
		role: "master",
		expiresAt: Date.now() + 60_000,
	};
	const setCookie = await createSessionCookie(session, SECRET);
	assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=`));
	assert.match(setCookie, /HttpOnly/);
	assert.match(setCookie, /Secure/);
	assert.match(setCookie, /SameSite=Lax/);
	assert.match(setCookie, /Path=\//);
	const cookieValue = setCookie.split(";", 1)[0];
	assert.deepEqual(await readSessionCookie(cookieValue, SECRET), session);
	const tampered = `${cookieValue.slice(0, -1)}${cookieValue.endsWith("a") ? "b" : "a"}`;
	assert.equal(await readSessionCookie(tampered, SECRET), null);
});

test("admin login returns profile without exposing upstream tokens", async () => {
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		if (String(url).endsWith("/user_api/login")) {
			assert.equal(init.method, "POST");
			return Response.json({ jwt: "user-token" });
		}
		assert.equal(String(url), "https://apimail.noctis.eu.cc/user_api/settings");
		assert.equal(init.method, "GET");
		assert.equal(init.body, undefined);
		return Response.json({ is_admin: false });
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/login", {
			method: "POST",
			headers: {
				origin: "https://blog.example.com",
				"content-type": "application/json",
			},
			body: JSON.stringify({ email: "admin@example.com", password: "hashed" }),
		}),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 403);
	assert.equal(upstream.mock.callCount(), 2);
});

test("first setup uses the upstream atomic bootstrap endpoint", async () => {
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		const target = String(url);
		if (target.endsWith("/admin/bootstrap")) {
			assert.equal(init.method, "POST");
			assert.equal(init.headers.get("x-admin-auth"), "existing-admin-secret");
			assert.deepEqual(JSON.parse(init.body), {
				email: "new-admin@example.com",
				password:
					"c160812a0c6bb61e630e0685faf7466e8106dbd07b8b9369f580754a8c39338d",
			});
			return Response.json({ success: true });
		}
		if (target.endsWith("/user_api/login"))
			return Response.json({ jwt: "new-user-token" });
		assert.equal(target, "https://apimail.noctis.eu.cc/user_api/settings");
		assert.equal(init.method, "GET");
		assert.equal(init.body, undefined);
		return Response.json({
			is_admin: true,
			access_token: "new-access-token",
			user_email: "new-admin@example.com",
			user_id: 7,
			user_role: { role: "master" },
		});
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/bootstrap", {
			method: "POST",
			headers: {
				origin: "https://blog.example.com",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				adminPassword: "existing-admin-secret",
				email: "new-admin@example.com",
				password: "setup-password",
			}),
		}),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 200);
	assert.deepEqual((await response.json()).profile, {
		email: "new-admin@example.com",
		userId: 7,
		role: "master",
	});
	assert.match(response.headers.get("set-cookie"), /HttpOnly/);
	assert.equal(upstream.mock.callCount(), 3);
});

test("admin routes require a session", async () => {
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/admin/statistics"),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), { error: "管理员会话已过期" });
});

test("admin writes reject cross-origin requests", async () => {
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/logout", {
			method: "POST",
			headers: { origin: "https://attacker.example.com" },
		}),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 403);
});

test("admin proxy revalidates the current role before forwarding", async () => {
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
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		if (String(url).endsWith("/user_api/settings")) {
			assert.equal(init.headers.get("x-user-token"), "user-token");
			assert.equal(init.method, "GET");
			assert.equal(init.body, undefined);
			return Response.json({
				is_admin: true,
				access_token: "fresh-access-token",
			});
		}
		assert.equal(String(url), "https://apimail.noctis.eu.cc/admin/statistics");
		assert.equal(init.headers.get("x-user-access-token"), "fresh-access-token");
		return Response.json({ mailCount: 2 });
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/admin/statistics", {
			headers: { cookie },
		}),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { mailCount: 2 });
	assert.equal(upstream.mock.callCount(), 2);
});

test("admin writes forward the original body after GET role validation", async () => {
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
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		if (String(url).endsWith("/user_api/settings")) {
			assert.equal(init.method, "GET");
			assert.equal(init.body, undefined);
			return Response.json({ is_admin: true, access_token: "fresh-access-token" });
		}
		assert.equal(String(url), "https://apimail.noctis.eu.cc/admin/account_settings");
		assert.equal(init.method, "POST");
		const body = new TextDecoder().decode(init.body);
		assert.deepEqual(JSON.parse(body), { sample: true });
		assert.equal(init.headers.get("x-user-access-token"), "fresh-access-token");
		return Response.json({ success: true });
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/admin/account_settings", {
			method: "POST",
			headers: { cookie, origin: "https://blog.example.com", "content-type": "application/json" },
			body: JSON.stringify({ sample: true }),
		}),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { success: true });
	assert.equal(upstream.mock.callCount(), 2);
});

test("bootstrap reports that the account was created when automatic login fails", async () => {
	const upstream = mock.method(globalThis, "fetch", async (url, init) => {
		const target = String(url);
		if (target.endsWith("/admin/bootstrap")) return Response.json({ success: true });
		if (target.endsWith("/user_api/login")) return Response.json({ jwt: "new-user-token" });
		assert.equal(target, "https://apimail.noctis.eu.cc/user_api/settings");
		return new Response("upstream unavailable", { status: 503 });
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/mail-admin/bootstrap", {
			method: "POST",
			headers: { origin: "https://blog.example.com", "content-type": "application/json" },
			body: JSON.stringify({
				adminPassword: "existing-admin-secret",
				email: "new-admin@example.com",
				password: "setup-password",
			}),
		}),
		{ ...assets, MAIL_ADMIN_SESSION_SECRET: SECRET },
	);
	assert.equal(response.status, 502);
	assert.deepEqual(await response.json(), { error: "账号已创建，请返回登录" });
	assert.equal(upstream.mock.callCount(), 3);
});
