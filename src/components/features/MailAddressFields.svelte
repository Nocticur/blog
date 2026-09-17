<!--
  共享「邮箱前缀 + @ + 后缀下拉」控件：前台登录/注册与后台管理员登录、
  创建地址、创建用户统一复用。粘贴完整邮箱时自动拆分到两个字段；
  粘贴的后缀不在可选列表时置 pasteError，由父级拒绝提交。
-->
<script lang="ts">
	let {
		domains,
		prefix = $bindable(""),
		domain = $bindable(""),
		label = "邮箱前缀",
		idPrefix = "mail-address",
		disabled = false,
		autocomplete = "off",
		pasteError = $bindable(""),
	}: {
		domains: string[];
		prefix?: string;
		domain?: string;
		label?: string;
		idPrefix?: string;
		disabled?: boolean;
		autocomplete?: string;
		pasteError?: string;
	} = $props();

	function splitPasted(event: ClipboardEvent) {
		const text = (event.clipboardData?.getData("text") ?? "").trim();
		if (!text.includes("@")) return;
		event.preventDefault();
		const at = text.lastIndexOf("@");
		const local = text.slice(0, at).trim().toLowerCase();
		const pasted = text.slice(at + 1).trim().toLowerCase();
		prefix = local;
		pasteError = "";
		if (!local) {
			pasteError = "粘贴的内容不是有效的邮箱地址。";
			return;
		}
		if (domains.includes(pasted)) {
			domain = pasted;
		} else {
			pasteError = pasted
				? `不支持的后缀 @${pasted}，已保留前缀，请用下拉框选择后缀。`
				: "粘贴的内容不是有效的邮箱地址。";
		}
	}

	function clearPasteError() {
		pasteError = "";
	}

	// 域名清单异步到达或当前值失效时，收敛到可选列表的第一项
	$effect(() => {
		if (domains.length === 0) return;
		if (!domains.includes(domain)) domain = domains[0];
	});
</script>

<div class="mail-address-fields">
	<label class="mail-address-fields__field is-prefix" for="{idPrefix}-prefix">
		<span>{label}</span>
		<input
			id="{idPrefix}-prefix"
			type="text"
			spellcheck="false"
			{autocomplete}
			{disabled}
			bind:value={prefix}
			onpaste={splitPasted}
			oninput={clearPasteError}
		/>
	</label>
	<span class="mail-address-fields__at" aria-hidden="true">@</span>
	<label class="mail-address-fields__field is-domain" for="{idPrefix}-domain">
		<span>后缀</span>
		<select
			id="{idPrefix}-domain"
			{disabled}
			bind:value={domain}
			onchange={clearPasteError}
		>
			{#each domains as item (item)}
				<option value={item}>@{item}</option>
			{/each}
		</select>
	</label>
</div>
{#if pasteError}
	<p class="mail-address-fields__error" role="alert">{pasteError}</p>
{/if}

<style>
	.mail-address-fields {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) auto minmax(0, 1.1fr);
		align-items: end;
		gap: 0.45rem;
	}

	.mail-address-fields__field {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}

	.mail-address-fields__field > span {
		color: var(--mail-address-muted, color-mix(in oklab, currentColor 62%, transparent));
		font-size: 0.78rem;
		font-weight: 600;
	}

	.mail-address-fields__field input,
	.mail-address-fields__field select {
		width: 100%;
		min-width: 0;
		min-height: 2.6rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--mail-address-line, color-mix(in oklab, currentColor 16%, transparent));
		border-radius: var(--mail-address-radius, var(--radius-medium, 0.55rem));
		background: var(--mail-address-bg, transparent);
		color: inherit;
		font: inherit;
		font-size: 0.88rem;
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	/* 后缀下拉需完整展示最长的 "@nocticur.eu.cc" */
	.mail-address-fields__field.is-domain select {
		min-width: 9.75rem;
	}

	.mail-address-fields__field input::placeholder {
		color: color-mix(in oklab, currentColor 38%, transparent);
	}

	.mail-address-fields__field input:focus-visible,
	.mail-address-fields__field select:focus-visible {
		outline: none;
		border-color: var(--mail-address-focus, var(--primary));
		box-shadow: 0 0 0 0.18rem
			color-mix(in oklab, var(--mail-address-focus, var(--primary)) 15%, transparent);
	}

	.mail-address-fields__field input:disabled,
	.mail-address-fields__field select:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.mail-address-fields__at {
		padding-bottom: 0.72rem;
		color: var(--mail-address-muted, color-mix(in oklab, currentColor 62%, transparent));
		font-size: 0.9rem;
	}

	.mail-address-fields__error {
		grid-column: 1 / -1;
		margin: 0.15rem 0 0;
		color: color-mix(in oklab, #d94b4b 78%, currentColor);
		font-size: 0.78rem;
		line-height: 1.55;
	}

	@media (max-width: 480px) {
		.mail-address-fields {
			grid-template-columns: minmax(0, 1.2fr) auto minmax(0, 1.3fr);
			gap: 0.35rem;
		}

		.mail-address-fields__field input,
		.mail-address-fields__field select {
			padding-inline: 0.5rem;
			font-size: 0.84rem;
		}
	}
</style>
