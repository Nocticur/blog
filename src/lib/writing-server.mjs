/**
 * 写作空间的本地服务端模块 —— 仅供 astro.config.mjs 的 writing-dev-api 插件
 * （`astro dev` middleware）使用：共享会话工具、buildMarkdown、
 * 仓库解析（读本地 git remote）。
 *
 * 会话实现与线上 Vercel Function 共用 api/_lib/writing-session.mjs。
 * Markdown 构造逻辑在线上保留一份副本，两端修改时需保持同步。
 *
 * 用 plain ESM（.mjs）而非 TS，是因为 tsconfig 关闭了 allowJs，TS 侧不需要引它。
 * 所有密钥一律从环境变量读取（系统变量 / Vercel Environment Variables，
 * .env 文件仅作本地备选），绝不进前端或打包产物。
 */
import { execSync } from "node:child_process";
import matter from "gray-matter";
export { resolvePasswordHash, verifyPassword, resolveSessionSecret, signSession, verifySession } from '../../api/_lib/writing-session.mjs';

// 没有显式密码时拒绝登录。

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
export function buildMarkdown(fm, content, existing = {}) {
	const data = {
        ...existing,
		title: String(fm.title || "").trim(),
		published: formatDate(fm.published) || formatDate(new Date()),
		description: String(fm.description || ""),
		image: String(fm.image || ""),
		tags: Array.isArray(fm.tags)
			? fm.tags.map((t) => String(t)).filter(Boolean)
			: [],
		category: String(fm.category || ""),
		draft: fm.draft === true,
		lang: String(fm.lang ?? existing.lang ?? ""),
	};
	const updated = formatDate(fm.updated);
	if (updated) data.updated = updated;
 else delete data.updated;
	let md = matter.stringify(String(content || ""), data);
	md = md.replace(/^(published|updated): '(\d{4}-\d{2}-\d{2})'$/gm, "$1: $2");
	return md;
}
