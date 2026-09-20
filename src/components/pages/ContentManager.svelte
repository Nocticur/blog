<script lang="ts">
  const modules = [
    ["dynamic","动态"],["notebooks","笔记本"],["places","足迹"],["routines","规划"],
    ["friends","友链"],["navigation","工具导航"],["gallery","相册"],["sponsors","赞助者"],["feeds","朋友圈订阅"],
  ];
  let module = "dynamic", items: {file:string}[] = [], file = "", source = "", version = "";
  let opened = false, busy = false, message = "", dirty = false, album = "", uploaded = "";
  $: isList = ["friends","navigation","gallery","sponsors","feeds"].includes(module);
  async function request(method: string, body?: object, suffix = "") {
    const token = sessionStorage.getItem("firefly-writing-auth");
    if (!token) throw new Error("请先在上方登录写作后台");
    const response = await fetch(`/api/writing/content/${module}${suffix.startsWith("?")?"/"+suffix:suffix+"/"}`, {
      method, headers: {"Content-Type":"application/json","x-writing-auth":token},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }
  async function action(fn:()=>Promise<void>) {
    if(busy) return;
    busy=true; message="";
    try { await fn(); } catch(error) { message=error instanceof Error?error.message:String(error); }
    finally { busy=false; }
  }
  const mayLeave = () => !dirty || confirm("有未保存内容，确认放弃？");
  async function load() {
    const data = await request("GET");
    if(isList) { file="list.json"; source=data.source; version=data.version; items=[]; }
    else { items=data.items; file=""; source=""; version=""; }
    dirty=false; opened=true;
  }
  async function choose(next:string) {
    if(!mayLeave()) return;
    module=next; isList=["friends","navigation","gallery","sponsors","feeds"].includes(module);
    await load();
  }
  async function read(next:string) {
    if(!mayLeave()) return;
    const data=await request("GET",undefined,`?file=${encodeURIComponent(next)}`);
    file=next; source=data.source; version=data.version; dirty=false;
  }
  function create() {
    if(!mayLeave()) return;
    file="";version="";dirty=false;
    source=module==="dynamic"?"---\npublished: "+new Date().toISOString().slice(0,10)+"\ndraft: true\ntags: []\n---\n":
      "---\ntitle: \"\"\ndraft: true\ntags: []\n"+(module==="routines"?"status: todo\ntime: \"\"\n":module==="places"?"photos: []\n":"")+"---\n";
  }
  async function save() {
    const data=await request(version?"PUT":"POST",{file,source,version});
    version=data.version;dirty=false;message="已保存。线上内容将在重新构建后生效。";
    if(!isList) items=(await request("GET")).items;
  }
  async function remove() {
    if(!version || !confirm(`确认删除 ${file}？`)) return;
    await request("DELETE",{file,version}); await load(); message="已删除";
  }
  async function upload(event:Event) {
    const input=event.target as HTMLInputElement, image=input.files?.[0]; if(!image) return;
    if(image.size>4*1024*1024) throw new Error("图片不能超过 4 MB");
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(image);});
    uploaded=(await request("POST",{dataUrl,album},"/images")).image;
    message="图片已上传，将下方路径填入 photos、cover 或 Markdown 正文。";input.value="";
  }
</script>

<section class="card-base p-6 my-6">
  <h2 class="text-xl font-semibold">内容管理</h2>
  <p class="text-sm text-neutral-500 my-3">与文章共用登录。支持 Markdown 正文和完整元信息；列表以 JSON 编辑。草稿不会公开。</p>
  <button disabled={busy} onclick={()=>{if(mayLeave())void action(load);}} class="control">打开 / 刷新内容管理</button>
  {#if opened}
    <nav aria-label="内容模块" class="flex flex-wrap gap-2 my-4">
      {#each modules as [key,label]}<button class="control" aria-pressed={module===key} disabled={busy} onclick={()=>action(()=>choose(key))}>{label}</button>{/each}
    </nav>
    <div class="grid gap-4 md:grid-cols-[12rem_1fr]">
      <div class="space-y-2">
        {#if !isList}<button class="control" disabled={busy} onclick={create}>新建草稿</button>{/if}
        {#each items as item}<button class="block text-left break-all text-sm py-2" disabled={busy} onclick={()=>action(()=>read(item.file))}>{item.file}</button>{/each}
      </div>
      <div class="min-w-0">
        <label class="block text-sm">文件名（笔记本使用“笔记本名/条目.md”）
          <input class="control w-full my-2" bind:value={file} disabled={isList || !!version || busy} placeholder="记录.md" />
        </label>
        <label class="block text-sm">{isList?"JSON 列表":"Frontmatter 与 Markdown"}
          <textarea class="control w-full font-mono my-2 min-h-80" bind:value={source} oninput={()=>dirty=true} disabled={busy} spellcheck="false"></textarea>
        </label>
        <div class="flex flex-wrap gap-3">
          <button class="control" disabled={busy || !file} onclick={()=>action(save)}>保存</button>
          {#if !isList && version}<button class="control" disabled={busy} onclick={()=>action(remove)}>删除当前记录</button>{/if}
        </div>
        <div class="mt-5 space-y-2">
          {#if module==="gallery"}<label class="block">相册 ID <input class="control" bind:value={album} /></label>{/if}
          <label class="block text-sm">上传图片（4 MB 以内）<input class="block mt-2" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={busy} onchange={event=>action(()=>upload(event))}/></label>
          {#if uploaded}<input aria-label="已上传图片路径" readonly class="control w-full" value={uploaded} />{/if}
        </div>
      </div>
    </div>
  {/if}
  <p role="status" class="mt-3 text-sm whitespace-pre-wrap">{busy?"正在处理…":message}</p>
</section>
<style>
  .control {border:1px solid #8886;border-radius:.6rem;padding:.6rem .85rem;background:transparent;color:inherit}
  button[aria-pressed="true"] {background:var(--primary);color:var(--card-bg)}
  button:disabled{opacity:.5} textarea{resize:vertical;line-height:1.6}
</style>
