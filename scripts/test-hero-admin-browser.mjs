import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4321";

const INSTRUMENT = `
window.__stars = { draws: 0, frames: 0, observers: { created: 0, disconnected: 0 } };
window.__longTasks = [];
const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
	const canvas = this.canvas;
	if (canvas && canvas.hasAttribute && canvas.hasAttribute("data-hero-stars")) window.__stars.draws += 1;
	return originalDrawImage.apply(this, args);
};
const originalClearRect = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function (...args) {
	const canvas = this.canvas;
	if (canvas && canvas.hasAttribute && canvas.hasAttribute("data-hero-stars")) window.__stars.frames += 1;
	return originalClearRect.apply(this, args);
};
const OriginalResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends OriginalResizeObserver {
	constructor(callback) { super(callback); this.__heroStars = false; }
	observe(target) {
		if (target instanceof HTMLElement && target.hasAttribute("data-home-hero")) {
			this.__heroStars = true;
			window.__stars.observers.created += 1;
		}
		return super.observe(target);
	}
	disconnect() {
		if (this.__heroStars) window.__stars.observers.disconnected += 1;
		return super.disconnect();
	}
};
try {
	new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] });
} catch {}
`;

async function waitForServer(url, timeoutMs = 90000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { redirect: "manual" });
			if (response.status < 500) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`dev server did not answer at ${url}`);
}

const draws = (page) => page.evaluate(() => window.__stars.draws);
const frames = (page) => page.evaluate(() => window.__stars.frames);
const starActive = (page) =>
	page.evaluate(() =>
		Boolean(
			document
				.querySelector("canvas[data-hero-stars]")
				?.classList.contains("is-active"),
		),
	);

async function activateStars(page) {
	await page.evaluate(async () => {
		const step = Math.round(window.innerHeight * 0.2);
		for (let index = 0; index < 45; index += 1) {
			window.scrollTo(0, step * index);
			await new Promise((resolve) =>
				requestAnimationFrame(() => resolve(null)),
			);
			if (
				document
					.querySelector("canvas[data-hero-stars]")
					?.classList.contains("is-active")
			)
				return;
		}
	});
	for (
		let attempt = 0;
		attempt < 40 && !(await starActive(page));
		attempt += 1
	) {
		await page.mouse.wheel(0, 500);
		await page.waitForTimeout(80);
	}
	await page.waitForFunction(
		() =>
			document
				.querySelector("canvas[data-hero-stars]")
				?.classList.contains("is-active"),
		null,
		{ timeout: 10000 },
	);
}

await waitForServer(origin);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
	// ---------- 桌面：导航与工具栏入口 ----------
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	page.on("pageerror", (error) => errors.push(`desktop: ${error.message}`));
	await page.addInitScript(INSTRUMENT);
	await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-home-hero]");
	assert.equal(await page.locator("vite-error-overlay").count(), 0);

	for (const scope of ["#navbar", "#nav-menu-panel", "#mobile-dock"]) {
		const text = await page.locator(scope).first().textContent();
		assert.ok(
			!String(text).includes("写作"),
			`${scope} 不应再出现「写作」入口`,
		);
	}
	assert.equal(
		await page.locator('a[href="/writing/"]').count(),
		0,
		"导航中不应再有 /writing/ 可见入口",
	);

	const adminLink = page.locator("#dock-admin-link");
	await adminLink.waitFor();
	assert.equal(await adminLink.getAttribute("href"), "/admin/");
	assert.ok(
		(await adminLink.getAttribute("data-no-swup")) !== null,
		"后台入口需要 data-no-swup",
	);
	assert.equal(await adminLink.getAttribute("aria-label"), "后台管理");
	const calendarBox = await page.locator("#dock-calendar-btn").boundingBox();
	const adminBox = await adminLink.boundingBox();
	assert.ok(adminBox.y > calendarBox.y, "后台入口应紧跟在日历按钮下方");
	assert.ok(
		Math.abs(adminBox.x - calendarBox.x) < 2,
		"后台入口应与日历按钮左对齐",
	);

	// ---------- 桌面：星光画布 ----------
	assert.equal(
		await page.locator("canvas[data-hero-rain]").count(),
		0,
		"雨效画布应已移除",
	);
	const layering = await page.evaluate(() => {
		const canvas = document.querySelector("canvas[data-hero-stars]");
		const identity = document.querySelector(".home-hero__identity");
		const shade = document.querySelector(".home-hero__shade");
		return {
			pointerEvents: getComputedStyle(canvas).pointerEvents,
			display: getComputedStyle(canvas).display,
			zIndex: Number(getComputedStyle(canvas).zIndex),
			identityZIndex: Number(getComputedStyle(identity).zIndex),
			shadeZIndex: Number(getComputedStyle(shade).zIndex),
			devicePixelRatio: window.devicePixelRatio,
			bitmapWidth: canvas.width,
			cssWidth: Math.round(canvas.getBoundingClientRect().width),
		};
	});
	assert.equal(layering.pointerEvents, "none", "星光层不能拦截点击");
	assert.ok(layering.zIndex > layering.shadeZIndex, "星光层应在遮罩之上");
	assert.ok(
		layering.zIndex < layering.identityZIndex,
		"星光层应在文字与交互内容之下",
	);
	assert.equal(
		layering.bitmapWidth,
		layering.cssWidth,
		"画布像素倍率应固定为 1",
	);

	await activateStars(page);
	const drawsBefore = await draws(page);
	const framesBefore = await frames(page);
	await page.waitForTimeout(1000);
	const drawsAfter = await draws(page);
	const perSecond = (await frames(page)) - framesBefore;
	assert.ok(drawsAfter > drawsBefore, "激活后星光应持续绘制");
	assert.ok(
		perSecond > 0 && perSecond <= 40,
		`每秒重绘 ${perSecond} 帧，超过 30 帧上限`,
	);
	const starPixels = await page.evaluate(() => {
		const canvas = document.querySelector("canvas[data-hero-stars]");
		const { data } = canvas
			.getContext("2d")
			.getImageData(0, 0, canvas.width, canvas.height);
		let lit = 0;
		for (let index = 3; index < data.length; index += 4)
			if (data[index] > 8) lit += 1;
		return lit;
	});
	assert.ok(starPixels > 0, "画布上应能看到星点像素");

	// ---------- 桌面：标签页隐藏后暂停 ----------
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => true,
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	const hiddenStart = await frames(page);
	await page.waitForTimeout(700);
	assert.equal(await frames(page), hiddenStart, "标签页隐藏后不应继续绘制");
	await page.evaluate(() => {
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => false,
		});
		document.dispatchEvent(new Event("visibilitychange"));
	});
	await page.waitForTimeout(700);
	assert.ok((await frames(page)) > hiddenStart, "标签页恢复后应继续绘制");

	// ---------- 桌面：离开背景区域后暂停 ----------
	await page.mouse.wheel(0, 12000);
	await page.waitForTimeout(900);
	assert.equal(await starActive(page), false, "离开背景区域后星光应停止");
	const pausedFrames = await frames(page);
	await page.waitForTimeout(800);
	assert.equal(await frames(page), pausedFrames, "离屏后不应继续绘制");

	// ---------- 桌面：往返后只保留一套控制器 ----------
	await page.evaluate(async () => {
		await window.swup.navigate("/calendar/");
	});
	await page.waitForFunction(() => location.pathname === "/calendar/");
	await page.evaluate(async () => {
		await window.swup.navigate("/");
	});
	await page.waitForFunction(
		() =>
			location.pathname === "/" &&
			Boolean(document.querySelector("[data-home-hero]")),
	);
	await page.waitForTimeout(600);
	const observers = await page.evaluate(() => window.__stars.observers);
	assert.equal(
		observers.created - observers.disconnected,
		1,
		"首页往返后应只剩一套星光控制器",
	);

	// ---------- 桌面：整页加载后台 ----------
	await page.locator("#dock-admin-link").waitFor();
	await page.evaluate(() => {
		window.__swupMarker = true;
	});
	await page.locator("#dock-admin-link").click();
	await page.waitForURL(`${origin}/admin/`);
	await page.waitForSelector(".admin-login");
	assert.equal(
		await page.evaluate(() => window.__swupMarker),
		undefined,
		"data-no-swup 应触发整页加载",
	);
	assert.equal(await page.locator("vite-error-overlay").count(), 0);

	await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-home-hero]");
	await page.locator("#dock-admin-link").waitFor();
	const longTasks = await page.evaluate(() => window.__longTasks);
	console.log(`桌面长任务: ${JSON.stringify(longTasks)}`);
	assert.ok(Math.max(0, ...longTasks) < 300, "滚动过程不应出现新的超长任务");
	await page.close();

	// ---------- 移动端 ----------
	const mobileContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		deviceScaleFactor: 2,
	});
	const mobile = await mobileContext.newPage();
	mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
	await mobile.addInitScript(INSTRUMENT);
	await mobile.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await mobile.waitForSelector("#mobile-dock");
	await mobile.click("#mobile-dock-menu-btn");
	const mobileAdmin = mobile.locator('#mobile-dock a[href="/admin/"]');
	await mobileAdmin.waitFor();
	assert.equal(await mobileAdmin.getAttribute("aria-label"), "后台管理");
	assert.equal((await mobileAdmin.innerText()).trim(), "管理");
	const mobileCalendar = await mobile
		.locator('#mobile-dock [data-view-target="calendar"]')
		.boundingBox();
	const mobileAdminBox = await mobileAdmin.boundingBox();
	assert.ok(mobileAdminBox.x > mobileCalendar.x, "移动端后台入口应在日历之后");
	assert.ok(
		mobileAdminBox.height >= 40,
		`移动端后台入口点击区域过小：${mobileAdminBox.height}`,
	);
	assert.ok(
		await mobile.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
		"移动端不应出现横向挤压",
	);
	assert.equal(
		await mobile.evaluate(() => window.__stars.frames),
		0,
		"移动首页不应创建星光动画循环",
	);
	assert.ok(
		!String(await mobile.locator("#mobile-dock").textContent()).includes(
			"写作",
		),
		"移动菜单不应再有「写作」",
	);

	await mobile.evaluate(() => {
		window.__mobileMarker = true;
	});
	await mobileAdmin.click();
	await mobile.waitForURL(`${origin}/admin/`);
	await mobile.waitForSelector(".admin-login");
	assert.equal(
		await mobile.evaluate(() => window.__mobileMarker),
		undefined,
		"移动端后台入口也应整页加载",
	);
	await mobile.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await mobile.waitForSelector("#mobile-dock");
	await mobile.click("#mobile-dock-menu-btn");
	await mobile.locator('#mobile-dock a[href="/admin/"]').waitFor();
	await mobile.close();
	await mobileContext.close();

	// ---------- CPU 4 倍限速对比 ----------
	const throttledContext = await browser.newContext({
		viewport: { width: 1280, height: 900 },
	});
	const throttled = await throttledContext.newPage();
	throttled.on("pageerror", (error) =>
		errors.push(`throttled: ${error.message}`),
	);
	await throttled.addInitScript(INSTRUMENT);
	const cdp = await throttledContext.newCDPSession(throttled);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
	await throttled.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await throttled.waitForSelector("[data-home-hero]");
	await activateStars(throttled);
	const sampleThrottled = async () => ({
		frames: await frames(throttled),
		draws: await draws(throttled),
	});
	const sampleOne = await sampleThrottled();
	await throttled.waitForTimeout(1500);
	const sampleTwo = await sampleThrottled();
	await throttled.waitForTimeout(1500);
	const sampleThree = await sampleThrottled();
	const rateA = (sampleTwo.frames - sampleOne.frames) / 1.5;
	const starsA =
		(sampleTwo.draws - sampleOne.draws) /
		Math.max(1, sampleTwo.frames - sampleOne.frames);
	const rateB = (sampleThree.frames - sampleTwo.frames) / 1.5;
	const starsB =
		(sampleThree.draws - sampleTwo.draws) /
		Math.max(1, sampleThree.frames - sampleTwo.frames);
	console.log(
		`4× CPU 限速：第一段 ${rateA.toFixed(1)} 帧/秒 · ${starsA.toFixed(1)} 颗/帧；第二段 ${rateB.toFixed(1)} 帧/秒 · ${starsB.toFixed(1)} 颗/帧`,
	);
	assert.ok(rateA <= 40 && rateB <= 40, "限速下仍应保持 30 帧上限");
	assert.ok(starsA <= 96 && starsB <= 96, "限速下星点数不应超过正常档上限");

	// 更重的限速下观察自动降档：星点密度只能持平或降到低性能档（≤40），不应回涨
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: 12 });
	const heavyStart = await sampleThrottled();
	await throttled.waitForTimeout(2500);
	const heavyEnd = await sampleThrottled();
	const heavyRate = (heavyEnd.frames - heavyStart.frames) / 2.5;
	const heavyStars =
		(heavyEnd.draws - heavyStart.draws) /
		Math.max(1, heavyEnd.frames - heavyStart.frames);
	console.log(
		`12× CPU 限速：${heavyRate.toFixed(1)} 帧/秒 · ${heavyStars.toFixed(1)} 颗/帧${heavyStars <= 40 ? "（已自动降到低性能档）" : "（仍在正常档）"}`,
	);
	assert.ok(heavyRate <= 40, "更重的限速下仍不能超过 30 帧上限");
	assert.ok(heavyStars <= 96, "星点密度不应超过正常档上限");
	assert.ok(heavyStars <= starsA + 5, "自动降档只应减少或保持星点密度");

	// 稳定期（不滚动）不应出现长任务
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
	await throttled.evaluate(() => {
		window.__longTasks.length = 0;
	});
	await throttled.waitForTimeout(2000);
	const steadyLongTasks = await throttled.evaluate(() => window.__longTasks);
	console.log(`4× CPU 限速稳定期长任务: ${JSON.stringify(steadyLongTasks)}`);
	assert.ok(Math.max(0, ...steadyLongTasks) < 150, "限速稳定期不应出现长任务");

	await throttled.mouse.wheel(0, 12000);
	await throttled.waitForTimeout(1200);
	assert.equal(
		await starActive(throttled),
		false,
		"限速下离开背景区域同样应停止",
	);
	const throttledPaused = await frames(throttled);
	await throttled.waitForTimeout(800);
	assert.equal(
		await frames(throttled),
		throttledPaused,
		"限速下离屏后不应继续绘制",
	);

	// 同一滚动过程下对比「星光开启 / 关闭」，确认没有新增长任务
	const runScrollProcess = async (target) => {
		await target.evaluate(async () => {
			const step = Math.round(window.innerHeight * 0.2);
			for (let index = 0; index < 45; index += 1) {
				window.scrollTo(0, step * index);
				await new Promise((resolve) =>
					requestAnimationFrame(() => resolve(null)),
				);
			}
		});
		for (let attempt = 0; attempt < 40; attempt += 1) {
			await target.mouse.wheel(0, 500);
			await target.waitForTimeout(80);
		}
	};
	const measureScrollLongTasks = async (disableStars) => {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
		});
		const target = await context.newPage();
		await target.addInitScript(INSTRUMENT);
		if (disableStars) {
			await target.addInitScript(
				"const originalGetContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type) { if (this.hasAttribute && this.hasAttribute('data-hero-stars')) return null; return originalGetContext.call(this, type); };",
			);
		}
		const session = await context.newCDPSession(target);
		await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
		await target.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
		await target.waitForSelector("[data-home-hero]");
		await target.waitForTimeout(800);
		await target.evaluate(() => {
			window.__longTasks.length = 0;
		});
		await runScrollProcess(target);
		await target.waitForTimeout(1200);
		const tasks = await target.evaluate(() => window.__longTasks.slice());
		await context.close();
		return tasks;
	};
	const longTasksWithStars = await measureScrollLongTasks(false);
	const longTasksWithoutStars = await measureScrollLongTasks(true);
	const totalWithStars = longTasksWithStars.reduce(
		(sum, value) => sum + value,
		0,
	);
	const totalWithoutStars = longTasksWithoutStars.reduce(
		(sum, value) => sum + value,
		0,
	);
	console.log(
		`4× CPU 限速滚动长任务：星光开启 ${longTasksWithStars.length} 个 / 合计 ${totalWithStars}ms；关闭星光 ${longTasksWithoutStars.length} 个 / 合计 ${totalWithoutStars}ms`,
	);
	assert.ok(
		totalWithStars <= totalWithoutStars * 1.5 + 500,
		`星光不应显著增加长任务（${totalWithStars}ms vs ${totalWithoutStars}ms）`,
	);
	await throttled.close();
	await throttledContext.close();

	// ---------- 减少动态效果 ----------
	const reducedContext = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		reducedMotion: "reduce",
	});
	const reduced = await reducedContext.newPage();
	reduced.on("pageerror", (error) => errors.push(`reduced: ${error.message}`));
	await reduced.addInitScript(INSTRUMENT);
	await reduced.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await reduced.waitForSelector("[data-home-hero]");
	await reduced.waitForTimeout(1200);
	const staticFrames = await frames(reduced);
	assert.ok(staticFrames > 0, "减少动态效果时应绘制静态星空");
	await reduced.waitForTimeout(1000);
	assert.equal(
		await frames(reduced),
		staticFrames,
		"减少动态效果时不应运行绘制循环",
	);
	const reducedPixels = await reduced.evaluate(() => {
		const canvas = document.querySelector("canvas[data-hero-stars]");
		const { data } = canvas
			.getContext("2d")
			.getImageData(0, 0, canvas.width, canvas.height);
		let lit = 0;
		for (let index = 3; index < data.length; index += 4)
			if (data[index] > 8) lit += 1;
		return lit;
	});
	assert.ok(reducedPixels > 0, "减少动态效果时静态星点应可见");
	assert.ok(
		await reduced.evaluate(
			() =>
				getComputedStyle(document.querySelector("canvas[data-hero-stars]"))
					.display !== "none",
		),
		"减少动态效果时不应隐藏星光画布",
	);
	await reduced.close();
	await reducedContext.close();

	assert.deepEqual(errors, []);
	console.log(
		"Browser verification passed: 后台入口（桌面/移动）、导航无「写作」、星光限帧/离屏暂停/标签页暂停/减少动态效果与控制器唯一性。",
	);
} finally {
	await browser.close();
}
