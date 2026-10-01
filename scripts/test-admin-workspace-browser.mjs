import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.BROWSER_BASE_URL || process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4321";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const sidebar = { enable: true, position: "both", leftComponents: [], rightComponents: [], mobileBottomComponents: [] };
const announcement = { title: "隔离公告", closable: false, items: [] };
const detail = { file: "fixture.md", version: "post-v1", frontmatter: { title: "隔离文章", published: "2026-01-01", updated: "", description: "", image: "", category: "", draft: false, tags: [], lang: "" }, content: "仓库正文" };
const select = async (page, label) => page.getByRole("navigation", { name: "后台导航" }).getByRole("button", { name: new RegExp(label) }).click();
const blockStorage = async page => page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Unavailable", "QuotaExceededError"); }; });

async function fixturePage(handler) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/writing/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/session/")) return route.fulfill({ json: { authenticated: true, mode: "deployed" } });
    if (url.pathname.endsWith("/auth/")) return route.fulfill({ json: { authenticated: true, mode: "deployed" } });
    if (url.pathname.includes("/content/sidebar/")) return route.fulfill({ json: { source: JSON.stringify(sidebar), version: "s1" } });
    if (url.pathname.includes("/content/announcements/")) return route.fulfill({ json: { source: JSON.stringify(announcement), version: "a1" } });
    if (await handler(route, url)) return;
    if (url.pathname.includes("/posts/")) return route.fulfill({ json: url.searchParams.has("file") ? detail : { posts: [{ ...detail.frontmatter, file: detail.file, version: detail.version }], mode: "deployed", tokenReady: true } });
    return route.fulfill({ json: { items: [], mode: "deployed" } });
  });
  await page.goto(origin + "/admin/", { waitUntil: "domcontentloaded" });
  await page.locator(".admin-shell").waitFor();
  return page;
}

try {
  let initialArticleReads = 0;
  const firstArticlePage = await fixturePage(async (route, url) => {
    if (!url.pathname.includes("/posts/") || route.request().method() !== "GET" || url.searchParams.has("file")) return false;
    initialArticleReads += 1;
    if (initialArticleReads !== 2) return false;
    await route.fulfill({ status: 401, json: { error: "首次读取时登录已过期" } });
    return true;
  });
  await firstArticlePage.waitForTimeout(100);
  assert.equal(initialArticleReads, 1, "隐藏的文章编辑器不得读取列表或触发会话失效");
  await select(firstArticlePage, "文章管理");
  await firstArticlePage.getByLabel("管理密码", { exact: true }).fill("isolated-test-password");
  await firstArticlePage.getByRole("button", { name: "进入工作台", exact: true }).click();
  await select(firstArticlePage, "文章管理");
  await firstArticlePage.locator('#admin-writing button[title="编辑"]').waitFor({ timeout: 5000 });
  assert.ok(initialArticleReads >= 3, "首次读取401后重新认证应重试尚未初始化的文章列表");
  await firstArticlePage.close();

  let initialRecordReads = 0;
  const firstRecordPage = await fixturePage(async (route, url) => {
    if (!url.pathname.includes("/content/notebooks/") || route.request().method() !== "GET") return false;
    initialRecordReads += 1;
    await route.fulfill(initialRecordReads === 1 ? { status: 401, json: { error: "首次读取时登录已过期" } } : { json: { items: [{ file: "分组/笔记.md" }] } });
    return true;
  });
  await select(firstRecordPage, "笔记本");
  await firstRecordPage.getByLabel("管理密码", { exact: true }).fill("isolated-test-password");
  await firstRecordPage.getByRole("button", { name: "进入工作台", exact: true }).click();
  await firstRecordPage.locator("#admin-records").getByRole("button", { name: "分组/笔记.md", exact: true }).waitFor({ timeout: 5000 });
  assert.equal(initialRecordReads, 2, "首次读取401后重试一次尚未初始化的记录列表");
  await firstRecordPage.close();

  let expireArticle = true;
  const articleWrites = [];
  const articlePage = await fixturePage(async (route, url) => {
    if (!url.pathname.includes("/posts/") || route.request().method() === "GET") return false;
    articleWrites.push(route.request().postDataJSON());
    await route.fulfill(expireArticle ? { status: 401, json: { error: "登录已过期" } } : { status: 409, json: { error: "版本冲突" } });
    return true;
  });
  await select(articlePage, "文章管理");
  const writing = articlePage.locator("#admin-writing");
  await writing.locator('button[title="编辑"]').waitFor();
  assert.equal(await writing.getByRole("button", { name: "退出", exact: true }).count(), 0, "嵌入编辑器只能通过左下角账号菜单退出");
  await writing.locator('button[title="编辑"]').click();
  await blockStorage(articlePage);
  await writing.getByPlaceholder("文章标题").fill("会话恢复后保留的文章标题");
  await writing.locator(".ws-editor").fill("存储不可用时的文章正文");
  await writing.getByRole("button", { name: "更新发布", exact: true }).click();
  await articlePage.getByLabel("管理密码", { exact: true }).fill("isolated-test-password");
  await articlePage.getByRole("button", { name: "进入工作台", exact: true }).click();
  await writing.locator(".ws-editor:visible").waitFor();
  assert.equal(await writing.getByPlaceholder("文章标题").inputValue(), "会话恢复后保留的文章标题");
  assert.equal(await writing.locator(".ws-editor").inputValue(), "存储不可用时的文章正文");
  expireArticle = false;
  await writing.getByRole("button", { name: "更新发布", exact: true }).click();
  await writing.getByText(/版本冲突/).first().waitFor();
  assert.equal(articleWrites.at(-1).version, "post-v1", "重新登录后仍提交最初读取的文章版本");
  await articlePage.close();

  const recordWrites = [];
  let holdWrite = false, enteredWrite, releaseWrite, expireRecord = false;
  const recordPage = await fixturePage(async (route, url) => {
    const request = route.request();
    if (!url.pathname.includes("/content/notebooks/")) return false;
    if (request.method() === "GET") {
      await route.fulfill({ json: url.searchParams.has("file") ? { file: "分组/笔记.md", source: "笔记仓库正文", version: "note-v1" } : { items: [{ file: "分组/笔记.md" }] } });
      return true;
    }
    recordWrites.push({ module: url.pathname, ...request.postDataJSON() });
    if (holdWrite) await new Promise(resolve => { releaseWrite = resolve; enteredWrite(); });
    await route.fulfill(expireRecord ? { status: 401, json: { error: "登录已过期" } } : { status: 409, json: { error: "版本冲突" } });
    return true;
  });
  await select(recordPage, "笔记本");
  const records = recordPage.locator("#admin-records");
  await records.getByRole("button", { name: "分组/笔记.md", exact: true }).click();
  await blockStorage(recordPage);
  await records.locator("textarea").first().fill("存储不可用时的笔记正文");
  holdWrite = true;
  const writeStarted = new Promise(resolve => { enteredWrite = resolve; });
  await records.getByRole("button", { name: "保存", exact: true }).click();
  await writeStarted;
  await select(recordPage, "动态");
  await select(recordPage, "足迹");
  assert.equal(await records.locator("textarea").first().isDisabled(), true, "切换期间不能编辑前一个模块");
  assert.equal(await records.getByText(/正在切换/).count(), 1, "慢请求期间明确提示模块交接");
  releaseWrite(); holdWrite = false;
  await records.getByRole("heading", { name: "足迹", exact: true }).last().waitFor();
  await records.getByRole("button", { name: "新建草稿", exact: true }).waitFor({ state: "visible" });
  await select(recordPage, "笔记本");
  await recordPage.waitForFunction(() => document.querySelector("#admin-records textarea")?.value === "存储不可用时的笔记正文");
  assert.equal(recordWrites[0].module, "/api/writing/content/notebooks/", "切换不能改变在途保存的目标模块");
  expireRecord = true;
  await records.getByRole("button", { name: "保存", exact: true }).click();
  await recordPage.getByLabel("管理密码", { exact: true }).fill("isolated-test-password");
  await recordPage.getByRole("button", { name: "进入工作台", exact: true }).click();
  await records.locator("textarea:visible").first().waitFor();
  assert.equal(await records.locator("textarea").first().inputValue(), "存储不可用时的笔记正文");
  expireRecord = false;
  await records.getByRole("button", { name: "保存", exact: true }).click();
  await records.getByText(/版本冲突/).first().waitFor();
  assert.equal(recordWrites.at(-1).version, "note-v1", "重新登录后仍提交最初读取的记录版本");
  await recordPage.close();
  assert.deepEqual(errors, []);
  console.log("Workspace regression passed: latest module selection, uncancelled writes, memory drafts after 401 and original versions.");
} finally {
  await browser.close();
}
