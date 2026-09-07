import assert from "node:assert/strict";

const originalEnv = {
	WRITING_PASSWORD: process.env.WRITING_PASSWORD,
	WRITING_PASSWORD_HASH: process.env.WRITING_PASSWORD_HASH,
	GITHUB_TOKEN: process.env.GITHUB_TOKEN,
	GH_TOKEN: process.env.GH_TOKEN,
	WRITING_GITHUB_REPO: process.env.WRITING_GITHUB_REPO,
	WRITING_GITHUB_BRANCH: process.env.WRITING_GITHUB_BRANCH,
};

process.env.WRITING_PASSWORD = "writing-api-test-password";
delete process.env.WRITING_PASSWORD_HASH;
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;
process.env.WRITING_GITHUB_REPO = "Nocticur/blog";
process.env.WRITING_GITHUB_BRANCH = "master";

const { default: handler } = await import("../api/writing/[[...path]].js");

function createResponse() {
	const headers = new Map();
	let body = "";
	return {
		headers,
		get body() {
			return body;
		},
		statusCode: 200,
		setHeader(name, value) {
			headers.set(name.toLowerCase(), value);
		},
		end(value) {
			body = String(value ?? "");
		},
	};
}

async function invoke(url, { method = "GET", body, headers = {} } = {}) {
	const response = createResponse();
	const request = {
		url,
		method,
		headers: { host: "example.test", ...headers },
		body,
	};
	await handler(request, response);
	return {
		status: response.statusCode,
		headers: response.headers,
		data: JSON.parse(response.body),
	};
}

try {
	for (const path of ["/api/writing/auth/", "/api/writing/auth"]) {
		const result = await invoke(path, {
			method: "POST",
			body: JSON.stringify({ password: "wrong-password" }),
		});
		assert.equal(result.status, 401, path);
		assert.equal(result.data.error, "密码不正确", path);
	}

	const auth = await invoke("/api/writing/auth/", {
		method: "POST",
		body: { password: "writing-api-test-password" },
	});
	assert.equal(auth.status, 200);
	assert.equal(typeof auth.data.token, "string");
	assert.equal(auth.data.tokenReady, false);

	for (const path of ["/api/writing/posts/", "/api/writing/posts"]) {
		const list = await invoke(path, {
			headers: { "x-writing-auth": auth.data.token },
		});
		assert.equal(list.status, 500, path);
		assert.match(list.data.error, /GITHUB_TOKEN/, path);
	}

	console.log("writing API regression tests passed");
} finally {
	for (const [name, value] of Object.entries(originalEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}
