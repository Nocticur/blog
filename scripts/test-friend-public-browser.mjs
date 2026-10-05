import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.BROWSER_BASE_URL || process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4322";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checkedAt = new Date().toISOString();
const result = (url, status = "ok", screenshotUrl = null) => ({
  title: "公开友链",
  url,
  status,
  checkedAt,
  httpStatus: status === "error" ? null : status === "restricted" ? 403 : 200,
  latencyMs: 48,
  backlink: "unchecked",
  screenshotUrl,
  screenshotAt: screenshotUrl ? checkedAt : null,
});
const report = (results) => ({ schemaVersion: 1, checkedAt, results });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/api/writing/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/session/")) return route.fulfill({ json: { authenticated: true } });
    if (url.pathname.includes("/posts/")) return route.fulfill({ json: { posts: [], mode: "deployed" } });
    if (url.pathname.includes("/content/sidebar/")) return route.fulfill({ json: { source: JSON.stringify({ enable: true, position: "both", leftComponents: [], rightComponents: [], mobileBottomComponents: [] }), version: "s1" } });
    if (url.pathname.includes("/content/announcements/")) return route.fulfill({ json: { source: JSON.stringify({ title: "测试公告", closable: false, items: [] }), version: "a1" } });
    return route.fulfill({ json: { source: "[]", version: "f1", items: [] } });
  });
  await page.goto(origin + "/admin/#friends", { waitUntil: "domcontentloaded" });
  await page.setContent(`
    <main>
      <article id="auto" class="friend-card" data-friend-url="https://friend.example/">
        <span data-friend-cover hidden><img alt="自动截图" /></span>
        <strong>普通友链</strong><span data-friend-status>尚未检测</span><small data-friend-check-time></small>
      </article>
      <article id="manual" class="friend-card friend-card--with-image" data-friend-url="https://manual.example/" data-friend-manual-image="true">
        <span data-friend-cover><img src="https://images.example/manual.webp" alt="自定义封面" /></span>
        <strong>手动封面</strong><span data-friend-status>尚未检测</span><small data-friend-check-time></small>
      </article>
      <article id="unsafe" class="friend-card" data-friend-url="https://failure.example/">
        <span data-friend-cover hidden><img alt="自动截图" /></span>
        <strong>异常友链</strong><span data-friend-status>尚未检测</span><small data-friend-check-time></small>
      </article>
    </main>
  `);
  const exports = await page.evaluate(async (origin) => {
    try {
      window.friendStatusModule = await import(origin + "/src/utils/friend-status-client.ts");
      return {
        apply: typeof window.friendStatusModule.applyFriendStatusReport,
        load: typeof window.friendStatusModule.loadFriendStatuses,
      };
    } catch (error) {
      return { apply: "missing", load: "missing", reason: String(error) };
    }
  }, origin);
  assert.equal(exports.apply, "function", "公开友链应导出 applyFriendStatusReport 以更新巡检状态和截图");
  assert.equal(exports.load, "function", "公开友链应导出 loadFriendStatuses 并保留失败时原卡片");

  const apply = (data) => page.evaluate((data) => window.friendStatusModule.applyFriendStatusReport(document, data), data);
  const status = (id) => page.locator("#" + id + " [data-friend-status]");
  const cover = (id) => page.locator("#" + id + " [data-friend-cover]");
  const image = (id) => cover(id).locator("img");
  const before = await page.locator("main").innerHTML();
  await page.evaluate(() => window.friendStatusModule.loadFriendStatuses(document, undefined, async () => new Response(JSON.stringify({ error: "巡检报告不可用" }), { status: 503, headers: { "Content-Type": "application/json" } })));
  assert.equal(await page.locator("main").innerHTML(), before, "状态接口异常时保持原友链卡片");
  await page.evaluate(() => window.friendStatusModule.loadFriendStatuses(document, undefined, async () => new Response("<html>upstream error</html>", { status: 200, headers: { "Content-Type": "text/html" } })));
  assert.equal(await page.locator("main").innerHTML(), before, "状态接口无效数据时保持原友链卡片");

  await apply(report([
    result("https://friend.example", "ok", "https://image.nocticur.eu.cc/file/friend.webp"),
    result("https://manual.example/", "ok", "https://image.nocticur.eu.cc/file/auto-manual.webp"),
    result("https://failure.example/", "error", "javascript:alert('bad')"),
  ]));
  assert.match(await status("auto").innerText(), /正常/);
  assert.equal(await image("auto").getAttribute("src"), "https://image.nocticur.eu.cc/file/friend.webp");
  assert.equal(await cover("auto").getAttribute("hidden"), null, "成功截图应显示");
  assert.equal(await page.locator("#auto").evaluate((card) => card.classList.contains("friend-card--with-image")), true);
  assert.equal(await image("manual").getAttribute("src"), "https://images.example/manual.webp", "手动封面优先于自动截图");
  assert.match(await status("unsafe").innerText(), /异常/);
  assert.equal(await image("unsafe").getAttribute("src"), null, "恶意截图地址不得写入图片 src");
  assert.equal(await page.locator("#auto [data-friend-check-time]").innerText().then((text) => text.trim().length > 0), true, "公开卡片应展示检测时间");

  await apply(report([result("https://friend.example/", "restricted")]));
  assert.match(await status("auto").innerText(), /受限/);
  await apply(report([{ ...result("https://friend.example/"), checkedAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() }]));
  assert.match(await status("auto").innerText(), /过期/);
  await apply(report([result("https://failure.example/", "unknown", "data:text/html,<script>alert(1)</script>")]));
  assert.equal(await image("unsafe").getAttribute("src"), null, "非 HTTP(S) 截图地址不得写入图片 src");
  assert.equal(await page.locator("article[data-friend-url]").count(), 3, "检测结果不删除站点卡片");
  console.log("Public friend status browser regression passed: normalized matching, screenshot visibility/manual precedence, unavailable/invalid reports, restricted/error/stale states and unsafe URL rejection.");
} finally {
  await browser.close();
}
