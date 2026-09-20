import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
	const page = await browser.newPage();
	await page.goto(
		(process.env.BROWSER_BASE_URL || "http://127.0.0.1:4323") + "/writing/",
		{ waitUntil: "domcontentloaded" },
	);
	await page.waitForFunction(() =>
		document.querySelector(
			'astro-island[component-url*="ContentManager"]:not([ssr])',
		),
	);
	await page.evaluate(() =>
		sessionStorage.setItem("firefly-writing-auth", "browser-test-only"),
	);
	const button = page.getByRole("button", { name: "打开 / 刷新内容管理" });
	const status = page
		.locator("section")
		.filter({
			has: page.getByRole("heading", { name: "内容管理", exact: true }),
		})
		.getByRole("status");
	for (const response of [
		{
			status: 404,
			contentType: "text/plain",
			body: "The page could not be found",
			expected: "内容管理接口不可用（HTTP 404）",
		},
		{
			status: 502,
			contentType: "text/html",
			body: "<html>Bad Gateway</html>",
			expected: "内容管理接口不可用（HTTP 502）",
		},
		{
			status: 200,
			contentType: "text/html",
			body: "<html>Unexpected page</html>",
			expected: "内容管理接口返回了无效数据（HTTP 200）",
		},
		{
			status: 401,
			contentType: "application/json",
			body: JSON.stringify({ error: "登录已过期，请重新登录" }),
			expected: "登录已过期，请重新登录",
		},
		{
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ items: [] }),
			expected: "",
		},
	]) {
		await page.route("**/api/writing/content/**", (route) =>
			route.fulfill(response),
		);
		const responsePromise = page.waitForResponse((r) =>
			r.url().includes("/api/writing/content/"),
		);
		await button.click();
		await (await responsePromise).finished();
		await page.waitForFunction(
			() =>
				!Array.from(document.querySelectorAll("button")).find((b) =>
					b.textContent.includes("打开 / 刷新内容管理"),
				).disabled,
		);
		assert.equal(await status.innerText(), response.expected);
		await page.unroute("**/api/writing/content/**");
	}
	assert.equal(
		await page.getByRole("navigation", { name: "内容模块" }).count(),
		1,
	);
	console.log(
		"Content manager browser regression passed (404, 502, invalid JSON, 401, success)",
	);
} finally {
	await browser.close();
}
