import type {
	AiSearchArticleReference,
	AiSearchChatMessage,
} from "@/types/ai-search";

export interface EmbeddingProvider {
	readonly name: string;
	embed(text: string, signal: AbortSignal): Promise<number[]>;
}

export interface ChatProvider {
	readonly name: string;
	stream(
		messages: AiSearchChatMessage[],
		signal: AbortSignal,
	): Promise<AsyncIterable<string>>;
}

export interface RetrievedContent {
	score: number;
	title: string;
	path: string;
	published: string;
	heading: string;
	excerpt: string;
}

export interface Retriever {
	search(vector: number[], signal: AbortSignal): Promise<RetrievedContent[]>;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfter: number;
}

export interface RateLimiter {
	check(request: Request): Promise<RateLimitResult>;
}

export interface AiSearchLogger {
	error(event: string, error: unknown, fields?: Record<string, unknown>): void;
}

export interface AiSearchRuntime {
	allowedOrigins: readonly string[];
	embeddingProvider: EmbeddingProvider;
	chatProvider: ChatProvider;
	retriever: Retriever;
	rateLimiter: RateLimiter;
	logger: AiSearchLogger;
}

export interface RetrievalContext {
	articles: AiSearchArticleReference[];
	content: RetrievedContent[];
}
