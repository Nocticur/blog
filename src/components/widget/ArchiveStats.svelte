<script lang="ts">
import { onMount } from "svelte";
import { fetchGithubContributionSummary } from "@/api/github-contributions";

type GithubStatus = "idle" | "loading" | "ready" | "error" | "disabled";
type PostSummary = {
	category?: string | null;
	tags: string[];
};

export let totalPosts = 0;
export let currentYearPosts = 0;
export let postSummaries: PostSummary[] = [];
export let annualPostGoal = 0;
export let githubEnabled = false;
export let githubUsername = "";
export let timezone = "UTC";
export let totalPostsLabel = "";
export let githubLabel = "";
export let categoryPostsLabel = "";
export let tagPostsLabel = "";
export let progressLabel = "";
export let goalLabel = "";
export let loadingLabel = "";
export let unavailableLabel = "--";

let displayedScopePosts = totalPosts;
let scopePostsLabel = totalPostsLabel;
let displayedProgress: number | null = null;
let displayedGithub: number | null = null;
let githubStatus: GithubStatus = "idle";
let progressTarget: number | null = null;
let animationFrames: number[] = [];

$: progressTarget =
	annualPostGoal > 0
		? Math.round((currentYearPosts / annualPostGoal) * 100)
		: null;

function formatNumber(value: number): string {
	return String(Math.max(0, Math.round(value)));
}

function normalizeFilterValue(value: string | null | undefined): string {
	return (value ?? "").trim();
}

function getScopeSummary(): { label: string; count: number } {
	if (postSummaries.length === 0) {
		return { label: totalPostsLabel, count: totalPosts };
	}

	const params = new URLSearchParams(window.location.search);
	const tags = params.getAll("tag").map(normalizeFilterValue).filter(Boolean);
	const categories = params
		.getAll("category")
		.map(normalizeFilterValue)
		.filter(Boolean);
	const hasUncategorized = params.has("uncategorized");

	let filtered = postSummaries;
	if (tags.length > 0) {
		filtered = filtered.filter((post) =>
			post.tags.some((tag) => tags.includes(normalizeFilterValue(tag))),
		);
	}
	if (categories.length > 0) {
		filtered = filtered.filter((post) =>
			categories.includes(normalizeFilterValue(post.category)),
		);
	}
	if (hasUncategorized) {
		filtered = filtered.filter(
			(post) => normalizeFilterValue(post.category).length === 0,
		);
	}

	const label =
		tags.length > 0
			? tagPostsLabel
			: categories.length > 0 || hasUncategorized
				? categoryPostsLabel
				: totalPostsLabel;
	return { label, count: filtered.length };
}

function getRuntimeYear(): number {
	const year = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
	}).format(Date.now());
	return Number(year);
}

function animateNumber(
	target: number,
	setter: (value: number) => void,
	reducedMotion: boolean,
): void {
	if (reducedMotion) {
		setter(target);
		return;
	}

	let frameId = 0;
	const startedAt = performance.now();
	const duration = 900;
	const frame = (now: number) => {
		if (frameId) {
			const index = animationFrames.indexOf(frameId);
			if (index >= 0) animationFrames.splice(index, 1);
		}
		const progress = Math.min(1, (now - startedAt) / duration);
		const eased = 1 - (1 - progress) ** 3;
		setter(Math.round(target * eased));
		if (progress < 1) {
			frameId = requestAnimationFrame(frame);
			animationFrames.push(frameId);
		}
	};

	frameId = requestAnimationFrame(frame);
	animationFrames.push(frameId);
}

function cancelAnimations(): void {
	for (const frameId of animationFrames) cancelAnimationFrame(frameId);
	animationFrames = [];
}

onMount(() => {
	const controller = new AbortController();
	const reducedMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	const scopeSummary = getScopeSummary();
	scopePostsLabel = scopeSummary.label;

	if (!reducedMotion) {
		displayedScopePosts = 0;
		displayedProgress = progressTarget === null ? null : 0;
	}

	animateNumber(
		scopeSummary.count,
		(value) => (displayedScopePosts = value),
		reducedMotion,
	);
	if (progressTarget !== null) {
		animateNumber(
			progressTarget,
			(value) => (displayedProgress = value),
			reducedMotion,
		);
	}

	const cleanup = () => {
		controller.abort();
		cancelAnimations();
	};

	if (!githubEnabled || !githubUsername) {
		githubStatus = "disabled";
		return cleanup;
	}

	githubStatus = "loading";
	const year = getRuntimeYear();
	void fetchGithubContributionSummary(githubUsername, year, controller.signal)
		.then((summary) => {
			if (controller.signal.aborted) return;
			githubStatus = "ready";
			animateNumber(
				summary.totalContributions,
				(value) => (displayedGithub = value),
				reducedMotion,
			);
		})
		.catch(() => {
			if (controller.signal.aborted) return;
			githubStatus = "error";
			displayedGithub = null;
		});

	return cleanup;
});

$: githubValue =
	displayedGithub === null ? unavailableLabel : formatNumber(displayedGithub);
$: progressValue =
	displayedProgress === null
		? unavailableLabel
		: `${formatNumber(displayedProgress)}%`;
$: githubStatusText =
	githubStatus === "loading"
		? loadingLabel
		: githubStatus === "error"
			? unavailableLabel
			: "";
</script>

<section
	class="archive-stats"
	class:archive-stats--loading={githubStatus === "loading"}
	aria-busy={githubStatus === "loading"}
>
	<div class="archive-stats__grid">
		<div
			class="archive-stats__metric"
			role="group"
			aria-label={`${scopePostsLabel}: ${formatNumber(displayedScopePosts)}`}
		>
			<span class="archive-stats__value" aria-hidden="true">{formatNumber(displayedScopePosts)}</span>
			<span class="archive-stats__label">{scopePostsLabel}</span>
		</div>
		<div
			class="archive-stats__metric"
			role="group"
			aria-label={`${progressLabel}: ${progressValue}`}
		>
			<span class="archive-stats__value" aria-hidden="true">{progressValue}</span>
			<span class="archive-stats__label">{progressLabel}</span>
			{#if annualPostGoal > 0}
				<span class="archive-stats__goal">{goalLabel} {annualPostGoal}</span>
			{/if}
		</div>
		<div
			class="archive-stats__metric"
			role="group"
			aria-label={`${githubLabel}: ${githubValue}`}
		>
			<span class="archive-stats__value" aria-hidden="true">{githubValue}</span>
			<span class="archive-stats__label">{githubLabel}</span>
		</div>
	</div>

	{#if githubStatusText}
		<span class="archive-stats__status sr-only" role="status">{githubStatusText}</span>
	{/if}
</section>
