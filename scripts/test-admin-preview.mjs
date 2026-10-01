import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const preview=await import('../src/utils/admin-markdown-preview.ts').catch(()=>({}));
test('admin preview removes executable HTML, script links and MDX while retaining Markdown elements',async()=>{
 assert.equal(typeof preview.sanitizeMarkdownHtml,'function','editor HTML sanitization is implemented');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<main></main>');
  const result=await page.evaluate(({implementation,html})=>{
   const sanitize=new Function('return ('+implementation+')')();
   document.querySelector('main').innerHTML=sanitize(html);
   return {unsafe:document.querySelectorAll('script,iframe,svg,component,[onerror],a[href^="javascript:"],img[src^="data:image/svg"]').length,content:document.querySelector('main').innerHTML};
  },{implementation:preview.sanitizeMarkdownHtml.toString(),html:'<script>window.unsafe=true</script><iframe srcdoc="boom"></iframe><img src="https://example.test/image.png" onerror="window.unsafe=true"><a href="jav&#97;script:alert(1)">link</a><svg onload="alert(1)"></svg><Component props="code" /><p><strong>Safe Markdown</strong></p><img src="data:image/svg+xml,<svg onload=alert(1)>">'});
  assert.equal(result.unsafe,0);assert.match(result.content,/<strong>Safe Markdown<\/strong>/);assert.match(result.content,/https:\/\/example.test\/image.png/);
 }finally{await browser.close();}
});
