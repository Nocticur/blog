/**
 * 写作空间的线上 API（Vercel Serverless Function）。
 *
 * 线上站点是纯静态产物，无法像 `astro dev` 那样写本地文件，因此文章的
 * 发布/修改/删除走 GitHub Contents API 直接提交到仓库（与 Firefly-hyde
 * 后台的 Git 写回通道同思路），提交后 Vercel 自动重新构建，约 2-3 分钟生效。
 *
 * 路由契约与 astro.config.mjs 的 writing-dev-api 完全一致，前端一套代码自适应：
 * - POST /api/writing/auth          登录：服务端校验密码，签发 HMAC 会话 token
 * - GET  /api/writing/posts         文章列表（含草稿）
 * - GET  /api/writing/posts?file=   读取单篇（frontmatter + 正文）
 * - POST/PUT /api/writing/posts     保存 = 提交到仓库（草稿以 draft:true 一并入库）
 * - DELETE /api/writing/posts?file= 删除仓库中的文章文件
 *
 * 注意：本文件刻意做成「自包含」——鉴权/会话/buildMarkdown/仓库解析等逻辑直接
 * 内联，不 import 项目其他目录的模块。Vercel 对 api/ 目录做函数打包时不会可靠
 * 地带上 api/ 之外的文件，跨目录 import 会导致线上 FUNCTION_INVOCATION_FAILED。
 * 这些逻辑与 src/lib/writing-server.mjs（本地 dev middleware 使用）保持同步。
 *
 * 安全：密钥只存在于服务端环境变量（GITHUB_TOKEN、WRITING_PASSWORD[_HASH]、
 * WRITING_SESSION_SECRET），除 /auth 外的所有请求都要求有效的会话 token；
 * 密码哈希不随页面下发到浏览器。
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import matter from "gray-matter";

// ── 与 src/lib/writing-server.mjs 同步的内联实现 ──────────────────────────

const DEFAULT_PASSWORD_HASH =
	"afac327e73694e68c02f5c62f3bc0bcf0f239744ff12921e781487a0f9b3d5d0";
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const VALID_SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
const GITHUB_API = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 30 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

function resolvePasswordHash(env = process.env) {
	if (env.WRITING_PASSWORD) return sha256Hex(env.WRITING_PASSWORD);
	if (env.WRITING_PASSWORD_HASH) return env.WRITING_PASSWORD_HASH;
	return DEFAULT_PASSWORD_HASH;
}

function verifyPassword(password, env = process.env) {
	const plain = String(password ?? "");
	if (!plain) return false;
	return sha256Hex(plain) === resolvePasswordHash(env);
}

function resolveSessionSecret(env = process.env) {
	return (
		env.WRITING_SESSION_SECRET ||
		`firefly-writing-session:${resolvePasswordHash(env)}`
	);
}

function signSession(env = process.env, ttlMs = SESSION_TTL_MS) {
	const payload = Buffer.from(
		JSON.stringify({ exp: Date.now() + ttlMs }),
	).toString("base64url");
	const sig = createHmac("sha256", resolveSessionSecret(env))
		.update(payload)
		.digest("base64url");
	return `${payload}.${sig}`;
}

function verifySession(token, env = process.env) {
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

// 线上目标仓库：WRITING_GITHUB_REPO → Vercel 所连仓库（平台自动注入）→ 空
// （与本地不同：函数运行时没有 git 仓库，不尝试读 git remote）
function resolveRepo(env = process.env) {
	const explicit = String(env.WRITING_GITHUB_REPO || "").trim();
	if (explicit) return explicit;
	if (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG) {
		return `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`;
	}
	return "";
}

function formatDate(value) {
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

// 表单 + 正文 → Markdown。js-yaml 会给形如日期的字符串加引号，而引号字符串
// 经 z.date() 校验会失败，这里还原为日期字面量
function buildMarkdown(fm, content) {
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

async function githubFetch(pathWithQuery, token, init = {}) {
	return fetch(`${GITHUB_API}${pathWithQuery}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "firefly-writing-api",
			...init.headers,
		},
		signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
	});
}

// ── 函数内部实现 ──────────────────────────────────────────────────────────

const POSTS_DIR = "src/content/posts";
const LIST_SKIP_DIRS = new Set(["assets", "image", "node_modules"]);
// 列表需要逐篇读 frontmatter，限制并发防止速率浪费
const READ_CONCURRENCY = 8;

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function fail(message, status = 400) {
	return json({ error: message }, status);
}

function createHeaders(headers) {
	if (headers instanceof Headers) return headers;
	const normalized = new Headers();
	if (headers && typeof headers === "object") {
		for (const [name, value] of Object.entries(headers)) {
			if (value != null) {
				normalized.set(
					name,
					Array.isArray(value) ? value.join(", ") : String(value),
				);
			}
		}
	}
	return normalized;
}

function absoluteRequestUrl(request) {
	const rawUrl = typeof request.url === "string" && request.url ? request.url : "/";
	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(rawUrl)) return rawUrl;
	const headers = createHeaders(request.headers);
	const host = headers.get("host") || "localhost";
	const protocol = headers.get("x-forwarded-proto") || "https";
	return new URL(rawUrl, `${protocol}://${host}`).href;
}

async function readRequestBody(request) {
	if (request.body !== undefined && request.body !== null) {
		if (typeof request.body === "object" && !Buffer.isBuffer(request.body))
			return request.body;
		const text = Buffer.isBuffer(request.body)
			? request.body.toString("utf8")
			: String(request.body);
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	}
	if (typeof request.on !== "function") return null;
	const chunks = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return null;
	}
}

function adaptNodeRequest(request) {
	return {
		url: absoluteRequestUrl(request),
		method: String(request.method || "GET").toUpperCase(),
		headers: createHeaders(request.headers),
		json: () => readRequestBody(request),
	};
}

async function readJson(request) {
	try {
		const body = await request.json();
		return body && typeof body === "object" ? body : null;
	} catch {
		return null;
	}
}

async function sendResponse(response, res) {
	if (!res) return response;
	res.statusCode = response.status;
	response.headers.forEach((value, name) => res.setHeader?.(name, value));
	const body = await response.text();
	if (typeof res.end === "function") {
		res.end(body);
		return undefined;
	}
	if (typeof res.send === "function") return res.send(body);
	return undefined;
}

function requireToken() {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (!token)
		throw new HttpError(
			500,
			"未配置 GITHUB_TOKEN 环境变量（Vercel 项目设置中添加后需重新部署）",
		);
	return token;
}

// 把 GitHub 的非 2xx 响应转成带中文提示的 HttpError；extra404 用于区分 404 的语境
async function ghData(res, extra404 = "GitHub 资源不存在") {
	if (res.ok) return res.json();
	if (res.status === 404) throw new HttpError(404, extra404);
	if (res.status === 401 || res.status === 403) {
		throw new HttpError(
			500,
			"GitHub Token 认证失败或无权限（需要目标仓库 Contents 读写权限）",
		);
	}
	let message = `GitHub API 错误（HTTP ${res.status}）`;
	try {
		const data = await res.json();
		if (data.message) message = `GitHub：${data.message}`;
	} catch {
		// 非 JSON 错误体时用默认文案
	}
	throw new HttpError(res.status === 422 ? 400 : 502, message);
}

// 目标分支：WRITING_GITHUB_BRANCH 优先，否则用仓库默认分支（按实例缓存）
const defaultBranchCache = new Map();
async function resolveBranch(repo, token) {
	const configured = (process.env.WRITING_GITHUB_BRANCH || "").trim();
	if (configured) return configured;
	if (defaultBranchCache.has(repo)) return defaultBranchCache.get(repo);
	const data = await ghData(
		await githubFetch(`/repos/${repo}`, token),
		"仓库不存在或 Token 无权访问",
	);
	const branch = data.default_branch || "main";
	defaultBranchCache.set(repo, branch);
	return branch;
}

function isPostPath(path) {
	if (!path.startsWith(`${POSTS_DIR}/`) || !/\.(md|mdx)$/i.test(path))
		return false;
	const rel = path.slice(POSTS_DIR.length + 1);
	const segments = rel.split("/");
	if (segments.some((s) => s.startsWith("."))) return false;
	if (!segments[1] && LIST_SKIP_DIRS.has(segments[0])) return false;
	return true;
}

// 用 Git Trees API 一次拿全仓库文件树，筛出 src/content/posts/ 下的文章
async function listPostFiles(repo, branch, token) {
	const data = await ghData(
		await githubFetch(
			`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
			token,
		),
		"仓库或分支不存在，或 Token 无权访问",
	);
	return (data.tree || [])
		.filter((e) => e.type === "blob" && isPostPath(e.path))
		.map((e) => ({ path: e.path, sha: e.sha }));
}

// 读取单篇并解析 frontmatter，返回与 dev middleware listPosts 相同的条目结构
async function readPostMeta(repo, branch, file, token) {
	const data = await ghData(
		await githubFetch(
			`/repos/${repo}/contents/${POSTS_DIR}/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
			token,
		),
		"文章不存在",
	);
	try {
		const md = Buffer.from(data.content || "", "base64").toString("utf8");
		const { data: fm } = matter(md);
		return {
			file,
			sha: data.sha,
			title: String(fm.title || file),
			published: formatDate(fm.published),
			draft: fm.draft === true,
			category: String(fm.category || ""),
			tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
			description: String(fm.description || ""),
		};
	} catch {
		return null; // 单篇解析失败不阻塞列表
	}
}

async function mapWithConcurrency(items, worker) {
	const results = [];
	for (let i = 0; i < items.length; i += READ_CONCURRENCY) {
		const chunk = items.slice(i, i + READ_CONCURRENCY);
		results.push(...(await Promise.all(chunk.map(worker))));
	}
	return results;
}

// --- 各路由 ---

async function handleAuth(request) {
	const body = await readJson(request);
	if (!body || !verifyPassword(body.password)) {
		return fail("密码不正确", 401);
	}
	return json({
		token: signSession(),
		mode: "deployed",
		repo: resolveRepo(),
		branch: (process.env.WRITING_GITHUB_BRANCH || "").trim(),
		tokenReady: Boolean(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN),
	});
}

// 仓库只由服务端解析（WRITING_GITHUB_REPO → Vercel 注入仓库），
// 不接受客户端传入，防止带 token 的会话提交到任意仓库
function pickRepo() {
	const repo = resolveRepo();
	if (!REPO_PATTERN.test(repo)) {
		throw new HttpError(
			400,
			"目标仓库未配置（需设置 WRITING_GITHUB_REPO 或将站点部署在 Vercel）",
		);
	}
	return repo;
}

async function handleList() {
	const repo = pickRepo();
	const token = requireToken();
	const branch = await resolveBranch(repo, token);
	const files = await listPostFiles(repo, branch, token);
	const metas = await mapWithConcurrency(files, (f) =>
		readPostMeta(repo, branch, f.path.slice(POSTS_DIR.length + 1), token),
	);
	const posts = metas
		.filter(Boolean)
		.map(({ sha, ...meta }) => meta)
		.sort((a, b) => String(b.published).localeCompare(String(a.published)));
	return json({
		posts,
		mode: "deployed",
		repo,
		branch,
		tokenReady: Boolean(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN),
	});
}

async function handleRead(url) {
	const file = url.searchParams.get("file") || "";
	if (!file || !isPostPath(`${POSTS_DIR}/${file.replace(/\\/g, "/")}`)) {
		return fail("Invalid file name");
	}
	const repo = pickRepo();
	const token = requireToken();
	const branch = await resolveBranch(repo, token);
	const data = await ghData(
		await githubFetch(
			`/repos/${repo}/contents/${POSTS_DIR}/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
			token,
		),
		"Post not found",
	);
	const md = Buffer.from(data.content || "", "base64").toString("utf8");
	let frontmatter = {};
	let content = md;
	try {
		const parsed = matter(md);
		frontmatter = parsed.data;
		content = parsed.content;
	} catch {
		// frontmatter 解析失败时按整篇正文返回
	}
	return json({
		file,
		frontmatter: {
			title: frontmatter.title || "",
			published: formatDate(frontmatter.published),
			updated: formatDate(frontmatter.updated),
			description: frontmatter.description || "",
			image: frontmatter.image || "",
			tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
			category: frontmatter.category || "",
			draft: frontmatter.draft === true,
			lang: frontmatter.lang || "",
		},
		content,
	});
}

async function handleSave(request, isCreate) {
	const body = await readJson(request);
	if (!body) return fail("Invalid JSON body");
	if (!String(body.title || "").trim()) return fail("Title is required");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(formatDate(body.published) || "")) {
		return fail("Published date is required (YYYY-MM-DD)");
	}
	const repo = pickRepo();
	// 本地可判定的校验全部前置，通过后才发起 GitHub 请求
	let file;
	if (isCreate) {
		const slug = String(body.slug || "").trim();
		if (!slug || !VALID_SEGMENT.test(slug))
			return fail("Invalid slug (file name)");
		file = `${slug}.md`;
	} else {
		file = String(body.file || "")
			.trim()
			.replace(/\\/g, "/");
		if (!file || !isPostPath(`${POSTS_DIR}/${file}`))
			return fail("Invalid file name");
	}
	const token = requireToken();
	const branch = await resolveBranch(repo, token);

	const remotePath = `${POSTS_DIR}/${file.split("/").map(encodeURIComponent).join("/")}`;
	const existing = await githubFetch(
		`/repos/${repo}/contents/${remotePath}?ref=${encodeURIComponent(branch)}`,
		token,
	);
	if (existing.status === 401 || existing.status === 403) {
		return fail(
			"GitHub Token 认证失败或无权限（需要目标仓库 Contents 读写权限）",
			500,
		);
	}
	let sha = null;
	if (existing.status === 200) {
		if (isCreate) return fail(`File ${file} already exists`, 409);
		sha = (await existing.json()).sha;
	} else if (existing.status !== 404) {
		return fail(`GitHub API 错误（HTTP ${existing.status}）`, 502);
	}

	const md = buildMarkdown(body, body.content);
	const put = await githubFetch(
		`/repos/${repo}/contents/${remotePath}`,
		token,
		{
			method: "PUT",
			body: JSON.stringify({
				message: `${sha ? "更新文章" : "发布文章"}：${String(body.title).trim() || file}`,
				content: Buffer.from(md, "utf8").toString("base64"),
				...(sha ? { sha } : {}),
				branch,
			}),
		},
	);
	const data = await ghData(put, "提交失败");
	return json({ ok: true, file, url: data.commit?.html_url || "" });
}

async function handleDelete(url) {
	const file = (url.searchParams.get("file") || "").trim().replace(/\\/g, "/");
	if (!file || !isPostPath(`${POSTS_DIR}/${file}`))
		return fail("Invalid file name");
	const repo = pickRepo();
	const token = requireToken();
	const branch = await resolveBranch(repo, token);

	const remotePath = `${POSTS_DIR}/${file.split("/").map(encodeURIComponent).join("/")}`;
	const data = await ghData(
		await githubFetch(
			`/repos/${repo}/contents/${remotePath}?ref=${encodeURIComponent(branch)}`,
			token,
		),
		"Post not found",
	);
	let title = "";
	try {
		title = String(
			matter(Buffer.from(data.content || "", "base64").toString("utf8")).data
				.title || "",
		);
	} catch {
		// frontmatter 解析失败时用文件名代替
	}
	const del = await githubFetch(
		`/repos/${repo}/contents/${remotePath}`,
		token,
		{
			method: "DELETE",
			body: JSON.stringify({
				message: `删除文章：${title.trim() || file}`,
				sha: data.sha,
				branch,
			}),
		},
	);
	await ghData(del, "删除失败");
	return json({ ok: true });
}

export default async function handler(request, response) {
	try {
		const isFetchRequest = response === undefined;
		const normalizedRequest = isFetchRequest
			? request
			: adaptNodeRequest(request);
		const url = new URL(normalizedRequest.url);
		const route =
			url.pathname.slice("/api/writing".length).replace(/\/+$/, "") || "/";
		let result;
		if (normalizedRequest.method === "POST" && route === "/auth") {
			result = await handleAuth(normalizedRequest);
		} else if (
			!verifySession(normalizedRequest.headers.get("x-writing-auth"))
		) {
			// 会话 token 校验：登录以外的所有接口都要带有效 token
			result = fail("登录已过期，请重新登录", 401);
		} else if (normalizedRequest.method === "GET" && route === "/posts") {
			// 与 dev middleware 一致：带 file 参数读单篇，否则返回列表
			result = url.searchParams.get("file")
				? await handleRead(url)
				: await handleList();
		} else if (
			(normalizedRequest.method === "POST" ||
				normalizedRequest.method === "PUT") &&
			route === "/posts"
		) {
			result = await handleSave(
				normalizedRequest,
				normalizedRequest.method === "POST",
			);
		} else if (normalizedRequest.method === "DELETE" && route === "/posts") {
			result = await handleDelete(url);
		} else {
			result = fail("Not found", 404);
		}
		return sendResponse(result, response);
	} catch (error) {
		const result =
			error?.name === "TimeoutError" || error?.name === "AbortError"
				? fail("请求 GitHub 超时，请稍后重试", 504)
				: fail(error?.message || "Internal error", error?.status || 500);
		return sendResponse(result, response);
	}
}

export const maxDuration = 30;
