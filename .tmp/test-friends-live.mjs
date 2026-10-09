import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const origin = process.env.BROWSER_BASE_URL || process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4322";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const originalNewPage = browser.newPage.bind(browser);
browser.newPage = async options => {
  const page = await originalNewPage(options);
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.fallback() : route.abort());
  return page;
};
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const example = {
  title: "番茄主理人",
  desc: "躬身入局，心为主理，行有尺度，自持本心。",
  siteurl: "https://blog.fqzlr.top/",
  imgurl: "https://q1.qlogo.cn/g?b=qq&nk=20447289&s=640",
};
const original = {
  title: "已有友链",
  desc: "保留原有元信息",
  siteurl: "https://existing.example/",
  imgurl: "/images/avatar.webp",
  weight: 8,
  enabled: true,
  tags: ["技术", "生活"],
  image: "https://images.example/manual-cover.webp",
  linkpage: "https://existing.example/friends/",
  extension: { kept: "原始扩展数据" },
};

async function setup(page, rows = [original]) {
  const state = {
    source: JSON.stringify(rows, null, 2),
    version: "f1",
    writes: [],
    writeStatus: 200,
    uploadStatus: 200,
    uploads: [],
    statusRequests: 0,
    pause: null,
    entered: null,
    release: null,
  };
  await page.route("**/api/writing/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/\/$/, "");
    assert.equal(request.headers()["x-writing-auth"], undefined, "友链请求应沿用 Cookie 会话");
    if (pathname.endsWith("/session")) return route.fulfill({ json: { authenticated: true } });
    if (pathname.includes("/posts")) return route.fulfill({ json: { posts: [], mode: "deployed" } });
    if (pathname.endsWith("/content/sidebar")) return route.fulfill({ json: { source: JSON.stringify({ enable: true, position: "both", leftComponents: [], rightComponents: [], mobileBottomComponents: [] }), version: "s1" } });
    if (pathname.endsWith("/content/announcements")) return route.fulfill({ json: { source: JSON.stringify({ title: "测试公告", closable: false, items: [] }), version: "a1" } });
    if (pathname.endsWith("/content/friends/images")) {
      assert.equal(request.method(), "POST");
      state.uploads.push(request.postDataJSON());
      return route.fulfill(state.uploadStatus === 200
        ? { json: { image: "https://image.nocticur.eu.cc/file/uploaded-avatar.webp" } }
        : { status: state.uploadStatus, json: { error: "图床暂时不可用，输入已保留" } });
    }
    if (pathname.endsWith("/content/friends")) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        state.writes.push(body);
        if (state.pause) {
          state.entered?.();
          await state.pause;
        }
        if (state.writeStatus !== 200) return route.fulfill({ status: state.writeStatus, json: { error: "版本冲突，请重新读取后合并" } });
        state.source = body.source;
        state.version = "f" + (state.writes.length + 1);
        return route.fulfill({ json: { source: state.source, version: state.version, commit: { url: "https://github.com/example/blog/commit/test" } } });
      }
      assert.equal(request.method(), "GET");
      return route.fulfill({ json: { source: state.source, version: state.version, items: [] } });
    }
    return route.fulfill({ json: { source: "[]", version: "other1", items: [] } });
  });
  await page.route("**/api/friend-status*", (route) => {
    state.statusRequests++;
    return route.fulfill({ status: 503, json: { error: "巡检报告暂不可用" } });
  });
  await page.route("**/q1.qlogo.cn/**", (route) => route.fulfill({ contentType: "image/png", body: imageBytes }));
  await page.goto(origin + "/admin/#friends", { waitUntil: "domcontentloaded" });
  const records = page.locator("#admin-records");
  await records.waitFor({ state: "visible" });
  assert.equal(await records.getByLabel("站点名称", { exact: true }).count(), 1, "友链页面应提供站点名称字段，而不是 JSON 列表");
  await records.locator(".friend-editor").waitFor();
  return { state, records };
}

async function fillFriend(records, friend = example) {
  await records.getByLabel("站点名称", { exact: true }).fill(friend.title);
  await records.getByLabel("站点描述", { exact: true }).fill(friend.desc);
  await records.getByLabel("站点链接", { exact: true }).fill(friend.siteurl);
  await records.getByLabel("头像链接", { exact: true }).fill(friend.imgurl);
}

async function submit(page, records, label) {
  const response = page.waitForResponse((reply) => reply.url().includes("/api/writing/content/friends/") && reply.request().method() === "PUT");
  await records.getByRole("button", { name: label, exact: true }).click();
  await (await response).finished();
  await page.waitForFunction(() => !document.querySelector("#admin-records fieldset[aria-busy='true']"));
}

function row(records, title) {
  return records.locator(".friend-editor-row").filter({ hasText: title });
}

async function screenshot(page, name) {
  if (!process.env.FRIEND_EDITOR_SCREENSHOT_DIR) return;
  await mkdir(process.env.FRIEND_EDITOR_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.FRIEND_EDITOR_SCREENSHOT_DIR, name + ".png"), fullPage: true, style: "astro-dev-toolbar { display: none !important; }" });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const { state, records } = await setup(page);
  for (const label of ["站点名称", "站点描述", "站点链接", "头像链接"]) {
    await records.getByLabel(label, { exact: true }).waitFor({ state: "visible" });
    assert.equal(await records.getByLabel(label, { exact: true }).isVisible(), true, label + "应默认显示");
  }
  assert.equal(await records.getByText("JSON 列表", { exact: true }).count(), 0);
  assert.equal(await records.getByText(/文件名/).count(), 0);
  assert.equal(await records.locator("details").filter({ hasText: "高级设置" }).getAttribute("open"), null, "高级设置默认折叠");
  await row(records, original.title).waitFor();
  await page.waitForFunction(() => document.querySelector(".friend-editor-row"));
  assert.equal(await row(records, original.title).isVisible(), true, "巡检接口失败时仍展示原友链");

  await fillFriend(records);
  await screenshot(page, "friends-desktop");
  await submit(page, records, "添加友链");
  assert.equal(state.writes.length, 1, "添加直接保存一次");
  assert.equal(state.writes[0].version, "f1");
  const addedRows = JSON.parse(state.writes[0].source);
  assert.deepEqual(addedRows[0], original, "新增不得重写已有扩展字段");
  const added = addedRows.find((friend) => friend.title === example.title);
  for (const [key, value] of Object.entries(example)) assert.equal(added[key], value);
  assert.equal(added.weight, 5);
  assert.equal(added.enabled, true);
  await records.getByText(/已保存/).last().waitFor();
  assert.match(await records.innerText(), /部署|构建/, "保存提示应说明部署后公开显示");

  await row(records, original.title).getByRole("button", { name: "编辑", exact: true }).click();
  await records.getByLabel("站点描述", { exact: true }).fill("编辑后的介绍");
  await submit(page, records, "保存修改");
  const edited = JSON.parse(state.source).find((friend) => friend.title === original.title);
  assert.deepEqual(edited, { ...original, desc: "编辑后的介绍" }, "只改描述时保留高级及扩展字段");
  await row(records, original.title).getByRole("button", { name: "停用", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#admin-records fieldset[aria-busy='true']"));
  await row(records, original.title).getByRole("button", { name: "启用", exact: true }).waitFor();
  assert.equal(JSON.parse(state.source).find((friend) => friend.title === original.title).enabled, false);

  const beforeDuplicate = state.writes.length;
  await fillFriend(records, { ...example, title: "重复站点", siteurl: "https://existing.example" });
  await records.getByRole("button", { name: "添加友链", exact: true }).click();
  await records.getByText(/已存在|重复|已经添加/).last().waitFor();
  assert.equal(state.writes.length, beforeDuplicate, "规范化重复地址不提交");
  assert.equal(await records.getByLabel("站点名称", { exact: true }).inputValue(), "重复站点");

  await fillFriend(records, { ...example, title: "待添加站点", siteurl: "https://incoming.example/" });
  const beforeUpload = state.writes.length;
  await records.getByLabel("上传头像", { exact: true }).setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: imageBytes });
  await page.waitForFunction(() => document.querySelector(".friend-editor input[aria-label='头像链接']")?.value.includes("uploaded-avatar") || Array.from(document.querySelectorAll(".friend-editor input")).some((input) => input.value.includes("uploaded-avatar")));
  assert.equal(await records.getByLabel("头像链接", { exact: true }).inputValue(), "https://image.nocticur.eu.cc/file/uploaded-avatar.webp");
  assert.equal(state.writes.length, beforeUpload, "上传头像只回填，不自动保存友链");
  state.uploadStatus = 502;
  await records.getByLabel("上传头像", { exact: true }).setInputFiles({ name: "failure.png", mimeType: "image/png", buffer: imageBytes });
  await records.getByText(/图床暂时不可用/).last().waitFor();
  assert.equal(await records.getByLabel("头像链接", { exact: true }).inputValue(), "https://image.nocticur.eu.cc/file/uploaded-avatar.webp");
  assert.equal(await records.getByLabel("站点名称", { exact: true }).inputValue(), "待添加站点");
  const beforeOversize = state.uploads.length;
  await records.getByLabel("上传头像", { exact: true }).setInputFiles({ name: "oversize.png", mimeType: "image/png", buffer: Buffer.alloc(3 * 1024 * 1024 + 1) });
  await records.getByText(/不能超过|3 MiB/).last().waitFor();
  assert.equal(state.uploads.length, beforeOversize, "超限图片不发往图床");

  page.once("dialog", (dialog) => dialog.dismiss());
  const beforeDeleteCancel = state.writes.length;
  await row(records, example.title).getByRole("button", { name: "删除", exact: true }).click();
  assert.equal(state.writes.length, beforeDeleteCancel, "取消删除不提交");
  page.once("dialog", (dialog) => dialog.accept());
  const deleted = page.waitForResponse((reply) => reply.url().includes("/api/writing/content/friends/") && reply.request().method() === "PUT");
  await row(records, example.title).getByRole("button", { name: "删除", exact: true }).click();
  await (await deleted).finished();
  await row(records, example.title).waitFor({ state: "detached" });
  assert.equal(JSON.parse(state.source).length, 1);

  await row(records, original.title).getByRole("button", { name: "编辑", exact: true }).click();
  await records.getByLabel("站点描述", { exact: true }).fill("409 后仍保留的介绍");
  await records.getByLabel("站点链接", { exact: true }).fill("https://existing.example/renamed/");
  const concurrent = { ...JSON.parse(state.source)[0], weight: 11, enabled: true, tags: ["仓库新标签"], extension: { kept: "仓库新扩展" } };
  state.source = JSON.stringify([concurrent], null, 2);
  state.version = "f-concurrent";
  state.writeStatus = 409;
  state.pause = new Promise((resolve) => { state.release = resolve; });
  const entered = new Promise((resolve) => { state.entered = resolve; });
  await records.getByRole("button", { name: "保存修改", exact: true }).click();
  await entered;
  assert.equal(await records.getByLabel("站点描述", { exact: true }).isDisabled(), true, "保存期间锁定输入，避免后续输入丢失");
  state.release();
  state.pause = null;
  await records.getByText(/版本冲突/).last().waitFor();
  assert.equal(await records.getByLabel("站点描述", { exact: true }).inputValue(), "409 后仍保留的介绍");
  await page.waitForFunction(() => Object.values(localStorage).some((value) => value.includes("409 后仍保留的介绍")));
  await records.getByRole("button", { name: "读取仓库版进行比较", exact: true }).click();
  await records.getByLabel("仓库版本（只读）", { exact: true }).waitFor();
  assert.equal(await records.getByLabel("仓库版本（只读）", { exact: true }).inputValue(), state.source);
  await page.reload({ waitUntil: "domcontentloaded" });
  await records.getByLabel("站点名称", { exact: true }).waitFor();
  await page.waitForFunction(() => Object.values(localStorage).some((value) => value.includes("409 后仍保留的介绍")));
  assert.equal(await records.getByLabel("站点描述", { exact: true }).inputValue(), "409 后仍保留的介绍", "刷新后保留未提交的友链内容");
  await submit(page, records, "保存修改");
  await records.getByText(/版本冲突/).last().waitFor();
  await records.getByRole("button", { name: "读取仓库版进行比较", exact: true }).click();
  await records.getByLabel("仓库版本（只读）", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await records.getByRole("button", { name: "以仓库版为基础合并", exact: true }).click();
  state.writeStatus = 200;
  await submit(page, records, "保存修改");
  assert.deepEqual(JSON.parse(state.source)[0], { ...concurrent, desc: "409 后仍保留的介绍", siteurl: "https://existing.example/renamed/" }, "修改地址后冲突重试应保留仓库新元信息");
  assert.equal(state.writes.at(-1).version, "f-concurrent");
  await page.close();

  const blocked = await browser.newPage();
  const blockedErrors = [];
  blocked.on("pageerror", (error) => blockedErrors.push(error.message));
  await blocked.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(window, name, { get() { throw new DOMException("Storage disabled", "SecurityError"); } });
  });
  const { records: blockedRecords, state: blockedState } = await setup(blocked, []);
  await fillFriend(blockedRecords);
  await submit(blocked, blockedRecords, "添加友链");
  assert.equal(blockedState.writes.length, 1, "禁用浏览器存储时仍可保存友链");
  assert.deepEqual(blockedErrors, []);
  await blocked.close();

  for (const colorScheme of ["light", "dark"]) {
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme });
    const { records: mobileRecords, state: mobileState } = await setup(mobile, []);
    await mobile.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), colorScheme === "dark");
    await fillFriend(mobileRecords);
    await screenshot(mobile, "friends-mobile-" + colorScheme);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "手机端不应出现页面水平溢出");
    await submit(mobile, mobileRecords, "添加友链");
    assert.equal(mobileState.writes.length, 1, "手机端四字段添加一次提交");
    assert.equal(JSON.parse(mobileState.source)[0].title, example.title);
    await mobile.close();
  }
  console.log("Friends editor browser regression passed: four-field add, metadata preservation, duplicate validation, upload recovery, enable/delete, 409/local recovery and mobile light/dark layout.");
} finally {
  await browser.close();
}
