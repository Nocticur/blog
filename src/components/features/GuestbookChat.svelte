<script lang="ts">
import { addComment, getComment, login } from "@waline/api";
import {
	AlertCircle,
	Bell,
	ChevronDown,
	ChevronRight,
	LoaderCircle,
	RefreshCw,
	RotateCcw,
	Users,
	WifiOff,
	X,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import type { GuestbookAnnouncementItem } from "@/config";
import { commentConfig, guestbookConfig } from "@/config";
import type {
	GuestbookAuthUser,
	GuestbookChatMessage as GuestbookMessage,
	GuestbookProfile,
} from "@/types/guestbook-chat";
import {
	buildGuestbookMessageBody,
	flattenGuestbookComments,
	getGuestbookErrorMessage,
	getGuestbookInitials,
	hasGuestbookReplyMarker,
	isGuestbookAuthError,
	mergeGuestbookMessages,
	normalizeGuestbookComment,
} from "@/utils/guestbook-chat";
import GuestbookChatComposer from "./GuestbookChatComposer.svelte";
import GuestbookChatMessage from "./GuestbookChatMessage.svelte";

const CHANNEL_PATH = "/guestbook/";
const PAGE_SIZE = 30;
const POLL_INTERVAL = 30_000;
const MIN_MESSAGE_LENGTH = 2;
const MAX_MESSAGE_LENGTH = 300;
const PROFILE_STORAGE_KEY = "guestbook-chat-profile";
const AUTH_STORAGE_KEY = "guestbook-chat-auth";
const DRAFT_STORAGE_KEY = "guestbook-chat-draft";
const serverURL = commentConfig.waline?.serverURL ?? "";
const lang = commentConfig.waline?.lang ?? "zh-CN";
const loginMode = commentConfig.waline?.login ?? "enable";
const announcements = guestbookConfig.announcements;

let messages = $state<GuestbookMessage[]>([]);
let profile = $state<GuestbookProfile>({ nick: "", mail: "", link: "" });
let authUser = $state<GuestbookAuthUser | null>(null);
let draft = $state("");
let replyTarget = $state<GuestbookMessage | null>(null);
let initialLoading = $state(true);
let initialError = $state("");
let syncError = $state("");
let composerError = $state("");
let loadingOlder = $state(false);
let syncing = $state(false);
let loggingIn = $state(false);
let isOffline = $state(false);
let currentPage = $state(1);
let totalPages = $state(0);
let newMessageCount = $state(0);
let lastSyncedAt = $state<number | null>(null);
let messageList = $state<HTMLDivElement | null>(null);
let announcementDialog = $state<HTMLDialogElement | null>(null);
let selectedAnnouncement = $state<GuestbookAnnouncementItem | null>(null);
let sidebarOpen = $state(false);
let pollTimer: number | undefined;
let dataController: AbortController | null = null;
let syncQueued = false;

const hasMore = $derived(currentPage < totalPages);
const isSending = $derived(
	messages.some((message) => message.localState === "sending"),
);
const chatMembers = $derived.by(() => {
	const members = new Map<
		string,
		Pick<GuestbookMessage, "nick" | "avatar" | "link" | "isAdmin">
	>();
	for (const message of messages) {
		const key = `${message.nick.trim().toLocaleLowerCase()}|${message.avatar}`;
		const current = members.get(key);
		if (!current || message.isAdmin) {
			members.set(key, {
				nick: message.nick,
				avatar: message.avatar,
				link: message.link,
				isAdmin: message.isAdmin,
			});
		}
	}
	return [...members.values()].sort(
		(left, right) => Number(right.isAdmin) - Number(left.isAdmin),
	);
});

function handleChatKeydown(event: KeyboardEvent) {
	if (event.key !== "Escape") return;
	sidebarOpen = false;
}

async function openAnnouncement(announcement: GuestbookAnnouncementItem) {
	selectedAnnouncement = announcement;
	sidebarOpen = false;
	await tick();
	if (!announcementDialog?.open) announcementDialog?.showModal();
	document.body.style.overflow = "hidden";
}

function closeAnnouncement() {
	if (announcementDialog?.open) announcementDialog.close();
	document.body.style.overflow = "";
}

function readStoredValue<T>(storage: Storage, key: string): T | null {
	try {
		const raw = storage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function readStoredString(storage: Storage, key: string): string {
	try {
		return storage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

function writeStoredValue(storage: Storage, key: string, value: unknown) {
	try {
		storage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage can be unavailable in private browsing or restrictive environments.
	}
}

function writeStoredString(storage: Storage, key: string, value: string) {
	try {
		storage.setItem(key, value);
	} catch {
		// Keep the in-memory state when persistence is unavailable.
	}
}

function removeStoredValue(storage: Storage, key: string) {
	try {
		storage.removeItem(key);
	} catch {
		// The in-memory state remains authoritative for the current page.
	}
}

function isAuthUser(value: unknown): value is GuestbookAuthUser {
	if (!value || typeof value !== "object") return false;
	const user = value as Partial<GuestbookAuthUser>;
	return (
		typeof user.display_name === "string" &&
		typeof user.email === "string" &&
		typeof user.token === "string" &&
		user.token.length > 0 &&
		typeof user.objectId === "number" &&
		(user.type === "administrator" || user.type === "guest")
	);
}

function isProfile(value: unknown): value is GuestbookProfile {
	if (!value || typeof value !== "object") return false;
	const storedProfile = value as Partial<GuestbookProfile>;
	return (
		typeof storedProfile.nick === "string" &&
		typeof storedProfile.mail === "string" &&
		typeof storedProfile.link === "string"
	);
}

function readAuthentication(): GuestbookAuthUser | null {
	const sessionUser = readStoredValue<unknown>(
		sessionStorage,
		AUTH_STORAGE_KEY,
	);
	if (isAuthUser(sessionUser)) return sessionUser;
	const persistentUser = readStoredValue<unknown>(
		localStorage,
		AUTH_STORAGE_KEY,
	);
	return isAuthUser(persistentUser) ? persistentUser : null;
}

function persistAuthentication(user: GuestbookAuthUser) {
	removeStoredValue(localStorage, AUTH_STORAGE_KEY);
	removeStoredValue(sessionStorage, AUTH_STORAGE_KEY);
	writeStoredValue(
		user.remember ? localStorage : sessionStorage,
		AUTH_STORAGE_KEY,
		user,
	);
}

function clearAuthentication() {
	authUser = null;
	removeStoredValue(localStorage, AUTH_STORAGE_KEY);
	removeStoredValue(sessionStorage, AUTH_STORAGE_KEY);
}

function finishDataRequest(controller: AbortController) {
	if (dataController !== controller) return;
	dataController = null;
	if (!syncQueued) return;
	syncQueued = false;
	queueMicrotask(() => void syncLatest());
}

function queueLatestSync() {
	if (dataController) {
		syncQueued = true;
		return;
	}
	void syncLatest();
}

function handleAuthenticationError(error: unknown): boolean {
	if (!authUser || !isGuestbookAuthError(error)) return false;
	clearAuthentication();
	composerError = "登录状态已失效，请重新登录";
	return true;
}

async function fetchPage(page: number, signal?: AbortSignal) {
	if (!serverURL) throw new Error("Waline 服务地址未配置");
	return getComment({
		serverURL,
		lang,
		path: CHANNEL_PATH,
		page,
		pageSize: PAGE_SIZE,
		sortBy: "insertedAt_desc",
		token: authUser?.token,
		signal,
	});
}

async function loadInitial() {
	if (isOffline) {
		initialLoading = false;
		initialError = "当前处于离线状态，恢复网络后将自动加载";
		return;
	}
	dataController?.abort();
	const controller = new AbortController();
	dataController = controller;
	syncing = false;
	loadingOlder = false;
	initialLoading = true;
	initialError = "";
	syncError = "";

	try {
		const response = await fetchPage(1, controller.signal);
		if (dataController !== controller) return;
		messages = mergeGuestbookMessages(
			messages,
			flattenGuestbookComments(response.data),
		);
		currentPage = 1;
		totalPages = response.totalPages;
		lastSyncedAt = Date.now();
		await tick();
		scrollToBottom(false);
	} catch (error) {
		if (controller.signal.aborted || dataController !== controller) return;
		const authenticationExpired = handleAuthenticationError(error);
		if (authenticationExpired) syncQueued = true;
		const message = getGuestbookErrorMessage(error);
		if (message && !authenticationExpired) {
			if (messages.length > 0) syncError = message;
			else initialError = message;
		}
	} finally {
		if (dataController === controller) {
			initialLoading = false;
			finishDataRequest(controller);
		}
	}
}

async function syncLatest() {
	if (initialError && messages.length === 0) {
		await loadInitial();
		return;
	}
	if (initialLoading || isOffline) return;
	if (dataController) {
		syncQueued = true;
		return;
	}
	const controller = new AbortController();
	dataController = controller;
	syncing = true;
	syncError = "";
	const wasNearBottom = isNearBottom();
	const knownIds = new Set(
		messages
			.filter((message) => !message.localState)
			.map((message) => message.id),
	);

	try {
		const response = await fetchPage(1, controller.signal);
		if (dataController !== controller) return;
		const incoming = flattenGuestbookComments(response.data);
		const freshCount = incoming.filter(
			(message) => !knownIds.has(message.id),
		).length;
		messages = mergeGuestbookMessages(messages, incoming);
		totalPages = response.totalPages;
		lastSyncedAt = Date.now();
		await tick();

		if (freshCount > 0 && wasNearBottom) scrollToBottom(true);
		else if (freshCount > 0) newMessageCount += freshCount;
	} catch (error) {
		if (controller.signal.aborted || dataController !== controller) return;
		const authenticationExpired = handleAuthenticationError(error);
		if (authenticationExpired) syncQueued = true;
		const message = getGuestbookErrorMessage(error);
		if (message && !authenticationExpired) syncError = message;
	} finally {
		if (dataController === controller) {
			syncing = false;
			finishDataRequest(controller);
		}
	}
}

async function loadOlder() {
	if (!hasMore || loadingOlder || !messageList || dataController) return;
	const controller = new AbortController();
	dataController = controller;
	loadingOlder = true;
	const previousHeight = messageList.scrollHeight;
	const nextPage = currentPage + 1;

	try {
		const response = await fetchPage(nextPage, controller.signal);
		if (dataController !== controller) return;
		messages = mergeGuestbookMessages(
			messages,
			flattenGuestbookComments(response.data),
		);
		currentPage = nextPage;
		totalPages = response.totalPages;
		await tick();
		messageList.scrollTop += messageList.scrollHeight - previousHeight;
	} catch (error) {
		if (controller.signal.aborted || dataController !== controller) return;
		const authenticationExpired = handleAuthenticationError(error);
		if (authenticationExpired) syncQueued = true;
		const message = getGuestbookErrorMessage(error);
		if (message && !authenticationExpired) syncError = message;
	} finally {
		if (dataController === controller) {
			loadingOlder = false;
			finishDataRequest(controller);
		}
	}
}

function startPolling() {
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = undefined;
	if (document.visibilityState !== "visible" || !navigator.onLine) return;
	pollTimer = window.setInterval(() => {
		if (document.visibilityState === "visible" && navigator.onLine) {
			void syncLatest();
		}
	}, POLL_INTERVAL);
}

function handleVisibilityChange() {
	if (document.visibilityState === "visible") {
		queueLatestSync();
		startPolling();
		return;
	}
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = undefined;
}

function handleOnline() {
	isOffline = false;
	queueLatestSync();
	startPolling();
}

function handleOffline() {
	isOffline = true;
	syncError = "网络已断开，恢复连接后将自动同步";
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = undefined;
	dataController?.abort();
}

function isNearBottom(): boolean {
	if (!messageList) return true;
	return (
		messageList.scrollHeight -
			messageList.scrollTop -
			messageList.clientHeight <
		120
	);
}

function scrollToBottom(smooth = true) {
	if (!messageList) return;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	messageList.scrollTo({
		top: messageList.scrollHeight,
		behavior: smooth && !reduceMotion ? "smooth" : "auto",
	});
	newMessageCount = 0;
}

function handleMessageScroll() {
	if (!messageList) return;
	if (messageList.scrollTop < 72 && hasMore) void loadOlder();
	if (isNearBottom()) newMessageCount = 0;
}

function formatMessageTime(value: number): string {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(value);
}

function formatSyncStatus(): string {
	if (isOffline) return "离线";
	if (syncing) return "同步中";
	if (syncError) return "同步失败";
	if (!lastSyncedAt) return "等待同步";
	return `同步于 ${new Intl.DateTimeFormat("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(lastSyncedAt)}`;
}

function dateKey(value: number): string {
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(value);
}

function dateLabel(value: number): string {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (dateKey(value) === dateKey(today.getTime())) return "今天";
	if (dateKey(value) === dateKey(yesterday.getTime())) return "昨天";
	return dateKey(value);
}

function shouldShowDate(index: number): boolean {
	return (
		index === 0 ||
		dateKey(messages[index - 1].createdAt) !==
			dateKey(messages[index].createdAt)
	);
}

function selectReply(message: GuestbookMessage) {
	if (!message.localState) replyTarget = message;
}

async function jumpToQuotedMessage(message: GuestbookMessage) {
	if (!message.replyToId) return;
	let target = messages.find((candidate) => candidate.id === message.replyToId);

	while (!target && hasMore && !loadingOlder) {
		await loadOlder();
		target = messages.find((candidate) => candidate.id === message.replyToId);
	}

	const element = document.getElementById(
		`guestbook-message-${message.replyToId}`,
	);
	if (!element) return;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	element.scrollIntoView({
		behavior: reduceMotion ? "auto" : "smooth",
		block: "center",
	});
	element.classList.remove("is-highlighted");
	requestAnimationFrame(() => element.classList.add("is-highlighted"));
	window.setTimeout(() => element.classList.remove("is-highlighted"), 1600);
}

function validateComposer(): string {
	const content = draft.trim();
	if (loginMode === "force" && !authUser) return "请先登录后再发送消息";
	if (!authUser && profile.nick.trim().length < 2) {
		return "昵称至少需要 2 个字符";
	}
	if (profile.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(profile.mail)) {
		return "邮箱格式不正确";
	}
	if (profile.link) {
		try {
			const website = new URL(profile.link);
			if (website.protocol !== "http:" && website.protocol !== "https:") {
				return "网站地址仅支持 http 或 https";
			}
		} catch {
			return "网站地址格式不正确";
		}
	}
	if (content.length < MIN_MESSAGE_LENGTH) {
		return `消息至少需要 ${MIN_MESSAGE_LENGTH} 个字符`;
	}
	if (content.length > MAX_MESSAGE_LENGTH) {
		return `消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`;
	}
	if (hasGuestbookReplyMarker(content)) {
		return "消息内容不能以系统引用标记开头";
	}
	return "";
}

async function sendMessage(replaceMessageId?: string) {
	if (isSending || isOffline) return;
	composerError = validateComposer();
	if (composerError) return;

	const content = draft.trim();
	const selectedTarget = replyTarget;
	const target = selectedTarget?.objectId ? selectedTarget : null;
	const tempId = `local-${Date.now()}`;
	const optimistic: GuestbookMessage = {
		id: tempId,
		nick: authUser?.display_name || profile.nick || "访客",
		avatar: authUser?.avatar || "",
		link: authUser?.url || profile.link.trim() || undefined,
		body: target ? `@${target.nick} ${content}` : content,
		createdAt: Date.now(),
		isAdmin: false,
		replyToId: target?.id,
		replyToNick: target?.nick,
		localState: "sending",
	};

	const retainedMessages = replaceMessageId
		? messages.filter((message) => message.id !== replaceMessageId)
		: messages;
	messages = [...retainedMessages, optimistic];
	draft = "";
	replyTarget = null;
	removeStoredValue(localStorage, DRAFT_STORAGE_KEY);
	await tick();
	scrollToBottom(true);

	try {
		const response = await addComment({
			serverURL,
			lang,
			token: authUser?.token,
			comment: {
				nick: authUser?.display_name || profile.nick.trim(),
				mail: authUser?.email || profile.mail.trim() || undefined,
				link: authUser?.url || profile.link.trim() || undefined,
				comment: buildGuestbookMessageBody(content, target),
				ua: navigator.userAgent,
				url: CHANNEL_PATH,
			},
		});

		if (response.errno || !response.data) {
			throw new Error(response.errmsg || "消息发送失败");
		}

		messages = messages.filter((message) => message.id !== tempId);
		messages = mergeGuestbookMessages(messages, [
			normalizeGuestbookComment(response.data),
		]);
		initialError = "";
		syncError = "";
		lastSyncedAt = Date.now();
		await tick();
		scrollToBottom(true);
		queueLatestSync();
	} catch (error) {
		handleAuthenticationError(error);
		const failureReason = getGuestbookErrorMessage(error) || "消息发送失败";
		messages = messages.map((message) =>
			message.id === tempId
				? { ...message, localState: "failed", failureReason }
				: message,
		);
	}
}

async function retryMessage(message: GuestbookMessage) {
	const target = message.replyToId
		? (messages.find((candidate) => candidate.id === message.replyToId) ?? null)
		: null;
	replyTarget = target;
	const prefix = target ? `@${target.nick} ` : "";
	draft =
		prefix && message.body.startsWith(prefix)
			? message.body.slice(prefix.length)
			: message.body;
	await tick();
	await sendMessage(message.id);
}

function discardMessage(message: GuestbookMessage) {
	messages = messages.filter((candidate) => candidate.id !== message.id);
}

async function handleLogin() {
	if (loggingIn) return;
	loggingIn = true;
	composerError = "";

	try {
		const user = await login({ serverURL, lang });
		authUser = user;
		persistAuthentication(user);
		await loadInitial();
	} catch (error) {
		composerError = getGuestbookErrorMessage(error) || "登录失败，请稍后重试";
	} finally {
		loggingIn = false;
	}
}

function handleLogout() {
	clearAuthentication();
	void loadInitial();
}

function handleProfileChange(nextProfile: GuestbookProfile) {
	profile = nextProfile;
	writeStoredValue(localStorage, PROFILE_STORAGE_KEY, nextProfile);
	composerError = "";
}

function handleDraftChange(nextDraft: string) {
	draft = nextDraft;
	writeStoredString(localStorage, DRAFT_STORAGE_KEY, nextDraft);
	composerError = "";
}

onMount(() => {
	const storedProfile = readStoredValue<unknown>(
		localStorage,
		PROFILE_STORAGE_KEY,
	);
	if (isProfile(storedProfile)) profile = storedProfile;
	if (loginMode === "disable") clearAuthentication();
	else authUser = readAuthentication();
	draft = readStoredString(localStorage, DRAFT_STORAGE_KEY);
	isOffline = !navigator.onLine;
	if (isOffline) {
		initialLoading = false;
		initialError = "当前处于离线状态，恢复网络后将自动加载";
	} else if (document.visibilityState === "visible") {
		void loadInitial();
	} else {
		initialLoading = false;
		initialError = "页面恢复可见后将自动加载聊天室";
	}
	startPolling();
	document.addEventListener("visibilitychange", handleVisibilityChange);
	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);

	return () => {
		if (pollTimer) window.clearInterval(pollTimer);
		dataController?.abort();
		if (announcementDialog?.open) announcementDialog.close();
		document.body.style.overflow = "";
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
	};
});
</script>

<svelte:window onkeydown={handleChatKeydown} />

<section class="guestbook-chat" aria-label="留言聊天室">
	<header class="guestbook-chat__header">
		<div class="guestbook-chat__channel">
			<div class="guestbook-chat__channel-mark" aria-hidden="true">GB</div>
			<div>
				<h2>留言聊天室</h2>
				<div
					class:is-failed={Boolean(syncError)}
					class="guestbook-chat__status"
					aria-live="polite"
				>
					<span class:is-offline={isOffline}></span>
					{formatSyncStatus()} · 30 s
				</div>
			</div>
		</div>

		<div class="guestbook-chat__actions">
			<button
				class="guestbook-chat__sidebar-toggle"
				type="button"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				aria-expanded={sidebarOpen}
				aria-controls="guestbook-chat-sidebar"
				title="群公告与聊天成员"
			>
				<Users size={18} aria-hidden="true" />
				<span>{chatMembers.length}</span>
			</button>
			<button
				class="guestbook-chat__refresh"
				type="button"
				onclick={() => void syncLatest()}
				disabled={syncing || initialLoading || isOffline}
				aria-label="立即刷新消息"
				title="立即刷新"
			>
				<RefreshCw
					class={syncing ? "is-spinning" : undefined}
					size={19}
					aria-hidden="true"
				/>
			</button>
		</div>
	</header>

	<div class="guestbook-chat__workspace">
		<div class="guestbook-chat__conversation">
			{#if initialLoading}
				<div
					class="guestbook-chat__loading"
					aria-label="正在加载聊天消息"
					aria-busy="true"
				>
					{#each Array(6) as _, index}
						<div class:is-admin={index % 3 === 2} class="guestbook-chat__skeleton">
							<div class="guestbook-chat__skeleton-avatar"></div>
							<div class="guestbook-chat__skeleton-copy">
								<div class="guestbook-chat__skeleton-name"></div>
								<div class="guestbook-chat__skeleton-bubble"></div>
								<div class="guestbook-chat__skeleton-meta"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if initialError && messages.length === 0}
				<div class="guestbook-chat__state" role="alert">
					<AlertCircle size={34} aria-hidden="true" />
					<h3>聊天室加载失败</h3>
					<p>{initialError}</p>
					<button type="button" onclick={() => void loadInitial()}>
						<RotateCcw size={17} aria-hidden="true" />重新加载
					</button>
				</div>
			{:else}
				<div
					class="guestbook-chat__messages custom-scrollbar"
					bind:this={messageList}
					onscroll={handleMessageScroll}
					aria-live="polite"
					aria-relevant="additions"
				>
					<div class="guestbook-chat__history">
						{#if hasMore}
							<button
								type="button"
								onclick={() => void loadOlder()}
								disabled={loadingOlder}
							>
								{#if loadingOlder}
									<LoaderCircle class="is-spinning" size={15} aria-hidden="true" />
								{/if}
								{loadingOlder ? "正在加载历史消息" : "加载更早消息"}
							</button>
						{:else if messages.length > 0}
							<span>已经到最早一条消息</span>
						{/if}
					</div>

					{#if messages.length === 0}
						<div class="guestbook-chat__empty">
							<div class="guestbook-chat__empty-mark">GB</div>
							<h3>还没有人发言</h3>
							<p>发送第一条消息，开启这段对话。</p>
						</div>
					{/if}

					{#each messages as message, index (message.id)}
						{#if shouldShowDate(index)}
							<div class="guestbook-chat__date">
								<span>{dateLabel(message.createdAt)}</span>
							</div>
						{/if}

						<GuestbookChatMessage
							{message}
							referencedMessage={message.replyToId
								? messages.find((candidate) => candidate.id === message.replyToId)
								: undefined}
							timeLabel={formatMessageTime(message.createdAt)}
							onReply={selectReply}
							onJump={(target) => void jumpToQuotedMessage(target)}
							onRetry={(target) => void retryMessage(target)}
							onDiscard={discardMessage}
						/>
					{/each}
				</div>
			{/if}

			<div class="guestbook-chat__composer-area">
				{#if !initialLoading && !initialError && newMessageCount > 0}
					<button
						class="guestbook-chat__new-messages"
						type="button"
						onclick={() => scrollToBottom(true)}
					>
						<ChevronDown size={17} aria-hidden="true" />{newMessageCount} 条新消息
					</button>
				{/if}

				{#if syncError || isOffline}
					<div class="guestbook-chat__sync-error" role="status">
						<WifiOff size={15} aria-hidden="true" />
						<span>{syncError || "当前处于离线状态"}</span>
						{#if !isOffline}
							<button type="button" onclick={() => void syncLatest()}>重试同步</button>
						{/if}
					</div>
				{/if}

				<GuestbookChatComposer
					{profile}
					{authUser}
					{draft}
					{replyTarget}
					{composerError}
					{isOffline}
					{isSending}
					{loggingIn}
					{loginMode}
					onProfileChange={handleProfileChange}
					onDraftChange={handleDraftChange}
					onReplyCancel={() => (replyTarget = null)}
					onLogin={() => void handleLogin()}
					onLogout={handleLogout}
					onSend={() => void sendMessage()}
					onToolError={(message) => (composerError = message)}
				/>
			</div>
		</div>

		{#if sidebarOpen}
			<button
				class="guestbook-chat__sidebar-overlay"
				type="button"
				onclick={() => (sidebarOpen = false)}
				aria-label="关闭群信息"
			></button>
		{/if}

		<aside
			id="guestbook-chat-sidebar"
			class:is-open={sidebarOpen}
			class="guestbook-chat__sidebar"
			aria-label="群信息"
		>
			<div class="guestbook-chat__sidebar-heading">
				<strong>群信息</strong>
				<button
					type="button"
					onclick={() => (sidebarOpen = false)}
					aria-label="关闭群信息"
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>

			<section class="guestbook-chat__announcement-panel" aria-label="群公告">
				<div class="guestbook-chat__panel-title">
					<Bell size={16} aria-hidden="true" />群公告
				</div>
				{#each announcements as announcement}
					<button
						class="guestbook-chat__announcement"
						type="button"
						onclick={() => void openAnnouncement(announcement)}
					>
						<span>
							<strong>{announcement.title}</strong>
							<ChevronRight size={16} aria-hidden="true" />
						</span>
						<p>{announcement.summary}</p>
					</button>
				{/each}
			</section>

			<section class="guestbook-chat__members" aria-label="聊天成员">
				<div class="guestbook-chat__panel-title">
					<Users size={16} aria-hidden="true" />聊天成员 <span>{chatMembers.length}</span>
				</div>
				<div class="guestbook-chat__member-list custom-scrollbar">
					{#each chatMembers as member (`${member.nick}-${member.avatar}`)}
						{#if member.link}
							<a
								class="guestbook-chat__member"
								href={member.link}
								target="_blank"
								rel="nofollow noopener noreferrer"
							>
								<span class="guestbook-chat__member-avatar">
									<span>{getGuestbookInitials(member.nick)}</span>
									{#if member.avatar}<img src={member.avatar} alt="" loading="lazy" />{/if}
								</span>
								<span>{member.nick}</span>
								{#if member.isAdmin}<small>站长</small>{/if}
							</a>
						{:else}
							<div class="guestbook-chat__member">
								<span class="guestbook-chat__member-avatar">
									<span>{getGuestbookInitials(member.nick)}</span>
									{#if member.avatar}<img src={member.avatar} alt="" loading="lazy" />{/if}
								</span>
								<span>{member.nick}</span>
								{#if member.isAdmin}<small>站长</small>{/if}
							</div>
						{/if}
					{/each}
				</div>
			</section>
		</aside>
	</div>

	<dialog
		bind:this={announcementDialog}
		class="privacy-modal guestbook-announcement-modal"
		aria-labelledby="guestbook-announcement-title"
		onclose={() => (document.body.style.overflow = "")}
		oncancel={(event) => {
			event.preventDefault();
			closeAnnouncement();
		}}
	>
		<div class="privacy-overlay" onclick={closeAnnouncement}></div>
		{#if selectedAnnouncement}
			<div class="privacy-panel">
				<div class="privacy-header">
					<h2 id="guestbook-announcement-title" class="privacy-title">
						{selectedAnnouncement.title}
					</h2>
					<button
						class="privacy-close"
						type="button"
						onclick={closeAnnouncement}
						aria-label="关闭群公告"
					>
						<X size={20} aria-hidden="true" />
					</button>
				</div>
				<div class="privacy-body guestbook-announcement-modal__body custom-scrollbar">
					<p>{selectedAnnouncement.summary}</p>
					{#if selectedAnnouncement.lead}<p>{selectedAnnouncement.lead}</p>{/if}
					<ul>
						{#each selectedAnnouncement.rules as rule}
							<li>{rule}</li>
						{/each}
					</ul>
				</div>
				<div class="privacy-footer">
					<button class="privacy-confirm-btn" type="button" onclick={closeAnnouncement}>
						我知道了
					</button>
				</div>
			</div>
		{/if}
	</dialog>
</section>
