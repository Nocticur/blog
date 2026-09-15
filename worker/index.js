const MAIL_API_ORIGIN = "https://apimail.noctis.eu.cc";
const MAIL_API_PATH =
	/^\/api\/(?:new_address|parsed_mails|parsed_mail\/[^/]+|mails\/[^/]+(?:\/read)?|clear_inbox|delete_address)$/;

const FORWARDED_REQUEST_HEADERS = new Set([
	"accept",
	"accept-language",
	"authorization",
	"content-type",
	"x-custom-auth",
	"x-lang",
]);

function proxyRequestHeaders(request) {
	const headers = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	headers.set("origin", MAIL_API_ORIGIN);
	headers.set("referer", `${MAIL_API_ORIGIN}/`);
	return headers;
}

function proxyResponseHeaders(response) {
	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	headers.delete("set-cookie");
	headers.set("cache-control", "no-store");
	return headers;
}

function emptyServiceWorkerResponse() {
	return new Response("", {
		status: 200,
		headers: {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

async function proxyMailApi(request) {
	const requestUrl = new URL(request.url);
	const targetUrl = new URL(MAIL_API_ORIGIN);
	const pathname = requestUrl.pathname;
	targetUrl.pathname = pathname || "/";
	targetUrl.search = requestUrl.search;

	const method = request.method.toUpperCase();
	const init = {
		method,
		headers: proxyRequestHeaders(request),
		redirect: "follow",
	};
	if (method !== "GET" && method !== "HEAD") init.body = request.body;

	const response = await fetch(targetUrl, init);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: proxyResponseHeaders(response),
	});
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

		if (pathname === "/registerSW.js" || pathname === "/sw.js") {
			return emptyServiceWorkerResponse();
		}

		if (MAIL_API_PATH.test(pathname)) {
			return proxyMailApi(request);
		}

		return env.ASSETS.fetch(request);
	},
};
