#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { aiSearchConfig } from "../../src/config/aiSearchConfig";
import {
	buildChunksForPost,
	loadPosts,
	type BlogPost,
	type SearchChunk,
} from "./content";
import {
	getManifestPath,
	loadManifest,
	saveManifest,
	type IndexManifest,
} from "./manifest";
import {
	EmbeddingClient,
	VectorizeClient,
	type VectorRecord,
} from "./vectorize-client";

interface SyncPlan {
	fullSync: boolean;
	postsToUpload: BlogPost[];
	staleIds: string[];
	nextManifest: IndexManifest;
}

function loadEnvironment(cwd = process.cwd()): void {
	for (const filename of [".env.cf", ".env"]) {
		const filePath = path.resolve(cwd, filename);
		if (fs.existsSync(filePath)) process.loadEnvFile(filePath);
	}
}

function getProviderFingerprint(useThirdParty: boolean): string {
	const descriptor = useThirdParty
		? {
				provider: "openai-compatible",
				apiUrl: aiSearchConfig.provider.apiUrl,
				model: aiSearchConfig.provider.embeddingModel,
			}
		: {
				provider: "workers-ai",
				model: aiSearchConfig.provider.workersAiEmbeddingModel,
			};
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				...descriptor,
				dimensions: aiSearchConfig.provider.embeddingDimensions,
				manifestSchemaVersion: aiSearchConfig.index.manifestSchemaVersion,
				minimumChunkCharacters:
					aiSearchConfig.index.minimumChunkCharacters,
				maximumExcerptCharacters:
					aiSearchConfig.index.maximumExcerptCharacters,
			}),
		)
		.digest("hex");
}

function createSyncPlan(
	posts: BlogPost[],
	chunksBySlug: Map<string, SearchChunk[]>,
	manifest: IndexManifest,
	providerFingerprint: string,
	force: boolean,
): SyncPlan {
	const fullSync =
		force ||
		manifest.schemaVersion !== aiSearchConfig.index.manifestSchemaVersion ||
		manifest.providerFingerprint !== providerFingerprint;
	const postsToUpload = fullSync
		? posts
		: posts.filter((post) => manifest.posts[post.slug]?.hash !== post.hash);
	const currentIds = new Set(
		[...chunksBySlug.values()].flatMap((chunks) =>
			chunks.map((chunk) => chunk.id),
		),
	);
	const staleIds = Object.values(manifest.posts)
		.flatMap((post) => post.chunkIds)
		.filter((id) => !currentIds.has(id));
	const nextManifest: IndexManifest = {
		schemaVersion: aiSearchConfig.index.manifestSchemaVersion,
		providerFingerprint,
		generatedAt: new Date().toISOString(),
		posts: Object.fromEntries(
			posts.map((post) => [
				post.slug,
				{
					hash: post.hash,
					chunkIds: (chunksBySlug.get(post.slug) ?? []).map(
						(chunk) => chunk.id,
					),
				},
			]),
		),
	};
	return { fullSync, postsToUpload, staleIds, nextManifest };
}

function validateEmbeddings(embeddings: number[][], expectedCount: number): void {
	if (embeddings.length !== expectedCount) {
		throw new Error(
			`嵌入数量不匹配：预期 ${expectedCount}，实际 ${embeddings.length}`,
		);
	}
	for (const vector of embeddings) {
		if (
			vector.length !== aiSearchConfig.provider.embeddingDimensions ||
			!vector.every(Number.isFinite)
		) {
			throw new Error("Embedding 向量维度或数值无效");
		}
	}
}

async function buildVectors(
	chunks: SearchChunk[],
	embeddingClient: EmbeddingClient,
): Promise<VectorRecord[]> {
	const vectors: VectorRecord[] = [];
	for (
		let index = 0;
		index < chunks.length;
		index += aiSearchConfig.index.embeddingBatchSize
	) {
		const batch = chunks.slice(
			index,
			index + aiSearchConfig.index.embeddingBatchSize,
		);
		console.log(
			`生成嵌入 ${index + 1}-${Math.min(index + batch.length, chunks.length)}/${chunks.length}`,
		);
		const embeddings = await embeddingClient.generate(
			batch.map((chunk) => chunk.text),
		);
		validateEmbeddings(embeddings, batch.length);
		vectors.push(
			...batch.map((chunk, batchIndex) => ({
				id: chunk.id,
				values: embeddings[batchIndex],
				metadata: chunk.metadata,
			})),
		);
	}
	return vectors;
}

function printPlan(plan: SyncPlan, totalChunks: number): void {
	console.log(`同步模式：${plan.fullSync ? "全量" : "增量"}`);
	console.log(`文章总数：${Object.keys(plan.nextManifest.posts).length}`);
	console.log(`分块总数：${totalChunks}`);
	console.log(`待上传文章：${plan.postsToUpload.length}`);
	console.log(`待删除旧向量：${plan.staleIds.length}`);
}

async function main(): Promise<void> {
	loadEnvironment();
	const dryRun = process.argv.includes("--dry-run");
	const force = process.argv.includes("--force");
	const useThirdParty = Boolean(process.env.AI_API_KEY);
	const providerFingerprint = getProviderFingerprint(useThirdParty);
	const posts = await loadPosts();
	if (posts.length === 0) {
		console.log("没有可索引的文章");
		return;
	}

	const chunksBySlug = new Map(
		posts.map((post) => [post.slug, buildChunksForPost(post)]),
	);
	const allChunks = [...chunksBySlug.values()].flat();
	const manifestPath = getManifestPath();
	const manifest = loadManifest(manifestPath);
	const plan = createSyncPlan(
		posts,
		chunksBySlug,
		manifest,
		providerFingerprint,
		force,
	);
	printPlan(plan, allChunks.length);
	if (dryRun) {
		console.log("dry-run 完成，未调用远程接口");
		return;
	}
	if (plan.postsToUpload.length === 0 && plan.staleIds.length === 0) {
		console.log("索引没有变化");
		return;
	}

	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!apiToken || !accountId) {
		throw new Error(
			"缺少 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID，请配置 .env.cf",
		);
	}

	const vectorizeClient = new VectorizeClient({ accountId, apiToken });
	await vectorizeClient.ensureIndex();
	const chunksToUpload = plan.postsToUpload.flatMap(
		(post) => chunksBySlug.get(post.slug) ?? [],
	);
	if (chunksToUpload.length > 0) {
		const embeddingClient = new EmbeddingClient({
			accountId,
			apiToken,
			thirdPartyApiKey: process.env.AI_API_KEY,
		});
		const vectors = await buildVectors(chunksToUpload, embeddingClient);
		for (
			let index = 0;
			index < vectors.length;
			index += aiSearchConfig.index.batchSize
		) {
			const batch = vectors.slice(index, index + aiSearchConfig.index.batchSize);
			await vectorizeClient.upsert(batch);
			console.log(
				`上传向量 ${index + batch.length}/${vectors.length}`,
			);
		}
	}

	if (plan.staleIds.length > 0) {
		await vectorizeClient.deleteByIds(plan.staleIds);
		console.log(`删除旧向量 ${plan.staleIds.length} 个`);
	}
	saveManifest(manifestPath, plan.nextManifest);
	console.log("Vectorize 索引同步完成");
}

main().catch((error: unknown) => {
	console.error("构建失败:", error);
	process.exitCode = 1;
});
