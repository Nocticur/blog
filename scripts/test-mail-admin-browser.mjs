import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MAIL_TEST_URL || "http://127.0.0.1:4321";
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
	});
	const page = await context.newPage();
	let loggedIn = false;
	const requests = [];

	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== new URL(base).origin) return route.abort();
		if (!url.pathname.startsWith("/api/mail-admin/")) return route.continue();
		requests.push({ path: url.pathname, method: route.request().method() });
		if (url.pathname === "/api/mail-admin/session") {
			return route.fulfill({
				status: loggedIn ? 200 : 401,
				json: loggedIn
					? {
							profile: {
								email: "admin@example.com",
								userId: 1,
								role: "master",
							},
						}
					: { error: "管理员会话已过期" },
			});
		}
		if (url.pathname === "/api/mail-admin/login") {
			loggedIn = true;
			return route.fulfill({
				json: {
					profile: { email: "admin@example.com", userId: 1, role: "master" },
				},
			});
		}
		if (url.pathname === "/api/mail-admin/admin/statistics") {
			return route.fulfill({
				json: {
					body: {
						address_count: 2,
						user_count: 3,
						mail_count: 8,
						unknown_mail_count: 1,
					},
				},
			});
		}
		if (url.pathname === "/api/mail-admin/admin/worker/configs") {
			return route.fulfill({
				json: {
					body: {
						ENABLE_USER_CREATE_EMAIL: true,
						DISABLE_ANONYMOUS_USER_CREATE_EMAIL: false,
						ENABLE_USER_DELETE_EMAIL: true,
					},
				},
			});
		}
		return route.fulfill({ json: { body: { results: [], count: 0 } } });
	});

	await page.goto(`${base}/mail/admin/`);
	await page.getByRole("heading", { name: "邮件管理后台" }).waitFor();
	await page.getByLabel("账号邮箱").fill("admin@example.com");
	await page.getByLabel("密码").fill("correct-password");
	await page.getByRole("button", { name: "登录管理后台" }).click();
	await page.getByRole("heading", { name: "系统概览" }).waitFor();
	assert.equal((await page.getByText("admin@example.com").count()) >= 1, true);
	assert.equal(await page.evaluate(() => localStorage.length), 0);
	assert.equal(await page.evaluate(() => sessionStorage.length), 0);
	assert.equal(
		requests.some((request) => request.path === "/api/mail-admin/login"),
		true,
	);
	assert.equal(await page.locator(".mail-admin iframe").count(), 0);
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
		true,
	);
	await page.getByRole("button", { name: "打开管理菜单" }).click();
	assert.equal(
		await page.locator(".mail-admin-sidebar.mail-admin-sidebar-open").count(),
		1,
	);
	await page.getByRole("button", { name: "关闭菜单" }).click();
	const themeBefore = await page.evaluate(() =>
		document.documentElement.classList.contains("dark"),
	);
	await page.getByRole("button", { name: "切换主题" }).click();
	assert.notEqual(
		await page.evaluate(() =>
			document.documentElement.classList.contains("dark"),
		),
		themeBefore,
	);

	console.log(
		JSON.stringify(
			{
				result: "PASS",
				checks: [
					"login",
					"dashboard",
					"same-origin-session",
					"no-token-storage",
					"no-iframe",
					"mobile-navigation",
					"theme-toggle",
				],
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
