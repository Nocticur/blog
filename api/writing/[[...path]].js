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
 * 安全：密钥只存在于服务端环境变量（GITHUB_TOKEN、WRITING_PASSWORD[_HASH]、
 * WRITING_SESSION_SECRET），除 /auth 外的所有请求都要求有效的会话 token；
 * 密码哈希不再随页面下发到浏览器。
 */
import matter from "gray-matter";
import {
	buildMarkdown,
	formatDate,
	githubFetch,
	REPO_PATTERN,
	resolveRepo,
	signSession,
	VALID_SEGMENT,
	verifyPassword,
	verifySession,
} from "../../src/lib/writing-server.mjs";

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
	return Response.json(data, { status });
}

function fail(message, status = 400) {
	return json({ error: message }, status);
}

async function readJson(request) {
	try {
		const body = await request.json();
		return body && typeof body === "object" ? body : null;
	} catch {
		return null;
	}
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

function pickRepo(request, url) {
	const repo =
		String(url.searchParams.get("repo") || "").trim() || resolveRepo();
	if (!REPO_PATTERN.test(repo)) {
		throw new HttpError(
			400,
			"仓库格式应为 owner/repo（可在页面输入框指定或配置 WRITING_GITHUB_REPO）",
		);
	}
	return repo;
}

async function handleList(request, url) {
	const repo = pickRepo(request, url);
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
	return json({ posts, mode: "deployed", repo, branch });
}

async function handleRead(request, url) {
	const file = url.searchParams.get("file") || "";
	if (!file || !isPostPath(`${POSTS_DIR}/${file.replace(/\\/g, "/")}`)) {
		return fail("Invalid file name");
	}
	const repo = pickRepo(request, url);
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
	const repo = String(body.repo || "").trim() || resolveRepo();
	if (!REPO_PATTERN.test(repo)) return fail("仓库格式应为 owner/repo");
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

async function handleDelete(request, url) {
	const file = (url.searchParams.get("file") || "").trim().replace(/\\/g, "/");
	if (!file || !isPostPath(`${POSTS_DIR}/${file}`))
		return fail("Invalid file name");
	const repo = pickRepo(request, url);
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

export default async function handler(request) {
	const url = new URL(request.url);
	const route =
		url.pathname.slice("/api/writing".length).replace(/\/+$/, "") || "/";
	try {
		if (request.method === "POST" && route === "/auth")
			return await handleAuth(request);
		// 会话 token 校验：登录以外的所有接口都要带有效 token
		if (!verifySession(request.headers.get("x-writing-auth"))) {
			return fail("登录已过期，请重新登录", 401);
		}
		if (request.method === "GET" && route === "/posts") {
			// 与 dev middleware 一致：带 file 参数读单篇，否则返回列表
			if (url.searchParams.get("file")) return handleRead(request, url);
			return await handleList(request, url);
		}
		if (
			(request.method === "POST" || request.method === "PUT") &&
			route === "/posts"
		) {
			return await handleSave(request, request.method === "POST");
		}
		if (request.method === "DELETE" && route === "/posts")
			return await handleDelete(request, url);
		return fail("Not found", 404);
	} catch (error) {
		if (error.name === "TimeoutError" || error.name === "AbortError") {
			return fail("请求 GitHub 超时，请稍后重试", 504);
		}
		return fail(error.message || "Internal error", error.status || 500);
	}
}

export const maxDuration = 30;
