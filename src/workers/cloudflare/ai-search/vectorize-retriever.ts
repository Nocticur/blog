import { aiSearchConfig } from "@/config/aiSearchConfig";
import type { RetrievedContent, Retriever } from "@/server/ai-search/contracts";

function getMetadataString(
	metadata: Record<string, VectorizeVectorMetadata> | undefined,
	key: string,
): string {
	const value = metadata?.[key];
	return typeof value === "string" ? value : "";
}

export class VectorizeRetriever implements Retriever {
	constructor(private readonly index: VectorizeIndex) {}

	async search(
		vector: number[],
		signal: AbortSignal,
	): Promise<RetrievedContent[]> {
		signal.throwIfAborted();
		const results = await this.index.query(vector, {
			topK: aiSearchConfig.retrieval.topK,
			returnMetadata: "all",
			returnValues: false,
		});
		signal.throwIfAborted();
		return results.matches.map((match) => ({
			score: match.score,
			title: getMetadataString(match.metadata, "articleTitle"),
			path: getMetadataString(match.metadata, "articlePath"),
			published: getMetadataString(match.metadata, "published"),
			heading: getMetadataString(match.metadata, "heading"),
			excerpt: getMetadataString(match.metadata, "excerpt"),
		}));
	}
}
