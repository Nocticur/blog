import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, afterEach, mock } from "node:test";
import handler from "../api/writing/[[...path]].js";

const config = JSON.parse(
	await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
);
const originalEnv = { ...process.env };
afterEach(() => {
	mock.restoreAll();
	for (const key of [
		"WRITING_PASSWORD",
		"WRITING_GITHUB_REPO",
		"WRITING_GITHUB_BRANCH",
		"GITHUB_TOKEN",
	]) {
		if (originalEnv[key] === undefined) delete process.env[key];
		else process.env[key] = originalEnv[key];
	}
});
function setup() {
	process.env.WRITING_PASSWORD = "test-only-password";
	process.env.WRITING_GITHUB_REPO = "owner/blog";
	process.env.WRITING_GITHUB_BRANCH = "main";
	process.env.GITHUB_TOKEN = "test-only-token";
}
async function invoke(path, { method = "GET", body, token } = {}) {
	let text = "";
	const res = {
		statusCode: 200,
		setHeader() {},
		end(value) {
			text = value;
		},
	};
	await handler(
		{
			url: path,
			method,
			headers: {
				host: "example.test",
				...(token ? { "x-writing-auth": token } : {}),
			},
			body,
		},
		res,
	);
	return { status: res.statusCode, data: JSON.parse(text) };
}
async function login() {
	setup();
	return (
		await invoke("/api/writing/auth", {
			method: "POST",
			body: { password: "test-only-password" },
		})
	).data.token;
}

test("Vercel explicitly routes deep content paths into the writing function", () => {
	const rewrite = config.rewrites.find((r) => r.source === "/api/writing/(.+)");
	assert.ok(
		rewrite,
		"Missing deep writing route: content/dynamic currently falls through to the platform 404",
	);
	for (const suffix of [
		"auth",
		"posts/",
		"content/dynamic",
		"content/dynamic/",
		"content/notebooks/images/",
	]) {
		const path = "/api/writing/" + suffix;
		const destination = path.replace(
			new RegExp("^" + rewrite.source + "$"),
			rewrite.destination,
		);
		const url = new URL(destination, "https://example.test");
		assert.equal(url.pathname, "/api/writing/[[...path]]");
		assert.equal(url.searchParams.get("__suffix"), suffix);
	}
});
test("rewritten login still accepts credentials", async () => {
	setup();
	const res = await invoke("/api/writing/[[...path]]?__suffix=auth/", {
		method: "POST",
		body: { password: "test-only-password" },
	});
	assert.equal(res.status, 200);
	assert.equal(typeof res.data.token, "string");
});
test("rewritten deep content paths return the content listing", async () => {
	const token = await login();
	mock.method(globalThis, "fetch", async () =>
		Response.json({
			tree: [{ type: "blob", path: "src/content/dynamic/example.md" }],
		}),
	);
	for (const path of [
		"/api/writing/content/dynamic/",
		"/api/writing/[[...path]]?__suffix=content/dynamic/",
		"/api/writing?__suffix=content/dynamic",
	]) {
		const res = await invoke(path, { token });
		assert.equal(res.status, 200, path);
		assert.deepEqual(res.data, { items: [{ file: "example.md" }] });
	}
});
test("rewrite keeps the file query for nested Markdown reads", async () => {
	const token = await login();
	let requested = "";
	mock.method(globalThis, "fetch", async (url) => {
		requested = String(url);
		return Response.json({
			type: "file",
			size: 4,
			sha: "v1",
			content: Buffer.from("body").toString("base64"),
		});
	});
	const res = await invoke(
		"/api/writing/[[...path]]?__suffix=content/notebooks/&file=book%2Fnote.md",
		{ token },
	);
	assert.equal(res.status, 200);
	assert.equal(res.data.source, "body");
	assert.match(requested, /book\/note.md\?ref=main$/);
});
test("rewritten content routes still require authentication", async () => {
	setup();
	const res = await invoke(
		"/api/writing/[[...path]]?__suffix=content/dynamic/",
	);
	assert.equal(res.status, 401);
});

test("rewritten image uploads preserve the POST body and reach the store", async () => {
	const token = await login();
	let payload;
	mock.method(globalThis, "fetch", async (url, init) => {
		assert.match(String(url), /\/contents\/public\/uploads\/dynamic\//);
		assert.equal(init.method, "PUT");
		payload = JSON.parse(init.body);
		return Response.json({ content: { sha: "uploaded" } });
	});
	const res = await invoke(
		"/api/writing/[[...path]]?__suffix=content/dynamic/images/",
		{
			method: "POST",
			token,
			body: { dataUrl: "data:image/png;base64,aGVsbG8=" },
		},
	);
	assert.equal(res.status, 200);
	assert.match(res.data.image, /^\/uploads\/dynamic\/.*\.png$/);
	assert.equal(payload.content, "aGVsbG8=");
	assert.equal(payload.branch, "main");
});
