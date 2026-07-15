import { aiSearchConfig } from "@/config/aiSearchConfig";
import type {
	ChatProvider,
	EmbeddingProvider,
} from "@/server/ai-search/contracts";
import { AiUpstreamError } from "@/server/ai-search/errors";
import type { AiSearchChatMessage } from "@/types/ai-search";
import { readWorkersAiTextStream } from "./workers-ai-stream";

export class WorkersAiProvider implements EmbeddingProvider, ChatProvider {
	readonly name = "workers-ai";

	constructor(private readonly ai: Ai) {}

	async embed(text: string, signal: AbortSignal): Promise<number[]> {
		try {
			const result = await this.ai.run(
				aiSearchConfig.provider.workersAiEmbeddingModel,
				{ text },
				{ signal },
			);
			if (!("data" in result) || !Array.isArray(result.data?.[0])) {
				throw new AiUpstreamError("Workers AI returned an invalid embedding");
			}
			return result.data[0];
		} catch (error) {
			if (error instanceof AiUpstreamError) throw error;
			throw new AiUpstreamError("Embedding service failed");
		}
	}

	async stream(
		messages: AiSearchChatMessage[],
		signal: AbortSignal,
	): Promise<AsyncIterable<string>> {
		try {
			const stream = await this.ai.run(
				aiSearchConfig.provider.workersAiChatModel,
				{ messages, stream: true },
				{ signal },
			);
			return readWorkersAiTextStream(stream);
		} catch {
			throw new AiUpstreamError("Chat service failed");
		}
	}
}
