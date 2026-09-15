<script lang="ts">
import {
	AlertCircle,
	ChevronLeft,
	Copy,
	Inbox,
	LoaderCircle,
	Mail,
	RefreshCw,
	RotateCcw,
	Trash2,
	WifiOff,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import type { MailDetail, MailMessage, MailSession } from "@/types/mail";
import {
	clearMailbox,
	createMailbox,
	deleteMailbox,
	deleteMailMessage,
	getMailboxMessages,
	getMailMessage,
	MailApiError,
	markMailRead,
} from "@/utils/mail-api";
import { sanitizeMailHtml } from "@/utils/mail-html";

const SESSION_STORAGE_KEY = "mail-session";
const POLL_INTERVAL = 20_000;

let session = $state<MailSession | null>(null);
let messages = $state<MailMessage[]>([]);
let selectedId = $state<string | null>(null);
let detail = $state<MailDetail | null>(null);
let initialLoading = $state(true);
let listError = $state("");
let detailError = $state("");
let actionError = $state("");
let syncing = $state(false);
let detailLoading = $state(false);
let generating = $state(false);
let deletingId = $state<string | null>(null);
let copied = $state(false);
let isOffline = $state(false);
let showDetailOnMobile = $state(false);
let pollTimer: number | undefined;
let syncController: AbortController | null = null;
let detailController: AbortController | null = null;
let operationController: AbortController | null = null;

const selectedMessage = $derived(
	messages.find((message) => message.id === selectedId) ?? null,
);
const unreadCount = $derived(
	messages.filter((message) => message.is_unread).length,
);
const sanitizedDetailHtml = $derived(
	detail?.html ? sanitizeMailHtml(detail.html) : "",
);

function readStoredSession(): MailSession | null {
	try {
		const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
		if (!raw) return null;
		const value: unknown = JSON.parse(raw);
		if (
			value &&
			typeof value === "object" &&
			typeof (value as MailSession).address === "string" &&
			typeof (value as MailSession).jwt === "string"
		) {
			return value as MailSession;
		}
	} catch {
		// A malformed browser session should behave like a new mailbox.
	}
	return null;
}

function saveSession(value: MailSession | null) {
	session = value;
	try {
		if (value)
			sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
		else sessionStorage.removeItem(SESSION_STORAGE_KEY);
	} catch {
		// Private browsing can disable sessionStorage; the in-memory session still works.
	}
}

function isAuthError(error: unknown): boolean {
	return (
		error instanceof MailApiError &&
		error.status === 401 &&
		error.code !== "UPSTREAM_CHALLENGE"
	);
}

function readableError(error: unknown, fallback: string): string {
	if (error instanceof MailApiError) {
		if (
			error.code === "UPSTREAM_CHALLENGE" ||
			error.code === "INVALID_RESPONSE"
		) {
			return error.message;
		}
		if (error.status === 403) {
			return "邮箱服务拒绝了本次请求，可能暂时关闭了新邮箱创建或需要额外验证。";
		}
		if (error.status === 401) return "邮箱会话已过期，请重新生成邮箱。";
		if (error.status && error.status >= 500) {
			return "邮箱服务暂时不可用，请稍后再试。";
		}
		return error.message || fallback;
	}
	return error instanceof Error && error.message ? error.message : fallback;
}

function expireSession() {
	saveSession(null);
	messages = [];
	selectedId = null;
	detail = null;
	showDetailOnMobile = false;
	listError = "邮箱会话已过期，请重新生成邮箱。";
}

async function syncMessages(showError = true) {
	if (!session || isOffline || syncing) return;
	syncController?.abort();
	syncController = new AbortController();
	syncing = true;
	if (showError) listError = "";

	try {
		const response = await getMailboxMessages(
			session.jwt,
			syncController.signal,
		);
		messages = response.results;
		if (selectedId && !messages.some((message) => message.id === selectedId)) {
			selectedId = null;
			detail = null;
			showDetailOnMobile = false;
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		if (isAuthError(error)) expireSession();
		else if (showError)
			listError = readableError(error, "收件箱加载失败，请稍后重试。");
	} finally {
		syncing = false;
	}
}

async function generateMailbox(replaceExisting = false) {
	if (generating) return;
	const previous = session;
	generating = true;
	actionError = "";
	listError = "";
	operationController?.abort();
	operationController = new AbortController();

	try {
		const created = await createMailbox(undefined, operationController.signal);
		saveSession(created);
		messages = [];
		selectedId = null;
		detail = null;
		showDetailOnMobile = false;
		if (replaceExisting && previous && previous.jwt !== created.jwt) {
			void deleteMailbox(previous.jwt).catch(() => undefined);
		}
		await syncMessages(true);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		if (previous) saveSession(previous);
		else listError = readableError(error, "暂时无法创建邮箱，请稍后重试。");
		if (previous)
			actionError = readableError(error, "重新生成邮箱失败，请稍后重试。");
	} finally {
		generating = false;
	}
}

async function loadDetail(message: MailMessage) {
	if (!session) return;
	detailController?.abort();
	detailController = new AbortController();
	detailLoading = true;
	detailError = "";
	detail = null;
	const activeId = message.id;

	try {
		detail = await getMailMessage(
			activeId,
			session.jwt,
			detailController.signal,
		);
		if (message.is_unread) {
			try {
				await markMailRead(activeId, session.jwt);
				messages = messages.map((item) =>
					item.id === activeId ? { ...item, is_unread: false } : item,
				);
			} catch {
				// Reading a message should not fail just because the optional read marker did.
			}
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		if (isAuthError(error)) expireSession();
		else detailError = readableError(error, "邮件详情加载失败，请稍后重试。");
	} finally {
		detailLoading = false;
	}
}

function selectMessage(message: MailMessage) {
	selectedId = message.id;
	showDetailOnMobile = true;
	void loadDetail(message);
}

function closeDetail() {
	showDetailOnMobile = false;
}

async function copyAddress() {
	if (!session?.address) return;
	try {
		await navigator.clipboard.writeText(session.address);
	} catch {
		const input = document.createElement("textarea");
		input.value = session.address;
		input.setAttribute("readonly", "true");
		input.style.position = "fixed";
		input.style.opacity = "0";
		document.body.appendChild(input);
		input.select();
		document.execCommand("copy");
		input.remove();
	}
	copied = true;
	window.setTimeout(() => (copied = false), 1800);
}

async function removeMessage(message: MailMessage) {
	if (!session || deletingId) return;
	deletingId = message.id;
	actionError = "";
	try {
		await deleteMailMessage(message.id, session.jwt);
		messages = messages.filter((item) => item.id !== message.id);
		if (selectedId === message.id) {
			selectedId = null;
			detail = null;
			showDetailOnMobile = false;
		}
	} catch (error) {
		if (isAuthError(error)) expireSession();
		else actionError = readableError(error, "删除邮件失败，请稍后重试。");
	} finally {
		deletingId = null;
	}
}

async function clearInbox() {
	if (
		!session ||
		!window.confirm("确定要清空当前邮箱的全部邮件吗？此操作无法撤销。")
	)
		return;
	actionError = "";
	try {
		await clearMailbox(session.jwt);
		messages = [];
		selectedId = null;
		detail = null;
		showDetailOnMobile = false;
	} catch (error) {
		if (isAuthError(error)) expireSession();
		else actionError = readableError(error, "清空收件箱失败，请稍后重试。");
	}
}

async function regenerateMailbox() {
	if (
		!window.confirm("重新生成后，当前邮箱地址和收件箱将被替换。确定继续吗？")
	) {
		return;
	}
	await generateMailbox(true);
}

function formatDate(value: string | number | undefined): string {
	if (value === undefined) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return new Intl.DateTimeFormat("zh-CN", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function formatBytes(value: number | undefined): string {
	if (!value || value < 1024) return value ? `${value} B` : "未知大小";
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function displaySender(message: MailMessage): string {
	return message.sender || message.address || "未知发件人";
}

function displaySubject(message: MailMessage): string {
	return message.subject?.trim() || "（无主题）";
}

onMount(() => {
	isOffline = !navigator.onLine;
	const stored = readStoredSession();
	if (stored) {
		session = stored;
		void syncMessages(true).finally(() => (initialLoading = false));
	} else {
		void generateMailbox(false).finally(() => (initialLoading = false));
	}

	const handleOnline = () => {
		isOffline = false;
		void syncMessages(true);
	};
	const handleOffline = () => {
		isOffline = true;
	};
	const handleVisibility = () => {
		if (!document.hidden && session && !isOffline) void syncMessages(false);
	};

	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);
	document.addEventListener("visibilitychange", handleVisibility);
	pollTimer = window.setInterval(() => {
		if (!document.hidden && session && !isOffline) void syncMessages(false);
	}, POLL_INTERVAL);

	return () => {
		if (pollTimer) window.clearInterval(pollTimer);
		syncController?.abort();
		detailController?.abort();
		operationController?.abort();
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		document.removeEventListener("visibilitychange", handleVisibility);
	};
});
</script>

<section class="mail-app" aria-label="临时邮箱">
	<header class="mail-app__header">
		<div class="mail-app__identity">
			<div class="mail-app__eyebrow"><Mail size={16} aria-hidden="true" /> Cloud Mail</div>
			<div class="mail-app__address-row">
				<strong class="mail-app__address" title={session?.address ?? ""}>
					{session?.address ?? (generating || initialLoading ? "正在创建邮箱…" : "尚未创建邮箱")}
				</strong>
				{#if session}
					<button class="mail-app__icon-button" type="button" onclick={() => void copyAddress()} aria-label="复制邮箱地址" title="复制邮箱地址">
						<Copy size={16} aria-hidden="true" />
					</button>
				{/if}
			</div>
			<p class="mail-app__status" class:is-success={session && !isOffline}>
				{#if isOffline}
					<WifiOff size={14} aria-hidden="true" /> 已离线，自动刷新已暂停
				{:else if copied}
					已复制邮箱地址
				{:else if syncing}
					正在同步收件箱…
				{:else if session}
					每 20 秒自动检查新邮件
				{:else}
					{generating || initialLoading ? "邮箱初始化中" : "点击重试连接邮箱服务"}
				{/if}
			</p>
		</div>
		<div class="mail-app__actions">
			{#if session}
				<button class="mail-app__button mail-app__button--plain" type="button" onclick={() => void syncMessages(true)} disabled={syncing || isOffline}>
					<RefreshCw size={16} class={syncing ? "spin" : undefined} aria-hidden="true" /> 刷新
				</button>
				<button class="mail-app__button mail-app__button--plain" type="button" onclick={() => void clearInbox()} disabled={!messages.length || syncing}>
					<Trash2 size={16} aria-hidden="true" /> 清空
				</button>
				<button class="mail-app__button mail-app__button--accent" type="button" onclick={() => void regenerateMailbox()} disabled={generating}>
					{#if generating}<LoaderCircle size={16} class="spin" aria-hidden="true" />{:else}<RotateCcw size={16} aria-hidden="true" />{/if}
					重新生成
				</button>
			{:else}
				<button class="mail-app__button mail-app__button--accent" type="button" onclick={() => void generateMailbox(false)} disabled={generating}>
					{#if generating}<LoaderCircle size={16} class="spin" aria-hidden="true" />{:else}<RefreshCw size={16} aria-hidden="true" />{/if}
					重试
				</button>
			{/if}
		</div>
	</header>

	{#if actionError}
		<div class="mail-app__notice mail-app__notice--error" role="alert">
			<AlertCircle size={17} aria-hidden="true" /> <span>{actionError}</span>
			<button type="button" class="mail-app__notice-close" onclick={() => (actionError = "")} aria-label="关闭提示"><X size={16} aria-hidden="true" /></button>
		</div>
	{/if}

	{#if initialLoading}
		<div class="mail-app__initial-state" aria-live="polite"><LoaderCircle size={22} class="spin" aria-hidden="true" /> 正在连接邮箱服务…</div>
	{:else if !session}
		<div class="mail-app__empty mail-app__empty--page">
			<AlertCircle size={32} aria-hidden="true" />
			<h2>邮箱暂时不可用</h2>
			<p>{listError || "暂时无法创建邮箱，请稍后重试。"}</p>
		</div>
	{:else}
		<div class="mail-app__workspace" class:is-detail-open={showDetailOnMobile}>
			<section class="mail-app__list-pane" aria-label="收件箱">
				<div class="mail-app__pane-heading">
					<div><h2>收件箱</h2><span>{messages.length} 封邮件{#if unreadCount} · {unreadCount} 封未读{/if}</span></div>
					{#if syncing}<LoaderCircle size={16} class="spin" aria-label="同步中" />{/if}
				</div>
				{#if listError}
					<div class="mail-app__inline-error" role="alert"><AlertCircle size={16} aria-hidden="true" /> {listError}</div>
				{/if}
				{#if !messages.length && !listError}
					<div class="mail-app__empty"><Inbox size={30} aria-hidden="true" /><strong>收件箱还是空的</strong><span>新邮件会自动出现在这里。</span></div>
				{:else if listError && !messages.length}
					<div class="mail-app__empty"><AlertCircle size={30} aria-hidden="true" /><strong>无法加载邮件</strong><span>请点击右上角刷新后重试。</span></div>
				{:else}
					<div class="mail-app__message-list">
						{#each messages as message (message.id)}
							<article class="mail-app__message" class:is-unread={message.is_unread} class:is-selected={message.id === selectedId}>
								<button class="mail-app__message-main" type="button" onclick={() => selectMessage(message)} aria-label={`查看邮件：${displaySubject(message)}`}>
									<span class="mail-app__unread-dot" aria-hidden="true"></span>
									<span class="mail-app__message-copy"><strong>{displaySender(message)}</strong><span>{displaySubject(message)}</span></span>
									<time datetime={String(message.created_at ?? "")}>{formatDate(message.created_at)}</time>
								</button>
								<button class="mail-app__message-delete" type="button" onclick={() => void removeMessage(message)} disabled={deletingId === message.id} aria-label={`删除邮件：${displaySubject(message)}`} title="删除邮件">
									{#if deletingId === message.id}<LoaderCircle size={15} class="spin" aria-hidden="true" />{:else}<Trash2 size={15} aria-hidden="true" />{/if}
								</button>
							</article>
						{/each}
					</div>
				{/if}
			</section>

			<section class="mail-app__detail-pane" aria-label="邮件详情">
				{#if showDetailOnMobile}<button class="mail-app__back-button" type="button" onclick={closeDetail}><ChevronLeft size={17} aria-hidden="true" /> 返回收件箱</button>{/if}
				{#if detailLoading}
					<div class="mail-app__empty"><LoaderCircle size={28} class="spin" aria-hidden="true" /><span>正在读取邮件…</span></div>
				{:else if detailError}
					<div class="mail-app__empty"><AlertCircle size={30} aria-hidden="true" /><strong>邮件读取失败</strong><span>{detailError}</span></div>
				{:else if selectedMessage && detail}
					<article class="mail-app__detail">
						<header class="mail-app__detail-header">
							<div class="mail-app__detail-heading"><p>邮件详情</p><h2>{detail.subject || displaySubject(selectedMessage)}</h2></div>
							<button class="mail-app__icon-button" type="button" onclick={() => void removeMessage(selectedMessage)} aria-label="删除当前邮件" title="删除当前邮件"><Trash2 size={17} aria-hidden="true" /></button>
						</header>
						<dl class="mail-app__metadata">
							<div><dt>发件人</dt><dd>{detail.sender || displaySender(selectedMessage)}</dd></div>
							<div><dt>收件人</dt><dd>{selectedMessage.address || session?.address}</dd></div>
							<div><dt>时间</dt><dd>{formatDate(selectedMessage.created_at) || "未知时间"}</dd></div>
						</dl>
						<div class="mail-app__detail-body">
							{#if sanitizedDetailHtml}<div class="mail-app__mail-html">{@html sanitizedDetailHtml}</div>{:else if detail.text}<pre>{detail.text}</pre>{:else}<p class="mail-app__muted">这封邮件没有可显示的正文。</p>{/if}
						</div>
						{#if detail.attachments?.length}
							<section class="mail-app__attachments"><h3>附件</h3>{#each detail.attachments as attachment}<div class="mail-app__attachment"><span>{attachment.filename || "未命名附件"}</span><small>{attachment.mimeType || "未知类型"} · {formatBytes(attachment.size)}</small></div>{/each}</section>
						{/if}
					</article>
				{:else}
					<div class="mail-app__empty mail-app__empty--detail"><Mail size={34} aria-hidden="true" /><strong>选择一封邮件</strong><span>邮件正文会显示在这里。</span></div>
				{/if}
			</section>
		</div>
	{/if}
</section>
