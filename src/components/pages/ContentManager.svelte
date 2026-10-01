<script lang="ts">
  import { onMount } from "svelte";
  import { contentModules, isContentModule } from "@/utils/admin-modules";
  import { getTabBufferKey, loadLocalBuffer, removeLocalBuffer, saveLocalBuffer } from "@/utils/admin-editor-state";
  export let authenticated = false;
  export let selectedModule = "dynamic";
  export let embedded = false;
  export let isActive = true;
  export let onsessionexpired: (() => void) | undefined = undefined;
  interface Buffer { file: string; source: string; version: string; previousLocal: string }
  interface Reply { file?: string; source: string; version: string; items: { file: string }[]; image?: string; commit?: { url?: string }; error?: string }
  interface Workspace {
    items: { file: string }[]; file: string; source: string; version: string;
    opened: boolean; dirty: boolean; album: string; uploaded: string; localStatus: string;
    conflict: boolean; repository: Reply | null; previousLocal: string; message: string;
  }
  const workspaces = new Map<string, Workspace>();
  let module = isContentModule(selectedModule) ? selectedModule : "dynamic", items: { file: string }[] = [], file = "", source = "", version = "";
  let opened = false, busy = false, message = "", dirty = false, album = "", uploaded = "", localStatus = "";
  let conflict = false, repository: Reply | null = null, previousLocal = "";
  let lastSelectedModule = selectedModule;
  let mounted = false, initialized = false;
  $: requestedModule = isContentModule(selectedModule) ? selectedModule : "dynamic";
  $: moduleTransition = busy && embedded && requestedModule !== module;
  $: requestedLabel = contentModules.find(item => item.id === requestedModule)?.label || "内容管理";
  $: isList = contentModules.find(item => item.id === module)?.isList === true;
  // Only an unopened workspace retries initialization after authentication returns.
  $: if (embedded && !authenticated && !opened) initialized = false;
  // A request completes in its original workspace before the latest selection is applied.
  $: if (mounted && authenticated && isActive && !busy && (selectedModule !== lastSelectedModule || !initialized)) {
    lastSelectedModule = selectedModule;
    initialized = true;
    void action(async () => {
      if (requestedModule !== module) await choose(requestedModule);
      else if (!opened) await load();
    });
  }
  $: if (opened && dirty) persist(file, source, version, previousLocal);

  const bufferKey = (currentFile: string) => getTabBufferKey(sessionStorage, "content:" + module + ":" + (currentFile || "__new__"));
  function persist(currentFile = file, currentSource = source, currentVersion = version, comparison = previousLocal) {
    if (!opened || !dirty) return;
    try {
      const result = saveLocalBuffer(localStorage, bufferKey(currentFile), { file: currentFile, source: currentSource, version: currentVersion, previousLocal: comparison });
      if (result.ok) {
        const reference = saveLocalBuffer(localStorage, getTabBufferKey(sessionStorage, "content:" + module + ":active"), currentFile);
        localStatus = reference.ok ? "已暂存到本机" : reference.error;
      } else localStatus = result.error;
    } catch { localStatus = "本机暂存失败，请保留当前页面或复制正文。"; }
  }
  function restore(next?: string) {
    try {
      const active = loadLocalBuffer<string>(localStorage, getTabBufferKey(sessionStorage, "content:" + module + ":active"));
      const target = next ?? active.value;
      if (typeof target !== "string") return;
      const saved = loadLocalBuffer<Buffer>(localStorage, bufferKey(target));
      if (saved.error) { localStatus = saved.error; return; }
      const value = saved.value;
      if (!value || typeof value.file !== "string" || typeof value.source !== "string" || typeof value.version !== "string") return;
      file = value.file; source = value.source; version = value.version; previousLocal = value.previousLocal || "";
      dirty = true; localStatus = "已恢复本机暂存；保存时仍校验最初读取的版本";
    } catch { localStatus = "无法读取本机暂存，请检查浏览器存储权限。"; }
  }
  function clearBuffer() {
    try {
      const cleared = removeLocalBuffer(localStorage, bufferKey(file));
      localStatus = cleared.ok ? "" : cleared.error;
    } catch { localStatus = "本机暂存无法清除，重新打开时请核对仓库内容。"; }
  }
  async function request(method: string, body?: object, suffix = "") {
    const targetModule = module;
    const response = await fetch("/api/writing/content/" + targetModule + (suffix.startsWith("?") ? "/" + suffix : suffix + "/"), {
      method, headers: { "Content-Type": "application/json" }, cache: "no-store",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) { persist(); onsessionexpired?.(); throw new Error("登录已过期，输入已保留，请重新登录。"); }
    let data: Reply;
    try { data = await response.json(); }
    catch { throw new Error((response.ok ? "内容管理接口返回了无效数据（HTTP " : "内容管理接口不可用（HTTP ") + response.status + "）"); }
    if (!response.ok) {
      if (response.status === 409) conflict = true;
      throw new Error(data.error || "请求失败（HTTP " + response.status + "），输入已保留。");
    }
    return data;
  }
  async function action(fn: () => Promise<void>) {
    if (busy || (embedded && (!authenticated || !isActive))) return;
    busy = true; message = "";
    try { await fn(); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { busy = false; }
  }
  const mayLeave = () => !dirty || confirm("当前内容尚未提交，继续切换？本机暂存会保留。若暂存失败，请先复制正文。");
  async function load() {
    const data = await request("GET");
    if (isList) { file = "list.json"; source = data.source; version = data.version; items = []; }
    else { items = data.items; file = ""; source = ""; version = ""; }
    dirty = false; opened = true; conflict = false; repository = null; previousLocal = ""; localStatus = "";
    restore(isList ? "list.json" : undefined);
  }
  async function choose(next: string) {
    if (!isContentModule(next) || next === module) return;
    persist();
    // Workspace switches retain their in-memory state even if browser storage is unavailable.
    workspaces.set(module, { items, file, source, version, opened, dirty, album, uploaded, localStatus, conflict, repository, previousLocal, message });
    module = next;
    isList = contentModules.find(item => item.id === module)?.isList === true;
    const workspace = workspaces.get(next);
    if (workspace) {
      ({ items, file, source, version, opened, dirty, album, uploaded, localStatus, conflict, repository, previousLocal, message } = workspace);
      if (opened) return;
    } else {
      items = []; file = ""; source = ""; version = ""; opened = false; dirty = false;
      album = ""; uploaded = ""; localStatus = ""; conflict = false; repository = null; previousLocal = ""; message = "";
    }
    await load();
  }
  async function read(next: string) {
    if (!mayLeave()) return;
    persist();
    const data = await request("GET", undefined, "?file=" + encodeURIComponent(next));
    file = next; source = data.source; version = data.version; dirty = false;
    conflict = false; repository = null; previousLocal = ""; localStatus = ""; restore(next);
  }
  function create() {
    if (!mayLeave()) return;
    persist(); file = ""; version = "";
    source = module === "dynamic" ? "---\npublished: " + new Date().toISOString().slice(0, 10) + "\ndraft: true\ntags: []\n---\n" :
      "---\ntitle: \"\"\ndraft: true\ntags: []\n" + (module === "routines" ? "status: todo\ntime: \"\"\n" : module === "places" ? "photos: []\n" : "") + "---\n";
    previousLocal = ""; conflict = false; repository = null; dirty = true; restore("");
  }
  async function save() {
    persist();
    const data = await request(version ? "PUT" : "POST", { file, source, version });
    version = data.version; dirty = false; conflict = false; repository = null; previousLocal = ""; clearBuffer();
    message = data.commit ? "已保存到仓库，等待构建部署。" : "已保存到本地文件。";
    if (!isList) items = (await request("GET")).items;
  }
  async function remove() {
    if (!version || !confirm("确认删除 " + file + "？")) return;
    await request("DELETE", { file, version }); dirty = false; clearBuffer();
    await load(); message = "已删除";
  }
  async function compare() {
    repository = await request("GET", undefined, isList ? "" : "?file=" + encodeURIComponent(file));
  }
  function useRepository() {
    if (!repository || !confirm("以仓库版为新的编辑基础？原本机内容会保留在下方供手动合并。")) return;
    previousLocal = source; source = repository.source; version = repository.version;
    conflict = false; message = "请比较并合并下方原本机内容，再手动保存。"; dirty = true; persist();
  }
  async function upload(event: Event) {
    const input = event.target as HTMLInputElement, image = input.files?.[0]; if (!image) return;
    try {
      if (image.size > 3 * 1024 * 1024) throw new Error("图片不能超过 3 MiB");
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(image); });
      uploaded = (await request("POST", { dataUrl, album }, "/images")).image || "";
      message = "图片已上传，将下方路径填入 photos、cover 或 Markdown 正文。";
    } finally { input.value = ""; }
  }
  onMount(() => {
    mounted = true;
    if (!embedded) {
      initialized = true;
      void action(async () => {
        if (!authenticated) {
          const session = await fetch("/api/writing/session/", { cache: "no-store" });
          if (!session.ok) throw new Error("请先登录后台，当前本机编辑将在登录后恢复。");
        }
        await load();
      });
    }
    const flush = () => persist();
    window.addEventListener("beforeunload", flush);
    return () => { persist(); window.removeEventListener("beforeunload", flush); };
  });
</script>

<section class="card-base p-6 my-6">
  <h2 class="text-xl font-semibold">{moduleTransition ? requestedLabel : contentModules.find(item => item.id === module)?.label || "内容管理"}</h2>
  <p class="text-sm text-neutral-500 my-3">支持 Markdown 正文和完整元信息；列表以 JSON 编辑。新建记录默认草稿，手动保存才提交。</p>
  {#if moduleTransition}<p role="status" class="cm-transition-note">正在切换至{requestedLabel}…请等待当前操作完成。</p>{/if}
  <fieldset disabled={busy || moduleTransition || (embedded && !authenticated)} class:cm-transition={moduleTransition} aria-busy={busy}>
  <button disabled={busy} onclick={() => { if (mayLeave()) void action(load); }} class="control">打开 / 刷新内容管理</button>
  {#if opened}
    {#if !embedded}
      <nav aria-label="内容模块" class="flex flex-wrap gap-2 my-4">
        {#each contentModules as item}<button class="control" aria-pressed={module === item.id} disabled={busy} onclick={() => void action(() => choose(item.id))}>{item.label}</button>{/each}
      </nav>
    {/if}
    <div class="grid gap-4 mt-4 md:grid-cols-[12rem_1fr]">
      <div class="space-y-2">
        {#if !isList}<button class="control" disabled={busy} onclick={create}>新建草稿</button>{/if}
        {#each items as item}<button class="block text-left break-all text-sm py-2" disabled={busy} onclick={() => action(() => read(item.file))}>{item.file}</button>{/each}
        {#if !isList && items.length === 0}<p class="text-sm text-neutral-500">暂无记录，可以新建草稿。</p>{/if}
      </div>
      <div class="min-w-0">
        <label class="block text-sm">文件名（笔记本使用“笔记本名/条目.md”）
          <input class="control w-full my-2" bind:value={file} oninput={() => dirty = true} disabled={isList || !!version || busy} placeholder="记录.md" />
        </label>
        <label class="block text-sm">{isList ? "JSON 列表" : "Frontmatter 与 Markdown"}
          <textarea class="control w-full font-mono my-2 min-h-80" bind:value={source} oninput={() => dirty = true} disabled={busy} spellcheck="false"></textarea>
        </label>
        <div class="flex flex-wrap gap-3">
          <button class="control" disabled={busy || !file} onclick={() => action(save)}>保存</button>
          {#if !isList && version}<button class="control" disabled={busy} onclick={() => action(remove)}>删除当前记录</button>{/if}
        </div>
        {#if conflict}
          <div class="mt-4 border border-amber-500/40 rounded-lg p-4">
            <p class="text-sm">仓库内容已修改，当前输入仍保留。请读取并比较后手动合并。</p>
            <button class="control mt-2" disabled={busy} onclick={() => action(compare)}>读取仓库版进行比较</button>
            {#if repository}
              <label class="block mt-3 text-sm">仓库版本（只读）<textarea readonly class="control w-full min-h-48 font-mono mt-2" value={repository.source}></textarea></label>
              <button class="control mt-2" disabled={busy} onclick={useRepository}>以仓库版为基础合并</button>
            {/if}
          </div>
        {/if}
        {#if previousLocal}<label class="block mt-4 text-sm">重新读取前的本机内容（只读，供手动合并）<textarea readonly class="control w-full min-h-48 font-mono mt-2" value={previousLocal}></textarea></label>{/if}
        <div class="mt-5 space-y-2">
          {#if module === "gallery"}<label class="block">相册 ID <input class="control" bind:value={album} /></label>{/if}
          <label class="block text-sm">上传图片（3 MiB 以内）<input class="block mt-2" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={busy} onchange={event => action(() => upload(event))} /></label>
          {#if uploaded}<input aria-label="已上传图片路径" readonly class="control w-full" value={uploaded} />{/if}
        </div>
      </div>
    </div>
  {/if}
  </fieldset>
  {#if localStatus}<p role="status" class="mt-3 text-sm">{localStatus}</p>{/if}
  <p role="status" class="mt-3 text-sm whitespace-pre-wrap">{busy ? "正在处理…" : message}</p>
</section>
<style>
  fieldset {border:0;min-width:0;margin:0;padding:0}
  .cm-transition {visibility:hidden}
  .cm-transition-note {padding:.85rem;border:1px solid #8886;border-radius:.6rem;color:var(--deep-text,inherit)}
  .control {border:1px solid #8886;border-radius:.6rem;padding:.6rem .85rem;background:transparent;color:inherit}
  button[aria-pressed="true"] {background:var(--primary);color:var(--card-bg)}
  button:disabled{opacity:.5} textarea{resize:vertical;line-height:1.6}
</style>
