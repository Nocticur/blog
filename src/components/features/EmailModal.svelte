<script lang="ts">
import { Mail, X } from "lucide-svelte";
import { onMount } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { bindEmailModalController } from "@/utils/email-modal-controller";
import { url as formatUrl } from "@/utils/url-utils";
import "@/styles/components/email-modal.css";

const mailUrl = formatUrl("/role");

let visible = $state(false);
let frameLoaded = $state(false);
let modalEl: HTMLDivElement;

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

function handleKeyDown(event: KeyboardEvent) {
	if (event.key === "Escape" && visible) close();
}

function handleBackdropClick(event: MouseEvent) {
	if (event.target === modalEl) close();
}

onMount(() => {
	const unbind = bindEmailModalController(window, { toggle });
	document.addEventListener("keydown", handleKeyDown);

	return () => {
		unbind();
		document.removeEventListener("keydown", handleKeyDown);
		if (visible) document.body.style.overflow = "";
	};
});
</script>

{#if visible}
	<!-- data-lenis-prevent：弹窗内的滚轮交给 Cloud Mail 原生滚动 -->
	<div
		bind:this={modalEl}
		class="email-modal-overlay"
		data-lenis-prevent
		role="dialog"
		aria-modal="true"
		aria-label={i18n(I18nKey.email)}
		onclick={handleBackdropClick}
	>
		<div class="email-modal-panel">
			<header class="email-modal-header">
				<div class="email-modal-title">
					<span class="email-modal-title-icon" aria-hidden="true">
						<Mail size={20} />
					</span>
					<span class="email-modal-title-text">{i18n(I18nKey.email)}</span>
				</div>
				<button
					type="button"
					class="email-modal-close"
					title={i18n(I18nKey.close)}
					aria-label={i18n(I18nKey.close)}
					onclick={close}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<div class="email-modal-frame" aria-busy={!frameLoaded}>
				{#if !frameLoaded}
					<div class="email-modal-loading" aria-hidden="true">
						<span class="email-modal-loading-dot"></span>
						<span class="email-modal-loading-dot"></span>
						<span class="email-modal-loading-dot"></span>
					</div>
				{/if}
				<iframe
					src={mailUrl}
					title={i18n(I18nKey.email)}
					class="email-modal-iframe"
					loading="eager"
					onload={() => {
						frameLoaded = true;
					}}
				></iframe>
			</div>
		</div>
	</div>
{/if}
