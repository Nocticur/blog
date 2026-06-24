<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { AudioAnalyzer } from "./AudioAnalyzer";
import LyricsOverlay from "./LyricsOverlay.svelte";
import ThreeScene from "./ThreeScene.svelte";
import VisualizerControls from "./VisualizerControls.svelte";

const audioAnalyzer = new AudioAnalyzer();
const isDark = true; // 固定使用深色主题
let sceneReady = $state(false);
let useLightBackground = $state(false);

function syncPageTheme() {
	useLightBackground = !document.documentElement.classList.contains("dark");
}

function connectAudio() {
	const audio = document.getElementById(
		"firefly-music-audio",
	) as HTMLAudioElement | null;
	if (!audio) {
		setTimeout(connectAudio, 200);
		return;
	}
	audio.crossOrigin = "anonymous";
	audioAnalyzer.connect(audio);

	if (audioCtxState() === "suspended") {
		audioAnalyzer.resume();
	}
}

function audioCtxState() {
	return audioAnalyzer.audioCtx?.state || "running";
}

onMount(() => {
	syncPageTheme();

	const themeObserver = new MutationObserver(syncPageTheme);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});

	const mgr = window.__fireflyMusic;
	if (!mgr) {
		const waitForMgr = () => {
			if (window.__fireflyMusic) {
				connectAudio();
			} else {
				setTimeout(waitForMgr, 100);
			}
		};
		waitForMgr();
	} else {
		if (!mgr.getState().initialized) {
			mgr.init();
		}
		connectAudio();
	}

	const handleFirstClick = () => {
		audioAnalyzer.resume();
		document.removeEventListener("click", handleFirstClick);
	};
	document.addEventListener("click", handleFirstClick);

	return () => {
		themeObserver.disconnect();
		document.removeEventListener("click", handleFirstClick);
	};
});

onDestroy(() => {
	audioAnalyzer.disconnect();
});
</script>

<div class="music-visualizer" class:music-visualizer--dark={isDark}>
	{#if sceneReady}
		<VisualizerControls />
		<LyricsOverlay />
	{/if}
	<ThreeScene
		{audioAnalyzer}
		{isDark}
		{useLightBackground}
		onSceneReady={() => (sceneReady = true)}
	/>
</div>
