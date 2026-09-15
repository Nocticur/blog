import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import worker from "../worker/index.js";

afterEach(() => mock.restoreAll());
const assets = {
	ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

test("forwards only mailbox APIs and preserves bearer, method, query and body", async () => {
	mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(
			String(url),
			"https://mail.mourn.top/api/new_address?fixture=1",
		);
		assert.equal(init.method, "POST");
		assert.equal(init.headers.get("authorization"), "Bearer fixture-token");
		assert.equal(init.headers.get("cookie"), null);
		assert.equal(
			await new Response(init.body).text(),
			'{"domain":"example.com"}',
		);
		return Response.json(
			{ address: "reader@example.com", jwt: "fixture-token" },
			{ headers: { "set-cookie": "discard=1" } },
		);
	});
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/new_address?fixture=1", {
			method: "POST",
			headers: {
				authorization: "Bearer fixture-token",
				cookie: "blog-cookie=1",
			},
			body: '{"domain":"example.com"}',
		}),
		assets,
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("set-cookie"), null);
});

test("missing blog API never forwards blog credentials to the mail server", async () => {
	const upstream = mock.method(globalThis, "fetch", async () =>
		Response.json({}),
	);
	const response = await worker.fetch(
		new Request("https://blog.example.com/api/writing/posts", {
			headers: { authorization: "Bearer blog-token" },
		}),
		assets,
	);
	assert.equal(upstream.mock.callCount(), 0);
	assert.equal(response.status, 404);
});

test("native mail page and blog JSON stay on assets", async () => {
	const upstream = mock.method(globalThis, "fetch", async () =>
		Response.json({}),
	);
	const env = { ASSETS: { fetch: async () => new Response("blog asset") } };
	for (const path of ["/mail/", "/api/allPostMeta.json"]) {
		const response = await worker.fetch(
			new Request(`https://blog.example.com${path}`),
			env,
		);
		assert.equal(await response.text(), "blog asset");
	}
	assert.equal(upstream.mock.callCount(), 0);
});
