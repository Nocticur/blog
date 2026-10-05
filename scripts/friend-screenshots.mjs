import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fetchPublicResource, publicUrl } = require('../.github/scripts/friend-policy.cjs');

export function createResourceHandler(options = {}) {
  const getResource = options.fetchResource || fetchPublicResource;
  const deadline = Date.now() + (options.timeoutMs || 35000);
  let requestCount = 0, totalBytes = 0;
  return async route => {
    const request = route.request();
    try {
      if (Date.now() >= deadline || ++requestCount > 200 || totalBytes > 24 * 1024 * 1024 || request.method() !== 'GET') throw new Error('截图资源限制');
      let redirects = 0;
      for (let prior = request.redirectedFrom?.(); prior; prior = prior.redirectedFrom()) if (++redirects > 5) throw new Error('过多跳转');
      const url = publicUrl(request.url());
      const response = await getResource(url.href, { allowCrossOrigin: true, followRedirects: false, maxBytes: 3 * 1024 * 1024, timeoutMs: Math.min(10000, deadline - Date.now()), signal: options.signal });
      totalBytes += response.body.length;
      if (totalBytes > 24 * 1024 * 1024 || Date.now() >= deadline) throw new Error('截图资源限制');
      const headers = {};
      for (const name of ['content-type', 'location', 'cache-control', 'access-control-allow-origin', 'cross-origin-resource-policy', 'content-security-policy', 'x-content-type-options']) {
        if (typeof response.headers[name] === 'string') headers[name] = response.headers[name];
      }
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch {
      await route.abort('blockedbyclient').catch(() => {});
    }
  };
}

export async function captureHomepage(url, { browser } = {}) {
  publicUrl(url);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    await context.route('**/*', createResourceHandler({ signal: controller.signal }));
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const response = await page.goto(url, { waitUntil: 'load', timeout: 25000 });
    if (!response || !response.ok()) throw new Error('截图页面不可访问');
    return await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false, animations: 'disabled', timeout: 10000 });
  } finally {
    clearTimeout(timer); controller.abort();
    await context.close();
  }
}

export async function uploadScreenshot(bytes, { baseUrl, token, filename, fetchImpl = fetch } = {}) {
  const { uploadImgbedImage } = await import('../api/_lib/imgbed.mjs');
  const uploaded = await uploadImgbedImage(bytes, {
    mimeType: filename?.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    folder: 'blog/friends/screenshots', fileName: filename,
    env: { IMGBED_BASE_URL: baseUrl, IMGBED_API_TOKEN: token }, fetcher: fetchImpl,
  });
  return publicUrl(uploaded.image).href;
}

export async function createScreenshotCapture(env = process.env) {
  if (!env.IMGBED_API_TOKEN || !env.IMGBED_BASE_URL) return null;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--dns-prefetch-disable', '--disable-quic'],
  });
  return {
    capture: async (url, friend) => {
      const bytes = await captureHomepage(url, { browser });
      const filename = `friend-${createHash('sha256').update(friend.siteurl).digest('hex').slice(0, 24)}.jpg`;
      return uploadScreenshot(bytes, { baseUrl: env.IMGBED_BASE_URL, token: env.IMGBED_API_TOKEN, filename });
    },
    close: () => browser.close(),
  };
}
