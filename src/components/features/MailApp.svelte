<script lang="ts">
import {
	AlertCircle,
	ChevronLeft,
	Copy,
	Inbox,
	LoaderCircle,
	LogIn,
	LogOut,
	Mail,
	RefreshCw,
	Trash2,
	UserPlus,
	WifiOff,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import type { MailAuthConfig, MailDetail, MailMessage } from "@/types/mail";
import {
	clearMailbox,
	deleteMailMessage,
	getMailAuthConfig,
	getMailboxMessages,
	getMailMessage,
	getMailSession,
	loginMailbox,
	logoutMailbox,
	MailApiError,
	markMailRead,
	registerMailbox,
} from "@/utils/mail-api";
import MailAddressFields from "@components/features/MailAddressFields.svelte";
import {
	composeMailboxAddress,
	FALLBACK_ALL_MAIL_DOMAINS,
	FALLBACK_PUBLIC_MAIL_DOMAINS,
	splitMailboxAddress,
} from "@/utils/mail-address";
import { sanitizeMailHtml } from "@/utils/mail-html";

const POLL_BASE_INTERVAL = 60_000;
const POLL_MAX_INTERVAL = 5 * 60_000;
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;

let view = $state<"loading" | "auth" | "inbox">("loading");
let address = $state("");

// ── 登录 / 注册 ──
let authMode = $state<"login" | "register">("login");
let config = $state<MailAuthConfig | null>(null);
let configError = $state("");
let configLoading = $state(false);
let authBusy = $state(false);
let authError = $state("");
let authNotice = $state("");
let loginPrefix = $state("");
let loginDomain = $state("");
let loginPasteError = $state("");
let loginPassword = $state("");
let loginDomains = $state<string[]>([...FALLBACK_ALL_MAIL_DOMAINS]);
let publicDomains = $state<string[]>([...FALLBACK_PUBLIC_MAIL_DOMAINS]);
let regName = $state("");
let regDomain = $state("");
let regPasteError = $state("");
let regPassword = $state("");
let regConfirm = $state("");

// ── 收件箱 ──
let messages = $state<MailMessage[]>([]);
let selectedId = $state<string | null>(null);
let detail = $state<MailDetail | null>(null);
let listError = $state("");
let detailError = $state("");
let actionError = $state("");
let syncing = $state(false);
let detailLoading = $state(false);
let deletingId = $state<string | null>(null);
let copied = $state(false);
let isOffline = $state(false);
let showDetailOnMobile = $state(false);
let pollTimer: number | undefined;
let pollInterval = POLL_BASE_INTERVAL;
let consecutiveSyncFailures = 0;
let syncController: AbortController | null = null;
let detailController: AbortController | null = null;

const selectedMessage = $derived(
	messages.find((message) => message.id === selectedId) ?? null,
);
const unreadCount = $derived(
	messages.filter((message) => message.is_unread).length,
);
const sanitizedDetailHtml = $derived(
	detail?.html ? sanitizeMailHtml(detail.html) : "",
);
const registerPreview = $derived(
	`${regName || "name"}@${regDomain || publicDomains[0] || ""}`,
);

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
		if (error.status === 429) {
			const wait = error.retryAfterSeconds;
			return wait
				? `${error.message}（约 ${wait < 60 ? `${wait} 秒` : `${Math.ceil(wait / 60)} 分钟`}后可重试）`
				: error.message;
		}
		if (error.status && error.status >= 500) {
			return "邮箱服务暂时不可用，请稍后再试。";
		}
		return error.message || fallback;
	}
	return error instanceof Error && error.message ? error.message : fallback;
}

function leaveInbox(notice = "") {
	view = "auth";
	authMode = "login";
	address = "";
	messages = [];
	selectedId = null;
	detail = null;
	showDetailOnMobile = false;
	listError = "";
	detailError = "";
	actionError = "";
	authError = "";
	authNotice = notice;
	pollInterval = POLL_BASE_INTERVAL;
	if (pollTimer) window.clearTimeout(pollTimer);
}

function expireSession() {
	leaveInbox("登录状态已过期，请重新登录。");
}

function enterInbox(profileAddress: string) {
	address = profileAddress;
	authNotice = "";
	authError = "";
	view = "inbox";
	pollInterval = POLL_BASE_INTERVAL;
}

async function syncMessages(showError = true) {
	if (view !== "inbox" || isOffline || syncing) return;
	syncController?.abort();
	syncController = new AbortController();
	syncing = true;
	if (showError) listError = "";

	try {
		const response = await getMailboxMessages(syncController.signal);
		messages = response.results;
		consecutiveSyncFailures = 0;
		pollInterval = POLL_BASE_INTERVAL;
		if (selectedId && !messages.some((message) => message.id === selectedId)) {
			selectedId = null;
			detail = null;
			showDetailOnMobile = false;
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		if (isAuthError(error)) {
			expireSession();
			return;
		}
		consecutiveSyncFailures += 1;
		pollInterval = Math.min(
			POLL_BASE_INTERVAL * 2 ** consecutiveSyncFailures,
			POLL_MAX_INTERVAL,
		);
		if (showError)
			listError = readableError(error, "收件箱加载失败，请稍后重试。");
	} finally {
		syncing = false;
		schedulePoll();
	}
}

function schedulePoll() {
	if (pollTimer) window.clearTimeout(pollTimer);
	pollTimer = window.setTimeout(() => {
		if (view === "inbox" && !document.hidden && !isOffline) {
			void syncMessages(false);
		} else {
			schedulePoll();
		}
	}, pollInterval);
}

async function loadDetail(message: MailMessage) {
	detailController?.abort();
	detailController = new AbortController();
	detailLoading = true;
	detailError = "";
	detail = null;
	const activeId = message.id;

	try {
		detail = await getMailMessage(activeId, detailController.signal);
		if (message.is_unread) {
			try {
				await markMailRead(activeId);
				messages = messages.map((item) =>
					item.id === activeId ? { ...item, is_unread: false } : item,
				);
			} catch {
				// Reading a message should not fail just because the optional read marker did.
			}
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		if (isAuthError(error)) {
			expireSession();
			return;
		}
		detailError = readableError(error, "邮件详情加载失败，请稍后重试。");
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
	if (!address) return;
	try {
		await navigator.clipboard.writeText(address);
	} catch {
		const input = document.createElement("textarea");
		input.value = address;
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
	if (deletingId) return;
	deletingId = message.id;
	actionError = "";
	try {
		await deleteMailMessage(message.id);
		messages = messages.filter((item) => item.id !== message.id);
		if (selectedId === message.id) {
			selectedId = null;
			detail = null;
			showDetailOnMobile = false;
		}
	} catch (error) {
		if (isAuthError(error)) {
			expireSession();
			return;
		}
		actionError = readableError(error, "删除邮件失败，请稍后重试。");
	} finally {
		deletingId = null;
	}
}

async function clearInbox() {
	if (!window.confirm("确定要清空当前邮箱的全部邮件吗？此操作无法撤销。"))
		return;
	actionError = "";
	try {
		await clearMailbox();
		messages = [];
		selectedId = null;
		detail = null;
		showDetailOnMobile = false;
	} catch (error) {
		if (isAuthError(error)) {
			expireSession();
			return;
		}
		actionError = readableError(error, "清空收件箱失败，请稍后重试。");
	}
}

async function handleLogout() {
	try {
		await logoutMailbox();
	} catch {
		// 无论服务端是否成功，本地都以未登录状态收尾
	}
	leaveInbox();
}

async function loadConfig() {
	configLoading = true;
	configError = "";
	try {
		config = await getMailAuthConfig();
		publicDomains = [...config.domains];
		loginDomains = [...config.loginDomains];
	} catch (error) {
		// 配置拉取失败时保留内置回退清单，登录注册仍可使用
		configError = readableError(error, "注册配置加载失败，请稍后重试。");
	} finally {
		configLoading = false;
	}
}

function switchAuthMode(mode: "login" | "register") {
	authMode = mode;
	authError = "";
	authNotice = "";
	if (mode === "register" && !config && !configLoading) void loadConfig();
}

function validateRegister(): string {
	const minLength = config?.addressMinLength ?? 3;
	const maxLength = config?.addressMaxLength ?? 30;
	const minPassword = config?.passwordMinLength ?? 8;
	const name = regName.trim().toLowerCase();
	if (!name || !regDomain) return "请填写邮箱前缀并选择域名。";
	if (
		!NAME_PATTERN.test(name) ||
		name.length < minLength ||
		name.length > maxLength
	) {
		return `邮箱前缀需为 ${minLength}-${maxLength} 位小写字母、数字或 . _ -，并以字母或数字开头结尾。`;
	}
	if (regPassword.length < minPassword || regPassword.length > 64) {
		return `密码长度需在 ${minPassword}-64 位之间。`;
	}
	if (regPassword !== regConfirm) return "两次输入的密码不一致。";
	return "";
}

async function handleLogin(event: SubmitEvent) {
	event.preventDefault();
	if (authBusy) return;
	if (loginPasteError) {
		authError = loginPasteError;
		return;
	}
	const raw = loginPrefix.trim().toLowerCase();
	if (!raw || !loginPassword) {
		authError = "请输入邮箱前缀和密码。";
		return;
	}
	// 防御性拆分：完整邮箱被直接填入前缀框时也能正确组合
	const split = splitMailboxAddress(raw);
	if (split.domain) {
		if (!loginDomains.includes(split.domain)) {
			authError = `不支持的后缀 @${split.domain}，请在下拉框中选择后缀。`;
			return;
		}
		loginDomain = split.domain;
	}
	const email = split.domain
		? composeMailboxAddress(split.prefix, split.domain)
		: composeMailboxAddress(raw, loginDomain);
	authBusy = true;
	authError = "";
	authNotice = "";
	try {
		const profile = await loginMailbox(email, loginPassword);
		loginPassword = "";
		enterInbox(profile.address);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		authError = readableError(error, "登录失败，请稍后重试。");
	} finally {
		authBusy = false;
	}
}

async function handleRegister(event: SubmitEvent) {
	event.preventDefault();
	if (authBusy) return;
	if (regPasteError) {
		authError = regPasteError;
		return;
	}
	const invalid = validateRegister();
	if (invalid) {
		authError = invalid;
		return;
	}
	authBusy = true;
	authError = "";
	authNotice = "";
	const name = regName.trim().toLowerCase();
	const email = composeMailboxAddress(name, regDomain);
	const password = regPassword;
	try {
		await registerMailbox(name, regDomain, password);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		authError = readableError(error, "注册失败，请稍后重试。");
		return;
	} finally {
		authBusy = false;
	}
	// 注册成功后直接登录进入收件箱
	authBusy = true;
	try {
		const profile = await loginMailbox(email, password);
		regPassword = "";
		regConfirm = "";
		enterInbox(profile.address);
	} catch {
		// 自动登录失败不掩盖注册成功的事实，引导用户手动登录
		authMode = "login";
		loginPrefix = name;
		loginDomain = regDomain;
		loginPassword = "";
		authNotice = "注册成功，但自动登录未完成，请使用刚设置的密码登录。";
	} finally {
		authBusy = false;
	}
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

function pollStatusText(): string {
	if (isOffline) return "已离线，自动刷新已暂停";
	const seconds = Math.round(pollInterval / 1000);
	if (seconds > 60) return `每 ${Math.round(seconds / 60)} 分钟自动检查新邮件`;
	return "每 60 秒自动检查新邮件";
}

onMount(() => {
	isOffline = !navigator.onLine;
	void (async () => {
		try {
			const profile = await getMailSession();
			enterInbox(profile.address);
			await syncMessages(true);
		} catch {
			leaveInbox();
		} finally {
			if (view === "auth" && !config && !configLoading) void loadConfig();
		}
	})();

	const handleOnline = () => {
		isOffline = false;
		if (view === "inbox") void syncMessages(true);
	};
	const handleOffline = () => {
		isOffline = true;
	};
	const handleVisibility = () => {
		if (!document.hidden && view === "inbox" && !isOffline)
			void syncMessages(false);
	};

	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);
	document.addEventListener("visibilitychange", handleVisibility);
	schedulePoll();

	return () => {
		if (pollTimer) window.clearTimeout(pollTimer);
		syncController?.abort();
		detailController?.abort();
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		document.removeEventListener("visibilitychange", handleVisibility);
	};
});
</script>

<section class="mail-app" aria-label="邮箱">
	{#if view === "loading"}
		<div class="mail-app__initial-state" aria-live="polite"><LoaderCircle size={22} class="spin" aria-hidden="true" /> 正在连接邮箱服务…</div>
	{:else if view === "auth"}
		<header class="mail-app__header">
			<div class="mail-app__identity">
				<div class="mail-app__eyebrow"><Mail size={16} aria-hidden="true" /> Cloud Mail</div>
				<p class="mail-app__status">登录后使用专属邮箱收件，会话在本机保留 7 天。</p>
			</div>
		</header>

		<div class="mail-app__auth">
			<div class="mail-auth-card">
				{#if authNotice}
					<div class="mail-auth-card__notice" role="status">
						<AlertCircle size={16} aria-hidden="true" /> <span>{authNotice}</span>
					</div>
				{/if}
				<div class="mail-auth-card__tabs" role="tablist" aria-label="登录或注册">
					<button
						type="button"
						role="tab"
						aria-selected={authMode === "login"}
						class:is-active={authMode === "login"}
						onclick={() => switchAuthMode("login")}
					>
						<LogIn size={15} aria-hidden="true" /> 登录
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={authMode === "register"}
						class:is-active={authMode === "register"}
						onclick={() => switchAuthMode("register")}
					>
						<UserPlus size={15} aria-hidden="true" /> 注册
					</button>
				</div>

				{#if authMode === "login"}
					<form class="mail-auth-card__form" onsubmit={handleLogin}>
						<MailAddressFields
							domains={loginDomains}
							bind:prefix={loginPrefix}
							bind:domain={loginDomain}
							bind:pasteError={loginPasteError}
							idPrefix="mail-login"
							label="邮箱前缀"
							autocomplete="username"
						/>
						<label class="mail-auth-card__field">
							<span>密码</span>
							<input
								type="password"
								name="password"
								required
								autocomplete="current-password"
								placeholder="邮箱密码"
								bind:value={loginPassword}
							/>
						</label>
						{#if authError}
							<p class="mail-auth-card__error" role="alert"><AlertCircle size={15} aria-hidden="true" /> {authError}</p>
						{/if}
						<button class="mail-auth-card__submit" type="submit" disabled={authBusy}>
							{#if authBusy}<LoaderCircle size={16} class="spin" aria-hidden="true" />{:else}<LogIn size={16} aria-hidden="true" />{/if}
							登录邮箱
						</button>
						<p class="mail-auth-card__hint">忘记密码请联系站点管理员重置。</p>
					</form>
				{:else}
					<form class="mail-auth-card__form" onsubmit={handleRegister}>
						{#if configError}
							<div class="mail-auth-card__error mail-auth-card__error--block" role="alert">
								<AlertCircle size={15} aria-hidden="true" /> <span>{configError}</span>
								<button type="button" onclick={() => void loadConfig()} disabled={configLoading}>重试</button>
							</div>
						{:else}
							<MailAddressFields
								domains={publicDomains}
								bind:prefix={regName}
								bind:domain={regDomain}
								bind:pasteError={regPasteError}
								idPrefix="mail-register"
								label="邮箱前缀"
								autocomplete="username"
							/>
							<p class="mail-auth-card__preview">{registerPreview}</p>
							<label class="mail-auth-card__field">
								<span>密码</span>
								<input
									type="password"
									name="new-password"
									required
									autocomplete="new-password"
									placeholder="至少 {config?.passwordMinLength ?? 8} 位"
									bind:value={regPassword}
								/>
							</label>
							<label class="mail-auth-card__field">
								<span>确认密码</span>
								<input
									type="password"
									name="confirm-password"
									required
									autocomplete="new-password"
									placeholder="再次输入密码"
									bind:value={regConfirm}
								/>
							</label>
						{/if}
						{#if authError}
							<p class="mail-auth-card__error" role="alert"><AlertCircle size={15} aria-hidden="true" /> {authError}</p>
						{/if}
						<button class="mail-auth-card__submit" type="submit" disabled={authBusy}>
							{#if authBusy}<LoaderCircle size={16} class="spin" aria-hidden="true" />{:else}<UserPlus size={16} aria-hidden="true" />{/if}
							注册并进入收件箱
						</button>
						<p class="mail-auth-card__hint">仅开放 {publicDomains.length} 个公开域名；mourn.top 由管理员创建。注册后凭地址密码随时登录。</p>
					</form>
				{/if}
			</div>
		</div>
	{:else}
		<header class="mail-app__header">
			<div class="mail-app__identity">
				<div class="mail-app__eyebrow"><Mail size={16} aria-hidden="true" /> Cloud Mail</div>
				<div class="mail-app__address-row">
					<strong class="mail-app__address" title={address}>{address}</strong>
					<button class="mail-app__icon-button" type="button" onclick={() => void copyAddress()} aria-label="复制邮箱地址" title="复制邮箱地址">
						<Copy size={16} aria-hidden="true" />
					</button>
				</div>
				<p class="mail-app__status" class:is-success={!isOffline}>
					{#if isOffline}
						<WifiOff size={14} aria-hidden="true" /> 已离线，自动刷新已暂停
					{:else if copied}
						已复制邮箱地址
					{:else if syncing}
						正在同步收件箱…
					{:else}
						{pollStatusText()}
					{/if}
				</p>
			</div>
			<div class="mail-app__actions">
				<button class="mail-app__button mail-app__button--plain" type="button" onclick={() => void syncMessages(true)} disabled={syncing || isOffline}>
					<RefreshCw size={16} class={syncing ? "spin" : undefined} aria-hidden="true" /> 刷新
				</button>
				<button class="mail-app__button mail-app__button--plain" type="button" onclick={() => void clearInbox()} disabled={!messages.length || syncing}>
					<Trash2 size={16} aria-hidden="true" /> 清空
				</button>
				<button class="mail-app__button mail-app__button--accent" type="button" onclick={() => void handleLogout()}>
					<LogOut size={16} aria-hidden="true" /> 退出
				</button>
			</div>
		</header>

		{#if actionError}
			<div class="mail-app__notice mail-app__notice--error" role="alert">
				<AlertCircle size={17} aria-hidden="true" /> <span>{actionError}</span>
				<button type="button" class="mail-app__notice-close" onclick={() => (actionError = "")} aria-label="关闭提示"><X size={16} aria-hidden="true" /></button>
			</div>
		{/if}

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
							<div><dt>收件人</dt><dd>{selectedMessage.address || address}</dd></div>
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
