import worker from "../../worker/index.js";

// vercel.json 将 /api/mail-auth/<多段路径> 重写到本函数，查询参数 __suffix
// 携带原始后缀（嵌套可选 catch-all 的编译路由只匹配单段子路径）；构建器自带的
// 单段路由则直接给出原始 pathname。这里统一还原原始请求路径。
function requestUrl(req) {
	const protocol = req.headers["x-forwarded-proto"] || "https";
	const host = req.headers.host || "localhost";
	const url = new URL(req.url || "/api/mail-auth", `${protocol}://${host}`);
	const suffix = url.searchParams.get("__suffix");
	if (typeof suffix === "string" && suffix) {
		url.searchParams.delete("__suffix");
		url.pathname = `/api/mail-auth/${suffix.replace(/^\/+/, "")}`;
	}
	return url.toString();
}

function requestHeaders(req) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		headers.set(
			name,
			Array.isArray(value)
				? value.join(name === "cookie" ? "; " : ", ")
				: value,
		);
	}
	return headers;
}

async function requestBody(req) {
	if (["GET", "HEAD"].includes(String(req.method).toUpperCase()))
		return undefined;
	if (typeof req.body === "string") return req.body;
	if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
	return undefined;
}

function mailAuthEnv() {
	const env = {
		MAIL_ADMIN_SESSION_SECRET: process.env.MAIL_ADMIN_SESSION_SECRET,
		MAIL_USER_SESSION_SECRET: process.env.MAIL_USER_SESSION_SECRET,
		MAIL_UPSTREAM_ORIGIN: process.env.MAIL_UPSTREAM_ORIGIN,
		CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
		CLOUDFLARE_D1_DATABASE_ID: process.env.CLOUDFLARE_D1_DATABASE_ID,
		CLOUDFLARE_D1_API_TOKEN: process.env.CLOUDFLARE_D1_API_TOKEN,
		ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
	};
	return env;
}

export default async function handler(req, res) {
	if (
		!process.env.MAIL_USER_SESSION_SECRET &&
		!process.env.MAIL_ADMIN_SESSION_SECRET
	) {
		res
			.status(500)
			.json({ error: "MAIL_USER_SESSION_SECRET（或 MAIL_ADMIN_SESSION_SECRET）未配置" });
		return;
	}

	try {
		const request = new Request(requestUrl(req), {
			method: req.method,
			headers: requestHeaders(req),
			body: await requestBody(req),
		});
		const response = await worker.fetch(request, mailAuthEnv());
		res.statusCode = response.status;
		for (const [name, value] of response.headers) res.setHeader(name, value);
		res.end(Buffer.from(await response.arrayBuffer()));
	} catch (error) {
		res
			.status(502)
			.json({ error: error instanceof Error ? error.message : "邮箱认证代理失败" });
	}
}
