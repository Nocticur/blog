import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
	adminRequest,
	MailAdminError,
	parseJsonObject,
} from "../src/utils/mail-admin-api.ts";

afterEach(() => mock.restoreAll());

test("admin requests use GET without a body by default and POST with one", async () => {
	const fetchMock = mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(String(url), "/api/mail-admin/admin/statistics");
		assert.equal(init.method, "GET");
		assert.equal(init.body, undefined);
		assert.equal(init.headers["content-type"], undefined);
		assert.equal(init.headers.accept, "application/json");
		return Response.json({ mailCount: 3 });
	});
	const payload = await adminRequest("/admin/statistics");
	assert.deepEqual(payload, { mailCount: 3 });
	fetchMock.mock.restore();

	mock.method(globalThis, "fetch", async (_url, init) => {
		assert.equal(init.method, "POST");
		assert.equal(init.headers["content-type"], "application/json");
		assert.deepEqual(JSON.parse(init.body), { enable: true });
		return Response.json({ success: true });
	});
	await adminRequest("/admin/business_settings", {
		method: "POST",
		body: { enable: true },
	});
});

test("admin request rejects paths outside /admin/", () => {
	assert.throws(() => adminRequest("/session"), /管理接口路径无效/);
});

test("module failures describe the module and HTTP status", async () => {
	mock.method(
		globalThis,
		"fetch",
		async () => new Response("", { status: 502 }),
	);
	await assert.rejects(
		() => adminRequest("/admin/statistics", { module: "系统统计" }),
		(error) => {
			assert.ok(error instanceof MailAdminError);
			assert.equal(error.status, 502);
			assert.equal(error.message, "系统统计加载失败（HTTP 502）");
			return true;
		},
	);
});

test("valid upstream business errors are preserved", async () => {
	for (const body of [
		{ error: "邮箱或密码错误" },
		{ message: "配额不足" },
		"纯文本错误",
	]) {
		mock.method(
			globalThis,
			"fetch",
			async () => new Response(JSON.stringify(body), { status: 400 }),
		);
		await assert.rejects(
			() => adminRequest("/admin/statistics", { module: "系统统计" }),
			(error) => {
				assert.ok(error instanceof MailAdminError);
				assert.equal(error.status, 400);
				assert.equal(
					error.message,
					typeof body === "string" ? "纯文本错误" : Object.values(body)[0],
				);
				return true;
			},
		);
		mock.restoreAll();
	}
});

test("gateway structured errors and HTML pages do not leak into the UI", async () => {
	for (const [body, status] of [
		[
			JSON.stringify({
				error: { code: "404", message: "The page could not be found" },
			}),
			404,
		],
		["<html><body>Internal Server Error</body></html>", 500],
		["", 503],
	]) {
		mock.method(
			globalThis,
			"fetch",
			async () =>
				new Response(body, {
					status,
					headers: { "content-type": "text/html" },
				}),
		);
		await assert.rejects(
			() => adminRequest("/admin/worker/configs", { module: "后端配置" }),
			(error) => {
				assert.ok(error instanceof MailAdminError);
				assert.equal(error.status, status);
				assert.equal(error.message, `后端配置加载失败（HTTP ${status}）`);
				assert.equal(error.message.includes("<"), false);
				return true;
			},
		);
		mock.restoreAll();
	}
});

test("overlong upstream texts fall back to the module message", async () => {
	mock.method(
		globalThis,
		"fetch",
		async () =>
			new Response(JSON.stringify({ error: "x".repeat(400) }), { status: 500 }),
	);
	await assert.rejects(
		() => adminRequest("/admin/statistics", { module: "系统统计" }),
		(error) => {
			assert.equal(error.message, "系统统计加载失败（HTTP 500）");
			return true;
		},
	);
});

test("network failures produce a readable module message", async () => {
	mock.method(globalThis, "fetch", async () => {
		throw new TypeError("Failed to fetch");
	});
	await assert.rejects(
		() => adminRequest("/admin/statistics", { module: "系统统计" }),
		(error) => {
			assert.equal(error.message, "系统统计请求发送失败，请检查网络后重试。");
			return true;
		},
	);
});

test("parseJsonObject rejects empty bodies, HTML and arrays on success status", () => {
	for (const payload of [null, "", "<html></html>", [1, 2], 42]) {
		assert.throws(
			() => parseJsonObject(payload, "系统统计"),
			(error) => {
				assert.ok(error instanceof MailAdminError);
				assert.equal(error.status, 200);
				assert.match(error.message, /系统统计返回了无法解析的数据/);
				return true;
			},
		);
	}
	assert.deepEqual(parseJsonObject({}, "系统统计"), {});
	assert.deepEqual(parseJsonObject({ body: { a: 1 } }, "系统统计"), {
		body: { a: 1 },
	});
});
