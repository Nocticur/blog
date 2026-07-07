# 百叶窗最终图三层化设计

> 将百叶窗动画的最终图从单张 `utl.webp` 升级为「后景视频 + 中景图 + 前景人物图 + 文字层」四层组合，按序渐入。

---

## 一、背景

当前 `HomeDisplayLayer.astro` 的百叶窗 merge 阶段，最终图是单张 `<img data-shutter-final-image>`（z-index: 5），动画为「黑色遮罩上扩 → 最终图渐入 → 最终文字渐入」。

需求：最终图替换为三层组合（背景视频 / 中景图 / 前景人物图），按「中景 → 后景+前景同时 → 文字」的顺序渐入，所有资源放 config 配置。

## 二、约束

- **不影响前置滑动动效**：三层新元素初始 `autoAlpha: 0`，只在 merge 阶段显现，z-index 在 mask(4) 之上，不干扰 panels(2)/interlude(3)/mask(4)。
- **遵循 CLAUDE.md**：无 `<style>` 块，样式在 `src/styles/`；颜色用 `var(--xxx)`；导航用 `navigateToPage`；初始化用 `astro:page-load`。
- **图片透明度**：中景图与前景图的透明区域由素材本身处理，代码不干预。
- **跨浏览器一致性**：前景图居中用 `xPercent: -50`（GSAP），不用 `translate + scale` 组合，避免 Chrome 偏移。

## 三、Z 层层级（从后到前）

| 层 | 元素 | z-index | 说明 |
|---|---|---|---|
| 后景 | `<video data-shutter-final-video>` | 5 | `utl-back2.webm`，静音循环，渐入时播放 |
| 中景 | `<img data-shutter-final-midground>` | 6 | `utl-back1.png`，首层渐入（代替原 utl.webp） |
| 前景 | `<img data-shutter-final-foreground>` | 7 | `utl-1.webp`，人物图，不裁剪，垂直底部水平居中 |
| 文字 | `<div data-shutter-final-copy>` | 8 | 原文字层不变，z-index 6 → 8 |

mask z-index 4 不变；panels 2、interlude 3 不变。

## 四、配置结构

### 4.1 类型（`src/types/config.ts`）

`HomePortfolioShutterConfig.finalImage` 从 `{ src, alt }` 改为：

```ts
finalImage: {
  /** 中景图（首层渐入，代替原 utl.webp） */
  midgroundImage: string;
  /** 后景视频（中景完全显现后渐入，最底层，静音循环） */
  backgroundVideo: string;
  /** 前景人物图（与后景同时渐入，最前层，不裁剪） */
  foregroundImage: string;
  alt: string;
};
```

### 4.2 配置（`src/config/homeConfig.ts`）

```ts
portfolioShutter: {
  // ...
  finalImage: {
    midgroundImage: "/assets/images/home-truncated/utl-back1.png",
    backgroundVideo: "/assets/images/home-truncated/utl-back2.webm",
    foregroundImage: "/assets/images/home-truncated/utl-1.webp",
    alt: "2026年 加油！",
  },
  // ...
}
```

原 `utl.webp` 从配置移除（文件保留）。

## 五、DOM 结构（`HomeDisplayLayer.astro`）

原 `<img data-shutter-final-image>` 替换为三个元素：

```astro
{/* 后景视频 — 最底层，静音循环，渐入时播放 */}
<video
  class="home-portfolio-shutter__final-video"
  data-shutter-final-video
  data-src={shutterConfig.finalImage.backgroundVideo}
  muted
  loop
  playsinline
  preload="none"
  aria-hidden="true"
></video>

{/* 中景图 — 中间层，首层渐入 */}
<img
  class="home-portfolio-shutter__final-image home-portfolio-shutter__final-image--midground"
  data-shutter-final-midground
  data-src={shutterConfig.finalImage.midgroundImage}
  src={transparentPixel}
  alt={shutterConfig.finalImage.alt}
  loading="eager"
  decoding="async"
/>

{/* 前景人物图 — 最前层，与后景同时渐入 */}
<img
  class="home-portfolio-shutter__final-image home-portfolio-shutter__final-image--foreground"
  data-shutter-final-foreground
  data-src={shutterConfig.finalImage.foregroundImage}
  src={transparentPixel}
  alt=""
  loading="eager"
  decoding="async"
/>
```

DOM 顺序：video → midground → foreground（与 z-index 顺序一致）。

## 六、CSS（`src/styles/components/home-portfolio-shutter.css`）

```css
/* 三层共用基础 */
.home-portfolio-shutter__final-video,
.home-portfolio-shutter__final-image {
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform, opacity;
  opacity: 0;
  visibility: hidden;
}

/* 后景视频：填满屏幕，cover 适配 */
.home-portfolio-shutter__final-video {
  position: absolute;
  inset: 0;
  z-index: 5;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

/* 中景图：填满屏幕，cover 适配 */
.home-portfolio-shutter__final-image--midground {
  position: absolute;
  inset: 0;
  z-index: 6;
  width: 100%;
  height: 100%;
  min-height: 100%;
  object-fit: cover;
  object-position: center;
}

/* 前景人物图：不裁剪，垂直底部 + 水平居中，尺寸收小 */
.home-portfolio-shutter__final-image--foreground {
  position: absolute;
  top: auto;
  right: auto;
  bottom: 0;
  left: 50%;
  z-index: 7;
  width: auto;
  max-width: 100%;
  height: clamp(40vh, 55vh, 70vh);
  object-fit: contain;
  object-position: center bottom;
  transform: translateX(-50%);
}

/* 文字层 z-index 6 → 8 */
.home-portfolio-shutter__final-copy {
  z-index: 8;
}
```

**要点**：
- 视频/中景：`cover` 填满，随视口自适应
- 前景人物：`contain` 不裁剪，`bottom:0 + left:50% + translateX(-50%)` 垂直底部水平居中，`height: clamp(40vh, 55vh, 70vh)` 收小
- 前景 `transform: translateX(-50%)` 居中 —— GSAP 动画接管 transform 时需用 `xPercent: -50` 保持居中

## 七、动画时序（`HomeDisplayLayer.astro` `<script>`）

### 7.1 初始状态

```js
gsap.set(midgroundImage, { autoAlpha: 0, yPercent: -35, scale: 1.06 });
gsap.set(backgroundVideo, { autoAlpha: 0 });
gsap.set(foregroundImage, { autoAlpha: 0, xPercent: -50, scale: 1.02 });
```

### 7.2 Merge 阶段时序

```js
timeline.addLabel("merge", `shutter-interlude+=${INTERLUDE_TOTAL}`);

// 黑色遮罩上扩（不变）
timeline.to(mask, { scaleY: 1, duration: 0.9, ease: "power3.inOut" }, "merge");

// 1. 中景图渐入（代替原 finalImage）
timeline.to(midgroundImage, {
  autoAlpha: 1, yPercent: 0, scale: 1,
  duration: MERGE_FINAL_IMAGE_DURATION,  // 1.2
  ease: "power3.inOut",
}, `merge+=${MERGE_FINAL_IMAGE_OFFSET}`);  // merge+=0.02

// 中景完全显现时刻 = 0.02 + 1.2 = 1.22
const MIDGROUND_REVEAL_END = MERGE_FINAL_IMAGE_OFFSET + MERGE_FINAL_IMAGE_DURATION;
const FG_BG_DURATION = 0.8;

// 2. 后景视频 + 前景图同时渐入
timeline.to(backgroundVideo, {
  autoAlpha: 1,
  duration: FG_BG_DURATION,
  ease: "power2.inOut",
  onStart: () => backgroundVideo.play().catch(() => {}),
}, `merge+=${MIDGROUND_REVEAL_END}`);

timeline.to(foregroundImage, {
  autoAlpha: 1, scale: 1,
  duration: FG_BG_DURATION,
  ease: "power2.inOut",
}, `merge+=${MIDGROUND_REVEAL_END}`);

// 3. 后景+前景完全显现后，文字渐入
const NEW_FINAL_COPY_AT = `merge+=${(MIDGROUND_REVEAL_END + FG_BG_DURATION + MERGE_FINAL_COPY_GAP).toFixed(2)}`;
timeline.to(finalCopy, {
  autoAlpha: 1, y: 0, duration: 0.46, ease: "power3.inOut",
}, NEW_FINAL_COPY_AT);
```

### 7.3 时序时间线（merge 阶段，单位秒）

```
merge  0.00 │ 遮罩上扩(0.9s)
       0.02 │ ├ 中景图渐入(1.2s) ─────────┤
       1.22 │                           │ ├ 后景视频渐入(0.8s) ─┐
       1.22 │                           │ ├ 前景图渐入(0.8s) ──┤ │
       2.02 │                           │                     │ ├ 文字渐入(0.46s)
       2.60 │                                                 │   └ 保持
```

## 八、懒加载与清理

### 8.1 `getLazyImages` — 选择器扩展

```js
function getLazyImages(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "img[data-shutter-image], img[data-shutter-final-midground], img[data-shutter-final-foreground], img[data-shutter-interlude-fg], img[data-shutter-interlude-strip-left], img[data-shutter-interlude-strip-right], video[data-shutter-final-video]",
    ),
  );
}
```

原 `img[data-shutter-final-image]` 选择器拆为 midground + foreground 两个。

### 8.2 `hydrateLazyImages` — 区分 video/image

```js
async function hydrateLazyImages(root: HTMLElement) {
  const elements = getLazyImages(root);
  const decodeQueue = elements.map(async (element) => {
    const src = element.dataset.src;
    if (!src) return;
    if (element instanceof HTMLVideoElement) {
      if (element.src !== src) element.src = src;
      return; // 视频无需 decode()
    }
    const image = element as HTMLImageElement;
    if (image.getAttribute("src") !== src) image.setAttribute("src", src);
    await image.decode?.().catch(() => undefined);
  });
  return withTimeout(Promise.allSettled(decodeQueue), IMAGE_DECODE_TIMEOUT)
    .catch(() => {
      console.warn("[home-display-layer] image decode timeout, proceeding with fallback");
      return Promise.allSettled([]);
    });
}
```

### 8.3 `resetLazyImages` — video 清理

```js
function resetLazyImages(root: HTMLElement) {
  getLazyImages(root).forEach((element) => {
    if (element instanceof HTMLVideoElement) {
      element.pause?.();
      element.removeAttribute("src");
      element.load?.();
      return;
    }
    element.setAttribute("src", TRANSPARENT_PIXEL);
  });
}
```

### 8.4 元素查询与 cleanup

元素查询替换：
```js
// 原：const finalImage = root.querySelector("[data-shutter-final-image]");
const finalVideo = root.querySelector<HTMLVideoElement>("[data-shutter-final-video]");
const finalMidground = root.querySelector<HTMLElement>("[data-shutter-final-midground]");
const finalForeground = root.querySelector<HTMLElement>("[data-shutter-final-foreground]");
```

存在性校验加入 `finalVideo && finalMidground && finalForeground`。

cleanup 的 `gsap.set([...], { clearProps: "all" })` 数组中：
- 移除 `finalImage`
- 加入 `finalVideo, finalMidground, finalForeground`
- video 额外 `pause()` 清理

## 九、涉及文件

| 文件 | 改动 |
|---|---|
| `src/types/config.ts` | `HomePortfolioShutterConfig.finalImage` 类型改三层结构 |
| `src/config/homeConfig.ts` | `portfolioShutter.finalImage` 配置更新 |
| `src/components/layout/HomeDisplayLayer.astro` | DOM 三元素 + script 动画/懒加载/cleanup |
| `src/styles/components/home-portfolio-shutter.css` | 三层样式 + z-index 调整 |

## 十、验收要点

- [ ] 中景图 `utl-back1.png` 在 merge 阶段首层渐入
- [ ] 中景完全显现后，后景视频与前景人物图同时渐入
- [ ] 视频静音、循环、渐入时开始播放
- [ ] 前景人物图不裁剪，垂直底部水平居中，尺寸收小
- [ ] 三层完全显现后，文字层渐入
- [ ] z-index 正确：视频 < 中景 < 前景 < 文字
- [ ] 前置滑动动效（panels / interlude / mask）不受影响
- [ ] 移动端 / reduced-motion 下整层隐藏（已有规则覆盖）
- [ ] Swup 切换后能正确清理与重新初始化
