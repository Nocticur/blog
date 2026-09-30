/**
 * 首页背景星光。
 *
 * 在背景大图铺开后的激活阶段，用预渲染好的星点贴图在 Canvas 上绘制固定位置的星点：
 * 低亮度白色为主、少量冰蓝点缀，亮度按 3–6 秒周期缓慢起伏。
 * 每帧只做贴图合成，不读布局、不建临时数组；颗数按显示面积和档位上限取整，
 * 帧率按档位封顶，采样到超预算的绘制耗时后逐级降档，最低停在一次静态星空。
 */

export type HeroStarsConfig = {
	enabled?: boolean;
	intensity?: number;
	color?: string;
};

export type HeroStarsTier = "normal" | "low" | "static";

export type HomeHeroStarsController = {
	setActive: (active: boolean) => void;
	destroy: () => void;
};

type StarsRuntimeConfig = {
	enabled: boolean;
	intensity: number;
	color: string;
};

type Star = {
	x: number;
	y: number;
	radius: number;
	alpha: number;
	period: number;
	phase: number;
	accent: boolean;
};

type Rgb = { r: number; g: number; b: number };

/** 各档位的颗数上限与每秒重绘上限；static 表示不再进入绘制循环。 */
export const STARS_TIER_SETTINGS: Record<
	HeroStarsTier,
	{ maxCount: number; fps: number }
> = {
	normal: { maxCount: 96, fps: 30 },
	low: { maxCount: 40, fps: 15 },
	static: { maxCount: 40, fps: 0 },
};

/** 单帧平均绘制耗时的预算，超过就降一档。 */
export const STARS_PERFORMANCE_BUDGET_MS = 8;
/** 累计多少次绘制后检查一次平均耗时。 */
export const STARS_POWER_SAMPLE_SIZE = 30;

const STARS_MIN_COUNT = 10;
const STARS_AREA_REFERENCE = 1_100_000;
const STARS_AREA_MIN_SCALE = 0.65;
const STARS_AREA_MAX_SCALE = 1.4;
const STARS_ACCENT_COLOR = "#bfe0ff";
const STARS_ACCENT_RATIO = 0.14;
const STARS_SPRITE_SIZE = 24;
const STARS_STATIC_ALPHA = 0.75;
const STARS_TAU = Math.PI * 2;
const STAR_POOL_SIZE = STARS_TIER_SETTINGS.normal.maxCount;

/** 同一个 hero 上只允许存在一套有效控制器。 */
const controllers = new WeakMap<HTMLElement, HomeHeroStarsController>();

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function readNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return clamp(value, min, max);
}

function readBoolean(value: unknown, fallback: boolean) {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * 统一读取 `hero.stars`；缺失的字段逐个回落到旧的 `hero.rain`，新字段优先。
 */
export function resolveHeroStarsConfig(
	config?: {
		stars?: HeroStarsConfig | null;
		rain?: HeroStarsConfig | null;
	} | null,
): StarsRuntimeConfig {
	const stars = config?.stars ?? null;
	const rain = config?.rain ?? null;
	const color = stars?.color ?? rain?.color ?? "";
	return {
		enabled: readBoolean(stars?.enabled, readBoolean(rain?.enabled, true)),
		intensity: readNumber(stars?.intensity ?? rain?.intensity, 0.6, 0, 1),
		color: typeof color === "string" ? color : "",
	};
}

/** 硬件信息里的内存或逻辑核心数不超过 4 时进入低性能档。 */
export function detectPerformanceTier(
	hardware?: { deviceMemory?: number; hardwareConcurrency?: number } | null,
): HeroStarsTier {
	const memory = hardware?.deviceMemory;
	const cores = hardware?.hardwareConcurrency;
	const lowMemory =
		typeof memory === "number" &&
		Number.isFinite(memory) &&
		memory > 0 &&
		memory <= 4;
	const lowCores =
		typeof cores === "number" &&
		Number.isFinite(cores) &&
		cores > 0 &&
		cores <= 4;
	return lowMemory || lowCores ? "low" : "normal";
}

/** 按显示面积在档位上限内取整颗数，面积越大越多，但始终落在 [10, maxCount]。 */
export function computeStarCount(
	width: number,
	height: number,
	intensity: number,
	maxCount: number,
) {
	const area = Math.max(0, width) * Math.max(0, height);
	const areaScale = clamp(
		area / STARS_AREA_REFERENCE,
		STARS_AREA_MIN_SCALE,
		STARS_AREA_MAX_SCALE,
	);
	const requested = Math.round(maxCount * clamp(intensity, 0, 1) * areaScale);
	return clamp(requested, Math.min(STARS_MIN_COUNT, maxCount), maxCount);
}

/** 距上次重绘够不够一个档位间隔，用于把 rAF 限到档位帧率。 */
export function shouldRenderFrame(
	now: number,
	lastRender: number,
	fps: number,
) {
	if (!(fps > 0)) return false;
	return now - lastRender >= 1000 / fps - 0.5;
}

/** 只降不升：正常档超预算降到低性能档，低性能档仍超预算就停在静态星空。 */
export function nextPerformanceTier(
	tier: HeroStarsTier,
	averageMs: number,
): HeroStarsTier {
	if (tier === "static") return "static";
	if (!(averageMs > STARS_PERFORMANCE_BUDGET_MS)) return tier;
	return tier === "normal" ? "low" : "static";
}

function parseColor(value: string): Rgb {
	const text = (value || "").trim();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
	if (hex) {
		const digits =
			hex[1].length === 3
				? hex[1]
						.split("")
						.map((digit) => digit + digit)
						.join("")
				: hex[1];
		return {
			r: Number.parseInt(digits.slice(0, 2), 16),
			g: Number.parseInt(digits.slice(2, 4), 16),
			b: Number.parseInt(digits.slice(4, 6), 16),
		};
	}
	const functional = /^rgba?\(([^)]+)\)$/i.exec(text);
	const parts = (functional ? functional[1] : text)
		.split(",")
		.slice(0, 3)
		.map((part) => Number.parseFloat(part.trim()));
	if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
		return {
			r: clamp(Math.round(parts[0]), 0, 255),
			g: clamp(Math.round(parts[1]), 0, 255),
			b: clamp(Math.round(parts[2]), 0, 255),
		};
	}
	return { r: 255, g: 255, b: 255 };
}

function createRandom(seed: number) {
	let value = seed >>> 0;
	return () => {
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
		return value / 4294967296;
	};
}

/** 星点贴图只在初始化、主题换色或尺寸变化时重建，绘制循环里只做 drawImage。 */
function createStarSprite(color: Rgb) {
	const sprite = document.createElement("canvas");
	sprite.width = STARS_SPRITE_SIZE;
	sprite.height = STARS_SPRITE_SIZE;
	const spriteContext = sprite.getContext("2d");
	if (!spriteContext) return null;
	const center = STARS_SPRITE_SIZE / 2;
	const gradient = spriteContext.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		center,
	);
	gradient.addColorStop(0, `rgba(${color.r},${color.g},${color.b},1)`);
	gradient.addColorStop(0.35, `rgba(${color.r},${color.g},${color.b},0.55)`);
	gradient.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
	spriteContext.fillStyle = gradient;
	spriteContext.fillRect(0, 0, STARS_SPRITE_SIZE, STARS_SPRITE_SIZE);
	return sprite;
}

export function initHomeHeroStars(
	hero: HTMLElement,
	configInput?: HeroStarsConfig | null,
): HomeHeroStarsController {
	const config = resolveHeroStarsConfig({ stars: configInput });
	const canvas = hero.querySelector<HTMLCanvasElement>("[data-hero-stars]");
	const context = canvas?.getContext("2d") ?? null;
	const abortController = new AbortController();

	if (!canvas || !context || !config.enabled) {
		return {
			setActive: () => undefined,
			destroy: () => abortController.abort(),
		};
	}

	controllers.get(hero)?.destroy();

	// 提升为只读别名，闭包里才能保持非空类型（守卫的收窄不会跨函数声明生效）
	const starsCanvas: HTMLCanvasElement = canvas;
	const frameContext: CanvasRenderingContext2D = context;

	const reducedMotionQuery = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	);
	const pool: Star[] = Array.from({ length: STAR_POOL_SIZE }, () => ({
		x: 0,
		y: 0,
		radius: 1,
		alpha: 0.4,
		period: 4000,
		phase: 0,
		accent: false,
	}));

	let width = 0;
	let height = 0;
	let starCount = 0;
	let tier = detectPerformanceTier(
		typeof navigator === "undefined" ? null : navigator,
	);
	let spritesReady = false;
	let primarySprite: HTMLCanvasElement | null = null;
	let accentSprite: HTMLCanvasElement | null = null;
	let primaryColor = "";
	let reducedMotion = reducedMotionQuery.matches;
	let active = false;
	let destroyed = false;
	let animationFrame = 0;
	let lastRender = 0;
	let sampleCount = 0;
	let sampleTotal = 0;

	const tierFps = () => STARS_TIER_SETTINGS[tier].fps;
	const isStaticMode = () => tier === "static" || reducedMotion;

	function readThemeColor() {
		try {
			return getComputedStyle(hero).color || "#ffffff";
		} catch {
			return "#ffffff";
		}
	}

	function refreshSprites() {
		const nextColor = config.color || readThemeColor();
		const changed = !spritesReady || nextColor !== primaryColor;
		primaryColor = nextColor;
		primarySprite = createStarSprite(parseColor(primaryColor));
		accentSprite = createStarSprite(parseColor(STARS_ACCENT_COLOR));
		spritesReady = true;
		return changed;
	}

	function rebuildStars() {
		const maxCount = STARS_TIER_SETTINGS[tier].maxCount;
		const nextCount = computeStarCount(
			width,
			height,
			config.intensity,
			maxCount,
		);
		const random = createRandom(0x9e3779b9 ^ Math.imul(nextCount, 2654435761));
		const columns = Math.max(
			1,
			Math.round(Math.sqrt(nextCount * (width / Math.max(1, height)))),
		);
		const rows = Math.max(1, Math.ceil(nextCount / columns));
		const cellWidth = width / columns;
		const cellHeight = height / rows;
		for (let index = 0; index < nextCount; index += 1) {
			const star = pool[index];
			star.x = Math.min(
				width,
				(index % columns) * cellWidth + random() * cellWidth,
			);
			star.y = Math.min(
				height,
				Math.floor(index / columns) * cellHeight + random() * cellHeight,
			);
			star.radius = 0.6 + random() * 1.1;
			star.alpha = 0.28 + random() * 0.46;
			star.period = 3000 + random() * 3000;
			star.phase = random() * STARS_TAU;
			star.accent = random() < STARS_ACCENT_RATIO;
		}
		starCount = nextCount;
	}

	function paint(now: number) {
		frameContext.clearRect(0, 0, width, height);
		for (let index = 0; index < starCount; index += 1) {
			const star = pool[index];
			const sprite = star.accent ? accentSprite : primarySprite;
			if (!sprite) continue;
			const wave =
				0.5 + 0.5 * Math.sin(star.phase + (now / star.period) * STARS_TAU);
			const size = star.radius * 5;
			frameContext.globalAlpha = star.alpha * (0.35 + 0.65 * wave);
			frameContext.drawImage(
				sprite,
				star.x - size / 2,
				star.y - size / 2,
				size,
				size,
			);
		}
		frameContext.globalAlpha = 1;
	}

	/** 静态星空：不跑循环，也不随时间变化。 */
	function paintStatic() {
		frameContext.clearRect(0, 0, width, height);
		for (let index = 0; index < starCount; index += 1) {
			const star = pool[index];
			const sprite = star.accent ? accentSprite : primarySprite;
			if (!sprite) continue;
			const size = star.radius * 5;
			frameContext.globalAlpha = star.alpha * STARS_STATIC_ALPHA;
			frameContext.drawImage(
				sprite,
				star.x - size / 2,
				star.y - size / 2,
				size,
				size,
			);
		}
		frameContext.globalAlpha = 1;
	}

	function schedule() {
		if (
			animationFrame ||
			destroyed ||
			!active ||
			document.hidden ||
			isStaticMode()
		)
			return;
		animationFrame = requestAnimationFrame(tick);
	}

	function stop() {
		if (animationFrame) {
			cancelAnimationFrame(animationFrame);
			animationFrame = 0;
		}
		frameContext.clearRect(0, 0, width, height);
	}

	function tick(now: number) {
		animationFrame = 0;
		if (destroyed || !active || document.hidden || isStaticMode()) return;
		if (!shouldRenderFrame(now, lastRender, tierFps())) {
			schedule();
			return;
		}
		lastRender = now;
		const started = performance.now();
		paint(now);
		sampleTotal += performance.now() - started;
		sampleCount += 1;
		if (sampleCount >= STARS_POWER_SAMPLE_SIZE) {
			const next = nextPerformanceTier(tier, sampleTotal / sampleCount);
			sampleCount = 0;
			sampleTotal = 0;
			if (next !== tier) {
				tier = next;
				rebuildStars();
				if (tier === "static") {
					paintStatic();
					return;
				}
			}
		}
		schedule();
	}

	function start() {
		if (destroyed || !active || document.hidden) return;
		if (isStaticMode()) {
			paintStatic();
			return;
		}
		if (animationFrame) return;
		lastRender = 0;
		animationFrame = requestAnimationFrame(tick);
	}

	function resize() {
		const bounds = hero.getBoundingClientRect();
		const nextWidth = Math.max(1, Math.round(bounds.width));
		const nextHeight = Math.max(1, Math.round(bounds.height));
		if (nextWidth === width && nextHeight === height) return;
		width = nextWidth;
		height = nextHeight;
		// 像素倍率固定为 1，避免高分屏按 devicePixelRatio 放大画布。
		starsCanvas.width = width;
		starsCanvas.height = height;
		frameContext.setTransform(1, 0, 0, 1, 0, 0);
		refreshSprites();
		rebuildStars();
		if (isStaticMode()) {
			if (active) paintStatic();
			return;
		}
		if (active && !document.hidden) {
			lastRender = 0;
			schedule();
		}
	}

	const resizeObserver = new ResizeObserver(() => resize());
	const themeObserver = new MutationObserver(() => {
		if (!refreshSprites()) return;
		if (isStaticMode()) {
			if (active) paintStatic();
			return;
		}
		if (active && !document.hidden) start();
	});

	document.addEventListener(
		"visibilitychange",
		() => {
			if (document.hidden) stop();
			else start();
		},
		{ signal: abortController.signal },
	);
	reducedMotionQuery.addEventListener(
		"change",
		() => {
			reducedMotion = reducedMotionQuery.matches;
			stop();
			start();
		},
		{ signal: abortController.signal },
	);

	resize();
	resizeObserver.observe(hero);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "class"],
	});

	const controller: HomeHeroStarsController = {
		setActive(nextActive: boolean) {
			if (destroyed) return;
			active = nextActive;
			starsCanvas.classList.toggle("is-active", active);
			if (active) start();
			else stop();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			active = false;
			stop();
			resizeObserver.disconnect();
			themeObserver.disconnect();
			abortController.abort();
			starCount = 0;
			starsCanvas.classList.remove("is-active");
			if (controllers.get(hero) === controller) controllers.delete(hero);
		},
	};

	controllers.set(hero, controller);
	return controller;
}
