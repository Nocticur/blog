import type { AiSearchErrorCode } from "@/types/ai-search";

export class AiSearchError extends Error {
	readonly status: number;
	readonly code: AiSearchErrorCode;

	constructor(status: number, code: AiSearchErrorCode, message: string) {
		super(message);
		this.name = "AiSearchError";
		this.status = status;
		this.code = code;
	}
}

export class AiUpstreamError extends AiSearchError {
	constructor(message: string) {
		super(502, "AI_UPSTREAM_FAILED", message);
		this.name = "AiUpstreamError";
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}
