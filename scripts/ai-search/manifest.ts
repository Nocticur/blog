import fs from "node:fs";
import path from "node:path";
import { aiSearchConfig } from "../../src/config/aiSearchConfig";

export interface ManifestPost {
	hash: string;
	chunkIds: string[];
}

export interface IndexManifest {
	schemaVersion: number;
	providerFingerprint: string;
	generatedAt: string;
	posts: Record<string, ManifestPost>;
}

function isManifestPost(value: unknown): value is ManifestPost {
	if (!value || typeof value !== "object") return false;
	return (
		typeof Reflect.get(value, "hash") === "string" &&
		Array.isArray(Reflect.get(value, "chunkIds")) &&
		Reflect.get(value, "chunkIds").every(
			(item: unknown) => typeof item === "string",
		)
	);
}

function parsePosts(value: unknown): Record<string, ManifestPost> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, ManifestPost] =>
			isManifestPost(entry[1]),
		),
	);
}

export function loadManifest(filePath: string): IndexManifest {
	if (!fs.existsSync(filePath)) {
		return {
			schemaVersion: 0,
			providerFingerprint: "",
			generatedAt: "",
			posts: {},
		};
	}

	const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("向量索引 Manifest 格式无效");
	}
	if (Reflect.get(parsed, "schemaVersion") === aiSearchConfig.index.manifestSchemaVersion) {
		return {
			schemaVersion: aiSearchConfig.index.manifestSchemaVersion,
			providerFingerprint: String(
				Reflect.get(parsed, "providerFingerprint") ?? "",
			),
			generatedAt: String(Reflect.get(parsed, "generatedAt") ?? ""),
			posts: parsePosts(Reflect.get(parsed, "posts")),
		};
	}

	// Legacy manifests stored posts directly at the root.
	return {
		schemaVersion: 0,
		providerFingerprint: "",
		generatedAt: "",
		posts: parsePosts(parsed),
	};
}

export function saveManifest(filePath: string, manifest: IndexManifest): void {
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
		fs.renameSync(tempPath, filePath);
	} finally {
		if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
	}
}

export function getManifestPath(cwd = process.cwd()): string {
	return path.resolve(cwd, ".vectorize-manifest.json");
}
