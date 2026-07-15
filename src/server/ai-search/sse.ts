import type {
	AiSearchArticleReference,
	AiSearchEvent,
} from "@/types/ai-search";
import type { AiSearchLogger } from "./contracts";
import { isAbortError } from "./errors";

function encodeEvent(event: AiSearchEvent): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function createAiSearchEventStream(
	source: AsyncIterable<string>,
	articles: AiSearchArticleReference[],
	provider: string,
	logger: AiSearchLogger,
): ReadableStream<Uint8Array> {
	let iterator: AsyncIterator<string> | null = null;
	let cancelled = false;

	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				if (articles.length > 0) {
					controller.enqueue(encodeEvent({ type: "refs", articles }));
				}

				iterator = source[Symbol.asyncIterator]();
				while (!cancelled) {
					const result = await iterator.next();
					if (result.done) break;
					controller.enqueue(
						encodeEvent({ type: "chunk", text: result.value }),
					);
				}
				if (!cancelled) controller.enqueue(encodeEvent({ type: "done" }));
			} catch (error) {
				if (!cancelled && !isAbortError(error)) {
					logger.error("ai_stream_error", error, { provider });
					controller.enqueue(
						encodeEvent({
							type: "error",
							code: "AI_STREAM_FAILED",
							error: "AI response stream was interrupted",
						}),
					);
				}
			} finally {
				if (!cancelled) controller.close();
			}
		},
		async cancel() {
			cancelled = true;
			await iterator?.return?.();
		},
	});
}
