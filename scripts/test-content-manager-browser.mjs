import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = process.env.BROWSER_BASE_URL || process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4322";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 let selectedResponse=null;
 let lastWrite=null;
 let pauseWrite=false, enteredWrite, releaseWrite;
 let recordSource='---\ntitle: "测试笔记"\ndraft: true\ntags: []\n---\n仓库正文';
 await page.route("**/api/writing/**",async route=>{
  const req=route.request(),url=new URL(req.url());
  assert.equal(req.headers()["x-writing-auth"],undefined,"请求不应使用浏览器存储凭据");
  if(url.pathname.endsWith("/session/"))return route.fulfill({json:{authenticated:true}});
  if(url.pathname.includes("/posts/"))return route.fulfill({json:{posts:[],mode:"deployed"}});
  if(url.pathname.includes("/content/sidebar/"))return route.fulfill({json:{source:JSON.stringify({enable:true,position:"both",leftComponents:[],rightComponents:[],mobileBottomComponents:[]}),version:"s1"}});
  if(url.pathname.includes("/content/announcements/"))return route.fulfill({json:{source:JSON.stringify({title:"隔离公告",closable:false,items:[]}),version:"a1"}});
  if(selectedResponse && req.method()==="GET")return route.fulfill(selectedResponse);
  if(req.method()==="PUT") {
   lastWrite=req.postDataJSON();
   if(pauseWrite) await new Promise(resolve=>{releaseWrite=resolve;enteredWrite();});
   return route.fulfill({status:409,json:{error:"版本冲突，请重新读取后合并"}});
  }
  if(url.searchParams.has("file"))return route.fulfill({json:{file:"分组/笔记.md",source:recordSource,version:"read-v1"}});
  return route.fulfill({json:{items:url.pathname.includes("notebooks")?[{file:"分组/笔记.md"}]:[]}});
 });
 await page.goto(origin+"/admin/#content",{waitUntil:"domcontentloaded"});
 await page.locator(".admin-shell").waitFor();
 const records=page.locator("#admin-records");
 const refresh=records.getByRole("button",{name:"打开 / 刷新内容管理",exact:true});
 await records.waitFor({state:"visible"});
 assert.equal(await records.getByRole("navigation",{name:"内容模块"}).count(),0,"嵌入后台时内容模块只从左栏切换");
 for (const response of [
  {status:404,contentType:"text/plain",body:"The page could not be found",expected:"内容管理接口不可用（HTTP 404）"},
  {status:502,contentType:"text/html",body:"<html>Bad Gateway</html>",expected:"内容管理接口不可用（HTTP 502）"},
  {status:200,contentType:"text/html",body:"<html>Unexpected page</html>",expected:"内容管理接口返回了无效数据（HTTP 200）"},
  {status:200,contentType:"application/json",body:JSON.stringify({items:[]}),expected:""},
 ]) {
  const {expected,...fixture}=response;selectedResponse=fixture;
  const pending=page.waitForResponse(r=>r.url().includes("/api/writing/content/"));
  await refresh.click();await (await pending).finished();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("打开 / 刷新内容管理"))?.disabled);
  assert.equal(await records.getByRole("status").last().innerText(),expected);
 }
 selectedResponse=null;
 await page.getByRole("navigation",{name:"后台导航"}).getByRole("button",{name:/笔记本/}).click();
 await records.getByRole("button",{name:"分组/笔记.md",exact:true}).click();
 const edit=records.locator("textarea").first();
 await edit.fill('---\ntitle: "测试笔记"\ndraft: true\ntags: []\n---\n保留未提交笔记');
 await page.waitForFunction(()=>Object.values(localStorage).some(value=>value.includes("保留未提交笔记")));
 pauseWrite=true;
 const inFlight=new Promise(resolve=>enteredWrite=resolve);
 await records.getByRole("button",{name:"保存",exact:true}).click();
 await inFlight;
 assert.equal(await edit.isDisabled(),true,"内容记录慢保存期间应禁用编辑，避免丢失新增输入");
 releaseWrite();pauseWrite=false;
 await records.getByText(/版本冲突/).first().waitFor();
 assert.equal(lastWrite.version,"read-v1");
 assert.match(await edit.inputValue(),/保留未提交笔记/);
 await records.getByRole("button",{name:"读取仓库版进行比较",exact:true}).click();
 assert.equal(await records.locator("textarea[readonly]").first().inputValue(),recordSource);
 await page.reload({waitUntil:"domcontentloaded"});
 await records.waitFor({state:"visible"});
 await records.locator("textarea").first().waitFor();
 await page.waitForFunction(()=>document.querySelector("#admin-records textarea")?.value.includes("保留未提交笔记"));
 selectedResponse={status:401,contentType:"application/json",body:JSON.stringify({error:"登录已过期，请重新登录"})};
 page.once("dialog",dialog=>dialog.accept());
 await refresh.click();
 await page.locator(".admin-login").waitFor();
 assert.match(await page.locator(".admin-login").innerText(),/登录已过期/);
 console.log("Content manager browser regression passed: Cookie session, 404/502/invalid JSON, notebook read, original version, 409 recovery and expired session.");
} finally {await browser.close();}
