import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
test('music widget does not register duplicate listeners when mounted twice', async () => {
  const code = await fs.readFile('src/utils/music-player-controller.js', 'utf8').catch(() => '');
  assert.ok(code.length > 0, 'music controller is a bundled module');
  const browser = await chromium.launch({channel: 'chrome',headless: true});
  try {
    const page = await browser.newPage();
    await page.route('https://music.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="ancestor"><div id="widget"></div></div>' }));
    await page.goto('https://music.test/');
    await page.evaluate(selectors => {
      const widget = document.querySelector('#widget');
      for (const selector of selectors) { const element = document.createElement('div'); element.className = selector.slice(1); widget.append(element); }
      window.__fireflyMusic = { getState: () => ({ initialized: false }) };
      const add = window.addEventListener.bind(window); window.registrationCount = 0;
      window.addEventListener = (...args) => { window.registrationCount++; return add(...args); };
      const remove = window.removeEventListener.bind(window); window.removalCount = 0;
      window.removeEventListener = (...args) => { window.removalCount++; return remove(...args); };
    }, [...code.matchAll(/widget\.querySelector\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]));
    await page.addScriptTag({content:code.replace('export function mountMusicPlayer','function mountMusicPlayer')+'\nwindow.mountMusicPlayer=mountMusicPlayer;'});
    const partial = await page.evaluate(() => { window.registrationCount = 0; mountMusicPlayer(document.querySelector('#widget'), {viewConfig:{}, lazy:true}); return [!!document.querySelector('#widget').__musicInitialized, window.registrationCount]; });
    assert.deepEqual(partial, [false, 0], 'incomplete DOM does not lock the widget out of a later mount');
    await page.evaluate(() => { const template = document.createElement('template'); template.id='playlist-item-template-widget'; document.body.append(template); });
    const counts = await page.evaluate(() => { window.registrationCount = 0; const options = { viewConfig: {}, lazy: true }; mountMusicPlayer(document.querySelector('#widget'),options); if (typeof document.querySelector('#widget').__musicSync !== 'function') throw new Error('Controller did not initialize'); const first = window.registrationCount; mountMusicPlayer(document.querySelector('#widget'),options); return [first,window.registrationCount]; });
    assert.ok(counts[0] > 0); assert.equal(counts[0],counts[1]);
    await page.evaluate(() => document.querySelector('#ancestor').remove());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.removalCount), counts[0], 'ancestor removal releases window listeners');
  } finally { await browser.close(); }
});
