import type { AiSearchChatMessage } from "@/types/ai-search";
import type { ChatProvider, EmbeddingProvider } from "../contracts";
import { AiUpstreamError } from "../errors";
import { readResponseSnippet } from "../request";
import { readOpenAiTextStream } from "./openai-stream";

interface OpenAiCompatibleOptions {
	apiUrl: string;
	apiKey: string;
	chatModel: string;
	embeddingModel: string;
	embeddingDimensions: number;
	logUpstreamError(
		event: string,
		status: number,
		responseSnippet: string,
	): void;
}

function buildApiUrl(
	base: string,
	resource: "chat/completions" | "embeddings",
) {
	const url = new URL(base);
	url.pathname = url.pathname
		.replace(/\/+$/, "")
		.replace(/\/(?:chat\/completions|embeddings)$/, "")
		.replace(/\/v1$/, "");
	url.pathname = `${url.pathname}/v1/${resource}`.replace(/\/{2,}/g, "/");
	url.search = "";
	url.hash = "";
	return url.toString();
}

function getEmbedding(payload: unknown): number[] | null {
	if (!payload || typeof payload !== "object") return null;
	const data = Reflect.get(payload, "data");
	if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
		return null;
	}
	const embedding = Reflect.get(data[0], "embedding");
	if (!Array.isArray(embedding)) return null;
	return embedding.every((value) => typeof value === "number")
		? embedding
		: null;
}

export class OpenAiCompatibleProvider
	implements EmbeddingProvider, ChatProvider
{
	readonly name = "openai-compatible";

	constructor(private readonly options: OpenAiCompatibleOptions) {}

	async embed(text: string, signal: AbortSignal): Promise<number[]> {
		const response = await fetch(
			buildApiUrl(this.options.apiUrl, "embeddings"),
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.options.embeddingModel,
					input: text,
					dimensions: this.options.embeddingDimensions,
					encoding_format: "float",
				}),
				signal,
			},
		);
		if (!response.ok) {
			const snippet = await readResponseSnippet(response);
			this.options.logUpstreamError(
				"ai_embedding_upstream_error",
				response.status,
				snippet,
			);
			throw new AiUpstreamError("Embedding service failed");
		}

		const embedding = getEmbedding(await response.json());
		if (!embedding) {
			throw new AiUpstreamError("Embedding service returned invalid data");
		}
		return embedding;
	}

	async stream(
		messages: AiSearchChatMessage[],
		signal: AbortSignal,
	): Promise<AsyncIterable<string>> {
		const response = await fetch(
			buildApiUrl(this.options.apiUrl, "chat/completions"),
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.options.chatModel,
					messages,
					stream: true,
				}),
				signal,
			},
		);
		if (!response.ok) {
			const snippet = await readResponseSnippet(response);
			this.options.logUpstreamError(
				"ai_chat_upstream_error",
				response.status,
				snippet,
			);
			throw new AiUpstreamError("Chat service failed");
		}
		if (!response.body) {
			throw new AiUpstreamError("Chat service returned no stream");
		}
		return readOpenAiTextStream(response.body);
	}
}
