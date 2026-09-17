import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.MAIL_TEST_URL || "http://127.0.0.1:4321";
const browser = await chromium.launch({ channel: "chrome", headless: true });

// 可在用例间动态调整的 mock 后端状态
const state = {
	loggedIn: false,
	sessionOk: true,
	statistics: {
		ok: true,
		status: 200,
		body: { addressCount: 2, userCount: 3, mailCount: 8, unknownMailCount: 1 },
	},
	configs: {
		ok: true,
		status: 200,
		body: {
			ENABLE_USER_CREATE_EMAIL: true,
			DISABLE_ANONYMOUS_USER_CREATE_EMAIL: false,
			ENABLE_USER_DELETE_EMAIL: true,
		},
	},
};

function respond(spec) {
	if (!spec.ok || spec.status !== 200) {
		const raw =
			spec.raw ?? (spec.body !== undefined ? JSON.stringify(spec.body) : "");
		return { status: spec.status ?? 502, raw };
	}
	if (spec.raw !== undefined) return { status: 200, raw: spec.raw };
	return { status: 200, raw: JSON.stringify({ body: spec.body ?? {} }) };
}

const STATISTICS_OK_SNAKE = {
	ok: true,
	status: 200,
	body: {
		address_count: 0,
		user_count: 0,
		mail_count: 0,
		unknown_mail_count: 0,
	},
};
const CONFIGS_WITH_ANONYMOUS_CLOSED = {
	ok: true,
	status: 200,
	body: {
		ENABLE_USER_CREATE_EMAIL: true,
		DISABLE_ANONYMOUS_USER_CREATE_EMAIL: true,
		ENABLE_USER_DELETE_EMAIL: true,
	},
};

try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
	});
	const page = await context.newPage();
	const requests = [];

	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== new URL(base).origin) return route.abort();
		if (url.pathname === "/api/mail-auth/config") {
			return route.fulfill({
				json: {
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
				},
			});
		}
		if (url.pathname === "/api/mail-auth/admin/config") {
			if (!(state.loggedIn && state.sessionOk)) {
				return route.fulfill({ status: 401, json: { error: "管理员会话已过期" } });
			}
			return route.fulfill({
				json: {
					domains: [
						"nocticur.eu.cc",
						"noctis.eu.cc",
						"caelus.eu.cc",
						"mourn.top",
					],
					defaultDomain: "mourn.top",
				},
			});
		}
		if (!url.pathname.startsWith("/api/mail-admin/")) return route.continue();
		requests.push({ path: url.pathname, method: route.request().method() });
		if (url.pathname === "/api/mail-admin/session") {
			const ok = state.loggedIn && state.sessionOk;
			return route.fulfill({
				status: ok ? 200 : 401,
				json: ok
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
			state.loggedIn = true;
			return route.fulfill({
				json: {
					profile: { email: "admin@example.com", userId: 1, role: "master" },
				},
			});
		}
		if (url.pathname === "/api/mail-admin/admin/statistics") {
			const { status, raw } = respond(state.statistics);
			return route.fulfill({ status, body: raw });
		}
		if (url.pathname === "/api/mail-admin/admin/worker/configs") {
			const { status, raw } = respond(state.configs);
			return route.fulfill({ status, body: raw });
		}
		return route.fulfill({ json: { body: { results: [], count: 0 } } });
	});

	const metricValues = () =>
		page.$$eval(".mail-admin-metric strong", (els) =>
			els.map((el) => el.textContent.trim()),
		);

	const loginIfNeeded = async () => {
		await page.goto(`${base}/mail/admin/`);
		await page.getByRole("heading", { name: "邮件管理后台" }).waitFor();
		await page.locator("#mail-admin-prefix").fill("admin");
		// 管理员登录使用包含 mourn.top 的四后缀下拉
		assert.equal(
			await page.locator("#mail-admin-domain option[value='mourn.top']").count(),
			1,
		);
		await page.locator("#mail-admin-domain").selectOption("mourn.top");
		await page.getByLabel("密码").fill("correct-password");
		await page.getByRole("button", { name: "登录管理后台" }).click();
		await page.getByRole("heading", { name: "系统概览" }).waitFor();
	};

	// —— 场景 A：桌面端登录成功，统计与配置都正常 ——
	await loginIfNeeded();

	const layout = await page.evaluate(() => {
		const shell = document.querySelector(".mail-admin-shell");
		const sidebar = document.querySelector(".mail-admin-sidebar");
		const main = document.querySelector(".mail-admin-main");
		const navbar = document.querySelector("#top-row");
		const s = sidebar.getBoundingClientRect();
		const m = main.getBoundingClientRect();
		return {
			hasShell: !!shell,
			display: shell ? getComputedStyle(shell).display : "",
			columns: shell
				? getComputedStyle(shell).gridTemplateColumns.split(" ").length
				: 0,
			sidebarLeftOfMain: s.right <= m.left + 1,
			topsAligned: Math.abs(s.top - m.top) <= 2,
			coveredByNavbar:
				navbar && s.top < navbar.getBoundingClientRect().bottom - 1,
			horizontalOverflow:
				document.documentElement.scrollWidth > window.innerWidth,
		};
	});
	assert.equal(
		layout.hasShell,
		true,
		"logged-in root should use mail-admin-shell",
	);
	assert.equal(layout.display, "grid");
	assert.equal(layout.columns, 2, "desktop shell should be a two-column grid");
	assert.equal(layout.sidebarLeftOfMain, true);
	assert.equal(layout.topsAligned, true);
	assert.equal(
		layout.coveredByNavbar,
		false,
		"sidebar must not sit under the navbar",
	);
	assert.equal(layout.horizontalOverflow, false);

	assert.deepEqual(await metricValues(), ["2", "3", "8", "1"]);
	const switchTexts = await page.$$eval(
		".mail-admin-capability-list span b",
		(els) => els.map((el) => el.textContent.trim()),
	);
	assert.deepEqual(switchTexts, ["已开启", "已开启", "已开启"]);
	assert.equal(
		await page
			.locator(".mail-admin-sidebar-foot")
			.textContent()
			.then((t) => t.includes("数据读取正常")),
		true,
	);
	assert.equal(await page.locator(".mail-admin iframe").count(), 0);
	assert.equal(await page.evaluate(() => localStorage.length), 0);
	assert.equal(await page.evaluate(() => sessionStorage.length), 0);
	assert.equal(
		requests.some((request) => request.path === "/api/mail-admin/login"),
		true,
	);

	// —— 场景 B：手机抽屉导航 ——
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
	// 遮罩中心被展开的侧栏覆盖，点击侧栏右侧露出的遮罩区域关闭
	const backdrop = page.locator(".mail-admin-backdrop");
	const backdropBox = await backdrop.boundingBox();
	await backdrop.click({
		position: { x: backdropBox.width - 15, y: 30 },
	});
	assert.equal(
		await page.locator(".mail-admin-sidebar.mail-admin-sidebar-open").count(),
		0,
	);
	await page.setViewportSize({ width: 1440, height: 1000 });

	// —— 场景 C：统计失败、配置成功 —— 首次加载失败不出现假零值，配置保持真实开关
	state.statistics = {
		ok: false,
		status: 502,
		raw: JSON.stringify({ error: { code: "502", message: "bad gateway" } }),
	};
	await page.reload();
	await page.getByRole("heading", { name: "系统概览" }).waitFor();
	await page.locator(".mail-admin-module-alert").first().waitFor();
	assert.deepEqual(await metricValues(), ["—", "—", "—", "—"]);
	assert.equal(
		await page
			.locator(".mail-admin-module-alert")
			.first()
			.textContent()
			.then((t) => t.includes("系统统计加载失败（HTTP 502）")),
		true,
	);
	assert.equal(
		await page
			.locator(".mail-admin-sidebar-foot")
			.textContent()
			.then((t) => t.includes("部分请求失败")),
		true,
	);
	const switchesDuringStatsFailure = await page.$$eval(
		".mail-admin-capability-list span b",
		(els) => els.map((el) => el.textContent.trim()),
	);
	assert.deepEqual(switchesDuringStatsFailure, ["已开启", "已开启", "已开启"]);

	// —— 场景 D：重试统计成功 —— 合法零值显示 0（snake_case 字段走兼容键），错误清除
	state.statistics = STATISTICS_OK_SNAKE;
	await page.getByRole("button", { name: "重试统计" }).click();
	await page.waitForFunction(() =>
		[...document.querySelectorAll(".mail-admin-metric strong")].every(
			(el) => el.textContent.trim() === "0",
		),
	);
	assert.deepEqual(await metricValues(), ["0", "0", "0", "0"]);
	assert.equal(await page.locator(".mail-admin-module-alert").count(), 0);

	// —— 场景 E：配置失败、统计成功 —— 首次加载失败时开关显示未知，不出现假关闭状态
	state.configs = { ok: false, status: 500, raw: "<html>oops</html>" };
	await page.reload();
	await page.getByRole("heading", { name: "系统概览" }).waitFor();
	await page.locator(".mail-admin-module-alert").waitFor();
	const switchesDuringConfigFailure = await page.$$eval(
		".mail-admin-capability-list span b",
		(els) => els.map((el) => el.textContent.trim()),
	);
	assert.deepEqual(switchesDuringConfigFailure, ["未知", "未知", "未知"]);
	assert.equal(
		await page
			.locator(".mail-admin-module-alert")
			.textContent()
			.then((t) => t.includes("后端配置加载失败（HTTP 500）")),
		true,
	);
	assert.deepEqual(
		await metricValues(),
		["0", "0", "0", "0"],
		"statistics should stay intact",
	);

	// —— 场景 F：恢复成功后再次刷新失败，保留上次数据并标记；重试成功后更新并清除错误
	state.configs = CONFIGS_WITH_ANONYMOUS_CLOSED;
	await page.getByRole("button", { name: "重试配置" }).click();
	await page.waitForFunction(
		() =>
			JSON.stringify(
				[
					...document.querySelectorAll(".mail-admin-capability-list span b"),
				].map((el) => el.textContent.trim()),
			) === JSON.stringify(["已开启", "已关闭", "已开启"]),
	);
	state.configs = { ok: false, status: 503, raw: "" };
	await page.getByRole("button", { name: "刷新数据" }).click();
	await page.locator(".mail-admin-module-alert").waitFor();
	assert.equal(
		await page
			.locator(".mail-admin-module-alert")
			.textContent()
			.then((t) => t.includes("刷新失败，显示上次结果。")),
		true,
	);
	assert.deepEqual(
		await page.$$eval(".mail-admin-capability-list span b", (els) =>
			els.map((el) => el.textContent.trim()),
		),
		["已开启", "已关闭", "已开启"],
		"stale retained data (anonymous switch previously closed) must still be shown",
	);
	state.configs = {
		ok: true,
		status: 200,
		body: {
			ENABLE_USER_CREATE_EMAIL: true,
			DISABLE_ANONYMOUS_USER_CREATE_EMAIL: false,
			ENABLE_USER_DELETE_EMAIL: "false",
		},
	};
	await page.getByRole("button", { name: "重试配置" }).click();
	await page.waitForFunction(
		() =>
			document
				.querySelector(".mail-admin-capability-list span:last-child b")
				?.textContent.trim() === "已关闭",
	);
	assert.deepEqual(
		await page.$$eval(".mail-admin-capability-list span b", (els) =>
			els.map((el) => el.textContent.trim()),
		),
		["已开启", "已开启", "已关闭"],
		'the string "false" is a valid closed state',
	);
	assert.equal(await page.locator(".mail-admin-module-alert").count(), 0);

	// —— 场景 G：首次加载遇到空正文 / HTML 成功响应 —— 显示加载失败而非默认值
	state.statistics = { ok: true, status: 200, raw: "" };
	state.configs = {
		ok: true,
		status: 200,
		raw: "<html><body>hi</body></html>",
	};
	await page.reload();
	await page.locator(".mail-admin-module-alert").first().waitFor();
	assert.deepEqual(await metricValues(), ["—", "—", "—", "—"]);
	assert.equal(
		await page
			.locator(".mail-admin-module-alert")
			.first()
			.textContent()
			.then((t) => t.includes("系统统计返回了无法解析的数据")),
		true,
	);
	assert.deepEqual(
		await page.$$eval(".mail-admin-capability-list span b", (els) =>
			els.map((el) => el.textContent.trim()),
		),
		["未知", "未知", "未知"],
	);
	assert.equal(
		await page
			.locator(".mail-admin-sidebar-foot")
			.textContent()
			.then((t) => t.includes("管理数据加载失败")),
		true,
	);

	// —— 场景 H：管理接口 401 时先复核会话，会话有效则不退出登录
	state.statistics = {
		ok: false,
		status: 401,
		raw: JSON.stringify({ error: "管理员会话已过期" }),
	};
	state.configs = {
		ok: true,
		status: 200,
		body: { ENABLE_USER_CREATE_EMAIL: "true" },
	};
	await page.reload();
	await page.getByRole("heading", { name: "系统概览" }).waitFor();
	await page.locator(".mail-admin-module-alert").first().waitFor();
	assert.equal(
		await page.getByRole("heading", { name: "邮件管理后台" }).count(),
		0,
		"a valid session must not be logged out by a module 401",
	);
	assert.equal(
		await page
			.locator(".mail-admin-module-alert")
			.first()
			.textContent()
			.then((t) => t.includes("管理员会话已过期")),
		true,
	);
	assert.deepEqual(
		await page.$$eval(".mail-admin-capability-list span b", (els) =>
			els.map((el) => el.textContent.trim()),
		),
		["已开启", "未知", "未知"],
	);

	// —— 场景 I：会话真正失效时返回登录页，不出现登录循环
	state.sessionOk = false;
	await page.getByRole("button", { name: "刷新数据" }).click();
	await page
		.getByRole("heading", { name: "邮件管理后台" })
		.waitFor({ timeout: 10_000 });
	assert.equal(
		await page
			.locator(".mail-admin-form-error")
			.textContent()
			.then((t) => t.includes("登录已过期")),
		true,
	);

	// —— 主题切换（保留原有检查） ——
	state.sessionOk = true;
	state.loggedIn = false;
	await page.reload();
	await page.getByRole("button", { name: "开始首次设置" }).waitFor();
	await page.getByRole("button", { name: "开始首次设置" }).click();
	await page.getByRole("button", { name: "返回登录" }).click();
	await page.locator("#mail-admin-prefix").fill("admin");
	await page.locator("#mail-admin-domain").selectOption("mourn.top");
	await page.getByLabel("密码").fill("correct-password");
	await page.getByRole("button", { name: "登录管理后台" }).click();
	await page.getByRole("heading", { name: "系统概览" }).waitFor();
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
					"desktop-two-column-shell",
					"topbar-not-covered-by-navbar",
					"real-counts-and-switches",
					"valid-zero-and-string-false",
					"statistics-failure-no-fake-zero",
					"configs-failure-unknown-not-off",
					"stale-retention-and-retry",
					"invalid-success-bodies-rejected",
					"module-401-keeps-session",
					"expired-session-returns-to-login",
					"mobile-navigation",
					"no-horizontal-overflow",
					"no-token-storage",
					"no-iframe",
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
