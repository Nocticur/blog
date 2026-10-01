<script lang="ts">
import {
	Bold,
	CloudOff,
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
import { sanitizeMarkdownHtml } from "@/utils/admin-markdown-preview";
import { buildPostMutation, getTabBufferKey, loadLocalBuffer, postDeleteUrl, removeLocalBuffer, saveLocalBuffer, type PostEditorState, type PostIntent } from "@/utils/admin-editor-state";
import "@/styles/components/writing-studio.css";

interface PostItem {
	file: string;
	version: string;
	title: string;
	published: string;
	draft: boolean;
	category: string;
	tags: string[];
	description: string;
}

interface PostDetail {
	file: string;
	version: string;
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

let { defaultRepo = "", authenticated = false, isActive = true, embedded = false, onsessionexpired }: { defaultRepo?: string; authenticated?: boolean; isActive?: boolean; embedded?: boolean; onsessionexpired?: () => void } = $props();

// --- 会话与视图状态 ---
const bufferKey = () => getTabBufferKey(sessionStorage, "posts:editor");
type View = "login" | "list" | "editor" | "offline";
let view = $state<View>("login");
let password = $state("");
let loginError = $state("");
let loggingIn = $state(false);
let mounted = $state(false);
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
let editingVersion = $state("");
let originalDraft = $state(true);
let bufferEnabled = $state(false);
let baseline = $state("");
let bufferStatus = $state("");
let conflict = $state(false);
let repositoryCopy = $state<PostDetail | null>(null);
let previousLocalCopy = $state("");
let slugTouched = $state(false);
let form = $state({
	title: "",
	slug: "",
	published: "",
	updated: "",
	description: "",
	image: "",
	category: "",
	draft: true,
});
let tags = $state<string[]>([]);
let tagInput = $state("");
let content = $state("");
let saving = $state(false);
let saveError = $state("");
// --- 目标仓库（仅 deployed 模式只读展示，由服务端自动解析）---
let repoInput = $state("");
// --- 列表视图：published 我的文章 / drafts 草稿箱 ---
let listTab = $state<"published" | "drafts">("published");
let mobilePane = $state<"edit" | "preview">("edit");
let editorEl: HTMLTextAreaElement | undefined = $state();
let coverFileInput: HTMLInputElement | undefined = $state();
let uploadingCover = $state(false);
let coverUploadError = $state("");

const previewHtml = $derived(sanitizeMarkdownHtml(marked.parse(content) as string));
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
const publishedPosts = $derived(posts.filter((p) => !p.draft));
const draftPosts = $derived(posts.filter((p) => p.draft));
const visiblePosts = $derived(
	listTab === "drafts" ? draftPosts : publishedPosts,
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

$effect(() => {
	if (mounted && embedded && authenticated && isActive && view === "login" && !listLoading) {
		void initializeWorkspace();
	}
});

async function initializeWorkspace() {
	await loadList();
	if (view === "list") restoreBuffer();
}

// --- 登录 ---
async function logout() {
	persistNow();
	const res = await fetch("/api/writing/logout/", { method: "POST" }).catch(() => null);
	if (!res?.ok) { listError = "退出失败，请重试"; return; }
	password = "";
	loginError = "";
	view = "login";
	onsessionexpired?.();
}

function handleSessionExpired() {
	persistNow();
	password = "";
	if (!embedded) view = "login";
	loginError = "登录已过期，请重新输入密码";
	if (embedded) saveError = "登录已过期，输入仍保留；请重新登录后手动保存。";
	onsessionexpired?.();
}

// 会话由服务端 HttpOnly Cookie 管理，前端不保存凭据。
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
			mode?: string;
			repo?: string;
			tokenReady?: boolean;
		};
		mode = auth.mode === "deployed" ? "deployed" : "dev";
		if (typeof auth.tokenReady === "boolean")
			githubTokenReady = auth.tokenReady;
		// 仓库只由服务端解析并下发，前端只读展示
		repoInput = auth.repo ?? "";
		password = "";
		await loadList();
		restoreBuffer();
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
	};
}

function editorState(): PostEditorState {
	return { file: editingFile, version: editingVersion, originalDraft, form: { ...form }, tags: [...tags], content };
}

function persistNow() {
	if (!bufferEnabled || JSON.stringify(editorState()) === baseline) return;
	try {
		const result = saveLocalBuffer(localStorage, bufferKey(), { ...editorState(), previousLocalCopy });
		bufferStatus = result.ok ? "已暂存到本机" : result.error;
	} catch { bufferStatus = "本机暂存失败，请保留当前页面或复制正文。"; }
}

$effect(() => {
	// Explicit dependencies also capture changes while the session has expired.
	JSON.stringify(editorState());
	if (bufferEnabled) persistNow();
});

function restoreBuffer(expectedFile?: string | null) {
	try {
		const restored = loadLocalBuffer<PostEditorState & { previousLocalCopy?: string }>(localStorage, bufferKey());
		if (restored.error) { bufferStatus = restored.error; return; }
		const saved = restored.value;
		if (!saved || typeof saved.content !== "string" || typeof saved.version !== "string" || typeof saved.originalDraft !== "boolean" || !saved.form || !Array.isArray(saved.tags) || (expectedFile !== undefined && saved.file !== expectedFile)) return;
		editingFile = saved.file; editingVersion = saved.version; originalDraft = saved.originalDraft;
		form = { ...form, ...saved.form } as typeof form; tags = [...saved.tags]; content = saved.content;
		previousLocalCopy = typeof saved.previousLocalCopy === "string" ? saved.previousLocalCopy : "";
		slugTouched = true; bufferEnabled = true; baseline = "restored";
		bufferStatus = "已恢复本机暂存；保存时仍校验最初读取的版本";
		view = "editor";
	} catch { bufferStatus = "无法读取本机暂存，请检查浏览器存储权限。"; }
}

function applyRepository(data: PostDetail) {
	const fm = data.frontmatter;
	editingFile = data.file; editingVersion = data.version; originalDraft = fm.draft;
	slugTouched = true;
	form = { title: fm.title, slug: data.file.replace(/\.(md|mdx)$/i, ""), published: fm.published, updated: fm.updated, description: fm.description, image: fm.image, category: fm.category, draft: fm.draft };
	tags = [...fm.tags]; tagInput = ""; content = data.content;
	baseline = JSON.stringify(editorState()); bufferEnabled = true; bufferStatus = "";
}

async function compareRepository() {
	if (!editingFile) return;
	try {
		const res = await fetch(`/api/writing/posts/?file=${encodeURIComponent(editingFile)}`, { cache: "no-store" });
		if (res.status === 401) { handleSessionExpired(); return; }
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		repositoryCopy = await res.json();
	} catch { saveError = "读取仓库版本失败，当前输入已保留，请重试。"; }
}

function useRepositoryCopy() {
	if (!repositoryCopy || !confirm("将仓库版作为新的编辑基础？当前本机内容将保留在下方比较区，请手动合并后再保存。")) return;
	previousLocalCopy = JSON.stringify(editorState(), null, 2);
	applyRepository(repositoryCopy); conflict = false; saveError = "";
	baseline = "merged"; persistNow();
}

async function loadList() {
	listLoading = true;
	listError = "";
	try {
		// 注意：站点 trailingSlash 为 always，Astro 会在无尾斜杠 URL 上
		// 先于 dev middleware 返回 404，因此 API 路径统一带尾斜杠
		const res = await fetch(`/api/writing/posts/?_=${Date.now()}`, {
			headers: authHeaders(),
		});
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		const data = await res.json().catch(() => ({}) as { error?: string });
		if (!res.ok) {
			listError = data.error || `加载文章失败（HTTP ${res.status}）`;
			view = "list";
			return;
		}
		posts = data.posts ?? [];
		// 会话恢复（不经过登录）时，从列表接口拿运行模式与服务端信息
		mode = data.mode === "deployed" ? "deployed" : "dev";
		if (typeof data.tokenReady === "boolean")
			githubTokenReady = data.tokenReady;
		repoInput = data.repo ?? "";
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
			`/api/writing/posts/?file=${encodeURIComponent(item.file)}`,
			{
				headers: authHeaders(),
			},
		);
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data: PostDetail = await res.json();
		applyRepository(data);
		saveError = "";
		coverUploadError = "";
		mobilePane = "edit";
		view = "editor";
		conflict = false; repositoryCopy = null; previousLocalCopy = "";
		restoreBuffer(data.file);
	} catch {
		listError = "读取文章失败，请重试";
	}
}

function openCreate() {
	editingFile = null;
	editingVersion = ""; originalDraft = true;
	slugTouched = false;
	form = {
		title: "",
		slug: "",
		published: todayStr(),
		updated: "",
		description: "",
		image: "",
		category: "",
		draft: true,
	};
	tags = [];
	tagInput = "";
	content = "";
	saveError = "";
	coverUploadError = "";
	justSavedFile = "";
	justSavedUrl = "";
	mobilePane = "edit";
	view = "editor";
	conflict = false; repositoryCopy = null; previousLocalCopy = "";
	baseline = ""; bufferEnabled = true;
	restoreBuffer(null);
}

async function uploadCover(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file || uploadingCover) return;
	if (file.size > 3 * 1024 * 1024) { coverUploadError = "图片不能超过 3 MiB"; input.value = ""; return; }

	coverUploadError = "";
	uploadingCover = true;
	try {
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(new Error("read failed"));
			reader.readAsDataURL(file);
		});
		const res = await fetch("/api/writing/images/", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({ slug: form.slug, dataUrl }),
		});
		if (res.status === 401) {
			handleSessionExpired();
			return;
		}
		const data = await res
			.json()
			.catch(() => ({}) as { error?: string; image?: string });
		if (!res.ok) {
			coverUploadError = data.error || `封面上传失败（HTTP ${res.status}）`;
			return;
		}
		form.image = data.image ?? "";
	} catch {
		coverUploadError = "封面上传失败，请重试";
	} finally {
		uploadingCover = false;
		input.value = "";
	}
}

async function savePost(intent: PostIntent = "save"): Promise<string | null> {
	if (!canSave || saving) return null;
	saving = true;
	saveError = "";
	coverUploadError = "";
	try {
		persistNow();
		const body = buildPostMutation(editorState(), intent);
		const res = await fetch("/api/writing/posts/", {
			method: editingFile ? "PUT" : "POST",
			headers: authHeaders(),
			body: JSON.stringify(body),
		});
		if (res.status === 401) {
			handleSessionExpired();
			return null;
		}
		const data = await res
			.json()
			.catch(() => ({}) as { error?: string; file?: string; url?: string });
		if (!res.ok) {
			conflict = res.status === 409;
			saveError =
				(data as { error?: string }).error || `保存失败（HTTP ${res.status}）`;
			return null;
		}
		justSavedFile = (data as { file?: string }).file ?? "";
		// 线上模式保存即提交，响应里带 commit 链接
		justSavedUrl = (data as { url?: string }).url ?? "";
		bufferEnabled = false; baseline = JSON.stringify(editorState());
		try { const cleared = removeLocalBuffer(localStorage, bufferKey()); bufferStatus = cleared.ok ? "" : cleared.error; } catch { bufferStatus = "本机暂存无法清除，请核对仓库内容。"; }
		// 发布的文章回到「我的文章」，草稿留在草稿箱
		listTab = body.draft ? "drafts" : "published";
		await loadList();
		return justSavedFile || null;
	} catch (error) {
		saveError =
			error instanceof Error && error.message.includes("版本") ? error.message : mode === "deployed"
				? "保存失败：无法连接写作服务，请重试"
				: "保存失败：无法连接本地写作服务（请确认 npm run dev 正在运行）";
		return null;
	} finally {
		saving = false;
	}
}

async function deletePost(item: PostItem) {
	if (!confirm(`确定删除《${item.title}》吗？此操作不可恢复。`)) return;
	listError = "";
	try {
		const res = await fetch(
			postDeleteUrl(item.file, item.version),
			{
				method: "DELETE",
				headers: authHeaders(),
			},
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
		isActive &&
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
	mounted = true;
	// 仓库由服务端解析并只读展示，这里先用页面传入的默认仓库占位
	repoInput = defaultRepo;
	const start = async () => {
		try {
			if (!authenticated) {
				const res = await fetch("/api/writing/session/", { cache: "no-store" });
				if (!res.ok) return;
			}
			await initializeWorkspace();
		} catch { loginError = "无法连接管理服务，请重试。"; }
	};
	if (!embedded) void start();
	window.addEventListener("beforeunload", persistNow);
	return () => { persistNow(); window.removeEventListener("beforeunload", persistNow); };
});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="mx-auto w-full max-w-4xl">
	{#if bufferStatus}<p role="status" class="mb-4 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">{bufferStatus}</p>{/if}
	{#if view === "login"}
		{#if embedded}
			<p role="status" class="py-8 text-sm text-black/55 dark:text-white/55">正在读取文章…</p>
		{:else}
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
		{/if}
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
					<h1 class="text-2xl font-bold">
						{listTab === "drafts" ? "草稿箱" : "我的文章"}
					</h1>
					<p class="mt-1 text-sm text-black/50 dark:text-white/50">
						{#if listTab === "drafts"}
							共 {draftPosts.length} 篇 · 保存草稿后统一在这里管理
						{:else}
							共 {publishedPosts.length} 篇 · 线上更新将在构建部署后生效
						{/if}
					</p>
				</div>
				{#if listTab === "drafts"}
					<button
						class="flex h-10 items-center rounded-lg px-4 text-sm text-black/55 transition hover:text-(--primary) dark:text-white/55"
						onclick={() => (listTab = "published")}
					>
						返回我的文章
					</button>
				{:else}
					<button
						class="flex h-10 items-center gap-2 rounded-lg px-4 text-sm text-black/55 transition hover:text-(--primary) dark:text-white/55"
						onclick={() => (listTab = "drafts")}
						title="查看和管理草稿"
					>
						草稿箱
						{#if draftPosts.length > 0}
							<span
								class="inline-flex min-w-5 items-center justify-center rounded-full bg-black/8 px-1.5 text-xs font-bold dark:bg-white/15"
							>
								{draftPosts.length}
							</span>
						{/if}
					</button>
				{/if}
				<button
					class="btn-regular h-10 rounded-lg px-5 font-bold"
					onclick={openCreate}
				>
					<span class="inline-flex items-center gap-2"><ListPlus size={17} /> 新建文章</span>
				</button>
				{#if !embedded}<button
					class="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-black/55 transition hover:text-(--primary) dark:text-white/55"
					onclick={logout}
					title="退出登录"
				>
					<LogOut size={15} /> 退出
				</button>{/if}
			</div>

			{#if justSavedFile}
				<p
					class="mb-4 rounded-lg bg-(--btn-regular-bg) px-4 py-2.5 text-sm text-(--btn-content) dark:text-white/85"
				>
					{mode === "deployed" ? "已保存到仓库" : "已保存到本地文件"}：{justSavedFile}
					{#if justSavedUrl}
						·
						<a
							href={justSavedUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="underline underline-offset-2"
						>
							查看提交
						</a>（等待构建部署）
					{:else if mode === "dev"}
						（可在站上即时预览）
					{/if}
				</p>
			{/if}
			{#if listError}
				<p class="ws-field-error mb-4">{listError}</p>
			{/if}
			{#if mode === "deployed" && !githubTokenReady}
				<p
					class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200"
				>
					服务端未配置 GITHUB_TOKEN，无法提交到 GitHub。请在 Vercel 项目 Settings →
					Environment Variables 中添加后重新部署。
				</p>
			{/if}

			{#if listLoading}
				<p class="py-10 text-center text-sm text-black/45 dark:text-white/45">加载中…</p>
			{:else if visiblePosts.length === 0}
				<p class="py-10 text-center text-sm text-black/45 dark:text-white/45">
					{#if listTab === "drafts"}
						暂无草稿，新建文章默认保存为草稿。
					{:else}
						还没有文章，点右上角「新建文章」开始写作吧。
					{/if}
				</p>
			{:else}
				<ul>
					{#each visiblePosts as item (item.file)}
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
		<fieldset disabled={saving} class="m-0 min-w-0 border-0 p-0">
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
						{#each allCategories as c (c)}<option value={c}></option>{/each}
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
							{#each allTags as t (t)}<option value={t}></option>{/each}
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
						placeholder="在线图片链接"
					/>
					<input
						bind:this={coverFileInput}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
						class="sr-only"
						aria-label="本地上传封面图"
						onchange={uploadCover}
					/>
					<button
						type="button"
						class="ws-upload-link mt-2"
						disabled={uploadingCover || !form.slug}
						onclick={() => coverFileInput?.click()}
					>
						{uploadingCover ? "上传中…" : "本地上传"}
					</button>
					{#if coverUploadError}
						<span class="ws-field-error block">{coverUploadError}</span>
					{/if}
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

				<p class="text-sm md:col-span-2">{originalDraft ? "当前为草稿；点击“发布文章”后才公开。" : "当前已发布；编辑自动暂存到本机，点击“更新发布”后才提交。"}</p>
			</div>
		</div>

		<div class="card-base px-5 py-6 md:px-8">
			{#if editingFile?.endsWith(".mdx")}<p class="ws-field-hint mb-3">MDX 支持源码编辑。预览不执行组件代码，最终效果以构建结果为准。</p>{/if}
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
					{#if mode === "deployed"}
						<span
							class="shrink-0 border-0 font-mono text-xs text-black/55 dark:text-white/55"
							title="目标仓库由服务端自动解析，不可手动更改"
						>
							{repoInput.trim() || "站点仓库"}
						</span>
					{/if}
					<button
						class="btn-regular flex h-10 items-center gap-2 rounded-lg px-6 font-bold disabled:cursor-not-allowed disabled:opacity-50"
						onclick={() => savePost()}
						disabled={!canSave || saving}
						title={mode === "deployed"
							? "保存后提交到 GitHub 仓库，等待构建部署"
							: ""}
					>
						<Save size={16} />
						{saving ? "保存中…" : originalDraft ? "保存草稿" : "更新发布"}
					</button>
					{#if originalDraft}
						<button class="btn-regular h-10 rounded-lg px-4" disabled={!canSave || saving} onclick={() => savePost("publish")}>发布文章</button>
					{:else}
						<button class="ws-action h-10 px-4" disabled={saving} onclick={() => { if (confirm("确认撤下这篇文章并保存为草稿？")) void savePost("withdraw"); }}>撤下文章</button>
					{/if}
					<button
						class="flex h-10 items-center rounded-lg px-4 text-sm text-black/55 transition hover:text-(--primary) dark:text-white/55"
						onclick={() => loadList()}
					>
						取消返回
					</button>
				</div>

				{#if saveError}
					<p class="ws-field-error mt-3">{saveError}</p>
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
						</a>（等待构建部署）
					</p>
				{/if}
				{#if conflict}
					<div class="mt-4 rounded-lg border border-amber-500/40 p-4">
						<p class="text-sm">仓库内容已被其他页面修改。当前输入仍保留，先读取并比较后手动合并。</p>
						<button class="ws-action mt-2" onclick={compareRepository}>读取仓库版进行比较</button>
						{#if repositoryCopy}
							<label class="block text-sm mt-3">仓库版本（只读）<textarea readonly class="ws-textarea min-h-48 font-mono" value={JSON.stringify(repositoryCopy, null, 2)}></textarea></label>
							<button class="ws-action mt-2" onclick={useRepositoryCopy}>以仓库版为基础合并</button>
						{/if}
					</div>
				{/if}
				{#if previousLocalCopy}
					<label class="block text-sm mt-4">重新读取前的本机内容（只读，供手动合并）<textarea readonly class="ws-textarea min-h-48 font-mono" value={previousLocalCopy}></textarea></label>
				{/if}
			</div>
		</div>
		</fieldset>
	{/if}
</div>
