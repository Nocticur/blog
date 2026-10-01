import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.BROWSER_BASE_URL || 'http://localhost:4321';
const announcements = JSON.parse(await fs.readFile(new URL('../src/data/announcements.json', import.meta.url), 'utf8'));
const welcomeAnnouncement = announcements.items.find(item => item.tag === '欢迎' && item.enabled !== false);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  let geoRequests = 0;
  let releaseGeo;
  const geoReady = new Promise(resolve => { releaseGeo = resolve; });
  await page.route('https://v2.xxapi.cn/api/ip', async route => {
    geoRequests += 1;
    await geoReady;
    await route.fulfill({ json: { code: 200, data: { address: '隔离测试地区' } } });
  });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => customElements.get('home-ticker'));
  const ticker = page.locator('home-ticker');
  await ticker.waitFor({ state: 'attached' });
  await page.waitForTimeout(150);
  const outside = await ticker.evaluate(element => element.getBoundingClientRect().top >= innerHeight);
  if (outside) assert.equal(geoRequests, 0, '离屏横栏不能提前查询地区');
  await ticker.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('home-ticker')?.getAttribute('data-in-view') === 'true');
  await page.waitForTimeout(150);
  assert.equal(geoRequests, 1, '多份滚动克隆应共享一次地区查询');
  releaseGeo();
  await page.waitForFunction(() => document.querySelector('home-ticker')?.textContent.includes('欢迎隔离测试地区的朋友来到我的博客'));
  if (welcomeAnnouncement) assert.ok((await ticker.textContent()).includes(`[${welcomeAnnouncement.tag}] ${welcomeAnnouncement.content}`), '欢迎标签公告应保留原始正文，不能被地区问候替换');
  assert.ok(!(await ticker.textContent()).includes('[欢迎] 欢迎隔离测试地区'), '地区问候不携带公告标签');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('home-ticker').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('home-ticker')?.textContent.includes('欢迎隔离测试地区的朋友来到我的博客'));
  assert.equal(geoRequests, 1, '同一会话刷新应复用缓存');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  let mobileRequests = 0;
  await mobilePage.route('https://v2.xxapi.cn/api/ip', route => {
    mobileRequests += 1;
    return route.fulfill({ json: { code: 200, data: { address: '手机地区' } } });
  });
  await mobilePage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForFunction(() => customElements.get('home-ticker'));
  await mobilePage.waitForTimeout(250);
  assert.equal(await mobilePage.locator('home-ticker').isVisible(), false, '保留移动首页现有隐藏规则');
  assert.equal(mobileRequests, 0, '手机隐藏的横栏不能查询地区');
  await mobile.close();

  const failed = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const failedPage = await failed.newPage();
  await failedPage.route('https://v2.xxapi.cn/api/ip', route => route.fulfill({ status: 503, json: { error: 'isolated failure' } }));
  await failedPage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await failedPage.locator('home-ticker').scrollIntoViewIfNeeded();
  await failedPage.waitForFunction(() => sessionStorage.getItem('nocticur:visitor-welcome') === '欢迎来到我的博客');
  assert.ok((await failedPage.locator('home-ticker .home-ticker__welcome').first().textContent()).includes('欢迎来到我的博客'), '地区查询失败应保留通用问候');
  await failed.close();

  const late = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const latePage = await late.newPage();
  let releaseLate;
  let startedLate;
  const lateReady = new Promise(resolve => { releaseLate = resolve; });
  const lateStarted = new Promise(resolve => { startedLate = resolve; });
  await latePage.route('https://v2.xxapi.cn/api/ip', async route => {
    startedLate();
    await lateReady;
    await route.fulfill({ json: { code: 200, data: { address: '迟到地区' } } });
  });
  await latePage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await latePage.locator('home-ticker').scrollIntoViewIfNeeded();
  await lateStarted;
  await latePage.evaluate(() => {
    window.__removedTicker = document.querySelector('home-ticker');
    window.__removedTicker.remove();
  });
  releaseLate();
  await latePage.waitForFunction(() => sessionStorage.getItem('nocticur:visitor-welcome')?.includes('迟到地区'));
  await latePage.waitForTimeout(150);
  assert.equal(await latePage.evaluate(() => window.__removedTicker.textContent.includes('迟到地区')), false, '离开页面后不得用迟到响应更新已卸载组件');
  await late.close();

  // Supply an isolated document fixture with no announcement rows; the real ticker script stays unchanged.
  const empty = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const parserPage = await empty.newPage();
  const emptyPage = await empty.newPage();
  await emptyPage.route(origin + '/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const body = await parserPage.evaluate(source => {
      const document = new DOMParser().parseFromString(source, 'text/html');
      document.querySelectorAll('home-ticker .home-ticker__item:not(.home-ticker__welcome)').forEach(item => item.remove());
      return '<!DOCTYPE html>' + document.documentElement.outerHTML;
    }, html);
    await route.fulfill({ response, body });
  });
  let emptyRequests = 0;
  await emptyPage.route('https://v2.xxapi.cn/api/ip', route => {
    emptyRequests += 1;
    return route.fulfill({ json: { code: 200, data: { address: '零公告地区' } } });
  });
  await emptyPage.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await emptyPage.locator('home-ticker').scrollIntoViewIfNeeded();
  await emptyPage.waitForFunction(() => document.querySelector('home-ticker')?.textContent.includes('欢迎零公告地区的朋友来到我的博客'));
  assert.equal(await emptyPage.locator('home-ticker .home-ticker__item:not(.home-ticker__welcome)').count(), 0);
  assert.equal(emptyRequests, 1, '零公告时独立问候仍存在且仅查询一次');
  await empty.close();
  console.log('Visitor welcome passed: visible-only request, independent announcement content, shared clones, cache, mobile, failure, late response and zero-announcement fixture.');
} finally {
  await browser.close();
}
