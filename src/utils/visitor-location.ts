const VISITOR_IP_API = "https://v2.xxapi.cn/api/ip";
const VISITOR_WELCOME_CACHE_KEY = "nocticur:visitor-welcome";
const FALLBACK_WELCOME = "欢迎来到我的博客";
const REQUEST_TIMEOUT_MS = 3000;

type VisitorIpResponse = {
	code?: unknown;
	data?: {
		address?: unknown;
	} | null;
};

let cachedWelcome: string | null = null;
let pendingWelcome: Promise<string> | null = null;

function readSessionWelcome(): string | null {
	if (typeof window === "undefined") return null;

	try {
		const value = window.sessionStorage.getItem(VISITOR_WELCOME_CACHE_KEY);
		return value?.trim() || null;
	} catch {
		return null;
	}
}

function writeSessionWelcome(value: string) {
	if (typeof window === "undefined") return;

	try {
		window.sessionStorage.setItem(VISITOR_WELCOME_CACHE_KEY, value);
	} catch {
		// Session storage may be unavailable in private or restricted contexts.
	}
}

function cacheWelcome(value: string): string {
	cachedWelcome = value;
	writeSessionWelcome(value);
	return value;
}

async function fetchVisitorWelcome(): Promise<string> {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(
		() => controller.abort(),
		REQUEST_TIMEOUT_MS,
	);

	try {
		const response = await fetch(VISITOR_IP_API, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Visitor IP request failed: ${response.status}`);
		}

		const payload = (await response.json()) as VisitorIpResponse;
		const address =
			payload.code === 200 && payload.data
				? typeof payload.data.address === "string"
					? payload.data.address.trim()
					: ""
				: "";

		return cacheWelcome(
			address ? `欢迎${address}的朋友来到我的博客` : FALLBACK_WELCOME,
		);
	} catch {
		return cacheWelcome(FALLBACK_WELCOME);
	} finally {
		window.clearTimeout(timeoutId);
	}
}

export function getVisitorWelcome(): Promise<string> {
	if (cachedWelcome) return Promise.resolve(cachedWelcome);

	const sessionWelcome = readSessionWelcome();
	if (sessionWelcome) {
		cachedWelcome = sessionWelcome;
		return Promise.resolve(sessionWelcome);
	}

	if (pendingWelcome) return pendingWelcome;

	pendingWelcome = fetchVisitorWelcome().finally(() => {
		pendingWelcome = null;
	});
	return pendingWelcome;
}
