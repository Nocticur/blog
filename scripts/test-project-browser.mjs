import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const origin=process.env.FEATURE_TEST_ORIGIN || 'http://127.0.0.1:4322';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(`${origin}/about/`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#calendar-grid')?.children.length > 0);
  assert.match(await page.locator('meta[property="og:image"]').getAttribute('content'), /^https?:\/\//);
  await page.goto(`${origin}/categories/`,{waitUntil:'domcontentloaded'});
  const categoryLinks=await page.locator('main a[href*="/categories/"]').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')).filter(href=>href!=='/categories/'));
  assert.ok(categoryLinks.length>0);
  for(const href of [...new Set(categoryLinks)]) {
    const response=await page.goto(origin+href,{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200,href); assert.equal(await page.locator('main h1').count(),1);
  }
  await page.goto(`${origin}/tags/`,{waitUntil:'domcontentloaded'});
  const links=await page.locator('main a[href*="/tags/"]').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')));
  assert.ok(links.length>0);
  for(const href of [...new Set(links)]) {
    const response=await page.goto(origin+href,{waitUntil:'domcontentloaded'});
    assert.equal(response.status(),200,href); assert.equal(await page.locator('main h1').count(),1);
  }
  let saved;
  await page.route('**/api/writing/session/**',route=>route.fulfill({json:{authenticated:true,mode:'deployed',repo:'test/repo',branch:'main',tokenReady:true}}));
  await page.route('**/api/writing/posts/**',route=>route.fulfill({json:{posts:[]}}));
  await page.route('**/api/writing/content/**',route=>{
    const request=route.request(), url=new URL(request.url());
    if(request.method()==='GET') return route.fulfill({json:url.searchParams.has('file') ? {source:'---\ntitle: Original\npublished: 2026-10-02\ndraft: true\ncustom: retained\n---\n# Preview\n<img src=x onerror="alert(1)">',version:'v1'} : {items:[{file:'fixture.mdx'}]}});
    saved=request.postDataJSON(); return route.fulfill({json:{ok:true,version:'v2',commit:{url:'https://github.com/test/repo/commit/test'}}});
  });
  await page.goto(`${origin}/admin/#dynamic`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'fixture.mdx',exact:true}).click();
  const source=page.getByLabel('Frontmatter 与 Markdown',{exact:true});
  const panel=source.locator('xpath=../..');
  await panel.getByText('元信息表单',{exact:true}).click();
  await panel.getByLabel('标题',{exact:true}).fill('Updated title');
  assert.match(await source.inputValue(),/custom: retained/);
  await panel.getByRole('button',{name:'发布记录',exact:true}).click();
  await page.getByRole('link',{name:'查看本次提交',exact:true}).waitFor();
  assert.match(saved.source,/draft: false/); assert.match(saved.source,/Updated title/);
  await panel.getByText('Markdown 预览',{exact:true}).click();
  assert.equal(await panel.locator('.custom-md [onerror]').count(),0);
  assert.ok(await panel.locator('.custom-md h1').count());
  assert.deepEqual(errors,[]);
  console.log('Project browser improvements passed');
} finally {await browser.close();}
