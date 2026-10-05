<script lang="ts">
import { onMount } from "svelte";
import {
	getTabBufferKey,
	loadLocalBuffer,
	removeLocalBuffer,
	saveLocalBuffer,
} from "@/utils/admin-editor-state";
import { friendUrlKey } from "@/utils/friend-data.mjs";
import {
	type FriendStatusReport,
	friendCheckedTime,
	friendStatusFor,
	friendStatusLabel,
	saveFriendRow,
} from "@/utils/friend-editor";

export let rows: Record<string, unknown>[] = [];
export let busy = false;
export let onsave: (rows: Record<string, unknown>[]) => Promise<boolean>;
export let onupload: (file: File) => Promise<string>;
export let ondirty: () => void;

type Draft = {
	title: string;
	desc: string;
	siteurl: string;
	imgurl: string;
	image: string;
	linkpage: string;
	tags: string[];
	weight: number;
	enabled: boolean;
	[key: string]: unknown;
};
const emptyDraft = (): Draft => ({
	title: "",
	desc: "",
	siteurl: "",
	imgurl: "",
	image: "",
	linkpage: "",
	tags: [],
	weight: 5,
	enabled: true,
});
let draft = emptyDraft();
let baseline: Draft | null = null;
let editingUrl: string | null = null;
let requireExisting = false;
let mounted = false;
let error = "";
let draftStatus = "";
let avatarFailed = false;
let uploadInput: HTMLInputElement;
let report: FriendStatusReport | null = null;
let statusError = "";
let uploading = false;
let submitting = false;
const key = () => getTabBufferKey(sessionStorage, "content:friends:form");
$: previewStatus = friendStatusFor(report, draft.siteurl);
$: if (mounted) {
	try {
		if (
			Object.values(draft).some(
				(value, index) => index < 4 && String(value).length,
			)
		) {
			const saved = saveLocalBuffer(localStorage, key(), {
				draft,
				editingUrl,
				requireExisting,
				baseline,
			});
			draftStatus = saved.ok ? "输入已暂存到本机" : saved.error;
		} else removeLocalBuffer(localStorage, key());
	} catch {
		draftStatus = "本机暂存不可用，请保留当前页面后重试。";
	}
}
function change() {
	error = "";
	avatarFailed = false;
	draft = { ...draft };
	ondirty();
}
function reset() {
	draft = emptyDraft();
	baseline = null;
	editingUrl = null;
	requireExisting = false;
	error = "";
	draftStatus = "";
	avatarFailed = false;
	try {
		if (mounted) removeLocalBuffer(localStorage, key());
	} catch {
		/* The current form can reset even if browser storage is denied. */
	}
}
function edit(row: Record<string, unknown>) {
	draft = {
		...emptyDraft(),
		...row,
		title: String(row.title || ""),
		desc: String(row.desc || ""),
		siteurl: String(row.siteurl || ""),
		imgurl: String(row.imgurl || ""),
		image: String(row.image || ""),
		linkpage: String(row.linkpage || ""),
		tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
	} as Draft;
	baseline = structuredClone(draft);
	editingUrl = friendUrlKey(draft.siteurl);
	requireExisting = true;
	error = "";
	avatarFailed = false;
}
async function submit(event: SubmitEvent) {
	event.preventDefault();
	if (busy || submitting || uploading) return;
	error = "";
	try {
		const next = saveFriendRow(
			rows,
			draft,
			editingUrl,
			requireExisting,
			baseline,
		);
		submitting = true;
		if (await onsave(next)) reset();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	} finally {
		submitting = false;
	}
}
async function toggle(row: Record<string, unknown>) {
	if (busy || submitting || uploading) return;
	await onsave(
		rows.map((item) =>
			item === row ? { ...item, enabled: !item.enabled } : item,
		),
	);
}
async function remove(row: Record<string, unknown>) {
	if (
		busy ||
		submitting ||
		uploading ||
		!confirm("确认删除友链「" + row.title + "」？")
	)
		return;
	if (
		(await onsave(rows.filter((item) => item !== row))) &&
		editingUrl === friendUrlKey(String(row.siteurl))
	)
		reset();
}
async function upload(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	uploading = true;
	error = "";
	try {
		if (file.size > 3 * 1024 * 1024) throw new Error("图片不能超过 3 MiB");
		const image = await onupload(file);
		if (!image) throw new Error("图片上传失败，原头像地址已保留。");
		draft.imgurl = image;
		change();
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	} finally {
		uploading = false;
		input.value = "";
	}
}
onMount(() => {
	try {
		const saved = loadLocalBuffer<{
			draft: Draft;
			editingUrl: string | null;
			requireExisting: boolean;
			baseline?: Draft | null;
		}>(localStorage, key());
		if (saved.value?.draft && typeof saved.value.draft.title === "string") {
			draft = { ...emptyDraft(), ...saved.value.draft };
			editingUrl = saved.value.editingUrl;
			requireExisting = saved.value.requireExisting;
			baseline = saved.value.baseline || null;
			ondirty();
		}
	} catch {
		draftStatus = "无法读取本机暂存，仍可填写并保存友链。";
	}
	mounted = true;
	const controller = new AbortController();
	void fetch("/api/friend-status", { signal: controller.signal })
		.then(async (response) => {
			if (!response.ok) throw new Error();
			const data = await response.json();
			if (!Array.isArray(data.results)) throw new Error();
			report = data;
		})
		.catch(() => {
			if (!controller.signal.aborted)
				statusError = "检测结果暂时不可用，友链仍正常显示。";
		});
	return () => controller.abort();
});
</script>

<div class="friend-editor">
  <div class="fe-workspace">
    <form class="fe-panel fe-form" onsubmit={submit}>
      <div class="fe-heading"><h3>{requireExisting ? "编辑友链" : "添加友链"}</h3><span>填写四项即可添加</span></div>
      <fieldset disabled={busy || submitting || uploading}>
        <label>站点名称<input required maxlength="120" bind:value={draft.title} oninput={change} placeholder="番茄主理人" /></label>
        <label>站点描述<textarea required maxlength="600" rows="3" bind:value={draft.desc} oninput={change} placeholder="躬身入局，心为主理，行有尺度，自持本心。"></textarea></label>
        <label>站点链接<input required type="url" bind:value={draft.siteurl} oninput={change} placeholder="https://blog.fqzlr.top/" /></label>
        <label>头像链接<div class="fe-avatar-input"><input required aria-label="头像链接" bind:value={draft.imgurl} oninput={change} placeholder="https://q1.qlogo.cn/g?b=qq&nk=20447289&s=640" /><button type="button" onclick={() => uploadInput.click()}>上传图片</button></div></label>
        <input class="fe-upload" bind:this={uploadInput} type="file" aria-label="上传头像" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onchange={upload} />
        <details class="fe-advanced"><summary>高级设置</summary>
          <div class="fe-advanced-fields">
            <label>标签<input value={draft.tags.join(", ")} oninput={event => {draft.tags = event.currentTarget.value.split(/[,，]/).map(value => value.trim()).filter(Boolean); change();}} placeholder="逗号分隔，可不填" /></label>
            <label>排序权重<input type="number" bind:value={draft.weight} oninput={change} /></label>
            <label>自定义封面<input bind:value={draft.image} oninput={change} placeholder="留空使用自动截图" /></label>
            <label>对方友链页<input type="url" bind:value={draft.linkpage} oninput={change} placeholder="填写后检测是否链接到本站" /></label>
            <label class="fe-checkbox"><input type="checkbox" bind:checked={draft.enabled} onchange={change} />启用友链</label>
          </div>
        </details>
        <div class="fe-actions"><button type="submit" class="fe-primary">{submitting ? "正在保存…" : requireExisting ? "保存修改" : "添加友链"}</button><button type="button" onclick={reset}>{requireExisting ? "取消编辑" : "清空"}</button></div>
      </fieldset>
      {#if error}<p class="fe-error" role="alert">{error}</p>{/if}
      {#if draftStatus}<small class="fe-muted" role="status">{draftStatus}</small>{/if}
    </form>
    <aside class="fe-panel fe-preview" aria-label="友链卡片预览">
      <div class="fe-heading"><h3>卡片预览</h3></div>
      {#if draft.image || previewStatus?.screenshotUrl}<img class="fe-cover" src={draft.image || previewStatus?.screenshotUrl || ""} alt="站点封面" />{/if}
      <div class="fe-preview-info"><div class="fe-avatar">{#if draft.imgurl && !avatarFailed}<img src={draft.imgurl} alt="头像预览" onerror={() => avatarFailed = true} />{:else}<span>{draft.title.charAt(0) || "友"}</span>{/if}</div><div><strong>{draft.title || "站点名称"}</strong><small>{draft.siteurl || "站点链接"}</small></div></div>
      <p>{draft.desc || "填写一段介绍，让朋友更快认识这个站点。"}</p>
      <small class="fe-muted">保存后自动启用；检测任务会生成站点截图。</small>
    </aside>
  </div>
  <section class="fe-list" aria-label="已有友链">
    <div class="fe-heading"><h3>已有友链</h3><span>{rows.length} 个站点</span></div>
    {#if rows.length === 0}<p class="fe-empty">还没有友链，填写上面的四项即可添加。</p>{/if}
    {#each rows as row}
      {@const status = friendStatusFor(report, String(row.siteurl))}
      <article class="friend-editor-row" data-friend-row class:fe-disabled={row.enabled === false}>
        <div class="fe-row-info"><strong>{String(row.title)}</strong><a href={String(row.siteurl)} target="_blank" rel="noopener noreferrer">{String(row.siteurl)}</a><p>{String(row.desc || "")}</p>
          <div class="fe-row-status"><span class="fe-status" data-status={status?.status || "unknown"}>{row.enabled === false ? "已停用 · " : ""}{friendStatusLabel(status)}</span>{#if status?.checkedAt}<small>{friendCheckedTime(status.checkedAt)} 检测{#if status.httpStatus} · HTTP {status.httpStatus}{/if}{#if status.latencyMs != null} · {status.latencyMs} ms{/if}</small>{/if}</div>
          {#if row.linkpage}<small class="fe-muted">反链：{status?.backlink === "found" ? "已找到" : status?.backlink === "missing" ? "未找到，建议人工确认" : "尚未检测"}</small>{/if}
        </div>
        <div class="fe-actions"><button type="button" onclick={() => edit(row)}>编辑</button><button type="button" onclick={() => void toggle(row)}>{row.enabled === false ? "启用" : "停用"}</button><button type="button" class="fe-delete" onclick={() => void remove(row)}>删除</button></div>
      </article>
    {/each}
    {#if statusError}<p class="fe-muted">{statusError}</p>{/if}
  </section>
</div>

<style>
.friend-editor{--fe-border:var(--a-border,#8884);--fe-muted:var(--a-muted,var(--content-meta,#888));--fe-accent:var(--a-accent,var(--primary,#00a29b));color:var(--a-text,var(--deep-text,inherit));margin-top:1.5rem;min-width:0}
.fe-workspace{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(230px,1fr);gap:1.2rem;align-items:start}.fe-panel{border:1px solid var(--fe-border);border-radius:1rem;padding:1.3rem;min-width:0;background:var(--a-surface,transparent)}
.fe-heading{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:1rem}.fe-heading h3{font-weight:600;font-size:1rem}.fe-heading span,.fe-muted,.fe-row-status small{font-size:.75rem;color:var(--fe-muted)}
fieldset{border:0;padding:0;margin:0;min-width:0}label{display:block;font-size:.83rem;margin-bottom:1rem}input,textarea{display:block;width:100%;border:1px solid var(--fe-border);border-radius:.55rem;background:transparent;color:inherit;padding:.65rem .8rem;margin-top:.4rem;min-width:0;box-sizing:border-box}textarea{resize:vertical;line-height:1.6}input:focus-visible,textarea:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--fe-accent);outline-offset:2px}
.fe-avatar-input{display:flex;gap:.5rem;align-items:center}.fe-avatar-input input{flex:1}.fe-avatar-input button{white-space:nowrap;margin-top:.4rem}.fe-upload{width:1px;height:1px;opacity:0;position:absolute;padding:0;border:0;pointer-events:none}.fe-advanced{border-top:1px solid var(--fe-border);padding-top:1rem;margin:1rem 0}summary{cursor:pointer;font-size:.8rem;color:var(--fe-muted)}.fe-advanced-fields{margin-top:1rem}.fe-checkbox{display:flex;align-items:center;gap:.6rem}.fe-checkbox input{width:auto;margin:0}
.fe-actions{display:flex;gap:.5rem;flex-wrap:wrap}button{border:1px solid var(--fe-border);border-radius:.5rem;padding:.55rem .8rem;font-size:.8rem;background:transparent;color:inherit;cursor:pointer}button:hover{border-color:var(--fe-accent)}button.fe-primary{background:var(--fe-accent);color:var(--a-bg,var(--card-bg,#fff));border-color:transparent;font-weight:600}button:disabled,fieldset:disabled{opacity:.65}.fe-error{font-size:.8rem;color:#d97973;margin:1rem 0}.fe-form>small{display:block;margin-top:.8rem}
.fe-cover{display:block;width:100%;height:8rem;object-fit:cover;border-radius:.6rem;margin-bottom:1rem}.fe-preview-info{display:flex;gap:.8rem;align-items:center}.fe-preview-info>div:last-child{min-width:0}.fe-preview-info strong,.fe-preview-info small{display:block;overflow-wrap:anywhere}.fe-preview-info small{font-size:.7rem;color:var(--fe-muted);margin-top:.3rem}.fe-avatar{width:3rem;height:3rem;border-radius:50%;overflow:hidden;flex-shrink:0;background:color-mix(in srgb,var(--fe-accent) 15%,transparent);display:grid;place-items:center;font-weight:600}.fe-avatar img{width:100%;height:100%;object-fit:cover}.fe-preview p{font-size:.85rem;line-height:1.7;margin:1.1rem 0;overflow-wrap:anywhere}.fe-preview>.fe-muted{display:block;border-top:1px solid var(--fe-border);padding-top:1rem}
.fe-list{margin-top:1.8rem}.friend-editor-row{display:flex;justify-content:space-between;align-items:center;gap:1rem;border:1px solid var(--fe-border);border-radius:.8rem;padding:1rem;margin-bottom:.7rem;min-width:0}.fe-row-info{min-width:0}.fe-row-info strong{display:block;font-size:.9rem}.fe-row-info a{display:block;font-size:.75rem;color:var(--fe-muted);overflow-wrap:anywhere;margin-top:.3rem}.fe-row-info p{font-size:.8rem;margin:.5rem 0;overflow-wrap:anywhere}.fe-row-status{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.fe-status{font-size:.7rem;border:1px solid var(--fe-border);border-radius:99px;padding:.15rem .5rem}.fe-status[data-status=ok]{color:var(--fe-accent)}.fe-status[data-status=error]{color:#d97973}.fe-status[data-status=restricted]{color:#b89751}.fe-disabled{opacity:.6}.fe-delete{color:#d97973}.fe-empty{padding:1.8rem 0;text-align:center;font-size:.85rem;color:var(--fe-muted)}
@media(max-width:900px){.fe-workspace{grid-template-columns:1fr}.friend-editor-row{align-items:flex-start;flex-direction:column}.fe-heading{flex-wrap:wrap}.fe-panel{padding:1rem}.fe-avatar-input{flex-wrap:wrap}.fe-avatar-input input{flex-basis:100%}}
</style>
