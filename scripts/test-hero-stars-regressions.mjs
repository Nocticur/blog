import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const origin = process.env.FEATURE_TEST_ORIGIN || "http://127.0.0.1:4321";
const instrumentation = `
window.__starFrames = 0;
const clearRect = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function(...args) {
  if (this.canvas.hasAttribute("data-hero-stars")) window.__starFrames++;
  return clearRect.apply(this, args);
};
`;

async function inspectStars(page) {
	return page.evaluate(() => {
		const canvas = document.querySelector("[data-hero-stars]");
		const pixels = canvas
			.getContext("2d")
			.getImageData(0, 0, canvas.width, canvas.height).data;
		let litPixels = 0;
		for (let index = 3; index < pixels.length; index += 4)
			if (pixels[index] > 8) litPixels++;
		return {
			active: canvas.classList.contains("is-active"),
			litPixels,
			frames: window.__starFrames,
		};
	});
}

async function openPage(reducedMotion = "no-preference") {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1280, height: 900 },
		reducedMotion,
	});
	await page.addInitScript(instrumentation);
	await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(
		() =>
			document.querySelector("[data-home-hero]")?.dataset.heroMounted ===
			"true",
	);
	await page.waitForTimeout(1200);
	return { browser, page };
}

test("减少动态效果下刷新仍保留静态星光及可用快捷操作", async () => {
	const { browser, page } = await openPage("reduce");
	try {
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForFunction(
			() =>
				document.querySelector("[data-home-hero]")?.dataset.heroMounted ===
				"true",
		);
		await page.waitForTimeout(1200);
		const afterReload = await inspectStars(page);
		assert.ok(
			afterReload.active && afterReload.litPixels > 0,
			"刷新后静态星点应仍可见",
		);
		assert.equal(
			await page.locator("[data-home-hero]").getAttribute("data-layer-active"),
			"true",
		);
		assert.ok(
			await page
				.locator("[data-hero-action]")
				.evaluateAll((actions) =>
					actions.every(
						(action) =>
							action.tabIndex === 0 &&
							action.getAttribute("aria-hidden") === "false",
					),
				),
		);
		await page.waitForTimeout(700);
		assert.equal(
			(await inspectStars(page)).frames,
			afterReload.frames,
			"静态模式不应持续绘制",
		);
	} finally {
		await browser.close();
	}
});

test("运行时切换减少动态效果会切换静态场景与唯一滚动控制器", async () => {
	const { browser, page } = await openPage();
	try {
		for (let index = 0; index < 2; index++) {
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.waitForTimeout(600);
			const staticState = await inspectStars(page);
			assert.ok(
				staticState.active && staticState.litPixels > 0,
				"在初始拼图场景切到减少动态效果应显示静态星光",
			);
			assert.equal(
				await page
					.locator("[data-home-hero]")
					.getAttribute("data-reduced-motion"),
				"true",
			);
			assert.equal(
				await page
					.locator("[data-home-hero]")
					.evaluate((hero) =>
						hero.parentElement.classList.contains("pin-spacer"),
					),
				false,
				"静态场景不应残留 Hero pin",
			);
			await page.waitForTimeout(700);
			assert.equal(
				(await inspectStars(page)).frames,
				staticState.frames,
				"运行时静态模式不应继续绘制",
			);
			await page.emulateMedia({ reducedMotion: "no-preference" });
			await page.waitForTimeout(900);
			assert.equal(
				await page
					.locator("[data-home-hero]")
					.getAttribute("data-reduced-motion"),
				null,
			);
			assert.equal(
				await page
					.locator("[data-home-hero]")
					.evaluate((hero) =>
						hero.parentElement.classList.contains("pin-spacer"),
					),
				true,
				"恢复动态效果应重建滚动场景",
			);
			assert.equal(
				await page
					.locator("[data-home-hero]")
					.evaluate((hero) =>
						hero.parentElement.parentElement.classList.contains("pin-spacer"),
					),
				false,
				"不能重建嵌套 pin",
			);
			assert.equal(
				(await inspectStars(page)).active,
				false,
				"初始拼图场景必须继续遵循时间线激活门槛",
			);
		}
	} finally {
		await browser.close();
	}
});

test("背景刚完全离屏就停绘，不延伸到视口外的 15% 区域", async () => {
	const { browser, page } = await openPage();
	try {
		await page.evaluate(() =>
			window.scrollTo(0, document.documentElement.scrollHeight),
		);
		await page.waitForTimeout(1600);
		await page.evaluate(() => {
			const hero = document.querySelector("[data-home-hero]");
			window.scrollTo(
				0,
				window.scrollY + hero.getBoundingClientRect().bottom + 20,
			);
		});
		await page.waitForTimeout(1000);
		const bottom = await page
			.locator("[data-home-hero]")
			.evaluate((hero) => hero.getBoundingClientRect().bottom);
		assert.ok(
			bottom < 0 && bottom > -135,
			`检查位置应刚好离屏，实际 bottom=${bottom}`,
		);
		const paused = await inspectStars(page);
		assert.equal(paused.active, false, "视口之外的星光必须停止");
		await page.waitForTimeout(700);
		assert.equal((await inspectStars(page)).frames, paused.frames);
	} finally {
		await browser.close();
	}
});
