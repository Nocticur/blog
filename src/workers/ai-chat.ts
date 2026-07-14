import { aiSearchConfig } from "../config/aiSearchConfig.ts";
import {
	assertJsonRequest,
	RequestError,
	readBoundedJson,
	readResponseSnippet,
} from "./utils/request";
import { readThirdPartyStream, readWorkersAIStream } from "./utils/streaming";

const AI_REQUEST_MAX_BYTES = 16 * 1024;
const AI_RATE_LIMIT_WINDOW = 60;
const AI_RATE_LIMIT_MAX = 10;

type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
	role: ChatRole;
	content: string;
}

interface ArticleReference {
	title: string;
	path: string;
	published: string;
	excerpt: string;
	score: number;
}

type AiStreamResult =
	| { provider: "third-party"; stream: ReadableStream<Uint8Array> }
	| {
			provider: "workers-ai";
			stream: ReadableStream<Uint8Array | string>;
	  };

class UpstreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UpstreamError";
	}
}

function getClientIp(request: Request): string {
	return request.headers.get("CF-Connecting-IP") || "development";
}

function getAllowedOrigins(env: Env, request: Request): Set<string> {
	const url = new URL(request.url);
	const configured = String(env.ALLOWED_ORIGINS || env.PUBLIC_SITE_URL || "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return new Set([url.origin, ...configured]);
}

function getAIHeaders(request: Request, env: Env): Headers | null {
	const headers = new Headers({
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	});
	const origin = request.headers.get("Origin");
	if (!origin) return headers;
	if (!getAllowedOrigins(env, request).has(origin)) return null;
	headers.set("Access-Control-Allow-Origin", origin);
	headers.set("Vary", "Origin");
	return headers;
}

function getAiConfig(env: Env) {
	return {
		apiUrl: aiSearchConfig.apiUrl,
		apiKey: env.AI_API_KEY,
		embeddingModel: aiSearchConfig.embeddingModel,
		chatModel: aiSearchConfig.modelName,
		vectorizeDim: aiSearchConfig.vectorizeDim,
	};
}

function useThirdParty(env: Env): boolean {
	return !!(
		env.AI_API_KEY &&
		aiSearchConfig.apiUrl &&
		aiSearchConfig.embeddingModel &&
		aiSearchConfig.modelName &&
		aiSearchConfig.vectorizeDim
	);
}

function buildApiUrl(base: string, suffix: string): string {
	return (
		base
			.replace(/\/+$/, "")
			.replace(/\/v1\/?$/, "")
			.replace(/\/chat\/completions\/?$/, "") + suffix
	);
}

function logError(
	event: string,
	error: unknown,
	fields: Record<string, unknown> = {},
): void {
	const details =
		error instanceof Error
			? {
					errorName: error.name,
					errorMessage: error.message,
					stack: error.stack,
				}
			: { errorMessage: String(error) };
	console.error(JSON.stringify({ event, ...fields, ...details }));
}

async function hashRateLimitKey(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	const bytes = new Uint8Array(digest);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

async function checkAiRateLimit(env: Env, request: Request) {
	const key = await hashRateLimitKey(`ai-chat:${getClientIp(request)}`);
	return env.AI_RATE_LIMITER.getByName(key).check(
		AI_RATE_LIMIT_MAX,
		AI_RATE_LIMIT_WINDOW,
	);
}

function getEmbeddingFromPayload(payload: unknown): number[] | null {
	if (!payload || typeof payload !== "object") return null;
	const data = Reflect.get(payload, "data");
	if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object")
		return null;
	const embedding = Reflect.get(data[0], "embedding");
	if (
		!Array.isArray(embedding) ||
		!embedding.every((value) => typeof value === "number")
	) {
		return null;
	}
	return embedding;
}

async function getEmbedding(
	env: Env,
	text: string,
	signal: AbortSignal,
): Promise<number[] | null> {
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
			signal,
		});
		if (!res.ok) {
			const snippet = await readResponseSnippet(res);
			logError(
				"ai_embedding_upstream_error",
				new Error("Embedding request failed"),
				{
					provider: "third-party",
					status: res.status,
					responseSnippet: snippet,
				},
			);
			throw new UpstreamError("Embedding service failed");
		}
		const embedding = getEmbeddingFromPayload(await res.json());
		if (!embedding)
			throw new UpstreamError("Embedding service returned invalid data");
		return embedding;
	}
	try {
		const result = (await env.AI.run("@cf/baai/bge-large-en-v1.5", {
			text,
		})) as {
			data?: number[][];
		};
		return Array.isArray(result.data?.[0]) ? result.data[0] : null;
	} catch (error) {
		logError("ai_embedding_upstream_error", error, { provider: "workers-ai" });
		throw new UpstreamError("Embedding service failed");
	}
}

async function generateAnswer(
	env: Env,
	messages: ChatMessage[],
	signal: AbortSignal,
): Promise<AiStreamResult> {
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
			signal,
		});
		if (!res.ok) {
			const snippet = await readResponseSnippet(res);
			logError("ai_chat_upstream_error", new Error("Chat request failed"), {
				provider: "third-party",
				status: res.status,
				responseSnippet: snippet,
			});
			throw new UpstreamError("Chat service failed");
		}
		if (!res.body) throw new UpstreamError("Chat service returned no stream");
		return { stream: res.body, provider: "third-party" };
	}
	try {
		const stream = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
			messages,
			stream: true,
		});
		return {
			stream: stream as ReadableStream<Uint8Array | string>,
			provider: "workers-ai",
		};
	} catch (error) {
		logError("ai_chat_upstream_error", error, { provider: "workers-ai" });
		throw new UpstreamError("Chat service failed");
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

### 禁止使用
- 绝对禁止使用任何 emoji 表情符号（如 😊、😢、👍、🔥 等），只能用文字和标点表达语气

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

function parseChatRequest(payload: unknown): {
	question: string;
	history: ChatMessage[];
} {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new RequestError(
			400,
			"INVALID_REQUEST",
			"Request body must be an object",
		);
	}

	const rawQuestion = Reflect.get(payload, "question");
	if (typeof rawQuestion !== "string" || !rawQuestion.trim()) {
		throw new RequestError(400, "INVALID_REQUEST", "question is required");
	}
	const question = rawQuestion.trim();
	if (question.length > 1000) {
		throw new RequestError(400, "INVALID_REQUEST", "question is too long");
	}

	const rawHistory = Reflect.get(payload, "history");
	if (rawHistory !== undefined && !Array.isArray(rawHistory)) {
		throw new RequestError(400, "INVALID_REQUEST", "history must be an array");
	}
	if (Array.isArray(rawHistory) && rawHistory.length > 20) {
		throw new RequestError(
			400,
			"INVALID_REQUEST",
			"history has too many entries",
		);
	}

	const history: ChatMessage[] = [];
	for (const entry of rawHistory ?? []) {
		if (!entry || typeof entry !== "object") {
			throw new RequestError(
				400,
				"INVALID_REQUEST",
				"history entry is invalid",
			);
		}
		const role = Reflect.get(entry, "role");
		const content = Reflect.get(entry, "content");
		if (
			(role !== "user" && role !== "assistant") ||
			typeof content !== "string" ||
			content.length > 2000
		) {
			throw new RequestError(
				400,
				"INVALID_REQUEST",
				"history entry is invalid",
			);
		}
		history.push({ role, content });
	}

	return { question, history: history.slice(-6) };
}

function getMetadataString(
	metadata: Record<string, VectorizeVectorMetadata> | undefined,
	key: string,
): string | null {
	const value = metadata?.[key];
	return typeof value === "string" ? value : null;
}

function buildReference(
	metadata: Record<string, VectorizeVectorMetadata> | undefined,
	score: number,
): ArticleReference | null {
	const title = getMetadataString(metadata, "articleTitle");
	const path = getMetadataString(metadata, "articlePath");
	const heading = getMetadataString(metadata, "heading");
	const excerpt = getMetadataString(metadata, "excerpt");
	if (!title || !path || !heading || !excerpt) return null;
	return {
		title,
		path,
		published: getMetadataString(metadata, "published") ?? "",
		excerpt,
		score,
	};
}

function jsonError(
	code: string,
	message: string,
	status: number,
	headers?: Headers,
): Response {
	return Response.json({ error: message, code }, { status, headers });
}

async function writeEvent(
	writer: WritableStreamDefaultWriter<Uint8Array>,
	encoder: TextEncoder,
	payload: Record<string, unknown>,
): Promise<void> {
	await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

async function pipeAiResponse(
	result: AiStreamResult,
	articles: ArticleReference[],
	writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
	const encoder = new TextEncoder();
	try {
		if (articles.length > 0)
			await writeEvent(writer, encoder, { type: "refs", articles });

		const stream =
			result.provider === "third-party"
				? readThirdPartyStream(result.stream)
				: readWorkersAIStream(result.stream);
		for await (const text of stream) {
			await writeEvent(writer, encoder, { type: "chunk", text });
		}
		await writeEvent(writer, encoder, { type: "done" });
	} catch (error) {
		logError("ai_stream_error", error, { provider: result.provider });
		try {
			await writeEvent(writer, encoder, {
				type: "error",
				code: "AI_STREAM_FAILED",
				error: "AI response stream was interrupted",
			});
		} catch {
			// The client disconnected; the upstream reader is cancelled by the iterator.
		}
	} finally {
		await writer.close().catch(() => undefined);
	}
}

export async function handleAIChat(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const headers = getAIHeaders(request, env);
	if (!headers) {
		return jsonError("ORIGIN_NOT_ALLOWED", "Origin not allowed", 403);
	}

	if (request.method === "OPTIONS") {
		return new Response(null, { headers });
	}
	if (request.method !== "POST") {
		return jsonError("METHOD_NOT_ALLOWED", "Method not allowed", 405, headers);
	}

	try {
		assertJsonRequest(request);
		const rateLimit = await checkAiRateLimit(env, request);
		if (!rateLimit.allowed) {
			headers.set("Retry-After", String(rateLimit.retryAfter));
			return jsonError(
				"RATE_LIMITED",
				"Too many requests, please try again later",
				429,
				headers,
			);
		}

		const { question, history } = parseChatRequest(
			await readBoundedJson(request, AI_REQUEST_MAX_BYTES),
		);

		let context = "";
		const articles: ArticleReference[] = [];

		const queryVector = await getEmbedding(env, question, request.signal);
		if (queryVector && env.VECTORIZE) {
			const results = await env.VECTORIZE.query(queryVector, {
				topK: 10,
				returnMetadata: true,
			});
			if (results.matches?.length > 0) {
				const seenPaths = new Set<string>();
				const contextParts: string[] = [];
				for (const match of results.matches) {
					if (match.score < 0.2) continue;
					const article = buildReference(match.metadata, match.score);
					if (!article) continue;
					const heading =
						getMetadataString(match.metadata, "heading") ?? "正文";
					contextParts.push(
						`【${article.title} - ${heading}】\n${article.excerpt}`,
					);
					if (!seenPaths.has(article.path)) {
						seenPaths.add(article.path);
						articles.push(article);
					}
				}
				context = contextParts.join("\n\n---\n\n");
			}
		}

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

		const messages: ChatMessage[] = [
			{ role: "system", content: systemPrompt },
			...history,
			{ role: "user", content: question },
		];

		const aiResult = await generateAnswer(env, messages, request.signal);

		const { readable, writable } = new TransformStream<
			Uint8Array,
			Uint8Array
		>();
		const writer = writable.getWriter();
		ctx.waitUntil(pipeAiResponse(aiResult, articles, writer));

		headers.set("Content-Type", "text/event-stream; charset=utf-8");
		headers.set("Cache-Control", "no-cache, no-transform");
		headers.set("X-Accel-Buffering", "no");
		return new Response(readable, {
			headers,
		});
	} catch (error) {
		if (error instanceof RequestError) {
			return jsonError(error.code, error.message, error.status, headers);
		}
		if (error instanceof UpstreamError) {
			return jsonError(
				"AI_UPSTREAM_FAILED",
				"AI service is temporarily unavailable",
				502,
				headers,
			);
		}
		logError("ai_chat_error", error);
		return jsonError("INTERNAL_ERROR", "Internal server error", 500, headers);
	}
}
