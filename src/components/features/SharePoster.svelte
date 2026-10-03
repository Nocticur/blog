<script lang="ts">
export let title: string, description: string, author: string, qr: string;
let dialog: HTMLDialogElement;
let png = "";
let error = "";
let busy = false;
function lines(ctx: CanvasRenderingContext2D, text: string, width: number) {
	const result: string[] = [];
	let line = "";
	for (const char of text) {
		if (char === "\n" || ctx.measureText(line + char).width > width) {
			result.push(line);
			line = char === "\n" ? "" : char;
		} else line += char;
	}
	if (line) result.push(line);
	return result;
}
async function generate() {
	busy = true;
	error = "";
	try {
		await document.fonts.ready;
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("浏览器不支持图片生成");
		canvas.width = 1200;
		ctx.font = "bold 56px sans-serif";
		const heading = lines(ctx, title, 1032);
		ctx.font = "28px sans-serif";
		const summary = lines(ctx, description.slice(0, 500), 1032);
		canvas.height = Math.max(
			750,
			200 + heading.length * 76 + summary.length * 42 + 300,
		);
		const dark = document.documentElement.classList.contains("dark");
		ctx.fillStyle = dark ? "#171717" : "#fafafa";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = dark ? "#fafafa" : "#171717";
		ctx.font = "24px sans-serif";
		ctx.fillText(author, 84, 85);
		let y = 185;
		ctx.font = "bold 56px sans-serif";
		for (const line of heading) {
			ctx.fillText(line, 84, y);
			y += 76;
		}
		y += 25;
		ctx.font = "28px sans-serif";
		ctx.globalAlpha = 0.7;
		for (const line of summary) {
			ctx.fillText(line, 84, y);
			y += 42;
		}
		ctx.globalAlpha = 1;
		const image = new Image();
		image.src = qr;
		await image.decode();
		ctx.drawImage(image, 84, canvas.height - 235, 160, 160);
		ctx.font = "26px sans-serif";
		ctx.fillText("扫码阅读全文", 280, canvas.height - 140);
		png = canvas.toDataURL("image/png");
		dialog.showModal();
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
	} finally {
		busy = false;
	}
}
</script>
<button type="button" class="poster-button" disabled={busy} onclick={generate}>{busy?"生成中…":"生成海报"}</button>
{#if error}<p role="alert">{error}</p>{/if}
<dialog bind:this={dialog} class="rounded-xl p-4 max-w-[90vw] bg-white text-neutral-900">
 <div class="flex justify-between gap-4 mb-3"><a class="underline" href={png} download={`${title.slice(0,30).replace(/[\\/:*?"<>|]/g,"_")}.png`}>下载 PNG</a><button onclick={()=>dialog.close()}>关闭预览</button></div>
 {#if png}<img src={png} alt={`《${title}》分享海报预览`} class="max-h-[75vh] w-auto mx-auto"/>{/if}
</dialog>
<style>
 .poster-button{border:1px solid #8885;border-radius:.6rem;padding:.5rem .75rem}
 /* The modal remains interactive after the containing hover menu closes. */
 dialog{pointer-events:auto;visibility:visible}
 dialog::backdrop{background:#0009;pointer-events:auto}
</style>
