import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Run against a built blog preview. API fixtures never touch real mailboxes.
const base = process.env.MAIL_TEST_URL || "http://127.0.0.1:4321";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const output = new URL("../cache/mail-verification/", import.meta.url);
await mkdir(output, { recursive: true });
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
	});
	await context.addInitScript(() => localStorage.setItem("theme", "light"));
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	let mode = "empty";
	let generation = 0;
	let reads = 0;
	let deleted = false;
	const message = {
		id: 42,
		sender: "测试发件人 <sender@example.com>",
		address: "reader@example.com",
		subject: "欢迎使用原生邮箱",
		created_at: "2026-09-15T12:00:00Z",
		is_unread: 1,
	};
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== new URL(base).origin) return route.abort();
		if (!url.pathname.startsWith("/api/")) return route.continue();
		const json = (value) => route.fulfill({ json: value });
		if (url.pathname === "/api/new_address") {
			generation++;
			return json({
				address: "reader@example.com",
				jwt: `fixture-${generation}`,
			});
		}
		if (url.pathname === "/api/parsed_mails") {
			if (mode === "challenge")
				return route.fulfill({
					status: 403,
					headers: { "cf-mitigated": "challenge", "content-type": "text/html" },
					body: "<h1>Just a moment...</h1>",
				});
			if (mode === "unauthorized")
				return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
			return json({
				results: mode === "empty" || deleted ? [] : [message],
				count: mode === "empty" || deleted ? 0 : 1,
			});
		}
		if (url.pathname === "/api/parsed_mail/42")
			return json({
				...message,
				text: "纯文本正文",
				html: '<h2>安全邮件正文</h2><script>window.mailXss=true</script><img src="https://tracker.example.com/pixel" onerror="window.mailXss=true"><a href="javascript:alert(1)">不安全链接</a><a href="https://example.com">正常链接</a>',
				attachments: [
					{ filename: "example.txt", mimeType: "text/plain", size: 100 },
				],
			});
		if (url.pathname === "/api/mails/42/read") {
			reads++;
			return json({ success: true });
		}
		if (url.pathname === "/api/mails/42") {
			deleted = true;
			return json({ success: true });
		}
		return route.continue();
	});
	await page.goto(`${base}/mail/`);
	await page.getByText("收件箱还是空的").waitFor();
	assert.equal(generation, 1);
	assert.equal(await page.locator(".mail-app iframe").count(), 0);
	mode = "inbox";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.locator(".mail-app__message.is-unread").waitFor();
	await page
		.getByRole("button", { name: "查看邮件：欢迎使用原生邮箱" })
		.click();
	await page.getByText("安全邮件正文").waitFor();
	await page.waitForFunction(
		() => !document.querySelector(".mail-app__message.is-unread"),
	);
	assert.equal(reads, 1);
	assert.equal(
		await page
			.locator(
				".mail-app__mail-html script, .mail-app__mail-html [onerror], .mail-app__mail-html img[src], .mail-app__mail-html a[href^='javascript:']",
			)
			.count(),
		0,
	);
	assert.equal(await page.evaluate(() => window.mailXss), undefined);
	assert.equal(
		await page
			.locator(".mail-app__metadata")
			.innerText()
			.then((text) => text.includes("收件人")),
		true,
	);
	await page.locator(".mail-app").screenshot({
		path: new URL("desktop.png", output).pathname.replace(
			/^\/([A-Za-z]:)/,
			"$1",
		),
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page
		.getByRole("button", { name: "返回收件箱" })
		.waitFor({ state: "visible" });
	assert.equal(await page.locator(".mail-app__list-pane").isVisible(), false);
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
		true,
	);
	await page.locator(".mail-app").screenshot({
		path: new URL("mobile.png", output).pathname.replace(
			/^\/([A-Za-z]:)/,
			"$1",
		),
	});
	await page.getByRole("button", { name: "返回收件箱" }).click();
	assert.equal(await page.locator(".mail-app__list-pane").isVisible(), true);
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.locator(".mail-app").screenshot({
		path: new URL("mobile-dark.png", output).pathname.replace(
			/^\/([A-Za-z]:)/,
			"$1",
		),
	});
	mode = "challenge";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.getByText("邮箱服务需要安全验证", { exact: false }).waitFor();
	assert.notEqual(
		await page.evaluate(() => sessionStorage.getItem("mail-session")),
		null,
	);
	assert.equal(
		await page
			.getByRole("button", { name: "重新生成", exact: true })
			.isVisible(),
		true,
	);
	mode = "inbox";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.locator(".mail-app__inline-error").waitFor({ state: "hidden" });
	await page
		.getByRole("button", { name: "删除邮件：欢迎使用原生邮箱" })
		.click();
	await page.getByText("收件箱还是空的").waitFor();
	mode = "unauthorized";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.getByRole("heading", { name: "邮箱暂时不可用" }).waitFor();
	assert.equal(
		await page.evaluate(() => sessionStorage.getItem("mail-session")),
		null,
	);
	mode = "empty";
	await page.getByRole("button", { name: "重试", exact: true }).click();
	await page.getByText("收件箱还是空的").waitFor();
	assert.equal(generation, 2);
	await page.goto(`${base}/role/`);
	await page.waitForURL(`${base}/mail/`);
	console.log(
		JSON.stringify(
			{
				result: "PASS",
				checks: [
					"create",
					"empty",
					"refresh",
					"unread",
					"detail",
					"sanitization",
					"mobile navigation",
					"no overflow",
					"403 retains session",
					"delete",
					"401 expires session",
					"retry",
					"legacy redirect",
				],
				pageErrors: errors,
				screenshots: output.pathname,
			},
			null,
			2,
		),
	);
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
}
