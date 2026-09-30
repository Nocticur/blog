export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

		// 兼容旧客户端，避免加载已停用的 Service Worker 脚本。
		if (pathname === "/registerSW.js" || pathname === "/sw.js") {
			return new Response("", {
				status: 200,
				headers: {
					"content-type": "text/javascript; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}

		return env.ASSETS.fetch(request);
	},
};
