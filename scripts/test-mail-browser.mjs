import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Run against a built blog preview. API fixtures never touch real mailboxes.
const base = process.env.MAIL_TEST_URL || "http://127.0.0.1:4321";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const output = new URL("../cache/mail-verification/", import.meta.url);
await mkdir(output, { recursive: true });
const shot = (name) =>
	new URL(name, output).pathname.replace(/^\/([A-Za-z]:)/, "$1");
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
	});
	await context.addInitScript(() => localStorage.setItem("theme", "light"));
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	let sessionMode = "anonymous";
	let inboxMode = "empty";
	let reads = 0;
	let deleted = false;
	let registerRequests = 0;
	const message = {
		id: 42,
		sender: "测试发件人 <sender@example.com>",
		address: "reader@nocticur.eu.cc",
		subject: "欢迎使用原生邮箱",
		created_at: "2026-09-15T12:00:00Z",
		is_unread: 1,
	};
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== new URL(base).origin) return route.abort();
		if (!url.pathname.startsWith("/api/")) return route.continue();
		const json = (value, status = 200) =>
			route.fulfill({ json: value, status });
		const path = url.pathname;
		if (path === "/api/mail-auth/session") {
			return sessionMode === "authed"
				? json({ profile: { address: "reader@nocticur.eu.cc" } })
				: json({ error: "登录状态已过期，请重新登录" }, 401);
		}
		if (path === "/api/mail-auth/config") {
			return json({
				domains: ["nocticur.eu.cc", "noctis.eu.cc", "caelus.eu.cc"],
				loginDomains: [
					"nocticur.eu.cc",
					"noctis.eu.cc",
					"caelus.eu.cc",
					"mourn.top",
				],
				addressMinLength: 3,
				addressMaxLength: 30,
				passwordMinLength: 8,
			});
		}
		if (path === "/api/mail-auth/register") {
			registerRequests++;
			const body = route.request().postDataJSON();
			if (body.domain === "mourn.top")
				return json({ error: "该域名不支持注册" }, 403);
			if (body.name === "taken")
				return json(
					{ error: "该邮箱地址已被注册，请换一个前缀或域名" },
					409,
				);
			return json({ address: `${body.name}@${body.domain}` }, 201);
		}
		if (path === "/api/mail-auth/login") {
			const body = route.request().postDataJSON();
			if (body.password !== "right-pass-1")
				return json({ error: "邮箱地址或密码错误" }, 401);
			sessionMode = "authed";
			return json({ profile: { address: body.email } });
		}
		if (path === "/api/mail-auth/logout") {
			sessionMode = "anonymous";
			return json({ success: true });
		}
		if (path === "/api/mail-auth/mails") {
			if (sessionMode !== "authed")
				return json({ error: "登录状态已过期，请重新登录" }, 401);
			if (inboxMode === "challenge")
				return route.fulfill({
					status: 502,
					json: {
						error: "邮箱服务需要安全验证，暂时无法加载。请稍后重试。",
						code: "UPSTREAM_CHALLENGE",
					},
				});
			if (inboxMode === "unauthorized") {
				sessionMode = "anonymous";
				return json({ error: "登录状态已过期，请重新登录" }, 401);
			}
			return json({
				results: inboxMode === "empty" || deleted ? [] : [message],
				count: inboxMode === "empty" || deleted ? 0 : 1,
			});
		}
		if (path === "/api/mail-auth/mails/42")
			return json({
				...message,
				text: "纯文本正文",
				html: '<h2>安全邮件正文</h2><script>window.mailXss=true</script><img src="https://tracker.example.com/pixel" onerror="window.mailXss=true"><a href="javascript:alert(1)">不安全链接</a><a href="https://example.com">正常链接</a>',
				attachments: [
					{ filename: "example.txt", mimeType: "text/plain", size: 100 },
				],
			});
		if (path === "/api/mail-auth/mails/42/read") {
			reads++;
			return json({ success: true });
		}
		if (path === "/api/mail-auth/mails/42") {
			deleted = true;
			return json({ success: true });
		}
		if (path === "/api/mail-auth/inbox") return json({ success: true });
		return route.continue();
	});

	// ── 未登录首屏：登录 / 注册卡片 ──
	await page.goto(`${base}/mail/`);
	await page.locator(".mail-auth-card").waitFor();
	assert.equal(
		await page.getByRole("tab", { name: "登录" }).getAttribute("aria-selected"),
		"true",
	);
	// 登录后缀下拉：全部四个可选，默认 nocticur.eu.cc
	assert.equal(
		await page.locator("#mail-login-domain").inputValue(),
		"nocticur.eu.cc",
	);
	assert.equal(
		await page.locator("#mail-login-domain option").count(),
		4,
	);
	assert.equal(
		await page.locator("#mail-login-domain option[value='mourn.top']").count(),
		1,
	);
	await page.locator(".mail-app").screenshot({ path: shot("login.png") });

	// 注册页签：仅三个公开后缀，默认 nocticur.eu.cc，不含 mourn.top
	await page.getByRole("tab", { name: "注册" }).click();
	await page.locator("#mail-register-domain").waitFor();
	assert.equal(
		await page.locator("#mail-register-domain").inputValue(),
		"nocticur.eu.cc",
	);
	const domainOptions = await page
		.locator("#mail-register-domain option")
		.allInnerTexts();
	assert.deepEqual(domainOptions, [
		"@nocticur.eu.cc",
		"@noctis.eu.cc",
		"@caelus.eu.cc",
	]);

	// 粘贴完整邮箱自动拆分；@mourn.top 拒绝提交且不进入选项
	await page.locator("#mail-register-prefix").evaluate((el) => {
		const transfer = new DataTransfer();
		transfer.setData("text/plain", "pasted@mourn.top");
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
		);
	});
	assert.equal(await page.locator("#mail-register-prefix").inputValue(), "pasted");
	await page
		.getByText("不支持的后缀 @mourn.top", { exact: false })
		.first()
		.waitFor();
	await page
		.locator(".mail-auth-card input[name='new-password']")
		.fill("right-pass-1");
	await page
		.locator(".mail-auth-card input[name='confirm-password']")
		.fill("right-pass-1");
	await page.getByRole("button", { name: "注册并进入收件箱" }).click();
	await page
		.getByText("不支持的后缀 @mourn.top", { exact: false })
		.first()
		.waitFor();
	assert.equal(registerRequests, 0, "mourn.top paste must block submission");

	// 重复名注册 → 409 冲突提示
	await page.locator("#mail-register-prefix").fill("taken");
	await page.getByRole("button", { name: "注册并进入收件箱" }).click();
	await page.getByText("该邮箱地址已被注册", { exact: false }).waitFor();

	// 换一个名字注册成功，自动登录进入收件箱
	await page.locator("#mail-register-prefix").fill("reader");
	await page.getByText("reader@nocticur.eu.cc", { exact: false }).waitFor();
	await page.getByRole("button", { name: "注册并进入收件箱" }).click();
	await page.getByText("收件箱还是空的").waitFor();
	assert.equal(
		await page.evaluate(() =>
			document.cookie.includes("mail_user_session") ||
			sessionStorage.length > 0 ||
			localStorage.getItem("mail-session") !== null,
		),
		false,
	);

	// 收件箱：刷新 → 未读 → 详情净化 → 已读标记
	inboxMode = "inbox";
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
	await page.locator(".mail-app").screenshot({ path: shot("desktop.png") });

	// ── 移动端 ──
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
	await page.locator(".mail-app").screenshot({ path: shot("mobile.png") });
	await page.getByRole("button", { name: "返回收件箱" }).click();
	assert.equal(await page.locator(".mail-app__list-pane").isVisible(), true);
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.locator(".mail-app").screenshot({
		path: shot("mobile-dark.png"),
	});

	// ── 退出登录 → 回到登录卡片 ──
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.evaluate(() =>
		document.documentElement.classList.remove("dark"),
	);
	await page.getByRole("button", { name: "退出", exact: true }).click();
	await page.locator(".mail-auth-card").waitFor();
	assert.equal(
		await page.getByRole("tab", { name: "登录" }).getAttribute("aria-selected"),
		"true",
	);

	// ── 错误密码 → 提示；正确密码 → 收件箱 ──
	await page.locator("#mail-login-prefix").fill("reader");
	await page
		.locator(".mail-auth-card input[name='password']")
		.fill("wrong-pass");
	await page.getByRole("button", { name: "登录邮箱" }).click();
	await page.getByText("邮箱地址或密码错误").waitFor();
	await page.locator(".mail-app").screenshot({ path: shot("login-error.png") });
	await page
		.locator(".mail-auth-card input[name='password']")
		.fill("right-pass-1");
	await page.getByRole("button", { name: "登录邮箱" }).click();
	await page.getByText("收件箱还是空的").waitFor();

	// ── 会话失效 → 返回登录表单 ──
	inboxMode = "unauthorized";
	deleted = false;
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.getByText("登录状态已过期", { exact: false }).waitFor();
	assert.equal(
		await page.locator(".mail-auth-card").isVisible(),
		true,
	);
	sessionMode = "authed";

	// ── 粘贴完整 @mourn.top 地址登录 → 自动拆分到后缀下拉 ──
	await page.locator("#mail-login-prefix").evaluate((el) => {
		const transfer = new DataTransfer();
		transfer.setData("text/plain", "reader@mourn.top");
		el.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
		);
	});
	assert.equal(await page.locator("#mail-login-prefix").inputValue(), "reader");
	assert.equal(
		await page.locator("#mail-login-domain").inputValue(),
		"mourn.top",
	);
	await page
		.locator(".mail-auth-card input[name='password']")
		.fill("right-pass-1");
	await page.getByRole("button", { name: "登录邮箱" }).click();
	await page.getByText("收件箱还是空的").waitFor();

	// ── 上游安全验证拦截 → 重试提示，不丢会话 ──
	inboxMode = "challenge";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.getByText("邮箱服务需要安全验证", { exact: false }).waitFor();
	inboxMode = "empty";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page.getByText("收件箱还是空的").waitFor();

	// ── 删除邮件 ──
	inboxMode = "inbox";
	await page.getByRole("button", { name: "刷新", exact: true }).click();
	await page
		.getByRole("button", { name: "删除邮件：欢迎使用原生邮箱" })
		.click();
	await page.getByText("收件箱还是空的").waitFor();

	// ── 旧入口跳转 ──
	await page.goto(`${base}/role/`);
	await page.waitForURL(`${base}/mail/`);
	await page.getByText("收件箱还是空的").waitFor();

	console.log(
		JSON.stringify(
			{
				result: "PASS",
				checks: [
					"login card first",
					"login dropdown all four + default nocticur",
					"register dropdown three + default nocticur",
					"mourn.top paste blocked from register",
					"duplicate conflict",
					"register auto login",
					"no token in browser storage",
					"refresh",
					"unread + read marker",
					"detail sanitization",
					"mobile navigation",
					"no overflow",
					"logout",
					"wrong password",
					"401 returns to login form",
					"mourn.top paste splits login address",
					"challenge shows retry hint",
					"delete",
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
