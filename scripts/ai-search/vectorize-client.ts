import { aiSearchConfig } from "../../src/config/aiSearchConfig";
import type { SearchChunk } from "./content";

interface CloudflareCredentials {
	accountId: string;
	apiToken: string;
}

interface EmbeddingClientOptions extends CloudflareCredentials {
	thirdPartyApiKey?: string;
}

export interface VectorRecord {
	id: string;
	values: number[];
	metadata: SearchChunk["metadata"];
}

async function errorSnippet(response: Response): Promise<string> {
	return (await response.text()).slice(0, 2048);
}

function buildOpenAiUrl(base: string): string {
	const url = new URL(base);
	url.pathname = url.pathname
		.replace(/\/+$/, "")
		.replace(/\/(?:chat\/completions|embeddings)$/, "")
		.replace(/\/v1$/, "");
	url.pathname = `${url.pathname}/v1/embeddings`.replace(/\/{2,}/g, "/");
	url.search = "";
	url.hash = "";
	return url.toString();
}

function parseEmbeddingPayload(payload: unknown): number[][] | null {
	if (!payload || typeof payload !== "object") return null;
	const data = Reflect.get(payload, "data");
	if (!Array.isArray(data)) return null;
	const embeddings = data.map((entry) =>
		entry && typeof entry === "object" ? Reflect.get(entry, "embedding") : null,
	);
	return embeddings.every(
		(vector): vector is number[] =>
			Array.isArray(vector) && vector.every((value) => typeof value === "number"),
	)
		? embeddings
		: null;
}

function parseWorkersAiEmbeddings(payload: unknown): number[][] | null {
	if (!payload || typeof payload !== "object") return null;
	const result = Reflect.get(payload, "result");
	if (!result || typeof result !== "object") return null;
	const data = Reflect.get(result, "data");
	return Array.isArray(data) &&
		data.every(
			(vector) =>
				Array.isArray(vector) &&
				vector.every((value) => typeof value === "number"),
		)
		? data
		: null;
}

export class EmbeddingClient {
	private readonly apiBase: string;

	constructor(private readonly options: EmbeddingClientOptions) {
		this.apiBase = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}`;
	}

	async generate(texts: string[]): Promise<number[][]> {
		const response = this.options.thirdPartyApiKey
			? await fetch(buildOpenAiUrl(aiSearchConfig.provider.apiUrl), {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.options.thirdPartyApiKey}`,
						"Content-Type": "application/json; charset=utf-8",
					},
					body: JSON.stringify({
						model: aiSearchConfig.provider.embeddingModel,
						input: texts,
						dimensions: aiSearchConfig.provider.embeddingDimensions,
						encoding_format: "float",
					}),
				})
			: await fetch(
					`${this.apiBase}/ai/run/${aiSearchConfig.provider.workersAiEmbeddingModel}`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${this.options.apiToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ text: texts }),
					},
				);
		if (!response.ok) {
			throw new Error(`Embedding API ${response.status}: ${await errorSnippet(response)}`);
		}

		const payload: unknown = await response.json();
		const embeddings = this.options.thirdPartyApiKey
			? parseEmbeddingPayload(payload)
			: parseWorkersAiEmbeddings(payload);
		if (!embeddings) throw new Error("Embedding API 返回格式无效");
		return embeddings;
	}
}

export class VectorizeClient {
	private readonly indexUrl: string;

	constructor(private readonly credentials: CloudflareCredentials) {
		this.indexUrl = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/vectorize/v2/indexes/${aiSearchConfig.index.name}`;
	}

	private headers(contentType?: string): HeadersInit {
		return {
			Authorization: `Bearer ${this.credentials.apiToken}`,
			...(contentType ? { "Content-Type": contentType } : {}),
		};
	}

	async ensureIndex(): Promise<void> {
		const response = await fetch(this.indexUrl, { headers: this.headers() });
		if (response.status === 404) {
			const createResponse = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${this.credentials.accountId}/vectorize/v2/indexes`,
				{
					method: "POST",
					headers: this.headers("application/json"),
					body: JSON.stringify({
						name: aiSearchConfig.index.name,
						config: {
							dimensions: aiSearchConfig.provider.embeddingDimensions,
							metric: "cosine",
						},
					}),
				},
			);
			if (!createResponse.ok) {
				throw new Error(
					`创建 Vectorize 索引失败 ${createResponse.status}: ${await errorSnippet(createResponse)}`,
				);
			}
			return;
		}
		if (!response.ok) {
			throw new Error(
				`读取 Vectorize 索引失败 ${response.status}: ${await errorSnippet(response)}`,
			);
		}

		const payload: unknown = await response.json();
		const result =
			payload && typeof payload === "object" ? Reflect.get(payload, "result") : null;
		const config =
			result && typeof result === "object" ? Reflect.get(result, "config") : null;
		const dimensions =
			config && typeof config === "object"
				? Reflect.get(config, "dimensions")
				: null;
		if (dimensions !== aiSearchConfig.provider.embeddingDimensions) {
			throw new Error(
				`Vectorize 维度不匹配：索引 ${String(dimensions)}，配置 ${aiSearchConfig.provider.embeddingDimensions}`,
			);
		}
	}

	async upsert(vectors: VectorRecord[]): Promise<void> {
		const body = `${vectors.map((vector) => JSON.stringify(vector)).join("\n")}\n`;
		const response = await fetch(`${this.indexUrl}/upsert`, {
			method: "POST",
			headers: this.headers("application/x-ndjson"),
			body,
		});
		if (!response.ok) {
			throw new Error(
				`Vectorize upsert ${response.status}: ${await errorSnippet(response)}`,
			);
		}
	}

	async deleteByIds(ids: string[]): Promise<void> {
		for (let index = 0; index < ids.length; index += 100) {
			const response = await fetch(`${this.indexUrl}/delete_by_ids`, {
				method: "POST",
				headers: this.headers("application/json"),
				body: JSON.stringify({ ids: ids.slice(index, index + 100) }),
			});
			if (!response.ok) {
				throw new Error(
					`Vectorize delete ${response.status}: ${await errorSnippet(response)}`,
				);
			}
		}
	}
}
