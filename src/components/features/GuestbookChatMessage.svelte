<script lang="ts">
import {
	Laptop,
	LoaderCircle,
	MapPin,
	Monitor,
	Reply,
	RotateCcw,
	Trash2,
} from "lucide-svelte";
import type { GuestbookChatMessage } from "@/types/guestbook-chat";
import { getGuestbookInitials } from "@/utils/guestbook-chat";
import { renderGuestbookMessage } from "@/utils/guestbook-chat-markup";

interface Props {
	message: GuestbookChatMessage;
	referencedMessage?: GuestbookChatMessage;
	timeLabel: string;
	onReply: (message: GuestbookChatMessage) => void;
	onJump: (message: GuestbookChatMessage) => void;
	onRetry: (message: GuestbookChatMessage) => void;
	onDiscard: (message: GuestbookChatMessage) => void;
}

let {
	message,
	referencedMessage,
	timeLabel,
	onReply,
	onJump,
	onRetry,
	onDiscard,
}: Props = $props();

const quotePreview = $derived(
	referencedMessage
		? referencedMessage.body.replace(/\s+/gu, " ").slice(0, 72)
		: "原消息暂未加载",
);
const renderedBody = $derived(renderGuestbookMessage(message.body));
</script>

<article
	id={`guestbook-message-${message.id}`}
	class:is-admin={message.isAdmin}
	class:is-failed={message.localState === "failed"}
	class:is-sending={message.localState === "sending"}
	class="guestbook-message"
>
	<div class="guestbook-message__avatar" aria-hidden="true">
		<span>{getGuestbookInitials(message.nick)}</span>
		{#if message.avatar}
			<img
				src={message.avatar}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				onerror={(event) =>
					((event.currentTarget as HTMLImageElement).style.display = "none")}
			/>
		{/if}
	</div>

	<div class="guestbook-message__column">
		<div class="guestbook-message__heading">
			{#if message.link}
				<a
					class="guestbook-message__author-link"
					href={message.link}
					target="_blank"
					rel="nofollow noopener noreferrer"
					title={`访问 ${message.nick} 的网站`}
				>
					{message.nick}
				</a>
			{:else}
				<strong>{message.nick}</strong>
			{/if}
			{#if message.isAdmin}
				<span class="guestbook-message__badge guestbook-message__badge--admin">站长</span>
			{/if}
			{#if message.label}
				<span class="guestbook-message__badge">{message.label}</span>
			{/if}
			<time datetime={new Date(message.createdAt).toISOString()}>{timeLabel}</time>
			{#if message.status === "waiting"}
				<span class="guestbook-message__badge guestbook-message__badge--waiting">审核中</span>
			{/if}
		</div>

		<div class="guestbook-message__bubble-row">
			<div class="guestbook-message__bubble">
				{#if message.replyToId}
					<button
						class="guestbook-message__quote"
						type="button"
						onclick={() => onJump(message)}
					>
						<span>@{message.replyToNick || "访客"}</span>
						<small>{quotePreview}</small>
					</button>
				{/if}
				<div class="guestbook-message__body">{@html renderedBody}</div>
			</div>

			{#if !message.localState}
				<button
					class="guestbook-message__reply"
					type="button"
					onclick={() => onReply(message)}
					aria-label={`回复 ${message.nick}`}
					title="引用回复"
				>
					<Reply size={16} aria-hidden="true" />
				</button>
			{/if}
		</div>

		<div class="guestbook-message__meta">
			{#if message.browser}
				<span><Monitor size={14} aria-hidden="true" />{message.browser}</span>
			{/if}
			{#if message.os}
				<span><Laptop size={14} aria-hidden="true" />{message.os}</span>
			{/if}
			{#if message.addr}
				<span><MapPin size={14} aria-hidden="true" />{message.addr}</span>
			{/if}
			{#if message.localState === "sending"}
				<span><LoaderCircle class="is-spinning" size={14} aria-hidden="true" />发送中</span>
			{/if}
		</div>

		{#if message.localState === "failed"}
			<div class="guestbook-message__failure" role="alert">
				<span>{message.failureReason}</span>
				<button type="button" onclick={() => onRetry(message)}>
					<RotateCcw size={14} aria-hidden="true" />重试
				</button>
				<button type="button" onclick={() => onDiscard(message)}>
					<Trash2 size={14} aria-hidden="true" />删除
				</button>
			</div>
		{/if}
	</div>
</article>
