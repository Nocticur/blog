export const aiSearchConfig = {
	provider: {
		apiUrl: "https://api-inference.modelscope.cn/v1",
		chatModel: "deepseek-ai/DeepSeek-V4-Flash",
		embeddingModel: "Qwen/Qwen3-Embedding-8B",
		embeddingDimensions: 1024,
		workersAiChatModel: "@cf/meta/llama-3-8b-instruct",
		workersAiEmbeddingModel: "@cf/baai/bge-large-en-v1.5",
	},
	request: {
		maxBodyBytes: 16 * 1024,
		maxQuestionCharacters: 1000,
		maxHistoryEntries: 20,
		maxHistoryCharacters: 2000,
		historyWindow: 6,
	},
	retrieval: {
		topK: 10,
		minScore: 0.2,
	},
	rateLimit: {
		maxRequests: 10,
		windowSeconds: 60,
	},
	index: {
		name: "blog-ai-search",
		manifestSchemaVersion: 2,
		batchSize: 500,
		embeddingBatchSize: 50,
		minimumChunkCharacters: 50,
		maximumExcerptCharacters: 500,
	},
} as const;

export const aiSearchPublicConfig = {
	modelName: aiSearchConfig.provider.chatModel,
} as const;
