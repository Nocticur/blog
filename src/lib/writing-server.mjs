/**
 * 写作空间服务端共享模块 —— 同时被两端引用：
 * - astro.config.mjs 的 writing-dev-api 插件（本地 `astro dev` middleware）
 * - api/writing/[[...path]].js（Vercel Serverless Function，线上站点）
 *
 * 用 plain ESM（.mjs）而非 TS，是因为 tsconfig 关闭了 allowJs，TS 侧不需要引它，
 * 而 Vercel 的 @vercel/node 与 Astro 的配置加载器都能直接处理 .mjs。
 *
 * 所有密钥一律从环境变量读取（系统变量 / Vercel Environment Variables，
 * .env 文件仅作本地备选），绝不进前端或打包产物。
 */
import { execSync } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import matter from "gray-matter";

// 内置默认密码（firefly）的 SHA-256，仅兜底用；与 src/config 侧历史值保持一致
export const DEFAULT_PASSWORD_HASH =
	"afac327e73694e68c02f5c62f3bc0bcf0f239744ff12921e781487a0f9b3d5d0";

export const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
// 文件名/slug 段校验（与 scripts/new-post.js 一致）：允许中英文、数字、._-，不允许路径符号
export const VALID_SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
export const GITHUB_API = "https://api.github.com";
export const GITHUB_TIMEOUT_MS = 30 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

/** 服务端密码哈希解析：WRITING_PASSWORD（明文现算）→ WRITING_PASSWORD_HASH → 内置默认 */
export function resolvePasswordHash(env = process.env) {
	if (env.WRITING_PASSWORD) return sha256Hex(env.WRITING_PASSWORD);
	if (env.WRITING_PASSWORD_HASH) return env.WRITING_PASSWORD_HASH;
	return DEFAULT_PASSWORD_HASH;
}

/** 登录校验：明文密码与服务端哈希比对（哈希不再下发前端） */
export function verifyPassword(password, env = process.env) {
	const plain = String(password ?? "");
	if (!plain) return false;
	return sha256Hex(plain) === resolvePasswordHash(env);
}

/** 会话签名密钥：优先 WRITING_SESSION_SECRET，缺省从密码哈希派生（改密码即全体会话失效） */
export function resolveSessionSecret(env = process.env) {
	return (
		env.WRITING_SESSION_SECRET ||
		`firefly-writing-session:${resolvePasswordHash(env)}`
	);
}

/** 签发会话 token：base64url(payload).base64url(HMAC-SHA256)，payload 仅含过期时间 */
export function signSession(env = process.env, ttlMs = SESSION_TTL_MS) {
	const payload = Buffer.from(
		JSON.stringify({ exp: Date.now() + ttlMs }),
	).toString("base64url");
	const sig = createHmac("sha256", resolveSessionSecret(env))
		.update(payload)
		.digest("base64url");
	return `${payload}.${sig}`;
}

/** 校验会话 token：签名（恒时比较）+ 有效期 */
export function verifySession(token, env = process.env) {
	if (typeof token !== "string") return false;
	const [payload, sig] = token.split(".");
	if (!payload || !sig) return false;
	const expected = createHmac("sha256", resolveSessionSecret(env))
		.update(payload)
		.digest();
	let given;
	try {
		given = Buffer.from(sig, "base64url");
	} catch {
		return false;
	}
	if (given.length !== expected.length || !timingSafeEqual(given, expected))
		return false;
	try {
		const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		return Number.isFinite(data.exp) && data.exp > Date.now();
	} catch {
		return false;
	}
}

// 从 git remote origin 自动推导 GitHub 仓库（owner/repo），失败或非 GitHub 时为空。
// 结果按进程缓存，避免每次调用都 fork git
let gitRemoteRepo;
export function repoFromGitRemote() {
	if (gitRemoteRepo !== undefined) return gitRemoteRepo;
	gitRemoteRepo = "";
	try {
		const url = execSync("git remote get-url origin", {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		// 兼容 https://github.com/owner/repo(.git) 与 git@github.com:owner/repo(.git)
		const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
		if (m) gitRemoteRepo = `${m[1]}/${m[2]}`;
	} catch {
		// 非 git 仓库 / 未配置 origin（如 Vercel Function 运行时）时保持为空
	}
	return gitRemoteRepo;
}

/**
 * 写作目标仓库解析：WRITING_GITHUB_REPO → Vercel 所连仓库（VERCEL_GIT_REPO_OWNER/
 * VERCEL_GIT_REPO_SLUG）→ 本地 git remote origin
 */
export function resolveRepo(env = process.env) {
	const explicit = String(env.WRITING_GITHUB_REPO || "").trim();
	if (explicit) return explicit;
	if (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG) {
		return `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`;
	}
	return repoFromGitRemote();
}

export function formatDate(value) {
	if (!value) return "";
	if (value instanceof Date) {
		try {
			return value.toISOString().slice(0, 10);
		} catch {
			return "";
		}
	}
	return String(value).slice(0, 10);
}

/**
 * 表单 + 正文 → 完整 Markdown（frontmatter 由 gray-matter 生成）。
 * js-yaml 会给形如日期的字符串加引号（published: '2026-06-14'），
 * 引号字符串经 z.date() 校验会失败，还原为与现有文章一致的日期字面量
 */
export function buildMarkdown(fm, content) {
	const data = {
		title: String(fm.title || "").trim(),
		published: formatDate(fm.published) || formatDate(new Date()),
		description: String(fm.description || ""),
		image: String(fm.image || ""),
		tags: Array.isArray(fm.tags)
			? fm.tags.map((t) => String(t)).filter(Boolean)
			: [],
		category: String(fm.category || ""),
		draft: fm.draft === true,
		lang: String(fm.lang || ""),
	};
	const updated = formatDate(fm.updated);
	if (updated) data.updated = updated;
	let md = matter.stringify(String(content || ""), data);
	md = md.replace(/^(published|updated): '(\d{4}-\d{2}-\d{2})'$/gm, "$1: $2");
	return md;
}

// --- GitHub Contents API ---
export function githubHeaders(token, extra = {}) {
	return {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "firefly-writing-api",
		...extra,
	};
}

export async function githubFetch(pathWithQuery, token, init = {}) {
	return fetch(`${GITHUB_API}${pathWithQuery}`, {
		...init,
		headers: githubHeaders(token, init.headers),
		signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
	});
}
