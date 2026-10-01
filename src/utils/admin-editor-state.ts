export type BufferStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type BufferResult = { ok: true } | { ok: false; error: string };
const PREFIX = "blog-admin-buffer:v1:";
const tabScopes = new WeakMap<BufferStorage, string>();
type TabContext = { navigationType?: string; buffers: BufferStorage & Pick<Storage, "key" | "length"> };

/** The session identifier is only a local editor scope, never an authentication credential. */
export function getTabBufferKey(tabStorage: BufferStorage, key: string, context?: TabContext): string {
	let scope = tabScopes.get(tabStorage);
	if (scope) return `${key}:tab:${scope}`;
	const previous = tabStorage.getItem("blog-admin-editor-tab");
	if (!context && typeof window !== "undefined") {
		const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
		context = { navigationType: navigation?.type, buffers: localStorage };
	}
	// A normal navigation may be a duplicated tab with copied sessionStorage.
	// Preserve recovery by copying its buffer; a reload keeps the existing scope.
	scope = !previous || context?.navigationType === "navigate" ? globalThis.crypto.randomUUID() : previous;
	if (previous && scope !== previous && context) {
		const buffers = context.buffers;
		const keys = Array.from({ length: buffers.length }, (_, index) => buffers.key(index));
		for (const oldKey of keys) {
			if (!oldKey?.startsWith(PREFIX) || !oldKey.endsWith(`:tab:${previous}`)) continue;
			const value = buffers.getItem(oldKey);
			if (value !== null) buffers.setItem(oldKey.slice(0, -previous.length) + scope, value);
		}
	}
	tabStorage.setItem("blog-admin-editor-tab", scope);
	tabScopes.set(tabStorage, scope);
	return `${key}:tab:${scope}`;
}

export function saveLocalBuffer<T>(storage: BufferStorage, key: string, value: T): BufferResult {
	try {
		storage.setItem(PREFIX + key, JSON.stringify({ schema: 1, value }));
		return { ok: true };
	} catch {
		return { ok: false, error: "本机暂存失败，浏览器存储不可用或空间不足；请保留当前页面或复制正文。" };
	}
}

export function loadLocalBuffer<T>(storage: BufferStorage, key: string): { value: T | null; error?: string } {
	try {
		const raw = storage.getItem(PREFIX + key);
		if (raw === null) return { value: null };
		const buffer = JSON.parse(raw);
		if (buffer?.schema !== 1 || !("value" in buffer)) throw new Error("Invalid buffer");
		return { value: buffer.value as T };
	} catch {
		return { value: null, error: "无法读取本机暂存；当前输入仍保留，请复制正文后重试。" };
	}
}

export function removeLocalBuffer(storage: BufferStorage, key: string): BufferResult {
	try { storage.removeItem(PREFIX + key); return { ok: true }; }
	catch { return { ok: false, error: "本机暂存无法清除，重新打开时请核对仓库内容。" }; }
}

export interface PostEditorState {
	file: string | null;
	version: string;
	originalDraft: boolean;
	form: Record<string, unknown> & { draft: boolean };
	tags: string[];
	content: string;
}
export type PostIntent = "save" | "publish" | "withdraw";

/** A normal save never changes publication status; publication transitions are explicit. */
export function buildPostMutation(editor: PostEditorState, intent: PostIntent) {
	if (editor.file && !editor.version) throw new Error("缺少读取版本，请先重新读取文章后合并修改。");
	return {
		...editor.form,
		draft: intent === "publish" ? false : intent === "withdraw" ? true : editor.originalDraft,
		tags: editor.tags,
		content: editor.content,
		...(editor.file ? { file: editor.file, version: editor.version } : {}),
	};
}

export function postDeleteUrl(file: string, version: string): string {
	if (!version) throw new Error("缺少列表版本，请刷新列表后再删除。");
	return `/api/writing/posts/?${new URLSearchParams({ file, version })}`;
}
