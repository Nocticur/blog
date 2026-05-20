/**
 * PixelTransition - 像素入侵风格页面过渡动画
 * 参照 Figma Pixel Invasion Visual Effect 设计
 *
 * 动画流程：入侵(1s) → 加载遮罩(随页面加载) → 退场揭示
 *
 * 使用 GSAP 驱动，与 Swup 页面切换生命周期集成
 */

import gsap from "gsap";

type Phase = "idle" | "invasion" | "loading" | "reveal" | "done";

interface Block {
	id: number;
	el: HTMLDivElement;
	w: number;
	h: number;
	left: number;
	top: number;
	color: string;
	startX: number;
	startY: number;
	dist: number;
}

const BLOCK_COUNT = 30;
const REVEAL_DURATION = 0.8;
const LOADING_TEXT_CHARS = ["<", "(", "º", "O", "º", ")", ">"];

let overlay: HTMLDivElement | null = null;
let blocks: Block[] = [];
let currentPhase: Phase = "idle";
let maskEl: HTMLDivElement | null = null;
let activeTimeline: gsap.core.Timeline | null = null;
let invasionResolve: (() => void) | null = null;

/**
 * 检测当前主题
 */
function detectTheme(): boolean {
	return document.documentElement.classList.contains("dark");
}

/**
 * 获取主题相关的颜色
 */
function getThemeColors() {
	const isDark = detectTheme();
	return {
		isDark,
		blockColors: isDark
			? ["#e2e8f0", "#262626"]
			: ["#000000", "#FFFFFF"],
		maskBg: isDark ? "#262626" : "#ffffff",
		textColor: isDark ? "#ffffff" : "#000000",
		shadow: isDark
			? "0 4px 30px rgba(0,0,0,0.4)"
			: "0 4px 30px rgba(0,0,0,0.15)",
	};
}

/**
 * 生成像素方块数据
 */
function generateBlocks(): Block[] {
	const colors = getThemeColors();
	const arr: Block[] = [];

	for (let i = 0; i < BLOCK_COUNT; i++) {
		const w = 5 + Math.random() * 23;
		const h = 3 + Math.random() * 19;
		const left = Math.random() * (100 - w);
		const top = Math.random() * (100 - h);
		const color = colors.blockColors[Math.random() > 0.5 ? 0 : 1];

		const cx = left + w / 2;
		const cy = top + h / 2;
		const dist = Math.sqrt((cx - 50) ** 2 + (cy - 50) ** 2);

		const dLeft = cx;
		const dRight = 100 - cx;
		const dTop = cy;
		const dBottom = 100 - cy;
		const min = Math.min(dLeft, dRight, dTop, dBottom);

		let startX = 0;
		let startY = 0;
		if (min === dLeft) startX = -100;
		else if (min === dRight) startX = 100;
		else if (min === dTop) startY = -100;
		else if (min === dBottom) startY = 100;

		arr.push({ id: i, el: null!, w, h, left, top, color, startX, startY, dist });
	}

	return arr.sort((a, b) => b.dist - a.dist);
}

/**
 * 杀死所有活跃的 GSAP 动画
 */
function killActiveAnimations() {
	if (activeTimeline) {
		activeTimeline.kill();
		activeTimeline = null;
	}
	if (overlay) {
		gsap.killTweensOf(overlay);
	}
	if (maskEl) {
		gsap.killTweensOf(maskEl);
	}
	for (const b of blocks) {
		gsap.killTweensOf(b.el);
	}
}

/**
 * 创建覆盖层 DOM 结构
 */
function createOverlay(): HTMLDivElement {
	// 如果已有覆盖层，先清理
	if (overlay) {
		killActiveAnimations();
		overlay.remove();
	}

	const colors = getThemeColors();
	const container = document.createElement("div");
	container.id = "pixel-transition-overlay";
	container.setAttribute("aria-hidden", "true");
	container.style.cssText = `
		position: fixed;
		inset: 0;
		z-index: 999999;
		pointer-events: none;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
	`;

	// 创建像素方块
	const newBlocks = generateBlocks();
	blocks = newBlocks.map((b) => {
		const el = document.createElement("div");
		el.style.cssText = `
			position: absolute;
			left: ${b.left}vw;
			top: ${b.top}vh;
			width: ${b.w}vw;
			height: ${b.h}vh;
			background-color: ${b.color};
			box-shadow: ${colors.shadow};
			will-change: transform, opacity;
		`;
		gsap.set(el, {
			x: `${b.startX}vw`,
			y: `${b.startY}vh`,
			opacity: 0,
			scale: 0.5,
		});
		container.appendChild(el);
		b.el = el;
		return b;
	});

	// 创建白色/深色遮罩层
	const mask = document.createElement("div");
	mask.className = "pixel-mask";
	mask.style.cssText = `
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
		opacity: 0;
		background-color: ${colors.maskBg};
	`;

	// 加载文字容器
	const textContainer = document.createElement("div");
	textContainer.className = "pixel-loading-text";
	textContainer.style.cssText = `
		display: flex;
		align-items: center;
		gap: 0.125rem;
		font-size: clamp(2.5rem, 8vw, 6rem);
		font-weight: 900;
		letter-spacing: 0.1em;
		padding: 2.5rem 1rem;
		perspective: 800px;
		user-select: none;
		color: ${colors.textColor};
	`;

	LOADING_TEXT_CHARS.forEach((char, i) => {
		const span = document.createElement("span");
		span.textContent = char;
		span.style.cssText = `
			display: inline-block;
			will-change: transform, opacity;
		`;
		gsap.set(span, {
			y: "150%",
			scale: 0.2,
			opacity: 0,
			rotateX: 80,
			rotateZ: i % 2 === 0 ? -15 : 15,
		});
		textContainer.appendChild(span);
	});

	mask.appendChild(textContainer);
	container.appendChild(mask);
	maskEl = mask;

	// 确保插入到 body 最末尾，保证层叠顺序最高
	document.body.appendChild(container);
	// 强制将 overlay 移到 body 最末尾（防止其他动态插入的元素覆盖）
	if (container !== document.body.lastElementChild) {
		document.body.appendChild(container);
	}
	overlay = container;

	return container;
}

/**
 * 阶段1: 入侵动画 - 像素方块从屏幕边缘飞入 (~1s)
 */
function animateInvasion(): Promise<void> {
	return new Promise((resolve) => {
		if (!overlay) { resolve(); return; }

		currentPhase = "invasion";
		invasionResolve = resolve;

		// 覆盖层整体淡入
		gsap.set(overlay, { opacity: 1 });

		const tl = gsap.timeline({
			onComplete: () => {
				activeTimeline = null;
				invasionResolve = null;
				resolve();
			},
		});
		activeTimeline = tl;

		// 像素方块逐个飞入，stagger 间隔
		blocks.forEach((b, i) => {
			tl.to(
				b.el,
				{
					x: "0vw",
					y: "0vh",
					opacity: 1,
					scale: 1,
					duration: 0.4,
					ease: "expo.out",
				},
				i * 0.015,
			);
		});

		// 在入侵动画末尾提前启动遮罩淡入，消除停滞感
		if (maskEl) {
			tl.to(
				maskEl,
				{
					opacity: 1,
					duration: 0.3,
					ease: "power2.in",
				},
				"-=0.25",
			);
		}
	});
}

/**
 * 阶段2: 加载遮罩 - 显示遮罩 + 弹跳文字
 * 此函数不返回 Promise，loading 阶段由外部调用 triggerReveal 结束
 */
function animateLoading(): void {
	currentPhase = "loading";
	if (!maskEl) return;

	const tl = gsap.timeline();
	activeTimeline = tl;

	// 遮罩确保完全显示（入侵末尾已提前启动淡入，此处补齐到 opacity:1）
	tl.to(maskEl, {
		opacity: 1,
		duration: 0.2,
		ease: "power2.out",
	});

	// 文字逐个弹入
	const spans = maskEl.querySelectorAll("span");
	spans.forEach((span, i) => {
		tl.to(
			span,
			{
				y: "0%",
				scale: 1,
				opacity: 1,
				rotateX: 0,
				rotateZ: 0,
				duration: 0.5,
				ease: "back.out(1.7)",
			},
			`>-0.35`,
		);
	});

	// 文字弹入后添加微妙的呼吸/晃动效果
	tl.add(() => {
		if (!maskEl || currentPhase !== "loading") return;
		const spans = maskEl.querySelectorAll("span");
		spans.forEach((span, i) => {
			gsap.to(span, {
				yoyo: true,
				repeat: -1,
				y: `+=${i % 2 === 0 ? 3 : -3}`,
				duration: 0.6 + i * 0.05,
				ease: "sine.inOut",
			});
		});
	});
}

/**
 * 阶段3: 揭示动画 - 像素方块退场，新内容展示
 */
function animateReveal(): Promise<void> {
	return new Promise((resolve) => {
		currentPhase = "reveal";

		if (!overlay || !maskEl) {
			cleanup();
			resolve();
			return;
		}

		// 停止 loading 阶段的呼吸动画
		const spans = maskEl.querySelectorAll("span");
		spans.forEach((span) => gsap.killTweensOf(span));

		const tl = gsap.timeline({
			onComplete: () => {
				activeTimeline = null;
				currentPhase = "done";
				cleanup();
				resolve();
			},
		});
		activeTimeline = tl;

		// 遮罩退出：模糊 + 放大 + 淡出
		tl.to(maskEl, {
			opacity: 0,
			scale: 1.05,
			filter: "blur(10px)",
			duration: 0.4,
			ease: "power2.in",
		});

		// 像素方块退场：反向飞出（离中心近的先退）
		blocks.forEach((b, i) => {
			tl.to(
				b.el,
				{
					x: `${b.startX * 0.6}vw`,
					y: `${b.startY * 0.6}vh`,
					opacity: 0,
					scale: 0.2,
					duration: REVEAL_DURATION,
					ease: "power3.in",
				},
				0.2 + (blocks.length - 1 - i) * 0.03,
			);
		});

		// 整体淡出
		tl.to(
			overlay,
			{
				opacity: 0,
				duration: 0.3,
				ease: "power2.out",
			},
			"-=0.4",
		);
	});
}

/**
 * 清理覆盖层
 */
function cleanup() {
	killActiveAnimations();
	if (overlay) {
		overlay.remove();
		overlay = null;
	}
	blocks = [];
	maskEl = null;
	currentPhase = "idle";
	invasionResolve = null;
}

/**
 * 启动入侵动画（点击链接时调用）
 */
export async function startInvasion(): Promise<void> {
	// 如果正在动画中，强制清理重新开始
	if (currentPhase !== "idle") {
		killActiveAnimations();
		if (overlay) overlay.remove();
		overlay = null;
		blocks = [];
		maskEl = null;
		currentPhase = "idle";
	}

	createOverlay();
	await animateInvasion();
	animateLoading();
}

/**
 * 触发揭示动画（页面内容替换后调用）
 */
export async function triggerReveal(): Promise<void> {
	if (currentPhase === "idle" || currentPhase === "done") return;

	// 如果还在入侵阶段，等待完成
	if (currentPhase === "invasion") {
		await new Promise<void>((resolve) => {
			const check = () => {
				if (currentPhase !== "invasion") {
					resolve();
				} else {
					requestAnimationFrame(check);
				}
			};
			check();
		});
	}

	await animateReveal();
}

/**
 * 取消动画（异常/快速导航等情况）
 */
export function cancelTransition() {
	killActiveAnimations();
	cleanup();
}
