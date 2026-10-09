import assert from "node:assert/strict";
import test from "node:test";
import {
	computeStarCount,
	detectPerformanceTier,
	initHomeHeroStars,
	nextPerformanceTier,
	resolveHeroStarsConfig,
	STARS_PERFORMANCE_BUDGET_MS,
	STARS_POWER_SAMPLE_SIZE,
	shouldRenderFrame,
} from "../src/utils/home-hero-stars.ts";

const CANVAS_SIZE = { width: 800, height: 600 };

function createGradient() {
	return { addColorStop() {} };
}

function createSpriteContext() {
	return {
		fillStyle: "",
		createRadialGradient: createGradient,
		fillRect() {},
	};
}

function createFrameContext(env) {
	return {
		globalAlpha: 1,
		setTransform() {},
		drawImage(_image, x, y, width, height) {
			env.draws.push({ x, y, width, height, alpha: this.globalAlpha });
		},
		clearRect() {
			env.frames += 1;
			// 模拟一帧的真实绘制开销，用来驱动自动降档。
			env.clock.advance(env.frameCostMs);
		},
	};
}

function createEnv(options = {}) {
	const env = {
		clock: {
			now: 0,
			advance(ms) {
				this.now += ms;
			},
		},
		frameCostMs: options.frameCostMs ?? 0,
		draws: [],
		frames: 0,
		rafCallbacks: new Map(),
		rafId: 0,
		resizeObservers: [],
		mutationObservers: [],
		documentListeners: new Map(),
		canvas: null,
		hero: null,
	};
	env.context = createFrameContext(env);

	env.hero = {
		getBoundingClientRect: () => ({
			...CANVAS_SIZE,
			left: 0,
			top: 0,
			right: CANVAS_SIZE.width,
			bottom: CANVAS_SIZE.height,
		}),
		querySelector: (selector) =>
			selector.includes("stars") ? env.canvas : null,
	};
	env.canvas = {
		width: 0,
		height: 0,
		style: {},
		classList: {
			values: new Set(),
			toggle(name, on) {
				if (on) this.values.add(name);
				else this.values.delete(name);
			},
			remove(name) {
				this.values.delete(name);
			},
			contains(name) {
				return this.values.has(name);
			},
		},
		getContext: () => env.context,
	};

	const saved = {};
	const install = (key, value) => {
		saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, {
			value,
			configurable: true,
			writable: true,
		});
	};

	install("performance", { now: () => env.clock.now });
	install("requestAnimationFrame", (callback) => {
		env.rafId += 1;
		env.rafCallbacks.set(env.rafId, callback);
		return env.rafId;
	});
	install("cancelAnimationFrame", (id) => {
		env.rafCallbacks.delete(id);
	});
	install(
		"ResizeObserver",
		class {
			constructor(callback) {
				this.callback = callback;
				this.disconnected = false;
				env.resizeObservers.push(this);
			}
			observe() {}
			disconnect() {
				this.disconnected = true;
			}
			trigger() {
				if (!this.disconnected) this.callback();
			}
		},
	);
	install(
		"MutationObserver",
		class {
			constructor(callback) {
				this.callback = callback;
				this.disconnected = false;
				env.mutationObservers.push(this);
			}
			observe() {}
			disconnect() {
				this.disconnected = true;
			}
			trigger() {
				if (!this.disconnected) this.callback();
			}
		},
	);
	install("getComputedStyle", () => ({ color: "rgb(238, 238, 238)" }));
	install("window", {
		devicePixelRatio: options.devicePixelRatio ?? 1,
		matchMedia(query) {
			const reduced = query.includes("reduced-motion");
			return {
				matches: reduced ? Boolean(options.reducedMotion) : false,
				addEventListener() {},
				removeEventListener() {},
			};
		},
	});
	install("document", {
		hidden: Boolean(options.hidden),
		documentElement: {},
		createElement: () => ({
			width: 0,
			height: 0,
			getContext: () => createSpriteContext(),
		}),
		addEventListener(type, handler, listenerOptions) {
			env.documentListeners.set(type, handler);
			listenerOptions?.signal?.addEventListener(
				"abort",
				() => env.documentListeners.delete(type),
				{ once: true },
			);
		},
		removeEventListener(type) {
			env.documentListeners.delete(type);
		},
	});
	install("navigator", {
		deviceMemory: options.deviceMemory,
		hardwareConcurrency: options.hardwareConcurrency,
	});

	env.restore = () => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	};

	env.step = (milliseconds, times = 1) => {
		for (let index = 0; index < times; index += 1) {
			env.clock.advance(milliseconds);
			const pending = [...env.rafCallbacks.values()];
			env.rafCallbacks.clear();
			for (const callback of pending) callback(env.clock.now);
		}
	};

	env.starsPerFrame = () =>
		env.frames === 0 ? 0 : env.draws.length / env.frames;

	return env;
}

test("resolveHeroStarsConfig reads hero.stars and falls back to hero.rain field by field", () => {
	assert.deepEqual(
		resolveHeroStarsConfig({
			stars: { enabled: true, intensity: 1, color: "#abc" },
		}),
		{ enabled: true, intensity: 1, color: "#abc" },
	);
	assert.deepEqual(
		resolveHeroStarsConfig({
			rain: { enabled: false, intensity: 0.25, color: "#123456" },
		}),
		{ enabled: false, intensity: 0.25, color: "#123456" },
	);
	assert.deepEqual(
		resolveHeroStarsConfig({
			stars: { enabled: false },
			rain: { intensity: 0.2, color: "#fff" },
		}),
		{ enabled: false, intensity: 0.2, color: "#fff" },
	);
	assert.deepEqual(resolveHeroStarsConfig({}), {
		enabled: true,
		intensity: 0.6,
		color: "",
	});
	assert.deepEqual(resolveHeroStarsConfig(null), {
		enabled: true,
		intensity: 0.6,
		color: "",
	});
	assert.equal(
		resolveHeroStarsConfig({
			stars: { intensity: 9 },
			rain: { intensity: 0.2 },
		}).intensity,
		1,
		"intensity clamps to 1",
	);
	assert.equal(
		resolveHeroStarsConfig({ stars: { intensity: -3 } }).intensity,
		0,
		"intensity clamps to 0",
	);
});

test("detectPerformanceTier downgrades on four or fewer cores or 4GB memory", () => {
	assert.equal(
		detectPerformanceTier({ deviceMemory: 8, hardwareConcurrency: 16 }),
		"normal",
	);
	assert.equal(
		detectPerformanceTier({ deviceMemory: 4, hardwareConcurrency: 16 }),
		"low",
	);
	assert.equal(
		detectPerformanceTier({ deviceMemory: 8, hardwareConcurrency: 4 }),
		"low",
	);
	assert.equal(detectPerformanceTier({}), "normal");
	assert.equal(detectPerformanceTier(), "normal");
});

test("computeStarCount scales with area and never exceeds the tier cap", () => {
	assert.equal(computeStarCount(800, 600, 0.6, 96), 37);
	assert.equal(computeStarCount(1600, 1000, 1, 96), 96);
	assert.equal(computeStarCount(1600, 1000, 1, 40), 40);
	assert.ok(
		computeStarCount(320, 200, 0.1, 96) >= 10,
		"small areas keep a floor",
	);
});

test("shouldRenderFrame enforces the per-tier frame budget", () => {
	assert.equal(shouldRenderFrame(1000, 1000, 30), false);
	assert.equal(shouldRenderFrame(1033, 1000, 30), true);
	assert.equal(shouldRenderFrame(1066, 1000, 15), false);
	assert.equal(shouldRenderFrame(1067, 1000, 15), true);
});

test("nextPerformanceTier only degrades, never upgrades within a page view", () => {
	assert.equal(
		nextPerformanceTier("normal", STARS_PERFORMANCE_BUDGET_MS),
		"normal",
	);
	assert.equal(
		nextPerformanceTier("normal", STARS_PERFORMANCE_BUDGET_MS + 0.1),
		"low",
	);
	assert.equal(nextPerformanceTier("low", STARS_PERFORMANCE_BUDGET_MS), "low");
	assert.equal(
		nextPerformanceTier("low", STARS_PERFORMANCE_BUDGET_MS + 0.1),
		"static",
	);
	assert.equal(nextPerformanceTier("static", 99), "static");
});

test("canvas keeps a pixel ratio of one even on high-density screens", () => {
	const env = createEnv({ devicePixelRatio: 3 });
	try {
		const controller = initHomeHeroStars(env.hero, { enabled: true });
		assert.equal(env.canvas.width, CANVAS_SIZE.width);
		assert.equal(env.canvas.height, CANVAS_SIZE.height);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("normal tier draws at most 96 stars at no more than 30 frames per second", () => {
	const env = createEnv();
	try {
		const controller = initHomeHeroStars(env.hero, {
			enabled: true,
			intensity: 1,
		});
		controller.setActive(true);
		env.step(1000 / 60, 60);
		assert.equal(env.frames, 30, "one second of 60Hz frames yields 30 renders");
		assert.ok(
			env.starsPerFrame() <= 96,
			`${env.starsPerFrame()} stars per frame exceeds the cap`,
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("stars visibly brighten and dim independently within four seconds without moving", () => {
	const env = createEnv();
	try {
		const controller = initHomeHeroStars(env.hero, {
			enabled: true,
			intensity: 1,
		});
		controller.setActive(true);
		env.step(1000 / 30);
		const firstFrame = [...env.draws];
		const count = firstFrame.length;
		env.step(1000 / 30, 120);
		const peakTimes = new Set();
		for (let index = 0; index < count; index += 1) {
			const samples = env.draws.filter(
				(_, drawIndex) => drawIndex % count === index,
			);
			const alphas = samples.map((sample) => sample.alpha);
			const peak = Math.max(...alphas);
			assert.ok(
				peak >= 0.4,
				`star ${index} should reach a clearly visible brightness`,
			);
			assert.ok(
				Math.min(...alphas) < peak * 0.15,
				`star ${index} should dim below 15% of its peak brightness`,
			);
			assert.ok(
				samples.every(
					(sample) =>
						sample.x === firstFrame[index].x &&
						sample.y === firstFrame[index].y,
				),
				"twinkling must keep stars in their original positions",
			);
			peakTimes.add(alphas.indexOf(peak));
		}
		assert.ok(
			peakTimes.size > count / 2,
			"stars should peak at different times",
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("low tier hardware caps stars at 40 and redraws at most 15 times per second", () => {
	const env = createEnv({ deviceMemory: 4 });
	try {
		const controller = initHomeHeroStars(env.hero, {
			enabled: true,
			intensity: 1,
		});
		controller.setActive(true);
		env.step(1000 / 60, 60);
		assert.ok(
			env.frames >= 14 && env.frames <= 15,
			`low tier renders ${env.frames} frames per second`,
		);
		assert.ok(
			env.starsPerFrame() <= 40,
			`${env.starsPerFrame()} stars per frame exceeds the low cap`,
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("a slow renderer degrades to the low tier and then stops at a static starfield", () => {
	const env = createEnv({ frameCostMs: STARS_PERFORMANCE_BUDGET_MS + 3 });
	try {
		const controller = initHomeHeroStars(env.hero, {
			enabled: true,
			intensity: 1,
		});
		controller.setActive(true);
		// 让采样窗口至少跑满一轮：前 STARS_POWER_SAMPLE_SIZE 帧仍应使用正常档。
		env.step(50, 10);
		assert.ok(
			env.starsPerFrame() > 40,
			`expected the normal tier first, saw ${env.starsPerFrame()} stars per frame`,
		);

		env.step(50, STARS_POWER_SAMPLE_SIZE);
		const framesAfterDowngrade = env.frames;
		const drawsAfterDowngrade = env.draws.length;
		env.step(50, 20);
		const lowTierStars =
			(env.draws.length - drawsAfterDowngrade) /
			Math.max(1, env.frames - framesAfterDowngrade);
		assert.ok(
			lowTierStars > 0 && lowTierStars <= 40,
			`low tier drew ${lowTierStars} stars per frame`,
		);

		env.step(50, 40);
		const staticDraws = env.draws.length;
		env.step(50, 40);
		assert.equal(
			env.draws.length,
			staticDraws,
			"the static tier stops drawing",
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("setActive(false) pauses drawing and setActive(true) resumes it", () => {
	const env = createEnv();
	try {
		const controller = initHomeHeroStars(env.hero, { enabled: true });
		controller.setActive(true);
		env.step(50, 10);
		assert.ok(env.frames > 0);
		controller.setActive(false);
		const paused = env.draws.length;
		env.step(50, 20);
		assert.equal(env.draws.length, paused, "no drawing while inactive");
		controller.setActive(true);
		env.step(50, 10);
		assert.ok(env.draws.length > paused, "drawing resumes when active again");
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("hidden tabs cancel the animation loop", () => {
	const env = createEnv();
	try {
		const controller = initHomeHeroStars(env.hero, { enabled: true });
		controller.setActive(true);
		env.step(50, 5);
		assert.ok(env.frames > 0);
		globalThis.document.hidden = true;
		env.documentListeners.get("visibilitychange")?.();
		const before = env.draws.length;
		env.step(50, 20);
		assert.equal(env.draws.length, before, "hidden tab must not draw");
		assert.equal(
			env.rafCallbacks.size,
			0,
			"no frame is scheduled while hidden",
		);
		globalThis.document.hidden = false;
		env.documentListeners.get("visibilitychange")?.();
		env.step(50, 10);
		assert.ok(
			env.draws.length > before,
			"drawing resumes when the tab returns",
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("reduced motion paints one static starfield and never starts a loop", () => {
	const env = createEnv({ reducedMotion: true });
	try {
		const controller = initHomeHeroStars(env.hero, { enabled: true });
		controller.setActive(true);
		assert.ok(env.draws.length > 0, "static stars are painted");
		assert.equal(env.rafCallbacks.size, 0, "no animation frame is requested");
		const painted = env.draws.length;
		env.step(50, 20);
		assert.equal(
			env.draws.length,
			painted,
			"the static starfield is not repainted",
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("destroy stops drawing, disconnects observers and removes listeners", () => {
	const env = createEnv();
	try {
		const controller = initHomeHeroStars(env.hero, { enabled: true });
		controller.setActive(true);
		env.step(50, 10);
		controller.destroy();
		const draws = env.draws.length;
		env.step(50, 20);
		assert.equal(env.draws.length, draws, "destroyed controller must not draw");
		assert.equal(env.rafCallbacks.size, 0);
		assert.ok(env.resizeObservers.every((observer) => observer.disconnected));
		assert.ok(env.mutationObservers.every((observer) => observer.disconnected));
		assert.equal(
			env.documentListeners.size,
			0,
			"visibilitychange listener removed",
		);
		controller.setActive(true);
		env.step(50, 10);
		assert.equal(env.draws.length, draws, "destroy is final");
	} finally {
		env.restore();
	}
});

test("only an actual size change regenerates the starfield", () => {
	const env = createEnv({ reducedMotion: true });
	try {
		const controller = initHomeHeroStars(env.hero, {
			enabled: true,
			intensity: 1,
		});
		controller.setActive(true);
		const paintedOnce = env.draws.length;
		assert.ok(paintedOnce > 0);
		env.resizeObservers[0].trigger();
		assert.equal(
			env.draws.length,
			paintedOnce,
			"an unchanged size must not regenerate the starfield",
		);
		env.hero.getBoundingClientRect = () => ({
			width: 1200,
			height: 900,
			left: 0,
			top: 0,
			right: 1200,
			bottom: 900,
		});
		env.resizeObservers[0].trigger();
		assert.equal(env.canvas.width, 1200);
		assert.ok(
			env.draws.length > paintedOnce,
			"a real size change repaints the starfield",
		);
		const positionsBefore = env.draws
			.slice(0, paintedOnce)
			.map((draw) => `${draw.x}:${draw.y}`);
		const positionsAfter = env.draws
			.slice(paintedOnce)
			.map((draw) => `${draw.x}:${draw.y}`);
		assert.notDeepEqual(
			positionsAfter,
			positionsBefore,
			"the regenerated starfield has new positions",
		);
		controller.destroy();
	} finally {
		env.restore();
	}
});

test("a second mount on the same hero replaces the previous controller", () => {
	const env = createEnv();
	try {
		const first = initHomeHeroStars(env.hero, { enabled: true });
		first.setActive(true);
		env.step(50, 4);
		const second = initHomeHeroStars(env.hero, { enabled: true });
		second.setActive(true);
		assert.ok(
			env.resizeObservers[0].disconnected,
			"the first controller releases its observers",
		);
		assert.equal(
			env.resizeObservers.filter((observer) => !observer.disconnected).length,
			1,
			"a single live controller remains",
		);
		second.destroy();
	} finally {
		env.restore();
	}
});

test("a disabled config never touches the canvas", () => {
	const env = createEnv();
	try {
		const controller = initHomeHeroStars(env.hero, { enabled: false });
		controller.setActive(true);
		env.step(50, 10);
		assert.equal(env.draws.length, 0);
		assert.equal(env.frames, 0);
		assert.equal(env.rafCallbacks.size, 0);
		controller.destroy();
	} finally {
		env.restore();
	}
});
