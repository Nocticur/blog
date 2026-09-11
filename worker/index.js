const CLOUD_MAIL_ORIGIN = "https://mail.mourn.top";

const CLOUD_MAIL_ROUTES = new Set([
	"/all-mail",
	"/all-mail/",
	"/all-users",
	"/all-users/",
	"/analysis",
	"/analysis/",
	"/drafts",
	"/drafts/",
	"/inbox",
	"/inbox/",
	"/invite-code",
	"/invite-code/",
	"/login",
	"/login/",
	"/mail",
	"/mail/",
	"/role",
	"/role/",
	"/sent",
	"/sent/",
	"/settings",
	"/settings/",
	"/starred",
	"/starred/",
	"/system-settings",
	"/system-settings/",
	"/test",
	"/test/",
]);

const CLOUD_MAIL_ROOT_FILES = new Set([
	"/manifest.webmanifest",
	"/mail-pwa.png",
]);

const FORWARDED_REQUEST_HEADERS = new Set([
	"accept",
	"accept-language",
	"authorization",
	"content-type",
	"if-none-match",
	"range",
	"user-agent",
]);

function isCloudMailPath(pathname) {
	return (
		CLOUD_MAIL_ROUTES.has(pathname) ||
		CLOUD_MAIL_ROOT_FILES.has(pathname) ||
		pathname.startsWith("/assets/") ||
		pathname.startsWith("/api/")
	);
}

function isCacheSensitive(pathname) {
	return (
		CLOUD_MAIL_ROUTES.has(pathname) ||
		pathname.endsWith("/") ||
		CLOUD_MAIL_ROOT_FILES.has(pathname) ||
		pathname.startsWith("/api/")
	);
}

function rewriteLocation(location) {
	try {
		const url = new URL(location, CLOUD_MAIL_ORIGIN);
		if (url.origin !== CLOUD_MAIL_ORIGIN) return location;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return location;
	}
}

function proxyRequestHeaders(request) {
	const headers = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	headers.set("origin", CLOUD_MAIL_ORIGIN);
	headers.set("referer", `${CLOUD_MAIL_ORIGIN}/`);
	return headers;
}

function proxyResponseHeaders(response, pathname) {
	const headers = new Headers(response.headers);
	headers.delete("x-frame-options");
	headers.delete("content-security-policy");
	headers.delete("content-encoding");
	headers.delete("content-length");
	headers.delete("set-cookie");

	const location = headers.get("location");
	if (location) headers.set("location", rewriteLocation(location));
	if (isCacheSensitive(pathname)) headers.set("cache-control", "no-store");

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

async function fetchCloudMail(request) {
	const targetUrl = new URL(request.url);
	targetUrl.protocol = "https:";
	targetUrl.host = "mail.mourn.top";
	targetUrl.port = "";

	const method = request.method.toUpperCase();
	const init = {
		method,
		headers: proxyRequestHeaders(request),
		redirect: "manual",
	};
	if (method !== "GET" && method !== "HEAD") init.body = request.body;

	return fetch(targetUrl, init);
}

async function tryAssetsFirst(env, request) {
	if (!env?.ASSETS) return null;
	const response = await env.ASSETS.fetch(request);
	if (response.status !== 404 && response.status !== 405) return response;
	return null;
}

async function handleCloudMail(request, env, pathname) {
	if (pathname.startsWith("/assets/") || pathname.startsWith("/api/")) {
		const assetResponse = await tryAssetsFirst(env, request);
		if (assetResponse) return assetResponse;
	}

	const upstreamResponse = await fetchCloudMail(request);
	const headers = proxyResponseHeaders(upstreamResponse, pathname);
	return new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		statusText: upstreamResponse.statusText,
		headers,
	});
}

function isServiceWorkerPath(pathname) {
	return pathname === "/registerSW.js" || pathname === "/sw.js";
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

		if (isServiceWorkerPath(pathname)) return emptyServiceWorkerResponse();

		if (!isCloudMailPath(pathname)) {
			return env.ASSETS.fetch(request);
		}

		return handleCloudMail(request, env, pathname);
	},
};
