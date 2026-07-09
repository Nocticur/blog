<script lang="ts">
import Icon from "@components/common/Icon.svelte";
import { onDestroy, onMount } from "svelte";

interface Track {
	name: string;
	artist: string;
	pic?: string;
}

interface MusicState {
	track: Track | null;
	playlist: Track[];
	currentIndex: number;
	isPlaying: boolean;
	volume: number;
	isMuted: boolean;
	playMode: number;
	currentTimeStr: string;
	durationStr: string;
	progress: number;
	initialized: boolean;
}

interface FireflyMusicManager {
	getState: () => MusicState;
	init: () => void;
	togglePlay: () => void;
	playNext: () => void;
	playPrev: () => void;
	cyclePlayMode: () => void;
	toggleMute: () => void;
	setVolume: (value: number) => void;
	seek: (percent: number) => void;
	playTrackByIndex: (index: number) => void;
}

declare global {
	interface Window {
		__fireflyMusic?: FireflyMusicManager;
	}
}

let currentTrack: Track | null = $state(null);
let playlist: Track[] = $state([]);
let currentIndex = $state(0);
let isPlaying = $state(false);
let volume = $state(0.6);
let isMuted = $state(false);
let playMode = $state(0);
let currentTimeStr = $state("0:00");
let durationStr = $state("0:00");
let progress = $state(0);
let initialized = $state(false);
let rightPanelMode = $state<"tools" | "playlist">("tools");
let playlistListEl: HTMLDivElement;
let progressTrackEl = $state<HTMLDivElement | null>(null);
let volumeTrackEl = $state<HTMLDivElement | null>(null);
let isDraggingProgress = $state(false);
let isDraggingVolume = $state(false);
let progressTrackHover = $state(false);
let volumeTrackHover = $state(false);

function getPercentFromPointer(track: HTMLElement, clientX: number) {
	const rect = track.getBoundingClientRect();
	return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function seekFromClientX(clientX: number) {
	if (!progressTrackEl) return;
	const percent = getPercentFromPointer(progressTrackEl, clientX);
	progress = percent * 100;
	window.__fireflyMusic?.seek(percent);
}

function setVolumeFromClientX(clientX: number) {
	if (!volumeTrackEl) return;
	const val = getPercentFromPointer(volumeTrackEl, clientX);
	volume = val;
	isMuted = false;
	window.__fireflyMusic?.setVolume(val);
}

function onProgressPointerDown(e: PointerEvent) {
	const track = e.currentTarget as HTMLDivElement;
	track.setPointerCapture(e.pointerId);
	isDraggingProgress = true;
	seekFromClientX(e.clientX);
}

function onProgressPointerMove(e: PointerEvent) {
	if (!isDraggingProgress) return;
	seekFromClientX(e.clientX);
}

function onProgressPointerUp(e: PointerEvent) {
	if (!isDraggingProgress) return;
	isDraggingProgress = false;
	if (e.currentTarget instanceof HTMLElement) {
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	}
}

function onVolumePointerDown(e: PointerEvent) {
	const track = e.currentTarget as HTMLDivElement;
	track.setPointerCapture(e.pointerId);
	isDraggingVolume = true;
	setVolumeFromClientX(e.clientX);
}

function onVolumePointerMove(e: PointerEvent) {
	if (!isDraggingVolume) return;
	setVolumeFromClientX(e.clientX);
}

function onVolumePointerUp(e: PointerEvent) {
	if (!isDraggingVolume) return;
	isDraggingVolume = false;
	if (e.currentTarget instanceof HTMLElement) {
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	}
}

function syncPlaylistScroll() {
	if (!playlistListEl || rightPanelMode !== "playlist") return;

	const activeItem = playlistListEl.querySelector<HTMLElement>(
		".music-visualizer__playlist-item--active",
	);
	activeItem?.scrollIntoView({
		block: "center",
		behavior: "smooth",
	});
}

function togglePlay() {
	const mgr = window.__fireflyMusic;
	if (mgr) mgr.togglePlay();
}

function playNext() {
	const mgr = window.__fireflyMusic;
	if (mgr) mgr.playNext();
}

function playPrev() {
	const mgr = window.__fireflyMusic;
	if (mgr) mgr.playPrev();
}

function cycleMode() {
	const mgr = window.__fireflyMusic;
	if (mgr) mgr.cyclePlayMode();
}

function toggleMute() {
	const mgr = window.__fireflyMusic;
	if (mgr) mgr.toggleMute();
}

function playTrack(index: number) {
	const mgr = window.__fireflyMusic;
	if (mgr) mgr.playTrackByIndex(index);
}

function togglePlaylist() {
	rightPanelMode = rightPanelMode === "playlist" ? "tools" : "playlist";
	if (rightPanelMode === "playlist") {
		setTimeout(syncPlaylistScroll, 0);
	}
}

function syncState() {
	const mgr = window.__fireflyMusic;
	if (!mgr) return;
	const state = mgr.getState();
	currentTrack = state.track;
	playlist = state.playlist || [];
	currentIndex = state.currentIndex || 0;
	isPlaying = state.isPlaying;
	volume = state.volume;
	isMuted = state.isMuted;
	playMode = state.playMode;
	currentTimeStr = state.currentTimeStr;
	durationStr = state.durationStr;
	progress = state.progress;
	initialized = state.initialized;
	setTimeout(syncPlaylistScroll, 0);
}

function onInit() {
	syncState();
}

function onTrack(e: CustomEvent) {
	currentTrack = e.detail.track;
	currentIndex = e.detail.index;
	progress = 0;
	currentTimeStr = "0:00";
	durationStr = "0:00";
	setTimeout(syncPlaylistScroll, 0);
}

function onPlayState(e: CustomEvent) {
	isPlaying = e.detail.isPlaying;
}

function onTime(e: CustomEvent) {
	if (isDraggingProgress) return;
	currentTimeStr = e.detail.currentTimeStr;
	durationStr = e.detail.durationStr;
	progress = e.detail.progress;
}

function onVolume(e: CustomEvent) {
	if (isDraggingVolume) return;
	volume = e.detail.volume;
	isMuted = e.detail.isMuted;
}

function onMode(e: CustomEvent) {
	playMode = e.detail.playMode;
}

onMount(() => {
	const mgr = window.__fireflyMusic;
	if (mgr && !mgr.getState().initialized) {
		mgr.init();
	}

	setTimeout(syncState, 100);

	window.addEventListener("fm:init", onInit);
	window.addEventListener("fm:track", onTrack as EventListener);
	window.addEventListener("fm:play-state", onPlayState as EventListener);
	window.addEventListener("fm:time", onTime as EventListener);
	window.addEventListener("fm:volume", onVolume as EventListener);
	window.addEventListener("fm:mode", onMode as EventListener);
});

onDestroy(() => {
	window.removeEventListener("fm:init", onInit);
	window.removeEventListener("fm:track", onTrack as EventListener);
	window.removeEventListener("fm:play-state", onPlayState as EventListener);
	window.removeEventListener("fm:time", onTime as EventListener);
	window.removeEventListener("fm:volume", onVolume as EventListener);
	window.removeEventListener("fm:mode", onMode as EventListener);
});
</script>

<div class="music-visualizer__side-panel" data-panel-mode={rightPanelMode}>
	{#if rightPanelMode === "tools"}
		<section class="music-visualizer__tools-panel" aria-label="音乐工具">
			<button
				type="button"
				class="music-visualizer__record"
				class:music-visualizer__record--playing={isPlaying}
				class:music-visualizer__record--loading={!initialized}
				onclick={togglePlay}
				title={isPlaying ? "暂停" : "播放"}
				aria-label={isPlaying ? "暂停" : "播放"}
			>
				<span class="music-visualizer__record-disc" aria-hidden="true">
					<span class="music-visualizer__record-grooves"></span>
					<span class="music-visualizer__record-label">
						{#if currentTrack?.pic}
							<img
								class="music-visualizer__record-image"
								src={currentTrack.pic}
								alt=""
							/>
						{:else}
							<span class="music-visualizer__record-placeholder">
								<Icon icon="material-symbols:music-note-rounded" size="2xl" />
							</span>
						{/if}
					</span>
					<span class="music-visualizer__record-hole"></span>
					<span class="music-visualizer__record-shine"></span>
				</span>
				<span class="music-visualizer__record-overlay" aria-hidden="true">
					{#if isPlaying}
						<Icon icon="material-symbols:pause-rounded" size="2xl" />
					{:else}
						<Icon icon="material-symbols:play-arrow-rounded" size="2xl" />
					{/if}
				</span>
			</button>

			<div class="music-visualizer__mobile-track">
				<span class="music-visualizer__record-title">
					{currentTrack?.name || "未播放"}
				</span>
			</div>

			<div class="music-visualizer__tool-row">
				<button
					type="button"
					class="music-visualizer__btn music-visualizer__btn--mobile-play"
					onclick={togglePlay}
					title={isPlaying ? "暂停" : "播放"}
					aria-label={isPlaying ? "暂停" : "播放"}
				>
					{#if isPlaying}
						<Icon icon="material-symbols:pause-rounded" size="lg" />
					{:else}
						<Icon icon="material-symbols:play-arrow-rounded" size="lg" />
					{/if}
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					onclick={cycleMode}
					title="播放模式"
					aria-label="播放模式"
				>
					{#if playMode === 0}
						<Icon icon="material-symbols:repeat-rounded" size="md" />
					{:else if playMode === 1}
						<Icon icon="material-symbols:repeat-one-rounded" size="md" />
					{:else}
						<Icon icon="material-symbols:shuffle-rounded" size="md" />
					{/if}
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					onclick={togglePlaylist}
					title="歌单"
					aria-label="歌单"
					aria-controls="music-visualizer-playlist-panel"
					aria-expanded={rightPanelMode === "playlist"}
				>
					<Icon icon="material-symbols:queue-music-rounded" size="md" />
				</button>

				<button
					type="button"
					class="music-visualizer__btn"
					onclick={toggleMute}
					title="音量"
					aria-label="音量"
				>
					{#if isMuted || volume === 0}
						<Icon icon="material-symbols:volume-off-rounded" size="md" />
					{:else}
						<Icon icon="material-symbols:volume-up-rounded" size="md" />
					{/if}
				</button>
			</div>
		</section>
	{:else}
		<aside
			id="music-visualizer-playlist-panel"
			class="music-visualizer__playlist-view"
			aria-label="歌单切换"
		>
			<div class="music-visualizer__playlist-stage">
				<div class="music-visualizer__playlist-timeline"></div>
				<div class="music-visualizer__playlist-header">
					<button
						type="button"
						class="music-visualizer__btn music-visualizer__btn--playlist music-visualizer__btn--active"
						onclick={togglePlaylist}
						title="返回工具"
						aria-label="返回工具"
						aria-controls="music-visualizer-playlist-panel"
						aria-expanded={rightPanelMode === "playlist"}
					>
						<Icon icon="material-symbols:arrow-back" size="lg" />
					</button>
					<div>
						<div class="music-visualizer__playlist-kicker">PLAYLIST</div>
						<div class="music-visualizer__playlist-title">歌单切换</div>
					</div>
					<div class="music-visualizer__playlist-count">{playlist.length}</div>
				</div>

				<div
					bind:this={playlistListEl}
					class="music-visualizer__playlist-list"
					role="listbox"
					aria-label="当前歌单"
				>
					{#if playlist.length === 0}
						<div class="music-visualizer__playlist-empty">歌单加载中</div>
					{:else}
						{#each playlist as track, i}
							<button
								type="button"
								class="music-visualizer__playlist-item"
								class:music-visualizer__playlist-item--active={i === currentIndex}
								onclick={() => playTrack(i)}
								role="option"
								aria-selected={i === currentIndex}
								title={`${track.name} - ${track.artist}`}
							>
								<div class="music-visualizer__playlist-cover">
									{#if track.pic}
										<img src={track.pic} alt="" loading="lazy" />
									{:else}
										<Icon icon="material-symbols:music-note-rounded" size="sm" />
									{/if}
								</div>
								<div class="music-visualizer__playlist-meta">
									<div class="music-visualizer__playlist-name">{track.name}</div>
									<div class="music-visualizer__playlist-artist">
										{track.artist}
									</div>
								</div>
								<div
									class="music-visualizer__playlist-play-state"
									aria-hidden="true"
								>
									{#if i === currentIndex && isPlaying}
										<Icon icon="material-symbols:pause-rounded" size="lg" />
									{:else}
										<Icon icon="material-symbols:play-arrow-rounded" size="lg" />
									{/if}
								</div>
								{#if i === currentIndex}
									<div class="music-visualizer__playlist-eq" aria-hidden="true">
										<span></span>
										<span></span>
										<span></span>
									</div>
								{/if}
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</aside>
	{/if}
</div>

<div class="music-visualizer__bottom-dock" aria-label="播放控制">
	<div class="music-visualizer__bottom-dock-inner">
		<div class="music-visualizer__volume-block">
			<button
				type="button"
				class="music-visualizer__dock-btn music-visualizer__dock-btn--mute"
				onclick={toggleMute}
				title="音量"
				aria-label="音量"
			>
				{#if isMuted || volume === 0}
					<Icon icon="material-symbols:volume-off-rounded" size="md" />
				{:else}
					<Icon icon="material-symbols:volume-up-rounded" size="md" />
				{/if}
			</button>
			<div
				bind:this={volumeTrackEl}
				class="music-visualizer__timeline-track music-visualizer__timeline-track--volume"
				class:is-hover={volumeTrackHover}
				class:is-dragging={isDraggingVolume}
				onpointerdown={onVolumePointerDown}
				onpointermove={onVolumePointerMove}
				onpointerup={onVolumePointerUp}
				onpointercancel={onVolumePointerUp}
				onmouseenter={() => (volumeTrackHover = true)}
				onmouseleave={() => (volumeTrackHover = false)}
				role="slider"
				aria-label="音量"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
			>
				<div class="music-visualizer__timeline-rail"></div>
				<div
					class="music-visualizer__timeline-fill"
					style={`width: ${isMuted ? 0 : volume * 100}%`}
				></div>
				<div
					class="music-visualizer__timeline-thumb"
					style={`left: ${isMuted ? 0 : volume * 100}%`}
				></div>
			</div>
		</div>

		<div class="music-visualizer__dock-divider" aria-hidden="true"></div>

		<button
			type="button"
			class="music-visualizer__transport-btn"
			onclick={playPrev}
			title="上一首"
			aria-label="上一首"
		>
			<Icon icon="material-symbols:skip-previous-rounded" size="xl" />
		</button>

		<div class="music-visualizer__timeline-block">
			<span class="music-visualizer__time">{currentTimeStr}</span>
			<div
				bind:this={progressTrackEl}
				class="music-visualizer__timeline-track"
				class:is-hover={progressTrackHover}
				class:is-dragging={isDraggingProgress}
				onpointerdown={onProgressPointerDown}
				onpointermove={onProgressPointerMove}
				onpointerup={onProgressPointerUp}
				onpointercancel={onProgressPointerUp}
				onmouseenter={() => (progressTrackHover = true)}
				onmouseleave={() => (progressTrackHover = false)}
				role="slider"
				aria-label="进度"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress)}
			>
				<div class="music-visualizer__timeline-rail"></div>
				<div
					class="music-visualizer__timeline-fill"
					style={`width: ${progress}%`}
				></div>
				<div
					class="music-visualizer__timeline-thumb"
					style={`left: ${progress}%`}
				></div>
			</div>
			<span class="music-visualizer__time">{durationStr}</span>
		</div>

		<button
			type="button"
			class="music-visualizer__transport-btn"
			onclick={playNext}
			title="下一首"
			aria-label="下一首"
		>
			<Icon icon="material-symbols:skip-next-rounded" size="xl" />
		</button>

		<div class="music-visualizer__dock-divider" aria-hidden="true"></div>

		<div class="music-visualizer__dock-tools" aria-label="音乐工具">
			<button
				type="button"
				class="music-visualizer__dock-btn"
				class:is-active={rightPanelMode === "playlist"}
				onclick={togglePlaylist}
				title="歌单"
				aria-label="歌单"
				aria-controls="music-visualizer-playlist-panel"
				aria-expanded={rightPanelMode === "playlist"}
			>
				<Icon icon="material-symbols:queue-music-rounded" size="md" />
			</button>

			<button
				type="button"
				class="music-visualizer__dock-btn"
				class:is-active={playMode !== 0}
				onclick={cycleMode}
				title="播放模式"
				aria-label="播放模式"
			>
				{#if playMode === 0}
					<Icon icon="material-symbols:repeat-rounded" size="md" />
				{:else if playMode === 1}
					<Icon icon="material-symbols:repeat-one-rounded" size="md" />
				{:else}
					<Icon icon="material-symbols:shuffle-rounded" size="md" />
				{/if}
			</button>
		</div>
	</div>
</div>
