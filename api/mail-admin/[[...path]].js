import worker from "../../worker/index.js";

function requestUrl(req) {
	const protocol = req.headers["x-forwarded-proto"] || "https";
	const host = req.headers.host || "localhost";
	return `${protocol}://${host}${req.url || "/api/mail-admin/session"}`;
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

export default async function handler(req, res) {
	if (!process.env.MAIL_ADMIN_SESSION_SECRET) {
		res.status(500).json({ error: "MAIL_ADMIN_SESSION_SECRET 未配置" });
		return;
	}

	try {
		const request = new Request(requestUrl(req), {
			method: req.method,
			headers: requestHeaders(req),
			body: await requestBody(req),
		});
		const response = await worker.fetch(request, {
			MAIL_ADMIN_SESSION_SECRET: process.env.MAIL_ADMIN_SESSION_SECRET,
			ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
		});
		res.statusCode = response.status;
		for (const [name, value] of response.headers) res.setHeader(name, value);
		res.end(Buffer.from(await response.arrayBuffer()));
	} catch (error) {
		res
			.status(502)
			.json({ error: error instanceof Error ? error.message : "管理代理失败" });
	}
}
