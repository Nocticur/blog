<script lang="ts">
import { ImagePlus, LoaderCircle, Reply, Smile, X } from "lucide-svelte";
import { tick } from "svelte";
import { commentConfig } from "@/config";
import type {
	GuestbookAuthUser,
	GuestbookChatMessage,
	GuestbookEmojiItem,
	GuestbookEmojiPack,
	GuestbookProfile,
} from "@/types/guestbook-chat";
import {
	getGuestbookInitials,
	loadGuestbookEmojiPacks,
	uploadGuestbookImage,
} from "@/utils/guestbook-chat";

interface Props {
	profile: GuestbookProfile;
	authUser: GuestbookAuthUser | null;
	draft: string;
	replyTarget: GuestbookChatMessage | null;
	composerError: string;
	isOffline: boolean;
	isSending: boolean;
	loggingIn: boolean;
	loginMode: "enable" | "force" | "disable";
	onProfileChange: (profile: GuestbookProfile) => void;
	onDraftChange: (draft: string) => void;
	onReplyCancel: () => void;
	onLogin: () => void;
	onLogout: () => void;
	onSend: () => void;
	onToolError: (message: string) => void;
}

let {
	profile,
	authUser,
	draft,
	replyTarget,
	composerError,
	isOffline,
	isSending,
	loggingIn,
	loginMode,
	onProfileChange,
	onDraftChange,
	onReplyCancel,
	onLogin,
	onLogout,
	onSend,
	onToolError,
}: Props = $props();

const MAX_DRAFT_LENGTH = 300;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const emojiSources = commentConfig.waline?.emoji ?? [];
const imageUploadURL = commentConfig.waline?.imageUploadURL ?? "";

let textarea = $state<HTMLTextAreaElement | null>(null);
let emojiTrigger = $state<HTMLButtonElement | null>(null);
let emojiPanel = $state<HTMLDivElement | null>(null);
let imageInput = $state<HTMLInputElement | null>(null);
let showEmojiPicker = $state(false);
let isComposing = $state(false);
let isLoadingEmojis = $state(false);
let isUploadingImage = $state(false);
let emojiError = $state("");
let emojiPacks = $state<GuestbookEmojiPack[]>([]);
let activeEmojiPackIndex = $state(0);

const inputDisabled = $derived(
	isOffline || (loginMode === "force" && !authUser),
);
const authName = $derived(authUser?.display_name || "访客");
const activeEmojiPack = $derived(emojiPacks[activeEmojiPackIndex] ?? null);

function updateProfile(field: keyof GuestbookProfile, value: string) {
	onProfileChange({ ...profile, [field]: value });
}

function resizeTextarea() {
	if (!textarea) return;
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
}

function handleInput(event: Event) {
	onDraftChange((event.currentTarget as HTMLTextAreaElement).value);
	resizeTextarea();
}

function handleKeydown(event: KeyboardEvent) {
	if (
		event.key !== "Enter" ||
		event.shiftKey ||
		event.isComposing ||
		isComposing ||
		isUploadingImage
	) {
		return;
	}
	event.preventDefault();
	onSend();
}

function handleWindowKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") showEmojiPicker = false;
}

function handleWindowPointerdown(event: PointerEvent) {
	const target = event.target;
	if (!(target instanceof Node)) return;
	if (emojiTrigger?.contains(target) || emojiPanel?.contains(target)) return;
	showEmojiPicker = false;
}

function insertContent(content: string): boolean {
	if (!textarea) {
		const nextDraft = `${draft}${content}`;
		if (nextDraft.length > MAX_DRAFT_LENGTH) {
			onToolError(`消息不能超过 ${MAX_DRAFT_LENGTH} 个字符`);
			return false;
		}
		onDraftChange(nextDraft);
		return true;
	}

	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const nextDraft = `${draft.slice(0, start)}${content}${draft.slice(end)}`;
	if (nextDraft.length > MAX_DRAFT_LENGTH) {
		onToolError(`消息不能超过 ${MAX_DRAFT_LENGTH} 个字符`);
		return false;
	}
	onDraftChange(nextDraft);
	void tick().then(() => {
		if (!textarea) return;
		textarea.focus();
		textarea.setSelectionRange(start + content.length, start + content.length);
		resizeTextarea();
	});
	return true;
}

async function loadEmojis() {
	if (isLoadingEmojis) return;
	isLoadingEmojis = true;
	emojiError = "";
	try {
		emojiPacks = await loadGuestbookEmojiPacks(emojiSources);
		activeEmojiPackIndex = 0;
	} catch (error) {
		emojiError =
			error instanceof Error
				? error.message
				: "Waline 表情加载失败，请稍后重试";
	} finally {
		isLoadingEmojis = false;
	}
}

function toggleEmojiPicker() {
	showEmojiPicker = !showEmojiPicker;
	if (showEmojiPicker && emojiPacks.length === 0) void loadEmojis();
}

function insertEmoji(emoji: GuestbookEmojiItem) {
	insertContent(`![${emoji.key}](${emoji.url} "emoji")`);
}

function openImagePicker() {
	showEmojiPicker = false;
	imageInput?.click();
}

async function handleImageSelection(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	if (!file.type.startsWith("image/")) {
		onToolError("只能上传图片文件");
		return;
	}
	if (file.size > MAX_IMAGE_SIZE) {
		onToolError("图片不能超过 5 MB");
		return;
	}

	isUploadingImage = true;
	onToolError("");
	try {
		const url = await uploadGuestbookImage(file, imageUploadURL);
		const alt = file.name
			.replace(/\.[^.]+$/u, "")
			.replace(/[[\]]/gu, "")
			.trim();
		insertContent(`\n![${alt || "图片"}](${url})\n`);
	} catch (error) {
		onToolError(
			error instanceof Error ? error.message : "图片上传失败，请稍后重试",
		);
	} finally {
		isUploadingImage = false;
	}
}
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointerdown={handleWindowPointerdown}
/>

<footer class="guestbook-composer">
	{#if replyTarget}
		<div class="guestbook-composer__reply">
			<Reply size={16} aria-hidden="true" />
			<div>
				<span>回复 @{replyTarget.nick}</span>
				<small>{replyTarget.body.slice(0, 80)}</small>
			</div>
			<button type="button" onclick={onReplyCancel} aria-label="取消引用" title="取消引用">
				<X size={18} aria-hidden="true" />
			</button>
		</div>
	{/if}

	{#if authUser}
		<div class="guestbook-composer__signed-in">
			<div class="guestbook-composer__signed-avatar" aria-hidden="true">
				<span>{getGuestbookInitials(authName)}</span>
				{#if authUser.avatar}
					<img src={authUser.avatar} alt="" referrerpolicy="no-referrer" />
				{/if}
			</div>
			<strong>{authName}</strong>
			<span>{authUser.type === "administrator" ? "管理员" : "已登录"}</span>
		</div>
	{:else}
		<div class="guestbook-composer__identity-fields">
			<label>
				<span>昵称</span>
				<input
					value={profile.nick}
					oninput={(event) => updateProfile("nick", event.currentTarget.value)}
					maxlength="30"
					autocomplete="nickname"
					placeholder="你的昵称"
					aria-required="true"
				/>
			</label>
			<label>
				<span>邮箱</span>
				<input
					value={profile.mail}
					oninput={(event) => updateProfile("mail", event.currentTarget.value)}
					maxlength="100"
					type="email"
					autocomplete="email"
					placeholder="用于头像，不公开"
				/>
			</label>
			<label>
				<span>网址</span>
				<input
					value={profile.link}
					oninput={(event) => updateProfile("link", event.currentTarget.value)}
					maxlength="200"
					type="url"
					autocomplete="url"
					placeholder="可选"
				/>
			</label>
		</div>
	{/if}

	<div class="guestbook-composer__editor">

		<textarea
			bind:this={textarea}
			value={draft}
			oninput={handleInput}
			onkeydown={handleKeydown}
			oncompositionstart={() => (isComposing = true)}
			oncompositionend={() => (isComposing = false)}
			rows="3"
			maxlength="300"
			placeholder={loginMode === "force" && !authUser
				? "登录后参与聊天"
				: "说点什么..."}
			aria-label="聊天消息"
			disabled={inputDisabled}
		></textarea>

		<div class="guestbook-composer__footer">
			<div class="guestbook-composer__tools">
				<button
					bind:this={emojiTrigger}
					type="button"
					class:is-active={showEmojiPicker}
					onclick={toggleEmojiPicker}
					aria-label="选择表情"
					aria-expanded={showEmojiPicker}
					aria-controls="guestbook-emoji-picker"
					title="表情"
					disabled={inputDisabled}
				>
					<Smile size={20} aria-hidden="true" />
				</button>
				<button
					type="button"
					onclick={openImagePicker}
					aria-label="上传图片"
					title="图片"
					disabled={inputDisabled || isUploadingImage}
				>
					{#if isUploadingImage}
						<LoaderCircle class="is-spinning" size={20} aria-hidden="true" />
					{:else}
						<ImagePlus size={20} aria-hidden="true" />
					{/if}
				</button>
				<input
					bind:this={imageInput}
					class="guestbook-composer__file-input"
					type="file"
					accept="image/*"
					onchange={handleImageSelection}
					tabindex="-1"
					aria-hidden="true"
				/>
			</div>

			<div class="guestbook-composer__actions">
				<span class="guestbook-composer__count">{draft.length}/300</span>
				{#if loginMode !== "disable"}
					{#if authUser}
						<button
							class="guestbook-composer__login guestbook-composer__login--logout"
							type="button"
							onclick={onLogout}
							title="退出 Waline 登录"
						>
							退出
						</button>
					{:else}
						<button
							class="guestbook-composer__login"
							type="button"
							onclick={onLogin}
							disabled={loggingIn}
						>
							{loggingIn ? "登录中" : "登录"}
						</button>
					{/if}
				{/if}

				<button
					class="guestbook-composer__send"
					type="button"
					onclick={onSend}
					disabled={inputDisabled || isSending || isUploadingImage}
					aria-busy={isSending}
				>
					{isSending ? "发送中" : "发送"}
				</button>
			</div>
		</div>

		{#if showEmojiPicker}
			<div
				bind:this={emojiPanel}
				id="guestbook-emoji-picker"
				class="guestbook-composer__emojis"
				role="dialog"
				aria-label="Waline 表情"
			>
				{#if isLoadingEmojis}
					<div class="guestbook-composer__emoji-state" role="status">
						<LoaderCircle class="is-spinning" size={18} aria-hidden="true" />加载表情
					</div>
				{:else if emojiError}
					<div class="guestbook-composer__emoji-state" role="alert">
						<span>{emojiError}</span>
						<button type="button" onclick={() => void loadEmojis()}>重试</button>
					</div>
				{:else if activeEmojiPack}
					<div class="guestbook-composer__emoji-tabs" role="tablist" aria-label="表情包">
						{#each emojiPacks as pack, index}
							<button
								type="button"
								role="tab"
								aria-selected={activeEmojiPackIndex === index}
								class:is-active={activeEmojiPackIndex === index}
								onclick={() => (activeEmojiPackIndex = index)}
								title={pack.name}
							>
								<img src={pack.icon} alt={pack.name} loading="lazy" />
							</button>
						{/each}
					</div>
					<div class="guestbook-composer__emoji-grid">
						{#each activeEmojiPack.items as emoji}
							<button
								type="button"
								onclick={() => insertEmoji(emoji)}
								aria-label={`插入 ${emoji.key}`}
								title={emoji.key}
							>
								<img src={emoji.url} alt="" loading="lazy" />
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if composerError}
		<div class="guestbook-composer__error" role="alert">{composerError}</div>
	{/if}
</footer>
