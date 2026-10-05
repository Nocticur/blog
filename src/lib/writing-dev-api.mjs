import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { articleDateError } from "../../api/_lib/article-validation.mjs";
import {
	createLocalStore,
	executeContent,
	uploadContentImage,
} from "../../api/_lib/content-management.mjs";
import { readLocalFriendStatus } from "../../api/_lib/friend-status.mjs";
import { createLoginLimiter } from "../../api/_lib/login-limiter.mjs";
import matter from "../../api/_lib/safe-matter.mjs";
import {
	cookieSession,
	MAX_IMAGE_BYTES,
	MAX_REQUEST_BYTES,
	requireSameOrigin,
	sessionCookie,
} from "../../api/_lib/writing-session.mjs";
import {
	buildMarkdown,
	formatDate,
	resolvePasswordHash,
	resolveRepo,
	signSession,
	verifyPassword,
	verifySession,
} from "./writing-server.mjs";

export function writingDevApi(
	root = process.cwd(),
	{ preview = process.env.WRITING_DEV_PREVIEW === "1" } = {},
) {
	const loginLimiter = createLoginLimiter();
	const postsDir = path.resolve(root, "src/content/posts");
	const postsDirPrefix = `${postsDir}${path.sep}`;
	const validSegment = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
	const MAX_BODY_SIZE = MAX_REQUEST_BYTES;
	const MAX_UPLOAD_SIZE = MAX_IMAGE_BYTES;
	const store = createLocalStore(root);
	const IMAGE_MIME_TYPES = {
		"image/jpeg": ".jpg",
		"image/png": ".png",
		"image/webp": ".webp",
		"image/avif": ".avif",
		"image/gif": ".gif",
	};
	const IMAGE_DATA_URL_PATTERN =
		/^data:(image\/(?:jpeg|png|webp|avif|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

	function json(res, status, data) {
		res.statusCode = status;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "private, no-store");
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
		if (
			segments.some(
				(s) => !s || s === "." || s === ".." || !validSegment.test(s),
			)
		) {
			return null;
		}
		const fullPath = path.resolve(postsDir, name);
		if (!fullPath.startsWith(postsDirPrefix)) return null;
		return fullPath;
	}

	function imageTimestamp() {
		const now = new Date();
		const pad = (value) => String(value).padStart(2, "0");
		return [
			now.getFullYear(),
			pad(now.getMonth() + 1),
			pad(now.getDate()),
			pad(now.getHours()),
			pad(now.getMinutes()),
			pad(now.getSeconds()),
		].join("");
	}

	function resolveImageUpload(body) {
		const slug = String(body?.slug || "").trim();
		if (!slug || !validSegment.test(slug)) return null;
		const match = IMAGE_DATA_URL_PATTERN.exec(String(body?.dataUrl || ""));
		if (!match) return null;
		const image = Buffer.from(match[2], "base64");
		if (image.length === 0 || image.length > MAX_UPLOAD_SIZE) return null;
		return {
			slug,
			image,
			extension: IMAGE_MIME_TYPES[match[1]],
		};
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
						const raw = fs.readFileSync(abs, "utf8");
						const { data } = matter(raw);
						out.push({
							file: relPath,
							version: createHash("sha256").update(raw).digest("hex"),
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
		return out.sort((a, b) =>
			String(b.published).localeCompare(String(a.published)),
		);
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on("data", (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_SIZE) {
					reject(
						Object.assign(new Error("请求体过大，图片上限为 3 MiB"), {
							status: 413,
						}),
					);
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
			server.middlewares.use("/api/friend-status", (req, res) => {
				if (req.method !== "GET") {
					res.setHeader("Allow", "GET");
					return error(res, 405, "此接口仅支持 GET");
				}
				readLocalFriendStatus(root)
					.then((report) => json(res, 200, report))
					.catch(() => error(res, 503, "友链检测结果暂不可用，请稍后重试"));
			});
			server.middlewares.use("/api/writing", (req, res, next) => {
				// connect 挂载后 req.url 形如 "/posts?file=xxx"
				const requestUrl = new URL(req.url, "http://localhost");
				const route = requestUrl.pathname.replace(/\/+$/, "") || "/";
				const fileParam = requestUrl.searchParams.get("file") || "";

				const handle = async () => {
					const origin = `${req.socket?.encrypted ? "https" : "http"}://${req.headers.host}`;
					if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
						requireSameOrigin(req.headers, origin);
					const authenticated = verifySession(cookieSession(req.headers));
					const previewMode =
						!authenticated &&
						preview &&
						["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
							req.socket?.remoteAddress,
						) &&
						["localhost", "127.0.0.1", "[::1]"].includes(
							new URL(origin).hostname,
						) &&
						(!req.headers.origin || req.headers.origin === origin) &&
						req.headers["sec-fetch-site"] !== "cross-site";
					const sessionInfo = (isPreview = previewMode) => ({
						authenticated: true,
						mode: "dev",
						...(isPreview ? { preview: true } : {}),
						repo: resolveRepo(),
						branch: (process.env.WRITING_GITHUB_BRANCH || "").trim(),
						tokenReady: Boolean(
							process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
						),
					});
					// 登录：服务端校验密码并签发会话 token（与线上 Vercel Function 同契约）
					if (req.method === "POST" && route === "/auth") {
						if (!resolvePasswordHash())
							return error(
								res,
								503,
								"请先配置 WRITING_PASSWORD 或 WRITING_PASSWORD_HASH",
							);
						let body;
						const retryAfter = loginLimiter.consume(
							req.socket?.remoteAddress || "unknown",
						);
						if (retryAfter) {
							res.setHeader("Retry-After", String(retryAfter));
							return error(res, 429, "登录尝试过多，请稍后重试");
						}
						try {
							body = JSON.parse(await readBody(req));
						} catch (err) {
							return error(
								res,
								err.status || 400,
								err.status ? err.message : "Invalid JSON body",
							);
						}
						if (!body || !verifyPassword(body.password)) {
							return error(res, 401, "密码不正确");
						}
						res.setHeader(
							"Set-Cookie",
							sessionCookie(signSession(), req.socket?.encrypted === true),
						);
						return json(res, 200, sessionInfo(false));
					}
					if (req.method === "POST" && route === "/logout") {
						res.setHeader(
							"Set-Cookie",
							sessionCookie("", req.socket?.encrypted === true),
						);
						return json(res, 200, { ok: true, authenticated: false });
					}
					// 其余接口要求有效会话 token（HMAC 签名 + 有效期）
					if (!authenticated && !previewMode) {
						error(res, 401, "登录已过期，请重新登录");
						return;
					}
					if (previewMode && req.method !== "GET")
						return error(
							res,
							403,
							"当前为本地预览，可浏览和试填；保存需要正常登录。",
						);
					if (req.method === "GET" && route === "/session")
						return json(res, 200, sessionInfo());
					if (route.startsWith("/content/") || route.startsWith("/settings/")) {
						const match = /^\/(?:content|settings)\/([a-z]+)(\/images)?$/.exec(
							route,
						);
						if (!match) return error(res, 404, "Not found");
						const body =
							req.method === "GET"
								? Object.fromEntries(requestUrl.searchParams)
								: JSON.parse(await readBody(req));
						if (match[2] && req.method !== "POST")
							return error(res, 405, "Method not allowed");
						return json(
							res,
							200,
							await (match[2]
								? uploadContentImage(store, match[1], body)
								: executeContent(store, match[1], req.method, body)),
						);
					}
					if (route === "/posts" && req.method === "GET") {
						if (fileParam) {
							const fullPath = resolvePostPath(fileParam);
							if (!fullPath) return error(res, 400, "Invalid file name");
							if (!fs.existsSync(fullPath))
								return error(res, 404, "Post not found");
							const current = await store.read(
								`src/content/posts/${fileParam}`,
							);
							const raw = current.source;
							const { data, content } = matter(raw);
							return json(res, 200, {
								file: fileParam,
								version: current.version,
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
							tokenReady: Boolean(
								process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
							),
						});
					}

					if (req.method === "POST" && route === "/images") {
						let body;
						try {
							body = JSON.parse(await readBody(req));
						} catch (err) {
							return error(
								res,
								err.status || 400,
								err.status ? err.message : "Invalid JSON body",
							);
						}
						const upload = resolveImageUpload(body);
						if (!upload) {
							return error(res, 400, "Invalid image or file size");
						}
						const relativeDir = `image/${upload.slug}.assets`;
						const targetDir = path.resolve(postsDir, relativeDir);
						if (!targetDir.startsWith(postsDirPrefix)) {
							return error(res, 400, "Invalid slug (file name)");
						}
						const fileName = `${upload.slug}-${imageTimestamp()}-${randomUUID()}${upload.extension}`;
						const fullPath = path.join(targetDir, fileName);
						fs.mkdirSync(targetDir, { recursive: true });
						fs.writeFileSync(fullPath, upload.image, { flag: "wx" });
						setImmediate(() => {
							server.watcher.emit("add", fullPath);
						});
						return json(res, 200, {
							image: `./image/${upload.slug}.assets/${fileName}`,
						});
					}

					if (
						(req.method === "POST" || req.method === "PUT") &&
						route === "/posts"
					) {
						let body;
						try {
							body = JSON.parse(await readBody(req));
						} catch (err) {
							return error(
								res,
								err.status || 400,
								err.status ? err.message : "Invalid JSON body",
							);
						}
						if (!body || !String(body.title || "").trim()) {
							return error(res, 400, "Title is required");
						}
						const dateError = articleDateError(body);
						if (dateError) return error(res, 400, dateError);
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
							if (!fs.existsSync(fullPath))
								return error(res, 409, "文章已删除，请重新读取后合并");
						}
						const fullPath = path.resolve(postsDir, targetFile);
						const current = await store.read(`src/content/posts/${targetFile}`);
						if (
							isCreate
								? Boolean(current)
								: !body.version || body.version !== current?.version
						)
							return error(res, 409, "版本冲突，请重新读取后合并");
						const existingData = current ? matter(current.source).data : {};
						const md = buildMarkdown(body, body.content, existingData);
						const version = await store.write(
							`src/content/posts/${targetFile}`,
							Buffer.from(md),
							current?.version || null,
						);
						// Astro 7 的 content watcher 对新增文件的热更新不可靠（withastro/astro#17335），
						// 手动派发 chokidar 事件，借 glob loader 自己的 onChange 管线完成同步
						setImmediate(() => {
							server.watcher.emit(isCreate ? "add" : "change", fullPath);
						});
						return json(res, 200, { ok: true, file: targetFile, version });
					}

					if (req.method === "DELETE" && route === "/posts") {
						const fullPath = resolvePostPath(fileParam);
						if (!fullPath) return error(res, 400, "Invalid file name");
						const current = await store.read(`src/content/posts/${fileParam}`);
						const version = requestUrl.searchParams.get("version");
						if (!current || !version || version !== current.version)
							return error(res, 409, "版本冲突，请重新读取后合并");
						await store.write(`src/content/posts/${fileParam}`, null, version);
						setImmediate(() => {
							server.watcher.emit("unlink", fullPath);
						});
						return json(res, 200, { ok: true });
					}

					return error(res, 404, "Not found");
				};

				handle().catch((err) => {
					error(
						res,
						err.status || 500,
						err && err.message ? err.message : "Internal error",
					);
				});
			});
		},
	};
}
