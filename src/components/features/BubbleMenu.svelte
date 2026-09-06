<script lang="ts">
import { gsap } from "gsap";
import Icon from "@/components/common/Icon.svelte";
import { portal } from "@/components/common/portal";

interface LinkItem {
	name: string;
	icon: string;
	url: string;
	showName?: boolean;
}

interface Props {
	links: LinkItem[];
	class?: string;
}

let { links, class: className = "" }: Props = $props();

let isMenuOpen = $state(false);
let showOverlay = $state(false);

let overlayRef: HTMLDivElement | undefined = $state();
let bubblesRef = $state<HTMLAnchorElement[]>([]);
let labelRefs = $state<HTMLSpanElement[]>([]);

// 自定义参数 - 参考图片设置
const animationEase = "elastic.out(1,0.5)";
const animationDuration = 0.8;
const staggerDelay = 0.15;
const menuBg = "#111111";
const menuContentColor = "#ffffff";

function handleToggle() {
	if (isMenuOpen) {
		isMenuOpen = false;
		showOverlay = false;
	} else {
		showOverlay = true;
		isMenuOpen = true;
	}
}

function closeMenu() {
	isMenuOpen = false;
	showOverlay = false;
}

function handleBackdropClick(e: MouseEvent) {
	if (e.target === e.currentTarget) {
		closeMenu();
	}
}

$effect(() => {
	if (!isMenuOpen) return;

	const overlay = overlayRef;
	const bubbles = bubblesRef.filter(Boolean);
	const labels = labelRefs.filter(Boolean);

	if (!overlay || !bubbles.length) return;

	gsap.killTweensOf([...bubbles, ...labels]);
	gsap.set(bubbles, { scale: 0, transformOrigin: "50% 50%" });
	gsap.set(labels, { y: 24, autoAlpha: 0 });

	bubbles.forEach((bubble, i) => {
		const delay = i * staggerDelay + gsap.utils.random(-0.05, 0.05);
		const tl = gsap.timeline({ delay });

		tl.to(bubble, {
			scale: 1,
			duration: animationDuration,
			ease: animationEase,
		});
		if (labels[i]) {
			tl.to(
				labels[i],
				{
					y: 0,
					autoAlpha: 1,
					duration: animationDuration,
					ease: "power3.out",
				},
				`-=${animationDuration * 0.9}`,
			);
		}
	});
});

let isDark = $state(false);

$effect(() => {
	if (typeof document === "undefined") return;
	isDark = document.documentElement.classList.contains("dark");
	const observer = new MutationObserver(() => {
		isDark = document.documentElement.classList.contains("dark");
	});
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	return () => observer.disconnect();
});

function getHoverBg(item: LinkItem) {
	const colorMap: Record<string, string> = {
		qq: "#4a90d9",
		B站: "#00a1d6",
		GitHub: "#6e7681",
		Email: "#e74c3c",
		RSS: "#f39c12",
	};
	return colorMap[item.name] || "#f3f4f6";
}
</script>

<div class={`bubble-menu-wrapper ${className}`.trim()}>
  <nav class="bubble-menu" aria-label="Social navigation">
    <button
      type="button"
      class={`bubble toggle-bubble menu-btn ${isMenuOpen ? "open" : ""}`}
      onclick={handleToggle}
      aria-label="Toggle social menu"
      aria-pressed={isMenuOpen}
      style=""
    >
      <span class="menu-line"></span>
      <span class="menu-line short"></span>
    </button>
  </nav>

  {#if showOverlay}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      use:portal
      class="bubble-menu-backdrop"
      onclick={handleBackdropClick}
      style="position:fixed;inset:0;z-index:998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.2);backdrop-filter:blur(2px);"
    >
      <div
        bind:this={overlayRef}
        class="bubble-menu-items"
        aria-hidden={!isMenuOpen}
      >
        <ul class="pill-list" role="menu" aria-label="Social links">
          {#each links as item, idx (item.name)}
            <li role="none" class="pill-col">
              <a
                role="menuitem"
                href={item.url}
                target={item.url.startsWith("mailto:") ? undefined : "_blank"}
                aria-label={item.name}
                class="pill-link"
                style={`
                  --item-rot: ${(idx % 2 === 0 ? -8 : 8) + (Math.random() * 4 - 2)}deg;
                  --pill-bg: ${isDark ? "#ffffff" : menuBg};
                  --pill-color: ${isDark ? "#111111" : menuContentColor};
                  --hover-bg: ${getHoverBg(item)};
                  --hover-color: ${isDark ? "#111111" : "#ffffff"};
                `}
                bind:this={bubblesRef[idx]}
              >
                <span bind:this={labelRefs[idx]} class="pill-label">
                  <Icon icon={item.icon} />
                  <span class="pill-name">{item.name}</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</div>

