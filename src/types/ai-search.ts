export type AiSearchChatRole = "system" | "user" | "assistant";

export interface AiSearchChatMessage {
	role: AiSearchChatRole;
	content: string;
}

export interface AiSearchRequest {
	question: string;
	history?: AiSearchChatMessage[];
	sessionId?: string;
}

export interface AiSearchArticleReference {
	title: string;
	path: string;
	published: string;
	excerpt: string;
	score: number;
}

export type AiSearchEvent =
	| { type: "refs"; articles: AiSearchArticleReference[] }
	| { type: "chunk"; text: string }
	| { type: "done" }
	| { type: "error"; code: "AI_STREAM_FAILED"; error: string };

export type AiSearchErrorCode =
	| "AI_STREAM_FAILED"
	| "AI_UPSTREAM_FAILED"
	| "INTERNAL_ERROR"
	| "INVALID_JSON"
	| "INVALID_REQUEST"
	| "METHOD_NOT_ALLOWED"
	| "ORIGIN_NOT_ALLOWED"
	| "PAYLOAD_TOO_LARGE"
	| "RATE_LIMITED"
	| "UNSUPPORTED_MEDIA_TYPE";

export interface AiSearchErrorBody {
	error: string;
	code: AiSearchErrorCode;
}
