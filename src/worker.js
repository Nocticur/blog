import { handleAIChat } from "./workers/ai-chat.js";
import { handleGuestbook } from "./workers/guestbook.js";

/** ASSETS 不可用时的兜底 HTML，避免纯文本 "Not Found" */
function plainNotFound() {
	return new Response(
		`<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>404</title>
	<style>
		body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee}
		main{text-align:center;padding:2rem}
		h1{font-size:4rem;margin:0;opacity:.25}
		p{margin:1rem 0 1.5rem;opacity:.75}
		a{color:inherit;text-decoration:underline}
	</style>
</head>
<body>
	<main>
		<h1>404</h1>
		<p>页面不存在</p>
		<a href="/">返回首页</a>
	</main>
</body>
</html>`,
		{
			status: 404,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			},
		},
	);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/guestbook")) {
			return handleGuestbook(request, env, url);
		}

		if (url.pathname === "/api/ai-chat") {
			return handleAIChat(request, env);
		}

		// 静态资源：html_handling / not_found_handling 由 ASSETS binding 处理
		// not_found_handling = "404-page" 时未命中会返回 dist/404.html
		if (env.ASSETS) {
			return env.ASSETS.fetch(request);
		}

		return plainNotFound();
	},
};
