/**
 * 写作页（/writing/）配置
 *
 * 写作页入口始终显示在导航栏「文章」下拉中，进入后需要输入密码。
 * 密码不明文存放在代码里，通过环境变量注入，代码中只保留 SHA-256 哈希：
 * - 前端登录时用 WebCrypto 计算输入的哈希与配置比对
 * - 本地 dev server 的写入 API（见 astro.config.mjs 的 writing-dev-api 插件）
 *   会校验每个请求的 x-writing-auth 头，防止绕过页面直接调接口
 *
 * 密码来源（按优先级）：
 * 1. WRITING_PASSWORD       明文密码，读取时现算 SHA-256（推荐，改密码不用手动算哈希）
 * 2. WRITING_PASSWORD_HASH  预先算好的 SHA-256 哈希
 * 3. 都未设置时回退到内置默认密码
 *
 * 本地开发：配置系统环境变量（Windows「系统属性 → 环境变量」或 setx 命令；
 *   设置后需重开终端再启动 dev server 才生效）。也可写入项目根目录 .env 作备选
 *   （.env 已被 gitignore，不会提交；系统环境变量优先级始终更高）。
 * Vercel 线上：项目 Settings → Environment Variables 添加变量后重新部署。
 *
 * GitHub 上传（编辑器「上传 GitHub」按钮，走 dev middleware 的 /api/writing/publish）：
 * - GITHUB_TOKEN          fine-grained PAT，需目标仓库 Contents 读写权限
 *                         （回退读取 GH_TOKEN）；仅本地 dev server 使用，不进前端
 * - WRITING_GITHUB_REPO   可选，覆盖「上传仓库」输入框默认值；不设时自动读
 *                         git remote origin 推导（如 Nocticur/blog），页面可改
 * - WRITING_GITHUB_BRANCH 可选，提交的目标分支，缺省用仓库默认分支
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const envVar = (name: string): string | undefined => {
	const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
	return viteEnv?.[name] ?? globalThis.process?.env?.[name];
};

// 从 git remote origin 自动推导 GitHub 仓库（owner/repo），失败或非 GitHub 时为空。
// 结果按进程缓存，避免每次页面渲染都 fork git
let gitRemoteRepo: string | undefined;
function repoFromGitRemote(): string {
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
		// 非 git 仓库 / 未配置 origin 时保持为空，由页面输入框兜底
	}
	return gitRemoteRepo;
}

function resolvePasswordHash(): string {
	const plain = envVar("WRITING_PASSWORD");
	if (plain) return createHash("sha256").update(plain).digest("hex");
	const hash = envVar("WRITING_PASSWORD_HASH");
	if (hash) return hash;
	// 内置默认密码的哈希（默认：firefly），仅兜底用
	return "afac327e73694e68c02f5c62f3bc0bcf0f239744ff12921e781487a0f9b3d5d0";
}

export const writingConfig = {
	// getter：每次访问时解析，保证 dev middleware 在请求期拿到与页面一致的值
	get passwordHash(): string {
		return resolvePasswordHash();
	},
	// 「上传仓库」输入框默认值：优先 WRITING_GITHUB_REPO 环境变量覆盖，
	// 否则自动读 git remote origin 推导（如 Nocticur/blog），页面输入框仍可改
	get defaultRepo(): string {
		return envVar("WRITING_GITHUB_REPO") || repoFromGitRemote();
	},
	// GitHub token 是否已配置，用于在页面上给出「缺 token」提示
	get githubTokenReady(): boolean {
		return Boolean(envVar("GITHUB_TOKEN") || envVar("GH_TOKEN"));
	},
};
