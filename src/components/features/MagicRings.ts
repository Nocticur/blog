import {
	Color,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	WebGLRenderer,
} from "three";

const vertexShader = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
uniform float uFadeIn, uFadeOut;
uniform float uMouseInfluence, uHoverAmount, uHoverScale, uParallax, uBurst;
uniform float uLightMode;
uniform vec2 uResolution, uMouse;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  float cr = cos(uRotation), sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;
  p -= uMouse * uMouseInfluence;
  float sc = mix(1.0, uHoverScale, uHoverAmount) + uBurst * 0.3;
  p /= sc;
  vec3 c = vec3(0.0);
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec2 pr = p - fi * uParallax * uMouse;
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    c = mix(c, rc, vec3(ring(pr, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
  }
  c *= 1.0 + uBurst * 2.0;
  float sig = max(c.r, max(c.g, c.b));
  if (sig > 0.001) {
    float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * uNoiseAmount;
  }
  float g = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
  vec3 bg = mix(vec3(0.0), vec3(1.0), uLightMode);
  c = mix(bg, c, g);
  gl_FragColor = vec4(c, g * uOpacity);
}
`;

export interface MagicRingsOptions {
	color?: string;
	colorTwo?: string;
	speed?: number;
	ringCount?: number;
	attenuation?: number;
	lineThickness?: number;
	baseRadius?: number;
	radiusStep?: number;
	scaleRate?: number;
	opacity?: number;
	blur?: number;
	noiseAmount?: number;
	rotation?: number;
	ringGap?: number;
	fadeIn?: number;
	fadeOut?: number;
	followMouse?: boolean;
	mouseInfluence?: number;
	hoverScale?: number;
	parallax?: number;
	clickBurst?: boolean;
}

interface MagicRingsInstance {
	destroy: () => void;
	updateOptions: (opts: Partial<MagicRingsOptions>) => void;
}

export function initMagicRings(
	container: HTMLElement,
	options: MagicRingsOptions = {},
): MagicRingsInstance | null {
	const opts: Required<MagicRingsOptions> = {
		color: "#A855F7",
		colorTwo: "#6366F1",
		speed: 1,
		ringCount: 6,
		attenuation: 10,
		lineThickness: 2,
		baseRadius: 0.35,
		radiusStep: 0.1,
		scaleRate: 0.1,
		opacity: 1,
		blur: 0,
		noiseAmount: 0.1,
		rotation: 0,
		ringGap: 1.5,
		fadeIn: 0.7,
		fadeOut: 0.5,
		followMouse: false,
		mouseInfluence: 0.2,
		hoverScale: 1.2,
		parallax: 0.05,
		clickBurst: false,
		...options,
	};

	const mouseRef = [0, 0];
	const smoothMouseRef = [0, 0];
	let hoverAmount = 0;
	let isHovered = false;
	let burst = 0;

	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ alpha: true });
	} catch {
		return null;
	}

	if (!renderer.capabilities.isWebGL2) {
		renderer.dispose();
		return null;
	}

	renderer.setClearColor(0x000000, 0);
	container.appendChild(renderer.domElement);

	if (opts.blur > 0) {
		container.style.filter = `blur(${opts.blur}px)`;
	}

	const scene = new Scene();
	const camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
	camera.position.z = 1;

	const uniforms = {
		uTime: { value: 0 },
		uAttenuation: { value: opts.attenuation },
		uResolution: { value: new Vector2() },
		uColor: { value: new Color(opts.color) },
		uColorTwo: { value: new Color(opts.colorTwo) },
		uLineThickness: { value: opts.lineThickness },
		uBaseRadius: { value: opts.baseRadius },
		uRadiusStep: { value: opts.radiusStep },
		uScaleRate: { value: opts.scaleRate },
		uRingCount: { value: opts.ringCount },
		uOpacity: { value: opts.opacity },
		uNoiseAmount: { value: opts.noiseAmount },
		uRotation: { value: opts.rotation },
		uRingGap: { value: opts.ringGap },
		uFadeIn: { value: opts.fadeIn },
		uFadeOut: { value: opts.fadeOut },
		uMouse: { value: new Vector2() },
		uMouseInfluence: { value: 0 },
		uHoverAmount: { value: 0 },
		uHoverScale: { value: opts.hoverScale },
		uParallax: { value: opts.parallax },
		uBurst: { value: 0 },
		uLightMode: {
			value: document.documentElement.classList.contains("dark") ? 0 : 1,
		},
	};

	const material = new ShaderMaterial({
		vertexShader,
		fragmentShader,
		uniforms,
		transparent: true,
	});
	const quad = new Mesh(new PlaneGeometry(1, 1), material);
	scene.add(quad);

	const resize = () => {
		const w = container.clientWidth;
		const h = container.clientHeight;
		const dpr = Math.min(window.devicePixelRatio, 2);
		renderer.setSize(w, h);
		renderer.setPixelRatio(dpr);
		uniforms.uResolution.value.set(w * dpr, h * dpr);
	};
	resize();

	window.addEventListener("resize", resize);
	const ro = new ResizeObserver(resize);
	ro.observe(container);

	const onMouseMove = (e: MouseEvent) => {
		const rect = container.getBoundingClientRect();
		mouseRef[0] = (e.clientX - rect.left) / rect.width - 0.5;
		mouseRef[1] = -((e.clientY - rect.top) / rect.height - 0.5);
	};
	const onMouseEnter = () => {
		isHovered = true;
	};
	const onMouseLeave = () => {
		isHovered = false;
		mouseRef[0] = 0;
		mouseRef[1] = 0;
	};
	const onClick = () => {
		burst = 1;
	};

	container.addEventListener("mousemove", onMouseMove);
	container.addEventListener("mouseenter", onMouseEnter);
	container.addEventListener("mouseleave", onMouseLeave);
	container.addEventListener("click", onClick);

	const themeObserver = new MutationObserver(() => {
		uniforms.uLightMode.value = document.documentElement.classList.contains(
			"dark",
		)
			? 0
			: 1;
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});

	// ── Render loop: IO visibility gating + 30fps cap ──
	const FRAME_INTERVAL = 1000 / 30;
	let frameId = 0;
	let loopRunning = false;
	let lastTimestamp = 0;
	let accumulatedTime = 0;

	const animate = (t: number) => {
		frameId = requestAnimationFrame(animate);

		// Skip frames beyond the 30fps target
		const delta = t - lastTimestamp;
		if (delta < FRAME_INTERVAL) return;
		lastTimestamp = t - (delta % FRAME_INTERVAL);

		// Accumulate elapsed time so pausing via IO doesn't cause a time jump
		accumulatedTime += delta * 0.001;

		smoothMouseRef[0] += (mouseRef[0] - smoothMouseRef[0]) * 0.08;
		smoothMouseRef[1] += (mouseRef[1] - smoothMouseRef[1]) * 0.08;
		hoverAmount += ((isHovered ? 1 : 0) - hoverAmount) * 0.08;
		burst *= 0.95;
		if (burst < 0.001) burst = 0;

		uniforms.uTime.value = accumulatedTime * opts.speed;
		uniforms.uAttenuation.value = opts.attenuation;
		uniforms.uColor.value.set(opts.color);
		uniforms.uColorTwo.value.set(opts.colorTwo);
		uniforms.uLineThickness.value = opts.lineThickness;
		uniforms.uBaseRadius.value = opts.baseRadius;
		uniforms.uRadiusStep.value = opts.radiusStep;
		uniforms.uScaleRate.value = opts.scaleRate;
		uniforms.uRingCount.value = opts.ringCount;
		uniforms.uOpacity.value = opts.opacity;
		uniforms.uNoiseAmount.value = opts.noiseAmount;
		uniforms.uRotation.value = (opts.rotation * Math.PI) / 180;
		uniforms.uRingGap.value = opts.ringGap;
		uniforms.uFadeIn.value = opts.fadeIn;
		uniforms.uFadeOut.value = opts.fadeOut;
		uniforms.uMouse.value.set(smoothMouseRef[0], smoothMouseRef[1]);
		uniforms.uMouseInfluence.value = opts.followMouse ? opts.mouseInfluence : 0;
		uniforms.uHoverAmount.value = hoverAmount;
		uniforms.uHoverScale.value = opts.hoverScale;
		uniforms.uParallax.value = opts.parallax;
		uniforms.uBurst.value = opts.clickBurst ? burst : 0;

		renderer.render(scene, camera);
	};

	function startLoop() {
		if (loopRunning) return;
		loopRunning = true;
		lastTimestamp = performance.now();
		frameId = requestAnimationFrame(animate);
	}

	function stopLoop() {
		loopRunning = false;
		if (frameId) {
			cancelAnimationFrame(frameId);
			frameId = 0;
		}
	}

	// Pause rendering when the container scrolls out of the viewport
	const io = new IntersectionObserver(
		(entries) => {
			if (entries[0]?.isIntersecting) startLoop();
			else stopLoop();
		},
		{ threshold: 0 },
	);
	io.observe(container);

	return {
		destroy() {
			stopLoop();
			io.disconnect();
			themeObserver.disconnect();
			window.removeEventListener("resize", resize);
			ro.disconnect();
			container.removeEventListener("mousemove", onMouseMove);
			container.removeEventListener("mouseenter", onMouseEnter);
			container.removeEventListener("mouseleave", onMouseLeave);
			container.removeEventListener("click", onClick);
			container.removeChild(renderer.domElement);
			renderer.dispose();
			material.dispose();
		},
		updateOptions(partial) {
			Object.assign(opts, partial);
			if (partial.color !== undefined) uniforms.uColor.value.set(opts.color);
			if (partial.colorTwo !== undefined)
				uniforms.uColorTwo.value.set(opts.colorTwo);
			if (partial.blur !== undefined)
				container.style.filter = opts.blur > 0 ? `blur(${opts.blur}px)` : "";
		},
	};
}
