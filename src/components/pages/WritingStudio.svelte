<script lang="ts">
import {
	Bold,
	CloudOff,
	CloudUpload,
	Code,
	Eye,
	Heading2,
	Heading3,
	Image as ImageIcon,
	Italic,
	Link2,
	List,
	ListOrdered,
	ListPlus,
	Lock,
	LogOut,
	Pencil,
	Quote,
	Save,
	SquareCode,
	Trash2,
	X,
} from "lucide-svelte";
import { marked } from "marked";
import { onMount } from "svelte";
import "@/styles/components/writing-studio.css";

interface PostItem {
	file: string;
	title: string;
	published: string;
	draft: boolean;
	category: string;
	tags: string[];
	description: string;
}

interface PostDetail {
	file: string;
	frontmatter: {
		title: string;
		published: string;
		updated: string;
		description: string;
		image: string;
		tags: string[];
		category: string;
		draft: boolean;
		lang: string;
	};
	content: string;
}

let { defaultRepo = "" }: { defaultRepo?: string } = $props();

// --- 会话与视图状态 ---
const AUTH_KEY = "firefly-writing-auth";
type View = "login" | "list" | "editor" | "offline";
let view = $state<View>("login");
let password = $state("");
let loginError = $state("");
let loggingIn = $state(false);
// 服务端运行模式："dev" 本地写文件 / "deployed" 线上走 GitHub 提交
let mode = $state<"dev" | "deployed">("dev");
// 服务端是否已配置 GITHUB_TOKEN（登录/列表接口返回）
let githubTokenReady = $state(false);

// --- 文章列表状态 ---
let posts = $state<PostItem[]>([]);
let listLoading = $state(false);
let listError = $state("");
let justSavedFile = $state("");
// 线上模式保存 = 提交到 GitHub，这里存 commit 链接用于展示
let justSavedUrl = $state("");

// --- 编辑器状态 ---
let editingFile = $state<string | null>(null);
let slugTouched = $state(false);
let form = $state({
	title: "",
	slug: "",
	published: "",
	updated: "",
	description: "",
	image: "",
	category: "",
	draft: false,
});
let tags = $state<string[]>([]);
let tagInput = $state("");
let content = $state("");
let saving = $state(false);
let saveError = $state("");
// --- GitHub 上传状态 ---
const REPO_KEY = "firefly-writing-repo";
let repoInput = $state("");
let publishing = $state(false);
let publishError = $state("");
let publishUrl = $state("");
let mobilePane = $state<"edit" | "preview">("edit");
let editorEl: HTMLTextAreaElement | undefined = $state();

const previewHtml = $derived(marked.parse(content) as string);
const allCategories = $derived([
	...new Set(posts.map((p) => p.category).filter(Boolean)),
]);
const allTags = $derived([...new Set(posts.flatMap((p) => p.tags))]);
const slugConflict = $derived(
	!editingFile &&
		form.slug !== "" &&
		posts.some((p) => p.file.toLowerCase() === `${form.slug.toLowerCase()}.md`),
);
const canSave = $derived(
	!!form.title.trim() && !!form.published && !!form.slug && !slugConflict,
);
const repoValid = $derived(/^[\w.-]+\/[\w.-]+$/.test(repoInput.trim()));
const publishButtonTitle = $derived(
	!githubTokenReady
		? "未配置 GITHUB_TOKEN 环境变量，无法上传"
		: !repoValid
			? "请输入格式为 owner/repo 的仓库名"
			: "上传当前文章到 GitHub 仓库（Vercel 将自动部署）",
);

function todayStr(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function deriveSlug(title: string): string {
	return title
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, "-")
		.replace(/[^\p{L}\p{N}.-]+/gu, "")
		.replace(/-{2,}/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
}

// 标题变化时自动推导文件名 slug（用户手动改过就不再覆盖）
$effect(() => {
	if (!slugTouched && !editingFile) {
		form.slug = deriveSlug(form.title);
	}
});

// --- 登录 ---
function logout() {
	sessionStorage.removeItem(AUTH_KEY);
	password = "";
	loginError = "";
	view = "login";
}

function handleSessionExpired() {
	sessionStorage.removeItem(AUTH_KEY);
	password = "";
	view = "login";
	loginError = "登录已过期，请重新输入密码";
}

// 登录改为服务端校验：密码 POST 给 /api/writing/auth/，换回 HMAC 会话
// token（本地 dev middleware 与线上 Vercel Function 同契约）
async function handleLogin(event: SubmitEvent) {
	event.preventDefault();
	if (!password || loggingIn) return;
	loginError = "";
	loggingIn = true;
	try {
		const res = await fetch("/api/writing/auth/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password }),
		});
		const data = await res.json().catch(() => ({}) as { error?: string });
		if (!res.ok) {
			loginError = data.error || `登录失败（HTTP ${res.status}）`;
			return;
		}
		const auth = data as {
			token?: string;
			mode?: string;
			repo?: string;
		};
		if (!auth.token) {
			loginError = "登录响应异常，请重试";
			return;
		}
		sessionStorage.setItem(AUTH_KEY, auth.token);
		mode = auth.mode === "deployed" ? "deployed" : "dev";
		// 服务端给的默认仓库仅在用户没有手动输入过时预填
		if (!repoInput.trim() && auth.repo) repoInput = auth.repo;
		password = "";
		await loadList();
	} catch {
		loginError = "登录失败：无法连接写作服务";
	} finally {
		loggingIn = false;
	}
}

// --- 本地写作 API ---
function authHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"x-writing-auth": sessionStorage.getItem(AUTH_KEY) ?? "",
	};
}

// 用户改过仓库输入框时，把目标仓库带给服务端（线上按仓库读写；本地忽略）
function repoQuery(): string {
	return repoValid ? `&repo=${encodeURIComponent(repoInput.trim())}` : "";
}

async function loadList() {
	listLoading = true;
	listError = "";
	try {
		// 注意：站点 trailingSlash 为 always，Astro 会在无尾斜杠 URL 上
		// 先于 dev middleware 返回 404，因此 API 路径统一带尾斜杠
		const res = await fetch(
			`/api/writing/posts/?_=${Date.now()}${repoQuery()}`,
			{
				headers: authHeaders(),
			},
		);
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		posts = data.posts ?? [];
		// 会话恢复（不经过登录）时，从列表接口拿运行模式与服务端信息
		mode = data.mode === "deployed" ? "deployed" : "dev";
		if (typeof data.tokenReady === "boolean")
			githubTokenReady = data.tokenReady;
		if (!repoInput.trim() && data.repo) repoInput = data.repo;
		view = "list";
	} catch {
		// 站点上没有 /api/writing 接口（未部署 Functions 或 Cloudflare 纯静态）时进入离线提示
		view = "offline";
	} finally {
		listLoading = false;
	}
}

async function openEdit(item: PostItem) {
	listError = "";
	try {
		const res = await fetch(
			`/api/writing/posts/?file=${encodeURIComponent(item.file)}${repoQuery()}`,
			{ headers: authHeaders() },
		);
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data: PostDetail = await res.json();
		const fm = data.frontmatter;
		editingFile = data.file;
		slugTouched = true;
		form = {
			title: fm.title,
			slug: data.file.replace(/\.(md|mdx)$/i, ""),
			published: fm.published,
			updated: fm.updated,
			description: fm.description,
			image: fm.image,
			category: fm.category,
			draft: fm.draft,
		};
		tags = [...fm.tags];
		tagInput = "";
		content = data.content;
		saveError = "";
		mobilePane = "edit";
		view = "editor";
	} catch {
		listError = "读取文章失败，请重试";
	}
}

function openCreate() {
	editingFile = null;
	slugTouched = false;
	form = {
		title: "",
		slug: "",
		published: todayStr(),
		updated: "",
		description: "",
		image: "",
		category: "",
		draft: false,
	};
	tags = [];
	tagInput = "";
	content = "";
	saveError = "";
	justSavedFile = "";
	justSavedUrl = "";
	mobilePane = "edit";
	view = "editor";
}

async function savePost(options?: {
	stayInEditor?: boolean;
}): Promise<string | null> {
	const stayInEditor = options?.stayInEditor === true;
	if (!canSave || saving) return null;
	saving = true;
	saveError = "";
	try {
		const res = await fetch("/api/writing/posts/", {
			method: editingFile ? "PUT" : "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				...form,
				tags,
				content,
				...(editingFile ? { file: editingFile } : {}),
				...(repoValid ? { repo: repoInput.trim() } : {}),
			}),
		});
		if (res.status === 401) {
			handleSessionExpired();
			return null;
		}
		const data = await res
			.json()
			.catch(() => ({}) as { error?: string; file?: string; url?: string });
		if (!res.ok) {
			saveError =
				(data as { error?: string }).error || `保存失败（HTTP ${res.status}）`;
			return null;
		}
		justSavedFile = (data as { file?: string }).file ?? "";
		// 线上模式保存即提交，响应里带 commit 链接
		justSavedUrl = (data as { url?: string }).url ?? "";
		if (stayInEditor) {
			// 上传前静默保存：留在编辑器展示上传结果，并把后续保存切为更新模式
			if (justSavedFile) editingFile = justSavedFile;
		} else {
			await loadList();
		}
		return justSavedFile || null;
	} catch {
		saveError =
			mode === "deployed"
				? "保存失败：无法连接写作服务，请重试"
				: "保存失败：无法连接本地写作服务（请确认 npm run dev 正在运行）";
		return null;
	} finally {
		saving = false;
	}
}

// 上传到 GitHub 仓库触发 Vercel 自动部署（仅本地 dev 模式；线上保存即提交）
async function publishPost() {
	if (mode === "deployed") return;
	const repo = repoInput.trim();
	if (!repoValid || publishing) return;
	publishing = true;
	publishError = "";
	publishUrl = "";
	try {
		const file = await savePost({ stayInEditor: true });
		if (!file) {
			if (!saveError) publishError = "请先完善标题、发布日期和文件名后再上传";
			return;
		}
		const res = await fetch("/api/writing/publish/", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({ file, repo }),
		});
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		const data = await res
			.json()
			.catch(() => ({}) as { error?: string; url?: string });
		if (!res.ok) {
			publishError =
				(data as { error?: string }).error || `上传失败（HTTP ${res.status}）`;
			return;
		}
		publishUrl = (data as { url?: string }).url ?? "";
		localStorage.setItem(REPO_KEY, repo);
	} catch {
		publishError =
			"上传失败：无法连接本地写作服务（请确认 npm run dev 正在运行）";
	} finally {
		publishing = false;
	}
}

async function deletePost(item: PostItem) {
	if (!confirm(`确定删除《${item.title}》吗？此操作不可恢复。`)) return;
	listError = "";
	try {
		const res = await fetch(
			`/api/writing/posts/?file=${encodeURIComponent(item.file)}${repoQuery()}`,
			{ method: "DELETE", headers: authHeaders() },
		);
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		if (!res.ok) {
			const data = await res.json().catch(() => ({}) as { error?: string });
			listError = data.error || "删除失败，请重试";
			return;
		}
		await loadList();
	} catch {
		listError = "删除失败：无法连接写作服务";
	}
}

function handleKeydown(event: KeyboardEvent) {
	if (
		view === "editor" &&
		(event.ctrlKey || event.metaKey) &&
		event.key.toLowerCase() === "s"
	) {
		event.preventDefault();
		savePost();
	}
}

// --- 标签输入 ---
function addTag() {
	const t = tagInput.trim().replace(/^#/, "");
	if (t && !tags.includes(t)) tags = [...tags, t];
	tagInput = "";
}

function onTagKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === ",") {
		event.preventDefault();
		addTag();
	} else if (event.key === "Backspace" && tagInput === "" && tags.length > 0) {
		tags = tags.slice(0, -1);
	}
}

// --- 工具栏插入 ---
function refocusEditor(el: HTMLTextAreaElement, start: number, end: number) {
	requestAnimationFrame(() => {
		el.focus();
		el.setSelectionRange(start, end);
	});
}

function insertWrap(prefix: string, suffix: string, placeholder: string) {
	const el = editorEl;
	if (!el) return;
	const { selectionStart: s, selectionEnd: e, value } = el;
	const selected = value.slice(s, e) || placeholder;
	content = value.slice(0, s) + prefix + selected + suffix + value.slice(e);
	refocusEditor(el, s + prefix.length, s + prefix.length + selected.length);
}

function insertLinePrefix(prefix: string) {
	const el = editorEl;
	if (!el) return;
	const { selectionStart: s, selectionEnd: e, value } = el;
	const lineStart = value.lastIndexOf("\n", s - 1) + 1;
	const nextNl = value.indexOf("\n", e);
	const blockEnd = nextNl === -1 ? value.length : nextNl;
	const block = value.slice(lineStart, blockEnd);
	const newBlock = block
		.split("\n")
		.map((line) =>
			line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line,
		)
		.join("\n");
	content = value.slice(0, lineStart) + newBlock + value.slice(blockEnd);
	refocusEditor(el, lineStart, lineStart + newBlock.length);
}

function insertCodeBlock() {
	const el = editorEl;
	if (!el) return;
	const { selectionStart: s, selectionEnd: e, value } = el;
	const selected = value.slice(s, e) || "code";
	const snippet = "\n```ts\n" + selected + "\n```\n";
	content = value.slice(0, s) + snippet + value.slice(e);
	refocusEditor(el, s + snippet.length, s + snippet.length);
}

onMount(() => {
	// 恢复上次使用的仓库；没有记录时用页面传入的默认仓库
	repoInput = localStorage.getItem(REPO_KEY) || defaultRepo;
	// 会话恢复：token 是否有效由服务端在首次列表请求时校验，失效走 401 → 登录页
	if (sessionStorage.getItem(AUTH_KEY)) {
		loadList();
	}
});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="mx-auto w-full max-w-4xl">
	{#if view === "login"}
		<!-- 密码门 -->
		<div class="mx-auto mt-10 max-w-sm rounded-xl border border-black/15 px-8 py-10 text-center dark:border-white/15">
			<div
				class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/80"
			>
				<Lock size={24} />
			</div>
			<h1 class="mb-1 text-2xl font-bold">写作空间</h1>
			<p class="mb-7 text-sm text-black/50 dark:text-white/50">站长专用，请输入密码进入</p>
			<form onsubmit={handleLogin}>
				<input
					type="password"
					class="ws-input mb-3 text-center"
					placeholder="密码"
					bind:value={password}
					autocomplete="current-password"
				/>
				{#if loginError}
					<p class="ws-field-error mb-3">{loginError}</p>
				{/if}
				<button
					type="submit"
					disabled={loggingIn}
					class="flex h-10 w-full items-center justify-center rounded-lg bg-black/5 font-bold transition hover:bg-black/10 hover:text-(--primary) disabled:cursor-not-allowed disabled:text-black/30 dark:bg-white/10 dark:hover:bg-white/15 dark:disabled:text-white/30"
				>
					{loggingIn ? "验证中…" : "进入写作空间"}
				</button>
			</form>
		</div>
	{:else if view === "offline"}
		<!-- 静态部署提示 -->
		<div class="mx-auto mt-10 max-w-md rounded-xl border border-black/15 px-8 py-12 text-center dark:border-white/15">
			<div
				class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-black/5 text-black/70 dark:bg-white/10 dark:text-(--primary)"
			>
				<CloudOff size={26} />
			</div>
			<h1 class="mb-3 text-xl font-bold">当前无法写作</h1>
			<p class="mb-2 text-sm text-black/60 dark:text-white/60">
				当前站点没有检测到写作接口。
			</p>
			<p class="mb-7 text-sm text-black/60 dark:text-white/60">
				本地使用：在博客目录运行
				<code class="rounded bg-black/8 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">npm run dev</code>
				后访问本地地址；线上使用：博客需部署在 Vercel（会自动带上写作接口），并在项目环境变量中配置
				<code class="rounded bg-black/8 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">WRITING_PASSWORD</code>
				与
				<code class="rounded bg-black/8 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">GITHUB_TOKEN</code>。
			</p>
			<a
				href="/"
				class="mx-auto flex h-10 w-full max-w-40 items-center justify-center rounded-lg bg-black/5 font-bold no-underline transition hover:bg-black/10 hover:text-(--primary) dark:bg-white/10 dark:hover:bg-white/15"
			>
				返回首页
			</a>
		</div>
	{:else if view === "list"}
		<!-- 我的文章 -->
		<div class="card-base px-5 py-6 md:px-8">
			<div class="mb-5 flex flex-wrap items-center gap-3">
				<div class="flex-1">
					<h1 class="text-2xl font-bold">我的文章</h1>
					<p class="mt-1 text-sm text-black/50 dark:text-white/50">
						共 {posts.length} 篇 · 发布后立即出现在站上
					</p>
				</div>
				<button
					class="btn-regular h-10 rounded-lg px-5 font-bold"
					onclick={openCreate}
				>
					<span class="inline-flex items-center gap-2"><ListPlus size={17} /> 新建文章</span>
				</button>
				<button
					class="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-black/55 transition hover:text-(--primary) dark:text-white/55"
					onclick={logout}
					title="退出登录"
				>
					<LogOut size={15} /> 退出
				</button>
			</div>

			{#if justSavedFile}
				<p
					class="mb-4 rounded-lg bg-(--btn-regular-bg) px-4 py-2.5 text-sm text-(--btn-content) dark:text-white/85"
				>
					已保存：{justSavedFile}
					{#if justSavedUrl}
						·
						<a
							href={justSavedUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="underline underline-offset-2"
						>
							查看提交
						</a>（Vercel 构建约 2-3 分钟后生效）
					{:else if mode === "dev"}
						（可在站上即时预览）
					{/if}
				</p>
			{/if}
			{#if listError}
				<p class="ws-field-error mb-4">{listError}</p>
			{/if}

			{#if listLoading}
				<p class="py-10 text-center text-sm text-black/45 dark:text-white/45">加载中…</p>
			{:else if posts.length === 0}
				<p class="py-10 text-center text-sm text-black/45 dark:text-white/45">
					还没有文章，点右上角「新建文章」开始写作吧。
				</p>
			{:else}
				<ul>
					{#each posts as item (item.file)}
						<li class="ws-row">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate font-medium">{item.title}</span>
									{#if item.draft}
										<span class="ws-badge">草稿</span>
									{/if}
								</div>
								<div
									class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-black/45 dark:text-white/45"
								>
									<span>{item.published || "—"}</span>
									{#if item.category}<span>· {item.category}</span>{/if}
									{#if item.tags.length > 0}<span>· {item.tags.join(" / ")}</span>{/if}
								</div>
							</div>
							<div class="flex shrink-0 gap-1">
								<button class="ws-action" onclick={() => openEdit(item)} title="编辑">
									<Pencil size={15} />
								</button>
								<button
									class="ws-action ws-action--danger"
									onclick={() => deletePost(item)}
									title="删除"
								>
									<Trash2 size={15} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{:else if view === "editor"}
		<!-- 编辑器 -->
		<div class="card-base mb-4 px-5 py-6 md:px-8">
			<div class="mb-5 flex items-center justify-between">
				<h1 class="text-xl font-bold">{editingFile ? "编辑文章" : "新建文章"}</h1>
				{#if editingFile}
					<span class="font-mono text-xs text-black/40 dark:text-white/40">{editingFile}</span>
				{/if}
			</div>

			<div class="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
				<label class="block md:col-span-2">
					<span class="ws-label">标题<span class="ws-required">*</span></span>
					<input
						class="ws-input"
						bind:value={form.title}
						placeholder="文章标题"
						maxlength="100"
					/>
				</label>

				<label class="block">
					<span class="ws-label">文件名 slug<span class="ws-required">*</span></span>
					<input
						class="ws-input"
						bind:value={form.slug}
						oninput={() => (slugTouched = true)}
						placeholder="post-slug"
						disabled={!!editingFile}
					/>
					{#if slugConflict}
						<span class="ws-field-error block">同名文件已存在，请换个文件名</span>
					{:else}
						<span class="ws-field-hint">保存为 src/content/posts/{form.slug || "…"}.md</span>
					{/if}
				</label>

				<label class="block">
					<span class="ws-label">分类</span>
					<input
						class="ws-input"
						bind:value={form.category}
						placeholder="如：学习文档"
						list="ws-categories"
					/>
					<datalist id="ws-categories">
						{#each allCategories as c (c)}<option value={c} />{/each}
					</datalist>
				</label>

				<div>
					<span class="ws-label">标签</span>
					<div class="ws-chips">
						{#each tags as tag, i (tag)}
							<span class="ws-chip">
								{tag}
								<button type="button" onclick={() => (tags = tags.filter((_, j) => j !== i))} aria-label="移除标签 {tag}">
									<X size={12} />
								</button>
							</span>
						{/each}
						<input
							class="ws-chip-input"
							bind:value={tagInput}
							onkeydown={onTagKeydown}
							onblur={addTag}
							placeholder="输入后回车添加"
							list="ws-tags"
						/>
						<datalist id="ws-tags">
							{#each allTags as t (t)}<option value={t} />{/each}
						</datalist>
					</div>
					<span class="ws-field-hint">支持中英文标签，回车或逗号添加</span>
				</div>

				<div class="grid grid-cols-2 gap-x-3">
					<label class="block">
						<span class="ws-label">发布日期<span class="ws-required">*</span></span>
						<input type="date" class="ws-input" bind:value={form.published} />
					</label>
					<label class="block">
						<span class="ws-label">更新日期</span>
						<input type="date" class="ws-input" bind:value={form.updated} />
					</label>
				</div>

				<label class="block">
					<span class="ws-label">封面图路径</span>
					<input
						class="ws-input"
						bind:value={form.image}
						placeholder="./assets/{form.slug || "your-slug"}.webp（留空用随机封面）"
					/>
				</label>

				<label class="block md:col-span-2">
					<span class="ws-label">摘要</span>
					<textarea
						class="ws-textarea"
						bind:value={form.description}
						placeholder="显示在文章列表与卡片上的一句话简介"
						maxlength="300"
					></textarea>
				</label>

				<label class="flex items-center gap-2.5 select-none">
					<input type="checkbox" class="ws-checkbox" bind:checked={form.draft} />
					<span class="text-sm">存为草稿（仅本地可见，构建后不发布）</span>
				</label>
			</div>
		</div>

		<div class="card-base px-5 py-6 md:px-8">
			<div class="ws-toolbar">
				<button class="ws-tool" onclick={() => insertLinePrefix("## ")} title="二级标题">
					<Heading2 size={17} />
				</button>
				<button class="ws-tool" onclick={() => insertLinePrefix("### ")} title="三级标题">
					<Heading3 size={17} />
				</button>
				<button class="ws-tool" onclick={() => insertWrap("**", "**", "粗体文本")} title="粗体">
					<Bold size={16} />
				</button>
				<button class="ws-tool" onclick={() => insertWrap("*", "*", "斜体文本")} title="斜体">
					<Italic size={16} />
				</button>
				<button class="ws-tool" onclick={() => insertLinePrefix("> ")} title="引用">
					<Quote size={16} />
				</button>
				<button class="ws-tool" onclick={() => insertLinePrefix("- ")} title="无序列表">
					<List size={17} />
				</button>
				<button class="ws-tool" onclick={() => insertLinePrefix("1. ")} title="有序列表">
					<ListOrdered size={17} />
				</button>
				<button class="ws-tool" onclick={() => insertWrap("`", "`", "code")} title="行内代码">
					<Code size={16} />
				</button>
				<button class="ws-tool" onclick={insertCodeBlock} title="代码块">
					<SquareCode size={16} />
				</button>
				<button
					class="ws-tool"
					onclick={() => insertWrap("[", "](https://)", "链接文字")}
					title="链接"
				>
					<Link2 size={16} />
				</button>
				<button
					class="ws-tool"
					onclick={() => insertWrap("![", "](./image/" + (form.slug || "slug") + ".assets/xxx.webp)", "图片描述")}
					title="图片（请先把图片放到对应目录）"
				>
					<ImageIcon size={16} />
				</button>

				<div class="flex-1"></div>

				<!-- 移动端单栏切换 -->
				<div class="flex gap-1 md:hidden">
					<button
						class="btn-plain flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs {mobilePane === 'edit' ? 'text-(--primary)' : ''}"
						onclick={() => (mobilePane = "edit")}
					>
						<Pencil size={13} /> 编辑
					</button>
					<button
						class="btn-plain flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs {mobilePane === 'preview' ? 'text-(--primary)' : ''}"
						onclick={() => (mobilePane = "preview")}
					>
						<Eye size={13} /> 预览
					</button>
				</div>
			</div>

			<div class="ws-body-grid">
				<div class="ws-pane is-active" class:is-active={mobilePane === "edit"} data-pane="edit">
					<textarea
						class="ws-editor"
						bind:this={editorEl}
						bind:value={content}
						placeholder="用 Markdown 书写正文…（Ctrl / Cmd + S 快速保存）"
						spellcheck="false"
					></textarea>
				</div>
				<div
					class="ws-pane is-active"
					class:is-active={mobilePane === "preview"}
					data-pane="preview"
				>
					<div class="ws-preview">
						{#if content.trim()}
							{@html previewHtml}
						{:else}
							<p class="text-sm text-black/35 dark:text-white/35">左侧输入即可实时预览</p>
						{/if}
					</div>
				</div>
			</div>

			<div class="mt-5">
				<div class="flex flex-wrap items-center gap-3">
					<input
						type="text"
						class="ws-input w-56 shrink-0 font-mono text-xs"
						bind:value={repoInput}
						placeholder="anywhere-labs/dsh-desktop"
						aria-label="目标仓库（用户名/仓库名）"
						title={mode === "deployed"
							? "保存/删除将提交到该仓库，留空用站点仓库"
							: "「上传 GitHub」的目标仓库（用户名/仓库名）"}
					/>
					{#if mode !== "deployed"}
						<button
							class="btn-regular flex h-10 items-center gap-2 rounded-lg px-5 font-bold disabled:cursor-not-allowed disabled:opacity-50"
							onclick={publishPost}
							disabled={!canSave || saving || publishing || !repoValid}
							title={publishButtonTitle}
						>
							<CloudUpload size={16} />
							{publishing ? "上传中…" : "上传 GitHub"}
						</button>
					{/if}
					<button
						class="btn-regular flex h-10 items-center gap-2 rounded-lg px-6 font-bold disabled:cursor-not-allowed disabled:opacity-50"
						onclick={savePost}
						disabled={!canSave || saving}
						title={mode === "deployed"
							? "保存后将直接提交到 GitHub 仓库，Vercel 构建约 2-3 分钟后生效"
							: ""}
					>
						<Save size={16} />
						{saving ? "保存中…" : editingFile ? "保存修改" : form.draft ? "保存草稿" : "发布文章"}
					</button>
					<button
						class="flex h-10 items-center rounded-lg px-4 text-sm text-black/55 transition hover:text-(--primary) dark:text-white/55"
						onclick={() => loadList()}
					>
						取消返回
					</button>
				</div>

				{#if saveError}
					<p class="ws-field-error mt-3">{saveError}</p>
				{:else if publishError}
					<p class="ws-field-error mt-3">{publishError}</p>
				{:else if publishUrl}
					<p class="ws-field-hint mt-3">
						已上传到 <span class="font-mono">{repoInput.trim()}</span> ·
						<a
							href={publishUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="text-(--primary) underline underline-offset-2"
						>
							查看提交
						</a>（Vercel 将自动部署）
					</p>
				{:else if justSavedUrl}
					<p class="ws-field-hint mt-3">
						已提交到
						<span class="font-mono">{repoInput.trim() || "站点仓库"}</span> ·
						<a
							href={justSavedUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="text-(--primary) underline underline-offset-2"
						>
							查看提交
						</a>（Vercel 构建约 2-3 分钟后生效）
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
