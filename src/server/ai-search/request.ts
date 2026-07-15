import { aiSearchConfig } from "@/config/aiSearchConfig";
import type { AiSearchChatMessage, AiSearchRequest } from "@/types/ai-search";
import { AiSearchError } from "./errors";

const JSON_CONTENT_TYPE = /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i;

export function createCorsHeaders(
	request: Request,
	configuredOrigins: readonly string[],
): Headers | null {
	const headers = new Headers({
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	});
	const origin = request.headers.get("Origin");
	if (!origin) return headers;

	const allowedOrigins = new Set([
		new URL(request.url).origin,
		...configuredOrigins.map((item) => item.trim()).filter(Boolean),
	]);
	if (!allowedOrigins.has(origin)) return null;

	headers.set("Access-Control-Allow-Origin", origin);
	headers.set("Vary", "Origin");
	return headers;
}

export function assertJsonRequest(request: Request): void {
	const contentType = request.headers.get("Content-Type") ?? "";
	if (!JSON_CONTENT_TYPE.test(contentType)) {
		throw new AiSearchError(
			415,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
		);
	}
}

export async function readBoundedJson(request: Request): Promise<unknown> {
	const maxBytes = aiSearchConfig.request.maxBodyBytes;
	const contentLength = request.headers.get("Content-Length");
	if (contentLength) {
		const declaredLength = Number(contentLength);
		if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
			throw new AiSearchError(
				413,
				"PAYLOAD_TOO_LARGE",
				"Request body is too large",
			);
		}
	}

	if (!request.body) {
		throw new AiSearchError(400, "INVALID_REQUEST", "Request body is required");
	}

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = "";
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				break;
			}
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader
					.cancel("Request body exceeded limit")
					.catch(() => undefined);
				throw new AiSearchError(
					413,
					"PAYLOAD_TOO_LARGE",
					"Request body is too large",
				);
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		if (!completed) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}

	try {
		return JSON.parse(text);
	} catch {
		throw new AiSearchError(
			400,
			"INVALID_JSON",
			"Request body is not valid JSON",
		);
	}
}

export function parseAiSearchRequest(
	payload: unknown,
): Required<Pick<AiSearchRequest, "question" | "history">> {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AiSearchError(
			400,
			"INVALID_REQUEST",
			"Request body must be an object",
		);
	}

	const rawQuestion = Reflect.get(payload, "question");
	if (typeof rawQuestion !== "string" || !rawQuestion.trim()) {
		throw new AiSearchError(400, "INVALID_REQUEST", "question is required");
	}
	const question = rawQuestion.trim();
	if (question.length > aiSearchConfig.request.maxQuestionCharacters) {
		throw new AiSearchError(400, "INVALID_REQUEST", "question is too long");
	}

	const rawHistory = Reflect.get(payload, "history");
	if (rawHistory !== undefined && !Array.isArray(rawHistory)) {
		throw new AiSearchError(400, "INVALID_REQUEST", "history must be an array");
	}
	if (
		Array.isArray(rawHistory) &&
		rawHistory.length > aiSearchConfig.request.maxHistoryEntries
	) {
		throw new AiSearchError(
			400,
			"INVALID_REQUEST",
			"history has too many entries",
		);
	}

	const history: AiSearchChatMessage[] = [];
	for (const entry of rawHistory ?? []) {
		if (!entry || typeof entry !== "object") {
			throw new AiSearchError(
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
			content.length > aiSearchConfig.request.maxHistoryCharacters
		) {
			throw new AiSearchError(
				400,
				"INVALID_REQUEST",
				"history entry is invalid",
			);
		}
		history.push({ role, content });
	}

	return {
		question,
		history: history.slice(-aiSearchConfig.request.historyWindow),
	};
}

export async function readResponseSnippet(
	response: Response,
	maxBytes = 2048,
): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = "";
	let completed = false;
	try {
		while (totalBytes < maxBytes) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				break;
			}
			const remaining = maxBytes - totalBytes;
			const chunk =
				value.byteLength > remaining ? value.subarray(0, remaining) : value;
			totalBytes += chunk.byteLength;
			text += decoder.decode(chunk, { stream: true });
			if (chunk.byteLength < value.byteLength) break;
		}
		text += decoder.decode();
	} finally {
		if (!completed) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	return text;
}
