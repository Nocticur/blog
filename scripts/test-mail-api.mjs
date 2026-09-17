import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
	getMailAdminConfig,
	getMailAuthConfig,
	getMailboxMessages,
	getMailMessage,
	getMailSession,
	loginMailbox,
	MailApiError,
	markMailRead,
	registerMailbox,
} from "../src/utils/mail-api.ts";

afterEach(() => mock.restoreAll());

test("normalizes D1 integer unread flags", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({
			results: [
				{ id: 1, is_unread: 1 },
				{ id: 2, is_unread: 0 },
			],
			count: 2,
		}),
	);
	const result = await getMailboxMessages();
	assert.deepEqual(
		result.results.map((item) => item.is_unread),
		[true, false],
	);
});

test("missing detail produces a readable 404", async () => {
	mock.method(globalThis, "fetch", async () => Response.json(null));
	await assert.rejects(
		getMailMessage("42"),
		(error) => error instanceof MailApiError && error.status === 404,
	);
});

test("HTML success response is not silently shown as an empty inbox", async () => {
	mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response("<!doctype html><h1>Wrong route</h1>", {
				headers: { "content-type": "text/html" },
			}),
	);
	await assert.rejects(
		getMailboxMessages(),
		(error) =>
			error instanceof MailApiError && error.code === "INVALID_RESPONSE",
	);
});

test("challenge page is distinguished from expired authentication", async () => {
	mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response("<html>Just a moment...</html>", {
				status: 403,
				headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
			}),
	);
	await assert.rejects(
		getMailboxMessages(),
		(error) =>
			error instanceof MailApiError &&
			error.code === "UPSTREAM_CHALLENGE" &&
			!error.message.includes("<html>"),
	);
});

test("backend error property is preserved", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ error: "No address" }, { status: 400 }),
	);
	await assert.rejects(getMailboxMessages(), {
		message: "No address",
	});
});

test("request keeps same-origin credentials, path and abort signal", async () => {
	const controller = new AbortController();
	mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, "/api/mail-auth/mails?limit=30&offset=0");
		assert.equal(init.credentials, "same-origin");
		assert.equal(init.headers.get("authorization"), null);
		assert.equal(init.signal, controller.signal);
		return Response.json({ results: [], count: 0 });
	});
	assert.deepEqual(await getMailboxMessages(controller.signal), {
		results: [],
		count: 0,
	});
});

test("register posts name, domain and password without any token", async () => {
	mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, "/api/mail-auth/register");
		assert.equal(init.method, "POST");
		assert.deepEqual(JSON.parse(init.body), {
			name: "reader",
			domain: "nocticur.eu.cc",
			password: "secret-pass-1",
		});
		return Response.json({ address: "reader@nocticur.eu.cc" }, { status: 201 });
	});
	const result = await registerMailbox("reader", "nocticur.eu.cc", "secret-pass-1");
	assert.equal(result.address, "reader@nocticur.eu.cc");
});

test("register surfaces the duplicate conflict status", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ error: "该邮箱地址已被注册，请换一个前缀或域名" }, { status: 409 }),
	);
	await assert.rejects(
		registerMailbox("reader", "nocticur.eu.cc", "secret-pass-1"),
		(error) => error instanceof MailApiError && error.status === 409,
	);
});

test("config validation rejects malformed domain lists", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ domains: [], addressMinLength: 3 }),
	);
	await assert.rejects(
		getMailAuthConfig(),
		(error) => error instanceof MailApiError && error.code === "INVALID_RESPONSE",
	);
});

test("config fills safe defaults and keeps login domains separate", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({
			domains: ["nocticur.eu.cc", "noctis.eu.cc", "caelus.eu.cc"],
			loginDomains: [
				"nocticur.eu.cc",
				"noctis.eu.cc",
				"caelus.eu.cc",
				"mourn.top",
			],
		}),
	);
	const config = await getMailAuthConfig();
	assert.deepEqual(config.domains, ["nocticur.eu.cc", "noctis.eu.cc", "caelus.eu.cc"]);
	assert.deepEqual(config.loginDomains, [
		"nocticur.eu.cc",
		"noctis.eu.cc",
		"caelus.eu.cc",
		"mourn.top",
	]);
	assert.equal(config.addressMaxLength, 30);
	assert.equal(config.passwordMinLength, 8);
});

test("login domains fall back to the register list when missing", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ domains: ["nocticur.eu.cc", "noctis.eu.cc", "caelus.eu.cc"] }),
	);
	const config = await getMailAuthConfig();
	assert.deepEqual(config.loginDomains, config.domains);
});

test("admin domain config requires a valid response shape", async () => {
	const ok = mock.method(globalThis, "fetch", async () =>
		Response.json({
			domains: [
				"nocticur.eu.cc",
				"noctis.eu.cc",
				"caelus.eu.cc",
				"mourn.top",
			],
			defaultDomain: "mourn.top",
		}),
	);
	const adminConfig = await getMailAdminConfig();
	assert.equal(adminConfig.defaultDomain, "mourn.top");
	assert.equal(adminConfig.domains.length, 4);
	ok.mock.restore();

	mock.method(globalThis, "fetch", async () =>
		Response.json({ domains: [], defaultDomain: "mourn.top" }),
	);
	await assert.rejects(
		getMailAdminConfig(),
		(error) => error instanceof MailApiError && error.code === "INVALID_RESPONSE",
	);
});

test("login and session read the cookie-backed profile", async () => {
	const loginFetch = mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, "/api/mail-auth/login");
		assert.equal(init.method, "POST");
		assert.deepEqual(JSON.parse(init.body), {
			email: "reader@nocticur.eu.cc",
			password: "secret-pass-1",
		});
		return Response.json({ profile: { address: "reader@nocticur.eu.cc" } });
	});
	assert.deepEqual(await loginMailbox("reader@nocticur.eu.cc", "secret-pass-1"), {
		address: "reader@nocticur.eu.cc",
	});
	loginFetch.mock.restore();

	mock.method(globalThis, "fetch", async () =>
		Response.json({ profile: { address: "reader@nocticur.eu.cc" } }),
	);
	assert.deepEqual(await getMailSession(), { address: "reader@nocticur.eu.cc" });
});

test("session expiry surfaces as a 401 MailApiError", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ error: "登录状态已过期，请重新登录" }, { status: 401 }),
	);
	await assert.rejects(
		getMailSession(),
		(error) => error instanceof MailApiError && error.status === 401,
	);
});

test("rate limited responses carry the retry hint", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json(
			{ error: "登录失败次数过多，请稍后再试" },
			{ status: 429, headers: { "retry-after": "120" } },
		),
	);
	await assert.rejects(
		loginMailbox("reader@nocticur.eu.cc", "secret-pass-1"),
		(error) =>
			error instanceof MailApiError &&
			error.status === 429 &&
			error.retryAfterSeconds === 120,
	);
});

test("mark read sends a PATCH with the unread flag", async () => {
	mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, "/api/mail-auth/mails/42/read");
		assert.equal(init.method, "PATCH");
		assert.deepEqual(JSON.parse(init.body), { isUnread: false });
		return Response.json({ success: true });
	});
	await markMailRead("42");
});

test("HTML pages inside backend errors are replaced with a safe message", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json(
			{
				error:
					'<!DOCTYPE html>\n<html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1></body></html>',
			},
			{ status: 403 },
		),
	);
	await assert.rejects(
		loginMailbox("reader@nocticur.eu.cc", "secret-pass-1"),
		(error) =>
			error instanceof MailApiError &&
			error.status === 403 &&
			error.message === "邮箱服务返回错误。" &&
			!error.message.includes("<"),
	);
});

test("overlong backend error text is truncated before display", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({ error: "很长的错误".repeat(200) }, { status: 502 }),
	);
	await assert.rejects(
		loginMailbox("reader@nocticur.eu.cc", "secret-pass-1"),
		(error) =>
			error instanceof MailApiError &&
			error.message.length === 201 &&
			error.message.endsWith("…"),
	);
});

test("backend error codes survive client parsing", async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json(
			{ error: "邮箱服务被安全策略拦截，暂时无法登录，请稍后重试。", code: "UPSTREAM_BLOCKED" },
			{ status: 502 },
		),
	);
	await assert.rejects(
		loginMailbox("reader@nocticur.eu.cc", "secret-pass-1"),
		(error) =>
			error instanceof MailApiError &&
			error.code === "UPSTREAM_BLOCKED" &&
			error.message.includes("安全策略"),
	);
});
