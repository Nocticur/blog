import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPORT_PATH = "reports/friend-links.json";
const COMMIT_SHA = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

export function shouldIgnoreReportDeployment({
	cwd = process.cwd(),
	previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA,
} = {}) {
	const previous = typeof previousSha === "string" ? previousSha.trim() : "";
	if (!COMMIT_SHA.test(previous)) {
		return { ignore: false, reason: "No valid previous successful deployment SHA." };
	}
	const git = (...args) => execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 10_000,
		maxBuffer: 1024 * 1024,
	});
	try {
		const previousCommit = git("rev-parse", "--verify", "--end-of-options", `${previous}^{commit}`).trim();
		const head = git("rev-parse", "--verify", "HEAD^{commit}").trim();
		git("merge-base", "--is-ancestor", previousCommit, head);
		// Compare with the last successful deployment, not HEAD^: a preceding
		// code commit may still be awaiting its first successful deployment.
		const paths = git("diff", "--name-only", "--no-renames", "-z", previousCommit, head, "--")
			.split("\0")
			.filter(Boolean);
		if (paths.length > 0 && paths.every((changedPath) => changedPath === REPORT_PATH)) {
			return { ignore: true, reason: "Only the friend report changed since the previous successful deployment." };
		}
		return { ignore: false, reason: "Code or configuration changed, or there is no report update." };
	} catch {
		return { ignore: false, reason: "Git could not establish a reliable deployment baseline." };
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const decision = shouldIgnoreReportDeployment();
	console.log(`${decision.ignore ? "Ignore deployment" : "Build deployment"}: ${decision.reason}`);
	// Vercel's ignoreCommand interprets 0 as skip and 1 as proceed.
	process.exitCode = decision.ignore ? 0 : 1;
}
