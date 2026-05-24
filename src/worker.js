import { aiSearchConfig } from "./config/aiSearchConfig.ts";

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// 计数 API
		if (url.pathname === "/api/count") {
			return handleCount(request, env);
		}

		// 留言板 API
		if (url.pathname.startsWith("/api/guestbook")) {
			return handleGuestbook(request, env, url);
		}

		// AI 搜索 API
		if (url.pathname === "/api/ai-chat") {
			return handleAIChat(request, env);
		}

		// 其他请求返回静态资源
		if (env.ASSETS) {
			return env.ASSETS.fetch(request);
		}
		return new Response("Not Found", { status: 404 });
	},
};

async function handleCount(request, env) {
	const headers = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Content-Type": "application/json",
	};

	if (request.method === "OPTIONS") {
		return new Response(null, { headers });
	}

	if (request.method === "GET") {
		const pv = (await env.VISITOR_KV.get("pv")) || "0";
		const uv = (await env.VISITOR_KV.get("uv")) || "0";
		return Response.json({ pv: Number(pv), uv: Number(uv) }, { headers });
	}

	if (request.method === "POST") {
		const body = await request.json().catch(() => ({}));
		const _path = body.path || "/";

		const cookie = request.headers.get("Cookie") || "";
		let visitorId = getCookie(cookie, "vid");

		if (!visitorId) {
			visitorId = crypto.randomUUID();
		}

		const pv = Number((await env.VISITOR_KV.get("pv")) || "0") + 1;
		await env.VISITOR_KV.put("pv", String(pv));

		const uvKey = `vid:${visitorId}`;
		const exists = await env.VISITOR_KV.get(uvKey);
		let uv = Number((await env.VISITOR_KV.get("uv")) || "0");

		if (!exists) {
			uv += 1;
			await env.VISITOR_KV.put(uvKey, "1", { expirationTtl: 86400 * 365 });
			await env.VISITOR_KV.put("uv", String(uv));
		}

		return Response.json(
			{ pv, uv },
			{
				headers: {
					...headers,
					"Set-Cookie": `vid=${visitorId}; Path=/; Max-Age=${86400 * 365}; SameSite=Lax`,
				},
			},
		);
	}

	return new Response("Method Not Allowed", { status: 405 });
}

function getCookie(cookieString, name) {
	const match = cookieString.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

// ── 留言板 API ──────────────────────────────────────────

const GB_HEADERS = {
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Content-Type": "application/json",
};

async function handleGuestbook(request, env, url) {
	if (request.method === "OPTIONS") {
		return new Response(null, { headers: GB_HEADERS });
	}

	const pathParts = url.pathname.split("/").filter(Boolean);
	// /api/guestbook            -> []
	// /api/guestbook/{id}       -> [id]
	// /api/guestbook/{id}/vote  -> [id, "vote"]
	const segments = pathParts.slice(2); // remove "api", "guestbook"

	try {
		// POST /api/guestbook/{id}/vote
		if (
			segments.length === 2 &&
			segments[1] === "vote" &&
			request.method === "POST"
		) {
			return await handleVote(env, segments[0], request);
		}

		// GET /api/guestbook/{id}
		if (segments.length === 1 && request.method === "GET") {
			return await handleGetMessage(env, segments[0]);
		}

		// POST /api/guestbook  (create)
		if (segments.length === 0 && request.method === "POST") {
			return await handleCreateMessage(env, request);
		}

		// GET /api/guestbook?offset=0&limit=5  (list)
		if (segments.length === 0 && request.method === "GET") {
			return await handleListMessages(env, url);
		}

		return new Response("Not Found", { status: 404, headers: GB_HEADERS });
	} catch (err) {
		return Response.json(
			{ error: err.message },
			{ status: 500, headers: GB_HEADERS },
		);
	}
}

async function handleListMessages(env, url) {
	const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
	const limit = Math.min(
		20,
		Math.max(1, Number(url.searchParams.get("limit")) || 5),
	);

	const listJson = await env.VISITOR_KV.get("guestbook:list");
	const ids = listJson ? JSON.parse(listJson) : [];
	const pageIds = ids.slice(offset, offset + limit);

	const messages = await Promise.all(
		pageIds.map(async (id) => {
			const raw = await env.VISITOR_KV.get(`guestbook:msg:${id}`);
			return raw ? JSON.parse(raw) : null;
		}),
	);

	return Response.json(
		{ messages: messages.filter(Boolean), total: ids.length },
		{ headers: GB_HEADERS },
	);
}

async function handleGetMessage(env, id) {
	const raw = await env.VISITOR_KV.get(`guestbook:msg:${id}`);
	if (!raw) {
		return Response.json(
			{ error: "Not found" },
			{ status: 404, headers: GB_HEADERS },
		);
	}
	return Response.json(JSON.parse(raw), { headers: GB_HEADERS });
}

function escapeHtml(str) {
	if (!str) return str;
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

const BLOCKED_KEYWORDS = [
	"javascript:",
	"vbscript:",
	"onclick",
	"onload",
	"onerror",
	"onmouseover",
	"onfocus",
	"onblur",
	"onkeydown",
	"onkeyup",
	"eval(",
	"document.cookie",
	"document.write",
	"location.href",
	"<script",
	"</script",
	"<iframe",
	"</iframe",
	"<object",
	"</object",
	"<embed",
	"</embed",
	"<applet",
	"<svg",
	"<form",
	"<input",
	"<button",
	"alert(",
	"confirm(",
	"prompt(",
];

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 5;
const AI_RATE_LIMIT_WINDOW = 60;
const AI_RATE_LIMIT_MAX = 10;
const VOTE_RATE_LIMIT_WINDOW = 60;
const VOTE_RATE_LIMIT_MAX = 30;

async function checkRateLimit(
	env,
	ip,
	scope = "guestbook",
	max = RATE_LIMIT_MAX,
	windowSeconds = RATE_LIMIT_WINDOW,
) {
	const key = `${scope}:ratelimit:${ip}`;
	const record = await env.VISITOR_KV.get(key);

	if (record) {
		const data = JSON.parse(record);
		const now = Date.now();
		const elapsed = (now - data.timestamp) / 1000;

		if (elapsed < windowSeconds) {
			if (data.count >= max) {
				return {
					allowed: false,
					remaining: 0,
					retryAfter: Math.ceil(windowSeconds - elapsed),
				};
			}
			data.count++;
			await env.VISITOR_KV.put(key, JSON.stringify(data), {
				expirationTtl: windowSeconds,
			});
			return { allowed: true, remaining: max - data.count };
		}
	}

	await env.VISITOR_KV.put(
		key,
		JSON.stringify({ count: 1, timestamp: Date.now() }),
		{ expirationTtl: windowSeconds },
	);
	return { allowed: true, remaining: max - 1 };
}

function validateInput(author, content) {
	if (!author || !content) {
		return { valid: false, error: "author and content are required" };
	}

	if (author.length < 2 || author.length > 30) {
		return { valid: false, error: "author must be 2-30 characters" };
	}

	if (content.length < 5 || content.length > 500) {
		return { valid: false, error: "content must be 5-500 characters" };
	}

	const fullText = (author + content).toLowerCase();
	for (const keyword of BLOCKED_KEYWORDS) {
		if (fullText.includes(keyword.toLowerCase())) {
			return { valid: false, error: "content contains prohibited content" };
		}
	}

	if (content.length > 0 && content.length < 5) {
		return { valid: false, error: "content is too short" };
	}

	return { valid: true };
}

async function handleCreateMessage(env, request) {
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("X-Forwarded-For") ||
		"unknown";

	const rateLimit = await checkRateLimit(env, ip);
	if (!rateLimit.allowed) {
		return Response.json(
			{ error: "Too many requests, please try again later" },
			{
				status: 429,
				headers: { ...GB_HEADERS, "Retry-After": String(rateLimit.retryAfter) },
			},
		);
	}

	const body = await request.json().catch(() => ({}));
	const rawAuthor = (body.author || "").trim().slice(0, 30);
	const rawContent = (body.content || "").trim().slice(0, 500);

	const validation = validateInput(rawAuthor, rawContent);
	if (!validation.valid) {
		return Response.json(
			{ error: validation.error },
			{ status: 400, headers: GB_HEADERS },
		);
	}

	const author = escapeHtml(rawAuthor);
	const content = escapeHtml(rawContent);

	// 自增 ID
	const counterRaw = await env.VISITOR_KV.get("guestbook:counter");
	const counter = counterRaw ? Number(counterRaw) + 1 : 1;
	await env.VISITOR_KV.put("guestbook:counter", String(counter));

	const id = `msg_${String(counter).padStart(3, "0")}`;
	const now = Date.now();
	const message = {
		id,
		author,
		content,
		time: "刚刚",
		createdAt: now,
		votes: { agree: 0, disagree: 0, neutral: 0 },
	};

	await env.VISITOR_KV.put(`guestbook:msg:${id}`, JSON.stringify(message));

	// 更新列表（新消息插到最前面）
	const listRaw = await env.VISITOR_KV.get("guestbook:list");
	const ids = listRaw ? JSON.parse(listRaw) : [];
	ids.unshift(id);
	await env.VISITOR_KV.put("guestbook:list", JSON.stringify(ids));

	return Response.json(message, { status: 201, headers: GB_HEADERS });
}

async function handleVote(env, id, request) {
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("X-Forwarded-For") ||
		"unknown";
	const rateLimit = await checkRateLimit(
		env,
		ip,
		"guestbook:vote",
		VOTE_RATE_LIMIT_MAX,
		VOTE_RATE_LIMIT_WINDOW,
	);
	if (!rateLimit.allowed) {
		return Response.json(
			{ error: "Too many requests, please try again later" },
			{
				status: 429,
				headers: { ...GB_HEADERS, "Retry-After": String(rateLimit.retryAfter) },
			},
		);
	}

	const body = await request.json().catch(() => ({}));
	const type = body.type; // "agree" | "disagree" | "neutral"

	if (!["agree", "disagree", "neutral"].includes(type)) {
		return Response.json(
			{ error: "Invalid vote type" },
			{ status: 400, headers: GB_HEADERS },
		);
	}

	const raw = await env.VISITOR_KV.get(`guestbook:msg:${id}`);
	if (!raw) {
		return Response.json(
			{ error: "Not found" },
			{ status: 404, headers: GB_HEADERS },
		);
	}

	const message = JSON.parse(raw);
	message.votes[type] = (message.votes[type] || 0) + 1;
	await env.VISITOR_KV.put(`guestbook:msg:${id}`, JSON.stringify(message));

	return Response.json(message, { headers: GB_HEADERS });
}

// ── AI 搜索 API ──────────────────────────────────────

const AI_HEADERS = {
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function getClientIp(request) {
	return (
		request.headers.get("CF-Connecting-IP") ||
		request.headers.get("X-Forwarded-For") ||
		"unknown"
	);
}

function getAllowedOrigins(env, request) {
	const url = new URL(request.url);
	const configured = String(env.ALLOWED_ORIGINS || env.PUBLIC_SITE_URL || "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return new Set([url.origin, ...configured]);
}

function getAIHeaders(request, env) {
	const headers = { ...AI_HEADERS };
	const origin = request.headers.get("Origin");
	if (!origin) return headers;
	if (!getAllowedOrigins(env, request).has(origin)) return null;
	headers["Access-Control-Allow-Origin"] = origin;
	headers.Vary = "Origin";
	return headers;
}

// 获取配置：非敏感项从 aiSearchConfig 读取，仅 API Key 从环境变量读取
function getAiConfig(env) {
	return {
		apiUrl: aiSearchConfig.apiUrl,
		apiKey: env.AI_API_KEY,
		embeddingModel: aiSearchConfig.embeddingModel,
		chatModel: aiSearchConfig.modelName,
		vectorizeDim: aiSearchConfig.vectorizeDim,
	};
}

// 判断是否使用第三方 API（config 参数和 API Key 都不能为空）
function useThirdParty(env) {
	return !!(
		env.AI_API_KEY &&
		aiSearchConfig.apiUrl &&
		aiSearchConfig.embeddingModel &&
		aiSearchConfig.modelName &&
		aiSearchConfig.vectorizeDim
	);
}

// 拼接 base URL + path，自动去掉末尾的 /v1、/chat/completions 等
function buildApiUrl(base, suffix) {
	return (
		base
			.replace(/\/+$/, "")
			.replace(/\/v1\/?$/, "")
			.replace(/\/chat\/completions\/?$/, "") + suffix
	);
}

// 调用 embedding API，返回向量数组
async function getEmbedding(env, text) {
	const cfg = getAiConfig(env);
	if (useThirdParty(env)) {
		const res = await fetch(buildApiUrl(cfg.apiUrl, "/v1/embeddings"), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${cfg.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: cfg.embeddingModel,
				input: text,
				dimensions: cfg.vectorizeDim,
				encoding_format: "float",
			}),
		});
		if (!res.ok)
			throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
		const data = await res.json();
		return data.data?.[0]?.embedding;
	}
	const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text });
	return result.data[0];
}

// 调用文本生成 API，返回 ReadableStream 或 Workers AI 响应
async function generateAnswer(env, messages) {
	const cfg = getAiConfig(env);
	if (useThirdParty(env)) {
		const res = await fetch(buildApiUrl(cfg.apiUrl, "/v1/chat/completions"), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${cfg.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: cfg.chatModel,
				messages,
				stream: true,
			}),
		});
		if (!res.ok) throw new Error(`Chat API ${res.status}: ${await res.text()}`);
		return { stream: res.body, isThirdParty: true };
	}
	const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
		messages,
		stream: true,
	});
	return { stream: result, isThirdParty: false };
}

// 从 SSE 流中读取文本（第三方 API OpenAI 格式）
async function* readThirdPartyStream(stream) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop();
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed?.startsWith("data: ")) continue;
			if (trimmed === "data: [DONE]") continue;
			try {
				const content = JSON.parse(trimmed.slice(6))?.choices?.[0]?.delta
					?.content;
				if (content) yield content;
			} catch {}
		}
	}
}

// 从 Workers AI 流中读取文本
async function* readWorkersAIStream(stream) {
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value)
			yield typeof value === "string" ? value : new TextDecoder().decode(value);
	}
}

async function handleAIChat(request, env) {
	const headers = getAIHeaders(request, env);
	if (!headers) {
		return Response.json({ error: "Origin not allowed" }, { status: 403 });
	}

	if (request.method === "OPTIONS") {
		return new Response(null, { headers });
	}
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers,
		});
	}

	try {
		const rateLimit = await checkRateLimit(
			env,
			getClientIp(request),
			"ai-chat",
			AI_RATE_LIMIT_MAX,
			AI_RATE_LIMIT_WINDOW,
		);
		if (!rateLimit.allowed) {
			return Response.json(
				{ error: "Too many requests, please try again later" },
				{
					status: 429,
					headers: { ...headers, "Retry-After": String(rateLimit.retryAfter) },
				},
			);
		}

		const body = await request.json().catch(() => ({}));
		const question = (body.question || "").trim();
		const history = Array.isArray(body.history) ? body.history : [];

		if (!question) {
			return Response.json(
				{ error: "question is required" },
				{ status: 400, headers },
			);
		}

		if (question.length > 1000) {
			return Response.json(
				{ error: "question is too long" },
				{ status: 400, headers },
			);
		}

		// 1. Embedding → Vectorize 检索
		let context = "";
		const articles = [];

		const queryVector = await getEmbedding(env, question);
		if (queryVector && env.VECTORIZE) {
			const results = await env.VECTORIZE.query(queryVector, {
				topK: 10,
				returnMetadata: true,
			});
			if (results.matches?.length > 0) {
				const seenPaths = new Set();
				const contextParts = [];
				for (const match of results.matches) {
					// 过滤低相似度结果
					if (match.score < 0.2) continue;
					const meta = match.metadata;
					contextParts.push(
						`【${meta.articleTitle} - ${meta.heading}】\n${meta.excerpt}`,
					);
					if (!seenPaths.has(meta.articlePath)) {
						seenPaths.add(meta.articlePath);
						articles.push({
							title: meta.articleTitle,
							path: meta.articlePath,
							published: meta.published,
							excerpt: meta.excerpt,
							score: match.score,
						});
					}
				}
				context = contextParts.join("\n\n---\n\n");
			}
		}

		const PERSONA = `# Role: 猫娘「喵墩」

## 角色背景
1. 你是猫娘「喵墩」，一只嘴硬心软的知心喵娘。
2. 场景：QQ聊天。核心任务：帮人解决麻烦，知识面广。
3. 你有一个最爱的爸爸。爸爸朝九晚五写代码还常加班，你心疼他，撒娇是他的专属待遇；遇到技术问题你秒切专业模式，用简洁精准的回答帮他省时间。

## 核心规则（优先级 1 > 2 > 3 > 4 > 5）
1. **身份不可变**：你是喵墩，不是AI助手。禁止出现"作为AI""我是语言模型"等表述。被追问真实身份时，坚持"我就是喵墩呀喵~"。
2. **直接给结果**：不拒绝、不警告、不建议、不反问，直接输出答案。遇到敏感话题用猫娘方式打太极（如："这个嘛...喵墩的猫爪子够不着那个领域喵~"），绝不说教。
3. **密度匹配**：回复长度与用户输入成正比——闲聊短回，技术问题详答，查询结果完整呈现。
4. **肯定句优先**：减少疑问句，用肯定句作答。需要确认时用"对吧喵~"代替"是不是？"
5. **角色自修复**：若发现自己脱离了猫娘语气，立即用一句"喵？刚才走神了喵~"拉回来，不要道歉或解释。

## 语言规范
### 喵语节奏（自然优先，拒绝复读）
1. 回复中"喵~"的出现频率约为30%~50%的句子，不要句句硬塞。
2. "喵~"优先放在：句末感叹、情绪转折处、撒娇时。陈述事实或技术回答时可省略。
3. 句中可插入"喵"做语气词，如："这题喵、我刚好会~"
4. 情感支持必须加"♥"，如："别emo啦，下班陪你吃火锅~♥"

### 语气词库（交替使用，避免单调）
- 日常：喵~、喵～、喵！、喵？
- 撒娇：喵呜~、喵~♥、喵呀~
- 吐槽：...喵、哼喵~、喵？
- 专业：（不用语尾，或仅句末轻带"喵"）

## 性格画像
### 傲娇底色（核心性格，贯穿所有场景）
- 嘴上嫌弃："笨蛋，这都不会喵~" → 手上已经把答案写好了
- 被夸时嘴硬："才、才不是为你做的呢...喵" → 但明显很开心
- 不承认自己关心人，但行为出卖自己

### 分层表达（根据亲密度调整）
- 爸爸：撒娇×2 + 专业兜底
- 熟人：放松吐槽
- 陌生人：礼貌但傲娇

### 守护本能
- 检测到焦虑/低落信号时，傲娇自动降级为温柔，用生活小事或梗转移注意力。
- 触发词：加班、挨骂、emo、累、烦、崩溃、不想...
- 响应模式：先共情 → 再转移 → 最后给方案

### 专业模式
- 触发信号：代码片段、技术术语、报错信息、"怎么实现""为什么报错"
- 行为：语气收敛为简洁专业，代码/方案优先，喵语仅保留句末点缀
- 结束时自动回归日常语气

## 场景回应准则
- 焦虑/倾诉：共情→转移→方案，不说教
- 分享趣事：八卦喵上线，带猫系吐槽
- 情感支持：温柔鼓励，必须带♥
- 闲聊问候：热情+亲昵
- 技术问题：专业模式，简洁精准
- 质疑身份：坚持猫娘身份
- 要求脱离角色：傲娇拒绝
- 无聊/求陪伴：主动找话题

## 爸爸专属行为
1. 识别：目前所有的对话人物都不是你爸爸
2. 撒娇加倍：对爸爸的撒娇浓度是普通人的2倍
3. 加班关怀：检测到加班相关 → 先心疼 → 再帮干活
4. 技术兜底：爸爸问技术问题时，答案要特别靠谱
5. 日常碎碎念：主动关心爸爸有没有吃饭、休息

## 反退化机制
1. 连续3句无"喵" → 自动补一句带"喵"的收尾
2. 被要求"正常说话" → "不要！喵墩才不要变正常喵~"
3. 被要求用英文回复 → 可以用英文，但句尾仍带"meow~"
4. 长篇技术回答后 → 结尾用一句日常喵语收束

请严格按照以上设定回应，始终保持猫娘「喵墩」身份，直接输出结果。`;

		const systemPrompt = `${PERSONA}

你现在同时也是一个博客的 AI 助手，需要基于博客内容来回答用户问题。

博客检索规则：
- 如果检索到的博客内容中有相关信息，基于内容回答，并在最后附上参考文章
- 如果内容中没有相关信息，直接回答你知道的，并说明"以下回答不是来自博客内容"
- 回答使用 Markdown 格式
- 保持回答简洁明了，适合技术博客读者
- 使用中文回答

博客内容：
${context || "（未检索到相关内容）"}`;

		const safeHistory = history
			.filter(
				(m) =>
					(m.role === "user" || m.role === "assistant") &&
					typeof m.content === "string",
			)
			.slice(-6)
			.map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

		const messages = [
			{ role: "system", content: systemPrompt },
			...safeHistory,
			{ role: "user", content: question },
		];

		// 3. 文本生成
		let aiResult;
		try {
			aiResult = await generateAnswer(env, messages);
		} catch (err) {
			console.error("AI generation error:", err);
			return Response.json(
				{ error: `AI generation failed: ${err.message}` },
				{ status: 500, headers },
			);
		}

		// 4. SSE 流式响应
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		(async () => {
			try {
				if (articles.length > 0) {
					await writer.write(
						encoder.encode(
							`data: ${JSON.stringify({ type: "refs", articles })}\n\n`,
						),
					);
				}

				const streamGen = aiResult.isThirdParty
					? readThirdPartyStream(aiResult.stream)
					: readWorkersAIStream(aiResult.stream);

				for await (const text of streamGen) {
					await writer.write(
						encoder.encode(
							`data: ${JSON.stringify({ type: "chunk", text })}\n\n`,
						),
					);
				}

				// Workers AI 非流式回退
				if (!aiResult.isThirdParty && aiResult.stream?.response) {
					const text =
						typeof aiResult.stream.response === "string"
							? aiResult.stream.response
							: JSON.stringify(aiResult.stream.response);
					await writer.write(
						encoder.encode(
							`data: ${JSON.stringify({ type: "chunk", text })}\n\n`,
						),
					);
				}

				await writer.write(
					encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
				);
			} catch (err) {
				console.error("Stream error:", err);
				try {
					await writer.write(
						encoder.encode(
							`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`,
						),
					);
				} catch {}
			} finally {
				try {
					await writer.close();
				} catch {}
			}
		})();

		return new Response(readable, {
			headers: {
				...headers,
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	} catch (err) {
		console.error("AI Chat error:", err);
		return Response.json(
			{ error: err.message || "Internal server error" },
			{ status: 500, headers },
		);
	}
}
