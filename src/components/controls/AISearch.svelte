<script lang="ts">
import { marked } from "marked";
import { onMount, tick } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { aiSearchConfig } from "@/config";

interface Message {
	role: "user" | "assistant";
	content: string;
	refs?: { title: string; path: string; published?: string; excerpt: string }[];
	streaming?: boolean;
}

interface SessionMeta {
	id: string;
	title: string;
	updatedAt: number;
}

const STORAGE_SESSIONS_KEY = "ai-chat:sessions";
const STORAGE_SESSION_PREFIX = "ai-chat:session:";
const MAX_SESSIONS = 20;

let isOpen = $state(false);
let inputVal = $state("");
let messages = $state<Message[]>([]);
let isLoading = $state(false);
let messagesEl: HTMLDivElement;
let inputEl: HTMLInputElement;
let abortCtrl: AbortController | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let sessionId = $state("");
let sessionList = $state<SessionMeta[]>([]);
let showSessionList = $state(false);

function generateSessionId(): string {
	return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSessionTitle(msgs: Message[]): string {
	const firstUser = msgs.find((m) => m.role === "user");
	if (!firstUser) return "新对话";
	return firstUser.content.length > 20
		? `${firstUser.content.slice(0, 20)}...`
		: firstUser.content;
}

function loadSessionListFromStorage(): SessionMeta[] {
	try {
		const raw = localStorage.getItem(STORAGE_SESSIONS_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function saveSessionListToStorage(list: SessionMeta[]) {
	try {
		localStorage.setItem(STORAGE_SESSIONS_KEY, JSON.stringify(list));
	} catch {}
}

function saveCurrentSession() {
	if (!sessionId || messages.length === 0) return;
	if (messages.some((m) => m.streaming)) return;
	try {
		localStorage.setItem(
			STORAGE_SESSION_PREFIX + sessionId,
			JSON.stringify(messages),
		);
		const existing = sessionList.find((s) => s.id === sessionId);
		if (existing) {
			existing.title = getSessionTitle(messages);
			existing.updatedAt = Date.now();
		} else {
			sessionList.unshift({
				id: sessionId,
				title: getSessionTitle(messages),
				updatedAt: Date.now(),
			});
		}
		if (sessionList.length > MAX_SESSIONS) {
			const removed = sessionList.splice(MAX_SESSIONS);
			for (const s of removed) {
				try {
					localStorage.removeItem(STORAGE_SESSION_PREFIX + s.id);
				} catch {}
			}
		}
		sessionList = [...sessionList];
		saveSessionListToStorage(sessionList);
	} catch {}
}

function loadSessionMessages(id: string): Message[] {
	try {
		const raw = localStorage.getItem(STORAGE_SESSION_PREFIX + id);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function deleteSession(id: string) {
	try {
		localStorage.removeItem(STORAGE_SESSION_PREFIX + id);
	} catch {}
	sessionList = sessionList.filter((s) => s.id !== id);
	saveSessionListToStorage(sessionList);
	if (id === sessionId) {
		startNewSession();
	}
}

function startNewSession() {
	saveCurrentSession();
	sessionId = generateSessionId();
	messages = [];
	showSessionList = false;
}

function switchSession(id: string) {
	if (id === sessionId) {
		showSessionList = false;
		return;
	}
	saveCurrentSession();
	sessionId = id;
	messages = loadSessionMessages(id);
	showSessionList = false;
	scrollToBottom();
}

function formatTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60000) return "刚刚";
	if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
	return `${Math.floor(diff / 86400000)} 天前`;
}

export function toggle() {
	isOpen = !isOpen;
	if (isOpen) {
		tick().then(() => inputEl?.focus());
	}
}

function close() {
	isOpen = false;
}

function scrollToBottom() {
	tick().then(() => {
		if (messagesEl) {
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}
	});
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function isSafeUrl(value: string): boolean {
	const trimmed = value
		.trim()
		// biome-ignore lint/complexity/useRegexLiterals: avoids control-character ranges in regex literals.
		.replace(new RegExp("[\\u0000-\\u001F\\u007F\\s]+", "g"), "");
	return /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/|\?)/i.test(trimmed);
}

function sanitizeHtml(html: string): string {
	if (typeof document === "undefined") return escapeHtml(html);

	const blockedTags = new Set([
		"script",
		"style",
		"iframe",
		"object",
		"embed",
		"link",
		"meta",
		"form",
		"input",
		"button",
		"svg",
		"math",
	]);
	const allowedAttrs = new Set([
		"href",
		"src",
		"alt",
		"title",
		"class",
		"id",
		"target",
		"rel",
		"role",
		"aria-label",
		"aria-hidden",
	]);

	const template = document.createElement("template");
	template.innerHTML = html;
	const elements = Array.from(template.content.querySelectorAll("*"));

	for (const el of elements) {
		if (blockedTags.has(el.tagName.toLowerCase())) {
			el.remove();
			continue;
		}

		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			const value = attr.value;
			const isDataAttr = name.startsWith("data-");

			if (name.startsWith("on") || name === "style" || name === "srcdoc") {
				el.removeAttribute(attr.name);
				continue;
			}

			if (!allowedAttrs.has(name) && !isDataAttr) {
				el.removeAttribute(attr.name);
				continue;
			}

			if ((name === "href" || name === "src") && !isSafeUrl(value)) {
				el.removeAttribute(attr.name);
			}
		}

		if (
			el.tagName.toLowerCase() === "a" &&
			el.getAttribute("target") === "_blank"
		) {
			el.setAttribute("rel", "noopener noreferrer");
		}
	}

	return template.innerHTML;
}

function renderMd(text: string): string {
	try {
		return sanitizeHtml(marked.parse(text, { breaks: true }) as string);
	} catch {
		return escapeHtml(text);
	}
}

async function send() {
	const q = inputVal.trim();
	if (!q || isLoading) return;

	inputVal = "";
	messages = [...messages, { role: "user", content: q }];
	scrollToBottom();

	isLoading = true;
	abortCtrl = new AbortController();

	const aiIdx = messages.length;
	messages = [
		...messages,
		{ role: "assistant", content: "", streaming: true, refs: [] },
	];
	scrollToBottom();

	try {
		const history = messages
			.slice(0, -1)
			.slice(-6)
			.map((m) => ({ role: m.role, content: m.content }));

		const res = await fetch("/api/ai-chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ question: q, history, sessionId }),
			signal: abortCtrl.signal,
		});

		if (!res.ok) {
			let errMsg = `请求失败 (${res.status})`;
			try {
				const errBody = await res.json();
				if (errBody.error) errMsg = errBody.error;
			} catch {}
			throw new Error(errMsg);
		}

		reader = res.body?.getReader() ?? null;
		if (!reader) throw new Error("无法读取响应流");

		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				const json = line.slice(6);
				try {
					const data = JSON.parse(json);

					if (data.type === "chunk") {
						messages[aiIdx].content += data.text;
						messages = [...messages];
						scrollToBottom();
					} else if (data.type === "refs") {
						messages[aiIdx].refs = data.articles;
						messages = [...messages];
					} else if (data.type === "error") {
						messages[aiIdx].content += `\n\n> 错误：${data.error}`;
						messages = [...messages];
					} else if (data.type === "done") {
						// 流结束
					}
				} catch {
					// 忽略解析错误
				}
			}
		}
	} catch (err: unknown) {
		const e = err instanceof Error ? err : new Error(String(err));
		if (e.name === "AbortError") {
			messages[aiIdx].content += "\n\n> *(已取消)*";
		} else {
			messages[aiIdx].content = `抱歉，请求出错了：${e.message}。请稍后再试。`;
		}
		messages = [...messages];
	} finally {
		messages[aiIdx].streaming = false;
		messages = [...messages];
		isLoading = false;
		abortCtrl = null;
		reader = null;
		scrollToBottom();
		saveCurrentSession();
	}
}

function stop() {
	abortCtrl?.abort();
	reader?.cancel().catch(() => {});
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		send();
	}
	if (e.key === "Escape") {
		if (showSessionList) {
			showSessionList = false;
		} else {
			close();
		}
	}
}

function handleOverlayClick(e: MouseEvent) {
	if ((e.target as HTMLElement).classList.contains("ai-overlay")) {
		close();
	}
}

onMount(() => {
	sessionList = loadSessionListFromStorage();
	if (sessionList.length > 0) {
		const latest = sessionList[0];
		sessionId = latest.id;
		messages = loadSessionMessages(latest.id);
	} else {
		sessionId = generateSessionId();
	}

	const keyHandler = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "k") {
			e.preventDefault();
			toggle();
		}
	};
	window.addEventListener("keydown", keyHandler);

	const toggleHandler = () => toggle();
	window.addEventListener("toggle-ai-search", toggleHandler);

	return () => {
		saveCurrentSession();
		window.removeEventListener("keydown", keyHandler);
		window.removeEventListener("toggle-ai-search", toggleHandler);
	};
});
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ai-overlay" onclick={handleOverlayClick}>
    <div class="ai-panel">
      <!-- 标题栏 -->
      <div class="ai-header">
        <div class="flex items-center gap-2">
          <img
            src="/assets/images/aut.png"
            alt="喵墩"
            class="ai-avatar-sm"
          />
          <span class="font-bold text-lg">喵墩</span>
          <span class="text-xs text-50 ml-1">{aiSearchConfig.modelName}</span>
        </div>
        <div class="flex items-center gap-1">
          {#if sessionList.length > 0}
            <button
              class="ai-icon-btn"
              class:ai-icon-btn-active={showSessionList}
              onclick={() => (showSessionList = !showSessionList)}
              title="历史会话"
            >
              <Icon icon="material-symbols:history" />
            </button>
          {/if}
          <button class="ai-icon-btn" onclick={startNewSession} title="新建会话">
            <Icon icon="material-symbols:add-circle-outline" />
          </button>
          <button class="ai-icon-btn" onclick={close} title="关闭">
            <Icon icon="material-symbols:close" />
          </button>
        </div>
      </div>

      <!-- 历史会话列表 -->
      {#if showSessionList}
        <div class="ai-session-list">
          {#each sessionList as sess}
            <button
              class="ai-session-item"
              class:ai-session-item-active={sess.id === sessionId}
              onclick={() => switchSession(sess.id)}
            >
              <div class="ai-session-info">
                <span class="ai-session-title">{sess.title}</span>
                <span class="ai-session-time">{formatTime(sess.updatedAt)}</span>
              </div>
              <span
                class="ai-session-delete"
                onclick={(e) => { e.stopPropagation(); deleteSession(sess.id); }}
                title="删除会话"
              >
                <Icon icon="material-symbols:close" size="sm" />
              </span>
            </button>
          {/each}
          {#if sessionList.length === 0}
            <div class="ai-session-empty">暂无历史会话</div>
          {/if}
        </div>
      {/if}

      <!-- 消息列表 -->
      <div class="ai-messages" bind:this={messagesEl}>
        {#if messages.length === 0}
          <div class="ai-empty">
            <Icon icon="material-symbols:robot-2-outline" size="2xl" />
            <p class="mt-3 text-50">有什么想问的？我会基于博客内容来回答的喵~</p>
            <div class="ai-suggestions">
              <button onclick={() => { inputVal = "介绍一下这个博客的技术栈"; send(); }}>
                博客的技术栈是什么？
              </button>
              <button onclick={() => { inputVal = "介绍一下自己"; send(); }}>
                介绍一下自己
              </button>
            </div>
          </div>
        {/if}

        {#each messages as msg, i}
          <div class="ai-msg {msg.role}">
            <div class="ai-msg-avatar">
              {#if msg.role === "user"}
                <Icon icon="material-symbols:person-outline" />
              {:else}
                <img src="/assets/images/aut.png" alt="喵墩" class="ai-msg-avatar-img" />
              {/if}
            </div>
            <div class="ai-msg-body">
              <div class="ai-msg-content prose-sm">
                {@html renderMd(msg.content)}
                {#if msg.streaming}
                  <span class="ai-cursor"></span>
                {/if}
              </div>
              {#if msg.refs && msg.refs.length > 0}
                <div class="ai-refs">
                  <div class="ai-refs-title">参考文章</div>
                  {#each msg.refs as ref}
                    <a href={ref.path} class="ai-ref-link" onclick={() => (isOpen = false)}>
                      <Icon icon="material-symbols:article-outline" size="sm" />
                      <span>{ref.title}</span>
                      {#if ref.published}
                        <span class="ai-ref-date">{ref.published}</span>
                      {/if}
                    </a>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- 输入区域 -->
      <div class="ai-input-area">
        <input
          bind:this={inputEl}
          bind:value={inputVal}
          onkeydown={handleKeydown}
          placeholder="输入你的问题..."
          disabled={isLoading}
          class="ai-input"
        />
        {#if isLoading}
          <button class="ai-send-btn" onclick={stop} title="停止生成">
            <Icon icon="material-symbols:stop-circle-outline" />
          </button>
        {:else}
          <button
            class="ai-send-btn"
            onclick={send}
            disabled={!inputVal.trim()}
            title="发送"
          >
            <Icon icon="material-symbols:send-outline" />
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .ai-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .ai-panel {
    width: 100%;
    max-width: 42rem;
    height: 80vh;
    max-height: 600px;
    background: var(--float-panel-bg, #fff);
    border-radius: 1rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.2s ease;
  }

  :root.dark .ai-panel {
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
  }

  .ai-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid oklch(0.85 0 0 / 0.2);
    flex-shrink: 0;
  }

  :root.dark .ai-header {
    border-bottom-color: oklch(0.3 0 0 / 0.3);
  }

  .ai-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--text-50, #888);
    transition: background 0.15s, color 0.15s;
  }
  .ai-icon-btn:hover {
    background: oklch(0.5 0 0 / 0.1);
    color: var(--text-90, #333);
  }
  .ai-icon-btn-active {
    background: oklch(0.5 0 0 / 0.1);
    color: var(--primary);
  }

  :root.dark .ai-icon-btn {
    color: var(--text-50, #aaa);
  }
  :root.dark .ai-icon-btn:hover {
    background: oklch(0.5 0 0 / 0.15);
    color: var(--text-90, #eee);
  }
  :root.dark .ai-icon-btn-active {
    background: oklch(0.5 0 0 / 0.15);
  }

  .ai-session-list {
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.5rem;
    border-bottom: 1px solid oklch(0.85 0 0 / 0.2);
    flex-shrink: 0;
  }
  :root.dark .ai-session-list {
    border-bottom-color: oklch(0.3 0 0 / 0.3);
  }

  .ai-session-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.6rem;
    border-radius: 0.5rem;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .ai-session-item:hover {
    background: oklch(0.5 0 0 / 0.08);
  }
  .ai-session-item-active {
    background: oklch(0.5 0 0 / 0.1);
  }

  .ai-session-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .ai-session-title {
    font-size: 0.85rem;
    color: var(--text-90, #222);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :root.dark .ai-session-title {
    color: var(--text-90, #eee);
  }

  .ai-session-time {
    font-size: 0.7rem;
    color: var(--text-30, #aaa);
    margin-top: 0.1rem;
  }

  .ai-session-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.3rem;
    color: var(--text-30, #aaa);
    flex-shrink: 0;
    margin-left: 0.5rem;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }
  .ai-session-item:hover .ai-session-delete {
    opacity: 1;
  }
  .ai-session-delete:hover {
    background: oklch(0.5 0 0 / 0.1);
    color: var(--text-70, #555);
  }
  :root.dark .ai-session-delete {
    color: var(--text-30, #888);
  }
  :root.dark .ai-session-delete:hover {
    background: oklch(0.5 0 0 / 0.15);
    color: var(--text-70, #ccc);
  }

  .ai-session-empty {
    text-align: center;
    padding: 1rem;
    font-size: 0.8rem;
    color: var(--text-30, #aaa);
  }

  .ai-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .ai-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-30, #aaa);
  }

  .ai-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
    justify-content: center;
  }
  .ai-suggestions button {
    padding: 0.4rem 0.8rem;
    border-radius: 0.75rem;
    border: 1px solid oklch(0.8 0 0 / 0.3);
    background: transparent;
    color: var(--text-70, #555);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .ai-suggestions button:hover {
    background: oklch(0.5 0 0 / 0.08);
    border-color: var(--primary);
    color: var(--primary);
  }
  :root.dark .ai-suggestions button {
    border-color: oklch(0.4 0 0 / 0.4);
    color: var(--text-70, #ccc);
  }
  :root.dark .ai-suggestions button:hover {
    background: oklch(0.5 0 0 / 0.12);
    border-color: var(--primary);
    color: var(--primary);
  }

  .ai-msg {
    display: flex;
    gap: 0.6rem;
  }
  .ai-msg.user {
    flex-direction: row-reverse;
  }

  .ai-msg-avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 1rem;
  }
  .ai-msg.assistant .ai-msg-avatar {
    background: oklch(0.93 0 0);
    color: oklch(0.3 0 0);
  }
  :root.dark .ai-msg.assistant .ai-msg-avatar {
    background: oklch(0.25 0 0);
    color: oklch(0.8 0 0);
  }
  .ai-msg.user .ai-msg-avatar {
    background: var(--primary);
    color: white;
  }
  :root.dark .ai-msg.user .ai-msg-avatar {
    color: rgba(0, 0, 0, 0.7);
  }

  .ai-msg-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .ai-avatar-sm {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.375rem;
    object-fit: cover;
  }

  .ai-msg-body {
    max-width: 80%;
    min-width: 0;
  }

  .ai-msg-content {
    padding: 0.6rem 0.9rem;
    border-radius: 0.75rem;
    line-height: 1.6;
    word-break: break-word;
    font-size: 0.9rem;
  }
  .ai-msg.assistant .ai-msg-content {
    background: oklch(0.96 0 0);
    color: var(--text-90, #222);
  }
  :root.dark .ai-msg.assistant .ai-msg-content {
    background: oklch(0.2 0 0);
    color: var(--text-90, #eee);
  }
  .ai-msg.user .ai-msg-content {
    background: var(--primary);
    color: white;
  }
  :root.dark .ai-msg.user .ai-msg-content {
    color: rgba(0, 0, 0, 0.7);
  }

  /* markdown 内容样式 */
  .ai-msg-content :global(p) {
    margin: 0.3em 0;
  }
  .ai-msg-content :global(p:first-child) {
    margin-top: 0;
  }
  .ai-msg-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .ai-msg-content :global(code) {
    background: oklch(0.9 0 0 / 0.6);
    padding: 0.1em 0.3em;
    border-radius: 0.25em;
    font-size: 0.85em;
  }
  :root.dark .ai-msg-content :global(code) {
    background: oklch(0.3 0 0 / 0.5);
  }
  .ai-msg-content :global(pre) {
    background: oklch(0.15 0 0);
    color: oklch(0.85 0 0);
    padding: 0.6rem 0.8rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin: 0.4em 0;
    font-size: 0.8rem;
  }
  .ai-msg-content :global(pre code) {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  .ai-msg-content :global(ul),
  .ai-msg-content :global(ol) {
    padding-left: 1.2em;
    margin: 0.3em 0;
  }
  .ai-msg-content :global(blockquote) {
    border-left: 3px solid var(--primary);
    padding-left: 0.6em;
    margin: 0.3em 0;
    opacity: 0.7;
  }

  .ai-cursor {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    background: var(--primary);
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: blink 0.8s infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .ai-refs {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid oklch(0.85 0 0 / 0.3);
  }
  :root.dark .ai-refs {
    border-top-color: oklch(0.3 0 0 / 0.3);
  }
  .ai-refs-title {
    font-size: 0.7rem;
    color: var(--text-30, #aaa);
    margin-bottom: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ai-ref-link {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.4rem;
    border-radius: 0.4rem;
    font-size: 0.8rem;
    color: var(--primary);
    text-decoration: none;
    transition: background 0.15s;
  }
  .ai-ref-link:hover {
    background: oklch(0.5 0 0 / 0.08);
  }
  .ai-ref-date {
    margin-left: auto;
    font-size: 0.7rem;
    color: var(--text-30, #aaa);
    white-space: nowrap;
  }

  .ai-input-area {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid oklch(0.85 0 0 / 0.2);
    flex-shrink: 0;
  }
  :root.dark .ai-input-area {
    border-top-color: oklch(0.3 0 0 / 0.3);
  }

  .ai-input {
    flex: 1;
    border: 1px solid oklch(0.8 0 0 / 0.3);
    border-radius: 0.75rem;
    padding: 0.5rem 0.8rem;
    font-size: 0.9rem;
    background: transparent;
    color: var(--text-90, #222);
    outline: none;
    transition: border-color 0.15s;
  }
  .ai-input:focus {
    border-color: var(--primary);
  }
  .ai-input::placeholder {
    color: var(--text-30, #aaa);
  }
  :root.dark .ai-input {
    border-color: oklch(0.35 0 0 / 0.4);
    color: var(--text-90, #eee);
  }

  .ai-send-btn {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 0.75rem;
    border: none;
    background: var(--primary);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .ai-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ai-send-btn:not(:disabled):hover {
    opacity: 0.85;
  }
  :root.dark .ai-send-btn {
    color: rgba(0, 0, 0, 0.7);
  }

  @media (max-width: 640px) {
    .ai-overlay {
      padding: 0;
      align-items: flex-end;
    }
    .ai-panel {
      max-width: none;
      height: 78vh;
      max-height: none;
      border-radius: 1rem 1rem 0 0;
    }
    .ai-header {
      padding: 0.6rem 0.75rem;
    }
    .ai-header .text-xs {
      display: none;
    }
    .ai-messages {
      padding: 0.75rem;
      gap: 0.75rem;
    }
    .ai-msg-body {
      max-width: 88%;
    }
    .ai-msg-content {
      font-size: 0.95rem;
      padding: 0.5rem 0.7rem;
    }
    .ai-input-area {
      padding: 0.6rem 0.75rem;
      gap: 0.4rem;
    }
    .ai-input {
      font-size: 16px; /* 防止 iOS 缩放 */
      padding: 0.6rem 0.7rem;
    }
    .ai-send-btn {
      width: 2.5rem;
      height: 2.5rem;
      min-width: 44px;
      min-height: 44px;
    }
    .ai-icon-btn {
      width: 2.25rem;
      height: 2.25rem;
      min-width: 44px;
      min-height: 44px;
    }
    .ai-suggestions {
      gap: 0.4rem;
    }
    .ai-suggestions button {
      font-size: 0.85rem;
      padding: 0.35rem 0.6rem;
    }
    .ai-session-list {
      max-height: 10rem;
    }
    .ai-session-delete {
      opacity: 1;
      width: 1.75rem;
      height: 1.75rem;
      min-width: 32px;
      min-height: 32px;
    }
    .ai-msg-content :global(pre) {
      font-size: 0.75rem;
      padding: 0.4rem 0.5rem;
    }
  }
</style>
