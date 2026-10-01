import {chromium} from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const origin=process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4322";
const browser=await chromium.launch({channel:"chrome",headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const visit=async path=>{console.log(`Checking ${path}`);await page.goto(origin+path,{waitUntil:"domcontentloaded"});await page.waitForSelector(path==="/admin/"?".admin-shell":"main");assert.equal(await page.locator("vite-error-overlay").count(),0);};
try{
 await visit("/calendar/");
 const month=page.locator("#calendar-month");await month.waitFor();
 const initial=await month.inputValue();
 await page.getByRole("button",{name:"下个月",exact:true}).click();
 await page.waitForFunction(previous=>document.querySelector("#calendar-month").value!==previous,initial);
 await page.getByRole("button",{name:"上个月",exact:true}).click();
 assert.equal(await month.inputValue(),initial);
 await page.getByRole("button",{name:/\d{4}-\d{2}-01，/}).click();
 assert.ok(await page.getByRole("heading",{name:initial+"-01",exact:true}).count());
 await visit("/life/places/");
 await page.waitForFunction(()=>document.querySelector('svg[aria-label="世界足迹地图"] path')?.getAttribute("d")?.length>100);
 await page.getByRole("button",{name:"放大地图",exact:true}).click();
 const transform=await page.locator('svg[aria-label="世界足迹地图"] > g').getAttribute("transform");
 assert.match(transform,/scale\(1.5\)/);
 await page.getByRole("button",{name:"重置地图"}).click();
 for(const route of ["/dynamic/","/life/notebooks/","/life/routines/","/pengyou/","/timeline/"]){await visit(route);assert.ok((await page.locator("main").innerText()).trim().length>0);}
 await visit("/dynamic/");
 // Browser-only rows exercise filtering without publishing fixture content.
 await page.waitForFunction(()=>customElements.get("filtered-content"));
 await page.evaluate(()=>{
  const host=document.createElement("div");
  host.innerHTML='<filtered-content data-size="2"><div data-controls hidden><select data-filter><option value="">全部</option></select><select data-year><option value="">全部</option></select><span data-count></span></div><p data-empty hidden></p><div data-pagination><button data-prev>prev</button><span data-page></span><button data-next>next</button></div></filtered-content>';
  const el=host.firstElementChild;
  for(let i=0;i<5;i++){const row=document.createElement("article");row.dataset.filterItem="";row.dataset.tags=JSON.stringify([i%2?"B":"A"]);row.dataset.year="2026";row.textContent=String(i);el.append(row);}
  el.id="test-list";document.querySelector("main").append(el);
 });
 const fixture=page.locator("#test-list");await page.waitForFunction(()=>document.querySelector("#test-list")?.dataset.ready);
 assert.equal(await fixture.locator("[data-filter-item]:visible").count(),2);
 await fixture.locator("[data-next]").click();assert.equal(await fixture.locator("[data-page]").innerText(),"2 / 3");
 await fixture.locator("[data-filter]").selectOption("B");assert.equal(await fixture.locator("[data-count]").innerText(),"共 2 条");
 // Navigate via an actual Swup link, then revisit the calendar without a reload.
 await page.getByRole("link",{name:"主页",exact:true}).first().click();
 await page.waitForURL(origin+"/");await page.waitForFunction(()=>Boolean(window.swup));
 await page.evaluate(()=>window.swup.navigate("/calendar/"));
 await page.waitForSelector("#calendar-month");
 await page.getByRole("button",{name:"下个月",exact:true}).click();
 let saved;
 await page.route("**/api/writing/session/**",route=>route.fulfill({json:{authenticated:true,mode:"dev"}}));
 await page.route("**/api/writing/posts/**",route=>route.fulfill({json:{posts:[],mode:"dev"}}));
 await page.route("**/api/writing/content/**",async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==="GET") {
   if(url.pathname.includes("/sidebar/"))return route.fulfill({json:{source:JSON.stringify({enable:true,position:"both",leftComponents:[],rightComponents:[],mobileBottomComponents:[]}),version:"s1"}});
   if(url.pathname.includes("/announcements/"))return route.fulfill({json:{source:JSON.stringify({title:"公告",closable:false,items:[]}),version:"a1"}});
   return route.fulfill({json:url.pathname.includes("/feeds/")?{source:"[]",version:"v1"}:{items:[]}});
  }
  saved=request.postDataJSON();return route.fulfill({json:{ok:true,version:"v2",file:saved.file}});
 });
 await visit("/admin/");
 await page.getByRole("navigation",{name:"后台导航"}).getByRole("button",{name:"朋友圈订阅",exact:true}).click();
 await page.getByLabel("JSON 列表",{exact:true}).fill('[{"name":"Fixture","url":"https://example.test/rss"}]');
 await page.getByRole("button",{name:"保存",exact:true}).click();
 await page.getByText(/已保存/).first().waitFor();
 assert.equal(saved.version,"v1");assert.equal(JSON.parse(saved.source)[0].name,"Fixture");
 await page.unroute("**/api/writing/content/**");
 await page.unroute("**/api/writing/session/**");
 await page.unroute("**/api/writing/posts/**");
 const posts=await fs.readdir("dist/posts",{withFileTypes:true});
 const first=posts.find(entry=>entry.isDirectory());assert.ok(first);
 await visit("/posts/"+encodeURIComponent(first.name)+"/");
 const poster=page.getByRole("button",{name:"生成海报",exact:true});
 // Sharing menu is normally opened by the hero share button.
 await page.locator(".post-hero__share-menu").hover();
 await page.locator(".post-hero__share-menu").focus();
 await poster.click();
 await page.locator("dialog[open] img").waitFor();
 const png=await page.locator("dialog[open] img").getAttribute("src");assert.ok(png.startsWith("data:image/png;base64,"));
 const downloadPromise=page.waitForEvent("download");await page.getByRole("link",{name:"下载 PNG"}).click();
 assert.ok((await downloadPromise).suggestedFilename().endsWith(".png"));
 await page.getByRole("button",{name:"关闭预览"}).click();
 await page.setViewportSize({width:390,height:844});
 await visit("/calendar/");
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await fs.mkdir(".feature-screenshots",{recursive:true});
 await page.screenshot({path:".feature-screenshots/calendar-mobile.png",fullPage:true});
 assert.deepEqual(errors,[]);
 console.log("Browser verification passed: calendar, offline map, filters, Swup, editor requests, PNG download and mobile layout.");
}finally{await browser.close();}
