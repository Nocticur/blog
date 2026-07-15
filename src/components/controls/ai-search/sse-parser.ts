import type {
	AiSearchArticleReference,
	AiSearchEvent,
} from "@/types/ai-search";

function isArticleReference(value: unknown): value is AiSearchArticleReference {
	if (!value || typeof value !== "object") return false;
	return (
		typeof Reflect.get(value, "title") === "string" &&
		typeof Reflect.get(value, "path") === "string" &&
		typeof Reflect.get(value, "published") === "string" &&
		typeof Reflect.get(value, "excerpt") === "string" &&
		typeof Reflect.get(value, "score") === "number"
	);
}

function parseEvent(line: string): AiSearchEvent | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) return null;

	let payload: unknown;
	try {
		payload = JSON.parse(trimmed.slice(5).trimStart());
	} catch {
		return null;
	}
	if (!payload || typeof payload !== "object") return null;

	const type = Reflect.get(payload, "type");
	if (type === "chunk") {
		const text = Reflect.get(payload, "text");
		return typeof text === "string" ? { type, text } : null;
	}
	if (type === "refs") {
		const articles = Reflect.get(payload, "articles");
		return Array.isArray(articles) && articles.every(isArticleReference)
			? { type, articles }
			: null;
	}
	if (type === "done") return { type };
	if (type === "error") {
		const code = Reflect.get(payload, "code");
		const error = Reflect.get(payload, "error");
		return code === "AI_STREAM_FAILED" && typeof error === "string"
			? { type, code, error }
			: null;
	}
	return null;
}

export async function* parseAiSearchEventStream(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AiSearchEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				buffer += decoder.decode();
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const event = parseEvent(line);
				if (event) yield event;
			}
		}

		if (buffer) {
			const event = parseEvent(buffer);
			if (event) yield event;
		}
	} finally {
		if (!completed) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
