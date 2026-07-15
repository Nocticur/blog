import { aiSearchConfig } from "@/config/aiSearchConfig";
import type {
	AiSearchArticleReference,
	AiSearchErrorBody,
} from "@/types/ai-search";
import type {
	AiSearchRuntime,
	RetrievalContext,
	RetrievedContent,
} from "./contracts";
import { AiSearchError } from "./errors";
import { buildAiSearchMessages } from "./prompt";
import {
	assertJsonRequest,
	createCorsHeaders,
	parseAiSearchRequest,
	readBoundedJson,
} from "./request";
import { createAiSearchEventStream } from "./sse";

function jsonError(
	code: AiSearchErrorBody["code"],
	message: string,
	status: number,
	headers?: Headers,
): Response {
	return Response.json({ error: message, code } satisfies AiSearchErrorBody, {
		status,
		headers,
	});
}

function assertEmbedding(vector: number[]): void {
	if (
		vector.length !== aiSearchConfig.provider.embeddingDimensions ||
		!vector.every(Number.isFinite)
	) {
		throw new AiSearchError(
			502,
			"AI_UPSTREAM_FAILED",
			"Embedding service returned an invalid vector",
		);
	}
}

function buildRetrievalContext(matches: RetrievedContent[]): RetrievalContext {
	const content = matches.filter(
		(match) =>
			match.score >= aiSearchConfig.retrieval.minScore &&
			Boolean(match.title && match.path && match.heading && match.excerpt),
	);
	const seenPaths = new Set<string>();
	const articles: AiSearchArticleReference[] = [];
	for (const match of content) {
		if (seenPaths.has(match.path)) continue;
		seenPaths.add(match.path);
		articles.push({
			title: match.title,
			path: match.path,
			published: match.published,
			excerpt: match.excerpt,
			score: match.score,
		});
	}
	return { articles, content };
}

export async function handleAiSearch(
	request: Request,
	runtime: AiSearchRuntime,
): Promise<Response> {
	const headers = createCorsHeaders(request, runtime.allowedOrigins);
	if (!headers) {
		return jsonError("ORIGIN_NOT_ALLOWED", "Origin not allowed", 403);
	}
	if (request.method === "OPTIONS") return new Response(null, { headers });
	if (request.method !== "POST") {
		return jsonError("METHOD_NOT_ALLOWED", "Method not allowed", 405, headers);
	}

	try {
		assertJsonRequest(request);
		const payload = parseAiSearchRequest(await readBoundedJson(request));
		const rateLimit = await runtime.rateLimiter.check(request);
		if (!rateLimit.allowed) {
			headers.set("Retry-After", String(rateLimit.retryAfter));
			return jsonError(
				"RATE_LIMITED",
				"Too many requests, please try again later",
				429,
				headers,
			);
		}

		const vector = await runtime.embeddingProvider.embed(
			payload.question,
			request.signal,
		);
		assertEmbedding(vector);
		const retrieval = buildRetrievalContext(
			await runtime.retriever.search(vector, request.signal),
		);
		const messages = buildAiSearchMessages(
			payload.question,
			payload.history,
			retrieval.content,
		);
		const source = await runtime.chatProvider.stream(messages, request.signal);
		const body = createAiSearchEventStream(
			source,
			retrieval.articles,
			runtime.chatProvider.name,
			runtime.logger,
		);

		headers.set("Content-Type", "text/event-stream; charset=utf-8");
		headers.set("Cache-Control", "no-cache, no-transform");
		headers.set("X-Accel-Buffering", "no");
		return new Response(body, { headers });
	} catch (error) {
		if (error instanceof AiSearchError) {
			return jsonError(error.code, error.message, error.status, headers);
		}
		runtime.logger.error("ai_chat_error", error);
		return jsonError("INTERNAL_ERROR", "Internal server error", 500, headers);
	}
}
