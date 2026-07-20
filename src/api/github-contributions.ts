import type { GithubContributionSummary } from "@/types/github-contributions";

export class GithubContributionsError extends Error {
	readonly status: number;

	constructor(status: number, message = "GitHub contributions request failed") {
		super(message);
		this.name = "GithubContributionsError";
		this.status = status;
	}
}

function isGithubContributionSummary(
	payload: unknown,
): payload is GithubContributionSummary {
	if (!payload || typeof payload !== "object") return false;

	const value = payload as Record<string, unknown>;
	return (
		typeof value.year === "number" &&
		Number.isInteger(value.year) &&
		typeof value.totalContributions === "number" &&
		Number.isInteger(value.totalContributions) &&
		value.totalContributions >= 0 &&
		typeof value.activeDays === "number" &&
		Number.isInteger(value.activeDays) &&
		value.activeDays >= 0
	);
}

export async function fetchGithubContributionSummary(
	username: string,
	year: number,
	signal?: AbortSignal,
): Promise<GithubContributionSummary> {
	const params = new URLSearchParams({
		username,
		year: String(year),
	});
	const response = await fetch(`/api/github-contributions?${params}`, {
		headers: { Accept: "application/json" },
		signal,
	});

	if (!response.ok) {
		throw new GithubContributionsError(response.status);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new GithubContributionsError(
			response.status,
			"Invalid GitHub response",
		);
	}

	if (!isGithubContributionSummary(payload) || payload.year !== year) {
		throw new GithubContributionsError(
			response.status,
			"Invalid GitHub response",
		);
	}

	return payload;
}
