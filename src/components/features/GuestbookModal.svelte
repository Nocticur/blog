<script lang="ts">
import { onMount } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { navigateToPage } from "@utils/navigation-utils";
import { url as formatUrl } from "@/utils/url-utils";
import { bindGuestbookModalController } from "@/utils/guestbook-modal-controller";
import GuestbookChat from "@/components/features/GuestbookChat.svelte";
import "@/styles/components/guestbook-chat.css";

// --- State ---
let visible = $state(false);
let modalEl: HTMLDivElement;

// --- Open / Close ---
export function open() {
	if (visible) return;
	visible = true;
	document.body.style.overflow = "hidden";
}

function close() {
	if (!visible) return;
	visible = false;
	document.body.style.overflow = "";
}

function toggle() {
	if (visible) close();
	else open();
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "Escape" && visible) {
		close();
	}
}

function handleBackdropClick(e: MouseEvent) {
	if (e.target === modalEl) {
		close();
	}
}

function handleOpenFullPage(e: MouseEvent) {
	e.preventDefault();
	close();
	navigateToPage(formatUrl("/guestbook/"));
}

// --- Initialization ---
onMount(() => {
	const unbind = bindGuestbookModalController(window, { toggle });
	document.addEventListener("keydown", handleKeyDown);

	return () => {
		unbind();
		document.removeEventListener("keydown", handleKeyDown);
		// 组件卸载时若弹窗仍开着，恢复 body 滚动
		if (visible) document.body.style.overflow = "";
	};
});
</script>

{#if visible}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<!-- data-lenis-prevent：首页 Lenis 平滑滚动激活时，弹窗内滚轮交给原生处理 -->
	<div
		bind:this={modalEl}
		class="gb-modal-overlay"
		data-lenis-prevent
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.guestbook)}
	>
		<div class="gb-modal-panel">
			<header class="gb-modal-header">
				<div class="gb-modal-header__left">
					<span class="gb-modal-header__icon" aria-hidden="true">
						<svg width="1em" height="1em" viewBox="0 0 24 24">
							<path
								fill="currentColor"
								d="M4 14v-2h7v2zm0-4V8h11v2zm0-4V4h11v2zm9 14v-3.075l5.525-5.5q.225-.225.5-.325t.55-.1q.3 0 .575.113t.5.337l.925.925q.2.225.313.5t.112.55t-.1.563t-.325.512l-5.5 5.5zm6.575-5.6l.925-.975l-.925-.925l-.95.95z"
							/>
						</svg>
					</span>
					<span class="gb-modal-header__name">{i18n(I18nKey.guestbook)}</span>
					<span class="gb-modal-header__subtitle"
						>{i18n(I18nKey.guestbookSubtitle)}</span
					>
				</div>
				<div class="gb-modal-header__actions">
					<a
						href={formatUrl("/guestbook/")}
						class="gb-modal-icon-btn"
						title={i18n(I18nKey.guestbookOpenFullPage)}
						aria-label={i18n(I18nKey.guestbookOpenFullPage)}
						onclick={handleOpenFullPage}
					>
						<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
							<path
								fill="currentColor"
								d="M5 21q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h7v2H5v14h14v-7h2v7q0 .825-.587 1.413T19 21zm4.7-5.3l-1.4-1.4L17.6 5H14V3h7v7h-2V6.4z"
							/>
						</svg>
					</a>
					<button
						type="button"
						class="gb-modal-icon-btn"
						title={i18n(I18nKey.close)}
						aria-label={i18n(I18nKey.close)}
						onclick={close}
					>
						<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
							<path
								fill="currentColor"
								d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z"
							/>
						</svg>
					</button>
				</div>
			</header>
			<div class="gb-modal-body">
				<GuestbookChat />
			</div>
		</div>
	</div>
{/if}

<style>
	.gb-modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: oklch(0 0 0 / 0.3);
		animation: gb-modal-fade-in 0.2s ease;
	}

	@keyframes gb-modal-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes gb-modal-slide-up {
		from {
			opacity: 0;
			transform: translateY(1rem) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.gb-modal-panel {
		display: flex;
		flex-direction: column;
		width: min(920px, 94vw);
		height: min(80vh, 780px);
		overflow: hidden;
		border-radius: 1rem;
		background: var(--page-bg);
		border: 1px solid color-mix(in oklab, var(--deep-text) 14%, transparent);
		box-shadow:
			0 24px 60px -12px rgb(0 0 0 / 0.35),
			0 8px 20px -8px rgb(0 0 0 / 0.25);
		animation: gb-modal-slide-up 0.25s ease;
	}

	.gb-modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-shrink: 0;
		padding: 0.875rem 1.25rem;
		border-bottom: 1px solid
			color-mix(in oklab, var(--deep-text) 10%, transparent);
	}

	.gb-modal-header__left {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		overflow: hidden;
	}

	.gb-modal-header__icon {
		display: inline-flex;
		align-items: center;
		align-self: center;
		font-size: 1.25rem;
		color: var(--primary);
	}

	.gb-modal-header__name {
		font-weight: 700;
		font-size: 1rem;
		color: var(--deep-text);
		white-space: nowrap;
	}

	.gb-modal-header__subtitle {
		font-size: 0.8rem;
		color: color-mix(in oklab, var(--deep-text) 55%, transparent);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.gb-modal-header__actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.gb-modal-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5rem;
		font-size: 1.1rem;
		color: color-mix(in oklab, var(--deep-text) 65%, transparent);
		transition:
			background-color 0.2s,
			color 0.2s,
			transform 0.15s;
	}

	.gb-modal-icon-btn:hover {
		color: var(--primary);
		background: color-mix(in oklab, var(--deep-text) 8%, transparent);
	}

	.gb-modal-icon-btn:active {
		transform: scale(0.92);
	}

	.gb-modal-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* 弹窗内 chat 填满剩余高度，内部消息区自行滚动 */
	.gb-modal-body :global(.guestbook-chat) {
		flex: 1;
		min-height: 0;
		height: auto;
	}

	@media (max-width: 640px) {
		.gb-modal-overlay {
			padding: 0.5rem;
		}

		.gb-modal-panel {
			width: 100%;
			height: calc(100dvh - 1rem);
			border-radius: 0.75rem;
		}

		.gb-modal-header__subtitle {
			display: none;
		}
	}
</style>
