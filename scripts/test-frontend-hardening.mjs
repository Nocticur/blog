import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { chromium } from 'playwright';

test('desktop outline collapses descendants, keeps sibling chapters visible and follows chapter links', async () => {
  const tree = await fs.readFile('src/utils/article-outline-tree.ts', 'utf8');
  const source = (await fs.readFile('src/utils/article-outline-controller.ts', 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const code = ts.transpileModule(tree + '\n' + source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replaceAll('export class', 'class').replaceAll('export function', 'function');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<article class="custom-md"><h2 id="parent">Parent</h2><h3 id="child">Child</h3><h2 id="sibling">Sibling</h2></article><aside id="rail"><div data-outline-browse-list></div></aside>');
    await page.addScriptTag({content:code+'\nwindow.outline=new ArticleOutlineRailController(document.querySelector("#rail")); if(!outline.init())throw new Error("Outline failed to initialize");'});
    const toggle = page.locator('[data-outline-toggle="0"]');
    await toggle.click();
    await page.waitForTimeout(100);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-outline-row="1"]').isVisible(), false);
    assert.equal(await page.locator('[data-outline-row="2"]').isVisible(), true);
    await toggle.click();
    assert.equal(await page.locator('[data-outline-row="1"]').isVisible(), true);
    await page.locator('[data-outline-target="1"]').click();
    assert.equal(new URL(page.url()).hash, '#child');
    await page.evaluate(() => outline.destroy());
  } finally { await browser.close(); }
});

test('mobile TOC treats heading text and IDs as data rather than HTML', async () => {
  const source = (await fs.readFile('src/utils/toc-utils.ts', 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace('export class', 'class');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<article class="custom-md"><h2></h2></article><div id="toc"></div>');
    await page.evaluate(() => { const h = document.querySelector('h2'); h.id = 'heading" data-injected="yes'; h.textContent = '<img src=x onerror="window.headingExecuted=true">'; });
    await page.addScriptTag({ content: code + '\nwindow.manager = new TOCManager({contentId:"toc",indicatorId:"marker"}); manager.updateTOCContent();' });
    assert.equal(await page.locator('#toc img, #toc [data-injected]').count(), 0);
    assert.match(await page.locator('#toc .toc-label').innerText(), /<img/);
  } finally { await browser.close(); }
});

test('sidebar calendar initializes on a cold page and safely renders article titles', async () => {
  const source = await fs.readFile('src/components/widget/Calendar.astro', 'utf8');
  const code = source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="calendar-grid"></div><div id="current-month-display"></div><div id="calendar-posts"><div id="calendar-posts-list"></div></div><div id="calendar-posts-divider"></div><div id="day-view-container"></div>');
    await page.addScriptTag({ content: 'const monthNames=Array.from({length:12},(_,i)=>String(i+1)); const weekDays=[]; const yearText="年", currentLang="zh-CN", calendarDataUrl="/api/meta", postUrlPrefix="/posts/"; window.fetch=async()=>({json:async()=>[{id:"post",title:"<img src=x onerror=alert(1)>",published:new Date().toISOString()}]});' + code });
    await page.waitForFunction(() => document.querySelector('#calendar-grid').children.length > 0, null, { timeout: 1500 });
    assert.equal(await page.locator('#calendar-posts-list img').count(), 0);
    assert.match(await page.locator('#calendar-posts-list').innerText(), /<img/);
    const previous = await page.locator('#calendar-grid').innerHTML();
    await page.evaluate(() => document.dispatchEvent(new Event('astro:page-load')));
    assert.equal(await page.locator('#calendar-grid').innerHTML(), previous);
  } finally { await browser.close(); }
});
