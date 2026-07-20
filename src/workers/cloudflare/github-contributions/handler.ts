import type { GithubContributionSummary } from "../../../types/github-contributions";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const CACHE_TTL_SECONDS = 21600;
const CACHE_CONTROL = `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}`;
const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const MIN_GITHUB_YEAR = 2008;
const REQUEST_TIMEOUT_MS = 10000;

type GithubWorkerEnv = Env & {
	GITHUB_TOKEN?: string;
};

type ContributionDay = {
	date: string;
	contributionCount: number;
};

type GithubGraphqlResponse = {
	data?: {
		user?: {
			contributionsCollection?: {
				contributionCalendar?: {
					weeks?: Array<{
						contributionDays?: ContributionDay[];
					}>;
				};
			};
		};
	};
	errors?: unknown[];
};

function jsonResponse(
	payload: unknown,
	status: number,
	cacheControl = "no-store",
): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"Cache-Control": cacheControl,
			"Content-Type": "application/json; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

function errorResponse(code: string, status: number): Response {
	return jsonResponse({ error: code }, status);
}

function isValidYear(year: number, currentYear: number): boolean {
	return (
		Number.isInteger(year) && year >= MIN_GITHUB_YEAR && year <= currentYear
	);
}

function buildContributionQuery(username: string, from: string, to: string) {
	return {
		query: `query ContributionCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`,
		variables: { login: username, from, to },
	};
}

function createCacheKey(
	request: Request,
	username: string,
	year: number,
): Request {
	const requestUrl = new URL(request.url);
	const cacheUrl = new URL(requestUrl.origin + requestUrl.pathname);
	cacheUrl.searchParams.set("username", username);
	cacheUrl.searchParams.set("year", String(year));
	return new Request(cacheUrl.toString(), { method: "GET" });
}

export async function handleGithubContributions(
	request: Request,
	env: GithubWorkerEnv,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== "GET") {
		return errorResponse("method_not_allowed", 405);
	}

	const url = new URL(request.url);
	const username = url.searchParams.get("username")?.trim() ?? "";
	const currentYear = new Date().getUTCFullYear();
	const requestedYear = Number(url.searchParams.get("year") ?? currentYear);

	if (!USERNAME_PATTERN.test(username)) {
		return errorResponse("invalid_username", 400);
	}
	if (!isValidYear(requestedYear, currentYear)) {
		return errorResponse("invalid_year", 400);
	}

	const token = env.GITHUB_TOKEN?.trim();
	if (!token) {
		return errorResponse("github_not_configured", 503);
	}

	const cache = (caches as CacheStorage & { readonly default: Cache }).default;
	const cacheKey = createCacheKey(request, username, requestedYear);
	const cached = await cache.match(cacheKey);
	if (cached) return cached;

	const from = new Date(Date.UTC(requestedYear, 0, 1)).toISOString();
	const to = new Date().toISOString();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const upstream = await fetch(GITHUB_GRAPHQL_URL, {
			method: "POST",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"User-Agent": "my-blog-github-contributions",
			},
			body: JSON.stringify(buildContributionQuery(username, from, to)),
			signal: controller.signal,
		});

		if (!upstream.ok) {
			console.warn(
				JSON.stringify({
					event: "github_contributions_upstream_error",
					status: upstream.status,
				}),
			);
			return errorResponse("github_upstream_error", 502);
		}

		const payload = (await upstream.json()) as GithubGraphqlResponse;
		if (payload.errors?.length) {
			console.warn(
				JSON.stringify({
					event: "github_contributions_graphql_error",
					errorCount: payload.errors.length,
				}),
			);
			return errorResponse("github_upstream_error", 502);
		}

		const user = payload.data?.user;
		if (!user) return errorResponse("github_user_not_found", 404);

		const calendar = user.contributionsCollection?.contributionCalendar;
		const days = calendar?.weeks?.flatMap(
			(week) => week.contributionDays ?? [],
		);
		if (!days) return errorResponse("github_invalid_response", 502);

		const summary: GithubContributionSummary = days.reduce(
			(result, day) => {
				if (!day.date.startsWith(`${requestedYear}-`)) return result;
				result.totalContributions += Math.max(0, day.contributionCount);
				if (day.contributionCount > 0) result.activeDays += 1;
				return result;
			},
			{ year: requestedYear, totalContributions: 0, activeDays: 0 },
		);

		const response = jsonResponse(summary, 200, CACHE_CONTROL);
		ctx.waitUntil(
			cache.put(cacheKey, response.clone()).catch((error: unknown) => {
				console.warn(
					JSON.stringify({
						event: "github_contributions_cache_error",
						error: error instanceof Error ? error.message : "unknown",
					}),
				);
			}),
		);
		return response;
	} catch (error) {
		console.warn(
			JSON.stringify({
				event: "github_contributions_request_error",
				error: error instanceof Error ? error.name : "unknown",
			}),
		);
		return errorResponse("github_unavailable", 502);
	} finally {
		clearTimeout(timeoutId);
	}
}
