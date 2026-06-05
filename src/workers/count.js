// KV 缓存
const CACHE_KEY = "umami:site-stats";
const CACHE_TTL = 300; // 5 分钟（秒）

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Content-Type": "application/json",
};

/**
 * 获取 Umami 全站统计
 * @param {object} env - Worker 环境变量
 * @returns {Promise<{pv: number, uv: number}>}
 */
async function fetchSiteStats(env) {
	const apiUrl = env.UMAMI_API_URL;
	const websiteId = env.UMAMI_WEBSITE_ID;
	const token = env.UMAMI_TOKEN;

	const now = Date.now();
	const params = new URLSearchParams({
		startAt: "0",
		endAt: String(now),
	});

	const url = `${apiUrl}/api/websites/${websiteId}/stats?${params}`;

	const resp = await fetch(url, {
		redirect: "manual",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});

	// 手动处理重定向（Vercel 托管的 Umami 可能触发重定向循环）
	if (resp.status >= 300 && resp.status < 400) {
		const location = resp.headers.get("Location");
		if (location) {
			const redirectResp = await fetch(location, {
				redirect: "follow",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			});
			if (!redirectResp.ok) {
				const text = await redirectResp.text();
				throw new Error(`Umami redirect error ${redirectResp.status}: ${text}`);
			}
			return redirectResp.json();
		}
	}

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Umami API error ${resp.status}: ${text}`);
	}

	const data = await resp.json();
	return { pv: data.pageviews, uv: data.visitors };
}

export async function handleCount(request, env) {
	if (request.method === "OPTIONS") {
		return new Response(null, { headers: corsHeaders });
	}

	if (!env.UMAMI_TOKEN) {
		return Response.json(
			{ error: "UMAMI_TOKEN not configured" },
			{ status: 500, headers: corsHeaders },
		);
	}

	// GET 和 POST 都返回全站统计
	if (request.method === "GET" || request.method === "POST") {
		try {
			// 尝试读缓存
			const cached = await env.VISITOR_KV.get(CACHE_KEY, { type: "json" });
			if (cached) {
				return Response.json(cached, { headers: corsHeaders });
			}

			const result = await fetchSiteStats(env);

			// 写缓存
			await env.VISITOR_KV.put(CACHE_KEY, JSON.stringify(result), {
				expirationTtl: CACHE_TTL,
			});

			return Response.json(result, { headers: corsHeaders });
		} catch (e) {
			return Response.json(
				{ error: e.message },
				{ status: 502, headers: corsHeaders },
			);
		}
	}

	return new Response("Method Not Allowed", {
		status: 405,
		headers: corsHeaders,
	});
}
