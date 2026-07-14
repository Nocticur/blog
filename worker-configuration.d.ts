/// <reference types="@cloudflare/workers-types" />
import type { RateLimiter } from "./src/workers/rate-limiter";

declare global {
	interface Env {
		AI: Ai;
		AI_RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
		ASSETS: Fetcher;
		VECTORIZE: VectorizeIndex;
		VISITOR_KV: KVNamespace;
		AI_API_KEY?: string;
		ALLOWED_ORIGINS?: string;
		NODE_VERSION?: string;
		PUBLIC_SITE_URL?: string;
	}
}

export {};
