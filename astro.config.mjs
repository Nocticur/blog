import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { setMaxListeners } from "node:events";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components"; /* Render the custom directive content */
import rehypeKatex from "rehype-katex";
import katex from "katex";
import "katex/dist/contrib/mhchem.mjs"; // 加载 mhchem 扩展
import rehypeSlug from "rehype-slug";
import rehypeCodeGroup from "rehype-code-group"; /* Tab 代码块 */
import remarkDirective from "remark-directive"; /* Handle directives */
import remarkMath from "remark-math";
import rehypeCallouts from "rehype-callouts";
import remarkSectionize from "remark-sectionize";
import {
	expressiveCodeConfig,
	mermaidConfig,
	plantumlConfig,
	siteConfig,
} from "./src/config";
import { i18n } from "./src/i18n/translation";
import I18nKey from "./src/i18n/i18nKey";
import { pluginLanguageBadge } from "expressive-code-language-badge"; /* Language Badge */
import { pluginCollapsible } from "expressive-code-collapsible"; /* Collapsible */
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { pluginLazyCollapsibleCode } from "./src/plugins/expressive-code-lazy-collapsible.mjs";
import { rehypeDiagramPanZoom } from "./src/plugins/rehype-diagram-panzoom.mjs";
import { rehypeMermaid } from "./src/plugins/rehype-mermaid.mjs";
import { rehypePlantuml } from "./src/plugins/rehype-plantuml.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import {
	buildMarkdown,
	formatDate,
	resolveRepo,
	signSession,
	verifyPassword,
	verifySession,
} from "./src/lib/writing-server.mjs";

// astro.config.mjs 的模块上下文不会自动加载 .env 文件（pnpm 下也无法直接 import vite
// 的 loadEnv），这里按 Vite 的优先级手动并入 process.env，供 writing-server.mjs
// 解析 WRITING_PASSWORD / WRITING_PASSWORD_HASH / GITHUB_TOKEN 等；系统环境变量优先
{
	const mode = process.env.NODE_ENV ?? "development";
	const envFiles = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
	const fromFiles = {};
	for (const file of envFiles) {
		const full = path.resolve(file);
		if (!fs.existsSync(full)) continue;
		for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
			const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
			if (!m || line.trimStart().startsWith("#")) continue;
			let value = m[2];
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			fromFiles[m[1]] = value;
		}
	}
	// Vite 热重启复用同一进程，上次注入的值会残留在 process.env 里，
	// 先清掉再合并，保证修改 .env 后热重启即可生效，无需重启进程
	const injected = (globalThis.__writingDotenvKeys ??= new Set());
	for (const key of injected) delete process.env[key];
	injected.clear();
	for (const [key, value] of Object.entries(fromFiles)) {
		if (!(key in process.env)) {
			process.env[key] = value;
			injected.add(key);
		}
	}
}
import { remarkExcerpt } from "./src/plugins/remark-excerpt.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.js";
import { remarkPlantuml } from "./src/plugins/remark-plantuml.js";
import { remarkReadingTime } from "./src/plugins/remark-reading-time.mjs";
import { remarkWikiLink } from "./src/plugins/remark-wiki-link.js";
import mdx from "@astrojs/mdx";
import rehypeEmailProtection from "./src/plugins/rehype-email-protection.mjs";
import rehypeExternalLinks from "./src/plugins/rehype-external-links.mjs";
import rehypeFigure from "./src/plugins/rehype-figure.mjs";
import { remarkImageGrid } from "./src/plugins/remark-image-grid.js";
import { unified } from "@astrojs/markdown-remark";

if (process.env.NODE_ENV === "development") {
	setMaxListeners(20);
}

// 读取文章 frontmatter 的 published/updated 字段，用于 sitemap lastmod
const postsDir = path.resolve("./src/content/posts");
const postLastmodCache = new Map();
function getPostLastmod(postId) {
	if (postLastmodCache.has(postId)) return postLastmodCache.get(postId);
	const filePath = path.join(postsDir, `${postId}.md`);
	let lastmod = null;
	if (fs.existsSync(filePath)) {
		try {
			const { data } = matter.read(filePath);
			lastmod = data.updated || data.published || null;
		} catch {
			// frontmatter 解析失败时返回 null
		}
	}
	postLastmodCache.set(postId, lastmod);
	return lastmod;
}

/**
 * 写作页（/writing/）的本地写作 API —— 仅在 `astro dev` 时存在。
 *
 * 前端提交文章元信息 + Markdown，这里做校验后用 gray-matter 生成 frontmatter
 * 并写入 src/content/posts/（文件名与路径校验规则与 scripts/new-post.js 一致），
 * Astro 检测到新文件后热更新，文章立即出现在站上。
 *
 * POST /api/writing/auth/：登录接口，服务端校验密码后签发 HMAC 会话 token，
 * 与线上 api/writing/[[...path]].js（Vercel Function）保持同一契约，前端据此
 * 自适应本地/线上模式（线上保存即经 GitHub Contents API 提交并触发重新构建）。
 * 鉴权/会话辅助逻辑在 src/lib/writing-server.mjs（与线上函数内的内联副本同步）。
 *
 * 安全：除登录外，每个接口都要求 x-writing-auth 头携带有效会话 token，
 * 防止绕过页面直接调用接口写文件。
 */
function writingDevApi() {
	const postsDir = path.resolve("./src/content/posts");
	const postsDirPrefix = `${postsDir}${path.sep}`;
	const validSegment = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
	const MAX_BODY_SIZE = 5 * 1024 * 1024;

	function json(res, status, data) {
		res.statusCode = status;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.end(JSON.stringify(data));
	}

	function error(res, status, message) {
		json(res, status, { error: message });
	}

	// 把相对文件名解析为 posts 目录内的绝对路径，路径越界或非法字符返回 null
	function resolvePostPath(file) {
		if (typeof file !== "string") return null;
		const name = file.trim().replace(/\\/g, "/");
		if (!name || !/\.(md|mdx)$/i.test(name)) return null;
		const segments = name.split("/");
		if (segments.some((s) => !s || s === "." || s === ".." || !validSegment.test(s))) {
			return null;
		}
		const fullPath = path.resolve(postsDir, name);
		if (!fullPath.startsWith(postsDirPrefix)) return null;
		return fullPath;
	}

	function listPosts() {
		const out = [];
		const skipDirs = new Set(["assets", "image", "node_modules"]);
		const walk = (dir, rel) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name.startsWith(".")) continue;
				const abs = path.join(dir, entry.name);
				const relPath = rel ? `${rel}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					if (!rel && skipDirs.has(entry.name)) continue;
					walk(abs, relPath);
				} else if (/\.(md|mdx)$/i.test(entry.name)) {
					try {
						const { data } = matter.read(abs);
						out.push({
							file: relPath,
							title: data.title || entry.name,
							published: formatDate(data.published),
							draft: data.draft === true,
							category: data.category || "",
							tags: Array.isArray(data.tags) ? data.tags : [],
							description: data.description || "",
						});
					} catch {
						// 单个文件解析失败不阻塞列表
					}
				}
			}
		};
		if (fs.existsSync(postsDir)) walk(postsDir, "");
		return out.sort((a, b) => String(b.published).localeCompare(String(a.published)));
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on("data", (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_SIZE) {
					reject(new Error("body too large"));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	return {
		name: "firefly-writing-dev-api",
		configureServer(server) {
			server.middlewares.use("/api/writing", (req, res, next) => {
				// connect 挂载后 req.url 形如 "/posts?file=xxx"
				const requestUrl = new URL(req.url, "http://localhost");
				const route = requestUrl.pathname.replace(/\/+$/, "") || "/";
				const fileParam = requestUrl.searchParams.get("file") || "";

				const handle = async () => {
					// 登录：服务端校验密码并签发会话 token（与线上 Vercel Function 同契约）
					if (req.method === "POST" && route === "/auth") {
						let body;
						try {
							body = JSON.parse(await readBody(req));
						} catch {
							return error(res, 400, "Invalid JSON body");
						}
						if (!body || !verifyPassword(body.password)) {
							return error(res, 401, "密码不正确");
						}
						return json(res, 200, {
							token: signSession(),
							mode: "dev",
							repo: resolveRepo(),
							branch: (process.env.WRITING_GITHUB_BRANCH || "").trim(),
							tokenReady: Boolean(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN),
						});
					}
					// 其余接口要求有效会话 token（HMAC 签名 + 有效期）
					if (!verifySession(req.headers["x-writing-auth"])) {
						error(res, 401, "登录已过期，请重新登录");
						return;
					}
					if (route === "/posts" && req.method === "GET") {
						if (fileParam) {
							const fullPath = resolvePostPath(fileParam);
							if (!fullPath) return error(res, 400, "Invalid file name");
							if (!fs.existsSync(fullPath)) return error(res, 404, "Post not found");
							const raw = fs.readFileSync(fullPath, "utf8");
							const { data, content } = matter(raw);
							return json(res, 200, {
								file: fileParam,
								frontmatter: {
									title: data.title || "",
									published: formatDate(data.published),
									updated: formatDate(data.updated),
									description: data.description || "",
									image: data.image || "",
									tags: Array.isArray(data.tags) ? data.tags : [],
									category: data.category || "",
									draft: data.draft === true,
									lang: data.lang || "",
								},
								content,
							});
						}
						return json(res, 200, {
							posts: listPosts(),
							mode: "dev",
							repo: resolveRepo(),
							branch: (process.env.WRITING_GITHUB_BRANCH || "").trim(),
							tokenReady: Boolean(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN),
						});
					}

					if ((req.method === "POST" || req.method === "PUT") && route === "/posts") {
						let body;
						try {
							body = JSON.parse(await readBody(req));
						} catch {
							return error(res, 400, "Invalid JSON body");
						}
						if (!body || !String(body.title || "").trim()) {
							return error(res, 400, "Title is required");
						}
						if (!/^\d{4}-\d{2}-\d{2}$/.test(formatDate(body.published) || "")) {
							return error(res, 400, "Published date is required (YYYY-MM-DD)");
						}
						const isCreate = req.method === "POST";
						let targetFile;
						if (isCreate) {
							const slug = String(body.slug || "").trim();
							if (!slug || !validSegment.test(slug)) {
								return error(res, 400, "Invalid slug (file name)");
							}
							targetFile = `${slug}.md`;
							if (resolvePostPath(targetFile) === null) {
								return error(res, 400, "Invalid slug (file name)");
							}
							if (fs.existsSync(path.resolve(postsDir, targetFile))) {
								return error(res, 409, `File ${targetFile} already exists`);
							}
						} else {
							targetFile = fileParam || String(body.file || "");
							const fullPath = resolvePostPath(targetFile);
							if (!fullPath) return error(res, 400, "Invalid file name");
							if (!fs.existsSync(fullPath)) return error(res, 404, "Post not found");
						}
						const fullPath = path.resolve(postsDir, targetFile);
						const md = buildMarkdown(body, body.content);
						fs.writeFileSync(fullPath, md, { encoding: "utf8" });
						// Astro 7 的 content watcher 对新增文件的热更新不可靠（withastro/astro#17335），
						// 手动派发 chokidar 事件，借 glob loader 自己的 onChange 管线完成同步
						setImmediate(() => {
							server.watcher.emit(isCreate ? "add" : "change", fullPath);
						});
						return json(res, 200, { ok: true, file: targetFile });
					}

					if (req.method === "DELETE" && route === "/posts") {
						const fullPath = resolvePostPath(fileParam);
						if (!fullPath) return error(res, 400, "Invalid file name");
						if (!fs.existsSync(fullPath)) return error(res, 404, "Post not found");
						fs.unlinkSync(fullPath);
						setImmediate(() => {
							server.watcher.emit("unlink", fullPath);
						});
						return json(res, 200, { ok: true });
					}

					return error(res, 404, "Not found");
				};

				handle().catch((err) => {
					error(res, 500, err && err.message ? err.message : "Internal error");
				});
			});
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site: siteConfig.site_url,
	
	base: "/",
	trailingSlash: "always",

	// 图像优化配置
	image: {
		// 全局响应式布局
		layout: "constrained",
	},

	integrations: [
		swup({
			theme: false,
			animationClass: "transition-swup-",
			containers: [
				"#swup-container",
				// 侧边栏容器不再参与 Swup 交换：内容页面无关、常驻 DOM，
				// 布局切换由 #main-grid[data-sidebar-position] 的 CSS 驱动（见 sidebar-layout.css）
			],
			smoothScrolling: false,
			cache: true,
			preload: { hover: true, visible: false },
			loadOnIdle: false,
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
			resolveUrl: (url) => url,
			animateHistoryBrowsing: false,
			skipPopStateHandling: (event) => {
				return event.state?.url?.includes("#");
			},
		}),
		icon({
			// 不使用 include，让 astro-icon 自动从 Iconify 包加载图标
		}),
		expressiveCode({
			themes: [expressiveCodeConfig.darkTheme, expressiveCodeConfig.lightTheme],
			useDarkModeMediaQuery: false,
			themeCssSelector: (theme) => `[data-theme='${theme.name}']`,
			plugins: [
				// pluginLanguageBadge 配置 - 从expressiveCodeConfig读取设置
				...(expressiveCodeConfig.pluginLanguageBadge?.enable === true
					? [pluginLanguageBadge()]
					: []),
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				// pluginCollapsible 配置 - 从expressiveCodeConfig读取设置，使用i18n文本
				...(expressiveCodeConfig.pluginCollapsible?.enable === true
					? [
							pluginCollapsible({
								lineThreshold:
									expressiveCodeConfig.pluginCollapsible.lineThreshold || 15,
								previewLines:
									expressiveCodeConfig.pluginCollapsible.previewLines || 8,
								defaultCollapsed:
									expressiveCodeConfig.pluginCollapsible.defaultCollapsed ??
									true,
								expandButtonText: i18n(I18nKey.codeCollapsibleShowMore),
								collapseButtonText: i18n(I18nKey.codeCollapsibleShowLess),
								expandedAnnouncement: i18n(I18nKey.codeCollapsibleExpanded),
								collapsedAnnouncement: i18n(I18nKey.codeCollapsibleCollapsed),
							}),
							pluginLazyCollapsibleCode({
								lineThreshold: 200,
								previewLines:
									expressiveCodeConfig.pluginCollapsible.previewLines || 8,
							}),
						]
					: []),
			],
			defaultProps: {
				wrap: false,
				overridesByLang: {
					shellsession: {
						showLineNumbers: false,
					},
				},
			},
			styleOverrides: {
				borderRadius: "0.75rem",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
				languageBadge: {
					fontSize: "0.75rem",
					fontWeight: "bold",
					borderRadius: "0.25rem",
					opacity: "1",
					borderWidth: "0px",
					borderColor: "transparent",
				},
			},
			frames: {
				showCopyToClipboardButton: true,
			},
		}),
		svelte(),
		sitemap({
			customPages: [
				new URL("/llms.txt", siteConfig.site_url).toString(),
				new URL("/wiki/index.json", siteConfig.site_url).toString(),
			],
			filter: (page) => {
				// 根据页面开关配置过滤sitemap
				const url = new URL(page);
				const pathname = url.pathname;

				// 搜索页不应被搜索引擎索引（Google 明确建议屏蔽搜索结果页）
				if (pathname === "/search/") {
					return false;
				}
				// 写作页是站长的私人工具，无论开关状态都不进 sitemap
				if (pathname === "/writing/") {
					return false;
				}
				// 文档列表页及其分页（/list/、/list/2/ …）
				if (pathname.startsWith("/list/") && !siteConfig.pages.postList) {
					return false;
				}
				if (pathname === "/friends/" && !siteConfig.pages.friends) {
					return false;
				}
				if (pathname === "/sponsor/" && !siteConfig.pages.sponsor) {
					return false;
				}
				if (pathname === "/guestbook/" && !siteConfig.pages.guestbook) {
					return false;
				}
				if (pathname === "/gallery/" && !siteConfig.pages.gallery) {
					return false;
				}
				if (pathname === "/music/" && !siteConfig.pages.music) {
					return false;
				}
				if (pathname === "/archive/" && !siteConfig.pages.archive) {
					return false;
				}
				if (pathname === "/about/" && !siteConfig.pages.about) {
					return false;
				}
				if (pathname === "/categories/" && !siteConfig.pages.categories) {
					return false;
				}
				if (pathname === "/collections/" && !siteConfig.pages.collections) {
					return false;
				}

			return true;
			},
			serialize: (item) => {
				const pathname = new URL(item.url).pathname;

				if (pathname === "/") {
					// 首页：最高优先级，每周更新
					item.priority = 1.0;
					item.changefreq = "weekly";
				} else if (pathname.startsWith("/posts/")) {
					// 文章页：高优先级，基于 frontmatter 的 updated/published 设置 lastmod
					const postId = pathname
						.replace(/^\/posts\//, "")
						.replace(/\/$/, "");
					const lastmod = getPostLastmod(postId);
					if (lastmod) {
						item.lastmod = new Date(lastmod).toISOString();
					}
					item.priority = 0.8;
					item.changefreq = "monthly";
				} else if (
					["/archive/", "/categories/", "/tags/"].includes(pathname)
				) {
					// 归档/分类/标签列表页：中优先级，有新文章时会更新
					item.priority = 0.6;
					item.changefreq = "weekly";
				} else {
					// 其他功能页（about/friends/gallery 等）：低优先级
					item.priority = 0.5;
					item.changefreq = "monthly";
				}

				return item;
			},
		}),
		mdx(),
	],
	markdown: {
		processor: unified({
			remarkPlugins: [
				remarkMath,
				remarkReadingTime,
				remarkWikiLink,
				remarkImageGrid,
				remarkExcerpt,
				remarkDirective,
				remarkSectionize,
				parseDirectiveNode,
				remarkMermaid,
				[remarkPlantuml, plantumlConfig],
			],
			rehypePlugins: [
				[rehypeKatex, { katex }],
				[rehypeCallouts, { theme: siteConfig.rehypeCallouts.theme }],
				rehypeSlug,
				rehypeCodeGroup,
				[rehypeMermaid, mermaidConfig],
				rehypePlantuml,
				rehypeDiagramPanZoom,
				rehypeFigure,
				[rehypeExternalLinks, { siteUrl: siteConfig.site_url }],
				[rehypeEmailProtection, { method: "base64" }], // 邮箱保护插件，支持 'base64' 或 'rot13'
				[
					rehypeComponents,
					{
						components: {
							github: GithubCardComponent,
						},
					},
				],
				[
					rehypeAutolinkHeadings,
					{
						behavior: "append",
						properties: {
							className: ["anchor"],
						},
						content: {
							type: "element",
							tagName: "span",
							properties: {
								className: ["anchor-icon"],
								"data-pagefind-ignore": true,
							},
							children: [
								{
									type: "text",
									value: "#",
								},
							],
						},
					},
				],
			],
		}),
	},
	vite: {
		plugins: [tailwindcss(), writingDevApi()],
		server: {
			watch: {
				ignored: ["**/package/**", "**/Firefly-docs/**"],
			},
		},
		resolve: {
			alias: {
				"@rehype-callouts-theme": `rehype-callouts/theme/${siteConfig.rehypeCallouts.theme}`,
			},
		},
		build: {
			// 静态资源缓存策略（需在部署平台配置）：
			// /_astro/*  → Cache-Control: public, max-age=31536000, immutable（内容哈希，长期缓存）
			// /assets/*  → Cache-Control: public, max-age=31536000, immutable（静态资源，长期缓存）
			// /*.html    → Cache-Control: public, max-age=0, must-revalidate（HTML 文件，始终验证）
			// Cloudflare Pages: public/_headers 文件 | Vercel: vercel.json 的 headers 配置
			minify: "esbuild",
			esbuildOptions: {
				minify: true,
				// 移除 console.log 和 debugger
				drop: ["console", "debugger"],
			},
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (id.includes("node_modules")) {
							if (id.includes("katex")) return "vendor-katex";
							if (id.includes("mermaid")) return "vendor-mermaid";
							if (id.includes("pixi") || id.includes("live2d")) return "vendor-live2d";
							if (id.includes("gsap")) return "vendor-gsap";
						}
						if (id.includes("Guestbook")) return "vendor-guestbook";
						if (id.includes("WritingStudio")) return "vendor-writer";
						if (id.includes("CalendarGrid")) return "vendor-calendar";
					},
				},
				onwarn(warning, warn) {
					// temporarily suppress this warning
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					// gsap 在 Svelte 事件处理器中使用，Vite tree-shaking 误报
					if (
						warning.message.includes('"gsap"') &&
						warning.message.includes("but never used")
					) {
						return;
					}
					warn(warning);
				},
			},
			// CSS 按页拆包：每页只拉取自己需要的样式，首访渲染阻塞 CSS 从全站合并的
			// ~102KB gz 降到按页体积（已超出 B3 方案 R2 的 100KB 回退线）。
			// Swup 导航的串行 CSS 等待由 swup-css-prefetch.ts 在 hover 预载阶段消除
			// （/_astro/* 为 immutable 缓存，预取必命中）。
			cssCodeSplit: true,
			cssMinify: "esbuild",
			assetsInlineLimit: 4096,
		},
	},
});
